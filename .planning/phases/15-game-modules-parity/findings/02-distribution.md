# Distribution Modules Parity Notes

**Verified:** 2026-03-31
**Paper:** theory/index.html
**Contracts verified:**
- DegenerusGameAdvanceModule.sol (1,660 lines) -- COMPLETE
- DegenerusGameJackpotModule.sol (2,721 lines) -- COMPLETE
- DegenerusGameDecimatorModule.sol (930 lines) -- COMPLETE

**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/modules/

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Major | 1 |
| Minor | 3 |
| Info | 4 |
| **Total** | **8** |

## Discrepancies

### GM-01: Extraction function equation uses wrong pool variable

- **Paper:** App. C, line 5181: "$P^{curr}_{\ell+1} \leftarrow f(P^{fut}_\ell, t)$". The equation says currentPool at level l+1 is a function of the futurePool. Line 5182 then correctly says "transfers a percentage of nextPrizePool to futurePrizePool."
- **Contract:** AdvanceModule `_applyTimeBasedFutureTake` (line 1073-1148). The extraction function operates on `nextPrizePool`, skimming a fraction into `futurePrizePool`. The remaining nextPool becomes currentPool via `consolidatePrizePools`.
- **Mismatch:** The equation references the wrong pool. It says $f(P^{fut}_\ell, t)$ but the actual input is the nextPool, not the futurePool. The prose on the very next line is correct. A reader who takes the equation literally would misunderstand the core pool flow: they would think the futurepool is being drained into the current pool, when in fact the nextpool is being skimmed with proceeds going to the futurepool.
- **Severity:** Major

### GM-02: Extraction function "Days 0-12" label inconsistency

- **Paper:** App. C, "Days 0-12 (level fills within 12 days): flat at 30% + level bonus."
- **Contract:** AdvanceModule `_nextToFutureBps` (line 1045). The function uses an 11-day offset from levelStartTime. Flat 30% applies when elapsed <= 1 day, meaning the level completed within 12 days of start.
- **Mismatch:** "Days 0-12" implies 13 days (0 through 12 inclusive), but the parenthetical says "within 12 days." The contract gives flat 30% for levels completing in 12 or fewer days. "Within 12 days" matches the contract; "Days 0-12" does not if read literally as 13 distinct days. The subsequent intervals (12-25, 25-39) are consistent with a 12-day boundary.
- **Severity:** Minor

### GM-03: Turbo jackpot compression mode undocumented

- **Paper:** S5.4 / App. C: Describes compressed jackpot phase as "3 days" when purchase phase lasted 3 days or fewer.
- **Contract:** AdvanceModule lines 333-351. Two compression modes exist: `compressedJackpotFlag=1` (3 physical days when target met within 3 purchase days) and `compressedJackpotFlag=2` (turbo: all 5 logical jackpot days run in 1 physical day when target met on day 0-1).
- **Mismatch:** Paper omits turbo mode entirely. When the pool target is met on the first or second day of a level, the contract runs all 5 logical jackpot days in a single advanceGame call. This is a meaningful behavioral difference that affects how fast levels can cycle.
- **Severity:** Minor

### GM-04: Jackpot phase 3-day trigger condition wording

- **Paper:** S5.4, "If the purchase phase lasted 3 days or fewer, the jackpot phase compresses to 3 days."
- **Contract:** AdvanceModule line 335: `if (day - purchaseStartDay <= 3) { compressedJackpotFlag = 1; }`. This fires when the target is met on the day the lastPurchaseDay flag is set.
- **Mismatch:** Paper says "purchase phase lasted 3 days or fewer." Contract checks `day - purchaseStartDay <= 3`, which means the target was met within 3 days of the purchase start. These are functionally similar but the paper's phrasing ("lasted 3 days") suggests a completed duration, while the contract checks elapsed days at the moment the target is reached.
- **Severity:** Minor

### GM-05: x00 BAF and decimator draw from same snapshot (omission)

- **Paper:** S6.3: "The bonus BAF jackpot (20% of futurepool) and an enlarged decimator (30% vs the normal 10%) fire on top of this enlarged pool."
- **Contract:** EndgameModule `runRewardJackpots` (lines 176, 187, 212). Both BAF (20%) and decimator (30%) at x00 draw from `baseFuturePool`, a snapshot taken at function entry. Combined allocation is 50% of the snapshot value.
- **Mismatch:** Paper does not specify whether the 20% and 30% are from the same snapshot or sequential. Sequential application would make the decimator draw 30% of the remaining 80% (=24% of original), which is materially different from 30% of the original (=30%). The contract uses snapshot-based parallel allocation. This distinction affects player calculations of expected decimator pool sizes at century milestones.
- **Severity:** Info

### GM-06: Purchase-phase lootbox reward 50% ticket conversion detail omitted

- **Paper:** App. C (line 4277): "Three-quarters of this is converted to lootbox tickets."
- **Contract:** JackpotModule `payDailyJackpot` early-burn path (lines 612-638). `PURCHASE_REWARD_JACKPOT_LOOTBOX_BPS = 7500` (75%) is the lootbox allocation. However, `ticketConversionBps = 5000` (50%) means only half the budget generates ticket counts; the full budget flows to nextPool to improve pool backing ratio.
- **Mismatch:** Paper correctly states 75% is converted to lootbox tickets. But the actual ticket count is sized at 50% of the budget (the other 50% is pool backing). A reader calculating expected ticket counts from the paper would overestimate by 2x. The economic effect is that each ticket is 2x ETH-backed compared to a naively-computed amount.
- **Severity:** Info

### GM-07: Level 50 BAF rate omitted from S6.3 century discussion

- **Paper:** S6.3 discusses the century cycle but only mentions x00 levels getting 20% BAF. App. B.3 separately documents level 50 getting 20%.
- **Contract:** EndgameModule line 186: `bafPct = prevMod100 == 0 ? 20 : (lvl == 50 ? 20 : 10)`. Level 50 and all x00 levels get 20%.
- **Mismatch:** S6.3 omits the level 50 special case. A reader of only S6.3 would assume level 50 gets the default 10%. The information exists in App. B.3 but is not cross-referenced.
- **Severity:** Info

### GM-08: Jackpot daily carryover mechanism not described in App. B

- **Paper:** App. B describes daily jackpot distribution but does not describe the carryover jackpot mechanism.
- **Contract:** JackpotModule `payDailyJackpot` daily path (lines 398-458). On jackpot phase days 2-4 (not day 1), a 1% futurePool slice is distributed as a "carryover" jackpot to future-level (lvl+1 to lvl+5) ticket holders. 50% of this slice goes to lootbox tickets, remainder as ETH. Day 1 instead runs the early-bird lootbox jackpot (3% of futurePool).
- **Mismatch:** Paper mentions the early-bird ("luckbox") jackpot in S8.4 but does not describe the days 2-4 carryover jackpot in App. B. This mechanism distributes value to future-level ticket holders during the jackpot phase and is relevant to the time-value of future tickets argument made in the paper.
- **Severity:** Info

## Verified Clean (No Discrepancies)

### Section 2.5: Hero Symbol Override
Paper claims "most-wagered Degenerette symbol auto-wins its quadrant" (line 5406). Contract `_getWinningTraits` (JackpotModule line 1735) and `_topHeroSymbol` (line 1773) confirm: the symbol with highest total wagers across all 4 quadrants auto-wins its own quadrant with a random VRF-derived color, replacing only that quadrant. Paper correctly states the override is per-quadrant and fixes only the symbol (1 of 8), not the color.

### Section 5.3: Auto-Rebuy Bonuses
Paper states "30%/45%" bonuses. Contract: AUTO_REBUY_BONUS_BPS = 13000 (130% = +30%), AFKING_AUTO_REBUY_BONUS_BPS = 14500 (145% = +45%). Confirmed in both DecimatorModule (lines 92-95) and JackpotModule (lines 979-980).

### Section 6.2: Decimator 50/50 Split
Contract `_creditDecJackpotClaimCore` (DecimatorModule line 437): `ethPortion = amount >> 1` (50%), `lootboxPortion = amount - ethPortion` (50%). Matches.

### Section 6.2: Decimator Bucket Assignment
Default bucket = 12 (BurnieCoin.sol line 171), min bucket normal = 5 (line 174), min bucket x00 = 2 (line 175). Activity cap = 23500 bps (line 178). At max activity: bucket = 5 normal, 2 at x00. Matches paper.

### Section 6.2: Burn Weight Multiplier
`_decimatorBurnMultiplier` (BurnieCoin.sol line 917): `BPS_DENOMINATOR + (bonusBps / 3)`. At max capped activity (23500): 10000 + 7833 = 17833 bps (1.7833x). Paper says "~1.8x." Valid approximation.

### Section 6.3: Century Futurepool Retained Fraction
`_futureKeepBps` (JackpotModule line 1260): 5 dice of 0-3, formula `3000 + (total * 3500) / 15`. Range: 30%-65%. Mean: 47.5%. Exact match.

### Section 6.3: Century Accumulator Dump
`consolidatePrizePools` (JackpotModule line 855-861): 50% to futurePool, 50% retained. Matches "half the segregated accumulator flows into the futurepool."

### Section 6.3: Century Nextpool Target
`_endPhase` (AdvanceModule line 520-521): `levelPrizePool[lvl] = _getFuturePrizePool() / 3`. Matches "one third the remaining futurepool."

### Appendix B: Jackpot Phase 5 Days (JACKPOT_LEVEL_CAP)
AdvanceModule and JackpotModule both use `JACKPOT_LEVEL_CAP = 5`. Matches.

### Appendix B: Daily Jackpot Pool Percentage
`_dailyCurrentPoolBps` (JackpotModule line 2585): 6%-14% uniform random on days 1-4, 100% on day 5. Matches.

### Appendix B: Trait-Bucket Shares
Days 1-4: DAILY_JACKPOT_SHARES_PACKED = 2000 bps each (20% per bucket). Day 5: FINAL_DAY_SHARES_PACKED = 6000/1333/1333/1334 (60/13.3/13.3/13.4%). Solo bucket rotates by entropy. Matches.

### Appendix B: BURNIE Jackpot Budget
`_calcDailyCoinBudget` (JackpotModule line 2576): 0.5% of level target in BURNIE. 75% near-future, 25% far-future (FAR_FUTURE_COIN_BPS = 2500). Matches.

### Appendix B: Purchase-Phase Daily Drip
Early-burn path poolBps = 100 (1% of futurePool). Matches.

### Appendix B: Early-Bird Lootbox Jackpot (Luckbox)
`_runEarlyBirdLootboxJackpot` (JackpotModule line 775): 3% of futurePool. Matches paper's "3% futurepool draw."

### Appendix B.3: BAF Pool Percentages
Normal milestones: 10%. Level 50: 20%. x00 levels: 20%. Matches.

### Appendix B.4: Decimator Trigger Schedule
x5 (except x95) at 10%, x00 at 30%. Contract: `prevMod10 == 5 && prevMod100 != 95` and `prevMod100 == 0`. Matches.

### Appendix B.4: Decimator Not Triggered at x95
EndgameModule line 226: `prevMod100 != 95`. Matches "The decimator is not triggered at level x95."

### Appendix C: Extraction Function - All 8 Components
1. **U-shape base rate:** 30%->13%->30% with 11-day offset. Flat at 30% for <=12 days, minimum 13% at day 25, back to 30% by day 39. NEXT_TO_FUTURE_BPS_FAST=3000, NEXT_TO_FUTURE_BPS_MIN=1300. Matches.
2. **Century ramp:** +0% to +9%, `(lvl % 100 / 10) * 100` bps. Matches.
3. **x9 boost:** +2% (NEXT_TO_FUTURE_BPS_X9_BONUS=200). Matches.
4. **Ratio adjustment:** +/-4%, targets 2:1 ratio. Matches.
5. **Overshoot surcharge:** Hyperbolic, 1.25x threshold (OVERSHOOT_THRESHOLD_BPS=12500), 35% cap (OVERSHOOT_CAP_BPS=3500), coefficient 0.40 (OVERSHOOT_COEFF=4000). Matches.
6. **Additive variance:** 0-10% (ADDITIVE_RANDOM_BPS=1000), upward only. Matches.
7. **Multiplicative variance:** +/-25% (NEXT_SKIM_VARIANCE_BPS=2500), triangular from two VRF rolls. Matches.
8. **80% cap:** NEXT_TO_FUTURE_BPS_MAX=8000. Matches.

### Appendix C: VRF Request/Fulfill Separation
Chainlink VRF V2.5 via `_requestRng` (line 1305) and `rawFulfillRandomWords` (line 1491). Word stored in `rngWordCurrent`, processed on next `advanceGame`. Matches.

### Appendix C: Liveness Guarantee
12-hour timeout retry (line 876), 3-day historical VRF fallback for GAMEOVER (line 946), emergency VRF coordinator rotation (line 1420). Matches.

### Appendix C: Futurepool Drawdown (15%)
`_drawDownFuturePrizePool` (line 1150): 15% on normal levels, 0% on x00. Matches.

### Appendix C: Insurance Skim (1%)
INSURANCE_SKIM_BPS = 100 (1%). Applied to nextPool at level transition, routed to yieldAccumulator. Matches "1% of each completed level's prize pool flows there directly."

### Appendix E.4: BURNIE Coverage Gate Drip Rate
DECAY_RATE = 0.9925 ether (0.75% per day, conservative). `_projectedDrip` uses geometric series. Matches "0.75% per day, compounding."

## Delta-v7 Cross-Check

### AdvanceModule (4 changed functions)
Changes: GNRUS integration (pickCharity at level transition), gas optimizations, storage fixes. No impact on extraction function, VRF flow, or liveness claims. No pre-v7 language detected in paper.

### JackpotModule (4 changed functions)
Changes: gas optimizations, GNRUS yield distribution (23% charity share). No impact on jackpot type descriptions, bucket shares, or pool dynamics. No pre-v7 language detected.

### DecimatorModule (0 changed functions)
No v7 changes. No cross-check needed.

## Open Questions Resolved

**Research Q2 (drip rate):** Paper says 0.75%/day. Contract DECAY_RATE = 0.9925 (= 1 - 0.0075). Confirmed match. The 0.75% is an intentionally conservative projection rate vs. the actual 1% drip.

**Research Q3 (century retained fraction):** Paper says 30%-65%, avg ~47.5%. Contract `_futureKeepBps` produces 3000 + (sum-of-5-dice * 3500 / 15) where each die is 0-3. Range 3000-6500 bps. Mean = 3000 + (7.5 * 233.33) = 4750 bps. Exact match.
