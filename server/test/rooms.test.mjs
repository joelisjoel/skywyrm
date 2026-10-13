// Integration test: boots the server, exercises the lobby API, solo run
// notes and the public totals, two players in one room, pose validation,
// events, and room lifecycle bookkeeping.
// Run: cd server && npm test   (needs `npm install` at the repo root first, for three)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Registry } from '../rooms.js';
import { isRoomName, ROOM_ADJECTIVES, ROOM_NOUNS } from '../../site/js/shared.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = 'http://localhost:5173';
const srv = spawn(process.execPath, [path.join(here, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), STORE: 'memory' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Polls cond (which may be async) until it's truthy or ms pass, and returns
// its last value. Tests wait for what they check, not for a fixed time, so
// a slow machine only makes them slower.
const waitFor = async (cond, ms = 8000, step = 50) => {
    const end = Date.now() + ms;
    for (;;) { const v = await cond(); if (v || Date.now() >= end) return v; await sleep(step); }
};
for (let i = 0; i < 100 && !out.includes('listening'); i++) await sleep(100);
assert.ok(out.includes('listening'), 'server did not start:\n' + out);

const api = (p, opts = {}) => fetch(BASE + p, { ...opts, headers: { origin: ORIGIN, 'content-type': 'application/json', ...(opts.headers || {}) } });
let ok = 0;
const check = (cond, msg) => { assert.ok(cond, msg); ok++; console.log('  ✓', msg); };

try {
    // Lobby: four permanent rooms: Skyhold and The Orb, each with a Fight mode twin listed just after it.
    let r = await (await api('/api/rooms')).json();
    check(r.rooms.length === 4 && r.rooms.every((x) => x.permanent)
        && r.rooms.map((x) => `${x.id}:${x.fight}`).join() === 'skyhold:false,skyhold-fight:true,the-orb:false,the-orb-fight:true',
        'four permanent rooms listed in order: Skyhold, Skyhold Fight, The Orb, The Orb Fight (the Fight ones play fight mode)');
    check(r.rooms.every((x) => x.beginner) && !r.rooms.some((x) => /beginner/i.test(x.name)),
        'every server is a beginner server; "beginner" is not part of a name');

    // Create: names come from the list in names.js. Whatever a client asks
    // for (old cached clients send free text) never fails a create.
    const create = async (body, ip) => {
        const res = await api('/api/rooms', { method: 'POST', headers: ip ? { 'x-forwarded-for': ip } : {}, body: JSON.stringify(body) });
        return { status: res.status, room: (await res.json()).room };
    };
    const evil = await api('/api/rooms', { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ name: 'Evil Room' }) });
    check(evil.status === 403, 'create from a foreign origin refused');
    const created = await create({ name: '  <b>Joel‮\'s</b>   Den ', arena: 'orb', beginner: true });
    const room = created.room;
    check(created.status === 201 && isRoomName(room.name) && room.arena === 'orb' && room.beginner, `free text gets a list name → "${room?.name}"`);
    const reserved = await create({ name: 'Skyhold', arena: 'sky' });
    check(reserved.status === 201 && isRoomName(reserved.room.name), `reserved name gets a list name → "${reserved.room?.name}"`);
    const link = await create({ name: 'join www.spam.gg', arena: 'sky' });
    check(link.status === 201 && isRoomName(link.room.name), `name with a link gets a list name → "${link.room?.name}"`);
    const limited = await create({ name: 'Fourth One' });
    check(limited.status === 429, 'per-IP creation limit (3/hour) enforced');
    r = await (await api('/api/rooms')).json();
    const wish = ROOM_ADJECTIVES.flatMap((a) => ROOM_NOUNS.map((n) => `${a} ${n}`)).find((n) => !r.rooms.some((x) => x.name === n));
    const asked = await create({ name: wish, beginner: false }, '10.0.0.2');
    check(asked.status === 201 && asked.room.name === wish, `a free list name is honoured → "${wish}"`);
    const dupe = await create({ name: wish }, '10.0.0.2');
    check(dupe.status === 201 && isRoomName(dupe.room.name) && dupe.room.name !== wish, `a taken name gets another list name → "${dupe.room?.name}"`);
    r = await (await api('/api/rooms')).json();
    const made = r.rooms.filter((x) => !x.permanent);
    check(made.length === 5 && made.every((x) => isRoomName(x.name)) && new Set(made.map((x) => x.name)).size === 5, 'every created name is a list name, none twice');
    check(made.find((x) => x.id === asked.room.id)?.beginner === true, 'every new server is beginner, even if asked otherwise');

    // Solo run notes (POST /api/run) and the public totals (GET /api/stats).
    const note = { v: 1, mode: 'solo', arena: 'orb', len: 42.4, secs: 95.6, kills: 2, cause: 'body' };
    const runNote = (body, headers = {}) => api('/api/run', { method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const totals = async (origin = ORIGIN) => { const res = await api('/api/stats', { headers: { origin } }); return { res, today: (await res.json()).days[0] }; };
    let res = await runNote(note);
    check(res.status === 204 && res.headers.get('access-control-allow-origin') === ORIGIN, 'a solo run note (text/plain, so no preflight) is accepted: 204 with CORS');
    let t = await totals();
    const solo = t.today.solo;
    check(t.res.headers.get('cache-control') === 'public, max-age=60' && t.today.day === new Date().toISOString().slice(0, 10) && solo.runs === 1 && solo.secs === 96
        && solo.maxLen === 42 && solo.len['25-50'] === 1 && solo.cause.body === 1 && solo.arena.orb === 1, 'GET /api/stats shows it in today\'s solo totals (cached 60 s)');
    check(JSON.stringify(Object.keys(t.today)) === '["day","solo","room","peakHumans","roomsCreated","visit"]' && t.today.roomsCreated === 5
        && t.today.visit.visits === 0, 'the totals hold only counts (5 rooms created today), nothing per player');
    res = await runNote({ ...note, arena: 'sky', len: 1e9, secs: -50, kills: 99999, cause: 'eaten by a grue', name: 'Ember Drake' }, { 'content-type': 'application/json' });
    t = await totals();
    check(res.status === 204 && t.today.solo.runs === 2 && t.today.solo.maxLen === 2000 && t.today.solo.len['200+'] === 1 && t.today.solo.kills === 502
        && t.today.solo.secs === 96 && t.today.solo.cause.other === 1, 'out-of-range fields are clamped (2000 m, 500 kills, 0 s) and an unknown cause counts as other');
    const refused = await Promise.all([runNote({ ...note, arena: 'moon' }), runNote({ ...note, mode: 'room' }), runNote({ ...note, len: '42' }), runNote('not json')]);
    check(refused.every((x) => x.status === 400), 'a note with an unknown world, a non-solo mode, a non-number or bad JSON is refused (400)');
    res = await runNote({ ...note, pad: 'x'.repeat(600) });
    check(res.status === 413, 'a note over 512 bytes is refused (413)');
    res = await runNote(note, { origin: 'https://evil.example' });
    check(res.status === 403 && !res.headers.get('access-control-allow-origin'), 'a note from a foreign origin is refused (403)');
    // So far 2 accepted + 4 refused count towards this address's 20 an hour.
    const more = [];
    for (let i = 0; i < 14; i++) more.push((await runNote(note)).status);
    res = await runNote(note);
    t = await totals('https://evil.example');
    check(more.every((s) => s === 204) && res.status === 429 && t.today.solo.runs === 16, 'per-address limit: the 21st note in an hour gets 429');
    check(t.res.status === 200 && !t.res.headers.get('access-control-allow-origin'), 'the totals are public; CORS headers only for the game\'s own pages');

    // Two players join the created room.
    const join = (name) => new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room.id}`, { headers: { origin: ORIGIN } });
        const c = { ws, msgs: [], welcome: null, snaps: 0, corrections: 0, last: null, events: [], dn: [], dx: [], pongs: [] };
        ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, perks: ['lungs', 'hack', 'pull', 'ember'], skin: 'jade' }));
        ws.onmessage = (e) => {
            const m = JSON.parse(e.data);
            if (m.t === 'welcome') { c.welcome = m; resolve(c); }
            if (m.t === 's') { c.snaps++; c.last = m; if (m.me && m.me.c) c.corrections++; }
            if (m.t === 'e') c.events.push(...m.ev);
            if (m.t === 'dn') c.dn.push(m.d);
            if (m.t === 'dx') c.dx.push(m.id);
            if (m.t === 'pong') c.pongs.push(m.c);
            c.msgs.push(m.t);
        };
        ws.onerror = reject;
        setTimeout(() => reject(new Error('join timeout')), 8000);
    });
    // The server handles a socket's messages in order and answers a ping at
    // once, so the pong means everything sent before it has been handled.
    let pingN = 0;
    const handled = (c) => { const n = ++pingN; c.ws.send(JSON.stringify({ t: 'ping', c: n })); return waitFor(() => c.pongs.includes(n)); };
    const a = await join('Alice <script>');
    const b = await join('B​ob');
    check(a.welcome.room.id === room.id && a.welcome.orbs.length > 1000, `welcome has room + ${a.welcome.orbs.length / 7} orbs`);
    const bInA = () => a.last && a.last.d.some((s) => s[0] === b.welcome.you);
    await waitFor(() => bInA() && a.snaps >= 6);
    check(bInA(), 'player A sees player B in snapshots');
    const meA = a.welcome.dragons.find((d) => d.id === a.welcome.you);
    check(meA && meA.c1 === 0x3DFFB5 && a.last.me.tm === 1.2, 'profile colours applied; perks re-checked server-side (Deep Lungs active)');
    const names = a.last.lb.map((x) => x[1]);
    const aName = a.welcome.dragons.find((d) => d.id === a.welcome.you)?.name ?? names.find((n) => n.startsWith('Alice'));
    check(a.snaps >= 6, `snapshots flowing (${a.snaps} so far)`);
    // Bots catch pearls too (a new one appears 8 s ±25% later), so at any one
    // moment all three may be gone: the welcome's list only has to be well
    // formed, and a snapshot with a pearl in it has to arrive.
    const pearlsOk = (pl, min) => Array.isArray(pl) && pl.length >= min && pl.length <= 3 && pl.every((q) => q.length === 4 && q.every(Number.isFinite));
    await waitFor(() => pearlsOk(a.last.pl, 1), 12000);
    check(pearlsOk(a.welcome.pl, 0) && pearlsOk(a.last.pl, 1) && !a.last.pu.some((q) => q[0] === 'pearl'),
        'flaming pearls sync in their own optional field (pl: [id, x, y, z]), never as power-ups');
    // Sun crystals (rule sunCrystals) ride in the power-up list with three
    // more fields. These players send no caps, like a cached older page: they
    // get them as fire crystals, and the first five fields are all they read.
    const sunPu = (pu) => pu.filter((q) => q.length === 8 && q[5] > 0 && q.slice(1).every(Number.isFinite));
    await waitFor(() => sunPu(a.last.pu).length >= 3, 12000);
    check(sunPu(a.welcome.pu).length >= 2 && sunPu(a.last.pu).length >= 3 && sunPu(a.last.pu).every((q) => q[0] === 'fire')
        && a.last.pu.every((q) => typeof q[0] === 'string' && q.slice(1, 5).every(Number.isFinite)),
        `an older page sees the sun crystals as fire crystals: [fire, x, y, z, spin, id, fade, hatch] (${sunPu(a.last.pu).length} now)`);
    const listed = await waitFor(async () => {
        const x = (await (await api('/api/rooms')).json()).rooms.find((y) => y.id === room.id);
        return x && x.humans === 2 && x.bots >= 3 && x;
    });
    check(listed, `lobby shows 2 players + ${listed?.bots} bots`);

    // Speed check: teleport claim gets clamped and corrected.
    const me = a.last.d.find((s) => s[0] === a.welcome.you);
    a.ws.send(JSON.stringify({ t: 'p', x: me[1] + 400, y: me[2], z: me[3], qx: 0, qy: 0, qz: 0, qw: 1, s: 16, bk: 0, b: 0, k: 0, f: 0 }));
    // The correction rides on one snapshot only, so count it as it arrives
    // rather than hoping the latest snapshot is that one.
    const corrections = a.corrections;
    const corrected = await waitFor(() => a.corrections > corrections);
    const after = a.last.d.find((s) => s[0] === a.welcome.you);
    check(corrected && Math.abs(after[1] - me[1]) < 30, `teleport clamped (moved ${Math.abs(after[1] - me[1]).toFixed(1)} m, correction sent)`);

    // Garbage and oversize messages don't crash anything.
    a.ws.send('not json'); a.ws.send(JSON.stringify({ t: 'p', x: 'NaN' })); a.ws.send(JSON.stringify([1, 2, 3]));
    check(await handled(a) && a.ws.readyState === 1, 'bad messages ignored, connection still open');
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
    await waitFor(() => a.events.some((e) => e.k === 'parking'));
    check(a.events.some((e) => e.k === 'parking') && a.last.d.some((s) => s[0] === you), 'park starts a 3 s countdown (still in the sky)');
    const landed = () => b.dx.includes(you) && b.events.some((e) => e.k === 'land' && e.id === you) && !b.last.d.some((s) => s[0] === you);
    check(await waitFor(landed), 'after the countdown the dragon leaves the sky; others see it land');
    a.ws.send(JSON.stringify({ t: 'spawn' }));
    await handled(a);                                    // a respawn's 'dn' would go out before the pong
    check(!a.dn.some((d) => d.id === you), 'a parked dragon can\'t respawn fresh (no length reset)');
    a.ws.send(JSON.stringify({ t: 'unpark' }));
    // Both players get the same 'dn' broadcast, but B's copy can land a few
    // ms after A's, so wait for both before checking.
    await waitFor(() => a.dn.some((d) => d.id === you) && b.dn.some((d) => d.id === you));
    const back = a.dn.find((d) => d.id === you);
    check(back && Math.abs(back.s[8] - massBefore) < 2 && b.dn.some((d) => d.id === you), `unpark flies back in with its length (${massBefore} → ${back?.s[8]})`);

    // Lifecycle: when both leave (and their dragons' 3 s in the sky after
    // leaving are up), the room gets a 12 h expiry.
    a.ws.close(); b.ws.close();
    const empty = await waitFor(async () => (await (await api('/api/rooms')).json()).rooms.some((x) => x.id === room.id && x.humans === 0), 15000, 200);
    check(empty, 'empty user room still listed (lives 12 h after last leave)');
    t = await totals();
    const rm = t.today.room, ends = Object.entries(rm.cause).filter(([, n]) => n);
    check(rm.runs === 2 && ends.reduce((s, [, n]) => s + n, 0) === 2 && rm.arena.orb === 2 && rm.secs > 0 && t.today.peakHumans === 2 && t.today.solo.runs === 16,
        `both players' lives counted under room (${ends.map(([k, n]) => `${k} ${n}`).join(', ')}); peak 2 players today`);

    // Restart: saved rooms with typed (pre-list) names are dropped, and
    // deleted from the store too.
    const removed = [], later = Date.now() + 3600 * 1000;
    const saved = [{ id: 'typed', name: 'Joel Den', arena: 'sky', expireAt: later }, { id: 'listed', name: wish, arena: 'orb', expireAt: later }];
    const reg = new Registry({ kind: 'test', loadAll: async () => saved, save() {}, remove(id) { removed.push(id); } });
    await reg.init();
    check(reg.get('listed')?.meta.name === wish && !reg.get('typed') && removed.join() === 'typed', 'on restart, saved rooms with typed names are dropped');

    // Fight mode (rule fight): a player can create a fight server. Only
    // rules { fight: 0 | 1 } are taken; anything else is ignored.
    const fightRoom = await create({ name: 'x', arena: 'sky', rules: { fight: 1 } }, '10.0.0.3');
    const mixed = await create({ arena: 'orb', rules: { fight: 1, lives: 0, botAggrMax: 1, tailBite: 0 } }, '10.0.0.3');
    const plain = await create({ arena: 'sky', rules: { fight: 0 } }, '10.0.0.3');
    const junk = await Promise.all([{ fight: 2 }, { fight: '1' }, { fight: true }, [1], 'fight', { lives: 0 }].map((rules, i) => create({ arena: 'sky', rules }, `10.0.1.${i}`)));
    check(fightRoom.status === 201 && fightRoom.room.fight === true && mixed.room.fight === true && plain.room.fight === false && junk.every((x) => x.status === 201 && x.room.fight === false),
        'a server can be created in fight mode (rules { fight: 1 }); junk rules are ignored and the server is classic');
    r = await (await api('/api/rooms')).json();
    const rows = (ids) => r.rooms.filter((x) => ids.includes(x.id));
    check(rows([fightRoom.room.id, mixed.room.id, 'skyhold-fight', 'the-orb-fight']).every((x) => x.fight === true) && rows(['skyhold', 'the-orb']).every((x) => x.fight === false)
        && rows(junk.map((x) => x.room.id)).every((x) => x.fight === false), 'the lobby flags fight servers (fight: true); Skyhold and The Orb stay classic');
    // A page from before fight mode (no "fight" in caps) is turned away with a message to update; one with it plays fight rules.
    const hello = (caps, room = fightRoom.room.id) => new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room}`, { headers: { origin: ORIGIN } });
        const got = { msgs: [] };
        ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: 'Kid', ...(caps ? { caps } : {}) }));
        ws.onmessage = (e) => { const m = JSON.parse(e.data); got.msgs.push(m); if (m.t === 'welcome') { got.welcome = m; ws.close(1000); } };
        ws.onclose = (e) => { got.code = e.code; resolve(got); };
        setTimeout(() => { ws.close(); resolve(got); }, 8000);
    });
    const oldPage = await hello(['el']), noCaps = await hello(null), newPage = await hello(['el', 'fight']);
    const full = (g) => g.msgs.find((m) => m.t === 'full');
    check(oldPage.code === 4003 && /Fight mode/.test(full(oldPage)?.error) && /Reload/.test(full(oldPage)?.error) && noCaps.code === 4003 && !oldPage.welcome,
        `an older page is kept out of a fight server: "${full(oldPage)?.error}" (close 4003)`);
    check(newPage.welcome && newPage.welcome.rules.fight === 1, 'a page that knows fight mode joins, and the welcome says rules.fight = 1');
    const always = await hello(['el', 'fight'], 'the-orb-fight'), classic = await hello(['el', 'fight'], 'the-orb');
    check(always.welcome && always.welcome.rules.fight === 1 && classic.welcome && !classic.welcome.rules.fight,
        'the always-on The Orb Fight plays fight mode; The Orb stays classic');
    // Saved with the room (meta.rules) and cleaned again on restart.
    const savedRules = [{ id: 'f1', name: wish, arena: 'sky', expireAt: later, rules: { fight: 1 } }, { id: 'f2', name: dupe.room.name, arena: 'sky', expireAt: later, rules: { fight: 5, lives: 0 } }];
    const reg2 = new Registry({ kind: 'test', loadAll: async () => savedRules, save() {}, remove() {} });
    await reg2.init();
    check(reg2.get('f1').fight && JSON.stringify(reg2.get('f1').meta.rules) === '{"fight":1}' && !reg2.get('f2').fight && reg2.get('f2').meta.rules === undefined,
        'a fight server stays one after a restart (meta.rules is saved); junk saved rules are dropped');
    console.log(`\n${ok} checks passed`);
} catch (e) {
    console.error('FAILED:', e.message, '\n--- server log ---\n' + out);
    process.exitCode = 1;
} finally {
    srv.kill();
}
