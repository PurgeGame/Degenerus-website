"""JACKPOT-07 validator: turbo single-shot inferred from /history/levels.

``compressedJackpotFlag`` is not directly exposed. We infer the flag per
level from the count of distinct physical days where ``phase == 'JACKPOT'``:

- 1 physical day -> flag=2 (turbo / single-shot)
- 3 physical days -> flag=1 (compressed)
- 5 physical days -> flag=0 (normal)
- otherwise -> None (unexpected; Minor discrepancy)

Expected-flag policy (audit-canonical vs. turbo-mechanics):

- Levels <= 100: expected flag = 0 (normal five-day jackpot phase).
- Levels >= 101: expected flag = 2 per turbo-mechanics spec single-shot.
  If sim emitted flag=0 at level>=101, we tag
  ``suspected_source="expected_fast_regime_divergence"`` and severity=Minor
  (the canonical divergence between audit contracts and turbo-mechanics
  spec, per RESEARCH Open Question #2 / CLAUDE.md).
- Any other mismatch -> Major.

Contract citations:

- ``modules/DegenerusGameJackpotModule.sol:127`` — JACKPOT_LEVEL_CAP=5
- ``modules/DegenerusGameJackpotModule.sol:344-345`` — counterStep logic
- ``storage/DegenerusGameStorage.sol:297`` — compressedJackpotFlag
- ``modules/DegenerusGameAdvanceModule.sol:171,371`` — flag set on advance

Hero-candidate selection: scan ``SAMPLE_DAYS_CORE``, pick the day with
the largest single-trait divergence from expected_main_traits(finalWord).
Persist to ``.hero_candidate_cache.txt`` via atomic write.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from harness import (
    Citation,
    Derivation,
    Discrepancy,
    HealthSnapshot,
    Hypothesis,
    SampleContext,
    append_discrepancy,
    check_api_health,
)
from harness.api import _utc_now_iso

from validations.jackpot.endpoints import EndpointClient
from validations.jackpot.history_levels import (
    build_level_jackpot_day_counts,
    infer_compressed_flag,
    paginate_history_levels,
)
from validations.jackpot.sample_days import SAMPLE_DAYS_CORE
from validations.jackpot.trait_derivation import expected_main_traits, quadrant_of


_JACKPOT_MODULE = "degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol"
_STORAGE = "degenerus-audit/contracts/storage/DegenerusGameStorage.sol"
_ADVANCE = "degenerus-audit/contracts/modules/DegenerusGameAdvanceModule.sol"

_SEVERITY_ORDER = ("Critical", "Major", "Minor", "Info")

_HERO_CACHE_PATH = (
    Path(__file__).resolve().parent / ".hero_candidate_cache.txt"
)


def _downgrade(severity: str) -> str:
    try:
        idx = _SEVERITY_ORDER.index(severity)
    except ValueError:
        return severity
    return _SEVERITY_ORDER[min(idx + 1, len(_SEVERITY_ORDER) - 1)]


def _make_derivation() -> Derivation:
    return Derivation(
        formula=(
            "compressedJackpotFlag inferred from physical-day count per "
            "level via /history/levels: 1->2 turbo, 3->1 compressed, "
            "5->0 normal (JACKPOT_LEVEL_CAP=5, counterStep)"
        ),
        sources=[
            Citation(path=_JACKPOT_MODULE, line=127, label="contract"),
            Citation(path=_JACKPOT_MODULE, line=344, label="contract"),
            Citation(path=_STORAGE, line=297, label="contract"),
            Citation(path=_ADVANCE, line=171, label="contract"),
        ],
    )


def _ctx(level: int | None, snap: HealthSnapshot) -> SampleContext:
    return SampleContext(
        day=0,
        level=int(level) if level is not None else -1,
        archetype=None,
        lag_blocks=snap.lag_blocks,
        lag_unreliable=snap.lag_unreliable,
        sampled_at=snap.sampled_at,
    )


_INFERENCE_NOTE = (
    "infer from physical-day count; direct compressedJackpotFlag exposure "
    "would falsify"
)


def validate_jackpot_07(
    client: EndpointClient,
    *,
    lag_snapshot: HealthSnapshot,
) -> list[Discrepancy]:
    """Single-pass turbo inference over all levels."""
    entries: list[Discrepancy] = []

    try:
        items = paginate_history_levels(client)
    except Exception as exc:
        sev = "Minor" if lag_snapshot.lag_unreliable else "Major"
        return [
            Discrepancy(
                id="JACKPOT-07-history-levels-error",
                domain="JACKPOT",
                endpoint="/history/levels",
                expected_value="paginated /history/levels items",
                derivation=_make_derivation(),
                observed_value=f"<error: {type(exc).__name__}: {exc!s}>",
                magnitude="pagination failure",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="paginator cycle / schema drift / fetch error",
                        falsifiable_by="curl /history/levels and inspect",
                    )
                ],
                sample_context=_ctx(None, lag_snapshot),
            )
        ]

    try:
        counts = build_level_jackpot_day_counts(items)
    except ValueError as exc:
        return [
            Discrepancy(
                id="JACKPOT-07-history-levels-schema-drift",
                domain="JACKPOT",
                endpoint="/history/levels",
                expected_value="items with 'phase' and 'level' fields",
                derivation=_make_derivation(),
                observed_value=str(exc),
                magnitude="schema drift",
                severity="Major",
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="indexer schema changed for /history/levels",
                        falsifiable_by="re-probe endpoint and update parser",
                    )
                ],
                sample_context=_ctx(None, lag_snapshot),
            )
        ]

    for level, day_count in sorted(counts.items()):
        flag = infer_compressed_flag(day_count)
        if flag is None:
            sev = _downgrade("Minor") if lag_snapshot.lag_unreliable else "Minor"
            entries.append(
                Discrepancy(
                    id=f"JACKPOT-07-level{level}-unexpected-day-count",
                    domain="JACKPOT",
                    endpoint="/history/levels",
                    expected_value="day_count in {1, 3, 5}",
                    derivation=_make_derivation(),
                    observed_value=(
                        f"level {level} has day_count={day_count} "
                        "(unmapped in inference table)"
                    ),
                    magnitude="unexpected jackpot physical-day count",
                    severity=sev,
                    suspected_source="api",
                    hypothesis=[
                        Hypothesis(
                            text=(
                                "indexer emitted extra or partial JACKPOT rows; "
                                + _INFERENCE_NOTE
                            ),
                            falsifiable_by=(
                                "probe block-range per JACKPOT stage and recount"
                            ),
                        )
                    ],
                    sample_context=_ctx(level, lag_snapshot),
                )
            )
            continue

        expected_flag = 0 if level <= 100 else 2
        if flag == expected_flag:
            continue

        if level >= 101 and flag == 0:
            sev = _downgrade("Minor") if lag_snapshot.lag_unreliable else "Minor"
            entries.append(
                Discrepancy(
                    id=f"JACKPOT-07-level{level}-fast-regime-divergence",
                    domain="JACKPOT",
                    endpoint="/history/levels",
                    expected_value=(
                        "compressedJackpotFlag=2 (turbo single-shot) at "
                        f"level {level} per turbo-mechanics spec"
                    ),
                    derivation=_make_derivation(),
                    observed_value=(
                        f"inferred flag=0 (day_count=5) at level {level}"
                    ),
                    magnitude="audit-canonical vs turbo-mechanics spec divergence",
                    severity=sev,
                    suspected_source="expected_fast_regime_divergence",
                    hypothesis=[
                        Hypothesis(
                            text=(
                                "sim used audit-canonical compressedJackpotFlag=0 "
                                "at level>=101 instead of turbo-mechanics spec "
                                "flag=2; " + _INFERENCE_NOTE
                            ),
                            falsifiable_by=(
                                "contract exposes compressedJackpotFlag directly "
                                "or sim re-runs with turbo-mechanics spec"
                            ),
                        )
                    ],
                    sample_context=_ctx(level, lag_snapshot),
                )
            )
        else:
            sev = _downgrade("Major") if lag_snapshot.lag_unreliable else "Major"
            suspected = "contract" if flag > expected_flag else "api"
            entries.append(
                Discrepancy(
                    id=f"JACKPOT-07-level{level}-flag-mismatch",
                    domain="JACKPOT",
                    endpoint="/history/levels",
                    expected_value=(
                        f"compressedJackpotFlag={expected_flag} at level {level}"
                    ),
                    derivation=_make_derivation(),
                    observed_value=(
                        f"inferred flag={flag} (day_count={day_count})"
                    ),
                    magnitude="compressedJackpotFlag mismatch",
                    severity=sev,
                    suspected_source=suspected,
                    hypothesis=[
                        Hypothesis(
                            text=(
                                "physical-day count diverges from expected regime; "
                                + _INFERENCE_NOTE
                            ),
                            falsifiable_by=(
                                "contract exposes compressedJackpotFlag or index"
                                " backfills missing JACKPOT rows"
                            ),
                        )
                    ],
                    sample_context=_ctx(level, lag_snapshot),
                )
            )

    return entries


# ---------------------------------------------------------------------------
# Hero-candidate selection (25th SAMPLE entry)
# ---------------------------------------------------------------------------


def _divergence_score(derived: tuple[int, ...], observed: set[int]) -> int:
    missing = set(derived) - observed
    extras = observed - set(derived)
    # Score favors single-quadrant swaps (1 missing + 1 extra same quadrant).
    if not missing and not extras:
        return 0
    if len(missing) == 1 and len(extras) == 1:
        (m,) = tuple(missing)
        (e,) = tuple(extras)
        return 10 if quadrant_of(m) == quadrant_of(e) else 5
    return min(len(missing), len(extras))  # multi-quadrant: lower preference


def select_hero_candidate_day(client: EndpointClient) -> int | None:
    """Probe SAMPLE_DAYS_CORE; return day with largest single-quadrant divergence.

    Persists the chosen day via atomic write to ``.hero_candidate_cache.txt``.
    Returns None if no divergent candidate was found.
    """
    best_day: int | None = None
    best_score = 0

    for day, _lvl, _stratum, _why in SAMPLE_DAYS_CORE:
        try:
            fw = client.get_final_word(day)
            if fw is None:
                continue
            winners = client.get_jackpot_winners(day)
        except Exception:
            continue

        derived = expected_main_traits(fw)
        observed: set[int] = set()
        for w in winners.get("winners", []) or []:
            for row in w.get("breakdown", []) or []:
                if row.get("awardType") == "eth" and row.get("traitId") is not None:
                    observed.add(int(row["traitId"]))

        score = _divergence_score(derived, observed)
        if score > best_score:
            best_score = score
            best_day = day

    if best_day is not None:
        _atomic_write_int(_HERO_CACHE_PATH, best_day)

    return best_day


def _atomic_write_int(path: Path, value: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".hero_cand_", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(str(int(value)))
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def read_hero_candidate_cache() -> int | None:
    if not _HERO_CACHE_PATH.exists():
        return None
    try:
        return int(_HERO_CACHE_PATH.read_text().strip())
    except (ValueError, OSError):
        return None


# ---------------------------------------------------------------------------
# CLI entry points (used by __main__)
# ---------------------------------------------------------------------------


def run_jackpot_07_cli(discrepancies_path: str) -> int:
    snapshot = check_api_health()
    client = EndpointClient(mode="live")
    entries = validate_jackpot_07(client, lag_snapshot=snapshot)
    from collections import Counter

    counts: Counter[str] = Counter()
    for entry in entries:
        counts[entry.severity.lower()] += 1
        append_discrepancy(discrepancies_path, entry)

    print(
        f"JACKPOT-07 summary: "
        f"info={counts['info']} minor={counts['minor']} "
        f"major={counts['major']} critical={counts['critical']}"
    )
    print(f"lag_blocks={snapshot.lag_blocks} unreliable={snapshot.lag_unreliable}")
    return 0


def run_hero_candidate_cli() -> int:
    client = EndpointClient(mode="live")
    day = select_hero_candidate_day(client)
    if day is None:
        print(
            "hero-candidate: no divergent day found across SAMPLE_DAYS_CORE; "
            "JACKPOT-06 inference has no clean test case this run"
        )
        # Append an Info discrepancy noting the null selection.
        snap_ts = _utc_now_iso()
        entry = Discrepancy(
            id="JACKPOT-06-hero-candidate-none",
            domain="JACKPOT",
            endpoint="(synthetic: hero-candidate probe)",
            expected_value="at least one SAMPLE_DAYS_CORE day with divergent trait",
            derivation=_make_derivation(),
            observed_value="no divergent day across 24 samples",
            magnitude="no candidate",
            severity="Info",
            suspected_source="api",
            hypothesis=[
                Hypothesis(
                    text="no hero override fired on sampled days",
                    falsifiable_by="expand sample or wait for new sim",
                )
            ],
            sample_context=SampleContext(
                day=0, level=0, archetype=None,
                lag_blocks=0, lag_unreliable=False, sampled_at=snap_ts,
            ),
        )
        append_discrepancy(".planning/v2.3/discrepancies.yaml", entry)
    else:
        print(f"hero-candidate: selected day {day} (cached)")
    return 0
