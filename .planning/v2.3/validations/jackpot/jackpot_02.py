"""JACKPOT-02 validator: Roll 1 classification + per-player aggregation.

Contract canonical: ``degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol``

- Line 167: ``DAILY_CARRYOVER_MAX_OFFSET = 4`` (contextual — Roll 2 bound)
- Line 394..431: Roll 1 distribution (``sourceLevel == purchaseLevel``)

Algorithm:

1. Fetch ``roll1 = client.get_roll1(day)``.
2. If ``roll1.purchaseLevel`` is None (post-gameover or compressed day) ->
   single Info coverage gap; return.
3. For each ``win``: if ``sourceLevel is not None`` AND
   ``sourceLevel != purchaseLevel`` -> Major violation.
4. Reconcile per-player totals via
   :func:`aggregation.reconcile_player_totals` (roll1+roll2 ETH vs
   winners[].totalEth). Mismatches -> Critical.
5. Sentinel ticketIndex (deity virtual) -> Info note; no discrepancy.
6. Severity downgrades one tier when ``lag_unreliable``.
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

from validations.jackpot.aggregation import reconcile_player_totals
from validations.jackpot.endpoints import EndpointClient


_CONTRACT_PATH = "degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol"
_ROLL1_LINE = 394
_MAX_OFFSET_LINE = 167

_SEVERITY_ORDER = ("Critical", "Major", "Minor", "Info")


def _downgrade(severity: str) -> str:
    try:
        idx = _SEVERITY_ORDER.index(severity)
    except ValueError:
        return severity
    return _SEVERITY_ORDER[min(idx + 1, len(_SEVERITY_ORDER) - 1)]


def _derivation_roll1() -> Derivation:
    return Derivation(
        formula="Roll 1 wins carry sourceLevel == purchaseLevel (current-level distribution)",
        sources=[Citation(path=_CONTRACT_PATH, line=_ROLL1_LINE, label="contract")],
    )


def _derivation_aggregation() -> Derivation:
    return Derivation(
        formula=(
            "sum(winners[].totalEth) == sum(roll1.wins[eth].amount) "
            "+ sum(roll2.wins[eth].amount)  (exact wei integer)"
        ),
        sources=[Citation(path=_CONTRACT_PATH, line=_ROLL1_LINE, label="contract")],
    )


def _make_sample_ctx(
    day: int, level: int | None, snap: HealthSnapshot
) -> SampleContext:
    return SampleContext(
        day=day,
        level=int(level) if level is not None else -1,
        archetype=None,
        lag_blocks=snap.lag_blocks,
        lag_unreliable=snap.lag_unreliable,
        sampled_at=snap.sampled_at,
    )


def validate_jackpot_02(
    day: int,
    client: EndpointClient,
    *,
    lag_snapshot: HealthSnapshot,
) -> list[Discrepancy]:
    """Validate Roll 1 classification + per-player aggregation for ``day``."""
    endpoint = f"/game/jackpot/day/{day}/roll1"
    entries: list[Discrepancy] = []

    try:
        roll1 = client.get_roll1(day)
    except Exception as exc:
        sev = "Minor" if lag_snapshot.lag_unreliable else "Major"
        return [
            Discrepancy(
                id=f"JACKPOT-02-day{day}-fetch-error",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="<200 OK roll1 payload>",
                derivation=_derivation_roll1(),
                observed_value=f"<fetch error: {type(exc).__name__}>",
                magnitude="fetch failure",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="roll1 endpoint returned non-2xx or network error",
                        falsifiable_by=f"curl {endpoint} and inspect response",
                    )
                ],
                sample_context=_make_sample_ctx(day, None, lag_snapshot),
            )
        ]

    if roll1 is None:
        sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
        return [
            Discrepancy(
                id=f"JACKPOT-02-day{day}-roll1-missing",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="roll1 payload",
                derivation=_derivation_roll1(),
                observed_value="<404 / missing>",
                magnitude="coverage gap",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=f"indexer has no roll1 row for day {day}",
                        falsifiable_by=f"curl {endpoint} and inspect",
                    )
                ],
                sample_context=_make_sample_ctx(day, None, lag_snapshot),
            )
        ]

    purchase_level = roll1.get("purchaseLevel")
    level = roll1.get("level")
    wins: list[dict[str, Any]] = roll1.get("wins") or []

    if purchase_level is None:
        sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-02-day{day}-null-purchaselevel",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="purchaseLevel integer",
                derivation=_derivation_roll1(),
                observed_value="null",
                magnitude="coverage gap",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="indexer null-fills purchaseLevel for non-purchase-phase days (post-gameover / compressed)",
                        falsifiable_by=(
                            f"confirm day {day} is post-gameover via /game/state "
                            "or /history/levels"
                        ),
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
                notes="Roll 1 classification skipped (purchaseLevel null)",
            )
        )
        return entries
    else:
        # Classification check (non-null sourceLevel only).
        classification_violations: list[dict[str, Any]] = []
        null_source_count = 0
        sentinel_count = 0
        for win in wins:
            if win.get("awardType") != "eth":
                continue  # only classify ETH distributions
            ticket_idx = win.get("ticketIndex")
            if ticket_idx is not None and ticket_idx == (1 << 256) - 1:
                sentinel_count += 1
                continue
            sl = win.get("sourceLevel")
            if sl is None:
                null_source_count += 1
                continue
            if int(sl) != int(purchase_level):
                classification_violations.append(win)

        if classification_violations:
            sev = _downgrade("Major") if lag_snapshot.lag_unreliable else "Major"
            vcount = len(classification_violations)
            first = classification_violations[0]
            entries.append(
                Discrepancy(
                    id=f"JACKPOT-02-day{day}-roll1-misclassified",
                    domain="JACKPOT",
                    endpoint=endpoint,
                    expected_value=f"sourceLevel == purchaseLevel ({purchase_level}) for all Roll 1 ETH wins",
                    derivation=_derivation_roll1(),
                    observed_value=(
                        f"{vcount} wins with sourceLevel != purchaseLevel; "
                        f"first: sourceLevel={first.get('sourceLevel')}, "
                        f"ticketIndex={first.get('ticketIndex')}"
                    ),
                    magnitude=f"{vcount} / {len(wins)} Roll 1 ETH wins misclassified",
                    severity=sev,
                    suspected_source="api",
                    hypothesis=[
                        Hypothesis(
                            text=(
                                "indexer emits wrong sourceLevel on Roll 1 rows "
                                "(contract guarantees current-level)"
                            ),
                            falsifiable_by=(
                                "re-index day from chain and compare against "
                                "JackpotModule _distributeRoll1 emissions"
                            ),
                        )
                    ],
                    sample_context=_make_sample_ctx(day, level, lag_snapshot),
                )
            )

        # Null-source-level coverage note (Info; only if any nulls).
        if null_source_count > 0:
            sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
            entries.append(
                Discrepancy(
                    id=f"JACKPOT-02-day{day}-roll1-null-sourcelevel",
                    domain="JACKPOT",
                    endpoint=endpoint,
                    expected_value="sourceLevel set on every Roll 1 ETH win",
                    derivation=_derivation_roll1(),
                    observed_value=f"{null_source_count}/{len(wins)} wins have sourceLevel=null",
                    magnitude="coverage gap",
                    severity=sev,
                    suspected_source="api",
                    hypothesis=[
                        Hypothesis(
                            text="indexer omits sourceLevel field on Roll 1 rows",
                            falsifiable_by=f"curl {endpoint} and count null sourceLevel entries",
                        )
                    ],
                    sample_context=_make_sample_ctx(day, level, lag_snapshot),
                    notes="Classification could not be fully verified due to null fields",
                )
            )

        if sentinel_count > 0:
            entries.append(
                Discrepancy(
                    id=f"JACKPOT-02-day{day}-roll1-sentinel-ticketindex",
                    domain="JACKPOT",
                    endpoint=endpoint,
                    expected_value="<informational only>",
                    derivation=_derivation_roll1(),
                    observed_value=f"{sentinel_count} deity virtual entries (ticketIndex=2^256-1)",
                    magnitude="info note",
                    severity="Info",
                    suspected_source="contract",
                    hypothesis=[
                        Hypothesis(
                            text="deity virtual entries excluded from aggregation per contract semantics",
                            falsifiable_by="inspect JackpotModule deity virtual ticket path",
                        )
                    ],
                    sample_context=_make_sample_ctx(day, level, lag_snapshot),
                    notes="sentinel tolerated; not a violation",
                )
            )

    # Aggregation: winners[].totalEth == sum(roll1+roll2 ETH)
    try:
        winners_payload = client.get_jackpot_winners(day)
    except Exception as exc:
        sev = "Minor" if lag_snapshot.lag_unreliable else "Major"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-02-day{day}-winners-fetch-error",
                domain="JACKPOT",
                endpoint=f"/game/jackpot/day/{day}/winners",
                expected_value="<200 OK winners payload>",
                derivation=_derivation_aggregation(),
                observed_value=f"<fetch error: {type(exc).__name__}>",
                magnitude="fetch failure",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="winners endpoint returned non-2xx or network error",
                        falsifiable_by="curl endpoint and inspect",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )
        return entries

    try:
        roll2 = client.get_roll2(day)
    except Exception:
        roll2 = None  # 404 already returns None; other errors treated as absent

    try:
        recon = reconcile_player_totals(winners_payload, roll1, roll2)
    except ValueError as exc:
        entries.append(
            Discrepancy(
                id=f"JACKPOT-02-day{day}-oversized-payload",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="wins[] within sanity bound",
                derivation=_derivation_aggregation(),
                observed_value=str(exc),
                magnitude="sanity-bound exceeded",
                severity="Major",
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="indexer returned oversized array (possible DoS vector)",
                        falsifiable_by="inspect array length and compare to expected",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )
        return entries

    if recon.issues:
        sev = _downgrade("Critical") if lag_snapshot.lag_unreliable else "Critical"
        mismatches = [i for i in recon.issues if i.kind == "mismatch"]
        missing = [i for i in recon.issues if i.kind == "missing_address"]
        n_mis = len(mismatches)
        n_miss = len(missing)
        first_issue = recon.issues[0]
        entries.append(
            Discrepancy(
                id=f"JACKPOT-02-day{day}-aggregation-mismatch",
                domain="JACKPOT",
                endpoint=f"/game/jackpot/day/{day}/winners",
                expected_value="exact-wei per-address total == sum(roll1+roll2 ETH)",
                derivation=_derivation_aggregation(),
                observed_value=(
                    f"mismatches={n_mis} missing_addrs={n_miss} "
                    f"first_kind={first_issue.kind} diff_wei={first_issue.observed_wei - first_issue.expected_wei}"
                ),
                magnitude=f"{n_mis + n_miss} per-player reconciliation failures",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="indexer double-counts or omits rows when assembling totalEth",
                        falsifiable_by=(
                            "re-derive per-address sums from /roll1 and /roll2 "
                            "and compare to winners[].totalEth"
                        ),
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
                notes=(
                    f"sentinel_addresses={len(recon.sentinel_addresses)} "
                    f"null_sourcelevel_rows={recon.null_source_level_count}"
                ),
            )
        )

    return entries
