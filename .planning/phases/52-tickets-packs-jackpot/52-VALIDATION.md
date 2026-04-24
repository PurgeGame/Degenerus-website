---
phase: 52
slug: tickets-packs-jackpot
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 52 -- Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Built from 52-RESEARCH.md Section "Validation Architecture (Nyquist)" (lines 813-1008).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (no JSDOM, no build) |
| **Config file** | none -- runs directly via `node --test` |
| **Quick run command** | `node --test play/app/__tests__/play-tickets-panel.test.js play/app/__tests__/play-packs-panel.test.js play/app/__tests__/play-jackpot-wrapper.test.js play/app/__tests__/play-jackpot-shell01-regression.test.js` |
| **Full suite command** | `node --test play/app/__tests__/*.test.js` |
| **Estimated runtime** | ~3-5 seconds |

Tests are **contract-grep style**: source-file regex assertions against the Custom Element modules. No runtime rendering. Pattern verified by Phase 50-51 test files (112/112 green at Phase 51 end).

---

## Sampling Rate

- **After every task commit:** `node --test play/app/__tests__/play-{tickets,packs,jackpot-wrapper,jackpot-shell01-regression}.test.js` (or the file the task modified)
- **After every plan wave:** `node --test play/app/__tests__/*.test.js` (full /play/ suite)
- **Before `/gsd-verify-work`:** Full suite + `play-shell-01.test.js` must be green AND INTEG-01 endpoint live
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | Wave |
|--------|----------|-----------|-------------------|------|
| TICKETS-01 | `<tickets-panel>` renders card grid from INTEG-01 response | contract-grep | `node --test play/app/__tests__/play-tickets-panel.test.js` | 0 authors / 1 greens / 2 hydrates |
| TICKETS-02 | Cards use 2x2 CSS grid with 4 trait SVG imgs sized near-full-quadrant | contract-grep | same | 0/1/2 |
| TICKETS-03 | Cards group by `cardIndex = entryId/4`; partial trailing card renders | contract-grep | same | 0/1/2 |
| TICKETS-04 | Pending-status cards render pack placeholder, not empty cards | contract-grep | same | 0/1/2 |
| PACKS-01 | `<packs-panel>` renders animated pack on purchase-source | contract-grep | `node --test play/app/__tests__/play-packs-panel.test.js` | 0/1/2 |
| PACKS-02 | Jackpot-win-source packs render with gold-tint variant | contract-grep | same | 0/1/2 |
| PACKS-03 | Pending packs have `pack-sealed` class + click handler | contract-grep | same | 0/1/2 |
| PACKS-04 | Lootbox-source packs auto-trigger timeline on first render (no click needed) | contract-grep | same | 0/1/2 |
| PACKS-05 | GSAP timeline imported; audio wrapper module exists; mute persisted | contract-grep | same | 0/1 |
| JACKPOT-01 | `<jackpot-panel-wrapper>` imports `beta/components/jackpot-panel.js` | contract-grep | `node --test play/app/__tests__/play-jackpot-wrapper.test.js` | 0/1 |
| JACKPOT-02 | Wrapper renders `<jackpot-panel>` inside its innerHTML | contract-grep | same | 0/1 |
| JACKPOT-03 | Wrapper subscribes to `replay.day` AND `replay.level`, shims to `game.*` | contract-grep | same | 0/1 |
| SHELL-01 (cross-play) | No new play/ files import forbidden paths | recursive grep (existing) | `node --test play/app/__tests__/play-shell-01.test.js` | every wave |
| SHELL-01 beta-regression | `beta/components/jackpot-panel.js` does NOT import `'../app/utils.js'` post-D-09 patch | contract-grep | `node --test play/app/__tests__/play-jackpot-shell01-regression.test.js` | 0 |

---

## Test Files to Author in Wave 0

### 1. `play/app/__tests__/play-tickets-panel.test.js` (~30-40 assertions)

Mirrors `play-profile-panel.test.js` shape. Covers existence, registration, store subscribes (`replay.day`, `replay.player`, `replay.level`), fetch URL template, stale-guard (`#ticketsFetchId`), keep-old-data-dim (`is-stale`), and TICKETS-01..04 contracts (card grid class, 2x2 quadrant structure, cardIndex grouping, pending placeholder).

Includes `play/app/tickets-inventory.js` helper assertions: exports `traitToBadge`, wallet-free (no `beta/app/utils.js` import), contains `CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7]` reshuffle.

### 2. `play/app/__tests__/play-packs-panel.test.js` (~30-40 assertions)

Covers existence, registration, GSAP import, PACKS-01..05 contracts (purchase/jackpot-win/lootbox source handling, click handler, audio/animator module imports), mute toggle + localStorage persistence, and `pack-open.mp3` asset reference.

Includes `play/app/pack-animator.js` assertions: GSAP timeline exported, handles `prefers-reduced-motion`, cleanup on element removal.

### 3. `play/app/__tests__/play-jackpot-wrapper.test.js` (~15-20 assertions)

Covers `<jackpot-panel-wrapper>` Custom Element: direct import of `beta/components/jackpot-panel.js`, inner `<jackpot-panel>` rendering, `replay.day` + `replay.level` subscribes, `game.*` shim via `update()` calls, CSS link to `beta/styles/jackpot.css` in play/index.html.

### 4. `play/app/__tests__/play-jackpot-shell01-regression.test.js` (~3 assertions)

Wave 0 guard against D-09 patch regression:
- `beta/components/jackpot-panel.js` does NOT import `'../app/utils.js'`
- `beta/components/jackpot-panel.js` DOES import `'../viewer/utils.js'`
- Import count is within expected range (5-7 top-level imports; sanity on overall structure)

---

## Manual-Only Verifications (Wave 3, UAT-Deferrable)

| Behavior | Requirement | Why Manual | Instructions |
|----------|-------------|------------|--------------|
| Gacha reveal feel -- pack shakes, flashes, pops open, traits bounce in | PACKS-05 / D-07 | Visual timing + feel; not grep-assertable | Load /play/, select player with purchase-source tickets, click sealed pack. Verify ~400ms total; shake visible; flash visible; staggered trait bounce. Check `prefers-reduced-motion` instant-swap. |
| Sound plays on first click (autoplay unlock) + mute persists | PACKS-05 / D-10 | Browser autoplay policy; localStorage | Reload /play/. First pack click: sound fires. Toggle mute. Next click: silent. Refresh: mute state persists. Toggle back: sound on next click. |
| Jackpot widget renders Roll 1 + Roll 2 on a known winning day | JACKPOT-01 / JACKPOT-02 | Needs live backend with indexed winning day | Select known winning player. Scrub to known winning day. Click Replay in jackpot panel. Verify Roll 1 populates; click Bonus Roll; Roll 2 grid populates. All SVGs render (check `cards` quadrant for CARD_IDX correctness). |
| Trait SVG correctness for all 4 quadrants | TICKETS-02 | Visual fidelity; CARD_IDX alignment | Select player with traits in all 4 quadrants. Verify every SVG renders (no broken img). `cards` quadrant items (club/diamond/heart/spade = symbolIdx 0-3) must map to fileIdx 3-6 via CARD_IDX reshuffle. |
| Day-scrub during active pack animation | PACKS-05 / D-08 | Timing edge case | Click pack to start animation. Within 400ms, scrub to different day. Current animation completes on stale card with no console error. New day's cards appear. |
| Empty state -- 0 tickets at selected level | TICKETS-01..04 | UX polish | Select player+level with 0 tickets. `<tickets-panel>` shows empty state. `<packs-panel>` shows empty state. |
| 404 on INTEG-01 (day not indexed) | TICKETS-01..04 | Error path | Scrub to un-indexed day. Panels degrade gracefully (dim overlay + error); no uncaught rejection. |
| Rapid day-scrub stability | TICKETS / PACKS | Visual polish | Scrub 10+ days in 2s. Latest data always wins. Dim overlay smooth; no thrash. |
| High-ticket player (100+ entries = 25+ cards) scrolls OK | TICKETS-01 | Perf | Select high-ticket player. 25+ cards render; smooth scroll; no jank loading 100+ SVGs. |

**UAT deferral precedent:** Phase 50 and Phase 51 both deferred Wave 3 UAT (51-UAT.md records rationale). Phase 52 Wave 3 is similarly deferrable -- automated verification + Wave 2 acceptance-criteria grep is sufficient to close the phase if the user opts to defer.

---

## Wave 0 Gaps (to be closed by Wave 0 plan)

- [ ] `play/app/__tests__/play-tickets-panel.test.js` -- authored
- [ ] `play/app/__tests__/play-packs-panel.test.js` -- authored
- [ ] `play/app/__tests__/play-jackpot-wrapper.test.js` -- authored
- [ ] `play/app/__tests__/play-jackpot-shell01-regression.test.js` -- authored
- [ ] `beta/components/jackpot-panel.js:7` -- 1-line import patch (swap `'../app/utils.js'` -> `'../viewer/utils.js'`)
- [ ] `.planning/phases/52-tickets-packs-jackpot/INTEG-01-SPEC.md` -- copy-forward from Phase 50 dir (Q2 resolution: copy-forward; precedent from Phase 51 which authored INTEG-02-SPEC.md in-phase)
- [ ] REQUIREMENTS.md updates if any scope deltas surface from CONTEXT.md vs ROADMAP (none expected)

**Note:** Existing `play-shell-01.test.js` already provides recursive SHELL-01 coverage for new play/ files -- no new wallet-free-guard test needed per new play/ module.

---

## Phase Gate (Before `/gsd-verify-work`)

- `node --test play/app/__tests__/*.test.js` green (all new + existing)
- `play-shell-01.test.js` green (recursive wallet-free scan)
- `play-jackpot-shell01-regression.test.js` green (D-09 patch held)
- INTEG-01 endpoint live in `/home/zak/Dev/PurgeGame/database/` (3 atomic commits expected: feat + docs + test, matching INTEG-02 precedent)
- Database-side vitest green (no regressions from INTEG-01 implementation)
- Optional: Wave 3 UAT completed OR formally deferred in 52-UAT.md

---

*Phase 52 validation strategy; built from 52-RESEARCH.md Section "Validation Architecture (Nyquist)" lines 813-1008. Sign-off pending Wave 0 completion.*
