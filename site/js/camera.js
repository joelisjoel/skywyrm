// Chase camera (spec §8): springy follow behind + above the head, pulls
// back as you grow, FOV kick on boost, partial roll with the bank.
// Also the death-cam orbit and the menu's attract orbit.
import * as THREE from 'three';
import { T } from './tunables.js?v=11';

const _v = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Quaternion();

export class ChaseCam {
    constructor(camera) {
        this.cam = camera;
        this.pos = new THREE.Vector3(0, 40, 80);
        this.up = new THREE.Vector3(0, 1, 0);
        this.look = new THREE.Vector3();
        this.fov = T.fov;
        this.orbitAngle = 0;
        this.reduceMotion = false;
    }

    snap(d) {
        this.pos.copy(d.pos).addScaledVector(d.fwd, -T.camDist).addScaledVector(d.up, T.camHeight);
        this.up.copy(d.up);
        this.look.copy(d.pos).addScaledVector(d.fwd, T.camLookAhead);
    }

    follow(d, dt, arena, lookBack) {
        const dist = Math.min(T.camDistMax, T.camDist + T.camDistPerLen * d.len);
        const dir = lookBack ? -1 : 1;
        _t.copy(d.pos).addScaledVector(d.fwd, -dist * dir).addScaledVector(d.up, T.camHeight);
        const kp = T.camPosTau > 0 ? 1 - Math.exp(-dt / T.camPosTau) : 1;
        this.pos.lerp(_t, lookBack ? 1 : kp);
        // Up: flight-frame up, rolled by a share of the cosmetic bank.
        _q.setFromAxisAngle(d.fwd, d.bank * T.camRollFollow * (this.reduceMotion ? 0.3 : 1));
        _u.copy(d.up).applyQuaternion(_q);
        const kr = T.camRotTau > 0 ? 1 - Math.exp(-dt / T.camRotTau) : 1;
        this.up.lerp(_u, kr).normalize();
        _v.copy(d.pos).addScaledVector(d.fwd, T.camLookAhead * dir);
        this.look.lerp(_v, lookBack ? 1 : Math.min(1, kr * 1.5));
        const fovTarget = d.boosting && !this.reduceMotion ? T.fovBoost : T.fov;
        this.fov += (fovTarget - this.fov) * (1 - Math.exp(-dt / 0.25));
        this.clamp(arena);
        this.apply();
    }

    deathOrbit(center, target, dt) {
        this.orbitAngle += dt * 0.9;
        _t.set(Math.cos(this.orbitAngle) * 16, 6, Math.sin(this.orbitAngle) * 16).add(center);
        this.pos.lerp(_t, 1 - Math.exp(-dt / 0.3));
        this.look.lerp(target || center, 1 - Math.exp(-dt / 0.2));
        this.up.lerp(_u.set(0, 1, 0), 0.05).normalize();
        this.fov += (T.fov - this.fov) * 0.1;
        this.apply();
    }

    attract(arena, dt) {
        this.orbitAngle += dt * 0.06;
        // Orbit the rich middle, where the action is.
        const R = arena.radius * 0.33;
        const c = arena.center;
        _t.set(Math.cos(this.orbitAngle) * R, arena.radius * 0.1, Math.sin(this.orbitAngle) * R).add(c);
        this.pos.lerp(_t, 0.05);
        this.look.lerp(c, 0.05);
        this.up.set(0, 1, 0);
        this.fov = T.fov;
        this.apply();
    }

    clamp(arena) {
        if (arena.kind === 'sphere') {
            const l = this.pos.length(), max = arena.radius - 1;
            if (l > max) this.pos.multiplyScalar(max / l);
        } else {
            const h = Math.hypot(this.pos.x, this.pos.z), max = arena.radius - 1;
            if (h > max) { this.pos.x *= max / h; this.pos.z *= max / h; }
            if (this.pos.y < arena.floor + 1) this.pos.y = arena.floor + 1;
        }
    }

    apply() {
        this.cam.position.copy(this.pos);
        this.cam.up.copy(this.up);
        this.cam.lookAt(this.look);
        if (Math.abs(this.cam.fov - this.fov) > 0.01) {
            this.cam.fov = this.fov;
            this.cam.updateProjectionMatrix();
        }
    }
}
