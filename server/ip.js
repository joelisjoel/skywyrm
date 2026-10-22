// The address the per-IP limits count (server.js, rooms.js). An IPv4
// address counts as itself. An IPv6 address counts by its /64: that's what
// one home or phone gets, and it can use any address inside it, so counting
// whole addresses would let one device dodge every limit. An IPv4 address
// written as IPv6 ("::ffff:1.2.3.4") counts as the IPv4 one.
export function ipKey(ip) {
    const s = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return mapped[1];
    if (!s.includes(':')) return s || 'unknown';
    const [head, tail] = s.split('::');
    const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
    const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
    if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return s;   // not an address: count it as typed
    return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':') + '::/64';
}
