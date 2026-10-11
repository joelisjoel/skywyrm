// Persistence. Firestore on Cloud Run (the service account is picked
// up automatically — no key files); plain memory everywhere else.
// Two things live here: the room list (`rooms`) and the anonymous daily
// play totals (`stats`, one document per UTC day, see stats.js). Game
// state is in memory.

export async function makeStore(log) {
    const useFirestore = process.env.STORE === 'firestore' || (process.env.K_SERVICE && process.env.STORE !== 'memory');
    if (!useFirestore) {
        const mem = new Map();
        const days = new Map();
        return {
            kind: 'memory',
            async loadAll() { return [...mem.values()]; },
            async save(meta) { mem.set(meta.id, { ...meta }); },
            async remove(id) { mem.delete(id); },
            async loadStats() { return [...days.values()].map((d) => structuredClone(d)); },
            async saveStats(day) { days.set(day.day, structuredClone(day)); },
            async removeStats(day) { days.delete(day); },
        };
    }
    const { Firestore, Timestamp } = await import('@google-cloud/firestore');
    const db = new Firestore();
    const col = db.collection('rooms');
    const statsCol = db.collection('stats');
    const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { log('store error', e.message); return null; } };
    return {
        kind: 'firestore',
        loadAll: safe(async () => (await col.get()).docs.map((d) => {
            const m = d.data();
            return { ...m, expireAt: m.expireAt ? m.expireAt.toMillis() : null };
        })),
        // expireAt is a Timestamp so a Firestore TTL policy can clean up too.
        save: safe(async (meta) => col.doc(meta.id).set({ ...meta, expireAt: meta.expireAt ? Timestamp.fromMillis(meta.expireAt) : null })),
        remove: safe(async (id) => col.doc(id).delete()),
        // Daily totals: the document id is the day ('2026-10-11'); stats.js
        // deletes days older than 30.
        loadStats: safe(async () => (await statsCol.get()).docs.map((d) => d.data())),
        saveStats: safe(async (day) => statsCol.doc(day.day).set(day)),
        removeStats: safe(async (day) => statsCol.doc(day).delete()),
    };
}
