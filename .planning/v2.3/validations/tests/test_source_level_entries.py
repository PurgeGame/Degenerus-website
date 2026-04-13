"""Tests for idempotent one-shot source-level Discrepancy writers (Plan 19-04)."""

from __future__ import annotations

from harness import load_discrepancies
from validations.jackpot.source_level_entries import (
    HISTORY_JACKPOTS_500_ID,
    JACKPOT_06_COVERAGE_GAP_ID,
    ensure_history_jackpots_500_logged,
    ensure_jackpot_06_coverage_gap_logged,
)


def _yaml_path(tmp_path, monkeypatch) -> str:
    monkeypatch.setenv("HARNESS_REPO_ROOT", str(tmp_path))
    target_dir = tmp_path / ".planning" / "v2.3"
    target_dir.mkdir(parents=True)
    return str(target_dir / "discrepancies.yaml")


def test_history_jackpots_500_entry_idempotent(tmp_path, monkeypatch):
    path = _yaml_path(tmp_path, monkeypatch)

    assert ensure_history_jackpots_500_logged(path) is True
    assert ensure_history_jackpots_500_logged(path) is False

    entries = load_discrepancies(path)
    matching = [e for e in entries if e.id == HISTORY_JACKPOTS_500_ID]
    assert len(matching) == 1
    entry = matching[0]
    assert entry.severity == "Minor"
    assert entry.suspected_source == "indexer"
    assert entry.endpoint == "/history/jackpots"


def test_jackpot_06_coverage_gap_entry_idempotent(tmp_path, monkeypatch):
    path = _yaml_path(tmp_path, monkeypatch)

    assert ensure_jackpot_06_coverage_gap_logged(path) is True
    assert ensure_jackpot_06_coverage_gap_logged(path) is False

    entries = load_discrepancies(path)
    matching = [e for e in entries if e.id == JACKPOT_06_COVERAGE_GAP_ID]
    assert len(matching) == 1
    entry = matching[0]
    assert entry.severity == "Info"
    assert entry.suspected_source == "api"


def test_source_level_entries_citations_not_stale(tmp_path, monkeypatch):
    path = _yaml_path(tmp_path, monkeypatch)
    ensure_history_jackpots_500_logged(path)
    ensure_jackpot_06_coverage_gap_logged(path)
    entries = load_discrepancies(path)
    for entry in entries:
        for src in entry.derivation.sources:
            assert src.path.startswith("degenerus-audit/contracts/")
            assert "testing/contracts" not in src.path
            assert "degenerus-contracts/" not in src.path


def test_history_500_entry_has_hypothesis_and_workaround(tmp_path, monkeypatch):
    path = _yaml_path(tmp_path, monkeypatch)
    ensure_history_jackpots_500_logged(path)
    [entry] = [e for e in load_discrepancies(path) if e.id == HISTORY_JACKPOTS_500_ID]
    assert entry.hypothesis
    assert "undefined" in entry.observed_value.lower() or "500" in entry.observed_value
    # workaround documented in notes
    assert entry.notes and "earliest-day" in entry.notes


def test_jackpot_06_coverage_gap_has_no_endpoint_marker(tmp_path, monkeypatch):
    path = _yaml_path(tmp_path, monkeypatch)
    ensure_jackpot_06_coverage_gap_logged(path)
    [entry] = [e for e in load_discrepancies(path) if e.id == JACKPOT_06_COVERAGE_GAP_ID]
    # No endpoint — storage-only state
    assert "no endpoint" in entry.endpoint.lower() or "storage-only" in entry.endpoint.lower()
    assert entry.severity == "Info"
