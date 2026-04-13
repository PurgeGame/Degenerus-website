"""Unit tests for harness.archetypes."""

from __future__ import annotations

from harness.archetypes import (
    ACTIVITY_MAX,
    ARCHETYPES,
    ArchetypeProfile,
    DEITY_FLOOR,
    LOOTBOX_BREAKEVEN,
    LOOTBOX_EV_CAP,
    VELOCITY_REGIMES,
)


def test_four_primary_archetypes():
    assert set(ARCHETYPES.keys()) == {"Degen", "Grinder", "Whale", "Hybrid"}


def test_all_profiles_are_archetype_profile():
    for name, profile in ARCHETYPES.items():
        assert isinstance(profile, ArchetypeProfile)
        assert profile.name == name


def test_activity_floors():
    assert ARCHETYPES["Degen"].activity_floor == 0.00
    assert ARCHETYPES["Grinder"].activity_floor == 0.85
    assert ARCHETYPES["Whale"].activity_floor == 1.15
    hybrid_floor = ARCHETYPES["Hybrid"].activity_floor
    assert 0.85 <= hybrid_floor <= 1.50


def test_deity_overlay_values():
    assert DEITY_FLOOR == 1.55
    assert LOOTBOX_BREAKEVEN == 0.60
    assert LOOTBOX_EV_CAP == 2.55
    assert ACTIVITY_MAX == 3.05


def test_velocity_regime_literal_values():
    assert VELOCITY_REGIMES == frozenset({"fast", "runout"})
    # Guard against silent renaming back to the turbo/standard vocabulary.
    assert "turbo" not in VELOCITY_REGIMES
    assert "standard" not in VELOCITY_REGIMES


def test_all_archetypes_have_primary_products():
    for name, profile in ARCHETYPES.items():
        assert isinstance(profile.primary_products, tuple), name
        assert len(profile.primary_products) >= 1, name
        for product in profile.primary_products:
            assert isinstance(product, str) and product, name


def test_sample_archetype_fixture(sample_archetype):
    """conftest.sample_archetype returns the Whale profile."""
    assert sample_archetype is ARCHETYPES["Whale"]
    assert sample_archetype.activity_floor == 1.15
