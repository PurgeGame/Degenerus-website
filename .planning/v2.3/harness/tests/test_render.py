"""Tests for harness.render: empty and populated YAML -> markdown."""

from __future__ import annotations

from pathlib import Path

import pytest

from harness.render import render_report
from harness.schema import Discrepancy
from harness import yaml_io


def _set_repo_root(monkeypatch, tmp_path: Path) -> Path:
    v23 = tmp_path / ".planning" / "v2.3"
    v23.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("HARNESS_REPO_ROOT", str(tmp_path))
    return v23


def _minimal(id_: str = "DISC-TEST-001", domain: str = "POOLS", severity: str = "Minor") -> Discrepancy:
    return Discrepancy(
        id=id_,
        domain=domain,  # type: ignore[arg-type]
        endpoint="/pools/state",
        expected_value="1000 bps",
        derivation={
            "formula": "x * A_BPS / 10_000",
            "sources": [
                {
                    "path": "degenerus-audit/contracts/DegenerusGame.sol",
                    "line": 160,
                    "label": "contract",
                    "anchor": None,
                }
            ],
        },
        observed_value="900 bps",
        magnitude="10% underflow",
        severity=severity,  # type: ignore[arg-type]
        suspected_source="gt_paper",
        hypothesis=[{"text": "x", "falsifiable_by": "y"}],
        sample_context={
            "day": 5,
            "level": 3,
            "archetype": "Degen",
            "lag_blocks": 2,
            "lag_unreliable": False,
            "sampled_at": "2026-04-13T12:00:00Z",
        },
    )


def test_render_empty_yaml_produces_skeleton(tmp_path, monkeypatch):
    v23 = _set_repo_root(monkeypatch, tmp_path)
    src = v23 / "empty.yaml"
    yaml_io.save_discrepancies(src, [])
    out = v23 / "report.md"
    render_report(src, out)
    text = out.read_text()
    assert "# v2.3 Validation Report" in text
    assert "## Summary" in text
    assert "No discrepancies recorded" in text


def test_render_populated_yaml_groups_by_domain(tmp_path, monkeypatch):
    v23 = _set_repo_root(monkeypatch, tmp_path)
    src = v23 / "populated.yaml"
    items = [
        _minimal("DISC-001", "POOLS", "Minor"),
        _minimal("DISC-002", "POOLS", "Critical"),
        _minimal("DISC-003", "JACKPOT", "Major"),
        _minimal("DISC-004", "PLAYER", "Info"),
        _minimal("DISC-005", "TERMINAL", "Info"),
    ]
    yaml_io.save_discrepancies(src, items)
    out = v23 / "report.md"
    render_report(src, out)
    text = out.read_text()

    # Severity summary
    assert "## Summary" in text
    assert "Critical" in text
    assert "Major" in text
    assert "Minor" in text
    assert "Info" in text

    # Grouping by domain
    assert "## Discrepancies by Domain" in text
    for domain in ("JACKPOT", "POOLS", "PLAYER", "TERMINAL"):
        assert domain in text

    # Each id appears
    for id_ in ("DISC-001", "DISC-002", "DISC-003", "DISC-004", "DISC-005"):
        assert id_ in text

    # Suspected source rendered
    assert "gt_paper" in text

    # Citation rendered as path:line
    assert "degenerus-audit/contracts/DegenerusGame.sol" in text
    assert ":160" in text or "160" in text
