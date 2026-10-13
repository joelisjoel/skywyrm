# Skywyrm: v3 product requirements (as built)

Oct 11, 2026 · v3 · describes commit `87d6f4c` · supersedes the v2 spec (Sep 29, kept privately outside this repo) for product decisions · how it works is in [DESIGN-v3.md](DESIGN-v3.md)

> **What this is.** v2 (Sep 29) was a plan. v3 records what was built in the
> two weeks since, the decisions that changed along the way, and what is still
> open. Every number is the live value in `site/js/tunables.js` and the code,
> not a target.
>
> **Status marks:** ✅ built · 🟡 partly built · ⬜ not built · ✖ dropped.
>
> **This repo is public,** so nothing private belongs in these notes.

---

## 1. Summary

**Skywyrm** is a free browser game. You fly a Chinese long-dragon through the
clouds and eat glowing food to grow longer and faster. Touch another dragon's
body with your head and you're out. But nip the golden tip of a tail and you
steal a mouthful. It's Slither.io moved into a 3D sky. Bots make sure the sky
is never empty, and there are online rooms anyone can join from a list. It runs
on phones and computers with no install, no account and no tracking.

**Play:** https://skywyrm.io · **Code:** `joelisjoel/skywyrm`

### What changed since v2

| Area | v2 plan | v3 as built |
|---|---|---|
| Identity | "Neon wyrms" made of beads | Chinese long-dragons. Bodies are continuous and scaled. Heads grow antlers, a mane, a crown and a pearl as you grow. Ink-and-gold menus, Mandarin battle shouts |
| Who it's for | io and portal players, ads, a revenue stretch goal | Built for Joel's kids and their friends first: no ads, accounts, chat or analytics |
| Difficulty | One ruleset, walls kill | **Beginner only.** A wall-steering assist is always on and bots are capped at half aggression |
| Death | Instant respawn | **3 lives** per game, 3 s between lives, then a game-over card |
| Rules | Mass, boost, three power-ups | Adds **body heat**, a **thrust tank**, a **length speed bonus**, **tail nibbling**, ranks and perks, bot moods |
| Worlds | Small 70 m arenas with a castle and obstacles | Large open worlds: Skyhold (350 m) and The Orb (325 m), with no obstacles |
| Sharing | Highlights, replay links, share cards | **Invite links** to a server (§8), and link previews: a shared skywyrm.io link shows a dragon picture, the title and a blurb (Open Graph and Twitter cards). The headline is "Hatch small. Grow huge. Rule the sky.", picked from ten lines scored by a kid, a parent and a web-game player. Highlights, replays and share cards aren't built; big moments show as toasts and voice lines |
| Stack | TypeScript/Vite/Vue, a VM, Firebase, binary netcode | Plain ES modules with no build step. Cloud Run, JSON over WebSocket |
| Home | dendroslabs.com/wyrm | skywyrm.io, in its own repo. The old dendroslabs.com/wyrm page has been removed |

---

## 2. Audience, goals and non-goals

**Audience.**
- First: Joel's kids and their friends, on phones and laptops.
- Then: anyone who gets the link. Players may be under 13, so every decision
  assumes a child is playing.

**Goals**

| # | Goal | How we'll know | Now |
|---|---|---|---|
| 1 | It's fun for the kids | They come back to it on their own, ask for features and play online together | ✅ |
| 2 | Push AI-assisted building end to end and ship to production | Live on its own domain, with small PRs, CI and auto-deploys | ✅ skywyrm.io; site and server deploy from `main` |
| 3 | A small, genuine player base (stretch) | Anonymous daily totals at `/api/stats`: lives played, time flown, peak players online, and visits: how many, roughly where from, whether devices come back and how far they get (§11). Nobody is tracked | ⬜ not pursued yet; the numbers are now counted |

**Non-goals.**
- Accounts or passwords.
- Chat of any kind.
- Analytics or tracking of players. Only anonymous daily play and visit totals are counted (§11).
- Ads, or purchases of any kind.
- Native apps.
- A realistic flight sim.
- Anti-cheat good enough for competitive play.

v2's revenue goal and its portal launches (CrazyGames, Poki) are **dropped**
while the kid-safety rules stand. Reopening them is a decision for Joel (§14).

---

## 3. Design pillars

1. **Instant.** A link takes you to flying in seconds, with no login. Between
   lives the respawn takes 3 s.
2. **Readable.** Every threat is visible before it can kill you: the radar,
   off-screen arrows, tails that glow when close, and a wall warning.
3. **Tense.** Growing makes you faster and makes you a target. The leader's head
   blazes, and "kingslayer" bots hunt it.
4. **Grows cooler** (new). Each size tier visibly upgrades your dragon, and length
   also adds speed. Getting longer must always feel like a reward.
5. **Kid-safe** (new, replaces v2's "Shareable", which is deferred). There is
   nothing for a parent to worry about: no chat, no accounts, no tracking,
   filtered names and forgiving rules.

---

## 4. Player experience

**First minute**
1. skywyrm.io opens on the menu. Behind it, a live sky of bots plays as an
   attract mode.
2. Your name is pre-filled with a random dragon name, for example "Ember Drake".
3. Choose **Play solo** (Skyhold or The Orb) or pick a server from the list.
4. You spawn 12 m long and are ghosted (protected) for 3 s.
5. During your first 3 runs:
   - hint toasts teach the controls, tail danger and heat
   - nearby bots leave you alone for 45 s

**Core loop.**
- Eat → grow → get faster and cooler-looking.
- Hunt: head-on, nibble a tail tip, or burn with dragonfire.
- Die → respawn. You have 3 lives.
- Game-over card → jade → rank up → unlock perks and colours → play again.

**Lives and game over** ✅
- Between lives: a 3 s countdown while the death cam circles the crash and looks
  at whoever got you.
- After the last life, the run card shows:
  - peak length
  - kills
  - time alive
  - best rank
  - jade earned
- Space starts the next game.
- **Leave to menu** (pause, solo) ends the game the same way: that life's jade
  is banked and the run card shows.

---

## 5. Rules (as built)

### 5.1 Dragon and growth ✅
- **Mass drives everything.**
  - Length = 8 m + 0.4 m per unit of mass, capped at 400 m (reached at mass 980).
  - **Bigger dragons are fatter** (rule `girth`): about twice as thick at
    100 m as before and three times at 300 m, so a big dragon looks
    mighty instead of like a thread. The radius is 0.6 m at spawn (as
    before), 1.5 m at 100 m, 3.3 m at 300 m and 4.4 m at full length, and
    keeps growing a little with mass after that (6.8 m by mass 2000). The
    hitbox grows with it, and the camera backs off and rises to keep a fat
    dragon in view.
- You spawn at mass 10, which is 12 m long.
- **Tiers** change only how the dragon looks and the bragging. They have no
  gameplay effect (§10.2).

| Tier | From mass | ≈ length |
|---|---|---|
| Hatchling | 0 | 12 m at spawn |
| Drake | 60 | 32 m |
| Wyvern | 200 | 88 m |
| Elder | 450 | 188 m |
| Ancient | 800 | 328 m |

### 5.2 Flight ✅
- **Speeds:** cruise 16 m/s, boost 26 m/s, brake 10 m/s.
- **Turn rates:** 150°/s cruising, 95°/s boosting, 230°/s braking. Big dragons
  turn up to 30% slower.
- **Skyhold (gravity):**
  - The dragon levels itself out.
  - Diving adds up to +6 m/s.
- **The Orb (zero-G):** an optional assist slowly rolls "up" toward the centre.

### 5.3 Speed bonus from heat and length ✅
Speed multiplier = 1 + **heat bonus** + **length bonus**, capped at **×4**.

- **Heat bonus:** up to +0.4×, at 100°.
- **Length bonus:**
  - +0.5× at 100 m
  - +0.8× at 200 m
  - then it climbs faster: +1.5× at 300 m and +2.6× at 400 m (full length)
- **Cap:** a full-length dragon at full heat reaches ×4: 64 m/s cruising and
  104 m/s boosting. It's a per-room rule (`speedCap`).
- **Heat** comes from the sun at the centre of each world and from crowds of
  dragons nearby. It rises quickly (τ 3 s) and fades slowly (τ 7 s). Heat also
  enlarges the thrust tank.
- The HUD shows the capped total, for example `DRAKE · 1.5× SPEED`.
- The bonus applies to cruise and boost, not brake.
- Above ×2 the camera widens a little (+8° at ×4) and follows more tightly,
  so a fast dragon doesn't pull away from it.

### 5.4 Boost and thrust ✅
- **Mass cost:** boosting burns 4 mass/s, and half of that drops behind you as
  food. You can't boost below mass 15.
- **Thrust tank:**
  - Holds 10 s of boost. It is bigger when you're hot and with the Deep Lungs
    perk.
  - Refills at 0.4 s per second while you're not boosting.
  - If you run it dry, boost locks until 1.5 s has refilled.

### 5.5 Collisions and death ✅
- **Head into another dragon's body** (anywhere but the golden tip): you're out
  ("Poisoned by X").
- **Head-on:** the heavier dragon wins if it's more than 5% heavier; otherwise
  both die.
- **Walls and the cloud sea are lethal.** The wall assist steers you clear, and
  "⚠ WALL" warns you from 14 m away.
- There is no self-collision.
- **On death:** 80% of your mass drops as food, which lasts 45 s.
- **Spawn protection:** 3 s, extended while you're still inside someone's body.
- **Fight mode** (§5.11) turns this around for a solo game or a server that
  chooses it: bodies are safe to touch and you bite them instead.

### 5.6 Tail nibbling ✅
- The last 5 beads of every tail are the **edible tip**: a slender stalk
  that shimmers gold, with amber-gold feathers along it and a feather tuft
  at the end, so you can spot it across the sky. Only the look is slim: the
  tip is as easy to bite as before.
- Hitting them is a **bite**, not a death:
  - you gain **+25 mass** (5 beads × 5)
  - they lose about one tip's worth
- There is a 0.5 s cooldown between bites.

- In fight mode (§5.11) the tip is just part of the body: no gold tip, and
  a bite anywhere breaks off what's behind it.

### 5.7 Food ✅
- **Ambient food:** about 2,000 orbs worth 1 each. 60% come in clusters, and they
  are denser near the centre.
- **Loot** from deaths, boosting and burned tails lasts 45 s.
- **Flaming pearls** (rule `pearls`): 3 glowing pearls drift slowly (about
  2.5 m/s) through the sky on long, curving paths. Catching one is worth
  **+30 mass**, with a bell chime, a "FLAMING PEARL" toast and a burst of
  sparks. A new one appears somewhere else about 8 s later. They show on the
  radar, pinned to its rim when far away.

### 5.8 Power-ups ✅

Crystals appear about every 20 s, with up to 5 in the sky at once. Half of
them are breath crystals: fire, or (rule `elements`) half the time ice,
lightning or acid.
They float about slowly (about 1 m/s, bobbing as they go), staying near the
action and clear of the walls, the cloud sea and the sun.

**Sun crystals** (rule `sunCrystals`) ✅
- On top of those, one breath crystal of each flavour is always in play:
  fire, ice, lightning and acid (only fire with `elements` off).
- Each is **born at the sun**: a ring of its colour bursts out of the sun
  with a spray of sparks and a soft chime (within about 220 m). It can't be
  caught for its first 1.5 s while it clears the sun.
- It then crawls outward at about 4 m/s on a gently wandering path that
  never turns back, in Skyhold staying in the sky 50 m or more above the
  cloud sea. Unchased it reaches the edge in about 65–90 s and fades out
  40 m inside the walls.
- Eaten or faded, the next of its flavour is born at the sun 3–5 s later.
- An ink ring (a rim of its colour inside a dark band) marks it from
  mid-range and far off, so it still reads in the sun's glare. It leaves a
  trail of sparks, and the radar gives it a gold ring.
- Bots leave a sun crystal alone until it has drifted 60 m from the sun
  (`botSunGap`), so they catch them on the way out instead of camping the
  sun. Body heat is only a reward (§5.3), so nothing else would stop them:
  without the gap 25 bots keep about 9 dragons within 50 m of the sun
  instead of 2–4.
- **How much more offence:** the random crystals give a room about 1.5
  breath crystals a minute (a spawn every 15–25 s while fewer than 5 are
  out; half are breath crystals: fire 25%, ice, lightning and acid about 8%
  each). With 25 bots, about 11–14 sun crystals are eaten a minute, mostly
  60–80 m from the sun: roughly eight times the breath crystals of before.

| Crystal | Effect |
|---|---|
| **Ember Shield** (orange) | Lasts 12 s and survives one body hit. It does *not* stop head-ons, walls or any breath |
| **Lodestone** (blue) | Lasts 10 s and pulls food within 18 m with tractor beams |
| **Dragonfire** (red) | A breath (1.2 s, a 24 m, 30° cone for one crystal) that burns through the nearest tail and cuts it off there. 80% of the lost part drops as food. It never kills. Red crystals stack (below). Bots use it too |
| **Frost** (ice-blue shard) | The same cone, in frost. Every dragon it touches is chilled for 2.5 s: half speed, no boost, turns 40% slower |
| **Lightning** (violet star) | A long, narrow bolt (36 m) strikes the first dragon in line and jumps to the nearest one within 14 m. Each is stunned for 0.6 s (it can't steer and flies straight) and sheds 4% of its mass as food |
| **Acid** (green bubble) | Spits a cloud (6 m radius) ahead that hangs for 6 s. Any other dragon with its body in it melts 4 mass a second into food while it stays inside. Your own acid never hurts you |

**Stacking dragonfire** (rule `fireCharge`) ✅
- Each red crystal adds one charge, up to 5 (`fireChargeMax`). Pressing fire
  lets out one breath that spends every charge you hold.
- The more charges, the bigger the breath:

| Charges | Range | Cone (half-angle) | Breath | Tails it can cut |
|---|---|---|---|---|
| 1 | 24 m | 30° | 1.2 s | 1 |
| 2 | 30 m | 34.5° | 1.5 s | 1 |
| 3 | 36 m | 39° | 1.8 s | 2 |
| 4 | 42 m | 43.5° | 2.1 s | 2 |
| 5 | 48 m | 48° | 2.4 s | 3 |

- A breath cuts each tail at most once. After its last cut the flame dies down.
- The fire gauge's ring is cut into one arc per charge slot, lit for each
  charge held, and the gauge grows and glows brighter as they stack. On
  phones the fire button shows the count.
- Bots: hunters, kingslayers, big bots (mass over 150) and fierce ones save
  up 2–4 charges before they attack. The rest breathe as soon as they hold
  one, and a full stack is always used.
- With the rule off, crystals don't stack and every breath is the one-charge
  breath.

**Breath elements** (rule `elements`) ✅
- Ice, lightning and acid charges are the same charges as fire. The last
  crystal you eat decides what they breathe; the fire gauge and the phone fire
  button take its icon and colour.
- Every element grows with the charges spent, like dragonfire. At 5 charges:
  frost chills for 5 s; lightning reaches 72 m, jumps up to 3 times, stuns for
  1.2 s and sheds 8%; acid clouds have a 12 m radius, last 12 s and melt 8
  mass a second.
- **Kid-safe by design.** Nothing here kills on its own:
  - a stunned dragon can't die on a body it's carried into, and the wall
    assist steers anyone stunned clear of walls
  - acid stops at the spawn size
  - spawn protection blocks every breath
  - the Ember Shield blocks none of them, the same as dragonfire (§14)
- **Readable:** toasts ("FROZEN by …", "ZAPPED …", "ACID! Fly out of the
  cloud"), feed lines, and a one-line hint the first time you hold each
  element. Chilled dragons turn frost-white and shed snow; stunned ones
  flicker violet and crackle. Your own chill and stun show as gauges, and
  acid clouds show on the radar as green rings.
- **Bots** use ice and lightning on their prey, on bigger dragons and on
  dragons coming at them. They spit acid where a dragon is about to fly, or
  at one close on their tail, and steer around other dragons' acid.
- **Online** the server decides every hit. Your browser applies a chill or
  stun to your own flight at once, and the server enforces it too (a slower
  speed budget while chilled, no turning while stunned) after a 0.25 s grace.
- With the rule off, only fire crystals spawn and every crystal breathes fire.

### 5.9 Bots ✅
- **Numbers:** 3 at the start, then one more every 20 s, up to 30. Online, the
  cap is 30 minus the number of humans in the room.
- **Four moods:**

| Mood | Behaviour |
|---|---|
| Grazer | Feeds at the edges and flees big dragons |
| Sunbather | Stays near the warm centre |
| Hunter | Stalks smaller dragons and tail tips |
| Kingslayer | Goes after #1 |

- **Aggression** rises the longer a room has been busy. It is capped at half
  (beginner rules) and reaches that cap after about 5 minutes.
- **Power-ups and pearls:** bots go for crystals, and the bigger they are
  the more goal-directed: a hatchling only grabs one within about 18 m and
  wanders off easily; a 200 m dragon spots one up to 150 m away and flies
  straight for it. They want pearls most (2.5× as much, from 30% farther).
  In beginner rooms a bot leaves a crystal or pearl to a player who is
  nearly as close. Sun crystals are left alone until they are 60 m from the
  sun (§5.8).

### 5.10 Leaderboard and big moments 🟡
- **Leaderboard:** the top 10 by mass, showing length.
- **The #1 dragon:** its head blazes like a beacon, and a crown marks it on the radar.
- **Toasts and voice lines** for:
  - CHOMP
  - near miss
  - tier up
  - you are #1
  - kill, big kill, KINGSLAYER
  - severed
  - shield saved you
- ⬜ Not built: highlights you can share, replays, a share card.

### 5.11 Fight mode (rule `fight`, off by default) ✅
Classic rules punish getting close: every body is poisonous, so the safe
play is to keep away. Fight mode flips that, as a switch so both can be
played and compared (§14, decision 9).
- **Bite anywhere.** Your head on another dragon's body bites it there, and
  everything behind the bite breaks off. You gain 30% of what broke off at
  once; the rest falls as food along the broken part, for anyone. The
  bitten dragon keeps the front part and flies on, unless less than 10 m
  would be left: then it's "bitten in two", it dies as usual and you get
  the kill.
- **Bodies are safe to touch.** Your head can't die on a body any more
  (walls and the cloud sea still kill, and your own body is still
  harmless).
- **No shredding.** After a bite you wait 0.4 s before the next one, and a
  dragon that was just bitten can't be bitten again for 1.2 s (it flashes
  white meanwhile).
- **Head to head:** a dragon a quarter heavier than the other (×1.25) wins
  and the smaller dies. Closer in size, both bounce off and are stunned for
  half a second, and nobody dies.
- **Unchanged:** spawn protection (a newborn can't bite or be bitten), and
  the Ember Shield, which takes one bite (it pops and nothing breaks off).
  It still doesn't stop head-ons.
- **Feel:** a chomp and a burst where the bite lands, the broken part
  crumbling into gold motes, the jaws snapping, "CHOMP +29" for you and
  "Bitten! −42 m" when it's you. The kill feed shows kills only, not every
  bite.
- **Bots** dodge bigger heads coming at their head or body. Hunters and
  kingslayers go for bodies they can bite safely: never near the head of a
  dragon that would beat them head to head. The bigger the bot, the farther
  it looks and the straighter it flies. Bots that aren't hunting still
  steer round bodies, so they don't bite everyone they pass.
- **Where:** Settings → Server → Fight mode for solo (until you reload), and
  a Fight mode switch when you create a server. Fight servers show a
  "⚔ Fight" chip in the lobby. Skyhold and The Orb stay classic.
- **How it plays** (25 bots, seeded, 6 minutes × 3 seeds per world): see
  §14, decision 9.

---

## 6. Progression ✅

All progression is stored in the browser only. It doesn't follow you to another
device.

- **Jade** is earned per life: peak length (m) + 40 per kill + 10 per bite + 1 per
  6 s alive. There is a bonus of 60 if you reached #1, or 25 for #2–3.
- **10 ranks.** Each one has a seal character:

| Rank | Jade | Rank | Jade |
|---|---|---|---|
| 1 Pebble 石 | 0 | 6 River 江 | 7,000 |
| 2 Jade 玉 | 300 | 7 Mountain 山 | 11,000 |
| 3 Pearl 珠 | 900 | 8 Sun 日 | 16,000 |
| 4 Cloud 云 | 2,000 | 9 Heaven 天 | 23,000 |
| 5 Storm 雷 | 4,000 | 10 Sky Lord 龙 | 32,000 |

- **Perks.** You get 1 slot from rank 2 and 2 slots from rank 6.

| Perk | Unlocks at | Effect |
|---|---|---|
| Deep Lungs 气 | rank 2 | thrust tank ×1.2 |
| Keen Pull 引 | rank 3 | pick up food from 40% farther (base radius) |
| Thick Scales 鳞 | rank 5 | 6 s shield at the start of each life |
| Ember Heart 焰 | rank 7 | a dragonfire charge at the start of each life |

- **Colours:** 7 schemes, unlocked by rank:

| Colour | Rank |
|---|---|
| Ember | 1 |
| Jade | 2 |
| Azure | 3 |
| Crimson | 4 |
| Obsidian | 6 |
| Pearl | 8 |
| Imperial | 10 |

- **Bloodline:** every dragon is *scaled*, *feathered* or *armoured*, picked from
  its id. A dragon keeps the same bloodline for its whole life.

---

## 7. Worlds ✅

| World | Physics | Size | Look |
|---|---|---|---|
| **Skyhold** | gravity, open top | cylinder, radius 350 m | Golden hour: a cloud sea, karst pillars with pines, ink-wash ridges, and a glowing storm wall at the edge |
| **The Orb** | zero-G | sphere, radius 325 m | A nebula, stars, and a glass shell with gold lines |

- Both worlds have a heat sun at the centre.
- ⬜ v2's The Grid and The Warrens were not built.

---

## 8. Online play ✅

- **Lobby.**
  - Two always-on servers, Skyhold and The Orb.
  - Any rooms players have created.
  - Each row shows the number of humans and bots, and the list refreshes every 10 s
    while it's on screen.
- **Create a server:** it gets a generated name such as "Jade Peak" (🎲
  picks another), and you pick a world. Names aren't typed, so nothing a
  player writes is shown in everyone's lobby.
  - A **Fight mode** switch makes it a fight server (§5.11). Its lobby row
    shows a "⚔ Fight" chip. A page cached from before fight mode can't
    join one: it is told "This server plays Fight mode. Reload the page to
    update Skywyrm, then join." 
  - Created servers disappear 12 h after the last player leaves.
  - At most 30 created servers can exist at once.
  - Each network can create 3 per hour.
- **Capacity:** up to 30 humans per room, with bots filling the rest. Every room
  uses beginner rules.
- **Pause online means "fold your wings":**
  1. A 3 s countdown, during which you can still be hit.
  2. You leave the sky with your length kept.
  3. You can fly back in after 2 s.
- **Switching away** (another tab, or locking the phone) folds your wings the
  same way, and solo pauses. Coming back shows the pause screen; tap Resume.
- **If the server is down:** the lobby says "servers offline — play solo". Solo
  always works.
- **If the connection drops** (Cloud Run's 60-minute cut, a deploy, a phone
  asleep, a network blip), the game says "Reconnecting…" and gets you back
  into the same room:
  1. Back within 3 s, your dragon never left the sky.
  2. Within 30 s more, it flies back in with its length and kills (or stays
     folded, if you had paused).
  3. After a server restart, or later than that, you start a new life, and a
     toast says so. That life's jade is still banked.
  4. After 30 s of trying, you're back at the menu.
- **No dodging:** a dragon whose player disconnects or leaves stays in the sky
  for 3 s, still hittable, like folding your wings.
- **Leaving a room** banks that life's jade, as a death would.
- **Invite a friend** ✅:
  - In a room, the pause panel has **Invite a friend**, and every server
    row in the lobby has a 🔗. Either makes a link to that server:
    `https://skywyrm.io/?room=<id>&src=invite`.
  - On a phone it opens the share sheet, with fixed words: "Fly with me in
    Skywyrm — server Jade Peak" (a generated server name, never a player's
    name). Elsewhere it copies the link and says "Invite link copied". If
    neither works, the link shows in a small field to copy by hand.
  - Opening the link shows the menu with that server pinned at the top of
    the list, lit up, under "You're invited", with a larger Join button.
    Nobody joins without tapping Join, so kids see where they're going. If
    the server has closed, the game says "That server has closed — pick
    another" and shows the usual list.
  - The game takes `room` and `src` out of the address bar, so copying the
    address afterwards doesn't pass them on. A visit that sent an invite is
    counted in the visit totals (`invited`, §11).

---

## 9. Controls and settings ✅

| Action | PC | Phone |
|---|---|---|
| Steer | Mouse offset from the screen centre (or arrow keys at 70%) | Put a finger on the sky. The dragon turns toward it; lift to fly straight |
| Boost | Left mouse button, W or Space | Second finger, or the Boost button |
| Brake | Right mouse button or S | Brake button |
| Dragonfire | E or F | Fire button |
| Roll | A or D | none |
| Look back | C | none |
| Pause | Esc or P | Pause button |
| Mute | M, or the speaker button (top left) | Speaker button (top left, beside pause) |
| Music on / off | N | in Settings |

**Settings** (saved in the browser):

| Setting | Default |
|---|---|
| Wide view (fisheye edges, 122° corners) | on (off on phones and tablets) |
| Rear-view mirror | on |
| Invert pitch (arrow keys only) | off |
| Lock mouse | off |
| Mouse sensitivity (computers only, 0.4–1.6) | 1.0 |
| Zero-G orientation assist | on |
| Reduce motion | off |
| Mute | off |
| Music | on |
| Dragon voice | on |
| Graphics | Auto |

- **Settings → Server** holds the room rules for solo games, until you
  reload: starting dragons, max dragons, a new dragon every N s, and
  **Fight mode** (§5.11). Online it shows the room's values, read-only.
- **Graphics** can be Auto, High or Low. Auto drops to Low if the game runs below
  40 fps (or well below a slower screen's own rate, such as 30 Hz in Low Power
  Mode), and remembers that until you change the setting.
- The beginner switch was removed. Beginner is always on.
- **Mouse steering** is gentle, so it's hard to oversteer. The further the
  cursor is from the centre, the harder you turn: half way to the edge of
  the steering circle is about a quarter of the full turn rate, and the edge
  (36% of the screen's shorter side from the centre) is the full turn. A
  little smoothing keeps a wobbly hand from twitching the dragon, but a
  quick swing goes straight through. **Mouse sensitivity** scales the
  middle of that range: at 0.4 half way out turns at about 10%, at 1.6 at
  about 40%, and the edge is a full turn at every setting. Lock mouse uses
  the same circle and curve. Touch and the arrow keys steer as before and
  ignore it.

---

## 10. Look and sound ✅

### 10.1 Identity
- Chinese long-dragons, inspired by *Black Myth: Wukong* within what a browser
  can do.
- Ink-and-gold menus: a red 龍 seal, the title in Cinzel, and the calligraphy
  couplets 騰雲駕霧 / 翻江倒海.
- Golden-hour lighting with bloom.

### 10.2 Your dragon gets cooler as it grows

| Tier | Head | Body |
|---|---|---|
| Hatchling | horn buds, whiskers | scales and dorsal fins |
| Drake | deer antlers | front legs with claws (feathered dragons also get plumes) |
| Wyvern | mane and beard | back legs, plumes along the spine |
| Elder | gold crown and antlers, glowing eyes | gilded scale edges |
| Ancient | a flaming pearl floats ahead | qi light flowing down the body |

Bodies also thicken as they grow (§5.1, rule `girth`), and the head,
legs, fins and feathers grow with them.

**Animation:**
- Whiskers lengthen with each tier.
- The jaw opens wide (about 70°, with the snout tipping up) to eat or
  breathe fire, and snaps shut on each bite, so grazing reads as chomping.
- The head looks into turns.
- The body swims in an S-wave.

### 10.3 HUD
- **Bottom-left:** length, kills, lives (pearls), tier with speed, and gauges
  for heat, thrust and fire (with a lit arc per stored charge, in the colour
  of its element). Shield, magnet, chilled and stunned gauges appear only
  while active; on phones they stack above the others, clear of the radar.
- **Radar** at the bottom centre, with a 60 m range. It shows above and below,
  power-ups (sun crystals with a gold ring), acid clouds, pearls, the centre and the leader. On an upright
  phone it sits above the stats, bottom left.
- Stats text has a soft shadow so it reads on bright cloud. Touch screens hide
  keyboard and mouse hints (the fire gauge's `E`, key names in Controls and
  Settings) and the keyboard and mouse settings.
- **Top:** the speaker (mute) button at the left, the leaderboard and the
  kill feed. The leaderboard and feed are lists, not messages, so they stay
  up there.
- **Messages, all in one spot just below the centre:** toasts, tips, the
  dragon's voice caption and the status lines ("⚠ WALL", "🛟 steering you
  clear", "Reconnecting…") share one compact, see-through stack, newest on
  top, so a new message always lands in the same place. It starts clear of
  the reticle and ends above the radar (on phones, above the radar and the
  buttons). When it's full, tips give way first, then voice captions; the
  newest message always shows. The respawn countdown ends at the centre, so
  the death line shows below it.
- **Long enough to read:** a toast stays fully up for about 2.2 s and is
  gone at 2.6 s, a tip 3.5 s (gone at 4.2 s), and a voice caption 3.2 s or
  until 1 s after the dragon finishes speaking, whichever is later. The
  first-flight tips come one at a time, each as the last one fades.
- **Over the world:**
  - names over dragons within 50 m
  - arrows to dragons off screen within 30 m

### 10.4 Sound
- **Effects:** all synthesised live, with no sound files. Soft, gusty wind
  (low and soothing, no hiss) that swells into a whoosh when you boost, turn
  hard or dive, a rising chime for eating, whooshes, power-up sounds, a bell run for a pearl, a soft three-note chime when a sun crystal is born nearby, and a sound for each breath (fire,
  frost, lightning, acid) and for being frozen, zapped or caught in acid. The
  new elements have no voice lines.
- **Music:** an original Chinese-flavoured score, composed live in pentatonic
  modes and played by synthesised guzheng, dizi and xiao flutes, erhu, sheng,
  ruan, drums, cymbals and gongs. It is written a phrase at a time from a
  theme that keeps developing and changing, so it rarely repeats itself. It
  has three intensity levels (menu, flying, action at 80, 108 and 120 BPM),
  and it muffles when paused. It sits under the effects and the voice.
- **Background:** all sound stops while the tab is hidden and comes back
  when you return.
- **Mute:** a speaker button at the top left of every screen (and M on a
  keyboard) turns all sound off or on at once, with a brief "Sound off / Sound
  on" label. It matches Settings → Mute all sound and is remembered on this
  device.
- **Voice:** 24 recorded Mandarin battle shouts, delivered like a ring
  announcer (bright, quick and emphatic, so the words are easy to make out),
  with characters, pinyin and English captions on screen. Only your own dragon's events trigger them:

| Event | Example |
|---|---|
| Shield | 金钟罩！ *jīn zhōng zhào*, "Golden Bell Shield!" |
| Lodestone | 吸星大法！ *xī xīng dà fǎ*, "The star-drinking art!" |
| Dragonfire | 火龙出世！ *huǒ lóng chū shì*, "The fire dragon awakens!" |
| Tier up | 更上一层楼！ *gèng shàng yì céng lóu*, "Higher still!" |
| Sever a tail | 一刀两断！ *yì dāo liǎng duàn*, "Cut in two with one stroke!" |
| Kill | 手下败将！ *shǒu xià bài jiàng*, "Another fallen foe!" |
| Reach #1 | 天下无敌！ *tiān xià wú dí*, "Invincible under heaven!" |
| Death | 卷土重来！ *juǎn tǔ chóng lái*, "I will return like a storm!" |

---

## 11. Safety and privacy ✅

- **Nothing personal is collected:**
  - no accounts, chat, ads or cookies
  - no analytics companies or tracking code, and no player or device ids
- Progress lives in the browser's local storage.
- **Anonymous play totals** ✅ (approved by Joel, so the game can be improved
  with real numbers):
  - Online, the server counts each human life as it ends in a room (death,
    leaving or a dropped connection).
  - Solo, the browser sends one note when each life ends: the world, peak
    length, seconds flown, kills and how it ended. No id, no cookie, no name.
  - The server adds these into totals per UTC day, with solo and online kept
    apart, plus the peak number of players online and rooms created. It keeps
    30 days.
  - The totals are public at `<server>/api/stats`.
  - The server uses IP addresses only in memory, to rate-limit, and doesn't
    store or log them.
- **Anonymous visit totals** ✅ (approved by Joel, to see whether the game
  is growing: how many come, from where, whether they come back, and where
  they stop):
  - Each page visit sends one note when it ends (the tab is first hidden or
    closed), worked out on the device: where it came from as a category
    (direct, search, social, video, games, other; the referrer itself is
    never sent), a link tag if it is one of a fixed list (`?src=qr`,
    `invite`, …; taken out of the address bar), how long since this device
    first came as a bucket (new, today, 1 day, 2–6, 7, 8–29, 30+; the dates
    stay in the browser), whether it's the device's first visit today, touch
    or mouse, the furthest step reached (menu, play, a life finished, played
    again, online), lives finished, seconds played, and whether an invite
    was sent. No id, no cookie, no name.
  - The server adds each answer to its own daily count (visits, devices,
    sources, tags, return buckets, touch or mouse, the funnel, a play-time
    histogram, lives, invites), so one visit's answers can't be put back
    together. Same 30 days, same public `/api/stats`.
- Nothing beyond these totals is collected.
- **Server names aren't typed.** They're picked from lists of kid-friendly
  sky and landscape words ("Jade Peak", "Misty Falls"), so the lobby every
  player sees never shows what someone wrote.
- **Player names are filtered on both the browser and the server.** The filter:
  - allows only the letters A–Z, numbers and simple punctuation. Accents
    are dropped (José becomes Jose); other alphabets are refused with a
    reason, so look-alike letters can't hide a bad word
  - blocks links and e-mail addresses
  - blocks bad words, including leetspeak, spaced-out and stretched
    spellings, without blocking innocent words that contain them (SkyStorm,
    Grape, Peacock)
  - blocks reserved words such as "admin" and "skywyrm" as whole words
  - a bad player name becomes "Dragon" on the server
  - always displays names as plain text, never as code
- **Third parties a player's browser talks to:** none besides the game
  server. three.js and the fonts are served from skywyrm.io itself, and the
  page's Content-Security-Policy blocks anything else.
- The game server's own logs record created room names, but not player names
  or IP addresses. Google Cloud's standard request logs do record IP
  addresses, and keep them for 30 days by default.
- ✅ **Privacy page** (`skywyrm.io/privacy.html`, linked from the menu): plain
  words for kids and parents covering what is counted (play and visit
  notes), what stays on the device, IP addresses, who hosts what, and where
  grown-ups can ask (the repo's issues).

---

## 12. Platforms and performance 🟡

- **Desktop:** Chrome, Safari, Firefox.
- **Mobile:** iPhone and Android browsers.
  - The touch UI turns on automatically.
  - Below 640 px wide, the leaderboard shrinks to the top 5 and the mirror hides.
  - On its side (under 500 px tall) the leaderboard also shrinks to the top 5,
    the radar is smaller, and the menu has two columns with Play solo on top.
  - Menus and the run card hide the leaderboard and kill feed on phones. A menu
    that is taller than the screen scrolls and shows "more ▾".
  - The page fills the screen past notches (`viewport-fit=cover`) and keeps the
    HUD, buttons and menus inside the safe area.
- **Graphics:**
  - High: up to 2× pixel density, bloom, and full-rate wide view.
  - Low: 1× pixel density, no bloom, no wide view, and the mirror updated every
    other frame.
  - Auto starts on High and drops to Low once if the frame rate falls below 40 fps
    (or ¾ of a slower screen's rate), and remembers the drop.
  - Wide view starts off on touch devices: it draws the scene six more times a
    frame.
- ⬜ There are no measured load-time or frame-rate targets yet, and no device
  test matrix.

---

## 13. Backlog

### 13.1 From v2, not built
- **Sharing:**
  - highlight clips
  - replay links
  - share card
- **Run card:** "Share", "Watch replay" and "Change dragon" buttons.
- **Settings:**
  - deadzone and FOV sliders
  - colour-blind stripes
  - volume sliders
  - ping display
- **Audio:** spatial (3D) audio.
- **Worlds:** The Grid and The Warrens.
- **Persistent boards:** daily and all-time.
- **Input:** emotes and gamepad.

### 13.2 Issues found while writing v3
These are listed roughly by how much a player would notice.

1. ✅ **Reconnect** (was: no reconnect after the 60-minute Cloud Run cut).
   Fixed: the game reconnects and keeps your dragon (§8).
2. **Dragonfire takes too much from very long dragons.** Above the 400 m length
   cap, burning just the tip removes far more than the tip. A 1,500-mass dragon
   can lose about 540 mass.
3. ✅ **Fixed:** quitting a solo life from the pause menu now banks its jade
   and shows the run card.
4. ✅ **Fixed:** the dev tuning panel, its ⚙ button and the FPS counter show
   only with `?dev=1` or on localhost, and can't change a room. Settings opens
   on the Player tab; the Server tab is for solo and read-only online.
5. ✅ **Fixed:** all 10 rank seals render in the brush font (the self-hosted
   subset covers every Chinese character the site uses). The body font Nunito
   is still never loaded.
6. **The shield is narrower than it looks.** It doesn't stop head-ons, walls or
   any breath (fire, ice, lightning or acid).
7. Saved profile stats (best length, best kills, games played) are never shown.
8. **Room-creation abuse:** one network could fill all 30 server slots in about
   10 hours. A school or home network is limited to 16 players (it was 6;
   `MAX_CONN_PER_IP` on the server can raise it).

---

## 14. Decisions for Joel

Each decision has a recommended default, so work can start on that default.

1. ✅ **Reconnect after 60 minutes.** Built as recommended: an automatic rejoin
   of the same room that keeps your length (§8). It took a server change
   too: the server holds a dropped player's dragon for 30 s.
2. **Sharing.** Invite links to a server are built (§8): they carry only the
   room's id, never a player. For more, recommend a kid-safe screenshot card
   (a picture only, with no link back to the player) before replays. Or stop
   at invites.
3. **Portals, ads and revenue.** Recommend staying out while the game is
   kid-first. Ads would require consent tooling and a COPPA review.
4. **Privacy page.** ✅ Done, together with the anonymous play totals (§11).
5. **Dev tools in production.** Recommend hiding the ⚙ tuning panel and FPS
   counter unless `?dev=1` is in the URL. ✅ Done (localhost pages count too).
6. **Hardcore mode.** Beginner is the only mode now. Recommend adding a
   non-beginner mode later, as a per-room rule, only if the kids ask for it.
7. **Should the Ember Shield block breath?** Today it blocks none: not fire,
   ice, lightning or acid. That keeps one simple rule (it saves you from one
   body hit) and no breath kills anyway. Recommend leaving it; the alternative
   is to let it absorb one breath hit and pop, like a body hit.
8. **How much breath from the sun?** Sun crystals (§5.8) bring a busy room
   roughly eight times the breath crystals it had. Recommend playtesting the
   defaults; if the sky gets too busy with breath, raise `sunCrystalRespawn`
   (say to 15 s) or `botSunGap`, or turn `sunCrystals` off. All are rules, so
   no code change is needed.
9. **Fight mode or classic?** Joel asked whether flipping the dynamic would
   make the game more fun: bodies poisonous only with a power-up, and
   dragons eating each other anywhere, not just at the tail. It is built as
   the rule `fight` (§5.11), off by default, so both can be tested: solo
   from Settings → Server, online by creating a server with the switch.
   - **What changes**, measured with 25 seeded bots in beginner rooms
     (6 minutes × 3 seeds in each world; the numbers move a little between
     runs): about half the deaths (about 4.5 a minute instead of 9), most
     of them dragons bitten in two, but about 50 bites a minute instead of
     a tail tip nibbled every two minutes, each taking about 50–60 mass.
     Dragons stay shorter (about 50 m on average instead of 67, the longest
     about 235 m instead of 300) because big bodies are big targets.
     Hatchlings were bitten to death in their first 30 s no more often than
     they were killed in classic (0–10% against 10–14%), but about one in
     five was bitten at least once.
   - **Risks:** being bitten every half minute or so may feel worse to a
     young player than an occasional death, even though it's milder;
     growing big is less of a safe reward (the pillar "getting longer must
     always feel like a reward"); a nibble on a tail tip is now worth what
     breaks off (often +2) instead of +25; and old cached pages can't join
     fight servers until they reload.
   - **Recommendation:** keep classic as the default and the permanent
     servers classic. Let the kids play a fight server and solo fight mode
     for a week, then decide whether it becomes a third permanent server, a
     per-server choice only, or goes. If it stays, the first things to tune
     are `biteGain` (0.3) and `biteMinLen` (10 m), all rules, so no code
     change is needed. Don't set `WYRM_TUNE` `{"fight":1}` until old pages
     have aged out: it would turn them away from every server.
