---
phase: 20
plan: 02
subsystem: pools-validation
tags: [pools, validation, drip, drawdown, coverage-gap, source-drift, turbo-drift, tdd]
requires:
  - validations.pools package (from 20-01)
  - validations.jackpot.history_levels._scrub_cursor
  - harness public surface (Discrepancy, Citation, Derivation, Hypothesis, SampleContext, append_discrepancy, load_discrepancies, HealthSnapshot)
provides:
  - validations.pools.transitions.paginate_history_levels (configurable max_iter)
  - validations.pools.transitions.enumerate_transitions (ordered (from, to, block) triples)
  - validate_pools_03 (coverage-gap + source-drift, returns [])
  - validate_pools_04 (per-transition inferential + coverage-gap)
  - ensure_pools_03_coverage_gap_logged, ensure_pools_03_source_drift_logged, ensure_pools_04_coverage_gap_logged
affects:
  - .planning/v2.3/discrepancies.yaml (3 new idempotent fixed IDs + N per-transition entries on live run)
  - .planning/v2.3/validations/pools/__main__.py (--pools-03, --pools-04 flags, --all orchestrates 01..04)
tech-stack:
  patterns:
    - Phase 19 source-level idempotency (load -> filter by id -> skip-or-append)
    - Reuse of validations.jackpot.history_levels._scrub_cursor (cursor redaction)
    - suspected_source="api" for source-level doc drift (mirrors Phase 19 JACKPOT-03-source-doc-bound-mismatch)
key-files:
  created:
    - .planning/v2.3/validations/pools/transitions.py
    - .planning/v2.3/validations/pools/pools_03.py
    - .planning/v2.3/validations/pools/pools_04.py
    - .planning/v2.3/validations/tests/test_transitions.py
    - .planning/v2.3/validations/tests/test_pools_03.py
    - .planning/v2.3/validations/tests/test_pools_04.py
    - .planning/v2.3/validations/tests/fixtures/api/history-levels-pools-page1.json
    - .planning/v2.3/validations/tests/fixtures/api/history-levels-pools-page2.json
  modified:
    - .planning/v2.3/validations/pools/source_level_entries.py
    - .planning/v2.3/validations/pools/__main__.py
decisions:
  - Did NOT reuse jackpot.history_levels.paginate_history_levels directly — it hard-codes MAX_ITERATIONS with no per-call override, blocking deterministic DoS-guard tests. Reused _scrub_cursor only.
  - POOLS-04 empty-transitions case emits a sentinel "POOLS-04-inferential-no-transitions" Info entry rather than returning [] silently, so live-run logs always contain positive evidence of the check running.
  - suspected_source="api" for POOLS-03-source-doc-turbo-drift — mirrors Phase 19's JACKPOT-03-source-doc-bound-mismatch precedent; "gt_paper" would be incorrect since the drift is in REQUIREMENTS.md.
metrics:
  duration: ~20m
  tasks: 2
  files_created: 8
  files_modified: 2
  commits: 2
  tests_added: 16
  tests_total: 250
completed: 2026-04-13
---

# Phase 20 Plan 02: POOLS-03 / POOLS-04 Drip and Drawdown Summary

Drip + drawdown validators delivered as rich coverage-gap Info entries (both mechanics are unobservable at the fidelity REQUIREMENTS.md requests). Transition enumerator built on top of `/history/levels` with bounded iteration + cursor-cycle guard. Turbo-drift in REQUIREMENTS.md:31 locked in YAML as idempotent Minor source-level entry.

## Transition Enumerator

`validations.pools.transitions.enumerate_transitions(client)` returns an ordered list of `(level_from, level_to, block_at_jackpot_end)` tuples by:

1. Paginating `/history/levels` via `paginate_history_levels(max_iter=1000)` — bounded against cursor cycles and runaway chains.
2. Walking items; for each `stage=7 phase=JACKPOT` row, searching forward for the next `stage in (3, 10) phase=PURCHASE` row.
3. Emitting the transition only if `next_purchase.level == lvl_from + 1` (level-gap guard; skips jackpots that straddle test restarts or indexer backfill gaps).

Reused `validations.jackpot.history_levels._scrub_cursor` for T-20-02-02 info-disclosure hardening. Defined a local `paginate_history_levels` because jackpot's version hard-codes `MAX_ITERATIONS=1000` at module scope with no per-call override; tests need to assert the guard fires deterministically.

Live run result: not executed in this plan (optional; not gating). Fixture run produces 2 transitions from a 2-page sample (49->50, 50->51), skipping one orphan jackpot (60) and one level-gap transition (99->101).

## YAML Entries Landed (Idempotent)

Three fixed IDs, each written by load_discrepancies -> filter -> skip-or-append:

- `POOLS-03-coverage-gap-no-day-over-day-pool-state` (Info) — formula cites `JackpotModule.sol:523` (1% daily drip, 75/25 lootbox/ETH split at `:188,530`). Unblock hypothesis: `prize_pool_snapshots(day, level, futurePool, nextPool, currentPool, claimable)` table + `/history/pools/day/:day` route + `FutureTakeApplied`/`DripApplied` events via `/replay/events/:level`.
- `POOLS-03-source-doc-turbo-drift` (Minor) — cites `AdvanceModule.sol:1014 (_applyTimeBasedFutureTake)` as audit canonical. `suspected_source="api"` per Phase 19 JACKPOT-03 pattern. Unblock: rewrite REQUIREMENTS.md:31 to reference the U-curve mechanism (13-30% base + VRF variance + x9 bonus + overshoot surcharge + triangular variance, capped 80%) rather than "graduated extraction 30-50%".
- `POOLS-04-coverage-gap-no-transition-snapshots` (Info) — cites `AdvanceModule.sol:805` (`(memFuture * 15) / 100`) and `:1125` (x00 branch). Unblock: `prize_pool_transitions(completed_level, future_pre, future_post, next_post, drawdown_amount, block_number)` table + `/history/pools/transitions` route.

Per-run variable entries (written live only):
- N = count of enumerated transitions -> one `POOLS-04-inferential-transition-{from}-to-{to}` Info entry each, with `expected_pct=0` for x00->x00+1 and `expected_pct=15` otherwise.
- If no transitions enumerated, exactly one `POOLS-04-inferential-no-transitions` sentinel Info entry.

## POOLS-03 Validator Behavior

`validate_pools_03(client, *, lag_snapshot, yaml_path)` returns `[]`. Both one-shot writers (`ensure_pools_03_coverage_gap_logged`, `ensure_pools_03_source_drift_logged`) are idempotent; validator serves as the `--all` orchestration hook. Intentional design: the coverage-gap + source-drift pair IS the complete milestone deliverable.

## POOLS-04 Validator Behavior

`validate_pools_04(client, *, lag_snapshot, yaml_path)`:
1. `ensure_pools_04_coverage_gap_logged` (idempotent).
2. `transitions = enumerate_transitions(client)` — RuntimeError re-raise (scrubbed) on failure.
3. One Info `POOLS-04-inferential-transition-{from}-to-{to}` per transition. x00 branch cites `:1125`, standard branch cites `:805`.
4. If empty: one `POOLS-04-inferential-no-transitions` sentinel.

## Test Results

- `test_transitions.py`: 6 passed (happy path, orphan skip, level-gap skip, cycle guard with scrubbed message, max_iter overrun, scrubbed client error).
- `test_pools_03.py`: 4 passed (coverage-gap idempotent, source-drift idempotent, validator returns [], audit-path citations).
- `test_pools_04.py`: 6 passed (3 transitions -> 3 inferential + 1 coverage-gap, idempotent coverage-gap, x00 case = 0%, standard case = 15%, empty-transitions sentinel, audit-path citations).
- Full project pytest: **250 passed** (234 prior + 16 new; zero regressions).
- Forbidden-path grep (`testing/contracts|degenerus-contracts|v1.1-ECONOMICS-PRIMER`) in `.planning/v2.3/validations/pools/`: empty.

## Deviations from Plan

### None — plan executed as written, with one minor elaboration

The plan text said "define local paginate_history_levels ... if (or signature mismatch)" — the jackpot version's signature mismatch (no per-call `max_iter` override) was the trigger. Decision documented in the transitions.py module docstring and in this summary's `decisions` frontmatter. `_scrub_cursor` imported from jackpot to avoid duplication. No architectural changes. No Rule 1/2/3/4 situations.

## Threat Model Coverage

All six threats from the plan register are mitigated or accepted as specified:

- T-20-02-01 DoS: `max_iter=1000` default; unit-tested overrun.
- T-20-02-02 Info Disclosure: `_scrub_cursor` applied to all paginate errors; test asserts raw cursor not echoed.
- T-20-02-03 Tampering (concurrent writers): accepted — single-threaded `--all` flow.
- T-20-02-04 Repudiation: `_already_present` filter on every ensure_* call.
- T-20-02-05 Spoofing: level-gap guard + orphan skip; unit-tested.
- T-20-02-06 Injection: `_safe_cursor` already guarding `PoolsEndpointClient` from 20-01.

## Deferred for Plans 20-03 / 20-04

- POOLS-05 stETH yield + POOLS-06 segregated accumulator coverage-gap writers (20-03).
- POOLS-07 static-price conformance + REQUIREMENTS.md turbo-drift entry (`POOLS-07-source-doc-turbo-drift`) (20-04).
- Live-run execution of `python -m validations.pools --all` against localhost:3000 (optional; not gating).
- Phase 23 synthesis: consume POOLS-04 inferential entries + compare to eventual `prize_pool_transitions` schema output once coverage gap resolved.

## Self-Check: PASSED

Verified:
- All 8 created files exist on disk.
- Both commits present: `32b458f` (transitions + tests), `ed2a14b` (pools_03 + pools_04 + writers + __main__).
- No forbidden citation paths in pools package.
- Full test suite 250 passed.
- suspected_source values used are all in the permitted Literal set (`api`).
- All ensure_* writers pass pydantic validation (Discrepancy instantiation succeeds).
