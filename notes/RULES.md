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
| `sunCrystals` | 1 | One breath crystal of each flavour (fire, ice, lightning, acid; only fire with `elements` 0) always in play, on top of the random ones: born at the sun with a flare, drifting out to the edge; 0 = off |
| `sunCrystalSpeed` | 4 | m/s they crawl outward (each 0.85–1.15×): about 65–90 s from the sun to the edge |
| `sunCrystalHatch` | 1.5 | s a newborn can't be caught while it clears the sun |
| `sunCrystalEdge` | 40 | m inside the walls where they fade out |
| `sunCrystalRespawn` | 4 | s until the next of a flavour is born, once one is eaten or fades (±25%) |
| `botSunGap` | 60 | m: bots leave a sun crystal alone until it has drifted this far from the sun, so they don't camp the sun |
| `girth` | 1 | Bigger dragons are fatter: body radius × (1 + `girth` × ((length − 12 m) ÷ 88 m)^`girthExp`), so ×2 at 100 m and ×3 at 300 m, newborns unchanged. Hitboxes grow with the body (a bite still costs what it did). 0 = the old thin dragons |
| `girthExp` | 0.585 | Shape of the girth curve (0.585 gives ×3 at 300 m when it's ×2 at 100 m) |
| `fight` | 0 | **Fight mode.** 1: bodies are safe to touch, and a head touching another dragon's body bites it there: everything behind breaks off. Covers `tailBite` (a tip is just part of the body). 0 = classic (every body is poisonous) |
| `biteGain` | 0.3 | Fight: share of the bitten-off mass the biter gains at once (half for a bot over 400 mass); the rest (× `lootShare`) drops as food along the broken-off part |
| `biteMinLen` | 10 | Fight: m; a bite that would leave less than this kills (the biter gets the kill) |
| `biteCooldown` | 0.4 | Fight: s between one dragon's bites |
| `biteGuard` | 1.2 | Fight: s a bitten dragon can't be bitten again (it flashes white) |
| `headonRatio` | 1.25 | Fight: head to head, a dragon this × the other's mass wins; closer in size, both bounce off |
| `headonStun` | 0.5 | Fight: s both are stunned after bouncing off |
| `poisonTime` | 10 | Fight: s of **Poison Skin**, a power-up (a violet crystal) only in fight mode: your body is poisonous (a head that touches it is out, and you get the kill) and can't be bitten. Bots treat it as a wall |

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
  `botAggrMax: 0.5`. The Create server form's **Fight mode** switch stores
  `{"fight": 1}` (or `0`) in the room's `rules`, saved in its Firestore
  document. `POST /api/rooms` accepts only that: any other rule is ignored.
- **Fight mode** (`fight`):
  - Solo: Settings → Server → Fight mode (this visit only), or the tuning panel.
  - A server: the Create server form's switch. Its lobby row shows "⚔ Fight".
    Skyhold and The Orb stay classic.
  - Every room: `WYRM_TUNE` = `{"fight":1}` would do it (Skyhold and The Orb
    too), but pages cached from before fight mode are kept out of fight
    rooms (they're asked to reload), so that would turn them away from
    every room. Wait a release, and ask Joel first: it's a Cloud Run
    setting.

Player-side toggles live in Settings → Player: Music (N), Dragon voice,
Mute all sound (M), Graphics (Auto / High / Low) and more.
