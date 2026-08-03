// Compact, human-readable transaction feedback for the dense in-game panels.
// Contract helpers normally attach a decoded `userMessage`; this is the final
// UI boundary that prevents raw provider/RPC blobs from taking over a widget.

const RAW_PROVIDER_DETAIL = /(?:CALL_EXCEPTION|UNKNOWN_ERROR|execution reverted|missing revert data|could not coalesce|estimateGas|json-rpc|request body|ethers(?:\.js)?|\{\s*"(?:code|error|method)"|0x[0-9a-f]{40,})/i;

function _oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Return one short line suitable for an inline panel notice. */
export function compactUiError(error, fallback = 'Transaction did not go through. Try again.') {
  const code = _oneLine(error?.code ?? error?.revert?.name);
  const candidates = [
    error?.userMessage,
    error?.reason,
    error?.shortMessage,
    typeof error === 'string' ? error : error?.message,
  ].map(_oneLine).filter(Boolean);
  const joined = `${code} ${candidates.join(' ')}`;

  if (code === 'ACTION_REJECTED' || code === '4001' || /user (?:denied|rejected)|request rejected/i.test(joined)) {
    return 'Transaction cancelled.';
  }
  if (code === 'RngNotReady' || /rng.*not ready|random outcome.*generat/i.test(joined)) {
    return 'RNG is not ready yet.';
  }
  if (/insufficient funds|exceeds? (?:your )?(?:balance|funds)|more than the balance/i.test(joined)) {
    return 'Not enough balance.';
  }

  for (const candidate of candidates) {
    if (candidate.length <= 110 && !RAW_PROVIDER_DETAIL.test(candidate)) return candidate;
  }
  return _oneLine(fallback) || 'Transaction did not go through. Try again.';
}

/** Extra-terse variant for the persistent bottom action tray. */
export function briefTxError(error, fallback = 'Transaction did not go through. Try again.') {
  const compact = compactUiError(error, fallback);
  if (compact === 'Transaction cancelled.'
    || compact === 'RNG is not ready yet.'
    || compact === 'Not enough balance.') return compact;
  return _oneLine(fallback) || 'Transaction did not go through. Try again.';
}
