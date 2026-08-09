# Deploy-sync runbook — re-sync the site + indexer to a fresh testnet deployment

Run top-to-bottom after a redeploy. Two buckets: **mechanical** (steps 1–3, mostly
automated) and **code** (step 4, only knowable once new ABIs land). Paths are relative
to the `PurgeGame/` root unless noted.

## 0. Preconditions
- [ ] Redeploy finished; `degenerus-sim/.testnet/sepolia-manifest.json` updated
      (new addresses + `blockNumber` per contract + `chainId`).
- [ ] `degenerus-sim/forge-out-testnet/` rebuilt (new ABIs) — needed for steps 3–4.
- [ ] Note the new run DB name the sim pipeline created (e.g. `degenerus_sepolia_run8`).

## 1. Sync addresses + deploy blocks (automated)
From `website/`:
```bash
node db/sync-deployment.mjs            # dry-run: shows every address/block delta
node db/sync-deployment.mjs --write    # apply
```
Rewrites, from the manifest, only keys already present in each file:
- `app/app/chain-config.sepolia.js` — CONTRACTS addresses
- `beta/app/constants.js` — CONTRACTS addresses
- `db/deployment.json` — addresses + `deployBlock` (= GAME block) + `chainId`
- `database/src/config/contracts.ts` — `SEPOLIA_CONTRACTS` addresses + per-contract `deployBlock`

Then eyeball the report-only fields the script prints (`deployer`, `vrfCoordinator`,
`deployDayBoundary`) and, **by hand**, the source note in `db/deployment.json` and the
`ETH_DIVISOR` in `chain-config.sepolia.js` (a scaling decision, not from the manifest —
only changes if the deploy changed the /1M testnet scaling).

## 2. Point the API/indexer at the new run DB
Edit `database/.env`:
- [ ] `DATABASE_URL` → new run DB (e.g. `...localhost:5432/degenerus_sepolia_run8`).
      **This is the current cold-start cause** — a stale `DATABASE_URL` makes the
      port-3000 API 500 and the page falls back to "no jackpots yet."
- [ ] `RPC_URL` / `CHAIN_ID` — only if the endpoint or network changed.

## 3. Diff ABIs, THEN re-vendor (automated gate — order matters)
`abi:diff` compares the new `forge-out-testnet` against the **currently-vendored**
`database/abis/`, so run it **before** `sync-abis.mjs` overwrites them (otherwise the
diff is a no-op and real changes are hidden). From `database/`:
```bash
npm run abi:diff               # writes .planning/audits/ABI-DIFF-<ISO>.md; verdict IGNORE = no drift
node scripts/sync-abis.mjs     # THEN adopt: vendors abis/*.json (+ storage-layouts) from forge-out
```
- [ ] Read the report. Verdict `IGNORE` / "no drift" → **skip step 4.**
- [ ] Any added/removed/changed **event or field** → step 4 (the only part a script can't do).
      (Changed *function* signatures are non-blocking for the indexer but still matter for
      the app's inline ABIs — see step 4.)

## 4. Code changes (ONLY if step 3 shows event/signature changes)
Drive this from the abi:diff report. For each changed/renamed/added event:
- [ ] Indexer handler `database/src/handlers/<area>.ts` — arg names + decode.
- [ ] Event→handler map in `database/src/handlers/index.ts`.
- [ ] DB schema `database/src/db/schema/*.ts` + a new drizzle migration if columns change.
- [ ] API route(s) in `database/src/api/routes/*.ts` if the served shape changes.
- [ ] App inline ABIs — the /app uses per-function minimal ABIs, not a bundled file.
      Grep the changed function/event names: `grep -rn "<Name>" website/app/app website/app/components`.
      Known spots: `claims.js` (redeemFlip, claim*), `lootbox.js`/`decimator.js` (purchase),
      `degenerette.js` (placeDegeneretteBet/resolveDegeneretteBets), `coinflip.js`.

## 5. Recreate + migrate + re-index the DB
From `database/`:
```bash
# create the run DB if the sim pipeline didn't (psql/createdb), then:
npm run db:push        # apply drizzle schema (or db:generate + push for a new migration)
npm run dev            # indexer — backfills from each contract's deployBlock forward
```
`db:push` (and `db-init-sepolia.ts`, which runs `drizzle-kit push --force`) reads the
schema list in `drizzle.config.ts`, so a FRESH run DB gets every table including
`pool_ticker_samples` (the gold-rush headline ticker). To add it to an EXISTING run DB
without a whole-schema diff, apply the hand-written migration instead:
```bash
node scripts/apply-sql.mjs drizzle/0022_gold_rush_ticker.sql
```
The indexer checks for that table once at startup, so it needs a restart afterwards —
it logs `Gold-rush headline ticker enabled` when the table is present and a `run
db:push` warning when it isn't. `npx tsx src/cli/sample-pool-ticker.ts` takes a sample
by hand if you want `/game/jackpot/gold-rush` serving `ready:true` before then.
- [ ] Wait for `indexer_cursor.lastProcessedBlock` to reach chain head
      (`SELECT * FROM indexer_cursor;`).

## 6. (Re)start the API and confirm it serves live data
From `database/`:
```bash
npm run dev:api        # or `npm run build && npm run api`
```
```bash
curl -s localhost:3000/game/state | head -c 300
curl -s localhost:3000/game/jackpot/last-day | head -c 300   # 200, not 500
curl -s localhost:3000/game/jackpot/gold-rush | head -c 300  # ready:true once sampled
```

## 7. Verify the page end-to-end
The static site is served on :8000/:8080; the app reads the API at
`localhost:3000` (`beta/app/constants.js` API_BASE). Headless screenshot
(fakeDOM/tests can't see CSS or live data):
```bash
google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1200,2600 --screenshot=/tmp/app-verify.png "http://localhost:8000/app/"
```
- [ ] Gold-rush headline shows a non-zero ETH number with a `block N` stamp, and the
      number changes across two screenshots ~10s apart (the per-block ticker is live).
- [ ] Jackpot hero shows the current day (not "Game starts soon").
- [ ] BUY TICKETS shows a live `ETH / ticket` price.
- [ ] Balances strip + tickets inventory populate for a known player.
- [ ] Component tests still green: `cd website && node --test app/components/__tests__/*.test.js`

## Rollback
Config is git-tracked in two repos. To revert step 1/2 edits:
```bash
cd website  && git checkout -- app/app/chain-config.sepolia.js beta/app/constants.js db/deployment.json
cd database && git checkout -- src/config/contracts.ts .env
```
The prior manifest is kept at `degenerus-sim/.testnet/sepolia-manifest.prev.json`; re-run
`node db/sync-deployment.mjs --manifest <that> --write` to roll addresses back.

## Coupling map (what a redeploy touches)
| Layer | File | Auto by step 1? |
|---|---|---|
| App | `app/app/chain-config.sepolia.js` | ✅ addresses |
| App | `beta/app/constants.js` | ✅ addresses |
| Mirror | `db/deployment.json` | ✅ addr + block + chainId |
| Indexer | `database/src/config/contracts.ts` | ✅ addr + per-contract block |
| Indexer | `database/abis/*.json` | ❌ step 3 (`sync-abis.mjs`) |
| Indexer | `database/.env` DATABASE_URL | ❌ step 2 (manual) |
| Indexer | `handlers/`, `db/schema/`, `api/routes/` | ❌ step 4 (only if ABI diff) |
| App | inline ABIs in `app/app/*.js` | ❌ step 4 (only if ABI diff) |

---

## 8. Fly production cutover (degenerus-db + degener.us)

Steps 1–7 above are the LOCAL loop. Production is three separate deploys, and
the order matters: schema, then indexer, then site.

### 8.1 Reset the production DB for the new run

The Fly deploy does NOT run `db:push` — schema changes reach production only
by hand. From `database/`, with a proxy open
(`flyctl proxy 15432:5432 -a degenerus-pg`) and
`DATABASE_URL=postgres://degenerus_db:<pw>@127.0.0.1:15432/degenerus_db`:

```bash
psql -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
npx drizzle-kit push --force        # rebuilds tables + the 6 matviews + indexes
```

⛔ **RE-GRANT `api_readonly` AFTER EVERY SCHEMA DROP.** The API connects as
`api_readonly`, and `DROP SCHEMA` destroys every grant it holds. The failure is
misleading: the lag-guard's fence read fails closed, so all data routes answer
`503 Maintenance in progress — derived state is being rewritten` while the
indexer is perfectly healthy. Symptom to match: `permission denied for table
indexer_cursor` in the api logs.

```sql
GRANT USAGE ON SCHEMA public TO api_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO api_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO api_readonly;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM api_readonly;
```

(`scripts/setup-readonly-role.sql` holds the same grants but names the database
`degenerus`, not `degenerus_db` — the GRANT CONNECT line needs editing, or run
the four statements above directly.)

A fresh `db:push` also drops the two indexes that exist only in
`drizzle/0034_reveal_feed_indexes.sql` (they are not boot-ensured). Re-add with
`node scripts/apply-sql.mjs --no-transaction drizzle/0034_reveal_feed_indexes.sql`.

### 8.2 Deploy the indexer/API

```bash
cd database && flyctl deploy --ha=false
```

An empty `indexer_cursor` makes the indexer backfill from the lowest
`deployBlock` in `SEPOLIA_CONTRACTS`, which is what a new run wants.

Verify: `/health` should show `indexedBlock` climbing past the new deployBlock.
⛔ `/health` looking perfect proves nothing on its own — an indexer still
configured for the PREVIOUS run sits at chain tip with `lagSeconds: 1` and
indexes zero events, because it is filtering for addresses that no longer emit.
Confirm with a row count:
`SELECT count(*), min("blockNumber") FROM raw_events;`

### 8.3 Publish the site

```bash
git worktree add /tmp/deploy-ui deploy-ui     # prune first if stale
rsync -a --delete \
  --exclude='.git' --exclude='node_modules' \
  --exclude='/theory/' --exclude='/affiliates/' --exclude='/learn/' \
  --exclude='/whitepaper/' --exclude='/index.html' --exclude='/.planning/' \
  --exclude='/_sketch/' --exclude='/design/' \
  ./ /tmp/deploy-ui/
cd /tmp/deploy-ui && git add -A && git commit && git push origin deploy-ui:main
```

⛔ **Anchor every exclude with a leading `/`.** Unanchored `--exclude='index.html'`
matches at EVERY level, so it silently drops `app/index.html` too — the app ships
with its stylesheets and custom elements unmounted, which looks like a broken
build rather than a bad exclude.

⛔ **`--delete` can revert work.** `deploy-ui` is based on `origin/main`; if main
carries commits the local tree predates, the sync silently reverts them. Check
before committing:

```bash
git log --name-only --pretty=format: origin/main ^HEAD | sort -u > /tmp/origin_only.txt
comm -12 <(cd /tmp/deploy-ui && git status --short | grep '^ M' | awk '{print $2}' | sort) /tmp/origin_only.txt
```

Any overlap means a file the sync would roll back. Verify direction by grepping
a distinctive added line from the newest origin/main commit against the local
tree before publishing.

### 8.4 Verify live

```bash
curl -s https://degenerus-db.fly.dev/health
curl -s https://degenerus-db.fly.dev/records
curl -s "https://degener.us/app/app/chain-config.sepolia.js?cb=$RANDOM" | grep -o "GAME: *'0x[0-9a-f]*'"
```

Site JS is `max-age=60`, so propagation is a minute, not the old 4h TTL — but
different edge nodes flip over at different times. Poll several times and
require consistency before calling it done.
