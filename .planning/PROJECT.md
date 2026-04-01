# Degenerus Protocol Website & Game Frontend

## What This Is

The web presence for the Degenerus Protocol: a game theory paper (theory/index.html), whitepaper (whitepaper/index.html), and the game frontend (beta/index.html) where players interact with the on-chain game. The frontend is a modular ES module application using Custom Elements, a Proxy-based reactive store, and ethers.js for contract interaction. It connects to a PostgreSQL database via a Fastify REST API for reads and sends contract writes directly via ethers.js.

## Core Value

Make the on-chain game playable, entertaining, and visually compelling from a browser.

## Current State

v2.2 Phase 15 complete (2026-04-01): Game & Modules parity check across 14 contracts (DegenerusGame.sol + 12 modules + storage). 13 discrepancies found (4 Major, 4 Minor, 5 Info). Parity notes ready for Phase 17 consolidation.

Shipped v2.1 Contract-Paper Gap Audit (2026-03-19): complete cross-reference of 266 contract mechanics against game theory paper. 70 fully documented, 89 partially documented, 63 undocumented but game-theoretically relevant, 44 implementation details. Gap report with blank decision columns ready for user action.

Previously shipped v2.0 Game Frontend (2026-03-18): complete game frontend rebuilt from monolith into 15 Custom Element components with centralized business logic modules. 10,462 LOC across JS/CSS/HTML. All core game actions functional.

Previously shipped v1.0 Paper Audit (2026-03-18): systematic audit of all 423 numerical/mechanism claims in the game theory paper.

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

### Active

(None - next milestone not yet planned)

### Out of Scope

- Mobile native app (web-first, responsive design)
- Smart contract development (separate repo)
- Database/API development (separate repo, consumed as dependency)
- Chat or social features

## Context

- Tech stack: Vanilla HTML/CSS/JS, ES modules with import map, ethers.js v6, GSAP 3.14, canvas-confetti
- Architecture: 15 Custom Elements, Proxy-based reactive store, centralized business logic modules
- Database API: PostgreSQL + Fastify REST at localhost:3000 (not yet tested end-to-end)
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

## Current Milestone: v2.2 Contract-Paper Parity Check

**Goal:** Verify all game theory paper claims against updated contract source and produce notes/feedback on discrepancies.

**Target features:**
- Re-verify all numerical claims, mechanism descriptions, and economic parameters against current contract code
- Identify any new mechanics or changed parameters not yet reflected in the paper
- Produce structured notes with discrepancies (no paper edits)

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
*Last updated: 2026-04-01 after Phase 15 complete*
