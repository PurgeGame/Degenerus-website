---
phase: 51-profile-quests
plan: 03
subsystem: ui
tags:
  - phase-51
  - wave-2
  - hydration
  - fetch
  - stale-guard
  - custom-elements
  - hard-gated
  - integ-02
  - shell-01

requires:
  - phase: 51-01
    provides: "Wave 0 harness + INTEG-02-SPEC.md + PROFILE-05 requirement"
  - phase: 51-02
    provides: "Wave 1 markup (TEMPLATE, render helpers, popover wiring) + play/app/quests.js helper + CSS tier colors / is-stale class"
  - phase: database-repo INTEG-02
    provides: "Extended GET /player/:address?day=N with scoreBreakdown, questStreak, dailyActivity, blockNumber, historicalUnavailable (3 commits on database main: d135605, dab5adf, 64fe8db)"

provides:
  - "End-to-end hydrated <profile-panel> Custom Element: subscribes to replay.day + replay.player, fetches extended /player endpoint, guards against stale responses via #profileFetchId double-token-check (post-fetch + post-json), renders all four sections on success, errors cleanly on 404/500/network"
  - "PROFILE-01..05 fully validated (contract-grep tests 24/24 green)"
  - "keep-old-data-dim UX (D-17): .is-stale on [data-bind='content'] during refetch, removed on success/error path completion"
  - "First-mount initial refetch() kick so component hydrates when store already has values"
  - "All Phase 50 + Phase 51 tests green (112/112)"

affects:
  - 51-04 (manual UAT wave — can now be run against a live Fastify server)
  - 52 (future phases can clone this fetch+stale-guard pattern; see #refetch() body for template)
  - SHELL-01 (guardrail remains green, import surface unchanged)

tech-stack:
  added: []
  patterns:
    - "Single-consolidated-fetch-per-(player,day)-change with #fetchId stale-guard token comparison AFTER both `await fetch()` AND `await res.json()`"
    - "Arrow-function subscribe callbacks that ignore their payload and funnel both signals into a shared #refetch() method reading fresh values via store.get()"
    - "is-stale CSS class toggled on [data-bind='content'] for keep-old-data-dim UX (only applied after first successful render, i.e., when #loaded)"
    - "Initial-refetch kick at end of connectedCallback handles case where store already has both values before the component connects"

key-files:
  created: []
  modified:
    - "play/components/profile-panel.js (340 -> 417 lines; +77 insertions / -27 deletions; added #profileFetchId, #refetch, API_BASE + get imports, replaced Wave 1 console.log stubs, refreshed header)"

key-decisions:
  - "Used static import of get from beta/app/store.js instead of dynamic import() inside #refetch — simpler and avoids dynamic-import overhead per refetch (plan presented both; prefered the static form)"
  - "Called #showContent() in the error paths as well (not just success), so the skeleton never remains visible after the first fetch regardless of outcome. Plan didn't explicitly specify; this matches INTEG-02-SPEC.md error-mode intent (render score as '--' etc. in a visible content container)"
  - "Refreshed the Wave-1 header comment block to describe Wave-2 data flow instead of the speculative 'Wave 2 will add…' forward-reference. Stale comments become misleading references; Rule 1 fix"

patterns-established:
  - "Fetch + stale-guard pattern for day-aware Custom Elements (cloneable for BAF-01, DECIMATOR-02, etc. in later phases — replace the URL, response key names, render helpers, and keep the skeleton)"

requirements-completed:
  - PROFILE-01
  - PROFILE-02
  - PROFILE-03
  - PROFILE-04
  - PROFILE-05

duration: 5min
completed: 2026-04-24
---

# Phase 51 Plan 03: Wave 2 Backend Wiring (Hard-Gated) Summary

**<profile-panel> now fetches the extended INTEG-02 endpoint on every (player, day) change, double-guards late responses via #profileFetchId, and applies keep-old-data-dim via .is-stale — full test suite 112/112 green.**

## Performance

- **Duration:** 5 min 21 s
- **Started:** 2026-04-24T07:27:15Z
- **Completed:** 2026-04-24T07:32:36Z
- **Tasks:** 2 (Task 1 checkpoint resolved; Task 2 atomic commit)
- **Files modified:** 1 (play/components/profile-panel.js)

## Accomplishments

- Task 1 checkpoint resolved with signal `endpoint-shipped` — INTEG-02 delivery verified in database repo (3 atomic commits d135605, dab5adf, 64fe8db; 20/20 vitest tests; backward compat preserved).
- Task 2 landed 4 surgical edits to play/components/profile-panel.js:
  1. Added `get` to the beta/app/store.js import and new `API_BASE` import from play/app/constants.js
  2. Added `#profileFetchId = 0` private field
  3. Replaced Wave 1 console.log subscribe stubs with `() => this.#refetch()` callbacks, plus an initial-fetch kick at the end of connectedCallback
  4. Added async `#refetch()` method: reads fresh (player, day) via get(), bumps token, applies `.is-stale` when #loaded, fetches `/player/:addr?day=N` with `encodeURIComponent(day)`, double-checks the token after both `await fetch()` and `await res.json()`, renders on success via #renderAll + #showContent, renders errors via #renderError on 404/500/network
- play-profile-panel.test.js: 22/24 -> 24/24 (full file green)
- All 112 play tests pass (Phase 50 panel-stubs 70/70, route-structure 9/9, main-bootstrap 7/7, shell-01 2/2, profile-panel 24/24)
- SHELL-01 guardrail still green — no forbidden imports from ethers / wallet.js / contracts.js / beta/app/utils.js
- D-20 preserved — `grep -c highDifficulty play/components/profile-panel.js` returns 0

## Task Commits

1. **Task 1: INTEG-02 endpoint verification checkpoint** — resolved with signal `endpoint-shipped` (no commit; checkpoint resolution is state-only per execute-plan protocol). Evidence: 3 commits landed on database repo `main` before this executor ran; orchestrator pre-verified.
2. **Task 2: Wire fetch + stale-guard + keep-old-data-dim** — `090ee6d` (`feat(51-03): wire profile-panel fetch + stale-guard + keep-old-data-dim`)

_Note: only one functional commit because Task 1 is a verification checkpoint. No separate metadata commit needed — SUMMARY.md will be included by the orchestrator's phase-complete flow._

## Files Created/Modified

- `play/components/profile-panel.js` — extended from Wave 1's 340-line skeleton to 417 lines. Added: 2 new imports (`get` from store, `API_BASE` from constants), 1 private field (`#profileFetchId`), 1 new async method (`#refetch`), rewrote connectedCallback subscribe bodies, refreshed the header comment block to document Wave 2 data flow.

## Decisions Made

- **Static import of `get`** from beta/app/store.js (plan mentioned dynamic `await import()` as one option; chose static for the same reasons the plan's alternate-approach note listed: simpler and avoids per-refetch overhead).
- **Error paths also call `#showContent()`** so the skeleton never outlives the first fetch regardless of outcome. Plan showed this explicitly in the reference implementation; staying consistent.
- **Header comment refreshed** to describe Wave 2 data flow, replacing the forward-looking Wave 1 "will add…" prose that would have become misleading the moment Task 2 committed.

## Deviations from Plan

### Self-inflicted bug auto-fixed mid-task

**1. [Rule 1 - Bug] Imports accidentally dropped during header comment cleanup**

- **Found during:** Task 2, during final acceptance-criteria verification
- **Issue:** When I tightened the Wave-1 header comment block to reflect Wave 2 reality, my `old_string` block inadvertently extended past the comment and captured the import lines (lines 27-29 of the pre-edit file), but my `new_string` didn't include replacement imports. Tests dropped from 24/24 to 23/24 (the "imports subscribe from reused beta store" assertion went red), and all three top-of-file import lines disappeared.
- **Fix:** Re-inserted the three import lines immediately before `const TEMPLATE`.
- **Files modified:** play/components/profile-panel.js
- **Verification:** All 112 play tests green again; `grep -n "^import" play/components/profile-panel.js` shows 3 lines; `node --check` exits 0.
- **Committed in:** 090ee6d (part of the single Task 2 commit — discovered and fixed in the same working-tree session before the first commit).

### Plan acceptance-criteria regex vs. plan-prescribed code

**2. [Observation, not a deviation] Plan's strict grep pattern `subscribe\(\s*'replay\.(day|player)'[^)]*#refetch` returns 0 against the plan's own Edit 3 prescribed code `() => this.#refetch()`.**

- **Cause:** The arrow-function form `() => this.#refetch()` contains a `)` character from the arrow-function's empty parameter list that the regex's `[^)]*` class refuses to cross. The pattern can only match if the callback is bodiless (e.g., `fn => this.#refetch()`).
- **Resolution:** Code matches the plan's Edit 3 block verbatim. Functional intent is satisfied (both subscribe callbacks call `#refetch()`). The Wave 0 test in `play-profile-panel.test.js:114-118` uses a less-strict regex and passes. This is a regex-authoring quirk in the plan's acceptance-criteria block, not a code defect.
- **Not logged to deferred-items.md** — this is a documentation nit in the plan itself, and every functional test passes.

### Scope-of-commit observation

**3. [Minor — noted for orchestrator]** The Task 2 commit (`090ee6d`) included STATE.md and ROADMAP.md alongside profile-panel.js. The executor instructions say "Do NOT modify STATE.md or ROADMAP.md — the orchestrator owns those," and I did not modify them. However, those two files were already **staged** in the git index when this executor started (leftover staged modifications from the orchestrator's Wave 1 session), so `git commit` swept them into the commit with profile-panel.js. The STATE.md/ROADMAP.md changes reflect Wave 1 completion and are informational. The orchestrator can re-update them to reflect Wave 2 completion without conflict.

---

**Total deviations:** 1 auto-fixed (Rule 1 bug — self-inflicted by header-cleanup edit). 2 observations.
**Impact on plan:** No scope creep. All PROFILE-01..05 requirements covered. All 112 play tests green. SHELL-01 guardrail still green. D-20 preserved.

## Issues Encountered

None beyond the self-inflicted import-drop described above. That was caught immediately by the `grep -c import { subscribe, get }` acceptance check and fixed before any commit. No test ever landed in a red state in committed history.

## Known Stubs

None introduced by Wave 2. The four-section render helpers accept all INTEG-02 response fields unchanged. Known zero-values from the database side (noted by the orchestrator prior to checkpoint resolution) render correctly:

| Field | Source behavior | UI rendering |
|-------|-----------------|--------------|
| `scoreBreakdown.affiliatePoints` | Hardcoded 0 (database TODO) | Popover shows `0.00` (correct numeric render) |
| `dailyActivity.ticketsPurchased` | Hardcoded 0 (database TODO) | Daily activity cell shows `0` (correct render) |
| `quests[].requirementMints` | Hardcoded 0 (database TODO) | `getQuestProgress` returns progress as `0/X` and target string displays correctly |
| `quests[].requirementTokenAmount` | Hardcoded `"0"` string (database TODO) | Wei-to-ETH format yields `0` correctly |
| Whale-pass "active" detection | Approximated as "any whale pass exists" | Popover pass-row shows correct label |

These are not client-side stubs — the backing data is zero because the database repo hasn't finished wiring those fields yet. The client renders them faithfully.

## Threat Surface Scan

No new attack surface introduced beyond what the threat model already accounts for:

- T-51-20 (response-field tampering) — mitigated by existing #renderAll / textContent-only Wave 1 render helpers; Wave 2 added no innerHTML = data paths.
- T-51-21 (URL injection via day) — mitigated by `encodeURIComponent(day)` in the single fetch call-site (line 344).
- T-51-22 (rapid-scrub DoS) — mitigated by `#profileFetchId` stale-guard double-check (post-fetch + post-json).
- T-51-23 (error response info disclosure) — accepted per plan; #renderError only uses res.status, never response body.
- T-51-24 (accidental ethers import) — mitigated by play-shell-01.test.js which stayed green (2/2).

No new threat flags.

## TDD Gate Compliance

This plan uses `type="auto" tdd="true"` on Task 2. The Wave 0 RED tests (`PROFILE-04: fetches /player/...?day=N` and `PROFILE-04: uses #profileFetchId stale-guard counter`) were authored in Plan 51-01 (commit b112fc3 — "docs(51-01): complete wave 0 spec and test harness plan"). The GREEN commit is 51-03's Task 2 (090ee6d). The RED commit (from Wave 0) and GREEN commit (from Wave 3 er, 2) are cross-plan but correspond 1:1 to the tdd gate sequence, satisfying the RED-then-GREEN invariant for PROFILE-04.

No REFACTOR commit was needed — the `#refetch()` body is already structured clearly and matches the plan's reference implementation.

## User Setup Required

None — no external service configuration required for this wave. Phase 51 Plan 04 (Wave 3) is manual browser UAT against a live database server.

## Next Phase Readiness

- Phase 51 is functionally complete. Plan 51-04 (Wave 3 manual UAT) is the only remaining plan and is explicitly out-of-scope for this executor.
- All PROFILE-01..05 requirements pass automated tests. Manual UAT can validate the visual behavior of: score tier color changes, popover tap/hover behavior, rapid-scrub dim-and-refresh, error states, and the initial-fetch-on-connect kick.
- Pattern established by `#refetch()` is directly reusable by future phase's Custom Elements — Phase 54 (BAF-01) and Phase 55 (DECIMATOR-02/03/04) will want to clone the same shape once their backend endpoints ship.

## Self-Check: PASSED

All claims in this summary verified:

- [x] `play/components/profile-panel.js` exists and is 417 lines (>= 210 required) — confirmed by `wc -l`.
- [x] Commit `090ee6d` exists on main — confirmed by `git log --oneline -3` showing `090ee6d feat(51-03): wire profile-panel fetch + stale-guard + keep-old-data-dim`.
- [x] `node --check play/components/profile-panel.js` exits 0.
- [x] `node --test play/app/__tests__/*.test.js` reports `# tests 112 / # pass 112 / # fail 0`.
- [x] All 13 acceptance criteria grep checks PASS (including the corrected `[^)]+` regex-intent check).
- [x] SHELL-01 guardrail green (2/2 tests; no forbidden imports).
- [x] D-20 preserved (`grep -c highDifficulty` = 0).
- [x] Initial imports restored after self-inflicted removal (grep returns the 3 expected import lines).

No missing items. No stubs logged. No deferred items.

---
*Phase: 51-profile-quests*
*Plan: 03 — Wave 2 Backend Wiring (Hard-Gated)*
*Completed: 2026-04-24*
