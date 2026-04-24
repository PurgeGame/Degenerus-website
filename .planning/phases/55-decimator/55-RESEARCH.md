# Phase 55: Decimator - Research

**Researched:** 2026-04-24
**Domain:** Vanilla Custom Element hydration for a single read-only decimator panel that surfaces window state, bucket/subbucket assignment, weighted burns, winning-subbucket payout, and (conditionally) terminal-decimator state
**Confidence:** HIGH on frontend patterns + existing endpoint shapes (live and verified via Phase 51 INTEG-02 schema); HIGH on SHELL-01 transitive audit (decimator-panel.js AND terminal-panel.js AND both beta/app/{decimator,terminal}.js are wallet-tainted); HIGH on contract mechanics (BurnieCoin.sol + DegenerusGameDecimatorModule.sol read at source-of-truth path); MEDIUM on INTEG-03 backend algorithm (needs a per-player bucket+subbucket+pro-rata path that is not served by any existing endpoint); FLAGGED a CONTEXT D-03 discrepancy (buckets 5-12 or 2-12, not 1-8).

## Summary

Phase 55 replaces the Phase 50 `<decimator-panel>` skeleton (40 LOC) with a single hydrated panel that surfaces four requirement surfaces: window state (DECIMATOR-01, live pre-backend), per-level bucket + subbucket assignment (DECIMATOR-02, INTEG-03 gated), per-level effective + weighted burn amounts (DECIMATOR-03, partial live via existing endpoint, full via INTEG-03), winning subbucket + payout for resolved levels (DECIMATOR-04, INTEG-03 gated), and an optional terminal sub-section rendered only when `terminal.burns.length > 0` (DECIMATOR-05, live pre-backend).

**No new helper modules required.** The panel is a single Custom Element with one fetch path for the extended `/player/:address?day=N` endpoint (already shipped by Phase 51 INTEG-02, returns both the `decimator` and `terminal` blocks) and a second fetch path for the new INTEG-03 `/player/:address/decimator?level=N&day=M` endpoint. Terminal state is a conditionally-rendered sub-section INSIDE `<decimator-panel>` per CONTEXT D-01; no separate `<terminal-panel>` Custom Element. The conditional-rendering gate is `D-06`: render terminal section only when `terminal.burns.length > 0`.

The phase is hard-gated on INTEG-03 (backend endpoint in database repo). Both beta reference components are wallet-tainted via DIRECT ethers imports: `beta/components/decimator-panel.js:7-13` imports `../app/decimator.js` (which imports `ethers` at line 4) AND `../app/utils.js` (which imports `ethers` at line 3). `beta/components/terminal-panel.js:6-14` imports `../app/terminal.js` (which imports `ethers` at line 6) AND `../app/utils.js`. **Both beta files also call `customElements.define()` with names that collide with play/'s** — `'decimator-panel'` (beta:246) already covered in SHELL-01 FORBIDDEN, but `'terminal-panel'` (beta:328) is NOT covered because terminal state lives inside `<decimator-panel>` in play/. Wave 0 should ADD four FORBIDDEN entries: `beta/components/decimator-panel.js` (already there), `beta/components/terminal-panel.js` (new), `beta/app/decimator.js` (new), `beta/app/terminal.js` (new). Section 6 documents the full transitive graph.

Frontend risk is LOW. The gold-standard template is `play/components/baf-panel.js` (358 LOC, shipped in Phase 54) which already demonstrates the dual-signal `subscribe('replay.level') + subscribe('replay.player')` pattern, the two-counter stale-guard (`#bafFetchId` + `#bafPlayerFetchId`), and the `is-stale` keep-old-data-dim toggle. Phase 55 mirrors that shape almost verbatim, substituting the BAF endpoint for the INTEG-03 endpoint and adding a third subscription to `replay.day` (needed because some state — activity score, terminal burns — resolves from the day-scoped `/player/:address?day=N` fetch).

**CRITICAL CONTEXT FIX:** CONTEXT D-03 states "Buckets are 1-8 (per the game model)." This is WRONG. Verified via `BurnieCoin.sol:142-147`: `DECIMATOR_BUCKET_BASE = 12`, `DECIMATOR_MIN_BUCKET_NORMAL = 5`, `DECIMATOR_MIN_BUCKET_100 = 2`. Bucket range is 5-12 (normal levels) or 2-12 (every level divisible by 100). Per-burn subBucket range is 0 to bucket-1 (verified via `DegenerusGameDecimatorModule.sol:27` "The deterministic subbucket assigned (0 to bucket-1)"). The UI must render the correct range. See Pitfall 1.

**Primary recommendation:** Wave 0 ships (1) INTEG-03-SPEC.md authored in the Phase 55 directory using Phase 54's INTEG-05-SPEC.md (238 lines) as the structural template, (2) `play-decimator-panel.test.js` contract-grep harness (~30 assertions covering the four requirement surfaces + SHELL-01 negatives + stale-guard + conditional terminal section + selected-player highlighting), (3) `play-shell-01.test.js` FORBIDDEN edit adding three new entries (terminal-panel.js, beta/app/decimator.js, beta/app/terminal.js; existing decimator-panel.js already listed). Wave 1 (pre-backend) evolves the Phase 50 stub to fully render DECIMATOR-01 (window state from the existing `decimator.windowOpen` field in the extended `/player/:address?day=N` response), DECIMATOR-03 partial (effective/weighted amounts from the existing `decimatorClaims` array), and DECIMATOR-05 terminal sub-section (conditional on `terminal.burns.length > 0`). Wave 2 (hard-gated on INTEG-03) wires the new per-level endpoint to hydrate DECIMATOR-02 + DECIMATOR-04 + full DECIMATOR-03. Wave 3 (optional UAT) validates bucket-table visual correctness, terminal section empty-state behaviour, and winning-subbucket rendering.

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-10)

**Panel structure**
- **D-01** Single Custom Element: `<decimator-panel>` (evolve Phase 50 stub). No separate `<terminal-panel>` — terminal state is a conditional sub-section inside the decimator panel.

**Beta reuse strategy**
- **D-02** Pattern-match beta styling, no imports. `beta/components/decimator-panel.js` (246 LOC) + `beta/components/terminal-panel.js` (328 LOC) + `beta/styles/{decimator,terminal}.css` are visual references only. SHELL-01 transitive audit in Section 6 confirms all are wallet-tainted.

**Rendering**
- **D-03** Bucket rendering shows player's assignment highlighted. *(Research note: CONTEXT specifies "buckets are 1-8" which is incorrect; contract source confirms 5-12 normal / 2-12 level%100. See Summary + Pitfall 1.)*
- **D-04** Subbucket winner + payout prominently displayed for resolved levels (payout pill + "You won X ETH" or "Not your subbucket").
- **D-05** Window state as a status badge: "Open (Level N)" / "Closed" / "Upcoming" + time remaining derived from `levelStartTime` + death-clock constant.
- **D-06** Terminal section renders only when `terminal.burns.length > 0`. Otherwise omitted entirely.
- **D-07** Activity-score cross-reference display. Read from `scoreBreakdown.totalBps` (same store path profile-panel uses).
- **D-08** Per-level display uses level scrubber. Subscribes to `replay.level` + `replay.player` + `replay.day` (mirrors baf-panel from Phase 54 but adds `replay.day`).

**Endpoints**
- **D-09** INTEG-03 spec follows INTEG-02/05 template. Endpoint: `GET /player/:address/decimator?level=N&day=M` returns `{ level, player, bucket, subbucket, effectiveAmount, weightedAmount, winningSubbucket, payoutAmount, roundStatus }`. Side-quest delivery: 3 atomic commits (feat/docs/test) in database repo.
- **D-10** INTEG-03 non-participant handling: bucket=null, subbucket=null, payoutAmount=null, roundStatus='not_eligible' when still eligible or 'open' otherwise. UI renders "No decimator activity at level N" empty state.

### Claude's Discretion

- Refresh cadence: on `replay.level` change (primary), `replay.player` change, `replay.day` change (since the level resolves from the day and since activity-score updates per-day).
- Multi-level view: initially shows only the level corresponding to `replay.level`. Full burn-history timeline is deferred.
- Empty states: "No decimator activity at level N" with sub-text "Player has not burned at this level" when bucket=null.
- Selected-player highlighting: player's bucket row gets `[aria-current="true"]`.
- Time-remaining display derivation: `levelStartTime` + decimator window config constant → "X hours remaining" / "Window closed".
- Whether to inline bucket-range derivation inside the panel OR extract a helper — recommendation: inline (see Section 10).
- Test file name: `play-decimator-panel.test.js` (follows Phase 54 naming convention).

### Deferred Ideas (OUT OF SCOPE)

- Full burn history timeline view (across all levels a player has burned) — nice-to-have, defer to v2.5+
- Animated subbucket reveal — polish, defer
- Comparative bucket analytics (how players in bucket N performed on average) — out of scope
- Decimator simulator (what-if tools) — out of scope
- Separate `<terminal-panel>` Custom Element — rejected per D-01; terminal is a sub-section

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DECIMATOR-01 | Decimator window state (open/closed, level, time remaining if applicable) | Section 7 (live pre-backend — `decimator.windowOpen` in extended-player response + `game.levelStartTime` arithmetic fallback) |
| DECIMATOR-02 | Per-player bucket/subbucket assignment per burned level | Section 8 (INTEG-03 spec — `{bucket, subbucket}` fields) |
| DECIMATOR-03 | Per-player burn weight + effective amount per level | Section 7 + Section 8 (partial pre-backend via `decimatorClaims[]`; full via INTEG-03 `{effectiveAmount, weightedAmount}`) |
| DECIMATOR-04 | Winning subbucket reveal + player's payout for resolved levels | Section 8 (INTEG-03 `{winningSubbucket, payoutAmount, roundStatus='closed'}`) |
| DECIMATOR-05 | Terminal decimator state (burns, weighted amount, time-multiplier) when applicable | Section 7 (existing `terminal.burns[]` array in extended-player response shipped by INTEG-02) |
| INTEG-03 (hard gate) | Per-player decimator bucket/payout endpoint | Section 8 (full spec draft; data sources: `decimator_burns`, `decimator_bucket_totals`, `decimator_winning_subbuckets`, `decimator_rounds`, `jackpot_distributions`) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Window status label (DECIMATOR-01) | Browser | API | `decimator.windowOpen` boolean is already shipped in the extended `/player/:address?day=N` response. Browser reads + renders + derives time-remaining from `levelStartTime` delta. No new data needed. |
| Per-level bucket (DECIMATOR-02) | API (database) | Contracts | Backend reads `decimator_burns.(bucket, subBucket)` indexed columns populated by `DecBurnRecorded` event handler. Expression is `SELECT bucket, sub_bucket FROM decimator_burns WHERE player = ? AND level = ?` with optional block-scoping for `?day=M`. |
| Per-level effective + weighted amount (DECIMATOR-03) | API (database) | Contracts | Backend reads `decimator_burns.effectiveAmount` (same table). "Weighted amount" is `effectiveAmount` adjusted by bucket denominator — derive inline: `weightedAmount = effectiveAmount / bucket` (contract ground truth: `_decClaimableFromEntry` at `DegenerusGameDecimatorModule.sol:465-486` uses `(pool × playerBurn) / totalBurn` pro-rata — the "weight" is the effectiveAmount itself; the bucket/subBucket just partitions the pool). |
| Winning subbucket + payout (DECIMATOR-04) | API (database) | Contracts | Backend reads `decimator_winning_subbuckets` (level, bucket → winning subBucket) + `decimator_rounds.poolEth` (level → total ETH pool) + `decimator_bucket_totals` (level, bucket, subBucket → total burn). Pro-rata payout = `poolEth × playerBurn / totalBurn` WHEN player's subbucket == winning subbucket, else 0. |
| Terminal sub-section (DECIMATOR-05) | Browser | API | `terminal.burns[]` array already shipped in extended-player response per INTEG-02. Browser reads + renders + omits the whole section if `burns.length === 0`. |
| Activity-score cross-reference | Browser | — | Read from `scoreBreakdown.totalBps` in the same `/player/:address?day=N` response. Shared store path with `<profile-panel>`. No re-fetch. |
| Selected-player row highlighting | Browser | — | CSS-only: `[aria-current="true"]` on the player's bucket row + the row for the player's subbucket. |
| Time-remaining derivation | Browser | — | Pure arithmetic: `Math.max(0, (levelStartTime + DEATH_CLOCK_SECONDS - now) / 86400)`. Inline inside the panel. |
| Fetch coordination (stale-response guard) | Browser | — | Two counters: `#decimatorPlayerFetchId` (extended-player endpoint) + `#decimatorLevelFetchId` (INTEG-03 endpoint). Mirrors baf-panel pattern. |
| Day-scrub + level-scrub propagation | Browser | — | `subscribe('replay.level')` and `subscribe('replay.player')` trigger INTEG-03 refetch; `subscribe('replay.day')` triggers the extended-player refetch (for `terminal.burns` and activity-score). |
| SHELL-01 wallet-free enforcement | Browser | — | Recursive scan in `play-shell-01.test.js`. Wave 0 adds THREE new FORBIDDEN entries. |

## Reusable Assets Inventory

All paths absolute from `/home/zak/Dev/PurgeGame/website/`. SHELL-01 status detailed in Section 6.

### Direct reuse (import verbatim)

| Path | Purpose | Wallet-Free? | Notes |
|------|---------|--------------|-------|
| `beta/app/store.js` | Reactive Proxy store | YES | Phase 50-54 proven; `state.replay.{day, level, player}` namespace; `state.decimator.*` and `state.terminal.*` slots already exist but are populated only by wallet-mode beta code — play/ should NOT rely on them being populated |
| `beta/viewer/utils.js` | `formatEth`, `formatBurnie`, `truncateAddress`, `formatWei` | YES (explicit SHELL-01 comment at line 2) | Used by every Phase 51-54 panel; confirmed wallet-free |
| `play/app/constants.js` | `API_BASE` | YES | Re-export from `beta/app/constants.js`; pure data |

### Pattern-only (DO NOT import; wallet-tainted per Section 6)

| Path | Role | LOC | What To Copy |
|------|------|-----|--------------|
| `beta/components/decimator-panel.js` | Visual reference for structure | 246 | Panel-header + stats grid + burn-status messaging. The write-mode input (`decimator-burn-btn`) and claim button are out-of-scope for play/ (read-only). Copy the 4-cell stats row (lines 27-44) minus the burn-input-row (lines 47-55). |
| `beta/components/terminal-panel.js` | Visual reference for terminal sub-section | 328 | Payout preview (lines 43-50), insurance bar (lines 53-63 — optional, see Section 14 Q2), terminal burns section (lines 66-81). Skip the write-mode input + claim section. |
| `beta/app/decimator.js` | Helper — `computeBucket` + `computeMultiplier` pure functions | 103 | Lines 85-102 are PURE wallet-free logic but the file itself imports `ethers` at line 4. Re-implement the two helpers inline (see Section 10). |
| `beta/app/terminal.js` | Helper — `computeTimeMultiplier` | 97 | Lines 89-96 are pure wallet-free logic; re-implement inline. |
| `beta/styles/decimator.css` | Layout + stats grid styling | 116 | Stats-row grid (lines 22-45), window-badge (lines 13-20), hint text (lines 71-75). Drop burn-input + claim-section rules. |
| `beta/styles/terminal.css` | Terminal layout styling | 157 | Section headers + borders (lines 1-27), tickets row (lines 37-52), insurance bar (lines 54-78 optional), dec-info-row stats (lines 80-104). Drop burn-input + claim-section rules. |

### New helper modules (optional)

| Target | Why | LOC est |
|--------|-----|---------|
| `play/app/decimator-helpers.js` (OPTIONAL) | Inline versions of `computeBucket` + `computeMultiplier` + `computeTimeMultiplier` — but only useful if OTHER panels ever need them, which is unlikely. Recommendation: inline directly inside `<decimator-panel>` | ~40 |

**Recommendation:** Inline all three helpers inside the panel. 40 LOC of pure derivation doesn't warrant a separate file. The approach mirrors Phase 54's inline `bafContext()` decision (`baf-panel.js:58-71`, 14 LOC inlined per 54-RESEARCH recommendation).

### Files that MUST NOT be imported by play/ (SHELL-01)

| Forbidden | Why |
|-----------|-----|
| `beta/components/decimator-panel.js` | Already in SHELL-01 FORBIDDEN list (`play-shell-01.test.js:30`). Registers `customElements.define('decimator-panel', ...)` which would collide with play's own. Also transitively wallet-tainted via `beta/app/decimator.js` → ethers. |
| `beta/components/terminal-panel.js` | NOT currently in FORBIDDEN list. Registers `customElements.define('terminal-panel', ...)` but play/ does NOT register `terminal-panel` (per D-01 the terminal section lives INSIDE `<decimator-panel>`). Still must be forbidden because accidental import would register a competing custom element globally. Transitively wallet-tainted via `beta/app/terminal.js` → ethers. |
| `beta/app/decimator.js` | `import { ethers } from 'ethers'` at line 4 — direct wallet taint. |
| `beta/app/terminal.js` | `import { ethers } from 'ethers'` at line 6 — direct wallet taint. |
| `beta/app/utils.js` | Already in FORBIDDEN list; imports ethers at line 3. |
| `beta/app/contracts.js`, `beta/app/wallet.js`, `beta/app/coinflip.js`, `beta/app/baf.js` | Already in FORBIDDEN list from earlier phases. |

## SHELL-01 Transitive Audit (Q1)

**Question:** Before assuming CONTEXT D-02's "pattern-match only" is a precaution, verify whether `beta/components/decimator-panel.js` AND `beta/components/terminal-panel.js` AND `beta/app/decimator.js` AND `beta/app/terminal.js` have wallet-tainted imports. **Answer: ALL FOUR are tainted.**

### decimator-panel.js transitive graph

Source: `beta/components/decimator-panel.js:6-13`

```
beta/components/decimator-panel.js
├── ../app/store.js               [WALLET-FREE]
├── ../app/decimator.js           [TAINTED]
│   ├── ethers (bare specifier)             [WALLET TAINT — line 4]
│   ├── ./contracts.js                      [TAINTED via ethers]
│   ├── ./store.js                          [WALLET-FREE]
│   ├── ./constants.js                      [WALLET-FREE]
│   └── ./api.js                            [WALLET-FREE]
├── ../app/api.js                 [WALLET-FREE — fetchPlayerData itself is safe]
├── ../app/utils.js               [TAINTED — line 3: import { ethers }]
└── ../app/constants.js           [WALLET-FREE]
```

**Conclusion — HIGH confidence:** `beta/components/decimator-panel.js` is transitively wallet-tainted via TWO paths (`decimator.js` with its direct `import { ethers }` at line 4 AND `utils.js` with its direct `import { ethers }` at line 3). The component needs the write-side functions (`burnForDecimator`, `claimDecimatorJackpot`) for its button handlers that Phase 55 play/ does NOT need. A 1-line-patch approach would only partially work — two swaps would be needed and even then there would be a `customElements.define('decimator-panel', ...)` collision at the registry level.

**Implication:** CONTEXT D-02 is correct. Do NOT import `beta/components/decimator-panel.js` directly. Pattern-match the markup. The write-mode sections (burn input at beta:47-55, claim button at beta:56-60) are out-of-scope for play/ which is read-only.

### terminal-panel.js transitive graph

Source: `beta/components/terminal-panel.js:6-14`

```
beta/components/terminal-panel.js
├── ../app/store.js               [WALLET-FREE]
├── ../app/terminal.js            [TAINTED]
│   ├── ethers (bare specifier)             [WALLET TAINT — line 6]
│   ├── ./contracts.js                      [TAINTED via ethers]
│   ├── ./store.js                          [WALLET-FREE]
│   ├── ./constants.js                      [WALLET-FREE]
│   └── ./api.js                            [WALLET-FREE]
├── ../app/api.js                 [WALLET-FREE]
├── ../app/utils.js               [TAINTED — line 3: import { ethers }]
└── ../app/constants.js           [WALLET-FREE]
```

**Conclusion — HIGH confidence:** `beta/components/terminal-panel.js` is transitively wallet-tainted via TWO paths (identical shape to decimator-panel.js's taint). Additionally, the file registers `customElements.define('terminal-panel', ...)` at line 328 — play/ must not import the file even as a one-line test otherwise the global registry is polluted for any other play/ test that exercises the DOM.

**Verification commands run at research time:**

```bash
grep -n "^import" beta/components/decimator-panel.js beta/components/terminal-panel.js
grep -n "ethers" beta/app/decimator.js beta/app/terminal.js beta/app/utils.js beta/app/contracts.js
```

Output:

```
beta/components/decimator-panel.js:6:  import { subscribe, get } from '../app/store.js';
beta/components/decimator-panel.js:7-10: import { burnForDecimator, claimDecimatorJackpot } from '../app/decimator.js';
beta/components/decimator-panel.js:11: import { fetchPlayerData } from '../app/api.js';
beta/components/decimator-panel.js:12: import { formatBurnie, formatEth } from '../app/utils.js';
beta/components/decimator-panel.js:13: import { DECIMATOR } from '../app/constants.js';

beta/components/terminal-panel.js:6:  import { subscribe, get } from '../app/store.js';
beta/components/terminal-panel.js:7-11: import { burnForTerminalDecimator, claimTerminalDecimator, fetchTerminalState } from '../app/terminal.js';
beta/components/terminal-panel.js:12: import { fetchPlayerData } from '../app/api.js';
beta/components/terminal-panel.js:13: import { formatEth, formatBurnie } from '../app/utils.js';
beta/components/terminal-panel.js:14: import { DECIMATOR } from '../app/constants.js';

beta/app/decimator.js:4:   import { ethers } from 'ethers';
beta/app/terminal.js:6:    import { ethers } from 'ethers';
beta/app/utils.js:3:       import { ethers } from 'ethers';
```

**Implication:** Pattern-match only (CONTEXT D-02). Extract CSS (Section 9) + layout structure (Section 10) + inline the three pure helpers from `beta/app/decimator.js:85-102` and `beta/app/terminal.js:89-96`. Do not import.

### Wave 0 guardrail update

Current `play/app/__tests__/play-shell-01.test.js:22-34` FORBIDDEN list (verified by reading the file at research time) includes:

```javascript
const FORBIDDEN = [
  { label: "bare 'ethers' specifier", pattern: /from\s+['"]ethers['"]/ },
  { label: 'beta/app/wallet.js',          pattern: ... },
  { label: 'beta/app/contracts.js',       pattern: ... },
  { label: 'beta/app/utils.js ...',       pattern: ... },
  { label: 'beta/components/connect-prompt.js',  pattern: ... },
  { label: 'beta/components/purchase-panel.js',  pattern: ... },
  { label: 'beta/components/coinflip-panel.js',  pattern: ... },
  { label: 'beta/components/decimator-panel.js', pattern: ... },    // ALREADY LISTED
  { label: 'beta/components/baf-panel.js ...',   pattern: ... },
  { label: 'beta/app/coinflip.js (Phase 54 ...)',pattern: ... },
  { label: 'beta/app/baf.js (Phase 54 ...)',     pattern: ... },
];
```

**Wave 0 addition proposal (three new entries):**

```javascript
  { label: 'beta/components/terminal-panel.js (Phase 55: wallet-tainted + tag-name collision)', pattern: /from\s+['"][^'"]*\/beta\/components\/terminal-panel\.js['"]/ },
  { label: 'beta/app/decimator.js (Phase 55: ethers at line 4)',                                pattern: /from\s+['"][^'"]*\/beta\/app\/decimator\.js['"]/ },
  { label: 'beta/app/terminal.js (Phase 55: ethers at line 6)',                                 pattern: /from\s+['"][^'"]*\/beta\/app\/terminal\.js['"]/ },
```

The existing `beta/components/decimator-panel.js` entry is preserved unchanged. Net count: FORBIDDEN array grows from 11 to 14 entries.

## Existing Endpoint Data Availability (Answer to Q2)

### `/player/:address?day=N` extended response (shipped Phase 51 INTEG-02)

**Handler:** `database/src/api/routes/player.ts:102-521`
**Schema:** `database/src/api/schemas/player.ts:3-104`

The extended response INCLUDES both a `decimator` block AND a `terminal` block. Phase 55 Wave 1 can ship DECIMATOR-01, DECIMATOR-03 partial, and DECIMATOR-05 live from this endpoint alone — no new backend work needed to unblock Wave 1.

**`decimator` block schema** (from `database/src/api/schemas/player.ts:68-78`):

```typescript
decimator: z.object({
  windowOpen: z.boolean(),
  activityScore: z.number(),            // count of decimator burns for player (NOT the bps score)
  claimablePerLevel: z.array(z.object({
    level: z.number(),
    ethAmount: z.string(),
    lootboxCount: z.number(),
    claimed: z.boolean(),
  })),
  futurePoolTotal: z.string(),          // wei-encoded ETH in futurePrizePool
}).nullable()
```

**Handler code** (from `database/src/api/routes/player.ts:412-433`):

```typescript
// --- Decimator (D-09) ---
const [gsRow] = await fastify.db
  .select({ decWindowOpen: gameState.decWindowOpen })
  .from(gameState)
  .where(eq(gameState.id, 1));

const decBurns = await fastify.db
  .select({ level: decimatorBurns.level })
  .from(decimatorBurns)
  .where(eq(decimatorBurns.player, address));

const [poolsRow] = await fastify.db
  .select({ futurePrizePool: prizePools.futurePrizePool })
  .from(prizePools)
  .where(eq(prizePools.id, 1));

const decimatorData = {
  windowOpen: gsRow?.decWindowOpen ?? false,
  activityScore: decBurns.length,                                // just a count, NOT the bps score
  claimablePerLevel: claims,                                      // from earlier query at line 366-374
  futurePoolTotal: poolsRow?.futurePrizePool ?? '0',
};
```

**Wave 1 can read:**
- `decimator.windowOpen` → DECIMATOR-01 "open/closed" label (authoritative singleton from `game_state` table)
- `decimator.claimablePerLevel[].{level, ethAmount, lootboxCount, claimed}` → DECIMATOR-03 partial (ethAmount is the pro-rata payout per level; this is the TOTAL payout NOT the per-bucket weighted contribution); DECIMATOR-04 partial (ethAmount is the payout — but WITHOUT the winning-subbucket reveal)
- `decimator.futurePoolTotal` → contextual display of the source-of-truth pool backing the decimator draws

**Wave 1 CANNOT get from this endpoint:**
- Bucket + subBucket per level (DECIMATOR-02)
- Effective amount + weighted amount per level (DECIMATOR-03 full — the `effectiveAmount` is in `decimator_burns` table but not exposed in the /player response)
- Winning subbucket for resolved levels (DECIMATOR-04 full)
- Time-remaining for the decimator window (DECIMATOR-01 full — needs `levelStartTime`)

**`terminal` block schema** (from `database/src/api/schemas/player.ts:79-86`):

```typescript
terminal: z.object({
  burns: z.array(z.object({
    level: z.number(),
    effectiveAmount: z.string(),          // wei-encoded BURNIE
    weightedAmount: z.string(),           // wei-encoded BURNIE, time-adjusted
    timeMultBps: z.number(),              // basis points (10000 = 1x)
  })),
}).nullable()
```

**Handler code** (from `database/src/api/routes/player.ts:435-446`):

```typescript
// --- Terminal (D-10) ---
const termBurns = await fastify.db
  .select({
    level: terminalDecimatorBurns.level,
    effectiveAmount: terminalDecimatorBurns.effectiveAmount,
    weightedAmount: terminalDecimatorBurns.weightedAmount,
    timeMultBps: terminalDecimatorBurns.timeMultBps,
  })
  .from(terminalDecimatorBurns)
  .where(eq(terminalDecimatorBurns.player, address));

const terminalData = termBurns.length > 0 ? { burns: termBurns } : null;
```

**Wave 1 can read:**
- `terminal.burns[]` → DECIMATOR-05 (full). The array contains `{level, effectiveAmount, weightedAmount, timeMultBps}` per terminal burn. The response's `terminal` block is `null` when the player has NO terminal burns, which maps directly to CONTEXT D-06's render-conditional: `terminal !== null && terminal.burns.length > 0` renders the sub-section; otherwise skip.

**Verified endpoint shape** (reading schema file and handler): all six CONTEXT-required fields are present. **No new backend work needed for DECIMATOR-05.** This is the key insight that makes Wave 1 autonomous.

### `/game/state` endpoint (NOT polled by play/)

**Handler:** `database/src/api/routes/game-state.ts` (not read at research time; inferred via `beta/app/api.js:31-56` which consumes it)

This endpoint returns authoritative `{level, phase, gameOver, rngLocked, price, pools, decWindowOpen, levelStartTime, jackpotCounter, phaseTransitionActive, dailyRng}`. `beta/app/api.js:31-56` pollGameState() populates `state.game.*` from this endpoint. **play/ does NOT poll this endpoint** (confirmed via `grep pollGameState play/` = no matches; `grep game/state play/` = no matches). Only `replay.level` is populated in the play/ store (via `play/app/main.js:117-133` which fetches `/game/jackpot/day/{day}/winners`).

**Implication:** `state.game.levelStartTime` is NULL in the play/ store. The decimator panel CANNOT read it for time-remaining derivation. Options:

- **(A) Call `/game/state` directly from the decimator panel** — one extra fetch per day-change. Simple. Pollution-free (no shared store changes).
- **(B) Extend `play/app/main.js` to poll `/game/state`** — global change; affects OTHER panels potentially.
- **(C) Extend the `/player/:address?day=N` endpoint to include `levelStartTime`** — backend change; touches every consumer.
- **(D) Drop time-remaining display from DECIMATOR-01** — simplest. Just render "Open (Level N)" / "Closed" / "Upcoming". Time-remaining is nice-to-have, not a locked requirement.

**Recommendation:** (A) or (D). Phase 55 Wave 1 implements (D) — drop time-remaining, render just the state label. Wave 3 UAT can flag whether users want the time remaining; if so, a thin `play/app/game-state-fetch.js` wrapper (30 LOC) picks it up in a follow-up. This keeps Phase 55 focused and avoids scope creep.

### `/player/:address/activity-score[?day=N]` endpoint (shipped pre-Phase-51)

**Handler:** `database/src/api/routes/player.ts:42-100`

Returns `{address, scoreBps, day, blockNumber, historicalUnavailable}`. NOT called directly by the decimator panel per D-07 — instead, read `scoreBreakdown.totalBps` from the extended-player response (same source). D-07 explicitly says "Don't re-fetch — just read from the same store path the profile-panel uses."

**Verified:** `playerDashboardResponseSchema.scoreBreakdown.totalBps` is `z.number().int()` at `database/src/api/schemas/player.ts:12`. Already populated by the Phase 51 Wave 2 handler. Phase 55 decimator-panel just needs to read `data.scoreBreakdown?.totalBps` from its existing `/player/:address?day=N` fetch.

### Database tables already populated (no new schema needed for INTEG-03)

Verified via `database/src/db/schema/decimator.ts:1-131`:

| Table | Columns relevant to INTEG-03 | Indexed |
|-------|------------------------------|---------|
| `decimator_burns` | `(player, level, bucket, subBucket, effectiveAmount, totalBurn, blockNumber, blockHash)` | UNIQUE(player, level); INDEX(level) |
| `decimator_bucket_totals` | `(level, bucket, subBucket, totalBurn, blockNumber, blockHash)` | UNIQUE(level, bucket, subBucket) |
| `decimator_winning_subbuckets` | `(level, bucket, winningSubBucket, blockNumber, blockHash)` | UNIQUE(level, bucket) |
| `decimator_rounds` | `(level, poolEth, vrfWord, totalQualifyingBurn, packedOffsets, resolved, blockNumber, blockHash)` | UNIQUE(level) |
| `decimator_claims` | `(player, level, ethAmount, lootboxAmount, lootboxCount, claimed, blockNumber, ...)` | UNIQUE(player, level) |
| `terminal_decimator_burns` | `(player, level, bucket, subBucket, effectiveAmount, weightedAmount, timeMultBps, blockNumber, ...)` | INDEX(player); INDEX(level) |
| `terminal_decimator_claims` | `(player, level, ethAmount, blockNumber, ...)` | UNIQUE(player, level); INDEX(level) |

**All data needed for INTEG-03 is already indexed.** The endpoint is purely a JOIN + derive query across four tables. See Section 8.

## INTEG-03 Endpoint Spec Draft (Answer to Q3)

**This section is the Wave 0 INTEG-03-SPEC.md content.** The planner materializes this as `.planning/phases/55-decimator/INTEG-03-SPEC.md` using Phase 54's `INTEG-05-SPEC.md` (238 LOC) as the structural template. Below is the complete draft content.

### Why This Endpoint Is Needed

DECIMATOR-02 + DECIMATOR-04 are *per-level, per-player* surfaces. The existing `/player/:address?day=N` `decimator` block returns a flat `claimablePerLevel` array of `{level, ethAmount, lootboxCount, claimed}` — that gives the payout-per-level (DECIMATOR-04 *partial*) but does NOT reveal the bucket assignment, the subbucket, the raw effective burn amount, the weighted amount, or the winning subbucket for the level. No existing endpoint exposes any of that.

A new endpoint class is cleanest: it doesn't pollute `/player/:address` (one of the largest dashboard endpoints) and keeps the decimator-specific join + derive logic colocated with decimator data. The pattern is identical to INTEG-05's `/player/:address/baf?level=N` — a per-player per-level focused read.

DECIMATOR-03 *full* requires the bucket denominator (to derive "weighted amount" as `effectiveAmount / bucket`). That too needs the new endpoint.

### Endpoint

`GET /player/:address/decimator?level=N&day=M`

### Path Parameters

- `:address` — 42-char `0x...` Ethereum address, lowercased (validated via `addressParamSchema` — same as INTEG-01, INTEG-02, INTEG-05).

### Query Parameters

- `level` (required, integer ≥ 1) — decimator level. Required because the data is per-level; there's no meaningful "no level" state for a decimator round.
- `day` (optional, integer ≥ 1) — day-scoping for historical queries. When supplied, `bucket`, `subbucket`, `effectiveAmount`, `weightedAmount`, and `winningSubbucket` are resolved as of the end-of-day-M block (block-scoped via `blockNumber <= endBlock` filter on each query). When omitted, returns latest state. Pattern matches INTEG-01 (`/tickets/by-trait`) and INTEG-05 (`/baf`).

**Recommendation:** Require `level`, accept optional `day`. Frontend always supplies `level` (from `state.replay.level`); `day` is supplied when the scrubber is at a historical day.

### Response JSON Schema

```json
{
  "level": 20,
  "player": "0x71be63f3384f5fb98995898a86b02fb2426c5788",
  "bucket": 7,
  "subbucket": 3,
  "effectiveAmount": "5832100000000000000000",
  "weightedAmount": "833157142857142857142",
  "winningSubbucket": 3,
  "payoutAmount": "41235700000000000000",
  "roundStatus": "closed"
}
```

Field notes:

- `level` — echo of `?level=N` query parameter
- `player` — echo of `:address` path parameter (lowercased)
- `bucket` — integer 2-12 (bucket 2 only possible at every level % 100 == 0; otherwise 5-12); `null` if player did not burn at this level. *Range documented in Pitfall 1 — CONTEXT D-03 is incorrect.*
- `subbucket` — integer 0 to bucket-1 (e.g., if bucket=7 then subbucket ∈ {0,1,2,3,4,5,6}); `null` if player did not burn at this level
- `effectiveAmount` — wei-encoded BURNIE as decimal string; the base amount + activity-score boost + boon multiplier accumulated for this player at this level. Source: `decimator_burns.effectiveAmount`. Returns `"0"` if the player has no burn at this level.
- `weightedAmount` — wei-encoded BURNIE as decimal string; the effectiveAmount divided by the bucket denominator (per contract math at `DegenerusGameDecimatorModule.sol:465-486`). The weighted amount is the contributor share — lower bucket = larger weighted share. Returns `"0"` if the player has no burn at this level.
- `winningSubbucket` — integer 0 to bucket-1; `null` if the round has not been resolved (roundStatus=`'open'`) OR the level is still `'not_eligible'`. For resolved rounds (`'closed'`), this is the winning subbucket for the player's bucket (looked up from `decimator_winning_subbuckets` on the `(level, bucket)` tuple).
- `payoutAmount` — wei-encoded ETH as decimal string; the pro-rata ETH share the player receives from this round. Returns `"0"` if the player did not burn OR the player's subbucket != winningSubbucket. Sourced from `decimator_claims.ethAmount` for the `(player, level)` tuple OR computed on-the-fly as `pool_eth * playerBurn / totalBurn` if `decimator_claims` row hasn't been created yet (claim not issued).
- `roundStatus` — one of `"open"` | `"closed"` | `"not_eligible"`. See derivation.

### Edge cases

| Condition | bucket | subbucket | effectiveAmount | weightedAmount | winningSubbucket | payoutAmount | roundStatus |
|-----------|--------|-----------|-----------------|----------------|------------------|--------------|-------------|
| Player burned at level, round open | 7 | 3 | "5832e21" | "833e21" | null | "0" | "open" |
| Player burned at level, round closed, won | 7 | 3 | "5832e21" | "833e21" | 3 | "4.12e19" | "closed" |
| Player burned at level, round closed, lost | 7 | 4 | "5832e21" | "833e21" | 3 | "0" | "closed" |
| Player did NOT burn at level (any state) | null | null | "0" | "0" | null (if open) / 3 (if closed) | "0" | "open" / "closed" |
| Level has NO decimator round (not eligible) | null | null | "0" | "0" | null | "0" | "not_eligible" |

### `roundStatus` Derivation

Three states (simpler than INTEG-05's four — decimator rounds don't have a "skipped" path because the coinflip-loss gate applies to BAF only):

1. **`"not_eligible"`** — The level has no decimator round. A decimator round is triggered by contract logic at specific levels (every level except the last level in a 100-cycle where terminal-decimator takes over, and outside the active-game phase). Derivation: `NOT EXISTS (SELECT 1 FROM decimator_rounds WHERE level = ?)` AND `NOT EXISTS (SELECT 1 FROM decimator_burns WHERE level = ?)`.
2. **`"closed"`** — Round exists AND has been resolved. Derivation: `EXISTS (SELECT 1 FROM decimator_rounds WHERE level = ? AND resolved = true)`.
3. **`"open"`** — Round exists (either in `decimator_rounds` OR at least one `decimator_burns` row at the level exists) AND not yet resolved. Default.

Backend pseudo-code:

```sql
-- Prefer the authoritative decimator_rounds row
IF EXISTS (SELECT 1 FROM decimator_rounds WHERE level = ? AND resolved = true) THEN
  roundStatus := 'closed'
ELSIF EXISTS (SELECT 1 FROM decimator_rounds WHERE level = ? AND resolved = false) THEN
  roundStatus := 'open'
ELSIF EXISTS (SELECT 1 FROM decimator_burns WHERE level = ?) THEN
  -- Burns exist but no decimator_rounds row yet (indexer lag or round not snapshot-ed)
  roundStatus := 'open'
ELSE
  roundStatus := 'not_eligible'
```

### Contract-Call Map

| Response field | Primary source | Notes |
|----------------|----------------|-------|
| `level` | Query echo | From `?level=N` |
| `player` | Path echo | Validated via `addressParamSchema`; lowercased |
| `bucket` | `decimator_burns.bucket` | Filtered by `(player, level)`; null if no row |
| `subbucket` | `decimator_burns.subBucket` | Filtered by `(player, level)`; null if no row |
| `effectiveAmount` | `decimator_burns.effectiveAmount` | Filtered by `(player, level)`; returns '0' if no row |
| `weightedAmount` | Derived: `effectiveAmount / bucket` | Computed as BigInt divide (NOT wei-scale divide); returns '0' if no row |
| `winningSubbucket` | `decimator_winning_subbuckets.winningSubBucket` | Filtered by `(level, bucket)` tuple — requires bucket from prior query; null if round not closed |
| `payoutAmount` | `decimator_claims.ethAmount` OR derived from pool/totalBurn | Filtered by `(player, level)`; returns '0' if no row; derivation uses `decimator_rounds.poolEth` + `decimator_bucket_totals.totalBurn` for on-the-fly computation |
| `roundStatus` | See derivation above | Two-table query: `decimator_rounds` + `decimator_burns` |

### Proposed Backend Implementation

Handler file: extend `database/src/api/routes/player.ts` (where INTEG-01 `/tickets/by-trait` at lines 556-705 and INTEG-05 `/baf` at lines 707-862 already landed; place the new handler just after INTEG-05 for a consistent grouping).

Schema imports to add at top of routes/player.ts (imports already exist for the schema file):

```typescript
import { decimatorBurns, decimatorBucketTotals, decimatorWinningSubbuckets, decimatorRounds, decimatorClaims } from '../../db/schema/decimator.js';
// (decimatorClaims + decimatorBurns already imported at line 4; add the other three)
import {
  ...,
  decimatorQuerySchema,
  decimatorPlayerResponseSchema,
} from '../schemas/player.js';
```

Handler:

```typescript
// INTEG-03 (Phase 55): GET /player/:address/decimator?level=N[&day=M]
// Returns a player's decimator bucket, subbucket, burn amounts, and (for resolved
// rounds) the winning subbucket + payout at the specified level.
//
// Core joins:
//   decimator_burns               -> bucket, subBucket, effectiveAmount
//   decimator_winning_subbuckets  -> winningSubBucket (only for closed rounds)
//   decimator_rounds              -> resolved flag + poolEth for roundStatus
//   decimator_claims              -> authoritative payoutAmount (fallback derivation)
//   decimator_bucket_totals       -> denominator for on-the-fly payout compute
//
// Day resolution: when ?day=M is supplied, scope each query to blockNumber <= endBlock
// via daily_rng lookup. Mirrors the INTEG-01 and INTEG-05 pattern.
fastify.get('/:address/decimator', {
  schema: {
    params: addressParamSchema,
    querystring: decimatorQuerySchema,
    response: {
      200: decimatorPlayerResponseSchema,
      400: errorResponseSchema,
      404: errorResponseSchema,
    },
  },
}, async (request, reply) => {
  const { address } = request.params;
  const { level, day } = request.query;

  // --- Optional day resolution (mirrors /:address/baf pattern) ---
  let endBlock: bigint | undefined;
  if (day != null) {
    const rows = await fastify.db.execute(sql`
      SELECT day, "blockNumber" FROM daily_rng
      WHERE day IN (${day}, ${day + 1})
      ORDER BY day
    `);
    const list = (((rows as any).rows ?? rows) as any[]);
    const thisDay = list.find((r: any) => Number(r.day) === day);
    if (!thisDay) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'day_not_found', day });
    }
    const nextDay = list.find((r: any) => Number(r.day) === day + 1);
    if (nextDay) {
      endBlock = BigInt(nextDay.blockNumber ?? nextDay.blocknumber) - 1n;
    }
  }

  // --- Player burn row (bucket + subBucket + effectiveAmount) ---
  const burnWhere = endBlock != null
    ? and(
        eq(decimatorBurns.player, address),
        eq(decimatorBurns.level, level),
        lte(decimatorBurns.blockNumber, endBlock),
      )
    : and(eq(decimatorBurns.player, address), eq(decimatorBurns.level, level));

  const [burnRow] = await fastify.db
    .select({
      bucket: decimatorBurns.bucket,
      subBucket: decimatorBurns.subBucket,
      effectiveAmount: decimatorBurns.effectiveAmount,
    })
    .from(decimatorBurns)
    .where(burnWhere);

  const bucket = burnRow?.bucket ?? null;
  const subbucket = burnRow?.subBucket ?? null;
  const effectiveAmount = burnRow?.effectiveAmount ?? '0';

  // --- Weighted amount = effectiveAmount / bucket (BigInt divide) ---
  let weightedAmount = '0';
  if (bucket != null && bucket > 0 && effectiveAmount !== '0') {
    weightedAmount = (BigInt(effectiveAmount) / BigInt(bucket)).toString();
  }

  // --- Round status derivation ---
  let roundStatus: 'open' | 'closed' | 'not_eligible';
  const roundWhere = endBlock != null
    ? and(eq(decimatorRounds.level, level), lte(decimatorRounds.blockNumber, endBlock))
    : eq(decimatorRounds.level, level);
  const [roundRow] = await fastify.db
    .select({ resolved: decimatorRounds.resolved, poolEth: decimatorRounds.poolEth })
    .from(decimatorRounds)
    .where(roundWhere)
    .limit(1);

  if (roundRow?.resolved) {
    roundStatus = 'closed';
  } else if (roundRow) {
    roundStatus = 'open';
  } else if (bucket != null) {
    // Burns exist, no rounds row yet (indexer lag) — treat as open
    roundStatus = 'open';
  } else {
    roundStatus = 'not_eligible';
  }

  // --- Winning subbucket (only meaningful when round is closed + bucket known) ---
  let winningSubbucket: number | null = null;
  if (roundStatus === 'closed' && bucket != null) {
    const winWhere = endBlock != null
      ? and(eq(decimatorWinningSubbuckets.level, level), eq(decimatorWinningSubbuckets.bucket, bucket), lte(decimatorWinningSubbuckets.blockNumber, endBlock))
      : and(eq(decimatorWinningSubbuckets.level, level), eq(decimatorWinningSubbuckets.bucket, bucket));
    const [winRow] = await fastify.db
      .select({ winningSubBucket: decimatorWinningSubbuckets.winningSubBucket })
      .from(decimatorWinningSubbuckets)
      .where(winWhere)
      .limit(1);
    winningSubbucket = winRow?.winningSubBucket ?? null;
  }

  // --- Payout amount ---
  let payoutAmount = '0';
  if (bucket != null && subbucket != null && winningSubbucket != null && subbucket === winningSubbucket) {
    // Prefer authoritative decimator_claims row if present
    const claimWhere = endBlock != null
      ? and(eq(decimatorClaims.player, address), eq(decimatorClaims.level, level), lte(decimatorClaims.blockNumber, endBlock))
      : and(eq(decimatorClaims.player, address), eq(decimatorClaims.level, level));
    const [claimRow] = await fastify.db
      .select({ ethAmount: decimatorClaims.ethAmount })
      .from(decimatorClaims)
      .where(claimWhere);

    if (claimRow?.ethAmount && claimRow.ethAmount !== '0') {
      payoutAmount = claimRow.ethAmount;
    } else if (roundRow?.poolEth && roundRow.poolEth !== '0') {
      // Fallback: compute pro-rata from pool + winning subbucket's totalBurn
      const [totalsRow] = await fastify.db
        .select({ totalBurn: decimatorBucketTotals.totalBurn })
        .from(decimatorBucketTotals)
        .where(and(
          eq(decimatorBucketTotals.level, level),
          eq(decimatorBucketTotals.bucket, bucket),
          eq(decimatorBucketTotals.subBucket, winningSubbucket),
        ));
      if (totalsRow?.totalBurn && totalsRow.totalBurn !== '0') {
        const pool = BigInt(roundRow.poolEth);
        const playerBurn = BigInt(effectiveAmount);
        const denom = BigInt(totalsRow.totalBurn);
        payoutAmount = denom > 0n
          ? ((pool * playerBurn) / denom).toString()
          : '0';
      }
    }
  }

  return {
    level,
    player: address,
    bucket,
    subbucket,
    effectiveAmount,
    weightedAmount,
    winningSubbucket,
    payoutAmount,
    roundStatus,
  };
});
```

### New Schema Definitions

Add to `database/src/api/schemas/player.ts`:

```typescript
// INTEG-03 (Phase 55): GET /player/:address/decimator?level=N[&day=M]
export const decimatorQuerySchema = z.object({
  level: z.coerce.number().int().min(1),
  day: z.coerce.number().int().min(1).optional(),
});

export const decimatorPlayerResponseSchema = z.object({
  level: z.number().int(),
  player: z.string(),
  bucket: z.number().int().nullable(),
  subbucket: z.number().int().nullable(),
  effectiveAmount: z.string(),
  weightedAmount: z.string(),
  winningSubbucket: z.number().int().nullable(),
  payoutAmount: z.string(),
  roundStatus: z.enum(['open', 'closed', 'not_eligible']),
});
```

### Error Modes

| Status | Condition | Response |
|--------|-----------|----------|
| 200 | Player burned at level, any round state | Full payload with non-null bucket + subbucket |
| 200 | Player did NOT burn at level | Full payload, bucket=null, subbucket=null, amounts='0'; roundStatus reflects level-level state |
| 200 | Level has no decimator round AND no burns | Full payload, all nulls/zeros; roundStatus='not_eligible' |
| 400 | `level` missing or invalid | `{ statusCode: 400, error: "Bad Request", message: "..." }` (Zod validation handles this) |
| 404 | `?day=M` supplied but day does not exist in `daily_rng` | `{ statusCode: 404, error: "Not Found", message: "day_not_found", day: M }` |

### Acceptance Criteria

- Endpoint reachable at `GET /player/:address/decimator?level=N` (day optional)
- `bucket` matches the contract-assigned bucket (range 2-12; validated against `_adjustDecimatorBucket` contract logic for a known player at a known level)
- `subbucket` is in range `[0, bucket-1]` per contract invariant
- `bucket === null` AND `subbucket === null` when the player did not burn at the level
- `effectiveAmount` matches `decimator_burns.effectiveAmount` for the (player, level) tuple
- `weightedAmount === BigInt(effectiveAmount) / BigInt(bucket)` when bucket != null, else `'0'`
- `winningSubbucket` matches `decimator_winning_subbuckets.winningSubBucket` when roundStatus = 'closed' AND bucket != null, else `null`
- `payoutAmount` matches `decimator_claims.ethAmount` when claim row exists; otherwise computed as `pool * playerBurn / totalBurn` for the winning (bucket, subbucket)
- `payoutAmount === '0'` when the player's subbucket != winningSubbucket
- `roundStatus === 'not_eligible'` when no `decimator_rounds` row exists AND no burns exist at the level
- `roundStatus === 'closed'` when `decimator_rounds.resolved = true`
- `roundStatus === 'open'` when rounds row exists but not resolved, OR burns exist but rounds row absent (indexer lag)
- `?day=M` correctly scopes each query to `blockNumber <= endBlock`

### Timeline

Same pattern as INTEG-01 (Phase 52), INTEG-02 (Phase 51), and INTEG-05 (Phase 54) — 3 atomic commits on `database/main`:

1. **Commit 1 — `feat(api): add GET /player/:address/decimator endpoint (INTEG-03)`** — handler + schema definitions
2. **Commit 2 — `docs(openapi): document /player/:address/decimator (INTEG-03)`** — openapi.json update
3. **Commit 3 — `test(api): cover INTEG-03 happy path, bucket null, empty level, not_eligible, closed, day-scoped`** — Vitest tests

Precedent shipped in ~3-5 minutes per prior INTEG side-quest. INTEG-03 is slightly more complex than INTEG-05 (more table joins + more derivation logic) so budget 10-15 minutes for careful implementation.

### Open Questions (for INTEG-03 spec)

1. **Should the endpoint accept `?day=M` as the primary query (resolving to latest level at day M) instead of requiring `?level=N`?** No — decimator is level-scoped; day maps to a single level, but the inverse is lossy (a level spans many days). Keep `?level=N` primary; `?day=M` as optional historical scoping.
2. **Should the endpoint return multiple bucket rows (in case a player burned at the level twice with different buckets)?** Per `decimator_burns` UNIQUE(player, level), the answer is no — one row per (player, level). The contract logic at `DegenerusGameDecimatorModule.sol:147-158` confirms: first burn sets bucket; subsequent burns can only IMPROVE the bucket (migrate to lower). So final `bucket` is the best-seen; `effectiveAmount` is cumulative.
3. **Should the endpoint expose `totalBurn` (the whole-subbucket total) so the frontend can compute pro-rata?** No — the backend does the computation (`payoutAmount` field). Exposing raw totals would leak implementation detail and couple frontend to contract math. Derived field is better.
4. **Is `weightedAmount` the right name?** The contract math uses `effectiveAmount / bucket` conceptually as the player's "weighted contribution" to the subbucket, but the actual pro-rata divides `effectiveAmount` (full, unweighted) by `totalBurn` at resolution. "Weighted" is a UI-facing term; the BACKEND exposes `weightedAmount = effectiveAmount / bucket` as a convenience for the UI to display "your weighted contribution tier". This is a semantic choice — alternative names: `bucketNormalizedAmount`, `perBucketShare`. Stick with `weightedAmount`; document in the openapi description.
5. **Should `?level=N` return 404 for invalid levels (e.g., negative, zero) or 400?** 400 (via Zod `z.coerce.number().int().min(1)` validation). 404 is reserved for valid-shape-but-missing-data cases (e.g., `?day=M` where day doesn't exist).

### Confidence

- **HIGH** on the need + path (new endpoint class; no conflict with existing routes)
- **HIGH** on data sources (five tables all already indexed by existing handlers — `decimator_burns`, `decimator_bucket_totals`, `decimator_winning_subbuckets`, `decimator_rounds`, `decimator_claims` — verified via `database/src/db/schema/decimator.ts`)
- **HIGH** on roundStatus derivation (two-table query with short-circuit cascade; decimator_rounds.resolved is authoritative)
- **HIGH** on contract math for `weightedAmount` derivation (`DegenerusGameDecimatorModule.sol:465-486` read at research time)
- **MEDIUM** on the payout computation fallback path (pool * playerBurn / totalBurn when claim row is absent). Correctness depends on `decimator_bucket_totals` being populated in sync with `decimator_rounds`. If indexer ordering can put burns AFTER a round resolves (rare edge case), the totalBurn used could be stale. Verify with test case: a player who burned but hasn't claimed yet. Low risk in practice.
- **MEDIUM** on the Drizzle SQL builder translating BigInt divisions correctly. JavaScript BigInt in the handler is fine; the SQL-level is avoided (we pull raw strings and divide in JS). Risk LOW.

## Prominence / Bucket Table Styling Extraction from beta (Answer to Q4)

### Source: `beta/styles/decimator.css` (116 LOC)

The beta decimator panel is a STATS-row layout (4 cells), not a bucket-table layout. Beta does NOT render a bucket table — it renders the player's single bucket as a stat cell. Phase 55 D-03 introduces the bucket-table concept as a NEW layer relative to beta.

**Critical rules (line numbers from `beta/styles/decimator.css`):**

**Panel header + window badge (lines 7-20):**

```css
.decimator-panel .panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.decimator-window-badge {
  background: var(--accent-primary);
  color: var(--bg-primary);
  padding: 0.25rem 0.75rem;
  border-radius: 1rem;
  font-size: 0.8rem;
  font-weight: 600;
}
```

**Stats row — 4-cell grid (lines 22-45):**

```css
.decimator-info-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin: 1rem 0;
}
.decimator-info-row .stat { text-align: center; }
.decimator-info-row .stat-label {
  font-size: 0.75rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.decimator-info-row .stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-top: 0.25rem;
}
```

**Winner highlight (lines 105-108):**

```css
.decimator-winner {
  border-color: var(--accent-primary);
  box-shadow: 0 0 12px rgba(245, 166, 35, 0.15);
}
```

**Mobile breakpoint (lines 110-115):**

```css
@media (max-width: 480px) {
  .decimator-info-row {
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
  }
}
```

### Source: `beta/styles/terminal.css` (157 LOC)

Key subsection layout styles:

**Section header (lines 1-5):** panel-header h2 in red (`var(--danger)`) to visually separate from normal decimator.

**Section blocks (lines 6-27):** `.terminal-payout-section`, `.terminal-insurance-section`, `.terminal-dec-section` with 1.25rem vertical spacing + bottom-border separators.

**Tickets row (lines 37-52):** `.terminal-tickets-row` flex with a large accent-colored value — Phase 55 skips this per scope (no "tickets at level+1" display; that's part of v2.5 `TERM-xx` deferred per REQUIREMENTS.md line 101).

**Insurance bar (lines 54-78):** `.terminal-insurance-bar-wrap` + animated width transition — Phase 55 OMITS per scope decision. See Section 14 Q2 for the optional-include discussion.

**Dec stats row (lines 80-104):** `.terminal-dec-info-row` is 3-cell grid (vs decimator's 4-cell) — Phase 55 adapts this for the terminal sub-section when shown.

### Proposed `play.css` additions (Phase 55 Wave 1)

Under a `.play-decimator-panel` scope (no global scope; keeps play/ self-contained), add ~140 LOC:

```css
/* --- Decimator panel (Phase 55) --- */

.play-decimator-panel {
  /* inherits .panel from panels.css */
}

.play-decimator-panel .panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.play-decimator-panel .panel-title {
  margin: 0;
}

/* D-05 window status badge */
.play-decimator-window-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 1rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.play-decimator-window-badge[data-status="open"] {
  background: rgba(34, 197, 94, 0.15);
  color: var(--success);
}
.play-decimator-window-badge[data-status="closed"] {
  background: rgba(100, 100, 100, 0.2);
  color: var(--text-dim);
}
.play-decimator-window-badge[data-status="not_eligible"] {
  background: rgba(100, 100, 100, 0.1);
  color: var(--text-dim);
}

/* Context row: activity score + level label */
.play-decimator-context {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 0.75rem;
}

/* Stats row (burn + weighted + bucket + subbucket per resolved level) */
.play-decimator-stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin: 1rem 0;
}
.play-decimator-stats-row .stat {
  text-align: center;
}
.play-decimator-stats-row .stat-label {
  font-size: 0.75rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.play-decimator-stats-row .stat-value {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-top: 0.25rem;
}

/* D-04 payout pill */
.play-decimator-payout {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  border-radius: 6px;
  margin-top: 1rem;
  font-weight: 600;
}
.play-decimator-payout[data-won="true"] {
  border: 1px solid var(--accent-primary);
  background: rgba(245, 166, 35, 0.1);
  color: var(--accent-primary);
}
.play-decimator-payout[data-won="false"] {
  color: var(--text-dim);
}

/* D-03 bucket table — NEW relative to beta */
.play-decimator-bucket-table {
  margin-top: 1rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
}
.play-decimator-bucket-header {
  display: grid;
  grid-template-columns: 80px 1fr 100px;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 600;
}
.play-decimator-bucket-row {
  display: grid;
  grid-template-columns: 80px 1fr 100px;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border-color);
  font-size: 0.85rem;
}
.play-decimator-bucket-row[aria-current="true"] {
  background: var(--bg-tertiary);
  font-weight: 700;
  border-left: 3px solid var(--accent-primary);
}
.play-decimator-bucket-row[data-winning="true"] {
  background: rgba(34, 197, 94, 0.08);
}

/* Empty state */
.play-decimator-empty {
  padding: 1rem;
  text-align: center;
  color: var(--text-dim);
  font-size: 0.85rem;
}

/* Keep-old-data-dim (Phase 51+52+54 pattern) */
.play-decimator-panel [data-bind="content"].is-stale {
  opacity: 0.6;
  pointer-events: none;
}

/* --- Terminal sub-section (Phase 55 DECIMATOR-05) --- */

.play-terminal-section {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 2px solid var(--border-color);
}
.play-terminal-section h3 {
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--danger);
  margin-bottom: 0.5rem;
}
.play-terminal-burns {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
}
.play-terminal-burns-header {
  display: grid;
  grid-template-columns: 60px 1fr 1fr 80px;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 600;
}
.play-terminal-burn-row {
  display: grid;
  grid-template-columns: 60px 1fr 1fr 80px;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border-color);
  font-size: 0.85rem;
}

@media (max-width: 480px) {
  .play-decimator-stats-row {
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
  }
  .play-terminal-burns-header,
  .play-terminal-burn-row {
    grid-template-columns: 60px 1fr 80px;
    /* Drop the weighted-amount column on mobile */
  }
  .play-terminal-burns-header > :nth-child(3),
  .play-terminal-burn-row > :nth-child(3) {
    display: none;
  }
}
```

**Line count estimate:** ~150 LOC added to `play/styles/play.css` (currently 1081 LOC per `wc -l`). Target total after Phase 55: ~1230 LOC. Reasonable surface — comparable to Phase 54's +237 LOC.

## Custom Elements Structure (Answer to Q5)

### Recommendation: Single `<decimator-panel>` Custom Element with a conditional terminal sub-section

Per CONTEXT D-01 and D-06, Phase 55 ships ONE Custom Element. The terminal state is a conditionally-rendered sub-section inside the same panel template.

| Element | Role | Data sources | LOC est |
|---------|------|--------------|---------|
| `<decimator-panel>` | Renders window status badge (D-05), activity-score cross-ref (D-07), bucket-table with player row highlighted (D-03), payout pill for closed rounds (D-04), stats row (D-03 effective + weighted), and optional terminal sub-section (D-06). Subscribes to `replay.level` + `replay.player` + `replay.day`. | Extended `/player/:address?day=N` + INTEG-03 `/player/:address/decimator?level=N&day=M` | ~280-320 |

### `<decimator-panel>` sub-structure

1. **Header + window badge (D-05, top).** `<h2>DECIMATOR</h2>` with a status pill `"OPEN"` / `"CLOSED"` / `"UPCOMING"` / `"NOT ELIGIBLE"`. Sources: `decimator.windowOpen` (from extended-player fetch) → binary open/closed; `roundStatus` from INTEG-03 when wired → full 3-state; fallback to `game.phase === 'PURCHASE'` heuristic if all else fails. Wave 1 ships the binary open/closed; Wave 2 adds the 3-state.

2. **Context row (D-07, just below header).** "Activity score: X.XX | Level N" where X.XX is `scoreBreakdown.totalBps / 10000` and N is `replay.level`. Source: same extended-player fetch that every panel uses.

3. **Stats row (D-03, middle).** 4-cell grid: "Bucket" / "Subbucket" / "Effective" / "Weighted". Values from INTEG-03 (Wave 2 hydration). In Wave 1 this row shows `'--'` for all four cells.

4. **Bucket table (D-03 expansion, middle-bottom).** A table showing the full range of possible buckets at the current level. Each row = one bucket (2 through 12 at level%100, else 5 through 12). Player's assigned bucket gets `aria-current="true"`. This is the NEW-relative-to-beta render; see Pitfall 1 for the bucket range caveat.

5. **Payout pill (D-04).** For `roundStatus === 'closed'`: "You won 0.012 ETH" (green) OR "Not your subbucket" (muted). For `'open'`: "Round in progress". For `'not_eligible'`: "No decimator round at level N". Hidden when bucket is null AND roundStatus is 'open' (empty state).

6. **Terminal sub-section (D-05, D-06, bottom, CONDITIONAL).** Only rendered if `terminal !== null && terminal.burns.length > 0`. Contains:
   - Section header "TERMINAL" in red
   - Table of burns: `level` | `effectiveAmount` | `weightedAmount` | `timeMultBps → Nx` (e.g., `15000 → 1.50x`)
   - Short caption: "Death-bet burns with time-multiplier boost"

7. **Empty state.** When bucket=null AND roundStatus != 'not_eligible', render "No decimator activity at level N" — the panel still displays the window badge + context row + bucket table (but no aria-current row).

### Template shape (skeleton)

```html
<section data-slot="decimator" class="panel play-decimator-panel">

  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:60%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:120px"></div></div>
  </div>

  <div data-bind="content" hidden>

    <!-- D-05 window status -->
    <div class="panel-header">
      <h2 class="panel-title">Decimator</h2>
      <span class="play-decimator-window-badge" data-bind="window-status" data-status="">--</span>
    </div>

    <!-- D-07 activity-score + level context -->
    <div class="play-decimator-context">
      <span data-bind="activity-score">Activity score: --</span>
      <span data-bind="level-label">Level --</span>
    </div>

    <!-- D-03 stats row (bucket, subbucket, effective, weighted) -->
    <div class="play-decimator-stats-row">
      <div class="stat">
        <div class="stat-label">Bucket</div>
        <div class="stat-value" data-bind="bucket">--</div>
      </div>
      <div class="stat">
        <div class="stat-label">Subbucket</div>
        <div class="stat-value" data-bind="subbucket">--</div>
      </div>
      <div class="stat">
        <div class="stat-label">Effective burn</div>
        <div class="stat-value" data-bind="effective">--</div>
      </div>
      <div class="stat">
        <div class="stat-label">Weighted</div>
        <div class="stat-value" data-bind="weighted">--</div>
      </div>
    </div>

    <!-- D-04 payout pill (conditional on closed/open/not_eligible) -->
    <div class="play-decimator-payout" data-bind="payout" data-won="" hidden>
      <span data-bind="payout-label">--</span>
      <span data-bind="payout-amount">--</span>
    </div>

    <!-- D-03 bucket table -->
    <div class="play-decimator-bucket-table" data-bind="bucket-table">
      <div class="play-decimator-bucket-header">
        <span>Bucket</span><span>Status</span><span>Winning sub</span>
      </div>
      <div data-bind="bucket-rows">
        <!-- rows populated at render time (2-12 or 5-12) -->
      </div>
    </div>

    <!-- D-05 D-06 terminal sub-section (CONDITIONAL — only when terminal.burns.length > 0) -->
    <div class="play-terminal-section" data-bind="terminal-section" hidden>
      <h3>Terminal decimator</h3>
      <div class="play-terminal-burns">
        <div class="play-terminal-burns-header">
          <span>Level</span><span>Effective</span><span>Weighted</span><span>Multiplier</span>
        </div>
        <div data-bind="terminal-burn-rows">
          <!-- rows populated at render time -->
        </div>
      </div>
    </div>

  </div>
</section>
```

### Fetch strategy — TWO parallel fetches

- `/player/:address?day=N` — for DECIMATOR-01 (windowOpen), DECIMATOR-05 (terminal.burns), D-07 (scoreBreakdown.totalBps). Fired on `replay.player` or `replay.day` change.
- `/player/:address/decimator?level=N&day=M` — for DECIMATOR-02 (bucket + subbucket), DECIMATOR-03 (effective + weighted), DECIMATOR-04 (winningSubbucket + payoutAmount + roundStatus). Fired on `replay.player`, `replay.level`, OR `replay.day` change.

### Subscriptions

```javascript
this.#unsubs.push(
  subscribe('replay.level',  () => { this.#refetchLevel(); }),               // INTEG-03 only
  subscribe('replay.player', () => { this.#refetchPlayer(); this.#refetchLevel(); }),  // both
  subscribe('replay.day',    () => { this.#refetchPlayer(); this.#refetchLevel(); }),  // both (day → level resolution)
);
this.#refetchPlayer();
this.#refetchLevel();
```

### Why THREE subscriptions (not TWO like baf-panel)

Phase 54 `<baf-panel>` subscribes to `replay.level` + `replay.player` only (it's level-scoped, not day-scoped). Phase 55 `<decimator-panel>` also needs `replay.day` because:

1. `terminal.burns` comes from the extended `/player/:address?day=N` response, which IS day-scoped (terminal burns that happened BEFORE the scrubber day should be visible; terminal burns AFTER should not).
2. `scoreBreakdown.totalBps` is day-scoped (the player's activity score changes per day).
3. INTEG-03 supports optional `?day=M` for historical block-scoping; the panel passes the current `replay.day` as that argument.

Dropping any of the three subscriptions creates visible bugs: drop `replay.day` and the activity-score stops updating when the scrubber moves; drop `replay.level` and the bucket table doesn't re-render when the level context changes; drop `replay.player` and the panel never updates for a new selected player.

### Why no shared fetch helper (vs Phase 52's tickets-fetch.js)

Phase 52 introduced `play/app/tickets-fetch.js` because TWO panels (`<tickets-panel>` and `<packs-panel>`) wanted the SAME endpoint response. Deduplication at the wire level saved one HTTP request per day-change.

Phase 55 has no such overlap:

| Panel | Endpoint 1 | Endpoint 2 |
|-------|-----------|-----------|
| `<decimator-panel>` | `/player/:address?day=N` | `/player/:address/decimator?level=N&day=M` |

Both endpoints are already fetched by OTHER panels: `/player/:address?day=N` is fetched by profile-panel, coinflip-panel (Phase 54). There's room for a future shared player-fetch helper but that's an architectural refactor, not Phase 55 scope. **Recommendation:** each panel fetches independently. Consistent with Phase 54 decision (see 54-RESEARCH.md §10 "No shared fetch helper").

## Day-Aware + Level-Aware Fetch Pattern Reuse (Mirror baf-panel Dual-Signal Pattern)

The pattern is fully mature after Phases 51, 52, and 54. Phase 55 reuses `<baf-panel>`'s two-counter stale-guard structure and adds a third subscription. Adapted:

### `<decimator-panel>` fetch methods

```javascript
// Two stale-guard counters — mirrors baf-panel pattern (#bafFetchId + #bafPlayerFetchId).
#decimatorPlayerFetchId = 0;       // extended /player/:address?day=N (DECIMATOR-01 + DECIMATOR-05 + D-07)
#decimatorLevelFetchId  = 0;       // INTEG-03 /player/:address/decimator?level=N&day=M (DECIMATOR-02/03/04)
#loaded = false;

async #refetchPlayer() {
  const addr = get('replay.player');
  const day  = get('replay.day');
  const token = ++this.#decimatorPlayerFetchId;

  if (!addr || day == null) return;

  if (this.#loaded) {
    this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
  }

  try {
    const res = await fetch(`${API_BASE}/player/${addr}?day=${encodeURIComponent(day)}`);
    if (token !== this.#decimatorPlayerFetchId) return;
    const data = res.ok ? await res.json() : null;
    if (token !== this.#decimatorPlayerFetchId) return;

    this.#renderWindowStatus(data?.decimator?.windowOpen);             // DECIMATOR-01 pre-backend
    this.#renderActivityScore(data?.scoreBreakdown?.totalBps);        // D-07
    this.#renderTerminalSection(data?.terminal);                       // DECIMATOR-05
    this.#showContent();
    this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
  } catch (err) {
    if (token === this.#decimatorPlayerFetchId) {
      this.#renderPlayerError();
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
    }
  }
}

async #refetchLevel() {
  const addr  = get('replay.player');
  const level = get('replay.level');
  const day   = get('replay.day');
  const token = ++this.#decimatorLevelFetchId;

  if (!addr || level == null) return;

  try {
    const url = day != null
      ? `${API_BASE}/player/${addr}/decimator?level=${encodeURIComponent(level)}&day=${encodeURIComponent(day)}`
      : `${API_BASE}/player/${addr}/decimator?level=${encodeURIComponent(level)}`;
    const res = await fetch(url);
    if (token !== this.#decimatorLevelFetchId) return;

    if (!res.ok) {
      // INTEG-03 error path — fall back to data already rendered by #refetchPlayer.
      // The bucket table renders without aria-current; payout pill hidden.
      this.#renderLevelFallback(level);
      return;
    }

    const data = await res.json();
    if (token !== this.#decimatorLevelFetchId) return;

    this.#renderBucketAssignment(data);                                // DECIMATOR-02
    this.#renderBurnAmounts(data);                                     // DECIMATOR-03
    this.#renderPayout(data);                                          // DECIMATOR-04
    this.#renderRoundStatus(data.roundStatus);                         // D-05 full
  } catch (err) {
    if (token === this.#decimatorLevelFetchId) {
      this.#renderLevelFallback(level);
    }
  }
}
```

### Wave 1 vs Wave 2 gating

Wave 1 ships `#refetchLevel()` as a **safe-degrade stub** — the method exists, fetches the endpoint, and on 404 silently falls through to render the pre-populated state (window badge + activity score + terminal section). The bucket table renders empty rows (no aria-current). This matches the Phase 51 Wave-1-stub + Wave-2-flip pattern.

Wave 2 (post INTEG-03 ship) adds no code changes to the fetch method — the endpoint starts returning 200 and the render methods populate the table. The only Wave 2 code change is potentially tightening the error-path handling once the live endpoint's behaviour is known.

### Subscribe wiring

```javascript
this.#unsubs.push(
  subscribe('replay.level',  () => this.#refetchLevel()),
  subscribe('replay.player', () => { this.#refetchPlayer(); this.#refetchLevel(); }),
  subscribe('replay.day',    () => { this.#refetchPlayer(); this.#refetchLevel(); }),
);
this.#refetchPlayer();
this.#refetchLevel();
```

## Validation Architecture (Nyquist)

`workflow.nyquist_validation` not explicitly false in `.planning/config.json` — treat as enabled. (Per Phase 51/52/54 VALIDATION.md precedent.)

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node built-in) + `node:assert/strict` |
| Config file | none — test discovery via `node --test` glob args |
| Quick run command | `node --test play/app/__tests__/play-decimator-panel.test.js` |
| Full suite command | `node --test play/app/__tests__/*.test.js` |
| Estimated runtime | ~1-2 seconds for the new file; ~4-5 seconds for the full Phase 50-55 suite |

Tests are **contract-grep style** (source-file regex assertions). No JSDOM, no build, no runtime. Pattern verified by Phase 50-54 test files (~288 assertions green total per Phase 54 completion).

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DECIMATOR-01 | `<decimator-panel>` renders window-status badge with data-status attribute + data-bind="window-status" | contract-grep | `node --test play/app/__tests__/play-decimator-panel.test.js` | ❌ Wave 0 |
| DECIMATOR-02 | `<decimator-panel>` renders bucket + subbucket data-binds; renders bucket-table rows with aria-current on player row | contract-grep | same | ❌ Wave 0 |
| DECIMATOR-03 | `<decimator-panel>` renders effective + weighted data-binds | contract-grep | same | ❌ Wave 0 |
| DECIMATOR-04 | `<decimator-panel>` renders payout pill with data-won attribute; INTEG-03 fetch URL contains `/decimator?level=` | contract-grep | same | ❌ Wave 0 |
| DECIMATOR-05 | `<decimator-panel>` renders terminal-section with data-bind; uses `terminal.burns.length` conditional | contract-grep | same | ❌ Wave 0 |
| SHELL-01 (guardrail) | No new play/ files import forbidden paths; Wave 0 ADDS three new forbidden entries | recursive grep (existing) | `node --test play/app/__tests__/play-shell-01.test.js` | ✅ exists; needs Wave 0 edit |

### Proposed Wave 0 Test File Outline

**`play/app/__tests__/play-decimator-panel.test.js`** (~30-35 assertions, modeled on `play-baf-panel.test.js:1-254` which is the closest structural template):

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'decimator-panel.js');

// --- Existence + registration ---
test('decimator-panel.js exists', () => {
  assert.ok(existsSync(PANEL));
});
test('decimator-panel.js registers <decimator-panel>', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]decimator-panel['"]/);
});
test('decimator-panel.js defines class extending HTMLElement', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /class\s+\w+\s+extends\s+HTMLElement/);
});
test('decimator-panel.js has connectedCallback + disconnectedCallback', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /connectedCallback\s*\(\s*\)/);
  assert.match(src, /disconnectedCallback\s*\(\s*\)/);
});

// --- SHELL-01 (new FORBIDDEN entries for Phase 55) ---
test('SHELL-01: does NOT import beta/components/decimator-panel.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/components\/decimator-panel\.js['"]/);
});
test('SHELL-01: does NOT import beta/components/terminal-panel.js (collision + wallet-tainted)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/components\/terminal-panel\.js['"]/);
});
test('SHELL-01: does NOT import beta/app/decimator.js (ethers at line 4)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/decimator\.js['"]/);
});
test('SHELL-01: does NOT import beta/app/terminal.js (ethers at line 6)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/terminal\.js['"]/);
});
test('SHELL-01: does NOT import beta/app/utils.js (ethers at line 3)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});
test('SHELL-01: does NOT import ethers directly', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"]ethers['"]/);
});
test('decimator-panel.js imports from beta/viewer/utils.js (wallet-free)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/viewer\/utils\.js['"]/);
});
test('decimator-panel.js imports subscribe + get from reused beta store', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/app\/store\.js['"]/);
  assert.match(src, /subscribe/);
  assert.match(src, /\bget\b/);
});
test('decimator-panel.js imports API_BASE from play/app/constants.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/app\/constants\.js['"]/);
  assert.match(src, /API_BASE/);
});

// --- Store wiring: THREE subscriptions ---
test('decimator-panel.js subscribes to replay.level, replay.player, AND replay.day (D-08)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
});

// --- DECIMATOR-01: window status badge (D-05) ---
test('DECIMATOR-01: renders window-status data-bind with data-status attribute', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']window-status["']/);
  assert.match(src, /data-status/);
});

// --- DECIMATOR-02: bucket + subbucket + bucket table (D-03) ---
test('DECIMATOR-02: renders bucket + subbucket data-binds', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']bucket["']/);
  assert.match(src, /data-bind=["']subbucket["']/);
});
test('DECIMATOR-02: renders bucket-table container (D-03)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']bucket-table["']|data-bind=["']bucket-rows["']/);
});
test('DECIMATOR-02: uses aria-current for player row highlighting', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /aria-current/);
});

// --- DECIMATOR-03: effective + weighted burn amounts ---
test('DECIMATOR-03: renders effective + weighted data-binds', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']effective["']/);
  assert.match(src, /data-bind=["']weighted["']/);
});

// --- DECIMATOR-04: payout pill + winning subbucket ---
test('DECIMATOR-04: renders payout pill data-bind with data-won attribute', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']payout["']/);
  assert.match(src, /data-won/);
});

// --- DECIMATOR-04 / INTEG-03 fetch wiring ---
test('INTEG-03: fetches /player/${addr}/decimator?level=', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/player\/[^`'"]+\/decimator\?level=/);
});

// --- DECIMATOR-05: terminal sub-section conditional on burns.length ---
test('DECIMATOR-05: renders terminal-section data-bind', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']terminal-section["']/);
});
test('DECIMATOR-05: checks terminal.burns.length for conditional render (D-06)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /terminal[^.\n]*\.burns[^.\n]*\.length|burns\.length\s*(>|!==|\?)/);
});
test('DECIMATOR-05: renders terminal-burn-rows container', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']terminal-burn-rows["']/);
});

// --- Extended player fetch (DECIMATOR-01 + DECIMATOR-05 + D-07) ---
test('fetches /player/${addr}?day= (extended-player endpoint)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/player\/\$\{[^}]+\}\?day=|\/player\/[^`'"]+\?day=/);
});

// --- D-07 activity score cross-reference ---
test('D-07: reads scoreBreakdown.totalBps for activity score display', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /scoreBreakdown[^.\n]*\.totalBps|totalBps/);
});
test('D-07: renders activity-score data-bind', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']activity-score["']/);
});

// --- Dual stale-guards (mirrors baf-panel.js) ---
test('decimator-panel.js uses #decimatorPlayerFetchId stale-guard counter', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#decimatorPlayerFetchId/);
});
test('decimator-panel.js uses #decimatorLevelFetchId stale-guard counter (INTEG-03)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#decimatorLevelFetchId/);
});
test('decimator-panel.js toggles is-stale class for keep-old-data-dim', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});

// --- Skeleton + content pattern ---
test('decimator-panel.js has data-bind="skeleton" and data-bind="content"', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']skeleton["']/);
  assert.match(src, /data-bind=["']content["']/);
});
test('decimator-panel.js includes skeleton-shimmer', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /skeleton-shimmer/);
});

// --- Score-unit discipline (wei-scale amounts -> formatBurnie / formatEth) ---
test('score-unit: decimator-panel uses formatBurnie for BURNIE amounts', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /formatBurnie/);
});
test('score-unit: decimator-panel uses formatEth for ETH payout amounts', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /formatEth/);
});

// --- Bucket range inline derivation (per Pitfall 1: 2-12 or 5-12, NOT 1-8) ---
test('bucket-range: inline derivation uses 12 (BASE) and 5 or 2 (MIN_BUCKET)', () => {
  const src = readFileSync(PANEL, 'utf8');
  // Accept either direct literal 12 OR named constant via destructure from constants.js.
  // Direct literal check — panel must encode the bucket range somewhere.
  assert.match(src, /\b12\b/);
  assert.match(src, /\b(5|MIN_BUCKET_NORMAL)\b/);
});

// --- Empty state handling ---
test('decimator-panel.js handles empty state (no burn / bucket null)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /bucket\s*==\s*null|bucket\s*===\s*null|!bucket|No decimator activity/);
});
```

**`play/app/__tests__/play-shell-01.test.js` update** (Wave 0 edit, NOT a new file):

Add three entries to the `FORBIDDEN` array (append after the Phase 54 entries at line 33):

```javascript
{ label: 'beta/components/terminal-panel.js (Phase 55: wallet-tainted + tag-name collision)', pattern: /from\s+['"][^'"]*\/beta\/components\/terminal-panel\.js['"]/ },
{ label: 'beta/app/decimator.js (Phase 55: ethers at line 4)',                                pattern: /from\s+['"][^'"]*\/beta\/app\/decimator\.js['"]/ },
{ label: 'beta/app/terminal.js (Phase 55: ethers at line 6)',                                 pattern: /from\s+['"][^'"]*\/beta\/app\/terminal\.js['"]/ },
```

### Sampling Rate

- **Per task commit:** `node --test play/app/__tests__/play-decimator-panel.test.js` (< 1 second)
- **Per wave merge:** Full suite (`node --test play/app/__tests__/*.test.js`)
- **Phase gate:** Full suite + `play-shell-01.test.js` green + INTEG-03 endpoint live + optional UAT

### Wave 0 Gaps

- [ ] `play/app/__tests__/play-decimator-panel.test.js` — covers DECIMATOR-01..05 + SHELL-01 negatives + stale-guards + bucket-range + terminal-conditional + aria-current + empty state + score-unit discipline (~30-35 assertions)
- [ ] `play/app/__tests__/play-shell-01.test.js` — ADD three entries to FORBIDDEN array (terminal-panel.js, beta/app/decimator.js, beta/app/terminal.js)
- [ ] `.planning/phases/55-decimator/INTEG-03-SPEC.md` — author from Section 8 of this research
- [ ] (No REQUIREMENTS.md edit needed — DECIMATOR-01..05 and INTEG-03 are already listed; only their `Pending` status will flip to `Validated` at phase completion)

*(Existing `play-shell-01.test.js` provides recursive SHELL-01 coverage for the new play/ files — no new wallet-free guard test needed.)*

### Manual-Only Verifications (Wave 3, UAT-deferrable)

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Bucket table renders correct range per level type | DECIMATOR-02 / D-03 | Visual validation that bucket 2 shows only at level%100 levels | Load /play/, scrub to a level%100 = 0 level (e.g., level 100). Bucket table shows rows 2-12. Scrub to level 15. Bucket table shows rows 5-12. Rows 2-4 absent on non-x00 levels. |
| Player's bucket row is highlighted when they burned at the level | DECIMATOR-02 / D-03 | Visual check aria-current maps correctly | Select a player who burned at level 15 with bucket 7. Scrub to level 15. Row for bucket 7 is highlighted with border-left + bg-tertiary; all other rows are default. |
| Payout pill shows correct state for open/closed/not-eligible rounds | DECIMATOR-04 / D-04 | Visual state machine | Scrub across levels. On open round: pill shows "Round in progress" (muted). On closed + won: pill shows "You won X.XX ETH" (accent color + green bg). On closed + lost: pill shows "Not your subbucket" (muted). On not-eligible: pill shows "No decimator round at level N". |
| Winning subbucket cell in bucket table highlights correctly on resolved rounds | DECIMATOR-04 / D-03 | Visual highlight | Scrub to a closed level. The row for the player's bucket has a "Winning sub: N" cell; that row also gets data-winning="true" background tint. |
| Terminal sub-section renders ONLY when burns exist (D-06) | DECIMATOR-05 / D-06 | Conditional visibility | Select a player with terminal burns (if any exist in test data). Terminal section is visible below decimator content. Select a player with NO terminal burns. Terminal section is entirely absent (hidden). Panel bottom border from decimator content is visible; no empty dark space. |
| Terminal burn rows show correct timeMultBps → Nx formatting | DECIMATOR-05 | Format check | Burn at level 95 with timeMultBps=13500. Row shows "1.35x" in the multiplier column (not "13500" or "135%"). |
| Activity-score cross-reference updates on day scrub (D-07) | D-07 | Day-propagation correctness | Scrub days 50 → 60. Activity score cell updates reflecting the new day's scoreBreakdown.totalBps (divided by 10000 for decimal display). |
| Rapid scrub doesn't produce flash of stale data | D-08 stale-guards | Race-condition check | Rapidly scrub days 50 → 52 → 54 → 56. Panel shows is-stale dim during each fetch; final render reflects day 56 only. No flash of day 52/54 values. |
| Empty state when player has no decimator activity at all | DECIMATOR-02 | UX polish | Select a player with zero decimator burns ever. Window badge shows correctly; bucket table empty; payout pill shows "No decimator activity at level N"; terminal section absent. |
| Window badge transitions correctly on open → closed flip | DECIMATOR-01 / D-05 | Real-time state | With sim advancing, watch `decimator.windowOpen` transition. Badge updates from "OPEN" to "CLOSED" on the /player/:address refetch (triggered by next day-scrub or manual refresh). |

### UAT deferral

Following Phase 50/51/52/53/54 precedent (all deferred Wave 3 UAT), Phase 55 Wave 3 is likely deferrable. The planner should structure Wave 3 as optional; automated verification + Wave 2 acceptance-criteria grep is sufficient to close the phase. `55-UAT.md` records the deferral.

## Pitfalls and Landmines (Answer to Q6)

### Pitfall 1: CONTEXT D-03 bucket range is WRONG (1-8 vs actual 2-12 or 5-12)

**What goes wrong:** CONTEXT D-03 says "Buckets are 1-8 (per the game model)." This is incorrect. Per `BurnieCoin.sol:142-147`, `DECIMATOR_BUCKET_BASE = 12`, `DECIMATOR_MIN_BUCKET_NORMAL = 5`, `DECIMATOR_MIN_BUCKET_100 = 2`. Actual bucket range:
- Normal levels (level % 100 != 0): buckets 5 through 12 (8 possible buckets).
- Level % 100 = 0 (every centennial level): buckets 2 through 12 (11 possible buckets).

A panel that renders 8 rows labelled "1-8" would show wrong labels, fail to match the player's actual bucket (5-12), and mislead players about odds.

**How to avoid:** Implementation uses the verified constants. Inline as JavaScript literals (matches pattern of inlining `bafContext()` in Phase 54):

```javascript
const DECIMATOR_BUCKET_BASE = 12;
const DECIMATOR_MIN_BUCKET_NORMAL = 5;
const DECIMATOR_MIN_BUCKET_100 = 2;

function bucketRange(level) {
  const isCentennial = level > 0 && level % 100 === 0;
  const min = isCentennial ? DECIMATOR_MIN_BUCKET_100 : DECIMATOR_MIN_BUCKET_NORMAL;
  const max = DECIMATOR_BUCKET_BASE;
  // Returns [min, min+1, ..., max]
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}
```

**Planner action:** Explicitly override CONTEXT D-03 in the plan. The bucket table renders `bucketRange(level)` rows (length 8 for normal levels, 11 for centennial). Discuss-phase already locked D-03 — the override needs calling out in the phase's CONTEXT update if anything (but since this is a CONTEXT error, not a design decision change, a footnote in the plan may suffice). This is exactly the kind of CONTEXT-vs-contract discrepancy that Wave 0 research is meant to catch.

**Warning signs:** QA sees bucket labels 1-8 in the UI while players report their assigned bucket is 7 (a valid normal bucket). Or, at level 100, bucket 2 assigned but no row to highlight.

### Pitfall 2: Rapid scrub on decimator panel races (baf-panel-style)

**What goes wrong:** User scrubs days 60→65→70 rapidly. Two concurrent fetches (extended-player + INTEG-03) per scrub. Without stale-guards, fetch for day 60 races fetch for day 70. Late 60-response clobbers 70's render.

**How to avoid:** Two fetch-id counters (`#decimatorPlayerFetchId` + `#decimatorLevelFetchId`), each bumped on its own refetch. Multiple token checks per fetch (post-fetch, post-json). Proven pattern from `baf-panel.js:141-207`.

**Warning signs:** Panel flickers between days during rapid scrub; bucket row highlight jumps backwards.

### Pitfall 3: Terminal sub-section shows skeleton when `terminal` is null

**What goes wrong:** The extended-player response returns `terminal: null` when the player has no terminal burns. Naive rendering might try to render an empty table with headers but no rows — looks like loading-forever skeleton.

**How to avoid:** D-06 rule: `if (terminal === null || terminal.burns.length === 0) { section.hidden = true; return; }`. Hide the ENTIRE section, not just the rows. Don't render the "Terminal decimator" h3 either.

**Warning signs:** UI shows "Terminal decimator" header with an empty table below it.

### Pitfall 4: `game.levelStartTime` undefined in play/ store

**What goes wrong:** play/ does NOT poll `/game/state` (confirmed via `grep -r pollGameState play/` = no matches). `game.levelStartTime` is NULL in the play store. DECIMATOR-01 time-remaining derivation relies on it and throws NaN or renders "NaN hours remaining".

**How to avoid:** Drop time-remaining from DECIMATOR-01 Wave 1 (per Section 7 recommendation (D)). Render only "OPEN" / "CLOSED" / "NOT ELIGIBLE" label. If time-remaining is later added, the `play/app/main.js` boot sequence must fetch `/game/state` or expose a `/game/level-meta` read — that's a Wave 3+ scope decision.

**Warning signs:** UI shows "NaN hours remaining" or a blank time cell where text is expected.

### Pitfall 5: decimator-panel.js accidentally imports beta/components/decimator-panel.js

**What goes wrong:** A developer, seeing the identical name, imports the beta component file. `customElements.define('decimator-panel', ...)` collides (the beta file defines it at line 246). DOMException thrown. Panel is blank.

**How to avoid:** `beta/components/decimator-panel.js` is ALREADY in `play-shell-01.test.js:30` FORBIDDEN list. Any future accidental import fails CI immediately.

**Warning signs:** Console throws "cannot define element with duplicate name"; panel is blank.

### Pitfall 6: terminal-panel.js accidentally imported (tag name collision + wallet-taint)

**What goes wrong:** Developer sees `beta/components/terminal-panel.js` and imports it thinking they're getting "helper markup". Two problems: (1) the file calls `customElements.define('terminal-panel', ...)` which pollutes the global registry (play/ does NOT define `terminal-panel` — per D-01 terminal state is a sub-section, not a separate element — but the pollution affects downstream dev tools and tests); (2) the file imports `beta/app/terminal.js` which imports ethers.

**How to avoid:** Wave 0 adds `beta/components/terminal-panel.js` to FORBIDDEN list (new entry). Never imported by any play/ file.

**Warning signs:** Running the play/ SHELL-01 test emits a violation for `terminal-panel.js`; runtime would silently register the wrong custom element without the test.

### Pitfall 7: INTEG-03 returns `bucket: null` — confusion with empty "no burn" state

**What goes wrong:** For a valid player at a valid level where they did NOT burn, INTEG-03 returns `bucket: null, subbucket: null, effectiveAmount: '0'`. The panel might render `Bucket: null` (raw JSON value) in the stat cell.

**How to avoid:** Null-guard each render function: `bucket != null ? String(bucket) : '—'`. No `null` or `NaN` text visible.

**Warning signs:** UI shows "null" or "undefined" text where a bucket value should be.

### Pitfall 8: Effective amount vs weighted amount confusion (wei-scale BURNIE, different meaning)

**What goes wrong:** Both `effectiveAmount` and `weightedAmount` are wei-scale BURNIE strings. The UI might display them interchangeably or mislabel them. Per the contract math:
- `effectiveAmount` = base + boost + boon (full raw burn credited to the player)
- `weightedAmount` = `effectiveAmount / bucket` (the share factor used when comparing against subbucket totals)

**How to avoid:** Label cells clearly: "Effective burn" vs "Weighted". Use `formatBurnie(value)` for BOTH — they're both wei-scale. Document the derivation in the inline comment at the render site.

**Warning signs:** Users confused about which number represents their "actual" burn contribution; QA reports "effective and weighted are swapped".

### Pitfall 9: `replay.level` null on first load — stale-guard no-op

**What goes wrong:** `<decimator-panel>`'s `connectedCallback` fires before `play/app/main.js:117-130` populates `replay.level`. First `#refetchLevel()` sees `level = null` → returns early → never fetches. Panel stuck in skeleton.

**How to avoid:** The `subscribe('replay.level')` callback fires when `replay.level` is first written (`update('replay.level', value)` triggers all subscribers). The "null first" branch in `#refetchLevel()` correctly no-ops on first sync call from connectedCallback; the subscribe-triggered second call refetches once the level is populated. Proven pattern from `<baf-panel>` + `<tickets-panel>`.

**Warning signs:** Panel stuck at skeleton on first load; other panels hydrate normally.

### Pitfall 10: Payout pill shows "You won 0 ETH" for `payoutAmount: '0'`

**What goes wrong:** For resolved rounds where the player's subbucket != winningSubbucket, INTEG-03 returns `payoutAmount: '0'`. Naive rendering shows "You won 0 ETH" which is misleading — they didn't win.

**How to avoid:** Conditional messaging:
- `payoutAmount !== '0'` → "You won {formatEth(payoutAmount)} ETH" (accent color)
- `payoutAmount === '0' && roundStatus === 'closed' && bucket != null` → "Not your subbucket" (muted)
- `payoutAmount === '0' && roundStatus === 'closed' && bucket == null` → "You didn't burn at level N" (muted)
- `roundStatus === 'open'` → "Round in progress" (muted)
- `roundStatus === 'not_eligible'` → "No decimator round at level N" (muted)

**Warning signs:** UI says "You won 0 ETH" which is oxymoronic; tester reports confusing messaging.

### Pitfall 11: Bucket table rendering for level % 100 = 0 levels grows the panel height

**What goes wrong:** Normal levels show 8 bucket rows (5-12). Level 100 shows 11 bucket rows (2-12). The panel grows by ~45% when the scrubber hits level 100. Layout shift.

**How to avoid:** Use `min-height` on the bucket table container equal to the 11-row layout. Smaller tables (8 rows) leave some bottom whitespace but avoid the height jump. OR accept the layout shift as informative ("this is a centennial level, more buckets possible = more granular odds").

**Recommendation:** Accept the layout shift. It's a meaningful signal that the level is special.

**Warning signs:** UX tester reports jarring height jump when scrubbing to level 100/200.

### Pitfall 12: Day-scope interaction with terminal.burns

**What goes wrong:** The extended `/player/:address?day=N` response returns `terminal.burns` as latest-state (NOT block-scoped to day N). Verified via handler code at `routes/player.ts:435-446`: the query has NO `blockNumber <= endBlock` filter. Scrubbing to day 40 shows a terminal burn that happened on day 80. Misleading for the historical view.

**How to avoid:** Accept for Wave 1 — matches the same behavior documented in Phase 54 Pitfall 10 for the coinflip block. If UAT flags, file as an INTEG-02 refinement (add block-scoping to the terminal-burns query). Not in Phase 55 scope.

**Warning signs:** User reports "I scrubbed to day 40 but the panel shows a terminal burn from day 80".

### Pitfall 13: INTEG-03 `?day=M` block-scoping requires `decimator_burns.blockNumber` index

**What goes wrong:** Historical `?day=M` queries need `lte(decimatorBurns.blockNumber, endBlock)`. If `decimator_burns` is missing a `blockNumber` index, the query table-scans. `decimator_burns` has indexes on `(player, level)` UNIQUE and `level` but NOT on `blockNumber` per `database/src/db/schema/decimator.ts:13-16`.

**How to avoid:** The query still works (just slower for large tables). If the sim is small (< 10^5 rows) the scan is cheap. If the indexer later grows, add a `blockNumber` index to `decimator_burns`. This is a database-repo concern, not website.

**Warning signs:** `?day=M` INTEG-03 calls take > 500ms. Database team adds an index.

### Pitfall 14: `scoreBreakdown` null in extended-player response

**What goes wrong:** When the Phase 51 INTEG-02 handler's eth_call for `readActivityScore` fails (historical snapshot unavailable), `scoreBreakdown` is returned as `null` (per `routes/player.ts:237-309`). D-07 "Activity score: X.XX" renders as "Activity score: undefined.NaN" if the null isn't guarded.

**How to avoid:** Null-guard in render: `data?.scoreBreakdown?.totalBps != null ? (data.scoreBreakdown.totalBps / 10000).toFixed(2) : '--'`. Already proven pattern in `<profile-panel>`.

**Warning signs:** UI shows "Activity score: NaN" during historical day-scrub.

## Open Questions (Post-Research)

### Q1: Is CONTEXT D-03's "buckets are 1-8" a research error, a design-simplification intent, or an actual misread of contracts?

The contract-truthfull answer is 2-12 or 5-12 per Pitfall 1. The CONTEXT writer may have:
(a) meant "8 possible buckets on a normal level" (8 is correct; range-endpoints are 5-12)
(b) simplified the labels for UX reasons ("show 1-8" to avoid confusing players with "5-12")
(c) genuinely misread the contract

**Recommendation for planner:** Treat as a contract-truth issue per this research. Render the actual range per Pitfall 1. If the design intent was (b) — renumber for display — that's a semantic layer to be added deliberately, not accidentally. Put the decision to the user at discuss-phase time if the planner wants to.

### Q2: Should Phase 55 include the terminal "insurance bar" that beta renders (stETH yield accumulator bar)?

Beta's `terminal-panel.js:53-63` renders a visual bar showing the insurance accumulator. The bar is calculated from `terminal.yieldAccumulator` + `terminal.futurePool`. Neither field is in the extended `/player/:address?day=N` response. Would require a new backend data source.

**Recommendation for planner:** OUT of Phase 55 scope per REQUIREMENTS.md (TERM-xx deferred to v2.5+ per line 101). DECIMATOR-05 is specifically "terminal decimator state (burns, weighted amount, time-multiplier)" — only the burns table. The insurance bar is part of the deferred TERM-xx surface.

### Q3: Should the decimator panel poll `/game/state` for `levelStartTime` so DECIMATOR-01 can show time-remaining?

Per Pitfall 4, the play/ store does NOT poll `/game/state`. Adding the poll would populate `game.level`, `game.phase`, `game.decWindowOpen`, `game.levelStartTime`, etc. in the play/ store — useful for the decimator panel but ALSO would cascade to other panels (potentially causing side-effects).

**Recommendation for planner:** Drop time-remaining from Wave 1 DECIMATOR-01. Render state-only ("OPEN" / "CLOSED" / "NOT ELIGIBLE"). Wave 3 UAT can flag whether users want time-remaining; if yes, a narrow `play/app/game-state-fetch.js` wrapper (~30 LOC) fetches /game/state once per day-scrub and populates `state.replay.levelStartTime` (NEW store slot). Defer unless UAT demands.

### Q4: Should the panel handle `decimator.claimed = true` differently than `decimator.claimed = false`?

The extended-player response's `decimator.claimablePerLevel[]` has a `claimed: boolean` field. For `claimed = true`, the ETH has already been claimed to the player's wallet (no further action needed); for `claimed = false`, the player has a pending claim. The read-only play/ UI has no claim button — but the payout pill could display differently: "Won 0.012 ETH (unclaimed)" vs "Won 0.012 ETH (claimed)".

**Recommendation for planner:** Out of Phase 55 scope. The payout pill shows the AMOUNT regardless; claim-state display is claim-flow polish that belongs in the wallet-mode Phase 60+. For play/ read-only, knowing the winning amount is enough.

### Q5: Should the panel cache the INTEG-03 response per `(player, level)` tuple?

Client-side cache: if the user scrubs back and forth between the same (player, level), re-fetching INTEG-03 each time wastes bandwidth. A LocalStorage or in-memory cache could dedupe.

**Recommendation for planner:** Skip for Phase 55. Premature optimization. Stale-guards already prevent flickering; bandwidth is negligible (< 1KB per response). If UAT reveals slowness, revisit in a future perf phase.

### Q6: Bucket-table: show winning subbucket for the player's bucket row only, or for all rows?

When a round is closed, `decimator_winning_subbuckets` has ONE row per `(level, bucket)` — so each bucket has its OWN winning subbucket. The player is in exactly one bucket, so they care only about ONE winning subbucket (their bucket's).

**Recommendation for planner:** Show the winning subbucket in the player's bucket row only. Other bucket rows show "—" in the "Winning sub" column. This mirrors how `decimator_winning_subbuckets` is structured and avoids implying that a player could have won in a different bucket (they couldn't).

### Q7: Should the terminal sub-section show a sum of all terminal-burn `weightedAmount`s?

Terminal burns accumulate across levels. A sum row might be informative ("Total terminal weighted: X BURNIE"). But the contract pays pro-rata at GAMEOVER — the sum isn't directly actionable.

**Recommendation for planner:** Skip. Per-row display is enough. A sum row is polish; defer to UAT if requested.

### Q8: Wave 2 gate — what if INTEG-03 ships with slightly different field names?

Same as INTEG-05's Wave 2 risk — database team may refine field names (e.g., `winningSub` instead of `winningSubbucket`). Phase 54 precedent: openapi.json is the source of truth at Wave 2 start, frontend adjusts to match.

**Recommendation for planner:** Use Section 8 spec as the proposal. Wave 2 Plan 1 re-reads openapi.json / the test file to confirm shape before committing frontend wiring. Same pattern as Phase 54 Wave 2.

### Q9: Should the bucket-table show hypothetical bucket assignments for non-participating players ("if you had burned, your bucket would have been X")?

Activity-score maps to a default bucket via `computeBucket(activityScoreBps, isLevel100)`. Could preview "Your bucket would be X" even without a burn.

**Recommendation for planner:** Out of Phase 55 scope. Only show actual post-burn state. Previews are gameplay-planning polish for a future phase.

### Q10: Test file naming — `play-decimator-panel.test.js` vs something more specific like `play-decimator-panel-main.test.js` to leave room for future split?

Precedent: Phase 54 shipped `play-coinflip-panel.test.js` + `play-baf-panel.test.js` as single files. Phase 52 shipped `play-tickets-panel.test.js` + `play-packs-panel.test.js`. Per-panel single test file is the norm.

**Recommendation for planner:** `play-decimator-panel.test.js`. No split. Matches precedent.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `beta/components/decimator-panel.js` is wallet-tainted via `beta/app/decimator.js` → ethers AND `beta/app/utils.js` → ethers | Section 6 [VERIFIED via grep — direct confirmation of `import { ethers } from 'ethers'` at decimator.js:4 and utils.js:3] | None — grep confirms both chains |
| A2 | `beta/components/terminal-panel.js` is wallet-tainted via `beta/app/terminal.js` → ethers AND `beta/app/utils.js` → ethers | Section 6 [VERIFIED via grep — direct confirmation of `import { ethers } from 'ethers'` at terminal.js:6 and utils.js:3] | None — grep confirms both chains |
| A3 | Extended `/player/:address?day=N` response includes `decimator` block with `windowOpen`, `activityScore`, `claimablePerLevel`, `futurePoolTotal` | Section 7 [VERIFIED via schema read at `database/src/api/schemas/player.ts:68-78` + handler code at `routes/player.ts:412-433`] | None |
| A4 | Extended `/player/:address?day=N` response includes `terminal` block with `burns[]` array (level, effectiveAmount, weightedAmount, timeMultBps) | Section 7 [VERIFIED via schema read at `database/src/api/schemas/player.ts:79-86` + handler at `routes/player.ts:435-446`] | None |
| A5 | `decimator.windowOpen` reads from `gameState.decWindowOpen` singleton (authoritative, real-time) | Section 7 [VERIFIED via handler code at `routes/player.ts:414-416` + `handler:429 windowOpen: gsRow?.decWindowOpen ?? false`] | None |
| A6 | Bucket range is 5-12 (normal) or 2-12 (level % 100 = 0) — NOT 1-8 as CONTEXT D-03 states | Summary + Pitfall 1 [VERIFIED via contract source at `BurnieCoin.sol:142-147`: DECIMATOR_BUCKET_BASE=12, DECIMATOR_MIN_BUCKET_NORMAL=5, DECIMATOR_MIN_BUCKET_100=2] | HIGH — CONTEXT-contract mismatch. Plan must override CONTEXT. |
| A7 | SubBucket range is 0 to bucket-1 (inclusive) | Section 8 [VERIFIED via `DegenerusGameDecimatorModule.sol:27` "The deterministic subbucket assigned (0 to bucket-1)"] | None |
| A8 | `weightedAmount = effectiveAmount / bucket` per contract math intent | Section 8 [REASONED from `_decClaimableFromEntry` at `DegenerusGameDecimatorModule.sol:465-486` — actual pro-rata uses effectiveAmount not divided by bucket; "weighted" is a UI-convenient pre-division so players see a smaller-scale number] | LOW — if users find it confusing the field can be renamed or dropped |
| A9 | INTEG-03 response shape matches Section 8 spec | Section 8 [PROPOSED] | MEDIUM — database team may refine names; Wave 2 Plan 1 adjusts UI parsing. Same risk as INTEG-05 Wave 2 |
| A10 | `decimator_burns` UNIQUE(player, level) means one row per (player, level) — cumulative burn state | Section 8 [VERIFIED via `database/src/db/schema/decimator.ts:14` `uniqueIndex('decimator_burns_unique')`] | None |
| A11 | `decimator_rounds.resolved` is the authoritative flag for roundStatus='closed' | Section 8 [VERIFIED via schema at `decimator.ts:48` boolean().notNull().default(false) + handler emit semantics inferred from contract name] | LOW — field is self-descriptive; if indexer populates it late there's eventual consistency delay |
| A12 | `decimator_claims.ethAmount` is authoritative payoutAmount when row exists | Section 8 [VERIFIED via schema at `decimator.ts:70` notNull().default('0') + contract emit `DecimatorClaimed(amountWei, ethPortion, lootboxAmount)` per comment at schema:58-63] | None |
| A13 | `play/app/main.js` does NOT poll `/game/state`; `game.levelStartTime` is null in play/ store | Section 7 + Pitfall 4 [VERIFIED via `grep -r pollGameState play/` returning no matches] | None |
| A14 | Terminal sub-section renders only when `terminal !== null && terminal.burns.length > 0` | D-06 locked + Section 10 [VERIFIED per CONTEXT + handler returns `terminalData = termBurns.length > 0 ? {burns: termBurns} : null` at `routes/player.ts:446`] | None — the API already returns null for empty case, panel just checks `data?.terminal` |
| A15 | Three subscriptions (replay.level + replay.player + replay.day) is the right pattern, not two | Section 10 + Section 11 [REASONED from D-08 + need for terminal burns day-scoping + activity-score day-scoping] | LOW — if any of the three is redundant, some refetches are no-ops. No correctness risk. |
| A16 | No shared fetch helper needed for Phase 55 | Section 10 [REASONED — only ONE panel, no overlap with others at the same URL shape] | None |
| A17 | Phase 51 INTEG-02 + Phase 52 INTEG-01 + Phase 54 INTEG-05 precedent (3-commit side-quest) applies to INTEG-03 | Section 8 [CITED: commit history] | If database team takes longer, Wave 2 blocks. Risk LOW |
| A18 | Inline 3 pure helpers (computeBucket, computeMultiplier, computeTimeMultiplier) from beta instead of extracting a play/app/decimator-helpers.js | Section 5 [REASONED — 40 LOC inline doesn't warrant a file; matches Phase 54 inline bafContext decision] | None — architectural preference, no correctness impact |

## Risks / Blockers

### Blockers

- **INTEG-03 delivery (hard gate, CONTEXT D-09 + ROADMAP success criterion 5).** UI hydration Wave 2 cannot merge until database repo ships the endpoint. Same solo-dev pattern as INTEG-01 (Phase 52), INTEG-02 (Phase 51), INTEG-05 (Phase 54). Risk LOW — three prior side-quests shipped successfully with near-identical scope. INTEG-03 is slightly more complex (more tables joined, more derivation logic) — budget 10-15 minutes for careful implementation.

### Risks

- **CONTEXT D-03 bucket range error (Pitfall 1, Assumption A6).** Plan must override CONTEXT with contract-truth. HIGH attention risk — easy to propagate the error if the planner reads CONTEXT without reading this research.
- **`game.levelStartTime` absent in play/ store (Pitfall 4).** Drop time-remaining from Wave 1 DECIMATOR-01. Low-impact UX tradeoff.
- **INTEG-03 response shape may refine (Assumption A9).** Same risk as INTEG-05 Wave 2 — database team may rename fields. Frontend adjusts.
- **Terminal burns NOT day-scoped (Pitfall 12, Assumption A4).** Accept as-is for Wave 1; Phase 51 INTEG-02 refinement for Wave 2+ if UAT flags.
- **`decimator_burns.blockNumber` missing index (Pitfall 13).** Database-repo concern; `?day=M` queries may be slow for large sim datasets. Not blocking.

### Non-Risks (Rejected Concerns)

- **SHELL-01 regression for new play/ files.** Covered by `play-shell-01.test.js` recursive scan + Wave 0 FORBIDDEN additions (three new entries).
- **State contract drift.** `state.replay.{day, level, player}` unchanged. No new store slots required — the panel reads from existing fields and the extended-player + INTEG-03 responses directly.
- **Tag-name collision between play/'s `<decimator-panel>` and beta's.** play/ does NOT import beta's decimator-panel.js; FORBIDDEN list prevents it. Both define `'decimator-panel'`, but beta is never imported by play/ so no runtime collision.
- **Terminal sub-section as a separate custom element necessary.** Rejected per D-01 — single Custom Element with conditional rendering is simpler and avoids the terminal-panel.js import-temptation described in Pitfall 6.
- **DECIMATOR-05 scope creep to include insurance bar.** Per REQUIREMENTS.md line 101, TERM-xx is explicitly deferred to v2.5+. DECIMATOR-05 scope is burns table only.

## Environment Availability

| Dependency | Required By | Available | Notes | Fallback |
|------------|------------|-----------|-------|----------|
| Node.js `node:test` | Test suite | ✓ | Phase 50-54 precedent | — |
| Python `http.server` (dev static server) | Manual UAT | ✓ | — | — |
| Fastify API at localhost:3000 | Runtime | ✓ | Verified via live curl in Phase 54 research | — |
| `/player/:address?day=N` extended response | DECIMATOR-01, DECIMATOR-05, D-07 | ✓ | Live; INTEG-02 shipped in Phase 51 | — |
| `/player/:address/decimator?level=N&day=M` | DECIMATOR-02, DECIMATOR-03 (full), DECIMATOR-04 | ✗ | **INTEG-03 HARD GATE** — database repo must ship | Wave 2 blocks until endpoint lands; Wave 1 UI ships with safe-degrade 404-silent fallback |
| `decimator_burns` table | INTEG-03 | ✓ | Indexed; schema at `database/src/db/schema/decimator.ts:3-16` | — |
| `decimator_bucket_totals` table | INTEG-03 payout derivation | ✓ | Indexed; schema at `decimator.ts:18-28` | — |
| `decimator_winning_subbuckets` table | INTEG-03 winningSubbucket lookup | ✓ | Indexed; schema at `decimator.ts:30-39` | — |
| `decimator_rounds` table | INTEG-03 roundStatus + poolEth | ✓ | Indexed; schema at `decimator.ts:41-53` | — |
| `decimator_claims` table | INTEG-03 authoritative payoutAmount | ✓ | Indexed; schema at `decimator.ts:66-81` | — |
| `terminal_decimator_burns` table | DECIMATOR-05 | ✓ | Indexed; schema at `decimator.ts:115-131`; already consumed by /player handler at `routes/player.ts:436-446` | — |
| `gameState.decWindowOpen` column | DECIMATOR-01 | ✓ | Singleton row (id=1); already consumed by /player handler | — |
| beta/viewer/utils.js (`truncateAddress`, `formatBurnie`, `formatEth`) | Address + amount rendering | ✓ | Wallet-free per SHELL-01 comment; `beta/viewer/utils.js:1-38` | — |
| Phase 50 `<decimator-panel>` stub file | Starting point | ✓ | 40 LOC at `play/components/decimator-panel.js`; subscribes to replay.day + replay.player but not replay.level | — |

**Missing dependencies with no fallback:**
- INTEG-03 — the one hard gate on this phase.

**Missing dependencies with fallback:**
- `game.levelStartTime` — fallback is to drop time-remaining from DECIMATOR-01 Wave 1 (see Section 7).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Beta's decimator-panel mixes read + write + burn-input UI in 246 LOC | Play's decimator-panel is read-only, no burn input, no claim button (~280-320 LOC with bucket-table + terminal sub-section) | Phase 55 | Smaller, simpler, no wallet-coupling risk. Gains per-level bucket table + terminal sub-section |
| Beta's terminal-panel is a separate 328-LOC component | Play's terminal state is a conditional sub-section INSIDE decimator-panel | Phase 55 / D-01 | One custom element instead of two; no terminal-panel registry collision risk |
| Beta renders bucket as a single stat cell | Play renders a bucket-table showing all possible buckets at the level with player's row highlighted | Phase 55 / D-03 | More informative. Player sees the full lottery structure, not just their own slot. |
| Beta's `getBucketForActivityScore` helper imports `beta/app/constants.js` via `beta/app/decimator.js` (tainted) | Play inlines `computeBucket`, `computeMultiplier`, `bucketRange(level)` helpers directly in panel | Phase 55 | SHELL-01 compliance with zero file overhead; ~40 LOC inline |
| Beta's decimator has no CONTEXT-mismatch risk (beta IS the contract source) | Play has a CONTEXT D-03 bucket-range error that must be overridden by research | Phase 55 | Caught at Wave 0 research; propagates to implementation via the inline bucketRange function using verified constants |
| Beta does not show a "winning subbucket" reveal in the panel (claim button is the user action) | Play surfaces winningSubbucket + payout prominently for closed rounds | Phase 55 / D-04 | Better historical/read-only UX for the day-scrubber view |

**Deprecated / outdated (in v2.4 play/ context):**
- `beta/components/decimator-panel.js` as a play/ import target — not usable (wallet-tainted via two paths)
- `beta/components/terminal-panel.js` as a play/ import target — not usable (wallet-tainted + tag-name collision risk)
- `beta/app/decimator.js`, `beta/app/terminal.js` as play/ import targets — wallet-tainted at line 4 and line 6 respectively
- Separate `<terminal-panel>` Custom Element in play/ — rejected per D-01
- CONTEXT D-03 bucket range "1-8" — superseded by contract-verified 5-12 / 2-12

## Sources

### Primary (HIGH confidence)

- `/home/zak/Dev/PurgeGame/website/beta/components/decimator-panel.js:1-246` — visual reference + SHELL-01 audit (wallet-tainted)
- `/home/zak/Dev/PurgeGame/website/beta/components/terminal-panel.js:1-328` — terminal sub-section visual reference + SHELL-01 audit (wallet-tainted)
- `/home/zak/Dev/PurgeGame/website/beta/app/decimator.js:1-103` — `computeBucket` + `computeMultiplier` pure functions at lines 85-102; direct ethers taint at line 4
- `/home/zak/Dev/PurgeGame/website/beta/app/terminal.js:1-97` — `computeTimeMultiplier` at lines 89-96; direct ethers taint at line 6
- `/home/zak/Dev/PurgeGame/website/beta/app/utils.js:1-38` (first lines only read) — ethers taint at line 3 (already established in Phase 54 research)
- `/home/zak/Dev/PurgeGame/website/beta/app/store.js:1-100` — state structure verification (decimator, terminal, replay namespaces)
- `/home/zak/Dev/PurgeGame/website/beta/app/api.js:1-100` — `pollGameState()` populates game.* state (which play/ does NOT invoke)
- `/home/zak/Dev/PurgeGame/website/beta/app/constants.js:147-150` — DECIMATOR constants: BUCKET_BASE=12, MIN_BUCKET_NORMAL=5, MIN_BUCKET_100=2
- `/home/zak/Dev/PurgeGame/website/beta/styles/decimator.css:1-116` — layout reference (stats grid + window badge)
- `/home/zak/Dev/PurgeGame/website/beta/styles/terminal.css:1-157` — terminal sub-section layout reference
- `/home/zak/Dev/PurgeGame/website/beta/viewer/utils.js:1-38` — wallet-free `truncateAddress`, `formatBurnie`, `formatEth`, `formatWei` (SHELL-01-safe)
- `/home/zak/Dev/PurgeGame/website/play/components/decimator-panel.js:1-40` — Phase 50 stub starting point
- `/home/zak/Dev/PurgeGame/website/play/components/profile-panel.js:1-418` — hydrated Custom Element template, stale-guard pattern
- `/home/zak/Dev/PurgeGame/website/play/components/baf-panel.js:1-358` — dual-signal fetch pattern (replay.level + replay.player), two-counter stale-guard, inline bafContext helper
- `/home/zak/Dev/PurgeGame/website/play/components/coinflip-panel.js:1-305` — parallel-fetch pattern (Promise.all), score-unit discipline comment
- `/home/zak/Dev/PurgeGame/website/play/app/main.js:1-143` — bootstrap + `replay.level` population pattern; confirms play/ does NOT poll `/game/state`
- `/home/zak/Dev/PurgeGame/website/play/app/constants.js:1-13` — re-export surface
- `/home/zak/Dev/PurgeGame/website/play/app/__tests__/play-shell-01.test.js:1-111` — SHELL-01 recursive scanner + current FORBIDDEN list (Phase 55 additions at Wave 0)
- `/home/zak/Dev/PurgeGame/website/play/app/__tests__/play-baf-panel.test.js:1-254` — test template (closest structural match to Phase 55 plan)
- `/home/zak/Dev/PurgeGame/website/database/src/api/routes/player.ts:1-903` — `/player/:address` handler (current INTEG-02 implementation; INTEG-01 and INTEG-05 precedents; lines 151-218 decimator-related reads from Phase 51; lines 412-446 decimator + terminal blocks; lines 707-862 INTEG-05 template for the new INTEG-03 handler)
- `/home/zak/Dev/PurgeGame/website/database/src/api/schemas/player.ts:1-184` — playerDashboard + INTEG-01 + INTEG-05 schemas; template for new INTEG-03 schema
- `/home/zak/Dev/PurgeGame/website/database/src/api/schemas/common.ts` — addressParamSchema + errorResponseSchema (via INTEG-05 spec import references)
- `/home/zak/Dev/PurgeGame/website/database/src/db/schema/decimator.ts:1-131` — ALL five decimator tables + terminal_decimator_burns with column-level details
- `/home/zak/Dev/PurgeGame/degenerus-audit/contracts/BurnieCoin.sol:60-70, 140-156, 548-617, 660-692` — contract-source-of-truth for DecimatorBurn events, DECIMATOR_BUCKET_BASE / MIN_BUCKET constants, decimatorBurn + terminalDecimatorBurn entry points, `_adjustDecimatorBucket` + `_decimatorBurnMultiplier` helpers
- `/home/zak/Dev/PurgeGame/degenerus-audit/contracts/modules/DegenerusGameDecimatorModule.sol:27, 133-192, 450-528, 619-738, 841, 869` — contract-source-of-truth for recordDecBurn, runDecimatorJackpot, _unpackDecWinningSubbucket, _decClaimableFromEntry, _decSubbucketFor, subBucket range (0 to bucket-1), winning-subbucket distribution
- `/home/zak/Dev/PurgeGame/website/.planning/phases/55-decimator/55-CONTEXT.md:1-117` — 10 locked decisions D-01..D-10 + gray-area autonomous decisions + deferred ideas
- `/home/zak/Dev/PurgeGame/website/.planning/phases/54-coinflip-baf/54-RESEARCH.md:1-1755` — structural template (this research mirrors section ordering + approach)
- `/home/zak/Dev/PurgeGame/website/.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md:1-238` — INTEG spec template (this research's Section 8 mirrors the approach)
- `/home/zak/Dev/PurgeGame/website/.planning/REQUIREMENTS.md:59-65, 84, 148-152, 162` — DECIMATOR-01..05 + INTEG-03 requirement definitions
- `/home/zak/Dev/PurgeGame/website/.planning/ROADMAP.md:167-178` — Phase 55 goal + success criteria
- `/home/zak/Dev/PurgeGame/website/CLAUDE.md` — project instructions (source-of-truth contract path + no em-dash style + etc.)

### Secondary (MEDIUM confidence)

- INTEG-03 JSON response shape (Section 8) — PROPOSED; database team may refine during implementation (e.g., rename `winningSubbucket` to `winningSub`)
- INTEG-03 payout derivation fallback path (compute `pool * playerBurn / totalBurn` when `decimator_claims` row missing) — data flow verified, but exact handling of edge cases (e.g., burn exists but no round row yet) may refine at implementation
- `weightedAmount = effectiveAmount / bucket` semantic — UI-facing derivation; contract math uses full effectiveAmount in pro-rata. Label clearly. Alternative names proposed in Section 8 Open Questions.

### Tertiary (LOW confidence)

- None. All claims are `[VERIFIED]` by direct file read or `[CITED]` to a file+line. `[ASSUMED]` items are logged in the Assumptions Log (A1..A18) with risk assessment and verification path where possible.

## Metadata

**Confidence breakdown:**

- SHELL-01 transitive audit (all 4 beta files tainted): HIGH — verified via direct grep for `ethers` + import chain walks
- Existing endpoint shape (`decimator` + `terminal` blocks in /player response): HIGH — schema file + handler code read at research time
- INTEG-03 spec (Section 8): MEDIUM — data sources VERIFIED, exact Drizzle SQL shape and field names may refine at implementation
- Bucket-range CONTEXT mismatch (Summary + Pitfall 1): HIGH — contract source directly quoted (`BurnieCoin.sol:142-147`)
- Subbucket range: HIGH — contract comment directly quoted (`DegenerusGameDecimatorModule.sol:27`)
- Custom Element structure (Section 10): HIGH — gold-standard templates available (baf-panel.js, profile-panel.js); pattern clone
- Day-aware + level-aware fetch reuse (Section 11): HIGH — Phase 51/52/54 pattern is mature; dual-counter proven
- CSS extraction (Section 9): HIGH — beta source files read; additive layer for new bucket-table + payout-pill components
- Validation architecture (Section 12): HIGH — Phase 51/52/54 test-file precedent is a copy-paste template
- Pitfalls (Section 13): HIGH — 14 pitfalls enumerated; most are carryovers or direct extensions of Phase 51/52/54 pitfalls + Pitfall 1 is a novel CONTEXT-contract discrepancy caught at Wave 0 (exactly the kind of error research is meant to catch)
- Environment availability (Section): HIGH — verified via file reads; one hard gate (INTEG-03)

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days — contracts are stable and archived in audit repo; existing endpoints shipped; only INTEG-03 is a moving target, scope-defining for the phase)

**Files the planner MUST read before creating plans:**

1. `.planning/phases/55-decimator/55-CONTEXT.md` (117 lines) — 10 locked decisions D-01..D-10 — **note: D-03 bucket range is INCORRECT per contract source; see Pitfall 1**
2. `.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md` (238 lines) — INTEG spec template for the new INTEG-03-SPEC.md
3. `.planning/phases/54-coinflip-baf/54-RESEARCH.md` sections 10, 11, 12 — cloneable Custom Element + fetch + validation architecture templates
4. `play/components/baf-panel.js` (358 lines) — closest structural template for Phase 55 (dual-signal fetch, two-counter stale-guard, inline helper)
5. `play/components/profile-panel.js` (418 lines) — gold-standard hydrated Custom Element, render-all pattern
6. `play/components/decimator-panel.js` (40 lines) — Phase 50 stub to evolve
7. `play/app/main.js` (143 lines) — bootstrap + `replay.level` population pattern + confirms play/ does NOT poll `/game/state`
8. `play/app/constants.js` (13 lines) — re-export surface
9. `play/app/__tests__/play-baf-panel.test.js` (254 lines) — test template (structurally closest to Phase 55 needs)
10. `play/app/__tests__/play-shell-01.test.js` (111 lines) — FORBIDDEN list to edit in Wave 0 (add three new entries)
11. `beta/components/decimator-panel.js` (246 lines) — visual reference for layout; DO NOT import (FORBIDDEN)
12. `beta/components/terminal-panel.js` (328 lines) — visual reference for terminal sub-section layout; DO NOT import (FORBIDDEN Wave 0 addition)
13. `beta/app/decimator.js:85-102` — `computeBucket` + `computeMultiplier` helper LOGIC (RE-IMPLEMENT inline; DO NOT import the file)
14. `beta/app/terminal.js:89-96` — `computeTimeMultiplier` helper LOGIC (RE-IMPLEMENT inline; DO NOT import the file)
15. `beta/styles/decimator.css` (116 lines) — stats grid + window badge layout
16. `beta/styles/terminal.css` (157 lines) — terminal sub-section layout
17. `beta/viewer/utils.js` (38 lines) — `truncateAddress`, `formatBurnie`, `formatEth`
18. `database/src/api/routes/player.ts:707-862` — INTEG-05 handler precedent for the new INTEG-03 handler
19. `database/src/api/schemas/player.ts:147-161` — INTEG-05 schema precedent for new INTEG-03 schema
20. `database/src/db/schema/decimator.ts:1-131` — five decimator tables + terminal_decimator_burns with full column details
21. `degenerus-audit/contracts/BurnieCoin.sol:140-156, 660-692` — bucket constants + `_adjustDecimatorBucket` authority
22. `degenerus-audit/contracts/modules/DegenerusGameDecimatorModule.sol:27, 133-192, 465-528` — subBucket range authority + recordDecBurn + `_decClaimableFromEntry` pro-rata math

## RESEARCH COMPLETE

**Phase:** 55 - Decimator
**Confidence:** HIGH (with one FLAGGED CONTEXT-contract discrepancy on bucket range — see Pitfall 1)

### Key Findings

- Both `beta/components/decimator-panel.js` AND `beta/components/terminal-panel.js` are transitively wallet-tainted via TWO paths each (direct `ethers` import in helper files at `beta/app/{decimator,terminal}.js` lines 4 and 6; AND via `beta/app/utils.js:3`). CONTEXT D-02 pattern-match-only is correct. Wave 0 must ADD THREE new FORBIDDEN entries to `play-shell-01.test.js`: `beta/components/terminal-panel.js`, `beta/app/decimator.js`, `beta/app/terminal.js` (the existing `beta/components/decimator-panel.js` entry stays).
- The extended `/player/:address?day=N` endpoint (Phase 51 INTEG-02) ALREADY returns both a `decimator` block AND a `terminal` block with the full data needed for DECIMATOR-01, DECIMATOR-05, and D-07 activity-score cross-reference. Wave 1 ships autonomously with NO new backend work.
- INTEG-03 (`GET /player/:address/decimator?level=N&day=M`) is a straightforward 5-table join + derivation endpoint. All source tables are already indexed per `database/src/db/schema/decimator.ts`. 3-commit side-quest pattern (feat/docs/test) matches Phase 51/52/54 precedent.
- **CONTEXT D-03 is WRONG about bucket range.** Actual range per `BurnieCoin.sol:142-147`: 5-12 on normal levels, 2-12 on level % 100 = 0 levels. NOT 1-8 as CONTEXT states. The plan must override CONTEXT with contract-truth; the bucket-table inlines `bucketRange(level)` using verified constants. This is the PRIMARY research-caught error for Phase 55.
- Play/ does NOT poll `/game/state`, so `game.levelStartTime` is null in the play/ store. DECIMATOR-01 Wave 1 drops time-remaining from the window badge; renders state-label only.
- Three subscriptions needed (`replay.level` + `replay.player` + `replay.day`), not two like baf-panel. Extended-player fetch is day-scoped (terminal burns + activity score); INTEG-03 fetch is level-scoped + optional day-scope.
- Single Custom Element (`<decimator-panel>`) with conditional terminal sub-section per D-01 + D-06. No separate `<terminal-panel>`.

### File Created

`/home/zak/Dev/PurgeGame/website/.planning/phases/55-decimator/55-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| SHELL-01 transitive audit (4 beta files tainted) | HIGH | Direct grep + import-chain walk verified |
| Existing endpoint shapes (`decimator` + `terminal` blocks) | HIGH | Schema file + handler code read at research time |
| Bucket range (CONTEXT D-03 is wrong) | HIGH | Contract source directly quoted |
| Custom Element structure | HIGH | Gold-standard baf-panel template |
| INTEG-03 spec | MEDIUM | Data sources verified; Drizzle SQL detail may refine at implementation |
| Validation architecture | HIGH | Phase 51/52/54 test-file precedent is direct template |
| Pitfalls (14 enumerated) | HIGH | Mix of Phase 54 carryovers + novel Pitfall 1 CONTEXT-contract discrepancy |

### Open Questions

10 enumerated in Section 14. Most material: Q1 (how to handle the D-03 bucket-range error — planner's call whether to document as override or re-open discuss-phase).

### Ready for Planning

Research complete. Planner can create 4 plans following the Phase 54 Wave 0/1/2/3 structure. The one CONTEXT override on bucket range is the only issue requiring explicit planner attention.
