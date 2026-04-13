---
phase: 18
plan: 01
subsystem: v2.3-harness
tags: [harness, python, scaffolding, citations, archetypes, wave-0]
requires:
  - degenerus-audit/contracts (read-only, canonical source)
provides:
  - .planning/v2.3/harness/ (installable Python package)
  - harness.constants (typed Constant + Citation surface)
  - harness.archetypes (four primary archetypes + Deity overlay + VELOCITY_REGIMES)
  - tests/conftest.py fixtures (tmp_yaml_path, sample_citation, sample_constant, sample_archetype)
affects:
  - phase 18-02 (imports harness.constants, harness.archetypes)
  - phase 18-03 (imports harness.constants, extends conftest)
  - phases 19-22 (public `from harness import ...` surface starts here)
tech-stack:
  added: [pytest 7+, requests 2.31+, PyYAML 6+, pydantic 2+]
  patterns: [frozen dataclasses, Literal typing, registry dict keyed by name]
key-files:
  created:
    - .planning/v2.3/harness/pyproject.toml
    - .planning/v2.3/harness/harness/__init__.py
    - .planning/v2.3/harness/harness/constants.py
    - .planning/v2.3/harness/harness/archetypes.py
    - .planning/v2.3/harness/tests/__init__.py
    - .planning/v2.3/harness/tests/conftest.py
    - .planning/v2.3/harness/tests/test_constants.py
    - .planning/v2.3/harness/tests/test_archetypes.py
  modified: []
decisions:
  - "Citation.path canonical prefixes enforced by test: degenerus-audit/contracts/, degenerus-audit/audit/, theory/index.html"
  - "CitationLabel literal = {contract, gt_paper, audit_doc} — NO turbo_spec label"
  - "VELOCITY_REGIMES = {'fast', 'runout'} — NOT turbo/standard (user directive)"
  - "AFFILIATE_DGNRS_DEITY_CAP_WEI stored as str (not int) to avoid unintended float coercion in YAML round-trip"
  - "Inline Solidity values (FUTURE_DRIP_BPS=100, FUTURE_DRAWDOWN_BPS=1500) cite the computation line and explicitly note 'not a named constant' in Constant.notes"
metrics:
  duration: ~12 minutes
  completed: 2026-04-13
  commits: 2
  tests_added: 21
  constants_registered: 22
---

# Phase 18 Plan 01: METHOD Foundation — Harness Scaffold Summary

**One-liner:** Installable `harness/` Python package with typed `Constant`+`Citation` registry, four archetype profiles, velocity-regime literals, and 21 unit tests locking the contract-source policy.

## What Was Built

Wave 0 for the v2.3 milestone: a clean import surface that phases 18-02 (regimes + derive) and 18-03 (schema + api + render) will extend.

### Task 1 — `feat(18-01): scaffold v2.3 derivation harness package` (`fe0ae42`)

- `pyproject.toml`: editable install with `requests>=2.31`, `PyYAML>=6.0`, `pydantic>=2.0`; `dev` extra adds `pytest>=7`; `testpaths=["tests"]`, `addopts="-x --no-header"`.
- `harness/__init__.py`: exposes `__version__ = "0.1.0"`; intentionally does not import submodules (avoid cycles before 18-02/18-03 populate them).
- `tests/conftest.py`: fixtures `tmp_yaml_path`, `sample_citation`, `sample_constant`, `sample_archetype`. Imports limited to modules that exist as of 18-01.
- Baseline `pytest -q` exits 0 with "no tests ran".

### Task 2 — `feat(18-01): populate constants + archetypes with citations + tests` (`a6a71d4`)

**22 constants registered** across categories:

| Category | Constants |
|---|---|
| Purchase split (90/10) | PURCHASE_TO_FUTURE_BPS, PURCHASE_TO_NEXT_BPS |
| Lootbox split (post-presale 10/90, presale 50/30/20) | LOOTBOX_TO_FUTURE_BPS, LOOTBOX_TO_NEXT_BPS, LOOTBOX_PRESALE_TO_FUTURE_BPS, LOOTBOX_PRESALE_TO_NEXT_BPS, LOOTBOX_PRESALE_TO_VAULT_BPS |
| Future pool dynamics | FUTURE_DRIP_BPS, FUTURE_DRAWDOWN_BPS, YIELD_ACCUMULATOR_X00_DUMP_BPS |
| stETH yield split (50/25/25) | STETH_ACCUMULATOR_BPS, STETH_A_BPS, STETH_B_BPS |
| Per-level accumulator | ACCUMULATOR_PER_LEVEL_BPS |
| Activity score | ACTIVITY_MAX_BPS, STREAK_FLOOR_BPS, MINT_FLOOR_BPS, DEITY_PASS_ACTIVITY_BONUS_BPS |
| Deity cap | DEITY_PASS_MAX_TOTAL |
| Death clock | DEATH_CLOCK_LEVEL_0_DAYS, DEATH_CLOCK_LEVEL_1_PLUS_DAYS |
| BURNIE ratchet | PRICE_COIN_UNIT_ETHER |
| Affiliate / DGNRS | AFFILIATE_DGNRS_DEITY_BONUS_BPS, AFFILIATE_DGNRS_DEITY_CAP_WEI |
| Coinflip | COINFLIP_PAYOUT_MEAN (gt_paper cite) |

**Four archetype profiles** (Degen 0.00 / Grinder 0.85 / Whale 1.15 / Hybrid 0.85), `VELOCITY_REGIMES = frozenset({"fast","runout"})`, overlay thresholds (`DEITY_FLOOR=1.55`, `LOOTBOX_BREAKEVEN=0.60`, `LOOTBOX_EV_CAP=2.55`, `ACTIVITY_MAX=3.05`).

### Test counts

- `test_constants.py`: 14 tests (registry, citation shape, forbidden-fragment guard, canonical-prefix guard, known BPS values, death clock, activity bounds, deity cap, affiliate, price coin unit, `get` happy/KeyError, `all_citations` coverage, int-valued units).
- `test_archetypes.py`: 7 tests (four primary archetypes, profile type, activity floors, deity overlay, velocity regime sentinel, primary products shape, sample_archetype fixture).
- Total: **21 passing**, 0 failing.

## Verification

```
cd .planning/v2.3/harness && pytest tests/test_constants.py tests/test_archetypes.py -v
# 21 passed in 0.02s
```

- [x] `pip install -e .[dev]` succeeds
- [x] Every registered Constant has a Citation with a canonical path prefix and a valid label
- [x] No citation path references `testing/contracts`, `degenerus-contracts`, or any `v1.1-*` primer filename (enforced by `test_no_stale_primer_refs`)
- [x] Four primary archetypes exported with correct floors
- [x] `VELOCITY_REGIMES == {"fast","runout"}` (NOT turbo/standard)
- [x] Deity overlay thresholds match GT paper numbers
- [x] `get()` raises KeyError on unknown name

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Clarifications worth flagging to 18-02

**1. Constants with `line=None` (require 18-02 backfill):**

Per plan directive: "if a constant isn't findable at implementation time, leave line=None and notes='line TBD'". The following constants were registered with `line=None` and a grep anchor in `notes` because the underlying values are inline expressions or split across functions without a named Solidity constant:

| Constant | Canonical file | Grep anchor |
|---|---|---|
| STETH_ACCUMULATOR_BPS | DegenerusGame.sol | stETH harvest / yieldAccumulator increment |
| STETH_A_BPS | DegenerusGame.sol | stETH yield split |
| STETH_B_BPS | DegenerusGame.sol | stETH yield split |
| ACCUMULATOR_PER_LEVEL_BPS | DegenerusGameAdvanceModule.sol | accumulator increment on level advance |
| DEATH_CLOCK_LEVEL_0_DAYS | DegenerusGame.sol | death-clock seeding on level 0 |
| COINFLIP_PAYOUT_MEAN | theory/index.html | coinflip derivation (not a contract constant) |

`FUTURE_DRIP_BPS` (line 523 of JackpotModule) and `FUTURE_DRAWDOWN_BPS` (line 805 of AdvanceModule) are inline literals — not named Solidity constants — but the exact computation line was locatable, so they cite those lines with an explicit note.

**2. Solidity naming vs harness naming:**

| Harness name | Solidity name | Rationale |
|---|---|---|
| `LOOTBOX_TO_FUTURE_BPS` | `LOOTBOX_SPLIT_FUTURE_BPS` | Consistent `_TO_<pool>_BPS` suffix across all split constants |
| `STREAK_FLOOR_BPS` | `PASS_STREAK_FLOOR_POINTS` (= 50 on 0-100 scale) | Harness normalizes points→bps (×100) |
| `MINT_FLOOR_BPS` | `PASS_MINT_COUNT_FLOOR_POINTS` (= 25) | Same normalization |
| `ACTIVITY_MAX_BPS` | `ACTIVITY_SCORE_MAX_BPS` | Shorter; same value 30500 |

Auth gates: None.

## Follow-ups for 18-02

- Backfill the six `line=None` citations above by greping the exact increment/split sites.
- `FUTURE_DRAWDOWN_BPS` is only applied on `(lvl % 100) != 0` (non-x00 levels); derive.py must branch on that condition.
- `PURCHASE_TO_FUTURE_BPS` / `LOOTBOX_TO_FUTURE_BPS` pair is the central reason grinder-heavy composition inflates futurepool — 18-02 pool-flow derivation will reuse both.

## Self-Check

Verified:

- `.planning/v2.3/harness/pyproject.toml` — present
- `.planning/v2.3/harness/harness/__init__.py` — present
- `.planning/v2.3/harness/harness/constants.py` — present
- `.planning/v2.3/harness/harness/archetypes.py` — present
- `.planning/v2.3/harness/tests/conftest.py` — present
- `.planning/v2.3/harness/tests/test_constants.py` — present
- `.planning/v2.3/harness/tests/test_archetypes.py` — present
- Commit `fe0ae42` present in `git log`
- Commit `a6a71d4` present in `git log`
- `pytest -q` exits 0 with 21 passed

## Self-Check: PASSED
