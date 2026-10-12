# Working on Skywyrm

Start with [README.md](README.md) for the repo layout, the checks and how
each part ships. What the game is and why: `notes/PRD-v3.md`. How it works
(sim, netcode, renderer, deploy, known issues): `notes/DESIGN-v3.md`. Keep
both current when a change alters what they describe. Server setup steps
are in `notes/MULTIPLAYER.md`.

## Owner's ground rules (Joel)

- Make small, modular PRs, one feature or fix each, so any one can be
  reverted alone.
- While there are no real users, it's fine to merge a demo without asking,
  as long as a revert rolls it back. Ask first before anything a revert
  can't undo: Cloud Run or Firestore settings, DNS, or GitHub settings.
- Joel's kids play this. Don't add accounts, chat, tracking, analytics or
  ads, and keep names going through the shared filter in `site/js/names.js`.
  The approved exceptions are the anonymous daily play and visit totals (no
  ids, no cookies, no stored IPs) that `site/privacy.html` describes; ask
  before measuring anything else.
- It's played on PCs and phones, so check that new UI works at phone width.

## Code map

- `site/js/sim.js` (exported through `shared.js`) runs in the browser *and*
  on the server. Any sim change ships to both, so run the server tests
  too.
- Gameplay numbers live in `site/js/tunables.js`. New mechanics go behind
  a per-room rule (`World.rule(k)`) so they can be turned off.
- `site/js/render.js` holds the dragon look: GPU tube bodies with a
  procedural scale shader, heads, jaws and ornaments.
- three.js is pinned to 0.163.0 and self-hosted: `site/vendor/three-0.163.0.module.min.js`
  is a copy of the devDependency's build (`npm run assets` checks it). Nothing
  loads from other sites; the page's Content-Security-Policy enforces that.
- Adding Chinese text? Add the characters to the font subset (`site/fonts/README.md`).

## Before pushing

```sh
npm run stamps:fix        # bump ?v=N on every changed module, in every importer
npm run stamps            # check only (what CI runs)
npm run assets            # CSP hashes, vendored three.js, font subset (assets:fix updates hashes)
npm run smoke             # loads and flies; screenshots land in smoke-shots/
(cd server && npm test)   # sim + rooms
```

For visual changes, look at the screenshots, not just the exit code.

## Shipping

- **Site:** a merge to `main` runs CI and then publishes `site/` to GitHub
  Pages at https://skywyrm.io.
- **Server:** if a merge to `main` touches `server/`, `site/js/` or
  `Dockerfile`, Cloud Build redeploys Cloud Run service `wyrm-server`
  (project `dendros-wyrm`, us-west1). Max instances is 1, so every room
  lives in one process.
  - The server and the cached site update at different times. Keep the
    wire format backward compatible for one release.
