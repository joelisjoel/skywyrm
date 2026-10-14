// The totals page (stats.html): reads GET /api/stats (the anonymous daily
// totals, newest day first) and draws them for a date range. Nothing is
// sent back: this page makes no visit note of its own.
import { serverUrl } from './net-config.js?v=9';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'K' : Math.round(n).toLocaleString('en-US'));
const pct = (a, b) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '–');
const DAY_MS = 24 * 3600 * 1000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

const SOURCES = { direct: 'Typed or bookmarked', search: 'Search', social: 'Social', video: 'Video', games: 'Games sites', other: 'Other sites' };
const TAGS = { invite: 'Invite link', share: 'Share', qr: 'QR code', reddit: 'Reddit link', hn: 'Hacker News link', ph: 'Product Hunt link', itch: 'itch.io link',
    iogames: '.io games list', youtube: 'YouTube link', tiktok: 'TikTok link', discord: 'Discord link', school: 'School', club: 'Club', family: 'Family', test: 'Test visits' };
const STAGES = { menu: 'Visited', play: 'Started a game', life: 'Finished a life', again: 'Played again', online: 'Went online' };
const TIME = { '0': 'Under 1 s', '<1m': 'Under a minute', '1-5m': '1–5 min', '5-15m': '5–15 min', '15-30m': '15–30 min', '30-60m': '30–60 min', '60m+': 'Over an hour' };
const RETURNS = { new: 'First visit', d0: 'Again the same day', d1: 'Next day', 'd2-6': '2–6 days later', d7: 'A week later', 'd8-29': '8–29 days later',
    'd30+': '30+ days later', old: 'Played before we counted' };
const CAUSES = { wall: 'Storm wall', body: 'Hit a body', headon: 'Head to head', quit: 'Quit', disconnect: 'Disconnected', other: 'Other' };

// ------------------------------------------------ tooltip (hover and focus)
const tip = $('tip');
function hover(mark, value, label) {
    mark.tabIndex = 0;
    mark.setAttribute('aria-label', `${label}: ${value}`);
    const show = (x, y) => {
        tip.replaceChildren(el('b', '', value), el('span', '', label));
        tip.style.display = 'block';
        const w = tip.offsetWidth, h = tip.offsetHeight;
        tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px';
        tip.style.top = Math.max(8, y - h - 12) + 'px';
    };
    mark.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
    mark.addEventListener('focus', () => { const r = mark.getBoundingClientRect(); show(r.left + r.width / 2, r.top); });
    for (const ev of ['pointerleave', 'blur']) mark.addEventListener(ev, () => { tip.style.display = 'none'; });
}

// ------------------------------------------------ marks
// Horizontal bars, one series: [{ label, value, of? }] (of: the share's base).
function hbars(box, rows, emptyText = 'Nothing yet in this range') {
    box.replaceChildren();
    const max = Math.max(0, ...rows.map((r) => r.value));
    if (!max) { box.append(el('p', 'empty', emptyText)); return; }
    const list = el('div', 'hbars');
    for (const r of rows) {
        const row = el('div', 'hrow'), track = el('div', 'htrack'), bar = el('div', 'hbar');
        bar.style.width = `calc((100% - 64px) * ${r.value / max})`;          // room for the value at the tip
        if (!r.value) bar.style.minWidth = '0';
        const val = el('span', 'hval', fmt(r.value));
        if (r.of !== undefined) val.append(' ', el('small', '', pct(r.value, r.of)));
        hover(bar, fmt(r.value) + (r.of !== undefined ? ` (${pct(r.value, r.of)})` : ''), r.label);
        track.append(bar, val);
        row.append(el('span', 'name', r.label), track);
        list.append(row);
    }
    box.append(list);
}

// Columns by day for one or two series of counts, on one axis.
function columns(box, days, series) {
    box.replaceChildren();
    const max = Math.max(0, ...days.flatMap((d) => series.map((s) => s.get(d))));
    if (!max) { box.append(el('p', 'empty', 'No visits in this range yet')); return; }
    const step = niceStep(max), top = Math.ceil(max / step) * step;
    const plot = el('div', 'cols');
    for (let v = 0; v <= top; v += step) {
        const g = el('div', 'gridline');
        g.style.bottom = `${(100 * v) / top}%`;
        g.append(el('span', '', fmt(v)));
        plot.append(g);
    }
    const row = el('div', 'colrow');
    for (const d of days) {
        const day = el('div', 'day');
        for (const s of series) {
            const c = el('div', 'col'), v = s.get(d);
            c.style.height = `${(100 * v) / top}%`;
            c.style.background = s.color;
            hover(c, fmt(v), `${s.label}, ${shortDay(d.day)}`);
            day.append(c);
        }
        row.append(day);
    }
    plot.append(row);
    const xl = el('div', 'xlabels');
    const every = Math.ceil(days.length / 8);
    days.forEach((d, i) => xl.append(el('span', '', i % every === 0 || i === days.length - 1 ? shortDay(d.day) : '')));
    const legend = el('div', 'legend');
    for (const s of series) { const k = el('span'); const sw = el('i'); sw.style.background = s.color; k.append(sw, s.label); legend.append(k); }
    box.append(plot, xl, legend);
}

function niceStep(max) {
    const raw = max / 4, p = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
    return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
}
const shortDay = (key) => new Date(key + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// ------------------------------------------------ data
// Days in the range, oldest first, with blank days where the server has none.
function rangeDays(all, n) {
    const byKey = new Map(all.map((d) => [d.day, d]));
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
        const k = dayKey(Date.now() - i * DAY_MS);
        out.push(byKey.get(k) || { day: k, missing: true });
    }
    return out;
}
const V = (d) => d.visit || {};
const sum = (days, f) => days.reduce((a, d) => a + (f(d) || 0), 0);
const sumKeys = (days, pick, keys) => Object.fromEntries(keys.map((k) => [k, sum(days, (d) => (pick(d) || {})[k])]));

function render(all, n) {
    const days = rangeDays(all, n), have = days.filter((d) => !d.missing);
    const visits = sum(days, (d) => V(d).visits), devices = sum(days, (d) => V(d).devices);
    const reached = sumKeys(days, (d) => V(d).reached, Object.keys(STAGES));
    const runs = sum(days, (d) => (d.solo?.runs || 0) + (d.room?.runs || 0));
    const peak = Math.max(0, ...days.map((d) => d.peakHumans || 0));

    // What the range covers.
    const oldest = all.length ? all[all.length - 1].day : null;
    const note = $('note');
    note.replaceChildren();
    if (!all.length) note.textContent = 'No totals yet.';
    else if (have.length < days.length) {
        note.append(el('b', '', `Totals start ${shortDay(oldest)}. `),
            `The server has ${all.length === 1 ? 'one day' : `${all.length} days`} of totals; earlier days in this range show as zero.`);
    }

    // Headline numbers.
    const tiles = $('tiles');
    tiles.replaceChildren();
    const tile = (label, value, delta) => { const t = el('div', 'tile'); t.append(el('div', 'label', label), el('div', 'value', value)); if (delta) t.append(el('div', 'delta', delta)); tiles.append(t); };
    const perDay = Math.max(1, have.length);                        // averages count only the days with totals
    tile('Visits', fmt(visits), n > 1 ? `${fmt(visits / perDay)} a day` : 'today');
    tile('Devices a day', fmt(devices / perDay), 'average, each device once a day');
    tile('Started a game', pct(reached.play, visits), `${fmt(reached.play)} visits`);
    const sky = sum(days, (d) => (d.solo?.secs || 0) + (d.room?.secs || 0));
    tile('Lives played', fmt(runs), `${sky < 3600 ? `${Math.round(sky / 60)} min` : `${fmt(sky / 3600)} h`} in the sky`);
    tile('Most online at once', fmt(peak), 'players in all servers');

    columns($('trend'), days, [
        { label: 'Visits', color: 'var(--series-1)', get: (d) => V(d).visits || 0 },
        { label: 'Started a game', color: 'var(--series-2)', get: (d) => (V(d).reached || {}).play || 0 },
    ]);
    hbars($('funnel'), Object.entries(STAGES).map(([k, label]) => ({ label, value: reached[k], of: visits })), 'No visits in this range yet');

    const src = sumKeys(days, (d) => V(d).src, Object.keys(SOURCES)), tags = sumKeys(days, (d) => V(d).tag, Object.keys(TAGS));
    hbars($('sources'), [
        ...Object.entries(SOURCES).map(([k, label]) => ({ label, value: src[k], of: visits })).sort((a, b) => b.value - a.value),
        ...Object.entries(TAGS).filter(([k]) => tags[k] > 0).map(([k, label]) => ({ label: `Tagged: ${label}`, value: tags[k], of: visits })),
    ]);

    // Phone vs computer: one part-to-whole bar.
    const dev = sumKeys(days, (d) => V(d).dev, ['touch', 'mouse']), box = $('devices');
    box.replaceChildren();
    if (!(dev.touch + dev.mouse)) box.append(el('p', 'empty', 'Nothing yet in this range'));
    else {
        const parts = [['Phone or tablet', dev.touch, 'var(--series-2)'], ['Computer', dev.mouse, 'var(--series-1)']];
        const stack = el('div', 'stack'), legend = el('div', 'legend');
        for (const [label, v, color] of parts) {
            if (v) { const s = el('div', 'seg'); s.style.flex = String(v); s.style.background = color; hover(s, `${fmt(v)} (${pct(v, dev.touch + dev.mouse)})`, label); stack.append(s); }
            const k = el('span'), sw = el('i'); sw.style.background = color; k.append(sw, `${label} ${pct(v, dev.touch + dev.mouse)}`); legend.append(k);
        }
        box.append(stack, legend);
    }

    const secs = sumKeys(days, (d) => V(d).secs, Object.keys(TIME));
    hbars($('time'), Object.entries(TIME).map(([k, label]) => ({ label, value: secs[k], of: visits })));
    const ret = sumKeys(days, (d) => V(d).ret, Object.keys(RETURNS)), retAll = Object.values(ret).reduce((a, b) => a + b, 0);
    hbars($('returns'), Object.entries(RETURNS).map(([k, label]) => ({ label, value: ret[k], of: retAll })));

    const cause = Object.fromEntries(Object.keys(CAUSES).map((k) => [k, sum(days, (d) => (d.solo?.cause?.[k] || 0) + (d.room?.cause?.[k] || 0))]));
    hbars($('lives'), [
        { label: 'Solo', value: sum(days, (d) => d.solo?.runs), of: runs },
        { label: 'Online', value: sum(days, (d) => d.room?.runs), of: runs },
        ...Object.entries(CAUSES).map(([k, label]) => ({ label: `Ended by: ${label}`, value: cause[k], of: runs })),
    ], 'No lives counted in this range yet');

    // The table view: every number above, by day.
    const t = el('table'), head = el('tr');
    for (const h of ['Day', 'Visits', 'Devices', 'Started', 'Finished a life', 'Again', 'Online', 'Lives', 'Peak online']) head.append(el('th', '', h));
    t.append(head);
    for (const d of [...days].reverse()) {
        const v = V(d), r = v.reached || {}, tr = el('tr');
        const cells = d.missing ? ['–', '–', '–', '–', '–', '–', '–', '–']
            : [v.visits, v.devices, r.play, r.life, r.again, r.online, (d.solo?.runs || 0) + (d.room?.runs || 0), d.peakHumans].map((x) => fmt(x || 0));
        tr.append(el('td', '', shortDay(d.day)), ...cells.map((c) => el('td', '', c)));
        t.append(tr);
    }
    $('table').replaceChildren(t);
}

// ------------------------------------------------ wiring
let data = [], range = 7;
const buttons = [...document.querySelectorAll('.filters button')];
for (const b of buttons) {
    b.onclick = () => {
        range = +b.dataset.days;
        for (const o of buttons) o.setAttribute('aria-pressed', String(o === b));
        render(data, range);
    };
}
async function load() {
    try {
        const r = await fetch(serverUrl() + '/api/stats', { credentials: 'omit' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        data = (await r.json()).days || [];
        render(data, range);
    } catch (e) {
        $('note').textContent = `Couldn't load the totals (${e.message}). The server may be waking up: reload in a few seconds.`;
    }
}
load();
