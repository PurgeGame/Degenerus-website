---
phase: 54-coinflip-baf
plan: 01
subsystem: testing
tags: [nyquist, contract-grep, shell-01, integ-05, baf, coinflip, requirements, deferral]

# Dependency graph
requires:
  - phase: 50-play-route-foundation
    provides: play-shell-01.test.js FORBIDDEN array (extended by +3), <coinflip-panel> + <baf-panel> Phase 50 stubs against which new tests initially fail
  - phase: 51-profile-quests
    provides: INTEG-02-SPEC.md structural template, /player/:address?day=N coinflip block (COINFLIP-01/03 data source), play-profile-panel.test.js as primary contract-grep template
  - phase: 52-tickets-packs-jackpot
    provides: INTEG-01-SPEC.md secondary template, play-tickets-panel.test.js list-rendering assertion pattern
provides:
  - INTEG-05-SPEC.md (237 lines) -- canonical contract for GET /player/:address/baf?level=N
  - play-coinflip-panel.test.js (226 lines, 28 assertions) -- RED contract gating Wave 1 coinflip-panel hydration
  - play-baf-panel.test.js (254 lines, 30 assertions) -- RED contract gating Wave 1+2 baf-panel hydration
  - play-shell-01.test.js +3 FORBIDDEN entries (baf-panel.js, coinflip.js, baf.js) -- future-proofs against transitively-tainted imports
  - REQUIREMENTS.md INTEG-04 deferral with D-10 + ROADMAP SC5 rationale
  - REQUIREMENTS.md em-dash-clean baseline (CLAUDE.md compliance)
affects:
  - phase 54-02 (Wave 1 pre-backend hydration -- turns COINFLIP-02, BAF-02, parts of COINFLIP-01/03 green)
  - phase 54-03 (Wave 2 INTEG-05 hydration -- turns BAF-01 + BAF-03 green)
  - phase 54-04 (Wave 3 UAT -- optional)
  - database repo (INTEG-05-SPEC.md drives 3-atomic-commit side-quest)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Contract-grep test files use readFileSync + regex against source (no JSDOM, no build) -- matches Phase 50-53 precedent"
    - "SHELL-01 FORBIDDEN array grows with transitively-tainted beta/ paths to prevent lazy imports in future waves"
    - "Spec files verbatim-copy from RESEARCH.md sections so database-side executor has self-contained doc"
    - "Score-unit discipline comment blocks embedded in test files so Wave 1 coder sees Pitfall 8 warning inline"
    - "Dual stale-guards per-panel when fetch cadences differ (#bafFetchId + #bafPlayerFetchId)"

key-files:
  created:
    - .planning/phases/54-coinflip-baf/INTEG-05-SPEC.md
    - play/app/__tests__/play-coinflip-panel.test.js
    - play/app/__tests__/play-baf-panel.test.js
  modified:
    - play/app/__tests__/play-shell-01.test.js
    - .planning/REQUIREMENTS.md

key-decisions:
  - "INTEG-05-SPEC.md copied verbatim from 54-RESEARCH.md Section 8 (no paraphrasing) so the database-side executor has a single authoritative doc"
  - "play-shell-01.test.js FORBIDDEN array extended by 3 entries (beta/components/baf-panel.js, beta/app/coinflip.js, beta/app/baf.js) to pre-empt transitively-tainted imports before Wave 1 ships"
  - "INTEG-04 formally deferred per D-10; ROADMAP Success Criterion 5 explicitly permits deferral when coinflip is functional via existing endpoints"
  - "Score-unit discipline (Pitfall 8) encoded as distinct assertion blocks + comment tables in both new test files so Wave 1 cannot conflate integer-scale coinflip leaderboard scores with wei-scale BAF scores"
  - "All em dashes in REQUIREMENTS.md replaced with double-hyphens per CLAUDE.md + acceptance criterion; no other prose changes"

patterns-established:
  - "Wave 0 RED baseline: new test files intentionally fail against Phase 50 stubs, with failure count documenting exactly what Wave 1+2 must deliver"
  - "Forbidden-path extension happens BEFORE the import-risk window opens (Wave 0 pre-emption rather than Wave 1 reaction)"
  - "REQUIREMENTS.md footer timestamp captures the most recent change with full rationale trail, preserving prior update entries"

requirements-completed: []  # Wave 0 authors test harness + spec + deferral; no user-facing requirements closed yet. Wave 1 closes COINFLIP-02, COINFLIP-01/03 (partial), BAF-02. Wave 2 closes BAF-01 + BAF-03 (gated on INTEG-05). COINFLIP-01..03, BAF-01..03, INTEG-05 remain [ ] pending. INTEG-04 is [~] (deferred).

# Metrics
duration: 6min
completed: 2026-04-24
---

# Phase 54 Plan 01: Wave 0 Spec + Tests + SHELL-01 Extension Summary

**INTEG-05-SPEC.md authored, two RED contract-grep test files (58 assertions) added to lock Wave 1+2 panel shape, play-shell-01 FORBIDDEN list extended by 3, INTEG-04 formally deferred with D-10 rationale.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-24T13:10:04Z
- **Completed:** 2026-04-24T13:16:31Z
- **Tasks:** 3
- **Files modified/created:** 5

## Accomplishments

- Authored `.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md` (237 lines) with complete endpoint contract: path, query schema, response schema (level/player/score/rank/totalParticipants/roundStatus), 4-state roundStatus derivation (open/closed/skipped/not_eligible), CTE+ROW_NUMBER rank implementation, Zod schemas, error modes, 3-atomic-commit Timeline matching INTEG-01/INTEG-02 precedent, acceptance criteria, open questions, confidence section.
- Authored `play/app/__tests__/play-coinflip-panel.test.js` (226 lines, 28 assertions) covering COINFLIP-01 state bindings, COINFLIP-02 leaderboard + `/leaderboards/coinflip?day=` URL, COINFLIP-03 bounty bindings, SHELL-01 negatives against beta/app/coinflip.js + beta/app/utils.js + ethers, stale-guard (`#coinflipFetchId`), aria-current highlighting, empty-state handling, score-unit discipline (Pitfall 8 warning table embedded as comment).
- Authored `play/app/__tests__/play-baf-panel.test.js` (254 lines, 30 assertions) covering BAF-01 your-rank bindings + `/player/:addr/baf?level=` URL, BAF-02 top-4 leaderboard + data-rank prominence, BAF-03 round-status pill + next-baf-level, SHELL-01 negatives against beta/app/baf.js + beta/app/utils.js + beta/components/baf-panel.js + ethers, dual stale-guards (`#bafFetchId` + `#bafPlayerFetchId`), inline `bafContext` derivation (Math.ceil((level+1)/10)), score-unit discipline, aria-current highlighting.
- Extended `play/app/__tests__/play-shell-01.test.js` FORBIDDEN array from 8 to 11 entries: `beta/components/baf-panel.js` (transitively wallet-tainted + tag-name collision), `beta/app/coinflip.js` (ethers at line 4), `beta/app/baf.js` (transitively tainted via utils.js).
- Updated `.planning/REQUIREMENTS.md`: INTEG-04 status `[ ]` to `[~]` with full deferral rationale, Traceability row updated to `Deferred (2026-04-24; per D-10 + ROADMAP SC5; coinflip functional without it)`, footer timestamp documents Phase 54 Wave 0 kickoff, INTEG-05 row untouched (still Pending awaiting Wave 2).
- Replaced all em dashes in `.planning/REQUIREMENTS.md` with double-hyphens per CLAUDE.md + Task 3 acceptance criterion.

## Task Commits

1. **Task 1: Author INTEG-05-SPEC.md (database-repo contract)** -- `233355b` (docs)
2. **Task 2: Author play-coinflip-panel.test.js + play-baf-panel.test.js + extend play-shell-01.test.js** -- `114a9b2` (test)
3. **Task 3: Mark INTEG-04 deferred in REQUIREMENTS.md per D-10** -- `24bc10f` (docs)

## Files Created/Modified

- `.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md` (created, 237 lines) -- canonical backend spec for per-player BAF score endpoint; self-contained for database-repo executor
- `play/app/__tests__/play-coinflip-panel.test.js` (created, 226 lines, 28 assertions) -- RED contract locking Wave 1 coinflip-panel hydration shape
- `play/app/__tests__/play-baf-panel.test.js` (created, 254 lines, 30 assertions) -- RED contract locking Wave 1+2 baf-panel hydration shape; BAF-01+03 assertions gated on Wave 2 INTEG-05 ship
- `play/app/__tests__/play-shell-01.test.js` (modified, +3 FORBIDDEN entries) -- future-proofs against transitively-tainted beta/ imports from play/ tree
- `.planning/REQUIREMENTS.md` (modified, INTEG-04 deferral + em-dash cleanup) -- formalizes D-10 deferral with D-10 + ROADMAP SC5 citations

## Decisions Made

- **INTEG-05-SPEC.md authored as verbatim copy from RESEARCH Section 8** rather than paraphrase. Rationale: the database-repo executor reads this standalone; any drift between spec and research document creates the risk that the implementer gets different versions depending on which file they open. Single-source-of-truth.
- **SHELL-01 FORBIDDEN pre-emption rather than reaction.** Adding 3 new forbidden paths in Wave 0 (when no play/ file imports them yet) means the guardrail is active for Wave 1+2 authors. Catches accidental imports during the exact window when they are most likely to happen.
- **Score-unit discipline comment blocks embedded in both test files.** The Pitfall 8 warning table (integer-scale coinflip leaderboard vs wei-scale BAF) is source-of-truth at the test file level, not just in a planning doc. Wave 1 executor sees it inline when reading the contract they must satisfy.
- **Dual stale-guards for baf-panel.** Leaderboard fetch invalidates on level change only; per-player fetch invalidates on level OR player change. One counter conflates the two cadences, so `#bafFetchId` + `#bafPlayerFetchId` are separate.
- **INTEG-04 deferred with formal rationale citations.** D-10 and ROADMAP Success Criterion 5 are both cited in the REQUIREMENTS.md update so future phase reviews can audit the deferral without re-reading planning docs.
- **All em dashes replaced with double-hyphens across REQUIREMENTS.md.** The plan's Task 3 acceptance criterion demands `! grep -q "—" .planning/REQUIREMENTS.md`. CLAUDE.md forbids em dashes. Both directives concur; the full-file sweep was scoped in by the plan author rather than left out-of-scope.

## Deviations from Plan

**None. Plan executed exactly as written.**

The three tasks ran with their specified actions, file targets, and verification commands. Em-dash cleanup in REQUIREMENTS.md was explicitly called out in the plan's Task 3 action ("If the original already contains `—` it must be replaced") and enforced by its acceptance criterion.

## Issues Encountered

None. All three tasks executed on the first attempt. Plan verification commands passed without modification.

## Test State

Full `play/app/__tests__/*.test.js` suite after Wave 0:

- **Total:** 288 tests (was 230; +58 new)
- **Pass:** 251 (230 pre-existing still green + 21 new baselines hitting existence/registration/subscribe/skeleton which Phase 50 stubs already satisfy)
- **Fail:** 37 (new tests in expected RED state; fail on the 40-LOC stubs because Wave 1+2 markup + fetch + bindings are not yet present)

Breakdown of the 37 RED assertions:
- `play-coinflip-panel.test.js`: ~18 fails (all data-bind assertions for deposited/claimable/autorebuy/takeprofit/armed/bounty-pool/bounty-record/bounty-holder/leaderboard-entries/etc.; fetch URL assertions for /leaderboards/coinflip and /player/:addr; #coinflipFetchId stale-guard; is-stale class; aria-current; formatBurnie/truncateAddress imports; entries.length check)
- `play-baf-panel.test.js`: ~19 fails (same pattern for BAF: leaderboard-entries/data-rank/round-status/next-baf-level/levels-until/your-rank/your-rank-value/total-participants/your-score/data-prominence/#bafFetchId/#bafPlayerFetchId/is-stale/Math.ceil derivation/aria-current/formatBurnie/truncateAddress/entries.length)

`play-shell-01.test.js` stays green (2/2) -- the 3 new FORBIDDEN entries match zero play/ imports because Wave 0 did not add production code.

## Next Phase Readiness

**Wave 1 (Plan 54-02) is unblocked.** Pre-backend work: evolve `coinflip-panel.js` and `baf-panel.js` from 40-LOC stubs to hydrated panels reading `/player/:address?day=N` (coinflip block) + `/leaderboards/coinflip?day=N` + `/leaderboards/baf?level=N`. Wave 1 does NOT need INTEG-05 yet; that gates Wave 2 only.

**Wave 2 (Plan 54-03) is gated on database-repo side-quest.** Per INTEG-05-SPEC.md Timeline, 3 atomic commits on database/main are required: feat (handler + schema) + docs (openapi) + test (Vitest). Precedent from Phase 51 INTEG-02 + Phase 52 INTEG-01 suggests 3-5 minutes total. Once the endpoint is live, Wave 2 hydrates the BAF-01 your-rank row + BAF-03 round-status pill from INTEG-05 responses; last ~15 assertions in play-baf-panel.test.js turn green.

**Wave 3 (Plan 54-04) is manual UAT, historically deferrable** per Phase 50/51/52/53 precedent. The contract-grep test suite + Wave 2 acceptance checks are sufficient for closing the phase if the user opts to defer UAT.

**Open side-quest for Phase 54 close:** Ship INTEG-05 in database repo (spec is authored; implementation + vitest + openapi are pending). INTEG-05-SPEC.md is self-contained -- no need to re-read 54-RESEARCH.md when switching repos.

## Self-Check: PASSED

Verified claims before proceeding:

- [x] `.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md` exists (237 lines, >= 180 min)
- [x] `play/app/__tests__/play-coinflip-panel.test.js` exists (226 lines)
- [x] `play/app/__tests__/play-baf-panel.test.js` exists (254 lines)
- [x] `play/app/__tests__/play-shell-01.test.js` FORBIDDEN array has 11 entries (was 8, +3)
- [x] `.planning/REQUIREMENTS.md` INTEG-04 row flipped to `[~]` with deferral rationale
- [x] `.planning/REQUIREMENTS.md` traceability row updated to Deferred (2026-04-24; ...)
- [x] `.planning/REQUIREMENTS.md` footer timestamp documents Phase 54 Wave 0 kickoff
- [x] `.planning/REQUIREMENTS.md` has zero em dashes (CLAUDE.md compliance)
- [x] `play-shell-01.test.js` green (2/2) after FORBIDDEN extension
- [x] 230 pre-existing play/ tests still green (verified via targeted runs + full-suite)
- [x] 37 new tests in expected RED state (gated on Wave 1+2 deliverables)
- [x] Task 1 commit `233355b` exists in git log
- [x] Task 2 commit `114a9b2` exists in git log
- [x] Task 3 commit `24bc10f` exists in git log

---
*Phase: 54-coinflip-baf*
*Plan: 01*
*Completed: 2026-04-24*
