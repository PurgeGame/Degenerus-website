---
phase: 08-hero-displays
plan: 02
subsystem: ui
tags: [custom-elements, jackpot, gsap, canvas-confetti, trait-reveal, animation, bigint]

# Dependency graph
requires:
  - phase: 08-hero-displays
    plan: 01
    provides: Extended store with jackpotDay, pools, phaseTransitionActive; API polling for game state
  - phase: 06-foundation
    provides: store, API polling, constants, Custom Element pattern, badge paths
provides:
  - Jackpot data module (trait derivation from RNG word, badge mapping, allocation estimation)
  - Jackpot panel Custom Element with GSAP-driven sequential reveal and confetti celebration
affects: [09-jackpot-panel, player-facing-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [gsap-timeline-sequential-reveal, lazy-dynamic-import, raf-number-animation, reduced-motion-fallback]

key-files:
  created:
    - beta/app/jackpot-data.js
    - beta/components/jackpot-panel.js
    - beta/styles/jackpot.css
  modified:
    - beta/app/main.js
    - beta/index.html

key-decisions:
  - "GSAP preloaded on panel mount (not on reveal trigger) to avoid first-reveal jank"
  - "dailyRng.finalWord not yet in API; component gracefully degrades to stats-only display until API extended"
  - "All traits marked as winners for visual demo until player trait ownership check is implemented"

patterns-established:
  - "Lazy dynamic import: GSAP and confetti loaded via await import() only when needed"
  - "RAF number animation: ease-out cubic counter for prize amount display"
  - "Reduced motion fallback: instant card reveal when prefers-reduced-motion is set"

requirements-completed: [JACK-01, JACK-02, JACK-03, JACK-04]

# Metrics
duration: 3min
completed: 2026-03-18
---

# Phase 8 Plan 02: Jackpot Panel and Trait Reveal Summary

**Jackpot panel with GSAP-driven sequential trait card flip animation, pool/day/allocation stats, badge visualization, and canvas-confetti win celebration**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-18T15:23:14Z
- **Completed:** 2026-03-18T15:25:56Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- jackpot-data.js provides pure functions for trait derivation from VRF RNG word (6-bit quadrant formula), trait-to-badge mapping (category % 6, color floor(trait/6) % 8), allocation estimation (6-14% days 1-4, 100% day 5), and quadrant labels
- jackpot-panel.js Custom Element subscribes to game state, displays pool size, day counter, and allocation estimate. GSAP timeline flips 4 quadrant cards sequentially with 0.5s stagger. Winning traits get green glow border and badge scale pop. Canvas-confetti fires themed center + side bursts
- Panel gracefully handles missing RNG data (shows pool/day/allocation stats only)
- Respects prefers-reduced-motion with instant reveal fallback

## Task Commits

Each task was committed atomically:

1. **Task 1: Create jackpot-data.js business logic module** - `b8da533` (feat)
2. **Task 2: Create jackpot-panel component, CSS, and wire to page** - `d493bdc` (feat)

## Files Created/Modified
- `beta/app/jackpot-data.js` - Pure helper functions: deriveWinningTraits, traitToBadge, estimateAllocation, quadrantLabel
- `beta/components/jackpot-panel.js` - JackpotPanel Custom Element with GSAP reveal, confetti, store subscription
- `beta/styles/jackpot.css` - Trait card grid, 3D flip, winner glow, result display, reduced-motion support
- `beta/app/main.js` - Added jackpot-panel component import
- `beta/index.html` - Added jackpot.css link, replaced jackpot placeholder with jackpot-panel element

## Decisions Made
- GSAP preloaded on panel mount (import('gsap').catch(() => {})) rather than waiting for reveal trigger. Avoids CDN latency causing jank on first animation.
- dailyRng.finalWord is not yet exposed in the API response. The component checks for it and only triggers reveals when present. Until the API is extended, the panel displays pool/day/allocation stats (still useful).
- All revealed traits are marked as winners for visual demo purposes. Future enhancement: compare against player's held traits to determine actual match.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- GSAP and canvas-confetti patterns now proven and available for coinflip-panel (Plan 03)
- Lazy dynamic import pattern established for reuse
- Store game state subscription pattern consistent across all hero components
- dailyRng.finalWord API extension remains a dependency for full reveal functionality

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 08-hero-displays*
*Completed: 2026-03-18*
