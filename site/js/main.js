// Wyrm prototype — game loop and flow: menu (attract mode) → play →
// death-cam → run card → play again (spec §5, §12). Single-player vs
// bots, PC-first, to judge flight feel and 3D encounter density.
import { T, loadTune, TIERS } from './tunables.js?v=2';
import { World, Dragon, hazardDist } from './sim.js?v=2';
import { managePopulation, targetBots } from './bots.js?v=2';
import { Renderer } from './render.js?v=2';
import { ChaseCam } from './camera.js?v=2';
import { Input } from './input.js?v=2';
import { Hud } from './hud.js?v=2';
import { Audio } from './audio.js?v=2';
import { TunePanel } from './tune-panel.js?v=2';

loadTune();

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
const cam = new ChaseCam(renderer.camera);
const input = new Input(canvas);
const hud = new Hud();
const audio = new Audio();

const SETTINGS_KEY = 'wyrm.settings.v1';
const settings = { beginner: true, invertY: false, mouseLock: false, assist: true, reduceMotion: false, muted: false, arena: 'sky', name: '', runs: 0 };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* defaults */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

const ADJ = ['Crimson', 'Azure', 'Gilded', 'Ashen', 'Verdant', 'Storm', 'Ember', 'Frost', 'Umbral', 'Solar'];
const NOUN = ['Wyrm', 'Drake', 'Coil', 'Fang', 'Wing', 'Scale'];
const randomName = () => ADJ[Math.floor(Math.random() * ADJ.length)] + ' ' + NOUN[Math.floor(Math.random() * NOUN.length)];

// Names: 16 chars, no control/invisible/bidi chars, no URLs (spec §17).
function cleanName(s) {
    s = (s || '').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '')
        .replace(/[̀-ͯ]{2,}/g, '').replace(/https?:\/\/\S*|www\.\S*|\S+\.(com|io|net|org|gg)\b/gi, '').trim();
    return s.slice(0, 16) || randomName();
}

let world, player = null, state = 'menu';
const view = { state: 'menu', player: null, top: null, board: [], wallWarn: 0 };
let deathInfo = null;
const run = { startMass: T.spawnMass };

function newWorld() {
    world = new World(settings.arena);
    world.assist = settings.assist;
    world.gentleTime = 0;
    renderer.clearHeads();
    renderer.buildArena(world.arena);
    world.spawnAmbient(T.orbTarget);
    managePopulation(world, true);
    // Warm up so bots have grown and laid real tails before you arrive.
    for (let i = 0; i < 25 * 30; i++) { world.step(1 / 30); managePopulation(world); }
    player = null;
    view.player = null;
}

function startPlay() {
    audio.unlock();
    settings.name = cleanName($('name').value);
    $('name').value = settings.name;
    settings.runs = (settings.runs || 0) + 1;
    saveSettings();
    if (!player) {
        player = new Dragon(settings.name, false);
        player.color = 0xFFD93D; player.color2 = 0xFF9A3C;
        world.player = player;
    }
    player.name = settings.name;
    // First few runs: nearby bots leave you alone for 45 s (spec §6.8).
    world.gentleTime = settings.runs <= 3 ? 45 : 0;
    player.wallAssist = settings.beginner;
    world.spawn(player, T.spawnMass);
    managePopulation(world);
    lastTarget = targetBots(world);
    view.player = player;
    cam.snap(player);
    input.requestLock();
    setState('play');
    if (settings.runs <= 3) showHints();
}

function setState(s) {
    state = s; view.state = s;
    if (s === 'play' || s === 'dead') closeOverlay();
    document.body.dataset.state = s;
    if (s !== 'play') input.releaseLock();
}

let hintTimer = 0;
function showHints() {
    const hints = ['Move the mouse to steer — the further from centre, the harder you turn',
        'Hold click / W to boost (burns length) · right-click / S to brake for tight turns',
        'Your head on their tail = you\'re out. Their head on your tail = dinner'];
    let i = 0;
    clearInterval(hintTimer);
    const next = () => { if (i < hints.length && state === 'play') hud.toast(hints[i++], 'hint'); else clearInterval(hintTimer); };
    next();
    hintTimer = setInterval(next, 3200);
}

// ------------------------------------------------ events → feedback
function handleEvents() {
    for (const e of world.events) {
        const mine = e.d === player;
        switch (e.type) {
            case 'eat': if (mine) audio.eat(world.time); break;
            case 'tier': if (mine) { hud.toast(TIERS[e.tier].name.toUpperCase() + '!', 'big'); audio.tier(); } break;
            case 'nearMiss': hud.toast('NEAR MISS', 'nm'); audio.nearMiss(); break;
            case 'powerup':
                if (mine) {
                    hud.toast({ shield: 'EMBER SHIELD', magnet: 'LODESTONE', fire: 'DRAGONFIRE — press E' }[e.kind]); audio.powerup();
                }
                break;
            case 'shieldPop': if (mine) { hud.toast('SHIELD SAVED YOU', 'nm'); audio.shieldPop(); } break;
            case 'fire':
                renderer.burstFire(e.d);
                if (mine || e.d.pos.distanceTo(cam.pos) < 40) audio.fire();
                break;
            case 'sever':
                if (mine) hud.toast(`SEVERED ${e.o.name}!`, 'big');
                if (e.o === player) hud.toast(`${e.d.name} burned your tail!`, 'bad');
                hud.feed(`🔥 ${e.d.name} severed ${e.o.name}`);
                break;
            case 'death': {
                const k = e.killer;
                if (k && k === player) {
                    const big = e.d.mass >= player.mass * 2, king = view.top === e.d;
                    hud.toast(king ? 'KINGSLAYER!' : big ? `BIG KILL — ${e.d.name}` : `+ ${e.d.name}`, 'big');
                    audio.kill();
                }
                hud.feed(k ? `${k.name} ⟶ ${e.d.name}` : `${e.d.name} hit ${e.cause}`);
                if (e.d === player) onPlayerDeath(e);
                break;
            }
        }
    }
}

function onPlayerDeath(e) {
    audio.death();
    deathInfo = {
        at: performance.now() / 1000,
        pos: player.pos.clone(),
        killer: e.killer,
        text: e.killer ? (e.cause === 'head' ? `Head-on with ${e.killer.name}` : `Eaten by ${e.killer.name}`) : `Crashed into ${e.cause}`,
        peak: Math.round(Math.min(T.lenCap, T.lenBase + T.lenPerMass * player.peakMass)),
        kills: player.kills,
        time: world.time - player.bornAt,
        rank: player.bestRank,
    };
    setState('dead');
    $('card-title').textContent = deathInfo.text;
    $('card-len').textContent = deathInfo.peak + ' m';
    $('card-kills').textContent = String(deathInfo.kills);
    const t = Math.round(deathInfo.time);
    $('card-time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    $('card-rank').textContent = deathInfo.rank < 99 ? '#' + deathInfo.rank : '—';
}

// ------------------------------------------------ UI wiring
$('name').value = settings.name || randomName();
$('play').onclick = () => startPlay();
$('again').onclick = () => startPlay();
$('menu-btn').onclick = () => { setState('menu'); };
$('resume').onclick = () => { setState('play'); input.requestLock(); };
$('quit').onclick = () => { if (player && player.alive) { world.kill(player, null, 'the menu'); } setState('menu'); };
for (const r of document.querySelectorAll('input[name=arena]')) {
    r.checked = r.value === settings.arena;
    r.onchange = () => { settings.arena = r.value; saveSettings(); newWorld(); };
}
const bindCheck = (id, key, after) => {
    const el = $(id); el.checked = !!settings[key];
    el.onchange = () => { settings[key] = el.checked; saveSettings(); after && after(); };
};
bindCheck('opt-beginner', 'beginner', () => { if (player) player.wallAssist = settings.beginner; });
bindCheck('opt-mute', 'muted', () => audio.setMuted(settings.muted));
bindCheck('opt-invert', 'invertY', () => (input.settings.invertY = settings.invertY));
bindCheck('opt-lock', 'mouseLock', () => (input.settings.mouseLock = settings.mouseLock));
bindCheck('opt-assist', 'assist', () => world && (world.assist = settings.assist));
bindCheck('opt-motion', 'reduceMotion', () => (cam.reduceMotion = settings.reduceMotion));
input.settings.invertY = settings.invertY;
input.settings.mouseLock = settings.mouseLock;
cam.reduceMotion = settings.reduceMotion;
audio.muted = settings.muted;

// Settings / Controls overlays, reachable from the main menu and pause.
let overlay = '';
function openOverlay(name) { overlay = name; document.body.dataset.overlay = name; }
function closeOverlay() { overlay = ''; delete document.body.dataset.overlay; }
for (const b of document.querySelectorAll('.open-settings')) b.onclick = () => openOverlay('settings');
for (const b of document.querySelectorAll('.open-controls')) b.onclick = () => openOverlay('controls');
for (const b of document.querySelectorAll('.close-overlay')) b.onclick = () => closeOverlay();

const tune = new TunePanel(() => { newWorld(); setState('menu'); });
$('tune-btn').onclick = () => tune.toggle();

input.onKey = (code) => {
    if (code === 'Backquote') tune.toggle();
    else if (code === 'KeyM') { settings.muted = !settings.muted; audio.setMuted(settings.muted); $('opt-mute').checked = settings.muted; saveSettings(); }
    else if (overlay && (code === 'Escape' || code === 'Enter')) closeOverlay();
    else if (overlay) return;
    else if (code === 'Escape' || code === 'KeyP') {
        if (state === 'play') setState('pause');
        else if (state === 'pause') { setState('play'); input.requestLock(); }
    } else if ((code === 'Space' || code === 'Enter') && state === 'dead' && performance.now() / 1000 - deathInfo.at > 0.9) startPlay();
    else if (code === 'Enter' && state === 'menu') startPlay();
};
// Clicking back into the game re-grabs the pointer in lock mode.
canvas.addEventListener('click', () => { if (state === 'play') input.requestLock(); });
document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && state === 'play' && settings.mouseLock) setState('pause');
});
addEventListener('resize', () => { renderer.resize(); hud.resize(); });

// ------------------------------------------------ loop
newWorld();
setState('menu');
let lastTarget = 0;
let last = performance.now(), fpsN = 0, fpsT = 0, fps = 0, simMs = 0, boardT = 0, wasBoosting = false;

function frame(nowMs) {
    requestAnimationFrame(frame);
    const now = nowMs / 1000;
    let dt = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    fpsN++; fpsT += dt;
    if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }

    if (state !== 'pause') {
        const t0 = performance.now();
        const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
            if (player && player.alive && state === 'play') input.read(player.input);
            world.step(h);
            handleEvents();
            managePopulation(world);
        }
        simMs = simMs * 0.9 + (performance.now() - t0) * 0.1;
    }

    // Population ramp: announce each new arrival.
    if (player && player.alive && state === 'play') {
        const tb = targetBots(world);
        if (tb > lastTarget) hud.feed(`🐉 A new dragon arrives — ${tb} others now`);
        lastTarget = tb;
    }
    document.getElementById('hud-assist').style.opacity = player && player.alive && state === 'play' && player.assisting > 0.25 ? '1' : '0';

    // Leaderboard + best rank (4 Hz).
    if (now - boardT > 0.25) {
        boardT = now;
        view.board = world.leaderboard();
        view.top = view.board[0] || null;
        if (player && player.alive) {
            const r = view.board.indexOf(player) + 1;
            if (r > 0 && r < player.bestRank) {
                if (r === 1 && player.bestRank > 1 && world.time - player.bornAt > 5) hud.toast('YOU ARE #1 — everyone can see your beacon', 'big');
                player.bestRank = r;
            }
        }
    }

    // Camera.
    if (state === 'play' || (state === 'pause' && player && player.alive)) {
        cam.follow(player, state === 'pause' ? 0 : dt, world.arena, input.lookBack());
        const [hd] = hazardDist(world.arena, player.pos);
        view.wallWarn = Math.max(0, Math.min(1, (14 - hd) / 10));
        if (player.boosting && !wasBoosting) audio.boostStart();
        wasBoosting = player.boosting;
        audio.wind(player.speed, state === 'play');
    } else if (state === 'dead') {
        const k = deathInfo.killer && deathInfo.killer.alive ? deathInfo.killer.pos : deathInfo.pos;
        cam.deathOrbit(deathInfo.pos, k, dt);
        view.wallWarn = 0;
        audio.wind(0, false);
        if (now - deathInfo.at > 1.5) document.body.dataset.card = '1';
    } else {
        cam.attract(world.arena, dt);
        view.wallWarn = 0;
        audio.wind(0, false);
    }
    if (state !== 'dead') document.body.dataset.card = '';

    renderer.update(world, view, dt, now);
    hud.draw(world, view, renderer.camera, input, now);
    hud.updateStats(world, view, now, fps);
    tune.update(world, renderer, simMs, fps);
}
requestAnimationFrame(frame);

// Test hook for the headless smoke test.
window.__wyrm = { get world() { return world; }, get state() { return state; }, startPlay, get player() { return player; } };
