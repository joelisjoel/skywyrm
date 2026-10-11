// The dragon's voice: a deep warrior shout in Mandarin for power-ups and
// big moments. Three phrases per event (a different one each time), with
// pinyin and English for the on-screen caption. Clips live in
// audio/voice/<event>-<n>.mp3 — pre-rendered with an open (Apache-2.0)
// neural TTS voice, pitched down with a sub-octave growl, bass and a
// cavern echo. They load after the first click and play through the
// same master volume, ducking the music while the dragon speaks.
export const PHRASES = {
    shield: [{ zh: "金钟罩！", py: "jīn zhōng zhào", en: "Golden Bell Shield!" }, { zh: "刀枪不入！", py: "dāo qiāng bú rù", en: "No blade can pierce me!" }, { zh: "铜墙铁壁！", py: "tóng qiáng tiě bì", en: "Walls of bronze and iron!" }],
    magnet: [{ zh: "吸星大法！", py: "xī xīng dà fǎ", en: "The star-drinking art!" }, { zh: "万物归我！", py: "wàn wù guī wǒ", en: "All things come to me!" }, { zh: "八方来聚！", py: "bā fāng lái jù", en: "Gather from every direction!" }],
    fire: [{ zh: "火龙出世！", py: "huǒ lóng chū shì", en: "The fire dragon awakens!" }, { zh: "烈火焚天！", py: "liè huǒ fén tiān", en: "Fire that burns the sky!" }, { zh: "看我龙焰！", py: "kàn wǒ lóng yàn", en: "Behold my dragon flame!" }],
    sever: [{ zh: "一刀两断！", py: "yì dāo liǎng duàn", en: "Cut in two with one stroke!" }, { zh: "横扫千军！", py: "héng sǎo qiān jūn", en: "I sweep away a thousand soldiers!" }, { zh: "势如破竹！", py: "shì rú pò zhú", en: "Like splitting bamboo!" }],
    kill: [{ zh: "手下败将！", py: "shǒu xià bài jiàng", en: "Another fallen foe!" }, { zh: "不堪一击！", py: "bù kān yì jī", en: "Not even one blow!" }, { zh: "胜者为王！", py: "shèng zhě wéi wáng", en: "The victor is king!" }],
    death: [{ zh: "胜败乃兵家常事。", py: "shèng bài nǎi bīng jiā cháng shì", en: "Win or lose, such is war." }, { zh: "卷土重来！", py: "juǎn tǔ chóng lái", en: "I will return like a storm!" }, { zh: "我会回来的！", py: "wǒ huì huí lái de", en: "I will be back!" }],
    tier: [{ zh: "更上一层楼！", py: "gèng shàng yì céng lóu", en: "Higher still!" }, { zh: "龙腾四海！", py: "lóng téng sì hǎi", en: "The dragon soars over the four seas!" }, { zh: "势不可挡！", py: "shì bù kě dǎng", en: "Unstoppable!" }],
    leader: [{ zh: "天下无敌！", py: "tiān xià wú dí", en: "Invincible under heaven!" }, { zh: "唯我独尊！", py: "wéi wǒ dú zūn", en: "I alone am supreme!" }, { zh: "龙王在此！", py: "lóng wáng zài cǐ", en: "The Dragon King is here!" }],
};

// Higher speaks over lower; equal or lower waits its turn (dropped).
const PRIORITY = { shield: 1, magnet: 1, fire: 1, tier: 2, sever: 3, kill: 3, leader: 4, death: 5 };

export class Voice {
    constructor(ctx, out, music) {
        this.ctx = ctx; this.music = music;
        this.bus = ctx.createGain(); this.bus.gain.value = 1.1;
        this.bus.connect(out);
        this.buffers = {};                  // 'shield-0' → AudioBuffer
        this.last = {};                     // event → last index used
        this.playing = null;                // { src, pri, until }
        this.on = true;
        this.load();
    }

    load() {
        for (const [ev, rows] of Object.entries(PHRASES)) {
            rows.forEach(async (_, i) => {
                const key = `${ev}-${i}`;
                try {
                    const r = await fetch(`audio/voice/${key}.mp3`);
                    if (r.ok) this.buffers[key] = await this.ctx.decodeAudioData(await r.arrayBuffer());
                } catch { /* offline or blocked: that line stays silent (the caption still shows) */ }
            });
        }
    }

    // Cut the line being spoken (the tab was hidden).
    stop() {
        if (!this.playing) return;
        try { this.playing.src.stop(); } catch { /* already done */ }
        this.playing = null;
    }

    // Speak one of the event's phrases. Returns the phrase (for a caption)
    // or null if it didn't play.
    say(ev) {
        const rows = PHRASES[ev];
        if (!this.on || !rows) return null;
        const t = this.ctx.currentTime, pri = PRIORITY[ev] || 1;
        if (this.playing && t < this.playing.until) {
            if (pri <= this.playing.pri) return null;
            try { this.playing.src.stop(); } catch { /* already done */ }
        }
        let i = Math.floor(Math.random() * rows.length);
        if (rows.length > 1 && i === this.last[ev]) i = (i + 1) % rows.length;
        const buf = this.buffers[`${ev}-${i}`];
        this.last[ev] = i;
        if (!buf) return rows[i];                 // not loaded (yet): caption only
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.bus);
        src.start(t);
        this.playing = { src, pri, until: t + buf.duration };
        if (this.music) this.music.duck(t, 0.35, buf.duration + 0.3);
        return rows[i];
    }
}
