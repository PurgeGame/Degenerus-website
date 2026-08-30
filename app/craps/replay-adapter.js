/** Convert sealed replay artifacts into the current Craps table's presentation model. */

import {
  CRAPS_REPLAY_LEG_ORDER,
  assertSupportedCrapsReplayRuleset,
  loadCrapsReplay,
  validateCrapsReplayCollection,
  validateCrapsReplayPlayer,
} from './replay-contract.js';
import {
  CRAPS_REPLAY_BET_IDS,
  CRAPS_REPLAY_FLIP_WEI,
  replayCrapsViewport,
} from './replay-engine.js';
import { fetchProfiles } from '../app/profiles.js';

const TEN = 10n;
const CRAPS_PROFILE_BATCH_SIZE = 8;
const CRAPS_PROFILE_MAX_ADDRESSES = 160;

function displayFlip(wei) {
  return (BigInt(wei) / CRAPS_REPLAY_FLIP_WEI).toString();
}

function boardChipCounts(player, manifest) {
  const chipWei = BigInt(manifest.terms.boardStakeWei) / TEN;
  if (chipWei <= 0n || BigInt(manifest.terms.boardStakeWei) % TEN !== 0n) {
    throw new TypeError('Craps replay board stake must divide into ten equal chips');
  }
  return Object.freeze(Object.fromEntries(CRAPS_REPLAY_BET_IDS.map((betId, index) => {
    const amount = BigInt(player.resolvedBoardWei[index]);
    if (amount % chipWei !== 0n) throw new TypeError(`Craps replay ${player.betId} ${CRAPS_REPLAY_LEG_ORDER[index]} is not an equal-chip amount`);
    return [betId, Number(amount / chipWei)];
  })));
}

function shooterBoostSchedule(player, maxHands) {
  const boosts = new Map(player.boosts.map((entry) => [entry.shooter, Object.freeze({ percent: entry.percent })]));
  return Object.freeze(Array.from({ length: maxHands }, (_, shooter) => boosts.get(shooter) ?? null));
}

function rollsHex(tape) {
  const bytes = [];
  tape.hands.forEach((hand) => {
    hand.forEach((roll) => bytes.push((roll.d1 << 4) | roll.d2));
    bytes.push(0);
  });
  return `0x${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function survivalAfterHand(trace, shooter) {
  const nextPlayed = trace.hands[shooter + 1]?.survival;
  if (nextPlayed) return Object.freeze({ survived: true });
  if (trace.failedSurvival?.shooter === shooter + 1) return Object.freeze({ survived: false });
  return null;
}

function survivalSchedule(trace, maxHands) {
  return Object.freeze(Array.from({ length: maxHands }, (_, shooter) => survivalAfterHand(trace, shooter)));
}

function battleClock(viewport) {
  const sharedByRoll = new Map();
  for (const trace of viewport.seats) {
    for (const event of trace.events) {
      if (!sharedByRoll.has(event.globalRoll)) sharedByRoll.set(event.globalRoll, event);
    }
  }
  return Object.freeze([...sharedByRoll.values()]
    .sort((left, right) => left.globalRoll - right.globalRoll));
}

function traceTerminal(trace) {
  const exact = String(trace.events.at(-1)?.terminal ?? '').toLowerCase();
  if (exact === 'goal' || exact === 'bust') return exact;
  return trace.player.stop === 'goal' ? 'goal' : 'bust';
}

function viewerFrames(trace, clock) {
  const viewerByRoll = eventAtGlobalRoll(trace);
  const personalTerminal = traceTerminal(trace);
  const personalLastRoll = trace.events.at(-1)?.globalRoll ?? -1;
  const finalBankroll = trace.player.ladderWei.at(-1);
  return Object.freeze(clock.map((sharedEvent, clockIndex) => {
    const event = viewerByRoll.get(sharedEvent.globalRoll);
    const battleFinished = clockIndex === clock.length - 1;
    if (!event) {
      return Object.freeze({
        bankrollFlip: displayFlip(finalBankroll),
        deltaFlip: '0',
        label: `${battleFinished ? 'BATTLE COMPLETE' : 'BATTLE CONTINUES'} · ${sharedEvent.label}`,
        dice: Object.freeze([sharedEvent.d1, sharedEvent.d2]),
        point: sharedEvent.pointAfter || null,
        payoutBets: Object.freeze([]),
        lostBets: Object.freeze([]),
        retiredBets: Object.freeze([]),
        shooterBoost: null,
        survival: null,
        terminal: battleFinished ? personalTerminal : '',
        viewerTerminal: personalTerminal,
        viewerClosed: sharedEvent.globalRoll > personalLastRoll,
        shooter: sharedEvent.shooter,
        globalRoll: sharedEvent.globalRoll,
      });
    }
    const hand = trace.hands[event.shooter];
    const lastInShooter = event.rollIndex === hand.events.length - 1;
    const survival = lastInShooter ? survivalAfterHand(trace, event.shooter) : null;
    const suffix = event.terminal === 'goal'
      ? ' · GOAL LOCKED'
      : event.terminal === 'bust'
        ? survival?.survived === false ? ' · SURVIVAL LOST' : ' · RUN ENDED'
        : '';
    return Object.freeze({
      bankrollFlip: displayFlip(event.bankrollAfterWei),
      deltaFlip: displayFlip(event.deltaWei),
      label: `${event.label}${suffix}`,
      dice: Object.freeze([event.d1, event.d2]),
      point: event.pointAfter || null,
      payoutBets: event.payoutBets,
      lostBets: event.lostBets,
      retiredBets: event.retiredBets,
      shooterBoost: event.shooterBoost,
      survival,
      // A personal goal/bust closes this rack, but the shared replay does not
      // terminate until the battle clock reaches its last tracked closeout.
      terminal: battleFinished ? personalTerminal : '',
      viewerTerminal: event.terminal,
      viewerClosed: false,
      shooter: event.shooter,
      globalRoll: event.globalRoll,
    });
  }));
}

function eventAtGlobalRoll(trace) {
  return new Map(trace.events.map((event) => [event.globalRoll, event]));
}

function opponentSnapshots(trace, clock) {
  const events = eventAtGlobalRoll(trace);
  const final = trace.player.ladderWei.at(-1);
  let amount = trace.player.bankrollInWei;
  return Object.freeze(clock.map((sharedEvent) => {
    const event = events.get(sharedEvent.globalRoll);
    if (event) amount = event.bankrollAfterWei;
    else if (sharedEvent.globalRoll > (trace.events.at(-1)?.globalRoll ?? -1)) amount = final;
    return displayFlip(amount);
  }));
}

function alignedOpponentEvents(trace, clock) {
  const events = eventAtGlobalRoll(trace);
  return Object.freeze(clock.map((sharedEvent) => {
    const event = events.get(sharedEvent.globalRoll);
    return event == null ? null : Object.freeze({
      payoutBets: event.payoutBets,
      lostBets: event.lostBets,
      retiredBets: event.retiredBets,
      deltaFlip: displayFlip(event.deltaWei),
      bankrollFlip: displayFlip(event.bankrollAfterWei),
      shooter: event.shooter,
    });
  }));
}

function exitRoll(trace) {
  return Math.max(1, (trace.events.at(-1)?.globalRoll ?? 0) + 1);
}

function playerHighPointWei(player) {
  return player.ladderWei.reduce(
    (highest, amount) => amount > highest ? amount : highest,
    player.bankrollInWei,
  );
}

function tablePlayer(trace, clock, manifest, profiles = null) {
  const player = trace.player;
  // Live Discord identity outranks whatever the sealed bundle baked in: the
  // bundle's seat labels are generic lane names today, and identity is the one
  // fact a viewer expects to be current rather than sealed.
  const identity = profiles?.get?.(String(player.player ?? '').toLowerCase()) ?? null;
  return Object.freeze({
    betId: player.betId,
    player: player.player,
    label: identity?.name || player.name,
    discordPfp: identity?.avatar || player.avatarUrl,
    chips: boardChipCounts(player, manifest),
    rollEvents: alignedOpponentEvents(trace, clock),
    resolution: Object.freeze({
      type: player.stop === 'goal' ? 'cashout' : 'bust',
      roll: exitRoll(trace),
      startingBankrollFlip: displayFlip(player.bankrollInWei),
      goalFlip: displayFlip(player.goalWei),
      amountFlip: displayFlip(player.ladderWei.at(-1)),
      rawEndingFlip: displayFlip(player.ladderWei.at(-1)),
      highPointFlip: displayFlip(playerHighPointWei(player)),
      handsPlayed: player.handsPlayed,
      standing: player.standing,
      bankrollsFlip: opponentSnapshots(trace, clock),
      shooterBoosts: shooterBoostSchedule(player, manifest.tape.maxHands),
      survivals: survivalSchedule(trace, manifest.tape.maxHands),
      rollEvents: alignedOpponentEvents(trace, clock),
    }),
  });
}

function progressiveForViewer(manifest, viewerBetId) {
  const progressive = manifest.progressive;
  const winner = progressive.winnerBetId;
  const status = progressive.status === 'won'
    ? winner === viewerBetId ? 'won-you' : 'won-other'
    : 'live';
  return Object.freeze({
    // Renamed with the wire format: these are SCORE BASIS POINTS (10,000 = 1x), the winner's
    // high point over its own starting bankroll — not roll counts. See replay-contract.js.
    scoreBps: progressive.scoreBpsBefore,
    thresholdScoreBps: progressive.thresholdScoreBps,
    amountFlip: progressive.amountWei == null ? null : displayFlip(progressive.amountWei),
    status,
    wonAtScoreBps: progressive.wonAtScoreBps,
  });
}

/**
 * Build a deterministic model from the three immutable artifacts a viewer needs. The model
 * retains the full featured viewport; the table combines YOU with up to nine live rivals.
 */
export function createCrapsReplayTableModel(artifacts, {
  profiles = null,
  perspectiveBetId = null,
} = {}) {
  const manifest = assertSupportedCrapsReplayRuleset(artifacts?.manifest);
  const featured = validateCrapsReplayCollection(artifacts?.featured, manifest);
  if (featured.kind !== 'craps-replay-featured') throw new TypeError('Expected the featured replay artifact');
  const originalViewer = validateCrapsReplayPlayer(artifacts?.viewer);
  // Always seed the viewport with the wallet's own shard record. When the
  // spectator switches to a featured seat, the original player must move into
  // the opponent list instead of disappearing from the table.
  const viewport = replayCrapsViewport(manifest, featured.players, originalViewer);
  const selectedBetId = perspectiveBetId == null
    ? originalViewer.betId
    : String(perspectiveBetId);
  const viewerTrace = viewport.byBetId.get(selectedBetId);
  if (!viewerTrace) throw new TypeError(`Perspective ${selectedBetId} was not replayed`);
  // The viewer shard is the only record guaranteed to carry that wallet's
  // exact full-field rank timeline. Prefer it over a duplicate featured copy.
  const viewer = selectedBetId === originalViewer.betId
    ? originalViewer
    : viewerTrace.player;
  const opponents = viewport.seats.filter((trace) => trace.player.betId !== viewer.betId);
  const viewerIdentity = profiles?.get?.(String(viewer.player ?? '').toLowerCase()) ?? null;
  const clock = battleClock(viewport);
  const leaderboardTimeline = Object.freeze(featured.leaderboard.map((row) => Object.freeze({
    shooter: row.shooter,
    opponentBetIds: Object.freeze(row.betIds.filter((betId) => betId !== viewer.betId).slice(0, 10)),
  })));
  const resolutionHands = viewerFrames(viewerTrace, clock);
  const tableOptions = Object.freeze({
    screen: 'battle',
    tableResolved: true,
    showResolution: resolutionHands.length > 0,
    tableIndex: manifest.battleKey,
    battleSlot: manifest.settlement.boundSlot,
    viewerBetId: viewer.betId,
    originalViewerBetId: originalViewer.betId,
    viewerLabel: viewerIdentity?.name || viewer.name,
    viewerDiscordPfp: viewerIdentity?.avatar || viewer.avatarUrl,
    viewerResult: Object.freeze({
      stop: viewer.stop,
      handsPlayed: viewer.handsPlayed,
      rawEndingFlip: displayFlip(viewer.ladderWei.at(-1)),
      highPointFlip: displayFlip(playerHighPointWei(viewer)),
      standing: viewer.standing,
    }),
    fieldEntrants: manifest.field.entrants,
    rankTimeline: viewer.rankByRoll ?? Object.freeze([]),
    entryMultiple: viewer.entryMultiple,
    bets: boardChipCounts(viewer, manifest),
    playedFlip: displayFlip(manifest.terms.boardStakeWei),
    battleStakeFlip: displayFlip(manifest.terms.battleStakeWei),
    bountyPoolWei: manifest.terms.bountyPoolWei,
    addedFlipWei: manifest.terms.addedFlipWei,
    bankrollFlip: displayFlip(viewer.bankrollInWei),
    goalFlip: displayFlip(viewer.goalWei),
    rolls: rollsHex(viewport.tape),
    resolutionHands,
    otherPlayers: Object.freeze(opponents.map((trace) => tablePlayer(trace, clock, manifest, profiles))),
    leaderboardTimeline,
    jackpot: progressiveForViewer(manifest, viewer.betId),
    replayDigest: manifest.digest,
    replayEngineVersion: manifest.ruleset.engineVersion,
  });
  return Object.freeze({
    manifest,
    viewer,
    viewerTrace,
    viewport,
    leaderboardTimeline,
    tableOptions,
  });
}

export function crapsReplayArtifactsToTableOptions(artifacts) {
  return createCrapsReplayTableModel(artifacts).tableOptions;
}

function optionalWei(value) {
  if (value == null) return null;
  try {
    const amount = BigInt(value);
    return amount >= 0n ? amount : null;
  } catch (_error) {
    return null;
  }
}

function normalizedAddress(value) {
  const address = String(value ?? '').trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(address) ? address : null;
}

/**
 * The public Discord profile endpoint deliberately accepts only eight wallets
 * at a time. A featured replay can rotate more than eight seats through its
 * top ten, so resolve the sealed viewport in service-sized batches instead
 * of letting one oversized request discard every name and avatar.
 */
export async function loadCrapsReplayProfiles(addresses, loadProfiles = fetchProfiles) {
  const wanted = [...new Set((addresses ?? []).map(normalizedAddress).filter(Boolean))]
    .slice(0, CRAPS_PROFILE_MAX_ADDRESSES);
  const profiles = new Map();
  for (let offset = 0; offset < wanted.length; offset += CRAPS_PROFILE_BATCH_SIZE) {
    try {
      const batch = await loadProfiles(wanted.slice(offset, offset + CRAPS_PROFILE_BATCH_SIZE));
      for (const [address, profile] of batch ?? []) profiles.set(String(address).toLowerCase(), profile);
    } catch (_error) { /* one identity batch cannot blank the others */ }
  }
  return profiles;
}

/** Project the main-lane payout credited by the chain into the viewer's receipt. */
export function crapsReplayBattleAward({
  viewer = null,
  winner = null,
  viewerBetId = null,
  winnerBetId = null,
  payoutWei = null,
  battleStakeWei = null,
  entrants = null,
  winningStop = null,
  wonByViewer = false,
} = {}) {
  const viewerAddress = normalizedAddress(viewer);
  const winnerAddress = normalizedAddress(winner);
  const viewerSeat = viewerBetId == null ? null : String(viewerBetId);
  const winnerSeat = winnerBetId == null ? null : String(winnerBetId);
  const payout = optionalWei(payoutWei);
  const stake = optionalWei(battleStakeWei);
  const fieldSize = optionalWei(entrants);
  const postedBounties = stake != null && fieldSize != null ? stake * fieldSize : null;
  const boost = payout != null && postedBounties != null
    ? (payout > postedBounties ? payout - postedBounties : 0n)
    : null;
  const stop = winningStop == null ? null : Number(winningStop);
  return Object.freeze({
    battleWinner: winnerAddress,
    battleWonByViewer: viewerSeat != null && winnerSeat != null
      ? viewerSeat === winnerSeat
      : viewerAddress != null && winnerAddress != null
        ? viewerAddress === winnerAddress
        : Boolean(wonByViewer),
    battlePayoutWei: payout?.toString?.() ?? null,
    battleBoostWei: boost?.toString?.() ?? null,
    battleWinningStop: Number.isInteger(stop) && (stop === 0 || stop === 1) ? stop : null,
  });
}

/**
 * Fill prize totals missing from an older sealed replay with the battle's live
 * finalization event. `settledMainPotWei` is the exact main bounty emitted by
 * CrapsBattleFinalized; subtracting the field's posted bounties leaves its
 * realized protocol/donation contribution.
 */
export function crapsReplayPrizeAmounts({
  bountyPoolWei = null,
  addedFlipWei = null,
  fallbackBountyPoolWei = null,
  fallbackAddedFlipWei = null,
  settledMainPotWei = null,
  battleStakeWei = null,
  entrants = null,
} = {}) {
  const settledPot = optionalWei(settledMainPotWei);
  const sealedBounty = optionalWei(bountyPoolWei);
  const fallbackBounty = optionalWei(fallbackBountyPoolWei);
  const bounty = sealedBounty ?? fallbackBounty ?? settledPot;
  let added = optionalWei(addedFlipWei) ?? optionalWei(fallbackAddedFlipWei);
  if (added == null && settledPot != null) {
    const stake = optionalWei(battleStakeWei);
    const fieldSize = optionalWei(entrants);
    if (stake != null && fieldSize != null) {
      const postedBounties = stake * fieldSize;
      added = settledPot > postedBounties ? settledPot - postedBounties : 0n;
    }
  }
  return Object.freeze({
    bountyPoolWei: bounty?.toString?.() ?? null,
    addedFlipWei: added?.toString?.() ?? null,
    // `CrapsBattleFinalized.pot` is only the main lane. New manifests may
    // publish an exact all-lane pool; keep those two meanings explicit.
    bountyPoolScope: sealedBounty != null || fallbackBounty != null ? 'whole' : settledPot != null ? 'main' : null,
  });
}

/** Fetch the sharded result and open a table without exposing transport details to the component. */
export async function openCrapsReplayTable(table, {
  battleKey, viewerBetId, fetchImpl, loadProfiles = fetchProfiles, ...openOptions
} = {}) {
  const artifacts = await loadCrapsReplay({ battleKey, viewerBetId, fetchImpl });
  if (!artifacts.ready) return artifacts;
  let model = createCrapsReplayTableModel(artifacts);
  let profiles = null;
  // Overlay live Discord identity on the sealed seats. Decoration only: any
  // failure keeps the deterministic model exactly as the bundle shipped it.
  try {
    const addresses = [
      model.viewer.player,
      ...model.tableOptions.otherPlayers.map((player) => player.player),
    ];
    profiles = await loadCrapsReplayProfiles(addresses, loadProfiles);
    if (profiles?.size) model = createCrapsReplayTableModel(artifacts, { profiles });
  } catch (_error) { /* identity outage must never block the replay */ }
  const prizeAmounts = crapsReplayPrizeAmounts({
    bountyPoolWei: model.tableOptions.bountyPoolWei,
    addedFlipWei: model.tableOptions.addedFlipWei,
    fallbackBountyPoolWei: openOptions.bountyPoolWei,
    fallbackAddedFlipWei: openOptions.addedFlipWei,
    settledMainPotWei: openOptions.settledMainPotWei,
    battleStakeWei: model.manifest.terms.battleStakeWei,
    entrants: model.manifest.field.entrants,
  });
  const availablePerspectives = new Set(model.viewport.seats.map((trace) => trace.player.betId));
  const winnerBetId = openOptions.battleWinnerBetId ?? openOptions.winnerBetId ?? null;

  const openModel = (nextModel, {
    resumeResolutionIndex = null,
    autoRoll = null,
  } = {}) => {
    const battleAward = crapsReplayBattleAward({
      viewer: nextModel.viewer.player,
      winner: openOptions.battleWinner ?? openOptions.winner,
      viewerBetId: nextModel.viewer.betId,
      winnerBetId,
      payoutWei: openOptions.battlePayoutWei ?? openOptions.amountWei,
      battleStakeWei: nextModel.manifest.terms.battleStakeWei,
      entrants: nextModel.manifest.field.entrants,
      winningStop: openOptions.battleWinningStop ?? openOptions.winningStop,
      wonByViewer: openOptions.battleWonByViewer,
    });
    table?.open?.({
      ...openOptions,
      ...nextModel.tableOptions,
      ...prizeAmounts,
      ...battleAward,
      battleWinnerBetId: winnerBetId,
      onPerspectiveSelect,
      ...(Number.isInteger(resumeResolutionIndex) ? { resumeResolutionIndex } : {}),
      ...(typeof autoRoll === 'boolean' ? { autoRoll } : {}),
    });
  };

  // This callback stays bound to the already-verified artifact set. Switching
  // seats is therefore synchronous and never fetches or trusts a second replay.
  const onPerspectiveSelect = ({ betId, resumeResolutionIndex, autoRoll } = {}) => {
    const selectedBetId = betId == null ? '' : String(betId);
    if (!availablePerspectives.has(selectedBetId)) return false;
    const nextModel = createCrapsReplayTableModel(artifacts, {
      profiles,
      perspectiveBetId: selectedBetId,
    });
    openModel(nextModel, { resumeResolutionIndex, autoRoll });
    return true;
  };

  openModel(model);
  return Object.freeze({ ...artifacts, model });
}
