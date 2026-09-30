// Controls (spec §7). Mouse-flight: the cursor's offset from screen
// centre, inside a steering circle, is the stick. Optional pointer-lock
// "virtual stick" mode for players who don't want the cursor to escape.
// Touch: the first finger on the sky is the cursor (the dragon turns
// toward it; lift it to fly straight), a second finger boosts, and the
// on-screen buttons hold boost / brake / fire. Everything funnels into the
// same {sx, sy, …} struct.
import { T } from './tunables.js?v=12';

export class Input {
    constructor(canvas) {
        this.canvas = canvas;
        this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
        this.virt = { x: 0, y: 0 };        // pointer-lock virtual offset (px)
        // Neutral point (px from screen centre). Zeroed to wherever the
        // cursor is when you spawn, so you don't start mid-turn; it glides
        // back to the true centre as you move the mouse.
        this.neutral = { x: 0, y: 0 };
        this.keys = new Set();
        this.lmb = false; this.rmb = false;
        this.settings = { invertY: false, mouseLock: false };
        this.onKey = null;                 // (code, event) for one-shot keys
        this.touch = { id: null, extra: new Set(), last: -1e9, hold: { boost: false, brake: false, fire: false } };
        this.isTouch = matchMedia('(pointer: coarse)').matches;

        // ---- touch
        const touchSeen = () => {
            this.touch.last = performance.now();
            if (!this.isTouch) { this.isTouch = true; if (this.onTouchMode) this.onTouchMode(); }
        };
        addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') touchSeen(); }, true);
        canvas.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch') return;
            e.preventDefault();                           // no emulated mouse events, no scrolling
            if (this.touch.id === null) {
                this.touch.id = e.pointerId;
                this.neutral.x = this.neutral.y = 0;
                this.mouse.x = e.clientX; this.mouse.y = e.clientY;
            } else this.touch.extra.add(e.pointerId);    // a second finger boosts
        }, { passive: false });
        addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'touch') return;
            touchSeen();
            if (e.pointerId === this.touch.id) { this.mouse.x = e.clientX; this.mouse.y = e.clientY; }
        });
        const lift = (e) => {
            if (e.pointerType !== 'touch') return;
            touchSeen();
            if (e.pointerId === this.touch.id) {            // steering finger up: fly straight
                this.touch.id = null;
                this.mouse.x = innerWidth / 2; this.mouse.y = innerHeight / 2;
            }
            this.touch.extra.delete(e.pointerId);
        };
        addEventListener('pointerup', lift);
        addEventListener('pointercancel', lift);

        addEventListener('mousemove', (e) => {
            // Taps also send emulated mouse events; they mustn't steer.
            if (performance.now() - this.touch.last < 1000) return;
            if (document.pointerLockElement === canvas) {
                const s = T.lockSensitivity;
                this.virt.x += e.movementX * s; this.virt.y += e.movementY * s;
                const R = this.circleRadius(), m = Math.hypot(this.virt.x, this.virt.y);
                if (m > R) { this.virt.x *= R / m; this.virt.y *= R / m; }
            } else {
                this.mouse.x = e.clientX; this.mouse.y = e.clientY;
            }
            // Movement from successive positions (movementX isn't reliable everywhere).
            const mx = e.clientX - (this.lastX ?? e.clientX), my = e.clientY - (this.lastY ?? e.clientY);
            this.lastX = e.clientX; this.lastY = e.clientY;
            const moved = document.pointerLockElement === canvas ? Math.hypot(e.movementX, e.movementY) : Math.hypot(mx, my);
            const n = this.neutral, nm = Math.hypot(n.x, n.y);
            if (nm > 0) {
                const k = Math.max(0, 1 - 0.8 * moved / nm);
                n.x *= k; n.y *= k;
                if (Math.hypot(n.x, n.y) < 2) n.x = n.y = 0;
            }
        });
        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) this.lmb = true;
            if (e.button === 2) this.rmb = true;
        });
        addEventListener('mouseup', (e) => {
            if (e.button === 0) this.lmb = false;
            if (e.button === 2) this.rmb = false;
        });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        addEventListener('keydown', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
            if (!e.repeat && this.onKey) this.onKey(e.code, e);
            this.keys.add(e.code);
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
        });
        addEventListener('keyup', (e) => this.keys.delete(e.code));
        addEventListener('blur', () => { this.keys.clear(); this.lmb = this.rmb = false; });
    }

    circleRadius() { return T.steerCircle * Math.min(innerWidth, innerHeight); }

    // An on-screen button that counts as held while a finger is on it.
    holdButton(el, key) {
        const on = (e) => { e.preventDefault(); this.touch.hold[key] = true; el.classList.add('down'); };
        const off = () => { this.touch.hold[key] = false; el.classList.remove('down'); };
        el.addEventListener('pointerdown', on, { passive: false });
        for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, off);
        el.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    requestLock() {
        if (this.settings.mouseLock && this.canvas.requestPointerLock && document.pointerLockElement !== this.canvas) {
            try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* iframe may forbid */ }
        }
    }

    releaseLock() {
        if (document.pointerLockElement) document.exitPointerLock();
    }

    // Make the current cursor position the neutral (no-steer) point.
    zero() {
        this.virt.x = this.virt.y = 0;
        const r = this.rawReticle();
        this.neutral.x = r.x; this.neutral.y = r.y;
    }

    // Steering centre in px from screen centre (for the HUD circle).
    centre() { return this.neutral; }

    rawReticle() {
        if (document.pointerLockElement === this.canvas) return { x: this.virt.x, y: this.virt.y };
        return { x: this.mouse.x - innerWidth / 2, y: this.mouse.y - innerHeight / 2 };
    }

    // Raw reticle offset in px from screen centre (for the HUD).
    reticle() {
        if (document.pointerLockElement === this.canvas) return { x: this.virt.x, y: this.virt.y };
        return { x: this.mouse.x - innerWidth / 2, y: this.mouse.y - innerHeight / 2 };
    }

    // Stick from the reticle: circle clamp → deadzone → expo curve.
    read(out) {
        const R = this.circleRadius();
        const r = this.reticle();
        let x = (r.x - this.neutral.x) / R, y = -(r.y - this.neutral.y) / R;
        let m = Math.hypot(x, y);
        if (m > 1) { x /= m; y /= m; m = 1; }
        if (m < T.steerDeadzone) { x = 0; y = 0; }
        else {
            const mm = Math.pow((m - T.steerDeadzone) / (1 - T.steerDeadzone), T.steerExpo);
            x *= mm / m; y *= mm / m;
        }
        // Arrow keys override (trackpad fallback).
        const k = this.keys;
        const kx = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
        const ky = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
        // Invert pitch applies to the up/down keys only; the mouse always
        // points where you want to go.
        if (kx || ky) { x = kx * T.keySteer; y = (this.settings.invertY ? -ky : ky) * T.keySteer; }
        out.sx = x; out.sy = y;
        out.roll = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
        const h = this.touch.hold;
        out.boost = this.lmb || k.has('KeyW') || k.has('Space') || h.boost || this.touch.extra.size > 0;
        out.brake = this.rmb || k.has('KeyS') || h.brake;
        out.fire = k.has('KeyE') || k.has('KeyF') || h.fire;
        return out;
    }

    lookBack() { return this.keys.has('KeyC'); }
}
