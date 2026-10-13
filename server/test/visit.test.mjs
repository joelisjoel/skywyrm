// Visit totals: the browser's side (site/js/visit.js: referrer categories,
// link tags, return buckets, the saved first/last days, the note) as pure
// functions; the server's cleanVisit and the daily counts (stats.js),
// including days saved before visits were counted; then POST /api/visit on
// the real server: 204, size, origin, content type and the per-address limit.
// Run: cd server && npm test
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { visitSource, visitTag, visitReturn, visitDays, visitNote, withoutParam, VISIT_TAGS } from '../../site/js/visit.js';
import { Stats, cleanVisit } from '../stats.js';
import { makeStore } from '../store.js';

let ok = 0;
const check = (cond, msg) => { assert.ok(cond, msg); ok++; console.log('  ✓', msg); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const T0 = Date.parse('2026-10-12T12:00:00Z');

// ------------------------------------------------ the browser's side
{
    const cases = {
        direct: ['', 'skywyrm.io', 'www.skywyrm.io', 'SKYWYRM.IO.'],
        search: ['www.google.com', 'google.co.uk', 'news.google.com', 'www.bing.com', 'duckduckgo.com', 'search.yahoo.com', 'www.ecosia.org',
            'www.baidu.com', 'yandex.ru', 'search.brave.com'],
        social: ['m.facebook.com', 'l.facebook.com', 'www.instagram.com', 'old.reddit.com', 'x.com', 't.co', 'twitter.com', 'discord.com',
            'discord.gg', 'www.linkedin.com', 'pinterest.com', 'www.threads.net'],
        video: ['www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.tiktok.com', 'www.twitch.tv'],
        games: ['itch.io', 'someone.itch.io', 'iogames.space', 'io-games.zone', 'www.crazygames.com', 'poki.com', 'www.newgrounds.com',
            'www.coolmathgames.com', 'www.kongregate.com'],
        other: ['example.com', 'notgoogle.com', 'mygoogle.dev', 't.com', 'xx.com', 'box.com', 'itch.io.evil.com', 'localhost', '192.168.1.5'],
    };
    const wrong = Object.entries(cases).flatMap(([src, hosts]) => hosts.filter((h) => visitSource(h) !== src).map((h) => `${h} → ${visitSource(h)} (not ${src})`));
    check(wrong.length === 0, `referrer hosts fall into the right categories (${Object.values(cases).flat().length} hosts)${wrong.length ? ': ' + wrong.join(', ') : ''}`);
    check(visitSource('localhost', 'localhost') === 'direct' && visitSource('127.0.0.1', '127.0.0.1') === 'direct' && visitSource(null) === 'direct',
        'the page\'s own host (a local test page) and no referrer are direct');

    check(VISIT_TAGS.every((t) => visitTag(t) === t) && visitTag('Reddit') === 'reddit' && visitTag(' qr ') === 'qr',
        'every allowlisted ?src= tag is kept (case and spaces ignored)');
    check([undefined, null, '', 'facebook', 'joel', 'invite2', 'toString', '__proto__', 'x'.repeat(500), ['invite'], 7].every((v) => visitTag(v) === undefined),
        'any other ?src= value is no tag');

    check(withoutParam('?src=qr', 'src') === '' && withoutParam('?dev=1&src=qr&server=http%3A%2F%2Flocalhost%3A8080&room=abc', 'src') === '?dev=1&server=http%3A%2F%2Flocalhost%3A8080&room=abc'
        && withoutParam('?room=x&%73rc=a&src&src=b', 'src') === '?room=x' && withoutParam('', 'src') === '' && withoutParam('?a=%E0%A4%A', 'src') === '?a=%E0%A4%A',
    'the tag comes out of the address bar; every other parameter stays exactly as written');

    const ret = (first, last, today = '2026-10-12', played = false) => visitReturn(first ? { first, last } : null, today, played);
    const buckets = [['2026-10-12', 'd0'], ['2026-10-11', 'd1'], ['2026-10-10', 'd2-6'], ['2026-10-06', 'd2-6'], ['2026-10-05', 'd7'],
        ['2026-10-04', 'd8-29'], ['2026-09-13', 'd8-29'], ['2026-09-12', 'd30+'], ['2025-01-01', 'd30+'], ['2026-12-25', 'd0']];
    const bad = buckets.filter(([first, want]) => ret(first, '2026-10-11').ret !== want);
    check(bad.length === 0, `first-visit days → return buckets d0, d1, d2-6, d7, d8-29, d30+ (a future day counts as today)${bad.length ? ': ' + bad.join(' ') : ''}`);
    check(same(ret(null), { ret: 'new', today: true }) && same(ret(null, null, '2026-10-12', true), { ret: 'old', today: true })
        && same(visitReturn({ first: 'junk' }, '2026-10-12'), { ret: 'new', today: true }) && same(visitReturn('2026-10-01', '2026-10-12'), { ret: 'new', today: true }),
    'no (or a broken) record: new, or old if this browser played before; both first-today');
    check(ret('2026-10-01', '2026-10-12').today === false && ret('2026-10-01', '2026-10-11').today === true && ret('2026-10-12', undefined).today === true,
        'today is true only for the first visit of the UTC day');

    // The saved record, through a fake localStorage.
    const fake = (init = {}) => {
        const m = new Map(Object.entries(init));
        return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
    };
    const ls = fake();
    const d1 = visitDays('2026-10-10', () => ls), d2 = visitDays('2026-10-10', () => ls), d3 = visitDays('2026-10-11', () => ls), d4 = visitDays('2026-10-17', () => ls);
    check(same(d1, { ret: 'new', today: true }) && same(d2, { ret: 'd0', today: false }) && same(d3, { ret: 'd1', today: true }) && same(d4, { ret: 'd7', today: true })
        && ls.m.get('wyrm.visit.v1') === '{"first":"2026-10-10","last":"2026-10-17"}',
    'the device keeps only its first and last visit days: new → d0 (same day) → d1 → d7');
    const blocked = () => { throw new Error('SecurityError'); };
    const readOnly = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    check(same(visitDays('2026-10-12', blocked), { ret: 'new', today: true }) && same(visitDays('2026-10-12', () => readOnly), { ret: 'new', today: true }),
        'storage blocked (or not writable): new, first today');
    check(same(visitDays('2026-10-12', () => fake({ 'wyrm.settings.v1': '{"runs":4}' })), { ret: 'old', today: true })
        && same(visitDays('2026-10-12', () => fake({ 'wyrm.profile.v1': '{"lives":2}' })), { ret: 'old', today: true })
        && same(visitDays('2026-10-12', () => fake({ 'wyrm.settings.v1': '{"runs":0}', 'wyrm.profile.v1': 'nope' })), { ret: 'new', today: true })
        && same(visitDays('2026-10-12', () => fake({ 'wyrm.visit.v1': '{broken' })), { ret: 'new', today: true }),
    'no visit record but an older profile that played: old; a broken record starts again');

    const note = visitNote({ src: 'games', tag: 'itch', ret: 'd1', today: true, touch: true, stage: 3, lives: 2, secs: 95.6, invited: false, base: 'x', sent: true });
    check(same(note, { v: 1, src: 'games', tag: 'itch', ret: 'd1', today: true, dev: 'touch', stage: 'again', lives: 2, secs: 96, invited: false }),
        'the note: v, src, tag, ret, today, dev, stage, lives, secs, invited and nothing else');
    const n2 = visitNote({ src: 'direct', ret: 'new', today: false, touch: false, stage: 99, lives: 1e6, secs: 1e9, invited: 1 });
    check(!('tag' in n2) && !('ret' in n2) && n2.dev === 'mouse' && n2.stage === 'online' && n2.lives === 50 && n2.secs === 7200 && n2.invited === true,
        'no tag when there is none; no return bucket after the day\'s first visit; lives (≤ 50) and seconds (≤ 7200) clamped');
}

// ------------------------------------------------ cleanVisit
const good = { v: 1, src: 'search', tag: 'qr', ret: 'd7', today: true, dev: 'touch', stage: 'life', lives: 3, secs: 240.4, invited: true };
{
    check(same(cleanVisit(good), { src: 'search', stage: 'life', lives: 3, secs: 240, today: true, invited: true, tag: 'qr', ret: 'd7', dev: 'touch' }),
        'a good visit note keeps its fields, rounded');
    check(same(cleanVisit({ ...good, referrer: 'https://example.com/kid', ua: 'Mozilla', id: 'abc', name: 'Ember Drake' }), cleanVisit(good)),
        'extra fields (a referrer, user agent, id, name) are dropped');
    const odd = cleanVisit({ v: 1, src: 'https://evil.example', tag: 'joel', ret: 'yesterday', dev: 'fridge', stage: 'boss', lives: 1e9, secs: -5, today: 'yes', invited: 1 });
    check(same(odd, { src: 'other', stage: 'menu', lives: 50, secs: 0, today: false, invited: false }),
        'unknown source → other, unknown tag/return/device left out, unknown stage → menu, numbers clamped, flags must be true');
    const proto = cleanVisit({ v: 1, src: 'constructor', tag: '__proto__', ret: 'toString', dev: 'hasOwnProperty', stage: 'valueOf', lives: '3', secs: NaN });
    check(same(proto, { src: 'other', stage: 'menu', lives: 0, secs: 0, today: false, invited: false }), 'object-property names and non-numbers are nothing special');
    check([null, undefined, [], 'x', 7, {}, { v: 2, src: 'direct' }, { ...good, v: '1' }].every((b) => cleanVisit(b) === null), 'anything that isn\'t a v1 note is refused');
}

// ------------------------------------------------ daily counts
{
    const store = await makeStore(() => {});
    let now = T0;
    const a = new Stats(store, () => {}, () => now);
    await a.init();
    const add = (o) => a.visit(cleanVisit({ v: 1, src: 'direct', ret: 'new', today: true, dev: 'mouse', stage: 'menu', lives: 0, secs: 0, ...o }));
    add({});
    add({ src: 'search', tag: 'qr', ret: 'd1', dev: 'touch', stage: 'play', secs: 30 });
    add({ src: 'games', tag: 'itch', ret: 'd0', today: false, stage: 'life', lives: 1, secs: 200 });
    add({ src: 'social', tag: 'qr', ret: 'd7', stage: 'again', lives: 3, secs: 1000, invited: true });
    add({ src: 'video', ret: 'old', dev: 'touch', stage: 'online', lives: 2, secs: 5000 });
    add({ src: 'nope', ret: 'nope', dev: 'nope', stage: 'nope' });
    const v = a.list()[0].visit;
    check(v.visits === 6 && v.devices === 5, 'visits counted, and first-of-the-day visits as devices (6 visits, 5 devices)');
    check(same(v.reached, { menu: 6, play: 4, life: 3, again: 2, online: 1 }), 'the funnel is cumulative: reached.play counts every visit that got to play or further');
    check(same(v.src, { direct: 1, search: 1, social: 1, video: 1, games: 1, other: 1 }) && v.tag.qr === 2 && v.tag.itch === 1
        && Object.values(v.tag).reduce((x, y) => x + y) === 3 && v.ret.new === 1 && v.ret.d1 === 1 && v.ret.d0 === 1 && v.ret.d7 === 1 && v.ret.old === 1
        && Object.values(v.ret).reduce((x, y) => x + y) === 5 && v.dev.touch === 2 && v.dev.mouse === 3,
    'counts by source, tag, return bucket and device (unknown ones left out)');
    check(same(v.secs, { 0: 2, '<1m': 1, '1-5m': 1, '5-15m': 0, '15-30m': 1, '30-60m': 0, '60m+': 1 }) && v.lives === 6 && v.invited === 1,
        'time played per visit as a histogram, lives finished and invites sent');
    check(a.list()[0].solo.runs === 0 && a.list()[0].room.runs === 0, 'visits don\'t touch the play totals');
    await a.flush();
    const b = new Stats(store, () => {}, () => now);
    await b.init();
    check(same(b.list(), a.list()), 'visit counts come back unchanged from the store');

    // Days saved before visits were counted (or with a visit block from
    // another version) still load: missing counters are 0, odd ones dropped.
    const oldDay = { day: '2026-10-10', solo: { runs: 3, secs: 90, kills: 1, maxLen: 40, len: { '25-50': 3 }, cause: { wall: 3 }, arena: { sky: 3 } }, room: { runs: 1 },
        peakHumans: 2, roomsCreated: 1 };
    const partial = { day: '2026-10-11', visit: { visits: 4, devices: -3, src: { direct: 4, myspace: 9 }, reached: { menu: 4, play: 'lots' }, extra: 5 } };
    const legacy = { loadStats: async () => [oldDay, partial], saveStats: async () => {}, removeStats: async () => {} };
    const c = new Stats(legacy, () => {}, () => now);
    await c.init();
    const [d11, d10] = c.list().slice(1);
    check(d10.solo.runs === 3 && d10.peakHumans === 2 && d10.visit.visits === 0 && d10.visit.reached.menu === 0 && d10.visit.tag.qr === 0
        && same(Object.keys(d10.visit), Object.keys(c.list()[0].visit)), 'an old day without visit counts loads with every visit counter at 0');
    check(d11.visit.visits === 4 && d11.visit.devices === 0 && d11.visit.src.direct === 4 && !('myspace' in d11.visit.src) && d11.visit.reached.play === 0
        && !('extra' in d11.visit) && d11.solo.runs === 0, 'a partial visit block keeps its good counters; negative, unknown and non-numbers are dropped');
}

// ------------------------------------------------ POST /api/visit on the real server
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 27000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = 'http://localhost:5173';
const IP = '203.0.113.77';
const srv = spawn(process.execPath, [path.join(here, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), STORE: 'memory' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !out.includes('listening'); i++) await sleep(100);
assert.ok(out.includes('listening'), 'server did not start:\n' + out);
try {
    const post = (p, body, headers = {}) => fetch(BASE + p, { method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'text/plain', 'x-forwarded-for': IP, referer: 'https://www.example.com/secret-page', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body) });
    const today = async () => (await (await fetch(BASE + '/api/stats', { headers: { origin: ORIGIN } })).json()).days[0];

    let res = await post('/api/visit', good);
    check(res.status === 204 && res.headers.get('access-control-allow-origin') === ORIGIN, 'a visit note (text/plain, so no preflight) is accepted: 204 with CORS');
    let t = await today();
    check(t.visit.visits === 1 && t.visit.devices === 1 && t.visit.src.search === 1 && t.visit.tag.qr === 1 && t.visit.ret.d7 === 1 && t.visit.dev.touch === 1
        && t.visit.reached.life === 1 && t.visit.reached.again === 0 && t.visit.secs['1-5m'] === 1 && t.visit.invited === 1, 'GET /api/stats shows it in today\'s visit totals');
    check(same(Object.keys(t), ['day', 'solo', 'room', 'peakHumans', 'roomsCreated', 'visit']) && t.solo.runs === 0,
        'the day keeps its old fields as they were and adds only visit');
    res = await post('/api/visit', { ...good, src: 'tv', secs: 1e9 }, { 'content-type': 'application/json' });
    t = await today();
    check(res.status === 204 && t.visit.visits === 2 && t.visit.src.other === 1 && t.visit.secs['60m+'] === 1, 'JSON works too; junk is cleaned (other, clamped)');

    const refused = await Promise.all([post('/api/visit', 'not json'), post('/api/visit', { ...good, v: 2 }), post('/api/visit', '[1,2]')]);
    check(refused.every((r) => r.status === 400), 'bad JSON or something that isn\'t a v1 note is refused (400)');
    res = await post('/api/visit', { ...good, pad: 'x'.repeat(600) });
    check(res.status === 413, 'a note over 512 bytes is refused (413)');
    res = await post('/api/visit', good, { 'content-type': 'application/x-www-form-urlencoded' });
    check(res.status === 415, 'a form post is refused (415)');
    res = await post('/api/visit', good, { origin: 'https://evil.example' });
    check(res.status === 403 && !res.headers.get('access-control-allow-origin'), 'a note from a foreign origin is refused (403)');
    // So far 2 accepted + 3 (400) + 1 (413 by content-length, before the
    // limit) + 1 (415) + 1 (403) don't all count: only those that reached
    // the limit check do (2 + 3), so 25 more are allowed this hour.
    const more = [];
    for (let i = 0; i < 25; i++) more.push((await post('/api/visit', good)).status);
    res = await post('/api/visit', good);
    t = await today();
    check(more.every((s) => s === 204) && res.status === 429 && t.visit.visits === 27, 'per-address limit: the 31st visit note in an hour gets 429');
    res = await post('/api/visit', good, { 'x-forwarded-for': '198.51.100.9' });
    const run = await post('/api/run', { v: 1, mode: 'solo', arena: 'sky', len: 20, secs: 30, kills: 0, cause: 'wall' });
    check(res.status === 204 && run.status === 204, 'the limit is per address, and run notes keep their own');
    check(!out.includes(IP) && !out.includes('198.51.100.9') && !out.includes('example.com') && !/secret-page|evil\.example|Mozilla/.test(out),
        'the server logs no address, referrer or note content');
} finally {
    srv.kill();
}

console.log(`\n${ok} visit checks passed`);
