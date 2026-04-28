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

// Module-level state — only the BrowserProvider; NO signer cache (WLT-03 fix structural).
let _provider = null;

export function setProvider(browserProvider) { _provider = browserProvider; }
export function getProvider() { return _provider; }
export function clearProvider() { _provider = null; }

// ---------------------------------------------------------------------------
// requireSelf — chokepoint guard (RESEARCH §Pattern 4 layer 3).
// Called as the FIRST statement in sendTx, BEFORE any provider/signer touch.
//
// Throw-message order (WR-03 — documented intent):
//   1. ui.mode === 'view'       → 'Read-only mode — cannot sign...'
//   2. !connected               → 'Wallet not connected.'
//   3. viewing && mismatch      → 'Connected wallet does not match...'
//
// In the deep-link no-wallet case (mode==='view' AND connected===null) the
// user sees message #1, NOT #2. The UI-level disable manager surfaces a
// "Connect to your own wallet to act" tooltip well before this code path is
// reached, so the chokepoint message is rarely surfaced to honest users; it
// matters mainly for devtools-bypass tests (T-58-02).
// ---------------------------------------------------------------------------

export function requireSelf() {
  const mode = get('ui.mode');
  if (mode === 'view') {
    throw new Error('Read-only mode — cannot sign transactions while viewing another player.');
  }
  const connected = get('connected.address');
  const viewing = get('viewing.address');
  if (!connected) {
    throw new Error('Wallet not connected.');
  }
  if (viewing && connected.toLowerCase() !== viewing.toLowerCase()) {
    throw new Error('Connected wallet does not match viewing target.');
  }
  return true;
}

// ---------------------------------------------------------------------------
// assertChainOrBlank — read-side gate (RESEARCH §Pitfall 1).
// Returns true when no provider (degraded read-only via JsonRpcProvider RPC path)
// — never throws on read paths so panels keep rendering.
// ---------------------------------------------------------------------------

export async function assertChainOrBlank() {
  if (!_provider) return true;
  try {
    const network = await _provider.getNetwork();
    return Number(network.chainId) === CHAIN.id;
  } catch {
    return true;   // degrade open — read paths must keep working
  }
}

// ---------------------------------------------------------------------------
// assertChain — write-side gate. Throws on wrong chain OR no provider.
// ---------------------------------------------------------------------------

export async function assertChain() {
  if (!_provider) throw new Error('Wallet not connected');
  const network = await _provider.getNetwork();
  if (Number(network.chainId) !== CHAIN.id) {
    throw new Error('Wrong network — switch to Sepolia.');
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
// @returns {Promise<import('ethers').TransactionReceipt>}
// ---------------------------------------------------------------------------

export async function sendTx(buildTx, action) {
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
  const tx = await buildTx(signer);
  // 5. KEEP analog's receipt-status idiom verbatim — the /beta/mint.js:756 bug-class fix.
  const receipt = await tx.wait();
  if (receipt.status === 0) throw new Error(`Reverted: ${tx.hash}`);
  return receipt;
}

// ---------------------------------------------------------------------------
// switchToSepolia — verbatim shape from /beta/app/contracts.js:108-135 with
// CHAIN.hexId / CHAIN.nativeAddEntry sourced from chain-config (Phase 56).
// Returns true on success, false on user-rejection (4001) or fallback failure.
// ---------------------------------------------------------------------------

export async function switchToSepolia(eip1193Provider) {
  try {
    await eip1193Provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CHAIN.hexId }],
    });
    return true;
  } catch (err) {
    if (err.code === 4902) {
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
    if (err.code === 4001) return false;   // user rejected — silent
    return false;
  }
}

// Re-export ethers for downstream Phase 60+ convenience (matches /beta/app/contracts.js L1).
export { ethers, BrowserProvider };
