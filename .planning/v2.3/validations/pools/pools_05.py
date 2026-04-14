"""POOLS-05 validator: stETH yield 50/25/25 split coverage gap.

POOLS-05 is UNOBSERVABLE this milestone:

- ``yieldAccumulator`` is not indexed (absent from ``database/src/db/schema/``
  and ``database/src/api/routes/``).
- ``/tokens/analytics.vault.stEthReserve`` is ``"0"`` in the current sim —
  the sim runs without stETH entirely.

Deliverable: one idempotent coverage-gap Info entry plus an optional
sim-config-drift Info entry if the sim is ever re-seeded with non-zero
stETH (positive signal: the gap may be partially observable; revisit).

No math is attempted. validate_pools_05 returns a list containing the
optional sim-config-drift Info when stEthReserve != "0", otherwise [].
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
    ensure_pools_05_coverage_gap_logged,
)


_JACKPOT_MODULE = "degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol"


def _ctx(lag_snapshot: HealthSnapshot) -> SampleContext:
    return SampleContext(
        day=0,
        level=0,
        archetype=None,
        lag_blocks=lag_snapshot.lag_blocks,
        lag_unreliable=lag_snapshot.lag_unreliable,
        sampled_at=lag_snapshot.sampled_at,
    )


def validate_pools_05(
    client: Any,
    *,
    lag_snapshot: HealthSnapshot,
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> list[Discrepancy]:
    ensure_pools_05_coverage_gap_logged(yaml_path)

    # Sanity proxy: if the sim is seeded with non-zero stETH, flag it so the
    # gap can be revisited.
    try:
        analytics = client.get_tokens_analytics()
    except Exception:
        return []

    steth_raw = ((analytics or {}).get("vault") or {}).get("stEthReserve", "0")
    # String-equality per threat model T-20-03-06: only "0" suppresses the drift.
    if isinstance(steth_raw, str) and steth_raw == "0":
        return []
    # Non-"0" (including numeric types) -> emit Info.
    return [
        Discrepancy(
            id="POOLS-05-sim-config-stEth-nonzero",
            domain="POOLS",
            endpoint="/tokens/analytics",
            expected_value="stEthReserve == '0' (sim runs without stETH this milestone)",
            observed_value=(
                f"stEthReserve={steth_raw!r}: stETH present in sim — POOLS-05 "
                "may be partially observable; revisit coverage gap"
            ),
            derivation=Derivation(
                formula=(
                    "distributeYieldSurplus canonical 50/25/25 split "
                    "(quarterShare = yieldPool * 2300 / 10000)"
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
            magnitude="sim-configuration drift: stETH seeded but indexer still blind",
            severity="Info",
            suspected_source="api",
            hypothesis=[
                Hypothesis(
                    text=(
                        "if stETH is non-zero in sim, the indexer-side gap is "
                        "now the sole blocker for POOLS-05"
                    ),
                    falsifiable_by=(
                        "add yieldAccumulator schema + /history/yield route; "
                        "then derive 50/25/25 split from per-accrual deltas"
                    ),
                )
            ],
            sample_context=_ctx(lag_snapshot),
            notes=(
                "Emitted only when stEthReserve != '0'. Not a regression — "
                "the point is to notice when the sim config changes."
            ),
        )
    ]
