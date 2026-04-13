---
phase: 20
plan: 01
subsystem: pools-validation
tags: [pools, validation, solvency, coverage-gap, tdd]
requires:
  - harness public surface (Discrepancy, append_discrepancy, load_discrepancies, SampleContext, HealthSnapshot)
  - validations.jackpot.sample_days.SAMPLE_DAYS_CORE
  - validations.jackpot.endpoints (_scrub, _TIMEOUT_READ, DEFAULT_BASE_URL, run_with_health_check)
  - validations.jackpot.fixtures_io.load_fixture
provides:
  - validations.pools package (importable, __main__ entry point)
  - PoolsEndpointClient (live|replay)
  - price_for_level (PriceLookupLib.sol reimpl)
  - SAMPLE_LEVELS (16 distinct levels)
  - validate_pools_01 (solvency proxy, Critical on violation)
  - validate_pools_02 (per-level ticket-ETH derivation, Info)
  - ensure_pools_0{1,2}_coverage_gap_logged (idempotent)
affects:
  - .planning/v2.3/discrepancies.yaml (two new idempotent coverage-gap IDs)
tech-stack:
  patterns:
    - Phase 19 source-level-entry idempotency (load -> filter by id -> skip-or-append)
    - _resolve_repo_root() for default YAML paths
    - severity-downgrade under lag_unreliable
key-files:
  created:
    - .planning/v2.3/validations/pools/__init__.py
    - .planning/v2.3/validations/pools/endpoints.py
    - .planning/v2.3/validations/pools/sample.py
    - .planning/v2.3/validations/pools/price_curve.py
    - .planning/v2.3/validations/pools/pools_01.py
    - .planning/v2.3/validations/pools/pools_02.py
    - .planning/v2.3/validations/pools/source_level_entries.py
    - .planning/v2.3/validations/pools/__main__.py
    - .planning/v2.3/validations/tests/test_price_curve.py
    - .planning/v2.3/validations/tests/test_pools_01.py
    - .planning/v2.3/validations/tests/test_pools_02.py
    - .planning/v2.3/validations/tests/fixtures/api/game-state-current.json
    - .planning/v2.3/validations/tests/fixtures/api/tokens-analytics-current.json
    - .planning/v2.3/validations/tests/fixtures/api/replay-tickets-level-50.json
    - .planning/v2.3/validations/tests/fixtures/api/replay-tickets-level-100.json
decisions:
  - Reused _scrub/_TIMEOUT_READ/DEFAULT_BASE_URL/run_with_health_check from validations.jackpot.endpoints (single source of truth for HTTP hardening)
  - Fixtures placed under tests/fixtures/api/ to match the existing load_fixture _FIXTURE_ROOT (plan text said tests/fixtures/; load_fixture resolves api/ subdir)
  - validate_pools_01/02 accept a yaml_path kwarg so tests can redirect to tmp_path without monkeypatching internals
  - price_for_level: x00 reset returns 0.24 ETH per PriceLookupLib.sol:35 (plan text hedged "re-verify against source"; source confirmed 0.24)
metrics:
  duration: ~15m
  tasks: 2
  files_created: 15
  commits: 2
completed: 2026-04-13
---

# Phase 20 Plan 01: Pools Validation Foundation Summary

Phase 20's validation foundation: `validations.pools` package with endpoint client, sample-level derivation, static-price-curve reimplementation, POOLS-01 solvency proxy validator, POOLS-02 per-level deposit-split derivation, and two idempotent coverage-gap writers.

## Package Layout

```
.planning/v2.3/validations/pools/
  __init__.py              # public surface docstring
  endpoints.py             # PoolsEndpointClient (live|replay)
  sample.py                # SAMPLE_LEVELS derived from SAMPLE_DAYS_CORE
  price_curve.py           # price_for_level (PriceLookupLib reimpl)
  pools_01.py              # validate_pools_01 (solvency proxy)
  pools_02.py              # validate_pools_02 (per-level derivation)
  source_level_entries.py  # idempotent coverage-gap writers
  __main__.py              # CLI, RUN_LIVE_VALIDATION-gated
```

## Price-Curve Source Citations

All assertions sourced from `degenerus-audit/contracts/libraries/PriceLookupLib.sol:7-47`:

- Intro tiers (first cycle only): levels 0-4 -> 0.01 ETH; 5-9 -> 0.02 ETH (lines 23-24)
- First full cycle 10-99: 10-29 -> 0.04; 30-59 -> 0.08; 60-89 -> 0.12; 90-99 -> 0.16 (lines 27-30)
- Repeating cycle (levels 100+), `cycleOffset = level % 100`:
  - offset == 0 -> 0.24 ETH milestone (line 35)
  - offset 1..29 -> 0.04; 30..59 -> 0.08; 60..89 -> 0.12; 90..99 -> 0.16 (lines 37-44)

## SAMPLE_LEVELS

Derived from `validations.jackpot.sample_days.SAMPLE_DAYS_CORE` (24 entries) deduped to 16 distinct levels:

`(1, 5, 10, 25, 50, 75, 99, 100, 101, 102, 103, 105, 108, 109, 110, 111)`

Within the plan's 15-24 bound.

## POOLS-01 Live-Run Result

Not executed in this plan (optional; not gating). Proxy check implemented:
`claimable > ethReserve + stEthReserve` -> Critical (Major if `lag_unreliable`).
On first live run, `POOLS-01-coverage-gap-no-per-day-pool-history` will be appended;
re-runs are no-ops.

## POOLS-02 Per-Level Derivation

`validate_pools_02` iterates `SAMPLE_LEVELS`, calls `/replay/tickets/:level`, and
emits one `POOLS-02-derivation-level-{L}` Info entry per level with `totalMintedOnLevel > 0`.
Formula: `total_tickets * price_for_level(L)` split 9000/1000 bps next/future.
Observed side not comparable this milestone (see coverage-gap below).

## Coverage-Gap IDs (Idempotent)

Both writers use `load_discrepancies -> filter by id -> skip-or-append` pattern.
Unit tests confirm single entry after repeated calls:

- `POOLS-01-coverage-gap-no-per-day-pool-history` — no historical per-day pool snapshots exist in the API; solvency is checkable current-moment only.
- `POOLS-02-coverage-gap-no-deposit-events` — `rawEvents` table exists but no API route exposes it; per-deposit splits unreconstructable.

Each carries a `falsifiable_by` hypothesis specifying the exact schema/route that would unblock retrospective validation.

## Test Results

- `test_price_curve.py`: 30 passed (parameterized decade-boundary sweep)
- `test_pools_01.py`: 5 passed (pass, Critical, lag-downgrade to Major, idempotent coverage-gap, audit-path citation)
- `test_pools_02.py`: 5 passed (per-level math, empty-tickets skip, idempotent coverage-gap, whale case, audit-path citation)
- Full project pytest: **234 passed** (no regressions in Phase 18/19 suites)

## Deviations from Plan

### Rule 3 — Blocking path fix

**1. Fixture directory location.** Plan text placed fixtures under `tests/fixtures/` but
`validations.jackpot.fixtures_io._FIXTURE_ROOT` resolves to `tests/fixtures/api/`.
Placed the four new fixtures in `tests/fixtures/api/` so `load_fixture` finds them
without path-traversal bypass. No change to security regex.

### Rule 2 — Missing testability surface

**2. Added `yaml_path` kwarg to `validate_pools_01` / `validate_pools_02`.**
Plan signatures omitted this. Without it, unit tests cannot redirect the default
YAML path without monkeypatching module constants — which they still do, but
the kwarg keeps the idempotent-writer call under test control. Default value
is `DEFAULT_DISCREPANCIES_PATH`, so production CLI behavior is unchanged.

No architectural changes. No auth gates. No Rule 4 situations.

## Deferred for Plans 20-02 / 20-03

- POOLS-03 drip + graduated extraction coverage-gap writer (20-02)
- POOLS-04 transition enumeration via `/history/levels` + per-transition Info entries (20-02)
- POOLS-05 stETH yield + POOLS-06 segregated accumulator coverage-gap writers (20-03)
- REQUIREMENTS.md source-drift entries (`POOLS-03-source-doc-turbo-drift`, `POOLS-07-source-doc-turbo-drift`) — written in their respective plans
- Live-run validation of POOLS-01 proxy against localhost:3000 (optional; gating not required this milestone)

## Self-Check: PASSED

Verified:
- All 15 files exist on disk
- Both commits present: `6b78406` (scaffolding), `4581ff0` (validators)
- No forbidden citation paths in pools package (grep empty)
- No pools leakage into jackpot package (grep empty)
- Full test suite 234 passed
