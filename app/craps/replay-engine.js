/**
 * Browser presentation replay for a sealed Craps battle.
 *
 * Settlement authority remains the verified materializer. This module decomposes that
 * already-verified shooter result into exact roll-sized visual changes, then proves its
 * decomposition by meeting every stored bankroll-ladder checkpoint byte-for-byte.
 */

import {
  CRAPS_REPLAY_LEG_ORDER,
  CrapsReplayValidationError,
  decodeCrapsReplayBase64,
  validateCrapsReplayManifest,
  validateCrapsReplayPlayer,
} from './replay-contract.js';

export const CRAPS_REPLAY_FLIP_WEI = 10n ** 18n;
// Mirrors `Craps._ESC_HANDS` / `Craps._ESC_CAP`. BOTH moved at the 2026-08-29 re-vendor: the
// escalator doubles every 3 shooters (was 5) and its ceiling widened from the implicit uint16 to
// uint32.max, because a 16-bit lane flattened the mandatory wager from the 48th shooter on and
// capped the RUN rather than the dice. Stale here, the replay recomputes a different wager than
// the chain charged and every seat fails its stored bankroll ladder with a drift error.
export const CRAPS_REPLAY_ESCALATOR_SHOOTERS = 3n;
export const CRAPS_REPLAY_MAX_WAGER_MULTIPLIER = (1n << 32n) - 1n;

const UINT128 = (1n << 128n) - 1n;
const HAND_RETURN_MASK = (1n << 112n) - 1n;
const POINT_TOTALS = new Set([4, 5, 6, 8, 9, 10]);
const BET_IDS = Object.freeze([
  'pass', 'place-4', 'place-5', 'place-6', 'place-8',
  'place-9', 'place-10', 'hard-4', 'hard-8', 'dont-pass',
]);
const PLACE_TOTALS = Object.freeze([4, 5, 6, 8, 9, 10]);
const PLACE_INDEX = Object.freeze(new Map(PLACE_TOTALS.map((total, index) => [total, index + 1])));

export class CrapsReplayDriftError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CrapsReplayDriftError';
    this.details = Object.freeze({ ...details });
  }
}

function uint32be(bytes, offset) {
  return (((bytes[offset] << 24) >>> 0)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]) >>> 0;
}

/** Decode and structurally verify the one-byte-per-roll shared tape. */
export function decodeCrapsReplayTape(manifestInput) {
  const manifest = validateCrapsReplayManifest(manifestInput);
  const rollBytes = decodeCrapsReplayBase64(manifest.tape.rolls, 'manifest.tape.rolls');
  const offsetBytes = decodeCrapsReplayBase64(manifest.tape.handOffsets, 'manifest.tape.handOffsets');
  if (rollBytes.length !== manifest.tape.totalRolls) {
    throw new CrapsReplayValidationError('manifest.tape.rolls', `decoded ${rollBytes.length} bytes, expected ${manifest.tape.totalRolls}`);
  }
  if (offsetBytes.length !== manifest.tape.maxHands * 4) {
    throw new CrapsReplayValidationError('manifest.tape.handOffsets', `decoded ${offsetBytes.length} bytes, expected ${manifest.tape.maxHands * 4}`);
  }
  const offsets = [];
  for (let index = 0; index < manifest.tape.maxHands; index += 1) {
    const offset = uint32be(offsetBytes, index * 4);
    if (index === 0 && offset !== 0) {
      throw new CrapsReplayValidationError('manifest.tape.handOffsets[0]', 'first shooter must start at zero');
    }
    if (offset >= rollBytes.length || (index > 0 && offset <= offsets[index - 1])) {
      throw new CrapsReplayValidationError(`manifest.tape.handOffsets[${index}]`, 'offsets must be strictly increasing inside the tape');
    }
    offsets.push(offset);
  }
  const hands = offsets.map((start, shooter) => {
    const end = offsets[shooter + 1] ?? rollBytes.length;
    const rolls = [];
    for (let index = start; index < end; index += 1) {
      const packed = rollBytes[index];
      const d1 = packed >> 4;
      const d2 = packed & 0x0f;
      if (d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6) {
        throw new CrapsReplayValidationError(`manifest.tape.rolls[${index}]`, 'die is outside 1..6');
      }
      rolls.push(Object.freeze({ d1, d2, total: d1 + d2 }));
    }
    return Object.freeze(rolls);
  });
  return Object.freeze({
    totalRolls: rollBytes.length,
    offsets: Object.freeze(offsets),
    hands: Object.freeze(hands),
  });
}

export function crapsReplayWagerMultiplier(shooter) {
  const ordinal = typeof shooter === 'bigint' ? shooter : BigInt(shooter);
  // The contract guards the shift itself (`shift < 32`) because 1 << 32 overflows its lane.
  // BigInt does not overflow, but the cap below must land identically either way.
  const shift = ordinal / CRAPS_REPLAY_ESCALATOR_SHOOTERS;
  const multiplier = shift < 32n ? 1n << shift : CRAPS_REPLAY_MAX_WAGER_MULTIPLIER;
  return multiplier > CRAPS_REPLAY_MAX_WAGER_MULTIPLIER
    ? CRAPS_REPLAY_MAX_WAGER_MULTIPLIER
    : multiplier;
}

function boardOf(player) {
  return Object.freeze(Object.fromEntries(
    CRAPS_REPLAY_LEG_ORDER.map((leg, index) => [leg, BigInt(player.resolvedBoardWei[index])]),
  ));
}

function boardStake(board) {
  return CRAPS_REPLAY_LEG_ORDER.reduce((sum, leg) => sum + board[leg], 0n);
}

function placeWin(board, total) {
  const stake = board[`place${total}`];
  if (total === 4 || total === 10) return stake * 2n;
  if (total === 5 || total === 9) return (stake * 3n) / 2n;
  return (stake * 7n) / 6n;
}

function dontReturn(board) {
  return board.dontPass + (board.dontPass * 3n) / 4n;
}

function unique(values) {
  return Object.freeze([...new Set(values)]);
}

function genericRollLabel({ total, comeOut, pointBefore, pointAfter, sevenOut }) {
  if (sevenOut) return 'SEVEN OUT';
  if (comeOut && pointAfter !== 0) return `POINT ${pointAfter} SET`;
  if (!comeOut && total === pointBefore) return `POINT ${pointBefore} MADE`;
  if (comeOut && (total === 7 || total === 11)) return total === 7 ? 'COME-OUT 7' : 'YO 11';
  if (comeOut && (total === 2 || total === 3 || total === 12)) return `CRAPS ${total}`;
  return `${total} ROLLED`;
}

/**
 * Decompose one base-board shooter into roll events. `returnedWei` mirrors the contract;
 * `equityDeltaWei` is the visually useful change after counting still-live felt principal.
 */
function traceHand(board, rolls) {
  const hasPass = board.passLine !== 0n;
  let passLive = hasPass;
  let dontLive = board.dontPass !== 0n;
  let hard4Live = board.hard4 !== 0n;
  let hard8Live = board.hard8 !== 0n;
  let point = 0;
  let sevenOut = false;
  let returned = 0n;
  let eligible = 0n;
  let dontWon = false;
  const events = [];

  const lose = (betId, stake, lostBets, delta) => {
    if (stake === 0n) return delta;
    lostBets.push(betId);
    return delta - stake;
  };

  for (let rollIndex = 0; rollIndex < rolls.length; rollIndex += 1) {
    const roll = rolls[rollIndex];
    const total = roll.total;
    const pointBefore = point;
    const comeOut = point === 0;
    const payoutBets = [];
    const lostBets = [];
    let returnedThisRoll = 0n;
    let equityDelta = 0n;

    const lightWin = (betId, amount) => {
      if (amount === 0n) return;
      payoutBets.push(betId);
      returnedThisRoll += amount;
      equityDelta += amount;
    };
    const darkWin = () => {
      if (!dontLive || board.dontPass === 0n) return;
      const amount = dontReturn(board);
      payoutBets.push('dont-pass');
      returnedThisRoll += amount;
      equityDelta += amount - board.dontPass;
      dontWon = true;
      dontLive = false;
    };

    if (total === 7 && !comeOut) {
      darkWin();
      if (passLive) { equityDelta = lose('pass', board.passLine, lostBets, equityDelta); passLive = false; }
      for (const placeTotal of PLACE_TOTALS) {
        equityDelta = lose(`place-${placeTotal}`, board[`place${placeTotal}`], lostBets, equityDelta);
      }
      if (hard4Live) { equityDelta = lose('hard-4', board.hard4, lostBets, equityDelta); hard4Live = false; }
      if (hard8Live) { equityDelta = lose('hard-8', board.hard8, lostBets, equityDelta); hard8Live = false; }
      sevenOut = true;
    } else {
      if (!comeOut) {
        if (POINT_TOTALS.has(total)) lightWin(`place-${total}`, placeWin(board, total));
        if (total === 4 && hard4Live) {
          if (roll.d1 === roll.d2) lightWin('hard-4', board.hard4 * 7n);
          else { equityDelta = lose('hard-4', board.hard4, lostBets, equityDelta); hard4Live = false; }
        } else if (total === 8 && hard8Live) {
          if (roll.d1 === roll.d2) lightWin('hard-8', board.hard8 * 9n);
          else { equityDelta = lose('hard-8', board.hard8, lostBets, equityDelta); hard8Live = false; }
        }
      }

      if (comeOut) {
        if (hasPass) {
          if (total === 7 || total === 11) {
            if (passLive) lightWin('pass', board.passLine);
            if (dontLive) { equityDelta = lose('dont-pass', board.dontPass, lostBets, equityDelta); dontLive = false; }
          } else if (total === 12) {
            if (passLive) { equityDelta = lose('pass', board.passLine, lostBets, equityDelta); passLive = false; }
          } else if (total === 2 || total === 3) {
            if (passLive) { equityDelta = lose('pass', board.passLine, lostBets, equityDelta); passLive = false; }
            darkWin();
          } else {
            point = total;
          }
        } else if (POINT_TOTALS.has(total)) {
          point = total;
        } else if (dontLive) {
          if (total === 2 || total === 3) darkWin();
          else if (total !== 12) { equityDelta = lose('dont-pass', board.dontPass, lostBets, equityDelta); dontLive = false; }
        }
      } else if (total === point) {
        if (hasPass && passLive) lightWin('pass', board.passLine);
        if (dontLive) { equityDelta = lose('dont-pass', board.dontPass, lostBets, equityDelta); dontLive = false; }
        point = 0;
      }
    }

    returned += returnedThisRoll;
    eligible += returnedThisRoll;
    events.push({
      rollIndex,
      d1: roll.d1,
      d2: roll.d2,
      total,
      comeOut,
      pointBefore,
      pointAfter: point,
      sevenOut,
      label: genericRollLabel({ total, comeOut, pointBefore, pointAfter: point, sevenOut }),
      payoutBets: unique(payoutBets),
      lostBets: unique(lostBets),
      retiredBets: unique([
        ...lostBets,
        ...(payoutBets.includes('dont-pass') ? ['dont-pass'] : []),
      ]),
      returnedWei: returnedThisRoll,
      equityDeltaWei: equityDelta,
    });
    if (sevenOut) break;
  }

  // The shared tape ends exactly where the contract does. If that is the 512-roll cap rather
  // than a seven-out, live principal is refunded by settlement but creates no equity change:
  // the presentation already counted those chips while they sat on the felt.
  if (!sevenOut) {
    if (hasPass && passLive) returned += board.passLine;
    for (const total of PLACE_TOTALS) returned += board[`place${total}`];
    if (hard4Live) returned += board.hard4;
    if (hard8Live) returned += board.hard8;
    if (dontLive) returned += board.dontPass;
  }

  // A winning dark return includes principal. The boost applies only to profit.
  if (dontWon) eligible -= board.dontPass;
  return {
    events,
    returnedWei: returned & UINT128,
    eligibleWei: eligible,
    sevenOut,
  };
}

function scheduleMap(entries) {
  return new Map(entries.map((entry) => [entry.shooter, entry]));
}

function drift(message, player, shooter, extra = {}) {
  throw new CrapsReplayDriftError(message, {
    betId: player.betId,
    shooter,
    ...extra,
  });
}

/** Replay one verified seat and return exact presentation events for every roll it played. */
export function replayCrapsSeat(manifestInput, playerInput, decodedTape = null) {
  const manifest = validateCrapsReplayManifest(manifestInput);
  const player = validateCrapsReplayPlayer(playerInput);
  const tape = decodedTape ?? decodeCrapsReplayTape(manifest);
  if (player.handsPlayed > tape.hands.length) {
    drift('seat plays beyond the shared tape', player, player.handsPlayed, { maxHands: tape.hands.length });
  }
  const board = boardOf(player);
  const stakeWei = boardStake(board);
  if (stakeWei !== BigInt(manifest.terms.boardStakeWei)) {
    drift('resolved board does not equal the battle board stake', player, 0, {
      expectedWei: manifest.terms.boardStakeWei,
      actualWei: stakeWei.toString(),
    });
  }
  const boosts = scheduleMap(player.boosts);
  const survivals = scheduleMap(player.survivals);
  const hands = [];
  let countedRolls = 0;

  for (let shooter = 0; shooter < player.handsPlayed; shooter += 1) {
    const bankrollBeforeSurvival = BigInt(player.ladderWei[shooter]);
    const multiplier = crapsReplayWagerMultiplier(shooter);
    const needWei = stakeWei * multiplier;
    const survival = survivals.get(shooter) ?? null;
    let bankrollAtDeal = bankrollBeforeSurvival;
    if (bankrollAtDeal < needWei) {
      if (bankrollAtDeal * 2n < needWei) {
        drift('seat played a shooter while below the survival range', player, shooter, {
          bankrollWei: bankrollAtDeal.toString(),
          needWei: needWei.toString(),
        });
      }
      if (!survival?.survived) drift('played survival-range shooter lacks a winning flip', player, shooter);
      bankrollAtDeal *= 2n;
    } else if (survival) {
      drift('survival flip recorded for an affordable shooter', player, shooter);
    }

    const hand = traceHand(board, tape.hands[shooter]);
    countedRolls += hand.events.length;
    const boost = boosts.get(shooter) ?? null;
    const boostWei = boost ? (hand.eligibleWei * BigInt(boost.percent)) / 100n : 0n;
    const returnedWei = (hand.returnedWei + boostWei) & HAND_RETURN_MASK;
    const expectedEnd = bankrollAtDeal - needWei + (multiplier * returnedWei);
    const storedEnd = BigInt(player.ladderWei[shooter + 1]);
    // A failed survival flip is attempted BETWEEN shooters. Solidity first pushes the
    // just-completed hand's bankroll, then overwrites that ladder tail with zero when the
    // coin loses. Preserve the pre-flip figure for the roll animation and validate the zero
    // tail separately below.
    const failedAfterThisHand = shooter === player.handsPlayed - 1
      && survivals.get(player.handsPlayed)?.survived === false;
    if (!failedAfterThisHand && expectedEnd !== storedEnd) {
      drift('roll replay missed the stored bankroll ladder', player, shooter, {
        expectedWei: storedEnd.toString(),
        replayedWei: expectedEnd.toString(),
      });
    }
    if (failedAfterThisHand) {
      const nextNeed = stakeWei * crapsReplayWagerMultiplier(shooter + 1);
      if (expectedEnd >= nextNeed || expectedEnd * 2n < nextNeed || storedEnd !== 0n) {
        drift('failed survival flip is inconsistent with the next shooter affordability', player, shooter, {
          bankrollWei: expectedEnd.toString(),
          nextNeedWei: nextNeed.toString(),
          storedWei: storedEnd.toString(),
        });
      }
    }

    let visualBankroll = bankrollAtDeal;
    const events = hand.events.map((raw, rollIndex) => {
      let deltaWei = raw.equityDeltaWei * multiplier;
      const last = rollIndex === hand.events.length - 1;
      if (last) deltaWei += boostWei * multiplier;
      visualBankroll += deltaWei;
      if (last && visualBankroll !== (failedAfterThisHand ? expectedEnd : storedEnd)) {
        drift('visual roll deltas missed the stored bankroll ladder', player, shooter, {
          expectedWei: (failedAfterThisHand ? expectedEnd : storedEnd).toString(),
          replayedWei: visualBankroll.toString(),
        });
      }
      return Object.freeze({
        ...raw,
        shooter,
        globalRoll: tape.offsets[shooter] + rollIndex,
        multiplier: multiplier.toString(),
        bankrollBeforeWei: (visualBankroll - deltaWei).toString(),
        bankrollAfterWei: visualBankroll.toString(),
        deltaWei: deltaWei.toString(),
        returnedWei: (raw.returnedWei * multiplier).toString(),
        boostWei: last ? (boostWei * multiplier).toString() : '0',
        // `percent` is the COMBINED uplift (audit 8777c7d99): the schedule's draw plus a flat
        // +5 on the one hand the field's ROTATING SHOOTER handed this seat. `rotation` names
        // which of the two is present so the table can label the turn rather than just the
        // number — the two can also coincide on the same hand.
        shooterBoost: boost
          ? Object.freeze({ percent: boost.percent, rotation: boost.rotation === true })
          : null,
        terminal: last && shooter === player.handsPlayed - 1 ? player.stop : '',
      });
    });
    hands.push(Object.freeze({
      shooter,
      multiplier: multiplier.toString(),
      bankrollBeforeSurvivalWei: bankrollBeforeSurvival.toString(),
      bankrollAtDealWei: bankrollAtDeal.toString(),
      bankrollAfterWei: (failedAfterThisHand ? expectedEnd : storedEnd).toString(),
      survival,
      boost,
      events: Object.freeze(events),
    }));
  }

  if (countedRolls !== player.totalRolls) {
    drift('seat roll count does not match its verified settlement', player, player.handsPlayed, {
      expectedRolls: player.totalRolls,
      replayedRolls: countedRolls,
    });
  }
  const finalBankroll = BigInt(player.ladderWei[player.handsPlayed]);
  const replayedWon = finalBankroll * BigInt(player.entryMultiple);
  if (replayedWon !== BigInt(player.wonWei)) {
    drift('seat won amount does not match its ladder tail', player, player.handsPlayed, {
      expectedWei: player.wonWei,
      replayedWei: replayedWon.toString(),
    });
  }

  const failedSurvival = survivals.get(player.handsPlayed);
  if (failedSurvival?.survived) {
    drift('winning survival flip must be followed by a played shooter', player, player.handsPlayed);
  }
  if (failedSurvival && finalBankroll !== 0n) {
    drift('lost survival flip must leave a zero ladder tail', player, player.handsPlayed);
  }
  return Object.freeze({
    player,
    board,
    stakeWei: stakeWei.toString(),
    hands: Object.freeze(hands),
    events: Object.freeze(hands.flatMap((hand) => hand.events)),
    failedSurvival: failedSurvival ?? null,
  });
}

/** Replay a viewer and the featured union once; shared dice remain a single tape. */
export function replayCrapsViewport(manifestInput, featuredPlayers = [], viewerInput = null) {
  const manifest = validateCrapsReplayManifest(manifestInput);
  const tape = decodeCrapsReplayTape(manifest);
  const inputs = [...featuredPlayers];
  if (viewerInput && !inputs.some((player) => String(player.betId) === String(viewerInput.betId))) {
    inputs.push(viewerInput);
  }
  const seats = Object.freeze(inputs.map((player) => replayCrapsSeat(manifest, player, tape)));
  const byBetId = new Map(seats.map((seat) => [seat.player.betId, seat]));
  return Object.freeze({ manifest, tape, seats, byBetId });
}

export const CRAPS_REPLAY_BET_IDS = BET_IDS;
export const CRAPS_REPLAY_PLACE_INDEX = PLACE_INDEX;
