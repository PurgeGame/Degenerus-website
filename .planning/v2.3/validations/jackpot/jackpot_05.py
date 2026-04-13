"""JACKPOT-05 validator: bonus-roll per-quadrant + hasBonus eligibility.

Contract canonical (``degenerus-audit/contracts/``):

- ``modules/DegenerusGameJackpotModule.sol:1884-1894`` — bonus trait
  derivation via ``keccak256(randWord, BONUS_TRAITS_TAG)``.
- ``modules/DegenerusGameJackpotModule.sol:594-612, 602-603`` — bonus
  BURNIE flows: 75% near-future at single targetLevel
  ``lvl + 1 + (coinEntropy % 4)``, 25% far-future (traitId=null).
- ``modules/DegenerusGameJackpotModule.sol:585-642`` — ticketQueue routing.

**Scope note (Rule 1 deviation from plan):** Plan step 5 said "every
breakdown row of a bonus winner must have ``traitId is None`` or
``traitId in bonus_traits``." That's wrong — a ``hasBonus=true`` winner
can simultaneously win a main-trait ETH prize (Roll 1) and a
bonus-trait BURNIE prize (bonus distribution). The trait-set membership
rule applies ONLY to BURNIE rows of bonus winners. Main ETH rows are
valid with main traits. Implementing the correct rule and noting the
deviation in 19-03-SUMMARY.md.
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

from validations.jackpot.endpoints import EndpointClient
from validations.jackpot.trait_derivation import expected_bonus_traits, quadrant_of


_CONTRACT_PATH = "degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol"
_BONUS_TAG_LINE = 1884
_BONUS_TARGET_LINE = 602

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
            "bonus_traits = getRandomTraits(keccak256(randWord, BONUS_TRAITS_TAG)); "
            "bonus targetLevel = lvl + 1 + (coinEntropy % 4) — SINGLE level"
        ),
        sources=[
            Citation(path=_CONTRACT_PATH, line=_BONUS_TAG_LINE, label="contract"),
            Citation(path=_CONTRACT_PATH, line=_BONUS_TARGET_LINE, label="contract"),
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


def _row_wei(row: dict[str, Any]) -> int:
    raw = row.get("amount")
    if raw is None:
        return 0
    if isinstance(raw, float):
        raise ValueError("amount parsed as float")
    return int(raw) * int(row.get("count", 1) or 1)


def _hash_addr(addr: str | None) -> str:
    """T-19-03-02: hash address for debug logs (first 6 hex + ellipsis)."""
    if not addr:
        return "<none>"
    return f"{addr[:8]}..."


def validate_jackpot_05(
    day: int,
    client: EndpointClient,
    *,
    lag_snapshot: HealthSnapshot,
) -> list[Discrepancy]:
    """Validate bonus-roll eligibility + per-quadrant totals for ``day``."""
    endpoint = f"/game/jackpot/day/{day}/winners"
    entries: list[Discrepancy] = []

    # 1. finalWord
    final_word = client.get_final_word(day)
    if final_word is None:
        sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
        return [
            Discrepancy(
                id=f"JACKPOT-05-day{day}-missing-finalword",
                domain="JACKPOT",
                endpoint="/replay/rng",
                expected_value=f"finalWord for day {day}",
                derivation=_derivation(),
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
                sample_context=_make_sample_ctx(day, None, lag_snapshot),
                notes="JACKPOT-05 cannot derive expected bonus traits",
            )
        ]

    bonus_traits = set(expected_bonus_traits(final_word))

    # 2. winners
    try:
        winners_payload = client.get_jackpot_winners(day)
    except Exception as exc:
        sev = "Minor" if lag_snapshot.lag_unreliable else "Major"
        return [
            Discrepancy(
                id=f"JACKPOT-05-day{day}-fetch-error",
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
                        falsifiable_by=f"curl {endpoint}",
                    )
                ],
                sample_context=_make_sample_ctx(day, None, lag_snapshot),
            )
        ]

    level = winners_payload.get("level")
    bonus_winners = [
        w for w in (winners_payload.get("winners") or []) if w.get("hasBonus") is True
    ]

    if not bonus_winners:
        sev = _downgrade("Info") if lag_snapshot.lag_unreliable else "Info"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-05-day{day}-no-bonus-winners",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="≥1 winner with hasBonus=true OR no bonus phase fired",
                derivation=_derivation(),
                observed_value="0 hasBonus=true winners",
                magnitude="coverage gap",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="bonus phase did not fire or no eligible holders",
                        falsifiable_by=f"inspect /game/state for day {day}",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )
        return entries

    # 3. Per-winner breakdown validation (BURNIE rows only, per scope note).
    #    Track wrong-trait rows, and whether hasBonus winner has ANY bonus
    #    breakdown at all.
    wrong_trait_rows: list[str] = []
    winners_without_bonus_breakdown: list[str] = []
    bonus_target_levels: set[int] = set()

    # Per-quadrant aggregation (bonus BURNIE rows only, with traitId set).
    per_quadrant_burnie: dict[int, int] = {0: 0, 1: 0, 2: 0, 3: 0}
    per_quadrant_eth: dict[int, int] = {0: 0, 1: 0, 2: 0, 3: 0}
    per_quadrant_tickets: dict[int, int] = {0: 0, 1: 0, 2: 0, 3: 0}
    total_bonus_breakdown_wei = 0

    for w in bonus_winners:
        wlvl = w.get("winningLevel")
        if wlvl is not None:
            bonus_target_levels.add(int(wlvl))
        addr = w.get("address")
        rows = w.get("breakdown") or []
        has_bonus_row = False

        for row in rows:
            at = row.get("awardType")
            tid = row.get("traitId")

            # Only BURNIE rows are in scope for bonus trait-set membership.
            if at == "burnie":
                if tid is None:
                    # Far-future BURNIE — always valid for bonus winners.
                    has_bonus_row = True
                elif int(tid) in bonus_traits:
                    has_bonus_row = True
                    q = quadrant_of(int(tid))
                    try:
                        per_quadrant_burnie[q] += _row_wei(row)
                    except ValueError:
                        pass
                    total_bonus_breakdown_wei += _row_wei(row) if not isinstance(
                        row.get("amount"), float
                    ) else 0
                else:
                    wrong_trait_rows.append(
                        f"addr={_hash_addr(addr)} traitId={tid} (not in bonus set {sorted(bonus_traits)})"
                    )
            elif at == "eth" and tid is not None and int(tid) in bonus_traits:
                # A bonus-trait ETH row IS a bonus distribution row.
                has_bonus_row = True
                q = quadrant_of(int(tid))
                try:
                    per_quadrant_eth[q] += _row_wei(row)
                except ValueError:
                    pass
                total_bonus_breakdown_wei += _row_wei(row)
            elif at == "tickets" and tid is not None and int(tid) in bonus_traits:
                has_bonus_row = True
                q = quadrant_of(int(tid))
                per_quadrant_tickets[q] += int(row.get("count", 1) or 1)
            # Other rows (main ETH, main tickets, etc.) are out of scope.

        if not has_bonus_row:
            winners_without_bonus_breakdown.append(_hash_addr(addr))

    # 4. Wrong-trait rows → Major
    if wrong_trait_rows:
        sev = _downgrade("Major") if lag_snapshot.lag_unreliable else "Major"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-05-day{day}-wrong-bonus-trait",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value=f"BURNIE traitIds ∈ {sorted(bonus_traits)} ∪ {{null}}",
                derivation=_derivation(),
                observed_value=(
                    f"{len(wrong_trait_rows)} rows with trait outside bonus set; "
                    f"first: {wrong_trait_rows[0]}"
                ),
                magnitude=f"{len(wrong_trait_rows)} wrong-trait bonus rows",
                severity=sev,
                suspected_source="contract",
                hypothesis=[
                    Hypothesis(
                        text=(
                            "BONUS_TRAITS_TAG encoding differs from Python "
                            "abi.encodePacked emulation OR indexer mislabels "
                            "bonus BURNIE rows"
                        ),
                        falsifiable_by=(
                            "re-derive expected_bonus_traits(finalWord) and "
                            "compare vs observed BURNIE traitIds"
                        ),
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
                notes=(
                    "Report-only — do NOT patch trait_derivation; this is "
                    "the phase signal for a contract-vs-python divergence."
                ),
            )
        )

    # 5. hasBonus without any bonus-breakdown row → Major
    if winners_without_bonus_breakdown:
        sev = _downgrade("Major") if lag_snapshot.lag_unreliable else "Major"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-05-day{day}-hasbonus-without-breakdown",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="every hasBonus=true winner has ≥1 bonus-trait or null row",
                derivation=_derivation(),
                observed_value=(
                    f"{len(winners_without_bonus_breakdown)} winners missing "
                    f"bonus breakdown; first: {winners_without_bonus_breakdown[0]}"
                ),
                magnitude=f"{len(winners_without_bonus_breakdown)} flagless hasBonus winners",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="indexer sets hasBonus=true but omits bonus breakdown rows",
                        falsifiable_by="inspect raw chain events for day",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )

    # 6. Single-targetLevel concentration check (plan step 7).
    if len(bonus_target_levels) > 1:
        sev = _downgrade("Minor") if lag_snapshot.lag_unreliable else "Minor"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-05-day{day}-bonus-multiple-levels",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value=(
                    "all bonus winners share ONE winningLevel ∈ [lvl+1, lvl+4]"
                ),
                derivation=_derivation(),
                observed_value=f"distinct winningLevels: {sorted(bonus_target_levels)}",
                magnitude=f"{len(bonus_target_levels)} distinct bonus levels",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=(
                            "contract says bonus targetLevel is a SINGLE level "
                            "lvl+1+(entropy%4); observed spread may indicate "
                            "winningLevel field semantics differ (sourceLevel "
                            "per RESEARCH Pitfall #6) or indexer miscounts"
                        ),
                        falsifiable_by=(
                            "inspect /game/jackpot/:level distributions and "
                            "confirm bonus rows all at a single target level"
                        ),
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
                notes=(
                    "winningLevel on winner record may reflect Roll 1 "
                    "sourceLevel, not bonus targetLevel — see RESEARCH #6"
                ),
            )
        )

    # 7. Per-quadrant reconciliation: internal consistency only.
    #    Since levelPrizePool is not exposed, we check that per-quadrant
    #    sums are non-negative and reconcile to the grand total within
    #    integer precision.
    pq_sum = (
        sum(per_quadrant_burnie.values())
        + sum(per_quadrant_eth.values())
    )
    if pq_sum != total_bonus_breakdown_wei:
        # Defensive only; should be exact under our aggregation.
        sev = _downgrade("Minor") if lag_snapshot.lag_unreliable else "Minor"
        entries.append(
            Discrepancy(
                id=f"JACKPOT-05-day{day}-per-quadrant-imbalance",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value="Σ per_quadrant == grand_total (exact)",
                derivation=_derivation(),
                observed_value=(
                    f"per_quadrant_sum={pq_sum} grand_total={total_bonus_breakdown_wei}"
                ),
                magnitude="per-quadrant aggregation imbalance",
                severity=sev,
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text="aggregation rounding / quadrant derivation bug",
                        falsifiable_by="re-derive quadrant_of(traitId)",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )

    # 8. Per-quadrant Info summary (one entry if any bonus flows observed).
    if total_bonus_breakdown_wei > 0:
        entries.append(
            Discrepancy(
                id=f"JACKPOT-05-day{day}-per-quadrant-summary",
                domain="JACKPOT",
                endpoint=endpoint,
                expected_value=(
                    "per-quadrant bonus totals (internal consistency check)"
                ),
                derivation=_derivation(),
                observed_value=(
                    f"burnie={per_quadrant_burnie} "
                    f"eth={per_quadrant_eth} "
                    f"tickets={per_quadrant_tickets}"
                ),
                magnitude="informational summary",
                severity="Info",
                suspected_source="api",
                hypothesis=[
                    Hypothesis(
                        text=(
                            "per-quadrant totals logged for audit trail; "
                            "absolute derivation blocked by levelPrizePool gap"
                        ),
                        falsifiable_by="N/A (informational)",
                    )
                ],
                sample_context=_make_sample_ctx(day, level, lag_snapshot),
            )
        )

    return entries
