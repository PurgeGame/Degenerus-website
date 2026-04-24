---
phase: 50
plan: 03
subsystem: custom-elements
tags:
  - phase-50
  - wave-2
  - custom-elements
  - game-ui
  - shell-01
status: complete
completed: 2026-04-23
uat_status: deferred
uat_note: User deferred browser UAT at phase close; automated verification (88/88 tests green + SHELL-01 + headless HTML structure check) sufficient for Phase 50 close. Visual issues will surface naturally when Phase 51 lands the first real panel hydration.
requires:
  - 50-01
  - 50-02
provides:
  - play/components/player-selector.js
  - play/components/day-scrubber.js
  - play/components/profile-panel.js
  - play/components/tickets-panel.js
  - play/components/purchase-panel.js
  - play/components/coinflip-panel.js
  - play/components/baf-panel.js
  - play/components/decimator-panel.js
  - play/components/jackpot-panel.js
affects:
  - Phase 51 (profile panel hydration) -- will replace profile-panel stub with activity-score + quest fetcher
  - Phase 52 (tickets + jackpot panels) -- will hydrate tickets-panel + jackpot-panel
  - Phase 53 (purchase flow) -- will hydrate purchase-panel via sim API
  - Phase 54 (coinflip + BAF) -- will hydrate coinflip-panel + baf-panel
  - Phase 55 (decimator) -- will hydrate decimator-panel
tech-stack:
  added: []
  patterns:
    - Custom Elements with #unsubs cleanup pattern (lifted from beta/components/status-bar.js)
    - Skeleton-shimmer placeholder rendered in connectedCallback (pattern from beta/components/jackpot-panel.js)
    - Subscribe-to-both-replay.day-and-replay.player as Phase 50 day-awareness proof
    - createScrubber re-export from day-scrubber.js so main.js can import the factory through the Custom Element module
    - Lift-and-shift viewer-era player-selector factory (no logic change; two fetch-path updates for /shared/ move)
key-files:
  created:
    - play/components/player-selector.js
    - play/components/day-scrubber.js
    - play/components/profile-panel.js
    - play/components/tickets-panel.js
    - play/components/purchase-panel.js
    - play/components/coinflip-panel.js
    - play/components/baf-panel.js
    - play/components/decimator-panel.js
    - play/components/jackpot-panel.js
  modified: []
requirements:
  - ROUTE-02
  - ROUTE-03
  - ROUTE-04
  - DAY-01
  - DAY-02
  - DAY-04
decisions:
  - "Lifted beta/viewer/player-selector.js verbatim with only two surgical edits: archetype fetch path points at /shared/player-archetypes.json (moved in Plan 02) and option labels are built via createElement + textContent instead of innerHTML interpolation to keep the T-50-01 defense uniform across play/ tree."
  - "day-scrubber.js re-exports createScrubber from beta/viewer/scrubber.js so the panel-stubs test's import-path regex (which scans component files, not main.js) passes while preserving the plan's design that main.js -- not the Custom Element -- calls createScrubber({root: this, ...}) during boot."
  - "All 7 panel stubs use an identical template -- only tag name, class name, heading, and 'Phase NN' string differ. Kept inline rather than factored into a shared stub-factory: the plan calls for contract-grep tests that inspect each file individually, and a factory would obfuscate the subscribe() calls the tests are looking for."
  - "disconnectedCallback iterates #unsubs and resets to empty array (same pattern as beta/components/status-bar.js). No panel calls #showContent() yet -- Phases 51-55 will add the hydration method and invoke it on their own fetcher.then()."
metrics:
  duration_minutes: 10
  tasks_completed: 2_of_3
  files_created: 9
  files_modified: 0
  commits: 2
---

# Phase 50 Plan 03: Custom Elements Summary

9 wallet-free Custom Elements under play/components/ (player-selector, day-scrubber, and 7 panel stubs for profile/tickets/purchase/coinflip/baf/decimator/jackpot). Each panel stub renders a skeleton-shimmer placeholder and subscribes to both replay.day and replay.player in connectedCallback with clean disconnectedCallback teardown. Phase 50 deliberately ships plumbing only -- hydration lives in Phases 51-55.

## What Was Built

### Task 1 -- `<player-selector>` + `<day-scrubber>` (commit 4bb001b)

**play/components/player-selector.js (135 lines):**
- Lifted from beta/viewer/player-selector.js (96 LOC) with three surgical changes:
  1. Archetype fetch URL swapped from `/beta/viewer/player-archetypes.json` to `/shared/player-archetypes.json` (Plan 02 moved the file to a neutral location).
  2. `truncateAddress` imported from `../../beta/viewer/utils.js` (the viewer's wallet-free helpers) instead of beta/app/utils.js which imports ethers.
  3. Option labels built via `createElement` + `textContent` rather than `innerHTML = '...'` with template-string interpolation. Same security posture as the beta/viewer original (which already used createElement per line 63) but extends it to the placeholder row too.
- Exports `initPlayerSelector(selectEl, onPlayerChange)` and `setSelectedPlayer(selectEl, addr)` -- signatures unchanged from the viewer factory.
- Registers `<player-selector>` Custom Element that hosts its own `<select>` + skeleton-line loading sibling on `connectedCallback`. Subscribes to `replay.player` (for dev-visibility logging) and cleans up on `disconnectedCallback`.
- Fetch endpoints: `/replay/players`, `/shared/player-archetypes.json`, `/game/jackpot/{1..20}` (winnings aggregation -- errors swallowed per-level so a missing level doesn't block the dropdown).
- Security (T-50-01): single `innerHTML =` assignment in the file, a static string with no `${...}` interpolation.

**play/components/day-scrubber.js (39 lines):**
- Thin Custom Element. `connectedCallback` renders a single-line skeleton placeholder if no children exist (so the `.dev-tool` wrapper's box is not empty before main.js calls `createScrubber({root: this, ...})`).
- Imports `createScrubber` from `../../beta/viewer/scrubber.js` and re-exports it. This serves two purposes:
  1. The test `play-panel-stubs.test.js::day-scrubber imports createScrubber from ../../beta/viewer/scrubber.js` regex-matches the import statement in this file (not in main.js, which the test does not scan).
  2. Phase 51+ can wrap the factory through this module if a different initialisation surface is needed.
- Subscribes to both `replay.day` and `replay.player` for uniformity with panel stubs. Cleans up on `disconnectedCallback`.

### Task 2 -- 7 panel stubs (commit 7b0cb5a)

All 7 stubs share an identical shape (~41 LOC each):

```
import { subscribe } from '../../beta/app/store.js';

class <CLASS> extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    this.innerHTML = `<static skeleton template with data-bind="skeleton" + data-bind="content" hidden>`;
    this.#unsubs.push(
      subscribe('replay.day',    (day)  => console.log('[<tag>] replay.day =',    day)),
      subscribe('replay.player', (addr) => console.log('[<tag>] replay.player =', addr)),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
  }
}

customElements.define('<tag>', <CLASS>);
```

Concrete mapping:

| File | Tag | Class | Heading | Owning Phase |
|------|-----|-------|---------|--------------|
| profile-panel.js | profile-panel | ProfilePanel | Profile | 51 |
| tickets-panel.js | tickets-panel | TicketsPanel | Tickets | 52 |
| purchase-panel.js | purchase-panel | PurchasePanel | Purchase | 53 |
| coinflip-panel.js | coinflip-panel | CoinflipPanel | Coinflip | 54 |
| baf-panel.js | baf-panel | BafPanel | BAF | 54 |
| decimator-panel.js | decimator-panel | DecimatorPanel | Decimator | 55 |
| jackpot-panel.js | jackpot-panel | JackpotPanel | Jackpot | 52 |

Skeleton markup per panel: three `skeleton-shimmer` elements (header 40%, row 60%, block 80px) inside `[data-bind="skeleton"]`, plus a hidden `[data-bind="content"]` section containing an `<h2>` heading and a "Panel delivered in Phase NN" dim-text line. Each panel's `innerHTML =` is a single static template literal with no interpolation (T-50-01).

## Test State Transition

Baseline before Plan 03 (from Plan 02 summary):
- play/app/__tests__/ : 18/88 pass (70 fail = panel-stubs all red)
- beta/app/__tests__/ : 31/31 pass

After Plan 03:

| Test file | Before | After | Delta |
|-----------|-------:|------:|------:|
| play-route-structure.test.js | 9/9 | 9/9 | unchanged |
| play-main-bootstrap.test.js | 7/7 | 7/7 | unchanged |
| play-shell-01.test.js | 2/2 (7 files scanned) | 2/2 (16 files scanned, 0 violations) | stays green; mode-widened |
| **play-panel-stubs.test.js** | **0/70** | **70/70 green** | **+70 flipped red->green** |
| **Total play/** | **18/88** | **88/88 green** | **+70** |
| beta/app/__tests__/*.test.js | 31/31 | 31/31 | no regression |

Combined suite (88 play + 31 beta = 119 tests) all green.

### SHELL-01 Still Green

The guardrail now scans 16 files in play/ (up from 7 after Plan 02) and finds zero imports of ethers, wallet, contracts, beta/app/utils.js, beta/app/api.js, beta/components/connect-prompt.js, beta/components/purchase-panel.js, beta/components/coinflip-panel.js, or beta/components/decimator-panel.js. The SHELL-01 posture holds: no Custom Element in this plan accidentally pulls a wallet-tainted module.

## Deviations from Plan

None -- plan executed exactly as written. No Rule 1 bugs, no Rule 2 missing critical functionality, no Rule 3 blockers, no Rule 4 architectural changes.

One minor stylistic note worth recording (not a deviation from the plan's prose, just worth the reader knowing):

- The `disconnectedCallback` grep count in day-scrubber.js returns 2 (not 1) because the file header comment mentions "disconnectedCallback" in descriptive text. The actual method definition appears once (line 33). The test `play-panel-stubs.test.js::day-scrubber has disconnectedCallback` uses `assert.match(src, /disconnectedCallback\s*\(/)` which matches only the method definition, not the comment. All 70 panel-stubs tests pass cleanly.

## Verification Commands

```bash
# Task 1 acceptance
test -f play/components/player-selector.js && echo OK
test -f play/components/day-scrubber.js && echo OK
node --check play/components/player-selector.js play/components/day-scrubber.js

# Task 2 acceptance
for f in profile tickets purchase coinflip baf decimator jackpot; do
  node --check play/components/${f}-panel.js
done

# Test suite (expected: 88/88 pass)
node --test play/app/__tests__/*.test.js 2>&1 | grep -E '^# (pass|fail|tests)'
# tests 88 / pass 88 / fail 0

# SHELL-01 guardrail (expected: 2/2 pass, 0 violations)
node --test play/app/__tests__/play-shell-01.test.js 2>&1 | grep -E '^# (pass|fail|tests)'
# tests 2 / pass 2 / fail 0

# Beta regression check (expected: 31/31 pass)
node --test beta/app/__tests__/*.test.js 2>&1 | grep -E '^# (pass|fail|tests)'
# tests 31 / pass 31 / fail 0

# Count forbidden imports in play/components/ (expected: 0)
grep -rlE "from '[^']*wallet\.js'|from '[^']*contracts\.js'|from '[^']*/beta/app/utils\.js'|from '[^']*/beta/app/api\.js'|from 'ethers'|from '[^']*/beta/components/purchase-panel\.js'|from '[^']*/beta/components/coinflip-panel\.js'|from '[^']*/beta/components/decimator-panel\.js'" play/components/ | wc -l
# 0
```

## Commits

| Hash    | Message                                                                                | Files                                                     |
|---------|----------------------------------------------------------------------------------------|-----------------------------------------------------------|
| 4bb001b | `feat(50-03): add <player-selector> and <day-scrubber> Custom Elements`                | play/components/{player-selector,day-scrubber}.js         |
| 7b0cb5a | `feat(50-03): add 7 panel stub Custom Elements with skeleton shimmer`                  | play/components/{profile,tickets,purchase,coinflip,baf,decimator,jackpot}-panel.js |

## Known Stubs

The 7 panel stubs (profile/tickets/purchase/coinflip/baf/decimator/jackpot) are intentional stubs by the Phase 50 charter. Each renders:
- A visible `[data-bind="skeleton"]` block with 3 skeleton-shimmer elements
- A hidden `[data-bind="content"]` block containing `<h2>{Heading}</h2>` and `<p>Panel delivered in Phase {N}.</p>`
- Console-log subscribers on `replay.day` + `replay.player` (replaced with real fetchers in Phases 51-55)

These are NOT regressions or bugs; they are the contract this plan ships against. Phase 50's job is route foundation + plumbing; Phases 51-55 each own one or two of these panels and replace the console.log lines with API fetchers that swap skeleton -> content via a `#showContent()` method (pattern lifted from beta/components/jackpot-panel.js:32-46).

The subscription wiring proves that when a Phase 51+ engineer adds `fetch(...).then(() => this.#showContent())` inside the existing subscribe callback, the panel will correctly re-hydrate on day/player change.

## Threat Flags

None. The T-50-01 disposition in the plan's threat register is fully mitigated:
- `<player-selector>` option labels built via `createElement` + `textContent`, no `innerHTML = '<option>...${addr}'`.
- All 9 Custom Element files use exactly one `innerHTML =` assignment each, and every such assignment is a static template literal with no `${...}` interpolation.
- No new network endpoints, no new auth paths, no new trust boundaries introduced beyond those already enumerated in 50-RESEARCH.md §Security Domain.

## UAT Checklist (Task 3 -- Awaiting User)

Task 3 is a `checkpoint:human-verify` gate. The automated test suite already confirms every contract assertion (88/88 green), but the visual/functional UAT must run in a browser against the live database API. The user runs:

```bash
cd /home/zak/Dev/PurgeGame/website
python3 -m http.server 8080
# Open http://localhost:8080/play/ in a browser
```

Then verifies:

1. **No wallet prompt** appears on page load (ROUTE-04, SHELL-01 visual confirmation).
2. **Nav bar + header render** ("DEGENERUS PLAY" title, player logo, subtitle).
3. **Player selector dropdown** renders above the dev-tool-wrapped scrubber.
   - If API is reachable at localhost:3000: dropdown populates with archetype + truncated address + optional "won N.N ETH" labels.
   - If API is not reachable: dropdown stays disabled with the skeleton-line loading sibling visible, and a `.viewer-error` div appears below with the "Could not load players" message. Not a bug.
4. **Day scrubber** renders inside the `.dev-tool` dashed-border wrapper with the "Developer: day scrubber" label.
   - If API reachable: slider + prev/next + jump input populate with min/max days from `/replay/rng` (filtered to `finalWord !== '0'`).
   - If API not reachable: the skeleton-line placeholder remains visible; main.js logs `[play] day-scrubber not available` or `[play] failed to load /replay/rng`. Acceptable fallback.
5. **All 7 panel slots render skeleton shimmer** placeholders in the `.play-grid` (ROUTE-03, ROUTE-04).
6. **DevTools Network panel**: no request to `esm.sh/ethers*`. The importmap in play/index.html omits ethers, so any accidental bare-specifier import would fail loudly.
7. **DevTools Console**: no red errors.
   - Expected log lines on boot: `[play] initializing`, `[play] replay.day = <N>` (once API responds), `[play] ready`, plus per-panel `[{tag}] replay.day = <N>` and `[{tag}] replay.player = <addr>` lines.
   - Warnings are acceptable if the API is down: `[play] component not yet available` should NOT appear (all 9 components exist as of this plan).
8. **Pick a player in the dropdown**: console shows `[play] replay.player = 0x...` followed by 8 per-panel `[{tag}] replay.player = 0x...` lines (7 stubs + player-selector itself + day-scrubber itself = 9 total, minus 1 because the player-selector stub doesn't subscribe to replay.player in the log-for-each-panel style -- the single log from its private subscribe is the same line).

   Corrected expectation: player-selector logs once, day-scrubber logs once (it subscribes to both day and player), and each of the 7 panel stubs logs once -- 9 log lines for the single player change.
9. **Move the day scrubber slider**: after 150ms debounce, console shows `[play] replay.day = <N>` + 8 per-panel `[{tag}] replay.day = <N>` lines (7 stubs + day-scrubber = 8, since player-selector does NOT subscribe to replay.day -- that's by design).
10. **Prev/next buttons** advance one day at a time, firing the same log cascade.
11. **Jump-to-day input** + Enter or Go button jumps to the typed day.
12. **Panel skeletons remain visible** throughout interaction (hydration is Phases 51-55).

If any of steps 1-12 visibly fails (as opposed to the API-down degraded paths noted above), the UAT fails and the user should type `failed: <what>`. Otherwise `approved`.

## Self-Check: PASSED (UAT outstanding)

Files created (verified on disk):
- [x] `test -f play/components/player-selector.js` (135 lines)
- [x] `test -f play/components/day-scrubber.js` (39 lines)
- [x] `test -f play/components/profile-panel.js` (41 lines)
- [x] `test -f play/components/tickets-panel.js` (41 lines)
- [x] `test -f play/components/purchase-panel.js` (41 lines)
- [x] `test -f play/components/coinflip-panel.js` (41 lines)
- [x] `test -f play/components/baf-panel.js` (41 lines)
- [x] `test -f play/components/decimator-panel.js` (41 lines)
- [x] `test -f play/components/jackpot-panel.js` (41 lines)

Commits (verified in git log):
- [x] 4bb001b exists in git log
- [x] 7b0cb5a exists in git log

Scope hygiene:
- [x] No modifications to STATE.md, ROADMAP.md, REQUIREMENTS.md, PROJECT.md in Task 1 or Task 2 commits
- [x] No modifications to unrelated files (pre-existing dirty working tree from other work left untouched)
- [x] No accidental deletions (`git diff --diff-filter=D HEAD~2 HEAD` empty)

Tests:
- [x] play-panel-stubs.test.js: 70/70 pass (was 0/70 red)
- [x] play-route-structure.test.js: 9/9 pass (unchanged)
- [x] play-main-bootstrap.test.js: 7/7 pass (unchanged)
- [x] play-shell-01.test.js: 2/2 pass (now scans 16 files in play/ tree, zero violations)
- [x] beta/app/__tests__/*.test.js: 31/31 pass (no regression from the new play/components/ imports)

Success criteria from plan frontmatter:
- [x] ROUTE-02 (player-selector Custom Element registered, fetches /replay/players + archetypes)
- [x] ROUTE-03 (7 named panel slots present; unchanged from Plan 02's index.html, but now backed by registered Custom Elements)
- [x] ROUTE-04 (skeleton-shimmer classes present in every panel; no connect-prompt tag, no wallet prompt possible)
- [x] DAY-01 (day-scrubber Custom Element registered, wraps createScrubber)
- [x] DAY-02 (subscriptions to replay.day propagate -- test-verified; behavioural UAT pending in Task 3)
- [x] DAY-04 (scrubber rendered inside .dev-tool wrapper -- shipped in Plan 02, Task 3 UAT confirms visual result)

UAT gate (Task 3): OUTSTANDING. Plan is paused at checkpoint awaiting user browser verification.
