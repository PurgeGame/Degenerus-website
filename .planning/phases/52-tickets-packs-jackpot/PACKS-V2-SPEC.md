# Packs Panel v2 -- Day-Reveal Spec (Phase 52 Gap-Closure)

**Status:** DRAFT -- spec written 2026-04-24 during UAT review; ship in a fresh session.
**Why:** Phase 52 packs panel renders one card per 4 entries. With abandoned tickets common (level rolled forward without VRF), inventory shows hundreds of empty placeholder packs (e.g., 1808 for player 0x14dc79964d... at level 10). The user's intended model is fundamentally different.

## Mental Model (locked)

- A **pack** is an inventory unit of N tickets. Once acquired, owned forever.
- A pack has a **source** (acquisition method, metadata only): `purchase` / `jackpot_win` / `lootbox_open`.
- A pack has an **acquired_day**: when it entered inventory.
- A pack has a **reveal_day** (nullable): when VRF fired and traits became known.
- "Already owned" packs are NOT purchases. Purchase is one acquisition path; ownership is a property of the pack itself.

## State Machine vs Scrubber Day D

| Condition | UX state | Render |
|-----------|----------|--------|
| `acquired_day > D` | future | not in view (didn't exist yet) |
| `reveal_day < D` | already-open | traits visible, no click, history view |
| `reveal_day === D` | revealable | sealed pack, click runs reveal animation |
| `reveal_day > D` or `null` | sealed-pending | placeholder, no click, waiting for VRF |

Lootbox source: `reveal_day === acquired_day` always (traits known at open time).

## Packs Panel Scope

**The packs panel shows the SELECTED DAY's reveal activity only**, not cumulative inventory:

1. **Lootbox section** -- all lootboxes opened by this player on day D. Each lootbox = one auto-revealed pack with its traits visible. (Renders the result of an open, since lootbox open = lootbox reveal.)
2. **Ticket-reveal section** -- tickets revealed by VRF on day D (from `traits_generated` events on this day). Group consecutive revealed tickets into bundles of **10 tickets per pack**. Each bundle is a sealed clickable pack. Click -> all 10 tickets animate-reveal at once.

Past-day packs (reveal_day < D) live in the **tickets-panel** as cumulative inventory. They do not re-appear in packs-panel on subsequent days. Packs-panel is "what happened today", tickets-panel is "what you own across all days".

Future-day reveals (reveal_day > D) do not render in packs-panel. They surface when the user scrubs to that day.

## New Backend Endpoint

`GET /player/:address/packs?day=N`

### Response

```json
{
  "address": "0x...",
  "day": 170,
  "blockNumber": "12345",
  "lootboxPacks": [
    {
      "packId": "lootbox-{txHash}-{logIndex}",
      "lootboxIndex": 5,
      "ethSpent": "50000000000000000",
      "burnieSpent": "0",
      "ticketCount": 4,
      "tickets": [
        { "traits": [14, 72, 138, 205] }
      ],
      "revealBlock": "12340"
    }
  ],
  "ticketRevealPacks": [
    {
      "packId": "tickets-day-{day}-batch-0",
      "ticketCount": 10,
      "tickets": [
        { "traits": [14, 72, 138, 205] },
        { "traits": [22, 102, 144, 207] },
        ...
      ],
      "revealBlock": "12342"
    },
    {
      "packId": "tickets-day-{day}-batch-1",
      "ticketCount": 10,
      "tickets": [...]
    }
  ]
}
```

### Field notes

- `revealBlock`: the indexed block where the trait reveal landed; useful for ordering across packs and for stale-guard semantics.
- `tickets[].traits`: array of 4 trait IDs per ticket. Trait labels can be derived client-side via the existing `traitToBadge()` helper, no need to round-trip them.
- `ticketCount` is per-pack: lootbox packs reflect the actual lootbox size; ticket-reveal packs are 10 except the trailing pack which may have <10.
- Empty day (no reveals): `{ lootboxPacks: [], ticketRevealPacks: [] }` with status 200.

### Day resolution

Same pattern as INTEG-02/03/05:
- Resolve start-of-day-N block and end-of-day-N block via `daily_rng` lookup.
- Filter all queries to `blockNumber BETWEEN dayStart AND dayEnd`.
- 404 on day_not_found.

### Data source queries

**Lootbox packs**:
```sql
SELECT lr.id, lr."rewardType", lr."transactionHash", lr."blockNumber", lr."logIndex",
       lp."lootboxIndex", lp."ethSpent", lp."burnieSpent",
       tg."traitIds", tg.count
FROM lootbox_results lr
LEFT JOIN lootbox_purchases lp 
  ON lp."transactionHash" = lr."transactionHash"
  AND lp.player = lr.player
LEFT JOIN traits_generated tg
  ON tg."transactionHash" = lr."transactionHash"
  AND tg.player = lr.player
WHERE lr.player = :address
  AND lr."rewardType" IN ('opened', 'burnieOpened')
  AND lr."blockNumber" BETWEEN :dayStart AND :dayEnd
ORDER BY lr."blockNumber" ASC, lr."logIndex" ASC
```

If `traits_generated` doesn't join cleanly via tx hash, inspect `database/src/handlers/lootbox.ts` to find the actual relationship. Possible fallback: lootbox traits live in `lootbox_results.rewardData` JSONB once the `rewardType='opened'` handler populates it (currently empty per quick check).

**Ticket-reveal packs**:
```sql
SELECT id, "traitIds", count, "blockNumber", "logIndex"
FROM traits_generated
WHERE player = :address
  AND "blockNumber" BETWEEN :dayStart AND :dayEnd
  AND "transactionHash" NOT IN (
    SELECT "transactionHash" FROM lootbox_results 
    WHERE player = :address 
      AND "blockNumber" BETWEEN :dayStart AND :dayEnd
      AND "rewardType" IN ('opened', 'burnieOpened')
  )
ORDER BY "blockNumber" ASC, "logIndex" ASC
```

(Excludes traits_generated rows that came from lootbox opens; those are already covered in lootboxPacks.)

Concatenate all `traitIds` across rows, chunk into groups of 40 (10 tickets * 4 traits each), each chunk is one ticket-reveal pack.

## Backend Implementation Plan

3 atomic commits in `degenerus-database/`:

1. `feat(api): add GET /player/:address/packs endpoint (PACKS-V2)` -- handler in `src/api/routes/player.ts`, schema in `src/api/schemas/player.ts`
2. `docs(openapi): document /player/:address/packs (PACKS-V2)` -- `docs/openapi.yaml`
3. `test(api): cover PACKS-V2 lootbox + reveal grouping + day not found` -- `src/api/__tests__/player-packs.test.ts`

Tests to write (~8 scenarios):
- Lootbox packs: seed 2 lootbox opens with traits, request `?day=N`, assert 2 lootboxPacks with correct ticket counts
- Ticket reveal packs: seed `traits_generated` with 25 tickets total on day N, assert 3 ticketRevealPacks (10, 10, 5)
- Lootbox vs reveal exclusion: seed a lootbox open + a separate ticket reveal on same day, assert no double-counting
- Empty day: assert `{ lootboxPacks: [], ticketRevealPacks: [] }`
- 404 day_not_found: standard pattern
- Order: assert chronological order within each section
- 0-tickets edge: trailing partial pack with <10 tickets renders correctly

## Frontend Implementation Plan

### New helper: `play/app/day-packs-fetch.js`

Modeled on `tickets-fetch.js`. Single in-flight dedup. Returns the response or null.

```javascript
import { API_BASE } from './constants.js';
const inflight = new Map();
export async function fetchDayPacks(addr, day) {
  const key = `${addr}:${day}`;
  if (inflight.has(key)) return inflight.get(key);
  const promise = fetch(`${API_BASE}/player/${addr}/packs?day=${day}`)
    .then(r => r.ok ? r.json() : null)
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
```

### Rewrite: `play/components/packs-panel.js`

Replace the current INTEG-01-driven render with day-packs-driven render.

- Subscribe to `replay.day` and `replay.player` only (NOT `replay.level` -- packs panel is day-keyed, not level-keyed)
- Fetch `/player/:addr/packs?day=N` via the new helper
- Render two sections:

```html
<section class="packs-panel">
  <header>Packs · Day {N}</header>
  <div class="packs-section packs-lootbox">
    <h3>Lootboxes Opened ({lootboxPacks.length})</h3>
    <div class="lootbox-grid">
      <!-- One auto-revealed pack per lootbox; traits visible -->
    </div>
  </div>
  <div class="packs-section packs-tickets">
    <h3>Ticket Reveals ({ticketRevealPacks.length})</h3>
    <div class="ticket-pack-grid">
      <!-- Sealed packs, click to reveal all 10 tickets at once -->
    </div>
  </div>
</section>
```

- Lootbox pack render: each pack tile shows the N tickets as 4-trait quadrants, all visible immediately, with a small "Lootbox · {ethSpent} ETH" label.
- Ticket reveal pack render: each pack tile starts sealed (a "wrapped" graphic with a count "10 tickets"). On click, GSAP timeline runs: shake, flash, snap-open, then 10 tickets animate-in as 4-trait cards.
- Empty state: "No packs revealed on day N" if both arrays empty.

### CSS additions

- `.packs-section` headers
- `.lootbox-grid` and `.ticket-pack-grid` (auto-fill, ~180-220px tiles)
- `.ticket-pack.sealed` vs `.ticket-pack.opened` states with the existing GSAP wrapper
- Animation for the 10-tickets-at-once reveal (stagger by ~30ms each)

### Test rewrite: `play/app/__tests__/play-packs-panel.test.js`

Replace existing assertions (which target the cards-from-tickets-by-trait shape) with packs-v2 assertions:
- Subscribes to `replay.day` and `replay.player` (NOT `replay.level`)
- Fetches `/player/:addr/packs?day=N` (not `/tickets/by-trait`)
- Imports `fetchDayPacks` from `play/app/day-packs-fetch.js`
- Renders two sections with `data-bind="lootbox-grid"` and `data-bind="ticket-pack-grid"`
- Lootbox tiles render traits immediately
- Ticket-reveal packs have click handlers
- Empty state copy
- ~25 assertions

## Non-Blocking Items

- The current `play-tickets-panel.test.js` and `tickets-fetch.js` continue to work as-is for the inventory view (tickets-panel uses INTEG-01 v1 keyed by level). No changes needed there.
- INTEG-01 v1's known TODOs (`source` always "purchase", `purchaseBlock` always null) become irrelevant for packs-panel since v2 doesn't use them.

## Out of Scope For This Plan

- Cumulative inventory view (handled by tickets-panel, no changes)
- Past-day pack viewing (the past day is "scrubbed-to-day", at which point those packs reappear in packs-panel as the active day's reveals)
- Pack expiration / abandonment UX (the 1808 abandoned tickets at level 10 simply don't render in packs-panel anymore -- they're in tickets-panel only when traits exist, otherwise invisible)

## Estimated Effort

- Backend: ~1 hour (handler + schema + tests + OpenAPI)
- Frontend: ~1 hour (helper + panel rewrite + CSS + test rewrite)
- Verification: ~15 min (browser smoke-test against live data)

Ship in a fresh session via `/gsd-execute-phase 52 --gaps` after running `/gsd-plan-phase 52 --gaps` to convert this spec into a formal Wave 5 PLAN.md, OR ship informally inline in a fresh session by reading this spec end-to-end.

## Verification Sketch

Browser at `http://localhost:8080/play/` after both backend + frontend ship:
- Pick player `0x14dc79964da2c08b23698b3d3cc7ca32193d9955`, scrub to a day with reveals.
- packs-panel shows lootbox section (auto-revealed traits) + ticket-reveal section (sealed packs).
- Click a sealed ticket-reveal pack: animation runs, 10 tickets appear as 4-trait cards.
- Scrub to a day with no reveals: "No packs revealed on day N".
- Switch player: packs-panel re-fetches and renders the new player's day-N reveals.
- Stale-guard: rapid day-scrub renders only the latest fetch's data.
