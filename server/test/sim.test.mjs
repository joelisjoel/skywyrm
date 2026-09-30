// Unit tests for sim rules (no server): run with `npm test`.
import assert from 'node:assert/strict';
import { World, Dragon, T } from '../../docs/wyrm/js/shared.js';

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
console.log(`\n${ok} sim checks passed`);
