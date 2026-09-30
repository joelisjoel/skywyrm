# Wyrm prototype (PC, single-player vs bots)

Sep 29, 2026 · Built to answer one question: **is the flight and the 3D
snake loop fun on PC?** Graphics are deliberately minimal. This covers the
spec's week-1 "Fun alone" milestone (SPEC-v2 §18).

**Play:** `dendroslabs.com/wyrm/` once merged to `main`. Locally, serve
`docs/` and open `/wyrm/`.

## What's in

- **Flight model** (§6.2):
  - cruise, boost and brake speeds, with turn rates for each
  - carve lag, so turns feel carved rather than on rails
  - dive speed-up in Skyhold, plus a soft ceiling
  - auto-level in Skyhold; orientation assist in The Orb
- **Mouse-flight steering** (§7):
  - steering circle, deadzone and response curve
  - reticle plus a nose marker
  - optional pointer-lock "virtual stick"
  - arrow-key fallback
  - invert pitch
- **Tails and growth:**
  - bodies are made of beads laid along the head's path
  - mass sets length (400 m cap) and body radius
  - five growth tiers; horns appear from Drake up
- **Rules** (§6.3):
  - head on tail = death
  - head-on collisions: the smaller dragon dies
  - no self-collision
  - walls and obstacles are lethal
  - forgiving hitboxes
  - 3 s spawn protection, which can't expire while you're inside a tail
- **Orbs:** clustered ambient orbs, death loot, and orbs dropped by boosting.
- **Power-ups:** Ember Shield, Lodestone, and Dragonfire (burns an enemy tail
  in two).
- **Bots:** they fill the room to 24 dragons. They avoid walls, tails and
  heads about to cross their path. Hunters cut you off. They leave you alone
  for 45 s in your first 3 runs.
- **Readability kit** (§8):
  - chase camera, with FOV kick on boost
  - enemy tails glow and pulse when near your head
  - Elite-style radar
  - off-screen arrows
  - names over nearby dragons
  - blob shadows
  - speed dust
  - the Beacon over #1
  - walls brighten as you approach
- **Your own body** is translucent and shrinks away near the camera, so it
  never blocks the view.
- **Flow:** menu with the game running behind it → play → death-cam → run
  card → Space to play again.
- **Audio:** synthesised wind, an orb chime ladder, near-miss whoosh, and others.
- **Tuning panel** (`` ` `` key or ⚙ button):
  - a live slider for every tunable
  - measured encounter interval (§4), for all dragons and for you
  - Copy JSON, to send tunings back into the spec

## Code layout (`docs/wyrm/js/`)

| File | Role |
|---|---|
| `tunables.js` | Every gameplay number and the slider metadata |
| `sim.js` | World, flight, path/bead tails, spatial hash, collisions, orbs, power-ups. **No rendering or DOM**, so it can become the multiplayer server. |
| `bots.js` | Bot brains. They output the same input struct as a player. |
| `render.js` | three.js scene, all instanced |
| `camera.js` | Chase, death orbit, and attract (menu) cameras |
| `input.js` | Mouse-flight and keys |
| `hud.js` | Overlay, radar, leaderboard, toasts. Names go through `textContent` and `fillText` only. |
| `audio.js` | WebAudio synth |
| `tune-panel.js` | Dev sliders and stats |
| `main.js` | Loop and state machine |

Guardrail: `scripts/smoke-test.mjs` now boots `/wyrm/` headless and fails on
any page error.

## Findings so far (headless bot runs)

- **Performance:** the sim costs about 0.45 ms per step with 24 dragons and
  about 800 orbs.
- **Bots:** in 2-minute runs they die about every 35–55 s, which makes a
  lively but readable world.
- **The §4 formula underestimates encounters.** Measured: bots meet a tail
  about every **2.4 s** in the default arenas. The formula predicts about
  17 s at this ΣL (total tail length).
  - Why: orb clusters and loot pull dragons together, and that effect is far
    stronger than the random-flight assumption allows.
  - So the arenas may be *too dense* for humans, the opposite of the risk the
    spec worried about.
  - Human playtesting decides this. The levers are `population`,
    `orbTarget`, and arena radius.

## What to judge in playtests

1. **Steering:** does it feel responsive but weighty? Try `turnCruise`,
   `steerTau`, `steerExpo` and `steerCircle`.
2. **3D readability:** can you see threats before they kill you? Watch
   deaths that feel unfair.
3. **Density:** too hectic or too empty? Watch the "you" encounter interval
   in the tuning panel.
4. **Boost and brake:** do the trade-offs make sense? Do you use brake for
   tight escapes?
5. **Arena:** Skyhold with gravity versus The Orb in zero-G. Which is more
   fun, and does The Orb disorient you?
6. **Dragonfire:** fun and dramatic, or too swingy?

## Not in yet (next steps)

- touch controls
- multiplayer server
- replays and sharing
- skins
- real art
- The Grid and Warrens worlds
- spatial audio
- settings for FOV and volume
