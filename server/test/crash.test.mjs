// Crash guard: an exception in one room's tick resets only that room (its
// players are dropped with close code 1011), one in a message closes only
// its sender, the other rooms keep running and the process stays up. First
// against a Registry in this process, then against the real server with
// bugs planted by poison-room.mjs.
// Run: cd server && npm test
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Registry } from '../rooms.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
const check = (cond, msg) => { assert.ok(cond, msg); ok++; console.log('  ✓', msg); };

// ------------------------------------------------ Registry, in process
{
    const logs = [];
    const store = { kind: 'memory', async loadAll() { return []; }, async save() {}, async remove() {} };
    const runs = [], stats = { run: (source, r) => runs.push(r), humans() {}, roomCreated() {} };
    const reg = new Registry(store, (...a) => logs.push(a.join(' ')), stats);
    await reg.init();
    const fake = () => ({ dragon: null, room: null, parkAt: 0, parked: null, sent: [], closed: null,
        send(m) { this.sent.push(m); return true; }, sendRaw(s) { this.sent.push(JSON.parse(s)); return true; }, close(code, reason) { this.closed = { code, reason }; } });
    const snaps = (c) => c.sent.filter((m) => m.t === 's').length;

    const good = reg.get('skyhold'), bad = reg.get('the-orb');
    const a = fake(), b = fake();
    good.join(a, 'Ann'); bad.join(b, 'Bea');
    bad.tick = () => { throw new Error('test: unit boom'); };
    for (let i = 0; i < 10; i++) reg.tick();
    check(b.closed && b.closed.code === 1011 && bad.humans === 0 && bad.world === null && b.dragon === null,
        'a room whose tick throws is reset: its players closed with 1011, its world freed');
    check(runs.length === 1 && runs[0].cause === 'disconnect' && runs[0].arena === 'orb', 'the lives it cut off are counted once, as disconnects');
    check(good.tickCount === 10 && snaps(a) === 5 && !a.closed, 'the other room keeps ticking and snapshotting');
    const logged = logs.filter((l) => l.includes('test: unit boom'));
    check(logged.length === 1 && logged[0].includes('error in room the-orb tick') && logged[0].includes('crash.test.mjs'),
        'the error is logged once with its stack, though it repeated every tick');
    for (const v of reg.errors.values()) v.at -= 61 * 1000;
    reg.sweep();
    check(logs.some((l) => l.includes('test: unit boom') && l.includes('repeated 9 more times')), 'the sweep reports how often it repeated');

    // Sweep: a room that throws is reset; the other rooms are still swept.
    delete bad.tick;
    const made = reg.create({ name: 'Old Room' }, '192.0.2.1');
    reg.get(made.room.id).meta.expireAt = Date.now() - 1;
    Object.defineProperty(bad, 'humans', { get() { throw new Error('test: sweep boom'); }, configurable: true });
    reg.sweep();
    delete bad.humans;
    check(logs.some((l) => l.includes('error in room the-orb sweep')) && !reg.get(made.room.id), 'sweep is guarded per room (an expired room is still removed)');

    // The reset room works again for the next player.
    const c = fake();
    bad.join(c, 'Cy');
    reg.tick(); reg.tick();
    check(c.sent[0].t === 'welcome' && snaps(c) === 1 && !c.closed && !a.closed, 'a reset room starts a fresh world on the next join');
}

// ------------------------------------------------ the real server, with planted bugs
const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = 'http://localhost:5173';
const srv = spawn(process.execPath, ['--import', pathToFileURL(path.join(here, 'poison-room.mjs')).href, path.join(here, '..', 'server.js')],
    { env: { ...process.env, PORT: String(PORT), STORE: 'memory' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
for (let i = 0; i < 100 && !out.includes('listening'); i++) await sleep(100);

const join = (room, name) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room}`, { headers: { origin: ORIGIN } });
    const c = { ws, welcome: null, snaps: 0, code: 0 };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name }));
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') { c.welcome = m; resolve(c); }
        if (m.t === 's') c.snaps++;
    };
    ws.onclose = (e) => { c.code = e.code; };
    ws.onerror = reject;
    setTimeout(() => reject(new Error('join timeout')), 8000);
});
const closed = async (c) => { for (let i = 0; i < 60 && !c.code; i++) await sleep(100); return c.code; };
const healthy = async () => (await (await fetch(BASE + '/healthz')).text()) === 'ok';
const count = (s) => out.split(s).length - 1;

try {
    assert.ok(out.includes('listening'), 'server did not start:\n' + out);
    const a = await join('skyhold', 'Ann');
    const b = await join('the-orb', 'Bea');
    check(await closed(b) === 1011, 'server: a player in the room whose tick throws is closed with 1011');
    const before = a.snaps;
    await sleep(700);
    check(a.ws.readyState === 1 && a.snaps - before >= 7, `server: the other room keeps snapshotting (${a.snaps - before} in 0.7 s)`);
    check(await healthy() && srv.exitCode === null, 'server: the process stays up');

    const b2 = await join('the-orb', 'Cy');
    await closed(b2);
    check(b2.code === 1011 && count('error in room the-orb tick') === 1 && out.includes('Error: test: poisoned tick\n    at '),
        'server: a repeat of the same error is not logged again; the first has its stack');

    // A message that throws closes only the socket that sent it: one crafted
    // message mustn't throw everyone else out of the room.
    const created = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Crashy' }) });
    const room = (await created.json()).room;
    const d = await join(room.id, 'Dee'), boom = await join(room.id, 'Boomer');
    boom.ws.send(JSON.stringify({ t: 'unpark' }));
    await closed(boom);
    const dBefore = d.snaps, before2 = a.snaps;
    await sleep(700);
    check(boom.code === 1011 && out.includes('error in room ' + room.id + ' message') && out.includes('Error: test: poisoned message'),
        'server: a message that throws closes its sender (1011), logged with its stack');
    check(d.ws.readyState === 1 && !d.code && d.snaps - dBefore >= 5, `server: the rest of that room plays on (${d.snaps - dBefore} snapshots in 0.7 s)`);
    check(a.ws.readyState === 1 && a.snaps > before2, 'server: other rooms are untouched');

    for (let i = 0; i < 20 && !out.includes('test: stray rejection'); i++) await sleep(100);
    check(out.includes('error in unhandled rejection') && out.includes('test: stray rejection') && await healthy(), 'server: an unhandled rejection is logged, not fatal');
    a.ws.close();
    console.log(`\n${ok} checks passed`);
} catch (e) {
    console.error('FAILED:', e.message, '\n--- server log ---\n' + out);
    process.exitCode = 1;
} finally {
    srv.kill();
}
