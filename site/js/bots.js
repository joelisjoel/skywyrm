// Bot pilots (spec §6.8). Bots produce the same input struct a human
// does — the sim treats them identically — so they double as load and
// balance testers. Think at ~10 Hz; steer toward the chosen direction
// every step.
import { Vector3, Quaternion } from 'three';
import { T } from './tunables.js?v=30';
import { Dragon, hazardDist, ELEMENTS } from './sim.js?v=30';

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
const ACID_LOOK = [0.3, 0.6, 1, 1.5];       // s ahead a bot checks whether a dragon will meet its acid cloud

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
        if (d.fire && this.fireReady(world, d) && this.breathTarget(world, d)) d.input.fire = true;
    }

    // Is now a good moment to breathe what we hold (rule elements)? Fire:
    // a tail in the cone. Ice and lightning: our prey, a bigger dragon or
    // one coming at us is in reach (slow it, stop it). Acid: a dragon is
    // about to fly into where the cloud will hang, or one is close on our
    // tail (it will follow us through it).
    breathTarget(world, d) {
        const el = world.rule('elements') ? d.element : 'fire';
        if (el !== 'ice' && el !== 'bolt' && el !== 'acid') return !!world.fireTarget(d);
        const st = world.breathStats(d.fire);
        if (el !== 'acid') {
            const t = el === 'bolt' ? world.nearestPart(d, d.pos, st.range * T.boltRange, T.boltAngle * st.angle / T.fireAngle, [])
                : world.nearestPart(d, d.pos, st.range * 0.8, st.angle, []);
            if (!t) return false;
            const o = t.o;
            return (this.goal && this.goal.kind === 'prey' && this.goal.o === o) || o.mass > d.mass || _v.subVectors(d.pos, o.pos).dot(o.vdir) > 0;
        }
        const r = T.acidRadius * st.rs, v = d.speed + 10;
        for (const o of world.dragons) {
            if (o === d || !o.alive || o.protect > 0 || o.pos.distanceToSquared(d.pos) > 3600) continue;
            // Will it meet the cloud (which sails on about v/2 m, then hangs) soon?
            for (const t of ACID_LOOK) {
                _p.copy(d.pos).addScaledVector(d.fwd, d.r * 2 + r + v * 0.5 * (1 - Math.exp(-t / 0.5)));
                if (_v.copy(o.pos).addScaledVector(o.vdir, o.speed * t).distanceTo(_p) < r + o.r + 1) return true;
            }
            _v.subVectors(d.pos, o.pos);
            const dist = _v.length();
            if (dist < 25 && _v.dot(d.fwd) > 0 && _v.dot(o.vdir) > dist * 0.8) return true;   // on our tail: it will follow us through
        }
        return false;
    }

    // Dragonfire charges stack (rule fireCharge): bold bots (hunters,
    // kingslayers, big or fierce ones) save up for a bigger breath before
    // they attack; the rest breathe as soon as they hold one. A full stack
    // is always ready.
    fireReady(world, d) {
        if (!world.rule('fireCharge')) return true;
        const max = world.rule('fireChargeMax');
        const bold = (this.mood === 'hunter' || this.mood === 'kingslayer' ? 1 : 0) + (d.mass > 150 ? 1 : 0) + (this.aggr > 0.6 ? 1 : 0);
        return d.fire >= Math.min(max, 1 + bold);
    }

    // Clear distance along a straight probe in `dir` before the first
    // hazard: walls, tails, or where a nearby head will be by then.
    // Fight mode (rule fight): bodies are harmless, but a bot that isn't
    // going for a bite still steers round them (so feeding bots don't
    // blunder through everyone, biting as they go); one that is ignores
    // them.
    clearance(world, d, dir, near, look) {
        const tip = this.biteTip;
        const pad = d.r + 1.0;
        const any = !(this.goal && this.goal.kind === 'bite');
        for (let s = 1.2; s <= look; s += 1.2) {
            _p.copy(d.pos).addScaledVector(dir, s);
            if (hazardDist(world.arena, _p)[0] < 2 + d.r) return s;
            if (world.tailDanger(_p, d.id, pad, tip, any)) return s;
            if (world.clouds.length && world.inAcid(_p, d.id, pad)) return s;    // someone's acid
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
        // Fight mode (rule fight): first keep clear of bigger heads (dodge),
        // and hunt bodies to bite (hunt) instead of cutting dragons off.
        let want = null;
        const moods = world.rule('botMoods'), A = moods ? aggression(world) : 0;
        const hunt = T.botAggression * (0.3 + this.aggr) * (moods ? MOOD_HUNT[this.mood] * (0.35 + 0.9 * A) : 1);
        const fight = world.rule('fight') > 0;
        this.biteTip = null;
        if (fight) want = this.dodge(world, d);
        if (!want && moods && this.mood === 'grazer') want = this.flee(world, d);
        if (!want) want = this.treasure(world, d, A);
        if (!want && fight) want = this.hunt(world, d, A, hunt, moods);
        else if (!want && moods && (this.mood === 'hunter' || this.mood === 'kingslayer')) want = this.stalk(world, d, A, hunt);
        if (want || fight) { /* fleeing, after a power-up, stalking or (fight mode) biting; else feeding */ }
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
            if (!this.goal || this.goal.kind === 'prey' || this.goal.kind === 'bite' || world.time > this.goalUntil ||
                (this.goal.kind === 'orb' && (!world.oalive[this.goal.i] || world.opull[this.goal.i]))) {
                this.pickFood(world, d, moods);
            }
            want = this.goalDir(d).clone();
        }
        // Pre-avoid the boundary.
        _p.copy(d.pos).addScaledVector(d.fwd, 14);
        if (hazardDist(a, _p)[0] < 6) want.lerp(_v.copy(a.center).sub(d.pos).normalize(), 0.6).normalize();
        // Gravity worlds: never dive deeper than we can pull out of. A fast
        // dragon needs its turn radius × (1 − cos dive) to level out, plus a
        // moment to react; below that, climb (braking for a tighter loop).
        const dive = -d.fwd.y;
        if (a.gravity && dive > 0.1) {
            const R = d.speed / (T.turnCruise * DEG * (1 - T.sizeTurnPenalty * Math.min(1, d.mass / 2000)));
            const need = R * (1 - Math.sqrt(1 - Math.min(1, dive * dive))) + d.speed * 0.3 + d.r + 8;
            const h = d.pos.y - a.floor;
            if (h < need) {
                _v.set(d.fwd.x, 0, d.fwd.z);
                if (_v.lengthSq() < 0.04) _v.set(d.up.x, 0, d.up.z);   // straight down: level out the way the back faces
                want.copy(_v.normalize()).setY(0.5).normalize();
                if (h < need * 0.6) { this.brake = true; this.boost = false; }
            }
        }

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
        this.brake = this.brake || (cFwd < 7 && best.dot(d.fwd) < 0.9);
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

    // Fight mode (rule fight): a bigger dragon's head closing in. On our
    // head, and it would win head to head (headonRatio): run. On our body,
    // where it would bite the rest off: turn away from it and boost, so the
    // body slides out of its reach sooner (more urgently near our head,
    // where a bite costs most). Returns the way to go, or null.
    dodge(world, d) {
        const k = Math.max(1, world.rule('headonRatio'));
        let threat = null, best = Infinity, onHead = false, at = 0;
        for (const o of world.dragons) {
            if (o === d || !o.alive || !(o.mass > d.mass) || o.protect > 0 || o.stun > 0) continue;
            _v.subVectors(d.pos, o.pos);
            const dist = _v.length();
            if (dist > d.len + 40) continue;                               // nowhere near any of us
            if (o.mass >= d.mass * k && dist < 22 + o.r && _v.dot(o.vdir) > dist * 0.3) {
                if (dist < best) { threat = o; best = dist; onHead = true; }
                continue;
            }
            const reach = 10 + o.r, step = Math.max(1, Math.round(3 / d.beadSpacing));
            for (let b = 2; b < d.nBeads; b += step) {
                const i = b * 3, dx = d.beads[i] - o.pos.x, dy = d.beads[i + 1] - o.pos.y, dz = d.beads[i + 2] - o.pos.z;
                const dd = dx * dx + dy * dy + dz * dz;
                if (dd > reach * reach) continue;
                const db = Math.sqrt(dd);
                if ((dx * o.vdir.x + dy * o.vdir.y + dz * o.vdir.z) > db * 0.5 && db < best) { threat = o; best = db; onHead = false; at = b; }
                break;
            }
        }
        if (!threat) return null;
        const away = _v.subVectors(d.pos, threat.pos).normalize();
        if (onHead) {
            this.boost = best < 14 && !d.thrustLocked && d.mass > T.boostMinMass;
            return away.add(_p.copy(d.fwd).multiplyScalar(0.5)).normalize().clone();
        }
        this.boost = !d.thrustLocked && d.mass > 30 && at < d.nBeads * 0.4 && best < 8;
        return away.add(_p.copy(d.fwd)).normalize().clone();
    }

    // Fight mode: go for a body we can bite safely (biteSpot): not
    // protected, just bitten or toxic, and if its owner would beat us head
    // to head, only its back half and not while its head is near.
    // Hunters and kingslayers seek one out (kingslayers the leader's
    // above all); other moods snap at one close by, as often as they'd
    // have gone for prey. As with power-ups (treasure), the bigger the bot,
    // the farther it looks, the longer it holds on and the straighter it
    // flies. Returns the way to go, or null.
    hunt(world, d, A, hunt, moods) {
        const drive = Math.min(1, Math.max(0, (d.len - 12) / 188));
        const seeker = !moods || this.mood === 'hunter' || this.mood === 'kingslayer';
        const k = Math.max(1, world.rule('headonRatio'));
        let g = this.goal && this.goal.kind === 'bite' ? this.goal : null;
        if (g && (!edible(world, d, g.o, true) || world.time > this.goalUntil || Math.random() < 0.05 * (1 - drive))) g = this.goal = null;
        if (!g && Math.random() < (seeker ? 0.25 + 0.6 * A : hunt * 0.15)) {
            const reach = seeker ? (30 + 50 * drive) * (0.5 + A) : 12 + 18 * drive;
            const king = this.mood === 'kingslayer' ? world.leaderboard()[0] : null;
            let best = null, bestScore = 0;
            for (const o of world.dragons) {
                if (!edible(world, d, o)) continue;
                const far = reach * (o === king ? 2 : 1);
                if (o.pos.distanceTo(d.pos) > far + o.len) continue;        // none of it within reach
                const s = this.biteSpot(world, d, o, k);
                if (!s || s.dist > far) continue;
                const sc = (o === king ? 3 : 1) * s.worth / (s.dist + 10) * (_v.subVectors(s.p, d.pos).dot(d.fwd) > -0.3 * s.dist ? 1 : 0.5);
                if (sc > bestScore) { bestScore = sc; best = o; }
            }
            if (best) { g = this.goal = { kind: 'bite', o: best }; this.goalUntil = world.time + 1.5 + 5 * drive; }
        }
        if (!g) return null;
        const s = this.biteSpot(world, d, g.o, k);
        if (!s) { this.goal = null; return null; }
        const dir = _p.copy(s.p).sub(d.pos).normalize();
        const wob = 0.4 * (1 - drive) * Math.min(1, s.dist / 15), ph = d.id * 1.3, tt = world.time;
        if (wob > 0.02) dir.addScaledVector(_v.set(Math.sin(tt * 1.7 + ph), 0.6 * Math.sin(tt * 1.1 + ph), Math.cos(tt * 1.4 + ph)), wob).normalize();
        this.boost = s.dist < 30 && s.dist > 6 && d.mass > 25 && !d.thrustLocked && Math.random() < (0.5 * hunt + 0.3 * drive) * (0.5 + A);
        return dir.clone();
    }

    // Where to bite o: the nearest bead we may safely go for, with where it
    // is (p), how far (dist) and what it's worth (the mass behind it; all
    // of it for a bite that would kill). A dragon that would beat us head
    // to head only from its back half, and not while its head is near us;
    // one we'd beat, anywhere past its head (near the head is a kill); one
    // in between, from a third of the way down. Null if none.
    biteSpot(world, d, o, k) {
        const strong = o.mass >= d.mass * k, weak = o.mass * k <= d.mass;
        if (strong && o.pos.distanceToSquared(d.pos) < (25 + 4 * o.r) ** 2) return null;
        const n = o.nBeads, from = strong ? Math.floor(n * 0.5) : weak ? 2 : Math.floor(n * 0.3);
        const step = Math.max(1, Math.floor(n / 60));
        let bb = -1, bd = Infinity;
        for (let b = from; b < n - 2; b += step) {
            const i = b * 3, dx = o.beads[i] - d.pos.x, dy = o.beads[i + 1] - d.pos.y, dz = o.beads[i + 2] - d.pos.z;
            const dd = dx * dx + dy * dy + dz * dz;
            if (dd < bd) { bd = dd; bb = b; }
        }
        if (bb < 0) return null;
        const i = bb * 3, cut = bb * o.beadSpacing;
        _bs.p.set(o.beads[i], o.beads[i + 1], o.beads[i + 2]);
        _bs.dist = Math.sqrt(bd);
        _bs.worth = cut < world.rule('biteMinLen') ? o.mass * 1.5 : o.mass * (1 - cut / Math.max(cut, o.shownLen || o.len));
        return _bs;
    }

    // Power-ups and pearls (rule botTreasure). Pearls count 2.5× and are
    // noticed from 30% farther. The bigger the bot, the more goal-
    // directed: a hatchling only grabs a crystal within botTreasureNear and
    // is easily distracted on the way; a 200 m dragon notices one from
    // botTreasureFar, holds the goal much longer and flies straight at
    // where it's drifting to. The feelers still have the last word. Both
    // ranges grow with aggression (×0.75 when a room wakes, ×1 at the
    // beginner cap), and below 0.75 aggression bots leave a crystal to a
    // human who is nearly as close (beginner rooms never get past 0.5).
    // Sun crystals (rule sunCrystals) are left alone until they have drifted
    // botSunGap m from the sun: bots catch them on their way out instead of
    // crowding the sun to wait for the next one.
    treasure(world, d, A) {
        if (!world.rule('botTreasure')) { if (this.goal && this.goal.kind === 'treasure') this.goal = null; return null; }
        const drive = Math.min(1, Math.max(0, (d.len - 12) / 188));   // 0 hatchling … 1 from 200 m
        let g = this.goal && this.goal.kind === 'treasure' ? this.goal : null;
        if (g && (!(world.powerups.includes(g.t) || world.pearls.includes(g.t)) || world.time > this.goalUntil || Math.random() < 0.05 * (1 - drive))) g = this.goal = null;
        if (!g && Math.random() < 0.2 + 0.6 * drive) {
            const near = world.rule('botTreasureNear'), reach = (near + (world.rule('botTreasureFar') - near) * drive) * (0.5 + A);
            const full = world.rule('fireCharge') ? Math.max(1, world.rule('fireChargeMax')) : 1;   // breath charges it can hold
            const sunGap = world.rule('botSunGap'), sun = world.arena.center;
            let best = null, bestScore = 0;
            const look = (list, worth, far) => {
                for (const t of list) {
                    if (ELEMENTS.includes(t.type) && d.fire >= full) continue;  // fire, ice, lightning, acid: charges already full
                    if (t.sun && t.pos.distanceToSquared(sun) < sunGap * sunGap) continue;   // a sun crystal: caught on its way out, not at the sun
                    const dist = t.pos.distanceTo(d.pos);
                    if (dist > reach * far || (A < 0.75 && humanNearer(world, d, t.pos, dist * (1.75 - A)))) continue;
                    const sc = worth * (_v.subVectors(t.pos, d.pos).dot(d.fwd) > -0.3 * dist ? 1 : 0.5) / (dist + 10);
                    if (sc > bestScore) { bestScore = sc; best = t; }
                }
            };
            look(world.powerups, 1, 1);
            look(world.pearls, 2.5, 1.3);
            if (best) { g = this.goal = { kind: 'treasure', t: best }; this.goalUntil = world.time + 1.5 + 8 * drive; }
        }
        if (!g) return null;
        const t = g.t, dist = t.pos.distanceTo(d.pos);
        // Big bots lead the drift; small ones meander toward it.
        _p.copy(t.pos);
        if (t.vel && drive > 0.3) _p.addScaledVector(t.vel, dist / Math.max(8, d.speed));
        const dir = _p.sub(d.pos).normalize();
        const wob = 0.5 * (1 - drive) * Math.min(1, dist / 15), ph = d.id * 1.7, tt = world.time;
        if (wob > 0.02) dir.addScaledVector(_v.set(Math.sin(tt * 1.9 + ph), 0.6 * Math.sin(tt * 1.3 + ph), Math.cos(tt * 1.6 + ph)), wob).normalize();
        // A big bot boosts to beat another dragon that's closer to it.
        if (drive > 0.5 && dist > 12 && dist < 60 && d.mass > 40 && !d.thrustLocked && Math.random() < drive * (0.3 + A)) {
            for (const o of world.dragons) if (o !== d && o.alive && o.pos.distanceToSquared(t.pos) < dist * dist) { this.boost = true; break; }
        }
        return dir.clone();
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
        if (g.kind === 'treasure') return _p.copy(g.t.pos).sub(d.pos).normalize();
        if (!g.p) return d.fwd;
        return _p.copy(g.p).sub(d.pos).normalize();
    }
}

let worldRef = null;
const _bs = { p: new Vector3(), dist: 0, worth: 0 };   // Brain.biteSpot's answer

// Fight mode: may d go for a bite of o? Not itself, a dead or protected
// dragon, a new player in the gentle period, or (when choosing, not when
// already chasing) one that was just bitten.
function edible(world, d, o, chasing = false) {
    if (o === d || !o.alive || o.protect > 0 || o.nBeads < 6) return false;
    if (!chasing && o.guard > 0) return false;
    return !(o === world.player && world.time - o.bornAt < world.gentleTime);
}

// Is a human (or the solo player) within `dist` of p?
function humanNearer(world, d, p, dist) {
    for (const o of world.dragons) {
        if (o !== d && o.alive && (o.human || o === world.player) && o.pos.distanceToSquared(p) < dist * dist) return true;
    }
    return false;
}

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
