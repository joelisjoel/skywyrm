#!/usr/bin/env node
// A tiny static server for site/ (no dependencies): `npm run serve`, then
// open http://localhost:8765. Point it at a local game server with
// ?server=http://localhost:8790 (allowed only on localhost pages).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.webm': 'audio/webm', '.wasm': 'application/wasm' };

export function serve(port = Number(process.env.PORT) || 8765) {
    const server = createServer(async (req, res) => {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = path.join(root, path.normalize(p));
        if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
        try {
            const body = await readFile(file);
            res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
        } catch { res.writeHead(404).end('not found'); }
    });
    return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const s = await serve();
    console.log(`Skywyrm on http://localhost:${s.address().port}`);
}
