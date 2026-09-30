// Wyrm simulation: dragons, flight, tails, orbs, power-ups, collisions.
// Pure game state — no rendering, no DOM — so this module can later run
// unchanged as the authoritative multiplayer server (spec §16). Only
// three.js math classes are used.
import { Vector3, Quaternion, Matrix4 } from 'three';
import { T, lengthFor, radiusFor, tierFor } from './tunables.js?v=1';

const DEG = Math.PI / 180;
const PATH_STEP = 0.5;          // m between recorded head positions
const PATH_CAP = 1200;          // ring capacity → 600 m of history
const MAX_BEADS = 900;          // per dragon
const CELL = 4;                 // spatial hash cell (m)
const HASH_SIZE = 16384;        // buckets (power of two)
const MAX_ORBS = 6000;

const _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3();
const _q1 = new Quaternion(), _m = new Matrix4();
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);

// ---------------------------------------------------------------- arenas
// All boundaries and obstacles are analytic (spec §9): collision is a
// signed-distance test, no meshes.
export function makeArena(key) {
    if (key === 'orb') {
        const R = T.orbRadius;
        return {
            key, name: 'The Orb', kind: 'sphere', gravity: false, radius: R,
            center: new Vector3(0, 0, 0),
            obstacles: [{ type: 'sphere', c: new Vector3(0, 0, 0), r: 5, name: 'the Heart' }],
            wallName: 'the glass shell',
        };
    }
    const R = T.skyRadius, H = T.skyCeiling;
    const rockY = H * 0.31;
    return {
        key: 'sky', name: 'Skyhold', kind: 'cylinder', gravity: true, radius: R,
        floor: 0, ceiling: H, softCeiling: H - 7,
        center: new Vector3(0, H * 0.5, 0),
        obstacles: [
            { type: 'sphere', c: new Vector3(0, rockY, 0), r: Math.min(12, R * 0.17), name: 'the castle rock' },
            { type: 'capsule', a: new Vector3(0, rockY, 0), b: new Vector3(0, H * 0.73, 0), r: 3, name: 'the spire' },
        ],
        wallName: 'the storm wall',
    };
}

function obstacleDist(o, p) {
    if (o.type === 'sphere') return p.distanceTo(o.c) - o.r;
    // capsule
    _v1.subVectors(o.b, o.a);
    const t = Math.max(0, Math.min(1, _v2.subVectors(p, o.a).dot(_v1) / _v1.lengthSq()));
    _v3.copy(o.a).addScaledVector(_v1, t);
    return p.distanceTo(_v3) - o.r;
}

// Signed distance to the nearest lethal surface (positive = inside, safe).
// Returns [distance, name-of-surface].
export function hazardDist(arena, p) {
    let d, name = arena.wallName;
    if (arena.kind === 'sphere') {
        d = arena.radius - p.length();
    } else {
        d = arena.radius - Math.hypot(p.x, p.z);
        const floor = p.y - arena.floor;
        if (floor < d) { d = floor; name = 'the cloud sea'; }
    }
    for (const o of arena.obstacles) {
        const od = obstacleDist(o, p);
        if (od < d) { d = od; name = o.name; }
    }
    return [d, name];
}

// "Up" used for auto-level (gravity) or orientation assist (zero-G).
function referenceUp(arena, p, out) {
    if (arena.gravity) return out.set(0, 1, 0);
    out.copy(arena.center).sub(p);
    const l = out.length();
    return l < 1e-3 ? null : out.multiplyScalar(1 / l);
}

// ---------------------------------------------------------------- dragons
export const PALETTE = [0xFF4D4D, 0xFF9A3C, 0xFFD93D, 0x7CFF4F, 0x3DFFB5, 0x3DE0FF,
    0x4D7CFF, 0xA45CFF, 0xFF4DD8, 0xF2F4FF];

let nextId = 1;

export class Dragon {
    constructor(name, isBot) {
        this.id = nextId++;
        this.name = name;
        this.isBot = isBot;
        const ci = Math.floor(Math.random() * PALETTE.length);
        this.color = PALETTE[ci];
        this.color2 = PALETTE[(ci + 2 + Math.floor(Math.random() * 6)) % PALETTE.length];
        this.pos = new Vector3();
        this.quat = new Quaternion();
        this.vdir = new Vector3(0, 0, -1);
        this.fwd = new Vector3(0, 0, -1);
        this.up = new Vector3(0, 1, 0);
        this.speed = T.speedCruise;
        this.mass = T.spawnMass;
        this.len = lengthFor(this.mass);
        this.r = radiusFor(this.mass);
        this.alive = true;
        this.protect = 0;
        this.shield = 0; this.magnet = 0; this.fire = 0;
        this.kills = 0; this.bornAt = 0; this.peakMass = this.mass; this.bestRank = 99;
        this.tier = 0;
        this.boosting = false; this.braking = false; this.boostAcc = 0;
        this.steer = { x: 0, y: 0 };             // smoothed stick
        this.bank = 0;                            // cosmetic, radians
        this.input = { sx: 0, sy: 0, roll: 0, boost: false, brake: false, fire: false };
        // Path ring buffer of past head positions.
        this.path = new Float32Array(PATH_CAP * 3);
        this.pathHead = -1; this.pathCount = 0;
        this.lastPt = new Vector3();
        // Beads (body), rebuilt each step from the path.
        this.beads = new Float32Array(MAX_BEADS * 3);
        this.nBeads = 0; this.beadSpacing = 0.5;
        this.near = new Map();                    // enemy id → near-miss state
        this.lastEncounter = new Map();
        this.brain = null;
    }

    pushPath(x, y, z) {
        this.pathHead = (this.pathHead + 1) % PATH_CAP;
        const i = this.pathHead * 3;
        this.path[i] = x; this.path[i + 1] = y; this.path[i + 2] = z;
        if (this.pathCount < PATH_CAP) this.pathCount++;
        this.lastPt.set(x, y, z);
    }

    // Recompute bead positions: walk back from the head along the path.
    rebuildBeads() {
        const spacing = Math.max(0.2, T.beadSpacing * this.r);
        this.beadSpacing = spacing;
        const maxLen = this.len;
        let px = this.pos.x, py = this.pos.y, pz = this.pos.z;
        let walked = 0, target = spacing, n = 0;
        const P = this.path;
        for (let k = 0; k < this.pathCount && n < MAX_BEADS; k++) {
            const idx = ((this.pathHead - k + PATH_CAP) % PATH_CAP) * 3;
            const qx = P[idx], qy = P[idx + 1], qz = P[idx + 2];
            const dx = qx - px, dy = qy - py, dz = qz - pz;
            const seg = Math.sqrt(dx * dx + dy * dy + dz * dz);
            while (seg > 0 && target <= walked + seg && target <= maxLen && n < MAX_BEADS) {
                const t = (target - walked) / seg;
                const o = n * 3;
                this.beads[o] = px + dx * t; this.beads[o + 1] = py + dy * t; this.beads[o + 2] = pz + dz * t;
                n++; target += spacing;
            }
            walked += seg;
            if (target > maxLen) break;
            px = qx; py = qy; pz = qz;
        }
        this.nBeads = n;
        // Length actually shown can't exceed recorded history.
        this.shownLen = Math.min(maxLen, walked);
    }

    updateFrame() {
        this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
        this.up.set(0, 1, 0).applyQuaternion(this.quat);
    }
}

export function quatFromForwardUp(F, Uhint, out) {
    const R = _v1.crossVectors(F, Uhint);
    if (R.lengthSq() < 1e-6) R.crossVectors(F, Math.abs(F.y) < 0.9 ? Y : X);
    R.normalize();
    const U = _v2.crossVectors(R, F).normalize();
    const B = _v3.copy(F).negate();          // local +Z = backward
    _m.makeBasis(R, U, B);
    return out.setFromRotationMatrix(_m);
}

// ---------------------------------------------------------------- world
export class World {
    constructor(arenaKey) {
        this.arena = makeArena(arenaKey);
        this.time = 0;
        this.dragons = [];
        this.events = [];
        // Orbs as struct-of-arrays.
        this.ox = new Float32Array(MAX_ORBS); this.oy = new Float32Array(MAX_ORBS); this.oz = new Float32Array(MAX_ORBS);
        this.oval = new Float32Array(MAX_ORBS); this.ocol = new Uint32Array(MAX_ORBS);
        this.ottl = new Float32Array(MAX_ORBS);   // 0 = ambient (no expiry)
        this.oalive = new Uint8Array(MAX_ORBS);
        this.opull = new Int32Array(MAX_ORBS);    // dragon id pulling it, 0 = free
        this.opullT = new Float32Array(MAX_ORBS);
        this.oFree = []; for (let i = MAX_ORBS - 1; i >= 0; i--) this.oFree.push(i);
        this.orbCount = 0; this.ambientCount = 0;
        this.powerups = [];
        this.nextPowerup = 10;
        // Spatial hash over all beads.
        this.hStart = new Int32Array(HASH_SIZE + 1);
        this.hCount = new Int32Array(HASH_SIZE);
        this.bx = new Float32Array(40000); this.by = new Float32Array(40000); this.bz = new Float32Array(40000);
        this.bOwner = new Int32Array(40000); this.bIdx = new Int32Array(40000);
        this.hEntries = new Int32Array(40000); this.bKey = new Int32Array(40000);
        this.nb = 0;
        this.byId = new Map();
        // Encounter stats (spec §4): encounters vs dragon-seconds alive.
        this.statWindow = [];     // [time, encounters, dragonSeconds] per second bucket
        this._bucket = { t: 0, enc: 0, ds: 0, penc: 0, pds: 0 };
        this.player = null;
        this.botRespawns = [];
    }

    emit(e) { this.events.push(e); }

    // ------------------------------------------------ orbs
    addOrb(x, y, z, val, col, ttl) {
        if (!this.oFree.length) return -1;
        const i = this.oFree.pop();
        this.ox[i] = x; this.oy[i] = y; this.oz[i] = z;
        this.oval[i] = val; this.ocol[i] = col; this.ottl[i] = ttl;
        this.oalive[i] = 1; this.opull[i] = 0; this.opullT[i] = 0;
        this.orbCount++;
        if (!ttl) this.ambientCount++;
        return i;
    }
    removeOrb(i) {
        if (!this.oalive[i]) return;
        this.oalive[i] = 0; this.orbCount--;
        if (!this.ottl[i]) this.ambientCount--;
        this.oFree.push(i);
    }

    randomPointInside(margin, out) {
        const a = this.arena;
        for (let tries = 0; tries < 50; tries++) {
            if (a.kind === 'sphere') {
                out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).multiplyScalar(a.radius);
            } else {
                const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * a.radius;
                out.set(Math.cos(ang) * rr, a.floor + Math.random() * (a.ceiling - a.floor), Math.sin(ang) * rr);
            }
            if (hazardDist(a, out)[0] > margin && (a.kind !== 'cylinder' || out.y < a.softCeiling - 2)) return out;
        }
        return out.copy(a.center);
    }

    spawnAmbient(n) {
        const p = new Vector3();
        let made = 0;
        while (made < n) {
            if (Math.random() < T.orbClusterShare) {
                this.randomPointInside(8, p);
                const k = 20 + Math.floor(Math.random() * 21);
                const col = PALETTE[Math.floor(Math.random() * PALETTE.length)];
                for (let j = 0; j < k; j++) {
                    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = 3 * Math.cbrt(Math.random());
                    const s = Math.sqrt(1 - u * u);
                    this.addOrb(p.x + rr * s * Math.cos(th), p.y + rr * u, p.z + rr * s * Math.sin(th), 1, col, 0);
                }
                made += k;
            } else {
                this.randomPointInside(3, p);
                this.addOrb(p.x, p.y, p.z, 1, PALETTE[Math.floor(Math.random() * PALETTE.length)], 0);
                made++;
            }
        }
    }

    dropLoot(d, share) {
        const total = d.mass * share;
        if (total <= 0 || d.nBeads === 0) return;
        const n = Math.max(1, Math.ceil(total / 6));
        const val = total / n;
        for (let i = 0; i < n; i++) {
            const b = Math.min(d.nBeads - 1, Math.floor((i + Math.random()) / n * d.nBeads)) * 3;
            const j = d.r * 1.2;
            this.addOrb(d.beads[b] + (Math.random() - 0.5) * j, d.beads[b + 1] + (Math.random() - 0.5) * j,
                d.beads[b + 2] + (Math.random() - 0.5) * j, val, i % 3 ? d.color : d.color2, T.lootTtl);
        }
    }

    // ------------------------------------------------ dragons
    addDragon(d) { this.dragons.push(d); this.byId.set(d.id, d); return d; }

    removeDragon(d) {
        const i = this.dragons.indexOf(d);
        if (i >= 0) this.dragons.splice(i, 1);
        this.byId.delete(d.id);
    }

    // Pick the spawn point farthest from any dragon (spec §6.9).
    findSpawn(out) {
        const cand = new Vector3();
        let best = -1;
        for (let s = 0; s < 16; s++) {
            this.randomPointInside(15, cand);
            let dmin = 1e9;
            for (const d of this.dragons) {
                if (!d.alive) continue;
                dmin = Math.min(dmin, cand.distanceTo(d.pos));
                for (let b = 0; b < d.nBeads; b += 4) {
                    const o = b * 3;
                    const dx = d.beads[o] - cand.x, dy = d.beads[o + 1] - cand.y, dz = d.beads[o + 2] - cand.z;
                    const dd = dx * dx + dy * dy + dz * dz;
                    if (dd < dmin * dmin) dmin = Math.sqrt(dd);
                }
            }
            if (dmin > best) { best = dmin; out.copy(cand); }
        }
        return out;
    }

    spawn(d, mass) {
        const a = this.arena;
        d.alive = true;
        d.mass = mass; d.peakMass = mass;
        d.r = radiusFor(mass);
        d.len = lengthFor(mass);
        d.tier = tierFor(mass);
        d.kills = 0; d.bornAt = this.time; d.bestRank = 99;
        d.protect = T.spawnProtect;
        d.shield = 0; d.magnet = 0; d.fire = 0;
        d.speed = T.speedCruise; d.boostAcc = 0;
        d.steer.x = d.steer.y = 0; d.bank = 0;
        d.near.clear(); d.lastEncounter.clear();
        this.findSpawn(d.pos);
        // Face roughly toward the centre, offset so we don't all converge.
        const aim = _v1.copy(a.center).add(_v2.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).multiplyScalar(a.radius * 0.5));
        const F = aim.sub(d.pos).normalize().clone();
        const up = referenceUp(a, d.pos, new Vector3()) || Y;
        quatFromForwardUp(F, up, d.quat);
        d.updateFrame();
        d.vdir.copy(d.fwd);
        // Pre-fill a short straight tail behind the head.
        d.pathHead = -1; d.pathCount = 0;
        const back = Math.ceil((d.len + 2) / PATH_STEP);
        for (let k = back; k >= 1; k--) {
            d.pushPath(d.pos.x - F.x * k * PATH_STEP, d.pos.y - F.y * k * PATH_STEP, d.pos.z - F.z * k * PATH_STEP);
        }
        d.lastPt.copy(d.pos).addScaledVector(F, -PATH_STEP);
        d.rebuildBeads();
        if (!this.byId.has(d.id)) this.addDragon(d);
        return d;
    }

    // ------------------------------------------------ flight (spec §6.2)
    fly(d, dt) {
        const inp = d.input, a = this.arena;
        d.boosting = inp.boost && !inp.brake && d.mass >= T.boostMinMass;
        d.braking = inp.brake;
        const mode = d.braking ? 'Brake' : d.boosting ? 'Boost' : 'Cruise';
        // Smooth the stick a touch so turns have weight.
        const ks = T.steerTau > 0 ? 1 - Math.exp(-dt / T.steerTau) : 1;
        d.steer.x += (inp.sx - d.steer.x) * ks;
        d.steer.y += (inp.sy - d.steer.y) * ks;
        let sx = d.steer.x, sy = d.steer.y;
        const mag = Math.hypot(sx, sy);
        if (mag > 1) { sx /= mag; sy /= mag; }
        const omega = T['turn' + mode] * DEG * (1 - T.sizeTurnPenalty * Math.min(1, d.mass / 2000));
        // One rotation about the local axis perpendicular to the stick.
        const m2 = Math.hypot(sx, sy);
        if (m2 > 1e-5) {
            _v1.set(sy / m2, -sx / m2, 0);
            _q1.setFromAxisAngle(_v1, m2 * omega * dt);
            d.quat.multiply(_q1);
        }
        if (inp.roll) {
            _q1.setFromAxisAngle(Z, -inp.roll * T.rollRate * DEG * dt);
            d.quat.multiply(_q1);
        }
        d.quat.normalize();
        d.updateFrame();

        // Auto-level (gravity) / orientation assist (zero-G) when not rolling.
        const rate = a.gravity ? T.levelRate : (d.isBot || this.assist ? T.assistRate : 0);
        const W = referenceUp(a, d.pos, _v3);
        if (!inp.roll && rate > 0 && W && Math.abs(d.fwd.dot(W)) < 0.95) {
            const R0 = _v1.crossVectors(d.fwd, W).normalize();
            const U0 = _v2.crossVectors(R0, d.fwd);
            const phi = Math.atan2(d.up.dot(R0), d.up.dot(U0));
            const delta = Math.max(-rate * DEG * dt, Math.min(rate * DEG * dt, -phi));
            _q1.setFromAxisAngle(d.fwd, delta);
            d.quat.premultiply(_q1).normalize();
            d.updateFrame();
        }

        // Soft ceiling (Skyhold): thin air noses you down and bleeds speed.
        let ceilingDrag = 1;
        if (a.kind === 'cylinder' && d.pos.y > a.softCeiling) {
            const k = Math.min(1, (d.pos.y - a.softCeiling) / (a.ceiling - a.softCeiling));
            if (d.fwd.y > -0.4) {
                const R = _v1.crossVectors(d.fwd, d.up).normalize();
                _q1.setFromAxisAngle(R, -k * 2.0 * dt);
                d.quat.premultiply(_q1).normalize();
                d.updateFrame();
            }
            ceilingDrag = 1 - 0.3 * k;
        }

        // Speed.
        let target = T['speed' + mode];
        if (a.gravity) target = Math.max(T.speedBrake, target + T.diveBoost * -d.fwd.y);
        target *= ceilingDrag;
        d.speed += (target - d.speed) * (T.speedTau > 0 ? 1 - Math.exp(-dt / T.speedTau) : 1);

        // Velocity direction trails the nose → carved turns.
        const kc = T.carveTau > 0 ? 1 - Math.exp(-dt / T.carveTau) : 1;
        d.vdir.lerp(d.fwd, kc).normalize();
        d.pos.addScaledVector(d.vdir, d.speed * dt);
        if (a.kind === 'cylinder' && d.pos.y > a.ceiling) d.pos.y = a.ceiling;

        // Record path every PATH_STEP metres of travel.
        let dist = d.pos.distanceTo(d.lastPt);
        while (dist >= PATH_STEP) {
            _v1.subVectors(d.pos, d.lastPt).multiplyScalar(PATH_STEP / dist).add(d.lastPt);
            d.pushPath(_v1.x, _v1.y, _v1.z);
            dist = d.pos.distanceTo(d.lastPt);
        }

        // Cosmetic bank into turns.
        const bt = sx * T.visualBank * DEG;
        d.bank += (bt - d.bank) * (1 - Math.exp(-dt / 0.15));

        // Boost burns mass; half drops behind as orbs (spec §6.5).
        if (d.boosting) {
            const c = T.boostCost * dt;
            d.mass = Math.max(T.boostMinMass - 1, d.mass - c);
            d.boostAcc += c * T.boostDropShare;
            while (d.boostAcc >= 1 && d.nBeads > 0) {
                d.boostAcc -= 1;
                const o = (d.nBeads - 1) * 3;
                this.addOrb(d.beads[o], d.beads[o + 1], d.beads[o + 2], 1, d.color, T.lootTtl);
            }
        }

        // Growth: length eases toward target, radius follows mass.
        const targetLen = lengthFor(d.mass);
        d.len += Math.max(-30 * dt, Math.min(12 * dt, targetLen - d.len));
        d.r = radiusFor(d.mass);
        if (d.mass > d.peakMass) d.peakMass = d.mass;
        const tier = tierFor(d.mass);
        if (tier > d.tier) this.emit({ type: 'tier', d, tier });
        d.tier = tier;

        if (d.protect > 0) {
            d.protect -= dt;
            // Don't let protection lapse while the head is inside a tail.
            if (d.protect <= 0 && this.tailDanger(d.pos, d.id, d.r * T.headColScale)) d.protect = 0.1;
            if (d.protect < 0) d.protect = 0;
        }
        d.shield = Math.max(0, d.shield - dt);
        d.magnet = Math.max(0, d.magnet - dt);
    }

    // ------------------------------------------------ spatial hash
    buildHash() {
        let nb = 0;
        const hc = this.hCount; hc.fill(0);
        for (const d of this.dragons) {
            if (!d.alive) continue;
            for (let b = 0; b < d.nBeads; b++) {
                if (nb >= this.bx.length) break;
                const o = b * 3;
                const x = d.beads[o], y = d.beads[o + 1], z = d.beads[o + 2];
                this.bx[nb] = x; this.by[nb] = y; this.bz[nb] = z;
                this.bOwner[nb] = d.id; this.bIdx[nb] = b;
                const key = hashCell(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL));
                this.bKey[nb] = key; hc[key]++;
                nb++;
            }
        }
        const hs = this.hStart;
        hs[0] = 0;
        for (let i = 0; i < HASH_SIZE; i++) hs[i + 1] = hs[i] + hc[i];
        const fill = hc; // reuse as cursor
        for (let i = 0; i < HASH_SIZE; i++) fill[i] = hs[i];
        for (let i = 0; i < nb; i++) this.hEntries[fill[this.bKey[i]]++] = i;
        this.nb = nb;
    }

    // Visit beads near p (within one cell). cb(beadIndex) → true to stop.
    queryBeads(p, cb) {
        const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
            const key = hashCell(cx + dx, cy + dy, cz + dz);
            for (let e = this.hStart[key]; e < this.hStart[key + 1]; e++) {
                if (cb(this.hEntries[e])) return true;
            }
        }
        return false;
    }

    // Is there a lethal tail (not owned by `selfId`) within `pad` of p?
    // Used by bot feelers.
    tailDanger(p, selfId, pad) {
        let hit = 0;
        this.queryBeads(p, (i) => {
            const owner = this.bOwner[i];
            if (owner === selfId) return false;
            const d = this.byId.get(owner);
            if (!d || d.protect > 0) return false;
            const dx = this.bx[i] - p.x, dy = this.by[i] - p.y, dz = this.bz[i] - p.z;
            const rr = d.r * T.tailColScale + pad;
            if (dx * dx + dy * dy + dz * dz < rr * rr) { hit = 1; return true; }
            return false;
        });
        return hit;
    }

    // ------------------------------------------------ collisions (spec §6.3)
    collide() {
        const deaths = [];
        const P = this.player;
        for (const d of this.dragons) {
            if (!d.alive) continue;
            const rh = d.r * T.headColScale;
            // Walls and obstacles.
            const [hd, surface] = hazardDist(this.arena, d.pos);
            if (hd < rh) { deaths.push({ d, killer: null, cause: surface }); continue; }
            if (d.protect > 0) continue;
            // Head → other tails.
            let killer = null;
            const encR = T.encounterDist;
            this.queryBeads(d.pos, (i) => {
                const owner = this.bOwner[i];
                if (owner === d.id) return false;
                const o = this.byId.get(owner);
                if (!o || !o.alive) return false;
                const dx = this.bx[i] - d.pos.x, dy = this.by[i] - d.pos.y, dz = this.bz[i] - d.pos.z;
                const dd = dx * dx + dy * dy + dz * dz;
                // Encounter metric (all dragons, 1 s cooldown per pair).
                if (dd < encR * encR) {
                    const last = d.lastEncounter.get(owner) || -9;
                    if (this.time - last > 1) {
                        this._bucket.enc++;
                        if (d === P) this._bucket.penc++;
                    }
                    d.lastEncounter.set(owner, this.time);
                }
                if (o.protect > 0) return false;
                const lethal = rh + o.r * T.tailColScale;
                if (dd < lethal * lethal) { killer = o; return true; }
                // Near miss tracking for the player.
                if (d === P) {
                    const nm = lethal + T.nearMissPad;
                    if (dd < nm * nm && d.speed >= T.speedCruise * 0.9) {
                        const st = d.near.get(owner);
                        if (!st || this.time - st.t > 3) d.near.set(owner, { t: this.time, pending: true });
                    }
                }
                return false;
            });
            if (killer) {
                if (d.shield > 0) {
                    d.shield = 0; d.protect = 1.5;
                    this.emit({ type: 'shieldPop', d, by: killer });
                } else {
                    deaths.push({ d, killer, cause: 'tail' });
                }
            }
        }
        // Head ↔ head: smaller dies; within 5% both die.
        const ds = this.dragons;
        for (let i = 0; i < ds.length; i++) {
            const a = ds[i];
            if (!a.alive || a.protect > 0) continue;
            for (let j = i + 1; j < ds.length; j++) {
                const b = ds[j];
                if (!b.alive || b.protect > 0) continue;
                const rr = (a.r + b.r) * T.headColScale;
                if (a.pos.distanceToSquared(b.pos) < rr * rr) {
                    const ratio = a.mass / b.mass;
                    if (ratio > 1.05) deaths.push({ d: b, killer: a, cause: 'head' });
                    else if (ratio < 1 / 1.05) deaths.push({ d: a, killer: b, cause: 'head' });
                    else { deaths.push({ d: a, killer: b, cause: 'head' }); deaths.push({ d: b, killer: a, cause: 'head' }); }
                }
            }
        }
        const seen = new Set();
        for (const x of deaths) {
            if (seen.has(x.d) || !x.d.alive) continue;
            seen.add(x.d);
            this.kill(x.d, x.killer, x.cause);
        }
        // Resolve pending near misses for the player (must survive 0.4 s).
        if (P && P.alive) {
            for (const [id, st] of P.near) {
                if (st.pending && this.time - st.t > 0.4) {
                    st.pending = false;
                    this.emit({ type: 'nearMiss', d: P, other: this.byId.get(id) });
                }
            }
        }
    }

    kill(d, killer, cause) {
        d.alive = false;
        this.dropLoot(d, T.lootShare);
        if (killer && killer.alive) killer.kills++;
        this.emit({ type: 'death', d, killer, cause });
        if (d.isBot) {
            this.removeDragon(d);
            this.botRespawns.push(this.time + 2 + Math.random() * 2);
        }
    }

    // ------------------------------------------------ orbs & pickups
    updateOrbs(dt) {
        // Expire loot.
        for (let i = 0; i < MAX_ORBS; i++) {
            if (!this.oalive[i]) continue;
            if (this.ottl[i] > 0 && this.opull[i] === 0) {
                this.ottl[i] -= dt;
                if (this.ottl[i] <= 0) { this.ottl[i] = 1e-6; this.removeOrb(i); }
            }
        }
        // Pickup: attract then consume.
        for (const d of this.dragons) {
            if (!d.alive) continue;
            const rad = (d.magnet > 0 ? T.magnetRadius : T.pickupBase) + d.r;
            const r2 = rad * rad;
            const px = d.pos.x, py = d.pos.y, pz = d.pos.z;
            for (let i = 0; i < MAX_ORBS; i++) {
                if (!this.oalive[i] || this.opull[i]) continue;
                const dx = this.ox[i] - px; if (dx > rad || dx < -rad) continue;
                const dy = this.oy[i] - py; if (dy > rad || dy < -rad) continue;
                const dz = this.oz[i] - pz;
                if (dx * dx + dy * dy + dz * dz < r2) { this.opull[i] = d.id; this.opullT[i] = 0; }
            }
        }
        for (let i = 0; i < MAX_ORBS; i++) {
            if (!this.oalive[i] || !this.opull[i]) continue;
            const d = this.byId.get(this.opull[i]);
            if (!d || !d.alive) { this.opull[i] = 0; continue; }
            this.opullT[i] += dt;
            const mx = d.pos.x + d.fwd.x * d.r, my = d.pos.y + d.fwd.y * d.r, mz = d.pos.z + d.fwd.z * d.r;
            const k = Math.min(1, dt * 14);
            this.ox[i] += (mx - this.ox[i]) * k; this.oy[i] += (my - this.oy[i]) * k; this.oz[i] += (mz - this.oz[i]) * k;
            if (this.opullT[i] > 0.15) {
                let v = this.oval[i];
                if (d.isBot && d.mass > T.botGrowthCapMass) v *= 0.5;
                d.mass += v;
                this.emit({ type: 'eat', d, value: this.oval[i], color: this.ocol[i] });
                this.removeOrb(i);
            }
        }
        // Keep ambient density.
        const deficit = Math.round(T.orbTarget) - this.ambientCount;
        if (deficit > 0) this.spawnAmbient(Math.min(deficit, Math.ceil(60 * dt) + (deficit > 200 ? 40 : 0)));
    }

    // ------------------------------------------------ power-ups (spec §6.6)
    updatePowerups(dt) {
        if (!T.powerups) { this.powerups.length = 0; return; }
        if (this.time > this.nextPowerup) {
            this.nextPowerup = this.time + T.powerupEvery * (0.75 + Math.random() * 0.5);
            if (this.powerups.length < T.powerupMax) {
                const types = ['shield', 'magnet'];
                if (T.dragonfire) types.push('fire', 'fire');
                const p = new Vector3();
                this.randomPointInside(12, p);
                // Pull toward the centre: hotspots near landmarks.
                p.lerp(this.arena.center, 0.35);
                const type = types[Math.floor(Math.random() * types.length)];
                this.powerups.push({ pos: p, type, spin: Math.random() * 6 });
                this.emit({ type: 'powerupSpawn', kind: type, pos: p });
            }
        }
        for (let k = this.powerups.length - 1; k >= 0; k--) {
            const pu = this.powerups[k];
            pu.spin += dt;
            for (const d of this.dragons) {
                if (!d.alive) continue;
                const rr = 2.5 + d.r;
                if (d.pos.distanceToSquared(pu.pos) < rr * rr) {
                    if (pu.type === 'shield') d.shield = T.shieldTime;
                    else if (pu.type === 'magnet') d.magnet = T.magnetTime;
                    else d.fire = 1;
                    this.emit({ type: 'powerup', d, kind: pu.type });
                    this.powerups.splice(k, 1);
                    break;
                }
            }
        }
    }

    // Find the first enemy bead inside d's fire cone. Returns {o, bead} or null.
    fireTarget(d) {
        const cosA = Math.cos(T.fireAngle * DEG);
        let best = null, bestDist = T.fireRange;
        for (const o of this.dragons) {
            if (o === d || !o.alive || o.protect > 0) continue;
            for (let b = 3; b < o.nBeads; b++) {
                const i = b * 3;
                const dx = o.beads[i] - d.pos.x, dy = o.beads[i + 1] - d.pos.y, dz = o.beads[i + 2] - d.pos.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist > bestDist + o.r) continue;
                if ((dx * d.fwd.x + dy * d.fwd.y + dz * d.fwd.z) / (dist || 1) < cosA) continue;
                best = { o, bead: b }; bestDist = dist;
            }
        }
        return best;
    }

    // Dragonfire: sever the first enemy tail in the cone (spec §6.6).
    breathe(d) {
        if (!d.fire) return;
        d.fire = 0;
        const t = this.fireTarget(d);
        this.emit({ type: 'fire', d, hit: !!t });
        if (!t) return;
        const o = t.o;
        const cutLen = t.bead * o.beadSpacing;
        const newMass = Math.max(T.spawnMass, (cutLen - T.lenBase) / T.lenPerMass);
        const lost = o.mass - newMass;
        if (lost <= 0) return;
        // Drop the severed part as loot along beads past the cut.
        const n = Math.max(1, Math.ceil(lost * T.lootShare / 6));
        const val = lost * T.lootShare / n;
        for (let k = 0; k < n; k++) {
            const b = Math.min(o.nBeads - 1, t.bead + Math.floor((k + Math.random()) / n * (o.nBeads - t.bead))) * 3;
            this.addOrb(o.beads[b], o.beads[b + 1], o.beads[b + 2], val, k % 2 ? o.color : 0xFF9A3C, T.lootTtl);
        }
        o.mass = newMass; o.len = Math.min(o.len, cutLen);
        this.emit({ type: 'sever', d, o, lost });
    }

    // ------------------------------------------------ main step
    step(dt) {
        this.time += dt;
        this.events.length = 0;
        for (const d of this.dragons) {
            if (!d.alive) continue;
            if (d.brain) d.brain.think(this, d, dt);
            this.fly(d, dt);
            if (d.input.fire && d.fire) this.breathe(d);
        }
        for (const d of this.dragons) if (d.alive) d.rebuildBeads();
        this.buildHash();
        this.collide();
        this.updateOrbs(dt);
        this.updatePowerups(dt);
        // Stats bucket (1 s).
        const b = this._bucket;
        for (const d of this.dragons) if (d.alive) { b.ds += dt; if (d === this.player) b.pds += dt; }
        if (this.time - b.t >= 1) {
            this.statWindow.push({ ...b });
            if (this.statWindow.length > 60) this.statWindow.shift();
            this._bucket = { t: this.time, enc: 0, ds: 0, penc: 0, pds: 0 };
        }
    }

    // Mean seconds between encounters over the last minute (spec §2, §4).
    encounterStats() {
        let enc = 0, ds = 0, penc = 0, pds = 0;
        for (const s of this.statWindow) { enc += s.enc; ds += s.ds; penc += s.penc; pds += s.pds; }
        return { all: enc ? ds / enc : Infinity, player: penc ? pds / penc : Infinity };
    }

    leaderboard() {
        return this.dragons.filter((d) => d.alive).sort((a, b) => b.mass - a.mass);
    }
}

function hashCell(x, y, z) {
    return ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) & (HASH_SIZE - 1);
}
