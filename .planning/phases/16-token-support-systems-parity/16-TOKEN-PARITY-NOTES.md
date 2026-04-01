# Token Contracts Parity Notes

**Verified:** 2026-03-31
**Paper:** theory/index.html
**Contracts:** BurnieCoin, BurnieCoinflip, DegenerusStonk, StakedDegenerusStonk, WrappedWrappedXRP, GNRUS
**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Major | 1 |
| Minor | 3 |
| Info | 4 |
| **Total** | **9** |

## Contracts Verified

| Contract | Status |
|----------|--------|
| BurnieCoin.sol | COMPLETE |
| BurnieCoinflip.sol | COMPLETE |
| DegenerusStonk.sol | COMPLETE |
| StakedDegenerusStonk.sol | COMPLETE |
| WrappedWrappedXRP.sol | COMPLETE |
| GNRUS.sol | COMPLETE |

## Discrepancies by Paper Section

### Section 3.4: Deity and Whale Pass Economics

#### TS-01: Bounty payout 1% steal threshold omitted

- **Paper:** S3.4, "a bounty pool that grows by 1,000 BURNIE per day and can only be armed by setting a new all-time record for the largest single coinflip deposit."
- **Contract:** BurnieCoinflip.sol, lines 659-682. Arming requires exceeding the all-time record (`biggestFlipEver`), but if the bounty is already armed by someone else, the new record must exceed the old by at least 1% (line 671-676: `threshold = record + (record / 100)`). The paper omits this 1% steal threshold.
- **Mismatch:** The 1% threshold to steal an armed bounty is not mentioned in the paper. The paper implies any new record arms the bounty.
- **Severity:** Info

#### TS-02: Bounty payout form and conditions omitted

- **Paper:** S3.4 describes the bounty as a payout to the bounty holder. No detail on payment form.
- **Contract:** BurnieCoinflip.sol, line 856: `_addDailyFlip(to, slice, 0, false, false)`. Bounty winnings are credited as next-day coinflip stakes, not minted directly to the holder's balance. Additionally, the bounty payout is half the pool (line 849: `slice = currentBounty_ >> 1`), and only pays on a winning day (line 853: `if (win)`).
- **Mismatch:** Paper does not describe that (a) only half the bounty pays out per resolution, (b) it only pays on win days, (c) payout is as coinflip stake, not liquid BURNIE. These details affect the bounty's actual EV significantly.
- **Severity:** Info

### Section 4.1: Creator Compensation

#### TS-03: S4.1 omits stETH from DGNRS burn payout description

- **Paper:** S4.1 line 3142-3143, "burn tokens for a pro-rata share of the contract's accumulated ETH and BURNIE"
- **Contract:** StakedDegenerusStonk.sol, `_deterministicBurnFrom` (lines 516-558). Post-gameOver burns distribute proportional ETH + stETH (ETH-preferential, stETH as fallback). Gambling burns (active game) segregate proportional ETH+stETH value and BURNIE. DegenerusStonk.sol `burn()` (line 227) receives ETH, stETH, and BURNIE from `stonk.burn()`.
- **Mismatch:** S4.1 says "ETH and BURNIE" but the actual payout includes stETH. App. C line 5473 correctly states "ETH, stETH, and BURNIE reserves." S4.1's omission of stETH is inconsistent with App. C and the contract. A reader of only S4.1 would not know stETH is part of the burn payout.
- **Severity:** Minor

#### TS-04: WWXRP supply claim "one trillion" does not match contract

- **Paper:** S4.1 lines 3131-3132, "one trillion wwXRP, a valueless memecoin distributed as a consolation prize to losers"
- **Contract:** WrappedWrappedXRP.sol, line 134: `INITIAL_VAULT_ALLOWANCE = 1_000_000_000 ether` (1 billion). Total supply starts at 0 and grows with minting. There is no 1 trillion constant anywhere in the contract. The vault reserve is 1 billion. Additional supply is minted on demand by authorized contracts (game, coin, coinflip) with no cap.
- **Mismatch:** Paper claims "one trillion wwXRP." The contract's only fixed supply quantity is the 1 billion vault allowance. There is no mechanism to pre-allocate or cap total supply at 1 trillion. The "one trillion" figure likely confuses WWXRP's vault allowance (1 billion) with the sDGNRS initial supply (1 trillion, from StakedDegenerusStonk.sol line 231: `INITIAL_SUPPLY = 1_000_000_000_000 * 1e18`).
- **Severity:** Major

#### TS-05: GNRUS burn "stETH yield" vs actual ETH + stETH + claimable distribution

- **Paper:** S4.1 line 3161, "burned for a proportional share of the stETH yield accumulated in the contract"
- **Contract:** GNRUS.sol, `burn()` lines 296-301. Calculates owed from `ethBal + stethBal + claimable` (ETH balance + stETH balance + game claimable winnings). Distributes both ETH (line 326) and stETH (line 323).
- **Mismatch:** Paper says only "stETH yield" but the GNRUS contract distributes proportional shares of ALL assets it holds: ETH (from yield surplus distributions and gameover sweep), stETH (from rebase appreciation), and claimable game winnings. A reader would expect only stETH in the redemption, but ETH is the primary asset distributed through yield surplus routing.
- **Severity:** Minor

### Section 4.1 / Appendix C: DGNRS Token Mechanics

#### TS-06: S4.1 burn description conflates active-game and post-gameOver behavior

- **Paper:** S4.1 lines 3142-3149. Describes DGNRS burns as: "burn tokens for a pro-rata share... VRF multiplier (25%-175%), half the rolled ETH is paid directly and half is converted to lootbox rewards, and your share of queued BURNIE only pays out after the next coinflip resolves."
- **Contract:** StakedDegenerusStonk.sol `burn()` (lines 478-486). Two distinct paths: (1) post-gameOver: deterministic payout of ETH+stETH only, no BURNIE, no VRF, no gambling (line 480-482); (2) active game: gambling path with VRF roll, 50/50 ETH/lootbox split, BURNIE on coinflip win (line 484). DegenerusStonk.sol `burn()` (line 229) is post-gameOver only (reverts with `GameNotOver` during active game).
- **Mismatch:** S4.1 presents all burn mechanics (VRF, 50/50 split, coinflip BURNIE) as if they always apply. The contract has two completely separate paths. Post-gameOver burns are deterministic with no gambling, no BURNIE, and no lootbox conversion. The paper does not mention this bifurcation. A reader planning a post-gameOver burn strategy would expect VRF variance and BURNIE payouts that will not occur.
- **Severity:** Info

#### TS-07: App. C "no minting after deployment" omits creator vesting schedule

- **Paper:** App. C line 5457, "DGNRS is a deflationary token with no minting after deployment."
- **Contract:** StakedDegenerusStonk.sol constructor mints the entire 1T supply at deployment (lines 300-301). No further minting functions exist. DegenerusStonk.sol constructor (lines 113-123) issues 50B DGNRS to creator and holds remaining 150B for vesting. `claimVested()` (lines 202-213) releases 5B DGNRS per game level to vault owner, up to 200B total (fully vested at level 30).
- **Mismatch:** "No minting after deployment" is correct for sDGNRS (entire supply minted in constructor). For DGNRS, the 200B wrapper tokens are all backed by sDGNRS minted at deployment, so no new minting occurs. However, the creator's access to their 20% is not immediate: only 50B (5% of total) is available at deploy, with the remaining 150B vesting over 30 levels. The paper's "20% of supply is allocated to the creator at deployment" (line 5457) is correct about allocation but does not disclose the vesting schedule.
- **Severity:** Info

### Section 5.3: Commitment Devices

#### TS-08: Coinflip recycling bonus percentages overstated in paper

- **Paper:** S5.3, "The coinflip system offers escalating recycling bonuses (1% base, 1.6% with afKing) for flipping winnings again rather than claiming."
- **Contract:** BurnieCoinflip.sol, lines 129-130 and 1043-1069
  - Normal recycling: `RECYCLE_BONUS_BPS = 75` = 0.75% (capped at 1,000 BURNIE per deposit)
  - afKing recycling (base, no deity): `AFKING_RECYCLE_BONUS_BPS = 100`, computed as `(amount * 200) / 20000` = 1.00%
  - afKing recycling (with max deity bonus at +100 levels): `(amount * (200 + 200)) / 20000` = 2.00%
- **Mismatch:** Paper claims 1% base, contract has 0.75%. Paper claims 1.6% with afKing, contract has 1.00% base afKing (no deity value matches 1.6%). The deity bonus scales per level from 0 to +1.00pp (max +200 half-BPS at AFKING_DEITY_BONUS_MAX_HALF_BPS). No combination of deity bonus levels produces exactly 1.6%.
- **Severity:** Critical

#### TS-09: Device 5 recycling bonus "10%" conflates ticket and coinflip recycling

- **Paper:** S5.3, "Players who reinvest their full claimable balance (minimum three tickets worth) receive a 10% bonus in BURNIE coinflip credits on the recycled amount."
- **Contract:** BurnieCoinflip.sol, lines 1043-1053. The coinflip recycling bonus is 0.75% (normal) or 1.00% (afKing base). Neither is 10%. The "10% bonus" likely refers to the ticket purchase recycling mechanism in the game contract's purchase module, not to the coinflip recycling bonus.
- **Mismatch:** S5.3 presents the "10% bonus" as part of "Device 5: Recycling Bonus" without distinguishing between ticket recycling (game module, 10% bonus on BURNIE coinflip credits) and coinflip recycling (BurnieCoinflip, 0.75%/1.00%). Both are called "recycling" in different contexts. Not a factual error about either contract, but the two bonuses are conflated in the text.
- **Severity:** Minor

## Sections With No Discrepancies Found

- **S4.1 creator 20% transferable allocation:** Matches contract exactly (DegenerusStonk.sol constructor).
- **S4.1 / App. C pool distribution percentages (20/35/20/10/10/5):** All six BPS constants match in StakedDegenerusStonk.sol.
- **App. C soulbound mechanics:** sDGNRS has no transfer functions. Correctly described.
- **App. C afKing mode and 10 ETH takeProfit:** Set in constructor exactly as described.
- **S4.1 / App. C VRF multiplier 25-175%:** Roll range and application match.
- **S4.1 / App. C half ETH / half lootbox on burn:** 50/50 split confirmed in claimRedemption.
- **App. C ETH-preferential payout:** Contract pays ETH first, stETH as fallback. Matches.
- **S4.1 WWXRP as consolation prize:** Minting mechanism confirmed. Amounts determined by callers.
- **App. G coinflip section:** All tier probabilities (5%/5%/90%), bonus ranges (50%/150%/78-115%), presale +6pp, and win/loss effects match contract exactly.
- **App. A coinflip payout mean 1.9685x:** Independently computed from contract constants and confirmed.
- **S6.1 BURNIE price ratchet:** Infrastructure verified in BurnieCoin.sol. Pricing constant in game module scope (verified Phase 15).
- **S4.1 vault allocation 2M BURNIE:** BurnieCoin.sol line 197 confirms 2M virtual vault reserve. Line 248 confirms 2M minted to sDGNRS.
- **App. C decimator constants (12/5/2):** All bucket assignment constants and minimum burn (1,000 BURNIE) confirmed.
- **S2.5 BAF leaderboard:** Coinflip volume feeds BAF leaderboard confirmed.
- **S5.3 auto-rebuy:** Mechanism exists, is toggleable, functions as described.
- **S4.1 GNRUS 2% per level:** DISTRIBUTION_BPS = 200 confirmed in GNRUS.sol.
- **S4.1 GNRUS 5% vault vote bonus:** VAULT_VOTE_BPS = 500 confirmed in GNRUS.sol.
- **S4.1 GNRUS soulbound:** transfer/transferFrom/approve all revert with TransferDisabled().
- **S4.3 yield routing includes GNRUS:** DegenerusGameJackpotModule.sol line 915 confirms GNRUS receives 23% (paper's 25%) of yield surplus.

## Known Non-Issues (Not Flagged)

1. **stETH yield split "50/25/25" simplification:** The ~8% contract buffer is an implementation detail. Not flagged per CLAUDE.md.
2. **VAULT_PERPETUAL_TICKETS=16 vs "4 tickets per level":** Units difference (entries vs purchases due to `<<2`). Not an error.
3. **GM-03 final sweep GNRUS omission:** Already reported in Phase 15 (DegenerusGameGameOverModule.sol scope). The DegenerusStonk.sol `yearSweep()` splits 50/50 to GNRUS and vault, a separate (later) mechanism. Not re-reported.
4. **Gambling burn protective caps (160 ETH daily, 50% supply per period):** Not in paper but these are safety mechanisms, not discrepancies.
5. **Post-gameOver BURNIE exclusion from burns:** Documented in TS-06 as Info. This is a design choice.
6. **Burn weight ~1.8x vs 1.7833x:** Paper's tilde notation covers the difference.
7. **GNRUS yield share "25%" vs actual 23%:** Per CLAUDE.md, the 50/25/25 simplification is deliberate.
8. **App. A "governance proposal gate 20 hours":** This refers to DegenerusAdmin.sol VRF stall threshold, not GNRUS governance. Correctly labeled "VRF recovery" in App. A.

## Changes Since v2.1

Compared current contract source against v2.1 EXTR-02 catalog (git commit b794035).

### GNRUS.sol (entirely new contract)

Not in v2.1 catalog. All 13 functions are new: transfer/transferFrom/approve (soulbound, revert), burn, burnAtGameOver, propose, vote, pickCharity, getProposal, getLevelProposals, receive, _mint.

### BurnieCoin.sol

**Removed:** `creditCoin`, `creditFlipBatch`, `mintForCoinflip`, `creditLinkReward`
**New:** `_toUint128` (private utility), `_consumeCoinflipShortfall` (consume for burn ops)
**Changed:** `burnCoin`/`decimatorBurn` now use `_consumeCoinflipShortfall` instead of claim-then-burn; Supply struct packs `totalSupply` + `vaultAllowance` in single slot (storage optimization)

### BurnieCoinflip.sol

**New:** `claimCoinflipsTakeProfit`, `setCoinflipAutoRebuyTakeProfit`, `settleFlipModeChange`, `consumeCoinflipsForBurn`, `_afKingDeityBonusHalfBpsWithLevel`, `_updateTopDayBettor`
**Changed:** `_afKingRecyclingBonus` now includes level-scaled deity bonus; auto-rebuy supports configurable take-profit thresholds

### DegenerusStonk.sol

**New:** `yearSweep()` (365-day post-gameOver 50/50 split to GNRUS+vault)
**Changed (per delta-v7, 2 functions):** `burn()` signature changed to return 3 values (ethOut, stethOut, burnieOut); `unwrapTo()` added VRF stall guard (>5h since last VRF blocks unwrap)

### StakedDegenerusStonk.sol

**New:** `burnRemainingPools()`, `burnAtGameOver()`, `transferBetweenPools(from, to, amount)`
**No functions removed.**

### WrappedWrappedXRP.sol

**New:** `burnForGame(from, amount)` (game burns for Degenerette WWXRP wagers)
**No functions removed.**

## Deferred Verifications Resolved

### Deferred #1: DGNRS distribution 20/35/20/10/10/5 (S4.1)

**Verdict: CONFIRMED.** StakedDegenerusStonk.sol constructor (lines 237-244) defines all six pool BPS constants matching exactly: CREATOR_BPS=2000, AFFILIATE_POOL_BPS=3500, LOOTBOX_POOL_BPS=2000, EARLYBIRD_POOL_BPS=1000, WHALE_POOL_BPS=1000, REWARD_POOL_BPS=500. Sum = 10000 BPS (100%).

### Deferred #2: Soulbound mechanics, afKing, 10 ETH takeProfit (S4.1)

**Verdict: CONFIRMED.** (a) sDGNRS has no transfer/transferFrom/approve. (b) Constructor calls `game.setAfKingMode(address(0), true, 10 ether, 0)`. (c) takeProfit = 10 ether. (d) VRF multiplier 25-175% confirmed in `resolveRedemptionPeriod` line 582. (e) 50/50 ETH/lootbox in `claimRedemption` lines 631-632.
