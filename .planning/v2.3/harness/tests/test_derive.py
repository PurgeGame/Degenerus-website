"""Unit tests for harness.derive.expected_values()."""

from __future__ import annotations

from decimal import Decimal

import pytest

from harness.derive import DerivedField, DerivedValues, expected_values
from harness.constants import get as get_const


_ARCHETYPES = ("Degen", "Grinder", "Whale", "Hybrid")
_REGIMES = ("fast", "runout")

# Minimum required keys by domain per plan.
_REQUIRED_FIELDS = {
    # POOLS
    "ticket_split_to_future_bps",
    "lootbox_split_to_future_bps",
    "future_drip_daily_bps",
    "future_drawdown_on_transition_bps",
    "steth_accumulator_share_bps",
    "steth_a_share_bps",
    "steth_b_share_bps",
    # PLAYER
    "activity_score_floor",
    "lootbox_breakeven_score",
    "lootbox_ev_cap_score",
    "activity_score_max",
    "coinflip_payout_mean",
    "burnie_ratchet_tokens_per_ticket",
    # TERMINAL
    "death_clock_days_remaining",
    "terminal_per_ticket_eth",
    "deposit_insurance_terminal_eth",
}

_FORBIDDEN_FRAGMENTS = (
    "testing/contracts",
    "degenerus-contracts/",
    "v1.1-",
)


@pytest.mark.parametrize("archetype", _ARCHETYPES)
@pytest.mark.parametrize("regime", _REGIMES)
def test_all_permutations_produce_valid_result(archetype: str, regime: str):
    level, day = (50, 50) if regime == "fast" else (105, 200)
    dv = expected_values(level=level, day=day, archetype=archetype, velocity_regime=regime)
    assert isinstance(dv, DerivedValues)
    assert dv.archetype == archetype
    assert dv.velocity_regime == regime
    missing = _REQUIRED_FIELDS - set(dv.fields.keys())
    assert not missing, f"missing fields for {archetype}/{regime}: {missing}"


def _sample() -> DerivedValues:
    return expected_values(level=50, day=50, archetype="Whale", velocity_regime="fast")


def test_every_field_has_citation():
    dv = _sample()
    for name, field in dv.fields.items():
        assert isinstance(field, DerivedField)
        assert len(field.citations) >= 1, f"{name} has no citations"
        assert field.formula, f"{name} has empty formula"


def test_no_stale_citation_paths():
    for archetype in _ARCHETYPES:
        for regime in _REGIMES:
            level, day = (50, 50) if regime == "fast" else (105, 200)
            dv = expected_values(level=level, day=day, archetype=archetype, velocity_regime=regime)
            for fname, field in dv.fields.items():
                for c in field.citations:
                    for bad in _FORBIDDEN_FRAGMENTS:
                        assert bad not in c.path, (
                            f"{archetype}/{regime}/{fname} citation path {c.path!r} "
                            f"contains forbidden fragment {bad!r}"
                        )
                    # must start with one of the canonical prefixes
                    assert (
                        c.path.startswith("degenerus-audit/contracts/")
                        or c.path.startswith("degenerus-audit/audit/")
                        or c.path.startswith("theory/index.html")
                    ), f"{fname} non-canonical citation path: {c.path!r}"


@pytest.mark.parametrize(
    "archetype,expected",
    [("Degen", 0.00), ("Grinder", 0.85), ("Whale", 1.15), ("Hybrid", 0.85)],
)
def test_activity_floor_per_archetype(archetype: str, expected: float):
    dv = expected_values(level=50, day=50, archetype=archetype, velocity_regime="fast")
    floor = float(dv.fields["activity_score_floor"].value)
    if archetype == "Hybrid":
        assert floor >= 0.85
    else:
        assert floor == pytest.approx(expected)


def test_invalid_archetype_raises():
    with pytest.raises(ValueError):
        expected_values(level=50, day=50, archetype="Goblin", velocity_regime="fast")


def test_invalid_regime_raises():
    with pytest.raises(ValueError):
        expected_values(level=50, day=50, archetype="Whale", velocity_regime="turbo")


def test_bps_values_match_constants():
    dv = _sample()
    assert int(dv.fields["ticket_split_to_future_bps"].value) == int(
        get_const("PURCHASE_TO_FUTURE_BPS").value
    )
    assert int(dv.fields["lootbox_split_to_future_bps"].value) == int(
        get_const("LOOTBOX_TO_FUTURE_BPS").value
    )
    assert int(dv.fields["future_drip_daily_bps"].value) == int(
        get_const("FUTURE_DRIP_BPS").value
    )
    assert int(dv.fields["future_drawdown_on_transition_bps"].value) == int(
        get_const("FUTURE_DRAWDOWN_BPS").value
    )
    assert int(dv.fields["steth_accumulator_share_bps"].value) == 5000
    assert int(dv.fields["steth_a_share_bps"].value) == 2500
    assert int(dv.fields["steth_b_share_bps"].value) == 2500


def test_runout_fields_note_no_new_inflow():
    dv = expected_values(level=105, day=200, archetype="Whale", velocity_regime="runout")
    drip = dv.fields["future_drip_daily_bps"]
    # drip field still present, notes mention no new inflow
    assert "no new inflow" in drip.notes.lower() or "no new deposits" in drip.notes.lower()


def test_death_clock_comes_from_regime():
    dv = expected_values(level=0, day=0, archetype="Degen", velocity_regime="fast")
    assert int(dv.fields["death_clock_days_remaining"].value) == 365
    dv2 = expected_values(level=50, day=50, archetype="Degen", velocity_regime="fast")
    assert int(dv2.fields["death_clock_days_remaining"].value) == 120


def test_coinflip_mean_and_burnie_ratchet():
    dv = _sample()
    assert float(dv.fields["coinflip_payout_mean"].value) == pytest.approx(1.9685)
    assert int(dv.fields["burnie_ratchet_tokens_per_ticket"].value) == 1000


def test_lootbox_breakeven_and_ev_cap():
    dv = _sample()
    assert float(dv.fields["lootbox_breakeven_score"].value) == pytest.approx(0.60)
    assert float(dv.fields["lootbox_ev_cap_score"].value) == pytest.approx(2.55)
    assert float(dv.fields["activity_score_max"].value) == pytest.approx(3.05)


def test_terminal_fields_present_with_formula():
    dv = _sample()
    per_ticket = dv.fields["terminal_per_ticket_eth"]
    insurance = dv.fields["deposit_insurance_terminal_eth"]
    assert per_ticket.formula  # symbolic formula string
    assert insurance.formula
    # numeric reference appears in value or notes
    assert "0.146" in str(per_ticket.value) or "0.146" in per_ticket.notes
    assert "125" in str(insurance.value) or "125" in insurance.notes


def test_regime_tag_on_every_field():
    dv = expected_values(level=50, day=50, archetype="Grinder", velocity_regime="fast")
    for field in dv.fields.values():
        assert field.regime == "fast"
