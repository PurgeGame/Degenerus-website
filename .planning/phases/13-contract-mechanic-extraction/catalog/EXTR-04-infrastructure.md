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
