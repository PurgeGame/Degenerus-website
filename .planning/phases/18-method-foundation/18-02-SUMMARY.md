---
phase: 18
plan: 02
subsystem: v2.3-harness
tags: [harness, python, derive, regimes, citations, wave-2]
requires:
  - 18-01 (harness.constants, harness.archetypes, pytest scaffold)
  - degenerus-audit/contracts (read-only, canonical source)
provides:
  - harness.regimes (fast_inputs, runout_inputs, inputs_for, RegimeInputs)
  - harness.derive (expected_values, DerivedField, DerivedValues)
  - 16 DerivedField keys exposed across jackpot/pools/player/terminal domains
affects:
  - phase 19-22 (call `expected_values(...)` once per sample; diff against live API)
  - phase 18-03 (renderer consumes DerivedField.formula + DerivedField.citations)
tech-stack:
  added: []
  patterns: [frozen dataclasses, Literal regime typing, per-domain builders, symbolic formulas for deferred-binding values]
key-files:
  created:
    - .planning/v2.3/harness/harness/regimes.py
    - .planning/v2.3/harness/harness/derive.py
    - .planning/v2.3/harness/tests/test_regimes.py
    - .planning/v2.3/harness/tests/test_derive.py
  modified:
    - .planning/v2.3/harness/harness/constants.py (backfilled 5 line=None citations)
decisions:
  - "Regime strings outside {'fast','runout'} raise ValueError with message listing allowed regimes (mechanical enforcement of user's 'not turbo/standard' directive)"
  - "Terminal per-ticket ETH and deposit-insurance ETH exposed as symbolic formulas; numeric references (~0.146, ~125) live in notes until Phase 22 binds live prize-pool data"
  - "stETH split canonical values remain 50/25/25 (per CLAUDE.md); citations now point at JackpotModule.sol:749/769 where the 23% quarterShare expression implements it (8% implementation buffer documented in notes, not in canonical values)"
  - "Runout regime annotates drip/drawdown fields with 'no new inflow' notes but keeps BPS values unchanged — contract math is regime-invariant; only inputs differ"
  - "Every DerivedField carries formula (plain text) + citations (>=1) + regime tag — enables Phase 19-22 to emit fully-attributed discrepancy entries"
metrics:
  duration: ~25 minutes
  completed: 2026-04-13
  commits: 5
  tests_added: 38 (15 regimes + 23 derive)
  derived_fields_exposed: 16
---

# Phase 18 Plan 02: METHOD Foundation — Derivation Layer Summary

**One-liner:** `expected_values(level, day, archetype, velocity_regime) -> DerivedValues` with per-domain helpers (jackpot/pools/player/terminal) covering all 4 archetypes x 2 regimes (8 permutations). Every field ships with a plain-text formula + at least one Citation rooted in `degenerus-audit/contracts/` or `theory/index.html`.

## What Was Built

### Backfill — `chore(18-02): backfill line=None citations in constants.py` (`5913076`)

Resolved 5 of the 6 `line=None` anchors flagged in 18-01-SUMMARY:

| Constant | Now cites | Source |
|---|---|---|
| STETH_ACCUMULATOR_BPS | `modules/DegenerusGameJackpotModule.sol:769` | `yieldAccumulator += quarterShare` |
| STETH_A_BPS | `modules/DegenerusGameJackpotModule.sol:749` | `quarterShare = (yieldPool * 2300) / 10_000` |
| STETH_B_BPS | `modules/DegenerusGameJackpotModule.sol:749` | same quarterShare expression |
| ACCUMULATOR_PER_LEVEL_BPS | `modules/DegenerusGameAdvanceModule.sol:129` | `INSURANCE_SKIM_BPS = 100` |
| DEATH_CLOCK_LEVEL_0_DAYS | `modules/DegenerusGameAdvanceModule.sol:108` | `DEPLOY_IDLE_TIMEOUT_DAYS = 365` |

The 6th (`COINFLIP_PAYOUT_MEAN`) remains `line=None` intentionally — it's a GT-paper-derived value, not a contract constant. Notes on each stETH constant explicitly document the canonical 50/25/25 vs implementation 23/23/23 (~8% buffer) reconciliation per CLAUDE.md.

### Task 1 — `test(18-02)` + `feat(18-02): implement regimes.py` (`112f0ca`, `3138ee0`)

`harness/regimes.py` with:
- `RegimeInputs` frozen dataclass (velocity_regime, level_transitions_per_day, new_deposits_flowing, death_clock_days_remaining, notes)
- `fast_inputs(level, day)` — transitions_per_day=1.0, deposits_flowing=True
- `runout_inputs(level, day)` — transitions_per_day=0.0, deposits_flowing=False
- `inputs_for(level, day, regime)` — dispatch; raises `ValueError` on anything outside `{"fast","runout"}` (turbo / standard / FAST / Runout / "" all rejected, error message names the allowed set)
- Death clock sourced via `harness.constants.get()` — level 0 → 365, level 1+ → 120. No sub-120 death clock fabricated; notes explicitly state "any sim-observed sub-120 value is a regime-induced divergence to log, not a contract constant."

15 tests passing.

### Task 2 — `test(18-02)` + `feat(18-02): implement derive.py` (`737c77f`, `b2f930a`)

`harness/derive.py` exposes:

| Domain | Fields |
|---|---|
| jackpot | jackpot_burnie_ratchet_tokens_per_ticket |
| pools | ticket_split_to_future_bps, lootbox_split_to_future_bps, future_drip_daily_bps, future_drawdown_on_transition_bps, steth_accumulator_share_bps, steth_a_share_bps, steth_b_share_bps, accumulator_per_level_bps, yield_accumulator_x00_dump_bps |
| player | activity_score_floor, lootbox_breakeven_score, lootbox_ev_cap_score, activity_score_max, coinflip_payout_mean, burnie_ratchet_tokens_per_ticket |
| terminal | death_clock_days_remaining, terminal_per_ticket_eth, deposit_insurance_terminal_eth |

**Total: 18 keys (one jackpot key overlaps the player burnie ratchet intentionally — jackpot rename prefix for phase-19 disambiguation).**

Public entry point signature matches plan exactly:

```python
def expected_values(
    level: int,
    day: int,
    archetype: ArchetypeName,
    velocity_regime: VelocityRegime,
) -> DerivedValues
```

## Archetype × Regime Coverage Matrix

| Archetype | fast | runout |
|---|---|---|
| Degen    | ✓ (activity_score_floor = 0.00) | ✓ |
| Grinder  | ✓ (activity_score_floor = 0.85) | ✓ |
| Whale    | ✓ (activity_score_floor = 1.15) | ✓ |
| Hybrid   | ✓ (activity_score_floor = 0.85) | ✓ |

All 8 permutations return a valid `DerivedValues` with all 16+ required field keys populated. Citation hygiene test walks every field across all 8 permutations and confirms no path contains `testing/contracts`, `degenerus-contracts/`, or `v1.1-*`.

## Symbolic-Only Formulas (Live Binding Deferred)

| Field | Symbolic expression | Numeric reference (notes) | Phase to bind |
|---|---|---|---|
| `terminal_per_ticket_eth` | `(currentPrizePool_at_terminal * WINNER_SHARE_BPS / 10_000) / terminal_ticket_count` | ~0.146 ETH (level-50 per CLAUDE.md MEMORY.md) | 22 |
| `deposit_insurance_terminal_eth` | `yieldAccumulator_retained_50pct_at_terminal` | ~125 ETH (accumulator 50% retained, 50% dumps at x00 per YIELD_ACCUMULATOR_X00_DUMP_BPS) | 22 |
| `jackpot_*` full payout formulas | (stub — single BURNIE ratchet key exposed) | — | 19 extends `_jackpot_fields` |

## Verification

```
cd .planning/v2.3/harness && pytest -q
# 59 passed in 0.03s  (21 wave-0 + 15 regimes + 23 derive)
```

- [x] `expected_values(level, day, archetype, velocity_regime)` returns DerivedValues for every valid input
- [x] All 4 archetypes covered with correct activity floors (0.00 / 0.85 / 1.15 / 0.85)
- [x] Both regimes derive from the same `degenerus-audit/contracts/` source
- [x] Every derived field carries formula + >=1 citation
- [x] `turbo`, `standard`, empty string, casing variants all rejected with ValueError
- [x] No citation path references `testing/contracts`, `degenerus-contracts`, or `v1.1-*`
- [x] Runout regime notes mention "no new inflow" on drip/drawdown fields
- [x] Death clock sourced from regime (level 0 → 365; level 1+ → 120)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Backfilled 5 line=None citations up front.** Plan's Task 1 implicitly required death-clock citations to resolve cleanly (`get("DEATH_CLOCK_LEVEL_0_DAYS")` was returning a Constant with `line=None`, which would have surfaced as a weaker citation in downstream Phase 19-22 discrepancy entries). Grepped the audit contracts, found the actual Solidity sites, and committed as a separate `chore(18-02)` commit before Task 1's TDD cycle. `COINFLIP_PAYOUT_MEAN` left `line=None` intentionally — it is a GT-paper derivation, not a named contract constant, so a line number would be misleading. Commit: `5913076`.

### Auth gates

None.

### Scope additions beyond the strict minimum

- Exposed `accumulator_per_level_bps` and `yield_accumulator_x00_dump_bps` in the pools domain (plan didn't require them but they're single-line `_from_constant` calls and Phase 22 needs them for the terminal-insurance derivation, so shipping now avoids a tiny 18-02.5 edit).
- Added `jackpot_burnie_ratchet_tokens_per_ticket` as a namespaced duplicate of the player-domain ratchet so Phase 19's jackpot helper can extend `_jackpot_fields` without reaching into `_player_fields`.

## Follow-ups for Phase 19-22

- **Phase 19 (JACKPOT):** Extend `_jackpot_fields` with per-day, per-trait payout formulas. The BURNIE ratchet is already wired; trait-bucket math and Roll 1/Roll 2 split still to come.
- **Phase 22 (TERMINAL):** Bind live `currentPrizePool_at_terminal` and `terminal_ticket_count` to replace the symbolic string value on `terminal_per_ticket_eth` with a real Decimal; same for `deposit_insurance_terminal_eth` (needs live `yieldAccumulator` reading).
- **Phase 18-03:** Schema + renderer consumes `DerivedField.formula` and `DerivedField.citations` as-is; no further derive.py changes anticipated.
- `FUTURE_DRAWDOWN_BPS` applies only on `(lvl % 100) != 0` per 18-01 follow-up; `_pools_fields` documents this in the formula text but the BPS value is returned unconditionally. Phase 19-22 harness consumers should branch on `lvl % 100 == 0` when comparing to observed drawdown.

## Self-Check

Verified:

- `.planning/v2.3/harness/harness/regimes.py` — present
- `.planning/v2.3/harness/harness/derive.py` — present
- `.planning/v2.3/harness/tests/test_regimes.py` — present
- `.planning/v2.3/harness/tests/test_derive.py` — present
- `.planning/v2.3/harness/harness/constants.py` — 5 line=None citations backfilled (1 intentional remainder)
- Commit `5913076` (constants backfill) present in `git log`
- Commit `112f0ca` (RED regimes) present in `git log`
- Commit `3138ee0` (GREEN regimes) present in `git log`
- Commit `737c77f` (RED derive) present in `git log`
- Commit `b2f930a` (GREEN derive) present in `git log`
- `pytest -q` exits 0 with 59 passed

## Self-Check: PASSED
