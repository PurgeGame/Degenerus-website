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
    // `day` is the parimutuel benchmark's name for growthState.phaseDay; the
    // gold-rush slot0 decode calls the same contract field `jackpotCounter`
    // (polling.js:333). Reading only `day` pinned cnt to 0 for every caller
    // driven by the chain ticker, so the final-locked-window promotion could
    // only ever fire on a turbo (the one tier whose step alone reaches the cap).
    const cnt = Number(directIsCurrent
      ? contractPhase?.day ?? contractPhase?.jackpotCounter
      : gameState?.jackpotCounter) || 0;
    // /game/state currently omits this tier, so the direct contract snapshot
    // is what makes the three-day and one-day final locked windows exact.
    const comp = Number(
      directIsCurrent
        ? contractPhase?.compressedFlag ?? gameState?.compressedJackpotFlag
        : gameState?.compressedJackpotFlag,
    ) || 0;
    // `comp === 2`, NOT `>= 2`, and deliberately so. Everywhere the client
    // PRESENTS cadence it must use the contract's `>= 2` turbo test, because a
    // chained-arm tier 3 collapses the phase into one physical day. But this
    // function is a line-for-line port of the contract's own
    // `_activeTicketLevel` (DegenerusGameMintStreakUtils.sol:155-158), which
    // tests `comp == 2`. Its answer decides which level a buy is PRICED and
    // DELIVERED at, so it has to agree with the chain even where the chain is
    // idiosyncratic: on a tier-3 day the contract itself computes step 1 and
    // keeps routing to `level`. Widening this to `>= 2` would quote a level the
    // contract will not charge. Any change here belongs in the contract first.
    const step = comp === 2
      ? JACKPOT_LEVEL_CAP
      : (comp === 1 && cnt > 0 && cnt < JACKPOT_LEVEL_CAP - 1 ? 2 : 1);
    if (cnt + step >= JACKPOT_LEVEL_CAP) return level + 1;
  }

  return level;
}

/**
 * Level whose foil pack belongs in the Daily Drawing cabinet.
 *
 * This deliberately differs from `activeTicketLevel()` during the final
 * sealed RNG window. New buys may already route forward before that level's
 * last jackpot has actually run, but the cabinet must keep the current pack
 * seated through that draw. Once end-phase starts OR the same numeric level
 * has reached purchase cadence, the final jackpot is over and the cabinet
 * belongs to level + 1. Keeping purchase cadence on `level` made the handoff
 * move 311 -> 312 -> 311 and hid a real level-312 foil pack.
 */
export function foilPackDisplayLevel(gameState, contractPhase = null) {
  const level = Number(gameState?.level ?? contractPhase?.level);
  if (!Number.isFinite(level)) return null;

  // _endPhase is the first exact hand-off requested by the cabinet: from this
  // point onward the old level has no remaining jackpot presentation.
  if (gameState?.phaseTransitionActive === true) return level + 1;

  // Prefer the explicit /game/state cadence over the independently-polled
  // contract snapshot. If either API field still says JACKPOT, fail closed on
  // the current pack; this is what prevents a stale side poll from deleting it
  // before the final draw runs.
  const phase = String(gameState?.phase || '').toUpperCase();
  const apiSaysJackpot = gameState?.jackpotPhaseFlag === true || phase === 'JACKPOT';
  if (apiSaysJackpot) return level;

  const apiSaysPurchase = gameState?.jackpotPhaseFlag === false
    || phase === 'PURCHASE'
    || phase === 'MINT';
  if (apiSaysPurchase) return level + 1;

  // A direct phase snapshot is the fallback only when /game/state has no
  // cadence yet. Unknown state stays on the current level rather than ejecting
  // a pack speculatively.
  const directLevel = Number(contractPhase?.level);
  const directIsCurrent = typeof contractPhase?.jackpot === 'boolean'
    && (!Number.isFinite(directLevel) || directLevel === level);
  if (directIsCurrent && contractPhase.jackpot === false) return level + 1;
  return level;
}
