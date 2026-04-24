# Roadmap: Degenerus Protocol Website

## Milestones

- v1.0 **Paper Audit** - Phases 1-5 (shipped 2026-03-18)
- v2.0 **Game Frontend** - Phases 6-12 (shipped 2026-03-18)
- v2.1 **Contract-Paper Gap Audit** - Phases 13-14 (shipped 2026-03-19)
- v2.2 **Contract-Paper Parity Check** - Phases 15-17 (shipped 2026-04-01)
- v2.3 **Live API Economic Validation** - Phases 18-23 (shipped 2026-04-15) — see [milestones/v2.3-ROADMAP.md](milestones/v2.3-ROADMAP.md)
- v2.4 **Player UI** - Phases 50-55 (in progress, started 2026-04-23) — numbering jumps from 23 to 50 to avoid collision with out-of-band phase numbers in git history

## Phases

<details>
<summary>v1.0 Paper Audit (Phases 1-5) - SHIPPED 2026-03-18</summary>

- [x] Phase 1: Preparation (1/1 plans) - completed 2026-03-16
- [x] Phase 2: Number-Heavy Sections Audit (3/3 plans) - completed 2026-03-16
- [x] Phase 3: Mechanism-Heavy Sections Audit (2/2 plans) - completed 2026-03-16
- [x] Phase 4: Prose and Framing Sections Audit (2/2 plans) - completed 2026-03-16
- [x] Phase 5: Cross-Section Consistency and Report (2/2 plans) - completed 2026-03-17

</details>

<details>
<summary>v2.0 Game Frontend (Phases 6-12) - SHIPPED 2026-03-18</summary>

- [x] Phase 6: Foundation (3/3 plans) - completed 2026-03-18
- [x] Phase 7: Purchasing & Core UI (2/2 plans) - completed 2026-03-18
- [x] Phase 8: Hero Displays (3/3 plans) - completed 2026-03-18
- [x] Phase 9: Supporting Features (4/4 plans) - completed 2026-03-18
- [x] Phase 10: Decimator & Terminal (2/2 plans) - completed 2026-03-18
- [x] Phase 11: Audio & Polish (2/2 plans) - completed 2026-03-18
- [x] Phase 12: Integration Fixes & Cleanup (1/1 plans) - completed 2026-03-18

</details>

<details>
<summary>v2.1 Contract-Paper Gap Audit (Phases 13-14) - SHIPPED 2026-03-19</summary>

- [x] Phase 13: Contract Mechanic Extraction (4/4 plans) - completed 2026-03-19
- [x] Phase 14: Gap Analysis and Report (2/2 plans) - completed 2026-03-19

</details>

<details>
<summary>v2.2 Contract-Paper Parity Check (Phases 15-17) - SHIPPED 2026-04-01</summary>

- [x] Phase 15: Game & Modules Parity (4/4 plans) - completed 2026-04-01
- [x] Phase 16: Token & Support Systems Parity (4/4 plans) - completed 2026-04-01
- [x] Phase 17: Consolidated Parity Report (1/1 plans) - completed 2026-04-01

</details>

<details>
<summary>v2.3 Live API Economic Validation (Phases 18-23) - SHIPPED 2026-04-15</summary>

- [x] Phase 18: METHOD Foundation (3/3 plans) - completed 2026-04-13
- [x] Phase 19: JACKPOT Validation (4/4 plans) - completed 2026-04-13
- [x] Phase 20: POOLS Validation (3/3 plans) - completed 2026-04-15
- [x] Phase 21: PLAYER Validation (3/3 plans) - completed 2026-04-15
- [x] Phase 22: TERMINAL Validation (2/2 plans) - completed 2026-04-15
- [x] Phase 23: Consolidated Validation Report (1/1 plans) - completed 2026-04-15

</details>

<details>
<summary>v2.4 Player UI (Phases 50-55) - IN PROGRESS</summary>

Note: phase numbering jumps from 23 → 50 to avoid collision with out-of-band commits in git history (`feat(26-XX)`, `feat(32-XX)`, `feat(37-XX)`, `feat(38-XX)`, `feat(39-XX)`, `feat(44-XX)`) from work done in another repo.

- [ ] **Phase 50: Route Foundation & Day-Aware Store** - New player route shell, player-selector, day scrubber, day-aware store contract, INTEG-01 coordination kickoff
- [ ] **Phase 51: Profile & Quests** - Activity score breakdown + quest slots/streak panels (lowest-risk validation of day-aware contract)
- [ ] **Phase 52: Tickets, Packs & Jackpot Reveal** - 4-trait quadrant inventory, openable pack animation (purchase + win sources), reused beta jackpot Roll widget
- [ ] **Phase 53: Purchase Flow** - Sim-API ticket and lootbox purchase with inventory feedback loop into Phase 52 packs
- [ ] **Phase 54: Coinflip & BAF Leaderboards** - Player coinflip state + leaderboards, BAF score and prominence-styled top-4
- [ ] **Phase 55: Decimator** - Window state, bucket/subbucket assignment, weighted burns, payouts, terminal-decimator state

## Phase Details

### Phase 50: Route Foundation & Day-Aware Store
**Goal**: A new top-level player route exists with skeleton-loading panels, player-selector, and a day scrubber that all subsequent panels can subscribe to natively.
**Depends on**: Nothing (first phase of v2.4; reuses beta module/store patterns)
**Requirements**: ROUTE-01, ROUTE-02, ROUTE-03, ROUTE-04, DAY-01, DAY-02, DAY-03, DAY-04, INTEG-01
**Success Criteria** (what must be TRUE):
  1. User can navigate to the new top-level route (e.g. `/play`) and sees the primary layout with named sections for profile, tickets, purchase, coinflip, BAF, decimator, jackpot
  2. User sees a player-selector dropdown that, on change, updates the active player address propagated to every panel
  3. User sees a day scrubber control listing only days with available historical data; changing the day mutates a `state.effectiveDay` in the reactive store and emits a re-render signal
  4. User sees skeleton states in every section on first load and watches them hydrate from API without any wallet connection prompt
  5. INTEG-01 (`GET /player/{addr}/tickets/by-trait`) is confirmed shipped or stubbed by the database repo with a contract spec posted in this phase's notes, unblocking Phase 52
**Plans**: TBD
**UI hint**: yes

### Phase 51: Profile & Quests
**Goal**: Selected player's activity score, quest slots, and streak are fully displayed and re-render correctly when the day scrubber changes.
**Depends on**: Phase 50
**Requirements**: PROFILE-01, PROFILE-02, PROFILE-03, PROFILE-04
**Success Criteria** (what must be TRUE):
  1. User sees the selected player's activity score with a visible decomposition (quest streak floor, mint count floor, affiliate bonus, deity/whale flags)
  2. User sees the player's quest slots with progress bar, target value, completion state, and high-difficulty flag styling
  3. User sees the quest streak counter and the date of the last completed day
  4. Changing the day scrubber re-renders all profile panels from that day's snapshot without manual refresh, and changing the player-selector re-renders for the new address
**Plans**: TBD
**UI hint**: yes

### Phase 52: Tickets, Packs & Jackpot Reveal
**Goal**: Selected player's tickets render as 4-trait quadrant cards with openable pack animations from every source (purchase, jackpot win, lootbox), reusing the beta jackpot Roll widget for the trait reveal.
**Depends on**: Phase 50 (route + store), Phase 51 (validates day-aware contract end-to-end), INTEG-01 confirmed
**Requirements**: TICKETS-01, TICKETS-02, TICKETS-03, TICKETS-04, PACKS-01, PACKS-02, PACKS-03, PACKS-04, PACKS-05, JACKPOT-01, JACKPOT-02, JACKPOT-03
**Success Criteria** (what must be TRUE):
  1. User sees the selected player's ticket inventory grouped into 4-trait quadrant cards (4 entries per card, partial groups rendered as pending placeholders, untraited entries rendered as "pending pack" placeholders)
  2. User sees an animated pack appear when the selected player purchases tickets and a separate animated pack appear when they win tickets from a jackpot draw
  3. User watches the pack stay closed until VRF resolves and then open via a GSAP timeline (with optional sound cue) to reveal the 4-trait card; lootbox-sourced packs open immediately on lootbox open since traits are known at that moment
  4. User sees the Roll 1 / Roll 2 trait reveal animation for the selected effective day's jackpot, rendered by the lift-and-shifted beta `jackpot-panel` Roll components (no rewrite)
  5. Changing the day scrubber re-renders both the ticket inventory snapshot and the jackpot reveal for that effective day
**Plans**: TBD
**UI hint**: yes

### Phase 53: Purchase Flow
**Goal**: User can trigger ticket and lootbox purchases for the selected player via the sim API and immediately see the resulting pack appear in inventory.
**Depends on**: Phase 52 (pack rendering + inventory)
**Requirements**: PURCHASE-01, PURCHASE-02, PURCHASE-03, PURCHASE-04
**Success Criteria** (what must be TRUE):
  1. User can click a Buy Tickets control and trigger a sim-API ticket purchase for the selected player; the purchase succeeds without any wallet prompt
  2. User can click a Buy Lootbox control and trigger a sim-API lootbox purchase for the selected player
  3. User sees the current ticket price, active level/cycle, and computed total cost for the chosen quantity before confirming
  4. After a successful purchase, a new pack appears in the inventory panel and the selected player's deposit-related fields update in the store within one render cycle
**Plans**: TBD
**UI hint**: yes

### Phase 54: Coinflip & BAF Leaderboards
**Goal**: Selected player's coinflip state and BAF standing are visible, and both leaderboards render with prominence styling that mirrors beta.
**Depends on**: Phase 50 (route + store); Phase 51 (PROFILE patterns informed by activity score)
**Requirements**: COINFLIP-01, COINFLIP-02, COINFLIP-03, BAF-01, BAF-02, BAF-03, INTEG-02, INTEG-04
**Success Criteria** (what must be TRUE):
  1. User sees the selected player's coinflip state — deposited amount, claimable preview, auto-rebuy settings — and the daily coinflip leaderboard with ranks
  2. User sees the current bounty plus the biggest-flip-today player and amount, both reading from the live API
  3. User sees the selected player's BAF score and rank for the current level/window, alongside the top-4 BAF leaderboard with prominence-based styling matching beta's `baf-panel`
  4. User sees a label indicating which level/window the BAF round is for and whether the round is open or closed
  5. INTEG-02 (per-player BAF score) is confirmed shipped before BAF-01 lands; INTEG-04 (coinflip recycle/history) is either confirmed or formally documented as deferred with COINFLIP still functional
**Plans**: TBD
**UI hint**: yes

### Phase 55: Decimator
**Goal**: Selected player's full decimator picture — window state, bucket assignment, weighted burns, winning subbucket payout, and terminal-decimator state — is visible per resolved level.
**Depends on**: Phase 50 (route + store), Phase 51 (activity score informs bucket logic), INTEG-03 confirmed
**Requirements**: DECIMATOR-01, DECIMATOR-02, DECIMATOR-03, DECIMATOR-04, DECIMATOR-05, INTEG-03
**Success Criteria** (what must be TRUE):
  1. User sees the decimator window state (open/closed, level, time remaining when applicable)
  2. User sees the selected player's bucket and subbucket assignment per burned level, plus their burn weight and effective burn amount per level
  3. User sees the winning subbucket reveal and the selected player's payout per resolved level
  4. User sees terminal decimator state (burns, weighted amount, time-multiplier) when the protocol enters terminal phase
  5. INTEG-03 (per-player decimator bucket/payout endpoint) is confirmed shipped before DECIMATOR-02/03/04 land
**Plans**: TBD
**UI hint**: yes

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Preparation | v1.0 | 1/1 | Complete | 2026-03-16 |
| 2. Number-Heavy Sections Audit | v1.0 | 3/3 | Complete | 2026-03-16 |
| 3. Mechanism-Heavy Sections Audit | v1.0 | 2/2 | Complete | 2026-03-16 |
| 4. Prose and Framing Sections Audit | v1.0 | 2/2 | Complete | 2026-03-16 |
| 5. Cross-Section Consistency and Report | v1.0 | 2/2 | Complete | 2026-03-17 |
| 6. Foundation | v2.0 | 3/3 | Complete | 2026-03-18 |
| 7. Purchasing & Core UI | v2.0 | 2/2 | Complete | 2026-03-18 |
| 8. Hero Displays | v2.0 | 3/3 | Complete | 2026-03-18 |
| 9. Supporting Features | v2.0 | 4/4 | Complete | 2026-03-18 |
| 10. Decimator & Terminal | v2.0 | 2/2 | Complete | 2026-03-18 |
| 11. Audio & Polish | v2.0 | 2/2 | Complete | 2026-03-18 |
| 12. Integration Fixes & Cleanup | v2.0 | 1/1 | Complete | 2026-03-18 |
| 13. Contract Mechanic Extraction | v2.1 | 4/4 | Complete | 2026-03-19 |
| 14. Gap Analysis and Report | v2.1 | 2/2 | Complete | 2026-03-19 |
| 15. Game & Modules Parity | v2.2 | 4/4 | Complete | 2026-04-01 |
| 16. Token & Support Systems Parity | v2.2 | 4/4 | Complete | 2026-04-01 |
| 17. Consolidated Parity Report | v2.2 | 1/1 | Complete | 2026-04-01 |
| 18. METHOD Foundation | v2.3 | 3/3 | Complete   | 2026-04-13 |
| 19. JACKPOT Validation | v2.3 | 4/4 | Complete   | 2026-04-13 |
| 20. POOLS Validation | v2.3 | 3/3 | Complete    | 2026-04-15 |
| 21. PLAYER Validation | v2.3 | 3/3 | Complete    | 2026-04-15 |
| 22. TERMINAL Validation | v2.3 | 2/2 | Complete    | 2026-04-15 |
| 23. Consolidated Validation Report | v2.3 | 1/1 | Complete    | 2026-04-15 |
| 50. Route Foundation & Day-Aware Store | v2.4 | 0/0 | Not started | - |
| 51. Profile & Quests | v2.4 | 0/0 | Not started | - |
| 52. Tickets, Packs & Jackpot Reveal | v2.4 | 0/0 | Not started | - |
| 53. Purchase Flow | v2.4 | 0/0 | Not started | - |
| 54. Coinflip & BAF Leaderboards | v2.4 | 0/0 | Not started | - |
| 55. Decimator | v2.4 | 0/0 | Not started | - |
