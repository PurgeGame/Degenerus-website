# Contract-Paper Cross-Reference

Built from Phase 13 catalogs (EXTR-01 through EXTR-04) against game theory paper (theory/index.html).

## Methodology
- Unit of analysis: player-facing functions, key mechanics (non-function bullets), and view functions that reveal undocumented mechanics
- System/internal functions mapped via parent public function
- Storage variables mapped via the mechanic they support
- Status codes: DOCUMENTED (section ref), PARTIAL (section ref + gap note), UNDOCUMENTED-RELEVANT, UNDOCUMENTED-IMPL
- Section citation format: S1, S2.3, S5.5-D4, AppA, AppB.3, AppC-Activity, AppD-A3

---

## EXTR-01: Game Modules

### DegenerusGame.sol (Main Dispatcher)

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 1 | claimWinnings (pull-pattern ETH claim) | player-facing | DOCUMENTED | S4.1 | - |
| 2 | claimWinningsStethFirst (stETH-preferential claim) | player-facing | UNDOCUMENTED-IMPL | - | Vault/sDGNRS internal payout preference; no player-strategy impact |
| 3 | claimAffiliateDgnrs (per-level DGNRS claim) | player-facing | PARTIAL | S3.5, AppC-DGNRS | Score-proportional draw from segregated 5% allocation not detailed; deity bonus BURNIE flip credit on claim not mentioned |
| 4 | setAutoRebuy (toggle winnings-to-tickets) | player-facing | DOCUMENTED | S5.5-D3, AppA | - |
| 5 | setDecimatorAutoRebuy (decimator auto-rebuy toggle) | player-facing | UNDOCUMENTED-RELEVANT | - | Separate auto-rebuy path for decimator claims; default-enabled; sDGNRS blocked |
| 6 | setAutoRebuyTakeProfit (reserve amount) | player-facing | PARTIAL | S5.5-D3 | Take-profit mechanic mentioned but parameter details (complete multiples, fractional remainder) not specified |
| 7 | setAfKingMode (AFK-king commitment) | player-facing | PARTIAL | S5.5-D3 | 130%/145% bonus documented; 5-level lock, lazy pass requirement, take-profit minimums (5 ETH/20k BURNIE), coinflip auto-rebuy forcing not specified |
| 8 | setOperatorApproval (delegated gameplay) | player-facing | UNDOCUMENTED-RELEVANT | - | Enables bot/delegated gameplay; relevant to automation strategy |
| 9 | receive() (plain ETH to futurePool) | player-facing | UNDOCUMENTED-IMPL | - | ETH routing to futurePool; no strategic implication |
| 10 | 2-state FSM (PURCHASE/JACKPOT) | key-mechanic | DOCUMENTED | S1, S5.4, AppB | - |
| 11 | Presale toggle (one-way, auto-ends) | key-mechanic | PARTIAL | S4.2 | Paper mentions 20% extraction and 200 ETH cap; auto-end at first level transition not specified; 62% bonus BURNIE and bonusFlip not mentioned |
| 12 | Prize pool split (90/10 next/future for tickets) | key-mechanic | DOCUMENTED | S2.3, S4.1, AppC | - |
| 13 | 1 wei sentinel (gas optimization) | key-mechanic | UNDOCUMENTED-IMPL | - | Pure gas optimization |
| 14 | Operator approvals (mapping) | key-mechanic | UNDOCUMENTED-RELEVANT | - | See row 8 |
| 15 | Activity score (composite formula, 5 components) | key-mechanic | DOCUMENTED | S2.3, S3.1-3.3, AppA, AppC-Activity | - |
| 16 | Auto-rebuy (30%/45% bonus, quarter-price, level offset 1-4) | key-mechanic | PARTIAL | S5.5-D3, AppA | Quarter-price tickets and 25%/75% next/future level targeting not specified |
| 17 | afKing mode (lazy pass required, 5-level lock) | key-mechanic | PARTIAL | S5.5-D3 | See row 7 |
| 18 | Deploy idle timeout (365 days at level 0) | key-mechanic | DOCUMENTED | S5.4, S9.2 | - |
| 19 | Inactivity guard (120 days level 1+) | key-mechanic | DOCUMENTED | S5.4, S9.2, S9.3 | - |

### BoonModule

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 20 | consumeCoinflipBoon (0/500/1000/2500 BPS) | player-facing | PARTIAL | AppC-Boons | Boons described generally; specific BPS tiers per type not listed |
| 21 | consumePurchaseBoost (0/500/1500/2500 BPS) | player-facing | PARTIAL | AppC-Boons | Same: general mention, specific tiers missing |
| 22 | consumeDecimatorBoost (0/1000/2500/5000 BPS) | player-facing | PARTIAL | AppC-Boons | Same: general mention, specific tiers missing |
| 23 | Boon expiry system (2-day/4-day windows, deity same-day) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Expiry windows create time-pressure strategy; not discussed |
| 24 | 10 boon types tracked | key-mechanic | PARTIAL | AppC-Boons | Paper mentions "several types" but does not enumerate all 10 |
| 25 | Dual-source boons (lootbox vs deity grant) | key-mechanic | PARTIAL | AppC-Boons, S3.4 | Deity boon grants mentioned but dual-source priority and expiry difference not specified |
| 26 | Activity boon (backdated participation credit) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Backdating activity score has strategic implications; not mentioned |

### EndgameModule

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 27 | claimWhalePass (deferred whale pass rewards) | player-facing | PARTIAL | S3.4 | Whale pass concept documented; deferred claim from >5 ETH lootbox wins and N tickets/level for 100 levels not specified |
| 28 | BAF jackpot schedule (every 10 levels, 10%/20% pool) | key-mechanic | DOCUMENTED | S2.5, S3.4, AppB.3 | - |
| 29 | Decimator jackpot schedule (x5 levels, not 95) | key-mechanic | DOCUMENTED | S6.2, AppB.4 | - |
| 30 | BAF payout structure (large: 50/50 ETH/lootbox; small: alternating) | key-mechanic | PARTIAL | AppB.3 | Paper describes 50/50 for large winners; alternating ETH/lootbox for small winners not specified |
| 31 | Lootbox ticket targeting (30%/65%/5% level probability) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Probabilistic level selection for jackpot-awarded lootbox tickets not described |
| 32 | Lootbox claim threshold (5 ETH deferred to whale pass) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Threshold mechanics for converting large payouts to whale passes not specified |
| 33 | Auto-rebuy in jackpots (quarter-price, level targeting) | key-mechanic | PARTIAL | S5.5-D3 | See DegenerusGame row 16 |
| 34 | Affiliate DGNRS segregation (1% top + 5% per-level snapshot) | key-mechanic | PARTIAL | S3.5 | Top affiliate bonus mentioned; segregation and snapshot mechanics not detailed |

### GameOverModule

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 35 | GAMEOVER terminal state (irreversible) | key-mechanic | DOCUMENTED | S5.4, S9.2, S9.3 | - |
| 36 | Early GAMEOVER deity refund (levels 0-9, 20 ETH/pass FIFO) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Deity pass refund on early game failure not mentioned; affects deity pass risk calculus |
| 37 | Terminal distribution (10% decimator / 90% jackpot) | key-mechanic | DOCUMENTED | S9.3 | - |
| 38 | VRF fallback (3-day stall, historical words) | key-mechanic | PARTIAL | S7.2 | VRF recovery mentioned; specific 3-day timeout and historical word hashing not detailed |
| 39 | Final sweep (30 days post-GAMEOVER, 50/50 vault/sDGNRS) | key-mechanic | PARTIAL | S9.3 | Paper mentions "unclaimed funds to vault and DGNRS reserves"; 30-day window and 50/50 split not specified |
| 40 | Pool zeroing at GAMEOVER | key-mechanic | UNDOCUMENTED-IMPL | - | Implementation detail of terminal state |

### MintStreakUtils

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 41 | Mint streak tracking (consecutive level completion) | key-mechanic | DOCUMENTED | S5.5-D2, AppC-Activity | - |
| 42 | Streak reset on skipped level | key-mechanic | DOCUMENTED | S5.5-D2 | - |
| 43 | Activity score impact (up to 50% from streak) | key-mechanic | DOCUMENTED | AppC-Activity | - |

### PayoutUtils

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 44 | Half whale pass pricing (2.25 ETH per half-pass) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Whale pass unit pricing not specified anywhere in paper |
| 45 | Auto-rebuy level targeting (entropy-based 1-4 levels) | key-mechanic | PARTIAL | S5.5-D3 | Paper mentions reinvestment; 25% next / 75% future probability split not specified |
| 46 | Quarter-price tickets in auto-rebuy | key-mechanic | UNDOCUMENTED-RELEVANT | - | 4x ticket multiplier on auto-rebuy not mentioned; significant compounding advantage |

### WhaleModule

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 47 | purchaseWhaleBundle (100-level pass) | player-facing | DOCUMENTED | S3.4, S3.6, AppA | - |
| 48 | purchaseLazyPass (10-level pass) | player-facing | PARTIAL | S3.6, S5.5-D3, AppA | Availability windows (levels 0-2, x9, boon), renewal window (7 levels remaining), deity-pass blocking not specified |
| 49 | purchaseDeityPass (32-symbol deity pass) | player-facing | DOCUMENTED | S3.4, AppA, AppC | - |
| 50 | Whale bundle ticket tiers (40/lvl bonus vs 2/lvl standard) | key-mechanic | PARTIAL | S3.4 | Paper mentions 4 perpetual tickets; tier structure (40 vs 2) not specified |
| 51 | Lazy pass renewal window (7 levels remaining) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Renewal timing affects pass strategy |
| 52 | Deity pass price curve (24 + T(n) ETH triangular) | key-mechanic | PARTIAL | AppA | Formula mentioned; T(n) = n(n+1)/2 not specified |
| 53 | Deity pass symbols (32 across 4 quadrants) | key-mechanic | PARTIAL | S3.4, AppC | 32 symbols mentioned; quadrant mapping (Crypto/Zodiac/Cards/Dice) not specified |
| 54 | Lootbox boost on purchase (5/15/25%, capped 10 ETH) | key-mechanic | PARTIAL | AppC-Boons | Boost concept mentioned; specific percentages and 10 ETH cap not specified |
| 55 | Distress mode tracking (lootboxDistressEth) | key-mechanic | PARTIAL | S9.3 | Distress mode mentioned; tracking mechanism and 25% ticket bonus details in S9.3 reference are brief |
| 56 | x99 bundle minimum (2 purchases without boon) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Anti-farming restriction at century boundaries not mentioned |
| 57 | Fund distribution asymmetry (whale/deity: 5/95 vs lazy: 90/10) | key-mechanic | PARTIAL | S3.4, S2.3 | Paper mentions futurepool weighting; exact split ratios per product not specified for whale/deity |

### MintModule

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 58 | purchase (ETH tickets + lootboxes) | player-facing | DOCUMENTED | S1, S2.3, AppA | - |
| 59 | purchaseCoin (BURNIE tickets + lootboxes) | player-facing | DOCUMENTED | S6.1, AppA | - |
| 60 | purchaseBurnieLootbox (low-EV BURNIE lootbox) | player-facing | PARTIAL | S6.1 | BURNIE lootbox existence implied but separate low-EV path not described |
| 61 | Ticket pricing (price * qty / (4 * 100)) | key-mechanic | DOCUMENTED | S1, AppA | - |
| 62 | BURNIE ticket conversion (1000 BURNIE = 1 ticket = 4 entries) | key-mechanic | DOCUMENTED | S6.1 | - |
| 63 | Lootbox pool split (10/90 normal, 40/40/20 presale, 100% distress) | key-mechanic | PARTIAL | S2.3, S4.2, S9.3 | Normal and presale splits documented; distress 100% nextpool documented in S9.3; presale 40/40/20 three-way split not specified |
| 64 | Century bonus at x00 levels (up to 2x tickets, 10 ETH cap) | key-mechanic | PARTIAL | S6.3 | Paper mentions "activity-score-scaled bonus mints" at x00; per-player 10 ETH cap not specified |
| 65 | Lootbox boost boons on purchase (5/15/25%) | key-mechanic | PARTIAL | AppC-Boons | See row 54 |
| 66 | Trait generation (LCG PRNG, weighted distribution) | key-mechanic | PARTIAL | AppC-Traits | Paper mentions VRF-derived trait assignment; LCG multiplier and weighted rarity distribution not specified |
| 67 | Gas-budgeted ticket activation (550 write budget) | key-mechanic | UNDOCUMENTED-IMPL | - | Gas optimization detail |
| 68 | BURNIE flip credit bonuses (10% base + 2.5% bulk + 10% final day) | key-mechanic | UNDOCUMENTED-RELEVANT | - | BURNIE flip bonus structure from ticket purchases not described; affects BURNIE supply dynamics |
| 69 | Affiliate commission (paid as BURNIE flip credit) | key-mechanic | DOCUMENTED | S3.5, S2.6 | - |
| 70 | 30-day BURNIE purchase cutoff before liveness timeout | key-mechanic | DOCUMENTED | S9.3 | - |

### LootboxModule

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 71 | openLootBox (ETH lootbox with EV scaling) | player-facing | DOCUMENTED | S2.3, AppA, AppC | - |
| 72 | openBurnieLootBox (BURNIE lootbox, low-EV) | player-facing | PARTIAL | S6.1 | Existence mentioned; fixed reward schedule not described |
| 73 | issueDeityBoon (3 daily slots to any player) | player-facing | PARTIAL | S3.4, AppC-Boons | Deity boon grants mentioned; 3-slot system, weighted random selection from 31 types, same-day expiry not specified |
| 74 | EV scaling (80-135%, breakeven at 0.60) | key-mechanic | DOCUMENTED | S2.3, AppA, AppC-Activity | - |
| 75 | Reward path probabilities (55/10/10/25 tickets/DGNRS/WWXRP/BURNIE) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Lootbox reward type distribution not specified in paper; affects expected reward composition |
| 76 | Ticket variance tiers (5-tier: 1%/4%/20%/45%/30% with 4.6x to 0.45x) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Variance structure of lootbox ticket rewards not described |
| 77 | BURNIE reward paths (low/high, presale 62% bonus) | key-mechanic | UNDOCUMENTED-RELEVANT | - | BURNIE payout formula from lootboxes not specified |
| 78 | Lootbox split >0.5 ETH (two independent rolls) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Variance amplification via split not mentioned |
| 79 | Distress ticket bonus (25% extra) | key-mechanic | PARTIAL | S9.3 | Distress mode described; 25% figure mentioned briefly |
| 80 | Boon EV budget (10% of lootbox, capped 1 ETH) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Boon generation budget and 50% utilization scaling not specified |
| 81 | Deity boon system (3 slots/day, 31 types, weight 1298) | key-mechanic | PARTIAL | S3.4, AppC-Boons | General description present; 31 types, weights, categories not enumerated |
| 82 | DGNRS reward tiers (small/medium/large/mega) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Lootbox DGNRS reward tier probabilities not specified |
| 83 | Whale pass jackpot (>4.5 ETH lootbox chance) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Chance to win whale pass from large lootboxes not mentioned |
| 84 | Per-level 10 ETH EV benefit cap | key-mechanic | DOCUMENTED | S2.4, AppA | - |

### DegeneretteModule

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 85 | placeFullTicketBets (4-trait symbol betting) | player-facing | DOCUMENTED | S2.3, AppC | - |
| 86 | resolveBets (match counting, payout) | player-facing | DOCUMENTED | S2.3, AppC | - |
| 87 | Payout multiplier table (1.90x to 100,000x) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Specific multiplier table not in paper; affects Degenerette EV analysis |
| 88 | ROI from activity score (90% to 99.9%) | key-mechanic | PARTIAL | AppC-Degenerette | ROI formula referenced; specific range 90%-99.9% not stated |
| 89 | EV normalization (product-of-ratios per quadrant) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Mathematical normalization ensuring equal EV across symbols not described |
| 90 | Hero quadrant override (most-wagered symbol wins) | key-mechanic | DOCUMENTED | S3.4, AppC | - |
| 91 | 3 currency modes (ETH/BURNIE/WWXRP) | key-mechanic | PARTIAL | S2.3 | ETH and BURNIE modes mentioned; WWXRP as Degenerette currency not mentioned |
| 92 | ETH payout split (25% direct / 75% lootbox) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Payout composition for ETH Degenerette wins not specified |
| 93 | Consolation prize (1 WWXRP for 0 matches) | key-mechanic | UNDOCUMENTED-RELEVANT | - | WWXRP consolation not mentioned in paper |
| 94 | DGNRS rewards for 6+ matches | key-mechanic | UNDOCUMENTED-RELEVANT | - | DGNRS bonus for high-match Degenerette bets not mentioned |

### AdvanceModule

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 95 | advanceGame (permissionless daily advance) | player-facing | DOCUMENTED | S4.3, AppC | - |
| 96 | requestLootboxRng (mid-day VRF request) | player-facing | UNDOCUMENTED-IMPL | - | Lootbox RNG request timing is implementation detail |
| 97 | reverseFlip (BURNIE-cost nudge of coinflip) | player-facing | DOCUMENTED | S2.5 | - |
| 98 | FSM stages (12 stages, one per advanceGame call) | key-mechanic | UNDOCUMENTED-IMPL | - | Internal state machine staging |
| 99 | VRF lifecycle (10 confirmations, 12h timeout, 3-day stall) | key-mechanic | PARTIAL | S7.1, S7.2 | VRF and coordination-free design described; specific confirmation count and timeout parameters not given |
| 100 | Pool consolidation at level transition | key-mechanic | DOCUMENTED | S4.1, AppC-Pools | - |
| 101 | Compressed/turbo jackpots (fast level completion) | key-mechanic | PARTIAL | AppB.1 | Compressed and turbo mentioned; trigger conditions (2-day/1-day) not specified |
| 102 | Liveness guard (365d/120d) | key-mechanic | DOCUMENTED | S5.4, S9.2 | - |
| 103 | Decimator window timing (x4, x99, not x94) | key-mechanic | PARTIAL | AppB.4 | Schedule partially described; specific window rules not fully detailed |
| 104 | Presale auto-end (first level transition or 200 ETH) | key-mechanic | PARTIAL | S4.2 | 200 ETH cap documented; auto-end at first level transition not specified |
| 105 | Bounty escalation (2x/3x for late advanceGame) | key-mechanic | PARTIAL | S4.3 | Bounty mentioned (~0.01 ETH); 2x/3x escalation schedule not specified |
| 106 | Pool freeze during VRF | key-mechanic | PARTIAL | AppC-Pools | Pool lock at RNG mentioned; pending pool routing not detailed |
| 107 | Ticket buffer double-buffering (read/write swap) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Ensures fairness of trait generation; not described |
| 108 | Daily mint gate bypass tiers (deity/30min/15min/DGVE) | key-mechanic | PARTIAL | S4.3 | Permissionless execution documented; bypass tier details not specified |
| 109 | Time-based future pool skim (13-30%+, U-shaped) | key-mechanic | PARTIAL | AppC-Pools | Referenced but formula details and adaptive adjustments not given |
| 110 | 15% futurePool drawdown at level transition | key-mechanic | DOCUMENTED | S8.1, S9.1, AppC-Pools | - |

### DecimatorModule

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 111 | claimDecimatorJackpot (regular decimator claim) | player-facing | DOCUMENTED | S6.2, AppB.4 | - |
| 112 | claimTerminalDecimatorJackpot (death bet claim) | player-facing | DOCUMENTED | S9.3 | - |
| 113 | Bucket system (denominators 2-12) | key-mechanic | DOCUMENTED | S6.2, AppB.4 | - |
| 114 | Activity-score multiplier (1.0x to 1.767x, cap 235) | key-mechanic | DOCUMENTED | S6.2, AppB.4 | - |
| 115 | Bucket migration (lower denominator on subsequent burn) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Strategic ability to improve bucket on later burns not mentioned |
| 116 | Claim expiration (overwritten by next decimator round) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Time pressure on claims not mentioned; creates urgency |
| 117 | 50/50 ETH/lootbox split on claims | key-mechanic | UNDOCUMENTED-RELEVANT | - | Decimator payout composition not specified |
| 118 | Terminal decimator time multiplier (30x to 1x formula) | key-mechanic | PARTIAL | S9.3 | Paper says "30x at 120 days, declining to 1x"; specific formula with discontinuity at day 10 not given |
| 119 | Terminal bucket assignment (level 100 rules, min bucket 2) | key-mechanic | PARTIAL | S9.3, AppB.4 | Paper describes terminal decimator; level 100 rules and min bucket 2 not specified |
| 120 | Pro-rata distribution (playerBurn/totalBurn) | key-mechanic | PARTIAL | S6.2 | Implied but pro-rata formula not explicit |
| 121 | Burns blocked at <=1 day remaining | key-mechanic | UNDOCUMENTED-RELEVANT | - | 24h burn cooldown before GAMEOVER creates strategic timing pressure |

### JackpotModule

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 122 | runTerminalJackpot (GAMEOVER distribution) | player-facing | DOCUMENTED | S9.3 | - |
| 123 | 5-day jackpot phase (days 1-4: 6-14%, day 5: 100%) | key-mechanic | DOCUMENTED | AppB.1 | - |
| 124 | Trait-based bucket distribution (4 winning traits) | key-mechanic | DOCUMENTED | AppB.1, AppC | - |
| 125 | Daily bucket split (20/20/20/20) and final (60/13/13/13) | key-mechanic | DOCUMENTED | AppB.1 | - |
| 126 | Solo bucket winner (75% ETH / 25% whale passes + DGNRS) | key-mechanic | PARTIAL | AppB.1 | Solo bucket concept documented; 75/25 ETH/whale-pass split not specified |
| 127 | Hero override in winning traits (jackpot phase only) | key-mechanic | DOCUMENTED | S3.4, AppC | - |
| 128 | Virtual deity entries (2% of bucket, minimum 2) | key-mechanic | DOCUMENTED | S3.4 | - |
| 129 | Carryover system (1% futurePool to near-future levels) | key-mechanic | PARTIAL | AppB.2 | Early-bird/carryover referenced; 1% budget and level selection mechanics not detailed |
| 130 | Pool lock at RNG | key-mechanic | PARTIAL | AppC-Pools | See row 106 |
| 131 | x00 consolidation (5-dice, 30-65% keep range) | key-mechanic | PARTIAL | S6.3 | Paper mentions "5-dice futurepool consolidation"; keep range 30-65% per die not specified |
| 132 | Yield distribution at consolidation (23/23/46/8 split) | key-mechanic | PARTIAL | S4.1 | Paper says 50/25/25; contract implementation is 46/23/23/8 (per CLAUDE.md: "8% buffer is implementation detail") |
| 133 | Early-bird lootbox (3% futurePool on day 1) | key-mechanic | DOCUMENTED | AppB.2 | - |
| 134 | BURNIE jackpot daily (0.5% target, 75/25 near/far split) | key-mechanic | PARTIAL | AppB.2 | BURNIE jackpot documented; 0.5% amount and 75/25 near/far split not specified |
| 135 | Gas-safe chunked distribution (cursor system) | key-mechanic | UNDOCUMENTED-IMPL | - | Gas optimization detail |
| 136 | Auto-rebuy on jackpot winnings | key-mechanic | DOCUMENTED | S5.5-D3 | - |

**EXTR-01 subtotal: 136 mechanics (45 documented, 53 partial, 30 undocumented-relevant, 8 undocumented-impl)**

---

## EXTR-02: Token Contracts

### BurnieCoin.sol

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 137 | transfer (ERC20 with coinflip auto-claim) | player-facing | UNDOCUMENTED-IMPL | - | Standard ERC20; auto-claim is convenience feature |
| 138 | transferFrom (game contract bypass) | player-facing | UNDOCUMENTED-IMPL | - | Standard ERC20 with trusted-caller optimization |
| 139 | approve (ERC20) | player-facing | UNDOCUMENTED-IMPL | - | Standard ERC20 |
| 140 | decimatorBurn (burns BURNIE for decimator) | player-facing | DOCUMENTED | S6.2, AppB.4 | - |
| 141 | terminalDecimatorBurn (death bet burn) | player-facing | DOCUMENTED | S9.3 | - |
| 142 | Vault escrow system (2M virtual reserve) | key-mechanic | PARTIAL | S4.2, AppC-DGNRS | Paper mentions creator BURNIE allocation; vault escrow mechanics not described |
| 143 | Supply accounting (totalSupply + vaultAllowance) | key-mechanic | UNDOCUMENTED-IMPL | - | Internal accounting |
| 144 | Game contract transfer bypass | key-mechanic | UNDOCUMENTED-IMPL | - | Implementation optimization |
| 145 | Decimator constants (min 1000, base bucket 12, caps) | key-mechanic | DOCUMENTED | S6.2, AppB.4, AppA | - |
| 146 | Quest hub pattern (routing to DegenerusQuests) | key-mechanic | UNDOCUMENTED-IMPL | - | Internal architecture |

### BurnieCoinflip.sol

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 147 | depositCoinflip (daily coinflip wager) | player-facing | DOCUMENTED | S2.3, S2.5 | - |
| 148 | claimCoinflips (claim winnings) | player-facing | DOCUMENTED | S2.5 | - |
| 149 | claimCoinflipsTakeProfit (multiples of take-profit) | player-facing | UNDOCUMENTED-RELEVANT | - | Take-profit claim mode for coinflip not described |
| 150 | setCoinflipAutoRebuy (enable carry-forward) | player-facing | PARTIAL | S5.5-D3 | Auto-rebuy mentioned broadly; coinflip-specific auto-rebuy configuration not detailed |
| 151 | setCoinflipAutoRebuyTakeProfit (update stop amount) | player-facing | UNDOCUMENTED-RELEVANT | - | Coinflip take-profit parameter not described |
| 152 | Daily coinflip cycle (50/50 from RNG bit) | key-mechanic | DOCUMENTED | S2.5 | - |
| 153 | Reward percent distribution (5%/5%/90% tiers: 1.5x/2.5x/0.78-1.15x) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Paper says ~1.97x mean; tier structure (50%/150%/78-115%) not described |
| 154 | Auto-rebuy system (winnings carry forward) | key-mechanic | PARTIAL | S5.5-D3 | Concept documented; coinflip-specific carry and recycling bonus on carry not detailed |
| 155 | Bounty system (1000/day, biggest-flip arming, half-pool payout) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Coinflip bounty pool mechanics entirely undocumented |
| 156 | Claim windows (30/90/1095 days) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Claim expiration windows not mentioned |
| 157 | WWXRP consolation (1 WWXRP per losing day) | key-mechanic | UNDOCUMENTED-RELEVANT | - | WWXRP consolation prize on coinflip loss not mentioned |
| 158 | Recycling bonus (1% standard, 1.6% afKing base + deity scaling) | key-mechanic | UNDOCUMENTED-RELEVANT | - | BURNIE recycling bonus on coinflip deposits not described |
| 159 | BAF leaderboard integration (winning flips recorded) | key-mechanic | PARTIAL | S3.4, AppB.3 | BAF documented; coinflip contribution to BAF leaderboard scoring not specified |
| 160 | Coinflip boon boost (5/10/25% on max 100k) | key-mechanic | PARTIAL | AppC-Boons | Boons general; coinflip-specific boost parameters not detailed |

### DegenerusStonk.sol

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 161 | transfer (ERC20) | player-facing | UNDOCUMENTED-IMPL | - | Standard ERC20 |
| 162 | approve (ERC20) | player-facing | UNDOCUMENTED-IMPL | - | Standard ERC20 |
| 163 | burn (DGNRS to claim ETH/stETH/BURNIE backing) | player-facing | PARTIAL | AppC-DGNRS | Paper mentions DGNRS is transferable for creator's 20%; burn-through mechanics (proportional claim from sDGNRS backing) not described |
| 164 | unwrapTo (creator-only, sends underlying sDGNRS) | player-facing | UNDOCUMENTED-RELEVANT | - | Creator can convert DGNRS to soulbound sDGNRS; governance implications |
| 165 | VRF stall guard on unwrap (>5h block) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Prevents vote-stacking during VRF stalls; governance safeguard |
| 166 | Burn-through to sDGNRS backing | key-mechanic | PARTIAL | AppC-DGNRS | See row 163 |
| 167 | No supply cap (constructor-set) | key-mechanic | UNDOCUMENTED-IMPL | - | Implementation detail |

### StakedDegenerusStonk.sol

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 168 | burn (sDGNRS to claim proportional ETH/stETH/BURNIE) | player-facing | PARTIAL | AppC-DGNRS | sDGNRS burn mentioned; proportional claim mechanics (ETH-preferential, includes game winnings and coinflip) not detailed |
| 169 | gameAdvance (call advanceGame on behalf of sDGNRS) | player-facing | UNDOCUMENTED-IMPL | - | Convenience wrapper |
| 170 | gameClaimWhalePass (claim whale pass for sDGNRS) | player-facing | UNDOCUMENTED-IMPL | - | Convenience wrapper |
| 171 | Soulbound (no transfer functions) | key-mechanic | DOCUMENTED | AppC-DGNRS | - |
| 172 | Pool system (5 pools: Whale 10%, Affiliate 35%, Lootbox 20%, Reward 5%, Earlybird 10%) | key-mechanic | PARTIAL | AppC-DGNRS | Paper mentions 5 pools; exact percentages partially covered |
| 173 | Backing assets (ETH + stETH + BURNIE) | key-mechanic | PARTIAL | AppC-DGNRS | Backing concept mentioned; three-asset composition not specified |
| 174 | ETH-preferential payout on burn | key-mechanic | UNDOCUMENTED-IMPL | - | Payout ordering is implementation detail |
| 175 | sDGNRS as coinflip participant (excluded from BAF) | key-mechanic | PARTIAL | AppC-DGNRS | Paper mentions sDGNRS runs in afKing mode; BAF exclusion not mentioned |
| 176 | 50.1% governance threshold | key-mechanic | UNDOCUMENTED-RELEVANT | - | sDGNRS governance voting power threshold not described |

### WrappedWrappedXRP.sol

| # | Mechanic | Type | Status | Paper Section(s) | Gap Note |
|---|----------|------|--------|-------------------|----------|
| 177 | transfer (ERC20) | player-facing | UNDOCUMENTED-IMPL | - | Standard ERC20 |
| 178 | approve (ERC20) | player-facing | UNDOCUMENTED-IMPL | - | Standard ERC20 |
| 179 | unwrap (burn WWXRP for wXRP 1:1 if reserves allow) | player-facing | UNDOCUMENTED-RELEVANT | - | First-come-first-served redemption; affects WWXRP value proposition |
| 180 | donate (add wXRP backing without minting) | player-facing | UNDOCUMENTED-RELEVANT | - | Donation mechanic improves backing ratio |
| 181 | Intentionally undercollateralized | key-mechanic | UNDOCUMENTED-RELEVANT | - | Core WWXRP design (minted freely as prizes without backing) entirely undocumented in paper |
| 182 | Vault reserve (1B uncirculating) | key-mechanic | UNDOCUMENTED-RELEVANT | - | Vault WWXRP reserve not mentioned |
| 183 | Three minters (GAME, COIN, COINFLIP) | key-mechanic | UNDOCUMENTED-IMPL | - | Integration architecture |
| 184 | wXRP reserves tracking (separate from supply) | key-mechanic | UNDOCUMENTED-IMPL | - | Implementation detail |

**EXTR-02 subtotal: 48 mechanics (7 documented, 11 partial, 14 undocumented-relevant, 16 undocumented-impl)**
