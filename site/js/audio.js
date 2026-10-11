// Synthesised sound (spec §11) — no assets. Feel-first: wind that rises
// with speed, an orb chime ladder, whooshes for near misses, and the
// adaptive soundtrack (music.js) with power-up stingers in its key.
import { Music } from './music.js?v=10';
import { Voice } from './voice.js?v=2';

// D minor pentatonic, so orb chimes sit inside the soundtrack.
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29];

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
        // Noise buffer shared by wind and whooshes.
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const ch = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        // Continuous wind.
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise; src.loop = true;
        this.windFilter = this.ctx.createBiquadFilter();
        this.windFilter.type = 'bandpass'; this.windFilter.Q.value = 0.7; this.windFilter.frequency.value = 400;
        this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0;
        src.connect(this.windFilter).connect(this.windGain).connect(this.master);
        src.start();
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

    wind(speed, active) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const g = active ? Math.min(0.35, 0.04 + (speed / 30) ** 2 * 0.3) : 0;
        this.windGain.gain.setTargetAtTime(g, t, 0.15);
        this.windFilter.frequency.setTargetAtTime(250 + speed * 45, t, 0.15);
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

    whoosh(dur = 0.35, from = 300, to = 3000, gain = 0.35) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const s = this.ctx.createBufferSource(); s.buffer = this.noise;
        const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
        f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g).connect(this.master);
        s.start(t, Math.random()); s.stop(t + dur + 0.05);
    }

    // Orbs eaten in quick succession climb a pentatonic ladder.
    eat(now) {
        this.ladder = now - this.lastEat < 0.6 ? Math.min(PENTA.length - 1, this.ladder + 1) : 0;
        this.lastEat = now;
        this.tone(587.33 * 2 ** (PENTA[this.ladder] / 12), 0.18, 'sine', 0.1);
    }

    nearMiss() { this.whoosh(0.4, 400, 4000, 0.5); }
    boostStart() { this.whoosh(0.3, 150, 900, 0.25); }
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
    // Flaming pearl: a bright bell run up the pentatonic and a shimmer.
    pearl() {
        [0, 3, 5, 7, 10, 12].forEach((n, i) => {
            const f = 587.33 * 2 ** (n / 12);
            this.tone(f, 0.5, 'sine', 0.07, i * 0.06);
            this.tone(f * 2, 0.35, 'triangle', 0.025, i * 0.06 + 0.01);
        });
        this.tone(2349.3, 1.1, 'sine', 0.04, 0.4);
        this.whoosh(0.7, 1500, 6000, 0.12);
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
