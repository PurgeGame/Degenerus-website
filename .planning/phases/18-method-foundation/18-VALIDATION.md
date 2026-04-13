---
phase: 18
slug: method-foundation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-13
updated: 2026-04-13
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (harness unit tests + smoke tests) |
| **Config file** | `.planning/v2.3/harness/pyproject.toml` (18-01 creates) |
| **Quick run command** | `cd .planning/v2.3/harness && pytest -x --no-header -q` |
| **Full suite command** | `cd .planning/v2.3/harness && pytest -v` |
| **Live smoke gate** | `RUN_LIVE_SMOKE=1 cd .planning/v2.3/harness && python -m harness --smoke` |
| **Estimated runtime** | ~5s unit / ~15s with smoke against localhost:3000 |

---

## Sampling Rate

- **After every task commit:** Run quick command (unit only, no network).
- **After every plan wave:** Run full suite (includes render test; smoke optional).
- **Before `/gsd-verify-work`:** Full suite green + `python -m harness --render` succeeds from seeded YAML + public import surface verified.
- **Max feedback latency:** 15 seconds.

---

## Per-Task Verification Map

| Plan | Task | Requirement | Automated Command | Wave 0 Dep |
|------|------|-------------|-------------------|-----------|
| 18-01 | 1 (pyproject + conftest) | METHOD-01 scaffold | `cd .planning/v2.3/harness && pip install -e .[dev] >/dev/null && pytest -q` | self (this task satisfies Wave 0) |
| 18-01 | 2 (constants + archetypes + tests) | METHOD-01 | `cd .planning/v2.3/harness && pytest tests/test_constants.py tests/test_archetypes.py -v` | 18-01 Task 1 |
| 18-02 | 1 (regimes.py + tests) | METHOD-01 | `cd .planning/v2.3/harness && pytest tests/test_regimes.py -v` | 18-01 |
| 18-02 | 2 (derive.py + tests) | METHOD-01, METHOD-02 | `cd .planning/v2.3/harness && pytest tests/test_derive.py -v` | 18-01, 18-02 Task 1 |
| 18-03 | 1 (schema + yaml_io + tests) | METHOD-03, METHOD-04 | `cd .planning/v2.3/harness && pytest tests/test_schema.py -v` | 18-01 |
| 18-03 | 2 (api.py check_api_health + tests) | METHOD-05 | `cd .planning/v2.3/harness && pytest tests/test_api.py -v` | 18-01 |
| 18-03 | 3 (render + __main__ + smoke) | METHOD-02, METHOD-03, Success Criterion #5 | `cd .planning/v2.3/harness && pytest tests/test_render.py tests/test_smoke.py -v && python -m harness --render && test -s ../reports/v2.3-consolidated.md` | 18-01, 18-02, 18-03 Tasks 1-2 |

### Coverage by requirement

- **METHOD-01** (harness derivation): 18-01 Task 2 (constants + archetypes) + 18-02 Tasks 1-2 (regimes + derive.py). Asserts `expected_values(level, day, archetype, velocity_regime)` across all four archetypes × both regimes.
- **METHOD-02** (cross-source disagreement): 18-02 Task 2 (formulas carry citations) + 18-03 Task 3 (seeded stETH source-level entry written end-to-end through YAML + renderer).
- **METHOD-03** (report schema + renderer): 18-03 Task 1 (pydantic Discrepancy) + 18-03 Task 3 (render empty + populated YAML).
- **METHOD-04** (required fields): 18-03 Task 1 test_schema.py parametrized suite covering every required field.
- **METHOD-05** (lag tagging): 18-03 Task 2 — mocks lagBlocks ∈ {0, 5, 10, 11, 100, 9999}; asserts strict > 10 threshold flips lag_unreliable.

### Success criteria cross-check

| Success Criterion | Plan/Task |
|------|------|
| 1. Harness returns expected values per (level, day, archetype, velocity_regime) | 18-02 T2 |
| 2. One source-level disagreement captured end-to-end | 18-03 T3 (seeded DISC-018-001) |
| 3. Discrepancy YAML schema + renderer produces markdown with all required fields | 18-03 T1 + T3 |
| 4. check_api_health() enforces lagBlocks > 10 tagging mechanically | 18-03 T2 |
| 5. Phase 18 output exercisable by phases 19-22 without scaffolding | 18-03 T3 (4-domain smoke + `from harness import ...` public surface test) |

---

## Wave 0 Requirements

- [x] `.planning/v2.3/harness/pyproject.toml` — created by 18-01 Task 1
- [x] `.planning/v2.3/harness/tests/conftest.py` — created by 18-01 Task 1 (extended by 18-03 with mock-requests helper if needed)
- [x] `.planning/v2.3/harness/tests/__init__.py` — created by 18-01 Task 1
- [x] Python 3.11+ assumed (repo precedent: `build-gta-html.py`, `restructure.py`)

Wave 0 is satisfied by 18-01 Task 1 before any downstream task runs — dependency chain: 18-01 T1 → 18-01 T2 → 18-02 (both tasks) → 18-03 (all tasks).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Smoke: harness exercisable by phases 19–22 without new scaffolding | Success Criterion #5 | Validates downstream consumer surface | After Phase 18 complete, a human reviewer drafts one discrepancy call per domain (jackpot/pools/player/terminal) importing only from `harness`; confirms YAML entries validate and render |
| Live API agreement with seeded source-level entry | Success Criterion #2 | Proves pipeline derivation → YAML → rendered report works with a real known mismatch | `RUN_LIVE_SMOKE=1 python -m harness --smoke` against localhost:3000; verify rendered report includes DISC-018-001 with `suspected_source: gt_paper` |

---

## Validation Sign-Off

- [x] Every task has an automated verify command
- [x] No 3 consecutive tasks without automated verify
- [x] Wave 0 covers pyproject.toml + conftest.py + package scaffold
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set (every task has `<automated>`)
- [x] `wave_0_complete: true` set (18-01 Task 1 establishes the pytest harness before any test-dependent task runs)

**Approval:** ready-to-execute
