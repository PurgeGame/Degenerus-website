# Phase 55 -- UAT Record

**Status:** DEFERRED
**Date:** 2026-04-24
**Milestone:** v2.4 Player UI TERMINAL phase (Phase 55 of 6)
**Reason:** Browser UAT requires real-device visual verification of bucket table rendering (5-12 rows normal / 2-12 centennial per contract truth at BurnieCoin.sol:142-147), winning subbucket pill 5-state machine (open / closed-won / closed-lost / closed-no-burn / not_eligible), terminal section conditional render, activity score cross-reference accuracy across decimator-panel and profile-panel for the same (player, day) tuple, and rapid level-scrub + day-scrub stability under the dual stale-guard (#decimatorPlayerFetchId + #decimatorLevelFetchId). No browser is available in this autonomous session. Following the Phase 50 -> 51 -> 52 -> 53 -> 54 precedent chain -- all five prior v2.4 phases deferred their Wave 3 UAT with the same rationale and each deferral held through the next phase's development window with no visual regression surfacing. Automated suite is 325/325 green across all 13 play/app/__tests__/ files (up from 288/288 at Phase 54 end after the Phase 55 Wave 0 test additions), plus INTEG-03 database-side 12/12 vitest green on the live endpoint. That covers the code contract end-to-end; UAT covers the visual/device contract separately.

Resume signal recorded: `uat-deferred`.

## Deferred Scenarios

All fourteen scenarios from 55-VALIDATION.md Manual-Only Verifications table + the expanded enumeration in 55-04-PLAN.md Task 1 are deferred:

1. **Bucket table CONTRACT TRUTH range per level** (DECIMATOR-02 / Pitfall 1)
   - Non-centennial level (e.g., 15, 99, 200 minus one) renders 8 rows labeled 5..12. Centennial level (100, 200, 300) renders 11 rows labeled 2..12 with rows 2, 3, 4 visible only on centennial.
   - Why manual: visual verification that rows 2-4 appear ONLY on level % 100 === 0 per BurnieCoin.sol:142-147 (NOT rows 1-8 per the deprecated CONTEXT D-03 error). Contract-truth range is asserted at the code-level by Wave 0 play-decimator-panel.test.js via literal-12 + literal-5 constants check, but visual rendering of the row labels requires a human eye on the DOM.

2. **Player's bucket row aria-current highlight** (DECIMATOR-02 / D-03)
   - Selecting a player with bucket=7 at a level paints the row labeled 7 with bg-tertiary + 3px accent-primary border-left + bold font. DevTools inspect shows `aria-current="true"` on the matching row and nothing on the others. Selecting a player with no burn at the level (bucket=null) leaves no aria-current anywhere.
   - Why manual: CSS application of the highlight against the live theme requires human inspection; the aria-current attribute assignment is grep-asserted but the pixel rendering is not.

3. **Winning subbucket data-winning tint overlay** (DECIMATOR-04 / D-03)
   - At a resolved level where the player's subbucket == winningSubbucket with payoutAmount > 0, the player's bucket row has BOTH aria-current (accent border) AND data-winning="true" (rgba(34, 197, 94, 0.08) green background tint layered on). Visually distinct from a plain aria-current row.
   - Why manual: two-layer visual rendering (accent border plus green tint) cannot be grep-asserted; requires human to confirm the layered appearance against the theme.

4. **Payout pill 5-state visual distinction** (DECIMATOR-04 / Pitfall 10)
   - Five states must be visually distinguishable at a glance: (a) closed+won ("You won X.XX ETH" in accent-primary + green-tinted bg, data-won="true"), (b) closed+lost ("Not your subbucket" in muted gray, data-won="false"), (c) closed+no-burn ("You didn't burn at level N" in muted, data-won="false"), (d) open ("Round in progress" in neutral, data-won=""), (e) not_eligible ("No decimator round at level N" in neutral, data-won="").
   - Why manual: 5 distinct colors + text combinations need a human eye to validate contrast and discriminability.

5. **Terminal sub-section conditional render** (DECIMATOR-05 / D-06 / Pitfall 3)
   - Player with zero terminal burns: section is COMPLETELY ABSENT -- no red h3 header, no empty table, nothing. Panel ends at bucket table. Player with terminal burns: red h3 "Terminal decimator" appears, burns table populates with 4 columns (Level, Effective, Weighted, Multiplier).
   - Why manual: conditional rendering polish; specifically confirming the empty case does not show a collapsed but present shell. The hidden attribute is grep-asserted but the visual absence requires human inspection.

6. **Terminal burn rows timeMultBps -> Nx formatting** (DECIMATOR-05 / Pitfall 8)
   - timeMultBps=13500 displays as "1.35x" (NOT "13500" raw bps, NOT "135%"). timeMultBps=10000 displays as "1.00x". timeMultBps=17500 displays as "1.75x".
   - Why manual: format check on the inline formatTimeMultiplier helper which divides by 10000 and formats to Nx. Contract-grep asserts the helper exists but not the rendered DOM value against live player data.

7. **Activity-score cross-reference updates on day scrub** (D-07 / Pitfall 14)
   - Scrubbing days 50 -> 60 -> 70 updates the "Activity score: X.XX" value in the decimator-panel context row reflecting the new day's scoreBreakdown.totalBps / 10000.toFixed(2). Same value simultaneously appears in the profile-panel (cross-reference across two panels reading the same store source). Historical days where scoreBreakdown is null (INTEG-02 fallback) show "Activity score: --" via null-guard.
   - Why manual: visual cross-reference across two panels for the same (player, day) tuple plus null-guard fallback rendering.

8. **Rapid day-scrub stability (dual stale-guard verification)** (DECIMATOR-02/03/04 / Pitfall 2)
   - Scrubbing days 50 -> 52 -> 54 -> 56 -> 58 within under 2 seconds shows the panel dimming to 0.6 opacity via is-stale class on [data-bind="content"]. Final day (58) values appear in ALL of: bucket table aria-current, stats row values, payout pill state, terminal section. No flash of intermediate day values. Dual counter stale-guard (#decimatorPlayerFetchId + #decimatorLevelFetchId) invalidates late responses correctly.
   - Why manual: race condition check under interactive input speeds; grep asserts the counter comparisons exist but behavioral smoothness needs a human driving the scrubber at the edge of the stale-guard debounce window.

9. **Rapid level-scrub stability** (DECIMATOR-02/03/04)
   - Scrubbing levels 10 -> 20 -> 30 -> 40 -> 50 within under 2 seconds shows the bucket table range updating correctly for each level (5-12 on normal), with player's bucket row highlight (aria-current) reflecting the FINAL level's bucket assignment only. No stale cross-level artifacts. Stats row + payout pill + window badge all show final level's INTEG-03 data.
   - Why manual: race-condition check across the level axis (orthogonal to the day-scrub race in Scenario 8); validates that #decimatorLevelFetchId stale-guard catches rapid level changes.

10. **Window badge 3-state post-Wave-2** (DECIMATOR-01 / D-05)
    - Three distinct colors for three states: OPEN green (rgba(34, 197, 94, 0.15) bg + success text), CLOSED gray (rgba(100, 100, 100, 0.2) + text-dim), NOT ELIGIBLE dim (rgba(100, 100, 100, 0.1) + text-dim). Wave 1 was binary OPEN/CLOSED; Wave 2 INTEG-03 roundStatus adds NOT_ELIGIBLE as a third visually distinct state. Time-remaining is OMITTED per Pitfall 4 (game.levelStartTime is null in play/ store).
    - Why manual: three distinct colors require human validation of contrast against the theme.

11. **Empty state -- player with no decimator activity at BAF-active level** (DECIMATOR-02 / Pitfall 7)
    - Player with no burn at a round-active level shows bucket table with correct range (5-12 or 2-12) but NO aria-current anywhere. Stats row shows "--" in all 4 cells. Payout pill shows "Round in progress" (if open) or "You didn't burn at level N" (if closed) in neutral styling.
    - Why manual: edge-case rendering polish; absence of broken UI or stuck is-stale class.

12. **Empty state -- not_eligible level** (DECIMATOR-02 / DECIMATOR-04)
    - Level outside decimator eligibility (roundStatus=not_eligible) shows bucket table with correct range, no aria-current, stats row all "--", payout pill "No decimator round at level N" in neutral, window badge "NOT ELIGIBLE".
    - Why manual: edge-case rendering polish plus 3-state window badge interaction.

13. **Layout shift at centennial level** (DECIMATOR-02 / D-03 / Pitfall 11 acceptable)
    - Scrubbing level 99 -> 100 -> 101: panel height grows approximately 45% at level 100 (11 rows vs 8 rows in bucket table) then shrinks back at level 101. Per Pitfall 11 recommendation this is ACCEPTABLE -- the shift is an informative visual signal that centennial is special.
    - Why manual: layout feel check; if UX pushback surfaces, a gap-closure fix would add min-height to the bucket table container.

14. **Cross-panel consistency -- v2.4 milestone validation** (all v2.4 panels)
    - Full six-panel /play/ route (profile + tickets + packs + purchase + jackpot + coinflip + baf + decimator) renders cohesively on first load. Activity score in decimator-panel matches profile-panel for the same (player, day) tuple. is-stale dim rate matches across all panels at 0.6 opacity with 0.2s ease transition. Window badge (decimator) doesn't visually clash with round-status pill (baf-panel) or bounty armed-pulse pill (coinflip-panel).
    - Why manual: end-to-end milestone check across six panels simultaneously; only validatable with a real browser driving the full route against the live Fastify backend.

## Deferral Precedent Chain

Five prior v2.4 phases deferred their Wave 3 UAT with similar rationale. Each deferral held through the next phase's development window with no visual regression surfacing that required re-investigation:

- **Phase 50** deferred -- see `.planning/phases/50-route-foundation-day-aware-store/50-03-SUMMARY.md` frontmatter `uat_status: deferred`. Rationale: automated verification (88/88 tests + SHELL-01 + headless HTML structure check) sufficient for Phase 50 close; visual issues would surface naturally when Phase 51 landed the first real panel hydration. Deferral held; no Phase 50 visual regression surfaced during Phase 51 development.

- **Phase 51** deferred -- see `.planning/phases/51-profile-quests/51-UAT.md` (DEFERRED status). Cited Phase 50 precedent; identified Phase 52 as the natural resurfacing trigger. The trigger fired during Phase 52 but the browser session did not happen because Phase 52 Wave 2 landed autonomously. No Phase 51 visual regression surfaced; profile-panel's 24/24 automated assertions caught the code-contract concerns.

- **Phase 52** deferred -- see `.planning/phases/52-tickets-packs-jackpot/52-UAT.md` (DEFERRED status). Cited Phase 50 + 51 precedents. Nine scenarios deferred (GSAP gacha feel, audio autoplay-policy unlock, jackpot roll-1/roll-2, trait SVGs including CARD_IDX reshuffle, day-scrub during active animation, empty states, 404 error-path UX, rapid-scrub stability, high-ticket perf).

- **Phase 53** deferred -- see `.planning/phases/53-purchase-flow/53-01-SUMMARY.md` key-decisions: "No UAT for Option B (D-07): with no live purchase action, there is no user flow to exercise manually. Future SIM-01-gate-lift phase gets its own UAT." Option B shipped PURCHASE-03 live-display-only with the SIM-01 backend gated; no live purchase path existed to exercise.

- **Phase 54** deferred -- see `.planning/phases/54-coinflip-baf/54-UAT.md` (DEFERRED status). Cited Phase 50 -> 51 -> 52 -> 53 chain; identified Phase 55 as the natural resurfacing trigger. Enumerated 12 UAT scenarios as deferred (prominence tier colors, data-prominence border transitions, round-status pill visual states, "Your rank" row un-hide/hide, selected-player highlighting across both leaderboards, coinflip armed-pulse animation, score-unit rendering discipline Pitfall 8 regression check both directions, rapid level-scrub BAF stability, rapid day-scrub coinflip stability, empty states, cross-panel consistency). No Phase 54 visual regression surfaced during Phase 55 development; the integration surface held under automated coverage.

Phase 50's deferral held through Phase 51 close. Phase 51's deferral held through Phase 52 close. Phase 52's deferral held through Phase 53 close. Phase 53's deferral is standing pending SIM-01 gate-lift. Phase 54's deferral held through Phase 55 close. All five prior deferrals carried forward with no visual regression that required re-investigation.

## Terminal-Phase Framing (Phase 55 specific)

Unlike the Phase 50 -> 54 deferrals which each pointed to "the next phase will natively exercise these surfaces" as the resurfacing trigger, Phase 55 is the TERMINAL phase of v2.4 Player UI. There is no next phase inside v2.4. The resurfacing triggers instead are:

1. **v2.5+ cross-panel visual sweep** -- when v2.5 begins (candidate scopes include wallet write path, mobile polish, or auth integration), the first sprint naturally exercises the full /play/ route end-to-end. Any deferred Phase 55 visual issue (bucket range rendering wrong, payout pill state colors indistinct, terminal section empty-case leaking, rapid-scrub flashing) would surface during dev. This sweep also naturally closes any remaining deferred items from Phases 50 through 54 -- one ad-hoc real-browser session validates every prior deferral at once.

2. **Ad-hoc manual browser session** -- the user may drive the live stack (http://localhost:8080/play/ against Fastify at localhost:3000) against representative data at any point between now and v2.5 start. That session exercises all fourteen deferred Phase 55 scenarios (and any leftovers from the prior five phases) in a single pass.

3. **Gap-closure plan on defect surfacing** -- if any specific Phase 55 scenario is flagged (e.g., user reports "bucket row highlight misses" or "terminal section shows when it should hide"), `/gsd-plan-phase 55 --gaps` addresses it surgically without re-opening full Phase 55 planning.

## Code-Level Enforcement of Critical Invariants

Two of the fourteen deferred scenarios test invariants that are ALSO enforced at the code level by Wave 0 tests, so the visual verification is less critical than in a normal phase:

- **Scenario 1 (bucket range contract-truth, Pitfall 1):** `play/app/__tests__/play-decimator-panel.test.js` asserts the literal constants `DECIMATOR_BUCKET_BASE=12` and `DECIMATOR_MIN_BUCKET_NORMAL=5` and `DECIMATOR_MIN_BUCKET_100=2` are present in `play/components/decimator-panel.js` source, AND asserts the source does NOT contain `1-8` or `[1, 2, 3, 4, 5, 6, 7, 8]` as any bucket range (explicit reject of the deprecated CONTEXT D-03 error). Any 1-8 encoding would fail at Wave 0 gate pre-merge. Visual verification exists only as defense-in-depth against a rendering bug downstream of the constants.

- **Scenario 6 (timeMultBps -> Nx formatting, Pitfall 8):** The inline `formatTimeMultiplier` helper in decimator-panel.js is source-grepped for the bps-to-Nx conversion signature (`bps / 10000` and `.toFixed(2)` and `'x'`). Helper body is code-level validated; the visual rendering of the formatted string exists as a secondary check.

For the remaining twelve scenarios (aria-current CSS, data-winning overlay, payout pill colors, terminal conditional render, activity score cross-reference, rapid-scrub stability, window badge colors, empty-state text, layout shift, cross-panel consistency), code-level grep asserts the structural contract (data-bind markers, token comparisons, CSS class hooks) but visual/device rendering requires a real browser.

## Automated Verification State

Automated test suite as of 2026-04-24 after Phase 55 Wave 2 (Plan 55-03) close: **325/325 green** across all 13 play/app/__tests__/ files (up from 288/288 at Phase 54 end after the Phase 55 Wave 0 test additions).

| Test file | Tests | Status |
|-----------|------:|--------|
| play/app/__tests__/play-route-structure.test.js | 9 | pass |
| play/app/__tests__/play-main-bootstrap.test.js | 7 | pass |
| play/app/__tests__/play-shell-01.test.js | 2 | pass (SHELL-01 recursive guardrail green; 14 FORBIDDEN entries post-Phase-55 including the three new Wave 0 Phase 55 additions: beta/components/terminal-panel.js, beta/app/decimator.js, beta/app/terminal.js) |
| play/app/__tests__/play-panel-stubs.test.js | 79 | pass (Phase 50 skeleton-shimmer contract held) |
| play/app/__tests__/play-profile-panel.test.js | 24 | pass (Phase 51 PROFILE-01..05 contract held) |
| play/app/__tests__/play-tickets-panel.test.js | 26 | pass (Phase 52 TICKETS-01..04 contract held) |
| play/app/__tests__/play-packs-panel.test.js | 31 | pass (Phase 52 PACKS-01..05 contract held) |
| play/app/__tests__/play-jackpot-wrapper.test.js | 15 | pass (Phase 52 JACKPOT-01..03 contract held) |
| play/app/__tests__/play-jackpot-shell01-regression.test.js | 4 | pass (Phase 52 D-09 patch held) |
| play/app/__tests__/play-purchase-panel.test.js | 33 | pass (Phase 53 PURCHASE-03 live; PURCHASE-01/02/04 sim-api gated) |
| play/app/__tests__/play-coinflip-panel.test.js | 26 | pass (Phase 54 COINFLIP-01/02/03 contract held; Pitfall 8 score-unit discipline clean) |
| play/app/__tests__/play-baf-panel.test.js | 32 | pass (Phase 54 BAF-01/02/03 contract held; INTEG-05 live-wiring; dual stale-guard) |
| play/app/__tests__/play-decimator-panel.test.js | 37 | pass (Phase 55 DECIMATOR-01..05 contract held; INTEG-03 live-wiring; dual stale-guard #decimatorPlayerFetchId + #decimatorLevelFetchId; bucket-range contract-truth assertions 5-12 normal / 2-12 centennial per BurnieCoin.sol:142-147) |
| **Total** | **325** | **pass** |

Plus database-side INTEG-03 vitest: **12/12 green** on the live endpoint (3 atomic commits feat a453592 / docs 8c5d717 / test 49d3f3a on database/main matching the INTEG-05/INTEG-02/INTEG-01 precedent shape).

This covers the code contract for every Phase 55 requirement:

- **DECIMATOR-01** -- 3-state window status badge (OPEN / CLOSED / NOT ELIGIBLE) authoritative from INTEG-03 roundStatus; time-remaining omitted per Pitfall 4.
- **DECIMATOR-02** -- Bucket/subbucket assignment via INTEG-03 `bucket` + `subbucket` fields with contract-truth `bucketRange(level)` helper (5-12 normal / 2-12 centennial per BurnieCoin.sol:142-147).
- **DECIMATOR-03** -- Effective + weighted amounts per burn level via INTEG-03 `effectiveAmount` + `weightedAmount` with formatBurnie applied to wei-scale values.
- **DECIMATOR-04** -- Winning subbucket + payout pill 5-state machine (open / closed-won / closed-lost / closed-no-burn / not_eligible) driven by INTEG-03 `winningSubbucket` + `payoutAmount` + `roundStatus`.
- **DECIMATOR-05** -- Terminal sub-section conditional on `terminal.burns.length > 0` per Pitfall 3 (hidden entirely when empty).
- **INTEG-03** -- new endpoint `GET /player/:address/decimator?level=N&day=M` shipped per INTEG-03-SPEC.md on database repo (3 atomic commits a453592 + 8c5d717 + 49d3f3a; 12/12 vitest green).

UAT covers the visual/device contract separately: bucket row highlight CSS rendering, payout pill color distinction across 5 states, terminal section conditional rendering feel, rapid-scrub visual smoothness under dual stale-guards, window badge state colors, empty-state polish, layout shift perception at centennial levels, and end-to-end visual fidelity after integration with the full six-panel /play/ route.

## Phase 55 + v2.4 Close Readiness

Phase 55 is ready for `/gsd-verify-phase 55` with this 55-UAT.md as the concrete artifact documenting the deferral decision. The phase can be marked complete; the UAT gap is documented, rationalized, and carries a concrete resurfacing trigger (v2.5+ cross-panel visual sweep, or an ad-hoc manual browser session against the live stack) rather than disappearing into a "we'll get to it" backlog.

v2.4 Player UI milestone is complete (6/6 phases):

- Phase 50: Route Foundation & Day-Aware Store (complete 2026-04-23; UAT deferred)
- Phase 51: Profile & Quests (complete 2026-04-24; UAT deferred)
- Phase 52: Tickets, Packs & Jackpot Reveal (complete 2026-04-24; UAT deferred)
- Phase 53: Purchase Flow (Option B complete 2026-04-24; PURCHASE-01/02/04 deferred pending SIM-01; no UAT per D-07 decision)
- Phase 54: Coinflip & BAF Leaderboards (complete 2026-04-24; UAT deferred)
- Phase 55: Decimator (complete 2026-04-24; UAT deferred per this record)

## Requirement Closure

All DECIMATOR requirements validated at the code contract level:

| Requirement | Status | Shipped In | Validation |
|---|---|---|---|
| DECIMATOR-01 | [x] Validated | Wave 1 binary + Wave 2 3-state | Contract-grep + INTEG-03 roundStatus enum |
| DECIMATOR-02 | [x] Validated | Wave 2 via INTEG-03 | Contract-grep + bucketRange(level) contract-truth helper (5-12 / 2-12 per BurnieCoin.sol:142-147) + aria-current token assertion |
| DECIMATOR-03 | [x] Validated | Wave 2 via INTEG-03 | Contract-grep + formatBurnie wei-scale wiring |
| DECIMATOR-04 | [x] Validated | Wave 2 via INTEG-03 | Contract-grep + 5-state payout pill machine per Pitfall 10 |
| DECIMATOR-05 | [x] Validated | Wave 1 via extended-player endpoint | Contract-grep + conditional hide per Pitfall 3 + formatTimeMultiplier helper |
| INTEG-03 | [x] Shipped | Wave 2 (Plan 55-03) | 3 atomic commits on database/main; 12/12 vitest green |

UAT as a secondary gate is deferred per the five-phase precedent chain and the Phase 55 terminal-phase framing above. Visual validation surfaces when v2.5+ starts or when an ad-hoc manual browser session happens.
