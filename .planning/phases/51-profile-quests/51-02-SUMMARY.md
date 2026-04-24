---
phase: 51-profile-quests
plan: 02
subsystem: ui
tags:
  - phase-51
  - wave-1
  - profile-panel
  - quests
  - custom-elements
  - shell-01
  - game-ui
  - css
  - a11y

# Dependency graph
requires:
  - phase: 51-profile-quests
    provides: Plan 51-01 Wave 0 RED-gate harness (play/app/__tests__/play-profile-panel.test.js, 24 assertions) + INTEG-02-SPEC.md contract + REQUIREMENTS updates (PROFILE-05, INTEG-02 reissue)
  - phase: 50-route-foundation-day-aware-store
    provides: Phase 50 profile-panel stub + wallet-free shell + play-shell-01.test.js recursive guardrail + beta/app/store.js subscribe import + beta/viewer/utils.js wallet-free formatters
provides:
  - play/app/quests.js (wallet-free formatQuestTarget + getQuestProgress + QUEST_TYPE_LABELS; corrects the questType 9 -> MINT_BURNIE mapping locally)
  - play/components/profile-panel.js (four-section hydrated light-DOM markup with all data-bind hooks, popover a11y wiring via AbortController, render helpers defined for Wave 2 to call)
  - play/styles/play.css (profile-panel tier colors, popover, quest-slots grid, daily-activity grid, is-stale dim overlay, reduced-motion fallback, mobile responsive tweaks)
affects:
  - Plan 51-03 (Wave 2 backend wiring) -- hard-gated on INTEG-02 delivery; only needs to add #profileFetchId counter, #refetch() body, and replace the two subscribe() console.log callbacks. All render helpers (#renderAll, #renderScore, #renderStreak, #renderQuestSlots, #renderDailyActivity, #renderError, #showContent) are already in place.
  - Plan 51-04 (Wave 3 UAT)
  - Any future panel in play/ that needs a decomposition popover -- the AbortController-gated #bindPopover pattern is reusable

# Tech tracking
tech-stack:
  added: []
  patterns:
    - AbortController-gated event listener cleanup for Custom Elements (addEventListener(..., { signal }) + disconnectedCallback aborts; no manual removeEventListener needed)
    - Render-helper separation: all #renderX(data) methods defined without any fetch dependency, so the Wave 2 fetch wiring is a narrow 1-task delta instead of an intermixed rewrite
    - Wallet-free mirror module pattern: play/app/quests.js shadows beta/app/quests.js on the SHELL-01-safe side of the boundary without touching the beta tree (leaves the beta bug 0 -> MINT_BURNIE for a later cleanup pass)
    - Popover a11y: tap + hover + focus + ESC + outside-click dismiss with pointerType filter (hover only fires on mouse; touch uses click)

key-files:
  created:
    - play/app/quests.js
  modified:
    - play/components/profile-panel.js
    - play/styles/play.css

key-decisions:
  - "play/app/quests.js mirrors beta/app/quests.js but fixes the questType 9 -> MINT_BURNIE mapping locally (beta still has 0 -> MINT_BURNIE bug per beta/app/constants.js:155-165 and beta/app/quests.js:19; D-20 verification confirmed 9 is the on-chain value per DegenerusQuests.sol:173-175). Leaving beta untouched avoids ripple regressions in the beta UI that is already in production."
  - "Popover a11y uses AbortController + addEventListener(..., { signal }) so a single .abort() call in disconnectedCallback drops all 7 listeners (click, pointerenter, pointerleave, focus, keydown on btn, keydown on pop, document click). No manual removeEventListener bookkeeping."
  - "All four #renderX helpers + #renderAll + #renderError + #showContent are defined in Wave 1 without any fetch dependency. Wave 2's delta is a single-task change: add #profileFetchId, add #refetch(), change the two subscribe() bodies. No rewrite cascade."
  - "Tests 15 (/player/${}?day=) and 16 (#profileFetchId) stay RED as the plan's acceptance criteria explicitly require. The plan's original prescribed comment (lines 22-23) accidentally matched both regexes and flipped them green; reworded the comment to preserve Wave 2 intent without triggering the source grep."

patterns-established:
  - "AbortController cleanup for Custom Element listeners: connectedCallback captures a new AbortController, passes its signal to every addEventListener, and disconnectedCallback calls .abort(). Applicable to any play/ panel that binds event listeners."
  - "Wallet-free mirror module convention: when a beta/ module is ethers-tainted, ship a play/app/<same-name>.js re-implementation that imports only from beta/viewer/ (the wallet-free namespace). Fix enum / logic bugs locally; log the beta-side cleanup as a follow-up."
  - "Render-helper-first execution: in a two-wave plan where Wave 2 is hard-gated on backend delivery, Wave 1 ships ALL render helpers + TEMPLATE + a11y wiring + CSS. Wave 2 becomes a single-task delta (fetch + stale-guard + subscribe wiring) instead of an intermixed rewrite."

requirements-completed: []  # Wave 1 delivers markup + local helper; PROFILE-01..05 require Wave 2 backend hydration to close. Wave 2 closes all five + INTEG-02.

# Metrics
duration: ~25min
completed: 2026-04-24
---

# Phase 51 Plan 02: Wave 1 Skeleton & Quests Helper Summary

**Four-section hydrated profile-panel markup + wallet-free quests helper + full profile CSS lands; 22/24 Wave 0 assertions now green, leaving only the two Wave 2-gated fetch-URL / fetch-id counter tests RED.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-24
- **Completed:** 2026-04-24
- **Tasks:** 3 / 3 complete
- **Files created:** 1 (play/app/quests.js)
- **Files modified:** 2 (play/components/profile-panel.js, play/styles/play.css)

## Accomplishments

- Authored `play/app/quests.js` (98 lines): a wallet-free re-implementation of `beta/app/quests.js` that imports `formatEth`/`formatBurnie` from `beta/viewer/utils.js` and fixes the on-chain quest-type enum locally. `QUEST_TYPE_LABELS[9]` is `'Mint BURNIE Tickets'` (0 is the null sentinel, omitted). `getQuestProgress` takes the API row directly instead of reading the reactive store.
- Rebuilt `play/components/profile-panel.js` (366 lines) from the Phase 50 skeleton stub into a four-section light-DOM Custom Element. All `data-bind` hooks the Wave 0 harness asserts on are present (score, info-btn, popover, row-quest, row-mint, row-affiliate, row-pass-value, row-pass-container, base-streak, last-completed-day, lootboxes-purchased, lootboxes-opened, tickets-purchased, ticket-wins, plus data-slot-idx="0"/"1"). Popover accessibility wired via AbortController: tap + hover + focus opens, ESC + outside-click closes, all 7 listeners drop on `disconnectedCallback`. Seven render helpers defined (`#renderScore`, `#renderStreak`, `#renderQuestSlots`, `#renderDailyActivity`, `#renderAll`, `#renderError`, `#showContent`) without any fetch dependency, so Wave 2 is a narrow delta.
- Appended 302 lines of CSS to `play/styles/play.css` without touching Phase 50 rules: tier colors via `.tier-dim`/`.tier-default`/`.tier-accent` classes (thresholds at 0.60 and 2.55 per D-04), popover absolute-positioned card with focus-visible ring, quest-slot grid with progress bar + completed-state tint, 2x2 daily-activity grid, `.is-stale` opacity-0.6 dim overlay (Wave 2 toggles), `prefers-reduced-motion` fallback, mobile (<= 720px) responsive adjustments.
- Turned 15 Wave 0 RED assertions green (22/24 total passing, up from 7/24). Remaining 2 RED (tests 15 and 16) are explicit Wave 2 deliverables per the plan's acceptance criteria.

## Task Commits

1. **Task 1: Create play/app/quests.js** -- `67ace15` (feat)
2. **Task 2: Rewrite profile-panel with four sections + popover a11y** -- `3ec585a` (feat)
3. **Task 3: Append profile-panel CSS to play/styles/play.css** -- `3fe9628` (feat)

## Files Created/Modified

- `play/app/quests.js` (new, 98 lines) -- wallet-free quest helpers. Imports `formatEth`/`formatBurnie` from `../../beta/viewer/utils.js`. Exports `QUEST_TYPE_LABELS` (keys 1, 2, 3, 5, 6, 7, 8, 9; 0 intentionally omitted as null sentinel per DegenerusQuests.sol:173-175), `formatQuestTarget(questType, requirements)` switch, and `getQuestProgress(questRow)` that takes an API row and returns `{ type, target, progress, completed }` or `null`.
- `play/components/profile-panel.js` (rebuilt, 366 lines) -- replaces the Phase 50 27-line skeleton stub. Static TEMPLATE constant (XSS-safe, T-51-01). Class has private fields `#unsubs`, `#loaded`, `#popoverAbort`. `connectedCallback` sets innerHTML, calls `#bindPopover()`, pushes the two Phase 50 console.log subscriptions (Wave 2 replaces bodies). `disconnectedCallback` unsubs + aborts popover listeners. Render helpers operate on an INTEG-02-shaped data object but are not called yet (skeleton stays visible).
- `play/styles/play.css` (appended, 68 -> 370 lines) -- Phase 50 rules preserved. Added Phase 51 profile-panel block: container + section rhythm, activity-score typography + tier classes, info-btn + popover layout, streak banner, quest slots + progress bar + completed modifier, daily-activity grid, `.is-stale` dim overlay with `prefers-reduced-motion` fallback, mobile responsive tweaks.

## Decisions Made

- **Wallet-free mirror over beta fix.** `beta/app/constants.js:155-165` and `beta/app/quests.js:19` both map `questType=0` to `MINT_BURNIE`, which is wrong on-chain (contract uses 9; 0 is the null sentinel per `DegenerusQuests.sol:173-175`). Rather than patching beta (which risks ripple regressions in production beta UI), `play/app/quests.js` ships the correct mapping locally. A later cleanup plan can fix beta.
- **AbortController for popover listeners.** Seven listeners (click, pointerenter, pointerleave, focus, two keydowns, document click) attach in `#bindPopover`. Using `{ signal }` on each and `.abort()` in `disconnectedCallback` drops all seven at once, avoiding manual `removeEventListener` bookkeeping.
- **Render-helper-first.** All render methods (`#renderScore`, `#renderStreak`, `#renderQuestSlots`, `#renderDailyActivity`, `#renderAll`, `#renderError`, `#showContent`) are defined in Wave 1 without any fetch dependency. They accept INTEG-02-shaped objects but are never invoked. Wave 2 becomes a narrow delta: add `#profileFetchId`, add `#refetch()`, change the two subscribe() callback bodies. No rewrite cascade.
- **`is-stale` reference via comment + CSS rule.** The Wave 0 assertion checks for `is-stale` substring presence in the panel source. The plan authored a roadmap comment explicitly mentioning it; the CSS defines the actual rule and `[prefers-reduced-motion]` fallback. Wave 2 toggles the class.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's prescribed doc comment contained `from 'ethers'` which triggered the SHELL-01 guardrail**

- **Found during:** Task 1 verification (running `node --test play/app/__tests__/play-shell-01.test.js` against the freshly-created `play/app/quests.js`)
- **Issue:** The plan's prescribed content for `play/app/quests.js` line 11 read:
  `//    but without the \`import { ethers } from 'ethers'\` taint).`
  This text contains the literal `from 'ethers'`, which the SHELL-01 recursive scan regex `/from\s+['"]ethers['"]/` (in `play-shell-01.test.js:23`) matches. The test failed with `SHELL-01 violations: app/quests.js imports bare 'ethers' specifier`. A doc comment should not violate a wallet-taint guardrail.
- **Fix:** Reworded the comment to preserve the explanatory intent without embedding the exact bare-specifier string:
  `//    but without the ethers bare-specifier taint).`
- **Files modified:** play/app/quests.js (comment line only)
- **Verification:** `grep -c "from\s*['\"]ethers['\"]" play/app/quests.js` returns 0; `node --test play/app/__tests__/play-shell-01.test.js` exits 0 (2/2 pass).
- **Committed in:** `67ace15` (Task 1 commit, after the fix)

**2. [Rule 1 - Bug] Plan's prescribed profile-panel.js roadmap comment accidentally flipped the Wave 2 assertions green**

- **Found during:** Task 2 verification (running `node --test play/app/__tests__/play-profile-panel.test.js` against the new file)
- **Issue:** The plan's prescribed content for `play/components/profile-panel.js` lines 22-23 read:
  `// Wave 2 will add: #profileFetchId counter, #refetch() method that fetches`
  `// /player/${addr}?day=${day}, is-stale class toggle for keep-old-data-dim,`
  These lines contain the literal strings `#profileFetchId` and `/player/${addr}?day=`, which match tests 15 (`/\/player\/\$\{[^}]+\}\?day=/`) and 16 (`/#profileFetchId/`). The plan's own acceptance criteria explicitly require these to stay RED in Wave 1 (`grep -c "#profileFetchId" play/components/profile-panel.js` returns 0; `grep -c "/player/\\\\\\${" play/components/profile-panel.js` returns 0). The roadmap comment was self-contradictory.
- **Fix:** Reworded the roadmap comment to describe Wave 2's additions in plain English without the literal identifiers:
  `// Wave 2 will add: a private fetch-id stale-guard counter, a refetch()`
  `// method hitting the extended player endpoint with a day query param,`
  `// the is-stale class toggle for keep-old-data-dim, and will replace the`
  `// subscribe() console.log callbacks with refetch() calls.`
- **Files modified:** play/components/profile-panel.js (comment lines only)
- **Verification:** `grep -c "#profileFetchId" play/components/profile-panel.js` returns 0; `grep -c "/player/\${" play/components/profile-panel.js` returns 0. Tests 15 and 16 are RED (as the plan's success criteria line 1232 requires); all markup-binding tests (5-12, 17, 18) are green.
- **Committed in:** `3ec585a` (Task 2 commit, after the fix)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug; both were self-inconsistencies inside the plan prescription; neither expanded scope). Both preserve the plan's stated intent while satisfying the plan's own acceptance criteria.

**Impact on plan:** Neither deviation changed what shipped. Comment wording adjusted in two places so (a) the SHELL-01 source-grep guardrail stays green and (b) the Wave 1 acceptance criteria about "#profileFetchId absent" and "/player/${...}?day= absent" actually hold. Both fixes were minimum-surface rewordings of doc comments only.

## Issues Encountered

- Working tree carried uncommitted noise from prior sessions (beta/ files, planning v2.3 harness, etc.) at session start. None touched by Wave 1. The three task commits stage files individually so the noise remained out of the commit tree. No action required.

## Next Phase Readiness

**Wave 2 (Plan 51-03) is HARD-GATED on database-repo delivery of INTEG-02.** It has a narrow delta to apply:

1. Add `#profileFetchId = 0` private field.
2. Add `#refetch()` method: increment `#profileFetchId`, snapshot the token, read `replay.day` and `replay.player` from the store, build `` `${API_BASE}/player/${addr}?day=${day}` ``, call `fetchJSON`, on resolve compare token against `this.#profileFetchId` and bail if stale, otherwise call `this.#renderAll(data)` + `this.#showContent()`. On 404/500 call `this.#renderError(status)`.
3. Before firing the fetch, toggle `is-stale` class on `[data-bind="content"]`; remove on resolve.
4. Replace the two `subscribe('replay.day', ...)` / `subscribe('replay.player', ...)` callback bodies with `this.#refetch()` calls (guarded by both values being non-null).

All render helpers + DOM template + CSS + a11y wiring are already in place. Wave 2 turns tests 15 and 16 green (plus any runtime tests the Wave 2 plan adds).

**SHELL-01 invariant holds.** `node --test play/app/__tests__/play-shell-01.test.js` exits 0 (2/2 pass). No new wallet-tainted imports in the `play/` tree.

**Phase 50 tests remain 88/88 green.** `play-shell-01` (2), `play-panel-stubs` (70 of 70 in the subset counted), `play-route-structure` (9), `play-main-bootstrap` (7). Plus the new `play-profile-panel.test.js` which is now 22/24 (was 7/24 at Wave 0 end).

**Full `/play/` suite status:** 112 tests, 110 pass, 2 fail (tests 15 + 16; RED by design until Wave 2).

**CSS changes are additive.** Phase 50's `.play-controls`, `.play-grid`, `.dev-tool`, footer rules all preserved. Route-structure test exits 0 (9/9 pass).

## Self-Check: PASSED

**Files created verification:**
- `/home/zak/Dev/PurgeGame/website/play/app/quests.js`: FOUND (98 lines)

**Files modified verification:**
- `/home/zak/Dev/PurgeGame/website/play/components/profile-panel.js`: FOUND (366 lines, was 40)
- `/home/zak/Dev/PurgeGame/website/play/styles/play.css`: FOUND (370 lines, was 68)

**Commits verification:**
- `67ace15` (Task 1 - play/app/quests.js): FOUND
- `3ec585a` (Task 2 - profile-panel.js rebuild): FOUND
- `3fe9628` (Task 3 - play.css append): FOUND

**Test suite verification:**
- `node --test play/app/__tests__/*.test.js`: 112 tests, 110 pass, 2 fail (RED by design; Wave 2 gated).
- `node --test play/app/__tests__/play-shell-01.test.js`: exits 0 (SHELL-01 guardrail green).
- `node --test play/app/__tests__/play-panel-stubs.test.js`: exits 0 (Phase 50 panel stubs green).
- `node --test play/app/__tests__/play-route-structure.test.js`: exits 0 (Phase 50 structure green).
- `node --test play/app/__tests__/play-profile-panel.test.js`: 22/24 pass (was 7/24 at Wave 0 end); remaining 2 RED are the Wave 2-gated fetch URL + `#profileFetchId` assertions, explicitly per plan.

**Guardrail scans:**
- `grep -c "highDifficulty" play/components/profile-panel.js` returns 0 (D-20 enforcement).
- `grep -c "from.*'ethers'" play/app/quests.js` returns 0 (no bare ethers specifier anywhere).
- `grep -c "from.*beta/app/utils\.js" play/app/quests.js` returns 0 (no ethers-tainted beta import).
- `grep -c "from.*beta/app/quests\.js" play/app/quests.js` returns 0 (no transitively-tainted import).
- `grep -c "#profileFetchId" play/components/profile-panel.js` returns 0 (Wave 2 adds it).
- `grep -c "/player/\${" play/components/profile-panel.js` returns 0 (Wave 2 adds the fetch URL).

---

*Phase: 51-profile-quests*
*Completed: 2026-04-24*
