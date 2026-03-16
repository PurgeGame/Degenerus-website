# Phase 3 Plan 01: SS4 Mechanism Design Audit Summary

**Claim-by-claim mechanism and numerical audit of SS4.1 Accounting Solvency, SS4.2 Zero-Rake Property, and SS4.3 Permissionless Execution with formula verification for Proposition 4.1 and Corollary 4.4**

---

## SS4.1 Accounting Solvency (lines 2865-2905)

### Mechanism Claims

**M1: Five logical pools correctly named**
Paper lists: `nextPrizePool`, `futurePrizePool`, `currentPrizePool`, `claimablePool`, and "segregated accumulator."
Primer Section 3 lists: futurePool, nextPool, currentPool, claimablePool, plus yieldAccumulator (the segregated accumulator).
The paper uses slightly more formal names (e.g., "nextPrizePool" vs "nextPool") but these map 1:1 to the contract storage variables `_getNextPrizePool()`, `_getFuturePrizePool()`, `currentPrizePool`, `claimablePool`, and `yieldAccumulator`.
**VERIFIED** -- five pools correctly identified.

**M2: "Only claimablePool represents current obligations"**
Per primer Section 3: futurePool, nextPool, currentPool are all game-state pools with no withdrawal rights. The yieldAccumulator also has no withdrawal rights (it distributes only at x00 milestones or GAMEOVER). Only `claimablePool` credits can be withdrawn by players via `claimWinnings()`. The `yieldPoolView()` function (DegenerusGame.sol:2138-2148) confirms that obligations = currentPrizePool + nextPrizePool + claimablePool + futurePrizePool + yieldAccumulator, and only claimablePool has direct claim functions.
**VERIFIED** -- only claimablePool represents current obligations.

**M3: Solvency invariant (Proposition 4.1) -- four state transition categories**

Paper states: `claimablePool <= ETH balance + stETH balance` is preserved by every state transition.

**(M3a) Deposits:** Paper says "increase totalBalance and increment prize pools. claimablePool unchanged."
Per v1.1-parameter-reference.md: ticket purchases split to next/future pools (PURCHASE_TO_FUTURE_BPS = 1000 means 10% future, 90% next). Lootbox splits 90% future / 10% next (post-presale). Neither modifies claimablePool. ETH enters the contract (balance increases) and is allocated to non-obligated pools.
**VERIFIED** -- deposits widen the inequality.

**(M3b) Jackpot payouts:** Paper says "move ETH from prize pools into claimablePool. Total balance unchanged."
Per v1.1-jackpot-phase-draws.md and v1.1-purchase-phase-distribution.md: jackpot distributions credit `claimableWinnings[winner]` and increment `claimablePool` by the same amount, while decrementing `currentPrizePool` or the relevant source pool. No ETH leaves the contract. Internal transfer between pools.
**VERIFIED** -- inequality preserved (claimablePool increases by exactly the amount prize pools decrease).

**(M3c) Claims:** Paper says "decrement both claimablePool and total balance by same amount. Checks-effects-interactions pattern."
Per v1.1-steth-yield.md Section 4a: `_claimWinningsInternal` (DegenerusGame.sol:1392-1408) decrements `claimableWinnings[player]` and `claimablePool` before calling `_payoutWithStethFallback` which sends ETH/stETH. State updates before external call = CEI pattern.
**VERIFIED** -- both sides of inequality decrease equally, pattern confirmed.

**(M3d) Yield routing:** Paper says "25% to vault, 25% to DGNRS holders, 50% to segregated accumulator."
Per v1.1-steth-yield.md Section 3b: actual distribution is 23% sDGNRS, 23% vault, 46% accumulator, ~8% buffer.
**Cross-reference Phase 2 finding:** 02-02-SUMMARY.md (Claim 2) and 02-03-SUMMARY.md both document this as IMPRECISE. The 50/25/25 is a rounded approximation of the actual 46/23/23 split. The mechanism description is correct (yield routes to three destinations: vault, DGNRS holders, accumulator). The percentages are imprecise.
**IMPRECISE** -- mechanism correct, percentages rounded (see Phase 2).

**M4: Accumulator inflows -- two distinct sources**
Paper says accumulator receives: (a) "50% of stETH yield (continuous)" and (b) "1% of each completed level's prize pool (at level transition)."
Per v1.1-steth-yield.md Section 3b: `_distributeYieldSurplus` sends 46% of yield surplus to `yieldAccumulator` at each level transition (not continuous, but periodic at transitions). The "continuous" language in the paper is a simplification; yield accrues continuously via stETH rebasing but is distributed to the accumulator at each level transition.
Per v1.1-pool-architecture.md and parameter reference: `INSURANCE_SKIM_BPS = 100` (AdvanceModule.sol:107) = 1% of nextPool skimmed to yieldAccumulator at each level transition.
**Cross-reference Phase 2:** 02-03-SUMMARY.md verified INSURANCE_SKIM_BPS = 100 (1%).
Two distinct inflow sources confirmed: yield surplus distribution + insurance skim.
**VERIFIED** (mechanism of two inflows correct). The "50%" share is IMPRECISE (actual 46%) per Phase 2 cross-reference. The "continuous" description is a minor simplification (yield accrues continuously but distributes at transitions).

**M5: Accumulator isolation**
Paper says accumulator "does not participate in daily drip or BAF calculations."
Per v1.1-purchase-phase-distribution.md Section 2b: daily drip draws from `_getFuturePrizePool()` only, not yieldAccumulator. Per v1.1-transition-jackpots.md Section 1: BAF draws from `baseFuturePool = _getFuturePrizePool()`, not yieldAccumulator. Decimator also draws from futurePool (local or base). The yieldAccumulator is a separate storage variable that is not included in any of these source pools.
**VERIFIED** -- accumulator is isolated from drip and BAF/decimator calculations.

**M6: Century distribution -- 50% distributes, 50% retained**
Paper says "At century milestones (x00), 50% distributes as a milestone event; the retained 50% serves as terminal insurance."
Per v1.1-steth-yield.md Section 3b and primer Section 8: "At x00 milestone levels, 50% of the accumulator flows into futurePrizePool ... 50% is retained as growing terminal insurance."
**VERIFIED** -- 50/50 century distribution confirmed.

**M7: stETH conversion has no effect on solvency**
Paper says "Staking ETH to stETH is a conversion between two assets that both count toward total balance, so it has no effect on solvency."
Per v1.1-steth-yield.md Section 3a: `yieldPoolView()` computes `totalBalance = address(this).balance + steth.balanceOf(address(this))`. Both ETH and stETH count toward total balance. Converting ETH to stETH via Lido's `submit()` is a 1:1 conversion (input ETH = output stETH approximately). Pitfall 12 notes 1-2 wei rounding errors, which are immaterial at the paper's abstraction level.
Per AUDIT-PREP.md Pitfall 12: "At the paper's level of abstraction this is appropriate." The solvency argument holds at ETH-level precision.
**VERIFIED** -- stETH conversion does not affect solvency at the paper's abstraction level.

### Numerical Claims

**N1: "50% yield to accumulator"**
Actual: 46% (per v1.1-steth-yield.md Section 3b).
**IMPRECISE** -- Cross-reference Phase 2 finding (02-02-SUMMARY.md Claim 2, 02-03-SUMMARY.md).

**N2: "25% yield to vault"**
Actual: 23% (per v1.1-steth-yield.md Section 3b).
**IMPRECISE** -- Cross-reference Phase 2 finding.

**N3: "25% yield to DGNRS holders"**
Actual: 23% (per v1.1-steth-yield.md Section 3b).
**IMPRECISE** -- Cross-reference Phase 2 finding.

**N4: "1% insurance skim"**
Actual: INSURANCE_SKIM_BPS = 100 = 1% (AdvanceModule.sol:107).
**VERIFIED** -- Cross-reference Phase 2 (02-03-SUMMARY.md verified this parameter).

**N5: "50% accumulator distributes at x00"**
Actual: 50% of accumulator flows to futurePrizePool at x00 milestones, 50% retained.
**VERIFIED** -- per v1.1-steth-yield.md Section 3b and primer Section 8.

### Proposition 4.1 Formula Verification (ARITH-02)

**Formula stated:** `claimablePool <= ETH balance + stETH balance`

**Variable mapping:**
- `claimablePool` -> `claimablePool` (DegenerusGame.sol storage variable, also `claimableWinnings[player]` aggregates)
- `ETH balance` -> `address(this).balance` (native ETH held by game contract)
- `stETH balance` -> `steth.balanceOf(address(this))` (stETH held by game contract)

**Exhaustiveness of four state transition categories:**
The paper claims deposits, jackpot payouts, claims, and yield routing are the exhaustive set of operations that modify relevant variables. This is correct:
- Deposits = ticket/lootbox/whale/deity/degenerette purchases (all add ETH and increment prize pools, never claimablePool)
- Jackpot payouts = daily drip, jackpot phase draws, BAF, decimator, BURNIE jackpots (all internal transfers from prize pools to claimablePool)
- Claims = `claimWinnings`, `claimWinningsStethFirst` (decrease both claimablePool and total balance)
- Yield routing = `_distributeYieldSurplus` + `_autoStakeExcessEth` + `adminStakeEthForStEth` (form changes or internal allocations, claimablePool increases by exactly what yield credits)

**One additional operation worth noting:** `_autoStakeExcessEth` converts ETH to stETH. This changes the composition of total balance but not the total, so the inequality is unaffected. Similarly, admin staking functions are value-neutral (v1.1-steth-yield.md Section 2b-2c).

**VERIFIED** -- Proposition 4.1 formula is correctly stated, each variable maps to a contract equivalent, and the four state transition categories are exhaustive with respect to preserving the invariant.

### SS4.1 Discrepancy Table

| # | Location | Claimed | Correct | Source | Severity | Fix |
|---|----------|---------|---------|--------|----------|-----|
| 1 | SS4.1 line 2890 | 25% yield to vault | 23% | v1.1-steth-yield.md S3b | LOW | Change "25%" to "~23%" or add footnote. Cross-ref Phase 2. |
| 2 | SS4.1 line 2890 | 25% yield to DGNRS | 23% | v1.1-steth-yield.md S3b | LOW | Change "25%" to "~23%". Cross-ref Phase 2. |
| 3 | SS4.1 line 2891 | 50% yield to accumulator | 46% | v1.1-steth-yield.md S3b | LOW | Change "50%" to "~46%". Cross-ref Phase 2. |
| 4 | SS4.1 line 2892 | 50% of stETH yield (continuous) | 46% of yield surplus (at level transitions) | v1.1-steth-yield.md S3b | LOW | "Continuous" is a simplification; yield accrues continuously but distributes at transitions. |

