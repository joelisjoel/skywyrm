# Skywyrm multiplayer: architecture and Google Cloud setup

> The game is in `site/` and the server in `server/` of `joelisjoel/skywyrm`.
> Both moved here from `dendroslabs/dendroslabs.github.io` (`docs/wyrm/` and
> `wyrm-server/`). How the netcode works in detail is in
> [DESIGN-v3.md](DESIGN-v3.md); this page is the overview and the Google
> Cloud setup.

Sep 30, 2026, updated Oct 11, 2026. **Part 3 is the setup walkthrough**
(done; kept so it can be repeated).

---

## 1. Where it started

Before multiplayer, the whole game ran in your browser: `sim.js` (flight,
tails, collisions, orbs, power-ups, heat), bots, the renderer and the menus,
with nothing stored except your settings in localStorage.

- **`sim.js` has no DOM and no rendering.** It was built that way on purpose
  so the same file can run on a server. That's the key to the plan below.
- **Existing Firebase:** the rest of dendroslabs.com uses Firebase project
  `treehouse-hello` for visit counters and analytics. Skywyrm doesn't use
  it, and it stays separate (§4).

## 2. How it fits together

```
 Browser (skywyrm.io, GitHub Pages)           Google Cloud (project "dendros-wyrm")
 ┌──────────────────────────────┐   HTTPS      ┌────────────────────────────────────┐
 │ Lobby: server list, create   │ ───────────► │ Cloud Run service "wyrm-server"     │
 │ Game: renders world, flies   │   WSS        │  Node.js, one process, all rooms    │
 │   your dragon, sends pose    │ ◄──────────► │  in memory: runs sim.js at 30 Hz,   │
 │   30×/s, draws what the      │  snapshots   │  bots, collisions, orbs, deaths     │
 │   server says                │   15×/s      │  /api/rooms, /api/stats, /ws        │
 └──────────────────────────────┘              └──────────────┬─────────────────────┘
                                                              │ room list + daily totals
                                                     ┌────────▼─────────┐
                                                     │ Firestore        │
                                                     │ rooms/, stats/   │
                                                     └──────────────────┘
```

### Your user journeys, and how they're covered

| Journey | How |
|---|---|
| See the list of servers and how many players are on each | The start page calls `GET /api/rooms` every 10 s while it's on screen and shows name, world and players (plus bots). |
| There are always servers to join | Two permanent rooms are built into the server: **Skyhold** and **The Orb**. They can never expire. Every room uses the gentler beginner bots. |
| Create a server | The "Create server" form picks a name from a generated list (🎲 for another) and a world, calls `POST /api/rooms`, then you join it. Nobody types a server name. |
| Servers live until 12 h after the last person leaves | When a room's last player leaves, it gets `expireAt = now + 12 h`, saved in Firestore. It's cleared if anyone joins. Expired rooms disappear from the list and are deleted. |

### Key choices

- **Cloud Run, not a VM.**
  - No machine to patch, no TLS certificates, no DNS changes.
  - You get an `https://…run.app` URL immediately.
  - It **scales to zero**, so it costs nothing while nobody is playing.
  - Set **max instances = 1**: every room lives in one process. That's
    plenty for hundreds of players.
- **Firestore** holds only the room list (names, settings, and expiry) and
  the anonymous daily play and visit totals (`stats`, 30 days; see
  DESIGN-v3 §4.7 and §4.8).
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

Players type one string: their **player name**. It goes through the shared
`site/js/names.js` check, **run on the server** (the authority) and mirrored
in the browser. Server names come from a generated list (24 adjectives × 24
nouns). The server keeps a list name it's sent if no live room has it, and
gives anything else a random list name.

- **Plain ASCII only:** accents come off (José → Jose) and full-width or
  fancy letters fold to plain ones (Unicode NFKD). After that only
  letters, numbers, spaces and `- _ . ' ! ? & #` are kept. Everything
  else is dropped, including other alphabets (so a Cyrillic "с" can't
  pass for a Latin "c"), emoji, HTML/`<script>`, invisible characters,
  direction overrides and control characters.
- Whitespace is collapsed and trimmed.
- **Length limit:** names up to 16 characters.
- **Blocked:**
  - URLs, domains and e-mail addresses (spam)
  - reserved words that imitate staff ("admin", "moderator", "official", …)
  - the built-in room names
  - a profanity list, matched after folding look-alike letters, accents
    and leetspeak (`4`→a, `3`→e, `0`→o …) to plain A–Z, with an allowlist
    so innocent words aren't caught
- **Created servers:**
  - names are unique, case-insensitive
  - 3 per IP address per hour
  - at most 30 user rooms at once
- **Rendering:** names are only ever drawn with `textContent` or canvas
  `fillText`, never as HTML.
- **Other protections:**
  - Room IDs are random and generated by the server.
  - Messages are capped at 2 KB and rate-limited.
  - At most 16 connections per IP (the `MAX_CONN_PER_IP` variable changes it).
  - Only `skywyrm.io` and `www.skywyrm.io` (plus `localhost` for testing)
    may connect.

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
     GitHub app **on `joelisjoel/skywyrm` only**.
   - Repository: `joelisjoel/skywyrm` · Branch: `^main$`
   - Build type: **Dockerfile**, source location: `/Dockerfile`
   - Included files (Cloud Build → Triggers → the trigger → Edit):
     `server/**`, `site/js/**`, `Dockerfile`
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
     open; the game then reconnects into the same dragon), max concurrent
     requests
     **250**.
   - **Variables & Secrets → Add variable:**
     - `ALLOWED_ORIGINS` = `https://skywyrm.io,https://www.skywyrm.io`
       (also the default when it's unset)
     - Optional: `MAX_CONN_PER_IP` = connections allowed per IP
       (default 16; a family on one Wi-Fi shares an IP)
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

- **Deploys are automatic.** A merge to `main` that touches `server/`,
  `site/js/` or `Dockerfile` rebuilds and redeploys the server in about
  3 minutes. GitHub Pages publishes `site/` separately, so the two can be a
  few minutes apart; the wire format stays backward compatible for one
  release to cover that.
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
- Persistent leaderboards (without accounts: Joel's kids play this).
