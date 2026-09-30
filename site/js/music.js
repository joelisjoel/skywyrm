// Adaptive soundtrack, synthesised live (no assets). D minor, 118 BPM, a
// 32-bar form over three progressions. Layers follow the game:
//   level 0 (menu, pause, death card): pad, soft arpeggio, long bass notes
//   level 1 (flying): + driving bass, kick, off-beat hats, brighter arp
//   level 2 (action: boosting, top 3, dragonfire, kills): + snare, 16th hats,
//            the lead melody, crashes on phrase starts
// Level changes land on bar lines, and stingers (power-ups, tier-ups, kills)
// land on the next 16th in the current key, so effects sound like part of
// the song rather than on top of it.

const BPM = 118, BEAT = 60 / BPM, STEP = BEAT / 4;
const D4 = 293.66;
const hz = (semi) => D4 * 2 ** (semi / 12);      // semitones from D4
const _ = null;

// Chords as [root (semitones from D), 'm' | 'M'].
const PROG = {
    A: [[0, 'm'], [-4, 'M'], [3, 'M'], [-2, 'M']],       // Dm Bb F  C
    B: [[5, 'm'], [-4, 'M'], [0, 'm'], [7, 'M']],        // Gm Bb Dm A
    C: [[-4, 'M'], [-2, 'M'], [0, 'm'], [0, 'm']],       // Bb C  Dm Dm
};
const FORM = ['A', 'A', 'B', 'A', 'C', 'B', 'A', 'B'];
// Lead melody, one row per bar in 8ths (semitones from D4).
const LEAD = {
    A: [[7, _, 12, _, _, 14, 15, _], [15, _, _, 14, 12, _, _, _], [10, _, 15, _, _, 17, 19, _], [17, _, 14, _, 10, _, _, _]],
    B: [[12, _, 8, _, 5, _, 8, 12], [15, _, 12, _, 8, _, 12, 15], [19, _, _, 17, 15, _, 14, 12], [11, _, 14, _, 19, _, _, _]],
    C: [[15, _, _, _, 14, _, 12, _], [14, _, _, _, 10, _, _, _], [12, _, _, _, _, _, _, _], [_, _, _, _, 7, _, 10, _]],
};
const ARP = [0, 2, 4, 2, 3, 2, 4, 5, 0, 2, 4, 2, 3, 5, 4, 2];

// Layer mix per level: [pad, arp, bass, drums, lead].
const MIX = [[0.9, 0.45, 0.5, 0, 0], [0.7, 0.8, 1, 0.9, 0], [0.6, 0.85, 1, 1, 1]];

const mod12 = (v) => ((v % 12) + 12) % 12;
function triad(root, q) { return [root, root + (q === 'm' ? 3 : 4), root + 7]; }

export class Music {
    constructor(ctx, out, noise) {
        this.ctx = ctx; this.noise = noise;
        this.on = true;
        this.level = 0; this.want = 0; this.paused = false;
        this.step = 0; this.nextT = 0;
        this.chord = [0, 'm'];

        const c = ctx;
        this.bus = c.createGain(); this.bus.gain.value = 0;              // fades in on start
        this.muffle = c.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000; this.muffle.Q.value = 0.5;
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
        this.bus.connect(this.muffle).connect(comp).connect(out);

        // Reverb (generated impulse) and a dotted-8th delay.
        this.verb = c.createConvolver();
        this.verb.buffer = impulse(c, 2.4, 2.2);
        const vg = c.createGain(); vg.gain.value = 0.35;
        this.verb.connect(vg).connect(this.bus);
        this.delay = c.createDelay(1); this.delay.delayTime.value = BEAT * 0.75;
        const fb = c.createGain(); fb.gain.value = 0.32;
        const dl = c.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2500;
        const dg = c.createGain(); dg.gain.value = 0.3;
        this.delay.connect(dl).connect(fb).connect(this.delay);
        dl.connect(dg).connect(this.bus);

        // Sidechain-style pump on pad/arp/bass, ducked by every kick.
        this.pump = c.createGain(); this.pump.connect(this.bus);
        const layer = (dest, verb = 0, dly = 0) => {
            const g = c.createGain(); g.gain.value = 0; g.connect(dest);
            if (verb) { const s = c.createGain(); s.gain.value = verb; g.connect(s).connect(this.verb); }
            if (dly) { const s = c.createGain(); s.gain.value = dly; g.connect(s).connect(this.delay); }
            return g;
        };
        this.L = {
            pad: layer(this.pump, 0.6), arp: layer(this.pump, 0.25, 0.5), bass: layer(this.pump),
            drums: layer(this.bus, 0.12), lead: layer(this.bus, 0.45, 0.35),
        };
        this.stingBus = layer(this.bus, 0.35, 0.15); this.stingBus.gain.value = 1;
        this.arpFilter = c.createBiquadFilter(); this.arpFilter.type = 'lowpass'; this.arpFilter.frequency.value = 1400;
        this.arpFilter.connect(this.L.arp);
        this.dist = c.createWaveShaper(); this.dist.curve = driveCurve(6); this.dist.connect(this.stingBus);
        this.applyMix(0, c.currentTime);

        this.timer = setInterval(() => this.tick(), 25);
    }

    // ------------------------------------------------ control
    setOn(on) {
        this.on = on;
        const t = this.ctx.currentTime;
        this.bus.gain.cancelScheduledValues(t);
        this.bus.gain.setTargetAtTime(on ? 0.45 : 0, t, on ? 0.6 : 0.15);
        if (on) this.nextT = 0;
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
        const m = MIX[level];
        ['pad', 'arp', 'bass', 'drums', 'lead'].forEach((k, i) => this.L[k].gain.setTargetAtTime(m[i], t, 0.35));
        this.arpFilter.frequency.setTargetAtTime([1400, 3200, 4800][level], t, 0.5);
    }

    // ------------------------------------------------ sequencer
    tick() {
        if (!this.on || this.ctx.state !== 'running') return;
        const now = this.ctx.currentTime;
        if (this.nextT < now - 0.1) this.nextT = now + 0.05;          // first start, or the tab slept
        while (this.nextT < now + 0.15) {
            this.playStep(this.step, this.nextT);
            this.nextT += STEP; this.step++;
        }
    }

    playStep(n, t) {
        const s = n % 16, bar = Math.floor(n / 16);
        const part = FORM[Math.floor(bar / 4) % FORM.length], bi = bar % 4;
        const [root, q] = PROG[part][bi];
        this.chord = [root, q];
        if (s === 0 && this.want !== this.level) { this.level = this.want; this.applyMix(this.level, t); }
        const lv = this.level;
        const tones = triad(mod12(root), q);

        // Pad: a new chord each bar.
        if (s === 0) this.pad(tones.map((v) => (v > 6 ? v - 12 : v)), t, BEAT * 4);
        // Arpeggio: 16ths (8ths when calm).
        if (lv > 0 || s % 2 === 0) {
            const set = [...tones, ...tones.map((v) => v + 12)];
            this.pluck(hz(set[ARP[s]]), t, lv > 0 ? 0.22 : 0.4, lv > 0 ? 0.11 : 0.08);
        }
        // Bass: 8ths with octave hops when flying; one long note per half bar when calm.
        const b = mod12(root) - 24;
        if (lv === 0) { if (s % 8 === 0) this.bassNote(hz(b), t, BEAT * 2, 0.22); }
        else if (s % 2 === 0) this.bassNote(hz(b + (lv > 1 && (s === 6 || s === 14) ? 12 : 0)), t, STEP * 1.8, 0.24);
        // Drums.
        if (lv > 0) {
            if (s % 4 === 0) this.kick(t, 0.9);
            if (lv > 1) {
                if (s === 4 || s === 12) this.snare(t, 0.5);
                if (bi === 3 && s >= 13) this.snare(t, 0.25 + 0.1 * (s - 12));   // fill into the next bar
                this.hat(t, s % 2 ? 0.07 : 0.12, s % 4 === 2);
                if (bi === 0 && s === 0 && bar % 4 === 0) this.crash(t, 0.22);
            } else if (s % 4 === 2) this.hat(t, 0.1, false);
        }
        // Lead melody (8ths).
        if (lv > 1 && s % 2 === 0) {
            const row = LEAD[part][bi], k = s / 2, note = row[k];
            if (note !== null) {
                let len = 1;
                while (k + len < 8 && row[k + len] === null && len < 4) len++;
                this.leadNote(hz(note), t, STEP * 2 * len * 0.92);
            }
        }
    }

    // Next 16th on the grid (so stingers land in time).
    grid() {
        const now = this.ctx.currentTime;
        if (!this.on || !this.nextT) return now + 0.01;
        let t = this.nextT;
        while (t - STEP > now + 0.01) t -= STEP;
        return t;
    }

    // ------------------------------------------------ instruments
    env(g, t, a, peak, d, sustain = 0.0001) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + a);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    }

    osc(type, f, t, dur, dest, detune = 0) {
        const o = this.ctx.createOscillator();
        o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
        o.connect(dest); o.start(t); o.stop(t + dur + 0.05);
        return o;
    }

    pad(semis, t, dur) {
        const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.setValueAtTime(700, t); f.frequency.linearRampToValueAtTime(1300, t + dur * 0.5);
        f.frequency.linearRampToValueAtTime(800, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.35);
        g.gain.setValueAtTime(0.05, t + dur - 0.1);
        g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.5);
        f.connect(g).connect(this.L.pad);
        for (const s of semis) for (const dt of [-8, 8]) this.osc('sawtooth', hz(s), t, dur + 0.5, f, dt);
    }

    pluck(f, t, dur, gain) {
        const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(700, t + dur);
        this.env(g, t, 0.004, gain, dur);
        this.osc('square', f, t, dur, lp);
        lp.connect(g).connect(this.arpFilter);
    }

    bassNote(f, t, dur, gain) {
        const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 6;
        lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(220, t + Math.min(dur, 0.3));
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
        g.gain.setValueAtTime(gain, t + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        this.osc('sawtooth', f, t, dur, lp);
        this.osc('sine', f, t, dur, g);
        lp.connect(g).connect(this.L.bass);
    }

    leadNote(f, t, dur) {
        const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 2800; lp.Q.value = 2;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
        g.gain.setValueAtTime(0.08, t + Math.max(0.03, dur - 0.08));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
        const vib = c.createOscillator(), vd = c.createGain();
        vib.frequency.value = 5.5; vd.gain.setValueAtTime(0, t); vd.gain.linearRampToValueAtTime(9, t + 0.25);
        vib.connect(vd);
        for (const [type, det] of [['sawtooth', -6], ['square', 6]]) {
            const o = this.osc(type, f, t, dur + 0.15, lp, det);
            vd.connect(o.detune);
        }
        vib.start(t); vib.stop(t + dur + 0.2);
        lp.connect(g).connect(this.L.lead);
    }

    kick(t, gain) {
        const c = this.ctx, o = c.createOscillator(), g = c.createGain();
        o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
        o.connect(g).connect(this.L.drums); o.start(t); o.stop(t + 0.4);
        this.pump.gain.setValueAtTime(0.55, t);
        this.pump.gain.linearRampToValueAtTime(1, t + 0.2);
    }

    noiseHit(t, dur, type, freq, gain, dest = this.L.drums, q = 0.7) {
        const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        s.buffer = this.noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
        g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g).connect(dest);
        s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
    }

    snare(t, gain) {
        this.noiseHit(t, 0.16, 'highpass', 1400, gain * 0.7);
        const c = this.ctx, o = c.createOscillator(), g = c.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
        g.gain.setValueAtTime(gain * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        o.connect(g).connect(this.L.drums); o.start(t); o.stop(t + 0.12);
    }

    hat(t, gain, open) { this.noiseHit(t, open ? 0.18 : 0.045, 'highpass', 7500, gain); }
    crash(t, gain, dest) { this.noiseHit(t, 1.6, 'highpass', 4200, gain, dest || this.L.drums); }

    // Brassy stab through the stinger bus.
    brass(f, t, dur, gain, dest = this.stingBus) {
        const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 3;
        lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(4200, t + 0.08);
        lp.frequency.exponentialRampToValueAtTime(1400, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        for (const det of [-7, 0, 7]) this.osc('sawtooth', f, t, dur, lp, det);
        lp.connect(g).connect(dest);
    }

    bell(f, t, dur, gain) {
        const c = this.ctx, g = c.createGain();
        this.env(g, t, 0.003, gain, dur);
        this.osc('sine', f, t, dur, g);
        this.osc('sine', f * 2.01, t, dur * 0.5, g);
        g.connect(this.stingBus);
    }

    // ------------------------------------------------ stingers
    // Duck the song briefly so the stinger reads.
    duck(t, depth = 0.45, len = 0.7) {
        const g = this.pump.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(depth, t); g.linearRampToValueAtTime(1, t + len);
    }

    sting(kind) {
        const t = this.grid(), S = STEP;
        switch (kind) {
            case 'shield':      // Ember Shield: a warm rising brass call + sparkle
                this.duck(t);
                [3, 7, 10, 15].forEach((n, i) => this.brass(hz(n), t + i * S, i === 3 ? 0.8 : 0.25, 0.07));
                [27, 31, 34].forEach((n, i) => this.bell(hz(n), t + 3 * S + i * S * 0.5, 0.6, 0.035));
                this.noiseHit(t, 0.7, 'bandpass', 500, 0.25, this.stingBus, 1.2);
                break;
            case 'magnet': {    // Lodestone: an FM "lock-on" sweep, then two blips
                this.duck(t);
                const c = this.ctx, car = c.createOscillator(), mod = c.createOscillator(), md = c.createGain(), g = c.createGain();
                car.frequency.setValueAtTime(hz(-24), t); car.frequency.exponentialRampToValueAtTime(hz(12), t + 0.42);
                mod.frequency.setValueAtTime(hz(-24) * 2, t); mod.frequency.exponentialRampToValueAtTime(hz(12) * 2, t + 0.42);
                md.gain.setValueAtTime(400, t); md.gain.exponentialRampToValueAtTime(30, t + 0.5);
                mod.connect(md).connect(car.frequency);
                g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
                car.connect(g).connect(this.stingBus);
                car.start(t); mod.start(t); car.stop(t + 0.6); mod.stop(t + 0.6);
                this.bell(hz(19), t + 4 * S, 0.35, 0.06);
                this.bell(hz(24), t + 5 * S, 0.5, 0.06);
                break;
            }
            case 'fire': {      // Dragonfire: distorted power chord, crash and a roar
                this.duck(t, 0.3, 1.2);
                for (const n of [-24, -17, -12]) this.brass(hz(n), t, 1.1, 0.12, this.dist);
                this.crash(t, 0.3, this.stingBus);
                this.noiseHit(t, 0.9, 'lowpass', 700, 0.35, this.stingBus, 1);
                this.brass(hz(-12), t + 2 * S, 0.9, 0.05);
                break;
            }
            case 'tier':        // Growing a size: fanfare up the chord
                this.duck(t);
                [0, 3, 7, 12].forEach((n, i) => this.brass(hz(n), t + i * S, 0.22, 0.07));
                this.brass(hz(19), t + 4 * S, 0.9, 0.08);
                this.brass(hz(12), t + 4 * S, 0.9, 0.05);
                this.crash(t + 4 * S, 0.2, this.stingBus);
                break;
            case 'leader':      // Taking #1: the big one
                this.duck(t, 0.3, 1.6);
                [0, 7, 12, 15, 19].forEach((n, i) => this.brass(hz(n), t + i * 2 * S, i === 4 ? 1.4 : 0.35, 0.08));
                this.brass(hz(12), t + 8 * S, 1.4, 0.06);
                this.crash(t + 8 * S, 0.3, this.stingBus);
                for (let i = 0; i < 4; i++) this.kick(t + (4 + i) * S, 0.6);
                break;
            case 'kill': {      // A stab on the current chord
                const [root, q] = this.chord;
                for (const n of triad(mod12(root), q)) this.brass(hz(n + 12), t, 0.3, 0.05);
                this.snare(t, 0.4);
                break;
            }
            case 'death':       // Falling minor line
                this.duck(t, 0.2, 2.5);
                [7, 3, 0, -5].forEach((n, i) => this.bell(hz(n), t + i * 2 * S, 0.9, 0.05));
                break;
            case 'empty':       // Out of thrust: a sagging note
                this.brass(hz(7), t, 0.5, 0.05);
                break;
        }
    }
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
