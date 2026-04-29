// /app/app/affiliate.js — Phase 62 Plan 62-06 (AFF-01).
//
// Affiliate URL builder + Customize-CTA write helper. Three named exports
// drive the <app-affiliate-panel> Custom Element + persist registered codes
// to chainId-scoped localStorage so subsequent buys auto-attach via the Phase
// 60 D-05 readAffiliateCode mechanism (lootbox.js:365-373).
//
// Plan history:
//   - Plan 62-06: AFF-01 default URL + Customize CTA (THIS PLAN)
//
// CRITICAL — RESEARCH Pitfall 5:
//   defaultCodeForAddress MUST LEFT-pad to 32 bytes. RIGHT-padding fails the
//   contract's `BigInt(code) <= type(uint160).max` check at Affiliate.sol:
//   711-712. Address 0xff..ff (all-Fs) LEFT-padded → BigInt === 2**160 - 1
//   (passes); RIGHT-padded → BigInt === (2**160 - 1) << 96 (FAILS).
//
//   Use `ethers.zeroPadValue(addr.toLowerCase(), 32)` — ethers v6 LEFT-pads.
//
// CRITICAL — RESEARCH R2 (HIGH confidence):
//   The default URL works IMMEDIATELY for any connected user with NO prior
//   createAffiliateCode tx required. Affiliate.sol:710-720 _resolveCodeOwner
//   falls back to address-derived owner when affiliateCode[code].owner is
//   address(0). Default code carries kickback:0 (referrer keeps 100% of
//   affiliate share per Affiliate.sol:434-446). The Customize CTA below is
//   ONLY for users wanting (a) a vanity hex code (3-31 alphanumeric) OR
//   (b) a non-zero kickback% to share with referees.
//
// CRITICAL — RESEARCH R7 + Pitfall 8:
//   Plan 62-06 registers EXACTLY 3 NEW reason-map codes (Zero, Insufficient,
//   InvalidKickback). Insufficient is REUSED across multiple paths in
//   Affiliate.sol (createAffiliateCode "code already taken", referPlayer
//   "invalid referral", claim-path "array length mismatch"); the registration
//   below is CONTEXT-BOUNDED to the Customize CTA path — see inline comment.
//
// MANDATORY closure form for sendTx (Phase 58 verified by grep gate):
//   CORRECT:   sendTx( (s) => new Contract(addr, ABI, s).method(args), 'Action' )
//   FORBIDDEN: sendTx( contract.method(args), 'Action' )
//
// localStorage persistence: after a successful createAffiliateCode tx, the
// registered code is stored at `affiliate-code:${CHAIN.id}:${addr.toLowerCase()}`
// so Phase 60 D-05 readAffiliateCode (lootbox.js:365-373) auto-attaches it on
// the user's subsequent ETH purchases. The format matches the BURNIE-side
// affiliate code Phase 60 already persists from URL ?ref= params.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { CONTRACTS, CHAIN } from './chain-config.js';
import { get } from './store.js';

// ---------------------------------------------------------------------------
// Inline ABI fragments — canonical signatures verified against
// degenerus-audit/contracts/DegenerusAffiliate.sol (line 303 createAffiliateCode,
// line 344 defaultCode, line 338 getReferrer). DO NOT cross-import
// /beta/app/constants.js (Pitfall 4 — Phase 61 noted constants.js drift on
// Coinflip; preserve isolation here too).
// ---------------------------------------------------------------------------

const AFFILIATE_ABI = [
  'function createAffiliateCode(bytes32 code_, uint8 kickbackPct) external',
  'function defaultCode(address addr) external pure returns (bytes32)',
  'function getReferrer(address player) external view returns (address)',
];

const CODE_PATTERN = /^[A-Za-z0-9]{3,31}$/;
const MAX_KICKBACK = 25;

// ---------------------------------------------------------------------------
// Test seam — production path uses default `new ethers.Contract(...)`.
// Tests inject a fake via __setContractFactoryForTest; reset via
// __resetContractFactoryForTest. Mirrors Phase 60 lootbox.js + Phase 61
// claims.js test seam.
// ---------------------------------------------------------------------------

let _contractFactory = null;

/** Test-only: replace the `new Contract(...)` construction with a fake. */
export function __setContractFactoryForTest(fn) {
  _contractFactory = fn;
}

/** Test-only: clear the injected factory; subsequent calls use the real path. */
export function __resetContractFactoryForTest() {
  _contractFactory = null;
}

function _buildAffiliateContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.AFFILIATE, AFFILIATE_ABI, signerOrProvider);
}

// ---------------------------------------------------------------------------
// Structured-revert-error helper — port of Phase 60 lootbox.js + Phase 61
// claims.js. Decodes via reason-map; wraps as Error with .code / .userMessage
// / .recoveryAction / .cause for downstream UI consumption.
// ---------------------------------------------------------------------------

function _structuredRevertError(error, context) {
  const decoded = decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || `Failed: ${context}`);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

// ---------------------------------------------------------------------------
// defaultCodeForAddress — compute the address-derived default affiliate code.
//
// Affiliate.sol:344 `defaultCode(address addr) returns (bytes32)`:
//     return bytes32(uint256(uint160(addr)));
//
// Solidity uint256(uint160(addr)) places the 160-bit address in the LOW 20
// bytes of the 256-bit word — equivalent to LEFT-padding the 20-byte hex
// representation with 12 zero bytes (24 zero hex chars).
//
// RESEARCH Pitfall 5: ethers.zeroPadValue(addr, 32) is the v6 LEFT-pad helper.
// DO NOT substitute `addr + '0'.repeat(24)` (RIGHT-pad) — the BigInt-converted
// value would exceed type(uint160).max and Affiliate.sol:711-712 reverts.
// ---------------------------------------------------------------------------

/**
 * Compute the default affiliate code for an address (commission-eligible
 * without prior createAffiliateCode registration).
 * @param {string} addr Hex address (0x-prefixed; case-insensitive).
 * @returns {string} bytes32 hex (LEFT-padded) — '0x' + 64 hex chars.
 */
export function defaultCodeForAddress(addr) {
  return ethers.zeroPadValue(String(addr).toLowerCase(), 32);
}

// ---------------------------------------------------------------------------
// buildAffiliateUrl — build the shareable affiliate URL for a connected user.
// Default: address-derived bytes32 code (commission flows immediately).
// Customized: vanity bytes32 code from a successful createAffiliateCode tx.
// ---------------------------------------------------------------------------

/**
 * @param {string} addr Hex address (will be lowercased).
 * @param {string|null} [registeredCode] Optional bytes32 hex from a previous
 *        createAffiliateCode tx; if absent, falls back to defaultCodeForAddress.
 * @returns {string} `https://purgegame.com/app/?ref=<bytes32hex>`
 */
export function buildAffiliateUrl(addr, registeredCode = null) {
  const code = registeredCode || defaultCodeForAddress(addr);
  return `https://purgegame.com/app/?ref=${code}`;
}

// ---------------------------------------------------------------------------
// createAffiliateCode — Customize CTA: register a vanity code with a kickback %.
//
// Validation:
//   - codeStr matches /^[A-Za-z0-9]{3,31}$/ (uppercased before encoding).
//   - kickbackPct ∈ [0, 25] (contract enforces InvalidKickback at Affiliate.sol:119).
//
// Encoding:
//   - codeStr.toUpperCase() (matches /beta/ convention; Affiliate.sol's
//     code-uniqueness check is byte-for-byte so case matters).
//   - ethers.encodeBytes32String(upperCode) — bytes32 hex.
//
// Flow:
//   1. Static-call gate (Phase 56 D-05) decodes any contract-side revert
//      (Insufficient = code already taken; Zero = reserved code; InvalidKickback
//      = pct > 25) BEFORE wallet popup.
//   2. Phase 58 closure-form sendTx with action label 'Register affiliate code'.
//   3. On confirm, persist `affiliate-code:${CHAIN.id}:${addr.toLowerCase()}`
//      → encodedCode so Phase 60 D-05 readAffiliateCode picks it up on the
//      user's subsequent ETH purchases (lootbox.js:365-373).
//
// CF-06 NEVER optimistic — the panel only flips its URL display AFTER the
// receipt resolves (handler waits on the returned promise).
// ---------------------------------------------------------------------------

/**
 * @param {{codeStr: string, kickbackPct: number|string}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt, encodedCode: string}>}
 */
export async function createAffiliateCode({ codeStr, kickbackPct } = {}) {
  if (!CODE_PATTERN.test(String(codeStr || ''))) {
    throw new Error('Code must be 3-31 alphanumeric characters.');
  }
  const pct = parseInt(String(kickbackPct), 10);
  if (Number.isNaN(pct) || pct < 0 || pct > MAX_KICKBACK) {
    throw new Error('Kickback must be in the range 0-25%.');
  }

  const owner = get('connected.address');
  if (!owner) throw new Error('Wallet not connected.');

  const upperCode = String(codeStr).toUpperCase();
  const encodedCode = ethers.encodeBytes32String(upperCode);

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  // Static-call gate — runs only when a signer is available. Tests with
  // provider===null skip this branch (gate validated in production).
  if (signer) {
    const c = _buildAffiliateContract(signer);
    const sim = await requireStaticCall(c, 'createAffiliateCode', [encodedCode, pct], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call createAffiliateCode');
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx(
    (s) => _buildAffiliateContract(s).createAffiliateCode(encodedCode, pct),
    'Register affiliate code',
  );

  // Persist registered code for Phase 60 D-05 reuse. Wrapped in try/catch for
  // private-mode / quota safety (Pitfall F mirror).
  try {
    if (typeof localStorage !== 'undefined') {
      const key = `affiliate-code:${CHAIN.id}:${owner.toLowerCase()}`;
      localStorage.setItem(key, encodedCode);
    }
  } catch (_e) { /* private mode / quota — defensive */ }

  return { receipt, encodedCode };
}

// ---------------------------------------------------------------------------
// Reason-map registrations — Plan 62-06's 3 NEW codes.
//
// Verified against degenerus-audit/contracts/DegenerusAffiliate.sol:
//   - Zero            line 113: `error Zero();`            (reserved/invalid)
//   - Insufficient    line 116: `error Insufficient();`    (code already taken in
//                                                          createAffiliateCode context;
//                                                          REUSED across paths — see
//                                                          context-bounded comment below)
//   - InvalidKickback line 119: `error InvalidKickback();` (kickbackPct > 25)
// ---------------------------------------------------------------------------

register('Zero', {
  code: 'Zero',
  userMessage: 'That code is reserved or invalid. Try a 3-31 character ASCII code.',
  recoveryAction: 'Pick a different code.',
});

// ── CONTEXT-BOUNDED REGISTRATION — Plan 62-06 / RESEARCH Pitfall 8 ─────────
// Affiliate.sol:116 reuses the `Insufficient` error across multiple paths:
//   - createAffiliateCode  → "code already taken"
//   - referPlayer          → "invalid referral"
//   - array-length checks  → "input length mismatch"
// This registration's userMessage is correct ONLY for the createAffiliateCode
// (Customize CTA) path that Plan 62-06 ships. If a future phase ships a
// referPlayer panel or any UI that surfaces `Insufficient` from a different
// path, RE-REVIEW this registration before letting it surface "code already
// taken" copy in those contexts. Pitfall 8 mitigation.
register('Insufficient', {
  code: 'Insufficient',
  userMessage: 'That code is already taken. Pick a different one.',
  recoveryAction: 'Pick a different code.',
});

register('InvalidKickback', {
  code: 'InvalidKickback',
  userMessage: 'Kickback must be between 0% and 25%.',
  recoveryAction: 'Lower the kickback %.',
});
