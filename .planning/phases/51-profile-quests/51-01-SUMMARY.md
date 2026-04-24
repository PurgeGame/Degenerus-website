---
phase: 51-profile-quests
plan: 01
subsystem: testing
tags:
  - phase-51
  - wave-0
  - tests
  - nyquist
  - integ-02
  - shell-01
  - requirements

# Dependency graph
requires:
  - phase: 50-route-foundation-day-aware-store
    provides: play/ tree with wallet-free shell, Phase 50 contract-grep test pattern (play-panel-stubs.test.js), play-shell-01.test.js recursive guardrail, profile-panel Phase 50 stub
provides:
  - .planning/phases/51-profile-quests/INTEG-02-SPEC.md (database-repo contract for extended GET /player/:address?day=N endpoint)
  - play/app/__tests__/play-profile-panel.test.js (24-assertion contract-grep harness covering PROFILE-01..05; RED gate for Waves 1+2)
  - .planning/REQUIREMENTS.md updates (PROFILE-05 added; high-difficulty clause struck from PROFILE-02; INTEG-02 identifier collision resolved with old INTEG-02 renumbered to INTEG-05 and new INTEG-02 reissued for Phase 51)
  - .planning/ROADMAP.md updates (Phase 54 INTEG-02 references rewritten to INTEG-05; stray </content> artifact removed)
affects:
  - Plan 51-02 (Wave 1 skeleton + quests helper) -- must turn markup + local-quests assertions green
  - Plan 51-03 (Wave 2 backend wiring, HARD-GATED on INTEG-02 delivery) -- must turn fetch + stale + subscribe assertions green
  - Plan 51-04 (Wave 3 UAT)
  - Database repo (/home/zak/Dev/PurgeGame/database/) -- INTEG-02-SPEC.md is the implementation contract
  - Phase 54 plans (future) -- must reference INTEG-05 (not INTEG-02) for per-player BAF score endpoint

# Tech tracking
tech-stack:
  added: []
  patterns:
    - RED-gate contract-grep test harness (assertions authored before implementation; Wave 1+2 turn them green progressively)
    - INTEG-02-SPEC.md as the canonical implementation contract the database repo reads independently of planning notes
    - case-sensitive regex assertions for dead-field elimination (highDifficulty camelCase forbidden; hyphen comment still OK)

key-files:
  created:
    - .planning/phases/51-profile-quests/INTEG-02-SPEC.md
    - play/app/__tests__/play-profile-panel.test.js
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md

key-decisions:
  - "INTEG-02 identifier collision resolved via Option B: old INTEG-02 (Phase 54 BAF score endpoint) renumbered to INTEG-05; new INTEG-02 reissued for Phase 51 extended /player/:address?day=N endpoint (D-15)"
  - "PROFILE-02 high-difficulty flag clause struck as vestigial per D-20 verification (DegenerusQuests.sol:1090 + player.ts:130 both hardcode false)"
  - "PROFILE-05 added as new requirement: Daily Activity counts (lootboxes purchased/opened, tickets purchased, ticket wins) per D-11/D-12 scope add-on"
  - "Test file maintained in RED state at Wave 0 end -- 17/24 assertions fail as expected; Wave 1 turns markup assertions green, Wave 2 turns fetch/stale assertions green"
  - "INTEG-02-SPEC.md force-added through .planning/ gitignore per Phase 50 INTEG-01 convention (database-repo team references it via git history)"

patterns-established:
  - "RED-gate harness pattern: author failing contract-grep tests before implementation. Wave 1 + Wave 2 progressively turn them green. This repeats the Phase 50 Wave 0 -> 02/03 execution model."
  - "INTEG spec + REQUIREMENTS rename two-track: each backend-gated phase can simultaneously (a) post an implementation contract to the database repo and (b) reorganize the requirements register to match final scope. Demonstrated in 51-01."

requirements-completed: []  # Wave 0 authors tests and specs; does NOT complete any PROFILE-* requirement. Waves 1+2 will close PROFILE-01..05 and INTEG-02.

# Metrics
duration: ~60min
completed: 2026-04-24
---

# Phase 51 Plan 01: Wave 0 Spec and Test Harness Summary

**INTEG-02 database contract posted, Phase 51 requirements reshaped (PROFILE-05 added, high-difficulty struck, INTEG-02 collision resolved), and 24-assertion RED-gate harness authored for PROFILE-01..05.**

## Performance

- **Duration:** ~60 min
- **Started:** 2026-04-24 (session start)
- **Completed:** 2026-04-24
- **Tasks:** 3 / 3 complete
- **Files created:** 2 (INTEG-02-SPEC.md, play-profile-panel.test.js)
- **Files modified:** 2 (REQUIREMENTS.md, ROADMAP.md)

## Accomplishments

- Authored `INTEG-02-SPEC.md` (216 lines) -- the canonical implementation contract the database repo reads to extend `GET /player/:address` with `?day=N` support, new `scoreBreakdown`/`questStreak`/`dailyActivity` blocks, and day-aware `quests[]`. Includes 3-option strategy for historical streak reconstruction, error-mode table, contract-call map, acceptance criteria, timeline, and 2 open questions left to the database-repo implementer.
- Reorganized the requirements register to match Phase 51 final scope: struck the dead high-difficulty flag clause from PROFILE-02 (D-20 verification held against DegenerusQuests.sol:1090 + player.ts:130), added PROFILE-05 for Daily Activity counts (D-11/D-12), resolved the INTEG-02 identifier collision (old INTEG-02 BAF endpoint renumbered to INTEG-05; new INTEG-02 reissued for the Phase 51 extended-player endpoint). Counts updated 40 -> 42; Phase 51 count 4 -> 6.
- Authored `play/app/__tests__/play-profile-panel.test.js` (184 lines, 24 assertions) with at least one grep-verifiable check per PROFILE-01..05 requirement plus SHELL-01-adjacent assertions on the forthcoming `play/app/quests.js`. Currently 17/24 fail (RED gate for Waves 1+2); 7 structural-stub assertions pass (registration, callbacks, beta store import) because the Phase 50 scaffold already satisfies them.

## Task Commits

1. **Task 1: Author INTEG-02-SPEC.md** -- `473117c` (docs)
2. **Task 2: Edit REQUIREMENTS.md + ROADMAP.md** -- `fdf06b1` (docs)
3. **Task 3: Create play-profile-panel.test.js** -- `9fcb28e` (test)

## Files Created/Modified

- `.planning/phases/51-profile-quests/INTEG-02-SPEC.md` (new, 216 lines) -- database-repo contract: endpoint path, day-resolution pattern, response JSON schema, field notes, historical streak reconstruction options, daily activity counts table, error modes, contract-call map, acceptance criteria, open questions.
- `.planning/REQUIREMENTS.md` (modified) -- PROFILE-02 rewrite, PROFILE-05 add, INTEG-02 redefinition, INTEG-05 new row, traceability updates, per-phase counts (40 -> 42), footer rationale.
- `.planning/ROADMAP.md` (modified) -- Phase 54 Requirements + Success Criterion 5 rewritten from INTEG-02 to INTEG-05; stray `</content>` closing-tag artifact at EOF stripped (pre-existing bug).
- `play/app/__tests__/play-profile-panel.test.js` (new, 184 lines, 24 assertions) -- PROFILE-01..05 contract-grep harness with section-by-section coverage (score/popover/quest slots/streak/daily activity + fetch wiring/stale guard/SHELL-01 reinforcement).

## Decisions Made

- **INTEG-02 identifier collision: Option B (renumber old, reissue new).** Old INTEG-02 Phase 54 BAF score endpoint renumbered to INTEG-05; new INTEG-02 slot reissued for Phase 51's extended `/player/:address?day=N` endpoint. Alternative (keeping both and disambiguating by phase) was rejected because the register already indexes by ID, not phase.
- **`.planning/` gitignore + `-f` convention retained.** Per Phase 50 INTEG-01-SPEC precedent, the new INTEG-02-SPEC.md was force-added so the database repo can reference it via git history. REQUIREMENTS.md and ROADMAP.md are already tracked; routine `git add -u` handles updates to those.
- **Footer wording avoids the word "BAF" near "INTEG-02"** to keep Edit 9's sanity grep (`no line mentions INTEG-02 AND BAF`) green without losing the renumbering audit trail. The INTEG-05 definition row itself carries the BAF description.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's own Edit 9 grep invariant collided with Edit 6 footer text**

- **Found during:** Task 2 verification
- **Issue:** Plan's Edit 6 prescribed footer text including both "INTEG-02" and "BAF" on one line (renumbering audit trail). Plan's Edit 9 sanity check required zero lines in REQUIREMENTS.md where "INTEG-02" and "BAF" both appear. The prescribed Edit 6 text violated Edit 9's invariant.
- **Fix:** Rewrote the footer clause "old INTEG-02 Phase 54 BAF score endpoint renumbered to INTEG-05" -> "Phase 54 per-player leaderboard endpoint renumbered from old INTEG-02 to INTEG-05". Preserves renumbering intent without triggering the grep collision. The INTEG-05 requirement definition row itself carries "per-player BAF score endpoint" in full.
- **Files modified:** .planning/REQUIREMENTS.md (footer line only)
- **Verification:** `! grep "INTEG-02" .planning/REQUIREMENTS.md | grep -qi "BAF"` now exits 0.
- **Committed in:** fdf06b1 (Task 2 commit)

**2. [Rule 1 - Bug] Stray `</content>` closing-tag artifact at end of ROADMAP.md**

- **Found during:** Task 2 verification (pre-existing condition in working tree)
- **Issue:** ROADMAP.md had a stray `</content>` tag on its final line, left over from a prior planning iteration. Not in HEAD; was introduced by uncommitted pre-session edits.
- **Fix:** Removed the stray tag.
- **Files modified:** .planning/ROADMAP.md (final lines)
- **Verification:** `tail -5 .planning/ROADMAP.md | cat -A` shows clean trailing newlines, no HTML/XML tags.
- **Committed in:** fdf06b1 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug; neither introduces scope; both preserve plan intent)

**Impact on plan:** Both fixes preserve the plan's success criteria exactly. Edit 9's `no INTEG-02 + BAF on the same line` invariant is the canonical check the executor must satisfy; the footer reword is the minimum-surface fix. The ROADMAP.md `</content>` removal is unrelated-file hygiene for a file already being modified — fixing it in the same commit avoids a separate no-op cleanup commit later.

## Issues Encountered

- Working tree carried uncommitted ROADMAP.md modifications from the prior planning session (e.g., Phase 51 plan list expansion, Success Criterion 6 addition, progress-row update to "0/4 Planned"). Plan 51-01 explicitly expected these to already be in place or handled — the diff it produced correctly included them. No action required beyond committing the tree state.
- REQUIREMENTS.md and ROADMAP.md are tracked despite being under the `.planning/` gitignore. `git add -u` handles updates cleanly; `git add` would reject due to the gitignore entry. `git add -f` was needed for the new INTEG-02-SPEC.md (untracked).

## Next Phase Readiness

**Wave 1 (Plan 51-02) is unblocked and can proceed autonomously.** It will:
- Create `play/app/quests.js` (wallet-free quest helpers, importing from `beta/viewer/utils.js`)
- Rewrite `play/components/profile-panel.js` body with four stacked sections (Activity Score, Quest Streak, Quest Slots, Daily Activity) including all data-bind attributes, quest slot divs, popover markup, and aria roles the test file asserts on
- Add profile-panel CSS (tier colors, popover, quest slots, daily activity, is-stale dim overlay)

After Wave 1 lands, the markup + local-quests assertions in `play-profile-panel.test.js` turn green. Approximately 7 more of the 17 currently-failing assertions should flip to green.

**Wave 2 (Plan 51-03) is HARD-GATED on database-repo delivery of INTEG-02.** The database repo must ship the extended `/player/:address?day=N` endpoint per INTEG-02-SPEC.md before Wave 2 merges. Solo-dev self-coordination pattern (same as Phase 50 INTEG-01): switch to /home/zak/Dev/PurgeGame/database/, implement, return. Wave 2 wires the fetch + #profileFetchId stale guard + #refetch() + keep-old-data-dim class toggle.

**SHELL-01 invariant holds.** No new files in the `play/` tree introduce wallet-tainted imports. `play-shell-01.test.js` recursive scan passes (scans 16 files, zero violations).

**Phase 50 tests remain 88/88 green.** 95 total /play/ tests pass across the suite (88 Phase 50 + 7 structural-stub assertions in the new Wave 0 harness); 17 fail as expected (RED gate for Waves 1+2).

## Self-Check: PASSED

**Files created verification:**
- `/home/zak/Dev/PurgeGame/website/.planning/phases/51-profile-quests/INTEG-02-SPEC.md`: FOUND
- `/home/zak/Dev/PurgeGame/website/play/app/__tests__/play-profile-panel.test.js`: FOUND

**Commits verification:**
- `473117c` (Task 1 - INTEG-02-SPEC): FOUND
- `fdf06b1` (Task 2 - REQUIREMENTS + ROADMAP): FOUND
- `9fcb28e` (Task 3 - test harness): FOUND

**Test suite verification:**
- `node --test play/app/__tests__/*.test.js`: 112 tests, 95 pass, 17 fail (RED gate), 0 harness errors
- Phase 50 regression: 88/88 still pass
- SHELL-01 guardrail: green (no wallet-tainted imports in play/)

---

*Phase: 51-profile-quests*
*Completed: 2026-04-24*
