# Degenerus Protocol Website & Game Frontend

## What This Is

The web presence for the Degenerus Protocol: a game theory paper (theory/index.html), whitepaper (whitepaper/index.html), and the game frontend (beta/index.html) where players interact with the on-chain game. The frontend is a modular ES module application using Custom Elements, a Proxy-based reactive store, and ethers.js for contract interaction. It connects to a PostgreSQL database via a Fastify REST API for reads and sends contract writes directly via ethers.js.

## Core Value

Make the on-chain game playable, entertaining, and visually compelling from a browser.

## Current State

Shipped v2.4 Player UI (2026-04-24): brand-new `/play` route with player-selector + day scrubber + 9 wallet-free Custom Elements; six panels (Profile, Tickets, Packs, Coinflip, BAF, Decimator) hydrated against live database API; 4 INTEG endpoints + PACKS-V2 endpoint shipped in sibling database repo with full vitest coverage; 333/333 play/ tests green. Mid-milestone PACKS-V2 redesign caught a real 1808-empty-pack bug and re-architected on a day-keyed reveal model. PURCHASE-03 live; PURCHASE-API-SPEC.md authored for the deferred sim HTTP API (SIM-01). ~50 manual UAT scenarios deferred to v2.5+ cross-panel sweep. See `.planning/milestones/v2.4-ROADMAP.md`.

Shipped v2.3 Live API Economic Validation (2026-04-15): Python derivation harness + domain validators (JACKPOT/POOLS/PLAYER/TERMINAL) + consolidated report renderer. JACKPOT live-run produced 111 discrepancies; POOLS/PLAYER/TERMINAL validators wired and tested, live-runs pending indexer availability. Consolidated report at `.planning/v2.3/reports/v2.3-consolidated.md` (112 entries, cross-domain synthesis, sha256 provenance). 480 tests passing. Surfaced 5+ Major source-doc drifts between REQUIREMENTS.md/GT paper/MEMORY.md and audit contracts (notably the "turbo 2-day death clock" myth). See `.planning/milestones/v2.3-ROADMAP.md`.

Shipped v2.2 Contract-Paper Parity Check (2026-04-01): verified all 24 contracts against game theory paper claims. 23 discrepancies found (1 Critical, 6 Major, 7 Minor, 9 Info) with fix guidance. 6 new mechanics recommended for documentation. Consolidated parity report at `.planning/phases/17-consolidated-parity-report/17-PARITY-REPORT.md`.

Shipped v2.1 Contract-Paper Gap Audit (2026-03-19): complete cross-reference of 266 contract mechanics against game theory paper. Gap report with decision columns ready for user action.

Shipped v2.0 Game Frontend (2026-03-18): 15 Custom Element components, 10,462 LOC. All core game actions functional.

Shipped v1.0 Paper Audit (2026-03-18): 423 claims audited, 91.7% verified.

Database layer (separate repo at /home/zak/Dev/PurgeGame/database/) provides PostgreSQL + Drizzle ORM + Fastify REST API. Not yet tested end-to-end with the frontend.

## Requirements

### Validated

- Every numerical claim in game theory paper verified against contracts (v1.0)
- Complete audit report with severity ratings and sketched fixes (v1.0)
- Cross-section consistency validated across 8 inter-section clusters (v1.0)
- Production-quality game frontend rebuilt from extracted beta/ patterns (v2.0)
- Jackpot and coinflip as hero display experiences (v2.0)
- All core game actions: tickets, lootboxes, coinflip, degenerette, passes, quests, decimator, claims (v2.0)
- Death timer and terminal decimator (v2.0)
- Affiliate infrastructure (create and input codes) (v2.0)
- BAF scores (contextual prominence based on level phase) (v2.0)
- Database API integration for all reads, contract writes via ethers.js (v2.0)
- Systematic mechanic extraction from all contract files (v2.1)
- Cross-reference every mechanic against game theory paper coverage (v2.1)
- Gap report: each undocumented mechanic, what it does, contract location (v2.1)
- Game & Modules parity notes: 14 contracts verified, 13 discrepancies documented with severity (v2.2 Phase 15)
- Token & Support Systems parity notes: 10 contracts verified, 11 discrepancies documented with severity (v2.2 Phase 16)
- Consolidated parity report: 23 discrepancies across 24 contracts with fix guidance, 6 new mechanics identified (v2.2 Phase 17)
- Reusable Python expected-value derivation harness across 4 domains (v2.3 Phase 18)
- JACKPOT live-run against indexer, 111 discrepancies captured (v2.3 Phase 19)
- POOLS/PLAYER/TERMINAL validators wired with coverage-gap entries and live-run gating (v2.3 Phases 20-22)
- Consolidated validation report renderer with severity×domain cross-tab and sha256 provenance (v2.3 Phase 23)
- New `/play/` top-level player route with day-aware store, player-selector, day scrubber, and 9 wallet-free Custom Elements (v2.4 Phase 50)
- Activity score breakdown + quest slots/streak + daily activity counts on /play, day-aware re-render via INTEG-02 (v2.4 Phase 51)
- 4-trait quadrant ticket inventory + openable PACKS-V2 day-keyed reveal animation + reused beta jackpot Roll widget on /play (v2.4 Phase 52)
- Purchase UI showing live price/level/cycle/total-cost on /play (PURCHASE-03; v2.4 Phase 53)
- Coinflip state + leaderboards and BAF score + prominence-styled top-4 leaderboard on /play (v2.4 Phase 54)
- Decimator window state, bucket/subbucket assignment, weighted burns, payouts, terminal state on /play (v2.4 Phase 55)
- Day scrubber dev tool for inspecting any historical day from the selected player's perspective (v2.4 Phase 50)
- Coordinated backend additions: INTEG-01 ticket-by-trait, INTEG-02 extended player day-aware, INTEG-03 decimator, INTEG-05 BAF, PACKS-V2 day-keyed packs (v2.4)
- SHELL-01 invariant: zero ethers/wallet/contracts/beta-utils imports in play/ (recursive grep guard with 14 FORBIDDEN entries) (v2.4)

### Active

- v2.5+ cross-panel UAT sweep: ~50 deferred manual scenarios across all 6 v2.4 panels need a single-session browser exercise to verify visual/device contract
- SIM-01 sim HTTP API: build `POST /player/:address/buy-tickets` + `/buy-lootbox` per `PURCHASE-API-SPEC.md` to unblock PURCHASE-01/02/04
- INTEG-04 (coinflip recycle/history): formally deferred per ROADMAP SC5; revisit if player-rank-below-top-10 surfacing is needed

### Out of Scope

- Mobile native app (web-first, responsive design)
- Smart contract development (separate repo)
- Database/API development (separate repo, consumed as dependency)
- Chat or social features

## Context

- Tech stack: Vanilla HTML/CSS/JS, ES modules with import map, ethers.js v6 (beta/ only), GSAP 3.14, canvas-confetti
- Architecture: 24 Custom Elements (15 in beta/, 9 in play/), Proxy-based reactive store, centralized business logic modules
- Two top-level routes: `/beta/` (full wallet-connected dev panels) and `/play/` (read-only, day-aware, wallet-free per SHELL-01)
- Database API: PostgreSQL + Fastify REST at localhost:3000; consumed end-to-end by /play across 5 INTEG endpoints + PACKS-V2
- Contracts: Sepolia testnet (chainId 11155111)
- Badge system: 6 card types x 8 colors as individual SVGs
- Design tokens: CSS custom properties in :root and shared/nav.css
- Dev server required: python3 -m http.server 8080 (file:// will not work with ES modules)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vanilla JS, no framework | No build step, simple deployment, direct DOM control | Good |
| Dark theme with orange/purple accents | Game aesthetic, matches crypto/degen culture | Good |
| ES modules with import map | No bundler, CDN dependencies via esm.sh | Good |
| Proxy-based reactive store | Replaces ~45 shared mutable globals from monolith | Good |
| Custom Elements (no Shadow DOM) | Global CSS applies directly, no style duplication | Good |
| Centralized business logic modules | Components never import ethers; logic testable in isolation | Good |
| GSAP for timeline animations | Replaces setTimeout chains; preloaded on mount to avoid CDN jank | Good |
| Database API as data source | Indexed blockchain data, fast queries, pagination | Good |
| EIP-6963 multi-wallet discovery | Future-proof wallet connection; MetaMask fallback for compatibility | Good |
| CSS organized by concern | base/panels/buttons/forms/tx-status/status-bar; not per-component | Good |
| dailyRng.finalWord deferred | Backend API not yet extended; jackpot degrades to stats-only | Pending |
| Separate `/play/` route, wallet-free | Player-facing surface that's read-only via player-selector; no EIP-6963 connect, no contract writes | Good (v2.4) |
| SHELL-01 invariant on /play/ | Zero ethers/wallet/contracts/beta-utils imports — enforced by recursive grep test | Good (v2.4) |
| Day-aware fetch pattern (#fetchId + .is-stale) | Late-response stale guard + keep-old-data-dim across day-scrubber re-renders | Good (v2.4) |
| Cross-repo INTEG-NN-SPEC + 3-commit ship | Posted spec doc unblocks gating phase; database repo ships feat + docs + test atomically | Good (v2.4) |
| Wave-based phase execution (0/1/2/3) | Wave 0 RED tests + spec → Wave 1 panel hydration → Wave 2 backend wiring → Wave 3 UAT | Good (v2.4) |
| Contract-truth over CONTEXT documents | When planner research conflicts with execution-spec assumptions, contract source wins | Good (v2.4 — Phase 55 D-03 catch) |
| Mid-milestone redesign acceptable when bug-driven | PACKS-V2 day-keyed model added 3 plans + new endpoint mid-Phase-52; shipped same day | Good (v2.4) |
| Deferred UAT acceptable when documented | Aggregate ~50 scenarios queued for v2.5+ cross-panel sweep with NN-UAT.md per phase | Pending (v2.4) |

## Constraints

- No build step (static site hosting)
- Must work with MetaMask/EIP-1193/EIP-6963 wallet providers
- All game state reads from database API, writes go direct to contracts
- Must support Sepolia testnet for development
- Dev server required (ES modules don't work over file://)

## Known Tech Debt

- dailyRng.finalWord not in API: jackpot trait reveal animation in stats-only mode until backend extended
- Dead quadrantLabel() export in jackpot-data.js
- Sound files (win.mp3, flip.mp3, urgency.mp3) are README placeholders requiring user setup

## Current Milestone

v2.4 Player UI shipped 2026-04-24. Next milestone planning pending — run `/gsd-new-milestone` to define v2.5 scope.

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-02 after v2.4 Player UI milestone shipped*
