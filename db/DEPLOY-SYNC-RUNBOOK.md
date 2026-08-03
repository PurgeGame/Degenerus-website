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
