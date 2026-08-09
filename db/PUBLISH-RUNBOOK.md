# Publishing the site

This procedure existed only as operator knowledge. Writing it down because the
repo topology is not what it looks like, and getting it wrong either publishes
the papers or reverts the live `/app/`.

## The topology — read this first

**The two `main`s are DIFFERENT branches and are meant to be.**

| | |
|---|---|
| **local `main`** | development + docs. Theory paper, whitepaper, planning, archives. |
| **`origin/main`** | THE PUBLISHED SITE. Receives `/app/` builds and nothing else. |

They have permanently diverged (18 local-only / 12 origin-only as of 2026-08-05,
merge-base `9249b3d0`). Every origin-only commit is a `feat(app): publish …`
written through the worktree below.

Consequences that bite:

- **`git push origin main` would publish the unreleased theory/whitepaper work.**
  Never do it. Push `deploy-ui:main`.
- **`app/` files are UNTRACKED on local main by design.** They are published
  through the worktree, not committed locally. An untracked `app/` file is not a
  mistake and must not be "cleaned up".
- **Deleting something in the local working tree does NOT unpublish it.** The
  live site keeps serving it until the deletion is pushed through `deploy-ui`.

## Procedure

```bash
# 1. Worktree tracks origin/main, NOT local main.
git -C ~/Dev/PurgeGame/website fetch origin
cd /tmp/deploy-ui && git reset --hard origin/main

# 2. Overlay the publishable content from the working tree.
#    NEVER copy: theory/ whitepaper/ affiliates/ learn/ index.html .planning/
rsync -a --delete ~/Dev/PurgeGame/website/app/    /tmp/deploy-ui/app/
rsync -a          ~/Dev/PurgeGame/website/shared/ /tmp/deploy-ui/shared/
rsync -a          ~/Dev/PurgeGame/website/js/     /tmp/deploy-ui/js/
# /decimator-draw/ is a same-origin document that /app/ IFRAMES
# (app-decimator-draw-overlay.js sets frame.src = '/decimator-draw/?…').
# It does not live under app/, so it needs its own line. Omitting it publishes
# an overlay whose iframe silently resolves to the root fallback — that shipped
# on 2026-08-07. The self-contained check below now covers it.
rsync -a          ~/Dev/PurgeGame/website/decimator-draw/ /tmp/deploy-ui/decimator-draw/

# 3. Verify BEFORE committing — see the checks below.

# 4. Publish.
git -C /tmp/deploy-ui add -A
git -C /tmp/deploy-ui commit -m "feat(app): publish …"
git -C /tmp/deploy-ui push origin deploy-ui:main
```

## Verify before pushing

- [ ] **`/app/` is self-contained.** Its only external deps should be
      `js/ref.js` and `shared/nav.{css,js}`:

      grep -rn "/beta/\|/play/\|/control/\|/lootbox/" /tmp/deploy-ui/app/ \
        --include=*.html --include=*.js --include=*.css | grep -v "^.*://"

      Anything matching that is not an API path (`/lootbox/feed`,
      `/lootbox/legs` and `/degenerette/feed` are degenerus-db ENDPOINTS, not
      directories) will 404 on the live site.

- [ ] **Every same-origin path `/app/` navigates to or iframes was copied.**
      The grep above only knows about the four retired directories; it says
      nothing about a NEW route the app starts pointing at. This catches that:

      grep -rhoE "(src|href)\s*=\s*[\`'\"]/[a-z0-9-]+/" /tmp/deploy-ui/app/ \
        --include=*.js --include=*.html | grep -oE "/[a-z0-9-]+/" | sort -u |
        while read -r p; do
          [ -e "/tmp/deploy-ui${p}" ] || echo "MISSING FROM PUBLISH: $p"
        done

      Remember the 404 test does not work on this site (see below) — a missing
      route serves the root page with HTTP 200, so an unpublished iframe target
      looks like a blank/odd panel rather than an error.

- [ ] **Every module a published file imports was published.** `node --check`
      does not do this — an ES import specifier is not resolved at parse time,
      so a file importing a module that does not exist parses clean and passes
      every test that stubs its way around it.

      cd /tmp/deploy-ui/app && find . -name '*.js' -not -path '*/__tests__/*' |
        while read -r f; do
          d=$(dirname "$f")
          grep -oE "^\s*(import|export)[^'\"]*'\.\.?/[^']+'" "$f" |
            grep -oE "'\.\.?/[^']+'" | tr -d "'" | while read -r s; do
              [ -e "$d/$s" ] || echo "MISSING MODULE: $f imports $s"
            done
        done

      No `from` in that pattern, deliberately. Custom elements register through
      side-effect imports here — `import './boon-product-indicator.js';` — and
      requiring `from` would skip exactly the import whose only job is to make
      an element exist.

      This is not hypothetical. `3dcfda9` published
      `import { readPlayerSnapshot } from '../app/player-snapshot.js'` into
      app-daily-flip.js; that module was never created, never committed, and
      was on no disk anywhere. Because this site has no 404, the request
      resolved to the root HTML with `content-type: text/html`, the browser
      rejected the module, and `<app-daily-flip>` sat in the DOM permanently
      unupgraded — the coin flip UI was dead in production for ~14 hours with
      **no console error loud enough to notice and nothing failing in CI**.
      Confirm a suspected case in the browser with
      `customElements.get('app-daily-flip')`: `undefined` means its module
      never executed.

- [ ] **Contract addresses match the run you are publishing for.**

      node db/sync-deployment.mjs      # exit 0, all targets "up to date"

- [ ] **The papers did not sneak in.**

      git -C /tmp/deploy-ui status --short | grep -E "theory/|whitepaper/|learn/|affiliates/|\.planning/"
      # must be EMPTY

- [ ] `node --check` any JS you hand-edited.

## Ordering around a chain redeploy

Publishing before the addresses are synced puts the OLD run's contracts live and
costs you a second publish.

1. Deploy the contracts (`.testnet/go-run28.sh`)
2. `node db/sync-deployment.mjs --write` — rewrites `app/app/chain-config.sepolia.js`
   (addresses, `CHAIN.deployBlock`, `VOLUME_WINDOW.deployDayBoundary`),
   `db/deployment.json`, and `database/src/config/contracts.ts`
3. `node ../database/scripts/sync-contracts-config.mjs --check` — must exit 0
4. Publish the site (above)
5. Deploy the data plane (`flyctl deploy --ha=false` in `database/`)

## Cache caveat

Site JS is edge-cached `max-age=14400`. A push that changes module content under
unchanged URLs breaks warm browser caches for up to 4h — the "way broken" symptom
that self-heals at TTL. Cold visitors are fine; a hard refresh fixes it. Query-param
busting does not help, because nested imports do not inherit it.

### ✅ The `_headers` max-age fix IS in effect now (re-verified 2026-08-08)

The override described below is gone. Measured on both `/app/app/*` and
`/app/components/*` immediately after the 2026-08-08 publish:

```
cache-control: public, max-age=60, must-revalidate
```

`max-age=60` now passes through, so a publish reaches the edge in about a
minute rather than up to four hours, and the mixed-module-graph window is that
minute. Confirmed end to end: a bare-URL check failed right after the push and
succeeded on its own within the TTL, with no purge. Keep watching it — the
section below is what it looked like when the dashboard was overriding, and is
what to compare against if long TTLs reappear.

### ⛔ (Historical) The `_headers` max-age fix was NOT in effect — Cloudflare overrode it

Verified against production 2026-08-07, immediately after a publish:

```
$ curl -sI https://degener.us/app/app/polling.js | grep -i cache-control
cache-control: public, max-age=14400, must-revalidate
```

`_headers` has said `/app/app/*  Cache-Control: public, max-age=60, must-revalidate`
since the 2026-08-05 stale-module incident, and that rule IS present on
`origin/main` with nothing overriding it later in the file. **`must-revalidate`
passes through; `max-age` does not.** That is the signature of a dashboard-level
**Browser Cache TTL** set to 4 hours, which rewrites the origin `max-age` while
leaving the rest of the header alone. 14400 is exactly CF's 4-hour preset.

Consequence: **the 2026-08-05 fix never took effect.** Every publish still has an
up-to-4-hour window in which warm browsers run a MIXED module graph — some files
new, some stale — which is far worse than uniformly-old, because ES modules that
disagree about each other's exports fail in ways that look like logic bugs. The
incident that motivated the rule (a corrected RPC endpoint that never reached
clients) can still happen exactly as before.

Fix is in the Cloudflare dashboard, not this repo: set **Browser Cache TTL** to
*Respect Existing Headers*. Until then, treat every publish as needing an explicit
edge purge for `/app/*`, the same way a route deletion does.

### ⛔ DELETING a page does not take it off the edge — and not on a 4h clock

Verified against production 2026-08-06, after `272ae24` removed `beta/`, `play/`,
`control/` and `lootbox/` from `origin/main`:

- `/control/` was **still being served, byte-identical to the pre-deletion copy**,
  with `cache-control: public, s-maxage=604800`. That is **7 days**, not the 4h the
  paragraph above would lead you to expect. No `_headers` rule ever set it; it comes
  from Cloudflare's side.
- Its assets were already gone (`/control/control.js` and `/control/styles.css` both
  fell through to the HTML fallback), so the page was a broken zombie: live document,
  dead JS and CSS.
- Origin was correct the whole time. **A cache-busting query string proves it:**
  `curl "https://degener.us/control/?cb=$RANDOM"` returned the 7082-byte root
  fallback with no `age` header, while the bare URL kept returning the stale 9092-byte
  page. Use that to tell "stale edge copy" from "still published".

So after any publish that DELETES a route, **purge it explicitly at the Cloudflare
edge** — do not wait it out.

### Checking a retired route — the 404 test does NOT work here

This site has no 404 for unknown paths: it serves the root page with **HTTP 200**.
`/beta/`, `/play/`, `/lootbox/` and a nonsense path all return byte-identical copies
of `/` (7082 bytes, differing only by Cloudflare's injected per-request challenge
nonce). So `curl -o /dev/null -w '%{http_code}' /beta/` returning 200 means nothing.

Compare CONTENT, not status:

```bash
# A retired route should be byte-identical to a path that never existed.
diff <(curl -s https://degener.us/definitely-not-a-real-path-xyz/) \
     <(curl -s https://degener.us/beta/)
# Only the __CF$cv$params nonce line may differ. Anything else = still live.
```
