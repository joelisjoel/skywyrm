#!/usr/bin/env node
// Self-hosting checks: the site loads nothing from other hosts, so keep
// what it serves itself in step with the code.
//
//   1. Every page has a Content-Security-Policy, and every inline <script>
//      (the importmap) is allowed by its sha256 hash in script-src.
//   2. Pages load no scripts, styles or fonts from other hosts.
//   3. site/vendor/three-<version>.module.min.js is exactly node_modules'
//      three.module.min.js, at the version package.json pins.
//   4. Every Chinese character used in site/ is in the Ma Shan Zheng subset
//      (site/fonts/ma-shan-zheng.txt; see site/fonts/README.md to regenerate).
//
// Usage: node scripts/check-assets.mjs [--fix]   (--fix rewrites CSP hashes)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');
const FIX = process.argv.includes('--fix');
const problems = [];
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    (e.isDirectory() ? (e.name === 'vendor' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
const rel = (f) => path.relative(root, f);

// 1 + 2. Pages
for (const file of walk(site).filter((f) => f.endsWith('.html'))) {
    let html = readFileSync(file, 'utf8');
    const meta = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)/.exec(html);
    if (!meta) { problems.push(`${rel(file)}: no Content-Security-Policy meta tag`); continue; }
    const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
        .map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
    const csp = meta[2];
    const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';
    const listed = scriptSrc.split(' ').filter((t) => t.startsWith("'sha256-"));
    const want = [...new Set(hashes)];
    if (want.join(' ') !== listed.join(' ')) {
        if (FIX) {
            const next = csp.replace(/script-src [^;]*/, `script-src 'self'${want.length ? ' ' + want.join(' ') : ''}`);
            html = html.replace(meta[0], meta[1] + next + meta[3]);
            writeFileSync(file, html);
            console.log(`${rel(file)}: script-src hashes updated`);
        } else {
            problems.push(`${rel(file)}: inline script hashes in the CSP are out of date (run npm run assets:fix)`);
        }
    }
    for (const m of html.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="(https?:)?\/\/[^"]*"/g)) {
        problems.push(`${rel(file)}: loads from another host: ${m[0]}`);
    }
}

// 3. Vendored three.js
const pinned = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies.three;
const vendored = path.join(site, 'vendor', `three-${pinned}.module.min.js`);
const installed = path.join(root, 'node_modules/three/build/three.module.min.js');
if (!existsSync(vendored)) problems.push(`${rel(vendored)} is missing (copy it from ${rel(installed)})`);
else if (!existsSync(installed)) problems.push('node_modules/three is missing: run npm ci');
else if (!readFileSync(vendored).equals(readFileSync(installed))) problems.push(`${rel(vendored)} differs from ${rel(installed)}`);
const importmap = readFileSync(path.join(site, 'index.html'), 'utf8');
if (!importmap.includes(`"three": "./vendor/three-${pinned}.module.min.js"`)) problems.push(`site/index.html's importmap doesn't point three at vendor/three-${pinned}.module.min.js`);

// 4. Font subset
const subset = new Set(readFileSync(path.join(site, 'fonts/ma-shan-zheng.txt'), 'utf8'));
const cjk = /[⺀-鿿豈-﫿　-〿＀-￯]/g;
const missing = new Map();
for (const file of walk(site).filter((f) => /\.(html|m?js|css|json)$/.test(f))) {
    for (const [c] of readFileSync(file, 'utf8').matchAll(cjk)) if (!subset.has(c)) missing.set(c, rel(file));
}
if (missing.size) problems.push(`Chinese characters missing from the Ma Shan Zheng subset (see site/fonts/README.md): ${[...missing].map(([c, f]) => `${c} (${f})`).join(', ')}`);

for (const p of problems) console.error(p);
if (!problems.length) console.log('assets ok');
process.exit(problems.length ? 1 : 0);
