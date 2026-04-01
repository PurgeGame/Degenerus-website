# Game & Modules Parity Notes

**Verified:** 2026-03-31
**Paper:** theory/index.html
**Contracts:** DegenerusGame.sol, DegenerusGameStorage.sol, 12 modules
**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Major | 3 |
| Minor | 4 |
| Info | 5 |
| **Total** | **12** |

## Contracts Verified

| Contract | Status |
|----------|--------|
| DegenerusGame.sol | COMPLETE |
| DegenerusGameStorage.sol | COMPLETE |
| DegenerusGameAdvanceModule.sol | COMPLETE |
| DegenerusGameBoonModule.sol | COMPLETE |
| DegenerusGameDecimatorModule.sol | COMPLETE |
| DegenerusGameDegeneretteModule.sol | COMPLETE |
| DegenerusGameEndgameModule.sol | COMPLETE |
| DegenerusGameGameOverModule.sol | COMPLETE |
| DegenerusGameJackpotModule.sol | COMPLETE |
| DegenerusGameLootboxModule.sol | COMPLETE |
| DegenerusGameMintModule.sol | COMPLETE |
| DegenerusGameMintStreakUtils.sol | COMPLETE |
| DegenerusGamePayoutUtils.sol | COMPLETE |
| DegenerusGameWhaleModule.sol | COMPLETE |

## Discrepancies by Paper Section

### Section 6.3: Century Cycle

#### GM-01: x00 BAF and decimator draw from same snapshot

- **Paper:** S6.3, "The bonus BAF jackpot (20% of futurepool) and an enlarged decimator (30% vs the normal 10%) fire on top of this enlarged pool."
- **Contract:** DegenerusGameEndgameModule.sol, lines 176, 187, 212. Both BAF (20%) and decimator (30%) at x00 draw from `baseFuturePool`, a snapshot taken at function entry. Combined allocation is 50% of the snapshot value.
- **Mismatch:** Paper does not specify whether the 20% and 30% are from the same snapshot or sequential. Sequential application would make the decimator draw 30% of the remaining 80% (= 24% of original), which is materially different from 30% of the original (= 30%). The contract uses snapshot-based parallel allocation. This distinction affects player calculations of expected decimator pool sizes at century milestones.
- **Severity:** Info

#### GM-02: Level 50 BAF rate omitted from S6.3 century discussion

- **Paper:** S6.3 discusses the century cycle but only mentions x00 levels getting 20% BAF. App. B.3 separately documents level 50 getting 20%.
- **Contract:** DegenerusGameEndgameModule.sol, line 186: `bafPct = prevMod100 == 0 ? 20 : (lvl == 50 ? 20 : 10)`. Level 50 and all x00 levels get 20%.
- **Mismatch:** S6.3 omits the level 50 special case. A reader of only S6.3 would assume level 50 gets the default 10%. The information exists in App. B.3 but is not cross-referenced.
- **Severity:** Info

### Section 10: Terminal Distribution

#### GM-03: Final sweep split omits GNRUS

- **Paper:** S10 (line 4224), "unclaimed funds are split between the vault and the DGNRS contract." Also S4.1 (line 3127), "funds unclaimed 30 days after GAMEOVER" references only vault and DGNRS.
- **Contract:** DegenerusGameGameOverModule.sol, lines 210-224. `_sendToVault` splits 33% DGNRS / 33% vault / 34% GNRUS.
- **Mismatch:** Paper describes a 2-way split (vault + DGNRS). Contract implements a 3-way split including GNRUS at 34%. This is a v7 change (DRIFT 5 in delta-v7 audit confirmed the 33/33/34 split was added in commit e4833ac7). The paper's S4.3 yield routing description correctly includes GNRUS in the yield split, making this an internal inconsistency: the paper acknowledges GNRUS exists in yield routing but omits it from the final sweep.
- **Severity:** Major

### Appendix A: Parameter Table

#### ~~GM-04: RETRACTED~~ stETH yield split is 25/25/25/25 as paper states

- **Status:** RETRACTED. This finding was incorrect.
- **Actual implementation:** DegenerusGameJackpotModule.sol `_distributeYieldSurplus()` line 903: `quarterShare = (yieldPool * 2300) / 10_000` gives 23% each to vault, sDGNRS, GNRUS, and accumulator. Four equal shares with ~8% buffer. Paper's "25/25/25/25" is the correct simplified description. The DegenerusGameStorage.sol line 1382 comment about "46%" refers to a different mechanism (level transition accumulator collection), not the yield surplus split.

### Appendix B: Jackpot Distribution

#### GM-05: Jackpot daily carryover mechanism not described

- **Paper:** App. B describes daily jackpot distribution but does not describe the carryover jackpot mechanism.
- **Contract:** DegenerusGameJackpotModule.sol, `payDailyJackpot` daily path (lines 398-458). On jackpot phase days 2-4 (not day 1), a 1% futurePool slice is distributed as a "carryover" jackpot to future-level (lvl+1 to lvl+5) ticket holders. 50% of this slice goes to lootbox tickets, remainder as ETH. Day 1 instead runs the early-bird lootbox jackpot (3% of futurePool).
- **Mismatch:** Paper mentions the early-bird ("luckbox") jackpot in S8.4 but does not describe the days 2-4 carryover jackpot in App. B. This mechanism distributes value to future-level ticket holders during the jackpot phase and is relevant to the time-value of future tickets argument made in the paper.
- **Severity:** Info

### Appendix C: Extraction Function / Activity Score / Ticket Pricing / Liveness

#### GM-06: Extraction function equation uses wrong pool variable

- **Paper:** App. C (line 5181), "$P^{curr}_{\ell+1} \leftarrow f(P^{fut}_\ell, t)$". The equation says currentPool at level l+1 is a function of the futurePool. Line 5182 then correctly says "transfers a percentage of nextPrizePool to futurePrizePool."
- **Contract:** DegenerusGameAdvanceModule.sol, `_applyTimeBasedFutureTake` (line 1073-1148). The extraction function operates on `nextPrizePool`, skimming a fraction into `futurePrizePool`. The remaining nextPool becomes currentPool via `consolidatePrizePools`.
- **Mismatch:** The equation references the wrong pool. It says $f(P^{fut}_\ell, t)$ but the actual input is the nextPool, not the futurePool. The prose on the very next line is correct. A reader who takes the equation literally would misunderstand the core pool flow: they would think the futurepool is being drained into the current pool, when in fact the nextpool is being skimmed with proceeds going to the futurepool.
- **Severity:** Major

#### GM-07: Extraction function "Days 0-12" label inconsistency

- **Paper:** App. C, "Days 0-12 (level fills within 12 days): flat at 30% + level bonus."
- **Contract:** DegenerusGameAdvanceModule.sol, `_nextToFutureBps` (line 1045). The function uses an 11-day offset from levelStartTime. Flat 30% applies when elapsed <= 1 day, meaning the level completed within 12 days of start.
- **Mismatch:** "Days 0-12" implies 13 days (0 through 12 inclusive), but the parenthetical says "within 12 days." The contract gives flat 30% for levels completing in 12 or fewer days. "Within 12 days" matches the contract; "Days 0-12" does not if read literally as 13 distinct days. The subsequent intervals (12-25, 25-39) are consistent with a 12-day boundary.
- **Severity:** Minor

#### GM-08: Turbo jackpot compression mode undocumented

- **Paper:** S5.4 / App. C describes compressed jackpot phase as "3 days" when purchase phase lasted 3 days or fewer.
- **Contract:** DegenerusGameAdvanceModule.sol, lines 333-351. Two compression modes exist: `compressedJackpotFlag=1` (3 physical days when target met within 3 purchase days) and `compressedJackpotFlag=2` (turbo: all 5 logical jackpot days run in 1 physical day when target met on day 0-1).
- **Mismatch:** Paper omits turbo mode entirely. When the pool target is met on the first or second day of a level, the contract runs all 5 logical jackpot days in a single advanceGame call. This is a meaningful behavioral difference that affects how fast levels can cycle.
- **Severity:** Minor

#### GM-09: Jackpot phase 3-day trigger condition wording

- **Paper:** S5.4, "If the purchase phase lasted 3 days or fewer, the jackpot phase compresses to 3 days."
- **Contract:** DegenerusGameAdvanceModule.sol, line 335: `if (day - purchaseStartDay <= 3) { compressedJackpotFlag = 1; }`. This fires when the target is met within 3 days of the purchase start.
- **Mismatch:** Paper says "purchase phase lasted 3 days or fewer." Contract checks `day - purchaseStartDay <= 3`, which means the target was met within 3 days of the purchase start. These are functionally similar but the paper's phrasing ("lasted 3 days") suggests a completed duration, while the contract checks elapsed days at the moment the target is reached.
- **Severity:** Minor

#### GM-10: Purchase-phase lootbox reward 50% ticket conversion detail omitted

- **Paper:** App. C (line 4277), "Three-quarters of this is converted to lootbox tickets."
- **Contract:** DegenerusGameJackpotModule.sol, `payDailyJackpot` early-burn path (lines 612-638). `PURCHASE_REWARD_JACKPOT_LOOTBOX_BPS = 7500` (75%) is the lootbox allocation. However, `ticketConversionBps = 5000` (50%) means only half the budget generates ticket counts; the full budget flows to nextPool to improve pool backing ratio.
- **Mismatch:** Paper correctly states 75% is converted to lootbox tickets. But the actual ticket count is sized at 50% of the budget (the other 50% is pool backing). A reader calculating expected ticket counts from the paper would overestimate by 2x. The economic effect is that each ticket is 2x ETH-backed compared to a naively-computed amount.
- **Severity:** Info

#### GM-11: Boon expiry simplification

- **Paper:** App. C (line 5353), "Lootbox boons expire in 2 days"
- **Contract:** DegenerusGameBoonModule.sol, lines 27-30. Coinflip and lootbox boost expire in 2 days; purchase boost and deity pass boon expire in 4 days.
- **Mismatch:** Paper uses "2 days" as blanket expiry for all lootbox boons, but 2 of 8 boon categories (purchase boost and deity pass boon) expire in 4 days instead.
- **Severity:** Minor

### Appendix G: Lootbox Reward Paths / Degenerette / Coinflip

#### GM-12: Lootbox level targeting probabilities

- **Paper:** App. G, "95%: 0 to 5 levels ahead (uniform)" and "5%: 5 to 50 levels ahead (uniform)"
- **Contract:** DegenerusGameLootboxModule.sol, lines 825-837. `rangeRoll = levelEntropy % 100; if (rangeRoll < 10)` gives 10% far-future, 90% near-future.
- **Mismatch:** Paper states 95%/5% near/far split. Contract implements 90%/10% near/far split. Players relying on the paper's stated 95%/5% split would overestimate the frequency of near-level tickets and underestimate far-future tickets by a factor of 2.
- **Severity:** Major

#### GM-13: Lootbox level targeting near-future range

- **Paper:** App. G, "95%: 0 to 5 levels ahead (uniform)"
- **Contract:** DegenerusGameLootboxModule.sol, line 834. `levelOffset = levelEntropy % 5` gives 0 to 4 levels ahead (5 outcomes: 0, 1, 2, 3, 4).
- **Mismatch:** Paper says "0 to 5 levels ahead" which implies 6 outcomes (0, 1, 2, 3, 4, 5). Contract implements 0 to 4 levels ahead (5 outcomes). The phrase "0 to 5" is ambiguous: it could mean "up to 5" (exclusive upper bound) or "0 through 5" (inclusive). However, if read as inclusive, the paper overstates the range by one level.
- **Severity:** Info

### Appendix E.4: BURNIE Coverage Gate

No discrepancies found. Verified in Appendix C clean sections (BURNIE coverage gate drip rate matches 0.75%/day).

## Sections With No Discrepancies Found

- **S2.3 (Cross-Subsidy Mechanism):** Ticket 90/10 and lootbox 10/90 next/future splits verified correct. Presale lootbox 50/30/20 split confirmed as known carve-out.
- **S2.5 (Hero Symbol):** Most-wagered symbol auto-wins its quadrant, VRF-derived color, per-quadrant tracking is implementation detail consistent with paper. Verified correct.
- **S3.4 (Whale Bundles):** Whale bundle pricing (2.4-4 ETH), deity pass base price (24 ETH), deity cap (32), all match. Verified correct.
- **S4.2 (Permissionless Execution):** All 6 claims about advanceGame() access control verified: permissionless entry, 0.005 ETH bounty, same/previous day purchase gate, deity bypass, 15-min pass holder window, 30-min open window.
- **S4.3 (Solvency Invariant):** Five tracked pools confirmed. Structural invariant (claimablePool <= ETH + stETH balance) verified.
- **S5.3 (Commitment Devices):** Auto-rebuy bonuses 30%/45% (13000/14500 BPS) match. Century bonus mints formula and 20 ETH cap match.
- **S6.1 (Ticket Pricing / BURNIE Cost):** Full PriceLookupLib price schedule (0.01-0.24 ETH) and 1,000 BURNIE per ticket cost verified. Exact match.
- **S6.2 (Decimator):** 50/50 ETH/lootbox split, bucket assignment (12 default / 5 min / 2 min x00), burn weight multiplier (1.0x to 1.7833x, paper's ~1.8x valid), trigger schedule (x5 at 10%, x00 at 30%, not at x95) all verified correct.
- **S8.3 (BURNIE Price Floor):** No mechanism claims in scope contracts beyond coverage gate (verified under App. E.4).
- **S10.1 (Terminal Math):** Death clock (120 days / 365 at level 0), deity refund (20 ETH before level 10), terminal decimator (10%), terminal jackpot (90% with 60/40 solo/spread split), final sweep (30 days) all verified correct.
- **App. A (Parameter Table):** All verified parameters match except stETH yield split (GM-04). Ticket price range, activity score range, lootbox EV range, bootstrap pool, timeouts, coinflip references all correct.
- **App. B (Jackpot Distribution):** JACKPOT_LEVEL_CAP=5, daily pool 6-14% uniform + 100% day 5, trait-bucket shares (20x4 + solo days 1-4, 60/13/13/14 day 5), BURNIE jackpot 0.5% target with 75/25 near/far, early-bird 3% futurePool, daily drip 1% futurePool all verified correct.
- **App. C (Extraction Function components):** All 8 components match: U-shape base rate, century ramp, x9 boost, ratio adjustment, overshoot surcharge, additive variance, multiplicative variance, 80% cap. VRF request/fulfill separation, 12-hour timeout, 3-day historical fallback, emergency rotation all verified.
- **App. D (Attack Vectors):** Degenerette ETH cap (10% futurepool per spin) verified correct.
- **App. E.4 (BURNIE Coverage Gate):** Drip rate 0.75%/day (DECAY_RATE=0.9925) verified correct.
- **App. F (Common Misreadings):** Factual claims about Game/Modules contracts checked. No discrepancies beyond GNRUS omission already captured in GM-03.
- **App. G (Degenerette):** All 9 multiplier values, 25/75 payout split, 10% pool drain cap, EV normalization, ROI curve [0.90, 0.999], +5% ETH bonus, DGNRS rewards on 6+ matches all verified correct.
- **App. G (Lootbox reward paths):** Reward path probabilities (55/10/10/25), ticket base budget (161%), all 5 ticket variance tiers, BURNIE variance ranges (low/high), presale BURNIE bonus (62%), DGNRS tier draw rates, boon budget (10% capped at 1 ETH), split threshold (0.5 ETH) all verified correct.

## Known Non-Issues (Not Flagged)

Per CLAUDE.md and MEMORY.md, the following were verified and intentionally not flagged as discrepancies:

1. **stETH yield split 50/25/25 vs 46/23/23:** The ~8% contract buffer is an implementation detail. GM-04 flags the paper saying 25/25/25/25 (which IS wrong), not the buffer.
2. **VAULT_PERPETUAL_TICKETS=16 vs "4 tickets":** Units difference (entries vs purchases due to `<<2`). Not an error.
3. **SS9.3 futurepool value (800) is post-drawdown:** The paper's math is correct.
4. **"Zero-rake" presale carve-out:** 20% vault allocation during presale is a known and documented exception.
5. **Unaffiliated player commissions to vault:** Known technical carve-out.
6. **Burn weight ~1.8x vs 1.7833x:** Paper's tilde notation covers the 0.02 difference.

## Deferred Verifications (Phase 16)

| Claim | Paper Location | Contract | Deferred To |
|-------|---------------|----------|-------------|
| DGNRS distribution 20/35/20/10/10/5 | S4.1 | DegenerusStonk | Phase 16 |
| Soulbound mechanics, afKing, 10 ETH takeProfit | S4.1 | DegenerusStonk | Phase 16 |
| Deity boon granting "3 per day" limit | App. C | Deity/Quest contracts | Phase 16 |
