// Multiplayer client for one room. Your own dragon flies here with no input
// lag (sim mode 'client') and its pose is reported 30×/s; everything else —
// other dragons, orbs, power-ups, deaths, heat, thrust — comes from the
// server. Other dragons are drawn on the server's clock, a little behind
// it, so there's nearly always a snapshot either side to blend between.
import { Quaternion, Vector3 } from 'three';
import { T, DEFAULTS, radiusFor, tierFor } from './tunables.js?v=23';
import { World, Dragon, ELEMENTS } from './sim.js?v=23';
import { MOODS } from './bots.js?v=23';

const INTERP_DELAY = 0.12;     // s behind the server's now that other dragons are drawn (~2 snapshots)
const EXTRAP_MAX = 0.12;       // s to coast past the newest snapshot (last two only), then hold
const CLOCK_WINDOW = 2;        // s of arrivals the server-clock estimate looks back over
const CLOCK_EASE = 1;          // s: how slowly the estimate follows them
const CLOCK_SNAP = 0.25;       // s: a server clock this far ahead of the estimate is jumped to
const _qa = new Quaternion(), _qb = new Quaternion();

// The server's clock, from the sim time (`tm`) on each snapshot. Arrival
// minus tm is the network delay plus a fixed offset, and jitter or bunching
// only ever make it bigger, so the smallest value in the last couple of
// seconds (the quickest delivery) is the best guess at "server now". The
// estimate eases toward it so jitter doesn't shake the timeline, jumps
// forward if the server is well ahead, and starts over if the server clock
// goes back (a room that restarted its world).
class ServerClock {
    constructor() { this.lag = null; this.min = 0; this.recent = []; this.last = -Infinity; }

    // Note a snapshot's time; true when the server clock restarted.
    note(tm, now) {
        const R = this.recent, restarted = tm < this.last - 1;
        this.last = tm;
        if (restarted) R.length = 0;
        R.push({ at: now, lag: now - tm });
        while (now - R[0].at > CLOCK_WINDOW) R.shift();
        this.min = Infinity;
        for (const r of R) this.min = Math.min(this.min, r.lag);
        if (this.lag === null || restarted || this.min < this.lag - CLOCK_SNAP) this.lag = this.min;
        return restarted;
    }

    ease(dt) { if (this.lag !== null) this.lag += (this.min - this.lag) * Math.min(1, dt / CLOCK_EASE); }

    // The server time to draw others at: INTERP_DELAY behind its now, but
    // never more than EXTRAP_MAX past the newest snapshot. When it would be
    // (the network or the server stalled), it waits there and learns the
    // delay afresh, so the dragons carry on from where they stopped rather
    // than jumping ahead.
    drawTime(local) {
        if (this.lag === null) return -Infinity;
        const t = local - this.lag - INTERP_DELAY, edge = this.last + EXTRAP_MAX;
        if (t <= edge) return t;
        this.lag = this.min = local - INTERP_DELAY - edge;
        this.recent.length = 0;
        return edge;
    }
}

// Where a dragon was at server time t, from its snapshots S (oldest first):
// blended between the pair either side; before the first, the first; past
// the newest, carried on from the last two for at most EXTRAP_MAX.
function poseAt(S, t, d) {
    const n = S.length;
    let a = S[0], b = a, k = 0;
    if (n > 1 && t > a.t) {
        let i = 1;
        while (i < n - 1 && S[i].t < t) i++;
        a = S[i - 1]; b = S[i];
        k = (Math.min(t, b.t + EXTRAP_MAX) - a.t) / (b.t - a.t);    // > 1 past the newest
    }
    d.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    _qa.set(a.qx, a.qy, a.qz, a.qw); _qb.set(b.qx, b.qy, b.qz, b.qw);
    d.quat.copy(_qa).slerp(_qb, k).normalize();
}

// The same for a point that only moves (flaming pearls).
function pointAt(S, t, out) {
    const n = S.length;
    let a = S[0], b = a, k = 0;
    if (n > 1 && t > a.t) {
        let i = 1;
        while (i < n - 1 && S[i].t < t) i++;
        a = S[i - 1]; b = S[i];
        k = (Math.min(t, b.t + EXTRAP_MAX) - a.t) / (b.t - a.t);
    }
    out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
}

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
        this.clock = new ServerClock();
        this.ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws?room=' + encodeURIComponent(roomId));
        // caps: what this browser understands beyond the original protocol ('el': breath elements).
        this.ws.onopen = () => this.send({ t: 'hello', name, perks: extras.perks || [], skin: extras.skin || '', caps: ['el'] });
        this.ws.onmessage = (e) => { try { this.onMessage(JSON.parse(e.data)); } catch (err) { console.warn('net', err); } };
        this.ws.onclose = (e) => { if (!this.closing) hooks.onClose(this.fullError || (this.world ? 'Disconnected from the server' : 'Could not reach the server')); };
    }

    send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
    close() { this.closing = true; try { this.ws.close(); } catch { /* ignore */ } }
    takeEvents() { const e = this.events; this.events = []; return e; }
    // Only the game loop drains the queue, and a hidden tab doesn't run it.
    // So while hidden (or if the queue backs up) keep just what changes the
    // game — your own death and bites, folding wings — and drop the toasts,
    // sparks and sounds for everyone else, which would all play at once on
    // return (and each death holds on to a removed dragon).
    queue(e) {
        const keep = e.type === 'parking' || e.type === 'unparked' || e.type === 'parked'
            || ((e.type === 'death' || e.type === 'bite') && e.d === this.player);
        if (keep || !(document.hidden || this.events.length >= 200)) this.events.push(e);
    }
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
        if (!('fireCharge' in m.tune)) w.rules.fireCharge = 0;     // an older server: one dragonfire charge at a time…
        if (!('elements' in m.tune)) w.rules.elements = 0;         // …and only fire
        this.world = w; this.room = m.room; this.you = m.you;
        for (const d of m.dragons) this.dragonNew(d);
        const o = m.orbs;
        for (let k = 0; k < o.length; k += 7) this.setOrb(o[k], o[k + 1], o[k + 2], o[k + 3], o[k + 4], o[k + 5], o[k + 6]);
        this.setPowerups(m.pu);
        this.setPearls(m.pl, typeof m.time === 'number' ? m.time : 0);
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
        d.samples = []; d.pathT = -Infinity;          // snapshots to draw from; server time the tail is laid up to
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
        if (d !== this.player) { d.breath = f & 32 ? 0.5 : 0; d.magnet = f & 256 ? 1 : 0; d.chill = f & 512 ? 1 : 0; d.stun = f & 1024 ? 1 : 0; }
    }

    snapshot(m) {
        const w = this.world;
        if (!w) return;
        const now = performance.now() / 1000;
        // Server time. Its sim clock steps 1/30 s and tm is rounded to
        // 0.01 s; put back on the tick, the blend between snapshots runs at
        // an even speed (a time that isn't near a tick is taken as it is).
        let tm = now;
        if (typeof m.tm === 'number' && Number.isFinite(m.tm)) {
            tm = Math.round(m.tm * 30) / 30;
            if (Math.abs(tm - m.tm) > 0.006) tm = m.tm;
        }
        if (this.clock.note(tm, now)) for (const d of w.dragons) { d.samples = []; d.pathT = -Infinity; }   // the room restarted: a new timeline
        for (const s of m.d) {
            const d = w.byId.get(s[0]);
            if (!d) continue;
            this.applyState(d, s);
            if (d === this.player) continue;           // you fly yourself
            d.bankNet = s[11]; d.speed = s[12];
            const S = d.samples;
            if (S.length && tm <= S[S.length - 1].t) continue;
            S.push({ t: tm, x: s[1], y: s[2], z: s[3], qx: s[4], qy: s[5], qz: s[6], qw: s[7] });
            if (S.length > 30) S.shift();
        }
        for (const op of m.o) {
            if (op[0] === 0) this.clearOrb(op[1]);
            else this.setOrb(op[1], op[2], op[3], op[4], op[5], op[6], op[7]);
        }
        this.setPowerups(m.pu);
        w.clouds = Array.isArray(m.ac) ? m.ac.map((c) => ({ id: c[0], x: c[1], y: c[2], z: c[3], r: c[4], ttl: c[5], life: c[6] || 1, owner: c[7] })) : [];
        this.setPearls(m.pl, tm);
        this.humans = m.h;
        const me = m.me, p = this.player;
        if (me && p) {
            p.temp = me.temp; p.thrust = me.thrust; p.thrustLocked = !!me.lock;
            p.fire = me.fire; p.breath = me.breath; p.breathLevel = me.bl || 1; p.shield = me.shield; p.magnet = me.magnet;
            p.kills = me.kills; p.protect = me.protect; p.thrustMult = me.tm || 1;
            p.element = ELEMENTS.includes(me.el) ? me.el : 'fire'; p.chill = +me.ch || 0; p.stun = +me.st || 0;
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
                    this.queue({ type: 'death', d, killer: e.by ? this.dragon(e.by) : null, cause: e.cause });
                    break;
                }
                case 'sever': { const d = this.dragon(e.id), o = this.dragon(e.o); if (d && o) this.queue({ type: 'sever', d, o, burn: e.burn || [] }); break; }
                case 'fire': {
                    const d = this.dragon(e.id);
                    if (d) {
                        d.breathLevel = e.lv > 0 ? e.lv | 0 : 1; d.breathEl = ELEMENTS.includes(e.el) ? e.el : 'fire';
                        this.queue({ type: 'fireStart', d, lv: d.breathLevel, el: d.breathEl });
                    }
                    break;
                }
                // Ice and lightning take hold at once (the snapshot confirms it).
                case 'chill': {
                    const d = this.dragon(e.id), o = this.dragon(e.o);
                    if (!d || !o) break;
                    o.chill = Math.max(o.chill, o === p ? +e.t || 0 : 1);
                    this.queue({ type: 'chill', d, o, t: +e.t || 0 });
                    break;
                }
                case 'bolt': {
                    const d = this.dragon(e.id), hits = (Array.isArray(e.o) ? e.o : []).map((id) => this.dragon(id)).filter(Boolean);
                    if (!d) break;
                    for (const o of hits) o.stun = Math.max(o.stun, o === p ? +e.s || 0 : 1);
                    this.queue({ type: 'bolt', d, hits, pts: (Array.isArray(e.p) ? e.p : []).map(Number) });
                    break;
                }
                case 'acid': { const o = this.dragon(e.o); if (o) this.queue({ type: 'acid', d: this.dragon(e.id), o }); break; }
                case 'bite': {
                    const d = this.dragon(e.id), o = this.dragon(e.o);
                    if (d && o) this.queue({ type: 'bite', d, o, gain: e.g | 0, x: +e.x, y: +e.y, z: +e.z, color: o.color });
                    break;
                }
                case 'pearl': { const d = this.dragon(e.id); if (d) this.queue({ type: 'pearl', d, gain: e.g | 0, x: +e.x, y: +e.y, z: +e.z }); break; }
                case 'eat': this.queue({ type: 'eat', d: p }); break;
                case 'tier': this.queue({ type: 'tier', d: p, tier: e.tier | 0 }); break;
                case 'nm': this.queue({ type: 'nearMiss', d: p }); break;
                case 'pu': this.queue({ type: 'powerup', d: p, kind: e.kind, charge: e.n | 0 }); break;
                case 'shield': this.queue({ type: 'shieldPop', d: p }); break;
                case 'miss': this.queue({ type: 'fireMiss', d: p, el: ELEMENTS.includes(e.el) ? e.el : 'fire' }); break;
                case 'empty': this.queue({ type: 'thrustEmpty', d: p }); break;
                case 'parking': this.queue({ type: 'parking', in: +e.in || 3 }); break;
                case 'unparked': this.queue({ type: 'unparked' }); break;
                case 'parked': this.parked = true; if (p) p.alive = false; this.queue({ type: 'parked' }); break;
                case 'land': { const d = this.dragon(e.id); if (d && d !== p) this.queue({ type: 'land', d }); break; }
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

    // Flaming pearls (absent from older servers): kept by id, each with its
    // snapshots at server time tm, and drawn on the server's clock like the
    // dragons (update, pointAt).
    setPearls(list, tm) {
        if (!Array.isArray(list)) return;
        const w = this.world, old = new Map(w.pearls.map((p) => [p.id, p]));
        w.pearls = list.filter((q) => Array.isArray(q) && [q[1], q[2], q[3]].every(Number.isFinite)).slice(0, 16).map((q) => {
            const p = old.get(q[0]) || { id: q[0], pos: new Vector3(q[1], q[2], q[3]), samples: [] }, S = p.samples;
            if (S.length && tm < S[S.length - 1].t - 1) S.length = 0;                  // the room restarted
            if (!S.length || tm > S[S.length - 1].t) S.push({ t: tm, x: q[1], y: q[2], z: q[3] });
            if (S.length > 30) S.shift();
            return p;
        });
    }

    // Per frame: place other dragons along their snapshot timeline, send
    // your pose, keep an RTT estimate.
    update(dt) {
        const w = this.world;
        if (!w) return;
        this.clock.ease(dt);
        const rt = this.clock.drawTime(performance.now() / 1000);
        for (const d of w.dragons) {
            if (d === this.player || !d.alive || !d.samples || !d.samples.length) continue;
            const S = d.samples, newest = S[S.length - 1];
            // The tail goes through every snapshot the head has passed (even
            // ones skipped after a stall) and never along a guess past the
            // newest, so it keeps to the server's tail, the one that kills.
            const upTo = Math.min(rt, newest.t);
            for (const s of S) if (s.t > d.pathT && s.t <= upTo) { d.pos.set(s.x, s.y, s.z); w.recordPath(d); }
            d.pathT = Math.max(d.pathT, upTo);
            while (S.length > 2 && S[1].t <= d.pathT) S.shift();
            poseAt(S, rt, d);
            if (rt <= newest.t) w.recordPath(d);
            d.updateFrame(); d.vdir.copy(d.fwd);
            d.bank += ((d.bankNet || 0) - d.bank) * 0.3;
        }
        for (const q of w.pearls) {
            const S = q.samples;
            if (!S || !S.length) continue;
            while (S.length > 2 && S[1].t <= rt) S.shift();
            pointAt(S, rt, q.pos);
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
