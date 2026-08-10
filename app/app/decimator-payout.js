// Exact settlement shape for a regular Decimator winner. The draw can keep
// quoting one ETH-denominated prize value, then use this helper for the final
// player receipt after the wheel has finished.

export const DECIMATOR_ETH_WEI = 10n ** 18n;
export const DECIMATOR_WHALE_THRESHOLD_WEI = 5n * DECIMATOR_ETH_WEI;
export const DECIMATOR_HALF_WHALE_PASS_WEI = (9n * DECIMATOR_ETH_WEI) / 4n;
export const DECIMATOR_MIN_LUCKBOX_WEI = DECIMATOR_ETH_WEI / 100n;

function _wei(value) {
  try {
    const amount = BigInt(value ?? 0);
    return amount > 0n ? amount : 0n;
  } catch (_error) {
    return 0n;
  }
}

/**
 * Split a gross Decimator share exactly as DegenerusGameDecimatorModule does.
 * `halfPasses` counts half-passes, not complete two-half Whale Passes.
 */
export function decimatorPayoutBreakdown(totalWei, { terminal = false } = {}) {
  const total = _wei(totalWei);
  if (terminal) {
    return {
      totalWei: total,
      claimableEthWei: total,
      rewardWei: 0n,
      rewardKind: 'eth',
      halfPasses: 0n,
      luckboxWei: 0n,
      recirculatedDustWei: 0n,
    };
  }

  const claimableEthWei = total >> 1n;
  const rewardWei = total - claimableEthWei;
  if (rewardWei <= DECIMATOR_WHALE_THRESHOLD_WEI) {
    return {
      totalWei: total,
      claimableEthWei,
      rewardWei,
      rewardKind: 'luckbox',
      halfPasses: 0n,
      luckboxWei: rewardWei,
      recirculatedDustWei: 0n,
    };
  }

  const halfPasses = rewardWei / DECIMATOR_HALF_WHALE_PASS_WEI;
  const remainder = rewardWei % DECIMATOR_HALF_WHALE_PASS_WEI;
  const luckboxWei = remainder >= DECIMATOR_MIN_LUCKBOX_WEI ? remainder : 0n;
  return {
    totalWei: total,
    claimableEthWei,
    rewardWei,
    rewardKind: 'whale',
    halfPasses,
    luckboxWei,
    recirculatedDustWei: remainder - luckboxWei,
  };
}
