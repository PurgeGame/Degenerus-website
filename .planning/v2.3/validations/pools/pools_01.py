"""POOLS-01 validator: current-moment solvency proxy.

Algorithm:
1. Ensure POOLS-01 coverage-gap entry logged (idempotent).
2. Fetch /game/state.prizePools.claimableWinnings.
3. Fetch /tokens/analytics.vault.{ethReserve, stEthReserve}.
4. If claimable > ethReserve + stEthReserve -> Critical Discrepancy
   (degraded one step when lag_snapshot.lag_unreliable).
5. Else return [] (implicit pass; no YAML noise).

Contract invariant:
    DegenerusGame.sol:18 -- address(this).balance + steth.balanceOf(this) >= claimablePool

Caveat: vault reserves are a LOWER-BOUND proxy for game-contract balances.
The game contract's direct balance is not exposed by any API route this
milestone; see POOLS-01-coverage-gap-no-per-day-pool-history.
"""

from __future__ import annotations

from typing import Any

from harness import (
    Citation,
    Derivation,
    Discrepancy,
    HealthSnapshot,
    Hypothesis,
    SampleContext,
)

from validations.pools.source_level_entries import (
    DEFAULT_DISCREPANCIES_PATH,
    ensure_pools_01_coverage_gap_logged,
)


_GAME_CONTRACT = "degenerus-audit/contracts/DegenerusGame.sol"
_SEVERITY_ORDER = ("Critical", "Major", "Minor", "Info")


def _downgrade(severity: str) -> str:
    try:
        idx = _SEVERITY_ORDER.index(severity)
    except ValueError:
        return severity
    return _SEVERITY_ORDER[min(idx + 1, len(_SEVERITY_ORDER) - 1)]


def validate_pools_01(
    client: Any,
    *,
    lag_snapshot: HealthSnapshot,
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> list[Discrepancy]:
    ensure_pools_01_coverage_gap_logged(yaml_path)

    state = client.get_game_state()
    vault = client.get_tokens_analytics()["vault"]
    claimable = int(state["prizePools"]["claimableWinnings"])
    eth_reserve = int(vault["ethReserve"])
    steth_reserve = int(vault["stEthReserve"])
    proxy = eth_reserve + steth_reserve

    if claimable <= proxy:
        return []

    severity = "Critical"
    if lag_snapshot.lag_unreliable:
        severity = _downgrade(severity)

    shortfall = claimable - proxy
    sample_ctx = SampleContext(
        day=0,
        level=0,
        archetype=None,
        lag_blocks=lag_snapshot.lag_blocks,
        lag_unreliable=lag_snapshot.lag_unreliable,
        sampled_at=lag_snapshot.sampled_at,
    )

    return [
        Discrepancy(
            id=f"POOLS-01-solvency-proxy-violation-{lag_snapshot.sampled_at[:10]}",
            domain="POOLS",
            endpoint="/game/state + /tokens/analytics",
            expected_value=(
                f"claimable ({claimable}) <= ethReserve + stEthReserve ({proxy})"
            ),
            observed_value=(
                f"claimable={claimable}, ethReserve={eth_reserve}, stEthReserve={steth_reserve}"
            ),
            derivation=Derivation(
                formula=(
                    "solvency invariant: address(this).balance + steth.balanceOf(this) "
                    ">= claimablePool"
                ),
                sources=[Citation(path=_GAME_CONTRACT, line=18, label="contract")],
            ),
            magnitude=f"shortfall={shortfall} wei",
            severity=severity,
            suspected_source="api",
            hypothesis=[
                Hypothesis(
                    text=(
                        "vault reserves are a LOWER-BOUND proxy for game-contract "
                        "balances; true contract-side ETH+stETH balance is not exposed"
                    ),
                    falsifiable_by=(
                        "add /game/balances endpoint returning {ethBalance, stEthBalance} "
                        "of the game contract address directly"
                    ),
                )
            ],
            sample_context=sample_ctx,
            notes=(
                "POOLS-01 can only be checked against vault-reserve proxy this "
                "milestone; see POOLS-01-coverage-gap-no-per-day-pool-history."
            ),
        )
    ]
