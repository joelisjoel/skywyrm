// HUD (spec §8, §10.6): steering circle + reticle + nose marker, Elite-
// style radar, off-screen arrows for nearby heads, names, leaderboard,
// toasts, kill feed. Names only ever go through textContent / fillText.
import * as THREE from 'three';
import { T, TIERS } from './tunables.js?v=1';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

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
            pu: document.getElementById('hud-pu'),
            fps: document.getElementById('hud-fps'),
            warn: document.getElementById('hud-warn'),
        };
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

    draw(world, view, camera, input, now) {
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
            _v.copy(d.pos).project(camera);
            if (_v.z > 1) continue;
            const sx = (_v.x + 1) / 2 * W, sy = (1 - _v.y) / 2 * H;
            ctx.globalAlpha = Math.min(1, (50 - dist) / 15);
            ctx.fillStyle = '#fff';
            ctx.fillText(d.name, sx, sy - 14 - 60 / Math.max(4, dist));
        }
        ctx.globalAlpha = 1;
        if (!playing) return;

        // Steering circle, reticle, nose marker (Freelancer-style, spec §7).
        const R = input.circleRadius();
        ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, R * T.steerDeadzone, 0, Math.PI * 2); ctx.stroke();
        const r = input.reticle();
        const rm = Math.hypot(r.x, r.y), rx = rm > R ? r.x * R / rm : r.x, ry = rm > R ? r.y * R / rm : r.y;
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + rx, cy + ry); ctx.stroke();
        ctx.strokeStyle = '#FFD93D'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx + rx, cy + ry, 9, 0, Math.PI * 2); ctx.stroke();
        _v.copy(p.pos).addScaledVector(p.vdir, 40).project(camera);
        if (_v.z < 1) {
            const nx = (_v.x + 1) / 2 * W, ny = (1 - _v.y) / 2 * H;
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
            _v.copy(d.pos).project(camera);
            const on = _v.z < 1 && Math.abs(_v.x) < 0.95 && Math.abs(_v.y) < 0.95;
            if (on) continue;
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
        const draw = (pos, color, crown) => {
            const l = _v.copy(pos).sub(p.pos).applyQuaternion(_q);
            let k = 1, dist = l.length();
            if (dist > range) { if (!crown) return; k = range / dist * 0.98; }
            const px = cx + l.x / range * rx * k, pz = cy + l.z / range * ry * k;
            const py = pz - l.y / range * ry * 1.3 * k;
            c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1.5;
            c.beginPath(); c.moveTo(px, pz); c.lineTo(px, py); c.stroke();
            if (crown) {
                c.font = '14px system-ui'; c.textAlign = 'center'; c.fillText('👑', px, py - 2);
            } else {
                c.beginPath(); c.arc(px, py, 3.5, 0, Math.PI * 2); c.fill();
            }
        };
        for (const d of world.dragons) {
            if (!d.alive || d === p) continue;
            draw(d.pos, hex(d.color), false);
        }
        for (const pu of world.powerups) draw(pu.pos, '#ffffff', false);
        if (view.top && view.top !== p && view.top.mass >= TIERS[2].mass) draw(view.top.pos, '#FFD93D', true);
        // You.
        c.fillStyle = '#fff';
        c.beginPath(); c.moveTo(cx, cy - 6); c.lineTo(cx - 4, cy + 4); c.lineTo(cx + 4, cy + 4); c.closePath(); c.fill();
    }

    updateStats(world, view, now, fps) {
        const p = view.player;
        if (p) {
            this.el.len.textContent = Math.round(p.shownLen || p.len) + ' m';
            this.el.kills.textContent = '⚔ ' + p.kills;
            const t = p.tier, next = TIERS[t + 1];
            this.el.tier.textContent = TIERS[t].name.toUpperCase() + (next ? ' → ' + next.name : '');
            const f = next ? (p.mass - TIERS[t].mass) / (next.mass - TIERS[t].mass) : 1;
            this.el.tierBar.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%';
            const pu = [];
            if (p.shield > 0) pu.push('🛡 ' + Math.ceil(p.shield) + 's');
            if (p.magnet > 0) pu.push('🧲 ' + Math.ceil(p.magnet) + 's');
            if (p.fire) pu.push('🔥 ready — E');
            this.el.pu.textContent = pu.join('   ');
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
            const n = document.createElement('span'); n.className = 'n'; n.textContent = (i + 1) + (i === 0 ? ' 👑' : '');
            const name = document.createElement('span'); name.className = 'name'; name.textContent = d.name;
            name.style.color = d === p ? '#fff' : hex(d.color);
            const len = document.createElement('span'); len.className = 'v'; len.textContent = Math.round(d.shownLen || d.len) + ' m';
            row.append(n, name, len);
            b.appendChild(row);
        };
        rows.forEach(add);
        if (rank >= 10) add(p, rank);
    }
}
