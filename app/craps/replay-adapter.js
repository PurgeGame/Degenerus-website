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

const TEN = 10n;

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

function viewerFrames(trace) {
  return Object.freeze(trace.events.map((event) => {
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
      terminal: event.terminal,
      shooter: event.shooter,
      globalRoll: event.globalRoll,
    });
  }));
}

function eventAtGlobalRoll(trace) {
  return new Map(trace.events.map((event) => [event.globalRoll, event]));
}

function opponentSnapshots(trace, viewerTrace) {
  const events = eventAtGlobalRoll(trace);
  const final = trace.player.ladderWei.at(-1);
  let amount = trace.player.bankrollInWei;
  return Object.freeze(viewerTrace.events.map((viewerEvent) => {
    const event = events.get(viewerEvent.globalRoll);
    if (event) amount = event.bankrollAfterWei;
    else if (viewerEvent.globalRoll > (trace.events.at(-1)?.globalRoll ?? -1)) amount = final;
    return displayFlip(amount);
  }));
}

function alignedOpponentEvents(trace, viewerTrace) {
  const events = eventAtGlobalRoll(trace);
  return Object.freeze(viewerTrace.events.map((viewerEvent) => {
    const event = events.get(viewerEvent.globalRoll);
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

function tablePlayer(trace, viewerTrace, manifest) {
  const player = trace.player;
  return Object.freeze({
    betId: player.betId,
    player: player.player,
    label: player.name,
    discordPfp: player.avatarUrl,
    chips: boardChipCounts(player, manifest),
    rollEvents: alignedOpponentEvents(trace, viewerTrace),
    resolution: Object.freeze({
      type: player.stop === 'goal' ? 'cashout' : 'bust',
      roll: exitRoll(trace),
      startingBankrollFlip: displayFlip(player.bankrollInWei),
      goalFlip: displayFlip(player.goalWei),
      amountFlip: displayFlip(player.ladderWei.at(-1)),
      bankrollsFlip: opponentSnapshots(trace, viewerTrace),
      shooterBoosts: shooterBoostSchedule(player, manifest.tape.maxHands),
      rollEvents: alignedOpponentEvents(trace, viewerTrace),
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
 * retains the full featured viewport even though the current component consumes its legacy-
 * shaped `tableOptions` projection.
 */
export function createCrapsReplayTableModel(artifacts) {
  const manifest = assertSupportedCrapsReplayRuleset(artifacts?.manifest);
  const featured = validateCrapsReplayCollection(artifacts?.featured, manifest);
  if (featured.kind !== 'craps-replay-featured') throw new TypeError('Expected the featured replay artifact');
  const viewer = validateCrapsReplayPlayer(artifacts?.viewer);
  const viewport = replayCrapsViewport(manifest, featured.players, viewer);
  const viewerTrace = viewport.byBetId.get(viewer.betId);
  if (!viewerTrace) throw new TypeError(`Viewer ${viewer.betId} was not replayed`);
  const featuredTraces = featured.players
    .map((player) => viewport.byBetId.get(player.betId))
    .filter(Boolean);
  const opponents = featuredTraces.filter((trace) => trace.player.betId !== viewer.betId);
  const leaderboardTimeline = Object.freeze(featured.leaderboard.map((row) => Object.freeze({
    shooter: row.shooter,
    opponentBetIds: Object.freeze(row.betIds.filter((betId) => betId !== viewer.betId).slice(0, 3)),
  })));
  const resolutionHands = viewerFrames(viewerTrace);
  const tableOptions = Object.freeze({
    screen: 'battle',
    tableResolved: true,
    showResolution: resolutionHands.length > 0,
    tableIndex: manifest.battleKey,
    battleSlot: manifest.settlement.boundSlot,
    viewerBetId: viewer.betId,
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
    otherPlayers: Object.freeze(opponents.map((trace) => tablePlayer(trace, viewerTrace, manifest))),
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

/** Fetch the sharded result and open a table without exposing transport details to the component. */
export async function openCrapsReplayTable(table, { battleKey, viewerBetId, fetchImpl, ...openOptions } = {}) {
  const artifacts = await loadCrapsReplay({ battleKey, viewerBetId, fetchImpl });
  if (!artifacts.ready) return artifacts;
  const model = createCrapsReplayTableModel(artifacts);
  table?.open?.({ ...openOptions, ...model.tableOptions });
  return Object.freeze({ ...artifacts, model });
}
