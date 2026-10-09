// HUD (spec §8, §10.6): steering circle + reticle + nose marker, Elite-
// style radar, off-screen arrows for nearby heads, names, leaderboard,
// toasts, kill feed. Names only ever go through textContent / fillText.
import * as THREE from 'three';
import { T, TIERS, thrustCap, speedBonus } from './tunables.js?v=14';
import { MOOD_ICON } from './bots.js?v=14';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// Minimal status: ring gauges with line icons, no captions. Static SVG
// only (no user text goes through innerHTML).
const ICON = {
    temp: '<path d="M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0z"/><path d="M12 9v6"/>',
    thrust: '<path d="M13 2 5 13h6l-1 9 8-11h-6z"/>',
    fire: '<path d="M12 3c.6 3 4.5 5.2 4.5 10a4.5 4.5 0 0 1-9 0c0-2.4 1.3-3.8 2.4-4.8.1 1.7.9 2.8 2 3.2-.4-2.9-.8-5.2.1-8.4z"/>',
    shield: '<path d="M12 3.2 19 6v5.2c0 4.3-2.9 7.8-7 9.6-4.1-1.8-7-5.3-7-9.6V6z"/>',
    magnet: '<path d="M6 4h4v8a2 2 0 0 0 4 0V4h4v8a6 6 0 0 1-12 0z"/><path d="M6 8h4M14 8h4"/>',
};
const RING = 2 * Math.PI * 17;
function gauge(key) {
    const el = document.createElement('div');
    el.className = 'g g-' + key;
    el.innerHTML = '<svg class="ring" viewBox="0 0 40 40"><circle class="track" cx="20" cy="20" r="17"/><circle class="val" cx="20" cy="20" r="17"/></svg>'
        + '<svg class="icon" viewBox="0 0 24 24">' + ICON[key] + '</svg>';
    const val = el.querySelector('.val');
    val.style.strokeDasharray = RING;
    return { el, val, set(f) { val.style.strokeDashoffset = RING * (1 - Math.max(0, Math.min(1, f))); } };
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
            toasts: document.getElementById('toasts'),
            feed: document.getElementById('feed'),
            fps: document.getElementById('hud-fps'),
            warn: document.getElementById('hud-warn'),
        };
        this.g = {};
        const box = document.getElementById('hud-gauges');
        for (const k of ['temp', 'thrust', 'fire', 'shield', 'magnet']) { this.g[k] = gauge(k); box.appendChild(this.g[k].el); }
        this.g.fire.el.insertAdjacentHTML('beforeend', '<kbd>E</kbd>');
        this.lastBoard = 0;
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

    toast(text, cls = '') {
        const t = document.createElement('div');
        t.className = 'toast ' + cls;
        t.textContent = text;
        this.el.toasts.appendChild(t);
        setTimeout(() => t.remove(), 1600);
        while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
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
        const draw = (pos, color, crown, ring, pin) => {
            const l = _v.copy(pos).sub(p.pos).applyQuaternion(_q);
            let k = 1, dist = l.length();
            if (dist > range) { if (!crown && !ring && !pin) return; k = range / dist * 0.98; }
            const px = cx + l.x / range * rx * k, pz = cy + l.z / range * ry * k;
            const py = pz - l.y / range * ry * 1.3 * k;
            c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1.5;
            c.beginPath(); c.moveTo(px, pz); c.lineTo(px, py); c.stroke();
            if (ring) {
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
        // Power-ups by colour; red dragonfire crystals stay pinned to the rim.
        for (const pu of world.powerups) {
            draw(pu.pos, { fire: '#FF3A20', shield: '#FFB060', magnet: '#4D9BFF' }[pu.type], false, false, pu.type === 'fire');
        }
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
            const fast = Math.round((p.sizeBonus || 0) * 100);
            this.el.tier.textContent = fast >= 1 ? `${TIERS[t].name} · +${fast}% speed` : TIERS[t].name;
            const f = next ? (p.mass - TIERS[t].mass) / (next.mass - TIERS[t].mass) : 1;
            this.el.tierBar.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%';
            const g = this.g;
            // Body temp: ring fill + colour; faster when warm.
            g.temp.set(p.temp / 100);
            g.temp.el.style.color = tempColour(p.temp);
            g.temp.el.title = `${Math.round(p.temp)}° · +${Math.round(speedBonus(p.temp) * 100)}% speed`;
            // Thrust tank (red and pulsing while it recharges from empty).
            g.thrust.set(p.thrust / (thrustCap(p.temp) * (p.thrustMult || 1)));
            g.thrust.el.dataset.state = p.thrustLocked ? 'empty' : '';
            // Dragonfire: dim until you have it, glowing when ready, draining while you breathe.
            g.fire.el.dataset.state = p.breath > 0 ? 'breathing' : p.fire ? 'ready' : 'empty';
            g.fire.set(p.breath > 0 ? p.breath / T.fireTime : p.fire ? 1 : 0);
            // Timed power-ups appear only while active.
            g.shield.el.hidden = !(p.shield > 0);
            g.shield.set(p.shield / T.shieldTime);
            g.magnet.el.hidden = !(p.magnet > 0);
            g.magnet.set(p.magnet / T.magnetTime);
        }
        this.el.fps.textContent = fps ? fps + ' fps' : '';
        this.el.warn.style.opacity = view.wallWarn > 0.4 && view.state === 'play' ? '1' : '0';
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
