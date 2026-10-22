// Invite a friend into your server: a link to the game that opens the menu
// with that server pinned at the top of the list (main.js; nobody is
// joined without a tap). The link holds only the room's id and the visit
// tag src=invite (visit.js), never a player's name. Pure functions, so the
// tests run them in Node.
import { isRoomName } from './names.js?v=12';

const HOME = 'https://skywyrm.io/';
const BUILT_IN = ['Skyhold', 'The Orb'];     // the always-on rooms (server/rooms.js)

// A ?room= value → the room id, or '' if it can't be one. Room ids are
// 'skyhold', 'the-orb' or 12 base64url characters (server/rooms.js).
export function roomParam(v) {
    return typeof v === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(v) ? v : '';
}

// The invite link for a room. On the game's own site, its canonical
// address; anywhere else (a local test page), this page's own address,
// keeping a local ?server= so the friend reaches the same test server.
export function inviteLink(roomId, loc = location) {
    const id = encodeURIComponent(roomParam(roomId));
    if (/^(www\.)?skywyrm\.io$/.test(loc.hostname)) return `${HOME}?room=${id}&src=invite`;
    let server = '';
    try { server = new URLSearchParams(loc.search).get('server') || ''; } catch { /* none */ }
    return `${loc.origin}${loc.pathname}?room=${id}&src=invite` + (server ? `&server=${encodeURIComponent(server)}` : '');
}

// The share text: fixed words, plus the server's name only when it is one
// the game made (the word lists in names.js, or a built-in room). Never
// anything a player typed.
export function inviteText(roomName) {
    const name = isRoomName(roomName) || BUILT_IN.includes(roomName) ? roomName : '';
    return name ? `Fly with me in Skywyrm — server ${name}` : 'Fly with me in Skywyrm';
}

// The server list (already sorted) with the invited room moved to the top.
// → { rooms, pinned }: pinned is that room, or null if it isn't listed.
export function pinRoom(rooms, id) {
    const pinned = (id && rooms.find((r) => r.id === id)) || null;
    return { rooms: pinned ? [pinned, ...rooms.filter((r) => r !== pinned)] : rooms, pinned };
}
