// /app/app/affiliate.js — Phase 62 Plan 62-06 (AFF-01).
//
// Affiliate URL builder + Customize-CTA write helper + own-registered-code
// readers. Drives the <app-affiliate-panel> Custom Element and the share-win
// card. The chainId-scoped `affiliate-code:{chain}:{addr}` localStorage key
// holds the player's OWN registered code (semantics fixed 2026-07-16) — it
// is read back for the player's shareable link, NEVER attached to their own
// purchases (that would be a self-referral; the purchase default is the
// site-wide /js/ref.js capture, see lootbox.js readAffiliateCode).
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
// for readRegisteredCode / resolveRegisteredCode below (affiliate panel URL,
// share-win card). Purchases never read it — see the module header.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { CONTRACTS, CHAIN } from './chain-config.js';
import { get } from './store.js';
import { fetchJSON as sharedFetchJSON } from './api.js';

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
  'function affiliateCode(bytes32) external view returns (address owner, uint8 kickback)',
];

const CODE_PATTERN = /^[A-Za-z0-9]{3,31}$/;
const MAX_KICKBACK = 25;
export const REFERRAL_CHANGED_EVENT = 'degenerus:referral-changed';

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
// First-purchase referral input helpers.
//
// The purchase widget accepts the three forms players actually encounter:
// a plain address, a full bytes32 link code, or a registered vanity code.
// Vanity values are resolved before the transaction because the affiliate
// contract permanently closes the player's referral slot on their first buy;
// silently sending an unknown code would lock that slot to no referrer.
// ---------------------------------------------------------------------------

/**
 * Convert purchase-field text into the bytes32 value expected by purchase().
 * An empty field deliberately means no referral.
 * @param {string|null|undefined} raw
 * @returns {string}
 */
export function normalizePurchaseAffiliateCode(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return ethers.ZeroHash;
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return ethers.zeroPadValue(value.toLowerCase(), 32);
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return value.toLowerCase();
  }
  if (CODE_PATTERN.test(value)) {
    return ethers.encodeBytes32String(value.toUpperCase());
  }
  throw new Error('Affiliate code must be a 3-31 character code, address, or bytes32 link code.');
}

/**
 * Turn a stored bytes32 value back into friendly purchase-field text.
 * @param {string|null|undefined} code
 * @returns {string}
 */
export function formatPurchaseAffiliateCode(code) {
  if (typeof code !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(code)) return '';
  const normalized = code.toLowerCase();
  let numeric;
  try { numeric = BigInt(normalized); } catch (_e) { return ''; }
  if (numeric === 0n) return '';
  if (numeric <= MAX_UINT160) return `0x${normalized.slice(-40)}`;
  try {
    const decoded = ethers.decodeBytes32String(normalized);
    return CODE_PATTERN.test(decoded) ? decoded : normalized;
  } catch (_e) {
    return normalized;
  }
}

/**
 * Validate a purchase referral and return its canonical bytes32 value.
 * Address-derived codes are self-contained; registered vanity codes are
 * resolved on-chain so an unknown/self code never consumes the first-buy slot.
 *
 * @param {string|null|undefined} raw
 * @param {string|null|undefined} player
 * @returns {Promise<string>}
 */
export async function validatePurchaseAffiliateCode(raw, player) {
  const code = normalizePurchaseAffiliateCode(raw);
  if (code === ethers.ZeroHash) return code;

  let numeric;
  try { numeric = BigInt(code); } catch (_e) {
    throw new Error('Affiliate code is malformed.');
  }

  let owner = null;
  if (numeric <= MAX_UINT160) {
    owner = `0x${code.slice(-40)}`;
  } else {
    const provider = getProvider();
    if (!provider) throw new Error('Connect a wallet to validate this affiliate code.');
    try {
      const info = await _buildAffiliateContract(provider).affiliateCode(code);
      owner = info?.owner ?? info?.[0] ?? null;
    } catch (_e) {
      throw new Error('Could not validate that affiliate code. Try again.');
    }
  }

  const ownerLower = String(owner || '').toLowerCase();
  const playerLower = String(player || '').toLowerCase();
  if (!ownerLower || ownerLower === ethers.ZeroAddress.toLowerCase()) {
    throw new Error('That affiliate code is not registered.');
  }
  if (playerLower && ownerLower === playerLower) {
    throw new Error('You cannot use your own affiliate code.');
  }
  return code;
}

/** The manually selected / link-captured referral used by first-buy writes. */
export function readStoredPurchaseAffiliateCode() {
  let code = null;
  try { code = localStorage.getItem('affiliate-ref'); } catch (_e) { /* private mode */ }
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(code || ''))) {
    try {
      const match = typeof document !== 'undefined'
        ? String(document.cookie || '').match(/(?:^|;\s*)dgn_ref=([^;]*)/)
        : null;
      code = match ? decodeURIComponent(match[1]) : null;
    } catch (_e) { code = null; }
  }
  return /^0x[0-9a-fA-F]{64}$/.test(String(code || '')) ? String(code).toLowerCase() : null;
}

/**
 * Validate and explicitly save a top-bar referral. Unlike automatic URL
 * capture, a player's deliberate edit may replace the prior browser default;
 * the contract still makes the actual referrer immutable after first buy.
 */
export async function savePurchaseAffiliateCode(raw, player = null) {
  const code = await validatePurchaseAffiliateCode(raw, player);
  const clear = code === ethers.ZeroHash;
  try {
    if (clear) localStorage.removeItem('affiliate-ref');
    else localStorage.setItem('affiliate-ref', code.toLowerCase());
  } catch (_e) { /* cookie remains as fallback */ }
  try {
    if (typeof document !== 'undefined') {
      document.cookie = clear
        ? 'dgn_ref=; max-age=0; path=/; SameSite=Lax'
        : `dgn_ref=${encodeURIComponent(code.toLowerCase())}; max-age=63072000; path=/; SameSite=Lax`;
    }
  } catch (_e) { /* storage remains as fallback */ }
  try {
    if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
      document.dispatchEvent(new CustomEvent(REFERRAL_CHANGED_EVENT, {
        detail: { code: clear ? null : code.toLowerCase() },
      }));
    }
  } catch (_e) { /* UI sync is best effort */ }
  return clear ? null : code.toLowerCase();
}

/**
 * Return the player's real immutable referrer, or null when none is assigned.
 *
 * The current Affiliate contract deliberately makes `getReferrer()` total: an
 * unset/locked/vault-coded slot returns VAULT rather than address(0). VAULT is
 * the reward sink, not a player referral, so UI visibility must treat it as
 * unassigned. A saved browser code is intentionally irrelevant to this read.
 */
export async function readPlayerReferrer(player) {
  const address = String(player || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) return null;
  const provider = getProvider();
  if (!provider) return null;
  const referrer = await _buildAffiliateContract(provider).getReferrer(address);
  const normalized = String(referrer || '').toLowerCase();
  const vault = String(CONTRACTS.VAULT || '').toLowerCase();
  return normalized
    && normalized !== ethers.ZeroAddress.toLowerCase()
    && (!vault || normalized !== vault)
    ? normalized
    : null;
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
 * @returns {string} An app-page referral URL. Default links use the player's
 *          plain address; registered vanity codes retain their bytes32 value.
 */
export function buildAffiliateUrl(addr, registeredCode = null) {
  const address = String(addr || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    throw new Error('A valid player address is required to build a referral link.');
  }
  const code = typeof registeredCode === 'string' && /^0x[0-9a-fA-F]{64}$/.test(registeredCode)
    ? registeredCode.toLowerCase()
    : address;
  return `https://degener.us/app/?ref=${code}`;
}

// ---------------------------------------------------------------------------
// Own registered code — reads (semantics fixed 2026-07-16).
//
// The `affiliate-code:{chain}:{addr}` localStorage key means exactly one
// thing: the player's OWN registered vanity code (written by
// createAffiliateCode above). The incoming referral lives separately in the
// site-wide /js/ref.js capture and only matters as a purchase-tx default
// (lootbox.js readAffiliateCode) — the referrer locks on-chain at the first
// purchase.
//
// resolveRegisteredCode is DB-FIRST: the indexer's affiliate_codes table is
// owner-keyed from type-1 Affiliate events (`/player/{addr}` →
// affiliate.ownCode), so it knows codes registered on ANY device. The
// localStorage fallback covers indexer downtime and the lag right after a
// register tx confirms — but values written before 2026-07-16 may be an
// INCOMING referral (the old persistAffiliateCodeFromUrl dual-write), so a
// stored code is only trusted after `affiliateCode[code].owner === addr`
// verifies on-chain.
// ---------------------------------------------------------------------------

const MAX_UINT160 = (1n << 160n) - 1n;

/** Is this a plausible registered vanity code (bytes32, above address range)? */
function _isVanityCode(hex) {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hex)) return false;
  try {
    const v = BigInt(hex);
    return v !== 0n && v > MAX_UINT160;
  } catch (_e) { return false; }
}

/**
 * Synchronous local read of the player's own registered code (this-device
 * registrations only; legacy dual-write values are shape-filtered but not
 * ownership-verified — use resolveRegisteredCode for the verified answer).
 * @param {string} addr
 * @returns {string|null} bytes32 hex or null.
 */
export function readRegisteredCode(addr) {
  if (!addr) return null;
  try {
    const key = `affiliate-code:${CHAIN.id}:${String(addr).toLowerCase()}`;
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(key) : null;
    return _isVanityCode(raw) ? raw : null;
  } catch (_e) { return null; }
}

async function _defaultFetchJSON(path) {
  return sharedFetchJSON(path);
}
// Test seam — mirrors pro-gate.js __setFetchJSONForTest.
let _fetchImpl = _defaultFetchJSON;
export function __setFetchJSONForTest(fn) { _fetchImpl = fn || _defaultFetchJSON; }

/**
 * The player's own registered vanity code, or null. DB first (cross-device,
 * authoritative), then the chain-verified localStorage fallback (see block
 * comment above). Any doubt (no provider, RPC error, owner mismatch) → null;
 * callers fall back to the address-derived default code, which always pays
 * the player.
 * @param {string} addr
 * @returns {Promise<string|null>} bytes32 hex or null.
 */
export async function resolveRegisteredCode(addr) {
  if (!addr) return null;

  // 1. Indexer — owner-keyed, cross-device.
  try {
    const payload = await _fetchImpl(`/player/${String(addr).toLowerCase()}`);
    const ownCode = payload?.affiliate?.ownCode;
    if (_isVanityCode(ownCode)) return ownCode;
  } catch (_e) { /* indexer unreachable → localStorage fallback below */ }

  // 2. localStorage candidate + on-chain ownership check (legacy guard).
  const stored = readRegisteredCode(addr);
  if (!stored) return null;
  try {
    const provider = getProvider();
    if (!provider) return null;
    const info = await _buildAffiliateContract(provider).affiliateCode(stored);
    const owner = info?.owner ?? info?.[0];
    if (owner && String(owner).toLowerCase() === String(addr).toLowerCase()) return stored;
  } catch (_e) { /* RPC hiccup → safe default */ }
  return null;
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
//      → encodedCode so readRegisteredCode paints the panel URL / share card
//      instantly on this device (the indexer catches up for other devices).
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

  // Persist the own code for readRegisteredCode (panel URL / share card).
  // Wrapped in try/catch for private-mode / quota safety (Pitfall F mirror).
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
