"""HTTP helper layer for the derivation harness.

``check_api_health()`` hits ``/health`` and returns a ``HealthSnapshot``
whose ``lag_unreliable`` flag is set whenever ``lagBlocks > 10``
(strict inequality, per METHOD-05).

Security invariant (T-18-03-03): exception messages surface the URL
that failed and the HTTP status only. Environment variables — including
any credential-like tokens — are never echoed into exceptions, logs, or
returned data. Tests set ``HARNESS_API_TOKEN=secret123`` and assert the
string never appears in raised exception text or captured stdout/stderr.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import requests

# Exposed for monkeypatching in tests (avoid patching the third-party
# module directly so test isolation is clean).
requests_get = requests.get  # type: ignore[assignment]


DEFAULT_BASE_URL = "http://localhost:3000"
LAG_THRESHOLD = 10  # strict > 10 triggers lag_unreliable=True


@dataclass(frozen=True)
class HealthSnapshot:
    lag_blocks: int
    lag_seconds: int
    indexed_block: int
    chain_tip: int
    backfill_complete: bool
    lag_unreliable: bool
    sampled_at: str  # ISO-8601 UTC, Z-suffixed


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def _safe_request_error(url: str, exc: Exception) -> RuntimeError:
    """Build an exception whose message references only the URL + class name."""
    return RuntimeError(
        f"request to {url} failed: {type(exc).__name__}"
    )


def get_json(
    path: str,
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = 5.0,
) -> dict:
    """GET ``{base_url}{path}``, return the decoded JSON body."""
    url = f"{base_url.rstrip('/')}{path if path.startswith('/') else '/' + path}"
    try:
        resp = requests_get(url, timeout=timeout)
    except Exception as exc:
        raise _safe_request_error(url, exc) from None
    try:
        resp.raise_for_status()
    except Exception as exc:
        # Do not pass the underlying exception message through — it may
        # include headers. Surface URL + status only.
        status = getattr(resp, "status_code", "unknown")
        raise RuntimeError(f"HTTP {status} from {url}") from None
    return resp.json()


def check_api_health(
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = 5.0,
) -> HealthSnapshot:
    """GET ``{base_url}/health`` and return a ``HealthSnapshot``.

    Raises ``RuntimeError`` on network / HTTP errors; the exception
    message is scrubbed to URL + class name / status only.
    """
    payload = get_json("/health", base_url=base_url, timeout=timeout)
    lag_blocks = int(payload.get("lagBlocks", 0))
    lag_seconds = int(payload.get("lagSeconds", 0))
    indexed_block = int(payload.get("indexedBlock", 0))
    chain_tip = int(payload.get("chainTip", 0))
    backfill_complete = bool(payload.get("backfillComplete", False))
    return HealthSnapshot(
        lag_blocks=lag_blocks,
        lag_seconds=lag_seconds,
        indexed_block=indexed_block,
        chain_tip=chain_tip,
        backfill_complete=backfill_complete,
        lag_unreliable=lag_blocks > LAG_THRESHOLD,
        sampled_at=_utc_now_iso(),
    )
