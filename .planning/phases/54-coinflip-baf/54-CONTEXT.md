# Phase 54 -- CONTEXT: Coinflip & BAF Leaderboards

**Phase goal (from ROADMAP.md):** Selected player's coinflip state and BAF standing are visible, and both leaderboards render with prominence styling that mirrors beta.

**Requirements:** COINFLIP-01, COINFLIP-02, COINFLIP-03, BAF-01, BAF-02, BAF-03, INTEG-05 (hard gate), INTEG-04 (optional).

**Depends on:** Phase 50 (route + store), Phase 51 (PROFILE patterns — activity-score-based sizing informs BAF prominence).

**Status:** Pre-discuss; autonomous decisions made for gray areas since user is asleep.

## Scope Decision

Ship Phase 54 in the standard 4-wave shape (same cadence as Phase 51 + Phase 52):
- Wave 0: test harness + INTEG-05 spec + any DB-spec required + REQUIREMENTS update if needed
- Wave 1 (autonomous, pre-backend): skeleton Custom Elements from stub to functional, reading what the existing `/leaderboards/*` endpoints provide
- Wave 2 (hard-gated on INTEG-05): per-player BAF score hydration
- Wave 3 (manual UAT, deferrable per precedent)

Existing endpoints that unblock immediate work:
- `GET /leaderboards/coinflip?day=N` -- returns top-10 with `{day, player, score, rank}` (COINFLIP-02 live)
- `GET /leaderboards/baf` -- returns top-4 with `{level, player, score, rank}` (BAF-02 live)

Gaps that need shipping:
- **INTEG-05:** per-player BAF score endpoint (e.g., `GET /player/:address/baf?level=N`) returning `{score, rank, totalParticipants, roundStatus: 'open' | 'closed'}` for BAF-01 + BAF-03
- **INTEG-04** (optional): coinflip recycle/history endpoint for a per-player coinflip activity view -- deferrable per ROADMAP line 149

## Decisions (D-01..D-10)

### D-01 Two Custom Elements, not one combined panel.
`<coinflip-panel>` and `<baf-panel>` both exist as Phase 50 stubs. Evolve them in place. Don't create a joint "leaderboard" panel -- coinflip and BAF are independent systems with different data flows.

### D-02 Reuse beta styling where trivially extractable.
`beta/components/baf-panel.js` (171 lines) and `beta/styles/baf.css` are the prominence-styled reference. Read beta's BAF CSS and fold relevant rules into `play/styles/play.css` under `.play-baf-panel` scope. Do NOT import beta/components directly -- they may have wallet-tainted imports. Pattern-match only.

### D-03 Leaderboard fetch uses existing `/leaderboards/*` endpoints (no new endpoint for these).
COINFLIP-02 and BAF-02 hit existing endpoints. Phase 54 Wave 1 ships both panels as live leaderboards. No INTEG gate for these two.

### D-04 Per-player BAF score needs INTEG-05 (new endpoint in database repo).
BAF-01 ("user sees player's BAF score and rank at current level/window") cannot be satisfied from `/leaderboards/baf` alone -- that returns only top-4. A top-4 player is covered, but everyone else needs a per-player lookup. Spec INTEG-05 to:
  - `GET /player/:address/baf?level=N` -> `{level, player, score, rank, totalParticipants, roundStatus: 'open' | 'closed'}`
  - Same day-resolution pattern as INTEG-02 and INTEG-01.

### D-05 COINFLIP-01 (player's coinflip state) is already in the extended /player/:address INTEG-02 response.
Phase 51 INTEG-02 extended `/player/:address` to include `coinflip: { depositedAmount, claimablePreview, autoRebuyEnabled, autoRebuyStop, currentBounty, biggestFlipPlayer, biggestFlipAmount }`. Coinflip panel reads from this same endpoint; no new fetch needed. COINFLIP-01 + COINFLIP-03 come from the same object.

### D-06 Prominence styling for BAF top-4 mirrors beta.
Top-4 rows get tier-based colors + size: rank 1 = gold prominent, rank 2 = silver, rank 3 = bronze, rank 4 = regular. Other BAF players (outside top-4) render in a "You: rank N" row below the leaderboard (the BAF-01 per-player lookup feeds this row).

### D-07 Coinflip leaderboard is a simple sortable table.
Top-10 with `rank`, `player` (truncated addr), `score`. No prominence styling for coinflip -- the visual differentiator is BAF's.

### D-08 Bounty display sits above the coinflip leaderboard.
COINFLIP-03 "current bounty + biggest-flip-today player and amount" renders as a dedicated section at the top of `<coinflip-panel>`. Reads from the extended `/player/:address` response's coinflip block (same source per D-05).

### D-09 BAF round status label.
BAF-03 "user sees which level/window the BAF round is for and whether the round is open or closed". Read from existing `game.level` + a new flag from INTEG-05 (`roundStatus`). Or derive: BAF round = current level; status = open while game.phase === 'PURCHASE', closed otherwise. Conservative approach: expose via INTEG-05 so the backend is authoritative.

### D-10 INTEG-04 deferred.
Per ROADMAP line 149 success criterion 5: "INTEG-05 confirmed before BAF-01 lands; INTEG-04 confirmed OR formally documented as deferred with COINFLIP still functional." Coinflip works without recycle history — the /player/:address response covers COINFLIP-01 and /leaderboards/coinflip covers COINFLIP-02. INTEG-04 is a nice-to-have for future polish. Document as deferred in REQUIREMENTS.md.

## Gray Areas Autonomously Decided (user asleep)

- Leaderboard refresh cadence: on day scrubber change only (same as profile/tickets/packs). No polling. User scrubs day, leaderboard refetches via stale-guard.
- Rank of player not in top-4: show below the leaderboard as "You: rank N of M". Clicking a row doesn't do anything (read-only).
- Empty state: Day has no coinflip activity — render "No coinflip activity for day N". BAF round has no participants — render "BAF round not yet live".
- Highlighting the selected player in the leaderboard: yes, add `[aria-current="true"]` on the row if `player === state.replay.player`. CSS bolds + underlines it.
- Truncated address display: use `truncateAddress` from `beta/viewer/utils.js` (wallet-free; already used by other play/ components).
- Skeleton shimmer: standard (matches Phase 51+52 panels).

## Scope Additions

None. Scope matches ROADMAP.md.

## Deferred Ideas

- INTEG-04 (coinflip history endpoint) — not blocking Phase 54 per ROADMAP success criterion 5
- Clickable leaderboard rows (select player from leaderboard) — polish, not in Phase 54
- Historical BAF leaderboards (top-4 at past levels) — would need a new endpoint + is polish
- Animated rank changes — polish
- Filters / sort controls — out of scope

## Canonical Refs

- `beta/components/coinflip-panel.js` (352 lines) — visual reference for coinflip layout; don't import (may be wallet-tainted; verify)
- `beta/components/baf-panel.js` (171 lines) — visual reference for BAF layout + prominence styling; don't import
- `beta/styles/baf.css` — prominence styling source
- `beta/styles/coinflip.css` — coinflip layout source
- `/home/zak/Dev/PurgeGame/database/src/api/routes/leaderboards.ts` — existing endpoints `/coinflip` and `/baf`
- `/home/zak/Dev/PurgeGame/database/src/api/routes/player.ts` — where INTEG-05 handler lands (extend)
- `.planning/phases/51-profile-quests/INTEG-02-SPEC.md` — template for INTEG-05 spec
- `.planning/phases/52-tickets-packs-jackpot/INTEG-01-SPEC.md` — template
- `play/components/profile-panel.js` — gold-standard play/ Custom Element shape; coinflip + baf follow same pattern
- `play/components/tickets-panel.js` — shape for list-driven panels (rank rows structurally similar to card grid rows)
- `play/app/tickets-fetch.js` — shared-fetch helper pattern; new `play/app/leaderboards-fetch.js` follows same shape
- `beta/viewer/utils.js` — wallet-free `formatEth`, `formatBurnie`, `truncateAddress`
- `CLAUDE.md` — no em-dashes, no emojis

## Implementation Path Sketch (Wave Plan Hint for Planner)

**Wave 0 (autonomous):**
- INTEG-05-SPEC.md authored (per-player BAF score endpoint)
- Test harness: play-coinflip-panel.test.js + play-baf-panel.test.js (RED assertions gated on Wave 1+2)
- play-shell-01 still green (recursive scan across new play/ code)
- REQUIREMENTS.md: INTEG-04 marked deferred (optional per ROADMAP); INTEG-05 stays [ ] pending Wave 2 ship

**Wave 1 (autonomous, pre-backend):**
- coinflip-panel.js evolved from stub to live (COINFLIP-01 from extended /player response, COINFLIP-02 from /leaderboards/coinflip, COINFLIP-03 from coinflip block). Uses existing endpoints.
- baf-panel.js evolved from stub (BAF-02 from /leaderboards/baf live; BAF-01 + BAF-03 initially blank / hydrated-by-Wave-2)
- play/app/leaderboards-fetch.js (shared fetch helper with in-flight dedup)
- CSS: prominence styling for BAF top-4, coinflip table, bounty header
- Main.js if needed: subscribe wiring additions

**Side-quest (database repo):** ship INTEG-05 per spec (3 atomic commits feat/docs/test — same pattern as INTEG-01/02)

**Wave 2 (hard-gated on INTEG-05):** hydrate BAF-01 + BAF-03 from INTEG-05; add the "You: rank N of M" row below the leaderboard.

**Wave 3 (manual UAT, optional):** verify prominence styling, rank highlighting, bounty display. Likely deferred per precedent.

## Decisions Checksum

D-01 Two Custom Elements: `<coinflip-panel>` + `<baf-panel>` (evolve Phase 50 stubs)
D-02 Reuse beta/ styling via pattern-match (no import)
D-03 Leaderboard endpoints already exist (COINFLIP-02, BAF-02)
D-04 INTEG-05 needed for BAF-01 (per-player score endpoint)
D-05 COINFLIP-01/03 already in INTEG-02 extended response
D-06 BAF top-4 prominence styling
D-07 Coinflip leaderboard as simple table (no prominence)
D-08 Bounty display above coinflip leaderboard
D-09 BAF round status from INTEG-05 (level + open/closed)
D-10 INTEG-04 deferred

**Ready for:** `/gsd-plan-phase 54`. Planner should produce 4 plans matching Phase 51/52 cadence.
