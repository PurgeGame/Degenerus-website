// /app/app/reason-map.js — Phase 56 APP-05 (D-05 + D-11 LOCKED)
// Maps contract revert errors to friendly user messages + recovery actions.
//
// Pitfall 4 reconciliation: roadmap names "Taken" / "WindowClosed" do NOT exist as
// canonical contract custom errors. This seed uses the verified canonical aliases:
//   - "Taken" semantics       → InvalidToken         (DegenerusDeityPass.sol:50)
//   - "WindowClosed" semantics → NotDecimatorWindow  (BurnieCoin.sol:109)
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
    userMessage: 'You must mint a lootbox today before claiming.',
    recoveryAction: 'Open a lootbox first, then retry.',
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
  // BurnieCoin.sol:109 — `error NotDecimatorWindow();` is the claim-window-closed path.
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
  userMessage: "BURNIE ticket purchases are blocked right now — game-over risk detected.",
  recoveryAction: 'Try again after the next jackpot resolves, or use ETH instead.',
});

register('AfKingLockActive', {
  code: 'AfKingLockActive',
  userMessage: 'Affiliate king lock is active — purchases are temporarily paused.',
  recoveryAction: 'Try again in a few minutes.',
});

register('NotApproved', {
  code: 'NotApproved',
  userMessage: "You're not approved to act on behalf of this player.",
  recoveryAction: 'Connect to your own wallet to act.',
});
