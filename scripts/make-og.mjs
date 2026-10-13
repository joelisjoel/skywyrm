#!/usr/bin/env node
// The link-preview picture and the icons:
//   site/og.jpg                1200×630, what chat apps and social sites show
//                              when someone shares skywyrm.io (index.html's
//                              og:image and twitter:image)
//   site/apple-touch-icon.png  180×180, the 龍 seal (iOS home screen)
//   site/favicon.png           64×64, the 龍 seal (browser tab)
//
// The picture is the real game: index.html loads in headless Chromium, the
// simulation is paused, one dragon is posed along a curve in Skyhold with the
// sun behind it, the menu and HUD are hidden, and the frame is taken at 2×.
// Then the SKYWYRM wordmark and 龍 seal, styled like the menu, are laid over it.
//
// The seal's 龍 is a traditional character, which Ma Shan Zheng doesn't have,
// so it needs a Kai font on this machine, as the menu does (macOS and Windows
// have one; on Debian or Ubuntu: apt install fonts-arphic-ukai).
//
// Run: npm run og   (writes the three files; look at them before committing)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { serve } from './serve.mjs';
import { launchChromium } from './browser.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');
const W = 1200, H = 630;

// The shot. Camera in world metres (Skyhold's sun is at 0, 70, 0). The dragon
// is an Elder (gold antlers and crown) in the Crimson skin, and its spine runs
// through these points, head first: [x px, y px] in the picture and the
// distance in front of the camera in metres.
const SHOT = {
    cam: { pos: [-160, 30, 78], look: [-60, 34, 78], fov: 48 },
    mass: 700, color: 0xE0303A, color2: 0xFFD24A,
    spine: [[660, 225, 38], [750, 262, 40], [850, 312, 43], [970, 322, 48], [1070, 270, 55], [1100, 180, 66],
        [1040, 95, 84], [920, 62, 100], [800, 58, 110], [700, 78, 118], [640, 60, 124]],
    food: 0.12,          // share of the food left in the sky, so it reads as sparkle rather than noise
    flap: 4.71, swim: 0, // held still: the whiskers' sway (down, clear of the eye) and the body's swim wave (render.js)
};

const KAI = "'STKaiti', 'Kaiti TC', 'Kaiti SC', 'KaiTi', 'BiauKai', 'AR PL UKai TW', 'AR PL UKai CN'";
const font = (file) => `url(data:font/woff2;base64,${readFileSync(path.join(site, 'fonts', file)).toString('base64')}) format('woff2')`;
const SEAL_CSS = `font-family: ${KAI}, serif; color: #F7E8CC; line-height: 1; display: grid; place-items: center;
    background: radial-gradient(circle at 30% 25%, #C8453B, #B3322A 60%, #8E2620);`;

async function shoot(browser, url) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.route(/run\.app/, (r) => r.abort());                      // no game server
    // Seeded randomness, so the world (and the food left in it) is the same every run.
    await page.addInitScript(() => { let s = 20261012; Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; });
    await page.goto(url);
    await page.waitForFunction(() => window.__wyrm && window.__wyrm.world, null, { timeout: 60000 });
    await page.addStyleTag({ content: 'body > *:not(#game) { display: none !important; }' });
    const info = await page.evaluate(async (S) => {
        const THREE = await import('three');
        const w = window.__wyrm.world, r = window.__wyrm.renderer;
        if (w.arena.key !== 'sky') throw new Error('expected Skyhold');
        w.step = () => {};                                                // pause the world
        w.leaderboard = () => [];                                         // no #1 blaze
        // The camera, and the spine's points in the world.
        const cam = new THREE.PerspectiveCamera(S.cam.fov, innerWidth / innerHeight, 0.1, 3000);
        cam.position.set(...S.cam.pos); cam.lookAt(...S.cam.look); cam.updateMatrixWorld();
        const fwd = cam.getWorldDirection(new THREE.Vector3());
        const ctrl = S.spine.map(([x, y, z]) => {
            const dir = new THREE.Vector3(x / innerWidth * 2 - 1, 1 - y / innerHeight * 2, 0.5).unproject(cam).sub(cam.position).normalize();
            return cam.position.clone().addScaledVector(dir, z / dir.dot(fwd));
        });
        const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
        const pts = curve.getSpacedPoints(Math.ceil(curve.getLength() / 0.5));
        // The hero: a new dragon of the plain bloodline (render.js bloodline(),
        // which goes by id). The bots flying the menu's sky leave.
        for (const o of w.dragons) o.alive = false;
        const line = (o) => { let h = 2166136261; for (const ch of String(o.id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000 < 0.5 ? 0 : 1; };
        // The page's own sim module (same URL and ?v= stamp, so the same instance).
        const { Dragon } = await import(performance.getEntriesByType('resource').find((e) => /\/js\/sim\.js/.test(e.name)).name);
        let d;
        do d = new Dragon('Skywyrm', true); while (line(d) !== 0);
        w.spawn(d, S.mass);
        d.protect = 0; d.color = S.color; d.color2 = S.color2;
        const F = pts[0].clone().sub(pts[1]).normalize();
        const R = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize();
        const U = new THREE.Vector3().crossVectors(R, F);
        d.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(R, U, F.clone().negate()));
        d.updateFrame(); d.vdir.copy(d.fwd);
        d.pos.copy(pts[0]);
        d.pathHead = -1; d.pathCount = 0;
        for (let i = pts.length - 1; i >= 0; i--) d.pushPath(pts[i].x, pts[i].y, pts[i].z);
        d.rebuildBeads();
        // Tidy: no crystals, pearls or clouds; a little food (and no loot
        // trails from the bots that left), none on the dragon.
        w.powerups.length = 0;
        if (w.pearls) w.pearls.length = 0;
        if (w.clouds) w.clouds.length = 0;
        let seed = 7;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const near = (x, y, z) => {
            for (let b = 0; b < d.nBeads; b++) if (Math.hypot(d.beads[b * 3] - x, d.beads[b * 3 + 1] - y, d.beads[b * 3 + 2] - z) < 25) return true;
            return Math.hypot(cam.position.x - x, cam.position.y - y, cam.position.z - z) < 60;
        };
        for (let i = 0; i < w.oHigh; i++) if (w.oalive[i] && (w.ottl[i] || rnd() > S.food || near(w.ox[i], w.oy[i], w.oz[i]))) w.removeOrb(i);
        // The storm wall's ribs read as stripes in a still: hide them.
        r.arenaGroup.traverse((o) => { if (o.isLineSegments && o.material.color.getHex() === 0xF0CC86) o.visible = false; });
        // Every frame: the camera on the shot, the whiskers and swim held still.
        const update = r.update.bind(r);
        r.update = (world, view, dt, time) => {
            r.camera.position.copy(cam.position); r.camera.up.set(0, 1, 0); r.camera.lookAt(...S.cam.look);
            r.camera.fov = S.cam.fov; r.camera.updateProjectionMatrix();
            const h = r.headFor(d);
            h.flap = S.flap - dt * 4; h.swim = S.swim - d.speed * dt;
            update(world, view, dt, time);
        };
        return { length: Math.round(curve.getLength()), beads: d.nBeads, tier: d.tier };
    }, SHOT);
    await page.waitForTimeout(4000);                                      // shaders compiled, the swim settled
    const png = await page.screenshot();
    await page.close();
    console.log(`shot: an Elder (tier ${info.tier}), ${info.beads} beads along ${info.length} m of spine`);
    return png;
}

// The wordmark and seal over the shot, styled like the menu (.brand in style.css).
async function card(browser, shot) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Cinzel'; src: ${font('cinzel-700.woff2')}; font-weight: 700; }
@font-face { font-family: 'Cinzel'; src: ${font('cinzel-600.woff2')}; font-weight: 600; }
body { margin: 0; }
.card { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: url(data:image/png;base64,${shot.toString('base64')}) center / cover; }
.shade { position: absolute; inset: 0;
  background: linear-gradient(0deg, rgba(10,8,6,0.92) 0%, rgba(10,8,6,0.78) 22%, rgba(10,8,6,0.35) 40%, rgba(10,8,6,0) 56%),
    radial-gradient(ellipse 80% 90% at 50% 40%, rgba(0,0,0,0) 60%, rgba(8,6,4,0.45) 100%); }
.brand { position: absolute; left: 0; right: 0; bottom: 92px; display: flex; align-items: center; justify-content: center; gap: 30px; }
h1 { margin: 0 -0.2em 0 0; font: 700 118px/1 'Cinzel', serif; letter-spacing: 0.2em;
  background: linear-gradient(180deg, #F3DDA4 10%, #D9B56C 55%, #9C7A3C 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 3px 2px rgba(0,0,0,0.55)) drop-shadow(0 0 22px rgba(217,181,108,0.35)); }
.seal { ${SEAL_CSS} width: 112px; height: 112px; flex: none; font-size: 86px; border-radius: 15px; transform: rotate(-5deg);
  box-shadow: inset 0 0 0 5px rgba(247,232,204,0.75), inset 0 0 0 10px #B3322A, 0 8px 26px rgba(0,0,0,0.5), 0 0 30px rgba(179,50,42,0.35); }
.tag { position: absolute; left: 0; right: 0; bottom: 42px; text-align: center; font: 600 25px/1 'Cinzel', serif;
  letter-spacing: 0.2em; text-transform: uppercase; color: #E8DAC0; text-shadow: 0 2px 6px rgba(0,0,0,0.6); }
.c { position: absolute; width: 34px; height: 34px; border: 0 solid rgba(217,181,108,0.7); }
</style>
<div class="card"><div class="shade"></div>
  <div class="c" style="left:18px;top:18px;border-left-width:2px;border-top-width:2px;border-top-left-radius:10px"></div>
  <div class="c" style="right:18px;top:18px;border-right-width:2px;border-top-width:2px;border-top-right-radius:10px"></div>
  <div class="c" style="left:18px;bottom:18px;border-left-width:2px;border-bottom-width:2px;border-bottom-left-radius:10px"></div>
  <div class="c" style="right:18px;bottom:18px;border-right-width:2px;border-bottom-width:2px;border-bottom-right-radius:10px"></div>
  <div class="brand"><div class="seal">龍</div><h1>SKYWYRM</h1></div>
  <div class="tag">Hatch small · Grow huge · Rule the sky</div>
</div>`);
    await page.evaluate(() => document.fonts.ready);
    const kai = await page.evaluate((list) => {
        // A font is installed if text set in it measures differently from the fallback.
        const c = document.createElement('canvas').getContext('2d'), probe = 'wWmM龍1il';
        const width = (f) => { c.font = `40px ${f}`; return c.measureText(probe).width; };
        return list.split(',').map((f) => f.trim()).find((f) => width(`${f}, monospace`) !== width('monospace')) || null;
    }, KAI);
    if (!kai) console.warn('warning: no Kai font found, so the seal\'s 龍 uses a fallback (see the note at the top of this script)');
    const jpg = await page.screenshot({ type: 'jpeg', quality: 86 });
    await page.close();
    return jpg;
}

// The seal alone: for the tab, rounded with its ring at the edge like the
// menu's; for iOS, full-bleed with the ring set in (iOS rounds the corners).
async function icon(browser, size, tab) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const [inset, ring, radius] = tab ? [0, size * 0.055, size * 0.15] : [size * 0.09, size * 0.035, size * 0.14];
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; background: transparent; }
.seal { ${SEAL_CSS} position: relative; width: ${size}px; height: ${size}px; font-size: ${Math.round(size * (tab ? 0.78 : 0.62))}px;
  border-radius: ${tab ? radius : 0}px; overflow: hidden; }
.ring { position: absolute; inset: ${inset}px; border: ${ring}px solid rgba(247,232,204,0.8); border-radius: ${radius}px; }
</style><div class="seal"><div class="ring"></div>龍</div>`);
    const png = await page.screenshot({ omitBackground: true });
    await page.close();
    return png;
}

const server = await serve(0);
const browser = await launchChromium();
try {
    const shot = await shoot(browser, `http://127.0.0.1:${server.address().port}/index.html`);
    const out = { 'og.jpg': await card(browser, shot), 'apple-touch-icon.png': await icon(browser, 180, false),
        'favicon.png': await icon(browser, 64, true) };
    for (const [name, data] of Object.entries(out)) {
        writeFileSync(path.join(site, name), data);
        console.log(`site/${name}: ${Math.round(data.length / 1024)} KB`);
    }
} finally {
    await browser.close();
    server.close();
}
