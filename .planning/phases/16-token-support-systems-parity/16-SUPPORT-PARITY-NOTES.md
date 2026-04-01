# Support Systems Parity Notes

**Verified:** 2026-03-31
**Paper:** theory/index.html
**Contracts:** DegenerusAffiliate, DegenerusDeityPass, DegenerusQuests, DegenerusVault
**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Major | 1 |
| Minor | 0 |
| Info | 0 |
| **Total** | **2** |

## Contracts Verified

| Contract | Status |
|----------|--------|
| DegenerusAffiliate.sol | COMPLETE |
| DegenerusDeityPass.sol | COMPLETE |
| DegenerusQuests.sol | COMPLETE |
| DegenerusVault.sol | COMPLETE |

## Discrepancies by Paper Section

### Section 3.5: Affiliate Commission System

#### TS-10: +100 BURNIE pre-final-draw affiliate bonus not found in contract

- **Paper:** S3.5 (lines 3001-3003), "An additional bonus of +100 BURNIE per ticket applies to affiliate commissions on fresh-ETH purchases on the day before the final jackpot draw."
- **Contract:** Searched all contract files (DegenerusAffiliate.sol, BurnieCoin.sol, DegenerusGame.sol, all modules). No constant, function, or logic implementing a "+100 BURNIE per ticket" affiliate bonus tied to pre-final-draw timing.
- **Mismatch:** The paper describes a specific mechanic (+100 BURNIE per ticket bonus for affiliates on pre-final-draw day) that does not appear to exist in any contract in the codebase. This claim appears multiple times in the paper (lines 3001-3003, 3013, 6710).
- **Severity:** Critical

### Appendix F: Common Misreadings

#### TS-11: Affiliate 3-tier payout mechanism mismatch

- **Paper:** F.11 (line 6252-6257), "~76% of each commission payment goes to the direct referrer, ~20% to the referrer's referrer, and ~4% to the third level up. Only one level is paid per transaction (to save gas), rotating across purchases."
- **Contract:** DegenerusAffiliate.sol, lines 593-631. All three tiers are calculated in a single transaction. Amounts are [base, base/5, base/25]. A weighted random roll selects ONE winner proportional to amount, and the TOTAL of all three tiers is paid to that winner. There is no "rotation across purchases."
- **Mismatch:** The paper describes a rotation-based system (one tier paid per tx, rotating) which does not exist. The contract uses a weighted roll: each recipient's EV equals their designated share (affiliate: base, upline1: base/5, upline2: base/25), but the actual payout on any single transaction goes entirely to one winner. The stated percentages (~76/20/4) are also inaccurate: the actual split is base/(1+0.2+0.04) = 80.6%, 16.1%, 3.2%.
- **Severity:** Major

## Sections With No Discrepancies Found

- **S3.5 "20% commission on referred players' ETH purchases":** Confirmed. REWARD_SCALE_FRESH_L4P_BPS = 2000 (20% for levels 4+). REWARD_SCALE_FRESH_L1_3_BPS = 2500 (25% for levels 0-3). App. A correctly states "0.20-0.25."
- **S3.5 "kickback 0-25%":** Confirmed. MAX_KICKBACK_PCT = 25. Enforced at line 765.
- **S3.5 "per-sender cap 0.5 ETH/level":** Confirmed. MAX_COMMISSION_PER_REFERRER_PER_LEVEL = 0.5 ether. Enforced at lines 520-531.
- **S3.5 "coinflip credit payment":** Confirmed. `_routeAffiliateReward` at line 789 calls `coinflip.creditFlip(player, amount)`.
- **S3.5 "lootbox taper reduces commission from 20% to 5%":** Confirmed. Taper range 1.00-2.55 activity score, 25% floor on scaled amount, effective commission = 20% * 25% = 5%.
- **App. D Attack 3 self-referral blocked:** Confirmed. `referPlayer()` checks `referrer == msg.sender`. A-B-A loop silently drops payment when winner == sender.
- **S2.4 "5 ETH/level deity affiliate cap":** Confirmed. AFFILIATE_DGNRS_DEITY_BONUS_CAP_ETH = 5 ether in DegenerusGame.sol.
- **S3.4 "20% deity affiliate commission bonus":** Confirmed. AFFILIATE_DGNRS_DEITY_BONUS_BPS = 2000 in DegenerusGame.sol.
- **S3.4 "deity pass soulbound":** Confirmed. All transfer/approval functions revert with Soulbound().
- **App. A "32 cap":** Confirmed. `mint()` checks `tokenId >= 32` revert. Token IDs 0-31.
- **S3.4 "permanent 1.55 activity score":** Confirmed. 50% streak floor + 25% mint count floor + 80% deity bonus = 1.55.
- **App. C boons "31 weighted types":** Confirmed. DegenerusGameLootboxModule.sol returns boon types 1-31.
- **App. A "quest daily reward 300 BURNIE":** Confirmed. QUEST_SLOT0_REWARD = 100 + QUEST_RANDOM_REWARD = 200 = 300 total.
- **App. C "quest streak component up to 1.00":** Confirmed. 1% per streak day, capped at 100 days = 1.00.
- **S3.6 "quest streak requires daily ETH purchase":** Confirmed. Slot 0 is always QUEST_TYPE_MINT_ETH.
- **S4.1 "vault owner = >50.1% DGVE":** Confirmed. `_isVaultOwner` checks `balance * 1000 > supply * 501`.
- **S4.1 "nerfed deity pass in afKing mode":** Confirmed. Vault sets afKing via `gameSetAfKingMode`.
- **S4.1 "25% of stETH yield":** Confirmed (known simplification of 23%). Not flagged per CLAUDE.md.
- **S4.1 "affiliate commissions from unaffiliated players":** Confirmed. No-code and blank-code referrals locked to VAULT.
- **S4.1 "2M BURNIE vault allocation":** Confirmed in BurnieCoin.sol (line 197: vaultAllowance 2M). Not directly in DegenerusVault.sol but verified cross-contract.

## Known Non-Issues (Not Flagged)

1. **stETH yield split 50/25/25 simplification:** Known per CLAUDE.md. Not flagged.
2. **GM-11 deity boon expiry same day vs 4 days:** Already reported in Phase 15. Not re-reported.
3. **Unaffiliated player commissions to vault:** Known carve-out per CLAUDE.md.
4. **Deity pass pricing not in DegenerusDeityPass.sol:** Lives in WhaleModule (Phase 15 scope). Not a discrepancy.
5. **Activity score calculation not in DegenerusDeityPass.sol:** Lives in DegenerusGame.sol. Not a discrepancy.
6. **2M BURNIE vault allocation not in DegenerusVault.sol:** Lives in BurnieCoin.sol. Confirmed cross-contract. Not a discrepancy.

## Changes Since v2.1

Compared current contract source against v2.1 EXTR-03 catalog (git commit fe39239).

### DegenerusAffiliate.sol

**New (per delta-v7 AFF-01, UNPLANNED change commit a3e2341f):**
- `defaultCode(address)` -- pure function returning default referral code for any address
- `_resolveCodeOwner(code)` -- resolves code owner, handles default vs custom codes
- `_createAffiliateCode(code, kickbackPct, codeOwner)` -- extracted internal creation logic
- `_bootstrapReferral(player, code)` -- constructor bootstrap helper
- `_referrerAddress(player)` -- resolve stored code to address

**Changed:**
- `referPlayer(code)` -- handles default codes and VAULT-referred update during presale
- `payAffiliate(...)` -- uses `_resolveCodeOwner` for default code resolution
- `createAffiliateCode(code, kickbackPct)` -- refactored to use internal `_createAffiliateCode`

**No functions removed.**

### DegenerusDeityPass.sol

No changes since v2.1. All functions match the EXTR-03 catalog.

### DegenerusQuests.sol

**New:**
- `_canRollDecimatorQuest()` -- availability check for decimator quest type
- `handleDegenerette(player, amount, paidWithEth)` -- Degenerette bet progress tracking
- `_questCompleteWithPair(...)` -- combo completion logic (both slots in one tx)
- Additional private helpers for quest progress tracking

**Changed:**
- `handleMint` -- now handles both MINT_ETH and MINT_BURNIE types
- `_rollDailyQuest` -- added decimator availability check
- `_bonusQuestType` -- added weighted selection and decimator conditional

**No functions removed.**

### DegenerusVault.sol

**New:**
- `gameDegeneretteBetEth/Burnie/Wwxrp(...)` -- 3 Degenerette betting proxies
- `gameResolveDegeneretteBets(betIds)` -- Degenerette resolution proxy
- `coinSetAutoRebuy/coinSetAutoRebuyTakeProfit` -- coinflip auto-rebuy config
- `gameSetDecimatorAutoRebuy(enabled)` -- decimator auto-rebuy
- `coinClaimCoinflipsTakeProfit(multiples)` -- take-profit claim
- `gameSetOperatorApproval(operator, approved)` -- operator approval

**No functions removed.**

## Deferred Verifications Resolved

### Deferred #3: Deity boon granting "3 per day" limit (App. C)

**Verdict: CONFIRMED.** The constant `DEITY_DAILY_BOON_COUNT = 3` is defined in DegenerusGameLootboxModule.sol (line 337) and enforced in `issueDeityBoon()` at line 785 via bitmask tracking with 3 slots (bits 0-2). The limit does NOT live in DegenerusDeityPass.sol (purely ERC721, no game logic) or DegenerusQuests.sol (quest mechanics only). It lives in the LootboxModule (Phase 15 scope), but the constant value is confirmed as 3.
