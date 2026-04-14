"""POOLS-04 validator: per-transition drawdown — inferential + coverage gap.

Expected: nextpool(level N+1 start) = 15% * futurepool(N pre-transition),
0 at x00 levels. AdvanceModule.sol:805 `(memFuture * 15) / 100`; x00 branch
at AdvanceModule.sol:1125.

No pre/post pool snapshots are exposed via the live API, so per-transition
drawdown cannot be directly validated. This milestone:

1. Enumerates transitions from /history/levels (via transitions.enumerate_transitions).
2. Emits one Info inferential entry per transition, labeling expected_pct
   (15% for standard, 0% for x00 -> x00+1).
3. Logs the idempotent coverage-gap entry pointing at the unblock hypothesis.
4. If no transitions enumerated, emits a single "no transitions" Info entry.
"""

from __future__ import annotations

from typing import Any

from harness import (
    Citation,
    Derivation,
    Discrepancy,
    HealthSnapshot,
    Hypothesis,
    SampleContext,
)

from validations.pools.source_level_entries import (
    DEFAULT_DISCREPANCIES_PATH,
    POOLS_04_COVERAGE_GAP_ID,
    ensure_pools_04_coverage_gap_logged,
)
from validations.pools.transitions import enumerate_transitions


_ADVANCE_MODULE = "degenerus-audit/contracts/modules/DegenerusGameAdvanceModule.sol"


def _ctx(level: int, lag_snapshot: HealthSnapshot) -> SampleContext:
    return SampleContext(
        day=0,
        level=level,
        archetype=None,
        lag_blocks=lag_snapshot.lag_blocks,
        lag_unreliable=lag_snapshot.lag_unreliable,
        sampled_at=lag_snapshot.sampled_at,
    )


def validate_pools_04(
    client: Any,
    *,
    lag_snapshot: HealthSnapshot,
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> list[Discrepancy]:
    ensure_pools_04_coverage_gap_logged(yaml_path)

    try:
        transitions = enumerate_transitions(client)
    except Exception as exc:
        # Re-raise with scrubbed context (transitions.paginate already scrubs)
        raise RuntimeError(f"validate_pools_04: transition enumeration failed: {exc!s}") from None

    results: list[Discrepancy] = []

    if not transitions:
        results.append(
            Discrepancy(
                id="POOLS-04-inferential-no-transitions",
                domain="POOLS",
                endpoint="/history/levels",
                expected_value="at least one stage=7 JACKPOT -> stage=3/10 PURCHASE sequence",
                observed_value=(
                    "no transitions enumerated; sim may be pre-level-1 or "
                    "/history/levels is empty"
                ),
                derivation=Derivation(
                    formula="AdvanceModule.sol:805 `(memFuture * 15) / 100`",
                    sources=[Citation(path=_ADVANCE_MODULE, line=805, label="contract")],
                ),
                magnitude="no transitions available for inferential check",
                severity="Info",
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=(
                            "indexer has not yet populated /history/levels with "
                            "completed level transitions"
                        ),
                        falsifiable_by=(
                            f"once transitions exist AND {POOLS_04_COVERAGE_GAP_ID} "
                            "is resolved, per-transition drawdown can be validated"
                        ),
                    )
                ],
                sample_context=_ctx(0, lag_snapshot),
                notes="Emitted when enumerate_transitions returns empty.",
            )
        )
        return results

    for lvl_from, lvl_to, block in transitions:
        is_x00 = (lvl_from % 100 == 0)
        expected_pct = 0 if is_x00 else 15
        cite_line = 1125 if is_x00 else 805
        branch_note = (
            "x00 branch: drawdown suppressed at level % 100 == 0"
            if is_x00
            else "standard branch: 15% drawdown on non-x00 transitions"
        )

        results.append(
            Discrepancy(
                id=f"POOLS-04-inferential-transition-{lvl_from}-to-{lvl_to}",
                domain="POOLS",
                endpoint="/history/levels",
                expected_value=(
                    f"nextpool(level {lvl_to} start) = {expected_pct}% * "
                    f"futurepool(level {lvl_from} pre-transition)"
                ),
                observed_value=(
                    f"transition detected at block {block}; pool snapshot "
                    f"values unavailable ({branch_note})"
                ),
                derivation=Derivation(
                    formula=(
                        "AdvanceModule.sol:805 `(memFuture * 15) / 100`; "
                        "0% at x00 (level % 100 == 0, AdvanceModule.sol:1125)"
                    ),
                    sources=[
                        Citation(path=_ADVANCE_MODULE, line=cite_line, label="contract"),
                    ],
                ),
                magnitude=(
                    f"inferential-only; observed side blocked by "
                    f"{POOLS_04_COVERAGE_GAP_ID}"
                ),
                severity="Info",
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=(
                            f"per-transition drawdown at {lvl_from}->{lvl_to} "
                            "cannot be validated without pre/post snapshots"
                        ),
                        falsifiable_by=(
                            f"once {POOLS_04_COVERAGE_GAP_ID} is resolved, compare "
                            f"futurepool(pre) vs nextpool(post) at block {block}; "
                            f"expect ratio = {expected_pct}%"
                        ),
                    )
                ],
                sample_context=_ctx(lvl_from, lag_snapshot),
                notes=(
                    f"Inferential entry for completed-level transition "
                    f"{lvl_from}->{lvl_to} at block {block}."
                ),
            )
        )

    return results
