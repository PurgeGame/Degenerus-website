---
phase: 50
plan: 02
subsystem: route-scaffold
tags:
  - phase-50
  - wave-1
  - scaffold
  - game-ui
  - shell-01
status: complete
completed: 2026-04-23
requires:
  - 50-01
provides:
  - play/index.html
  - play/styles/play.css
  - play/app/main.js
  - play/app/api.js
  - play/app/constants.js
  - shared/player-archetypes.json
  - beta/app/store.js::replay.player
affects:
  - Plan 50-03 (custom elements) -- will consume the scaffolded shell and attach panel stubs
  - Phase 51+ -- every day-aware panel now has a stable replay.player + replay.day contract
tech-stack:
  added: []
  patterns:
    - wallet-free route shell (ethers omitted from importmap; SHELL-01 guardrail)
    - dynamic component registration so main.js parses before Plan 03 ships custom elements
    - createScrubber factory wired to update('replay.day', day)
    - initial signal fire after setRange/setDay (RESEARCH Pitfall 3)
key-files:
  created:
    - play/index.html
    - play/styles/play.css
    - play/app/main.js
    - play/app/api.js
    - play/app/constants.js
    - shared/player-archetypes.json
  modified:
    - beta/app/store.js (added replay.player: null to initial state)
requirements:
  - ROUTE-01
  - ROUTE-03
  - ROUTE-04
  - DAY-02
  - DAY-03
  - DAY-04
decisions:
  - Kept beta/viewer/player-archetypes.json in place (copy-not-move) so beta/viewer/player-selector.js stays working unchanged; Plan 50-03 points the new play/ selector at /shared/.
  - Replaced the inline fallback `host.innerHTML = ...` in main.js with `host.textContent = ...` to keep the file free of innerHTML and preserve the T-50-01 defense-in-depth posture (static HTML only in the route shell).
  - Used dynamic imports for all play/components/*.js in main.js so the route boots even before Plan 03 delivers component files (tolerant bootstrap; graceful skeleton-only fallback on 404).
metrics:
  duration_minutes: 8
  tasks_completed: 3_of_3
  files_created: 6
  files_modified: 1
  commits: 3
---

# Phase 50 Plan 02: Route Scaffold & Day-Aware Store Summary

Wallet-free route scaffold at /play/ with ethers-free importmap, skeleton-first layout, and store-wired scrubber/player-selector boot sequence. Extends beta/app/store.js with replay.player for initial-state symmetry.

## What Was Built

### Task 1 - play/index.html + play/styles/play.css (commit cfba32d)

**play/index.html** (80 lines):
- Static shell with pinned importmap (gsap@3.14, canvas-confetti@1.9). No ethers entry, no @latest.
- Nav bar initialised via shared/nav.js with `currentPage: 'play'` plus six other pages in the table.
- Page header with flame logo + "DEGENERUS PLAY" title + subtitle.
- Controls panel containing `<player-selector>` and a `<day-scrubber>` wrapped in a `<div class="dev-tool play-dev-scrubber">` per DAY-04.
- Skeleton-shimmer placeholder inside the scrubber slot (visible until createScrubber swaps in the real DOM).
- Panel grid with all seven `<*-panel data-slot="…">` custom elements (profile, tickets, purchase, coinflip, baf, decimator, jackpot).
- Footer + module script tag `<script type="module" src="/play/app/main.js">`.
- Zero occurrences of `innerHTML` (T-50-01 defense).

**play/styles/play.css** (70 lines):
- `.play-controls` flex column with player-selector block width.
- `.dev-tool` dashed border, translucent background, tiny uppercase label (`.dev-tool__label`). Makes the scrubber visually secondary.
- `.play-grid` auto-fit grid at 340px min, single column below 720px.
- Footer spacing adjustments (border-top, muted color).

### Task 2 - play/app/{constants,api,main}.js (commit d43c465)

**play/app/constants.js** (12 lines): re-exports `API_BASE`, `BADGE_CATEGORIES`, `BADGE_QUADRANTS`, `BADGE_COLORS`, `BADGE_ITEMS`, `badgePath`, `badgeCircularPath` from `../../beta/app/constants.js`. Narrowed surface: ABIs and contract addresses are not re-exported even though they are strings, because the play/ route has no use for them and omitting them makes intent clearer.

**play/app/api.js** (10 lines): mirrors `beta/viewer/api.js` verbatim. Imports only `API_BASE`; exports `async function fetchJSON(path)` that throws on non-OK.

**play/app/main.js** (~110 lines):
- Imports `update`, `subscribe`, `get` from `../../beta/app/store.js` and `fetchJSON` from `./api.js`. No other static imports.
- `registerComponents()` loops over nine component paths and dynamically imports each in a try/catch so missing Plan-03 files warn but do not break boot.
- `boot()` sequence:
  1. Register components
  2. `await fetchJSON('/replay/rng')`, filter `days` where `finalWord !== '0'`, project to day numbers, sort ascending
  3. Dynamically import player-selector; query `<player-selector>` host for its `<select>`; call `initPlayerSelector(selectEl, addr => update('replay.player', addr))`
  4. Dynamically import `createScrubber` from `../../beta/viewer/scrubber.js`; inject into `<day-scrubber>` host with `onDayChange: day => update('replay.day', day)`; call `setRange/setDay`; manually fire `update('replay.day', initialDay)` (Pitfall 3 guard)
  5. Log subscriptions for `replay.day` + `replay.player` for dev visibility
- All error paths warn to console; no uncaught rejections.
- Zero forbidden imports (no ethers, no wallet.js, no contracts.js, no beta/app/utils.js, no beta/app/api.js, no beta/components/{connect-prompt,purchase,coinflip,decimator}-panel.js).

### Task 3 - shared/player-archetypes.json + beta/app/store.js (commit f94be59)

**shared/player-archetypes.json** (102 lines): byte-identical copy of `beta/viewer/player-archetypes.json`. Both files now coexist; Plan 50-03 fetches from `/shared/`, beta/viewer/player-selector.js keeps fetching from `/beta/viewer/`. Unification can happen in a future phase.

**beta/app/store.js**: added `player: null` line and a Phase 50 comment inside the `replay:` initial-state block. `get('replay.player')` now returns `null` on first boot (previously `undefined` because existing writes via `replay-panel.js` happened before the key was declared).

## Test State Transition

Running `node --test play/app/__tests__/*.test.js` before Plan 02: 88 subtests total; 2 passed (SHELL-01 skip path); 86 failed (ENOENT fixtures).

Running the same command after Plan 02:

| Test file | Before | After | Delta |
|-----------|-------:|------:|------:|
| play-route-structure.test.js | 0/9 | **9/9 green** | +9 |
| play-main-bootstrap.test.js | 0/7 | **7/7 green** | +7 |
| play-shell-01.test.js | 2/2 (skip path) | **2/2 green** (full scan, 7 files, 0 violations) | stays green, mode change |
| play-panel-stubs.test.js | 0/70 | 0/70 (red, as expected) | unchanged -- Plan 03 closes |
| **Total** | **2/88** | **18/88** | **+16 flipped red->green** |

Beta tests (`node --test beta/app/__tests__/*.test.js`): 31/31 still pass; no regressions from the store.js edit.

## Deviations from Plan

None - plan executed exactly as written. No Rule 1 bugs, no Rule 2 missing functionality, no Rule 3 blockers, no Rule 4 architectural changes.

Two small discretionary calls worth flagging (not deviations, both within plan guidance):

1. The plan's example `main.js` used `host.innerHTML = '<p class="text-dim">No days ...</p>'` in the fallback path. I replaced this with `host.textContent = 'No days with resolved RNG available.'` to satisfy the `grep -c innerHTML play/index.html returns 0` spirit (T-50-01 defense in depth). main.js is a module, not index.html, so the literal acceptance criterion was not violated, but keeping innerHTML out of the route shell end-to-end is strictly better. Functionally identical (plain text, no markup needed).

2. Added a `.play-dev-scrubber > day-scrubber { display: block; }` rule to play.css beyond the plan's example, so the custom-element host lays out as a block before upgrade (prevents a sliver of zero-height host before Plan 03 ships `day-scrubber.js`). Tiny cosmetic; keeps the dashed dev-tool border visible at boot.

## Verification Commands

```bash
# Task 1 acceptance
test -f play/index.html && echo OK
test -f play/styles/play.css && echo OK
node --test play/app/__tests__/play-route-structure.test.js   # 9/9 pass

# Task 2 acceptance
node --check play/app/api.js play/app/constants.js play/app/main.js  # all OK
node --test play/app/__tests__/play-main-bootstrap.test.js    # 7/7 pass
node --test play/app/__tests__/play-shell-01.test.js          # 2/2 pass

# Task 3 acceptance
diff -q shared/player-archetypes.json beta/viewer/player-archetypes.json   # silent
grep -c 'player: null' beta/app/store.js   # 1
node --check beta/app/store.js && echo OK
node --test beta/app/__tests__/*.test.js   # 31/31 pass

# Summary: total flip
node --test play/app/__tests__/*.test.js 2>&1 | grep -E '^# (pass|fail|tests)'
# tests 88 / pass 18 / fail 70 (panel-stubs red; Plan 03 closes)
```

## Commits

| Hash    | Message                                                                    | Files                                              |
|---------|----------------------------------------------------------------------------|----------------------------------------------------|
| cfba32d | `feat(50-02): scaffold play/ route HTML and layout styles`                 | play/index.html, play/styles/play.css              |
| d43c465 | `feat(50-02): bootstrap play/ route with wallet-free API + store wiring`   | play/app/api.js, play/app/constants.js, play/app/main.js |
| f94be59 | `refactor(50-02): extend replay state with player + move archetypes to /shared/` | beta/app/store.js, shared/player-archetypes.json   |

## Known Stubs

None. Every file created in this plan is fully functional for its scope:
- play/index.html renders a complete shell with nav, header, controls, grid, footer
- play/app/main.js fully boots (fetches /replay/rng, wires scrubber + selector) when all referenced modules exist; degrades gracefully (skeleton-only view + console warnings) when Plan 03's components are missing
- play/app/api.js and constants.js are complete for their tiny surface
- shared/player-archetypes.json is a full data file, not a placeholder

The `<*-panel>` custom-element hosts in play/index.html render as empty inline elements until Plan 03 defines them, but that is the plan's intended gap, not a stub: Plan 03's job is to fill them. They are documented in this plan's `affects:` frontmatter.

## Self-Check: PASSED

Files created/modified (verified on disk):
- [x] `test -f play/index.html` -> found (80 lines)
- [x] `test -f play/styles/play.css` -> found (70 lines)
- [x] `test -f play/app/main.js` -> found (~110 lines)
- [x] `test -f play/app/api.js` -> found (10 lines)
- [x] `test -f play/app/constants.js` -> found (12 lines)
- [x] `test -f shared/player-archetypes.json` -> found (102 lines, byte-identical to beta/viewer/ copy)
- [x] `beta/app/store.js` declares `replay.player: null` in initial state (verified `grep -c 'player: null'` returns 1)

Commits (verified in git log):
- [x] cfba32d exists in git log
- [x] d43c465 exists in git log
- [x] f94be59 exists in git log

Scope hygiene:
- [x] No modifications to STATE.md, ROADMAP.md, REQUIREMENTS.md, PROJECT.md in any commit
- [x] No unrelated files in commits (pre-existing dirty working tree left untouched)
- [x] No accidental deletions in any commit (`git diff --diff-filter=D` empty for all 3)

Tests:
- [x] play-route-structure.test.js: 9/9 pass
- [x] play-main-bootstrap.test.js: 7/7 pass
- [x] play-shell-01.test.js: 2/2 pass (full scan mode, zero violations across 7 scanned files)
- [x] play-panel-stubs.test.js: 0/70 pass (expected; Plan 03 closes)
- [x] beta/app/__tests__/*.test.js: 31/31 pass (no regressions)

All success criteria from the plan frontmatter (ROUTE-01, ROUTE-03, ROUTE-04, DAY-02, DAY-03, DAY-04) are verified by the passing tests above. ROUTE-02 and DAY-01 are covered by play-panel-stubs.test.js and will flip green when Plan 03 ships the selector and scrubber custom elements.
