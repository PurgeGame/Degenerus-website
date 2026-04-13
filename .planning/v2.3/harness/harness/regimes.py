"""Velocity regime inputs for expected-value derivation.

Per user directive (CLAUDE.md + 18-CONTEXT.md Decision 5): regimes are
``fast`` (levels 1-101 at maximum velocity, purchase phase exits in a
single day) and ``runout`` (post-101, purchasing stopped, death clock
drains). Both derive from the SAME contract source at
``degenerus-audit/contracts/``. Regime only changes inputs (velocity,
deposit inflow, death-clock state). NO separate turbo codebase. Any
``regime`` string outside ``{"fast","runout"}`` raises ``ValueError``.
"""

from __future__ import annotations

from dataclasses import dataclass

from harness.archetypes import VELOCITY_REGIMES
from harness.constants import get as _get_const


@dataclass(frozen=True)
class RegimeInputs:
    velocity_regime: str  # "fast" or "runout"
    level_transitions_per_day: float  # fast: >=1.0 (single-day purchase phase); runout: 0.0
    new_deposits_flowing: bool  # fast: True; runout: False
    death_clock_days_remaining: int  # derived from contract DEATH_CLOCK_* constants
    notes: str


_DEATH_CLOCK_POLICY_NOTE = (
    "degenerus-audit/contracts/ v1.1 has no sub-120 death clock; any sim-observed "
    "sub-120 value is a regime-induced divergence to log, not a contract constant."
)


def _death_clock_for(level: int) -> int:
    """Return the canonical death-clock days-remaining for ``level``.

    Level 0 uses ``DEPLOY_IDLE_TIMEOUT_DAYS`` (365). Level 1+ uses the
    hardcoded 120 days per ``TERMINAL_DEC_DEATH_CLOCK_DAYS``.
    """
    if level <= 0:
        return int(_get_const("DEATH_CLOCK_LEVEL_0_DAYS").value)
    return int(_get_const("DEATH_CLOCK_LEVEL_1_PLUS_DAYS").value)


def fast_inputs(level: int, day: int) -> RegimeInputs:
    """Inputs for the fast-velocity regime (purchase phase exits in a single day)."""
    return RegimeInputs(
        velocity_regime="fast",
        level_transitions_per_day=1.0,
        new_deposits_flowing=True,
        death_clock_days_remaining=_death_clock_for(level),
        notes=(
            "fast regime: purchase phase exits in ~1 day; deposits flowing; "
            "death clock at canonical contract value ("
            + _DEATH_CLOCK_POLICY_NOTE
            + ")"
        ),
    )


def runout_inputs(level: int, day: int) -> RegimeInputs:
    """Inputs for the runout regime (post-101: purchasing stopped, clock drains)."""
    return RegimeInputs(
        velocity_regime="runout",
        level_transitions_per_day=0.0,
        new_deposits_flowing=False,
        death_clock_days_remaining=_death_clock_for(level),
        notes=(
            "runout regime: purchasing stopped, death clock drains, no new "
            "deposits. Drip/drawdown operate on existing futurepool balance only. "
            + _DEATH_CLOCK_POLICY_NOTE
        ),
    )


def inputs_for(level: int, day: int, regime: str) -> RegimeInputs:
    """Dispatch ``regime`` to the appropriate builder.

    Raises ``ValueError`` for any string outside ``VELOCITY_REGIMES``
    ({"fast","runout"}). This mechanically enforces the user directive
    that "turbo" and "standard" are NOT valid regime labels.
    """
    if regime not in VELOCITY_REGIMES:
        raise ValueError(
            f"unknown velocity_regime {regime!r}; allowed regimes are "
            f"{sorted(VELOCITY_REGIMES)!r} (fast, runout). "
            "Per user directive: 'turbo' and 'standard' are NOT valid — both "
            "fast and runout derive from the same degenerus-audit/contracts/ source."
        )
    if regime == "fast":
        return fast_inputs(level, day)
    return runout_inputs(level, day)
