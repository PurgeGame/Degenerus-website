"""Archetype profiles + deity overlay + velocity regime literals.

Task 1 (18-01): minimal stubs for conftest.
Task 2 (18-01): populated per CONTEXT.md Decision 7 with activity floors
and overlay thresholds.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ArchetypeName = Literal["Degen", "Grinder", "Whale", "Hybrid"]
VelocityRegime = Literal["fast", "runout"]
# Per user directive: regimes are named "fast" and "runout" (NOT
# "turbo"/"standard"). Both derive from the same contract source.


@dataclass(frozen=True)
class ArchetypeProfile:
    name: ArchetypeName
    activity_floor: float
    primary_products: tuple[str, ...]
    deity_eligible: bool
    notes: str


ARCHETYPES: dict[str, ArchetypeProfile] = {}
VELOCITY_REGIMES: frozenset[str] = frozenset({"fast", "runout"})

# Overlay thresholds (decimal, score = bps / 10000).
DEITY_FLOOR: float = 1.55
LOOTBOX_BREAKEVEN: float = 0.60
LOOTBOX_EV_CAP: float = 2.55
ACTIVITY_MAX: float = 3.05
