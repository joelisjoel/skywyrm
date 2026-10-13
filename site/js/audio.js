// Synthesised sound (spec §11) — no assets. Feel-first: soft gusty wind
// that swells into a whoosh when you boost, turn hard or dive, an orb
// chime ladder, whooshes for near misses, and the adaptive soundtrack
// (music.js) with power-up stingers in its mode.
import { Music } from './music.js?v=11';
import { Voice } from './voice.js?v=3';
import { T } from './tunables.js?v=29';

// D minor pentatonic (D yu), the soundtrack's home; once the music is
// running the chimes follow whatever mode it's in.
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29];
// Wind levels: the bed at cruise, and the whoosh at its fullest.
const WIND = { bed: 0.117, whoosh: 0.2 };

// One RBJ biquad pass over a buffer, in place ('lp' or 'hp').
function biquad(x, type, f, q, sr) {
    const w = 2 * Math.PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    const b1 = (type === 'lp' ? 1 - c : -(1 + c)) / a0, b0 = Math.abs(b1) / 2, a1 = -2 * c / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
        const v = x[i], o = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = v; y2 = y1; y1 = o; x[i] = o;
    }
}

// Soft noise for the wind and the airy whooshes: pink noise kept to about
// 140 Hz – 1.3 kHz (nothing up where white noise hisses), 3 s that loop
// without a seam. Made once, on the first tap (a few ms).
function softNoise(ctx, secs = 3) {
    const sr = ctx.sampleRate, n = Math.floor(sr * secs), fade = Math.floor(sr * 0.25), warm = Math.floor(sr * 0.1);
    const x = new Float32Array(warm + n + fade);
    let p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < x.length; i++) {                    // pink (Paul Kellet's economy filter)
        const w = Math.random() * 2 - 1;
        p0 = 0.99765 * p0 + w * 0.099046; p1 = 0.963 * p1 + w * 0.2965164; p2 = 0.57 * p2 + w * 1.0526913;
        x[i] = p0 + p1 + p2 + w * 0.1848;
    }
    biquad(x, 'hp', 140, 0.707, sr);
    biquad(x, 'lp', 1300, 0.541, sr); biquad(x, 'lp', 1300, 1.307, sr);   // 4th-order Butterworth
    const buf = ctx.createBuffer(1, n, sr), y = buf.getChannelData(0);
    let e = 0;
    for (let i = 0; i < n; i++) { y[i] = x[warm + i]; e += y[i] * y[i]; }
    // The tail that runs past the end fades into the head (equal power), so
    // the loop point continues the noise instead of clicking.
    for (let i = 0; i < fade; i++) {
        const a = (i / fade) * Math.PI / 2;
        y[i] = y[i] * Math.sin(a) + x[warm + n + i] * Math.cos(a);
    }
    const k = 0.3 / Math.sqrt(e / n);                      // RMS 0.3
    for (let i = 0; i < n; i++) y[i] *= k;
    return buf;
}

export class Audio {
    constructor() {
        this.ctx = null; this.muted = false; this.volume = 0.6;
        this.musicOn = true; this.music = null;
        this.voiceOn = true; this.voice = null;
        this.ladder = 0; this.lastEat = 0;
        this.hidden = false;
    }

    // Must be called from a user gesture (browser autoplay rules).
    unlock() {
        if (this.ctx) { this.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(this.ctx.destination);
        // White noise for the crisp effects (and the music's percussion).
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const ch = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        // Continuous wind: soft noise through one moving band-pass (the
        // same three nodes the old hiss used), steered by wind().
        this.soft = softNoise(this.ctx);
        const src = this.ctx.createBufferSource();
        src.buffer = this.soft; src.loop = true;
        this.windFilter = this.ctx.createBiquadFilter();
        this.windFilter.type = 'bandpass'; this.windFilter.Q.value = 0.8; this.windFilter.frequency.value = 330;
        this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0;
        src.connect(this.windFilter).connect(this.windGain).connect(this.master);
        src.start();
        const t0 = this.ctx.currentTime;
        this.air = { t: t0, next: t0, g: 1, gTo: 1, f: 1, fTo: 1, m: 0, sentG: -1, sentF: -1 };
        this.music = new Music(this.ctx, this.master, this.noise);
        this.music.setOn(this.musicOn);
        this.music.hold = this.muted || this.hidden;
        this.voice = new Voice(this.ctx, this.master, this.music);
        this.voice.on = this.voiceOn;
    }

    // Wake the context from any stopped state: 'suspended', or iOS's
    // 'interrupted' after a call or an app switch (which may need a tap).
    resume() {
        const c = this.ctx;
        if (!c || this.hidden || c.state === 'running' || c.state === 'closed') return;
        try { const p = c.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* the next tap tries again */ }
    }

    // A hidden tab goes quiet at once: no wind, no shout, no music blips
    // from a throttled scheduler, and the context is suspended. Back on
    // screen, the sound fades in again.
    setHidden(h) {
        this.hidden = h;
        if (!this.ctx) return;
        const t = this.ctx.currentTime, mg = this.master.gain;
        if (this.music) this.music.hold = h || this.muted;
        if (h) {
            mg.cancelScheduledValues(t); mg.setValueAtTime(0, t);
            this.windGain.gain.cancelScheduledValues(t); this.windGain.gain.setValueAtTime(0, t);
            this.air.sentG = -1;                         // wind() sets it again on the way back
            this.hum(false);
            if (this.voice) this.voice.stop();
            try { const p = this.ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
        } else {
            this.resume();
            mg.cancelScheduledValues(t); mg.setTargetAtTime(this.muted ? 0 : this.volume, t, 0.2);
        }
    }

    setMusic(on) { this.musicOn = on; if (this.music) this.music.setOn(on); }
    setVoice(on) { this.voiceOn = on; if (this.voice) this.voice.on = on; }
    // The dragon speaks (Mandarin): returns the phrase for a caption, or null.
    say(ev) { return this.voice && !this.muted ? this.voice.say(ev) : null; }
    mood(level, paused) { if (this.music) this.music.mood(level, paused); }
    sting(kind) { if (this.music) this.music.sting(kind); }

    // Lodestone hum: a low, throbbing drone in D while the beam is on.
    hum(on) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        if (on && !this.humNode) {
            const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter(), lfo = c.createOscillator(), ld = c.createGain();
            f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 3;
            g.gain.value = 0;
            g.gain.setTargetAtTime(0.06, t, 0.2);
            lfo.frequency.value = 7; ld.gain.value = 260;
            lfo.connect(ld).connect(f.frequency);
            const oscs = [73.42, 110, 146.83].map((fr, i) => {
                const o = c.createOscillator(); o.type = i ? 'sawtooth' : 'sine'; o.frequency.value = fr; o.detune.value = i * 4;
                o.connect(f); o.start(t); return o;
            });
            f.connect(g).connect(this.master);
            lfo.start(t);
            this.humNode = { g, oscs: [...oscs, lfo] };
        } else if (!on && this.humNode) {
            const h = this.humNode;
            this.humNode = null;
            h.g.gain.setTargetAtTime(0, t, 0.12);
            // Power-down: the drone sags as it fades.
            for (const o of h.oscs) { if (o.frequency.value > 20) o.frequency.exponentialRampToValueAtTime(o.frequency.value * 0.5, t + 0.5); o.stop(t + 0.6); }
        }
    }

    // Mute (speaker button, M, Settings): the master gain drops to 0 in
    // 20 ms (quick, but no click) and comes back to the same volume. The
    // music scheduler holds meanwhile, so a muted phone isn't building
    // notes nobody hears; unmuted, the song carries on from where it was.
    setMuted(m) {
        this.muted = m;
        if (!this.ctx) return;
        if (this.music) this.music.hold = m || this.hidden;
        if (m && this.voice) this.voice.stop();
        if (this.hidden) return;                        // setHidden(false) restores the level
        const t = this.ctx.currentTime, g = this.master.gain;
        g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(m ? 0 : this.volume, t + 0.02);
    }

    // Wind, every frame. speed (m/s) is heard against this dragon's own
    // cruise speed (speedX × cruise, which climbs as it grows), so a long,
    // fast dragon gets the same soft air, only a little fuller, not a
    // brighter hiss. turn is how fast the nose swings (rad/s), dive the sine
    // of the dive angle.
    // - The bed is quiet at cruise and gusty: every 1.5–4.5 s the air picks
    //   a new strength and colour and drifts there over a second or two.
    // - Moving hard (boost, a sharp turn, a dive) lifts the band and swells
    //   it into a whoosh that fades about half a second after.
    // At most two parameter changes a frame, and none while nothing moves.
    wind(speed, active, speedX = 1, turn = 0, dive = 0) {
        if (!this.ctx) return;
        const a = this.air, t = this.ctx.currentTime, dt = Math.min(0.1, Math.max(0, t - a.t));
        a.t = t;
        if (t >= a.next) {
            a.gTo = 0.5 + 0.7 * Math.random() + (Math.random() < 0.25 ? 0.45 : 0);  // now and then a big gust
            a.fTo = 0.75 + 0.35 * (a.gTo - 0.5) + 0.2 * Math.random();              // stronger air sounds a little brighter
            a.next = t + 1.5 + 3 * Math.random();
        }
        const kg = 1 - Math.exp(-dt / 1.1);
        a.g += (a.gTo - a.g) * kg; a.f += (a.fTo - a.f) * kg;
        const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
        const sx = Math.max(1, speedX), rel = active ? Math.min(1.6, speed / (T.speedCruise * sx)) : 0;
        const turnK = c01((turn / (T.turnCruise * Math.PI / 180) - 0.25) / 0.7);   // full-stick cruise turn ≈ 1
        const mTo = active ? 1 - (1 - 0.65 * turnK) * (1 - 0.85 * c01((rel - 1.1) / 0.5)) * (1 - 0.7 * c01((dive - 0.25) / 0.5)) : 0;
        a.m += (mTo - a.m) * (1 - Math.exp(-dt / (mTo > a.m ? 0.15 : 0.5)));
        const g = active ? WIND.bed * (0.55 + 0.45 * rel) * (1 + 0.12 * Math.log2(sx)) * a.g + WIND.whoosh * a.m ** 1.3 : 0;
        const f = 330 * a.f * (0.85 + 0.15 * rel) + 750 * a.m;
        if (Math.abs(g - a.sentG) > Math.max(0.001, 0.02 * g)) { this.windGain.gain.setTargetAtTime(g, t, 0.12); a.sentG = g; }
        if (g > 0 && Math.abs(f - a.sentF) > 0.015 * f) { this.windFilter.frequency.setTargetAtTime(f, t, 0.12); a.sentF = f; }
    }

    tone(freq, dur, type = 'sine', gain = 0.2, when = 0, slideTo = 0) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime + when;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.master);
        o.start(t); o.stop(t + dur + 0.05);
    }

    // A swept band of noise: white for crisp effects, or soft (the wind's
    // own noise, nothing above ~1.5 kHz) for the airy ones.
    whoosh(dur = 0.35, from = 300, to = 3000, gain = 0.35, soft = false) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const s = this.ctx.createBufferSource(); s.buffer = soft ? this.soft : this.noise;
        const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = soft ? 1.2 : 2;
        f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g).connect(this.master);
        s.start(t, Math.random()); s.stop(t + dur + 0.05);
    }

    // Orbs eaten in quick succession climb a pentatonic ladder, in the
    // music's current mode.
    eat(now) {
        const L = this.music ? this.music.ladder() : PENTA;
        this.ladder = now - this.lastEat < 0.6 ? Math.min(L.length - 1, this.ladder + 1) : 0;
        this.lastEat = now;
        this.tone(587.33 * 2 ** (L[this.ladder] / 12), 0.18, 'sine', 0.1);
    }

    // Air rushing past: soft whooshes, no hiss.
    nearMiss() { this.whoosh(0.45, 300, 1300, 0.28, true); }
    boostStart() { this.whoosh(0.35, 200, 900, 0.1, true); }
    kill() { this.whoosh(0.2, 3000, 600, 0.25); this.sting('kill'); }
    tier() { this.sting('tier'); }
    leader() { this.sting('leader'); }
    // Each power-up has its own effect: a shimmer for the shield, a
    // magnetic zap for the lodestone, a roar for dragonfire (+ a stinger).
    powerup(kind) {
        if (kind === 'shield') { this.whoosh(0.5, 200, 2400, 0.3); this.tone(1174.66, 0.5, 'sine', 0.06, 0.05); }
        else if (kind === 'magnet') { this.tone(1760, 0.08, 'square', 0.04); this.tone(2349.3, 0.12, 'square', 0.035, 0.06); }
        else if (kind === 'fire') { this.whoosh(0.6, 120, 900, 0.45); }
        else if (kind === 'ice') { [2349.3, 2793.8, 3520].forEach((f, i) => this.tone(f, 0.4, 'sine', 0.05, i * 0.06)); }
        else if (kind === 'bolt') { this.tone(880, 0.12, 'square', 0.05, 0, 1760); this.tone(1760, 0.15, 'square', 0.04, 0.08, 3520); }
        else if (kind === 'acid') { for (let i = 0; i < 4; i++) this.tone(350 + i * 120, 0.09, 'sine', 0.06, i * 0.05, 800 + i * 150); }
        this.sting(kind);
    }
    // Flaming pearl: a bright bell run up the music's current mode and a
    // shimmer two octaves above its tonic.
    pearl() {
        const L = this.music ? this.music.ladder() : PENTA;
        L.slice(0, 6).forEach((n, i) => {
            const f = 587.33 * 2 ** (n / 12);
            this.tone(f, 0.5, 'sine', 0.07, i * 0.06);
            this.tone(f * 2, 0.35, 'triangle', 0.025, i * 0.06 + 0.01);
        });
        this.tone(587.33 * 2 ** (L[10] / 12), 1.1, 'sine', 0.04, 0.4);
        this.whoosh(0.7, 1500, 6000, 0.12);
    }
    // A sun crystal is born (rule sunCrystals): a quiet, small cousin of the
    // pearl's bell, three notes up the music's mode, each flavour starting
    // on its own step; k (0–1) softens it with distance from the sun.
    sunCrystal(kind, k = 1) {
        const L = this.music ? this.music.ladder() : PENTA, s = { fire: 0, ice: 2, bolt: 4, acid: 1 }[kind] || 0;
        [0, 2, 4].forEach((n, i) => this.tone(1174.66 * 2 ** (L[s + n] / 12), 0.45, 'sine', 0.03 * k, i * 0.09));
    }
    // Chomp: a short crunch and a rising blip.
    bite() { this.whoosh(0.12, 2500, 400, 0.35); this.tone(392, 0.12, 'square', 0.06, 0, 784); this.tone(1174.66, 0.15, 'sine', 0.06, 0.06); }
    bitten() { this.whoosh(0.2, 800, 150, 0.3); this.tone(293.66, 0.25, 'sawtooth', 0.05, 0, 146.83); }
    shieldPop() { this.whoosh(0.25, 2000, 200, 0.4); this.tone(880, 0.3, 'triangle', 0.15, 0, 293.66); }
    // A bigger breath (more charges) roars longer and deeper.
    fire(lv = 1) {
        const k = Math.max(0, Math.min(8, (lv | 0) - 1));
        this.whoosh(0.5 + 0.15 * k, 200, 1200 + 200 * k, 0.5);
        this.tone(110, 0.4 + 0.12 * k, 'sawtooth', 0.08, 0, 55);
        if (k >= 2) this.tone(55, 0.5 + 0.15 * k, 'sawtooth', 0.05 + 0.01 * k, 0.05, 30);
    }
    // Breath elements: each breath, strike and hit has its own sound.
    breath(el, lv) {
        if (el === 'ice') this.frost(lv);
        else if (el === 'bolt') this.whoosh(0.3, 3000, 6000, 0.2);            // lightning gathers at the mouth
        else if (el === 'acid') this.spit(lv);
        else this.fire(lv);
    }
    frost(lv = 1) { this.whoosh(0.6 + 0.12 * Math.max(0, lv - 1), 2500, 7000, 0.35); [1760, 2349.3, 2793.8].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.04, i * 0.07)); }
    zap() { this.whoosh(0.18, 6000, 800, 0.5); this.tone(1400, 0.25, 'square', 0.06, 0, 90); this.tone(70, 0.4, 'sawtooth', 0.08, 0.02, 40); }
    spit(lv = 1) { this.whoosh(0.3, 400, 1600, 0.4); for (let i = 0; i < 3 + Math.min(5, lv | 0); i++) this.tone(300 + Math.random() * 500, 0.08, 'sine', 0.05, 0.1 + i * 0.06, 700 + Math.random() * 400); }
    // Hit yourself: frozen (a falling glassy note), zapped (a buzz), in acid (a sizzle).
    chilled() { this.tone(2093, 0.6, 'triangle', 0.08, 0, 523.25); this.whoosh(0.5, 5000, 1500, 0.25); }
    stunned() { this.tone(110, 0.5, 'square', 0.07, 0, 80); this.tone(116, 0.5, 'square', 0.05); }
    sizzle() { this.whoosh(0.35, 3500, 5000, 0.3); }
    thrustEmpty() { this.sting('empty'); }
    death() { this.whoosh(0.8, 1500, 80, 0.6); this.tone(220, 0.8, 'sawtooth', 0.1, 0, 40); this.hum(false); this.sting('death'); }
}
