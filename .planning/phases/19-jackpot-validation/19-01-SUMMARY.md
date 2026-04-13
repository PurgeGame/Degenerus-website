---
phase: 19
plan: 01
subsystem: jackpot-validation
tags: [jackpot, validation, trait-derivation, harness]
requires:
  - harness (Phase 18 public surface: Discrepancy, Citation, Derivation, Hypothesis, SampleContext, check_api_health, append_discrepancy)
provides:
  - validations.jackpot.trait_derivation.expected_main_traits
  - validations.jackpot.trait_derivation.expected_bonus_traits
  - validations.jackpot.trait_derivation.quadrant_of
  - validations.jackpot.sample_days.SAMPLE_DAYS_CORE (24-tuple frozen)
  - validations.jackpot.sample_days.extend_with_hero_candidate
  - validations.jackpot.endpoints.EndpointClient (live + replay modes)
  - validations.jackpot.endpoints.run_with_health_check
  - validations.jackpot.fixtures_io.load_fixture / record_fixture
  - validations.jackpot.jackpot_01.validate_jackpot_01
  - python -m validations.jackpot --jackpot-01 (RUN_LIVE_VALIDATION=1-gated)
affects:
  - .planning/v2.3/harness/pyproject.toml (validations optional-dep group + additional testpath)
tech-stack:
  added:
    - eth-utils (keccak for BONUS_TRAITS_TAG salt)
    - responses (declared for future live HTTP mocking)
  patterns:
    - fixture-first tests + env-gated live runner
    - health-gate + lag_unreliable severity downgrade
    - path-traversal guard on fixture names
key-files:
  created:
    - .planning/v2.3/validations/__init__.py
    - .planning/v2.3/validations/jackpot/__init__.py
    - .planning/v2.3/validations/jackpot/sample_days.py
    - .planning/v2.3/validations/jackpot/endpoints.py
    - .planning/v2.3/validations/jackpot/trait_derivation.py
    - .planning/v2.3/validations/jackpot/fixtures_io.py
    - .planning/v2.3/validations/jackpot/jackpot_01.py
    - .planning/v2.3/validations/jackpot/__main__.py
    - .planning/v2.3/validations/tests/__init__.py
    - .planning/v2.3/validations/tests/conftest.py
    - .planning/v2.3/validations/tests/test_trait_derivation.py
    - .planning/v2.3/validations/tests/test_jackpot_01.py
    - .planning/v2.3/validations/tests/fixtures/README.md
    - .planning/v2.3/validations/tests/fixtures/api/replay_rng.json
    - .planning/v2.3/validations/tests/fixtures/api/day-2-winners.json
    - .planning/v2.3/validations/tests/fixtures/api/day-5-winners.json
    - .planning/v2.3/validations/tests/fixtures/api/day-50-winners.json
  modified:
    - .planning/v2.3/harness/pyproject.toml
decisions:
  - "keccak provider = eth_utils (pycryptodome NOT required); documented in pyproject.toml comment"
  - "BONUS_TRAITS_TAG encoding = abi.encodePacked(uint256, bytes32) = 32+32 big-endian, verified against JackpotModule.sol:164,1884-1894"
  - "fixture flat-naming (day-{N}-{endpoint}.json) under tests/fixtures/api/ only; path-traversal regex guard"
  - "severity downgrade applied only on real discrepancy flows; already-Info stays Info (no wrap)"
  - "SAMPLE_DAYS_CORE is 24 entries; 25th hero_candidate supplied at runtime via extend_with_hero_candidate()"
metrics:
  duration: ~30 minutes
  completed: 2026-04-13
  commits: 2
---

# Phase 19 Plan 01: Jackpot Validation Foundation Summary

**One-liner:** Built `validations.jackpot` package with 6-bit trait derivation, 24-day stratified sample, dual-mode endpoint client, and JACKPOT-01 validator that compares derived main traits against `/game/jackpot/day/:day/winners` with lag-aware severity.

## Validator Package Layout

```
.planning/v2.3/validations/
├── __init__.py
├── jackpot/
│   ├── __init__.py           # public surface
│   ├── trait_derivation.py   # 6-bit unpack + BONUS_TRAITS_TAG keccak salt
│   ├── sample_days.py        # SAMPLE_DAYS_CORE (24 frozen tuples)
│   ├── endpoints.py          # EndpointClient (live | replay) + health-gate
│   ├── fixtures_io.py        # load/record + path-traversal guard
│   ├── jackpot_01.py         # validate_jackpot_01 (PASS/hero/major branches)
│   └── __main__.py           # RUN_LIVE_VALIDATION=1-gated CLI
└── tests/
    ├── conftest.py
    ├── test_trait_derivation.py   (9 tests)
    ├── test_jackpot_01.py         (9 tests)
    └── fixtures/api/              (replay_rng + day-2/5/50 winners)
```

## Sample-Day Selection Outcome

`SAMPLE_DAYS_CORE` hard-codes 24 tuples (`day, level_expected, stratum, why`) per 19-RESEARCH §Stratified Sample List: 8 fast-regime early/mid/late, 5 turbo, 6 runout, 5 gameover. Entry #25 (`hero_candidate`) is appended at runtime by `extend_with_hero_candidate(day, level)` — filled by Plan 19-04 after probing main-trait mismatches across the core set.

## JACKPOT-01 Validation Results

- **Fixture-replay (no network):** 9/9 integration tests green. Day 2, Day 5, Day 50 derived traits match live-probed `/winners` ETH rows exactly (day 50 observed is a strict subset of derived — quadrants with no ETH winners reduce observed cardinality but do not produce extras, correctly classified as PASS per CONTEXT Decision 2).
- **Anchor verifications (live-probed 2026-04-13):**
  - day 2 finalWord = `5861...0971173` → derived (37, 70, 134, 251) == observed ETH traits
  - day 5 finalWord = `7887...9660777` → derived (41, 123, 186, 228) == observed ETH traits
  - day 50 finalWord = `8438...1554148` → derived (36, 85, 184, 224) ⊇ observed {36, 85, 224}
- **Live probe run:** not executed as a gating test (per plan, phase-gate not task-gate). Entry point verified to no-op cleanly without `RUN_LIVE_VALIDATION=1` and to print instructions to stderr.

## Citation Hygiene

- Every `Derivation.sources` Citation points to `degenerus-audit/contracts/libraries/JackpotBucketLib.sol` (line 281) with `label="contract"`.
- `grep -rn "testing/contracts\|degenerus-contracts" .planning/v2.3/validations/` yields only: (a) a test docstring documenting forbidden paths and (b) two assertion strings in `test_citation_uses_audit_path` that confirm the rejection. No live import or citation touches the stale trees.
- pydantic schema enforces rejection at validation time (Phase 18 `Citation.no_stale_paths` validator).

## Deviations

None. Plan executed exactly as written. One minor test tweak during GREEN (`test_hero_candidate_inference` initially flipped a single `228` row; fixture has 14 such rows so the inference correctly classified it as Major. Updated the test to flip ALL `228` rows to match the intended hero-override simulation — not a deviation, just a setup fix after discovering the fixture shape.)

## Deferred Items for Plans 19-02..04

1. **Aggregation invariants (19-02):** plan requires `sum(winners.totalEth) == sum(roll1) + sum(roll2 ETH) + sum(burnie ETH)` per-day — needs `roll1` + `roll2` fixtures (day-5, day-50 probed but not yet committed as fixtures; record via `--record` flag when 19-02 starts).
2. **BURNIE 75/25 + bonus (19-03):** `levelPrizePool[lvl-1]` may not be API-exposed; log Info coverage gap for absolute-budget check.
3. **Hero override (19-04):** permanent inferential-only; `dailyHeroWagers` not exposed. A `JACKPOT-06-coverage-gap-hero-wagers` idempotent Discrepancy entry is owed (19-04 T1).
4. **Turbo physical-day count (19-04):** infer `compressedJackpotFlag` from `/history/levels` row counts per level.
5. **Source-level +4 vs +3 doc discrepancy (19-02):** `DAILY_CARRYOVER_MAX_OFFSET=4` in contract vs CONTEXT.md/REQUIREMENTS.md JACKPOT-03 "lvl+3" — record one idempotent entry against `theory/index.html`.
6. **`/history/jackpots` 500 bug:** one-shot idempotent Discrepancy (19-04 T1 per VALIDATION.md).
7. **25th hero-candidate sample:** probe pass over SAMPLE_DAYS_CORE required in 19-04; fill via `extend_with_hero_candidate(day, level)`.

## Known Stubs

None. All exports are wired to working implementations. `responses` declared but not yet used (live HTTP mocking is deferred to validators that need it).

## Self-Check: PASSED

- FOUND: .planning/v2.3/validations/__init__.py
- FOUND: .planning/v2.3/validations/jackpot/trait_derivation.py
- FOUND: .planning/v2.3/validations/jackpot/jackpot_01.py
- FOUND: .planning/v2.3/validations/jackpot/__main__.py
- FOUND: .planning/v2.3/validations/tests/test_trait_derivation.py (9 tests passing)
- FOUND: .planning/v2.3/validations/tests/test_jackpot_01.py (9 tests passing)
- FOUND: .planning/v2.3/validations/tests/fixtures/api/day-{2,5,50}-winners.json
- FOUND: .planning/v2.3/validations/tests/fixtures/api/replay_rng.json
- FOUND: commit 71a5509 (Task 1 — skeleton + trait derivation)
- FOUND: commit 4b4438b (Task 2 — JACKPOT-01 + entry point)
- Full suite: 128 passed (72 Phase 18 + 18 Phase 19 + collection overhead)
- Citation hygiene grep: no live stale references

## Commits

- `71a5509` — feat(19-01): validations skeleton + trait derivation (JACKPOT-01 foundation)
- `4b4438b` — feat(19-01): JACKPOT-01 validator + integration tests + live entry point
