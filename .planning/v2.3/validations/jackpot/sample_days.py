"""Stratified sample day list for Phase 19 jackpot validation.

Frozen 24-tuple literal (per 19-RESEARCH §Stratified Sample List). Entry 25 is
the JACKPOT-06 "hero candidate" sample that must be filled at runtime by
Plan 19-04 (probe-driven: pick the day with the largest single-trait
divergence from the naive 6-bit unpack).

Selection is deterministic: reruns produce comparable results.
"""

from __future__ import annotations

from typing import Literal

Stratum = Literal[
    "fast_early",
    "fast_mid",
    "fast_late",
    "turbo_boundary",
    "turbo",
    "runout",
    "gameover",
    "hero_candidate",
]

# (day, level_expected, stratum, why)
SAMPLE_DAYS_CORE: tuple[tuple[int, int, Stratum, str], ...] = (
    (2,   1,   "fast_early",     "first jackpot day"),
    (5,   5,   "fast_early",     "bonus + whale_pass observable (live-probed)"),
    (10,  10,  "fast_early",     "early x10 boundary"),
    (25,  25,  "fast_mid",       "mid-decade"),
    (50,  50,  "fast_mid",       "x50 mid-cycle, hero deity probable (probed)"),
    (75,  75,  "fast_mid",       "mid-cycle late"),
    (99,  99,  "fast_late",      "x99->x00 transition candidate"),
    (100, 100, "fast_late",      "x00 milestone (probed: 16ETH whale ticket win)"),
    (101, 101, "turbo_boundary", "first turbo level"),
    (102, 102, "turbo",          "early turbo"),
    (103, 103, "turbo",          "early turbo"),
    (105, 103, "turbo",          "mid-turbo (probed)"),
    (110, 105, "turbo",          "late turbo"),
    (150, 108, "runout",         "post-turbo"),
    (200, 109, "runout",         "mid-runout"),
    (250, 109, "runout",         "mid-runout"),
    (300, 110, "runout",         "late-runout"),
    (350, 110, "runout",         "bonus + far-future BURNIE (probed)"),
    (400, 110, "runout",         "gameover candidate"),
    (450, 110, "gameover",       "post-gameover sustained"),
    (500, 111, "gameover",       "post-gameover BURNIE bonus (probed)"),
    (600, 111, "gameover",       "sustained gameover"),
    (700, 111, "gameover",       "late gameover"),
    (762, 111, "gameover",       "latest available (probed: roll2=404)"),
)

assert len(SAMPLE_DAYS_CORE) == 24, "SAMPLE_DAYS_CORE must be 24 frozen entries"


def extend_with_hero_candidate(
    day: int,
    level_expected: int,
    why: str = "largest single-trait divergence from naive 6-bit unpack",
) -> tuple[tuple[int, int, Stratum, str], ...]:
    """Return SAMPLE_DAYS_CORE + a 25th entry tagged ``hero_candidate``.

    Plan 19-04 fills this in after probing mismatches across SAMPLE_DAYS_CORE.
    """
    return SAMPLE_DAYS_CORE + ((day, level_expected, "hero_candidate", why),)
