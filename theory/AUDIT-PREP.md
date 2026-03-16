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
