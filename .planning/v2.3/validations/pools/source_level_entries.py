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
POOLS_05_COVERAGE_GAP_ID = "POOLS-05-coverage-gap-yield-unindexed"
POOLS_06_COVERAGE_GAP_ID = "POOLS-06-coverage-gap-accumulator-unindexed"
POOLS_07_SOURCE_DRIFT_ID = "POOLS-07-source-doc-turbo-drift"

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


def ensure_pools_05_coverage_gap_logged(
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> bool:
    """Append the POOLS-05 yield-unindexed coverage-gap entry iff missing."""
    if _already_present(yaml_path, POOLS_05_COVERAGE_GAP_ID):
        return False

    entry = Discrepancy(
        id=POOLS_05_COVERAGE_GAP_ID,
        domain="POOLS",
        endpoint=(
            "(no endpoint — /game/yield 404, /history/yield 404; "
            "yieldAccumulator absent from database/src/db/schema/ and "
            "database/src/api/routes/; /tokens/analytics.vault.stEthReserve "
            "is '0' in sim — sim runs without stETH entirely)"
        ),
        expected_value=(
            "stETH yield 50/25/25 split observable per-accrual via indexed "
            "yieldAccumulator events"
        ),
        observed_value=(
            "yieldAccumulator not indexed anywhere; stEthReserve=0 in sim "
            "confirms no stETH in play; direct validation impossible"
        ),
        derivation=Derivation(
            formula=(
                "distributeYieldSurplus: quarterShare = yieldPool * 2300 / 10000; "
                "3 recipients x 23% = 69% distributed, 23% to accumulator, "
                "~8% buffer converges to 0 over time (canonical 50/25/25 per "
                "MEMORY.md)"
            ),
            sources=[
                Citation(
                    path=_JACKPOT_MODULE,
                    line=737,
                    label="contract",
                    anchor="distributeYieldSurplus",
                ),
            ],
        ),
        magnitude=(
            "permanent coverage gap for POOLS-05 stETH yield split validation; "
            "two-stage blocker (indexer + sim config)"
        ),
        severity="Info",
        suspected_source="api",
        hypothesis=[
            Hypothesis(
                text=(
                    "stETH yield distribution is unobservable because "
                    "(a) indexer does not surface yieldAccumulator state, "
                    "and (b) the sim itself runs with no stETH — both "
                    "conditions must be fixed to validate POOLS-05"
                ),
                falsifiable_by=(
                    "add `yield_accumulator_snapshots(day, balance)` table + "
                    "`/history/yield/day/:day` route AND run sim with non-zero "
                    "stETH seed so /tokens/analytics.vault.stEthReserve is "
                    "non-zero; then derive 50/25/25 split from per-accrual "
                    "deltas against distributeYieldSurplus formula"
                ),
            )
        ],
        sample_context=_zero_ctx(),
        notes=(
            "Two-stage blocker: schema AND sim configuration. Lowest priority "
            "among coverage gaps because sim-side fix is orthogonal to "
            "indexer-side fix."
        ),
    )
    append_discrepancy(yaml_path, entry)
    return True


def ensure_pools_06_coverage_gap_logged(
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> bool:
    """Append the POOLS-06 segregated-accumulator coverage-gap entry iff missing."""
    if _already_present(yaml_path, POOLS_06_COVERAGE_GAP_ID):
        return False

    entry = Discrepancy(
        id=POOLS_06_COVERAGE_GAP_ID,
        domain="POOLS",
        endpoint="(no endpoint — segregated accumulator not surfaced anywhere)",
        expected_value=(
            "segregated accumulator state observable: 1% skim per level "
            "(INSURANCE_SKIM_BPS=100), 50% dump at x00 "
            "(YIELD_ACCUMULATOR_X00_DUMP_BPS=5000), 50% retained as terminal "
            "insurance"
        ),
        observed_value=(
            "no /game/accumulator endpoint (404); no accumulator field on "
            "/tokens/analytics; no accumulator schema table"
        ),
        derivation=Derivation(
            formula=(
                "accumulator receives INSURANCE_SKIM_BPS=100 (1%) of each "
                "completed level's prize pool; 50% dumps into futurePool at "
                "x00 via YIELD_ACCUMULATOR_X00_DUMP_BPS=5000; remainder "
                "retained as terminal insurance"
            ),
            sources=[
                Citation(path=_ADVANCE_MODULE, line=129, label="contract"),
                Citation(path=_ADVANCE_MODULE, line=722, label="contract"),
                Citation(
                    path=_ADVANCE_MODULE,
                    line=716,
                    label="contract",
                    anchor="skim-apply-site",
                ),
            ],
        ),
        magnitude=(
            "permanent coverage gap for POOLS-06 segregated accumulator "
            "validation"
        ),
        severity="Info",
        suspected_source="api",
        hypothesis=[
            Hypothesis(
                text=(
                    "segregated accumulator is contract-internal state never "
                    "surfaced by the indexer; no events with accumulator "
                    "deltas are exposed"
                ),
                falsifiable_by=(
                    "add `accumulator_snapshots(day, level, balance, "
                    "skim_delta, dump_delta)` table + `/history/accumulator` "
                    "and `/history/accumulator/level/:level` routes; emit "
                    "InsuranceSkimApplied(level, amount) and "
                    "AccumulatorX00Dump(level, amount) events exposed via "
                    "/replay/events/:level"
                ),
            )
        ],
        sample_context=_zero_ctx(),
        notes=(
            "Separate from POOLS-05 because accumulator mechanics are distinct "
            "from stETH yield flow (different constants, different trigger "
            "sites). Both unblock independently."
        ),
    )
    append_discrepancy(yaml_path, entry)
    return True


def ensure_pools_07_source_drift_logged(
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> bool:
    """Append the POOLS-07 REQUIREMENTS.md turbo-drift source-level entry iff missing."""
    if _already_present(yaml_path, POOLS_07_SOURCE_DRIFT_ID):
        return False

    price_lib = "degenerus-audit/contracts/libraries/PriceLookupLib.sol"

    entry = Discrepancy(
        id=POOLS_07_SOURCE_DRIFT_ID,
        domain="POOLS",
        endpoint="(source-level — REQUIREMENTS.md:35)",
        expected_value=(
            "REQUIREMENTS.md describes mechanisms present in "
            "degenerus-audit/contracts/"
        ),
        observed_value=(
            "REQUIREMENTS.md:35 phrasing 'dynamic pricing (100K ticket target) "
            "and fractional credit accumulation in turbo-mode levels' "
            "describes PLAN-TURBO-MODE.md + testing/contracts/ features; "
            "audit canonical is static PriceLookupLib.priceForLevel table at "
            "libraries/PriceLookupLib.sol:7-47 with no dynamic adjustment or "
            "fractional credits"
        ),
        derivation=Derivation(
            formula=(
                "audit canonical price curve: static per-level table "
                "(0.01/0.02/0.04/0.08/0.12/0.16/0.24 ETH by decade within "
                "100-level cycle); no 100K-target or fractional-credit logic "
                "in audit contracts"
            ),
            sources=[
                Citation(path=price_lib, line=7, label="contract"),
                Citation(path=price_lib, line=47, label="contract"),
            ],
        ),
        magnitude=(
            "document drift: requirement language references turbo-spec "
            "mechanics absent from audit contracts"
        ),
        severity="Minor",
        suspected_source="api",
        hypothesis=[
            Hypothesis(
                text=(
                    "REQUIREMENTS.md:35 was authored from PLAN-TURBO-MODE.md / "
                    "testing/contracts/ before audit contracts were locked as "
                    "canonical"
                ),
                falsifiable_by=(
                    "rewrite REQUIREMENTS.md:35 POOLS-07 as 'validate static "
                    "ticket price at current level matches "
                    "PriceLookupLib.priceForLevel' and delete '100K ticket "
                    "target' + 'fractional credit accumulation' language"
                ),
            )
        ],
        sample_context=_zero_ctx(),
        notes=(
            "Report-only milestone. Pairs with POOLS-03-source-doc-turbo-drift "
            "from Plan 20-02."
        ),
    )
    append_discrepancy(yaml_path, entry)
    return True
