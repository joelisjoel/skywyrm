// Reconnect: a dropped player's dragon stays in the sky for the 3 s
// countdown (still hittable), then folds away and its seat is held for 30 s
// under the player's resume token. First a Registry in this process, ticked
// by hand so the clock is exact; then the real server over real sockets,
// including the 4010 close on SIGTERM.
// Run: cd server && npm test
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '../client.js';
import { Registry } from '../rooms.js';
import { T } from '../../site/js/shared.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
const check = (cond, msg) => { assert.ok(cond, msg); ok++; console.log('  ✓', msg); };

// ------------------------------------------------ Registry, in process
{
    const store = { kind: 'memory', async loadAll() { return []; }, async save() {}, async remove() {} };
    T.popMax = 0;                                // no bots: nothing moves but the test, so no one dies by chance
    const runs = [], stats = { run: (source, r) => runs.push(r), humans() {}, roomCreated() {} };   // lives as they're counted
    const reg = new Registry(store, () => {}, stats);
    await reg.init();
    const room = reg.get('skyhold');
    const fakeWs = () => ({ readyState: 1, bufferedAmount: 0, frames: [], closed: null,
        send(s) { this.frames.push(JSON.parse(s)); }, close(code, reason) { this.closed = { code, reason }; this.readyState = 2; } });
    const conn = (name, resume, r = room) => { const c = new Client(fakeWs()); r.join(c, name, { resume, caps: ['el'] }); return c; };
    const welcome = (c) => c.ws.frames.find((m) => m.t === 'welcome');
    const secs = (s) => { for (let i = 0; i < Math.round(s * 30); i++) room.tick(); };
    const dn = (c, id) => c.ws.frames.some((m) => m.t === 'dn' && m.d.id === id);
    const dx = (c, id) => c.ws.frames.some((m) => m.t === 'dx' && m.id === id);
    const inSky = (d) => room.world.byId.get(d.id) === d && d.alive;
    const dropped = [], loot = (d) => dropped.filter((x) => x === d).length;   // loot drops per dragon (bots die too)

    const a = conn('Ann'), b = conn('Bea');
    const w = room.world;
    const dropLoot = w.dropLoot;
    w.dropLoot = function (d, ...x) { dropped.push(d); return dropLoot.call(this, d, ...x); };
    const ad = a.dragon;
    check(/^[A-Za-z0-9_-]{22}$/.test(welcome(a).resume) && welcome(a).resume !== welcome(b).resume && !welcome(a).resumed,
        'welcome carries a resume token (128 bits, one per player)');

    // Drop, back within the countdown: same dragon, never left the sky.
    ad.mass = 60; ad.kills = 2;
    secs(1);
    const mass1 = ad.mass, at = ad.pos.clone();
    b.ws.frames.length = 0;
    const lifeA = a.life;
    room.leave(a, 'disconnect', { hold: true });
    secs(1);
    check(inSky(ad) && room.humans === 2 && room.summary().humans === 2, 'after a drop the dragon stays in the sky, and the seat still counts as a player');
    const a2 = conn('Ann', welcome(a).resume);
    check(welcome(a2).resumed === 1 && welcome(a2).you === ad.id && a2.dragon === ad && Math.abs(ad.mass - mass1) < 2 && ad.pos.distanceTo(at) < 0.01,
        'reconnect within 3 s: the same dragon carries on where it was');
    check(!dx(b, ad.id) && !dn(b, ad.id) && room.humans === 2, 'others never lose it (no dx/dn)');
    check(runs.length === 0 && a2.life && a2.life === lifeA, 'play totals: a held seat isn\'t an ended life, and the resumed one carries on');

    // Drop, back after the countdown: it folded away (no loot) and comes back like unpark.
    ad.fire = 3; ad.element = 'ice';                       // holding three ice crystals
    room.leave(a2, 'disconnect', { hold: true });
    secs(3.2);
    check(!inSky(ad) && dx(b, ad.id) && b.ws.frames.some((m) => m.t === 'e' && m.ev.some((e) => e.k === 'land' && e.id === ad.id)) && loot(ad) === 0,
        'after 3 s it leaves the sky like folded wings (others see it land), dropping no loot');
    const mass2 = ad.mass;
    secs(10);
    b.ws.frames.length = 0;
    const a3 = conn('Ann', welcome(a2).resume);
    check(welcome(a3).resumed === 1 && welcome(a3).you === ad.id && inSky(ad) && ad.mass === mass2 && ad.kills === 2 && ad.protect > 0,
        `reconnect within 30 s: back with its length (${mass2}) and kills, at a safe spot with spawn protection`);
    check(ad.fire === 3 && ad.element === 'ice' && a3.el && !ad.fireOnly, 'it keeps its crystals (3 ice charges), and the new hello\'s caps apply');
    check(dn(b, ad.id) && b.ws.frames.find((m) => m.t === 'dn' && m.d.id === ad.id).d.s[8] === mass2, 'others see it fly back in (dn)');
    check(runs.length === 0 && a3.life && a3.life.secs > 0, 'still one life, not counted, after folding away and coming back');

    // Tokens: single use, per room, unguessable.
    const reuse = conn('Ann', welcome(a2).resume);
    check(!welcome(reuse).resumed && reuse.dragon !== ad && a3.dragon === ad && !a3.ws.closed, 'a used token starts a fresh dragon (and doesn\'t touch the one it resumed)');
    const forged = conn('Eve', 'AAAAAAAAAAAAAAAAAAAAAA');
    check(!welcome(forged).resumed && forged.dragon.mass === 10, 'a forged token starts a fresh dragon');
    const orb = reg.get('the-orb'), elsewhere = conn('Ann', welcome(a3).resume, orb);
    check(!welcome(elsewhere).resumed && !a3.ws.closed && a3.dragon === ad, 'a token from another room does nothing there');
    orb.leave(elsewhere, 'quit');
    check(runs.length === 1 && runs[0].cause === 'quit' && runs[0].arena === 'orb', 'leaving on purpose counts the life at once (quit)');

    // Leaving on purpose: still in the sky for 3 s, then the loot falls once.
    const humans = room.humans;
    room.leave(forged, 'quit');
    secs(1);
    check(inSky(forged.dragon) && loot(forged.dragon) === 0, 'leaving on purpose doesn\'t dodge a kill: 3 s more in the sky');
    secs(2.2);
    check(!room.world.byId.has(forged.dragon.id) && loot(forged.dragon) === 1 && dx(b, forged.dragon.id) && room.humans === humans - 1, 'then it drops its loot and goes, seat freed');
    check(!welcome(conn('Eve', welcome(forged).resume)).resumed, 'a player who left on purpose can\'t be resumed');
    const rude = conn('Rex');
    room.leave(rude, 'disconnect');                     // sent away (4008): not held
    check(inSky(rude.dragon) && !room.seatFor(welcome(rude).resume), 'nor can one the server sent away (4008), though their dragon stays its 3 s');
    check(runs.length === 3 && runs[1].cause === 'quit' && runs[2].cause === 'disconnect', 'both lives counted as they left (quit, disconnect)');
    secs(3.2);

    // Killed during the countdown: the loot falls once, nothing to resume.
    const rd = reuse.dragon;
    room.leave(reuse, 'disconnect', { hold: true });
    rd.protect = 0; rd.pos.set(1000, 50, 0);               // flown into the storm wall
    secs(0.1);
    check(loot(rd) === 1 && dx(b, rd.id) && !room.world.byId.has(rd.id), 'killed during the countdown: loot falls, it leaves the sky');
    check(runs.length === 4 && runs[3].cause === 'wall', 'and its life is counted as the death it was');
    secs(3.5);
    const after = conn('Ann', welcome(reuse).resume);
    check(loot(rd) === 1 && !welcome(after).resumed && after.dragon !== rd && runs.length === 4, 'no second loot drop or count, and nothing to resume');

    // Not back within 30 s: forgotten.
    room.leave(a3, 'disconnect', { hold: true });
    secs(3.2 + 29);
    check(room.held.size === 1, 'the seat is still held at 32 s');
    secs(1.5);
    const late = conn('Ann', welcome(a3).resume);
    check(room.held.size === 0 && !welcome(late).resumed && late.dragon !== ad, 'after 30 s folded the seat is forgotten: a fresh dragon');
    const lost = runs[4];
    check(runs.length === 5 && lost.cause === 'disconnect' && lost.len === 32 && lost.kills === 2 && lost.secs < 30,
        `the forgotten seat ends that life: counted once as a disconnect, ${lost.len} m, ${lost.secs} s in the sky (time folded doesn't count)`);

    // The browser noticed the drop before the server did: the new socket takes over.
    const ld = late.dragon;
    const again = conn('Ann', welcome(late).resume);
    check(welcome(again).resumed && again.dragon === ld && late.ws.closed && late.ws.closed.code === 4011 && !room.clients.has(late),
        'a token whose old socket is still open takes the dragon over (old socket closed 4011)');
    const n = room.humans;
    room.leave(late, 'disconnect', { hold: true });
    check(room.humans === n && inSky(ld), 'the replaced socket closing later changes nothing');

    // Folded wings, then a drop: it stays folded when it comes back.
    room.park(again);
    secs(3.2);
    check(again.parked && !room.world.byId.has(ld.id), 'parked (Esc)');
    room.leave(again, 'disconnect', { hold: true });
    secs(5);
    b.ws.frames.length = 0;
    const back = conn('Ann', welcome(again).resume);
    check(welcome(back).resumed && welcome(back).parked === 1 && back.parked && !room.world.byId.has(ld.id) && !dn(b, ld.id),
        'a player who had folded their wings comes back still folded');
    room.unpark(back);
    secs(0.2);
    check(inSky(ld) && dn(b, ld.id), 'and flies back in on unpark');

    // A drop mid-countdown keeps the countdown.
    room.park(back);
    secs(1);
    room.leave(back, 'disconnect', { hold: true });
    const mid = conn('Ann', welcome(back).resume);
    check(mid.parkAt > 0 && mid.ws.frames.some((m) => m.t === 'e' && m.ev.some((e) => e.k === 'parking' && e.in > 1.5 && e.in < 2.1)),
        'a drop during the fold-wings countdown resumes the countdown where it was');
    room.leave(mid, 'disconnect', { hold: true });
    const seat = [...room.held.values()][0], counted = runs.length;
    reg.endLives('disconnect');                             // SIGTERM
    check(room.held.size === 1 && !seat.life && runs.length === counted + room.clients.size + 1 && runs.at(-1).cause === 'disconnect',
        'shutting down counts held seats\' lives too');
    const total = runs.length;
    secs(35);
    check(room.held.size === 0 && runs.length === total, 'and a seat counted that way isn\'t counted again when it\'s forgotten');
    room.leave(conn('Zed'), 'disconnect', { hold: true });
    room.reset();
    check(room.held.size === 0 && room.humans === 0 && runs.length === total + 1, 'a room reset counts and forgets held seats too');
}

// ------------------------------------------------ the real server
const PORT = 25000 + Math.floor(Math.random() * 1000);
const ORIGIN = 'http://localhost:5173';
const srv = spawn(process.execPath, [path.join(here, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), STORE: 'memory' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
for (let i = 0; i < 100 && !out.includes('listening'); i++) await sleep(100);
const exited = new Promise((r) => srv.on('exit', (code) => r(code)));

const join = (name, resume) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=the-orb`, { headers: { origin: ORIGIN } });
    const c = { ws, welcome: null, dn: [], dx: [], code: 0 };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, ...(resume ? { resume } : {}) }));
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') { c.welcome = m; resolve(c); }
        if (m.t === 'dn') c.dn.push(m.d.id);
        if (m.t === 'dx') c.dx.push(m.id);
    };
    ws.onclose = (e) => { c.code = e.code; };
    ws.onerror = reject;
    setTimeout(() => reject(new Error('join timeout')), 8000);
});

try {
    assert.ok(out.includes('listening'), 'server did not start:\n' + out);
    const a = await join('Ann'), b = await join('Bea');
    a.ws.close(4001, 'no data');
    await sleep(300);
    const a2 = await join('Ann', a.welcome.resume);
    await sleep(200);
    check(a2.welcome.resumed === 1 && a2.welcome.you === a.welcome.you && !b.dx.includes(a.welcome.you) && !b.dn.includes(a.welcome.you),
        'server: a dropped socket reconnects with its token to the same dragon; others never lose it');
    check(!out.includes(a.welcome.resume) && !out.includes(a2.welcome.resume), 'server: tokens are never logged');
    srv.kill('SIGTERM');
    const code = await exited;
    await sleep(100);
    check(a2.code === 4010 && b.code === 4010 && code === 0, 'server: SIGTERM closes every socket with 4010 (server restarting), then exits');
    console.log(`\n${ok} checks passed`);
} catch (e) {
    console.error('FAILED:', e.message, '\n--- server log ---\n' + out);
    process.exitCode = 1;
} finally {
    srv.kill();
}
