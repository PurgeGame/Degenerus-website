---
phase: 16-token-support-systems-parity
plan: 02
subsystem: verification
tags: [coinflip, burnie, solidity, parity-check, contract-audit]

requires:
  - phase: 15-game-modules-parity
    provides: "D-01 discrepancy format, GM-XX findings, known non-issues"
provides:
  - "Coinflip tier verification with independent payout mean computation"
  - "4 discrepancies (TS-20 through TS-23) for BurnieCoinflip.sol and BurnieCoin.sol"
  - "Open Question #2 resolution: contract range [78,115] matches paper"
  - "Decimator bucket constants verified (12/5/2)"
  - "Vault and sDGNRS 2M BURNIE allocations confirmed"
affects: [16-token-support-systems-parity, 17-consolidated-parity-report]

tech-stack:
  added: []
  patterns: ["contract-by-contract verification with independent computation of derived values"]

key-files:
  created:
    - ".planning/phases/16-token-support-systems-parity/findings/02-coinflip-system.md"
  modified: []

key-decisions:
  - "Started TS numbering at TS-20 to leave room for parallel Plan 01 findings"
  - "Classified recycling bonus mismatch as Critical since it affects EV calculations"
  - "Deferred +100 BURNIE pre-final-draw bonus verification to Plan 03 (affiliate contract scope)"

patterns-established:
  - "Independent computation of derived values (payout mean) from contract constants before comparing to paper"

requirements-completed: []

duration: 6min
completed: 2026-03-31
---

# Phase 16 Plan 02: Coinflip System Verification Summary

**Independently verified coinflip payout mean 1.9685x from BurnieCoinflip.sol constants; found recycling bonus percentages overstated in paper (0.75%/1.00% vs claimed 1%/1.6%)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-01T01:37:27Z
- **Completed:** 2026-04-01T01:43:47Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Independently computed coinflip payout mean 1.9685x from contract tier constants, confirming App. A
- Verified all three coinflip multiplier tiers (5%/5%/90% with 50%/150%/78-115%) match contract exactly
- Resolved Open Question #2: EXTR-02 catalog's "50-156%" was a cross-tier conflation; paper's per-tier breakdown is correct
- Found 4 discrepancies (1 Critical, 1 Minor, 2 Info) across both contracts
- Verified all decimator constants in BurnieCoin.sol (bucket base 12, min 5/2, 1000 BURNIE min burn)
- Confirmed 2M BURNIE allocations to both vault (virtual reserve) and sDGNRS (minted at construction)

## Task Commits

1. **Task 1: Verify BurnieCoinflip.sol and BurnieCoin.sol against paper claims** - `586fdf2` (feat)

## Files Created/Modified

- `.planning/phases/16-token-support-systems-parity/findings/02-coinflip-system.md` - Intermediate findings with coinflip tier verification, 4 discrepancies, and verification of decimator/vault/quest integration

## Decisions Made

- Started TS numbering at TS-20 to accommodate parallel Plan 01 (which covers DGNRS ecosystem and may use TS-01 through TS-19)
- Classified TS-20 (recycling bonus overstated) as Critical because the 0.75% vs 1% and 1.00% vs 1.6% differences affect EV calculations that the paper presents as precise
- Deferred the +100 BURNIE pre-final-draw affiliate bonus to Plan 03 since it's not in BurnieCoinflip.sol or BurnieCoin.sol

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 findings ready for consolidation into 16-TOKEN-PARITY-NOTES.md in Plan 04
- TS-20 (recycling bonus) is Critical severity and should be prioritized for paper correction
- The +100 BURNIE pre-final-draw bonus needs verification against DegenerusAffiliate.sol in Plan 03

## Self-Check: PASSED

---
*Phase: 16-token-support-systems-parity*
*Completed: 2026-03-31*
