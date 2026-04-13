"""Paginator + physical-day-count builder for ``/history/levels``.

Security invariant (T-19-04-01 DoS): ``paginate_history_levels`` is bounded
to ``MAX_ITERATIONS`` (1000) to prevent a malicious or buggy cursor loop
from spinning forever. On overrun a ``ValueError`` is raised with scrubbed
context (no raw cursor token is echoed — T-19-04-04 Info Disclosure).

``build_level_jackpot_day_counts`` counts distinct physical days per
level where ``phase == "JACKPOT"``. If the indexer schema drifts and
neither ``phase`` nor ``level`` are present, this raises with a hint
to re-probe; never returns partial counts silently.
"""

from __future__ import annotations

from typing import Any


MAX_ITERATIONS = 1000


def _scrub_cursor(exc_msg: str) -> str:
    # Cursor tokens may encode indexer-internal state; strip anything
    # that looks like a long opaque string.
    import re
    return re.sub(r"[A-Za-z0-9+/=_-]{12,}", "<cursor-redacted>", exc_msg)


def paginate_history_levels(client) -> list[dict[str, Any]]:
    """Walk ``/history/levels`` nextCursor until exhausted.

    Aggregates all ``items`` into a single list. Raises ``ValueError``
    on iteration overrun (cycle / runaway cursor) with scrubbed message.
    """
    all_items: list[dict[str, Any]] = []
    cursor: str | None = None
    seen_cursors: set[str] = set()

    for _ in range(MAX_ITERATIONS):
        page = client.get_history_levels_page(cursor)
        items = page.get("items") or []
        all_items.extend(items)
        next_cursor = page.get("nextCursor")
        if not next_cursor:
            return all_items
        if next_cursor in seen_cursors:
            raise ValueError(
                _scrub_cursor(
                    f"paginate_history_levels: cursor cycle detected "
                    f"(cursor={next_cursor!r} already seen)"
                )
            )
        seen_cursors.add(next_cursor)
        cursor = next_cursor

    raise ValueError(
        _scrub_cursor(
            f"paginate_history_levels: exceeded {MAX_ITERATIONS} iterations "
            "without exhausting nextCursor"
        )
    )


def build_level_jackpot_day_counts(items: list[dict[str, Any]]) -> dict[int, int]:
    """Count distinct physical days per level where ``phase == 'JACKPOT'``.

    Returns ``{level: day_count}``. Raises ``ValueError`` when the required
    ``phase`` or ``level`` fields are missing across the whole list (schema
    drift sentinel).
    """
    if not items:
        return {}

    has_phase = any("phase" in it for it in items)
    has_level = any("level" in it for it in items)
    if not has_phase or not has_level:
        raise ValueError(
            "build_level_jackpot_day_counts: /history/levels schema drift — "
            "expected fields 'phase' and 'level' on items. Re-probe endpoint."
        )

    per_level_days: dict[int, set[int]] = {}
    for it in items:
        if it.get("phase") != "JACKPOT":
            continue
        lvl = it.get("level")
        day = it.get("day")
        if lvl is None or day is None:
            continue
        per_level_days.setdefault(int(lvl), set()).add(int(day))

    return {lvl: len(days) for lvl, days in per_level_days.items()}


def infer_compressed_flag(day_count: int) -> int | None:
    """Infer ``compressedJackpotFlag`` from physical-day count.

    Returns:
        2 on day_count==1 (turbo / single-shot),
        1 on day_count==3 (compressed),
        0 on day_count==5 (normal),
        None otherwise (unknown — caller logs discrepancy).
    """
    return {1: 2, 3: 1, 5: 0}.get(int(day_count))
