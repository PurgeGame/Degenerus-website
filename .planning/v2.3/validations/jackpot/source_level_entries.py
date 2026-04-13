"""One-shot source-level Discrepancy writers for Phase 19-04.

These writers are idempotent: calling the `ensure_*` functions repeatedly
leaves exactly one entry per fixed id in the YAML. Pattern:
``load_discrepancies`` -> filter by id -> skip or append.

Entries owned here:

- ``HISTORY-JACKPOTS-500-bug`` — ``/history/jackpots`` returns 500.
- ``JACKPOT-06-coverage-gap-hero-wagers`` — ``dailyHeroWagers`` is
  storage-only; no endpoint or event exposes per-day per-quadrant
  per-symbol wager totals; JACKPOT-06 is permanently inferential for
  this milestone.
"""

from __future__ import annotations

from harness import (
    Citation,
    Derivation,
    Discrepancy,
    Hypothesis,
    SampleContext,
    append_discrepancy,
    load_discrepancies,
)
from harness.api import _utc_now_iso


_JACKPOT_MODULE = "degenerus-audit/contracts/modules/DegenerusGameJackpotModule.sol"
_STORAGE = "degenerus-audit/contracts/storage/DegenerusGameStorage.sol"

DEFAULT_DISCREPANCIES_PATH = ".planning/v2.3/discrepancies.yaml"

HISTORY_JACKPOTS_500_ID = "HISTORY-JACKPOTS-500-bug"
JACKPOT_06_COVERAGE_GAP_ID = "JACKPOT-06-coverage-gap-hero-wagers"


def _zero_ctx() -> SampleContext:
    return SampleContext(
        day=0,
        level=0,
        archetype=None,
        lag_blocks=0,
        lag_unreliable=False,
        sampled_at=_utc_now_iso(),
    )


def _already_present(path: str, entry_id: str) -> bool:
    for d in load_discrepancies(path):
        if d.id == entry_id:
            return True
    return False


def ensure_history_jackpots_500_logged(
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> bool:
    """Append the ``/history/jackpots`` 500 bug entry iff missing.

    Returns True on append, False on idempotent skip.
    """
    if _already_present(yaml_path, HISTORY_JACKPOTS_500_ID):
        return False

    entry = Discrepancy(
        id=HISTORY_JACKPOTS_500_ID,
        domain="JACKPOT",
        endpoint="/history/jackpots",
        expected_value="200 OK with jackpot history list",
        derivation=Derivation(
            formula="endpoint contract (indexer-exposed history list)",
            sources=[
                Citation(
                    path=_JACKPOT_MODULE,
                    line=127,
                    label="contract",
                    anchor="range-discovery",
                )
            ],
        ),
        observed_value=(
            "500 Internal Server Error: "
            "'Cannot convert undefined or null to object'"
        ),
        magnitude="endpoint unusable for range discovery",
        severity="Minor",
        suspected_source="indexer",
        hypothesis=[
            Hypothesis(
                text=(
                    "indexer handler dereferences a null/undefined object "
                    "when constructing the history response"
                ),
                falsifiable_by=(
                    "fix the indexer handler and observe a 200 response "
                    "with valid schema"
                ),
            )
        ],
        sample_context=_zero_ctx(),
        notes=(
            "Discovered during Phase 19 research probes 2026-04-13. "
            "Workaround: use /game/jackpot/earliest-day + /game/jackpot/latest-day."
        ),
    )
    append_discrepancy(yaml_path, entry)
    return True


def ensure_jackpot_06_coverage_gap_logged(
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> bool:
    """Append the JACKPOT-06 hero-override coverage-gap entry iff missing.

    Returns True on append, False on idempotent skip.
    """
    if _already_present(yaml_path, JACKPOT_06_COVERAGE_GAP_ID):
        return False

    entry = Discrepancy(
        id=JACKPOT_06_COVERAGE_GAP_ID,
        domain="JACKPOT",
        endpoint="(no endpoint — dailyHeroWagers is storage-only)",
        expected_value=(
            "per-day per-quadrant per-symbol wager totals exposed via API or event"
        ),
        derivation=Derivation(
            formula=(
                "contract stores wagers in dailyHeroWagers[day][quadrant]; "
                "_applyHeroOverride mutates trait silently (no event)"
            ),
            sources=[
                Citation(path=_JACKPOT_MODULE, line=1558, label="contract"),
                Citation(path=_STORAGE, line=1458, label="contract"),
            ],
        ),
        observed_value=(
            "no endpoint exposes dailyHeroWagers; "
            "no HeroOverrideApplied event emitted"
        ),
        magnitude="permanent coverage gap for JACKPOT-06 direct validation",
        severity="Info",
        suspected_source="api",
        hypothesis=[
            Hypothesis(
                text=(
                    "indexer schema does not surface dailyHeroWagers; "
                    "direct hero-override validation is impossible this milestone"
                ),
                falsifiable_by=(
                    "indexer adds dailyHeroWagers exposure OR contract emits "
                    "HeroOverrideApplied(day, quadrant, symbol)"
                ),
            )
        ],
        sample_context=_zero_ctx(),
        notes=(
            "Permanent gap for this milestone. All per-day JACKPOT-06 results "
            "are inferential (single-quadrant mismatch + symbol<8)."
        ),
    )
    append_discrepancy(yaml_path, entry)
    return True
