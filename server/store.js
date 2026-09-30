// Room persistence. Firestore on Cloud Run (the service account is picked
// up automatically — no key files); plain memory everywhere else.
// Only the room list lives here: game state is in memory.

export async function makeStore(log) {
    const useFirestore = process.env.STORE === 'firestore' || (process.env.K_SERVICE && process.env.STORE !== 'memory');
    if (!useFirestore) {
        const mem = new Map();
        return {
            kind: 'memory',
            async loadAll() { return [...mem.values()]; },
            async save(meta) { mem.set(meta.id, { ...meta }); },
            async remove(id) { mem.delete(id); },
        };
    }
    const { Firestore, Timestamp } = await import('@google-cloud/firestore');
    const col = new Firestore().collection('rooms');
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
    };
}
