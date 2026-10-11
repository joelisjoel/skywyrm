# Wyrm multiplayer: architecture and Google Cloud setup

> Moved from `dendroslabs/dendroslabs.github.io`: the game is now in `site/` and the server in `server/` (formerly `docs/wyrm/` and `wyrm-server/`).

Sep 30, 2026 · Draft for Joel. **Part 3 is the walkthrough to follow.**

---

## 1. What we have today

```
 dendroslabs.com (GitHub Pages, static files from docs/)
 └── /wyrm/  index.html + js/ modules, three.js loaded from esm.sh
       main.js ── game loop, menus, state machine (menu → play → death card)
       sim.js ─── the whole game: flight, tails, collisions, orbs, power-ups, heat
       bots.js ── bot pilots (same input struct as a human)
       render.js, camera.js, hud.js, input.js, audio.js, tune-panel.js
 Everything runs in your browser. No backend, no accounts, nothing stored
 except your settings in localStorage.
```

- **Single-player only.** You play against bots that live in your own tab.
- **`sim.js` has no DOM and no rendering.** It was built that way on purpose
  so the same file can run on a server. That's the key to the plan below.
- **Existing Firebase:** the rest of the site uses Firebase project
  `treehouse-hello` for visit counters and analytics. Wyrm doesn't use it,
  and it should stay separate (§4).

## 2. What we're building

```
 Browser (dendroslabs.com/wyrm)                 Google Cloud (project "dendros-wyrm")
 ┌──────────────────────────────┐   HTTPS      ┌────────────────────────────────────┐
 │ Lobby: server list, create   │ ───────────► │ Cloud Run service "wyrm-server"     │
 │ Game: renders world, flies   │   WSS        │  Node.js, one process, all rooms    │
 │   your dragon, sends pose    │ ◄──────────► │  in memory: runs sim.js at 30 Hz,   │
 │   15×/s, draws what the      │  snapshots   │  bots, collisions, orbs, deaths     │
 │   server says                │   15×/s      │  GET/POST /api/rooms, /ws           │
 └──────────────────────────────┘              └──────────────┬─────────────────────┘
                                                              │ room list only
                                                     ┌────────▼─────────┐
                                                     │ Firestore        │
                                                     │ rooms/{id}       │
                                                     └──────────────────┘
```

### Your user journeys, and how they're covered

| Journey | How |
|---|---|
| See the list of servers and how many players are on each | The start page calls `GET /api/rooms` every 10 s while it's on screen and shows name, world, beginner badge, and players (plus bots). |
| There are always three servers | Three permanent rooms are built into the server: **Skyhold (Beginners)**, **Skyhold**, **The Orb**. They can never expire. |
| Create a server and name it | A "Create server" form (name, world, beginner on/off) calls `POST /api/rooms`, then you join it. |
| Servers live until 12 h after the last person leaves | When a room's last player leaves, it gets `expireAt = now + 12 h`, saved in Firestore. It's cleared if anyone joins. Expired rooms disappear from the list and are deleted. |

### Key choices

- **Cloud Run, not a VM.**
  - No machine to patch, no TLS certificates, no DNS changes.
  - You get an `https://…run.app` URL immediately.
  - It **scales to zero**, so it costs nothing while nobody is playing.
  - Set **max instances = 1**: every room lives in one process. That's
    plenty for hundreds of players.
- **Firestore** holds only the room list (names, settings, and expiry) and
  the anonymous daily play totals (`stats`, 30 days; see DESIGN-v3 §4.7).
  That lets user-created rooms survive a server restart for their 12 hours.
  Game state stays in memory (it's a snake game, so nothing needs saving).
- **Movement is client-trusted but server-checked**, for v1.
  - Your browser flies your dragon (no input lag) and reports its pose.
  - The server clamps any move faster than your allowed speed.
  - The server alone decides **collisions, deaths, kills, orbs, growth,
    power-ups, thrust and heat.**
  - Upgrade path: full server authority with client prediction, if cheating
    ever matters.
- **Bots run on the server.** They fill each room, ramping up from 3 to 30
  while humans are present.
- **Solo mode stays.** If the servers are asleep or unreachable, "Play solo"
  works exactly as today.

### Safety checks on everything users can type (your requirement)

Two strings can be written by users: **player names** and **server
names**. Both go through one shared `names.js` check, **run on the
server** (the authority) and mirrored in the browser.

- **Allowlist:** letters, numbers, spaces and `- _ . ' ! ? & #` only.
  Everything else is dropped, including emoji, HTML/`<script>`, and
  control characters.
- **Removed:**
  - invisible characters (zero-width, BOM)
  - direction overrides (the Unicode tricks that flip text)
  - stacked "zalgo" accents (more than 2 in a row)
- **Unicode normalisation** (NFC), whitespace collapsed, trimmed.
- **Length limits:** names up to 16 characters, server names up to 24.
- **Blocked:**
  - URLs, domains and e-mail addresses (spam)
  - reserved words that imitate staff ("admin", "moderator", "official", …)
  - the three built-in room names
  - a profanity list, including common leetspeak (`4`→a, `3`→e, `0`→o …)
- **Server names:**
  - must be unique, case-insensitive
  - 3 per IP address per hour
  - at most 30 user rooms at once
- **Rendering:** names are only ever drawn with `textContent` or canvas
  `fillText`, never as HTML.
- **Other protections:**
  - Room IDs are random and generated by the server.
  - Messages are capped at 2 KB and rate-limited.
  - At most 16 connections per IP (the `MAX_CONN_PER_IP` variable changes it).
  - Only `dendroslabs.com` (plus `localhost` for testing) may connect.

## 3. Walkthrough: set up Google Cloud

You'll do this in the browser at **console.cloud.google.com**, logged in as
your Google account. You don't need to install anything, and **you
never download a key file.** Total time is about 20–30 minutes.

> I can't click in your Google Cloud account, so these steps are yours.
> The one thing I need back is the **service URL** from step 7.

### Step 1: Create a project ✅ done

Project ID: **`dendros-wyrm`**. Make sure it's selected in the top-bar
project picker for every step below.

### Step 2: Billing and a budget alarm (3 min)

1. **Billing** → link your billing account to `dendros-wyrm`. Cloud Run
   needs billing even to use the free tier.
2. **Billing → Budgets & alerts → Create budget.**
   - Scope: project `dendros-wyrm`
   - Amount: **$20/month**
   - Alerts at 50%, 90% and 100% (e-mail to you)

   Expected cost at hobby scale is **about $0–5/month**. The budget alarm
   is your safety net if something goes wrong.

### Step 3: Turn on the APIs (1 min)

Search each of these in the top search bar and click **Enable**:
- Cloud Run Admin API
- Cloud Build API
- Artifact Registry API
- Cloud Firestore API

### Step 4: Create the Firestore database (2 min)

1. Search **Firestore** → **Create database**.
2. Mode: **Native mode**.
3. Location: **us-west1 (Oregon)**, the closest region to Seattle.
4. Security rules: **Production mode**. This denies all access from
   browsers. Only our server, using its own identity, can read or write.
5. **Create.**
6. Optional: **Firestore → TTL → Create policy**.
   - Collection group: `rooms`
   - Timestamp field: `expireAt`

   Firestore will then garbage-collect expired rooms on its own. The server
   also cleans up, so this is a backstop.

### Step 5: Give the server its own identity (2 min)

1. **IAM & Admin → Service accounts → Create service account.**
2. Name: `wyrm-server`. Click **Create and continue**.
3. Role: **Cloud Datastore User** (this covers Firestore data read and
   write, nothing else). **Done.**
4. **Do not create or download a key.** Cloud Run runs as this account
   automatically.

### Step 6: Deploy the server straight from GitHub (10 min) ✅ done

Service URL: **`https://wyrm-server-420365023329.us-west1.run.app`**

1. Search **Cloud Run** → **Connect repository**. The form opens with
   **Continuously deploy from a repository** selected.
2. Select **Cloud Build** (not Developer Connect) → **Set up with Cloud
   Build**.
   - Provider: **GitHub** → authenticate → install the Google Cloud Build
     GitHub app **on `dendroslabs/dendroslabs.github.io` only**.
   - Repository: `dendroslabs/dendroslabs.github.io` · Branch: `^main$`
   - Build type: **Dockerfile**, source location: `/Dockerfile`
   - **Save.**
3. Service name: `wyrm-server` · Region: **us-west1**.
4. **Authentication:** Allow public access. It's a public game server;
   the server code does its own checks.
5. **Billing:** Request-based. CPU is only allocated during requests; open
   game connections count as requests, so it's awake while anyone plays.
6. **Service scaling:** Auto scaling, minimum **0**, maximum **1**.
   *(Important: all rooms live in one process.)*
7. Expand **Container(s), Volumes, Networking, Security**:
   - **Container:** port `8080`, memory **512 MiB**, CPU **1**, request
     timeout **3600** seconds (the longest a game connection can stay
     open; the game reconnects after that), max concurrent requests
     **250**.
   - **Variables & Secrets → Add variable:**
     - `ALLOWED_ORIGINS` = `https://dendroslabs.com,https://www.dendroslabs.com`
     - Optional, any time later: `WYRM_TUNE` = JSON of game numbers,
       e.g. `{"popMax":20}`. This retunes the live server without a code
       change. Only known numeric settings are accepted.
   - **Security → Service account:** `wyrm-server`.
8. **Create.**
   - If it asks to grant Cloud Build permissions, say yes.
   - The first build takes about 3–5 minutes (see **Cloud Build → History**).

### Step 7: Check that it's alive (1 min)

1. Cloud Run → `wyrm-server` → copy the **URL** at the top
   (`https://wyrm-server-xxxxxxxx-uw.a.run.app`).
2. Open `<URL>/api/rooms` in your browser. You should see JSON listing
   the two permanent rooms (Skyhold and The Orb).
   - The first request after an idle period takes a few seconds while the
     server wakes up. That's normal with scale-to-zero.
3. **Send me that URL.** I'll point the game at it, test it end to end,
   and ship the lobby.

### After setup: day-to-day

- **Deploys are automatic.** Every merge to `main` rebuilds and redeploys
  the server in about 3 minutes. Later we can limit rebuilds to
  `server/**` and `site/js/**` under Cloud Build → Triggers →
  Included files.
- **Logs:** Cloud Run → `wyrm-server` → **Logs**.
- **Roll back:** Cloud Run → `wyrm-server` → **Revisions** → pick an older
  revision → **Manage traffic** → send 100% to it. The site itself rolls
  back by reverting the PR.
- **Emergency off switch:** Cloud Run → `wyrm-server` → **Edit** → Maximum
  instances **0**. The game falls back to solo mode.
- **Costs:** Billing → Reports, filtered to `dendros-wyrm`.

## 4. Security notes

- **No keys anywhere.** The server uses its Cloud Run service account.
  Nothing secret is in the repo, which matters because the site's files
  are public.
- **Least privilege:** the service account can only read and write
  Firestore documents.
- **Firestore production rules** deny every browser. Only the server
  touches the database.
- **Separate project** from `treehouse-hello`, so a problem or a bill in
  the game can't touch the site's Firebase, and the reverse.
- **Budget alarm at $20/month.**
- **Server-side limits:** origin allowlist, per-IP connection and room
  caps, message size and rate limits, and strict validation of every
  message and every name.
- **Known trade-off (v1):** movement is client-reported. It's checked for
  speed, but a determined cheater could still fly perfect lines. That's
  fine with no real players yet; it's on the list before any public
  launch.

## 5. Later (not in this step)

- Binary protocol, to use less bandwidth.
- Full server authority with client prediction.
- Multiple regions.
- Accounts and persistent leaderboards.
- Reconnecting into the same dragon after the 60-minute connection limit.
