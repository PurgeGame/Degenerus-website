"""Pools-phase transition enumerator for ``/history/levels``.

Walks ``/history/levels`` pages via ``paginate_history_levels`` and extracts
ordered ``(level_from, level_to, block_at_jackpot_end)`` tuples where a
``stage=7`` JACKPOT row is immediately followed by a ``stage in (3,10)``
PURCHASE row at ``level_from + 1``.

Security invariants:
- T-20-02-01 DoS: bounded ``max_iter`` (default 1000) raises ``ValueError`` on
  runaway cursor chains.
- T-20-02-02 Info Disclosure: raw cursor tokens never echoed in exceptions;
  scrubbed via ``_scrub_cursor``.
- T-20-02-05 Spoofing: orphan stage=7 rows (no following PURCHASE) and
  level-gap transitions (next PURCHASE level != level_from + 1) are skipped.

The jackpot-phase ``paginate_history_levels`` in
``validations.jackpot.history_levels`` cannot be reused directly because it
hard-codes ``MAX_ITERATIONS=1000`` at module scope with no per-call override
(needed to unit-test the DoS guard deterministically). The reused pieces are
``_scrub_cursor`` (imported) and the overall walk pattern.
"""

from __future__ import annotations

from typing import Any

from validations.jackpot.history_levels import _scrub_cursor


DEFAULT_MAX_ITER = 1000


def paginate_history_levels(client, *, max_iter: int = DEFAULT_MAX_ITER) -> list[dict[str, Any]]:
    """Walk ``/history/levels`` nextCursor until exhausted or ``max_iter`` hit.

    Re-raises client errors as ``RuntimeError`` with scrubbed message.
    Raises ``ValueError`` on cursor cycle or iteration overrun; cursor tokens
    are redacted via ``_scrub_cursor`` so they never appear in exceptions.
    """
    all_items: list[dict[str, Any]] = []
    cursor: str | None = None
    seen: set[str] = set()

    for _ in range(max_iter):
        try:
            page = client.get_history_levels_page(cursor)
        except Exception as exc:
            raise RuntimeError(
                _scrub_cursor(f"paginate_history_levels client call failed: {exc!s}")
            ) from None

        items = page.get("items") or []
        all_items.extend(items)
        next_cursor = page.get("nextCursor")
        if not next_cursor:
            return all_items
        if next_cursor in seen:
            raise ValueError(
                _scrub_cursor(
                    f"paginate_history_levels: cursor cycle detected "
                    f"(cursor={next_cursor!r} already seen)"
                )
            )
        seen.add(next_cursor)
        cursor = next_cursor

    raise ValueError(
        _scrub_cursor(
            f"paginate_history_levels: exceeded {max_iter} iterations "
            "without exhausting nextCursor"
        )
    )


def enumerate_transitions(
    client, *, max_iter: int = DEFAULT_MAX_ITER
) -> list[tuple[int, int, int]]:
    """Return ordered list of ``(level_from, level_to, block_at_jackpot_end)``.

    Derivation: for each item where ``stage == 7`` and ``phase == 'JACKPOT'``,
    search forward for the next item with ``stage in (3, 10)`` and
    ``phase == 'PURCHASE'``. If such an item exists and its ``level`` equals
    ``level_from + 1``, yield the transition. Otherwise skip (orphan or gap).
    """
    items = paginate_history_levels(client, max_iter=max_iter)
    results: list[tuple[int, int, int]] = []

    for i, row in enumerate(items):
        if row.get("stage") != 7 or row.get("phase") != "JACKPOT":
            continue
        next_purchase = None
        for cand in items[i + 1:]:
            if cand.get("stage") in (3, 10) and cand.get("phase") == "PURCHASE":
                next_purchase = cand
                break
        if next_purchase is None:
            continue
        lvl_from = int(row["level"])
        lvl_to = int(next_purchase["level"])
        if lvl_to != lvl_from + 1:
            continue
        results.append((lvl_from, lvl_to, int(row["blockNumber"])))

    return results
