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
 *   2. error.reason / shortMessage — decoded require(..., "string") message;
 *                                  scanned for any seeded code name (substring match)
 *   3. UNKNOWN catch-all
 *
 * @param {Error|null|undefined} error - ethers v6 CallExceptionError or Error
 * @returns {{code: string, userMessage: string, recoveryAction: string}}
 */
export function decodeRevertReason(error) {
  if (!error) return UNKNOWN;
  // Primary: custom error match (ethers v6 ErrorDescription)
  const name = error.revert?.name;
  if (name && ERROR_REGISTRY.has(name)) return ERROR_REGISTRY.get(name);
  // Fallback: require-string match (legacy contract reverts)
  const reason = error.reason || error.shortMessage || '';
  for (const [key, mapping] of ERROR_REGISTRY) {
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
