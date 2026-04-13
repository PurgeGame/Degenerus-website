---
phase: 19
plan: 02
subsystem: jackpot-validation
tags: [jackpot, validation, roll1, roll2, aggregation, idempotent-discrepancy]
requires:
  - harness (append_discrepancy, load_discrepancies, Citation, Derivation, Discrepancy, Hypothesis, SampleContext, HealthSnapshot)
  - validations.jackpot (EndpointClient from 19-01)
provides:
  - validations.jackpot.aggregation.reconcile_player_totals
  - validations.jackpot.aggregation.day_level_eth_sum
  - validations.jackpot.aggregation.ReconcileIssue / ReconcileResult
  - validations.jackpot.jackpot_02.validate_jackpot_02
  - validations.jackpot.jackpot_03.validate_jackpot_03
  - validations.jackpot.jackpot_03.ensure_source_level_bound_discrepancy_logged
  - validations.jackpot.jackpot_03.CARRYOVER_MAX_OFFSET (==4)
  - validations.jackpot.jackpot_03.SOURCE_LEVEL_BOUND_ID
  - python -m validations.jackpot --jackpot-02 / --jackpot-03 (RUN_LIVE_VALIDATION=1-gated)
affects:
  - .planning/v2.3/validations/jackpot/__main__.py (added --jackpot-02 / --jackpot-03 flags)
tech-stack:
  added: []
  patterns:
    - load-filter-append idempotency (one-shot source-level Discrepancy)
    - fill-then-reconcile (winners.totalEth vs sum(roll1+roll2 ETH))
    - severity downgrade on lag_unreliable (Critical->Major, Major->Minor, Info unchanged)
key-files:
  created:
    - .planning/v2.3/validations/jackpot/aggregation.py
    - .planning/v2.3/validations/jackpot/jackpot_02.py
    - .planning/v2.3/validations/jackpot/jackpot_03.py
    - .planning/v2.3/validations/tests/test_jackpot_02.py
    - .planning/v2.3/validations/tests/test_jackpot_03.py
    - .planning/v2.3/validations/tests/fixtures/api/day-5-roll1.json
    - .planning/v2.3/validations/tests/fixtures/api/day-5-roll2.json
    - .planning/v2.3/validations/tests/fixtures/api/day-50-roll1.json
    - .planning/v2.3/validations/tests/fixtures/api/day-50-roll2.json
    - .planning/v2.3/validations/tests/fixtures/api/day-762-roll1.json
    - .planning/v2.3/validations/tests/fixtures/api/day-762-roll2-404.json
  modified:
    - .planning/v2.3/validations/jackpot/__main__.py
decisions:
  - "CARRYOVER_MAX_OFFSET=4 is contract-canonical (JackpotModule.sol:167); REQUIREMENTS.md '+3' is the doc-side drift. Logged as Minor gt_paper Discrepancy, NOT a contract fix."
  - "Roll 2 404 (e.g. day 762) is Info/coverage-gap, not a Major violation — CONTEXT Decision 2 treats N/A distinctly from wrong-data."
  - "whale_pass and dgnrs awardTypes carry amount=1 as quantity, NOT wei — excluded from ETH aggregation."
  - "Virtual deity entries (ticketIndex == 2^256-1) are excluded from ETH sums; emit Info note rather than silently ignore."
  - "Fixtures live under tests/fixtures/api/ (matching 19-01 fixtures_io.load_fixture root); plan's bare tests/fixtures/ path was inconsistent with the loader — followed loader per Rule 3."
metrics:
  duration: ~45 minutes
  completed: 2026-04-13
  commits: 2
  tests_added: 17   # 9 in test_jackpot_02 + 8 in test_jackpot_03
---

# Phase 19 Plan 02: JACKPOT-02 / JACKPOT-03 Validators Summary

**One-liner:** Roll 1 classification + per-player exact-wei aggregation (JACKPOT-02), Roll 2 near/far classification against contract bound `purchaseLevel + 4` (JACKPOT-03), and a one-shot idempotent source-level Discrepancy recording the REQUIREMENTS.md '+3' vs contract '+4' drift.

## What shipped

### aggregation.py

`reconcile_player_totals(winners_payload, roll1, roll2) -> ReconcileResult`:

- Sums per-address ETH across `roll1.wins` + `roll2.wins` (awardType=="eth" only).
- Excludes `whale_pass` / `dgnrs` (amount=1 is quantity, not wei).
- Excludes deity virtual entries (`ticketIndex == 2**256 - 1`) and records addresses seen for caller-side Info note.
- Tracks `null_source_level_count` for callers to surface as coverage-gap notes.
- Produces `ReconcileIssue(kind="mismatch"|"missing_address", ...)` for exact-wei comparison against `winners[].totalEth`.
- Sanity bound: rejects payloads with > 100k wins (T-19-02-02 DoS guard).

### jackpot_02.py (Roll 1 + aggregation)

1. Fetch `/roll1`. Fetch errors → Major (Minor on lag).
2. `purchaseLevel is None` → Info coverage gap, early return (post-gameover days like 762).
3. Classification: for each ETH win with `sourceLevel is not None`, require `sourceLevel == purchaseLevel`; any deviation → Major (Minor on lag).
4. Aggregation: Major→Critical for per-player wei mismatch (downgraded one tier on lag).
5. Sentinel ticketIndex → Info note (never a violation).
6. Null sourceLevel rows → Info coverage gap (the indexer currently returns `sourceLevel: null` for every Roll 1 row on probed days — this is the dominant real-world outcome).

### jackpot_03.py (Roll 2 near/far + one-shot source-level entry)

- Classification rules:
  - `sourceLevel <= purchaseLevel` → Major violation
  - `purchaseLevel < sourceLevel <= purchaseLevel + 4` → near-future (pass)
  - `sourceLevel > purchaseLevel + 4` → far-future (pass)
- `None` return from EndpointClient (404) → Info coverage gap with hypothesis "no carryover distributions — compressed/turbo day or post-gameover".
- `ensure_source_level_bound_discrepancy_logged(yaml_path)`:
  - Uses `load_discrepancies` → filter by `id == "JACKPOT-03-source-doc-bound-mismatch"` → skip if present.
  - Entry is Minor / suspected_source=`gt_paper` / cites JackpotModule.sol:167.
  - Returns True on append, False on idempotent skip (unit-tested both branches).

### __main__.py

- Added `--jackpot-02` / `--jackpot-03` flags with matching `_run_validator` driver.
- `--jackpot-03` calls `ensure_source_level_bound_discrepancy_logged` before the day loop.
- `--all` now runs 01+02+03.

## Live-probe observations (2026-04-13)

Probed against `http://localhost:3000`:

| Day | Level | purchaseLevel | roll1 wins | roll2 wins | notes |
|-----|-------|---------------|------------|------------|-------|
| 5   | 5     | 4             | 70 (eth+dgnrs+whale_pass) | 60 (burnie only) | totalEth reconciles exactly |
| 50  | 50    | 49            | 57 | 60 (burnie only) | matches |
| 762 | 111   | null          | 194 (eth only) | 404 | post-gameover; Roll 2 absent by design |

Dominant real-world finding: **the indexer returns `sourceLevel: null` for 100% of wins on probed days** (0 non-null among 380+ rows inspected). This is treated as Info coverage-gap per validator design — not a classification violation. The validator logic correctly distinguishes null (can't classify) from non-null-and-wrong (violation).

## Source-level Discrepancy

`JACKPOT-03-source-doc-bound-mismatch` (Minor, gt_paper): REQUIREMENTS.md text reads "+3" but `JackpotModule.sol:167` declares `DAILY_CARRYOVER_MAX_OFFSET = 4`. Contract is canonical per CONTEXT Decision 4. Validator uses +4; the entry records the drift for the documentation fix milestone. Idempotent re-runs leave exactly one entry.

## Deviations from Plan

### Rule 3 (blocking)

**Fixture directory layout:** Plan's `files_created` listed bare `tests/fixtures/day-*.json`, but `fixtures_io.load_fixture` resolves to `tests/fixtures/api/` (set by 19-01 and guarded by regex). Placed fixtures under `tests/fixtures/api/` so the existing loader finds them without modification. Mentioned in decisions above.

### Rule 2 (critical addition)

**Null sourceLevel coverage note:** Plan spec accepted `sourceLevel is None` entries silently by "skipping from classification". But per CONTEXT Decision 2 and ROADMAP Success Criterion #1, gaps must be documented. Added explicit Info-severity `JACKPOT-02-day{N}-roll1-null-sourcelevel` / `JACKPOT-03-day{N}-roll2-null-sourcelevel` entries emitted when null rows exist, so the audit trail is never silent.

## Deferred Items

1. Live-run of `RUN_LIVE_VALIDATION=1 python -m validations.jackpot --jackpot-03` twice to confirm disk idempotency end-to-end. Unit test covers isolated YAML; phase-gate CI run will cover the canonical `.planning/v2.3/discrepancies.yaml` path.
2. Records for days where `sourceLevel` is populated (if any). Current sample shows pervasive null; 19-04 should probe whether the indexer back-fills sourceLevel later or never.
3. BURNIE ETH-equivalent reconciliation: `roll2` on days 5/50 contains only `burnie` wins. Aggregation currently does NOT add BURNIE ETH-equivalent (no price-of-BURNIE oracle in scope); this is per plan — JACKPOT-04 (Plan 19-03) owns BURNIE totals.

## Known Stubs

None. All exports are wired to working implementations. No placeholder values or hardcoded empties.

## Threat Flags

None beyond those enumerated in the plan's threat_model (mitigated: T-19-02-01 through T-19-02-05).

## Self-Check: PASSED

- FOUND: .planning/v2.3/validations/jackpot/aggregation.py
- FOUND: .planning/v2.3/validations/jackpot/jackpot_02.py
- FOUND: .planning/v2.3/validations/jackpot/jackpot_03.py
- FOUND: .planning/v2.3/validations/tests/test_jackpot_02.py (9 tests passing)
- FOUND: .planning/v2.3/validations/tests/test_jackpot_03.py (8 tests passing)
- FOUND: .planning/v2.3/validations/tests/fixtures/api/day-{5,50,762}-roll{1,2}*.json
- FOUND: commit f8ad738 (Task 1 — JACKPOT-02 + aggregation)
- FOUND: commit a3fd1ae (Task 2 — JACKPOT-03 + idempotent source-level entry)
- Full suite: 145 passed (Phase 18 harness + Phase 19 validators)
- Citation hygiene: grep for `testing/contracts\|degenerus-contracts` in .planning/v2.3/validations/ → no live references

## Commits

- `f8ad738` — feat(19-02): JACKPOT-02 validator + aggregation helper (Roll 1)
- `a3fd1ae` — feat(19-02): JACKPOT-03 Roll 2 near/far + idempotent +4 vs +3 entry
