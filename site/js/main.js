// Skywyrm game loop and flow: menu (attract mode, server list) → play,
// solo vs bots or online (net.js) → death-cam → run card → play again.
// Runs on PCs and phones.
import { T, DEFAULTS, loadTune, TIERS, lengthFor } from './tunables.js?v=25';
import { World, Dragon, hazardDist } from './sim.js?v=25';
import { managePopulation, targetBots } from './bots.js?v=25';
import { Renderer } from './render.js?v=40';
import { ChaseCam } from './camera.js?v=25';
import { Input } from './input.js?v=29';
import { Hud } from './hud.js?v=29';
import { Audio } from './audio.js?v=16';
import { TunePanel } from './tune-panel.js?v=26';
import { checkName, randomRoomName } from './names.js?v=11';
import { NetGame, fetchRooms, createRoom } from './net.js?v=28';
import { serverUrl } from './net-config.js?v=9';
import { Profile } from './profile.js?v=2';
import { PERKS, SKINS, perkSlots } from './perks.js?v=1';

// Developer tools (the ` tuning panel, its ⚙ button, the FPS readout) only
// with ?dev=1 or on a local page. Everyone else plays on the defaults: saved
// tuning overrides are ignored (and left alone for when dev is back on).
const DEV = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || new URLSearchParams(location.search).get('dev') === '1';
if (DEV) loadTune();

const $ = (id) => document.getElementById(id);
if (!DEV) for (const el of document.querySelectorAll('.dev-only')) el.remove();
const canvas = $('game');
const renderer = new Renderer(canvas);
const cam = new ChaseCam(renderer.camera);
const input = new Input(canvas);
const hud = new Hud();
const audio = new Audio();
// Moving house: the old address (dendroslabs.com/wyrm) hands this
// browser's progress over in the link fragment (#carry=…, which is never
// sent to any server). It's taken once, only on a device with no Skywyrm
// progress yet, and then wiped from the address bar.
(function carryOver() {
    const m = /[#&]carry=([A-Za-z0-9_-]{1,8000})/.exec(location.hash);
    if (!m) return;
    try {
        const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
        const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
        const keep = (key, val) => { if (val && typeof val === 'object' && !Array.isArray(val) && !localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(val)); };
        keep('wyrm.profile.v1', data.p);
        keep('wyrm.settings.v1', data.s);
    } catch { /* a bad link: ignore it */ }
    history.replaceState(null, '', location.pathname + location.search);
})();
const profile = new Profile();

const SETTINGS_KEY = 'wyrm.settings.v1';
const settings = { beginner: true, wideView: true, mirror: true, invertY: false, mouseLock: false, assist: true, reduceMotion: false, muted: false, music: true, voice: true, gfx: 'auto', arena: 'sky', name: '', runs: 0, v: 2 };
let savedSettings = {};
try {
    savedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    Object.assign(settings, savedSettings);
    settings.beginner = true;                                            // Beginner is the only mode now
} catch { /* defaults */ }
// Wide view draws the sky six more times a frame, too much for most phones:
// touch devices start without it. Ticking the box in Settings is kept
// (wideSet), and so is an "off" saved before there was a per-device default.
if (!settings.wideSet && savedSettings.wideView !== false) settings.wideView = !input.isTouch;
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
const newGame = () => { game = { deaths: 0, kills: 0, peak: 0, time: 0, rank: 99, jade: 0, rankUp: null }; lifeBites = 0; };
let lifeBites = 0;

// Bank this life's jade into the profile (and the game's total).
function bankLife(time) {
    const res = profile.award({ peak: Math.min(T.lenCap, T.lenBase + T.lenPerMass * player.peakMass), kills: player.kills, bites: lifeBites, time, rank: player.bestRank });
    lifeBites = 0;
    if (!game) newGame();
    game.jade += res.gained;
    if (deathInfo) deathInfo.jade = res.gained;
    if (res.rankUp) {
        game.rankUp = res.rankUp;
        hud.toast(`RANK UP — ${res.rankUp.name} ${res.rankUp.zh}`, 'big');
        audio.tier();
    }
    renderProfile();
    return res;
}
// Play totals (privacy.html): when a solo life ends, one anonymous note to
// the game server with the world, peak length, seconds flown, kills and how
// it ended. No name, id or cookie. Online lives are counted by the server
// itself. Every failure (offline, an older server) is ignored.
const endCause = (e) => (e.killer ? (e.cause === 'head' ? 'headon' : 'body') : e.cause === 'the menu' ? 'quit' : 'wall');
function reportLife(cause) {
    if (online || !SERVER_BASE || !player || player.reported === player.bornAt) return;   // once per life
    player.reported = player.bornAt;
    const run = { v: 1, mode: 'solo', arena: world.arena.key, len: Math.round(lengthFor(player.peakMass)),
        secs: Math.round(world.time - player.bornAt), kills: player.kills, cause };
    try {
        fetch(SERVER_BASE + '/api/run', { method: 'POST', mode: 'cors', keepalive: true, headers: { 'content-type': 'text/plain' }, body: JSON.stringify(run) }).catch(() => {});
    } catch { /* ignore */ }
}
// An online dragon can also end without dying: you leave the room, or the
// server lost it while you were away. Its life still counts (jade and the
// game's totals) without using up one of your lives.
function endLife() {
    if (!game) newGame();
    const now = performance.now() / 1000, t = now - (player.bornWall || now);
    game.kills += player.kills;
    game.peak = Math.max(game.peak, Math.round(Math.min(T.lenCap, T.lenBase + T.lenPerMass * player.peakMass)));
    game.time += t;
    game.rank = Math.min(game.rank, player.bestRank);
    bankLife(t);
}
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
        world.player = player;
    }
    player.color = profile.skin.c1; player.color2 = profile.skin.c2;
    player.perks = [...profile.data.perks];
    player.name = settings.name;
    newGame();
    // First few runs: nearby bots leave you alone for 45 s (spec §6.8).
    world.gentleTime = settings.runs <= 3 ? 45 : 0;
    player.wallAssist = true;
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
    const hints = input.isTouch ? ['Touch the sky to steer — your dragon turns toward your finger. Lift it to fly straight',
        'Hold ⚡ to boost (burns length) · ⏪ to brake for tight turns'] : ['Move the mouse to steer — the further from centre, the harder you turn',
        'Hold click / W to boost (burns length) · right-click / S to brake for tight turns'];
    hints.push(
        'Your head on their tail = you\'re out. Their head on your tail = dinner',
        'Stay warm: the sun at the centre and crowds heat you up. Hotter dragons fly faster');
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
                    hud.toast({ shield: 'EMBER SHIELD', magnet: 'LODESTONE — reeling in food' }[e.kind] || fireToast(e.kind, e.charge)); audio.powerup(e.kind); hype(); speak(e.kind);
                    if (ELEMENT_HINT[e.kind] && !hinted.has(e.kind)) { hinted.add(e.kind); setTimeout(() => hud.toast(ELEMENT_HINT[e.kind], 'hint'), 1200); }
                }
                break;
            case 'thrustEmpty': if (mine) audio.thrustEmpty(); break;
            case 'pearl':
                renderer.pearlBurst(e.x, e.y, e.z);
                if (mine) { hud.toast(`FLAMING PEARL  +${e.gain}`, 'big'); audio.pearl(); hype(8); }
                else if (e.d.pos.distanceTo(cam.pos) < 100) hud.feed(`✨ ${e.d.name} caught a flaming pearl`);
                break;
            case 'bite':
                renderer.biteBurst(e.x, e.y, e.z, e.color);
                if (mine) { hud.toast(`CHOMP  +${e.gain}`, 'nm'); audio.bite(); hype(6); lifeBites++; }
                else if (e.o === player) { hud.toast(`${e.d.name} bit your tail`, 'bad'); audio.bitten(); }
                break;
            case 'parking': parkEndsAt = performance.now() / 1000 + e.in; break;
            case 'unparked': parkEndsAt = 0; break;
            case 'parked': showParked(); break;
            case 'land': hud.feed(`🪽 ${e.d.name} folded their wings`); break;
            case 'shieldPop': if (mine) { hud.toast('SHIELD SAVED YOU', 'nm'); audio.shieldPop(); } break;
            case 'fireStart':
                if (mine || e.d.pos.distanceTo(cam.pos) < 60) audio.breath(e.el, e.lv);
                break;
            case 'fireMiss':
                if (mine) {
                    const st = world.breathStats(player.breathLevel || 1);
                    hud.toast(`Missed — ${{ ice: 'frost', bolt: 'lightning' }[e.el] || 'dragonfire'} reaches ${Math.round(e.el === 'bolt' ? st.range * T.boltRange : st.range)} m ahead`, 'bad');
                }
                break;
            // Breath elements: frozen, zapped, melted (none of them kills).
            case 'chill':
                if (e.o === player) { hud.toast(`FROZEN by ${e.d.name} — slow for a moment`, 'bad'); audio.chilled(); }
                else if (mine) { hud.toast(`FROZE ${e.o.name}!`, 'nm'); hype(6); }
                hud.feed(`❄ ${e.d.name} froze ${e.o.name}`);
                break;
            case 'bolt':
                renderer.zap(e.pts, e.d, e.hits);
                if (mine || e.d.pos.distanceTo(cam.pos) < 80) audio.zap();
                if (e.hits.includes(player)) { hud.toast(`ZAPPED by ${e.d.name}!`, 'bad'); audio.stunned(); }
                else if (mine && e.hits.length) { hud.toast(`ZAPPED ${e.hits.length > 1 ? e.hits.length + ' DRAGONS' : e.hits[0].name}!`, 'big'); hype(8); }
                if (e.hits.length) hud.feed(`⚡ ${e.d.name} zapped ${e.hits.map((o) => o.name).join(', ')}`);
                break;
            case 'acid':
                if (e.o === player) { hud.toast('ACID! Fly out of the cloud', 'bad'); audio.sizzle(); }
                else if (mine) hud.toast(`Your acid is melting ${e.o.name}`, 'nm');
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

// Breath charges stack (rule fireCharge): say what you'll breathe and how
// many charges you hold. The first time you meet each new element, a hint
// says what it does.
const BREATH_NAME = { fire: 'DRAGONFIRE', ice: 'FROST BREATH ❄', bolt: 'LIGHTNING ⚡', acid: 'ACID SPIT' };
const ELEMENT_HINT = {
    ice: 'Frost slows every dragon in the cone: no boost, stiff turns',
    bolt: 'Lightning stuns the first dragon in line, then jumps to its neighbours',
    acid: 'Spit acid in a dragon\'s path: the cloud melts tails (never yours)',
};
const hinted = new Set();
function fireToast(kind, n) {
    const max = world.rule('fireCharge') ? world.rule('fireChargeMax') : 1, key = input.isTouch ? 'tap 🔥' : 'press E';
    const name = BREATH_NAME[kind] || BREATH_NAME.fire;
    if (!(max > 1) || !(n > 1)) return `${name} — ${key}`;
    return n >= max ? `${name} ×${n} — FULL POWER!` : `${name} ×${n} — save up or ${key}`;
}

// e.left: you chose 'Leave to menu' (solo), which ends the game.
function onPlayerDeath(e) {
    if (!e.left) { audio.death(); speak('death'); }
    if (!game) newGame();
    const at = performance.now() / 1000;
    deathInfo = {
        at,
        pos: player.pos.clone(),
        killer: e.killer,
        text: e.left ? 'You left the sky' : e.killer ? (e.cause === 'head' ? `Head-on with ${e.killer.name}` : `Poisoned by ${e.killer.name}`) : `Crashed into ${e.cause}`,
    };
    // This life's numbers roll into the game's.
    game.deaths++;
    game.kills += player.kills;
    game.peak = Math.max(game.peak, Math.round(Math.min(T.lenCap, T.lenBase + T.lenPerMass * player.peakMass)));
    game.time += online ? at - (player.bornWall || at) : world.time - player.bornAt;
    game.rank = Math.min(game.rank, player.bestRank);
    deathInfo.final = e.left || livesLeft() <= 0;
    bankLife(online ? at - (player.bornWall || at) : world.time - player.bornAt);
    reportLife(endCause(e));
    deathInfo.respawnAt = at + world.rule('respawnDelay');
    setState('dead');
    $('respawn-jade').textContent = `+${deathInfo.jade} 玉 jade`;
    if (deathInfo.final) {
        profile.gameDone();
        $('card-jade').textContent = `+${game.jade} 玉 jade this game` + (game.rankUp ? ` · Rank up: ${game.rankUp.name} ${game.rankUp.zh}` : '');
        const endless = !(livesTotal() > 0);
        $('card-title').textContent = endless ? deathInfo.text : 'Game over';
        $('card-sub').textContent = endless ? '' : deathInfo.text;
        $('card-len').textContent = game.peak + ' m';
        $('card-kills').textContent = String(game.kills);
        const t = Math.round(game.time);
        $('card-time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
        $('card-rank').textContent = game.rank < 99 ? '#' + game.rank : '—';
        if (e.left) document.body.dataset.card = '1';              // straight to the card: no crash to watch
    } else {
        $('respawn-text').textContent = deathInfo.text;
        pearls($('respawn-lives'), livesTotal(), livesLeft());
    }
}

// Next life: same game, fresh dragon at a safe spot.
function nextLife() {
    if (online) { respawnOnline(); return; }
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
let soloTune = null;            // your own tunables, kept while a room's numbers replace them
const SERVER_BASE = serverUrl();

function joinRoom(id) {
    const name = takeName();
    if (!name) return;
    audio.unlock();
    if (online) leaveOnline();
    setLobbyStatus('Joining…');
    soloTune = { ...T };
    online = new NetGame(SERVER_BASE, id, name, { perks: profile.data.perks, skin: profile.data.skin }, {
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
            syncServer();                                   // the room's numbers, read-only
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
        // The connection dropped mid-game. With a dragon to keep, reconnect
        // at once: the server holds it for us. While dead, wait for the next
        // life (respawnOnline wakes it).
        onDrop() {
            lifeAtDrop = !!(player && (player.alive || online.parked));
            if (lifeAtDrop) setNet('reconnecting');
            return lifeAtDrop;
        },
        // Back in the same room, the world rebuilt from the new welcome.
        onRejoin(w, p, info) {
            const lost = !info.resumed;                   // a new dragon: the server restarted or forgot ours
            if (lost && lifeAtDrop) endLife();
            world = w; player = p;
            w.assist = settings.assist;
            renderer.clearHeads();
            renderer.buildArena(w.arena);
            view.player = p;
            cam.snap(p);
            input.zero();
            syncServer();                                   // the room's numbers again (maybe a new server's)
            setNet('');
            if (lost) {
                p.bornWall = performance.now() / 1000; p.peakMass = p.mass; p.kills = 0; p.bestRank = 99; lifeBites = 0;
                if (lifeAtDrop) hud.toast(info.restarted ? 'Server updated — new life' : 'Reconnected — new life', 'hint');
            }
            lifeAtDrop = false;
            // Tell the room what we're doing now: flying, or wings folded.
            if (state === 'dead') { setState('play'); input.requestLock(); }    // this is the next life
            else if (state === 'pause' && online.parked) showParked();
            else if (state === 'pause') online.park();
            else online.unpark();
        },
        onClose(reason) {
            const wasIn = !!online;
            leaveOnline();
            if (wasIn) { setState('menu'); setLobbyStatus(reason); }
        },
    });
    tune.lock(true);
    syncServer();
}

// Online, the server respawns you (onRespawn → play). If the connection
// dropped while you were dead, reconnecting is the respawn (onRejoin).
function respawnOnline() {
    if (online.dormant) { setNet('reconnecting'); online.wake(); }
    else online.respawn();
}

let lifeAtDrop = false;         // a reconnect began with a dragon (flying or folded) to keep
const setNet = (s) => { if (s) document.body.dataset.net = s; else delete document.body.dataset.net; };

function leaveOnline() {
    const g = online;
    online = null;
    if (g) {
        g.close();
        // Leaving a room (or losing it for good) ends the dragon you had
        // there: bank its life, as a death would.
        if (g.player && g.player === player && (player.alive || g.parked)) endLife();
    }
    setNet('');
    // Back to your own tunables and a local world for the menu / solo.
    Object.assign(T, soloTune || DEFAULTS);
    soloTune = null;
    tune.lock(false);
    syncServer();
    newWorld();
}

function setLobbyStatus(text) { $('lobby-status').textContent = text || ''; }

// Rows are kept and updated in place, keyed by room id: a refresh only
// changes their text, so a tap on Join can't land on a button it replaced.
const roomRows = new Map();     // room id → { row, nm, meta, count, btn }
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
function renderRooms(rooms) {
    const list = $('room-list');
    rooms = rooms.slice().sort((a, b) => (b.beginner - a.beginner) || (b.permanent - a.permanent) || (b.humans - a.humans) || a.name.localeCompare(b.name));
    const ids = new Set(rooms.map((r) => r.id));
    for (const [id, el] of roomRows) if (!ids.has(id)) { el.row.remove(); roomRows.delete(id); }
    rooms.forEach((r, i) => {
        let el = roomRows.get(r.id);
        if (!el) {
            el = { row: document.createElement('div'), nm: document.createElement('div'), meta: document.createElement('div'),
                count: document.createElement('div'), btn: document.createElement('button') };
            el.row.className = 'room'; el.nm.className = 'rn'; el.meta.className = 'rm'; el.count.className = 'rc';
            const info = document.createElement('div');
            info.append(el.nm, el.meta);
            el.btn.onclick = () => joinRoom(r.id);
            el.row.append(info, el.count, el.btn);
            roomRows.set(r.id, el);
        }
        setText(el.nm, r.name);
        // The world, unless the room is already named after it ("Skyhold").
        const [worldName, physics] = r.arena === 'orb' ? ['The Orb', 'zero-G'] : ['Skyhold', 'gravity'];
        const named = r.name.trim().toLowerCase() === worldName.toLowerCase();
        setText(el.meta, (named ? physics : `${worldName} · ${physics}`) + (r.permanent ? ' · always on' : ''));
        setText(el.count, `👤 ${r.humans} · 🐉 ${r.bots}`);
        el.count.title = `${r.humans} player${r.humans === 1 ? '' : 's'} and ${r.bots} bots`;
        setText(el.btn, r.humans >= r.max ? 'Full' : 'Join');
        el.btn.disabled = r.humans >= r.max;
        if (list.children[i] !== el.row) list.insertBefore(el.row, list.children[i] || null);
    });
}

// The lobby asks for the room list every 10 s, but only while you can see
// it (the menu, no overlay, a visible tab), and at once when it comes into
// view. Every request keeps the one Cloud Run server awake, so a hidden tab
// or a game in progress asks for nothing.
const LOBBY_POLL = 10;
let lobbyBusy = false, lobbyShown = false, lobbyT = 0;
function lobbyTick(now) {
    const shown = state === 'menu' && !overlay && !document.hidden;
    if (shown && (!lobbyShown || now - lobbyT >= LOBBY_POLL)) { lobbyT = now; refreshLobby(); }
    lobbyShown = shown;
}
document.addEventListener('visibilitychange', () => lobbyTick(performance.now() / 1000));

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

// Server names come from a list (names.js) instead of being typed, so
// nothing a player writes shows in everyone's lobby. 🎲 picks another.
const rollRoomName = () => { $('create-name').textContent = randomRoomName(); };
$('create-open').onclick = () => { rollRoomName(); $('create-form').hidden = false; $('create-open').hidden = true; };
$('create-reroll').onclick = rollRoomName;
$('create-cancel').onclick = () => { $('create-form').hidden = true; $('create-open').hidden = false; $('create-error').textContent = ''; };
$('create-form').onsubmit = async (ev) => {
    ev.preventDefault();
    if (!takeName()) return;
    $('create-error').textContent = '';
    try {
        const arena = (document.querySelector('input[name=create-arena]:checked') || {}).value === 'orb' ? 'orb' : 'sky';
        const room = await createRoom(SERVER_BASE, { name: $('create-name').textContent, arena, beginner: true });
        $('create-form').hidden = true; $('create-open').hidden = false;
        joinRoom(room.id);
    } catch (e) {
        $('create-error').textContent = e.message;
        rollRoomName();                     // an older server refuses a name already in use: offer another
    }
};

// ------------------------------------------------ UI wiring
$('name').value = settings.name || randomName();
$('play').onclick = () => startPlay();
$('again').onclick = () => playAgain();
$('menu-btn').onclick = () => { if (online) leaveOnline(); setState('menu'); };
$('resume').onclick = () => resume();

// Touch devices: on-screen buttons, and a flag the CSS keys off.
const touchMode = () => { document.body.dataset.touch = '1'; };
if (input.isTouch) touchMode();
input.onTouchMode = touchMode;
input.holdButton($('t-boost'), 'boost');
input.holdButton($('t-brake'), 'brake');
input.holdButton($('t-fire'), 'fire');
$('t-pause').addEventListener('pointerdown', (e) => { e.preventDefault(); pause(); });
$('quit').onclick = () => {
    if (online) leaveOnline();
    else if (player && player.alive) {
        // Leaving ends the game, and the life is banked like any death: the
        // run card shows the game's jade, and its Menu button goes on. (The
        // death event from kill() here, outside step(), is cleared unseen.)
        world.kill(player, null, 'the menu');
        onPlayerDeath({ killer: null, cause: 'the menu', left: true });
        return;
    }
    setState('menu');
};

// Pause. Solo freezes the world. A room can't stop, so online Esc folds
// your wings: after a 3 s countdown (still flying) your dragon leaves the
// sky with its length kept, and Resume brings it back at a safe spot.
let pausedAt = 0, parkEndsAt = 0;
function setPauseNote(t) { $('pause-note').textContent = t; }
function showParked() { parkEndsAt = 0; $('pause-title').textContent = 'Wings folded'; setPauseNote('You\'re out of the sky and safe. Your length is kept.'); }
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
// Switching tabs or locking the phone: solo pauses, and online folds your
// wings just like Esc (the room can't stop, so the 3 s countdown still
// applies). Coming back shows the pause screen; you tap to fly again.
document.addEventListener('visibilitychange', () => {
    audio.setHidden(document.hidden);
    if (document.hidden) pause();
});
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
    if (online) { newGame(); respawnOnline(); return; }
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
// Beginner is the only mode: walls and the cloud sea steer you clear (no
// dying on walls you can't see) and bots stay gentler, solo and online.
function beginnerRules() { if (online) return; world.rules.botAggrMax = 0.5; }
// Mute: the speaker button, M and Settings → Mute all sound stay in step.
function setMuted(m, flash) {
    settings.muted = m;
    saveSettings();
    audio.setMuted(m);
    $('opt-mute').checked = m;
    hud.setMuted(m, flash);
}
bindCheck('opt-mute', 'muted', () => setMuted(settings.muted));
$('mute-btn').onclick = (e) => { setMuted(!settings.muted, true); e.currentTarget.blur(); };   // so Space/Enter go to the game
bindCheck('opt-music', 'music', () => audio.setMusic(settings.music));
bindCheck('opt-voice', 'voice', () => audio.setVoice(settings.voice));
// Graphics: Auto starts high and steps down once if play runs well below
// what the screen can show, and remembers that for next time (autoLow).
// Picking any option in Settings starts over.
const gfxQuality = () => (settings.gfx === 'low' || (settings.gfx === 'auto' && settings.autoLow) ? 'low' : 'high');
const showGfx = () => { $('opt-gfx').value = settings.gfx; $('opt-gfx').options[0].textContent = settings.autoLow ? 'Auto (now Low)' : 'Auto'; };
showGfx();
$('opt-gfx').onchange = () => { settings.gfx = $('opt-gfx').value; settings.autoLow = false; saveSettings(); showGfx(); gfxAuto.t = 0; gfxAuto.n = 0; renderer.setQuality(gfxQuality()); };
renderer.setQuality(gfxQuality());
// The screen's own frame rate comes from the median gap between the first
// frames (menu frames are light): 60 on most screens, but 30 on a phone in
// Low Power Mode, where 30 fps is as good as it gets and no reason to drop.
const gfxAuto = { t: 0, n: 0, gaps: [], cap: 0 };
function measureScreen(gapMs) {
    if (gfxAuto.cap) return;
    gfxAuto.gaps.push(gapMs);
    if (gfxAuto.gaps.length < 90) return;
    const g = gfxAuto.gaps.slice(15).sort((a, b) => a - b);   // skip the first frames (shaders compiling)
    gfxAuto.cap = 1000 / Math.max(1, g[g.length >> 1]);
}
function autoGraphics() {
    if (settings.gfx !== 'auto' || renderer.quality === 'low' || state !== 'play') { gfxAuto.t = 0; return; }
    const now = performance.now() / 1000;             // wall clock: frame dt is capped
    if (!gfxAuto.t) { gfxAuto.t = now; gfxAuto.n = 0; return; }
    gfxAuto.n++;
    if (now - gfxAuto.t < 5) return;
    const fps = gfxAuto.n / (now - gfxAuto.t);
    gfxAuto.t = 0;
    // Below 40 fps, or below ¾ of a slower screen's own rate.
    if (fps < Math.min(40, 0.75 * (gfxAuto.cap || 60))) {
        renderer.setQuality('low');
        settings.autoLow = true; saveSettings(); showGfx();
        hud.toast('Graphics set to Low for smoother flying', 'hint');
    }
}
bindCheck('opt-invert', 'invertY', () => (input.settings.invertY = settings.invertY));
bindCheck('opt-lock', 'mouseLock', () => (input.settings.mouseLock = settings.mouseLock));
bindCheck('opt-assist', 'assist', () => world && (world.assist = settings.assist));
bindCheck('opt-motion', 'reduceMotion', () => (cam.reduceMotion = settings.reduceMotion));
input.settings.invertY = settings.invertY;
input.settings.mouseLock = settings.mouseLock;
cam.reduceMotion = settings.reduceMotion;
audio.muted = settings.muted;
hud.setMuted(settings.muted);
audio.musicOn = settings.music;
audio.voiceOn = settings.voice;

// The dragon speaks: a Mandarin shout, captioned with pinyin and English
// in the message stack.
function speak(ev) {
    const ph = audio.say(ev);
    if (ph) hud.caption(ph);
}
// Browsers only allow sound after a gesture: the first click or key starts
// the menu music, and later ones wake it if the phone stopped it (iOS
// 'interrupts' it after a call or an app switch).
const gesture = () => audio.unlock();
addEventListener('pointerdown', gesture);
addEventListener('keydown', gesture);

// Settings / Controls overlays, reachable from the main menu and pause.
let overlay = '';
function openOverlay(name) { overlay = name; document.body.dataset.overlay = name; }
function closeOverlay() { overlay = ''; delete document.body.dataset.overlay; }
for (const b of document.querySelectorAll('.open-settings')) b.onclick = () => openOverlay('settings');
for (const b of document.querySelectorAll('.open-controls')) b.onclick = () => openOverlay('controls');
for (const b of document.querySelectorAll('.close-overlay')) b.onclick = () => closeOverlay();
$('open-dojo').onclick = () => { renderDojo(); openOverlay('dojo'); };
// On a short screen the menu and the Settings and Controls lists scroll.
// While there's more below, data-more is set: the menu shows "more ▾" at
// its foot and the lists fade out.
function scrollHint(el) {
    const mark = () => el.toggleAttribute('data-more', el.scrollHeight - el.scrollTop - el.clientHeight > 6);
    el.addEventListener('scroll', mark, { passive: true });
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => requestAnimationFrame(mark)); ro.observe(el); for (const c of el.children) ro.observe(c); }
}
for (const el of [$('menu'), ...document.querySelectorAll('#settings .tab-body, #controls .keys')]) scrollHint(el);

// Profile strip (start menu) and the Perks & colours panel.
function renderProfile() {
    const r = profile.rank;
    $('rank-seal').textContent = r.zh;
    $('rank-name').textContent = `${r.name} · rank ${r.level}`;
    $('rank-jade').textContent = `${profile.data.jade.toLocaleString()} 玉` + (r.next ? ` / ${r.next.jade.toLocaleString()}` : '');
    $('rank-perks').textContent = profile.data.perks.map((p) => PERKS[p].icon).join(' ');
    $('rank-bar').style.width = Math.round(r.progress * 100) + '%';
}
function renderDojo() {
    const lv = profile.rank.level, slots = perkSlots(lv);
    $('dojo-note').textContent = slots ? `Rank ${lv}: equip ${slots === 1 ? 'one perk' : 'two perks'}. Perks carry into every game.` : 'Earn 300 jade (玉) to reach rank 2 and unlock your first perk.';
    const box = $('dojo-perks');
    box.textContent = '';
    for (const [id, p] of Object.entries(PERKS)) {
        const row = document.createElement('div');
        const locked = p.level > lv, on = profile.data.perks.includes(id);
        row.className = 'perk' + (on ? ' on' : '') + (locked ? ' locked' : '');
        const icon = document.createElement('div'); icon.className = 'pi'; icon.textContent = p.icon;
        const text = document.createElement('div'); text.className = 'pt'; text.textContent = `${p.name} ${p.zh}`;
        const small = document.createElement('small'); small.textContent = p.desc; text.appendChild(small);
        const tag = document.createElement('div'); tag.className = 'tag'; tag.textContent = locked ? `rank ${p.level}` : on ? 'equipped' : '';
        row.append(icon, text, tag);
        if (!locked) row.onclick = () => { profile.togglePerk(id); renderDojo(); renderProfile(); };
        box.appendChild(row);
    }
    const sk = $('dojo-skins');
    sk.textContent = '';
    for (const s of SKINS) {
        const b = document.createElement('button');
        b.className = 'swatch' + (profile.data.skin === s.id ? ' on' : '');
        const i = document.createElement('i');
        i.style.background = `linear-gradient(135deg, #${s.c1.toString(16).padStart(6, '0')} 55%, #${s.c2.toString(16).padStart(6, '0')} 55%)`;
        b.append(i, document.createTextNode(s.level > lv ? `rank ${s.level}` : s.name));
        b.disabled = s.level > lv;
        b.onclick = () => { profile.setSkin(s.id); renderDojo(); };
        sk.appendChild(b);
    }
}
renderProfile();

// Settings tabs: Server (room rules) vs Player (personal).
for (const b of document.querySelectorAll('#settings .tab')) b.onclick = () => ($('settings').dataset.tab = b.dataset.tab);
bindCheck('opt-wide', 'wideView', () => { settings.wideSet = true; saveSettings(); renderer.view.wide = settings.wideView; });
bindCheck('opt-mirror', 'mirror', () => (renderer.view.mirror = settings.mirror));
renderer.view.wide = settings.wideView;
renderer.view.mirror = settings.mirror;

// Online the panel closes and stays shut (the room's numbers rule), so
// 'Restart world' and 'Reset all' never touch a room.
const tune = new TunePanel(() => { if (online) return; newWorld(); setState('menu'); syncServer(); });
if (DEV) $('tune-btn').onclick = () => tune.toggle();

// Server sliders edit the same tunables as the dev panel, for solo games and
// this visit only (never saved). Online they show the room's values, read-only.
const SERVER = [['srv-start', 'popStart', (v) => String(v)], ['srv-max', 'popMax', (v) => String(v)], ['srv-every', 'popRampSec', (v) => v + ' s']];
function syncServer() {
    for (const [id, key, fmt] of SERVER) { $(id).value = T[key]; $(id + '-v').textContent = fmt(T[key]); $(id).disabled = !!online; }
}
for (const [id, key] of SERVER) {
    $(id).oninput = () => {
        if (online) { syncServer(); return; }
        T[key] = +$(id).value;
        if (key === 'popStart' && T.popStart > T.popMax) T.popMax = T.popStart;
        if (key === 'popMax' && T.popMax < T.popStart) T.popStart = T.popMax;
        syncServer(); tune.sync();
    };
}
syncServer();

// Enter on a focused button, link or other control is that control's own
// click, so it mustn't also start a game or close a screen. (Space can't
// click one: Input cancels it for boosting.)
const onControl = (e) => !!(e && e.target && e.target.closest && e.target.closest('button, a[href], input, select, textarea, summary, [tabindex], [contenteditable]'));
input.onKey = (code, e) => {
    if (code === 'Backquote') { if (DEV) tune.toggle(); }
    else if (code === 'KeyM' && !(e.ctrlKey || e.metaKey || e.altKey)) setMuted(!settings.muted, true);
    else if (code === 'KeyN') { settings.music = !settings.music; audio.setMusic(settings.music); $('opt-music').checked = settings.music; saveSettings(); hud.toast(settings.music ? '♪ Music on' : 'Music off', 'hint'); }
    else if (overlay && (code === 'Escape' || (code === 'Enter' && !onControl(e)))) closeOverlay();
    else if (overlay) return;
    else if ((code === 'KeyE' || code === 'KeyF') && state === 'play' && player && player.alive && !player.fire && !(player.breath > 0)) {
        hud.toast(world.rule('elements') ? 'Nothing to breathe — grab a fire, ice, lightning or acid crystal' : 'No dragonfire — grab a red crystal first', 'hint');
    }
    else if (code === 'Escape' || code === 'KeyP') {
        if (state === 'play') pause();
        // Leaving pointer lock with Esc can deliver both the lock change and
        // the key; ignore a second Esc that arrives right after pausing.
        else if (state === 'pause' && performance.now() - pausedAt > 400) resume();
    } else if ((code === 'Space' || (code === 'Enter' && !onControl(e))) && state === 'dead' && deathInfo.final && performance.now() / 1000 - deathInfo.at > 0.9) playAgain();
    else if (code === 'Enter' && state === 'menu' && !onControl(e)) startPlay();
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

// Crash guard: a frame that throws is logged and skipped, not repeated
// forever into a frozen screen; the problem is kept on this device so it
// can be reported (Settings → Player shows the last one).
const CRASH_KEY = 'wyrm.crash.v1';
let lastProblemToast = -1e9;
function noteProblem(kind, err, quiet = false) {
    const msg = String((err && (err.stack || err.message)) || err).slice(0, 800);
    console.error('wyrm', kind, err);
    try {
        localStorage.setItem(CRASH_KEY, JSON.stringify({ kind, msg, at: new Date().toISOString(), state, online: !!online,
            ua: navigator.userAgent.slice(0, 160) }));
    } catch { /* storage blocked */ }
    showLastProblem();
    const t = performance.now();
    if (!quiet && t - lastProblemToast > 10000) { lastProblemToast = t; hud.toast('Something went wrong; still flying', 'bad'); }
}
function showLastProblem() {
    const el = $('last-problem');
    if (!el) return;
    let p = null;
    try { p = JSON.parse(localStorage.getItem(CRASH_KEY) || 'null'); } catch { /* ignore */ }
    el.hidden = !p;
    if (!p) return;
    el.querySelector('.when').textContent = new Date(p.at).toLocaleString();
    el.querySelector('pre').textContent = `${p.kind} · ${p.state}${p.online ? ' · online' : ''}\n${p.msg}\n${p.ua}`;
}
window.addEventListener('error', (e) => noteProblem('error', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => noteProblem('promise', e.reason));
// If the phone takes the GPU away (memory pressure), ask for it back and
// carry on at Low quality instead of letting the page die. A loss that comes
// back within a few seconds is only noted (Settings → Player), not toasted.
let gpuLostTimer = 0;
canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    clearTimeout(gpuLostTimer);
    gpuLostTimer = setTimeout(() => noteProblem('gpu', 'WebGL context lost'), 5000);
});
canvas.addEventListener('webglcontextrestored', () => {
    clearTimeout(gpuLostTimer);
    noteProblem('gpu', 'WebGL context lost, then restored', true);
    renderer.restore();
    renderer.quality = null; renderer.setQuality('low');
    hud.toast('Graphics recovered (Low quality)', 'nm');
});
$('last-problem-copy').onclick = () => { try { navigator.clipboard.writeText($('last-problem').querySelector('pre').textContent); } catch { /* ignore */ } };
$('last-problem-clear').onclick = () => { try { localStorage.removeItem(CRASH_KEY); } catch { /* ignore */ } showLastProblem(); };
showLastProblem();

function frame(nowMs) {
    requestAnimationFrame(frame);
    try { tick(nowMs); } catch (err) { noteProblem('frame', err); }
}

function tick(nowMs) {
    const now = nowMs / 1000;
    measureScreen(nowMs - last);
    let dt = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    fpsN++; fpsT += dt;
    if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }

    if (online && online.reconnecting) {
        // The connection dropped: the picture holds still until it's back.
    } else if (online && online.world) {
        // In a room: fly yourself locally, everything else from the server
        // (a room never pauses — Esc only opens the menu).
        const t0 = performance.now();
        if (player && player.alive && state === 'play') input.read(player.input);
        else if (player) { const i = player.input; i.sx = i.sy = i.roll = 0; i.boost = i.brake = i.fire = false; }
        if (player && online.room) player.wallAssist = true;              // every room steers you clear of walls
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
    lobbyTick(now);

    // Population ramp: announce each new arrival (solo).
    if (!online && player && player.alive && state === 'play') {
        const tb = targetBots(world);
        if (tb > lastTarget) hud.feed(`🐉 A new dragon arrives — ${tb} others now`);
        lastTarget = tb;
    }

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
    const fireUp = player && player.alive && (player.fire || player.breath > 0) ? '1' : '';
    if (document.body.dataset.fire !== fireUp) document.body.dataset.fire = fireUp;

    // Soundtrack: calm in menus, driving while you fly, full band in the action.
    let level = 0;
    if (state === 'play' && player && player.alive) {
        const rank = view.board.indexOf(player) + 1;
        if (player.boosting || player.breath > 0 || player.fire || (rank > 0 && rank <= 3)) hype(4);
        level = now < actionUntil ? 2 : 1;
    }
    audio.mood(level, state === 'pause');
    audio.hum(state === 'play' && !!player && player.alive && player.magnet > 0);
    if (state === 'pause' && online && online.reconnecting) setPauseNote('Reconnecting…');
    else if (state === 'pause' && online && parkEndsAt) {
        const left = Math.max(0, Math.ceil(parkEndsAt - now));
        setPauseNote(left > 0 ? `Leaving the sky in ${left}… you keep flying (and can still be hit) until then.` : 'Folding…');
    }

    autoGraphics();
    renderer.update(world, view, dt, now);
    hud.draw(world, view, renderer, input, now);
    hud.updateStats(world, view, now, DEV ? fps : 0);
    tune.update(world, renderer, simMs, fps);
}
requestAnimationFrame(frame);

// Test hook for the headless smoke test.
window.__wyrm = { get world() { return world; }, get state() { return state; }, startPlay, joinRoom, get player() { return player; }, get online() { return online; }, audio, renderer };
