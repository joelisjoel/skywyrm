// Backpressure: a slow client skips snapshots only. Dragons appearing and
// leaving and events always reach it, a skipped snapshot's food changes
// ride along with the next one, and a client too far behind is closed
// (4009). Uses fake sockets whose queued byte count the test sets.
// Run: cd server && npm test
import assert from 'node:assert/strict';
import { Client, SNAP_BUFFER, MAX_BUFFER } from '../client.js';
import { Registry } from '../rooms.js';

let ok = 0;
const check = (cond, msg) => { assert.ok(cond, msg); ok++; console.log('  ✓', msg); };
const fakeWs = () => ({ readyState: 1, bufferedAmount: 0, frames: [], closed: null,
    send(s) { this.frames.push(JSON.parse(s)); },
    close(code, reason) { this.closed = { code, reason }; this.readyState = 2; } });
const types = (ws) => ws.frames.map((m) => m.t);

{
    const ws = fakeWs(), c = new Client(ws);
    check(c.send({ t: 's' }) && c.send({ t: 'dn' }) && types(ws).join() === 's,dn', 'a keeping-up client gets every frame');
    ws.frames.length = 0;
    ws.bufferedAmount = SNAP_BUFFER;
    const sent = ['s', 'dn', 'dx', 'e', 'welcome', 'pong'].map((t) => c.send({ t }));
    check(!sent[0] && sent.slice(1).every(Boolean) && types(ws).join() === 'dn,dx,e,welcome,pong',
        `${SNAP_BUFFER / 1024} KB queued: snapshots are skipped, control frames still go out`);
    c.sendRaw(JSON.stringify({ t: 'dx', id: 1 }));
    check(ws.frames.length === 6, 'broadcasts (sendRaw) are never skipped');
    ws.bufferedAmount = MAX_BUFFER + 1;
    check(!c.send({ t: 'dn' }) && ws.closed && ws.closed.code === 4009 && ws.closed.reason === 'too slow' && ws.frames.length === 6,
        `over ${MAX_BUFFER / 1024 / 1024} MB queued: closed with 4009 'too slow' instead of buffering more`);
    check(!c.send({ t: 'e' }) && ws.frames.length === 6, 'nothing more is sent to a closing socket');
}

{
    const store = { kind: 'memory', async loadAll() { return []; }, async save() {}, async remove() {} };
    const reg = new Registry(store);
    await reg.init();
    const room = reg.get('skyhold');
    const a = new Client(fakeWs()), b = new Client(fakeWs()), c = new Client(fakeWs());
    room.join(a, 'Ann'); room.join(b, 'Bea');
    const snaps = (cl) => cl.ws.frames.filter((m) => m.t === 's');
    for (let i = 0; i < 4; i++) room.tick();
    const aBefore = snaps(a).length, bBefore = snaps(b).length;
    b.ws.bufferedAmount = SNAP_BUFFER + 1;               // Bea's connection stalls
    b.ws.frames.length = 0;
    for (let i = 0; i < 30; i++) room.tick();
    room.join(c, 'Cy');
    for (let i = 0; i < 30; i++) room.tick();
    room.leave(c, 'quit');                                // left: its 3 s in the sky, then dx
    for (let i = 0; i < 100; i++) room.tick();
    const cId = c.dragon.id;
    check(snaps(b).length === 0 && b.ws.frames.some((m) => m.t === 'dn' && m.d.id === cId) && b.ws.frames.some((m) => m.t === 'dx' && m.id === cId),
        'in a room: a stalled client skips snapshots but still hears a dragon arrive (dn) and leave (dx)');
    const missed = snaps(a).slice(aBefore);               // Ann's snapshots while Bea was stalled
    b.ws.bufferedAmount = 0;                              // and catches up
    room.tick(); room.tick();
    const want = missed.flatMap((s) => s.o).concat(snaps(a).at(-1).o);
    check(bBefore === aBefore && missed.length === 80 && want.length > 0 && JSON.stringify(snaps(b)[0].o) === JSON.stringify(want),
        `the next snapshot carries the ${want.length} food changes of the ${missed.length} it skipped`);
    room.tick(); room.tick();
    check(JSON.stringify(snaps(b)[1].o) === JSON.stringify(snaps(a).at(-1).o), 'then food changes are back to one snapshot\'s worth');
    b.ws.bufferedAmount = MAX_BUFFER + 1;
    room.tick(); room.tick();
    check(b.ws.closed && b.ws.closed.code === 4009 && !a.ws.closed, 'in a room: a client 4 MB behind is closed, the others carry on');
}
console.log(`\n${ok} checks passed`);
