# Phase 55 -- CONTEXT: Decimator

**Phase goal (ROADMAP.md):** Selected player's full decimator picture — window state, bucket assignment, weighted burns, winning subbucket payout, and terminal-decimator state — is visible per resolved level.

**Requirements:** DECIMATOR-01, DECIMATOR-02, DECIMATOR-03, DECIMATOR-04, DECIMATOR-05, INTEG-03 (hard gate).

**Depends on:** Phase 50 (route + store), Phase 51 (activity score informs bucket logic per PROFILE patterns), INTEG-03 confirmed.

**Status:** Pre-discuss; autonomous decisions made (user asleep).

## Scope Decision

Ship Phase 55 in the standard 4-wave shape (cadence proven in Phases 51, 52, 54):
- Wave 0 (autonomous): test harness + INTEG-03 spec
- Wave 1 (autonomous, pre-backend): decimator-panel.js evolved from stub; render what the existing extended-player endpoint already exposes (`decimator` block from INTEG-02 + `terminal` block), scaffolded for Wave 2 INTEG-03 hydration
- Wave 2 (hard-gated on INTEG-03): per-player bucket assignment + winning subbucket payout from the new endpoint
- Wave 3 (manual UAT, deferrable per Phase 50-54 precedent chain)

Existing data sources that unblock Wave 1:
- `/player/:address?day=N` coinflip/decimator block already returns `{ windowOpen, activityScore, claimablePerLevel, futurePoolTotal }` per INTEG-02 (Phase 51)
- Terminal block returns `{ burns: [{ level, effectiveAmount, weightedAmount, timeMultBps }] }`
- These cover DECIMATOR-01 (window state), DECIMATOR-03 partial (burn weight), DECIMATOR-05 (terminal)

Gaps for INTEG-03:
- DECIMATOR-02: per-player bucket/subbucket assignment per burned level
- DECIMATOR-03 full: per-level effective-amount with the game's rank-based weighting against subbucket participants
- DECIMATOR-04: winning subbucket reveal + player's payout per resolved level

## Decisions (D-01..D-10)

### D-01 Single Custom Element, `<decimator-panel>`.
Phase 50 stub exists at `play/components/decimator-panel.js`. Evolve in place. Do NOT introduce a separate `<terminal-panel>` — DECIMATOR-05 (terminal state) lives inside the decimator panel as a conditional sub-section shown only when the player has terminal burns.

### D-02 Pattern-match beta styling, don't import.
`beta/components/decimator-panel.js` (246 lines) + `beta/styles/decimator.css` are the reference. Audit for SHELL-01 taint in Wave 0 test harness (likely tainted via ethers — Phase 54 pattern).

### D-03 Bucket rendering shows player's assignment highlighted.
Buckets are 1-8 (per the game model). Render as a table or grid; highlight the row matching the player's assigned bucket for each level. Player not in a bucket for a level = bucket column shows "—" or "N/A".

### D-04 Subbucket winner + payout prominently displayed.
For resolved levels (decimator window closed, winner drawn), render the winning subbucket ID + the player's payout (if they won or were in the winning subbucket). Pattern: payout pill + "You won X ETH" or "Not your subbucket" messaging.

### D-05 Window state as a status badge.
DECIMATOR-01 "user sees decimator window state (open/closed, level, time remaining if applicable)". Render as a status badge at the top of the panel: "Open (Level N)" or "Closed" or "Upcoming". Time remaining if applicable — from existing game state.

### D-06 Terminal section only when active.
DECIMATOR-05 renders a sub-section with burn rows + effective/weighted amounts + time-multiplier per level. Only render this section if `terminal.burns.length > 0`. Otherwise omit entirely (empty state would be clutter for most players).

### D-07 Activity score cross-reference.
The decimator's bucket assignment logic uses activity score. Per Phase 51, the selected player's activity score is in `scoreBreakdown.totalBps`. Show this value in the decimator panel as context: "Activity score: X.XX" next to the window status. Don't re-fetch — just read from the same store path the profile-panel uses.

### D-08 Per-level display uses level scrubber from Phase 50.
DECIMATOR-02/03/04 are per-level. The day scrubber resolves to a level via `state.replay.level`. Decimator panel subscribes to `replay.level` (in addition to `replay.player` and `replay.day`) — mirrors baf-panel's dual-signal pattern from Phase 54.

### D-09 INTEG-03 spec follows INTEG-02/05 template.
`GET /player/:address/decimator?level=N&day=M` returns `{ level, player, bucket, subbucket, effectiveAmount, weightedAmount, winningSubbucket, payoutAmount, roundStatus: 'open' | 'closed' | 'not_eligible' }`. Day-resolution pattern identical to INTEG-02/05. Side-quest delivery: 3 atomic commits (feat/docs/test).

### D-10 INTEG-03 response non-participant handling.
If player didn't burn at level N: bucket=null, subbucket=null, payoutAmount=null, roundStatus='not_eligible' or 'open' (if still eligible). UI renders "No decimator activity at level N" empty state.

## Gray Areas Autonomously Decided

- Refresh cadence: on `replay.level` change (primary), `replay.player` change, `replay.day` change (since level resolves from day).
- Multi-level view: initially shows only the level corresponding to `replay.level`. Future polish could show all burned levels as a table; not in Phase 55 scope.
- Empty states: "No decimator activity" with sub-text "Player has not burned at this level" when bucket=null.
- Selected player highlighting: player's own bucket row gets `[aria-current="true"]`.
- Time-remaining display: derive from `game.levelStartTime` (already in store) + decimator window config constant; render as "X hours remaining" or "Window closed".

## Scope Additions

None. Scope matches ROADMAP.md.

## Deferred Ideas

- Full burn history timeline view (across all levels a player has burned) — nice-to-have, defer
- Animated subbucket reveal — polish, defer
- Comparative bucket analytics (how players in bucket N performed) — out of scope
- Decimator simulator (what-if tools) — out of scope

## Canonical Refs

- `beta/components/decimator-panel.js` (246 lines) — visual reference; don't import (likely wallet-tainted)
- `beta/components/terminal-panel.js` (328 lines) — visual reference for terminal sub-section
- `beta/styles/decimator.css` — layout + bucket table styling
- `beta/styles/terminal.css` — terminal section styling
- `/home/zak/Dev/PurgeGame/database/src/api/routes/player.ts` — where INTEG-03 handler lands (extend; same pattern as INTEG-01/05)
- `/home/zak/Dev/PurgeGame/database/src/db/schema/decimator.ts` — existing schema (decimatorClaims, decimatorBurns, terminalDecimatorBurns already imported in routes/player.ts)
- `.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md` — template for INTEG-03 spec
- `play/components/baf-panel.js` — dual-signal subscription pattern (replay.level + replay.player) to mirror
- `play/components/profile-panel.js` — gold-standard Custom Element shape

## Implementation Path Sketch

**Wave 0 (autonomous):** INTEG-03-SPEC.md (200 lines, mirrors INTEG-05-SPEC); play-decimator-panel.test.js (~30 assertions); SHELL-01 FORBIDDEN +2 (beta/components/decimator-panel.js, beta/app/decimator.js, beta/components/terminal-panel.js, beta/app/terminal.js — so +4 entries).

**Wave 1 (autonomous, pre-backend):** decimator-panel.js evolved from stub. Live DECIMATOR-01 (window state from game.decWindowOpen + game.level + game.levelStartTime), live DECIMATOR-03 partial (weighted/effective amounts from existing /player extended-response), live DECIMATOR-05 (terminal section conditional on terminal.burns.length). Wave 2 gates: DECIMATOR-02 (bucket/subbucket), DECIMATOR-04 (winning subbucket + payout).

**Side-quest (database repo):** INTEG-03 per spec — 3 atomic commits (feat/docs/test) matching INTEG-01/02/05 precedents.

**Wave 2 (hard-gated on INTEG-03):** per-player bucket/subbucket hydration + winning subbucket reveal + payout row.

**Wave 3 (manual UAT, optional):** bucket table visual correctness, terminal section empty-state, winning subbucket rendering. Deferrable per precedent chain.

## Decisions Checksum

D-01 single `<decimator-panel>` (includes terminal sub-section)
D-02 pattern-match beta CSS, no imports
D-03 bucket table with player-row highlighting
D-04 winning subbucket + payout pill prominent for resolved levels
D-05 window status badge (open/closed/upcoming + level + time remaining)
D-06 terminal sub-section only when `terminal.burns.length > 0`
D-07 activity score cross-reference display
D-08 subscribes to replay.{level, player, day}
D-09 INTEG-03 spec follows INTEG-02/05 template
D-10 non-participant handling (bucket=null → empty state)

**Ready for:** research + patterns + plans. Planner should produce 4 plans.
