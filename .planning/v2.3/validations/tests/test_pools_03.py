"""Tests for validate_pools_03: coverage-gap + source-drift writers."""

from __future__ import annotations

import pytest

from harness import HealthSnapshot, load_discrepancies
from harness.api import _utc_now_iso

from validations.pools import pools_03 as pools_03_mod
from validations.pools.pools_03 import validate_pools_03
from validations.pools.source_level_entries import (
    POOLS_03_COVERAGE_GAP_ID,
    POOLS_03_SOURCE_DRIFT_ID,
    ensure_pools_03_coverage_gap_logged,
    ensure_pools_03_source_drift_logged,
)


def _snap() -> HealthSnapshot:
    return HealthSnapshot(
        lag_blocks=0, lag_seconds=0, indexed_block=1, chain_tip=1,
        backfill_complete=True, lag_unreliable=False, sampled_at=_utc_now_iso(),
    )


@pytest.fixture
def tmp_yaml(tmp_path, monkeypatch):
    (tmp_path / ".planning" / "v2.3").mkdir(parents=True)
    monkeypatch.setenv("HARNESS_REPO_ROOT", str(tmp_path))
    yaml_path = str(tmp_path / ".planning" / "v2.3" / "discrepancies.yaml")
    monkeypatch.setattr(pools_03_mod, "DEFAULT_DISCREPANCIES_PATH", yaml_path, raising=False)
    from validations.pools import source_level_entries as sle
    monkeypatch.setattr(sle, "DEFAULT_DISCREPANCIES_PATH", yaml_path, raising=False)
    return yaml_path


def test_pools_03_coverage_gap_idempotent(tmp_yaml):
    assert ensure_pools_03_coverage_gap_logged(tmp_yaml) is True
    assert ensure_pools_03_coverage_gap_logged(tmp_yaml) is False
    entries = load_discrepancies(tmp_yaml)
    matches = [e for e in entries if e.id == POOLS_03_COVERAGE_GAP_ID]
    assert len(matches) == 1
    assert matches[0].severity == "Info"
    assert matches[0].suspected_source == "api"


def test_pools_03_source_drift_idempotent(tmp_yaml):
    assert ensure_pools_03_source_drift_logged(tmp_yaml) is True
    assert ensure_pools_03_source_drift_logged(tmp_yaml) is False
    entries = load_discrepancies(tmp_yaml)
    matches = [e for e in entries if e.id == POOLS_03_SOURCE_DRIFT_ID]
    assert len(matches) == 1
    assert matches[0].severity == "Minor"
    assert matches[0].suspected_source == "api"
    # audit-canonical mechanism cited
    assert "_applyTimeBasedFutureTake" in matches[0].observed_value or any(
        "_applyTimeBasedFutureTake" in (c.anchor or "") for c in matches[0].derivation.sources
    )


def test_pools_03_returns_empty_list(tmp_yaml):
    result = validate_pools_03(client=None, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    assert result == []
    # Both entries now present
    entries = load_discrepancies(tmp_yaml)
    ids = {e.id for e in entries}
    assert POOLS_03_COVERAGE_GAP_ID in ids
    assert POOLS_03_SOURCE_DRIFT_ID in ids


def test_pools_03_citation_uses_audit_path(tmp_yaml):
    ensure_pools_03_coverage_gap_logged(tmp_yaml)
    ensure_pools_03_source_drift_logged(tmp_yaml)
    entries = load_discrepancies(tmp_yaml)
    for e in entries:
        if e.id in (POOLS_03_COVERAGE_GAP_ID, POOLS_03_SOURCE_DRIFT_ID):
            for src in e.derivation.sources:
                assert src.path.startswith("degenerus-audit/contracts/")
