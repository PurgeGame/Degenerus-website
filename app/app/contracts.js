// /app/app/contracts.js — Phase 58 Plan 01 chokepoint (WLT-04 architectural cut).
//
// Phase 60+ contract: every domain-module write call MUST pass a builder callback,
// NOT a pre-resolved tx promise. See sendTx() JSDoc for examples.
//
//   CORRECT:   sendTx((s) => new Contract(addr, ABI, s).foo(...), 'action')
//   FORBIDDEN: sendTx(contract.foo(...), 'action')   // captures stale signer
//
// Verification grep gate (run before any Phase 60+ commit):
//   grep -rE "sendTx\([a-zA-Z_]+\.[a-zA-Z_]+\(" website/app/   # MUST be empty
//
// Three structural changes vs /beta/app/contracts.js (the analog):
//   1. requireSelf() chokepoint at top of sendTx — throws BEFORE any getSigner() call
//      (T-58-02 devtools-bypass defense).
//   2. buildTx(signer) callback signature replacing pre-resolved txPromise — defers
//      signer use until inside sendTx (Pattern 3 stale-signer fix).
//   3. Per-write signer re-derivation — `await _provider.getSigner()` inside every
//      sendTx invocation; module-level signer cache REMOVED (WLT-03).

import { ethers, BrowserProvider } from 'ethers';
import { CHAIN } from './chain-config.js';
import { get } from './store.js';
import { invalidateJSONCache } from './api.js';
import { invalidateReadCache } from './read-provider.js';
import { compactUiError } from './ui-error.js';

// Module-level state — only the BrowserProvider; NO signer cache (WLT-03 fix structural).
let _provider = null;

// eth_estimateGas is a snapshot. A purchase or resolver can cross a storage
// boundary between simulation and mining (for example, another player moves a
// queue cursor), so using the estimate as an exact hard cap is unnecessarily
// brittle. Two terms: a proportional pad for ordinary drift, plus an absolute
// cushion for the discrete lazy-init branches whose cost is flat regardless of
// tx size — first stake rows of a new staking day, first affiliate accounting
// of a new level, RNG-threshold crossing. Observed live (run #38 tx
// 0xb21e2897…): purchase estimated 280k, needed 361k fourteen seconds later
// (day tick +34k, then a mineFlip-driven level advance +81k); 20% of a small
// estimate can never cover those. Unused gas is not charged, so the cushion
// only raises the wallet's displayed max fee and the sender's balance bar.
export const GAS_ESTIMATE_HEADROOM_BPS = 12_000n;
export const GAS_ESTIMATE_BRANCH_CUSHION = 130_000n;
const RECEIPT_RECOVERY_POLL_MS = 300;
const RECEIPT_RECOVERY_ATTEMPTS = 11;
export const TX_CONFIRMED_EVENT = 'degenerus:tx-confirmed';

export function gasEstimateWithHeadroom(estimate) {
  const gas = BigInt(estimate ?? 0);
  if (gas <= 0n) return gas;
  return (gas * GAS_ESTIMATE_HEADROOM_BPS + 9_999n) / 10_000n
    + GAS_ESTIMATE_BRANCH_CUSHION;
}

function _wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function _recoverDelayedReceipt(hashes) {
  if (typeof _provider?.getTransactionReceipt !== 'function') return null;
  const candidates = [...new Set(
    (Array.isArray(hashes) ? hashes : [hashes]).filter(Boolean).map(String),
  )];
  if (candidates.length === 0) return null;

  // Injected providers occasionally reject wait() while their RPC replica is
  // still a block or two behind. Keep the write in its pressed/busy state for
  // a short reconciliation window instead of flashing a false failure and
  // then discovering the successful transaction on the next poll.
  for (let attempt = 0; attempt < RECEIPT_RECOVERY_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await _wait(RECEIPT_RECOVERY_POLL_MS);
    for (const hash of candidates) {
      try {
        const receipt = await _provider.getTransactionReceipt(hash);
        if (receipt != null) return receipt;
      } catch (_e) {
        // A temporary receipt-read failure is precisely what this grace period
        // is intended to absorb. The original wait error remains authoritative
        // if no receipt appears by the end of the window.
      }
    }
  }
  return null;
}

/**
 * Preserve the fresh JsonRpcSigner API while intercepting its final send.
 * Contract methods call runner.sendTransaction(request); estimating here puts
 * the safety margin under every normal sendTx consumer without making each
 * domain module hand-roll populateTransaction. A caller-supplied gasLimit is
 * respected (the pre-warmed purchase path supplies an already-padded one).
 */
function _signerWithGasHeadroom(signer) {
  if (!signer
    || typeof signer.sendTransaction !== 'function'
    || typeof signer.estimateGas !== 'function') return signer;

  return new Proxy(signer, {
    get(target, prop) {
      if (prop === 'sendTransaction') {
        return async (request) => {
          let next = request;
          if (request?.gasLimit == null) {
            try {
              const estimate = await target.estimateGas(request);
              next = { ...request, gasLimit: gasEstimateWithHeadroom(estimate) };
            } catch (_e) {
              // Keep the wallet/provider's normal fallback path. Estimation
              // failures are often useful revert messages and must not prevent
              // the signer from attempting its own population.
            }
          }
          return target.sendTransaction(next);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function setProvider(browserProvider) { _provider = browserProvider; }
export function getProvider() { return _provider; }
export function clearProvider() { _provider = null; }

// ---------------------------------------------------------------------------
// requireSelf — chokepoint guard (RESEARCH §Pattern 4 layer 3).
// Called as the FIRST statement in sendTx, BEFORE any provider/signer touch.
//
// Throw-message order (WR-03 — documented intent; operator-mode extension 2026-07-16):
//   1. ui.mode === 'view'       → 'Read-only mode — cannot sign...'
//   2. ui.mode === 'combined'   → 'Combined view is read-only — pick a single account to act.'
//   3. !connected               → 'Wallet not connected.'
//   4. viewing && mismatch      → 'Connected wallet does not match...'  (mode !== 'operator' ONLY)
//
// In the deep-link no-wallet case (mode==='view' AND connected===null) the
// user sees message #1, NOT #3. The UI-level disable manager surfaces a
// "Connect to your own wallet to act" tooltip well before this code path is
// reached, so the chokepoint message is rarely surfaced to honest users; it
// matters mainly for devtools-bypass tests (T-58-02).
//
// Operator mode: viewing !== connected is the EXPECTED shape (the connected
// wallet is an approved operator acting for the viewed owner), so the mismatch
// throw (#4) is skipped. The contract's _resolvePlayer(player) enforces the
// on-chain approval; sendTx's freshAddress guard still pins the signer to the
// connected operator, which is correct in operator mode (the operator signs).
// ---------------------------------------------------------------------------

export function requireSelf() {
  const mode = get('ui.mode');
  if (mode === 'view') {
    throw new Error('Read-only mode — cannot sign transactions while viewing another player.');
  }
  if (mode === 'combined') {
    throw new Error('Combined view is read-only — pick a single account to act.');
  }
  const connected = get('connected.address');
  const viewing = get('viewing.address');
  if (!connected) {
    throw new Error('Wallet not connected.');
  }
  if (mode !== 'operator' && viewing && connected.toLowerCase() !== viewing.toLowerCase()) {
    throw new Error('Connected wallet does not match viewing target.');
  }
  return true;
}

// ---------------------------------------------------------------------------
// assertChainOrBlank — read-side gate (RESEARCH §Pitfall 1).
// Returns true when no provider (degraded read-only via JsonRpcProvider RPC path)
// — never throws on read paths so panels keep rendering.
// ---------------------------------------------------------------------------

function _normalizeProviderChainId(value) {
  let candidate = value;
  if (!['string', 'number', 'bigint'].includes(typeof candidate)) return null;
  if (typeof candidate === 'string') {
    candidate = candidate.trim();
    if (!candidate) return null;
    const caip = /^eip155:(.+)$/i.exec(candidate);
    if (caip) candidate = caip[1];
  }
  try {
    const parsed = Number(BigInt(candidate));
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  } catch (_e) {
    return null;
  }
}

async function _liveProviderChainId(provider) {
  // BrowserProvider.getNetwork() may still hold the chain detected before an
  // injected wallet completed wallet_switchEthereumChain. eth_chainId goes
  // through to the EIP-1193 wallet and is authoritative for a write gate.
  if (typeof provider?.send === 'function') {
    try {
      const raw = await provider.send('eth_chainId', []);
      const parsed = _normalizeProviderChainId(raw);
      if (parsed != null) return parsed;
    } catch (_e) { /* fall back for non-EIP-1193 provider test doubles */ }
  }
  const network = await provider.getNetwork();
  return _normalizeProviderChainId(network?.chainId);
}

export async function assertChainOrBlank() {
  if (!_provider) return true;
  try {
    return await _liveProviderChainId(_provider) === CHAIN.id;
  } catch {
    return true;   // degrade open — read paths must keep working
  }
}

// ---------------------------------------------------------------------------
// assertChain — write-side gate. Throws on wrong chain OR no provider.
// ---------------------------------------------------------------------------

export async function assertChain() {
  if (!_provider) throw new Error('Wallet not connected');
  const chainId = await _liveProviderChainId(_provider);
  if (chainId !== CHAIN.id) {
    throw new Error(`Wrong network — switch to ${CHAIN.name}.`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// sendTx — the Phase 60+ chokepoint API.
//
// @param {function(import('ethers').JsonRpcSigner): Promise<import('ethers').TransactionResponse>} buildTx
//        Callback that composes the tx using the FRESH signer derived inside this
//        function. DO NOT pre-resolve the tx promise outside — closures capture
//        stale signers (T-58-01).
//
//        CORRECT:   sendTx((s) => new Contract(addr, ABI, s).purchase(args), 'Buy')
//        FORBIDDEN: sendTx(contract.purchase(args), 'Buy')
//
// @param {string} action Human-readable action label (used in error messages by
//                        Phase 60+ surfaces — Phase 58 keeps it for forward compat).
// @param {{onSubmitted?: function(import('ethers').TransactionResponse): void}} options
//        Optional presentation hook fired after the wallet broadcasts but
//        before receipt confirmation. Hook failures never affect the write.
// @returns {Promise<import('ethers').TransactionReceipt>}
// ---------------------------------------------------------------------------

export async function sendTx(buildTx, action, options = {}) {
  try {
    return await _sendTxRaw(buildTx, action, options);
  } catch (error) {
    // Keep the provider's full object under `cause` for diagnostics while the
    // public Error surface is always short and safe. Existing UI consumers
    // prefer userMessage; even older consumers that read only `.message` now
    // receive the same sanitized copy instead of RPC JSON/calldata.
    const fallback = `${String(action || 'Transaction')} did not go through. Try again.`;
    const userMessage = compactUiError(error, fallback);
    const wrapped = new Error(userMessage);
    wrapped.name = 'TransactionError';
    wrapped.userMessage = userMessage;
    wrapped.cause = error;
    // Preserve fields used by control flow/decoders, but keep raw prose such
    // as `reason` and `shortMessage` exclusively under `cause`. Some legacy
    // views prefer those fields over `.message`, so copying them would reopen
    // the provider-blob leak this boundary is meant to close.
    for (const key of ['code', 'revert', 'data', 'receipt', 'replacement', 'cancelled']) {
      try {
        if (error?.[key] !== undefined) wrapped[key] = error[key];
      } catch (_e) { /* hostile wallet error object */ }
    }
    throw wrapped;
  }
}

async function _sendTxRaw(buildTx, action, { onSubmitted } = {}) {
  // 1. Chokepoint FIRST — throws BEFORE any provider/signer touch (T-58-02).
  requireSelf();
  // 2. Chain assertion — write-side throw on mismatch (T-58-03).
  await assertChain();
  // 3. Re-derive signer EVERY call — the WLT-03 fix; no module-level cache (T-58-01).
  const signer = await _provider.getSigner();
  const freshAddress = (await signer.getAddress()).toLowerCase();
  const connected = get('connected.address');
  if (!connected || connected.toLowerCase() !== freshAddress) {
    throw new Error('Account changed mid-flow — please retry.');
  }
  // 4. Compose tx with fresh signer (caller passes builder, NOT pre-resolved promise).
  const tx = await buildTx(_signerWithGasHeadroom(signer));
  if (typeof onSubmitted === 'function') {
    try { onSubmitted(tx); } catch (_error) { /* presentation cannot fail a write */ }
  }
  // 5. Wallets may replace a pending transaction when the user speeds it up.
  // ethers reports that as a rejected wait() promise even when the replacement
  // mined successfully. Treat the successful receipt as authoritative so the
  // UI does not flash "did not go through" for a confirmed write.
  let receipt;
  try {
    receipt = await tx.wait();
  } catch (error) {
    const replacementReceipt = error?.receipt ?? error?.replacement?.receipt ?? null;
    const replacementSucceeded = error?.code === 'TRANSACTION_REPLACED'
      && error?.cancelled !== true
      && replacementReceipt != null
      && Number(replacementReceipt.status) !== 0;
    if (replacementSucceeded) {
      receipt = replacementReceipt;
    } else {
      const cancelledReplacement = error?.code === 'TRANSACTION_REPLACED'
        && error?.cancelled === true;
      const knownRevert = replacementReceipt != null
        && Number(replacementReceipt.status) === 0;
      if (cancelledReplacement || knownRevert) throw error;

      const recovered = await _recoverDelayedReceipt([
        error?.replacement?.hash,
        tx?.hash,
      ]);
      if (recovered != null) receipt = recovered;
      else throw error;
    }
  }
  if (Number(receipt?.status) === 0) throw new Error(`Reverted: ${tx.hash}`);
  // The receipt is the hard freshness boundary for every REST consumer. Clear
  // the short render-wave cache before any component receives the confirmation
  // event, independent of listener registration order.
  invalidateJSONCache();
  // Same boundary for chain reads: the shared read provider holds an identical
  // one-second window, so a confirmed write must drop it here too or a panel
  // could re-render pre-transaction state (C15 follow-on).
  invalidateReadCache();
  // Publish one app-wide mined-transaction signal from the write chokepoint.
  // Balance widgets can now refresh after spends made from any protocol
  // surface instead of knowing every component-specific confirmation event.
  try {
    if (typeof document !== 'undefined'
      && typeof document.dispatchEvent === 'function'
      && typeof CustomEvent === 'function') {
      document.dispatchEvent(new CustomEvent(TX_CONFIRMED_EVENT, {
        detail: {
          action: String(action || 'Transaction'),
          transactionHash: receipt?.hash || receipt?.transactionHash || tx?.hash || null,
          blockNumber: receipt?.blockNumber ?? null,
        },
      }));
    }
  } catch (_error) {
    // A presentation refresh can never turn a confirmed chain write into an
    // apparent failure.
  }
  return receipt;
}

// ---------------------------------------------------------------------------
// switchToSepolia — verbatim shape from /beta/app/contracts.js:108-135 with
// CHAIN.hexId / CHAIN.nativeAddEntry sourced from chain-config (Phase 56).
// Returns true on success, false on user-rejection (4001) or fallback failure.
// ---------------------------------------------------------------------------

function _walletRpcErrorCode(error) {
  // Mobile bridges often wrap the useful provider error under a generic
  // -32603 envelope, and some serialize its numeric code as a string.
  const candidates = [
    error?.data?.originalError?.code,
    error?.data?.code,
    error?.info?.error?.code,
    error?.error?.code,
    error?.cause?.code,
    error?.code,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === 'string' && /^-?\d+$/.test(candidate.trim())) {
      return Number(candidate);
    }
  }
  return null;
}

function _walletRpcErrorText(error) {
  return [
    error?.data?.originalError?.message,
    error?.data?.message,
    error?.info?.error?.message,
    error?.error?.message,
    error?.cause?.message,
    error?.message,
  ].filter(Boolean).join(' ');
}

function _isUnknownWalletChain(error) {
  const code = _walletRpcErrorCode(error);
  if (code === 4902) return true;
  return code === -32603
    && /(unknown|unrecognized|unsupported|not (?:added|found)).*chain|chain.*(?:unknown|unrecognized|unsupported|not (?:added|found))/i
      .test(_walletRpcErrorText(error));
}

export async function switchToSepolia(eip1193Provider) {
  try {
    await eip1193Provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CHAIN.hexId }],
    });
    return true;
  } catch (err) {
    if (_isUnknownWalletChain(err)) {
      // Chain not added to wallet — add it then retry switch.
      try {
        await eip1193Provider.request({
          method: 'wallet_addEthereumChain',
          params: [CHAIN.nativeAddEntry],
        });
        await eip1193Provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: CHAIN.hexId }],
        });
        return true;
      } catch {
        return false;
      }
    }
    if (_walletRpcErrorCode(err) === 4001) return false;   // user rejected — silent
    return false;
  }
}

// Re-export ethers for downstream Phase 60+ convenience (matches /beta/app/contracts.js L1).
export { ethers, BrowserProvider };
