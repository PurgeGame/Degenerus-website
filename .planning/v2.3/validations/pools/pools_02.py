"""POOLS-02 validator: per-level ticket-ETH inflow derivation (derivation-only).

No /events or /replay/events/:level endpoint exists, so the observed
per-deposit split cannot be reconstructed. What we CAN do is derive the
expected next/future split from /replay/tickets/:level aggregates *
PriceLookupLib.priceForLevel, and log the derivation as an Info entry
per level. Phase 23 synthesis will compare these against future event
data once the coverage gap is filled.

Per-ticket split: DegenerusGame.sol:160,186,393 — PURCHASE_TO_FUTURE_BPS=1000
  next  = total_ticket_eth * 9000 / 10000  (90%)
  future = total_ticket_eth * 1000 / 10000 (10%)
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

from validations.pools.price_curve import price_for_level
from validations.pools.sample import SAMPLE_LEVELS
from validations.pools.source_level_entries import (
    DEFAULT_DISCREPANCIES_PATH,
    POOLS_02_COVERAGE_GAP_ID,
    ensure_pools_02_coverage_gap_logged,
)


_GAME_CONTRACT = "degenerus-audit/contracts/DegenerusGame.sol"
_PRICE_LIB = "degenerus-audit/contracts/libraries/PriceLookupLib.sol"


def validate_pools_02(
    client: Any,
    sample_levels: tuple[int, ...] = SAMPLE_LEVELS,
    *,
    lag_snapshot: HealthSnapshot,
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> list[Discrepancy]:
    ensure_pools_02_coverage_gap_logged(yaml_path)

    results: list[Discrepancy] = []
    for level in sample_levels:
        try:
            tickets = client.get_replay_tickets(level)
        except Exception:
            continue
        players = tickets.get("players", []) or []
        total_tickets = sum(int(p.get("totalMintedOnLevel", 0)) for p in players)
        if total_tickets == 0:
            continue

        price_wei = price_for_level(level)
        total_ticket_eth = total_tickets * price_wei
        expected_next = total_ticket_eth * 9000 // 10000
        expected_future = total_ticket_eth * 1000 // 10000

        ctx = SampleContext(
            day=0,
            level=level,
            archetype=None,
            lag_blocks=lag_snapshot.lag_blocks,
            lag_unreliable=lag_snapshot.lag_unreliable,
            sampled_at=lag_snapshot.sampled_at,
        )

        results.append(
            Discrepancy(
                id=f"POOLS-02-derivation-level-{level}",
                domain="POOLS",
                endpoint=f"/replay/tickets/{level}",
                expected_value=(
                    f"ticket-ETH split: next={expected_next}, future={expected_future} "
                    f"(90/10 from {total_ticket_eth} total)"
                ),
                observed_value=(
                    f"{total_tickets} tickets @ {price_wei} wei each = {total_ticket_eth} total; "
                    f"observed split NOT reconstructable (see {POOLS_02_COVERAGE_GAP_ID})"
                ),
                derivation=Derivation(
                    formula=(
                        "ticket 90/10 split: DegenerusGame.sol:160,186,393 "
                        "(PURCHASE_TO_FUTURE_BPS=1000); "
                        f"priceForLevel({level}) = {price_wei} wei per "
                        "PriceLookupLib.sol:21-46"
                    ),
                    sources=[
                        Citation(path=_GAME_CONTRACT, line=160, label="contract"),
                        Citation(path=_PRICE_LIB, line=21, label="contract"),
                    ],
                ),
                magnitude=(
                    f"derivation-only; observed side blocked by {POOLS_02_COVERAGE_GAP_ID}"
                ),
                severity="Info",
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=(
                            f"per-deposit split at level {level} cannot be compared "
                            "without event-level data"
                        ),
                        falsifiable_by=(
                            f"once {POOLS_02_COVERAGE_GAP_ID} is resolved, sum "
                            "PoolDeposit.nextDelta / futureDelta across level "
                            f"{level} and compare to derivation"
                        ),
                    )
                ],
                sample_context=ctx,
                notes=(
                    "Derivation-only Info entry for Phase 23 synthesis; see "
                    f"{POOLS_02_COVERAGE_GAP_ID} for unblock criteria."
                ),
            )
        )
    return results
