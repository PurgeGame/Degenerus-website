---
phase: 54-coinflip-baf
plan: 02
subsystem: play-route
tags: [phase-54, wave-1, panel-hydration, game-ui, shell-01, score-unit-discipline, baf, coinflip, custom-elements, css]

# Dependency graph
requires:
  - phase: 50-play-route-foundation
    provides: <coinflip-panel> + <baf-panel> Phase 50 stubs (evolved in place), skeleton-shimmer pattern, #showContent helper pattern
  - phase: 51-profile-quests
    provides: profile-panel.js gold-standard hydrated-panel template, #profileFetchId stale-guard pattern, is-stale keep-old-data-dim pattern, /player/:addr?day= coinflip block (shipped by INTEG-02)
  - phase: 52-tickets-packs-jackpot
    provides: tickets-panel.js list-rendering pattern (document.createElement + textContent)
  - phase: 54-coinflip-baf/54-01 (Wave 0)
    provides: INTEG-05-SPEC.md (target endpoint contract for Wave 2), play-coinflip-panel.test.js (28 RED assertions), play-baf-panel.test.js (30 RED assertions), play-shell-01.test.js FORBIDDEN +3 entries
provides:
  - play/components/coinflip-panel.js hydrated (305 LOC, Phase 50 stub -> functional panel)
  - play/components/baf-panel.js hydrated (350 LOC, Phase 50 stub -> functional panel)
  - play/styles/play.css +237 LOC (Phase 54 CSS block)
  - COINFLIP-01 + COINFLIP-02 + COINFLIP-03 fully shipped (all three endpoints already live)
  - BAF-02 fully shipped (top-4 leaderboard with data-rank prominence tiers)
  - BAF-03 core shipped (next-baf-level + levels-until labels; round-status pill with Wave 1 fallback)
  - BAF-01 pre-wired (markup + render helper + 404-tolerant INTEG-05 fetch ready for Wave 2)
affects:
  - phase 54-03 (Wave 2; flips 404-tolerant BAF-01 fetch to live rendering once INTEG-05 ships in database/main)
  - phase 54-04 (Wave 3; optional UAT)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual stale-guard counters for panels with multiple independent fetch cadences (#bafFetchId + #bafPlayerFetchId)"
    - "Inline bafContext derivation (15 LOC) inside the panel file to avoid helper-file proliferation and avoid importing from wallet-tainted beta/app/baf.js"
    - "Score-unit discipline (Pitfall 8): integer-scale scores render via String(), wei-scale via formatBurnie; the endpoint->unit mapping is documented in the panel's source comment block"
    - "404-tolerant pre-wiring: emit the fetch call in Wave 1 so Wave 2 only needs to remove the 404 short-circuit; Wave 0 test assertions that grep for the fetch URL flip green in Wave 1"
    - "Verbatim CSS append pattern: Phase 54 CSS block is a contiguous region at the end of play.css with a section-header comment marker, no interleaving with prior rules"
    - "Rank-tier styling by data-rank attribute + CSS attribute selectors (gold/silver/bronze/regular) rather than per-row class names"
    - "Panel-level data-prominence attribute driven by bafContext -> CSS selectors: high/medium/low reflect approach-based prominence, not rank-based"

key-files:
  created:
    - .planning/phases/54-coinflip-baf/54-02-SUMMARY.md (this file)
  modified:
    - play/components/coinflip-panel.js (40 LOC -> 305 LOC; replaced stub with hydrated panel)
    - play/components/baf-panel.js (40 LOC -> 350 LOC; replaced stub with hydrated panel)
    - play/styles/play.css (844 LOC -> 1081 LOC; appended Phase 54 block)
    - play/app/__tests__/play-panel-stubs.test.js (Phase 50 test reconciliation; see Deviations)

key-decisions:
  - "coinflip-panel uses single #coinflipFetchId counter because both endpoints (/player/:addr?day= and /leaderboards/coinflip?day=) invalidate on the same trigger (day or player change). One counter + 3 token checkpoints (post-Promise.all, post-playerRes.json, post-lbRes.json) is sufficient"
  - "baf-panel uses TWO separate counters (#bafFetchId + #bafPlayerFetchId) because leaderboard invalidates on level-change only, while per-player INTEG-05 fetch invalidates on level OR player change. One counter would conflate the two cadences and risk clobbering a fresh leaderboard with a stale per-player response"
  - "BAF-01 pre-wiring uses explicit 404 short-circuit rather than commenting out the fetch. Rationale: the Wave 0 test assertion greps for /player/.../baf?level= in the source; commenting out the fetch would fail the grep. Pre-wiring makes Wave 2 a surgical edit (remove the `if (!res.ok) { return; }` early-return) instead of adding new code"
  - "Wave 1 roundStatus fallback (level % 10 === 0 ? open : not_eligible) deliberately conservative -- cannot claim 'closed' or 'skipped' without authoritative INTEG-05 data. Prevents spoofing the pill into a false-positive round state"
  - "Score-unit comment blocks embedded in both panel files at the header. Rationale: the Pitfall 8 warning table (integer-scale coinflip leaderboard vs wei-scale BAF + coinflip block amounts) is source-of-truth at the file level, not just in planning docs. Any future editor touching render helpers sees the warning inline"
  - "Panel-level data-prominence attribute updated via setAttribute in #renderContext rather than toggling classes. Rationale: matches beta/components/baf-panel.js precedent and keeps CSS selectors simple ([data-prominence='high'] vs .prominence-high)"
  - "Rank-tier hex literals (#FFD700 gold, #C0C0C0 silver, #CD7F32 bronze) hard-coded rather than converted to CSS custom properties. Per 54-RESEARCH Q5: tier hexes are universal design constants across crypto UIs, unlikely to diverge by theme; keeps Phase 54 self-contained and defers custom-property refactor to a future design-system phase"
  - "Phase 50 play-panel-stubs.test.js reconciled (not deleted) to carry per-panel scope ('day' vs 'level'). Both assertions remain in the stub test file, each branching by scope. All 8 panels still covered for day-OR-level subscription presence; baf-panel correctly validates replay.level subscription, matching Phase 54's semantic evolution"

patterns-established:
  - "Phase 50 blanket-assertion tests MUST adapt when later phases evolve semantic scope. When Wave 0 author writes a per-phase test file (play-baf-panel.test.js) that supersedes a Phase 50 blanket assertion, the Phase 50 test file is updated in the same wave that ships the contract change, not deferred"
  - "404-tolerant pre-wiring is a Wave 1 deliverable when the endpoint-owning repo is a separate side-quest. The pattern: emit the fetch call, parse the response defensively, render nothing silently on non-OK. Wave 2 then removes only the 404 short-circuit, not whole code paths"
  - "Score-unit discipline warning tables are replicated in three places: planning doc, Wave 0 test file as comment, and Wave 1 source file as header comment. Three-layer defense against Pitfall 8 regressions"

# Requirements completed this plan
requirements-completed:
  - COINFLIP-01  # per-player coinflip state (deposited, claimable, autoRebuy, takeprofit) rendering from /player/:addr?day= coinflip block
  - COINFLIP-02  # daily coinflip leaderboard top-10 from /leaderboards/coinflip?day=
  - COINFLIP-03  # bounty section (armed indicator, pool, biggest flip, record holder) from coinflip block
  - BAF-02       # top-4 BAF leaderboard from /leaderboards/baf?level= with data-rank tier styling per D-06

# Partial / pre-wired (finished in Wave 2)
requirements-partial:
  - BAF-03  # core UI (next-baf-level + levels-until labels + round-status pill with Wave 1 fallback) ships; authoritative roundStatus from INTEG-05 lands in Wave 2
  - BAF-01  # your-rank row markup + render helper + 404-tolerant fetch all present; live rendering enabled in Wave 2 when database/main ships INTEG-05

# Metrics
duration: ~10min
completed: 2026-04-24
---

# Phase 54 Plan 02: Wave 1 Panel Hydration + CSS Summary

**Coinflip + BAF Custom Elements evolved from 40-LOC Phase 50 stubs to 305/350-LOC hydrated panels; play.css gains 237 LOC covering prominence tiers, rank-tier colors, round-status pill, armed-pulse keyframe; 288/288 play tests passing (was 251/288 Wave 0 RED baseline); 5 of Phase 54's 6 requirements shipped (COINFLIP-01/02/03, BAF-02 full + BAF-03 core), BAF-01 pre-wired for Wave 2 INTEG-05.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-24T13:16:31Z (right after Wave 0 close)
- **Completed:** 2026-04-24T13:26:47Z
- **Tasks:** 3
- **Files modified:** 4 (coinflip-panel.js, baf-panel.js, play.css, play-panel-stubs.test.js)

## Accomplishments

- Rewrote `play/components/coinflip-panel.js` (40 LOC -> 305 LOC). Hydrated three sections reading from two live endpoints: bounty header (COINFLIP-03) + per-player state (COINFLIP-01) from `/player/:addr?day=N` coinflip block (shipped by Phase 51 INTEG-02), and daily leaderboard (COINFLIP-02) from `/leaderboards/coinflip?day=N`. Parallel Promise.all fetch with `#coinflipFetchId` stale-guard (3-checkpoint token comparison matching Phase 51 precedent). `is-stale` class toggled on `[data-bind="content"]` for D-17 keep-old-data-dim on second-and-later fetches. Graceful partial failure: if leaderboard 404s, bounty+state still render. aria-current highlight when entry.player matches `replay.player`. Empty-state message per D-08 gray area.
- Rewrote `play/components/baf-panel.js` (40 LOC -> 350 LOC). Hydrated three sections with dual-fetch architecture: BAF-02 top-4 leaderboard from `/leaderboards/baf?level=N` (live), BAF-03 core context row + round-status pill (Wave 1 fallback derivation + Wave 2 INTEG-05 authoritative source), BAF-01 your-rank row pre-wired with 404-tolerant fetch to `/player/:addr/baf?level=N`. Dual stale-guards (`#bafFetchId` for leaderboard + `#bafPlayerFetchId` for INTEG-05) invalidate independently. Inline `bafContext` derivation (`Math.ceil((level+1)/10)*10` for nextBafLevel, approach-based prominence mapping) keeps logic colocated with the panel. Panel-level `data-prominence` attribute driven by bafContext. Each leaderboard row has `data-rank="1..4"` for CSS tier selectors per D-06. Score-unit discipline honored: all BAF scores wei-scale -> `formatBurnie`, unlike coinflip leaderboard.
- Appended ~237 LOC Phase 54 CSS block to `play/styles/play.css` (844 LOC -> 1081 LOC). Coverage: panel-level `data-prominence` borders (high/medium/low) for BAF per D-06; BAF leaderboard grid + rank-tier colors via `data-rank` attribute selectors (rank 1 #FFD700 gold + bold, rank 2 #C0C0C0 silver, rank 3 #CD7F32 bronze, rank 4 regular); BAF your-rank row with accent-bordered highlight; BAF round-status pill with 4 data-status states (green open, gray closed, red skipped, dim not_eligible); coinflip bounty header with armed/not-armed pill; `@keyframes armed-pulse` copied from beta (play/ does not link beta/styles/); coinflip leaderboard grid + aria-current selected-player highlight; `is-stale` 0.6-opacity dim for both panels. Zero pre-existing rules modified (pure append). Braces balanced. No em dashes.
- Transitioned Wave 0's 37 RED assertions across `play-coinflip-panel.test.js` (~18) and `play-baf-panel.test.js` (~19) from RED to GREEN. Full play test suite grew from 251/288 passing (at Wave 0 close) to 288/288 passing (Wave 1 close). Zero regressions on prior Phase 50/51/52/53 tests.
- Reconciled `play/app/__tests__/play-panel-stubs.test.js` to match Phase 54's semantic evolution of baf-panel from day-scoped to level-scoped subscription. Updated PANEL_STUBS array with per-panel `scope` field; subscription assertion branches by scope. All 8 panels still covered; baf-panel now correctly asserts `replay.level` subscription (matching Wave 0 play-baf-panel.test.js and the Wave 1 implementation).

## Task Commits

1. **Task 1: Hydrate coinflip-panel.js with COINFLIP-01/02/03** -- `e640556` (feat)
2. **Task 2: Hydrate baf-panel.js with BAF-02 + BAF-03 core + BAF-01 pre-wire** -- `2ee8393` (feat)
3. **Task 3: Append Phase 54 CSS block + reconcile Phase 50 stub test** -- `916ba44` (feat)

## Files Created/Modified

- `play/components/coinflip-panel.js` (modified, 40 -> 305 LOC) -- 3-section hydrated panel: bounty + state + leaderboard; parallel Promise.all fetch; #coinflipFetchId stale-guard; score-unit discipline (integer-scale leaderboard via String, wei-scale amounts via formatBurnie); aria-current highlight; empty state; graceful partial failure
- `play/components/baf-panel.js` (modified, 40 -> 350 LOC) -- 3-section hydrated panel: context row + top-4 leaderboard + hidden your-rank row; dual stale-guards (#bafFetchId + #bafPlayerFetchId); inline bafContext (Math.ceil((level+1)/10)); 404-tolerant INTEG-05 fetch for BAF-01 pre-wire; Wave 1 roundStatus fallback; data-prominence panel attribute + data-rank row attributes for D-06 tier styling
- `play/styles/play.css` (modified, 844 -> 1081 LOC) -- +237 LOC Phase 54 block: BAF prominence + rank-tier colors + your-rank row + round-status pill + coinflip bounty + armed-pulse keyframe + coinflip leaderboard + aria-current highlight + is-stale dim class for both panels
- `play/app/__tests__/play-panel-stubs.test.js` (modified, deviation Rule 1) -- PANEL_STUBS array gains `scope` field ('day' vs 'level'); subscription assertion branches by scope. Reconciles Phase 50 blanket assertion with Phase 54's level-scoped baf-panel semantic
- `.planning/phases/54-coinflip-baf/54-02-SUMMARY.md` (created, this file)

## Decisions Made

- **Single fetch-id for coinflip, dual for BAF.** Coinflip's two endpoints (/player/:addr?day= and /leaderboards/coinflip?day=) both invalidate on the same trigger (day or player change), so one counter with 3-checkpoint token comparison is sufficient. BAF's leaderboard invalidates on level-change only, while INTEG-05 per-player fetch invalidates on level OR player change; two separate counters prevent a slow per-player response from being checked against a counter that was only bumped for a leaderboard refetch.
- **Pre-wire INTEG-05 fetch with 404 short-circuit instead of commenting out.** Wave 0 test assertion greps for `/player/.../baf?level=` in the source; a commented-out fetch would fail the grep. Pre-wiring as an active fetch call with `if (!res.ok) { return; }` early-return makes Wave 2 a surgical edit -- remove the short-circuit, call `#renderYourRank(data)` + `#renderRoundStatus(data.roundStatus)`. Minimizes diff size and surface area for Wave 2 bugs.
- **Wave 1 roundStatus fallback is conservative (open | not_eligible only).** Cannot claim "closed" or "skipped" without authoritative INTEG-05 data, because those states depend on server-side game state the frontend cannot observe. level % 10 === 0 cleanly distinguishes eligible vs not-eligible levels; Wave 2 fills in the closed/skipped distinction when the endpoint ships.
- **Inline bafContext rather than new helper file.** 54-PATTERNS.md recommends 15-LOC inline over a new play/app/baf-context.js helper. Avoids file-count growth, avoids risk of importing wallet-tainted beta/app/baf.js, keeps level arithmetic colocated with the panel that consumes it.
- **Rank-tier hex literals rather than CSS custom properties.** 54-RESEARCH Q5 + CLAUDE.md accept tier hexes as universal design constants. Gold/silver/bronze are effectively standardized across crypto UIs; unlikely to change by theme. Keeps Phase 54 self-contained; a future design-system phase can refactor if needed (T-54-16 accepted in threat model).
- **Score-unit warning comments in-source.** The Pitfall 8 table (integer-scale coinflip leaderboard vs wei-scale everything else) is replicated in the planning doc, Wave 0 test file as comment, and Wave 1 source file as header comment. Three-layer defense: a future editor reading any one of the three sees the warning.
- **Phase 50 stub test reconciled inline (not deferred).** play-panel-stubs.test.js originally blanket-asserted every panel subscribes to `replay.day`. Phase 54 correctly evolves baf-panel to replay.level (BAF is level-scoped, not day-scoped). Updating the Phase 50 test to branch by per-panel scope is Rule 1 deviation (the original assertion was factually wrong after the Phase 54 contract change); logged here in Deviations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 -- Phase 50 blanket-assertion conflict with Phase 54 semantic]**

- **Found during:** End-of-plan full test run after Task 3
- **Issue:** `play-panel-stubs.test.js` test `baf-panel.js subscribes to replay.day (day-awareness proof)` failed. The Phase 50 test file blanket-asserted every panel (including baf-panel) subscribes to `replay.day`. Phase 54 correctly evolves baf-panel to be level-scoped (`replay.level` + `replay.player`; no `replay.day`), because BAF is triggered at level multiples of 10 (not by daily cadence). Wave 0's `play-baf-panel.test.js` (line 97-101) explicitly asserts the level subscription, superseding the Phase 50 blanket assertion.
- **Fix:** Added per-panel `scope` field ('day' vs 'level') to PANEL_STUBS array in play-panel-stubs.test.js. Subscription assertion now branches by scope: day-scoped panels assert `replay.day` subscription; level-scoped panels (baf-panel) assert `replay.level` subscription. All 8 panels still covered; each validates against its actual Phase 54 subscription contract.
- **Files modified:** `play/app/__tests__/play-panel-stubs.test.js`
- **Commit:** `916ba44` (combined with Task 3 CSS append; single logical change bundled with the CSS work that revealed the test-state inconsistency)

### Deliberate plan extensions

- **CSS block larger than plan's ~130 LOC estimate.** Plan said `~130 LOC of Phase 54 additions`; actual append is 237 LOC. Discrepancy explained by verbatim inclusion of comment blocks, section headers, and the 4 rank-tier selectors (rank 1 through rank 4 as 4 separate blocks rather than compacted). `min_lines: 130` in plan frontmatter met and exceeded; content is exactly what 54-RESEARCH.md Section 9 lines 662-878 specified. No extra rules added beyond the verbatim copy.
- **Coinflip panel larger than plan's 220-260 estimate.** 305 LOC vs target midpoint 240. Discrepancy is pure comment-block thoroughness (header contains the Pitfall 8 warning table, data-flow diagram, and SECURITY/SHELL-01 notes). `min_lines: 220` met. All code sections match the template in the plan verbatim.
- **BAF panel larger than plan's 240-280 estimate.** 350 LOC vs target midpoint 260. Same explanation: header comment blocks + defensive render-helper logic (e.g., #renderYourRank handles the Wave 1 null case + the Wave 2 live-data case defensively). `min_lines: 240` met.

## Issues Encountered

One transient issue (the play-panel-stubs.test.js failure documented above). Auto-fixed inline per Rule 1 as part of Task 3's commit. No blocker encountered. No authentication gate. No architectural question raised.

## Test State

Full `play/app/__tests__/*.test.js` suite after Wave 1:

- **Total:** 288 tests (unchanged from Wave 0; no new test files)
- **Pass:** 288 (was 251 at Wave 0 close)
- **Fail:** 0 (was 37 RED assertions at Wave 0 close)

All Wave 0 RED assertions across `play-coinflip-panel.test.js` and `play-baf-panel.test.js` transitioned to GREEN:

- **play-coinflip-panel.test.js:** 28/28 passing (was 0/18 on RED markup + fetch assertions). Covers: existence, customElements.define, class extends HTMLElement, connectedCallback + disconnectedCallback, SHELL-01 negatives (4), wallet-free positives (3), subscribe to day + player, COINFLIP-01 data-binds (deposited/claimable/autorebuy/takeprofit), COINFLIP-02 fetch + leaderboard-entries, COINFLIP-03 bounty data-binds + data-armed, /player/${addr}?day= fetch, #coinflipFetchId, is-stale, skeleton + content + shimmer, empty-state length check, aria-current, formatBurnie, truncateAddress.
- **play-baf-panel.test.js:** 30/30 passing (was 0/19 on RED). Covers: existence, registration, class shell, SHELL-01 negatives (4) -- the three new Wave 0 FORBIDDEN entries honored, wallet-free positives (3), subscribe to level + player, BAF-02 fetch + leaderboard + data-rank, BAF-03 round-status + data-status + next-baf-level + levels-until, BAF-01 /player/:addr/baf?level= fetch + your-rank + your-rank-value + total-participants + your-score, data-prominence, #bafFetchId + #bafPlayerFetchId + is-stale, skeleton + content + shimmer, Math.ceil((level+1)/10) inline derivation, empty-state length check, aria-current, formatBurnie, truncateAddress.
- **play-shell-01.test.js:** 2/2 passing (unchanged). Recursive scan catches zero forbidden imports from the new panel implementations. The three new Wave 0 FORBIDDEN entries (beta/components/baf-panel.js, beta/app/coinflip.js, beta/app/baf.js) remain non-matching.
- **play-profile-panel.test.js:** unchanged, green. No Phase 51 regression.
- **play-tickets-panel.test.js:** unchanged, green. No Phase 52 regression.
- **play-jackpot-*.test.js + play-packs-panel.test.js + play-purchase-panel.test.js + play-main-bootstrap.test.js + play-route-structure.test.js:** all unchanged, green.
- **play-panel-stubs.test.js:** 79/79 passing (was 78/79 at Wave 0 + 1 transient failure after Task 2 before the reconciliation). Updated to branch day-vs-level scope per panel.

### Wave 2 Expected RED / Deferred Assertions

Per 54-RESEARCH.md Section 8 + INTEG-05-SPEC.md, two Wave 0 assertion themes were deliberately pre-wired as GREEN-when-fetch-emitted rather than GREEN-when-data-renders:

- **BAF-01 /player/:addr/baf?level= fetch URL presence:** GREEN in Wave 1 (the fetch is emitted; the 404 early-return keeps rendering silent).
- **BAF-01 your-rank / your-rank-value / total-participants / your-score data-binds:** GREEN in Wave 1 (all binds are in TEMPLATE; row stays `hidden` until INTEG-05 returns data).
- **BAF-03 round-status data-bind + data-status attribute:** GREEN in Wave 1 (pill renders; Wave 1 fallback populates data-status from level % 10 heuristic; Wave 2 replaces with authoritative INTEG-05 response).

These are grep-only assertions that Wave 1 satisfies by shipping the markup + fetch call. There is no behavioral assertion checking the rendered value of your-rank-value against a specific INTEG-05 response -- that would be a Wave 3 UAT assertion against live data.

## Score-Unit Discipline Audit (Pitfall 8)

Per 54-PATTERNS.md lines 1462-1477 + 54-RESEARCH.md Pitfall 8 (LOAD-BEARING):

| Location | Field | Unit | Render |
|---|---|---|---|
| coinflip-panel.js #renderLeaderboard | entry.score | INTEGER-scale BURNIE | String(entry.score ?? '0') |
| coinflip-panel.js #renderBounty | coinflip.currentBounty | WEI-scale BURNIE | formatBurnie |
| coinflip-panel.js #renderBounty | coinflip.biggestFlipAmount | WEI-scale BURNIE | formatBurnie |
| coinflip-panel.js #renderState | coinflip.depositedAmount | WEI-scale BURNIE | formatBurnie |
| coinflip-panel.js #renderState | coinflip.claimablePreview | WEI-scale BURNIE | formatBurnie |
| coinflip-panel.js #renderState | coinflip.autoRebuyStop | WEI-scale BURNIE | formatBurnie |
| baf-panel.js #renderLeaderboard | entry.score | WEI-scale BURNIE | formatBurnie(entry.score) |
| baf-panel.js #renderYourRank | data.score | WEI-scale BURNIE | formatBurnie(data.score) |

Audit result: **CLEAN.** The single integer-scale field (coinflip leaderboard entry.score) uses `String()`; every other BURNIE-denominated field uses `formatBurnie()`. No mixing. No wei-leaked-to-UI bugs. No integer-as-wei misinterpretation bugs.

## Self-Check: PASSED

Verified claims before proceeding:

- [x] `play/components/coinflip-panel.js` exists, 305 LOC (>= 220 min)
- [x] `play/components/baf-panel.js` exists, 350 LOC (>= 240 min)
- [x] `play/styles/play.css` exists, 1081 LOC (was 844; +237 LOC append >= 130 min)
- [x] customElements.define('coinflip-panel', ...) present -- 1 match
- [x] customElements.define('baf-panel', ...) present -- 1 match
- [x] #coinflipFetchId declared + 3 token checkpoints in coinflip-panel (7 matches total)
- [x] #bafFetchId + #bafPlayerFetchId declared + checkpoints in baf-panel (6 + 6 matches)
- [x] Math.ceil((level+1)/10) inline derivation in baf-panel (1 match)
- [x] Score-unit: String(entry.score in coinflip, formatBurnie in baf (2 + 7 matches)
- [x] data-rank attribute present in baf-panel (3 matches)
- [x] data-prominence attribute on panel element (3 matches)
- [x] aria-current for selected-player highlight (1 match per panel)
- [x] All SHELL-01 negatives hold: no beta/app/coinflip.js, no beta/app/baf.js, no beta/app/utils.js, no beta/components/baf-panel.js, no ethers imports
- [x] play.css section header "Phase 54 additions" present
- [x] Rank-tier hex literals #FFD700, #C0C0C0, #CD7F32 present
- [x] All 4 data-status states (open/closed/skipped/not_eligible) present
- [x] @keyframes armed-pulse present
- [x] is-stale dim class for both panels present
- [x] play.css braces balanced (grep count of `{` equals count of `}`)
- [x] No em dashes in any modified file (CLAUDE.md compliance)
- [x] Full play test suite: 288/288 passing (was 251/288 at Wave 0 close)
- [x] play-shell-01.test.js 2/2 passing (guardrail unbroken; 3 new FORBIDDEN entries still match zero play/ imports)
- [x] play-profile-panel.test.js unchanged, green (no Phase 51 regression)
- [x] play-tickets-panel.test.js unchanged, green (no Phase 52 regression)
- [x] Task 1 commit `e640556` exists in git log
- [x] Task 2 commit `2ee8393` exists in git log
- [x] Task 3 commit `916ba44` exists in git log

## Next Phase Readiness

**Wave 2 (Plan 54-03) is gated on database-repo side-quest.** Per INTEG-05-SPEC.md Timeline, 3 atomic commits on database/main are required: feat (handler + schema), docs (openapi), test (Vitest). Wave 1 has pre-wired every BAF-01-dependent render path with 404 tolerance, so Wave 2 is a surgical edit: remove the `if (!res.ok) { this.#renderRoundStatusFallback(level); return; }` short-circuit in baf-panel.js #refetchPlayer() and let the response flow through to #renderYourRank + #renderRoundStatus. Expected scope: ~10 LOC diff in baf-panel.js + a Wave 2 acceptance test that exercises the live-data path.

**Wave 3 (Plan 54-04) is optional UAT**, historically deferrable per Phase 50/51/52/53 precedent. The contract-grep test suite (288/288 GREEN post-Wave-1 + Wave-2 flips the remaining gated assertions) is sufficient for closing the phase if the user opts to defer UAT.

**Open side-quest for Phase 54 close:** Ship INTEG-05 in database repo (spec is authored in 54-01 as INTEG-05-SPEC.md). The spec is self-contained -- no need to re-read 54-RESEARCH.md when switching repos.

---
*Phase: 54-coinflip-baf*
*Plan: 02*
*Completed: 2026-04-24*
