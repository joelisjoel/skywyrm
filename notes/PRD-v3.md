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
| Sharing | Highlights, replay links, share cards | Not built. Big moments show as toasts and voice lines only |
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
| 3 | A small, genuine player base (stretch) | Anonymous daily totals at `/api/stats`: lives played, time flown, peak players online (§11). Nobody is tracked | ⬜ not pursued yet; the numbers are now counted |

**Non-goals.**
- Accounts or passwords.
- Chat of any kind.
- Analytics or tracking of players. Only anonymous daily totals are counted (§11).
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

---

## 5. Rules (as built)

### 5.1 Dragon and growth ✅
- **Mass drives everything.**
  - Length = 8 m + 0.4 m per unit of mass, capped at 400 m (reached at mass 980).
  - Body radius grows from 0.6 m to 2.0 m by mass 2000.
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
Speed multiplier = 1 + **heat bonus** + **length bonus**.

- **Heat bonus:** up to +0.4×, at 100°.
- **Length bonus:**
  - +0.5× at 100 m
  - +0.8× at 200 m
  - capped at +1.0×, at about 280 m
- **Heat** comes from the sun at the centre of each world and from crowds of
  dragons nearby. It rises quickly (τ 3 s) and fades slowly (τ 7 s). Heat also
  enlarges the thrust tank.
- The HUD shows the total, for example `DRAKE · 1.5× SPEED`.
- The bonus applies to cruise and boost, not brake.

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

### 5.6 Tail nibbling ✅
- The last 5 beads of every tail shimmer gold.
- Hitting them is a **bite**, not a death:
  - you gain **+25 mass** (5 beads × 5)
  - they lose about one tip's worth
- There is a 0.5 s cooldown between bites.

### 5.7 Food ✅
- **Ambient food:** about 2,000 orbs worth 1 each. 60% come in clusters, and they
  are denser near the centre.
- **Loot** from deaths, boosting and burned tails lasts 45 s.

### 5.8 Power-ups ✅

Crystals appear about every 20 s, with up to 5 in the sky at once. Half of them are fire.

| Crystal | Effect |
|---|---|
| **Ember Shield** (orange) | Lasts 12 s and survives one body hit. It does *not* stop head-ons, walls or fire |
| **Lodestone** (blue) | Lasts 10 s and pulls food within 18 m with tractor beams |
| **Dragonfire** (red) | One 1.2 s breath: a 24 m, 30° cone that burns through the nearest tail and cuts it off there. 80% of the lost part drops as food. It never kills. Bots use it too |

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
  - Each row shows the number of humans and bots, and the list refreshes every 5 s.
- **Create a server:** it gets a generated name such as "Jade Peak" (🎲
  picks another), and you pick a world. Names aren't typed, so nothing a
  player writes is shown in everyone's lobby.
  - Created servers disappear 12 h after the last player leaves.
  - At most 30 created servers can exist at once.
  - Each network can create 3 per hour.
- **Capacity:** up to 30 humans per room, with bots filling the rest. Every room
  uses beginner rules.
- **Pause online means "fold your wings":**
  1. A 3 s countdown, during which you can still be hit.
  2. You leave the sky with your length kept.
  3. You can fly back in after 2 s.
- **If the server is down:** the lobby says "servers offline — play solo". Solo
  always works.
- **Known limit:** Cloud Run ends every connection after 60 minutes, and there is
  no automatic reconnect, so you land back on the menu (§14).

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
| Mute / music | M / N | in Settings |

**Settings** (saved in the browser):

| Setting | Default |
|---|---|
| Wide view (fisheye edges, 122° corners) | on |
| Rear-view mirror | on |
| Invert pitch (arrow keys only) | off |
| Lock mouse | off |
| Zero-G orientation assist | on |
| Reduce motion | off |
| Mute | off |
| Music | on |
| Dragon voice | on |
| Graphics | Auto |

- **Graphics** can be Auto, High or Low. Auto drops to Low if the game runs below
  40 fps.
- The beginner switch was removed. Beginner is always on.

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

**Animation:**
- Whiskers lengthen with each tier.
- The jaw opens wide to eat or breathe fire.
- The head looks into turns.
- The body swims in an S-wave.

### 10.3 HUD
- **Bottom-left:** length, kills, lives (pearls), tier with speed, and gauges
  for heat, thrust and fire. Shield and magnet gauges appear only while active.
- **Radar** at the bottom centre, with a 60 m range. It shows above and below,
  power-ups, the centre and the leader.
- **Top:** leaderboard, kill feed, and toasts.
- **Over the world:**
  - names over dragons within 50 m
  - arrows to dragons off screen within 30 m
  - a "⚠ WALL" warning

### 10.4 Sound
- **Effects:** all synthesised live, with no sound files. Wind, a rising chime
  for eating, whooshes, power-up sounds and dragonfire.
- **Music:** generated live in D minor at 118 BPM. It has three intensity levels
  (menu, flying, action), and it muffles when paused.
- **Voice:** 24 recorded Mandarin battle shouts, with characters, pinyin and English
  captions on screen. Only your own dragon's events trigger them:

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
  - Nothing beyond this is collected.
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
  words for kids and parents covering what is counted, what isn't, IP
  addresses, who hosts what, and where grown-ups can ask (the repo's issues).

---

## 12. Platforms and performance 🟡

- **Desktop:** Chrome, Safari, Firefox.
- **Mobile:** iPhone and Android browsers.
  - The touch UI turns on automatically.
  - Below 640 px wide, the leaderboard shrinks to the top 5 and the mirror hides.
- **Graphics:**
  - High: up to 2× pixel density, bloom, and full-rate wide view.
  - Low: 1× pixel density, no bloom, and wide view updated every other frame.
  - Auto starts on High and drops to Low once if the frame rate falls below 40 fps.
- ⬜ There are no measured load-time or frame-rate targets yet, and no device
  test matrix.

---

## 13. Backlog

### 13.1 From v2, not built
- **Sharing:**
  - highlight clips
  - replay links
  - share card
  - link previews (Open Graph)
- **Run card:** "Share", "Watch replay" and "Change dragon" buttons.
- **Settings:**
  - sensitivity, deadzone and FOV sliders
  - colour-blind stripes
  - volume sliders
  - ping display
- **Audio:** spatial (3D) audio, mute when the tab is hidden.
- **Worlds:** The Grid and The Warrens.
- **Persistent boards:** daily and all-time.
- **Input:** emotes and gamepad.

### 13.2 Issues found while writing v3
These are listed roughly by how much a player would notice.

1. **No reconnect** after the 60-minute Cloud Run cut. Players drop to the menu
   mid-game.
2. **Dragonfire takes too much from very long dragons.** Above the 400 m length
   cap, burning just the tip removes far more than the tip. A 1,500-mass dragon
   can lose about 540 mass.
3. **Quitting a solo life from the pause menu earns no jade** for that life.
4. **The dev tuning button (⚙) and FPS counter show for every desktop player.**
   The Settings "Server" tab is the default tab, only affects solo, and says
   it affects rooms.
5. **7 of the 10 rank seals render in a fallback font.** Those characters
   (石玉珠云雷山日) are missing from the font subset. The body font Nunito is never
   loaded either.
6. **The shield is narrower than it looks.** It doesn't stop head-ons, walls or
   dragonfire.
7. Saved profile stats (best length, best kills, games played) are never shown.
8. Auto graphics re-tests on every visit instead of remembering that it dropped
   to Low.
9. **Room-creation abuse:** one network could fill all 30 server slots in about
   10 hours. A school or home network is limited to 6 players.

---

## 14. Decisions for Joel

Each decision has a recommended default, so work can start on that default.

1. **Reconnect after 60 minutes.** Recommend an automatic rejoin of the same
   room that keeps your length. It's a small client change.
2. **Sharing.** Recommend a kid-safe screenshot card (a picture only, with no
   link back to the player) before replays. Or leave sharing out entirely.
3. **Portals, ads and revenue.** Recommend staying out while the game is
   kid-first. Ads would require consent tooling and a COPPA review.
4. **Privacy page.** ✅ Done, together with the anonymous play totals (§11).
5. **Dev tools in production.** Recommend hiding the ⚙ tuning panel and FPS
   counter unless `?dev=1` is in the URL.
6. **Hardcore mode.** Beginner is the only mode now. Recommend adding a
   non-beginner mode later, as a per-room rule, only if the kids ask for it.
