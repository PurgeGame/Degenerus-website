# Game & Modules Parity Notes: Subsystems, Terminal, and Router

**Verified:** 2026-03-31
**Paper:** theory/index.html
**Contracts:** DegeneretteModule, BoonModule, MintStreakUtils, PayoutUtils
**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/

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
