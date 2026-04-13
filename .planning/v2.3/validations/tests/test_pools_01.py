"""Tests for validate_pools_01 (solvency proxy)."""

from __future__ import annotations

import pytest

from harness import HealthSnapshot, load_discrepancies
from harness.api import _utc_now_iso

from validations.pools import pools_01 as pools_01_mod
from validations.pools.pools_01 import validate_pools_01
from validations.pools.source_level_entries import POOLS_01_COVERAGE_GAP_ID


class _StubClient:
    def __init__(self, claimable: str, eth_reserve: str, steth_reserve: str = "0"):
        self._claimable = claimable
        self._eth = eth_reserve
        self._steth = steth_reserve

    def get_game_state(self):
        return {
            "level": None,
            "day": None,
            "prizePools": {
                "futurePrizePool": "0",
                "nextPrizePool": "0",
                "currentPrizePool": "0",
                "claimableWinnings": self._claimable,
            },
        }

    def get_tokens_analytics(self):
        return {
            "vault": {
                "ethReserve": self._eth,
                "stEthReserve": self._steth,
                "burnieReserve": "0",
            }
        }


def _snap(lag_unreliable: bool = False) -> HealthSnapshot:
    return HealthSnapshot(
        lag_blocks=0,
        lag_seconds=0,
        indexed_block=1,
        chain_tip=1,
        backfill_complete=True,
        lag_unreliable=lag_unreliable,
        sampled_at=_utc_now_iso(),
    )


@pytest.fixture
def tmp_yaml(tmp_path, monkeypatch):
    # redirect path guard to tmp_path and point default path under it
    repo_root = tmp_path
    (repo_root / ".planning" / "v2.3").mkdir(parents=True)
    monkeypatch.setenv("HARNESS_REPO_ROOT", str(repo_root))
    yaml_path = str(repo_root / ".planning" / "v2.3" / "discrepancies.yaml")
    # rebind module default
    monkeypatch.setattr(
        pools_01_mod, "DEFAULT_DISCREPANCIES_PATH", yaml_path, raising=False
    )
    from validations.pools import source_level_entries as sle
    monkeypatch.setattr(sle, "DEFAULT_DISCREPANCIES_PATH", yaml_path, raising=False)
    return yaml_path


def test_pass_case_emits_no_entry_when_proxy_ok(tmp_yaml):
    client = _StubClient(claimable="0", eth_reserve="62000000000000000")
    entries = validate_pools_01(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    assert entries == []
    # coverage-gap entry was still logged
    logged = load_discrepancies(tmp_yaml)
    assert any(d.id == POOLS_01_COVERAGE_GAP_ID for d in logged)


def test_critical_on_violation(tmp_yaml):
    client = _StubClient(claimable=str(100 * 10**18), eth_reserve="0")
    entries = validate_pools_01(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    assert len(entries) == 1
    assert entries[0].severity == "Critical"
    assert entries[0].domain == "POOLS"


def test_degrade_on_lag_unreliable(tmp_yaml):
    client = _StubClient(claimable=str(100 * 10**18), eth_reserve="0")
    entries = validate_pools_01(
        client, lag_snapshot=_snap(lag_unreliable=True), yaml_path=tmp_yaml
    )
    assert len(entries) == 1
    assert entries[0].severity == "Major"


def test_coverage_gap_idempotent(tmp_yaml):
    client = _StubClient(claimable="0", eth_reserve="62000000000000000")
    validate_pools_01(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    validate_pools_01(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    logged = load_discrepancies(tmp_yaml)
    matches = [d for d in logged if d.id == POOLS_01_COVERAGE_GAP_ID]
    assert len(matches) == 1


def test_citation_uses_audit_path(tmp_yaml):
    client = _StubClient(claimable=str(100 * 10**18), eth_reserve="0")
    entries = validate_pools_01(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    assert entries[0].derivation.sources[0].path.startswith(
        "degenerus-audit/contracts/"
    )
