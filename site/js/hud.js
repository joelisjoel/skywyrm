// HUD (spec §8, §10.6): steering circle + reticle + nose marker, Elite-
// style radar, off-screen arrows for nearby heads, names, leaderboard,
// messages, kill feed. Names only ever go through textContent / fillText.
import * as THREE from 'three';
import { T, TIERS, thrustCap, speedBonus } from './tunables.js?v=25';
import { MOOD_ICON } from './bots.js?v=25';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
// Messages: ms on screen by kind (every other kind 1.6 s), and how many at once.
const MSG_LIFE = { hint: 3200, caption: 2800 };
const MSG_MAX = 4;

// Minimal status: ring gauges with line icons, no captions. Static SVG
// only (no user text goes through innerHTML).
const ICON = {
    temp: '<path d="M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0z"/><path d="M12 9v6"/>',
    thrust: '<path d="M13 2 5 13h6l-1 9 8-11h-6z"/>',
    fire: '<path d="M12 3c.6 3 4.5 5.2 4.5 10a4.5 4.5 0 0 1-9 0c0-2.4 1.3-3.8 2.4-4.8.1 1.7.9 2.8 2 3.2-.4-2.9-.8-5.2.1-8.4z"/>',
    shield: '<path d="M12 3.2 19 6v5.2c0 4.3-2.9 7.8-7 9.6-4.1-1.8-7-5.3-7-9.6V6z"/>',
    magnet: '<path d="M6 4h4v8a2 2 0 0 0 4 0V4h4v8a6 6 0 0 1-12 0z"/><path d="M6 8h4M14 8h4"/>',
    // Breath elements (the fire gauge and button wear the one you hold), and being chilled / stunned.
    ice: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
    bolt: '<path d="M7 15a4 4 0 1 1 1.2-7.8A5 5 0 0 1 17.7 8.5 3.3 3.3 0 0 1 17 15"/><path d="m12.5 12-2.5 4.5h4L11.5 21"/>',
    acid: '<path d="M12 3c3 4 6 7.4 6 11a6 6 0 0 1-12 0c0-3.6 3-7 6-11z"/><circle cx="10" cy="15" r="1.4"/><circle cx="13.6" cy="12.2" r="0.9"/>',
};
ICON.chill = ICON.ice; ICON.stun = ICON.bolt;
const EL_COLOR = { fire: '#FF3A20', ice: '#8FE6FF', bolt: '#C9A0FF', acid: '#7CFF4F' };
const RING = 2 * Math.PI * 17;
function gauge(key) {
    const el = document.createElement('div');
    el.className = 'g g-' + key;
    el.innerHTML = '<svg class="ring" viewBox="0 0 40 40"><circle class="track" cx="20" cy="20" r="17"/><circle class="val" cx="20" cy="20" r="17"/></svg>'
        + '<svg class="icon" viewBox="0 0 24 24">' + ICON[key] + '</svg>';
    const val = el.querySelector('.val'), track = el.querySelector('.track');
    val.style.strokeDasharray = RING;
    let cut = false;
    return {
        el, val,
        set(f) {
            if (cut) { cut = false; val.style.strokeDasharray = RING; track.style.strokeDasharray = ''; }
            val.style.strokeDashoffset = RING * (1 - Math.max(0, Math.min(1, f)));
        },
        // The ring cut into `n` arcs (slots), the first `on` lit: stacked dragonfire charges.
        slots(n, on) {
            const seg = RING / n, dash = `${seg - 7} 7`;
            cut = true;
            track.style.strokeDasharray = dash;
            // `on` arcs, then a gap round the rest (no zero-length dash: round caps would draw a dot).
            val.style.strokeDasharray = on > 0 ? `${(dash + ' ').repeat(on - 1)}${seg - 7} ${RING}` : RING;
            val.style.strokeDashoffset = on > 0 ? 0 : RING;
        },
    };
}
// Cool → warm → hot, Apple system colours.
function tempColour(t) {
    const stops = [[0, [100, 210, 255]], [45, [255, 214, 10]], [75, [255, 159, 10]], [100, [255, 69, 58]]];
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
            const [a, ca] = stops[i - 1], [b, cb] = stops[i], k = (t - a) / (b - a);
            return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * k)).join(',')})`;
        }
    }
    return 'rgb(255,69,58)';
}

export class Hud {
    constructor() {
        this.canvas = document.getElementById('overlay');
        this.ctx = this.canvas.getContext('2d');
        this.radar = document.getElementById('radar');
        this.rctx = this.radar.getContext('2d');
        this.el = {
            len: document.getElementById('hud-len'),
            kills: document.getElementById('hud-kills'),
            tier: document.getElementById('hud-tier'),
            tierBar: document.getElementById('hud-tierbar'),
            board: document.getElementById('board'),
            msgs: document.getElementById('msgs'),
            feed: document.getElementById('feed'),
            fps: document.getElementById('hud-fps'),
            warn: document.getElementById('hud-warn'),
            assist: document.getElementById('hud-assist'),
            mute: document.getElementById('mute-btn'),
        };
        this.g = {};
        const box = document.getElementById('hud-gauges');
        for (const k of ['temp', 'thrust', 'fire', 'shield', 'magnet', 'chill', 'stun']) { this.g[k] = gauge(k); box.appendChild(this.g[k].el); }
        this.g.fire.el.insertAdjacentHTML('beforeend', '<kbd>E</kbd>');
        this.tFire = document.getElementById('t-fire');
        this.fireIcon = this.g.fire.el.querySelector('.icon');
        this.fireEl = 'fire'; this.chillMax = 0; this.stunMax = 0;
        this.lastBoard = 0;
        // An upright phone stacks the radar above the stats, which grow when
        // timed gauges appear: style.css reads their height from --stats-h.
        const stats = document.getElementById('hud-stats');
        if (window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--stats-h', stats.offsetHeight + 'px')).observe(stats);
        this.resize();
    }

    resize() {
        const dpr = Math.min(devicePixelRatio || 1, 2);
        this.canvas.width = innerWidth * dpr; this.canvas.height = innerHeight * dpr;
        this.canvas.style.width = innerWidth + 'px'; this.canvas.style.height = innerHeight + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.radar.width = 220 * dpr; this.radar.height = 150 * dpr;
        this.rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Messages: every toast, tip and voice caption goes in one stack just
    // below the centre (#msgs), newest on top, so a new one always lands in
    // the same spot, right under the reticle, and older ones move down. The
    // stack's box ends above the radar (style.css, per layout), so what
    // doesn't fit, and anything past MSG_MAX, is dropped (fit). The status
    // lines (wall warning, steering you clear, reconnecting) sit in a row at its top.
    message(el, cls) {
        const life = MSG_LIFE[cls] || 1600, gone = () => el.remove();
        el.className = 'msg ' + cls;
        el.style.animationDuration = life + 'ms';
        el.addEventListener('animationend', gone);     // gone as it fades out, even when a slow frame delays timers
        setTimeout(gone, life + 1000);                 // a hidden tab doesn't run the animation
        this.el.msgs.querySelector('#msg-status').after(el);
        this.fit();
    }

    toast(text, cls = '') {
        const t = document.createElement('div');
        t.textContent = text;
        this.message(t, cls);
    }

    // The dragon's voice line: the characters, then pinyin and English. One at a time.
    caption(ph) {
        for (const c of this.el.msgs.querySelectorAll('.caption')) c.remove();
        const t = document.createElement('div'), zh = document.createElement('div'), say = document.createElement('div');
        zh.className = 'zh'; zh.textContent = ph.zh;
        say.className = 'say'; say.textContent = `${ph.py} · ${ph.en}`;
        t.append(zh, say);
        this.message(t, 'caption');
    }

    // Too many, or more than fit: tips go first, then voice captions, then
    // the rest, oldest first, and never the newest.
    fit() {
        const box = this.el.msgs, rank = (e) => (e.classList.contains('hint') ? 0 : e.classList.contains('caption') ? 1 : 2);
        for (;;) {
            const all = box.querySelectorAll(':scope > .msg');
            if (all.length < 2 || (all.length <= MSG_MAX && box.scrollHeight <= box.clientHeight + 1)) return;
            let out = all[all.length - 1];
            for (let i = all.length - 2; i > 0; i--) if (rank(all[i]) < rank(out)) out = all[i];
            out.remove();
        }
    }

    // A status line, shown while `on`.
    status(el, on) {
        if (el.hidden !== on) return;
        el.hidden = !on;
        if (on) this.fit();
    }

    // Speaker button: the icon follows the mute state; `flash` (M or a tap)
    // also shows "Sound off / on" beside it for a moment, on any screen.
    setMuted(m, flash) {
        const b = this.el.mute, f = b.querySelector('.flash');
        b.setAttribute('aria-pressed', String(m));
        b.title = m ? 'Sound off: unmute (M)' : 'Mute sound (M)';
        if (!flash) return;
        f.textContent = m ? 'Sound off' : 'Sound on';
        f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
    }

    feed(text) {
        const t = document.createElement('div');
        t.textContent = text;
        this.el.feed.appendChild(t);
        setTimeout(() => t.remove(), 4500);
        while (this.el.feed.children.length > 4) this.el.feed.firstChild.remove();
    }

    clearOverlay() { this.ctx.clearRect(0, 0, innerWidth, innerHeight); }

    draw(world, view, renderer, input, now) {
        const camera = renderer.camera, pr = this._pr || (this._pr = { x: 0, y: 0, on: false });
        const ctx = this.ctx, W = innerWidth, H = innerHeight, cx = W / 2, cy = H / 2;
        ctx.clearRect(0, 0, W, H);
        const p = view.player;
        const playing = view.state === 'play' && p && p.alive;

        // Names over nearby dragons (within 50 m, on screen).
        ctx.font = '600 12px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        for (const d of world.dragons) {
            if (!d.alive || d === p) continue;
            const dist = camera.position.distanceTo(d.pos);
            if (dist > 50) continue;
            renderer.project(d.pos, pr);
            if (!pr.on) continue;
            const sx = pr.x, sy = pr.y;
            ctx.globalAlpha = Math.min(1, (50 - dist) / 15);
            ctx.fillStyle = '#fff';
            ctx.fillText(d.mood && MOOD_ICON[d.mood] ? MOOD_ICON[d.mood] + ' ' + d.name : d.name, sx, sy - 14 - 60 / Math.max(4, dist));
        }
        ctx.globalAlpha = 1;
        // Rear-view mirror frame.
        const mr = renderer.mirrorPx();
        if (mr && view.state !== 'menu') {
            ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.roundRect(mr.x, mr.y, mr.w, mr.h, 8); ctx.stroke();
            ctx.font = '700 10px Nunito, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.textAlign = 'center'; ctx.fillText('REAR', mr.x + mr.w / 2, mr.y + mr.h + 12);
        }
        if (!playing) return;

        // Steering circle, reticle, nose marker (Freelancer-style, spec §7).
        const R = input.circleRadius();
        const nc = input.centre(), ncx = cx + nc.x, ncy = cy + nc.y;   // steering centre (drifts home after spawn)
        ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ncx, ncy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(ncx, ncy, R * T.steerDeadzone, 0, Math.PI * 2); ctx.stroke();
        const r = input.reticle();
        let rx = r.x - nc.x, ry = r.y - nc.y;
        const rm = Math.hypot(rx, ry);
        if (rm > R) { rx *= R / rm; ry *= R / rm; }
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath(); ctx.moveTo(ncx, ncy); ctx.lineTo(ncx + rx, ncy + ry); ctx.stroke();
        ctx.strokeStyle = '#FFD93D'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ncx + rx, ncy + ry, 9, 0, Math.PI * 2); ctx.stroke();
        renderer.project(_v.copy(p.pos).addScaledVector(p.vdir, 40), pr);
        if (pr.on) {
            const nx = pr.x, ny = pr.y;
            ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(nx - 7, ny); ctx.lineTo(nx - 3, ny); ctx.moveTo(nx + 3, ny); ctx.lineTo(nx + 7, ny);
            ctx.moveTo(nx, ny - 7); ctx.lineTo(nx, ny - 3); ctx.moveTo(nx, ny + 3); ctx.lineTo(nx, ny + 7);
            ctx.stroke();
        }

        // Off-screen arrows for enemy heads within 30 m (spec §8).
        _q.copy(camera.quaternion).invert();
        for (const d of world.dragons) {
            if (!d.alive || d === p) continue;
            const dist = d.pos.distanceTo(p.pos);
            if (dist > 30) continue;
            renderer.project(d.pos, pr);
            if (pr.on && pr.x > 20 && pr.x < W - 20 && pr.y > 20 && pr.y < H - 20) continue;
            const l = _v.copy(d.pos).sub(camera.position).applyQuaternion(_q);
            const ang = Math.atan2(-l.y, l.x);
            const ex = cx + Math.cos(ang) * (Math.min(W, H) * 0.42), ey = cy + Math.sin(ang) * (Math.min(W, H) * 0.42);
            const a = 1 - dist / 30;
            ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang);
            ctx.globalAlpha = 0.35 + 0.65 * a;
            ctx.fillStyle = hex(d.color);
            ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -9); ctx.lineTo(-6, 9); ctx.closePath(); ctx.fill();
            ctx.restore();
        }
        ctx.globalAlpha = 1;
        this.drawRadar(world, view, now);
    }

    // Elite-style scanner: ellipse = your wing plane, stalks = above/below.
    drawRadar(world, view, now) {
        const c = this.rctx, W = 220, H = 150, cx = W / 2, cy = H / 2 + 8, rx = 95, ry = 50, range = 60;
        const p = view.player;
        c.clearRect(0, 0, W, H);
        c.fillStyle = 'rgba(11,15,26,0.55)';
        c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(160,190,255,0.35)'; c.lineWidth = 1;
        c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.ellipse(cx, cy, rx / 2, ry / 2, 0, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.moveTo(cx - rx, cy); c.lineTo(cx + rx, cy); c.moveTo(cx, cy - ry); c.lineTo(cx, cy + ry); c.stroke();
        _q.copy(p.quat).invert();
        const draw = (pos, color, crown, ring, pin, pearl) => {
            const l = _v.copy(pos).sub(p.pos).applyQuaternion(_q);
            let k = 1, dist = l.length();
            if (dist > range) { if (!crown && !ring && !pin) return; k = range / dist * 0.98; }
            const px = cx + l.x / range * rx * k, pz = cy + l.z / range * ry * k;
            const py = pz - l.y / range * ry * 1.3 * k;
            c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1.5;
            c.beginPath(); c.moveTo(px, pz); c.lineTo(px, py); c.stroke();
            if (pearl) {
                c.beginPath(); c.arc(px, py, 3.5, 0, Math.PI * 2); c.fill();
                c.strokeStyle = 'rgba(255,170,60,0.9)'; c.lineWidth = 1.5;
                c.beginPath(); c.arc(px, py, 6, 0, Math.PI * 2); c.stroke();
            } else if (ring) {
                c.lineWidth = 2; c.beginPath(); c.arc(px, py, 5, 0, Math.PI * 2); c.stroke();
            } else if (crown) {
                c.font = '14px system-ui'; c.textAlign = 'center'; c.fillText('👑', px, py - 2);
            } else {
                c.beginPath(); c.arc(px, py, 3.5, 0, Math.PI * 2); c.fill();
            }
        };
        for (const d of world.dragons) {
            if (!d.alive || d === p) continue;
            draw(d.pos, hex(d.color), false);
        }
        // Power-ups by colour; breath crystals (fire, ice, lightning, acid) stay pinned to the rim.
        for (const pu of world.powerups) {
            draw(pu.pos, EL_COLOR[pu.type] || { shield: '#FFB060', magnet: '#4D9BFF' }[pu.type] || '#fff', false, false, !!EL_COLOR[pu.type]);
        }
        // Acid clouds: green rings, so you can fly round them.
        for (const c of world.clouds || []) draw(_v2.set(c.x, c.y, c.z), 'rgba(124,255,79,0.85)', false, true);
        // Flaming pearls: a white dot in a gold ring, always shown (on the rim when far).
        for (const pl of world.pearls) draw(pl.pos, '#FFF6E0', false, false, true, true);
        // The rich middle: a ring that sits on the rim when it's out of range.
        draw(world.arena.center, 'rgba(255,224,138,0.9)', false, true);
        if (view.top && view.top !== p) draw(view.top.pos, '#FFD93D', true);
        // You.
        c.fillStyle = '#fff';
        c.beginPath(); c.moveTo(cx, cy - 6); c.lineTo(cx - 4, cy + 4); c.lineTo(cx + 4, cy + 4); c.closePath(); c.fill();
    }

    updateStats(world, view, now, fps) {
        const p = view.player;
        if (p) {
            this.el.len.textContent = Math.round(p.shownLen || p.len);
            const L = view.lives, key = L ? L.total + '/' + L.left : '';
            if (key !== this.livesKey) {
                this.livesKey = key;
                const box = document.getElementById('hud-lives');
                box.textContent = '';
                if (L) for (let i = 0; i < L.total; i++) { const s = document.createElement('span'); if (i >= L.left) s.className = 'used'; box.appendChild(s); }
            }
            this.el.kills.textContent = p.kills ? '⚔ ' + p.kills : '';
            const t = p.tier, next = TIERS[t + 1];
            // Overall speed: length reward and heat together, as a multiple.
            this.el.tier.textContent = `${TIERS[t].name} · ${(p.speedX || 1).toFixed(1)}× speed`;
            const f = next ? (p.mass - TIERS[t].mass) / (next.mass - TIERS[t].mass) : 1;
            this.el.tierBar.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%';
            const g = this.g;
            // Body temp: ring fill + colour; faster when warm.
            g.temp.set(p.temp / 100);
            g.temp.el.style.color = tempColour(p.temp);
            g.temp.el.title = `${Math.round(p.temp)}° · heat adds ${speedBonus(p.temp).toFixed(2)}× speed`;
            // Thrust tank (red and pulsing while it recharges from empty).
            g.thrust.set(p.thrust / (thrustCap(p.temp) * (p.thrustMult || 1)));
            g.thrust.el.dataset.state = p.thrustLocked ? 'empty' : '';
            // Dragonfire: dim until you have it, glowing when ready, draining while you breathe.
            // Charges stack (rule fireCharge): the ring is cut into one arc
            // per slot, lit for each charge held, and the gauge grows and
            // glows brighter with every one; phones show the count too.
            // It wears the element you hold (rule elements): icon and colour.
            const max = world.rule('fireCharge') ? Math.max(1, Math.round(world.rule('fireChargeMax'))) : 1;
            const charge = Math.min(max, p.fire | 0), breathing = p.breath > 0;
            const el = !world.rule('elements') ? 'fire' : breathing ? p.breathEl || 'fire' : charge ? p.element || 'fire' : 'fire';
            if (el !== this.fireEl && ICON[el]) {
                this.fireEl = el;
                this.fireIcon.innerHTML = ICON[el];
                g.fire.el.dataset.el = el;
                if (this.tFire) { this.tFire.dataset.el = el; this.tFire.querySelector('svg').innerHTML = ICON[el]; }
            }
            g.fire.el.dataset.state = breathing ? 'breathing' : charge ? 'ready' : 'empty';
            if (breathing || max < 2) g.fire.set(breathing ? p.breath / world.breathStats(p.breathLevel || 1).time : charge);
            else g.fire.slots(max, charge);
            g.fire.el.style.setProperty('--ch', breathing ? Math.min(max, p.breathLevel || 1) : charge);
            const badge = max > 1 && charge ? String(charge) : '';
            if (this.tFire && this.tFire.dataset.charge !== badge) this.tFire.dataset.charge = badge;
            // Timed power-ups appear only while active.
            g.shield.el.hidden = !(p.shield > 0);
            g.shield.set(p.shield / T.shieldTime);
            g.magnet.el.hidden = !(p.magnet > 0);
            g.magnet.set(p.magnet / T.magnetTime);
            // Chilled (ice) or stunned (lightning): a draining gauge while it lasts.
            this.chillMax = p.chill > 0 ? Math.max(this.chillMax, p.chill) : 0;
            this.stunMax = p.stun > 0 ? Math.max(this.stunMax, p.stun) : 0;
            g.chill.el.hidden = !(p.chill > 0);
            g.chill.set(p.chill / (this.chillMax || 1));
            g.stun.el.hidden = !(p.stun > 0);
            g.stun.set(p.stun / (this.stunMax || 1));
        }
        this.el.fps.textContent = fps ? fps + ' fps' : '';
        const flying = view.state === 'play' && !!p && p.alive;
        this.status(this.el.warn, flying && view.wallWarn > 0.4);
        this.status(this.el.assist, flying && p.assisting > 0.25);
        if (now - this.lastBoard < 0.25) return;
        this.lastBoard = now;
        const lb = view.board || [];
        const b = this.el.board;
        b.textContent = '';
        const rows = lb.slice(0, 10);
        const rank = p ? lb.indexOf(p) : -1;
        const add = (d, i) => {
            const row = document.createElement('div');
            row.className = 'row' + (d === p ? ' me' : '');
            const n = document.createElement('span'); n.className = 'n'; n.textContent = i === 0 ? '👑' : String(i + 1);
            const name = document.createElement('span'); name.className = 'name'; name.textContent = d.name;
            name.style.color = d === p ? '#fff' : hex(d.color);
            const len = document.createElement('span'); len.className = 'v'; len.textContent = Math.round(d.shownLen || d.len) + ' m';
            row.append(n, name, len);
            b.appendChild(row);
        };
        rows.forEach(add);
        if (rank >= 10) add(p, rank);
        // Footer: everyone in the sky right now (you + bots).
        const total = document.createElement('div');
        total.className = 'total';
        total.textContent = `${lb.length} in the sky` + (view.humans ? ` · ${view.humans} human${view.humans === 1 ? '' : 's'}` : '');
        b.appendChild(total);
    }
}
