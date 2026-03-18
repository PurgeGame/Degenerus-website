# Feature Landscape

**Domain:** On-chain gambling game frontend (crypto-native lottery/jackpot protocol)
**Researched:** 2026-03-18
**Overall Confidence:** MEDIUM-HIGH (patterns well-established in crypto gambling, Degenerus-specific mechanics are novel)

## Table Stakes

Features users expect from any crypto gambling frontend in 2025-2026. Missing any of these and the product feels broken or amateur.

### Wallet & Transaction

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| One-click wallet connection (MetaMask/EIP-1193) | Every crypto app has this. Users bounce immediately without it. | Low | Already built in beta. Extract and modularize. |
| Transaction status with etherscan link | Users need to know their tx is pending, confirmed, or failed. Standard since 2020. | Low | Already built in beta. Pattern is solid. |
| Chain/network validation with auto-switch prompt | Wrong-chain errors are the #1 crypto UX failure. | Low | Already built in beta (Sepolia check). Add auto-switch via wallet_switchEthereumChain. |
| Wallet balance display (ETH + BURNIE) | Users need to see what they can spend. | Low | Partially built. BURNIE balance shown in purchase panel. Add ETH balance. |
| Transaction confirmation feedback with receipt | Users must see confirmation before they trust the next action. | Low | Already built. Spinner + checkmark + hash link pattern. |

### Purchase & Interaction

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Ticket/lootbox purchase with quantity inputs | Core game action. Without it there's no game. | Low | Already built. ETH and BURNIE modes with increment buttons. |
| Pass purchase cards (Lazy/Whale/Deity) | Entry products. Players expect clear pricing and one-click buy. | Low | Already built. Cards with descriptions and buy buttons. |
| ETH/BURNIE payment toggle | Dual-currency is core to the protocol. Users expect to choose. | Low | Already built. Toggle buttons switch between payment modes. |
| Dynamic price display (updates on level change) | Stale prices = user buys at wrong price = trust destroyed. | Med | Partially built. Polls contract. Needs event-driven updates when level advances. |
| Referral code input | Standard affiliate pattern. Users expect a text field somewhere. | Low | Already built in status bar. |

### Results & Claims

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Claimable winnings display | Every gambling platform shows your balance. Not showing it = users think they lost. | Low | Partially built (degenerette claim bar). Need unified claims panel. |
| One-click claim button | If users can't claim easily, they think the protocol stole their ETH. | Low | Exists per-feature (degenerette, jackpot). Need aggregate claim. |
| Win/loss history | Users want to see their results. Every casino has this. | Med | Partially built for degenerette. Need across all game types. |

### Information Display

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Current game level | Users need to know where the game is. | Low | Already built in status bar. |
| Game phase indicator (purchase/jackpot/RNG) | Users need to know what they can do RIGHT NOW. | Low | Already built. Color-coded text. |
| Activity score display | Core to player's EV. Hiding it = players can't optimize. | Low | Already built in status bar. |
| Responsive layout (desktop + mobile) | 60%+ of crypto users are mobile. Non-responsive = dead. | Med | Already built with breakpoints at 920/768/640/400px. |

### Security & Trust

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Contract address display/verification | Crypto-native users verify contracts. Not showing addresses = suspicious. | Low | Not built. Add to footer or info panel. Show verified contract links. |
| Provably fair verification (VRF proof display) | Distinguishes from scam casinos. Users expect to verify outcomes. | Med | Not built. Show Chainlink VRF request ID and proof for each draw. |

## Differentiators

Features that set Degenerus apart. Not expected, but valued. These are what make users tell their friends.

### Hero Jackpot Resolution

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Animated trait-lock spin sequence | The current scratch-off is good but passive. A dramatic reveal with rising-pitch audio and sequential quadrant locks creates anticipation. Casino slot machines proved this decades ago: the near-miss experience drives engagement harder than instant results. | High | Beta already has the full sound system (Web Audio API) and spin animation. Needs refinement, not rebuild. The `jpSfxTick`, `jpSfxLock`, `jpSfxAllLocked` sound effects are already coded and working. |
| Scratch-to-reveal with green detection | Scratching over a winning badge turns the quadrant green. Physical interaction creates ownership feeling. Digital scratch-offs are proven in lottery apps. | High | Already built and working. Canvas-based with DPR-aware rendering, badge hit detection, threshold-based auto-reveal. This is the most complex piece of the beta and it works well. |
| Multi-type prize display (ETH + BURNIE + tickets) | Most jackpot UIs show one prize type. Showing the full breakdown per quadrant (with future-level ticket targets) communicates the protocol's depth. | Med | Already built. `jpSummarizeWins` groups by type. |
| Center diamond far-future BURNIE reveal | Secondary scratchable area for BURNIE wins from future level draws. Surprise bonus moment after main reveal. | Med | Already built. Golden scratch surface with separate reveal. |

### Hero Coinflip Display

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Full-screen coinflip with 3D CSS animation | Currently compressed into a status bar widget. A coinflip is inherently dramatic. Crypto gamblers expect the coin toss to be the MOMENT, not a sidebar stat. Evolution Gaming's "Crazy Coin Flip" proved that making the flip ceremonial drives engagement. | High | Beta has 3D CSS coin (rotateY transform, spinning animation). Needs promotion from status bar to hero display with larger coin, multiplier buildup, and tier breakdown. |
| Multiplier tier visualization | Show the multiplier ladder or tier breakdown before the flip. Players need to see what's at stake. Crash games (Stake, Rollbit) have trained users to watch multipliers build. | Med | Not built. Need to show the coinflip reward tiers (based on BURNIE amount) with visual emphasis on what tier was hit. |
| Bounty tracker (cumulative coinflip value) | Show what the current coinflip pool is worth. Creates FOMO when it's fat. Polymarket-style "volume at stake" display. | Med | Not built. Requires contract read for current coinflip bounty state. |
| Win/loss streak indicator | Shows hot/cold streaks. Degens love streaks even though they're meaningless. But they drive engagement. | Low | Not built. Track locally from history data. |

### Death Timer

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Color-staged countdown (green > yellow > red) | This is the game's core tension mechanic. 120-day death clock (365 at level 0, 2-day in turbo). Visual urgency escalation triggers loss aversion, the strongest behavioral driver in gambling. Players who see red buy tickets. | Med | Not built. Needs contract read for days since last activity at current level. Color transitions at configurable thresholds (e.g., >50% green, 50-80% yellow, >80% red). |
| Pulsing/glowing animation at critical thresholds | When the timer enters red zone, the UI should communicate "this is an emergency." Subtle pulse, border glow, or background tint change. | Low | Not built. CSS animation layered on top of the countdown. |
| Contextual call-to-action in red zone | "Buy a ticket to reset the clock" with one-click purchase. Convert urgency into action. | Low | Not built. Show inline purchase CTA when timer is in red zone. |

### Quest System UI

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Streak visualization with shield indicator | The quest streak is core to activity score. A shield (from the daily BURNIE burn mechanic) protects against streak loss. Visual streak counter with shield icon creates the "don't break the chain" psychology that Duolingo proved works. | Med | Beta has basic quest display (type + progress text). Needs visual upgrade: streak counter with flame/shield, progress bars per quest. |
| Daily quest cards with progress bars | Two daily quests with clear requirements and progress tracking. Card UI with fill-bar and checkmark. Standard gamification pattern. | Med | Beta has quest items but bare-bones (text only). Need progress bar, completion state, requirement display. |
| Streak calendar/heatmap | Show past 30 days of quest completion. GitHub contribution graph style. Visual proof of commitment. | Med | Not built. Requires history data from database API. |

### Decimator UI

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| BURNIE burn submission with bucket display | Decimator is the protocol's unique BURNIE-extraction mechanism. Burn BURNIE tokens, enter a draw weighted by burn amount and activity score. Users need to see: their bucket (based on score), expected competition, and burn weight multiplier. | High | Not built. New feature. Needs contract integration for decimator state, bucket calculation from activity score, and burn transaction. |
| Contextual display (only visible during decimator windows) | Showing the decimator when it's not available creates confusion. Show it only when a decimator event is upcoming or active. | Med | Not built. Requires game state awareness for when decimator windows open. |
| Burn weight multiplier display | "Your BURNIE is worth 1.4x in this decimator because your activity score is X." Makes score investment tangible. | Low | Not built. Calculate from activity score parameters. |

### Terminal Decimator / Death Bet

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| GAMEOVER bet interface | Bet on whether the game will die at the current level. Novel mechanic with no direct precedent in crypto gambling. The interface needs to clearly communicate: what you're betting on, what the payout is, and the irrevocability. | High | Not built. New feature. Complex because it ties into GAMEOVER mechanics, deposit insurance (125 ETH accumulator), and terminal payout math. |
| Risk/reward calculator | Show P(GAMEOVER) estimates and expected payout per ticket at current conditions. This is the protocol's most intellectually interesting mechanic. EV maximizers need the math. | Med | Not built. Requires current level stats, days remaining, and ticket count to estimate probabilities. |

### Claims Panel

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Unified claims aggregation | One panel showing all claimable winnings across all game types: jackpot prizes, degenerette payouts, coinflip bounties, decimator wins. Crypto users HATE having to hunt for their money across multiple interfaces. | Med | Not built as unified panel. Individual claim buttons exist for degenerette and jackpot. Need to aggregate `claimableWinningsOf()` into a single prominent display with breakdown by source. |
| Claim history with tx links | Show recent claims with amounts and etherscan links. Proof the money moved. | Med | Not built. Requires database API for claim history. |

### Affiliate Management

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Create affiliate code | Users need to generate their own referral code (up to 31 chars). Standard referral UX: generate, copy, share. | Med | Not built. Beta only has code input. Need create flow with contract write. |
| Affiliate earnings dashboard | Show commission earnings, referral count, taper status. Affiliates who can't see their earnings won't promote. | Med | Not built. Requires database API for affiliate stats. |
| One-click copy/share | Copy code to clipboard, share link generation. Standard but essential. | Low | Not built. Trivial to implement. |

### BAF Score Display

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Contextual BAF prominence | BAF (Best Affiliate Forwarding) score is only relevant before BAF-eligible levels. Show it prominently on pre-BAF levels, minimize it otherwise. Avoids information overload while surfacing it when it matters. | Med | Not built. Requires level-aware UI logic to determine when BAF is relevant and adjust display prominence. |
| BAF leaderboard | Show top affiliates by BAF score. Competition drives referral effort. | Med | Not built. Requires database API for BAF rankings. |

### State-Driven UI Transitions

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Purchase phase UI (default) | Show all buying options, hide jackpot reveal. The game has distinct phases and the UI should match. Showing jackpot controls during purchase phase is confusing. | Med | Partially built. Phase indicator exists but UI doesn't reshape around it. Need to show/hide panels based on `inJackpotPhase` and `rngLocked` state. |
| Jackpot phase UI | Hero jackpot display, hide purchase panel (or grey it out). Focus attention on the reveal. | Med | Not built as distinct mode. Jackpot widget exists but alongside purchase. |
| GAMEOVER state | Full-screen game over display with terminal payout claims. The finality should feel heavy. | Low | Not built. `gameOver()` view function exists in contract. |
| Transition animations between phases | Smooth transitions when game state changes (purchase > jackpot > results). No jarring layout shifts. | Med | Not built. CSS transitions on panel visibility changes. |

## Anti-Features

Features to explicitly NOT build. These would harm the product.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Chat/social feed | Adds moderation burden, attracts spam/scams, dilutes focus. Degenerus is a game, not a social platform. Discord exists. | Link to Discord. Show player count if needed. |
| Autoplay/auto-bet loops | Creates regulatory risk, removes the deliberate-action design of the protocol, and contradicts the "commitment device" thesis. Players should make each decision. | Manual actions only. afKing auto-rebuy is handled by the contract, not the frontend. |
| Price in USD | ETH-denominated protocol. Dollar prices fluctuate with ETH price, creating confusion about whether the game or the market moved. Players who use this protocol think in ETH. | ETH-only pricing. If absolutely needed, show USD in a tooltip, never as primary. |
| Sound by default | Auto-playing audio is hostile. Especially on mobile where it's socially catastrophic. | Sound off by default. Mute button. Enable on user interaction (Web Audio API already requires user gesture). |
| Real-time WebSocket price feeds | Over-engineering for a game that advances once per day. Polling every 30-60 seconds is fine. WebSockets add infrastructure complexity for zero user benefit. | Poll contract/API on interval. Refresh on user action. |
| Token analytics dashboard | Out of scope for game frontend. Separate product with different audience (investors vs players). | Defer to separate milestone per PROJECT.md. |
| Mobile native app | Web-first is correct. MetaMask Mobile and other wallet browsers handle this. Native app = app store review risk + double maintenance. | Responsive web design. Test in MetaMask Mobile browser. |
| Complex onboarding wizard | Crypto-native users don't need hand-holding. They have a wallet. They know what ETH is. A wizard insults them and slows them down. | Connect wallet > you're in. Tooltips for game-specific concepts. |
| Fake urgency patterns | Timer UX research is clear: fake urgency destroys trust. The death timer is REAL urgency from actual game mechanics. Don't add artificial countdown timers to purchases or sales. | Only show timers that reflect real on-chain deadlines. |

## Feature Dependencies

```
Wallet Connection (existing) --> All features

Game State Polling --> Phase indicator
                  --> State-driven UI transitions
                  --> Death timer
                  --> Contextual BAF display
                  --> Decimator visibility

Database API --> Win/loss history
            --> Affiliate earnings dashboard
            --> BAF leaderboard
            --> Quest streak calendar
            --> Claim history

Jackpot Widget (existing) --> Hero jackpot (upgrade, not rebuild)
Coinflip Widget (existing) --> Hero coinflip (promote from sidebar)

Claims Aggregation --> Unified claims panel
                   --> Requires: jackpot claims + degenerette claims + coinflip claims + decimator claims

State Machine --> Purchase phase UI
             --> Jackpot phase UI
             --> GAMEOVER state
             --> Requires: contract phase reads + event listeners

Quest Contract --> Quest system UI
              --> Streak visualization
              --> Requires: quest contract reads (already in beta ABI)

Decimator Contract --> Decimator UI
                   --> Terminal decimator
                   --> Requires: new contract ABI integration (not in beta)

Affiliate Contract --> Affiliate code creation
                   --> Affiliate dashboard
                   --> Requires: affiliate contract writes (create code) + database reads (stats)
```

## MVP Recommendation

Prioritize in this order:

1. **State-driven UI shell** -- the UI must reshape around game phases before any feature works well. Build the phase-aware layout container first.
2. **Unified claims panel** -- players need to find their money. Aggregate all claimable winnings into one prominent panel. This is trust-critical.
3. **Hero jackpot resolution** -- the beta's scratch-off + spin animation is 80% there. Promote it from a panel to the hero display during jackpot phase. Refine, don't rebuild.
4. **Death timer** -- the game's core urgency mechanic. Green/yellow/red staged countdown with pulsing red zone. Simple contract read, high emotional impact.
5. **Hero coinflip display** -- promote from status bar sidebar to a proper display with multiplier visualization. The flip is the second biggest moment per level.
6. **Quest system UI upgrade** -- streak counter, progress bars, shield indicator. Build on existing quest data reads.
7. **Affiliate code creation** -- unblock the referral flywheel. Input exists, creation does not.
8. **Decimator UI** -- new feature, new contract integration. Higher complexity, can be phased later.
9. **Terminal decimator** -- most complex feature, depends on GAMEOVER conditions. Build last.

**Defer:**
- BAF leaderboard: needs database API and is contextually relevant only on certain levels
- Streak calendar/heatmap: nice visualization but not functionally blocking anything
- Affiliate earnings dashboard: useful but affiliates will cope with etherscan until this exists
- Provably fair verification: important for trust but can ship as a separate verification page

## Sources

- [ChainPlay: Crypto Gambling UX](https://chainplay.gg/blog/crypto-gambling-in-2025-ux-is-the-whole-game/)
- [Moonstream: Fully On-chain Games Research UI](https://medium.com/coinmonks/fully-on-chain-games-research-ui-246c42cecae2)
- [UX Bonfire: Enhancing UX in Fully On-Chain Games](https://medium.com/uxbonfire/enhancing-user-experience-in-fully-on-chain-games-trends-challenges-and-solutions-80b7bcee3099)
- [Avark: UX/UI Design Patterns in Blockchain & Crypto](https://avark.agency/learn/article/blockchain-ux-design-guide/)
- [Countdown Timer UX Psychology](https://medium.com/design-bootcamp/the-stress-of-countdown-clocks-understanding-panic-inducing-timers-in-ux-psychology-b8d1a6333691)
- [Game UI Database: Daily & Timed Rewards](https://www.gameuidatabase.com/index.php?scrn=124)
- [Game UI Database: Clock & Timer](https://www.gameuidatabase.com/index.php?scrn=137)
- [Slot Machine UI Trends](https://www.planet7casino.com/other/slot-machine-ui-trends-whats-changing-in-design-and-why-it-matters)
- [GammaStack: Coin Flip Casino Game Guide](https://www.gammastack.com/blog/the-ultimate-guide-to-the-coin-flip-casino-game/)
- [Provably Fair Technology](https://www.provably.com/)
- [Stake vs Rollbit Comparison](https://www.deucescracked.com/stake-casino-vs-rollbit-which-crypto-casino-wins/)
- [DarkPattern.games: Daily Rewards](https://www.darkpattern.games/pattern/11/daily-rewards.html)
- Existing beta prototype: `/home/zak/Dev/PurgeGame/website/beta/index.html` (4600 lines, working patterns)
- Existing mint module: `/home/zak/Dev/PurgeGame/website/beta/mint.js` (contract interactions)
