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
    orbTarget: 2000,        // ambient orbs per room
    orbClusterShare: 0.6,
    foodSpread: 0.2,        // σ of the central food cloud, × arena radius
    foodUniformShare: 0.15, // share of food sprinkled evenly everywhere
    pickupBase: 2,          // pickup radius = pickupBase + r
    lootShare: 0.8,         // share of mass dropped on death
    lootTtl: 45,            // s
    botGrowthCapMass: 400,  // bots grow at half rate above this

    // --- Body temp & thrust (reward for holding the hot, crowded centre) ---
    ambientTemp: 10,        // body temp far out in the cold
    sunHeat: 70,            // target temp right at the sun (arena centre)
    sunRadius: 0.35,        // sun's reach (Gaussian falloff), × arena radius
    crowdHeat: 35,          // extra target temp in a full crowd
    crowdRadius: 35,        // m: dragons within this count as your crowd
    crowdFull: 5,           // dragons for the full crowd bonus
    tempRiseTau: 3,         // s to warm up
    tempFallTau: 7,         // s to cool down
    tempSpeed: 0.4,         // top speed × (1 + tempSpeed·temp/100)
    thrustBase: 10,         // s of boost in a full tank when cold
    tempThrust: 0.6,        // tank × (1 + tempThrust·temp/100)
    thrustRegen: 0.4,       // s of boost regained per second off-boost

    // --- Collision (spec §6.3) ---
    tailColScale: 0.8,      // tail collider = k × visual bead radius
    headColScale: 1.0,      // head collider = k × r
    spawnProtect: 3,        // s
    nearMissPad: 1.2,       // m beyond touching counts as a near miss
    encounterDist: 4,       // m, "had to react" distance (spec §4)

    // --- Power-ups (spec §6.6) ---
    powerups: 1,            // 0 = off
    dragonfire: 1,          // 0 = off (signature power-up, flagged)
    powerupMax: 5,
    powerupEvery: 20,       // s (±25%)
    shieldTime: 12,
    magnetTime: 10,
    magnetRadius: 18,
    fireRange: 24,          // m, a one-charge breath (see World.breathStats)
    fireAngle: 30,          // deg half-angle
    fireTime: 1.2,          // s the breath lasts
    fireChargeRange: 0.25,  // each stored charge past the first (rule fireCharge): +25% range…
    fireChargeAngle: 0.15,  // …+15% cone half-angle…
    fireChargeTime: 0.25,   // …+25% breath time…
    fireChargeCuts: 0.5,    // …and half a tail more it can cut (levels 3 and 5 each cut one more)

    // --- Arena & population (spec §4, §9, §14) ---
    popStart: 3,            // other dragons when you spawn…
    popMax: 30,             // …growing to this many…
    popRampSec: 20,         // …one more every this many seconds
    assistLook: 1.8,        // s of flight path beginner mode checks for walls
    botAggression: 0.6,     // 0 = orb-eaters, 1 = hunters
    skyRadius: 350,         // open top: no ceiling
    orbRadius: 325,

    // --- Rules: newer mechanics, each switchable (0 = off) and overridable
    // per room via world.rules (see World.rule) ---
    tailBite: 1,            // a head can nibble the tip of a tail instead of dying on it
    biteBeads: 5,           // how many tail-tip beads are edible
    biteMult: 5,            // each bitten bead is worth this many orbs
    lives: 3,               // lives per game (0 = endless: every death ends the run)
    respawnDelay: 3,        // s between lives
    botMoods: 1,            // bots get personalities (0 = all classic)
    aggrStart: 0.25,        // bot aggression when a world wakes…
    aggrRampMin: 15,        // …rising to full over this many minutes
    botAggrMax: 1,          // cap (beginner rooms use 0.5)
    perks: 1,               // profile perks apply (0 = everyone plays stock)
    lengthSpeed: 0.5,       // longer = faster: extra speed at 100 m long (0 = off); see sizeSpeed()
    lengthSpeedExp: 0.62,   // curve: 0.62 gives +80% at 200 m when it's +50% at 100 m
    lengthSpeedMax: 1,      // cap on the length bonus (+100% = double speed)
    fireCharge: 1,          // fire crystals stack and one breath spends them all, bigger per charge (0 = one charge, classic)
    fireChargeMax: 5,       // most charges a dragon can store

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
    wideCorner: 122,        // deg from forward shown at the screen corners (wide view; was 150, 30% less warp)
    wideExpo: 3,            // how late the edge warp kicks in (higher = flatter centre)

    // --- Look (drawing only; never changes where a body really is) ---
    swimAmp: 1.05,          // side-to-side swim wave, × body radius (0 = straight)
    swimWave: 14.3,         // wave length, × body radius (longer = slower strokes at the same speed)
    swimLift: 0.35,         // up-and-down share of the wave (Chinese-dragon roll)
    headLook: 0.3,          // head turns into a turn: s of turn rate (≈ 45° at full cruise turn), 0 = off
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
    ['assistLook', 0.5, 4, 0.1, 'Flight'],
    ['sunHeat', 0, 100, 1, 'Heat & thrust'],
    ['sunRadius', 0.05, 1, 0.01, 'Heat & thrust'],
    ['crowdHeat', 0, 100, 1, 'Heat & thrust'],
    ['crowdRadius', 5, 120, 1, 'Heat & thrust'],
    ['tempRiseTau', 0.2, 20, 0.1, 'Heat & thrust'],
    ['tempFallTau', 0.2, 30, 0.1, 'Heat & thrust'],
    ['tempSpeed', 0, 1.5, 0.05, 'Heat & thrust'],
    ['thrustBase', 1, 40, 0.5, 'Heat & thrust'],
    ['tempThrust', 0, 2, 0.05, 'Heat & thrust'],
    ['thrustRegen', 0, 3, 0.05, 'Heat & thrust'],
    ['levelRate', 0, 360, 5, 'Flight'],
    ['assistRate', 0, 240, 5, 'Flight'],
    ['steerCircle', 0.1, 0.5, 0.01, 'Controls'],
    ['steerDeadzone', 0, 0.3, 0.01, 'Controls'],
    ['steerExpo', 1, 3, 0.05, 'Controls'],
    ['lockSensitivity', 0.2, 3, 0.05, 'Controls'],
    ['lenPerMass', 0.1, 1.5, 0.05, 'Growth & combat'],
    ['radiusGrow', 0, 4, 0.1, 'Growth & combat'],
    ['boostCost', 0, 15, 0.5, 'Growth & combat'],
    ['orbTarget', 100, 5000, 50, 'Growth & combat'],
    ['foodSpread', 0.05, 0.6, 0.01, 'Arena & bots'],
    ['foodUniformShare', 0, 1, 0.05, 'Arena & bots'],
    ['pickupBase', 0.5, 8, 0.25, 'Growth & combat'],
    ['tailColScale', 0.3, 1.5, 0.05, 'Growth & combat'],
    ['headColScale', 0.3, 1.5, 0.05, 'Growth & combat'],
    ['powerups', 0, 1, 1, 'Growth & combat'],
    ['dragonfire', 0, 1, 1, 'Growth & combat'],
    ['popStart', 0, 40, 1, 'Arena & bots'],
    ['popMax', 0, 60, 1, 'Arena & bots'],
    ['popRampSec', 5, 300, 5, 'Arena & bots'],
    ['botAggression', 0, 1, 0.05, 'Arena & bots'],
    ['skyRadius', 50, 800, 10, 'Arena & bots', true],
    ['orbRadius', 50, 800, 10, 'Arena & bots', true],
    ['camDist', 3, 20, 0.5, 'Camera'],
    ['camHeight', 0, 8, 0.1, 'Camera'],
    ['camPosTau', 0, 0.6, 0.01, 'Camera'],
    ['camRotTau', 0, 0.6, 0.01, 'Camera'],
    ['camRollFollow', 0, 1, 0.05, 'Camera'],
    ['fov', 50, 110, 1, 'Camera'],
    ['fovBoost', 50, 120, 1, 'Camera'],
    ['wideCorner', 60, 178, 1, 'Camera'],
    ['wideExpo', 1, 6, 0.1, 'Camera'],
    ['swimAmp', 0, 1.5, 0.05, 'Look'],
    ['swimWave', 4, 30, 0.5, 'Look'],
    ['swimLift', 0, 1, 0.05, 'Look'],
    ['headLook', 0, 0.6, 0.02, 'Look'],
    ['fireRange', 5, 60, 1, 'Growth & combat'],
    ['fireAngle', 5, 60, 1, 'Growth & combat'],
    ['fireTime', 0.2, 4, 0.1, 'Growth & combat'],
    ['fireChargeRange', 0, 1, 0.05, 'Growth & combat'],
    ['fireChargeAngle', 0, 0.5, 0.05, 'Growth & combat'],
    ['fireChargeTime', 0, 1, 0.05, 'Growth & combat'],
    ['fireChargeCuts', 0, 1, 0.25, 'Growth & combat'],
    ['tailBite', 0, 1, 1, 'Rules'],
    ['biteBeads', 1, 15, 1, 'Rules'],
    ['biteMult', 1, 15, 1, 'Rules'],
    ['lives', 0, 9, 1, 'Rules'],
    ['respawnDelay', 1, 10, 0.5, 'Rules'],
    ['botMoods', 0, 1, 1, 'Rules'],
    ['aggrStart', 0, 1, 0.05, 'Rules'],
    ['aggrRampMin', 1, 60, 1, 'Rules'],
    ['botAggrMax', 0, 1, 0.05, 'Rules'],
    ['perks', 0, 1, 1, 'Rules'],
    ['lengthSpeed', 0, 1.5, 0.05, 'Rules'],
    ['lengthSpeedExp', 0.2, 1.5, 0.02, 'Rules'],
    ['lengthSpeedMax', 0, 3, 0.1, 'Rules'],
    ['fireCharge', 0, 1, 1, 'Rules'],
    ['fireChargeMax', 1, 9, 1, 'Rules'],
];

const KEY = 'wyrm.tune.v2';   // v2: 5× arenas — old saved tunings don't carry over

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

// Heat helpers shared by sim and HUD.
export const thrustCap = (temp) => T.thrustBase * (1 + T.tempThrust * temp / 100);
export const speedBonus = (temp) => T.tempSpeed * temp / 100;
// Reward for growing: extra cruise/boost speed by length in metres (what
// the HUD shows). Zero for a newborn dragon, `k` at 100 m, rising on a
// curve (`exp`) and capped at `max`. Defaults: +50% at 100 m, +80% at
// 200 m, +100% from about 280 m. Callers pass the room's rule values.
export const sizeSpeed = (m, k = T.lengthSpeed, exp = T.lengthSpeedExp, max = T.lengthSpeedMax) => {
    if (!(k > 0)) return 0;
    const L0 = lengthFor(T.spawnMass), x = Math.max(0, lengthFor(m) - L0) / (100 - L0);
    return Math.min(max, k * Math.pow(x, exp));
};

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
