"""JACKPOT-04 validator: BURNIE 75/25 split + center-diamond check.

Contract canonical (``degenerus-audit/contracts/``):

- ``modules/DegenerusGameJackpotModule.sol:1897-1901`` — BURNIE budget
- ``modules/DegenerusGameJackpotModule.sol:594-612, 1684-1711`` — 75/25
  near/far split; far-future rows have ``traitId=null`` and target a
  future ticket queue ("center diamond" terminology).

Per RESEARCH Pitfall #4: individual BURNIE ``amount`` rows are integer
floor-division of the budget and may drift by ±1 wei per row. Aggregate
(sum across all rows) is exact. We validate aggregates only; per-row
drift is tolerated silently.

The ``breakdown[]`` rows carry ``amount`` = wei per entry and
``count`` = number of entries. Aggregate BURNIE wei = Σ amount × count.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from harness import (
    Citation,
    Derivation,
    Discrepancy,
    HealthSnapshot,
    Hypothesis,
    SampleContext,
)

from validations.jackpot.burnie_budget import (
    FAR_FUTURE_COIN_BPS,
    check_near_far_ratio,
)
from validations.jackpot.endpoints import EndpointClient


_CONTRACT_PATH = "degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol"
_BUDGET_LINE = 1897
_SPLIT_LINE = 594

_SEVERITY_ORDER = ("Critical", "Major", "Minor", "Info")


def _downgrade(severity: str) -> str:
    try:
        idx = _SEVERITY_ORDER.index(severity)
    except ValueError:
        return severity
    return _SEVERITY_ORDER[min(idx + 1, len(_SEVERITY_ORDER) - 1)]


def _derivation() -> Derivation:
    return Derivation(
        formula=(
            "BURNIE split: FAR_FUTURE_COIN_BPS=2500 (25% traitId=null) / "
            "7500 (75% near-future trait-matched); aggregate = Σ amount × count"
        ),
        sources=[
            Citation(path=_CONTRACT_PATH, line=_SPLIT_LINE, label="contract"),
            Citation(path=_CONTRACT_PATH, line=_BUDGET_LINE, label="contract"),
        ],
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


def _row_amount_wei(row: dict[str, Any]) -> int:
    """Parse ``amount`` as int; tolerate string or int. Multiply by count.

    T-19-03-01: raise on scientific-notation floats with a scrubbed message.
    """
    raw = row.get("amount")
    if raw is None:
        raise ValueError("BURNIE row missing amount")
    if isinstance(raw, float):
        raise ValueError("BURNIE amount parsed as float (scientific-notation risk)")
    try:
        amt = int(raw)
    except (TypeError, ValueError):
        raise ValueError("BURNIE amount could not be parsed as integer")
    cnt = int(row.get("count", 1) or 1)
    return amt * cnt


def validate_jackpot_04(
    day: int,
    client: EndpointClient,
    *,
    lag_snapshot: HealthSnapshot,
) -> list[Discrepancy]:
    """Validate BURNIE 75/25 split and center-diamond shape for ``day``."""
    endpoint = f"/game/jackpot/day/{day}/winners"
    entries: list[Discrepancy] = []

    try:
        winners_payload = client.get_jackpot_winners(day)
    except Exception as exc:
        sev = "Minor" if lag_snapshot.lag_unreliable else "Major"
        return [
            Discrepancy(
                id=f"JACKPOT-04-day{day}-fetch-error",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="<200 OK winners payload>",
                derivation=_derivation(),
                observed_value=f"<fetch error: {type(exc).__name__}>",
                magnitude="fetch failure",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="winners endpoint non-2xx or network error",
                        falsifiable_by=f"curl {endpoint} and inspect",
                    )
                ],
                sample_context=_make_sample_ctx(day, None, lag_snapshot),
            )
        ]

    level = winners_payload.get("level")
    winners = winners_payload.get("winners") or []

    # Gather all BURNIE rows with their winner record (so we can
    # validate the center-diamond pairing: traitId=null ↔ winnerLevel set).
    near_sum = 0
    far_sum = 0
    center_diamond_violations: list[str] = []

    for w in winners:
        winner_level = w.get("winningLevel")
        for row in w.get("breakdown") or []:
            if row.get("awardType") != "burnie":
                continue
            tid = row.get("traitId")
            try:
                wei = _row_amount_wei(row)
            except ValueError as exc:
                entries.append(
                    Discrepancy(
                        id=f"JACKPOT-04-day{day}-amount-parse-error",
                        domain="JACKPOT",
                        endpoint=endpoint,
                        expected_value="integer BURNIE amount",
                        derivation=_derivation(),
                        observed_value=str(exc),
                        magnitude="parse failure",
                        severity="Major",
                        suspected_source="api",
                        hypothesis=[
                            Hypothesis(
                                text="indexer emits non-integer BURNIE amount",
                                falsifiable_by=(
                                    "inspect row shape in /winners payload"
                                ),
                            )
                        ],
                        sample_context=_make_sample_ctx(day, level, lag_snapshot),
                    )
                )
                continue
            if tid is None:
                far_sum += wei
                # Center-diamond: traitId=null MUST have winnerLevel set.
                if winner_level is None:
                    center_diamond_violations.append(
                        f"winnerLevel=null for far-future BURNIE row wei={wei}"
                    )
            else:
                near_sum += wei
                # Inverse: traitId set but winnerLevel null is also suspicious
                # for BURNIE near-future rows, but the contract does not
                # require winningLevel on near-future winners explicitly — we
                # do NOT flag that case.

    total = near_sum + far_sum
    if total == 0:
        # Empty BURNIE day — Info coverage gap (not a violation).
        sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-04-day{day}-no-burnie",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="BURNIE rows present",
                derivation=_derivation(),
                observed_value="no BURNIE breakdown rows",
                magnitude="coverage gap",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=(
                            "day had no BURNIE phase (purchase-phase day or "
                            "non-jackpot phase)"
                        ),
                        falsifiable_by=f"inspect /game/state for day {day}",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )
        return entries

    # 75/25 ratio check with tiered severity.
    ratio_ok, delta = check_near_far_ratio(near_sum, far_sum, tol_bps=200)
    delta_pct = float(delta) * 100.0
    if not ratio_ok:
        # Beyond 2%
        if delta <= Decimal("0.05"):
            sev = _downgrade("Minor") if lag_snapshot.lag_unreliable else "Minor"
        else:
            sev = _downgrade("Major") if lag_snapshot.lag_unreliable else "Major"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-04-day{day}-ratio-drift",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value=f"far_ratio = {FAR_FUTURE_COIN_BPS / 10_000:.4f} (±2%)",
                derivation=_derivation(),
                observed_value=(
                    f"near={near_sum} far={far_sum} far_ratio="
                    f"{float(Decimal(far_sum) / Decimal(total)):.4f} "
                    f"(delta={delta_pct:.2f}%)"
                ),
                magnitude=f"|far_ratio - 0.25| = {delta_pct:.2f}%",
                severity=sev,
                suspected_source="contract",
                hypothesis=[
                    Hypothesis(
                        text=(
                            "FAR_FUTURE_COIN_BPS drift or indexer miscounts "
                            "near vs far BURNIE rows"
                        ),
                        falsifiable_by=(
                            "re-read JackpotModule.sol:594-612 and recount "
                            "traitId=null vs set"
                        ),
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )
    elif delta > Decimal("0.01"):
        # Within 2% but beyond 1% → Info log (not silent).
        sev = "Info"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-04-day{day}-ratio-info",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value=f"far_ratio = 0.25 (within 1%)",
                derivation=_derivation(),
                observed_value=(
                    f"far_ratio={float(Decimal(far_sum) / Decimal(total)):.4f}"
                ),
                magnitude=f"within 2% tolerance (delta={delta_pct:.2f}%)",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="BURNIE ratio within acceptance band; logged for audit trail",
                        falsifiable_by="N/A (informational)",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )
    # else: delta <= 1% → silent PASS (suppressed per plan).

    # Center-diamond shape violations.
    if center_diamond_violations:
        sev = _downgrade("Major") if lag_snapshot.lag_unreliable else "Major"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-04-day{day}-center-diamond-shape",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value=(
                    "every far-future BURNIE row (traitId=null) has "
                    "winningLevel set on parent winner"
                ),
                derivation=_derivation(),
                observed_value=(
                    f"{len(center_diamond_violations)} far-future rows with "
                    f"null winningLevel; first: {center_diamond_violations[0]}"
                ),
                magnitude=f"{len(center_diamond_violations)} shape violations",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=(
                            "indexer omits winningLevel for center-diamond "
                            "BURNIE far-future rows"
                        ),
                        falsifiable_by=(
                            "curl /game/jackpot/day/N/winners and inspect "
                            "winningLevel on parent of traitId=null rows"
                        ),
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )

    # Absolute budget check coverage gap: levelPrizePool[lvl-1] is not
    # exposed by any endpoint per 19-RESEARCH. Log once per day.
    sev = "Info"
    entries.append(
        Discrepancy(
            id=f"JACKPOT-04-day{day}-level-prize-pool-unavailable",
            domain="JACKPOT",
            endpoint=endpoint,
            expected_value=(
                "absolute BURNIE budget = (levelPrizePool[lvl-1] * "
                "1000e18) / (priceWei * 200)"
            ),
            derivation=_derivation(),
            observed_value=(
                f"aggregate near+far BURNIE = {total} (wei-scale); "
                "no endpoint exposes levelPrizePool"
            ),
            magnitude="coverage gap (absolute budget fallback to ratio-only)",
            severity=sev,
            suspected_source="api",
            hypothesis=[
                Hypothesis(
                    text=(
                        "endpoint does not expose levelPrizePool; absolute "
                        "BURNIE budget check falls back to ratio-only"
                    ),
                    falsifiable_by=(
                        "indexer adds levelPrizePool to /game/jackpot/:level"
                        "/overview or /history/levels"
                    ),
                )
            ],
            sample_context=_make_sample_ctx(day, level, lag_snapshot),
        )
    )

    return entries
