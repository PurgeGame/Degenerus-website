"""Phase 20 sample-level list derived from Phase 19 SAMPLE_DAYS_CORE.

Do NOT rebuild the sample. The canonical source is
``validations.jackpot.sample_days.SAMPLE_DAYS_CORE``; we dedupe the
``level_expected`` column and sort to produce ``SAMPLE_LEVELS``.
"""

from __future__ import annotations

from validations.jackpot.sample_days import SAMPLE_DAYS_CORE

SAMPLE_LEVELS: tuple[int, ...] = tuple(
    sorted({level for (_day, level, _stratum, _why) in SAMPLE_DAYS_CORE})
)

assert 15 <= len(SAMPLE_LEVELS) <= 24, (
    f"SAMPLE_LEVELS expected 15-24 distinct levels, got {len(SAMPLE_LEVELS)}"
)


def level_to_stratum(level: int) -> str | None:
    """Return the first stratum seen for ``level`` in SAMPLE_DAYS_CORE (or None)."""
    for (_day, lvl, stratum, _why) in SAMPLE_DAYS_CORE:
        if lvl == level:
            return stratum
    return None
