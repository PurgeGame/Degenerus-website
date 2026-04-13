"""Expected-value derivation layer.

``expected_values(level, day, archetype, velocity_regime) -> DerivedValues``
is the single public entry point phases 19-22 consume. Every returned
``DerivedField`` carries a plain-text ``formula`` and at least one
``Citation`` rooted in ``degenerus-audit/contracts/`` or
``theory/index.html``.

Organized internally by domain:
  - ``_jackpot_fields`` — BURNIE ratchet + jackpot-relevant BPS (full
    payout formulas land in Phase 19).
  - ``_pools_fields`` — ticket/lootbox split, drip, drawdown, stETH
    yield split, accumulator.
  - ``_player_fields`` — activity floor, lootbox breakeven/cap,
    coinflip mean, BURNIE ratchet.
  - ``_terminal_fields`` — death clock (via regimes), terminal
    per-ticket ETH (symbolic formula; numeric reference in notes),
    segregated-accumulator ~125 ETH insurance.

Regime only affects inputs (deposit inflow, death-clock state). Both
``fast`` and ``runout`` derive from the same contract source. Any
``velocity_regime`` outside ``{"fast","runout"}`` is rejected by
``regimes.inputs_for``.
"""

from __future__ import annotations

from dataclasses import dataclass, field as _dc_field
from decimal import Decimal
from typing import Any

from harness.archetypes import (
    ARCHETYPES,
    ArchetypeName,
    VelocityRegime,
    ACTIVITY_MAX,
    LOOTBOX_BREAKEVEN,
    LOOTBOX_EV_CAP,
)
from harness.constants import Citation, get as _get
from harness.regimes import RegimeInputs, inputs_for


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DerivedField:
    name: str
    value: Decimal | int | float | str
    unit: str  # "wei" | "eth" | "bps" | "count" | "ratio" | "days"
    formula: str
    citations: tuple[Citation, ...]
    regime: VelocityRegime
    notes: str = ""


@dataclass(frozen=True)
class DerivedValues:
    level: int
    day: int
    archetype: ArchetypeName
    velocity_regime: VelocityRegime
    fields: dict[str, DerivedField]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _from_constant(
    name: str,
    regime: VelocityRegime,
    *,
    formula: str,
    extra_notes: str = "",
    field_name: str | None = None,
) -> DerivedField:
    """Build a DerivedField whose value and citation come from a registered Constant."""
    c = _get(name)
    notes = c.notes
    if extra_notes:
        notes = f"{notes}\n[regime {regime}] {extra_notes}" if notes else f"[regime {regime}] {extra_notes}"
    return DerivedField(
        name=field_name or name,
        value=c.value,
        unit=c.unit,
        formula=formula,
        citations=(c.citation,),
        regime=regime,
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Domain builders
# ---------------------------------------------------------------------------


def _pools_fields(
    level: int, day: int, regime_in: RegimeInputs
) -> dict[str, DerivedField]:
    regime = regime_in.velocity_regime
    drip_extra = ""
    drawdown_extra = ""
    if regime == "runout":
        drip_extra = (
            "runout regime: no new inflow; drip operates on the existing futurepool "
            "balance only. Flow direction and BPS are unchanged."
        )
        drawdown_extra = (
            "runout regime: level transitions have stopped, so drawdown does not "
            "fire (no new inflow driving transitions)."
        )

    fields = {
        "ticket_split_to_future_bps": _from_constant(
            "PURCHASE_TO_FUTURE_BPS",
            regime,
            formula="ticket_eth * PURCHASE_TO_FUTURE_BPS / 10_000 -> futurePool",
            field_name="ticket_split_to_future_bps",
        ),
        "lootbox_split_to_future_bps": _from_constant(
            "LOOTBOX_TO_FUTURE_BPS",
            regime,
            formula="lootbox_eth * LOOTBOX_TO_FUTURE_BPS / 10_000 -> futurePool (post-presale)",
            field_name="lootbox_split_to_future_bps",
        ),
        "future_drip_daily_bps": _from_constant(
            "FUTURE_DRIP_BPS",
            regime,
            formula="futurePool_t+1 -= futurePool_t * FUTURE_DRIP_BPS / 10_000 (daily drip into nextPool)",
            extra_notes=drip_extra,
            field_name="future_drip_daily_bps",
        ),
        "future_drawdown_on_transition_bps": _from_constant(
            "FUTURE_DRAWDOWN_BPS",
            regime,
            formula=(
                "on non-x00 level advance: drawdown = futurePool * FUTURE_DRAWDOWN_BPS / 10_000 "
                "(15% future->next); x00 level advances use the x00 yield accumulator dump instead."
            ),
            extra_notes=drawdown_extra,
            field_name="future_drawdown_on_transition_bps",
        ),
        "steth_accumulator_share_bps": _from_constant(
            "STETH_ACCUMULATOR_BPS",
            regime,
            formula="stETH_yield * STETH_ACCUMULATOR_BPS / 10_000 -> yieldAccumulator (canonical 50%)",
            field_name="steth_accumulator_share_bps",
        ),
        "steth_a_share_bps": _from_constant(
            "STETH_A_BPS",
            regime,
            formula="stETH_yield * STETH_A_BPS / 10_000 -> game-side A (vault/sDGNRS) (canonical 25%)",
            field_name="steth_a_share_bps",
        ),
        "steth_b_share_bps": _from_constant(
            "STETH_B_BPS",
            regime,
            formula="stETH_yield * STETH_B_BPS / 10_000 -> game-side B (GNRUS charity) (canonical 25%)",
            field_name="steth_b_share_bps",
        ),
        "accumulator_per_level_bps": _from_constant(
            "ACCUMULATOR_PER_LEVEL_BPS",
            regime,
            formula="insuranceSkim = memNext * INSURANCE_SKIM_BPS / 10_000 at level advance",
            field_name="accumulator_per_level_bps",
        ),
        "yield_accumulator_x00_dump_bps": _from_constant(
            "YIELD_ACCUMULATOR_X00_DUMP_BPS",
            regime,
            formula="on lvl % 100 == 0: half = yieldAccumulator * YIELD_ACCUMULATOR_X00_DUMP_BPS / 10_000 -> futurePool",
            field_name="yield_accumulator_x00_dump_bps",
        ),
    }
    return fields


def _player_fields(archetype: ArchetypeName, regime: VelocityRegime) -> dict[str, DerivedField]:
    profile = ARCHETYPES[archetype]

    activity_floor_citations: tuple[Citation, ...] = (
        _get("STREAK_FLOOR_BPS").citation,
        _get("MINT_FLOOR_BPS").citation,
        _get("ACTIVITY_MAX_BPS").citation,
    )
    activity_floor = DerivedField(
        name="activity_score_floor",
        value=Decimal(str(profile.activity_floor)),
        unit="ratio",
        formula=(
            "archetype-dependent floor (decimal = bps/10000). "
            "Degen=0.00, Grinder=0.85 (lazy pass: 50% streak + 25% mint + 10% bonus), "
            "Whale=1.15 (100-level bundle: 50% + 25% + 40%), "
            "Hybrid>=0.85 (breakeven cluster; empirical 0.85-1.50)."
        ),
        citations=activity_floor_citations,
        regime=regime,
        notes=profile.notes,
    )

    lootbox_breakeven = DerivedField(
        name="lootbox_breakeven_score",
        value=Decimal(str(LOOTBOX_BREAKEVEN)),
        unit="ratio",
        formula="activity score a at which lootbox EV crosses zero; see GT paper lootbox derivation",
        citations=(
            Citation(path="theory/index.html", line=None, label="gt_paper", anchor="lootbox-ev"),
        ),
        regime=regime,
        notes="a = 0.60 per CLAUDE.md memory; contract implements per-activity payout curves.",
    )

    lootbox_cap = DerivedField(
        name="lootbox_ev_cap_score",
        value=Decimal(str(LOOTBOX_EV_CAP)),
        unit="ratio",
        formula="activity score a at which lootbox EV saturates (Degenerette ROI continues above)",
        citations=(
            Citation(path="theory/index.html", line=None, label="gt_paper", anchor="lootbox-ev"),
        ),
        regime=regime,
        notes="a = 2.55 per CLAUDE.md memory.",
    )

    activity_max = DerivedField(
        name="activity_score_max",
        value=Decimal(str(ACTIVITY_MAX)),
        unit="ratio",
        formula="ACTIVITY_SCORE_MAX_BPS / 10_000 = 3.05 (full quest + affiliate + deity)",
        citations=(_get("ACTIVITY_MAX_BPS").citation,),
        regime=regime,
        notes="Upper bound on activity multiplier; decimal = bps / 10000.",
    )

    coinflip_mean = _from_constant(
        "COINFLIP_PAYOUT_MEAN",
        regime,
        formula="E[stake_multiplier | win] per GT paper coinflip derivation (pre-activity adjustment)",
        field_name="coinflip_payout_mean",
    )

    burnie_ratchet = _from_constant(
        "PRICE_COIN_UNIT_ETHER",
        regime,
        formula="1000 BURNIE -> 1 ticket at any level (fixed ratchet, ETH ticket price escalates)",
        field_name="burnie_ratchet_tokens_per_ticket",
    )

    return {
        "activity_score_floor": activity_floor,
        "lootbox_breakeven_score": lootbox_breakeven,
        "lootbox_ev_cap_score": lootbox_cap,
        "activity_score_max": activity_max,
        "coinflip_payout_mean": coinflip_mean,
        "burnie_ratchet_tokens_per_ticket": burnie_ratchet,
    }


def _jackpot_fields(
    level: int, day: int, archetype: ArchetypeName, regime_in: RegimeInputs
) -> dict[str, DerivedField]:
    """Phase 19 extends this with full payout formulas. Wave 2 exposes the
    BURNIE ratchet and jackpot-relevant BPS constants already available."""
    regime = regime_in.velocity_regime
    # Jackpot domain currently sources from shared constants; Phase 19 adds
    # per-day, per-trait payout fields.
    return {
        "jackpot_burnie_ratchet_tokens_per_ticket": _from_constant(
            "PRICE_COIN_UNIT_ETHER",
            regime,
            formula="1000 BURNIE buys one jackpot-eligible ticket at any level",
            field_name="jackpot_burnie_ratchet_tokens_per_ticket",
        ),
    }


def _terminal_fields(
    level: int, day: int, regime_in: RegimeInputs
) -> dict[str, DerivedField]:
    regime = regime_in.velocity_regime
    death_clock = DerivedField(
        name="death_clock_days_remaining",
        value=int(regime_in.death_clock_days_remaining),
        unit="days",
        formula=(
            "level 0: DEPLOY_IDLE_TIMEOUT_DAYS = 365; "
            "level 1+: TERMINAL_DEC_DEATH_CLOCK_DAYS = 120 (hardcoded; no sub-120 in audit contracts)"
        ),
        citations=(
            _get("DEATH_CLOCK_LEVEL_0_DAYS").citation,
            _get("DEATH_CLOCK_LEVEL_1_PLUS_DAYS").citation,
        ),
        regime=regime,
        notes=regime_in.notes,
    )

    # Terminal per-ticket ETH: symbolic formula. Numeric ~0.146 reference in notes.
    # Phase 22 will bind the live prize-pool and terminal-ticket-count values.
    terminal_per_ticket = DerivedField(
        name="terminal_per_ticket_eth",
        value="symbolic: (current_prize_pool_at_terminal * WINNER_SHARE_BPS / 10_000) / terminal_ticket_count",
        unit="eth",
        formula=(
            "terminal_payout_per_ticket = (currentPrizePool_at_terminal * WINNER_SHARE_BPS / 10_000) "
            "/ terminal_ticket_count; concrete value ~0.146 ETH per CLAUDE.md MEMORY.md level-50 reference "
            "(1.66 x 0.146 = 0.242 day-1 holder value)."
        ),
        citations=(
            Citation(
                path="degenerus-audit/contracts/modules/DegenerusGameDecimatorModule.sol",
                line=617,
                label="contract",
                anchor="TERMINAL_DEC_DEATH_CLOCK_DAYS",
            ),
            Citation(
                path="theory/index.html",
                line=None,
                label="gt_paper",
                anchor="terminal-math",
            ),
        ),
        regime=regime,
        notes=(
            "Numeric reference 0.146 ETH per ticket (level-50) from GT paper; "
            "live binding deferred to Phase 22. "
            + ("runout regime: death clock drains, terminal draw approaches." if regime == "runout" else "fast regime: terminal math applies only at level 101+ under runout; value here is reference.")
        ),
    )

    # Deposit insurance: ~125 ETH from segregated accumulator (50% retained as terminal insurance).
    deposit_insurance = DerivedField(
        name="deposit_insurance_terminal_eth",
        value="symbolic: yieldAccumulator_retained_50pct_at_terminal",
        unit="eth",
        formula=(
            "segregated accumulator retains 50% of its balance as terminal insurance; "
            "50% distributes at x00 milestones via YIELD_ACCUMULATOR_X00_DUMP_BPS. "
            "Numeric reference ~125 ETH per CLAUDE.md MEMORY.md."
        ),
        citations=(
            _get("YIELD_ACCUMULATOR_X00_DUMP_BPS").citation,
            _get("ACCUMULATOR_PER_LEVEL_BPS").citation,
            Citation(path="theory/index.html", line=None, label="gt_paper", anchor="deposit-insurance"),
        ),
        regime=regime,
        notes="Reference value ~125 ETH; live binding deferred to Phase 22.",
    )

    return {
        "death_clock_days_remaining": death_clock,
        "terminal_per_ticket_eth": terminal_per_ticket,
        "deposit_insurance_terminal_eth": deposit_insurance,
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def expected_values(
    level: int,
    day: int,
    archetype: ArchetypeName,
    velocity_regime: VelocityRegime,
) -> DerivedValues:
    """Return the DerivedValues bundle for ``(level, day, archetype, velocity_regime)``.

    Validates archetype (against ``ARCHETYPES``) and regime (via
    ``regimes.inputs_for`` which rejects anything outside
    ``{"fast","runout"}`` with ``ValueError``).
    """
    if archetype not in ARCHETYPES:
        raise ValueError(
            f"unknown archetype {archetype!r}; allowed: {sorted(ARCHETYPES)!r}"
        )
    regime_in = inputs_for(level=level, day=day, regime=velocity_regime)

    fields: dict[str, DerivedField] = {}
    fields.update(_jackpot_fields(level, day, archetype, regime_in))
    fields.update(_pools_fields(level, day, regime_in))
    fields.update(_player_fields(archetype, regime_in.velocity_regime))
    fields.update(_terminal_fields(level, day, regime_in))

    return DerivedValues(
        level=level,
        day=day,
        archetype=archetype,
        velocity_regime=velocity_regime,
        fields=fields,
    )
