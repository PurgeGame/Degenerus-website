"""Tests for validate_pools_04: per-transition inferential + coverage-gap."""

from __future__ import annotations

import pytest

from harness import HealthSnapshot, load_discrepancies
from harness.api import _utc_now_iso

from validations.pools import pools_04 as pools_04_mod
from validations.pools.pools_04 import validate_pools_04
from validations.pools.source_level_entries import POOLS_04_COVERAGE_GAP_ID


def _snap() -> HealthSnapshot:
    return HealthSnapshot(
        lag_blocks=0, lag_seconds=0, indexed_block=1, chain_tip=1,
        backfill_complete=True, lag_unreliable=False, sampled_at=_utc_now_iso(),
    )


class _FakeClient:
    def __init__(self, transitions_items):
        self._items = transitions_items

    def get_history_levels_page(self, cursor=None):
        return {"items": self._items, "nextCursor": None}


@pytest.fixture
def tmp_yaml(tmp_path, monkeypatch):
    (tmp_path / ".planning" / "v2.3").mkdir(parents=True)
    monkeypatch.setenv("HARNESS_REPO_ROOT", str(tmp_path))
    yaml_path = str(tmp_path / ".planning" / "v2.3" / "discrepancies.yaml")
    monkeypatch.setattr(pools_04_mod, "DEFAULT_DISCREPANCIES_PATH", yaml_path, raising=False)
    from validations.pools import source_level_entries as sle
    monkeypatch.setattr(sle, "DEFAULT_DISCREPANCIES_PATH", yaml_path, raising=False)
    return yaml_path


def _transition_seq(pairs):
    """Build items representing given (lvl_from, lvl_to) transitions."""
    items = []
    block = 1000
    for a, b in pairs:
        items.append({"level": a, "stage": 7, "phase": "JACKPOT", "blockNumber": block})
        block += 1
        items.append({"level": b, "stage": 3, "phase": "PURCHASE", "blockNumber": block})
        block += 10
    return items


def test_pools_04_emits_one_per_transition(tmp_yaml):
    client = _FakeClient(_transition_seq([(49, 50), (50, 51), (51, 52)]))
    results = validate_pools_04(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    # 3 per-transition inferential entries
    inferential = [r for r in results if r.id.startswith("POOLS-04-inferential-transition-")]
    assert len(inferential) == 3
    # coverage-gap present in YAML
    logged = load_discrepancies(tmp_yaml)
    assert any(d.id == POOLS_04_COVERAGE_GAP_ID for d in logged)


def test_pools_04_coverage_gap_idempotent(tmp_yaml):
    client = _FakeClient(_transition_seq([(49, 50)]))
    validate_pools_04(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    validate_pools_04(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    logged = load_discrepancies(tmp_yaml)
    matches = [d for d in logged if d.id == POOLS_04_COVERAGE_GAP_ID]
    assert len(matches) == 1


def test_pools_04_x00_case(tmp_yaml):
    client = _FakeClient(_transition_seq([(100, 101)]))
    results = validate_pools_04(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    inferential = [r for r in results if r.id.startswith("POOLS-04-inferential-transition-")]
    assert len(inferential) == 1
    e = inferential[0]
    assert "0%" in e.expected_value


def test_pools_04_standard_case(tmp_yaml):
    client = _FakeClient(_transition_seq([(49, 50)]))
    results = validate_pools_04(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    inferential = [r for r in results if r.id.startswith("POOLS-04-inferential-transition-")]
    assert len(inferential) == 1
    e = inferential[0]
    assert "15%" in e.expected_value
    assert e.severity == "Info"
    assert e.suspected_source == "api"


def test_pools_04_empty_transitions_info_entry(tmp_yaml):
    client = _FakeClient([])
    results = validate_pools_04(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    # At least one "no transitions" Info entry
    no_trans = [r for r in results if "no transitions" in r.observed_value.lower()
                or "no transitions" in (r.notes or "").lower()
                or "no transitions" in r.expected_value.lower()]
    assert len(no_trans) >= 1


def test_pools_04_citation_uses_audit_path(tmp_yaml):
    client = _FakeClient(_transition_seq([(49, 50), (100, 101)]))
    results = validate_pools_04(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    for r in results:
        for src in r.derivation.sources:
            assert src.path.startswith("degenerus-audit/contracts/")
