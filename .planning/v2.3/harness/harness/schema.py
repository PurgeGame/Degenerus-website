"""Pydantic Discrepancy schema (METHOD-03/METHOD-04).

Every discrepancy logged by phases 19-22 instantiates a ``Discrepancy``.
Required fields and allowed source values are enforced at validation time
(no runtime-only checks). See CONTEXT.md Decision 4: the whitepaper is
NOT a tracked comparison source; ``suspected_source="whitepaper"`` is
rejected at the schema level.

Per user directive: velocity regimes are ``fast`` and ``runout`` (not
turbo/standard). Expected divergences between regimes are tagged
``expected_fast_regime_divergence`` or ``expected_runout_divergence``.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


Domain = Literal["JACKPOT", "POOLS", "PLAYER", "TERMINAL"]
Severity = Literal["Critical", "Major", "Minor", "Info"]
SuspectedSource = Literal[
    "gt_paper",
    "contract",
    "api",
    "indexer",
    "expected_fast_regime_divergence",
    "expected_runout_divergence",
]
# NOTE: "whitepaper" deliberately excluded (CONTEXT.md Decision 4).
# NOTE: "expected_turbo_divergence" / "expected_standard_divergence" also excluded
#       per user directive: regime names are fast/runout, not turbo/standard.
Archetype = Literal["Degen", "Grinder", "Whale", "Hybrid", "Deity"]
CitationLabel = Literal["contract", "gt_paper", "audit_doc"]


_FORBIDDEN_PATH_FRAGMENTS = (
    "testing/contracts",
    "degenerus-contracts",
    "v1.1-ECONOMICS-PRIMER",
)


class Citation(BaseModel):
    path: str
    line: int | None = None
    anchor: str | None = None
    label: CitationLabel

    @field_validator("path")
    @classmethod
    def no_stale_paths(cls, v: str) -> str:
        for frag in _FORBIDDEN_PATH_FRAGMENTS:
            if frag in v:
                raise ValueError(
                    f"non-canonical citation path: {v!r} contains {frag!r} "
                    f"(allowed roots: degenerus-audit/contracts/, degenerus-audit/audit/, theory/index.html)"
                )
        return v


class Derivation(BaseModel):
    formula: str
    sources: list[Citation] = Field(min_length=1)


class Hypothesis(BaseModel):
    text: str
    falsifiable_by: str


class SampleContext(BaseModel):
    day: int
    level: int
    archetype: Archetype | None = None
    lag_blocks: int
    lag_unreliable: bool
    sampled_at: str


class Discrepancy(BaseModel):
    id: str
    domain: Domain
    endpoint: str
    expected_value: str
    derivation: Derivation
    observed_value: str
    magnitude: str
    severity: Severity
    suspected_source: SuspectedSource
    hypothesis: list[Hypothesis] = Field(min_length=1)
    sample_context: SampleContext
    notes: str | None = None
