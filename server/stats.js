// Anonymous play totals, one record per UTC day (see site/privacy.html):
// how long dragons grow, how long lives last and how they end. Room lives
// are counted here as they end; a solo game's browser sends one note per
// life (POST /api/run, checked by cleanRun). No names, ids or addresses:
// only these numbers. Saved through store.js, one document per day, and
// the last KEEP_DAYS days are kept.

export const CAUSES = ['wall', 'body', 'headon', 'quit', 'disconnect', 'other'];
export const ARENAS = ['sky', 'orb'];
export const KEEP_DAYS = 30;
// Peak-length histogram (m). A new dragon is 12 m, so 0-15 is "barely ate".
const LEN_BINS = [[15, '0-15'], [25, '15-25'], [50, '25-50'], [100, '50-100'], [200, '100-200'], [Infinity, '200+']];
const MAX = { len: 2000, secs: 7200, kills: 500 };
const DAY_MS = 24 * 3600 * 1000;

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const zeros = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));

function blankSide() {
    return { runs: 0, secs: 0, kills: 0, maxLen: 0, len: zeros(LEN_BINS.map((b) => b[1])), cause: zeros(CAUSES), arena: zeros(ARENAS) };
}
function blankDay(day) {
    return { day, solo: blankSide(), room: blankSide(), peakHumans: 0, roomsCreated: 0 };
}

// A saved day back from the store: only known counters, and only finite,
// non-negative numbers, so an old or odd document can't spoil the totals.
function fromStored(m) {
    if (!m || typeof m.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.day)) return null;
    const copy = (to, from) => {
        if (!from || typeof from !== 'object') return;
        for (const k of Object.keys(to)) {
            if (typeof to[k] === 'object') copy(to[k], from[k]);
            else if (typeof to[k] === 'number' && Number.isFinite(from[k]) && from[k] >= 0) to[k] = from[k];
        }
    };
    const d = blankDay(m.day);
    copy(d, m);
    return d;
}

// One solo life's note from a browser: {v:1, mode:'solo', arena, len, secs,
// kills, cause}. Numbers are clamped and rounded, an unknown cause counts as
// 'other', anything else is dropped. Returns null if it isn't a note.
export function cleanRun(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b) || b.v !== 1 || b.mode !== 'solo' || !ARENAS.includes(b.arena)) return null;
    const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(0, v))) : NaN);
    const run = { arena: b.arena, len: num(b.len, MAX.len), secs: num(b.secs, MAX.secs), kills: num(b.kills, MAX.kills),
        cause: CAUSES.includes(b.cause) ? b.cause : 'other' };
    return Number.isNaN(run.len + run.secs + run.kills) ? null : run;
}

export class Stats {
    constructor(store, log = () => {}, now = Date.now) {
        this.store = store;
        this.log = log;
        this.now = now;
        this.days = new Map();      // 'YYYY-MM-DD' (UTC) → day
        this.dirty = new Set();     // days changed since the last save
    }

    // Reload saved days so a restart or deploy doesn't zero today.
    async init() {
        for (const m of (await this.store.loadStats()) || []) {
            const d = fromStored(m);
            if (d) this.days.set(d.day, d);
        }
        this.prune();
    }

    today() {
        const key = dayKey(this.now());
        let d = this.days.get(key);
        if (!d) {
            d = blankDay(key);
            this.days.set(key, d);
            this.prune();
        }
        return d;
    }

    // A life ended. source: 'solo' (a browser's note) or 'room' (counted
    // here). run: { arena, len, secs, kills, cause }.
    run(source, run) {
        const day = this.today(), s = day[source === 'room' ? 'room' : 'solo'];
        s.runs++;
        s.secs += run.secs;
        s.kills += run.kills;
        s.maxLen = Math.max(s.maxLen, run.len);
        s.len[LEN_BINS.find((b) => run.len < b[0])[1]]++;
        s.cause[CAUSES.includes(run.cause) ? run.cause : 'other']++;
        if (ARENAS.includes(run.arena)) s.arena[run.arena]++;
        this.dirty.add(day.day);
    }

    // Humans in all rooms right now (called on join and every minute).
    humans(n) {
        const day = this.today();
        if (n > day.peakHumans) { day.peakHumans = n; this.dirty.add(day.day); }
    }

    roomCreated() {
        const day = this.today();
        day.roomsCreated++;
        this.dirty.add(day.day);
    }

    // Newest day first (GET /api/stats).
    list() {
        this.today();
        return [...this.days.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
    }

    // Save the days that changed: every minute and on shutdown. Store
    // errors are logged by the store and never thrown.
    async flush() {
        const keys = [...this.dirty];
        this.dirty.clear();
        for (const k of keys) {
            const d = this.days.get(k);
            try { if (d) await this.store.saveStats(d); } catch (e) { this.log('stats save failed', e.message); }
        }
    }

    // Forget (and delete) days older than KEEP_DAYS, today included.
    prune() {
        const oldest = dayKey(this.now() - (KEEP_DAYS - 1) * DAY_MS);
        for (const k of [...this.days.keys()]) {
            if (k >= oldest) continue;
            this.days.delete(k);
            this.dirty.delete(k);
            Promise.resolve(this.store.removeStats(k)).catch(() => {});
        }
    }
}
