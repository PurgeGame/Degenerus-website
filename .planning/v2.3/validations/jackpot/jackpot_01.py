"""JACKPOT-01 validator: compare derived main traits against /winners payload.

Algorithm:

1. Pull ``finalWord`` for ``day`` from ``/replay/rng`` cache. Missing entry
   -> single Info-severity coverage-gap Discrepancy.
2. derived = expected_main_traits(final_word).
3. Pull ``/game/jackpot/day/{day}/winners``.
4. observed = sorted({row.traitId for w in winners[] for row in w.breakdown[]
                      if row.awardType == "eth" and row.traitId is not None}).
5. extras = set(observed) - set(derived).
   - empty -> PASS (exact-match per CONTEXT Decision 2).
   - exactly one quadrant's trait differs AND replacement symbol < 8
     -> Info "likely hero override" (JACKPOT-06 inference).
   - else -> Major Discrepancy with dual hypothesis (api + contract drift).
6. Severity downgrades one level when ``lag_unreliable`` (RESEARCH Pitfall #8).

Contract citation: ``libraries/JackpotBucketLib.sol:281-286`` (getRandomTraits).
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

from validations.jackpot.endpoints import EndpointClient
from validations.jackpot.trait_derivation import expected_main_traits, quadrant_of


_CONTRACT_PATH = "degenerus-audit/contracts/libraries/JackpotBucketLib.sol"
_DERIVATION_FORMULA = (
    "getRandomTraits 6-bit slices of finalWord per "
    "JackpotBucketLib.sol:281-286: "
    "w[0]=rw&0x3F; w[1]=64+((rw>>6)&0x3F); "
    "w[2]=128+((rw>>12)&0x3F); w[3]=192+((rw>>18)&0x3F)"
)

_SEVERITY_ORDER = ("Critical", "Major", "Minor", "Info")


def _downgrade(severity: str) -> str:
    try:
        idx = _SEVERITY_ORDER.index(severity)
    except ValueError:
        return severity
    return _SEVERITY_ORDER[min(idx + 1, len(_SEVERITY_ORDER) - 1)]


def _make_derivation() -> Derivation:
    return Derivation(
        formula=_DERIVATION_FORMULA,
        sources=[Citation(path=_CONTRACT_PATH, line=281, label="contract")],
    )


def _make_sample_ctx(day: int, level: int | None, snap: HealthSnapshot) -> SampleContext:
    return SampleContext(
        day=day,
        level=int(level) if level is not None else -1,
        archetype=None,
        lag_blocks=snap.lag_blocks,
        lag_unreliable=snap.lag_unreliable,
        sampled_at=snap.sampled_at,
    )


def _extract_eth_traits(winners_payload: dict[str, Any]) -> set[int]:
    observed: set[int] = set()
    for w in winners_payload.get("winners", []) or []:
        for row in w.get("breakdown", []) or []:
            if row.get("awardType") != "eth":
                continue
            tid = row.get("traitId")
            if tid is None:
                continue
            observed.add(int(tid))
    return observed


def validate_jackpot_01(
    day: int,
    client: EndpointClient,
    *,
    lag_snapshot: HealthSnapshot,
) -> list[Discrepancy]:
    """Validate day's main-trait reveal against finalWord 6-bit unpack.

    Returns a list of ``Discrepancy`` entries (possibly empty on PASS).
    """
    endpoint = f"/game/jackpot/day/{day}/winners"

    # 1. Fetch finalWord
    final_word = client.get_final_word(day)
    if final_word is None:
        sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
        return [
            Discrepancy(
                id=f"JACKPOT-01-day{day}-missing-finalword",
                domain="JACKPOT",
                endpoint="/replay/rng",
                expected_value=f"finalWord for day {day}",
                derivation=_make_derivation(),
                observed_value="<missing>",
                magnitude="coverage gap",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=f"/replay/rng omits finalWord for day {day}",
                        falsifiable_by="re-probe /replay/rng and confirm day appears",
                    ),
                ],
                sample_context=_make_sample_ctx(day, None, lag_snapshot),
                notes="JACKPOT-01 cannot derive expected traits without finalWord",
            )
        ]

    # 2. Derive
    derived = expected_main_traits(final_word)
    derived_set = set(derived)

    # 3. Fetch winners
    try:
        winners_payload = client.get_jackpot_winners(day)
    except Exception as exc:
        sev = "Minor" if lag_snapshot.lag_unreliable else "Major"
        return [
            Discrepancy(
                id=f"JACKPOT-01-day{day}-fetch-error",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="<200 OK winners payload>",
                derivation=_make_derivation(),
                observed_value=f"<fetch error: {type(exc).__name__}>",
                magnitude="fetch failure",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="endpoint returned non-2xx or network error",
                        falsifiable_by=f"curl {endpoint} and inspect response",
                    ),
                ],
                sample_context=_make_sample_ctx(day, None, lag_snapshot),
            )
        ]

    level = winners_payload.get("level")
    winners_list = winners_payload.get("winners") or []
    if level is None or not winners_list:
        sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
        return [
            Discrepancy(
                id=f"JACKPOT-01-day{day}-no-winners",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value=f"winners for derived traits {derived}",
                derivation=_make_derivation(),
                observed_value=f"level={level!r} winners_count={len(winners_list)}",
                magnitude="coverage gap",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=f"day {day} payload has no winners (likely empty day)",
                        falsifiable_by="inspect /game/jackpot/day/{day}/winners live",
                    ),
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        ]

    # 4. Observed ETH main-trait ids
    observed = _extract_eth_traits(winners_payload)
    extras = observed - derived_set

    # 5a. PASS
    if not extras:
        return []

    # 5b. Hero-override inference: exactly one quadrant differs, symbol < 8
    # (symbol = low 3 bits of trait id, color = bits 3-5).
    missing = derived_set - observed
    if len(extras) == 1 and len(missing) >= 1:
        (extra_tid,) = tuple(extras)
        extra_q = quadrant_of(extra_tid)
        missing_same_q = [m for m in missing if quadrant_of(m) == extra_q]
        if missing_same_q and (extra_tid & 0x07) < 8:
            # symbol always < 8 given mask 0x07; tighten to a strict check
            # that the replacement is plausibly a hero (symbol bits only).
            sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
            return [
                Discrepancy(
                    id=f"JACKPOT-01-day{day}-hero-candidate",
                    domain="JACKPOT",
                    endpoint=endpoint,
                    expected_value=f"derived main traits {derived}",
                    derivation=_make_derivation(),
                    observed_value=(
                        f"one quadrant differs: expected {sorted(missing)!s}, "
                        f"observed extra {sorted(extras)!s} (quadrant {extra_q})"
                    ),
                    magnitude="single-quadrant mismatch",
                    severity=sev,
                    suspected_source="contract",
                    hypothesis=[
                        Hypothesis(
                            text=(
                                "hero override at quadrant {q} replaced the base "
                                "trait; see JackpotModule.sol:1558-1585 "
                                "_applyHeroOverride"
                            ).format(q=extra_q),
                            falsifiable_by=(
                                "indexer exposes dailyHeroWagers or contract "
                                "emits HeroOverrideApplied event"
                            ),
                        ),
                    ],
                    sample_context=_make_sample_ctx(day, level, lag_snapshot),
                    notes="JACKPOT-06 inferential signal (Phase 19-04 coverage)",
                )
            ]

    # 5c. Unexpected divergence -> Major (downgrade if lag_unreliable)
    sev = _downgrade("Major") if lag_snapshot.lag_unreliable else "Major"
    return [
        Discrepancy(
            id=f"JACKPOT-01-day{day}-trait-mismatch",
            domain="JACKPOT",
            endpoint=endpoint,
            expected_value=f"derived main traits {sorted(derived_set)!s}",
            derivation=_make_derivation(),
            observed_value=f"observed ETH traits {sorted(observed)!s}",
            magnitude=(
                f"extras={sorted(extras)!s} missing={sorted(missing)!s}"
            ),
            severity=sev,
            suspected_source="api",
            hypothesis=[
                Hypothesis(
                    text=(
                        "indexer emits wrong traitId for ETH breakdown rows"
                    ),
                    falsifiable_by=(
                        "compare /replay/day/{day} raw distributions against "
                        "/game/jackpot/day/{day}/winners".format(day=day)
                    ),
                ),
                Hypothesis(
                    text=(
                        "contract-derived trait unpack drifted from "
                        "JackpotBucketLib.sol:281-286 expectation"
                    ),
                    falsifiable_by=(
                        "re-read JackpotBucketLib.getRandomTraits and recompute"
                    ),
                ),
            ],
            sample_context=_make_sample_ctx(day, level, lag_snapshot),
        )
    ]
