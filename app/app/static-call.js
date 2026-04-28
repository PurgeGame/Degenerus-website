// /app/app/static-call.js — Phase 56 APP-05 (D-05 LOCKED)
// ethers v6 .staticCall() pre-flight wrapper. Pre-flights state-changing tx; never throws.
// Caller composes with reason-map.js at the write site (Phase 60+).
// Source: docs.ethers.org/v6/api/contract — Contract method staticCall.
// Verified pattern: /beta/mint.js:277,296 — `await contract.advanceGame.staticCall();`

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
 * @param {object} [signer=null] - Optional signer; if provided, contract.connect(signer) is invoked
 * @returns {Promise<{ok: true, simResult: any} | {ok: false, error: Error}>}
 */
export async function requireStaticCall(contract, method, args = [], signer = null) {
  try {
    const c = signer ? contract.connect(signer) : contract;
    const simResult = await c[method].staticCall(...args);
    return { ok: true, simResult };
  } catch (error) {
    return { ok: false, error };
  }
}
