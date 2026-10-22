// Safety checks for player names, and the word lists server names are
// generated from. Shared by the browser (for instant feedback) and the
// game server (the authority — its verdict is what everyone else sees).
// Strings are only ever rendered with textContent / fillText.
//
// Names are plain ASCII. Accents come off (José → Jose) and full-width or
// fancy letters fold to plain ones, but any other letter is refused, so a
// Cyrillic "с" can't stand in for a Latin "c".

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i' };

// Matched inside each word of a name, in the squashed form below, with any
// letter allowed to repeat ("fuuuck"). Words are checked one at a time, so
// "Atlas Storm" doesn't read as "ass".
const BLOCKED = ['fuck', 'fcuk', 'fuq', 'shit', 'shyt', 'cunt', 'twat', 'bitch', 'bytch', 'biatch', 'btch', 'nigger', 'nigga',
    'niqqa', 'niqqer', 'nigguh', 'nygger', 'nygga', 'nibba', 'nibber', 'beaner', 'wetback',
    'faggot', 'fag', 'retard', 'whore', 'slut', 'sloot', 'rape', 'rapist', 'molest', 'nazi', 'hitler', 'kike', 'spic',
    'chink', 'tranny', 'dick', 'cock', 'pussy', 'porn', 'penis', 'vagina', 'kkk', 'isis', 'ass', 'dumbass', 'dumass',
    'sex', 'seggs', 'cum', 'tits', 'titz', 'titty', 'titties', 'boobs', 'boobies', 'anal', 'pedo', 'paedo', 'dildo',
    'jizz', 'milf', 'horny', 'nsfw', 'xxx', 'suicide', 'kilyourself', 'kilurself', 'kilyoself', 'hangyourself', 'hangurself'];

// Also matched with the gaps between words closed up ("kill urself"):
// long enough that two innocent words never run together into them.
const SPACED = ['nigger', 'nigga', 'faggot', 'cunt', 'hitler', 'tranny', 'pussy', 'porn', 'vagina', 'dildo',
    'suicide', 'kilyourself', 'kilurself', 'kilyoself', 'hangyourself', 'hangurself',
    'siegheil', 'killjews', 'killthejews', 'gasjews', 'gasthejews', 'whitepower'];

// Only as a whole word, or with an s (also after splitting "KysNow" or
// "kys2" apart): too short, or too much a part of innocent words ("Raccoon",
// "Pakistan"), to look for inside other words.
const WHOLE = ['kys', 'fck', 'fcking', 'fcker', 'fkn', 'stfu', 'gtfo', 'wtf', 'pron', 'coon', 'gook', 'dyke', 'paki'];

// Innocent words that short blocked words hide in. A match that lies
// wholly inside one of these doesn't count ("Grape", "Peacock"). Kept
// long enough not to excuse a compound too ("Coolass" isn't "lass").
const INNOCENT = [
    'bass', 'brass', 'class', 'glass', 'grass', 'mass', 'pass', 'sassy', 'sassafras', 'lassie', 'lasso', 'molasses',
    'cass', 'chassis', 'hassle', 'hassan', 'tassel', 'vassal', 'harass', 'morass', 'embarrass', 'canvass', 'cutlass',
    'crevasse', 'potass', 'jurassic', 'triassic', 'wassup', 'assassin', 'assault', 'assay', 'assail', 'assembl',
    'assent', 'assert', 'assess', 'asset', 'assign', 'assimil', 'assist', 'associat', 'assort', 'assum', 'assur',
    'assia', 'assya', 'kassandra', 'kassidy', 'kassie', 'nassim', 'nasser', 'wassim', 'yasser', 'yassin',
    'essex', 'sussex', 'sextant', 'sextet', 'sexton',
    'cumul', 'cucumber', 'cumber', 'cumben', 'succumb', 'vacuum', 'document', 'circum', 'cumin', 'acumen',
    'torpedo', 'pedometer', 'speedo',
    'grape', 'drape', 'scrape', 'trapeze', 'therapist', 'parapet', 'rapper', 'rappel', 'wrappe', 'trappe', 'scrappe',
    'strappe',
    'peacock', 'cockatoo', 'cockatiel', 'cockpit', 'cockroach', 'cockerel', 'cockle', 'hancock', 'shuttlecock',
    'woodcock', 'hitchcock', 'gamecock', 'cook', 'kicker', 'kicked',
    'dickens', 'dickinson', 'dickory', 'ildiko',
    'spicy', 'spice', 'spica', 'auspic', 'conspic', 'despic', 'hospic',
    'canal', 'banal', 'annal', 'analog', 'analy',
    'sarcophag', 'esophag', 'crisis', 'thorny', 'milford', 'shiitake', 'retardant',
    'twater', 'twatch',
];

// Words that impersonate staff or the built-in rooms. Whole words only:
// "Admin" and "The Official" are taken, "Systemic" and "Staffy" are fine.
const RESERVED = ['admin', 'moderator', 'mod', 'official', 'staff', 'system', 'server', 'skywyrm', 'wyrm team'];

export const LIMITS = { player: 16, room: 24 };

// Unicode → ASCII where Unicode says a letter is a plain one dressed up:
// accents and zalgo marks come off, full-width and fancy letters fold, and
// invisible characters (zero-width, bidi overrides) go.
function fold(raw) {
    return String(raw ?? '').normalize('NFKD').replace(/\p{Cf}/gu, '').replace(/\p{M}/gu, '');
}

const FOREIGN = /(?![\0-\x7F])[\p{L}\p{N}]/u;     // a letter or digit that didn't fold to ASCII

// Normalise and strip everything outside a small allowlist.
export function clean(raw, max) {
    const s = fold(raw).replace(/\s+/g, ' ').replace(/[^A-Za-z0-9 \-_.'!?&#]/g, '').replace(/ +/g, ' ').trim();
    return s.slice(0, max).trim();
}

// The form names are matched in: lower case, leetspeak read as letters
// ("sh1t"), sound-alikes merged (ph→f, ck→k, v→u), letters only. A number
// at the end ("Pyra55") is a number, not leetspeak, unless `digits` (for
// "A55", read whole). With `gaps`, a symbol between two letters is kept
// as "*" ("Sh#t", "B_tch").
function squash(s, { digits = false, gaps = false } = {}) {
    s = s.toLowerCase().replace(/[^a-z0-9]+$/, '');
    if (!digits) s = s.replace(/\d{2,}$/, '');
    if (gaps) s = s.replace(/([a-z])[^a-z0-9 !]+(?=[a-z])/g, '$1*');      // no lookbehind: Safari before 16.4 can't parse one
    return s.replace(/[0-9@$!]/g, (c) => LEET[c] || '').replace(/[^a-z*]/g, '')
        .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/v/g, 'u');
}

// A blocked word as a pattern: each letter may repeat, but never drops
// below its own count ("ass" needs two s's). With `gaps`, a "*" may stand
// in for a vowel.
const pattern = (w, gaps = false) => squash(w).replace(/(.)\1*/g, (run, c) => {
    const x = gaps && 'aeiouy'.includes(c) ? `[${c}*]` : c;
    return run.length > 1 ? `${x}{${run.length},}?` : `${x}+?`;
});
const BLOCKED_RE = BLOCKED.map((w) => new RegExp(pattern(w), 'y'));
const SPACED_RE = SPACED.map((w) => new RegExp(pattern(w), 'y'));
const WHOLE_RE = WHOLE.map((w) => new RegExp(`^${pattern(w)}s?$`));
// A blocked word with a symbol for a vowel, filling whole pieces of a word
// between symbols ("Sh#t", "Big_Sh#t"), so a symbol between two words
// doesn't count ("Wolf-Kid" isn't "f*k").
const GAPS_RE = BLOCKED.map((w) => new RegExp(`^${pattern(w, true)}(?:s|y|ed|er|ers|in|ing)?(?=\\*|$)`));
// Blocked words spelled exactly, for strings that are one only when read
// whole: two words run together ("Fu ck") or a word with its number ("A55").
// Exact, or "Ana Lin" would read as "anal" plus an ending.
const BLOCKED_SQ = new Set(BLOCKED.map((w) => squash(w)));
const exact = (s) => BLOCKED_SQ.has(s) || (s.endsWith('s') && BLOCKED_SQ.has(s.slice(0, -1)));
const INNOCENT_SQ = INNOCENT.map((w) => squash(w));

// The words of a name as typed: split at spaces, with runs of single
// characters joined back up ("f u c k").
function words(value) {
    const out = [];
    let run = '';
    for (const w of value.split(' ')) {
        if (w.length === 1) { run += w; continue; }
        if (run) out.push(run);
        run = '';
        out.push(w);
    }
    if (run) out.push(run);
    return out;
}

// Finer pieces for whole-word checks: also split at punctuation and at
// camelCase and letter/digit seams ("KysNow", "Server_Bot", "admin123").
function pieces(value) {
    return value.replace(/[a-z](?=[A-Z])|[A-Za-z](?=\d)|\d(?=[A-Za-z])/g, '$& ')
        .split(/[^A-Za-z0-9]+/).filter((p) => /[A-Za-z]/.test(p));
}

// Does any pattern match in squashed string `s`, outside an innocent word?
function hits(s, res) {
    const spans = [];
    for (const w of INNOCENT_SQ) for (let k = s.indexOf(w); k >= 0; k = s.indexOf(w, k + 1)) spans.push([k, k + w.length]);
    for (const re of res) {
        for (let i = 0; i < s.length; i++) {
            re.lastIndex = i;
            const m = re.exec(s);
            if (!m) continue;
            re.lastIndex = i + 1;
            if (s[i + 1] === s[i] && re.test(s)) continue;            // "accum": judge the tighter match at i+1
            if (!spans.some(([a, b]) => a <= i && i + m[0].length <= b)) return true;
        }
    }
    return false;
}

// Does a blocked word, with a symbol for one of its vowels, fill whole
// pieces of gapped string `s`?
function gapHit(s) {
    for (let i = 0; i < s.length; i++) {
        if (i > 0 && s[i - 1] !== '*') continue;
        const rest = s.slice(i);
        if (GAPS_RE.some((re) => (re.exec(rest)?.[0] || '').includes('*'))) return true;
    }
    return false;
}

function blocked(value) {
    const typed = words(value), ws = typed.map((w) => squash(w));
    const forms = [...ws, ...pieces(value).map((w) => squash(w))];
    const whole = [...typed.map((w) => squash(w, { digits: true })).filter((w, i) => w !== ws[i]),   // "A55", "PEN15", "80085"
        ...typed.slice(1).map((w, i) => squash(typed[i] + w))];                                       // "Fu ck", "Sh it", "Bi tch"
    return ws.some((w) => hits(w, BLOCKED_RE)) || hits(ws.join(''), SPACED_RE)
        || whole.some(exact)
        || typed.some((w) => gapHit(squash(w, { gaps: true })))
        || forms.some((w) => WHOLE_RE.some((re) => re.test(w)))
        || /(^|\D)14\D?88(\D|$)/.test(value);                              // a neo-Nazi number
}

// Reserved words match whole words (or a run of words, for "wyrm team"),
// or the whole name with its spaces closed up ("Sky wyrm").
function reserved(value, list) {
    const ws = words(value).map(squash), ps = pieces(value).map(squash), all = ws.join('');
    const has = (seq, sub) => seq.some((_, i) => sub.every((t, k) => seq[i + k] === t));
    return list.some((r) => {
        const rw = pieces(r).map(squash);
        return rw.length > 0 && (all === rw.join('') || has(ws, rw) || has(ps, rw));
    });
}

// Contact details, so a name can't pass on a way to reach someone: links
// and e-mail addresses (an @ is checked before clean() drops it), short
// links ("bit.ly"), 7 or more digits (a phone number), an old-style
// Discord tag ("jo#1234"), the name of a messaging app or e-mail service
// as a whole word, and "add me"-style asks.
const URLISH = /(https?|\bwww\b|\.com|\.net|\.org|\.io|\.gg|\.xyz|\.ru|dot ?com|@)/i;
// Not .me, .us, .live or .link: "Its.Me" and "Zelda.Link" are names.
const DOMAIN = /\.\s*(com|net|org|io|gg|xyz|ru|co|ly|tv|uk|app|dev|info|biz|cc|gl)\b|\bdot ?(net|org|io|co|tv)\b/i;
const CONTACT = new Set(['gmail', 'hotmail', 'icloud', 'aol', 'protonmail', 'discord', 'insta', 'instagram', 'snapchat',
    'tiktok', 'whatsapp', 'telegram', 'hmu']);
const ASKS = new Set(['addme', 'dmme', 'textme', 'callme', 'snapme', 'msgme', 'messageme']);
const letters = (w) => w.toLowerCase().replace(/[^a-z]/g, '');   // not squash(), which reads "Ticktock" as "tiktok"

function contact(raw, value) {
    if (URLISH.test(value) || fold(raw).includes('@') || DOMAIN.test(value)) return true;
    if ((value.match(/\d/g) || []).length >= 7 || /[a-z]#\d{4}\b/i.test(value)) return true;
    const typed = words(value);
    return [...typed, ...pieces(value)].some((w) => CONTACT.has(letters(w)))
        || typed.slice(1).some((w, i) => ASKS.has(letters(typed[i] + w)));
}

// Returns { ok, value, reason }. `kind` is 'player' or 'room'.
export function checkName(raw, kind = 'player', extraReserved = []) {
    const max = LIMITS[kind] || 16;
    const value = clean(raw, max);
    const no = (reason) => ({ ok: false, value, reason });
    if (FOREIGN.test(fold(raw))) return no('Use letters A–Z and numbers');
    if (kind === 'room' && value.length < 3) return no('Use at least 3 letters or numbers');
    if (!/[A-Za-z0-9]/.test(value)) return no(value || fold(raw).trim() ? 'Use letters A–Z and numbers' : 'Pick a name');
    if (contact(raw, value)) return no('No links, e-mails or phone numbers');
    if (blocked(value)) return no('Please choose a different name');
    if (reserved(value, [...RESERVED, ...extraReserved])) return no('That name is reserved');
    return { ok: true, value, reason: '' };
}

// Player names never block play: fall back to a safe default instead.
export function safePlayerName(raw, fallback = 'Dragon') {
    const r = checkName(raw, 'player');
    return r.ok ? r.value : fallback;
}

// Server names are generated, never typed, so nothing a player writes is
// shown in every lobby: an adjective and a noun from these lists. No word
// is or contains a built-in or reserved name, and every pair passes
// checkName (see server/test/names.test.mjs).
export const ROOM_ADJECTIVES = ['Jade', 'Ember', 'Misty', 'Golden', 'Lotus', 'Thunder', 'Silver', 'Azure', 'Bamboo', 'Willow',
    'Plum', 'Peach', 'Moonlit', 'Starlit', 'Amber', 'Coral', 'Copper', 'Cloud', 'Snowy', 'Sunny', 'Phoenix', 'Crane', 'Tiger', 'Pine'];
export const ROOM_NOUNS = ['Peak', 'Gate', 'Garden', 'Valley', 'Harbor', 'Bridge', 'Grove', 'Spire', 'Lantern', 'Isle', 'Cove',
    'Falls', 'Pagoda', 'Temple', 'Meadow', 'River', 'Lake', 'Summit', 'Canyon', 'Terrace', 'Pavilion', 'Springs', 'Lagoon', 'Ridge'];
const ADJ_SET = new Set(ROOM_ADJECTIVES), NOUN_SET = new Set(ROOM_NOUNS);

export function randomRoomName(rng = Math.random) {
    const pick = (list) => list[Math.floor(rng() * list.length)];
    return `${pick(ROOM_ADJECTIVES)} ${pick(ROOM_NOUNS)}`;
}

// True only for an exact list name ("Jade Peak").
export function isRoomName(s) {
    if (typeof s !== 'string') return false;
    const [adj, noun, ...rest] = s.split(' ');
    return rest.length === 0 && ADJ_SET.has(adj) && NOUN_SET.has(noun);
}
