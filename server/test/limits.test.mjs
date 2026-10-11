// Server limits: sockets per IP (MAX_CONN_PER_IP), held seats included.
// Boots the real server with different settings and opens raw WebSocket
// upgrades to read the HTTP status of a refusal.
// Run: cd server && npm test
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
const check = (cond, msg) => { assert.ok(cond, msg); ok++; console.log('  ✓', msg); };

const BASE_PORT = 20000 + Math.floor(Math.random() * 1000) * 4;
const servers = [];
async function boot(env = {}) {
    const port = BASE_PORT + servers.length;
    const srv = spawn(process.execPath, [path.join(here, '..', 'server.js')], { env: { ...process.env, PORT: String(port), STORE: 'memory', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const s = { srv, port, out: '', sockets: [] };
    srv.stdout.on('data', (d) => (s.out += d)); srv.stderr.on('data', (d) => (s.out += d));
    servers.push(s);
    for (let i = 0; i < 100 && !s.out.includes('listening'); i++) await sleep(100);
    assert.ok(s.out.includes('listening'), 'server did not start:\n' + s.out);
    return s;
}

// One WebSocket upgrade: 101 (kept open) or the refusal's HTTP status.
const upgrade = (s) => new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: s.port, path: '/ws?room=skyhold', headers: {
        origin: ORIGIN, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64') } });
    req.on('upgrade', (res, socket) => { s.sockets.push(socket); socket.on('error', () => {}); resolve(101); });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.end();
});
const open = async (s, n) => { const codes = []; for (let i = 0; i < n; i++) codes.push(await upgrade(s)); return codes; };

// Joins as a player, then drops the connection without a close frame (as a
// phone losing signal does), which leaves a seat held for a reconnect.
const joinAndDrop = (s) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?room=skyhold`, { headers: { origin: ORIGIN } });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'Dropper' })));
    ws.on('message', (data) => { if (JSON.parse(data).t === 'welcome') { ws._socket.destroy(); resolve(); } });
    ws.on('error', reject);
});

try {
    const [def, three, junk, held] = await Promise.all([boot(), boot({ MAX_CONN_PER_IP: '3' }), boot({ MAX_CONN_PER_IP: '-2' }), boot({ MAX_CONN_PER_IP: '3' })]);
    let codes = await open(def, 17);
    check(codes.slice(0, 16).every((c) => c === 101) && codes[16] === 429, 'default: 16 sockets per IP, the 17th refused (429)');
    codes = await open(three, 4);
    check(codes.slice(0, 3).every((c) => c === 101) && codes[3] === 429, 'MAX_CONN_PER_IP=3: the 4th socket refused');
    codes = await open(junk, 17);
    check(codes.slice(0, 16).every((c) => c === 101) && codes[16] === 429, 'MAX_CONN_PER_IP that isn\'t a positive whole number falls back to 16');
    three.sockets.pop().destroy();
    await sleep(200);
    check(await upgrade(three) === 101, 'a closed socket frees its slot');
    for (let i = 0; i < 3; i++) await joinAndDrop(held);
    await sleep(200);
    check(await upgrade(held) === 429, 'seats held for dropped players count toward the limit: 3 drops fill MAX_CONN_PER_IP=3');
    console.log(`\n${ok} checks passed`);
} catch (e) {
    console.error('FAILED:', e.message, '\n--- server logs ---\n' + servers.map((s) => s.out).join('\n'));
    process.exitCode = 1;
} finally {
    for (const s of servers) { for (const k of s.sockets) k.destroy(); s.srv.kill(); }
}
