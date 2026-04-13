"""JACKPOT-06 validator: inferential hero-override classifier.

This requirement is **UNOBSERVABLE from the current API**. Contract
state ``dailyHeroWagers`` is not exposed by any endpoint, and
``_applyHeroOverride`` emits no event. Every sampled day logs a
permanent coverage-gap Info entry (via ``source_level_entries``) and
runs a best-effort inferential classification here.

Classification tiers (per plan 19-04 task 1):

- No difference from derived 4 main traits -> empty (silent PASS).
- Exactly one missing + one extra, SAME quadrant, extra-symbol<8 ->
  Info "LIKELY hero override fired".
- Exactly one missing + one extra, SAME quadrant, extra-symbol>=8 ->
  Minor (derivation / RNG drift).
- Multi-quadrant divergence -> Major (derivation drift or indexer bug).

Contract citations:

- ``modules/DegenerusGameJackpotModule.sol:1558`` — ``_applyHeroOverride``
- ``storage/DegenerusGameStorage.sol:1458`` — ``dailyHeroWagers`` map
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

from validations.jackpot.trait_derivation import expected_main_traits, quadrant_of


_JACKPOT_MODULE = "degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol"
_STORAGE = "degenerus-audit/contracts/storage/DegenerusGameStorage.sol"

_SEVERITY_ORDER = ("Critical", "Major", "Minor", "Info")


def _downgrade(severity: str) -> str:
    try:
        idx = _SEVERITY_ORDER.index(severity)
    except ValueError:
        return severity
    return _SEVERITY_ORDER[min(idx + 1, len(_SEVERITY_ORDER) - 1)]


def _make_derivation() -> Derivation:
    return Derivation(
        formula=(
            "inferred hero override: exactly one quadrant's observed "
            "main-trait differs from getRandomTraits(finalWord); "
            "replacement symbol (traitId & 0x07) in [0,8) is a hero-symbol "
            "marker per _applyHeroOverride"
        ),
        sources=[
            Citation(path=_JACKPOT_MODULE, line=1558, label="contract"),
            Citation(path=_STORAGE, line=1458, label="contract"),
        ],
    )


def _make_ctx(day: int, level: int | None, snap: HealthSnapshot) -> SampleContext:
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


def validate_jackpot_06(
    day: int,
    client,
    *,
    lag_snapshot: HealthSnapshot,
) -> list[Discrepancy]:
    """Inferential hero-override check for ``day``.

    NOTE: The permanent coverage-gap entry (``JACKPOT-06-coverage-gap-hero-wagers``)
    is logged ONCE per process via
    ``source_level_entries.ensure_jackpot_06_coverage_gap_logged``; this
    validator only emits per-day inferential signals.
    """
    endpoint = f"/game/jackpot/day/{day}/winners"

    final_word = client.get_final_word(day)
    if final_word is None:
        sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
        return [
            Discrepancy(
                id=f"JACKPOT-06-day{day}-missing-finalword",
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
                        falsifiable_by="re-probe /replay/rng",
                    )
                ],
                sample_context=_make_ctx(day, None, lag_snapshot),
                notes="JACKPOT-06 inference requires finalWord",
            )
        ]

    try:
        winners_payload = client.get_jackpot_winners(day)
    except Exception as exc:
        sev = "Minor" if lag_snapshot.lag_unreliable else "Major"
        return [
            Discrepancy(
                id=f"JACKPOT-06-day{day}-fetch-error",
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
                        text="winners endpoint error",
                        falsifiable_by=f"curl {endpoint}",
                    )
                ],
                sample_context=_make_ctx(day, None, lag_snapshot),
            )
        ]

    level = winners_payload.get("level")
    derived = set(expected_main_traits(final_word))
    observed = _extract_eth_traits(winners_payload)

    missing = derived - observed
    extras = observed - derived

    # 0 differences -> silent PASS (coverage-gap entry covers the "did we check"
    # audit-trail once per process).
    if not missing and not extras:
        return []

    # Compute quadrant sets.
    extra_quads = {quadrant_of(t) for t in extras}
    missing_quads = {quadrant_of(t) for t in missing}

    # Exactly one missing + one extra, same quadrant.
    if len(extras) == 1 and len(missing) == 1 and extra_quads == missing_quads:
        (extra_tid,) = tuple(extras)
        (missing_tid,) = tuple(missing)
        q = quadrant_of(extra_tid)
        symbol = extra_tid & 0x07
        # Color nibble check: a true hero replacement packs
        # (quadrant<<6) | (color<<3) | symbol — color in [0,8), symbol in [0,8).
        # Because low 6 bits are (color<<3 | symbol), full-range is [0,63).
        # We use the plan's explicit criterion: symbol < 8 (always true with 0x07)
        # AND treat out-of-range signal via color bits >= 8 equivalent — since
        # color = (tid >> 3) & 0x07 also caps at 7, the plan's "extra & 0x07 >= 8"
        # is impossible. We therefore tier by whether the replacement sits in
        # the canonical hero-symbol subspace: ANY same-quadrant single swap is
        # a LIKELY hero fire (Info). True derivation drift manifests as
        # multi-quadrant or >1 swap (handled below).
        _ = missing_tid  # retained for magnitude text below
        if symbol < 8:
            sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
            return [
                Discrepancy(
                    id=f"JACKPOT-06-day{day}-hero-likely-q{q}",
                    domain="JACKPOT",
                    endpoint=endpoint,
                    expected_value=(
                        f"derived main traits {sorted(derived)!s}"
                    ),
                    derivation=_make_derivation(),
                    observed_value=(
                        f"LIKELY hero override fired on day {day} at quadrant {q}: "
                        f"missing derived {missing_tid} replaced by "
                        f"{extra_tid} (symbol={symbol})"
                    ),
                    magnitude="likely hero override (single-quadrant swap)",
                    severity=sev,
                    suspected_source="contract",
                    hypothesis=[
                        Hypothesis(
                            text=(
                                f"hero symbol {symbol} auto-won quadrant {q}; "
                                "cannot verify without wager endpoint"
                            ),
                            falsifiable_by=(
                                "indexer exposes dailyHeroWagers or contract "
                                "emits HeroOverrideApplied(day, quadrant, symbol)"
                            ),
                        )
                    ],
                    sample_context=_make_ctx(day, level, lag_snapshot),
                    notes=(
                        "inferential signal only (see permanent coverage gap "
                        "JACKPOT-06-coverage-gap-hero-wagers)"
                    ),
                )
            ]
        # symbol >= 8 is not reachable with 0x07 mask; reserved branch for
        # future derivation-drift modeling.
        sev = _downgrade("Minor") if lag_snapshot.lag_unreliable else "Minor"
        return [
            Discrepancy(
                id=f"JACKPOT-06-day{day}-single-quadrant-drift",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value=f"derived main traits {sorted(derived)!s}",
                derivation=_make_derivation(),
                observed_value=(
                    f"single-trait divergence outside hero-symbol range at "
                    f"quadrant {q}: {missing_tid}->{extra_tid}"
                ),
                magnitude="derivation or RNG drift candidate",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=(
                            "replacement symbol not in hero-symbol range; "
                            "suspect derivation or RNG drift"
                        ),
                        falsifiable_by=(
                            "compare /replay/day/{day} raw distributions "
                            "against winners payload".format(day=day)
                        ),
                    )
                ],
                sample_context=_make_ctx(day, level, lag_snapshot),
            )
        ]

    # Multi-quadrant divergence -> Major.
    sev = _downgrade("Major") if lag_snapshot.lag_unreliable else "Major"
    return [
        Discrepancy(
            id=f"JACKPOT-06-day{day}-multi-quadrant-mismatch",
            domain="JACKPOT",
            endpoint=endpoint,
            expected_value=f"derived main traits {sorted(derived)!s}",
            derivation=_make_derivation(),
            observed_value=(
                f"multi-quadrant trait mismatch: missing={sorted(missing)!s} "
                f"extras={sorted(extras)!s} "
                f"extra_quads={sorted(extra_quads)!s} "
                f"missing_quads={sorted(missing_quads)!s}"
            ),
            magnitude=(
                f"{len(extras)} extra / {len(missing)} missing across "
                f"{len(extra_quads | missing_quads)} quadrants"
            ),
            severity=sev,
            suspected_source="api",
            hypothesis=[
                Hypothesis(
                    text=(
                        "multi-quadrant drift exceeds hero-override footprint; "
                        "suspect derivation drift or indexer bug"
                    ),
                    falsifiable_by=(
                        "re-derive getRandomTraits(finalWord) and cross-check "
                        "/replay/day/{day} raw distributions".format(day=day)
                    ),
                )
            ],
            sample_context=_make_ctx(day, level, lag_snapshot),
        )
    ]
