// Entry point for the multiplayer server (wyrm-server/): the exact same
// simulation modules the browser runs, with the same cache stamps, so both
// sides share one module instance of the tunables.
export * from './tunables.js?v=11';
export * from './sim.js?v=11';
export * from './bots.js?v=11';
export * from './names.js?v=8';
