---
phase: 15-game-modules-parity
plan: 01
subsystem: audit
tags: [solidity, contract-verification, game-theory, parity-check]

requires:
  - phase: 15-game-modules-parity
    provides: "CONTEXT.md and RESEARCH.md with contract-to-paper mapping and verification methodology"
provides:
  - "Intermediate findings file covering Storage, Mint, Lootbox, and Whale contracts"
  - "GM-01 through GM-03 discrepancy entries in D-01/D-02 format"
  - "Verification that all ticket pricing, lootbox splits, reward path probabilities, and variance tiers match paper exactly"
affects: [15-game-modules-parity, 17-consolidated-parity-report]

tech-stack:
  added: []
  patterns: ["D-01 discrepancy format with paper/contract/mismatch/severity fields", "GM-XX sequential numbering per D-06"]

key-files:
  created:
    - ".planning/phases/15-game-modules-parity/findings/01-deposit-paths.md"
  modified: []

key-decisions:
  - "Level targeting discrepancy (90/10 vs 95/5) rated Major since it directly affects player expectations about ticket distribution"
  - "stETH yield split noted as Info since actual constants live in DegenerusGame.sol (Plan 15-04 scope)"
  - "Near-future range phrasing '0 to 5' resolved in paper's favor as ambiguous rather than wrong"

patterns-established:
  - "Contract-by-contract verification sweep: read all constants, then cross-reference every paper section"
  - "Explicit 'No discrepancies found' section markers for verified areas"

requirements-completed: [OUT-02]

duration: 5min
completed: 2026-03-31
---

# Phase 15 Plan 01: Deposit Paths Parity Summary

**Verified all Storage constants, ticket/lootbox splits, reward path probabilities, variance tiers, and whale/deity pricing across 4 contracts. Found 1 Major discrepancy (lootbox level targeting 90/10 vs paper's 95/5) and 2 Info items.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-01T00:21:21Z
- **Completed:** 2026-04-01T00:26:58Z
- **Tasks:** 1
- **Files created:** 1

## Accomplishments

- Systematically compared ~60 constants and mechanism descriptions across DegenerusGameStorage.sol, DegenerusGameMintModule.sol, DegenerusGameLootboxModule.sol, and DegenerusGameWhaleModule.sol against the game theory paper
- Found 1 Major discrepancy: lootbox level targeting uses 90%/10% near/far split in contract but paper states 95%/5%
- Confirmed all ticket pricing (PriceLookupLib), lootbox reward path probabilities (55/10/10/25), ticket variance tiers, BURNIE variance ranges, DGNRS tier draw rates, and boon budget match the paper exactly
- Confirmed whale bundle pricing (2.4-4 ETH), deity pass base price (24 ETH), deity cap (32), auto-rebuy bonuses (30%/45%), century bonus (up to 100%, 20 ETH cap), and bootstrap prize pool (50 ETH) all match

## Task Commits

1. **Task 1: Verify Storage constants and deposit path contracts** - `ccfbad4` (feat)

## Files Created/Modified

- `.planning/phases/15-game-modules-parity/findings/01-deposit-paths.md` - Intermediate findings with 3 discrepancies (1 Major, 2 Info) across 4 contracts

## Decisions Made

- Rated GM-01 (level targeting 90/10 vs 95/5) as Major because it directly affects player expectations about ticket distribution probabilities
- Rated GM-03 (stETH yield split) as Info because the actual yield constants live in DegenerusGame.sol (outside this plan's 4-contract scope)
- Resolved GM-02 (near-future range "0 to 5") in paper's favor as ambiguous phrasing rather than an error

## Deviations from Plan

None. Plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- Findings file ready for consolidation in Phase 17 (consolidated parity report)
- The level targeting discrepancy (GM-01) is the most actionable finding: paper should either be updated to 90/10 or the intent should be clarified
- Plans 15-02 through 15-04 cover the remaining 10 contracts (Advance, Jackpot, Decimator, Degenerette, Endgame, GameOver, Boon, MintStreakUtils, PayoutUtils, DegenerusGame router)

## Self-Check: PASSED

- findings/01-deposit-paths.md: FOUND
- 15-01-SUMMARY.md: FOUND
- Commit ccfbad4: FOUND

---
*Phase: 15-game-modules-parity*
*Completed: 2026-03-31*
