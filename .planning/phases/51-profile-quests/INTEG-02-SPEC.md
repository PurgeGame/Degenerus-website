# INTEG-02 Spec: GET /player/:address?day=N (extended dashboard)

**Phase:** 51 -- Profile & Quests
**Requirement:** INTEG-02 (kickoff in Phase 51 Wave 0; delivery gates Phase 51 Waves 1-2)
**Owner:** website repo (proposal); database repo (implementation)
**Status:** DRAFT -- solo dev self-coordination; implement when switching to /home/zak/Dev/PurgeGame/database/
**Posted:** 2026-04-23 -- solo dev (no external team); this file is the canonical spec to reference when extending the endpoint in the database repo.

## Why This Endpoint Is Needed

Phase 51 (Profile & Quests) hydrates the `<profile-panel>` Custom Element on `/play/` with four sections (Activity Score, Quest Streak, Quest Slots, Daily Activity) that all reflect end-of-day-N state for the selected player. CONTEXT.md D-13 requires a single full-historical snapshot per day change.

The existing `/player/:address` handler (`database/src/api/routes/player.ts:94-300`) returns "current" state: latest quest rows, latest streak, no score decomposition, no per-day activity counts. Phase 51 needs all four day-aware.

A new endpoint class (`/profile`, `/quests?day=N`) was rejected in favor of extending the existing `/player/:address` with an optional `?day=N` query param (D-14). Rationale: backward compatible; one fetch per day change per panel; reuses the block-resolution pattern already proven in `/player/:address/activity-score?day=N`.

## Endpoint

`GET /player/:address?day=N`

### Path Parameters

- `:address` -- 42-char `0x...` Ethereum address, lowercased (same validation as existing route).

### Query Parameters

- `day` (optional, integer, >= 1) -- effective day.
  - Omitted -> return current/latest state, shape is a strict superset of the existing `playerDashboardResponseSchema` (backward compatible).
  - Present -> return end-of-day-N snapshot following the block-resolution pattern in `database/src/api/routes/player.ts:42-65`.

## Day-Resolution Pattern (reused from /activity-score?day=N)

Reuse the SQL / resolver at `database/src/api/routes/player.ts:42-65`:

```sql
SELECT day, "blockNumber" FROM daily_rng
WHERE day IN (${day}, ${day + 1})
ORDER BY day
```

- End-of-day-N block = `daily_rng.blockNumber[day=N+1] - 1`
- If day N+1 does not exist yet (N is newest indexed day) -> use latest block (no blockNumber override).
- If day N does not exist -> return 404 `{ statusCode: 404, error: "Not Found", message: "day_not_found", day: N }` (mirrors current activity-score handler).

For DB-table queries (questProgress, playerStreaks, lootbox_purchases, jackpot_distributions, etc.) the server uses `blockNumber <= endBlock` to scope the read.
For on-chain reads (activity score bps), `eth_call` accepts a blockNumber override -- anvil retains full historical state.

## Response JSON Schema

Backward compatibility: omitting `?day=` MUST preserve today's response shape unchanged. The five new fields below are additive.

```json
{
  "player": "0x...",
  "day": 123,
  "blockNumber": "12345678",
  "historicalUnavailable": false,

  "claimableEth": "...", "totalClaimed": "...", "totalCredited": "...",
  "burnieBalance": "...", "dgnrsBalance": "...", "sdgnrsBalance": "...", "wwxrpBalance": "...",
  "currentStreak": 0, "shields": 0, "totalAffiliateEarned": "0",
  "tickets": [{ "level": 5, "ticketCount": 12 }],
  "decimatorClaims": [],
  "coinflip": null,
  "decimator": {},
  "terminal": null,
  "degenerette": null,
  "affiliate": {},

  "scoreBreakdown": {
    "totalBps": 14500,
    "questStreakPoints": 50,
    "mintCountPoints": 25,
    "affiliatePoints": 30,
    "passBonus": {
      "kind": "deity",
      "points": 80
    }
  },

  "quests": [
    {
      "day": 123, "slot": 0, "questType": 1,
      "progress": "0", "target": "1",
      "completed": false,
      "highDifficulty": false,
      "requirementMints": 1,
      "requirementTokenAmount": "0"
    },
    {
      "day": 123, "slot": 1, "questType": 6,
      "progress": "2500000000000000", "target": "10000000000000000",
      "completed": false,
      "highDifficulty": false,
      "requirementMints": 0,
      "requirementTokenAmount": "10000000000000000"
    }
  ],

  "questStreak": {
    "baseStreak": 7,
    "lastCompletedDay": 123
  },

  "dailyActivity": {
    "lootboxesPurchased": 2,
    "lootboxesOpened": 1,
    "ticketsPurchased": 4,
    "ticketWins": 2
  }
}
```

### Field Notes (new / changed fields only)

- `day` (NEW) -- echo of resolved day; `null` if `?day=` omitted.
- `blockNumber` (NEW) -- resolved end-of-day block, decimal string; `null` if live.
- `historicalUnavailable` (NEW) -- `true` if anvil `--prune-history` forced fallback to latest. UI dims the score and renders a `~` prefix per the status-bar.js pattern.
- `scoreBreakdown` (NEW) -- integer points, NOT bps. 1 point = 100 bps = 1% activity score decimal. Matches contract scale in `_playerActivityScore`. UI divides by 100 for 0.00..1.00 display (D-06).
  - `questStreakPoints`: 0..100 (capped per MintStreakUtils.sol:135-136)
  - `mintCountPoints`: 0..25 (floors + cap per MintStreakUtils.sol:117, 131; storage:1760-1767)
  - `affiliatePoints`: 0..50 (cap per AFFILIATE_BONUS_MAX in DegenerusAffiliate.sol:162)
  - `passBonus`: `null` or one of `{ kind: "deity", points: 80 }` / `{ kind: "whale_100", points: 40 }` / `{ kind: "whale_10", points: 10 }`. Backend picks the highest active pass; omit entirely when no pass is active (D-06 collapses whale/lazy/deity into a single row).
- `quests[]` (MADE DAY-AWARE) -- when `?day=N` supplied, backend MUST filter to `WHERE day = N`. When omitted, current behavior preserved (return all days). Also populates `requirementMints` and `requirementTokenAmount` from contract (currently hardcoded 0/'0' at `player.ts:128-133`). Values derive from `_questRequirements` in `DegenerusQuests.sol:1108-1123`; backend may read via eth_call at resolved block OR persist in `quest_definitions.requirements_*` columns for faster reads.
- `quests[].highDifficulty` -- remains `false` hardcoded (vestigial; `DegenerusQuests.sol:1090` hardcodes false; `database/src/api/routes/player.ts:130` hardcodes false). Retained for backward compatibility; UI ignores it (D-20).
- `questStreak` (MADE DAY-AWARE) -- snapshot reflects end-of-day-N state, not "right now". See "Historical Streak Reconstruction" below.
- `dailyActivity` (NEW) -- four counts bounded to the selected day; see "Daily Activity Counts" below.

### Historical Streak Reconstruction (Open Question 1)

`player_streaks` table stores latest-only. To support day-aware streak the backend picks ONE of:

- **Option A -- Replay events:** replay `QuestCompleted` + `QuestStreakReset` + `QuestStreakShieldUsed` events up to end-of-day-N block. One-time cost per request; simpler to implement.
- **Option B -- Streak history table:** add `player_streaks_history(player, day, baseStreak, lastCompletedDay)` materialized by the indexer. Faster reads; one-time indexer lift.
- **Option C -- Fallback:** return latest-only even with `?day=N`, set `historicalUnavailable: true`. UI renders with a `~` prefix (same degradation path as `/activity-score?day=N`).

Database team picks at implementation time. UI trusts whatever comes back and honors `historicalUnavailable`.

### Daily Activity Counts (new fields)

All filters: `player = :addr AND blockNumber BETWEEN dayStartBlock AND dayEndBlock`, where `dayStartBlock = daily_rng.blockNumber[day=N]` and `dayEndBlock = daily_rng.blockNumber[day=N+1] - 1` (start=0 for day=1).

| Field | Table / Source | Count expression |
|-------|----------------|------------------|
| `lootboxesPurchased` | `lootbox_purchases` (both ETH-paid `handleLootBoxBuyRecord` and BURNIE-paid `handleBurnieLootBuy`; append-only per `handlers/lootbox.ts:30-42`) | `COUNT(*)` |
| `lootboxesOpened` | `lootbox_results WHERE rewardType IN ('opened', 'burnieOpened')` (filter out `rewardType='lootboxIdx'` -- bookkeeping only) | `COUNT(*)` |
| `ticketsPurchased` | Raw `TicketsQueued`, `TicketsQueuedScaled`, `TicketsQueuedRange` events (player = buyer). Paid mints only -- does NOT include tickets granted from jackpot wins (those are counted separately in `ticketWins`). See Open Question 2. | `SUM(quantity)` (sum of quantity/quantityScaled/ticketsPerLevel*numLevels per event type). Backend implementation note: either add a `ticket_purchases(player, blockNumber, logIndex, quantity)` table keyed by indexer OR re-parse raw_events on read. |
| `ticketWins` | `jackpot_distributions WHERE awardType IN ('tickets', 'tickets_baf')` (winner = :addr) | `COUNT(*)` -- counts win events, not ticket quantity. D-11 wording "ticket wins" reads as count of win events. |

## Error Modes

| Status | Condition | Response |
|--------|-----------|----------|
| 200 | Day found, data available | Full payload as above |
| 200 | No data for day (player existed but inactive) | Full payload with empty arrays and zero counts; `scoreBreakdown` reflects on-chain value at block (contracts always return a number) |
| 404 | Player not found | `{ statusCode: 404, error: "Not Found", message: "Player ... not found" }` (matches current behavior) |
| 404 | Day not found | `{ statusCode: 404, error: "Not Found", message: "day_not_found", day: N }` (matches /activity-score?day=N pattern) |
| 500 | Block-resolution or eth_call failure with ?day=N given | Fall back to live value for score fields, set `historicalUnavailable: true`, return 200. Non-historical (current) requests re-throw as 500. Matches current activity-score handler. |

UI degradation path (handled in Phase 51 Wave 2): on 404/500, render score as `--`, popover rows as `--`, quest slots / daily activity as "(no data for day N)". Keep-old-data-dim stays on until the next successful fetch.

## Contract-Call Map

| Response field | Primary source | Notes |
|----------------|----------------|-------|
| `scoreBreakdown.totalBps` | `DegenerusGame.playerActivityScore(player)` via `fastify.readActivityScore(addr, blockNumber)` eth_call | Already wired at `database/src/api/plugins/ticket-bucket-reader.ts:69-83` |
| `scoreBreakdown.questStreakPoints` | Capped `min(questStreak, 100)` derived from `DegenerusQuests.playerQuestStates(player).streak` via eth_call OR from `player_streaks.currentStreak` indexed table (simpler) | Deity passholders: always 50 (short-circuit in MintStreakUtils.sol:110-112) |
| `scoreBreakdown.mintCountPoints` | `(levelCount * 25) / currLevel`, cap 25 | Contract math in `_mintCountBonusPoints`; reads `mintPacked_[player]` bits + `level`. Deity: 25. Whale/Lazy floor: 25 when `bundleType in {1,3} AND frozenUntilLevel > currLevel` |
| `scoreBreakdown.affiliatePoints` | `DegenerusAffiliate.affiliateBonusPointsBest(currLevel, player)` OR cached `mintPacked_[player]` field (bits 209-214) | Cap 50 per `AFFILIATE_BONUS_MAX` (DegenerusAffiliate.sol:162) |
| `scoreBreakdown.passBonus` | Deity first, then `bundleType == 3` (100-level whale), then `bundleType == 1 AND frozenUntilLevel > currLevel` (10-level whale / lazy) | From indexed `deity_pass_ownership` and `player_whale_passes` tables OR from eth_call. Backend picks highest active; returns `null` if none |
| `quests[]` | `quest_progress` table joined to `quest_definitions` for day=N | Fully indexed; no eth_call needed for progress/target. `requirementMints`/`requirementTokenAmount` require contract read OR new indexed column |
| `questStreak.baseStreak` | `player_streaks.currentStreak` OR reconstructed (see Open Question 1) | |
| `questStreak.lastCompletedDay` | `player_streaks.lastCompletedDay` OR reconstructed | |
| `dailyActivity.*` | See Daily Activity Counts table above | |

## Related Existing Endpoints

- `GET /player/:address` -- current player dashboard; returns latest-only state; Phase 51 extends with `?day=N`.
- `GET /player/:address/activity-score?day=N` -- existing day-aware scalar bps endpoint; the day-resolution SQL pattern is identical.
- `GET /replay/rng` -- Phase 50 uses this to enumerate days with resolved RNG; no change.
- `GET /replay/players` -- Phase 50 uses this for the player-selector dropdown; no change.

## Acceptance Criteria

- Endpoint reachable at `GET /player/:address?day=N` (and still at `GET /player/:address` without query).
- When `?day=` is omitted, response is a strict superset of today's `playerDashboardResponseSchema` (adds `day: null`, `blockNumber: null`, `historicalUnavailable: false`, `scoreBreakdown`, `questStreak`, `dailyActivity`). Existing `beta/` consumers continue to work.
- When `?day=N` is supplied, day-resolution matches `/activity-score?day=N` semantics (end-of-day-N block = `daily_rng.blockNumber[day=N+1] - 1`).
- `scoreBreakdown.{questStreakPoints, mintCountPoints, affiliatePoints}` populated as integer points per the cap rules above.
- `scoreBreakdown.passBonus` is either null or contains the single highest active pass.
- `scoreBreakdown.totalBps === sum(component points * 100) + passBonus?.points * 100` when no deity short-circuit applies (sanity check).
- `quests[]` filtered to `WHERE day = N` when `?day=N` is supplied.
- `quests[].requirementMints` and `quests[].requirementTokenAmount` populated from contract (not hardcoded 0/'0').
- `quests[].highDifficulty` remains `false` hardcoded (schema-only vestige; UI ignores per Phase 51 D-20).
- `questStreak.baseStreak` and `questStreak.lastCompletedDay` reflect end-of-day-N state (or set `historicalUnavailable: true` if reconstruction not implemented).
- `dailyActivity.{lootboxesPurchased, lootboxesOpened, ticketsPurchased, ticketWins}` counts correct per the Daily Activity table above.
- 404 responses use the exact `{ statusCode, error, message, day? }` shape above.
- 500 fallback sets `historicalUnavailable: true` and returns 200 for `?day=N` requests (matches activity-score handler).

## Timeline

- Phase 51 Wave 0 (website repo): this spec is committed to the website repo (done by this plan).
- Phase 51 Wave 2 (HARD GATE, D-15): UI hydration does NOT merge until the database repo ships the extended endpoint. Solo dev self-coordinates by switching to `/home/zak/Dev/PurgeGame/database/` when ready, implementing, and returning. Same pattern as Phase 50 INTEG-01.
- Phase 51 Wave 0 also strikes the "high-difficulty flag styling" clause from PROFILE-02 in `.planning/REQUIREMENTS.md`, adds PROFILE-05 (Daily Activity counts) per D-19/D-20, and resolves the INTEG-02 identifier collision (old INTEG-02 Phase 54 BAF endpoint renumbered to INTEG-05; new INTEG-02 reissued for this extended endpoint per D-15).

## Open Questions

1. **Historical streak reconstruction strategy.** Options A (replay events), B (history table), C (fallback with `historicalUnavailable: true`). Database team picks at implementation time. UI trusts whatever comes back.
2. **`ticketsPurchased` semantic lock.** Paid mints only (per this spec) vs. all queued tickets including jackpot wins. D-11 separates "tickets purchased" from "ticket wins" so paid-only is the natural reading. If the database team prefers total-queued, surface the alternative as a follow-up spec edit; Phase 51 UI accepts either as long as it is consistent with `ticketWins`.

## Confidence

- HIGH on the need and on the endpoint path (extending existing route; no new surface).
- HIGH on `scoreBreakdown` decomposition -- verified against `/home/zak/Dev/PurgeGame/degenerus-audit/contracts/modules/DegenerusGameMintStreakUtils.sol:83-163` and `/home/zak/Dev/PurgeGame/degenerus-audit/contracts/DegenerusAffiliate.sol:162`.
- HIGH on `highDifficulty` hardcoded-false -- verified at `DegenerusQuests.sol:1090` and `database/src/api/routes/player.ts:130`.
- HIGH on Daily Activity DB mappings -- verified against `database/src/db/schema/lootbox.ts`, `database/src/db/schema/jackpot-history.ts`, `database/src/handlers/lootbox.ts:30-100`, `database/src/handlers/jackpot.ts`.
- MEDIUM on the exact final shape (database team may refine field names during implementation).
