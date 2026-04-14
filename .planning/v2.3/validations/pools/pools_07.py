"""POOLS-07 validator: static-price conformance + source-drift.

Scope (audit-canonical):
- Compare /game/state.price against PriceLookupLib.priceForLevel(level).
- Pass -> no YAML noise.
- Mismatch -> Major Discrepancy (Minor under lag_unreliable).
- Null price (gameover/pre-game) -> Info.

Source drift:
- REQUIREMENTS.md:35 references "100K ticket target" and "fractional credit
  accumulation" — turbo-spec mechanics absent from audit contracts.
- Logged once via ensure_pools_07_source_drift_logged.
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
from validations.pools.source_level_entries import (
    DEFAULT_DISCREPANCIES_PATH,
    ensure_pools_07_source_drift_logged,
)


_PRICE_LIB = "degenerus-audit/contracts/libraries/PriceLookupLib.sol"

_DOWNGRADE = {
    "Critical": "Major",
    "Major": "Minor",
    "Minor": "Info",
    "Info": "Info",
}


def _ctx(level: int, lag_snapshot: HealthSnapshot) -> SampleContext:
    return SampleContext(
        day=0,
        level=level,
        archetype=None,
        lag_blocks=lag_snapshot.lag_blocks,
        lag_unreliable=lag_snapshot.lag_unreliable,
        sampled_at=lag_snapshot.sampled_at,
    )


def validate_pools_07(
    client: Any,
    *,
    lag_snapshot: HealthSnapshot,
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> list[Discrepancy]:
    ensure_pools_07_source_drift_logged(yaml_path)

    try:
        state = client.get_game_state()
    except Exception:
        return []

    raw_price = (state or {}).get("price")
    raw_level = (state or {}).get("level")

    if raw_price is None or raw_level is None:
        return [
            Discrepancy(
                id="POOLS-07-static-price-null",
                domain="POOLS",
                endpoint="/game/state",
                expected_value="non-null price when level is active",
                observed_value=(
                    "/game/state.price is null (gameover or pre-game); "
                    "no conformance check possible this sample"
                ),
                derivation=Derivation(
                    formula="PriceLookupLib.priceForLevel(level) — static table",
                    sources=[
                        Citation(path=_PRICE_LIB, line=7, label="contract"),
                        Citation(path=_PRICE_LIB, line=47, label="contract"),
                    ],
                ),
                magnitude="no sample possible",
                severity="Info",
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=(
                            "sim is at gameover; live conformance check "
                            "requires mid-run snapshot"
                        ),
                        falsifiable_by=(
                            "run validator against a mid-run sim state "
                            "(level 1..110, non-gameover)"
                        ),
                    )
                ],
                sample_context=_ctx(0, lag_snapshot),
                notes=(
                    "Emitted when /game/state.price or .level is null. Not a "
                    "failure — just records that no check ran this sample."
                ),
            )
        ]

    # T-20-03-01: guard malformed price
    try:
        observed_price = int(raw_price)
    except (TypeError, ValueError):
        return [
            Discrepancy(
                id="POOLS-07-static-price-malformed",
                domain="POOLS",
                endpoint="/game/state",
                expected_value="integer-string price in wei",
                observed_value=f"price field not an integer string: {raw_price!r}",
                derivation=Derivation(
                    formula="int(price)",
                    sources=[Citation(path=_PRICE_LIB, line=7, label="contract")],
                ),
                magnitude="malformed price field",
                severity="Info",
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="/game/state.price returned a non-integer string",
                        falsifiable_by="inspect indexer price-rendering code",
                    )
                ],
                sample_context=_ctx(0, lag_snapshot),
                notes="Defensive skip; no conformance check run.",
            )
        ]

    try:
        level = int(raw_level)
    except (TypeError, ValueError):
        return []

    # T-20-03-03: out-of-range level guard
    if level < 0 or level > 1000:
        return [
            Discrepancy(
                id="POOLS-07-static-price-level-out-of-range",
                domain="POOLS",
                endpoint="/game/state",
                expected_value="0 <= level <= 1000",
                observed_value=f"level={level} out of expected range",
                derivation=Derivation(
                    formula="PriceLookupLib.priceForLevel domain guard",
                    sources=[Citation(path=_PRICE_LIB, line=7, label="contract")],
                ),
                magnitude="level out of expected range",
                severity="Info",
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="indexer returned unexpected level value",
                        falsifiable_by="inspect /game/state level rendering",
                    )
                ],
                sample_context=_ctx(level, lag_snapshot),
                notes="Defensive skip; no conformance check run.",
            )
        ]

    expected_price = price_for_level(level)

    if observed_price == expected_price:
        return []

    severity = "Major"
    if lag_snapshot.lag_unreliable:
        severity = _DOWNGRADE[severity]

    return [
        Discrepancy(
            id=f"POOLS-07-static-price-mismatch-level-{level}",
            domain="POOLS",
            endpoint="/game/state",
            expected_value=str(expected_price),
            observed_value=str(observed_price),
            derivation=Derivation(
                formula=f"PriceLookupLib.priceForLevel({level})",
                sources=[Citation(path=_PRICE_LIB, line=7, label="contract")],
            ),
            magnitude=f"delta={observed_price - expected_price} wei (observed - expected)",
            severity=severity,
            suspected_source="api",
            hypothesis=[
                Hypothesis(
                    text=(
                        "indexer /game/state.price diverges from static "
                        "PriceLookupLib table"
                    ),
                    falsifiable_by=(
                        "compare indexer price-rendering code against "
                        "PriceLookupLib.sol:7-47; fix whichever diverges"
                    ),
                )
            ],
            sample_context=_ctx(level, lag_snapshot),
            notes=(
                "Static-price conformance against audit canonical. Turbo-spec "
                "dynamic pricing is out of scope — see "
                "POOLS-07-source-doc-turbo-drift."
            ),
        )
    ]
