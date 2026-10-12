# Skywyrm

Fly a Chinese dragon through the clouds. Eat, grow longer and faster, and
don't touch anyone's tail. A free 3D .io-style game that runs in the
browser on phones and computers. Play solo against bots, or online in
shared rooms.

**Play:** [skywyrm.io](https://skywyrm.io)

## What's where

| Path | What it is |
|---|---|
| `site/` | The game: a static page plus ES modules, with three.js and the fonts self-hosted (no requests to other sites). Published to GitHub Pages. |
| `site/js/sim.js` | The simulation, shared by the browser and the server |
| `server/` | The multiplayer server: rooms over WebSockets, on Google Cloud Run |
| `notes/` | Product and design docs ([PRD-v3](notes/PRD-v3.md), [DESIGN-v3](notes/DESIGN-v3.md)), rules, multiplayer setup, the voice clips' generator |
| `scripts/` | Local server, smoke test, cache-stamp and asset checks, the link-preview picture (`make-og.mjs`) |

## Run it locally

```sh
npm install                       # three + playwright, for tests
npm run serve                     # http://localhost:8765
cd server && npm install && npm start   # optional: a local game server on :8080
```

With a local game server, open `http://localhost:8765/?server=http://localhost:8080`.

## Checks

```sh
npx playwright install chromium   # or reuse any Chromium already in PLAYWRIGHT_BROWSERS_PATH
npm run smoke                     # the game loads and flies
npm run stamps                    # cache stamps were bumped (npm run stamps:fix bumps them)
npm run assets                    # CSP hashes, vendored three.js and the font subset are in step
cd server && npm test             # simulation + rooms
```

Phones cache hard, so every module is loaded with a `?v=N` stamp. When a
module changes, bump its stamp in every file that imports it. CI checks
this on every pull request.

## Link previews

A shared skywyrm.io link shows `site/og.jpg` (1200×630) with the title and
blurb from the `og:` and `twitter:` tags in `site/index.html`. The tab icon
(`favicon.png`) and home-screen icon (`apple-touch-icon.png`) are the 龍
seal. `npm run og` remakes all three from the game itself: it poses a dragon
in Skyhold, takes the frame in headless Chromium and lays the wordmark over
it. The seal needs a Kai font for 龍 (on Linux: `apt install fonts-arphic-ukai`).
Look at the picture before committing it.

## How it ships

- **Site:** every merge to `main` runs the checks and then publishes
  `site/` to GitHub Pages ([.github/workflows/ci.yml](.github/workflows/ci.yml)).
- **Server:** Cloud Run builds the `Dockerfile` from `main` and redeploys.
  The `ALLOWED_ORIGINS` environment variable lists the sites allowed to
  connect. `MAX_CONN_PER_IP` (default 16) caps the sockets from one
  address; raise it if a big class shares one network.

## Safety

Made with kids in mind: there are no accounts, no chat, no ads, no cookies
and no tracking. Player names are filtered, server names come from a word list, and
progress stays in the browser. To improve the game, the server keeps anonymous daily totals
(how long lives last, how long dragons grow, how they end, how many play
online at once): solo games send one note per life with just those numbers,
and online lives are counted by the server. No ids or names, IP addresses
are never stored, 30 days are kept, and the totals are public at
`<server>/api/stats`. The [privacy page](site/privacy.html) explains it for
kids and parents.
