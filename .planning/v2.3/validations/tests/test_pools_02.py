"""Tests for validate_pools_02 (per-level ticket-ETH derivation)."""

from __future__ import annotations

import pytest

from harness import HealthSnapshot, load_discrepancies
from harness.api import _utc_now_iso

from validations.pools import pools_02 as pools_02_mod
from validations.pools.pools_02 import validate_pools_02
from validations.pools.price_curve import price_for_level
from validations.pools.source_level_entries import POOLS_02_COVERAGE_GAP_ID


class _StubClient:
    def __init__(self, per_level: dict[int, list[dict]]):
        self._per_level = per_level

    def get_replay_tickets(self, level: int):
        return {"level": level, "players": self._per_level.get(level, [])}


def _snap() -> HealthSnapshot:
    return HealthSnapshot(
        lag_blocks=0,
        lag_seconds=0,
        indexed_block=1,
        chain_tip=1,
        backfill_complete=True,
        lag_unreliable=False,
        sampled_at=_utc_now_iso(),
    )


@pytest.fixture
def tmp_yaml(tmp_path, monkeypatch):
    repo_root = tmp_path
    (repo_root / ".planning" / "v2.3").mkdir(parents=True)
    monkeypatch.setenv("HARNESS_REPO_ROOT", str(repo_root))
    yaml_path = str(repo_root / ".planning" / "v2.3" / "discrepancies.yaml")
    monkeypatch.setattr(pools_02_mod, "DEFAULT_DISCREPANCIES_PATH", yaml_path, raising=False)
    from validations.pools import source_level_entries as sle
    monkeypatch.setattr(sle, "DEFAULT_DISCREPANCIES_PATH", yaml_path, raising=False)
    return yaml_path


def test_per_level_derivation(tmp_yaml):
    client = _StubClient({50: [
        {"address": "0xa", "totalMintedOnLevel": 10},
        {"address": "0xb", "totalMintedOnLevel": 5},
        {"address": "0xc", "totalMintedOnLevel": 20},
    ]})
    entries = validate_pools_02(
        client, sample_levels=(50,), lag_snapshot=_snap(), yaml_path=tmp_yaml
    )
    # one per-level Info entry
    assert len(entries) == 1
    e = entries[0]
    assert e.severity == "Info"
    assert e.id == "POOLS-02-derivation-level-50"
    total_tickets = 35
    price = price_for_level(50)
    total_eth = total_tickets * price
    expected_next = total_eth * 9000 // 10000
    expected_future = total_eth * 1000 // 10000
    assert str(expected_next) in e.expected_value
    assert str(expected_future) in e.expected_value


def test_empty_tickets_skipped(tmp_yaml):
    client = _StubClient({50: []})
    entries = validate_pools_02(
        client, sample_levels=(50,), lag_snapshot=_snap(), yaml_path=tmp_yaml
    )
    assert entries == []
    # coverage gap still present
    logged = load_discrepancies(tmp_yaml)
    assert any(d.id == POOLS_02_COVERAGE_GAP_ID for d in logged)


def test_coverage_gap_idempotent(tmp_yaml):
    client = _StubClient({50: []})
    validate_pools_02(client, sample_levels=(50,), lag_snapshot=_snap(), yaml_path=tmp_yaml)
    validate_pools_02(client, sample_levels=(50,), lag_snapshot=_snap(), yaml_path=tmp_yaml)
    logged = load_discrepancies(tmp_yaml)
    matches = [d for d in logged if d.id == POOLS_02_COVERAGE_GAP_ID]
    assert len(matches) == 1


def test_level_100_whale_case(tmp_yaml):
    client = _StubClient({100: [{"address": "0xw", "totalMintedOnLevel": 100}]})
    entries = validate_pools_02(
        client, sample_levels=(100,), lag_snapshot=_snap(), yaml_path=tmp_yaml
    )
    assert len(entries) == 1
    e = entries[0]
    total_eth = 100 * price_for_level(100)
    expected_next = total_eth * 9000 // 10000
    assert str(expected_next) in e.expected_value


def test_citation_uses_audit_path(tmp_yaml):
    client = _StubClient({50: [{"address": "0xa", "totalMintedOnLevel": 10}]})
    entries = validate_pools_02(
        client, sample_levels=(50,), lag_snapshot=_snap(), yaml_path=tmp_yaml
    )
    for src in entries[0].derivation.sources:
        assert src.path.startswith("degenerus-audit/contracts/")
