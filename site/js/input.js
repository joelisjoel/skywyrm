// PC controls (spec §7). Mouse-flight: the cursor's offset from screen
// centre, inside a steering circle, is the stick. Optional pointer-lock
// "virtual stick" mode for players who don't want the cursor to escape.
// Touch comes later; everything funnels into the same {sx, sy, …} struct.
import { T } from './tunables.js?v=1';

export class Input {
    constructor(canvas) {
        this.canvas = canvas;
        this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
        this.virt = { x: 0, y: 0 };        // pointer-lock virtual offset (px)
        this.keys = new Set();
        this.lmb = false; this.rmb = false;
        this.settings = { invertY: false, mouseLock: false };
        this.onKey = null;                 // (code, event) for one-shot keys

        addEventListener('mousemove', (e) => {
            if (document.pointerLockElement === canvas) {
                const s = T.lockSensitivity;
                this.virt.x += e.movementX * s; this.virt.y += e.movementY * s;
                const R = this.circleRadius(), m = Math.hypot(this.virt.x, this.virt.y);
                if (m > R) { this.virt.x *= R / m; this.virt.y *= R / m; }
            } else {
                this.mouse.x = e.clientX; this.mouse.y = e.clientY;
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

    requestLock() {
        if (this.settings.mouseLock && this.canvas.requestPointerLock && document.pointerLockElement !== this.canvas) {
            try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* iframe may forbid */ }
        }
    }

    releaseLock() {
        if (document.pointerLockElement) document.exitPointerLock();
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
        let x = r.x / R, y = -r.y / R;
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
        if (kx || ky) { x = kx * T.keySteer; y = ky * T.keySteer; }
        if (this.settings.invertY) y = -y;
        out.sx = x; out.sy = y;
        out.roll = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
        out.boost = this.lmb || k.has('KeyW') || k.has('Space');
        out.brake = this.rmb || k.has('KeyS');
        out.fire = k.has('KeyE') || k.has('KeyF');
        return out;
    }

    lookBack() { return this.keys.has('KeyC'); }
}
