// Multiplayer client for one room. Your own dragon flies here with no input
// lag (sim mode 'client') and its pose is reported 30×/s; everything else —
// other dragons, orbs, power-ups, deaths, heat, thrust — comes from the
// server. Other dragons are drawn ~120 ms in the past so their motion is
// smooth between snapshots.
import { Quaternion, Vector3 } from 'three';
import { T, DEFAULTS, radiusFor, tierFor } from './tunables.js?v=12';
import { World, Dragon } from './sim.js?v=12';
import { MOODS } from './bots.js?v=12';

const INTERP = 0.12;
const _qa = new Quaternion(), _qb = new Quaternion();

// Rooms list / create (HTTP).
export async function fetchRooms(base) {
    const r = await fetch(base + '/api/rooms', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return (await r.json()).rooms || [];
}

export async function createRoom(base, body) {
    const r = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Could not create the server');
    return j.room;
}

export class NetGame {
    constructor(base, roomId, name, extras, hooks) {
        this.hooks = hooks;
        this.events = [];
        this.world = null; this.player = null; this.room = null;
        this.humans = 0; this.rtt = 0;
        this.sendAcc = 0; this.pingAcc = 0;
        this.gone = new Map();          // recently removed dragons (to name them in events)
        this.parked = false;            // wings folded (Esc): out of the sky, length kept
        this.ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws?room=' + encodeURIComponent(roomId));
        this.ws.onopen = () => this.send({ t: 'hello', name, perks: extras.perks || [], skin: extras.skin || '' });
        this.ws.onmessage = (e) => { try { this.onMessage(JSON.parse(e.data)); } catch (err) { console.warn('net', err); } };
        this.ws.onclose = (e) => { if (!this.closing) hooks.onClose(this.fullError || (this.world ? 'Disconnected from the server' : 'Could not reach the server')); };
    }

    send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
    close() { this.closing = true; try { this.ws.close(); } catch { /* ignore */ } }
    takeEvents() { const e = this.events; this.events = []; return e; }
    dragon(id) { return (this.world && this.world.byId.get(id)) || this.gone.get(id) || null; }

    onMessage(m) {
        switch (m.t) {
            case 'welcome': return this.welcome(m);
            case 's': return this.snapshot(m);
            case 'dn': return this.dragonNew(m.d);
            case 'dx': return this.dragonGone(m.id);
            case 'e': return this.gameEvents(m.ev);
            case 'pong': this.rtt = performance.now() - m.c; return;
            case 'full': this.fullError = m.error; return;
        }
    }

    welcome(m) {
        // Play by the server's numbers (your tuning panel doesn't apply here).
        Object.assign(T, DEFAULTS);
        for (const k of Object.keys(DEFAULTS)) if (typeof m.tune[k] === 'number' && Number.isFinite(m.tune[k])) T[k] = m.tune[k];
        const w = new World(m.room.arena, 'client');
        if (m.rules && typeof m.rules === 'object') for (const [k, v] of Object.entries(m.rules)) if (k in DEFAULTS && typeof v === 'number') w.rules[k] = v;
        this.world = w; this.room = m.room; this.you = m.you;
        for (const d of m.dragons) this.dragonNew(d);
        const o = m.orbs;
        for (let k = 0; k < o.length; k += 7) this.setOrb(o[k], o[k + 1], o[k + 2], o[k + 3], o[k + 4], o[k + 5], o[k + 6]);
        this.setPowerups(m.pu);
        this.player = w.byId.get(m.you);
        w.player = this.player;
        this.player.wallAssist = !!m.room.beginner;
        this.hooks.onWelcome(w, this.player, m.room);
    }

    // A dragon appears (join, bot spawn) or respawns: full state + tail.
    dragonNew(info) {
        const w = this.world;
        if (!w) return;
        let d = w.byId.get(info.id);
        if (!d && info.id === this.you && this.player) d = w.addDragon(this.player);   // back from folded wings
        if (!d) {
            d = new Dragon(String(info.name || ''), !!info.bot);
            d.id = info.id;
            w.addDragon(d);
        }
        d.name = String(info.name || '').slice(0, 24);    // already sanitised by the server; drawn as text only
        d.color = info.c1 | 0; d.color2 = info.c2 | 0; d.isBot = !!info.bot; d.human = !!info.human;
        d.mood = MOODS.includes(info.mood) ? info.mood : '';
        const s = info.s;
        d.pos.set(s[1], s[2], s[3]);
        d.quat.set(s[4], s[5], s[6], s[7]).normalize();
        d.updateFrame(); d.vdir.copy(d.fwd);
        this.applyState(d, s);
        d.pathHead = -1; d.pathCount = 0;
        const p = info.path || [];
        for (let k = 0; k + 2 < p.length; k += 3) d.pushPath(p[k], p[k + 1], p[k + 2]);
        if (!d.pathCount) d.lastPt.copy(d.pos);
        d.samples = [];
        d.len = s[9];
        d.rebuildBeads();
        if (d.id === this.you && this.player && d.alive) {
            const resumed = this.parked;
            this.parked = false;
            if (!resumed) { d.bornAt = w.time; d.peakMass = d.mass; d.kills = 0; d.bestRank = 99; }
            this.hooks.onRespawn(d, resumed);
        }
    }

    dragonGone(id) {
        const w = this.world, d = w && w.byId.get(id);
        if (!d) return;
        this.gone.set(id, d);
        if (this.gone.size > 64) this.gone.delete(this.gone.keys().next().value);
        w.removeDragon(d);
    }

    applyState(d, s) {
        d.mass = s[8]; d.len = s[9];
        d.r = radiusFor(d.mass);
        d.tier = tierFor(d.mass);
        if (d.mass > d.peakMass) d.peakMass = d.mass;
        const f = s[10];
        d.alive = !!(f & 1); d.boosting = !!(f & 2); d.braking = !!(f & 4);
        d.protect = f & 8 ? 1 : 0; d.shield = f & 16 ? Math.max(d.shield, 1) : 0;
        if (d !== this.player) { d.breath = f & 32 ? 0.5 : 0; d.magnet = f & 256 ? 1 : 0; }
    }

    snapshot(m) {
        const w = this.world;
        if (!w) return;
        const now = performance.now() / 1000;
        for (const s of m.d) {
            const d = w.byId.get(s[0]);
            if (!d) continue;
            this.applyState(d, s);
            if (d === this.player) continue;           // you fly yourself
            d.bankNet = s[11]; d.speed = s[12];
            d.samples.push({ t: now, x: s[1], y: s[2], z: s[3], qx: s[4], qy: s[5], qz: s[6], qw: s[7] });
            if (d.samples.length > 8) d.samples.shift();
        }
        for (const op of m.o) {
            if (op[0] === 0) this.clearOrb(op[1]);
            else this.setOrb(op[1], op[2], op[3], op[4], op[5], op[6], op[7]);
        }
        this.setPowerups(m.pu);
        this.humans = m.h;
        const me = m.me, p = this.player;
        if (me && p) {
            p.temp = me.temp; p.thrust = me.thrust; p.thrustLocked = !!me.lock;
            p.fire = me.fire; p.breath = me.breath; p.shield = me.shield; p.magnet = me.magnet;
            p.kills = me.kills; p.protect = me.protect; p.thrustMult = me.tm || 1;
            if (me.c) p.pos.set(me.c[0], me.c[1], me.c[2]);    // server clamped us: snap back
        }
    }

    gameEvents(list) {
        const p = this.player;
        for (const e of list) {
            switch (e.k) {
                case 'death': {
                    const d = this.dragon(e.id);
                    if (!d) break;
                    d.alive = false;
                    this.events.push({ type: 'death', d, killer: e.by ? this.dragon(e.by) : null, cause: e.cause });
                    break;
                }
                case 'sever': { const d = this.dragon(e.id), o = this.dragon(e.o); if (d && o) this.events.push({ type: 'sever', d, o, burn: e.burn || [] }); break; }
                case 'fire': { const d = this.dragon(e.id); if (d) this.events.push({ type: 'fireStart', d }); break; }
                case 'bite': {
                    const d = this.dragon(e.id), o = this.dragon(e.o);
                    if (d && o) this.events.push({ type: 'bite', d, o, gain: e.g | 0, x: +e.x, y: +e.y, z: +e.z, color: o.color });
                    break;
                }
                case 'eat': this.events.push({ type: 'eat', d: p }); break;
                case 'tier': this.events.push({ type: 'tier', d: p, tier: e.tier | 0 }); break;
                case 'nm': this.events.push({ type: 'nearMiss', d: p }); break;
                case 'pu': this.events.push({ type: 'powerup', d: p, kind: e.kind }); break;
                case 'shield': this.events.push({ type: 'shieldPop', d: p }); break;
                case 'miss': this.events.push({ type: 'fireMiss', d: p }); break;
                case 'empty': this.events.push({ type: 'thrustEmpty', d: p }); break;
                case 'parking': this.events.push({ type: 'parking', in: +e.in || 3 }); break;
                case 'unparked': this.events.push({ type: 'unparked' }); break;
                case 'parked': this.parked = true; if (p) p.alive = false; this.events.push({ type: 'parked' }); break;
                case 'land': { const d = this.dragon(e.id); if (d && d !== p) this.events.push({ type: 'land', d }); break; }
            }
        }
    }

    setOrb(i, x, y, z, val, col, ttl) {
        const w = this.world;
        if (!(i >= 0 && i < w.oalive.length)) return;
        if (!w.oalive[i]) w.orbCount++;
        w.ox[i] = x; w.oy[i] = y; w.oz[i] = z; w.oval[i] = val; w.ocol[i] = col; w.ottl[i] = ttl;
        w.oalive[i] = 1;
        if (i >= w.oHigh) w.oHigh = i + 1;
    }

    clearOrb(i) {
        const w = this.world;
        if (!(i >= 0 && i < w.oalive.length && w.oalive[i])) return;
        // The server reels orbs in before eating them; we only hear that one
        // is gone. If a lodestone dragon is near, replay the pull as a beam.
        let best = null, bestD = Infinity;
        for (const d of w.dragons) {
            if (!d.alive || !(d.magnet > 0)) continue;
            const dx = w.ox[i] - d.pos.x, dy = w.oy[i] - d.pos.y, dz = w.oz[i] - d.pos.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < T.magnetRadius + d.r + d.speed * 0.7 + 3 && dist < bestD) { best = d; bestD = dist; }
        }
        if (best && w.phantoms.length < 120) w.phantoms.push({ x: w.ox[i], y: w.oy[i], z: w.oz[i], col: w.ocol[i], val: w.oval[i], d: best, t: 0 });
        w.oalive[i] = 0; w.orbCount--;
    }

    setPowerups(list) {
        const w = this.world;
        w.powerups = (list || []).map((q) => ({ type: String(q[0]), pos: new Vector3(q[1], q[2], q[3]), spin: q[4] }));
    }

    // Per frame: place other dragons along their snapshot timeline, send
    // your pose, keep an RTT estimate.
    update(dt) {
        const w = this.world;
        if (!w) return;
        const rt = performance.now() / 1000 - INTERP;
        for (const d of w.dragons) {
            if (d === this.player || !d.alive || !d.samples || !d.samples.length) continue;
            const S = d.samples;
            let a = S[0], b = S[S.length - 1];
            for (let i = 0; i < S.length - 1; i++) if (S[i].t <= rt && S[i + 1].t >= rt) { a = S[i]; b = S[i + 1]; break; }
            const k = b.t > a.t ? Math.max(0, Math.min(1.5, (rt - a.t) / (b.t - a.t))) : 1;
            d.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
            _qa.set(a.qx, a.qy, a.qz, a.qw); _qb.set(b.qx, b.qy, b.qz, b.qw);
            d.quat.copy(_qa).slerp(_qb, Math.min(1, k)).normalize();
            d.updateFrame(); d.vdir.copy(d.fwd);
            d.bank += ((d.bankNet || 0) - d.bank) * 0.3;
            w.recordPath(d);
        }
        const p = this.player;
        this.sendAcc += dt;
        if (p && p.alive && this.sendAcc >= 1 / 30) {
            this.sendAcc = 0;
            const r = (v) => Math.round(v * 100) / 100, q = (v) => Math.round(v * 1000) / 1000;
            this.send({ t: 'p', x: r(p.pos.x), y: r(p.pos.y), z: r(p.pos.z), qx: q(p.quat.x), qy: q(p.quat.y), qz: q(p.quat.z), qw: q(p.quat.w),
                s: r(p.speed), bk: r(p.bank), b: p.input.boost ? 1 : 0, k: p.input.brake ? 1 : 0, f: p.input.fire ? 1 : 0 });
        }
        this.pingAcc += dt;
        if (this.pingAcc > 2) { this.pingAcc = 0; this.send({ t: 'ping', c: performance.now() }); }
    }

    respawn() { this.send({ t: 'spawn' }); }
    park() { this.send({ t: 'park' }); }
    unpark() { this.send({ t: 'unpark' }); }
}
