"""Idempotent source-level Discrepancy writers for Phase 20 POOLS validation.

Pattern mirrors ``validations.jackpot.source_level_entries``: load the
YAML via ``load_discrepancies`` -> filter by fixed id -> skip or append.

Entries owned here:

- ``POOLS-01-coverage-gap-no-per-day-pool-history`` — no historical
  per-day pool snapshots exist; solvency check is current-moment only.
- ``POOLS-02-coverage-gap-no-deposit-events`` — rawEvents table exists
  but no API route exposes it; per-deposit splits unreconstructable.
"""

from __future__ import annotations

from harness import (
    Citation,
    Derivation,
    Discrepancy,
    Hypothesis,
    SampleContext,
    append_discrepancy,
    load_discrepancies,
)
from harness.api import _utc_now_iso
from harness.yaml_io import _resolve_repo_root


DEFAULT_DISCREPANCIES_PATH = str(
    _resolve_repo_root() / ".planning" / "v2.3" / "discrepancies.yaml"
)

POOLS_01_COVERAGE_GAP_ID = "POOLS-01-coverage-gap-no-per-day-pool-history"
POOLS_02_COVERAGE_GAP_ID = "POOLS-02-coverage-gap-no-deposit-events"

_GAME_CONTRACT = "degenerus-audit/contracts/DegenerusGame.sol"
_MINT_MODULE = "degenerus-audit/contracts/modules/DegenerusGameMintModule.sol"


def _zero_ctx() -> SampleContext:
    return SampleContext(
        day=0,
        level=0,
        archetype=None,
        lag_blocks=0,
        lag_unreliable=False,
        sampled_at=_utc_now_iso(),
    )


def _already_present(path: str, entry_id: str) -> bool:
    for d in load_discrepancies(path):
        if d.id == entry_id:
            return True
    return False


def ensure_pools_01_coverage_gap_logged(
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> bool:
    """Append the POOLS-01 per-day-history coverage-gap entry iff missing."""
    if _already_present(yaml_path, POOLS_01_COVERAGE_GAP_ID):
        return False

    entry = Discrepancy(
        id=POOLS_01_COVERAGE_GAP_ID,
        domain="POOLS",
        endpoint="(no endpoint — prizePools is a singleton row; /game/state?day=N ignores day param)",
        expected_value=(
            "per-day snapshots of futurePrizePool/nextPrizePool/currentPrizePool/claimableWinnings"
        ),
        observed_value=(
            "singleton row in prize_pools table; /game/state returns current moment only; "
            "no historical pool endpoint exists"
        ),
        derivation=Derivation(
            formula=(
                "prize_pools.id.default(1) -> singleton; /game/state reads current row, "
                "silently ignores ?day="
            ),
            sources=[
                Citation(
                    path=_GAME_CONTRACT,
                    line=18,
                    label="contract",
                    anchor="solvency-invariant",
                )
            ],
        ),
        magnitude="permanent coverage gap for retrospective POOLS-01 validation",
        severity="Info",
        suspected_source="api",
        hypothesis=[
            Hypothesis(
                text=(
                    "indexer stores pool state as singleton overwrite; no history table, "
                    "no snapshot-by-day or snapshot-by-level"
                ),
                falsifiable_by=(
                    "add prize_pool_snapshots schema + /history/pools or "
                    "/history/pools/level/:level endpoint that returns "
                    "{day, level, futurePool, nextPool, currentPool, claimable, "
                    "ethBalance, stEthBalance} per snapshot"
                ),
            )
        ],
        sample_context=_zero_ctx(),
        notes=(
            "POOLS-01 solvency invariant is currently only checkable against the "
            "current moment; per-day retrospective validation is blocked by this gap."
        ),
    )
    append_discrepancy(yaml_path, entry)
    return True


def ensure_pools_02_coverage_gap_logged(
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> bool:
    """Append the POOLS-02 no-deposit-events coverage-gap entry iff missing."""
    if _already_present(yaml_path, POOLS_02_COVERAGE_GAP_ID):
        return False

    entry = Discrepancy(
        id=POOLS_02_COVERAGE_GAP_ID,
        domain="POOLS",
        endpoint="(no endpoint — rawEvents table exists but no API route reads it)",
        expected_value=(
            "per-deposit events {kind, player, ethIn, nextDelta, futureDelta, blockNumber} "
            "observable per level"
        ),
        observed_value=(
            "rawEvents table present in database/src/db/schema/raw-events.ts but no "
            "/events or /replay/events/:level route exposes it; per-purchase splits "
            "unreconstructable"
        ),
        derivation=Derivation(
            formula=(
                "ticket 90/10 split: DegenerusGame.sol:160,186,393 (PURCHASE_TO_FUTURE_BPS=1000); "
                "lootbox 10/90 split post-presale: MintModule.sol:113,114"
            ),
            sources=[
                Citation(path=_GAME_CONTRACT, line=160, label="contract"),
                Citation(path=_MINT_MODULE, line=113, label="contract"),
            ],
        ),
        magnitude="permanent coverage gap for POOLS-02 observed-side reconstruction",
        severity="Info",
        suspected_source="api",
        hypothesis=[
            Hypothesis(
                text=(
                    "indexer indexes raw events but exposes no route; per-deposit "
                    "pool deltas cannot be reconstructed at the API layer"
                ),
                falsifiable_by=(
                    "add /replay/events/:level?types=PoolDeposit,PoolWithdraw,"
                    "DripApplied,DrawdownApplied returning ordered event args "
                    "including futureDelta/nextDelta deltas"
                ),
            )
        ],
        sample_context=_zero_ctx(),
        notes=(
            "Per-level ticket-ETH inflow is derivable from /replay/tickets/:level + "
            "PriceLookupLib.priceForLevel, but the observed split cannot be compared "
            "without event data. POOLS-02 reduces to derivation-only Info entries "
            "this milestone."
        ),
    )
    append_discrepancy(yaml_path, entry)
    return True
