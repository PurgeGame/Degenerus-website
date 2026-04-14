"""Tests for validate_pools_07: static-price conformance + turbo-drift."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from harness import HealthSnapshot, load_discrepancies
from harness.api import _utc_now_iso

from validations.pools import pools_07 as pools_07_mod
from validations.pools.pools_07 import validate_pools_07
from validations.pools.price_curve import price_for_level
from validations.pools.source_level_entries import (
    POOLS_07_SOURCE_DRIFT_ID,
    ensure_pools_07_source_drift_logged,
)


def _snap(lag_unreliable: bool = False) -> HealthSnapshot:
    return HealthSnapshot(
        lag_blocks=0, lag_seconds=0, indexed_block=1, chain_tip=1,
        backfill_complete=True, lag_unreliable=lag_unreliable,
        sampled_at=_utc_now_iso(),
    )


class _FakeClient:
    def __init__(self, state):
        self._state = state

    def get_game_state(self):
        return self._state


@pytest.fixture
def tmp_yaml(tmp_path, monkeypatch):
    (tmp_path / ".planning" / "v2.3").mkdir(parents=True)
    monkeypatch.setenv("HARNESS_REPO_ROOT", str(tmp_path))
    yaml_path = str(tmp_path / ".planning" / "v2.3" / "discrepancies.yaml")
    monkeypatch.setattr(pools_07_mod, "DEFAULT_DISCREPANCIES_PATH", yaml_path, raising=False)
    from validations.pools import source_level_entries as sle
    monkeypatch.setattr(sle, "DEFAULT_DISCREPANCIES_PATH", yaml_path, raising=False)
    return yaml_path


def _load_mid_run():
    path = Path(__file__).parent / "fixtures" / "api" / "game-state-mid-run.json"
    return json.loads(path.read_text())


def test_pools_07_source_drift_idempotent(tmp_yaml):
    assert ensure_pools_07_source_drift_logged(tmp_yaml) is True
    assert ensure_pools_07_source_drift_logged(tmp_yaml) is False
    entries = load_discrepancies(tmp_yaml)
    matches = [e for e in entries if e.id == POOLS_07_SOURCE_DRIFT_ID]
    assert len(matches) == 1
    assert matches[0].severity == "Minor"


def test_pools_07_null_price_emits_info(tmp_yaml):
    client = _FakeClient({"level": None, "day": None, "price": None})
    result = validate_pools_07(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    assert len(result) == 1
    assert result[0].severity == "Info"
    assert result[0].id == "POOLS-07-static-price-null"


def test_pools_07_static_price_pass(tmp_yaml):
    state = _load_mid_run()
    # Sanity: fixture uses price_for_level(50)
    assert int(state["price"]) == price_for_level(int(state["level"]))
    client = _FakeClient(state)
    result = validate_pools_07(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    assert result == []


def test_pools_07_static_price_mismatch_major(tmp_yaml):
    state = _load_mid_run()
    state["price"] = str(int(state["price"]) + 1)  # off by 1 wei
    client = _FakeClient(state)
    result = validate_pools_07(client, lag_snapshot=_snap(), yaml_path=tmp_yaml)
    assert len(result) == 1
    entry = result[0]
    assert entry.severity == "Major"
    assert entry.id.startswith("POOLS-07-static-price-mismatch-level-")
    assert "50" in entry.id


def test_pools_07_lag_downgrade(tmp_yaml):
    state = _load_mid_run()
    state["price"] = str(int(state["price"]) + 1)
    client = _FakeClient(state)
    result = validate_pools_07(client, lag_snapshot=_snap(lag_unreliable=True), yaml_path=tmp_yaml)
    assert len(result) == 1
    assert result[0].severity == "Minor"  # Major -> Minor under lag_unreliable


def test_pools_07_citation_uses_audit_path(tmp_yaml):
    ensure_pools_07_source_drift_logged(tmp_yaml)
    entries = load_discrepancies(tmp_yaml)
    for e in entries:
        if e.id == POOLS_07_SOURCE_DRIFT_ID:
            for src in e.derivation.sources:
                assert src.path.startswith("degenerus-audit/contracts/")


def test_pools_07_suspected_source_is_api(tmp_yaml):
    ensure_pools_07_source_drift_logged(tmp_yaml)
    entries = load_discrepancies(tmp_yaml)
    for e in entries:
        if e.id == POOLS_07_SOURCE_DRIFT_ID:
            assert e.suspected_source == "api"


def test_main_all_orchestrates_seven_validators(tmp_yaml, monkeypatch):
    from validations.pools import __main__ as main_mod

    calls: list[str] = []

    def make_stub(name):
        def stub(*args, **kwargs):
            calls.append(name)
            return []
        return stub

    monkeypatch.setattr(main_mod, "validate_pools_01", make_stub("01"))
    monkeypatch.setattr(main_mod, "validate_pools_02", make_stub("02"))
    monkeypatch.setattr(main_mod, "validate_pools_03", make_stub("03"))
    monkeypatch.setattr(main_mod, "validate_pools_04", make_stub("04"))
    monkeypatch.setattr(main_mod, "validate_pools_05", make_stub("05"))
    monkeypatch.setattr(main_mod, "validate_pools_06", make_stub("06"))
    monkeypatch.setattr(main_mod, "validate_pools_07", make_stub("07"))
    monkeypatch.setenv("RUN_LIVE_VALIDATION", "1")

    # Stub run_with_health_check to invoke batch directly with a fake snapshot
    fake_snap = _snap()

    def fake_run(batch_fn):
        counts = batch_fn(fake_snap)
        return fake_snap, counts

    monkeypatch.setattr(main_mod, "run_with_health_check", fake_run)

    # Stub PoolsEndpointClient to no-op
    monkeypatch.setattr(main_mod, "PoolsEndpointClient", lambda mode="live": object())

    rc = main_mod.main(["--all"])
    assert rc == 0
    assert calls == ["01", "02", "03", "04", "05", "06", "07"]
