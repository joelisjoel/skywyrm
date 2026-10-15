// Visit totals (privacy.html): one anonymous note per page visit, so we
// can see how many people come, roughly where from, whether they come back
// and how far they get, without being able to tell any two visits apart.
// Everything is worked out here, on the device. The note is only
//   {v: 1, src, tag, ret, today, dev, stage, lives, secs, invited}
// - src: a category made from the referrer's host. The referrer itself
//   never leaves the device.
// - tag: the link's ?src= tag, only if it is in VISIT_TAGS.
// - ret: how long ago this device first came, as a bucket, sent only with
//   the device's first visit of the day. The dates stay in this browser
//   (wyrm.visit.v1); today: its first visit today.
// - dev, stage, lives, secs, invited: touch or mouse, the furthest step
//   this visit reached, lives finished, seconds played, an invite sent.
// The game server checks every field against the same lists (stats.js
// cleanVisit), so they live here and reach it through shared.js. Nothing
// in this file runs on import: the server only reads the lists.

export const VISIT_SOURCES = ['direct', 'search', 'social', 'video', 'games', 'other'];
export const VISIT_TAGS = ['invite', 'share', 'qr', 'reddit', 'hn', 'ph', 'itch', 'iogames', 'youtube', 'tiktok', 'discord', 'school', 'club', 'family', 'test'];
export const VISIT_RETURNS = ['new', 'd0', 'd1', 'd2-6', 'd7', 'd8-29', 'd30+', 'old'];
export const VISIT_DEVICES = ['touch', 'mouse'];
// The funnel, in order: the game loaded, started a game, finished a life,
// started a second life or game, joined a room.
export const VISIT_STAGES = ['menu', 'play', 'life', 'again', 'online'];
export const VISIT_MAX = { lives: 50, secs: 7200 };

const KEY = 'wyrm.visit.v1';
const DAY_MS = 24 * 3600 * 1000;

// Referrer host → category. A name ending in '.' matches that label before
// any ending (google.com, google.co.uk, news.google.com); a whole name
// matches itself and its subdomains (x.com, someone.itch.io).
const SOURCE_HOSTS = {
    search: ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'ecosia.', 'baidu.', 'yandex.', 'brave.'],
    social: ['facebook.', 'instagram.', 'reddit.', 'x.com', 't.co', 'twitter.', 'discord.', 'linkedin.', 'pinterest.', 'threads.'],
    video: ['youtube.', 'youtu.be', 'tiktok.', 'twitch.'],
    games: ['itch.io', 'iogames.space', 'io-games.zone', 'crazygames.', 'poki.', 'newgrounds.', 'coolmathgames.', 'kongregate.'],
};

// host: the referrer's hostname ('' for none); self: this page's own host,
// so moving between the site's own pages (or a local test page) is direct.
export function visitSource(host, self = '') {
    const h = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!h || /(^|\.)skywyrm\.io$/.test(h) || h === String(self || '').toLowerCase()) return 'direct';
    for (const [src, names] of Object.entries(SOURCE_HOSTS)) {
        for (const n of names) {
            if (n.endsWith('.') ? h.startsWith(n) || h.includes('.' + n) : h === n || h.endsWith('.' + n)) return src;
        }
    }
    return 'other';
}

// A ?src= value → the tag, or undefined if it isn't one of VISIT_TAGS.
export function visitTag(v) {
    const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
    return VISIT_TAGS.includes(t) ? t : undefined;
}

export const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s));

// rec: the saved {first, last} days (or null); today: 'YYYY-MM-DD' (UTC);
// played: an older profile shows this browser has played before.
// → {ret, today}: the bucket, and whether this is the first visit today.
export function visitReturn(rec, today, played = false) {
    if (!rec || typeof rec !== 'object' || !isDay(rec.first)) return { ret: played ? 'old' : 'new', today: true };
    const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(rec.first)) / DAY_MS));   // a clock set back counts as today
    const ret = days === 0 ? 'd0' : days === 1 ? 'd1' : days <= 6 ? 'd2-6' : days === 7 ? 'd7' : days <= 29 ? 'd8-29' : 'd30+';
    return { ret, today: rec.last !== today };
}

// Read this device's first and last visit days and save today as the
// last. storage() returns localStorage; if it is blocked (it throws), the
// visit is 'new' and today's first.
export function visitDays(today, storage = () => globalThis.localStorage) {
    try {
        const ls = storage();
        let rec = null;
        try { rec = JSON.parse(ls.getItem(KEY)); } catch { /* a broken record: start again */ }
        const read = (k) => { try { return JSON.parse(ls.getItem(k)) || {}; } catch { return {}; } };
        const s = read('wyrm.settings.v1'), p = read('wyrm.profile.v1');
        const r = visitReturn(rec, today, Number(s.runs) > 0 || Number(p.lives) > 0 || Number(p.games) > 0);
        const first = rec && isDay(rec.first) && rec.first <= today ? rec.first : today;
        ls.setItem(KEY, JSON.stringify({ first, last: today }));
        return r;
    } catch {
        return { ret: 'new', today: true };
    }
}

// The note itself, from what a Visit counted. The return bucket goes only
// with the device's first visit of the day, so the server's `ret` counts
// devices, not visits, and needs no second field to say so.
export function visitNote(v) {
    const clamp = (n, max) => Math.round(Math.min(max, Math.max(0, Number(n) || 0)));
    return { v: 1, src: v.src, ...(v.tag ? { tag: v.tag } : {}), ...(v.today ? { ret: v.ret } : {}), today: !!v.today, dev: v.touch ? 'touch' : 'mouse',
        stage: VISIT_STAGES[Math.max(0, Math.min(VISIT_STAGES.length - 1, v.stage | 0))],
        lives: clamp(v.lives, VISIT_MAX.lives), secs: clamp(v.secs, VISIT_MAX.secs), invited: !!v.invited };
}

// One page visit, in the browser. main.js reports what happens (reach,
// started, lifeDone, played, invited); the note goes once, when the visit
// ends: the first time the page is hidden, or when it's closed.
export class Visit {
    // base: the game server ('' sends nothing); isTouch(): touch or mouse.
    constructor(base, isTouch) {
        this.base = base;
        this.isTouch = isTouch;
        this.stage = 0; this.starts = 0; this.lives = 0; this.secs = 0; this.invited = false; this.sent = false;
        let ref = '';
        try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch { /* not a URL */ }
        this.src = visitSource(ref, location.hostname);
        this.tag = takeTag();
        const r = visitDays(utcDay());
        this.ret = r.ret; this.today = r.today;
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.send(); });
        addEventListener('pagehide', () => this.send());
    }

    // onReach(stage): called once per step, the first time this visit gets there.
    reach(stage) {
        const i = VISIT_STAGES.indexOf(stage);
        if (i > this.stage) { this.stage = i; if (this.onReach) this.onReach(stage); }
    }
    // A life began: the first is 'play', any after it 'again'.
    started() { this.reach(++this.starts > 1 ? 'again' : 'play'); }
    lifeDone() { this.lives++; this.reach('life'); }
    played(dt) { this.secs += dt; }

    send() {
        if (this.sent) return;
        this.sent = true;
        if (!this.base) return;
        const note = visitNote({ ...this, touch: this.isTouch() });
        try {
            fetch(this.base + '/api/visit', { method: 'POST', mode: 'cors', keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer',
                headers: { 'content-type': 'text/plain' }, body: JSON.stringify(note) }).catch(() => {});
        } catch { /* ignore */ }
    }
}

// The ?src= link tag, then take it out of the address bar so a copied link
// doesn't pass it on. Every other parameter (room, dev, server) and the
// #fragment stay as they were.
function takeTag() {
    try {
        const q = new URLSearchParams(location.search);
        if (!q.has('src')) return undefined;
        const tag = visitTag(q.get('src'));
        history.replaceState(history.state, '', location.pathname + withoutParam(location.search, 'src') + location.hash);
        return tag;
    } catch { return undefined; }
}

// A query string ('?a=1&src=qr') without one parameter, leaving the others
// exactly as they were written.
export function withoutParam(search, name) {
    const keep = String(search || '').replace(/^\?/, '').split('&').filter((p) => {
        if (!p) return false;
        try { return decodeURIComponent(p.split('=')[0].replace(/\+/g, ' ')) !== name; } catch { return true; }
    });
    return keep.length ? '?' + keep.join('&') : '';
}
