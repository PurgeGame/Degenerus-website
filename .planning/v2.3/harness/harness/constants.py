"""Typed constants with contract-source citations.

All citations MUST point at one of:
  - ``degenerus-audit/contracts/`` (label="contract"): the ONLY canonical
    contract source. NEVER cite ``testing/contracts/`` or
    ``degenerus-contracts/``.
  - ``theory/index.html`` (label="gt_paper"): secondary comparison source.
  - ``degenerus-audit/audit/`` (label="audit_doc"): orientation only.

Where a value is computed inline (not a named Solidity constant), ``line``
points at the computation site and ``notes`` identifies the expression.
Where a value is known but the exact line was not resolved at derivation
time, ``line=None`` and ``notes`` describes the grep anchor for 18-02 to
backfill.
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


# ---------------------------------------------------------------------------
# Citation helpers
# ---------------------------------------------------------------------------

def _c(path: str, line: int | None, label: CitationLabel = "contract", anchor: str | None = None) -> Citation:
    return Citation(path=path, line=line, label=label, anchor=anchor)


_GAME = "degenerus-audit/contracts/DegenerusGame.sol"
_MINT = "degenerus-audit/contracts/modules/DegenerusGameMintModule.sol"
_ADVANCE = "degenerus-audit/contracts/modules/DegenerusGameAdvanceModule.sol"
_JACKPOT = "degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol"
_DECIMATOR = "degenerus-audit/contracts/modules/DegenerusGameDecimatorModule.sol"
_DEGENERETTE = "degenerus-audit/contracts/modules/DegenerusGameDegeneretteModule.sol"
_LOOTBOX = "degenerus-audit/contracts/modules/DegenerusGameLootboxModule.sol"
_STORAGE = "degenerus-audit/contracts/storage/DegenerusGameStorage.sol"
_QUESTS = "degenerus-audit/contracts/DegenerusQuests.sol"
_COINFLIP = "degenerus-audit/contracts/BurnieCoinflip.sol"
_THEORY = "theory/index.html"


# ---------------------------------------------------------------------------
# Constant registry
# ---------------------------------------------------------------------------

_entries: list[Constant] = [
    # --- Purchase / ticket split (90/10 next/future) ---
    Constant(
        name="PURCHASE_TO_FUTURE_BPS",
        value=1000,
        unit="bps",
        citation=_c(_GAME, 160),
        notes="Ticket purchase: 10% to futurePool, 90% to nextPool (reciprocal of lootbox split).",
    ),
    Constant(
        name="PURCHASE_TO_NEXT_BPS",
        value=9000,
        unit="bps",
        citation=_c(_GAME, 160),
        notes="Reciprocal of PURCHASE_TO_FUTURE_BPS.",
    ),
    # --- Lootbox split (10/90 next/future — opposite of tickets) ---
    Constant(
        name="LOOTBOX_TO_FUTURE_BPS",
        value=9000,
        unit="bps",
        citation=_c(_MINT, 113),
        notes="LOOTBOX_SPLIT_FUTURE_BPS; post-presale 90% to futurePool.",
    ),
    Constant(
        name="LOOTBOX_TO_NEXT_BPS",
        value=1000,
        unit="bps",
        citation=_c(_MINT, 114),
        notes="LOOTBOX_SPLIT_NEXT_BPS.",
    ),
    Constant(
        name="LOOTBOX_PRESALE_TO_FUTURE_BPS",
        value=5000,
        unit="bps",
        citation=_c(_MINT, 117),
        notes="LOOTBOX_PRESALE_SPLIT_FUTURE_BPS during presale phase.",
    ),
    Constant(
        name="LOOTBOX_PRESALE_TO_NEXT_BPS",
        value=3000,
        unit="bps",
        citation=_c(_MINT, 118),
        notes="LOOTBOX_PRESALE_SPLIT_NEXT_BPS during presale phase.",
    ),
    Constant(
        name="LOOTBOX_PRESALE_TO_VAULT_BPS",
        value=2000,
        unit="bps",
        citation=_c(_MINT, 119),
        notes="LOOTBOX_PRESALE_SPLIT_VAULT_BPS during presale phase.",
    ),
    # --- Future pool drip & drawdown (inline values, not named constants) ---
    Constant(
        name="FUTURE_DRIP_BPS",
        value=100,
        unit="bps",
        citation=_c(_JACKPOT, 523),
        notes="Inline literal `uint256 poolBps = 100; // 1% daily drip from futurePool`. Not a named Solidity constant.",
    ),
    Constant(
        name="FUTURE_DRAWDOWN_BPS",
        value=1500,
        unit="bps",
        citation=_c(_ADVANCE, 805),
        notes="Inline `(memFuture * 15) / 100` on non-x00 level advance; 15% future->next drawdown. Not a named constant.",
    ),
    # --- stETH yield split (50/25/25 -> accumulator/GameA/GameB) ---
    # Inline distribution; no single named constant exposes each leg.
    Constant(
        name="STETH_ACCUMULATOR_BPS",
        value=5000,
        unit="bps",
        citation=_c(_JACKPOT, 769),
        notes=(
            "Canonical 50% of stETH yield routed to yield accumulator (per CLAUDE.md: split is 50/25/25). "
            "Implementation: `distributeYieldSurplus` at DegenerusGameJackpotModule.sol L737-L770 uses "
            "`quarterShare = (yieldPool * 2300) / 10_000` and credits vault+sDGNRS+GNRUS (3x23%=69%) then "
            "`yieldAccumulator += quarterShare` (23%) totaling 92%, leaving ~8% contract buffer. "
            "The 8% buffer is an implementation detail; canonical economic split remains 50/25/25."
        ),
    ),
    Constant(
        name="STETH_A_BPS",
        value=2500,
        unit="bps",
        citation=_c(_JACKPOT, 749),
        notes=(
            "Canonical 25% of stETH yield to Game-side A (vault / sDGNRS claimable). "
            "Implemented as `quarterShare = (yieldPool * 2300) / 10_000` (23% with ~8% buffer)."
        ),
    ),
    Constant(
        name="STETH_B_BPS",
        value=2500,
        unit="bps",
        citation=_c(_JACKPOT, 749),
        notes=(
            "Canonical 25% of stETH yield to Game-side B (GNRUS charity). "
            "Same `quarterShare = (yieldPool * 2300) / 10_000` expression; 23% with ~8% buffer."
        ),
    ),
    # --- Accumulator per-level skim ---
    Constant(
        name="ACCUMULATOR_PER_LEVEL_BPS",
        value=100,
        unit="bps",
        citation=_c(_ADVANCE, 129),
        notes=(
            "INSURANCE_SKIM_BPS = 100; 1% of nextPool routed to yieldAccumulator at level advance "
            "(applied via `insuranceSkim = (memNext * INSURANCE_SKIM_BPS) / 10_000` at L716)."
        ),
    ),
    # --- x00 yield accumulator dump ---
    Constant(
        name="YIELD_ACCUMULATOR_X00_DUMP_BPS",
        value=5000,
        unit="bps",
        citation=_c(_ADVANCE, 722),
        notes="x00 milestone: 50% of yield accumulator dumps into futurePool (comment: '50% into futurePool (memory)').",
    ),
    # --- Activity score bounds ---
    Constant(
        name="ACTIVITY_MAX_BPS",
        value=30500,
        unit="bps",
        citation=_c(_DEGENERETTE, 170),
        notes="ACTIVITY_SCORE_MAX_BPS; decimal cap = 3.05.",
    ),
    Constant(
        name="STREAK_FLOOR_BPS",
        value=5000,
        unit="bps",
        citation=_c(_STORAGE, 153),
        notes="PASS_STREAK_FLOOR_POINTS=50 on 0-100 points scale = 5000 bps (50%).",
    ),
    Constant(
        name="MINT_FLOOR_BPS",
        value=2500,
        unit="bps",
        citation=_c(_STORAGE, 156),
        notes="PASS_MINT_COUNT_FLOOR_POINTS=25 on 0-100 points scale = 2500 bps (25%).",
    ),
    Constant(
        name="DEITY_PASS_ACTIVITY_BONUS_BPS",
        value=8000,
        unit="bps",
        citation=_c(_STORAGE, 150),
        notes="Fixed 80% activity bonus applied when deity pass is held.",
    ),
    # --- Deity pass cap ---
    Constant(
        name="DEITY_PASS_MAX_TOTAL",
        value=32,
        unit="count",
        citation=_c(_LOOTBOX, 197),
        notes="DEITY_PASS_MAX_TOTAL hard cap on deity pass minting (also referenced at DegenerusGame.sol:855).",
    ),
    # --- Death clock ---
    Constant(
        name="DEATH_CLOCK_LEVEL_0_DAYS",
        value=365,
        unit="days",
        citation=_c(_ADVANCE, 108),
        notes=(
            "DEPLOY_IDLE_TIMEOUT_DAYS = 365 (Level-0 only; level 1+ uses hardcoded 120 days per inline comment). "
            "Applied at DegenerusGameAdvanceModule.sol:503 `currentDay - psd > DEPLOY_IDLE_TIMEOUT_DAYS`. "
            "Also mirrored at DegenerusGame.sol:148 and storage/DegenerusGameStorage.sol:198."
        ),
    ),
    Constant(
        name="DEATH_CLOCK_LEVEL_1_PLUS_DAYS",
        value=120,
        unit="days",
        citation=_c(_DECIMATOR, 617),
        notes="TERMINAL_DEC_DEATH_CLOCK_DAYS=120; applies at level 1+ and as the terminal decimator clock per v1.1 canonical spec.",
    ),
    # --- BURNIE ratchet ---
    Constant(
        name="PRICE_COIN_UNIT_ETHER",
        value=1000,
        unit="count",
        citation=_c(_QUESTS, 134),
        notes="PRICE_COIN_UNIT = 1000 ether (BURNIE wei-scale). 1000 BURNIE buys one ticket at any level. Also defined at DegenerusGameStorage.sol:161.",
    ),
    # --- Affiliate DGNRS deity bonus ---
    Constant(
        name="AFFILIATE_DGNRS_DEITY_BONUS_BPS",
        value=2000,
        unit="bps",
        citation=_c(_GAME, 168),
        notes="AFFILIATE_DGNRS_DEITY_BONUS_BPS; 20% activity-score-scaled bonus for deity-pass affiliates.",
    ),
    Constant(
        name="AFFILIATE_DGNRS_DEITY_CAP_WEI",
        value=str(5 * 10**18),
        unit="wei",
        citation=_c(_GAME, 171),
        notes="AFFILIATE_DGNRS_DEITY_BONUS_CAP_ETH = 5 ether. Stored as str to avoid unintended float coercion.",
    ),
    # --- Coinflip mean payout (GT paper derivation; no named contract constant) ---
    Constant(
        name="COINFLIP_PAYOUT_MEAN",
        value=1.9685,
        unit="ratio",
        citation=_c(_THEORY, None, label="gt_paper", anchor="coinflip"),
        notes="Mean stake multiplier on coinflip win (pre-activity adjustment). GT paper derivation; BurnieCoinflip.sol implements the per-tier payouts that yield this mean.",
    ),
]


CONSTANTS: dict[str, Constant] = {c.name: c for c in _entries}


def get(name: str) -> Constant:
    """Return the Constant registered under ``name``; raise KeyError otherwise."""
    try:
        return CONSTANTS[name]
    except KeyError as exc:
        raise KeyError(f"unknown constant: {name!r}") from exc


def all_citations() -> list[Citation]:
    """Return every citation attached to a registered Constant, in insertion order."""
    return [c.citation for c in CONSTANTS.values()]
