# Why This Game Doesn't Die: A Game-Theoretic Analysis of Degenerus Protocol

*Burnie Degenerus*

**Working Paper, Draft for Review**

---

## Abstract

Different player types in Degenerus Protocol pursue different rewards and, in doing so, generate positive externalities for each other. Entertainment seekers fund prize pools through lootbox and Degenerette purchases. Strategic players optimize engagement to extract monetary value. Whales inject capital through passes and earn compounding returns. Affiliates recruit players for commission income. This cross-subsidy structure, combined with commitment devices (future tickets, streaks, auto-compounding) and a prize pool that can only grow, creates structural resistance to death spirals. The protocol is zero-rake: player deposits are locked, converted to stETH (~2.5% APR yield), and redistributed as prizes. No outside entity extracts an ongoing percentage. This paper formalizes these dynamics, characterizes equilibria, and identifies the conditions under which the system's resilience holds.

---

## 1. Introduction

Traditional gambling systems operate under a well-understood extractive model: the operator takes a large cut of every dollar wagered (40-60% in state lotteries, 2-15% in casinos), and players accept deeply negative expected value in exchange for entertainment and variance. This model is sustainable but adversarial: the operator profits from player losses, creating a negative-sum dynamic for participants.

Degenerus Protocol proposes a structural alternative: a *zero-rake* gaming system where no outside entity extracts value from player deposits. Deposits are locked, converted to Lido staked ETH (stETH), and redistributed entirely as prizes to other players. The stETH earns approximately 2.5% annual yield, which is the only external value entering the system. Prizes are funded primarily by other players' deposits, with yield providing a small positive-sum margin. This architectural choice transforms the underlying game from negative-sum to slightly positive-sum for the player pool as a whole, introducing fundamentally different strategic dynamics.

This paper analyzes these dynamics. We are interested in three central questions:

1. **Dominant strategies and stability.** Does the game possess dominant strategies? Are they stable under perturbation? What strategy profiles constitute equilibria?

2. **Incentive alignment.** Does the mechanism design ensure that individually rational behavior by each player type strengthens rather than weakens the system? Under what conditions might incentives become misaligned?

3. **Robustness and resilience.** How does the system withstand adversarial behavior, coordinated attacks, player exodus, and extreme market conditions? What structural properties make it resistant to death spirals?

Before diving into formalism, here is the paper's central argument in plain language: **Degenerus Protocol works because different types of players want different things, and getting what they want individually produces collective goods.** Entertainment seekers buy lottery tickets and lootboxes for the thrill, funding the prize pools in the process. Strategic players optimize their engagement to extract monetary value from those pools. Whales lock large capital into passes that only pay out over time, publicly demonstrating long-term commitment to the system in exchange for compounding returns. Affiliates recruit and retain players, growing the participant base for commission income. Each group's self-interest produces something the others need: degens fund the pools, strategists drive progression, whales stabilize capital, and affiliates grow the player base. The yield from stETH injects external value that makes the whole system positive-sum. And the commitment devices (future tickets, quest streaks, auto-compounding) create a ratchet that makes continued participation the dominant strategy for anyone already engaged.

That is the thesis. The rest of this paper formalizes it, stress-tests it, and maps its limitations.

**Try it yourself.** The demo below shows four consecutive daily jackpot draws. Click "Next Day" to cycle through scenarios. Each day, four random traits are drawn and lock into a 4-quadrant grid. If you hold tickets matching those traits, scratch to reveal your prizes (ETH, future tickets, or BURNIE). Click the center flame to skip the animation. This is a beta mockup for illustration only; the final UX will differ.

<!-- JACKPOT_WIDGET -->

The scenarios above illustrate *what happens*. The rest of this paper explains *why this structure is stable*.

**The critical assumption.** State lotteries and memecoins prove that people pay for gambling entertainment at massive scale, even with terrible odds. Degenerus offers this audience verifiably fair odds, 0% rake, and the possibility of positive EV through engagement. The affiliate program (Section 3.4) can bring players to the door, but it cannot make them stay if the product is not fun. Whether *this specific product* captures enough of that demand is an empirical question. The analysis that follows takes the entertainment condition as given: enough people find the game entertaining enough to play. That condition strengthens as jackpot sizes grow, since larger prizes make the game more attractive to exactly the entertainment-seeking players who sustain it.

**A note on source of returns.** The surface similarities to a memecoin launch are real: degens chasing excitement, whales deploying capital, early participants with structural advantages, a creator holding a token allocation. But the source of returns is fundamentally different. A shitcoin's returns come from later buyers' capital; when the music stops, late entrants hold worthless tokens. Degenerus Protocol's returns come from stETH yield (external, real, perpetual) and from the voluntary spending of entertainment-seeking players getting a product they value. The prize pool cannot decrease. There is no rug to pull because funds are locked in a contract with no admin withdrawal function (the admin's only power is emergency VRF coordinator migration after a 3-day stall; see Section 7.3). Players who end up net negative lost to math and luck, not to fraud. The protocol does need ongoing deposits to keep advancing levels, and without them the game eventually ends. But the failure mode is fundamentally different: a shitcoin that stops growing leaves latecomers holding worthless tokens with no recourse. A Degenerus game that stops growing triggers a terminal distribution where all remaining funds are redistributed to participants through one last round of fair, high-variance jackpots (Section 8.7). Players may lose money, but they are never rugged. Section 9 explores these comparisons in detail.

---

## 2. The Core Idea: Cross-Subsidy Structure

**Definition 2.0 (The Entry).** *One entry is one-quarter of a ticket: the atomic unit of participation, representing a single jackpot draw for the upcoming level. Its face-value cost is $P_\ell / 4$ ETH or 250 BURNIE. The BURNIE price is fixed permanently regardless of level progression; as ETH ticket prices escalate, BURNIE's ETH-equivalent entry cost rises monotonically (Section 6.1). FLIP credit converts to BURNIE at approximately face value (~98.4% EV) and is treated as equivalent throughout.*

*An EV multiplier of $\mu$ means $\mu$ entries of expected value returned per face-value entry of ETH spent. The baseline is one entry purchased with no rebates, no activity score bonus, and no lootbox multiplier. BURNIE rebates are valued at 250 BURNIE = 1 entry — a floor; BURNIE deployed toward higher-value uses than tickets returns more.*

*Entry acquisition rates for common purchase strategies:*

| Strategy | EV multiplier |
|---|---|
| BURNIE ticket | 1.00 |
| New ETH ticket | 1.10 |
| Recycled ETH, partial reinvestment | 1.20 |
| Recycled ETH, full reinvestment | 1.30 |
| Lootbox, zero activity score | ~0.80 |
| Lootbox, breakeven activity score | ~1.00 |
| Lootbox, maximum activity score | ~1.35 |
| Lootbox, max activity + full reinvestment | ~1.45 |
| Standard auto-rebuy | 1.30 |
| afKing auto-rebuy | 1.45 |

*Lootbox rates reflect ticket EV at the stated activity levels. Additional EV sources (DGNRS rewards, deity boons) are not included. ETH ticket purchases include FLIP rebates: 100 for new deposits, 200 for partial recycling, and 300 for full recycling. The full-reinvestment bonus adds +0.1 entries by the same mechanic as the full-rebuy ticket bonus. Auto-rebuy multipliers (1.30 standard, 1.45 with lazy pass) are fixed; both forgo the BURNIE rebate that manual purchases receive.*

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

The critical assumption (Section 1) established that the system depends on entertainment value. Here we note what contributes to it. The primary source is gambling entertainment: lootbox anticipation, jackpot draws, near-miss excitement, Degenerette variance. The protocol also provides BURNIE, a token with a structural price ratchet (Section 6.1) that gives participants the "number go up" experience that drives memecoin engagement, backed by actual utility rather than hype. Status, narrative participation, community belonging, and the satisfaction of contributing to meaningful collective goals provide additional $\Psi$ for whales and engaged players. These are real but secondary.

### 2.3 The Cross-Subsidy Mechanism

The heterogeneous utility structure creates what we term a **cross-subsidy structure**: each actor type's pursuit of their primary reward currency generates positive externalities in a different reward dimension that benefits other types.

**Definition 2.1** (Cross-Subsidy Structure). *A system has cross-subsidy structure when each player type, by doing what is best for themselves, produces something valuable for the other types as a side effect.*

The flow table below describes the cross-subsidy structure under the assumption that each type plays their type-optimal strategy (characterized in Section 3). Section 5.1 verifies that this constitutes a dominant strategy: no player type benefits from unilateral deviation, regardless of what other players do.

Degenerus Protocol exhibits the following cross-subsidy flows:

| Action | Actor Gets | Who Else Benefits |
|--------|------------|-------------------|
| Degenerette (ETH) | $\Psi$ (thrill) | **Grinders:** deeper extraction pool. **Everyone:** ETH added to future prize pools. |
| Degenerette (BURNIE) | $\Psi$ (thrill) | **BURNIE holders:** deflationary pressure raises the price floor. |
| Lootbox (below breakeven) | $\Psi$ (surprise) | **Grinders:** the lost margin is the surplus that funds their +EV extraction. |
| Lootbox (above breakeven) | $M$ (+EV return) | **Degens:** grinder deposits fund a prize pool large enough for real jackpots. |
| Ticket purchase | $\Psi$ (jackpot entry) | **All pool participants:** the primary mechanism filling the current level's prize pool target. **Grinders:** tickets are -EV and activity score doesn't change that, so every ticket purchase contributes margin to the surplus pool that high-activity players extract from lootboxes. |
| Score maintenance | Deferred $M$ (higher EV) | **Affiliates:** active high-scorers generate more commissions per referral. |
| Deity pass | $\Psi$ (status) + deferred $M$ | **Everyone:** 24+ ETH injected into pools at once; fastest single lever for pool growth. |
| BAF leaderboard | $\Psi$ (competition) + $M$ | **BURNIE holders:** heavy coinflip volume burns supply, supporting the price floor. |
| Affiliate referral | Deferred $M$ (commissions) | **Everyone:** each recruited player adds ETH deposits to all shared pools. |
| Daily coinflip | $\Psi$ (ritual) + deferred $M$ | **BURNIE holders:** sustained daily burn compounds deflationary pressure. |
| Quest streak | Deferred $M$ (score growth) | **Everyone:** consistent daily volume anchors level progression for all pool participants. |
| Deity boon | $\Psi$ (patronage, social capital) | **Boon recipients:** discounted purchases and special benefits granted directly by the deity. Non-transferable and capped at 3/day — deity status becomes a social role with real dealmaking power that no automated mechanism produces. |

**A concrete example.** Player A (a degen) spends 0.1 ETH on a Degenerette spin at zero activity score. At the protocol's configured 90% ROI for that activity level — 0.90x multiplier — they lose 0.01 ETH in expectation. That 0.01 ETH flows into the prize pool system. They receive entertainment in return: the 8-trait match resolution, the near-miss excitement, the 100,000x jackpot dream. Player B (an EV maximizer) has a 3.05 activity score and opens a 1 ETH lootbox. The protocol applies a 1.35x multiplier (1.35x), so B's nominal expected value is 1.35 ETH from the pool (much of it as future tickets and tokens that pay out over time, not immediately). Whether B actually realizes this fully depends on pool composition (see aggregate constraint below). Player A got entertainment. Player B got profit. Neither depleted the other's reward: Player A's thrill is undiminished by Player B's extraction, and Player B's monetary return is funded by the prize pool (which Player A's spin helped fill), not by Player A's wallet directly. The system is not creating value from nothing. B's surplus comes from the aggregate pool, which is funded by deposits from players like A (plus stETH yield). If fewer A-type players deposit, B's pool shrinks accordingly.

**The aggregate constraint.** Each player has an **activity score** from 0 (new) to 3.05 (maximum), computed from engagement metrics (purchase consistency, quest streaks, affiliate activity, pass bonuses; formula in Appendix C). The score determines EV multipliers across all products: lootbox purchases range from 0.80x at zero activity (below face value) to 1.35x at maximum activity (above face value). The 1.35x multiplier at maximum activity score is a protocol parameter, not a guaranteed realized return. What a player actually receives depends on pool composition. There is an equilibrium activity score at which lootboxes become +EV. In a world where every player is a GTO maximizer and the only system yield is stETH, this breakeven point would be close to the maximum score (since the only surplus is yield). The more non-GTO players in the system, the further down the breakeven point falls, and the more profitable things are for everyone in the +EV cohort. What matters is the ETH volume on each side of this line, not the number of players. A single whale buying 10 ETH of lootboxes at low activity contributes more surplus than ten players buying 0.1 ETH each.

The equilibrium self-corrects. If too many grinders extract above breakeven, the pool's surplus shrinks and realized returns decline. Some grinders leave (they are money-sensitive), which restores returns for those who remain. When a +EV player exits, their share of future profits is returned to the system, lowering the breakeven bar for everyone else. The equilibrium point shifts, but never breaks, because the entertainment-seeking side is largely insensitive to the grinder population. A degen's lootbox is just as fun to open regardless of how many extractors are in the pool. Throughout this paper, specific EV figures (like the 1.35x lootbox multiplier) refer to protocol multipliers at the stated activity levels. Realized returns are always equilibrium-dependent.

This is structurally different from casinos, where the house extracts from players. Here, there is no house, only a community of differently-motivated actors whose interactions produce mutual benefit. The cross-subsidy is *mutualistic*, not adversarial.

A critical pattern in the flow table above is temporal: **the system receives ETH now, while most player rewards are deferred and contingent on continued participation.** Deity pass value compounds over future levels, activity score EV advantages require daily upkeep, BAF positions pay out only at milestone levels, and affiliate commissions must still survive a coinflip. Players therefore pay upfront and realize value gradually. This is not exploitative (the deferred rewards are real and often substantial), but it creates a retention ratchet where the rational response to having invested is to keep playing and maximize realization. It also creates three distinct incentives for affiliate activity among invested players: commissions arrive as BURNIE income, new deposits accelerate level progression (pulling forward the referrer's own future ticket and BAF payouts), and a third that is harder to price. Degenerus is simultaneously a ruthless competition and a cooperative project. Every player benefits when the level advances, and recruiting new players is the single highest-leverage action any individual can take toward that shared goal. Players who internalize this find affiliate activity self-motivating in a way no financial incentive can replicate. The protocol cannot manufacture that sense of shared mission, but it can be cultivated.

The competitive nature of Degenerus underlies everything without being socially front-and-center. Much of the competition is indirect: a fellow EV maximizer who misses a quest day and resets their streak benefits you, but you had no hand in it. At the same time, many incentives are fully aligned even between the most self-interested participants. A new player entering the pool is good for everyone. The communal goals carry weight precisely because of the competitive foundation beneath them. Pure cooperative projects, untethered from real stakes, do not sustain belief. Everyone winning forever with no losers is not a premise serious players entertain. Players recognize the artifice. When cooperation emerges from a system where everyone has genuine self-interest and real skin in the game, the alignment feels earned rather than engineered. Contributing to the collective goals in a tangible and public way, bringing in a new player, advancing the level, carries a satisfaction that sits outside the financial calculus entirely.

### 2.4 Non-Depletion of Cross-Subsidies

**Observation 2.1** (Non-Depletion of Cross-Subsidies). *In the cross-subsidy equilibrium, no actor type's extraction catastrophically depletes the reward supply for other types. Non-monetary rewards ($\Psi$) are mostly non-rivalrous (one player's excitement does not reduce another's), though positional goods (deity passes, BAF leaderboard) are rivalrous and bounded (32 passes, 10-level resets). Monetary rewards ($M$) are funded by external yield ($r \cdot S$) plus the zero-rake recycling of player deposits, but high-activity players' above-1.0 multipliers are funded by low-activity players' below-1.0 multipliers (see Section 2.3). If the ratio of high-activity extractors to low-activity donors shifts, the equilibrium adjusts as described above: more extractors means lower returns per extractor, not system failure. The ratio self-corrects because the money-sensitive side (grinders) adjusts while the money-insensitive side (degens) provides a stable base.*

### 2.5 Implications for the Analysis

The heterogeneous utility model has two important implications:

1. **The active participation equilibrium is more robust than monetary analysis alone suggests.** A degen has multiple ways to play at different EVs (lootboxes, Degenerette spins, ticket purchases, coinflips), all of which are monetarily negative at low activity scores. Under pure monetary utility, this violates individual rationality. But degens do not care about money. They care about excitement. The protocol is designed to maximize $\Psi$ delivery: lootbox rewards arrive as *more gambling products* (future tickets, BURNIE for Degenerette, boons), so a single lootbox open produces a cascade of further gambling opportunities. This is double the entertainment per dollar compared to a casino, where winnings arrive as cash and the gambling is over. If the entertainment value exceeds the monetary loss, participation remains individually rational. The gambling industry proves this condition holds at population scale for products with far worse odds and far less entertaining reward structures.

2. **Player retention has a ratchet effect.** As engagement deepens (longer streaks, higher activity scores, more future tickets), the non-monetary switching cost ($\Delta\Psi$ from breaking streaks, abandoning progression, losing status) compounds on top of the monetary switching cost ($\Delta M$ from forfeiting future tickets and EV multipliers). The total switching cost (monetary + non-monetary) grows faster than either component alone.

### 2.6 The Poker Ecosystem Analogy

The player type ecosystem maps closely to poker. In poker, **recreational players** deposit money for entertainment and lose at varying rates. **Professional grinders** extract monetary value through disciplined play. **Competitive recreationals** genuinely enjoy the game but wouldn't play if winning weren't possible. Their entertainment *is* the competition: skill matters, outcomes have real stakes, and meaningful competition requires meaningful consequences. This is the broadest category: some lean toward gambling excitement, some toward competitive strategy or profit, some toward the social experience, and many enjoy all three at once.

The critical insight from poker: **the ecosystem is healthy when recreational players have a good time.** If the fish are miserable, they leave. If the fish leave, the grinders have no one to extract from. If the grinders leave, the games die. Poker ecosystems characteristically die by catering to grinders: rooms offer 50-70% kickback to high-volume pros, optimizing for volume over fun, and fun is the only reason recreational players show up. Taken to its logical conclusion, some sites tried eliminating rake entirely. They never gained traction. Fish do not choose rooms based on rake. They choose based on fun, brand recognition, and where their friends play. Removing rake attracted grinders but did nothing to attract fish, and without rake revenue there was no marketing budget to acquire fish through other channels. The result was a few tables of grinders playing each other near breakeven, where the worst grinders lose a little, notice immediately (because they are there for money), and leave, shrinking the pool until nobody is left. The lesson: rake is not inherently bad. What matters is where the money goes. Operator profit does nothing for the ecosystem. Player acquisition and retention do everything.

Degenerus Protocol solves both problems. It is zero-rake, but the player acquisition function that rake normally funds is built into the protocol. The affiliate program pays 20-25% commission on referred players' purchases, funded by BURNIE mechanics rather than by skimming deposits. Affiliates extract value, but only in direct proportion to the new money they bring in. Every player is a potential recruiter with multiple financial incentives to grow the game. Rake-free poker had no way to pay for acquisition; Degenerus pays for it out of protocol mechanics that exist whether or not anyone is recruiting. And the protocol is structurally resistant to grinder takeover: every avenue for profit requires high variance (jackpots are lotteries, coinflips are 50/50, Degenerette spins are high-volatility), so the variance-minimizing nit that kills poker ecosystems has no viable strategy here. Variance functions as a defensive moat against extractive capital (formalized in Observation 9.1).

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
2. *Maximize activity score* $a_i \rightarrow 3.05$ (quest streak, purchase streak, affiliate engagement, pass bonus)
3. *Purchase ETH lootboxes at maximum activity score using full reinvestment* (protocol multiplier $\mu = 1.35$ plus a +0.1 full-claimable bonus — 1.45x total — capped at 10 ETH of lootbox purchases per level)
4. *Place ETH Degenerette bets at max activity* (protocol ROI $\rho = 0.999$ — 0.999x at base — with an additional +5% EV bonus on ETH bets concentrated in higher-match payouts, giving ~104.9% effective returns (~1.049x) before accounting for lootbox delivery at 1.35x)
5. *Play enough Degenerette to consume the full 10 ETH lootbox EV benefit* through Degenerette lootbox wins, maximizing the compounding EV advantage
6. *Enable afKing auto-rebuy* (1.6% base + deity bonus compounding on wins)
7. *Acquire deity pass early if bankroll permits* (permanent +80% activity bonus, but 24+ ETH upfront)

*Argument.* Activity score $a_i$ is monotonically increasing in streak lengths and participation breadth. Higher $a_i$ increases $\mu(a_i)$ and $\rho(a_i)$, both of which increase the player's weight in prize distribution. At $a_i = 3.05$, Degenerette is genuinely positive EV for players who would buy lootboxes anyway (see Appendix C for the lootbox delivery mechanism). All of these returns draw from the same aggregate pool, so the strategy's profitability depends on sufficient pool inflows from other participants.

One subtlety on afKing auto-rebuy: it converts winnings to random near-future level tickets at 130% face value (standard) or 145% with a lazy pass (1.30x and 1.45x respectively), but does *not* award BURNIE on auto-rebuy purchases (unlike manual purchases which do). The real advantage over manual reinvestment is convenience and a better ticket rate, though the headline entry rate overstates the net benefit since it forgoes the BURNIE rebate — which manual ticket purchases convert to an additional ~0.10x at the floor rate.

### 3.3 The Whale

Whales can participate profitably on monetary returns alone. Status is an additional payoff for those who value it, not a requirement.

**High-payoff actions:** Early deity pass acquisition (quadratic pricing favors early buyers: cost = $24 + T(n)$ ETH where $T(n) = n(n+1)/2$, which simultaneously maximizes $\Psi$ via scarce status and $M$ via permanent +80% activity bonus), whale bundle purchases at early levels (~2.5x face value coverage), BAF leaderboard domination through large coinflip stakes, stacking deity pass with afKing mode for enhanced recycling, and issuing deity boons to other players (up to 3/day). Boons provide discounted purchases and special benefits; they cannot be sold or transferred, only granted directly, so deity status produces social interaction and dealmaking rather than impersonal market transactions.

**Observation 3.2** (Whale Extraction Is Bounded). *Whale extraction is bounded by explicit per-mechanism caps (lootbox EV-benefit cap, Degenerette per-spin payout caps, and finite BAF slices). Extraction analysis should use mechanism-specific upper bounds rather than a single aggregate constant.*

**Deity pass EV clarification.** Deity passes receive virtual jackpot entries equal to 2% of their symbol's bucket size (minimum 2 entries per draw). Their share scales proportionally with ticket volume, so they cannot dominate jackpots as the game grows. Their EV advantage comes from three sources: the permanent +80% activity score bonus (which non-deity players can match through other components at maximum engagement), perpetuity (deity entries are drawn automatically every level, forever, requiring no further purchases), and a 25% bonus on all affiliate commissions paid at the end of each level. A deity holder who goes inactive still accumulates jackpot entries and BURNIE draws indefinitely. The affiliate bonus compounds the value of referral networks for deity holders, adding a revenue stream that scales with the game's growth. The 32-pass cap limits concentration.

### 3.4 The Affiliate

Affiliates earn 20–25% commission on referred players' ETH purchases, paid as FLIP credits that must pass through a 50/50 coinflip to convert to BURNIE tokens. The effective extraction is denominated in BURNIE, not ETH, and subject to both coinflip variance and BURNIE price risk. The nominal commission rate overstates the actual ETH-equivalent extraction, since the coinflip conversion has slightly negative EV (~98.5% of nominal value in expectation).

**Best-response heuristic:** Build referral network early, set kickback to balance volume vs. margin (competitive pressure drives kickback toward 25%, analogous to Bertrand price competition).

**The affiliate's hidden contribution.** The formal model captures affiliates as commission-earning referrers. But affiliates produce something harder to measure: they convert people who would not have otherwise participated into active players. Through marketing, social influence, education, community building, or simple persuasion, affiliates reduce the activation energy for new participation. This is a genuine and substantial positive externality for the entire system. Every player an affiliate brings in adds deposits to the pool, draws to the jackpots, and liquidity to the BURNIE market. The affiliate is compensated in BURNIE commissions, but the system-level value of the players they recruit far exceeds that commission. This makes affiliates the primary solution to the cold-start problem (Section 10.2, Limitation #5).

**Observation 3.3** (FLIP Variance Filter). *The coinflip payout mechanism acts as a self-selection filter: sufficiently variance-averse affiliates rationally select out, while variance-neutral or variance-seeking affiliates remain.* A lootbox taper further reduces commissions on high-activity referrals to 25% of the base rate, reflecting that the game's own retention mechanics have taken over from the affiliate's recruitment value.

### 3.5 The Hybrid

The typology above presents clean archetypes. Reality is messier. Most players are not pure degens or pure grinders but somewhere in between. The **hybrid** is anyone on this spectrum: a broad category spanning from near-degen (plays for fun, likes that winning is possible) to near-grinder (plays to win, likes that it's fun). Some play near-optimally with occasional leaks. Others intend to play optimally but are underbankrolled, miss quest days, open lootboxes below breakeven activity score, or play Degenerette for entertainment when they "should" be waiting. Many are slight winners over meaningful samples. As a population, they are probably slight losers on aggregate, but the distribution is wide. Crucially, when a hybrid wins, it feels *earned*. A lottery winner got lucky. A hybrid who maintained their activity score, timed their lootbox purchases, and built their streak knows their decisions contributed to the outcome. That sense of agency is a distinct source of entertainment value that pure gambling cannot provide.

**Why hybrids matter for the system:** Their competitive motivation keeps them engaged more reliably than a pure degen would stay, while imperfect execution contributes surplus to the pool. They are getting real value in return: real entertainment, real monetary returns, and real progression. All math is on-chain and transparent.

### 3.6 Budget Constraints and the Poverty Trap

The EV-maximizing strategies described above assume players can execute them without resource constraints. In practice, **budget constraints** fundamentally alter the viability of EV-maximizing play.

**Observation 3.4** (Increasing Capital Requirements). *The EV-maximizing strategy requires increasing liquid capital commitment over time: ticket prices escalate with level progression, quest streak maintenance requires one full ticket per day at current prices, and lootbox purchases require additional ETH. The daily liquid capital requirement for EV-maximizing play is strictly increasing in level.*

**The daily deposit requirement.** The fully optimal EV path involves depositing fresh ETH every day, not just reinvesting winnings. Quest completion requires a new ETH ticket purchase, which maintains the quest streak. A player *can* withdraw claimable ETH first and use it to buy the quest ticket, but this negates the auto-rebuy bonus on those funds, sacrificing some EV to maintain the streak. The optimal play is to deposit new ETH for the daily quest while letting winnings compound through afKing auto-rebuy. This creates a continuous external capital requirement on top of the escalating ticket prices, compounding the budget constraint for truly optimal play.

**Observation 3.5** (Bankroll Ruin under EV-Maximizing Play). *Even a player following a theoretically +EV strategy faces a non-zero probability of ruin. This occurs because: (a) jackpot payoffs are high-variance with potentially long dry spells, (b) future tickets and streak value are illiquid: they contribute to paper wealth but not to meeting tomorrow's costs, (c) quest streak maintenance is a daily fixed cost that cannot be deferred (missing one day resets the streak to zero, destroying accumulated value), and (d) the player may simultaneously hold significant illiquid wealth while being unable to meet the next day's liquid cost requirement.*

*This creates a degraded position: a player who loses their quest streak drops to a lower activity score and a worse protocol multiplier. In practice, a broken streak is unlikely to push a player from +EV to -EV entirely. The other components of activity score (purchase streak, purchase count, affiliate bonus, pass bonus) still contribute. But the lost streak represents a significant reduction in expected returns, and rebuilding it requires weeks of uninterrupted daily play. The player remains in the +EV cohort, but much less so than before.*

**Pass bootstrapping.** The breakeven grind from 0.00 to 0.60 activity score is the period where the protocol is most vulnerable to churn. 100-level whale passes (+0.40 activity bonus) and 10-level whale passes (+0.10) provide an immediate score boost that shortcuts this grind. A new player who buys a 100-level whale pass starts at 0.40 activity score rather than 0.00, reaching breakeven with only a modest quest streak. Passes also boost the other activity score components (purchase streak, purchase count), so the compounding effect is larger than the base bonus alone. Most importantly, this pushes the player past the 0.60 lootbox breakeven threshold immediately, making lootbox purchases better-than-ticket EV from day one rather than after weeks of grinding. (The 0.60 threshold is breakeven relative to buying tickets directly, not necessarily overall profitability, which depends on pool composition per the aggregate constraint in Section 2.3.) The pass system is not just a whale product. It is an onramp that eliminates the lootbox breakeven grind entirely for any player willing to pay upfront.

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

**What the creator extracts.** The creator is a solo dev and the only insider. There are no VCs, team allocations, privileged parties or bro deals. Here is exactly what he gets:

- **During presale:** 20% of lootbox ETH goes to the vault. This ends automatically after a fixed number of levels or 200 ETH of lootbox purchases, whichever comes first. This is real extraction that compensates development completed before launch.
- **20% of the DGNRS token supply.** DGNRS is a fixed-supply token that receives 25% of system stETH yield and 4 tickets per level with an activity score boost. Holders can burn DGNRS to extract their pro-rata share but forfeit all future yield. The remaining DGNRS is distributed to players over time. The creator's allocation is entirely dependent on the protocol's long-term success.
- **The vault** receives: 25% of all stETH yield, 4 tickets per level with an activity score boost, the presale lootbox revenue above, 2 million BURNIE, and affiliate commissions from unaffiliated players.

In concrete terms, the creator's in-game position is roughly equivalent to one deity pass with a 25% yield share, 2 million BURNIE, and up to 40 ETH from presale revenue. This is not nothing, but it is a defined, bounded allocation. The difference from traditional gambling: none of this is an ongoing rake on deposits. After presale, 100% of every ETH deposited goes into the prize pool system, along with 50% of stETH yield. The creator's upside is tied to protocol success, not to player losses.

**A note on origins.** The creator's revenue streams above are not a rake in the traditional sense. They are delayed compensation for prior contributions, internalized into the system on the same terms as all other rewards: contingent on its success. What sustained his efforts through years of significant opportunity cost and zero revenue was the same $\Psi$ this paper identifies as the engine of the system: genuine fascination with the design problem and a desire to build something unique. To make the opportunity cost concrete: the creator is a professional poker player whose income funded this project, eliminating the need for outside investment and any obligations that come with it. An EV maximizer with that outside option would never have started this, and if they had, would have structured it very differently.

**Definition 4.2** (Zero-Rake). *A gaming mechanism is zero-rake if no entity extracts a guaranteed percentage of player deposits as ongoing profit.*

**Observation 4.3** (Zero-Rake). *Degenerus Protocol is zero-rake after presale: 100% of player ETH deposits remain in the prize pool system. No percentage of any deposit is skimmed by a house or operator.*

**Corollary 4.4** (Positive-Sum Game). *For the player pool as a whole, Degenerus Protocol is a positive-sum game:*

$$\sum_{i \in \mathcal{N}} \mathbb{E}[\text{gross payout}_i] = \sum_{i \in \mathcal{N}} \text{deposits}_i + 0.50 \cdot r \cdot S \cdot T > \sum_{i \in \mathcal{N}} \text{deposits}_i$$

*where $T$ is the time horizon, $r \cdot S \cdot T$ is total stETH yield generated, and the coefficient $0.50$ reflects the yield split: 25% to the vault, 25% to DGNRS holders, and 50% to the prize pool system. Only the prize pool share flows back to players.*

**Caveat:** The game is positive-sum *in aggregate*. Individual players, especially low-activity degens, face negative monetary EV. Calling it "positive-sum" is accurate for the pool; individual experience varies.

**Reality check:** The game is primarily redistributive. The vast majority of what any player receives came from other players' deposits. The yield component makes the total payout exceed total deposits, but the dominant dynamic is redistribution from low-activity to high-activity players, and from unlucky to lucky ones. This is not a magic money machine. It is a well-structured game where the house edge is zero and a small external subsidy makes the aggregate slightly positive.

There is a second, arguably more important sense in which the game is positive-sum: *total utility* exceeds total deposits even ignoring yield. A degen who loses 0.01 ETH but gets genuine entertainment worth more than 0.01 ETH to them has a positive-utility outcome despite a negative-monetary one. An EV maximizer who extracts 0.01 ETH profit has a positive-monetary outcome. Both players are better off than they were before, drawing from the same pool of deposits. The complementary preferences of different player types mean that value is not merely redistributed but *created* through the act of playing. This is the same dynamic that makes poker positive-sum for the table (even before considering the house): the recreational player and the professional are both getting what they came for.

---

## 5. Equilibrium Analysis and Commitment Devices

For any player with unlimited bankroll who chooses to participate, the dominant strategy is to maximize activity score and cap out benefits every level. This is not a conjecture. Activity score monotonically increases returns on every protocol product, and deviation in any direction strictly reduces expected returns regardless of what other players do.

Bankroll constraints change the implementation, not the direction. Forced exit resets streaks to zero, erasing the accumulated activity score contribution that drives future EV. Outcome distributions depend on the actions of others in ways that resist precise risk-of-ruin analysis. The dominant strategy is maximum sustainable engagement.

### 5.1 The Active Participation Equilibrium

The participation decision and the strategy decision are separate questions with different answers.

**The participation decision** depends on opportunity cost and pool composition. With no sub-optimal players, returns converge to stETH yield, which may not justify the opportunity cost of locked capital. In practice, some players will always play sub-optimally, and any optimizer who exits increases returns for those who remain. This establishes a natural equilibrium: the game sustains as many optimizers as the sub-optimal deposit base (plus yield) can fund at returns exceeding their opportunity cost. GTO play also requires long-term commitment (streaks, future tickets, activity score), so even players who stop adding new capital remain connected to the game and incentivized to help it progress.

**The strategy decision**, given participation, is unconditional.

**Observation 5.1** (Active Participation Dominant Strategy). *If an EV maximizer chooses to participate and has sufficient bankroll to sustain engagement, the strategy that maximizes activity score and caps out protocol benefits every level is a dominant strategy. No unilateral deviation from max-activity play improves expected returns. This holds regardless of what other players do: reducing engagement always reduces the deviator's share. The bankroll constraint is real (see Section 3.6 on ruin risk), but conditional on having the capital, the strategy dominance is unconditional.*

*Verification that no player type benefits from unilateral deviation from max activity:*

**EV Maximizer deviates to minimal participation:** Reducing engagement reduces $a_i$, which reduces $\mu(a_i)$ and $\rho(a_i)$. The marginal cost of maintaining streaks (one ticket per day) is dominated by the marginal benefit of higher EV multipliers on all subsequent actions.

**Whale deviates to exit:** Forfeits accumulated activity score (non-transferable) and deity pass benefits (pass is transferable but costs 5 ETH in BURNIE to transfer). The ongoing returns from their position (maximum lootbox multiplier, positive-EV Degenerette, auto-rebuy compounding) provide continuing positive returns so long as the pool remains sufficiently funded by other participants.

**Affiliate deviates to stop referring:** Commission flow ceases. Since referral is the affiliate's only value proposition, cessation is equivalent to exit.

**Degen deviates to non-participation:** If the entertainment value is less than the monetary loss, the degen was never in the individually rational set and would not have participated in the first place. For degens within the IR set, continued play is preferred.

### 5.2 The Inactive Equilibrium and Why It Is Unstable

**Observation 5.2** (Inactive Profile as Conditional Equilibrium). *The strategy profile where all players choose no participation can be an equilibrium if deviation incentives are sufficiently weak. However, the inactive equilibrium is unstable for four reasons:*

**First-mover advantage.** The earliest players hold ticket positions across the most levels, giving them the most jackpot draw opportunities from their holdings. This creates a race-to-deviate dynamic: knowing the game will eventually start, earlier deviators are structurally advantaged. The rational response is to deviate early.

**BURNIE appreciation subsidy.** Early levels give out BURNIE cheaply (tickets cost 0.01 ETH at level 0). If the game reaches even level 10 (0.04 ETH tickets), early BURNIE has quadrupled in utility value. By the first century milestone (0.24 ETH), early BURNIE is worth 24x its acquisition cost. Presale lootboxes are even more generous with bonus BURNIE. This makes early participation strictly more attractive than waiting.

**Yield accumulation.** Once any deposits exist, stETH yield accrues regardless of further activity, growing total assets and making participation increasingly attractive.

**Passes as equilibrium-breaking devices.** Deity passes (24+ ETH) and whale passes inject large up-front capital into the prize pool. Pass holders receive activity score bonuses valuable *only if the game advances through levels*. A deity holder has 24+ ETH locked into a system that rewards them as long as levels progress, with a full refund if the game never starts. Their rational response is to actively drive progression. The pass system converts a coordination problem (who goes first?) into a paid commitment (pass holders go first, and are compensated for doing so).

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

Crucially, future tickets also have **time-value**: they earn BURNIE jackpot draw entries *before* their target level arrives. Earlier acquisition means more cumulative BURNIE draw opportunities, making the time of purchase economically relevant.

**Observation 5.3** (Future Tickets as Commitment Device). *A player holding future tickets has a strictly positive incentive to help the game reach those levels. The expected payoff is their share of the target level's prize pool (proportional to their ticket count relative to total tickets) plus all BURNIE jackpot draws accumulated while waiting.*

**Device 2: Quest Streaks.** A quest streak of length $q$ contributes $\min(q, 100)\%$ to the activity score. Breaking the streak (missing one day) resets $q$ to 0.

**Observation 5.4** (Streak Lock-In). *The cost of breaking a quest streak grows roughly quadratically with streak length. A 50-day streak contributes 50% to activity score, and rebuilding it requires 50 consecutive days of purchases. The longer the streak, the more painful it is to lose, creating increasingly powerful retention.* For a player with a 50-day streak, the daily cost of maintaining the streak (one ticket at current level price) is far exceeded by the EV uplift from the 50% activity score contribution. Streaks also provide a direct BURNIE FLIP bonus at milestones (every 10 levels, with an escalating, capped amount), adding a concrete monetary reward on top of the activity score benefit.

**Device 3: afKing Auto-Rebuy.** When enabled, jackpot winnings are automatically converted to random near-future level tickets at 130% face value (standard) or 145% with a lazy pass (1.30x and 1.45x, before accounting for forfeited BURNIE rebate), converting liquid ETH winnings into illiquid future participation and compounding the player's stake. The ticket selection is designed to be an optimal allocation path for the player, spreading value across upcoming levels.

**Device 4: BURNIE Burn-on-Use.** BURNIE tokens are destroyed when used for tickets, Degenerette bets, and decimator entries. Their value is realized only through gameplay actions that contribute to the system.

These commitment devices are powerful. The difference from exploitative gambling design is that the deferred rewards here are *real, substantial, and transparently calculable*. A player can compute exactly what their streak is worth, what their future tickets will earn, and what their activity score does to their EV. The underlying psychological mechanism (making it costly to leave) is the same as casino loyalty programs, but the rewards are on-chain, verifiable, and actually worth what they claim to be. The contract is immutable and ownerless. No regulator, operator, or adversary can modify, pause, or kill it.

---

## 6. BURNIE Economics and the 100-Level Cycle

### 6.1 The BURNIE Price Ratchet

BURNIE has a built-in appreciation mechanism against ETH. ETH ticket prices escalate with level progression (Appendix C), but BURNIE ticket purchases always cost 1,000 BURNIE per ticket (4 entries) regardless of level. Since a ticket at level x00 costs 0.24 ETH but still costs 1,000 BURNIE, the utility value of 1 BURNIE in ETH terms rises monotonically as the game progresses:

| Level Range | ETH Ticket Price | BURNIE Ticket Price | ETH per entry | BURNIE per entry |
|-------------|-----------------|---------------------|---------------|-----------------|
| 0–4 (intro) | 0.01 ETH | 1,000 BURNIE | 0.0025 ETH | 250 BURNIE |
| 5–9 (intro) | 0.02 ETH | 1,000 BURNIE | 0.005 ETH | 250 BURNIE |
| x01–x29 | 0.04 ETH | 1,000 BURNIE | 0.01 ETH | 250 BURNIE |
| x30–x59 | 0.08 ETH | 1,000 BURNIE | 0.02 ETH | 250 BURNIE |
| x60–x79 | 0.12 ETH | 1,000 BURNIE | 0.03 ETH | 250 BURNIE |
| x80–x99 | 0.16 ETH | 1,000 BURNIE | 0.04 ETH | 250 BURNIE |
| x00 (century) | 0.24 ETH | 1,000 BURNIE | 0.06 ETH | 250 BURNIE |

The initial levels show the steepest appreciation: BURNIE earned at level 0 (when one entry costs 0.0025 ETH) has 24x the purchasing power by the first century milestone (where one entry costs 0.06 ETH). 250 BURNIE always buys the same one entry; it is the ETH price of that entry that rises. Within each subsequent 100-level cycle, BURNIE's utility value increases 6x from x01 to x00. This is a structural appreciation mechanism: as long as the game progresses through levels, patient BURNIE holders see their tokens' purchasing power increase.

**The time-preference cross-subsidy.** Players who earn BURNIE early and hold it benefit from this appreciation. Players who immediately spend BURNIE at Degenerette or buy tickets at low-price levels get entertainment now but at lower ETH-equivalent value. This creates a cross-subsidy between time preferences: impatient BURNIE use reduces circulating supply (all BURNIE sinks are permanent burns), which benefits patient holders through both reduced supply and higher future utility value. The degen who burns 1,000 BURNIE on Degenerette at level x05 (when those BURNIE could buy 10 tickets worth 0.04 ETH each = 0.4 ETH of tickets) is giving up future value for present entertainment. That value doesn't disappear; it accrues to the remaining BURNIE supply and, indirectly, to all ticket holders, since BURNIE can be converted to tickets in a way that draws value from the same pools.

This connects to the structural price floor (Observation 8.3 in Section 8): the floor itself ratchets upward with level progression, since the ticket-price arbitrage opportunity grows as ETH ticket prices increase.

### 6.2 The Decimator

The decimator is a BURNIE-burn-to-win-ETH mechanism that provides an alternative sink for BURNIE tokens. Players permanently destroy BURNIE to buy weighted entries in a pro-rata ETH distribution drawn from the futurepool. It fires at milestone levels throughout each 100-level cycle at 10% of the futurepool, and at century milestones (x00) at 30%.

Activity score determines both bucket assignment (better odds) and burn weight multiplier (1.0x at zero activity to 1.767x at maximum). A max-activity player at a x00 level gets bucket 2 and 1.767x weight, competing for 30% of the futurepool. A zero-activity player gets bucket 12 and 1.0x weight at 10%. The difference in expected ETH per BURNIE burned is dramatic.

**Strategic choice: tickets vs decimator.** BURNIE holders face a real decision: burn for tickets (1,000 BURNIE per ticket, 4 lottery entries each) or burn in the decimator (minimum 1,000 BURNIE, pro-rata ETH from futurepool). Neither is strictly dominant; the optimal choice depends on the player's activity score, futurepool size, competition from other burners, and whether it's a normal or x00 level. This dual-sink structure drives the BURNIE price floor (Section 8.4): the ticket floor is universal, while the decimator floor is player-specific and rewards engagement. BURNIE is worth more in skilled hands.

### 6.3 The 100-Level Cycle

Ticket prices escalate within each 100-level cycle from 0.04 ETH at x01 to 0.24 ETH at x00, then reset. Century milestones (x00) are crescendo events where the futurepool dump, dual bonus BAF jackpot (20% vs 10% at normal milestones), dual bonus decimator (30% vs 10%), and dual bonus daily jackpots all fire at their highest rates simultaneously, distributing a massive fraction of accumulated rewards across multiple channels. After the crescendo, prices reset to 0.04 ETH, lowering barriers for all bankroll sizes. Each cycle's pools tend to be larger than the last because deposits are permanent and the futurepool grows net across each 100-level cycle (despite periodic drains from the drip, decimator, and BAF). This is not strictly guaranteed: a sufficiently slow cycle could see growth that fails to compensate for the natural prize pool reduction between x00 and the following x01. But the structural trend is upward as long as new deposits continue. This creates a recruitment flywheel: bigger jackpots attract more degens, whose deposits make the next cycle's jackpots bigger still. The on-chain visibility of a growing, non-decreasing pool is itself a marketing asset that compounds over time.

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
3. **Dominate BAF leaderboard:** A well-funded coalition (or single whale) can outflip anyone by simply staking more BURNIE in coinflips. There is no cap on coinflip volume, so a sufficiently capitalized player can take the top BAF position by brute force. However, total extraction remains bounded by finite BAF payout math, and every BURNIE flipped feeds the coinflip burn (net ~1.6% destruction per cycle), so dominating the leaderboard has a real cost.
4. **Dump BURNIE:** Creates temporary sell pressure, but the utility floor (ticket purchases, decimator entries) provides a structural price floor.

The coalition's maximum extraction is bounded, and their departure increases per-capita EV for remaining players (the "whale departure paradox," Section 8.3).

### 7.3 Griefer Analysis

**Well-funded griefers face structural futility.** The Griefer is the strongest adversary we model: a well-funded actor (competitor, state-backed regulator, or ideological opponent) willing to spend money purely to break the game or force GAMEOVER. The problem for the griefer is that there is no venue for griefing. The protocol's mechanisms (RNG locks, VRF commitment, 3-day emergency recovery) deny any lever to *mechanically* break the game. What can a griefer actually do? The most plausible attack is to massively inflate the prize pool at the current level, advancing it quickly and setting a high target for the next level that the non-griefer population may struggle to cover. But this is self-defeating: the inflated pool creates a massive jackpot, which is exactly the kind of event that attracts new players and re-engages lapsed ones. The griefer spends money to make the game more exciting for everyone else. And players cannot be priced out by escalating ticket costs: partial tickets are available at any level, and lootbox prices remain constant regardless of level. GAMEOVER requires 365 days of insufficient purchasing activity to meet the current level's target, not just the griefer's departure. The griefer cannot force other players to stop. At best, they can waste money participating, then leave. Their deposits remain in the pool, benefiting everyone else.

**Even coercing the creator is futile.** Suppose a state-level adversary compels the creator to destroy the game under threat of force. The creator *cannot comply*. The contract is immutable and ownerless in the relevant sense: the vault's admin privileges are granted to any address holding >30% of vault ownership and are limited to emergency VRF recovery (a Chainlink failsafe). The admin has no power to pause the game, extract funds, modify rules, or trigger GAMEOVER. There is no multisig, no governance vote, no upgrade proxy. The creator could burn every private key they hold and the game would continue operating identically. The only path to GAMEOVER is 365 consecutive days where purchasing activity fails to meet the current level's target, and no amount of coercion applied to any single party can produce that outcome.

**The theoretical attack scenario.** The only path to fund misappropriation requires an attacker who simultaneously holds the admin key *and* causes a sustained Chainlink VRF failure lasting over 3 days. Under normal operation, the admin cannot touch the VRF coordinator at all. The 3-day stall window only opens if Chainlink VRF is genuinely non-functional *or* no eligible player requests a new VRF word (a permissionless call that pays the caller directly and triggers jackpot payouts).

Given a VRF failure, three outcomes are possible: (1) the admin is alive and honest, rotates the coordinator, and service resumes. This is the entire reason the admin power exists. (2) The admin is dead or unreachable, and the game eventually reaches GAMEOVER with full fund distribution to participants. No theft. (3) An attacker has compromised the admin key and migrates to a hostile coordinator that rigs jackpot outcomes. This is the only theft path, and it is a necessary design tradeoff: the power to fix a broken VRF is the same power that could theoretically be abused. The conditions required (Chainlink failure + compromised admin key) cannot arise under ordinary circumstances. Chainlink VRF is battle-tested infrastructure securing billions in DeFi; treating its sustained failure as a realistic attack vector rather than a theoretical bound would be alarmist.

The game's resilience is a property of the contract, not of any person. Even the front-end is not a single point of failure: anyone can build and host an alternative interface.

Detailed analysis of specific attack vectors (Sybil attacks, Degenerette pool drain, affiliate self-referral loops, stETH depeg events) is in Appendix D. None present existential threats to the protocol.

---

The preceding analysis addresses how the protocol sustains itself under normal and adversarial conditions. We now turn to the harder question: what happens when things go genuinely wrong?

## 8. Failure Modes and Resilience

### 8.1 What a Death Spiral Looks Like

**Definition 8.1** (Death Spiral). *A death spiral is a sequence of states where: (a) player count is monotonically decreasing, (b) prize pool growth rate is negative (the system distributes more than it accumulates), and (c) the process is self-reinforcing (declining participation causes further decline).*

### 8.2 Why the Protocol Resists Death Spirals

**Observation 8.1** (Death Spiral Resistance). *Degenerus Protocol resists death spirals through three independent mechanisms:*

**(a) Prize pool concentration and jackpot accumulation.** As players exit, the per-capita prize pool share increases for remaining players. Fewer competitors for the same pool means higher expected value per participant. This creates a natural "buy low" attractor: the worse the exodus, the better the deal for anyone who stays or enters. Players who remain active (or are earliest to return) capture a disproportionate share of rewards: daily BURNIE jackpots and the every-third-day ETH/ticket jackpots continue firing regardless of population size. Fewer active players means fewer draw entries, so each remaining participant's probability of winning increases. The longer others stay away, the more draws the active players accumulate.

**(b) Yield independence.** stETH yield continues regardless of player activity, growing total assets. While yield does not directly fill the nextpool target (progression still requires player purchases), it increases the value of accumulated jackpot pools. During a player exodus, jackpot attractiveness continues growing passively, strengthening the incentive for remaining or new players to participate.

**(c) Locked liquidity.** Prize pools are not withdrawable. Player exit does not reduce prize pool assets; it only reduces competition for those assets. This is structurally different from DeFi protocols where whale departure causes liquidity crises.

*Argument.* A death spiral requires condition (c): self-reinforcing decline. Player departure has two effects:

- Effect A (negative): Reduced prize pool *growth rate* (fewer deposits).
- Effect B (positive): Increased per-capita *share* of existing pools (fewer competitors).

For remaining players, Effect B dominates Effect A once the accumulated pool is large relative to any single player's annual contribution. Since the pool accumulates over the entire game history and cannot decrease (locked liquidity), this condition is satisfied after a few levels of active play.

Therefore, condition (c) of Definition 8.1 fails on the monetary dimension so long as a sufficient fraction of remaining players respond to monetary incentives. It does not require *all* players to be rational, only that enough EV-sensitive capital remains to keep the system above its breakeven threshold. The "spiral" breaks because the monetary incentive to stay *increases* as others leave.

**Progression is also guaranteed at least once (once the game is established).** The death spiral argument above addresses per-capita pool share, but a skeptic might ask: does the game still *advance levels* when players leave? The futurepool drip mechanism answers this. Every 3 days, a portion of the future prize pool drains into the next-level prize pool, awarding the equity in tickets to current ticket holders. During any period of low activity, the futurepool (which accumulates from all prior levels) continues draining. Once futurepool exceeds a sufficient multiple of the next level's target, the drip alone will fill the target without any new player purchases. This mechanically guarantees at least one more level completion. This guarantee only applies once the game has progressed enough for the futurepool to substantially exceed the nextpool target, which happens naturally as deposits and lootbox purchases accumulate over multiple levels. (This is a one-shot guarantee: if activity remains zero after that level completes, the now-depleted futurepool may not cover the following level's target.) But a single guaranteed level completion is psychologically significant. It means the game visibly advances even during a drought, jackpots fire, winners are drawn, and the on-chain evidence of continued activity can re-engage lapsed players.

**Simulation evidence.** A Monte Carlo simulation of 30 levels with realistic player behavior demonstrates these dynamics concretely. Most levels complete in 7-12 days. Level 22, however, takes 31 days: organic buying slowed and the pool barely moved for weeks, grinding from 340 ETH to 410 ETH on auto-mechanisms alone (quest streak pressure, afKing rebuys, futurepool drips). Then momentum picked up and the level completed normally. That is what a "slow period" looks like in this system. Not a stall. Not a death spiral. Just a longer grind where the mechanical floor kept the pool growing until human activity resumed. The futurepool drained slightly to feed the drip, and players holding tickets kept winning smaller daily jackpots the whole time. Over the 30-level run (308 simulated days), the futurepool grew from 8 ETH to 1,690 ETH, the largest single jackpot grew from 11 ETH to 305 ETH, and cumulative stETH yield reached 67 ETH.

<!-- SIM_CHART -->

**The gameover backstop.** Even if the game does die and reach GAMEOVER status, the remaining funds are not lost. They are distributed to players who have been continually building BAF score over the inactivity period and to BURNIE holders who burn for the final decimator draw. Players who stayed active during the decline, accumulating tickets and winning BURNIE jackpots throughout, have a substantial edge in capturing the terminal distribution. This means staying active during a downturn is rewarded not just by ongoing jackpots but by a favorable position in the endgame payout. The worst-case outcome for loyal players is not "lose everything" but "collect a disproportionate share of the final pool."

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

The net effect depends on context: remaining players get a larger share of each jackpot (positive) but may wait longer between jackpots if the whale was a significant driver of progression (negative). If progression velocity is maintained despite the whale's departure (because other players or the four progression guarantors fill the gap), then whale departure is unambiguously positive for remaining players: pure reduction in extraction with no velocity cost. If the whale was the dominant contributor, the velocity loss is real but temporary. The futurepool drip, quest streak pressure, and auto-rebuy mechanisms continue to push the nextpool toward its target regardless of who left. Whale departure slows the game. It does not stop it.

### 8.4 BURNIE Token Stability

**Observation 8.3** (BURNIE Price Floor). *The BURNIE token has a structural price floor driven by the ticket-purchase comparison. 1,000 BURNIE buys a ticket at any level. An ETH ticket purchase at level $\ell$ costs $p(\ell)$ but also awards 100 BURNIE, so the net cost of a BURNIE ticket is 900 BURNIE. Given that players are actively buying tickets at full ETH price, the floor should be near:*

$$p_{BURNIE}^{floor} \approx \frac{p(\ell)}{900}$$

The pure entry-parity rate is $p(\ell)/1000$ per BURNIE (since 250 BURNIE = 1 entry = $p(\ell)/4$ ETH, so 1 BURNIE = $p(\ell)/1000$ ETH). The floor formula $p(\ell)/900$ is slightly lower than this parity rate, because ETH ticket purchases return 100 BURNIE; accounting for that rebate, the ETH-savings arbitrage only activates below the adjusted threshold. If market price falls significantly below $p(\ell)/900$, rational players buy BURNIE on the open market and use it for ticket purchases instead of paying ETH, saving cost per entry. This arbitrage creates buy pressure that supports the price.

The decimator provides a second floor, but it is not a single number. Decimator EV per BURNIE burned varies dramatically by player: activity score determines both bucket assignment (odds) and burn weight multiplier (Section 6.2). A max-activity player at a x00 level (bucket 2, 1.767x weight) gets far more ETH per BURNIE than a zero-activity player (bucket 12, 1.0x weight) burning at a normal level. The ticket floor is universal and clean; the decimator floor is player-specific and hard to calculate, but for high-activity players it can exceed the ticket floor substantially.

**Future-value component.** The ticket floor $p(\ell)/900$ rises monotonically within each 100-level cycle (6x from x01 to x00). BURNIE held today will be worth more at future levels, and the holder knows this. Unlike conventional assets where future value is discounted by calendar time, BURNIE's discount rate is tied to *level progression speed*, which depends on player activity rather than a fixed clock. This makes the present-value calculation unusually complex: a fast-progressing game compresses the discount window and pulls future value forward, while a slow game stretches it. The net effect is that the price floor at any moment reflects not just current-level utility but a discounted sum of all future-level utility within the cycle, weighted by the market's expectation of progression speed.

**Caveat:** The arbitrage mechanism is most efficient with liquid BURNIE markets, but the floor does not depend on a DEX listing. BURNIE has direct utility: it buys tickets, plays Degenerette, and enters the decimator without ever touching an exchange. The price floor exists through this direct utility whether or not an LP exists. A liquid market simply makes the arbitrage more convenient, and providing that liquidity is profitable, so someone will. During a severe bear market (Section 8.5), these dynamics weaken. However, the floor has a hard backstop: even in GAMEOVER, BURNIE is the primary method of terminal payout distribution (Section 8.7). The decimator jackpot, which distributes the bulk of remaining assets after the BAF payout, requires BURNIE to enter. A player holding BURNIE when the game dies holds the key to claiming their share of the terminal distribution. This means the price floor is not merely a normal-conditions artifact. It is structurally embedded in the endgame itself.

### 8.5 The Bear Market Stress Test

The reviewers of this paper correctly identified the sustained bear market scenario as the most plausible failure mode. It deserves serious treatment, not a dismissive paragraph.

**The scenario:** A prolonged crypto winter suppresses participation. ETH price drops 80%+. stETH yield compresses. New player acquisition stalls. Existing players face real-world financial pressure and reduce discretionary gambling spending. The game reaches a later level where prize pool targets are higher and ticket prices have escalated.

**Why it's dangerous:** At higher levels, the daily cost of maintaining a quest streak is higher (tickets cost 0.04–0.24 ETH). The prize pool targets are larger. The progression guarantors may all weaken simultaneously, because they are not truly independent: they are all driven by player spending, which is driven by crypto market sentiment. A severe bear market is exactly the scenario where all guarantors fail together, because they share a common cause (market-wide risk aversion).

**Structural defenses:**
- stETH yield continues (at reduced rates, but positive). This does not directly fill the nextpool target, but it grows total assets and increases the attractiveness of jackpots for anyone considering participation.
- Prize pool concentration accelerates as players leave, making remaining pools increasingly attractive to any remaining or returning participants.
- The 365-day timeout is long. A year of near-zero activity is required for game death. Even during the 2022 crypto winter, on-chain activity never went to zero.
- Future pool drip continues regardless of new deposits, providing mechanical progression support.

**Honest assessment:** A 365-day period of insufficient activity to advance one level is unlikely during early levels (targets are small, tickets are cheap). At later levels with 0.16–0.24 ETH tickets and larger targets, a sustained bear market could plausibly trigger the timeout. However, by the time the game reaches later levels, the futurepool will be substantially larger than any single level's nextpool requirement. The every-3-days futurepool drain mechanically guarantees at least one more level completion even at zero new activity. This is psychologically significant: players and potential entrants can see on-chain that the next level *will* fire regardless, removing the coordination fear of "what if nobody else plays." The protocol's anti-stall mechanisms mitigate but do not eliminate the long-term risk. This is the most realistic path to game death, and players with large illiquid positions at high levels during a bear market face real risk of stranding. If the game truly dies, stranded funds are locked for up to 365 days until the GAMEOVER timeout triggers. During that period, the futurepool drip will fire the next level's jackpot (a large payout to current ticket holders), but after that the remaining funds sit idle until the timeout expires and the terminal distribution begins. Two years of illiquidity in the worst case (the final active level's duration plus the 365-day timeout) is a real cost that players should understand before committing capital they cannot afford to lose.

### 8.6 Conditions for Protocol Failure

**Design Property 8.4** (Game Death). *The protocol reaches GAMEOVER if and only if:*

$$\text{time since last level start} \geq \begin{cases} 912 \text{ days} & \text{if } \ell = 0 \\ 365 \text{ days} & \text{if } \ell \geq 1 \end{cases}$$

This requires that for 365 consecutive days (or 912 at level 0), insufficient purchasing activity occurs to meet the current level's prize pool target and trigger a new level start. A single transaction does not suffice: cumulative deposits must reach $\bar{P}_\ell$, which requires meaningful economic activity.

For any non-trivial accumulated pool (e.g., $P > 10$ ETH), the "buy low" attractor (increasing per-capita value as players leave) makes failure to reach the target improbable under standard rational actor assumptions. But "improbable" is not "impossible," especially at higher levels during bear markets.

**The terminal growth problem.** There is a second, more exotic failure mode: the game succeeds *too well*. Since deposits are permanent and prize pools can only grow, a sufficiently long-running game accumulates an ever-increasing fraction of available ETH. At some distant level, the ETH required to start the next level exceeds the ETH that remains outside the system. This is terminal by construction. If the game ever reaches this point, it represents the greatest success in the history of gaming, but it is still terminal. The practical relevance is negligible (this requires the protocol to absorb a substantial fraction of all circulating ETH), but the theoretical completeness matters: the system has a hard upper bound on lifespan even under maximally favorable conditions.

### 8.7 Endgame Distribution

Even in the GAMEOVER state, the protocol provides well-defined terminal payoffs:

1. **Deity pass refunds:** 20 ETH/pass if GAMEOVER triggers before level 10; no refund at level 10+
2. **BAF jackpot:** 50% of remaining assets distributed to past-level ticket holders, weighted by BAF score accumulated during the inactivity period
3. **Decimator jackpot:** Remaining surplus to decimator participants
4. **Final sweep:** After 30 days, unclaimed funds → vault and DGNRS reserves

This ensures that accumulated value is distributed rather than destroyed.

**Could someone profit from game death?** In theory, a player could buy BURNIE cheaply during a decline and burn it for the decimator jackpot at GAMEOVER. But this strategy has limited upside: BURNIE is a liquid token, so it must be purchased at competitive market prices (the utility floor prevents true fire-sale pricing). GAMEOVER requires 365 consecutive days of insufficient activity, meaning the speculator must hold for years with no guarantee of success. And their existence further incentivizes active players to prevent GAMEOVER, since letting the game die would dilute their own share of the terminal distribution. The active player class will always be larger and better positioned than the death-betting class. A few players wanting the game to end is not an existential threat. There will always be haters and competitors who would prefer it dies.

---

## 9. Comparisons

| Property | DeFi Yield | Speculative Token | Degenerus Protocol |
|----------|------------|-------------------|--------------------|
| Yield source | Staking, lending | New buyers (ponzi dynamics) | Redistribution from degens (individual); stETH yield (protocol-level) |
| Variance | Low (predictable APY) | Extreme (token price) | High (jackpots, lotteries) |
| Engagement | Passive deposits | Buy and hold/shill | Active participation rewarded |
| Token dynamics | Often inflationary | Inflationary (vesting, farming) | BURNIE: deflationary; DGNRS: fixed |
| Growth dependency | Moderate | Fatal (requires perpetual growth) | Eventually fatal, but graceful (terminal distribution, not rug) |
| Liquidity | Withdrawable | Liquid (sell anytime) | Non-withdrawable (deposits permanent) |
| Terminal value | Yield stream | Zero | Non-zero (game utility, yield claims) |
| Risk of ruin | Low | Total (token goes to zero) | Moderate (individual outcomes vary) |
| Loser outcome | Opportunity cost | Worthless tokens, no recourse | Fair VRF-verified chances, lost to math not fraud |

**Observation 9.1** (Variance as Defensive Moat). *A system with high variance and moderate expected value will tend to attract entertainment-motivated participants (who value variance positively) and repel pure extractors (who discount variance and see only moderate EV after accounting for opportunity cost). The illiquid reward structure (level-gated payouts, non-transferable future tickets) further limits hedging options.* This was introduced intuitively through the poker analogy (Section 2.6): the variance-minimizing nit that kills poker ecosystems has no viable strategy in Degenerus, because every avenue for profit requires high variance. Reward velocity is tied to *progression*, not calendar time: rewards unlock as levels are reached, and levels require ETH to enter the system.

The source-of-returns distinction (Section 1) is what separates this from speculative tokens structurally. A memecoin's returns depend on later buyers' capital. This protocol's returns depend on entertainment spending plus yield. The protocol needs ongoing deposits to advance levels, and without them it eventually ends. But the failure mode is a fair terminal distribution, not a rug.

---

## 10. Conclusion: The Resilience Thesis

### 10.1 The Resilience Thesis

The preceding sections built an argument through interlocking mechanisms: cross-subsidy between heterogeneous player types (Section 2), commitment devices that make continued participation dominant (Section 5.5), structural death spiral resistance through locked liquidity and prize concentration (Section 8), and BURNIE economics with a built-in price ratchet (Section 6). We now state the central claim.

**Thesis (Structural Resilience).** *Once Degenerus Protocol has reached a state with positive prize pools and at least one rational participant, the game has structural incentives to continue advancing through levels.* These mechanisms are correlated under adverse market conditions, so independence should not be assumed.

**Where the thesis holds:**
- stETH yield rate $r > 0$ (Lido continues functioning)
- At least one rational actor monitors and acts on prize pool opportunities
- Ethereum remains operational
- Smart contract code is free of critical bugs

**Where the thesis fails:**
- Lido staking yield goes to zero permanently (systemic ETH staking failure)
- A prolonged crypto bear market suppresses participation below the level target for 365+ consecutive days, the most plausible failure mode, especially at higher levels where targets are larger (Section 8.5)
- All participants simultaneously cease to value the entertainment product
- A critical smart contract vulnerability is discovered
- Regulatory action prevents all participation globally

We do not claim the protocol is indestructible. We claim it is *structurally resilient*: that its incentive design makes continued operation the default outcome under a wide range of conditions, and that failure requires sustained adverse conditions rather than the simple absence of growth.

**What this means for each participant.** For an EV maximizer, the question is whether the equilibrium point delivers returns that justify the opportunity cost of locked capital. For a degen, the question is whether this is more fun per dollar than alternatives. For an affiliate, the question is whether they can recruit enough players across all types. For a whale, the question is whether the game will progress through enough levels to justify the capital commitment. The protocol cannot answer these questions by design. It can only ensure that if the answers are yes, the incentives align to keep the game running.

**What would confirm or falsify this thesis.** Post-deployment, watch for: (1) the fish-to-grinder ratio stabilizing above the aggregate constraint threshold (Section 2.3), confirming sufficient entertainment demand to fund positive-EV play; (2) quest streak distribution showing genuine daily engagement across accounts; (3) the futurepool growing net across 100-level cycles; (4) BURNIE maintaining its ticket-price floor (Section 8.4); and (5) level completion times staying under 30 days at higher levels. Note that GTO play is always +EV before opportunity cost and risk aversion, since stETH yield sets the floor. The question is not whether positive returns exist, but whether they are large enough to attract and retain capital. The protocol is indifferent to whether participants are humans or autonomous agents. Bots and AIs that play optimally are economically identical to human grinders, and the protocol is designed to welcome them as affiliates and active players. If these metrics hold through the first 100-level cycle, the resilience thesis has survived its first real test. If level completion times grow unbounded or the active player count trends to zero despite growing pools, the entertainment assumption has failed and no amount of incentive design will save it.

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
| stETH yield split | — | 50% prize pool, 25% vault, 25% DGNRS | Value distribution |
| Activity score range | $a_i$ | [0, 3.05] | Incentive multiplier |
| Lootbox EV range | $\mu(a)$ | [0.80, 1.35] | Engagement reward |
| Degenerette ROI range | $\rho(a)$ | [0.90, 0.999] | Engagement reward |
| Lootbox EV cap | — | 10 ETH/level/account | Extraction bound |
| Degenerette ETH cap | — | 10% of future pool | Solvency guarantee |
| Coinflip win rate | — | 0.50 | Fair game |
| Coinflip reward mean | — | 0.9685 | Slight negative EV |
| Affiliate commission | — | 0.20–0.25 | Referral incentive |
| Ticket price range | $p(\ell)$ | 0.01–0.24 ETH | Entry cost scaling |
| Whale bundle price | — | 2.4–4 ETH | Catch-up mechanism |
| Deity pass base price | — | 24 ETH + $T(n)$ | Whale commitment |
| Deity pass cap | — | 32 total | Concentration limit |
| Pre-game timeout | — | 912 days | Liveness guard |
| Post-game timeout | — | 365 days | Liveness guard |
| VRF retry timeout | — | 18 hours | RNG liveness |
| Emergency stall gate | — | 3 days | VRF recovery |
| Quest daily reward | — | 300 BURNIE | Engagement incentive |
| Bootstrap prize pool | — | 50 ETH | Minimum pool guarantee |
| BAF leaderboard reset | — | Every 10 levels | Anti-concentration |
| Jackpots per level | — | 5 daily | Distribution frequency |
| Scatter share of BAF jackpot | — | 60% (40% + 20%) | Broad distribution |
| Auto-rebuy ticket bonus | — | 30%/45% | Compounding incentive |

## Appendix B: BAF Jackpot Distribution Detail

The BAF (Big-Ass Flip) jackpot, triggered every 10 levels from the future prize pool, distributes as follows:

- **Top BAF slot:** $10\%$ of pool
- **Top Daily Flip slot:** $10\%$ of pool
- **Random pick slot:** $5\%$ of pool
- **Affiliate draw slice:** $10\%$ of pool
- **Future ticket holder slot:** $5\%$ of pool (selects 2 winners from 4 far-future ticket holder candidates, ranked by BAF score: 3% to 1st, 2% to 2nd)
- **Scatter slices:** $40\%$ and $20\%$ of pool

Daily jackpot distribution:
- Days 1–4: a random 6–14% slice of the current prize pool is drawn.
- Day 5: the remaining current prize pool is fully distributed.
- Days 1–4 use equal trait-bucket shares (20/20/20/20) with the solo bucket taking the remainder; day 5 uses level-jackpot shares (60/13.33/13.33/13.34 with rotation of the 60% solo bucket).
- A 20% ticket-conversion budget is applied to the daily ETH slice.
- Carryover flow is conditional and implementation-specific: on eligible non-day-1 draws, ~1% of `futurePrizePool` may be pulled, with 50% converted to tickets and 50% paid as ETH.

---

## Appendix C: Model Detail

*Full mathematical formalization of the protocol's parameters and game structure.*

### Key Parameter Summary

**Lootbox EV quick reference:**

| Activity Score | Lootbox EV Multiplier | Entries per entry of ETH spent |
|---------------|----------------------|-------------------------------|
| 0 (new player) | 0.80x | 0.80 (below face value) |
| 0.60 (breakeven) | 1.00x | 1.00 (at face value) |
| 3.05 (maximum) | 1.35x | 1.35 (above face value) |

The activity score EV benefit on lootboxes caps at 10 ETH per level per account. Activity score also stratifies returns on Degenerette spins (90%-99.9% base ROI) and decimator burns (bucket assignment and burn weight multiplier). The pattern is the same across all products: higher engagement produces better returns.

**Ticket pricing and prize pools.** Ticket prices escalate with level progression in a repeating 100-level cycle, from 0.01 ETH at the earliest levels to 0.24 ETH at century milestones (full pricing table below). Each ticket purchase splits: 90% to the next-level prize pool ($P^{next}$) and 10% to the future prize pool ($P^{fut}$). When the next pool reaches its level target, the level advances.

stETH yield ($r \approx 0.025$ annual) accrues continuously on all locked deposits, the only external monetary value entering the system.

**Transaction costs.** Typical user interactions cost roughly $0.05 in gas at current prices, negligible relative to ticket and lootbox amounts. The protocol consumes more gas during jackpot resolution phases, but players who bear this cost are rewarded with BURNIE and must have made a purchase in the previous day to be eligible. Gas is a background cost that does not meaningfully alter the strategic analysis.

**Decimator trigger schedule:**

| Levels | Pool Source | Pool Percentage |
|--------|------------|----------------|
| x5 (5, 15, 25, 35, 45, 55, 65, 75, 85) | futurePrizePool | 10% |
| x00 (100, 200, 300...) | futurePrizePool | 30% |

The decimator is not triggered at level x95. The sequence skips from x85 to x00, where the pool percentage triples. Minimum burn is 1,000 BURNIE. Bucket assignment: default 12, drops to 5 at max activity on normal levels, drops to 2 at max activity on x00 levels. Lower buckets have higher weight per BURNIE burned in the pro-rata distribution.

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

The cycle repeats every 100 levels after level 10, creating a predictable cost escalation that players can plan around. The strategic implications of this cycle, including its interaction with BURNIE economics and the crescendo events at century milestones, are analyzed in Section 6.

#### Activity Score and EV Multipliers

The activity score $a_i \in [0, 3.05]$ is computed as:

$$a_i = \min\left(\frac{m_i}{50}, 1\right) \cdot 0.50 + \min\left(\frac{c_i}{\ell}, 1\right) \cdot 0.25 + \min\left(\frac{q_i}{100}, 1\right) \cdot 1.00 + \phi_i \cdot 0.50 + \gamma_i$$

where:
- $m_i$ is the purchase streak (consecutive levels with ETH purchases)
- $c_i$ is the purchase count (total levels with purchases)
- $q_i$ is the quest streak (consecutive daily quest completions)
- $\phi_i \in [0, 1]$ is the normalized affiliate bonus
- $\gamma_i \in \{0, 0.10, 0.40, 0.80\}$ is the pass bonus (none, 10-level whale, 100-level whale, deity)

The activity score maps to an EV multiplier $\mu: [0, 3.05] \rightarrow [0.80, 1.35]$ for lootboxes:

$$\mu(a) = \begin{cases}
0.80 + \frac{a}{3} & \text{if } a \leq 0.60 \\
0.80 + 0.20 + \frac{(a - 0.60) \cdot 0.35}{2.45} & \text{if } a > 0.60
\end{cases}$$

And to a Degenerette ROI $\rho: [0, 3.05] \rightarrow [0.90, 0.999]$:

$$\rho(a) \approx 0.90 + \frac{0.099 \cdot \min(a, 3.05)}{3.05}$$

The key thresholds: at $a_i = 0.60$, lootbox EV reaches 1.00 (break-even). Above 0.60, lootboxes are positive EV. At $a_i = 3.05$, lootboxes return 1.35x and Degenerette approaches 99.9% base ROI. Note that the Degenerette base ROI understates the effective return for high-activity players in two ways. First, 75% of the ETH payout is delivered as lootboxes, and lootboxes are worth 1.35x at max activity, so a player who would buy lootboxes anyway receives more than face value on that component. Second, ETH Degenerette bets receive a +5% ETH bonus on high-match outcomes, which is not reflected in $\rho(a)$. Together, these make Degenerette ETH bets individually +EV for high-activity players, not merely near-zero edge.

**Additional lootbox value.** The $\mu$ multiplier accounts for ticket and BURNIE-equivalent value from lootbox rewards. Lootboxes also award DGNRS tokens (from a reward pool, scaled by lootbox size) and boons (random bonuses including purchase boosts, coinflip boosts, activity score points, and occasionally whale passes or deity pass discounts). These components are harder to quantify because DGNRS value depends on market price and boon value depends on whether the player uses them optimally. They represent additional upside beyond the multiplier, but we omit them from the formal EV calculations to keep the analysis conservative.

See Section 2.3 for the aggregate constraint on these multipliers.

---

### Protocol Architecture

#### The Stage Game at Level $\ell$

Each level $\ell$ defines a stage game with two phases:

**Phase 1: Purchase (variable duration).** Players simultaneously choose actions from their action sets. The purchase phase continues until the prize pool target is met: $P^{next}_\ell \geq \bar{P}_\ell$.

**Phase 2: Jackpot (fixed 5-day duration).** Prize distribution occurs over 5 daily draws. On days 1–4, a random 6–14% of $P^{curr}_\ell$ is distributed to winners selected by VRF from the trait-ticket pool; on day 5, 100% of the remaining $P^{curr}_\ell$ is distributed.

**Transition:** After the jackpot phase completes, $\ell \leftarrow \ell + 1$ and Phase 1 begins for the next level.

For the BAF (Big-Ass Flip) jackpot, triggered every 10 levels from the future prize pool, 100% of the draw is distributed across top BAF and daily flip leaderboard positions, random leaderboard slots, affiliate draws, future ticket holder slots, and scatter slices. (Exact slice percentages are in Appendix B.)

**Ticket timing and EV.** Not all tickets at a given level have equal expected value. A ticket purchased early in the purchase phase is eligible for purchase-phase reward jackpots (every 3 days, drawing ~1% of the future pool as tickets and ETH to trait holders), all 5 daily jackpot draws during the burn phase, and any future-level BURNIE draws it accumulates while waiting. A ticket purchased just before the level target is met catches all 5 burn-phase draws but misses the purchase-phase rewards. And tickets purchased mid-jackpot phase only participate in the remaining daily draws. Since day 5 distributes 100% of the remaining current prize pool, all tickets share in the largest single payout regardless of timing. But the cumulative expected value of early tickets is strictly higher than late tickets at the same level, because they are eligible for more drawings. This creates an incentive to purchase early in a level rather than waiting, which in turn accelerates pool growth and level completion. It also means that the per-ticket EV varies within a single level depending on when the ticket was acquired, further complicating any attempt to assign a single "EV per ticket" number.

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

**Design Property** (Liveness). *The game satisfies liveness under the assumption that sufficient purchasing activity occurs to meet the level's prize pool target and trigger a new level start within 365 days of the previous level's start (912 days at level 0). The following mechanisms support this:*

1. *Multiple independent progression guarantors* (quest streaks, afKing auto-rebuy, affiliate referrals, and the 15% futurepool dump each level that compensates preexisting ticket holders) all contribute independently to nextpool growth. Note: stETH yield grows total assets and increases jackpot attractiveness, but does not directly contribute to the nextpool target.
2. *Futurepool drain:* Every three days, a portion of the futurepool drains into the nextpool, awarding the equity in tickets to current ticket holders. Once the futurepool reaches a sufficient multiple of the nextpool requirement, this mechanism alone guarantees the next level will fire even with zero new player activity. However, this is a one-shot guarantee: if activity remains at zero, the futurepool will be insufficient to cover subsequent levels.
3. *VRF retry timeout:* If the VRF callback is not received within 18 hours, any player can request a new VRF word, preventing permanent VRF stalls.
4. *Emergency VRF recovery:* After a 3-day stall, the admin can migrate to a new VRF coordinator.
5. *Graceful termination:* If no new level starts within the timeout, the game transitions to GAMEOVER, a well-defined terminal state with full prize distribution.

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
**Analysis:** The protocol explicitly blocks self-referral (locks referral to VAULT sentinel permanently). Cross-referral between colluding accounts (A refers B, B refers A) is costless to set up. The benefit is limited to BURNIE commissions (no activity score boost unless both accounts are active players), and extraction comes from the affiliate BURNIE emission pool rather than ETH prize pools.
**Verdict:** Moderate impact. Non-trivial leak from the affiliate incentive budget that should be acknowledged. Does not threaten ETH solvency.

#### Attack 4: stETH Depeg Event
**Vector:** Lido stETH trades at discount to ETH (as occurred briefly in June 2022 at ~0.93:1).
**Analysis:** The auto-stake mechanism only stakes ETH *above* `claimablePool`, meaning the ETH floor for claims is maintained. The stETH exposure is in the "surplus" portion (prize pools, future pools), not the solvency floor. Early claimers get ETH; late claimers during a depeg receive discounted stETH, creating a mild bank-run incentive.
**Verdict:** Low-to-moderate risk. A severe depeg (>20%) would reduce real prize pool value but not threaten claimable funds.
