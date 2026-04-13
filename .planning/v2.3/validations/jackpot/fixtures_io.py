"""Fixture loader / recorder for live API JSON payloads.

Fixture files live under ``validations/tests/fixtures/api/`` and are
plain-text JSON captured from live ``localhost:3000`` probes.

Security invariant (T-19-01-01): fixture names are validated with a
strict regex ``^[A-Za-z0-9_\\-\\.]+$`` before path join. ``/`` and ``..``
are rejected. This blocks path traversal reads of arbitrary files.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_NAME_RE = re.compile(r"^[A-Za-z0-9_\-\.]+$")

# Resolve fixture directory relative to this file.
_FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "api"


def _validate_name(name: str) -> None:
    if not isinstance(name, str) or not _NAME_RE.fullmatch(name):
        raise ValueError(
            f"invalid fixture name: {name!r} (must match ^[A-Za-z0-9_\\-\\.]+$)"
        )


def fixture_path(name: str) -> Path:
    """Return the absolute path for a fixture (validates name)."""
    _validate_name(name)
    return _FIXTURE_ROOT / name


def load_fixture(name: str) -> dict[str, Any]:
    """Load a fixture by name. Raises FileNotFoundError with instructions."""
    path = fixture_path(name)
    if not path.exists():
        raise FileNotFoundError(
            f"fixture not found: {path!s}. "
            f"Record via RUN_LIVE_VALIDATION=1 python -m validations.jackpot --record <day>."
        )
    return json.loads(path.read_text())


def record_fixture(name: str, payload: dict[str, Any], *, overwrite: bool = False) -> Path:
    """Write ``payload`` to the fixture file.

    By default refuses to overwrite an existing fixture; pass
    ``overwrite=True`` to replace. Only intended to be called when an
    explicit ``--record`` flag is supplied by the entry-point driver.
    """
    path = fixture_path(name)
    if path.exists() and not overwrite:
        raise FileExistsError(
            f"fixture exists: {path!s} (pass overwrite=True to replace)"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))
    return path
