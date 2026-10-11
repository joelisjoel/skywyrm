// Wyrm multiplayer server: HTTP room list/creation + WebSocket rooms.
//   GET  /healthz            → "ok"
//   GET  /api/rooms          → { rooms: [...] }
//   POST /api/rooms          → create { name, arena, beginner } → { room }
//   POST /api/run            → 204: one solo life's anonymous numbers (stats.js)
//   GET  /api/stats          → { days: [...] }: public daily play totals, newest first
//   WS   /ws?room=<id>       → play (first message must be { t: 'hello', name })
// Runs on Cloud Run (PORT, K_SERVICE set) or locally: `node server.js`.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { Registry } from './rooms.js';
import { makeStore } from './store.js';
import { Stats, cleanRun } from './stats.js';
import { T, DEFAULTS } from '../site/js/shared.js';

const PORT = +process.env.PORT || 8080;
const PROD = !!process.env.K_SERVICE;
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Only these pages may use the server. Localhost is allowed off Cloud Run
// (dev) or when ALLOW_LOCALHOST=1.
const ALLOWED = new Set((process.env.ALLOWED_ORIGINS || 'https://skywyrm.io,https://www.skywyrm.io')
    .split(',').map((s) => s.trim()).filter(Boolean));
const allowLocal = !PROD || process.env.ALLOW_LOCALHOST === '1';
function originOk(origin) {
    if (!origin) return !PROD;                     // curl etc. only in dev
    if (ALLOWED.has(origin)) return true;
    return allowLocal && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

// Client IP: Cloud Run appends the real client address last in X-Forwarded-For.
function ipOf(req) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    return (xff.length ? xff[xff.length - 1] : req.socket.remoteAddress) || 'unknown';
}

// Sockets per client IP. A home or school network shares one address, so
// this is generous. MAX_CONN_PER_IP overrides it (a positive whole number).
const MAX_CONN_PER_IP = positiveInt(process.env.MAX_CONN_PER_IP, 16);
const conns = new Map();   // ip → count

function positiveInt(s, fallback) {
    const n = Number(s);
    return s && Number.isInteger(n) && n > 0 ? n : fallback;
}

// Solo run notes (POST /api/run): 20 an hour per address. The address is
// held only here, in memory, until its hour is up; never stored or logged.
const RUNS_PER_IP_PER_HOUR = 20;
const runNotes = new Map();   // ip → { n, since }
function runAllowed(ip) {
    const now = Date.now();
    let e = runNotes.get(ip);
    if (!e || now - e.since >= 3600 * 1000) runNotes.set(ip, (e = { n: 0, since: now }));
    return ++e.n <= RUNS_PER_IP_PER_HOUR;
}

// Optional server-side tuning without a code change, e.g. on Cloud Run:
// WYRM_TUNE={"popMax":20,"sunHeat":80}. Only known numeric keys apply.
if (process.env.WYRM_TUNE) {
    try {
        const o = JSON.parse(process.env.WYRM_TUNE);
        for (const [k, v] of Object.entries(o)) if (k in DEFAULTS && typeof v === 'number' && Number.isFinite(v)) T[k] = v;
        log('tuning overrides applied:', Object.keys(o).filter((k) => k in DEFAULTS).join(', '));
    } catch { log('WYRM_TUNE ignored: not valid JSON'); }
}

const store = await makeStore(log);
const stats = new Stats(store, log);
await stats.init();
const registry = new Registry(store, log, stats);
await registry.init();
// A stray promise rejection is logged (rate-limited) instead of ending the process.
process.on('unhandledRejection', (e) => registry.logError('unhandled rejection', e));

// ------------------------------------------------ HTTP
function send(res, status, body, origin, cache = 'no-store') {
    const headers = {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': cache,
        'x-content-type-options': 'nosniff',
        'vary': 'Origin',
    };
    if (origin && originOk(origin)) {
        headers['access-control-allow-origin'] = origin;
        headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
        headers['access-control-allow-headers'] = 'content-type';
        headers['access-control-max-age'] = '600';
    }
    res.writeHead(status, headers);
    res.end(body === null ? '' : JSON.stringify(body));
}

function readBody(req, limit = 1024) {
    return new Promise((resolve, reject) => {
        let size = 0; const chunks = [];
        req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url, 'http://x');
    try {
        if (req.method === 'OPTIONS') return send(res, originOk(origin) ? 204 : 403, null, origin);
        if (req.method === 'GET' && url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
        if (url.pathname === '/api/rooms') {
            if (req.method === 'GET') return send(res, 200, { rooms: registry.list() }, origin);
            if (req.method === 'POST') {
                if (!originOk(origin)) return send(res, 403, { error: 'Forbidden' }, origin);
                if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON only' }, origin);
                let body;
                try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Bad request' }, origin); }
                if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Bad request' }, origin);
                const r = registry.create({ name: body.name, arena: body.arena, beginner: body.beginner }, ipOf(req));
                return r.error ? send(res, r.status || 400, { error: r.error }, origin) : send(res, 201, r, origin);
            }
        }
        // A solo life's anonymous numbers. Sent as text/plain so the browser
        // needs no preflight; the page ignores every answer.
        if (url.pathname === '/api/run' && req.method === 'POST') {
            if (!originOk(origin)) return send(res, 403, { error: 'Forbidden' }, origin);
            if (!/^(text\/plain|application\/json)/i.test(String(req.headers['content-type'] || ''))) return send(res, 415, { error: 'JSON only' }, origin);
            if (+req.headers['content-length'] > 512) return send(res, 413, { error: 'Too big' }, origin);
            if (!runAllowed(ipOf(req))) return send(res, 429, { error: 'Too many' }, origin);
            let run;
            try { run = cleanRun(JSON.parse(await readBody(req, 512))); } catch (e) { return send(res, e.message === 'too big' ? 413 : 400, { error: 'Bad request' }, origin); }
            if (!run) return send(res, 400, { error: 'Bad request' }, origin);
            stats.run('solo', run);
            return send(res, 204, null, origin);
        }
        if (url.pathname === '/api/stats' && req.method === 'GET') return send(res, 200, { days: stats.list() }, origin, 'public, max-age=60');
        send(res, 404, { error: 'Not found' }, origin);
    } catch (e) {
        log('http error', e.message);
        send(res, 500, { error: 'Server error' }, origin);
    }
});

// ------------------------------------------------ WebSocket
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });

server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    const ip = ipOf(req);
    const room = registry.get(url.searchParams.get('room'));
    const reject = (code, msg) => { socket.write(`HTTP/1.1 ${code} ${msg}\r\n\r\n`); socket.destroy(); };
    if (url.pathname !== '/ws') return reject(404, 'Not Found');
    if (!originOk(req.headers.origin)) return reject(403, 'Forbidden');
    if (!room) return reject(404, 'Not Found');
    if ((conns.get(ip) || 0) >= MAX_CONN_PER_IP) return reject(429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, room, ip));
});

class Client {
    constructor(ws) { this.ws = ws; this.dragon = null; this.room = null; this.parkAt = 0; this.parked = null; }
    send(msg) { this.sendRaw(JSON.stringify(msg)); }
    sendRaw(s) {
        // Drop frames for clients that can't keep up rather than buffering forever.
        if (this.ws.readyState === 1 && this.ws.bufferedAmount < 512 * 1024) this.ws.send(s);
    }
    close(code, reason) { try { this.ws.close(code, reason); } catch { /* already closed */ } }
}

function onConnect(ws, room, ip) {
    conns.set(ip, (conns.get(ip) || 0) + 1);
    const client = new Client(ws);
    let joined = false, strikes = 0;
    let tokens = 90, last = Date.now();      // rate limit: 60 msg/s sustained, 90 burst
    const helloTimer = setTimeout(() => { if (!joined) ws.close(4000, 'hello timeout'); }, 5000);

    ws.on('message', (data, isBinary) => {
        const now = Date.now();
        tokens = Math.min(90, tokens + (now - last) * 0.06); last = now;
        if (--tokens < 0 || isBinary) { ws.close(4008, 'rate limit'); return; }
        let m;
        try { m = JSON.parse(data.toString('utf8')); } catch { if (++strikes > 5) ws.close(4002, 'bad messages'); return; }
        if (!m || typeof m !== 'object' || typeof m.t !== 'string') { if (++strikes > 5) ws.close(4002, 'bad messages'); return; }
        // A bug while handling a message closes only the socket that sent it
        // (1011, logged like a room error), rather than crashing the process
        // and every room. The room carries on: one crafted message mustn't
        // be able to throw everyone out.
        try { handle(m); } catch (e) { registry.logError(`room ${room.meta.id} message`, e); client.close(1011, 'room error'); }
    });
    function handle(m) {
        if (!joined) {
            if (m.t !== 'hello') return;
            const r = room.join(client, typeof m.name === 'string' ? m.name.slice(0, 64) : '', { perks: m.perks, skin: typeof m.skin === 'string' ? m.skin.slice(0, 16) : '', caps: m.caps });
            if (r.error) { client.send({ t: 'full', error: r.error }); ws.close(4003, 'full'); return; }
            joined = true; clearTimeout(helloTimer);
            return;
        }
        if (m.t === 'p') room.pose(client, m);
        else if (m.t === 'spawn') room.respawn(client);
        else if (m.t === 'park') room.park(client);
        else if (m.t === 'unpark') room.unpark(client);
        else if (m.t === 'ping' && typeof m.c === 'number') client.send({ t: 'pong', c: m.c });
    }
    ws.on('close', (code) => {
        clearTimeout(helloTimer);
        // 1000/1005: the game closed the socket (back to the menu); 1001: the
        // tab closed. Anything else (1006, our 40xx) is a dropped connection.
        // (client.room is set even if a hello failed halfway through join.)
        const cause = code === 1000 || code === 1001 || code === 1005 ? 'quit' : 'disconnect';
        if (client.room) { try { room.leave(client, cause); } catch (e) { registry.logError(`room ${room.meta.id} leave`, e); } }
        const n = (conns.get(ip) || 1) - 1;
        if (n <= 0) conns.delete(ip); else conns.set(ip, n);
    });
    ws.on('error', () => {});
}

// ------------------------------------------------ loops
let lastTick = performance.now(), acc = 0;
setInterval(() => {
    const now = performance.now();
    acc = Math.min(acc + (now - lastTick) / 1000, 0.25);   // never spiral after a stall
    lastTick = now;
    while (acc >= 1 / 30) { registry.tick(); acc -= 1 / 30; }
}, 1000 / 60);
setInterval(() => {
    registry.sweep();
    const now = Date.now();
    for (const [ip, e] of runNotes) if (now - e.since >= 3600 * 1000) runNotes.delete(ip);
    stats.flush();                // saves today's totals, at most once a minute, if they changed
}, 60 * 1000);

server.listen(PORT, '0.0.0.0', () => log(`skywyrm server listening on :${PORT} (${PROD ? 'cloud run' : 'dev'})`));

// Count the lives a shutdown cuts off and save the totals before exiting
// (Cloud Run allows 10 s; never wait more than 5).
process.on('SIGTERM', () => {
    log('SIGTERM: shutting down');
    server.close();
    registry.endLives('disconnect');
    const bye = () => process.exit(0);
    stats.flush().then(() => setTimeout(bye, 500), bye);
    setTimeout(bye, 5000);
});
