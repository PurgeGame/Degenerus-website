"""Per-player total reconciliation helper (JACKPOT-02..05).

Reconciles ``winners[].totalEth`` against the sum of ``roll1`` + ``roll2``
ETH distributions (plus any BURNIE ETH-equivalent embedded in the winner
breakdown). Uses Python ``int`` (arbitrary precision) for wei — never
float.

Exclusions per 19-RESEARCH §Pitfalls:

- ``awardType`` in ``{"whale_pass", "dgnrs"}`` is NOT ETH (amount=1 is a
  quantity, not wei).
- Virtual deity entries with ``ticketIndex == 2**256 - 1`` MAY win but
  MAY not appear in ``winners[].totalEth``; excluded from roll1/roll2
  sums (caller emits an Info note).
- Rows with ``sourceLevel is None`` are included in aggregation but
  excluded from *classification* checks (callers handle classification).

T-19-02-02: Oversized arrays raise ``ValueError`` with scrubbed message.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

_TICKET_INDEX_SENTINEL = (1 << 256) - 1
_MAX_WINS = 100_000  # sanity bound (T-19-02-02)
_ETH_AWARD_TYPES = frozenset({"eth"})
_NON_ETH_AWARD_TYPES = frozenset({"whale_pass", "dgnrs"})


@dataclass
class ReconcileIssue:
    """Internal dataclass; callers convert to Discrepancy."""

    kind: str  # "mismatch" | "missing_address" | "sentinel_tolerated" | "oversized"
    address: str | None
    expected_wei: int
    observed_wei: int
    notes: str = ""


@dataclass
class ReconcileResult:
    issues: list[ReconcileIssue] = field(default_factory=list)
    # Per-address derived sum (roll1+roll2 ETH, excluding sentinels/non-ETH).
    derived_eth: dict[str, int] = field(default_factory=dict)
    # Addresses observed as sentinel entries (informational).
    sentinel_addresses: set[str] = field(default_factory=set)
    # Count of rows we skipped because sourceLevel was null.
    null_source_level_count: int = 0


def _safe_int(val: Any) -> int:
    """Coerce a wei value (string or int) to int. Empty/missing -> 0."""
    if val is None or val == "":
        return 0
    if isinstance(val, int):
        return val
    return int(str(val))


def _iter_eth_wins(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not payload:
        return []
    wins = payload.get("wins") or []
    if len(wins) > _MAX_WINS:
        raise ValueError(
            f"payload has {len(wins)} wins (>{_MAX_WINS} sanity cap); aborting"
        )
    return wins


def reconcile_player_totals(
    winners_payload: dict[str, Any],
    roll1_payload: dict[str, Any] | None,
    roll2_payload: dict[str, Any] | None,
) -> ReconcileResult:
    """Compare per-player ``winners[].totalEth`` vs sum(roll1+roll2 ETH).

    Does NOT compare against ``breakdown`` — that is redundant with
    ``totalEth`` by construction. Callers that need breakdown-vs-total
    reconciliation call :func:`check_breakdown_matches_total`.
    """
    result = ReconcileResult()

    derived: dict[str, int] = defaultdict(int)

    for source in (roll1_payload, roll2_payload):
        wins = _iter_eth_wins(source)
        for win in wins:
            award = win.get("awardType")
            if award in _NON_ETH_AWARD_TYPES:
                continue  # whale_pass / dgnrs excluded from ETH sums
            if award not in _ETH_AWARD_TYPES:
                continue  # burnie / unknown: not ETH
            ticket_idx = win.get("ticketIndex")
            if ticket_idx == _TICKET_INDEX_SENTINEL:
                addr = (win.get("winner") or "").lower()
                if addr:
                    result.sentinel_addresses.add(addr)
                continue
            if win.get("sourceLevel") is None:
                result.null_source_level_count += 1
                # Still include in aggregation — the amount is real even
                # if the classification metadata is missing.
            addr = (win.get("winner") or "").lower()
            if not addr:
                continue
            derived[addr] += _safe_int(win.get("amount"))

    # Compare against winners[].totalEth
    winners = winners_payload.get("winners") or []
    if len(winners) > _MAX_WINS:
        raise ValueError(
            f"winners payload has {len(winners)} rows (>{_MAX_WINS} cap)"
        )
    for w in winners:
        addr = (w.get("address") or "").lower()
        if not addr:
            continue
        observed = _safe_int(w.get("totalEth"))
        expected = derived.get(addr, 0)
        if observed != expected:
            result.issues.append(
                ReconcileIssue(
                    kind="mismatch",
                    address=addr,
                    expected_wei=expected,
                    observed_wei=observed,
                    notes=f"diff={observed - expected}",
                )
            )

    # Addresses that appeared in roll1/roll2 but not in winners[]
    observed_addrs = {
        (w.get("address") or "").lower() for w in winners if w.get("address")
    }
    for addr, amount in derived.items():
        if addr not in observed_addrs and amount > 0:
            result.issues.append(
                ReconcileIssue(
                    kind="missing_address",
                    address=addr,
                    expected_wei=amount,
                    observed_wei=0,
                    notes="address present in rolls but absent from winners[]",
                )
            )

    result.derived_eth = dict(derived)
    return result


def day_level_eth_sum(winners_payload: dict[str, Any]) -> int:
    """Return the sum of ``winners[].totalEth`` as an int (wei)."""
    total = 0
    for w in winners_payload.get("winners") or []:
        total += _safe_int(w.get("totalEth"))
    return total
