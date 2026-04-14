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
POOLS_03_COVERAGE_GAP_ID = "POOLS-03-coverage-gap-no-day-over-day-pool-state"
POOLS_03_SOURCE_DRIFT_ID = "POOLS-03-source-doc-turbo-drift"
POOLS_04_COVERAGE_GAP_ID = "POOLS-04-coverage-gap-no-transition-snapshots"

_GAME_CONTRACT = "degenerus-audit/contracts/DegenerusGame.sol"
_MINT_MODULE = "degenerus-audit/contracts/modules/DegenerusGameMintModule.sol"
_ADVANCE_MODULE = "degenerus-audit/contracts/modules/DegenerusGameAdvanceModule.sol"
_JACKPOT_MODULE = "degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol"


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


def ensure_pools_03_coverage_gap_logged(
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> bool:
    """Append the POOLS-03 no-day-over-day-pool-state coverage-gap entry iff missing."""
    if _already_present(yaml_path, POOLS_03_COVERAGE_GAP_ID):
        return False

    entry = Discrepancy(
        id=POOLS_03_COVERAGE_GAP_ID,
        domain="POOLS",
        endpoint=(
            "(no endpoint — prize_pools singleton; "
            "/replay/distributions/:level lacks per-day pool context)"
        ),
        expected_value=(
            "per-day futurePool[day] snapshots enabling day-over-day drip "
            "reconciliation"
        ),
        observed_value=(
            "only aggregate per-level distributions available; cannot "
            "reconstruct futurePool[day] * 0.01 daily slice chain"
        ),
        derivation=Derivation(
            formula=(
                "daily drip = futurePool[day] * 100 / 10000, split 75/25 "
                "lootbox/ETH per JackpotModule.sol:188,523,530"
            ),
            sources=[
                Citation(path=_JACKPOT_MODULE, line=523, label="contract"),
            ],
        ),
        magnitude=(
            "permanent coverage gap for POOLS-03 day-over-day drip validation"
        ),
        severity="Info",
        suspected_source="api",
        hypothesis=[
            Hypothesis(
                text=(
                    "daily drip validation requires futurePool[day] snapshots "
                    "and skim-pipeline event exposure"
                ),
                falsifiable_by=(
                    "add `prize_pool_snapshots(day, level, futurePool, nextPool, "
                    "currentPool, claimable)` table with `/history/pools/day/:day` "
                    "route AND expose `FutureTakeApplied(day, level, takeBps, "
                    "amount)` events via `/replay/events/:level?types=FutureTakeApplied,"
                    "DripApplied`"
                ),
            )
        ],
        sample_context=_zero_ctx(),
        notes=(
            "POOLS-03 validation is blocked entirely this milestone. The U-curve "
            "_applyTimeBasedFutureTake is the audit-canonical mechanism — not "
            "flat 30-50% graduated extraction."
        ),
    )
    append_discrepancy(yaml_path, entry)
    return True


def ensure_pools_03_source_drift_logged(
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> bool:
    """Append the POOLS-03 REQUIREMENTS.md turbo-drift source-level entry iff missing."""
    if _already_present(yaml_path, POOLS_03_SOURCE_DRIFT_ID):
        return False

    entry = Discrepancy(
        id=POOLS_03_SOURCE_DRIFT_ID,
        domain="POOLS",
        endpoint="(source-level — REQUIREMENTS.md:31)",
        expected_value=(
            "REQUIREMENTS.md describes mechanisms present in "
            "degenerus-audit/contracts/"
        ),
        observed_value=(
            "REQUIREMENTS.md:31 phrasing 'graduated extraction (30-50%) in turbo "
            "mode' describes PLAN-TURBO-MODE.md spec; audit canonical is "
            "`_applyTimeBasedFutureTake` U-curve (13-30% base + VRF variance + "
            "x9 bonus + overshoot surcharge + triangular variance, capped 80%) "
            "at AdvanceModule.sol:1014-1123"
        ),
        derivation=Derivation(
            formula=(
                "audit canonical = 5-stage skim pipeline, not flat bracket"
            ),
            sources=[
                Citation(
                    path=_ADVANCE_MODULE,
                    line=1014,
                    label="contract",
                    anchor="_applyTimeBasedFutureTake",
                ),
            ],
        ),
        magnitude=(
            "document drift: requirement language references turbo-spec "
            "mechanic absent from audit contracts"
        ),
        severity="Minor",
        # Mirrors Phase 19's JACKPOT-03-source-doc-bound-mismatch pattern:
        # "api" is the closest permitted literal for doc-vs-contract drift
        # originating in docs other than the GT paper.
        suspected_source="api",
        hypothesis=[
            Hypothesis(
                text=(
                    "REQUIREMENTS.md was authored from PLAN-TURBO-MODE.md before "
                    "audit contracts were locked as canonical source"
                ),
                falsifiable_by=(
                    "update REQUIREMENTS.md:31 POOLS-03 phrasing to reference "
                    "`_applyTimeBasedFutureTake` U-curve and remove the "
                    "'30-50% graduated extraction' bracket"
                ),
            )
        ],
        sample_context=_zero_ctx(),
        notes=(
            "Report-only milestone. Source edits deferred. Mirrors Phase 19 "
            "pattern JACKPOT-03-source-doc-bound-mismatch."
        ),
    )
    append_discrepancy(yaml_path, entry)
    return True


def ensure_pools_04_coverage_gap_logged(
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> bool:
    """Append the POOLS-04 no-transition-snapshots coverage-gap entry iff missing."""
    if _already_present(yaml_path, POOLS_04_COVERAGE_GAP_ID):
        return False

    entry = Discrepancy(
        id=POOLS_04_COVERAGE_GAP_ID,
        domain="POOLS",
        endpoint=(
            "(no endpoint — prize_pools overwritten in-place at transition; "
            "no pre/post snapshot)"
        ),
        expected_value=(
            "nextpool(level N+1 start) = 0.15 * futurepool(level N pre-transition) "
            "exactly, 0 at x00"
        ),
        observed_value=(
            "prize_pools singleton is updated in-place as RewardJackpotsSettled "
            "fires; no snapshot at completedLevelId; /history/levels exposes "
            "stage transitions but no pool values"
        ),
        derivation=Derivation(
            formula=(
                "AdvanceModule.sol:805 `(memFuture * 15) / 100`; 0% at x00 "
                "(level % 100 == 0)"
            ),
            sources=[
                Citation(path=_ADVANCE_MODULE, line=805, label="contract"),
                Citation(path=_ADVANCE_MODULE, line=1125, label="contract"),
            ],
        ),
        magnitude=(
            "permanent coverage gap for POOLS-04 per-transition drawdown validation"
        ),
        severity="Info",
        suspected_source="api",
        hypothesis=[
            Hypothesis(
                text=(
                    "per-transition drawdown validation requires before-and-after "
                    "pool snapshots keyed by completedLevelId"
                ),
                falsifiable_by=(
                    "add `prize_pool_transitions(completed_level, future_pre, "
                    "future_post, next_post, drawdown_amount, block_number)` "
                    "table + `/history/pools/transitions` route"
                ),
            )
        ],
        sample_context=_zero_ctx(),
        notes=(
            "Transition enumeration works (see transitions.enumerate_transitions) "
            "— but without pre/post pool values, the 15% drawdown assertion "
            "cannot be checked. POOLS-04 produces only inferential per-transition "
            "Info entries this milestone."
        ),
    )
    append_discrepancy(yaml_path, entry)
    return True
