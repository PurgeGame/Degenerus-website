# EXTR-04: Infrastructure Contracts
**Source:** /home/zak/Dev/PurgeGame/degenerus-audit/contracts/
**Scope:** DegenerusJackpots, DegenerusAdmin, DegenerusTraitUtils, DeityBoonViewer, Icons32Data, ContractAddresses, 5 libraries, DegenerusGameStorage
**Status:** Complete

---

## DegenerusJackpots.sol
**Lines:** 689 | **Functions:** 10 (external: 3, private/internal: 7)
**Purpose:** Standalone BAF (Big Ass Flip) jackpot draw engine. Records coinflip stakes, maintains top-4 leaderboard per level, and resolves BAF prize distribution across multiple winner categories.

### Player-Facing Functions
| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `getLastBafResolvedDay()` | external view | none | Returns the day index of the most recent BAF jackpot resolution | Read-only |

### System/Internal Functions
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `recordBafFlip(address, uint24, uint256)` | external (onlyCoin) | BurnieCoin/BurnieCoinflip | Records a coinflip stake for BAF leaderboard. Lazy-resets player totals on epoch change. Updates top-4 sorted leaderboard. Silently ignores vault and sDGNRS addresses. |
| `runBafJackpot(uint256, uint24, uint256)` | external (onlyGame) | DegenerusGame (JackpotModule) | Resolves the BAF jackpot for a level. Distributes poolWei across 7 prize slices, clears leaderboard, increments epoch. Returns winners/amounts/winnerMask/returnAmountWei. |
| `_creditOrRefund(...)` | private pure | runBafJackpot | Writes winner+amount to buffer if candidate is non-zero; returns false for refund |
| `_bafScore(address, uint24)` | private view | runBafJackpot | Returns player's accumulated coinflip total for a level (0 if epoch mismatch) |
| `_score96(uint256)` | private pure | _updateBafTop | Caps raw score to uint96 in whole-token units |
| `_updateBafTop(uint24, address, uint256)` | private | recordBafFlip | Maintains sorted top-4 leaderboard: updates existing player, inserts new, or replaces bottom |
| `_bafTop(uint24, uint8)` | private view | runBafJackpot | Returns player+score at leaderboard position (address(0) if empty) |
| `_clearBafTop(uint24)` | private | runBafJackpot | Deletes leaderboard entries after jackpot resolution |

### Key Mechanics (non-function)

- **BAF prize distribution (7 slices):**
  - 10% to top BAF bettor for the level
  - 5% to top coinflip bettor from last 24h window (queried from BurnieCoinflip)
  - 5% to randomly chosen 3rd or 4th BAF leaderboard slot
  - 5% to far-future ticket holders (3% 1st / 2% 2nd by BAF score) - draw 1
  - 5% to far-future ticket holders (3% 1st / 2% 2nd by BAF score) - draw 2
  - 45% scatter 1st place (50 rounds x 4 trait-sampled tickets, top BAF score per round)
  - 25% scatter 2nd place (50 rounds x 4 trait-sampled tickets, 2nd BAF score per round)
- **Scatter level targeting:**
  - Non-x00 levels: 20 rounds at lvl+1, 10 at lvl+2, 10 at lvl+3, 10 at lvl+4
  - x00 century levels: 4 at lvl+1, 4 at lvl+2, 4 at lvl+3, 38 random from past 99 levels
- **Epoch-based lazy reset:** Each level has a bafEpoch counter incremented on resolution. Player totals auto-reset when their stored epoch misses current.
- **Winner mask:** Last 40 scatter winners get bitmask flags (offset 128) for special ticket-routing treatment by the game contract.
- **Max 107 distinct winners per draw:** 1 + 1 + 1 + 4 (far-future x2) + 50 + 50 (scatter)
- **VRF entropy chaining:** Initial rngWord is chained via `keccak256(abi.encodePacked(entropy, salt))` with incrementing salt for each slice, ensuring independence.

---

## DegenerusAdmin.sol
**Lines:** 801 | **Functions:** 15 (external: 10, internal: 2, private: 3)
**Purpose:** Central administration contract. Owns the VRF subscription, manages LINK donations with reward multipliers, and governs emergency VRF coordinator swaps via sDGNRS-holder voting.

### Ownership Model
- Owner = anyone holding >50.1% of DGVE supply (vault governance token), checked via `vault.isVaultOwner(msg.sender)`
- No single-address owner; transferable via DGVE market

### Admin/Configuration Functions

**VRF & Liquidity Management (onlyOwner):**

| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `setLinkEthPriceFeed(address)` | external | feed | Sets LINK/ETH Chainlink price feed address. Only callable when current feed is unhealthy (stale/invalid). Validates 18-decimal format. |
| `swapGameEthForStEth()` | external payable | (msg.value) | Forwards ETH to game contract's adminSwapEthForStEth to convert ETH to stETH |
| `stakeGameEthToStEth(uint256)` | external | amount | Calls game contract's adminStakeEthForStEth to stake ETH as stETH |
| `setLootboxRngThreshold(uint256)` | external | newThreshold | Updates the lootbox RNG threshold on the game contract |

**VRF Governance (propose/vote system):**

| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `propose(address, bytes32)` | external | newCoordinator, newKeyHash | Creates emergency VRF swap proposal. Admin path: DGVE holder, 20h stall. Community path: 0.5%+ sDGNRS, 7d stall. 1-per-address active limit. |
| `vote(uint256, bool)` | external | proposalId, approve | Casts/changes vote on active proposal. Uses live sDGNRS balance as weight. Auto-checks execute/kill conditions via decaying threshold. Reverts if VRF recovered (<20h stall). |
| `shutdownVrf()` | external (onlyGame) | none | Cancels VRF subscription and sweeps LINK to vault after GAMEOVER. Called by game contract during handleFinalSweep. |

**View Functions:**

| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `circulatingSupply()` | public view | none | Returns sDGNRS totalSupply minus sDGNRS self-balance minus DGNRS-held balance |
| `threshold(uint256)` | public view | proposalId | Returns current approval threshold in BPS. Decays daily: 50% (0-48h) -> 40% -> 30% -> 20% -> 10% -> 5% (144-168h) -> 0% (expired) |
| `canExecute(uint256)` | external view | proposalId | Checks if proposal meets all execution conditions (active, not expired, stall persists, threshold met, approve > reject) |

### LINK Donation Handling (ERC-677)

| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `onTokenTransfer(address, uint256, bytes)` | external | LINK token (ERC-677 callback) | Receives LINK donations, forwards to VRF subscription, calculates reward multiplier based on sub balance, converts LINK to ETH-equivalent via price feed, credits donor with BURNIE coinflip credits via BurnieCoin |

### System/Internal Functions
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `_executeSwap(uint256)` | internal | vote | Executes VRF coordinator swap: voids all other proposals, cancels old sub, creates new sub on proposed coordinator, adds Game consumer, pushes config to Game, transfers LINK balance |
| `_voidAllActive(uint256)` | internal | _executeSwap | Marks all active proposals (except executed one) as Killed. Uses voidedUpTo watermark for efficiency. |
| `linkAmountToEth(uint256)` | external view | onTokenTransfer (via this.linkAmountToEth) | Converts LINK amount to ETH using Chainlink price feed. Validates feed freshness (< 1 day stale). |
| `_linkRewardMultiplier(uint256)` | private pure | onTokenTransfer | Returns reward multiplier (0 to 3x in 1e18 scale) based on sub LINK balance. 3x at 0 LINK, linearly to 1x at 200 LINK, linearly to 0x at 1000 LINK. |
| `_feedHealthy(address)` | private view | setLinkEthPriceFeed | Checks if price feed is fresh, valid, and 18-decimal |

### Key Mechanics (non-function)

- **Governance threshold decay:** Starts at 50% (first 48h), drops 10% every 24h, reaches 5% at 144h, expires at 168h (7 days)
- **VRF stall detection:** Admin path requires 20h+ since last VRF processed. Community path requires 7d+. Every vote re-checks stall; if VRF recovers, all governance reverts.
- **Auto-invalidation:** Votes revert with NotStalled if VRF has recovered, which effectively cancels all active proposals on recovery.
- **LINK reward curve:** Incentivizes LINK donations when subscription balance is low (3x multiplier at 0 balance), tapers to zero at 1000 LINK.
- **Constructor atomics:** Creates VRF subscription, adds Game as consumer, and wires VRF config to Game in a single deployment transaction.

---

## DegenerusTraitUtils.sol
**Lines:** 183 | **Functions:** 3 (internal pure: 3)
**Purpose:** Pure library for deterministic trait generation from VRF-derived random seeds. Used by ticket minting and trait sampling flows.

### Library Functions
| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `weightedBucket(uint32)` | internal pure | rnd (32-bit random) | Maps random input to bucket 0-7 with weighted distribution. Buckets 0-3 ~13.3% each, 4-6 ~12.0% each, 7 ~10.7%. Scales via 75-range mapping. |
| `traitFromWord(uint64)` | internal pure | rnd (64-bit random) | Produces a 6-bit trait ID. Low 32 bits -> category bucket (bits 5-3), high 32 bits -> sub-bucket (bits 2-0). Quadrant bits added by caller. |
| `packedTraitsFromSeed(uint256)` | internal pure | rand (256-bit seed) | Packs 4 quadrant traits into 32 bits from a 256-bit seed. Splits seed into 4x64-bit words, generates trait per quadrant, adds quadrant identifiers (00/01/10/11 in bits 7-6). |

### Key Mechanics (non-function)

- **Trait ID structure (8 bits per trait):**
  - Bits 7-6: Quadrant (A=0, B=1, C=2, D=3)
  - Bits 5-3: Category bucket (0-7, weighted)
  - Bits 2-0: Sub-bucket (0-7, weighted)
  - Format: `[QQ][CCC][SSS]`
- **Packed traits (32 bits total):** `[TraitD:8][TraitC:8][TraitB:8][TraitA:8]`
- **Deterministic guarantee:** Same seed always produces same traits. Seeds derived from `keccak256(abi.encode(tokenId, ...))`. Players cannot choose traits.
- **Weighted distribution (per bucket level):**
  - Buckets 0-3: 10/75 width each (~13.3%)
  - Buckets 4-6: 9/75 width each (~12.0%)
  - Bucket 7: 8/75 width (~10.7%)
- **4 quadrants:** Crypto (Q0, 8 symbols), Zodiac (Q1), Cards (Q2), Dice (Q3). Each quadrant has 8 categories x 8 sub-variants = 64 possible traits per quadrant.

---

## DeityBoonViewer.sol
**Lines:** 171 | **Functions:** 2 (external view: 1, private pure: 1)
**Purpose:** Read-only helper contract that computes deity boon slot types. Reads raw state from DegenerusGame and applies weighted random selection logic.

### Player-Facing Functions
| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `deityBoonSlots(address, address)` | external view | game, deity | Returns 3 daily boon slot types + usedMask + day for a deity. Derives boon types from dailySeed using weighted random selection. | Read-only view |

### System/Internal Functions
| Function | Visibility | Called By | What It Does |
|----------|-----------|-----------|--------------|
| `_boonFromRoll(uint256, bool, bool)` | private pure | deityBoonSlots | Maps a random roll to a boon type ID using cumulative weight thresholds. Conditionally includes decimator boons (if window open) and deity pass boons (if eligible). |

### Key Mechanics (non-function)

- **22 boon types across 10 categories:**
  - Coinflip bonus: 5%/10%/25% (weights 200/40/8)
  - Lootbox bonus: 5%/15%/25% (weights 200/30/8)
  - Purchase boost: 5%/15%/25% (weights 400/80/16)
  - Decimator bonus: 10%/25%/50% (weights 40/8/2, only when decimator window open)
  - Whale discount: 10%/25%/50% (weights 28/10/2)
  - Deity pass discount: 10%/25%/50% (weights 28/10/2, only when deity pass available)
  - Activity bonus: 10%/25%/50% (weights 100/30/8)
  - Whale pass (full): weight 8
  - Lazy pass discount: 10%/25%/50% (weights 30/8/2)
- **Total weight:** 1298 (with decimator) or 1248 (without decimator), minus 40 if deity pass unavailable
- **3 daily slots per deity**, each derived from `keccak256(abi.encode(dailySeed, deity, day, slotIndex))`

---

## Icons32Data.sol
**Lines:** 228 | **Functions:** 5 (external: 4, external view: 2)
**Purpose:** On-chain SVG icon path storage for Degenerus token/trophy renders. Stores 33 icon paths + symbol names across 4 quadrants. Mutable until finalized, then permanently immutable.

### Admin/Configuration Functions
| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `setPaths(uint256, string[])` | external (onlyCreator) | startIndex, paths | Sets a batch of SVG path strings (max 10 per call). Only before finalization. |
| `setSymbols(uint256, string[8])` | external (onlyCreator) | quadrant, symbols | Sets 8 symbol names for quadrant 0/1/2. Only before finalization. |
| `finalize()` | external (onlyCreator) | none | Locks all data permanently. One-time, irreversible. |

### Player-Facing Functions
| Function | Visibility | Parameters | What It Does | Key Effects |
|----------|-----------|------------|--------------|-------------|
| `data(uint256)` | external view | i (0-32) | Returns SVG path "d" attribute for icon at index. 0-7: Crypto, 8-15: Zodiac, 16-23: Cards, 24-31: Dice, 32: Affiliate badge. | Read-only |
| `symbol(uint256, uint8)` | external view | quadrant, idx | Returns human-readable symbol name. Q3 (Dice) returns empty (generated dynamically by renderer). | Read-only |

### Key Mechanics (non-function)
- **4 quadrants x 8 symbols = 32 icons + 1 affiliate badge = 33 paths**
- **Quadrant layout:** Q0=Crypto (Bitcoin, Ethereum...), Q1=Zodiac (Aries, Taurus...), Q2=Cards (Club, Diamond, Heart...), Q3=Dice (1-8, names generated dynamically)
- **Separate flame icon (_diamond)** for center glyph on all token renders
- **Access control:** Only CREATOR address can write; all data immutable after `finalize()`

---

## ContractAddresses.sol
**Lines:** 39 | **Type:** Library (compile-time constants)
**Purpose:** Compile-time address constants populated by the deploy script. Contains all 24 contract deployment addresses (GAME, COIN, COINFLIP, VAULT, AFFILIATE, JACKPOTS, QUESTS, SDGNRS, DGNRS, ADMIN, DEITY_PASS, WWXRP, STETH_TOKEN, LINK_TOKEN, CREATOR, VRF_COORDINATOR, WXRP, ICONS_32, and all 9 module addresses), plus DEPLOY_DAY_BOUNDARY (uint48) and VRF_KEY_HASH (bytes32). All addresses are zeroed in source; the deploy pipeline generates a concrete version with live addresses before compilation.

---

## Libraries

### BitPackingLib.sol
**Lines:** 88 | **Type:** Library (internal pure)
**Purpose:** Bit-packed storage field operations for the mintPacked_ player data word. Defines field positions, masks, and a generic setPacked() function.

| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `setPacked(uint256, uint256, uint256, uint256)` | internal pure | data, shift, mask, value | Clears a packed field and sets a new value: `(data & ~(mask << shift)) | ((value & mask) << shift)` |

**Mint data layout (256 bits):**
| Bits | Field | Width | What It Tracks |
|------|-------|-------|----------------|
| 0-23 | LAST_LEVEL_SHIFT | 24 | Last level purchased |
| 24-47 | LEVEL_COUNT_SHIFT | 24 | Total level purchases (used in activity score) |
| 48-71 | LEVEL_STREAK_SHIFT | 24 | Consecutive level streak (MintStreakUtils) |
| 72-103 | DAY_SHIFT | 32 | Day index of last purchase |
| 104-127 | LEVEL_UNITS_LEVEL_SHIFT | 24 | Level for unit tracking |
| 128-151 | FROZEN_UNTIL_LEVEL_SHIFT | 24 | Frozen level for whale/lazy bundles |
| 152-153 | WHALE_BUNDLE_TYPE_SHIFT | 2 | Bundle type (0=none, 1=10-lvl lazy, 3=100-lvl whale) |
| 160-183 | MINT_STREAK_LAST_COMPLETED | 24 | Last level credited for mint streak |
| 228-243 | LEVEL_UNITS_SHIFT | 16 | Units purchased at current level |

### EntropyLib.sol
**Lines:** 24 | **Type:** Library (internal pure)
**Purpose:** XOR-shift PRNG for deterministic entropy derivation from VRF seeds.

| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `entropyStep(uint256)` | internal pure | state | XOR-shift step: `state ^= state << 7; state ^= state >> 9; state ^= state << 8`. Returns next PRNG state. Seeded from VRF for ultimate security. |

### GameTimeLib.sol
**Lines:** 35 | **Type:** Library (internal view/pure)
**Purpose:** Day index calculations for the game clock. Days reset at 22:57 UTC (JACKPOT_RESET_TIME = 82620 seconds), not midnight. Day 1 = deploy day.

| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `currentDayIndex()` | internal view | none | Returns current day index (1-indexed from deploy day), using block.timestamp |
| `currentDayIndexAt(uint48)` | internal pure | ts | Returns day index for a specific timestamp. Formula: `((ts - 82620) / 86400) - DEPLOY_DAY_BOUNDARY + 1` |

**Key constant:** `JACKPOT_RESET_TIME = 82620` (22:57 UTC in seconds from midnight)

### JackpotBucketLib.sol
**Lines:** 307 | **Type:** Library (internal pure)
**Purpose:** Jackpot bucket sizing, scaling, share calculation, and trait packing/unpacking. Core logic for how jackpot prize pools are divided across 4 trait buckets with pool-size-dependent scaling.

| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `traitBucketCounts(uint256)` | internal pure | entropy | Computes base winner counts [25, 15, 8, 1] rotated by entropy (bottom 2 bits) for fairness across trait quadrants |
| `scaleTraitBucketCountsWithCap(uint16[4], uint256, uint256, uint16, uint32)` | internal pure | baseCounts, ethPool, entropy, maxTotal, maxScaleBps | Scales bucket counts by pool size: 1x under 10 ETH, linear to 2x by 50 ETH, linear to maxScaleBps by 200 ETH, then capped. Solo bucket (count=1) never scaled. |
| `bucketCountsForPoolCap(uint256, uint256, uint16, uint32)` | internal pure | ethPool, entropy, maxTotal, maxScaleBps | Convenience: computes base counts then scales with cap. Returns zeroes for empty pool. |
| `sumBucketCounts(uint16[4])` | internal pure | counts | Returns sum of 4 bucket counts |
| `capBucketCounts(uint16[4], uint16, uint256)` | internal pure | counts, maxTotal, entropy | Caps total winners while keeping solo bucket fixed at 1. Pro-rata downscale of non-solo buckets, with entropy-rotated trim for edge cases. |
| `bucketShares(uint256, uint16[4], uint16[4], uint8, uint256)` | internal pure | pool, shareBps, bucketCounts, remainderIdx, unit | Computes ETH/BURNIE shares per bucket. Rounds non-solo to unit*count; remainder bucket absorbs rounding difference. |
| `soloBucketIndex(uint256)` | internal pure | entropy | Returns index of the solo bucket (receives 60% share) based on entropy rotation |
| `rotatedShareBps(uint64, uint8, uint8)` | internal pure | packed, offset, traitIdx | Extracts rotated share BPS for a specific trait index from packed uint64 |
| `shareBpsByBucket(uint64, uint8)` | internal pure | packed, offset | Unpacks share BPS from packed uint64 with rotation offset |
| `packWinningTraits(uint8[4])` | internal pure | traits | Packs 4 trait IDs into a single uint32 |
| `unpackWinningTraits(uint32)` | internal pure | packed | Unpacks uint32 into 4 trait IDs |
| `getRandomTraits(uint256)` | internal pure | rw | Derives 4 random trait IDs from entropy. Each quadrant uses 6 bits (ranges: 0-63, 64-127, 128-191, 192-255). |
| `bucketOrderLargestFirst(uint16[4])` | internal pure | counts | Returns bucket indices sorted by count (largest first, ties keep lower index) |

**Key mechanics:**
- **4 trait buckets per jackpot draw:** Base counts [25, 15, 8, 1] rotated by entropy. Solo bucket (1 winner) receives the largest share (60%).
- **Pool-size scaling:** Winner counts increase with pool size (1x at <10 ETH, up to 2x at 50 ETH, up to maxScaleBps at 200 ETH). Solo bucket excluded from scaling.
- **Scaling thresholds:** JACKPOT_SCALE_MIN_WEI=10 ETH, JACKPOT_SCALE_FIRST_WEI=50 ETH, JACKPOT_SCALE_SECOND_WEI=200 ETH
- **Share rotation:** BPS shares are rotated by entropy offset so no trait quadrant is permanently advantaged.

### PriceLookupLib.sol
**Lines:** 47 | **Type:** Library (internal pure)
**Purpose:** Ticket price lookup table implementing the 100-level repeating price cycle with intro-tier overrides.

| Function | Visibility | Parameters | What It Does |
|----------|-----------|------------|--------------|
| `priceForLevel(uint24)` | internal pure | targetLevel | Returns ticket price in wei for a given level |

**Price tiers:**
| Level Range | Price | Notes |
|------------|-------|-------|
| 0-4 | 0.01 ETH | Intro tier |
| 5-9 | 0.02 ETH | Intro tier |
| x01-x29 (10-29 first cycle) | 0.04 ETH | Base tier |
| x30-x59 | 0.08 ETH | Mid tier |
| x60-x89 | 0.12 ETH | Late tier |
| x90-x99 | 0.16 ETH | Final tier |
| x00 (100, 200, ...) | 0.24 ETH | Milestone |

---

## DegenerusGameStorage.sol
**Lines:** 1,631 | **Type:** Abstract storage contract
**Purpose:** Shared storage layout for DegenerusGame and all delegatecall modules. Defines the canonical EVM slot layout that all modules must inherit for slot alignment. Contains the entire game state machine, pool accounting, player state, and configuration. This is the densest file in the codebase for understanding game state.

### EVM Slot 0: Finite State Machine (32 bytes, fully packed)

| Variable | Type | Bits | What It Controls |
|----------|------|------|------------------|
| `levelStartTime` | uint48 | 0-47 | Timestamp when current level opened. Used for inactivity guard (death clock) and purchase-phase timing. |
| `dailyIdx` | uint48 | 48-95 | Monotonic day counter. Keys RNG words and daily jackpot eligibility. Game-relative, not calendar. |
| `rngRequestTime` | uint48 | 96-143 | When last VRF request was fired. Non-zero = request in-flight. Used for timeout detection. |
| `level` | uint24 | 144-167 | Current jackpot level (starts at 0). Public. Purchase phase targets level+1. |
| `jackpotPhaseFlag` | bool | 168 | Phase: false=PURCHASE, true=JACKPOT. Core state machine toggle. |
| `jackpotCounter` | uint8 | 169-176 | Jackpots processed this level (0-5). Triggers level advancement at 5. |
| `earlyBurnPercent` | uint8 | 177-184 | Previous pool % in early burn reward calculation. |
| `poolConsolidationDone` | bool | 185 | Pool consolidation executed flag. Prevents double-execution per phase. |
| `lastPurchaseDay` | bool | 186 | Prize target met flag. When true, skips normal daily prep and proceeds to jackpot window. |
| `decWindowOpen` | bool | 187 | Decimator window latch. Opens at jackpot phase start for eligible levels. |
| `rngLockedFlag` | bool | 188 | Daily RNG lock. Set when daily VRF requested, cleared when daily processing completes. Blocks burns/opens during jackpot resolution. |
| `phaseTransitionActive` | bool | 189 | Level transition in progress flag. |
| `gameOver` | bool | 190 | Terminal state flag. Public. Once set, game enters GAMEOVER mode. |
| `dailyJackpotCoinTicketsPending` | bool | 191 | Split jackpot gas optimization: ETH phase done, coin+ticket phase pending. |
| `dailyEthBucketCursor` | uint8 | 192-199 | Bucket cursor for daily ETH distribution (0-3). |

### EVM Slot 1: Price, Phase, Double-Buffer (27 bytes used)

| Variable | Type | Bits | What It Controls |
|----------|------|------|------------------|
| `dailyEthPhase` | uint8 | 0-7 | 0=current level distribution, 1=carryover distribution |
| `compressedJackpotFlag` | uint8 | 8-15 | Jackpot compression: 0=normal (5d), 1=compressed (3d), 2=turbo (1d). Set when purchase target met quickly. |
| `purchaseStartDay` | uint48 | 16-63 | Day when purchase phase began. Used to determine compression eligibility. |
| `price` | uint128 | 64-191 | Current mint price in wei. Default 0.01 ether. Updated from PriceLookupLib at level transitions. |
| `ticketWriteSlot` | uint8 | 192-199 | Double-buffer write index (0 or 1). Toggled via XOR for queue swap. |
| `ticketsFullyProcessed` | bool | 200 | Read slot fully drained flag. Gate for RNG requests and jackpot logic. |
| `prizePoolFrozen` | bool | 201 | Prize pool freeze active. Revenue redirects to pending accumulators during jackpot phase. |

### Pool Accounting

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `currentPrizePool` | uint256 | Active prize pool for current level. Distributed via daily jackpots. |
| `prizePoolsPacked` | uint256 | Packed: [128:256] futurePrizePool, [0:128] nextPrizePool. Saves 1 SSTORE on purchases. Accessed only via _getPrizePools()/_setPrizePools(). |
| `prizePoolPendingPacked` | uint256 | Packed pending accumulators during freeze: [128:256] futurePending, [0:128] nextPending. Applied atomically by _unfreezePool(). |
| `claimablePool` | uint256 | Aggregate ETH liability across all claimableWinnings. Invariant: claimablePool >= sum(claimableWinnings[*]). |
| `claimableWinnings` | mapping(address => uint256) | Per-player ETH claimable from jackpot/decimator/lootbox winnings. Pull pattern. |
| `yieldAccumulator` | uint256 | Segregated stETH yield accumulator. Collects 46% of yield surplus each transition. 50% to currentPrizePool at x00 milestones, 50% retained as terminal insurance. |
| `levelPrizePool` | mapping(uint24 => uint256) | Per-level prize pool snapshot for affiliate DGNRS weighting. |
| `dailyEthPoolBudget` | uint256 | Daily jackpot ETH budget stored for deterministic bucket sizing across split calls. |
| `dailyCarryoverEthPool` | uint256 | Carryover ETH reserved after daily phase 0 completes. |

### VRF & RNG State

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `rngWordCurrent` | uint256 | Latest VRF random word (0 = pending). Consumed by game logic. |
| `vrfRequestId` | uint256 | Last VRF request ID. Prevents processing stale/mismatched responses. |
| `rngWordByDay` | mapping(uint48 => uint256) | Historical VRF words by dailyIdx. Immutable once written. Audit trail. |
| `vrfCoordinator` | IVRFCoordinator | Chainlink VRF V2.5 coordinator. Mutable for emergency rotation. |
| `vrfKeyHash` | bytes32 | VRF key hash (gas lane). Rotatable with coordinator. |
| `vrfSubscriptionId` | uint256 | VRF subscription ID for LINK billing. |
| `lastVrfProcessedTimestamp` | uint48 | Timestamp of last successfully processed VRF word. Used by governance for stall detection. |

### Lootbox RNG System

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `lootboxRngIndex` | uint48 | Current lootbox RNG index for new purchases (1-based). |
| `lootboxRngPendingEth` | uint256 | Accumulated ETH toward RNG request threshold. |
| `lootboxRngThreshold` | uint256 | ETH threshold triggering lootbox RNG request (default 1 ETH). |
| `lootboxRngMinLinkBalance` | uint256 | Min LINK balance for manual RNG rolls (default 14 LINK). |
| `lootboxRngWordByIndex` | mapping(uint48 => uint256) | RNG words by lootbox index. |
| `lootboxRngRequestIndexById` | mapping(uint256 => uint48) | VRF requestId to lootbox index mapping. |
| `lootboxRngPendingBurnie` | uint256 | Total pending BURNIE lootbox amount for RNG threshold. |
| `lastLootboxRngWord` | uint256 | Last resolved lootbox RNG word. Used for trait-assignment entropy. |
| `midDayTicketRngPending` | bool | Mid-day ticket processing pending flag. |

### Lootbox Player State

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `lootboxEth` | mapping(uint48 => mapping(address => uint256)) | ETH per RNG index per player. Packed: [232 bits: amount] [24 bits: purchase level]. |
| `lootboxEthBase` | mapping(uint48 => mapping(address => uint256)) | Base (pre-boost) lootbox ETH. Boosts apply at purchase time, not open time. |
| `lootboxBurnie` | mapping(uint48 => mapping(address => uint256)) | BURNIE lootbox amounts per RNG index per player. |
| `lootboxDay` | mapping(uint48 => mapping(address => uint48)) | Purchase day per RNG index and player. |
| `lootboxBaseLevelPacked` | mapping(uint48 => mapping(address => uint24)) | Lootbox base level at purchase time (packed as level+1, 0=none). |
| `lootboxEvScorePacked` | mapping(uint48 => mapping(address => uint16)) | Activity score at purchase time (packed as score+1). |
| `lootboxEvBenefitUsedByLevel` | mapping(address => mapping(uint24 => uint256)) | EV multiplier benefit cap tracking: 10 ETH per account per level. |
| `lootboxIndexQueue` | mapping(address => uint48[]) | Per-player queue of lootbox indices for auto-open processing. |
| `lootboxDistressEth` | mapping(uint48 => mapping(address => uint256)) | ETH portion purchased during distress mode (final 6h). 25% ticket bonus applied. |
| `lootboxPresaleActive` | bool | Presale mode toggle (starts true, one-way off). 62% bonus BURNIE during presale. |
| `lootboxEthTotal` | uint256 | Total lootbox ETH spent across all players. |
| `lootboxPresaleMintEth` | uint256 | Total presale mint ETH toward 200 ETH auto-end cap. |

### Player Mint & Ticket State

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `mintPacked_` | mapping(address => uint256) | Bit-packed mint history per player (see BitPackingLib layout above). |
| `traitBurnTicket` | mapping(uint24 => address[][256]) | Level -> trait ID -> array of ticket holders. Used for jackpot winner selection. More burns = more entries = higher probability. |
| `ticketQueue` | mapping(uint24 => address[]) | Queue of players with tickets per level. Double-buffered via write/read keys. |
| `ticketsOwedPacked` | mapping(uint24 => mapping(address => uint40)) | Packed owed tickets: [32 bits owed][8 bits remainder]. |
| `ticketCursor` | uint32 | Cursor for ticket queue processing. Reused across setup/purchase/jackpot phases (mutually exclusive). |
| `ticketLevel` | uint24 | Current level being processed in ticket queue operations. |

### Boon State (Single-Use Consumables)

| Category | Variables | Mechanic |
|----------|-----------|----------|
| Coinflip boon | `coinflipBoonDay`, `coinflipBoonBps` | 5%/10%/25% bonus on next coinflip. Expires 2 days. |
| Lootbox boost | `lootboxBoon{5,15,25}Active`, `lootboxBoon{5,15,25}Day` | 5%/15%/25% value boost on next lootbox. Expires 2 days. |
| Purchase boost | `purchaseBoostBps`, `purchaseBoostDay` | 5%/15%/25% bonus tickets on next purchase. Expires at jackpot reset. |
| Decimator boost | `decimatorBoostBps` | 10%/25%/50% burn bonus. One-time, no expiry. |
| Whale bundle boon | `whaleBoonDay`, `whaleBoonDiscountBps` | 10%/25%/50% discount on whale bundle. Expires 4 days. |
| Activity boon | `activityBoonPending`, `activityBoonDay` | Bonus activity levels. Applied on lootbox open. Expires 2 days. |
| Deity pass boon | `deityPassBoonTier`, `deityPassBoonDay` | 10%/25%/50% discount on deity pass purchase. 4-day expiry. |
| Lazy pass boon | `lazyPassBoonDay`, `lazyPassBoonDiscountBps` | 10%/25%/50% discount on lazy pass. 4-day expiry. |

### Deity Pass State

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `deityPassCount` | mapping(address => uint16) | Count of deity passes per player (0 or 1). |
| `deityPassPurchasedCount` | mapping(address => uint16) | Purchased deity passes (excludes grants). |
| `deityPassPaidTotal` | mapping(address => uint256) | Total ETH paid per buyer for deity passes. |
| `deityPassOwners` | address[] | List of deity pass owners for iteration. |
| `deityPassSymbol` | mapping(address => uint8) | Symbol assigned to each deity (0-31). |
| `deityBySymbol` | mapping(uint8 => address) | Reverse lookup: symbol ID to owner. |
| `deityPassRefundable` | mapping(address => uint256) | Refundable deity ETH before level 1. |

### Deity Boon Tracking

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `deityBoonDay` | mapping(address => uint48) | Day when deity's boon slots were assigned. |
| `deityBoonUsedMask` | mapping(address => uint8) | Bitmask of used slots for current day. |
| `deityBoonRecipientDay` | mapping(address => uint48) | Prevents double-receipt per day. |
| `deity{Coinflip,Lootbox5/15/25,PurchaseBoost,DecimatorBoost,WhaleBoon,ActivityBoon,DeityPassBoon,LazyPassBoon}Day` | mapping(address => uint48) | Day tracking for each deity-sourced boon type (separate expiry from lootbox-sourced). |

### Auto-Rebuy & afKing

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `autoRebuyState` | mapping(address => AutoRebuyState) | Packed per-player: takeProfit (uint128), afKingActivatedLevel (uint24), autoRebuyEnabled (bool), afKingMode (bool). Auto-rebuy converts winnings to tickets (50/50 next/next+1 level). |
| `decimatorAutoRebuyDisabled` | mapping(address => bool) | Per-player toggle for decimator auto-rebuy (default enabled). |

### Decimator State

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `decBurn` | mapping(uint24 => mapping(address => DecEntry)) | Player decimator entries per level: burn amount (uint192), bucket denominator (2-12), subBucket, claimed flag. |
| `decBucketBurnTotal` | mapping(uint24 => uint256[13][13]) | Aggregated burn totals per level/denom/subbucket. Direct indexing. |
| `lastDecClaimRound` | LastDecClaimRound | Snapshot of last decimator jackpot for claim processing: poolWei, rngWord, totalBurn, lvl. Claims expire when next decimator runs. |
| `decBucketOffsetPacked` | mapping(uint24 => uint64) | Packed winning subbucket per denominator (4 bits each for denom 2-12). |

### Terminal Decimator State

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `terminalDecEntries` | mapping(address => TerminalDecEntry) | Per-player: totalBurn (uint80), weightedBurn (uint88, post-time-multiplier), bucket, subBucket, burnLevel. |
| `terminalDecBucketBurnTotal` | mapping(bytes32 => uint256) | Per-bucket aggregate weighted burn. Key: keccak256(level, denom, subBucket). |
| `lastTerminalDecClaimRound` | TerminalDecClaimRound | Resolution snapshot at GAMEOVER: lvl (uint24), poolWei (uint96), totalBurn (uint128). |

### Degenerette (Roulette) State

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `degeneretteBets` | mapping(address => mapping(uint64 => uint256)) | Packed bets: mode(1), isRandom(1), customTicket(32), ticketCount(8), currency(2), amountPerTicket(128), RNG index(48), activity score(16), hasCustom(1). |
| `degeneretteBetNonce` | mapping(address => uint64) | Per-player bet counter. |
| `dailyHeroWagers` | mapping(uint48 => uint256[4]) | Daily hero symbol wagers in 1e12 units. 4 packed uint256s (8x32-bit per quadrant). |
| `playerDegeneretteEthWagered` | mapping(address => mapping(uint24 => uint256)) | Total ETH wagered per player per level. |
| `topDegeneretteByLevel` | mapping(uint24 => uint256) | Top degenerette player per level. Packed: [96 bits: amount] [160 bits: address]. |

### Game Over State

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `gameOverTime` | uint48 | Timestamp when GAMEOVER triggered (0 = active). Enforces 1-month delay before final sweep. |
| `gameOverFinalJackpotPaid` | bool | Prevents duplicate gameover prize payouts. |
| `finalSwept` | bool | True once 30-day post-gameover sweep executed. All remaining funds forfeited. |

### Miscellaneous State

| Variable | Type | What It Tracks |
|----------|------|----------------|
| `totalFlipReversals` | uint256 | Reverse flips purchased against current RNG word. |
| `dailyTicketBudgetsPacked` | uint256 | Packed daily jackpot ticket data for split execution. |
| `operatorApprovals` | mapping(address => mapping(address => bool)) | Game-wide delegated control (owner => operator => approved). |
| `whalePassClaims` | mapping(address => uint256) | Pending whale pass claims from large lootbox wins (>5 ETH). Half-passes (100 tickets each). |
| `ethPerkLevel`/`ethPerkBurnCount` | uint24/uint16 | ETH perk burn counter per level. |
| `burniePerkLevel`/`burniePerkBurnCount` | uint24/uint16 | BURNIE perk burn counter per level. |
| `dgnrsPerkLevel`/`dgnrsPerkBurnCount` | uint24/uint16 | DGNRS perk burn counter per level. |
| `perkExpectedCount` | uint24 | Expected perk burn count (1% of purchase count). |
| `affiliateDgnrsClaimedBy` | mapping(uint24 => mapping(address => bool)) | Per-level per-affiliate DGNRS claim tracking. |
| `levelDgnrsAllocation` | mapping(uint24 => uint256) | Segregated DGNRS allocation per level (5% of affiliate pool at transition). |
| `levelDgnrsClaimed` | mapping(uint24 => uint256) | Cumulative DGNRS claimed per level from segregated allocation. |
| `earlybirdDgnrsPoolStart` | uint256 | Initial earlybird pool balance snapshot. |
| `earlybirdEthIn` | uint256 | Total ETH counted toward earlybird emission curve. |
| `centuryBonusLevel` | uint24 | x00 level for century bonus tracking. |
| `centuryBonusUsed` | mapping(address => uint256) | Bonus entries awarded per player at current x00 level (10 ETH cap). |
| `dailyEthWinnerCursor` | uint16 | Resume cursor within current daily jackpot bucket. |
| `dailyCarryoverWinnerCap` | uint16 | Remaining winner cap for carryover buckets. |

### Configuration Constants

| Constant | Type | Value | What It Controls |
|----------|------|-------|------------------|
| `PRICE_COIN_UNIT` | uint256 | 1000 ether (1e21) | BURNIE conversion: price / PRICE_COIN_UNIT = BURNIE per mint |
| `TICKET_SCALE` | uint256 | 100 | Fractional ticket precision (1 ticket = 100 scaled units) |
| `LOOTBOX_CLAIM_THRESHOLD` | uint256 | 5 ether | ETH threshold for whale pass claim from lootbox wins |
| `BOOTSTRAP_PRIZE_POOL` | uint256 | 50 ether | Level 0 prize pool fallback target |
| `EARLYBIRD_END_LEVEL` | uint24 | 3 | Level at which earlybird DGNRS rewards end |
| `EARLYBIRD_TARGET_ETH` | uint256 | 1000 ether | Total ETH target for earlybird emission curve |
| `TICKET_SLOT_BIT` | uint24 | 1 << 23 | Bit mask for double-buffer key encoding |
| `DISTRESS_MODE_HOURS` | uint48 | 6 | Hours before gameover at which distress mode activates |
| `_DEPLOY_IDLE_TIMEOUT_DAYS` | uint48 | 365 | Level 0 death clock timeout in days |

### Internal Helper Functions

| Function | Visibility | What It Does |
|----------|-----------|--------------|
| `_isDistressMode()` | internal view | Returns true when gameover liveness guard would fire within 6 hours. Activates distress-mode lootbox behavior (100% nextpool allocation, 25% ticket bonus). |
| `_queueTickets(address, uint24, uint32)` | internal | Queues whole tickets for a buyer at a target level. Adds to queue if new. |
| `_queueTicketsScaled(address, uint24, uint32)` | internal | Queues fractional tickets (2 decimal places). Handles remainder accumulation and promotion to whole tickets. |
| `_queueTicketRange(address, uint24, uint24, uint32)` | internal | Queues tickets for contiguous level range. Optimized for whale pass claims. |
| `_queueLootboxTickets(address, uint24, uint256)` | internal | Queues lootbox tickets with fractional precision, capped at uint32.max. |
| `_setPrizePools(uint128, uint128)` / `_getPrizePools()` | internal | Pack/unpack next+future prize pools from prizePoolsPacked. |
| `_setPendingPools(uint128, uint128)` / `_getPendingPools()` | internal | Pack/unpack pending pool accumulators from prizePoolPendingPacked. |
| `_getNextPrizePool()` / `_setNextPrizePool(uint256)` | internal | Single-component accessors for next prize pool. |
| `_getFuturePrizePool()` / `_setFuturePrizePool(uint256)` | internal | Single-component accessors for future prize pool. |
| `_tqWriteKey(uint24)` / `_tqReadKey(uint24)` | internal view | Compute ticket queue key for write/read slot using TICKET_SLOT_BIT. |
| `_swapTicketSlot(uint24)` | internal | Swap double-buffer. Reverts if read slot not drained. |
| `_swapAndFreeze(uint24)` | internal | Swap queue buffer AND activate prize pool freeze. Zeros pending accumulators if not already frozen. |
| `_unfreezePool()` | internal | Apply pending accumulators to live pools, clear freeze. |
| `_awardEarlybirdDgnrs(address, uint256, uint24)` | internal | Awards earlybird DGNRS via quadratic emission curve. Dumps remainder to lootbox pool at level 3+. |
| `_activate10LevelPass(address, uint24, uint32)` | internal | Activates 10-level lazy pass: updates mintPacked_ and queues tickets for 10-level range. |
| `_applyWhalePassStats(address, uint24)` | internal | Applies whale pass stats (100-level freeze) without queueing tickets separately. |
| `_currentMintDay()` | internal view | Returns current day from dailyIdx or calculates from timestamp. |
| `_setMintDay(uint256, uint32, uint256, uint256)` | internal pure | Updates day field in packed mint data if changed. |
| `_simulatedDayIndex()` / `_simulatedDayIndexAt(uint48)` | internal view/pure | Day index wrappers around GameTimeLib. |

### Key Mechanics (non-function)

- **5 logical pools:** nextPrizePool (packed), futurePrizePool (packed), currentPrizePool, claimablePool, yieldAccumulator (segregated). Only claimablePool represents current obligations.
- **Double-buffer ticket queue:** Write slot and read slot toggled via XOR. Allows concurrent writing of new tickets while processing old ones. TICKET_SLOT_BIT encodes which buffer a level key refers to.
- **Prize pool freeze:** During jackpot phase, prizePoolFrozen=true redirects purchase revenue to pending accumulators. Applied atomically by _unfreezePool() at phase end. Ensures all 5 jackpot payouts use pre-freeze pool values.
- **State machine flags (Slot 0):** The combination of jackpotPhaseFlag, lastPurchaseDay, decWindowOpen, rngLockedFlag, phaseTransitionActive, and gameOver encodes the complete game FSM. Phase transitions are multi-step with gas-bounded execution (split across multiple advanceGame calls).
- **Compressed jackpot mode:** If purchase target met within 1 day: turbo (1 physical day). Within 2 days: compressed (3 physical days). Otherwise: normal (5 days). Rewards high-activity levels with faster progression.
- **Distress mode:** Activates when death clock has <6 hours remaining. Lootboxes route 100% to nextpool (instead of normal split) and grant 25% ticket bonus. Self-correcting mechanism: distress purchases fund the pool that prevents GAMEOVER.
- **DecEntry packed struct:** Per-player decimator entry fits one slot: burn (uint192), bucket (uint8), subBucket (uint8), claimed (uint8). Bucket = activity-score-based denominator (2-12). Lower denominator = better odds but smaller pool share.
- **TerminalDecEntry:** Always-open death bet. Includes time-weighted burn (totalBurn vs weightedBurn), bucket assignment, and level tracking for lazy reset.
