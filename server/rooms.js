// Rooms: the four permanent servers + player-created ones. Each room runs
// the shared sim (mode 'server') while anyone is in it: bots, collisions,
// orbs, deaths, heat and thrust are decided here; browsers report only
// their own dragon's pose, which the sim speed-checks (see sim.applyNet).
import { randomBytes } from 'node:crypto';
import { World, Dragon, T, lengthFor, managePopulation, safePlayerName, cleanPerks, skinById, isRoomName, randomRoomName,
    ROOM_ADJECTIVES, ROOM_NOUNS } from '../site/js/shared.js';

// Beginner is shown as a badge, never in a name. Beginner rooms list first.
// Each world also has an always-on Fight mode server (rule fight), named so
// the lobby's name order puts it just after its classic one.
export const DEFAULT_ROOMS = [
    { id: 'the-orb', name: 'The Orb', arena: 'orb', beginner: true },
    { id: 'skyhold', name: 'Skyhold', arena: 'sky', beginner: true },
    { id: 'skyhold-fight', name: 'Skyhold Fight', arena: 'sky', beginner: true, rules: { fight: 1 } },
    { id: 'the-orb-fight', name: 'The Orb Fight', arena: 'orb', beginner: true, rules: { fight: 1 } },
];
// Names no created room may read as. Created rooms get list names (see
// names.js), and the names test checks every one passes checkName with these.
export const RESERVED_ROOM_NAMES = DEFAULT_ROOMS.map((r) => r.name).concat(['Skyhold Nest', 'Skyhold (Beginners)', 'Skyhold Beginners', 'Nest', 'Orb']);

export const LIMITS = {
    humansPerRoom: 30,
    userRooms: 30,               // user-created rooms alive at once
    roomsPerIpPerHour: 3,
    emptyTtlMs: 12 * 3600 * 1000,
    worldIdleMs: 10 * 60 * 1000, // free a room's world after 10 min empty
};

// Rule overrides for beginner rooms (see World.rule): gentler bots.
const BEGINNER_RULES = { botAggrMax: 0.5 };

// The rules a player may pick for a server they create (POST /api/rooms
// `rules`, kept in the room's meta.rules and saved with it): only fight
// mode, as the number 0 or 1. Anything else is ignored. Returns null when
// there's nothing to keep.
export function cleanRoomRules(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw.fight === 0 || raw.fight === 1 ? { fight: raw.fight } : null;
}

// A page from before fight mode doesn't know its rules (harmless bodies,
// bites anywhere, bouncing heads, Poison Skin), so it is kept out of a
// fight room: join refuses it with this, which such a page shows in its
// lobby (server.js sends it as a 'full' error and closes with 4003).
export const FIGHT_UPDATE = 'This server plays Fight mode. Reload the page to update Skywyrm, then join.';

const TICK = 1 / 30;
const SNAP_EVERY = 2;            // 15 snapshots/s
const PARK_DELAY = 3;            // s of flight (still vulnerable) before folded wings take effect
const PARK_MIN = 2;              // s parked before you can fly back in
const HOLD_SECS = 30;            // s a dropped player's folded dragon waits for them to reconnect
const MAX_UNSENT_ORBS = 20000;   // food changes kept for a client skipping snapshots
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

function newId() {
    return randomBytes(9).toString('base64url');   // 12 chars, ~72 bits, unguessable
}

// A random list name no room is using (the room cap keeps plenty free).
function freeRoomName(taken) {
    for (let k = 0; k < 50; k++) { const n = randomRoomName(); if (!taken.has(n)) return n; }
    const all = ROOM_ADJECTIVES.flatMap((a) => ROOM_NOUNS.map((n) => `${a} ${n}`)).filter((n) => !taken.has(n));
    return all[Math.floor(Math.random() * all.length)];
}

// Resume tokens: random, in memory only, new on every welcome.
function newToken() {
    return randomBytes(16).toString('base64url');  // 22 chars, 128 bits
}

// Flags packed into one number per dragon in snapshots (older clients
// ignore the bits they don't know: 512 chilled, 1024 stunned, 2048 just
// bitten and 4096 Poison Skin in fight mode).
function flags(d) {
    return (d.alive ? 1 : 0) | (d.boosting ? 2 : 0) | (d.braking ? 4 : 0) | (d.protect > 0 ? 8 : 0)
        | (d.shield > 0 ? 16 : 0) | (d.breath > 0 ? 32 : 0) | (d.human ? 64 : 0) | (d.isBot ? 128 : 0)
        | (d.magnet > 0 ? 256 : 0) | (d.chill > 0 ? 512 : 0) | (d.stun > 0 ? 1024 : 0) | (d.guard > 0 ? 2048 : 0) | (d.poison > 0 ? 4096 : 0);
}

// Browsers list what they understand in hello's `caps`. One without 'el'
// predates breath elements: it is shown ice, lightning and acid crystals
// as fire ones (its renderer knows no others), and its dragon always
// breathes fire (World: d.fireOnly). One without 'fight' predates fight
// mode and is kept out of fight rooms (FIGHT_UPDATE); should it meet a
// Poison Skin crystal anyway, it isn't told of it (its renderer would draw
// a shield, and its pick-up message would say dragonfire).
const OLD_KIND = { ice: 'fire', bolt: 'fire', acid: 'fire' };
const forOld = (e) => (e.k === 'pu' && OLD_KIND[e.kind] ? { ...e, kind: 'fire' } : e);
const cleanCaps = (list) => (Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s.length <= 16).slice(0, 8) : []);
// A browser's own events, in words it knows.
const eventsFor = (c, ev) => {
    if (!c.el) ev = ev.map(forOld);
    return c.fight ? ev : ev.filter((e) => !(e.k === 'pu' && e.kind === 'poison'));
};

function pathOf(d) {
    // Oldest → newest, every other point (1 m apart), 1 cm precision.
    const out = [];
    const n = d.pathCount;
    for (let k = n - 1; k >= 0; k -= 2) {
        const i = ((d.pathHead - k + 1200) % 1200) * 3;
        out.push(r2(d.path[i]), r2(d.path[i + 1]), r2(d.path[i + 2]));
    }
    return out;
}

function dragonMeta(d) {
    return {
        id: d.id, name: d.name, c1: d.color, c2: d.color2, bot: d.isBot, human: d.human, mood: d.mood || '',
        s: stateOf(d), path: pathOf(d),
    };
}

// How a life ended, in stats.js's words. No killer means the arena's edge
// (storm wall, glass shell or cloud sea).
const endCause = (e) => (e.killer ? (e.cause === 'head' ? 'headon' : 'body') : 'wall');

function stateOf(d) {
    return [d.id, r2(d.pos.x), r2(d.pos.y), r2(d.pos.z), r3(d.quat.x), r3(d.quat.y), r3(d.quat.z), r3(d.quat.w),
        Math.round(d.mass * 10) / 10, r2(d.len), flags(d), r2(d.bank), r2(d.speed)];
}

export class Room {
    constructor(meta, registry) {
        this.meta = meta;            // { id, name, arena, beginner, permanent, createdAt, expireAt }
        this.registry = registry;
        this.clients = new Set();    // Client objects (see client.js)
        this.held = new Map();       // resume token → seat of a player whose socket closed (see leave)
        this.world = null;
        this.activeSince = 0;
        this.emptySince = Date.now();
        this.tickCount = 0;
    }

    // Held seats count: the room keeps running, and keeps their place, for
    // a player who is reconnecting.
    get humans() { return this.clients.size + this.held.size; }

    // Fight mode (rule fight): what the room was created with, else the
    // server's own value (WYRM_TUNE can set it for every room).
    get fight() {
        const r = this.meta.rules;
        return (r && r.fight !== undefined ? r.fight : T.fight) > 0;
    }

    summary() {
        const bots = this.world ? this.world.dragons.filter((d) => d.isBot && d.alive).length : 0;
        return { id: this.meta.id, name: this.meta.name, arena: this.meta.arena, beginner: !!this.meta.beginner,
            permanent: !!this.meta.permanent, fight: this.fight, humans: this.humans, bots, max: LIMITS.humansPerRoom };
    }

    ensureWorld() {
        if (this.world) return;
        const w = new World(this.meta.arena, 'server');
        w.gentleTime = 0;
        w.rules = { ...(this.meta.beginner ? BEGINNER_RULES : {}), ...(this.meta.rules || {}) };   // per-room overrides of rule tunables
        w.botTarget = () => this.botTarget();
        w.spawnAmbient(T.orbTarget);
        this.world = w;
        this.activeSince = 0;
        managePopulation(w, true);
        for (let i = 0; i < 10 * 30; i++) { w.step(TICK); managePopulation(w); }   // warm up
        w.orbLog.length = 0;
        this.activeSince = w.ageStart = w.time;             // bots grow bolder as the room ages
    }

    // Bots fill the room like solo play: popStart bots when it wakes, +1
    // every popRampSec, until humans + bots reach popMax.
    botTarget() {
        const t = this.world.time - this.activeSince;
        const ramp = T.popStart + Math.floor(Math.max(0, t) / T.popRampSec);
        return Math.max(0, Math.min(ramp, T.popMax - this.humans));
    }

    // A hello. `extras.resume` is the token from an earlier welcome: if it
    // matches a seat held here (see leave), the player gets that dragon,
    // and the life it's on, back instead of a fresh one.
    join(client, rawName, extras = {}) {
        const caps = cleanCaps(extras.caps);
        if (this.fight && !caps.includes('fight')) return { error: FIGHT_UPDATE };
        const seat = this.seatFor(extras.resume);
        if (!seat && this.humans >= LIMITS.humansPerRoom) return { error: 'This server is full' };
        const wasEmpty = this.humans === 0;
        this.ensureWorld();
        if (wasEmpty) {
            this.activeSince = this.world.ageStart = this.world.time;
            this.registry.occupied(this);
        }
        const w = this.world;
        let d = seat ? this.takeSeat(seat, client) : null;
        const resumed = !!d;
        if (!d) {
            d = new Dragon(safePlayerName(rawName), false);
            d.human = true; d.remote = true;
            // Profile extras from the browser, re-checked here: known perk ids
            // (at most two; the room's `perks` rule decides if they apply) and a
            // known colour scheme.
            d.perks = cleanPerks(extras.perks);
            const skin = skinById(extras.skin);
            if (skin) { d.color = skin.c1; d.color2 = skin.c2; }
            w.spawn(d, T.spawnMass);
        }
        // What this browser understands (every hello, a resume's too): a
        // resumed dragon keeps its element and charges.
        client.el = caps.includes('el');
        client.fight = caps.includes('fight');
        d.fireOnly = !client.el;
        client.dragon = d;
        client.room = this;
        client.token = newToken();
        this.clients.add(client);
        if (!resumed) this.startLife(client);                  // a resumed life carries on (takeSeat)
        this.registry.countHumans();
        const orbs = [];
        for (let i = 0; i < w.oHigh; i++) {
            if (w.oalive[i]) orbs.push(i, r2(w.ox[i]), r2(w.oy[i]), r2(w.oz[i]), r2(w.oval[i]), w.ocol[i], Math.round(w.ottl[i]));
        }
        client.send({
            t: 'welcome', you: d.id, resume: client.token, ...(resumed ? { resumed: 1 } : {}), ...(client.parked ? { parked: 1 } : {}),
            room: { id: this.meta.id, name: this.meta.name, arena: this.meta.arena, beginner: !!this.meta.beginner },
            tune: { ...T }, rules: w.rules, time: r2(w.time),
            dragons: w.dragons.filter((x) => x.alive || x.human).map(dragonMeta),
            orbs, pu: this.powerups(client), pl: this.pearls(),
        });
        if (!resumed || seat.back) this.broadcast({ t: 'dn', d: dragonMeta(d) }, client);
        if (client.parkAt) client.send({ t: 'e', ev: [{ k: 'parking', in: r2(client.parkAt - w.time) }] });   // still folding its wings
        return { ok: true };
    }

    // A socket closed. cause: 'quit' (the browser closed it) or
    // 'disconnect', for the play totals. A dragon in the sky stays there,
    // still hittable, for the fold-wings countdown (PARK_DELAY s):
    // disconnecting never dodges a kill. Then:
    //  - Not coming back (left on purpose or sent away; hold false): the
    //    life is counted now, and the dragon drops its loot and goes, as a
    //    leave always did.
    //  - hold (a dropped connection: a network blip, Cloud Run's hourly cut,
    //    a phone asleep): the dragon folds its wings and its seat, with the
    //    life it's on, is held under the player's resume token for HOLD_SECS
    //    (see holding, takeSeat). That life is counted only if the dragon
    //    dies meanwhile or the seat is forgotten.
    leave(client, cause = 'quit', { hold = false } = {}) {
        if (!this.clients.delete(client)) return;
        if (!hold) this.endLife(client, cause);
        const d = client.dragon, w = this.world;
        if (d && w) {
            // A held seat looks like a client to endLife: { dragon, life, parked }.
            const seat = { dragon: d, life: client.life, cause, going: !hold, parked: null, ip: client.ip };
            if (d.alive && !client.parked) {
                d.input.boost = d.input.brake = d.input.fire = false; d.net = null;
                this.held.set(client.token, { ...seat, grace: true, parkAt: client.parkAt, until: client.parkAt || w.time + PARK_DELAY });
            } else if (client.parked && hold) {
                this.held.set(client.token, { ...seat, grace: false, byChoice: true, parked: client.parked, until: w.time + HOLD_SECS });
            } else if (!client.parked) {                         // dead: nothing to keep
                w.removeDragon(d);
                this.broadcast({ t: 'dx', id: d.id });
            }
        }
        client.life = null;
        this.checkEmpty();
    }

    checkEmpty() {
        if (this.humans > 0) return;
        this.emptySince = Date.now();
        this.registry.emptied(this);
    }

    // The seat a resume token names: one held after a drop, or one whose old
    // socket is still open here (the browser noticed the drop first). Tokens
    // are per room, single-use and never logged.
    seatFor(token) {
        if (typeof token !== 'string' || !token) return null;
        const h = this.held.get(token);
        if (h) return h.going ? null : { hold: h, token };
        for (const c of this.clients) if (c.token === token) return { client: c };
        return null;
    }

    // Moves a seat (and the life it's on) to this new connection. Returns
    // the dragon to carry on with, or null if there's nothing left to resume
    // (it died, and that life was counted then).
    takeSeat(seat, client) {
        const w = this.world;
        const gone = (d) => { client.parkAt = 0; client.parked = null; client.life = null; w.removeDragon(d); this.broadcast({ t: 'dx', id: d.id }); return null; };
        if (seat.client) {
            const old = seat.client;
            this.clients.delete(old);
            const d = old.dragon;
            client.parkAt = old.parkAt; client.parked = old.parked; client.life = old.life;
            old.dragon = null; old.token = null; old.parkAt = 0; old.parked = null; old.life = null;
            old.close(4011, 'replaced');
            return d.alive || client.parked ? d : gone(d);
        }
        const h = seat.hold, d = h.dragon;
        this.held.delete(seat.token);
        client.life = h.life;
        if (h.grace) {                                           // still in the sky
            client.parkAt = h.parkAt;
            return d.alive ? d : gone(d);
        }
        if (h.byChoice) {                                        // folded its own wings: still folded
            client.parked = { mass: h.parked.mass, kills: h.parked.kills, since: w.time - PARK_MIN, resume: false };
            return d;
        }
        w.spawn(d, h.parked.mass);                               // back like unpark: a safe spot, spawn protection
        d.kills = h.parked.kills;
        d.fire = h.parked.fire; d.element = h.parked.element;     // with the crystals it held
        d.net = null; d.moveBudget = 0;
        if (client.life) client.life.t0 = w.time;                // flying again; time folded isn't time played
        seat.back = true;
        return d;
    }

    // Held seats, each tick (after the deaths are counted): the countdown,
    // then fold away (or go, for a player who isn't coming back), then
    // forget after HOLD_SECS, which ends that life.
    holding(w, pub, gone) {
        let freed = false;
        for (const [token, h] of this.held) {
            const d = h.dragon;
            if (h.grace && !d.alive) {                           // hit during the countdown: loot fell, life counted
                this.held.delete(token); freed = true;
                w.removeDragon(d);
                gone.push(d.id);
            } else if (h.grace && w.time >= h.until) {
                w.removeDragon(d);
                gone.push(d.id);
                if (h.going) { w.dropLoot(d, T.lootShare); this.held.delete(token); freed = true; continue; }
                if (h.life) { h.life.secs += w.time - h.life.t0; h.life.peak = Math.max(h.life.peak, d.peakMass); }
                h.grace = false; h.byChoice = h.parkAt > 0;
                h.parked = { mass: d.mass, kills: d.kills, fire: d.fire, element: d.element }; h.until = w.time + HOLD_SECS;
                d.alive = false;
                pub.push({ k: 'land', id: d.id });
            } else if (!h.grace && w.time >= h.until) {
                this.endLife(h, h.cause);                        // not back in time: that life is over
                this.held.delete(token); freed = true;
            }
        }
        if (freed) this.checkEmpty();
    }

    // Validate and store a pose report from this client's browser.
    pose(client, m) {
        const d = client.dragon;
        if (!d || !d.alive) return;
        const nums = [m.x, m.y, m.z, m.qx, m.qy, m.qz, m.qw, m.s, m.bk];
        if (!nums.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e4)) return;
        d.net = { x: m.x, y: m.y, z: m.z, qx: m.qx, qy: m.qy, qz: m.qz, qw: m.qw, speed: Math.min(150, Math.abs(m.s)), bank: m.bk, fresh: true };
        d.input.boost = m.b === 1; d.input.brake = m.k === 1; d.input.fire = m.f === 1;
    }

    respawn(client) {
        const d = client.dragon;
        if (!d || d.alive || !this.world || client.parked) return;
        if (this.world.time - d.diedAt < 1) return;       // no instant respawn spam
        this.world.spawn(d, T.spawnMass);
        d.net = null; d.moveBudget = 0;
        this.startLife(client);
        this.broadcast({ t: 'dn', d: dragonMeta(d) });
    }

    // Anonymous play totals (stats.js): each human life is counted once, as
    // it ends: a death, leaving while flying or parked, or a dropped
    // player's held seat being forgotten (a reconnect carries the life on).
    // Time parked doesn't count as time played, and the peak survives a park.
    startLife(c) {
        c.life = { t0: this.world.time, secs: 0, peak: c.dragon.mass };
    }

    endLife(c, cause) {
        const life = c.life, d = c.dragon;
        if (!life || !d || !this.world) return;
        c.life = null;
        const secs = life.secs + (c.parked ? 0 : this.world.time - life.t0);
        this.registry.stats.run('room', { arena: this.meta.arena, len: Math.round(lengthFor(Math.max(life.peak, d.peakMass))),
            secs: Math.round(secs), kills: d.kills, cause });
    }

    // Whose dragon this is: a client's, or a seat held for one (see leave).
    clientOf(d) {
        for (const c of this.clients) if (c.dragon === d) return c;
        for (const h of this.held.values()) if (h.dragon === d) return h;
        return null;
    }

    // Esc online folds your wings: a room can't pause, so after a short
    // countdown (still flying, still vulnerable — no dodging a kill) your
    // dragon leaves the sky with its length, and unpark brings it back at a
    // safe spot with spawn protection.
    park(client) {
        const d = client.dragon;
        if (!d || !d.alive || !this.world || client.parked || client.parkAt) return;
        client.parkAt = this.world.time + PARK_DELAY;
        client.send({ t: 'e', ev: [{ k: 'parking', in: PARK_DELAY }] });
    }

    unpark(client) {
        if (client.parkAt) { client.parkAt = 0; client.send({ t: 'e', ev: [{ k: 'unparked' }] }); return; }
        if (client.parked) client.parked.resume = true;          // honoured in tick once PARK_MIN has passed
    }

    // Countdowns finishing and parked dragons returning (called from tick).
    parking(w, pub, landed) {
        for (const c of this.clients) {
            const d = c.dragon;
            if (c.parkAt) {
                if (!d.alive) c.parkAt = 0;                      // died during the countdown
                else if (w.time >= c.parkAt) {
                    c.parkAt = 0;
                    c.parked = { mass: d.mass, kills: d.kills, since: w.time, resume: false };
                    if (c.life) { c.life.secs += w.time - c.life.t0; c.life.peak = Math.max(c.life.peak, d.peakMass); }
                    d.alive = false;
                    w.removeDragon(d);
                    pub.push({ k: 'land', id: d.id });
                    landed.push(c);
                }
            } else if (c.parked && c.parked.resume && w.time - c.parked.since >= PARK_MIN) {
                const p = c.parked;
                c.parked = null;
                w.spawn(d, p.mass);
                d.kills = p.kills;
                d.net = null; d.moveBudget = 0;
                if (c.life) c.life.t0 = w.time;
            }
        }
    }

    // [type, x, y, z, spin]. A sun crystal (rule sunCrystals) adds its id,
    // how faded it is (1, falling to 0 at the edge) and the s until it can
    // be caught: older clients read the first five, so they see it too (as
    // fire, without 'el'). `caps`: what the browser understands ({ el,
    // fight }), everything by default; Poison Skin crystals are left out for
    // a browser without 'fight'.
    powerups(caps = { el: true, fight: true }) {
        const old = !caps.el;
        return this.world ? this.world.powerups.filter((p) => caps.fight || p.type !== 'poison').map((p) => {
            const q = [old && OLD_KIND[p.type] ? 'fire' : p.type, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.spin)];
            if (p.sun) q.push(p.sun, r2(p.fade), r2(p.hatch));
            return q;
        }) : [];
    }

    // Flaming pearls, as a field of their own: old clients ignore it.
    pearls() {
        return this.world ? this.world.pearls.map((p) => [p.id, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)]) : [];
    }

    tick() {
        const w = this.world;
        if (!w || this.humans === 0) return;
        const before = new Set(w.dragons);
        w.step(TICK);
        managePopulation(w);
        this.tickCount++;

        // Events: public ones to everyone, personal ones to their owner.
        const pub = [];
        const landed = [], gone = [];
        this.parking(w, pub, landed);
        const mine = new Map();
        const to = (d, e) => { if (!d || !d.human) return; if (!mine.has(d)) mine.set(d, []); mine.get(d).push(e); };
        for (const e of w.events) {
            switch (e.type) {
                case 'death':
                    pub.push({ k: 'death', id: e.d.id, by: e.killer ? e.killer.id : 0, cause: e.killer ? e.cause : String(e.cause).slice(0, 40) });
                    if (e.d.human) { const c = this.clientOf(e.d); if (c) this.endLife(c, endCause(e)); }
                    break;
                case 'sever': pub.push({ k: 'sever', id: e.d.id, o: e.o.id, burn: e.burn.map(r2).slice(0, 600) }); break;
                case 'fireStart': pub.push({ k: 'fire', id: e.d.id, lv: e.lv, el: e.el }); break;   // charges spent, element (older clients draw fire)
                case 'chill': pub.push({ k: 'chill', id: e.d.id, o: e.o.id, t: r2(e.t) }); break;   // new kinds: older clients skip them
                case 'bolt': pub.push({ k: 'bolt', id: e.d.id, o: e.hits.map((x) => x.id), p: e.pts.map(r2), s: r2(e.stun) }); break;
                case 'acid': pub.push({ k: 'acid', id: e.d ? e.d.id : 0, o: e.o.id }); break;
                case 'bite': {
                    // Fight mode adds f (a body bite), l (m bitten off), burn (the part that broke off) and
                    // kill (it killed: the death follows). The body's new length reaches every page in snapshots.
                    const b = { k: 'bite', id: e.d.id, o: e.o.id, g: e.gain, x: r2(e.x), y: r2(e.y), z: r2(e.z) };
                    if (e.fight) Object.assign(b, { f: 1, l: Math.round(e.cut), burn: e.burn.map(r2).slice(0, 300) }, e.fatal ? { kill: 1 } : {});
                    pub.push(b);
                    break;
                }
                // Fight mode: two heads bounced off each other, each now heading a / b and stunned s seconds.
                case 'bump': pub.push({ k: 'bump', id: e.a.id, o: e.b.id, a: e.da.toArray().map(r3), b: e.db.toArray().map(r3), s: r2(e.stun), x: r2(e.x), y: r2(e.y), z: r2(e.z) }); break;
                case 'pearl': pub.push({ k: 'pearl', id: e.d.id, g: e.gain, x: r2(e.x), y: r2(e.y), z: r2(e.z) }); break;
                case 'sunCrystal': pub.push({ k: 'sun', kind: e.kind, id: e.id, x: r2(e.pos.x), y: r2(e.pos.y), z: r2(e.pos.z) }); break;   // born at the sun (older clients skip it)
                case 'eat': to(e.d, { k: 'eat' }); break;
                case 'tier': to(e.d, { k: 'tier', tier: e.tier }); break;
                case 'nearMiss': to(e.d, { k: 'nm' }); break;
                case 'powerup': to(e.d, { k: 'pu', kind: e.kind, n: e.charge }); break;            // n: dragonfire charges now held
                case 'shieldPop': to(e.d, { k: 'shield' }); break;
                case 'fireMiss': to(e.d, { k: 'miss', el: e.el }); break;
                case 'thrustEmpty': to(e.d, { k: 'empty' }); break;
            }
        }
        this.holding(w, pub, gone);
        if (pub.length) this.broadcast({ t: 'e', ev: pub });
        for (const c of this.clients) { const ev = mine.get(c.dragon); if (ev) c.send({ t: 'e', ev: eventsFor(c, ev) }); }
        for (const c of landed) { c.send({ t: 'e', ev: [{ k: 'parked' }] }); this.broadcast({ t: 'dx', id: c.dragon.id }); }
        for (const id of gone) this.broadcast({ t: 'dx', id });

        // Then new and removed dragons (bots spawning / dying) — after the
        // events, so a death can still name its victim.
        for (const d of w.dragons) if (!before.has(d)) this.broadcast({ t: 'dn', d: dragonMeta(d) });
        for (const d of before) if (!w.byId.has(d.id) && !d.human) this.broadcast({ t: 'dx', id: d.id });

        if (this.tickCount % SNAP_EVERY) return;
        const states = w.dragons.filter((d) => d.alive || d.human).map(stateOf);
        const board = w.leaderboard().slice(0, 10).map((d) => [d.id, d.name, Math.round(d.shownLen || d.len)]);
        const o = w.orbLog.splice(0).map((op) => (op[0] === 'd' ? [0, op[1]] : [1, op[1], r2(op[2]), r2(op[3]), r2(op[4]), r2(op[5]), op[6], Math.round(op[7])]));
        const base = { t: 's', tm: r2(w.time), d: states, o, pu: this.powerups(), pl: this.pearls(), lb: board, n: w.dragons.filter((d) => d.alive).length, h: this.humans };
        // Acid clouds: [id, x, y, z, radius, s left, lifetime, spitter] (older clients ignore them).
        if (w.clouds.length) base.ac = w.clouds.map((c) => [c.id, r2(c.x), r2(c.y), r2(c.z), r2(c.r), r2(c.ttl), r2(c.life), c.owner]);
        // Power-ups as each kind of browser understands them (the full list for an up-to-date one).
        const puFor = new Map([['11', base.pu]]), puOf = (c) => {
            const key = (c.el ? '1' : '0') + (c.fight ? '1' : '0');
            if (!puFor.has(key)) puFor.set(key, this.powerups(c));
            return puFor.get(key);
        };
        for (const c of this.clients) {
            const d = c.dragon;
            // fire: stored charges (older clients only test it for truthiness); bl: the breath's level;
            // el: their element when not fire; ch, st: s left chilled / stunned.
            const me = { temp: r2(d.temp), thrust: r2(d.thrust), lock: d.thrustLocked ? 1 : 0, fire: d.fire, breath: r2(d.breath), bl: d.breathLevel,
                shield: r2(d.shield), magnet: r2(d.magnet), kills: d.kills, protect: r2(d.protect), tm: d.thrustMult || 1 };
            if (d.element !== 'fire') me.el = d.element;
            if (d.chill > 0) me.ch = r2(d.chill);
            if (d.stun > 0) me.st = r2(d.stun);
            if (d.poison > 0) me.po = r2(d.poison);                 // fight mode: s of Poison Skin left
            if (d.corrected) { me.c = [r2(d.pos.x), r2(d.pos.y), r2(d.pos.z)]; d.corrected = false; }
            // A slow client may skip a snapshot (client.js); its food
            // changes ride along with the next one that goes out.
            const o = c.unsentOrbs ? c.unsentOrbs.concat(base.o) : base.o;
            if (c.send({ ...base, o, pu: puOf(c), me })) c.unsentOrbs = null;
            else if (o.length) c.unsentOrbs = o.length > MAX_UNSENT_ORBS ? o.slice(-MAX_UNSENT_ORBS) : o;
        }
    }

    broadcast(msg, except) {
        const s = JSON.stringify(msg);
        for (const c of this.clients) if (c !== except) c.sendRaw(s);
    }

    // After an error in this room (Registry.guard): everyone in it is
    // dropped with close code 1011 and the world is freed, so the next join
    // starts clean. Other rooms are untouched.
    reset() {
        const clients = [...this.clients];
        for (const c of [...clients, ...this.held.values()]) { try { this.endLife(c, 'disconnect'); } catch { /* the world may be what broke */ } }
        this.clients.clear();
        this.held.clear();
        this.world = null;
        this.emptySince = Date.now();
        for (const c of clients) {
            c.dragon = null; c.room = null; c.token = null; c.parkAt = 0; c.parked = null;
            c.close(1011, 'room error');
        }
        this.registry.emptied(this);
    }
}

const NO_STATS = { run() {}, humans() {}, roomCreated() {} };

export class Registry {
    constructor(store, log = () => {}, stats = NO_STATS) {
        this.store = store;
        this.log = log;
        this.stats = stats;             // anonymous daily totals (stats.js)
        this.rooms = new Map();
        this.createdByIp = new Map();   // ip → [timestamps]
        this.errors = new Map();        // error key → { at, n } (see logError)
    }

    async init() {
        for (const r of DEFAULT_ROOMS) this.rooms.set(r.id, new Room({ ...r, permanent: true, createdAt: 0, expireAt: null }, this));
        const saved = (await this.store.loadAll()) || [];
        const now = Date.now();
        for (const m of saved) {
            if (!m || typeof m.id !== 'string' || this.rooms.has(m.id)) continue;
            if (m.expireAt && m.expireAt < now) { this.store.remove(m.id); continue; }
            if (!isRoomName(m.name)) { this.store.remove(m.id); continue; }          // typed before names came from the list
            const meta = { id: m.id, name: m.name, arena: m.arena === 'orb' ? 'orb' : 'sky', beginner: true,   // every room is a beginner room
                permanent: false, createdAt: m.createdAt || now, expireAt: m.expireAt || now + LIMITS.emptyTtlMs };
            const rules = cleanRoomRules(m.rules);
            if (rules) meta.rules = rules;
            this.rooms.set(meta.id, new Room(meta, this));
        }
        this.log(`rooms ready: ${this.rooms.size} (${this.store.kind} store)`);
    }

    list() {
        const now = Date.now();
        return [...this.rooms.values()].filter((r) => !r.meta.expireAt || r.meta.expireAt > now || r.humans > 0)
            .map((r) => r.summary())
            .sort((a, b) => (b.beginner - a.beginner) || (b.permanent - a.permanent) || (b.humans - a.humans) || a.name.localeCompare(b.name));
    }

    get(id) { return typeof id === 'string' ? this.rooms.get(id) : undefined; }

    create(body, ip) {
        const now = Date.now();
        const recent = (this.createdByIp.get(ip) || []).filter((t) => now - t < 3600 * 1000);
        if (recent.length >= LIMITS.roomsPerIpPerHour) return { error: 'You can create 3 servers an hour. Try again later.', status: 429 };
        const userRooms = [...this.rooms.values()].filter((r) => !r.meta.permanent).length;
        if (userRooms >= LIMITS.userRooms) return { error: 'Too many servers right now. Join one of the others!', status: 503 };
        // Names come from the list in names.js, never from what a player
        // typed. A free list name is honoured; anything else (a taken name,
        // or an old cached client's free text) gets a random free one, so
        // the name never fails a create.
        const taken = new Set([...this.rooms.values()].map((r) => r.meta.name));
        const asked = body && body.name;
        const name = isRoomName(asked) && !taken.has(asked) ? asked : freeRoomName(taken);
        const meta = { id: newId(), name, arena: body.arena === 'orb' ? 'orb' : 'sky', beginner: true,   // every room is a beginner room
            permanent: false, createdAt: now, expireAt: now + LIMITS.emptyTtlMs };
        const rules = cleanRoomRules(body.rules);                    // fight mode, if asked for (0 or 1); nothing else
        if (rules) meta.rules = rules;
        const room = new Room(meta, this);
        this.rooms.set(meta.id, room);
        recent.push(now);
        this.createdByIp.set(ip, recent);
        this.store.save(meta);
        this.stats.roomCreated();
        this.log(`room created ${meta.id} "${meta.name}" (${meta.arena}${meta.beginner ? ', beginner' : ''}${room.fight ? ', fight' : ''})`);
        return { room: room.summary() };
    }

    // Lifecycle: a user room lives until 12 h after its last player leaves.
    occupied(room) {
        if (room.meta.permanent || room.meta.expireAt === null) return;
        room.meta.expireAt = null;
        this.store.save(room.meta);
    }

    emptied(room) {
        if (room.meta.permanent) return;
        room.meta.expireAt = Date.now() + LIMITS.emptyTtlMs;
        this.store.save(room.meta);
    }

    tick() {
        for (const r of this.rooms.values()) this.guard(r, 'tick', () => r.tick());
    }

    // Humans in every room now, for the day's peak.
    countHumans() {
        let n = 0;
        for (const r of this.rooms.values()) n += r.humans;
        this.stats.humans(n);
    }

    // Seats held for players from this IP, in every room. They count toward
    // its connection limit (server.js), so dropping sockets over and over
    // can't pile up held seats and fill a room.
    heldBy(ip) {
        let n = 0;
        for (const r of this.rooms.values()) for (const h of r.held.values()) if (h.ip === ip) n++;
        return n;
    }

    // Shutting down: everyone in a room, and every held seat, is about to be
    // cut off.
    endLives(cause) {
        for (const r of this.rooms.values()) for (const c of [...r.clients, ...r.held.values()]) r.endLife(c, cause);
    }

    // Runs fn for one room. If it throws, the error is logged and only that
    // room is reset (Room.reset), so one room's bug can't take the process
    // and every other room down with it. Returns false if it threw.
    guard(room, where, fn) {
        try { fn(); return true; } catch (e) {
            this.logError(`room ${room.meta.id} ${where}`, e);
            try { room.reset(); } catch (e2) { this.logError(`room ${room.meta.id} reset`, e2); }
            return false;
        }
    }

    // Logs an error with its stack, but the same error at most once a
    // minute (then with a count), so one that repeats every tick can't
    // flood the logs.
    logError(where, e) {
        const msg = String((e && e.message) || e).slice(0, 200);
        const key = where + ': ' + msg;
        const now = Date.now();
        const seen = this.errors.get(key);
        if (seen && now - seen.at < 60 * 1000) { seen.n++; return; }
        if (this.errors.size >= 200) this.errors.clear();
        this.errors.set(key, { at: now, n: 0 });
        this.log(`error in ${where}${seen && seen.n ? ` (${seen.n} more since last logged)` : ''}:`, (e && e.stack) || msg);
    }

    // Every minute: delete expired rooms, free idle worlds, forget old
    // rate-limit entries, and report how often a quietened error repeated.
    sweep() {
        const now = Date.now();
        for (const [id, r] of this.rooms) {
            this.guard(r, 'sweep', () => {
                if (r.humans === 0 && r.world && now - r.emptySince > LIMITS.worldIdleMs) r.world = null;
                if (!r.meta.permanent && r.humans === 0 && r.meta.expireAt && r.meta.expireAt < now) {
                    this.rooms.delete(id);
                    this.store.remove(id);
                    this.log(`room expired ${id} "${r.meta.name}"`);
                }
            });
        }
        for (const [ip, ts] of this.createdByIp) if (!ts.some((t) => now - t < 3600 * 1000)) this.createdByIp.delete(ip);
        for (const [k, v] of this.errors) {
            if (now - v.at < 60 * 1000) continue;
            if (v.n) this.log(`error in ${k} (repeated ${v.n} more times)`);
            this.errors.delete(k);
        }
        try { this.countHumans(); } catch (e) { this.logError('sweep', e); }   // so a new day's peak counts players already in
    }
}
