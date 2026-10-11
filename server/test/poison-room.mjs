// Test-only preload for crash.test.mjs (`node --import ./test/poison-room.mjs
// server.js`): plants bugs inside the real server to check that one room's
// exception can't take down the process or the other rooms.
//   - The Orb's tick throws once it has run 30 ticks with players in it.
//   - 'unpark' throws for a dragon named "Boom…" (its sender is closed, not the room).
//   - A stray promise rejection, 1.5 s after start.
import { Room } from '../rooms.js';

const tick = Room.prototype.tick;
Room.prototype.tick = function () {
    if (this.meta.id === 'the-orb' && this.humans > 0 && (this.poison = (this.poison || 0) + 1) > 30) throw new Error('test: poisoned tick');
    return tick.call(this);
};

const unpark = Room.prototype.unpark;
Room.prototype.unpark = function (client) {
    if (client.dragon && client.dragon.name.startsWith('Boom')) throw new Error('test: poisoned message');
    return unpark.call(this, client);
};

setTimeout(() => Promise.reject(new Error('test: stray rejection')), 1500);
