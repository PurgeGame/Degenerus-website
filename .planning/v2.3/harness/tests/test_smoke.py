"""End-to-end smoke: seed source-level entry + 4 domain entries -> render.

Also verifies the public import surface the plan promises phases 19-22
will consume:

    from harness import expected_values, check_api_health, Discrepancy, render_report
"""

from __future__ import annotations

from pathlib import Path

import pytest


def _set_repo_root(monkeypatch, tmp_path: Path) -> Path:
    v23 = tmp_path / ".planning" / "v2.3"
    v23.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("HARNESS_REPO_ROOT", str(tmp_path))
    return v23


def test_public_surface_imports():
    from harness import (
        Discrepancy,
        DerivedValues,
        HealthSnapshot,
        append_discrepancy,
        check_api_health,
        expected_values,
        load_discrepancies,
        render_report,
        save_discrepancies,
    )

    assert callable(expected_values)
    assert callable(check_api_health)
    assert callable(render_report)


def test_end_to_end_smoke_writes_and_renders(tmp_path, monkeypatch):
    """Write 1 source-level + 4 domain entries; render; assert report contents."""
    from harness import (
        Discrepancy,
        append_discrepancy,
        expected_values,
        render_report,
    )

    v23 = _set_repo_root(monkeypatch, tmp_path)
    yaml_path = v23 / "discrepancies.yaml"
    report_path = v23 / "reports" / "v2.3-consolidated.md"

    # 1. Source-level entry (METHOD-02 stETH split example)
    source_entry = Discrepancy(
        id="DISC-018-001",
        domain="POOLS",
        endpoint="source-level:stETH-split",
        expected_value="50/25/25 (accumulator/GameA/GameB)",
        derivation={
            "formula": "canonical stETH yield split per CLAUDE.md",
            "sources": [
                {
                    "path": "degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol",
                    "line": 749,
                    "label": "contract",
                    "anchor": "quarterShare",
                },
                {
                    "path": "theory/index.html",
                    "line": None,
                    "label": "gt_paper",
                    "anchor": "steth-yield-split",
                },
            ],
        },
        observed_value="46/23/23 (hypothetical stale GT paper reference)",
        magnitude="~8% nominal mismatch (implementation buffer documented in constants)",
        severity="Minor",
        suspected_source="gt_paper",
        hypothesis=[
            {
                "text": "Paper states older split; canonical is 50/25/25.",
                "falsifiable_by": "Re-read audit contract JackpotModule.sol:749 quarterShare expression.",
            }
        ],
        sample_context={
            "day": 0,
            "level": 0,
            "archetype": None,
            "lag_blocks": 0,
            "lag_unreliable": False,
            "sampled_at": "2026-04-13T00:00:00Z",
        },
        notes="Seeded by 18-03 smoke test per plan spec.",
    )
    append_discrepancy(yaml_path, source_entry)

    # 2. One Info-level domain entry per domain, each driven by expected_values(...)
    ev = expected_values(level=1, day=1, archetype="Grinder", velocity_regime="fast")
    domain_endpoints = [
        ("JACKPOT", "/jackpot/current", "jackpot_burnie_ratchet_tokens_per_ticket"),
        ("POOLS", "/pools/state", "ticket_split_to_future_bps"),
        ("PLAYER", "/player/activity", "activity_score_floor"),
        ("TERMINAL", "/terminal/state", "death_clock_days_remaining"),
    ]
    for i, (domain, endpoint, field_name) in enumerate(domain_endpoints, start=1):
        field = ev.fields[field_name]
        entry = Discrepancy(
            id=f"DISC-SMOKE-{i:03d}",
            domain=domain,  # type: ignore[arg-type]
            endpoint=endpoint,
            expected_value=str(field.value),
            derivation={
                "formula": field.formula,
                "sources": [
                    {
                        "path": c.path,
                        "line": c.line,
                        "label": c.label,
                        "anchor": c.anchor,
                    }
                    for c in field.citations
                ],
            },
            observed_value="(smoke placeholder — phases 19-22 bind live)",
            magnitude="N/A",
            severity="Info",
            suspected_source="api",
            hypothesis=[
                {
                    "text": f"Smoke-test placeholder for {domain} domain.",
                    "falsifiable_by": f"Phase {18+i} binds real observed value at {endpoint}.",
                }
            ],
            sample_context={
                "day": 1,
                "level": 1,
                "archetype": "Grinder",
                "lag_blocks": 0,
                "lag_unreliable": False,
                "sampled_at": "2026-04-13T00:00:00Z",
            },
        )
        append_discrepancy(yaml_path, entry)

    # 3. Render
    render_report(yaml_path, report_path)
    text = report_path.read_text()

    # 4. Assertions
    assert text  # non-empty
    assert "DISC-018-001" in text
    for domain in ("JACKPOT", "POOLS", "PLAYER", "TERMINAL"):
        assert domain in text
    for _, endpoint, _ in domain_endpoints:
        assert endpoint in text
    for severity in ("Minor", "Info"):
        assert severity in text
