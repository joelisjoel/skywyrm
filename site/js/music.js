// Adaptive soundtrack, synthesised live (no assets, no loops): an original
// score in Chinese pentatonic modes, composed while it plays. Home is D yu
// (D F G A C, the orb-chime scale); sections wander to shang, zhi and gong
// colours. The band: guzheng (a plucked string rendered once, Karplus-
// Strong, and replayed at any pitch, with bends, tremolo and glissandi),
// dizi and xiao flutes (breathy, grace notes, vibrato), erhu (bowed,
// sliding), sheng chords, ruan bass, and a percussion section of dagu,
// bangu, muyu, cymbals and gongs (rendered one-shots).
//
// A phrase (4 bars) is written at a time from a motif: stated, developed
// (sequence, inversion, retrograde, new rhythm), handed between two voices
// (call and response), and closed with a cadence: open on the 5th, then
// home. Each phrase starts where the last one ended (fish bites tail).
// Sections (A theme / B contrast / C lyrical / X opera-drum break) rotate
// the lead voice, accompaniment, drums and key, and a new theme replaces
// the old one every few sections. Layers follow the game:
//   level 0 (menu, pause, death card), 80 BPM: sheng, zheng, xiao or erhu
//   level 1 (flying), 108 BPM: + ruan, dagu and woodblocks, dizi or erhu
//   level 2 (action), 120 BPM: + full drums, cymbals, 16th-note zheng,
//            both melody voices
// Level changes land on bar lines and the tempo glides; stingers land on
// the next 16th in the current mode, so effects sound like part of the song.

const D4 = 293.66;
const hz = (semi) => D4 * 2 ** (semi / 12);      // semitones from D4
const rnd = Math.random;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
function pickW(pairs) {
    let r = rnd() * pairs.reduce((s, p) => s + p[1], 0);
    for (const p of pairs) if ((r -= p[1]) < 0) return p[0];
    return pairs[0][0];
}

const BPM = [80, 108, 120];
const GLIDE = 0.06;              // the tempo moves this much of the way to its target each 16th
const CAP = 28;                  // most sources sounding at once (accompaniment gives way at CAP - 6)

// Pentatonic modes: semitones above the tonic for the five degrees.
const MODES = { gong: [0, 2, 4, 7, 9], shang: [0, 2, 5, 7, 10], zhi: [0, 2, 5, 7, 9], yu: [0, 3, 5, 7, 10] };
// Keys are [tonic (semitones from D), mode]. The others share most of home's notes.
const HOME = [0, 'yu'];
const AWAY = [[[0, 'shang'], 2], [[0, 'zhi'], 2], [[3, 'gong'], 2], [[7, 'yu'], 1], [[5, 'zhi'], 1], [[-2, 'zhi'], 1]];
// Scale degree d (0 = tonic near D4, 5 = an octave up) → semitones from D4.
const semi = (key, d) => key[0] + MODES[key[1]][((d % 5) + 5) % 5] + 12 * Math.floor(d / 5);
const nearest = (d, deg) => deg + 5 * Math.round((d - deg) / 5);
const band = (d) => (d > 10 ? d - 5 : d < 0 ? d + 5 : d);

// Rhythm cells: one bar of note lengths in 16ths.
const CELLS = [[4, 4, 4, 4], [6, 2, 4, 4], [4, 2, 2, 8], [2, 2, 4, 8], [8, 4, 4], [4, 4, 8], [3, 1, 4, 8], [6, 2, 8],
    [4, 2, 2, 4, 4], [2, 2, 2, 2, 8], [12, 4], [2, 1, 1, 4, 8], [6, 2, 2, 2, 4], [4, 6, 2, 4]];
// Cadences: [length, degrees above the goal] stepping onto it.
const CADENCE = [[[4, 2], [4, 1], [8, 0]], [[2, 1], [2, 2], [4, 1], [8, 0]], [[4, -1], [4, 1], [8, 0]], [[6, 1], [2, 2], [8, 0]],
    [[8, 1], [8, 0]], [[4, 3], [4, 1], [8, 0]], [[4, 0], [2, 1], [2, -1], [8, 0]], [[2, -2], [2, -1], [4, 1], [8, 0]]];
// Where the harmony sits, bar by bar (degrees). Open phrases end on the 5th.
const CENTRES = {
    home: [[0, 0, 3, 0], [0, 4, 3, 0], [0, 2, 1, 0], [0, 3, 4, 0], [3, 3, 4, 0], [0, 1, 4, 0], [4, 3, 1, 0]],
    open: [[0, 0, 1, 3], [0, 4, 0, 3], [0, 2, 4, 3], [3, 0, 1, 3], [0, 3, 0, 3]],
};
// Guzheng accompaniment figures in 8ths: degrees above the bar's centre,
// an octave down (null = rest).
const ZHENG = {
    roll: [[0, 3, 5, 3, 6, 5, 3, 5], [0, 3, 5, 6, 5, 3, 5, 3], [0, 5, 3, 5, 0, 3, 5, 7], [0, 3, 5, 3, 0, 3, 5, 6]],
    osti: [[5, 3, 4, 3, 5, 3, 6, 3], [3, 5, 6, 5, 3, 5, 7, 5], [5, 6, 5, 3, 5, 6, 8, 6]],
    sparse: [[0, null, 5, null, 3, null, null, null], [0, null, null, 3, 5, null, 3, null], [0, null, 3, null, null, null, 5, null]],
};
// Ruan (bass) per level: [step, degrees above the centre].
const RUAN = [null,
    [[[0, 0], [8, 0]], [[0, 0], [6, 3], [8, 0]], [[0, 0], [10, 3], [12, 0]], [[0, 0], [8, 3], [14, 0]]],
    [[[0, 0], [3, 0], [6, 5], [8, 0], [11, 3], [14, 0]], [[0, 0], [4, 3], [6, 0], [8, 0], [12, 3], [14, 5]], [[0, 0], [2, 0], [6, 3], [8, 0], [10, 0], [14, 3]]]];
// Dagu (big drum) grooves and clapper (bangu / muyu) patterns per level, fills.
const DAGU = [null, [[0, 8], [0, 6, 8], [0, 8, 14], [0, 10], [0, 3, 8]],
    [[0, 3, 6, 8, 11, 14], [0, 4, 6, 8, 12, 14], [0, 2, 8, 10, 11, 14], [0, 6, 8, 10, 14, 15], [0, 3, 8, 10, 12]]];
const CLAP = [null, [[4, 12], [2, 6, 10, 14], [4, 10, 12], [6, 14]],
    [[2, 4, 6, 10, 12, 14], [1, 2, 4, 5, 6, 9, 10, 12, 13, 14], [0, 2, 3, 4, 6, 8, 10, 11, 12, 14], [2, 3, 6, 7, 10, 11, 14]]];
const FILL = [[0, 4, 8, 10, 12, 13, 14, 15], [0, 6, 8, 11, 12, 14, 15], [0, 2, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15], [0, 8, 10, 12, 14]];
// Peking-opera gong-and-drum breaks (luogu), two bars each: cang = gong +
// cymbals + drum, cai = small cymbals, tai = small gong, da = clapper.
const LUOGU = [
    [[[0, 'da'], [2, 'da'], [4, 'cang'], [8, 'cai'], [10, 'cang'], [12, 'cai'], [14, 'cai']],
        [[0, 'cang'], [4, 'tai'], [6, 'cai'], [8, 'tai'], [10, 'da'], [12, 'da'], [13, 'da'], [14, 'da'], [15, 'da']]],
    [[[0, 'cang'], [6, 'cai'], [8, 'cang'], [12, 'tai'], [14, 'tai']],
        [[0, 'cang'], [3, 'cai'], [4, 'cang'], [8, 'cai'], [10, 'cai'], [12, 'da'], [13, 'da'], [14, 'da'], [15, 'da']]],
];
// Sections: length in bars, lead voice, zheng figure, drum kit.
const FORMS = {
    A: { bars: [8, 8, 16], lead: [['dizi', 3], ['erhu', 1]], acc: ['roll', 'roll', 'osti'], kit: 'gu' },
    B: { bars: [8], lead: [['erhu', 3], ['zheng', 1]], acc: ['osti', 'dyad'], kit: 'mu' },
    C: { bars: [8], lead: [['zheng', 2], ['erhu', 1], ['xiao', 1]], acc: ['trem', 'sparse'], kit: 'light' },
    X: { bars: [2], lead: [['zheng', 1]], acc: ['roll'], kit: 'opera' },
};
// Melody voices: register (semitones from D4), level, vibrato [Hz, cents].
const VOICES = {
    dizi: { lo: 7, hi: 29, mid: 17, gain: 0.125, vib: [5.6, 20], grace: 0.35 },
    xiao: { lo: -5, hi: 17, mid: 5, gain: 0.14, vib: [4.6, 12], grace: 0.15 },
    erhu: { lo: 0, hi: 22, mid: 10, gain: 0.12, vib: [6, 28] },
    zheng: { lo: -3, hi: 26, mid: 10, gain: 0.3 },
};
// One-shot levels.
const HIT = { dagu: 0.5, bangu: 0.2, muyu: 0.24, xiaobo: 0.14, naobo: 0.18, gong: 0.36, luo: 0.2, swell: 0.26 };
// Layer mix per level: zheng, flute, erhu, sheng, ruan, drums, perc.
const LAYERS = ['zheng', 'flute', 'erhu', 'sheng', 'ruan', 'drums', 'perc'];
const MIX = [[0.9, 0.9, 0.8, 1, 0.8, 0.8, 0.7], [0.8, 1, 0.95, 0.7, 1, 0.9, 0.85], [1.05, 1.25, 1.25, 0.6, 1.1, 1.2, 1.2]];

// A motif: one bar of rhythm and the steps (in scale degrees) between its notes.
function motif() {
    const cell = pick(CELLS).slice(), steps = [];
    let dir = chance(0.5) ? 1 : -1;
    for (let i = 1; i < cell.length; i++) {
        if (i > 1 && chance(0.35)) dir = -dir;
        steps.push(dir * pickW([[1, 6], [2, 3], [3, 1], [0, 0.7]]));
    }
    return { cell, steps };
}

// Develop a motif: invert it, play it backwards, give it a new rhythm, pass
// through a long note, or cut it short. Calm (level 0) merges quick notes.
function vary(m, op, calm) {
    let cell = m.cell.slice(), steps = m.steps.slice();
    if (op === 'invert') steps = steps.map((x) => -x);
    else if (op === 'retro') { cell.reverse(); steps = steps.reverse().map((x) => -x); }
    else if (op === 'rhythm') {
        const alt = CELLS.filter((c) => c.length === cell.length && c.join() !== cell.join());
        if (alt.length) cell = pick(alt).slice();
    } else if (op === 'ornament') {
        const i = cell.indexOf(Math.max(...cell)), x = pick([1, -1]);
        if (cell[i] >= 4) {
            const h = cell[i] >> 1;
            cell.splice(i, 1, h, cell[i] - h);
            if (i < steps.length) steps.splice(i, 1, x, steps[i] - x); else steps.push(x);
        }
    } else if (op === 'trunc' && cell.length > 2) {
        cell[cell.length - 2] += cell.pop();
        steps.pop();
    }
    if (calm) {
        for (let i = 0; i < cell.length - 1;) {
            if (cell[i] >= 4) { i++; continue; }
            cell[i] += cell[i + 1]; cell.splice(i + 1, 1);
            if (i + 1 < steps.length) steps.splice(i, 2, steps[i] + steps[i + 1]); else steps.splice(i, 1);
        }
    }
    return { cell, steps };
}

// Answers in the gaps: as the line holds a long note, the other voice
// echoes the three notes before it, in 8ths.
function echoes(line) {
    const out = [];
    for (let i = 3; i < line.length; i++) {
        const n = line[i], s = n.s + n.len - 6;
        if (n.len < 8 || s < n.s + 2 || n.s + n.len > 64) continue;
        line.slice(i - 3, i).forEach((m, j) => out.push({ s: s + 2 * j, len: 2, d: m.d }));
    }
    return out;
}

export class Music {
    constructor(ctx, out, noise) {
        this.ctx = ctx; this.noise = noise;
        this.on = true;
        this._hold = false;             // tab hidden or muted: schedule nothing
        this.level = 0; this.want = 0; this.paused = false;
        this.step = 0; this.nextT = 0;
        this.bpm = BPM[0]; this.stepDur = 15 / BPM[0];
        this.key = HOME; this.tail = 3;
        this.sec = null; this.phrase = null; this.bar = null; this.sections = 0;
        this.leg = {};                  // melody voice → its held oscillator (legato group)
        this.live = [];                 // end times of the voices sounding (for CAP)
        this.buf = {};                  // rendered instruments (prep fills it, one job a tick)

        const c = ctx;
        this.bus = c.createGain(); this.bus.gain.value = 0;              // fades in on start
        this.muffle = c.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000; this.muffle.Q.value = 0.5;
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
        this.bus.connect(this.muffle).connect(comp).connect(out);

        // A hall (generated impulse) and a soft echo, mostly for the flutes.
        this.verb = c.createConvolver();
        this.verb.buffer = impulse(c, 2.4, 2.2);
        const vg = c.createGain(); vg.gain.value = 0.4;
        this.verb.connect(vg).connect(this.bus);
        this.delay = c.createDelay(1); this.delay.delayTime.value = 0.36;
        const fb = c.createGain(); fb.gain.value = 0.28;
        const dl = c.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2200;
        const dg = c.createGain(); dg.gain.value = 0.25;
        this.delay.connect(dl).connect(fb).connect(this.delay);
        dl.connect(dg).connect(this.bus);

        // Everything but the stingers passes through pump, which ducks under
        // stingers and the dragon's voice.
        this.pump = c.createGain(); this.pump.connect(this.bus);
        const layer = (pan, verb = 0, dly = 0, dest = this.pump) => {
            const g = c.createGain(); g.gain.value = 0;
            let o = g;
            if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; o = g.connect(p); }
            o.connect(dest);
            if (verb) { const s = c.createGain(); s.gain.value = verb; o.connect(s).connect(this.verb); }
            if (dly) { const s = c.createGain(); s.gain.value = dly; o.connect(s).connect(this.delay); }
            return g;
        };
        this.L = {
            zheng: layer(-0.25, 0.35, 0.12), flute: layer(0.3, 0.5, 0.3), erhu: layer(-0.1, 0.4, 0.1),
            sheng: layer(0, 0.5), ruan: layer(0, 0.12), drums: layer(0, 0.18), perc: layer(0.2, 0.28),
        };
        const filt = (type, f, q, dest, gain = 0) => {
            const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain;
            b.connect(dest); return b;
        };
        this.zIn = filt('lowpass', 2800, 0.5, this.L.zheng);                              // brighter as things heat up
        this.eIn = filt('peaking', 1100, 1.4, filt('lowpass', 3400, 0.7, this.L.erhu), 5); // the erhu's nasal box
        this.sIn = filt('lowpass', 1100, 0.6, this.L.sheng);
        this.rIn = filt('lowpass', 1500, 0.7, this.L.ruan);
        this.stingBus = layer(0, 0.35, 0.15, this.bus); this.stingBus.gain.value = 1;
        this.dist = c.createWaveShaper(); this.dist.curve = driveCurve(4); this.dist.connect(this.stingBus);

        // Timbres as harmonic recipes (one oscillator each).
        const wave = (h) => c.createPeriodicWave(new Float32Array(h.length + 1), new Float32Array([0, ...h]));
        this.W = {
            dizi: wave([1, 0.42, 0.3, 0.12, 0.09, 0.05, 0.04, 0.03, 0.025, 0.02, 0.02, 0.015]),   // a little membrane buzz up top
            xiao: wave([1, 0.18, 0.08, 0.03]),
            erhu: wave([1, 0.75, 0.6, 0.5, 0.42, 0.36, 0.3, 0.25, 0.2, 0.17, 0.14, 0.12, 0.1, 0.08]),
            sheng: wave([1, 0.6, 0.45, 0.35, 0.3, 0.22, 0.18, 0.12]),
            suona: wave([1, 0.9, 0.8, 0.75, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.18, 0.15, 0.12]),
        };
        // Render the instruments a little at a time (one short job a tick, so
        // a phone doesn't stall): the middle zheng string first.
        const strike = (name, sr, secs, modes, noise) => {
            const b = c.createBuffer(1, Math.floor(sr * secs), sr), y = b.getChannelData(0), jobs = [];
            for (let i = 0; i < modes.length; i += 3) jobs.push(() => ring(y, sr, modes.slice(i, i + 3)));
            jobs.push(() => { if (noise) burst(y, sr, noise); finish(y, sr); this.buf[name] = b; });
            return jobs;
        };
        const metal = (n, lo, hi, d0, d1) => Array.from({ length: n }, () => [lo + rnd() * (hi - lo), 0.3 + rnd() * 0.4, d0 + rnd() * (d1 - d0)]);
        const G = [1, 1.49, 2, 2.43, 2.82, 3.35, 3.9, 4.63, 5.32, 6.27];
        this.prep = [
            () => { this.buf.zheng = [string(c, 0, 2, 0.3, 0.9986)]; },
            () => { this.buf.zheng.push(string(c, -12, 2.4, 0.3, 0.9988)); },
            () => { this.buf.zheng.push(string(c, 12, 1.5, 0.32, 0.9984)); },
            () => { this.buf.ruan = [string(c, -24, 2.2, 0.45, 0.996)]; },
            ...strike('dagu', 22050, 0.6, [[62, 1, 0.45, 0.002, 1.8], [98, 0.5, 0.2, 0.002, 1.5], [190, 0.4, 0.09]], [0.6, 0.03, false, 0.2]),
            ...strike('bangu', 24000, 0.15, [[1480, 1, 0.04], [2270, 0.6, 0.025], [3400, 0.3, 0.015]], [0.8, 0.012, true, 0.3]),
            ...strike('muyu', 24000, 0.2, [[760, 1, 0.07], [2050, 0.25, 0.025]], [0.3, 0.004, true, 0.5]),
            ...strike('luo', 22050, 1.1, [[560, 1, 0.8, 0.005], [1010, 0.4, 0.5], [1530, 0.25, 0.3]], [0.3, 0.02, true, 0.4]),
            // The big gong (daluo): inharmonic modes that bloom after the strike.
            ...strike('gong', 22050, 3, G.map((r, i) => [118 * r * (0.995 + 0.01 * rnd()), 1 - i * 0.085, 3 - i * 0.25, 0.01 + i * 0.018]), [0.5, 0.25, false, 0.25]),
            () => { this.buf.swell = reverse(c, this.buf.gong, 2.2); },
            ...strike('xiaobo', 24000, 0.7, metal(9, 3000, 9000, 0.15, 0.45), [0.7, 0.2, true, 0.4]),
            ...strike('naobo', 24000, 1.6, metal(12, 1500, 8000, 0.5, 1.4), [0.9, 0.6, true, 0.3]),
        ];
        this.applyMix(0, c.currentTime);

        this.timer = setInterval(() => this.tick(), 25);
    }

    // ------------------------------------------------ control
    get hold() { return this._hold; }
    set hold(h) { this._hold = h; if (h) this.release(this.ctx.currentTime); }

    setOn(on) {
        this.on = on;
        const t = this.ctx.currentTime;
        this.bus.gain.cancelScheduledValues(t);
        this.bus.gain.setTargetAtTime(on ? 0.5 : 0, t, on ? 0.6 : 0.15);
        if (on) this.nextT = 0; else this.release(t);
    }

    // level 0..2, paused muffles the whole mix.
    mood(level, paused) {
        this.want = level;
        if (paused !== this.paused) {
            this.paused = paused;
            const t = this.ctx.currentTime;
            this.muffle.frequency.setTargetAtTime(paused ? 650 : 18000, t, 0.25);
        }
    }

    applyMix(level, t) {
        LAYERS.forEach((k, i) => this.L[k].gain.setTargetAtTime(MIX[level][i], t, 0.35));
        this.zIn.frequency.setTargetAtTime([2800, 4500, 6500][level], t, 0.5);
    }

    // The current mode as a rising ladder (semitones from D, from the tonic
    // nearest D up two and a half octaves), so the orb chimes stay in key.
    ladder() {
        const k = this.key;
        if (this._ladderKey !== k) {
            const t0 = ((k[0] + 5) % 12 + 12) % 12 - 5;
            this._ladderKey = k; this._ladder = Array.from({ length: 13 }, (_, i) => semi(k, i) - k[0] + t0);
        }
        return this._ladder;
    }

    // ------------------------------------------------ sequencer
    // A background tab throttles this timer to about once a second, which
    // would play a stuttering note or two each time: hold until visible.
    tick() {
        if (this.prep.length) this.prep.shift()();
        if (!this.on || this._hold || this.ctx.state !== 'running') return;
        const now = this.ctx.currentTime;
        if (this.nextT < now - 0.1) this.nextT = now + 0.05;          // first start, or the tab slept
        this.advance(now + 0.15);
    }

    // Schedule each 16th up to `until`, gliding the tempo toward the level's.
    // A bug in one bar mustn't stop the song (or reach the crash toast).
    advance(until) {
        while (this.nextT < until) {
            try { this.playStep(this.nextT); } catch (e) { if (!this.warned) { this.warned = true; console.warn('music', e); } }
            this.bpm += (BPM[this.level] - this.bpm) * GLIDE;
            this.stepDur = 15 / this.bpm;
            this.nextT += this.stepDur; this.step++;
        }
    }

    // Seconds the next n 16ths will take, following the glide.
    ahead(n) {
        let bpm = this.bpm, s = 0;
        for (let i = 0; i < n; i++) { s += 15 / bpm; bpm += (BPM[this.level] - bpm) * GLIDE; }
        return s;
    }

    playStep(t) {
        const s = this.step % 16;
        if (s === 0 || !this.bar) this.planBar(t);
        for (const ev of this.bar[s]) this.play(ev, t);
    }

    // Next 16th on the grid (so stingers land in time).
    grid() {
        const now = this.ctx.currentTime;
        if (!this.on || !this.nextT) return now + 0.01;
        let t = this.nextT;
        while (t - this.stepDur > now + 0.01) t -= this.stepDur;
        return t;
    }

    // ------------------------------------------------ the score
    // Each bar is written on its downbeat into this.bar[step] = [events].
    planBar(t) {
        const was = this.level;
        if (this.want !== this.level) { this.level = this.want; this.applyMix(this.level, t); }
        let sec = this.sec;
        // The band comes in (menu → flying): the theme starts right here.
        const up = was === 0 && this.level > 0;
        if (sec && up && sec.at > 0) { sec.bars = sec.at; this.release(t); }
        if (!sec || sec.at >= sec.bars) sec = this.newSection(!sec || up ? 'A' : null);
        const lv = this.level, b = sec.at, pb = b % 4, last = b === sec.bars - 1;
        if (pb === 0) this.newPhrase(sec, lv);
        const bar = this.bar = Array.from({ length: 16 }, () => []);
        const add = (s, ev) => bar[s].push(ev);
        for (const n of this.phrase.bars[pb]) add(n.s & 15, n);
        const c = this.phrase.centres[pb];
        if (sec.kind === 'X') this.luoguBar(add, b);
        else {
            this.zhengBar(add, sec, c, lv, last);
            this.ruanBar(add, c, lv, pb);
            this.shengBar(add, c, pb, lv);
            this.drumBar(add, sec, lv, b, pb);
        }
        // A section opens on the gong; a reversed gong swells into it.
        if (b === 0 && sec.kind !== 'X' && (this.swelled || (lv > 0 && chance(0.7)))) add(0, { v: 'gong', vel: lv ? 1 : 0.6 });
        this.swelled = last && chance(lv ? 0.45 : 0.6);
        if (this.swelled) add(0, { v: 'swell', vel: lv ? 1 : 0.7 });
        sec.at++;
    }

    // A section of kind A (theme), B (contrast), C (lyrical) or X (drum
    // break), never the same twice running (except A).
    newSection(force) {
        const lv = this.level, prev = this.sec ? this.sec.kind : 'X';
        if (this.sections++ % 7 === 0) this.theme = motif();             // a new tune now and then
        const kind = force || pickW([['A', prev === 'A' ? 0.5 : 3], ['B', prev === 'B' ? 0 : 2], ['C', prev === 'C' ? 0 : 1.4], ['X', lv && prev !== 'X' ? 0.7 : 0]]);
        const F = FORMS[kind], lead = pickW(F.lead);
        const sec = {
            kind, at: 0, bars: lv ? pick(F.bars) : F.bars[0], lead, acc: pick(F.acc), kit: F.kit,
            answer: pick(['dizi', 'erhu', 'zheng'].filter((v) => v !== lead && !(lead === 'xiao' && v === 'dizi'))),
            motif: kind === 'A' ? this.theme : kind === 'B' ? vary(this.theme, pick(['invert', 'retro', 'rhythm'])) : motif(),
        };
        const away = { A: 0.15, B: 0.5, C: 0.75, X: 0 }[kind];
        this.key = chance(away) ? pickW(AWAY) : kind === 'X' ? this.key : HOME;
        return (this.sec = sec);
    }

    // Four bars of melody for whoever plays this phrase, plus where the
    // harmony and the grooves sit.
    newPhrase(sec, lv) {
        const calm = lv === 0, open = sec.bars >= 8 && (sec.at / 4) % 2 === 0;
        const ph = this.phrase = {
            bars: [[], [], [], []], centres: pick(CENTRES[open ? 'open' : 'home']),
            dagu: DAGU.map((p) => p && pick(p)), clap: CLAP.map((p) => p && pick(p)), ruan: RUAN.map((p) => p && pick(p)),
            calmBass: chance(0.5),
        };
        if (sec.kind === 'X') return;
        const line = this.line(sec.motif, open, calm);
        let lead = sec.lead, ans = sec.answer;
        if (calm) { if (lead === 'dizi') lead = 'xiao'; if (ans === 'dizi') ans = 'xiao'; } else if (lead === 'xiao' && sec.kind !== 'C') lead = 'dizi';
        const tex = calm ? pickW([['solo', 2], ['call', 2], ['rest', 0.5]]) : pickW([['call', 3], ['solo', 2], ['unison', lv === 2 ? 2 : 0.3], ['rest', 0.25]]);
        const notes = [];
        if (tex === 'call') { this.part(lead, line.filter((n) => n.s < 32), 1, notes); this.part(ans, line.filter((n) => n.s >= 32), 0.85, notes); }
        else if (tex === 'solo') { this.part(lead, line, 1, notes); this.part(ans, echoes(line), 0.6, notes); }
        else if (tex === 'unison') { this.part(lead, line, 1, notes); this.part(ans, line, 0.7, notes); }
        for (const n of notes) ph.bars[n.s >> 4].push(n);
    }

    // The melody: bar 1 states the motif (lightly varied), bar 2 develops it
    // (sequence, inversion, new rhythm, retrograde), bar 3 restates or
    // answers, bar 4 cadences, open on the 5th or home on the tonic.
    // Returns [{s, len, d}]: start (16ths into the phrase), length, degree.
    line(m0, open, calm) {
        const out = [], ops = [pick(['same', 'same', 'rhythm', 'ornament']), pick(['seq', 'seq', 'invert', 'rhythm', 'retro']), pick(['same', 'invert', 'seq', 'ornament', 'trunc'])];
        let d = this.tail + pick([0, 0, 1, -1]), head = d;
        for (let b = 0; b < 3; b++) {
            const m = vary(m0, ops[b], calm);
            if (b) d = ops[b] === 'seq' ? head + pick([-2, -1, 1, 2]) : d + pick([0, 0, 1, -1]);
            head = d = band(d);
            let s = b * 16;
            m.cell.forEach((len, i) => {
                if (i) { const nd = d + m.steps[i - 1]; d = nd > 10 || nd < 0 ? d - m.steps[i - 1] : nd; }   // turn back at the edges
                if (!i || !chance(0.07)) out.push({ s, len, d });          // now and then a breath
                s += len;
            });
        }
        const goal = nearest(d, open ? pick([3, 3, 3, 1]) : 0);
        let s = 48;
        for (const [len, off] of pick(CADENCE)) { out.push({ s, len, d: goal + off }); s += len; }
        this.tail = goal;
        return out;
    }

    // Give a line to a voice: moved by octaves into its register, with its
    // ornaments, and (flutes, erhu) joined into legato groups.
    part(v, line, vel, out) {
        if (!line.length) return;
        const V = VOICES[v], k = this.key, mine = [];
        const avg = line.reduce((a, n) => a + semi(k, n.d), 0) / line.length;
        const sh = 5 * Math.round((V.mid - avg) / 12);
        for (const n0 of line) {
            let d = n0.d + sh, p = semi(k, d);
            while (p > V.hi) p = semi(k, d -= 5);
            while (p < V.lo) p = semi(k, d += 5);
            let len = n0.len;
            // Flutes breathe at the half-phrase.
            if ((v === 'dizi' || v === 'xiao') && len > 1 && (n0.s + len === 32 || ((n0.s + len) % 16 === 0 && chance(0.3)))) len--;
            const prev = mine[mine.length - 1], tied = prev && prev.s + prev.len === n0.s;
            const n = { v, s: n0.s, len, d, p, vel: vel * (n0.s % 16 === 0 ? 1 : n0.s % 4 === 0 ? 0.9 : 0.8) * (0.9 + 0.2 * rnd()) };
            if (v === 'dizi' || v === 'xiao') { if (len >= 3 && !(prev && prev.grace) && chance(V.grace)) n.grace = semi(k, d + 1); }
            else if (v === 'erhu') {
                if (tied && len >= 2 && !prev.slide && Math.abs(p - prev.p) >= 3 && chance(0.4)) n.slide = 0.06 + 0.05 * rnd();
                else if (!tied && len >= 3 && chance(0.35)) n.scoop = semi(k, d - 1);
            } else {
                n.m = true;                                        // zheng melody (not accompaniment)
                if (len >= 8 && chance(0.6)) n.trem = true;
                else if (len >= 4 && chance(0.3)) n.bend = semi(k, d - 1);
            }
            if (len >= 6) n.vib = true;
            mine.push(n);
        }
        // Legato groups: notes that touch share one oscillator.
        for (let i = mine.length - 1, end = 0; i >= 0; i--) {
            const n = mine[i], next = mine[i + 1];
            n.last = !next || n.s + n.len < next.s;
            if (n.last) end = n.s + n.len;
            n.first = i === 0 || mine[i - 1].s + mine[i - 1].len < n.s;
            n.gEnd = end - n.s;
        }
        out.push(...mine);
    }

    // Guzheng accompaniment for a bar: broken chords on the centre, an
    // octave down (16ths in the action), or tremolo, or octave dyads; and a
    // glissando into the next section.
    zhengBar(add, sec, c, lv, last) {
        const k = this.key, base = c - 5;
        const pl = (s, d, len, vel, o) => add(s, { v: 'zheng', p: semi(k, base + d), len, vel, ...o });
        const gliss = last && (lv > 0 || chance(0.5)), end = gliss ? 12 : 16;
        let fam = sec.acc;
        if (lv === 0 && fam === 'osti') fam = 'sparse';
        if (fam === 'trem') {
            pl(0, 0, 4, 0.8);
            if (end > 4) pl(4, pick([5, 3, 6]), end - 4, 0.45, { trem: true });
        } else if (fam === 'dyad') {
            for (const s of lv === 2 ? [0, 4, 8, 12] : [0, 8]) if (s < end) { pl(s, 0, 4, 0.75); pl(s, 5, 4, 0.55); }
            if (lv) { pl(6, 3, 2, 0.45); if (end > 14) pl(14, 3, 2, 0.45); }
        } else {
            const pat = pick(ZHENG[fam]), n = lv === 2 && fam !== 'sparse' ? 16 : 8, w = 16 / n;
            for (let i = 0; i * w < end; i++) {
                let d = pat[i % 8];
                if (n === 16 && i >= 8 && chance(0.5)) d = pat[(i + 3) % 8];   // the second half turns the figure
                if (d === null || (i && chance(lv ? 0.08 : 0.15))) continue;     // a rest here and there
                if (chance(0.1)) d += pick([1, -1]);
                pl(i * w, d, w, i === 0 ? 0.85 : (i * w) % 4 === 0 ? 0.65 : 0.5);
            }
        }
        if (gliss) add(12, { v: 'gliss', d0: base, d1: base + 11, len: 4, vel: lv ? 0.55 : 0.4 });
    }

    ruanBar(add, c, lv, pb) {
        const k = this.key, ph = this.phrase;
        if (!lv) { if (ph.calmBass && pb % 2 === 0) add(0, { v: 'ruan', p: semi(k, c - 10), len: 32, vel: 0.5 }); return; }
        for (const [s, d] of ph.ruan[lv]) {
            if (s && chance(0.12)) continue;
            add(s, { v: 'ruan', p: semi(k, c - 10 + d), len: lv === 2 ? 2 : 4, vel: s ? 0.7 : 0.9, pri: 1 });
        }
    }

    // Sheng: a held chord (root, 5th, octave) while the centre stays put.
    shengBar(add, c, pb, lv) {
        const cs = this.phrase.centres;
        if ((pb && cs[pb - 1] === c) || (lv === 2 && chance(0.4))) return;
        let n = 1;
        while (pb + n < 4 && cs[pb + n] === c) n++;
        const k = this.key;
        add(0, { v: 'sheng', p: semi(k, c - 5), ps: [semi(k, c - 5), semi(k, c - 2), semi(k, c)], len: 16 * n, vel: 1 });
    }

    drumBar(add, sec, lv, b, pb) {
        if (!lv) return;
        const ph = this.phrase, fill = pb === 3 && (lv === 2 || chance(0.5)), light = sec.kit === 'light';
        if (b === 0) add(0, { v: 'naobo', vel: 0.9 });
        else if (pb === 0 && lv === 2) add(0, { v: 'naobo', vel: 0.6 });
        // Big drum: the phrase's groove, nudged each bar, or a fill to close it.
        let gr = fill ? pick(FILL) : ph.dagu[lv].slice();
        if (!fill) {
            if (chance(0.3)) { const s = pick([2, 5, 7, 10, 13, 15]); if (!gr.includes(s)) gr.push(s); }
            if (chance(0.2) && gr.length > 2) gr.splice(1 + Math.floor(rnd() * (gr.length - 1)), 1);
            if (light) gr = gr.filter((s) => s % 8 === 0);
        }
        for (const s of gr) add(s, { v: 'dagu', vel: (s ? 0.6 : 1) * (fill ? 0.5 + 0.5 * s / 15 : 1) * (light ? 0.6 : 1) });
        // Clappers: bangu (gu kit) or muyu woodblocks.
        const inst = sec.kit === 'gu' ? 'bangu' : 'muyu';
        for (const s of ph.clap[light ? 1 : lv]) if (!chance(0.1)) add(s, { v: inst, vel: s % 4 ? 0.6 : 0.85, hi: s % 4 !== 0 });
        if (lv === 2 && !light) { add(4, { v: 'xiaobo', vel: 0.8 }); add(12, { v: 'xiaobo', vel: 0.9 }); }
    }

    luoguBar(add, b) {
        if (!b) this.luogu = pick(LUOGU);
        for (const [s, w] of this.luogu[b]) {
            if (w === 'cang') { add(s, { v: 'gong', vel: 0.6 }); add(s, { v: 'naobo', vel: 0.8 }); add(s, { v: 'dagu', vel: 0.9 }); }
            else if (w === 'cai') add(s, { v: 'xiaobo', vel: 0.9 });
            else if (w === 'tai') add(s, { v: 'luo', vel: 1 });
            else add(s, { v: 'bangu', vel: 0.5 + 0.03 * s, hi: s % 4 !== 0 });
        }
        if (b) add(12, { v: 'gliss', d0: -5, d1: 6, len: 4, vel: 0.5 });
    }

    // ------------------------------------------------ instruments
    play(ev, t) {
        const dur = ev.len * this.stepDur;
        switch (ev.v) {
            case 'zheng':
                if (ev.trem) return this.trem(ev.p, t, dur, ev.vel * (ev.m ? 0.3 : 0.2));
                return this.pluck(this.zIn, this.buf.zheng, ev.p, t + (ev.m ? 0 : rnd() * 0.006), ev.m ? dur + 0.5 : Math.min(0.9, dur + 0.3), ev.vel * (ev.m ? 0.3 : 0.2), ev);
            case 'ruan': return this.pluck(this.rIn, this.buf.ruan, ev.p, t, Math.min(1.6, dur + 0.15), ev.vel * 0.22, ev);
            case 'dizi': case 'xiao': case 'erhu': return this.blow(ev, t, dur);
            case 'sheng': return this.sheng(ev.ps, t, dur, ev.vel);
            case 'gliss': return this.gliss(ev, t, this.zIn);
            case 'swell': {               // ends on the next downbeat
                const b = this.buf.swell, left = this.ahead(16);
                if (b) this.hit('swell', t + Math.max(0, left - b.duration), ev.vel, null, Math.max(0, b.duration - left));
                return;
            }
            default: return this.hit(ev.v, t, ev.vel, null, 0, ev.hi);
        }
    }

    // Voice cap for phones: count the sources sounding (a note may use n);
    // accompaniment (pri 2) gives way first. Stingers don't ask.
    room(t, end, pri = 1, n = 1) {
        const L = this.live;
        for (let i = L.length - 1; i >= 0; i--) if (L[i] <= t) L.splice(i, 1);
        if (L.length + n > (pri === 2 ? CAP - 6 : CAP)) return false;
        for (let i = 0; i < n; i++) L.push(end);
        return true;
    }

    // Guzheng and ruan: the rendered string nearest in pitch, replayed at the
    // note's pitch. A nail-bright attack settles a few cents; a press-bend
    // rises from the note below; long melody notes waver; then it's damped.
    pluck(dest, bank, p, t, ring, vel, o = {}) {
        const vib = o.vib && o.m && ring > 0.8;
        if (!bank || (!o.free && !this.room(t, t + ring, o.m || o.pri ? 1 : 2, vib ? 2 : 1))) return;
        let b = bank[0];
        for (const x of bank) if (Math.abs(x.p - p) < Math.abs(b.p - p)) b = x;   // the string nearest in pitch
        const c = this.ctx, s = c.createBufferSource(), g = c.createGain(), r = hz(p) / b.f, pr = s.playbackRate;
        s.buffer = b.buf;
        if (o.bend) { const r0 = r * hz(o.bend) / hz(p); pr.setValueAtTime(r0, t); pr.setValueAtTime(r0, t + 0.06); pr.exponentialRampToValueAtTime(r, t + 0.2); }
        else { pr.setValueAtTime(r * 1.004, t); pr.exponentialRampToValueAtTime(r, t + 0.07); }
        g.gain.setValueAtTime(vel, t);
        g.gain.setTargetAtTime(0, t + Math.max(0.05, ring - 0.08), 0.03);
        s.connect(g).connect(dest);
        s.start(t); s.stop(t + ring + 0.12);
        if (vib) {
            const l = c.createOscillator(), d = c.createGain();
            l.frequency.value = 5; d.gain.setValueAtTime(0, t); d.gain.linearRampToValueAtTime(r * 0.007, t + 0.5);
            l.connect(d).connect(pr); l.start(t); l.stop(t + ring);
        }
    }

    // Tremolo (yao zhi): the string re-plucked about 14 times a second.
    trem(p, t, dur, vel) {
        if (!this.buf.zheng || !this.room(t, t + dur + 0.4, 1, 2)) return;
        const n = Math.max(2, Math.round(dur * 14)), dt = dur / n;
        for (let i = 0; i < n; i++) {
            const a = Math.sin(Math.PI * (0.2 + 0.7 * i / n));
            this.pluck(this.zIn, this.buf.zheng, p, t + i * dt, i === n - 1 ? 0.5 : dt + 0.06, vel * (0.5 + 0.5 * a), { free: true });
        }
    }

    // Glissando (gua zou): a sweep up the strings through the mode.
    gliss(ev, t, dest, k = this.key) {
        const span = ev.len * this.stepDur, n = ev.d1 - ev.d0;
        if (!this.buf.zheng || (dest !== this.stingBus && !this.room(t, t + span + 0.35, 1, 6))) return;
        for (let i = 0; i <= n; i++) this.pluck(dest, this.buf.zheng, semi(k, ev.d0 + i), t + span * (i / (n + 1)) ** 1.3, i === n ? 0.8 : 0.35, ev.vel * 0.25 * (0.5 + 0.5 * i / n), { free: true });
    }

    // Dizi, xiao and erhu: one oscillator held through each legato group
    // (notes that touch), so a run of notes costs one voice. Flutes tongue
    // each note, lean in with grace notes and breathe; the erhu changes bow,
    // slides between notes and scoops up into them.
    blow(ev, t, dur) {
        const V = VOICES[ev.v], erhu = ev.v === 'erhu', f = hz(ev.p);
        let v = this.leg[ev.v];
        const fresh = ev.first || !v || !v.open || v.end < t - 0.01;
        if (fresh) {
            if (v && v.open) this.quiet(v, t);
            const stop = t + this.ahead(ev.gEnd) * 1.1 + 0.6;
            if (!this.room(t, stop, 1, erhu ? 2 : 3)) { this.leg[ev.v] = null; return; }
            v = this.leg[ev.v] = this.voice(ev.v, t, stop);
        }
        const fr = v.o.frequency, a = v.amp.gain, A = V.gain * ev.vel;
        if (ev.grace) { fr.setValueAtTime(hz(ev.grace), t); fr.setValueAtTime(f, t + 0.045); }
        else if (ev.slide && v.f) { fr.setValueAtTime(v.f, t); fr.exponentialRampToValueAtTime(f, t + ev.slide); }
        else if (ev.scoop) { fr.setValueAtTime(hz(ev.scoop), t); fr.exponentialRampToValueAtTime(f, t + 0.12); }
        else fr.setValueAtTime(f, t);
        v.f = f;
        if (fresh) { a.setValueAtTime(0, t); a.setTargetAtTime(A, t, erhu ? 0.06 : 0.025); }
        else { a.setTargetAtTime(A * (erhu ? 0.6 : 0.35), t, 0.01); a.setTargetAtTime(A, t + 0.03, erhu ? 0.05 : 0.02); }
        if (dur > 0.5) a.setTargetAtTime(A * (erhu ? 1.12 : 0.85), t + 0.15, dur * 0.4);   // the erhu swells, the flute eases
        const dp = v.depth.gain, cents = V.vib[1];
        dp.setValueAtTime(cents * 0.15, t);
        if (dur > 0.35) dp.linearRampToValueAtTime(cents * (ev.vib ? 1 : 0.6), t + Math.min(dur * 0.7, 0.5));
        if (v.ng) { const ng = v.ng.gain; ng.setTargetAtTime(A * 0.5, t, 0.004); ng.setTargetAtTime(A * 0.12, t + 0.03, 0.04); }
        v.end = t + dur;
        if (ev.last) this.quiet(v, t + dur - 0.05);
    }

    voice(kind, t, stop) {
        const c = this.ctx, V = VOICES[kind];
        const o = c.createOscillator(), amp = c.createGain(), lfo = c.createOscillator(), depth = c.createGain();
        o.setPeriodicWave(this.W[kind]);
        lfo.frequency.value = V.vib[0] * (0.95 + 0.1 * rnd());
        depth.gain.value = 0;
        lfo.connect(depth).connect(o.detune);
        amp.gain.value = 0;
        o.connect(amp).connect(kind === 'erhu' ? this.eIn : this.L.flute);
        o.start(t); lfo.start(t); o.stop(stop); lfo.stop(stop);
        const v = { o, amp, depth, end: t, open: true, f: 0 };
        if (kind !== 'erhu') {          // breath: noise through a band-pass under the tone
            const n = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain();
            n.buffer = this.noise; n.loop = true;
            bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.value = kind === 'xiao' ? 1400 : 2600;
            ng.gain.value = 0;
            n.connect(bp).connect(ng).connect(this.L.flute);
            n.start(t, rnd() * 1.5); n.stop(stop);
            v.ng = ng;
        }
        return v;
    }

    // Let a held voice go: at the end of its group, or now (cut: the music
    // stopped, so drop the notes already queued for it).
    quiet(v, t, cut) {
        v.open = false;
        for (const g of v.ng ? [v.amp.gain, v.ng.gain] : [v.amp.gain]) {
            if (cut) g.cancelScheduledValues(t);
            g.setTargetAtTime(0, t, 0.05);
        }
    }

    release(t) {
        for (const k in this.leg) if (this.leg[k] && this.leg[k].open) this.quiet(this.leg[k], t, true);
        this.leg = {};
    }

    // Sheng: a soft reed chord breathing in and out.
    sheng(ps, t, dur, vel) {
        if (!this.room(t, t + dur + 0.6, 2, ps.length)) return;
        const c = this.ctx, g = c.createGain(), A = 0.045 * vel;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(A, t + 0.6);
        g.gain.setValueAtTime(A, t + Math.max(0.6, dur - 0.2)); g.gain.linearRampToValueAtTime(0, t + dur + 0.5);
        g.connect(this.sIn);
        for (const p of ps) {
            const o = c.createOscillator();
            o.setPeriodicWave(this.W.sheng); o.frequency.value = hz(p); o.detune.value = (rnd() - 0.5) * 8;
            o.connect(g); o.start(t); o.stop(t + dur + 0.6);
        }
    }

    // Percussion one-shots. The big gong (daluo) sags in pitch as it rings;
    // the small opera gong (xiaoluo) rises.
    hit(name, t, vel, dest, offset = 0, hi = false) {
        const b = this.buf[name];
        if (!b || (dest !== this.stingBus && !this.room(t, t + b.duration - offset, name === 'gong' || name === 'swell' ? 1 : 2))) return;
        const c = this.ctx, s = c.createBufferSource(), g = c.createGain(), pr = s.playbackRate;
        s.buffer = b;
        if (name === 'gong') { pr.setValueAtTime(1.03, t); pr.exponentialRampToValueAtTime(1, t + 0.8); }
        else if (name === 'luo') { pr.setValueAtTime(0.88, t); pr.exponentialRampToValueAtTime(1, t + 0.15); }
        else if (hi) pr.value = name === 'muyu' ? 1.33 : 1.12;
        else pr.value = 0.97 + 0.06 * rnd();
        g.gain.value = HIT[name] * vel;
        s.connect(g).connect(dest || (name === 'dagu' || name === 'gong' || name === 'swell' ? this.L.drums : this.L.perc));
        s.start(t, offset);
    }

    // ------------------------------------------------ stingers
    // Duck the song briefly so the stinger reads.
    duck(t, depth = 0.45, len = 0.7) {
        const g = this.pump.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(depth, t); g.linearRampToValueAtTime(1, t + len);
    }

    // Suona, the shawm of festivals and battles: bright and nasal, scooping
    // up into the note.
    suona(p, t, dur, gain, dest = this.stingBus) {
        const c = this.ctx, o = c.createOscillator(), g = c.createGain(), f = hz(p);
        o.setPeriodicWave(this.W.suona);
        o.frequency.setValueAtTime(f * 0.94, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.025);
        g.gain.setValueAtTime(gain, t + dur * 0.75);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(dest);
        o.start(t); o.stop(t + dur + 0.05);
    }

    bell(f, t, dur, gain) {
        const c = this.ctx, g = c.createGain(), o = c.createOscillator(), o2 = c.createOscillator();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.frequency.value = f; o2.frequency.value = f * 2.01;
        o.connect(g); o2.connect(g); g.connect(this.stingBus);
        o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur * 0.5);
    }

    sting(kind) {
        if (this._hold) return;
        const t = this.grid(), S = this.stepDur, P = (d) => semi(this.key, d), sb = this.stingBus;
        const zh = (d, at, ring, vel) => this.pluck(sb, this.buf.zheng, P(d), at, ring, vel, { free: true });
        switch (kind) {
            case 'shield':      // Ember Shield: a zheng sweep up to a ringing high note, cymbal shimmer
                this.duck(t);
                this.gliss({ d0: 0, d1: 9, len: 3, vel: 1.2 }, t, sb);
                zh(10, t + 3 * S, 1.4, 0.35);
                this.hit('xiaobo', t + 3 * S, 0.8, sb);
                [12, 14].forEach((d, i) => this.bell(hz(P(d) + 12), t + (4 + i) * S, 0.6, 0.03));
                break;
            case 'magnet': {    // Lodestone: an FM "lock-on" sweep, then a woodblock and a bell
                this.duck(t);
                const c = this.ctx, car = c.createOscillator(), mod = c.createOscillator(), md = c.createGain(), g = c.createGain();
                const f0 = hz(P(-10)), f1 = hz(P(5));
                car.frequency.setValueAtTime(f0, t); car.frequency.exponentialRampToValueAtTime(f1, t + 0.42);
                mod.frequency.setValueAtTime(f0 * 2, t); mod.frequency.exponentialRampToValueAtTime(f1 * 2, t + 0.42);
                md.gain.setValueAtTime(400, t); md.gain.exponentialRampToValueAtTime(30, t + 0.5);
                mod.connect(md).connect(car.frequency);
                g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
                car.connect(g).connect(sb);
                car.start(t); mod.start(t); car.stop(t + 0.6); mod.stop(t + 0.6);
                this.hit('muyu', t + 4 * S, 1, sb, 0, true);
                this.bell(hz(P(8)), t + 5 * S, 0.5, 0.05);
                break;
            }
            case 'fire':        // Dragonfire: two drum strokes, gong and cymbals, a growling suona
                this.duck(t, 0.3, 1.2);
                this.hit('dagu', t, 1.4, sb); this.hit('dagu', t + S, 1, sb);
                this.hit('gong', t, 1.2, sb); this.hit('naobo', t, 1.2, sb);
                for (const d of [-5, -2]) this.suona(P(d), t, 1.0, 0.07, this.dist);
                this.suona(P(0), t + 2 * S, 0.8, 0.05);
                break;
            // The breath crystals: quieter than dragonfire, a colour each.
            case 'ice':         // Ice: a high zheng run like icicles, a bell, a breath of cymbal
                this.duck(t, 0.6, 0.6);
                [10, 12, 11, 13].forEach((d, i) => zh(d, t + i * S * 0.5, 0.5, 0.22));
                this.bell(hz(P(15)), t + 2 * S, 0.9, 0.03);
                this.hit('xiaobo', t + 2 * S, 0.45, sb);
                break;
            case 'bolt':        // Lightning: a clapper crack, the rising opera gong, a crackling tremolo
                this.duck(t, 0.55, 0.6);
                this.hit('bangu', t, 1.1, sb);
                this.hit('luo', t + S, 0.8, sb);
                for (let i = 0; i < 6; i++) zh(i % 2 ? 9 : 10, t + S + i * 0.045, 0.08, 0.13);
                break;
            case 'acid': {      // Acid: woodblock bubbles and a sour, sagging erhu note
                this.duck(t, 0.6, 0.6);
                for (let i = 0; i < 4; i++) this.hit('muyu', t + i * S * 0.75, 0.55 - i * 0.08, sb, 0, i % 2 === 1);
                const c = this.ctx, o = c.createOscillator(), g = c.createGain(), f = hz(P(2));
                o.setPeriodicWave(this.W.erhu);
                o.frequency.setValueAtTime(f, t + S); o.frequency.exponentialRampToValueAtTime(f * 0.84, t + S + 0.4);
                g.gain.setValueAtTime(0.0001, t + S); g.gain.exponentialRampToValueAtTime(0.035, t + S + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + S + 0.45);
                o.connect(g).connect(sb); o.start(t + S); o.stop(t + S + 0.5);
                break;
            }
            case 'tier':        // Growing a size: a suona fanfare up the mode
                this.duck(t);
                [0, 1, 2, 3].forEach((d, i) => this.suona(P(d), t + i * S, 0.2, 0.06));
                this.suona(P(5), t + 4 * S, 0.9, 0.07);
                this.suona(P(3), t + 4 * S, 0.9, 0.04);
                this.hit('naobo', t + 4 * S, 1, sb);
                break;
            case 'leader':      // Taking #1: the big one
                this.duck(t, 0.3, 1.6);
                [0, 2, 3, 5, 7].forEach((d, i) => this.suona(P(d), t + i * 2 * S, i === 4 ? 1.4 : 0.35, 0.075));
                this.suona(P(5), t + 8 * S, 1.4, 0.05);
                for (let i = 0; i < 4; i++) this.hit('dagu', t + (4 + i) * S, 0.7 + 0.15 * i, sb);
                this.hit('gong', t + 8 * S, 1.3, sb); this.hit('naobo', t + 8 * S, 1.2, sb);
                break;
            case 'kill':        // A stab: clapper, cymbals and a suona octave on the tonic
                this.hit('bangu', t, 1.2, sb);
                this.hit('xiaobo', t, 1, sb);
                for (const d of [5, 10]) this.suona(P(d), t, 0.3, 0.045);
                break;
            case 'death':       // A falling line on the zheng over a low gong
                this.duck(t, 0.2, 2.5);
                [5, 3, 2, 0, -2].forEach((d, i) => zh(d, t + i * 2 * S, 1.2, 0.3));
                this.hit('gong', t, 0.6, sb);
                break;
            case 'empty': {     // Out of thrust: a sagging erhu-like note
                const c = this.ctx, o = c.createOscillator(), g = c.createGain(), f = hz(P(3));
                o.setPeriodicWave(this.W.erhu);
                o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.84, t + 0.45);
                g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
                o.connect(g).connect(this.eIn); o.start(t); o.stop(t + 0.55);
                break;
            }
        }
    }
}

// ------------------------------------------------ rendered instruments
// Normalise a rendered buffer and fade its tail (no click at the end).
function finish(y, sr, peak = 0.9) {
    let m = 0;
    for (let i = 0; i < y.length; i++) m = Math.max(m, Math.abs(y[i]));
    const k = m ? peak / m : 0, fade = Math.min(y.length, Math.floor(sr * 0.02));
    for (let i = 0; i < y.length; i++) y[i] *= k;
    for (let i = 0; i < fade; i++) y[y.length - 1 - i] *= i / fade;
}

// A plucked string (Karplus-Strong): one period of bright noise going round
// a slightly lossy averaging loop (S < 0.5 keeps the highs ringing, like
// steel strings), plus the click of a fingernail. Returns its exact pitch.
function string(c, p, secs, S, rho) {
    const sr = c.sampleRate, L = Math.max(4, Math.round(sr / hz(p) - S)), n = Math.floor(sr * secs);
    const b = c.createBuffer(1, n, sr), y = b.getChannelData(0), q = Math.max(1, Math.round(L / 7));
    let lp = 0;
    for (let i = 0; i < L; i++) { lp += (rnd() * 2 - 1 - lp) * 0.6; y[i] = lp; }
    for (let i = L - 1; i >= q; i--) y[i] -= y[i - q];              // plucked near the bridge
    for (let i = L; i < n; i++) y[i] = rho * ((1 - S) * y[i - L] + S * (i > L ? y[i - L - 1] : 0));
    for (let i = 0; i < 96; i++) y[i] += (rnd() * 2 - 1) * 0.4 * (1 - i / 96);
    finish(y, sr);
    return { buf: b, f: sr / (L + S), p };
}

// Struck percussion is decaying sine modes [Hz, level, decay s, attack s,
// start-pitch multiple (drum heads glide down)], added into y; steady
// modes run a two-multiply oscillator. Then a burst of noise [level,
// decay s, bright?, filter].
function ring(y, sr, modes) {
    const n = y.length;
    for (const [f, a, d, at = 0, gl = 1] of modes) {
        const k = Math.exp(-1 / (d * sr)), A = Math.max(1, at * sr);
        let amp = a;
        if (gl === 1) {
            const w = 2 * Math.PI * f / sr, c2 = 2 * Math.cos(w), ph = rnd() * 6.283;
            let s1 = Math.sin(ph - w), s2 = Math.sin(ph - 2 * w);
            for (let i = 0; i < n && amp > 1e-4; i++) { const s0 = c2 * s1 - s2; s2 = s1; s1 = s0; y[i] += s0 * amp * Math.min(1, i / A); amp *= k; }
        } else {
            let ph = 0;
            for (let i = 0; i < n && amp > 1e-4; i++) { ph += 2 * Math.PI * f * (1 + (gl - 1) * Math.exp(-i / (0.06 * sr))) / sr; y[i] += Math.sin(ph) * amp * Math.min(1, i / A); amp *= k; }
        }
    }
}

function burst(y, sr, [a, d, bright, cut]) {
    const k = Math.exp(-1 / (d * sr));
    let amp = a, lp = 0;
    for (let i = 0; i < y.length && amp > 1e-4; i++) { const w = rnd() * 2 - 1; lp += (w - lp) * cut; y[i] += (bright ? w - lp : lp) * amp; amp *= k; }
}

// A reversed gong: swells into the downbeat.
function reverse(c, src, secs) {
    const sr = src.sampleRate, n = Math.min(src.length, Math.floor(secs * sr)), b = c.createBuffer(1, n, sr);
    const s = src.getChannelData(0), y = b.getChannelData(0);
    for (let i = 0; i < n; i++) y[i] = s[n - 1 - i] * (i / n);
    finish(y, sr);
    return b;
}

// Stereo impulse: decaying noise, a cheap but pleasant hall.
function impulse(c, secs, decay) {
    const n = Math.floor(c.sampleRate * secs), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** decay;
    }
    return b;
}

function driveCurve(k) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    return curve;
}
