"""Degenerus v2.3 expected-value derivation harness.

Public import surface for phases 19-22::

    from harness import (
        expected_values,
        check_api_health,
        Discrepancy,
        load_discrepancies,
        save_discrepancies,
        append_discrepancy,
        render_report,
        DerivedValues,
        HealthSnapshot,
    )
"""

from __future__ import annotations

__version__ = "0.1.0"

from harness.api import HealthSnapshot, check_api_health, get_json
from harness.derive import DerivedField, DerivedValues, expected_values
from harness.render import render_report
from harness.schema import (
    Citation,
    Derivation,
    Discrepancy,
    Hypothesis,
    SampleContext,
)
from harness.yaml_io import append_discrepancy, load_discrepancies, save_discrepancies

__all__ = [
    "__version__",
    # api
    "check_api_health",
    "get_json",
    "HealthSnapshot",
    # derive
    "expected_values",
    "DerivedValues",
    "DerivedField",
    # schema
    "Discrepancy",
    "Citation",
    "Derivation",
    "Hypothesis",
    "SampleContext",
    # yaml_io
    "load_discrepancies",
    "save_discrepancies",
    "append_discrepancy",
    # render
    "render_report",
]
