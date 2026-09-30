// Wyrm multiplayer server: HTTP room list/creation + WebSocket rooms.
//   GET  /healthz            → "ok"
//   GET  /api/rooms          → { rooms: [...] }
//   POST /api/rooms          → create { name, arena, beginner } → { room }
//   WS   /ws?room=<id>       → play (first message must be { t: 'hello', name })
// Runs on Cloud Run (PORT, K_SERVICE set) or locally: `node server.js`.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { Registry } from './rooms.js';
import { makeStore } from './store.js';
import { T, DEFAULTS } from '../docs/wyrm/js/shared.js';

const PORT = +process.env.PORT || 8080;
const PROD = !!process.env.K_SERVICE;
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Only these pages may use the server. Localhost is allowed off Cloud Run
// (dev) or when ALLOW_LOCALHOST=1.
const ALLOWED = new Set((process.env.ALLOWED_ORIGINS || 'https://dendroslabs.com,https://www.dendroslabs.com')
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

const MAX_CONN_PER_IP = 6;
const conns = new Map();   // ip → count

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
const registry = new Registry(store, log);
await registry.init();

// ------------------------------------------------ HTTP
function send(res, status, body, origin) {
    const headers = {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
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
        if (!joined) {
            if (m.t !== 'hello') return;
            const r = room.join(client, typeof m.name === 'string' ? m.name.slice(0, 64) : '', { perks: m.perks, skin: typeof m.skin === 'string' ? m.skin.slice(0, 16) : '' });
            if (r.error) { client.send({ t: 'full', error: r.error }); ws.close(4003, 'full'); return; }
            joined = true; clearTimeout(helloTimer);
            return;
        }
        if (m.t === 'p') room.pose(client, m);
        else if (m.t === 'spawn') room.respawn(client);
        else if (m.t === 'park') room.park(client);
        else if (m.t === 'unpark') room.unpark(client);
        else if (m.t === 'ping' && typeof m.c === 'number') client.send({ t: 'pong', c: m.c });
    });
    ws.on('close', () => {
        clearTimeout(helloTimer);
        if (joined) room.leave(client);
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
setInterval(() => registry.sweep(), 60 * 1000);

server.listen(PORT, '0.0.0.0', () => log(`wyrm-server listening on :${PORT} (${PROD ? 'cloud run' : 'dev'})`));

process.on('SIGTERM', () => { log('SIGTERM: shutting down'); server.close(); setTimeout(() => process.exit(0), 500); });
