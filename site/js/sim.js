// Wyrm simulation: dragons, flight, tails, orbs, power-ups, collisions.
// Pure game state — no rendering, no DOM — so this module can later run
// unchanged as the authoritative multiplayer server (spec §16). Only
// three.js math classes are used.
import { Vector3, Quaternion, Matrix4 } from 'three';
import { T, lengthFor, radiusFor, tierFor, thrustCap, speedBonus, sizeSpeed } from './tunables.js?v=24';

const DEG = Math.PI / 180;
const PATH_STEP = 0.5;          // m between recorded head positions
const PATH_CAP = 1200;          // ring capacity → 600 m of history
const MAX_BEADS = 900;          // per dragon
const CELL = 4;                 // spatial hash cell (m)
const HASH_SIZE = 16384;        // buckets (power of two)
const MAX_ORBS = 6000;
const MAX_CLOUDS = 12;          // acid clouds alive at once (oldest goes first)
const NET_GRACE = 0.25;         // s before the server enforces a fresh chill or stun on a browser (the news is still in flight)
const PU_WALL_GAP = 30;         // m: drifting power-ups turn back this far from walls and the cloud sea
const PU_SUN_GAP = 20;          // m: …and this far from the sun (its glare would hide them)
const PU_HOME = 0.55;           // × arena radius: …and wander back toward the action past this
// How drifting things wander: re-aim every `every`–`every + span` s, ease
// toward the new heading with τ `tau` s, and turn for home past `home` × R.
const PU_PATH = { every: 3, span: 5, tau: 2, home: PU_HOME };
const PEARL_PATH = { every: 8, span: 8, tau: 4, home: 0.7 };   // long, sweeping curves over more of the sky
const MAX_PEARLS = 8;

const _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3();
const _q1 = new Quaternion(), _m = new Matrix4();
const _a1 = new Vector3(), _a2 = new Vector3(), _a3 = new Vector3();   // wallAssist scratch
const _d1 = new Vector3();                                              // drift scratch
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);

// ---------------------------------------------------------------- arenas
// All boundaries and obstacles are analytic (spec §9): collision is a
// signed-distance test, no meshes.
export function makeArena(key) {
    if (key === 'orb') {
        const R = T.orbRadius;
        return {
            key, name: 'The Orb', kind: 'sphere', gravity: false, radius: R,
            center: new Vector3(0, 0, 0), foodSquashY: 1,
            obstacles: [],
            wallName: 'the glass shell',
        };
    }
    // Open sky: lethal cloud sea below and storm wall around, no roof.
    const R = T.skyRadius;
    return {
        key: 'sky', name: 'Skyhold', kind: 'cylinder', gravity: true, radius: R,
        floor: 0, band: R * 0.6,             // uniform food/spawn sampling height (no ceiling)
        center: new Vector3(0, R * 0.2, 0), foodSquashY: 0.5,
        obstacles: [],
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

// Breath elements (rule elements): what a breath crystal makes you breathe.
// fire burns tails off, ice chills, lightning ('bolt') stuns, acid melts.
export const ELEMENTS = ['fire', 'ice', 'bolt', 'acid'];

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
        this.shield = 0; this.magnet = 0; this.fire = 0; this.breath = 0; this.breathHit = false;
        this.breathLevel = 0; this.breathHits = [];   // charges spent on the breath in progress, ids it has hit
        this.element = 'fire'; this.breathEl = 'fire';  // what the stored charges breathe; the breath in progress
        this.chill = 0; this.stun = 0;                  // s left: slowed by ice, can't steer after lightning
        this.chillAt = 0; this.stunAt = 0; this.acidAcc = 0; this.lastAcid = -9;
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
        this.temp = T.ambientTemp; // body temp 0–100: hotter = faster, bigger thrust tank
        this.heatTarget = this.temp; this.crowd = 0;
        this.thrust = thrustCap(this.temp); this.thrustLocked = false;
        this.wallAssist = false;   // beginner mode (player only)
        // Multiplayer: humans flown from a browser (server side), their
        // latest reported pose, and the speed budget it's checked against.
        this.human = false; this.remote = false; this.net = null;
        this.moveBudget = 0; this.corrected = false;
        this.assisting = 0;        // 0..1, how hard beginner mode is steering
        this.diedAt = 0;
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
    constructor(arenaKey, mode = 'local') {
        this.mode = mode;
        this.orbLog = mode === 'server' ? [] : null;
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
        this.phantoms = [];                       // online: orbs a lodestone reeled in (drawn as beams)
        this.rules = {};                          // per-room overrides of T's rule keys
        this.oFree = []; for (let i = MAX_ORBS - 1; i >= 0; i--) this.oFree.push(i);
        this.orbCount = 0; this.ambientCount = 0; this.oHigh = 0;
        this.powerups = [];
        this.nextPowerup = 10;
        this.clouds = []; this.cloudSeq = 0;      // acid clouds (rule elements)
        this.pearls = [];                         // flaming pearls (rule pearls): { id, pos, vel, … }
        this.pearlRespawns = [];                  // { at, from }: a new pearl is due, away from `from`
        this.pearlId = 0;
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
        this.rampStart = 0;
        this.botRespawns = [];
    }

    emit(e) { this.events.push(e); }

    // ------------------------------------------------ orbs
    addOrb(x, y, z, val, col, ttl) {
        if (!this.oFree.length) return -1;
        const i = this.oFree.pop();
        if (i >= this.oHigh) this.oHigh = i + 1;
        this.ox[i] = x; this.oy[i] = y; this.oz[i] = z;
        this.oval[i] = val; this.ocol[i] = col; this.ottl[i] = ttl;
        this.oalive[i] = 1; this.opull[i] = 0; this.opullT[i] = 0;
        this.orbCount++;
        if (!ttl) this.ambientCount++;
        if (this.orbLog) this.orbLog.push(['a', i, x, y, z, val, col, ttl]);
        return i;
    }
    removeOrb(i) {
        if (!this.oalive[i]) return;
        this.oalive[i] = 0; this.orbCount--;
        if (!this.ottl[i]) this.ambientCount--;
        this.oFree.push(i);
        if (this.orbLog) this.orbLog.push(['d', i]);
    }

    randomPointInside(margin, out) {
        const a = this.arena;
        for (let tries = 0; tries < 50; tries++) {
            if (a.kind === 'sphere') {
                out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).multiplyScalar(a.radius);
            } else {
                const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * a.radius;
                out.set(Math.cos(ang) * rr, a.floor + Math.random() * a.band, Math.sin(ang) * rr);
            }
            if (hazardDist(a, out)[0] > margin) return out;
        }
        return out.copy(a.center);
    }

    // Food is densest at the centre (Gaussian, σ = foodSpread·R) so the
    // middle is rich and dangerous and the outskirts are safe but lean.
    foodPoint(margin, out) {
        const a = this.arena, sig = T.foodSpread * a.radius;
        for (let tries = 0; tries < 30; tries++) {
            out.set(gauss() * sig, gauss() * sig * a.foodSquashY, gauss() * sig).add(a.center);
            if (hazardDist(a, out)[0] > margin) return out;
        }
        return this.randomPointInside(margin, out);
    }

    // Spawn ring: close enough to see the action, far enough to be safe.
    spawnPoint(out) {
        const a = this.arena;
        for (let tries = 0; tries < 30; tries++) {
            const dist = a.radius * (0.25 + Math.random() * 0.3);
            const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
            const s = Math.sqrt(1 - u * u);
            if (a.kind === 'sphere') out.set(s * Math.cos(th), u, s * Math.sin(th)).multiplyScalar(dist);
            else out.set(Math.cos(th) * dist, a.center.y + (Math.random() - 0.5) * a.radius * 0.15, Math.sin(th) * dist);
            out.add(a.kind === 'sphere' ? a.center : _v3.set(0, 0, 0));
            if (hazardDist(a, out)[0] > 15) return out;
        }
        return this.randomPointInside(15, out);
    }

    spawnAmbient(n) {
        const p = new Vector3();
        let made = 0;
        while (made < n) {
            const uniform = Math.random() < T.foodUniformShare;
            if (Math.random() < T.orbClusterShare) {
                if (uniform) this.randomPointInside(8, p); else this.foodPoint(8, p);
                const k = 20 + Math.floor(Math.random() * 21);
                const col = PALETTE[Math.floor(Math.random() * PALETTE.length)];
                for (let j = 0; j < k; j++) {
                    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = 3 * Math.cbrt(Math.random());
                    const s = Math.sqrt(1 - u * u);
                    this.addOrb(p.x + rr * s * Math.cos(th), p.y + rr * u, p.z + rr * s * Math.sin(th), 1, col, 0);
                }
                made += k;
            } else {
                if (uniform) this.randomPointInside(3, p); else this.foodPoint(3, p);
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
    // A rule's value for this world: the room's override, else the tunable.
    rule(k) { const v = this.rules[k]; return v === undefined ? T[k] : v; }

    // Cruise/boost multiplier: heat plus the length reward (rule lengthSpeed),
    // never more than the rule speedCap (×4). Kept on the dragon as d.speedX
    // for the HUD ("1.5×").
    speedMult(d) {
        d.sizeBonus = sizeSpeed(d.mass, this.rule('lengthSpeed'), this.rule('lengthSpeedExp'), this.rule('lengthSpeedMax'), this.rule('lengthSpeedLate'));
        const cap = this.rule('speedCap');
        return (d.speedX = Math.min(cap >= 1 ? cap : Infinity, 1 + speedBonus(d.temp) + d.sizeBonus));
    }

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
            this.spawnPoint(cand);
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
        d.shield = 0; d.magnet = 0; d.fire = 0; d.breath = 0; d.breathHit = false;
        d.breathLevel = 0; d.breathHits.length = 0;
        d.element = d.breathEl = 'fire'; d.chill = d.stun = 0; d.acidAcc = 0;
        d.speed = T.speedCruise; d.boostAcc = 0;
        d.steer.x = d.steer.y = 0; d.bank = 0;
        d.near.clear(); d.lastEncounter.clear();
        d.assisting = 0;
        d.temp = d.heatTarget = T.ambientTemp; d.crowd = 0;
        // Profile perks (rule `perks`): bigger tank, longer reach, a shield or
        // dragonfire to start each life.
        const perks = this.rule('perks') && d.perks ? d.perks : [];
        d.thrustMult = perks.includes('lungs') ? 1.2 : 1;
        d.pickupMult = perks.includes('pull') ? 1.4 : 1;
        if (perks.includes('scales')) d.shield = 6;
        if (perks.includes('ember')) d.fire = 1;
        d.thrust = thrustCap(d.temp) * d.thrustMult; d.thrustLocked = false;
        if (d === this.player) this.rampStart = this.time;   // population ramp restarts each life
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
    // Beginner mode: look ahead along the flight path and, if a wall or the
    // cloud sea is coming, blend the stick toward a glancing escape
    // (reflect off the surface, biased inward). Strong enough near the wall
    // to fully override the player, and it cuts boost / brakes to turn tight.
    wallAssist(d) {
        const a = this.arena, inp = d.input;
        const look = Math.max(20, d.speed * T.assistLook);
        let hit = -1;
        for (let s = 2; s <= look; s += 2) {
            _a1.copy(d.pos).addScaledVector(d.vdir, s);
            if (hazardDist(a, _a1)[0] < d.r + 4) { hit = s; break; }
            _a1.copy(d.pos).addScaledVector(d.fwd, s);
            if (hazardDist(a, _a1)[0] < d.r + 4) { hit = s; break; }
        }
        if (hit < 0) { d.assisting = 0; return; }
        const urgency = 1 - hit / look;
        // Inward normal of the surface we'd hit (numeric gradient).
        const p = _a2.copy(d.pos).addScaledVector(d.fwd, hit), e = 0.5;
        const n = _a3.set(
            hazardDist(a, _a1.set(p.x + e, p.y, p.z))[0] - hazardDist(a, _a1.set(p.x - e, p.y, p.z))[0],
            hazardDist(a, _a1.set(p.x, p.y + e, p.z))[0] - hazardDist(a, _a1.set(p.x, p.y - e, p.z))[0],
            hazardDist(a, _a1.set(p.x, p.y, p.z + e))[0] - hazardDist(a, _a1.set(p.x, p.y, p.z - e))[0]).normalize();
        const dn = d.fwd.dot(n);
        const want = _a1.copy(d.fwd).addScaledVector(n, -2 * Math.min(0, dn) + 0.6).normalize();
        want.applyQuaternion(_q1.copy(d.quat).invert());
        const sx = Math.max(-1, Math.min(1, Math.atan2(want.x, -want.z) / 0.5));
        const sy = Math.max(-1, Math.min(1, Math.atan2(want.y, Math.hypot(want.x, want.z)) / 0.5));
        const w = Math.min(1, urgency * 1.6);
        inp.sx += (sx - inp.sx) * w;
        inp.sy += (sy - inp.sy) * w;
        if (urgency > 0.45) inp.boost = false;
        if (urgency > 0.7) inp.brake = true;
        d.assisting = w;
    }

    // mode: 'local' (solo — the whole game here), 'server' (authoritative
    // room; humans' poses arrive over the network) or 'client' (browser in
    // a room — only your own dragon is flown here, everything else comes
    // from the server).
    fly(d, dt) {
        this.move(d, dt);
        if (this.mode !== 'client') this.upkeep(d, dt);
    }

    move(d, dt) {
        const inp = d.input, a = this.arena;
        // Struck by lightning: the stick goes dead and you fly straight;
        // only the wall assist (for everyone while stunned) may steer.
        // Chilled by ice: slow, no boost, stiff turns.
        const stunned = d.stun > 0, chilled = d.chill > 0;
        if (stunned) { inp.sx = inp.sy = inp.roll = 0; inp.boost = inp.brake = false; }
        if (d.wallAssist || stunned) this.wallAssist(d);
        d.boosting = inp.boost && !inp.brake && !chilled && d.mass >= T.boostMinMass && d.thrust > 0 && !d.thrustLocked;
        d.braking = inp.brake;
        const mode = d.braking ? 'Brake' : d.boosting ? 'Boost' : 'Cruise';
        // Smooth the stick a touch so turns have weight.
        const ks = T.steerTau > 0 ? 1 - Math.exp(-dt / T.steerTau) : 1;
        d.steer.x += (inp.sx - d.steer.x) * ks;
        d.steer.y += (inp.sy - d.steer.y) * ks;
        let sx = d.steer.x, sy = d.steer.y;
        const mag = Math.hypot(sx, sy);
        if (mag > 1) { sx /= mag; sy /= mag; }
        const omega = T['turn' + mode] * DEG * (1 - T.sizeTurnPenalty * Math.min(1, d.mass / 2000)) * (chilled ? T.chillTurn : 1);
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
        // It fades out while you pitch: otherwise a held pull-up (a loop)
        // gets rolled upright at the top and swings you round 180°.
        const pitchHold = Math.max(0, 1 - Math.abs(d.steer.y) / 0.3);
        const rate = (a.gravity ? T.levelRate : (d.isBot || this.assist ? T.assistRate : 0)) * pitchHold;
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

        // Speed.
        let target = T['speed' + mode] * (mode === 'Brake' ? 1 : this.speedMult(d));
        if (a.gravity) target = Math.max(T.speedBrake, target + T.diveBoost * -d.fwd.y);
        if (chilled) target *= T.chillSpeed;
        d.speed += (target - d.speed) * (T.speedTau > 0 ? 1 - Math.exp(-dt / T.speedTau) : 1);
        if (chilled && d.speed > target) d.speed = target;          // the frost bites at once

        // Velocity direction trails the nose → carved turns.
        const kc = T.carveTau > 0 ? 1 - Math.exp(-dt / T.carveTau) : 1;
        d.vdir.lerp(d.fwd, kc).normalize();
        d.pos.addScaledVector(d.vdir, d.speed * dt);

        this.recordPath(d);

        // Cosmetic bank into turns.
        const bt = sx * T.visualBank * DEG;
        d.bank += (bt - d.bank) * (1 - Math.exp(-dt / 0.15));
    }

    // Would flying straight on hit a wall or the cloud sea within the wall
    // assist's look-ahead? (The safe space is convex, so the far end decides.)
    wallAhead(d) {
        _a3.copy(d.pos).addScaledVector(d.vdir, Math.max(20, d.speed * T.assistLook));
        return hazardDist(this.arena, _a3)[0] < d.r + 8;
    }

    // Chill and stun wear off.
    status(d, dt) {
        if (d.chill > 0) d.chill = Math.max(0, d.chill - dt);
        if (d.stun > 0) d.stun = Math.max(0, d.stun - dt);
    }

    // Record a path point every PATH_STEP metres of travel (the tail).
    recordPath(d) {
        let dist = d.pos.distanceTo(d.lastPt);
        if (dist > 60) {                       // teleport (respawn / correction): restart the trail
            d.lastPt.copy(d.pos);
            return;
        }
        while (dist >= PATH_STEP) {
            _v1.subVectors(d.pos, d.lastPt).multiplyScalar(PATH_STEP / dist).add(d.lastPt);
            d.pushPath(_v1.x, _v1.y, _v1.z);
            dist = d.pos.distanceTo(d.lastPt);
        }
    }

    // Multiplayer (server): take a human's reported pose, but never let it
    // move faster than they're allowed to fly (a rolling speed budget that
    // tolerates network bunching). Anything clamped is flagged so the
    // server can correct that player's browser.
    // A chill or stun is enforced here too, so a browser can't ignore it:
    // chilled, the budget is the slowed, boostless one; stunned, only
    // progress along the heading counts and turns are refused (unless a
    // wall is ahead, where the browser's wall assist may steer).
    applyNet(d, dt) {
        const inp = d.input, n = d.net;
        const chilled = d.chill > 0 && this.time - d.chillAt > NET_GRACE;
        const stunned = d.stun > 0 && this.time - d.stunAt > NET_GRACE && !this.wallAhead(d);
        d.boosting = inp.boost && !inp.brake && !chilled && !stunned && d.mass >= T.boostMinMass && d.thrust > 0 && !d.thrustLocked;
        d.braking = inp.brake && !stunned;
        const top = ((d.boosting ? T.speedBoost : T.speedCruise) * this.speedMult(d) + T.diveBoost + 1) * (chilled ? T.chillSpeed : 1);
        d.moveBudget = Math.min(top * 0.5, d.moveBudget + top * dt * 1.15);
        if (n && n.fresh) {
            n.fresh = false;
            const want = _a1.set(n.x, n.y, n.z);
            if (stunned) {
                const along = Math.max(0, _a2.subVectors(want, d.pos).dot(d.vdir));
                _a3.copy(d.pos).addScaledVector(d.vdir, along);
                if (want.distanceTo(_a3) > 1) d.corrected = true;
                want.copy(_a3);
            }
            let dist = want.distanceTo(d.pos);
            if (dist > d.moveBudget) {
                want.sub(d.pos).multiplyScalar(d.moveBudget / dist).add(d.pos);
                dist = d.moveBudget;
                d.corrected = true;
            }
            d.moveBudget -= dist;
            if (dist > 1e-4 && !stunned) d.vdir.subVectors(want, d.pos).normalize();
            d.pos.copy(want);
            _q1.set(n.qx, n.qy, n.qz, n.qw);
            if (_q1.lengthSq() > 0.5 && !stunned) d.quat.copy(_q1).normalize();
            d.updateFrame();
            d.bank = Math.max(-1.2, Math.min(1.2, n.bank || 0));
        }
        d.speed += (Math.min(top, (n && n.speed) || d.speed) - d.speed) * 0.3;
        this.recordPath(d);
    }

    // Thrust, boost cost, growth, timers (not run in the browser in rooms:
    // the server owns them there).
    upkeep(d, dt) {
        // Boost burns mass; half drops behind as orbs (spec §6.5).
        // Thrust tank: boosting drains it; it refills off-boost. Run it dry
        // and it locks until 1.5 s has refilled (no stutter-boosting).
        const cap = thrustCap(d.temp) * (d.thrustMult || 1);
        if (d.boosting) {
            d.thrust = Math.max(0, d.thrust - dt);
            if (d.thrust <= 0) { d.thrustLocked = true; if (d === this.player || d.human) this.emit({ type: 'thrustEmpty', d }); }
        } else {
            d.thrust = Math.min(cap, d.thrust + T.thrustRegen * dt);
            if (d.thrustLocked && d.thrust >= Math.min(1.5, cap)) d.thrustLocked = false;
        }
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
    // safeTip: { id, from } — that dragon's beads from `from` on are a tail
    // tip the caller means to bite, so they don't count as danger.
    tailDanger(p, selfId, pad, safeTip = null) {
        let hit = 0;
        this.queryBeads(p, (i) => {
            const owner = this.bOwner[i];
            if (owner === selfId) return false;
            if (safeTip && owner === safeTip.id && this.bIdx[i] >= safeTip.from) return false;
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
            // Protected, or stunned by lightning: it can't steer, so a body it's
            // carried into doesn't count (an element never kills on its own).
            if (d.protect > 0 || d.stun > 0) continue;
            // Head → other tails. The closest bead touched decides: a tail tip
            // (last biteBeads) is a bite when tailBite is on; anything else kills.
            let killer = null, hitD = Infinity, hitIdx = -1;
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
                if (dd < lethal * lethal) { if (dd < hitD) { hitD = dd; killer = o; hitIdx = this.bIdx[i]; } return false; }
                // Near miss tracking for the player.
                if (d === P || d.human) {
                    const nm = lethal + T.nearMissPad;
                    if (dd < nm * nm && d.speed >= T.speedCruise * 0.9) {
                        const st = d.near.get(owner);
                        if (!st || this.time - st.t > 3) d.near.set(owner, { t: this.time, pending: true });
                    }
                }
                return false;
            });
            if (killer && this.rule('tailBite') && hitIdx >= Math.max(4, killer.nBeads - this.rule('biteBeads'))) {
                this.bite(d, killer, hitIdx);
                killer = null;
            }
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
            if (!a.alive || a.protect > 0 || a.stun > 0) continue;
            for (let j = i + 1; j < ds.length; j++) {
                const b = ds[j];
                if (!b.alive || b.protect > 0 || b.stun > 0) continue;
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
        // Resolve pending near misses for humans (must survive 0.4 s).
        for (const h of this.dragons) {
            if (!h.alive || !(h === P || h.human)) continue;
            for (const [id, st] of h.near) {
                if (st.pending && this.time - st.t > 0.4) {
                    st.pending = false;
                    this.emit({ type: 'nearMiss', d: h, other: this.byId.get(id) });
                }
            }
        }
    }

    // d's head nibbles o's tail tip: o loses those beads' length, d gains
    // biteMult orbs per bead. One bite per 0.5 s; a tip too short to lose
    // anything is just harmless.
    bite(d, o, bead) {
        if (this.time - (d.lastBite || -9) < 0.5) return;
        const n = this.rule('biteBeads');
        const lost = Math.min(Math.max(0, o.mass - T.spawnMass), n * o.beadSpacing / T.lenPerMass);
        if (lost < 0.5) return;
        d.lastBite = this.time;
        o.mass -= lost;
        o.len = lengthFor(o.mass);
        const gain = n * this.rule('biteMult');
        d.mass += gain;
        const i = bead * 3;
        this.emit({ type: 'bite', d, o, gain: Math.round(gain), lost: Math.round(lost), x: o.beads[i], y: o.beads[i + 1], z: o.beads[i + 2], color: o.color });
    }

    kill(d, killer, cause) {
        d.alive = false;
        d.diedAt = this.time;
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
        for (let i = 0, n = this.oHigh; i < n; i++) {
            if (!this.oalive[i]) continue;
            if (this.ottl[i] > 0 && this.opull[i] === 0) {
                this.ottl[i] -= dt;
                if (this.ottl[i] <= 0) { this.ottl[i] = 1e-6; this.removeOrb(i); }
            }
        }
        // Pickup: attract then consume.
        for (const d of this.dragons) {
            if (!d.alive) continue;
            const rad = (d.magnet > 0 ? T.magnetRadius : T.pickupBase * (d.pickupMult || 1)) + d.r;
            const r2 = rad * rad;
            const px = d.pos.x, py = d.pos.y, pz = d.pos.z;
            for (let i = 0, n = this.oHigh; i < n; i++) {
                if (!this.oalive[i] || this.opull[i]) continue;
                const dx = this.ox[i] - px; if (dx > rad || dx < -rad) continue;
                const dy = this.oy[i] - py; if (dy > rad || dy < -rad) continue;
                const dz = this.oz[i] - pz;
                if (dx * dx + dy * dy + dz * dz < r2) { this.opull[i] = d.id; this.opullT[i] = 0; }
            }
        }
        for (let i = 0, n = this.oHigh; i < n; i++) {
            if (!this.oalive[i] || !this.opull[i]) continue;
            const d = this.byId.get(this.opull[i]);
            if (!d || !d.alive) { this.opull[i] = 0; continue; }
            this.opullT[i] += dt;
            // Reel the orb toward the mouth, accelerating. A lodestone's
            // tractor beam starts gentler so the pull reads from 18 m away.
            const mx = d.pos.x + d.fwd.x * d.r, my = d.pos.y + d.fwd.y * d.r, mz = d.pos.z + d.fwd.z * d.r;
            const ex = mx - this.ox[i], ey = my - this.oy[i], ez = mz - this.oz[i];
            const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
            const t = this.opullT[i], beam = d.magnet > 0;
            const step = ((beam ? 16 : 30) + (beam ? 90 : 220) * t + d.speed) * dt;
            if (dist > step) { const k = step / dist; this.ox[i] += ex * k; this.oy[i] += ey * k; this.oz[i] += ez * k; }
            if (dist <= step + 0.3 || t > 0.9) {
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
                if (T.dragonfire) types.push(this.breathCrystal(), this.breathCrystal());
                const p = new Vector3();
                this.foodPoint(PU_WALL_GAP, p);   // hotspots where the food is, but not in the sun or far out
                const c = this.arena.center, dc = _d1.subVectors(p, c).length(), home = this.arena.radius * PU_HOME;
                if (dc < PU_SUN_GAP) p.copy(c).addScaledVector(randomUnit(_d1), PU_SUN_GAP);
                else if (dc > home) p.copy(c).addScaledVector(_d1, home / dc);
                const type = types[Math.floor(Math.random() * types.length)];
                this.powerups.push({ pos: p, type, spin: Math.random() * 6 });
                this.emit({ type: 'powerupSpawn', kind: type, pos: p });
            }
        }
        for (let k = this.powerups.length - 1; k >= 0; k--) {
            const pu = this.powerups[k];
            pu.spin += dt;
            this.drift(pu, this.rule('powerupDrift'), dt, PU_PATH);
            for (const d of this.dragons) {
                if (!d.alive) continue;
                const rr = 2.5 + d.r;
                if (d.pos.distanceToSquared(pu.pos) < rr * rr) {
                    if (pu.type === 'shield') d.shield = T.shieldTime;
                    else if (pu.type === 'magnet') d.magnet = T.magnetTime;
                    else {
                        // Breath charges stack (rule fireCharge), up to fireChargeMax,
                        // and the last crystal's element (rule elements) is what they
                        // breathe. Browsers that only know fire always breathe fire.
                        d.fire = this.rule('fireCharge') ? Math.min(Math.max(1, this.rule('fireChargeMax')), d.fire + 1) : 1;
                        d.element = this.rule('elements') && !d.fireOnly && ELEMENTS.includes(pu.type) ? pu.type : 'fire';
                    }
                    this.emit({ type: 'powerup', d, kind: pu.type, charge: d.fire });
                    this.powerups.splice(k, 1);
                    break;
                }
            }
        }
    }

    // Power-ups (rule powerupDrift, m/s; each one 0.6–1.4× that) and pearls
    // float about: a slow wander that eases toward a new heading every few
    // seconds and turns for home near a wall or the cloud sea, out of the
    // sun's glare, or once it has strayed too far out (path.home).
    drift(t, speed, dt, path) {
        if (!(speed > 0)) return;
        const a = this.arena;
        if (!t.vel) { t.vel = randomUnit(new Vector3()).multiplyScalar(speed); t.aim = new Vector3(); t.aimAt = 0; t.pace = 0.6 + 0.8 * Math.random(); }
        if (this.time >= t.aimAt) {
            randomUnit(t.aim);
            if (a.gravity) t.aim.y *= 0.5;                    // mostly level in Skyhold
            t.aim.normalize();
            t.aimAt = this.time + path.every + Math.random() * path.span;
        }
        const toC = _d1.subVectors(a.center, t.pos), dc = toC.length();
        if (dc > 1e-3) {
            toC.multiplyScalar(1 / dc);
            if (hazardDist(a, t.pos)[0] < PU_WALL_GAP || dc > a.radius * path.home) t.aim.copy(toC);
            else if (dc < PU_SUN_GAP) t.aim.copy(toC).negate();
        }
        // Velocity eases toward the aim: wide, gentle curves.
        const k = Math.min(1, dt / path.tau), v = speed * t.pace;
        t.vel.x += (t.aim.x * v - t.vel.x) * k;
        t.vel.y += (t.aim.y * v - t.vel.y) * k;
        t.vel.z += (t.aim.z * v - t.vel.z) * k;
        t.pos.addScaledVector(t.vel, dt);
    }

    // ------------------------------------------------ flaming pearls
    // A few glowing pearls (rule pearls) drift through the sky on long
    // curves. Catching one is worth pearlMass; a new one appears somewhere
    // else pearlRespawn s later.
    updatePearls(dt) {
        const want = Math.min(MAX_PEARLS, Math.max(0, Math.round(this.rule('pearls'))));
        if (!want) { this.pearls.length = 0; this.pearlRespawns.length = 0; return; }
        for (let i = this.pearlRespawns.length - 1; i >= 0; i--) {
            const r = this.pearlRespawns[i];
            if (r.at <= this.time) { this.pearlRespawns.splice(i, 1); this.addPearl(r.from); }
        }
        while (this.pearls.length + this.pearlRespawns.length < want) this.addPearl(null);
        while (this.pearls.length + this.pearlRespawns.length > want) { if (this.pearlRespawns.length) this.pearlRespawns.pop(); else this.pearls.pop(); }
        const speed = this.rule('pearlDrift');
        for (let k = this.pearls.length - 1; k >= 0; k--) {
            const pl = this.pearls[k];
            this.drift(pl, speed, dt, PEARL_PATH);
            for (const d of this.dragons) {
                if (!d.alive) continue;
                const rr = 3 + d.r;
                if (d.pos.distanceToSquared(pl.pos) >= rr * rr) continue;
                let gain = this.rule('pearlMass');
                if (d.isBot && d.mass > T.botGrowthCapMass) gain *= 0.5;
                d.mass += gain;
                this.emit({ type: 'pearl', d, gain: Math.round(gain), x: pl.pos.x, y: pl.pos.y, z: pl.pos.z });
                this.pearls.splice(k, 1);
                this.pearlRespawns.push({ at: this.time + this.rule('pearlRespawn') * (0.75 + Math.random() * 0.5), from: pl.pos });
                break;
            }
        }
    }

    // A new pearl: away from the walls and the sun, and (after one is
    // caught) the farthest of a few candidates from where that happened.
    addPearl(away) {
        const a = this.arena, p = new Vector3(), c = new Vector3();
        let best = -1;
        for (let n = 0; n < (away ? 6 : 1); n++) {
            for (let tries = 0; tries < 20; tries++) {
                randomUnit(c).y *= a.foodSquashY;
                c.normalize().multiplyScalar(a.radius * (0.2 + 0.45 * Math.random())).add(a.center);
                if (hazardDist(a, c)[0] > 40) break;
            }
            const score = away ? c.distanceTo(away) : 0;
            if (score > best) { best = score; p.copy(c); }
        }
        this.pearls.push({ id: ++this.pearlId, pos: p });
    }

    // A breath crystal: fire, or (rule elements) for a share of them ice,
    // lightning or acid.
    breathCrystal() {
        if (!this.rule('elements') || !(Math.random() < T.elementShare)) return 'fire';
        return ELEMENTS[1 + Math.floor(Math.random() * 3)];
    }

    // How big a breath of `lv` stored charges is (rule fireCharge). One
    // charge is the classic dragonfire; each extra charge adds a share of
    // its range, cone half-angle and time, and (every other charge) one
    // more tail it can cut. With the rule off every breath is level 1.
    // rs and ts are the range and time scales the other elements use.
    breathStats(lv) {
        const k = this.rule('fireCharge') ? Math.max(0, Math.min(this.rule('fireChargeMax'), lv) - 1) : 0;
        const rs = 1 + T.fireChargeRange * k, ts = 1 + T.fireChargeTime * k;
        return {
            k, rs, ts,
            range: T.fireRange * rs,
            angle: Math.min(80, T.fireAngle * (1 + T.fireChargeAngle * k)),
            time: T.fireTime * ts,
            cuts: 1 + Math.floor(T.fireChargeCuts * k + 1e-6),
        };
    }

    // Find the first enemy bead inside d's fire cone, sized for a breath
    // of `lv` charges (default: the one in progress, else what d holds).
    // Dragons in `skip` (ids) were already cut by this breath. Returns
    // {o, bead} or null.
    fireTarget(d, lv = d.breath > 0 ? d.breathLevel : d.fire, skip = null) {
        const st = this.breathStats(lv);
        const cosA = Math.cos(st.angle * DEG);
        let best = null, bestDist = st.range;
        for (const o of this.dragons) {
            if (o === d || !o.alive || o.protect > 0 || (skip && skip.includes(o.id))) continue;
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

    // Dragonfire (spec §6.6): one breath spends every stored charge, and
    // more charges make it reach farther, spread wider and last longer
    // (breathStats). Each enemy tail that enters the cone is cut once, up
    // to the breath's cut count, then the flame dies down; everything past
    // a cut burns into loot. Heads can't be hit.
    // With rule elements the charges breathe the last crystal's element:
    // ice chills everyone in the cone, lightning strikes the first dragon
    // in line (crackling for half the time until something is in reach)
    // and acid spits a cloud. None of them kills; spawn protection blocks
    // them all and, as with fire, the Ember Shield doesn't.
    updateBreath(d, dt) {
        if (d.input.fire && d.fire && d.breath <= 0 && !(d.stun > 0)) {
            const el = this.rule('elements') && ELEMENTS.includes(d.element) ? d.element : 'fire';
            d.breathLevel = d.fire; d.fire = 0; d.breathEl = el;
            const st = this.breathStats(d.breathLevel);
            d.breath = el === 'bolt' ? st.time / 2 : el === 'acid' ? 0.4 : st.time;
            d.breathHit = false; d.breathHits.length = 0;
            this.emit({ type: 'fireStart', d, lv: d.breathLevel, el });
            if (el === 'acid') { this.spitAcid(d, st); d.breathHit = true; }
        }
        if (d.breath <= 0) return;
        d.breath -= dt;
        const st = this.breathStats(d.breathLevel);
        if (d.breathEl === 'ice') this.frost(d, st);
        else if (d.breathEl === 'bolt') { if (!d.breathHit && this.strike(d, st)) { d.breathHit = true; d.breath = Math.min(d.breath, 0.15); } }
        else if (d.breathEl === 'fire') {
            const t = d.breathHits.length < st.cuts ? this.fireTarget(d, d.breathLevel, d.breathHits) : null;
            if (t) {
                this.sever(d, t);
                d.breathHits.push(t.o.id); d.breathHit = true;
                if (d.breathHits.length >= st.cuts) d.breath = Math.min(d.breath, 0.25);
            }
        }
        if (d.breath <= 0) {
            if (!d.breathHit) this.emit({ type: 'fireMiss', d, el: d.breathEl });
            d.breathHit = false; d.breath = 0;
        }
    }

    // The nearest point (head or body) of another dragon within `range` of
    // p, inside d's forward cone of half-angle `angle` (deg; 0 = any
    // direction), skipping protected dragons and those in `skip`. Returns
    // { o, x, y, z } or null.
    nearestPart(d, p, range, angle, skip) {
        const cosA = angle ? Math.cos(angle * DEG) : -2, f = d.fwd;
        let best = null, bd = range;
        for (const o of this.dragons) {
            if (o === d || !o.alive || o.protect > 0 || skip.includes(o)) continue;
            if (o.pos.distanceTo(p) > bd + o.len + o.r) continue;              // none of it can be that close
            for (let b = -1; b < o.nBeads; b++) {
                const x = b < 0 ? o.pos.x : o.beads[b * 3], y = b < 0 ? o.pos.y : o.beads[b * 3 + 1], z = b < 0 ? o.pos.z : o.beads[b * 3 + 2];
                const dx = x - p.x, dy = y - p.y, dz = z - p.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist - o.r > bd) continue;
                if (angle && (dx * f.x + dy * f.y + dz * f.z) / (dist || 1) < cosA) continue;
                best = { o, x, y, z }; bd = Math.max(0, dist - o.r);
            }
        }
        return best;
    }

    // Ice: every dragon with any part in the frost cone is chilled (slow,
    // no boost, stiff turns) for chillTime × the breath's time scale.
    frost(d, st) {
        const t = T.chillTime * st.ts, cosA = Math.cos(st.angle * DEG), f = d.fwd;
        for (const o of this.dragons) {
            if (o === d || !o.alive || o.protect > 0 || o.pos.distanceTo(d.pos) > st.range + o.len + o.r) continue;
            for (let b = -1; b < o.nBeads; b += 2) {
                const x = b < 0 ? o.pos.x : o.beads[b * 3], y = b < 0 ? o.pos.y : o.beads[b * 3 + 1], z = b < 0 ? o.pos.z : o.beads[b * 3 + 2];
                const dx = x - d.pos.x, dy = y - d.pos.y, dz = z - d.pos.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist > st.range + o.r || (dx * f.x + dy * f.y + dz * f.z) / (dist || 1) < cosA) continue;
                if (!(o.chill > 0)) o.chillAt = this.time;
                o.chill = Math.max(o.chill, t);
                if (!d.breathHits.includes(o.id)) { d.breathHits.push(o.id); d.breathHit = true; this.emit({ type: 'chill', d, o, t }); }
                break;
            }
        }
    }

    // Lightning: a long, narrow bolt (boltRange × the breath's range)
    // strikes the first dragon in line, then jumps to the nearest
    // unstruck dragon within boltChain m, 1 + one per two extra charges
    // times (at most boltChainMax). Each is stunned for stunTime × the
    // time scale and sheds boltShed × that of its mass as food.
    // Returns the dragons struck, or null.
    strike(d, st) {
        const first = this.nearestPart(d, d.pos, st.range * T.boltRange, T.boltAngle * st.angle / T.fireAngle, []);
        if (!first) return null;
        const hits = [first], struck = [first.o];
        const chains = Math.min(T.boltChainMax, 1 + Math.floor(st.k / 2));
        for (let c = 0; c < chains; c++) {
            const next = this.nearestPart(d, hits[hits.length - 1], T.boltChain, 0, struck);
            if (!next) break;
            hits.push(next); struck.push(next.o);
        }
        const stun = T.stunTime * st.ts, m = d.r * 2;
        const pts = [d.pos.x + d.fwd.x * m, d.pos.y + d.fwd.y * m, d.pos.z + d.fwd.z * m];
        for (const h of hits) {
            const o = h.o;
            if (!(o.stun > 0)) o.stunAt = this.time;
            o.stun = Math.max(o.stun, stun);
            const shed = Math.min(Math.max(0, o.mass - T.spawnMass), Math.max(2, o.mass * T.boltShed * st.ts));
            if (shed > 0.5) { o.mass -= shed; this.scatter(h.x, h.y, h.z, shed * T.lootShare, o.color, 0xD9C2FF); }
            d.breathHits.push(o.id);
            pts.push(h.x, h.y, h.z);
        }
        this.emit({ type: 'bolt', d, hits: struck, pts, stun });
        return struck;
    }

    // Food in a little burst around a point: `total` mass in orbs of about 3.
    scatter(x, y, z, total, c1, c2) {
        const n = Math.max(1, Math.ceil(total / 3)), val = total / n;
        for (let k = 0; k < n; k++) {
            this.addOrb(x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3, z + (Math.random() - 0.5) * 3, val, k % 2 ? c1 : c2, T.lootTtl);
        }
    }

    // Acid: spit a cloud ahead (acidRadius × the range scale, lingering
    // acidTime × the time scale). It sails on a little, then hangs there.
    spitAcid(d, st) {
        const r = T.acidRadius * st.rs, life = T.acidTime * st.ts, ahead = d.r * 2 + r, v = d.speed + 10;
        this.clouds.push({ id: ++this.cloudSeq, x: d.pos.x + d.fwd.x * ahead, y: d.pos.y + d.fwd.y * ahead, z: d.pos.z + d.fwd.z * ahead,
            vx: d.fwd.x * v, vy: d.fwd.y * v, vz: d.fwd.z * v, r, ttl: life, life, owner: d.id, rate: T.acidRate * st.ts });
        if (this.clouds.length > MAX_CLOUDS) this.clouds.shift();
    }

    // Acid clouds drift to a stop and fade. Any dragon but the spitter with
    // its head or body inside melts `rate` mass/s off its tail, which drops
    // as food where the acid touches it. Never below spawn size.
    updateClouds(dt) {
        const k = Math.exp(-dt / 0.5);
        for (let i = this.clouds.length - 1; i >= 0; i--) {
            const c = this.clouds[i];
            c.ttl -= dt;
            if (c.ttl <= 0) { this.clouds.splice(i, 1); continue; }
            c.vx *= k; c.vy *= k; c.vz *= k;
            _v1.set(c.x + c.vx * dt, c.y + c.vy * dt, c.z + c.vz * dt);
            if (hazardDist(this.arena, _v1)[0] > c.r * 0.5) { c.x = _v1.x; c.y = _v1.y; c.z = _v1.z; } else c.vx = c.vy = c.vz = 0;
            for (const o of this.dragons) {
                if (!o.alive || o.id === c.owner || o.protect > 0) continue;
                const touch = this.acidTouch(c, o);
                if (touch < -1) continue;
                const lost = Math.min(c.rate * dt, Math.max(0, o.mass - T.spawnMass));
                if (lost <= 0) continue;
                o.mass -= lost;
                o.acidAcc += lost * T.lootShare;
                const x = touch < 0 ? o.pos.x : o.beads[touch * 3], y = touch < 0 ? o.pos.y : o.beads[touch * 3 + 1], z = touch < 0 ? o.pos.z : o.beads[touch * 3 + 2];
                while (o.acidAcc >= 1.5) {
                    o.acidAcc -= 1.5;
                    this.addOrb(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, z + (Math.random() - 0.5) * 2, 1.5, o.color, T.lootTtl);
                }
                if (this.time - o.lastAcid > 1.5) { o.lastAcid = this.time; this.emit({ type: 'acid', d: this.byId.get(c.owner) || null, o }); }
            }
        }
    }

    // Which part of o is inside cloud c: −1 the head, a bead index, or −2 none.
    acidTouch(c, o) {
        const dx0 = o.pos.x - c.x, dy0 = o.pos.y - c.y, dz0 = o.pos.z - c.z, rr = c.r + o.r * 0.5;
        const d0 = dx0 * dx0 + dy0 * dy0 + dz0 * dz0;
        if (d0 > (rr + o.len) ** 2) return -2;
        if (d0 < rr * rr) return -1;
        for (let b = 0; b < o.nBeads; b += 2) {
            const dx = o.beads[b * 3] - c.x, dy = o.beads[b * 3 + 1] - c.y, dz = o.beads[b * 3 + 2] - c.z;
            if (dx * dx + dy * dy + dz * dz < rr * rr) return b;
        }
        return -2;
    }

    // Is p in (or within pad of) an acid cloud that would hurt dragon `selfId`? Bots steer clear.
    inAcid(p, selfId, pad = 0) {
        for (const c of this.clouds) {
            if (c.owner === selfId) continue;
            const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z, rr = c.r + pad;
            if (dx * dx + dy * dy + dz * dz < rr * rr) return true;
        }
        return false;
    }

    sever(d, t) {
        const o = t.o;
        const cutLen = t.bead * o.beadSpacing;
        const newMass = Math.max(T.spawnMass, (cutLen - T.lenBase) / T.lenPerMass);
        const lost = o.mass - newMass;
        if (lost <= 0) return;
        // Burning segment (for the renderer) + loot along it.
        const burn = [];
        for (let b = t.bead; b < o.nBeads; b += 2) burn.push(o.beads[b * 3], o.beads[b * 3 + 1], o.beads[b * 3 + 2]);
        const n = Math.max(1, Math.ceil(lost * T.lootShare / 6));
        const val = lost * T.lootShare / n;
        for (let k = 0; k < n; k++) {
            const b = Math.min(o.nBeads - 1, t.bead + Math.floor((k + Math.random()) / n * (o.nBeads - t.bead))) * 3;
            this.addOrb(o.beads[b], o.beads[b + 1], o.beads[b + 2], val, k % 2 ? o.color : 0xFF9A3C, T.lootTtl);
        }
        o.mass = newMass; o.len = Math.min(o.len, cutLen);
        this.emit({ type: 'sever', d, o, lost, burn, color: o.color });
    }

    // Body temp: the sun at the arena centre and crowds of dragons heat
    // you up; the cold outskirts cool you down (spec: reward the centre).
    updateHeat(d, dt) {
        const a = this.arena;
        const sunR = T.sunRadius * a.radius;
        const dist = d.pos.distanceTo(a.center);
        let target = T.ambientTemp + (T.sunHeat - T.ambientTemp) * Math.exp(-((dist / sunR) ** 2));
        let n = 0;
        const cr2 = T.crowdRadius * T.crowdRadius;
        for (const o of this.dragons) if (o !== d && o.alive && o.pos.distanceToSquared(d.pos) < cr2) n++;
        target = Math.min(100, target + T.crowdHeat * Math.min(1, n / T.crowdFull));
        const tau = target > d.temp ? T.tempRiseTau : T.tempFallTau;
        d.temp += (target - d.temp) * (1 - Math.exp(-dt / Math.max(0.05, tau)));
        d.heatTarget = target; d.crowd = n;
    }

    // ------------------------------------------------ main step
    step(dt) {
        this.time += dt;
        this.events.length = 0;
        const client = this.mode === 'client';
        for (const d of this.dragons) {
            if (!d.alive) continue;
            if (client) { if (d === this.player) { this.fly(d, dt); this.status(d, dt); } continue; }   // the rest arrive in snapshots
            if (d.brain) d.brain.think(this, d, dt);
            this.updateHeat(d, dt);
            if (d.remote) { this.applyNet(d, dt); this.upkeep(d, dt); }
            else this.fly(d, dt);
            this.updateBreath(d, dt);
            this.status(d, dt);
        }
        for (const d of this.dragons) if (d.alive) d.rebuildBeads();
        if (client) return;
        this.buildHash();
        this.collide();
        this.updateOrbs(dt);
        this.updatePowerups(dt);
        if (this.clouds.length) this.updateClouds(dt);
        this.updatePearls(dt);
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

function randomUnit(out) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    return out.set(s * Math.cos(th), u, s * Math.sin(th));
}

function gauss() {
    let u = 0;
    while (u === 0) u = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function hashCell(x, y, z) {
    return ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) & (HASH_SIZE - 1);
}
