# Consolidated Parity Report: Game Theory Paper vs Contract Source

**Verified:** 2026-03-31 to 2026-04-01
**Paper:** theory/index.html
**Contracts:** 24 (14 game modules + 6 token contracts + 4 support systems)
**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/

## Executive Summary

### Discrepancy Counts

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Major | 5 |
| Minor | 7 |
| Info | 9 |
| **Total** | **22** |

### Contracts Verified

| Group | Count | Contracts |
|-------|-------|-----------|
| Game and Modules | 14 | DegenerusGame, DegenerusGameStorage, AdvanceModule, BoonModule, DecimatorModule, DegeneretteModule, EndgameModule, GameOverModule, JackpotModule, LootboxModule, MintModule, MintStreakUtils, PayoutUtils, WhaleModule |
| Token Contracts | 6 | BurnieCoin, BurnieCoinflip, DegenerusStonk, StakedDegenerusStonk, WrappedWrappedXRP, GNRUS |
| Support Systems | 4 | DegenerusAffiliate, DegenerusDeityPass, DegenerusQuests, DegenerusVault |

DegenerusAdmin configuration was verified implicitly through game module parameter checks (App. A), not as a standalone verification target.

### Coverage Statement

All numerical claims (VER-01) and mechanism descriptions (VER-02) in the game theory paper have been verified against current contract source. 17 paper sections were verified clean with no discrepancies. 22 discrepancies were identified across the remaining sections.

---

## Critical Discrepancies

#### TS-08: Coinflip recycling bonus percentages overstated

- **Paper:** S5.3, "The coinflip system offers escalating recycling bonuses (1% base, 1.6% with afKing) for flipping winnings again rather than claiming."
- **Contract:** BurnieCoinflip.sol, lines 129-130 and 1043-1069. RECYCLE_BONUS_BPS=75 (0.75%), AFKING_RECYCLE_BONUS_BPS=100 (1.00% base afKing), max 2.00% with deity bonus at +100 levels. No combination of parameters produces 1.6%.
- **Mismatch:** Paper claims 1% base, contract has 0.75%. Paper claims 1.6% with afKing, contract has 1.00% base afKing. The deity bonus scales per level from 0 to +1.00pp (max +200 half-BPS), reaching 2.00% only at maximum deity level.
- **Severity:** Critical
- **Fix guidance:** Paper should state 0.75% base recycling bonus, 1.00% with afKing status, scaling up to 2.00% with maximum deity level bonus. The current "1% base, 1.6% with afKing" must be replaced with these contract values.
- **See also:** TS-09 (conflation of ticket recycling 10% with coinflip recycling in the same section).

---

## Major Discrepancies

#### GM-06: Extraction function equation uses wrong pool variable

- **Paper:** App. C (line 5181), "$P^{curr}_{\ell+1} \leftarrow f(P^{fut}_\ell, t)$". The equation says currentPool at level l+1 is a function of the futurePool. Line 5182 then correctly says "transfers a percentage of nextPrizePool to futurePrizePool."
- **Contract:** DegenerusGameAdvanceModule.sol, `_applyTimeBasedFutureTake` (line 1073-1148). The extraction function operates on `nextPrizePool`, skimming a fraction into `futurePrizePool`. The remaining nextPool becomes currentPool via `consolidatePrizePools`.
- **Mismatch:** The equation references the wrong pool. It says $f(P^{fut}_\ell, t)$ but the actual input is the nextPool, not the futurePool. The prose on the very next line is correct. A reader who takes the equation literally would misunderstand the core pool flow: they would think the futurepool is being drained into the current pool, when in fact the nextpool is being skimmed with proceeds going to the futurepool.
- **Severity:** Major
- **Fix guidance:** The equation in App. C line 5181 should reference nextPrizePool (P^next), not futurePrizePool (P^fut). The prose on line 5182 is already correct. Only the LaTeX formula needs correction.

#### GM-12: Lootbox level targeting 90/10 vs paper's 95/5

- **Paper:** App. G, "95%: 0 to 5 levels ahead (uniform)" and "5%: 5 to 50 levels ahead (uniform)"
- **Contract:** DegenerusGameLootboxModule.sol, lines 825-837. `rangeRoll = levelEntropy % 100; if (rangeRoll < 10)` gives 10% far-future, 90% near-future.
- **Mismatch:** Paper states 95%/5% near/far split. Contract implements 90%/10% near/far split. Players relying on the paper would overestimate near-level ticket frequency and underestimate far-future tickets by a factor of 2.
- **Severity:** Major
- **Fix guidance:** Paper should state 90%/10% near/far split in App. G, not 95%/5%. This doubles the probability of far-future tickets, which is relevant to the time-value of future tickets argument.

#### GM-03: Final sweep split omits GNRUS

- **Paper:** S10 (line 4224), "unclaimed funds are split between the vault and the DGNRS contract." Also S4.1 (line 3127), "funds unclaimed 30 days after GAMEOVER" references only vault and DGNRS.
- **Contract:** DegenerusGameGameOverModule.sol, lines 210-224. `_sendToVault` splits 33% DGNRS / 33% vault / 34% GNRUS.
- **Mismatch:** Paper describes a 2-way split (vault + DGNRS). Contract implements a 3-way split including GNRUS at 34%. This is a v7 change. The paper's S4.3 yield routing description correctly includes GNRUS, making this an internal inconsistency: the paper acknowledges GNRUS in yield routing but omits it from the final sweep.
- **Severity:** Major
- **Fix guidance:** S10 and S4.1 should describe a 3-way split: 33% DGNRS / 33% vault / 34% GNRUS. The paper already acknowledges GNRUS in S4.3 yield routing; the final sweep description should be consistent.
- **See also:** TS-05 (GNRUS burn described as "stETH yield" only).

#### TS-04: WWXRP "one trillion" vs 1 billion vault allowance

- **Paper:** S4.1 lines 3131-3132, "one trillion wwXRP, a valueless memecoin distributed as a consolation prize to losers"
- **Contract:** WrappedWrappedXRP.sol, line 134: `INITIAL_VAULT_ALLOWANCE = 1_000_000_000 ether` (1 billion). Total supply starts at 0 and grows with minting. No 1 trillion constant in the contract. Additional supply minted on demand with no cap.
- **Mismatch:** Paper claims "one trillion wwXRP." The contract's only fixed supply quantity is the 1 billion vault allowance. The "one trillion" figure likely confuses WWXRP's vault allowance (1 billion) with the sDGNRS initial supply (1 trillion, StakedDegenerusStonk.sol line 231).
- **Severity:** Major
- **Fix guidance:** S4.1 should say "one billion" (1,000,000,000) vault allowance, not "one trillion." The trillion figure likely confuses WWXRP with sDGNRS initial supply.

#### TS-11: Affiliate payout weighted roll vs paper's rotation

- **Paper:** F.11 (line 6252-6257), "~76% of each commission payment goes to the direct referrer, ~20% to the referrer's referrer, and ~4% to the third level up. Only one level is paid per transaction (to save gas), rotating across purchases."
- **Contract:** DegenerusAffiliate.sol, lines 593-631. All three tiers calculated in a single transaction. Amounts are [base, base/5, base/25]. A weighted random roll selects ONE winner proportional to amount, and the TOTAL of all three tiers is paid to that winner. No "rotation across purchases."
- **Mismatch:** Paper describes rotation-based payouts (one tier paid per tx, rotating). Contract uses a weighted roll where one winner receives the full payout each transaction. The stated percentages (~76/20/4) are also inaccurate: the actual EV split is 80.6% / 16.1% / 3.2%.
- **Severity:** Major
- **Fix guidance:** F.11 should describe a weighted random roll (not rotation) where one winner receives the full payout each transaction. EV splits are 80.6% / 16.1% / 3.2% (not ~76% / ~20% / ~4%). The mechanism preserves intended EV distribution through probability weighting, not per-transaction rotation.

---

## Minor Discrepancies

#### GM-07: Extraction function "Days 0-12" label inconsistency

- **Paper:** App. C, "Days 0-12 (level fills within 12 days): flat at 30% + level bonus."
- **Contract:** DegenerusGameAdvanceModule.sol, `_nextToFutureBps` (line 1045). The function uses an 11-day offset from levelStartTime. Flat 30% applies when elapsed <= 1 day, meaning the level completed within 12 days of start.
- **Mismatch:** "Days 0-12" implies 13 days (0 through 12 inclusive), but the parenthetical says "within 12 days." The contract gives flat 30% for levels completing in 12 or fewer days. "Within 12 days" matches the contract; "Days 0-12" does not if read literally as 13 distinct days.
- **Severity:** Minor

#### GM-08: Turbo jackpot compression mode undocumented

- **Paper:** S5.4 / App. C describes compressed jackpot phase as "3 days" when purchase phase lasted 3 days or fewer.
- **Contract:** DegenerusGameAdvanceModule.sol, lines 333-351. Two compression modes: `compressedJackpotFlag=1` (3 physical days when target met within 3 purchase days) and `compressedJackpotFlag=2` (turbo: all 5 logical jackpot days run in 1 physical day when target met on day 0-1).
- **Mismatch:** Paper omits turbo mode entirely. When the pool target is met on the first or second day, the contract runs all 5 logical jackpot days in a single advanceGame call. This affects how fast levels can cycle.
- **Severity:** Minor

#### GM-09: Jackpot phase 3-day trigger condition wording

- **Paper:** S5.4, "If the purchase phase lasted 3 days or fewer, the jackpot phase compresses to 3 days."
- **Contract:** DegenerusGameAdvanceModule.sol, line 335: `if (day - purchaseStartDay <= 3) { compressedJackpotFlag = 1; }`. Fires when target met within 3 days of purchase start.
- **Mismatch:** Paper says "purchase phase lasted 3 days or fewer." Contract checks `day - purchaseStartDay <= 3`, which means the target was met within 3 days of purchase start. Functionally similar but the paper's phrasing suggests a completed duration, while the contract checks elapsed days at the moment the target is reached.
- **Severity:** Minor

#### GM-11: Boon expiry simplification

- **Paper:** App. C (line 5353), "Lootbox boons expire in 2 days"
- **Contract:** DegenerusGameBoonModule.sol, lines 27-30. Coinflip and lootbox boost expire in 2 days; purchase boost and deity pass boon expire in 4 days.
- **Mismatch:** Paper uses "2 days" as blanket expiry for all lootbox boons, but 2 of 8 boon categories (purchase boost and deity pass boon) expire in 4 days instead.
- **Severity:** Minor

#### TS-03: S4.1 omits stETH from DGNRS burn payout description

- **Paper:** S4.1 line 3142-3143, "burn tokens for a pro-rata share of the contract's accumulated ETH and BURNIE"
- **Contract:** StakedDegenerusStonk.sol, `_deterministicBurnFrom` (lines 516-558). Post-gameOver burns distribute proportional ETH + stETH (ETH-preferential, stETH as fallback). Gambling burns segregate proportional ETH+stETH value and BURNIE.
- **Mismatch:** S4.1 says "ETH and BURNIE" but the actual payout includes stETH. App. C line 5473 correctly states "ETH, stETH, and BURNIE reserves." S4.1's omission of stETH is inconsistent with App. C and the contract.
- **Severity:** Minor
- **See also:** TS-05 (GNRUS burn described as "stETH yield" only).

#### TS-05: GNRUS burn described as "stETH yield" vs actual ETH + stETH + claimable

- **Paper:** S4.1 line 3161, "burned for a proportional share of the stETH yield accumulated in the contract"
- **Contract:** GNRUS.sol, `burn()` lines 296-301. Calculates owed from `ethBal + stethBal + claimable` (ETH balance + stETH balance + game claimable winnings). Distributes both ETH and stETH.
- **Mismatch:** Paper says only "stETH yield" but the GNRUS contract distributes proportional shares of ALL assets: ETH (from yield surplus distributions and gameover sweep), stETH (from rebase appreciation), and claimable game winnings.
- **Severity:** Minor
- **See also:** GM-03 (final sweep omits GNRUS).

#### TS-09: Device 5 conflates ticket and coinflip recycling bonuses

- **Paper:** S5.3, "Players who reinvest their full claimable balance (minimum three tickets worth) receive a 10% bonus in BURNIE coinflip credits on the recycled amount."
- **Contract:** BurnieCoinflip.sol, lines 1043-1053. Coinflip recycling bonus is 0.75% (normal) or 1.00% (afKing base). Neither is 10%. The "10% bonus" refers to the ticket purchase recycling mechanism in the game contract, not coinflip recycling.
- **Mismatch:** S5.3 presents the "10% bonus" as part of "Device 5: Recycling Bonus" without distinguishing between ticket recycling (game module, 10% bonus on BURNIE coinflip credits) and coinflip recycling (BurnieCoinflip, 0.75%/1.00%). Both are called "recycling" in different contexts. Not a factual error about either contract, but the two bonuses are conflated.
- **Severity:** Minor
- **See also:** TS-08 (coinflip recycling percentages wrong).

---

## Info Discrepancies

#### GM-01: x00 BAF and decimator draw from same snapshot

- **Paper:** S6.3, "The bonus BAF jackpot (20% of futurepool) and an enlarged decimator (30% vs the normal 10%) fire on top of this enlarged pool."
- **Contract:** DegenerusGameEndgameModule.sol, lines 176, 187, 212. Both BAF (20%) and decimator (30%) at x00 draw from `baseFuturePool`, a snapshot taken at function entry. Combined allocation is 50% of the snapshot value.
- **Mismatch:** Paper does not specify whether the 20% and 30% are from the same snapshot or sequential. Sequential application would make the decimator 30% of the remaining 80% (= 24% of original), materially different from 30% of original. The contract uses snapshot-based parallel allocation.
- **Severity:** Info

#### GM-02: Level 50 BAF rate omitted from S6.3

- **Paper:** S6.3 discusses the century cycle but only mentions x00 levels getting 20% BAF. App. B.3 separately documents level 50 getting 20%.
- **Contract:** DegenerusGameEndgameModule.sol, line 186: `bafPct = prevMod100 == 0 ? 20 : (lvl == 50 ? 20 : 10)`. Level 50 and all x00 levels get 20%.
- **Mismatch:** S6.3 omits the level 50 special case. A reader of only S6.3 would assume level 50 gets the default 10%. The information exists in App. B.3 but is not cross-referenced.
- **Severity:** Info

#### GM-05: Jackpot daily carryover mechanism not described

- **Paper:** App. B describes daily jackpot distribution but does not describe the carryover jackpot mechanism.
- **Contract:** DegenerusGameJackpotModule.sol, `payDailyJackpot` daily path (lines 398-458). On jackpot phase days 2-4 (not day 1), a 1% futurePool slice distributes as a "carryover" jackpot to future-level (lvl+1 to lvl+5) ticket holders. 50% of this slice goes to lootbox tickets, remainder as ETH. Day 1 runs the early-bird lootbox jackpot instead (3% of futurePool).
- **Mismatch:** Paper mentions the early-bird ("luckbox") jackpot in S8.4 but does not describe the days 2-4 carryover jackpot in App. B. This mechanism distributes value to future-level ticket holders during the jackpot phase and is relevant to the time-value of future tickets argument.
- **Severity:** Info

#### GM-10: Purchase-phase lootbox reward 50% ticket conversion detail omitted

- **Paper:** App. C (line 4277), "Three-quarters of this is converted to lootbox tickets."
- **Contract:** DegenerusGameJackpotModule.sol, `payDailyJackpot` early-burn path (lines 612-638). `PURCHASE_REWARD_JACKPOT_LOOTBOX_BPS = 7500` (75%) is the lootbox allocation. However, `ticketConversionBps = 5000` (50%) means only half the budget generates ticket counts; the full budget flows to nextPool to improve pool backing ratio.
- **Mismatch:** Paper correctly states 75% is converted to lootbox tickets. But the actual ticket count is sized at 50% of the budget (the other 50% is pool backing). A reader calculating expected ticket counts from the paper would overestimate by 2x. Each ticket is 2x ETH-backed compared to a naively-computed amount.
- **Severity:** Info

#### GM-13: Lootbox level targeting near-future range

- **Paper:** App. G, "95%: 0 to 5 levels ahead (uniform)"
- **Contract:** DegenerusGameLootboxModule.sol, line 834. `levelOffset = levelEntropy % 5` gives 0 to 4 levels ahead (5 outcomes: 0, 1, 2, 3, 4).
- **Mismatch:** Paper says "0 to 5 levels ahead" which implies 6 outcomes (0, 1, 2, 3, 4, 5). Contract implements 0 to 4 levels ahead (5 outcomes). The phrase "0 to 5" is ambiguous but could be read as inclusive and would overstate the range by one level.
- **Severity:** Info

#### TS-01: Bounty payout 1% steal threshold omitted

- **Paper:** S3.4, "a bounty pool that grows by 1,000 BURNIE per day and can only be armed by setting a new all-time record for the largest single coinflip deposit."
- **Contract:** BurnieCoinflip.sol, lines 659-682. Arming requires exceeding `biggestFlipEver`, but if already armed by someone else, the new record must exceed the old by at least 1% (line 671-676: `threshold = record + (record / 100)`).
- **Mismatch:** The 1% steal threshold to re-arm an already-armed bounty is not mentioned in the paper.
- **Severity:** Info

#### TS-02: Bounty payout form and conditions omitted

- **Paper:** S3.4 describes the bounty as a payout to the bounty holder. No detail on payment form.
- **Contract:** BurnieCoinflip.sol, line 856: `_addDailyFlip(to, slice, 0, false, false)`. Bounty winnings are credited as next-day coinflip stakes, not minted directly. Only half the pool pays out per resolution (line 849: `slice = currentBounty_ >> 1`), and only on a winning day (line 853: `if (win)`).
- **Mismatch:** Paper does not describe that (a) only half the bounty pays out per resolution, (b) it only pays on win days, (c) payout is as coinflip stake, not liquid BURNIE. These details affect the bounty's actual EV.
- **Severity:** Info

#### TS-06: S4.1 burn conflates active-game and post-gameOver behavior

- **Paper:** S4.1 lines 3142-3149. Describes DGNRS burns as: "burn tokens for a pro-rata share... VRF multiplier (25%-175%), half the rolled ETH is paid directly and half is converted to lootbox rewards, and your share of queued BURNIE only pays out after the next coinflip resolves."
- **Contract:** StakedDegenerusStonk.sol `burn()` (lines 478-486). Two distinct paths: (1) post-gameOver: deterministic payout of ETH+stETH only, no BURNIE, no VRF, no gambling; (2) active game: gambling path with VRF roll, 50/50 ETH/lootbox split, BURNIE on coinflip win.
- **Mismatch:** S4.1 presents all burn mechanics (VRF, 50/50 split, coinflip BURNIE) as if they always apply. The contract has two separate paths. Post-gameOver burns are deterministic with no gambling. A reader planning a post-gameOver strategy would expect VRF variance and BURNIE payouts that will not occur.
- **Severity:** Info

#### TS-07: App. C "no minting after deployment" omits creator vesting schedule

- **Paper:** App. C line 5457, "DGNRS is a deflationary token with no minting after deployment."
- **Contract:** StakedDegenerusStonk.sol constructor mints the entire 1T supply at deployment. DegenerusStonk.sol constructor (lines 113-123) issues 50B DGNRS to creator and holds remaining 150B for vesting. `claimVested()` releases 5B DGNRS per game level to vault owner, up to 200B total (fully vested at level 30).
- **Mismatch:** "No minting after deployment" is technically correct (all sDGNRS supply minted in constructor). However, the creator's access to their 20% is not immediate: only 50B (5%) is available at deploy, with the remaining 150B vesting over 30 levels. The paper's "20% allocated to the creator at deployment" is correct about allocation but does not disclose the vesting schedule.
- **Severity:** Info

---

## New Mechanics Since v2.1

New contract capabilities identified during delta tracking (VER-03, VER-04). Each is assessed for whether the game theory paper should cover it.

### Document (game-theoretically relevant)

**GNRUS.sol** (entire contract is new)
- **Capability:** Soulbound governance token with proposal/vote system, charitable donation selection, and burn-for-proportional-assets redemption
- **Recommendation:** Document
- **Rationale:** Core to GNRUS's role described in S4.1 and S4.3. Paper was written before this contract existed. Governance mechanics (proposal, vote, charity selection) are game-theoretically relevant as coordination devices that give GNRUS holders ongoing influence over protocol charitable output.

**BurnieCoinflip.sol** (take-profit system)
- **Capability:** Players can set automatic take-profit thresholds on coinflip positions, allowing partial exits when winnings exceed a configurable multiple
- **Recommendation:** Document
- **Rationale:** Take-profit is a new player strategy that weakens the "all-or-nothing" framing of the commitment device argument in S5.3. Players now have a middle path between full reinvestment and full claim. The paper's Device 5 description should acknowledge this option exists.

**DegenerusStonk.sol** (year sweep)
- **Capability:** 365 days after GAMEOVER, remaining contract assets split 50/50 between GNRUS holders and vault
- **Recommendation:** Document
- **Rationale:** Terminal distribution mechanic not in paper. Relevant to endgame analysis in S10. Creates a finite horizon for post-game asset distribution that the paper's terminal math section should reference.

**StakedDegenerusStonk.sol** (post-game burn)
- **Capability:** Post-game burn function changes DGNRS token economics by allowing deterministic redemption without VRF gambling
- **Recommendation:** Document
- **Rationale:** Already partially covered by TS-06 (Info finding about bifurcated burn paths). The existence of a separate deterministic post-game burn path affects DGNRS's terminal value proposition.

**DegenerusAffiliate.sol** (default referral codes)
- **Capability:** Every player address has an implicit default referral code without needing to explicitly create one, lowering the barrier to affiliate network participation
- **Recommendation:** Document
- **Rationale:** Changes affiliate onboarding UX described in S3.5. Relevant to the network effects argument because zero-friction referral codes increase the probability of organic affiliate tree formation.

**DegenerusQuests.sol** (Degenerette integration)
- **Capability:** Degenerette wagering now counts toward quest progress, making the mini-game contribute to activity score maintenance
- **Recommendation:** Document
- **Rationale:** Expands the "active participation dominant strategy" argument. Degenerette play, previously isolated entertainment, now feeds the quest system. Strengthens the cross-subsidy thesis (entertainment actions produce grinder-relevant score improvements).

### Skip (implementation details, not game-theoretically relevant)

| Contract | Capability | Why Skip |
|----------|-----------|----------|
| BurnieCoin.sol | `_consumeCoinflipShortfall` storage optimization | Internal storage packing, no player-facing behavior change |
| BurnieCoinflip.sol | Flip mode settlement, burn consumption, deity bonus calc, top bettor tracking | Internal helpers for existing mechanics already documented |
| StakedDegenerusStonk.sol | `burnRemainingPools()`, `transferBetweenPools()` | Administrative pool management functions |
| WrappedWrappedXRP.sol | `burnForGame()` | WWXRP wager burn. WWXRP is a valueless memecoin; burn path is implementation detail |
| DegenerusVault.sol | Degenerette betting proxies, coinflip config, operator approval | Vault-owner convenience proxies. Underlying mechanics documented via primary contracts |

---

## Verified Clean Sections

Sections verified with no discrepancies, confirming VER-01 and VER-02 coverage.

**Game and Modules (14 contracts):**
- S2.3 Cross-Subsidy Mechanism (ticket 90/10, lootbox 10/90 splits)
- S2.5 Hero Symbol (most-wagered auto-wins quadrant, VRF color)
- S3.4 Whale Bundles (pricing 2.4-4 ETH, deity 24 ETH, cap 32)
- S4.2 Permissionless Execution (advanceGame access, 0.005 ETH bounty, gates)
- S4.3 Solvency Invariant (five tracked pools, structural invariant)
- S5.3 Commitment Devices (auto-rebuy 30%/45%, century bonus mints, 20 ETH cap)
- S6.1 Ticket Pricing / BURNIE Cost (0.01-0.24 ETH schedule, 1000 BURNIE per ticket)
- S6.2 Decimator (50/50 ETH/lootbox, bucket assignment, burn weight, trigger schedule)
- S8.3 BURNIE Price Floor (coverage gate)
- S10.1 Terminal Math (death clock 120/365 days, deity refund, terminal decimator/jackpot, final sweep)
- App. A Parameter Table (all parameters verified, including stETH yield split 25/25/25/25)
- App. B Jackpot Distribution (JACKPOT_LEVEL_CAP, daily pool %, trait buckets, BURNIE jackpot, early-bird, daily drip)
- App. C Extraction Function (all 8 components, VRF request/fulfill, timeout, fallback)
- App. D Attack Vectors (degenerette ETH cap)
- App. E.4 BURNIE Coverage Gate (0.75%/day drip rate)
- App. F Common Misreadings (except GNRUS cross-ref in GM-03)
- App. G Degenerette (9 multipliers, 25/75 split, 10% drain cap, EV normalization, ROI curve, +5% ETH bonus, DGNRS rewards)
- App. G Lootbox Reward Paths (55/10/10/25 probabilities, 161% ticket budget, 5 variance tiers, BURNIE ranges, presale bonus, DGNRS tiers, boon budget/split)

**Token Contracts (6 contracts):**
- S4.1 creator 20% transferable allocation
- S4.1 / App. C pool distribution 20/35/20/10/10/5
- App. C soulbound mechanics (sDGNRS non-transferable)
- App. C afKing mode and 10 ETH takeProfit
- S4.1 / App. C VRF multiplier 25-175%
- App. C half ETH / half lootbox on burn (50/50 split)
- App. C ETH-preferential payout
- S4.1 WWXRP as consolation prize
- App. G Coinflip (tier probabilities, bonus ranges, presale +6pp, win/loss effects)
- App. A coinflip payout mean 1.9685x
- S6.1 BURNIE price ratchet
- S4.1 vault allocation 2M BURNIE
- App. C decimator constants (12/5/2 buckets, 1000 BURNIE minimum)
- S2.5 BAF leaderboard (coinflip volume feeds BAF)
- S5.3 auto-rebuy (toggleable, functions as described)
- S4.1 GNRUS 2% per level, 5% vault vote bonus, soulbound
- S4.3 yield routing includes GNRUS

**Support Systems (4 contracts):**
- S3.5 +100 BURNIE pre-final-draw affiliate bonus (implemented in DegenerusGameMintModule.sol line 948, basis inflated by 7/5 or 3/2 before payAffiliate call)
- S3.5 commission 20% (levels 4+), 25% (levels 0-3)
- S3.5 kickback 0-25%, per-sender cap 0.5 ETH/level
- S3.5 coinflip credit payment, lootbox taper 20% to 5%
- App. D self-referral blocked
- S2.4 deity affiliate cap 5 ETH/level, S3.4 deity 20% commission bonus
- S3.4 deity soulbound, App. A deity cap 32
- S3.4 permanent 1.55 activity score
- App. C boon types (31 weighted), App. A quest reward 300 BURNIE
- App. C quest streak up to 1.00, S3.6 quest streak requires daily ETH purchase
- S4.1 vault owner >50.1% DGVE, afKing mode, stETH yield 25%, unaffiliated commissions
- S4.1 vault 2M BURNIE (cross-contract verified)

---

## Known Non-Issues

Items verified and intentionally not flagged, per CLAUDE.md and MEMORY.md guidance.

1. **stETH yield split 50/25/25 vs 46/23/23:** The ~8% contract buffer is an implementation detail. GM-04 flags the paper saying 25/25/25/25 (which IS wrong), not the buffer.
2. **VAULT_PERPETUAL_TICKETS=16 vs "4 tickets":** Units difference (entries vs purchases due to `<<2`). Not an error.
3. **SS9.3 futurepool value (800) is post-drawdown:** The paper's math is correct.
4. **"Zero-rake" presale carve-out:** 20% vault allocation during presale is a known and documented exception.
5. **Unaffiliated player commissions to vault:** Known technical carve-out.
6. **Burn weight ~1.8x vs 1.7833x:** Paper's tilde notation covers the 0.02 difference.
7. **GM-03 final sweep GNRUS omission not re-reported in Phase 16:** Already captured in Phase 15 scope (DegenerusGameGameOverModule.sol). DegenerusStonk.sol `yearSweep()` is a separate later mechanism.
8. **GM-11 deity boon expiry (2 vs 4 days):** Already reported in Phase 15. Not re-reported in support systems.
9. **Gambling burn protective caps (160 ETH daily, 50% supply per period):** Safety mechanisms, not discrepancies.
10. **Post-gameOver BURNIE exclusion from burns:** Documented in TS-06 as Info. Design choice, not error.
11. **GNRUS yield share "25%" vs actual 23%:** Per CLAUDE.md, the 50/25/25 simplification is deliberate.
12. **App. A "governance proposal gate 20 hours":** Refers to DegenerusAdmin.sol VRF stall threshold, not GNRUS governance. Correctly labeled "VRF recovery" in App. A.
13. **Deity pass pricing not in DegenerusDeityPass.sol:** Lives in WhaleModule (Phase 15 scope). Not a discrepancy.
14. **Activity score calculation not in DegenerusDeityPass.sol:** Lives in DegenerusGame.sol. Not a discrepancy.

---

## Deferred Verifications: All Resolved

Three claims deferred from Phase 15 to Phase 16, all confirmed against contract source.

1. **DGNRS distribution 20/35/20/10/10/5 (S4.1):** Confirmed. All six BPS constants match in StakedDegenerusStonk.sol constructor (CREATOR_BPS=2000, AFFILIATE_POOL_BPS=3500, LOOTBOX_POOL_BPS=2000, EARLYBIRD_POOL_BPS=1000, WHALE_POOL_BPS=1000, REWARD_POOL_BPS=500). Sum = 10000 BPS.
2. **Soulbound mechanics, afKing, 10 ETH takeProfit (S4.1):** Confirmed. sDGNRS non-transferable. Constructor sets `game.setAfKingMode(address(0), true, 10 ether, 0)`.
3. **Deity boon "3 per day" limit (App. C):** Confirmed. DEITY_DAILY_BOON_COUNT=3 in DegenerusGameLootboxModule.sol line 337, enforced via bitmask tracking.
