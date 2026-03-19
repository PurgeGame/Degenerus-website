# EXTR-03: Support System Contracts
**Source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/
**Scope:** DegenerusAffiliate, DegenerusDeityPass, DegenerusQuests, DegenerusVault
**Status:** Complete

---

## DegenerusAffiliate.sol
**Lines:** 847 | **Functions:** 17 (public/external: 7, internal/private: 10)
**Purpose:** 3-tier referral system with configurable kickback, per-sender commission caps, lootbox taper, and leaderboard tracking
**Inherits:** None (standalone)

### Player-Facing Functions
| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `createAffiliateCode(code_, kickbackPct)` | external | `bytes32 code_`, `uint8 kickbackPct` | Creates a permanent affiliate code owned by caller | Codes are first-come-first-served, permanent, non-transferable. Kickback 0-25%. Reserved values (0x0, 0x1) blocked |
| `referPlayer(code_)` | external | `bytes32 code_` | Registers caller as referred by an affiliate code | One-time set (or locked). No self-referral. VAULT-referred players can update during presale only |

### View Functions
| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `getReferrer(player)` | external view | `address player` | Returns the referrer address for a player (address(0) if none) |
| `affiliateTop(lvl)` | external view | `uint24 lvl` | Returns top affiliate address + score for a given level |
| `affiliateScore(lvl, player)` | external view | `uint24 lvl`, `address player` | Returns affiliate's base earnings score for a level |
| `totalAffiliateScore(lvl)` | external view | `uint24 lvl` | Returns total affiliate score across all affiliates for a level (denominator for DGNRS claims) |
| `affiliateBonusPointsBest(currLevel, player)` | external view | `uint24 currLevel`, `address player` | Sums affiliate scores from previous 5 levels; 1 point per 1 ETH, capped at 50. Used for mint trait bonus |
| `affiliateCode(code)` | public | `bytes32` | Returns AffiliateCodeInfo (owner address, kickback percentage) |

### System/Integration Functions
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `payAffiliate(amount, code, sender, lvl, isFreshEth, lootboxActivityScore)` | external | Coin, Game | Core payout: resolves referral, scales reward, applies per-sender cap (0.5 ETH BURNIE/level), updates leaderboard, applies lootbox taper, computes kickback, distributes to 3-tier chain (base + 20% upline1 + 4% upline2) as weighted-random coinflip credit. Returns kickback amount to caller |

### Internal/Private Functions (key ones)
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `_applyLootboxTaper(amt, score)` | private pure | payAffiliate | Linear taper: 100% at activity 10,000 to 25% at activity 25,500+. Leaderboard uses full untapered amount |
| `_rollWeightedAffiliateWinner(players, amounts, count, total, sender, code)` | private view | payAffiliate | When multiple recipients (affiliate + uplines), rolls single winner with probability proportional to their share. Preserves each recipient's EV |
| `_routeAffiliateReward(player, amount)` | private | payAffiliate | Routes reward as coinflip credit via BurnieCoin.creditFlip |
| `_setReferralCode(player, code)` | private | Multiple | Stores referral code; emits ReferralUpdated with resolved referrer address |
| `_vaultReferralMutable(code)` | private view | payAffiliate, referPlayer | Allows VAULT-referred or locked players to update referral during presale only |

### Key Mechanics (non-function)
- **3-tier commission chain:** Direct affiliate gets base reward (minus kickback). Upline1 gets 20% of scaled amount. Upline2 gets 4% (20% of upline1). All paid as coinflip credit, not direct mint
- **Reward rates:** Fresh ETH levels 0-3: 25%. Fresh ETH levels 4+: 20%. Recycled ETH (all levels): 5%. Amount is BURNIE-denominated (converted upstream)
- **Kickback:** 0-25% of affiliate reward returned to the referred player. Configurable per affiliate code
- **Per-sender commission cap:** Max 0.5 ETH BURNIE per affiliate per sender per level. Prevents single whale from dominating affiliate earnings
- **Lootbox taper:** Activity score 10,000-25,500 linearly reduces affiliate payout from 100% to 25%. Applied to payout only; leaderboard always records full amount
- **Referral locking:** Invalid referral attempts (self-referral, unknown code) permanently lock the slot to VAULT. REF_CODE_LOCKED sentinel (bytes32(1)) marks locked
- **Weighted-random distribution:** When 2-3 recipients exist, a single weighted winner is rolled (one gets everything, probability proportional to share). This preserves EV while saving gas
- **Constructor bootstrap:** Accepts arrays of pre-created codes and referrals. VAULT and DGNRS codes are hardcoded, cross-referred to each other
- **Quest integration:** Each affiliate payout triggers `affiliateQuestReward()` for quest progress, adding bonus on top

---

## DegenerusDeityPass.sol
**Lines:** 392 | **Functions:** 18 (public/external: 14, internal/private: 4)
**Purpose:** Soulbound ERC721 for deity passes; 32 tokens max (one per symbol, tokenId = symbolId 0-31) with on-chain SVG rendering
**Inherits:** None (standalone, implements ERC721/ERC165 manually)

### Player-Facing Functions
| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `approve(_, _)` | external pure | any | Always reverts with `Soulbound()` | Transfers permanently disabled |
| `setApprovalForAll(_, _)` | external pure | any | Always reverts with `Soulbound()` | Transfers permanently disabled |
| `transferFrom(_, _, _)` | external pure | any | Always reverts with `Soulbound()` | Transfers permanently disabled |
| `safeTransferFrom(_, _, _)` | external pure | any | Always reverts with `Soulbound()` | Transfers permanently disabled |
| `safeTransferFrom(_, _, _, _)` | external pure | any | Always reverts with `Soulbound()` | Transfers permanently disabled |

### View Functions
| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `name()` | external pure | none | Returns "Degenerus Deity Pass" |
| `symbol()` | external pure | none | Returns "DEITY" |
| `owner()` | external view | none | Returns contract owner |
| `balanceOf(account)` | external view | `address account` | Returns NFT balance for address |
| `ownerOf(tokenId)` | external view | `uint256 tokenId` | Returns owner of a specific deity pass |
| `getApproved(tokenId)` | external view | `uint256 tokenId` | Always returns address(0) (soulbound) |
| `isApprovedForAll(_, _)` | external pure | any | Always returns false (soulbound) |
| `supportsInterface(id)` | external pure | `bytes4 id` | ERC165: supports ERC721, ERC721Metadata, ERC165 |
| `tokenURI(tokenId)` | external view | `uint256 tokenId` | Returns fully on-chain SVG as base64-encoded data URI. Uses internal renderer by default; optional external renderer via bounded staticcall with fallback |
| `renderColors()` | external view | none | Returns current outline, background, and non-crypto symbol colors |

### Admin/Configuration Functions
| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `transferOwnership(newOwner)` | external | `address newOwner` | Transfers contract ownership (owner only) |
| `setRenderer(newRenderer)` | external | `address newRenderer` | Sets optional external renderer; address(0) disables (owner only) |
| `setRenderColors(outline, bg, nonCrypto)` | external | 3x `string` | Updates on-chain SVG render colors (owner only). Validates hex format (#RRGGBB) |

### System/Integration Functions
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `mint(to, tokenId)` | external | Game only | Mints a deity pass. tokenId must be 0-31, not already minted. One per symbol. Emits ERC721 Transfer |

### Key Mechanics (non-function)
- **Soulbound:** All transfer/approve functions revert with `Soulbound()`. Once minted, deity passes cannot be moved
- **32 token cap:** tokenId = symbolId (0-31). 4 quadrants x 8 symbols. Quadrant 0 = crypto symbols, quadrants 1-3 = dice/other
- **On-chain SVG:** Renders an SVG card with the symbol icon. Fetches icon path data from Icons32Data contract. Non-crypto symbols use a separate fill color
- **External renderer:** Optional upgradeable renderer (set by owner). Uses bounded staticcall with try/catch; falls back to internal renderer on failure. Cannot break tokenURI
- **Pricing curve:** Not in this contract (handled by DegenerusGame/WhaleModule). This contract only handles minting and NFT metadata

---

## DegenerusQuests.sol
**Lines:** 1,598 | **Functions:** 27 (public/external: 10, internal/private: 17)
**Purpose:** Tracks two rotating daily quests with VRF-based selection, per-player progress versioning, streak system, and fixed BURNIE rewards
**Inherits:** IDegenerusQuests (interface)

### Player-Facing Functions

None. All mutation is triggered by BurnieCoin (via handle* functions) or Game (via rollDailyQuest, awardQuestStreakBonus).

### View Functions
| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `getActiveQuests()` | external view | none | Returns QuestInfo[2] with quest type, day, and requirements for each slot |
| `playerQuestStates(player)` | external view | `address player` | Returns raw state: streak, lastCompletedDay, per-slot progress and completion |
| `getPlayerQuestView(player)` | external view | `address player` | Comprehensive view: quests, progress, completion, effective streak (with shield/decay preview). Recommended for frontend UI |

### System/Integration Functions
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `rollDailyQuest(day, entropy)` | external | Coin, Coinflip | Rolls daily quests using VRF entropy. Slot 0 = fixed MINT_ETH. Slot 1 = weighted-random from remaining types. Bumps version to invalidate stale progress |
| `awardQuestStreakBonus(player, amount, currentDay)` | external | Game only | Adds streak days to a player (e.g., from whale pass purchase). Clamps at uint24 max |
| `handleMint(player, quantity, paidWithEth)` | external | Coin, Coinflip | Handles mint progress for MINT_ETH (slot 0) and MINT_BURNIE quests. Returns (reward, questType, streak, completed) |
| `handleFlip(player, flipCredit)` | external | Coin, Coinflip | Handles coinflip deposit progress. Target: 2,000 BURNIE |
| `handleDecimator(player, burnAmount)` | external | Coin, Coinflip | Handles decimator burn progress. Target: 2,000 BURNIE |
| `handleAffiliate(player, amount)` | external | Coin, Coinflip | Handles affiliate earnings progress. Target: 2,000 BURNIE |
| `handleLootBox(player, amountWei)` | external | Coin, Coinflip | Handles lootbox purchase progress. Target: 2x current mint price (ETH), capped at 0.5 ETH |
| `handleDegenerette(player, amount, paidWithEth)` | external | Coin, Coinflip | Handles Degenerette bet progress. ETH target: 2x mint price capped at 0.5 ETH. BURNIE target: 2,000 BURNIE |

### Internal/Private Functions (key ones)
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `_rollDailyQuest(day, entropy)` | private | rollDailyQuest | Core rolling: slot 0 = MINT_ETH, slot 1 = weighted random. Checks decimator availability |
| `_bonusQuestType(entropy, primaryType, decAllowed)` | private pure | _rollDailyQuest | Weighted selection for slot 1: MINT_BURNIE 10x, FLIP 4x, DECIMATOR 4x (if allowed), LOOTBOX 3x, others 1x |
| `_questSyncState(state, player, currentDay)` | private | All handlers | Resets streak if day missed (uses shields if available). Snapshots baseStreak for rewards. Resets completionMask |
| `_questSyncProgress(state, slot, currentDay, questVersion)` | private | All handlers | Resets slot progress if day or version changed (anti-exploit) |
| `_questComplete(player, state, slot, quest)` | private | _questCompleteWithPair | Marks slot complete, increments streak on first completion of day, returns reward (100 or 200 BURNIE) |
| `_questCompleteWithPair(...)` | private | Multiple handlers | After completing one slot, checks if other slot also meets target and auto-completes ("combo completion") |
| `_questTargetValue(quest, slot, mintPrice)` | private pure | Multiple | Returns target per quest type: MINT_BURNIE=1 ticket, MINT_ETH=1x mint price (capped 0.5 ETH), LOOTBOX/DEGENERETTE_ETH=2x mint price (capped 0.5 ETH), FLIP/DECIMATOR/AFFILIATE/DEGENERETTE_BURNIE=2,000 BURNIE |
| `_canRollDecimatorQuest()` | private view | _rollDailyQuest | Decimator quests available at: x00 milestones, x5 levels (except x95), and only when decWindowOpenFlag is true |

### Key Mechanics (non-function)
- **2-slot daily quests:** Slot 0 is always MINT_ETH ("deposit new ETH"). Slot 1 is weighted-random from 8 other types (MINT_BURNIE, FLIP, AFFILIATE, DECIMATOR, LOOTBOX, DEGENERETTE_ETH, DEGENERETTE_BURNIE; type 4 is reserved/retired)
- **9 quest types:** 0=MINT_BURNIE, 1=MINT_ETH, 2=FLIP, 3=AFFILIATE, 4=RESERVED, 5=DECIMATOR, 6=LOOTBOX, 7=DEGENERETTE_ETH, 8=DEGENERETTE_BURNIE
- **Fixed targets (no difficulty tiers):** MINT_BURNIE = 1 ticket. ETH-based (MINT_ETH/LOOTBOX/DEGENERETTE_ETH) = multiplier x mintPrice, capped at 0.5 ETH. BURNIE-based (FLIP/DECIMATOR/AFFILIATE/DEGENERETTE_BURNIE) = 2,000 BURNIE
- **Fixed rewards:** Slot 0 = 100 BURNIE, Slot 1 = 200 BURNIE. Credited as coinflip stake
- **Streak system:** Increments on first quest completion of the day. Missing a day resets to 0 unless streak shields cover the gap. Shields are stackable and consumed automatically
- **Slot 1 requires Slot 0:** Slot 1 can only complete if Slot 0 is already complete for that day. Prevents skipping the deposit quest
- **Combo completion:** Completing one slot automatically checks the other; if target is already met, both complete in one transaction
- **Progress versioning:** Each quest has a monotonic version. Player progress is invalidated when version mismatches (prevents stale progress exploits)
- **VRF entropy usage:** Slot 0 uses entropy directly. Slot 1 uses swapped 128-bit halves for independent randomness

---

## DegenerusVault.sol
**Lines:** 1,061 | **Functions:** 45 (public/external: 35, internal/private: 10)
**Purpose:** Multi-asset vault with two independent share classes (DGVB for BURNIE, DGVE for ETH+stETH) and gameplay proxy for vault owner
**Inherits:** None (standalone). Deploys DegenerusVaultShare (ERC20) as child contracts.

Note: DegenerusVaultShare is defined in the same file (lines 139-301, 14 functions). Functions below cover both DegenerusVault and DegenerusVaultShare.

### DegenerusVaultShare (child ERC20, deployed by vault constructor)

| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `approve(spender, amount)` | external | `address`, `uint256` | Standard ERC20 approve |
| `transfer(to, amount)` | external | `address`, `uint256` | Standard ERC20 transfer |
| `transferFrom(from, to, amount)` | external | `address`, `address`, `uint256` | Standard ERC20 transferFrom |
| `vaultMint(to, amount)` | external | `address`, `uint256` | Vault-only mint (used for refill) |
| `vaultBurn(from, amount)` | external | `address`, `uint256` | Vault-only burn (used during claims) |
| 5 view functions (name, symbol, decimals, totalSupply, balanceOf, allowance) | public | varies | Standard ERC20 views |

### Player-Facing Functions (Burn Shares for Assets)
| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `burnCoin(player, amount)` | external | `address player`, `uint256 amount` | Burns DGVB shares to redeem proportional BURNIE | coinOut = (reserve * shares) / supply. Pays from vault balance first, then claimable coinflips, then mints remainder. Refills 1T shares if entire supply burned |
| `burnEth(player, amount)` | external | `address player`, `uint256 amount` | Burns DGVE shares to redeem proportional ETH + stETH | ETH-preferential payout: ETH first, stETH for remainder. May auto-claim game winnings if needed. Refills 1T shares if entire supply burned |

### View Functions
| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `previewCoin(amount)` | external view | `uint256 amount` | Preview BURNIE output for burning DGVB shares |
| `previewEth(amount)` | external view | `uint256 amount` | Preview ETH/stETH output for burning DGVE shares |
| `previewBurnForCoinOut(coinOut)` | external view | `uint256 coinOut` | Reverse: calculate DGVB shares needed for target BURNIE output (ceiling division) |
| `previewBurnForEthOut(targetValue)` | external view | `uint256 targetValue` | Reverse: calculate DGVE shares needed for target ETH value (ceiling division) |
| `isVaultOwner(account)` | external view | `address account` | Returns true if account holds >50.1% of DGVE supply |

### System/Integration Functions (Game Only)
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `deposit(coinAmount, stEthAmount)` | external payable | Game only | Deposits ETH (via msg.value), stETH (pulled via transferFrom), and BURNIE mint allowance (virtual escrow). ETH+stETH accrue to DGVE. BURNIE accrues to DGVB |
| `receive()` | external payable | Anyone | Accepts ETH donations (accrues to DGVE) |

### Vault Owner Gameplay Proxy (requires >50.1% DGVE)

These functions let the vault owner play the game on behalf of the vault. All require `onlyVaultOwner`.

| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `gameAdvance()` | external | none | Advance the game |
| `gamePurchase(tickets, lootboxes, affiliate, payKind, ethValue)` | external payable | 5 params | Purchase tickets + lootboxes with ETH or BURNIE |
| `gamePurchaseTicketsBurnie(ticketQuantity)` | external | `uint256` | Purchase tickets with BURNIE |
| `gamePurchaseBurnieLootbox(burnieAmount)` | external | `uint256` | Purchase BURNIE lootbox |
| `gameOpenLootBox(lootboxIndex)` | external | `uint48` | Open a vault-owned lootbox |
| `gamePurchaseDeityPassFromBoon(priceWei, symbolId)` | external payable | `uint256`, `uint8` | Purchase deity pass using vault funds (auto-claims winnings if short) |
| `gameClaimWinnings()` | external | none | Claim game winnings (prefers stETH) |
| `gameClaimWhalePass()` | external | none | Claim whale pass for vault |
| `gameDegeneretteBetEth(amountPerTicket, ticketCount, customTicket, heroQuadrant, ethValue)` | external payable | 5 params | Place Degenerette ETH bet |
| `gameDegeneretteBetBurnie(amountPerTicket, ticketCount, customTicket, heroQuadrant)` | external | 4 params | Place Degenerette BURNIE bet |
| `gameDegeneretteBetWwxrp(amountPerTicket, ticketCount, customTicket, heroQuadrant)` | external | 4 params | Place Degenerette WWXRP bet |
| `gameResolveDegeneretteBets(betIds)` | external | `uint64[]` | Resolve Degenerette bets |
| `gameSetAutoRebuy(enabled)` | external | `bool` | Enable/disable ticket auto-rebuy |
| `gameSetAutoRebuyTakeProfit(takeProfit)` | external | `uint256` | Set ticket auto-rebuy take profit |
| `gameSetDecimatorAutoRebuy(enabled)` | external | `bool` | Enable/disable decimator auto-rebuy |
| `gameSetAfKingMode(enabled, ethTakeProfit, coinTakeProfit)` | external | 3 params | Configure AFK king mode |
| `gameSetOperatorApproval(operator, approved)` | external | `address`, `bool` | Approve/revoke operator for vault game actions |
| `coinDepositCoinflip(amount)` | external | `uint256` | Deposit BURNIE into coinflip |
| `coinClaimCoinflips(amount)` | external | `uint256` | Claim coinflip winnings |
| `coinClaimCoinflipsTakeProfit(multiples)` | external | `uint256` | Claim coinflip winnings as take profit multiples |
| `coinDecimatorBurn(amount)` | external | `uint256` | Burn BURNIE in decimator |
| `coinSetAutoRebuy(enabled, takeProfit)` | external | `bool`, `uint256` | Configure coinflip auto-rebuy |
| `coinSetAutoRebuyTakeProfit(takeProfit)` | external | `uint256` | Set coinflip auto-rebuy take profit |
| `wwxrpMint(to, amount)` | external | `address`, `uint256` | Mint WWXRP from vault's uncirculating reserve |
| `jackpotsClaimDecimator(lvl)` | external | `uint24` | Claim decimator jackpot for vault |

### Key Mechanics (non-function)
- **Two share classes:** DGVB (Degenerus Vault Burnie) claims BURNIE. DGVE (Degenerus Vault Eth) claims ETH + stETH. Independent supplies and claim rights. Each starts at 1T supply minted to CREATOR
- **Claim formula:** `claimAmount = (reserve * sharesBurned) / totalShareSupply`. Standard pro-rata redemption
- **Refill mechanism:** If a user burns ALL shares of a class, they receive 1T fresh shares. Prevents division-by-zero and keeps the share token alive
- **ETH-preferential payout:** When burning DGVE, ETH is paid first. stETH covers any remainder. May auto-claim game winnings if ETH balance is insufficient
- **BURNIE virtual deposit:** Game calls `deposit()` with `coinAmount`, which calls `coinToken.vaultEscrow()` to increase the vault's mint allowance. No actual token transfer. On claim, vault mints from this allowance
- **Vault owner = >50.1% DGVE holder:** All gameplay actions are gated by `onlyVaultOwner`, which checks `balance * 1000 > supply * 501`. This is a governance mechanism
- **Gameplay proxy completeness:** The vault exposes every game action (purchase, lootbox, deity pass, degenerette betting, coinflip, decimator, auto-rebuy, afKing mode, operator approval, WWXRP minting). The vault owner can fully participate in the game
- **stETH rebase yield:** stETH balance grows via Lido rebase. This yield accrues to DGVE holders automatically (no explicit distribution needed)
- **DegenerusVaultShare:** Separate ERC20 contract (not the vault itself). Deployed in vault constructor. Standard transfer/approve plus vault-only mint/burn. Users can trade vault shares freely
