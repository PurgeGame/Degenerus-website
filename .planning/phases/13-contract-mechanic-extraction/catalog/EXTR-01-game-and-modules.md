# EXTR-01: DegenerusGame.sol and Game Modules

**Source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/
**Scope:** DegenerusGame.sol (main dispatcher) + 12 delegatecall modules
**Status:** Complete

---

## DegenerusGame.sol (Main Dispatcher)

**Lines:** 2,856 | **Inherits:** DegenerusGameMintStreakUtils (which inherits DegenerusGameStorage)
**Purpose:** Core game contract and entry point for all player actions. Implements a 2-state FSM (PURCHASE/JACKPOT) with delegatecall dispatch to 12 specialized modules.

### Architecture

DegenerusGame.sol serves as:
1. **State machine owner** -- holds all game storage (inherited from DegenerusGameStorage)
2. **Delegatecall dispatcher** -- routes complex logic to constant-address modules
3. **Direct implementor** -- handles claiming, payment processing, views, auto-rebuy, and operator approvals directly

All 12 modules execute via `delegatecall`, meaning they operate on DegenerusGame's storage. Modules MUST inherit DegenerusGameStorage for slot alignment.

### Delegatecall Dispatch Map

| External Function | Target Module | Module Interface |
|-------------------|---------------|------------------|
| `advanceGame()` | GAME_ADVANCE_MODULE | `IDegenerusGameAdvanceModule.advanceGame` |
| `wireVrf(...)` | GAME_ADVANCE_MODULE | `IDegenerusGameAdvanceModule.wireVrf` |
| `updateVrfCoordinatorAndSub(...)` | GAME_ADVANCE_MODULE | `IDegenerusGameAdvanceModule.updateVrfCoordinatorAndSub` |
| `requestLootboxRng()` | GAME_ADVANCE_MODULE | `IDegenerusGameAdvanceModule.requestLootboxRng` |
| `reverseFlip()` | GAME_ADVANCE_MODULE | `IDegenerusGameAdvanceModule.reverseFlip` |
| `rawFulfillRandomWords(...)` | GAME_ADVANCE_MODULE | `IDegenerusGameAdvanceModule.rawFulfillRandomWords` |
| `purchase(...)` | GAME_MINT_MODULE | `IDegenerusGameMintModule.purchase` |
| `purchaseCoin(...)` | GAME_MINT_MODULE | `IDegenerusGameMintModule.purchaseCoin` |
| `purchaseBurnieLootbox(...)` | GAME_MINT_MODULE | `IDegenerusGameMintModule.purchaseBurnieLootbox` |
| `purchaseWhaleBundle(...)` | GAME_WHALE_MODULE | `IDegenerusGameWhaleModule.purchaseWhaleBundle` |
| `purchaseLazyPass(...)` | GAME_WHALE_MODULE | `IDegenerusGameWhaleModule.purchaseLazyPass` |
| `purchaseDeityPass(...)` | GAME_WHALE_MODULE | `IDegenerusGameWhaleModule.purchaseDeityPass` |
| `openLootBox(...)` | GAME_LOOTBOX_MODULE | `IDegenerusGameLootboxModule.openLootBox` |
| `openBurnieLootBox(...)` | GAME_LOOTBOX_MODULE | `IDegenerusGameLootboxModule.openBurnieLootBox` |
| `issueDeityBoon(...)` | GAME_LOOTBOX_MODULE | `IDegenerusGameLootboxModule.issueDeityBoon` |
| `placeFullTicketBets(...)` | GAME_DEGENERETTE_MODULE | `IDegenerusGameDegeneretteModule.placeFullTicketBets` |
| `resolveDegeneretteBets(...)` | GAME_DEGENERETTE_MODULE | `IDegenerusGameDegeneretteModule.resolveBets` |
| `consumeCoinflipBoon(...)` | GAME_BOON_MODULE | `IDegenerusGameBoonModule.consumeCoinflipBoon` |
| `consumeDecimatorBoon(...)` | GAME_BOON_MODULE | `IDegenerusGameBoonModule.consumeDecimatorBoost` |
| `consumePurchaseBoost(...)` | GAME_BOON_MODULE | `IDegenerusGameBoonModule.consumePurchaseBoost` |
| `creditDecJackpotClaimBatch(...)` | GAME_DECIMATOR_MODULE | `IDegenerusGameDecimatorModule.creditDecJackpotClaimBatch` |
| `creditDecJackpotClaim(...)` | GAME_DECIMATOR_MODULE | `IDegenerusGameDecimatorModule.creditDecJackpotClaim` |
| `recordDecBurn(...)` | GAME_DECIMATOR_MODULE | `IDegenerusGameDecimatorModule.recordDecBurn` |
| `runDecimatorJackpot(...)` | GAME_DECIMATOR_MODULE | `IDegenerusGameDecimatorModule.runDecimatorJackpot` |
| `recordTerminalDecBurn(...)` | GAME_DECIMATOR_MODULE | `IDegenerusGameDecimatorModule.recordTerminalDecBurn` |
| `runTerminalDecimatorJackpot(...)` | GAME_DECIMATOR_MODULE | `IDegenerusGameDecimatorModule.runTerminalDecimatorJackpot` |
| `consumeDecClaim(...)` | GAME_DECIMATOR_MODULE | `IDegenerusGameDecimatorModule.consumeDecClaim` |
| `claimDecimatorJackpot(...)` | GAME_DECIMATOR_MODULE | `IDegenerusGameDecimatorModule.claimDecimatorJackpot` |
| `claimWhalePass(...)` | GAME_ENDGAME_MODULE | `IDegenerusGameEndgameModule.claimWhalePass` |
| `runTerminalJackpot(...)` | GAME_JACKPOT_MODULE | `IDegenerusGameJackpotModule.runTerminalJackpot` |

### Direct Implementations (not delegated)

#### Player-Facing Functions

| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `claimWinnings(address)` | external | player (0x0 = msg.sender) | Claim accrued ETH winnings via pull pattern | Deducts from claimableWinnings (leaves 1 wei sentinel), decrements claimablePool, sends ETH with stETH fallback |
| `claimWinningsStethFirst()` | external | none | Claim winnings preferring stETH payout | Restricted to vault/SDGNRS contracts; sends stETH first, ETH fallback |
| `claimAffiliateDgnrs(address)` | external | player (0x0 = msg.sender) | Claim DGNRS affiliate rewards for current level | Score-proportional draw from segregated 5% allocation; one claim per level per affiliate; deity pass holders get bonus BURNIE flip credit (20% of payout, capped 5 ETH equivalent) |
| `setAutoRebuy(address, bool)` | external | player, enabled | Toggle auto-rebuy for claimable winnings | Converts remainder after take-profit to tickets (30% bonus, 45% with afKing); disabling also deactivates afKing |
| `setDecimatorAutoRebuy(address, bool)` | external | player, enabled | Toggle auto-rebuy for decimator claims | Default enabled; SDGNRS address blocked from toggling |
| `setAutoRebuyTakeProfit(address, uint256)` | external | player, takeProfit (wei) | Set take-profit reserve amount for auto-rebuy | Complete multiples reserved; fractional remainder eligible for rebuy |
| `setAfKingMode(address, bool, uint256, uint256)` | external | player, enabled, ethTakeProfit, coinTakeProfit | Toggle afKing (AFK-king) mode | Requires lazy pass; forces auto-rebuy on for ETH and coin; clamps take-profit to minimums (5 ETH / 20k BURNIE); locks for 5 levels after activation |
| `setOperatorApproval(address, bool)` | external | operator, approved | Approve/revoke operator to act on behalf of player | Updates operatorApprovals mapping |
| `receive()` | external payable | none | Accept plain ETH transfers | Routes to futurePrizePool (or pending pool if frozen) |

#### System/Internal Functions (directly on DegenerusGame)

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `recordMint(...)` | external payable | self-call (delegate modules) | Process mint payment (ETH/claimable/combined), split 90/10 next/future pool, record mint data via MintModule, award earlybird DGNRS |
| `recordMintQuestStreak(address)` | external | COIN contract | Record mint streak completion after 1x price ETH quest |
| `payCoinflipBountyDgnrs(address, uint256, uint256)` | external | COIN or COINFLIP | Pay DGNRS bounty (0.2% of reward pool) for biggest flip record; minimum bet 50k BURNIE, minimum pool 20k BURNIE |
| `deactivateAfKingFromCoin(address)` | external | COIN or COINFLIP | Deactivate afKing mode (hook for coin/coinflip operations) |
| `syncAfKingLazyPassFromCoin(address)` | external | COINFLIP only | Check lazy pass still active; revoke afKing if not |
| `setLootboxRngThreshold(uint256)` | external | ADMIN only | Update lootbox RNG request threshold (wei) |
| `adminSwapEthForStEth(address, uint256)` | external payable | ADMIN only | Value-neutral swap: admin sends ETH, receives game-held stETH |
| `adminStakeEthForStEth(uint256)` | external | ADMIN only | Stake excess ETH into Lido stETH; preserves claimablePool reserve |
| `_processMintPayment(...)` | private | recordMint | Handle DirectEth/Claimable/Combined payment modes; preserves 1 wei sentinel in claimable |
| `_claimWinningsInternal(...)` | private | claimWinnings, claimWinningsStethFirst | Core claim logic: CEI pattern, 1 wei sentinel, ETH-first or stETH-first payout |
| `_recordMintDataModule(...)` | private | recordMint | Delegatecall to GAME_MINT_MODULE.recordMintData for mint history and BURNIE reward calculation |
| `_revertDelegate(bytes)` | private pure | all delegatecall wrappers | Bubble up revert reason from failed delegatecall using assembly |
| `_payoutWithStethFallback(...)` | private | _claimWinningsInternal | Send ETH first, stETH for remainder, ETH retry for edge cases |
| `_payoutWithEthFallback(...)` | private | _claimWinningsInternal | Send stETH first, ETH for remainder (vault/SDGNRS preference) |
| `_transferSteth(...)` | private | payout helpers | stETH transfer; special-cases SDGNRS (approve + depositSteth) |
| `_resolvePlayer(address)` | private view | all player-facing dispatchers | Resolve address(0) to msg.sender; check operator approval for third-party calls |
| `_requireApproved(address)` | private view | _resolvePlayer | Revert if caller is not player and not an approved operator |
| `_setAutoRebuy(...)` | private | setAutoRebuy | Core auto-rebuy toggle; deactivates afKing if disabling |
| `_setAutoRebuyTakeProfit(...)` | private | setAutoRebuyTakeProfit | Core take-profit setter; deactivates afKing if below 5 ETH minimum |
| `_setAfKingMode(...)` | private | setAfKingMode | Core afKing toggle; requires lazy pass, sets coinflip auto-rebuy, locks for 5 levels |
| `_deactivateAfKing(address)` | private | multiple | Deactivate afKing: check 5-level lock, settle coinflip, clear state |
| `_hasAnyLazyPass(address)` | private view | _setAfKingMode | Check deity pass or frozenUntilLevel > current level |

#### View Functions

| Function | Visibility | What It Returns |
|----------|-----------|----------------|
| `currentDayView()` | external view | Current day index |
| `prizePoolTargetView()` | external view | Ratchet target for level progression (pre-skim nextPrizePool from previous level) |
| `nextPrizePoolView()` | external view | nextPrizePool balance (accumulates until target met) |
| `futurePrizePoolView()` | external view | futurePrizePool balance (unified reserve) |
| `futurePrizePoolTotalView()` | external view | Same as futurePrizePoolView (alias) |
| `currentPrizePoolView()` | external view | currentPrizePool (jackpots paid from this) |
| `rewardPoolView()` | external view | Same as futurePrizePool (alias) |
| `claimablePoolView()` | external view | claimablePool (reserved for player claims; 0 after final sweep) |
| `yieldPoolView()` | external view | Yield surplus: (ETH + stETH balance) - all pool obligations |
| `yieldAccumulatorView()` | external view | Segregated stETH yield reserve |
| `mintPrice()` | external view | Current ticket price in wei |
| `ticketsOwedView(uint24, address)` | external view | Queued ticket rewards for a level/player |
| `lootboxStatus(address, uint48)` | external view | Lootbox ETH amount and presale flag for a player/index |
| `lootboxPresaleActiveFlag()` | external view | Whether presale mode is active |
| `lootboxRngIndexView()` | external view | Current lootbox RNG index |
| `lootboxRngWord(uint48)` | external view | VRF word for a lootbox index (0 if not ready) |
| `lootboxRngThresholdView()` | external view | ETH threshold that triggers lootbox RNG request |
| `lootboxRngMinLinkBalanceView()` | external view | Minimum LINK balance for manual lootbox RNG rolls |
| `degeneretteBetInfo(address, uint64)` | external view | Packed bet info for a player/betId |
| `rngWordForDay(uint48)` | external view | VRF word recorded for a specific day |
| `lastRngWord()` | external view | Most recent VRF word |
| `rngLocked()` | external view | Whether RNG lock is active (VRF pending) |
| `isRngFulfilled()` | external view | Whether VRF word is available |
| `rngStalledForThreeDays()` | external view | Whether 3 consecutive days have no VRF word |
| `lastVrfProcessed()` | external view | Timestamp of last successful VRF word processing |
| `decWindow()` | external view | Decimator window status (on/off) and current level |
| `decWindowOpenFlag()` | external view | Raw decimator window flag (ignores RNG lock) |
| `terminalDecWindow()` | external view | Terminal decimator window (open except lastPurchaseDay and gameOver) |
| `jackpotCompressionTier()` | external view | Compression tier: 0=normal, 1=compressed (3d), 2=turbo (1d) |
| `jackpotPhase()` | external view | Whether jackpot phase is active |
| `purchaseInfo()` | external view | Bundled: active ticket level, jackpot phase, lastPurchaseDay, rngLocked, price |
| `decClaimable(address, uint24)` | external view | Decimator claim amount and winner status for player/level |
| `isOperatorApproved(address, address)` | external view | Whether operator is approved for owner |
| `isFinalSwept()` | external view | Whether final sweep executed |
| `ethMintLastLevel(address)` | external view | Last level where player minted with ETH |
| `ethMintLevelCount(address)` | external view | Total levels with ETH mints |
| `ethMintStreakCount(address)` | external view | Current consecutive ETH mint streak |
| `ethMintStats(address)` | external view | Batched: level, levelCount, streak |
| `playerActivityScore(address)` | external view | Activity score in BPS (max 30500) |
| `getWinnings()` | external view | Caller's claimable balance minus sentinel |
| `claimableWinningsOf(address)` | external view | Raw claimable balance (includes sentinel) |
| `whalePassClaimAmount(address)` | external view | Pending whale pass claim (half-passes) |
| `deityPassCountFor(address)` | external view | Deity pass count for player |
| `deityPassPurchasedCountFor(address)` | external view | Presale-purchased deity pass count |
| `deityPassTotalIssuedCount()` | external view | Total deity passes issued (max 32) |
| `hasActiveLazyPass(address)` | external view | Whether player has active lazy/whale/deity pass |
| `autoRebuyEnabledFor(address)` | external view | Whether auto-rebuy is enabled |
| `decimatorAutoRebuyEnabledFor(address)` | external view | Whether decimator auto-rebuy is enabled |
| `autoRebuyTakeProfitFor(address)` | external view | Auto-rebuy take profit amount |
| `afKingModeFor(address)` | external view | Whether afKing mode is active |
| `afKingActivatedLevelFor(address)` | external view | Level when afKing was activated |
| `sampleTraitTickets(uint256)` | external view | Sample up to 4 trait burn ticket holders from recent levels |
| `sampleTraitTicketsAtLevel(uint24, uint256)` | external view | Sample trait burn tickets from a specific level |
| `sampleFarFutureTickets(uint256)` | external view | Sample up to 4 far-future ticket holders from ticketQueue |
| `getTickets(uint8, uint24, uint32, uint32, address)` | external view | Paginated ticket count for trait/level/player |
| `getPlayerPurchases(address)` | external view | Tickets owed for current level |
| `getDailyHeroWager(uint48, uint8, uint8)` | external view | Degenerette hero wager for day/quadrant/symbol |
| `getDailyHeroWinner(uint48)` | external view | Winning hero symbol for a day (most wagered) |
| `getPlayerDegeneretteWager(address, uint24)` | external view | Player's total ETH wagered on degenerette at a level |
| `getTopDegenerette(uint24)` | external view | Top degenerette wagerer for a level |

### Key Mechanics (non-function)

- **2-state FSM:** PURCHASE (jackpotPhaseFlag=false) and JACKPOT (jackpotPhaseFlag=true). gameOver is terminal.
- **Presale toggle:** lootboxPresaleActive starts true, auto-ends at first PURCHASE-to-JACKPOT transition or via admin. One-way (never re-enables). Grants 62% bonus BURNIE from lootboxes and bonusFlip.
- **Mint packed storage:** Player mint history packed into single uint256 per player (lastEthLevel, ethLevelCount, ethLevelStreak, lastEthDay, unitsLevel, frozenUntilLevel, whaleBundleType, mintStreakLast, unitsAtLevel).
- **Prize pool split:** Ticket purchases split 90/10 (next/future). Pool-frozen purchases go to pending pools.
- **1 wei sentinel:** claimableWinnings leaves 1 wei to avoid cold-to-warm SSTORE costs.
- **Operator approvals:** Any address can approve operators to act on their behalf for all player-facing functions.
- **Activity score:** Composite of mint streak (50%), mint count (25%), quest streak (100%), affiliate bonus (50%), pass bonus (10-80%). Max 305 BPS base. Different consumers cap at different thresholds (lootbox EV: 255, degenerette ROI: 305, decimator: 235).
- **Auto-rebuy:** Converts jackpot winnings to tickets. 30% bonus (13000 BPS), 45% with afKing (14500 BPS). Take-profit reserves whole multiples. Level offset 1-4 (25% next pool, 75% future pool).
- **afKing mode:** Requires lazy pass. Forces auto-rebuy on for ETH and BURNIE coinflip. Clamps take-profit minimums (5 ETH, 20k BURNIE). Locked for 5 levels after activation.
- **Deploy idle timeout:** 365 days at level 0 before GAMEOVER triggers.
- **Inactivity guard:** 120 days of no level advancement triggers GAMEOVER (level 1+).

---

### DegenerusGameBoonModule.sol (Module)

**Lines:** 359 | **Delegatecall from:** DegenerusGame
**Purpose:** Boon consumption mechanics: consume and clear deity-granted and lootbox-rolled boons (coinflip, purchase, decimator, lootbox, whale, lazy pass, deity pass, activity boosts).

#### Player-Facing Functions

| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `consumeCoinflipBoon(address)` | external | player | Consume coinflip boon, return bonus BPS | Returns 0/500/1000/2500 BPS; checks deity-day freshness and 2-day expiry; clears boon state |
| `consumePurchaseBoost(address)` | external | player | Consume purchase boost boon, return bonus BPS | Returns 0/500/1500/2500 BPS; checks deity-day freshness and 4-day expiry; clears boon state |
| `consumeDecimatorBoost(address)` | external | player | Consume decimator boost boon, return bonus BPS | Returns 0/1000/2500/5000 BPS; checks deity-day freshness; clears boon state |

#### System/Internal Functions

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `checkAndClearExpiredBoon(address)` | external | LootboxModule (nested delegatecall) | Clear all expired boons for a player; returns true if any active boon remains. Checks 10 boon types: coinflip, lootbox 25%/15%/5%, purchase, decimator, whale, lazy pass, deity pass, activity |
| `consumeActivityBoon(address)` | external | LootboxModule (nested delegatecall) | Consume pending activity boon: adds pending level count to player's mintPacked_ levelCount field, awards quest streak bonus via quests.awardQuestStreakBonus |

#### Key Mechanics (non-function)

- **Boon expiry system:** Each boon has a stamped day and an expiry window (coinflip: 2 days, lootbox boosts: 2 days, purchase boost: 4 days, deity pass boon: 4 days). Deity-granted boons expire at end-of-day (deityDay != currentDay).
- **10 boon types tracked:** coinflipBoon, lootboxBoon25/15/5, purchaseBoost, decimatorBoost, whaleBoon, lazyPassBoon, deityPassBoon, activityBoon.
- **Dual-source boons:** Each boon can come from lootbox rolls (standard expiry) or deity pass grants (same-day expiry). Deity expiry takes precedence.
- **Activity boon consumption:** Adds pending level credits to the player's activity score components (levelCount in mintPacked_) and awards quest streak bonus. Effectively backdates participation credit.

---

### DegenerusGameEndgameModule.sol (Module)

**Lines:** 540 | **Delegatecall from:** DegenerusGame
**Purpose:** Endgame settlement: BAF and Decimator reward jackpots during level transitions, top affiliate rewards, deferred whale pass claims, and auto-rebuy conversion of jackpot winnings.

#### Player-Facing Functions

| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `claimWhalePass(address)` | external | player | Claim deferred whale pass rewards from large lootbox wins (>5 ETH) | Awards N tickets/level for 100 levels starting at level+1 (N = half-pass count from whalePassClaims); clears whalePassClaims; applies whale pass stat boost |

#### System/Internal Functions

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `rewardTopAffiliate(uint24)` | external | AdvanceModule (during level transition) | Pay 1% of DGNRS affiliate pool to top affiliate for a level; segregate 5% of remaining pool into levelDgnrsAllocation for per-affiliate claims |
| `runRewardJackpots(uint24, uint256)` | external | AdvanceModule (during level transition) | Execute BAF (every 10 levels) and Decimator (levels x5, not 95; x00 special) jackpots from future pool |
| `_addClaimableEth(address, uint256, uint256)` | private | _runBafJackpot | Credit ETH to claimable; if auto-rebuy enabled, convert to tickets (30%/45% bonus, 1-4 levels ahead) |
| `_runBafJackpot(uint256, uint24, uint256)` | private | runRewardJackpots | Execute BAF distribution: large winners (>=5% pool) get 50/50 ETH/lootbox; small winners alternate 100% ETH (even index) or 100% lootbox (odd index) |
| `_awardJackpotTickets(address, uint256, uint24, uint256)` | private | _runBafJackpot | Convert ETH to tickets: small (<=0.5 ETH) single roll, medium (0.5-5 ETH) split into 2 rolls, large (>5 ETH) deferred to whale pass claim |
| `_jackpotTicketRoll(address, uint256, uint24, uint256)` | private | _awardJackpotTickets | Single probabilistic roll: 30% current level, 65% +1-4 levels, 5% +5-50 levels. Converts ETH to tickets at target level price |

#### Key Mechanics (non-function)

- **BAF jackpot schedule:** Every 10 levels (x0). Pool size: 10% of futurePool normally, 20% at level 50 and x00 levels.
- **Decimator jackpot schedule:** Fires at levels ending in 5 (5, 15, 25...85, not 95). Pool: 10% of futurePool. Level x00 special: 30% of futurePool.
- **BAF payout structure:** Large winners (>=5% of BAF pool) get balanced 50% ETH / 50% lootbox. Small winners get gas-efficient alternating: even-index 100% ETH, odd-index 100% lootbox.
- **Lootbox ticket targeting:** Probabilistic level selection. 30% chance: current level. 65% chance: +1 to +4 levels ahead. 5% chance: +5 to +50 levels ahead (rare).
- **Lootbox claim threshold:** 5 ETH. Amounts above this are deferred to claimWhalePass (which awards deterministic 100-level ticket ranges).
- **Auto-rebuy in jackpots:** When enabled, winnings are converted to tickets at 1-4 levels ahead (25% next pool/75% future pool) with 30% ticket bonus (45% in afKing mode). Take-profit reserves are preserved as claimable.
- **Affiliate DGNRS segregation:** At level transition, 1% of affiliate pool goes to top affiliate. Then 5% of remaining pool is snapshotted into levelDgnrsAllocation[lvl] for proportional per-affiliate claims. Unclaimed tokens naturally roll into next level's snapshot.

---

### DegenerusGameGameOverModule.sol (Module)

**Lines:** 232 | **Delegatecall from:** DegenerusGame
**Purpose:** Terminal GAMEOVER handling: distribute remaining funds via jackpots, deity pass refunds for early game over, and final 30-day sweep to vault.

#### Player-Facing Functions

None. All functions are system-triggered.

#### System/Internal Functions

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `handleGameOverDrain(uint48)` | external | AdvanceModule (when liveness guard triggers) | Set terminal gameOver flag. Early game (levels 0-9): refund 20 ETH per deity pass (FIFO, budget-capped). Then: 10% to terminal decimator, 90% + decimator refund to terminal jackpot (Day-5-style bucket distribution to next-level ticketholders). Remaining swept to vault/DGNRS. Burns undistributed sDGNRS pool tokens |
| `handleFinalSweep()` | external | Anyone (after 30 days post-gameover) | Forfeit all unclaimed winnings. Sweep entire ETH + stETH balance to vault (50%) and SDGNRS (50%). Shutdown VRF subscription. Fire-and-forget VRF shutdown |
| `_sendToVault(uint256, uint256)` | private | handleGameOverDrain, handleFinalSweep | Split funds 50/50 between vault (stETH transfer) and SDGNRS (stETH approve + depositSteth). Prioritizes stETH transfers, falls back to ETH |

#### Key Mechanics (non-function)

- **GAMEOVER terminal state:** gameOver flag is irreversible. Triggered by liveness guards (365-day deploy timeout at level 0, 120-day inactivity at level 1+).
- **Early GAMEOVER deity refund:** Levels 0-9 only. Fixed 20 ETH per deity pass purchased, paid FIFO by purchase order. Budget-capped to (totalFunds - claimablePool).
- **Terminal distribution:** 10% to terminal decimator (death bet); 90% + decimator refund to terminal jackpot (Day-5-style distribution to next-level ticketholders).
- **VRF fallback:** Uses rngWordByDay which may use historical VRF word as secure fallback if Chainlink VRF is stalled (after 3-day wait period).
- **Final sweep:** 30 days after GAMEOVER. Forfeits ALL unclaimed winnings. 50/50 split to vault and SDGNRS. VRF shutdown attempted with try/catch (failure does not block sweep).
- **Pool zeroing:** All pool variables (nextPrizePool, futurePrizePool, currentPrizePool, yieldAccumulator) set to 0 at GAMEOVER.

---

### DegenerusGameMintStreakUtils.sol (Module)

**Lines:** 62 | **Inherited by:** DegenerusGame (directly), DegenerusGameWhaleModule
**Purpose:** Shared mint streak helper calculations. Tracks consecutive levels where a player completed a 1x-price ETH quest.

#### Player-Facing Functions

None. All functions are internal utilities.

#### System/Internal Functions

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `_recordMintStreakForLevel(address, uint24)` | internal | recordMintQuestStreak (DegenerusGame), WhaleModule | Record streak completion for a level (idempotent per level). If previous level was lastCompleted, increment streak; otherwise reset to 1. Stores in mintPacked_ bit fields |
| `_mintStreakEffective(address, uint24)` | internal view | playerActivityScore, ethMintStreakCount | Return effective streak count. Returns 0 if lastCompleted is 0 or if current level is more than 1 ahead of lastCompleted (streak broken) |

#### Key Mechanics (non-function)

- **Streak storage:** Uses bits [160-183] (mintStreakLast: last completed level) and bits [48-71] (ethLevelStreak: streak count) of the mintPacked_ uint256.
- **Idempotent recording:** Calling _recordMintStreakForLevel twice for the same level is a no-op.
- **Streak reset:** If a level is skipped (lastCompleted + 1 != currentLevel), streak resets to 1.
- **Activity score impact:** Streak contributes up to 50% (50 points) to activity score (1% per consecutive level).

---

### DegenerusGamePayoutUtils.sol (Module)

**Lines:** 94 | **Inherited by:** DegenerusGameEndgameModule
**Purpose:** Shared payout utilities for jackpot-related modules. Provides claimable crediting, auto-rebuy calculation, and whale pass claim queuing.

#### Player-Facing Functions

None. All functions are internal utilities.

#### System/Internal Functions

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `_creditClaimable(address, uint256)` | internal | EndgameModule, JackpotModule, and other payout paths | Credit ETH to player's claimableWinnings mapping; emits PlayerCredited event |
| `_calcAutoRebuy(address, uint256, uint256, AutoRebuyState, uint24, uint16, uint16)` | internal pure | EndgameModule._addClaimableEth | Calculate auto-rebuy ticket allocation from winnings: reserve take-profit multiples, select target level 1-4 ahead (25% next, 75% future pool), compute ticket count with bonus BPS (13000 normal / 14500 afKing) at quarter-price |
| `_queueWhalePassClaimCore(address, uint256)` | internal | EndgameModule, JackpotModule (large payouts) | Convert large payouts (>5 ETH) to whale pass claims. Each 2.25 ETH = one half-pass (1 ticket/level for 100 levels). Remainder credited as claimable ETH |

#### Key Mechanics (non-function)

- **Half whale pass pricing:** HALF_WHALE_PASS_PRICE = 2.25 ETH. Each half-pass = 1 ticket per level for 100 levels.
- **AutoRebuyCalc struct:** Captures toFuture flag, hasTickets, targetLevel, ticketCount, ethSpent, reserved, rebuyAmount for auto-rebuy conversion.
- **Auto-rebuy level targeting:** Entropy-based 1-4 levels ahead. +1 level = next pool (25% probability). +2/+3/+4 = future pool (75% probability).
- **Quarter-price tickets:** Auto-rebuy buys tickets at price >> 2 (quarter of normal price), effectively a 4x ticket multiplier.

---

### DegenerusGameWhaleModule.sol (Module)

**Lines:** 840 | **Delegatecall from:** DegenerusGame
**Purpose:** Whale bundle (100-level), lazy pass (10-level), and deity pass purchasing. Includes lootbox boost consumption, DGNRS reward distribution, and lootbox entry recording.

#### Player-Facing Functions

| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `purchaseWhaleBundle(address, uint256)` | external payable | buyer, quantity (1-100) | Purchase 100-level whale bundle(s) | Price: 2.4 ETH (levels 0-3), 4 ETH (levels 4+), boon discount on first. Queue 40 tickets/lvl bonus (levels to 10), 2 tickets/lvl standard. Fund split: level 0 = 30/70 next/future, else 5/95. Lootbox: 20% presale / 10% post. DGNRS rewards to buyer (1% whale pool) and affiliates (0.1%/0.02%/0.01% affiliate pool). At x99 levels: minimum 2 bundles without boon |
| `purchaseLazyPass(address)` | external payable | buyer | Purchase 10-level lazy pass | Available at levels 0-2 or x9 (not x99) or with boon. Grants 4 tickets/level for 10 levels. Price: flat 0.24 ETH (levels 0-2, excess buys bonus tickets), sum of per-level ticket prices (levels 3+). Boon: 10/25/50% discount. Lootbox: 20%/10%. Can renew with <=7 levels remaining. Blocked for deity pass holders. Pool split 90/10 next/future |
| `purchaseDeityPass(address, uint8)` | external payable | buyer, symbolId (0-31) | Purchase deity pass for a specific symbol | Price: 24 + T(n) ETH where T(n) = n(n+1)/2, n = passes sold so far. Boon tier discount (10/25/50%). One per player, 32 max total. Mints ERC721 token. Queue whale-equivalent tickets (40/lvl bonus, 2/lvl standard for 100 levels). Fund split: level 0 = 30/70, else 5/95. Lootbox: 20%/10%. DGNRS: 5% whale pool to buyer, 0.5%/0.1%/0.05% affiliate pool to referrers |

#### System/Internal Functions

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `_purchaseWhaleBundle(...)` | private | purchaseWhaleBundle | Core bundle logic: validate quantity, check boon discount, calculate freeze extension (delta-based, no double dipping), update mintPacked_ (levelCount, frozenUntilLevel, bundleType=3, lastLevel, mintDay), queue tickets, distribute DGNRS, split funds, record lootbox |
| `_purchaseLazyPass(...)` | private | purchaseLazyPass | Core lazy pass logic: check availability (level 0-2, x9, or boon), verify no deity pass, check renewal window (<=7 levels remaining), calculate cost, apply boon discount, activate 10-level pass, queue bonus tickets at early levels, split funds, record lootbox |
| `_purchaseDeityPass(...)` | private | purchaseDeityPass | Core deity pass logic: validate RNG unlocked, symbol available, no existing pass, calculate triangular price, apply boon discount, issue pass (deityPassCount, deityPassOwners, deityPassSymbol, deityBySymbol), mint ERC721, distribute DGNRS, queue 100-level tickets, split funds, record lootbox |
| `_lazyPassCost(uint24)` | private pure | _purchaseLazyPass | Sum of per-level ticket prices for 10 levels starting at startLevel (4 tickets per level) |
| `_rewardWhaleBundleDgnrs(address, address, address, address)` | private | _purchaseWhaleBundle | Distribute DGNRS: 1% of whale pool to buyer, 0.1% affiliate pool to direct referrer, 0.02% to upline, 0.01% (half upline) to upline2 |
| `_rewardDeityPassDgnrs(address, address, address, address)` | private | _purchaseDeityPass | Distribute DGNRS: 5% of whale pool to buyer, 0.5% affiliate pool to direct referrer, 0.1% to upline, 0.05% to upline2 |
| `_recordLootboxEntry(address, uint256, uint24, uint256)` | private | all purchase functions | Record lootbox ETH deposit: assign or extend index, apply lootbox boost boon (25/15/5%), track base and boosted amounts, update lootboxEthTotal, trigger RNG request check, track distress-mode portion |
| `_applyLootboxBoostOnPurchase(address, uint48, uint256)` | private | _recordLootboxEntry | Check and consume lootbox boost boons in priority order (25% > 15% > 5%). Boost capped at 10 ETH, expires after 2 days |
| `_recordLootboxMintDay(address, uint32, uint256)` | private | _recordLootboxEntry | Update mint day in player's packed data for lootbox tracking |
| `_maybeRequestLootboxRng(uint256)` | private | _recordLootboxEntry | Accumulate lootbox ETH for pending RNG request threshold tracking |

#### Key Mechanics (non-function)

- **Whale bundle stat boost:** Delta-based freeze extension. levelCount incremented by min(100, deltaFreeze) to prevent double-dipping from overlapping bundles.
- **Whale bundle ticket tiers:** 40 tickets/level for levels up to level 10 (bonus zone), 2 tickets/level for levels 11+ (standard).
- **Lazy pass renewal window:** Can repurchase when 7 or fewer levels remain on current freeze. Blocked if player owns a deity pass.
- **Deity pass price curve:** Triangular number series. First pass: 24 ETH. nth pass: 24 + n(n+1)/2 ETH. 32nd (last) pass: 24 + 32*33/2 = 552 ETH.
- **Deity pass symbols:** 32 symbols across 4 quadrants (Crypto 0-7, Zodiac 8-15, Cards 16-23, Dice 24-31). One player per symbol. Recorded in deityBySymbol mapping.
- **Lootbox boost on purchase:** Boons from deity/lootbox grant 5/15/25% bonus ETH on lootbox purchases (capped at 10 ETH base). Consumed in priority order (25% first). 2-day expiry.
- **Distress mode tracking:** lootboxDistressEth tracks portions purchased during distress mode for proportional ticket bonus at open time.
- **x99 bundle minimum:** At x99 levels (passLevel % 100 == 0), whale bundles require minimum 2 purchases without boon, to deter fresh-account century bonus farming.
- **Fund distribution asymmetry:** Whale/deity purchases route 95% to future pool (5% next) at levels 1+, vs 70% future / 30% next at level 0. Lazy pass uses standard 90/10 next/future split.

---

### DegenerusGameMintModule.sol (Module)

**Lines:** 1,193 | **Delegatecall from:** DegenerusGame
**Purpose:** Ticket purchasing (ETH, BURNIE, free ticket redemption), lootbox purchasing, affiliate commission routing, mint data recording, and future ticket activation via trait generation.

#### Player-Facing Functions

| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `purchase(address, uint256, uint256, bytes32, MintPaymentKind)` | external payable | buyer, ticketQuantity (scaled by 100), lootBoxAmount (wei), affiliateCode, payKind | Purchase tickets and/or ETH lootboxes | Routes ticket payment via recordMint (90/10 next/future split), records lootbox ETH (10/90 next/future split, or 40/40/20 next/future/vault during presale), pays affiliate commissions as BURNIE flip credit, applies purchase boost boon, awards century bonus at x00 levels, notifies quest system |
| `purchaseCoin(address, uint256, uint256)` | external | buyer, ticketQuantity, lootBoxBurnieAmount | Purchase tickets with BURNIE and/or BURNIE lootboxes | Burns BURNIE for tickets (1000 BURNIE = 1 ticket = 4 entries). Blocked within 30 days of liveness guard timeout (90 days at level 1+, 335 days at level 0). BURNIE lootboxes use current lootbox RNG index |
| `purchaseBurnieLootbox(address, uint256)` | external | buyer, burnieAmount | Purchase a low-EV BURNIE lootbox | Burns BURNIE (minimum 1000), assigns to current lootbox RNG index, accumulates toward RNG threshold |

#### System/Internal Functions

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `recordMintData(address, uint24, uint32)` | external payable | DegenerusGame.recordMint (via delegatecall) | Track per-player mint history in mintPacked_ bit fields: update lastLevel, levelCount, levelUnits, mintDay. New level with <4 units only tracks units without incrementing lifetime count. Respects whale bundle freeze (skips total increment while frozen). Clears frozen flag when frozenUntilLevel reached |
| `processFutureTicketBatch(uint24)` | external | AdvanceModule (via delegatecall) | Activate queued future tickets into trait burn tickets. Processes ticketQueue entries in gas-budgeted batches (550 writes safe limit, 65% cold scaling on first batch). For each player: resolve fractional remainders probabilistically, generate traits via LCG-based PRNG in groups of 16, batch-write to traitBurnTicket storage using assembly |
| `_purchaseFor(...)` | private | purchase | Core ETH purchase logic: validate amounts, calculate ticket cost, handle lootbox payment (msg.value first, claimable shortfall if Combined), route ticket purchase, record lootbox entry with affiliate, apply purchase boost boon, award century bonus, credit BURNIE flip bonus (10% of ticket equivalent + bulk bonus for 10+ tickets) |
| `_purchaseCoinFor(...)` | private | purchaseCoin | Core BURNIE purchase logic: enforce cutoff timer, burn BURNIE for tickets, optionally purchase BURNIE lootbox |
| `_purchaseBurnieLootboxFor(...)` | private | purchaseBurnieLootbox, _purchaseCoinFor | Burn BURNIE, record lootbox entry at current RNG index, accumulate pendingBurnie for RNG threshold |
| `_callTicketPurchase(...)` | private | _purchaseFor, _purchaseCoinFor | Route ticket purchase: apply purchase boost boon (5/15/25% bonus capped at 10 ETH), apply x00 century bonus (up to 2x based on activity score, 10 ETH cap per player per level), record mint via DegenerusGame.recordMint, pay affiliates, credit BURNIE flip bonuses |
| `_raritySymbolBatch(...)` | private | processFutureTicketBatch | Generate trait tickets using LCG PRNG. Groups of 16 with deterministic seed from VRF entropy. Weighted trait distribution via DegenerusTraitUtils.traitFromWord. Quadrant offset from ticket index (i & 3). Batch-writes to storage via inline assembly for gas efficiency |
| `_applyLootboxBoostOnPurchase(...)` | private | _purchaseFor | Consume lootbox boost boons in priority order (25% > 15% > 5%). Boost capped at 10 ETH base, 2-day expiry |
| `_rollRemainder(...)` | private pure | processFutureTicketBatch | Probabilistic resolution of fractional ticket remainders (0-99 scale) |

#### Key Mechanics (non-function)

- **Ticket pricing:** Tickets cost `price * quantity / (4 * TICKET_SCALE)` where TICKET_SCALE = 100. Each purchase of 1 ticket buys 4 entries. Minimum buy-in: 0.0025 ETH.
- **BURNIE ticket conversion:** 1000 BURNIE = 1 ticket = 4 entries. BURNIE is burned on purchase. Subject to 30-day liveness cutoff.
- **Lootbox pool split:** Normal: 10% next / 90% future. Presale: 40% next / 40% future / 20% vault. Distress mode: 100% next pool.
- **Century bonus (x00 levels):** Up to 2x bonus tickets scaling with activity score. Per-player 10 ETH equivalent cap across all purchases at that x00 level.
- **Lootbox boost boons:** 5/15/25% bonus on lootbox ETH deposits (capped at 10 ETH base). Consumed in priority order (25% first). 2-day expiry from deity/lootbox grant.
- **Trait generation:** LCG multiplier 6364136223846793005. Traits assigned to quadrants deterministically (ticket index mod 4). Weighted distribution produces non-uniform rarity within each 8-symbol quadrant.
- **Gas-budgeted ticket activation:** 550 write budget (65% scaling on cold first batch). Processes queue entries iteratively, advancing cursor between advanceGame calls.
- **BURNIE flip credit bonuses:** 10% of ticket equivalent cost as base, plus 2.5% bulk bonus for 10+ ticket purchases, plus extra 10% on final jackpot day at x91-x99 levels.
- **Affiliate commission:** Paid via affiliate.payAffiliate on both fresh ETH and recycled claimable portions separately. Returned as BURNIE flip credit to buyer.

---

### DegenerusGameLootboxModule.sol (Module)

**Lines:** 1,778 | **Delegatecall from:** DegenerusGame
**Purpose:** Lootbox opening and reward resolution (ETH and BURNIE), deity boon system (3 daily slots per deity pass holder), activity-score EV scaling, and boon roll mechanics.

#### Player-Facing Functions

| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `openLootBox(address, uint48)` | external | player, index | Open an ETH lootbox once RNG is available | Applies activity-score EV multiplier (80-135%, 10 ETH cap per level). Resolves reward paths: 55% tickets (5-tier variance), 10% DGNRS, 10% WWXRP, 25% BURNIE. Splits lootboxes >0.5 ETH into two rolls. Awards distress ticket bonus (25%). Grants presale BURNIE bonus (62%). Rolls boon from remaining EV budget (10% of amount, capped 1 ETH) |
| `openBurnieLootBox(address, uint48)` | external | player, index | Open a BURNIE lootbox | Lower EV than ETH lootboxes. Awards tickets at target level + small BURNIE reward. No EV multiplier (BURNIE lootboxes use fixed reward schedule) |
| `resolveLootboxDirect(address, uint256, uint256)` | external | player, amount, rngWord | Resolve a lootbox directly using provided RNG (for decimator claims) | Same reward logic as openLootBox but uses provided entropy instead of stored index. Presale always false |
| `issueDeityBoon(address, address, uint8, uint8)` | external | deity, recipient, slot (0-2), boonType (1-31) | Deity pass holder issues a boon to another player | 3 slots per deity per day. Validates deity pass ownership, slot freshness (same day = reuse OK), boon type validity. Sets boon state with same-day deity expiry. 31 boon types across 12 categories |
| `deityBoonSlots(address)` | external view | deity | View deity boon slot status for today | Returns 3-element array of (recipient, boonType, day) for each slot |

#### System/Internal Functions

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `_resolveLootbox(...)` | private | openLootBox, resolveLootboxDirect | Core lootbox resolution: compute EV-scaled amount, split >0.5 ETH into two rolls, determine reward path (tickets/DGNRS/WWXRP/BURNIE), apply ticket variance tiers, roll boon from budget, handle whale pass jackpot for >4.5 ETH lootboxes |
| `_rollRewardPath(...)` | private | _resolveLootbox | Select reward type from weighted random: 55% tickets, 10% DGNRS, 10% WWXRP, 25% BURNIE |
| `_rollTicketReward(...)` | private | _resolveLootbox | Apply 5-tier ticket variance: 1% chance 4.6x, 4% chance 2.3x, 20% chance 1.1x, 45% chance 0.651x, 30% chance 0.45x. Base budget: 161% of lootbox value |
| `_rollBoon(...)` | private | _resolveLootbox | Weighted boon selection from 31 types (total weight 1298). Categories: coinflip (5/10/25%), lootbox boost (5/15/25%), purchase boost (5/15/25%), decimator boost (10/25/50%), whale discount (10/25/50%), deity pass discount (10/25/50%), activity (10/25/50 levels), whale pass, lazy pass discount (10/25/50%). Decimator boons excluded during jackpot phase |
| `_applyEvMultiplierWithCap(...)` | private | openLootBox | Apply EV multiplier with per-account per-level 10 ETH cap. Tracks benefit used, applies neutral (100%) EV to remainder beyond cap |
| `_lootboxEvMultiplierBps(...)` | private view | openLootBox | Calculate EV multiplier from activity score: 0% activity = 80% EV, 60% = 100% EV (breakeven), 255%+ = 135% EV (max). Linear interpolation between thresholds |

#### Key Mechanics (non-function)

- **EV scaling:** Activity score 0 = 80% EV (house edge), score 60 = 100% EV (breakeven), score 255+ = 135% EV (player edge). 10 ETH benefit cap per account per level prevents unlimited extraction.
- **Reward path probabilities:** 55% tickets (highest variance), 10% DGNRS (pool-proportional), 10% WWXRP (fixed 1 token), 25% BURNIE (low/high path based on random roll).
- **Ticket variance tiers:** Tier 1 (1%): 4.6x multiplier. Tier 2 (4%): 2.3x. Tier 3 (20%): 1.1x. Tier 4 (45%): 0.651x. Tier 5 (30%): 0.45x. Base budget: 161% of lootbox value.
- **BURNIE reward paths:** Low path (58.1% base + 4.77% per step) vs high path (307% base + 94.3% per step). Presale adds 62% bonus.
- **Lootbox split:** Amounts >0.5 ETH split into two independent rolls for variance amplification.
- **Distress ticket bonus:** 25% extra tickets when purchased during distress mode (tracked via lootboxDistressEth).
- **Boon EV budget:** 10% of lootbox amount (capped at 1 ETH), reduced by estimated utilization (50%). Boons with active existing boon in same category are skipped. Boon budget scaled down by 50% assumed utilization rate.
- **Deity boon system:** 3 daily slots per deity pass holder. Can target any player. Weighted random selection from 31 boon types. Same-day deity expiry (stricter than lootbox-granted boons).
- **DGNRS reward tiers:** Small (0.001% pool/ETH), medium (0.039%), large (0.08%), mega (0.8%). Tier selected by random roll.
- **Whale pass jackpot:** Lootboxes >4.5 ETH have a chance to award whale passes (100-level ticket bundles).

---

### DegenerusGameDegeneretteModule.sol (Module)

**Lines:** 1,179 | **Delegatecall from:** DegenerusGame
**Purpose:** Degenerette symbol-roll betting: full-ticket 4-trait match betting with 3 currency types (ETH, BURNIE, WWXRP), payout multipliers from 1.90x to 100,000x, and hero quadrant override mechanics.

#### Player-Facing Functions

| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `placeFullTicketBets(address, uint256, uint8, uint8)` | external | player, packed bet spec, ticketCount (1-4), currency (0=ETH, 1=BURNIE, 2=WWXRP) | Place full-ticket Degenerette bets (4 traits per ticket) | Validates bet spec (4 symbol selections, one per quadrant). For ETH bets: deducts from claimableWinnings. For BURNIE: burns via coin.burnCoin. For WWXRP: burns via wwxrp.burnForGame. Records packed bet data at current lootbox RNG index. Tracks hero wager (most-wagered symbol per quadrant per day). Records mint streak |
| `resolveBets(address, uint64)` | external | player, betId | Resolve placed bets once RNG is available | Unpacks bet, retrieves RNG word, computes match count (0-8) per ticket via EV-normalized product-of-ratios. Awards payout based on match multiplier table. ETH payouts: 25% direct ETH (from currentPrizePool) + 75% lootbox. BURNIE/WWXRP payouts: 100% in original currency. Consolation prize: 1 WWXRP for 0-match losing bets. Awards DGNRS for 6+ matches |

#### System/Internal Functions

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `_resolveFullTicketBet(...)` | private | resolveBets | Core resolution: generate result ticket from VRF entropy (weighted trait selection per quadrant), apply hero override (most-wagered symbol auto-wins its quadrant), count matches (0-8), look up payout multiplier |
| `_calculatePayout(...)` | private | _resolveFullTicketBet | Compute raw payout from wager and multiplier. Apply ROI scaling from activity score (90% at score 0, 99.9% at score 305). Apply EV normalization: product of per-quadrant ratios compensates for non-uniform trait distribution |
| `_payoutEth(...)` | private | resolveBets | ETH payout: 25% credited as claimable ETH (from currentPrizePool), 75% resolved as lootbox via delegatecall to LootboxModule. Large payouts >5 ETH: deferred to whale pass claim. Amounts exceeding pool cap are converted to lootbox |
| `_payoutCoin(...)` | private | resolveBets | BURNIE payout: mint via coin.creditFlip |
| `_payoutWwxrp(...)` | private | resolveBets | WWXRP payout: mint via wwxrp.mintPrize |
| `_evNormalize(...)` | private pure | _calculatePayout | Product-of-ratios EV normalization per quadrant. Each quadrant contributes matchRatio or (1 - matchRatio) depending on whether the symbol matched, ensuring uniform EV across all symbol combinations despite weighted trait distribution |

#### Key Mechanics (non-function)

- **Full-ticket betting:** Each ticket has 4 traits (one per quadrant). Player selects 4 symbols. Matches are counted per quadrant (0-8 total: symbol match + color match per quadrant).
- **Payout multiplier table:** 0 matches: 0x (consolation 1 WWXRP). 1 match: 1.90x. 2 matches: 4.75x. 3 matches: 17.5x. 4 matches: 90x. 5 matches: 700x. 6 matches: 8,000x. 7 matches: 40,000x. 8 matches: 100,000x.
- **ROI from activity score:** Base ROI scales linearly 90% (score 0) to 99% (score 75) to 99.9% (score 305). This is the house edge on Degenerette specifically.
- **EV normalization:** Product-of-ratios per quadrant compensates for non-uniform trait rarity. Ensures every symbol combination has equal expected value despite different probabilities of appearing.
- **Hero quadrant override:** The most-wagered symbol per quadrant per day automatically wins its quadrant in the result ticket. Creates positive externality: large wagers boost win probability for all players who picked the popular symbol. Tracked via dailyHeroWager mapping.
- **3 currency modes:** ETH (from claimableWinnings), BURNIE (burned), WWXRP (burned). ETH payouts split 25% direct ETH / 75% lootbox. BURNIE/WWXRP payouts are 100% in original currency.
- **Consolation prize:** 1 WWXRP minted to losing players (0 matches) as participation reward.
- **DGNRS rewards:** 6+ matches award DGNRS tokens from the reward pool.
- **Bet packing:** Bet data packed into uint256: currency, ticketCount, wager amount, 4 symbol selections, RNG index. Unpacked at resolution time.

---

### DegenerusGameAdvanceModule.sol (Module)

**Lines:** 1,383 | **Delegatecall from:** DegenerusGame
**Purpose:** FSM controller for the game loop: daily advanceGame processing, VRF lifecycle (Chainlink V2.5), prize pool consolidation, level transitions, liveness guards, and delegatecall orchestration of jackpot/endgame modules.

#### Player-Facing Functions

| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `advanceGame()` | external | none | Advance game state (called daily by any participant) | Multi-stage FSM: check liveness guard, enforce daily mint gate, drain ticket queues, request/consume VRF, process daily jackpots (ETH + BURNIE), detect pool target reached, consolidate prize pools at level transition, enter jackpot phase, process 5-day jackpot draws, trigger BAF/Decimator reward jackpots, end phase. Caller receives ~0.01 ETH equivalent BURNIE bounty (2-3x escalation if stalled >1-2 hours) |
| `requestLootboxRng()` | external | none | Request mid-day lootbox RNG when activity threshold is met | Cannot be called while daily RNG is locked. Checks LINK balance (minimum 40 LINK). Validates ETH/BURNIE threshold. Swaps ticket write buffer to freeze snapshot. Requests Chainlink VRF V2.5 with 3 confirmations |
| `reverseFlip()` | external | none | Reverse pending coinflip queue by paying escalating BURNIE cost | Base cost 100 BURNIE + 50% compound per queued flip. Burns BURNIE from caller. Triggers coinflip processing reversal |

#### System/Internal Functions

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `wireVrf(address, uint256, bytes32)` | external | ADMIN constructor (deploy-only) | Wire VRF coordinator, subscription ID, and key hash. One-time setup |
| `updateVrfCoordinatorAndSub(address, uint256)` | external | ADMIN only | Emergency VRF coordinator rotation. Updates coordinator address and subscription ID |
| `rawFulfillRandomWords(uint256, uint256[])` | external | VRF Coordinator callback | Receive VRF random word. Stores in rngWordCurrent. Finalizes lootbox RNG if mid-day request |
| `_handleGameOverPath(...)` | private | advanceGame | Check liveness guards (365d level 0, 120d level 1+). If triggered: delegate to GameOverModule.handleGameOverDrain or handleFinalSweep (30d post-gameover). Safety: skips gameover if nextPool already meets target |
| `rngGate(...)` | internal | advanceGame | VRF lifecycle gate: return existing word, process fresh VRF (apply daily RNG, process coinflip payouts, finalize lootbox RNG), request new VRF, or handle 12-hour timeout retry |
| `_requestRng(...)` | private | rngGate | Request Chainlink VRF V2.5 with 10 confirmations. Increments level on lastPurchaseDay. Sets rngLockedFlag, freezes pools, reserves lootbox RNG index |
| `_applyDailyRng(...)` | private | rngGate | Apply RNG nudges: XOR accumulated nudge entropy into VRF word. Record final word in rngWordByDay. Update lastVrfProcessedTimestamp |
| `_consolidatePrizePools(...)` | private | advanceGame | Delegatecall to JackpotModule.consolidatePrizePools: merge nextPool into currentPrizePool, rebalance future/current, credit BURNIE coinflip, distribute stETH yield |
| `_drawDownFuturePrizePool(...)` | private | advanceGame | Release 15% of futurePool into nextPool at level transition. Skipped at x00 levels (century boundary preserves future pool) |
| `_applyTimeBasedFutureTake(...)` | private | advanceGame | Time-adaptive next-to-future skim: 30% base for fast levels (<=1 day), decays to 13% min over 14 days, rises again for slow levels. Adjusts +/-2% for future/next ratio and growth rate. Random variance +/-10% |
| `_enforceDailyMintGate(...)` | private view | advanceGame | Require caller minted recently. Bypass tiers: deity pass (always), anyone (30+ min past day boundary), pass holder (15+ min), DGVE vault owner (always) |
| `_prepareFutureTickets(...)` | private | advanceGame | Process near-future ticket queues (+2 to +6 levels ahead) before daily draws to include fresh lootbox-driven tickets |
| `_gameOverEntropy(...)` | private | _handleGameOverPath | Gameover RNG with fallback: try VRF, after 3-day timeout use historical VRF words (up to 5 early words hashed with prevrandao) as secure fallback |

#### Key Mechanics (non-function)

- **FSM stages:** GAMEOVER(0), RNG_REQUESTED(1), TRANSITION_WORKING(2), TRANSITION_DONE(3), FUTURE_TICKETS_WORKING(4), TICKETS_WORKING(5), PURCHASE_DAILY(6), ENTERED_JACKPOT(7), JACKPOT_ETH_RESUME(8), JACKPOT_COIN_TICKETS(9), JACKPOT_PHASE_ENDED(10), JACKPOT_DAILY_STARTED(11). Each advanceGame call processes one stage and exits.
- **VRF lifecycle:** Request with 10 confirmations (3 for mid-day lootbox). 12-hour timeout triggers retry. 3-day stall triggers historical VRF fallback for gameover. RNG nudge system: 100 BURNIE base + 50% compound per nudge, XORed into final word.
- **Pool consolidation at level transition:** nextPool becomes currentPrizePool (jackpots paid from this). FuturePool contributes via 15% drawdown (skipped at x00). Time-based skim transfers 13-30%+ of nextPool to futurePool based on level completion speed.
- **Compressed/turbo jackpots:** Flag set when pool target met within 2 days (compressed = 3-day jackpot) or 1 day (turbo = 1-day jackpot). Reduces jackpot phase duration.
- **Liveness guard:** Level 0: 365 days. Level 1+: 120 days since levelStartTime. Safety: resets timer if nextPool already meets target.
- **Decimator window:** Opens at levels x4 (not x94) and x99. Closed during RNG lock.
- **Presale auto-end:** Triggers at first level transition (level 3+) or when lootbox presale ETH reaches 200 ETH cap.
- **Bounty escalation:** 2x after 1 hour past day boundary, 3x after 2 hours. Incentivizes timely advanceGame calls.
- **Pool freeze:** Pools frozen during VRF request period. Purchases during freeze route to pending pools, merged on unfreeze.
- **Ticket buffer double-buffering:** Read/write slot swap ensures tickets purchased after VRF request don't participate in current round's trait generation.

---

### DegenerusGameDecimatorModule.sol (Module)

**Lines:** 1,027 | **Delegatecall from:** DegenerusGame
**Purpose:** Decimator burn tracking, jackpot resolution, and claim distribution. Includes both the regular decimator (periodic during gameplay) and the terminal decimator (death bet for GAMEOVER).

#### Player-Facing Functions

| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `claimDecimatorJackpot(uint24)` | external | lvl | Claim regular decimator jackpot winnings | Validates winner (correct subbucket match), marks claimed, splits 50/50 ETH/lootbox (100% ETH during GAMEOVER). ETH portion goes through auto-rebuy if enabled. Claims blocked during pool freeze. Claims expire when next decimator runs |
| `claimTerminalDecimatorJackpot()` | external | none | Claim terminal decimator jackpot (post-GAMEOVER) | 100% ETH payout (no lootbox split). Uses weightedBurn for pro-rata share (time multiplier already applied). Marks claimed by zeroing weightedBurn |

#### System/Internal Functions

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `creditDecJackpotClaimBatch(address[], uint256[], uint256)` | external | JACKPOTS contract | Credit decimator jackpot claims to multiple accounts in batch. GAMEOVER: 100% ETH. Normal: 50/50 ETH/lootbox split. Lootbox portion aggregated and added to futurePool once at end |
| `creditDecJackpotClaim(address, uint256, uint256)` | external | JACKPOTS contract | Credit single decimator jackpot claim. Same split logic as batch version |
| `recordDecBurn(address, uint24, uint8, uint256, uint256)` | external | COIN contract | Record BURNIE burn for decimator eligibility. First burn sets bucket (denominator 2-12) and deterministic subbucket from hash(player, lvl, bucket). Subsequent burns accumulate. Can migrate to lower (better) bucket. Effective amount computed with activity-score multiplier (capped at 200 mints worth) |
| `runDecimatorJackpot(uint256, uint24, uint256)` | external | DegenerusGame (via delegatecall) | Snapshot regular decimator winners. Selects winning subbucket per denominator (2-12) from VRF. Stores packed offsets and claim round data. Returns pool if no qualifying burns or already snapshotted |
| `consumeDecClaim(address, uint24)` | external | DegenerusGame (via delegatecall) | Validate and mark regular decimator claim. Pro-rata share: (pool * playerBurn) / totalBurn |
| `decClaimable(address, uint24)` | external view | UI/frontend | View claimable amount and winner status for regular decimator |
| `recordTerminalDecBurn(address, uint24, uint256)` | external | COIN contract | Record terminal decimator burn. Bucket/subbucket from activity score (level 100 rules, min bucket 2). Applies activity multiplier + time multiplier (30x at 120 days down to 1x at 2 days). Burns blocked at <=1 day remaining |
| `runTerminalDecimatorJackpot(uint256, uint24, uint256)` | external | DegenerusGame (via delegatecall) | Resolve terminal decimator at GAMEOVER. Same subbucket selection as regular. Uses weightedBurn (time-multiplied) for pro-rata distribution |
| `terminalDecClaimable(address)` | external view | UI/frontend | View terminal decimator claimable amount and winner status |
| `_decEffectiveAmount(...)` | private pure | recordDecBurn, recordTerminalDecBurn | Apply activity-score multiplier with 200-mint cap. Once cap reached, additional burns counted at 1x |
| `_decSubbucketFor(...)` | private pure | recordDecBurn, recordTerminalDecBurn | Deterministic subbucket: hash(player, lvl, bucket) mod bucket |
| `_creditDecJackpotClaimCore(...)` | private | creditDecJackpotClaimBatch, creditDecJackpotClaim, claimDecimatorJackpot | Split 50/50: half as claimable ETH (through auto-rebuy), half as lootbox (resolved via LootboxModule delegatecall). Lootbox portion removed from claimablePool, added to futurePool |
| `_awardDecimatorLootbox(...)` | private | _creditDecJackpotClaimCore | Resolve lootbox: amounts >5 ETH deferred to whale pass claim, smaller amounts resolved via LootboxModule.resolveLootboxDirect delegatecall |

#### Key Mechanics (non-function)

- **Bucket system:** Denominators 2-12. Lower denominator = better odds (1/2 vs 1/12) but shared with more players. Activity score determines bucket assignment. Subbucket is deterministic from hash(player, level, bucket).
- **Activity-score multiplier:** 1.0x (score 0) to 1.767x (score 235, cap). Applied to first 200 mints worth of burns; excess at 1x. "BURNIE is worth more in skilled hands."
- **Bucket migration:** If player provides a strictly lower denominator on subsequent burn, previous burn migrates to new subbucket. Old subbucket aggregate decremented.
- **Claim expiration:** Claims expire when the next decimator runs (lastDecClaimRound overwritten). Only one active decimator round at a time.
- **50/50 ETH/lootbox split:** Normal play: half credited as claimable ETH, half resolved as lootbox tickets. GAMEOVER: 100% ETH.
- **Terminal decimator (death bet):** Always-open burn for GAMEOVER prediction. Time multiplier rewards early conviction: 30x at 120 days remaining, linear decay to 2.75x at 11 days, regime change to 2x at 10 days, linear to 1x at 2 days. Burns blocked at <=1 day (24h cooldown before GAMEOVER triggers).
- **Terminal time multiplier formula:** >10 days: daysRemaining * 2500 BPS (i.e., daysRemaining/4 as multiplier). <=10 days: 10000 + (daysRemaining-2) * 10000/8 BPS. Intentional discontinuity at day 10 boundary (2.75x to 2x regime change).
- **Terminal bucket assignment:** Uses level 100 rules regardless of actual level. Activity score capped at 235 for bucket calculation. Minimum bucket 2.
- **Pro-rata distribution:** Winner's share = (pool * playerBurn) / totalWinnerBurn across all winning subbuckets. Terminal uses weightedBurn (time-multiplied) instead of raw burn.

---

### DegenerusGameJackpotModule.sol (Module)

**Lines:** 2,795 | **Delegatecall from:** DegenerusGame
**Purpose:** All jackpot mechanics: daily ETH jackpots (purchase and jackpot phases), daily BURNIE jackpots, 5-day jackpot-phase sequence, prize pool consolidation, terminal jackpots, trait-based winner selection, yield distribution, and gas-safe chunked distribution.

#### Player-Facing Functions

| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `runTerminalJackpot(uint48)` | external | day | Execute terminal jackpot at GAMEOVER | Day-5-style distribution: 100% of currentPrizePool distributed to next-level ticketholders via 4 trait buckets (60/13/13/13 split). Solo bucket winner gets 75% ETH / 25% whale passes |

#### System/Internal Functions

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `payDailyJackpot(bool, uint24, uint256)` | external | AdvanceModule (daily during both phases) | Multi-phase ETH jackpot distribution. Purchase phase: early-burn payout from futurePool. Jackpot phase days 1-4: random 6-14% of currentPrizePool. Day 5: 100% remaining currentPrizePool. 4 trait buckets with daily/final bucket splits. Chunked distribution (gas-safe, resumes across multiple advanceGame calls). Carryover from near-future levels (1% futurePool budget) |
| `payDailyJackpotCoinAndTickets(uint256)` | external | AdvanceModule (after ETH distribution) | Complete the daily jackpot: distribute BURNIE jackpot + process ticket rewards. Called as separate transaction for gas management |
| `consolidatePrizePools(uint24, uint256)` | external | AdvanceModule (at level transition) | Merge nextPool into currentPrizePool. At x00 levels: 5-dice consolidation (keep 30-65% of futurePool based on 5 independent dice rolls). Distribute stETH yield (23% DGNRS / 23% vault / 46% accumulator + 8% buffer). Credit BURNIE coinflip pool. Award early-bird lootbox (3% futurePool on day 1) |
| `processTicketBatch(uint24)` | external | AdvanceModule (via delegatecall) | Gas-budgeted trait ticket generation from ticketQueue. Same algorithm as MintModule.processFutureTicketBatch: LCG-based PRNG, assembly batch writes, fractional remainder rolls |
| `awardFinalDayDgnrsReward(uint24, uint256)` | external | AdvanceModule (after final jackpot day) | Award DGNRS reward to the solo bucket winner after the 5th daily jackpot |
| `payDailyCoinJackpot(uint24, uint256)` | external | AdvanceModule (daily during purchase phase) | Daily BURNIE jackpot: 0.5% of prize pool target in BURNIE. 75% to near-future trait-matched winners ([lvl, lvl+4]). 25% to far-future ticketQueue holders ([lvl+5, lvl+99]) |
| `_rollWinningTraits(...)` | private | payDailyJackpot, payDailyCoinJackpot | Generate 4 winning traits (one per quadrant). During jackpot phase: uses burn-count-weighted selection with hero override. During purchase phase: pure VRF random |
| `_randTraitTicket(...)` | private view | payDailyJackpot | Select random winners from trait ticket pool. Duplicates allowed (more tickets = more chances). Virtual deity entries: floor(2% of bucket tickets, minimum 2) if deity exists for the symbol |
| `_randTraitTicketWithIndices(...)` | private view | payDailyCoinJackpot | Same as _randTraitTicket but also returns ticket indices for event logging |
| `_dailyCurrentPoolBps(...)` | private pure | payDailyJackpot | Days 1-4: random 6-14% (uniform). Day 5: 100%. Determines ETH budget per jackpot day |
| `_selectCarryoverSourceOffset(...)` | private view | payDailyJackpot | Select random eligible carryover source offset in [1..4] for near-future ticket distribution. Probes from random start, skips levels with no winning-trait tickets |
| `_awardFarFutureCoinJackpot(...)` | private | payDailyCoinJackpot | Awards 25% of BURNIE budget to random ticketQueue holders on far-future levels [lvl+5, lvl+99]. Samples up to 10 random levels, 1 winner per level |
| `_awardDailyCoinToTraitWinners(...)` | private | payDailyCoinJackpot | Awards BURNIE to trait-matched winners at a target level. Batched creditFlipBatch calls (3 per batch) |
| `_clearDailyEthState()` | private | payDailyJackpot | Reset all daily distribution state after jackpot day completes |
| `_raritySymbolBatch(...)` | private | processTicketBatch | Identical LCG trait generation as MintModule (shared algorithm, separate copy for module isolation) |
| `_generateTicketBatch(...)` | private | processTicketBatch | Wrapper for _raritySymbolBatch to reduce stack usage |
| `_computeBucketCounts(...)` | private view | payDailyJackpot, payDailyCoinJackpot | Compute winner counts per trait bucket. Daily splits: 20/20/20/20 (equal). Final day splits: 60/13/13/13 (solo bucket gets 60%). Solo bucket is the trait with the most tickets |

#### Key Mechanics (non-function)

- **5-day jackpot phase:** Days 1-4 distribute 6-14% of currentPrizePool (random within range). Day 5 distributes 100% remaining. Compressed mode (3 days) and turbo mode (1 day) available for fast levels.
- **Trait-based bucket distribution:** 4 winning traits selected per day (one per quadrant). Winners are random ticket holders matching winning traits. Daily bucket split: 20/20/20/20 (equal). Final day: 60/13/13/13 (solo bucket = trait with most tickets gets 60%).
- **Solo bucket winner:** Final day solo bucket (60% share) distributed to a single winner. Gets 75% as ETH, 25% as whale passes. Also receives DGNRS reward.
- **Hero override in winning traits:** During jackpot phase, uses burn-count-weighted trait selection with hero override (most-wagered Degenerette symbol auto-wins its quadrant). During purchase phase: pure VRF random.
- **Virtual deity entries:** Deity pass holders get virtual tickets in their symbol's trait bucket: floor(2% of bucket size, minimum 2). These represent deity pass holders' chance to win jackpots without explicit ticket purchases.
- **Carryover system:** Each daily jackpot includes 1% of futurePool as carryover budget, distributed to trait-matched winners on near-future levels [lvl+1..lvl+4]. Ensures future ticket holders receive ongoing jackpot participation.
- **Pool lock at RNG:** When VRF is requested, pool values are frozen. This prevents pool manipulation between RNG request and consumption. Pending purchases route to separate pending pools, merged on unfreeze.
- **x00 consolidation (5-dice):** At century boundaries (level 100, 200, ...), futurePool is consolidated by rolling 5 independent dice. Each die independently keeps 30-65% of its portion. Creates variance in how much futurePool carries forward.
- **Yield distribution at consolidation:** stETH yield split: 23% to DGNRS reward pool, 23% to vault, 46% to segregated accumulator. 8% contract buffer retained.
- **Early-bird lootbox:** Day 1 of jackpot phase: 3% of futurePool allocated as early-bird lootbox reward, resolved via LootboxModule.
- **BURNIE jackpot (daily):** 0.5% of prize pool target in BURNIE. Split 75% near-future (trait-matched winners at [lvl, lvl+4]) and 25% far-future (random ticketQueue holders at [lvl+5, lvl+99], up to 10 levels sampled).
- **Gas-safe chunked distribution:** Daily ETH distribution uses multi-phase cursor system (dailyEthPhase, dailyEthBucketCursor, dailyEthWinnerCursor) allowing distribution to resume across multiple advanceGame calls. Maximum 3 winners per batch in BURNIE distribution.
- **Auto-rebuy on jackpot winnings:** When enabled, ETH winnings converted to tickets at 1-4 levels ahead (30% bonus, 45% afKing). Take-profit reserves preserved as claimable.
