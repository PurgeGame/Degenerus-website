"""Endpoint client for Phase 20 POOLS validation.

Two modes:

- ``live``: calls ``POOLS_API_BASE_URL`` (or ``JACKPOT_API_BASE_URL``,
  else localhost:3000) via ``harness.get_json`` with 10s read timeout.
- ``replay``: reads JSON from ``tests/fixtures/api/*.json``; no network.

Reuses ``_scrub`` and ``_TIMEOUT_READ`` and ``run_with_health_check``
from ``validations.jackpot.endpoints`` to avoid duplication (single
source of truth for HTTP hardening).

Security invariants:

- T-20-01-01: fixture filenames constrained via ``load_fixture`` regex.
- T-20-01-02: ``_scrub`` redacts env value + bearer tokens.
- T-20-01-03: 10s read timeout on all live calls.
- T-20-01-04: cursor sanitized via ``_safe_cursor`` regex.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Literal

from harness import get_json

from validations.jackpot.endpoints import (
    DEFAULT_BASE_URL,
    _TIMEOUT_READ,
    _scrub,
    run_with_health_check,  # re-exported
)
from validations.jackpot.fixtures_io import load_fixture


ClientMode = Literal["live", "replay"]

_POOLS_BASE_URL_ENV = "POOLS_API_BASE_URL"
_JACKPOT_BASE_URL_ENV = "JACKPOT_API_BASE_URL"


def _base_url() -> str:
    """POOLS_API_BASE_URL takes precedence; falls through to JACKPOT_API_BASE_URL then localhost:3000."""
    return (
        os.environ.get(_POOLS_BASE_URL_ENV)
        or os.environ.get(_JACKPOT_BASE_URL_ENV)
        or DEFAULT_BASE_URL
    )


_CURSOR_RE = re.compile(r"^[A-Za-z0-9_\-=.]+$")


def _safe_cursor(raw: str) -> str:
    if not isinstance(raw, str) or not _CURSOR_RE.fullmatch(raw):
        raise ValueError("invalid cursor: must match ^[A-Za-z0-9_\\-=.]+$")
    return raw


__all__ = [
    "PoolsEndpointClient",
    "run_with_health_check",
    "ClientMode",
]


@dataclass
class PoolsEndpointClient:
    mode: ClientMode = "live"

    # -- singleton / current-moment endpoints -------------------------------

    def get_game_state(self) -> dict[str, Any]:
        if self.mode == "replay":
            return load_fixture("game-state-current.json")
        try:
            return get_json("/game/state", base_url=_base_url(), timeout=_TIMEOUT_READ)
        except Exception as exc:
            raise RuntimeError(_scrub(f"get_game_state failed: {exc!s}")) from None

    def get_tokens_analytics(self) -> dict[str, Any]:
        if self.mode == "replay":
            return load_fixture("tokens-analytics-current.json")
        try:
            return get_json(
                "/tokens/analytics", base_url=_base_url(), timeout=_TIMEOUT_READ
            )
        except Exception as exc:
            raise RuntimeError(_scrub(f"get_tokens_analytics failed: {exc!s}")) from None

    # -- history / replay / jackpot -----------------------------------------

    def get_history_levels_page(self, cursor: str | None = None) -> dict[str, Any]:
        if self.mode == "replay":
            return load_fixture("history-levels.json")
        path = "/history/levels"
        if cursor:
            path += f"?cursor={_safe_cursor(cursor)}"
        try:
            return get_json(path, base_url=_base_url(), timeout=_TIMEOUT_READ)
        except Exception as exc:
            raise RuntimeError(_scrub(f"get_history_levels_page failed: {exc!s}")) from None

    def get_replay_tickets(self, level: int) -> dict[str, Any]:
        level = int(level)
        if self.mode == "replay":
            return load_fixture(f"replay-tickets-level-{level}.json")
        try:
            return get_json(
                f"/replay/tickets/{level}",
                base_url=_base_url(),
                timeout=_TIMEOUT_READ,
            )
        except Exception as exc:
            raise RuntimeError(_scrub(f"get_replay_tickets({level}) failed: {exc!s}")) from None

    def get_replay_distributions(self, level: int) -> dict[str, Any]:
        level = int(level)
        if self.mode == "replay":
            return load_fixture(f"replay-distributions-level-{level}.json")
        try:
            return get_json(
                f"/replay/distributions/{level}",
                base_url=_base_url(),
                timeout=_TIMEOUT_READ,
            )
        except Exception as exc:
            raise RuntimeError(_scrub(f"get_replay_distributions({level}) failed: {exc!s}")) from None

    def get_replay_day(self, day: int) -> dict[str, Any]:
        day = int(day)
        if self.mode == "replay":
            return load_fixture(f"replay-day-{day}.json")
        try:
            return get_json(
                f"/replay/day/{day}", base_url=_base_url(), timeout=_TIMEOUT_READ
            )
        except Exception as exc:
            raise RuntimeError(_scrub(f"get_replay_day({day}) failed: {exc!s}")) from None

    def get_jackpot_level_overview(self, level: int) -> dict[str, Any]:
        level = int(level)
        if self.mode == "replay":
            return load_fixture(f"jackpot-level-{level}-overview.json")
        try:
            return get_json(
                f"/game/jackpot/{level}/overview",
                base_url=_base_url(),
                timeout=_TIMEOUT_READ,
            )
        except Exception as exc:
            raise RuntimeError(
                _scrub(f"get_jackpot_level_overview({level}) failed: {exc!s}")
            ) from None
