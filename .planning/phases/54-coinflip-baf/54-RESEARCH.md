# Phase 54: Coinflip & BAF Leaderboards - Research

**Researched:** 2026-04-24
**Domain:** Vanilla Custom Element hydration for two read-only leaderboard panels sharing a common day/level-aware fetch shape
**Confidence:** HIGH on frontend patterns + endpoint shapes (live and verified); HIGH on SHELL-01 transitive audit (both beta components are wallet-tainted, CONTEXT D-02 pattern-match-only is correct); MEDIUM on INTEG-05 backend algorithm (needs a per-player BAF-score path that is not served by the `mv_baf_top4` view)

## Summary

Phase 54 replaces two Phase 50 skeletons (`<coinflip-panel>` 41 LOC, `<baf-panel>` 41 LOC) with hydrated leaderboards that render read-only data from three API paths: two existing `/leaderboards/*` endpoints (COINFLIP-02, BAF-02) and one new per-player BAF-score endpoint INTEG-05 (BAF-01, BAF-03). The per-player coinflip state (COINFLIP-01, COINFLIP-03) is already live in the extended `/player/:address` response block `coinflip: { depositedAmount, claimablePreview, autoRebuyEnabled, autoRebuyStop, currentBounty, biggestFlipPlayer, biggestFlipAmount }` shipped by INTEG-02 in Phase 51.

**No new helper modules required.** Coinflip and BAF leaderboards are two independent systems; a shared fetch helper is structurally unjustified (different query params, different cadences, different refresh triggers). Each panel owns its own stale-guard counter and fetch method. That said, a single `play/app/leaderboards-fetch.js` thin wrapper over the two `/leaderboards/*` endpoints is optional polish if the planner wants symmetry with Phase 52's `tickets-fetch.js`; see Section 10 tradeoff discussion.

The phase is hard-gated on INTEG-05 (backend endpoint in database repo). Both beta reference components (`coinflip-panel.js` at 352 LOC, `baf-panel.js` at 171 LOC) import wallet-tainted modules (`../app/coinflip.js` imports `ethers` directly; `../app/utils.js` imports `ethers` at line 3; `../app/baf.js` imports from `../app/utils.js`). CONTEXT D-02 "pattern-match only, don't import" is the right call. Section 6 documents the full transitive graph.

Frontend risk is LOW. The gold-standard template is `play/components/profile-panel.js` (418 LOC) which already ships the INTEG-02 fetch path returning the `coinflip` block. Phase 54 re-fetches the same endpoint for COINFLIP-01 / COINFLIP-03 if the panel wants to read freshly, or it reads via a shared per-player cache if the planner wires one (see Section 11). Prominence styling for BAF top-4 is a tiny CSS additive surface (beta/styles/baf.css is 80 LOC; Phase 54 mirrors the 20-LOC prominence+rank-1 block).

**Primary recommendation:** Wave 0 ships (1) INTEG-05-SPEC.md authored in the Phase 54 directory using Phase 51's INTEG-02-SPEC.md as the template, (2) `play-coinflip-panel.test.js` and `play-baf-panel.test.js` contract-grep harnesses (~25 assertions each; ~10 more for shared helper if adopted), (3) REQUIREMENTS.md edit marking INTEG-04 deferred with a ROADMAP reference. Wave 1 (pre-backend, but COINFLIP-02 + BAF-02 are already live so most of this ships live) evolves both panels from Phase 50 stubs to fully hydrated: coinflip-panel reads `/leaderboards/coinflip?day=N` + extended `/player/:address?day=N` coinflip block; baf-panel reads `/leaderboards/baf?level=N` + the current `game.level`. BAF-01 + BAF-03 hydrate in Wave 2 once INTEG-05 ships. Wave 3 (optional UAT) validates prominence styling, rank-change rendering, and selected-player highlighting.

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-10)

**Panel structure**
- **D-01** Two Custom Elements: `<coinflip-panel>` + `<baf-panel>` (evolve Phase 50 stubs). No combined panel.

**Beta reuse strategy**
- **D-02** Reuse beta styling via pattern-match (no import). beta/components/coinflip-panel.js + baf-panel.js are visual reference only; don't import because they may be wallet-tainted (Section 6 confirms they are).

**Endpoints**
- **D-03** Leaderboard fetches use the two existing `/leaderboards/*` endpoints (COINFLIP-02, BAF-02). No new endpoint for these.
- **D-04** Per-player BAF score needs INTEG-05 (new endpoint): `GET /player/:address/baf?level=N` -> `{ level, player, score, rank, totalParticipants, roundStatus: 'open' | 'closed' }`.
- **D-05** COINFLIP-01 + COINFLIP-03 read from the extended `/player/:address` response's `coinflip` block (already shipped in Phase 51 INTEG-02).

**Rendering**
- **D-06** BAF top-4 prominence styling: rank 1 = gold prominent, rank 2 = silver, rank 3 = bronze, rank 4 = regular. Non-top-4 player: "You: rank N" row below the leaderboard.
- **D-07** Coinflip leaderboard is a simple sortable table (rank, player, score). No prominence for coinflip.
- **D-08** Bounty display sits above the coinflip leaderboard (COINFLIP-03). Reads from the coinflip block per D-05.
- **D-09** BAF round status label from INTEG-05's `roundStatus` field, or derive from `game.phase === 'PURCHASE'` when INTEG-05 is live.

**Scope**
- **D-10** INTEG-04 (coinflip recycle history) deferred. Document as deferred in REQUIREMENTS.md.

### Claude's Discretion

- Leaderboard refresh cadence: locked to scrubber change (no polling)
- Non-top-4 rank row layout: "You: rank N of M" below the leaderboard
- Empty state copy: "No coinflip activity for day N" / "BAF round not yet live"
- Selected-player highlighting: aria-current + CSS bold
- Truncated address via `truncateAddress` from `beta/viewer/utils.js`
- Skeleton shimmer matches Phase 51+52 standard
- Test file names follow `play-coinflip-panel.test.js` / `play-baf-panel.test.js` naming
- Whether to introduce a shared `play/app/leaderboards-fetch.js` helper (see Section 10 tradeoff)

### Deferred Ideas (OUT OF SCOPE)

- INTEG-04 (coinflip recycle history) — not blocking; ROADMAP success criterion 5 explicitly permits deferral
- Clickable leaderboard rows to change selected player
- Historical BAF leaderboards (top-4 at past levels beyond current)
- Animated rank changes
- Filter or sort controls
- Showing the full coinflip leaderboard beyond the view's built-in top-10 limit

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COINFLIP-01 | Selected player's coinflip state (deposited amount, claimable preview, auto-rebuy settings) | Section 7 (existing endpoint coinflip block verified), Section 10 (Custom Element structure) |
| COINFLIP-02 | Daily coinflip leaderboard with ranks | Section 7 (existing `/leaderboards/coinflip?day=N` endpoint + live data verified) |
| COINFLIP-03 | Current bounty + biggest-flip-today player + amount | Section 7 (coinflip block fields `currentBounty` + `biggestFlipPlayer` + `biggestFlipAmount`) |
| BAF-01 | Selected player's current BAF score and rank at current level/window | Section 8 (INTEG-05 spec draft) |
| BAF-02 | Top-4 BAF leaderboard with prominence-based styling | Section 7 (existing `/leaderboards/baf?level=N` endpoint), Section 9 (prominence CSS extraction) |
| BAF-03 | Level/window label + open/closed status | Section 8 (INTEG-05 `roundStatus` field + `level` echo) |
| INTEG-05 (hard gate) | Per-player BAF score endpoint | Section 8 (full spec draft with data-source audit) |
| INTEG-04 (deferred) | Coinflip recycle/history endpoint | Section 14 Open Question Q10; marked deferred per CONTEXT D-10 |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Coinflip state (COINFLIP-01 / COINFLIP-03) | Browser | API (database) | The extended `/player/:address?day=N` endpoint returns a `coinflip` block shipped by INTEG-02; the panel reads and renders. No new derivation needed. |
| Coinflip leaderboard (COINFLIP-02) | Browser | API (database) | `/leaderboards/coinflip?day=N` returns top-10 from `mv_coinflip_top10` materialized view. Browser filters the day and renders the table. |
| BAF leaderboard top-4 (BAF-02) | Browser | API (database) | `/leaderboards/baf?level=N` returns top-4 from `mv_baf_top4`. Browser renders the rank-tier table. |
| BAF per-player score (BAF-01) | API (database) | Contracts | INTEG-05 reads `baf_flip_totals` (all players, not just top-4) and derives rank via `ROW_NUMBER()` over totalStake DESC within the level. |
| BAF round status (BAF-03) | API (database) | Contracts | INTEG-05 returns `roundStatus` derived from BAF eligibility (level%10 boundary + coinflip result + `baf_skipped` row). Browser renders the label. |
| Selected-player highlighting in leaderboard rows | Browser | — | CSS-only: `aria-current="true"` when `row.player === state.replay.player` |
| BAF prominence per row | Browser | — | CSS rank-tier classes based on `entry.rank`; see Section 9 |
| Fetch coordination (stale-response guard) | Browser | — | Per-panel fetch-id counter |
| Day-scrub propagation | Browser | — | `subscribe('replay.day')` triggers coinflip-panel #refetch; `subscribe('replay.level')` triggers baf-panel #refetch |
| SHELL-01 wallet-free enforcement | Browser | — | Recursive scan in `play-shell-01.test.js`; no new forbidden paths — pattern-match rule in D-02 keeps play/ clean |

## Reusable Assets Inventory

All paths absolute from `/home/zak/Dev/PurgeGame/website/`. SHELL-01 status detailed in Section 6.

### Direct reuse (import verbatim)

| Path | Purpose | Wallet-Free? | Notes |
|------|---------|--------------|-------|
| `beta/app/store.js` | Reactive Proxy store | YES | Phase 50-52 proven; `state.replay.{day, level, player}` namespace |
| `beta/viewer/utils.js` | `formatEth`, `formatBurnie`, `truncateAddress`, `formatWei` | YES (explicit SHELL-01 comment at line 2) | Already used by play/ (profile-panel uses it transitively via play/app/quests.js) |
| `play/app/constants.js` | `API_BASE` + badge constants | YES | Already used by profile-panel.js + tickets-fetch.js |

### Pattern-only (DO NOT import; wallet-tainted per Section 6)

| Path | Role | LOC | What To Copy |
|------|------|-----|--------------|
| `beta/components/coinflip-panel.js` | Visual reference for layout | 352 | Panel-header + bounty-tracker + claim-section shape; write-mode sections (deposit, auto-rebuy, claim buttons) are out-of-scope for play/ (read-only) |
| `beta/components/baf-panel.js` | Visual reference for layout + prominence | 171 | Full structure: skeleton → context (next BAF level) → player-score → leaderboard (4 entries). Prominence via `data-prominence` attr + tier colors per `.baf-entry:nth-child(1)` |
| `beta/app/baf.js` | Helper — context-computation logic | 78 | `bafContext(level)` is a pure function (wallet-free internally but the module imports `../app/utils.js` which is wallet-tainted; re-implement locally). Lines 53-68 are a direct copy target. |
| `beta/app/coinflip.js` | Helper — multiplier-tier logic | 98 | `getMultiplierTier(rewardPercent)` is pure wallet-free code (ll. 78-90); safe to re-implement in play/ |
| `beta/styles/coinflip.css` | Visual reference | 208 | Table styling, section layout. Most rules assume the write-mode input/button UI which play/ doesn't need. Extract table/header/bounty rules only. |
| `beta/styles/baf.css` | Visual + prominence reference | 80 | Copy entire file's essence into `play.css` under `.play-baf-panel` scope. Section 9 extracts. |

### New helper modules (optional)

| Target | Why | LOC est |
|--------|-----|---------|
| `play/app/leaderboards-fetch.js` (optional) | Thin wrapper over the two `/leaderboards/*` endpoints. If adopted, gives symmetry with Phase 52's `tickets-fetch.js`. If not, each panel calls `fetch()` directly. | ~30 |
| `play/app/baf.js` (optional) | Re-implement `bafContext(level)` + `formatBafScore(scoreStr)` wallet-free. Needed because beta's `beta/app/baf.js` imports `utils.js` which imports ethers. Alternative: inline the 15 LOC of `bafContext` directly inside `<baf-panel>`. | ~25 |

**Recommendation:** Skip `play/app/leaderboards-fetch.js` unless the planner wants parity with Phase 52. Each panel has its own dedicated endpoint and its own stale-guard; the wire-dedup rationale that justified `tickets-fetch.js` (two panels sharing the SAME fetch) doesn't apply here.

**Recommendation:** Inline `bafContext` inside `<baf-panel>` (saves a file and makes the logic locally readable). If Wave 2 adds reuse from elsewhere (future BAF-related panels), extract then. 15 LOC of inline derivation doesn't warrant a file.

### Files that MUST NOT be imported by play/ (SHELL-01)

| Forbidden | Why |
|-----------|-----|
| `beta/components/coinflip-panel.js` | Already in SHELL-01 forbidden list (`play-shell-01.test.js:29`) — registers `customElements.define('coinflip-panel', ...)` which would collide with play's own. Also transitively wallet-tainted via `beta/app/coinflip.js` → ethers. |
| `beta/components/baf-panel.js` | Transitively wallet-tainted via `beta/app/baf.js` → `beta/app/utils.js` → ethers. NOT currently in `play-shell-01.test.js` forbidden list — Wave 0 should ADD it to be safe. See Section 13 Pitfall 5. |
| `beta/app/coinflip.js` | `import { ethers } from 'ethers'` at line 4 — direct wallet taint |
| `beta/app/baf.js` | Imports `beta/app/utils.js` which imports ethers |
| `beta/app/utils.js` | Imports ethers at line 3 |
| `beta/app/contracts.js` | ethers |
| `beta/app/wallet.js` | EIP-6963 |

## SHELL-01 Transitive Audit (Answer to Q1)

**Question:** Before assuming CONTEXT D-02's "pattern-match only" is a precaution, verify whether `beta/components/coinflip-panel.js` and `beta/components/baf-panel.js` actually have wallet-tainted imports. Answer: BOTH are tainted.

### coinflip-panel.js transitive graph

Source: `beta/components/coinflip-panel.js:5-15`

```
beta/components/coinflip-panel.js
├── ../app/store.js               [WALLET-FREE]
├── ../app/coinflip.js            [TAINTED]
│   ├── ethers (bare specifier)             [WALLET TAINT]
│   ├── ./contracts.js                      [TAINTED via ethers line 5]
│   ├── ./store.js                          [WALLET-FREE]
│   ├── ./constants.js                      [WALLET-FREE]
│   └── ./api.js                            [WALLET-FREE]
├── ../app/api.js                 [WALLET-FREE — fetchPlayerData itself is safe]
├── ../app/utils.js               [TAINTED — line 3: import { ethers }]
└── ../app/constants.js           [WALLET-FREE]
```

**Conclusion — HIGH confidence:** `beta/components/coinflip-panel.js` is transitively wallet-tainted via TWO paths (`coinflip.js` and `utils.js`). Even after a D-09-style 1-line patch to swap `utils.js` for `viewer/utils.js`, the `coinflip.js` dependency still imports ethers directly because the component needs write-side functions (`depositCoinflip`, `claimCoinflips`, `setAutoRebuy`) that Phase 54 play/ does NOT need.

**Implication:** CONTEXT D-02 is correct. Do NOT import `beta/components/coinflip-panel.js` directly. Pattern-match the markup. The write-mode sections (lines 45-101 of the beta file: stake input, deposit button, claim button, auto-rebuy toggle) are out-of-scope for play/ which is read-only.

### baf-panel.js transitive graph

Source: `beta/components/baf-panel.js:5-7`

```
beta/components/baf-panel.js
├── ../app/store.js               [WALLET-FREE]
├── ../app/baf.js                 [TAINTED via imports]
│   ├── ./store.js                          [WALLET-FREE]
│   ├── ./api.js                            [WALLET-FREE]
│   └── ./utils.js                          [TAINTED — imports ethers]
└── ../app/utils.js               [TAINTED — line 3: import { ethers }]
```

**Verification commands run at research time:**

```bash
grep -n "^import" beta/components/coinflip-panel.js beta/components/baf-panel.js
grep -n "ethers" beta/app/{coinflip,baf,utils,contracts}.js
```

**Conclusion — HIGH confidence:** `beta/components/baf-panel.js` is transitively wallet-tainted via `beta/app/baf.js` → `beta/app/utils.js` → ethers. A 1-line-patch approach (like Phase 52 D-09 for jackpot-panel) would only partially work: `beta/components/baf-panel.js` imports `../app/utils.js` DIRECTLY at line 7 (for `truncateAddress`), AND transitively via `beta/app/baf.js` which imports `../app/utils.js` for `formatEth`. Two swaps would be needed, and even then the component would compete with play's `customElements.define('baf-panel', ...)` at the registry level.

**Implication:** Pattern-match only (CONTEXT D-02). Extract CSS (Section 9) + layout structure (Section 10) + `bafContext` helper logic (Section 7). Do not import.

### Wave 0 guardrail update

Current `play/app/__tests__/play-shell-01.test.js:22-31` forbidden list:

```javascript
const FORBIDDEN = [
  { label: "bare 'ethers' specifier", pattern: /from\s+['"]ethers['"]/ },
  { label: 'beta/app/wallet.js', pattern: /from\s+['"][^'"]*\/beta\/app\/wallet\.js['"]/ },
  { label: 'beta/app/contracts.js', pattern: /from\s+['"][^'"]*\/beta\/app\/contracts\.js['"]/ },
  { label: 'beta/app/utils.js (ethers-tainted at line 3)', pattern: /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/ },
  { label: 'beta/components/connect-prompt.js', pattern: /.../ },
  { label: 'beta/components/purchase-panel.js', pattern: /.../ },
  { label: 'beta/components/coinflip-panel.js', pattern: /.../ },          // ALREADY LISTED
  { label: 'beta/components/decimator-panel.js', pattern: /.../ },
];
```

**Wave 0 addition proposal:** Add `beta/components/baf-panel.js` to the forbidden list. Also add `beta/app/coinflip.js` and `beta/app/baf.js` because those are the modules that would allow a lazy dev to "just import the helpers". Keeping play/ strictly isolated from beta's ethers-coupled helpers is the discipline.

Proposed new entries (Wave 0 test-file edit):

```javascript
  { label: 'beta/components/baf-panel.js (transitively tainted)', pattern: /from\s+['"][^'"]*\/beta\/components\/baf-panel\.js['"]/ },
  { label: 'beta/app/coinflip.js (ethers at line 4)', pattern: /from\s+['"][^'"]*\/beta\/app\/coinflip\.js['"]/ },
  { label: 'beta/app/baf.js (transitively tainted via utils.js)', pattern: /from\s+['"][^'"]*\/beta\/app\/baf\.js['"]/ },
```

## Existing Endpoint Actual Shapes (Answer to Q2, Q3)

### `/leaderboards/coinflip?day=N` (COINFLIP-02 — live)

**Handler:** `database/src/api/routes/leaderboards.ts:13-37`
**Schema:** `database/src/api/schemas/leaderboard.ts:9-11`
**Data source:** `mv_coinflip_top10` materialized view (`database/src/db/schema/views.ts:45-56`), ROW_NUMBER partitioned by day over `coinflip_leaderboard` where rank ≤ 10

**Query schema:**
```typescript
export const coinflipQuerySchema = z.object({
  day: z.coerce.number().int().optional(),
});
```

**Response schema (VERIFIED via live call 2026-04-24):**
```json
{
  "entries": [
    { "player": "0xfabb0ac9d68b0b445fb7357272ff202c5651694a", "score": "52875", "rank": 1, "day": 64 },
    { "player": "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65", "score": "43590", "rank": 2, "day": 64 },
    { "player": "0x90f79bf6eb2c4f870365e785982e1f101e93b906", "score": "9103", "rank": 3, "day": 64 },
    ...
  ]
}
```

**Live verification** (from `curl http://localhost:3000/leaderboards/coinflip?day=64`):
- 5 entries for day 64 (fewer than 10 because only 5 players staked that day)
- Scores are **NOT ETH wei** — they are small integers representing BURNIE-denominated stakes (e.g., 52875 = 52,875 BURNIE at whatever base unit the contract uses; verify exact unit below).

**⚠ SCORE UNIT AMBIGUITY:** The `coinflip_leaderboard.score` field is a `text` column populated by `handleCoinflipTopUpdated(ctx)` from the `CoinflipTopUpdated(uint32 day, address player, uint256 score)` event. Looking at `/leaderboards/coinflip?day=64` the scores are small (order 10^4-10^5). BURNIE has 18 decimals; if these were 18-decimal wei values they'd be order 10^22. Therefore the scores appear to be in whole-BURNIE units OR the emit site uses a scaled value. **Planner action:** verify by reading `DegenerusCoinflip.sol` emit site. Plausible: the event emits `score` as a cumulative count of flips or BURNIE in non-wei units. This doesn't block the plan — whatever the unit is, the rendering just calls `formatBurnie(score)` or equivalent and the tests grep for the string. Worth flagging in Wave 1 verification.

**Day-awareness:** The `?day=N` query filters to that day only. Omit the query to get all days concatenated (rarely useful; Phase 54 ALWAYS supplies the day). The route is NOT block-scoped — it reads from the current materialized view, which is "latest state" at view-refresh time. Acceptable because past-day leaderboards are immutable once the day ends (no retroactive ranking changes).

**Behavior when no data:** Returns `{ entries: [] }` (200 OK with empty array). Verified: `curl /leaderboards/coinflip?day=999` returns `{"entries":[]}`.

### `/leaderboards/baf?level=N` (BAF-02 — live)

**Handler:** `database/src/api/routes/leaderboards.ts:65-89`
**Schema:** `database/src/api/schemas/leaderboard.ts:17-19`
**Data source:** `mv_baf_top4` materialized view (`database/src/db/schema/views.ts:77-88`), ROW_NUMBER partitioned by level over `baf_flip_totals` where rank ≤ 4

**Query schema:**
```typescript
export const levelQuerySchema = z.object({
  level: z.coerce.number().int().optional(),
});
```

**Response schema (VERIFIED via live call 2026-04-24):**
```json
{
  "entries": [
    { "player": "0xdf37f81daad2b0327a0a50003740e1c935c70913", "score": "475215212469240581904067", "rank": 1, "level": 20 },
    { "player": "0xbda5747bfd65f08deb54cb465eb87d40e51b197e", "score": "393272024632502650002089", "rank": 2, "level": 20 },
    { "player": "0xfabb0ac9d68b0b445fb7357272ff202c5651694a", "score": "290196071359350405981754", "rank": 3, "level": 20 },
    { "player": "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc", "score": "285520331473575661824166", "rank": 4, "level": 20 }
  ]
}
```

**Live verification** (from `curl http://localhost:3000/leaderboards/baf?level=20`):
- 4 entries at level 20 (exactly top-4 per view's rank ≤ 4 constraint)
- Scores ARE wei-scale BURNIE (e.g., 475215212469240581904067 ≈ 475,215 BURNIE at 18 decimals). This is consistent with `bafFlipTotals.totalStake` from `baf_flip_totals` which stores wei-denominated cumulative stakes.

**Level-awareness:** The `?level=N` query filters to that level only. Omit the query → concatenated across all levels (rarely useful; Phase 54 always supplies a level).

**Behavior when no data:** Returns `{ entries: [] }` (200 OK). Verified: `curl /leaderboards/baf?level=1` returns `{"entries":[]}` (BAF jackpots only fire at level % 10 == 0, so non-multiple-of-10 levels have no entries).

### `/player/:address?day=N` coinflip block (COINFLIP-01 + COINFLIP-03 — live)

**Handler:** `database/src/api/routes/player.ts:373-408`
**Schema:** `database/src/api/schemas/player.ts:59-67`
**Data source:**
- `coinflipDailyStakes` for `depositedAmount` (latest day's stake)
- `summary.claimableEth` (player_winnings view) for `claimablePreview`
- `coinflipSettings` for `autoRebuyEnabled` + `autoRebuyStop`
- `coinflipBountyState` (singleton row id=1) for `currentBounty` + `biggestFlipPlayer` + `biggestFlipAmount`

**Response schema (VERIFIED by reading Phase 51 schema + live call):**

```typescript
coinflip: z.object({
  depositedAmount: z.string(),
  claimablePreview: z.string(),
  autoRebuyEnabled: z.boolean(),
  autoRebuyStop: z.string(),
  currentBounty: z.string(),
  biggestFlipPlayer: z.string().nullable(),
  biggestFlipAmount: z.string(),
}).nullable()
```

**Live verification** (from `curl http://localhost:3000/player/0x71be63f3384f5fb98995898a86b02fb2426c5788?day=64`):

```json
"coinflip": {
  "depositedAmount": "200000000000000000000",     // 200 BURNIE wei-encoded
  "claimablePreview": "1",                         // 1 wei claimable
  "autoRebuyEnabled": true,
  "autoRebuyStop": "10000000000000000000",         // 10 BURNIE
  "currentBounty": "0",                            // no bounty armed
  "biggestFlipPlayer": null,                       // no biggest-flip record yet
  "biggestFlipAmount": "0"
}
```

**All six CONTEXT D-05 fields are present.** No scope gap. The panel reads these directly from the `/player/:address?day=N` response and renders via `formatBurnie()` for amounts and `truncateAddress()` for `biggestFlipPlayer`.

**Per-day behavior:** When `?day=N` is supplied, the handler scopes the quest/streak/dailyActivity blocks to that day but currently does NOT filter the coinflip block by day — it returns the player's LATEST coinflip state regardless of `day` (because `coinflipDailyStakes` is keyed by (player, day) uniquely and the handler sorts by day DESC and takes the latest). `coinflipSettings` is "current state" per-player. `coinflipBountyState` is a singleton. **This may not be what we want for a day-scrubbed view.**

**Scope implication:** For COINFLIP-01, showing "latest state" instead of "end-of-day-N state" is arguably correct — the player IS the player now, regardless of which day the scrubber is on. For COINFLIP-03 (bounty + biggest-flip), the bounty state naturally reflects "latest". But `depositedAmount` at day N should ideally reflect the stake for day N specifically, which the current code does (via `sortedStakes[0]` where `[0]` is the latest day). If the selected day N is in the past, the current code returns the most-recent stake regardless, which may be misleading.

**Recommended scope answer:** For Phase 54 Wave 1, accept the existing behavior (latest-state for all coinflip block fields). If UAT reveals that the day-scrubber needs day-scoped coinflip state (e.g., "what did I stake on day 64?"), open a follow-up; this is not in Phase 54 scope. Document in open questions (Section 14 Q1).

## INTEG-05 Endpoint Spec Draft (Answer to Q4)

**This section is the Wave 0 INTEG-05-SPEC.md content.** The planner materializes this as `.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md` in Wave 0 using Phase 51's INTEG-02-SPEC.md (217 LOC) as the structural template.

### Why This Endpoint Is Needed

BAF-01 requires showing "selected player's BAF score and rank at current level/window". `/leaderboards/baf?level=N` returns only the top-4 per level (by design: `mv_baf_top4` has a `WHERE rank <= 4` filter). Any player outside the top-4 needs a separate lookup: their BAF score AND their rank relative to all participants in the level.

BAF-03 requires showing "whether the round is open or closed". The round status is a combination of: (1) did BAF-eligibility hit (level % 10 == 0)? (2) did the coinflip on the advance day win? (3) has the jackpot distribution already run? Deriving this purely from `game.phase` in the frontend is unreliable — the backend has the authoritative state via `baf_skipped` events + jackpot-distribution history.

A new endpoint class is cleanest: it doesn't pollute `/player/:address` (which is already one of the largest dashboard endpoints), and it keeps the BAF-specific indexing logic colocated with BAF data.

### Endpoint

`GET /player/:address/baf?level=N`

### Path Parameters

- `:address` — 42-char `0x...` Ethereum address, lowercased (same validation pattern as existing routes via `addressParamSchema`)

### Query Parameters

- `level` (required, integer, ≥ 1) — BAF level. Not optional because the view is per-level; there is no meaningful "no level" state. If omitted, return 400 or treat as current game level.

**Recommendation:** Require `level`. Phase 54 frontend ALWAYS supplies it (from `state.replay.level`). Reject missing with 400.

**Alternative:** Accept `day` instead of `level` (backend resolves day → level via `daily_rng`). Pro: matches Phase 51's `?day=N` pattern. Con: BAF is level-scoped not day-scoped (a level spans ~5 days), so `?day=N` maps to a single level but the inverse (one level → one day) is lossy. Wave 2 could support both: `?level=N` (primary) OR `?day=M` (resolve to level). For INTEG-05 v1, ship `?level=N` only; add `?day=M` later if needed.

### Response JSON Schema

```json
{
  "level": 20,                             // echo of ?level=N
  "player": "0x71be63f3384f5fb98995898a86b02fb2426c5788",
  "score": "344863111573291904385281",     // wei-encoded BURNIE (same scale as /leaderboards/baf)
  "rank": 7,                                // 1-indexed rank within the level; null if player has no BAF stake at this level
  "totalParticipants": 42,                  // count of DISTINCT players with totalStake > 0 at this level
  "roundStatus": "open"                     // "open" | "closed" | "skipped" | "not_eligible"
}
```

**Edge cases:**

| Condition | `score` | `rank` | `totalParticipants` | `roundStatus` |
|-----------|---------|--------|---------------------|---------------|
| Player has BAF stake at this level | "123..." | 1..N | N | "open" / "closed" / "skipped" |
| Player has ZERO BAF stake at this level | "0" | null | N (others exist) | whatever the level's status is |
| Level has no BAF entries at all (no one staked) | "0" | null | 0 | "open" or "not_eligible" |
| Level is NOT a multiple of 10 (no BAF eligibility) | "0" | null | 0 | "not_eligible" |
| BAF was skipped (coinflip lost on advance day) | "0" or actual | null or rank | N | "skipped" |

### `roundStatus` Derivation

Four states:

1. **`"not_eligible"`** — Level is not a multiple of 10. BAF jackpots only fire at level boundaries where `level % 10 == 0`. Frontend shows a softer label: "BAF active at next level {nextBafLevel}".
2. **`"open"`** — Level % 10 == 0 AND no `baf_skipped` row AND no `jackpot_distributions` row with `awardType IN ('eth_baf', 'tickets_baf')` for this level. Players can still stake.
3. **`"closed"`** — Level % 10 == 0 AND the BAF jackpot has run (there EXISTS a `jackpot_distributions` row with `awardType IN ('eth_baf', 'tickets_baf')` for this level).
4. **`"skipped"`** — Level % 10 == 0 AND `baf_skipped` row exists for this level (coinflip lost on advance day). Contract `DegenerusJackpots.markBafSkipped` emits; handler `handleBafSkipped` at `database/src/handlers/baf-jackpot.ts:53-68` indexes.

Backend pseudo-code:

```sql
IF level % 10 != 0 THEN roundStatus := 'not_eligible'
ELSIF EXISTS (SELECT 1 FROM baf_skipped WHERE level = ?) THEN roundStatus := 'skipped'
ELSIF EXISTS (SELECT 1 FROM jackpot_distributions WHERE level = ? AND awardType IN ('eth_baf', 'tickets_baf')) THEN roundStatus := 'closed'
ELSE roundStatus := 'open'
```

### Contract-Call Map

| Response field | Primary source | Notes |
|----------------|----------------|-------|
| `level` | Query echo | From `?level=N` |
| `player` | Path echo | Validated via `addressParamSchema` |
| `score` | `baf_flip_totals.totalStake` | Filtered by `(player, level)`; returns '0' if no row |
| `rank` | `ROW_NUMBER() OVER (PARTITION BY level ORDER BY CAST("totalStake" AS NUMERIC) DESC)` | Same expression used by `mv_baf_top4`; returns `null` when the player has no row (i.e., zero stake) |
| `totalParticipants` | `SELECT COUNT(*) FROM baf_flip_totals WHERE level = ?` | Count of distinct (player, level) rows at the level |
| `roundStatus` | See "Derivation" above | Three-table query: `baf_skipped`, `jackpot_distributions`, level arithmetic |

### Proposed Backend Implementation

Handler file: extend `database/src/api/routes/player.ts` (where Phase 52 INTEG-01's `/player/:address/tickets/by-trait` already landed).

```typescript
// INTEG-05 (Phase 54): GET /player/:address/baf?level=N
// Returns the player's BAF score and rank at a given level, plus the round status.
fastify.get('/:address/baf', {
  schema: {
    params: addressParamSchema,
    querystring: bafQuerySchema,                       // NEW schema
    response: {
      200: bafPlayerResponseSchema,                    // NEW schema
      400: errorResponseSchema,
    },
  },
}, async (request, reply) => {
  const { address } = request.params;
  const { level } = request.query;

  // --- Score + totalParticipants ---
  // One CTE derives both: ranked row for the player + count window.
  const result = await fastify.db.execute(sql`
    WITH ranked AS (
      SELECT
        player,
        "totalStake",
        ROW_NUMBER() OVER (ORDER BY CAST("totalStake" AS NUMERIC) DESC) AS rank,
        COUNT(*) OVER () AS total_participants
      FROM baf_flip_totals
      WHERE level = ${level}
    )
    SELECT player, "totalStake", rank, total_participants
    FROM ranked
    WHERE player = ${address}
    UNION ALL
    SELECT NULL, '0', NULL, COALESCE((SELECT MAX(total_participants) FROM ranked), 0)
    WHERE NOT EXISTS (SELECT 1 FROM ranked WHERE player = ${address})
    LIMIT 1
  `);

  const row = (result as any).rows?.[0] ?? (result as any)[0];
  const score = row?.totalStake ?? '0';
  const rank = row?.rank != null ? Number(row.rank) : null;
  const totalParticipants = Number(row?.total_participants ?? 0);

  // --- roundStatus derivation ---
  let roundStatus: 'open' | 'closed' | 'skipped' | 'not_eligible';
  if (level % 10 !== 0) {
    roundStatus = 'not_eligible';
  } else {
    const [skipped] = await fastify.db
      .select({ level: bafSkipped.level })
      .from(bafSkipped)
      .where(eq(bafSkipped.level, level));
    if (skipped) {
      roundStatus = 'skipped';
    } else {
      const [distributed] = await fastify.db
        .select({ id: jackpotDistributions.id })
        .from(jackpotDistributions)
        .where(and(
          eq(jackpotDistributions.level, level),
          inArray(jackpotDistributions.awardType, ['eth_baf', 'tickets_baf']),
        ))
        .limit(1);
      roundStatus = distributed ? 'closed' : 'open';
    }
  }

  return {
    level,
    player: address,
    score,
    rank,
    totalParticipants,
    roundStatus,
  };
});
```

### New Schema Definitions

Add to `database/src/api/schemas/player.ts`:

```typescript
// INTEG-05 (Phase 54): GET /player/:address/baf
export const bafQuerySchema = z.object({
  level: z.coerce.number().int().min(1),
});

export const bafPlayerResponseSchema = z.object({
  level: z.number().int(),
  player: z.string(),
  score: z.string(),
  rank: z.number().int().nullable(),
  totalParticipants: z.number().int(),
  roundStatus: z.enum(['open', 'closed', 'skipped', 'not_eligible']),
});
```

### Error Modes

| Status | Condition | Response |
|--------|-----------|----------|
| 200 | Player has BAF stake at level | Full payload with non-null rank |
| 200 | Player has NO BAF stake at level | Full payload, score="0", rank=null, totalParticipants echoes level-wide count |
| 200 | Level has no entries at all | Full payload, all zeros; roundStatus reflects level-eligibility |
| 400 | `level` missing or invalid | `{ statusCode: 400, error: "Bad Request", message: "..." }` (Zod validation handles this) |

### Acceptance Criteria

- Endpoint reachable at `GET /player/:address/baf?level=N`
- `score` matches `mv_baf_top4.score` for the same `(player, level)` if the player is in the top-4
- `rank` is 1 for the top staker at that level, continuing through 1..N
- `rank` is `null` when the player has no row in `baf_flip_totals` at that level (including all players at level % 10 != 0)
- `totalParticipants` equals `COUNT(DISTINCT player)` from `baf_flip_totals WHERE level = :level`
- `roundStatus === 'not_eligible'` when `level % 10 != 0`
- `roundStatus === 'skipped'` when a `baf_skipped` row exists for the level
- `roundStatus === 'closed'` when a BAF `jackpot_distributions` row exists for the level
- `roundStatus === 'open'` otherwise

### Timeline

Same pattern as INTEG-01 (Phase 52) and INTEG-02 (Phase 51) — 3 atomic commits on `database/main`:

1. **Commit 1 — `feat(api): add GET /player/:address/baf endpoint (INTEG-05)`** — handler + schema definitions
2. **Commit 2 — `docs(openapi): document /player/:address/baf (INTEG-05)`** — openapi.json update
3. **Commit 3 — `test(api): cover INTEG-05 happy path, rank null, empty level, not_eligible, skipped, closed`** — Vitest tests

Precedent shipped in 3-5 minutes per Phase 51 INTEG-02 (`d135605`, `dab5adf`, `64fe8db`) and Phase 52 INTEG-01 (`a46fdcb`, `e130547`, `9988887`). Phase 54 INTEG-05 is comparable scope.

### Open Questions (for INTEG-05 spec)

1. **Should `?level=N` or `?day=M` be the primary query?** v1 ships `?level=N` only; defer `?day=M` support.
2. **Should the rank be a dense-rank or row-number?** Tied scores get sequential ranks with row-number (e.g., two players at 100 BURNIE get ranks 1 and 2 by insertion order). Dense-rank would give both rank 1. Backend uses row-number because `mv_baf_top4` already does. Consistency > philosophical correctness; ties are rare in practice.
3. **Should the endpoint echo the player's deposited coinflip amount for bundled coinflip+BAF rendering?** No — separate concern. If the panel needs both, fetch from `/player/:address?day=N` (coinflip block) AND `/player/:address/baf?level=N` (BAF block).

### Confidence

- **HIGH** on the need + path (new endpoint class; no conflict with existing routes)
- **HIGH** on data source (`baf_flip_totals` is the authoritative indexed table; `handleBafFlipRecorded` stores cumulative `totalStake` per `(player, level)` pair)
- **HIGH** on `roundStatus` derivation (3 tables covered: `baf_skipped`, `jackpot_distributions`, level arithmetic)
- **MEDIUM** on the ROW_NUMBER CTE behavior (verified PostgreSQL supports the UNION ALL pattern but exact escape for parameter binding in Drizzle may need adjustment; the database team will finalize at commit time)

## Prominence Styling Extraction from beta (Answer to Q5)

### Source: `beta/styles/baf.css` (80 LOC)

Critical rules (line numbers from source):

**Panel-level prominence via `data-prominence` attribute (lines 1-17):**

```css
.baf-panel {
  transition: border-color 0.3s ease;
}
.baf-panel[data-prominence="high"] {
  border-color: var(--accent-primary);
  border-width: 2px;
}
.baf-panel[data-prominence="medium"] {
  border-color: var(--text-secondary);
}
.baf-panel[data-prominence="low"] {
  opacity: 0.8;
}
```

The prominence is *panel-level* (border + opacity of the ENTIRE panel), not *per-row*. Beta's logic in `bafContext()`:

```javascript
// beta/app/baf.js:58-66
if (levelsUntilBaf <= 3) prominence = 'high';
else if (levelsUntilBaf <= 7) prominence = 'medium';
else prominence = 'low';
```

So the panel "glows" with an accent border as the game approaches the next BAF level (within 3 levels), dims during the middle stretch, and goes to 80% opacity when far from BAF activation. **This is NOT rank-based prominence** — this is *approach-based* prominence (how close the game is to the next BAF).

**CONTEXT D-06 reading check:** CONTEXT says "Top-4 rows get tier-based colors + size: rank 1 = gold prominent, rank 2 = silver, rank 3 = bronze, rank 4 = regular." Beta's CSS does NOT do this explicitly — beta styles rank 1 with `color: var(--accent-primary)` via `:nth-child(1)` (line 65) but does NOT do silver/bronze/regular tiers for ranks 2-4. **CONTEXT D-06 is asking for something slightly NEW relative to beta.**

**Leaderboard row styling (lines 46-73):**

```css
.baf-header {
  display: grid;
  grid-template-columns: 50px 1fr 100px;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 600;
}
.baf-entry {
  display: grid;
  grid-template-columns: 50px 1fr 100px;       /* same 3-col grid */
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border-color);
  font-size: 0.85rem;
}
.baf-entry:nth-child(1) {                       /* rank 1 ONLY */
  color: var(--accent-primary);
  font-weight: 600;
}
.baf-entry .baf-player {
  font-family: monospace;
  font-size: 0.8rem;
}
```

**Context row (next BAF level label, lines 19-25):**

```css
.baf-context {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 0.75rem;
}
```

**Your-score pill (lines 27-38):**

```css
.baf-player-score {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  border-radius: 6px;
  margin-bottom: 1rem;
}
.baf-score-value {
  font-weight: 600;
}
```

**Empty state (lines 75-80):**

```css
.baf-empty {
  padding: 1rem;
  text-align: center;
  color: var(--text-dim);
  font-size: 0.85rem;
}
```

### Proposed `play.css` additions (Phase 54 Wave 1)

Under a `.play-baf-panel` scope (or no scope — single-surface app), add:

```css
/* --- BAF panel (Phase 54) --- */

/* Panel-level prominence — carry over from beta with the same 3-tier data-attr pattern. */
.play-baf-panel {
  transition: border-color 0.3s ease;
}
.play-baf-panel[data-prominence="high"] {
  border-color: var(--accent-primary);
  border-width: 2px;
}
.play-baf-panel[data-prominence="medium"] {
  border-color: var(--text-secondary);
}
.play-baf-panel[data-prominence="low"] {
  opacity: 0.8;
}

/* Context row */
.play-baf-context {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 0.75rem;
}

/* Player score pill */
.play-baf-player-score {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  border-radius: 6px;
  margin-bottom: 1rem;
}
.play-baf-player-score[aria-current="true"] {
  border: 1px solid var(--accent-primary);
}

/* Leaderboard table */
.play-baf-leaderboard {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
}
.play-baf-header {
  display: grid;
  grid-template-columns: 50px 1fr 100px;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 600;
}
.play-baf-entry {
  display: grid;
  grid-template-columns: 50px 1fr 100px;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border-color);
  font-size: 0.85rem;
}

/* --- CONTEXT D-06 tier colors (NEW relative to beta) --- */
/* Rank tier styling by data-rank attribute on each .play-baf-entry */
.play-baf-entry[data-rank="1"] {
  color: #FFD700;                       /* gold */
  font-weight: 700;
  font-size: 0.95rem;                   /* slightly larger than rank 2-4 */
}
.play-baf-entry[data-rank="2"] {
  color: #C0C0C0;                       /* silver */
  font-weight: 600;
}
.play-baf-entry[data-rank="3"] {
  color: #CD7F32;                       /* bronze */
  font-weight: 600;
}
.play-baf-entry[data-rank="4"] {
  color: var(--text-primary);
  font-weight: 500;
}

/* Selected-player highlight */
.play-baf-entry[aria-current="true"] {
  background: var(--bg-tertiary);
  text-decoration: underline;
}

/* Non-top-4 player row below leaderboard (INTEG-05 result) */
.play-baf-your-rank {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  border-radius: 6px;
  border: 1px solid var(--accent-primary);
}

/* Round status label */
.play-baf-round-status {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
}
.play-baf-round-status[data-status="open"] {
  background: rgba(34, 197, 94, 0.15);
  color: var(--success);
}
.play-baf-round-status[data-status="closed"] {
  background: rgba(100, 100, 100, 0.2);
  color: var(--text-dim);
}
.play-baf-round-status[data-status="skipped"] {
  background: rgba(239, 68, 68, 0.15);
  color: var(--error);
}
.play-baf-round-status[data-status="not_eligible"] {
  background: rgba(100, 100, 100, 0.1);
  color: var(--text-dim);
}

/* Player monospace address */
.play-baf-player {
  font-family: monospace;
  font-size: 0.8rem;
}

/* Empty state */
.play-baf-empty {
  padding: 1rem;
  text-align: center;
  color: var(--text-dim);
  font-size: 0.85rem;
}

/* Keep-old-data-dim inheriting Phase 51 pattern */
.play-baf-panel [data-bind="content"].is-stale {
  opacity: 0.6;
  pointer-events: none;
}

/* --- Coinflip panel (Phase 54) --- */

.play-coinflip-bounty {
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin-bottom: 1rem;
  background: var(--bg-secondary);
}
.play-coinflip-bounty-armed {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  background: rgba(100, 100, 100, 0.2);
  color: var(--text-dim);
}
.play-coinflip-bounty-armed[data-armed="true"] {
  background: rgba(239, 68, 68, 0.15);
  color: var(--error);
  animation: armed-pulse 2s ease-in-out infinite;    /* reuse beta's keyframes if already in base.css */
}

.play-coinflip-leaderboard {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
}
.play-coinflip-header,
.play-coinflip-entry {
  display: grid;
  grid-template-columns: 50px 1fr 120px;
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
}
.play-coinflip-header {
  background: var(--bg-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 600;
}
.play-coinflip-entry {
  border-top: 1px solid var(--border-color);
}
.play-coinflip-entry[aria-current="true"] {
  background: var(--bg-tertiary);
  font-weight: 600;
  text-decoration: underline;
}
.play-coinflip-player {
  font-family: monospace;
  font-size: 0.8rem;
}
.play-coinflip-state-row {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
  font-size: 0.85rem;
}

.play-coinflip-panel [data-bind="content"].is-stale {
  opacity: 0.6;
  pointer-events: none;
}
```

**Line count estimate:** ~130 LOC added to `play/styles/play.css`. Compare Phase 52's CSS addition (~200 LOC for card + pack + animations). Reasonable surface.

**Key decision — beta's `@keyframes armed-pulse` (beta/styles/coinflip.css:166-169):** Beta already ships this keyframe. If Phase 54 wants the pulsing armed bounty indicator, it must either (a) copy the keyframe into `play.css` (3 lines), or (b) rely on the `beta/styles/coinflip.css` link in `play/index.html` — but that file is NOT currently linked from play/ (verified: `play/index.html:7-14` links nav, base, panels, buttons, skeleton, viewer, jackpot, play — not coinflip or baf). **Recommendation:** Copy the keyframe. Keeps play/ self-contained.

## Custom Elements Structure (Answer to Q10)

### Recommendation: Two independent Custom Elements, no shared helper required

| Element | Role | Data source | LOC est |
|---------|------|-------------|---------|
| `<coinflip-panel>` | Renders bounty header (COINFLIP-03) above a state section (COINFLIP-01) above a leaderboard table (COINFLIP-02). Subscribes to `replay.player` + `replay.day`. | `/player/:address?day=N` coinflip block + `/leaderboards/coinflip?day=N` | ~220-260 |
| `<baf-panel>` | Renders context row (next BAF level + prominence) above leaderboard top-4 (BAF-02, BAF-03) above a "your rank" row (BAF-01). Subscribes to `replay.player` + `replay.level` + `replay.day`. | `/leaderboards/baf?level=N` + INTEG-05 `/player/:address/baf?level=N` | ~240-280 |

### `<coinflip-panel>` sub-structure

1. **Bounty section (COINFLIP-03, top).** Displays current bounty amount, armed/not-armed indicator, biggest-flip player + amount. Source: extended `/player/:address?day=N` `coinflip` block.
2. **State section (COINFLIP-01, middle).** Displays deposited amount, claimable preview, auto-rebuy toggle state (read-only display), auto-rebuy stop value. Source: same coinflip block.
3. **Leaderboard section (COINFLIP-02, bottom).** Top-10 table with rank, truncated address, score. Source: `/leaderboards/coinflip?day=N`.

**Template shape (skeleton):**

```html
<section data-slot="coinflip" class="panel play-coinflip-panel">
  <div data-bind="skeleton">...shimmer blocks...</div>
  <div data-bind="content" hidden>
    <h2 class="panel-title">Coinflip</h2>

    <!-- COINFLIP-03 bounty -->
    <div class="play-coinflip-bounty" data-bind="bounty">
      <div class="play-coinflip-section-header">Bounty</div>
      <div class="play-coinflip-bounty-armed" data-bind="armed" data-armed="false">NOT ARMED</div>
      <div class="play-coinflip-state-row">
        <span>Pool</span><span data-bind="bounty-pool">0</span>
      </div>
      <div class="play-coinflip-state-row">
        <span>Record flip</span><span data-bind="bounty-record">--</span>
      </div>
      <div class="play-coinflip-state-row">
        <span>Record holder</span><span data-bind="bounty-holder">--</span>
      </div>
    </div>

    <!-- COINFLIP-01 per-player state -->
    <div class="play-coinflip-state">
      <div class="play-coinflip-section-header">Player state</div>
      <div class="play-coinflip-state-row">
        <span>Deposited</span><span data-bind="deposited">0</span>
      </div>
      <div class="play-coinflip-state-row">
        <span>Claimable preview</span><span data-bind="claimable">0</span>
      </div>
      <div class="play-coinflip-state-row">
        <span>Auto-rebuy</span><span data-bind="autorebuy">--</span>
      </div>
      <div class="play-coinflip-state-row">
        <span>Take-profit</span><span data-bind="takeprofit">--</span>
      </div>
    </div>

    <!-- COINFLIP-02 leaderboard -->
    <div class="play-coinflip-leaderboard">
      <div class="play-coinflip-header">
        <span>Rank</span><span>Player</span><span>Score</span>
      </div>
      <div class="play-coinflip-entries" data-bind="leaderboard-entries">
        <!-- row per entry -->
      </div>
    </div>
  </div>
</section>
```

**Fetch strategy:** Two independent fetches per day-change:

1. `/player/:address?day=N` — for the bounty + per-player state (already cached by Phase 51's profile-panel request; see Section 11 re-fetch dedup discussion).
2. `/leaderboards/coinflip?day=N` — for the leaderboard.

**Subscriptions:**
- `subscribe('replay.day', () => this.#refetch())`
- `subscribe('replay.player', () => this.#refetch())`
- No need for `replay.level` (coinflip is day-scoped, not level-scoped).

### `<baf-panel>` sub-structure

1. **Context row (top).** Left: "Next BAF: Level {nextBafLevel}" OR "BAF Active!" if `isBafLevel`. Right: "{levelsUntilBaf} levels away" OR "This level!". Plus round status pill ("OPEN" / "CLOSED" / "SKIPPED" / "NOT ELIGIBLE") from INTEG-05. Source: level arithmetic + INTEG-05's `roundStatus` field.
2. **Your rank row (BAF-01, hydrated after INTEG-05 lands).** "You: rank N of M — {score} BURNIE staked". Shown ABOVE the leaderboard when the player is in top-4 OR BELOW when outside. Simpler UX: always show below. Source: INTEG-05.
3. **Leaderboard (BAF-02, middle-bottom).** Top-4 table with prominence per rank. Source: `/leaderboards/baf?level=N`.

**Template shape (skeleton):**

```html
<section data-slot="baf" class="panel play-baf-panel" data-prominence="low">
  <div data-bind="skeleton">...shimmer blocks...</div>
  <div data-bind="content" hidden>
    <h2 class="panel-title">BAF Leaderboard</h2>

    <!-- BAF-03 context + round status -->
    <div class="play-baf-context">
      <span data-bind="next-baf-level">Next BAF: Level --</span>
      <span data-bind="levels-until">-- levels away</span>
      <span class="play-baf-round-status" data-bind="round-status" data-status="">--</span>
    </div>

    <!-- BAF-02 leaderboard -->
    <div class="play-baf-leaderboard">
      <div class="play-baf-header">
        <span>Rank</span><span>Player</span><span>Score</span>
      </div>
      <div class="play-baf-entries" data-bind="leaderboard-entries">
        <!-- row per entry with data-rank="1..4" -->
      </div>
    </div>

    <!-- BAF-01 your rank (hydrated from INTEG-05) -->
    <div class="play-baf-your-rank" data-bind="your-rank" hidden>
      <span>You: rank </span>
      <span data-bind="your-rank-value">--</span>
      <span> of </span>
      <span data-bind="total-participants">--</span>
      <span data-bind="your-score-spacer"> — </span>
      <span data-bind="your-score">--</span>
    </div>
  </div>
</section>
```

**Fetch strategy:** Two parallel fetches per level-change:

1. `/leaderboards/baf?level=N` — top-4 (BAF-02, hydrates in Wave 1).
2. `/player/:address/baf?level=N` — per-player score + rank + roundStatus (BAF-01 + BAF-03, hydrates in Wave 2 after INTEG-05 ships).

**Subscriptions:**
- `subscribe('replay.level', () => this.#refetch())`
- `subscribe('replay.player', () => this.#refetchPerPlayer())`  (BAF-01 only — leaderboard doesn't need refetch on player change)

**Level derivation:** `state.replay.level` is populated by `play/app/main.js:117-133` (Phase 52 work) via the `/game/jackpot/day/{day}/winners` endpoint that returns `{ level }`. Verified current state: `curl /game/jackpot/day/64/winners` → `"level": 42`. So the baf-panel always has a level context once the scrubber has fired at least once.

### Why no shared fetch helper (vs. Phase 52's tickets-fetch.js)

Phase 52 introduced `play/app/tickets-fetch.js` because TWO panels (`<tickets-panel>` and `<packs-panel>`) both wanted the SAME endpoint response. Deduplication at the wire level saved one HTTP request per day-change.

Phase 54 has no such overlap:

| Panel | Endpoint 1 | Endpoint 2 |
|-------|-----------|-----------|
| `<coinflip-panel>` | `/player/:address?day=N` | `/leaderboards/coinflip?day=N` |
| `<baf-panel>` | `/leaderboards/baf?level=N` | `/player/:address/baf?level=N` |

Both panels fetch `/player/:address*` responses but with DIFFERENT query shapes (`?day=N` vs `/baf?level=N`). No overlap with each other. They DO each overlap with other panels' `/player/:address?day=N` call from profile-panel.js — that's where a deeper rethink (Section 11) could consolidate.

**Recommendation: No shared fetch helper for Phase 54.** If the planner wants Phase-52 symmetry, a trivial `play/app/leaderboards-fetch.js` exporting `fetchCoinflipLeaderboard(day)` and `fetchBafLeaderboard(level)` thin wrappers is optional (~30 LOC). Saves nothing on wire requests but gives a parse point for future shared tests.

### `<coinflip-panel>` + profile-panel overlap — should the same endpoint dedup?

Both `<profile-panel>` (Phase 51) and `<coinflip-panel>` (Phase 54) want `/player/:address?day=N`. Same URL, same response shape. A dedup helper would save one HTTP request per (player, day) change.

**Options:**

- **(A) No dedup. Each panel fetches independently.** Simplest. 2× traffic, fine at Phase 54 scale.
- **(B) Shared `play/app/player-fetch.js` helper with in-flight promise dedup.** Phase 52 pattern. Saves 1 HTTP. Adds a shared module.
- **(C) Store-side cache.** Write the player response to `state.replay.playerData`; panels subscribe. Adds store contract.

**Recommendation: (A) no dedup.** Phase 54 is the 5th panel to join the grid; profile-panel and coinflip-panel are not the only consumers. Trying to dedup post-hoc is architectural retrofit. Defer to a future refactor phase if perf tells us to.

If the planner wants symmetry with Phase 52, **(B) is defensible** — ~20 LOC for a `fetchPlayerData(addr, day)` thin dedup helper, same pattern as `tickets-fetch.js`. Either is OK; my research leans (A) for minimum surface.

## Day-Aware + Level-Aware Fetch Pattern Reuse (building on Phase 51 §8 + Phase 52 §8)

Pattern is mature. Phase 54 reuses the stale-guard shape from `play/components/profile-panel.js:327-365` verbatim. Adapted:

### `<coinflip-panel>` fetch method

```javascript
#coinflipFetchId = 0;

async #refetch() {
  const addr = get('replay.player');
  const day = get('replay.day');
  const token = ++this.#coinflipFetchId;

  if (!addr || day == null) return;

  if (this.#loaded) {
    this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
  }

  try {
    // Parallel fetches for state + leaderboard
    const [playerRes, lbRes] = await Promise.all([
      fetch(`${API_BASE}/player/${addr}?day=${encodeURIComponent(day)}`),
      fetch(`${API_BASE}/leaderboards/coinflip?day=${encodeURIComponent(day)}`),
    ]);
    if (token !== this.#coinflipFetchId) return;            // stale-guard post-fetch

    // Gracefully handle partial failure
    const playerData = playerRes.ok ? await playerRes.json() : null;
    if (token !== this.#coinflipFetchId) return;            // stale-guard post-player-json
    const lbData = lbRes.ok ? await lbRes.json() : null;
    if (token !== this.#coinflipFetchId) return;            // stale-guard post-lb-json

    this.#renderBounty(playerData?.coinflip);
    this.#renderState(playerData?.coinflip);
    this.#renderLeaderboard(lbData?.entries ?? []);
    this.#showContent();
    this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
  } catch (err) {
    if (token === this.#coinflipFetchId) {
      this.#renderError();
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
    }
  }
}
```

Key differences from profile-panel.js:
1. `Promise.all` for parallel fetches.
2. Graceful partial failure (leaderboard 404 doesn't kill the bounty section).
3. Stale-guard checks after each sequential await point (3 checks total — the Promise.all plus each .json() resolve).

### `<baf-panel>` fetch method

```javascript
#bafFetchId = 0;
#bafPlayerFetchId = 0;                         // separate counter for INTEG-05 fetch

async #refetchLeaderboard() {
  // BAF-02 + BAF-03 (partial): reads /leaderboards/baf?level=N + computes prominence + level context
  const level = get('replay.level');
  const token = ++this.#bafFetchId;
  if (level == null) return;

  if (this.#loaded) {
    this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
  }

  try {
    const res = await fetch(`${API_BASE}/leaderboards/baf?level=${encodeURIComponent(level)}`);
    if (token !== this.#bafFetchId) return;
    const data = res.ok ? await res.json() : null;
    if (token !== this.#bafFetchId) return;

    this.#renderContext(level);                // computes nextBafLevel, levelsUntilBaf, prominence
    this.#renderLeaderboard(data?.entries ?? []);
    this.#showContent();
    this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
  } catch (err) {
    if (token === this.#bafFetchId) {
      this.#renderError();
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
    }
  }
}

async #refetchPlayer() {
  // BAF-01 + BAF-03 (full roundStatus): reads INTEG-05
  const level = get('replay.level');
  const addr = get('replay.player');
  const token = ++this.#bafPlayerFetchId;
  if (level == null || !addr) return;

  try {
    const res = await fetch(`${API_BASE}/player/${addr}/baf?level=${encodeURIComponent(level)}`);
    if (token !== this.#bafPlayerFetchId) return;
    const data = res.ok ? await res.json() : null;
    if (token !== this.#bafPlayerFetchId) return;

    this.#renderYourRank(data);                // "You: rank N of M" row
    this.#renderRoundStatus(data?.roundStatus);
  } catch {
    // Non-critical — leaderboard has its own path
  }
}
```

**Two separate fetch-id counters** because the two fetches happen at different cadences:
- Leaderboard refetches on `replay.level` change.
- Per-player score refetches on BOTH `replay.level` AND `replay.player` change.

**Wave 2 gate:** `#refetchPlayer()` is the INTEG-05-dependent path. Wave 1 ships the method as a no-op stub (calls `fetch()` but ignores the response if the endpoint 404s — matches Phase 51 pattern where Wave 1 lands methods that become active in Wave 2).

### Subscribe wiring

```javascript
// <coinflip-panel>
this.#unsubs.push(
  subscribe('replay.day', () => this.#refetch()),
  subscribe('replay.player', () => this.#refetch()),
);
this.#refetch();

// <baf-panel>
this.#unsubs.push(
  subscribe('replay.level', () => { this.#refetchLeaderboard(); this.#refetchPlayer(); }),
  subscribe('replay.player', () => this.#refetchPlayer()),
);
this.#refetchLeaderboard();
this.#refetchPlayer();
```

## Validation Architecture (Nyquist)

`workflow.nyquist_validation` not explicitly false in `.planning/config.json` — treat as enabled. (Per Phase 51/52 VALIDATION.md precedent.)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node built-in) + `node:assert/strict` |
| Config file | none — test discovery via `node --test` glob args |
| Quick run command | `node --test play/app/__tests__/play-coinflip-panel.test.js play/app/__tests__/play-baf-panel.test.js` |
| Full suite command | `node --test play/app/__tests__/*.test.js` |
| Estimated runtime | ~2-3 seconds |

Tests are **contract-grep style** (source-file regex assertions). No JSDOM, no build, no runtime. Pattern verified by Phase 50-52 test files (~200 assertions green total).

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COINFLIP-01 | `<coinflip-panel>` renders state section with deposited/claimable/autorebuy data-binds | contract-grep | `node --test play/app/__tests__/play-coinflip-panel.test.js` | ❌ Wave 0 |
| COINFLIP-02 | `<coinflip-panel>` renders leaderboard rows from `/leaderboards/coinflip?day=N` | contract-grep | same | ❌ Wave 0 |
| COINFLIP-03 | `<coinflip-panel>` renders bounty section with armed indicator + biggest-flip stats | contract-grep | same | ❌ Wave 0 |
| BAF-01 | `<baf-panel>` calls `/player/:address/baf?level=N` endpoint + renders "your rank" row | contract-grep | `node --test play/app/__tests__/play-baf-panel.test.js` | ❌ Wave 0 |
| BAF-02 | `<baf-panel>` renders leaderboard rows from `/leaderboards/baf?level=N` with `data-rank` attribute for prominence | contract-grep | same | ❌ Wave 0 |
| BAF-03 | `<baf-panel>` renders round-status pill with `data-status` attribute + next-BAF-level label | contract-grep | same | ❌ Wave 0 |
| SHELL-01 (guardrail) | No new play/ files import forbidden paths; Wave 0 ADDS three new forbidden entries | recursive grep (existing) | `node --test play/app/__tests__/play-shell-01.test.js` | ✅ exists; needs Wave 0 edit |

### Proposed Wave 0 Test File Outlines

**`play/app/__tests__/play-coinflip-panel.test.js`** (~25 assertions, modeled on `play-profile-panel.test.js` shape):

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'coinflip-panel.js');

// Existence + registration
test('coinflip-panel.js exists', () => { assert.ok(existsSync(PANEL)); });
test('coinflip-panel.js registers <coinflip-panel>', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]coinflip-panel['"]/);
});
test('coinflip-panel.js defines class extending HTMLElement', ...);
test('coinflip-panel.js has connectedCallback + disconnectedCallback', ...);

// SHELL-01: no wallet-tainted imports
test('coinflip-panel.js does NOT import beta/app/coinflip.js (wallet-tainted)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/coinflip\.js['"]/);
});
test('coinflip-panel.js does NOT import beta/app/utils.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});
test('coinflip-panel.js imports from beta/viewer/utils.js (wallet-free)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/viewer\/utils\.js['"]/);
});

// Store wiring
test('coinflip-panel.js subscribes to replay.day AND replay.player', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
});
test('coinflip-panel.js imports subscribe + get from reused beta store', ...);

// COINFLIP-01: state section
test('COINFLIP-01: renders state data-binds (deposited, claimable, autorebuy, takeprofit)', () => {
  const src = readFileSync(PANEL, 'utf8');
  for (const key of ['deposited', 'claimable', 'autorebuy', 'takeprofit']) {
    assert.match(src, new RegExp(`data-bind=["']${key}["']`));
  }
});

// COINFLIP-02: leaderboard
test('COINFLIP-02: fetches /leaderboards/coinflip?day=', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/leaderboards\/coinflip\?day=/);
});
test('COINFLIP-02: renders leaderboard entries container', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']leaderboard-entries["']/);
});

// COINFLIP-03: bounty section
test('COINFLIP-03: renders bounty data-binds (armed, bounty-pool, bounty-record, bounty-holder)', () => {
  const src = readFileSync(PANEL, 'utf8');
  for (const key of ['armed', 'bounty-pool', 'bounty-record', 'bounty-holder']) {
    assert.match(src, new RegExp(`data-bind=["']${key}["']`));
  }
});
test('COINFLIP-03: armed indicator uses data-armed attribute', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-armed=/);
});

// Fetch wiring: player endpoint for COINFLIP-01/03 reads
test('fetches /player/${addr}?day= for coinflip block', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/player\/\$\{[^}]+\}\?day=|\/player\/.+?\?day=/);
});

// Stale-guard
test('coinflip-panel.js uses #coinflipFetchId stale-guard counter', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#coinflipFetchId/);
});
test('coinflip-panel.js toggles is-stale class for keep-old-data-dim', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});

// Skeleton + content pattern
test('coinflip-panel.js renders skeleton-shimmer in template', ...);
test('coinflip-panel.js has data-bind="skeleton" and data-bind="content"', ...);

// Empty-state handling
test('coinflip-panel.js handles empty leaderboard gracefully', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /entries\s*\.\s*length|entries\.length|\.length\s*===\s*0|\.length\s*<\s*1/);
});

// Selected-player aria-current
test('coinflip-panel.js highlights selected player with aria-current', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /aria-current/);
});
```

**`play/app/__tests__/play-baf-panel.test.js`** (~25 assertions):

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'baf-panel.js');

// Existence + registration
test('baf-panel.js exists', ...);
test('baf-panel.js registers <baf-panel>', ...);
test('baf-panel.js defines class extending HTMLElement', ...);
test('baf-panel.js has connectedCallback + disconnectedCallback', ...);

// SHELL-01: no wallet-tainted imports
test('baf-panel.js does NOT import beta/app/baf.js (transitively tainted)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/baf\.js['"]/);
});
test('baf-panel.js does NOT import beta/components/baf-panel.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/components\/baf-panel\.js['"]/);
});

// Store wiring
test('baf-panel.js subscribes to replay.level AND replay.player', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
});

// BAF-02: leaderboard top-4 + prominence
test('BAF-02: fetches /leaderboards/baf?level=', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/leaderboards\/baf\?level=/);
});
test('BAF-02: renders leaderboard entries container', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']leaderboard-entries["']/);
});
test('BAF-02: uses data-rank attribute for prominence tiers', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-rank/);
});

// BAF-03: round-status + next-BAF-level
test('BAF-03: renders round-status pill with data-status attribute', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-status/);
  assert.match(src, /data-bind=["']round-status["']/);
});
test('BAF-03: renders next-baf-level data-bind', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']next-baf-level["']/);
});
test('BAF-03: renders levels-until data-bind', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']levels-until["']/);
});

// BAF-01: your rank (INTEG-05 gated)
test('BAF-01: fetches /player/${addr}/baf?level=', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/player\/[^`'"]+\/baf\?level=/);
});
test('BAF-01: renders your-rank section with data-bind="your-rank"', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']your-rank["']/);
});
test('BAF-01: renders your-rank-value, total-participants, your-score bindings', () => {
  const src = readFileSync(PANEL, 'utf8');
  for (const key of ['your-rank-value', 'total-participants', 'your-score']) {
    assert.match(src, new RegExp(`data-bind=["']${key}["']`));
  }
});

// Prominence (panel-level)
test('baf-panel.js uses data-prominence attribute on panel', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-prominence/);
});

// Stale-guards
test('baf-panel.js uses #bafFetchId stale-guard counter', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#bafFetchId/);
});
test('baf-panel.js uses #bafPlayerFetchId for INTEG-05 fetches', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#bafPlayerFetchId/);
});
test('baf-panel.js toggles is-stale class for keep-old-data-dim', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});

// Skeleton + content pattern
test('baf-panel.js renders skeleton-shimmer in template', ...);
test('baf-panel.js has data-bind="skeleton" and data-bind="content"', ...);

// Empty-state handling
test('baf-panel.js handles empty leaderboard gracefully', ...);

// bafContext logic (inline or imported)
test('baf-panel.js includes nextBafLevel derivation (ceil((level+1)/10)*10)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /Math\.ceil\(\s*\(?\s*level\s*\+\s*1\s*\)?\s*\/\s*10\s*\)/);
});

// Selected-player aria-current
test('baf-panel.js highlights selected player with aria-current', ...);
```

**`play/app/__tests__/play-shell-01.test.js` update** (Wave 0 edit, NOT a new file):

Add three entries to the `FORBIDDEN` array:

```javascript
{ label: 'beta/components/baf-panel.js (transitively wallet-tainted)', pattern: /from\s+['"][^'"]*\/beta\/components\/baf-panel\.js['"]/ },
{ label: 'beta/app/coinflip.js (ethers at line 4)', pattern: /from\s+['"][^'"]*\/beta\/app\/coinflip\.js['"]/ },
{ label: 'beta/app/baf.js (transitively tainted via utils.js)', pattern: /from\s+['"][^'"]*\/beta\/app\/baf\.js['"]/ },
```

### Sampling Rate

- **Per task commit:** `node --test play/app/__tests__/play-{coinflip,baf}-panel.test.js` (< 2 seconds)
- **Per wave merge:** Full suite (`node --test play/app/__tests__/*.test.js`)
- **Phase gate:** Full suite + `play-shell-01.test.js` green + INTEG-05 endpoint live + optional UAT

### Wave 0 Gaps

- [ ] `play/app/__tests__/play-coinflip-panel.test.js` — covers COINFLIP-01..03 + SHELL-01 negative assertions + stale-guard + aria-current + empty state (~25 assertions)
- [ ] `play/app/__tests__/play-baf-panel.test.js` — covers BAF-01..03 + SHELL-01 negative assertions + prominence + stale-guard + round-status + aria-current + empty state + inline bafContext check (~25 assertions)
- [ ] `play/app/__tests__/play-shell-01.test.js` — ADD three entries to FORBIDDEN array (beta/components/baf-panel.js, beta/app/coinflip.js, beta/app/baf.js)
- [ ] `.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md` — author from Section 8 of this research
- [ ] `.planning/REQUIREMENTS.md` — update INTEG-04 row to Status "Deferred per Phase 54 D-10"

*(Existing `play-shell-01.test.js` provides recursive SHELL-01 coverage for the new play/ files — no new wallet-free guard test needed for new play/ modules. The ADD to FORBIDDEN is a tightening, not a new scanner.)*

### Manual-Only Verifications (Wave 3, UAT-deferrable)

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Prominence tier colors visible — gold rank 1, silver rank 2, bronze rank 3, regular rank 4 | BAF-02 / D-06 | Visual color accuracy | Load /play/, select a level with ≥4 BAF entries (e.g., level 20). Verify rank 1 shows gold/#FFD700; rank 2 silver; rank 3 bronze; rank 4 regular. Look for visual hierarchy. |
| Panel-level prominence approaches BAF gradually | BAF-03 | Visual feedback | Scrub through levels 1→20. At level 17+, panel border turns accent-colored (`prominence=high`). At level 10, panel is "active". At level 21+, panel goes back to `prominence=medium` then `low`. |
| Rank-change rendering on day/level scrub | BAF-02 / COINFLIP-02 | Stale-guard visual polish | Scrub rapidly across levels/days. Leaderboard rows update without flashing; keep-old-data-dim smooth; no layout thrash. |
| Empty-state look — no coinflip activity for day N | COINFLIP-02 | UX polish | Select a day with 0 coinflip entries. Panel renders "No coinflip activity for day N" or similar; no error. |
| Empty-state look — BAF level % 10 != 0 | BAF-02 / BAF-03 | UX polish | Select level 7 (not multiple of 10). BAF top-4 is empty. Round-status label says "not eligible" with appropriate styling. |
| Selected-player highlight when in top-4 | BAF-01 / COINFLIP-02 | Visual polish | Select a player who IS in BAF top-4 at their level. Their row in the leaderboard is highlighted (aria-current=true; bold+underlined). |
| Selected-player "Your rank" row below leaderboard when outside top-4 | BAF-01 | INTEG-05 wiring | Select a player whose rank > 4 at a BAF-active level. Below the top-4 leaderboard, a row shows "You: rank N of M — {score}". |
| Round-status pill colors — open/closed/skipped distinct | BAF-03 | Visual polish | Find levels in each of the four states (open in current, closed in past, skipped in past with coinflip loss). Pill renders with correct color + label. |
| Coinflip bounty armed animation | COINFLIP-03 | Visual feedback | When `currentBounty > 0`, the "ARMED" indicator pulses via `@keyframes armed-pulse` (or equivalent). When `currentBounty = 0`, static "NOT ARMED". |
| Biggest-flip record visibility | COINFLIP-03 | Backend data availability | When `biggestFlipPlayer` is non-null, record holder + amount display. When null, display "--" gracefully. Currently verified null in live data (Section 7). |

### UAT deferral

Following Phase 50/51/52 precedent (all deferred Wave 3 UAT), Phase 54 Wave 3 is likely deferrable. The planner should structure Wave 3 as optional; automated verification + Wave 2 acceptance-criteria grep is sufficient to close the phase.

## Pitfalls and Landmines (Answer to Q8)

### Pitfall 1: Rapid day-scrub on coinflip leaderboard races
**What goes wrong:** User scrubs days 60→65→70 rapidly. Fetch for day 60 races fetch for day 65 races fetch for day 70. Without stale-guard, day 60's late response clobbers day 70's render.
**How to avoid:** `#coinflipFetchId` stale-guard counter with at least 3 token checks (post-Promise.all, post-player-json, post-lb-json). Proven pattern from Phase 51 profile-panel.js.
**Warning signs:** Leaderboard flickers between days during rapid scrub.

### Pitfall 2: BAF level changes mid-view — round closes, reopens at new level
**What goes wrong:** User is viewing BAF at level 20 (open); sim advances to level 21 mid-view; level 20's BAF jackpot closes and distributes. The panel's local state is stale.
**How to avoid:** `<baf-panel>` subscribes to `replay.level`. When the level changes (either via day-scrub or sim-advance tick), refetch. INTEG-05 returns fresh `roundStatus` reflecting current state.
**Warning signs:** Panel shows "open" when it should show "closed" because level advanced.

### Pitfall 3: Empty leaderboards — level % 10 != 0 renders blank
**What goes wrong:** `/leaderboards/baf?level=7` returns `{"entries":[]}` (empty). Naive rendering shows blank panel. User thinks UI is broken.
**How to avoid:** Explicit empty-state copy. For BAF: "No BAF activity for this level" OR the round-status pill already shows "NOT ELIGIBLE" at non-multiple-of-10 levels. For coinflip: "No coinflip activity for day N".
**Warning signs:** Panel body is empty; user reports "leaderboard doesn't load".

### Pitfall 4: Selected-player not in leaderboard — surfacing rank unclear
**What goes wrong:** Player X is the selected player; player X is NOT in top-4 BAF. The top-4 leaderboard doesn't mention X at all. UX gap.
**How to avoid:** BAF-01 (INTEG-05) fills this gap. The per-player endpoint returns X's actual rank (e.g., 7 of 42). Render "You: rank 7 of 42" in a row BELOW the top-4 leaderboard. For coinflip, the top-10 is broader so this is less of a gap; if player is outside top-10 render "You: rank N" (INTEG-04 would provide this; deferred per D-10, so coinflip case stays unresolved in Phase 54).
**Warning signs:** Selected player highlight is absent from the leaderboard; user doesn't know their rank.

### Pitfall 5: baf-panel.js accidentally imports beta/components/baf-panel.js
**What goes wrong:** A developer, seeing the identical name, imports the beta component file. `customElements.define('baf-panel', ...)` collides (the beta file also defines it). DOMException thrown. Panel is blank.
**How to avoid:** Wave 0 adds `beta/components/baf-panel.js` to `play-shell-01.test.js` FORBIDDEN list. Any future accidental import fails CI immediately.
**Warning signs:** Console throws on `<baf-panel>` tag; panel is blank.

### Pitfall 6: beta's 352-LOC coinflip-panel.js tempts a "just copy the whole thing" approach
**What goes wrong:** Developer copies `beta/components/coinflip-panel.js` verbatim to `play/components/coinflip-panel.js` and swaps one import. But the beta panel has ~200 LOC of write-mode UI (deposit button, claim button, auto-rebuy save button, stake input validation, error handling, locked-message display) that Phase 54 play/ does not need. Dead code, maintenance burden, wallet-taint risk on future edits.
**How to avoid:** Start fresh with the Phase 50 skeleton. Implement only the read-side sections: bounty header (lines 68-85 of beta), claim display (lines 62-66), leaderboard (NEW — beta doesn't have this section). Reference beta for structure only.
**Warning signs:** `<coinflip-panel>` source is >400 LOC; maintenance feels painful.

### Pitfall 7: Sound — currentBounty > 0 but biggestFlipPlayer is null
**What goes wrong:** Live data shows this state: bounty armed but no record holder exists yet. The "Record holder" row renders "null" literal instead of "--".
**How to avoid:** All display functions check for null and substitute placeholder. Example: `formatBurnie(amount) + ' BURNIE'` breaks if amount is null; guard with `amount && amount !== '0' ? formatBurnie(amount) : '--'`.
**Warning signs:** "null" or "undefined" text visible in UI.

### Pitfall 8: Score unit mismatch — coinflip leaderboard scores vs BAF scores
**What goes wrong:** `/leaderboards/coinflip` returns scores like "52875" (small integer). `/leaderboards/baf` returns scores like "475215212469240581904067" (wei-scale). Same `score: z.string()` type; different semantics. Naive `formatEth(score)` produces wildly different displays.
**How to avoid:** Document in the panel code: coinflip scores are integer-scale BURNIE (use `formatBurnie` OR treat as integer); BAF scores are wei-scale BURNIE (use `formatBurnie` properly). Verify at Wave 1 by inspecting the contract emit sites.
**Warning signs:** Coinflip shows "0.000000000000052875 BURNIE" (treated as wei). BAF shows "475,215,212,469,240,581,904,067 BURNIE" (treated as whole units).

### Pitfall 9: Level derivation race on first-day load
**What goes wrong:** `<baf-panel>`'s `connectedCallback` fires before `play/app/main.js:117` writes `replay.level`. First `refetchLeaderboard()` sees `level = undefined` → returns early → never fetches. The panel sits in skeleton forever.
**How to avoid:** The subscribe callback fires when `replay.level` is first written, which triggers a `#refetchLeaderboard()`. The "null first" branch in `#refetchLeaderboard()` correctly no-ops. Kicks the leaderboard to update once the level is populated. Verified: `<tickets-panel>` (Phase 52) uses the same pattern and works.
**Warning signs:** Panel stuck at skeleton on first load (but other panels hydrate).

### Pitfall 10: Coinflip panel subscribes to `replay.day` — but `/player/:address?day=N` coinflip block is NOT day-scoped
**What goes wrong:** Verified in Section 7: the `coinflip` block in `/player/:address?day=N` returns LATEST state, not end-of-day-N state. Scrubbing days doesn't change the bounty display (this is correct behavior for "current bounty"), but user expects the `depositedAmount` to reflect the stake for day N, which it does (via latest-stake fallback) — correctly only when day N is the latest. For past days, user sees current state labeled as past day's state.
**How to avoid:** Accept as-is for Wave 1. If UAT flags this, file follow-up as INTEG-02 refinement to day-scope the coinflip block too. Current scope doesn't require fixing.
**Warning signs:** User reports "I staked 200 BURNIE on day 64 but the panel shows 500 BURNIE when I scrub to day 64" — the 500 is today's stake.

### Pitfall 11: Stale `mv_coinflip_top10` / `mv_baf_top4` — materialized view not refreshed
**What goes wrong:** Both leaderboards read from materialized views that need `REFRESH MATERIALIZED VIEW ... CONCURRENTLY`. If the refresh lags (e.g., long-running indexer), leaderboards show stale data — but the per-player endpoint reads direct tables, so there's a skew.
**How to avoid:** This is a database-repo concern, not website-repo. Trust that the indexer refreshes views on a regular interval. If UAT surfaces stale data, surface back to the database team.
**Warning signs:** Player ranked 3 in top-4 view doesn't see themselves in top-4 when INTEG-05 says they're rank 3.

### Pitfall 12: BAF round status transitions — open → skipped flash
**What goes wrong:** During a level % 10 == 0 day with a coinflip result, there's a brief window between the coinflip losing (advance day) and `baf_skipped` being indexed. For a second or two, INTEG-05 returns `roundStatus="open"` when it should say "skipped". Race condition.
**How to avoid:** Accept as "eventual consistency". The UI re-fetches on every `replay.level` change, and the indexer catches up within seconds. If UAT surfaces the race, add a polling refresh (not recommended — over-engineering).
**Warning signs:** UAT tester sees round-status flip from "OPEN" to "SKIPPED" within a few seconds of level advancement.

## Open Questions (Post-Research)

### Q1: Should the `/player/:address?day=N` coinflip block be day-scoped in Wave 2 (post-INTEG-05)?
Current behavior returns latest-state. Phase 51 INTEG-02 scoped quests + dailyActivity by day but left the coinflip block as latest-state. Is this a bug or intentional?
**Recommendation for planner:** Out of Phase 54 scope. File as a follow-up INTEG-02 refinement if UAT flags it. The behavior is honest: "current" coinflip state with the historical day context.

### Q2: Should INTEG-04 (coinflip recycle history) be completely dropped from v2.4?
CONTEXT D-10 defers. ROADMAP success criterion 5 says "INTEG-04 confirmed OR formally documented as deferred". REQUIREMENTS.md still lists INTEG-04 under INTEG block with status "Pending". Wave 0 should update that row to "Deferred per Phase 54 D-10".
**Recommendation for planner:** Wave 0 edits REQUIREMENTS.md to mark INTEG-04 deferred with pointer to Phase 54 CONTEXT D-10. No further action.

### Q3: What happens if INTEG-05 ships with a different response shape than this spec?
This is database-repo domain. The spec in Section 8 is a proposal. Database team may refine field names (e.g., `roundState` instead of `roundStatus`; `scoreWei` instead of `score`). Wave 2 tests adjust to the shipped shape.
**Recommendation for planner:** Track this as a Wave 2 risk. Use the Phase 51 INTEG-02 precedent — at the start of Wave 2, read the shipped openapi.json / test file to confirm shape, then commit UI wiring.

### Q4: Should the BAF per-player endpoint accept `?day=N` as an alias for `?level=N`?
INTEG-05 v1 ships `?level=N` only. Frontend always has `replay.level`. A future refinement could accept `?day=M` and resolve to level via `daily_rng`.
**Recommendation for planner:** Defer. v1 ships `?level=N`. No Phase 54 action needed.

### Q5: Should prominence styling (D-06 tier colors) use hex literals or CSS custom properties?
The proposed CSS in Section 9 uses literal hex values (#FFD700 gold, #C0C0C0 silver, #CD7F32 bronze). Alternative: expose as CSS custom properties in `:root` (`--rank-1-color`, etc.) so the design system can theme them centrally.
**Recommendation for planner:** Literal hex for Wave 1. Refactor to custom properties in a future design-system phase if needed. Keeps Phase 54 self-contained.

### Q6: Should the coinflip "Your rank" (outside top-10) row be added even without INTEG-04?
CONTEXT D-10 defers INTEG-04. Without it, the selected player's rank among all coinflip participants cannot be surfaced when they're outside top-10. BAF has INTEG-05 to fill this gap; coinflip does not.
**Recommendation for planner:** Accept the gap. If the selected player is in top-10, aria-current highlights their row; if outside top-10, no rank shown. Document as a UX trade-off; revisit if INTEG-04 ships in a future phase.

### Q7: Should Wave 1 land a stub INTEG-05 fetch path that 404s silently (like Phase 51 did)?
Yes. `#refetchPlayer()` defined in Wave 1 as a no-op if response is not OK. Wave 2 flips it to parse + render once INTEG-05 is live. Matches Phase 51 pattern.
**Recommendation for planner:** Accept. Phase 51's profile-panel landed #refetch() with renderError() fallback in Wave 1; Wave 2 only wired the subscribes. Same pattern.

### Q8: `coinflip_leaderboard.score` unit verification — open item
Live data shows integer-scale values (order 10^4-10^5). MUST be verified as Wave 1 first step (read contract emit site for `CoinflipTopUpdated`).
**Recommendation for planner:** Wave 1 Task 1 confirms the unit. Adjust rendering accordingly (likely `formatBurnie` with divisor=1 if values are whole-BURNIE, OR simple `String(score)` if integer count).

### Q9: Should `<baf-panel>` render "Your rank" row ABOVE or BELOW the leaderboard when the player is NOT in top-4?
CONTEXT "Gray Areas" (section: "Rank of player not in top-4") says: "show below the leaderboard as 'You: rank N of M'". Locked decision — below.
**Recommendation for planner:** Below. No further action.

### Q10: Is INTEG-05 really strictly necessary for BAF-01? Could top-4 rendering skip BAF-01 entirely for non-top-4 players?
Arguably yes. BAF-01 requires "user sees player's BAF score and rank at current level/window". If the player isn't in top-4, the requirement could be "satisfied" by not showing them anything (they aren't ranked enough to matter). This is a semantic stretch.
**Recommendation for planner:** Don't stretch. INTEG-05 exists to cover the rank-gap and is explicitly mentioned in ROADMAP success criterion 5. Ship it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `beta/components/coinflip-panel.js` is transitively wallet-tainted via `beta/app/coinflip.js` → `ethers` | Section 6 [VERIFIED via grep] | None — direct grep confirms `import { ethers } from 'ethers'` at line 4 |
| A2 | `beta/components/baf-panel.js` is transitively wallet-tainted via `beta/app/baf.js` → `beta/app/utils.js` → `ethers` | Section 6 [VERIFIED via grep] | None — grep confirms the chain |
| A3 | `/leaderboards/coinflip?day=N` response shape matches `coinflipLeaderboardResponseSchema` at `database/src/api/schemas/leaderboard.ts:9-11` | Section 7 [VERIFIED via live curl + schema read] | None |
| A4 | `/leaderboards/baf?level=N` response shape matches `bafBracketResponseSchema` at `database/src/api/schemas/leaderboard.ts:17-19` | Section 7 [VERIFIED via live curl + schema read] | None |
| A5 | `/player/:address?day=N` `coinflip` block has all 7 fields from CONTEXT D-05 | Section 7 [VERIFIED via live curl] | None |
| A6 | INTEG-05 response shape will match Section 8 spec | Section 8 [PROPOSED] | Database team may refine; Wave 2 adjusts UI parsing |
| A7 | `coinflip_leaderboard.score` is NOT wei-encoded (live data shows integer-scale) | Section 7 [VERIFIED via live data, Pitfall 8] | Wrong unit = wrong display. Verify in Wave 1 Task 1. |
| A8 | `baf_flip_totals.totalStake` IS wei-encoded BURNIE (live data shows wei-scale) | Section 7 [VERIFIED via live data] | None |
| A9 | `mv_baf_top4` and `mv_coinflip_top10` refresh frequently enough for UAT-quality consistency | Section 7 [ASSUMED based on Phase 52 precedent] | Stale-data UAT complaint → surface to database team |
| A10 | `state.replay.level` is always populated by the time `<baf-panel>` subscribes | Section 11 [VERIFIED via play/app/main.js:117-133] | Race on first load handled by the no-op guard in `#refetch()` |
| A11 | Phase 51 INTEG-02 precedent (3-commit side-quest) applies to INTEG-05 | Section 8 [CITED: commit log] | If database team takes longer, Wave 2 blocks. Risk LOW. |
| A12 | `roundStatus` derivation via `baf_skipped` + `jackpot_distributions(awardType IN ('eth_baf', 'tickets_baf'))` is accurate | Section 8 [VERIFIED via handler code at database/src/handlers/jackpot.ts:14-83 + database/src/handlers/baf-jackpot.ts:47-68] | If contract adds a new award-type or skip-variant, derivation misses. Low risk; contract is stable. |
| A13 | No shared fetch helper needed (vs Phase 52) | Section 10 [REASONED from endpoint cardinality — no two panels share the same URL] | If planner wants Phase-52 symmetry, trivial 30-LOC helper adds no harm |
| A14 | ROW_NUMBER CTE with UNION ALL for INTEG-05 works in Drizzle | Section 8 [ASSUMED based on PostgreSQL standard support] | Database team refines if the pattern doesn't fit Drizzle's SQL builder. Alternative: two separate queries. |

## Risks / Blockers

### Blockers

- **INTEG-05 delivery (hard gate, CONTEXT D-04 + ROADMAP success criterion 5).** UI hydration Wave 2 cannot merge until database repo ships. Same solo-dev pattern as INTEG-01 (Phase 52) and INTEG-02 (Phase 51). Risk LOW — two prior side-quests shipped in 3-5 minutes each with near-identical scope.

### Risks

- **Coinflip score unit ambiguity (Pitfall 8).** MUST verify in Wave 1 Task 1 by reading contract emit site. Low risk of UI bug; medium risk of wasting Wave 1 time if discovered late.
- **BAF round status eventual-consistency race (Pitfall 12).** Low-impact UAT concern; self-resolves within seconds of level advancement.
- **Prominence tier colors subjective (Q5).** D-06 specifies tier colors but CSS choices (hex vs CSS custom properties) are polish. Non-blocking.
- **No shared fetch helper (A13).** Phase 52 symmetry lost. Low risk — 30 LOC opt-in if planner prefers the parallel structure.

### Non-Risks (Rejected Concerns)

- **SHELL-01 regression.** Covered by `play-shell-01.test.js` recursive scan + Wave 0 FORBIDDEN additions (beta/components/baf-panel.js, beta/app/coinflip.js, beta/app/baf.js).
- **State contract drift.** `state.replay.{day, level, player}` unchanged. No new store slots needed.
- **Tag-name collision between Phase 50 play/ stubs and beta's.** Phase 54 does NOT import the beta versions; both `<coinflip-panel>` and `<baf-panel>` in play/ register the same names as beta's, but since beta's files are never imported by play/, no collision.
- **INTEG-04 deferral affects COINFLIP scope.** CONTEXT D-10 + ROADMAP success criterion 5 both explicitly permit deferral. COINFLIP-01/02/03 all work without INTEG-04.

## Environment Availability

| Dependency | Required By | Available | Notes | Fallback |
|------------|------------|-----------|-------|----------|
| Node.js `node:test` | test suite | ✓ | Phase 50-52 precedent | — |
| Python `http.server` (dev static server) | manual UAT | ✓ | — | — |
| Fastify API at localhost:3000 | runtime | ✓ | Verified via `curl` 2026-04-24 | — |
| `/leaderboards/coinflip?day=N` | COINFLIP-02 | ✓ | Live; live data for day 64 returned 5 entries | — |
| `/leaderboards/baf?level=N` | BAF-02 | ✓ | Live; live data for level 20 returned 4 entries | — |
| `/player/:address?day=N` coinflip block | COINFLIP-01, COINFLIP-03 | ✓ | Live; INTEG-02 shipped in Phase 51 | — |
| `/player/:address/baf?level=N` | BAF-01, BAF-03 | ✗ | **INTEG-05 HARD GATE** — database repo must ship | Wave 2 blocks until endpoint lands; Wave 1 UI ships with no-op fallback |
| `mv_coinflip_top10` materialized view | COINFLIP-02 | ✓ | Verified via `database/src/db/schema/views.ts:45-56` |  |
| `mv_baf_top4` materialized view | BAF-02 | ✓ | Verified via `database/src/db/schema/views.ts:77-88` | — |
| `baf_flip_totals` table | INTEG-05 | ✓ | Indexed by `handleBafFlipRecorded`; `database/src/db/schema/baf-jackpot.ts:3-13` | — |
| `baf_skipped` table | INTEG-05 roundStatus | ✓ | Indexed by `handleBafSkipped`; schema at `baf-jackpot.ts:21-32` | — |
| `jackpot_distributions` table with `awardType IN ('eth_baf', 'tickets_baf')` | INTEG-05 roundStatus | ✓ | Indexed by `handleJackpotTicketWin` / `handleJackpotEthWin`; `jackpot.ts:35, 83` | — |
| beta/viewer/utils.js (`truncateAddress`, `formatBurnie`, `formatEth`) | Address + amount rendering | ✓ | Wallet-free per SHELL-01 comment; `beta/viewer/utils.js:1-38` | — |
| beta/styles/base.css keyframes (@keyframes armed-pulse) | COINFLIP-03 pulsing indicator | Partial | Currently defined in `beta/styles/coinflip.css:166-169`; NOT linked from play/index.html | Copy the keyframe into play/styles/play.css (3 lines) |

**Missing dependencies with no fallback:**
- INTEG-05 — the one hard gate on this phase.

**Missing dependencies with fallback:**
- `@keyframes armed-pulse` — copy 3 lines into play.css, no blocking.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Beta's coinflip-panel mixes read + write UI in 352 LOC | Play's coinflip-panel is read-only (~250 LOC), no stake input, no deposit/claim buttons | Phase 54 | Smaller, simpler, no wallet-coupling risk |
| Beta's baf-panel subscribes to `game.level` directly | Play's baf-panel subscribes to `state.replay.level` | Phase 54 | Decoupled from live game state; day-scrubber controls the effective level |
| Beta's baf-panel shows top-4 only, player-score only if IN top-4 | Play's baf-panel shows top-4 + always surfaces player's rank (via INTEG-05) | Phase 54 | Better UX for non-top-4 players |
| Beta treats prominence as panel-level only | Play adds rank-tier colors per row (gold/silver/bronze/regular) | Phase 54 / D-06 | More informative leaderboard; competes with modern gacha/leaderboard UX standards |
| Beta's baf helpers (`bafContext`, `formatBafScore`) import `beta/app/utils.js` (ethers) | Play inlines `bafContext` inside the panel (wallet-free) | Phase 54 | SHELL-01 compliance with zero file overhead |

**Deprecated / outdated (in v2.4 play/ context):**
- `beta/components/coinflip-panel.js` as a play/ import target — not usable (wallet-tainted via two paths)
- `beta/components/baf-panel.js` as a play/ import target — not usable (wallet-tainted via one path)
- `beta/app/coinflip.js`, `beta/app/baf.js` as play/ import targets — wallet-tainted
- Shared `play/app/leaderboards-fetch.js` helper — not required; coinflip + BAF don't share endpoints

## Sources

### Primary (HIGH confidence)

- `/home/zak/Dev/PurgeGame/website/beta/components/coinflip-panel.js:1-352` — visual reference + SHELL-01 audit
- `/home/zak/Dev/PurgeGame/website/beta/components/baf-panel.js:1-171` — visual reference + SHELL-01 audit
- `/home/zak/Dev/PurgeGame/website/beta/app/coinflip.js:1-98` — `getMultiplierTier` helper reference; confirmed wallet-tainted at line 4
- `/home/zak/Dev/PurgeGame/website/beta/app/baf.js:1-78` — `bafContext` + `formatBafScore` helper reference; confirmed wallet-tainted via utils.js import at line 6
- `/home/zak/Dev/PurgeGame/website/beta/styles/coinflip.css:1-208` — prominence + bounty-armed keyframes
- `/home/zak/Dev/PurgeGame/website/beta/styles/baf.css:1-80` — prominence styling source
- `/home/zak/Dev/PurgeGame/website/beta/viewer/utils.js:1-38` — wallet-free `truncateAddress`, `formatBurnie`, `formatEth`, `formatWei`
- `/home/zak/Dev/PurgeGame/website/play/components/profile-panel.js:1-418` — gold-standard hydrated Custom Element template
- `/home/zak/Dev/PurgeGame/website/play/components/tickets-panel.js:1-192` — list-driven panel template
- `/home/zak/Dev/PurgeGame/website/play/app/main.js:1-143` — bootstrap pattern + `replay.level` population
- `/home/zak/Dev/PurgeGame/website/play/app/constants.js:1-13` — re-export surface
- `/home/zak/Dev/PurgeGame/website/play/app/tickets-fetch.js:1-42` — dedup helper pattern (reference for optional leaderboards-fetch)
- `/home/zak/Dev/PurgeGame/website/play/index.html:1-82` — CSS links + importmap
- `/home/zak/Dev/PurgeGame/website/play/styles/play.css` (844 LOC) — existing play CSS surface
- `/home/zak/Dev/PurgeGame/website/play/app/__tests__/play-profile-panel.test.js:1-80` — test template
- `/home/zak/Dev/PurgeGame/website/play/app/__tests__/play-tickets-panel.test.js:1-194` — test template (larger panel)
- `/home/zak/Dev/PurgeGame/website/play/app/__tests__/play-shell-01.test.js:1-107` — SHELL-01 recursive scanner
- `/home/zak/Dev/PurgeGame/database/src/api/routes/leaderboards.ts:1-92` — existing `/leaderboards/*` handlers
- `/home/zak/Dev/PurgeGame/database/src/api/routes/player.ts:1-743` — existing `/player/:address` handler + INTEG-01 `/tickets/by-trait` precedent
- `/home/zak/Dev/PurgeGame/database/src/api/schemas/leaderboard.ts:1-28` — existing schemas
- `/home/zak/Dev/PurgeGame/database/src/api/schemas/player.ts:1-168` — playerDashboard + ticketsByTrait schemas
- `/home/zak/Dev/PurgeGame/database/src/api/schemas/common.ts:1-27` — addressParamSchema + errorResponseSchema
- `/home/zak/Dev/PurgeGame/database/src/db/schema/views.ts:1-110` — materialized views definitions
- `/home/zak/Dev/PurgeGame/database/src/db/schema/baf-jackpot.ts:1-33` — `bafFlipTotals` + `bafSkipped` table schemas
- `/home/zak/Dev/PurgeGame/database/src/db/schema/coinflip.ts:1-58` — `coinflipLeaderboard`, `coinflipBountyState`, `coinflipSettings`, `coinflipDailyStakes`, `coinflipResults` table schemas
- `/home/zak/Dev/PurgeGame/database/src/handlers/baf-jackpot.ts:1-68` — BAF indexer handlers
- `/home/zak/Dev/PurgeGame/database/src/handlers/coinflip.ts:119-146` — coinflip leaderboard upsert handler
- `/home/zak/Dev/PurgeGame/database/src/handlers/jackpot.ts:10-83` — BAF sentinel + awardType routing
- `/home/zak/Dev/PurgeGame/degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol:1940-2000` — `runBafJackpot` contract mechanics
- `/home/zak/Dev/PurgeGame/website/.planning/phases/54-coinflip-baf/54-CONTEXT.md` — 10 locked decisions
- `/home/zak/Dev/PurgeGame/website/.planning/phases/51-profile-quests/51-RESEARCH.md:1-500` — Phase 51 structural template
- `/home/zak/Dev/PurgeGame/website/.planning/phases/52-tickets-packs-jackpot/52-RESEARCH.md` (1291 LOC) — SHELL-01 transitive audit pattern, INTEG side-quest structure
- `/home/zak/Dev/PurgeGame/website/.planning/phases/51-profile-quests/INTEG-02-SPEC.md:1-217` — INTEG spec template
- `/home/zak/Dev/PurgeGame/website/.planning/REQUIREMENTS.md:1-187` — authoritative requirement IDs
- `/home/zak/Dev/PurgeGame/website/.planning/ROADMAP.md:150-162` — Phase 54 goal + success criteria
- `/home/zak/Dev/PurgeGame/website/CLAUDE.md` — project instructions

### Secondary (MEDIUM confidence)

- INTEG-05 JSON response shape (Section 8) — PROPOSED; database team may refine during implementation (e.g., rename `roundStatus` to `roundState`)
- ROW_NUMBER CTE with UNION ALL pattern (Section 8) — ASSUMED to work in Drizzle; backend team may prefer two separate queries instead
- Coinflip score unit (Section 7 Pitfall 8 + Section 8 A7) — live data suggests integer-scale BURNIE, but contract emit site must be verified in Wave 1

### Tertiary (LOW confidence)

- None. All claims are `[VERIFIED]` by direct file read or `[CITED]` to a file+line. `[ASSUMED]` items are logged in the Assumptions Log with risk assessment.

## Metadata

**Confidence breakdown:**

- SHELL-01 transitive audit (both beta panels tainted): HIGH — verified via direct grep for `ethers` and import chains
- Existing endpoint shapes (`/leaderboards/*`, `/player/:address`): HIGH — verified via live `curl` calls + schema read
- CONTEXT D-05 coinflip fields already in INTEG-02 response: HIGH — verified via live curl showing all 7 fields present
- INTEG-05 spec (Section 8): MEDIUM — data sources verified, but exact Drizzle SQL shape and field names may refine at implementation
- BAF prominence CSS (Section 9): HIGH — beta/styles/baf.css fully enumerated; D-06 tier colors proposed as new additive layer
- Custom Element structure (Section 10): HIGH — gold-standard template available (profile-panel.js); pattern clone
- Day-aware fetch reuse (Section 11): HIGH — Phase 51/52 pattern is mature
- Validation architecture (Section 12): HIGH — Phase 51/52 test-file precedent is a copy-paste template
- Pitfalls (Section 13): HIGH — 12 pitfalls enumerated; most are Phase 51/52 carryovers

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days — contracts are stable; `/leaderboards/*` endpoints are shipped and stable; only INTEG-05 is a moving target and that's the scope-defining deliverable for the phase).

**Files the planner MUST read before creating plans:**

1. `.planning/phases/54-coinflip-baf/54-CONTEXT.md` (133 lines) — 10 locked decisions D-01..D-10
2. `.planning/phases/51-profile-quests/INTEG-02-SPEC.md` (217 lines) — INTEG spec template
3. `.planning/phases/51-profile-quests/51-RESEARCH.md` sections on validation architecture + fetch pattern (cloneable templates)
4. `.planning/phases/52-tickets-packs-jackpot/52-RESEARCH.md` Section 6 (SHELL-01 transitive audit pattern; Section 10 Custom Elements structure; Section 12 Validation Architecture)
5. `play/components/profile-panel.js` (418 lines) — gold-standard hydrated Custom Element
6. `play/components/tickets-panel.js` (192 lines) — list-driven panel shape (rank rows structurally similar to card rows)
7. `play/app/main.js` (143 lines) — bootstrap + `replay.level` population pattern
8. `play/app/constants.js` (13 lines) — re-export surface
9. `play/app/__tests__/play-profile-panel.test.js` — test template (short version)
10. `play/app/__tests__/play-tickets-panel.test.js` — test template (larger panel)
11. `play/app/__tests__/play-shell-01.test.js` — FORBIDDEN list to edit in Wave 0
12. `beta/components/coinflip-panel.js` (352 lines) — visual reference for layout; DO NOT import
13. `beta/components/baf-panel.js` (171 lines) — visual reference for layout + prominence; DO NOT import
14. `beta/styles/coinflip.css` (208 lines) — table styling, bounty indicator keyframes
15. `beta/styles/baf.css` (80 lines) — prominence styling source
16. `beta/viewer/utils.js` (38 lines) — `truncateAddress`, `formatBurnie`, `formatEth`
17. `database/src/api/routes/leaderboards.ts` — existing handlers for `/leaderboards/*`
18. `database/src/api/routes/player.ts:552-702` — INTEG-01 `/tickets/by-trait` precedent (the shape the INTEG-05 handler follows)
19. `database/src/api/schemas/leaderboard.ts` + `player.ts` + `common.ts` — schema patterns
20. `database/src/db/schema/baf-jackpot.ts` + `coinflip.ts` + `views.ts` — table + view definitions

## RESEARCH COMPLETE
