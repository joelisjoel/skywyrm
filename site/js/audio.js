// Synthesised sound (spec §11) — no assets. Feel-first: wind that rises
// with speed, an orb chime ladder, whooshes for near misses.
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];

export class Audio {
    constructor() {
        this.ctx = null; this.muted = false; this.volume = 0.6;
        this.ladder = 0; this.lastEat = 0;
    }

    // Must be called from a user gesture (browser autoplay rules).
    unlock() {
        if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
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
    }

    setMuted(m) {
        this.muted = m;
        if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
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
        this.tone(523.25 * 2 ** (PENTA[this.ladder] / 12), 0.18, 'sine', 0.12);
    }

    nearMiss() { this.whoosh(0.4, 400, 4000, 0.5); }
    boostStart() { this.whoosh(0.3, 150, 900, 0.25); }
    kill() { [0, 4, 7, 12].forEach((n, i) => this.tone(440 * 2 ** (n / 12), 0.25, 'square', 0.07, i * 0.06)); }
    tier() { [0, 4, 7, 12, 16].forEach((n, i) => this.tone(392 * 2 ** (n / 12), 0.35, 'triangle', 0.12, i * 0.08)); }
    powerup() { this.tone(880, 0.3, 'sine', 0.15); this.tone(1320, 0.4, 'sine', 0.1, 0.08); }
    shieldPop() { this.whoosh(0.25, 2000, 200, 0.4); this.tone(660, 0.3, 'triangle', 0.15, 0, 220); }
    fire() { this.whoosh(0.5, 200, 1200, 0.5); this.tone(110, 0.4, 'sawtooth', 0.08, 0, 60); }
    death() { this.whoosh(0.8, 1500, 80, 0.6); this.tone(220, 0.8, 'sawtooth', 0.12, 0, 40); }
}
