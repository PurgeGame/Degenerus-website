# Requirements: v2.4 Player UI

**Defined:** 2026-04-23
**Core Value:** Make the on-chain game playable, entertaining, and visually compelling from a browser

## v2.4 Requirements

Brand-new player-facing route surfacing every interactive system (purchase, tickets/packs, coinflip, BAF, decimator, activity/quests, jackpot replay) against the live sim/db. Read-only via player-selector dropdown — no wallet, no contract writes; purchases call sim API. Same stack as `beta/`: vanilla ES modules + Custom Elements + Proxy reactive store + GSAP.

### ROUTE — New player surface

- [x] **ROUTE-01**: User can navigate to a new top-level player route (e.g. `/play` or `/game`), separate from `/beta` and `/beta/viewer` (Phase 50)
- [x] **ROUTE-02**: User sees a player-selector dropdown on the new route to choose whose perspective to view (Phase 50)
- [x] **ROUTE-03**: New route has a primary layout with clear sections for profile, tickets, purchase, coinflip, BAF, decimator, jackpot (Phase 50)
- [x] **ROUTE-04**: New route loads with skeleton states for every panel and hydrates from API without wallet connection (Phase 50)

### PROFILE — Activity score + quests

- [ ] **PROFILE-01**: User can see selected player's current activity score with decomposition (quest streak, mint count, affiliate bonus, deity/whale flags)
- [ ] **PROFILE-02**: User can see selected player's current quest slots with progress, target, completion state, high-difficulty flag
- [ ] **PROFILE-03**: User can see selected player's quest streak counter and last completed day
- [ ] **PROFILE-04**: Profile panels re-render when day scrubber changes effective day

### TICKETS — 4-trait quadrant inventory

- [ ] **TICKETS-01**: User can see selected player's ticket inventory rendered as 4-trait quadrant cards
- [ ] **TICKETS-02**: Each ticket card visually shows its 4 traits in the 4 quadrants in a consistent aesthetic
- [ ] **TICKETS-03**: Ticket rendering groups 4 consecutive entries per card; partial groups render as pending
- [ ] **TICKETS-04**: Untraited entries (awaiting VRF) render as "pending pack" placeholders, not empty cards

### PACKS — Openable reveal experience

- [ ] **PACKS-01**: User sees an animated "pack" appear when selected player purchases tickets
- [ ] **PACKS-02**: User sees an animated "pack" appear when selected player wins tickets (from jackpot draws)
- [ ] **PACKS-03**: Pack stays closed until RNG resolves for that entry; opens to reveal 4-trait tickets when traits are assigned
- [ ] **PACKS-04**: Lootbox-sourced tickets open immediately on lootbox open (no RNG wait — traits are known at lootbox open time)
- [ ] **PACKS-05**: Pack-opening animation uses GSAP timeline with optional sound cue

### PURCHASE — Buy tickets + lootboxes via sim

- [ ] **PURCHASE-01**: User can trigger a ticket purchase for the selected player via the sim API
- [ ] **PURCHASE-02**: User can trigger a lootbox purchase for the selected player via the sim API
- [ ] **PURCHASE-03**: Purchase UI shows current ticket price, active level/cycle, total cost for the selected quantity
- [ ] **PURCHASE-04**: After purchase, the new pack appears in inventory and the selected player's state reflects the deposit

### COINFLIP — Play surface (read-only)

- [ ] **COINFLIP-01**: User can see selected player's coinflip state (deposited amount, claimable preview, auto-rebuy settings)
- [ ] **COINFLIP-02**: User can see the daily coinflip leaderboard with ranks
- [ ] **COINFLIP-03**: User can see current bounty, biggest-flip-today player and amount

### BAF — Leaderboard + player standing

- [ ] **BAF-01**: User can see selected player's current BAF score and rank at current level/window
- [ ] **BAF-02**: User can see top-4 BAF leaderboard with prominence-based styling matching beta's baf-panel
- [ ] **BAF-03**: User can see which level/window the BAF round is for and whether it is open

### DECIMATOR — State, bucket, payouts

- [ ] **DECIMATOR-01**: User can see decimator window state (open/closed, level, time remaining if applicable)
- [ ] **DECIMATOR-02**: User can see selected player's bucket/subbucket assignment per burned level
- [ ] **DECIMATOR-03**: User can see selected player's burn weight and effective amount per level
- [ ] **DECIMATOR-04**: User can see winning subbucket reveal and selected player's payout per resolved level
- [ ] **DECIMATOR-05**: User can see terminal decimator state (burns, weighted amount, time-multiplier) when applicable

### JACKPOT — Reuse beta roll widget

- [ ] **JACKPOT-01**: User can see Roll 1/Roll 2 trait reveal animation for the selected effective day's jackpot
- [ ] **JACKPOT-02**: Jackpot widget reuses beta's existing jackpot-panel Roll components without rewrite
- [ ] **JACKPOT-03**: Jackpot panel updates when day scrubber changes effective day

### DAY — Scrubber (dev now, player-facing later)

- [x] **DAY-01**: User can pick an effective day from a scrubber control on the new route (Phase 50)
- [x] **DAY-02**: All panels (PROFILE, TICKETS, PACKS, COINFLIP, BAF, DECIMATOR, JACKPOT) re-render from the selected day's snapshot (Phase 50 — panel stubs subscribe to `state.replay.day`; real hydration in Phases 51-55)
- [x] **DAY-03**: Scrubber lists only days that have available historical data (via `/replay/rng` or equivalent) (Phase 50)
- [x] **DAY-04**: Scrubber is labeled/gated as a dev tool for this milestone; design anticipates future player-facing read-only mode (Phase 50)

### INTEG — Backend coordination (database repo)

- [~] **INTEG-01**: Ship or confirm `GET /player/{addr}/tickets/by-trait` endpoint for trait-grouped ticket inventory (P0 — blocks TICKETS/PACKS). Phase 50 kickoff complete: contract spec written (INTEG-01-SPEC.md). Delivery (endpoint implementation in database repo) gates Phase 52.
- [ ] **INTEG-02**: Ship or confirm per-player BAF score endpoint (P1 — blocks BAF-01)
- [ ] **INTEG-03**: Ship or confirm per-player decimator bucket/payout endpoint (P1 — blocks DECIMATOR-02/03/04)
- [ ] **INTEG-04**: Ship or confirm coinflip recycle/history endpoint, OR document as deferred (optional — COINFLIP works without it)

## Future Requirements (deferred)

Tracked but not in v2.4 scope.

### Player surfaces deferred to v2.5+

- **PASS-xx**: Pass card display (bundles, deity, upgrade UX)
- **DEGEN-xx**: Degenerette slot UI
- **CLAIM-xx**: Claims panel + aggregated claimable preview
- **DEATH-xx**: Death clock urgency display
- **AFFIL-xx**: Affiliate code input + referral tree
- **BOONS-xx**: Boons-panel surface (already scaffolded in post-v2.3 work)
- **TERM-xx**: Full terminal-panel (decimator covers terminal-decimator; rest deferred)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Wallet connect (EIP-6963) | v2.4 is read-only via player-selector; future milestone re-introduces wallet writes |
| Real contract writes | Purchases go through sim API this milestone |
| Sim time-advance admin endpoint | Lives in sim repo, not website; not in this repo's scope |
| Backend endpoint implementation | Tracked in database repo; website repo only owns INTEG coordination requirements |
| Mobile native app | Web-first (unchanged from project-level constraint) |
| Chat or social features | Unchanged from project-level constraint |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ROUTE-01 | Phase 50 | Validated (2026-04-24) |
| ROUTE-02 | Phase 50 | Validated (2026-04-24) |
| ROUTE-03 | Phase 50 | Validated (2026-04-24) |
| ROUTE-04 | Phase 50 | Validated (2026-04-24) |
| PROFILE-01 | Phase 51 | Pending |
| PROFILE-02 | Phase 51 | Pending |
| PROFILE-03 | Phase 51 | Pending |
| PROFILE-04 | Phase 51 | Pending |
| TICKETS-01 | Phase 52 | Pending |
| TICKETS-02 | Phase 52 | Pending |
| TICKETS-03 | Phase 52 | Pending |
| TICKETS-04 | Phase 52 | Pending |
| PACKS-01 | Phase 52 | Pending |
| PACKS-02 | Phase 52 | Pending |
| PACKS-03 | Phase 52 | Pending |
| PACKS-04 | Phase 52 | Pending |
| PACKS-05 | Phase 52 | Pending |
| PURCHASE-01 | Phase 53 | Pending |
| PURCHASE-02 | Phase 53 | Pending |
| PURCHASE-03 | Phase 53 | Pending |
| PURCHASE-04 | Phase 53 | Pending |
| COINFLIP-01 | Phase 54 | Pending |
| COINFLIP-02 | Phase 54 | Pending |
| COINFLIP-03 | Phase 54 | Pending |
| BAF-01 | Phase 54 | Pending |
| BAF-02 | Phase 54 | Pending |
| BAF-03 | Phase 54 | Pending |
| DECIMATOR-01 | Phase 55 | Pending |
| DECIMATOR-02 | Phase 55 | Pending |
| DECIMATOR-03 | Phase 55 | Pending |
| DECIMATOR-04 | Phase 55 | Pending |
| DECIMATOR-05 | Phase 55 | Pending |
| JACKPOT-01 | Phase 52 | Pending |
| JACKPOT-02 | Phase 52 | Pending |
| JACKPOT-03 | Phase 52 | Pending |
| DAY-01 | Phase 50 | Validated (2026-04-24) |
| DAY-02 | Phase 50 | Validated (2026-04-24) — panel stubs subscribe to `state.replay.day`; hydration in 51-55 |
| DAY-03 | Phase 50 | Validated (2026-04-24) |
| DAY-04 | Phase 50 | Validated (2026-04-24) |
| INTEG-01 | Phase 50 (kickoff), Phase 52 (gate) | Kickoff done (2026-04-24); delivery pending |
| INTEG-02 | Phase 54 (gate) | Pending |
| INTEG-03 | Phase 55 (gate) | Pending |
| INTEG-04 | Phase 54 (gate, optional) | Pending |

**Coverage:**
- v2.4 requirements: 40 total
- Mapped to phases: 40
- Unmapped: 0

**Per-phase counts:**
- Phase 50 (Route Foundation & Day-Aware Store): 9 requirements (ROUTE-01..04, DAY-01..04, INTEG-01)
- Phase 51 (Profile & Quests): 4 requirements (PROFILE-01..04)
- Phase 52 (Tickets, Packs & Jackpot Reveal): 12 requirements (TICKETS-01..04, PACKS-01..05, JACKPOT-01..03)
- Phase 53 (Purchase Flow): 4 requirements (PURCHASE-01..04)
- Phase 54 (Coinflip & BAF Leaderboards): 8 requirements (COINFLIP-01..03, BAF-01..03, INTEG-02, INTEG-04)
- Phase 55 (Decimator): 6 requirements (DECIMATOR-01..05, INTEG-03)

INTEG-01 appears in two phases by design: Phase 50 owns the coordination kickoff (post the endpoint contract spec, ping database repo); Phase 52 gates on confirmed delivery before TICKETS/PACKS code lands.

Phase numbering jumps from 23 → 50 to avoid collision with out-of-band commits in git history (`feat(26-XX)`, `feat(32-XX)`, `feat(37-XX)`, `feat(38-XX)`, `feat(39-XX)`, `feat(44-XX)`) from work done in another repo.

---
*Requirements defined: 2026-04-23*
*Last updated: 2026-04-23 — traceability filled in for v2.4 roadmap (Phases 50-55)*
