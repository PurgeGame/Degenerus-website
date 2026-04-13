"""SafeLoader-backed I/O for ``.planning/v2.3/discrepancies.yaml``.

Security invariants (T-18-03-01, T-18-03-02):

- YAML is parsed with ``yaml.SafeLoader`` exclusively; ``!!python/object``
  style payloads raise ``ConstructorError`` instead of executing.
- Every load/save/append resolves the target path and requires it be
  located under ``<repo_root>/.planning/v2.3/``. Repo root is detected by
  walking up from this file for a ``.git`` directory, with override via
  the ``HARNESS_REPO_ROOT`` environment variable (used by tests).

The on-disk structure is:

    discrepancies:
      - <Discrepancy.model_dump(mode="json") dict>
      - ...
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

import yaml

from harness.schema import Discrepancy


# ---------------------------------------------------------------------------
# Path guard
# ---------------------------------------------------------------------------


def _find_repo_root() -> Path:
    """Walk up from this file looking for a .git directory."""
    here = Path(__file__).resolve().parent
    for candidate in (here, *here.parents):
        if (candidate / ".git").exists():
            return candidate
    # Fall back to 3 levels up (repo/website/.planning/v2.3/harness/harness/ -> repo/website)
    return here.parents[3] if len(here.parents) >= 4 else here


def _resolve_repo_root() -> Path:
    override = os.environ.get("HARNESS_REPO_ROOT")
    if override:
        return Path(override).resolve()
    return _find_repo_root()


def _validate_path(path: str | Path) -> Path:
    resolved = Path(path).resolve()
    repo_root = _resolve_repo_root()
    allowed_root = (repo_root / ".planning" / "v2.3").resolve()
    try:
        resolved.relative_to(allowed_root)
    except ValueError:
        raise ValueError(
            f"path guard: {resolved!s} is not under {allowed_root!s}"
        )
    return resolved


# ---------------------------------------------------------------------------
# Load / save / append
# ---------------------------------------------------------------------------


def load_discrepancies(path: str | Path) -> list[Discrepancy]:
    """Load the discrepancy list from ``path`` using yaml.SafeLoader.

    Returns an empty list if the file is missing or empty. Raises
    ``ValueError`` if the resolved path is outside ``.planning/v2.3/``.
    Raises ``yaml.YAMLError`` (or ``ConstructorError``) on unsafe payloads.
    """
    resolved = _validate_path(path)
    if not resolved.exists():
        return []
    text = resolved.read_text()
    if not text.strip():
        return []
    raw = yaml.safe_load(text)
    if raw is None:
        return []
    if not isinstance(raw, dict) or "discrepancies" not in raw:
        raise ValueError(
            f"expected top-level mapping with 'discrepancies:' key in {resolved!s}"
        )
    entries = raw.get("discrepancies") or []
    return [Discrepancy.model_validate(entry) for entry in entries]


def save_discrepancies(path: str | Path, items: Iterable[Discrepancy]) -> None:
    """Write ``items`` to ``path`` as ``discrepancies: [...]`` (SafeDumper)."""
    resolved = _validate_path(path)
    resolved.parent.mkdir(parents=True, exist_ok=True)
    serialized = [d.model_dump(mode="json") for d in items]
    payload = {"discrepancies": serialized}
    with resolved.open("w") as fh:
        yaml.safe_dump(payload, fh, sort_keys=False)


def append_discrepancy(path: str | Path, item: Discrepancy) -> None:
    """Append a single Discrepancy to the file at ``path``.

    Creates the file with ``discrepancies: [item]`` if missing/empty.
    """
    existing = load_discrepancies(path)
    existing.append(item)
    save_discrepancies(path, existing)
