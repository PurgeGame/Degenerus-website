"""Tests for /history/levels paginator + JACKPOT-07 turbo inference."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from harness import HealthSnapshot
from validations.jackpot.history_levels import (
    MAX_ITERATIONS,
    build_level_jackpot_day_counts,
    infer_compressed_flag,
    paginate_history_levels,
)
from validations.jackpot import jackpot_07
from validations.jackpot.jackpot_07 import (
    _HERO_CACHE_PATH,
    read_hero_candidate_cache,
    select_hero_candidate_day,
    validate_jackpot_07,
)


_FIXTURE_ROOT = Path(__file__).resolve().parent / "fixtures" / "api"


def _snap(*, unreliable: bool = False, lag: int = 0) -> HealthSnapshot:
    return HealthSnapshot(
        lag_blocks=lag,
        lag_seconds=0,
        indexed_block=1,
        chain_tip=1,
        backfill_complete=True,
        lag_unreliable=unreliable,
        sampled_at=datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
    )


class _PagedClient:
    def __init__(self, pages: dict[str | None, dict]):
        self.pages = pages
        self.call_count = 0

    def get_history_levels_page(self, cursor):
        self.call_count += 1
        return self.pages[cursor]


def test_paginate_follows_nextcursor_across_two_pages():
    page1 = json.loads((_FIXTURE_ROOT / "history-levels-page1.json").read_text())
    page2 = json.loads((_FIXTURE_ROOT / "history-levels-page2.json").read_text())
    cli = _PagedClient({None: page1, "page2": page2})

    items = paginate_history_levels(cli)
    assert len(items) == len(page1["items"]) + len(page2["items"])
    assert cli.call_count == 2


def test_paginate_cycle_guard_raises():
    # Cursor points to itself -> detected after one iteration
    self_cycle = {"items": [{"level": 1, "phase": "JACKPOT", "day": 1}], "nextCursor": "loop"}
    loop_page = {"items": [{"level": 2, "phase": "JACKPOT", "day": 2}], "nextCursor": "loop"}
    cli = _PagedClient({None: self_cycle, "loop": loop_page})
    with pytest.raises(ValueError, match="cycle"):
        paginate_history_levels(cli)


def test_paginate_bounded_iterations():
    # Construct unique cursors forever; paginator must stop at MAX_ITERATIONS
    class _Infinite:
        def __init__(self):
            self.n = 0

        def get_history_levels_page(self, cursor):
            self.n += 1
            return {
                "items": [{"level": self.n, "phase": "JACKPOT", "day": self.n}],
                "nextCursor": f"c{self.n}",
            }

    cli = _Infinite()
    with pytest.raises(ValueError, match=r"exceeded \d+ iterations|cycle"):
        paginate_history_levels(cli)
    # should not iterate more than MAX_ITERATIONS times
    assert cli.n <= MAX_ITERATIONS


def test_build_level_day_counts_from_fixture():
    page1 = json.loads((_FIXTURE_ROOT / "history-levels-page1.json").read_text())
    page2 = json.loads((_FIXTURE_ROOT / "history-levels-page2.json").read_text())
    items = page1["items"] + page2["items"]
    counts = build_level_jackpot_day_counts(items)
    # level 1: 5 JACKPOT days (days 2,3,4,5,6)
    assert counts[1] == 5
    # level 101: 1 day
    assert counts[101] == 1
    # level 102: 3 days
    assert counts[102] == 3
    # level 105: 1 day
    assert counts[105] == 1


def test_build_level_day_counts_schema_drift():
    items = [{"foo": "bar"}, {"baz": 1}]
    with pytest.raises(ValueError, match="schema drift"):
        build_level_jackpot_day_counts(items)


def test_infer_flag_mapping():
    assert infer_compressed_flag(1) == 2
    assert infer_compressed_flag(3) == 1
    assert infer_compressed_flag(5) == 0
    assert infer_compressed_flag(2) is None
    assert infer_compressed_flag(7) is None


class _ItemsClient:
    def __init__(self, items):
        self.items = items

    def get_history_levels_page(self, cursor):
        return {"items": self.items, "nextCursor": None}


def test_level_100_normal_pass():
    items = [{"level": 100, "phase": "JACKPOT", "day": d} for d in range(500, 505)]
    discs = validate_jackpot_07(_ItemsClient(items), lag_snapshot=_snap())
    assert discs == []


def test_level_101_normal_flagged_as_fast_regime_divergence():
    items = [{"level": 101, "phase": "JACKPOT", "day": d} for d in range(500, 505)]
    discs = validate_jackpot_07(_ItemsClient(items), lag_snapshot=_snap())
    assert len(discs) == 1
    assert discs[0].severity == "Minor"
    assert discs[0].suspected_source == "expected_fast_regime_divergence"
    assert "fast-regime-divergence" in discs[0].id


def test_level_101_turbo_pass():
    items = [{"level": 101, "phase": "JACKPOT", "day": 500}]
    discs = validate_jackpot_07(_ItemsClient(items), lag_snapshot=_snap())
    assert discs == []


def test_unexpected_day_count_is_minor():
    items = [{"level": 50, "phase": "JACKPOT", "day": d} for d in range(500, 507)]
    discs = validate_jackpot_07(_ItemsClient(items), lag_snapshot=_snap())
    assert len(discs) == 1
    assert discs[0].severity == "Minor"
    assert "unexpected-day-count" in discs[0].id


def test_lag_downgrade_fast_regime_divergence():
    items = [{"level": 101, "phase": "JACKPOT", "day": d} for d in range(500, 505)]
    discs = validate_jackpot_07(
        _ItemsClient(items), lag_snapshot=_snap(unreliable=True, lag=30)
    )
    assert len(discs) == 1
    # Minor (with lag) -> Info
    assert discs[0].severity == "Info"


def test_select_hero_candidate_returns_none_when_no_divergence(tmp_path, monkeypatch):
    # Patch cache path to tmp
    monkeypatch.setattr(jackpot_07, "_HERO_CACHE_PATH", tmp_path / "cache.txt")

    class _Zero:
        def get_final_word(self, day):
            return 1

        def get_jackpot_winners(self, day):
            # matches derived main_traits(1) = (1, 64, 128, 192)
            return {
                "winners": [
                    {
                        "breakdown": [
                            {"awardType": "eth", "traitId": 1, "amount": "1", "count": 1},
                            {"awardType": "eth", "traitId": 64, "amount": "1", "count": 1},
                            {"awardType": "eth", "traitId": 128, "amount": "1", "count": 1},
                            {"awardType": "eth", "traitId": 192, "amount": "1", "count": 1},
                        ]
                    }
                ]
            }

    result = select_hero_candidate_day(_Zero())
    assert result is None


def test_select_hero_candidate_picks_divergent_day(tmp_path, monkeypatch):
    monkeypatch.setattr(jackpot_07, "_HERO_CACHE_PATH", tmp_path / "cache.txt")

    class _Divergent:
        def get_final_word(self, day):
            return 1  # derived = (1, 64, 128, 192)

        def get_jackpot_winners(self, day):
            if day == 50:
                # single-quadrant swap: 64 -> 65
                return {
                    "winners": [
                        {
                            "breakdown": [
                                {"awardType": "eth", "traitId": 1, "amount": "1", "count": 1},
                                {"awardType": "eth", "traitId": 65, "amount": "1", "count": 1},
                                {"awardType": "eth", "traitId": 128, "amount": "1", "count": 1},
                                {"awardType": "eth", "traitId": 192, "amount": "1", "count": 1},
                            ]
                        }
                    ]
                }
            return {
                "winners": [
                    {
                        "breakdown": [
                            {"awardType": "eth", "traitId": 1, "amount": "1", "count": 1},
                            {"awardType": "eth", "traitId": 64, "amount": "1", "count": 1},
                            {"awardType": "eth", "traitId": 128, "amount": "1", "count": 1},
                            {"awardType": "eth", "traitId": 192, "amount": "1", "count": 1},
                        ]
                    }
                ]
            }

    result = select_hero_candidate_day(_Divergent())
    assert result == 50
    cache_path = tmp_path / "cache.txt"
    assert cache_path.exists()
    assert cache_path.read_text().strip() == "50"


def test_atomic_write_rejects_bad_cache(tmp_path, monkeypatch):
    from validations.jackpot.jackpot_07 import read_hero_candidate_cache as reader
    monkeypatch.setattr(jackpot_07, "_HERO_CACHE_PATH", tmp_path / "cache.txt")
    (tmp_path / "cache.txt").write_text("not-an-int")
    assert reader() is None


def test_inference_hypothesis_always_includes_disclaimer():
    items = [{"level": 101, "phase": "JACKPOT", "day": d} for d in range(500, 505)]
    discs = validate_jackpot_07(_ItemsClient(items), lag_snapshot=_snap())
    assert len(discs) == 1
    text = " ".join(h.text for h in discs[0].hypothesis)
    assert "infer from physical-day count" in text or "compressedJackpotFlag" in text
