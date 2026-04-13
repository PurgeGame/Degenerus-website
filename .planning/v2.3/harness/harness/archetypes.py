"""Archetype profiles + Deity overlay + velocity-regime literals.

Decision 7 (18-CONTEXT.md): compute expected values per-archetype for
Degen, Grinder, Whale, Hybrid. Deity pass is an overlay flag, not a
primary archetype.

Activity floors are decimal (bps / 10000). Values per CLAUDE.md memory:
  - No pass: 0.00
  - Lazy (10-level bundle): 0.85 (50% streak + 25% mint + 10% bonus)
  - Whale (100-level bundle, bundleType=3): 1.15 (50% + 25% + 40%)
  - Deity pass: 1.55 (50% + 25% + 80%)
Hybrid cluster: nominal floor 0.85 (they can hold passes), empirical
range 0.85-1.50 per GT paper hybrid-cluster discussion.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ArchetypeName = Literal["Degen", "Grinder", "Whale", "Hybrid"]
VelocityRegime = Literal["fast", "runout"]
# Per user directive: regimes are "fast" and "runout" (NOT "turbo"/"standard").
# Both derive from the same contract source at degenerus-audit/contracts/.


@dataclass(frozen=True)
class ArchetypeProfile:
    name: ArchetypeName
    activity_floor: float
    primary_products: tuple[str, ...]
    deity_eligible: bool
    notes: str


_profiles: list[ArchetypeProfile] = [
    ArchetypeProfile(
        name="Degen",
        activity_floor=0.00,
        primary_products=("coinflip", "degenerette"),
        deity_eligible=True,
        notes="Entertainment-first. Activity floor depends on pass held; no-pass baseline is 0.00.",
    ),
    ArchetypeProfile(
        name="Grinder",
        activity_floor=0.85,
        primary_products=("lootbox", "quest"),
        deity_eligible=True,
        notes="EV maximizer. Lazy-pass baseline 0.85. Lootbox breakeven at a=0.60, EV cap at a=2.55.",
    ),
    ArchetypeProfile(
        name="Whale",
        activity_floor=1.15,
        primary_products=("tickets", "lootbox", "pass"),
        deity_eligible=True,
        notes="100-level bundle (bundleType=3): 50% streak + 25% mint + 40% pass bonus = 1.15 at start.",
    ),
    ArchetypeProfile(
        name="Hybrid",
        activity_floor=0.85,
        primary_products=("tickets", "coinflip", "quest", "lootbox"),
        deity_eligible=True,
        notes="Breakeven cluster; typical empirical range 0.85-1.50. Floor matches lazy-pass baseline.",
    ),
]


ARCHETYPES: dict[str, ArchetypeProfile] = {p.name: p for p in _profiles}

# Velocity regime sentinel. Per user directive: only "fast" and "runout".
VELOCITY_REGIMES: frozenset[str] = frozenset({"fast", "runout"})

# Overlay thresholds (decimal, score = bps / 10000).
DEITY_FLOOR: float = 1.55
LOOTBOX_BREAKEVEN: float = 0.60
LOOTBOX_EV_CAP: float = 2.55
ACTIVITY_MAX: float = 3.05
