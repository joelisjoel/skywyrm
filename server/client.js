// One browser's connection: its socket, plus its dragon and park state in a
// room (rooms.js). Sending copes with slow connections without ever losing
// track of a dragon.
export const SNAP_BUFFER = 512 * 1024;          // skip snapshots with this much queued
export const MAX_BUFFER = 4 * 1024 * 1024;      // close a socket this far behind (4009)

export class Client {
    constructor(ws) { this.ws = ws; this.dragon = null; this.room = null; this.parkAt = 0; this.parked = null; this.life = null; this.unsentOrbs = null; }

    // Returns whether the frame went out. Under backpressure only snapshots
    // ('s') are skipped: the next one replaces them, and rooms.js carries
    // their food changes over. Dragons appearing and leaving, events and the
    // welcome always go out. A client too far behind is closed rather than
    // buffered forever.
    send(msg) { return this.sendRaw(JSON.stringify(msg), msg.t === 's'); }
    sendRaw(s, skippable = false) {
        const ws = this.ws;
        if (ws.readyState !== 1) return false;
        if (ws.bufferedAmount > MAX_BUFFER) { this.close(4009, 'too slow'); return false; }
        if (skippable && ws.bufferedAmount >= SNAP_BUFFER) return false;
        ws.send(s);
        return true;
    }

    close(code, reason) { try { this.ws.close(code, reason); } catch { /* already closed */ } }
}
