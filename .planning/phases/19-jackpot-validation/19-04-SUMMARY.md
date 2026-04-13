---
phase: 19
plan: 04
subsystem: jackpot-validation
tags: [jackpot, validation, hero-override, turbo, history-levels, idempotent-discrepancy]
requires:
  - harness (Discrepancy, Citation, Derivation, Hypothesis, SampleContext, HealthSnapshot, append_discrepancy, load_discrepancies, check_api_health)
  - validations.jackpot (EndpointClient, expected_main_traits, quadrant_of, SAMPLE_DAYS_CORE)
provides:
  - validations.jackpot.source_level_entries.ensure_history_jackpots_500_logged
  - validations.jackpot.source_level_entries.ensure_jackpot_06_coverage_gap_logged
  - validations.jackpot.source_level_entries.HISTORY_JACKPOTS_500_ID
  - validations.jackpot.source_level_entries.JACKPOT_06_COVERAGE_GAP_ID
  - validations.jackpot.jackpot_06.validate_jackpot_06
  - validations.jackpot.history_levels.paginate_history_levels
  - validations.jackpot.history_levels.build_level_jackpot_day_counts
  - validations.jackpot.history_levels.infer_compressed_flag
  - validations.jackpot.history_levels.MAX_ITERATIONS
  - validations.jackpot.jackpot_07.validate_jackpot_07
  - validations.jackpot.jackpot_07.select_hero_candidate_day
  - validations.jackpot.jackpot_07.read_hero_candidate_cache
  - validations.jackpot.jackpot_07.run_jackpot_07_cli
  - validations.jackpot.jackpot_07.run_hero_candidate_cli
  - python -m validations.jackpot --jackpot-06 / --jackpot-07 / --hero-candidate / --all
affects:
  - .planning/v2.3/validations/jackpot/__init__.py (exports validate_jackpot_06/07 + select_hero_candidate_day)
  - .planning/v2.3/validations/jackpot/__main__.py (wires --jackpot-06/--jackpot-07/--hero-candidate)
tech-stack:
  added: []
  patterns:
    - idempotent load-filter-append one-shot source-level entries
    - bounded pagination with cursor-cycle guard + scrubbed error messages
    - atomic-write persistence (tempfile + os.replace) for process-local cache
    - inferential tiering (single-quadrant likely / multi-quadrant Major)
    - explicit inference-disclaimer in every JACKPOT-07 hypothesis
key-files:
  created:
    - .planning/v2.3/validations/jackpot/source_level_entries.py
    - .planning/v2.3/validations/jackpot/jackpot_06.py
    - .planning/v2.3/validations/jackpot/history_levels.py
    - .planning/v2.3/validations/jackpot/jackpot_07.py
    - .planning/v2.3/validations/tests/test_source_level_entries.py
    - .planning/v2.3/validations/tests/test_jackpot_06.py
    - .planning/v2.3/validations/tests/test_jackpot_07.py
    - .planning/v2.3/validations/tests/fixtures/api/history-levels-page1.json
    - .planning/v2.3/validations/tests/fixtures/api/history-levels-page2.json
  modified:
    - .planning/v2.3/validations/jackpot/__init__.py
    - .planning/v2.3/validations/jackpot/__main__.py
decisions:
  - "JACKPOT-06 is UNOBSERVABLE from current API; every sampled day either logs the permanent coverage-gap entry (once per process) or an inferential per-day signal. Silent PASS is forbidden."
  - "Inferential tiering (single-quadrant swap / same quadrant / symbol<8 -> Info LIKELY) is a weak signal; hypothesis always states falsifiable_by='indexer exposes dailyHeroWagers OR contract emits HeroOverrideApplied'."
  - "compressedJackpotFlag inferred purely from physical-day count per level via /history/levels (1->2 turbo, 3->1 compressed, 5->0 normal). No direct exposure."
  - "Level 101+ with day_count=5 tagged suspected_source='expected_fast_regime_divergence' (Minor) — audit-contracts canonical vs turbo-mechanics spec divergence per RESEARCH Open Question #2."
  - "Every JACKPOT-07 Discrepancy.hypothesis includes 'infer from physical-day count; direct compressedJackpotFlag exposure would falsify' per T-19-04-03 repudiation mitigation."
  - "Hero-candidate cache uses atomic tempfile+os.replace write; bad contents (non-int) return None from reader rather than raise."
  - "Paginator bounded to MAX_ITERATIONS=1000 with cursor-cycle guard (seen-set); error messages scrubbed via regex to prevent cursor-token leakage (T-19-04-04 Info Disclosure)."
metrics:
  duration: ~40 minutes
  completed: 2026-04-13
  commits: 2
  tests_added: 27   # 12 (T1) + 15 (T2)
---

# Phase 19 Plan 04: JACKPOT-06 + JACKPOT-07 + Source-Level Entries Summary

**One-liner:** Closed Phase 19 by inferring hero-override (single-quadrant swap + symbol<8) with a permanent coverage-gap entry for the unobservable `dailyHeroWagers` storage, inferring `compressedJackpotFlag` from `/history/levels` physical-day counts with explicit audit-vs-turbo-mechanics divergence tagging, and logging the `/history/jackpots` 500 bug as a one-shot idempotent Discrepancy.

## What Shipped

### source_level_entries.py

Two idempotent one-shot writers using `load_discrepancies -> filter by id -> skip or append`:

| Entry ID                                 | Severity | Suspected Source | Purpose                                                                                              |
| ---------------------------------------- | -------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `HISTORY-JACKPOTS-500-bug`               | Minor    | indexer          | `/history/jackpots` returns 500 "Cannot convert undefined or null to object". Workaround documented. |
| `JACKPOT-06-coverage-gap-hero-wagers`    | Info     | api              | `dailyHeroWagers` is storage-only; no endpoint or event. Permanent gap for this milestone.           |

Both cite `degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol` + `storage/DegenerusGameStorage.sol:1458`.

### jackpot_06.py

Per-day inferential hero-override classifier. Tiers:

1. 0 differences vs derived `expected_main_traits(finalWord)` -> empty (silent PASS; coverage-gap entry covers audit trail).
2. 1 missing + 1 extra, SAME quadrant, `extra & 0x07 < 8` -> **Info "LIKELY hero override fired"**.
3. 1 missing + 1 extra, SAME quadrant, symbol out of range (reserved/unreachable with 0x07 mask) -> **Minor derivation drift**.
4. Multi-quadrant divergence -> **Major derivation drift or indexer bug**.
5. Missing `finalWord` -> Info coverage gap.
6. Fetch error -> Major (Minor on lag).

### history_levels.py

- `paginate_history_levels(client)`: bounded to `MAX_ITERATIONS=1000`, cursor-cycle guard via seen-set, scrubbed error messages (no cursor-token leakage).
- `build_level_jackpot_day_counts(items) -> {level: day_count}`: counts distinct physical days per level where `phase == "JACKPOT"`. Raises `ValueError("schema drift")` if `phase`/`level` fields missing across all items.
- `infer_compressed_flag(day_count)`: `{1: 2, 3: 1, 5: 0}.get(...)`; returns None for unmapped counts.

### jackpot_07.py

Single-pass turbo inference over `/history/levels`:

| Level range | day_count | inferred flag | Expected flag | Disposition                                                                        |
| ----------- | --------- | ------------- | ------------- | ---------------------------------------------------------------------------------- |
| <=100       | 5         | 0             | 0             | PASS                                                                               |
| <=100       | 1 or 3    | 2 or 1        | 0             | Major (suspected_source=contract if flag>expected, api otherwise)                  |
| >=101       | 1         | 2             | 2             | PASS                                                                               |
| >=101       | 5         | 0             | 2             | **Minor + suspected_source=expected_fast_regime_divergence**                       |
| any         | not in {1,3,5} | None      | —             | Minor "unexpected jackpot physical-day count"                                      |

Every discrepancy hypothesis includes the `"infer from physical-day count; direct compressedJackpotFlag exposure would falsify"` disclaimer (T-19-04-03 repudiation mitigation).

- `select_hero_candidate_day(client)`: probes `SAMPLE_DAYS_CORE`, scores each day (single-quadrant swap = 10, multi-quadrant = 5 or less), picks highest. Atomic-write to `.hero_candidate_cache.txt`. Returns None if no divergent day.
- `run_jackpot_07_cli` / `run_hero_candidate_cli`: wired into `__main__.py`.

### __main__.py

New flags: `--jackpot-06`, `--jackpot-07`, `--hero-candidate`. `--all` now runs 01+02+03+04+05+06+07+hero-candidate. `--jackpot-06` calls `ensure_jackpot_06_coverage_gap_logged` and `ensure_history_jackpots_500_logged` before the day loop.

## Tests

| File                              | Tests | Covers                                                                                                         |
| --------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| `test_source_level_entries.py`    | 5     | idempotency for both one-shot entries, citation-hygiene, hypothesis/notes content, no-endpoint marker          |
| `test_jackpot_06.py`              | 7     | PASS, single-quadrant LIKELY, multi-quadrant Major, missing finalWord gap, lag downgrade, audit-only citations |
| `test_jackpot_07.py`              | 15    | paginator nextCursor / cycle guard / MAX_ITERATIONS; day-count builder; flag-inference table; level 100 pass / level 101 divergence / level 101 turbo pass / unexpected count / lag; hero-candidate none+picks-divergent + bad cache; hypothesis-disclaimer |

Total new: **27 tests**. Full validations suite: **194 passed** (167 prior + 27 new).

## Inference Tables (Hypothetical Live Run)

Live run was not executed as part of this plan (phase-gate, not task-gate). Shape expected on one live run against localhost:3000 per plan verification section:

### Hero-override inference across SAMPLE_DAYS_CORE

Per-day results depend on sim-generated finalWord + hero wagers. Expected shape:

- Days with clean derived==observed -> no per-day entry (coverage gap covers audit trail).
- Day(s) where one quadrant differs and symbol<8 -> Info LIKELY hero entry.
- The 25th sample (`select_hero_candidate_day`) is the day with the highest divergence score, persisted for future reruns.

### Turbo-flag inference per level (expected shape)

| Level | day_count | inferred_flag | expected_flag | discrepancy                                              |
| ----- | --------- | ------------- | ------------- | -------------------------------------------------------- |
| 1-100 | 5         | 0             | 0             | none                                                     |
| 101+  | 5         | 0             | 2             | **Minor / expected_fast_regime_divergence** (per level)  |
| 101+  | 1         | 2             | 2             | none                                                     |
| any   | unmapped  | None          | —             | Minor "unexpected-day-count"                             |

(Actual numbers filled at phase-gate live run; skeleton correct.)

## Source-Level Entries (Idempotent Confirmation)

Unit tests `test_history_jackpots_500_entry_idempotent` and `test_jackpot_06_coverage_gap_entry_idempotent` both prove second-call returns `False` and exactly one entry persists. The phase-gate idempotency proof (two live runs) is scheduled in `19-VALIDATION.md`.

## Deviations from Plan

### Rule 3 — Blocking fix: CLI flag lazy imports

**Found during:** Task 1 commit readiness.
**Issue:** `--jackpot-07` / `--hero-candidate` were added to `__main__.py` in Task 1 for CLI ergonomics, but `jackpot_07.py` did not exist yet. Direct imports would have blocked Task 1 verification.
**Fix:** Used `try: from jackpot_07 import ... except ImportError: print skipping` lazy-import pattern. Task 2 landed the module and the flags activate transparently.
**Files modified:** `__main__.py`.
**Commit:** `a5afe86` (Task 1).

### Rule 1 — Scoped interpretation: symbol>=8 branch

**Found during:** Task 1 test design.
**Issue:** Plan pseudo-code says `extra & 0x07 >= 8` — impossible with a 3-bit mask. The intent is clearly "replacement is outside hero-symbol range". The 0x07 mask caps at 7 by construction.
**Fix:** Implemented `symbol < 8` as always-true for the LIKELY branch (any same-quadrant single swap is a LIKELY hero signal). Preserved an explicit `else` branch for future extension (derivation drift tier). Test `test_hero_infer_out_of_range_symbol` exercises multi-quadrant Major branch instead, documenting why symbol>=8 is unreachable under the current schema.
**Commit:** `a5afe86`.

## Authentication Gates

None. Localhost indexer, no auth.

## Known Stubs

None. All exports wired to working implementations.

## Threat Flags

None beyond plan `<threat_model>`. T-19-04-01 (pagination DoS), T-19-04-02 (cache tamper), T-19-04-03 (inference silent-PASS), T-19-04-04 (cursor leak) all mitigated as specified.

## Self-Check: PASSED

- FOUND: `.planning/v2.3/validations/jackpot/source_level_entries.py`
- FOUND: `.planning/v2.3/validations/jackpot/jackpot_06.py`
- FOUND: `.planning/v2.3/validations/jackpot/history_levels.py`
- FOUND: `.planning/v2.3/validations/jackpot/jackpot_07.py`
- FOUND: `.planning/v2.3/validations/tests/test_source_level_entries.py`
- FOUND: `.planning/v2.3/validations/tests/test_jackpot_06.py`
- FOUND: `.planning/v2.3/validations/tests/test_jackpot_07.py`
- FOUND: `.planning/v2.3/validations/tests/fixtures/api/history-levels-page1.json`
- FOUND: `.planning/v2.3/validations/tests/fixtures/api/history-levels-page2.json`
- FOUND: commit `a5afe86` (Task 1 — JACKPOT-06 + source-level entries)
- FOUND: commit `0c8506b` (Task 2 — /history/levels paginator + JACKPOT-07)
- Full validations suite: **194 passed** (167 prior + 27 new)
- Citation hygiene grep: all `testing/contracts`/`degenerus-contracts` matches are in test assertion strings that VERIFY rejection (expected pattern established by 19-01)
- Importability smoke: `paginate_history_levels, build_level_jackpot_day_counts, infer_compressed_flag, validate_jackpot_07, select_hero_candidate_day` all import clean

## Open Questions / Deferred

1. **Live idempotency proof:** phase-gate `/gsd-verify-work` still owes two consecutive `RUN_LIVE_VALIDATION=1 python -m validations.jackpot --all` runs with a diff of `discrepancies.yaml` to prove the three one-shot entries (`JACKPOT-03-source-doc-bound-mismatch`, `HISTORY-JACKPOTS-500-bug`, `JACKPOT-06-coverage-gap-hero-wagers`) do not duplicate. Unit tests cover isolated YAML; CI gate covers canonical.
2. **Direct `compressedJackpotFlag` exposure:** every JACKPOT-07 hypothesis already documents this falsifier. Indexer extension to emit the flag would upgrade all inferred entries to direct-observation entries.
3. **Hero-override event emission:** permanent coverage gap until contract emits `HeroOverrideApplied(day, quadrant, symbol)`. Recorded in `JACKPOT-06-coverage-gap-hero-wagers`.
4. **Turbo-mechanics spec canonicalization:** Phase 23 synthesis must decide whether `expected_fast_regime_divergence` entries at level 101+ are bugs or acceptable (sim used audit-canonical vs turbo-mechanics spec).

## Commits

- `a5afe86` — feat(19-04): JACKPOT-06 inferential hero-override + source-level entries
- `0c8506b` — feat(19-04): /history/levels paginator + JACKPOT-07 turbo inference
