#!/usr/bin/env node
// Smoke test: the game page loads in headless Chromium, the 3D scene and
// the simulation start, solo play begins, and nothing throws. Everything is
// self-hosted, so the only other host the page may contact is the game
// server (blocked here); a request anywhere else, or a Content-Security-
// Policy violation, fails the test. In flight, messages keep their times
// (hud.js msgTime) and leave when they fade. Then, on a phone-sized page, an invite
// link (?room=) pins that server first in the lobby (with a faked room list).
// Run: npm install && npx playwright install chromium && npm run smoke
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { serve } from './serve.mjs';
import { launchChromium } from './browser.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'smoke-shots');
mkdirSync(shots, { recursive: true });

const server = await serve(0);
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await launchChromium();
const errors = [];
let ok = false;
// A page that fails on errors, CSP violations and requests to other hosts.
async function newPage(options) {
    const page = await browser.newPage(options);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(`CSP: ${m.text()}`); });
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation',
        (e) => console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`)));
    await page.route(/run\.app/, (r) => r.abort());                  // the game server: offline here
    await page.route((u) => !/^(https?:\/\/127\.0\.0\.1[:/]|data:|blob:)/.test(u.href) && !/run\.app/.test(u.href),
        (r) => { errors.push(`request to another host: ${r.request().url()}`); r.abort(); });
    return page;
}
try {
    const page = await newPage({ viewport: { width: 1280, height: 720 } });
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

    // Messages: each kind's pop-in, when its fade starts and the fade, in ms
    // (a voice caption holds until 1 s after its line: death-0 is 2.556 s);
    // the end of the pop-in leaves it up, and the end of the fade takes it away.
    const msg = await page.evaluate(async () => {
        const hud = window.__wyrm.hud, box = document.getElementById('msgs'), wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const anim = (el, name) => el.getAnimations().find((a) => a.animationName === name);
        const times = (el) => [anim(el, 'msg-pop'), anim(el, 'msg-out')].map((a) => a && a.effect.getTiming())
            .flatMap((t, i) => (t ? (i ? [t.delay, t.duration] : [t.duration]) : [null]));
        const newest = () => box.querySelector(':scope > .msg');
        const out = {};
        hud.toast('smoke toast'); const toast = newest(); out.toast = times(toast);
        hud.toast('smoke tip', 'hint'); out.hint = times(newest());
        hud.caption({ zh: '龍', py: 'lóng', en: 'dragon' }); out.caption = times(newest());
        hud.caption({ zh: '龍', py: 'lóng', en: 'dragon', secs: 2.556 }); out.line = times(newest());
        await wait(400);
        out.upAfterPop = toast.isConnected;
        anim(toast, 'msg-out').finish();
        await wait(300);
        out.goneAfterFade = !toast.isConnected;
        return out;
    });
    const MSG_WANT = { toast: [128, 2248, 352], hint: [256, 3496, 704], caption: [224, 3184, 616], line: [224, 3556, 616], upAfterPop: true, goneAfterFade: true };
    if (JSON.stringify(msg) !== JSON.stringify(MSG_WANT)) errors.push(`messages: expected ${JSON.stringify(MSG_WANT)}, got ${JSON.stringify(msg)}`);

    // An invite link on a phone: the invited server is pinned first and lit,
    // nobody is joined, and room and src leave the address bar. (Joining it is
    // tested against a real server in server/test/net.test.mjs.)
    const phone = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const rooms = [['skyhold', 'Skyhold', true], ['the-orb', 'The Orb', true], ['Ab3_x-9Kq2Zr', 'Jade Peak', false], ['Qw8-Lm_2Vb7n', 'Misty Falls', false]]
        .map(([id, name, permanent]) => ({ id, name, arena: id === 'the-orb' ? 'orb' : 'sky', beginner: true, permanent, humans: permanent ? 0 : 1, bots: 9, max: 30 }));
    await phone.route(/run\.app\/api\/rooms$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ rooms }) }));
    await phone.goto(`${url}?room=Qw8-Lm_2Vb7n&src=invite`);
    await phone.waitForSelector('#room-list .room.pinned', { timeout: 60000 });
    const pin = await phone.evaluate(() => {
        const rows = [...document.querySelectorAll('#room-list .room')];
        return { names: rows.map((r) => r.querySelector('.rn').textContent + (r.classList.contains('pinned') ? '*' : '')), search: location.search, state: window.__wyrm.state,
            wide: document.documentElement.scrollWidth > innerWidth };
    });
    await phone.screenshot({ path: path.join(shots, 'invite.png') });
    if (pin.names.join() !== 'Misty Falls*,Skyhold,The Orb,Jade Peak') errors.push(`invite: expected Misty Falls pinned first, got ${pin.names.join(', ')}`);
    if (pin.search !== '' || pin.state !== 'menu' || pin.wide) errors.push(`invite: address bar "${pin.search}", state ${pin.state}, wider than the screen: ${pin.wide}`);
    ok = errors.length === 0;
} catch (e) {
    errors.push(e.message);
} finally {
    await browser.close();
    server.close();
}
if (!ok) { console.error('smoke test FAILED\n' + errors.join('\n')); process.exit(1); }
console.log('smoke test ok: the game loads and flies');
