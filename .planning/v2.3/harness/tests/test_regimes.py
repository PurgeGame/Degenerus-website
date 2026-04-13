"""Unit tests for harness.regimes."""

from __future__ import annotations

import pytest

from harness.regimes import (
    RegimeInputs,
    fast_inputs,
    runout_inputs,
    inputs_for,
)
from harness.constants import get as get_const


def test_fast_inputs_level50_day50():
    ri = inputs_for(level=50, day=50, regime="fast")
    assert isinstance(ri, RegimeInputs)
    assert ri.velocity_regime == "fast"
    assert ri.new_deposits_flowing is True
    assert ri.level_transitions_per_day >= 1.0


def test_runout_inputs_level105_day200():
    ri = inputs_for(level=105, day=200, regime="runout")
    assert ri.velocity_regime == "runout"
    assert ri.new_deposits_flowing is False
    assert ri.level_transitions_per_day == 0.0


def test_death_clock_level0_is_365():
    ri = inputs_for(level=0, day=0, regime="fast")
    assert ri.death_clock_days_remaining == int(get_const("DEATH_CLOCK_LEVEL_0_DAYS").value)
    assert ri.death_clock_days_remaining == 365


def test_death_clock_level1_plus_is_120():
    ri = inputs_for(level=50, day=50, regime="fast")
    assert ri.death_clock_days_remaining == int(get_const("DEATH_CLOCK_LEVEL_1_PLUS_DAYS").value)
    assert ri.death_clock_days_remaining == 120


def test_runout_death_clock_level_1_plus():
    ri = inputs_for(level=105, day=200, regime="runout")
    assert ri.death_clock_days_remaining == 120


@pytest.mark.parametrize("bad", ["turbo", "standard", "", "FAST", "Runout", "unknown"])
def test_invalid_regime_raises(bad: str):
    with pytest.raises(ValueError) as exc:
        inputs_for(level=1, day=1, regime=bad)
    msg = str(exc.value)
    assert "fast" in msg and "runout" in msg


def test_turbo_rejected_specifically():
    with pytest.raises(ValueError) as exc:
        inputs_for(level=50, day=50, regime="turbo")
    assert "turbo" not in {"fast", "runout"}
    # error message must mention the allowed set
    assert "fast" in str(exc.value) and "runout" in str(exc.value)


def test_fast_inputs_direct_call():
    ri = fast_inputs(level=10, day=5)
    assert ri.velocity_regime == "fast"
    assert ri.new_deposits_flowing is True


def test_runout_inputs_direct_call():
    ri = runout_inputs(level=105, day=300)
    assert ri.velocity_regime == "runout"
    assert ri.new_deposits_flowing is False


def test_notes_mention_contract_source_policy():
    ri = inputs_for(level=50, day=50, regime="fast")
    # Per plan: notes must clarify that sub-120 death clocks are not in v1.1 audit contracts.
    assert "120" in ri.notes or "degenerus-audit" in ri.notes
