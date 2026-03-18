# Requirements: Degenerus Game Frontend

**Defined:** 2026-03-18
**Core Value:** Make the on-chain game playable, entertaining, and visually compelling from a browser

## v1 Requirements

### Architecture

- [x] **ARCH-01**: App uses ES modules with import map for dependency resolution (no bundler)
- [x] **ARCH-02**: Game state managed via reactive proxy store with subscription pattern
- [x] **ARCH-03**: UI built with Custom Elements (no Shadow DOM) sharing global CSS design system
- [x] **ARCH-04**: API client handles all REST reads with polling, caching, and lag detection
- [x] **ARCH-05**: Contract writes go direct via ethers.js with receipt status verification
- [x] **ARCH-06**: CSS extracted from monolith into modular files with shared design tokens
- [x] **ARCH-07**: Wallet connection supports EIP-6963 (multi-wallet discovery) with MetaMask fallback

### Jackpot Display

- [x] **JACK-01**: Player sees animated jackpot resolution with sequential trait reveals per quadrant
- [x] **JACK-02**: Jackpot shows current pool size, day counter (1-5), and today's allocation
- [x] **JACK-03**: Winning traits highlighted with badge visualization per bucket
- [x] **JACK-04**: Win celebration with confetti and prize total animation

### Coinflip

- [x] **FLIP-01**: Player can stake BURNIE in daily coinflip with amount input
- [x] **FLIP-02**: Coinflip result displays multiplier tier with visual breakdown (1.50x/2.50x/range)
- [x] **FLIP-03**: Bounty tracker shows current pool, record holder, and armed status
- [x] **FLIP-04**: Auto-rebuy toggle and recycling bonus displayed

### Purchasing

- [x] **PURCH-01**: Player can buy tickets (ETH) with quantity input and price display
- [x] **PURCH-02**: Player can buy lootboxes with activity-score-dependent EV indicator
- [x] **PURCH-03**: Player can buy BURNIE tickets (1,000 BURNIE per ticket)
- [x] **PURCH-04**: Purchase panel shows current level price and pool fill progress toward target
- [x] **PURCH-05**: Transaction lifecycle displays pending/confirmed/failed states with tx hash link

### Degenerette

- [ ] **DEGEN-01**: Player can place bets with currency selector (ETH/BURNIE/WWXRP) and amount input
- [ ] **DEGEN-02**: VRF-pending bets persisted across page refresh (localStorage)
- [ ] **DEGEN-03**: Bet results display with win/loss indication and claimable winnings
- [ ] **DEGEN-04**: Slot-style animation for result reveal

### Passes

- [x] **PASS-01**: Pass cards display status, pricing, and purchase button for lazy/whale/deity passes
- [x] **PASS-02**: Deity pass shows symbol selector and boon status
- [x] **PASS-03**: Pass section is accessible but not prominent (secondary navigation or collapsed panel)

### Quests

- [ ] **QUEST-01**: Daily quest slots display with progress bars (slot 0 prerequisite enforced in UI)
- [ ] **QUEST-02**: Streak counter shows consecutive days, shield count, and milestone progress
- [ ] **QUEST-03**: Quest panel shows contextually when quests are active

### Decimator

- [ ] **DECI-01**: Player can submit BURNIE burns with bucket/sub-bucket selection
- [ ] **DECI-02**: Display shows current burn pool, player's burn total, and activity-score multiplier
- [ ] **DECI-03**: Decimator panel appears contextually only when decimator window is open

### Death Timer

- [x] **DEATH-01**: Death clock countdown always visible with stage coloring (green/yellow/red)
- [x] **DEATH-02**: Imminent stage (5 days) triggers visual urgency with pulsing animation
- [x] **DEATH-03**: Distress stage (6 hours) shows bonus indicator for distress-window purchases

### Terminal

- [ ] **TERM-01**: Terminal decimator display shows payout preview for level+1 ticketholders
- [ ] **TERM-02**: Terminal insurance bar shows accumulated stETH yield backup

### Claims

- [ ] **CLAIM-01**: Unified claims panel aggregates all claimable winnings across game systems
- [ ] **CLAIM-02**: Player can claim with single transaction, shows claimed amount and tx confirmation

### Affiliate

- [ ] **AFFIL-01**: Player can create affiliate referral code
- [ ] **AFFIL-02**: Player can input referral code (from URL param or manual entry)
- [ ] **AFFIL-03**: Affiliate earnings display shows cumulative ETH earned

### BAF

- [ ] **BAF-01**: Player's BAF score displayed with current ranking context
- [ ] **BAF-02**: Top 4 BAF leaderboard shown (prominent on pre-BAF levels, subtle otherwise)

### Audio

- [ ] **AUD-01**: Win sounds on jackpot reveal, coinflip win, and degenerette win
- [ ] **AUD-02**: Flip sound on coinflip resolution
- [ ] **AUD-03**: Urgency tone on death timer entering imminent/distress stage

### State Management

- [x] **STATE-01**: UI switches between purchase phase and jackpot phase display automatically
- [x] **STATE-02**: GAMEOVER state shows terminal information and disables game actions
- [x] **STATE-03**: Activity score total visible; breakdown by component (quest streak, mint count, affiliate, passes) deferred to phase with contract read integration

## v2 Requirements

### Advanced Display

- **ADV-01**: Jackpot history browser with paginated past results
- **ADV-02**: Token analytics dashboard (supply, vault reserves, holder counts)
- **ADV-03**: Player history page (all bets, purchases, claims over time)

### Real-Time

- **RT-01**: WebSocket connection for live game state updates (replace polling)
- **RT-02**: Live transaction feed showing other players' activity

## Out of Scope

| Feature | Reason |
|---------|--------|
| Mobile native app | Web-first with responsive design |
| Smart contract development | Separate repo (degenerus-audit/contracts/) |
| Database/API development | Separate repo (database/), consumed as dependency |
| Token analytics dashboard | Defer to v2.1 (requires additional API endpoints) |
| Chat or social features | Not part of the game loop |
| WebSocket real-time | Polling sufficient for v2.0, WebSocket in v2.1 |
| Turbo mode (101+) UI | Contract not finalized, defer to v2.1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ARCH-01 | Phase 6 | Complete |
| ARCH-02 | Phase 6 | Complete |
| ARCH-03 | Phase 6 | Complete |
| ARCH-04 | Phase 6 | Complete |
| ARCH-05 | Phase 6 | Complete |
| ARCH-06 | Phase 6 | Complete |
| ARCH-07 | Phase 6 | Complete |
| STATE-01 | Phase 6 | Complete |
| STATE-02 | Phase 6 | Complete |
| STATE-03 | Phase 6 | Partial (total only, breakdown deferred) |
| PURCH-01 | Phase 7 | Complete |
| PURCH-02 | Phase 7 | Complete |
| PURCH-03 | Phase 7 | Complete |
| PURCH-04 | Phase 7 | Complete |
| PURCH-05 | Phase 7 | Complete |
| PASS-01 | Phase 7 | Complete |
| PASS-02 | Phase 7 | Complete |
| PASS-03 | Phase 7 | Complete |
| JACK-01 | Phase 8 | Complete |
| JACK-02 | Phase 8 | Complete |
| JACK-03 | Phase 8 | Complete |
| JACK-04 | Phase 8 | Complete |
| FLIP-01 | Phase 8 | Complete |
| FLIP-02 | Phase 8 | Complete |
| FLIP-03 | Phase 8 | Complete |
| FLIP-04 | Phase 8 | Complete |
| DEATH-01 | Phase 8 | Complete |
| DEATH-02 | Phase 8 | Complete |
| DEATH-03 | Phase 8 | Complete |
| DEGEN-01 | Phase 9 | Pending |
| DEGEN-02 | Phase 9 | Pending |
| DEGEN-03 | Phase 9 | Pending |
| DEGEN-04 | Phase 9 | Pending |
| QUEST-01 | Phase 9 | Pending |
| QUEST-02 | Phase 9 | Pending |
| QUEST-03 | Phase 9 | Pending |
| CLAIM-01 | Phase 9 | Pending |
| CLAIM-02 | Phase 9 | Pending |
| AFFIL-01 | Phase 9 | Pending |
| AFFIL-02 | Phase 9 | Pending |
| AFFIL-03 | Phase 9 | Pending |
| BAF-01 | Phase 9 | Pending |
| BAF-02 | Phase 9 | Pending |
| DECI-01 | Phase 10 | Pending |
| DECI-02 | Phase 10 | Pending |
| DECI-03 | Phase 10 | Pending |
| TERM-01 | Phase 10 | Pending |
| TERM-02 | Phase 10 | Pending |
| AUD-01 | Phase 11 | Pending |
| AUD-02 | Phase 11 | Pending |
| AUD-03 | Phase 11 | Pending |

**Coverage:**
- v1 requirements: 51 total
- Mapped to phases: 51
- Unmapped: 0

---
*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after roadmap creation (v2.0 phases 6-11)*
