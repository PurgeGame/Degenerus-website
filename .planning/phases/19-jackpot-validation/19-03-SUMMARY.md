---
phase: 19
plan: 03
subsystem: jackpot-validation
tags: [jackpot, validation, burnie, bonus-roll, center-diamond]
requires:
  - harness (Discrepancy, HealthSnapshot, Citation, Derivation, Hypothesis, SampleContext)
  - validations.jackpot (EndpointClient, expected_bonus_traits, quadrant_of from 19-01)
provides:
  - validations.jackpot.burnie_budget.derive_burnie_budget
  - validations.jackpot.burnie_budget.check_near_far_ratio
  - validations.jackpot.burnie_budget.FAR_FUTURE_COIN_BPS (==2500)
  - validations.jackpot.burnie_budget.PRICE_COIN_UNIT_WEI
  - validations.jackpot.jackpot_04.validate_jackpot_04
  - validations.jackpot.jackpot_05.validate_jackpot_05
  - python -m validations.jackpot --jackpot-04 / --jackpot-05 / --all (RUN_LIVE_VALIDATION=1-gated)
affects:
  - .planning/v2.3/validations/jackpot/__main__.py (added --jackpot-04 / --jackpot-05 flags)
  - .planning/v2.3/validations/jackpot/__init__.py (package exports)
tech-stack:
  added: []
  patterns:
    - count-weighted aggregation for BURNIE (amount × count = wei per row)
    - tiered tolerance (≤1% silent / ≤2% Info / ≤5% Minor / >5% Major)
    - center-diamond shape check (traitId=null ↔ winningLevel set)
    - single-targetLevel concentration rule (Minor on multi-level bonus spread)
    - scope-restricted bonus trait membership (BURNIE rows only, main ETH out of scope)
key-files:
  created:
    - .planning/v2.3/validations/jackpot/burnie_budget.py
    - .planning/v2.3/validations/jackpot/jackpot_04.py
    - .planning/v2.3/validations/jackpot/jackpot_05.py
    - .planning/v2.3/validations/tests/test_jackpot_04.py
    - .planning/v2.3/validations/tests/test_jackpot_05.py
    - .planning/v2.3/validations/tests/fixtures/api/day-350-winners.json
    - .planning/v2.3/validations/tests/fixtures/api/day-500-winners.json
  modified:
    - .planning/v2.3/validations/jackpot/__init__.py
    - .planning/v2.3/validations/jackpot/__main__.py
decisions:
  - "BURNIE wei aggregation is count-weighted (Σ amount × count). Live probe at day 350 confirms amount-only gives 40% far_ratio (wrong), count-weighted gives exactly 25% (correct)."
  - "Bonus trait membership check restricted to BURNIE breakdown rows. Main ETH rows (Roll 1 wins) retain main traits; applying the plan's blanket rule would false-positive-flag every bonus winner with a main ETH win. Rule 1 deviation."
  - "levelPrizePool[lvl-1] confirmed absent from all probed endpoints (/game/jackpot/:level/overview keys = [level, day, farFutureResolved, rows]). Absolute BURNIE budget check falls back to ratio-only + per-day Info coverage gap entry."
  - "Single-targetLevel concentration rule uses winningLevel on the winner record. Per RESEARCH Pitfall #6, this field actually reports Roll 1 sourceLevel — so multi-level spread may be a semantics issue rather than a contract violation. Entry logged as Minor for next-milestone re-interpretation."
metrics:
  duration: ~50 minutes
  completed: 2026-04-13
  commits: 2
  tests_added: 22   # 13 in test_jackpot_04 + 9 in test_jackpot_05
---

# Phase 19 Plan 03: JACKPOT-04 / JACKPOT-05 Validators Summary

**One-liner:** BURNIE 75/25 split with center-diamond shape check (JACKPOT-04) and bonus-roll per-quadrant aggregation with keccak-derived trait set membership (JACKPOT-05), both validated against recorded day-350 and day-500 fixtures with the levelPrizePool absolute-budget check explicitly logged as an endpoint-coverage gap.

## What shipped

### burnie_budget.py

- `FAR_FUTURE_COIN_BPS = 2500`, `NEAR_FUTURE_COIN_BPS = 7500`, `PRICE_COIN_UNIT_WEI = 1000e18`.
- `derive_burnie_budget(pool_wei, price_wei)` — mirrors `JackpotModule.sol:1897-1901` integer floor division.
- `check_near_far_ratio(near, far, tol_bps=200)` — returns `(within_tol, Decimal delta)`. Zero/zero returns (True, 0).

### jackpot_04.py (BURNIE 75/25 + center-diamond)

1. Fetch winners. Network error → Major (Minor on lag).
2. Walk `breakdown[]`: BURNIE rows split near (`traitId` set) vs far (`traitId=null`). Wei per row = `amount × count`.
3. Tiered ratio severity against expected 0.25:
   - `delta ≤ 1%` → silent PASS
   - `1% < delta ≤ 2%` → Info entry
   - `2% < delta ≤ 5%` → Minor
   - `delta > 5%` → Major
4. Center-diamond shape: every far-future row's parent winner must have `winningLevel` set. Violations → Major.
5. Coverage gap: one Info entry per day noting `levelPrizePool[lvl-1]` is not exposed by any endpoint (confirmed absent from `/game/jackpot/:level/overview`).
6. Empty-BURNIE days → single Info `no-burnie` entry and early return (no coverage-gap spam).
7. Lag-unreliable severity downgrade.

### jackpot_05.py (bonus-roll)

1. Pull finalWord from `/replay/rng`. Missing → Info gap.
2. `bonus_traits = expected_bonus_traits(finalWord)` via the keccak salt from Plan 19-01.
3. Walk `hasBonus=true` winners. Empty → single Info gap.
4. **Scope:** only BURNIE breakdown rows are checked against `bonus_traits ∪ {null}`. Main ETH rows are valid with main traits. A BURNIE row with `traitId NOT in bonus_traits AND NOT null` → Major (suspected_source=contract — signals BONUS_TRAITS_TAG encoding drift).
5. `hasBonus=true` winner with NO bonus-match row anywhere → Major `hasbonus-without-breakdown`.
6. Single-targetLevel concentration: distinct `winningLevel` across bonus winners. >1 → Minor (see caveat in decisions).
7. Per-quadrant aggregation (`quadrant = traitId >> 6`) for BURNIE / ETH / tickets. Non-negative + reconciles to grand total. Summary logged as Info.
8. Lag-unreliable severity downgrade.

## Live-probe observations (2026-04-13)

Recorded fixtures: `day-350-winners.json`, `day-500-winners.json` (both flagged by 19-RESEARCH as BURNIE-positive).

| Day | Level | BURNIE near (count-weighted wei) | BURNIE far wei | far_ratio | hasBonus winners | distinct winningLevels |
|-----|-------|----------------------------------|----------------|-----------|------------------|------------------------|
| 350 | 110   | 6,248,247,054,300,694,490,532     | 2,082,749,018,100,231,496,840 | **0.2500** | 2 | {107, 110} |
| 500 | 111   | 6,289,004,236,401,607,245,844     | 2,096,334,745,467,202,415,280 | **0.2500** | 2 | {...} |

- Both days hit the 0.25 far_ratio **exactly** under count-weighted aggregation. Amount-only summation gives 0.40 (day 350) / 0.357 (day 500) — wrong, because rows with the same trait split at 1-wei floor-division boundaries are emitted as separate `{amount, count}` rows.
- Day 350 bonus traits derived = `(61, 88, 144, 252)`. Observed bonus BURNIE traits = `{61, 88, 144}`. Quadrant 3 (252) had no bucket winners — consistent with contract behavior (unfilled quadrants produce no row). **No contract-derivation contradiction found.**
- Day 350 `winningLevels={107, 110}` across two bonus winners — fires the single-targetLevel Minor. Per decisions, this likely reflects `winningLevel` semantics (= Roll 1 sourceLevel per RESEARCH Pitfall #6) rather than an actual multi-level bonus distribution. Entry stands for next-milestone interpretation.

## Center-diamond occurrence

Both probed days have center-diamond rows (`traitId=null`, parent `winningLevel` set). No shape violations observed. Synthetic test `test_burnie_invalid_center_diamond_winnerlevel_null` confirms the validator correctly flags Majors when winningLevel is null on a far-future row.

## Coverage gaps (explicit)

| Gap ID pattern | Reason | Disposition |
|----------------|--------|-------------|
| `JACKPOT-04-day{N}-level-prize-pool-unavailable` | `levelPrizePool[lvl-1]` not exposed by `/game/jackpot/:level/overview` or any probed endpoint | Per-day Info entry; absolute-budget check falls back to ratio-only |
| `JACKPOT-04-day{N}-no-burnie` | Day had no BURNIE phase (purchase-phase or non-jackpot) | Per-day Info, short-circuits validation |
| `JACKPOT-05-day{N}-no-bonus-winners` | Bonus phase did not fire or no eligible holders | Per-day Info |
| `JACKPOT-05-day{N}-missing-finalword` | `/replay/rng` omits the day | Per-day Info |

## Deviations from Plan

### Rule 1 — Fixed bug: bonus trait membership scope

**Found during:** Task 2 implementation.
**Issue:** Plan step 5 said "every breakdown row of a bonus winner must have `traitId is None` or `traitId in bonus_traits`." That false-positive-flags every bonus winner who also won main Roll 1 ETH (a common case — day 350 sample has one). A `hasBonus=true` winner simultaneously wins main ETH (main traits) and bonus BURNIE (bonus traits); applying the rule to all rows makes 100% of bonus winners with ETH wins fail.
**Fix:** Restricted the membership rule to BURNIE rows only. Main ETH rows are out of scope for the bonus trait check. Added `hasbonus-without-breakdown` check to preserve the "hasBonus flag must correspond to SOME bonus distribution" intent of the plan.
**Files modified:** `jackpot_05.py` (validator), `test_jackpot_05.py` (happy-path no longer uses strict all-rows rule).
**Commit:** 69e334a.

### Rule 3 — Fixed blocking: amount aggregation weighting

**Found during:** Day-350 live probe.
**Issue:** Initial ratio computation using row `amount` only produced far_ratio ≈ 0.40 (wildly outside tolerance). The `breakdown[]` rows report per-entry wei in `amount` and multiplier in `count`; grouping by identical per-entry amounts splits contiguous rows.
**Fix:** `_row_amount_wei(row) = int(amount) × int(count)`. Count-weighted aggregation produces exact 0.2500 on both sample days.
**Files modified:** `jackpot_04.py`, `jackpot_05.py`.
**Commit:** d2542b5.

## Authentication gates

None. Localhost indexer, no auth.

## Known Stubs

None. All exports wired; coverage gaps are logged discrepancy entries, not silent placeholders.

## Threat Flags

None beyond the plan's threat_model. T-19-03-01 through T-19-03-04 all mitigated as specified.

## Self-Check: PASSED

- FOUND: .planning/v2.3/validations/jackpot/burnie_budget.py
- FOUND: .planning/v2.3/validations/jackpot/jackpot_04.py
- FOUND: .planning/v2.3/validations/jackpot/jackpot_05.py
- FOUND: .planning/v2.3/validations/tests/test_jackpot_04.py (13 tests passing)
- FOUND: .planning/v2.3/validations/tests/test_jackpot_05.py (9 tests passing)
- FOUND: .planning/v2.3/validations/tests/fixtures/api/day-350-winners.json
- FOUND: .planning/v2.3/validations/tests/fixtures/api/day-500-winners.json
- FOUND: commit d2542b5 (Task 1 — BURNIE 75/25 + JACKPOT-04)
- FOUND: commit 69e334a (Task 2 — bonus-roll + JACKPOT-05)
- Full suite: 167 passed (145 prior + 22 new Phase 19-03)
- Citation hygiene: all Derivation.sources paths under `degenerus-audit/contracts/`; no stale references
- CLI: `--jackpot-04` / `--jackpot-05` / `--all` flags functional (verified via help output)

## Commits

- `d2542b5` — feat(19-03): BURNIE 75/25 validator + center-diamond check (JACKPOT-04)
- `69e334a` — feat(19-03): bonus-roll validator + per-quadrant totals (JACKPOT-05)
