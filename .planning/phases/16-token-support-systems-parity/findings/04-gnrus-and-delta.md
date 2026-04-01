# GNRUS Verification & Delta Tracking Findings

**Verified:** 2026-03-31
**Paper:** theory/index.html
**Contract:** GNRUS.sol (547 lines)
**Contract source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/

---

## GNRUS Verification

### Contract Overview

GNRUS.sol (DegenerusDonations) is a soulbound ERC20 with:
- 1T GNRUS minted to contract itself at deploy (unallocated pool)
- Per-level governance distributing 2% of remaining unallocated GNRUS to winning recipient
- Burn-for-redemption (proportional ETH + stETH)
- Game-only hooks for level resolution and gameover finalization

### Paper Claims Verified

**S4.1 line 3158: "GNRUS is the donation contract"**
- Contract: Header declares `@title DegenerusDonations (GNRUS)` (line 34). Contract name is `GNRUS`, symbol is `GNRUS` (line 132).
- **CONFIRMED**

**S4.1 line 3158: "It receives 25% of stETH yield"**
- Contract: GNRUS.sol itself has no yield routing logic. It receives ETH via `receive()` (line 515) and can receive stETH transfers.
- Verified in DegenerusGameJackpotModule.sol `_distributeYieldSurplus` (line 899): `quarterShare = (yieldPool * 2300) / 10_000` (23%) each to VAULT, SDGNRS, and GNRUS (line 915). The paper's "25%" simplifies the actual 23% (with ~8% buffer).
- Per CLAUDE.md/MEMORY.md: the 50/25/25 simplification is deliberate and known. Not flagged.
- **CONFIRMED (known simplification)**

**S4.1 line 3158-3159: "Each level, DGNRS holders vote on a recipient address (the vault has a 5% vote bonus and can always propose)"**
- Contract: `propose()` (lines 364-403). Community members need >= 0.5% of sDGNRS snapshot supply to propose (PROPOSE_THRESHOLD_BPS = 50, line 215). Vault owner can submit up to 5 proposals per level (MAX_CREATOR_PROPOSALS = 5, line 222). The vault owner bypasses the community threshold check (line 377).
- `vote()` (lines 415-440). Vote weight equals sDGNRS balance. Vault owner gets bonus: `weight += uint48((uint256(levelSdgnrsSnapshot[level]) * VAULT_VOTE_BPS) / BPS_DENOM)` where VAULT_VOTE_BPS = 500 (line 218) = 5% of snapshot supply.
- **CONFIRMED.** "Can always propose" is accurate (vault owner bypasses threshold). "5% vote bonus" confirmed at line 218.

**S4.1 line 3160: "The winning address receives 2% of the remaining unallocated GNRUS supply"**
- Contract: `pickCharity()` (lines 452-508). Line 492: `distribution = (unallocated * DISTRIBUTION_BPS) / BPS_DENOM` where DISTRIBUTION_BPS = 200 (line 209) = 2%.
- **CONFIRMED**

**S4.1 line 3160: "GNRUS is also soulbound"**
- Contract: `transfer()`, `transferFrom()`, `approve()` all revert with `TransferDisabled()` (lines 263-269).
- **CONFIRMED**

**S4.1 lines 3160-3162: "can be burned for a proportional share of the stETH yield accumulated in the contract"**
- Contract: `burn()` (lines 282-329). Calculates `owed = ((ethBal + stethBal + claimable) * amount) / supply` (line 301). Distributes proportional shares of both ETH and stETH (lines 311-312: `ethOut`, `stethOut`). Also claims game winnings if needed (line 306).
- **PARTIAL MATCH.** See TS-05 below. The paper says "stETH yield" but the burn distributes both ETH and stETH (plus claimable game winnings). The paper's framing is misleading since GNRUS can hold ETH from game distributions (33/33/34 gameover sweep, yield surplus), not just stETH.

**S4.3 line 3204-3207: "yield routing includes GNRUS"**
- Contract: DegenerusGameJackpotModule.sol line 915: `_addClaimableEth(ContractAddresses.GNRUS, quarterShare, rngWord)`.
- **CONFIRMED.** GNRUS receives 23% (paper's 25%) of yield surplus on each VRF resolution day.

**App. A line 4954-4957: "Governance proposal gate 20 hours"**
- This App. A entry is labeled "VRF recovery" and refers to DegenerusAdmin.sol's `ADMIN_STALL_THRESHOLD = 20 hours` (line 420), not GNRUS governance. GNRUS.sol has no time gate for proposals.
- **NOT A GNRUS CLAIM.** The 20-hour gate is for VRF coordinator swap proposals, not GNRUS donation governance. No GNRUS discrepancy here.

**GM-03 receiving end: burnAtGameOver handles 34% sweep correctly**
- Contract: `burnAtGameOver()` (lines 340-352). Called by game (`onlyGame`). Burns all unallocated GNRUS (contract's own balance). Sets `finalized = true` to prevent double-call.
- The game's GameOverModule pushes ETH/stETH to GNRUS as part of the 33/33/34 sweep. After `burnAtGameOver`, only distributed GNRUS remains in circulation, backed by whatever ETH/stETH the contract holds.
- **No separate issue on the GNRUS receiving end.** The function correctly burns unallocated tokens and accepts the sweep funds via `receive()`. Per Pitfall 3, GM-03 is not re-reported.

### GNRUS Findings

#### TS-05: S4.1 burn description says "stETH yield" but GNRUS burn distributes ETH + stETH + claimable

- **Paper:** S4.1 line 3161, "burned for a proportional share of the stETH yield accumulated in the contract"
- **Contract:** GNRUS.sol, `burn()` lines 296-301. Calculates owed from `ethBal + stethBal + claimable` (ETH balance + stETH balance + game claimable winnings). Distributes both ETH (line 326) and stETH (line 323).
- **Mismatch:** Paper says only "stETH yield" but the GNRUS contract distributes proportional shares of ALL assets it holds: ETH (from yield surplus distributions and gameover sweep), stETH (from rebase appreciation), and claimable game winnings. A reader would expect only stETH in the redemption, but ETH is the primary asset distributed through yield surplus routing.
- **Severity:** Minor

---

## Delta Tracking: Token Contracts

Compared current contract source against v2.1 EXTR-02 catalog (git commit b794035).

### GNRUS.sol (entirely new)

Not in v2.1 catalog. All functions are new additions:

**Public/External (12):**
- `transfer()`, `transferFrom()`, `approve()` (soulbound, all revert)
- `burn(amount)` (burn-for-redemption)
- `burnAtGameOver()` (game-only gameover finalization)
- `propose(recipient)` (governance proposal)
- `vote(proposalId, approveVote)` (governance vote)
- `pickCharity(level)` (game-only level resolution)
- `getProposal(proposalId)` (view)
- `getLevelProposals(level)` (view)
- `receive()` (accept ETH)
- Standard ERC20 state: `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`

**Private (1):**
- `_mint(to, amount)`

### BurnieCoin.sol

**EXTR-02:** 30 functions (22 external, 8 private)
**Current:** 32 functions

**Removed since v2.1:**
- `creditCoin(player, amount)` -- direct BURNIE mint to wallet removed
- `creditFlipBatch(players[3], amounts[3])` -- batch flip credit removed
- `mintForCoinflip(to, amount)` -- direct mint for coinflip removed
- `creditLinkReward(player, amount)` -- admin LINK reward credit removed

**New since v2.1:**
- `_toUint128(value)` -- private utility for safe uint128 casting
- `_consumeCoinflipShortfall(player, amount)` -- consumes coinflip for burn ops (no mint)
- Additional interface function declarations at top of file

**Changed since v2.1:**
- `burnCoin` / `decimatorBurn` now use `_consumeCoinflipShortfall` instead of claim-then-burn pattern
- Supply struct now packs `totalSupply` + `vaultAllowance` in a single slot (storage optimization)

### BurnieCoinflip.sol

**EXTR-02:** 31 functions (14 external, 17 private)
**Current:** 37 functions

**New since v2.1:**
- `claimCoinflipsTakeProfit(player, multiples)` -- claim as take-profit multiples
- `setCoinflipAutoRebuyTakeProfit(player, takeProfit)` -- update take-profit amount separately
- `settleFlipModeChange(player)` -- settle before afKing mode change
- `consumeCoinflipsForBurn(player, amount)` -- consume for burn ops (BurnieCoin only)
- `_afKingDeityBonusHalfBpsWithLevel(player, level)` -- deity bonus per level active
- `_updateTopDayBettor(player, amount, day)` -- BAF daily leaderboard tracking

**Changed since v2.1:**
- `_afKingRecyclingBonus` now includes level-scaled deity bonus parameter
- Auto-rebuy system now supports configurable take-profit thresholds

### DegenerusStonk.sol

**EXTR-02:** 10 functions (8 external, 2 private)
**Current:** 11 functions (9 external, 2 private)

**New since v2.1:**
- `yearSweep()` -- distributes remaining backing 50/50 to GNRUS and vault after 365 days post-gameOver

**Changed since v2.1 (per delta-v7 report, 2 changed functions):**
- `burn()` -- now receives ETH/stETH/BURNIE from sDGNRS burn and forwards to caller (signature changed to return 3 values)
- `unwrapTo()` -- added VRF stall guard (>5h since last VRF processed blocks unwrap to prevent vote-stacking)

### StakedDegenerusStonk.sol

**EXTR-02:** 17 functions (12 external, 5 private)
**Current:** Comparable function count with minor additions

**New since v2.1:**
- `burnRemainingPools()` -- burns all undistributed pool tokens at gameover (was previously internal logic)
- `burnAtGameOver()` -- gameover finalization (called by game)
- `transferBetweenPools(from, to, amount)` -- internal pool rebalancing

**No functions removed.**

### WrappedWrappedXRP.sol

**EXTR-02:** 14 functions (12 external, 2 private)
**Current:** 16 functions

**New since v2.1:**
- `burnForGame(from, amount)` -- game can burn WWXRP from players (for Degenerette WWXRP wagers)
- Minor additions to view functions

**No functions removed.**

---

## Delta Tracking: Support Systems

Compared current contract source against v2.1 EXTR-03 catalog (git commit fe39239).

### DegenerusAffiliate.sol

**EXTR-03:** 17 functions (7 external, 10 private)
**Current:** 22 functions

**New since v2.1 (per delta-v7 AFF-01, UNPLANNED change commit a3e2341f):**
- `defaultCode(address)` -- pure function returning default referral code for any address using `bytes32(uint256(uint160(addr)))`
- `_resolveCodeOwner(code)` -- resolves code owner, handling default codes (address-derived) vs custom codes
- `_createAffiliateCode(code, kickbackPct, codeOwner)` -- extracted internal creation logic
- `_bootstrapReferral(player, code)` -- constructor bootstrap referral helper
- `_referrerAddress(player)` -- resolve stored code to address

**Changed since v2.1 (per delta-v7):**
- `referPlayer(code)` -- now handles default codes and VAULT-referred update during presale
- `payAffiliate(...)` -- now uses `_resolveCodeOwner` for default code resolution
- `createAffiliateCode(code, kickbackPct)` -- refactored to use `_createAffiliateCode` internal

**No functions removed.**

### DegenerusDeityPass.sol

**EXTR-03:** 18 functions (14 external, 4 private)
**Current:** Comparable function count

**No new, changed, or removed functions.** This contract was not modified in v7.

### DegenerusQuests.sol

**EXTR-03:** 27 functions (10 external, 17 private)
**Current:** 33 functions

**New since v2.1:**
- `_canRollDecimatorQuest()` -- availability check for decimator quest type
- `handleDegenerette(player, amount, paidWithEth)` -- Degenerette bet progress tracking (BURNIE and ETH)
- `_questCompleteWithPair(...)` -- combo completion logic (complete both slots in one tx)
- Additional private helpers for quest progress tracking

**Changed since v2.1:**
- `handleMint` -- now handles both MINT_ETH and MINT_BURNIE types
- `_rollDailyQuest` -- added decimator availability check
- `_bonusQuestType` -- added weighted selection weights and decimator conditional

**No functions removed.**

### DegenerusVault.sol

**EXTR-03:** 45 functions (35 external, 10 private)
**Current:** 79 function declarations (includes DegenerusVaultShare child contract at lines 139-301)

Note: The v2.1 catalog counted DegenerusVaultShare functions as part of DegenerusVault. The current file still defines both in the same file. The function count increase is primarily from additional gameplay proxy functions.

**New since v2.1:**
- `gameDegeneretteBetEth/Burnie/Wwxrp(...)` -- Degenerette betting proxies (3 functions)
- `gameResolveDegeneretteBets(betIds)` -- Degenerette resolution proxy
- `coinSetAutoRebuy/coinSetAutoRebuyTakeProfit` -- coinflip auto-rebuy config
- `gameSetDecimatorAutoRebuy(enabled)` -- decimator auto-rebuy
- `coinClaimCoinflipsTakeProfit(multiples)` -- take-profit claim
- `gameSetOperatorApproval(operator, approved)` -- operator approval

**No functions removed.**

---

## Summary

| Section | Items |
|---------|-------|
| GNRUS findings | 1 (TS-05, Minor) |
| Token contracts delta | 5 contracts compared, ~15 new functions, ~6 changed, ~4 removed |
| Support systems delta | 4 contracts compared, ~15 new functions, ~5 changed, 0 removed |
| GNRUS new contract | 13 functions documented as entirely new |
