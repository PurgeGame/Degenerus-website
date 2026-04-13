"""JACKPOT-03 validator: Roll 2 near/far classification.

Contract canonical:

- ``modules/DegenerusGameJackpotModule.sol:167`` — ``DAILY_CARRYOVER_MAX_OFFSET = 4``
- ``modules/DegenerusGameJackpotModule.sol:585-642`` — Roll 2 distribution

Roll 2 invariants:

- ``purchaseLevel < sourceLevel`` (strictly future)
- near-future: ``purchaseLevel < sourceLevel <= purchaseLevel + 4``
- far-future:  ``sourceLevel > purchaseLevel + 4``

Source-level discrepancy: REQUIREMENTS.md / GT paper text says ``+3``
but the contract constant is ``+4``. Logged as a single idempotent
Discrepancy with id ``JACKPOT-03-source-doc-bound-mismatch``.
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
    append_discrepancy,
    load_discrepancies,
)
from harness.api import _utc_now_iso

from validations.jackpot.aggregation import reconcile_player_totals
from validations.jackpot.endpoints import EndpointClient


_CONTRACT_PATH = "degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol"
_MAX_OFFSET_LINE = 167
_ROLL2_LINE = 585

CARRYOVER_MAX_OFFSET = 4  # contract canonical (NOT +3 per REQUIREMENTS.md)

SOURCE_LEVEL_BOUND_ID = "JACKPOT-03-source-doc-bound-mismatch"
DEFAULT_DISCREPANCIES_PATH = ".planning/v2.3/discrepancies.yaml"

_SEVERITY_ORDER = ("Critical", "Major", "Minor", "Info")


def _downgrade(severity: str) -> str:
    try:
        idx = _SEVERITY_ORDER.index(severity)
    except ValueError:
        return severity
    return _SEVERITY_ORDER[min(idx + 1, len(_SEVERITY_ORDER) - 1)]


def _derivation_roll2() -> Derivation:
    return Derivation(
        formula=(
            "Roll 2: purchaseLevel < sourceLevel; near-future if "
            "sourceLevel <= purchaseLevel + 4 (DAILY_CARRYOVER_MAX_OFFSET)"
        ),
        sources=[
            Citation(path=_CONTRACT_PATH, line=_MAX_OFFSET_LINE, label="contract"),
            Citation(path=_CONTRACT_PATH, line=_ROLL2_LINE, label="contract"),
        ],
    )


def _derivation_aggregation() -> Derivation:
    return Derivation(
        formula=(
            "sum(winners[].totalEth) == sum(roll1.eth) + sum(roll2.eth)"
            " (exact wei integer)"
        ),
        sources=[Citation(path=_CONTRACT_PATH, line=_ROLL2_LINE, label="contract")],
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


# ---------------------------------------------------------------------------
# Source-level +4 vs +3 discrepancy (idempotent one-shot)
# ---------------------------------------------------------------------------


def ensure_source_level_bound_discrepancy_logged(
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> bool:
    """Append the ``JACKPOT-03-source-doc-bound-mismatch`` entry IF missing.

    Returns True if an entry was appended, False if idempotently skipped.
    """
    existing = load_discrepancies(yaml_path)
    for d in existing:
        if d.id == SOURCE_LEVEL_BOUND_ID:
            return False

    entry = Discrepancy(
        id=SOURCE_LEVEL_BOUND_ID,
        domain="JACKPOT",
        endpoint="source-level (REQUIREMENTS.md vs JackpotModule.sol:167)",
        expected_value="purchaseLevel + 4 (DAILY_CARRYOVER_MAX_OFFSET at JackpotModule.sol:167)",
        derivation=Derivation(
            formula="CARRYOVER_MAX_OFFSET constant in contract source",
            sources=[
                Citation(path=_CONTRACT_PATH, line=_MAX_OFFSET_LINE, label="contract")
            ],
        ),
        observed_value="purchaseLevel + 3 (REQUIREMENTS.md JACKPOT-03 text)",
        magnitude="off-by-one: docs understate near-future bound by 1 level",
        severity="Minor",
        suspected_source="gt_paper",
        hypothesis=[
            Hypothesis(
                text=(
                    "REQUIREMENTS.md text drifted from contract constant; "
                    "contract is canonical per CONTEXT Decision 4"
                ),
                falsifiable_by=(
                    "grep REQUIREMENTS.md for '+3' and confirm vs "
                    "JackpotModule.sol:167 DAILY_CARRYOVER_MAX_OFFSET=4"
                ),
            )
        ],
        sample_context=SampleContext(
            day=0,
            level=0,
            archetype=None,
            lag_blocks=0,
            lag_unreliable=False,
            sampled_at=_utc_now_iso(),
        ),
        notes="Source-level only. API validation uses +4 (contract value).",
    )
    append_discrepancy(yaml_path, entry)
    return True


# ---------------------------------------------------------------------------
# validate_jackpot_03
# ---------------------------------------------------------------------------


def validate_jackpot_03(
    day: int,
    client: EndpointClient,
    *,
    lag_snapshot: HealthSnapshot,
) -> list[Discrepancy]:
    """Validate Roll 2 classification + per-player aggregation for ``day``."""
    endpoint = f"/game/jackpot/day/{day}/roll2"
    entries: list[Discrepancy] = []

    try:
        roll2 = client.get_roll2(day)
    except Exception as exc:
        sev = "Minor" if lag_snapshot.lag_unreliable else "Major"
        return [
            Discrepancy(
                id=f"JACKPOT-03-day{day}-fetch-error",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="<200 OK roll2 payload or 404>",
                derivation=_derivation_roll2(),
                observed_value=f"<fetch error: {type(exc).__name__}>",
                magnitude="fetch failure",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="roll2 endpoint non-2xx (not 404) or network error",
                        falsifiable_by=f"curl {endpoint} and inspect",
                    )
                ],
                sample_context=_make_sample_ctx(day, None, lag_snapshot),
            )
        ]

    if roll2 is None:
        # 404: no carryover distributions (post-gameover or compressed day).
        sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
        return [
            Discrepancy(
                id=f"JACKPOT-03-day{day}-roll2-404",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="roll2 payload OR deliberate 404",
                derivation=_derivation_roll2(),
                observed_value="HTTP 404 (no roll2 distributions)",
                magnitude="coverage gap — not applicable",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=(
                            "no carryover distributions — compressed/turbo day "
                            "or post-gameover"
                        ),
                        falsifiable_by=(
                            f"check /game/state and /history/levels for day {day}"
                        ),
                    )
                ],
                sample_context=_make_sample_ctx(day, None, lag_snapshot),
                notes="Per CONTEXT Decision 2, 404 is treated as N/A not violation",
            )
        ]

    purchase_level = roll2.get("purchaseLevel")
    level = roll2.get("level")
    wins: list[dict[str, Any]] = roll2.get("wins") or []

    if purchase_level is None:
        sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
        return [
            Discrepancy(
                id=f"JACKPOT-03-day{day}-null-purchaselevel",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="purchaseLevel integer",
                derivation=_derivation_roll2(),
                observed_value="null",
                magnitude="coverage gap",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="indexer null-fills purchaseLevel post-gameover",
                        falsifiable_by=f"curl {endpoint} and inspect",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        ]

    # Classification (only for ETH wins with non-null sourceLevel).
    violations: list[dict[str, Any]] = []
    near_count = 0
    far_count = 0
    null_source_count = 0
    sentinel_count = 0
    for win in wins:
        if win.get("awardType") != "eth":
            continue
        ticket_idx = win.get("ticketIndex")
        if ticket_idx is not None and ticket_idx == (1 << 256) - 1:
            sentinel_count += 1
            continue
        sl = win.get("sourceLevel")
        if sl is None:
            null_source_count += 1
            continue
        sl_int = int(sl)
        pl_int = int(purchase_level)
        if sl_int <= pl_int:
            violations.append(win)
        elif sl_int <= pl_int + CARRYOVER_MAX_OFFSET:
            near_count += 1
        else:
            far_count += 1

    if violations:
        sev = _downgrade("Major") if lag_snapshot.lag_unreliable else "Major"
        first = violations[0]
        entries.append(
            Discrepancy(
                id=f"JACKPOT-03-day{day}-roll2-misclassified",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value=(
                    f"sourceLevel > purchaseLevel ({purchase_level}) for all Roll 2 ETH wins"
                ),
                derivation=_derivation_roll2(),
                observed_value=(
                    f"{len(violations)} wins with sourceLevel <= purchaseLevel; "
                    f"first: sourceLevel={first.get('sourceLevel')}, "
                    f"ticketIndex={first.get('ticketIndex')}"
                ),
                magnitude=f"{len(violations)} misclassified as Roll 2",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=(
                            "indexer tagged a Roll 1 row as Roll 2 or emits wrong sourceLevel"
                        ),
                        falsifiable_by=(
                            "re-index day from chain and compare against "
                            "JackpotModule _distributeRoll2 emissions"
                        ),
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )

    if null_source_count > 0:
        sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-03-day{day}-roll2-null-sourcelevel",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="sourceLevel set on every Roll 2 ETH win",
                derivation=_derivation_roll2(),
                observed_value=f"{null_source_count}/{len(wins)} wins have sourceLevel=null",
                magnitude="coverage gap",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="indexer omits sourceLevel on Roll 2 rows",
                        falsifiable_by=f"curl {endpoint} and count null sourceLevel",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
                notes=(
                    f"near_count={near_count} far_count={far_count} "
                    f"classification incomplete"
                ),
            )
        )

    if sentinel_count > 0:
        entries.append(
            Discrepancy(
                id=f"JACKPOT-03-day{day}-roll2-sentinel-ticketindex",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="<informational only>",
                derivation=_derivation_roll2(),
                observed_value=f"{sentinel_count} deity virtual entries",
                magnitude="info note",
                severity="Info",
                suspected_source="contract",
                hypothesis=[
                    Hypothesis(
                        text="deity virtual entries tolerated per contract semantics",
                        falsifiable_by="inspect JackpotModule deity virtual path",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )

    # Aggregation check (ETH-only; same as JACKPOT-02 but cross-sourced with roll1).
    try:
        winners_payload = client.get_jackpot_winners(day)
    except Exception as exc:
        sev = "Minor" if lag_snapshot.lag_unreliable else "Major"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-03-day{day}-winners-fetch-error",
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
        roll1 = client.get_roll1(day)
    except Exception:
        roll1 = None

    try:
        recon = reconcile_player_totals(winners_payload, roll1, roll2)
    except ValueError as exc:
        entries.append(
            Discrepancy(
                id=f"JACKPOT-03-day{day}-oversized-payload",
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
                        text="indexer returned oversized array",
                        falsifiable_by="inspect len(wins[])",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )
        return entries

    if recon.issues:
        sev = _downgrade("Critical") if lag_snapshot.lag_unreliable else "Critical"
        n_mis = sum(1 for i in recon.issues if i.kind == "mismatch")
        n_miss = sum(1 for i in recon.issues if i.kind == "missing_address")
        first = recon.issues[0]
        entries.append(
            Discrepancy(
                id=f"JACKPOT-03-day{day}-aggregation-mismatch",
                domain="JACKPOT",
                endpoint=f"/game/jackpot/day/{day}/winners",
                expected_value="exact-wei per-address total == sum(roll1+roll2 ETH)",
                derivation=_derivation_aggregation(),
                observed_value=(
                    f"mismatches={n_mis} missing_addrs={n_miss} "
                    f"first_kind={first.kind}"
                ),
                magnitude=f"{n_mis + n_miss} per-player reconciliation failures",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="indexer sums diverge from chain rollup",
                        falsifiable_by="re-derive per-address sums from /roll1 + /roll2",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )

    return entries
