"""Tests for harness.schema (pydantic Discrepancy model) and harness.yaml_io.

Covers:
- Required-field enforcement (parametrized per required field).
- Source policy (whitepaper, expected_turbo_divergence both rejected).
- Citation stale-path guard.
- Derivation/hypothesis min_length=1.
- SampleContext.lag_unreliable round-trips.
- yaml_io SafeLoader blocks !!python/object payloads.
- yaml_io round-trip equality.
- yaml_io path guard (outside .planning/v2.3/ raises ValueError).
- append_discrepancy on empty file.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from harness.schema import (
    Citation,
    Derivation,
    Discrepancy,
    Hypothesis,
    SampleContext,
)
from harness import yaml_io


# ---------------------------------------------------------------------------
# Fixture: valid minimal discrepancy dict
# ---------------------------------------------------------------------------


def _valid_citation_dict() -> dict:
    return {
        "path": "degenerus-audit/contracts/DegenerusGame.sol",
        "line": 160,
        "label": "contract",
        "anchor": None,
    }


def _valid_discrepancy_dict() -> dict:
    return {
        "id": "DISC-TEST-001",
        "domain": "POOLS",
        "endpoint": "/pools/state",
        "expected_value": "1000 bps",
        "derivation": {
            "formula": "ticket_eth * PURCHASE_TO_FUTURE_BPS / 10_000",
            "sources": [_valid_citation_dict()],
        },
        "observed_value": "900 bps",
        "magnitude": "10% underflow",
        "severity": "Minor",
        "suspected_source": "gt_paper",
        "hypothesis": [
            {
                "text": "Indexer misread field",
                "falsifiable_by": "Re-query contract storage directly",
            }
        ],
        "sample_context": {
            "day": 5,
            "level": 3,
            "archetype": "Degen",
            "lag_blocks": 2,
            "lag_unreliable": False,
            "sampled_at": "2026-04-13T12:00:00Z",
        },
        "notes": None,
    }


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_valid_minimal_discrepancy_constructs():
    d = Discrepancy(**_valid_discrepancy_dict())
    assert d.id == "DISC-TEST-001"
    assert d.domain == "POOLS"
    assert d.sample_context.lag_unreliable is False


# ---------------------------------------------------------------------------
# Missing required fields (parametrized)
# ---------------------------------------------------------------------------


REQUIRED_FIELDS = [
    "domain",
    "endpoint",
    "expected_value",
    "derivation",
    "observed_value",
    "magnitude",
    "severity",
    "suspected_source",
    "hypothesis",
    "sample_context",
]


@pytest.mark.parametrize("field_name", REQUIRED_FIELDS)
def test_missing_required_field_raises(field_name: str):
    data = _valid_discrepancy_dict()
    del data[field_name]
    with pytest.raises(ValidationError):
        Discrepancy(**data)


# ---------------------------------------------------------------------------
# SuspectedSource literal policy
# ---------------------------------------------------------------------------


def test_suspected_source_whitepaper_rejected():
    data = _valid_discrepancy_dict()
    data["suspected_source"] = "whitepaper"
    with pytest.raises(ValidationError):
        Discrepancy(**data)


def test_suspected_source_expected_turbo_rejected():
    data = _valid_discrepancy_dict()
    data["suspected_source"] = "expected_turbo_divergence"
    with pytest.raises(ValidationError):
        Discrepancy(**data)


@pytest.mark.parametrize(
    "source",
    [
        "gt_paper",
        "contract",
        "api",
        "indexer",
        "expected_fast_regime_divergence",
        "expected_runout_divergence",
    ],
)
def test_suspected_source_accepted(source: str):
    data = _valid_discrepancy_dict()
    data["suspected_source"] = source
    Discrepancy(**data)  # no raise


# ---------------------------------------------------------------------------
# Citation stale-path guard
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_path",
    [
        "testing/contracts/DegenerusGame.sol",
        "degenerus-contracts/DegenerusGame.sol",
        "audit/v1.1-ECONOMICS-PRIMER.md",
    ],
)
def test_citation_rejects_stale_paths(bad_path: str):
    with pytest.raises(ValidationError):
        Citation(path=bad_path, line=1, label="contract")


def test_citation_accepts_canonical_path():
    c = Citation(
        path="degenerus-audit/contracts/DegenerusGame.sol",
        line=160,
        label="contract",
    )
    assert c.path.startswith("degenerus-audit/contracts/")


# ---------------------------------------------------------------------------
# Derivation + Hypothesis min_length
# ---------------------------------------------------------------------------


def test_derivation_rejects_empty_sources():
    with pytest.raises(ValidationError):
        Derivation(formula="foo", sources=[])


def test_hypothesis_list_rejects_empty():
    data = _valid_discrepancy_dict()
    data["hypothesis"] = []
    with pytest.raises(ValidationError):
        Discrepancy(**data)


# ---------------------------------------------------------------------------
# SampleContext.lag_unreliable round-trips True and False
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("flag", [True, False])
def test_sample_context_lag_unreliable_roundtrip(flag: bool):
    sc = SampleContext(
        day=1,
        level=1,
        archetype="Degen",
        lag_blocks=0 if not flag else 99,
        lag_unreliable=flag,
        sampled_at="2026-04-13T00:00:00Z",
    )
    assert sc.lag_unreliable is flag


# ---------------------------------------------------------------------------
# yaml_io: SafeLoader blocks !!python/object payloads
# ---------------------------------------------------------------------------


def _set_repo_root(monkeypatch, tmp_path: Path) -> Path:
    """Point HARNESS_REPO_ROOT at tmp_path and create .planning/v2.3/ under it."""
    v23 = tmp_path / ".planning" / "v2.3"
    v23.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("HARNESS_REPO_ROOT", str(tmp_path))
    return v23


def test_safe_loader_blocks_python_object_payload(tmp_path, monkeypatch):
    v23 = _set_repo_root(monkeypatch, tmp_path)
    target = v23 / "malicious.yaml"
    target.write_text(
        "discrepancies:\n"
        "  - !!python/object/apply:os.system ['echo pwned']\n"
    )
    with pytest.raises((yaml.YAMLError, yaml.constructor.ConstructorError)):
        yaml_io.load_discrepancies(target)


# ---------------------------------------------------------------------------
# yaml_io: round-trip equality
# ---------------------------------------------------------------------------


def test_roundtrip_preserves_equality(tmp_path, monkeypatch):
    v23 = _set_repo_root(monkeypatch, tmp_path)
    target = v23 / "discrepancies.yaml"

    d = Discrepancy(**_valid_discrepancy_dict())
    yaml_io.save_discrepancies(target, [d])
    loaded = yaml_io.load_discrepancies(target)
    assert len(loaded) == 1
    assert loaded[0] == d


# ---------------------------------------------------------------------------
# yaml_io: path guard
# ---------------------------------------------------------------------------


def test_path_guard_rejects_outside_planning_v23(tmp_path, monkeypatch):
    _set_repo_root(monkeypatch, tmp_path)
    # Outside .planning/v2.3/
    outside = tmp_path / "not-under-v23.yaml"
    with pytest.raises(ValueError, match="path guard"):
        yaml_io.load_discrepancies(outside)


def test_path_guard_rejects_etc_passwd(tmp_path, monkeypatch):
    _set_repo_root(monkeypatch, tmp_path)
    with pytest.raises(ValueError, match="path guard"):
        yaml_io.load_discrepancies("/etc/passwd")


def test_path_guard_rejects_traversal(tmp_path, monkeypatch):
    v23 = _set_repo_root(monkeypatch, tmp_path)
    # ../../foo -> outside .planning/v2.3/
    traversal = v23 / ".." / ".." / "foo.yaml"
    with pytest.raises(ValueError, match="path guard"):
        yaml_io.load_discrepancies(traversal)


# ---------------------------------------------------------------------------
# append_discrepancy on empty / missing file
# ---------------------------------------------------------------------------


def test_append_on_missing_file_creates_structure(tmp_path, monkeypatch):
    v23 = _set_repo_root(monkeypatch, tmp_path)
    target = v23 / "fresh.yaml"
    d = Discrepancy(**_valid_discrepancy_dict())
    yaml_io.append_discrepancy(target, d)

    raw = yaml.safe_load(target.read_text())
    assert "discrepancies" in raw
    assert isinstance(raw["discrepancies"], list)
    assert len(raw["discrepancies"]) == 1
    assert raw["discrepancies"][0]["id"] == "DISC-TEST-001"


def test_append_on_empty_file_creates_structure(tmp_path, monkeypatch):
    v23 = _set_repo_root(monkeypatch, tmp_path)
    target = v23 / "empty.yaml"
    target.write_text("")
    d = Discrepancy(**_valid_discrepancy_dict())
    yaml_io.append_discrepancy(target, d)

    loaded = yaml_io.load_discrepancies(target)
    assert len(loaded) == 1
    assert loaded[0].id == "DISC-TEST-001"
