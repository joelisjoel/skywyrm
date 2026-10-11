// Unit tests for the anonymous play totals (stats.js): run-note checks,
// a save/load round-trip through the memory store, the 30-day window, and
// room lives counted as they end. Run with `npm test`.
import assert from 'node:assert/strict';
import { Stats, cleanRun, KEEP_DAYS } from '../stats.js';
import { makeStore } from '../store.js';
import { Registry } from '../rooms.js';

let ok = 0;
const check = (cond, msg) => { assert.ok(cond, msg); ok++; console.log('  ✓', msg); };
const DAY = 24 * 3600 * 1000;
const T0 = Date.parse('2026-10-11T12:00:00Z');

// Run notes from browsers.
{
    const run = cleanRun({ v: 1, mode: 'solo', arena: 'orb', len: 42.4, secs: 95.6, kills: 2, cause: 'body', name: 'Ember Drake' });
    check(JSON.stringify(run) === '{"arena":"orb","len":42,"secs":96,"kills":2,"cause":"body"}', 'a run note keeps only its five numbers and words, rounded');
    const big = cleanRun({ v: 1, mode: 'solo', arena: 'sky', len: 1e9, secs: -5, kills: 1e6, cause: 'toString' });
    check(big.len === 2000 && big.secs === 0 && big.kills === 500 && big.cause === 'other', 'out-of-range numbers are clamped; an unknown cause is "other"');
    check([null, [], 'x', { v: 2, mode: 'solo', arena: 'sky', len: 1, secs: 1, kills: 0 }, { v: 1, mode: 'room', arena: 'sky', len: 1, secs: 1, kills: 0 },
        { v: 1, mode: 'solo', arena: 'moon', len: 1, secs: 1, kills: 0 }, { v: 1, mode: 'solo', arena: 'sky', len: '12', secs: 1, kills: 0 },
        { v: 1, mode: 'solo', arena: 'sky', len: 1, secs: NaN, kills: 0 }, { v: 1, mode: 'solo', arena: 'sky', len: 1, secs: 1 }].every((b) => cleanRun(b) === null),
    'notes with a wrong version, mode, world or a missing/non-number field are refused');
}

// Totals survive a save and reload (a restart or deploy).
{
    const store = await makeStore(() => {});
    let now = T0;
    const a = new Stats(store, () => {}, () => now);
    await a.init();
    a.run('solo', { arena: 'orb', len: 12, secs: 30, kills: 0, cause: 'wall' });
    a.run('solo', { arena: 'sky', len: 230, secs: 600, kills: 7, cause: 'headon' });
    a.run('room', { arena: 'sky', len: 60, secs: 120, kills: 1, cause: 'disconnect' });
    a.humans(3); a.humans(2); a.roomCreated();
    const s = a.list()[0];
    check(s.day === '2026-10-11' && s.solo.runs === 2 && s.solo.secs === 630 && s.solo.kills === 7 && s.solo.maxLen === 230,
        'solo runs add up (runs, seconds, kills, longest)');
    check(s.solo.len['0-15'] === 1 && s.solo.len['200+'] === 1 && s.solo.cause.wall === 1 && s.solo.cause.headon === 1 && s.solo.arena.orb === 1,
        'length histogram, end causes and worlds are counted');
    check(s.room.runs === 1 && s.room.cause.disconnect === 1 && s.peakHumans === 3 && s.roomsCreated === 1, 'room lives, peak players and rooms created are kept apart from solo');
    await a.flush();
    const b = new Stats(store, () => {}, () => now);
    await b.init();
    check(JSON.stringify(b.list()) === JSON.stringify(a.list()), 'the day comes back unchanged from the store');

    // The next UTC day starts fresh; days older than KEEP_DAYS are forgotten and deleted.
    now = T0 + DAY;
    b.run('solo', { arena: 'sky', len: 20, secs: 40, kills: 0, cause: 'quit' });
    check(b.list().length === 2 && b.list()[0].day === '2026-10-12' && b.list()[0].solo.runs === 1 && b.list()[1].solo.runs === 2, 'a new day gets its own totals, newest first');
    await b.flush();
    now = T0 + KEEP_DAYS * DAY;
    b.run('solo', { arena: 'sky', len: 20, secs: 40, kills: 0, cause: 'quit' });
    await b.flush();
    const days = (await store.loadStats()).map((d) => d.day).sort();
    check(!b.list().some((d) => d.day === '2026-10-11') && days.join() === '2026-10-12,2026-11-10', `only the last ${KEEP_DAYS} days are kept, in memory and in the store`);

    // A broken store can't take the server down.
    // (store.js's safe() turns a failed load into null; a save that throws anyway is caught here.)
    const broken = { loadStats: async () => null, saveStats: async () => { throw new Error('down'); }, removeStats: async () => { throw new Error('down'); } };
    const c = new Stats(broken, () => {}, () => now);
    await c.init();
    c.run('solo', { arena: 'sky', len: 20, secs: 40, kills: 0, cause: 'quit' });
    let threw = false;
    try { await c.flush(); } catch { threw = true; }
    check(!threw && c.list()[0].solo.runs === 1, 'a failing save is logged, not thrown');
}

// Room lives: counted once, when they end, under 'room'.
{
    const store = await makeStore(() => {});
    const stats = new Stats(store);
    const reg = new Registry(store, () => {}, stats);
    await reg.init();
    const room = reg.get('the-orb');
    const client = () => ({ send() {}, sendRaw() {}, dragon: null, room: null, parkAt: 0, parked: null });
    const today = () => stats.list()[0];

    const a = client();
    room.join(a, 'Tester');
    check(today().peakHumans === 1, 'joining a room counts towards the day\'s peak players');
    room.tick();
    a.dragon.pos.set(1000, 0, 0);            // past the glass shell
    a.dragon.net = null;
    room.tick();
    check(!a.dragon.alive && today().room.runs === 1 && today().room.cause.wall === 1 && today().room.arena.orb === 1 && today().solo.runs === 0,
        'a death in a room is counted under room (hit the wall)');
    room.leave(a);
    check(today().room.runs === 1, 'leaving after dying doesn\'t count that life again');

    const b = client(), c = client();
    room.join(b, 'Flier'); room.join(c, 'Dropper');
    room.leave(b, 'quit');
    room.leave(c, 'disconnect');
    check(today().room.runs === 3 && today().room.cause.quit === 1 && today().room.cause.disconnect === 1, 'leaving with a dragon in the sky ends its life: quit or disconnect');

    // Fold wings and come back: one life; the peak from before the park
    // survives it, and time parked isn't time played.
    const p = client();
    room.join(p, 'Parker');
    p.dragon.protect = 999;                          // no bot ends this life early
    for (let i = 0; i < 30; i++) room.tick();        // 1 s flying
    p.dragon.mass = 80; p.dragon.peakMass = 120;     // grew to 56 m, shrank to 40 m
    room.park(p);
    for (let i = 0; i < 4 * 30; i++) room.tick();    // 3 s countdown (flying), then parked
    const parked = !!p.parked;
    room.unpark(p);
    for (let i = 0; i < 3 * 30; i++) room.tick();    // back in the sky after 2 s parked
    check(parked && p.dragon.alive && !p.parked && today().room.runs === 3, 'parking and flying back in doesn\'t end the life');
    for (let i = 0; i < 30; i++) room.tick();
    room.leave(p);
    const r = today().room;
    check(r.runs === 4 && r.maxLen >= 56 && r.secs >= 6 && r.secs <= 7, `then leaving counts it once, with its peak (${r.maxLen} m) and flying time only (${r.secs} s of 9)`);
}

console.log(`\n${ok} checks passed`);
