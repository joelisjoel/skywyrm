# Wyrm rules & switches

Each newer mechanic is a **rule**: a number in `docs/wyrm/js/tunables.js`
(group "Rules") that can be switched off (0) or retuned without a code change.

| Rule | Default | What it does |
|---|---|---|
| `tailBite` | 1 | A head touching the last `biteBeads` beads of a tail bites the tip off instead of dying |
| `biteBeads` | 5 | How many tail-tip beads are edible (they shimmer gold) |
| `biteMult` | 5 | Orbs gained per bitten bead (5 × 5 = +25) |
| `lives` | 3 | Lives per game; 0 = endless (every death ends the run) |
| `respawnDelay` | 3 | Seconds between lives |
| `botMoods` | 1 | Bot personalities (grazer / sunbather / hunter / kingslayer); 0 = classic bots |
| `aggrStart` | 0.25 | Bot aggression when a room wakes… |
| `aggrRampMin` | 15 | …rising to full over this many minutes |
| `botAggrMax` | 1 | Aggression cap (beginner rooms and solo Beginner use 0.5) |
| `perks` | 1 | Profile perks apply; 0 = everyone plays stock |
| `lengthSpeed` | 0.2 | Longer dragons fly faster: cruise and boost × (1 + 0.2·√(mass ÷ `lengthSpeedMass`)). That is about +5% at Drake, +10% at Wyvern, +15% at Elder and +20% at Ancient. 0 = off |
| `lengthSpeedMass` | 800 | Mass that earns the full length bonus |

## Where to change them

- **Solo (your browser):** press **`** (backtick) for the tuning panel → *Rules*.
  Saved in your browser only.
- **The live servers (everyone):** Cloud Run → `wyrm-server` → *Edit & deploy
  new revision* → *Variables* → `WYRM_TUNE` = JSON, e.g.
  `{"tailBite":0,"lives":5,"aggrRampMin":30}`. Takes effect on the new
  revision; roll back via *Revisions*.
- **One room:** rooms read `meta.rules` (see `wyrm-server/rooms.js`,
  `World.rule(k)` in `sim.js`). Beginner rooms already override
  `botAggrMax: 0.5`. A future "create server" option can store `rules` in the
  room's Firestore document.

Player-side toggles live in Settings → Player: Music (N), Dragon voice,
Graphics (Auto / High / Low), Beginner (start menu).
