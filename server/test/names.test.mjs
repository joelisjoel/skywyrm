// Unit tests for the name filter and the room-name lists (site/js/names.js),
// which the browser and the server share. Run with `npm test`. The word
// lists below are the acceptance test, so the blocked strings live only in
// this file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkName, safePlayerName, ROOM_ADJECTIVES, ROOM_NOUNS, randomRoomName, isRoomName } from '../../site/js/shared.js';
import { RESERVED_ROOM_NAMES } from '../rooms.js';

let ok = 0;
const check = (cond, msg) => { assert.ok(cond, msg); ok++; console.log('  ✓', msg); };
const failing = (list, want) => list.filter((n) => want(checkName(n, 'player')) === false);

// Every bot name, as bots.js spells it, with and without the 10–99 suffix
// it adds when a name is already in use.
const src = readFileSync(new URL('../../site/js/bots.js', import.meta.url), 'utf8');
const BOTS = [.../const NAMES = \[([\s\S]*?)\];/.exec(src)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const BOT_NAMES = BOTS.flatMap((n) => [n, ...Array.from({ length: 90 }, (_, k) => n + (k + 10))]);

const PASS = ['SkyStorm', 'Sky Serpent', 'Skyscale', 'Sky Spirit', 'Sky Snake', 'Grape', 'Drapes', 'Spicy Dragon',
    'Peacock', 'Cockatoo', 'Dickens', 'Cumulus', 'Torpedo', 'Bass Drop', 'Titan', 'Glass Wing', 'Jade Emperor', 'Ember',
    'Ember Drake', 'Atlas Storm', 'Kung Fu Kid', 'Cookie Monster', 'Assassin', 'Classic', 'Thorny', 'Awww', 'Pyra55',
    // near the 2026-10 additions: words that hold one, two words that run into one with an ending, symbols between words
    'Cook', 'Raccoon', 'Cocoon', 'Tycoon', 'Pakistan', 'Saltwater', 'Wristwatch', 'Spicy', 'Cumin', 'Annals', 'Ana Lin',
    'An Ally', 'Shy Ting', 'Wolf-Kid', 'Speed-Up', 'Trish#7', "O'Neil", 'Mary-Jo', 'Sun.Moon', 'Mr. Dragon', 'Team 88'];
const BLOCK = ['kys', 'kys now', 'KysNow', 'kys2', 'fuk', 'fck', 'phuck', 'fvck', 'f u c k', 'fuuuck', 'ni99er', 'n1663r',
    'sh1t', 'ass', 'asshole', 'sex', 'sexy', 'boobs', 'tits', 'pedo', 'killyourself', 'kill urself', 'porn', 'dildo',
    'cum', 'jizz', 'milf', 'horny', 'nsfw', 'xxx', 'suicide', '\uFF26\uFF55\uFF43\uFF4B', 'b00bs', 'Big Ass',
    // the list before this filter
    'fuck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'whore', 'slut', 'rape', 'nazi',
    'hitler', 'kike', 'spic', 'chink', 'tranny', 'dick', 'cock', 'pussy', 'penis', 'vagina', 'kkk', 'isis',
    // 2026-10 security review: split words, a symbol for a vowel, numbers read whole, spellings, missing words
    'Fu ck', 'Sh it', 'Bi tch', 'Di ck', 'Fu cks', 'N_gger', 'Sh#t', 'C_nt', "Sh't", 'Big_N_gger', 'Sh#tty', 'A55', 'PEN15',
    '80085', 'Nygger', 'Niqqer', 'Nibba', 'Coon', 'Coons', 'Gook', 'Beaner', 'Wetback', 'Dyke', 'Paki', 'Twat',
    'Kill Jews', 'Gas the Jews', 'Sieg Heil', '1488', 'Team 14 88'];
const NOT_ASCII = ['fu\u0441k' /* Cyrillic с */, '\u3164\u3164' /* Hangul filler */, '\uFFA0', 'Dragon\u0131', 'Δράκος', '龙'];
const RESERVED = ['Admin', 'admin123', 'The Official', 'Server Bot', 'Sky wyrm', 'Mod', 'ServerBot', 'Wyrm Team'];
const NOT_RESERVED = ['Systemic', 'Serverus', 'Staffy', 'Officially Cool'];

let bad = failing(PASS, (r) => r.ok);
check(!bad.length, `${PASS.length} innocent names pass` + (bad.length ? `: failed ${bad.join(', ')}` : ''));
bad = failing(BOT_NAMES, (r) => r.ok && r.value === r.value.trim());
check(!bad.length, `all ${BOTS.length} bot names pass, with and without a number` + (bad.length ? `: failed ${bad.slice(0, 20).join(', ')}` : ''));
bad = failing(BLOCK, (r) => !r.ok && r.reason === 'Please choose a different name');
check(!bad.length, `${BLOCK.length} bad names blocked` + (bad.length ? `: passed ${bad.join(', ')}` : ''));
bad = failing(NOT_ASCII, (r) => !r.ok && r.reason === 'Use letters A–Z and numbers');
check(!bad.length, 'letters outside A–Z (Cyrillic, Hangul filler, dotless ı, Greek, Chinese) refused with a reason' + (bad.length ? `: passed ${bad.join(', ')}` : ''));
bad = failing(RESERVED, (r) => !r.ok && r.reason === 'That name is reserved');
check(!bad.length, 'reserved words refused as whole words' + (bad.length ? `: passed ${bad.join(', ')}` : ''));
bad = failing(NOT_RESERVED, (r) => r.ok);
check(!bad.length, 'reserved words inside longer words are fine' + (bad.length ? `: failed ${bad.join(', ')}` : ''));

check(checkName('José', 'player').value === 'Jose' && checkName('\uFF33\uFF4B\uFF59 \uFF33\uFF43\uFF41\uFF4C\uFF45', 'player').value === 'Sky Scale', 'accents and full-width letters fold to plain ASCII');
check(checkName('B\u200Bob\u202E', 'player').value === 'Bob' && checkName('Z\u0337\u0322a\u0335l\u0336g\u0338o', 'player').value === 'Zalgo', 'zero-width, bidi and zalgo marks stripped');
check(checkName('Alice <script>', 'player').value === 'Alice script' && checkName('A'.repeat(30), 'player').value.length === 16
    && checkName('B'.repeat(40), 'room').value.length === 24, 'other symbols stripped; 16 / 24 character limits');
check(checkName('join www.spam.gg', 'room').reason === 'No links or e-mail addresses', 'links refused');
check(checkName('', 'player').reason === 'Pick a name' && checkName('!!!', 'player').reason === 'Use letters A–Z and numbers', 'empty or punctuation-only names refused');
check(checkName('Nest', 'room', ['Nest', 'The Orb']).reason === 'That name is reserved' && checkName('Nesting Orbit', 'room', ['Nest', 'The Orb']).ok,
    'extra reserved names (built-in rooms) match whole words');
check(safePlayerName('kys') === 'Dragon' && safePlayerName('fu\u0441k') === 'Dragon' && safePlayerName('José') === 'Jose', 'the server falls back to "Dragon"');

// Room names: generated from two word lists, never typed.
const ROOMS = ROOM_ADJECTIVES.flatMap((a) => ROOM_NOUNS.map((n) => `${a} ${n}`));
bad = ROOMS.filter((n) => { const r = checkName(n, 'room', RESERVED_ROOM_NAMES); return !r.ok || r.value !== n; });
check(!bad.length && new Set(ROOMS).size === ROOMS.length, `all ${ROOMS.length} room names pass the room filter` + (bad.length ? `: failed ${bad.join(', ')}` : ''));
const BUILT_IN = ['nest', 'orb', 'skyhold', 'server', 'admin', 'official', 'staff', 'system', 'mod', 'skywyrm', 'wyrm'];
bad = [...ROOM_ADJECTIVES, ...ROOM_NOUNS].filter((w) => BUILT_IN.some((b) => w.toLowerCase().includes(b)));
check(!bad.length, 'no room word is or contains a built-in or reserved name' + (bad.length ? `: ${bad.join(', ')}` : ''));
const rolls = Array.from({ length: 200 }, () => randomRoomName());
check(rolls.every(isRoomName) && randomRoomName(() => 0) === `${ROOM_ADJECTIVES[0]} ${ROOM_NOUNS[0]}` && randomRoomName(() => 0.999999) === `${ROOM_ADJECTIVES.at(-1)} ${ROOM_NOUNS.at(-1)}`,
    'randomRoomName gives list names (and takes an rng)');
check(![`${ROOM_ADJECTIVES[0].toLowerCase()} ${ROOM_NOUNS[0]}`, `${ROOM_ADJECTIVES[0]}  ${ROOM_NOUNS[0]}`, `${ROOMS[0]} Extra`, ROOM_ADJECTIVES[0],
    'Skyhold', 'The Orb', '', null, 42, ['Jade', 'Peak']].some(isRoomName), 'isRoomName accepts only an exact list name');

console.log(`\n${ok} name checks passed`);
