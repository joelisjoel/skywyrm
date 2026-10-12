// The browser's online client (site/js/net.js NetGame) reconnecting to the
// real server, run in Node (which has WebSocket and fetch): a dropped socket
// comes back to the same dragon, a server restart (4010) to a new one, a
// room that's gone ends the session, and a drop while dead waits for wake().
// Run: cd server && npm test
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { NetGame } from '../../site/js/net.js';

globalThis.document ??= { hidden: false };               // net.js checks for a hidden tab

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 26000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
const check = (cond, msg) => { assert.ok(cond, msg); ok++; console.log('  ✓', msg); };

let srv = null, out = '';
async function start() {
    srv = spawn(process.execPath, [path.join(here, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), STORE: 'memory' }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
    for (let i = 0; i < 100 && !srv.started; i++) { await sleep(100); srv.started = out.split('listening').length > starts; }
    starts++;
    assert.ok(srv.started, 'server did not start:\n' + out);
}
let starts = 1;
const stop = (sig) => new Promise((r) => { if (srv.exitCode !== null || srv.signalCode !== null) return r(); srv.once('exit', r); srv.kill(sig); });
const until = async (f, ms = 10000) => { for (let t = 0; t < ms && !f(); t += 50) await sleep(50); return f(); };

// A NetGame with hooks that record what happened.
function game(room, keep = () => true) {
    const ev = [];
    const g = new NetGame(BASE, room, 'Ann', { perks: [], skin: '' }, {
        onWelcome: (w, p) => ev.push({ k: 'welcome', p }),
        onRespawn: () => {},
        onDrop: () => { ev.push({ k: 'drop' }); return keep(); },
        onRejoin: (w, p, info) => ev.push({ k: 'rejoin', p, info }),
        onClose: (reason) => ev.push({ k: 'close', reason }),
    });
    g.ev = ev;
    g.last = (k) => ev.filter((e) => e.k === k).at(-1);
    return g;
}

const games = [];
try {
    await start();
    const g = game('skyhold');
    games.push(g);
    await until(() => g.last('welcome'));
    const p0 = g.player, id0 = g.you;
    check(g.last('welcome') && typeof g.token === 'string' && g.token.length === 22, 'joins and keeps the resume token');
    // Sun crystals (rule sunCrystals): this client knows the elements, keeps
    // each by its id from snapshot to snapshot, and moves it along its samples.
    const suns = () => g.world.powerups.filter((p) => p.sun > 0);
    await until(() => suns().length >= 3);
    const seen = new Map(suns().map((p) => [p.sun, p]));
    await until(() => suns().some((p) => seen.get(p.sun) === p && p.samples.length >= 2));
    g.update(0);
    const kinds = suns().map((p) => p.type);
    check(kinds.length >= 3 && new Set(kinds).size === kinds.length && kinds.every((k) => ['fire', 'ice', 'bolt', 'acid'].includes(k))
        && suns().some((p) => seen.get(p.sun) === p) && suns().every((p) => p.fade > 0 && p.fade <= 1 && Number.isFinite(p.pos.x)),
        `sun crystals arrive with their elements (${kinds.join(', ')}), each kept by id across snapshots`);

    // A blip: the socket closes; the client reconnects to the same dragon.
    const sent = [], send = g.send.bind(g);
    g.send = (m) => { sent.push(m); send(m); };
    g.ws.close(4001, 'test');
    await until(() => g.last('rejoin'));
    let r = g.last('rejoin');
    check(g.ev.some((e) => e.k === 'drop') && r && r.info.resumed && r.p === p0 && g.you === id0 && !g.reconnecting,
        'a dropped socket reconnects at once to the same dragon (same object, same id)');
    const hello = sent.find((m) => m.t === 'hello');
    check(hello && typeof hello.resume === 'string' && hello.caps.includes('el') && hello.name === 'Ann', 'the reconnect\'s hello carries the token and caps');

    // Silence: the socket looks open but nothing arrives.
    g.heard = performance.now() - 7000;
    g.update(1 / 60);
    const n = g.ev.filter((e) => e.k === 'rejoin').length;
    await until(() => g.ev.filter((e) => e.k === 'rejoin').length > n);
    check(g.last('rejoin').info.resumed && g.player === p0, '6 s of silence counts as a drop, and it comes back');

    // A server restart: 4010, retries while it's down, then a new dragon.
    const t0 = Date.now();
    const rejoins = g.ev.filter((e) => e.k === 'rejoin').length;
    await stop('SIGTERM');
    await sleep(1200);
    check(g.reconnecting && !g.last('close'), 'while the server is down it keeps trying');
    await start();
    await until(() => g.ev.filter((e) => e.k === 'rejoin').length > rejoins, 15000);
    r = g.last('rejoin');
    check(r && !r.info.resumed && r.info.restarted && r.p !== p0 && r.p.alive && Date.now() - t0 < 20000,
        `after a restart (4010): back in ${((Date.now() - t0) / 1000).toFixed(1)} s with a new dragon, told it was a restart`);

    // Dead when the socket drops: wait until the next life wakes it.
    const dead = game('skyhold', () => false);
    games.push(dead);
    await until(() => dead.last('welcome'));
    dead.ws.close(4001, 'test');
    await until(() => dead.last('drop'));
    await sleep(1000);
    check(dead.dormant && dead.reconnecting && !dead.last('rejoin') && !dead.last('close'), 'dropped while dead: no reconnect yet');
    dead.wake();
    await until(() => dead.last('rejoin'));
    check(dead.last('rejoin') && !dead.reconnecting, 'wake() reconnects for the next life');

    // A room that's gone (a restart without Firestore forgets it): stop at once.
    const res = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Brief Room' }) });
    const room = (await res.json()).room;
    const gone = game(room.id);
    games.push(gone);
    await until(() => gone.last('welcome'));
    await stop('SIGTERM');
    await start();
    const t1 = Date.now();
    await until(() => gone.last('close'), 15000);
    check(gone.last('close') && gone.last('close').reason === 'That server has closed' && Date.now() - t1 < 8000, 'a room that no longer exists ends the session instead of retrying for 30 s');

    // Leaving on purpose: no reconnect.
    const n2 = g.ev.length;
    g.close();
    await sleep(800);
    check(g.ev.length === n2, 'leaving (close) doesn\'t reconnect or report a drop');
    console.log(`\n${ok} checks passed`);
} catch (e) {
    console.error('FAILED:', e.message, '\n--- server log ---\n' + out);
    process.exitCode = 1;
} finally {
    for (const x of games) x.close();
    await stop('SIGKILL');
}
