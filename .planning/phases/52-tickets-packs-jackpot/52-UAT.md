# Phase 52 -- UAT Record

**Status:** DEFERRED
**Date:** 2026-04-24
**Reason:** Browser UAT requires a real device (mobile Safari for touch-tap detection, desktop browser for hover and focus paths), GSAP timing observation with a human eye, sound autoplay-policy verification across the first user gesture, and visual inspection of trait SVG rendering across all four quadrants (including CARD_IDX reshuffle correctness on the cards quadrant). None of this is possible in this autonomous session. Following Phase 50 and Phase 51 precedent: both phases deferred their Wave 3 UAT with the same rationale. Phase 50's deferral still stands and held through Phase 51 development; Phase 51 followed suit and closed on automated coverage plus the deferral note. Phase 52 UAT will surface naturally when Phase 53 (Purchase Flow) lands, or when the developer performs the next manual browser session against the live stack. Automated suite is 197/197 green across all nine play/ test files (up from 112/112 at Phase 51 end), which validates the code contract end-to-end; UAT covers the visual, device, and audio contract separately.

## Deferred Scenarios

All nine scenarios from 52-VALIDATION.md Manual-Only Verifications table are deferred:

1. Gacha reveal feel -- pack shake, flash, snap-open, trait bounce totalling approximately 400ms (PACKS-05 / D-07)
   - Tests the GSAP timeline renders the four animation phases cleanly on desktop, and the `prefers-reduced-motion` fallback swaps instantly without motion.
   - Why manual: animation timing and feel cannot be grep-asserted. Requires a human eye on the full timeline plus a CSS media-query emulation toggle in DevTools.

2. Sound plays on first pack-open click and mute persists across reload (PACKS-05 / D-10)
   - Tests the AudioContext unlocks on the first user gesture, the speaker-icon mute toggle flips aria-pressed correctly, subsequent clicks go silent after mute, and the mute state persists in localStorage across page reload.
   - Why manual: browser autoplay policy is enforced on real user gestures, not programmatic ones. JSDOM has no audio stack. Requires a real browser session plus a reload cycle.

3. Jackpot widget renders Roll 1 and Roll 2 on a known winning (player, day) tuple (JACKPOT-01 / JACKPOT-02 / JACKPOT-03)
   - Tests the `<jackpot-panel-wrapper>` inner `<jackpot-panel>` renders the Day N/5 label, Roll 1 spinning-flame trait reveal fires on Replay click, Roll 2 slot-grid populates on Bonus Roll click, and cards-quadrant SVGs match the CARD_IDX reshuffle.
   - Why manual: needs the live Fastify backend with an indexed winning day plus a human confirming the visual match against expected trait labels.

4. Trait SVG correctness for all four quadrants, including cards quadrant CARD_IDX sanity (TICKETS-02)
   - Tests that crypto, zodiac, dice quadrants render 1:1 (symbolIdx == fileIdx) and the cards quadrant correctly reshuffles via CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7] so for example symbolIdx 0 (club) maps to fileIdx 3 and the SVG path resolves to cards_03_club_*.svg.
   - Why manual: visual fidelity requires loading every SVG against the live API response and confirming no broken-img icons plus correct hover/focus title text.

5. Day-scrub during active pack animation (PACKS-05 / D-08)
   - Tests that scrubbing the day within 400ms of a pack click lets the current GSAP animation complete to onComplete on the stale element, while the new day's card list re-renders in place.
   - Why manual: timing edge case between the GSAP timeline and the store subscribe callback requires a human triggering the race condition in a real browser.

6. Empty states render cleanly at 0 tickets per level and 0 packs waiting to open (TICKETS-01..04, PACKS-01..04)
   - Tests `<tickets-panel>` shows "No tickets at this level." empty state and `<packs-panel>` shows "No packs waiting to open." empty state with no console errors.
   - Why manual: UX polish verification requires human inspection of the rendered empty-state templates against the theme.

7. 404 on INTEG-01 for an un-indexed day (TICKETS-01..04, PACKS-01..04)
   - Tests the panels degrade gracefully when the database returns 404 day_not_found, releasing the is-stale keep-old-data-dim class without a stuck dim overlay and without an uncaught promise rejection in console.
   - Why manual: error-path UX plus the absence of an uncaught rejection both require a live browser console session.

8. Rapid day-scrub stability (TICKETS / PACKS)
   - Tests scrubbing 10+ days within 2 seconds keeps the stale-response guard firing so the latest day's data always wins in the DOM, no visual thrash, and the shared tickets-fetch.js helper dedups in-flight requests at the promise layer.
   - Why manual: requires a human operating the scrubber at interactive speeds plus DevTools Network panel inspection.

9. High-ticket player perf -- 100+ entries (25+ cards) scrolls smoothly (TICKETS-01)
   - Tests that a player with many tickets at a single level renders 25+ cards with smooth scroll, and `loading="lazy"` on trait-badge imgs defers off-viewport SVG loads.
   - Why manual: scroll-smoothness perception requires a human driving the scroll wheel plus observing the Network waterfall.

## Deferral Precedent

Phase 50 deferred its UAT at phase close. See:

- `.planning/phases/50-route-foundation-day-aware-store/50-03-SUMMARY.md` frontmatter: `uat_status: deferred`, `uat_note: "User deferred browser UAT at phase close; automated verification (88/88 tests green + SHELL-01 + headless HTML structure check) sufficient for Phase 50 close. Visual issues will surface naturally when Phase 51 lands the first real panel hydration."`
- `.planning/ROADMAP.md` Phase 50 note records the deferral alongside the 88/88 automated test pass.

Phase 51 deferred its UAT at phase close. See:

- `.planning/phases/51-profile-quests/51-UAT.md` DEFERRED status: cited Phase 50 precedent and identified Phase 52 as the natural resurfacing trigger. That trigger fired during Phase 52 execution -- the developer interacted with the live `/play/` route via automated harness, but the human-in-the-loop browser pass was not scheduled because Phase 52 Wave 2 landed in autonomous execution. No Phase 51 visual regressions surfaced during Phase 52 development; profile-panel's 24/24 automated assertions caught the code-contract concerns that were fixable without a browser.

The Phase 50 deferral held through Phase 51 closing, and Phase 51's deferral held through Phase 52 closing. Both deferrals are still standing and carry forward to this Phase 52 record. Phase 52 follows the same pattern.

## Follow-up Plan

Browser UAT will surface naturally when Phase 53 (Purchase Flow) lands. The purchase flow is the first real-user path that exercises the pack-appearance loop end-to-end:

1. User purchases tickets (whatever form the Phase 53 purchase-panel takes -- sim API, testnet wallet, or live-contract call).
2. New pack appears in the packs-panel on the next INTEG-01 refetch.
3. User clicks the pack to open it, triggering the GSAP timeline (Scenario 1).
4. First click of the session unlocks audio (Scenario 2).
5. If any Phase 52 visual defect survives -- pack animation looks wrong, sound misbehaves, trait SVG in cards quadrant is wrong, empty state looks broken -- it will be immediately obvious at that moment.
6. Gap-closure plan (`/gsd-plan-phase 52 --gaps`) can address any surfaced regression without re-opening full Phase 52 planning.

Alternatively, the user may perform a manual browser session against the live stack at any time between Phase 52 close and Phase 53 start. That session would naturally exercise the same nine scenarios, and the outcome would close the UAT gap for Phase 52 directly without waiting for the Phase 53 purchase path.

Deliberately not blocking Phase 52 completion on a manual browser pass matches the Phase 50 and Phase 51 decisions and keeps the /play/ route moving toward feature-parity faster. The automated suite catches the code-contract regressions an executor can fix without a browser; the browser pass catches the visual, device, and audio-contract regressions that need a human observer.

## Automated Verification State

Automated test suite as of 2026-04-24 after Phase 52 Wave 2 completion: 197/197 green across all nine play/app/__tests__/ files.

| Test file | Tests | Status |
|-----------|------:|--------|
| play/app/__tests__/play-route-structure.test.js | 9 | pass |
| play/app/__tests__/play-main-bootstrap.test.js | 7 | pass |
| play/app/__tests__/play-shell-01.test.js | 2 | pass (SHELL-01 recursive guardrail green; no wallet-tainted imports in play/ tree) |
| play/app/__tests__/play-panel-stubs.test.js | 70 | pass (Phase 50 skeleton-shimmer contract held) |
| play/app/__tests__/play-profile-panel.test.js | 24 | pass (Phase 51 PROFILE-01..05 contract held) |
| play/app/__tests__/play-tickets-panel.test.js | (subset of new 85) | pass (TICKETS-01..04 contract, #ticketsFetchId stale-guard, is-stale keep-old-data-dim, CARD_IDX reshuffle assertion) |
| play/app/__tests__/play-packs-panel.test.js | (subset of new 85) | pass (PACKS-01..05 contract, GSAP timeline import, pack-audio mute persistence, cleanup on removal) |
| play/app/__tests__/play-jackpot-wrapper.test.js | (subset of new 85) | pass (JACKPOT-01..03 contract, beta inner-panel import, replay to game shim) |
| play/app/__tests__/play-jackpot-shell01-regression.test.js | (subset of new 85) | pass (D-09 patch held: beta/components/jackpot-panel.js imports ../viewer/utils.js, not ../app/utils.js) |
| **Total** | **197** | **pass** |

This covers the code contract for every Phase 52 requirement:

- TICKETS-01..04: card grid render, 2x2 CSS grid with near-full-quadrant trait SVGs, cardIndex grouping including partial trailing card, pending-status placeholder.
- PACKS-01..05: purchase-source pack, jackpot-win gold-tint source, sealed pack click handler, lootbox auto-trigger, GSAP timeline import and pack-audio mute persistence.
- JACKPOT-01..03: direct beta inner-panel import, rendering of inner `<jackpot-panel>`, replay.day + replay.level subscribes that shim to game.* via update() calls.
- INTEG-01 live end-to-end: database endpoint shipped (3 atomic commits on database repo; 10/10 vitest green), play panels subscribe and refetch on (player, level, day) change, main.js updateLevelForDay helper populates state.replay.level with /game/jackpot/day/N/winners plus Math.ceil(day/5) arithmetic fallback.

UAT would cover the visual, device, and audio contract: GSAP animation feel, browser autoplay unlock semantics, mute persistence across a real reload cycle, trait SVG rendering against representative INTEG-01 payloads, day-scrub interleave with in-flight GSAP timelines, empty-state styling under the theme, 404 error-path UX, rapid-scrub visual smoothness, and high-ticket scroll performance.

## Phase 52 Close Readiness

Phase 52 is ready for `/gsd-verify-phase 52` with this 52-UAT.md as the concrete artifact documenting the deferral decision. The phase can be marked complete; the UAT gap is documented, rationalized, and carries a concrete resurfacing trigger (Phase 53 Purchase Flow end-to-end integration, or an ad-hoc manual browser session) rather than disappearing into a "we'll get to it" backlog.

Resume signal recorded: `uat-deferred`.
