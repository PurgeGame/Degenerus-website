---
phase: 15-game-modules-parity
plan: 02
subsystem: audit
tags: [solidity, verification, extraction-function, jackpot, decimator, vrf]

requires:
  - phase: 15-game-modules-parity
    provides: "D-01/D-02 discrepancy format, GM-XX numbering scheme"
provides:
  - "Parity notes for 3 distribution modules (AdvanceModule, JackpotModule, DecimatorModule)"
  - "8 verified extraction function components"
  - "Verified all 7+ jackpot types"
  - "Resolved research open questions #2 (drip rate) and #3 (century retained fraction)"
affects: [15-game-modules-parity, 17-consolidated-parity-report]

tech-stack:
  added: []
  patterns: [contract-by-contract verification with section cross-reference]

key-files:
  created:
    - .planning/phases/15-game-modules-parity/findings/02-distribution.md
  modified: []

key-decisions:
  - "GM-01 rated Major: extraction function equation in paper uses futurePool as input but contract operates on nextPool"
  - "Turbo jackpot compression (1 physical day) rated Minor rather than Major: it is a behavioral detail not a wrong number"
  - "Burn weight ~1.78x accepted as matching paper's ~1.8x: tilde notation covers the 0.02 difference"

patterns-established:
  - "Section-by-section clean verification listing alongside numbered discrepancies provides auditable coverage proof"

requirements-completed: [OUT-02]

duration: 9min
completed: 2026-03-31
---

# Phase 15 Plan 02: Distribution Modules Parity Summary

**Verified extraction function (8 components), all jackpot types (7+), and decimator mechanics against 3 contract source files; found 8 discrepancies (1 Major, 3 Minor, 4 Info)**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-01T00:21:14Z
- **Completed:** 2026-04-01T00:30:55Z
- **Tasks:** 1
- **Files created:** 1

## Accomplishments
- Verified all 8 extraction function components against AdvanceModule source: U-shape base rate, century ramp, x9 boost, ratio adjustment, overshoot surcharge, additive variance, multiplicative variance, 80% cap
- Verified all jackpot types against JackpotModule source: daily ETH (6-14%), BURNIE (0.5% target, 75/25 near/far split), early-bird lootbox (3% futurepool), trait-bucket shares (20/20/20/20 + 20% solo on days 1-4, 60/13/13/14 on day 5), daily carryover (1% futurepool days 2-4)
- Verified decimator against DecimatorModule and BurnieCoin source: trigger schedule (x5 at 10%, x00 at 30%), bucket assignment (12 default, 5 min normal, 2 min x00), burn weight multiplier (1.0x to 1.7833x)
- Verified century mechanics: futurepool retained fraction (30%-65% avg 47.5%), accumulator 50% dump, BAF 20%/20% (x00 and level 50), decimator 30% at x00 from pre-BAF snapshot
- Verified VRF lifecycle: request/fulfill separation, 12-hour timeout retry, 3-day GAMEOVER fallback, emergency coordinator rotation
- Resolved research open questions #2 (drip rate = 0.75%/day conservative projection) and #3 (century retained fraction = 30-65% via 5 dice of 0-3)
- Cross-checked delta-v7 changes: AdvanceModule (4 functions), JackpotModule (4 functions), DecimatorModule (0 functions). No pre-v7 language detected in paper.

## Task Commits

1. **Task 1: Verify AdvanceModule, JackpotModule, DecimatorModule** - `f94d108` (feat)

## Files Created/Modified
- `.planning/phases/15-game-modules-parity/findings/02-distribution.md` - Intermediate findings with 8 discrepancies and clean verification sections

## Decisions Made
- Rated GM-01 (extraction equation wrong variable) as Major because the equation inverts the pool direction, though the prose on the next line is correct
- Rated turbo jackpot compression (GM-03) as Minor rather than Major because it is a mode omission not a wrong number or mechanism description
- Accepted paper's "~1.8x" as valid approximation of 1.7833x burn weight multiplier
- BAF scatter internal percentages (45%/25% etc.) deferred to plan 15-04 for EndgameModule internal verification

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None -- no external service configuration required.

## Next Phase Readiness
- Distribution module findings ready for consolidation in Phase 17
- BAF scatter internal allocation deferred to plan 15-04 (EndgameModule scope)
- No blockers for subsequent plans

## Self-Check: PASSED

- findings/02-distribution.md: FOUND
- 15-02-SUMMARY.md: FOUND
- Commit f94d108: FOUND

---
*Phase: 15-game-modules-parity*
*Completed: 2026-03-31*
