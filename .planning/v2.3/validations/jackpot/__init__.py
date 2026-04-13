"""JACKPOT domain validators.

Public surface (imported by 19-02..04 and the Phase 19 run driver)::

    from validations.jackpot import (
        SAMPLE_DAYS_CORE,
        extend_with_hero_candidate,
        EndpointClient,
        expected_main_traits,
        expected_bonus_traits,
        quadrant_of,
        validate_jackpot_01,
    )

Canonical contract source: ``degenerus-audit/contracts/``.
"""

from validations.jackpot.sample_days import (
    SAMPLE_DAYS_CORE,
    extend_with_hero_candidate,
)
from validations.jackpot.endpoints import EndpointClient, run_with_health_check
from validations.jackpot.trait_derivation import (
    expected_main_traits,
    expected_bonus_traits,
    quadrant_of,
    BONUS_TRAITS_TAG,
)
from validations.jackpot.jackpot_01 import validate_jackpot_01

__all__ = [
    "SAMPLE_DAYS_CORE",
    "extend_with_hero_candidate",
    "EndpointClient",
    "run_with_health_check",
    "expected_main_traits",
    "expected_bonus_traits",
    "quadrant_of",
    "BONUS_TRAITS_TAG",
    "validate_jackpot_01",
]
