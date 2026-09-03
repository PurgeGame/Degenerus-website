// /app/app/reason-map.js — Phase 56 APP-05 (D-05 + D-11 LOCKED)
// Maps contract revert errors to friendly user messages + recovery actions.
//
// Pitfall 4 reconciliation: roadmap names "Taken" / "WindowClosed" do NOT exist as
// canonical contract custom errors. This seed uses the verified canonical aliases:
//   - "Taken" semantics       → InvalidToken         (DegenerusDeityPass.sol:50)
//   - "WindowClosed" semantics → NotDecimatorWindow  (FLIP.sol:109)
// Other 4 codes are verified canonical names from contracts-testnet/:
//   - NotTimeYet               (modules/DegenerusGameAdvanceModule.sol:44)
//   - MustMintToday            (modules/DegenerusGameAdvanceModule.sol:43)
//   - RngNotReady              (modules/DegenerusGameAdvanceModule.sol:45,
//                               modules/DegenerusGameDegeneretteModule.sol:49,
//                               modules/DegenerusGameLootboxModule.sol:45)
//   - E (catch-all)            (storage/DegenerusGameStorage.sol:210)
//
// Downstream phases (60+) extend the registry via register() per write surface.
// Source: docs.ethers.org/v6/api/utils/errors — CallExceptionError + ErrorDescription.

const ERROR_REGISTRY = new Map([
  ['NotTimeYet', {
    code: 'NotTimeYet',
    userMessage: "It's not time for this action yet — wait for the next phase.",
    recoveryAction: 'Wait and try again.',
  }],
  ['MustMintToday', {
    code: 'MustMintToday',
    userMessage: 'You must mint a luckbox today before claiming.',
    recoveryAction: 'Open a luckbox first, then retry.',
  }],
  ['RngNotReady', {
    code: 'RngNotReady',
    userMessage: 'Random outcome is still being generated. Try again in a few seconds.',
    recoveryAction: 'Wait 10s and retry.',
  }],
  ['E', {
    code: 'E',
    userMessage: 'An unexpected error occurred. Please try again.',
    recoveryAction: 'Retry; if it persists, refresh the page.',
  }],
  // Pitfall 4 alias: 'Taken' is not a canonical contract error name.
  // DegenerusDeityPass.sol:50 — `error InvalidToken();` is the symbol-already-claimed path.
  ['InvalidToken', {
    code: 'InvalidToken',
    userMessage: "Someone else already claimed this — try a different one.",
    recoveryAction: 'Pick a different option and retry.',
  }],
  // Pitfall 4 alias: 'WindowClosed' is not a canonical contract error name.
  // FLIP.sol:109 — `error NotDecimatorWindow();` is the claim-window-closed path.
  ['NotDecimatorWindow', {
    code: 'NotDecimatorWindow',
    userMessage: 'The decimator claim window is closed.',
    recoveryAction: 'Check upcoming windows in the calendar.',
  }],
]);

const UNKNOWN = {
  code: 'UNKNOWN',
  userMessage: 'Unexpected error — please try again.',
  recoveryAction: 'Refresh the page if this persists.',
};

// Native-currency failures happen outside Solidity, so they do not carry a
// contract custom-error selector. BrowserProvider also nests the useful RPC
// message differently by wallet (error.info.error, error.error, or cause).
// Recognize only provider-specific balance language here; a contract error
// named `Insufficient` is a separate domain failure and must keep flowing to
// the ABI/registry path.
const INSUFFICIENT_WALLET_FUNDS = {
  code: 'InsufficientWalletFunds',
  userMessage: "This wallet doesn't have enough ETH to cover the transaction and network fee.",
  recoveryAction: 'Add ETH or lower the amount, leaving a little extra for gas.',
};
const WALLET_FUNDS_TEXT = /(?:\boutoffunds\b|\bout of funds\b|insufficient (?:funds|balance) (?:for|to cover) (?:gas|the transaction|transaction|intrinsic|transfer|value)|funds for gas \* price \+ value|(?:funds|gas) required exceeds allowance|(?:sender|wallet|account)(?:'s)? (?:balance )?(?:is )?too low|doesn['’]t have enough funds|not enough funds to (?:send|cover))/i;

function _walletFundsMapping(error) {
  const pending = [error];
  const seen = new Set();
  let inspected = 0;
  while (pending.length > 0 && inspected < 64) {
    inspected += 1;
    const value = pending.pop();
    if (typeof value === 'string') {
      if (WALLET_FUNDS_TEXT.test(value)) return INSUFFICIENT_WALLET_FUNDS;
      continue;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const code = String(value.code || '');
    if (code.toUpperCase() === 'INSUFFICIENT_FUNDS' || WALLET_FUNDS_TEXT.test(code)) {
      return INSUFFICIENT_WALLET_FUNDS;
    }
    for (const key of [
      'message', 'shortMessage', 'reason', 'error', 'info', 'cause',
      'details', 'body', 'response', 'payload',
    ]) {
      try { pending.push(value[key]); } catch (_e) { /* hostile provider object */ }
    }
  }
  return null;
}

// Solidity `Panic(uint256)` — not a custom error, so it never matches the
// registry and used to land in UNKNOWN. It is common in this protocol's UI paths
// because token burns spend a balance directly (`balanceOf[from] -= amount`),
// and an under-funded spend underflows rather than reverting with a name.
const PANIC_SELECTOR = '0x4e487b71';
const PANIC_MESSAGES = new Map([
  [0x11, {
    code: 'Panic:0x11',
    userMessage: "That amount doesn't fit — usually more than the balance available.",
    recoveryAction: 'Lower the amount and try again.',
  }],
  [0x12, {
    code: 'Panic:0x12',
    userMessage: 'The contract divided by zero on this input.',
    recoveryAction: 'Change the amount and try again.',
  }],
  [0x01, {
    code: 'Panic:0x01',
    userMessage: 'The contract rejected this state as impossible.',
    recoveryAction: 'Refresh and retry; report it if it repeats.',
  }],
]);
const PANIC_GENERIC = {
  code: 'Panic',
  userMessage: 'The numbers did not add up on-chain.',
  recoveryAction: 'Adjust the amount and try again.',
};

/** Panic mapping when `error` is a Solidity panic, else null. */
function _panicMapping(error) {
  const data = typeof error.data === 'string' ? error.data
    : (typeof error.revert?.data === 'string' ? error.revert.data : null);
  const reason = String(error.reason || error.shortMessage || '');
  let code = null;
  if (data && data.startsWith(PANIC_SELECTOR)) {
    // 32-byte code word follows the selector.
    const word = data.slice(10, 74);
    if (word) {
      try { code = Number(BigInt('0x' + word)); } catch (_e) { code = null; }
    }
  } else if (/panic code/i.test(reason)) {
    const m = /panic code (0x[0-9a-f]+|\d+)/i.exec(reason);
    if (m) {
      try { code = Number(BigInt(m[1])); } catch (_e) { code = null; }
    }
  } else {
    return null;
  }
  return PANIC_MESSAGES.get(code) || PANIC_GENERIC;
}

/**
 * Decode an ethers v6 CallExceptionError into a user-facing object.
 *
 * Lookup priority (per ethers v6 docs):
 *   1. error.revert?.name        — custom error matched against Contract ABI
 *                                  (ethers v6 ErrorDescription)
 *   2. error.revert?.selector or error.data prefix — 4-byte selector lookup
 *                                  for ABI-unresolved custom errors
 *   3. error.reason / shortMessage — decoded require(..., "string") message;
 *                                  scanned for any seeded code name (substring match,
 *                                  catch-all single-char 'E' skipped — WR-02)
 *   4. UNKNOWN catch-all
 *
 * @param {Error|null|undefined} error - ethers v6 CallExceptionError or Error
 * @returns {{code: string, userMessage: string, recoveryAction: string}}
 */
export function decodeRevertReason(error) {
  if (!error) return UNKNOWN;
  // Primary: custom error match (ethers v6 ErrorDescription)
  const name = error.revert?.name;
  if (name && ERROR_REGISTRY.has(name)) return ERROR_REGISTRY.get(name);
  // Selector lookup: ethers v6 ErrorDescription exposes the 4-byte selector
  // for unrecognized custom errors via error.revert.selector. Some call sites
  // also expose raw error.data starting with the selector (first 10 chars
  // including '0x'). WR-03: register() advertises selector-keyed mappings,
  // so decodeRevertReason must honor that path before the substring fallback.
  const selector = error.revert?.selector
    || (typeof error.data === 'string' && error.data.startsWith('0x')
      ? error.data.slice(0, 10)
      : null);
  if (selector && ERROR_REGISTRY.has(selector)) return ERROR_REGISTRY.get(selector);
  // Solidity panic — checked before the substring fallback so its own reason
  // text ("panic code 0x11 ...") cannot collide with a registered name.
  const panic = _panicMapping(error);
  if (panic) return panic;
  // Provider/native-balance failures have no Solidity selector. Inspect the
  // bounded nested error chain before falling through to the generic copy.
  const walletFunds = _walletFundsMapping(error);
  if (walletFunds) return walletFunds;
  // Fallback: require-string match (legacy contract reverts).
  // WR-02: the catch-all 'E' is a single-character key — substring-matching it
  // produces false positives on any reason that happens to contain capital 'E'
  // (e.g. "Error: ..."). Skip it on the substring path; it remains reachable
  // via the revert.name path above for legitimate `error E()` reverts.
  const reason = error.reason || error.shortMessage || '';
  for (const [key, mapping] of ERROR_REGISTRY) {
    if (key === 'E') continue;
    if (reason.includes(key)) return mapping;
  }
  return UNKNOWN;
}

/**
 * Register a new error mapping. Phase 60+ extends per write surface.
 * Idempotent: re-registering the same key replaces the prior mapping without throwing.
 *
 * @param {string} selectorOrName - Custom error name (e.g. 'LootboxSoldOut') or 4-byte selector
 * @param {{code: string, userMessage: string, recoveryAction: string}} mapping
 */
export function register(selectorOrName, mapping) {
  ERROR_REGISTRY.set(selectorOrName, mapping);
}

// ---------------------------------------------------------------------------
// Phase 60 (Plan 60-02) extensions — LBX write-path errors registered at module
// load time so codes are available regardless of whether lootbox.js is imported.
// Sourced from grep `error\s+\w+\(` in contracts/modules/ + contracts/DegenerusGame.sol:
//   - GameOverPossible    contracts/modules/DegenerusGameMintModule.sol:78
//   - AfKingLockActive    contracts/DegenerusGame.sol:92
//   - NotApproved         contracts/DegenerusGame.sol:95
// RngNotReady is already in the Phase 56 baseline above.
// ---------------------------------------------------------------------------

register('GameOverPossible', {
  code: 'GameOverPossible',
  userMessage: "FLIP ticket purchases are blocked right now — game-over risk detected.",
  recoveryAction: 'Try again after the next jackpot resolves, or use ETH instead.',
});

register('AfKingLockActive', {
  code: 'AfKingLockActive',
  userMessage: 'Affiliate king lock is active — purchases are temporarily paused.',
  recoveryAction: 'Try again in a few minutes.',
});

// openBox / requestLootboxRng during the daily RNG lock
// (DegenerusGameLootboxModule.openBox:1264, `error RngLocked()` at
// storage/DegenerusGameStorage.sol:246). Unmapped, this read as the UNKNOWN
// catch-all's "unexpected error" for a lock that always clears within the day.
register('RngLocked', {
  code: 'RngLocked',
  userMessage: 'Box opening is locked while today\'s draw settles.',
  recoveryAction: 'Try again once the lock clears later today.',
});

register('NotApproved', {
  code: 'NotApproved',
  userMessage: "You're not approved to act on behalf of this player.",
  recoveryAction: 'Connect to your own wallet to act.',
});

// ---------------------------------------------------------------------------
// Phase 63 (Plan 63-01) extensions — WalletConnect deep-link / session errors.
// Sourced from CITED docs.reown.com (HTTP 401/403/1013) + JSON-RPC 2.0 standard
// (4001 user-rejected) + verified WC bundle error symbols.
// RESEARCH §Example 3 lines 681-716.
// ---------------------------------------------------------------------------

register('UserRejected', {
  code: 'UserRejected',
  userMessage: 'You rejected the connection request.',
  recoveryAction: 'Tap Connect again to retry.',
});

register('SessionExpired', {
  code: 'SessionExpired',
  userMessage: 'Your wallet session expired. Please reconnect.',
  recoveryAction: 'Tap Connect to start a new session.',
});

register('RateLimited', {
  code: 'RateLimited',
  userMessage: 'Too many requests. Wait a moment and try again.',
  recoveryAction: 'Retry in a few seconds.',
});

register('ProjectIdInvalid', {
  code: 'ProjectIdInvalid',
  userMessage: 'WalletConnect configuration error. Contact support.',
  recoveryAction: 'Refresh the page; if it persists, file a bug.',
});

register('USER_DISCONNECTED', {
  code: 'USER_DISCONNECTED',
  userMessage: 'Wallet disconnected.',
  recoveryAction: 'Tap Connect to reconnect.',
});
