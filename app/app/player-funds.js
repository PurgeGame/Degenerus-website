export const PLAYER_FUNDS_OPEN_EVENT = 'degenerus:player-funds:open';

export function normalizePlayerFundsMode(mode) {
  return mode === 'eth' || mode === 'flip' || mode === 'link' || mode === 'cashout'
    ? mode
    : 'flip';
}

/** Open a focused action, or the combined ETH + FLIP cash-out surface. */
export function openPlayerFundsDialog(mode = 'flip') {
  if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') return false;
  try {
    document.dispatchEvent(new CustomEvent(PLAYER_FUNDS_OPEN_EVENT, {
      detail: { mode: normalizePlayerFundsMode(mode) },
    }));
    return true;
  } catch (_e) {
    return false;
  }
}
