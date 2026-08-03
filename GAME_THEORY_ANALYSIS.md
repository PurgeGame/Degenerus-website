# Why This Game Doesn't Die: A Game-Theoretic Analysis of Degenerus Protocol

*Burnie Degenerus*

**Working Paper, Draft for Review**

---

## Abstract

Different player types in Degenerus Protocol pursue different rewards and, in doing so, generate positive externalities for each other. Entertainment seekers fund prize pools through lootbox and Degenerette purchases. Strategic players optimize engagement to extract monetary value. Whales inject capital through passes and earn compounding returns. Affiliates recruit players for commission income. This cross-subsidy structure, combined with commitment devices (future tickets, streaks, afKing subscriptions) and a prize pool that can only grow, creates structural resistance to death spirals. The protocol is zero-rake: player deposits are locked, converted to stETH (~2.5% APR yield), and redistributed as prizes. No outside entity extracts an ongoing percentage. This paper formalizes these dynamics, characterizes equilibria, and identifies the conditions under which the system's resilience holds.

---

## 1. Introduction

Traditional gambling systems operate under a well-understood extractive model: the operator takes a large cut of every dollar wagered (40-60% in state lotteries, 2-15% in casinos), and players accept deeply negative expected value in exchange for entertainment and variance. This model is sustainable but adversarial: the operator profits from player losses, creating a negative-sum dynamic for participants.

Degenerus Protocol proposes a structural alternative: a *zero-rake* gaming system where no outside entity extracts value from player deposits. Deposits are locked, converted to Lido staked ETH (stETH), and redistributed entirely as prizes to other players. The stETH earns approximately 2.5% annual yield, which is the only external value entering the system. Prizes are funded primarily by other players' deposits, with yield providing a small positive-sum margin. This architectural choice transforms the underlying game from negative-sum to slightly positive-sum for the player pool as a whole, introducing fundamentally different strategic dynamics.

This paper analyzes these dynamics. We are interested in three central questions:

1. **Dominant strategies and stability.** Does the game possess dominant strategies? Are they stable under perturbation? What strategy profiles constitute equilibria?

2. **Incentive alignment.** Does the mechanism design ensure that individually rational behavior by each player type strengthens rather than weakens the system? Under what conditions might incentives become misaligned?

3. **Robustness and resilience.** How does the system withstand adversarial behavior, coordinated attacks, player exodus, and extreme market conditions? What structural properties make it resistant to death spirals?

Before diving into formalism, here is the paper's central argument in plain language: **Degenerus Protocol works because different types of players want different things, and getting what they want individually produces collective goods.** Entertainment seekers buy lottery tickets and lootboxes for the thrill, funding the prize pools in the process. Strategic players optimize their engagement to extract monetary value from those pools. Whales lock large capital into passes that only pay out over time, publicly demonstrating long-term commitment to the system in exchange for compounding returns. Affiliates recruit and retain players, growing the participant base for commission income. Each group's self-interest produces something the others need: degens fund the pools, strategists drive progression, whales stabilize capital, and affiliates grow the player base. The yield from stETH injects external value that makes the whole system positive-sum. And the commitment devices (future tickets, quest streaks, afKing subscriptions) create a ratchet that makes continued participation the dominant strategy for anyone already engaged.

That is the thesis. The rest of this paper formalizes it, stress-tests it, and maps its limitations.

**Try it yourself.** The demo below shows four consecutive daily jackpot draws. Click "Next Day" to cycle through scenarios. Each day, four random traits are drawn and lock into a 4-quadrant grid. If you hold tickets matching those traits, scratch to reveal your prizes (ETH, future tickets, or FLIP). Click the center flame to skip the animation. This is a beta mockup for illustration only; the final UX will differ.

<!-- JACKPOT_WIDGET -->

The scenarios above illustrate *what happens*. The rest of this paper explains *why this structure is stable*.

**The critical assumption.** State lotteries and memecoins prove that people pay for gambling entertainment at massive scale, even with terrible odds. Degenerus offers this audience verifiably fair odds, 0% rake, and the possibility of positive EV through engagement. The affiliate program (Section 3.4) can bring players to the door, but it cannot make them stay if the product is not fun. Whether *this specific product* captures enough of that demand is an empirical question. The analysis that follows takes the entertainment condition as given: enough people find the game entertaining enough to play. That condition strengthens as jackpot sizes grow, since larger prizes make the game more attractive to exactly the entertainment-seeking players who sustain it.

**A note on source of returns.** The surface similarities to a memecoin launch are real: degens chasing excitement, whales deploying capital, early participants with structural advantages, a creator holding a token allocation. But the source of returns is fundamentally different. A shitcoin's returns come from later buyers' capital; when the music stops, late entrants hold worthless tokens. Degenerus Protocol's returns come from stETH yield (external, real, perpetual) and from the voluntary spending of entertainment-seeking players getting a product they value. The prize pool cannot decrease. There is no rug to pull because funds are locked in a contract with no admin withdrawal function (the admin's only power is proposing an emergency VRF coordinator swap after a 44-hour stall, subject to sDGNRS holder approval; see Section 7.3). Players who end up net negative lost to math and luck, not to fraud. The protocol does need ongoing deposits to keep advancing levels, and without them the game eventually ends. But the failure mode is fundamentally different: a shitcoin that stops growing leaves latecomers holding worthless tokens with no recourse. A Degenerus game that stops growing triggers a terminal distribution where all remaining funds are redistributed to participants through one last round of fair, high-variance jackpots (Section 8.7). Players may lose money, but they are never rugged. Section 9 explores these comparisons in detail.

---

## 2. The Core Idea: Cross-Subsidy Structure

**Definition 2.0 (The Entry).** *One entry is one-quarter of a ticket: the atomic unit of participation, representing a single jackpot draw for the upcoming level. Its face-value cost is $P_\ell / 4$ ETH or 250 FLIP. The FLIP price is fixed permanently regardless of level progression; as ETH ticket prices escalate, FLIP's ETH-equivalent entry cost rises monotonically (Section 6.1). FLIP credit settles into FLIP tokens through the daily coinflip at approximately face value (~98.4% EV) and is treated as equivalent throughout.*

*An EV multiplier of $\mu$ means $\mu$ entries of expected value returned per face-value entry of ETH spent. The baseline is one entry purchased with no rebates, no activity score bonus, and no lootbox multiplier. FLIP rebates are valued at 250 FLIP = 1 entry — a floor; FLIP deployed toward higher-value uses than tickets returns more.*

*Entry acquisition rates for common purchase strategies:*

| Strategy | EV multiplier |
|---|---|
| FLIP ticket | 1.00 |
| New ETH ticket | 1.10 |
| Recycled winnings, partial reinvestment | 1.20 |
| Recycled winnings, full reinvestment | 1.30 |
| Lootbox, zero activity score | ~0.90 |
| Lootbox, breakeven activity score | ~1.00 |
| Lootbox, high activity score | ~1.40 |
| Lootbox, high activity + full reinvestment | ~1.50 |

*Lootbox rates reflect ticket EV at the stated activity levels. Additional EV sources (DGNRS rewards, deity boons) are not included. ETH ticket purchases include FLIP rebates: 100 per ticket, plus 100 more per recycled ticket when a buy recycles at least three tickets' worth of winnings, plus 100 more per ticket on buys of ten or more.*

### 2.1 Heterogeneous Reward Structures

A critical departure from standard mechanism design: player types in this system optimize for *fundamentally different reward currencies*. Traditional game-theoretic analysis assumes a common utility denominator (typically money). In Degenerus Protocol, this assumption fails, and its failure is the engine of the system's sustainability.

Each player's utility is a mix of two components: **monetary payoff** ($M$, net ETH. All other protocol assets are ultimately claims on future ETH) and **non-monetary payoff** ($\Psi$, primarily gambling entertainment: excitement, variance preference, near-miss dopamine, with secondary contributions from status, narrative participation, and community standing). Different player types weight these differently:

| Type | Monetary | Non-monetary | Primary Reward Currency |
|------|----------|--------------|------------------------|
| Degen | Low | **High** | Dopamine, excitement, the rush |
| EV Maximizer | **High** | Low | ETH returns |
| Hybrid | Medium | **Medium** | Thinks ETH returns, actually the rush |
| Whale | High | Varies | Status + returns |
| Affiliate | **High** | Low | Commission income |
| Griefer | Low | **High** | Protocol destruction |

Each type is rational *within their own weighting*: a degen who loses 0.01 ETH but gets a rush worth more than 0.01 ETH to them has made a rational decision. The Griefer is addressed in the robustness analysis (Sections 7–8).

### 2.2 Non-Monetary Utility

The critical assumption (Section 1) established that the system depends on entertainment value. Here we note what contributes to it. The primary source is gambling entertainment: lootbox anticipation, jackpot draws, near-miss excitement, Degenerette variance. The protocol also provides FLIP, a token with a structural price ratchet (Section 6.1) that gives participants the "number go up" experience that drives memecoin engagement, backed by actual utility rather than hype. Status, narrative participation, community belonging, and the satisfaction of contributing to meaningful collective goals provide additional $\Psi$ for whales and engaged players. These are real but secondary.

### 2.3 The Cross-Subsidy Mechanism

The heterogeneous utility structure creates what we term a **cross-subsidy structure**: each actor type's pursuit of their primary reward currency generates positive externalities in a different reward dimension that benefits other types.

**Definition 2.1** (Cross-Subsidy Structure). *A system has cross-subsidy structure when each player type, by doing what is best for themselves, produces something valuable for the other types as a side effect.*

The flow table below describes the cross-subsidy structure under the assumption that each type plays their type-optimal strategy (characterized in Section 3). Section 5.1 verifies that the engagement level in these strategies is dominant: no player type benefits from unilaterally reducing engagement, regardless of what other players do.

Degenerus Protocol exhibits the following cross-subsidy flows:

| Action | Actor Gets | Who Else Benefits |
|--------|------------|-------------------|
| Degenerette (ETH) | $\Psi$ (thrill) | **Grinders:** deeper extraction pool. **Everyone:** ETH added to future prize pools. |
| Degenerette (FLIP) | $\Psi$ (thrill) | **FLIP holders:** deflationary pressure raises the price floor. |
| Lootbox (below breakeven) | $\Psi$ (surprise) | **Grinders:** the lost margin is the surplus that funds their +EV extraction. |
| Lootbox (above breakeven) | $M$ (+EV return) | **All current ticket holders:** grinder lootbox volume flows 90% to the futurepool, whose dominant outflows (daily drip, jackpot conversions, the terminal pool) pay ticket holders regardless of activity score, and degens are ticket buyers. Their daily deposits maintain level velocity even when degen activity fluctuates. |
| Foil pack | $\Psi$ (boosted reveal) + deferred $M$ | **All ticket holders:** an activity-gated product whose volume splits 75/25 across nextpool and futurepool, feeding both, while its graded match tiers redistribute like a steeper lootbox. |
| Ticket purchase | $\Psi$ (jackpot entry) | **All pool participants:** the primary mechanism filling the current level's prize pool target. **Grinders:** the optimal strategy at normal velocity rejects ticket purchases, so sub-optimal ticket buying fills the prize pool grinders extract from via lootboxes. |
| Score maintenance | Deferred $M$ (higher EV) | **Affiliates:** active high-scorers generate more commissions per referral. |
| Deity pass | $\Psi$ (status) + deferred $M$ | **Everyone:** 24+ ETH injected into pools at once; fastest single lever for pool growth. |
| BAF leaderboard | $\Psi$ (competition) + $M$ | **FLIP holders:** heavy coinflip volume burns supply, supporting the price floor. |
| Affiliate referral | Deferred $M$ (commissions) | **Everyone:** each recruited player adds ETH deposits to all shared pools. |
| Daily coinflip | $\Psi$ (ritual) + deferred $M$ | **FLIP holders:** sustained daily burn compounds deflationary pressure. |
| Quest streak | Deferred $M$ (score growth) | **Everyone:** consistent daily volume anchors level progression for all pool participants. |
| Deity boon | $\Psi$ (patronage, social capital) | **Boon recipients:** discounted purchases and special benefits granted directly by the deity. Non-transferable and capped at 3/day — deity status becomes a social role with real dealmaking power that no automated mechanism produces. |

**A concrete example.** Player A (a degen) spends 0.1 ETH on a Degenerette spin at zero activity score. At the protocol's configured 90% ROI for that activity level — 0.90x multiplier — they lose 0.01 ETH in expectation. That 0.01 ETH flows into the prize pool system. They receive entertainment in return: the 8-trait match resolution, the near-miss excitement, the 100,000x jackpot dream. Player B (an EV maximizer) has built a high activity score through a sustained quest streak and opens a 1 ETH lootbox. The protocol applies a ~1.40x multiplier, so B's nominal expected value is ~1.40 ETH from the pool (much of it as future tickets and tokens that pay out over time, not immediately). Whether B actually realizes this fully depends on pool composition (see aggregate constraint below). Player A got entertainment. Player B got profit. Neither depleted the other's reward: Player A's thrill is undiminished by Player B's extraction, and Player B's monetary return is funded by the prize pool (which Player A's spin helped fill), not by Player A's wallet directly. The system is not creating value from nothing. B's surplus comes from the aggregate pool, which is funded by deposits from players like A (plus stETH yield). If fewer A-type players deposit, B's pool shrinks accordingly.

**The aggregate constraint.** Each player has an **activity score** that starts at 0 (new) and climbs with engagement, computed from purchase consistency, quest streaks, affiliate activity, and pass bonuses (formula in Appendix C). The quest-streak component is uncapped; the reward curves saturate at an effective score of 300. The score determines EV multipliers across all products: lootbox purchases range from 0.90x at zero activity (below face value) to ~1.40x at a score of 4.00 (above face value, reachable only through a sustained quest streak; the curve delivers nearly all of its gain by that point and crawls to its 1.45x maximum at the effective cap). The ceiling multiplier is a protocol parameter, not a guaranteed realized return. What a player actually receives depends on pool composition. There is an equilibrium activity score at which lootboxes become +EV. In a world where every player is a GTO maximizer and the only system yield is stETH, this breakeven point would be close to the ceiling (since the only surplus is yield). The more non-GTO players in the system, the further down the breakeven point falls, and the more profitable things are for everyone in the +EV cohort. What matters is the ETH volume on each side of this line, not the number of players. A single whale buying 10 ETH of lootboxes at low activity contributes more surplus than ten players buying 0.1 ETH each.

The equilibrium self-corrects. If too many grinders extract above breakeven, the pool's surplus shrinks and realized returns decline. Some grinders leave (they are money-sensitive), which restores returns for those who remain. When a +EV player exits, their share of future profits is returned to the system, lowering the breakeven bar for everyone else. The equilibrium point shifts; the correcting dynamic does not fail, because exits always raise expected returns for those who stay, and the entertainment-seeking side is largely insensitive to the grinder population. A degen's lootbox is just as fun to open regardless of how many extractors are in the pool. Throughout this paper, specific EV figures (like the ~1.40x high-activity lootbox multiplier) refer to protocol multipliers at the stated activity levels. Realized returns are always equilibrium-dependent.

This is structurally different from casinos, where the house extracts from players. Here, there is no house, only a community of differently-motivated actors whose interactions produce mutual benefit. The cross-subsidy is *mutualistic*, not adversarial.

A critical pattern in the flow table above is temporal: **the system receives ETH now, while most player rewards are deferred and contingent on continued participation.** Deity pass value compounds over future levels, activity score EV advantages require daily upkeep, BAF positions pay out only at milestone levels, and affiliate commissions must still survive a coinflip. Players therefore pay upfront and realize value gradually. This is not exploitative (the deferred rewards are real and often substantial), but it creates a retention ratchet where the rational response to having invested is to keep playing and maximize realization. It also creates three distinct incentives for affiliate activity among invested players: commissions arrive as FLIP income, new deposits accelerate level progression (pulling forward the referrer's own future ticket and BAF payouts), and a third that is harder to price. Degenerus is simultaneously a ruthless competition and a cooperative project. Every player benefits when the level advances, and recruiting new players is the single highest-leverage action any individual can take toward that shared goal. Players who internalize this find affiliate activity self-motivating in a way no financial incentive can replicate. The protocol cannot manufacture that sense of shared mission, but it can be cultivated.

The competitive nature of Degenerus underlies everything without being socially front-and-center. Much of the competition is indirect: a fellow EV maximizer who misses a quest day and resets their streak benefits you, but you had no hand in it. At the same time, many incentives are fully aligned even between the most self-interested participants. A new player entering the pool is good for everyone. The communal goals carry weight precisely because of the competitive foundation beneath them. Pure cooperative projects, untethered from real stakes, do not sustain belief. Everyone winning forever with no losers is not a premise serious players entertain. Players recognize the artifice. When cooperation emerges from a system where everyone has genuine self-interest and real skin in the game, the alignment feels earned rather than engineered. Contributing to the collective goals in a tangible and public way, bringing in a new player, advancing the level, carries a satisfaction that sits outside the financial calculus entirely.

### 2.4 Non-Depletion of Cross-Subsidies

**Observation 2.1** (Non-Depletion of Cross-Subsidies). *In the cross-subsidy equilibrium, no actor type's extraction catastrophically depletes the reward supply for other types. Non-monetary rewards ($\Psi$) are mostly non-rivalrous (one player's excitement does not reduce another's), though positional goods (deity passes, BAF leaderboard) are rivalrous and bounded (32 passes, 10-level resets). Monetary rewards ($M$) are funded by external yield ($r \cdot S$) plus the zero-rake recycling of player deposits, but high-activity players' above-1.0 multipliers are funded by low-activity players' below-1.0 multipliers (see Section 2.3). If the ratio of high-activity extractors to low-activity donors shifts, the equilibrium adjusts as described above: more extractors means lower returns per extractor, not system failure. The ratio self-corrects because the money-sensitive side (grinders) adjusts while the money-insensitive side (degens) provides a stable base.*

### 2.5 Implications for the Analysis

The heterogeneous utility model has two important implications:

1. **The active participation equilibrium is more robust than monetary analysis alone suggests.** A degen has multiple ways to play at different EVs (lootboxes, Degenerette spins, ticket purchases, coinflips), all of which are monetarily negative at low activity scores. Under pure monetary utility, this violates individual rationality. But degens do not care about money. They care about excitement. The protocol is designed to maximize $\Psi$ delivery: lootbox rewards arrive as *more gambling products* (future tickets, FLIP for Degenerette, boons), so a single lootbox open produces a cascade of further gambling opportunities. This is double the entertainment per dollar compared to a casino, where winnings arrive as cash and the gambling is over. If the entertainment value exceeds the monetary loss, participation remains individually rational. The gambling industry proves this condition holds at population scale for products with far worse odds and far less entertaining reward structures.

2. **Player retention has a ratchet effect.** As engagement deepens (longer streaks, higher activity scores, more future tickets), the non-monetary switching cost ($\Delta\Psi$ from breaking streaks, abandoning progression, losing status) compounds on top of the monetary switching cost ($\Delta M$ from forfeiting future tickets and EV multipliers). The total switching cost (monetary + non-monetary) grows faster than either component alone.

### 2.6 The Poker Ecosystem Analogy

The player type ecosystem maps closely to poker. In poker, **recreational players** deposit money for entertainment and lose at varying rates. **Professional grinders** extract monetary value through disciplined play. **Competitive recreationals** genuinely enjoy the game but wouldn't play if winning weren't possible. Their entertainment *is* the competition: skill matters, outcomes have real stakes, and meaningful competition requires meaningful consequences. This is the broadest category: some lean toward gambling excitement, some toward competitive strategy or profit, some toward the social experience, and many enjoy all three at once.

The critical insight from poker: **the ecosystem is healthy when recreational players have a good time.** If the fish are miserable, they leave. If the fish leave, the grinders have no one to extract from. If the grinders leave, the games die. Poker ecosystems characteristically die by catering to grinders: rooms offer 50-70% kickback to high-volume pros, optimizing for volume over fun, and fun is the only reason recreational players show up. Taken to its logical conclusion, some sites tried eliminating rake entirely. They never gained traction. Fish do not choose rooms based on rake. They choose based on fun, brand recognition, and where their friends play. Removing rake attracted grinders but did nothing to attract fish, and without rake revenue there was no marketing budget to acquire fish through other channels. The result was a few tables of grinders playing each other near breakeven, where the worst grinders lose a little, notice immediately (because they are there for money), and leave, shrinking the pool until nobody is left. The lesson: rake is not inherently bad. What matters is where the money goes. Operator profit does nothing for the ecosystem. Player acquisition and retention do everything.

Degenerus Protocol solves both problems. It is zero-rake, but the player acquisition function that rake normally funds is built into the protocol. The affiliate program pays 20-25% commission on referred players' purchases, funded by FLIP mechanics rather than by skimming deposits. Affiliates extract value, but only in direct proportion to the new money they bring in. Every player is a potential recruiter with multiple financial incentives to grow the game. Rake-free poker had no way to pay for acquisition; Degenerus pays for it out of protocol mechanics that exist whether or not anyone is recruiting. And the protocol is structurally resistant to grinder takeover: every avenue for profit requires high variance (jackpots are lotteries, coinflips are 50/50, Degenerette spins are high-volatility), so the variance-minimizing nit that kills poker ecosystems has no viable strategy here. Variance filters that class out; the structural bound on extractive capital generally is formalized in Observation 9.1.

The cross-subsidy structure (Section 2.3) is the formal version of this dynamic: different player types, extracting different kinds of value, sustaining each other's presence at the table.

---

## 3. Player Types and Strategies

### 3.1 The Degen

The degen's utility is dominated by entertainment, not monetary returns.

**Dominant actions:** Degenerette spins, daily coinflip participation, lootbox opens regardless of activity score (the anticipation is the product), and irregular ticket purchases.

**Individual rationality check:** The degen participates when the entertainment value exceeds the monetary loss. For a degen spending 0.1 ETH on Degenerette at 90% ROI (activity score 0), the expected loss is 0.01 ETH (0.10 entry-equivalent). The required entertainment value is 0.01 ETH-equivalent, the price of a few seconds of genuine excitement. This threshold is trivially met (see Section 2.2).

Low-engagement degens are the *primary EV donors* to the system, but they are not victims. They are compensated in their preferred currency. Their acceptance of monetarily sub-optimal strategies creates the surplus that funds higher $M$ returns for engaged players.

**Important nuance:** Ticket purchases have the same EV for all player classes at any given time, but that EV is typically below the equilibrium return available through lootboxes at high activity scores. This means ticket purchases are themselves a source of cross-subsidy: EV maximizers avoid them (preferring lootboxes where their score multiplies returns), while degens buy them freely. The cross-subsidy also flows through lootboxes, Degenerette, and other activity-score-weighted products. The degen who buys lootboxes at a low activity score is donating surplus to the pool that high-score lootbox buyers extract from.

### 3.2 The EV Maximizer

The EV maximizer cares only about expected net payout. They are **bankroll-constrained**: unlike the whale, they do not have unlimited capital.

**Observation 3.1** (Best-Response Policy). *Under sufficient bankroll and a pool with enough low-activity depositors to fund the multipliers, a high-scoring EV maximizer's best-response policy is:*

1. *Buy a ticket every day* to maintain quest streak and purchase streak, the two largest activity score components
2. *Maximize activity score* $a_i$ toward the lootbox curve's knee at 4.00 (quest streak, purchase streak, affiliate engagement, pass bonus; the quest component is uncapped, so the knee is reachable through daily play alone. The curve delivers nearly all of its gain by 4.00 and crawls to 1.45x at the effective cap of 300; the Degenerette curve delivers nearly all of its gain by $a_i = 3.05$)
3. *Purchase ETH lootboxes at high activity score using full reinvestment* (protocol multiplier $\mu \approx 1.40$ plus the recycling rebate — ~1.50x total — with the EV benefit capped at 10 ETH per account per level)
4. *Place ETH Degenerette bets at high activity* (base ROI $\rho \approx 0.99$ at a 3.05 score, crawling to 0.999 at the cap, plus a +5% EV bonus on ETH bets concentrated in higher-match payouts, giving ~104% effective returns before accounting for lootbox delivery at up to ~1.40x)
5. *Play enough Degenerette to consume the full 10 ETH lootbox EV benefit* through Degenerette lootbox wins, maximizing the compounding EV advantage
6. *Subscribe to afKing* (pass-gated; auto-buys the daily ticket or lootbox so the quest streak never breaks, with an optional reinvest setting that scales the daily buy with accumulated winnings)
7. *Acquire deity pass early if bankroll permits* (sets the activity floor at 1.55, but 24+ ETH upfront)

*Argument.* Activity score $a_i$ is monotonically increasing in streak lengths and participation breadth. Higher $a_i$ increases $\mu(a_i)$ and $\rho(a_i)$, both of which increase the player's weight in prize distribution. At $a_i = 3.05$, Degenerette is genuinely positive EV for players who would buy lootboxes anyway (see Appendix C for the lootbox delivery mechanism). All of these returns draw from the same aggregate pool, so the strategy's profitability depends on sufficient pool inflows from other participants.

One subtlety on afKing: its purpose is streak preservation, not a bonus. The subscription makes the daily qualifying purchase automatically, so the quest streak (and the activity score built on it) survives inattention. Reinvestment of claimable winnings happens at face value with no bonus multiplier; the value of the subscription is that every downstream return depends on a score that daily play maintains.

### 3.3 The Whale

Whales can participate profitably on monetary returns alone. Status is an additional payoff for those who value it, not a requirement.

**High-payoff actions:** Early deity pass acquisition (quadratic pricing favors early buyers: cost = $24 + T(n)$ ETH where $T(n) = n(n+1)/2$, which simultaneously maximizes $\Psi$ via scarce status and $M$ via the 1.55 activity floor), whale pass purchases at early levels (100-level ticket bundles, 2.4-4 ETH), BAF leaderboard domination through large coinflip stakes, running a deity pass with an afKing subscription at full reinvest, and issuing deity boons to other players (up to 3/day). Boons provide discounted purchases and special benefits; they cannot be sold or transferred, only granted directly, so deity status produces social interaction and dealmaking rather than impersonal market transactions.

**Observation 3.2** (Whale Extraction Is Bounded). *Whale extraction is bounded by explicit per-mechanism caps (lootbox EV-benefit cap, Degenerette per-spin payout caps, and finite BAF slices). Extraction analysis should use mechanism-specific upper bounds rather than a single aggregate constant.*

**Deity pass EV clarification.** Deity passes receive virtual jackpot entries equal to 2% of their symbol's bucket size (minimum 2 entries per draw). Their share scales proportionally with ticket volume, so they cannot dominate jackpots as the game grows. Their EV advantage comes from three sources: the 1.55 activity floor (which non-deity players can match through other components at maximum engagement), perpetuity (deity entries are drawn automatically every level, forever, requiring no further purchases), and a 20% bonus on all affiliate commissions (capped at 5 ETH per level) paid at the end of each level. A deity holder who goes inactive still accumulates jackpot entries and FLIP draws indefinitely. The affiliate bonus compounds the value of referral networks for deity holders, adding a revenue stream that scales with the game's growth. The 32-pass cap limits concentration.

### 3.4 The Affiliate

Affiliates earn 20–25% commission on referred players' ETH purchases, paid as FLIP credits that must pass through a 50/50 coinflip to convert to FLIP tokens. The effective extraction is denominated in FLIP, not ETH, and subject to both coinflip variance and FLIP price risk. The nominal commission rate overstates the actual ETH-equivalent extraction, since the coinflip conversion has slightly negative EV (~98.4% of nominal value in expectation).

**Best-response heuristic:** Build referral network early, set kickback to balance volume vs. margin (competitive pressure drives kickback toward 25%, analogous to Bertrand price competition).

**The affiliate's hidden contribution.** The formal model captures affiliates as commission-earning referrers. But affiliates produce something harder to measure: they convert people who would not have otherwise participated into active players. Through marketing, social influence, education, community building, or simple persuasion, affiliates reduce the activation energy for new participation. This is a genuine and substantial positive externality for the entire system. Every player an affiliate brings in adds deposits to the pool, draws to the jackpots, and liquidity to the FLIP market. The affiliate is compensated in FLIP commissions, but the system-level value of the players they recruit far exceeds that commission. This makes affiliates the primary solution to the cold-start problem (Section 10.2, Limitation #5).

**Observation 3.3** (FLIP Variance Filter). *The coinflip payout mechanism acts as a self-selection filter: sufficiently variance-averse affiliates rationally select out, while variance-neutral or variance-seeking affiliates remain.* A lootbox taper further reduces commissions on high-activity referrals to 25% of the base rate, reflecting that the game's own retention mechanics have taken over from the affiliate's recruitment value.

### 3.5 The Hybrid

The typology above presents clean archetypes. Reality is messier. Most players are not pure degens or pure grinders but somewhere in between. The **hybrid** is anyone on this spectrum: a broad category spanning from near-degen (plays for fun, likes that winning is possible) to near-grinder (plays to win, likes that it's fun). Some play near-optimally with occasional leaks. Others intend to play optimally but are underbankrolled, miss quest days, open lootboxes below breakeven activity score, or play Degenerette for entertainment when they "should" be waiting. Many are slight winners over meaningful samples. As a population, they are probably slight losers on aggregate, but the distribution is wide. Crucially, when a hybrid wins, it feels *earned*. A lottery winner got lucky. A hybrid who maintained their activity score, timed their lootbox purchases, and built their streak knows their decisions contributed to the outcome. That sense of agency is a distinct source of entertainment value that pure gambling cannot provide.

**Why hybrids matter for the system:** Their competitive motivation keeps them engaged more reliably than a pure degen would stay, while imperfect execution contributes surplus to the pool. They are getting real value in return: real entertainment, real monetary returns, and real progression. All math is on-chain and transparent.

### 3.6 Budget Constraints and the Poverty Trap

The EV-maximizing strategies described above assume players can execute them without resource constraints. In practice, **budget constraints** fundamentally alter the viability of EV-maximizing play.

**Observation 3.4** (Increasing Capital Requirements). *The EV-maximizing strategy requires increasing liquid capital commitment over time: ticket prices escalate with level progression, quest streak maintenance requires one full ticket per day at current prices, and lootbox purchases require additional ETH. The daily liquid capital requirement for EV-maximizing play is strictly increasing in level.*

**The daily capital requirement.** Quest completion requires a daily ETH mint purchase (ticket or lootbox), compounding the budget constraint on top of escalating ticket prices. Fresh deposits and recycled claimable winnings both credit MINT_ETH quest progress.

**Observation 3.5** (Bankroll Ruin under EV-Maximizing Play). *Even a player following a theoretically +EV strategy faces a non-zero probability of ruin. This occurs because: (a) jackpot payoffs are high-variance with potentially long dry spells, (b) future tickets and streak value are illiquid: they contribute to paper wealth but not to meeting tomorrow's costs, (c) quest streak maintenance is a daily fixed cost that cannot be deferred (missing a day without a streak shield resets the streak to zero, destroying accumulated value), and (d) the player may simultaneously hold significant illiquid wealth while being unable to meet the next day's liquid cost requirement.*

*This creates a degraded position: a player who loses their quest streak drops to a lower activity score and a worse protocol multiplier. In practice, a broken streak is unlikely to push a player from +EV to -EV entirely. The other components of activity score (purchase streak, purchase count, affiliate bonus, pass bonus) still contribute. But the lost streak represents a significant reduction in expected returns, and rebuilding it requires weeks of uninterrupted daily play. The player remains in the +EV cohort, but much less so than before.*

**Pass bootstrapping.** The breakeven grind from 0.00 to 0.60 activity score is the period where the protocol is most vulnerable to churn. Passes floor the score immediately: an afKing pass puts a new player at 0.85, a whale pass at 1.15, a deity pass at 1.55, all before any quest streak or affiliate bonus. Every one of these floors clears the 0.60 lootbox breakeven threshold on day one, making lootbox purchases better-than-ticket EV immediately rather than after weeks of grinding. (The 0.60 threshold is breakeven relative to buying tickets directly, not necessarily overall profitability, which depends on pool composition per the aggregate constraint in Section 2.3.) The pass system is not just a whale product. It is an onramp that eliminates the lootbox breakeven grind entirely for any player willing to pay upfront.

**The skill gap (Corollary 3.1).** Degenerus Protocol can be played at various levels of optimization, with an equilibrium breakeven point determined by activity score. Players who mismanage their bankroll, break streaks, or fail to optimize their activity score get worse returns than the theoretical maximum. Note that sub-optimal play can still be +EV. The surplus from below-equilibrium play (the difference between what a player extracts and what they would extract at optimal engagement) flows to the prize pools, benefiting players closer to the optimum. The returns of the most optimized players are funded by -EV players and players who are not trying to maximize returns at all.

---

## 4. Mechanism Design Properties

Behavioral incentive compatibility (selfish play producing system-positive outcomes) was established in Section 2.3 via the cross-subsidy flow table. Individual rationality for each player type was verified in Section 3. This section covers the two mechanism properties that require independent treatment: solvency and the zero-rake structure.

### 4.1 Accounting Solvency

**Proposition 4.1** (Solvency Invariant). *The protocol maintains the solvency relation as a contract invariant:*

$$\underbrace{\text{claimablePool}}_{\text{current obligations}} \;\leq\; \underbrace{\text{ETH balance} \;+\; \text{stETH balance}}_{\text{total assets held by contract}}$$

*Every state transition in the contract preserves this inequality. It is not a design goal or aspiration. It is an accounting identity enforced by the structure of every function that modifies balances.*

**Why it holds.** The contract maintains four logical ETH pools: `nextPrizePool`, `futurePrizePool`, `currentPrizePool`, and `claimablePool`. Only `claimablePool` represents current obligations. The other three are game state with no withdrawal rights attached. The solvency invariant is preserved because every category of state transition maintains it:

- **Deposits** increase `totalBalance` and increment prize pools. `claimablePool` is unchanged. The inequality grows wider.
- **Jackpot payouts** move ETH from prize pools into `claimablePool` (crediting individual winners). Total balance is unchanged, and `claimablePool` increases by exactly the amount leaving prize pools. The inequality is preserved.
- **Claims** decrement both `claimablePool` and total balance by the same amount (the claim payout). The inequality is preserved. The contract uses the checks-effects-interactions pattern: `claimablePool` is decremented before the ETH transfer, preventing reentrancy.
- **Yield distribution** computes surplus as `totalBalance - (nextPrizePool + futurePrizePool + currentPrizePool + claimablePool)`. Only this surplus is distributed. Credits from yield increase `claimablePool` by at most the surplus amount, which is by definition the margin above all obligations.

The result is that no valid transaction sequence can cause `claimablePool` to exceed total balance. Every inflow either widens the margin (deposits) or redistributes within it (jackpots, yield). Every outflow reduces both sides equally (claims). Staking ETH to stETH is a conversion between two assets that both count toward total balance, so it has no effect on solvency.

### 4.2 The Zero-Rake Property

**What the creator extracts.** The creator is a self-funded solo dev and the only insider. There are no VCs, team allocations, privileged parties or bro deals. Pre-launch compensation comes from a separate, opt-in token presale, not from any skim on deposits. Here is exactly what he gets:

- **The presale.** While the presale is open, every game purchase earns presale-eligibility credit equal to 25% of that spend, which entitles the player to buy presale boxes containing random, generous amounts of the protocol's equity tokens, FLIP and DGNRS. The ETH paid for those boxes routes 80% to the vault and 20% to sDGNRS holders, capped at 50 ETH total (at most 40 ETH to the vault), after which the presale closes for good. There is no way to buy in without also taking a stake in the game: eligibility credit only accrues from real game purchases.
- **20% of the DGNRS token supply** as the only liquid (transferable) tokens, plus one billion wwXRP, a valueless memecoin handed to losers as a consolation prize. The remaining 80% of DGNRS is distributed to players through gameplay, so the creator's token allocation is entirely dependent on the protocol's long-term success.
- **The vault** (creator-owned) receives, on the same terms as the player-owned DGNRS contract: 25% of stETH yield, a nerfed deity pass (4 tickets per level with an activity score boost, played via an afKing subscription), a coinflip-seeded FLIP position (200,000 FLIP staked daily for 20 days, minted only as each day's flip survives), and affiliate commissions from unaffiliated players (minted FLIP, split with the DGNRS contract).

In concrete terms, the creator's in-game position is roughly equivalent to one deity pass with a 25% yield share, a coinflip-seeded FLIP position, and at most 40 ETH from the presale. This is not nothing, but it is a defined, bounded allocation. The difference from traditional gambling: none of it is an ongoing rake on deposits. 100% of every ETH deposited goes into the prize pool system at every level, along with 50% of stETH yield. The creator's upside is tied to protocol success, not to player losses.

**A note on origins.** The creator's revenue streams above are not a rake in the traditional sense. They are delayed compensation for prior contributions, internalized into the system on the same terms as all other rewards: contingent on its success. What sustained his efforts through years of significant opportunity cost and zero revenue was the same $\Psi$ this paper identifies as the engine of the system: genuine fascination with the design problem and a desire to build something unique. To make the opportunity cost concrete: the creator is a professional poker player whose income funded this project, eliminating the need for outside investment and any obligations that come with it. An EV maximizer with that outside option would never have started this, and if they had, would have structured it very differently.

**Definition 4.2** (Zero-Rake). *A gaming mechanism is zero-rake if no entity extracts a guaranteed percentage of player deposits as ongoing profit.*

**Observation 4.3** (Zero-Rake). *Degenerus Protocol is zero-rake: 100% of player ETH deposits remain in the prize pool system, at every level. No percentage of any deposit is skimmed by a house or operator. The creator's presale compensation is a separate, opt-in token sale, not a cut of deposits.*

**Corollary 4.4** (Positive-Sum Game). *For the player pool as a whole, Degenerus Protocol is a positive-sum game:*

$$\sum_{i \in \mathcal{N}} \mathbb{E}[\text{gross payout}_i] = \sum_{i \in \mathcal{N}} \text{deposits}_i + 0.50 \cdot r \cdot S \cdot T > \sum_{i \in \mathcal{N}} \text{deposits}_i$$

*where $T$ is the time horizon, $r \cdot S \cdot T$ is total stETH yield generated, and the coefficient $0.50$ reflects the four-way yield split: 25% to the segregated accumulator (distributed through century-milestone events and the terminal payout) and 25% to DGNRS holders flow back to participants; the remaining half goes to the creator's vault (25%) and the GNRUS donation contract (25%).*

**Caveat:** The game is positive-sum *in aggregate*. Individual players, especially low-activity degens, face negative monetary EV. Calling it "positive-sum" is accurate for the pool; individual experience varies.

**Reality check:** The game is primarily redistributive. The vast majority of what any player receives came from other players' deposits. The yield component makes the total payout exceed total deposits, but the dominant dynamic is redistribution from low-activity to high-activity players, and from unlucky to lucky ones. This is not a magic money machine. It is a well-structured game where the house edge is zero and a small external subsidy makes the aggregate slightly positive.

There is a second, arguably more important sense in which the game is positive-sum: *total utility* exceeds total deposits even ignoring yield. A degen who loses 0.01 ETH but gets genuine entertainment worth more than 0.01 ETH to them has a positive-utility outcome despite a negative-monetary one. An EV maximizer who extracts 0.01 ETH profit has a positive-monetary outcome. Both players are better off than they were before, drawing from the same pool of deposits. The complementary preferences of different player types mean that value is not merely redistributed but *created* through the act of playing. This is the same dynamic that makes poker positive-sum for the table (even before considering the house): the recreational player and the professional are both getting what they came for.

---

## 5. Equilibrium Analysis and Commitment Devices

For any player with unlimited bankroll who chooses to participate, the dominant strategy is to maximize activity score and cap out benefits every level. This is not a conjecture. Activity score strictly increases returns on every score-sensitive product, so deviation from score maximization reduces expected returns regardless of what other players do.

Bankroll constraints change the implementation, not the direction. Forced exit resets streaks to zero, erasing the accumulated activity score contribution that drives future EV. A player's edge is relative: it is their activity weight against the population average, so outcome distributions depend on the actions of others, and ruin risk scales with how aggressively a bankroll is deployed against that composition-dependent edge. The dominant strategy is maximum sustainable engagement.

### 5.1 The Active Participation Equilibrium

The participation decision and the strategy decision are separate questions with different answers.

**The participation decision** depends on opportunity cost and pool composition. With no sub-optimal players, returns converge to stETH yield, which may not justify the opportunity cost of locked capital. In practice, some players will always play sub-optimally, and any optimizer who exits increases returns for those who remain. This establishes a natural equilibrium: the game sustains as many optimizers as the sub-optimal deposit base (plus yield) can fund at returns exceeding their opportunity cost. GTO play also requires long-term commitment (streaks, future tickets, activity score), so even players who stop adding new capital remain connected to the game and incentivized to help it progress.

**The strategy decision**, given participation, is unconditional.

**Observation 5.1** (Active Participation Dominant Strategy). *If an EV maximizer chooses to participate and has sufficient bankroll to sustain engagement, the strategy that maximizes activity score and caps out protocol benefits every level is a dominant strategy. No unilateral deviation from max-activity play improves expected returns. This holds regardless of what other players do: reducing engagement always reduces the deviator's share. The bankroll constraint is real (see Section 3.6 on ruin risk), but conditional on having the capital, the strategy dominance is unconditional.*

*Verification that no player type benefits from unilateral deviation from max activity:*

**EV Maximizer deviates to minimal participation:** Reducing engagement reduces $a_i$, which reduces $\mu(a_i)$ and $\rho(a_i)$. The marginal cost of maintaining streaks (one ticket per day) is dominated by the marginal benefit of higher EV multipliers on all subsequent actions.

**Whale deviates to exit:** Forfeits accumulated activity score (non-transferable) and deity pass benefits (pass is transferable but costs 5 ETH in FLIP to transfer). The ongoing returns from their position (high lootbox multiplier, positive-EV Degenerette, afKing reinvestment) provide continuing positive returns so long as the pool remains sufficiently funded by other participants.

**Affiliate deviates to stop referring:** Commission flow ceases. Since referral is the affiliate's only value proposition, cessation is equivalent to exit.

**Degen deviates to non-participation:** If the entertainment value is less than the monetary loss, the degen was never in the individually rational set and would not have participated in the first place. For degens within the IR set, continued play is preferred.

### 5.2 The Inactive Equilibrium and Why It Is Unstable

**Observation 5.2** (Inactive Profile as Conditional Equilibrium). *The strategy profile where all players choose no participation can be an equilibrium if deviation incentives are sufficiently weak. However, the inactive equilibrium is unstable for four reasons:*

**First-mover advantage.** The earliest players hold ticket positions across the most levels, giving them the most jackpot draw opportunities from their holdings. This creates a race-to-deviate dynamic: knowing the game will eventually start, earlier deviators are structurally advantaged. The rational response is to deviate early.

**FLIP appreciation subsidy.** Early levels give out FLIP cheaply (tickets cost 0.01 ETH at level 0). If the game reaches even level 10 (0.04 ETH tickets), early FLIP has quadrupled in utility value. By the first century milestone (0.24 ETH), early FLIP is worth 24x its acquisition cost. Presale boxes, available before launch, hand the earliest buyers generous FLIP and DGNRS. This makes early participation strictly more attractive than waiting.

**Yield accumulation.** Once any deposits exist, stETH yield accrues regardless of further activity, growing total assets and making participation increasingly attractive.

**Passes as equilibrium-breaking devices.** Deity passes (24+ ETH) and whale passes inject large up-front capital into the prize pool. Pass holders receive activity score bonuses valuable *only if the game advances through levels*. A deity holder has 24+ ETH locked into a system that rewards them as long as levels progress, with a partial refund (up to 20 ETH per pass) if the game dies before level 10. Their rational response is to actively drive progression. The pass system converts a coordination problem (who goes first?) into a paid commitment (pass holders go first, and are compensated for doing so).

**Important assumption:** This instability requires that potential participants are *monitoring on-chain state*. If the game enters a truly dormant phase where no one tracks pool sizes, the signal that makes deviation attractive may not reach anyone.

### 5.3 Why Active Play Wins

For an EV maximizer with sufficient bankroll, the choice is binary: maximize activity or do not participate. There is no profitable middle ground because activity score monotonically increases returns on every protocol product. Partial engagement means strictly worse multipliers for the same capital deployed. The unlimited-bankroll player either goes all-in on activity or stays out entirely.

**Bankroll-constrained players face a different problem.** A player who cannot afford to cap out every protocol benefit each level still has a clear optimization: be as active as their bankroll allows, prioritizing the highest-ROI actions first (quest streak maintenance costs one ticket per day and has the highest marginal return, followed by lootbox purchases at the activity level where they cross into +EV territory). Activity score is still monotonically increasing in returns, so more engagement is always better than less. The question for the constrained player is not "how active should I be?" (answer: as active as possible) but "is my bankroll large enough that participation is +EV at all?" Below some threshold, the capital required to maintain streaks and reach the +EV activity breakeven may exceed the expected returns. That threshold depends on pool composition and is lower when more degens are present.

**The EV floor for GTO play is positive.** Because there is no rake, stETH yield accumulates entirely within the prize pool rather than being extracted by a house. By maximizing activity score, they capture more than their proportional share of that yield in expectation. Realized outcomes are another matter. The worst case is running badly and recovering nothing.

**Active play is self-reinforcing.** As long as stETH yield is positive and at least one player participates, the active pool generates positive net prize flows. Each additional participant makes the game more attractive (larger pools, faster progression), not less. The inactive equilibrium is unstable: a single player who starts playing improves conditions for everyone else, pulling more players in.

### 5.4 The Repeated Game Structure

The protocol defines a repeated game where each level is a stage game. A player's total value at any level is their current-level payoff plus the discounted value of all future levels. The critical structural feature: activity score carries forward across levels. This means engagement at the current level directly increases the value of every future level. A player who maintains their quest streak today improves their lootbox multiplier tomorrow.

The game has no known finite horizon (GAMEOVER is triggered by an inactivity timeout, not a pre-specified terminal level). This means players cannot reason backward from a known endpoint. Instead, the incentive structure relies on the persistent value of activity score: at every level, the best response is to maintain engagement because it compounds forward indefinitely.

### 5.5 Commitment Devices

The protocol employs several commitment devices that transform the payoff structure. We should be direct about what these are: **they are retention mechanics designed to make leaving costly.** The question is not whether they create lock-in (they do) but whether the lock-in is compensated by real deferred value. We argue yes: the sunk costs are matched by genuine future payoffs, but the reader should judge.

**Device 1: Future Tickets.** Lootbox prizes frequently award tickets for future levels ($\ell + k$ for $k \in [0, 50]$). These tickets are non-transferable and non-refundable. They pay out automatically when the game reaches their target level, so a player who holds them doesn't need to actively play to collect. But they do have a strictly positive incentive to help the game reach those levels, whether through their own purchases or by recruiting other players who accelerate progression.

Crucially, future tickets also have **time-value**: they earn FLIP jackpot draw entries *before* their target level arrives. Earlier acquisition means more cumulative FLIP draw opportunities, making the time of purchase economically relevant.

**Observation 5.3** (Future Tickets as Commitment Device). *A player holding future tickets has a strictly positive incentive to help the game reach those levels. The expected payoff is their share of the target level's prize pool (proportional to their ticket count relative to total tickets) plus all FLIP jackpot draws accumulated while waiting.*

**Device 2: Quest Streaks.** Each completed quest advances a streak counter $q$ by 1, and the streak contributes $q/200$ to the activity score, uncapped (reward curves saturate at an effective score of 300). Each day has two quest slots (the ETH-purchase slot that maintains the streak, plus a random bonus quest), each paying 100 FLIP; a full quest day advances the counter by 2, and a completed level quest advances it by 5. Breaking the streak resets $q$ to 0, though a quest-streak shield absorbs one missed day before the streak breaks. Shields come from a random lootbox boon and from the streak itself: each time the streak crosses a multiple of 100, the player earns one, up to 10 held.

**Observation 5.4** (Streak Lock-In). *The cost of breaking a quest streak grows roughly quadratically with streak length. A 50-day streak contributes 0.25 to activity score, and rebuilding it requires 50 consecutive days of purchases. The longer the streak, the more painful it is to lose, creating increasingly powerful retention.* For a player with a 50-day streak, the daily cost of maintaining the streak (one ticket at current level price) is far exceeded by the EV uplift from the 0.25 activity score contribution. Streaks also provide a direct FLIP bonus at milestones (every 10 levels, with an escalating, capped amount), adding a concrete monetary reward on top of the activity score benefit.

**Device 3: The afKing Subscription.** The protocol offers a subscription service to pass holders, free for as long as their pass is active, that maintains the quest streak without daily attention: subs with available funds automatically purchase and open one ticket or lootbox per day. An optional reinvest setting scales the daily buy with accumulated winnings at face value, converting liquid winnings back into participation.

**Device 4: FLIP Burn-on-Use.** FLIP tokens are destroyed when used for tickets, Degenerette bets, and decimator entries. Their value is realized only through gameplay actions that contribute to the system.

These commitment devices are powerful. The difference from exploitative gambling design is that the deferred rewards here are *real, substantial, and transparently calculable*. A player can compute exactly what their streak is worth, what their future tickets will earn, and what their activity score does to their EV. The underlying psychological mechanism (making it costly to leave) is the same as casino loyalty programs, but the rewards are on-chain, verifiable, and actually worth what they claim to be. The contract is immutable and ownerless. No regulator, operator, or adversary can modify, pause, or kill it.

---

## 6. FLIP Economics and the 100-Level Cycle

### 6.1 The FLIP Price Ratchet

FLIP has a built-in appreciation mechanism against ETH. ETH ticket prices escalate with level progression (Appendix C), but FLIP ticket purchases always cost 1,000 FLIP per ticket (4 entries) regardless of level. Since a ticket at level x00 costs 0.24 ETH but still costs 1,000 FLIP, the utility value of 1 FLIP in ETH terms rises monotonically as the game progresses:

| Level Range | ETH Ticket Price | FLIP Ticket Price | ETH per entry | FLIP per entry |
|-------------|-----------------|---------------------|---------------|-----------------|
| 0–4 (intro) | 0.01 ETH | 1,000 FLIP | 0.0025 ETH | 250 FLIP |
| 5–9 (intro) | 0.02 ETH | 1,000 FLIP | 0.005 ETH | 250 FLIP |
| x01–x29 | 0.04 ETH | 1,000 FLIP | 0.01 ETH | 250 FLIP |
| x30–x59 | 0.08 ETH | 1,000 FLIP | 0.02 ETH | 250 FLIP |
| x60–x79 | 0.12 ETH | 1,000 FLIP | 0.03 ETH | 250 FLIP |
| x80–x99 | 0.16 ETH | 1,000 FLIP | 0.04 ETH | 250 FLIP |
| x00 (century) | 0.24 ETH | 1,000 FLIP | 0.06 ETH | 250 FLIP |

The initial levels show the steepest appreciation: FLIP earned at level 0 (when one entry costs 0.0025 ETH) has 24x the purchasing power by the first century milestone (where one entry costs 0.06 ETH). 250 FLIP always buys the same one entry; it is the ETH price of that entry that rises. Within each subsequent 100-level cycle, FLIP's utility value increases 6x from x01 to x00. This is a structural appreciation mechanism: as long as the game progresses through levels, patient FLIP holders see their tokens' purchasing power increase.

**The time-preference cross-subsidy.** Players who earn FLIP early and hold it benefit from this appreciation. Players who immediately spend FLIP at Degenerette or buy tickets at low-price levels get entertainment now but at lower ETH-equivalent value. This creates a cross-subsidy between time preferences: impatient FLIP use reduces circulating supply (all FLIP sinks are permanent burns), which benefits patient holders through both reduced supply and higher future utility value. The degen who burns 1,000 FLIP on Degenerette at level x05 (when those FLIP could buy 10 tickets worth 0.04 ETH each = 0.4 ETH of tickets) is giving up future value for present entertainment. That value doesn't disappear; it accrues to the remaining FLIP supply and, indirectly, to all ticket holders, since FLIP can be converted to tickets in a way that draws value from the same pools.

This connects to the structural price floor (Observation 8.3 in Section 8): the floor itself ratchets upward with level progression, since the ticket-price arbitrage opportunity grows as ETH ticket prices increase.

### 6.2 The Decimator

The decimator is a FLIP-burn-to-win-ETH mechanism that provides an alternative sink for FLIP tokens. Players permanently destroy FLIP to buy weighted entries in a pro-rata ETH distribution drawn from the futurepool. It fires at milestone levels throughout each 100-level cycle at 10% of the futurepool, and at century milestones (x00) at 30%.

Activity score determines both bucket assignment (better odds) and burn weight multiplier (1.0x at zero activity to ~1.78x at the effective score cap). A max-activity player at a x00 level gets bucket 2 and ~1.78x weight, competing for 30% of the futurepool. A zero-activity player gets bucket 12 and 1.0x weight at 10%. The difference in expected ETH per FLIP burned is dramatic.

**Strategic choice: tickets vs decimator.** FLIP holders face a real decision: burn for tickets (1,000 FLIP per ticket, 4 lottery entries each) or burn in the decimator (minimum 1,000 FLIP, pro-rata ETH from futurepool). Neither is strictly dominant; the optimal choice depends on the player's activity score, futurepool size, competition from other burners, and whether it's a normal or x00 level. This dual-sink structure drives the FLIP price floor (Section 8.4): the ticket floor is universal, while the decimator floor is player-specific and rewards engagement. FLIP is worth more in skilled hands.

### 6.3 The 100-Level Cycle

Ticket prices escalate within each 100-level cycle from 0.04 ETH at x01 to 0.24 ETH at x00, then reset. Century milestones (x00) are crescendo events where the futurepool dump, dual bonus BAF jackpot (20% vs 10% at normal milestones), dual bonus decimator (30% vs 10%), and dual bonus daily jackpots all fire at their highest rates simultaneously, distributing a massive fraction of accumulated rewards across multiple channels. After the crescendo, prices reset to 0.04 ETH, lowering barriers for all bankroll sizes. Each cycle's pools tend to be larger than the last because deposits are irrevocable and the futurepool grows net across each 100-level cycle (despite periodic drains from the drip, decimator, and BAF). This is not strictly guaranteed: a sufficiently slow cycle could see growth that fails to compensate for the natural prize pool reduction between x00 and the following x01. But the structural trend is upward as long as new deposits continue. This creates a recruitment flywheel: bigger jackpots attract more degens, whose deposits make the next cycle's jackpots bigger still. The on-chain visibility of a growing, non-decreasing pool is itself a marketing asset that compounds over time.

---

## 7. Robustness and Attack Vectors

### 7.1 Coordination-Free Design

Degenerus Protocol eliminates all non-trivial coordination problems from the core game. Trait assignment is deterministic from VRF entropy (players cannot coordinate on traits). The only strategic choices are: (a) how much to invest, (b) which products to use, and (c) whether to maintain engagement streaks. None require coordination with or knowledge of other players' specific strategies.

The affiliate system creates a mild coordination game (affiliates compete by offering kickback). In theory, Bertrand competition would drive kickback to the maximum (25%). In practice, affiliates primarily refer degens who are less price-sensitive and less likely to comparison-shop referral codes. Affiliates can also create multiple codes with different kickback rates, price-discriminating between informed players (who seek maximum kickback) and casual ones (who use whatever link they find first). The affiliate market is unlikely to reach a single competitive equilibrium.

### 7.2 Coalitional Robustness

**Observation 7.1** (Coalitional Robustness). *The active-participation profile appears robust to small coalitions, but robustness depends on payout parameters, participation elasticity, and monitoring intensity rather than a universal fixed threshold.*

A deviating coalition can at most:
1. **Withdraw participation:** Reduces pool growth rate but does not prevent progression (remaining players and the four progression guarantors sustain the game).
2. **Coordinate ticket timing:** Cannot influence trait assignment or VRF outcomes.
3. **Dominate BAF leaderboard:** A well-funded coalition (or single whale) can outflip anyone by simply staking more FLIP in coinflips (the leaderboard ranks cumulative winnings, so volume converts to position in expectation). There is no cap on coinflip volume, so a sufficiently capitalized player can take the top BAF position by brute force. However, total extraction remains bounded by finite BAF payout math, and every FLIP flipped feeds the coinflip burn (net ~1.6% destruction per cycle), so dominating the leaderboard has a real cost.
4. **Dump FLIP:** Creates temporary sell pressure, but the utility floor (ticket purchases, decimator entries) provides a structural price floor.

The coalition's maximum extraction is bounded, and their departure increases per-capita EV for remaining players (the "whale departure paradox," Section 8.3).

### 7.3 Griefer Analysis

**Well-funded griefers face structural futility.** The Griefer is the strongest adversary we model: a well-funded actor (competitor, state-backed regulator, or ideological opponent) willing to spend money purely to break the game or force GAMEOVER. The problem for the griefer is that there is no venue for griefing. The protocol's mechanisms (RNG locks, VRF commitment, the governed emergency-recovery path) deny any lever to *mechanically* break the game. What can a griefer actually do? The most plausible attack is to massively inflate the prize pool at the current level, advancing it quickly and setting a high target for the next level that the non-griefer population may struggle to cover. But this is self-defeating: the inflated pool creates a massive jackpot, which is exactly the kind of event that attracts new players and re-engages lapsed ones. The griefer spends money to make the game more exciting for everyone else. And players cannot be priced out by escalating ticket costs: partial tickets are available at any level, and lootbox prices remain constant regardless of level. GAMEOVER requires 120 days of insufficient purchasing activity to meet the current level's target, not just the griefer's departure. The griefer cannot force other players to stop. At best, they can waste money participating, then leave. Their deposits remain in the pool, benefiting everyone else.

**Even coercing the creator is futile.** Suppose a state-level adversary compels the creator to destroy the game under threat of force. The creator *cannot comply*. The contract is immutable and ownerless in the relevant sense: the admin's privileges are limited to proposing an emergency VRF coordinator swap after a 44-hour stall, subject to sDGNRS holder governance approval (after 7 days, any sDGNRS holder with 0.5%+ of circulating supply can propose independently). The admin has no power to pause the game, extract funds, modify rules, or trigger GAMEOVER. There is no multisig, no governance vote, no upgrade proxy. The creator could burn every private key they hold and the game would continue operating identically. The only path to GAMEOVER is 120 consecutive days where purchasing activity fails to meet the current level's target, and no amount of coercion applied to any single party can produce that outcome.

**The theoretical attack scenario.** The only path to fund misappropriation requires an attacker who simultaneously holds the admin key, causes a sustained Chainlink VRF failure lasting over 44 hours, *and* obtains sDGNRS holder approval for a hostile coordinator swap. Under normal operation, the admin cannot touch the VRF coordinator at all. The proposal window only opens if Chainlink VRF is genuinely non-functional *or* no eligible player requests a new VRF word (a permissionless call that pays the caller directly and triggers jackpot payouts).

Given a VRF failure, three outcomes are possible: (1) the admin is alive and honest, rotates the coordinator, and service resumes. This is the entire reason the admin power exists. (2) The admin is dead or unreachable, and the game eventually reaches GAMEOVER with full fund distribution to participants. No theft. (3) An attacker has compromised the admin key, proposes a hostile coordinator that rigs jackpot outcomes, and the sDGNRS holder vote approves it anyway. This is the only theft path, and it is a necessary design tradeoff: the power to fix a broken VRF is the same power that could theoretically be abused. The conditions required (Chainlink failure + compromised admin key + governance approval of a hostile swap) cannot arise under ordinary circumstances. Chainlink VRF is battle-tested infrastructure securing billions in DeFi; treating its sustained failure as a realistic attack vector rather than a theoretical bound would be alarmist.

The game's resilience is a property of the contract, not of any person. Even the front-end is not a single point of failure: anyone can build and host an alternative interface.

Detailed analysis of specific attack vectors (Sybil attacks, Degenerette pool drain, affiliate self-referral loops, stETH depeg events) is in Appendix D. None present existential threats to the protocol.

---

The preceding analysis addresses how the protocol sustains itself under normal and adversarial conditions. We now turn to the harder question: what happens when things go genuinely wrong?

## 8. Failure Modes and Resilience

### 8.1 What a Death Spiral Looks Like

**Definition 8.1** (Death Spiral). *A death spiral is a sequence of states where: (a) player count is monotonically decreasing, (b) prize pool growth rate is negative (the system distributes more than it accumulates), and (c) the process is self-reinforcing (declining participation causes further decline).*

### 8.2 Why the Protocol Resists Death Spirals

**Observation 8.1** (Death Spiral Resistance). *Degenerus Protocol resists death spirals through three independent mechanisms:*

**(a) Prize pool concentration and jackpot accumulation.** As players exit, the per-capita prize pool share increases for remaining players. Fewer competitors for the same pool means higher expected value per participant. This creates a natural "buy low" attractor: the worse the exodus, the better the deal for anyone who stays or enters. Players who remain active (or are earliest to return) capture a disproportionate share of rewards: daily FLIP jackpots and the daily ETH/ticket drip jackpot continue firing regardless of population size. Fewer active players means fewer draw entries, so each remaining participant's probability of winning increases. The longer others stay away, the more draws the active players accumulate.

**(b) Yield independence.** stETH yield continues regardless of player activity, growing total assets. While yield does not directly fill the nextpool target (progression still requires player purchases), it increases the value of accumulated jackpot pools. During a player exodus, jackpot attractiveness continues growing passively, strengthening the incentive for remaining or new players to participate.

**(c) Locked liquidity.** Prize pools are not withdrawable. Player exit does not reduce prize pool assets; it only reduces competition for those assets. This is structurally different from DeFi protocols where whale departure causes liquidity crises.

*Argument.* A death spiral requires condition (c): self-reinforcing decline. Player departure has two effects:

- Effect A (negative): Reduced prize pool *growth rate* (fewer deposits).
- Effect B (positive): Increased per-capita *share* of existing pools (fewer competitors).

For remaining players, Effect B dominates Effect A once the per-capita share of the accumulated pool exceeds the departing player's net annual contribution: with $n$ players and pool stock $P$, one departure raises each remaining player's expected claim by roughly $P/n^2$, while removing net deposits of roughly $c/n$ per player per year, so the stock gain covers a year of lost flow when $P/n > c$. Since the pool accumulates over the entire game history and cannot decrease (locked liquidity) while any single player's net contribution is bounded by their annual spend, the condition is satisfied after a few levels of active play for all but a dominant whale, the case Section 8.3 treats separately.

Therefore, condition (c) of Definition 8.1 fails on the monetary dimension so long as a sufficient fraction of remaining players respond to monetary incentives. It does not require *all* players to be rational, only that enough EV-sensitive capital remains to keep the system above its breakeven threshold. The "spiral" breaks because the monetary incentive to stay *increases* as others leave.

**Progression is also guaranteed at least once (once the game is established).** The death spiral argument above addresses per-capita pool share, but a skeptic might ask: does the game still *advance levels* when players leave? The futurepool drip mechanism answers this. Every day, a portion of the future prize pool drains into the next-level prize pool, awarding the equity in tickets to current ticket holders. During any period of low activity, the futurepool (which accumulates from all prior levels) continues draining. Once futurepool exceeds a sufficient multiple of the unfilled part of the next level's target (roughly 1.9x the gap remaining at level open), the drip alone will fill the target without any new player purchases. This mechanically guarantees at least one more level completion. This guarantee only applies once the game has progressed enough for the futurepool to substantially exceed the nextpool target, which happens naturally as deposits and lootbox purchases accumulate over multiple levels. (This is a one-shot guarantee: if activity remains zero after that level completes, the now-depleted futurepool may not cover the following level's target.) But a single guaranteed level completion is psychologically significant. It means the game visibly advances even during a drought, jackpots fire, winners are drawn, and the on-chain evidence of continued activity can re-engage lapsed players.

**Simulation evidence.** A Monte Carlo simulation of 30 levels with realistic player behavior demonstrates these dynamics concretely. Most levels complete in 7-12 days. Level 22, however, takes 31 days: organic buying slowed and the pool barely moved for weeks, grinding from 340 ETH to 410 ETH on auto-mechanisms alone (quest streak pressure, afKing daily buys, futurepool drips). Then momentum picked up and the level completed normally. That is what a "slow period" looks like in this system. Not a stall. Not a death spiral. Just a longer grind where the mechanical floor kept the pool growing until human activity resumed. The futurepool drained slightly to feed the drip, and players holding tickets kept winning smaller daily jackpots the whole time. Over the 30-level run (308 simulated days), the futurepool grew from 8 ETH to 1,690 ETH, the largest single jackpot grew from 11 ETH to 305 ETH, and cumulative stETH yield reached 67 ETH.

<!-- SIM_CHART -->

**The gameover backstop.** Even if the game does die and reach GAMEOVER status, the remaining funds are not lost. 90% distributes through a final jackpot to the last level's ticket holders, and 10% through a terminal decimator weighted by activity score, FLIP burned, and burn timing. Players who stayed active during the decline, accumulating tickets and score throughout, have a substantial edge in capturing the terminal distribution. This means staying active during a downturn is rewarded not just by ongoing jackpots but by a favorable position in the endgame payout. The worst-case outcome for loyal players is not "lose everything" but "collect a disproportionate share of the final pool."

**The Ψ problem.** This argument has an important gap. The death spiral resistance argument above is purely monetary. What happens to $\Psi$ during player exodus? The primary source of $\Psi$ is gambling entertainment, which is rock-solid human nature and does not degrade with fewer participants. A lootbox is just as fun to open with 10 players as with 10,000, and the fun scales with the prize pool, which can only increase over time (locked liquidity means player exits do not reduce it). That said, a slow-moving game where the big jackpot is far away in time would reduce the appeal for gamblers who want a large payout soon. But this is ultimately secondary: the monetary argument is sufficient to retain the +EV class during low-activity periods, and a growing prize pool will always attract the gambling class later in the level when the jackpot becomes large and imminent. The +EV players sustain progression; the gamblers provide the -EV backing that funds the system when the prizes get big enough to draw them in.

### 8.3 The Whale Departure Paradox

**Observation 8.2** (Whale Departure Has Mixed Effects). *When a whale exits, remaining players experience two competing effects: increased per-capita pool share (positive) and reduced progression velocity (negative). The net impact depends on the whale's contribution-to-extraction ratio and the time-sensitivity of remaining players' positions.*

A whale with activity score $a_W = 3.05$ has a protocol multiplier above 1.0 on lootboxes, positive-EV Degenerette, and BAF prize eligibility. In a sufficiently funded pool, they extract more than they deposit in expectation. When they exit:

1. Their deposits cease: pool growth decreases by $c_W$ per level.
2. Their extractions cease: the net extraction that was flowing to the whale now remains in the pool for everyone else.

Since the whale has above-breakeven multipliers, the *static pool effect* is positive for remaining players: one net extractor has left.

However, the **velocity effect** works against remaining players. Whales drive faster level progression through large purchases. Slower progression delays when everyone's future tickets activate, increasing the time-value discount on illiquid positions:

$$V_{future}(\ell+k) = \delta^{t(\ell+k)} \cdot V_{tickets}(\ell+k)$$

where $t(\ell+k)$ is the calendar time until level $\ell+k$ is reached. Higher whale spending reduces $t(\ell+k)$, increasing $V_{future}$ for all holders.

The net effect depends on context: remaining players get a larger share of each jackpot (positive) but may wait longer between jackpots if the whale was a significant driver of progression (negative). If progression velocity is maintained despite the whale's departure (because other players or the four progression guarantors fill the gap), then whale departure is unambiguously positive for remaining players: pure reduction in extraction with no velocity cost. If the whale was the dominant contributor, the velocity loss is real but temporary. The futurepool drip, quest streak pressure, and afKing subscriptions continue to push the nextpool toward its target regardless of who left. Whale departure slows the game. It does not stop it.

### 8.4 FLIP Token Stability

**Observation 8.3** (FLIP Price Floor). *The FLIP token has a structural price floor driven by the ticket-purchase comparison. 1,000 FLIP buys a ticket at any level. An ETH ticket purchase at level $\ell$ costs $p(\ell)$ but also awards 100 FLIP, so the net cost of a FLIP ticket is 900 FLIP. Given that players are actively buying tickets at full ETH price, the floor should be near:*

$$p_{FLIP}^{floor} \approx \frac{p(\ell)}{900}$$

The pure entry-parity rate is $p(\ell)/1000$ per FLIP (since 250 FLIP = 1 entry = $p(\ell)/4$ ETH, so 1 FLIP = $p(\ell)/1000$ ETH). The floor formula $p(\ell)/900$ is slightly lower than this parity rate, because ETH ticket purchases return 100 FLIP; accounting for that rebate, the ETH-savings arbitrage only activates below the adjusted threshold. If market price falls significantly below $p(\ell)/900$, rational players buy FLIP on the open market and redeem it for tickets during each level's jackpot window instead of paying ETH, saving cost per entry. This arbitrage creates buy pressure that supports the price.

The decimator provides a second floor, but it is not a single number. Decimator EV per FLIP burned varies dramatically by player: activity score determines both bucket assignment (odds) and burn weight multiplier (Section 6.2). A max-activity player at a x00 level (bucket 2, ~1.78x weight) gets far more ETH per FLIP than a zero-activity player (bucket 12, 1.0x weight) burning at a normal level. The ticket floor is universal and clean; the decimator floor is player-specific and hard to calculate, but for high-activity players it can exceed the ticket floor substantially.

**Future-value component.** The ticket floor $p(\ell)/900$ rises monotonically within each 100-level cycle (6x from x01 to x00). FLIP held today will be worth more at future levels, and the holder knows this. Unlike conventional assets where future value is discounted by calendar time, FLIP's discount rate is tied to *level progression speed*, which depends on player activity rather than a fixed clock. This makes the present-value calculation unusually complex: a fast-progressing game compresses the discount window and pulls future value forward, while a slow game stretches it. The net effect is that the price floor at any moment reflects not just current-level utility but a discounted sum of all future-level utility within the cycle, weighted by the market's expectation of progression speed.

**Caveat:** The arbitrage mechanism is most efficient with liquid FLIP markets, but the floor does not depend on a DEX listing. FLIP has direct utility: it buys tickets, plays Degenerette, and enters the decimator without ever touching an exchange. The price floor exists through this direct utility whether or not an LP exists. A liquid market simply makes the arbitrage more convenient, and providing that liquidity is profitable, so someone will. During a severe bear market (Section 8.5), these dynamics weaken. However, the floor has a backstop even in GAMEOVER: the terminal decimator distributes 10% of all remaining assets and requires FLIP to enter, weighted by activity score, FLIP burned, and burn timing (earlier burns weigh more). A player holding FLIP when the game dies holds a claim on that slice; the other 90% goes to the final level's ticket holders. The endgame floor is real but partial: FLIP is one of the two terminal claim instruments, not the primary one.

### 8.5 The Bear Market Stress Test

The reviewers of this paper correctly identified the sustained bear market scenario as the most plausible failure mode. It deserves serious treatment, not a dismissive paragraph.

**The scenario:** A prolonged crypto winter suppresses participation. ETH price drops 80%+. stETH yield compresses. New player acquisition stalls. Existing players face real-world financial pressure and reduce discretionary gambling spending. The game reaches a later level where prize pool targets are higher and ticket prices have escalated.

**Why it's dangerous:** At higher levels, the daily cost of maintaining a quest streak is higher (tickets cost 0.04–0.24 ETH). The prize pool targets are larger. The progression guarantors may all weaken simultaneously, because they are not truly independent: they are all driven by player spending, which is driven by crypto market sentiment. A severe bear market is exactly the scenario where all guarantors fail together, because they share a common cause (market-wide risk aversion).

**Structural defenses:**
- stETH yield continues (at reduced rates, but positive). This does not directly fill the nextpool target, but it grows total assets and increases the attractiveness of jackpots for anyone considering participation.
- Prize pool concentration accelerates as players leave, making remaining pools increasingly attractive to any remaining or returning participants.
- The 120-day timeout is meaningful. Four months of near-zero activity is required for game death. Even during the 2022 crypto winter, on-chain activity never went to zero.
- Future pool drip continues regardless of new deposits, providing mechanical progression support.

**Honest assessment:** A 120-day period of insufficient activity to advance one level is unlikely during early levels (targets are small, tickets are cheap). At later levels with 0.16–0.24 ETH tickets and larger targets, a sustained bear market could plausibly trigger the timeout. However, by the time the game reaches later levels, the futurepool will be substantially larger than any single level's nextpool requirement. The daily futurepool drip mechanically guarantees at least one more level completion even at zero new activity. This is psychologically significant: players and potential entrants can see on-chain that the next level *will* fire regardless, removing the coordination fear of "what if nobody else plays." The protocol's anti-stall mechanisms mitigate but do not eliminate the long-term risk. This is the most realistic path to game death, and players with large illiquid positions at high levels during a bear market face real risk of stranding. If the game truly dies, stranded funds are locked for up to 120 days until the GAMEOVER timeout triggers. During that period, the futurepool drip will fire the next level's jackpot (a large payout to current ticket holders), but after that the remaining funds sit idle until the timeout expires and the terminal distribution begins. Under a year of illiquidity in the worst case (the final active level's duration plus the 120-day timeout) is a real cost that players should understand before committing capital they cannot afford to lose.

### 8.6 Conditions for Protocol Failure

**Design Property 8.4** (Game Death). *The protocol reaches GAMEOVER if and only if:*

$$\text{time since last level start} \geq \begin{cases} 365 \text{ days} & \text{if } \ell = 0 \\ 120 \text{ days} & \text{if } \ell \geq 1 \end{cases}$$

This requires that for 120 consecutive days (or 365 at level 0), insufficient purchasing activity occurs to meet the current level's prize pool target and trigger a new level start. A single transaction does not suffice: cumulative deposits must reach $\bar{P}_\ell$, which requires meaningful economic activity.

For any non-trivial accumulated pool (e.g., $P > 10$ ETH), the "buy low" attractor (increasing per-capita value as players leave) makes failure to reach the target improbable under standard rational actor assumptions. But "improbable" is not "impossible," especially at higher levels during bear markets.

**The terminal growth problem.** There is a second, more exotic failure mode: the game succeeds *too well*. Since deposits are irrevocable and prize pools can only grow, a sufficiently long-running game accumulates an ever-increasing fraction of available ETH. At some distant level, the ETH required to start the next level exceeds the ETH that remains outside the system. This is terminal by construction. If the game ever reaches this point, it represents the greatest success in the history of gaming, but it is still terminal. The practical relevance is negligible (this requires the protocol to absorb a substantial fraction of all circulating ETH), but the theoretical completeness matters: the system has a hard upper bound on lifespan even under maximally favorable conditions.

### 8.7 Endgame Distribution

Even in the GAMEOVER state, the protocol provides well-defined terminal payoffs:

1. **Deity pass refunds:** up to 20 ETH/pass (the lesser of price paid and 20 ETH) if GAMEOVER triggers before level 10; no refund at level 10+
2. **Final jackpot:** 90% of remaining assets distributed to the final level's ticket holders
3. **Terminal decimator:** 10% of remaining assets distributed to FLIP burners, weighted by activity score, FLIP burned, and burn timing (earlier burns weigh more)
4. **Final sweep:** After 30 days, unclaimed funds split in thirds across the vault, sDGNRS, and GNRUS

This ensures that accumulated value is distributed rather than destroyed.

**Could someone profit from game death?** Yes, by design. The terminal decimator lets anyone bet on protocol death at any time by burning FLIP, and buying final-level tickets as GAMEOVER approaches is +EV once death is likely enough. This is a feature, not a leak: the death bets are visible on-chain, and every burn pressures ticket holders and rescuers to step in, since the terminal decimator's 10% share comes out of the same pool their positions claim. The doubters get paid either way, and their bets finance the alarm signal that makes quiet death impossible. The active player class will always be larger and better positioned than the death-betting class, because claiming terminal eligibility and preventing the event are the same action.

---

## 9. Comparisons

| Property | DeFi Yield | Speculative Token | Degenerus Protocol |
|----------|------------|-------------------|--------------------|
| Yield source | Staking, lending | New buyers (ponzi dynamics) | Redistribution from degens (individual); stETH yield (protocol-level) |
| Variance | Low (predictable APY) | Extreme (token price) | High (jackpots, lotteries) |
| Engagement | Passive deposits | Buy and hold/shill | Active participation rewarded |
| Token dynamics | Often inflationary | Inflationary (vesting, farming) | FLIP: deflationary; DGNRS: fixed |
| Growth dependency | Moderate | Fatal (requires perpetual growth) | Eventually fatal, but graceful (terminal distribution, not rug) |
| Liquidity | Withdrawable | Liquid (sell anytime) | Non-withdrawable principal (value exits only as prize payouts) |
| Terminal value | Yield stream | Zero | Non-zero (game utility, yield claims) |
| Risk of ruin | Low | Total (token goes to zero) | Moderate (individual outcomes vary) |
| Loser outcome | Opportunity cost | Worthless tokens, no recourse | Fair VRF-verified chances, lost to math not fraud |

**Observation 9.1** (The Bound on Extraction). *Variance deters casual annualized modeling and solo extraction, but it does not stop a wallet-fleet operator who pools variance across many capped wallets and finances the position off the mean. What bounds that operator is stronger than variance: total extractable profit is capped at degen surplus plus yield, no matter how many wallets the fleet runs. The lootbox multiplier is a relative weight, not a yield; a fleet large enough to matter becomes the dominant share of its own prize pool and compresses its own edge toward the yield floor.* Professional capital that does arrive becomes the efficient grinder tier: it extracts the surplus the game always expected someone to extract, deepens the pools with locked capital, and out-competes weaker grinders, not degens and not the protocol. The poker analogy (Section 2.6) still holds for the variance-minimizing nit: every avenue for profit requires high variance, so the nit strategy that kills poker ecosystems has no analog here. Reward velocity is tied to *progression*, not calendar time: rewards unlock as levels are reached, and levels require ETH to enter the system.

The source-of-returns distinction (Section 1) is what separates this from speculative tokens structurally. A memecoin's returns depend on later buyers' capital. This protocol's returns depend on entertainment spending plus yield. The protocol needs ongoing deposits to advance levels, and without them it eventually ends. But the failure mode is a fair terminal distribution, not a rug.

---

## 10. Conclusion: The Resilience Thesis

### 10.1 The Resilience Thesis

The preceding sections built an argument through interlocking mechanisms: cross-subsidy between heterogeneous player types (Section 2), commitment devices that make continued participation dominant (Section 5.5), structural death spiral resistance through locked liquidity and prize concentration (Section 8), and FLIP economics with a built-in price ratchet (Section 6). We now state the central claim.

**Thesis (Structural Resilience).** *Once Degenerus Protocol has reached a state with positive prize pools and at least one rational participant, the game has structural incentives to continue advancing through levels.* These mechanisms are correlated under adverse market conditions, so independence should not be assumed.

**Where the thesis holds:**
- stETH yield rate $r > 0$ (Lido continues functioning)
- At least one rational actor monitors and acts on prize pool opportunities
- Ethereum remains operational
- Smart contract code is free of critical bugs

**Where the thesis fails:**
- Lido staking yield goes to zero permanently (systemic ETH staking failure)
- A prolonged crypto bear market suppresses participation below the level target for 120+ consecutive days, the most plausible failure mode, especially at higher levels where targets are larger (Section 8.5)
- All participants simultaneously cease to value the entertainment product
- A critical smart contract vulnerability is discovered
- Regulatory action prevents all participation globally

We do not claim the protocol is indestructible. We claim it is *structurally resilient*: that its incentive design makes continued operation the default outcome under a wide range of conditions, and that failure requires sustained adverse conditions rather than the simple absence of growth.

**What this means for each participant.** For an EV maximizer, the question is whether the equilibrium point delivers returns that justify the opportunity cost of locked capital. For a degen, the question is whether this is more fun per dollar than alternatives. For an affiliate, the question is whether they can recruit enough players across all types. For a whale, the question is whether the game will progress through enough levels to justify the capital commitment. The protocol cannot answer these questions by design. It can only ensure that if the answers are yes, the incentives align to keep the game running.

**What would confirm or falsify this thesis.** Post-deployment, watch for: (1) the fish-to-grinder ratio stabilizing above the aggregate constraint threshold (Section 2.3), confirming sufficient entertainment demand to fund positive-EV play; (2) quest streak distribution showing genuine daily engagement across accounts; (3) the futurepool growing net across 100-level cycles; (4) FLIP maintaining its ticket-price floor (Section 8.4); and (5) level completion times staying under 30 days at higher levels. Note that GTO play is always +EV before opportunity cost and risk aversion, since stETH yield sets the floor. The question is not whether positive returns exist, but whether they are large enough to attract and retain capital. The protocol is indifferent to whether participants are humans or autonomous agents. Bots and AIs that play optimally are economically identical to human grinders, and the protocol is designed to welcome them as affiliates and active players. If these metrics hold through the first 100-level cycle, the resilience thesis has survived its first real test. If level completion times grow unbounded or the active player count trends to zero despite growing pools, the entertainment assumption has failed and no amount of incentive design will save it.

### 10.2 Limitations

1. **Smart contract risk is the dominant existential threat.** The protocol holds all player deposits in stETH with no withdrawal mechanism. The same locked liquidity that protects against death spirals means a critical contract exploit has no recovery path. A single exploitable bug could drain the entire prize pool permanently. This is an endogenous consequence of the design choice to make deposits irrevocable. The protocol also has two external dependencies: Chainlink VRF is a soft dependency (the creator can migrate to a new VRF coordinator if it breaks), but Lido stETH is a hard dependency (there is no migration path if stETH itself fails).

2. **No empirical validation.** All results are theoretical. A Monte Carlo simulation of 30 levels with realistic player behavior supports the theoretical predictions (Section 8.2), but simulated agents are not real players with real money. Post-deployment observation is needed to confirm predictions.

3. **Correlated failure modes are acknowledged but not fully quantified.** The four progression guarantors share exposure to crypto market sentiment, and the bear market stress test (Section 8.5) is qualitative rather than probabilistic.

4. **The utility model is assumed, not measured.** The non-monetary utility parameters are justified by analogy to the gambling industry, not by direct measurement of this protocol's users. Actual player behavior may diverge.

5. **Cold-start problem is partially addressed.** The cross-subsidy structure requires multiple player types to be present simultaneously. The affiliate program (Section 3.4) is the intended bootstrap mechanism, giving external marketers a financial incentive to recruit the degen player class the game needs. But whether affiliate incentives are sufficient to reach critical mass from zero is an empirical question this analysis cannot answer.

6. **stETH yield is exogenous.** We treat stETH yield as a fixed external parameter (~2.5% APR). A sustained decline in Ethereum staking rewards would not break the protocol, but would reduce minimum returns under GTO play, since yield is the source of value injection that makes the game positive-sum.

---

## Appendix A: Parameter Summary

| Parameter | Symbol | Value | Role in Analysis |
|-----------|--------|-------|-----------------|
| stETH yield rate | $r$ | ~0.025 (2.5% APR) | External value injection |
| stETH yield split | — | 25/25/25/25% accumulator/vault/DGNRS/GNRUS | The accumulator (which also receives 1% of the prize pool at each level completion) half-distributes at century milestones, half retained as terminal insurance |
| Activity score range | $a_i$ | [0, 300] effective | Incentive multiplier; reward curves saturate at 300 |
| Lootbox EV range | $\mu(a)$ | [0.90, 1.45] | Engagement reward |
| Degenerette ROI range | $\rho(a)$ | [0.90, 0.999] | Engagement reward |
| Lootbox EV cap | — | 10 ETH/level/account | Extraction bound |
| Degenerette ETH cap | — | 10% of future pool | Solvency guarantee |
| Coinflip win rate | — | 0.50 | Fair game |
| Coinflip win payout mean | — | 1.9685x | Overall EV per flip: 0.984 (1.575% edge) |
| Affiliate commission | — | 0.20–0.25 | Referral incentive |
| Ticket price range | $p(\ell)$ | 0.01–0.24 ETH | Entry cost scaling |
| Whale pass price | — | 2.4–4 ETH | Catch-up mechanism |
| Deity pass base price | — | 24 ETH + $T(n)$ | Whale commitment |
| Deity pass cap | — | 32 total | Concentration limit |
| Pre-game timeout | — | 365 days | Liveness guard |
| Post-game timeout | — | 120 days | Liveness guard |
| VRF re-request | — | 12 hours | RNG liveness |
| Governance proposal gate | — | 44 hours | VRF recovery |
| Quest daily reward | — | 200 FLIP | Engagement incentive |
| Bootstrap prize pool | — | 50 ETH | Minimum pool guarantee |
| BAF leaderboard reset | — | Every 10 levels | Anti-concentration |
| Jackpots per level | — | 1–5 daily | Distribution frequency (5 normal, 3 compressed, 1 turbo) |
| Scatter share of BAF jackpot | — | 70% (45% + 25%) | Broad distribution |

## Appendix B: BAF Jackpot Distribution Detail

The BAF (Big-Ass Flip) jackpot fires at the end of each 10-level cycle from the future prize pool. The leaderboard tracks cumulative coinflip winnings over the 10-level window and resets after each payout. At normal milestones the jackpot draws 10% of `futurePrizePool` (20% at the level-50 midpoint); at century milestones (x00) this doubles to 20%. Internal allocation of the drawn pool:

- **Top BAF slot:** $10\%$ (highest cumulative coinflip winnings over the window)
- **Top coinflip slot:** $5\%$ (highest single-day coinflip volume)
- **Random pick slot:** $5\%$ (randomly selected from #3 or #4 on the BAF leaderboard)
- **Far-future ticket holder draws:** $5\%$ + $5\%$: two independent draws from far-future ticket holders ranked by BAF score (3% to 1st, 2% to 2nd per draw)
- **Scatter slices:** $45\%$ and $25\%$: 50 rounds of trait-ticket sampling; 1st-place winners from each round share the 45% pool, 2nd-place winners share the 25% pool

Daily jackpot distribution (jackpot phase):
- Days 1–4: a random 6–14% slice of the current prize pool is drawn.
- Day 5: the remaining current prize pool is fully distributed.
- Days 1–4 allocate 20% to each of the four trait buckets, with the remaining 20% assigned randomly; day 5 shifts to a weighted distribution (60% to the leading trait bucket, rotating across days, with the remaining 40% split roughly equally across the other three).
- A 20% ticket-conversion budget is applied to the daily ETH slice.
- Carryover jackpot (days 2–5): 0.5% of `futurePrizePool` moves to `nextPrizePool` as backing; VRF picks a random source level from lvl+1 to lvl+4, and trait-matched holders at that level receive current-level tickets (next-level tickets on day 5).

---

## Appendix C: Model Detail

*Full mathematical formalization of the protocol's parameters and game structure.*

### Key Parameter Summary

**Lootbox EV quick reference:**

| Activity Score | Lootbox EV Multiplier | Entries per entry of ETH spent |
|---------------|----------------------|-------------------------------|
| 0 (new player) | 0.90x | 0.90 (below face value) |
| 0.60 (breakeven) | 1.00x | 1.00 (at face value) |
| 4.00 (curve knee) | ~1.40x | ~1.40 (nearly all of the curve's gain) |
| 300 (effective cap) | 1.45x | 1.45 (above face value) |

The activity score EV benefit on lootboxes caps at 10 ETH per level per account. Activity score also stratifies returns on Degenerette spins (90%-99.9% base ROI) and decimator burns (bucket assignment and burn weight multiplier). The pattern is the same across all products: higher engagement produces better returns.

**Ticket pricing and prize pools.** Ticket prices escalate with level progression in a repeating 100-level cycle, from 0.01 ETH at the earliest levels to 0.24 ETH at century milestones (full pricing table below). Each ticket purchase splits: 90% to the next-level prize pool ($P^{next}$) and 10% to the future prize pool ($P^{fut}$). When the next pool reaches its level target, the level advances.

stETH yield ($r \approx 0.025$ annual) accrues continuously on all locked deposits, the only external monetary value entering the system.

**Transaction costs.** Typical user interactions cost roughly $0.05 in gas at current prices, negligible relative to ticket and lootbox amounts. The protocol consumes more gas during jackpot resolution phases, but players who bear this cost are rewarded with FLIP and must have made a purchase in the previous day to be eligible. Gas is a background cost that does not meaningfully alter the strategic analysis.

**Decimator trigger schedule:**

| Levels | Pool Source | Pool Percentage |
|--------|------------|----------------|
| x5 (5, 15, 25, 35, 45, 55, 65, 75, 85) | futurePrizePool | 10% |
| x00 (100, 200, 300...) | futurePrizePool | 30% |

The decimator is not triggered at level x95. The sequence skips from x85 to x00, where the pool percentage triples. Minimum burn is 1,000 FLIP. Bucket assignment: default 12, drops to 5 at max activity on normal levels, drops to 2 at max activity on x00 levels. Lower buckets have higher weight per FLIP burned in the pro-rata distribution.

### Model and Notation

#### Prize Pool Dynamics

The prize pool evolves according to deterministic accumulation and stochastic distribution:

**Accumulation (Purchase Phase):**
For each ticket purchase of cost $c$ at level $\ell$:
$$P^{next}_\ell \leftarrow P^{next}_\ell + 0.9c$$
$$P^{fut}_\ell \leftarrow P^{fut}_\ell + 0.1c$$

For each lootbox purchase of cost $c$, the split is reversed:
$$P^{next}_\ell \leftarrow P^{next}_\ell + 0.1c$$
$$P^{fut}_\ell \leftarrow P^{fut}_\ell + 0.9c$$

**Level transition:** When $P^{next}_\ell \geq \bar{P}_\ell$ (the level target):
$$P^{curr}_{\ell+1} \leftarrow f(P^{fut}_\ell, t)$$

where $f$ is a time-dependent extraction function with a U-shaped profile: extraction is highest (~20%+) if the level completes very quickly (under 1 day) or very slowly (over 28 days), and lowest (~3%) around the 14-day sweet spot. Additional adjustments apply for milestone levels, pool ratio imbalances, and random variance. The design incentivizes steady progression velocity.

**Yield accrual (continuous):**
$$\frac{dP^{total}}{dt} = r \cdot S$$

where $r \approx 0.025$ is the stETH annual yield rate (approximately 2.5% APR as of 2024–2025) and $S$ is total staked ETH.

#### Ticket Pricing

Ticket prices follow a deterministic schedule that escalates with level progression:

| Level Range | Price (ETH) |
|-------------|------------|
| 0–4 | 0.01 |
| 5–9 | 0.02 |
| 10+, within each 100-level cycle: levels 1–29 | 0.04 |
| 10+, within each 100-level cycle: levels 30–59 | 0.08 |
| 10+, within each 100-level cycle: levels 60–79 | 0.12 |
| 10+, within each 100-level cycle: levels 80–99 | 0.16 |
| 10+, century milestones (100, 200, ...) | 0.24 |

The cycle repeats every 100 levels after level 10, creating a predictable cost escalation that players can plan around. The strategic implications of this cycle, including its interaction with FLIP economics and the crescendo events at century milestones, are analyzed in Section 6.

#### Activity Score and EV Multipliers

The activity score $a_i$ is computed as:

$$a_i = \min\left(\frac{m_i}{50}, 1\right) \cdot 0.50 + \min\left(\frac{c_i}{\ell}, 1\right) \cdot 0.25 + \frac{q_i}{200} + \phi_i \cdot 0.50 + \gamma_i$$

The quest-streak term is uncapped: $q_i$ advances by 1 per completed quest (each of the two daily slots) and by 5 per completed level quest. Every reward curve saturates at an effective score of 300; the stored score saturates far above any reachable value.

where:
- $m_i$ is the purchase streak (consecutive levels with ETH purchases)
- $c_i$ is the purchase count (total levels with purchases)
- $q_i$ is the quest streak counter (quest completions during the current unbroken streak)
- $\phi_i \in [0, 1]$ is the normalized affiliate bonus
- $\gamma_i \in \{0, 0.10, 0.40, 0.80\}$ is the pass bonus (none, 10-level whale, 100-level whale, deity)

The activity score maps to a relative EV $\mu: [0, 300] \rightarrow [0.90, 1.45]$ for lootboxes:

$$\mu(a) = \begin{cases}
0.90 + \frac{a}{6} & \text{if } a \leq 0.60 \\
1.00 + \frac{(a - 0.60) \cdot 0.395}{3.40} & \text{if } 0.60 < a \leq 4.00 \\
1.395 + (a - 4.00) \cdot 0.044 & \text{if } 4.00 < a \leq 5.00 \\
1.439 + \frac{(a - 5.00) \cdot 0.011}{295} & \text{if } 5.00 < a \leq 300 \\
1.45 & \text{if } a > 300
\end{cases}$$

And to a Degenerette ROI $\rho: [0, 300] \rightarrow [0.90, 0.999]$, mapped piecewise: 0.90 at zero rising steeply to ~0.989 at 3.05, ~0.997 at 5.00, then crawling to 0.999 at the effective cap.

The key thresholds: at $a_i = 0.60$, lootbox EV reaches 1.00 (break-even). Above 0.60, lootboxes are positive EV. The Degenerette curve delivers nearly all of its gain by $a_i = 3.05$, while lootbox EV keeps climbing steeply to ~1.40x at $a_i = 4.00$ — a level reachable only through a sustained quest streak, since that component is uncapped. Past their knees both curves flatten, crawling to their 0.999 and 1.45x maxima at the effective cap. Note that the Degenerette base ROI understates the effective return for high-activity players in two ways. First, 75% of the ETH payout is delivered as lootboxes, and lootboxes are worth up to 1.45x at high activity, so a player who would buy lootboxes anyway receives more than face value on that component. Second, ETH Degenerette bets receive a +5% ETH bonus on high-match outcomes, which is not reflected in $\rho(a)$. Together, these make Degenerette ETH bets individually +EV for high-activity players, not merely near-zero edge.

**Additional lootbox value.** The $\mu$ multiplier accounts for ticket and FLIP-equivalent value from lootbox rewards. Lootboxes also award DGNRS tokens (from a reward pool, scaled by lootbox size) and boons (random bonuses including purchase boosts, coinflip boosts, activity score points, and occasionally whale passes or deity pass discounts). These components are harder to quantify because DGNRS value depends on market price and boon value depends on whether the player uses them optimally. They represent additional upside beyond the multiplier, but we omit them from the formal EV calculations to keep the analysis conservative. Several reward components also resolve as live Degenerette spins drawn from the box rather than flat awards (the WWXRP award, a slice of the FLIP, and a slice of ticket/ETH value), adding spin-reel variance and engagement at unchanged expected value per category.

See Section 2.3 for the aggregate constraint on these multipliers.

---

### Protocol Architecture

#### The Stage Game at Level $\ell$

Each level $\ell$ defines a stage game with two phases:

**Phase 1: Purchase (variable duration).** Players simultaneously choose actions from their action sets. The purchase phase continues until the prize pool target is met: $P^{next}_\ell \geq \bar{P}_\ell$.

**Phase 2: Jackpot (5 logical days of draws; 1–5 physical days depending on how fast the level filled).** On days 1–4, a random 6–14% of $P^{curr}_\ell$ is distributed to winners selected by VRF from the trait-ticket pool; on day 5, 100% of the remaining $P^{curr}_\ell$ is distributed. Fast fills compress the schedule (3 physical days at purchase phase ≤ 3 days, 1 at ≤ 1 day).

**Transition:** After the jackpot phase completes, $\ell \leftarrow \ell + 1$ and Phase 1 begins for the next level.

For the BAF (Big-Ass Flip) jackpot, triggered every 10 levels from the future prize pool, 100% of the draw is distributed across the top BAF and top-coinflip leaderboard positions, a random leaderboard slot, far-future ticket holder draws, and scatter slices. (Exact slice percentages are in Appendix B.)

**Ticket timing and EV.** Not all tickets at a given level have equal expected value. A ticket purchased early in the purchase phase is eligible for the daily purchase-phase reward (1% of the futurepool drawn each day: 75% to the nextpool as drip tickets, 25% paid as ETH prizes to trait holders), all 5 daily jackpot draws during the burn phase, and any future-level FLIP draws it accumulates while waiting. A ticket purchased just before the level target is met catches all 5 burn-phase draws but misses the purchase-phase rewards. And tickets purchased mid-jackpot phase only participate in the remaining daily draws. Since day 5 distributes 100% of the remaining current prize pool, all tickets share in the largest single payout regardless of timing. But the cumulative expected value of early tickets is strictly higher than late tickets at the same level, because they are eligible for more drawings. This creates an incentive to purchase early in a level rather than waiting, which in turn accelerates pool growth and level completion. It also means that the per-ticket EV varies within a single level depending on when the ticket was acquired, further complicating any attempt to assign a single "EV per ticket" number.

This timing differential is itself a cross-subsidy mechanism. A degen buying tickets late in a level is making a clearly worse-EV choice compared to buying early. But the degen is not optimizing for EV. They want a shot at the jackpot *today*. The protocol satisfies that preference: you can always buy a ticket and immediately be eligible for the next draw. The cost of that immediacy (fewer total draw opportunities per ticket) is a surplus that benefits early buyers and the system as a whole. The degen gets what they want ($\Psi$ from an imminent jackpot shot), and the system gets what it needs (late-arriving deposits that grow the pool for remaining draws).

#### Trait Assignment: No Strategic Selection

The trait-ticket system assigns each ticket to one of 256 traits (4 quadrants × 64 trait values). Jackpot distributions select winning traits, meaning players benefit from holding tickets with traits that match winning draws.

Critically, trait assignment is *deterministic from VRF entropy*: players cannot choose their traits. Trait generation is a pure function of the player's position in the ticket queue and a VRF-derived entropy seed committed in a prior block. Neither can be influenced by the purchasing player at the time of their transaction. This eliminates the coordination problem that would otherwise arise (players clustering on popular traits) and converts what could be a complex coordination game into a simple lottery with equal per-ticket odds.

#### Hero Symbol Override

There is one partial exception to pure-VRF trait selection. Each daily jackpot draw, the system identifies the **hero symbol**: the symbol that received the most ETH wagered in Degenerette bets that day. This symbol auto-wins its own quadrant in the jackpot draw (with a random color still determined by VRF), replacing only that one quadrant's outcome.

This creates a direct feedback loop between Degenerette betting and jackpot outcomes. But the influence is narrowly bounded:

- It affects only 1 of 4 quadrants (the hero symbol's category).
- Within that quadrant, it fixes only the symbol (1 of 8), not the color (1 of 8). So the hero override constrains the winning trait to 1/8 of the quadrant's possible outcomes, not a single trait.
- Players cannot choose which traits their tickets receive (trait assignment is VRF-deterministic), so knowing which symbol will win a quadrant does not let you concentrate tickets on it.
- Degenerette bet placement is itself a coordination problem with no dominant strategy: the hero symbol is determined by aggregate wagering, and any individual bettor's influence on the outcome is diluted by total volume.

The net effect is that Degenerette activity injects a small amount of predictable structure into the otherwise random draw, rewarding the most-wagered symbol's holders. Like most edges in Degenerus Protocol, this rewards engaged players who track hero symbol trends, but the edge is small, competitive (other players see the same information), and bounded by VRF trait assignment they cannot control. The -EV trap is playing Degenerette specifically to push a symbol to hero status when the expected jackpot edge doesn't justify the Degenerette bet, or when another player outbids you and you end up with a losing Degenerette position and no hero influence at all. The mechanism offers real but modest upside to those who use it well, not a loophole.

#### Liveness Guarantee

**Design Property** (Liveness). *The game satisfies liveness under the assumption that sufficient purchasing activity occurs to meet the level's prize pool target and trigger a new level start within 120 days of the previous level's start (365 days at level 0). The following mechanisms support this:*

1. *Multiple independent progression guarantors* (quest streaks, afKing subscriptions, affiliate referrals, and the 15% futurepool transfer each level that compensates preexisting ticket holders) all contribute independently to nextpool growth. Note: stETH yield and the 1% level-completion skim accrue in the segregated accumulator (distributed at century milestones and in the terminal payout) and do not directly contribute to the nextpool target.
2. *Futurepool drain:* Daily, a portion of the futurepool drains into the nextpool, awarding the equity in tickets to current ticket holders. Once the futurepool reaches a sufficient multiple of the nextpool requirement, this mechanism alone guarantees the next level will fire even with zero new player activity. However, this is a one-shot guarantee: if activity remains at zero, the futurepool will be insufficient to cover subsequent levels.
3. *VRF re-request:* If the VRF callback is not received within 12 hours, any player can re-request a VRF word, preventing transient stalls.
4. *Emergency VRF recovery:* After a 44-hour stall, the admin can propose a VRF coordinator swap. Execution requires sDGNRS holder governance approval. After 7 days, any sDGNRS holder with 0.5%+ of circulating supply can propose independently.
5. *Graceful termination:* If no new level starts within the timeout, the game transitions to GAMEOVER, a well-defined terminal state with full prize distribution.
6. *VRF-death deadman:* If randomness dies permanently during the jackpot phase, a deadman fires once no day has completed for 120 days and forces terminal fund release. The game cannot brick mid-drain.

---

## Appendix D: Attack Vector Analysis

#### Attack 1: Sybil Attack on Activity Score
**Vector:** Single entity creates multiple wallets to farm activity score bonuses.
**Analysis:** Each wallet must independently purchase tickets, complete quests, and maintain streaks, all with real ETH cost. The marginal cost of maintaining $k$ sybil accounts scales linearly, while the marginal benefit (activity score EV benefit caps at 10 ETH/level/account) also scales linearly. No superlinear advantage exists.
**Verdict:** Not economically advantageous.

#### Attack 2: Degenerette Pool Drain
**Vector:** High-activity player places maximum ETH wagers, exploiting near-parity ROI.
**Analysis:** ETH payouts are hard-capped at 10% of the future prize pool per spin. The 8-match jackpot is astronomically rare. Even at the maximum configured ROI, net extraction per spin is marginal. The 75% lootbox payout component converts extraction into future game participation.
**Verdict:** Not a threat. Caps and lootbox conversion prevent meaningful pool drain.

#### Attack 3: Affiliate Self-Referral Loop
**Vector:** Player refers themselves to capture commission on their own purchases.
**Analysis:** The protocol explicitly blocks self-referral (locks referral to VAULT sentinel permanently), and the contract skips commission payments to the buyer's own address, so an A-B-A loop returns less than it appears. Cross-referral between colluding accounts is cheap to set up, but the benefit is limited to FLIP commissions (no activity score boost unless both accounts are active players), the lootbox taper cuts commission rates to 5% on high-activity buyers, and extraction comes from the affiliate FLIP emission pool rather than ETH prize pools.
**Verdict:** Low impact. The lootbox taper and self-payment skip make cross-referral a bounded, self-limiting leak. Does not threaten ETH solvency.

#### Attack 4: stETH Depeg Event
**Vector:** Lido stETH trades at a discount to ETH, as it briefly did in June 2022 at ~0.93:1, devaluing staked prize capital.
**Analysis:** That discount existed because beacon-chain withdrawals did not exist yet, so stETH had no redemption path and traded on secondary liquidity alone. Withdrawals have been live since April 2023 and stETH redeems 1:1 through Lido's queue, so a discount is now a transient liquidity gap standing against an open redemption arbitrage. Staking is gated on the claim reserve: the stake call excludes claimable winnings other than the vault and sDGNRS balances, which settle in stETH natively, and reverts if the stake would dip into it. Claims pay ETH first and fall back to stETH, so if payouts outrun deposits and everyone cashes out at once, late claimants settle in stETH instead. They are paid in full either way. The asset a claim settles in can change. The amount cannot.
**Verdict:** Not a threat.
