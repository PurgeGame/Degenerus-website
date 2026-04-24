# INTEG-01 Spec: GET /player/:address/tickets/by-trait

**Phase:** 50 -- Route Foundation & Day-Aware Store
**Requirement:** INTEG-01 (kickoff in Phase 50; delivery gates Phase 52)
**Owner:** website repo (proposal); database repo (implementation)
**Status:** DRAFT -- awaiting database team confirmation
**Posted:** [fill in timestamp + venue when coordination ping is sent in Task 3]

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
