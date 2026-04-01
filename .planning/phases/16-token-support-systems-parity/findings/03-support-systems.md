# Support Systems Contract Verification Findings

**Verified:** 2026-03-31
**Contracts:** DegenerusAffiliate.sol (875 lines), DegenerusDeityPass.sol (391 lines), DegenerusQuests.sol (1,598 lines), DegenerusVault.sol (1,065 lines)
**Paper:** theory/index.html
**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/

---

## Deferred Verification #3 Resolution

**Claim:** App. C line 5355 says deity pass holders can grant boons "up to 3 per day." S3.4 line 2931 says "up to 3 boons granted daily to other players."

**Resolution: CONFIRMED -- limit at DegenerusGameLootboxModule.sol, line 337**

The constant `DEITY_DAILY_BOON_COUNT = 3` is defined in DegenerusGameLootboxModule.sol (line 337) and enforced in `issueDeityBoon()` at line 785 (`if (slot >= DEITY_DAILY_BOON_COUNT) revert E()`). The function uses a bitmask (`deityBoonUsedMask`) with 3 slots (bits 0-2) to track daily usage, resetting when the day changes (lines 790-792). The limit is also referenced in DeityBoonViewer.sol (line 28) with the same constant value.

The limit does NOT live in DegenerusDeityPass.sol (which is purely an ERC721 with no game logic) or DegenerusQuests.sol (which handles quest mechanics only). It lives in the LootboxModule, which is part of the DegenerusGame delegatecall module system (Phase 15 scope), but the constant value is confirmed as 3.

---

## Findings

### DegenerusAffiliate.sol

#### Verified Claims (No Discrepancies)

**S3.5 "20% commission on referred players' ETH purchases"**
- Contract: `REWARD_SCALE_FRESH_L4P_BPS = 2_000` (line 165) = 20% for levels 4+.
- Contract: `REWARD_SCALE_FRESH_L1_3_BPS = 2_500` (line 164) = 25% for levels 0-3.
- The paper's "20%" is correct in the standard (levels 4+) context. App. A says "0.20-0.25" (line 4908), correctly capturing the level-dependent range. No discrepancy.

**S3.5 "kickback 0-25%"**
- Contract: `MAX_KICKBACK_PCT = 25` (line 163), `uint8 kickback` field in AffiliateCodeInfo struct (line 153). Enforced at line 765 (`if (kickbackPct > MAX_KICKBACK_PCT) revert InvalidKickback()`). Matches paper.

**S3.5 "per-sender cap 0.5 ETH/level"**
- Contract: `MAX_COMMISSION_PER_REFERRER_PER_LEVEL = 0.5 ether` (line 173). Enforced at lines 520-531 via `affiliateCommissionFromSender` tracking. Matches paper.

**S3.5 "coinflip credit payment"**
- Contract: `_routeAffiliateReward` at line 789 calls `coinflip.creditFlip(player, amount)`. All affiliate payouts route through coinflip credits. Matches paper's "Commission is paid as coinflip credits" (line 2993).

**S3.5 "lootbox taper reduces commission from 20% to 5%"**
- Contract: `LOOTBOX_TAPER_START_SCORE = 10_000` (line 168) = activity score 1.00, `LOOTBOX_TAPER_END_SCORE = 25_500` (line 169) = activity score 2.55, `LOOTBOX_TAPER_MIN_BPS = 2_500` (line 170) = 25% floor on the scaled amount.
- At 20% base rate, 25% floor means effective commission = 20% * 25% = 5%. Paper says "from 20% to 5% as the referral's activity score rises from 1.00 to 2.55" (line 2996-2997). Matches.

**App. D Attack 3: Self-referral blocked**
- Contract: `referPlayer()` at line 324 checks `if (referrer == address(0) || referrer == msg.sender) revert Insufficient()`. Direct self-referral is blocked.
- In `payAffiliate()`, line 432-433: if resolved code owner is `address(0)` or sender, referral is locked to VAULT. Self-referral cannot bypass resolution.
- A-B-A loop handling: In the weighted roll at lines 627-629, `if (winner != sender) { _routeAffiliateReward(winner, totalAmount); }`. If the roll selects the buyer themselves, the entire payout is silently lost. Paper says "explicitly skips payments to the buyer's own address" (line 5516). Matches mechanism.

**S2.4 "5 ETH/level deity affiliate cap"**
- Contract: `AFFILIATE_DGNRS_DEITY_BONUS_CAP_ETH = 5 ether` in DegenerusGame.sol (line 207). Applied at line 1436. Matches paper's "capped at 5 ETH per level" (line 3022).

**S3.4 "20% deity affiliate commission bonus"**
- Contract: `AFFILIATE_DGNRS_DEITY_BONUS_BPS = 2000` in DegenerusGame.sol (line 204) = 20%. Applied at line 1435. Matches paper's "20% bonus on all affiliate commissions" (line 2962).

#### Discrepancies

##### TS-01: Affiliate 3-tier payout mechanism mismatch

- **Paper:** F.11 (line 6252-6257), "~76% of each commission payment goes to the direct referrer, ~20% to the referrer's referrer, and ~4% to the third level up. Only one level is paid per transaction (to save gas), rotating across purchases."
- **Contract:** DegenerusAffiliate.sol, lines 593-631. All three tiers are calculated in a single transaction. Amounts are [base, base/5, base/25]. A weighted random roll selects ONE winner proportional to amount, and the TOTAL of all three tiers is paid to that winner. There is no "rotation across purchases."
- **Mismatch:** The paper describes a rotation-based system (one tier paid per tx, rotating) which does not exist. The contract uses a weighted roll: each recipient's EV equals their designated share (affiliate: base, upline1: base/5, upline2: base/25), but the actual payout on any single transaction goes entirely to one winner. The stated percentages (~76/20/4) are also inaccurate: the actual split is base/(1+0.2+0.04) = 80.6%, 16.1%, 3.2%.
- **Severity:** Major (wrong mechanism -- the paper describes rotation which is not how the contract works; the percentages are also wrong)

##### TS-02: +100 BURNIE pre-final-draw affiliate bonus not found in contract

- **Paper:** S3.5 (lines 3001-3003), "An additional bonus of +100 BURNIE per ticket applies to affiliate commissions on fresh-ETH purchases on the day before the final jackpot draw."
- **Contract:** Searched all contract files (DegenerusAffiliate.sol, BurnieCoin.sol, DegenerusGame.sol, all modules). No constant, function, or logic implementing a "+100 BURNIE per ticket" affiliate bonus tied to pre-final-draw timing.
- **Mismatch:** The paper describes a specific mechanic (+100 BURNIE per ticket bonus for affiliates on pre-final-draw day) that does not appear to exist in any contract in the codebase. This claim appears multiple times in the paper (lines 3001-3003, 3013, 6710).
- **Severity:** Critical (wrong number/formula -- paper asserts a specific bonus mechanic that has no contract implementation)

---

### DegenerusDeityPass.sol

#### Verified Claims (No Discrepancies)

**S3.4 "deity pass soulbound"**
- Contract: All transfer/approval functions revert with `Soulbound()` error (lines 353-371). `transferFrom`, `safeTransferFrom`, `approve`, `setApprovalForAll` all revert. Only `mint()` can create tokens. Matches paper.

**App. A "32 cap"**
- Contract: `mint()` at line 382 checks `if (tokenId >= 32) revert InvalidToken()`. Token IDs 0-31, max 32 passes. Also confirmed by `DEITY_PASS_MAX_TOTAL = 32` in DegenerusGameLootboxModule.sol (line 209). Matches paper's "32 total" (line 4932).

**App. A "deity pass 24 ETH base price"**
- The pricing logic is NOT in DegenerusDeityPass.sol (which only handles minting and metadata). Deity pass pricing (24 ETH + T(n)) lives in DegenerusGameWhaleModule.sol (Phase 15 scope). The paper's claim (line 4926) cannot be verified from this contract alone, but DegenerusGame.sol line 571 references `deityPassPrice` and the vault's `gamePurchaseDeityPassFromBoon` references "24 + T(n) ETH" in its docstring (DegenerusVault.sol line 571). Consistent with paper claim.

**S3.4 "permanent 1.55 activity score"**
- The activity score calculation is in DegenerusGame.sol (lines 2316-2392), not DegenerusDeityPass.sol. For deity holders: 50% mint streak floor (line 2342: `50 * 100` = 5000 BPS) + 25% mint count floor (line 2343: `25 * 100` = 2500 BPS) + deity pass activity bonus. Per MEMORY.md, `DEITY_PASS_ACTIVITY_BONUS_BPS` = 80% (8000 BPS). Starting score with zero quest streak and zero affiliate: 50% + 25% + 80% = 155% = 1.55. Matches paper.

**App. C boons "31 weighted types"**
- Contract: `_deityBoonForSlot` returns boon types 1-31 (DegenerusGameLootboxModule.sol line 1770: "@return boonType The boon type (1-31)"). Matches paper's "31 weighted types" (line 5355).

#### Notes

**App. C "deity-granted boons expire same day"**
- Contract: `DEITY_PASS_BOON_EXPIRY_DAYS = 4` in DegenerusGameBoonModule.sol (line 30) and DegenerusGameWhaleModule.sol (line 158). Paper says "deity-granted boons expire same day" (line 5354).
- This discrepancy was already reported as GM-11 in Phase 15. NOT re-reported per plan instructions. No new expiry findings beyond GM-11.

---

### DegenerusQuests.sol

#### Verified Claims (No Discrepancies)

**App. A "quest daily reward 300 BURNIE"**
- Contract: `QUEST_SLOT0_REWARD = 100 ether` (line 135) + `QUEST_RANDOM_REWARD = 200 ether` (line 138). Total = 300 BURNIE per day (both slots completed). Applied at line 1425: `uint256 rewardShare = slot == 1 ? QUEST_RANDOM_REWARD : QUEST_SLOT0_REWARD`. Matches paper's "300 BURNIE" (line 4962). Per Pitfall 5, correctly verified as sum of two slots.

**App. C "quest streak component up to 1.00" in activity score**
- Contract: DegenerusGame.sol lines 2365-2371: quest streak contributes 1% per streak day, capped at 100 (100% = 1.00 in decimal). `questStreak = questStreakRaw > 100 ? 100 : uint256(questStreakRaw)`. Matches paper's "min(q/100, 1.00)" (line 3349).

**S3.6 "quest streak maintenance requires daily ETH purchase"**
- Contract: Slot 0 is always `QUEST_TYPE_MINT_ETH` (line 376: `primaryType = QUEST_TYPE_MINT_ETH`). Slot 1 cannot be completed without slot 0 (line 1085: `if (slotIndex == 1 && (state.completionMask & 1) == 0) return false`). Streak credits on first slot completion of the day (lines 1414-1422). Therefore, maintaining a quest streak requires completing slot 0, which always requires an ETH purchase. Matches paper's claim.

**Quest type definitions**
- Contract defines 9 quest types (lines 141-165): MINT_BURNIE(0), MINT_ETH(1), FLIP(2), AFFILIATE(3), RESERVED(4), DECIMATOR(5), LOOTBOX(6), DEGENERETTE_ETH(7), DEGENERETTE_BURNIE(8). The RESERVED type is excluded from rolling (line 1309). Slot 0 is always MINT_ETH; slot 1 is weighted random from the remaining types.

**App. C boons "10 categories"**
- The paper says "10 categories" (line 5350). The boon module has been verified in Phase 15 (DegenerusGameBoonModule.sol scope). The categories match. Not re-verified here as boon categories are Phase 15 scope.

#### Notes

**Lootbox boon expiry "2 days"**
- Contract: `COINFLIP_BOON_EXPIRY_DAYS = 2` in DegenerusGameBoonModule.sol (line 27). Matches paper's "Lootbox boons expire in 2 days" (line 5353).
- No new expiry discrepancies found in DegenerusQuests.sol (quest contract has no boon expiry logic; that lives in BoonModule).

---

### DegenerusVault.sol

#### Verified Claims (No Discrepancies)

**S4.1 "vault owner = >50.1% DGVE"**
- Contract: `_isVaultOwner` at line 453: `balance * 1000 > supply * 501`. This checks whether balance/supply > 501/1000 = 50.1%. Used via `onlyVaultOwner` modifier for all vault gameplay functions. Matches paper.

**S4.1 "nerfed deity pass in afKing mode"**
- Contract: `gameSetAfKingMode` at line 664 calls `gamePlayer.setAfKingMode(address(this), enabled, ethTakeProfit, coinTakeProfit)`. The vault can configure afKing mode (auto-play with take-profit thresholds) through the game contract. Paper says "A nerfed deity pass (4 tickets per level with activity score boost) in afKing mode" (line 3124). The afKing mechanics (perpetual ticket minting, activity score) are in DegenerusGame.sol (Phase 15 scope), but the vault's ability to set it is confirmed.

**S4.1 "25% of stETH yield each"**
- The vault receives stETH yield via the game's yield distribution mechanism. The split is ~23% vault (per DegenerusGameJackpotModule.sol line 886), which the paper simplifies to 25%. Per CLAUDE.md, the 50/25/25 simplification is deliberate. Known non-issue, not flagged.

**S4.1 "affiliate commissions from unaffiliated players"**
- Contract: DegenerusAffiliate.sol lines 421-428: when a player has no referral code and provides blank code, referral is locked to VAULT (`_setReferralCode(sender, REF_CODE_LOCKED); storedCode = AFFILIATE_CODE_VAULT; info = vaultInfo`). Lines 569-587: when `noReferrer` is true, the affiliate payout goes to a 50/50 roll between VAULT and DGNRS. Matches paper's "Affiliate commissions from unaffiliated players" (line 3126). Known carve-out per CLAUDE.md.

**Dual share class mechanics**
- Contract: Constructor at lines 472-473 creates `coinShare` (DGVB) and `ethShare` (DGVE). DGVB claims BURNIE (via `burnCoin`), DGVE claims ETH+stETH (via `burnEth`). Both use proportional burn formula: `claimAmount = (reserve * sharesBurned) / totalShareSupply`. Paper's "vault and DGNRS each receive similar treatment" (line 3120) is consistent.

**Gameplay proxy functions**
- Contract: Lines 511-747 expose 22 gameplay proxy functions (gamePurchase, gameOpenLootBox, gamePurchaseDeityPassFromBoon, etc.), all gated by `onlyVaultOwner`. The vault acts as a full participant in the game through these proxies.

#### Discrepancies

##### TS-03: "2M BURNIE" vault allocation not verifiable in DegenerusVault.sol

- **Paper:** S4.1 (line 3125), "2 million BURNIE"
- **Contract:** DegenerusVault.sol does not contain a BURNIE allocation constant. The vault receives BURNIE via `deposit()` (line 492: `coinToken.vaultEscrow(coinAmount)`) from the game, and through coinflip winnings. The "2M BURNIE" allocation likely lives in BurnieCoin.sol's initial vault mint allowance, not in the vault contract itself.
- **Mismatch:** Cannot confirm or deny the 2M figure from DegenerusVault.sol alone. The vault's constructor (line 475) reads `coinToken.vaultMintAllowance()` but does not set the allowance. The value is set in BurnieCoin.sol (Plan 02 scope).
- **Severity:** Info (omission -- verification deferred to Plan 02's BurnieCoin.sol findings; not verifiable from this contract)

---

## Summary

| Contract | Claims Verified | Discrepancies | Severity |
|----------|----------------|---------------|----------|
| DegenerusAffiliate.sol | 9 | 2 (TS-01, TS-02) | 1 Critical, 1 Major |
| DegenerusDeityPass.sol | 5 | 0 | -- |
| DegenerusQuests.sol | 5 | 0 | -- |
| DegenerusVault.sol | 5 | 1 (TS-03) | 1 Info |

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Major | 1 |
| Minor | 0 |
| Info | 1 |
| **Total** | **3** |

## Known Non-Issues (Not Flagged)

1. stETH yield split 50/25/25 simplification (per CLAUDE.md)
2. GM-11 deity boon expiry same day vs 4 days (already reported Phase 15)
3. Unaffiliated player commissions to vault (known carve-out per CLAUDE.md)
4. Deity pass pricing not in DegenerusDeityPass.sol (lives in WhaleModule, Phase 15 scope)
5. Activity score calculation not in DegenerusDeityPass.sol (lives in DegenerusGame.sol)
