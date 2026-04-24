---
phase: 53-purchase-flow
plan: 01
subsystem: ui
tags:
  - phase-53
  - option-b
  - purchase-panel
  - sim-01
  - purchase-api-spec
  - custom-elements
  - shell-01

# Dependency graph
requires:
  - phase: 50-route-foundation-day-aware-store
    provides: play/ tree, purchase-panel Phase 50 stub, Proxy store (game.level, game.price, replay.{day,player}), SHELL-01 guardrail, main.js panel registration
  - phase: 51-profile-quests
    provides: profile-panel gold-standard shape (skeleton-to-content swap, subscribe/get pattern, is-stale dim class); INTEG spec authoring convention
  - phase: 52-tickets-packs-jackpot-reveal
    provides: packs-panel with stale-guard refetch -- PURCHASE-04 plumbing lands automatically when SIM-01 ships (no Phase 53 re-work)
provides:
  - .planning/phases/53-purchase-flow/PURCHASE-API-SPEC.md (degenerus-sim HTTP endpoint contract for SIM-01; mirrors INTEG-SPEC.md shape)
  - play/components/purchase-panel.js (evolved from 40-line Phase 50 stub to ~220-line functional Custom Element; PURCHASE-03 live, PURCHASE-01/02 sim-api gated)
  - play/app/__tests__/play-purchase-panel.test.js (33 contract-grep assertions; covers PURCHASE-03 bindings + sim-api gated buttons + SHELL-01 reinforcement)
  - play/styles/play.css additions (.panel-purchase, .purchase-tabs, .purchase-info, .purchase-form, gated-button styling, mobile + reduced-motion fallbacks)
  - .planning/REQUIREMENTS.md updates (PURCHASE-03 validated; 01/02/04 deferred with scaffold; SIM-01 added to INTEG block; coverage 42 -> 43)
affects:
  - degenerus-sim repo (/home/zak/Dev/PurgeGame/degenerus-sim/) -- PURCHASE-API-SPEC.md is the implementation contract for the SIM-01 HTTP endpoints
  - Future SIM-01 ship follow-up -- small diff to lift the sim-api gate, wire POST handlers, ingest response (existing packs-panel stale-guard auto-renders new entries)
  - Phase 52 packs-panel stale-guard (referenced but unchanged) -- PURCHASE-04 depends on it; zero Phase 53 modification needed

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Option B "spec + UI scaffold" for backend-gated phases (mirrors INTEG-01/02 pattern but the backend is a different repo -- degenerus-sim -- rather than database)
    - UI gate pattern: data-gate="sim-api" + aria-disabled="true" + title tooltip referencing the spec file, rendered in-place (no conditional omission)
    - Live-display-only scope narrowing: PURCHASE-03 ships against existing Proxy store with zero new backend; PURCHASE-01/02/04 deferred cleanly via gate pattern

key-files:
  created:
    - .planning/phases/53-purchase-flow/PURCHASE-API-SPEC.md
    - play/app/__tests__/play-purchase-panel.test.js
    - .planning/phases/53-purchase-flow/53-01-SUMMARY.md
  modified:
    - play/components/purchase-panel.js
    - play/styles/play.css
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Option B confirmed (spec-only + UI scaffold) per 53-SCOPE-ASSESSMENT.md. Rationale: sim repo has no HTTP server; adding one requires design decisions on signing keys, anvil state consistency, and database-indexer latency that exceed autonomous scope. Spec locks the contract so the sim-repo side-quest ships cleanly later."
  - "PURCHASE-03 ships live from existing store; no new backend integration. Reads game.level + game.price + computes cycle = floor(level/100) + total = price * quantity via BigInt math."
  - "Gated buttons use `data-gate=\"sim-api\"` + aria-disabled=\"true\" + title tooltip pointing at PURCHASE-API-SPEC.md. Tests assert the gate exists; when SIM-01 ships, a small diff lifts the gate and wires POST handlers."
  - "SIM-01 added to REQUIREMENTS.md INTEG block as a new P2 coordination requirement gating Phase 53 live-wiring; distinct from INTEG-01..05 (database repo) because the implementation owner is the degenerus-sim repo."
  - "PURCHASE-04 treated as plumbing-only: Phase 52's packs-panel already refetches on replay.player / replay.day change, so when SIM-01 ships and new tickets land, packs-panel renders them automatically with no Phase 53 code."
  - "No UAT for Option B (D-07): with no live purchase action, there is no user flow to exercise manually. Future SIM-01-gate-lift phase gets its own UAT."

patterns-established:
  - "Backend-gated UI gate pattern: dimmed button with data-gate=\"{system-name}\" (e.g. sim-api), aria-disabled=\"true\", and title tooltip linking to the spec file. Tests assert all three. Production UI shows the dimmed button in-place rather than hiding it -- signals the feature is coming and shows users what it will look like."
  - "Option B phase shape: single plan combining (1) spec authoring, (2) live portion UI build, (3) deferred portion gated scaffold, (4) test harness covering both portions, (5) REQUIREMENTS.md split status update. Repeatable for any phase where ONE requirement in a group is unblocked while the rest await external coordination."

requirements-completed:
  - PURCHASE-03

# Metrics
duration: ~10min
completed: 2026-04-24
---

# Phase 53 Plan 01: Purchase Flow (Option B) Summary

**PURCHASE-API-SPEC authored for degenerus-sim HTTP endpoints, PURCHASE-03 shipped live (level/cycle/price/total-cost display), PURCHASE-01/02 scaffolded as sim-api-gated buttons awaiting SIM-01, PURCHASE-04 delegated to Phase 52's packs-panel stale-guard.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-24T11:58:31Z
- **Completed:** 2026-04-24
- **Tasks:** 5 / 5 committed (Task 6 confirmed no-op; Task 7 this file)
- **Files created:** 3 (PURCHASE-API-SPEC.md, play-purchase-panel.test.js, this summary)
- **Files modified:** 3 (purchase-panel.js, play.css, REQUIREMENTS.md)

## Accomplishments

- Authored `PURCHASE-API-SPEC.md` (213 lines) -- the canonical implementation contract for the degenerus-sim repo's SIM-01 HTTP endpoints. Covers request/response shapes for `POST /player/:address/buy-tickets` and `POST /player/:address/buy-lootbox`, error modes (400/402/404/409/500), and five unresolved open questions the sim team must decide (signing key pattern, indexer consistency, precondition validation, gas funding, request-id idempotency).
- Evolved `play/components/purchase-panel.js` from a 40-line Phase 50 stub to a ~220-line functional Custom Element. PURCHASE-03 ships live against the existing Proxy store (level / cycle / ticket price / total cost with a quantity input that recomputes total on every keystroke). PURCHASE-01/02 render as gated buttons with `data-gate="sim-api"`, `aria-disabled="true"`, and title tooltips linking to PURCHASE-API-SPEC.md.
- Authored `play/app/__tests__/play-purchase-panel.test.js` (247 lines, 33 contract-grep assertions) covering file existence, class shape, four subscription paths (replay.day, replay.player, game.level, game.price), six SHELL-01 forbidden-import checks, seven PURCHASE-03 data-bind assertions, four gated-button assertions (data-buy-type tickets + lootbox; aria-disabled; title tooltip), two tab UI bindings, and the skeleton-to-content swap pattern.
- Added CSS for the purchase panel: `.panel-purchase` + `.panel-title` container, `.purchase-tabs` with aria-selected underline, `.purchase-info` with per-row labels, `.purchase-form` with quantity input + buy button, and disabled-button styling for the sim-api gate (opacity 0.6 + cursor not-allowed + dimmed background). Reuses beta/styles/base.css variables (--accent-primary, --text-muted, --border-subtle, --text-primary) -- no new tokens. Mobile and prefers-reduced-motion fallbacks included.
- Updated REQUIREMENTS.md to reflect Option B split: PURCHASE-03 marked `[x]` Validated; PURCHASE-01/02/04 marked `[~]` deferred with scaffold + sim-api-gate explanation and reference to SIM-01. SIM-01 added as a new P2 coordination requirement in the INTEG block (gates Phase 53 live-wiring follow-up; owner: degenerus-sim repo). Traceability rows updated; coverage 42 -> 43; Phase 53 per-phase count 4 -> 5; footer last-updated note rewritten.

## Task Commits

1. **Task 1: Author PURCHASE-API-SPEC.md** -- `51d8230` (docs)
2. **Task 2: Update REQUIREMENTS.md** -- `b8f45b5` (docs)
3. **Task 3: Author Nyquist test harness** -- `0fd627b` (test)
4. **Task 4: Evolve purchase-panel.js to functional** -- `376eac3` (feat)
5. **Task 5: CSS for purchase-panel** -- `265af7c` (feat)
6. **Task 6: Verify main.js + index.html registration** -- no commit (already in place since Phase 50; confirmed only)

## Files Created/Modified

- `.planning/phases/53-purchase-flow/PURCHASE-API-SPEC.md` (new, 213 lines) -- degenerus-sim HTTP endpoint contract: two POST endpoints, request/response JSON schemas, error modes table, 5 open questions for the sim team, acceptance criteria, timeline, confidence notes.
- `.planning/REQUIREMENTS.md` (modified) -- PURCHASE-01..04 status rewrite, SIM-01 added, traceability rows updated, coverage + per-phase counts updated, footer last-updated line.
- `play/components/purchase-panel.js` (rewritten, 40 -> 221 lines) -- functional Custom Element: static TEMPLATE, #rerender() consolidator, #renderInfo() for PURCHASE-03 displays, #updateTotalCost() for live quantity-driven total, #wireTabs() + #wireQuantityInput() event handlers, #showContent() skeleton-to-content swap. Subscribes to replay.day + replay.player + game.level + game.price.
- `play/app/__tests__/play-purchase-panel.test.js` (new, 247 lines, 33 assertions) -- contract-grep harness; every assertion green after Task 4 lands.
- `play/styles/play.css` (modified, +193 lines at end) -- Phase 53 purchase-panel section added after Phase 52's packs-panel block. All existing rules untouched.

## Decisions Made

- **Option B confirmed.** Ships spec + UI scaffold, not the full sim integration. Rationale preserved in 53-SCOPE-ASSESSMENT.md (2-4 day sim-repo cost, unresolved anvil/key/consistency questions).
- **Single-plan execution (not two plans).** 53-CONTEXT.md's implementation-path-sketch mentions Wave 0 + Wave 1; with Option B narrowing to ~200 LOC of spec + panel + CSS + tests, one plan + one commit per task is cleaner than two plans with summaries.
- **Gated-button UX: dimmed-in-place, not hidden.** Users can see the buttons they WILL be able to click once SIM-01 ships, which communicates progress better than omitting the controls entirely. The title-attribute tooltip surfaces the explanation on hover without adding a new toast/popover surface. This is the minimum UX for a gated feature.
- **PURCHASE-04 owned by packs-panel, not purchase-panel.** When real purchases land later, packs-panel's existing Phase 52 stale-guard refetches by (replay.player, replay.day) and surfaces new entries. No purchase-panel-owned assertion needed; the plan tests only PURCHASE-01/02/03 in the purchase-panel harness.
- **SIM-01 numbered separately from INTEG-01..05.** Database repo endpoints are INTEG; the degenerus-sim repo is a different backend. Keeping the namespace distinct prevents confusion about which repo owns which ship.
- **No UAT for Option B (D-07).** No live action means nothing to exercise manually. Future gate-lift phase gets its own UAT document.

## Deviations from Plan

None. Plan executed exactly as written. The inline task list's exact counts (target "~20 new assertions") ended up at 33 -- more comprehensive coverage than the minimum bar, with six SHELL-01 forbidden-import checks making the test harness self-documenting about which imports the panel must NOT use. All 33 pass after Task 4; the RED-gate snapshot (16/33 pass before Task 4) was captured in the Task 3 commit message.

Task 6 was a verify-only step with no file changes -- `<purchase-panel>` was already registered in `play/app/main.js` (Phase 50 Plan 03, line 26 of the registerComponents paths array) and included in `play/index.html` (Phase 50 Plan 02, line 53 as `<purchase-panel data-slot="purchase"></purchase-panel>`). Confirmed both via Read; no commit produced.

## Issues Encountered

- `.planning/` gitignore: the new PURCHASE-API-SPEC.md required `git add -f` to commit (matching the Phase 50/51 INTEG-01/02-SPEC.md convention). REQUIREMENTS.md was already tracked, so `git add -u` handled its update. The new SUMMARY.md will also require `-f`. This is the documented convention; not a bug.
- REQUIREMENTS.md editing triggered five PreToolUse "read-before-edit" reminders despite the file having been read at session start. Each edit succeeded; the reminders were false positives (file state tracking). Continued without re-reading on each edit.

## Next Phase Readiness

**Phase 53 Option B is closed.** Ready for Phase 54 (Coinflip + BAF Leaderboards).

**SIM-01 deferred work unblocked.** When the sim-repo side-quest ships PURCHASE-API-SPEC.md's two endpoints, a small follow-up plan in the website repo:
1. Lifts the `data-gate="sim-api"` + aria-disabled on the Buy buttons (remove the gate attribute, add `.addEventListener('click', ...)` handlers)
2. Handlers POST to the sim endpoints with the (address, quantity/lootboxEth, affiliateCode) payload
3. On success, nothing to do -- packs-panel stale-guard (Phase 52) detects the new inventory and renders packs automatically on the next replay.day / replay.player notification
4. On error, surface the toast via the envelope's `error` tag

This follow-up is a ~40 LOC diff in purchase-panel.js plus probably ~20 LOC of handler/toast logic. No new spec, no new tests beyond flipping the aria-disabled assertion.

**Tests: 230/230 green.** 197 prior tests + 33 new purchase-panel assertions. SHELL-01 recursive guardrail passes (purchase-panel imports only beta/app/store.js + beta/viewer/utils.js, both wallet-free).

**SHELL-01 invariant holds.** No new wallet-tainted imports. play-shell-01.test.js scans the tree and reports zero violations.

## Self-Check: PASSED

**Files created verification:**
- `/home/zak/Dev/PurgeGame/website/.planning/phases/53-purchase-flow/PURCHASE-API-SPEC.md`: FOUND
- `/home/zak/Dev/PurgeGame/website/play/app/__tests__/play-purchase-panel.test.js`: FOUND
- `/home/zak/Dev/PurgeGame/website/.planning/phases/53-purchase-flow/53-01-SUMMARY.md`: FOUND (this file)

**Files modified verification:**
- `/home/zak/Dev/PurgeGame/website/play/components/purchase-panel.js`: MODIFIED (stub -> functional, verified via git log)
- `/home/zak/Dev/PurgeGame/website/play/styles/play.css`: MODIFIED (Phase 53 section appended, verified via git log)
- `/home/zak/Dev/PurgeGame/website/.planning/REQUIREMENTS.md`: MODIFIED (PURCHASE rewrite + SIM-01 added, verified via git log)

**Commits verification:**
- `51d8230` (Task 1 -- PURCHASE-API-SPEC.md): FOUND in git log
- `b8f45b5` (Task 2 -- REQUIREMENTS.md): FOUND in git log
- `0fd627b` (Task 3 -- test harness): FOUND in git log
- `376eac3` (Task 4 -- functional panel): FOUND in git log
- `265af7c` (Task 5 -- CSS): FOUND in git log

**Test suite verification:**
- `node --test play/app/__tests__/*.test.js`: 230 tests, 230 pass, 0 fail (prior 197 + 33 new purchase-panel)
- Phase 50/51/52 regression: 197/197 still pass
- SHELL-01 guardrail: green (no new wallet-tainted imports in play/ tree)

---

*Phase: 53-purchase-flow*
*Plan: 01 (single-plan Option B)*
*Completed: 2026-04-24*
