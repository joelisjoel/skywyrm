// Unit tests for sim rules (no server): run with `npm test`.
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { World, Dragon, T, managePopulation, aggression, cleanPerks, quatFromForwardUp, hazardDist } from '../../site/js/shared.js';
import { jadeFor } from '../../site/js/profile.js';
import { Room } from '../rooms.js';

let ok = 0;
const check = (cond, msg) => { assert.ok(cond, msg); ok++; console.log('  ✓', msg); };
const lengthOf = (m) => Math.round(Math.min(T.lenCap, T.lenBase + T.lenPerMass * m));

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
// A dragon `a` at the origin facing −z, far from walls, and enemies whose
// tails lie where we put them (`tail`; `lay` moves one).
function arena(rules = {}, mode = 'local') {
    const w = new World('orb', mode);
    Object.assign(w.rules, { sunCrystals: 0 }, rules);                   // `a` sits where the sun is
    w.nextPowerup = 1e9;
    const a = new Dragon('A', false);
    w.spawn(a, 60);
    a.protect = 0;
    a.pos.set(0, 0, 0); a.quat.set(0, 0, 0, 1); a.updateFrame(); a.vdir.copy(a.fwd);
    const lay = (o, x, y, z, dir) => {                                   // head at (x, y, z), tail streaming along dir
        o.pos.set(x, y, z);
        o.pathHead = -1; o.pathCount = 0;
        for (let k = 120; k >= 0; k--) o.pushPath(x + dir.x * k * 0.5, y + dir.y * k * 0.5, z + dir.z * k * 0.5);
        o.rebuildBeads();
        return o;
    };
    const tail = (head, dir, mass = 60) => {
        const o = new Dragon('T', false);
        w.spawn(o, mass);
        o.protect = 0;
        return lay(o, head.x, head.y, head.z, dir);
    };
    return { w, a, tail, lay };
}
// Crystals of `type` eaten one at a time; returns the charge after each.
function eat(w, d, n, type = 'fire') {
    const got = [];
    for (let i = 0; i < n; i++) { w.powerups.push({ pos: d.pos.clone(), type, spin: 0 }); w.updatePowerups(0); got.push(d.fire); }
    return got;
}
const X = { x: 1, y: 0, z: 0 };

// Dragonfire charges (rule fireCharge): crystals stack up to fireChargeMax,
// one breath spends them all, and a bigger breath reaches farther, spreads
// wider, lasts longer and can cut more tails.
{
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
// Speed caps out at ×4 (rule speedCap): past 200 m the length curve bends
// upward, so a full-length (400 m) dragon at full heat reaches the cap.
{
    const massFor = (m) => (m - T.lenBase) / T.lenPerMass;
    const w = new World('orb', 'local');
    const mult = (metres, temp, rules = {}) => {
        w.rules = { ...rules };
        const d = new Dragon('X', false); w.spawn(d, massFor(metres)); d.temp = temp;
        return w.speedMult(d);
    };
    const cold = [200, 250, 300, 350, 400].map((m) => mult(m, 0));
    check(cold.every((v, i) => i === 0 || v > cold[i - 1] + 0.2), `speed keeps growing past 200 m: ${cold.map((v) => '×' + v.toFixed(2)).join(' → ')} (200 → 400 m)`);
    check(Math.abs(cold[2] - 2.5) < 0.1 && Math.abs(cold[4] - 3.6) < 0.1, 'about ×2.5 at 300 m and ×3.6 at 400 m, before heat');
    check(mult(400, 100) === 4 && mult(400, 100, { speedCap: 0 }) > 4, 'full heat at full length tops out at exactly ×4 (speedCap 0 lifts the cap)');
    check(mult(1500, 100) === 4, 'mass past the length cap adds no more speed');
    check(mult(300, 100, { speedCap: 2.5 }) === 2.5, 'a room can set a lower cap');
    check(Math.abs(mult(400, 0, { lengthSpeedLate: 0, lengthSpeedMax: 1 }) - 2) < 1e-9, 'lengthSpeedLate 0 + lengthSpeedMax 1 is the old ×2 length curve');
    // Boost stays proportional: ×4 of boost (zero-G, so no dive boost).
    const d = new Dragon('F', false); w.rules = {}; w.spawn(d, 980);
    for (let i = 0; i < 160; i++) { d.temp = 100; d.thrust = 10; d.input.boost = true; w.move(d, 1 / 40); }
    check(Math.abs(d.speed - T.speedBoost * 4) < 0.5, `a ×4 dragon boosts at ${d.speed.toFixed(0)} m/s (×4 of ${T.speedBoost})`);
}
// The server lets a ×4 dragon fly its speed (poses at 30 Hz, sometimes
// bunched two to a tick), but still clamps one going faster.
{
    const run = (speed) => {
        const sv = new World('orb', 'server');
        const d = new Dragon('H', false); d.human = true; d.remote = true;
        sv.spawn(d, 980);
        d.pos.set(-150, 0, 0); d.moveBudget = 0;
        let x = -150, corrections = 0;
        for (let i = 0; i < 90; i++) {
            d.temp = 100; d.thrust = 10; d.input.boost = true;
            x += speed / 30;
            if (i % 6 !== 3) d.net = { x, y: 0, z: 0, qx: 0, qy: -0.7071, qz: 0, qw: 0.7071, speed, bank: 0, fresh: true };
            sv.applyNet(d, 1 / 30);
            if (d.corrected) { corrections++; d.corrected = false; }
        }
        return { corrections, speedX: d.speedX };
    };
    const legal = run(T.speedBoost * 4), cheat = run(T.speedBoost * 4 * 1.3);
    check(legal.corrections === 0 && legal.speedX === 4, `a ×4 boost (${T.speedBoost * 4} m/s) is never corrected`);
    check(cheat.corrections > 10, `30% faster than ×4 is clamped (${cheat.corrections} corrections in 3 s)`);
}
// The wall assist still saves a ×4 dragon boosting straight at the storm
// wall or diving at the cloud sea.
{
    let saved = 0;
    const dirs = [[1, 0, 0], [0, 0, -1], [0.7, -0.5, 0.5], [0, -1, 0.1], [-0.6, -0.8, 0], [0.5, 0.3, -0.8]];
    for (const [x, y, z] of dirs) {
        const w = new World('sky', 'local');
        const p = new Dragon('P', false); p.wallAssist = true; w.player = p;
        w.spawn(p, 980); p.protect = 0;
        p.pos.set(x * 150, 90, z * 150);
        const F = new Vector3(x, y, z).normalize();
        quatFromForwardUp(F, new Vector3(0, 1, 0), p.quat); p.updateFrame(); p.vdir.copy(p.fwd); p.speed = 100;
        p.pathHead = -1; p.pathCount = 0; p.lastPt.copy(p.pos);
        for (let i = 0; i < 8 * 60 && p.alive; i++) {
            p.temp = 100; p.thrust = 10; Object.assign(p.input, { sx: 0, sy: 0, boost: true, brake: false });
            w.step(1 / 60);
        }
        if (p.alive) saved++;
    }
    check(saved === dirs.length, `the wall assist saves a ×4 dragon heading for the wall or the cloud sea (${saved}/${dirs.length})`);
}
// Fast bots don't fly into the cloud sea: they never dive deeper than they
// can pull out of at their speed.
{
    const w = new World('sky', 'server');
    w.botTarget = () => 25; w.ageStart = 0; w.rules.botAggrMax = 0.5;
    w.spawnAmbient(T.orbTarget);
    managePopulation(w, true);
    let sea = 0, deaths = 0;
    for (let i = 0; i < 60 * 30; i++) {
        for (const d of w.dragons) if (d.alive) { d.temp = 100; if (d.mass < 900) d.mass = 900; }
        w.step(1 / 30);
        for (const e of w.events) if (e.type === 'death') { deaths++; if (e.cause === 'the cloud sea') sea++; }
        managePopulation(w);
    }
    check(sea <= 1, `60 s of 25 hot ×4 bots in Skyhold: ${sea} of ${deaths} deaths in the cloud sea`);
}

// Jade: the podium bonus needs a real life, so start → leave → again can't farm it.
{
    const life = (time, rank) => jadeFor({ peak: 12, kills: 0, bites: 0, time, rank });
    check(life(5, 1) - life(5, 50) === 0 && life(40, 1) - life(40, 50) === 60 && life(40, 3) - life(40, 50) === 25,
        'the #1 / top-3 jade bonus counts only after 30 s of life');
}
// Power-ups float about (rule powerupDrift): they wander 0.5–1.5 m/s and
// stay well inside the arena and out of the sun.
{
    for (const arena of ['sky', 'orb']) {
        const w = new World(arena, 'local');
        w.rules.sunCrystals = 0;                                         // the random ones only (sun crystals are tested below)
        for (let i = 0; i < 5; i++) { w.nextPowerup = -1; w.updatePowerups(0); }
        w.nextPowerup = Infinity;
        const start = w.powerups.map((p) => p.pos.clone()), last = w.powerups.map((p) => p.pos.clone());
        const walked = start.map(() => 0);
        let wall = Infinity, sun = Infinity, far = 0;
        for (let s = 0; s < 1800; s++) {
            w.time += 0.1; w.updatePowerups(0.1);
            w.powerups.forEach((p, i) => {
                walked[i] += p.pos.distanceTo(last[i]); last[i].copy(p.pos);
                wall = Math.min(wall, hazardDist(w.arena, p.pos)[0]);
                const c = p.pos.distanceTo(w.arena.center);
                sun = Math.min(sun, c); far = Math.max(far, c / w.arena.radius);
            });
        }
        const pace = walked.map((m) => m / 180), moved = w.powerups.map((p, i) => p.pos.distanceTo(start[i]));
        check(w.powerups.length === 5 && pace.every((v) => v > 0.35 && v < 1.5) && Math.max(...moved) > 10,
            `${arena}: 5 power-ups drift ${pace.map((v) => v.toFixed(1)).join('/')} m/s over 3 min`);
        check(wall > 20 && sun > 15 && far < 0.62, `${arena}: they keep ${wall.toFixed(0)} m from the walls, ${sun.toFixed(0)} m from the sun, within ${(far * 100).toFixed(0)}% of the radius`);
    }
    const w = new World('orb', 'local');
    w.rules.powerupDrift = 0; w.rules.sunCrystals = 0;
    w.nextPowerup = -1; w.updatePowerups(0);
    const p0 = w.powerups[0].pos.clone();
    for (let s = 0; s < 100; s++) { w.time += 0.1; w.updatePowerups(0.1); }
    check(w.powerups[0].pos.equals(p0), 'powerupDrift 0: power-ups stay put');
}
// Bots go for power-ups (rule botTreasure), more goal-directed the bigger
// they are: a big bot grabs one 70 m away; a hatchling doesn't notice it.
{
    const trial = (mass, rules = {}, human = false, flipOff = false, type = 'shield', charges = 0) => {
        const w = new World('orb', 'local');
        Object.assign(w.rules, { botAggrMax: 0.5, pearls: 0, sunCrystals: 0 }, rules);
        w.ageStart = 0;
        w.botTarget = () => 1;
        managePopulation(w, true);
        const b = w.dragons[0];
        w.spawn(b, mass); b.protect = 0;
        b.pos.set(0, 0, -100);
        quatFromForwardUp(new Vector3(1, 0, 0), new Vector3(0, 1, 0), b.quat); b.updateFrame(); b.vdir.copy(b.fwd);
        b.pathHead = -1; b.pathCount = 0; b.lastPt.copy(b.pos);
        w.powerups.push({ pos: new Vector3(0, 0, -170), type, spin: 0 });
        b.fire = charges;
        w.nextPowerup = Infinity;
        let p = null;
        if (human) {
            p = new Dragon('Kid', false); w.player = p;
            w.spawn(p, 30);
        }
        let got = null;
        for (let i = 0; i < 8 * 30 && !got; i++) {
            if (p) { p.pos.set(0, 25, -150); p.protect = 5; }
            if (flipOff && i === 15) w.rules.botTreasure = 0;
            w.step(1 / 30);
            const e = w.events.find((x) => x.type === 'powerup');
            if (e) got = e.d;
        }
        return got === b;
    };
    const big = [0, 1, 2].filter(() => trial(600)).length, tiny = [0, 1, 2].filter(() => trial(10)).length;
    check(big === 3 && tiny === 0, `a 248 m bot fetches a power-up 70 m away (${big}/3); a hatchling doesn't notice it (${tiny}/3)`);
    check(!trial(600, { botTreasure: 0 }), 'botTreasure 0: bots ignore power-ups');
    check(!trial(600, {}, true), 'bots let a nearer human have it (beginner aggression)');
    check(!trial(600, {}, false, true), 'switching botTreasure off mid-chase just drops the goal');
    check(trial(600, {}, false, false, 'ice', 2) && !trial(600, {}, false, false, 'acid', T.fireChargeMax),
        'bots go for breath crystals of any element (ice, lightning, acid) until their charges are full');
}

// Breath elements (rule elements): ice chills, lightning stuns and chains,
// acid clouds melt tails; the server enforces chill and stun for browsers.
{
    {
        const { w, a } = arena();
        eat(w, a, 2, 'fire'); eat(w, a, 1, 'ice');
        check(a.fire === 3 && a.element === 'ice', 'charges are shared; the last crystal (ice) sets the element: 3 charges of frost');
        const off = arena({ elements: 0 });
        eat(off.w, off.a, 1, 'acid');
        const old = arena();
        old.a.fireOnly = true; eat(old.w, old.a, 1, 'bolt');
        check(off.a.element === 'fire' && old.a.element === 'fire', 'rule elements 0, or a browser that only knows fire: every crystal breathes fire');
    }
    {
        // Spawning: elements off → only fire crystals; on → ice, lightning and acid too.
        const kinds = (rules) => {
            const { w } = arena(rules), seen = new Set();
            for (let i = 0; i < 400; i++) { w.powerups.length = 0; w.nextPowerup = -1; w.updatePowerups(0); seen.add(w.powerups[0].type); }
            return [...seen].sort().join();
        };
        check(kinds({ elements: 0 }) === 'fire,magnet,shield', 'elements 0: only fire, shield and lodestone crystals spawn');
        check(kinds({}) === 'acid,bolt,fire,ice,magnet,shield', 'elements on: ice, lightning and acid crystals spawn too');
    }
    {
        // Ice: everyone with any part in the cone is chilled; behind us nobody is.
        const { w, a, tail } = arena();
        const ahead = tail(a.pos.clone().set(-4, 0, -15), X), behind = tail(a.pos.clone().set(-4, 0, 20), X);
        a.fire = 2; a.element = 'ice'; a.input.fire = true;
        w.updateBreath(a, 1 / 30);
        const t = T.chillTime * w.breathStats(2).ts;
        check(Math.abs(ahead.chill - t) < 1e-9 && behind.chill === 0 && w.events.some((e) => e.type === 'chill' && e.o === ahead),
            `an ice breath chills what's in the cone (${t.toFixed(2)} s at 2 charges), not what's behind`);
    }
    {
        // Chilled flight: half speed, no boost, stiffer turns.
        const fly = (chill, inp, steps = 90) => {
            const { w, a } = arena();
            a.temp = 0; a.speed = T.speedCruise;
            for (let i = 0; i < steps; i++) { a.chill = chill; Object.assign(a.input, inp); w.move(a, 1 / 60); }
            return a;
        };
        const free = fly(0, { boost: true }), cold = fly(3, { boost: true });
        const sx = free.speedX;
        check(free.boosting && !cold.boosting && Math.abs(cold.speed - T.speedCruise * sx * T.chillSpeed) < 0.01,
            `chilled: no boost, top speed ×${T.chillSpeed} (${cold.speed.toFixed(1)} m/s, ${free.speed.toFixed(1)} boosting when warm)`);
        const turn = (chill) => { const d = fly(chill, { sx: 1, boost: false }, 24); return Math.acos(Math.max(-1, Math.min(1, -d.fwd.z))); };
        check(Math.abs(turn(3) / turn(0) - T.chillTurn) < 0.05, `chilled: turns ×${(turn(3) / turn(0)).toFixed(2)} as fast`);
        // Server: a chilled browser gets the slowed budget (after a moment's grace), whatever it claims.
        const sv = arena({}, 'server'), d = sv.a;
        d.remote = d.human = true; d.temp = 0; d.input.boost = true;
        const budget = (chill, ago) => { d.chill = chill; d.chillAt = sv.w.time - ago; d.moveBudget = 0; sv.w.applyNet(d, 0.1); return { b: d.moveBudget, boost: d.boosting }; };
        const warm = budget(0, 1), fresh = budget(3, 0), cold2 = budget(3, 1);
        check(warm.boost && !cold2.boost && Math.abs(cold2.b / budget(0, 1).b - T.chillSpeed * ((T.speedCruise * d.speedX + T.diveBoost + 1) / (T.speedBoost * d.speedX + T.diveBoost + 1))) < 1e-6 && fresh.b === warm.b,
            'server: a chilled browser may not boost and gets half the cruise budget (not in the first moment, while the news travels)');
    }
    {
        // Stun: the browser's turn is refused and only forward progress counts.
        const { w, a: d } = arena({}, 'server');
        d.remote = d.human = true;
        const claim = () => { d.pos.set(0, 0, 0); d.quat.set(0, 0, 0, 1); d.updateFrame(); d.vdir.set(0, 0, -1); d.moveBudget = 50; d.corrected = false;
            d.net = { x: 3, y: 0, z: -1, qx: 0, qy: -0.7071, qz: 0, qw: 0.7071, speed: 16, bank: 0, fresh: true }; w.applyNet(d, 1 / 30); };
        d.stun = 1; d.stunAt = w.time - 1;
        claim();
        const held = Math.abs(d.pos.x) < 1e-9 && Math.abs(d.pos.z + 1) < 1e-9 && Math.abs(d.quat.w - 1) < 1e-9 && d.corrected;
        d.stun = 0;
        claim();
        check(held && Math.abs(d.pos.x - 3) < 1e-9 && Math.abs(d.quat.w - 0.7071) < 1e-3, 'server: a stunned browser\'s turn is refused (flies straight, corrected); unstunned it is accepted');
        // In your own flight, the stick goes dead.
        const loc = arena();
        loc.a.stun = 1;
        for (let i = 0; i < 30; i++) { Object.assign(loc.a.input, { sx: 1, sy: 1, roll: 1 }); loc.w.move(loc.a, 1 / 60); }
        check(loc.a.fwd.z < -0.9999, 'stunned: the stick does nothing, the dragon flies straight');
        const { w: cw, a: ca } = setup(40);
        ca.stun = 1;
        cw.collide();
        check(ca.alive, 'a stunned dragon carried into the middle of a tail isn\'t killed by it (lightning never kills on its own)');
    }
    {
        // Lightning: first in line, then chains (1 at one charge, 3 at five); stuns and sheds mass.
        const zap = (lv) => {
            const { w, a, tail } = arena();
            const col = [-20, -30, -40, -50, -60].map((z) => tail(a.pos.clone().set(0, 0, z), X));
            a.fire = lv; a.element = 'bolt'; a.input.fire = true;
            w.updateBreath(a, 1 / 30);
            const e = w.events.find((x) => x.type === 'bolt');
            return { n: e ? e.hits.length : 0, first: e && e.hits[0] === col[0], stun: col[0].stun, shed: 60 - col[0].mass, w };
        };
        const z1 = zap(1), z5 = zap(5);
        check(z1.first && z1.n === 2 && z5.n === 4, `lightning strikes the first dragon in line and chains: ${z1.n} struck at one charge, ${z5.n} at five`);
        check(Math.abs(z1.stun - T.stunTime) < 1e-9 && Math.abs(z5.stun - 2 * T.stunTime) < 1e-9 && z1.shed > 0 && z5.shed > z1.shed,
            `struck dragons are stunned (${z1.stun.toFixed(1)}–${z5.stun.toFixed(1)} s) and shed food (${z1.shed.toFixed(1)}–${z5.shed.toFixed(1)} mass)`);
        const miss = arena();
        miss.tail(miss.a.pos.clone().set(-40, 0, -20), { x: -1, y: 0, z: 0 });              // well off the narrow line
        miss.a.fire = 1; miss.a.element = 'bolt'; miss.a.input.fire = true;
        for (let i = 0; i < 30; i++) miss.w.updateBreath(miss.a, 1 / 30);
        check(!miss.w.events.some((e) => e.type === 'bolt'), 'lightning is narrow: a dragon off to the side is not struck');
    }
    {
        // Acid: a cloud ahead melts any other dragon inside it, only while inside; the spitter is immune.
        const { w, a, tail, lay } = arena();
        a.fire = 1; a.element = 'acid'; a.input.fire = true;
        w.updateBreath(a, 1 / 30);
        const c = w.clouds[0];
        check(w.clouds.length === 1 && c.owner === a.id && c.z < 0, 'acid spits a cloud ahead');
        c.vx = c.vy = c.vz = 0; c.x = 0; c.y = 0; c.z = -30;
        const victim = tail(a.pos.clone().set(-12, 0, -30), X), bystander = tail(a.pos.clone().set(-12, 0, -90), X);
        lay(a, 0, 0, -30, { x: 0, y: 0, z: 1 });                                            // the spitter flies through its own cloud
        const orbs = w.orbCount;
        for (let i = 0; i < 30; i++) w.updateClouds(1 / 30);
        const lost = 60 - victim.mass;
        check(Math.abs(lost - T.acidRate) < 0.05 && bystander.mass === 60 && a.mass === 60 && w.orbCount > orbs,
            `a dragon in the cloud melts ${lost.toFixed(1)} mass/s into food; one outside and the spitter lose nothing`);
        lay(victim, -12, 0, -90 + 20, X);                                                   // it flies out
        const m = victim.mass;
        for (let i = 0; i < 30; i++) w.updateClouds(1 / 30);
        check(victim.mass === m, 'out of the cloud, the melting stops');
        for (let i = 0; i < 30 * T.acidTime; i++) w.updateClouds(1 / 30);
        check(w.clouds.length === 0, `the cloud fades after ${T.acidTime} s`);
    }
    {
        // Bots: lightning or ice for a dragon coming at them; acid only when someone will meet the cloud.
        const w = new World('orb', 'local');
        w.botTarget = () => 2;
        managePopulation(w, true);
        const [b, o] = w.dragons;
        for (const d of [b, o]) { d.protect = 0; d.quat.set(0, 0, 0, 1); d.updateFrame(); d.vdir.copy(d.fwd); }
        b.pos.set(0, 0, 0); b.brain.mood = 'grazer'; b.brain.aggr = 0; b.mass = 40;
        b.fire = 1; b.element = 'bolt';
        o.pos.set(0, 0, -20); o.quat.set(0, 1, 0, 0); o.updateFrame(); o.vdir.copy(o.fwd); o.speed = 16;   // head-on
        o.pathHead = -1; o.pathCount = 0; for (let k = 60; k >= 0; k--) o.pushPath(0, 0, -20 - k * 0.5); o.rebuildBeads();
        const boltOk = b.brain.breathTarget(w, b);
        b.element = 'acid';
        const acidOk = b.brain.breathTarget(w, b);
        o.pos.set(200, 0, 0); o.rebuildBeads();
        check(boltOk && acidOk && !b.brain.breathTarget(w, b), 'bots breathe lightning at a dragon coming at them, spit acid in its path, and hold it when nobody is near');
    }
    {
        // Wire: a browser without caps ['el'] is shown element crystals as fire and always breathes fire.
        const room = new Room({ id: 't', name: 'T', arena: 'orb', beginner: true }, { occupied() {}, emptied() {}, countHumans() {}, stats: { run() {} } });
        const join = (caps) => { const c = { got: [], send(m) { this.got.push(m); }, sendRaw(t) { this.got.push(JSON.parse(t)); } }; room.join(c, 'P', { caps }); return c; };
        const oldC = join(undefined), newC = join(['el']);
        const w = room.world;
        w.nextPowerup = 1e9; w.rules.sunCrystals = 0; w.powerups.length = 0;
        w.powerups.push({ pos: oldC.dragon.pos.clone().set(0, 0, 0), type: 'ice', spin: 0 });
        room.tick(); room.tick();
        const snap = (c) => c.got.filter((m) => m.t === 's').pop();
        check(snap(oldC).pu[0][0] === 'fire' && snap(newC).pu[0][0] === 'ice' && oldC.got[0].t === 'welcome',
            'an older browser sees an ice crystal as a fire one; a new one sees ice');
        w.powerups.length = 0;
        for (const c of [oldC, newC]) w.powerups.push({ pos: c.dragon.pos.clone(), type: 'acid', spin: 0 });
        room.tick();
        const pu = (c) => c.got.filter((m) => m.t === 'e').flatMap((m) => m.ev).filter((e) => e.k === 'pu').pop();
        check(oldC.dragon.element === 'fire' && newC.dragon.element === 'acid' && pu(oldC).kind === 'fire' && pu(newC).kind === 'acid',
            'picking it up, the older browser\'s dragon gets fire (and is told "fire"); the new one gets acid');
    }
}

// Flaming pearls (rule pearls): a few drift through the sky on long
// curves, catching one is worth pearlMass, and a new one turns up
// somewhere else pearlRespawn s later.
{
    for (const arena of ['sky', 'orb']) {
        const w = new World(arena, 'local');
        w.step(1 / 30);
        const start = w.pearls.map((p) => p.pos.clone()), last = start.map((v) => v.clone()), walked = start.map(() => 0);
        let wall = Infinity, sun = Infinity, far = 0;
        for (let s = 0; s < 1200; s++) {
            w.time += 0.1; w.updatePearls(0.1);
            w.pearls.forEach((p, i) => {
                walked[i] += p.pos.distanceTo(last[i]); last[i].copy(p.pos);
                wall = Math.min(wall, hazardDist(w.arena, p.pos)[0]);
                const c = p.pos.distanceTo(w.arena.center);
                sun = Math.min(sun, c); far = Math.max(far, c / w.arena.radius);
            });
        }
        const pace = walked.map((m) => m / 120), moved = w.pearls.map((p, i) => p.pos.distanceTo(start[i]));
        check(w.pearls.length === T.pearls && pace.every((v) => v > 1 && v < 3.6) && Math.max(...moved) > 10,
            `${arena}: ${w.pearls.length} pearls drift ${pace.map((v) => v.toFixed(1)).join('/')} m/s over 2 min`);
        check(wall > 20 && sun > 15 && far < 0.8, `${arena}: pearls keep ${wall.toFixed(0)} m from the walls, ${sun.toFixed(0)} m from the sun, within ${(far * 100).toFixed(0)}% of the radius`);
    }
    const w = new World('orb', 'local');
    w.step(1 / 30);
    const d = new Dragon('P', false);
    w.spawn(d, 50); d.protect = 0;
    const pl = w.pearls[0], at = pl.pos.clone();
    d.pos.copy(pl.pos);
    w.updatePearls(0);
    const e = w.events.find((x) => x.type === 'pearl');
    check(e && e.d === d && d.mass === 50 + T.pearlMass && w.pearls.length === T.pearls - 1, `catching a pearl: +${T.pearlMass} mass (${d.mass}), ${w.pearls.length} left`);
    d.pos.set(0, 300, 0);
    for (let s = 0; s < T.pearlRespawn * 1.25 * 10 + 2; s++) { w.time += 0.1; w.updatePearls(0.1); }
    const fresh = w.pearls.find((p) => p.id > T.pearls);              // the first ones are 1..pearls
    check(w.pearls.length === T.pearls && fresh && fresh.pos.distanceTo(at) > 60,
        `a new pearl appears within ${T.pearlRespawn * 1.25} s, ${fresh ? fresh.pos.distanceTo(at).toFixed(0) : '?'} m from the last catch`);
    const off = new World('orb', 'local');
    off.rules.pearls = 0;
    for (let s = 0; s < 30; s++) off.step(1 / 30);
    check(off.pearls.length === 0, 'rule pearls 0: no pearls');
}
// Bots want pearls more than power-ups: a big bot between a crystal and a
// pearl the same distance away goes for the pearl.
{
    const trial = () => {
        const w = new World('orb', 'local');
        Object.assign(w.rules, { botAggrMax: 0.5, pearls: 1, pearlDrift: 0, sunCrystals: 0 });
        w.ageStart = 0; w.botTarget = () => 1;
        managePopulation(w, true);
        const b = w.dragons[0];
        w.spawn(b, 600); b.protect = 0;
        b.pos.set(0, 0, -100);
        quatFromForwardUp(new Vector3(1, 0, 0), new Vector3(0, 1, 0), b.quat); b.updateFrame(); b.vdir.copy(b.fwd);
        b.pathHead = -1; b.pathCount = 0; b.lastPt.copy(b.pos);
        w.updatePearls(0);
        w.pearls[0].pos.set(0, 50, -100);
        w.powerups.push({ pos: new Vector3(0, -50, -100), type: 'shield', spin: 0 });
        w.nextPowerup = Infinity; w.rules.powerupDrift = 0;
        for (let i = 0; i < 6 * 30; i++) {
            w.step(1 / 30);
            for (const e of w.events) if (e.type === 'pearl' || e.type === 'powerup') return e.type;
        }
        return 'neither';
    };
    const picks = [trial(), trial(), trial()];
    check(picks.every((p) => p === 'pearl'), `a big bot picks the pearl over a crystal the same distance away (${picks.join(', ')})`);
}

// Sun crystals (rule sunCrystals): one breath crystal of each flavour is
// always in play, on top of the random ones. Each is born at the sun, can't
// be caught while it hatches, drifts out on a wandering path and fades
// sunCrystalEdge m from the walls (above the cloud sea in Skyhold); eaten or
// faded, the next of its flavour is born sunCrystalRespawn s (±25%) later.
{
    const ELS = ['fire', 'ice', 'bolt', 'acid'];
    const ofKind = (w, t) => w.powerups.filter((p) => p.sun && p.type === t);
    const tick = (w, dt = 0.1) => { w.time += dt; w.events.length = 0; w.updatePowerups(dt); return w.events; };
    const gap = T.sunCrystalRespawn * 1.25 + 0.15;                       // the longest a flavour may be missing
    const seeded = (n) => () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };   // a repeatable Math.random
    for (const arena of ['sky', 'orb']) {
        // Nobody about: every flavour crosses to the edge, fades and is born again, several times.
        const w = new World(arena, 'local'), c = w.arena.center;
        w.nextPowerup = Infinity;
        const lives = new Map(), missing = {};
        let twice = 0, late = 0, allFour = 0, births = 0, bornAway = 0;
        for (let s = 0; s < 3000; s++) {
            for (const e of tick(w)) if (e.type === 'sunCrystal') { births++; if (e.pos.distanceTo(c) > 1e-6) bornAway++; }
            let present = 0;
            for (const t of ELS) {
                const n = ofKind(w, t).length;
                if (n > 1) twice++;
                if (n) { present++; missing[t] = null; } else { missing[t] ??= w.time; if (s > 40 && w.time - missing[t] > gap) late++; }
            }
            if (present === 4) allFour++;
            for (const p of w.powerups) {
                if (!p.sun) continue;
                const out = w.arena.gravity ? Math.hypot(p.pos.x - c.x, p.pos.z - c.z) : p.pos.distanceTo(c);   // Skyhold: out across the sky
                let L = lives.get(p.sun);
                if (!L) lives.set(p.sun, L = { d0: p.pos.distanceTo(c), last: out, back: 0, wall: Infinity, low: Infinity, born: w.time, fadeAt: 0 });
                if (out < L.last - 1e-9) L.back++;
                L.last = out; L.wall = Math.min(L.wall, hazardDist(w.arena, p.pos)[0]);
                if (w.arena.gravity) L.low = Math.min(L.low, p.pos.y - w.arena.floor);
                if (p.fade < 1 && !L.fadeAt) L.fadeAt = w.time;
            }
        }
        const all = [...lives.values()], crossed = all.filter((L) => L.fadeAt).map((L) => L.fadeAt - L.born);
        check(twice === 0 && late === 0 && allFour > 3000 * 0.7 && births >= 12,
            `${arena}: one crystal of each flavour at all times (never two; one is missing only for its ${T.sunCrystalRespawn} s respawn; all four out ${Math.round(allFour / 30)}% of the time), ${births} born in 5 min`);
        check(bornAway === 0 && all.every((L) => L.d0 < 1.5 && L.back === 0),
            `${arena}: each is born at the sun and its distance from the sun only grows`);
        check(crossed.length >= 8 && Math.min(...crossed) > 45 && Math.max(...crossed) < 130 && all.every((L) => L.wall > 25 && (!w.arena.gravity || L.low > 40)),
            `${arena}: unchased, one crawls to the edge in ${Math.min(...crossed).toFixed(0)}–${Math.max(...crossed).toFixed(0)} s and fades ${Math.min(...all.map((L) => L.wall)).toFixed(0)}+ m inside the walls`
            + (w.arena.gravity ? `, ${Math.min(...all.map((L) => L.low)).toFixed(0)}+ m above the cloud sea` : ''));
    }
    {
        // Eaten: gone at once, and the next of that flavour is born at the sun after the delay.
        const w = new World('orb', 'local');
        w.nextPowerup = Infinity;
        for (let s = 0; s < 100; s++) tick(w);
        const d = new Dragon('P', false);
        w.spawn(d, 50); d.protect = 0;
        const ice = ofKind(w, 'ice')[0];
        d.pos.copy(ice.pos);
        const got = tick(w, 0).find((e) => e.type === 'powerup');
        d.pos.set(0, 250, 0);
        const t0 = w.time;
        let back = null;
        for (let s = 0; s < gap * 10 && !back; s++) back = tick(w).find((e) => e.type === 'sunCrystal' && e.kind === 'ice');
        const dt = w.time - t0;
        check(got && got.d === d && got.kind === 'ice' && d.element === 'ice' && d.fire === 1 && back && back.pos.distanceTo(w.arena.center) < 1e-6
            && ofKind(w, 'ice').length === 1 && dt >= T.sunCrystalRespawn * 0.75 - 0.05,
            `eaten: an ice sun crystal gives a frost charge, and a new one is born at the sun ${dt.toFixed(1)} s later`);
        check(w.powerups.filter((p) => p.sun).length === 4, 'the other flavours were never touched');
    }
    {
        // Hatching: a dragon sitting on a newborn can't have it until it has cleared the sun.
        const w = new World('sky', 'local');
        w.nextPowerup = Infinity; w.rules.elements = 0;
        const d = new Dragon('P', false);
        w.spawn(d, 50); d.protect = 0;
        let age = null;
        for (let s = 0; s < 100 && age === null; s++) {
            const p = ofKind(w, 'fire')[0];
            if (p) d.pos.copy(p.pos);
            const ate = tick(w, 1 / 30).find((e) => e.type === 'powerup');
            if (ate && p) age = w.time - p.born;
        }
        check(age !== null && age >= T.sunCrystalHatch - 0.05 && age < T.sunCrystalHatch + 0.1, `a newborn can't be caught for its first ${T.sunCrystalHatch} s (caught at ${age && age.toFixed(2)} s)`);
    }
    {
        // Rule elements 0: only fire, born at the sun; switched off mid-game, the other flavours go.
        const w = new World('orb', 'local');
        w.nextPowerup = Infinity;
        for (let s = 0; s < 60; s++) tick(w);
        const before = w.powerups.filter((p) => p.sun).length;
        w.rules.elements = 0;
        let kinds = new Set();
        for (let s = 0; s < 1200; s++) { tick(w); for (const p of w.powerups) if (p.sun) kinds.add(p.type); }
        check(before === 4 && [...kinds].join() === 'fire' && w.powerups.filter((p) => p.sun).length === 1, 'elements 0: just one sun crystal, a fire one (the others go when the rule is switched off)');
        w.rules.sunCrystals = 0;
        tick(w);
        kinds = new Set(w.powerups.filter((p) => p.sun).map((p) => p.type));
        check(kinds.size === 0 && w.sunDue.size === 0, 'switching sunCrystals off mid-game clears them');
    }
    {
        // The random power-ups stay as they are: with the rule on they still fill up to powerupMax, and
        // with it off nothing is born and they spawn and drift exactly as without the sun-crystal code.
        const run = (rules, bare) => {
            const real = Math.random;
            Math.random = seeded(7);
            try {
                const w = new World('sky', 'local');
                Object.assign(w.rules, rules);
                if (bare) w.updateSunCrystals = () => {};
                const log = [];
                for (let s = 0; s < 3000; s++) for (const e of tick(w)) log.push(e.type);
                return { w, log, at: w.powerups.map((p) => [p.type, p.pos.x.toFixed(4), p.pos.y.toFixed(4), p.pos.z.toFixed(4)].join()) };
            } finally { Math.random = real; }
        };
        const on = run({}), off = run({ sunCrystals: 0 }), bare = run({ sunCrystals: 0 }, true);
        const random = on.w.powerups.filter((p) => !p.sun).length, sun = on.w.powerups.length - random;
        check(random === T.powerupMax && sun === 4, `rule on: ${random} random power-ups (powerupMax) plus ${sun} sun crystals on top`);
        check(off.at.length === T.powerupMax && !off.log.includes('sunCrystal') && off.w.sunDue.size === 0 && JSON.stringify(off.at) === JSON.stringify(bare.at) && off.log.join() === bare.log.join(),
            'sunCrystals 0: no sun crystals, and the random power-ups spawn and drift exactly as without them');
    }
    {
        // Bots still go for them, but only once one has drifted botSunGap m from the sun.
        const pick = (at) => {
            const w = new World('orb', 'local');
            Object.assign(w.rules, { botAggrMax: 0.5, pearls: 0, elements: 0 });
            w.ageStart = 0; w.botTarget = () => 1;
            managePopulation(w, true);
            const b = w.dragons[0];
            w.spawn(b, 600); b.protect = 0;
            b.pos.set(0, 0, -100);
            quatFromForwardUp(new Vector3(0, 0, 1), new Vector3(0, 1, 0), b.quat); b.updateFrame(); b.vdir.copy(b.fwd);
            b.pathHead = -1; b.pathCount = 0; b.lastPt.copy(b.pos);
            w.nextPowerup = Infinity;
            for (let s = 0; s < 3; s++) tick(w);
            const p = ofKind(w, 'fire')[0];
            p.pos.set(0, 0, at); p.hatch = 0;
            for (let k = 0; k < 40 && !b.brain.goal; k++) b.brain.treasure(w, b, 0.5);
            const wants = !!(b.brain.goal && b.brain.goal.t === p);
            let got = false;
            for (let i = 0; i < 8 * 30 && !got; i++) { w.step(1 / 30); got = w.events.some((e) => e.type === 'powerup' && e.d === b); }
            return { wants, got };
        };
        const near = pick(-30), out = [pick(-160), pick(-160), pick(-160)];
        check(!near.wants && out.every((r) => r.wants && r.got),
            `a big bot leaves a sun crystal ${T.botSunGap} m or less from the sun alone, and fetches one that has drifted out (${out.filter((r) => r.got).length}/3)`);
    }
    {
        // No camping: a busy sky doesn't crowd round the sun waiting for births
        // (it would without botSunGap). Bots near the sun swing a lot from run
        // to run, so this is two fixed seeds, averaged. Bot paths also depend
        // on dragon ids (which earlier tests use up) and on the machine's
        // floating point, so even seeded runs differ between machines: with
        // the rule off 1.1-3.7 bots sat within 50 m, with it on 0.8-4.5, and
        // without botSunGap 5.8-10.6. The check is that botSunGap takes away
        // at least half of the extra crowding, not a fixed margin over off.
        const busy = (rules, seed) => {
            const real = Math.random;
            Math.random = seeded(seed);
            try {
                const w = new World('sky', 'server');
                Object.assign(w.rules, { botAggrMax: 0.5 }, rules);
                w.botTarget = () => 25;
                w.spawnAmbient(T.orbTarget);
                w.ageStart = 0;
                managePopulation(w, true);
                let near = 0, n = 0, eaten = 0;
                const at = [];
                for (let i = 0; i < 90 * 30; i++) {
                    const was = w.powerups.filter((p) => p.sun);
                    w.step(1 / 30); managePopulation(w);
                    for (const p of was) if (!w.powerups.includes(p) && p.fade > 0) { eaten++; at.push(p.pos.distanceTo(w.arena.center)); }
                    if (i % 15 === 0) { n++; for (const d of w.dragons) if (d.alive && d.pos.distanceTo(w.arena.center) < 50) near++; }
                }
                at.sort((a, b) => a - b);
                return { near: near / n, eaten, median: at[at.length >> 1] || 0 };
            } finally { Math.random = real; }
        };
        const avg = (rules) => { const r = [3, 99].map((s) => busy(rules, s)); return { near: (r[0].near + r[1].near) / 2, eaten: Math.min(r[0].eaten, r[1].eaten), median: Math.min(r[0].median, r[1].median) }; };
        const off = avg({ sunCrystals: 0 }), on = avg({}), camp = avg({ botSunGap: 0 });
        check(on.eaten >= 10 && on.median > T.botSunGap - 15 && on.near - off.near <= (camp.near - off.near) / 2 && camp.near >= on.near + 2.5,
            `25 bots, 90 s: ${on.eaten}+ sun crystals eaten, half of them past ${on.median.toFixed(0)} m from the sun; ${on.near.toFixed(1)} bots within 50 m of the sun (${off.near.toFixed(1)} with the rule off, ${camp.near.toFixed(1)} camping without botSunGap)`);
    }
    {
        // Wire: sun crystals ride in the power-up list with three extra fields
        // (id, fade, s until catchable). An older browser (no caps) reads the
        // first five and sees each as a fire crystal; births go out as a 'sun'
        // event, which older browsers skip.
        const room = new Room({ id: 's', name: 'S', arena: 'orb', beginner: true }, { occupied() {}, emptied() {}, countHumans() {}, stats: { run() {} } });
        const join = (caps) => { const c = { got: [], send(m) { this.got.push(m); }, sendRaw(t) { this.got.push(JSON.parse(t)); } }; room.join(c, 'P', { caps }); return c; };
        room.ensureWorld(); const w = room.world;
        // The room's 10 s warm-up now and then feeds a crystal to a bot, and
        // it isn't reborn until after the warm-up: hatch any that's missing.
        for (const t of ['fire', 'ice', 'bolt', 'acid']) if (!w.powerups.some((p) => p.sun && p.type === t)) { w.sunDue.delete(t); w.sunBirth(t); }
        const oldC = join(undefined), newC = join(['el']);
        room.tick(); room.tick();
        const sunPu = (pu) => pu.filter((q) => q.length === 8 && q[5] > 0);
        const snap = (c) => c.got.filter((m) => m.t === 's').pop();
        const fresh = sunPu(snap(newC).pu), stale = sunPu(snap(oldC).pu);
        check(fresh.map((q) => q[0]).sort().join() === 'acid,bolt,fire,ice' && sunPu(newC.got[0].pu).length === 4
            && fresh.every((q) => q.every((v, i) => i === 0 || Number.isFinite(v)) && q[6] > 0 && q[6] <= 1 && q[7] >= 0),
            'snapshots and the welcome carry the four sun crystals: [type, x, y, z, spin, id, fade, hatch]');
        check(stale.length === 4 && stale.every((q) => q[0] === 'fire') && snap(oldC).pu.filter((q) => q.length === 5).length === snap(oldC).pu.length - 4,
            'an older browser gets them as four fire crystals (random ones keep their five fields)');
        w.powerups = w.powerups.filter((p) => !(p.sun && p.type === 'bolt'));
        w.sunDue.set('bolt', w.time);
        room.tick(); room.tick();
        const born = newC.got.filter((m) => m.t === 'e').flatMap((m) => m.ev).find((e) => e.k === 'sun');
        check(born && born.kind === 'bolt' && Math.hypot(born.x - w.arena.center.x, born.y - w.arena.center.y, born.z - w.arena.center.z) < 1e-6
            && oldC.got.filter((m) => m.t === 'e').flatMap((m) => m.ev).some((e) => e.k === 'sun'),
            'a birth goes out as a public \'sun\' event at the sun ({k, kind, id, x, y, z})');
    }
}

// Girth (rule girth): bigger dragons are fatter, and collide that way.
{
    const thin = (m) => T.radiusBase + T.radiusGrow * Math.min(1, m / 2000);   // the radius before the rule
    const massAt = (L) => (L - T.lenBase) / T.lenPerMass;
    const on = new World('orb', 'local'), off = new World('orb', 'local');
    off.rules.girth = 0;
    for (const [L, want] of [[12, 1], [100, 2], [300, 3]]) {
        const m = massAt(L), k = on.radius(m) / thin(m);
        check(Math.abs(k - want) < 0.01, `girth: at ${L} m long the radius is ×${k.toFixed(3)} (${on.radius(m).toFixed(2)} m)`);
    }
    const sizes = [10, 60, 230, 730, 980, 2000];
    const d = new Dragon('G', false), e = new Dragon('H', false);
    let same = sizes.every((m) => off.radius(m) === thin(m));
    for (const m of sizes) {
        off.spawn(d, m);
        same = same && d.r === thin(m) && d.beadSpacing === Math.max(0.2, T.beadSpacing * thin(m));
        d.mass = m + 40; off.upkeep(d, 1 / 30);
        same = same && d.r === thin(m + 40);
    }
    check(same, 'girth 0: the old radius and bead spacing at every size, at spawn and as it grows');
    on.spawn(e, massAt(300));
    check(Math.abs(e.r / thin(e.mass) - 3) < 0.01 && Math.abs(e.beadSpacing - T.beadSpacing * e.r) < 1e-9, `girth 1: a 300 m dragon spawns ${e.r.toFixed(2)} m thick, beads ${e.beadSpacing.toFixed(2)} m apart`);

    // A dragon of `mass` whose head is at `head`, its tail streaming straight out along +z.
    const lay = (w, dr, mass, head) => {
        w.spawn(dr, mass);
        dr.protect = 0;
        dr.pos.copy(head); dr.quat.set(0, 0, 0, 1); dr.updateFrame();
        dr.pathHead = -1; dr.pathCount = 0;
        for (let k = Math.ceil((dr.len + 2) / 0.5); k >= 0; k--) dr.pushPath(head.x, head.y, head.z + k * 0.5);
        dr.rebuildBeads();
        return dr;
    };
    // Put a's head `gap` m beside bead `bead` of b (negative = from the end); what happens?
    const meet = (girth, aMass, bMass, bead, gap) => {
        const w = new World('orb', 'local');
        w.rules.girth = girth;
        const a = new Dragon('A', false), b = new Dragon('B', false);
        lay(w, b, bMass, new Vector3(-5.4, 0.5, 0));
        lay(w, a, aMass, new Vector3(0, 100, 100));
        const i = (bead < 0 ? b.nBeads + bead : bead) * 3;
        a.pos.set(b.beads[i] + gap, b.beads[i + 1], b.beads[i + 2]);
        w.buildHash();
        w.collide();
        return w.events.some((x) => x.type === 'bite') ? 'bite' : a.alive ? 'miss' : 'death';
    };
    // How far from the tip bead a head still bites, by 2 cm steps.
    const reach = (girth, aMass, bMass) => { let g = 0; while (meet(girth, aMass, bMass, -1, g + 0.02) === 'bite') g += 0.02; return g; };
    for (const [aMass, bMass] of [[10, 730], [230, 230], [730, 20]]) {
        const r0 = reach(0, aMass, bMass), r1 = reach(1, aMass, bMass);
        check(r0 > 0.5 && r1 >= r0, `girth keeps tail-bite reach (L ${lengthOf(aMass)} m biting L ${lengthOf(bMass)} m: ${r0.toFixed(2)} m → ${r1.toFixed(2)} m)`);
    }
    // A bite takes what it did without the rule, though a fat tip is longer.
    const bitten = (girth) => {
        const w = new World('orb', 'local');
        w.rules.girth = girth;
        const a = new Dragon('A', false), b = new Dragon('B', false);
        lay(w, b, 730, new Vector3(-5.4, 0.5, 0)); lay(w, a, 10, new Vector3(0, 100, 100));
        const i = (b.nBeads - 1) * 3;
        a.pos.set(b.beads[i] + 0.3, b.beads[i + 1], b.beads[i + 2]);
        w.buildHash(); w.collide();
        return 730 - b.mass;
    };
    check(bitten(0) > 1 && bitten(1) === bitten(0), `girth: a bite still costs the victim ${bitten(1).toFixed(1)} mass`);
    // Fat bodies reach past the 4 m hash cells: 5.5 m from a 300 m body
    // (head + tail reach 6 m) is a hit with the rule on, clear with it off.
    check(meet(1, 730, 730, 60, 5.4) === 'death' && meet(0, 730, 730, 60, 5.4) === 'miss',
        'girth: a head 5.4 m from a fat 300 m body hits it (the hash cells grow); thin, it passes');
}

console.log(`\n${ok} sim checks passed`);
