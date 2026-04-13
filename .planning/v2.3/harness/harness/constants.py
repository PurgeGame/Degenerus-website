"""Typed constants with contract-source citations.

Task 1 (18-01): minimal stubs for conftest import surface.
Task 2 (18-01): populated with BPS / ETH / timing constants.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

CitationLabel = Literal["contract", "gt_paper", "audit_doc"]
# Per user directive: degenerus-audit/contracts/ is the ONLY contract source.
# No "turbo_spec" label. Regime behavior (fast vs runout) derives from the
# same contract source; only inputs (velocity, deposit inflow, death-clock
# state) differ.


@dataclass(frozen=True)
class Citation:
    path: str
    line: int | None
    label: CitationLabel
    anchor: str | None = None


@dataclass(frozen=True)
class Constant:
    name: str
    value: int | float | str
    unit: str
    citation: Citation
    notes: str = ""


CONSTANTS: dict[str, Constant] = {}


def get(name: str) -> Constant:
    """Return the Constant registered under ``name``; raise KeyError otherwise."""
    try:
        return CONSTANTS[name]
    except KeyError as exc:
        raise KeyError(f"unknown constant: {name!r}") from exc


def all_citations() -> list[Citation]:
    """Return every citation attached to a registered Constant, in insertion order."""
    return [c.citation for c in CONSTANTS.values()]
