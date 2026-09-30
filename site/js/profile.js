// Your profile, kept in this browser: jade (玉) earned from every life,
// a rank that unlocks perks and dragon colours, and what you've equipped.
// Nothing here is sent anywhere except the equipped perk ids and colour,
// which the game server re-checks (see perks.js).
import { PERKS, SKINS, perkSlots, cleanPerks, skinById } from './perks.js?v=1';

const KEY = 'wyrm.profile.v1';

// Ranks: the jade you need, and a one-character seal for each.
export const RANKS = [
    { name: 'Pebble', zh: '石', jade: 0 },
    { name: 'Jade', zh: '玉', jade: 300 },
    { name: 'Pearl', zh: '珠', jade: 900 },
    { name: 'Cloud', zh: '云', jade: 2000 },
    { name: 'Storm', zh: '雷', jade: 4000 },
    { name: 'River', zh: '江', jade: 7000 },
    { name: 'Mountain', zh: '山', jade: 11000 },
    { name: 'Sun', zh: '日', jade: 16000 },
    { name: 'Heaven', zh: '天', jade: 23000 },
    { name: 'Sky Lord', zh: '龙', jade: 32000 },
];

export function rankFor(jade) {
    let i = 0;
    while (i + 1 < RANKS.length && jade >= RANKS[i + 1].jade) i++;
    const next = RANKS[i + 1];
    return { level: i + 1, ...RANKS[i], next: next || null, progress: next ? (jade - RANKS[i].jade) / (next.jade - RANKS[i].jade) : 1 };
}

// Jade for one life: length, kills, bites, time, and a bonus for the podium.
export function jadeFor(life) {
    const podium = life.rank === 1 ? 60 : life.rank <= 3 ? 25 : 0;
    return Math.max(1, Math.round(life.peak + life.kills * 40 + life.bites * 10 + life.time / 6 + podium));
}

export class Profile {
    constructor() {
        this.data = { v: 1, jade: 0, games: 0, lives: 0, bestLength: 0, bestKills: 0, perks: [], skin: 'ember' };
        try { Object.assign(this.data, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* fresh profile */ }
        this.data.jade = Math.max(0, Number(this.data.jade) || 0);
        this.tidy();
    }

    save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage blocked */ } }
    get rank() { return rankFor(this.data.jade); }
    get skin() { return skinById(this.data.skin) || SKINS[0]; }

    // Only perks and colours your rank has unlocked, and no more perks than your slots.
    tidy() {
        const lv = this.rank.level;
        this.data.perks = cleanPerks(this.data.perks).filter((p) => PERKS[p].level <= lv).slice(0, perkSlots(lv));
        const s = skinById(this.data.skin);
        if (!s || s.level > lv) this.data.skin = 'ember';
    }

    // Equip / unequip a perk (dropping the oldest if the slots are full).
    togglePerk(id) {
        const lv = this.rank.level, p = this.data.perks;
        if (!PERKS[id] || PERKS[id].level > lv) return;
        const i = p.indexOf(id);
        if (i >= 0) p.splice(i, 1);
        else { p.push(id); while (p.length > perkSlots(lv)) p.shift(); }
        this.save();
    }

    setSkin(id) {
        const s = skinById(id);
        if (s && s.level <= this.rank.level) { this.data.skin = id; this.save(); }
    }

    // Bank one life's jade. Returns { gained, rankUp: rank | null }.
    award(life) {
        const before = this.rank.level;
        const gained = jadeFor(life);
        const d = this.data;
        d.jade += gained; d.lives++;
        d.bestLength = Math.max(d.bestLength, Math.round(life.peak));
        d.bestKills = Math.max(d.bestKills, life.kills);
        this.save();
        const r = this.rank;
        return { gained, rankUp: r.level > before ? r : null };
    }

    gameDone() { this.data.games++; this.save(); }
}
