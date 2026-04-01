# Coinflip System + BURNIE Token Findings

**Verified:** 2026-03-31
**Contracts:** BurnieCoinflip.sol (1,159 lines), BurnieCoin.sol (945 lines)
**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/
**Paper:** theory/index.html

## Coinflip Tier Verification

### Contract Constants (BurnieCoinflip.sol)

From `processCoinflipPayouts()` (lines 802-886):

```
roll = seedWord % 20

roll == 0  -> rewardPercent = 50    (probability: 1/20 = 5%)
roll == 1  -> rewardPercent = 150   (probability: 1/20 = 5%)
roll 2-19  -> rewardPercent = (seedWord % 38) + 78  (probability: 18/20 = 90%)
```

Supporting constants (lines 126-127):
- `COINFLIP_EXTRA_MIN_PERCENT = 78`
- `COINFLIP_EXTRA_RANGE = 38`

Tier 3 range: [78, 78+37] = [78, 115] (since `seedWord % 38` yields 0-37, add 78 = 78-115).

### Paper Claims (App. G, lines 6984-7013)

- 5%: 50% bonus (1.5x total) -- **MATCH**
- 5%: 150% bonus (2.5x total) -- **MATCH**
- 90%: 78% to 115% bonus (1.78x to 2.15x total) -- **MATCH**

### Independent Payout Mean Computation

Using verified contract constants:

```
E[payout | win] = P(tier1) * mult(tier1) + P(tier2) * mult(tier2) + P(tier3) * mean(mult(tier3))

tier1: P = 1/20 = 0.05, bonus = 50%, multiplier = 1 + 0.50 = 1.50
tier2: P = 1/20 = 0.05, bonus = 150%, multiplier = 1 + 1.50 = 2.50
tier3: P = 18/20 = 0.90, bonus range = [78%, 115%], mean bonus = (78 + 115) / 2 = 96.5%
       mean multiplier = 1 + 0.965 = 1.965

E[payout | win] = 0.05 * 1.50 + 0.05 * 2.50 + 0.90 * 1.965
                = 0.075 + 0.125 + 1.7685
                = 1.9685
```

Paper (App. A, line 4902): "Coinflip win payout mean: 1.9685x" -- **MATCH**

Note: The tier 3 mean calculation assumes uniform distribution over the range [78, 115]. The contract uses `seedWord % 38` which produces values 0-37 uniformly, yielding percentages 78-115 uniformly. The mean of a discrete uniform distribution on [78, 115] is (78 + 115) / 2 = 96.5, confirming the computation.

### Open Question #2 Resolution

The EXTR-02 catalog stated "reward percent 50-156%" for the 90% tier. This was incorrect. The actual contract range is [78, 115] without presale bonus, [84, 121] with presale bonus. The "50-156%" range in EXTR-02 appears to have conflated all three tiers plus presale: the full range across ALL tiers WITH presale is [50, 156] (tier 1 = 50, tier 2 = 150+6 = 156, tier 3 = 78+6 to 115+6 = 84-121). The paper's per-tier breakdown is correct.

### Win Rate and Consolation

- Win rate: `(rngWord & 1) == 1` (line 834) = 50%. Paper (App. A, line 4896): "0.50" -- **MATCH**
- Presale bonus: `rewardPercent += 6` when presale active (lines 826-831). Paper (line 7013): "+6 percentage points" -- **MATCH**
- WWXRP consolation: `COINFLIP_LOSS_WWXRP_REWARD = 1 ether` (line 125), minted per loss via `wwxrp.mintPrize()` (line 613). Paper (line 7003): "1 WWXRP consolation" -- **MATCH**

## Findings

### TS-20: Coinflip recycling bonus percentages overstated in paper

- **Paper:** S5.3, "The coinflip system offers escalating recycling bonuses (1% base, 1.6% with afKing) for flipping winnings again rather than claiming."
- **Contract:** BurnieCoinflip.sol, lines 129-130 and 1043-1069
  - Normal recycling: `RECYCLE_BONUS_BPS = 75` = 0.75% (capped at 1,000 BURNIE per deposit)
  - afKing recycling (base, no deity): `AFKING_RECYCLE_BONUS_BPS = 100`, computed as `(amount * 200) / 20000` = 1.00%
  - afKing recycling (with max deity bonus at +100 levels): `(amount * (200 + 200)) / 20000` = 2.00%
- **Mismatch:** Paper claims 1% base, contract has 0.75%. Paper claims 1.6% with afKing, contract has 1.00% base afKing (no deity value matches 1.6%). The deity bonus scales per level from 0 to +1.00pp (max +200 half-BPS at AFKING_DEITY_BONUS_MAX_HALF_BPS). No combination of deity bonus levels produces exactly 1.6%.
- **Severity:** Critical

### TS-21: Device 5 recycling bonus "10%" refers to ticket recycling, not coinflip

- **Paper:** S5.3, "Players who reinvest their full claimable balance (minimum three tickets worth) receive a 10% bonus in BURNIE coinflip credits on the recycled amount."
- **Contract:** BurnieCoinflip.sol, lines 1043-1053. The coinflip recycling bonus is 0.75% (normal) or 1.00% (afKing base). Neither is 10%. The "10% bonus" likely refers to the ticket purchase recycling mechanism in the game contract's purchase module, not to the coinflip recycling bonus.
- **Mismatch:** S5.3 presents the "10% bonus" as part of "Device 5: Recycling Bonus" without distinguishing between ticket recycling (game module, 10% bonus on BURNIE coinflip credits) and coinflip recycling (BurnieCoinflip, 0.75%/1.00%). Both are called "recycling" in different contexts. Not a factual error about either contract, but the two bonuses are conflated in the text. The paper needs to clarify that these are two separate mechanisms.
- **Severity:** Minor

### TS-22: Bounty payout mechanism partially described

- **Paper:** S3.4, "a bounty pool that grows by 1,000 BURNIE per day and can only be armed by setting a new all-time record for the largest single coinflip deposit."
- **Contract:** BurnieCoinflip.sol, lines 659-682. Arming requires exceeding the all-time record (`biggestFlipEver`), but if the bounty is already armed by someone else, the new record must exceed the old by at least 1% (line 671-676: `threshold = record + (record / 100)`). The paper omits this 1% steal threshold.
- **Mismatch:** The 1% threshold to steal an armed bounty is not mentioned in the paper. The paper implies any new record arms the bounty.
- **Severity:** Info

### TS-23: Bounty payout is credited as flip stake, not direct mint

- **Paper:** S3.4 describes the bounty as a payout to the bounty holder. No detail on payment form.
- **Contract:** BurnieCoinflip.sol, line 856: `_addDailyFlip(to, slice, 0, false, false)`. Bounty winnings are credited as next-day coinflip stakes, not minted directly to the holder's balance. Additionally, the bounty payout is half the pool (line 849: `slice = currentBounty_ >> 1`), and only pays on a winning day (line 853: `if (win)`).
- **Mismatch:** Paper does not describe that (a) only half the bounty pays out per resolution, (b) it only pays on win days, (c) payout is as coinflip stake, not liquid BURNIE. These details affect the bounty's actual EV significantly.
- **Severity:** Info

## BurnieCoin.sol Verification

### Vault Allocation

- **Paper:** S4.1, "2 million BURNIE" in the shared list for vault and DGNRS.
- **Contract:** BurnieCoin.sol, line 197: `_supply = Supply({totalSupply: 0, vaultAllowance: uint128(2_000_000 ether)})` -- 2M virtual vault reserve. Line 248: `_mint(ContractAddresses.SDGNRS, 2_000_000 ether)` -- 2M minted to sDGNRS at construction.
- **Result:** No discrepancy. Both vault and sDGNRS receive 2M BURNIE as stated.

### BURNIE Price Ratchet (S6.1)

- **Paper:** S6.1, "1,000 BURNIE per ticket regardless of level."
- **Contract:** The 1,000 BURNIE per ticket constant lives in the game module (DegenerusGamePurchaseModule), not in BurnieCoin.sol or BurnieCoinflip.sol. BurnieCoin provides `burnCoin()` (line 752) which game modules call to deduct BURNIE during ticket purchases.
- **Result:** Not verifiable against these two contracts. The routing infrastructure (burnCoin) exists and is correctly permissioned. The pricing constant was verified in Phase 15 scope.

### BURNIE Price Floor (S8.3)

- **Paper:** S8.3, "1,000 BURNIE buys one ticket at any level."
- **Contract:** Same as above. BurnieCoin acts as the token layer. The price floor argument depends on the game module's pricing constant. BurnieCoin correctly implements burn/mint/transfer mechanics that support the price floor mechanism.
- **Result:** Infrastructure verified. Price floor logic is game module scope.

### Decimator Constants

- **Paper:** App. C, "default 12, drops to 5 at max activity on normal levels, drops to 2 at max activity on x00 levels."
- **Contract:** BurnieCoin.sol, lines 171-175:
  - `DECIMATOR_BUCKET_BASE = 12` -- **MATCH** (default 12)
  - `DECIMATOR_MIN_BUCKET_NORMAL = 5` -- **MATCH** (drops to 5)
  - `DECIMATOR_MIN_BUCKET_100 = 2` -- **MATCH** (drops to 2 at x00)
- **Paper:** "Minimum burn is 1,000 BURNIE."
- **Contract:** `DECIMATOR_MIN = 1_000 ether` (line 168) -- **MATCH**
- **Paper:** "burn weight multiplier (1.0x at zero activity to ~1.8x at maximum)"
- **Contract:** `_decimatorBurnMultiplier()` (lines 917-919): `BPS_DENOMINATOR + (bonusBps / 3)`. At max capped activity (23,500 BPS): `10000 + 7833 = 17833` BPS = 1.7833x. Paper's "~1.8x" covers this. -- **MATCH (known non-issue, not flagged)**
- **Result:** No discrepancy. All decimator constants in BurnieCoin.sol match paper claims.

### Decimator Activity Cap

- **Contract:** `DECIMATOR_ACTIVITY_CAP_BPS = 23_500` (line 178) = activity score cap of 2.35 for decimator scaling.
- **Paper:** Does not explicitly state the activity cap for decimator is 2.35, but this is consistent with the paper's general framework. The cap is below the max activity score (3.05), meaning the decimator does not benefit from activity above 2.35.
- **Result:** Info-level omission. Not flagged as discrepancy.

### Quest Integration Routing

- **Contract:** BurnieCoin.sol routes quest completions via `notifyQuestMint()` (line 665), `notifyQuestLootBox()` (line 697), `notifyQuestDegenerette()` (line 724), and `affiliateQuestReward()` (line 607). All call through to DegenerusQuests module and credit rewards as coinflip stakes via `IBurnieCoinflip.creditFlip()`.
- **Paper:** S2.5, "Every BURNIE reward in the protocol, from quest completions to affiliate commissions to jackpot draws, is awarded as daily coinflip credit."
- **Result:** No discrepancy. BurnieCoin correctly routes all quest rewards through to coinflip credit.

### Vault Escrow Mechanism

- **Contract:** BurnieCoin.sol, `vaultEscrow()` (line 571) increases vault mint allowance (virtual reserve). `vaultMintTo()` (line 588) mints from the allowance. The vault cannot accumulate circulating BURNIE: transfers to VAULT are converted to allowance increases (line 408-417).
- **Paper:** S4.1, describes vault receiving BURNIE. The mechanism (virtual reserve vs minted balance) is an implementation detail not contradicted by the paper.
- **Result:** No discrepancy.

### creditFlip Routing

- **Contract:** BurnieCoinflip.sol, `creditFlip()` (line 895) accepts calls from GAME, COIN, AFFILIATE, and ADMIN (via `onlyFlipCreditors` modifier, lines 194-203). Credits are added as next-day coinflip stakes via `_addDailyFlip()`.
- **Paper:** App. G mentions coinflip credits from affiliates. S3.5 says "Commission is paid as coinflip credits." The routing path is: DegenerusAffiliate -> BurnieCoinflip.creditFlip().
- **Result:** No discrepancy. creditFlip routing supports all claimed credit sources.

## Auto-Rebuy Verification

- **Paper:** S5.3, "auto-rebuy" described as a commitment device. Can be enabled/disabled.
- **Contract:** BurnieCoinflip.sol, `setCoinflipAutoRebuy()` (lines 693-769). Auto-rebuy is toggleable (enabled/disabled). When enabled, winnings roll into the next day's stake automatically. Take-profit threshold configurable. Blocked during RNG lock to prevent extraction before known outcomes.
- **Result:** No discrepancy. Auto-rebuy exists, is toggleable, functions as described.

## BAF Leaderboard Integration

- **Paper:** S2.5, "Players accumulate BAF score through cumulative BURNIE wagered on coinflips over each 10-level cycle." S3.4, "10% to the highest cumulative coinflip volume over the 10-level window."
- **Contract:** BurnieCoinflip.sol, `_claimCoinflipsInternal()` (line 572-599) records BAF flip credit via `jackpots.recordBafFlip()`. Only winning flips contribute to BAF. The leaderboard tracks daily top bettors via `_updateTopDayBettor()` (lines 1122-1133).
- **Result:** No discrepancy on mechanism. The contract confirms coinflip volume feeds BAF leaderboard.

## +100 BURNIE Pre-Final-Draw Bonus (S3.5)

- **Paper:** S3.5, "+100 BURNIE per ticket applies to affiliate commissions on fresh-ETH purchases on the day before the final jackpot draw."
- **Contract:** Not found in BurnieCoinflip.sol or BurnieCoin.sol. This bonus likely lives in the game purchase module or affiliate module, not the coinflip/token contracts.
- **Result:** Not verifiable against these two contracts. Will be verified in Plan 03 (support systems, DegenerusAffiliate.sol scope).

## Lost Coinflip BURNIE Recycling

- **Paper:** Does not explicitly describe what happens to BURNIE lost on coinflip.
- **Contract:** BurnieCoinflip.sol, `_depositCoinflip()` line 270: `burnie.burnForCoinflip(caller, amount)` burns the deposited BURNIE immediately. On loss, the stake is simply cleared (line 512: `coinflipBalance[cursor][player] = 0`) with no additional action beyond WWXRP consolation. Lost BURNIE is permanently burned from supply.
- **Result:** No discrepancy. The paper does not make incorrect claims about this; it simply does not detail the mechanic.

## Sections With No Discrepancies Found

- App. G coinflip section (lines 6984-7013): All tier probabilities, bonus ranges, presale modifier, and win/loss effects match contract exactly.
- App. A coinflip parameters (lines 4894-4903): Win rate 0.50 and payout mean 1.9685x independently verified and confirmed.
- S6.1 BURNIE price ratchet: Claims about BurnieCoin infrastructure are correct (routing exists, token mechanics sound). Pricing constant in game module scope.
- S4.1 vault allocation: 2M BURNIE to vault and sDGNRS confirmed.
- App. C decimator: All bucket assignment constants (12/5/2) and minimum burn (1,000 BURNIE) confirmed.
- S2.5 BAF leaderboard: Coinflip volume feeds BAF leaderboard confirmed.
- S5.3 auto-rebuy: Mechanism exists, is toggleable, functions as described.

## Known Non-Issues (Not Flagged)

- Burn weight ~1.8x vs 1.7833x: paper's tilde notation covers the difference (established in Phase 15 known non-issues).
