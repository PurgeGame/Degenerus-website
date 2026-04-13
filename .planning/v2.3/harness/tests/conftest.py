"""Shared pytest fixtures for the v2.3 derivation harness.

Extended by 18-02 (derivation fixtures) and 18-03 (schema / api / render
fixtures). This file only imports from modules that exist as of 18-01.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from harness.constants import Citation, Constant
from harness.archetypes import ARCHETYPES


@pytest.fixture
def tmp_yaml_path(tmp_path: Path) -> Path:
    """Path to a per-test discrepancies.yaml inside pytest's tmp_path."""
    return tmp_path / "discrepancies.yaml"


@pytest.fixture
def sample_citation() -> Citation:
    """Citation pointing at a real line in the canonical contract source."""
    return Citation(
        path="degenerus-audit/contracts/DegenerusGame.sol",
        line=160,
        label="contract",
        anchor=None,
    )


@pytest.fixture
def sample_constant(sample_citation: Citation) -> Constant:
    """Small BPS Constant stub for schema / derive tests."""
    return Constant(
        name="PURCHASE_TO_FUTURE_BPS",
        value=1000,
        unit="bps",
        citation=sample_citation,
        notes="Ticket purchase split: 10% to futurePool, 90% to nextPool.",
    )


@pytest.fixture
def sample_archetype():
    """The Whale ArchetypeProfile."""
    return ARCHETYPES["Whale"]
