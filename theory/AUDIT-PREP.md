# Game Theory Paper Audit: Preparation Reference

**Generated:** 2026-03-16
**Paper:** theory/index.html (6,018 lines)
**Primer:** v1.1-ECONOMICS-PRIMER.md Section 9

## How to Use This Document

Phase 2-4 auditors: Before auditing any section, check the Pitfalls section below for pitfalls that apply to your section. Then check the Paper Structure Map for the claim density and types you should expect to find.

---

## Pitfalls

### Claim Type Definitions

- **Numerical claim:** Any specific number cited in the paper that can be verified against the parameter reference, audit docs, or contract source. Includes: BPS values, ETH amounts, percentages, timing constants, multipliers, score thresholds, price curves, pool targets, ratios, and counts. Also includes numbers derived from parameters (e.g., "24x appreciation").
- **Mechanism claim:** Any description of how a contract mechanism works (flow paths, trigger conditions, state transitions, calculation methods, eligibility rules, ordering, freeze behavior). These are "how does X work?" statements verifiable against contract code or audit docs.
- **Worked example:** Any multi-step calculation that starts from parameters, applies formulas, and arrives at a concrete result. Includes the SS9.3 terminal paradox math, bear market runway calculations, extraction function examples, and EV calculations with explicit numbers.

### Pitfall Reference

#### Pitfall 1: Terminal jackpot targets lvl+1, not current level
**What goes wrong:** Paper might say "terminal jackpot pays current-level ticketholders" or describe eligibility incorrectly. Only next-level ticketholders win the final payout.
**Paper sections affected:**
- **SS9.3 Terminal Paradox** (lines 3814-4090): The entire terminal paradox analysis depends on next-level ticket eligibility. The worked example (level 50 baseline) calculates drip tickets, terminal payout per ticket, and EV formulas all for next-level holders. Any reference to "eligible tickets" must mean lvl+1 tickets. The paper at line 3827 says "next-level ticket holders" correctly, and at line 3832 says "tickets for the in-progress level." Check that these are consistent and that "in-progress level" means the level being filled (which IS the next level relative to the completed one).
- **SS8.2 Why Protocol Resists Death Spirals** (lines 3371-3582): References terminal mechanism. Verify any mention of terminal jackpot recipients.
- **Appendix B.3 BAF** (lines 4457-4483): Terminal BAF description at line 4480-4482 states "next-level ticket holders" for the terminal distribution. Verify this is consistent with SS9.3.
- **Appendix E Bear Market Formal** (lines 4849-5086): Fixed-point analysis uses ticket eligibility in payoff formulas. The payoff formula at line 4860 includes N(t) as total eligible tickets. Verify N(t) counts next-level tickets only.
- **SS5.4 Repeated Game** (lines 3070-3086): Line 3081 states "90% of all locked assets to next-level ticket holders." Verify consistency.
- **Appendix D Attack 5** (lines 4833-4847): Death-bet analysis at line 4837 says "next-level ticket holders." Verify.
**Severity if wrong:** HIGH. Would invalidate the entire terminal paradox worked example and the self-prevention argument.

#### Pitfall 2: Lootbox 2x over-collateralization
**What goes wrong:** Paper might state lootbox ticket count equals the full ETH budget, or forget that tickets are backed at 2x face value (so half as many tickets are created, each backed at 200%).
**Paper sections affected:**
- **SS9.3 Terminal Paradox** (lines 3867-3884): The drip ticket calculation is the critical point. Line 3879 states "50% ticket conversion rate" with "full budget enters the pool, backing each drip ticket at .16 ETH (twice face price)." The 2,631 drip tickets figure depends on this 2x backing. Check that the math is consistent: if 421 ETH flows as drip and tickets are 0.08 ETH face value, then at 2x backing each ticket costs 0.16 ETH worth of pool backing, so 421 * 0.75 (the 75% ticket portion) / 0.16 = ~1,973. The paper says 2,631, which implies the full extraction (not just the 75% ticket portion) converts to tickets. Verify against contract logic.
- **Appendix B.1/B.2 Jackpot Distribution** (lines 4420-4456): Line 4438 mentions "20% ticket-conversion budget." Line 4447 says "75% flows to nextPrizePool (at 50% ticket conversion with 200% backing per drip ticket)." Verify these are consistent descriptions of the same 2x mechanism.
- **Appendix C Prize Pool Dynamics** (lines 4580-4616): Formal pool dynamics equations. Check whether the 2x over-collateralization is reflected in the formulas or only described in prose.
**Severity if wrong:** HIGH. The 2,631 drip ticket count is load-bearing for the terminal paradox EV calculation.

#### Pitfall 3: BURNIE coinflip losses are permanent burns
**What goes wrong:** Paper might describe coinflip losses going to a pool or being recycled rather than permanently destroyed.
**Paper sections affected:**
- **SS6.1 BURNIE Price Ratchet** (lines 3167-3253): The BURNIE pricing table and supply dynamics rely on burn permanence. Check that any description of coinflip mechanics correctly states losses are burned, not recycled.
- **SS6.2 Decimator** (lines 3254-3270): Decimator BURNIE burns are also permanent. Verify the paper does not conflate decimator burns with coinflip burns, or imply either is recoverable.
- **SS8.4 BURNIE Token Price Floor** (lines 3613-3656): The price floor argument depends on BURNIE becoming scarcer through permanent burns. If coinflip losses were recycled instead of burned, the deflationary pressure would not exist. Verify the prose is consistent with permanent burn.
- **Appendix A Parameter Summary** (lines 4262-4419): Line 4318-4326 lists coinflip parameters (0.50 win rate, 1.9685x payout mean, 1.575% edge). The 1.575% edge calculation depends on losses being permanent burns. Verify the edge calculation is consistent.
- **SS2.3 Cross-Subsidy** (lines 2276-2428): Cross-subsidy table includes "BURNIE holders: deflationary pressure" from Degenerette BURNIE bets and daily coinflip. Verify that "deflationary" correctly implies permanent burn.
**Severity if wrong:** MEDIUM. Would not invalidate worked examples but would undermine the price floor argument and supply dynamics claims.

#### Pitfall 4: Decimator claim expiry
**What goes wrong:** Paper might not mention that unclaimed decimator rewards expire when the next decimator resolves, or might describe them as persistent claims.
**Paper sections affected:**
- **SS6.2 Decimator** (lines 3254-3270): Core decimator description. Check whether the paper mentions the claim window or implies rewards persist indefinitely.
- **Appendix B.4 Decimator** (lines 4484-4498): Detailed decimator mechanics. The text describes bucket assignment, burn weight, and pool percentages but may not mention claim expiry. Verify.
- **Appendix C Decimator Trigger Schedule** (lines 4553-4578): Trigger schedule table. The timing between decimators determines the claim window. If the schedule shows decimators every 10 levels, an unclaimed reward expires when the next 10-level milestone fires. Check whether this is stated or implied.
**Severity if wrong:** LOW. Claim expiry is primarily a practical concern for individual players. It does not affect the paper's game-theoretic arguments, but omitting it could mislead a reader about extraction strategy.

#### Pitfall 5: Deity boon overwrite can be a downgrade
**What goes wrong:** Paper might describe boons as purely additive without noting the overwrite risk where a new boon replaces an existing one, potentially replacing a high-value boon with a low-value one.
**Paper sections affected:**
- **SS3.4 The Whale** (lines 2722-2776): Whale strategy discussion references deity boons and their social power. Check whether boon overwrite is mentioned as a risk factor for deity holders.
- **Appendix C Boons** (lines 4658-4664): Boon mechanics description. Line 4659-4664 describes boon types but may not mention the overwrite mechanic. Verify.
- **SS5.5 Commitment Devices** (lines 3087-3164): Deity pass value discussion. If boon overwrite is not mentioned here, it could overstate deity pass attractiveness.
**Severity if wrong:** LOW. Boon overwrite is a nuance of individual player strategy, not a systemic error. The paper's game-theoretic arguments do not depend on boons being purely additive.

#### Pitfall 6: Affiliate DGNRS "5% per level" is not reserved
**What goes wrong:** Paper might imply each affiliate gets a guaranteed 5% of the DGNRS affiliate pool, when in fact multiple claimants sequentially deplete the same pool. Early claimants get more; late claimants may find the pool nearly empty.
**Paper sections affected:**
- **SS3.5 The Affiliate** (lines 2777-2814): Affiliate economics. Lines 2807-2810 describe the DGNRS distribution: "distributed from a dedicated pool that segregates a fixed percentage of its remaining balance at each level transition." This correctly implies geometric depletion. Verify that the description does not use language suggesting reservation or guarantee.
- **Appendix C DGNRS Token** (lines 4760-4793): DGNRS distribution pools. Lines 4765-4775 list the five distribution sources. Check whether the affiliate pool description implies sequential depletion or reserved allocation.
**Severity if wrong:** MEDIUM. Could mislead affiliate economics analysis if a reader assumes guaranteed allocation rather than competitive depletion.

#### Pitfall 7: PPM vs BPS confusion
**What goes wrong:** Paper might use BPS (10,000 scale) where the contract uses PPM (1,000,000 scale) for whale bundle DGNRS rewards, or vice versa. The whale bundle DGNRS rewards use PPM in the contract, while most other parameters use BPS.
**Paper sections affected:**
- **SS3.4 The Whale** (lines 2722-2776): Whale bundle economics. Check any DGNRS reward rate cited here. The paper may describe whale bundle DGNRS as a percentage without specifying the scale.
- **Appendix A Parameter Summary** (lines 4262-4419): Parameter table. Any DGNRS reward rate for whale bundles must use the correct scale. If the paper says "1% of whale pool" this could mean 100 BPS or 10,000 PPM, and the distinction matters for the actual amount.
- **Appendix C DGNRS Token** (lines 4760-4793): Distribution mechanics. Check whether whale pool distribution amounts are consistent with PPM-scale contract parameters.
**Severity if wrong:** MEDIUM. Would produce a 100x error in whale bundle DGNRS reward calculations if PPM is cited as BPS or vice versa.

#### Pitfall 8: x00 levels drain 50% of futurePool
**What goes wrong:** Paper might understate the combined BAF (20%) + Decimator (30%) drain at century milestones, or cite them separately without noting they fire simultaneously at x00 levels.
**Paper sections affected:**
- **SS6.3 The 100-Level Cycle** (lines 3271-3290): Century crescendo description. Check whether the combined 50% drain is explicitly stated or only implied by separate percentages.
- **SS8.2 Why Protocol Resists Death Spirals** (lines 3371-3582): Pool dynamics during stress. The death spiral analysis must account for the x00 drain when modeling futurepool depletion. Verify the analysis does not assume a gradual drain when the x00 event is a large discrete shock.
- **SS9.1 Bear Market Stress Test** (lines 3661-3788): Futurepool balance calculations. The stress test models futurepool at "~1.5x the level target." Check whether this accounts for the x00 drain that may have recently fired or is about to fire. At level 100, the futurepool just experienced a 50% drain.
- **Appendix B.3 BAF** (lines 4457-4483): Line 4460-4461 states "20% as part of the crescendo event." Verify consistency with the 50% combined total.
- **Appendix B.4 Decimator** (lines 4484-4498): Lines 4489-4491 state "30% of futurePrizePool" at x00. Verify.
- **Appendix C Decimator Trigger Schedule** (lines 4553-4578): Table shows explicit percentages (10% normal, 30% x00). Verify these match the B.3/B.4 descriptions and that the combined 50% is stated somewhere.
**Severity if wrong:** HIGH. Understating the x00 drain would significantly misrepresent futurepool dynamics, especially in the bear market stress test where the futurepool ratio is load-bearing.

#### Pitfall 9: Quest slot 0 is mandatory before slot 1
**What goes wrong:** Paper might describe quest rewards without noting that slot 0 (the MINT_ETH quest) forces a daily ETH purchase as prerequisite for the slot 1 bonus quest. This is the mechanism that makes quest streaks a real daily cost.
**Paper sections affected:**
- **SS5.5 Commitment Devices** (lines 3087-3164): Quest streak as commitment device. Lines 3116-3117 describe the streak contribution. The text should note that maintaining the streak requires a daily ETH purchase (via slot 0). Lines 3057-3058 mention "Quest completion requires a new ETH purchase (ticket or lootbox) to maintain the streak." Verify this accurately describes the slot 0 requirement.
- **Appendix A Parameter Summary** (lines 4262-4419): Quest daily reward listed as "300 BURNIE" at line 4385. This is the combined reward for both slots (100 + 200). Verify the paper does not imply 300 BURNIE for a single quest.
**Severity if wrong:** LOW. The paper already notes the ETH purchase requirement in SS5.3/SS5.5. The slot 0/slot 1 distinction is a contract implementation detail. The game-theoretic consequence (daily ETH cost) is correctly described.

#### Pitfall 10: Three-tier jackpot compression
**What goes wrong:** Paper might describe compressed jackpots as simply doubling the BPS rates, when actually they merge logical days into fewer physical days at higher per-day rates. The three modes are: normal (5 physical days), compressed (3 physical days, merging logical days), turbo (1 physical day).
**Paper sections affected:**
- **Appendix B.1 Level Jackpot** (lines 4420-4440): Lines 4426-4434 directly describe the three modes. Check that the description correctly explains the merging of logical days rather than just doubling rates. The current text says "Day 1 runs normally. Days 2 and 3 each cover two logical days at double the draw rate." Verify this matches the contract's compressedJackpotFlag implementation.
- **Appendix C Stage Game** (lines 4667-4700): Lines 4671-4675 describe "3 or 5 days" and the compressed schedule. Check consistency with B.1.
- **Appendix A Parameter Summary** (lines 4400-4404): Lists "3-5 daily" jackpots per level with the note "(3 if purchase phase < 3 days)." Verify the threshold condition matches B.1 (which says "purchase phase <= 2 days" for compressed, "<= 1 day" for turbo).
**Severity if wrong:** MEDIUM. Would affect understanding of jackpot distribution timing but does not change the total amount distributed per level.

#### Pitfall 11: Distress bonus is proportional
**What goes wrong:** Paper might state that all tickets get the 25% bonus during distress, when only the fraction of tickets bought during the distress window (final 6 hours before GAMEOVER) receive the bonus.
**Paper sections affected:**
- **SS9.3 Terminal Paradox** (lines 4076-4088): Distress-mode lootboxes section. Lines 4076-4082 describe distress mode: "lootbox purchases switch to 100% nextpool allocation" and "any future-level tickets rolled receive a 25% bonus." Check that "any future-level tickets rolled" clearly means only tickets from distress-period purchases, not all existing tickets. Lines 4083-4085 clarify: "distress-mode lootboxes do not penalize early ticket buyers" and the mechanism is "purely additive." Verify this language is unambiguous.
- **SS9.2 Conditions for Protocol Failure** (lines 3789-3813): Death clock mechanics. Check whether distress mode is referenced here and whether the proportional nature is stated.
**Severity if wrong:** MEDIUM. Would overstate the attractiveness of early ticket purchases if readers think existing tickets also get the bonus. However, the paper's language appears to correctly scope the bonus to new purchases.

#### Pitfall 12: stETH has 1-2 wei rounding errors
**What goes wrong:** Paper might cite exact ETH amounts that should have a rounding caveat, or describe stETH conversions as lossless.
**Paper sections affected:**
- **SS4.1 Accounting Solvency** (lines 2865-2905): Solvency invariant discussion includes yield routing. Lines 2903-2904 state "Staking ETH to stETH is a conversion between two assets that both count toward total balance, so it has no effect on solvency." This is correct at the macro level but ignores wei-level rounding. Verify whether this simplification is acceptable for the paper's level of abstraction.
- **Appendix C Yield Accrual** (lines 4602-4616): Formal yield equations. The continuous-time equation dP/dt = r * S ignores discrete rounding. At the paper's level of abstraction this is appropriate, but verify no worked example requires wei-level precision.
**Severity if wrong:** LOW. Rounding errors are at wei scale (fractions of a cent) and are unlikely to appear in the paper's prose or worked examples. The paper operates at ETH-level precision where rounding is irrelevant.

---

## Paper Structure Map

### Counting Methodology

- Count rendered prose content, not HTML/CSS/SVG markup
- Tables: count per cell (each verifiable value is a separate numerical claim)
- LaTeX formulas: mechanism claim if definitional, worked example if plugging in numbers
- Cross-references to numbers stated elsewhere still count as numerical claims at the point of citation
- Formal blocks (propositions, definitions, corollaries, design properties) are audited with same rigor as prose

### Section-by-Section Density

| Section | Subsection | Lines | Num | Mech | Ex | Notes |
|---------|------------|-------|-----|------|----|-------|
| **1. Introduction** | | 535-2187 | 12 | 7 | 0 | ~1400 lines are CSS/SVG for interactive ticket demo. Prose content: stETH 2.5%, rake ranges (40-60%, 2-15%), 120/365 day timeouts, 120 ETH purchase target, 0.01 ETH ticket, pool splits, 50 ETH bootstrap. Mechanism: pool flow, VRF traits, jackpot structure, terminal distribution overview. No worked examples. |
| **2. Cross-Subsidy** | 2.1 Heterogeneous Reward | 2189-2248 | 2 | 1 | 0 | Player type taxonomy table (6 rows, descriptive not numerical). Minimal verifiable numbers. |
| | 2.2 Non-Monetary Utility | 2249-2275 | 2 | 1 | 0 | BURNIE price ratchet reference, affiliate engagement references. Light. |
| | 2.3 Cross-Subsidy Mechanism | 2276-2428 | 11 | 5 | 0 | Cross-subsidy flow table (11 rows). Activity score range 0-3.05, breakeven 0.60, cap 1.35x, 0.80x floor. Lootbox EV range. 90/10 and 10/90 pool splits. Observation 2.1, 2.2. |
| | 2.4 Structural Barriers | 2429-2495 | 6 | 3 | 0 | Variance/complexity/illiquidity/moral hazard discussion. Activity score references, EV curves. |
| | 2.5 Entertainment Mechanics | 2496-2542 | 4 | 4 | 0 | BAF mechanics (10-level cycle, 10% futurepool), nudge cost (100 BURNIE, 1.5x scaling), shared multiplier (50-150%). Commitment device references. |
| | 2.6 Poker Ecosystem Analogy | 2543-2576 | 3 | 1 | 0 | Affiliate commission (20-25%), rakeback comparison (50-70%). Mostly argumentative. |
| **3. Player Types** | 3.1 The Degen | 2642-2673 | 4 | 2 | 0 | Degenerette ROI 0.90x at activity 0, 0.01 ETH loss, day-5 ticket behavior, 100% final payout. |
| | 3.2 The Grinder | 2674-2703 | 5 | 3 | 0 | Lootbox EV cap a=2.55, 1.35x max, self-limiting argument. Best-response Observation 3.1. |
| | 3.3 The Hybrid | 2704-2721 | 1 | 1 | 0 | Breakeven clustering concept. Very light on verifiable claims. |
| | 3.4 The Whale | 2722-2776 | 8 | 5 | 0 | Whale bundle 2.4/4 ETH, deity 24+T(k) ETH, 32 cap, +80% activity, 2% bucket entries (min 2), 30/70 and 5/95 pool splits, 10% BAF futurepool (20% milestone), leaderboard splits (10%/5%/5%), 75/25 ETH/pass payout split, 20% affiliate bonus (5 ETH cap), deity transfer 5 ETH. |
| | 3.5 The Affiliate | 2777-2814 | 8 | 4 | 0 | Commission 20-25%, FLIP 50/50 coinflip, 10% day-5 bonus, 3-tier (75/20/5), lootbox taper (25-100% on 10K-25.5K), DGNRS 35% affiliate pool, 1% top affiliate bonus, 5 ETH deity affiliate cap. |
| | 3.6 Budget Constraints | 2815-2858 | 4 | 2 | 0 | Activity score starting floors: 0.85 lazy, 1.15 whale, 1.55 deity. Observations 3.4, 3.5. Corollary 3.1. |
| **4. Mechanism Design** | 4.1 Accounting Solvency | 2865-2905 | 5 | 8 | 0 | Proposition 4.1. Five logical pools. Yield routing 50/25/25. Insurance skim 1%. State transitions for deposit, jackpot, claim, yield. **Mechanism-dense.** |
| | 4.2 Zero-Rake Property | 2906-2960 | 9 | 4 | 0 | Presale 20% of 200 ETH = 40 ETH max, DGNRS 20%, vault 25% yield, stETH 50/25/25, insurance 1%. Definition 4.2, Observation 4.3, Corollary 4.4 with formula. |
| | 4.3 Permissionless Execution | 2961-2976 | 5 | 3 | 0 | BURNIE bounty ~0.01 ETH, 2x/3x escalation, 30-min/15-min fallback, purchase requirement. |
| **5. Equilibrium** | 5.1 Active Participation | 2986-3016 | 2 | 3 | 0 | Observation 5.1. Deviation analysis per type. Mostly argumentative. |
| | 5.2 Inactive Equilibrium | 3017-3051 | 5 | 4 | 0 | BURNIE 24x appreciation, 0.01 ETH at L0, 0.04 at L10, 0.24 at century, 20 ETH deity refund. Bootstrap sequence. Observation 5.2. |
| | 5.3 Budget Constraints | 3052-3069 | 1 | 1 | 0 | EV floor argument. Very light. |
| | 5.4 Repeated Game | 3070-3086 | 2 | 2 | 0 | 120-day timeout, 90% terminal payout reference. Folk theorem structure. |
| | 5.5 Commitment Devices | 3087-3164 | 10 | 7 | 0 | Future tickets k in [0,50], streak min(q,100)%, 130%/145% auto-rebuy, 75%/25% large-win split, 9 ETH threshold, 50% lootbox BAF split, 5 ETH deity transfer, Observations 5.3, 5.4. |
| **6. BURNIE Economics** | 6.1 Price Ratchet | 3167-3253 | 18 | 3 | 0 | **Number-dense.** Full pricing table (7 level ranges x columns: ETH price, entries, BURNIE per entry, BURNIE ticket price). 6x within-cycle appreciation. 24x L0 to century. 1000 BURNIE/ticket. |
| | 6.2 Decimator | 3254-3270 | 6 | 4 | 0 | 10%/30% futurepool, bucket 5/12, ~1.783x weight, 200K BURNIE cap. |
| | 6.3 100-Level Cycle | 3271-3290 | 4 | 3 | 0 | Price reset 0.04 ETH, century crescendo 20%+30%, BAF leaderboard reset. |
| **7. Robustness** | 7.1 Coordination-Free | 3294-3309 | 1 | 2 | 0 | VRF trait assignment, affiliate coordination. Mostly argumentative. |
| | 7.2 Griefer Analysis | 3310-3362 | 5 | 6 | 0 | 120 days, 3-day stall, 50.1% vault ownership, VRF recovery mechanics, admin power limits. |
| **8. Failure Modes** | 8.1 Death Spiral Definition | 3364-3370 | 0 | 1 | 0 | Definition 8.1 only. |
| | 8.2 Death Spiral Resistance | 3371-3582 | 10 | 7 | 1 | Observation 8.1. Four resistance mechanisms. 50% yield to accumulator, 1% skim. Monte Carlo (30 levels). Futurepool extraction U-shape reference. The worked example is a partial calculation of pool concentration effects. |
| | 8.3 Whale Departure | 3583-3612 | 3 | 2 | 0 | Effect A vs B argument. Pool share arithmetic. Time-value discount formula. |
| | 8.4 BURNIE Price Floor | 3613-3656 | 7 | 4 | 0 | Observation 8.3. Floor formula p(l)/900. Entry parity p(l)/1000. 6x within-cycle rise. Decimator as second floor. |
| **9. Stress Tests** | 9.1 Bear Market | 3661-3788 | 18 | 7 | 2 | **High density.** Futurepool drip 1%/day, 15% dump, ~60% transfer over 120 days, 1.5x ratio, ~35 players x 0.08 ETH, 8-month runway. Six defense mechanisms. Five conjunctive requirements. Two worked examples: (1) autopilot runway calculation, (2) 35-player gap-closing calculation. |
| | 9.2 Conditions for Failure | 3789-3813 | 3 | 2 | 0 | Design Property 8.4 with death clock formula (365/120 days). Terminal growth problem. |
| | 9.3 Terminal Paradox | 3814-4090 | 32 | 8 | 3 | **Highest density section. KNOWN PRE-DRAWDOWN ERROR in drip math. HIGHEST PRIORITY for Phase 2.** Terminal distribution rules (20 ETH refund, 10%/90% split, 60/40 winner split, 30-day sweep). Worked example at L50: 800 ETH pool, 280 ETH starting nextpool (120+160), 4,000 starting tickets, 1%/day extraction, 239 ETH residual, 421 ETH drip, 701 ETH nextpool, 2,631 drip tickets, 6,631 total, 99 ETH gap, 1,375 tickets to close, 134 ETH accumulator (9 yield + 125 insurance), 967 ETH terminal jackpot, 0.146 ETH/ticket, 1.8x ratio. Day-1 EV formula. Late-buyer EV formula. 38% P(GAMEOVER) threshold. Survival jackpot: 50% extraction, 400 ETH, 0.040 ETH/ticket, 8,006 tickets. Drip: 0.035 ETH, 1.66 tickets. Skim-drip table (3 rows x 3 columns). Distress mode. |
| **10. Growth Scenario** | | 4092-4157 | 6 | 2 | 0 | Powerball reference ($1.5B, $1.3B weekly, 13x, $20M baseline). Ratchet mechanics. Mostly argumentative. |
| **11. Conclusion** | 11.1 Limitations | 4160-4201 | 4 | 3 | 0 | Smart contract risk, stETH dependency, 30-level Monte Carlo, 0.01 ETH at L0, 24x BURNIE. |
| | 11.2 Resilience Thesis | 4202-4260 | 2 | 2 | 0 | Observable metrics list. Summary prose. |
| **Appendix A** | Parameter Summary | 4262-4419 | 24 | 2 | 0 | **Pure parameter table.** 20+ rows: stETH 2.5%, activity [0,3.05], lootbox [0.80,1.35], degenerette [0.90,0.999], 10 ETH/level cap, 10% futurepool degen cap, coinflip 0.50/1.9685x/1.575%, affiliate 0.20-0.25, ticket 0.01-0.24, whale 2.4-4, deity 24+T(n)/32 cap, 365/120 days, 18h VRF, 3-day stall, 300 BURNIE quest, 50 ETH bootstrap, 10-level BAF, 3-5 jackpots, 60% scatter, 30%/45% auto-rebuy. |
| **Appendix B** | B.1 Level Jackpot | 4420-4440 | 8 | 4 | 0 | 5/3/1-day modes, 6-14% daily slice, day 5 = 100%, 20% ticket conversion, trait-bucket shares (20%/60%/13.3%). |
| | B.2 Purchase-Phase Jackpot | 4441-4456 | 7 | 4 | 0 | 1%/day futurepool, 75%/25% split, 50% ticket conversion, 200% backing, 3% earlybird, BURNIE draw mechanics. |
| | B.3 BAF | 4457-4483 | 10 | 4 | 0 | 10%/20% futurepool, internal splits (10/5/5/5+5/45+25%), scatter sources by type (normal/century/terminal). |
| | B.4 Decimator | 4484-4498 | 7 | 3 | 0 | 10%/30%, 1.783x max weight, bucket 5/2, 1000 BURNIE min, 200K cap. Century decimator details. |
| **Appendix C** | Key Parameters | 4499-4542 | 6 | 2 | 0 | Folk theorem note. Lootbox EV at 3 activity levels table (3 rows). |
| | Model/Notation | 4543-4578 | 4 | 3 | 0 | Decimator trigger schedule table (2 rows). Ticket pricing reference. Bucket defaults (12/5/2). |
| | Prize Pool Dynamics | 4580-4616 | 6 | 6 | 0 | Accumulation formulas (90/10, 10/90). Level transition function. Yield accrual continuous formula. Deposit insurance 1%. Century milestone 50/50 distribution. Extraction U-shape (3%/20%+/50% at different durations). |
| | Ticket Pricing | 4617-4622 | 1 | 1 | 0 | Back-reference to SS6.1 table. |
| | Activity Score + EV | 4623-4657 | 8 | 5 | 0 | Activity score formula with 5 components and coefficients. Piecewise lootbox EV function (3 cases with thresholds). Degenerette ROI piecewise. Breakeven 0.60, cap 2.55/1.35x. Additional lootbox value discussion. |
| | Boons | 4658-4664 | 1 | 2 | 0 | Boon types, deity grants (3/day). Non-transferable. |
| | Protocol Architecture | 4665-4700 | 3 | 5 | 0 | Stage game structure. Jackpot phase 3/5 days. Compressed schedule. Draw percentages (6-14%, 100%). Ticket timing EV discussion. |
| | Trait Assignment | 4701-4735 | 1 | 3 | 0 | 256 traits (4x64). VRF-deterministic. Hero symbol override. |
| | Liveness Guarantee | 4736-4758 | 3 | 5 | 0 | Design Property. Five liveness mechanisms. 18h VRF retry, 3-day recovery, GAMEOVER terminal. |
| | DGNRS Token | 4760-4793 | 8 | 6 | 0 | Pool percentages (20/10/35/20/5/10). Five distribution sources with specifics. sDGNRS soulbound mechanics. afKing mode (10 ETH takeProfit). Burn-for-backing mechanics. |
| **Appendix D** | Attack Vectors | 4795-4848 | 9 | 7 | 0 | 5 attack analyses. Sybil: 10 ETH/level cap. Degenerette: 10% futurepool cap. Affiliate: 0.5 ETH/level cap, 25% taper. stETH depeg: 0.93:1. Death-bet: 90%/10% terminal split. |
| **Appendix E** | Bear Market Formal | 4849-5086 | 10 | 5 | 2 | Fixed-point equations. Payoff formula. Stability analysis. Threshold conditions. BURNIE dilution scenario. Path-dependent dynamics. Repeated stall erosion. Grinder pivot: 1.07-1.25x lootbox range, 1.35x max, 4% P(GO) threshold. Two worked examples: (1) fixed-point payoff calculation, (2) grinder ticket-vs-lootbox comparison during stall. |
| **Appendix F** | Misreadings (F.1-F.28) | 5087-6016 | 14 | 8 | 0 | 28 entries. Key numbers re-cited: F.1: 40 ETH max presale, 200 ETH lootbox cap. F.2: 2.5% yield. F.10: 1.8x terminal ratio. F.11: 75/20/5 affiliate tiers. F.6: 75/25 large-win split, 5 ETH deity transfer. F.22: breakeven 0.60. F.25: 1.5x futurepool, 60% mechanical transfer. Most entries re-state numbers from earlier sections. |

### Density Summary by Phase Cluster

| Cluster | Sections | Total Num | Total Mech | Total Ex | Assigned Phase |
|---------|----------|-----------|------------|----------|----------------|
| Number-Heavy | SS6 (28), SS8 (20), SS9 (53), App A (24), App B (32), App C (41), App E (10) | 208 | 63 | 8 | Phase 2 |
| Mechanism-Heavy | SS4 (19), SS5 (20), App D (9) | 48 | 36 | 0 | Phase 3 |
| Prose/Framing | SS1 (12), SS2 (28), SS3 (30), SS7 (6), SS10 (6), SS11 (6), App F (14) | 102 | 42 | 0 | Phase 4 |
| **Totals** | | **358** | **141** | **8** | |

### Phase 2-4 Assignment Validation

**Phase 2: Number-Heavy Sections (SS6, SS8, SS9, App A/B/C/E)** -- **CONFIRMED**

Phase 2 contains 208 numerical claims, 63 mechanism claims, and all 8 worked examples. This is approximately 2.5x the numerical density of Phase 4 and 4x that of Phase 3. The roadmap assigns 3 plans to Phase 2, partially compensating for this load. The highest-priority item is SS9.3 (32 numerical claims, 3 worked examples, known pre-drawdown error). Appendix C sits correctly in Phase 2: it contains the formal parameter tables and EV formulas that must be verified against the parameter reference, even though its mechanism descriptions overlap with Phase 3's territory. Phase 2 auditors should verify the formulas against contract source; Phase 3 auditors will verify the prose mechanism descriptions independently.

**Phase 3: Mechanism-Heavy Sections (SS4, SS5, App D)** -- **CONFIRMED**

Phase 3 contains 48 numerical claims and 36 mechanism claims. The mechanism-to-numerical ratio is highest here (0.75), confirming this is the mechanism-focused cluster. SS4 has the densest mechanism content (Proposition 4.1, pool architecture, yield routing, solvency invariant). SS5 is more argumentative but includes commitment device mechanics with verifiable parameters. Appendix D is compact (5 attacks) but each requires mechanism verification. Two plans is appropriate: one for SS4 (mechanism design properties), one for SS5 + App D (equilibrium and attacks).

**Phase 4: Prose and Framing Sections (SS1-SS3, SS7, SS10-SS11, App F)** -- **CONFIRMED**

Phase 4 contains 102 numerical claims and 42 mechanism claims. While the absolute numerical count is substantial, these are predominantly cross-references to numbers defined in Phase 2/3 sections (the Introduction cites stETH 2.5%, pool splits, and timeouts that are formally defined in Appendix A/C). Phase 4's primary audit task is confirming these cross-references match their source, not independently verifying against contracts. Appendix F has 28 entries that re-cite numbers from the main paper. Two plans is appropriate: one for the denser sections (SS1-SS3 with the cross-subsidy table and player type numbers), one for the lighter sections (SS7, SS10-SS11, App F).

**No section reassignment is needed.** The density data confirms the roadmap assignments. Phase 2's 3-plan allocation partially compensates for its 2-4x higher claim density compared to Phases 3-4.

### High-Priority Verification Targets

The following numbers are most load-bearing for the paper's arguments. Phase 2 auditors should prioritize these.

1. **2,631 drip tickets** (SS9.3, line ~3883): Derived from 120 daily extractions of 1% futurepool at 50% ticket conversion with 2x backing. Verify against contract's `<<2` entry conversion logic. KNOWN PRE-DRAWDOWN ERROR: the worked example may calculate futurepool drip amounts without properly accounting for the drawdown at level transition. Phase 2 must confirm.
2. **0.146 ETH/ticket terminal payout** (SS9.3, line ~3890): Derived from 967 ETH / 6,631 tickets. Verify the 967 ETH figure (90% of ~1,074 non-obligated assets) and ticket count.
3. **38% P(GAMEOVER) threshold** (SS9.3, line ~3929): Derived from late-buyer EV formula 0.106*P(GO) - 0.040 = 0. Check the formula components.
4. **1.66 ticket growth over 120 days** (SS9.3, line ~3908): Drip tickets distributed proportionally to existing holders. Verify the compounding math.
5. **~60% futurepool to nextpool over 120 days** (SS9.1, line ~3687): 15% dump + ticket conversion + 120 x 1% drip. Verify the combined percentage accounting for exponential decay of the 1% daily extraction.
6. **0.040 ETH survival jackpot per ticket** (SS9.3, line ~3905): 0.80 x 400 / ~8,006. Verify the 80% distribution, the 400 ETH (50% extraction of 800), and the 8,006 ticket count.
7. **1.9685x coinflip win payout** (App A, line ~4325): Average payout across all win tiers. Verify against v1.1-burnie-coinflip.md payout tier structure.
8. **1.783x decimator burn weight at max activity** (App B.4, line ~4487): Verify against v1.1-transition-jackpots.md and activity score formula in contract.
9. **Activity score formula coefficients** (App C, line ~4626): Five components with specific weights (0.50, 0.25, 1.00, 0.50, gamma). Verify each coefficient against contract source.
10. **Lootbox EV piecewise function** (App C, line ~4636): Three cases with thresholds (0.60, 2.55) and slopes. Verify breakpoints and slopes against v1.1-endgame-and-activity.md.
11. **DGNRS pool percentages** (App C, line ~4766): 20/10/35/20/5/10 across creator/whale/affiliate/lootbox/reward/earlybird. Verify against v1.1-dgnrs-tokenomics.md.
12. **BURNIE pricing table** (SS6.1, lines ~3167-3253): 7 level ranges with ETH prices, entries per ticket, BURNIE equivalents. Verify against v1.1-level-progression.md price curve.
13. **Terminal distribution splits** (SS9.3, lines 3817-3829): 20 ETH/pass refund (L0-9 only), 10% decimator, 90% jackpot, 60/40 winner split, 30-day sweep. Verify against v1.1-endgame-and-activity.md terminal mechanics.
14. **Futurepool extraction U-shape** (App C, line ~4599): ~3% at 14-day sweet spot, ~20%+ at extremes (fast/slow). Verify the shape and specific percentages against contract extraction function.
