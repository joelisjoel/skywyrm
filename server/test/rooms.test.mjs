// Integration test: boots the server, exercises the lobby API, two players
// in one room, pose validation, events, and room lifecycle bookkeeping.
// Run: cd wyrm-server && npm test   (needs three at the repo root: npm i --no-save three@0.163.0)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = 'http://localhost:5173';
const srv = spawn(process.execPath, [path.join(here, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), STORE: 'memory' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !out.includes('listening'); i++) await sleep(100);
assert.ok(out.includes('listening'), 'server did not start:\n' + out);

const api = (p, opts = {}) => fetch(BASE + p, { ...opts, headers: { origin: ORIGIN, 'content-type': 'application/json', ...(opts.headers || {}) } });
let ok = 0;
const check = (cond, msg) => { assert.ok(cond, msg); ok++; console.log('  ✓', msg); };

try {
    // Lobby: three permanent rooms.
    let r = await (await api('/api/rooms')).json();
    check(r.rooms.length === 3 && r.rooms.every((x) => x.permanent), 'three permanent rooms listed');
    check(r.rooms.every((x) => x.beginner) && !r.rooms.some((x) => /beginner/i.test(x.name)),
        'every server is a beginner server; "beginner" is not part of a name');

    // Create: name checks.
    const bad = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Skyhold', arena: 'sky' }) });
    check(bad.status === 400, 'reserved room name rejected');
    const link = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'join www.spam.gg', arena: 'sky' }) });
    check(link.status === 400, 'room name with a link rejected');
    const evil = await api('/api/rooms', { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ name: 'Evil Room' }) });
    check(evil.status === 403, 'create from a foreign origin refused');
    const created = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: '  <b>Joel‮\'s</b>   Den ', arena: 'orb', beginner: true }) });
    const room = (await created.json()).room;
    check(created.status === 201 && room.name === "bJoel'sb Den" && room.arena === 'orb' && room.beginner, `room created and sanitised → "${room?.name}"`);
    const dupe = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: "bjoel'sb den" }) });
    check(dupe.status === 409, 'duplicate name (case-insensitive) rejected');
    await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Third One', beginner: false }) });
    await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Fourth One' }) });
    const limited = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Fifth One' }) });
    check(limited.status === 429, 'per-IP creation limit (3/hour) enforced');
    r = await (await api('/api/rooms')).json();
    check(r.rooms.find((x) => x.name === 'Third One')?.beginner === true, 'every new server is beginner, even if asked otherwise');

    // Two players join the created room.
    const join = (name) => new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room.id}`, { headers: { origin: ORIGIN } });
        const c = { ws, msgs: [], welcome: null, snaps: 0, last: null, events: [], dn: [], dx: [] };
        ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, perks: ['lungs', 'hack', 'pull', 'ember'], skin: 'jade' }));
        ws.onmessage = (e) => {
            const m = JSON.parse(e.data);
            if (m.t === 'welcome') { c.welcome = m; resolve(c); }
            if (m.t === 's') { c.snaps++; c.last = m; }
            if (m.t === 'e') c.events.push(...m.ev);
            if (m.t === 'dn') c.dn.push(m.d);
            if (m.t === 'dx') c.dx.push(m.id);
            c.msgs.push(m.t);
        };
        ws.onerror = reject;
        setTimeout(() => reject(new Error('join timeout')), 8000);
    });
    const a = await join('Alice <script>');
    const b = await join('B​ob');
    check(a.welcome.room.id === room.id && a.welcome.orbs.length > 1000, `welcome has room + ${a.welcome.orbs.length / 7} orbs`);
    const bInA = () => a.last && a.last.d.some((s) => s[0] === b.welcome.you);
    await sleep(700);
    check(bInA(), 'player A sees player B in snapshots');
    const meA = a.welcome.dragons.find((d) => d.id === a.welcome.you);
    check(meA && meA.c1 === 0x3DFFB5 && a.last.me.tm === 1.2, 'profile colours applied; perks re-checked server-side (Deep Lungs active)');
    const names = a.last.lb.map((x) => x[1]);
    const aName = a.welcome.dragons.find((d) => d.id === a.welcome.you)?.name ?? names.find((n) => n.startsWith('Alice'));
    check(a.snaps >= 6, `snapshots flowing (${a.snaps} in 0.7 s)`);
    r = await (await api('/api/rooms')).json();
    const listed = r.rooms.find((x) => x.id === room.id);
    check(listed.humans === 2 && listed.bots >= 3, `lobby shows 2 players + ${listed.bots} bots`);

    // Speed check: teleport claim gets clamped and corrected.
    const me = a.last.d.find((s) => s[0] === a.welcome.you);
    a.ws.send(JSON.stringify({ t: 'p', x: me[1] + 400, y: me[2], z: me[3], qx: 0, qy: 0, qz: 0, qw: 1, s: 16, bk: 0, b: 0, k: 0, f: 0 }));
    let corrected = false;
    for (let i = 0; i < 20 && !corrected; i++) { await sleep(60); corrected = !!(a.last && a.last.me && a.last.me.c); }
    const after = a.last.d.find((s) => s[0] === a.welcome.you);
    check(corrected && Math.abs(after[1] - me[1]) < 30, `teleport clamped (moved ${Math.abs(after[1] - me[1]).toFixed(1)} m, correction sent)`);

    // Garbage and oversize messages don't crash anything.
    a.ws.send('not json'); a.ws.send(JSON.stringify({ t: 'p', x: 'NaN' })); a.ws.send(JSON.stringify([1, 2, 3]));
    await sleep(200);
    check(a.ws.readyState === 1, 'bad messages ignored, connection still open');
    const big = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room.id}`, { headers: { origin: ORIGIN } });
    await new Promise((res) => { big.onopen = () => big.send('x'.repeat(5000)); big.onclose = res; setTimeout(res, 2000); });
    check(big.readyState === 3, 'oversize message closes the connection');

    // Foreign origin can't open a socket.
    const foreign = await new Promise((res) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room.id}`, { headers: { origin: 'https://evil.example' } });
        ws.onopen = () => res('open'); ws.onerror = () => res('refused'); ws.onclose = () => res('refused');
    });
    check(foreign === 'refused', 'socket from a foreign origin refused');

    // Fold wings (Esc online): a countdown, then the dragon leaves the sky
    // with its length kept, and unpark flies it back in.
    const you = a.welcome.you;
    const massBefore = a.last.d.find((s) => s[0] === you)[8];
    a.ws.send(JSON.stringify({ t: 'park' }));
    await sleep(300);
    check(a.events.some((e) => e.k === 'parking') && a.last.d.some((s) => s[0] === you), 'park starts a 3 s countdown (still in the sky)');
    for (let i = 0; i < 40 && !a.events.some((e) => e.k === 'parked'); i++) await sleep(100);
    await sleep(200);
    check(b.dx.includes(you) && b.events.some((e) => e.k === 'land' && e.id === you) && !b.last.d.some((s) => s[0] === you),
        'after the countdown the dragon leaves the sky; others see it land');
    a.ws.send(JSON.stringify({ t: 'spawn' }));
    await sleep(300);
    check(!a.dn.some((d) => d.id === you), 'a parked dragon can\'t respawn fresh (no length reset)');
    a.ws.send(JSON.stringify({ t: 'unpark' }));
    let back = null;
    for (let i = 0; i < 40 && !back; i++) { await sleep(100); back = a.dn.find((d) => d.id === you); }
    check(back && Math.abs(back.s[8] - massBefore) < 2 && b.dn.some((d) => d.id === you), `unpark flies back in with its length (${massBefore} → ${back?.s[8]})`);

    // Lifecycle: when both leave, the room gets a 12 h expiry.
    a.ws.close(); b.ws.close();
    await sleep(400);
    r = await (await api('/api/rooms')).json();
    check(r.rooms.some((x) => x.id === room.id && x.humans === 0), 'empty user room still listed (lives 12 h after last leave)');
    console.log(`\n${ok} checks passed`);
} catch (e) {
    console.error('FAILED:', e.message, '\n--- server log ---\n' + out);
    process.exitCode = 1;
} finally {
    srv.kill();
}
