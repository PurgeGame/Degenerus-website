# EXTR-02: Token Contracts
**Source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/
**Scope:** BurnieCoin, BurnieCoinflip, DegenerusStonk, StakedDegenerusStonk, WrappedWrappedXRP
**Status:** Complete

---

## BurnieCoin.sol
**Lines:** 1,065 | **Functions:** 30 (public/external: 22, internal/private: 8)
**Purpose:** ERC20 in-game token (BURNIE, 18 decimals) with minting, burning, quest routing, decimator burns, and vault escrow
**Inherits:** None (standalone)

### Player-Facing Functions
| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `transfer(to, amount)` | external | `address to`, `uint256 amount` | Standard ERC20 transfer; auto-claims coinflip shortfall if balance insufficient | Moves BURNIE between addresses; triggers `_claimCoinflipShortfall` |
| `transferFrom(from, to, amount)` | external | `address from`, `address to`, `uint256 amount` | Standard ERC20 transferFrom; game contract bypasses allowance check | Game contract has trusted-caller bypass (no approval needed) |
| `approve(spender, amount)` | external | `address spender`, `uint256 amount` | Standard ERC20 approve | Sets allowance; `type(uint256).max` = infinite approval |
| `decimatorBurn(player, amount)` | external | `address player`, `uint256 amount` | Burns BURNIE during active decimator window; computes bucket weight from activity score | Burns tokens (CEI), processes quest reward, applies boon boost, records burn weight in game contract. Min 1,000 BURNIE. Emits `DecimatorBurn` |
| `terminalDecimatorBurn(player, amount)` | external | `address player`, `uint256 amount` | Burns BURNIE as death bet (terminal decimator); always open (no milestone gating) | Burns tokens, records terminal dec burn in game. Blocked on lastPurchaseDay and after death clock expiry. Min 1,000 BURNIE. Emits `TerminalDecimatorBurn` |

### View Functions
| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `totalSupply()` | external view | none | Returns circulating supply (excludes vault allowance) |
| `supplyIncUncirculated()` | external view | none | Returns totalSupply + vaultAllowance |
| `vaultMintAllowance()` | external view | none | Returns vault's remaining mint allowance |
| `balanceOf(addr)` | public | `address` | Standard ERC20 balance mapping |
| `allowance(owner, spender)` | public | `address, address` | Standard ERC20 allowance mapping |
| `balanceOfWithClaimable(player)` | external view | `address player` | Returns balance + claimable coinflips (if RNG unlocked); vault gets +vaultAllowance |
| `claimableCoin()` | external view | none | Proxies to BurnieCoinflip for caller's claimable winnings |
| `previewClaimCoinflips(player)` | external view | `address player` | Proxies to BurnieCoinflip for player's preview |
| `coinflipAmount(player)` | external view | `address player` | Returns player's coinflip stake for current betting window |
| `coinflipAutoRebuyInfo(player)` | external view | `address player` | Returns auto-rebuy config (enabled, stopAmount, carry) |

### System/Integration Functions
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `burnForCoinflip(from, amount)` | external | BurnieCoinflip only | Burns BURNIE from player during coinflip deposit |
| `mintForCoinflip(to, amount)` | external | BurnieCoinflip only | Mints BURNIE to player on coinflip claim |
| `mintForGame(to, amount)` | external | Game only | Mints BURNIE for game payouts (e.g., Degenerette wins) |
| `creditCoin(player, amount)` | external | Game, Affiliate | Mints BURNIE directly to player wallet |
| `creditFlip(player, amount)` | external | Game, Affiliate | Forwards to BurnieCoinflip to credit flip stake |
| `creditFlipBatch(players[3], amounts[3])` | external | Game, Affiliate | Batch credit flip stakes to 3 players |
| `creditLinkReward(player, amount)` | external | Admin only | Credits flip stake as reward for LINK donation |
| `burnCoin(target, amount)` | external | Game, Affiliate | Burns BURNIE from target (gameplay/affiliate flows); auto-consumes coinflip shortfall |
| `vaultEscrow(amount)` | external | Game, Vault | Increases vault mint allowance without transferring tokens |
| `vaultMintTo(to, amount)` | external | Vault only | Mints tokens to recipient from vault allowance |
| `rollDailyQuest(day, entropy)` | external | Game only | Routes VRF entropy to quest module for daily quest selection; emits `DailyQuestRolled` |
| `notifyQuestMint(player, qty, paidWithEth)` | external | Game only | Notifies quest module of mint action; credits quest reward as flip stake |
| `notifyQuestLootBox(player, amountWei)` | external | Game only | Notifies quest module of lootbox purchase; credits quest reward as flip stake |
| `notifyQuestDegenerette(player, amount, paidWithEth)` | external | Game only | Notifies quest module of Degenerette bet; credits quest reward as flip stake |
| `affiliateQuestReward(player, amount)` | external | Affiliate only | Computes affiliate quest rewards while preserving quest module access control |

### Internal/Private Functions
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `_mint(to, amount)` | internal | Multiple | Mints tokens; redirects to vaultAllowance if recipient is VAULT |
| `_burn(from, amount)` | internal | Multiple | Burns tokens; deducts from vaultAllowance if from is VAULT |
| `_transfer(from, to, amount)` | internal | transfer/transferFrom | Transfers tokens; redirects to vault escrow if recipient is VAULT |
| `_claimCoinflipShortfall(player, amount)` | private | transfer/transferFrom | Auto-claims coinflip winnings if balance insufficient for transfer |
| `_consumeCoinflipShortfall(player, amount)` | private | burnCoin/decimatorBurn | Consumes coinflip winnings for burn operations (no mint, direct consume) |
| `_adjustDecimatorBucket(bonusBps, minBucket)` | private pure | decimatorBurn | Computes decimator bucket from activity score: higher score = lower bucket (better odds). Base 12, min 5 (normal) or 2 (x00 levels) |
| `_decimatorBurnMultiplier(bonusBps)` | private pure | decimatorBurn | Returns burn weight multiplier: 1.0x base + (activityScore / 3). Max ~1.783x at cap |
| `_questApplyReward(player, reward, questType, streak, completed)` | private | Quest notification functions | Emits `QuestCompleted` event and returns reward if completed |

### Key Mechanics (non-function)
- **Vault escrow system:** 2M BURNIE virtual reserve seeded at deploy. Vault mints from allowance; game/modules increase allowance via `vaultEscrow()`. Transfers TO vault address redirect to burn + allowance increase (no vault balance accumulates)
- **Supply accounting:** `Supply` struct packs `totalSupply` (uint128) + `vaultAllowance` (uint128) in one slot. `supplyIncUncirculated = totalSupply + vaultAllowance`
- **Game contract transfer bypass:** `transferFrom` skips allowance check when caller is GAME contract
- **Decimator constants:** Min burn 1,000 BURNIE, base bucket 12, min bucket 5 (normal) / 2 (x00), activity cap 23,500 BPS (2.35x), boon cap 50,000 BURNIE
- **Quest hub pattern:** BurnieCoin acts as a routing hub for quest-related calls, forwarding to DegenerusQuests while maintaining access control and emitting events

---

## BurnieCoinflip.sol
**Lines:** 1,154 | **Functions:** 31 (public/external: 14, internal/private: 17)
**Purpose:** Standalone daily coinflip wagering system for BURNIE tokens with auto-rebuy, bounty system, and recycling bonus
**Inherits:** None (standalone)

### Player-Facing Functions
| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `depositCoinflip(player, amount)` | external | `address player`, `uint256 amount` | Deposits BURNIE into daily coinflip system | Burns BURNIE, processes quest reward, applies recycling bonus (1% base, capped 1000 BURNIE; or afKing 1.6%+ with deity scaling), adds to next day's flip stake. Min 100 BURNIE. Blocked during BAF resolution |
| `claimCoinflips(player, amount)` | external | `address player`, `uint256 amount` | Claims exact amount of coinflip winnings | Mints BURNIE to player. Blocked during RNG lock |
| `claimCoinflipsTakeProfit(player, multiples)` | external | `address player`, `uint256 multiples` | Claims coinflip winnings in multiples of take-profit amount | Auto-rebuy must be enabled with non-zero takeProfit |
| `setCoinflipAutoRebuy(player, enabled, takeProfit)` | external | `address player`, `bool enabled`, `uint256 takeProfit` | Configures auto-rebuy mode | When enabled: winnings auto-roll to next day's stake. Take-profit reserves multiples of stopAmount. Blocked during RNG lock. Disabling triggers afKing deactivation |
| `setCoinflipAutoRebuyTakeProfit(player, takeProfit)` | external | `address player`, `uint256 takeProfit` | Updates take-profit amount for auto-rebuy | Must have auto-rebuy enabled. If takeProfit < 20,000 BURNIE, deactivates afKing |

### View Functions
| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `previewClaimCoinflips(player)` | external view | `address player` | Preview total claimable winnings (stored + daily) |
| `coinflipAmount(player)` | external view | `address player` | Returns player's stake for next flip day |
| `coinflipAutoRebuyInfo(player)` | external view | `address player` | Returns auto-rebuy config (enabled, stop, carry, startDay) |
| `coinflipTopLastDay()` | external view | none | Returns last day's top bettor address and score |
| `currentBounty` | public state | none | Current bounty pool size in BURNIE |
| `biggestFlipEver` | public state | none | All-time record for biggest raw coinflip deposit |

### System/Integration Functions
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `processCoinflipPayouts(bonusFlip, rngWord, epoch)` | external | Game only | Resolves a day's coinflip: 50/50 win/loss from RNG bit, reward percent 50-156%, bounty payout, advances claimable day, accumulates +1000 BURNIE to bounty. Keeps sDGNRS flip cursor current |
| `creditFlip(player, amount)` | external | Game, BurnieCoin | Credits flip stake to player for next day (no BURNIE burn) |
| `creditFlipBatch(players[3], amounts[3])` | external | Game, BurnieCoin | Batch credit flip stakes to 3 players |
| `settleFlipModeChange(player)` | external | Game only | Settles pending claims before afKing mode change |
| `claimCoinflipsFromBurnie(player, amount)` | external | BurnieCoin only | Claims coinflip winnings to cover BurnieCoin transfer/burn shortfall |
| `consumeCoinflipsForBurn(player, amount)` | external | BurnieCoin only | Consumes coinflip winnings for burn operations (no mint) |

### Internal/Private Functions (key ones)
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `_depositCoinflip(caller, amount, directDeposit)` | private | depositCoinflip | Core deposit logic: burn, quest, recycling bonus, add daily flip |
| `_claimCoinflipsInternal(player, deepAutoRebuy)` | internal | Multiple claim paths | Iterates resolved days, accumulates winnings. Applies recycling bonus on carry. Awards WWXRP on losses. Records BAF leaderboard credit for winning flips |
| `_addDailyFlip(player, amount, recordAmount, canArmBounty, bountyEligible)` | private | deposit/credit | Adds to daily stake, applies coinflip boon (5/10/25% boost on max 100k), updates leaderboard, manages bounty arming |
| `_recyclingBonus(amount)` | private pure | Multiple | Standard recycling: 1% bonus capped at 1,000 BURNIE |
| `_afKingRecyclingBonus(amount, deityBonusHalfBps)` | private pure | Multiple | AfKing recycling: 1.6% base + deity level-scaled bonus. Deity portion capped at 1M BURNIE |
| `_afKingDeityBonusHalfBpsWithLevel(player, level)` | private view | Multiple | Deity bonus: 0.01% per level active, max 1.5%. Uses half-BPS for precision |

### Key Mechanics (non-function)
- **Daily coinflip cycle:** Deposits target next day. On VRF resolution, win/loss is determined by `rngWord & 1` (50/50). Win payout = principal + (principal * rewardPercent / 100)
- **Reward percent distribution:** 5% chance of 50% bonus (1.5x), 5% chance of 150% bonus (2.5x), 90% chance of 78-115% bonus. Presale adds +6pp
- **Auto-rebuy system:** When enabled, winnings carry forward to next day instead of becoming claimable. Take-profit reserves whole multiples of stop amount. Carry gets recycling bonus
- **Bounty system:** Pool accumulates 1,000 BURNIE per day. New all-time biggest flip arms the bounty. On next resolution day: half the pool is removed; if win, that half is credited to bounty holder as flip stake + DGNRS reward
- **Claim windows:** First 30 days for new players, then 90 days. Auto-rebuy extends to 1,095 days max
- **WWXRP consolation:** Each losing day awards 1 WWXRP to the player
- **BAF leaderboard integration:** Winning flip credits are recorded in DegenerusJackpots for BAF jackpot eligibility (every 10th level). sDGNRS excluded from BAF
- **Constants:** MIN deposit 100 BURNIE, recycling bonus 1% (standard) / 1.6% (afKing base), deity bonus 0.01%/level max 1.5%, deity recycle cap 1M BURNIE

---

## DegenerusStonk.sol
**Lines:** 223 | **Functions:** 10 (public/external: 8, internal/private: 2)
**Purpose:** Transferable ERC20 wrapper (DGNRS, 18 decimals) for sDGNRS; holders burn to claim proportional ETH + stETH + BURNIE backing
**Inherits:** None (standalone)

### Player-Facing Functions
| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `transfer(to, amount)` | external | `address to`, `uint256 amount` | Standard ERC20 transfer | Cannot transfer to self (address(this)) or zero address |
| `transferFrom(from, to, amount)` | external | `address from`, `address to`, `uint256 amount` | Standard ERC20 transferFrom | Infinite approval optimization (max uint256) |
| `approve(spender, amount)` | external | `address spender`, `uint256 amount` | Standard ERC20 approve | Sets allowance |
| `burn(amount)` | external | `uint256 amount` | Burns DGNRS to claim proportional ETH + stETH + BURNIE from sDGNRS backing | Burns DGNRS, calls sDGNRS.burn(), transfers backing assets to caller. CEI: burns before transfers. ETH sent last |
| `unwrapTo(recipient, amount)` | external | `address recipient`, `uint256 amount` | Burns DGNRS and sends underlying sDGNRS to recipient (creator only) | Creator-only. Blocked during VRF stall (>5h) to prevent vote-stacking. Emits `UnwrapTo` |

### View Functions
| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `previewBurn(amount)` | external view | `uint256 amount` | Preview ETH/stETH/BURNIE output for burning DGNRS; delegates to sDGNRS |
| `totalSupply` | public state | none | Total DGNRS supply |
| `balanceOf(addr)` | public | `address` | DGNRS balance |
| `allowance(owner, spender)` | public | `address, address` | ERC20 allowance |

### Key Mechanics (non-function)
- **Constructor:** Reads sDGNRS deposited balance, mints equal DGNRS to CREATOR address
- **Burn-through:** Burning DGNRS calls `sDGNRS.burn()` which returns proportional ETH + stETH + BURNIE. The DGNRS contract receives these and forwards to the burner
- **Receive function:** Only accepts ETH from sDGNRS (during burn-through)
- **VRF stall guard on unwrap:** `unwrapTo` blocked when >5 hours since last VRF processed, preventing creator from converting DGNRS to soulbound sDGNRS during stalls (prevents vote-stacking)
- **No supply cap:** Supply is set by constructor (equals sDGNRS deposited). No further minting possible

---

## StakedDegenerusStonk.sol
**Lines:** 514 | **Functions:** 17 (public/external: 12, internal/private: 5)
**Purpose:** Soulbound token (sDGNRS, 18 decimals) backed by ETH, stETH, and BURNIE reserves; distributed from pre-minted reward pools
**Inherits:** None (standalone)

### Player-Facing Functions
| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `burn(amount)` | external | `uint256 amount` | Burns sDGNRS to claim proportional share of ETH + stETH + BURNIE backing | Calculates pro-rata share of all reserves (including claimable game winnings and coinflip). ETH-preferential: pays ETH first, stETH for remainder. Claims game winnings if needed. CEI pattern |
| `gameAdvance()` | external | none | Calls `game.advanceGame()` on behalf of sDGNRS contract | Allows anyone to trigger game advance for the sDGNRS address |
| `gameClaimWhalePass()` | external | none | Claims whale pass on behalf of sDGNRS | Allows anyone to claim whale pass for sDGNRS |

### View Functions
| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `previewBurn(amount)` | external view | `uint256 amount` | Preview ETH/stETH/BURNIE output for burning sDGNRS. Includes claimable game winnings and coinflip |
| `burnieReserve()` | external view | none | Returns total BURNIE backing (balance + claimable coinflips) |
| `poolBalance(pool)` | external view | `Pool pool` | Returns remaining balance for a reward pool |
| `totalSupply` | public state | none | Total sDGNRS supply |
| `balanceOf(addr)` | public | `address` | sDGNRS balance |

### System/Integration Functions (Game Only)
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `receive()` | external payable | Game only | Accepts ETH deposit from game distributions |
| `depositSteth(amount)` | external | Game only | Receives stETH deposit from game distributions |
| `transferFromPool(pool, to, amount)` | external | Game only | Transfers sDGNRS from a reward pool to recipient; caps at available balance | Returns actual amount transferred (may be less than requested) |
| `transferBetweenPools(from, to, amount)` | external | Game only | Moves sDGNRS between reward pools (internal rebalance, no token movement) |
| `burnRemainingPools()` | external | Game only | Burns all undistributed pool tokens at game over |
| `wrapperTransferTo(to, amount)` | external | DGNRS only | Transfers sDGNRS from wrapper balance to recipient (creator unwrap path) |

### Key Mechanics (non-function)
- **Soulbound:** No `transfer` or `transferFrom` functions exist. Tokens can only be received (from pools or unwrap) and burned. The only "transfer" is `wrapperTransferTo` (DGNRS wrapper only)
- **Pool system:** 5 pre-minted pools (Whale 10%, Affiliate 35%, Lootbox 20%, Reward 5%, Earlybird 10%) from 1T initial supply. Creator gets 20% (minted to DGNRS wrapper). Dust goes to Lootbox pool
- **Backing assets:** ETH (from game distributions), stETH (from game distributions), BURNIE (from manual transfers and coinflip claimables). Burn payout is proportional to supply share
- **ETH-preferential payout:** On burn, ETH is paid first. If insufficient ETH, claims game winnings. stETH covers any remainder
- **Constructor actions:** Claims whale pass and enables afKing mode (10 ETH take-profit) for the sDGNRS contract itself
- **sDGNRS is a coinflip participant:** The contract participates in coinflips (cursor kept current by `processCoinflipPayouts`), but is excluded from BAF leaderboard

---

## WrappedWrappedXRP.sol
**Lines:** 389 | **Functions:** 14 (public/external: 12, internal/private: 2)
**Purpose:** Parody ERC20 meme token (WWXRP, 18 decimals) intentionally undercollateralized; awarded as consolation prize on coinflip losses
**Inherits:** None (standalone)

### Player-Facing Functions
| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `transfer(to, amount)` | external | `address to`, `uint256 amount` | Standard ERC20 transfer | Freely transferable |
| `transferFrom(from, to, amount)` | external | `address from`, `address to`, `uint256 amount` | Standard ERC20 transferFrom | Infinite approval optimization |
| `approve(spender, amount)` | external | `address spender`, `uint256 amount` | Standard ERC20 approve | Sets allowance |
| `unwrap(amount)` | external | `uint256 amount` | Burns WWXRP and returns wXRP 1:1 if reserves allow | First-come-first-served. Reverts if insufficient wXRP reserves. CEI: burn before transfer |
| `donate(amount)` | external | `uint256 amount` | Donates wXRP to increase backing without minting WWXRP | Transfers wXRP from donor, increases `wXRPReserves`. Improves backing ratio |

### View Functions
| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `totalSupply` | public state | none | Circulating supply (excludes vault allowance) |
| `balanceOf(addr)` | public | `address` | WWXRP balance |
| `allowance(owner, spender)` | public | `address, address` | ERC20 allowance |
| `supplyIncUncirculated()` | external view | none | totalSupply + vaultAllowance |
| `vaultMintAllowance()` | external view | none | Remaining vault mint allowance |
| `wXRPReserves` | public state | none | Actual wXRP reserves held by contract |

### System/Integration Functions
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `mintPrize(to, amount)` | external | Game, BurnieCoin, BurnieCoinflip | Mints WWXRP WITHOUT backing (increases undercollateralization). Used for lootbox/game prizes and coinflip loss consolation |
| `vaultMintTo(to, amount)` | external | Vault only | Mints WWXRP from vault's 1B uncirculating reserve |
| `burnForGame(from, amount)` | external | Game only | Burns WWXRP from player for game bets (e.g., Degenerette WWXRP wagers) |

### Key Mechanics (non-function)
- **Intentionally undercollateralized:** WWXRP is minted freely as prizes without corresponding wXRP backing. The contract explicitly states "THIS IS A JOKE TOKEN"
- **Vault reserve:** 1B WWXRP uncirculating reserve that vault can mint from
- **Wrapping disabled:** No `wrap()` function exists. Only `unwrap()` (first-come-first-served based on wXRP reserves) and `donate()` (increase backing)
- **Three minters:** GAME, COIN (BurnieCoin), and COINFLIP can mint unbacked WWXRP. Only VAULT mints from the reserved allowance
- **wXRP reserves tracking:** Separate `wXRPReserves` variable tracks actual wXRP held, independent of totalSupply
