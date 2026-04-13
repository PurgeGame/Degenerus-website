"""Endpoint client for Phase 19 jackpot validation.

Two modes:

- ``live``: calls localhost:3000 via ``harness.get_json`` (5s timeout).
- ``replay``: reads JSON from ``tests/fixtures/api/*.json``; no network.

Real endpoint paths (live-probed 2026-04-13; CONTEXT.md names were wrong):

- ``/health``, ``/game/state``
- ``/game/jackpot/earliest-day``, ``/game/jackpot/latest-day``
- ``/game/jackpot/day/:day/winners``, ``/.../roll1``, ``/.../roll2``
- ``/replay/rng`` (historical finalWord lookup)
- ``/history/levels``

Security invariants:

- T-19-01-02: ``_scrub`` strips anything resembling ``JACKPOT_API_BASE_URL``
  env value or bearer-token tails from exception messages.
- T-19-01-03: 5s connect / 10s read timeouts on all live calls (prevents
  indefinite hang when the indexer stalls).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Callable, Literal

from harness import HealthSnapshot, check_api_health, get_json

from validations.jackpot.fixtures_io import load_fixture


ClientMode = Literal["live", "replay"]

DEFAULT_BASE_URL = "http://localhost:3000"
_BASE_URL_ENV = "JACKPOT_API_BASE_URL"
_TIMEOUT_READ = 10.0  # total per-request budget (harness.get_json takes a single float)


def _base_url() -> str:
    return os.environ.get(_BASE_URL_ENV, DEFAULT_BASE_URL)


_TOKEN_RE = re.compile(r"(bearer|token|key)[=:\s]+\S+", re.IGNORECASE)


def _scrub(msg: str) -> str:
    """Remove env value + bearer/token tails from an error message."""
    env = os.environ.get(_BASE_URL_ENV)
    if env:
        msg = msg.replace(env, "<base-url-redacted>")
    return _TOKEN_RE.sub(r"\1=<redacted>", msg)


# ---------------------------------------------------------------------------
# EndpointClient
# ---------------------------------------------------------------------------


@dataclass
class EndpointClient:
    mode: ClientMode = "live"
    _rng_cache: dict[int, str] | None = None

    # -- Winners / Rolls ----------------------------------------------------

    def get_jackpot_winners(self, day: int) -> dict[str, Any]:
        if self.mode == "replay":
            return load_fixture(f"day-{day}-winners.json")
        try:
            return get_json(
                f"/game/jackpot/day/{day}/winners",
                base_url=_base_url(),
                timeout=_TIMEOUT_READ,
            )
        except Exception as exc:
            raise RuntimeError(_scrub(f"get_jackpot_winners({day}) failed: {exc!s}")) from None

    def get_roll1(self, day: int) -> dict[str, Any] | None:
        return self._get_roll(day, 1)

    def get_roll2(self, day: int) -> dict[str, Any] | None:
        """Return roll2 payload or None on 404 (expected post-gameover)."""
        return self._get_roll(day, 2)

    def _get_roll(self, day: int, which: int) -> dict[str, Any] | None:
        fname = f"day-{day}-roll{which}.json"
        if self.mode == "replay":
            try:
                return load_fixture(fname)
            except FileNotFoundError:
                return None
        path = f"/game/jackpot/day/{day}/roll{which}"
        try:
            return get_json(path, base_url=_base_url(), timeout=_TIMEOUT_READ)
        except RuntimeError as exc:
            # harness.get_json surfaces "HTTP 404 from ..." on 404.
            if "HTTP 404" in str(exc):
                return None
            raise RuntimeError(_scrub(f"get_roll{which}({day}) failed: {exc!s}")) from None

    # -- Historical RNG -----------------------------------------------------

    def get_replay_rng(self) -> dict[int, str]:
        """Return ``{day: finalWord_hex_or_decimal_str}`` from /replay/rng.

        Cached per-process. ``mode="replay"`` reads fixture ``replay_rng.json``.
        """
        if self._rng_cache is not None:
            return self._rng_cache
        if self.mode == "replay":
            payload = load_fixture("replay_rng.json")
        else:
            try:
                payload = get_json(
                    "/replay/rng", base_url=_base_url(), timeout=_TIMEOUT_READ
                )
            except Exception as exc:
                raise RuntimeError(_scrub(f"get_replay_rng failed: {exc!s}")) from None
        cache: dict[int, str] = {}
        for row in payload.get("days", []):
            cache[int(row["day"])] = str(row["finalWord"])
        self._rng_cache = cache
        return cache

    def get_final_word(self, day: int) -> int | None:
        """Return finalWord for ``day`` as int, or None if not in cache."""
        cache = self.get_replay_rng()
        raw = cache.get(int(day))
        if raw is None:
            return None
        raw = raw.strip()
        if raw.lower().startswith("0x"):
            return int(raw, 16)
        # /replay/rng returns decimal strings per live probe.
        return int(raw)

    # -- Ancillary ----------------------------------------------------------

    def get_game_state(self) -> dict[str, Any]:
        if self.mode == "replay":
            return load_fixture("game_state.json")
        return get_json("/game/state", base_url=_base_url(), timeout=_TIMEOUT_READ)

    def get_history_levels_page(
        self, cursor: str | None = None
    ) -> dict[str, Any]:
        if self.mode == "replay":
            return load_fixture("history_levels.json")
        path = "/history/levels" + (f"?cursor={cursor}" if cursor else "")
        return get_json(path, base_url=_base_url(), timeout=_TIMEOUT_READ)


# ---------------------------------------------------------------------------
# Health-gated batch runner
# ---------------------------------------------------------------------------


def run_with_health_check(
    batch_callable: Callable[[HealthSnapshot], Any],
    *,
    base_url: str | None = None,
) -> tuple[HealthSnapshot, Any]:
    """Call ``check_api_health()`` FIRST, then invoke ``batch_callable(snapshot)``.

    On health-check failure returns a degraded snapshot (lag_unreliable=True)
    so callers can still proceed and tag samples accordingly.
    """
    url = base_url or _base_url()
    try:
        snapshot = check_api_health(base_url=url)
    except Exception:
        from harness.api import _utc_now_iso  # lightweight: reuse helper
        snapshot = HealthSnapshot(
            lag_blocks=-1,
            lag_seconds=-1,
            indexed_block=0,
            chain_tip=0,
            backfill_complete=False,
            lag_unreliable=True,
            sampled_at=_utc_now_iso(),
        )
    result = batch_callable(snapshot)
    return snapshot, result
