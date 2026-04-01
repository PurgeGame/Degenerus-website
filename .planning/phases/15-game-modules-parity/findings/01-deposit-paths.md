# Deposit Paths Parity Findings

**Verified:** 2026-03-31
**Paper:** theory/index.html
**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/

## Contracts Verified

| Contract | Lines | Status |
|----------|-------|--------|
| DegenerusGameStorage.sol | 1,625 | COMPLETE |
| DegenerusGameMintModule.sol | 1,113 | COMPLETE |
| DegenerusGameLootboxModule.sol | 1,787 | COMPLETE |
| DegenerusGameWhaleModule.sol | 826 | COMPLETE |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Major | 1 |
| Minor | 0 |
| Info | 2 |
| **Total** | **3** |

## Findings

### Appendix G: Product Mechanics Reference

#### GM-01: Lootbox level targeting probabilities

- **Paper:** App. G, "95%: 0 to 5 levels ahead (uniform)" and "5%: 5 to 50 levels ahead (uniform)"
- **Contract:** DegenerusGameLootboxModule.sol, lines 825-837. `rangeRoll = levelEntropy % 100; if (rangeRoll < 10)` gives 10% far-future, 90% near-future.
- **Mismatch:** Paper states 95%/5% near/far split. Contract implements 90%/10% near/far split.
- **Severity:** Major. The paper describes a different probability distribution than what is deployed. Players relying on the paper's stated 95%/5% split would overestimate the frequency of near-level tickets and underestimate far-future tickets by a factor of 2.

#### GM-02: Lootbox level targeting near-future range

- **Paper:** App. G, "95%: 0 to 5 levels ahead (uniform)"
- **Contract:** DegenerusGameLootboxModule.sol, line 834. `levelOffset = levelEntropy % 5` gives 0 to 4 levels ahead (5 outcomes: 0, 1, 2, 3, 4).
- **Mismatch:** Paper says "0 to 5 levels ahead" which implies 6 outcomes (0, 1, 2, 3, 4, 5). Contract implements 0 to 4 levels ahead (5 outcomes). The phrase "0 to 5" is ambiguous: it could mean "up to 5" (exclusive upper bound) or "0 through 5" (inclusive). However, if read as inclusive, the paper overstates the range by one level.
- **Severity:** Info. The paper's phrasing "0 to 5" with a contract range of 0-4 is ambiguous rather than clearly wrong. The practical difference (one additional level of forward reach) is minor. Resolving in paper's favor per D-09 guidance: "0 to 5" can reasonably be read as "within the next 5 levels" (i.e., offsets 0-4).

### Section 2.3 / Appendix C: Cross-Subsidy and Ticket/Lootbox Splits

No discrepancies found.

- Ticket split: Paper states "90% to the nextpool and 10% to the futurepool" (S2.3, line 2576, and App. C, line 5167-5168). The split is implemented in DegenerusGame.sol (not in the four contracts in scope), but the MintModule's lootbox split constants at lines 109-110 confirm the inverse: LOOTBOX_SPLIT_FUTURE_BPS=9000, LOOTBOX_SPLIT_NEXT_BPS=1000 (90% future, 10% next for lootboxes). Consistent with paper's "lootboxes split the opposite way (10% next, 90% future)" at line 2581.
- Presale lootbox split: LOOTBOX_PRESALE_SPLIT_FUTURE_BPS=5000, LOOTBOX_PRESALE_SPLIT_NEXT_BPS=3000, LOOTBOX_PRESALE_SPLIT_VAULT_BPS=2000 (50/30/20). The 20% vault allocation is a known presale carve-out per MEMORY.md. Not flagged.

### Section 6.1: BURNIE Price Ratchet

No discrepancies found.

- BURNIE cost per ticket: Paper states "1,000 BURNIE per ticket" (S6.1, line 3415). Contract PRICE_COIN_UNIT = 1000 ether (Storage line 123). MintModule line 904: `coinCost = (quantity * (PRICE_COIN_UNIT / 4)) / TICKET_SCALE`, where quantity is in scaled units with 4 entries per ticket purchase. Net cost per ticket purchase = 1000 BURNIE. Matches.
- Ticket price schedule: Paper chart function (lines 3427-3436) matches PriceLookupLib.priceForLevel() exactly:
  - Levels 0-4: 0.01 ETH
  - Levels 5-9: 0.02 ETH
  - Levels x01-x29 (10+): 0.04 ETH
  - Levels x30-x59: 0.08 ETH
  - Levels x60-x89: 0.12 ETH
  - Levels x90-x99: 0.16 ETH
  - Levels x00 (100+): 0.24 ETH
- Paper App. A "Ticket price range: 0.01-0.24 ETH" (line 4913-4914). Matches.

### Section 6.3: Century Bonus Mints

No discrepancies found.

- Paper says "up to 100% extra" (referenced in plan context). Contract MintModule lines 879-900: `bonusQty = (adjustedQty32 * score) / 30_500`. At max activity score (30500 BPS = 3.05), bonus = 100% of purchase. Matches.
- 20 ETH per-player cap: Contract MintModule line 888: `maxBonus = (20 ether) / (priceWei >> 2)`. Matches paper.

### Section 5.3: Auto-Rebuy Bonuses

No discrepancies found.

- Paper states "130% face value (145% with a pass)" (S5.3, line 3368). DegenerusGame.sol (outside the four contracts in scope but referenced in plan) confirms at lines 1472-1473: 13000 bps (130%) default, 14500 bps (145%) with afKing. Matches.
- Paper App. A "Auto-rebuy ticket bonus: 30%/45%" (line 4990-4992). Matches (30% bonus = 130% face, 45% bonus = 145% face).

### Section 3.4 / Appendix A: Whale Bundle and Deity Pass Pricing

No discrepancies found.

- Whale bundle price: Paper App. A "2.4-4 ETH" (line 4919-4920). Contract WhaleModule: WHALE_BUNDLE_EARLY_PRICE = 2.4 ether (lines 0-3), WHALE_BUNDLE_STANDARD_PRICE = 4 ether (levels 4+). Matches.
- Deity pass base price: Paper App. A "24 ETH + T(n)" (line 4925-4926). Contract WhaleModule: DEITY_PASS_BASE = 24 ether (line 154). Matches.
- Deity pass cap: Paper App. A "32 total" (line 4932-4933). Contract LootboxModule: DEITY_PASS_MAX_TOTAL = 32 (line 209). Matches.

### Appendix A: Parameter Summary

#### GM-03: stETH yield split description

- **Paper:** App. A, "25/25/25/25% accumulator/vault/DGNRS/GNRUS" (line 4858)
- **Contract:** DegenerusGameStorage.sol, line 1382 comment: "Collects 46% of yield surplus each level transition" for the accumulator. The yield split logic is in DegenerusGame.sol (outside the four contracts in scope for this plan).
- **Mismatch:** The paper states a 4-way even split (25% each). The Storage contract's own comment says the accumulator collects 46%, which is consistent with MEMORY.md's "50/25/25" (with ~8% buffer). A 4-way even split (25/25/25/25) differs from both the historical "50/25/25" and the actual "46/23/23 + 8% buffer". The yield split implementation is in DegenerusGame.sol (Plan 15-04 scope), but this finding is noted here because Storage's own comment contradicts the paper's App. A claim.
- **Severity:** Info. The yield split constants are outside this plan's four-contract scope (they live in DegenerusGame.sol). Flagged here only because Storage's own inline comment (line 1382) highlights the discrepancy. Full verification deferred to Plan 15-04 (DegenerusGame.sol).

### Appendix G: Lootbox Reward Paths

No discrepancies found on reward path probabilities or variance tiers.

- Reward path probabilities: Contract LootboxModule line 1561: `roll = nextEntropy % 20`. Rolls 0-10 = 55% tickets, 11-12 = 10% DGNRS, 13-14 = 10% WWXRP, 15-19 = 25% BURNIE. Paper App. G states "55% / 10% / 10% / 25%". Matches.
- Paper says WWXRP path gives "1 WWXRP (fixed)". Contract: LOOTBOX_WWXRP_PRIZE = 1 ether (line 290). Matches (1 ether = 1 token with 18 decimals).
- Ticket base budget: Contract LOOTBOX_TICKET_ROLL_BPS = 16100 (161%). Paper App. G says "Ticket budget = 161% of roll amount". Matches.
- Ticket variance tiers: All five tiers match exactly:
  - Tier 1: 1% (100 BPS), 4.6x (46000 BPS). Matches.
  - Tier 2: 4% (400 BPS), 2.3x (23000 BPS). Matches.
  - Tier 3: 20% (2000 BPS), 1.1x (11000 BPS). Matches.
  - Tier 4: 45% (4500 BPS), 0.651x (6510 BPS). Matches.
  - Tier 5: 30% (remainder), 0.45x (4500 BPS). Matches.
- BURNIE variance: Low path 80% (rolls 0-15 of 20), 58%-130%. Contract: 5808-12963 BPS. Matches (rounding). High path 20% (rolls 16-19), 307%-590%. Contract: 30705-58995 BPS. Matches.
- Presale BURNIE bonus: Paper says "62% bonus multiplier". Contract: LOOTBOX_PRESALE_BURNIE_BONUS_BPS = 6200 (62%). Matches.
- DGNRS tier draw rates: Paper says 0.001%/0.039%/0.08%/0.8%. Contract PPM values: 10/390/800/8000 per 1M. Matches exactly.
- Boon budget: Paper says "10% of each lootbox's EV-scaled amount, capped at 1 ETH". Contract: LOOTBOX_BOON_BUDGET_BPS = 1000 (10%), LOOTBOX_BOON_MAX_BUDGET = 1 ether. Matches.
- Lootbox split threshold: Paper says "above 0.5 ETH split into two independent rolls". Contract: LOOTBOX_SPLIT_THRESHOLD = 0.5 ether (line 308). Matches.

### Appendix A: Remaining Parameters

No discrepancies found.

- Activity score range: Paper says "[0, 3.05]". Contract ACTIVITY_SCORE_MAX_BPS = 25500 (2.55 for lootbox cap) but the full range goes to 30500 (3.05 including all components). Matches.
- Lootbox EV range: Paper says "[0.80, 1.35]". Contract: LOOTBOX_EV_MIN_BPS = 8000, LOOTBOX_EV_MAX_BPS = 13500. Matches.
- Coinflip win rate: Paper says "0.50". Not in these four contracts (in BurnieCoinflip.sol). Deferred to Plan 15-03.
- Bootstrap prize pool: Paper says "50 ETH". Contract: BOOTSTRAP_PRIZE_POOL = 50 ether (Storage line 136). Matches.
- Pre-game timeout: Paper says "365 days". Contract: _DEPLOY_IDLE_TIMEOUT_DAYS = 365 (Storage line 166). Matches.
- Post-game timeout: Paper says "120 days". Contract: Storage line 179 uses `120 days` constant. Matches.

### DegenerusGameStorage.sol: Other Constants

No discrepancies found.

- Earlybird end level: EARLYBIRD_END_LEVEL = 3. Not explicitly stated as a number in the paper. No claim to verify.
- Earlybird target ETH: EARLYBIRD_TARGET_ETH = 1000 ether. Not explicitly stated in the paper sections checked.
- Lootbox claim threshold: LOOTBOX_CLAIM_THRESHOLD = 5 ether. Paper references large lootbox wins converting to whale passes, consistent with 5 ETH threshold.
- Distress mode hours: DISTRESS_MODE_HOURS = 6. Paper does not state this specific number in the sections verified.

### DegenerusGameWhaleModule.sol: Whale Bundle Fund Distribution

No discrepancies found.

- Whale bundle pool split: Contract lines 289-296: level 0 = 30% next / 70% future (3000/7000 BPS), level > 0 = 5% next / 95% future (500/9500 BPS). The paper does not specify these exact splits for whale bundles in the sections verified. No claim to contradict.
- Whale pass tickets per level: WHALE_STANDARD_TICKETS_PER_LEVEL = 2, WHALE_BONUS_TICKETS_PER_LEVEL = 40, WHALE_BONUS_END_LEVEL = 10. Paper S3.4 does not state these exact numbers. No claim to contradict.
- Lazy pass: LAZY_PASS_LEVELS = 10, LAZY_PASS_TICKETS_PER_LEVEL = 4. Consistent with MEMORY.md's "10-level bundle, bundleType=1".

## Known Non-Issues (Not Flagged)

Per MEMORY.md and CLAUDE.md instructions, the following were verified but intentionally not flagged:

1. **stETH yield split "50/25/25"**: The ~8% contract buffer is an implementation detail. The paper's 25/25/25/25 is noted as Info only because Storage's own comment contradicts it. Full verification in Plan 15-04.
2. **VAULT_PERPETUAL_TICKETS=16 vs "4 tickets"**: This is a units difference (entries vs purchases due to `<<2`). Not present in these four contracts but noted as a known non-issue.
3. **"Zero-rake" presale carve-out**: 20% vault allocation during presale (LOOTBOX_PRESALE_SPLIT_VAULT_BPS=2000) is a known and documented exception.
4. **Unaffiliated player commissions**: Goes to vault. Known carve-out, not an error.
