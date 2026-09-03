// Pure reveal receipt projections shared by the history UI and visual engine.
// Kept separate so a collapsed history panel does not import the 300KB engine.

function _safeBigInt(value) {
  try { return BigInt(value ?? 0); } catch (_error) { return 0n; }
}

/**
 * Project a partial Degenerette ETH total into its two final receipt lanes.
 * Integer dust stays in immediately claimable ETH and the final frame is exact.
 */
export function projectDegeneretteEthSplit({ gross, total, lootboxEth } = {}) {
  const shown = _safeBigInt(gross);
  const finalTotal = _safeBigInt(total);
  const emittedBox = _safeBigInt(lootboxEth);
  if (shown <= 0n) return { actual: 0n, lootbox: 0n };
  if (finalTotal <= 0n || emittedBox <= 0n) return { actual: shown, lootbox: 0n };

  const finalBox = emittedBox > finalTotal ? finalTotal : emittedBox;
  const progress = shown > finalTotal ? finalTotal : shown;
  const box = progress === finalTotal
    ? finalBox
    : (finalBox * progress) / finalTotal;
  return { actual: shown - box, lootbox: box };
}
