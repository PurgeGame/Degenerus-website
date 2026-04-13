"""Unit tests for harness.constants."""

from __future__ import annotations

import pytest

from harness.constants import (
    CONSTANTS,
    Citation,
    Constant,
    all_citations,
    get,
)

_VALID_LABELS = {"contract", "gt_paper", "audit_doc"}

# Stale / non-canonical path fragments that MUST NOT appear in any citation.
_FORBIDDEN_FRAGMENTS = (
    "v1.1-ECONOMICS-PRIMER",
    "v1.1-parameter-reference",
    "v1.1-eth-inflows",
    "v1.1-pool-architecture",
    "v1.1-purchase-phase-distribution",
    "v1.1-jackpot-phase-draws",
    "v1.1-transition-jackpots",
    "v1.1-burnie-coinflip",
    "v1.1-burnie-supply",
    "v1.1-level-progression",
    "v1.1-endgame-and-activity",
    "v1.1-dgnrs-tokenomics",
    "v1.1-deity-system",
    "v1.1-affiliate-system",
    "v1.1-steth-yield",
    "v1.1-quest-rewards",
    "testing/contracts",
    "degenerus-contracts/",
)

_CANONICAL_PATH_PREFIXES = (
    "degenerus-audit/contracts/",
    "degenerus-audit/audit/",
    "theory/index.html",
)


def test_registry_non_empty():
    assert len(CONSTANTS) > 0


def test_every_constant_has_citation():
    for name, const in CONSTANTS.items():
        assert isinstance(const.citation, Citation), name
        assert const.citation.path, f"{name}: empty citation path"
        assert const.citation.label in _VALID_LABELS, (
            f"{name}: invalid label {const.citation.label!r}"
        )


def test_no_stale_primer_refs():
    for name, const in CONSTANTS.items():
        for bad in _FORBIDDEN_FRAGMENTS:
            assert bad not in const.citation.path, (
                f"{name}: citation path {const.citation.path!r} contains forbidden fragment {bad!r}"
            )


def test_citation_paths_are_canonical():
    for name, const in CONSTANTS.items():
        assert const.citation.path.startswith(_CANONICAL_PATH_PREFIXES), (
            f"{name}: citation path {const.citation.path!r} does not start with a canonical prefix"
        )


def test_known_bps_values():
    assert get("PURCHASE_TO_FUTURE_BPS").value == 1000
    assert get("LOOTBOX_TO_FUTURE_BPS").value == 9000
    assert get("STETH_ACCUMULATOR_BPS").value == 5000
    assert get("STETH_A_BPS").value == 2500
    assert get("STETH_B_BPS").value == 2500
    assert get("FUTURE_DRAWDOWN_BPS").value == 1500
    assert get("FUTURE_DRIP_BPS").value == 100


def test_death_clock_constants():
    assert get("DEATH_CLOCK_LEVEL_0_DAYS").value == 365
    assert get("DEATH_CLOCK_LEVEL_1_PLUS_DAYS").value == 120


def test_activity_score_bounds():
    assert get("ACTIVITY_MAX_BPS").value == 30500
    assert get("STREAK_FLOOR_BPS").value == 5000
    assert get("MINT_FLOOR_BPS").value == 2500


def test_deity_pass_cap():
    assert get("DEITY_PASS_MAX_TOTAL").value == 32


def test_affiliate_dgnrs_deity():
    assert get("AFFILIATE_DGNRS_DEITY_BONUS_BPS").value == 2000
    # Cap stored as str to avoid float coercion; must parse to 5e18 wei.
    assert int(get("AFFILIATE_DGNRS_DEITY_CAP_WEI").value) == 5 * 10**18


def test_price_coin_unit():
    assert get("PRICE_COIN_UNIT_ETHER").value == 1000


def test_get_returns_constant(sample_citation):
    c = get("PURCHASE_TO_FUTURE_BPS")
    assert isinstance(c, Constant)
    assert c.name == "PURCHASE_TO_FUTURE_BPS"


def test_get_raises_on_unknown():
    with pytest.raises(KeyError):
        get("THIS_CONSTANT_DOES_NOT_EXIST")


def test_all_citations_matches_registry():
    cites = all_citations()
    assert len(cites) == len(CONSTANTS)
    assert all(isinstance(c, Citation) for c in cites)


def test_bps_constants_are_int():
    """BPS / days / count values must be int (no float coercion)."""
    for name, const in CONSTANTS.items():
        if const.unit in ("bps", "days", "count"):
            assert isinstance(const.value, int), (
                f"{name}: unit={const.unit} but value type={type(const.value).__name__}"
            )
