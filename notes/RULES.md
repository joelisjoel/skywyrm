# Skywyrm rules & switches

Each newer mechanic is a **rule**: a number in `site/js/tunables.js`
(group "Rules") that can be switched off (0) or retuned without a code change.

| Rule | Default | What it does |
|---|---|---|
| `tailBite` | 1 | A head touching the last `biteBeads` beads of a tail bites the tip off instead of dying |
| `biteBeads` | 5 | How many tail-tip beads are edible (drawn as a slim gold stalk with amber feathers and a tuft) |
| `biteMult` | 5 | Orbs gained per bitten bead (5 × 5 = +25) |
| `lives` | 3 | Lives per game; 0 = endless (every death ends the run) |
| `respawnDelay` | 3 | Seconds between lives |
| `botMoods` | 1 | Bot personalities (grazer / sunbather / hunter / kingslayer); 0 = classic bots |
| `aggrStart` | 0.25 | Bot aggression when a room wakes… |
| `aggrRampMin` | 15 | …rising to full over this many minutes |
| `botAggrMax` | 1 | Aggression cap. Every room and solo play use the beginner value, 0.5 |
| `perks` | 1 | Profile perks apply; 0 = everyone plays stock |
| `lengthSpeed` | 0.5 | Longer dragons fly faster: the extra cruise and boost speed at 100 m long (×1.5), with nothing extra for a newborn. Heat adds on top. 0 = off |
| `lengthSpeedExp` | 0.62 | Shape of the length curve: bonus = `lengthSpeed` × ((length − 12 m) ÷ 88 m)^`lengthSpeedExp` |
| `lengthSpeedLate` | 1.35 | Extra bonus at full length, bending the curve up from 200 m |
| `lengthSpeedMax` | 3 | Cap on the length bonus alone |
| `speedCap` | 4 | Cap on the whole speed multiplier, heat and length together (×4); 0 = no cap |
| `powerupDrift` | 1 | m/s power-ups float about (each 0.6–1.4× this); 0 = they stay put |
| `botTreasure` | 1 | Bots go for power-ups, more goal-directed the bigger they are; 0 = off |
| `botTreasureNear` | 18 | m a hatchling bot notices a power-up from… |
| `botTreasureFar` | 150 | …rising to this from 200 m long |
| `fireCharge` | 1 | Fire crystals stack and one breath spends them all, bigger per charge; 0 = one charge (classic) |
| `fireChargeMax` | 5 | Most charges a dragon can store |
| `elements` | 1 | Ice, lightning and acid crystals join fire; the last one eaten sets your breath; 0 = only fire |
| `pearls` | 3 | Flaming pearls drifting through the sky; 0 = none |
| `pearlMass` | 30 | Mass for catching one |
| `pearlRespawn` | 8 | s until a new one appears elsewhere (±25%) |
| `pearlDrift` | 2.5 | m/s, on long curving paths |

## Where to change them

- **Solo (your browser):** open the game with `?dev=1` (or on `localhost`)
  and press **`** (backtick) for the tuning panel → *Rules*. Saved in your
  browser only.
- **The live servers (everyone):** Cloud Run → `wyrm-server` → *Edit & deploy
  new revision* → *Variables* → `WYRM_TUNE` = JSON, e.g.
  `{"tailBite":0,"lives":5,"aggrRampMin":30}`. Takes effect on the new
  revision; roll back via *Revisions*.
- **One room:** rooms read `meta.rules` (see `server/rooms.js`,
  `World.rule(k)` in `site/js/sim.js`). Every room is a beginner room and overrides
  `botAggrMax: 0.5`. A future "create server" option can store `rules` in the
  room's Firestore document.

Player-side toggles live in Settings → Player: Music (N), Dragon voice,
Mute all sound (M), Graphics (Auto / High / Low) and more.
