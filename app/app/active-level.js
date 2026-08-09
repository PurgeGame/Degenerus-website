// /app/app/active-level.js — the level a buy made RIGHT NOW routes to.
//
// JS port of the contract's `_activeTicketLevel()`
// (contracts/modules/DegenerusGameMintStreakUtils.sol:153), which is the single
// on-chain source of truth for:
//
//   - the ticket price quote and charge (MintModule._purchaseCostInputs →
//     PriceLookupLib.priceForLevel(_activeTicketLevel())),
//   - the ticket delivery level (which draw the entries resolve into),
//   - the foil pack's one-per-level key (FoilPackModule.buyFoilPack:214) and
//     therefore its FoilAlreadyBought guard,
//   - mint-streak/participation recording.
//
// Lives in its own module because FOUR widgets need the same answer and the
// naive `jackpotPhase ? level : level + 1` shorthand they each carried was
// wrong in the SEALED WINDOW: once a level's final jackpot day locks its RNG
// (or _endPhase starts draining the transition), that level seals no further
// daily draw, so buys already route to level + 1 while the shorthand still says
// `level`. In the buy panel that showed up as the foil-pack row staying hidden
// on an already-owned level through the tail of jackpot phase — the widget
// looked like it never came back — and as a stale price on the Buy button.

// Jackpot days per level — DegenerusGameMintStreakUtils.sol:26 (identical
// private constant in DegenerusGameJackpotModule.sol:166).
export const JACKPOT_LEVEL_CAP = 5;

/**
 * @param {object|null} gameState /game/state payload (level, jackpotPhaseFlag,
 *   phase, phaseTransitionActive, rngLockedFlag, jackpotCounter).
 * @param {object|null} contractPhase Direct purchaseInfo/growthState cadence
 *   snapshot ({level, jackpot, rngLocked, day, compressedFlag}). It wins only
 *   while it describes the same level, so an old side-bet poll can never move
 *   a newly advanced game backwards.
 * @returns {number|null} the routed buy level, or null when the payload has no
 *   usable level (caller should treat as "unknown", not as level 0).
 */
export function activeTicketLevel(gameState, contractPhase = null) {
  const level = Number(gameState?.level ?? contractPhase?.level);
  if (!Number.isFinite(level)) return null;

  const directLevel = Number(contractPhase?.level);
  const directIsCurrent = typeof contractPhase?.jackpot === 'boolean'
    && (!Number.isFinite(directLevel) || directLevel === level);

  const jackpotPhase = directIsCurrent
    ? contractPhase.jackpot
    : Boolean(gameState?.jackpotPhaseFlag ?? (gameState?.phase === 'JACKPOT'));
  if (!jackpotPhase) return level + 1;

  // _endPhase ran: jackpotCounter is already zeroed, so the counter test below
  // can no longer key off the sealed level. This flag is the standalone signal
  // that the level's draws have ended.
  if (gameState?.phaseTransitionActive === true) return level + 1;

  const rngLocked = directIsCurrent && typeof contractPhase?.rngLocked === 'boolean'
    ? contractPhase.rngLocked
    : gameState?.rngLockedFlag === true;
  if (rngLocked) {
    const cnt = Number(directIsCurrent ? contractPhase?.day : gameState?.jackpotCounter) || 0;
    // /game/state currently omits this tier, so the direct contract snapshot
    // is what makes the three-day and one-day final locked windows exact.
    const comp = Number(
      directIsCurrent ? contractPhase?.compressedFlag : gameState?.compressedJackpotFlag,
    ) || 0;
    const step = comp === 2
      ? JACKPOT_LEVEL_CAP
      : (comp === 1 && cnt > 0 && cnt < JACKPOT_LEVEL_CAP - 1 ? 2 : 1);
    if (cnt + step >= JACKPOT_LEVEL_CAP) return level + 1;
  }

  return level;
}
