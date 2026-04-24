# INTEG-01 Spec: GET /player/:address/tickets/by-trait

**Phase:** 52 -- Tickets, Packs & Jackpot Reveal (carried forward from Phase 50 kickoff)
**Requirement:** INTEG-01 (kickoff in Phase 50 per the original 50-INTEG-01-SPEC.md; delivery gates Phase 52 Wave 2)
**Owner:** website repo (proposal); database repo (implementation)
**Status:** DRAFT -- carried forward from Phase 50 kickoff; Wave 2 delivery required (hard gate; mirrors INTEG-02 delivery pattern from Phase 51)
**Superseded at:** this file (.planning/phases/52-tickets-packs-jackpot/INTEG-01-SPEC.md) is the living version; Phase 50 original is the historical kickoff document and stays unchanged
**Posted:** 2026-04-23 (original) / carried forward 2026-04-24 (Phase 52 planning)

## Why This Endpoint Is Needed

Phase 52 (Tickets, Packs & Jackpot Reveal) renders each player's ticket inventory as 4-trait quadrant cards (TICKETS-01..04, PACKS-01..05). Each card groups 4 consecutive entries by `entryId`, shows the traitId per quadrant when assigned, and renders a "pending pack" placeholder when VRF has not yet resolved.

The existing `/player/:address` response returns only `{level, ticketCount}` per level (see `database/src/api/schemas/player.ts:77-80`). That shape is insufficient for 4-quadrant card rendering because it omits per-entry traitIds and does not group entries into cards.

The existing `/replay/player-traits/:address` endpoint (see `database/src/api/routes/replay.ts:405`) returns a flat deduplicated trait list -- also insufficient for card grouping.

A new endpoint is required.

## Endpoint

`GET /player/:address/tickets/by-trait?level=N&day=M`

### Path Parameters

- `:address` -- 42-char `0x…` Ethereum address, lowercased.

### Query Parameters

- `level` (required, integer) -- the jackpot level whose tickets to return. Ticket storage is per-purchaseLevel (see `beta/components/replay-panel.js:444`).
- `day` (optional, integer) -- effective day. If omitted, return current/latest state. If supplied, return as-of end-of-day-M snapshot, following the pattern used by `/player/:address/activity-score?day=N` (see `database/src/api/routes/player.ts:42-65`).

### Response JSON Schema

```json
{
  "address": "0x1234...",
  "level": 5,
  "day": 123,
  "totalEntries": 12,
  "cards": [
    {
      "cardIndex": 0,
      "status": "opened",
      "entries": [
        { "entryId": 0, "traitId": 14, "traitLabel": "zodiac_cancer_blue" },
        { "entryId": 1, "traitId": 72, "traitLabel": "cards_horseshoe_green" },
        { "entryId": 2, "traitId": 138, "traitLabel": "dice_3_purple" },
        { "entryId": 3, "traitId": 205, "traitLabel": "crypto_bitcoin_gold" }
      ],
      "source": "purchase",
      "purchaseBlock": "12345678"
    },
    {
      "cardIndex": 1,
      "status": "pending",
      "entries": [
        { "entryId": 4, "traitId": null, "traitLabel": null },
        { "entryId": 5, "traitId": null, "traitLabel": null },
        { "entryId": 6, "traitId": null, "traitLabel": null },
        { "entryId": 7, "traitId": null, "traitLabel": null }
      ],
      "source": "jackpot-win",
      "purchaseBlock": null
    },
    {
      "cardIndex": 2,
      "status": "partial",
      "entries": [
        { "entryId": 8, "traitId": 22, "traitLabel": "zodiac_gemini_red" },
        { "entryId": 9, "traitId": 102, "traitLabel": "cards_diamond_silver" },
        { "entryId": 10, "traitId": null, "traitLabel": null },
        { "entryId": 11, "traitId": null, "traitLabel": null }
      ],
      "source": "purchase",
      "purchaseBlock": "12345900"
    }
  ]
}
```

### Card Status Values

- `opened` -- all 4 entries have traitIds assigned (ready to render quadrants)
- `pending` -- no entries have traitIds yet (pack awaiting VRF; source `jackpot-win` or `purchase` awaiting resolve)
- `partial` -- fewer than 4 entries present (trailing incomplete card; required for TICKETS-03)

### Source Values

- `purchase` -- player bought the ticket
- `jackpot-win` -- player won tickets from a jackpot draw (PACKS-02)
- `lootbox` -- player opened a lootbox (traits are known immediately per PACKS-04)

## Server-Side Grouping Logic (proposal)

1. Fetch all `player_tickets` entries for `(address, level)` ordered by `entryId`.
2. Group consecutive 4 entries into cards (entryId `0..3` = card 0, `4..7` = card 1, and so on).
3. For each entry, look up the trait assignment from `traits_generated` (table per `database/src/indexer/trait-derivation.ts`).
4. If `traits_generated` has no row for that `entryId`, set `traitId = null`, `traitLabel = null`; card status becomes `pending` (if all 4 unset) or `partial` (if fewer than 4 entries present, by convention -- card would only have 2-3 entries because the player has not yet acquired the 3rd/4th ticket at level N).
5. Resolve `source` from the original entry event (already indexed per the existing tickets/lootbox/jackpot handlers).

## Related Existing Endpoints

- `GET /player/:address` -- player dashboard; has flat `tickets[]` with `{level, ticketCount}` only (no trait detail).
- `GET /replay/player-traits/:address` -- returns all trait IDs owned by a player, deduplicated, flat (no card grouping).

## Acceptance Criteria

- Endpoint reachable at `GET /player/:address/tickets/by-trait?level=N` (day optional).
- Response shape matches the JSON schema above exactly (field names, types, enum values).
- For a player with zero tickets at `level`, response is `{ "address": ..., "level": ..., "day": ..., "totalEntries": 0, "cards": [] }`.
- For a player with a partial trailing card, that card has `status: "partial"` and fewer than 4 entries.
- `day` query parameter resolves end-of-day-N state (matches `/activity-score?day=N` semantics).

## Timeline

- Phase 50 (website repo): post this spec to the database team (kickoff).
- Phase 52 (website repo): TICKETS/PACKS code lands only after the database team confirms the endpoint is shipped (or deployed to a testnet endpoint that the website dev server can call).
- Any shape changes proposed by the database team update this document; Phase 52 rebases off the final version.

## Confidence

- HIGH on endpoint being needed and on the path convention (matches existing `/player/:a/*` shape).
- MEDIUM on the exact JSON shape (proposal; database team may adjust -- e.g., rename `source` to `origin`, add/remove fields). Phase 52 rebases when the final shape lands.

## Phase 52 Implementation Notes

This appendix expands the Server-Side Grouping Logic section with database-side implementation detail gathered in Phase 52 research (52-RESEARCH.md Section 10). Same pattern as Phase 51's INTEG-02 side-quest shipped 3 commits (feat / docs / test) in roughly 5 minutes.

### Database-side file map

- Handler: `/home/zak/Dev/PurgeGame/database/src/api/routes/player.ts` -- extend the existing `playerRoutes` plugin with a new `GET /player/:address/tickets/by-trait` route handler.
- Schema: `/home/zak/Dev/PurgeGame/database/src/api/schemas/player.ts` -- add two new Zod/TypeBox schemas: `ticketsByTraitQuerySchema` (level required, day optional) and `ticketsByTraitResponseSchema` (shape per the JSON schema above).
- Test: `/home/zak/Dev/PurgeGame/database/src/api/routes/__tests__/player-tickets-by-trait.test.ts` -- new vitest file covering happy path, 404 day_not_found, empty cards (player has 0 tickets at level), and partial trailing card.

### Data sources

The handler assembles `cards[]` from three existing tables:

1. `player_tickets` (`database/src/db/schema/tickets.ts`) -- upsert-accumulated counts per (player, level). Used for `totalEntries`.
2. `traits_generated` (`database/src/db/schema/lootbox.ts:36`) -- append-only rows; each row is one `TraitsGenerated` event with `traitIds` (JSONB array), `count`, `blockNumber`, `logIndex`. Used for per-entry trait assignments.
3. `lootbox_results` + `jackpot_distributions` (`database/src/db/schema/lootbox.ts` + `jackpot-history.ts`) -- cross-referenced by same-transaction hash to determine the `source` field.

### startIndex reconstruction (Option B from RESEARCH)

`startIndex` is not currently a column in `traits_generated`. Two implementation paths:

- Option A: add a `startIndex` column + backfill migration. Cleanest long-term; requires a schema edit.
- Option B: reconstruct at read time. For a given (player, level), order `traits_generated` rows by `(blockNumber, logIndex)` ascending; the startIndex of row N = sum of the `count` fields of rows 0..N-1. Relies on the invariant that `TraitsGenerated` events fire in monotonic block+log order per (player, level), which is true for the current indexer.

Recommendation: Option B for the initial Phase 52 ship. Zero schema change. If the query proves too slow at high-ticket scale (>100 entries per player per level), promote to Option A in a follow-up phase.

### Source determination heuristic

Three sources per the INTEG-01 spec: `purchase`, `jackpot-win`, `lootbox`.

- `purchase`: default. Any `TicketsQueued`/`TicketsQueuedScaled`/`TicketsQueuedRange` event where `buyer === player`.
- `lootbox`: the same `TicketsQueued*` event's transaction hash matches a `lootbox_results` row with `rewardType IN ('opened', 'burnieOpened')` where `player === :address`.
- `jackpot-win`: the same `TicketsQueued*` event's transaction hash matches a `jackpot_distributions` row with `awardType IN ('tickets', 'tickets_baf')` where `winner === :address`.

Precedence when a transaction matches both lootbox and jackpot cross-refs (rare): prefer `jackpot-win` (awardType carries explicit semantic weight). Unknown or un-cross-referenced: fall back to `purchase`.

### Status determination

- `opened`: all 4 entries in the card have non-null `traitId`.
- `pending`: all 4 entries exist (cardIndex * 4 + 0..3 all within `totalEntries`) AND none have `traitId` assigned.
- `partial`: fewer than 4 entries present in the trailing card (e.g., player has 10 entries -> cardIndex 2 has only 2 entries with entryId 8 and 9). A partial card may mix null and non-null traitIds for its present entries.

### Known non-blocking TODOs (mirror INTEG-02 precedent)

The first database-repo commit may ship with some fields hardcoded or approximated. UI degrades gracefully. Expected non-blocking TODOs:

- `purchaseBlock` may be null in the first pass (fix: join `raw_events` by tx hash on demand).
- Source field may default to `'purchase'` universally in the first commit, with the lootbox/jackpot heuristic arriving in a follow-up commit.
- `status: 'partial'` may be conflated with `'pending'` initially (fix: two distinct checks on `entries.length` vs `totalEntries` boundary).

UI renders whatever comes back. These refinements do not gate Phase 52 completion; they surface as backlog for Phase 53+.

### Expected delivery: 3 atomic commits

Mirroring Phase 51's INTEG-02 side-quest structure (database commits `d135605` feat, `dab5adf` docs, `64fe8db` test):

- Commit 1 (feat): handler + schema implementation. New route wired to `playerRoutes`. Response shape matches the JSON schema above.
- Commit 2 (docs): update `database/TODOS.md` or `database/CHANGES.md` with a line noting the new endpoint is shipped; reference this spec.
- Commit 3 (test): vitest covering happy path (player with 3+ cards mixing opened/pending/partial), 404 day_not_found, empty cards (player with 0 tickets), and a partial trailing card fixture.

Phase 52 Wave 2 does not merge until all 3 database commits land on `database/main`.

### Open question (tracked, non-blocking)

- **Jackpot-win semantics.** Per 52-RESEARCH.md Section 10, jackpot-win tickets may be written to level+1 (one level ahead) via `TicketsQueuedRange` rather than the current level. Need to verify against live DB contents before locking the heuristic. If true, the source detection should scope to the event's `targetLevel` rather than the player's (level, day) query. Database-side test fixture should include both scenarios.

### Confidence

- HIGH on data-source table locations + day-resolution reuse of `/activity-score?day=N` SQL.
- MEDIUM on source-determination heuristic (A5 in the research Assumptions Log) -- needs verification against live data; fallback to `purchase` is always safe.
- MEDIUM on startIndex reconstruction invariant (A4) -- verified at the indexer level but not at the event level; add a database-side assertion test in Commit 3 if feasible.
