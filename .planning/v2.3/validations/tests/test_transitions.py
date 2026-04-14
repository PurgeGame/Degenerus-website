"""Tests for validations.pools.transitions.enumerate_transitions.

Security invariants covered:
- T-20-02-01 DoS: bounded max_iter raises on overrun
- T-20-02-02 Info Disclosure: raw cursor tokens scrubbed from error messages
- T-20-02-05 Spoofing: orphan stage=7 and level-gap transitions skipped
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from validations.pools.transitions import enumerate_transitions, paginate_history_levels


_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "api"


def _load(name: str) -> dict:
    with open(_FIXTURE_DIR / name, "r", encoding="utf-8") as fh:
        return json.load(fh)


class _TwoPageClient:
    """Client stub yielding pools-page1 -> pools-page2."""

    def __init__(self):
        self._pages = {
            None: _load("history-levels-pools-page1.json"),
            "pools-page2": _load("history-levels-pools-page2.json"),
        }

    def get_history_levels_page(self, cursor=None):
        return self._pages[cursor]


class _CycleClient:
    """Client that returns its own cursor on every call (cycle)."""

    def get_history_levels_page(self, cursor=None):
        return {
            "items": [{"level": 1, "stage": 7, "phase": "JACKPOT", "blockNumber": 1}],
            "nextCursor": "AAAABBBBCCCCDDDDEEEEFFFFGGGG-secret-cursor-token-xyz",
        }


class _InfiniteDistinctClient:
    """Client returning distinct cursor each call, forever — tests max_iter."""

    def __init__(self):
        self._n = 0

    def get_history_levels_page(self, cursor=None):
        self._n += 1
        return {
            "items": [{"level": self._n, "stage": 7, "phase": "JACKPOT", "blockNumber": self._n}],
            "nextCursor": f"cursor-{self._n}",
        }


class _RaisingClient:
    def get_history_levels_page(self, cursor=None):
        raise RuntimeError("boom base_url=https://SECRET-INDEXER.example.com/api failed")


def test_enumerate_transitions_happy_path():
    client = _TwoPageClient()
    result = enumerate_transitions(client)
    # 49 JACKPOT -> 50 PURCHASE (block 1234); 50 JACKPOT -> 51 PURCHASE (block 1300)
    # 99 JACKPOT -> 101 PURCHASE: skipped (level gap); 60 JACKPOT: orphan (no next PURCHASE)
    assert result == [(49, 50, 1234), (50, 51, 1300)]


def test_enumerate_transitions_skips_orphan_jackpot():
    # 60 JACKPOT at end of page2 has no following PURCHASE — skipped
    client = _TwoPageClient()
    result = enumerate_transitions(client)
    assert all(lvl_from != 60 for (lvl_from, _, _) in result)


def test_enumerate_transitions_skips_level_gap():
    # 99 JACKPOT followed by 101 PURCHASE (gap of 2) — skipped
    client = _TwoPageClient()
    result = enumerate_transitions(client)
    assert all(lvl_from != 99 for (lvl_from, _, _) in result)


def test_paginate_cycle_guard():
    client = _CycleClient()
    with pytest.raises(ValueError) as excinfo:
        paginate_history_levels(client, max_iter=50)
    # Raw cursor must not leak
    msg = str(excinfo.value)
    assert "secret-cursor-token-xyz" not in msg
    assert "cursor-redacted" in msg or "scrubbed" in msg.lower() or "cycle" in msg.lower()


def test_paginate_respects_max_iter():
    client = _InfiniteDistinctClient()
    with pytest.raises(ValueError):
        paginate_history_levels(client, max_iter=3)


def test_scrubbed_error_on_client_failure():
    client = _RaisingClient()
    with pytest.raises(RuntimeError) as excinfo:
        enumerate_transitions(client)
    msg = str(excinfo.value)
    assert "SECRET-INDEXER" not in msg
