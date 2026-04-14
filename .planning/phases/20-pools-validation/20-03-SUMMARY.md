---
phase: 20
plan: 03
subsystem: pools-validation
tags: [pools, validation, yield, accumulator, price-curve, coverage-gap, source-drift, tdd]
requires:
  - validations.pools package (from 20-01 + 20-02)
  - validations.pools.price_curve.price_for_level
  - harness public surface (Discrepancy, Citation, Derivation, Hypothesis, SampleContext, HealthSnapshot, append_discrepancy, load_discrepancies)
provides:
  - validate_pools_05 (yield coverage-gap + stEth-nonzero sim-drift proxy)
  - validate_pools_06 (accumulator coverage-gap)
  - validate_pools_07 (static-price conformance + source-drift one-shot)
  - ensure_pools_05_coverage_gap_logged
  - ensure_pools_06_coverage_gap_logged
  - ensure_pools_07_source_drift_logged
  - __main__ flags --pools-05 / --pools-06 / --pools-07; --all orchestrates 01..07
affects:
  - .planning/v2.3/discrepancies.yaml (3 new idempotent fixed IDs on live run)
  - .planning/v2.3/validations/pools/__main__.py (flag expansion)
  - .planning/v2.3/validations/pools/source_level_entries.py (3 new writers)
tech-stack:
  patterns:
    - load_discrepancies -> filter by id -> skip-or-append idempotency
    - Severity downgrade under lag_unreliable (Major -> Minor)
    - String equality "0" for stEthReserve drift gate (T-20-03-06)
    - suspected_source="api" for doc-vs-contract drift (mirrors Phase 19 + Plan 20-02)
key-files:
  created:
    - .planning/v2.3/validations/pools/pools_05.py
    - .planning/v2.3/validations/pools/pools_06.py
    - .planning/v2.3/validations/pools/pools_07.py
    - .planning/v2.3/validations/tests/test_pools_05.py
    - .planning/v2.3/validations/tests/test_pools_06.py
    - .planning/v2.3/validations/tests/test_pools_07.py
    - .planning/v2.3/validations/tests/fixtures/api/game-state-mid-run.json
  modified:
    - .planning/v2.3/validations/pools/source_level_entries.py
    - .planning/v2.3/validations/pools/__main__.py
decisions:
  - POOLS-05 optional sim-drift signal emitted only when stEthReserve != "0" (string equality); current sim has "0" so validator returns [] in production — per threat T-20-03-06.
  - POOLS-06 has no proxy signal (unlike POOLS-05) so validator is a pure coverage-gap writer returning [].
  - POOLS-07 static-price conformance: exact == check; pass returns [] (no YAML noise per-day); mismatch Major, Minor under lag.
  - Added defensive guards for malformed price (non-int string) and out-of-range level (T-20-03-01, T-20-03-03) emitting Info skips rather than raising.
  - POOLS-07 source-drift uses suspected_source="api" consistent with Phase 19 JACKPOT-03 + Plan 20-02 POOLS-03 pattern; audited constants cite PriceLookupLib.sol:7 and :47.
metrics:
  duration: ~15m
  tasks: 2
  files_created: 7
  files_modified: 2
  commits: 2
  tests_added: 15
  tests_total: 155
completed: 2026-04-13
---

# Phase 20 Plan 03: POOLS-05 / POOLS-06 / POOLS-07 Coverage + Conformance Summary

Closed Phase 20 by delivering the three unobservable-or-narrow requirements: stETH yield (unobservable) and segregated accumulator (unobservable) become idempotent coverage-gap Info entries with surgical unblock hypotheses, while POOLS-07 lands a real static-price conformance validator plus a source-drift entry for the REQUIREMENTS.md turbo phrasing. `--all` now orchestrates all 7 POOLS validators.

## YAML Entries Landed (Idempotent Fixed IDs)

Three new load -> filter -> skip-or-append writers:

- `POOLS-05-coverage-gap-yield-unindexed` (Info) — cites `JackpotModule.sol:737` (`distributeYieldSurplus`). Two-stage blocker: indexer (no yieldAccumulator schema/routes) AND sim (runs without stETH). Unblock: `yield_accumulator_snapshots(day, balance)` table + `/history/yield/day/:day` route AND sim re-seed with non-zero stETH.
- `POOLS-06-coverage-gap-accumulator-unindexed` (Info) — cites `AdvanceModule.sol:129` (`INSURANCE_SKIM_BPS=100`), `:722` (`YIELD_ACCUMULATOR_X00_DUMP_BPS=5000`), `:716` (skim apply site). Unblock: `accumulator_snapshots(day, level, balance, skim_delta, dump_delta)` + `/history/accumulator` + `/history/accumulator/level/:level` routes + `InsuranceSkimApplied` / `AccumulatorX00Dump` events.
- `POOLS-07-source-doc-turbo-drift` (Minor) — cites `PriceLookupLib.sol:7` and `:47`. REQUIREMENTS.md:35 references "100K ticket target" and "fractional credit accumulation" — turbo-spec mechanics absent from audit contracts (audit canonical is the static per-level table). `suspected_source="api"` per Phase 19 / Plan 20-02 precedent.

## POOLS-05 Validator Behavior

`validate_pools_05(client, *, lag_snapshot, yaml_path)`:
1. `ensure_pools_05_coverage_gap_logged` (idempotent).
2. Fetches `/tokens/analytics`. If `stEthReserve == "0"` (string equality) -> returns `[]` (expected sim state).
3. If `stEthReserve != "0"` -> returns one `POOLS-05-sim-config-stEth-nonzero` Info entry flagging sim-config drift for revisit.
4. Exception from endpoint -> returns `[]` (defensive — coverage-gap already written).

## POOLS-06 Validator Behavior

`validate_pools_06(client, *, lag_snapshot, yaml_path)`:
1. `ensure_pools_06_coverage_gap_logged` (idempotent).
2. Returns `[]`. No proxy signal is available.

## POOLS-07 Validator Behavior

`validate_pools_07(client, *, lag_snapshot, yaml_path)`:
1. `ensure_pools_07_source_drift_logged` (idempotent one-shot).
2. Fetches `/game/state`. Null price or null level -> one `POOLS-07-static-price-null` Info (sim at gameover — expected in current sim).
3. Malformed price (non-int string) -> Info `POOLS-07-static-price-malformed` (T-20-03-01 guard).
4. Level out of range -> Info `POOLS-07-static-price-level-out-of-range` (T-20-03-03 guard).
5. Match (`observed_price == price_for_level(level)`) -> `[]` (no YAML noise per-day).
6. Mismatch -> `POOLS-07-static-price-mismatch-level-{L}` Major (Minor under `lag_unreliable`), magnitude reports `delta=(observed - expected)` wei.

## __main__ Wiring

`--pools-05`, `--pools-06`, `--pools-07` flags added. `--all` runs validators in declared order 01 -> 02 -> 03 -> 04 -> 05 -> 06 -> 07. Coverage-gap counts printed per invocation enumerate all 8 Phase 20 fixed IDs (reuses existing `_coverage_gap_counts` pattern extended to the new IDs).

## Test Results

- `test_pools_05.py`: 4 passed (coverage-gap idempotent; empty when stEth=0; Info when stEth=1000; audit-path citation).
- `test_pools_06.py`: 3 passed (coverage-gap idempotent; validator returns []; audit-path citation).
- `test_pools_07.py`: 8 passed (source-drift idempotent; null-price Info; pass case []; mismatch Major; lag downgrade to Minor; audit-path citation; suspected_source="api"; __main__ --all orchestrates 01..07 in order).
- Full validation test suite: **155 passed** (140 prior + 15 new; zero regressions).
- Forbidden-path grep for citations: clean — PLAN-TURBO-MODE / testing/contracts appear only in the drift entries' narrative `observed_value` / `falsifiable_by` strings, which is the entries' explicit purpose.

## Phase 20 YAML Entry Manifest (8 fixed IDs)

After one live `python -m validations.pools --all`, these 8 IDs should each appear exactly once:

| ID | Severity | Source | Plan |
|----|----------|--------|------|
| POOLS-01-coverage-gap-no-per-day-pool-history | Info | api | 20-01 |
| POOLS-02-coverage-gap-no-deposit-events | Info | api | 20-01 |
| POOLS-03-coverage-gap-no-day-over-day-pool-state | Info | api | 20-02 |
| POOLS-03-source-doc-turbo-drift | Minor | api | 20-02 |
| POOLS-04-coverage-gap-no-transition-snapshots | Info | api | 20-02 |
| POOLS-05-coverage-gap-yield-unindexed | Info | api | 20-03 |
| POOLS-06-coverage-gap-accumulator-unindexed | Info | api | 20-03 |
| POOLS-07-source-doc-turbo-drift | Minor | api | 20-03 |

Per-run variable entries (live only): POOLS-01 Critical if solvency proxy breached; POOLS-02-derivation-level-{L}; POOLS-04-inferential-transition-{from}-to-{to} (or -no-transitions sentinel); POOLS-07-static-price-mismatch-level-{L} or -null.

Every Phase 20 requirement (POOLS-01..07) now has at least one YAML entry — Phase 23 synthesis is unblocked on the POOLS domain.

## Threat Model Coverage

All six threats from the plan register mitigated or accepted:

- T-20-03-01 Tampering (price conversion): `try: int(raw_price)` -> malformed Info entry, never raises.
- T-20-03-02 Info Disclosure: inherits `_scrub` via `PoolsEndpointClient`; validators catch `Exception` and return [] rather than propagating.
- T-20-03-03 Tampering (out-of-range level): guard `0 <= level <= 1000` -> Info skip.
- T-20-03-04 Repudiation: `_already_present` filter on all three new writers.
- T-20-03-05 DoS: single-shot check per invocation; no retry loop.
- T-20-03-06 Spoofing (sim drift false-positive): string equality `"0"` suppresses; any non-"0" emits (correct behavior — the point is to notice).

## Deviations from Plan

### None — plan executed as written.

Two minor elaborations (not deviations):
1. Added `POOLS-07-static-price-malformed` + `POOLS-07-static-price-level-out-of-range` guard branches (Rule 2 per threat model T-20-03-01, T-20-03-03 — both were mandated mitigations in the plan's threat register, implemented as Info skip-entries rather than unchecked int/range access).
2. `validate_pools_05` catches `Exception` from `get_tokens_analytics` and returns [] rather than raising, so a flaky `/tokens/analytics` does not kill the `--all` run after the coverage-gap is already logged.

No architectural changes. No auth gates. No Rule 4 situations.

## Open Questions for Phase 23 Synthesis

- Priority ordering of the six observability unblocks (from 20-VALIDATION.md Observability Scorecard) is already decided; Phase 23 should consume it as-is.
- REQUIREMENTS.md:31 + :35 rewrites are out of scope this milestone (report-only). Phase 23 or a dedicated REQUIREMENTS-edit milestone owns those.
- POOLS-07 per-day static-price pass case returns [] deliberately. If Phase 23 wants positive-evidence per-sample entries, add a per-level Info writer — but that inflates YAML without new information.

## Deferred (Out of Scope for This Milestone)

- Live `python -m validations.pools --all` run against localhost:3000 (optional; not gating).
- Source edits to REQUIREMENTS.md / contracts / API schema. Next milestone.
- Phase 23 cross-domain synthesis (consumes all POOLS + JACKPOT entries).

## Self-Check: PASSED

Verified:
- All 7 created files exist on disk.
- Both commits present: `4c56890` (pools_05 + pools_06), `bfdf802` (pools_07 + __main__).
- No audit-path regressions in pools package (citations all `degenerus-audit/contracts/...`).
- Forbidden-path grep returns only expected narrative strings in drift entries.
- Full test suite 155 passed.
- `--all` invokes all 7 validators in order (unit-tested).
- All 8 Phase 20 fixed IDs resolve through `source_level_entries` module exports.
