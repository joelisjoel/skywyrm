#!/usr/bin/env node
// Smoke test: the game page loads in headless Chromium, the 3D scene and
// the simulation start, solo play begins, and nothing throws. three.js is
// served from node_modules instead of esm.sh so CI needs no network.
// Run: npm install && npx playwright install chromium && npm run smoke
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { serve } from './serve.mjs';
import { launchChromium } from './browser.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE = readFileSync(path.join(root, 'node_modules/three/build/three.module.js'));
const shots = path.join(root, 'smoke-shots');
mkdirSync(shots, { recursive: true });

const server = await serve(0);
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await launchChromium();
const errors = [];
let ok = false;
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/esm\.sh\/three@0\.163\.0/, (r) => r.fulfill({ body: THREE, contentType: 'text/javascript' }));
    await page.route(/run\.app|fonts\.googleapis|fonts\.gstatic/, (r) => r.abort());
    await page.goto(url);
    await page.waitForFunction(() => window.__wyrm && window.__wyrm.world, null, { timeout: 60000 });
    await page.screenshot({ path: path.join(shots, 'menu.png') });
    await page.click('#play');
    await page.waitForFunction(() => window.__wyrm.state === 'play' && window.__wyrm.player && window.__wyrm.player.alive, null, { timeout: 30000 });
    const t0 = await page.evaluate(() => window.__wyrm.world.time);
    await page.waitForTimeout(2500);
    const t1 = await page.evaluate(() => window.__wyrm.world.time);
    await page.screenshot({ path: path.join(shots, 'play.png') });
    if (!(t1 > t0)) errors.push(`the world did not advance (${t0} → ${t1})`);
    ok = errors.length === 0;
} catch (e) {
    errors.push(e.message);
} finally {
    await browser.close();
    server.close();
}
if (!ok) { console.error('smoke test FAILED\n' + errors.join('\n')); process.exit(1); }
console.log('smoke test ok: the game loads and flies');
