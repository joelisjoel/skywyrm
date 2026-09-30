// Wyrm prototype — game loop and flow: menu (attract mode) → play →
// death-cam → run card → play again (spec §5, §12). Single-player vs
// bots, PC-first, to judge flight feel and 3D encounter density.
import { T, DEFAULTS, loadTune, saveTune, TIERS } from './tunables.js?v=11';
import { World, Dragon, hazardDist } from './sim.js?v=11';
import { managePopulation, targetBots } from './bots.js?v=11';
import { Renderer } from './render.js?v=14';
import { ChaseCam } from './camera.js?v=11';
import { Input } from './input.js?v=12';
import { Hud } from './hud.js?v=12';
import { Audio } from './audio.js?v=10';
import { TunePanel } from './tune-panel.js?v=11';
import { checkName } from './names.js?v=8';
import { NetGame, fetchRooms, createRoom } from './net.js?v=11';
import { serverUrl } from './net-config.js?v=8';

loadTune();

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
const cam = new ChaseCam(renderer.camera);
const input = new Input(canvas);
const hud = new Hud();
const audio = new Audio();

const SETTINGS_KEY = 'wyrm.settings.v1';
const settings = { beginner: true, wideView: true, mirror: true, invertY: false, mouseLock: false, assist: true, reduceMotion: false, muted: false, music: true, voice: true, gfx: 'auto', arena: 'sky', name: '', runs: 0, v: 2 };
try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    Object.assign(settings, saved);
    if (!(saved.v >= 2)) { settings.beginner = true; settings.v = 2; }    // Beginner is the default: switch it back on once
} catch { /* defaults */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

const ADJ = ['Crimson', 'Azure', 'Gilded', 'Ashen', 'Verdant', 'Storm', 'Ember', 'Frost', 'Umbral', 'Solar'];
const NOUN = ['Wyrm', 'Drake', 'Coil', 'Fang', 'Wing', 'Scale'];
const randomName = () => ADJ[Math.floor(Math.random() * ADJ.length)] + ' ' + NOUN[Math.floor(Math.random() * NOUN.length)];

// Player name: the shared safety check (names.js) — same rules the server
// enforces. Returns the clean name, or null (with the reason shown).
function takeName() {
    const r = checkName($('name').value, 'player');
    $('name-error').textContent = r.ok ? '' : r.reason;
    if (!r.ok) return null;
    settings.name = r.value;
    $('name').value = r.value;
    saveSettings();
    return r.value;
}

let world, player = null, state = 'menu';
let actionUntil = 0;
const hype = (secs = 8) => { actionUntil = Math.max(actionUntil, performance.now() / 1000 + secs); };
const view = { state: 'menu', player: null, top: null, board: [], wallWarn: 0 };
let deathInfo = null;
// A game is up to `lives` lives (rule; 0 = endless). Between lives you
// respawn after respawnDelay s; the run card shows once, at the end, with
// the whole game's totals.
let game = null;
const newGame = () => { game = { deaths: 0, kills: 0, peak: 0, time: 0, rank: 99 }; };
const livesTotal = () => (world ? world.rule('lives') : T.lives);
const livesLeft = () => (livesTotal() > 0 ? livesTotal() - game.deaths : Infinity);
function pearls(el, total, left) {
    el.textContent = '';
    if (!(total > 0)) return;
    for (let i = 0; i < total; i++) { const s = document.createElement('span'); if (i >= left) s.className = 'used'; el.appendChild(s); }
}
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
    if (online) { leaveOnline(); }
    audio.unlock();
    if (!takeName()) return;
    settings.runs = (settings.runs || 0) + 1;
    saveSettings();
    if (!player) {
        player = new Dragon(settings.name, false);
        player.color = 0xFFD93D; player.color2 = 0xFF9A3C;
        world.player = player;
    }
    player.name = settings.name;
    newGame();
    // First few runs: nearby bots leave you alone for 45 s (spec §6.8).
    world.gentleTime = settings.runs <= 3 ? 45 : 0;
    player.wallAssist = settings.beginner;
    beginnerRules();
    world.spawn(player, T.spawnMass);
    managePopulation(world);
    lastTarget = targetBots(world);
    view.player = player;
    cam.snap(player);
    input.zero();            // start straight, wherever the cursor happens to be
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
        'Your head on their tail = you\'re out. Their head on your tail = dinner',
        'Stay warm: the sun at the centre and crowds heat you up. Hotter dragons fly faster'];
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
            case 'tier': if (mine) { hud.toast(TIERS[e.tier].name.toUpperCase() + '!', 'big'); audio.tier(); hype(); speak('tier'); } break;
            case 'nearMiss': hud.toast('NEAR MISS', 'nm'); audio.nearMiss(); hype(); break;
            case 'powerup':
                if (mine) {
                    hud.toast({ shield: 'EMBER SHIELD', magnet: 'LODESTONE — reeling in food', fire: 'DRAGONFIRE — press E' }[e.kind]); audio.powerup(e.kind); hype(); speak(e.kind);
                }
                break;
            case 'thrustEmpty': if (mine) audio.thrustEmpty(); break;
            case 'bite':
                renderer.biteBurst(e.x, e.y, e.z, e.color);
                if (mine) { hud.toast(`CHOMP  +${e.gain}`, 'nm'); audio.bite(); hype(6); }
                else if (e.o === player) { hud.toast(`${e.d.name} bit your tail`, 'bad'); audio.bitten(); }
                break;
            case 'parking': parkEndsAt = performance.now() / 1000 + e.in; break;
            case 'unparked': parkEndsAt = 0; break;
            case 'parked': parkEndsAt = 0; setPauseNote('Wings folded — you\'re out of the sky and safe. Your length is kept.'); break;
            case 'land': hud.feed(`🪽 ${e.d.name} folded their wings`); break;
            case 'shieldPop': if (mine) { hud.toast('SHIELD SAVED YOU', 'nm'); audio.shieldPop(); } break;
            case 'fireStart':
                if (mine || e.d.pos.distanceTo(cam.pos) < 60) audio.fire();
                break;
            case 'fireMiss':
                if (mine) hud.toast(`Missed — dragonfire reaches ${Math.round(T.fireRange)} m ahead`, 'bad');
                break;
            case 'sever':
                renderer.burnSegment(e.burn);
                if (mine) { hud.toast(`SEVERED ${e.o.name}!`, 'big'); speak('sever'); }
                if (e.o === player) hud.toast(`${e.d.name} burned your tail!`, 'bad');
                hud.feed(`🔥 ${e.d.name} severed ${e.o.name}`);
                break;
            case 'death': {
                const k = e.killer;
                if (k && k === player) {
                    const big = e.d.mass >= player.mass * 2, king = view.top === e.d;
                    hud.toast(king ? 'KINGSLAYER!' : big ? `BIG KILL — ${e.d.name}` : `+ ${e.d.name}`, 'big');
                    audio.kill(); hype(10); speak('kill');
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
    speak('death');
    if (!game) newGame();
    const at = performance.now() / 1000;
    deathInfo = {
        at,
        pos: player.pos.clone(),
        killer: e.killer,
        text: e.killer ? (e.cause === 'head' ? `Head-on with ${e.killer.name}` : `Poisoned by ${e.killer.name}`) : `Crashed into ${e.cause}`,
    };
    // This life's numbers roll into the game's.
    game.deaths++;
    game.kills += player.kills;
    game.peak = Math.max(game.peak, Math.round(Math.min(T.lenCap, T.lenBase + T.lenPerMass * player.peakMass)));
    game.time += online ? at - (player.bornWall || at) : world.time - player.bornAt;
    game.rank = Math.min(game.rank, player.bestRank);
    deathInfo.final = livesLeft() <= 0;
    deathInfo.respawnAt = at + world.rule('respawnDelay');
    setState('dead');
    if (deathInfo.final) {
        const endless = !(livesTotal() > 0);
        $('card-title').textContent = endless ? deathInfo.text : 'Game over';
        $('card-sub').textContent = endless ? '' : deathInfo.text;
        $('card-len').textContent = game.peak + ' m';
        $('card-kills').textContent = String(game.kills);
        const t = Math.round(game.time);
        $('card-time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
        $('card-rank').textContent = game.rank < 99 ? '#' + game.rank : '—';
    } else {
        $('respawn-text').textContent = deathInfo.text;
        pearls($('respawn-lives'), livesTotal(), livesLeft());
    }
}

// Next life: same game, fresh dragon at a safe spot.
function nextLife() {
    if (online) { online.respawn(); return; }         // the server respawns you (onRespawn → play)
    const ramp = world.rampStart;                   // the bot population keeps building across lives
    world.spawn(player, T.spawnMass);
    world.rampStart = ramp;
    view.player = player;
    cam.snap(player);
    input.zero();
    input.requestLock();
    setState('play');
}

// ------------------------------------------------ multiplayer
let online = null;              // NetGame while in a room
const SERVER_BASE = serverUrl();

function joinRoom(id) {
    const name = takeName();
    if (!name) return;
    audio.unlock();
    if (online) leaveOnline();
    setLobbyStatus('Joining…');
    online = new NetGame(SERVER_BASE, id, name, {
        onWelcome(w, p, room) {
            world = w; player = p;
            newGame();
            w.assist = settings.assist;
            p.bornWall = performance.now() / 1000; p.peakMass = p.mass; p.kills = 0; p.bestRank = 99;
            renderer.clearHeads();
            renderer.buildArena(w.arena);
            view.player = p;
            cam.snap(p);
            input.zero();
            input.requestLock();
            setLobbyStatus('');
            setState('play');
            hud.toast(`Joined ${room.name}`, 'hint');
        },
        onRespawn(p, resumed) {
            if (!resumed) p.bornWall = performance.now() / 1000;
            player = p; view.player = p;
            cam.snap(p);
            input.zero();
            if (state === 'dead' || state === 'pause') { setState('play'); input.requestLock(); }
        },
        onClose(reason) {
            const wasIn = !!online;
            leaveOnline();
            if (wasIn) { setState('menu'); setLobbyStatus(reason); refreshLobby(); }
        },
    });
}

function leaveOnline() {
    const g = online;
    online = null;
    if (g) g.close();
    // Back to your own tunables and a local world for the menu / solo.
    Object.assign(T, DEFAULTS);
    loadTune();
    newWorld();
}

function setLobbyStatus(text) { $('lobby-status').textContent = text || ''; }

function renderRooms(rooms) {
    const list = $('room-list');
    list.textContent = '';
    rooms = rooms.slice().sort((a, b) => (b.beginner - a.beginner) || (b.permanent - a.permanent) || (b.humans - a.humans) || a.name.localeCompare(b.name));
    for (const r of rooms) {
        const row = document.createElement('div');
        row.className = 'room';
        const info = document.createElement('div');
        const nm = document.createElement('div'); nm.className = 'rn'; nm.textContent = r.name;
        if (r.beginner) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'BEGINNER'; nm.appendChild(b); }
        const meta = document.createElement('div'); meta.className = 'rm';
        meta.textContent = (r.arena === 'orb' ? 'The Orb · zero-G' : 'Skyhold · gravity') + (r.permanent ? ' · always on' : '');
        info.append(nm, meta);
        const count = document.createElement('div'); count.className = 'rc';
        count.textContent = `👤 ${r.humans} · 🐉 ${r.bots}`;
        count.title = `${r.humans} player${r.humans === 1 ? '' : 's'} and ${r.bots} bots`;
        const btn = document.createElement('button');
        btn.textContent = r.humans >= r.max ? 'Full' : 'Join';
        btn.disabled = r.humans >= r.max;
        btn.onclick = () => joinRoom(r.id);
        row.append(info, count, btn);
        list.appendChild(row);
    }
}

let lobbyBusy = false, lobbyT = -99;
async function refreshLobby() {
    if (!SERVER_BASE) { setLobbyStatus('multiplayer not set up yet — play solo'); $('create-open').hidden = true; return; }
    if (lobbyBusy) return;
    lobbyBusy = true;
    if (!$('room-list').children.length) setLobbyStatus('waking the servers…');
    try {
        renderRooms(await fetchRooms(SERVER_BASE));
        if (!online) setLobbyStatus('');
    } catch {
        setLobbyStatus('servers offline — play solo');
    } finally { lobbyBusy = false; }
}

$('create-open').onclick = () => { $('create-form').hidden = false; $('create-open').hidden = true; $('create-name').focus(); };
$('create-cancel').onclick = () => { $('create-form').hidden = true; $('create-open').hidden = false; $('create-error').textContent = ''; };
$('create-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const check = checkName($('create-name').value, 'room', ['Skyhold', 'Skyhold Nest', 'Skyhold (Beginners)', 'The Orb']);
    if (!check.ok) { $('create-error').textContent = check.reason; return; }
    if (!takeName()) return;
    $('create-error').textContent = '';
    try {
        const arena = (document.querySelector('input[name=create-arena]:checked') || {}).value === 'orb' ? 'orb' : 'sky';
        const room = await createRoom(SERVER_BASE, { name: check.value, arena, beginner: $('create-beginner').checked });
        $('create-form').hidden = true; $('create-open').hidden = false; $('create-name').value = '';
        joinRoom(room.id);
    } catch (e) {
        $('create-error').textContent = e.message;
    }
};

// ------------------------------------------------ UI wiring
$('name').value = settings.name || randomName();
$('play').onclick = () => startPlay();
$('again').onclick = () => playAgain();
$('menu-btn').onclick = () => { if (online) leaveOnline(); setState('menu'); refreshLobby(); };
$('resume').onclick = () => resume();
$('quit').onclick = () => {
    if (online) leaveOnline();
    else if (player && player.alive) world.kill(player, null, 'the menu');
    setState('menu');
    refreshLobby();
};

// Pause. Solo freezes the world. A room can't stop, so online Esc folds
// your wings: after a 3 s countdown (still flying) your dragon leaves the
// sky with its length kept, and Resume brings it back at a safe spot.
let pausedAt = 0, parkEndsAt = 0;
function setPauseNote(t) { $('pause-note').textContent = t; }
function pause() {
    if (state !== 'play') return;
    setState('pause');
    pausedAt = performance.now();
    if (online) {
        online.park();
        parkEndsAt = performance.now() / 1000 + 3;
        $('pause-title').textContent = 'Folding wings';
    } else {
        $('pause-title').textContent = 'Paused';
        setPauseNote('');
    }
}
function resume() {
    if (state !== 'pause') return;
    if (online) {
        online.unpark();
        parkEndsAt = 0;
        if (!(player && player.alive)) { setPauseNote('Flying back in…'); return; }   // onRespawn resumes play
    }
    setState('play');
    input.zero();
    input.requestLock();
}

function playAgain() {
    if (online) { newGame(); online.respawn(); return; }       // the server respawns you
    startPlay();
}
for (const r of document.querySelectorAll('input[name=arena]')) {
    r.checked = r.value === settings.arena;
    r.onchange = () => { settings.arena = r.value; saveSettings(); newWorld(); };
}
const bindCheck = (id, key, after) => {
    const el = $(id); el.checked = !!settings[key];
    el.onchange = () => { settings[key] = el.checked; saveSettings(); after && after(); };
};
// Solo beginner: walls steer you clear and bots stay gentler (like beginner rooms).
function beginnerRules() { if (online) return; if (settings.beginner) world.rules.botAggrMax = 0.5; else delete world.rules.botAggrMax; }
const syncBeginner = () => { $('opt-beginner').checked = $('solo-beginner').checked = settings.beginner; if (player && !online) player.wallAssist = settings.beginner; beginnerRules(); };
bindCheck('opt-beginner', 'beginner', syncBeginner);
bindCheck('solo-beginner', 'beginner', syncBeginner);
bindCheck('opt-mute', 'muted', () => audio.setMuted(settings.muted));
bindCheck('opt-music', 'music', () => audio.setMusic(settings.music));
bindCheck('opt-voice', 'voice', () => audio.setVoice(settings.voice));
// Graphics: Auto starts high and steps down once if play runs slow.
$('opt-gfx').value = settings.gfx;
$('opt-gfx').onchange = () => { settings.gfx = $('opt-gfx').value; saveSettings(); gfxAuto.t = 0; gfxAuto.n = 0; renderer.setQuality(settings.gfx === 'low' ? 'low' : 'high'); };
renderer.setQuality(settings.gfx === 'low' ? 'low' : 'high');
const gfxAuto = { t: 0, n: 0 };
function autoGraphics() {
    if (settings.gfx !== 'auto' || renderer.quality === 'low' || state !== 'play') { gfxAuto.t = 0; return; }
    const now = performance.now() / 1000;             // wall clock: frame dt is capped
    if (!gfxAuto.t) { gfxAuto.t = now; gfxAuto.n = 0; return; }
    gfxAuto.n++;
    if (now - gfxAuto.t < 5) return;
    const fps = gfxAuto.n / (now - gfxAuto.t);
    gfxAuto.t = 0;
    if (fps < 40) { renderer.setQuality('low'); hud.toast('Graphics set to Low for smoother flying', 'hint'); }
}
bindCheck('opt-invert', 'invertY', () => (input.settings.invertY = settings.invertY));
bindCheck('opt-lock', 'mouseLock', () => (input.settings.mouseLock = settings.mouseLock));
bindCheck('opt-assist', 'assist', () => world && (world.assist = settings.assist));
bindCheck('opt-motion', 'reduceMotion', () => (cam.reduceMotion = settings.reduceMotion));
input.settings.invertY = settings.invertY;
input.settings.mouseLock = settings.mouseLock;
cam.reduceMotion = settings.reduceMotion;
audio.muted = settings.muted;
audio.musicOn = settings.music;
audio.voiceOn = settings.voice;

// The dragon speaks: a Mandarin shout, captioned with pinyin and English.
let captionTimer = 0;
function speak(ev) {
    const ph = audio.say(ev);
    if (!ph) return;
    const box = $('voice-caption');
    box.querySelector('.zh').textContent = ph.zh;
    box.querySelector('.py').textContent = ph.py;
    box.querySelector('.en').textContent = ph.en;
    box.classList.remove('show'); void box.offsetWidth; box.classList.add('show');
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => box.classList.remove('show'), 2800);
}
// Browsers only allow sound after a gesture: the first click or key starts
// the menu music.
const firstGesture = () => { audio.unlock(); removeEventListener('pointerdown', firstGesture); removeEventListener('keydown', firstGesture); };
addEventListener('pointerdown', firstGesture);
addEventListener('keydown', firstGesture);

// Settings / Controls overlays, reachable from the main menu and pause.
let overlay = '';
function openOverlay(name) { overlay = name; document.body.dataset.overlay = name; }
function closeOverlay() { overlay = ''; delete document.body.dataset.overlay; }
for (const b of document.querySelectorAll('.open-settings')) b.onclick = () => openOverlay('settings');
for (const b of document.querySelectorAll('.open-controls')) b.onclick = () => openOverlay('controls');
for (const b of document.querySelectorAll('.close-overlay')) b.onclick = () => closeOverlay();

// Settings tabs: Server (room rules) vs Player (personal).
for (const b of document.querySelectorAll('#settings .tab')) b.onclick = () => ($('settings').dataset.tab = b.dataset.tab);
bindCheck('opt-wide', 'wideView', () => (renderer.view.wide = settings.wideView));
bindCheck('opt-mirror', 'mirror', () => (renderer.view.mirror = settings.mirror));
renderer.view.wide = settings.wideView;
renderer.view.mirror = settings.mirror;

const tune = new TunePanel(() => { newWorld(); setState('menu'); syncServer(); });
$('tune-btn').onclick = () => tune.toggle();

// Server sliders edit the same tunables as the dev panel.
const SERVER = [['srv-start', 'popStart', (v) => String(v)], ['srv-max', 'popMax', (v) => String(v)], ['srv-every', 'popRampSec', (v) => v + ' s']];
function syncServer() {
    for (const [id, key, fmt] of SERVER) { $(id).value = T[key]; $(id + '-v').textContent = fmt(T[key]); }
}
for (const [id, key, fmt] of SERVER) {
    $(id).oninput = () => {
        T[key] = +$(id).value;
        if (key === 'popStart' && T.popStart > T.popMax) T.popMax = T.popStart;
        if (key === 'popMax' && T.popMax < T.popStart) T.popStart = T.popMax;
        saveTune(); syncServer(); tune.sync();
    };
}
syncServer();

input.onKey = (code) => {
    if (code === 'Backquote') tune.toggle();
    else if (code === 'KeyM') { settings.muted = !settings.muted; audio.setMuted(settings.muted); $('opt-mute').checked = settings.muted; saveSettings(); }
    else if (code === 'KeyN') { settings.music = !settings.music; audio.setMusic(settings.music); $('opt-music').checked = settings.music; saveSettings(); hud.toast(settings.music ? '♪ Music on' : 'Music off', 'hint'); }
    else if (overlay && (code === 'Escape' || code === 'Enter')) closeOverlay();
    else if (overlay) return;
    else if ((code === 'KeyE' || code === 'KeyF') && state === 'play' && player && player.alive && !player.fire && !(player.breath > 0)) {
        hud.toast('No dragonfire — grab a red crystal first', 'hint');
    }
    else if (code === 'Escape' || code === 'KeyP') {
        if (state === 'play') pause();
        // Leaving pointer lock with Esc can deliver both the lock change and
        // the key; ignore a second Esc that arrives right after pausing.
        else if (state === 'pause' && performance.now() - pausedAt > 400) resume();
    } else if ((code === 'Space' || code === 'Enter') && state === 'dead' && deathInfo.final && performance.now() / 1000 - deathInfo.at > 0.9) playAgain();
    else if (code === 'Enter' && state === 'menu') startPlay();
};
// Clicking back into the game re-grabs the pointer in lock mode.
canvas.addEventListener('click', () => { if (state === 'play') input.requestLock(); });
document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && state === 'play' && settings.mouseLock) pause();
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

    if (online && online.world) {
        // In a room: fly yourself locally, everything else from the server
        // (a room never pauses — Esc only opens the menu).
        const t0 = performance.now();
        if (player && player.alive && state === 'play') input.read(player.input);
        else if (player) { const i = player.input; i.sx = i.sy = i.roll = 0; i.boost = i.brake = i.fire = false; }
        if (player && online.room) player.wallAssist = !!online.room.beginner || state !== 'play';   // autopilot while folding wings
        online.update(dt);
        const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
        for (let i = 0; i < steps; i++) world.step(dt / steps);
        world.events.push(...online.takeEvents());
        handleEvents();
        view.humans = online.humans;
        simMs = simMs * 0.9 + (performance.now() - t0) * 0.1;
    } else if (state !== 'pause') {
        view.humans = 0;
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
    if (state === 'menu' && now - lobbyT > 5) { lobbyT = now; refreshLobby(); }

    // Population ramp: announce each new arrival (solo).
    if (!online && player && player.alive && state === 'play') {
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
                if (r === 1 && player.bestRank > 1 && world.time - player.bornAt > 5) { hud.toast('YOU ARE #1 — your head is ablaze for all to see', 'big'); audio.leader(); hype(12); speak('leader'); }
                player.bestRank = r;
            }
        }
    }

    // Camera.
    if (state === 'play' || (state === 'pause' && player && player.alive)) {
        cam.follow(player, state === 'pause' && !online ? 0 : dt, world.arena, input.lookBack());
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
        if (deathInfo.final) { if (now - deathInfo.at > 1.5) document.body.dataset.card = '1'; }
        else {
            const left = deathInfo.respawnAt - now;
            document.body.dataset.respawn = '1';
            $('respawn-count').textContent = String(Math.max(1, Math.ceil(left)));
            if (left <= 0 && !deathInfo.respawning) { deathInfo.respawning = true; nextLife(); }
        }
    } else {
        cam.attract(world.arena, dt);
        view.wallWarn = 0;
        audio.wind(0, false);
    }
    if (state !== 'dead') { document.body.dataset.card = ''; document.body.dataset.respawn = ''; }
    view.lives = game && livesTotal() > 0 ? { total: livesTotal(), left: livesLeft() } : null;

    // Soundtrack: calm in menus, driving while you fly, full band in the action.
    let level = 0;
    if (state === 'play' && player && player.alive) {
        const rank = view.board.indexOf(player) + 1;
        if (player.boosting || player.breath > 0 || player.fire || (rank > 0 && rank <= 3)) hype(4);
        level = now < actionUntil ? 2 : 1;
    }
    audio.mood(level, state === 'pause');
    audio.hum(state === 'play' && !!player && player.alive && player.magnet > 0);
    if (state === 'pause' && online && parkEndsAt) {
        const left = Math.max(0, Math.ceil(parkEndsAt - now));
        setPauseNote(left > 0 ? `Leaving the sky in ${left}… you keep flying (and can still be hit) until then.` : 'Folding…');
    }

    autoGraphics();
    renderer.update(world, view, dt, now);
    hud.draw(world, view, renderer, input, now);
    hud.updateStats(world, view, now, fps);
    tune.update(world, renderer, simMs, fps);
}
requestAnimationFrame(frame);

// Test hook for the headless smoke test.
window.__wyrm = { get world() { return world; }, get state() { return state; }, startPlay, joinRoom, get player() { return player; }, get online() { return online; }, audio, renderer };
