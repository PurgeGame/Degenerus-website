// /app/app/static-call.js — Phase 56 APP-05 (D-05 LOCKED)
// ethers v6 .staticCall() pre-flight wrapper. Pre-flights state-changing tx; never throws.
// Caller composes with reason-map.js at the write site (Phase 60+).
// Source: docs.ethers.org/v6/api/contract — Contract method staticCall.
// Verified pattern: /beta/mint.js:277,296 — `await contract.advanceGame.staticCall();`

import { ensureWriteChain, getProvider } from './contracts.js';

/**
 * Pre-flight a state-changing contract call via ethers v6 .staticCall().
 * Returns success/failure + sim result or revert error for caller composition.
 *
 * Discriminated-union return:
 *   - success: { ok: true, simResult }
 *   - failure: { ok: false, error }
 *
 * NEVER throws — all errors (including non-CallExceptionError) are captured
 * into { ok: false, error } so callers compose with decodeRevertReason without
 * needing their own try/catch.
 *
 * @param {object} contract - ethers v6 Contract instance (read or write)
 * @param {string} method - Method name (e.g. 'purchase', 'claimWinnings')
 * @param {Array} [args=[]] - Method arguments
 * @param {object} [signer=null] - Optional write signer; known wrong-chain sessions are repaired first
 * @returns {Promise<{ok: true, simResult: any} | {ok: false, error: Error}>}
 */
export async function requireStaticCall(contract, method, args = [], signer = null) {
  try {
    let writeSigner = signer;
    if (writeSigner) {
      const providerBefore = getProvider();
      if (providerBefore) {
        await ensureWriteChain();
        const providerAfter = getProvider();
        // Chain repair deliberately replaces BrowserProvider to discard
        // ethers' pinned pre-switch network. Replace the equally stale signer
        // before the simulation, or it can fail before sendTx is reached.
        if (providerAfter && providerAfter !== providerBefore) {
          writeSigner = await providerAfter.getSigner();
        }
      }
    }
    const c = writeSigner ? contract.connect(writeSigner) : contract;
    const simResult = await c[method].staticCall(...args);
    return { ok: true, simResult };
  } catch (error) {
    return { ok: false, error };
  }
}
