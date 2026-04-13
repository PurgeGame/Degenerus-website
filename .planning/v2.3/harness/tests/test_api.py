"""Tests for harness.api: check_api_health + get_json.

Covers:
- HealthSnapshot field mapping from /health JSON.
- lag_unreliable threshold is strict > 10 (METHOD-05).
- Network errors surface URL but not env-var secrets (T-18-03-03).
- sampled_at is ISO-8601 UTC parseable.
"""

from __future__ import annotations

import datetime as dt
import os
import re
from datetime import datetime

import pytest

from harness.api import (
    DEFAULT_BASE_URL,
    LAG_THRESHOLD,
    HealthSnapshot,
    check_api_health,
)


# ---------------------------------------------------------------------------
# Fake requests.get
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, json_payload: dict, status_code: int = 200):
        self._json = json_payload
        self.status_code = status_code
        self.text = str(json_payload)

    def json(self) -> dict:
        return self._json

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(
                f"{self.status_code} error for url: fake-url"
            )


def _install_fake_get(monkeypatch, payload: dict, status_code: int = 200):
    def fake_get(url, timeout=None, **kwargs):
        _install_fake_get.last_url = url
        return _FakeResponse(payload, status_code=status_code)

    import harness.api as api_mod
    monkeypatch.setattr(api_mod, "requests_get", fake_get)
    return fake_get


# ---------------------------------------------------------------------------
# Lag threshold parametrized (strict > 10)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "lag_blocks,expected_flag",
    [
        (0, False),
        (5, False),
        (10, False),   # boundary: 10 is NOT unreliable
        (11, True),    # boundary: 11 IS unreliable
        (100, True),
        (9999, True),
    ],
)
def test_lag_threshold_strict_gt_10(lag_blocks, expected_flag, monkeypatch):
    payload = {
        "lagBlocks": lag_blocks,
        "lagSeconds": lag_blocks * 12,
        "indexedBlock": 1000,
        "chainTip": 1000 + lag_blocks,
        "backfillComplete": True,
    }
    _install_fake_get(monkeypatch, payload)
    snap = check_api_health()
    assert snap.lag_blocks == lag_blocks
    assert snap.lag_unreliable is expected_flag


def test_lag_threshold_constant_is_10():
    assert LAG_THRESHOLD == 10


# ---------------------------------------------------------------------------
# HealthSnapshot surface
# ---------------------------------------------------------------------------


def test_health_snapshot_fields(monkeypatch):
    payload = {
        "lagBlocks": 3,
        "lagSeconds": 36,
        "indexedBlock": 500,
        "chainTip": 503,
        "backfillComplete": True,
    }
    _install_fake_get(monkeypatch, payload)
    snap = check_api_health()
    assert isinstance(snap, HealthSnapshot)
    assert snap.indexed_block == 500
    assert snap.chain_tip == 503
    assert snap.backfill_complete is True
    assert snap.lag_seconds == 36


def test_sampled_at_is_iso8601_utc(monkeypatch):
    payload = {
        "lagBlocks": 0,
        "lagSeconds": 0,
        "indexedBlock": 1,
        "chainTip": 1,
        "backfillComplete": True,
    }
    _install_fake_get(monkeypatch, payload)
    snap = check_api_health()
    # Strip trailing Z if present, then parse
    ts = snap.sampled_at
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    parsed = datetime.fromisoformat(ts)
    assert parsed.tzinfo is not None


# ---------------------------------------------------------------------------
# Hits the /health endpoint explicitly
# ---------------------------------------------------------------------------


def test_calls_health_endpoint(monkeypatch):
    payload = {
        "lagBlocks": 0,
        "lagSeconds": 0,
        "indexedBlock": 1,
        "chainTip": 1,
        "backfillComplete": True,
    }
    fake = _install_fake_get(monkeypatch, payload)
    check_api_health(base_url="http://localhost:3000")
    assert _install_fake_get.last_url.endswith("/health")


# ---------------------------------------------------------------------------
# Network error surfaces URL but NOT env-var secrets
# ---------------------------------------------------------------------------


def test_network_error_message_mentions_url_not_secrets(monkeypatch):
    monkeypatch.setenv("HARNESS_API_TOKEN", "secret123")

    import requests

    def raising_get(url, timeout=None, **kwargs):
        raise requests.ConnectionError(f"Connection refused: {url}")

    import harness.api as api_mod
    monkeypatch.setattr(api_mod, "requests_get", raising_get)

    with pytest.raises(Exception) as excinfo:
        check_api_health(base_url="http://127.0.0.1:1")

    msg = str(excinfo.value)
    assert "127.0.0.1:1" in msg or "/health" in msg
    assert "secret123" not in msg


def test_http_error_message_does_not_leak_env_secrets(monkeypatch, capsys):
    monkeypatch.setenv("HARNESS_API_TOKEN", "secret123")
    _install_fake_get(monkeypatch, {"error": "boom"}, status_code=500)

    with pytest.raises(Exception) as excinfo:
        check_api_health()

    msg = str(excinfo.value)
    captured = capsys.readouterr()
    assert "secret123" not in msg
    assert "secret123" not in captured.out
    assert "secret123" not in captured.err


# ---------------------------------------------------------------------------
# get_json pass-through
# ---------------------------------------------------------------------------


def test_get_json_returns_decoded_json(monkeypatch):
    _install_fake_get(monkeypatch, {"foo": "bar", "count": 7})
    from harness.api import get_json
    result = get_json("/some/path")
    assert result == {"foo": "bar", "count": 7}
    assert _install_fake_get.last_url.endswith("/some/path")
