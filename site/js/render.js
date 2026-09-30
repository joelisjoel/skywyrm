// Minimal renderer: the prototype is about feel, not looks (spec §10 is
// deliberately skipped). Everything that moves is instanced; the arena is
// wireframe + fog + drifting dust so speed and depth read clearly.
import * as THREE from 'three';
import { T, TIERS } from './tunables.js?v=1';

const MAX_BEADS = 24000;
const MAX_ORBS = 6000;
const MAX_HEADS = 80;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color(), _white = new THREE.Color(0xffffff);
const Zaxis = new THREE.Vector3(0, 0, 1);

export class Renderer {
    constructor(canvas) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(T.fov, 1, 0.1, 2000);
        this.scene.add(new THREE.HemisphereLight(0xdde6ff, 0x302040, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4);
        sun.position.set(40, 80, 30);
        this.scene.add(sun);

        // Bodies: every bead of every dragon in one instanced mesh.
        this.beads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
            new THREE.MeshLambertMaterial(), MAX_BEADS);
        this.beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.beads.setColorAt(0, _white);
        this.beads.frustumCulled = false;
        this.scene.add(this.beads);
        // Your own body: its own translucent mesh so you can see through it.
        this.ownBeads = new THREE.InstancedMesh(this.beads.geometry,
            new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.45, depthWrite: false }), 1000);
        this.ownBeads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.ownBeads.setColorAt(0, _white);
        this.ownBeads.frustumCulled = false;
        this.ownBeads.renderOrder = 2;
        this.scene.add(this.ownBeads);

        // Orbs: unlit so they glow.
        this.orbs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
            new THREE.MeshBasicMaterial(), MAX_ORBS);
        this.orbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.orbs.setColorAt(0, _white);
        this.orbs.frustumCulled = false;
        this.scene.add(this.orbs);

        // Blob shadows (altitude cue, spec §8).
        this.shadows = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }), MAX_HEADS);
        this.shadows.frustumCulled = false;
        this.scene.add(this.shadows);

        this.heads = new Map();           // dragon id → head group
        this.headGeo = new THREE.SphereGeometry(1, 16, 12);
        this.eyeGeo = new THREE.SphereGeometry(1, 10, 8);
        this.hornGeo = new THREE.ConeGeometry(0.25, 1, 6);
        this.wingGeo = new THREE.BufferGeometry();
        this.wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.6, 0, 0, 0.8, 2.4, 0, 0.9], 3));
        this.wingGeo.computeVertexNormals();
        this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
        this.hornMat = new THREE.MeshLambertMaterial({ color: 0xf2e6c8 });

        // Power-up crystals.
        this.puGeo = new THREE.OctahedronGeometry(1.3, 0);
        this.puMats = {
            shield: new THREE.MeshBasicMaterial({ color: 0xFF9A3C, wireframe: false }),
            magnet: new THREE.MeshBasicMaterial({ color: 0x3DE0FF }),
            fire: new THREE.MeshBasicMaterial({ color: 0xFF4D4D }),
        };
        this.puMeshes = [];

        // The Beacon over the #1 dragon.
        this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 400, 12, 1, true),
            new THREE.MeshBasicMaterial({ color: 0xFFD93D, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        this.scene.add(this.beacon);

        // Shield bubble / magnet ring for the player.
        this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14),
            new THREE.MeshBasicMaterial({ color: 0xFF9A3C, transparent: true, opacity: 0.1, depthWrite: false }));
        this.scene.add(this.bubble);

        // Fire bursts (short-lived particle clouds).
        this.fireGeo = new THREE.BufferGeometry();
        this.fireGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(600 * 3), 3));
        this.fire = new THREE.Points(this.fireGeo, new THREE.PointsMaterial({ color: 0xFF7A2A, size: 0.6, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.fire.frustumCulled = false;
        this.scene.add(this.fire);
        this.fireParts = [];

        // Speed dust: a box of motes wrapped around the camera.
        const N = 1800, dust = new Float32Array(N * 3);
        for (let i = 0; i < N * 3; i++) dust[i] = (Math.random() - 0.5) * 70;
        this.dustBase = dust.slice();
        this.dustGeo = new THREE.BufferGeometry();
        this.dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dust, 3));
        this.dust = new THREE.Points(this.dustGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false }));
        this.dust.frustumCulled = false;
        this.scene.add(this.dust);

        this.arenaGroup = null;
        this.resize();
    }

    resize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    // ------------------------------------------------ arena visuals
    buildArena(arena) {
        if (this.arenaGroup) { this.scene.remove(this.arenaGroup); disposeTree(this.arenaGroup); }
        const g = this.arenaGroup = new THREE.Group();
        this.wallMats = [];
        if (arena.kind === 'cylinder') {
            this.scene.background = new THREE.Color(0x1b1740);
            this.scene.fog = new THREE.Fog(0x2a1f55, 60, 230);
            g.add(skyDome(0x0d0b2e, 0x3a2470, 0xff7a4a));
            // Cloud sea: flat plane + grid for motion reference.
            const floor = new THREE.Mesh(new THREE.CircleGeometry(arena.radius * 4, 64),
                new THREE.MeshLambertMaterial({ color: 0x6f5aa8 }));
            floor.rotation.x = -Math.PI / 2; floor.position.y = arena.floor - 0.05;
            g.add(floor);
            const grid = new THREE.GridHelper(arena.radius * 8, Math.round(arena.radius * 8 / 6), 0xb9a8ff, 0x9c86e8);
            grid.position.y = arena.floor + 0.02;
            grid.material.transparent = true; grid.material.opacity = 0.35;
            g.add(grid);
            // Storm wall: vertical lines + rings, brightens as you approach.
            const pts = [];
            const R = arena.radius, H = arena.ceiling;
            for (let k = 0; k < 72; k++) {
                const a = k / 72 * Math.PI * 2;
                pts.push(Math.cos(a) * R, arena.floor, Math.sin(a) * R, Math.cos(a) * R, H, Math.sin(a) * R);
            }
            for (let y = 0; y <= H; y += 10) {
                for (let k = 0; k < 72; k++) {
                    const a0 = k / 72 * Math.PI * 2, a1 = (k + 1) / 72 * Math.PI * 2;
                    pts.push(Math.cos(a0) * R, y, Math.sin(a0) * R, Math.cos(a1) * R, y, Math.sin(a1) * R);
                }
            }
            g.add(this.wallLines(pts, 0x9fe8ff));
            const wallSurf = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 72, 1, true),
                new THREE.MeshBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.05, side: THREE.BackSide, depthWrite: false }));
            wallSurf.position.y = H / 2;
            g.add(wallSurf);
            this.wallMats.push(wallSurf.material);
            // Castle rock + spire.
            const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a7fa6 });
            for (const o of arena.obstacles) {
                if (o.type === 'sphere') {
                    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(o.r, 1), rockMat);
                    m.position.copy(o.c); g.add(m);
                } else {
                    const len = o.b.distanceTo(o.a);
                    const m = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, len, 16), new THREE.MeshLambertMaterial({ color: 0xd8cdea }));
                    m.position.copy(o.a).lerp(o.b, 0.5); g.add(m);
                    const cap = new THREE.Mesh(new THREE.ConeGeometry(o.r * 1.6, o.r * 4, 16), new THREE.MeshLambertMaterial({ color: 0xff6b8a }));
                    cap.position.copy(o.b).y += o.r * 1.5; g.add(cap);
                }
            }
        } else {
            this.scene.background = new THREE.Color(0x07060f);
            this.scene.fog = new THREE.Fog(0x07060f, 50, 190);
            const R = arena.radius;
            // Shell: latitude/longitude lines.
            const pts = [];
            const seg = 64;
            for (let lat = -80; lat <= 80; lat += 10) {
                const phi = lat * Math.PI / 180, rr = Math.cos(phi) * R, y = Math.sin(phi) * R;
                for (let k = 0; k < seg; k++) {
                    const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
                    pts.push(Math.cos(a0) * rr, y, Math.sin(a0) * rr, Math.cos(a1) * rr, y, Math.sin(a1) * rr);
                }
            }
            for (let lon = 0; lon < 360; lon += 10) {
                const th = lon * Math.PI / 180;
                for (let k = 0; k < seg / 2; k++) {
                    const p0 = -Math.PI / 2 + k / (seg / 2) * Math.PI, p1 = -Math.PI / 2 + (k + 1) / (seg / 2) * Math.PI;
                    pts.push(Math.cos(p0) * Math.cos(th) * R, Math.sin(p0) * R, Math.cos(p0) * Math.sin(th) * R,
                        Math.cos(p1) * Math.cos(th) * R, Math.sin(p1) * R, Math.cos(p1) * Math.sin(th) * R);
                }
            }
            g.add(this.wallLines(pts, 0x3de0ff));
            const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32),
                new THREE.MeshBasicMaterial({ color: 0x3de0ff, transparent: true, opacity: 0.04, side: THREE.BackSide, depthWrite: false }));
            g.add(shell);
            this.wallMats.push(shell.material);
            // The Heart.
            const heart = new THREE.Mesh(new THREE.SphereGeometry(arena.obstacles[0].r, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
            g.add(heart);
            const glow = new THREE.Mesh(new THREE.SphereGeometry(arena.obstacles[0].r * 1.8, 24, 16),
                new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false }));
            g.add(glow);
            const light = new THREE.PointLight(0xffd9a0, 900, 0, 1.6);
            g.add(light);
            // Distant stars.
            const sp = [];
            for (let i = 0; i < 1500; i++) {
                const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(600 + Math.random() * 300);
                sp.push(v.x, v.y, v.z);
            }
            const sg = new THREE.BufferGeometry();
            sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
            const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, fog: false }));
            g.add(stars);
        }
        this.scene.add(g);
    }

    wallLines(pts, color) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.15, fog: false });
        this.wallMats.push(mat);
        return new THREE.LineSegments(geo, mat);
    }

    // ------------------------------------------------ heads
    headFor(d) {
        let h = this.heads.get(d.id);
        if (h) return h;
        const g = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: d.color });
        const skull = new THREE.Mesh(this.headGeo, mat);
        skull.scale.set(1.1, 0.85, 1.55);
        g.add(skull);
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(this.eyeGeo, this.eyeMat);
            eye.scale.setScalar(0.32); eye.position.set(0.5 * sx, 0.38, -0.75);
            const pupil = new THREE.Mesh(this.eyeGeo, this.pupilMat);
            pupil.scale.setScalar(0.17); pupil.position.set(0.56 * sx, 0.44, -0.97);
            g.add(eye, pupil);
            const horn = new THREE.Mesh(this.hornGeo, this.hornMat);
            horn.position.set(0.45 * sx, 0.75, 0.3); horn.rotation.x = -0.6; horn.visible = false;
            horn.userData.horn = true;
            g.add(horn);
        }
        const wingMat = new THREE.MeshLambertMaterial({ color: d.color2, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
        const wl = new THREE.Mesh(this.wingGeo, wingMat), wr = new THREE.Mesh(this.wingGeo, wingMat);
        wr.scale.x = 1; wl.scale.x = -1;
        wl.position.set(-0.6, 0.1, 0.9); wr.position.set(0.6, 0.1, 0.9);
        g.add(wl, wr);
        h = { g, mat, wl, wr, flap: Math.random() * 6 };
        this.scene.add(g);
        this.heads.set(d.id, h);
        return h;
    }

    // ------------------------------------------------ per-frame update
    update(world, view, dt, time) {
        const player = view.player;
        const ph = player && player.alive ? player.pos : null;
        // Beads.
        const allM = this.beads.instanceMatrix.array, allC = this.beads.instanceColor.array;
        const ownM = this.ownBeads.instanceMatrix.array, ownC = this.ownBeads.instanceColor.array;
        let nAll = 0, nOwn = 0, n = 0, bm, bc, cap;
        const seen = new Set();
        const cp = this.camera.position;
        for (const d of world.dragons) {
            if (!d.alive) continue;
            seen.add(d.id);
            const r = d.r;
            const c1 = _c.set(d.color), r1 = c1.r, g1 = c1.g, b1 = c1.b;
            const c2 = _c.set(d.color2), r2 = c2.r, g2 = c2.g, b2 = c2.b;
            const ghost = d.protect > 0 ? 0.35 + 0.25 * Math.sin(time * 20) : 1;
            const isOther = d !== player;
            if (isOther) { bm = allM; bc = allC; n = nAll; cap = MAX_BEADS; } else { bm = ownM; bc = ownC; n = nOwn; cap = 1000; }
            for (let b = 0; b < d.nBeads && n < cap; b++) {
                const o = b * 3;
                const x = d.beads[o], y = d.beads[o + 1], z = d.beads[o + 2];
                // Taper the last 15% of the tail.
                const f = b / d.nBeads;
                let s = r * (f > 0.85 ? 1 - (f - 0.85) / 0.15 * 0.6 : 1);
                // Your own body shrinks away near the camera so it never
                // blocks the view in a turn.
                if (!isOther) {
                    const cx = x - cp.x, cy = y - cp.y, cz = z - cp.z;
                    const cd = Math.sqrt(cx * cx + cy * cy + cz * cz) - s;
                    if (cd < 3.5) s *= Math.max(0, (cd - 0.8) / 2.7);
                }
                const k = n * 16;
                bm[k] = s; bm[k + 1] = 0; bm[k + 2] = 0; bm[k + 3] = 0;
                bm[k + 4] = 0; bm[k + 5] = s; bm[k + 6] = 0; bm[k + 7] = 0;
                bm[k + 8] = 0; bm[k + 9] = 0; bm[k + 10] = s; bm[k + 11] = 0;
                bm[k + 12] = x; bm[k + 13] = y; bm[k + 14] = z; bm[k + 15] = 1;
                const stripe = (b >> 1) % 3 === 0;
                let cr = stripe ? r2 : r1, cg = stripe ? g2 : g1, cb = stripe ? b2 : b1;
                // Proximity glow: enemy tail near your head brightens + pulses.
                if (ph && isOther) {
                    const dx = x - ph.x, dy = y - ph.y, dz = z - ph.z;
                    const dd = dx * dx + dy * dy + dz * dz;
                    if (dd < 49) {
                        const g = (1 - Math.sqrt(dd) / 7) * (0.65 + 0.35 * Math.sin(time * 18));
                        cr += (1 - cr) * g; cg += (1 - cg) * g; cb += (1 - cb) * g;
                    }
                }
                const c = n * 3;
                bc[c] = cr * ghost; bc[c + 1] = cg * ghost; bc[c + 2] = cb * ghost;
                n++;
            }
            if (isOther) nAll = n; else nOwn = n;
        }
        this.beads.count = nAll;
        this.beads.instanceMatrix.needsUpdate = true;
        this.beads.instanceColor.needsUpdate = true;
        this.ownBeads.count = nOwn;
        this.ownBeads.instanceMatrix.needsUpdate = true;
        this.ownBeads.instanceColor.needsUpdate = true;
        this.beadCount = nAll + nOwn;

        // Heads.
        let sh = 0;
        const arena = world.arena;
        for (const d of world.dragons) {
            if (!d.alive) continue;
            const h = this.headFor(d);
            h.g.visible = true;
            h.g.position.copy(d.pos);
            h.g.quaternion.copy(d.quat);
            _q.setFromAxisAngle(Zaxis, -d.bank);
            h.g.quaternion.multiply(_q);
            const hs = d.r * 1.25;
            h.g.scale.setScalar(hs);
            h.flap += dt * (d.boosting ? 4 : 9 + Math.max(0, d.fwd.y) * 10);
            const fold = d.boosting ? 0.9 : 0;
            const a = Math.sin(h.flap) * 0.5 * (1 - fold);
            h.wl.rotation.set(0, -fold, a); h.wr.rotation.set(0, fold, -a);
            h.mat.color.set(d.color).multiplyScalar(d.protect > 0 ? 0.5 : 1);
            for (const c of h.g.children) if (c.userData.horn) c.visible = d.tier >= 1;
            // Shadow.
            if (sh < MAX_HEADS) {
                if (arena.kind === 'cylinder') {
                    _p.set(d.pos.x, arena.floor + 0.05, d.pos.z);
                    _q.setFromAxisAngle(_s.set(1, 0, 0), -Math.PI / 2);
                } else {
                    _p.copy(d.pos).normalize();
                    _q.setFromUnitVectors(_s.set(0, 0, 1), _p.clone().negate());
                    _p.multiplyScalar(arena.radius - 0.1);
                }
                const ss = d.r * 2.2;
                _m.compose(_p, _q, _s.set(ss, ss, ss));
                this.shadows.setMatrixAt(sh++, _m);
            }
        }
        this.shadows.count = sh;
        this.shadows.instanceMatrix.needsUpdate = true;
        for (const [id, h] of this.heads) {
            if (!seen.has(id)) {
                if (!world.byId.has(id)) { this.scene.remove(h.g); h.mat.dispose(); this.heads.delete(id); }
                else h.g.visible = false;
            }
        }

        // Orbs.
        const om = this.orbs.instanceMatrix.array, oc = this.orbs.instanceColor.array;
        let no = 0;
        for (let i = 0; i < world.oalive.length && no < MAX_ORBS; i++) {
            if (!world.oalive[i]) continue;
            const v = world.oval[i];
            let s = 0.28 + 0.13 * Math.sqrt(v);
            s *= 1 + 0.15 * Math.sin(time * 4 + i);
            if (world.ottl[i] > 0 && world.ottl[i] < 5) s *= world.ottl[i] / 5;
            const k = no * 16;
            om[k] = s; om[k + 1] = 0; om[k + 2] = 0; om[k + 3] = 0;
            om[k + 4] = 0; om[k + 5] = s; om[k + 6] = 0; om[k + 7] = 0;
            om[k + 8] = 0; om[k + 9] = 0; om[k + 10] = s; om[k + 11] = 0;
            om[k + 12] = world.ox[i]; om[k + 13] = world.oy[i]; om[k + 14] = world.oz[i]; om[k + 15] = 1;
            _c.set(world.ocol[i]);
            const c = no * 3;
            oc[c] = _c.r; oc[c + 1] = _c.g; oc[c + 2] = _c.b;
            no++;
        }
        this.orbs.count = no;
        this.orbs.instanceMatrix.needsUpdate = true;
        this.orbs.instanceColor.needsUpdate = true;

        // Power-ups.
        while (this.puMeshes.length < world.powerups.length) {
            const m = new THREE.Mesh(this.puGeo, this.puMats.shield);
            this.scene.add(m); this.puMeshes.push(m);
        }
        this.puMeshes.forEach((m, i) => {
            const pu = world.powerups[i];
            m.visible = !!pu;
            if (!pu) return;
            m.material = this.puMats[pu.type];
            m.position.copy(pu.pos);
            m.rotation.set(pu.spin * 0.7, pu.spin * 1.3, 0);
            m.scale.setScalar(1 + 0.12 * Math.sin(time * 5));
        });

        // Beacon on #1 once it's at least a Wyvern.
        const top = view.top;
        this.beacon.visible = !!(top && top.mass >= TIERS[2].mass);
        if (this.beacon.visible) this.beacon.position.set(top.pos.x, top.pos.y + 200, top.pos.z);

        // Player shield bubble.
        this.bubble.visible = !!(player && player.alive && (player.shield > 0 || player.protect > 0));
        if (this.bubble.visible) {
            this.bubble.position.copy(player.pos);
            this.bubble.scale.setScalar(player.r * 3.2);
            this.bubble.material.color.set(player.shield > 0 ? 0xFF9A3C : 0xffffff);
        }

        // Fire particles.
        const fp = this.fireGeo.attributes.position.array;
        let nf = 0;
        for (let i = this.fireParts.length - 1; i >= 0; i--) {
            const p = this.fireParts[i];
            p.t += dt;
            if (p.t > p.life) { this.fireParts.splice(i, 1); continue; }
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            if (nf < 600) { fp[nf * 3] = p.x; fp[nf * 3 + 1] = p.y; fp[nf * 3 + 2] = p.z; nf++; }
        }
        this.fireGeo.setDrawRange(0, nf);
        this.fireGeo.attributes.position.needsUpdate = true;

        // Walls brighten as the player approaches (spec §9).
        const warn = view.wallWarn || 0;
        for (const m of this.wallMats) {
            const base = m.isLineBasicMaterial ? 0.12 : 0.04;
            m.opacity = base + warn * (m.isLineBasicMaterial ? 0.7 : 0.25);
        }

        // Dust follows the camera (wrapped), so motion always reads.
        const dp = this.dustGeo.attributes.position.array, base = this.dustBase, cam = this.camera.position;
        for (let i = 0; i < dp.length; i += 3) {
            dp[i] = cam.x + wrap(base[i] - cam.x, 70);
            dp[i + 1] = cam.y + wrap(base[i + 1] - cam.y, 70);
            dp[i + 2] = cam.z + wrap(base[i + 2] - cam.z, 70);
        }
        this.dustGeo.attributes.position.needsUpdate = true;

        this.renderer.render(this.scene, this.camera);
    }

    burstFire(d) {
        for (let i = 0; i < 160; i++) {
            const spread = 0.38;
            const dir = _p.copy(d.fwd).add(_s.set((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2)).normalize();
            const sp = 18 + Math.random() * 14;
            this.fireParts.push({ x: d.pos.x + d.fwd.x * d.r, y: d.pos.y + d.fwd.y * d.r, z: d.pos.z + d.fwd.z * d.r,
                vx: dir.x * sp + d.vdir.x * d.speed, vy: dir.y * sp + d.vdir.y * d.speed, vz: dir.z * sp + d.vdir.z * d.speed,
                t: 0, life: 0.35 + Math.random() * 0.25 });
        }
    }

    clearHeads() {
        for (const h of this.heads.values()) { this.scene.remove(h.g); h.mat.dispose(); }
        this.heads.clear();
    }
}

function wrap(v, size) {
    const h = size / 2;
    return ((v + h) % size + size) % size - h;
}

function skyDome(top, mid, horizon) {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, hor: { value: new THREE.Color(horizon) } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP;
            void main(){ float h = vP.y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.7, h)) : mix(hor, mid, smoothstep(-0.05, 0.08, h));
            gl_FragColor = vec4(c, 1.0); }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -1;
    m.onBeforeRender = (r, s, cam) => m.position.copy(cam.position);
    return m;
}

function disposeTree(o) {
    o.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
    });
}
