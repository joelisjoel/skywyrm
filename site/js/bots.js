// Bot pilots (spec §6.8). Bots produce the same input struct a human
// does — the sim treats them identically — so they double as load and
// balance testers. Think at ~10 Hz; steer toward the chosen direction
// every step.
import { Vector3, Quaternion } from 'three';
import { T } from './tunables.js?v=15';
import { Dragon, hazardDist } from './sim.js?v=15';

const _v = new Vector3(), _p = new Vector3(), _q = new Quaternion();
const DEG = Math.PI / 180;

// Personalities (rule botMoods) — how each bot likes to play:
//   grazer     farms the quiet outer sky, never hunts, flees big dragons
//   sunbather  feeds near the sun and snaps at easy targets (the classic bot)
//   hunter     stalks neighbours: cuts smaller ones off, nibbles bigger ones' tails
//   kingslayer goes after whoever is #1
export const MOODS = ['grazer', 'sunbather', 'hunter', 'kingslayer'];
export const MOOD_ICON = { grazer: '🌿', sunbather: '☀', hunter: '🗡', kingslayer: '⚔' };
const MOOD_HUNT = { grazer: 0, sunbather: 0.8, hunter: 1.6, kingslayer: 1 };

// Bot aggression 0..1: starts at aggrStart when the world wakes and rises
// to full over aggrRampMin minutes, capped by botAggrMax (beginner rooms).
export function aggression(world) {
    const age = world.time - (world.ageStart ?? world.rampStart ?? 0);
    const k = Math.min(1, Math.max(0, age / (world.rule('aggrRampMin') * 60)));
    const a0 = world.rule('aggrStart');
    return Math.min(world.rule('botAggrMax'), a0 + (1 - a0) * k);
}

// New bots lean hunter / kingslayer as aggression rises.
function pickMood(world) {
    if (!world.rule('botMoods')) return 'sunbather';
    const A = aggression(world);
    const w = [0.4 - 0.25 * A, 0.4, 0.12 + 0.4 * A, 0.03 + 0.17 * A];
    let r = Math.random() * w.reduce((s, x) => s + x, 0);
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return MOODS[i]; }
    return 'sunbather';
}

const NAMES = ['Cinderwing', 'Vex', 'Mothwing', 'Ashcoil', 'Glimmerfang', 'Nyx', 'Emberjaw',
    'Stormtail', 'Quill', 'Saffron', 'Brimscale', 'Tidewyrm', 'Frostcoil', 'Rook', 'Lumen',
    'Obsidian', 'Kestrel', 'Pyra', 'Wisp', 'Thorn', 'Sable', 'Zephyr', 'Morrow', 'Vesper',
    'Coral', 'Jinx', 'Hollow', 'Solace', 'Drift', 'Ignis', 'Rune', 'Marrow', 'Halcyon', 'Fable',
    'Scorch', 'Umbra', 'Nettle', 'Azura', 'Grim', 'Tansy', 'Ember', 'Onyx', 'Sorrel', 'Blight'];

// Feeler directions in local space (forward = −Z): straight ahead, then
// rings at 30° and 65° off the nose.
const FEELER_DIRS = [new Vector3(0, 0, -1)];
for (const ring of [30, 65]) {
    for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, off = ring * DEG;
        FEELER_DIRS.push(new Vector3(Math.sin(off) * Math.cos(a), Math.sin(off) * Math.sin(a), -Math.cos(off)).normalize());
    }
}
const _dir = new Vector3();

class Brain {
    constructor(mood = 'sunbather') {
        this.mood = mood;
        this.biteTip = null;                              // { id, from } while going for a tail tip
        this.desired = new Vector3(0, 0, -1);
        this.nextThink = 0;
        this.skill = 0.6 + Math.random() * 0.4;          // reaction quality
        this.aggr = Math.random();                        // personal hunter-ness
        this.goal = null; this.goalUntil = 0;
        this.boost = false; this.brake = false;
        this.evadeUntil = 0;
    }

    think(world, d, dt) {
        worldRef = world;
        if (world.time >= this.nextThink) {
            this.nextThink = world.time + 0.08 + (1 - this.skill) * 0.2;
            this.decide(world, d);
        }
        // Convert desired world direction into stick input.
        _q.copy(d.quat).invert();
        const l = _v.copy(this.desired).applyQuaternion(_q);
        const yawErr = Math.atan2(l.x, -l.z);
        const pitchErr = Math.atan2(l.y, Math.hypot(l.x, l.z));
        let sx = Math.max(-1, Math.min(1, yawErr / 0.5));
        let sy = Math.max(-1, Math.min(1, pitchErr / 0.5));
        const m = Math.hypot(sx, sy);
        if (m > 1) { sx /= m; sy /= m; }
        d.input.sx = sx; d.input.sy = sy; d.input.roll = 0;
        d.input.boost = this.boost; d.input.brake = this.brake;
        d.input.fire = false;
        if (d.fire && world.fireTarget(d)) d.input.fire = true;
    }

    // Clear distance along a straight probe in `dir` before the first
    // hazard: walls, tails, or where a nearby head will be by then.
    clearance(world, d, dir, near, look) {
        const tip = this.biteTip;
        const pad = d.r + 1.0;
        for (let s = 1.2; s <= look; s += 1.2) {
            _p.copy(d.pos).addScaledVector(dir, s);
            if (hazardDist(world.arena, _p)[0] < 2 + d.r) return s;
            if (world.tailDanger(_p, d.id, pad, tip)) return s;
            const t = s / Math.max(6, d.speed);
            for (const o of near) {
                const rr = o.r + pad + 0.8;
                const hx = o.pos.x + o.vdir.x * o.speed * t - _p.x;
                const hy = o.pos.y + o.vdir.y * o.speed * t - _p.y;
                const hz = o.pos.z + o.vdir.z * o.speed * t - _p.z;
                if (hx * hx + hy * hy + hz * hz < rr * rr) return s;
            }
        }
        return look;
    }

    decide(world, d) {
        const a = world.arena;
        this.boost = false; this.brake = false;
        const near = [];
        for (const o of world.dragons) {
            if (o !== d && o.alive && o.protect <= 0 && o.pos.distanceToSquared(d.pos) < 900) near.push(o);
        }

        // 1) Choose what we want: flee, hunt, feed, or wander.
        let want = null;
        const moods = world.rule('botMoods'), A = moods ? aggression(world) : 0;
        const hunt = T.botAggression * (0.3 + this.aggr) * (moods ? MOOD_HUNT[this.mood] * (0.35 + 0.9 * A) : 1);
        this.biteTip = null;
        if (moods && this.mood === 'grazer') want = this.flee(world, d);
        if (!want && moods && (this.mood === 'hunter' || this.mood === 'kingslayer')) want = this.stalk(world, d, A, hunt);
        if (want) { /* fleeing or stalking */ }
        else if (this.goal && this.goal.kind === 'prey' && world.time < this.goalUntil && this.goal.o.alive) {
            want = this.preyDir(d, this.goal.o);
        } else if (Math.random() < hunt * 0.6) {
            let prey = null, pd = 45;
            for (const o of world.dragons) {
                if (o === d || !o.alive || o.protect > 0) continue;
                // Gentle bots: leave a brand-new player alone for a while.
                if (o === world.player && world.time - o.bornAt < world.gentleTime) continue;
                const dist = o.pos.distanceTo(d.pos);
                if (dist < pd && _v.subVectors(o.pos, d.pos).dot(d.fwd) > 0) { prey = o; pd = dist; }
            }
            if (prey) {
                this.goal = { kind: 'prey', o: prey };
                this.goalUntil = world.time + 1.2;
                want = this.preyDir(d, prey);
                this.boost = pd < 28 && d.mass > 40 && Math.random() < hunt;
            }
        }
        if (!want) {
            if (!this.goal || this.goal.kind === 'prey' || world.time > this.goalUntil ||
                (this.goal.kind === 'orb' && (!world.oalive[this.goal.i] || world.opull[this.goal.i]))) {
                this.pickFood(world, d, moods);
            }
            want = this.goalDir(d).clone();
        }
        // Pre-avoid the boundary.
        _p.copy(d.pos).addScaledVector(d.fwd, 14);
        if (hazardDist(a, _p)[0] < 6) want.lerp(_v.copy(a.center).sub(d.pos).normalize(), 0.6).normalize();

        // 2) Avoid: the straight path, the turn toward `want`, and `want`
        // itself must all be clear; otherwise take the feeler with the most
        // clear space (sticking with the previous escape unless clearly worse).
        let look = (7 + d.speed * 0.55) * (0.8 + 0.3 * this.skill);
        // Going for a bite: the rest of that tail lies beyond the tip, so
        // only hazards before the tip matter.
        if (this.biteTip) look = Math.max(3, Math.min(look, this.tipDist + 0.5));
        const mid = _v.copy(d.fwd).add(want).normalize().clone();
        const cFwd = this.clearance(world, d, d.fwd, near, look);
        const cMid = this.clearance(world, d, mid, near, look);
        const cWant = this.clearance(world, d, want, near, look);
        if (Math.min(cFwd, cMid, cWant) >= look) { this.desired.copy(want); return; }
        this.nextThink = world.time + 0.05;
        const score = (dir, c) => c / look + 0.15 * dir.dot(want) + 0.25 * dir.dot(this.desired);
        let best = want, bestScore = score(want, Math.min(cWant, cMid));
        const prev = this.desired.clone();
        const cPrev = this.clearance(world, d, prev, near, look);
        const sPrev = score(prev, cPrev) + 0.1;
        if (sPrev > bestScore) { best = prev; bestScore = sPrev; }
        for (let k = 0; k < FEELER_DIRS.length; k++) {
            const dir = _dir.copy(FEELER_DIRS[k]).applyQuaternion(d.quat).clone();
            const sc = score(dir, this.clearance(world, d, dir, near, look));
            if (sc > bestScore) { bestScore = sc; best = dir; }
        }
        this.desired.copy(best);
        // Tight spot: brake for the smaller turn radius.
        this.brake = cFwd < 7 && best.dot(d.fwd) < 0.9;
        if (this.brake || cFwd < look) this.boost = false;
    }

    // Grazers: a bigger dragon closing in → turn away and run.
    flee(world, d) {
        for (const o of world.dragons) {
            if (o === d || !o.alive || o.mass < d.mass * 1.3) continue;
            _v.subVectors(d.pos, o.pos);
            const dist = _v.length();
            if (dist > 26 || _v.dot(o.vdir) < dist * 0.4) continue;
            this.boost = dist < 16 && !d.thrustLocked;
            return _v.normalize().add(_p.copy(d.fwd).multiplyScalar(0.5)).normalize().clone();
        }
        return null;
    }

    // Hunters and kingslayers pick a target and hold it for a while:
    // cut smaller dragons off; nibble the tails of bigger ones.
    stalk(world, d, A, hunt) {
        let o = this.goal && this.goal.kind === 'prey' && world.time < this.goalUntil && this.goal.o.alive ? this.goal.o : null;
        if (!o && Math.random() < 0.25 + 0.6 * A) {
            if (this.mood === 'kingslayer') {
                const king = world.leaderboard()[0];
                if (king && king !== d && king.protect <= 0) o = king;
            } else {
                let best = 0;
                for (const c of world.dragons) {
                    if (c === d || !c.alive || c.protect > 0) continue;
                    if (c === world.player && world.time - c.bornAt < world.gentleTime) continue;
                    const dist = c.pos.distanceTo(d.pos);
                    if (dist > 60) continue;
                    const ahead = _v.subVectors(c.pos, d.pos).dot(d.fwd) > 0 ? 1.5 : 0.7;
                    const sc = ahead * (c.mass < d.mass ? 1.5 : world.rule('tailBite') ? 1.3 : 0.8) / (dist + 10);
                    if (sc > best) { best = sc; o = c; }
                }
            }
            if (o) { this.goal = { kind: 'prey', o }; this.goalUntil = world.time + 2.5 + 3 * A; }
        }
        if (!o) return null;
        const dist = o.pos.distanceTo(d.pos);
        if (this.mood === 'kingslayer' && dist > 90) return _p.copy(o.pos).sub(d.pos).normalize().clone();   // travel to the king
        // Bigger than us: go for the edible tail tip (if that rule is on).
        if (o.mass > d.mass * 1.2 && world.rule('tailBite') && o.nBeads > 8) {
            const n = world.rule('biteBeads');
            this.biteTip = { id: o.id, from: Math.max(4, o.nBeads - n + 1) };
            // Pure pursuit of the tip (it retreats along the tail), boosting to close in.
            const i = (o.nBeads - 1) * 3;
            _p.set(o.beads[i], o.beads[i + 1], o.beads[i + 2]);
            this.tipDist = _p.distanceTo(d.pos);
            this.boost = this.tipDist < 40 && !d.thrustLocked && d.mass > 18 && Math.random() < 0.5 + hunt;
            return _p.sub(d.pos).normalize().clone();
        }
        this.boost = dist < 32 && d.mass > 25 && !d.thrustLocked && Math.random() < hunt * (0.5 + A);
        return this.preyDir(d, o);
    }

    preyDir(d, o) {
        const dist = o.pos.distanceTo(d.pos);
        return _p.copy(o.pos).addScaledVector(o.fwd, 6 + dist * 0.35).sub(d.pos).normalize().clone();
    }

    pickFood(world, d, moods) {
        this.goal = null;
        const a = world.arena;
        // Grazers like the quiet outer sky; sunbathers the crowded centre.
        const where = (x, y, z) => {
            if (!moods) return 1;
            const rr = _v.set(x, y, z).distanceTo(a.center) / a.radius;
            if (this.mood === 'grazer') return rr > 0.45 ? 1.4 : 0.25;
            if (this.mood === 'sunbather') return 1 + 1.5 * Math.max(0, 1 - rr);
            return 1;
        };
        let best = -1, bestScore = 0;
        for (let s = 0; s < 80; s++) {
            const i = Math.floor(Math.random() * world.oHigh);
            if (!world.oalive[i] || world.opull[i]) continue;
            _p.set(world.ox[i], world.oy[i], world.oz[i]);
            const dist = _p.distanceTo(d.pos);
            const facing = _v.subVectors(_p, d.pos).normalize().dot(d.fwd);
            const score = world.oval[i] / (dist + 6) * (facing > -0.2 ? 1 : 0.35) * where(world.ox[i], world.oy[i], world.oz[i]);
            if (score > bestScore) { bestScore = score; best = i; }
        }
        if (best >= 0) { this.goal = { kind: 'orb', i: best }; this.goalUntil = world.time + 2.5; return; }
        const p = new Vector3();
        if (moods && this.mood === 'grazer') {
            // A random spot out in the quiet ring (well inside the walls).
            p.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).normalize()
                .multiplyScalar(a.radius * (0.55 + Math.random() * 0.2)).add(a.center);
            if (hazardDist(a, p)[0] < 15) world.foodPoint(10, p);
        } else world.foodPoint(10, p);
        this.goal = { kind: 'point', p };
        this.goalUntil = world.time + 3;
    }

    goalDir(d) {
        const g = this.goal;
        if (!g) return d.fwd;
        if (g.kind === 'prey') return _p.copy(g.o.pos).sub(d.pos).normalize();
        if (g.kind === 'orb') return _p.set(worldRef.ox[g.i], worldRef.oy[g.i], worldRef.oz[g.i]).sub(d.pos).normalize();
        return _p.copy(g.p).sub(d.pos).normalize();
    }
}

let worldRef = null;

function botName(world) {
    const used = new Set(world.dragons.map((d) => d.name));
    for (let k = 0; k < 30; k++) {
        const n = NAMES[Math.floor(Math.random() * NAMES.length)];
        if (!used.has(n)) return n;
    }
    return NAMES[Math.floor(Math.random() * NAMES.length)] + Math.floor(Math.random() * 90 + 10);
}

function spawnBot(world, mass) {
    const d = new Dragon(botName(world), true);
    d.brain = new Brain(pickMood(world));
    d.mood = d.brain.mood;
    world.spawn(d, mass);
    return d;
}

function randomBotMass(initial) {
    const r = Math.random();
    if (initial) return r < 0.6 ? 10 + Math.random() * 60 : r < 0.9 ? 70 + Math.random() * 150 : 220 + Math.random() * 250;
    return r < 0.8 ? 10 + Math.random() * 30 : 40 + Math.random() * 80;
}

// How many other dragons there should be right now: popStart when you
// spawn, one more every popRampSec, up to popMax. The ramp restarts each
// life so every run eases in. The menu's attract mode shows a full sky.
export function targetBots(world) {
    if (world.botTarget) return world.botTarget();   // rooms set their own rule
    const p = world.player;
    if (!p) return Math.round(T.popMax);
    const t = (p.alive ? world.time : p.diedAt) - world.rampStart;
    return Math.max(0, Math.min(Math.round(T.popMax), Math.round(T.popStart) + Math.floor(Math.max(0, t) / T.popRampSec)));
}

export function managePopulation(world, initial = false) {
    worldRef = world;
    const want = targetBots(world);
    let alive = world.dragons.filter((d) => d.isBot).length;
    // Scheduled respawns of eaten bots.
    world.botRespawns.sort((a, b) => a - b);
    while (world.botRespawns.length && (world.botRespawns[0] <= world.time || initial)) {
        world.botRespawns.shift();
        if (alive < want) { spawnBot(world, randomBotMass(false)); alive++; }
    }
    while (world.botRespawns.length && alive + world.botRespawns.length > want) world.botRespawns.pop();
    while (alive + world.botRespawns.length < want) { spawnBot(world, randomBotMass(initial)); alive++; }
    // Too many (new life, or slider lowered): retire the ones farthest from
    // you, so nobody vanishes in front of you.
    if (alive > want) {
        const p = world.player;
        const bots = world.dragons.filter((d) => d.isBot)
            .sort((a, b) => (p ? b.pos.distanceToSquared(p.pos) - a.pos.distanceToSquared(p.pos) : a.mass - b.mass));
        for (let k = 0; k < alive - want && k < bots.length; k++) world.removeDragon(bots[k]);
    }
}
