"""Shared pytest fixtures for Phase 19 validations."""

from __future__ import annotations

import os

import pytest

from validations.jackpot.endpoints import EndpointClient
from validations.jackpot.fixtures_io import load_fixture


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "live: tests that hit localhost:3000; skipped unless RUN_LIVE_VALIDATION=1",
    )


def pytest_collection_modifyitems(config, items):
    if os.environ.get("RUN_LIVE_VALIDATION") == "1":
        return
    skip_live = pytest.mark.skip(reason="RUN_LIVE_VALIDATION=1 not set")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip_live)


@pytest.fixture
def fixture_client() -> EndpointClient:
    """Endpoint client in replay mode (reads from tests/fixtures/api/)."""
    return EndpointClient(mode="replay")


@pytest.fixture
def seeded_rng_payload() -> dict:
    return load_fixture("replay_rng.json")
