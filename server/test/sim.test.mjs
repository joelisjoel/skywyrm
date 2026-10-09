// Unit tests for sim rules (no server): run with `npm test`.
import assert from 'node:assert/strict';
import { World, Dragon, T, managePopulation, aggression, cleanPerks } from '../../docs/wyrm/js/shared.js';

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
// Longer dragons fly faster (rule lengthSpeed), and the server lets them.
{
    const cruise = (rules) => {
        const w = new World('orb', 'local');
        Object.assign(w.rules, rules);
        const small = new Dragon('S', false), big = new Dragon('B', false);
        w.spawn(small, T.spawnMass); w.spawn(big, T.lengthSpeedMass);
        for (let i = 0; i < 120; i++) for (const d of [small, big]) { d.temp = 0; w.move(d, 1 / 40); }
        return big.speed / small.speed;
    };
    const on = cruise({}), off = cruise({ lengthSpeed: 0 });
    check(on > 1.15, `a full-size dragon cruises ${Math.round((on - 1) * 100)}% faster than a hatchling`);
    check(Math.abs(off - 1) < 0.01, 'lengthSpeed 0 turns the reward off');
    const w = new World('orb', 'server');
    const d = new Dragon('N', true); w.spawn(d, T.lengthSpeedMass); d.temp = 0;
    const budget = (rules) => { w.rules = rules; d.moveBudget = 0; d.boosting = false; w.applyNet(d, 0.1); return d.moveBudget; };
    check(budget({}) > budget({ lengthSpeed: 0 }) * 1.1, 'the server allows a long dragon its extra speed');
}

console.log(`\n${ok} sim checks passed`);
