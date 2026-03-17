# Game Theory Paper Audit Report

**Generated:** 2026-03-16
**Paper:** theory/index.html (6,018 lines, 11 main sections + 6 appendices)
**Audit scope:** Complete numerical and mechanism claim verification
**Phases:** 5 (Preparation, Number-Heavy Audit, Mechanism-Heavy Audit, Prose Audit, Consistency + Report)

## Severity Categories
- **WRONG**: Factually incorrect number or mechanism
- **STALE**: Was correct but no longer matches current contracts
- **IMPRECISE**: Approximately correct but misleading precision
- **MISSING-CONTEXT**: True but omits important qualifiers
- **CASCADE**: Derived from a single root error (all trace to one wrong input)

---

## SS1 Introduction

### Claims Audited: 19 (12 numerical, 7 mechanism)

SS1 spans lines 535-2183 but ~1,400 lines are CSS/SVG/JS for the interactive jackpot demo. The substantive text is lines 535-571 plus the "How the Game Works" box (lines 700-767).

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 1 | line ~544 | "40-60% in state lotteries, 2-15% in casinos" | External industry reference | VERIFIED (EXTERNAL) | Standard industry ranges, no contract verification needed |
| 2 | line ~549 | "approximately 2.5% annual yield" (stETH) | v1.1-steth-yield.md | VERIFIED | Lido average ~2.5% APR confirmed |
| 3 | line ~566 | "120 days" death clock (level 1+) | v1.1-endgame-and-activity.md Section 5a | VERIFIED | Hardcoded in AdvanceModule:394; 120 days for level > 0 |
| 4 | line ~567 | Terminal mechanism: buying tickets simultaneously funds pool target | v1.1-endgame-and-activity.md Section 7 | VERIFIED | 90% of ticket ETH goes to nextpool, funding the target that prevents GAMEOVER |
| 5 | line ~570 | "cannot be rugged" | v1.1-endgame-and-activity.md Sections 7-8 | VERIFIED | No admin withdrawal function; all funds distribute through coded mechanisms |
| 6 | line ~731 | Level 0-4 ticket price: 0.01 ETH | v1.1-level-progression.md Section 2b | VERIFIED | PriceLookupLib: `if (targetLevel < 5) return 0.01 ether` |
| 7 | line ~737 | Level 5-9 ticket price: 0.02 ETH | v1.1-level-progression.md Section 2b | VERIFIED | PriceLookupLib confirmed |
| 8 | line ~743 | x01-x29 ticket price: 0.04 ETH | v1.1-level-progression.md Section 2b | VERIFIED | PriceLookupLib confirmed |
| 9 | line ~747 | x30-x59 ticket price: 0.08 ETH | v1.1-level-progression.md Section 2b | VERIFIED | PriceLookupLib confirmed |
| 10 | line ~751 | x60-x89 ticket price: 0.12 ETH | v1.1-level-progression.md Section 2b | VERIFIED | PriceLookupLib confirmed |
| 11 | line ~755 | x90-x99 ticket price: 0.16 ETH | v1.1-level-progression.md Section 2b | VERIFIED | PriceLookupLib confirmed |
| 12 | line ~761 | x00 (century) ticket price: 0.24 ETH | v1.1-level-progression.md Section 2b | VERIFIED | PriceLookupLib confirmed |
| 13 | line ~763 | BURNIE price constant at 1,000 per ticket | v1.1-parameter-reference.md | VERIFIED | 1,000 BURNIE always buys one ticket across all levels |
| 14 | line ~700 | Progressive jackpot on-chain lottery description | v1.1-ECONOMICS-PRIMER.md Section 3 | VERIFIED | Mechanism matches: pool target, level advancement, daily draws |
| 15 | line ~701-702 | Tickets enter jackpot draws, lootboxes contain tickets/BURNIE/boons | v1.1-ECONOMICS-PRIMER.md Section 4 | VERIFIED | Lootbox contents and ticket function match |
| 16 | line ~706 | Level advances when target met, pool distributed as prizes over daily draws | v1.1-jackpot-phase-draws.md | VERIFIED | 5-day jackpot phase confirmed |
| 17 | line ~709-710 | Activity score built from quest streak, purchase consistency, affiliate, pass bonuses | v1.1-endgame-and-activity.md Section 2 | VERIFIED | All four score components confirmed |
| 18 | line ~713-718 | BURNIE earned through gameplay, permanently burned for various uses | v1.1-burnie-coinflip.md Pitfall 1 | VERIFIED | Burns are permanent |
| 19 | line ~766 | BURNIE earned early appreciates in purchasing power as levels progress | v1.1-ECONOMICS-PRIMER.md Section 6 | VERIFIED | ETH ticket prices escalate while BURNIE price stays constant at 1,000 |

### Findings

No discrepancies found in SS1. All numerical claims match contract parameters.

---

## SS2 Cross-Subsidy

### Claims Audited: 23 (13 numerical, 10 mechanism)

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 20 | line ~2194-2197 | Player utility = monetary + non-monetary | Definitional | VERIFIED | Framework definition |
| 21 | line ~2198-2245 | Player type table (6 types) | Definitional | VERIFIED | Taxonomy is analytical framework |
| 22 | line ~2256 | BURNIE has a structural price ratchet | v1.1-ECONOMICS-PRIMER.md Section 6 | VERIFIED | Purchasing power increases monotonically within each 100-level cycle |
| 23 | line ~2270 | RNG nudge gives players agency over outcomes | v1.1-burnie-coinflip.md | VERIFIED | Nudge reverses next coinflip outcome |
| 24 | line ~2300-2301 | Degenerette (ETH) adds ETH to futurepools | v1.1-ECONOMICS-PRIMER.md Section 4 | VERIFIED | Confirmed |
| 25 | line ~2307 | Degenerette (BURNIE) creates deflationary pressure | v1.1-burnie-coinflip.md Pitfall 1 | VERIFIED | Burns are permanent |
| 26 | line ~2311-2313 | Lootbox below breakeven: lost margin funds above-breakeven extraction | v1.1-endgame-and-activity.md Section 4a | VERIFIED | EV ranges 0.80x to 1.35x |
| 27 | line ~2321-2325 | Ticket purchase fills pool target; no optimal grinder strategy includes tickets | v1.1-ECONOMICS-PRIMER.md Section 3 | VERIFIED | Lootboxes dominate for EV maximizers |
| 28 | line ~2337-2339 | Deity pass: 24+ ETH into the pool | v1.1-deity-system.md Section 2b | VERIFIED | First pass costs 24 ETH, subsequent cost more |
| 29 | line ~2345 | Deity boons: capped at 3/day | v1.1-deity-system.md Section 6a | VERIFIED | DEITY_DAILY_BOON_COUNT = 3 |
| 30 | line ~2378 | Activity score range 0 to 3.05 | v1.1-endgame-and-activity.md Section 2d | VERIFIED | Max = 50%+25%+100%+50%+80% = 3.05 |
| 31 | line ~2380 | Lootbox EV: 0.80x at zero activity to 1.35x at maximum | v1.1-endgame-and-activity.md Section 4a | VERIFIED | LOOTBOX_EV_MIN_BPS=8000, MAX=13500 |
| 32 | line ~2406-2414 | Tickets split 90% next / 10% future; lootboxes split 10% next / 90% future | v1.1-parameter-reference.md | VERIFIED | PURCHASE_TO_FUTURE_BPS=1000, LOOTBOX_SPLIT_FUTURE_BPS=9000 |
| 33 | line ~2434-2438 | Variance makes annualized return modeling impossible | Argumentative | VERIFIED | Sound analysis |
| 34 | line ~2449-2451 | Tickets cannot be refunded; capital is illiquid | v1.1-endgame-and-activity.md Section 7 | VERIFIED | No withdrawal function |
| 35 | line ~2457 | Pooled ETH earns stETH yield | v1.1-steth-yield.md | VERIFIED | Confirmed |
| 36 | line ~2509 | Shared multiplier roll (50-150%) scales every payout for the day | v1.1-burnie-coinflip.md Section 3 | MISSING-CONTEXT | Range 50-150% maps to bonus percentages (1.50x-2.50x total). Technically correct as bonus endpoints but could confuse. |
| 37 | line ~2516-2520 | BAF fires every 10 levels, 10% of futurepool (20% at milestones) | v1.1-transition-jackpots.md Section 2 | VERIFIED | Confirmed |
| 38 | line ~2521-2523 | Nudge cost starts at 100 BURNIE and scales by 1.5x per queued nudge | v1.1-burnie-coinflip.md Section 2a | VERIFIED | Confirmed |
| 39 | line ~2535-2536 | BAF leaderboard splits: 10% to #1, 5% to top-day, 5% to random #3/#4 | v1.1-transition-jackpots.md Section 3 | VERIFIED | Slices A=10%, A2=5%, B=5% |
| 40 | line ~2553-2556 | BAF scatter: remaining 80% of prizes to non-whale mechanisms | v1.1-transition-jackpots.md Section 3 | VERIFIED | 70% scatter + 10% far-future = 80% |
| 41 | line ~2555-2556 | Poker rooms offer 50-70% rakeback | External industry reference | VERIFIED (EXTERNAL) | Standard range |
| 42 | line ~2573 | Affiliate program pays 20-25% commission | v1.1-affiliate-system.md Section 2 | VERIFIED | 25% levels 0-3, 20% levels 4+ |

### Findings

| Location | Claimed | Correct | Source | Severity | Fix |
|----------|---------|---------|--------|----------|-----|
| SS2.5 line ~2509 | Shared multiplier 50-150% | Bonus range maps to 1.50x-2.50x total payout; could be read as total multiplier rather than bonus | v1.1-burnie-coinflip.md Section 3 | MISSING-CONTEXT | Clarify that 50-150% refers to the bonus above base, giving 1.50x-2.50x total |

---

## SS3 Player Types

### Claims Audited: 42 (28 numerical, 14 mechanism)

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 43 | line ~2592 | Lootbox, zero activity: ~0.80 | v1.1-endgame-and-activity.md Section 4a | VERIFIED | LOOTBOX_EV_MIN_BPS=8000 |
| 44 | line ~2596 | BURNIE ticket: 1.00 | By construction | VERIFIED | Face-value conversion by definition |
| 45 | line ~2600 | Lootbox, breakeven activity: ~1.00 | v1.1-endgame-and-activity.md Section 4a | VERIFIED | a=0.60 yields 1.00x |
| 46 | line ~2604 | New ETH ticket: 1.10 | See note | MISSING-CONTEXT | Composite: ticket base + FLIP rebate. Illustrative. |
| 47 | line ~2608 | Recycled winnings, partial reinvestment: 1.20 | See note | MISSING-CONTEXT | Composite value. Illustrative. |
| 48 | line ~2612 | Standard auto-rebuy: 1.30 | v1.1-transition-jackpots.md Section 11 | VERIFIED | AUTO_REBUY_BONUS_BPS=13000 |
| 49 | line ~2616 | Recycled winnings, full reinvestment: 1.30 | See note | MISSING-CONTEXT | Composite. Matches auto-rebuy at 1.30x. |
| 50 | line ~2620 | Lootbox, maximum activity score: ~1.35 | v1.1-endgame-and-activity.md Section 4a | VERIFIED | LOOTBOX_EV_MAX_BPS=13500 at a>=2.55 |
| 51 | line ~2624 | afKing auto-rebuy: 1.45 | v1.1-transition-jackpots.md Section 11 | VERIFIED | AFKING_AUTO_REBUY_BONUS_BPS=14500 |
| 52 | line ~2628 | Lootbox, max activity + full reinvestment: ~1.45 | See note | MISSING-CONTEXT | Composite: 1.35x + reinvestment bonus |
| 53 | line ~2632-2633 | FLIP rebates: 100/200/300 BURNIE by type | Parameter reference | MISSING-CONTEXT | Specific FLIP amounts presented as footnote context |
| 54 | line ~2638-2641 | Within-level timing advantage: earlier tickets accumulate more draws | v1.1-jackpot-phase-draws.md | VERIFIED | More draws at same price = strictly better |
| 55 | line ~2648 | Degenerette ROI at 0 activity score: 0.90x | v1.1-endgame-and-activity.md Section 4b | VERIFIED | ROI_MIN_BPS=9000 |
| 56 | line ~2648-2649 | Expected loss on 0.1 ETH Degenerette: 0.01 ETH | Arithmetic | VERIFIED | 0.1*(1-0.90)=0.01 |
| 57 | line ~2669-2672 | Day-5 ticket: 100% of remaining prize pool, lowest-EV decision | v1.1-jackpot-phase-draws.md | VERIFIED | Day 5 distributes 100% remaining |
| 58 | line ~2662-2668 | Ticket EV same for all players; grinders prefer lootboxes | v1.1-endgame-and-activity.md Section 4a | VERIFIED | Lootbox EV improves with activity score |
| 59 | line ~2685-2686 | Lootbox EV benefit caps at a=2.55 | v1.1-endgame-and-activity.md Section 4a | VERIFIED | ACTIVITY_SCORE_MAX_BPS(lootbox)=25500 |
| 60 | line ~2690-2691 | Grinder class is self-limiting | Argumentative | VERIFIED | Sound by construction |
| 61 | line ~2678-2682 | Observation 3.1: Best-response is maximize activity score | v1.1-endgame-and-activity.md Section 4 | VERIFIED | Monotonicity confirmed |
| 62 | line ~2716-2718 | Large portion of hybrids cluster near breakeven | Definitional | VERIFIED | Definitional claim |
| 63 | line ~2728 | Deity pass: permanent +80% activity score | v1.1-deity-system.md Section 7a | VERIFIED | DEITY_PASS_ACTIVITY_BONUS_BPS=8000 |
| 64 | line ~2728-2729 | Deity pass: perpetual jackpot entries, up to 3 boons daily | v1.1-deity-system.md Sections 6, 8 | VERIFIED | Confirmed |
| 65 | line ~2733 | BAF fires every 10 levels, 10%/20% of futurepool | v1.1-transition-jackpots.md Section 2 | VERIFIED | Cross-checks SS2.5 |
| 66 | line ~2736 | BAF leaderboard: 10/5/5% splits | v1.1-transition-jackpots.md Section 3 | VERIFIED | Slices A/A2/B confirmed |
| 67 | line ~2743-2744 | Large winners receive half ETH / half whale passes | v1.1-transition-jackpots.md Section 3 | VERIFIED | ethPortion = amount / 2 |
| 68 | line ~2750-2751 | Deity: virtual jackpot entries ~2% of bucket size (min 2) | v1.1-deity-system.md Section 8a | VERIFIED | floor(len/50), min 2 |
| 69 | line ~2753 | +80% activity score: non-deity players can match through other components | v1.1-endgame-and-activity.md Section 2 | IMPRECISE | Non-deity max is 2.65, not 3.05. But lootbox EV cap (a=2.55) is reachable without deity (2.65 > 2.55). |
| 70 | line ~2755-2757 | 20% bonus on affiliate commissions, capped at 5 ETH per level | v1.1-affiliate-system.md Section 9 | VERIFIED | Confirmed |
| 71 | line ~2757 | 32-pass cap | v1.1-deity-system.md Section 1 | VERIFIED | DEITY_PASS_MAX_TOTAL=32 |
| 72 | line ~2763-2764 | Deity/whale pool splits: 30/70 at L0, 5/95 at L1+ | v1.1-deity-system.md Section 2d | VERIFIED | WhaleModule:538-543 |
| 73 | line ~2783 | Commission: 20-25% on referred players' ETH purchases | v1.1-affiliate-system.md Section 2 | VERIFIED | 25% at L0-3, 20% at L4+ |
| 74 | line ~2784 | FLIP credits, mandatory 50/50 coinflip: win = 2x BURNIE | v1.1-burnie-coinflip.md Section 2 | IMPRECISE | Actual mean ~1.97x (tiers 1.50x/2.50x/[1.78x-2.15x]), not exactly "2x" |
| 75 | line ~2786-2787 | Day-5 affiliate 10% bonus commission | v1.1-affiliate-system.md | MISSING-CONTEXT | Not found in audit documentation. Flagged for investigation. |
| 76 | line ~2806-2810 | DGNRS: affiliates receive 35% of total supply | v1.1-dgnrs-tokenomics.md Section 2 | VERIFIED | AFFILIATE_POOL_BPS=3500 |
| 77 | line ~2814 | Top affiliate each level earns 1% of remaining pool | v1.1-transition-jackpots.md Section 11 | VERIFIED | AFFILIATE_POOL_REWARD_BPS=100 |
| 78 | line ~2797-2798 | Affiliate component of activity score: up to 0.50 | v1.1-endgame-and-activity.md Section 2a | VERIFIED | AFFILIATE_BONUS_MAX=50*100=5000 BPS |
| 79 | line ~2798-2799 | Without affiliate, fully engaged no-pass player peaks at ~1.21x lootbox | v1.1-endgame-and-activity.md Section 4a | VERIFIED | Activity 1.75 -> EV ~1.21x |
| 80 | line ~2799 | 100-level whale pass holders fall short of 1.35x cap without affiliate | v1.1-endgame-and-activity.md Sections 2, 4a | VERIFIED | Activity 2.15 -> EV ~1.28x |
| 81 | line ~2842 | Lazy pass: new player at 0.85 activity on day one | v1.1-endgame-and-activity.md Section 2b | VERIFIED | 50%+25%+10%=8500 BPS=0.85 |
| 82 | line ~2843 | 100-level whale bundle: new player at 1.15 | v1.1-endgame-and-activity.md Section 2a, 2b | VERIFIED | 50%+25%+40%=11500 BPS=1.15 |
| 83 | line ~2843 | Deity pass: new player at 1.55 | v1.1-endgame-and-activity.md Section 2c | VERIFIED | 50%+25%+80%=15500 BPS=1.55 |
| 84 | line ~2851-2857 | Corollary 3.1: equilibrium breakeven determined by activity score | v1.1-endgame-and-activity.md Section 4a | VERIFIED | Breakeven at a=0.60, sub-optimal play can still be +EV |

### Findings

| Location | Claimed | Correct | Source | Severity | Fix |
|----------|---------|---------|--------|----------|-----|
| SS3.4 line ~2753 | Non-deity players "can match through other components" | Non-deity max is 2.65, deity max is 3.05. But lootbox EV cap at a=2.55 is reachable without deity. | v1.1-endgame-and-activity.md Section 2 | IMPRECISE | Clarify that non-deities reach the lootbox EV cap (2.55) despite lower raw score |
| SS3.5 line ~2784 | Coinflip win = "2x BURNIE" | Actual mean ~1.97x with tiers 1.50x/2.50x/[1.78x-2.15x] | v1.1-burnie-coinflip.md Section 2 | IMPRECISE | Change "2x" to "~2x" or cite exact 1.97x mean |
| SS3.5 line ~2786 | Day-5 affiliate 10% bonus commission | Not documented in audit files | v1.1-affiliate-system.md | MISSING-CONTEXT | Verify against contract or remove |
| SS3 EV table (claims 46-53) | Composite EV values 1.10, 1.20, 1.30, 1.45 | Mix of contract params and illustrative composites | Multiple sources | MISSING-CONTEXT | Paper footnotes acknowledge FLIP rebate inclusion. Ordering correct. No fix needed. |

---

## SS4 Mechanism Design

### Claims Audited: 34 (19 numerical, 15 mechanism)

*Source: Phase 3 (03-01-SUMMARY.md)*

SS4 covers Accounting Solvency (SS4.1), Zero-Rake Property (SS4.2), and Permissionless Execution (SS4.3).

#### SS4.1 Accounting Solvency (lines 2865-2905)

Proposition 4.1 solvency invariant (`claimablePool <= ETH balance + stETH balance`) verified with variable mapping. All four state transition categories (deposits, jackpot payouts, claims, yield routing) confirmed as exhaustive.

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 1 | SS4.1 | Five logical pools correctly named | v1.1-ECONOMICS-PRIMER.md Section 3 | VERIFIED | 1:1 mapping to contract storage variables |
| 2 | SS4.1 | Only claimablePool represents current obligations | v1.1-steth-yield.md | VERIFIED | Only claimablePool has direct claim functions |
| 3 | SS4.1 | Proposition 4.1 solvency invariant | Contract architecture | VERIFIED | Four state transitions exhaustive |
| 4 | SS4.1 | 25% yield to vault | v1.1-steth-yield.md Section 3b | IMPRECISE | Actual 23% |
| 5 | SS4.1 | 25% yield to DGNRS | v1.1-steth-yield.md Section 3b | IMPRECISE | Actual 23% |
| 6 | SS4.1 | 50% yield to accumulator | v1.1-steth-yield.md Section 3b | IMPRECISE | Actual 46% |
| 7 | SS4.1 | 50% yield continuous | v1.1-steth-yield.md Section 3b | IMPRECISE | Accrues continuously, distributes at transitions |
| 8 | SS4.1 | 1% insurance skim | v1.1-parameter-reference.md | VERIFIED | INSURANCE_SKIM_BPS=100 |
| 9 | SS4.1 | 50% accumulator distributes at x00 | v1.1-steth-yield.md Section 3b | VERIFIED | 50/50 confirmed |
| 10 | SS4.1 | stETH conversion has no effect on solvency | v1.1-steth-yield.md Section 3a | VERIFIED | Both count toward total balance |
| 11 | SS4.1 | Accumulator isolation from drip/BAF | v1.1-purchase-phase-distribution.md | VERIFIED | Separate storage variable |
| 12 | SS4.1 | Two distinct accumulator inflow sources | v1.1-steth-yield.md, v1.1-pool-architecture.md | VERIFIED | Yield + insurance skim |

#### SS4.2 Zero-Rake Property (lines 2906-2960)

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 13 | SS4.2 | 20% presale lootbox to vault | v1.1-parameter-reference.md | VERIFIED | LOOTBOX_PRESALE_SPLIT_VAULT_BPS=2000 |
| 14 | SS4.2 | Presale ends after fixed levels or 200 ETH | AdvanceModule.sol:316 | VERIFIED | Level 3 or 200 ETH cap |
| 15 | SS4.2 | Capped at 40 ETH maximum | Arithmetic | VERIFIED | 200*20%=40 |
| 16 | SS4.2 | 20% DGNRS to creator | v1.1-dgnrs-tokenomics.md Section 2a | VERIFIED | CREATOR_BPS=2000 |
| 17 | SS4.2 | 25% stETH yield to vault | v1.1-steth-yield.md Section 3b | IMPRECISE | Actual 23% |
| 18 | SS4.2 line 2919 | Vault: 4 tickets per level | AdvanceModule.sol:99 | WRONG | VAULT_PERPETUAL_TICKETS=16 |
| 19 | SS4.2 line 2915 | DGNRS: 4 tickets per level | AdvanceModule.sol:99,1109 | WRONG | VAULT_PERPETUAL_TICKETS=16 applies to both |
| 20 | SS4.2 | Vault: activity score boost, no size scaling, no boons | v1.1-deity-system.md Section 7d | VERIFIED | Virtual deity status confirmed |
| 21 | SS4.2 | 2 million BURNIE to vault | v1.1-burnie-supply.md | VERIFIED | vaultAllowance=2_000_000 ether |
| 22 | SS4.2 | Unaffiliated commissions to vault | DegenerusAffiliate.sol:184 | VERIFIED | AFFILIATE_CODE_VAULT fallback |
| 23 | SS4.2 | 100% of post-presale deposits to prize pools | Multiple contract paths | VERIFIED | No vault extraction post-presale |
| 24 | SS4.2 | Definition 4.2 (Zero-Rake) | Definitional | VERIFIED | Internally consistent |
| 25 | SS4.2 | Corollary 4.4 coefficient 0.50 | v1.1-steth-yield.md Section 3b | IMPRECISE | Should be ~0.46 |

#### SS4.3 Permissionless Execution (lines 2961-2976)

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 26 | SS4.3 | BURNIE bounty ~0.01 ETH | AdvanceModule.sol:114 | VERIFIED | ADVANCE_BOUNTY_ETH=0.01 ether |
| 27 | SS4.3 | Escalating to 2x after one hour | AdvanceModule.sol:207 | VERIFIED | Confirmed |
| 28 | SS4.3 | Capping at 3x (~0.03 ETH) after two hours | AdvanceModule.sol:205-206 | VERIFIED | 0.01*3=0.03 |
| 29 | SS4.3 | 30 minutes past day boundary, anyone can call | AdvanceModule.sol:652 | VERIFIED | Public fallback confirmed |
| 30 | SS4.3 | Pass holders can call after 15 minutes | AdvanceModule.sol:655-661 | VERIFIED | Whale/lazy pass holders, not deity |
| 31 | SS4.3 | Primary path requires purchase in current/previous day | AdvanceModule.sol:642-643 | VERIFIED | Purchase-gating mechanism |
| 32 | SS4.3 | Deity pass holders bypass requirement | AdvanceModule.sol:644-645 | VERIFIED | deityPassCount check |
| 33 | SS4.3 | Ties heartbeat to real economic activity | Argumentative | VERIFIED | Sound characterization |
| 34 | SS4.3 | 1% insurance skim cross-reference | Phase 2 cross-reference | VERIFIED | Already verified |

### Findings

| Location | Claimed | Correct | Source | Severity | Fix |
|----------|---------|---------|--------|----------|-----|
| SS4.1 line 2890 | 25% yield to vault | 23% | v1.1-steth-yield.md Section 3b | IMPRECISE | Change to ~23% |
| SS4.1 line 2890 | 25% yield to DGNRS | 23% | v1.1-steth-yield.md Section 3b | IMPRECISE | Change to ~23% |
| SS4.1 line 2891 | 50% yield to accumulator | 46% | v1.1-steth-yield.md Section 3b | IMPRECISE | Change to ~46% |
| SS4.1 line 2892 | 50% yield continuous | 46% at transitions | v1.1-steth-yield.md Section 3b | IMPRECISE | Minor simplification |
| SS4.2 line 2919 | Vault: 4 tickets/level | 16 tickets/level | AdvanceModule.sol:99,1109-1110 | WRONG | Update to 16 tickets |
| SS4.2 line 2943 | Corollary 4.4 coefficient 0.50 | ~0.46 | v1.1-steth-yield.md Section 3b | IMPRECISE | Update coefficient |
| SS4.2 line 2915 | DGNRS: 4 tickets/level | 16 tickets/level | AdvanceModule.sol:99,1109 | WRONG | Update to 16 tickets |

---

## SS5 Equilibrium Analysis

### Claims Audited: 37 (20 numerical, 17 mechanism)

*Source: Phase 3 (03-02-SUMMARY.md)*

SS5 covers Active Participation (SS5.1), Inactive Equilibrium (SS5.2), Budget Constraints (SS5.3), Repeated Game Structure (SS5.4), and Commitment Devices (SS5.5). All 37 claims verified with zero discrepancies.

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 1 | SS5.1 | Activity score monotonically increases returns | v1.1-endgame-and-activity.md Sections 4a, 4b | VERIFIED | mu(a) and rho(a) both non-decreasing |
| 2 | SS5.1 | Reducing engagement reduces activity score | v1.1-endgame-and-activity.md Section 2a | VERIFIED | Additive components |
| 3 | SS5.1 | Marginal cost of streaks: one ticket per day | v1.1-quest-rewards.md | VERIFIED | Slot 0 = MINT_ETH, min 0.0025 ETH |
| 4 | SS5.1 | Deity pass transfers cost 5 ETH in BURNIE | v1.1-deity-system.md Section 3a | VERIFIED | DEITY_TRANSFER_ETH_COST=5 ether |
| 5 | SS5.2 | Tickets cost 0.01 ETH at level 0 | Phase 2 cross-reference | VERIFIED | PriceLookupLib confirmed |
| 6 | SS5.2 | 0.04 ETH tickets at level 10 | Phase 2 cross-reference | VERIFIED | x01-x29 range |
| 7 | SS5.2 | 24x BURNIE appreciation to century | Phase 2 cross-reference | VERIFIED | 0.06/0.0025=24x |
| 8 | SS5.2 | 20 ETH refund if game stalls before level 10 | v1.1-endgame-and-activity.md Section 7a | VERIFIED | DEITY_PASS_EARLY_GAMEOVER_REFUND=20 ether |
| 9 | SS5.2 | stETH yield accrues regardless of activity | v1.1-steth-yield.md | VERIFIED | Rebasing token property |
| 10 | SS5.2 | Deity pass 24+ ETH | v1.1-deity-system.md Section 2a | VERIFIED | DEITY_PASS_BASE=24 ether, escalating |
| 11 | SS5.2 | Bootstrap: four mechanisms correctly enumerated | Multiple sources | VERIFIED | All four confirmed |
| 12 | SS5.2 | Pass holders go first, compensated for doing so | v1.1-deity-system.md, v1.1-endgame-and-activity.md | VERIFIED | Multiple compensation mechanisms |
| 13 | SS5.3 | No rake, yield accrues in accumulator | v1.1-steth-yield.md Section 3b | VERIFIED | Mechanism-accurate |
| 14 | SS5.3 | EV floor for GTO play is positive | Argumentative | VERIFIED | Sound from verified mechanisms |
| 15 | SS5.4 | GAMEOVER triggered by inactivity timeout | v1.1-endgame-and-activity.md Section 5f | VERIFIED | No fixed terminal level |
| 16 | SS5.4 | 120 days timeout | Phase 2 cross-reference | VERIFIED | Hardcoded |
| 17 | SS5.4 | 90% terminal jackpot to next-level ticket holders | v1.1-endgame-and-activity.md Section 7 | VERIFIED | Pitfall 1 CLEAR |
| 18 | SS5.4 | Buying tickets for stalling level is dominant strategy | v1.1-endgame-and-activity.md Section 7 | VERIFIED | Self-reinforcing mechanism |
| 19-33 | SS5.5 | Commitment devices: future tickets, quest streaks, auto-rebuy, forced equity | Multiple sources | VERIFIED | All 15 claims verified |
| 34-37 | SS5.5 | Equilibrium selection claims | Argumentative | VERIFIED | All mechanism bases confirmed |

### Findings

No discrepancies found. All 37 claims verified.

---

## SS6 BURNIE Economics

### Claims Audited: 43 (33 numerical, 10 mechanism)

*Source: Phase 2 (02-01-SUMMARY.md)*

SS6 covers BURNIE Price Ratchet (SS6.1), Decimator (SS6.2), and 100-Level Cycle (SS6.3).

#### SS6.1 Pricing Table (22 claims)

All 7 pricing table rows verified against PriceLookupLib.sol. All 7 ETH-per-entry calculations verified arithmetically. BURNIE per entry (250) and per ticket (1,000) verified. Derived appreciation claims (24x, 6x) verified. All prose claims verified.

#### SS6.2 Decimator (12 claims)

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 23-26 | SS6.2 | Futurepool shares (10%/30%), bucket range (5-12) | EndgameModule, BurnieCoin.sol | VERIFIED | All match |
| 27 | SS6.2 line 3262 | Burn weight ~1.8x at max activity | BurnieCoin.sol:995-997 | IMPRECISE | Actual 1.7833x. Tilde signals approximation. Exact in tooltip (1.783x). |
| 28 | SS6.2 tooltip | 1.783x exact weight | BurnieCoin.sol:995-997 | VERIFIED | Rounds to 3 decimal places |
| 29-32 | SS6.2 | Mechanism claims (bucket, weight, permanent burns, 3-way sink) | Multiple contract sources | VERIFIED | All confirmed |
| 33 | SS6.2 (absent) | 200K BURNIE multiplier cap not mentioned | DecimatorModule:100 | MISSING-CONTEXT | Cap affects large burner value proposition |
| 34 | SS6.2 (absent) | Decimator claim expiry not mentioned | DecimatorModule:345-353 | MISSING-CONTEXT | Unclaimed rewards expire permanently |

#### SS6.3 100-Level Cycle (9 claims)

All pricing, BAF percentage (20%), decimator percentage (30%), and mechanism claims verified. Combined 50% drain correctly implied (not misleading).

### Findings

| Location | Claimed | Correct | Source | Severity | Fix |
|----------|---------|---------|--------|----------|-----|
| SS6.2 line 3262 | "~1.8x weight" | 1.7833x exactly | BurnieCoin.sol:995-997 | IMPRECISE | Acceptable. Exact value in tooltip and Appendix B.4. |
| SS6.2 (absent) | Not mentioned | 200K BURNIE multiplier cap | DecimatorModule:100 | MISSING-CONTEXT | Consider adding note about cap |
| SS6.2 (absent) | Not mentioned | Decimator claim expiry | DecimatorModule:345-353 | MISSING-CONTEXT | Consider adding note about expiry |

---

## SS7 Robustness

### Claims Audited: 20 (6 numerical, 14 mechanism)

*Source: Phase 4 (04-02-SUMMARY.md)*

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 85 | SS7.1 | Trait assignment deterministic from VRF | v1.1-ECONOMICS-PRIMER.md Section 5 | VERIFIED | Players cannot choose traits |
| 86 | SS7.1 | Terminal jackpot makes buying tickets individually +EV | v1.1-endgame-and-activity.md Section 7 | VERIFIED | ~1.8x payout ratio |
| 87 | SS7.1 | Affiliate creates mild coordination game | v1.1-affiliate-system.md Section 2 | VERIFIED | Kickback competition confirmed |
| 88 | SS7.1 | Strategic choices limited to amount/product/streaks | Definitional | VERIFIED | Consistent framing |
| 89-104 | SS7.2 | Griefer analysis: 120-day timeout, immutable contract, permissionless VRF recovery, attack vectors | Multiple sources | VERIFIED | All 16 claims verified against KNOWN-ISSUES.md and contract architecture |

### Findings

No discrepancies found. All 20 claims verified.

---

## SS8 Failure Modes

### Claims Audited: 16 (7 numerical, 9 mechanism)

*Source: Phase 2 (02-02-SUMMARY.md)*

SS8 covers Death Spiral Definition (SS8.1), Why the Protocol Resists (SS8.2), Whale Departure (SS8.3), and BURNIE Price Floor (SS8.4).

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 1 | SS8.1 | Definition 8.1 (death spiral: monotonically decreasing, negative growth, self-reinforcing) | Definitional | VERIFIED | Consistent with economic model |
| 2 | SS8.2 line 3382 | "50% of stETH yield" to accumulator | v1.1-steth-yield.md Section 3b | IMPRECISE | Actual 46% |
| 3 | SS8.2 | 1% of each completed level's prize pool | v1.1-parameter-reference.md | VERIFIED | INSURANCE_SKIM_BPS=100 |
| 4 | SS8.2 | Monte Carlo: 30 levels | Paper-internal | VERIFIED | Self-consistent |
| 5 | SS8.2 | Observation 8.1: four resistance mechanisms | Multiple audit docs | VERIFIED | All four correctly described |
| 6 | SS8.2 | 90/10 vs 10/90 ticket/lootbox pool split | v1.1-parameter-reference.md | VERIFIED | Confirmed |
| 7 | SS8.2 | Futurepool extraction U-shape | v1.1-level-progression.md Section 4a | VERIFIED | Minimum ~14 days |
| 8 | SS8.3 | Activity score aW = 3.05 | v1.1-parameter-reference.md | VERIFIED | ACTIVITY_SCORE_MAX_BPS=30500 |
| 9 | SS8.3 | Future ticket discount formula structure | Mechanism description | VERIFIED | Consistent with contract behavior |
| 10-15 | SS8.4 | BURNIE floor formula p(l)/900, parity p(l)/1000, 6x within-cycle rise | PriceLookupLib, DegenerusQuests.sol | VERIFIED | All derivations correct |

### Findings

| Location | Claimed | Correct | Source | Severity | Fix |
|----------|---------|---------|--------|----------|-----|
| SS8.2 line 3382 | 50% of stETH yield to accumulator | 46% | v1.1-steth-yield.md Section 3b | IMPRECISE | Change to ~46% or "roughly half" |

---

## SS9 Stress Tests

### Claims Audited: 45 (38 numerical, 7 mechanism)

*Source: Phase 2 (02-02-SUMMARY.md)*

SS9 covers Bear Market (SS9.1), Conditions for Failure (SS9.2), and Terminal Paradox (SS9.3). SS9.3 contains the pre-drawdown error that cascades to 13 derived values.

#### SS9.1 Bear Market (Claims 16-27)

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 16 | SS9.1 | 1% daily futurepool extraction | JackpotModule.sol:650 | VERIFIED | poolBps=100 |
| 17 | SS9.1 | 15% futurepool transfer at level start | state-changing-function-audits.md | VERIFIED | Normal levels only |
| 18 | SS9.1 | ~60% transfer over 120 days | Re-derived | VERIFIED | 15% dump + 75% of exponential drip = ~59.65% |
| 19 | SS9.1 | 1.5x target ratio assumption | Paper scenario | VERIFIED | Explicitly stated assumption |
| 20 | SS9.1 | ~35 players at 0.08 ETH close 37% gap | Arithmetic | VERIFIED | 35*0.08*0.9*120=302.4 > 296 ETH gap |
| 21 | SS9.1 | Eight-month runway | Approximation | VERIFIED | Two 120-day levels ~240 days |
| 22-27 | SS9.1 | Bear market scenario assumptions and defense mechanisms | Multiple sources | VERIFIED | All consistent |

#### SS9.2 Conditions for Failure (Claims 28-29)

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 28 | SS9.2 | Death clock: 365 days (L0) / 120 days (L1+) | AdvanceModule.sol:91,394 | VERIFIED | Confirmed |
| 29 | SS9.2 | Design Property 8.4 | Mechanism description | VERIFIED | Consistent with terminal distribution |

#### SS9.3 Terminal Paradox (Claims 30-61) -- PRE-DRAWDOWN CASCADE

**Root cause:** Paper uses 800 ETH as the drip starting point, but the 15% drawdown (120 ETH) occurs first. Drip should start from 680 ETH (post-drawdown), not 800.

All 13 downstream values cascade from this single error. The paper's algebra is internally consistent given its (incorrect) inputs. The entry conversion via `<<2` (4 entries per ticket) is correctly applied.

| # | Location | Claimed | Correct | Severity | Notes |
|---|----------|---------|---------|----------|-------|
| ROOT | SS9.3 line 3881 | Drip from 800 to ~239 | Drip from 680 to ~204 | WRONG (root) | Pre-drawdown error |
| C1 | SS9.3 line 3882 | 561 ETH drip extracted | 476 ETH | CASCADE | From root |
| C2 | SS9.3 line 3882 | 421 ETH to nextpool | 357 ETH | CASCADE | From C1 |
| C3 | SS9.3 line 3882 | 701 ETH nextpool (88%) | 637 ETH (80%) | CASCADE | From C2 |
| C4 | SS9.3 line 3883 | 2,631 drip tickets | 2,233 | CASCADE | From C2 |
| C5 | SS9.3 implicit | 6,631 total tickets | 6,233 | CASCADE | From C4 |
| C6 | SS9.3 line 3883 | 99 ETH gap, 1,375 to close | 163 ETH gap, 2,261 to close | CASCADE | From C3 |
| C7 | SS9.3 line 3889 | 1,074 ETH terminal assets | 975 ETH | CASCADE | From C3 |
| C8 | SS9.3 line 3889 | 967 ETH jackpot (90%) | 878 ETH | CASCADE | From C7 |
| C9 | SS9.3 line 3890 | 0.146 ETH/ticket, 1.8x | 0.141 ETH/ticket, 1.76x | CASCADE | From C8+C5 |
| C10 | SS9.3 line 3908 | 0.035 ETH drip, 1.66 tickets | 0.030 ETH, 1.56 tickets | CASCADE | From root |
| C11 | SS9.3 line 3922 | EV = 0.176P + 0.021 | EV = 0.158P + 0.012 | CASCADE | From all above |
| C12 | SS9.3 line 3929 | P(GO) threshold ~38% | ~40% | CASCADE | From C11 |

**Qualitative conclusions UNAFFECTED.** Terminal payout (0.141 ETH) still exceeds cost (0.08 ETH) by 1.76x. Day-1 buyer still unconditionally +EV. Late-buyer threshold rises from 38% to 40%.

Remaining SS9.3 claims (terminal distribution rules, 60/40 winner split, 30-day sweep, Pitfall 1 eligibility, distress mode, skim-drip tables) all VERIFIED.

### Findings

See cascade table above. All 13 derived mismatches trace to the single pre-drawdown root cause (800 vs 680).

---

## SS10 Growth Scenario

### Claims Audited: 12 (6 numerical, 6 mechanism)

*Source: Phase 4 (04-02-SUMMARY.md)*

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 105 | SS10 | Level target = previous level's actual pool (ratchet) | v1.1-pool-architecture.md | VERIFIED | Monotonically non-decreasing |
| 106 | SS10 | Accumulator grows from yield + 1% skim | v1.1-pool-architecture.md, v1.1-steth-yield.md | VERIFIED | Both sources confirmed |
| 107-110 | SS10 | Powerball references ($1.5B, $1.3B, 13x, $20M) | External facts | VERIFIED (EXTERNAL) | Historical data, not contract-verifiable |
| 111-116 | SS10 | Growth mechanisms: ratchet, century re-anchoring, jackpot guaranteed, positive EV, affiliate bridge | Multiple sources | VERIFIED | All confirmed |

### Findings

No discrepancies found. All 12 claims verified.

---

## SS11 Conclusion

### Claims Audited: 20 (6 numerical, 14 mechanism)

*Source: Phase 4 (04-02-SUMMARY.md)*

| # | Location | Claim | Source | Status | Notes |
|---|----------|-------|--------|--------|-------|
| 117 | SS11.1 | Deposits held in stETH, no withdrawal | v1.1-steth-yield.md, v1.1-endgame-and-activity.md | VERIFIED | Confirmed |
| 118 | SS11.1 | Single exploitable bug could drain pool permanently | Contract architecture | VERIFIED | Accurate risk statement |
| 119 | SS11.1 | Chainlink VRF is soft dependency (admin can migrate) | KNOWN-ISSUES.md | VERIFIED | 3-day stall recovery |
| 120 | SS11.1 | Lido stETH is hard dependency (no migration) | v1.1-steth-yield.md | VERIFIED | No alternative yield source |
| 121-136 | SS11 | Resilience thesis claims: terminal distribution, failure modes, observable metrics | Multiple sources | VERIFIED | All 16 claims confirmed |

### Findings

No discrepancies found. All 20 claims verified.

---

## Appendix A: Parameter Summary

### Claims Audited: 24 (all parameter rows)

*Source: Phase 2 (02-03-SUMMARY.md)*

All 24 parameter rows individually verified against v1.1-parameter-reference.md.

| # | Parameter | Status | Notes |
|---|-----------|--------|-------|
| 1 | stETH yield ~2.5% APR | VERIFIED | External market rate |
| 2 | stETH yield split 50/25/25% | IMPRECISE | Actual 46/23/23% |
| 3 | Activity score [0, 3.05] | VERIFIED | ACTIVITY_SCORE_MAX_BPS=30500 |
| 4 | Lootbox EV [0.80, 1.35] | VERIFIED | MIN=8000, MAX=13500 |
| 5 | Degenerette ROI [0.90, 0.999] | VERIFIED | MIN=9000, MAX=9990 |
| 6 | Lootbox EV cap 10 ETH/level/account | VERIFIED | LOOTBOX_EV_BENEFIT_CAP=10 ether |
| 7 | Degenerette ETH cap 10% futurepool | VERIFIED | ETH_WIN_CAP_BPS=1000 |
| 8 | Coinflip win rate 0.50 | VERIFIED | `(rngWord & 1) == 1` |
| 9 | Coinflip win payout mean 1.9685x | VERIFIED | Exact from BPS |
| 10 | Affiliate commission 0.20-0.25 | VERIFIED | 25% L0-3, 20% L4+ |
| 11 | Ticket price range 0.01-0.24 ETH | VERIFIED | PriceLookupLib |
| 12 | Whale bundle 2.4-4 ETH | VERIFIED | EARLY=2.4, STANDARD=4 |
| 13 | Deity pass base 24 ETH + T(n) | VERIFIED | DEITY_PASS_BASE=24 |
| 14 | Deity pass cap 32 | VERIFIED | DEITY_PASS_MAX_TOTAL=32 |
| 15 | Pre-game timeout 365 days | VERIFIED | DEPLOY_IDLE_TIMEOUT_DAYS=365 |
| 16 | Post-game timeout 120 days | VERIFIED | Hardcoded 120 days |
| 17 | VRF retry timeout 18 hours | VERIFIED | Derived from retry logic |
| 18 | Emergency stall gate 3 days | VERIFIED | GAMEOVER_RNG_FALLBACK_DELAY=3 days |
| 19 | Quest daily reward 300 BURNIE | VERIFIED | 100 (slot 0) + 200 (slot 1); MISSING-CONTEXT: requires both slots |
| 20 | Bootstrap prize pool 50 ETH | VERIFIED | BOOTSTRAP_PRIZE_POOL=50 ether |
| 21 | BAF leaderboard reset every 10 levels | VERIFIED | lvl%10==0 trigger |
| 22 | Jackpots per level 3-5 daily | IMPRECISE | "< 3 days" vs B.1's "<= 2 days"; equivalent for integers but inconsistent phrasing |
| 23 | BAF scatter share 60% (40%+20%) | WRONG | Actual 70% (45%+25%). Contradicts Appendix B.3. |
| 24 | Auto-rebuy ticket bonus 30%/45% | VERIFIED | AUTO_REBUY=13000, AFKING=14500 |

### Findings

| Location | Claimed | Correct | Source | Severity | Fix |
|----------|---------|---------|--------|----------|-----|
| App A line 4282 | stETH yield split 50/25/25% | 46/23/23% | v1.1-steth-yield.md Section 3b | IMPRECISE | Update to ~46/23/23 |
| App A line 4404 | "< 3 days" compression trigger | "<= 2 days" (equivalent for integers) | v1.1-jackpot-phase-draws.md Section 6 | IMPRECISE | Align phrasing with B.1 |
| App A line 4409 | BAF scatter 60% (40%+20%) | 70% (45%+25%) | v1.1-transition-jackpots.md Section 3 | WRONG | Update to 70% (45%+25%) |

---

## Appendix B: Jackpot Distribution Detail

### Claims Audited: 22 (all numerical)

*Source: Phase 2 (02-03-SUMMARY.md)*

B.1 Level Jackpot: 5/3/1-day modes, 6-14% daily slice, day 5 = 100%, 20% ticket-conversion, trait-bucket shares. All VERIFIED.

B.2 Purchase-Phase Daily Jackpot: 1%/day drip, 75/25 lootbox/ETH split, 50% ticket conversion at 200% backing, 3% earlybird, 0.5% BURNIE draw. All VERIFIED except two IMPRECISE items.

B.3 BAF: 10%/20% futurepool, internal splits 10/5/5/5+5/45+25% all VERIFIED. Century scatter ratio IMPRECISE.

B.4 Decimator: 10%/30% futurepool, 1.783x max weight IMPRECISE, bucket defaults, 200K cap, 50%/20% win probabilities all VERIFIED.

### Findings

| Location | Claimed | Correct | Source | Severity | Fix |
|----------|---------|---------|--------|----------|-----|
| App B.2 line 4450 | Futurepool drip "days 1-4" | Days 2-4 only (day 1 is earlybird) | v1.1-jackpot-phase-draws.md Sections 4-5 | IMPRECISE | Change to "days 2-4" |
| App B.2 line 4455 | BURNIE "every third draw" to far-future | Every day, 25% to far-future | v1.1-jackpot-phase-draws.md Section 8 | IMPRECISE | Correct mechanism description |
| App B.3 line 4477 | Century scatter ~85% from past levels | 76% (38/50 rounds) | v1.1-transition-jackpots.md Section 3 | IMPRECISE | Update to ~76% |
| App B.4 line 4487 | 1.783x max burn weight | ~1.783x (approximate, exact mapping depends on contract formula) | BurnieCoin.sol | IMPRECISE | Acceptable approximation |

---

## Appendix C: Model Detail

### Claims Audited: 28 (all numerical and mechanism)

*Source: Phase 2 (02-03-SUMMARY.md)*

C.1-C.2: Lootbox EV table (3 rows), 10 ETH cap, decimator schedule, bucket defaults. All VERIFIED.

C.3: Prize pool dynamics (90/10 and 10/90 splits, U-shape extraction, yield accrual, 1% insurance skim, century 50/50 distribution). All VERIFIED except yield split.

C.4: Activity score formula verified coefficient-by-coefficient (all 5 components). Lootbox EV piecewise function breakpoints and slopes verified. Degenerette ROI range verified.

C.5-C.8: Boons, protocol architecture, liveness guarantee, DGNRS token. All VERIFIED.

### Findings

| Location | Claimed | Correct | Source | Severity | Fix |
|----------|---------|---------|--------|----------|-----|
| App C line 4605 | 50% yield to accumulator in formulas | 46% | v1.1-steth-yield.md Section 3b | IMPRECISE | Same yield split finding |

---

## Appendix D: Attack Vector Analysis

### Claims Audited: 16 (9 numerical, 7 mechanism)

*Source: Phase 3 (03-02-SUMMARY.md)*

All 16 claims verified with zero discrepancies. Covers Sybil farming (10 ETH/level cap, linear scaling), Degenerette drain (10% cap, 75% lootbox conversion), self-referral laundering (blocked at contract level, 0.5 ETH cap, 25% taper floor), stETH depeg (auto-stake above claimablePool, 0.93:1 historical), and death-bet attack (self-defeating by construction, 90% to nextpool).

### Findings

No discrepancies found. All 16 claims verified.

---

## Appendix E: Bear Market Equilibrium

### Claims Audited: 12 (10 numerical, 2 mechanism)

*Source: Phase 2 (02-03-SUMMARY.md)*

E.1-E.4: Fixed-point equation, monotonicity/uniqueness/stability, threshold analysis, BURNIE dilution. All VERIFIED.

E.7 Grinder Pivot: Lootbox returns 1.07x-1.25x at activity 1.0-2.0 VERIFIED. Tickets beat lootboxes at P(GO) > 4% VERIFIED. 9x nextpool contribution VERIFIED. ~60% mechanical transfer VERIFIED.

### Findings

| Location | Claimed | Correct | Source | Severity | Fix |
|----------|---------|---------|--------|----------|-----|
| App E line 5016 | "all six mechanisms" | SS9.1 may list five conjunctive requirements | Cross-reference | IMPRECISE | Align mechanism count across sections |
| App E line ~5044 | Grinder pivot 4% threshold | Accepted as shorthand for more complex comparison | Multiple sources | IMPRECISE | Acceptable simplification |

---

## Appendix F: Misreadings

### Claims Audited: 30 (16 numerical, 14 mechanism)

*Source: Phase 4 (04-02-SUMMARY.md)*

28 entries reviewed. 15 contain verifiable claims; 13 are argumentative with no verifiable numbers.

Key verified entries: F.1 presale 20%/200 ETH/40 ETH max (VERIFIED), F.3 Ponzi criteria (VERIFIED), F.5 Corollary 4.4 reference (VERIFIED), F.8 120-day timeout (VERIFIED), F.10 terminal paradox re-citations (VERIFIED, internally consistent with SS9.3), F.22/F.24/F.25 activity score and mechanical flow references (VERIFIED).

### Findings

| Location | Claimed | Correct | Source | Severity | Fix |
|----------|---------|---------|--------|----------|-----|
| F.1 line ~5133 | Vault receives 25% of stETH yield | 23% | v1.1-steth-yield.md Section 3b | IMPRECISE | Same yield split finding |
| F.1 line ~5148 | 50% of total yield to players | 46% | v1.1-steth-yield.md Section 3b | IMPRECISE | Same yield split finding |
| F.2 line ~5173 | Yield split 50/25/25 | 46/23/23 | v1.1-steth-yield.md Section 3b | IMPRECISE | Same yield split finding |
| F.6 line ~5315 | Large winner split 75% ETH / 25% whale passes | 50% ETH / 50% lootbox (ethPortion = amount/2) | v1.1-transition-jackpots.md Section 3 | WRONG | Change to "approximately half their payout in ETH and half as whale passes" |
| F.11 line ~5501 | Affiliate tiers 75/20/5 | Tier 2 is 4% (scaledAmount/25), not 5%. At max kickback: ~75.8/20.2/4.0 | v1.1-affiliate-system.md Section 4 | WRONG | Change "5%" to "4%" and note lottery-weighted payout |
| F.27 line ~5951 | Day-5 affiliate 10% bonus commission | Not documented in audit files | v1.1-affiliate-system.md | MISSING-CONTEXT | Verify or remove |

---

## Cross-Section Consistency

*Source: Phase 5 (05-01-SUMMARY.md)*

8 cross-reference clusters validated across all paper sections.

| Cluster | Description | Result | Details |
|---------|-------------|--------|---------|
| 1 | stETH Yield Split (50/25/25 vs 46/23/23) | CONSISTENT | All 8+ locations imprecise identically. No internal contradiction. |
| 2 | SS9.3 Terminal Cascade (800 vs 680) | CONSISTENT | F.10 re-cites SS9.3 values. Both wrong identically. |
| 3 | BAF Scatter (60% vs 70%) | INCONSISTENT (KNOWN) | Appendix A says 60%, B.3 says 70%. Confined to appendices. |
| 4 | Vault/DGNRS Ticket Count (4 vs 16) | INCONSISTENT (KNOWN + NEW) | SS4.2 (2 locations) + DGNRS appendix line 4784 (new third location). |
| 5 | Jackpot Large Winner Split (F.6 vs SS3.4) | INCONSISTENT (KNOWN) | F.6 says 75/25, SS3.4 correctly says 50/50. |
| 6 | Affiliate Tier Fractions | NOT APPLICABLE | Only cited in F.11 (single location). |
| 7 | Death Clock and Terminal References | CONSISTENT | All locations agree on 120 days and 90% terminal payout. |
| 8 | Appendix A Parameter Rows | CONSISTENT | 2 known appendix-appendix mismatches, no main-text contradictions. |

**New finding from Phase 5:** DGNRS appendix (line 4784) re-cites "4 tickets per level" (the incorrect value from SS4.2). This is a third location for the same root finding (VAULT_PERPETUAL_TICKETS=16).

Where the paper is wrong, it is wrong the same way everywhere, making corrections straightforward.

---

## All Discrepancies (Grouped by Root Finding)

### WRONG (3 root findings)

| # | Root Finding | Severity | Sections Affected | Fix |
|---|-------------|----------|-------------------|-----|
| 1 | F.6: BAF large winner split 75/25 should be 50/50 | WRONG | Appendix F.6 (line ~5315). Paper's own SS3.4 correctly says "half/half". | Change to "approximately half their payout in ETH and half as whale passes (100-level ticket bundles)" |
| 2 | F.11: Affiliate tier 2 is 4% (scaledAmount/25), not 5% | WRONG | Appendix F.11 (line ~5501). | Change "5%" to "4%". Note lottery-weighted payout mechanism. |
| 3 | SS9.3: Pre-drawdown error. Drip starts from 680 ETH (post-drawdown), not 800. | WRONG (root) | SS9.3 (13 derived values), F.10 (re-cites same values). | Re-derive all SS9.3 worked examples starting from 680 ETH post-drawdown. |

### CASCADE (13 derived values from root #3)

All trace to SS9.3 pre-drawdown error. See SS9.3 section above for full cascade table. Qualitative conclusions are all sound. Fix: re-derive from 680 ETH.

### WRONG (structural, not factual)

| # | Root Finding | Severity | Sections Affected | Fix |
|---|-------------|----------|-------------------|-----|
| 4 | Vault/DGNRS: 4 tickets per level should be 16 | WRONG | SS4.2 (lines 2915, 2919), DGNRS appendix (line 4784). 3 locations. | Update "4 tickets" to "16 tickets" in all three locations. |
| 5 | BAF scatter: 60% should be 70% (Appendix A only) | WRONG | Appendix A (line 4409). Appendix B.3 is correct. | Update Appendix A "60% (40%+20%)" to "70% (45%+25%)" |

### IMPRECISE (recurring)

| # | Root Finding | Severity | Sections Affected | Fix |
|---|-------------|----------|-------------------|-----|
| 6 | stETH yield split 50/25/25 vs actual 46/23/23 | IMPRECISE | SS4.1, SS4.2, SS8.2, App A, App C, F.1, F.2 (8+ locations) | Update to ~46/23/23 or add footnote. All locations imprecise identically. |
| 7 | Corollary 4.4 coefficient 0.50 vs ~0.46 | IMPRECISE | SS4.2 (line 2943) | Update coefficient to ~0.46 |
| 8 | Decimator ~1.8x vs 1.7833x | IMPRECISE | SS6.2 (line 3262). Exact value in tooltip and App B.4. | Acceptable. No fix needed. |
| 9 | Coinflip "2x" vs actual mean ~1.97x | IMPRECISE | SS3.5 (line 2784) | Change "2x" to "~2x" |
| 10 | Jackpot compression "< 3 days" vs "<= 2 days" | IMPRECISE | App A (line 4404) vs B.1. Equivalent for integers. | Align phrasing |
| 11 | BURNIE "every third draw" to far-future vs 25% every day | IMPRECISE | App B.2 (line 4455) | Correct mechanism description |
| 12 | Futurepool drip "days 1-4" vs actual days 2-4 | IMPRECISE | App B.2 (line 4450) | Change to "days 2-4" |
| 13 | Century BAF scatter ~85% past vs actual ~76% | IMPRECISE | App B.3 (line 4477) | Update to ~76% |
| 14 | Deity activity score: non-deity max 2.65 not 3.05 | IMPRECISE | SS3.4 (line 2753). But lootbox EV cap reachable. | Clarify EV cap vs raw score |
| 15 | Decimator burn weight 1.783x in B.4 | IMPRECISE | App B.4 (line 4487). Approximate. | Acceptable |
| 16 | Mechanism count "six" in E.5 vs "five" in SS9.1 | IMPRECISE | App E (line 5016) | Align count |
| 17 | Grinder pivot 4% threshold | IMPRECISE | App E. Accepted as shorthand. | Acceptable simplification |

### MISSING-CONTEXT

| # | Root Finding | Severity | Sections Affected | Fix |
|---|-------------|----------|-------------------|-----|
| 18 | 200K BURNIE decimator multiplier cap | MISSING-CONTEXT | SS6.2 | Consider adding note about cap |
| 19 | Decimator claim expiry | MISSING-CONTEXT | SS6.2 | Consider adding note about expiry |
| 20 | Day-5 affiliate 10% bonus commission | MISSING-CONTEXT | SS3.5 (line 2786), F.27 (line 5951) | Verify against contract or remove |
| 21 | Shared multiplier range description | MISSING-CONTEXT | SS2.5 (line 2509) | Clarify bonus vs total multiplier |
| 22 | Quest 300 BURNIE requires both slots | MISSING-CONTEXT | App A (line 4289) | Minor. Main text covers this. |
| 23 | EV table composite values (1.10, 1.20, 1.30, 1.45) | MISSING-CONTEXT | SS3 EV table | Paper footnotes acknowledge. No fix needed. |

---

## Master Summary Table

| Section | Claims | VERIFIED | WRONG | IMPRECISE | MISSING-CONTEXT | CASCADE |
|---------|--------|----------|-------|-----------|-----------------|---------|
| SS1 | 19 | 19 | 0 | 0 | 0 | 0 |
| SS2 | 23 | 22 | 0 | 0 | 1 | 0 |
| SS3 | 42 | 35 | 0 | 2 | 5 | 0 |
| SS4 | 34 | 24 | 2 | 7 | 0 | 0 |
| SS5 | 37 | 37 | 0 | 0 | 0 | 0 |
| SS6 | 43 | 40 | 0 | 1 | 2 | 0 |
| SS7 | 20 | 20 | 0 | 0 | 0 | 0 |
| SS8 | 16 | 15 | 0 | 1 | 0 | 0 |
| SS9 | 45 | 28 | 1 | 0 | 0 | 13 |
| SS10 | 12 | 12 | 0 | 0 | 0 | 0 |
| SS11 | 20 | 20 | 0 | 0 | 0 | 0 |
| Appendix A | 24 | 20 | 1 | 2 | 1 | 0 |
| Appendix B | 22 | 18 | 0 | 4 | 0 | 0 |
| Appendix C | 28 | 27 | 0 | 1 | 0 | 0 |
| Appendix D | 16 | 16 | 0 | 0 | 0 | 0 |
| Appendix E | 12 | 10 | 0 | 2 | 0 | 0 |
| Appendix F | 30 | 25 | 2 | 3 | 0 | 0 |
| **Total** | **423** | **388** | **6** | **23** | **9** | **13** |

**Note on WRONG count:** The 6 WRONG includes: F.6 (1), F.11 (1), SS9.3 root (1), SS4.2 vault tickets (2), App A BAF scatter (1). Three of these (SS4.2 x2 and App A) are the same root values repeated in multiple locations.

**Distinct root findings:** 5 WRONG, 17 IMPRECISE, 6 MISSING-CONTEXT, 1 CASCADE root (13 derived). Total distinct: ~23 unique issues across 423 claims.

---

## Executive Summary

**Total claims audited: 423** across 11 main sections and 6 appendices of the game theory paper.

**Severity breakdown:**
- **VERIFIED:** 388 (91.7%)
- **WRONG:** 6 across 5 distinct root findings (1.4%)
- **IMPRECISE:** 23 across 17 distinct root findings (5.4%)
- **MISSING-CONTEXT:** 9 across 6 distinct items (2.1%)
- **CASCADE:** 13 derived values from a single root cause (3.1%)

**Qualitative conclusions are ALL SOUND.** No finding changes the paper's game-theoretic arguments. The terminal paradox self-prevention mechanism, the cross-subsidy structure, the activity score dominance result, the death spiral resistance argument, and the bear market resilience thesis are all supported by correctly described mechanisms regardless of the numerical imprecisions found.

**The two most significant WRONG findings:**

1. **F.6 (Appendix F.6):** BAF large winner split stated as 75/25 (ETH/whale passes) but contract code shows 50/50 (`ethPortion = amount / 2`). The paper's own SS3.4 correctly states "half/half." F.6 contradicts both the contract and the paper's earlier section.

2. **F.11 (Appendix F.11):** Affiliate tier 2 stated as 5% but contract computes `scaledAmount/25` = 4%. The "75/20/5" framing is never achievable under any configuration.

**The cascade root cause:** SS9.3 uses 800 ETH as the drip starting point, but the 15% drawdown (120 ETH to nextpool) occurs before drip begins. The correct starting point is 680 ETH. This inflates 13 downstream values by 10-18% but does not change any qualitative conclusion.

**Vault/DGNRS ticket count:** Paper says 4 tickets per level in three locations; contract gives 16 (`VAULT_PERPETUAL_TICKETS=16`).

**stETH yield split:** Paper consistently says 50/25/25% across 8+ locations; actual is 46/23/23% with ~8% buffer. All locations are imprecise identically (no internal contradiction).
