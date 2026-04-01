# Game & Modules Parity Notes: Subsystems, Terminal, and Router

**Verified:** 2026-03-31
**Paper:** theory/index.html
**Contracts verified:** 7 (DegeneretteModule, BoonModule, MintStreakUtils, PayoutUtils, EndgameModule, GameOverModule, DegenerusGame.sol)
**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Major | 1 |
| Minor | 1 |
| Info | 1 |
| **Total** | **3** |
**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/
**Delta-v7 cross-referenced:** DegeneretteModule (18 functions), GameOverModule (4 functions), EndgameModule (1 function), DegenerusGame (2 functions)

---

## DegeneretteModule (DegenerusGameDegeneretteModule.sol)

**Status:** COMPLETE

**Delta-v7 cross-reference:** DegeneretteModule had 18 functions modified in v7 (the highest-risk contract for parity). The delta-v7 audit (Phase 128, Plan 02) gave all 18 functions SAFE verdicts. The key v7 change was a freeze-path fix: during pool freeze, degenerette ETH bets now route through pending pools (lines 562-568) instead of writing to live pools. This is an implementation detail not described in the paper (nor should it be). No pre-v7 paper language was found that conflicts with current behavior.

### Multiplier table (App. G)

Paper (line 6922-6968) lists base multipliers at 100% ROI:

| Matches | Paper | Contract (QUICK_PLAY_BASE_PAYOUTS_PACKED, lines 280-291) |
|---------|-------|----------------------------------------------------------|
| 0 | 0x | 0 (match) |
| 1 | 0x | 0 (match) |
| 2 | 1.90x | 190 centi-x (match) |
| 3 | 4.75x | 475 centi-x (match) |
| 4 | 15x | 1500 centi-x (match) |
| 5 | 42.5x | 4250 centi-x (match) |
| 6 | 195x | 19500 centi-x (match) |
| 7 | 1,000x | 100000 centi-x (match) |
| 8 (jackpot) | 100,000x | QUICK_PLAY_BASE_PAYOUT_8_MATCHES = 10,000,000 centi-x (match) |

All 9 multiplier values match exactly. No discrepancy.

### Payout split 25/75 (App. G, line 6970)

Paper: "Degenerette wins pay 25% as direct ETH (capped at 10% of the futurepool) and 75% as lootbox rewards."

Contract (`_distributePayout`, lines 724-774):
- `ethPortion = payout / 4` (25%)
- `lootboxPortion = payout - ethPortion` (75%)
- ETH cap: `maxEth = (pool * ETH_WIN_CAP_BPS) / 10_000` where `ETH_WIN_CAP_BPS = 1_000` (10%)
- Excess above cap added to lootbox portion

All three claims verified. No discrepancy.

### Pool drain cap (App. D.2, App. A line 4888-4891)

Paper: "Degenerette ETH cap: 10% of futurepool" (App. A) and "ETH payouts are hard-capped at 10% of the futurepool per spin" (S5500-5507).

Contract: `ETH_WIN_CAP_BPS = 1_000` (line 228) applied per payout in `_distributePayout` (line 752): `maxEth = (pool * ETH_WIN_CAP_BPS) / 10_000`.

Match. Note: the cap applies to the 25% ETH portion of each payout, not the total payout. The paper's "per spin" is accurate since each spin resolves independently. No discrepancy.

### EV normalization (App. G, line 6971-6975)

Paper: "Payouts are further adjusted by EV normalization: a product-of-ratios correction ensures equal expected value across all trait combinations regardless of the non-uniform weight distribution."

Contract (`_evNormalizationRatio`, lines 843-886): Implements exact product-of-ratios normalization across 4 quadrants. Per quadrant, trait weights are computed (bucket 0-3 = 10, 4-6 = 9, 7 = 8), and for each match outcome (both-match, one-match, no-match) the ratio of uniform probability to actual probability is computed. The product of 4 quadrant ratios normalizes the payout. Applied at line 1000-1004.

Match. The implementation is more detailed than the paper's description but consistent. No discrepancy.

### Hero symbol override (S2.5, lines 5404-5429)

Paper claims (S5406-5408):
1. "The symbol that received the most ETH wagered in Degenerette bets that day" -- selection by wager amount
2. "This symbol auto-wins its own quadrant" -- scope is quadrant
3. "With a random color still determined by VRF, replacing only that one quadrant's outcome" -- override mechanism

Contract verification:
1. Hero symbol tracking: `dailyHeroWagers[day][heroQuadrant]` accumulates wager amounts per symbol (lines 496-511). Uses `wagerUnit = totalBet / 1e12` for storage efficiency. ETH bets only (`currency == CURRENCY_ETH`).
2. Hero quadrant: The hero system operates per-quadrant (4 quadrants, each with 8 symbols). The most-wagered symbol within each quadrant becomes that quadrant's hero.
3. Override in payout: `_applyHeroMultiplier` (lines 1020-1046) checks if the hero quadrant's color AND symbol both match, applying a boost if yes and a penalty (95%) if no. This is EV-neutral per match count via the constraint `P(hero|M) * boost(M) + (1-P(hero|M)) * penalty = 1`.

The paper's wording about hero symbol is slightly simplified. The paper says "the symbol that received the most ETH wagered" and "auto-wins its own quadrant." The contract actually tracks per-quadrant hero symbols (not a single global hero). Each quadrant has its own most-wagered symbol. The paper's description in S2.5 implies a single global hero symbol that affects one quadrant, while the contract tracks heroes per quadrant (4 independent hero symbols). However, the hero payout adjustment (`_applyHeroMultiplier`) only applies to the single quadrant the player chose (`heroQuadrant` parameter). The paper's description is functionally correct for any individual bet: the player picks one quadrant and the hero for that quadrant affects the payout.

No discrepancy flagged. The per-quadrant tracking is an implementation detail consistent with the paper's simplified description.

### ROI curve (App. C, lines 5329-5330)

Paper: "Degenerette ROI rho: [0, 3.05] -> [0.90, 0.999], mapped piecewise (quadratic near zero, linear at higher scores)."

Contract (`_roiBpsFromScore`, lines 1160-1189):
- Score 0 to 7500 BPS (0-0.75): Quadratic from 9000 BPS (90%) to 9500 BPS (95%)
- Score 7500 to 25500 BPS (0.75-2.55): Linear from 9500 BPS (95%) to 9950 BPS (99.5%)
- Score 25500 to 30500 BPS (2.55-3.05): Linear from 9950 BPS (99.5%) to 9990 BPS (99.9%)

Paper says [0.90, 0.999]. Contract range is 9000/10000 to 9990/10000 = [0.90, 0.999]. Match.
Paper says "quadratic near zero, linear at higher scores." Contract: quadratic 0-0.75, then two linear segments. Match.

No discrepancy.

### ETH bonus (App. C, line 5336)

Paper: "ETH Degenerette bets receive a +5% ETH bonus on high-match outcomes"

Contract: `ETH_ROI_BONUS_BPS = 500` (line 217, = 5%). Applied via `_wwxrpBonusRoiForBucket` for matches >= 5 (lines 980-989). The bonus ROI is redistributed into high-match buckets using the WWXRP bonus factor constants, concentrating the +5% into 5+ match outcomes.

Match. No discrepancy.

### DGNRS rewards on 6+ matches (App. G, line 6971)

Paper: "6+ match outcomes also earn bonus DGNRS."

Contract (`_awardDegeneretteDgnrs`, lines 1226-1251): Awards sDGNRS from Reward pool for 6, 7, or 8 match ETH bets. Rates: 4% per ETH (6 matches), 8% (7 matches), 15% (8 matches), applied to pool balance, capped at 1 ETH bet amount.

Match. No discrepancy.

---

## BoonModule (DegenerusGameBoonModule.sol)

**Status:** COMPLETE

### Boon categories (App. C, lines 5350-5352)

Paper: "They come in 10 categories, each with tiered variants: coinflip boosts, lootbox boosts, purchase boosts (discounted ticket or lootbox prices), decimator boosts, whale pass discounts, activity score bonuses, deity pass discounts, whale pass grants, and lazy pass discounts."

Contract categories verified in BoonModule:
1. Coinflip boon (slot0, `consumeCoinflipBoon`, tiers: 500/1000/2500 BPS)
2. Lootbox boon (slot0, `checkAndClearExpiredBoon`, lootbox tier field)
3. Purchase boost (slot0, `consumePurchaseBoost`, tiers: 500/1500/2500 BPS)
4. Decimator boost (slot0, `consumeDecimatorBoost`, tiers: 1000/2500/5000 BPS)
5. Whale (slot0, whale day tracking)
6. Activity boon (slot1, `consumeActivityBoon`, adds to level count and quest streak)
7. Deity pass boon (slot1, deity pass tier)
8. Lazy pass boon (slot1, lazy pass day tracking)

Paper lists 10 categories. The BoonModule handles 8 boon types in its packed slots. The remaining categories (whale pass grants and whale pass discounts) are distinct from the whale boon tracked here. The boon granting logic itself lives in LootboxModule (where the 31 weighted types are defined), and BoonModule handles consumption only. The paper's "10 categories" count is a statement about the granting side. Since this plan verifies BoonModule specifically, the consumption side shows 8 distinct boon fields. The granting-side category count is verified through LootboxModule (Phase 15, Plan 01/02 scope).

No discrepancy flagged against BoonModule specifically.

### Boon expiry (App. C, lines 5353-5354)

Paper: "Lootbox boons expire in 2 days; deity-granted boons expire same day."

Contract constants:
- `COINFLIP_BOON_EXPIRY_DAYS = 2` (line 27)
- `LOOTBOX_BOOST_EXPIRY_DAYS = 2` (line 28)
- `PURCHASE_BOOST_EXPIRY_DAYS = 4` (line 29)
- `DEITY_PASS_BOON_EXPIRY_DAYS = 4` (line 30)

The paper says "lootbox boons expire in 2 days" which matches the lootbox boost expiry. But purchase boosts expire in 4 days and deity pass boons expire in 4 days, not 2. The paper's blanket statement "lootbox boons expire in 2 days" is a simplification. Since lootbox-originated boons include coinflip (2 days), lootbox boost (2 days), purchase (4 days), and deity pass (4 days), the paper's "2 days" is accurate for some but not all lootbox boon categories.

For deity-granted boons, the paper says "expire same day." The contract uses a `deityDay` field that checks `deityDay != currentDay` for expiry (e.g., line 50-53 for coinflip, lines 75-78 for purchase). This means deity boons expire at the end of the day they're granted, which matches "expire same day."

#### GM-01: Boon expiry simplification

- **Paper:** App. C (line 5353), "Lootbox boons expire in 2 days"
- **Contract:** DegenerusGameBoonModule.sol, lines 27-30. Coinflip and lootbox boost expire in 2 days; purchase boost and deity pass boon expire in 4 days.
- **Mismatch:** Paper uses "2 days" as blanket expiry for all lootbox boons, but 2 of 8 boon categories expire in 4 days instead.
- **Severity:** Minor

### Deity boon granting rate (App. C, lines 5354-5355)

Paper: "Deity pass holders can grant boons directly to other players (up to 3 per day)"

This claim is about the granting mechanism, which lives in the deity/quest system, not BoonModule. BoonModule handles consumption only. The "3 per day" limit is enforced at the granting side. Verification of this specific constant defers to the deity system contracts (out of scope for this plan; covered by Phase 16).

No discrepancy flagged. Noted as deferred verification.

### Boon budget (App. G, lines 6916-6919)

Paper: "10% of each lootbox's EV-scaled amount is allocated to boon generation before the reward roll."

This claim is about LootboxModule's boon allocation, not BoonModule. BoonModule only consumes boons. The 10% budget allocation is verified through LootboxModule (Phase 15, Plan 01/02 scope).

No discrepancy flagged against BoonModule.

---

## MintStreakUtils (DegenerusGameMintStreakUtils.sol)

**Status:** COMPLETE

### Activity score purchase streak component (App. C, lines 5315-5322)

Paper: Activity score formula includes `min(m_i/50, 1) * 0.50` where m_i is "the purchase streak (consecutive levels with ETH purchases)."

Contract (`_mintStreakEffective`, lines 49-61 in MintStreakUtils): Tracks consecutive level streaks. If `lastCompleted + 1 == mintLevel`, streak increments. Otherwise resets to 1. The streak is used in `_playerActivityScoreInternal` (DegeneretteModule, lines 1067-1140):
- `streakPoints = streak > 50 ? 50 : streak` (capped at 50)
- `bonusBps = streakPoints * 100` (so 50 * 100 = 5000 BPS = 0.50)

This matches the paper's `min(m_i/50, 1) * 0.50`: streak capped at 50, contribution of 0.50 max.

### Mint count component (App. C, line 5319)

Paper: `min(c_i/L, 1) * 0.25` where c_i is "the purchase count (total levels with purchases)" and L is current level.

Contract (`_mintCountBonusPoints`, lines 1142-1153 in DegeneretteModule):
- `if (mintCount >= currLevel) return 25;`
- Otherwise: `(mintCount * 25) / currLevel`
- Then: `bonusBps += mintCountPoints * 100` (so 25 * 100 = 2500 BPS = 0.25)

This matches `min(c_i/L, 1) * 0.25`. No discrepancy.

No discrepancies found for MintStreakUtils.

---

## PayoutUtils (DegenerusGamePayoutUtils.sol)

**Status:** COMPLETE

PayoutUtils is a helper library providing:
1. `_creditClaimable` -- credits ETH to a player's claimable balance
2. `_calcAutoRebuy` -- calculates auto-rebuy ticket conversion for jackpot payouts
3. `_queueWhalePassClaimCore` -- queues deferred whale pass claims

No paper claims reference PayoutUtils directly. The functions are verified through their calling modules (EndgameModule, DegeneretteModule). The auto-rebuy bonus values (13000 BPS = 130%, 14500 BPS = 145% for afKing) are used in EndgameModule line 284-285, which correspond to the paper's "30%/45% auto-rebuy bonuses" claim in S5.3 (130% tickets = 30% bonus, 145% = 45% bonus). This verification is covered in Plan 01/02 scope where MintModule handles the base auto-rebuy flow.

No discrepancies found for PayoutUtils.

---

## EndgameModule (DegenerusGameEndgameModule.sol)

**Status:** COMPLETE

**Delta-v7 cross-reference:** EndgameModule had 1 function changed in v7 (Phase 128, Plan 01). The change was a storage/gas fix, not a behavioral change relevant to paper claims. No pre-v7 paper language found that conflicts with current behavior.

**Note:** Despite the contract name "EndgameModule," this contract primarily handles BAF/Decimator reward jackpots during level transitions, affiliate DGNRS rewards, and whale pass claims. The death clock and GAMEOVER liveness guards are in AdvanceModule, and the terminal distribution is in GameOverModule. The paper's terminal mechanics are verified across these contracts.

### BAF jackpot trigger schedule (verified, not a paper claim for this plan)

Contract verifies the schedule described in EndgameModule comments (lines 160-171):
- BAF fires every 10 levels: 10% of futurepool (20% at level 50 and every 100th level)
- Decimator fires at 5, 15, 25, 35, 45, 55, 65, 75, 85 (not 95): 10% of futurepool (30% at every 100th level)

These are verified through JackpotModule/DecimatorModule in Plans 01-02. Included here to confirm EndgameModule's role as dispatcher.

### Auto-rebuy bonus (PayoutUtils cross-reference)

EndgameModule uses auto-rebuy bonuses of 13000 BPS (130% = 30% bonus) and 14500 BPS (145% = 45% bonus for afKing mode) at line 284-285. This corresponds to the paper's S5.3 claim about "30%/45% auto-rebuy bonuses." Verified through PayoutUtils integration.

No discrepancies found for EndgameModule.

---

## GameOverModule (DegenerusGameGameOverModule.sol)

**Status:** COMPLETE

**Delta-v7 cross-reference:** GameOverModule had 4 functions changed in v7. Key changes:
1. `handleGameOver` renamed to `burnAtGameOver` and moved before Path A early return (GH-01 fix, commit ba89d160)
2. `_sendToVault` updated to 33/33/34 three-way split (DGNRS/vault/GNRUS) per DRIFT 5 (commit e4833ac7)
3. GNRUS `burnAtGameOver` hook added

### Death clock duration (S10, line 4054-4056)

Paper: "The protocol reaches GAMEOVER if and only if the nextpool fails to reach its level target within 120 days of the previous level's completion. (Level 0 has a longer 365-day window to allow for bootstrapping.)"

Contract (AdvanceModule `_handleGameOverPath`, lines 471-473):
```
(lvl == 0 && ts - lst > uint256(DEPLOY_IDLE_TIMEOUT_DAYS) * 1 days) ||
(lvl != 0 && ts - 120 days > lst);
```
Where `DEPLOY_IDLE_TIMEOUT_DAYS = 365` (line 98).

Both values confirmed: 365 days at level 0, 120 days at level 1+. Match.

### Deity refund (S10, line 4215-4216)

Paper: "Deity pass refunds: 20 ETH/pass if GAMEOVER triggers before level 10; no refund at level 10+"

Contract (`handleGameOverDrain`, lines 52-53, 91-120):
- `DEITY_PASS_EARLY_GAMEOVER_REFUND = 20 ether`
- Conditional: `if (lvl < 10)` (before level 10)
- Iterates through `deityPassOwners`, refunds `refundPerPass * purchasedCount` per owner
- Budget-capped to `totalFunds - claimablePool`

Match. No discrepancy.

### Terminal decimator 10% (S10, line 4218-4219)

Paper: "Terminal decimator (10%): 10% of remaining assets distributed via decimator, weighted by BURNIE burned and activity score."

Contract (`handleGameOverDrain`, lines 156-166):
```
uint256 decPool = remaining / 10; // 10%
```
Calls `runTerminalDecimatorJackpot(decPool, lvl, rngWord)`. Refunds flow back to `remaining` for terminal jackpot.

Match. No discrepancy.

### Terminal jackpot 90% (S10, lines 4220-4223)

Paper: "Terminal jackpot (90%): 90% of remaining assets run through a final jackpot draw among next-level ticket holders, where a single winner takes 60% and the remaining 40% is distributed via further draws across all holders."

Contract (`handleGameOverDrain`, lines 168-175):
- After 10% decimator, `remaining` holds the remaining funds (90% minus any decimator refund, which flows back)
- Calls `runTerminalJackpot(remaining, lvl + 1, rngWord)` in JackpotModule
- `FINAL_DAY_SHARES_PACKED = [6000, 1333, 1333, 1334]` BPS in JackpotModule (line 117-120)
- 6000 BPS = 60% goes to the solo bucket (1 winner), remaining 40% spread across 3 other buckets

Match. The 60/40 split is verified. Note: the paper says "a single winner takes 60%." The contract's solo bucket has `winnerCount == 1` so exactly one winner gets 60%. The other 40% is distributed across 3 trait buckets with varying winner counts. Accurate.

### Final sweep 30 days (S10, line 4224)

Paper: "Final sweep: After 30 days, unclaimed funds are split between the vault and the DGNRS contract."

Contract (`handleFinalSweep`, lines 188-208):
- `block.timestamp < uint256(gameOverTime) + 30 days` (30-day timing confirmed)
- Calls `_sendToVault` which splits 33/33/34 to DGNRS, vault, and GNRUS (line 210, 217-224)

The 30-day timing matches. However, the split recipients do not match the paper.

#### GM-02: Final sweep split omits GNRUS

- **Paper:** S10 (line 4224), "unclaimed funds are split between the vault and the DGNRS contract"
- **Contract:** DegenerusGameGameOverModule.sol, lines 210-224. `_sendToVault` splits 33% DGNRS / 33% vault / 34% GNRUS.
- **Mismatch:** Paper describes a 2-way split (vault + DGNRS). Contract implements a 3-way split including GNRUS. This is a v7 change (DRIFT 5 in delta-v7 audit confirmed the 33/33/34 split was added in commit e4833ac7).
- **Severity:** Major

### Terminal distribution sequence (S10)

Paper describes 4 steps in order: deity refund, terminal decimator 10%, terminal jackpot 90%, final sweep 30 days.

Contract `handleGameOverDrain` sequence:
1. Deity refund (lines 91-120, only if `lvl < 10`)
2. Calculate available funds (line 123)
3. Set terminal flags (`gameOver = true`, line 125)
4. Burn unallocated GNRUS and sDGNRS tokens (lines 129-130)
5. Terminal decimator 10% (lines 156-166)
6. Terminal jackpot 90% (lines 168-179)
7. Undistributed remainder sent to vault/DGNRS/GNRUS (line 177-178)

Then separately, `handleFinalSweep` runs after 30 days (lines 188-208).

The sequence matches the paper's description. Steps 4 (token burns) and 7 (remainder routing) are implementation details not described in the paper but don't contradict it.

---

## DegenerusGame.sol (Core Router)

**Status:** COMPLETE

**Delta-v7 cross-reference:** DegenerusGame had 2 functions changed in v7 (Phase 128, Plan 03). Changes related to GNRUS integration. No behavioral change relevant to paper claims about the router.

### Permissionless execution (S4.2, lines 3164-3177)

Paper claims:
1. "Daily game logic executes when any player calls the permissionless advanceGame() function" (line 3165-3166)
2. "Caller receives a BURNIE bounty worth approximately 0.005 ETH" (line 3167)
3. "Primary calling path requires the caller to have made a purchase in the current or previous day" (line 3174)
4. "Deity pass holders bypass this requirement entirely" (line 3175)
5. "Other pass holders can trigger advancement after 15 minutes" (line 3176)
6. "After 30 minutes the call opens to anyone" (line 3177)

Contract verification:
1. `advanceGame()` (DegenerusGame.sol line 320, AdvanceModule line 139): `external` with no access control modifier. Permissionless confirmed.
2. `ADVANCE_BOUNTY_ETH = 0.005 ether` (AdvanceModule line 131). Match.
3. `_enforceDailyMintGate` (AdvanceModule lines 677-712): Checks `lastEthDay + 1 < gateIdx` for same-day/previous-day purchase. Match.
4. Deity bypass: `if (deityPassCount[caller] != 0) return;` (line 692). Match.
5. Pass holder 15-min: `if (elapsed >= 15 minutes)` + frozenUntilLevel check (lines 702-708). Match.
6. Anyone 30-min: `if (elapsed >= 30 minutes) return;` (line 699). Match.

All 6 claims verified against contract. No discrepancy.

### Solvency invariant (S4.3, lines 3178-3217)

Paper: "claimablePool <= ETH balance + stETH balance" is an accounting identity enforced by the structure of every function.

Paper claims five tracked pools: nextPrizePool, futurePrizePool, currentPrizePool, claimablePool, yieldAccumulator. Plus implicit sixth: untracked yield surplus.

Contract verification:
- `claimablePool` (Storage line 405): explicit state variable
- `nextPrizePool` / `futurePrizePool`: packed in Storage line 352
- `currentPrizePool` (Storage line 350)
- `yieldAccumulator` (Storage line 1385)
- Critical invariant declared in DegenerusGame.sol NatSpec (line 18): `address(this).balance + steth.balanceOf(this) >= claimablePool`

All five tracked pools confirmed. The invariant is structural (verified by the v5.0 audit and maintained through v7.0 changes per delta audit). The paper's description of how each transaction category preserves the invariant (deposits, jackpot payouts, claims, yield routing, accumulator distributions) is accurate.

No discrepancy.

### DGNRS distribution (S4.1, lines 5457-5471)

Paper claims: "20% creator, 35% affiliate, 20% lootbox, 10% earlybird, 10% whale, 5% reward"

These percentages are defined in the DegenerusStonk contract (separate from DegenerusGame). The Game router has no knowledge of these distribution percentages. Deferred to Phase 16 (DGNRS/Stonk verification).

### Soulbound, afKing, takeProfit (S4.1, lines 5472-5489)

Paper claims about sDGNRS being soulbound, afKing mode with 10 ETH takeProfit, and BURNIE coinflip credit. These are defined in DegenerusStonk and coinflip contracts, not the Game router. Deferred to Phase 16.

### App. F common misreadings (lines 5820+)

Paper App. F contains factual claims embedded in "what people get wrong" explanations. These were checked for claims referencing Game/Modules contracts in scope:

#### GM-03: Yield routing description omits GNRUS share

The paper's S4.3 yield routing description (line 3204-3207) says yield distributes "~25% to yieldAccumulator (non-obligated), and ~25% each to vault, DGNRS, and the GNRUS donation contract." This correctly describes the 4-way yield split including GNRUS. However, the final sweep description at S10 line 4224 omits GNRUS from the 3-way fund split. This is internally inconsistent: the paper acknowledges GNRUS exists in yield routing but omits it from the final sweep description.

- **Paper:** S10 (line 4224), "split between the vault and the DGNRS contract"
- **Contract:** DegenerusGameGameOverModule.sol, lines 210-224. Three-way split: DGNRS/vault/GNRUS.
- **Mismatch:** The paper's S4.1 (line 3127) also says "funds unclaimed 30 days after GAMEOVER" go to vault and DGNRS, consistent with the S10 omission. The yield routing section (S4.3) correctly includes GNRUS. The omission in S10 and S4.1 is a v7 update gap.
- **Severity:** Info (documented under GM-02 as the primary finding; this notes the secondary location)

---

## Deferred Verifications

The following claims reference contracts outside the Phase 15 scope:

| Claim | Paper Location | Deferred To |
|-------|---------------|-------------|
| DGNRS distribution 20/35/20/10/10/5 | S4.1 | Phase 16 (DegenerusStonk) |
| Soulbound mechanics, afKing, 10 ETH takeProfit | S4.1 | Phase 16 (DegenerusStonk) |
| Deity boon granting "3 per day" limit | App. C | Phase 16 (Deity/Quest contracts) |
| Boon budget "10%" allocation | App. G | Phase 15 Plans 01-02 (LootboxModule) |
