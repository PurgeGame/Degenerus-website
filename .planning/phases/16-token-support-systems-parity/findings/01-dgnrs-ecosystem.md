# DGNRS Ecosystem & WWXRP Findings

**Verified:** 2026-03-31
**Paper:** theory/index.html
**Contracts verified:**
- DegenerusStonk.sol (359 lines)
- StakedDegenerusStonk.sol (874 lines)
- WrappedWrappedXRP.sol (393 lines)
**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/

---

## Deferred Verifications Resolved

### Deferred #1: DGNRS distribution 20/35/20/10/10/5

**Verdict: CONFIRMED**

StakedDegenerusStonk.sol constructor (lines 237-244) defines pool allocation constants:

| Pool | BPS Constant | Percentage | Paper Claim |
|------|-------------|------------|-------------|
| Creator | CREATOR_BPS = 2000 | 20% | 20% |
| Affiliate | AFFILIATE_POOL_BPS = 3500 | 35% | 35% |
| Lootbox | LOOTBOX_POOL_BPS = 2000 | 20% | 20% |
| Earlybird | EARLYBIRD_POOL_BPS = 1000 | 10% | 10% |
| Whale | WHALE_POOL_BPS = 1000 | 10% | 10% |
| Reward | REWARD_POOL_BPS = 500 | 5% | 5% |
| **Total** | **10000** | **100%** | **100%** |

All six percentages match exactly. Sum is 10000 BPS (100%). Constructor (lines 283-296) computes allocations from INITIAL_SUPPLY (1 trillion) using these constants. Rounding dust is added to the lootbox pool (line 295).

Paper references verified:
- S4.1 lines 3133-3141: lists Affiliates (35%), Lootbox (20%), Early participants (10%), Whale/deity (10%), Gameplay rewards (5%), Creator (20%). All match.
- App. C lines 5461-5470: same breakdown with pool names. All match.

### Deferred #2: Soulbound mechanics, afKing, 10 ETH takeProfit

**Verdict: CONFIRMED (with one minor nuance noted as TS-01)**

**(a) Soulbound:** StakedDegenerusStonk.sol has NO public transfer, transferFrom, or approve functions. The only transfer mechanism is `wrapperTransferTo` (line 330), callable only by the DGNRS contract (for unwrap operations by vault owner). sDGNRS is confirmed soulbound. Paper App. C line 5472 correctly states: "Game-distributed DGNRS (sDGNRS) is soulbound and non-transferable. There is no secondary market: no approve, no transferFrom, no way to sell." S4.1 line 3142 says "Game-distributed DGNRS is soulbound" which is also accurate for the sDGNRS tokens distributed through gameplay pools. DegenerusStonk.sol (DGNRS wrapper) is a standard transferable ERC20 with transfer/transferFrom/approve (lines 142-177). Creator's 20% DGNRS is transferable. Both contracts behave as described.

**(b) afKing mode:** Constructor lines 310-315 call `game.setAfKingMode(address(0), true, 10 ether, 0)`. AfKing is enabled at deployment. Paper App. C line 5481: "The DGNRS contract runs in afKing mode with a 10 ETH takeProfit (set at deployment)." Exact match.

**(c) 10 ETH takeProfit:** Constructor line 313: `10 ether`. Paper App. C line 5481: "10 ETH takeProfit." Exact match.

**(d) VRF multiplier 25-175%:** StakedDegenerusStonk.sol `resolveRedemptionPeriod` (line 575) accepts `roll` parameter documented as "range 25-175, applied as percentage." Line 582: `rolledEth = (pendingRedemptionEthBase * roll) / 100`. Paper S4.1 line 3146: "total payments from burns are subject to a VRF multiplier (25%-175%)." Match confirmed. The actual enforcement of the 25-175 range is in the game contract (the caller), consistent with the architecture where sDGNRS is a passive recipient of the roll value.

**(e) Half ETH / half lootbox payout:** `claimRedemption` lines 631-632: `ethDirect = totalRolledEth / 2; lootboxEth = totalRolledEth - ethDirect;`. Paper S4.1 line 3146-3147: "half the rolled ETH is paid directly and half is converted to lootbox rewards." Exact match. Post-gameOver exception: 100% paid as direct ETH (line 628-629), consistent with paper's context (burns described during active game).

### Deferred #3: Deity boon granting "3 per day" limit

**Verdict: NOT IN SCOPE for this plan.** Deferred verification #3 concerns deity/quest contracts (DegenerusDeityPass.sol, DegenerusQuests.sol, DegenerusGameBoonModule.sol). These are in Plan 03 (support systems) scope, not Plan 01 (DGNRS ecosystem). This deferred item will be resolved in Plan 03.

---

## Findings

### TS-01: S4.1 omits stETH from DGNRS burn payout description

- **Paper:** S4.1 line 3142-3143, "burn tokens for a pro-rata share of the contract's accumulated ETH and BURNIE"
- **Contract:** StakedDegenerusStonk.sol, `_deterministicBurnFrom` (lines 516-558). Post-gameOver burns distribute proportional ETH + stETH (ETH-preferential, stETH as fallback). Gambling burns (active game) segregate proportional ETH+stETH value and BURNIE. DegenerusStonk.sol `burn()` (line 227) receives ETH, stETH, and BURNIE from `stonk.burn()`.
- **Mismatch:** S4.1 says "ETH and BURNIE" but the actual payout includes stETH. App. C line 5473 correctly states "ETH, stETH, and BURNIE reserves." S4.1's omission of stETH is inconsistent with App. C and the contract. A reader of only S4.1 would not know stETH is part of the burn payout.
- **Severity:** Minor

### TS-02: WWXRP supply claim "one trillion" does not match contract

- **Paper:** S4.1 lines 3131-3132, "one trillion wwXRP, a valueless memecoin distributed as a consolation prize to losers"
- **Contract:** WrappedWrappedXRP.sol, line 134: `INITIAL_VAULT_ALLOWANCE = 1_000_000_000 ether` (1 billion). Total supply starts at 0 and grows with minting. There is no 1 trillion constant anywhere in the contract. The vault reserve is 1 billion. Additional supply is minted on demand by authorized contracts (game, coin, coinflip) with no cap.
- **Mismatch:** Paper claims "one trillion wwXRP." The contract's only fixed supply quantity is the 1 billion vault allowance. There is no mechanism to pre-allocate or cap total supply at 1 trillion. The "one trillion" figure likely confuses WWXRP's vault allowance (1 billion) with the sDGNRS initial supply (1 trillion, from StakedDegenerusStonk.sol line 231: `INITIAL_SUPPLY = 1_000_000_000_000 * 1e18`).
- **Severity:** Major

### TS-03: S4.1 burn description conflates active-game and post-gameOver behavior

- **Paper:** S4.1 lines 3142-3149. Describes DGNRS burns as: "burn tokens for a pro-rata share... VRF multiplier (25%-175%), half the rolled ETH is paid directly and half is converted to lootbox rewards, and your share of queued BURNIE only pays out after the next coinflip resolves."
- **Contract:** StakedDegenerusStonk.sol `burn()` (lines 478-486). Two distinct paths: (1) post-gameOver: deterministic payout of ETH+stETH only, no BURNIE, no VRF, no gambling (line 480-482); (2) active game: gambling path with VRF roll, 50/50 ETH/lootbox split, BURNIE on coinflip win (line 484). DegenerusStonk.sol `burn()` (line 229) is post-gameOver only (reverts with `GameNotOver` during active game).
- **Mismatch:** S4.1 presents all burn mechanics (VRF, 50/50 split, coinflip BURNIE) as if they always apply. The contract has two completely separate paths. Post-gameOver burns are deterministic with no gambling, no BURNIE, and no lootbox conversion. The paper does not mention this bifurcation. A reader planning a post-gameOver burn strategy would expect VRF variance and BURNIE payouts that will not occur.
- **Severity:** Info

### TS-04: App. C "no minting after deployment" is technically correct but misleading about creator vesting

- **Paper:** App. C line 5457, "DGNRS is a deflationary token with no minting after deployment."
- **Contract:** StakedDegenerusStonk.sol constructor mints the entire 1T supply at deployment (lines 300-301). No further minting functions exist. DegenerusStonk.sol constructor (lines 113-123) issues 50B DGNRS to creator and holds remaining 150B for vesting. `claimVested()` (lines 202-213) releases 5B DGNRS per game level to vault owner, up to 200B total (fully vested at level 30).
- **Mismatch:** "No minting after deployment" is correct for sDGNRS (entire supply minted in constructor). For DGNRS, the 200B wrapper tokens are all backed by sDGNRS minted at deployment, so no new minting occurs. However, the creator's access to their 20% is not immediate: only 50B (5% of total) is available at deploy, with the remaining 150B vesting over 30 levels. The paper's "20% of supply is allocated to the creator at deployment" (line 5457) is correct about allocation (the sDGNRS is minted to the DGNRS contract) but does not disclose the vesting schedule. This is relevant context for assessing creator liquidity and sell pressure.
- **Severity:** Info

---

## Contracts Verification Detail

### DegenerusStonk.sol (DGNRS wrapper)

**Paper claims verified:**
- S4.1 "creator 20% transferable": CONFIRMED. Creator receives CREATOR_INITIAL (50B at deploy, vesting to 200B = 20% of 1T). DegenerusStonk.sol is a standard ERC20 with transfer/transferFrom (lines 142-167). Only DGNRS is transferable; sDGNRS is soulbound.
- S4.1 "burn for pro-rata ETH+stETH+BURNIE": CONFIRMED with nuance (TS-01, TS-03). DegenerusStonk.burn() (line 227) delegates to stonk.burn() and distributes ETH, stETH, and BURNIE. Post-gameOver only (line 229 reverts with GameNotOver during active game). Gambling burns go through StakedDegenerusStonk.burnWrapped().
- App. C "no secondary market for sDGNRS": CONFIRMED. sDGNRS has no transfer capability for holders. DGNRS wrapper is transferable (creator allocation only).
- 1-year post-gameOver sweep: DegenerusStonk.sol `yearSweep()` (lines 304-338) distributes remaining backing 50/50 to GNRUS and vault after 365 days post-gameOver. Not explicitly described in paper sections S4.1 or App. C. This is an implementation detail (Info-level, not flagged as discrepancy since the paper focuses on the 30-day final sweep in S10, and this 1-year sweep is a separate mechanism for unclaimed DGNRS wrapper tokens).

### StakedDegenerusStonk.sol (sDGNRS)

**Paper claims verified:**
- All pool BPS constants match (see Deferred #1 above).
- Soulbound confirmed (see Deferred #2a above).
- afKing mode and 10 ETH takeProfit confirmed (see Deferred #2b, 2c above).
- VRF multiplier 25-175% confirmed (see Deferred #2d above).
- 50/50 ETH/lootbox split confirmed (see Deferred #2e above).
- Pool enum matches paper ordering: Whale, Affiliate, Lootbox, Reward, Earlybird (lines 187-194).
- `burnAtGameOver()` (line 455) burns all undistributed pool tokens. Consistent with paper's "deflationary" claim.
- ETH-preferential payout: `_deterministicBurnFrom` (lines 539-545) pays ETH first, stETH as fallback. Consistent with App. C description.
- Gambling burn 160 ETH daily EV cap per wallet (line 247: `MAX_DAILY_REDEMPTION_EV = 160 ether`). Not mentioned in paper but is a protective mechanism, not a discrepancy.
- 50% supply cap per period for gambling burns (line 753). Not mentioned in paper but is a protective mechanism, not a discrepancy.

### WrappedWrappedXRP.sol (WWXRP)

**Paper claims verified:**
- S4.1 "a valueless memecoin distributed as a consolation prize to losers": CONFIRMED. Contract header describes it as "a joke prize" (line 7). `mintPrize()` (line 346) allows game/coin/coinflip to mint unbacked WWXRP as prizes.
- S4.1 "one trillion wwXRP": DISCREPANCY (TS-02). Vault allowance is 1 billion, not 1 trillion.
- App. G "1 WWXRP consolation" (coinflip loss, degenerette 0-match, lootbox WWXRP path): WWXRP contract itself has no fixed consolation amount. The 1 WWXRP amount is determined by the calling contracts (game, coinflip). WWXRP.mintPrize() mints whatever amount is requested. Verification of the exact "1 WWXRP" amount requires checking BurnieCoinflip.sol (Plan 02) and game lootbox/degenerette modules (Phase 15, already verified). No discrepancy at the WWXRP contract level.
- Vault reserve mechanism: `vaultMintTo()` (line 367) allows vault to mint from uncirculating reserve (1B). `vaultAllowance` decrements on each mint. This is a silent mechanism not described in the paper but is Info-level (vault internal).
- wXRP backing/unwrap: Contract allows unwrapping WWXRP for wXRP if reserves exist (lines 294-310). Donate function (lines 318-330) allows adding wXRP reserves. These are implementation details not in paper scope.

---

## Sections With No Discrepancies Found

- **S4.1 creator 20% transferable allocation:** Matches contract exactly.
- **S4.1 / App. C pool distribution percentages (20/35/20/10/10/5):** All six match.
- **App. C soulbound mechanics:** sDGNRS has no transfer functions. Correctly described.
- **App. C afKing mode and 10 ETH takeProfit:** Set in constructor exactly as described.
- **S4.1 / App. C VRF multiplier 25-175%:** Roll range and application match.
- **S4.1 / App. C half ETH / half lootbox on burn:** 50/50 split confirmed in claimRedemption.
- **App. C ETH-preferential payout:** Contract pays ETH first, stETH as fallback. Matches.
- **S4.1 WWXRP as consolation prize:** Minting mechanism confirmed. Amounts determined by callers.

---

## Known Non-Issues (Not Flagged)

1. **VAULT_PERPETUAL_TICKETS=16 vs "4 tickets per level":** Units difference (entries vs purchases due to `<<2`). Not an error.
2. **stETH yield split "50/25/25" simplification:** The ~8% contract buffer is an implementation detail. Not flagged.
3. **GM-03 final sweep GNRUS omission:** Already reported in Phase 15. Not re-reported here. The DegenerusStonk.sol `yearSweep()` does split 50/50 to GNRUS and vault, which is a separate (later) sweep mechanism distinct from the 30-day GameOver sweep in GM-03.
4. **Gambling burn protective caps (160 ETH daily, 50% supply per period):** Not in paper but these are safety mechanisms, not discrepancies. Info-level omission at most.
5. **Post-gameOver BURNIE exclusion from burns:** Documented in TS-03 as Info. This is a design choice, not an error.
