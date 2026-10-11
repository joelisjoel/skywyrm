// Unit tests for sim rules (no server): run with `npm test`.
import assert from 'node:assert/strict';
import { World, Dragon, T, managePopulation, aggression, cleanPerks } from '../../site/js/shared.js';
import { jadeFor } from '../../site/js/profile.js';

let ok = 0;
const check = (cond, msg) => { assert.ok(cond, msg); ok++; console.log('  ✓', msg); };

// Two dragons far from walls; `a` flies into a point on `b`'s tail.
function setup(beadFromEnd) {
    const w = new World('orb', 'local');
    w.gentleTime = 0;
    const a = new Dragon('A', false), b = new Dragon('B', false);
    w.spawn(a, 60); w.spawn(b, 60);
    a.protect = b.protect = 0;
    b.pos.set(0, 0, 0); b.quat.set(0, 0, 0, 1); b.updateFrame();
    b.pathHead = -1; b.pathCount = 0;
    for (let k = 120; k >= 0; k--) b.pushPath(0, 0, k * 0.5);        // tail streams out along +z
    b.rebuildBeads();
    const i = (b.nBeads - 1 - beadFromEnd) * 3;
    a.pos.set(b.beads[i] + 0.3, b.beads[i + 1], b.beads[i + 2]);
    w.buildHash();
    return { w, a, b };
}

{
    const { w, a, b } = setup(1);
    const before = b.mass;
    w.collide();
    const e = w.events.find((x) => x.type === 'bite');
    check(a.alive && e && e.d === a && e.o === b, 'a head on a tail tip bites instead of dying');
    check(b.mass < before && a.mass === 60 + T.biteBeads * T.biteMult, `bite moves mass (victim −${(before - b.mass).toFixed(1)}, biter +${a.mass - 60})`);
}
{
    const { w, a } = setup(40);
    w.collide();
    check(!a.alive, 'a head on the middle of a tail still dies');
}
{
    const { w, a } = setup(1);
    w.rules.tailBite = 0;
    w.collide();
    check(!a.alive, 'with tailBite off (room rule) the tip is lethal again');
}
// Bots: aggression ramps with the world's age; beginner rooms cap it.
{
    const w = new World('sky', 'server');
    w.ageStart = 0;
    w.time = 0;
    check(Math.abs(aggression(w) - T.aggrStart) < 1e-9, `aggression starts at ${T.aggrStart}`);
    w.time = T.aggrRampMin * 60;
    check(aggression(w) === 1, `full aggression after ${T.aggrRampMin} min`);
    w.rules.botAggrMax = 0.5;
    check(aggression(w) === 0.5, 'beginner rooms cap aggression at 0.5');
}
// Every personality flies a busy sky for 60 s without errors, and the mix
// shifts toward hunters as the world ages.
{
    const w = new World('sky', 'server');
    w.botTarget = () => 25;
    w.spawnAmbient(T.orbTarget);
    w.ageStart = 0;
    managePopulation(w, true);
    for (let i = 0; i < 60 * 30; i++) { w.step(1 / 30); managePopulation(w); }
    const moods = new Set(w.dragons.map((d) => d.mood));
    check(w.dragons.length >= 20 && moods.size >= 3, `60 s of bots with moods: ${[...moods].join(', ')}`);
    // The mix shift, measured on 300 fresh bots at each age (25 is too few:
    // the random draw can land the wrong way round).
    const share = (t) => {
        for (const d of [...w.dragons]) w.removeDragon(d);
        w.time = w.ageStart + t;
        w.botTarget = () => 300;
        managePopulation(w, true);
        return w.dragons.filter((d) => d.mood === 'hunter' || d.mood === 'kingslayer').length / w.dragons.length;
    };
    const young = share(0), old = share(T.aggrRampMin * 60);
    check(old - young > 0.12, `more hunters when the room is old (${Math.round(young * 100)}% → ${Math.round(old * 100)}% of 300)`);
}
// Profile perks: applied at spawn, only known ids (max two), room rule can switch them off.
{
    check(cleanPerks(['lungs', 'bogus', 'lungs', 'pull', 'ember']).join() === 'lungs,pull', 'perk lists are cleaned (known ids, no repeats, max 2)');
    const w = new World('orb', 'local');
    const d = new Dragon('P', false);
    d.perks = ['scales', 'ember'];
    w.spawn(d, T.spawnMass);
    check(d.shield === 6 && d.fire === 1, 'Thick Scales + Ember Heart: each life starts shielded with dragonfire');
    const e = new Dragon('Q', false);
    e.perks = ['lungs'];
    w.spawn(e, T.spawnMass);
    check(e.thrustMult === 1.2 && Math.abs(e.thrust - 1.2 * d.thrust) < 1e-6, 'Deep Lungs: 20% bigger thrust tank');
    w.rules.perks = 0;
    w.spawn(d, T.spawnMass);
    check(d.shield === 0 && d.fire === 0, 'rule perks = 0: everyone plays stock');
}
// Longer dragons fly faster (rule lengthSpeed): ×1.5 at 100 m, ×1.8 at
// 200 m, nothing extra for a newborn, and the server lets them.
{
    const massFor = (m) => (m - T.lenBase) / T.lenPerMass;              // metres → mass
    const ratio = (metres, rules = {}) => {
        const w = new World('orb', 'local');
        Object.assign(w.rules, rules);
        const small = new Dragon('S', false), big = new Dragon('B', false);
        w.spawn(small, T.spawnMass); w.spawn(big, massFor(metres));
        for (let i = 0; i < 160; i++) for (const d of [small, big]) { d.temp = 0; w.move(d, 1 / 40); }
        return { r: big.speed / small.speed, small };
    };
    const at100 = ratio(100), at200 = ratio(200);
    check(Math.abs(at100.r - 1.5) < 0.03, `a 100 m dragon cruises ×${at100.r.toFixed(2)} a hatchling's speed (want ×1.5)`);
    check(Math.abs(at200.r - 1.8) < 0.03, `a 200 m dragon cruises ×${at200.r.toFixed(2)} (want ×1.8)`);
    check(at100.small.sizeBonus === 0, 'a newborn dragon gets no length bonus');
    check(Math.abs(ratio(200, { lengthSpeed: 0 }).r - 1) < 0.01, 'lengthSpeed 0 turns the reward off');
    const w = new World('orb', 'local');
    const hot = new Dragon('H', false); w.spawn(hot, massFor(100)); hot.temp = 100;
    check(Math.abs(w.speedMult(hot) - (1.5 + T.tempSpeed)) < 0.01, `heat adds on top: ×${hot.speedX.toFixed(2)} at 100 m and full heat`);
    const sv = new World('orb', 'server');
    const d = new Dragon('N', true); sv.spawn(d, massFor(200)); d.temp = 0;
    const budget = (rules) => { sv.rules = rules; d.moveBudget = 0; d.boosting = false; sv.applyNet(d, 0.1); return d.moveBudget; };
    check(budget({}) > budget({ lengthSpeed: 0 }) * 1.5, 'the server allows a long dragon its extra speed');
}
// Dragonfire charges (rule fireCharge): crystals stack up to fireChargeMax,
// one breath spends them all, and a bigger breath reaches farther, spreads
// wider, lasts longer and can cut more tails.
{
    // A dragon at the origin facing −z, and enemies whose tails lie where we put them.
    const arena = (rules = {}) => {
        const w = new World('orb', 'local');
        Object.assign(w.rules, rules);
        w.nextPowerup = 1e9;
        const a = new Dragon('A', false);
        w.spawn(a, 60);
        a.pos.set(0, 0, 0); a.quat.set(0, 0, 0, 1); a.updateFrame();
        const tail = (head, dir) => {                                     // a 60-mass dragon, tail streaming along dir
            const o = new Dragon('T', false);
            w.spawn(o, 60);
            o.protect = 0;
            o.pos.copy(head);
            o.pathHead = -1; o.pathCount = 0;
            for (let k = 120; k >= 0; k--) o.pushPath(head.x + dir.x * k * 0.5, head.y + dir.y * k * 0.5, head.z + dir.z * k * 0.5);
            o.rebuildBeads();
            return o;
        };
        return { w, a, tail };
    };
    const eat = (w, d, n) => {
        const got = [];
        for (let i = 0; i < n; i++) { w.powerups.push({ pos: d.pos.clone(), type: 'fire', spin: 0 }); w.updatePowerups(0); got.push(d.fire); }
        return got;
    };
    {
        const { w, a } = arena();
        check(eat(w, a, 7).join() === '1,2,3,4,5,5,5', 'fire crystals stack one charge each, up to fireChargeMax (5)');
        const e = w.events.filter((x) => x.type === 'powerup').pop();
        check(e && e.charge === 5, 'the pick-up event carries the charge count');
    }
    {
        const { w } = arena();
        const s1 = w.breathStats(1), s5 = w.breathStats(5), s9 = w.breathStats(9);
        check(s1.range === T.fireRange && s1.angle === T.fireAngle && s1.time === T.fireTime && s1.cuts === 1, `one charge is the classic breath (${s1.range} m, ${s1.angle}°, ${s1.time} s, 1 cut)`);
        check(Math.abs(s5.range / s1.range - 2) < 1e-9 && Math.abs(s5.angle / s1.angle - 1.6) < 1e-9 && Math.abs(s5.time / s1.time - 2) < 1e-9 && s5.cuts === 3,
            `five charges: ${s5.range} m, ${s5.angle.toFixed(0)}°, ${s5.time.toFixed(1)} s, ${s5.cuts} cuts (×2 range, ×1.6 cone, ×2 time)`);
        check(s9.range === s5.range && s9.cuts === s5.cuts, 'levels above the cap count as the cap');
    }
    {
        const { w, a } = arena();
        eat(w, a, 5);
        a.input.fire = true;
        w.updateBreath(a, 1 / 30);
        const e = w.events.find((x) => x.type === 'fireStart');
        check(a.fire === 0 && a.breathLevel === 5 && Math.abs(a.breath - (w.breathStats(5).time - 1 / 30)) < 1e-9 && e && e.lv === 5,
            'one breath spends every stored charge (level 5, 2.4 s)');
    }
    {
        // Range: a tail crossing 40 m ahead is out of reach for one charge, in reach for five.
        const { w, a, tail } = arena();
        const far = tail(a.pos.clone().set(-10, 0, -40), { x: 1, y: 0, z: 0 });
        check(!w.fireTarget(a, 1) && w.fireTarget(a, 5)?.o === far, 'a 5-charge breath reaches a tail 40 m away; a 1-charge breath does not');
        // Cone: a tail 40° off the nose is outside the 30° cone, inside the 48° one.
        const { w: w2, a: b, tail: tail2 } = arena();
        const s = Math.sin(40 * Math.PI / 180), c = Math.cos(40 * Math.PI / 180);
        const wide = tail2(b.pos.clone().set(12 * s, 0, -12 * c), { x: s, y: 0, z: -c });
        check(!w2.fireTarget(b, 1) && w2.fireTarget(b, 5)?.o === wide, 'a 5-charge breath catches a tail 40° off the nose; a 1-charge breath does not');
    }
    // Cuts: three tails crossing ahead; level 1 cuts one, level 5 all three.
    const cuts = (lv, rules) => {
        const { w, a, tail } = arena(rules);
        for (const z of [-12, -18, -24]) tail(a.pos.clone().set(-5, 0, z), { x: 1, y: 0, z: 0 });
        a.fire = lv; a.input.fire = true;
        for (let i = 0; i < 90; i++) w.updateBreath(a, 1 / 30);
        return w.events.filter((x) => x.type === 'sever').length;
    };
    check(cuts(1) === 1 && cuts(5) === 3, `a 1-charge breath cuts ${cuts(1)} tail, a 5-charge breath ${cuts(5)}`);
    {
        // Rule off: one charge at a time, the classic breath.
        const { w, a } = arena({ fireCharge: 0 });
        check(eat(w, a, 3).join() === '1,1,1', 'fireCharge 0: crystals don\'t stack');
        const s = w.breathStats(5);
        check(s.range === T.fireRange && s.time === T.fireTime && s.cuts === 1 && cuts(5, { fireCharge: 0 }) === 1, 'fireCharge 0: every breath is the classic one (24 m, 1.2 s, 1 cut)');
    }
    {
        // Bots: bold ones (hunters, big, fierce) save up; a timid grazer breathes at once.
        const w = new World('sky', 'local');
        w.botTarget = () => 2;
        managePopulation(w, true);
        const [b1, b2] = w.dragons;
        b1.brain.mood = 'hunter'; b1.brain.aggr = 0.9; b1.mass = 300;
        b2.brain.mood = 'grazer'; b2.brain.aggr = 0.1; b2.mass = 40;
        b1.fire = b2.fire = 1;
        const holds = !b1.brain.fireReady(w, b1) && b2.brain.fireReady(w, b2);
        b1.fire = 4;
        check(holds && b1.brain.fireReady(w, b1), 'bold bots save charges for a bigger breath (a big fierce hunter waits for 4); timid ones breathe at once');
    }
}

// Jade: the podium bonus needs a real life, so start → leave → again can't farm it.
{
    const life = (time, rank) => jadeFor({ peak: 12, kills: 0, bites: 0, time, rank });
    check(life(5, 1) - life(5, 50) === 0 && life(40, 1) - life(40, 50) === 60 && life(40, 3) - life(40, 50) === 25,
        'the #1 / top-3 jade bonus counts only after 30 s of life');
}

console.log(`\n${ok} sim checks passed`);
