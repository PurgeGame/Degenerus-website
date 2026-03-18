# Roadmap: Degenerus Protocol Website

## Milestones

- v1.0 **Paper Audit** - Phases 1-5 (shipped 2026-03-18)
- v2.0 **Game Frontend** - Phases 6-12 (in progress)

## Phases

<details>
<summary>v1.0 Paper Audit (Phases 1-5) - SHIPPED 2026-03-18</summary>

- [x] Phase 1: Preparation (1/1 plans) - completed 2026-03-16
- [x] Phase 2: Number-Heavy Sections Audit (3/3 plans) - completed 2026-03-16
- [x] Phase 3: Mechanism-Heavy Sections Audit (2/2 plans) - completed 2026-03-16
- [x] Phase 4: Prose and Framing Sections Audit (2/2 plans) - completed 2026-03-16
- [x] Phase 5: Cross-Section Consistency and Report (2/2 plans) - completed 2026-03-17

</details>

### v2.0 Game Frontend (In Progress)

**Milestone Goal:** Rebuild the game frontend from extracted beta/ patterns into a modular, production-quality interface with hero jackpot/flip displays and all core game actions.

- [ ] **Phase 6: Foundation** - ES modules, import map, reactive store, wallet EIP-6963, API client, CSS extraction, phase-aware router
- [ ] **Phase 7: Purchasing & Core UI** - Tickets, lootboxes, BURNIE tickets, transaction lifecycle, purchase panel, pass cards
- [ ] **Phase 8: Hero Displays** - Jackpot resolution animation, coinflip hero display, death timer with urgency stages
- [ ] **Phase 9: Supporting Features** - Degenerette, quests, unified claims, affiliate, BAF leaderboard
- [x] **Phase 10: Decimator & Terminal** - BURNIE burn submissions, decimator display, terminal payout, GAMEOVER state (completed 2026-03-18)
- [x] **Phase 11: Audio & Polish** - Sound effects, visual polish, error states, loading skeletons (completed 2026-03-18)
- [x] **Phase 12: Integration Fixes & Cleanup** - Affiliate key mismatch, GAMEOVER trigger consolidation, orphaned code removal, CLAIM-02 text fix (gap closure) (completed 2026-03-18)

## Phase Details

### Phase 6: Foundation
**Goal**: The app runs as ES modules with a reactive store, working wallet connection, and all shared infrastructure in place so every subsequent phase has a stable base to build on.
**Depends on**: Nothing (first v2.0 phase)
**Requirements**: ARCH-01, ARCH-02, ARCH-03, ARCH-04, ARCH-05, ARCH-06, ARCH-07, STATE-01, STATE-02, STATE-03
**Success Criteria** (what must be TRUE):
  1. App loads from ES modules via import map with no bundler; dev server documented and required
  2. Wallet connects via EIP-6963 multi-wallet discovery; MetaMask fallback works; ETH/BURNIE balances display
  3. Reactive store updates propagate to subscribing components without manual DOM wiring
  4. API client fetches game state from database REST endpoint; contract writes go direct via ethers.js with receipt.status verification
  5. UI switches automatically between purchase phase and jackpot phase views; GAMEOVER state disables game actions and shows terminal info
**Plans:** 1/3 plans executed

Plans:
- [ ] 06-01-PLAN.md -- Core modules (store, events, constants, utils) + index.html entry point + CSS extraction
- [ ] 06-02-PLAN.md -- API client, contract module, wallet (EIP-6963), nav.js bridge
- [ ] 06-03-PLAN.md -- Custom Element components, phase router, main.js bootstrap, browser verification

### Phase 7: Purchasing & Core UI
**Goal**: Players can buy tickets, lootboxes, and BURNIE tickets with full transaction lifecycle feedback, and view pass options -- proving the Custom Element component pattern on the most-used game actions.
**Depends on**: Phase 6
**Requirements**: PURCH-01, PURCH-02, PURCH-03, PURCH-04, PURCH-05, PASS-01, PASS-02, PASS-03
**Success Criteria** (what must be TRUE):
  1. Player can buy ETH tickets, lootboxes, and BURNIE tickets (1,000 BURNIE per ticket) with quantity input and current price shown
  2. Purchase panel shows live level price and pool fill progress toward the current target
  3. Every transaction shows pending/confirmed/failed status with a tx hash link to etherscan
  4. Pass cards (lazy, whale, deity) display status and pricing; deity card shows symbol selector and boon status
  5. Pass section is accessible but not prominent (collapsed or secondary nav position)
**Plans:** 2 plans

Plans:
- [ ] 07-01-PLAN.md -- Purchase business logic, purchase panel, tx-status-list, pool fill progress, EV indicator
- [ ] 07-02-PLAN.md -- Pass section with lazy/whale/deity cards, deity symbol selector, collapsible layout

### Phase 8: Hero Displays
**Goal**: Jackpot resolution, coinflip, and the death timer are visually compelling hero experiences that communicate game state with clarity and dramatic impact.
**Depends on**: Phase 6
**Requirements**: JACK-01, JACK-02, JACK-03, JACK-04, FLIP-01, FLIP-02, FLIP-03, FLIP-04, DEATH-01, DEATH-02, DEATH-03
**Success Criteria** (what must be TRUE):
  1. Jackpot resolution plays an animated sequential trait reveal per quadrant; winning traits are highlighted with badge visualization
  2. Jackpot panel shows current pool size, day counter (1-5), and today's allocation; wins trigger confetti and prize total animation
  3. Player can stake BURNIE in the daily coinflip; result displays the multiplier tier (1.50x/2.50x/range) with visual breakdown
  4. Coinflip bounty tracker shows current pool, record holder, and armed status; auto-rebuy toggle and recycling bonus are visible
  5. Death clock countdown is always visible with green/yellow/red stage coloring; imminent stage (5 days) pulses; distress stage (6 hours) shows bonus indicator
**Plans:** 3 plans

Plans:
- [ ] 08-01-PLAN.md -- Store/API/constants extensions + death clock component (always-visible countdown with urgency stages)
- [ ] 08-02-PLAN.md -- Jackpot data logic + panel with GSAP trait reveal animation and confetti celebration
- [ ] 08-03-PLAN.md -- Coinflip business logic + panel with BURNIE staking, multiplier tiers, bounty tracker, auto-rebuy

### Phase 9: Supporting Features
**Goal**: Degenerette betting, quest tracking, unified claims, affiliate infrastructure, and BAF scores are all functional -- covering every game action not handled by purchasing or hero displays.
**Depends on**: Phase 7, Phase 8
**Requirements**: DEGEN-01, DEGEN-02, DEGEN-03, DEGEN-04, QUEST-01, QUEST-02, QUEST-03, CLAIM-01, CLAIM-02, AFFIL-01, AFFIL-02, AFFIL-03, BAF-01, BAF-02
**Success Criteria** (what must be TRUE):
  1. Player can place degenerette bets with currency selector (ETH/BURNIE/WWXRP); VRF-pending bets survive a page refresh; results show win/loss and claimable winnings with slot-style reveal animation
  2. Quest panel shows daily slot progress bars with slot-0 prerequisite enforced; streak counter shows consecutive days, shield count, and milestone progress; panel appears contextually when quests are active
  3. Unified claims panel aggregates all claimable winnings across all game systems; player can claim ETH and BURNIE with separate per-contract transactions (ETH from GAME, BURNIE from COINFLIP) and sees the claimed amount with tx confirmation
  4. Player can create an affiliate referral code and input one (from URL param or manual entry); cumulative ETH earned is displayed
  5. Player's BAF score shows with ranking context; top-4 leaderboard is prominent on pre-BAF levels and subtle on others
**Plans:** 4 plans

Plans:
- [ ] 09-01-PLAN.md -- Shared infrastructure extensions (store slices, ABIs, constants) + degenerette business logic, component, and CSS
- [ ] 09-02-PLAN.md -- Quest business logic, component, and CSS + Claims business logic, component, and CSS
- [ ] 09-03-PLAN.md -- Affiliate business logic, component, and CSS + BAF leaderboard business logic, component, and CSS
- [ ] 09-04-PLAN.md -- Wire all 5 components into index.html and main.js + browser verification checkpoint

### Phase 10: Decimator & Terminal
**Goal**: Players can participate in decimator burns and view terminal payout information, with GAMEOVER state fully surfaced -- these require new contract ABI integration not present in the beta.
**Depends on**: Phase 9
**Requirements**: DECI-01, DECI-02, DECI-03, TERM-01, TERM-02
**Success Criteria** (what must be TRUE):
  1. Player can submit BURNIE burns with bucket and sub-bucket selection; current burn pool, player burn total, and activity-score multiplier are displayed
  2. Decimator panel appears only when the decimator window is open; it is hidden at all other times
  3. Terminal decimator panel shows payout preview for level+1 ticketholders; terminal insurance bar shows accumulated stETH yield backup
**Plans:** 2/2 plans complete

Plans:
- [ ] 10-01-PLAN.md -- Infrastructure (store slices, ABIs, constants) + decimator business logic, component, and CSS
- [ ] 10-02-PLAN.md -- Terminal business logic, component, CSS + wire both components into index.html and main.js

### Phase 11: Audio & Polish
**Goal**: Sound effects are wired to game events and all UI states (loading, error, empty) are handled gracefully, making the product feel complete and production-ready.
**Depends on**: Phase 8, Phase 9
**Requirements**: AUD-01, AUD-02, AUD-03
**Success Criteria** (what must be TRUE):
  1. Win sounds play on jackpot reveal, coinflip win, and degenerette win; flip sound plays on coinflip resolution
  2. Urgency tone sounds when death timer enters imminent or distress stage
  3. All panels have loading skeleton states and error fallback states; no panel shows a broken or empty UI during data fetch
**Plans:** 2/2 plans complete

Plans:
- [ ] 11-01-PLAN.md -- Audio module (preload, autoplay unlock, playSound) + wire sound triggers to jackpot, coinflip, degenerette, death clock
- [ ] 11-02-PLAN.md -- Skeleton CSS + loading skeleton states for 8 panels + error fallback pattern for minor panels

### Phase 12: Integration Fixes & Cleanup
**Goal**: Close all integration gaps found by milestone audit: fix the affiliate referral localStorage key mismatch so referral codes flow through to purchases, consolidate the dual GAMEOVER trigger, remove orphaned code, and correct the CLAIM-02 requirements text.
**Depends on**: Phase 9, Phase 11
**Requirements**: AFFIL-02
**Gap Closure:** Closes gaps from v2.0-MILESTONE-AUDIT.md
**Success Criteria** (what must be TRUE):
  1. Affiliate referral code captured from URL is applied to all purchase transactions (tickets, lootboxes, passes)
  2. GAMEOVER panel activation uses a single code path (no dual-trigger race)
  3. No orphaned imports, exports, or store writes remain in milestone code
  4. CLAIM-02 requirements text accurately describes the two-transaction architecture
**Plans:** 1/1 plans complete

Plans:
- [ ] 12-01-PLAN.md -- Fix localStorage key, consolidate GAMEOVER trigger, remove orphaned code, update CLAIM-02 text

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Preparation | v1.0 | 1/1 | Complete | 2026-03-16 |
| 2. Number-Heavy Sections Audit | v1.0 | 3/3 | Complete | 2026-03-16 |
| 3. Mechanism-Heavy Sections Audit | v1.0 | 2/2 | Complete | 2026-03-16 |
| 4. Prose and Framing Sections Audit | v1.0 | 2/2 | Complete | 2026-03-16 |
| 5. Cross-Section Consistency and Report | v1.0 | 2/2 | Complete | 2026-03-17 |
| 6. Foundation | v2.0 | 3/3 | Complete | 2026-03-18 |
| 7. Purchasing & Core UI | v2.0 | 0/2 | Planned | - |
| 8. Hero Displays | v2.0 | 0/3 | Planned | - |
| 9. Supporting Features | v2.0 | 0/4 | Planned | - |
| 10. Decimator & Terminal | 2/2 | Complete    | 2026-03-18 | - |
| 11. Audio & Polish | 2/2 | Complete    | 2026-03-18 | - |
| 12. Integration Fixes & Cleanup | 1/1 | Complete   | 2026-03-18 | - |
