# EXTR-01: DegenerusGame.sol and Game Modules

**Source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/
**Scope:** DegenerusGame.sol (main dispatcher) + 12 delegatecall modules
**Status:** Part 1 of 2 (Plan 01 covers DegenerusGame + 6 smaller modules; Plan 02 covers 6 larger modules)

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

<!-- Plan 02 continues with: AdvanceModule, DecimatorModule, DegeneretteModule, JackpotModule, LootboxModule, MintModule -->
