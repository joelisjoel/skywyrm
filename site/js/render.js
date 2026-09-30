// Minimal renderer: the prototype is about feel, not looks (spec §10 is
// deliberately skipped). Everything that moves is instanced; the arena is
// wireframe + fog + drifting dust so speed and depth read clearly.
import * as THREE from 'three';
import { T, TIERS } from './tunables.js?v=11';

const MAX_BEADS = 24000;
const MAX_ORBS = 6000;
const MAX_HEADS = 80;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color(), _white = new THREE.Color(0xffffff), _ice = new THREE.Color(0xB8DCFF);
const LODE = 0x3D8BFF;           // lodestone blue
const MAX_BEAMS = 240;
const Zaxis = new THREE.Vector3(0, 0, 1);
const _T = new THREE.Vector3(), _U = new THREE.Vector3(), _R = new THREE.Vector3();

export class Renderer {
    constructor(canvas) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        // Film-like response: the scene renders in HDR and is tone-mapped
        // (ACES) in the final pass, with bloom on anything brighter than white.
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(T.fov, 1, 0.1, 3000);
        this.hemi = new THREE.HemisphereLight(0xdde6ff, 0x302040, 0.9);
        this.scene.add(this.hemi);
        const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
        sun.position.set(40, 80, 30);
        this.scene.add(sun);
        this.keyLight = sun;
        this.pmrem = new THREE.PMREMGenerator(this.renderer);

        // Bodies: every bead of every dragon in one instanced mesh.
        // Bodies: every segment of every dragon in one instanced mesh. Each
        // segment is an ellipsoid laid along the body (overlapping, like
        // armour plates) with a shader-drawn scale pattern and a cream belly.
        const segGeo = new THREE.SphereGeometry(1, 14, 8);
        this.beads = new THREE.InstancedMesh(segGeo, scaleMaterial({ roughness: 0.38, metalness: 0.3 }), MAX_BEADS);
        this.beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.beads.setColorAt(0, _white);
        this.beads.frustumCulled = false;
        this.scene.add(this.beads);
        // Your own body: its own translucent mesh so you can see through it.
        this.ownBeads = new THREE.InstancedMesh(this.beads.geometry,
            scaleMaterial({ roughness: 0.38, metalness: 0.3, transparent: true, opacity: 0.45, depthWrite: false }), 1000);
        // Dorsal crest: a flame-like fin on the back of every other segment
        // (and a fan at the tail tip), in each dragon's second colour.
        this.fins = new THREE.InstancedMesh(finGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2,
            side: THREE.DoubleSide }), MAX_BEADS / 2 + 400);
        this.fins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.fins.setColorAt(0, _white);
        this.fins.frustumCulled = false;
        this.scene.add(this.fins);
        this.finM = new THREE.Matrix4();
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
        // Chinese-dragon head parts, merged per material (built once, shared).
        this.headParts = dragonHeadParts();
        this.eyeMat = new THREE.MeshStandardMaterial({ color: 0xFFB43A, emissive: 0xFF8A10, emissiveIntensity: 1.6, roughness: 0.2 });
        this.pupilMat = new THREE.MeshBasicMaterial({ color: 0x120804 });
        this.hornMat = new THREE.MeshStandardMaterial({ color: 0xEADBB6, roughness: 0.45, metalness: 0.15 });
        this.whiskerMat = new THREE.MeshStandardMaterial({ color: 0xF3E3BF, roughness: 0.4, metalness: 0.2 });

        // Power-up crystals.
        // Each crystal gets a world-size glow and a constant-size star halo
        // so it reads from across the arena; dragonfire (red) is the loudest.
        this.puGeo = new THREE.OctahedronGeometry(1.3, 0);
        this.puMats = {
            shield: new THREE.MeshBasicMaterial({ color: 0xFF9A3C }),
            magnet: new THREE.MeshBasicMaterial({ color: 0x2F6BFF }),
            fire: new THREE.MeshBasicMaterial({ color: 0xFF2A1A }),
        };
        this.puColors = { shield: 0xFFB060, magnet: 0x4D9BFF, fire: 0xFF3A20 };
        this.puShellMat = new THREE.MeshBasicMaterial({ color: 0xFFD0A0, wireframe: true, transparent: true, opacity: 0.6 });
        this.puMeshes = [];
        // Like Bit in Tron: snap between shapes, flashing on every change.
        const ico = new THREE.IcosahedronGeometry(1, 0), octa = new THREE.OctahedronGeometry(1.25, 0);
        const spiky = stellate(new THREE.IcosahedronGeometry(0.8, 0), 1.9);
        this.puShapes = { fire: [spiky, octa, spiky, ico], shield: [octa, ico], magnet: [ico, octa] };
        this.puRate = { fire: 3.2, shield: 2.2, magnet: 2.2 };

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

        // Lodestone: a blue glow on the head, two field rings spinning round
        // it, and tractor beams to every orb it is reeling in.
        this.lodeTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(190,225,255,0.95)'], [0.5, 'rgba(70,140,255,0.4)'], [1, 'rgba(30,80,255,0)']]);
        this.lodeRingGeo = new THREE.TorusGeometry(1, 0.035, 6, 48);
        this.lodeRigs = [];
        this.lodeLight = new THREE.PointLight(LODE, 0, 45, 1.5);   // stays in the scene (toggling lights recompiles shaders)
        this.scene.add(this.lodeLight);
        this.beamGeo = new THREE.BufferGeometry();
        this.beamGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_BEAMS * 18), 3));
        this.beamGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(MAX_BEAMS * 18), 3));
        this.beams = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
        this.beams.frustumCulled = false;
        this.scene.add(this.beams);

        // Shield bubble for the player.
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
        this.mainRT = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType });
        // Bloom: bright-pass at ¼ resolution, two separable blur rounds.
        this.bloomA = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
        this.bloomB = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
        const quadVS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
        this.brightMat = new THREE.ShaderMaterial({ uniforms: { src: { value: null }, thr: { value: 0.85 } }, vertexShader: quadVS,
            fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false });
        this.blurMat = new THREE.ShaderMaterial({ uniforms: { src: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: quadVS,
            fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
        this.postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.brightMat);
        this.postScene = new THREE.Scene();
        this.postScene.add(this.postQuad);
        this.bloomStrength = 0.9;
        this.warpMat = new THREE.ShaderMaterial({
            uniforms: {
                cube: { value: this.cubeRT.texture }, mainTex: { value: this.mainRT.texture },
                camRot: { value: new THREE.Matrix3() }, aspect: { value: 1 }, tanHalf: { value: 1 },
                extra: { value: 0 }, rMax: { value: 1 }, expo: { value: 3 }, wide: { value: 1 },
                mirror: { value: 1 }, mRect: { value: new THREE.Vector4() }, mTan: { value: Math.tan(28 * Math.PI / 180) },
                bloomTex: { value: this.bloomA.texture }, bloom: { value: 0.9 },
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
        if (!this.wideNow) {
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
        const bw = Math.max(1, Math.round(size.x / 4)), bh = Math.max(1, Math.round(size.y / 4));
        this.bloomA.setSize(bw, bh); this.bloomB.setSize(bw, bh);
    }

    // ------------------------------------------------ arena visuals
    buildArena(arena) {
        if (this.arenaGroup) { this.scene.remove(this.arenaGroup); disposeTree(this.arenaGroup); }
        const g = this.arenaGroup = new THREE.Group();
        this.wallMats = [];
        this.animated = [];                 // shader materials with a `time` uniform
        if (arena.kind === 'cylinder') {
            // Skyhold at golden hour: a warm low sun, haze, a sea of clouds,
            // karst pillars and ink-wash ridges fading into the distance.
            const HAZE = 0xC99A6E;
            this.scene.background = new THREE.Color(HAZE);
            this.scene.fog = new THREE.FogExp2(HAZE, 0.0015);
            g.add(skyDome(0x2A3A5C, 0xB07A52, 0xFFC98A));
            this.setLight(0xFFD7A6, 2.6, new THREE.Vector3(-1, 0.32, -0.55), 0xBFD2FF, 0x6E5238, 0.75);
            g.add(lowSun(this.glowTex, new THREE.Vector3(-1, 0.32, -0.55)));
            const sea = cloudSea(arena, HAZE);
            this.animated.push(sea.material);
            g.add(sea);
            g.add(karstPillars(arena));
            for (const [r, h, amp, col, seed] of [[1180, 60, 150, 0x6E7A8E, 1], [1300, 40, 190, 0x8C93A0, 2], [1420, 30, 230, 0xAFA79F, 3]]) {
                g.add(ridgeRing(r, arena.floor + h, amp, col, seed));
            }
            // Rings on the cloud sea mark the rich middle.
            const rings = [];
            for (let rr = 25; rr < arena.radius; rr += rr < 100 ? 25 : 50) {
                for (let k = 0; k < 96; k++) {
                    const a0 = k / 96 * Math.PI * 2, a1 = (k + 1) / 96 * Math.PI * 2;
                    rings.push(Math.cos(a0) * rr, 0.3, Math.sin(a0) * rr, Math.cos(a1) * rr, 0.3, Math.sin(a1) * rr);
                }
            }
            const rg = new THREE.BufferGeometry();
            rg.setAttribute('position', new THREE.Float32BufferAttribute(rings, 3));
            g.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xFFE3A8, transparent: true, opacity: 0.22 })));
            // Storm wall: a faint golden qi barrier with sparse ribs, brightening as you approach.
            const R = arena.radius, H = arena.band;
            const pts = [];
            for (let k = 0; k < 72; k++) {
                const a = k / 72 * Math.PI * 2;
                pts.push(Math.cos(a) * R, arena.floor, Math.sin(a) * R, Math.cos(a) * R, H, Math.sin(a) * R);
            }
            g.add(this.wallLines(pts, 0xF0CC86));
            const wall = qiWall(R, H);
            wall.position.y = H / 2;
            this.animated.push(wall.material);
            this.wallMats.push(wall.material);
            g.add(wall);
        } else {
            this.scene.background = new THREE.Color(0x07060f);
            this.scene.fog = new THREE.FogExp2(0x0B0A1C, 0.0012);
            this.setLight(0xE8DCFF, 1.6, new THREE.Vector3(0.4, 1, 0.3), 0x9DB0FF, 0x3A2A20, 0.6);
            const neb = nebulaDome();
            this.animated.push(neb.material);
            g.add(neb);
            const R = arena.radius;
            // Shell: latitude/longitude lines.
            const pts = [];
            const seg = 64;
            for (let lat = -80; lat <= 80; lat += 20) {
                const phi = lat * Math.PI / 180, rr = Math.cos(phi) * R, y = Math.sin(phi) * R;
                for (let k = 0; k < seg; k++) {
                    const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
                    pts.push(Math.cos(a0) * rr, y, Math.sin(a0) * rr, Math.cos(a1) * rr, y, Math.sin(a1) * rr);
                }
            }
            for (let lon = 0; lon < 360; lon += 20) {
                const th = lon * Math.PI / 180;
                for (let k = 0; k < seg / 2; k++) {
                    const p0 = -Math.PI / 2 + k / (seg / 2) * Math.PI, p1 = -Math.PI / 2 + (k + 1) / (seg / 2) * Math.PI;
                    pts.push(Math.cos(p0) * Math.cos(th) * R, Math.sin(p0) * R, Math.cos(p0) * Math.sin(th) * R,
                        Math.cos(p1) * Math.cos(th) * R, Math.sin(p1) * R, Math.cos(p1) * Math.sin(th) * R);
                }
            }
            g.add(this.wallLines(pts, 0xE8C27A));
            const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32),
                new THREE.MeshBasicMaterial({ color: 0xE8C27A, transparent: true, opacity: 0.03, side: THREE.BackSide, depthWrite: false }));
            g.add(shell);
            this.wallMats.push(shell.material);
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
        // The sun: a warm, fly-through heat source at the centre. Near it
        // (and in crowds) your body temp rises: faster, bigger thrust tank.
        const sun = new THREE.Group();
        sun.position.copy(arena.center);
        const core = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 20),
            new THREE.MeshBasicMaterial({ color: 0xfff1c4, fog: false, transparent: true, opacity: 0.95 }));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffb040,
            blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
        halo.scale.setScalar(110);
        const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.starTex, color: 0xfff0c0,
            blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
        corona.scale.setScalar(34);
        sun.add(core, halo, corona, new THREE.PointLight(0xffd9a0, 4000, 0, 1.35));
        g.add(sun);
        this.sun = { core, halo, corona };
        this.scene.add(g);
        // Image-based light from this sky, so glossy scales pick up its colours.
        const env = arena.kind === 'cylinder' ? [0x2A3A5C, 0xB07A52, 0xFFC98A] : [0x0B0A1C, 0x2A1E4A, 0x7A5A30];
        this.setEnvironment(...env);
    }

    // Key light (the low sun) + sky/ground fill for this arena.
    setLight(color, intensity, dir, sky, ground, hemi) {
        this.keyLight.color.set(color);
        this.keyLight.intensity = intensity;
        this.keyLight.position.copy(dir).normalize().multiplyScalar(100);
        this.hemi.color.set(sky); this.hemi.groundColor.set(ground); this.hemi.intensity = hemi;
    }

    setEnvironment(top, mid, hor) {
        const envScene = new THREE.Scene();
        const dome = skyDome(top, mid, hor, 50);
        dome.onBeforeRender = () => {};
        envScene.add(dome);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
        glow.position.set(0, -12, -40);            // a warm light low in the sky
        envScene.add(glow);
        if (this.scene.environment) this.scene.environment.dispose();
        this.scene.environment = this.pmrem.fromScene(envScene, 0.04).texture;
        disposeTree(envScene);
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
        const P = this.headParts, g = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.35, metalness: 0.3 });
        const mat2 = new THREE.MeshStandardMaterial({ color: d.color2, roughness: 0.5, metalness: 0.2 });
        g.add(new THREE.Mesh(P.skin, mat), new THREE.Mesh(P.accent, mat2), new THREE.Mesh(P.eyes, this.eyeMat), new THREE.Mesh(P.pupils, this.pupilMat));
        const antlers = new THREE.Mesh(P.antlers, this.hornMat), crown = new THREE.Mesh(P.crown, this.hornMat);
        g.add(antlers, crown, new THREE.Mesh(P.fangs, this.whiskerMat));
        // Whiskers sway from the snout.
        const wl = new THREE.Mesh(P.whisker, this.whiskerMat), wr = new THREE.Mesh(P.whisker, this.whiskerMat);
        wl.position.set(-0.3, -0.12, -1.55); wr.position.set(0.3, -0.12, -1.55); wr.scale.x = -1;
        g.add(wl, wr);
        h = { g, mat, mat2, wl, wr, antlers, crown, flap: Math.random() * 6 };
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
        let nAll = 0, nOwn = 0, n = 0, bm, bc, cap, nFin = 0;
        const fm = this.fins.instanceMatrix.array, fcol = this.fins.instanceColor.array, finCap = this.fins.instanceMatrix.count;
        const seen = new Set();
        const cp = this.camera.position;
        const biteFrom = world.rule('tailBite') ? world.rule('biteBeads') : 0;
        for (const d of world.dragons) {
            if (!d.alive) continue;
            seen.add(d.id);
            const tip = biteFrom ? Math.max(4, d.nBeads - biteFrom) : Infinity;   // edible tail tip starts here
            const r = d.r;
            const c1 = _c.set(d.color), r1 = c1.r, g1 = c1.g, b1 = c1.b;
            const c2 = _c.set(d.color2), r2 = c2.r, g2 = c2.g, b2 = c2.b;
            const ghost = d.protect > 0 ? 0.35 + 0.25 * Math.sin(time * 20) : 1;
            const isOther = d !== player;
            if (isOther) { bm = allM; bc = allC; n = nAll; cap = MAX_BEADS; } else { bm = ownM; bc = ownC; n = nOwn; cap = 1000; }
            // Frame carried down the body from the head (rotation-minimising):
            // T points toward the head, U is the back, R = U × T.
            _U.copy(d.up);
            const nb = d.nBeads, seg = Math.max(d.beadSpacing * 1.3, r * 0.8);
            for (let b = 0; b < nb && n < cap; b++) {
                const o = b * 3;
                const x = d.beads[o], y = d.beads[o + 1], z = d.beads[o + 2];
                const ia = Math.max(0, b - 1) * 3, ib = Math.min(nb - 1, b + 1) * 3;
                _T.set(d.beads[ia] - d.beads[ib], d.beads[ia + 1] - d.beads[ib + 1], d.beads[ia + 2] - d.beads[ib + 2]);
                if (b === 0 || _T.lengthSq() < 1e-8) _T.copy(d.fwd); else _T.normalize();
                _U.addScaledVector(_T, -_U.dot(_T));
                if (_U.lengthSq() < 1e-6) _U.copy(d.up);
                _U.normalize();
                _R.crossVectors(_U, _T);
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
                const k = n * 16, sx = s * 1.08, sy = s * 0.94, sz = seg * (s / r);
                bm[k] = _R.x * sx; bm[k + 1] = _R.y * sx; bm[k + 2] = _R.z * sx; bm[k + 3] = 0;
                bm[k + 4] = _U.x * sy; bm[k + 5] = _U.y * sy; bm[k + 6] = _U.z * sy; bm[k + 7] = 0;
                bm[k + 8] = _T.x * sz; bm[k + 9] = _T.y * sz; bm[k + 10] = _T.z * sz; bm[k + 11] = 0;
                bm[k + 12] = x; bm[k + 13] = y; bm[k + 14] = z; bm[k + 15] = 1;
                // Crest: a fin every other segment, rising from the back and
                // swept toward the tail; a three-fin fan at the very tip.
                const last = b === nb - 1;
                if (((b & 1) === 0 && b > 1 && b < nb - 2 || last) && nFin < finCap - 3 && s > 0.05) {
                    const fh = s * (last ? 1.9 : 0.95 * (1 - 0.35 * b / nb)), fl = seg * 1.6 * (s / r);
                    for (let q = 0; q < (last ? 3 : 1); q++) {
                        const tilt = last ? (q - 1) * 0.75 : 0, ct = Math.cos(tilt), st = Math.sin(tilt);
                        const ux = _U.x * ct + _R.x * st, uy = _U.y * ct + _R.y * st, uz = _U.z * ct + _R.z * st;
                        const rx = _R.x * ct - _U.x * st, ry = _R.y * ct - _U.y * st, rz = _R.z * ct - _U.z * st;
                        const kk = nFin * 16, base = last ? 0.2 : 0.75;
                        fm[kk] = rx; fm[kk + 1] = ry; fm[kk + 2] = rz; fm[kk + 3] = 0;
                        fm[kk + 4] = ux * fh; fm[kk + 5] = uy * fh; fm[kk + 6] = uz * fh; fm[kk + 7] = 0;
                        fm[kk + 8] = _T.x * fl; fm[kk + 9] = _T.y * fl; fm[kk + 10] = _T.z * fl; fm[kk + 11] = 0;
                        fm[kk + 12] = x + ux * s * base; fm[kk + 13] = y + uy * s * base; fm[kk + 14] = z + uz * s * base; fm[kk + 15] = 1;
                        fcol[nFin * 3] = r2 * ghost; fcol[nFin * 3 + 1] = g2 * ghost; fcol[nFin * 3 + 2] = b2 * ghost;
                        nFin++;
                    }
                }
                let cr = r1, cg = g1, cb = b1;
                // A darker band every few plates, like the markings on a koi.
                if ((b >> 1) % 4 === 0) { cr = cr * 0.55 + r2 * 0.45; cg = cg * 0.55 + g2 * 0.45; cb = cb * 0.55 + b2 * 0.45; }
                // Edible tail tip: a warm gold shimmer running down it.
                if (b >= tip && isOther) {
                    const g = 0.45 + 0.3 * Math.sin(time * 9 - b * 0.9);
                    cr += (1 - cr) * g; cg += (0.85 - cg) * g; cb += (0.35 - cb) * g;
                }
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
        this.fins.count = nFin;
        this.fins.instanceMatrix.needsUpdate = true;
        this.fins.instanceColor.needsUpdate = true;
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
            const hs = d.r * 1.15;
            h.g.scale.setScalar(hs);
            h.flap += dt * (d.boosting ? 9 : 4);
            const sway = Math.sin(h.flap) * 0.25, trail = d.boosting ? 0.35 : 0;
            h.wl.rotation.set(sway * 0.5 + trail, -0.25 - sway * 0.4, 0); h.wr.rotation.set(-sway * 0.5 + trail, 0.25 + sway * 0.4, 0);
            h.mat.color.set(d.color).multiplyScalar(d.protect > 0 ? 0.5 : 1);
            h.mat2.color.set(d.color2).multiplyScalar(d.protect > 0 ? 0.5 : 1);
            // Hot dragons glow; the leader blazes gold.
            if (d === view.top) h.mat.emissive.setHex(0xffc85a);
            else h.mat.emissive.setRGB(1, 0.35, 0.05).multiplyScalar(Math.max(0, (d.temp - 25) / 75) * 0.7);
            // Antlers grow with the dragon: none as a hatchling, branching from Drake, a crown from Elder.
            h.antlers.visible = d.tier >= 1;
            h.crown.visible = d.tier >= 3;
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
                if (!world.byId.has(id)) { this.scene.remove(h.g); h.mat.dispose(); h.mat2.dispose(); this.heads.delete(id); }
                else h.g.visible = false;
            }
        }

        // Orbs.
        const om = this.orbs.instanceMatrix.array, oc = this.orbs.instanceColor.array;
        let no = 0;
        this.nBeams = 0;
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
            const puller = world.opull[i] ? world.byId.get(world.opull[i]) : null;
            if (puller && puller.magnet > 0) {
                _c.lerp(_ice, 0.7);
                om[k] = om[k + 5] = om[k + 10] = s * 1.15;
                this.beamTo(puller, world.ox[i], world.oy[i], world.oz[i], time);
            }
            const c = no * 3;
            oc[c] = _c.r * 1.35; oc[c + 1] = _c.g * 1.35; oc[c + 2] = _c.b * 1.35;
            no++;
        }
        // Online, the server reels orbs in; net.js hands us the ones a
        // lodestone took, and we replay the pull from where we last saw them.
        const phs = world.phantoms;
        for (let j = phs.length - 1; j >= 0; j--) {
            const q = phs[j], d = q.d;
            q.t += dt;
            const k = Math.min(1, q.t / 0.4), e = k * k;
            if (k >= 1 || !d.alive) { phs[j] = phs[phs.length - 1]; phs.pop(); continue; }
            const mx = d.pos.x + d.fwd.x * d.r, my = d.pos.y + d.fwd.y * d.r, mz = d.pos.z + d.fwd.z * d.r;
            const x = q.x + (mx - q.x) * e, y = q.y + (my - q.y) * e, z = q.z + (mz - q.z) * e;
            this.beamTo(d, x, y, z, time);
            if (no >= MAX_ORBS) continue;
            const s = (0.28 + 0.13 * Math.sqrt(q.val)) * 1.15 * (1 - 0.5 * e), kk = no * 16;
            om[kk] = s; om[kk + 1] = 0; om[kk + 2] = 0; om[kk + 3] = 0;
            om[kk + 4] = 0; om[kk + 5] = s; om[kk + 6] = 0; om[kk + 7] = 0;
            om[kk + 8] = 0; om[kk + 9] = 0; om[kk + 10] = s; om[kk + 11] = 0;
            om[kk + 12] = x; om[kk + 13] = y; om[kk + 14] = z; om[kk + 15] = 1;
            _c.set(q.col).lerp(_ice, 0.7);
            oc[no * 3] = _c.r; oc[no * 3 + 1] = _c.g; oc[no * 3 + 2] = _c.b;
            no++;
        }
        this.orbs.count = no;
        this.orbs.instanceMatrix.needsUpdate = true;
        this.orbs.instanceColor.needsUpdate = true;

        // Power-ups: crystal + wire shell + glow + star halo (+ embers for fire).
        while (this.puMeshes.length < world.powerups.length) {
            const g = new THREE.Group();
            const crystal = new THREE.Mesh(this.puGeo, this.puMats.shield);
            const shell = new THREE.Mesh(this.puGeo, this.puShellMat);
            shell.scale.setScalar(1.45);
            const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending,
                depthWrite: false, transparent: true, fog: false }));
            const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.starTex, blending: THREE.AdditiveBlending,
                depthWrite: false, depthTest: false, transparent: true, fog: false, sizeAttenuation: false }));
            star.renderOrder = 9;
            g.add(crystal, shell, glow, star);
            g.userData = { crystal, shell, glow, star };
            this.scene.add(g); this.puMeshes.push(g);
        }
        this.puMeshes.forEach((g, i) => {
            const pu = world.powerups[i];
            g.visible = !!pu;
            if (!pu) return;
            const { crystal, shell, glow, star } = g.userData;
            const fire = pu.type === 'fire';
            // Bit: hop to the next shape every beat; flash white + pop on the hop.
            const shapes = this.puShapes[pu.type];
            const beat = time * this.puRate[pu.type] + pu.spin * 0.37;
            const frac = beat - Math.floor(beat);
            crystal.geometry = shell.geometry = shapes[Math.floor(beat) % shapes.length];
            const flash = frac < 0.14 ? 1 : 0;
            const pop = 1 + 0.45 * Math.max(0, 1 - frac * 5);
            if (!crystal.material.userData.own) { crystal.material = crystal.material.clone(); crystal.material.userData.own = true; }
            crystal.material.color.setHex(flash ? 0xffffff : this.puMats[pu.type].color.getHex());
            g.position.copy(pu.pos);
            crystal.rotation.set(pu.spin * 0.7, pu.spin * 1.3, 0);
            shell.rotation.set(-pu.spin * 0.5, pu.spin * 0.9, pu.spin * 0.3);
            crystal.scale.setScalar((fire ? 1.9 : 1.4) * pop);
            shell.scale.setScalar((fire ? 2.8 : 2.0) * (2 - pop * 0.7));
            glow.material.color.setHex(flash ? 0xffffff : this.puColors[pu.type]);
            glow.scale.setScalar((fire ? 16 : 9) * pop);
            star.material.color.setHex(flash ? 0xffffff : this.puColors[pu.type]);
            star.scale.setScalar((fire ? 0.09 : 0.045) * pop);
            if (fire) {
                for (let k = 0; k < 2; k++) {
                    this.emit(pu.pos.x + (Math.random() - 0.5) * 3, pu.pos.y + (Math.random() - 0.5) * 3, pu.pos.z + (Math.random() - 0.5) * 3,
                        (Math.random() - 0.5) * 2, 3 + Math.random() * 4, (Math.random() - 0.5) * 2, 0.6 + Math.random() * 0.5, 1);
                }
            }
        });

        // The sun breathes.
        if (this.sun) {
            const b = 1 + 0.06 * Math.sin(time * 1.3) + 0.03 * Math.sin(time * 3.7);
            this.sun.halo.scale.setScalar(110 * b);
            this.sun.corona.scale.setScalar(34 * (2 - b));
        }

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

        // Lodestone: blue head glow + field rings on every dragon holding one.
        let lr = 0, lightOn = false;
        for (const d of world.dragons) {
            if (!d.alive || !(d.magnet > 0)) continue;
            if (!this.lodeRigs[lr]) this.lodeRigs[lr] = this.makeLodeRig();
            const rig = this.lodeRigs[lr++], mine = d === player;
            rig.g.visible = true;
            rig.g.position.copy(d.pos);
            const pulse = 1 + 0.18 * Math.sin(time * 9) + 0.08 * Math.sin(time * 23);
            const fade = d.magnet < 1.5 ? 0.5 + 0.5 * Math.sin(time * 18) : 1;   // flickers as it runs out
            rig.glow.scale.setScalar(d.r * (mine ? 5 : 7) * pulse);
            rig.glow.material.opacity = (mine ? 0.8 : 1) * fade;
            rig.core.scale.setScalar(d.r * (mine ? 1.6 : 2.6) * pulse);
            rig.core.material.opacity = (mine ? 0.7 : 1) * fade;
            const rr = d.r * 2.6;
            rig.ring1.scale.setScalar(rr); rig.ring2.scale.setScalar(rr * 1.15);
            rig.ring1.quaternion.copy(d.quat); rig.ring1.rotateX(Math.PI / 2 + Math.sin(time * 2) * 0.4); rig.ring1.rotateZ(time * 3);
            rig.ring2.quaternion.copy(d.quat); rig.ring2.rotateY(time * 2.3); rig.ring2.rotateX(time * 1.7);
            rig.ring1.material.opacity = rig.ring2.material.opacity = 0.75 * fade;
            if (mine) { lightOn = true; this.lodeLight.position.copy(d.pos); this.lodeLight.intensity = 900 * pulse * fade; }
            // Blue sparks drifting off the head.
            if (Math.random() < (mine ? 0.5 : 1)) {
                _s.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(d.r * 1.4);
                this.emit(d.pos.x + _s.x, d.pos.y + _s.y, d.pos.z + _s.z, _s.x * 2 + d.vdir.x * d.speed, _s.y * 2 + d.vdir.y * d.speed, _s.z * 2 + d.vdir.z * d.speed, 0.4, 1, 1);
            }
        }
        for (let i = lr; i < this.lodeRigs.length; i++) this.lodeRigs[i].g.visible = false;
        if (!lightOn) this.lodeLight.intensity = 0;
        this.beamGeo.setDrawRange(0, this.nBeams * 6);
        this.beamGeo.attributes.position.needsUpdate = true;
        this.beamGeo.attributes.color.needsUpdate = true;

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
            q.vx *= 0.97; q.vy = q.vy * 0.97 + (q.hue ? 0 : 2.5 * dt); q.vz *= 0.97;     // drag + a little rise (flames)
            if (np >= this.PN) continue;
            const k = q.t / q.life, fade = (1 - k) * q.heat;
            pp[np * 3] = q.x; pp[np * 3 + 1] = q.y; pp[np * 3 + 2] = q.z;
            if (q.hue) { pc[np * 3] = fade * (0.55 - 0.35 * k); pc[np * 3 + 1] = fade * (0.8 - 0.3 * k); pc[np * 3 + 2] = fade; }
            else { pc[np * 3] = fade; pc[np * 3 + 1] = fade * (0.85 - 0.6 * k); pc[np * 3 + 2] = fade * (0.45 - 0.45 * k); }
            np++;
        }
        this.partGeo.setDrawRange(0, np);
        this.partGeo.attributes.position.needsUpdate = true;
        this.partGeo.attributes.color.needsUpdate = true;

        // Walls brighten as the player approaches (spec §9).
        const warn = view.wallWarn || 0;
        for (const m of this.wallMats) {
            if (m.uniforms) { m.uniforms.warn.value = warn; continue; }
            const base = m.isLineBasicMaterial ? 0.12 : 0.04;
            m.opacity = base + warn * (m.isLineBasicMaterial ? 0.7 : 0.25);
        }
        for (const m of this.animated || []) m.uniforms.time.value = time;

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
        // Side vision is for flying: menus and the death camera use the
        // plain view, which spares the six extra cube-map renders.
        this.wideNow = this.view.wide && (view.state === 'play' || view.state === 'pause');
        {
            const r = this.renderer;
            r.setRenderTarget(this.mainRT);
            r.render(this.scene, this.camera);
            // Low quality refreshes the side/rear cube every other frame.
            if ((this.wideNow || this.mirrorOn) && (this.quality !== 'low' || (this.frameNo = (this.frameNo || 0) + 1) % 2 === 0)) {
                this.cubeCam.position.copy(this.camera.position);
                this.cubeCam.update(r, this.scene);
            }
            if (this.quality !== 'low') this.renderBloom();
            r.setRenderTarget(null);
            const u = this.warpMat.uniforms, aspect = innerWidth / innerHeight;
            const tanHalf = Math.tan(this.camera.fov * Math.PI / 360), rMax = Math.hypot(aspect, 1);
            u.camRot.value.setFromMatrix4(this.camera.matrixWorld);
            u.aspect.value = aspect; u.tanHalf.value = tanHalf; u.rMax.value = rMax;
            u.extra.value = this.wideExtra(tanHalf, rMax); u.expo.value = T.wideExpo;
            u.wide.value = this.wideNow ? 1 : 0; u.mirror.value = this.mirrorOn ? 1 : 0;
            const m = this.mirrorRect;
            u.mRect.value.set(m.x, m.y, m.w, m.h);
            u.bloom.value = this.quality === 'low' ? 0 : this.bloomStrength;
            r.render(this.warpScene, this.warpCam);
        }
    }

    // Graphics quality: 'high' (default) or 'low' — native pixel ratio, a
    // 768 cube and bloom, vs pixel ratio 1, a 384 cube every other frame,
    // no bloom and no MSAA.
    setQuality(q) {
        if (q === this.quality) return;
        this.quality = q;
        const low = q === 'low';
        this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 2));
        this.cubeRT.setSize(low ? 384 : 768, low ? 384 : 768);
        this.mainRT.samples = low ? 0 : 4;
        this.mainRT.dispose();
        this.resize();
    }

    // Bright parts of the HDR frame → ¼-res bloom texture (bloomA).
    renderBloom() {
        const r = this.renderer, q = this.postQuad, A = this.bloomA, B = this.bloomB;
        q.material = this.brightMat;
        this.brightMat.uniforms.src.value = this.mainRT.texture;
        r.setRenderTarget(A); r.render(this.postScene, this.warpCam);
        q.material = this.blurMat;
        const u = this.blurMat.uniforms;
        for (const spread of [1, 2.5]) {
            u.src.value = A.texture; u.dir.value.set(spread / A.width, 0);
            r.setRenderTarget(B); r.render(this.postScene, this.warpCam);
            u.src.value = B.texture; u.dir.value.set(0, spread / A.height);
            r.setRenderTarget(A); r.render(this.postScene, this.warpCam);
        }
    }

    emit(x, y, z, vx, vy, vz, life, heat, hue = 0) {
        if (this.particles.length >= this.PN * 1.5) return;
        this.particles.push({ x, y, z, vx, vy, vz, t: 0, life, heat, hue });
    }

    makeLodeRig() {
        const g = new THREE.Group();
        const sprite = (tex, op) => new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, blending: THREE.AdditiveBlending,
            depthWrite: false, transparent: true, fog: false, opacity: op }));
        const glow = sprite(this.lodeTex, 0.9), core = sprite(this.lodeTex, 1);
        glow.material.color.setHex(LODE);
        core.material.color.setHex(0x8FC0FF);
        const ringMat = () => new THREE.MeshBasicMaterial({ color: 0x4F95FF, transparent: true, opacity: 0.75,
            blending: THREE.AdditiveBlending, depthWrite: false });
        const ring1 = new THREE.Mesh(this.lodeRingGeo, ringMat()), ring2 = new THREE.Mesh(this.lodeRingGeo, ringMat());
        g.add(glow, core, ring1, ring2);
        this.scene.add(g);
        return { g, glow, core, ring1, ring2 };
    }

    // One tractor beam: mouth → orb, bright blue at the dragon, icy at the
    // orb, with sparks streaming back along it.
    beamTo(d, x, y, z, time) {
        if (this.nBeams >= MAX_BEAMS) return;
        const mx = d.pos.x + d.fwd.x * d.r, my = d.pos.y + d.fwd.y * d.r, mz = d.pos.z + d.fwd.z * d.r;
        // A ribbon facing the camera: narrow at the mouth, wide at the orb.
        const cp = this.camera.position;
        const ax = x - mx, ay = y - my, az = z - mz;
        const vx = cp.x - mx, vy = cp.y - my, vz = cp.z - mz;
        let sx = ay * vz - az * vy, sy = az * vx - ax * vz, sz = ax * vy - ay * vx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const wa = 0.12 + d.r * 0.08, wb = 0.55;
        sx /= sl; sy /= sl; sz /= sl;
        const pa = this.beamGeo.attributes.position.array, ca = this.beamGeo.attributes.color.array, k = this.nBeams++ * 18;
        const A1 = [mx - sx * wa, my - sy * wa, mz - sz * wa], A2 = [mx + sx * wa, my + sy * wa, mz + sz * wa];
        const B1 = [x - sx * wb, y - sy * wb, z - sz * wb], B2 = [x + sx * wb, y + sy * wb, z + sz * wb];
        const f = 0.7 + 0.3 * Math.sin(time * 40 + k);
        const cA = [0.25 * f, 0.5 * f, 1.0 * f], cB = [0.1 * f, 0.22 * f, 0.55 * f];
        [A1, B1, B2, A1, B2, A2].forEach((v, i) => {
            pa[k + i * 3] = v[0]; pa[k + i * 3 + 1] = v[1]; pa[k + i * 3 + 2] = v[2];
            const c = v === A1 || v === A2 ? cA : cB;
            ca[k + i * 3] = c[0]; ca[k + i * 3 + 1] = c[1]; ca[k + i * 3 + 2] = c[2];
        });
        if (Math.random() < 0.6) {
            const u = Math.random();
            const px = x + (mx - x) * u, py = y + (my - y) * u, pz = z + (mz - z) * u;
            const dx = mx - x, dy = my - y, dz = mz - z, L = Math.hypot(dx, dy, dz) || 1, v = 25;
            this.emit(px, py, pz, dx / L * v + d.vdir.x * d.speed, dy / L * v + d.vdir.y * d.speed, dz / L * v + d.vdir.z * d.speed, 0.25, 1.2, 1);
        }
    }

    // A tail tip bitten off: a puff of the victim's colour (plus gold).
    biteBurst(x, y, z, color) {
        for (let k = 0; k < 40; k++) {
            _s.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 8);
            this.emit(x, y, z, _s.x, _s.y, _s.z, 0.4 + Math.random() * 0.4, 1.4, k % 3 ? 0 : 1);
        }
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
        for (const h of this.heads.values()) { this.scene.remove(h.g); h.mat.dispose(); h.mat2.dispose(); }
        this.heads.clear();
    }
}

// Spiky 'Bit' shape: raise a pyramid on every face of a polyhedron.
function stellate(geo, h) {
    const src = geo.toNonIndexed().attributes.position.array, out = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), apex = new THREE.Vector3();
    for (let i = 0; i < src.length; i += 9) {
        a.fromArray(src, i); b.fromArray(src, i + 3); c.fromArray(src, i + 6);
        apex.copy(a).add(b).add(c).divideScalar(3).normalize().multiplyScalar(h);
        for (const [p, q] of [[a, b], [b, c], [c, a]]) out.push(p.x, p.y, p.z, q.x, q.y, q.z, apex.x, apex.y, apex.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    g.computeVertexNormals();
    return g;
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
uniform samplerCube cube; uniform sampler2D mainTex; uniform sampler2D bloomTex; uniform float bloom; uniform mat3 camRot;
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
        float k = wide > 0.5 ? smoothstep(0.0, 0.04, min(edge.x, edge.y)) : 1.0;
        if (k > 0.0) col = mix(col, texture2D(mainTex, uvN), k);
        col.rgb += texture2D(bloomTex, uvN).rgb * bloom * k;
    }
    gl_FragColor = col;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

const BRIGHT_FRAG = `
uniform sampler2D src; uniform float thr; varying vec2 vUv;
void main() {
    vec3 c = texture2D(src, vUv).rgb;
    float l = max(max(c.r, c.g), c.b);
    gl_FragColor = vec4(c * (max(0.0, l - thr) / max(l, 1e-4)), 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D src; uniform vec2 dir; varying vec2 vUv;
void main() {
    vec3 s = texture2D(src, vUv).rgb * 0.2270270;
    s += (texture2D(src, vUv + dir * 1.3846154).rgb + texture2D(src, vUv - dir * 1.3846154).rgb) * 0.3162162;
    s += (texture2D(src, vUv + dir * 3.2307692).rgb + texture2D(src, vUv - dir * 3.2307692).rgb) * 0.0702703;
    gl_FragColor = vec4(s, 1.0);
}`;

function wrap(v, size) {
    const h = size / 2;
    return ((v + h) % size + size) % size - h;
}

function skyDome(top, mid, horizon, radius = 1500) {
    const geo = new THREE.SphereGeometry(radius, 32, 16);
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


// ------------------------------------------------ landscape (Skyhold / The Orb)
const NOISE_GLSL = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
    return v;
}`;

// A sea of clouds below Skyhold: drifting fbm billows, warm-lit tops and
// cool shadows, melting into the haze with distance.
function cloudSea(arena, haze) {
    const mat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, top: { value: new THREE.Color(0xEFD9BE) }, shade: { value: new THREE.Color(0x6F6479) },
            haze: { value: new THREE.Color(haze) } },
        vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: NOISE_GLSL + `
            uniform float time; uniform vec3 top, shade, haze; varying vec3 vW;
            void main() {
                vec2 p = vW.xz * 0.011 + vec2(time * 0.012, time * 0.005);
                float n = fbm(p) * 0.65 + fbm(p * 2.6 - vec2(time * 0.02, 0.0)) * 0.45;
                float c = smoothstep(0.38, 0.82, n);
                vec3 col = mix(shade, top, c);
                float d = length(vW.xz - cameraPosition.xz);
                col = mix(col, haze, clamp(1.0 - exp(-pow(d / 900.0, 1.6) * 2.2), 0.0, 1.0));
                gl_FragColor = vec4(col, 1.0);
                #include <colorspace_fragment>
            }`,
    });
    const m = new THREE.Mesh(new THREE.CircleGeometry(arena.radius * 6, 96), mat);
    m.rotation.x = -Math.PI / 2; m.position.y = arena.floor - 0.05;
    return m;
}

// Tall karst pillars (Zhangjiajie-style) rising from the clouds outside
// the storm wall, pines on top. Purely scenery.
function karstPillars(arena) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x4E4A45, roughness: 0.95, flatShading: true });
    const pine = new THREE.MeshStandardMaterial({ color: 0x1F3528, roughness: 0.9, flatShading: true });
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2, dist = arena.radius * (1.7 + rnd() * 1.8);
        const h = 90 + rnd() * 300, r = 10 + rnd() * 22;
        const geo = new THREE.CylinderGeometry(r * (0.7 + rnd() * 0.3), r * 1.25, h, 9, 10);
        const pos = geo.attributes.position;
        for (let v = 0; v < pos.count; v++) {
            const y = pos.getY(v), k = 1 + (Math.sin(y * 0.09 + i) * 0.12 + (rnd() - 0.5) * 0.18);
            pos.setX(v, pos.getX(v) * k); pos.setZ(v, pos.getZ(v) * k);
        }
        geo.computeVertexNormals();
        const col = new THREE.Mesh(geo, stone);
        col.position.set(Math.cos(a) * dist, arena.floor + h / 2 - 20, Math.sin(a) * dist);
        g.add(col);
        for (let t = 0; t < 5; t++) {
            const tr = new THREE.Mesh(new THREE.ConeGeometry(2 + rnd() * 3, 7 + rnd() * 8, 6), pine);
            const ta = rnd() * Math.PI * 2, td = rnd() * r * 0.7;
            tr.position.set(col.position.x + Math.cos(ta) * td, arena.floor + h - 20 + 4, col.position.z + Math.sin(ta) * td);
            g.add(tr);
        }
    }
    return g;
}

// One ring of distant mountains, flat-coloured like an ink-wash layer
// (no fog: each ring is pre-tinted lighter with distance).
function ridgeRing(radius, base, amp, color, seed) {
    const N = 360, pos = [];
    const ht = (a) => {
        let v = 0, f = 1, w = 1;
        for (let o = 0; o < 4; o++) { v += w * (0.5 + 0.5 * Math.sin(a * f * 3 + seed * 1.7 + o * 2.1) * Math.cos(a * f * 5.3 + seed)); f *= 2.1; w *= 0.5; }
        return base + amp * Math.pow(v / 1.9, 1.6);
    };
    for (let k = 0; k < N; k++) {
        const a0 = k / N * Math.PI * 2, a1 = (k + 1) / N * Math.PI * 2;
        const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius, x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
        const h0 = ht(a0), h1 = ht(a1);
        pos.push(x0, base - 80, z0, x1, base - 80, z1, x1, h1, z1, x0, base - 80, z0, x1, h1, z1, x0, h0, z0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -0.5;
    return m;
}

// The low golden sun on the horizon (scenery; the arena's heat "sun" is separate).
function lowSun(tex, dir) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xFFD08A, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, fog: false }));
    s.position.copy(dir).normalize().multiplyScalar(1400);
    s.scale.setScalar(900);
    s.renderOrder = -0.8;
    s.onBeforeRender = (r, sc, cam) => { s.position.copy(dir).normalize().multiplyScalar(1400).add(cam.position); };
    return s;
}

// Storm wall as a faint golden qi curtain: slow flowing bands, brighter low
// down; `warn` (0..1) lights it up as you get close.
function qiWall(R, H) {
    const mat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, warn: { value: 0 }, col: { value: new THREE.Color(0xFFD28A) } },
        vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: NOISE_GLSL + `
            uniform float time, warn; uniform vec3 col; varying vec2 vUv; varying vec3 vW;
            void main() {
                float a = atan(vW.z, vW.x);
                float flow = fbm(vec2(a * 18.0, vUv.y * 6.0 - time * 0.25));
                float low = 0.45 + 0.55 * (1.0 - vUv.y);
                float alpha = (0.05 + 0.3 * warn) * low * (0.55 + 0.9 * flow);
                gl_FragColor = vec4(col * (1.0 + 2.0 * warn), alpha);
                #include <colorspace_fragment>
            }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    return new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 96, 1, true), mat);
}

// The Orb's night: a slow nebula of indigo, teal and gold behind the stars.
function nebulaDome() {
    const mat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } }, side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: NOISE_GLSL + `
            uniform float time; varying vec3 vP;
            void main() {
                vec2 p = vec2(atan(vP.z, vP.x) * 2.0, vP.y * 3.0);
                float n = fbm(p * 1.3 + time * 0.003), m = fbm(p * 2.7 - 3.0);
                vec3 c = vec3(0.012, 0.01, 0.035);
                c += vec3(0.08, 0.035, 0.15) * smoothstep(0.5, 0.88, n);
                c += vec3(0.012, 0.09, 0.1) * smoothstep(0.6, 0.92, m);
                c += vec3(0.25, 0.15, 0.05) * pow(smoothstep(0.62, 0.95, n * m * 1.6), 2.0);
                gl_FragColor = vec4(c, 1.0);
                #include <colorspace_fragment>
            }`,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(1450, 48, 24), mat);
    m.renderOrder = -1;
    m.onBeforeRender = (r, s, cam) => m.position.setFromMatrixPosition(cam.matrixWorld);
    return m;
}

// ------------------------------------------------ Chinese-dragon parts
// Body material: PBR plus, in the segment's own space, a cream belly and
// overlapping scales (drawn in the shader, no textures).
function scaleMaterial(opts) {
    const m = new THREE.MeshStandardMaterial(opts);
    m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSeg;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeg = position;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSeg;')
            .replace('#include <color_fragment>', `#include <color_fragment>
                float belly = smoothstep(0.1, -0.6, vSeg.y);
                vec2 q = vec2(atan(vSeg.x, vSeg.y) * 1.6, vSeg.z * 2.2);
                q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
                vec2 f = fract(q) - vec2(0.5, 0.15);
                float edge = smoothstep(0.32, 0.5, length(f * vec2(1.0, 0.75)));
                diffuseColor.rgb *= 1.0 - 0.32 * edge * (1.0 - belly);
                vec3 cream = vec3(0.93, 0.8, 0.52) * (0.7 + 0.3 * diffuseColor.rgb);
                diffuseColor.rgb = mix(diffuseColor.rgb, cream, belly * 0.85);
                diffuseColor.rgb *= 1.0 - 0.2 * belly * smoothstep(0.8, 1.0, fract(vSeg.z * 2.0 + 0.5));`);
    };
    return m;
}

// One crest fin: a curved flame, base along +z (toward the head) at y = 0,
// tip at y = 1 swept back toward the tail.
function finGeometry() {
    const sh = new THREE.Shape();
    sh.moveTo(0.5, 0);
    sh.quadraticCurveTo(0.35, 0.55, -0.35, 1.0);
    sh.quadraticCurveTo(-0.2, 0.45, -0.5, 0);
    sh.lineTo(0.5, 0);
    const g = new THREE.ShapeGeometry(sh, 6);
    // Shape is in XY; turn it so X runs along the body (z) and Y is up.
    g.rotateY(-Math.PI / 2);
    return g;
}

function merged(parts) {
    const pos = [], nor = [];
    for (const [geo, mat4] of parts) {
        const gg = geo.index ? geo.toNonIndexed() : geo.clone();
        gg.applyMatrix4(mat4);
        pos.push(...gg.attributes.position.array); nor.push(...gg.attributes.normal.array);
        gg.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return out;
}

// Head in units of 1.25 × r, looking down −z: long snout and jaw, amber
// eyes with slit pupils, a flame mane and beard, deer-like antlers.
function dragonHeadParts() {
    const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
        new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    const sph = new THREE.SphereGeometry(1, 16, 12), cone = new THREE.ConeGeometry(1, 1, 7), cyl = new THREE.CylinderGeometry(1, 1, 1, 6);
    const skin = merged([
        [sph, M(0, 0.08, 0.05, 0.72, 0.58, 0.9)],             // skull
        [sph, M(0, 0.02, -0.95, 0.42, 0.3, 1.0, -0.06)],      // long snout
        [sph, M(0, -0.3, -0.85, 0.36, 0.14, 0.85, 0.22)],     // lower jaw, a little open
        [sph, M(0.3, 0.3, -0.42, 0.17, 0.12, 0.36, 0, 0, 0.35)],  // brow ridges
        [sph, M(-0.3, 0.3, -0.42, 0.17, 0.12, 0.36, 0, 0, -0.35)],
        [sph, M(0.26, 0.12, -1.72, 0.1, 0.09, 0.1)],          // nostrils
        [sph, M(-0.26, 0.12, -1.72, 0.1, 0.09, 0.1)],
    ]);
    const accent = merged([
        [sph, M(0, 0.14, -1.78, 0.24, 0.16, 0.2)],            // nose pad
        ...[-0.55, -0.3, 0, 0.3, 0.55].map((x, i) => [cone, M(x, 0.25 - Math.abs(x) * 0.3, 0.55, 0.16, 0.95, 0.16, 1.9 + Math.abs(x) * 0.4, x * 0.6, 0)]),   // mane flames
        ...[-0.2, 0, 0.2].map((x) => [cone, M(x, -0.55, -0.55, 0.08, 0.55, 0.08, Math.PI - 0.5, 0, 0)]),   // beard
    ]);
    const eyes = merged([[sph, M(0.33, 0.22, -0.55, 0.16, 0.14, 0.17)], [sph, M(-0.33, 0.22, -0.55, 0.16, 0.14, 0.17)]]);
    const pupils = merged([[sph, M(0.41, 0.22, -0.64, 0.03, 0.11, 0.05)], [sph, M(-0.41, 0.22, -0.64, 0.03, 0.11, 0.05)]]);
    const fangs = merged([-0.22, 0.22].flatMap((x) => [[cone, M(x, -0.16, -1.45, 0.05, 0.22, 0.05, Math.PI, 0, 0)], [cone, M(x * 0.8, -0.28, -1.2, 0.035, 0.15, 0.035, 0, 0, 0)]]));
    const antlerParts = [];
    for (const sx of [-1, 1]) {
        antlerParts.push([cyl, M(0.32 * sx, 0.72, 0.25, 0.06, 1.0, 0.06, -0.9, 0, -0.35 * sx)]);     // main beam
        antlerParts.push([cyl, M(0.42 * sx, 0.95, 0.25, 0.045, 0.45, 0.045, -0.2, 0, -0.7 * sx)]);   // front tine
        antlerParts.push([cyl, M(0.46 * sx, 1.0, 0.72, 0.04, 0.4, 0.04, -1.4, 0, -0.5 * sx)]);       // rear tine
    }
    const crownParts = [];
    for (const sx of [-1, 1]) {
        crownParts.push([cyl, M(0.58 * sx, 1.25, 0.55, 0.035, 0.45, 0.035, -0.6, 0, -1.0 * sx)]);
        crownParts.push([cyl, M(0.3 * sx, 1.28, 0.85, 0.035, 0.4, 0.035, -1.1, 0, -0.2 * sx)]);
    }
    // Whisker: a thin tube curving out and back from the snout, then drooping.
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.4, -0.05, 0.25),
        new THREE.Vector3(-0.8, -0.25, 0.9), new THREE.Vector3(-1.05, -0.55, 1.7), new THREE.Vector3(-1.1, -0.9, 2.5)]);
    const whisker = new THREE.TubeGeometry(curve, 20, 0.035, 5, false);
    return { skin, accent, eyes, pupils, fangs, antlers: merged(antlerParts), crown: merged(crownParts), whisker };
}

function disposeTree(o) {
    o.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
    });
}
