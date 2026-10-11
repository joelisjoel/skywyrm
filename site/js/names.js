// Safety checks for every user-writable string (player names, server
// names). Shared by the browser (for instant feedback) and the game
// server (the authority — its verdict is what everyone else sees).
// Strings are only ever rendered with textContent / fillText.

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i' };

// Kept short and generic; matched against a squashed, de-leeted form.
const BLOCKED = ['fuck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'whore',
    'slut', 'rape', 'nazi', 'hitler', 'kike', 'spic', 'chink', 'tranny', 'dick', 'cock', 'pussy', 'porn',
    'penis', 'vagina', 'kkk', 'isis', 'kys'];

// Words that impersonate staff or the built-in rooms.
const RESERVED = ['admin', 'moderator', 'mod ', 'official', 'staff', 'system', 'server', 'skywyrm', 'wyrm team'];

export const LIMITS = { player: 16, room: 24 };

// Normalise and strip everything outside a small allowlist.
export function clean(raw, max) {
    let s = String(raw ?? '').normalize('NFC');
    s = s.replace(/[​-‏‪-‮⁠-⁯﻿]/g, '');          // zero-width, bidi overrides
    s = s.replace(/(\p{M}{2})\p{M}+/gu, '$1');                                        // zalgo: ≤2 marks in a row
    s = s.replace(/[^\p{L}\p{M}\p{N} \-_.'!?&#]/gu, '');                              // allowlist
    s = s.replace(/\s+/g, ' ').trim();
    return [...s].slice(0, max).join('').trim();
}

function squash(s) {
    return s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
        .replace(/[0-9@$!]/g, (c) => LEET[c] || c).replace(/[^a-z]/g, '');
}

const URLISH = /(https?|www|\.com|\.net|\.org|\.io|\.gg|\.xyz|\.ru|dot ?com|@)/i;

// Returns { ok, value, reason }. `kind` is 'player' or 'room'.
export function checkName(raw, kind = 'player', extraReserved = []) {
    const max = LIMITS[kind] || 16;
    const value = clean(raw, max);
    if (value.length < (kind === 'room' ? 3 : 1)) return { ok: false, value, reason: kind === 'room' ? 'Use at least 3 letters or numbers' : 'Pick a name' };
    if (URLISH.test(value)) return { ok: false, value, reason: 'No links or e-mail addresses' };
    const sq = squash(value);
    if (BLOCKED.some((w) => sq.includes(w))) return { ok: false, value, reason: 'Please choose a different name' };
    const low = value.toLowerCase() + ' ';
    if ([...RESERVED, ...extraReserved.map((r) => r.toLowerCase())].some((w) => low.startsWith(w) || low.includes(' ' + w.trim() + ' ') || sq === squash(w))) {
        return { ok: false, value, reason: 'That name is reserved' };
    }
    return { ok: true, value, reason: '' };
}

// Player names never block play: fall back to a safe default instead.
export function safePlayerName(raw, fallback = 'Dragon') {
    const r = checkName(raw, 'player');
    return r.ok ? r.value : fallback;
}
