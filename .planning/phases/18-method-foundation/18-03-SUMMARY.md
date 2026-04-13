---
phase: 18
plan: 03
subsystem: v2.3-harness
tags: [harness, python, schema, yaml, render, smoke, wave-3]
requires:
  - 18-01 (harness.constants, harness.archetypes, pytest scaffold)
  - 18-02 (harness.regimes, harness.derive.expected_values)
  - degenerus-audit/contracts (read-only, canonical source)
provides:
  - harness.schema (Discrepancy / Citation / Derivation / Hypothesis / SampleContext)
  - harness.yaml_io (SafeLoader I/O + .planning/v2.3/ path guard)
  - harness.api (check_api_health + HealthSnapshot + get_json; strict lag > 10)
  - harness.render (YAML -> markdown, empty-safe)
  - harness.__main__ (CLI: --render / --smoke / --dump-constants / --dump-archetypes / --derive)
  - Public surface: from harness import expected_values, check_api_health, Discrepancy, render_report (+ 6 more)
  - .planning/v2.3/discrepancies.yaml (seeded DISC-018-001)
  - .planning/v2.3/reports/v2.3-consolidated.md (generated)
affects:
  - phases 19-22 (consume the public harness surface directly; no new scaffolding required)
  - phase 23 synthesis (reads structured YAML)
tech-stack:
  added: []  # all deps (pydantic 2, PyYAML 6, requests 2.31) already declared in 18-01
  patterns: [pydantic v2 field_validator, yaml.SafeLoader exclusive, resolve+relative_to path guard, argparse subcommand-by-flag CLI]
key-files:
  created:
    - .planning/v2.3/harness/harness/schema.py
    - .planning/v2.3/harness/harness/yaml_io.py
    - .planning/v2.3/harness/harness/api.py
    - .planning/v2.3/harness/harness/render.py
    - .planning/v2.3/harness/harness/__main__.py
    - .planning/v2.3/harness/tests/test_schema.py
    - .planning/v2.3/harness/tests/test_api.py
    - .planning/v2.3/harness/tests/test_render.py
    - .planning/v2.3/harness/tests/test_smoke.py
    - .planning/v2.3/discrepancies.yaml
    - .planning/v2.3/reports/.gitkeep
    - .planning/v2.3/reports/v2.3-consolidated.md (generated; not versioned policy TBD)
  modified:
    - .planning/v2.3/harness/harness/__init__.py (now re-exports public surface)
    - .planning/phases/18-method-foundation/18-VALIDATION.md (status: complete)
decisions:
  - "yaml_io path guard: resolve repo root via walk-up for .git; HARNESS_REPO_ROOT env var overrides (used by tests with tmp_path)"
  - "api.py exposes module-level requests_get alias so tests monkeypatch cleanly without stubbing the requests module itself"
  - "Exception messages on network/HTTP errors surface {URL, type-name, status} only — underlying exception text never passed through (T-18-03-03)"
  - "Empty-YAML render writes a non-error skeleton ('No discrepancies recorded') — renderer exerciseable before phases 19-22 start appending"
  - "Renderer groups by domain then sorts by severity (Critical>Major>Minor>Info) within domain; severity + domain count tables at top"
  - "DISC-018-001 seed references both JackpotModule.sol:749 and :769 (quarterShare AND yieldAccumulator credit) so the source-level example is fully cited end-to-end"
  - "CLI uses flag-style subcommand selection (--render / --smoke / etc) instead of argparse subparsers — keeps surface small; --smoke is gated by RUN_LIVE_SMOKE=1"
metrics:
  duration: ~18 minutes
  completed: 2026-04-13
  commits: 6
  tests_added: 51 (34 schema + 13 api + 2 render + 2 smoke)
  tests_total_phase_18: 110 (21 from 18-01 + 38 from 18-02 + 51 from 18-03)
---

# Phase 18 Plan 03: METHOD Foundation — Schema + I/O + Render + Smoke Summary

**One-liner:** Pydantic `Discrepancy` schema, SafeLoader-backed YAML I/O with path guard, `/health`-fronted `check_api_health()` (strict `lag > 10` flip), markdown renderer (empty-safe), argparse CLI, and an end-to-end smoke test seeded with the METHOD-02 stETH split source-level entry — closing Wave 3 with all 110 tests green.

## What Was Built

### Task 1 — schema.py + yaml_io.py

`test(18-03)` [38623d8] → `feat(18-03)` [065e946]

**`harness/schema.py`** — pydantic v2 models:

| Model | Notes |
|---|---|
| `Citation` | `field_validator("path")` rejects `testing/contracts`, `degenerus-contracts`, `v1.1-ECONOMICS-PRIMER` fragments |
| `Derivation` | `sources: list[Citation] = Field(min_length=1)` |
| `Hypothesis` | `text` + `falsifiable_by` both required |
| `SampleContext` | `lag_unreliable: bool`, `archetype: Archetype \| None` |
| `Discrepancy` | Root; `hypothesis` min_length=1; `suspected_source` literal excludes `whitepaper` **and** `expected_turbo_divergence` |

Allowed `SuspectedSource`: `gt_paper | contract | api | indexer | expected_fast_regime_divergence | expected_runout_divergence`.

**`harness/yaml_io.py`** — SafeLoader-exclusive I/O:

- `_validate_path(path)` resolves to absolute, requires `relative_to(<repo>/.planning/v2.3/)` — else `ValueError("path guard: …")`.
- `HARNESS_REPO_ROOT` env var overrides repo detection (tests point it at `tmp_path`).
- `load_discrepancies` returns `[]` for missing/empty; validates every entry via `Discrepancy.model_validate`.
- `save_discrepancies` writes `{discrepancies: [model_dump(mode="json") ...]}` via `yaml.safe_dump`.
- `append_discrepancy` = load + append + save (creates fresh file if missing).

34 tests covering every bullet in the plan's `<behavior>` block.

### Task 2 — api.py check_api_health

`test(18-03)` [fb076fc] → `feat(18-03)` [ba90b23]

- `HealthSnapshot` frozen dataclass with all 7 fields including `lag_unreliable` + ISO-8601 UTC `sampled_at`.
- `check_api_health()` hits `/health` (per 18-RESEARCH.md).
- Lag threshold is **strict** `>`: tested at `{0, 5, 10, 11, 100, 9999}` — boundary flip at 10→11.
- Exception messages surface URL + exception class name (connection error) or URL + HTTP status (server error). Underlying exception text (which could contain headers) is **not** passed through.
- Log-leak guard test sets `HARNESS_API_TOKEN=secret123`, triggers both connection-error and HTTP-500 paths, asserts `"secret123"` absent from raised message and from captured stdout/stderr.
- `get_json(path)` provided as the generic fetch wrapper phases 19-22 will call for non-`/health` endpoints.

13 tests green.

### Task 3 — render.py + __main__.py + seeded YAML + smoke

`test(18-03)` [a8c1e21] → `feat(18-03)` [d1105b6]

**`harness/render.py`**:
- Empty ledger → `# v2.3 Validation Report` / `## Summary` / "No discrepancies recorded".
- Populated ledger → summary tables (Severity × count, Domain × count) + `## Discrepancies by Domain` sections sorted by severity rank within domain.
- Each entry renders: endpoint, expected, observed, magnitude, suspected source, derivation formula, cited sources as `` `path:line` ``, sample context, hypotheses with falsifiability.

**`harness/__main__.py`** — flag-selected CLI:

| Flag | Effect |
|---|---|
| `--render` | Render `.planning/v2.3/discrepancies.yaml` → `.planning/v2.3/reports/v2.3-consolidated.md` |
| `--smoke` | Live; requires `RUN_LIVE_SMOKE=1`; hits `/health`, rerenders report |
| `--dump-constants` | JSON dump of the constant registry |
| `--dump-archetypes` | JSON dump of the archetype profiles |
| `--derive --level N --day D --archetype X --regime R` | JSON dump of `expected_values(...)` |

**`harness/__init__.py`** — public surface re-exports: `expected_values`, `check_api_health`, `get_json`, `Discrepancy`, `Citation`, `Derivation`, `Hypothesis`, `SampleContext`, `load_discrepancies`, `save_discrepancies`, `append_discrepancy`, `render_report`, `DerivedValues`, `DerivedField`, `HealthSnapshot`.

**`.planning/v2.3/discrepancies.yaml`** — seeded with `DISC-018-001`: stETH split 50/25/25 canonical (per CLAUDE.md) vs implementation `quarterShare = 2300 bps` with ~8% buffer. Citations to `DegenerusGameJackpotModule.sol:749`, `:769`, and `theory/index.html#steth-yield-split`. suspected_source=`gt_paper`, severity=`Minor`, domain=`POOLS`.

**`.planning/v2.3/reports/v2.3-consolidated.md`** — 1925 bytes generated via `python -m harness --render`:

```
# v2.3 Validation Report

## Summary
**Total discrepancies:** 1
| Severity | Count | … Minor = 1 …
| Domain   | Count | … POOLS = 1 …

## Discrepancies by Domain
### Domain: POOLS
### DISC-018-001 — Minor
- Endpoint: source-level:stETH-split
- Expected: 50/25/25 (accumulator/GameA/GameB)
- Observed: 46/23/23 (implementation quarterShare buffer reading)
- Suspected source: gt_paper
- Sources: DegenerusGameJackpotModule.sol:749, :769, theory/index.html#steth-yield-split
…
```

**Smoke test** (`test_smoke.py::test_end_to_end_smoke_writes_and_renders`) seeds `DISC-018-001` + 4 domain `Info` entries (`DISC-SMOKE-001..004` covering JACKPOT/POOLS/PLAYER/TERMINAL), each derived via `expected_values(level=1, day=1, "Grinder", "fast")` fields. Renders. Asserts every id, every domain, every endpoint, and both severity levels present. Exit 0.

**Public surface test** (`test_public_surface_imports`): imports the full list via `from harness import ...` and assert callability.

## Verification

```
cd .planning/v2.3/harness && pytest -v
# 110 passed in 0.08s  (21 wave-0 + 38 wave-2 + 51 wave-3)

python -m harness --render
# Wrote 1925 bytes to .planning/v2.3/reports/v2.3-consolidated.md
```

- [x] **METHOD-02** — Source-level stETH disagreement captured end-to-end in seeded YAML and rendered in report (DISC-018-001)
- [x] **METHOD-03** — Empty + populated YAML both render valid markdown with severity distribution
- [x] **METHOD-04** — Every required field enforced by pydantic; 10 parametrized missing-field tests green
- [x] **METHOD-05** — check_api_health flips lag_unreliable strictly on lag_blocks > 10; parametrized at {0,5,10,11,100,9999}
- [x] **Success Criterion #5** — `from harness import expected_values, check_api_health, Discrepancy, render_report` works; smoke test exercises one call per JACKPOT/POOLS/PLAYER/TERMINAL
- [x] Whitepaper rejected as suspected_source at schema level
- [x] Regime names "fast"/"runout" enforced; "turbo"/"standard"/"expected_turbo_divergence" rejected
- [x] yaml_io uses `yaml.safe_load`/`yaml.safe_dump` exclusively; `!!python/object/apply` payload test asserts ConstructorError, no execution
- [x] Path guard blocks `/etc/passwd`, traversal via `..`, and any absolute path outside `.planning/v2.3/`
- [x] No env-var leakage in api.py error paths (HARNESS_API_TOKEN=secret123 absent from all raised messages)

## Threat Model Coverage

| Threat ID | Mitigation | Test |
|---|---|---|
| T-18-03-01 (YAML deserialization) | `yaml.safe_load` exclusively | `test_safe_loader_blocks_python_object_payload` |
| T-18-03-02 (Path traversal) | `_validate_path` resolve + relative_to | `test_path_guard_rejects_{outside,etc_passwd,traversal}` |
| T-18-03-03 (Env leak in logs/errors) | URL + type-name only; underlying exception dropped | `test_{network,http}_error_...does_not_leak_env_secrets` |
| T-18-03-04 (Stale citation sneak-in) | `Citation.field_validator` rejects fragments at load | `test_citation_rejects_stale_paths` |
| T-18-03-05 (Spoof suspected_source) | Literal excludes whitepaper + turbo divergences | `test_suspected_source_{whitepaper,expected_turbo}_rejected` |

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Scope additions

- `get_json(path)` added to `api.py` (plan listed it in the interface block but did not require tests). Shipped a pass-through test (`test_get_json_returns_decoded_json`) so phases 19-22 get a verified, reusable helper for non-`/health` reads.
- `HARNESS_REPO_ROOT` env-var override is exposed (plan anticipated it for tests); documented in `yaml_io.py` module docstring so phases 19-22 can rely on it deterministically.

### Auth gates

None. The live smoke (`--smoke` with `RUN_LIVE_SMOKE=1`) requires localhost:3000 but is gated behind an env var and not exercised in the pytest run (pytest uses a captured-fixture equivalent via the end-to-end smoke that calls `expected_values(...)` directly).

## Endpoints from the 26-route list NOT yet exercised

The smoke test exercises exactly four endpoints — one per domain — using placeholder strings:

| Domain | Endpoint | Field |
|---|---|---|
| JACKPOT | `/jackpot/current` | `jackpot_burnie_ratchet_tokens_per_ticket` |
| POOLS | `/pools/state` | `ticket_split_to_future_bps` |
| PLAYER | `/player/activity` | `activity_score_floor` |
| TERMINAL | `/terminal/state` | `death_clock_days_remaining` |

Phases 19-22 pick up the remaining 22 endpoints in the 26-route list (per 18-RESEARCH.md). The harness imposes **no** scaffolding work on them: just `from harness import check_api_health, get_json, expected_values, append_discrepancy, Discrepancy`, call `get_json(endpoint)`, diff against `expected_values(...).fields[name].value`, and append a validated `Discrepancy`.

## Phase 18 Totals (across 18-01, 18-02, 18-03)

- **Tests:** 110 passing, 0 failing
- **Commits:** 11 (2 + 5 + 6 in wave order, counting RED/GREEN separately)
- **Derived field keys exposed:** 16
- **Constants registered:** 22 with canonical citations
- **Archetypes:** 4 primary + Deity overlay
- **Velocity regimes:** 2 (fast, runout)
- **Security invariants:** 5 (YAML safe-load, path guard, env-leak guard, citation stale-path guard, suspected_source literal policy) — each with a dedicated test

## Self-Check

Verified:

- `.planning/v2.3/harness/harness/schema.py` — present
- `.planning/v2.3/harness/harness/yaml_io.py` — present
- `.planning/v2.3/harness/harness/api.py` — present
- `.planning/v2.3/harness/harness/render.py` — present
- `.planning/v2.3/harness/harness/__main__.py` — present
- `.planning/v2.3/harness/harness/__init__.py` — updated public surface
- `.planning/v2.3/harness/tests/test_schema.py` — present
- `.planning/v2.3/harness/tests/test_api.py` — present
- `.planning/v2.3/harness/tests/test_render.py` — present
- `.planning/v2.3/harness/tests/test_smoke.py` — present
- `.planning/v2.3/discrepancies.yaml` — present, contains DISC-018-001
- `.planning/v2.3/reports/.gitkeep` — present
- `.planning/v2.3/reports/v2.3-consolidated.md` — generated (1925 bytes)
- Commit `38623d8` (RED schema) present
- Commit `065e946` (GREEN schema + yaml_io) present
- Commit `fb076fc` (RED api) present
- Commit `ba90b23` (GREEN api) present
- Commit `a8c1e21` (RED render + smoke) present
- Commit `d1105b6` (GREEN render + CLI + seed) present
- `pytest -q` exits 0 with 110 passed
- `python -m harness --render` writes non-empty report

## Self-Check: PASSED
