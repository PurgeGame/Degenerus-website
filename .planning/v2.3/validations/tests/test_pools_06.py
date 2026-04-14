"""Tests for validate_pools_06: accumulator coverage-gap."""

from __future__ import annotations

import pytest

from harness import HealthSnapshot, load_discrepancies
from harness.api import _utc_now_iso

from validations.pools import pools_06 as pools_06_mod
from validations.pools.pools_06 import validate_pools_06
from validations.pools.source_level_entries import (
    POOLS_06_COVERAGE_GAP_ID,
    ensure_pools_06_coverage_gap_logged,
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
    monkeypatch.setattr(pools_06_mod, "DEFAULT_DISCREPANCIES_PATH", yaml_path, raising=False)
    from validations.pools import source_level_entries as sle
    monkeypatch.setattr(sle, "DEFAULT_DISCREPANCIES_PATH", yaml_path, raising=False)
    return yaml_path


def test_pools_06_coverage_gap_idempotent(tmp_yaml):
    assert ensure_pools_06_coverage_gap_logged(tmp_yaml) is True
    assert ensure_pools_06_coverage_gap_logged(tmp_yaml) is False
    entries = load_discrepancies(tmp_yaml)
    matches = [e for e in entries if e.id == POOLS_06_COVERAGE_GAP_ID]
    assert len(matches) == 1
    assert matches[0].severity == "Info"
    assert matches[0].suspected_source == "api"


def test_pools_06_returns_empty(tmp_yaml):
    result = validate_pools_06(client=None, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    assert result == []
    ids = {e.id for e in load_discrepancies(tmp_yaml)}
    assert POOLS_06_COVERAGE_GAP_ID in ids


def test_pools_06_citation_uses_audit_path(tmp_yaml):
    ensure_pools_06_coverage_gap_logged(tmp_yaml)
    entries = load_discrepancies(tmp_yaml)
    for e in entries:
        if e.id == POOLS_06_COVERAGE_GAP_ID:
            for src in e.derivation.sources:
                assert src.path.startswith("degenerus-audit/contracts/")
