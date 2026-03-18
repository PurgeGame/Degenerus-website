# Project Research Summary

**Project:** Degenerus Game Frontend v2.0
**Domain:** Animated on-chain gambling game frontend (vanilla JS, no build step)
**Researched:** 2026-03-18
**Confidence:** HIGH

## Executive Summary

This is a rebuild of a working 4600-line monolith into a modular vanilla JS application that serves as the primary player interface for an on-chain lottery/jackpot protocol. The existing beta prototype has all the core mechanics working — scratch-off jackpot, coinflip, degenerette slot machine, wallet connection, contract writes via ethers.js — but it is one file with no module boundaries, global state, and no connection to the live database API. The rebuild must preserve what works while introducing modularity, reactivity, and new game features (death timer, decimator, terminal decimator, unified claims).

The recommended approach is a dependency-minimal, no-build architecture: ES modules with import maps, a Proxy-based reactive store, Custom Elements (no Shadow DOM) for components, GSAP for timeline animation, and REST polling for game state. The total new dependency weight is ~38KB gzipped (GSAP + canvas-confetti). Every rejected technology (Three.js, WebSockets, Tailwind, Howler.js) adds complexity without user-facing benefit given the project constraints.

The primary risk is the monolith extraction itself. The existing IIFEs share implicit closure-scoped state across ~45 mutable variables. If you extract modules without mapping the full dependency graph first, modules break silently at runtime. The second risk is the "write API, read database" desync pattern: after any transaction, the contract updates immediately but the database indexer has 1-15 second latency. Without optimistic updates, players see stale state after purchases. Both risks are well-understood and have clear prevention strategies; neither requires a change of approach.

## Key Findings

### Recommended Stack

The existing stack is correct and requires only targeted additions. Vanilla HTML/CSS/JS with ethers.js v6 via esm.sh stays. The critical addition is GSAP 3.14 (now fully free post-Webflow acquisition) for timeline-based animation orchestration — the jackpot reveal, coinflip, and degenerette all require multi-step choreographed animations with callbacks, which CSS keyframes and manual setTimeout chains cannot deliver cleanly. canvas-confetti adds win celebrations at 6KB. Import maps centralize version pinning.

**Core technologies:**
- **ethers.js 6.16:** Wallet connection + contract reads/writes — already working, keep via import map
- **GSAP 3.14 (core + Flip + TextPlugin):** Timeline animation orchestration — replaces setTimeout chains; `onStart`/`onComplete` callbacks integrate sound and state changes precisely
- **canvas-confetti 1.9:** Win celebration particle bursts — 6KB, zero deps, purpose-built for this use case
- **Import maps (native browser):** Dependency version pinning — 93% browser support, eliminates CDN URL repetition across modules
- **Web Audio API (existing):** Procedural sound synthesis — extract to `sfx.js`, extend with 5 new effects
- **CSS custom properties (existing):** Design tokens, dark theme — unchanged
- **Canvas 2D (existing):** Scratch-off pixel manipulation — keep, cannot be replicated in CSS

**Explicitly rejected (with rationale in STACK.md):**
Three.js (150KB for one animation), Howler.js (stale, no ESM, procedural synthesis already works), React/Vue/Svelte (no-build constraint), WebSockets (REST polling adequate), Alpine/Lit (adds abstraction without benefit).

### Expected Features

The feature priority order follows user trust before entertainment: players must be able to find their money and confirm transactions are real before any cosmetic enhancement matters. The research identified a clear gap between what the beta provides (table stakes partially built) and what is missing (hero experiences for the game's two biggest moments: jackpot resolution and coinflip).

**Must have (table stakes) — all partially or fully built in beta:**
- One-click wallet connection (EIP-1193) — built, needs EIP-6963 upgrade
- Transaction status with etherscan link + receipt verification — built, needs `receipt.status` check
- Chain validation with auto-switch prompt — built, add wallet_switchEthereumChain
- Ticket/lootbox purchase with ETH and BURNIE modes — built
- Dynamic price display — partially built, needs event-driven updates
- Unified claimable winnings panel — NOT built; individual claim buttons scattered across features
- Contract address display for trust verification — NOT built

**Should have (differentiators):**
- Animated jackpot trait-lock sequence (hero reveal) — beta is 80% there; promote to hero, refine
- Color-staged death timer (green/yellow/red urgency escalation) — NOT built; highest emotional leverage per feature
- Full-screen coinflip display with multiplier visualization — NOT built; currently a sidebar widget
- Quest streak UI with shield indicator and progress bars — partially built (text-only), needs visual upgrade
- Decimator UI with bucket display and burn weight multiplier — NOT built; new contract integration
- Affiliate code creation flow — NOT built (input exists, creation does not)
- State-driven UI transitions (purchase phase vs jackpot phase vs GAMEOVER) — NOT built; panels don't reshape around game phase

**Defer to later milestones:**
- Terminal decimator / death bet interface (most complex feature, depends on GAMEOVER conditions)
- BAF leaderboard (needs database API, contextually relevant on certain levels only)
- Streak calendar/heatmap (visualization, not functionally blocking)
- Affiliate earnings dashboard (affiliates cope with etherscan until this ships)
- Provably fair verification page (can ship as standalone page)

**Anti-features (explicitly do not build):**
Chat/social feed, autoplay/auto-bet loops, USD pricing, WebSocket price feeds, token analytics dashboard, mobile native app, complex onboarding wizard, fake urgency timers.

### Architecture Approach

The recommended architecture is a reactive-store-driven Custom Elements system. A Proxy-based `store.js` (~80 lines) is the single source of truth; all components subscribe to state paths and re-render on changes. `contracts.js` handles all ethers.js writes and emits standardized `tx:pending/submitted/confirmed/error` events. `api.js` is a REST client with 10s stale-while-revalidate caching. `router.js` subscribes to `game.phase` and toggles panel visibility. The nav component stays as an IIFE (cross-page use), wired to the store via events.

**Major components:**
1. **store.js** — Proxy-based reactive state singleton; all shared state (game, player, UI); all components subscribe; single source of truth
2. **contracts.js** — ethers.js provider/signer/contract instances; all write transactions; standardized event lifecycle; replaces window.Mint global
3. **api.js** — REST client for Fastify database API; stale-while-revalidate cache; powers all history, leaderboard, and player-stats reads
4. **router.js** — Phase-aware panel visibility; subscribes to game.phase + wallet state; shows/hides features based on what's actionable in the current phase
5. **Feature modules** — jackpot, degenerette, coinflip, quests, decimator, claims, leaderboards; each self-contained, subscribes to store, calls contracts
6. **Custom Element components** — status-bar, purchase-panel, death-timer, badge-diamond, tx-status; lifecycle-managed, subscribe/unsubscribe on connect/disconnect

**Key patterns:**
- Reactive store (Proxy) replaces global variables and enables predictable re-renders
- EventTarget event bus replaces window function calls across IIFEs
- Import map replaces inline CDN URLs scattered across modules
- Phase-aware router is the gate for all panel visibility (purchase vs jackpot vs GAMEOVER state)

### Critical Pitfalls

1. **Implicit dependency spaghetti during monolith extraction** — The jackpot IIFE alone has ~25+ mutable variables; degenerette IIFE shares closure state with jackpot. Extract bottom-up only: pure utilities first (badge paths, math helpers), then state containers, then UI controllers. Define explicit `JackpotState`/`DegenState`/`WalletState` objects in the monolith and verify it still works before splitting files. Never extract top-down.

2. **Transaction pending states that lie** — `mint.js` lines 756-757 treat any receipt as success. `tx.wait()` resolves on revert too. Always check `receipt.status === 1`. After any write, re-fetch affected state from the contract. Persist pending tx hashes in localStorage so page reloads can recover pending state.

3. **API-vs-contract desync after writes** — Database indexer has 1-15s latency after any transaction. Showing stale ticket count after purchase triggers double-buys. Apply optimistic updates immediately on tx confirmation, then schedule a verification read from the API 5-15 seconds later. Never disable action buttons based solely on API data.

4. **VRF pending states lasting minutes without feedback** — Chainlink VRF takes 12-36s on mainnet, longer on Sepolia, up to 24h timeout. Persist pending bet IDs to localStorage. Show multi-stage progress with elapsed time. After 2 minutes, show a non-alarming "safe on-chain, can close page" message.

5. **ES modules require a dev server** — The beta works via `file://` because it uses classic scripts. ES modules enforce CORS even locally. Document `python3 -m http.server 8080` as the required dev workflow on day one. No exceptions.

**Additional critical pitfalls:** background tab setInterval throttling (add visibilitychange handler for all polls), canvas scratch coordinate drift on high-DPI mobile (use getBoundingClientRect/width ratio, test in MetaMask mobile browser), death timer timezone drift (show relative times only, anchor to block timestamp not Date.now()), wallet provider detection race (use EIP-6963 event-based discovery with setTimeout fallback).

## Implications for Roadmap

Based on research, the architecture file's migration strategy maps directly to a 6-phase roadmap. Every phase has clear dependencies and a clear reason for its position.

### Phase 1: Foundation — Store, Modules, Wallet

**Rationale:** Nothing else can be built until the module system exists and the global variable problem is solved. This phase eliminates the monolith, establishes the store, and produces a working (if visually unpolished) wallet connection.

**Delivers:** ES module file structure, import map, Proxy-based store, EventTarget event bus, constants.js (eliminates duplication), api.js REST client, contracts.js (replaces window.Mint), EIP-6963 wallet discovery, dev server documentation

**Addresses:** Wallet connection (table stakes), chain validation, ETH/BURNIE balance display

**Avoids:** Pitfall 1 (dependency spaghetti — map graph first), Pitfall 2 (ES module CORS — document dev server), Pitfall 10 (wallet detection race — EIP-6963), Pitfall 8 (background tab polling — visibilitychange pattern established here), Pitfall 16 (localStorage namespacing), Pitfall 19 (compliance hooks — TOS gate stub)

**Research flag:** Standard well-documented patterns. No research-phase needed.

### Phase 2: Contract Layer and Core UI Components

**Rationale:** Purchase panel, transaction status, and the status bar depend on the store and contracts. These are the most-used UI elements; proving the component pattern here means hero features follow the same pattern.

**Delivers:** Transaction lifecycle (tx:pending/submitted/confirmed/error), receipt.status verification, optimistic update + verification-read pattern, status-bar component, purchase-panel component (tickets + lootboxes, ETH + BURNIE modes), pass-card component, tx-status component, badge-diamond component (shared), connect-prompt component, router.js phase-aware visibility

**Addresses:** Ticket/lootbox purchase (table stakes), pass purchase, dynamic price display, game phase indicator, state-driven UI transitions

**Avoids:** Pitfall 3 (false tx confirmation — receipt.status check), Pitfall 5 (API desync — optimistic updates), Pitfall 12 (chain reorg phantom purchases — 2-confirmation option for large purchases)

**Research flag:** Standard patterns. No research-phase needed.

### Phase 3: Hero Features — Jackpot and Degenerette

**Rationale:** The jackpot scratch-off and degenerette spin are the game's two primary engagement mechanics. They are the most complex features (1500 + 800 lines in the monolith). Build after the component pattern is proven.

**Delivers:** jackpot-widget (full scratch-off: canvas, GSAP timeline animation, Web Audio, prize display), degenerette-widget (bet placement, VRF polling with localStorage persistence, spin reveal), hero coinflip display (promoted from sidebar, multiplier visualization), canvas-confetti win celebrations, death-timer component (green/yellow/red staged countdown with pulsing red zone)

**Addresses:** Animated jackpot resolution (differentiator), hero coinflip display (differentiator), death timer urgency (differentiator), scratch-to-reveal (differentiator)

**Avoids:** Pitfall 4 (VRF pending states — localStorage persistence, multi-stage progress), Pitfall 6 (canvas touch offset — getBoundingClientRect/width ratio, test on device), Pitfall 11 (animation setTimeout leaks — GSAP timelines replace setTimeout chains), Pitfall 13 (wrong animation tech — CSS for urgency effects, Canvas only for scratch, rAF for badge shuffle), Pitfall 7 (Web Audio autoplay — user-gesture unlock on first click)

**Research flag:** Likely needs research-phase. The degenerette VRF polling pattern and the GSAP timeline orchestration for the scratch card are non-trivial. Coordinate math for high-DPI canvas touch events has known mobile-specific edge cases.

### Phase 4: Supporting Features

**Rationale:** Quest panel, passes grid, leaderboards, and claims panel are independent of jackpot/degenerette and can be built in any order. These depend on the database API being available and populated.

**Delivers:** quest-panel (streak visualization, shield indicator, progress bars, daily quest cards), passes-grid (afKing tooltip), claims-panel (unified claimable winnings across all sources), claim history with tx links, affiliate code creation, BAF leaderboard (contextual by level), affiliate leaderboard

**Addresses:** Unified claims aggregation (trust-critical), quest streak UI (differentiator), affiliate code creation (unblocks referral flywheel), BAF display (contextual)

**Avoids:** Pitfall 5 (always check on-chain for claimable balance as fallback to stale API data)

**Research flag:** Claims aggregation contract reads need verification against actual contract ABI. The affiliate creation flow (up to 31 char code, contract write) needs exact function signature confirmed. Standard patterns otherwise.

### Phase 5: Decimator UI

**Rationale:** Decimator is new functionality requiring new contract ABI integration not present in beta. Higher complexity; depends on a stable foundation from earlier phases. Terminal decimator is the most complex variant.

**Delivers:** decimator-panel (BURNIE burn submission, bucket display from activity score, burn weight multiplier display, contextual visibility during decimator windows), terminal decimator / death bet interface (GAMEOVER bet, risk/reward calculator, P(GAMEOVER) estimator), GAMEOVER state display

**Addresses:** Decimator UI (differentiator, high complexity), terminal decimator (unique mechanic), GAMEOVER state

**Avoids:** Pitfall 5 (decimator state is on-chain authoritative — always read bucket from contract, not API)

**Research flag:** Needs research-phase. Decimator contract ABI not yet integrated. Terminal decimator ties into GAMEOVER mechanics and deposit insurance accumulator — exact contract interface needs mapping before UI can be specced.

### Phase 6: Polish, Mobile, and Pre-Launch

**Rationale:** Mobile polish and compliance hooks are the last layer before public deployment. These require all features to exist before they can be comprehensively tested.

**Delivers:** MetaMask mobile in-app browser viewport fixes (340px effective width), high-DPI canvas touch verification on physical devices, Web Audio GC pressure reduction (pre-render AudioBuffers via OfflineAudioContext), ethers.js local vendor copy as CDN fallback, geofencing middleware stub, terms-of-service gate, error states and loading skeletons, responsive layout verification at all breakpoints including MetaMask mobile

**Addresses:** Mobile responsiveness (table stakes), provably fair verification (deferred from earlier phases)

**Avoids:** Pitfall 6 (test on actual MetaMask mobile browser), Pitfall 15 (MetaMask viewport), Pitfall 17 (CDN single point of failure — vendor locally), Pitfall 18 (audio GC pressure), Pitfall 19 (compliance surface area)

**Research flag:** Compliance/geofencing hooks are a product/legal decision, not an engineering one. No research-phase for the technical work. Legal requirements need a separate conversation before pre-launch.

### Phase Ordering Rationale

- **Store and modules must come first** because there is no component that doesn't read state, and no component that doesn't import something. Phase 1 is the unblocking constraint.
- **Contracts before hero features** because the purchase panel and degenerette need write transactions. Building interactive UI without testable writes wastes effort.
- **Component pattern proven on simple components first** (status bar, purchase panel) so that the complex features (jackpot, degenerette) follow an established, tested pattern rather than inventing it under pressure.
- **Jackpot and degenerette before supporting features** because they are the two primary engagement mechanics. They have the most complexity, the most pitfall exposure, and the most user impact. They should get maximum attention while the codebase is freshest.
- **Decimator last** because it requires new contract integration and the terminal decimator is the most intellectually complex feature. It must not hold up the rest of the product.
- **Polish is genuinely last** — it requires all features to exist to be tested comprehensively.

### Research Flags

Phases likely needing `/gsd:research-phase` during planning:
- **Phase 3 (Jackpot/Degenerette):** GSAP timeline integration with canvas scratch card, VRF polling pattern with localStorage persistence, high-DPI touch coordinate math for mobile wallet browsers. Multiple non-trivial integration points.
- **Phase 5 (Decimator):** Decimator contract ABI not yet integrated into frontend. Terminal decimator GAMEOVER mechanics need contract interface mapping before UI can be specced. Confirm exact contract function signatures before writing any UI.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** ES modules, import maps, Proxy store, EIP-6963 — all well-documented on MDN, official docs.
- **Phase 2 (Core UI):** Custom Elements, transaction lifecycle, REST polling — textbook patterns. Existing beta provides the contract write patterns; this is a modularization task, not a research task.
- **Phase 4 (Supporting Features):** Quest panel, leaderboards, claims — straightforward API reads plus contract reads for claims. Standard patterns.
- **Phase 6 (Polish):** Known fixes for known problems documented in PITFALLS.md with specific solutions.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Technologies verified against official docs, CDN availability confirmed, versions pinned. GSAP license change confirmed (Webflow acquisition). Rejections have explicit rationale. |
| Features | MEDIUM-HIGH | Table stakes well-established across crypto gambling research. Degenerus-specific differentiators (decimator, terminal decimator) are novel with no direct comparables. Priorities based on trust-before-entertainment reasoning, which is defensible. |
| Architecture | HIGH | Patterns verified against MDN, existing codebase analyzed in full (4600 lines). Store pattern, Custom Elements, import maps — all established vanilla JS patterns with documented browser support. |
| Pitfalls | HIGH | Most pitfalls identified from actual bugs in the existing codebase (receipt.status not checked, 300ms wallet detection delay, setInterval polling). Concrete line number citations. Not speculative. |

**Overall confidence:** HIGH

### Gaps to Address

- **Decimator contract ABI:** The decimator interface is not in the beta ABI. Before Phase 5 can be planned in detail, the exact function signatures for `burnForDecimator`, bucket calculation, and terminal bet entry need to be confirmed against the audit repo contracts.
- **Database API endpoint completeness:** ARCHITECTURE.md references Fastify API routes (game, player, history, leaderboards, tokens, health) but the exact response schemas for several endpoints (affiliate stats, BAF rankings, claim history) are not fully documented. These need confirmation before Phase 4 UI can be specced.
- **VRF callback timing on Sepolia vs mainnet:** Research notes 12-36s mainnet, "minutes" on Sepolia. The multi-stage progress UX needs timeout thresholds confirmed against actual observed behavior to avoid showing alarming messages too early or too late.
- **Compliance requirements:** Pitfall 19 notes this is a product/legal decision, not an engineering one. The compliance hooks (geofencing middleware, TOS gate) can be built architecturally, but the actual legal requirements need a decision before pre-launch.

## Sources

### Primary (HIGH confidence)

- Existing codebase: `beta/index.html` (4607 lines), `beta/mint.js` (~900 lines), `shared/nav.js` (513 lines) — analyzed in full
- [GSAP Installation Docs](https://gsap.com/docs/v3/Installation/) — v3.14.x, CDN/ESM, free license
- [canvas-confetti GitHub](https://github.com/catdad/canvas-confetti) — v1.9.4, size, API
- [Import Maps (Can I Use)](https://caniuse.com/import-maps) — 93% browser support
- [MDN: JavaScript Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) — ES module CORS, MIME requirements
- [MDN: Import Maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) — spec, constraints
- [web.dev: Import Maps Cross-Browser](https://web.dev/blog/import-maps-in-all-modern-browsers) — baseline March 2023
- [Chainlink VRF Documentation](https://docs.chain.link/vrf) — pending lifecycle, 24h timeout
- Database API: `database/src/api/routes/` (6 route files verified)

### Secondary (MEDIUM confidence)

- [ChainPlay: Crypto Gambling UX](https://chainplay.gg/blog/crypto-gambling-in-2025-ux-is-the-whole-game/) — table stakes feature expectations
- [Plain Vanilla Web: Components](https://plainvanillaweb.com/pages/components.html) — Custom Elements without Shadow DOM
- [Motion Magazine: Web Animation Performance](https://motion.dev/blog/web-animation-performance-tier-list) — animation technology benchmarks
- [Chrome DevBlog: Web Audio Autoplay](https://developer.chrome.com/blog/web-audio-autoplay) — user gesture requirement
- [web.dev: High DPI Canvas](https://web.dev/articles/canvas-hidipi) — devicePixelRatio coordinate systems
- [Ably: WebSocket vs REST](https://ably.com/topic/websocket-vs-rest) — polling trade-offs

### Tertiary (LOW confidence)

- [Block3 Finance: Legal Challenges Crypto Betting 2025](https://www.block3finance.com/the-legal-challenges-facing-crypto-betting-in-2025) — regulatory landscape (jurisdiction-specific, fast-changing)

---
*Research completed: 2026-03-18*
*Ready for roadmap: yes*
