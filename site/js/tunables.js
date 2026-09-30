// Every gameplay number lives here (spec §6.10). The dev panel (` key)
// edits this object live; overrides persist in localStorage so a tuned
// feel survives reloads, and "Copy JSON" exports them for the spec.

export const DEFAULTS = {
    // --- Flight (spec §6.2) ---
    speedCruise: 16,        // m/s
    speedBoost: 26,
    speedBrake: 10,
    turnCruise: 150,        // deg/s at full stick
    turnBoost: 95,
    turnBrake: 230,
    sizeTurnPenalty: 0.3,   // turn rate × (1 − k·min(1, m/2000))
    speedTau: 0.35,         // s, speed response
    carveTau: 0.10,         // s, velocity direction trails the nose
    steerTau: 0.06,         // s, stick smoothing (gives the dragon weight)
    rollRate: 120,          // deg/s, A/D
    levelRate: 120,         // deg/s, auto-level toward horizon (gravity worlds)
    assistRate: 60,         // deg/s, zero-G orientation assist
    diveBoost: 6,           // m/s added × sin(dive angle), gravity worlds
    visualBank: 50,         // deg, cosmetic bank into turns

    // --- Mouse flight (spec §7) ---
    steerCircle: 0.30,      // radius as fraction of the shorter screen side
    steerDeadzone: 0.06,
    steerExpo: 1.5,         // response curve exponent
    lockSensitivity: 1.0,   // pointer-lock (virtual stick) mode
    keySteer: 0.7,          // arrow keys: fraction of max turn rate

    // --- Growth, boost, orbs (spec §6.1, §6.4, §6.5) ---
    spawnMass: 10,
    lenBase: 8,             // L = lenBase + lenPerMass·m
    lenPerMass: 0.4,
    lenCap: 400,
    radiusBase: 0.6,        // r = radiusBase + radiusGrow·min(1, m/2000)
    radiusGrow: 1.4,
    beadSpacing: 0.7,       // × r
    boostCost: 4,           // mass/s
    boostDropShare: 0.5,    // share of boost cost dropped as orbs
    boostMinMass: 15,
    orbTarget: 800,         // ambient orbs per room
    orbClusterShare: 0.6,
    pickupBase: 2,          // pickup radius = pickupBase + r
    lootShare: 0.8,         // share of mass dropped on death
    lootTtl: 45,            // s
    botGrowthCapMass: 400,  // bots grow at half rate above this

    // --- Collision (spec §6.3) ---
    tailColScale: 0.8,      // tail collider = k × visual bead radius
    headColScale: 1.0,      // head collider = k × r
    spawnProtect: 3,        // s
    nearMissPad: 1.2,       // m beyond touching counts as a near miss
    encounterDist: 4,       // m, "had to react" distance (spec §4)

    // --- Power-ups (spec §6.6) ---
    powerups: 1,            // 0 = off
    dragonfire: 1,          // 0 = off (signature power-up, flagged)
    powerupMax: 3,
    powerupEvery: 35,       // s (±25%)
    shieldTime: 12,
    magnetTime: 10,
    magnetRadius: 18,
    fireRange: 14,
    fireAngle: 22,          // deg half-angle

    // --- Arena & population (spec §4, §9, §14) ---
    population: 24,         // dragons incl. you
    botAggression: 0.6,     // 0 = orb-eaters, 1 = hunters
    skyRadius: 70,
    skyCeiling: 85,
    orbRadius: 65,

    // --- Camera (spec §8) ---
    camDist: 7,
    camDistPerLen: 0.02,
    camDistMax: 16,
    camHeight: 2.2,
    camLookAhead: 10,
    camPosTau: 0.12,
    camRotTau: 0.08,
    camRollFollow: 0.35,
    fov: 72,
    fovBoost: 84,
};

// Slider metadata for the dev panel: [key, min, max, step, group, restart?]
export const PANEL = [
    ['speedCruise', 6, 40, 0.5, 'Flight'],
    ['speedBoost', 10, 60, 0.5, 'Flight'],
    ['speedBrake', 3, 30, 0.5, 'Flight'],
    ['turnCruise', 40, 360, 5, 'Flight'],
    ['turnBoost', 20, 300, 5, 'Flight'],
    ['turnBrake', 60, 480, 5, 'Flight'],
    ['speedTau', 0.02, 2, 0.01, 'Flight'],
    ['carveTau', 0, 0.6, 0.01, 'Flight'],
    ['steerTau', 0, 0.4, 0.01, 'Flight'],
    ['diveBoost', 0, 20, 0.5, 'Flight'],
    ['rollRate', 30, 360, 5, 'Flight'],
    ['levelRate', 0, 360, 5, 'Flight'],
    ['assistRate', 0, 240, 5, 'Flight'],
    ['steerCircle', 0.1, 0.5, 0.01, 'Controls'],
    ['steerDeadzone', 0, 0.3, 0.01, 'Controls'],
    ['steerExpo', 1, 3, 0.05, 'Controls'],
    ['lockSensitivity', 0.2, 3, 0.05, 'Controls'],
    ['lenPerMass', 0.1, 1.5, 0.05, 'Growth & combat'],
    ['radiusGrow', 0, 4, 0.1, 'Growth & combat'],
    ['boostCost', 0, 15, 0.5, 'Growth & combat'],
    ['orbTarget', 100, 3000, 50, 'Growth & combat'],
    ['pickupBase', 0.5, 8, 0.25, 'Growth & combat'],
    ['tailColScale', 0.3, 1.5, 0.05, 'Growth & combat'],
    ['headColScale', 0.3, 1.5, 0.05, 'Growth & combat'],
    ['powerups', 0, 1, 1, 'Growth & combat'],
    ['dragonfire', 0, 1, 1, 'Growth & combat'],
    ['population', 1, 60, 1, 'Arena & bots'],
    ['botAggression', 0, 1, 0.05, 'Arena & bots'],
    ['skyRadius', 30, 200, 5, 'Arena & bots', true],
    ['skyCeiling', 40, 200, 5, 'Arena & bots', true],
    ['orbRadius', 30, 200, 5, 'Arena & bots', true],
    ['camDist', 3, 20, 0.5, 'Camera'],
    ['camHeight', 0, 8, 0.1, 'Camera'],
    ['camPosTau', 0, 0.6, 0.01, 'Camera'],
    ['camRotTau', 0, 0.6, 0.01, 'Camera'],
    ['camRollFollow', 0, 1, 0.05, 'Camera'],
    ['fov', 50, 110, 1, 'Camera'],
    ['fovBoost', 50, 120, 1, 'Camera'],
];

const KEY = 'wyrm.tune.v1';

export const T = { ...DEFAULTS };

export function loadTune() {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
        for (const k of Object.keys(saved)) {
            if (k in DEFAULTS && typeof saved[k] === 'number' && Number.isFinite(saved[k])) T[k] = saved[k];
        }
    } catch { /* storage blocked: run on defaults */ }
}

export function saveTune() {
    const diff = {};
    for (const k of Object.keys(DEFAULTS)) if (T[k] !== DEFAULTS[k]) diff[k] = T[k];
    try { localStorage.setItem(KEY, JSON.stringify(diff)); } catch { /* ignore */ }
    return diff;
}

export function resetTune() {
    Object.assign(T, DEFAULTS);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Derived helpers shared by sim, bots and render.
export const lengthFor = (m) => Math.min(T.lenCap, T.lenBase + T.lenPerMass * m);
export const radiusFor = (m) => T.radiusBase + T.radiusGrow * Math.min(1, m / 2000);

export const TIERS = [
    { name: 'Hatchling', mass: 0 },
    { name: 'Drake', mass: 60 },
    { name: 'Wyvern', mass: 200 },
    { name: 'Elder', mass: 450 },
    { name: 'Ancient', mass: 800 },
];
export function tierFor(m) {
    let t = 0;
    for (let i = 0; i < TIERS.length; i++) if (m >= TIERS[i].mass) t = i;
    return t;
}
