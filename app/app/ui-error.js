// Compact, human-readable transaction feedback for the dense in-game panels.
// Contract helpers normally attach a decoded `userMessage`; this is the final
// UI boundary that prevents raw provider/RPC blobs from taking over a widget.

const RAW_PROVIDER_DETAIL = /(?:CALL_EXCEPTION|UNKNOWN_ERROR|execution reverted|missing revert data|could not coalesce|estimateGas|json-rpc|request body|ethers(?:\.js)?|\{\s*"(?:code|error|method)"|0x[0-9a-f]{40,})/i;
const INSUFFICIENT_FUNDS_DETAIL = /(?:\bINSUFFICIENT_FUNDS\b|\bOutOfFunds\b|insufficient (?:funds|balance)(?: for| to cover)|funds for gas \* price \+ value|funds required exceeds allowance|doesn['’]t have enough funds|not enough funds to (?:send|cover))/i;
const DEFAULT_TX_ERROR = 'Transaction did not go through. Try again.';

function _oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// Wallet libraries wrap the useful error several layers deep and disagree on
// where it lives. Walk a small, bounded set of well-known fields so the UI can
// classify the failure without ever rendering the raw provider blob itself.
function _errorDetails(error) {
  const candidates = [];
  const codes = [];
  const pending = [error];
  const seen = new Set();
  let inspected = 0;
  while (pending.length > 0 && inspected < 64) {
    inspected += 1;
    const value = pending.shift();
    if (typeof value === 'string') {
      const line = _oneLine(value);
      if (line) candidates.push(line);
      continue;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const code = _oneLine(value.code ?? value.revert?.name);
    if (code) codes.push(code);
    for (const key of ['userMessage', 'reason', 'shortMessage', 'message']) {
      try {
        const line = _oneLine(value[key]);
        if (line) candidates.push(line);
      } catch (_e) { /* hostile provider object */ }
    }
    for (const nested of [
      value.cause, value.error, value.info?.error, value.data?.originalError,
      value.response, value.payload,
    ]) {
      if (nested) pending.push(nested);
    }
  }
  return { candidates: [...new Set(candidates)], codes: [...new Set(codes)] };
}

function _safeFallback(value) {
  const fallback = _oneLine(value);
  if (!fallback || fallback.length > 110 || RAW_PROVIDER_DETAIL.test(fallback)) {
    return DEFAULT_TX_ERROR;
  }
  return fallback;
}

/** Return one short line suitable for an inline panel notice. */
export function compactUiError(error, fallback = 'Transaction did not go through. Try again.') {
  const { candidates, codes } = _errorDetails(error);
  const code = codes[0] || '';
  const joined = `${codes.join(' ')} ${candidates.join(' ')}`;

  if (code === 'ACTION_REJECTED' || code === '4001' || /user (?:denied|rejected)|request rejected/i.test(joined)) {
    return 'Transaction cancelled.';
  }
  if (code === 'RngNotReady' || /rng.*not ready|random outcome.*generat/i.test(joined)) {
    return 'RNG is not ready yet.';
  }
  if (codes.includes('WalletGasQuoteRejected')) {
    return 'Your wallet rejected a valid gas quote. Reconnect the wallet and try again.';
  }
  if (INSUFFICIENT_FUNDS_DETAIL.test(joined)
    || /exceeds? (?:your )?(?:balance|funds)|more than the balance/i.test(joined)) {
    return "This wallet doesn't have enough ETH for the transaction and gas.";
  }

  for (const candidate of candidates) {
    if (candidate.length <= 110 && !RAW_PROVIDER_DETAIL.test(candidate)) return candidate;
  }
  return _safeFallback(fallback);
}

/** Extra-terse variant for the persistent bottom action tray. */
export function briefTxError(error, fallback = 'Transaction did not go through. Try again.') {
  const compact = compactUiError(error, fallback);
  if (compact === 'Transaction cancelled.'
    || compact === 'RNG is not ready yet.'
    || /doesn't have enough ETH/i.test(compact)) return compact;
  return _safeFallback(fallback);
}
