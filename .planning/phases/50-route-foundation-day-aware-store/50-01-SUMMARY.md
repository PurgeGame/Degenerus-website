---
phase: 50
plan: 01
subsystem: wave-0-test-harness
tags:
  - phase-50
  - wave-0
  - tests
  - nyquist
  - integ-01
status: checkpoint
completed: 2026-04-23
requires: []
provides:
  - play/app/__tests__/play-route-structure.test.js
  - play/app/__tests__/play-panel-stubs.test.js
  - play/app/__tests__/play-main-bootstrap.test.js
  - play/app/__tests__/play-shell-01.test.js
  - .planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md
affects:
  - Plan 50-02 (route scaffold) -- must turn play-route-structure + play-main-bootstrap green
  - Plan 50-03 (custom elements) -- must turn play-panel-stubs green
  - Phase 52 (tickets/packs) -- gated on database team delivering INTEG-01 endpoint
tech-stack:
  added:
    - node:test (built-in, no dependency install) as Wave 0 test runner for play/
  patterns:
    - contract-grep tests (readFileSync + regex asserts; same pattern as beta/app/__tests__)
    - recursive SHELL-01 guardrail via readdirSync({ recursive: true })
key-files:
  created:
    - play/app/__tests__/play-route-structure.test.js
    - play/app/__tests__/play-panel-stubs.test.js
    - play/app/__tests__/play-main-bootstrap.test.js
    - play/app/__tests__/play-shell-01.test.js
    - .planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md
  modified: []
decisions:
  - Wave 0 tests fail loudly with ENOENT ("missing fixture") rather than harness errors, matching Nyquist pattern
  - SHELL-01 guardrail uses a skip-if-play-missing wrapper so the file loads cleanly before Plan 02 creates play/
  - INTEG-01 spec is force-added through .planning/ gitignore (repo convention gitignores .planning/ as working notes, but this spec must be versioned so the database team can reference it via git history)
metrics:
  duration_minutes: 5
  tasks_completed: 2_of_3
  files_created: 5
---

# Phase 50 Plan 01: Wave 0 Tests and INTEG-01 Spec Summary

Contract-grep test harness plus INTEG-01 coordination spec. Every Phase 50 requirement now has a failing automated test that Plans 02 and 03 must turn green.

## Status

**Checkpoint reached at Task 3.** Tasks 1 and 2 complete and committed. Task 3 requires external coordination (posting the INTEG-01 spec to the database team) -- awaiting user action.

## What Was Built

### Task 1: Wave 0 test harness (commit 9ceaba3)

Four `node:test`-compatible test files under `play/app/__tests__/`:

| File | Requirements Covered | Key Assertions |
|------|---------------------|----------------|
| `play-route-structure.test.js` | ROUTE-01, ROUTE-03, ROUTE-04, DAY-04 | play/index.html exists; importmap omits ethers, pins gsap@3.14; no `<connect-prompt>`; all 7 panel tags + `<player-selector>` + `<day-scrubber>` present; `skeleton-shimmer` class used; scrubber wrapped in `class="dev-tool"` container |
| `play-panel-stubs.test.js` | ROUTE-02, DAY-01, 7 panel stubs | Each of the 7 panel files + player-selector + day-scrubber exists; `customElements.define(...)` + `extends HTMLElement` + `connectedCallback` + `disconnectedCallback` + `skeleton-shimmer` in template; subscribes to `replay.day` AND `replay.player` from reused beta store (`../../beta/app/store.js`); player-selector exports `initPlayerSelector`, fetches `/replay/players`, reads `player-archetypes.json`; day-scrubber imports `createScrubber` from `beta/viewer/scrubber.js` |
| `play-main-bootstrap.test.js` | DAY-02, DAY-03 | main.js imports `update` from beta store; calls `update('replay.day', ...)` AND `update('replay.player', ...)`; fetches `/replay/rng`; filters `finalWord !== '0'`; imports no ethers, wallet, contracts, or ethers-tainted utils |
| `play-shell-01.test.js` | SHELL-01 (guardrail) | Recursive walk of `play/` tree (excluding `play/app/__tests__/`); fails if any `.js` or `.html` file imports from ethers, `beta/app/wallet.js`, `beta/app/contracts.js`, `beta/app/utils.js` (ethers-tainted at line 3), or the four wallet-dependent beta components. Skips cleanly when `play/` doesn't exist yet. |

**Total:** 369 insertions across 4 files.

Test-run behavior today (before Plans 02/03 ship fixtures):
- `node --check` on each file exits 0 (syntax valid).
- `node --test play/app/__tests__/*.test.js` runs 88 subtests: 2 pass (SHELL-01 guardrails skip cleanly because play/ files don't exist yet), 86 fail with `ENOENT: no such file or directory` on play/index.html, play/app/main.js, play/components/*.js. All failures are "missing fixture" shape (the contract the plan specifies), not harness errors.

### Task 2: INTEG-01 contract spec (commit 4f83915)

`.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md` (123 lines).

Contents: why the endpoint is needed, endpoint signature (`GET /player/:address/tickets/by-trait?level=N&day=M`), path + query params, full JSON response schema with 3 example cards (opened/pending/partial), card status enum, source enum (purchase, jackpot-win, lootbox), server-side grouping logic proposal, related existing endpoints, acceptance criteria, timeline, confidence notes.

The spec text is verbatim from 50-RESEARCH.md section 7 with a standard header added, preserving the database team's ability to reference a single-file source of truth.

### Task 3: Post INTEG-01 spec to database team

**BLOCKED: awaiting user to post spec externally** (see Checkpoint section below).

## Deviations from Plan

### Rule 2 (correctness) -- force-add through .gitignore

Found during: Task 2 commit.

Issue: `.gitignore` line 6 ignores `.planning/` entirely. `git add` refused the spec file.

Fix: Used `git add -f` to force the single spec file past the ignore rule, without touching the ignore pattern itself. Existing tracked `.planning/` files (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, previous phase SUMMARY.md files) show that this is the repo's established pattern: ignore the directory by default, force-add individual artifacts that need to live in git history.

Justification: The INTEG-01 spec is a durable deliverable the database team references across phases. It must be git-versioned, not just a working note.

Files modified: `.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md` committed with `-f`.

Commit: 4f83915.

No other deviations. No Rule 1 bugs, no Rule 3 blockers, no Rule 4 architectural changes.

## Checkpoint: Task 3 -- Post INTEG-01 Spec

**Type:** human-action (external coordination)
**What Claude built:** `INTEG-01-SPEC.md` is committed at `.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md` (4f83915). Content is ready to copy into an issue or chat message.
**What user must do (per plan Task 3 how-to-verify):**
1. Open the database repo (path `/home/zak/Dev/PurgeGame/database/`).
2. Either (a) open a GitHub issue titled "INTEG-01: GET /player/:address/tickets/by-trait spec" with a link to the spec file in this repo, OR (b) paste the spec file contents into the team's Slack/Discord and ask for acknowledgment, OR (c) both (recommended).
3. After posting, edit the first lines of `INTEG-01-SPEC.md` to replace the `**Posted:** [fill in ...]` placeholder with the actual timestamp and venue, e.g. `**Posted:** 2026-04-23 14:30 UTC -- GitHub issue #47 in degenerus-database`.
4. If the spec receives immediate feedback, record it in a `## Feedback` section appended to the spec file.

**Resume signal:** type `posted` (and optionally paste the issue URL) or `deferred -- <reason>` if coordination has to wait.

## Commits

| Hash | Message | Files |
|------|---------|-------|
| 9ceaba3 | `test(50-01): add Wave 0 contract-grep test harness` | 4 test files, 369 insertions |
| 4f83915 | `docs(50-01): add INTEG-01 contract spec for ticket-by-trait endpoint` | INTEG-01-SPEC.md, 123 insertions |

## Verification Commands

Orchestrator / verifier can re-run any of these to sanity-check:

```bash
# Four test files exist
ls -la play/app/__tests__/
# -> 4 files: play-route-structure.test.js, play-panel-stubs.test.js,
#    play-main-bootstrap.test.js, play-shell-01.test.js

# Each parses cleanly
for f in play/app/__tests__/*.test.js; do node --check "$f" && echo "OK: $f"; done

# Tests run (expect fail count ~86, pass count 2 -- SHELL-01 skip path hits)
node --test play/app/__tests__/*.test.js 2>&1 | tail -10

# INTEG-01 spec exists and is substantive
test -f .planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md
wc -l .planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md
grep -c "GET /player/:address/tickets/by-trait" .planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md

# Commits present
git log --oneline -3 | grep -E "50-01" | wc -l
# -> 2
```

## Self-Check: PASSED

- [x] `play/app/__tests__/play-route-structure.test.js` exists (verified: `test -f`)
- [x] `play/app/__tests__/play-panel-stubs.test.js` exists (verified: `test -f`)
- [x] `play/app/__tests__/play-main-bootstrap.test.js` exists (verified: `test -f`)
- [x] `play/app/__tests__/play-shell-01.test.js` exists (verified: `test -f`)
- [x] `.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md` exists (verified: `test -f`, 123 lines >= 80)
- [x] Commit 9ceaba3 exists in git log (verified: `git log --oneline`)
- [x] Commit 4f83915 exists in git log (verified: `git log --oneline`)
- [x] No modifications to STATE.md, ROADMAP.md, or unrelated files in either commit (verified: `git show --stat HEAD~1` and `git show --stat HEAD`)
- [x] Pre-existing dirty working tree untouched (verified: `git status --short` shows same pre-existing modifications as at start)
- [x] No stubs introduced (Wave 0 is tests + spec doc; no UI code to stub)

All Task 1 acceptance criteria checked:
- [x] 4 test files present
- [x] All 4 pass `node --check` (syntax valid)
- [x] `node --test` runs all 4 without harness errors (exit code not 8/9)
- [x] `grep customElements\.define play-panel-stubs.test.js` matches
- [x] `grep replay\.day play-main-bootstrap.test.js` matches
- [x] `grep finalWord play-main-bootstrap.test.js` matches
- [x] `grep ethers|wallet\.js|contracts\.js play-shell-01.test.js` matches
- [x] `grep dev-tool play-route-structure.test.js` matches (DAY-04)
- [x] `grep skeleton-shimmer play-route-structure.test.js` matches (ROUTE-04)

All Task 2 acceptance criteria checked:
- [x] Spec file exists at expected path
- [x] 123 lines (>= 80)
- [x] 3 occurrences of `GET /player/:address/tickets/by-trait` (>= 2)
- [x] 7 `## ` section headers (>= 6)
- [x] Source enum has purchase, jackpot-win, lootbox (>= 3 unique)
- [x] Status enum has opened, pending, partial (>= 3 unique)
- [x] 19 mentions of entryId / traitId / traitLabel (>= 9)
