// Perks and dragon colours a profile can unlock (by rank) and equip. Pure
// data + validation, shared by the browser (profile.js) and the game server,
// which applies perks itself (see World.spawn) and ignores anything unknown.
// With no accounts yet, a browser could claim perks it hasn't earned; each
// is small, at most two are active, and rooms can switch them off (rule
// `perks`).
export const PERKS = {
    lungs: { icon: '💨', name: 'Deep Lungs', zh: '气', desc: '+20% thrust tank', level: 2 },
    pull: { icon: '🧲', name: 'Keen Pull', zh: '引', desc: 'Pick up food from 40% farther', level: 3 },
    scales: { icon: '🛡', name: 'Thick Scales', zh: '鳞', desc: 'Every life starts with a 6 s Ember Shield', level: 5 },
    ember: { icon: '🔥', name: 'Ember Heart', zh: '焰', desc: 'Every life starts with dragonfire ready', level: 7 },
};
export const MAX_PERKS = 2;
export const perkSlots = (level) => (level >= 6 ? 2 : level >= 2 ? 1 : 0);

export const SKINS = [
    { id: 'ember', name: 'Ember', c1: 0xFFD93D, c2: 0xFF9A3C, level: 1 },
    { id: 'jade', name: 'Jade', c1: 0x3DFFB5, c2: 0x1F8F5F, level: 2 },
    { id: 'azure', name: 'Azure', c1: 0x3D9BFF, c2: 0xE6F0FF, level: 3 },
    { id: 'crimson', name: 'Crimson', c1: 0xE0303A, c2: 0xFFD24A, level: 4 },
    { id: 'obsidian', name: 'Obsidian', c1: 0x33323F, c2: 0xB06CFF, level: 6 },
    { id: 'pearl', name: 'Pearl', c1: 0xF4EFE4, c2: 0x7FD8FF, level: 8 },
    { id: 'imperial', name: 'Imperial', c1: 0xFFC23A, c2: 0xC0202A, level: 10 },
];
export const skinById = (id) => SKINS.find((s) => s.id === id) || null;

// Known perk ids only, no repeats, at most MAX_PERKS.
export function cleanPerks(list) {
    const out = [];
    if (Array.isArray(list)) for (const p of list) if (typeof p === 'string' && PERKS[p] && !out.includes(p) && out.length < MAX_PERKS) out.push(p);
    return out;
}
