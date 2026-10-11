// Rooms: the two permanent servers + player-created ones. Each room runs
// the shared sim (mode 'server') while anyone is in it: bots, collisions,
// orbs, deaths, heat and thrust are decided here; browsers report only
// their own dragon's pose, which the sim speed-checks (see sim.applyNet).
import { randomBytes } from 'node:crypto';
import { World, Dragon, T, lengthFor, managePopulation, checkName, safePlayerName, cleanPerks, skinById } from '../site/js/shared.js';

// Beginner is shown as a badge, never in a name. Beginner rooms list first.
export const DEFAULT_ROOMS = [
    { id: 'the-orb', name: 'The Orb', arena: 'orb', beginner: true },
    { id: 'skyhold', name: 'Skyhold', arena: 'sky', beginner: true },
];
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

const TICK = 1 / 30;
const SNAP_EVERY = 2;            // 15 snapshots/s
const PARK_DELAY = 3;            // s of flight (still vulnerable) before folded wings take effect
const PARK_MIN = 2;              // s parked before you can fly back in
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

function newId() {
    return randomBytes(9).toString('base64url');   // 12 chars, ~72 bits, unguessable
}

// Flags packed into one number per dragon in snapshots.
function flags(d) {
    return (d.alive ? 1 : 0) | (d.boosting ? 2 : 0) | (d.braking ? 4 : 0) | (d.protect > 0 ? 8 : 0)
        | (d.shield > 0 ? 16 : 0) | (d.breath > 0 ? 32 : 0) | (d.human ? 64 : 0) | (d.isBot ? 128 : 0)
        | (d.magnet > 0 ? 256 : 0);
}

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
        this.clients = new Set();    // Client objects (see server.js)
        this.world = null;
        this.activeSince = 0;
        this.emptySince = Date.now();
        this.tickCount = 0;
    }

    get humans() { return this.clients.size; }

    summary() {
        const bots = this.world ? this.world.dragons.filter((d) => d.isBot && d.alive).length : 0;
        return { id: this.meta.id, name: this.meta.name, arena: this.meta.arena, beginner: !!this.meta.beginner,
            permanent: !!this.meta.permanent, humans: this.humans, bots, max: LIMITS.humansPerRoom };
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

    join(client, rawName, extras = {}) {
        if (this.humans >= LIMITS.humansPerRoom) return { error: 'This server is full' };
        const wasEmpty = this.humans === 0;
        this.ensureWorld();
        if (wasEmpty) {
            this.activeSince = this.world.ageStart = this.world.time;
            this.registry.occupied(this);
        }
        const d = new Dragon(safePlayerName(rawName), false);
        d.human = true; d.remote = true;
        // Profile extras from the browser, re-checked here: known perk ids
        // (at most two; the room's `perks` rule decides if they apply) and a
        // known colour scheme.
        d.perks = cleanPerks(extras.perks);
        const skin = skinById(extras.skin);
        if (skin) { d.color = skin.c1; d.color2 = skin.c2; }
        this.world.spawn(d, T.spawnMass);
        client.dragon = d;
        client.room = this;
        this.clients.add(client);
        this.startLife(client);
        this.registry.countHumans();
        const w = this.world;
        const orbs = [];
        for (let i = 0; i < w.oHigh; i++) {
            if (w.oalive[i]) orbs.push(i, r2(w.ox[i]), r2(w.oy[i]), r2(w.oz[i]), r2(w.oval[i]), w.ocol[i], Math.round(w.ottl[i]));
        }
        client.send({
            t: 'welcome', you: d.id,
            room: { id: this.meta.id, name: this.meta.name, arena: this.meta.arena, beginner: !!this.meta.beginner },
            tune: { ...T }, rules: w.rules, time: r2(w.time),
            dragons: w.dragons.filter((x) => x.alive || x.human).map(dragonMeta),
            orbs, pu: this.powerups(),
        });
        this.broadcast({ t: 'dn', d: dragonMeta(d) }, client);
        return { ok: true };
    }

    // cause: 'quit' (the browser closed the socket) or 'disconnect'.
    leave(client, cause = 'quit') {
        if (!this.clients.delete(client)) return;
        this.endLife(client, cause);
        const d = client.dragon;
        if (d && this.world) {
            if (d.alive) this.world.dropLoot(d, T.lootShare);
            this.world.removeDragon(d);
            this.broadcast({ t: 'dx', id: d.id });
        }
        if (this.humans === 0) {
            this.emptySince = Date.now();
            this.registry.emptied(this);
        }
    }

    // Validate and store a pose report from this client's browser.
    pose(client, m) {
        const d = client.dragon;
        if (!d || !d.alive) return;
        const nums = [m.x, m.y, m.z, m.qx, m.qy, m.qz, m.qw, m.s, m.bk];
        if (!nums.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e4)) return;
        d.net = { x: m.x, y: m.y, z: m.z, qx: m.qx, qy: m.qy, qz: m.qz, qw: m.qw, speed: Math.min(80, Math.abs(m.s)), bank: m.bk, fresh: true };
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
    // it ends: a death, or leaving while flying or parked. Time parked
    // doesn't count as time played, and the peak survives a park.
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

    clientOf(d) {
        for (const c of this.clients) if (c.dragon === d) return c;
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

    powerups() {
        return this.world ? this.world.powerups.map((p) => [p.type, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.spin)]) : [];
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
        const landed = [];
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
                case 'fireStart': pub.push({ k: 'fire', id: e.d.id }); break;
                case 'bite': pub.push({ k: 'bite', id: e.d.id, o: e.o.id, g: e.gain, x: r2(e.x), y: r2(e.y), z: r2(e.z) }); break;
                case 'eat': to(e.d, { k: 'eat' }); break;
                case 'tier': to(e.d, { k: 'tier', tier: e.tier }); break;
                case 'nearMiss': to(e.d, { k: 'nm' }); break;
                case 'powerup': to(e.d, { k: 'pu', kind: e.kind }); break;
                case 'shieldPop': to(e.d, { k: 'shield' }); break;
                case 'fireMiss': to(e.d, { k: 'miss' }); break;
                case 'thrustEmpty': to(e.d, { k: 'empty' }); break;
            }
        }
        if (pub.length) this.broadcast({ t: 'e', ev: pub });
        for (const c of this.clients) { const ev = mine.get(c.dragon); if (ev) c.send({ t: 'e', ev }); }
        for (const c of landed) { c.send({ t: 'e', ev: [{ k: 'parked' }] }); this.broadcast({ t: 'dx', id: c.dragon.id }); }

        // Then new and removed dragons (bots spawning / dying) — after the
        // events, so a death can still name its victim.
        for (const d of w.dragons) if (!before.has(d)) this.broadcast({ t: 'dn', d: dragonMeta(d) });
        for (const d of before) if (!w.byId.has(d.id) && !d.human) this.broadcast({ t: 'dx', id: d.id });

        if (this.tickCount % SNAP_EVERY) return;
        const states = w.dragons.filter((d) => d.alive || d.human).map(stateOf);
        const board = w.leaderboard().slice(0, 10).map((d) => [d.id, d.name, Math.round(d.shownLen || d.len)]);
        const o = w.orbLog.splice(0).map((op) => (op[0] === 'd' ? [0, op[1]] : [1, op[1], r2(op[2]), r2(op[3]), r2(op[4]), r2(op[5]), op[6], Math.round(op[7])]));
        const base = { t: 's', tm: r2(w.time), d: states, o, pu: this.powerups(), lb: board, n: w.dragons.filter((d) => d.alive).length, h: this.humans };
        for (const c of this.clients) {
            const d = c.dragon;
            const me = { temp: r2(d.temp), thrust: r2(d.thrust), lock: d.thrustLocked ? 1 : 0, fire: d.fire, breath: r2(d.breath),
                shield: r2(d.shield), magnet: r2(d.magnet), kills: d.kills, protect: r2(d.protect), tm: d.thrustMult || 1 };
            if (d.corrected) { me.c = [r2(d.pos.x), r2(d.pos.y), r2(d.pos.z)]; d.corrected = false; }
            c.send({ ...base, me });
        }
    }

    broadcast(msg, except) {
        const s = JSON.stringify(msg);
        for (const c of this.clients) if (c !== except) c.sendRaw(s);
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
    }

    async init() {
        for (const r of DEFAULT_ROOMS) this.rooms.set(r.id, new Room({ ...r, permanent: true, createdAt: 0, expireAt: null }, this));
        const saved = (await this.store.loadAll()) || [];
        const now = Date.now();
        for (const m of saved) {
            if (!m || typeof m.id !== 'string' || this.rooms.has(m.id)) continue;
            if (m.expireAt && m.expireAt < now) { this.store.remove(m.id); continue; }
            const name = checkName(m.name, 'room', RESERVED_ROOM_NAMES);
            if (!name.ok) { this.store.remove(m.id); continue; }
            const meta = { id: m.id, name: name.value, arena: m.arena === 'orb' ? 'orb' : 'sky', beginner: true,   // every room is a beginner room
                permanent: false, createdAt: m.createdAt || now, expireAt: m.expireAt || now + LIMITS.emptyTtlMs };
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
        const name = checkName(body && body.name, 'room', RESERVED_ROOM_NAMES);
        if (!name.ok) return { error: name.reason, status: 400 };
        const lower = name.value.toLowerCase();
        if ([...this.rooms.values()].some((r) => r.meta.name.toLowerCase() === lower)) return { error: 'A server with that name already exists', status: 409 };
        const meta = { id: newId(), name: name.value, arena: body.arena === 'orb' ? 'orb' : 'sky', beginner: true,   // every room is a beginner room
            permanent: false, createdAt: now, expireAt: now + LIMITS.emptyTtlMs };
        const room = new Room(meta, this);
        this.rooms.set(meta.id, room);
        recent.push(now);
        this.createdByIp.set(ip, recent);
        this.store.save(meta);
        this.stats.roomCreated();
        this.log(`room created ${meta.id} "${meta.name}" (${meta.arena}${meta.beginner ? ', beginner' : ''})`);
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
        for (const r of this.rooms.values()) r.tick();
    }

    // Humans in every room now, for the day's peak.
    countHumans() {
        let n = 0;
        for (const r of this.rooms.values()) n += r.humans;
        this.stats.humans(n);
    }

    // Shutting down: everyone in a room is about to be cut off.
    endLives(cause) {
        for (const r of this.rooms.values()) for (const c of r.clients) r.endLife(c, cause);
    }

    // Every minute: delete expired rooms, free idle worlds, forget old rate-limit entries.
    sweep() {
        const now = Date.now();
        for (const [id, r] of this.rooms) {
            if (r.humans === 0 && r.world && now - r.emptySince > LIMITS.worldIdleMs) r.world = null;
            if (!r.meta.permanent && r.humans === 0 && r.meta.expireAt && r.meta.expireAt < now) {
                this.rooms.delete(id);
                this.store.remove(id);
                this.log(`room expired ${id} "${r.meta.name}"`);
            }
        }
        for (const [ip, ts] of this.createdByIp) if (!ts.some((t) => now - t < 3600 * 1000)) this.createdByIp.delete(ip);
        this.countHumans();             // so a new day's peak counts players already in
    }
}
