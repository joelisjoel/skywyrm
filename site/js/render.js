// Minimal renderer: the prototype is about feel, not looks (spec §10 is
// deliberately skipped). Everything that moves is instanced; the arena is
// wireframe + fog + drifting dust so speed and depth read clearly.
import * as THREE from 'three';
import { T, TIERS } from './tunables.js?v=3';

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
        this.camera = new THREE.PerspectiveCamera(T.fov, 1, 0.1, 3000);
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

        // The leader's blazing head (replaces the old light pillar): a very
        // bright additive halo + a warm point light + flame particles.
        this.glowTex = radialTexture();
        this.leaderGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffd27a,
            blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
        // A second halo that keeps a constant on-screen size, so the leader
        // blazes like a star even from across the arena.
        this.starTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,245,210,1)'], [0.5, 'rgba(255,190,80,0.6)'], [1, 'rgba(255,120,20,0)']]);
        this.leaderStar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.starTex, color: 0xffe8b0,
            blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false, sizeAttenuation: false }));
        this.leaderStarCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.starTex, color: 0xffffff,
            blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false, sizeAttenuation: false }));
        this.leaderStar.renderOrder = this.leaderStarCore.renderOrder = 10;
        this.scene.add(this.leaderStar, this.leaderStarCore);
        this.leaderCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffffff,
            blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
        this.leaderLight = new THREE.PointLight(0xffb040, 1500, 60, 1.5);
        this.scene.add(this.leaderGlow, this.leaderCore, this.leaderLight);

        // Dragonfire cone (shown while breathing).
        const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
        coneGeo.translate(0, -0.5, 0); coneGeo.rotateX(-Math.PI / 2);   // apex at origin, opens toward −Z
        this.fireCone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true,
            opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        this.fireCones = [];

        // Shield bubble / magnet ring for the player.
        this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14),
            new THREE.MeshBasicMaterial({ color: 0xFF9A3C, transparent: true, opacity: 0.1, depthWrite: false }));
        this.scene.add(this.bubble);

        // Particles: dragonfire, burning severed tails, the leader's flames.
        const PN = 4000;
        this.partGeo = new THREE.BufferGeometry();
        this.partGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(PN * 3), 3));
        this.partGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(PN * 3), 3));
        this.parts = new THREE.Points(this.partGeo, new THREE.PointsMaterial({ size: 1.6, map: this.glowTex, vertexColors: true,
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.parts.frustumCulled = false;
        this.scene.add(this.parts);
        this.particles = [];
        this.PN = PN;

        // Speed dust: a box of motes wrapped around the camera.
        const N = 1800, dust = new Float32Array(N * 3);
        for (let i = 0; i < N * 3; i++) dust[i] = (Math.random() - 0.5) * 70;
        this.dustBase = dust.slice();
        this.dustGeo = new THREE.BufferGeometry();
        this.dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dust, 3));
        this.dust = new THREE.Points(this.dustGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false }));
        this.dust.frustumCulled = false;
        this.scene.add(this.dust);

        // Wide view (spec: side/rear awareness): the centre is a normal sharp
        // render; a low-res cube map around the camera supplies everything
        // else, warped into the screen edges and corners. The same cube map
        // feeds the rear-view mirror.
        this.view = { wide: true, mirror: true };
        this.mirrorRect = { x: 0.36, y: 0.80, w: 0.28, h: 0.15 };    // uv, origin bottom-left
        this.cubeRT = new THREE.WebGLCubeRenderTarget(768, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
        this.cubeCam = new THREE.CubeCamera(0.1, 3000, this.cubeRT);
        this.mainRT = new THREE.WebGLRenderTarget(4, 4, { samples: 4 });
        this.warpMat = new THREE.ShaderMaterial({
            uniforms: {
                cube: { value: this.cubeRT.texture }, mainTex: { value: this.mainRT.texture },
                camRot: { value: new THREE.Matrix3() }, aspect: { value: 1 }, tanHalf: { value: 1 },
                extra: { value: 0 }, rMax: { value: 1 }, expo: { value: 3 }, wide: { value: 1 },
                mirror: { value: 1 }, mRect: { value: new THREE.Vector4() }, mTan: { value: Math.tan(28 * Math.PI / 180) },
            },
            vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
            fragmentShader: WARP_FRAG, depthTest: false, depthWrite: false,
        });
        this.warpScene = new THREE.Scene();
        this.warpScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.warpMat));
        this.warpCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        this.arenaGroup = null;
        this.resize();
    }

    // Screen-space projection matching whatever view is active (the HUD
    // needs it for names, the nose marker and off-screen arrows).
    project(pos, out) {
        const cam = this.camera, W = innerWidth, H = innerHeight, aspect = W / H;
        _p.copy(pos).applyMatrix4(cam.matrixWorldInverse);
        const len = _p.length() || 1;
        const theta = Math.acos(Math.max(-1, Math.min(1, -_p.z / len)));
        const tanHalf = Math.tan(cam.fov * Math.PI / 360);
        let r;
        out.on = false;
        if (!this.view.wide) {
            if (_p.z >= 0) return out;
            r = Math.tan(theta) / tanHalf;
        } else {
            const rMax = Math.hypot(aspect, 1), extra = this.wideExtra(tanHalf, rMax);
            const g = (rr) => Math.atan(tanHalf * rr) + extra * Math.pow(rr / rMax, T.wideExpo);
            if (theta > g(rMax)) return out;
            let lo = 0, hi = rMax;
            for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (g(mid) < theta) lo = mid; else hi = mid; }
            r = (lo + hi) / 2;
        }
        const phi = Math.atan2(_p.y, _p.x);
        const px = r * Math.cos(phi), py = r * Math.sin(phi);
        out.x = (px / aspect + 1) / 2 * W;
        out.y = (1 - (py + 1) / 2) * H;
        out.on = Math.abs(px) <= aspect && Math.abs(py) <= 1 && !this.inMirror(out.x, out.y);
        return out;
    }

    wideExtra(tanHalf, rMax) {
        return Math.max(0, T.wideCorner * Math.PI / 180 - Math.atan(tanHalf * rMax));
    }

    // Mirror rectangle in CSS pixels (for the HUD frame), or null.
    mirrorPx() {
        if (!this.mirrorOn) return null;
        const m = this.mirrorRect, W = innerWidth, H = innerHeight;
        return { x: m.x * W, y: (1 - m.y - m.h) * H, w: m.w * W, h: m.h * H };
    }

    inMirror(x, y) {
        const m = this.mirrorPx();
        return !!m && x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h;
    }

    resize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.mainRT.setSize(size.x, size.y);
    }

    // ------------------------------------------------ arena visuals
    buildArena(arena) {
        if (this.arenaGroup) { this.scene.remove(this.arenaGroup); disposeTree(this.arenaGroup); }
        const g = this.arenaGroup = new THREE.Group();
        this.wallMats = [];
        if (arena.kind === 'cylinder') {
            this.scene.background = new THREE.Color(0x1b1740);
            this.scene.fog = new THREE.Fog(0x2a1f55, 90, 560);
            g.add(skyDome(0x0d0b2e, 0x3a2470, 0xff7a4a));
            // Cloud sea: flat plane + grid for motion reference.
            const floor = new THREE.Mesh(new THREE.CircleGeometry(arena.radius * 4, 64),
                new THREE.MeshLambertMaterial({ color: 0x6f5aa8 }));
            floor.rotation.x = -Math.PI / 2; floor.position.y = arena.floor - 0.05;
            g.add(floor);
            const grid = new THREE.GridHelper(arena.radius * 8, Math.round(arena.radius * 8 / 10), 0xb9a8ff, 0x9c86e8);
            grid.position.y = arena.floor + 0.02;
            grid.material.transparent = true; grid.material.opacity = 0.35;
            g.add(grid);
            // Rings on the cloud sea mark the rich middle.
            const rings = [];
            for (let rr = 25; rr < arena.radius; rr += rr < 100 ? 25 : 50) {
                for (let k = 0; k < 96; k++) {
                    const a0 = k / 96 * Math.PI * 2, a1 = (k + 1) / 96 * Math.PI * 2;
                    rings.push(Math.cos(a0) * rr, 0.08, Math.sin(a0) * rr, Math.cos(a1) * rr, 0.08, Math.sin(a1) * rr);
                }
            }
            const rg = new THREE.BufferGeometry();
            rg.setAttribute('position', new THREE.Float32BufferAttribute(rings, 3));
            g.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.35 })));
            // Storm wall: vertical lines + rings, brightens as you approach.
            const pts = [];
            const R = arena.radius, H = arena.band;   // no roof: wall drawn to the food band
            for (let k = 0; k < 144; k++) {
                const a = k / 144 * Math.PI * 2;
                pts.push(Math.cos(a) * R, arena.floor, Math.sin(a) * R, Math.cos(a) * R, H, Math.sin(a) * R);
            }
            for (let y = 0; y <= H; y += 20) {
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
        } else {
            this.scene.background = new THREE.Color(0x07060f);
            this.scene.fog = new THREE.Fog(0x07060f, 90, 560);
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
            // Soft glow at the centre (not solid) marks the rich middle.
            const glow = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 16),
                new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false }));
            g.add(glow);
            g.add(new THREE.PointLight(0xffd9a0, 2500, 0, 1.4));
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
            h.mat.emissive.setHex(d === view.top ? 0xffc85a : 0x000000);
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
        for (let i = 0; i < world.oHigh && no < MAX_ORBS; i++) {
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

        // The leader blazes: halo + core + light + flames streaming back.
        const top = view.top;
        const lead = !!(top && top.alive);
        const mine = lead && top === player;
        this.leaderGlow.visible = this.leaderCore.visible = this.leaderLight.visible = lead;
        this.leaderStar.visible = this.leaderStarCore.visible = lead && !mine;   // don't blind yourself when you lead
        if (lead) {
            const hr = top.r * 1.25;
            const flick = 1 + 0.12 * Math.sin(time * 23) + 0.08 * Math.sin(time * 37);
            this.leaderGlow.position.copy(top.pos);
            this.leaderGlow.scale.setScalar(hr * (mine ? 2.4 : 11) * flick);
            this.leaderCore.position.copy(top.pos);
            this.leaderCore.scale.setScalar(hr * (mine ? 1.1 : 6) * flick);
            this.leaderStar.position.copy(top.pos);
            this.leaderStar.scale.setScalar(0.2 * flick);
            this.leaderStarCore.position.copy(top.pos);
            this.leaderStarCore.scale.setScalar(0.07 * flick);
            this.leaderLight.position.copy(top.pos);
            const n = mine ? 1 : 5;
            for (let i = 0; i < n; i++) {
                const j = hr * 0.8;
                this.emit(top.pos.x + (Math.random() - 0.5) * j, top.pos.y + (Math.random() - 0.5) * j, top.pos.z + (Math.random() - 0.5) * j,
                    -top.vdir.x * top.speed * 0.35 + (Math.random() - 0.5) * 3 + top.up.x * 3,
                    -top.vdir.y * top.speed * 0.35 + (Math.random() - 0.5) * 3 + top.up.y * 3,
                    -top.vdir.z * top.speed * 0.35 + (Math.random() - 0.5) * 3 + top.up.z * 3,
                    0.35 + Math.random() * 0.35, 1);
            }
        }

        // Dragonfire: a translucent cone + a thick stream of flame while breathing.
        let fc = 0;
        for (const d of world.dragons) {
            if (!d.alive || !(d.breath > 0)) continue;
            if (!this.fireCones[fc]) { this.fireCones[fc] = this.fireCone.clone(); this.scene.add(this.fireCones[fc]); }
            const cone = this.fireCones[fc++];
            cone.visible = true;
            const rad = T.fireRange * Math.tan(T.fireAngle * Math.PI / 180);
            cone.position.copy(d.pos).addScaledVector(d.fwd, d.r);
            cone.quaternion.copy(d.quat);
            cone.scale.set(rad, rad, T.fireRange);
            cone.material.opacity = 0.12 + 0.06 * Math.sin(time * 30);
            const spd = T.fireRange / 0.45;
            for (let i = 0; i < 26; i++) {
                const a = Math.random() * Math.PI * 2, s = Math.tan(T.fireAngle * Math.PI / 180) * Math.sqrt(Math.random());
                _s.set(Math.cos(a) * s, Math.sin(a) * s, -1).normalize().applyQuaternion(d.quat);
                const sp = spd * (0.8 + Math.random() * 0.4);
                this.emit(cone.position.x, cone.position.y, cone.position.z,
                    _s.x * sp + d.vdir.x * d.speed, _s.y * sp + d.vdir.y * d.speed, _s.z * sp + d.vdir.z * d.speed,
                    0.35 + Math.random() * 0.15, 1.6);
            }
        }
        for (let i = fc; i < this.fireCones.length; i++) this.fireCones[i].visible = false;

        // Player shield bubble.
        this.bubble.visible = !!(player && player.alive && (player.shield > 0 || player.protect > 0));
        if (this.bubble.visible) {
            this.bubble.position.copy(player.pos);
            this.bubble.scale.setScalar(player.r * 3.2);
            this.bubble.material.color.set(player.shield > 0 ? 0xFF9A3C : 0xffffff);
        }

        // Particles (additive; colour fades white-gold → orange → deep red).
        const pp = this.partGeo.attributes.position.array, pc = this.partGeo.attributes.color.array;
        let np = 0;
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const q = this.particles[i];
            q.t += dt;
            if (q.t > q.life) { this.particles[i] = this.particles[this.particles.length - 1]; this.particles.pop(); continue; }
            q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
            q.vx *= 0.97; q.vy = q.vy * 0.97 + 2.5 * dt; q.vz *= 0.97;     // drag + a little rise
            if (np >= this.PN) continue;
            const k = q.t / q.life, fade = (1 - k) * q.heat;
            pp[np * 3] = q.x; pp[np * 3 + 1] = q.y; pp[np * 3 + 2] = q.z;
            pc[np * 3] = fade; pc[np * 3 + 1] = fade * (0.85 - 0.6 * k); pc[np * 3 + 2] = fade * (0.45 - 0.45 * k);
            np++;
        }
        this.partGeo.setDrawRange(0, np);
        this.partGeo.attributes.position.needsUpdate = true;
        this.partGeo.attributes.color.needsUpdate = true;

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

        this.camera.updateMatrixWorld();
        this.mirrorOn = this.view.mirror && view.state === 'play';
        if (this.view.wide || this.mirrorOn) {
            this.renderer.setRenderTarget(this.mainRT);
            this.renderer.render(this.scene, this.camera);
            this.renderer.setRenderTarget(null);
            this.cubeCam.position.copy(this.camera.position);
            this.cubeCam.update(this.renderer, this.scene);
            const u = this.warpMat.uniforms, aspect = innerWidth / innerHeight;
            const tanHalf = Math.tan(this.camera.fov * Math.PI / 360), rMax = Math.hypot(aspect, 1);
            u.camRot.value.setFromMatrix4(this.camera.matrixWorld);
            u.aspect.value = aspect; u.tanHalf.value = tanHalf; u.rMax.value = rMax;
            u.extra.value = this.wideExtra(tanHalf, rMax); u.expo.value = T.wideExpo;
            u.wide.value = this.view.wide ? 1 : 0; u.mirror.value = this.mirrorOn ? 1 : 0;
            const m = this.mirrorRect;
            u.mRect.value.set(m.x, m.y, m.w, m.h);
            this.renderer.render(this.warpScene, this.warpCam);
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    emit(x, y, z, vx, vy, vz, life, heat) {
        if (this.particles.length >= this.PN * 1.5) return;
        this.particles.push({ x, y, z, vx, vy, vz, t: 0, life, heat });
    }

    // A severed tail bursts into flame along its length.
    burnSegment(pts) {
        for (let i = 0; i < pts.length; i += 3) {
            for (let k = 0; k < 3; k++) {
                this.emit(pts[i], pts[i + 1], pts[i + 2], (Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6,
                    0.5 + Math.random() * 0.6, 1.3);
            }
        }
    }

    clearHeads() {
        for (const h of this.heads.values()) { this.scene.remove(h.g); h.mat.dispose(); }
        this.heads.clear();
    }
}

function radialTexture(stops = [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,240,200,0.9)'], [0.5, 'rgba(255,170,60,0.35)'], [1, 'rgba(255,120,20,0)']]) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [at, col] of stops) grad.addColorStop(at, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

// Screen pixel → view direction. θ(r) = atan(tanHalf·r) keeps the centre
// exactly like a normal camera; the extra·(r/rMax)^expo term only bends
// the edges, reaching wideCorner° from forward at the corners. The sharp
// centre comes from the normal render; everything else from the cube map.
const WARP_FRAG = `
uniform samplerCube cube; uniform sampler2D mainTex; uniform mat3 camRot;
uniform float aspect, tanHalf, extra, rMax, expo, wide, mirror, mTan;
uniform vec4 mRect;
varying vec2 vUv;
void main() {
    vec2 p = (vUv * 2.0 - 1.0) * vec2(aspect, 1.0);
    vec3 dir;
    bool inMirror = false;
    if (mirror > 0.5) {
        vec2 q = (vUv - mRect.xy) / mRect.zw;
        if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
            inMirror = true;
            vec2 m = (q * 2.0 - 1.0) * vec2(mRect.z * aspect / mRect.w, 1.0);
            dir = normalize(vec3(m.x * mTan, m.y * mTan, 1.0));   // behind you, mirror-flipped
        }
    }
    if (!inMirror) {
        float r = length(p);
        float theta = atan(tanHalf * r) + wide * extra * pow(r / rMax, expo);
        vec2 d2 = r > 1e-6 ? p / r : vec2(0.0);
        dir = vec3(sin(theta) * d2.x, sin(theta) * d2.y, -cos(theta));
    }
    vec4 col = textureCube(cube, camRot * dir);
    if (!inMirror && dir.z < -1e-4) {
        vec2 uvN = (dir.xy / -dir.z) / (tanHalf * vec2(aspect, 1.0)) * 0.5 + 0.5;
        vec2 edge = min(uvN, 1.0 - uvN);
        float k = smoothstep(0.0, 0.04, min(edge.x, edge.y));
        if (k > 0.0) col = mix(col, texture2D(mainTex, uvN), k);
    }
    gl_FragColor = col;
    #include <colorspace_fragment>
}`;

function wrap(v, size) {
    const h = size / 2;
    return ((v + h) % size + size) % size - h;
}

function skyDome(top, mid, horizon) {
    const geo = new THREE.SphereGeometry(1500, 32, 16);
    const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, hor: { value: new THREE.Color(horizon) } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP;
            void main(){ float h = vP.y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.7, h)) : mix(hor, mid, smoothstep(-0.05, 0.08, h));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
            }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -1;
    m.onBeforeRender = (r, s, cam) => m.position.setFromMatrixPosition(cam.matrixWorld);
    return m;
}

function disposeTree(o) {
    o.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
    });
}
