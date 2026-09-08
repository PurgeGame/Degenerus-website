// Shared settled Degenerette replay data. Importing history must not register
// or mount the interactive wager panel and its polling/rendering lifecycle.
// These helpers are shared by the live panel and both history controllers.
import * as dgnReels from './dgn-reels.js';
import { openLegsFromDegenerettePayouts } from './lootbox-legs.js';
const { dgnDeriveSpins, dgnScore } = dgnReels;
const DEGENERETTE_TOKEN_SCALE = 10n ** 18n;

// v75 BetPlaced.packed layout (DegeneretteModule:377-398 repack; the indexer's
// degenerette-feed route mirrors it): customTraits[0..31], spinCount[32..39],
// currency[40..41], amountPerSpin[42..169], activityScore[202..217],
// heroQuadrant[218..219], recordBountyWholeFlip[220..255].
// (The pre-v75 layout — hero at 238 — is what app-compact still decodes; STALE.)
const DGN_MASK128 = (1n << 128n) - 1n;
const DGN_RECORD_MASK = (1n << 36n) - 1n;
export function dgnDecodePacked(packedStr) {
  let p = 0n;
  try { p = BigInt(packedStr ?? 0); } catch (_e) { return null; }
  return {
    customTicket: p & 0xFFFFFFFFn,
    spinCount: Number((p >> 32n) & 0xFFn),
    currency: Number((p >> 40n) & 0x3n),
    amountPerSpin: (p >> 42n) & DGN_MASK128,
    activityScore: Number((p >> 202n) & 0xFFFFn),
    heroQuadrant: Number((p >> 218n) & 0x3n),
    recordBountyStake: ((p >> 220n) & DGN_RECORD_MASK) * DEGENERETTE_TOKEN_SCALE,
  };
}

function _degeneretteResultKey(row, fallbackIndex) {
  const type = String(row?.resultType || 'unknown');
  const data = row?.resultData || {};
  if (type === 'result') {
    const spin = data.spinIndex ?? data.ticketIndex;
    if (spin != null) return `${type}:spin:${String(spin)}`;
  }
  if (type === 'resolved') return `${type}:summary`;
  const tx = row?.transactionHash ?? '';
  const log = row?.logIndex ?? '';
  if (tx || log !== '') return `${type}:${String(tx)}:${String(log)}`;
  try { return `${type}:data:${JSON.stringify(data)}:${String(row?.payout ?? '')}`; }
  catch (_e) { return `${type}:row:${fallbackIndex}`; }
}

/**
 * The API normally emits one item per bet, but an indexer/page transition can
 * briefly surface more than one fragment for the same player+betId. Merge
 * those fragments before deciding which spins exist so a late spin cannot be
 * dropped merely because the summary arrived in a different item.
 */
export function mergeDegeneretteFeedItems(items) {
  const groups = new Map();
  let anonymous = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const player = String(item?.player || '').toLowerCase();
    const betId = item?.betId;
    const key = player && betId != null
      ? `${player}:${String(betId)}`
      : `anonymous:${anonymous++}`;
    let merged = groups.get(key);
    if (!merged) {
      merged = { ...item, results: [], resultTickets: [], lootboxPayouts: [] };
      merged.__results = new Map();
      merged.__tickets = new Map();
      merged.__lootboxPayouts = new Map();
      groups.set(key, merged);
    } else {
      // Prefer whichever fragment has the concrete placement/replay fields.
      for (const field of [
        'id', 'player', 'betIndex', 'betId', 'packedData', 'blockNumber',
        'transactionHash', 'logIndex', 'rngReady', 'rngWord',
      ]) {
        if (merged[field] == null && item?.[field] != null) merged[field] = item[field];
      }
    }
    const rows = Array.isArray(item?.results) ? item.results : [];
    rows.forEach((row, i) => {
      const resultKey = _degeneretteResultKey(row, i);
      const prior = merged.__results.get(resultKey);
      // A later projection can contain more complete resultData, so retain it.
      if (!prior) {
        merged.__results.set(resultKey, row);
      } else {
        const next = {
          ...prior,
          ...row,
          resultData: {
            ...(prior?.resultData || {}),
            ...(row?.resultData || {}),
          },
        };
        for (const field of ['payout', 'blockNumber', 'transactionHash', 'logIndex']) {
          if (next[field] == null && prior[field] != null) next[field] = prior[field];
        }
        merged.__results.set(resultKey, next);
      }
    });
    const tickets = Array.isArray(item?.resultTickets) ? item.resultTickets : [];
    tickets.forEach((ticket, i) => {
      const spin = ticket?.spinIndex ?? ticket?.spinIdx ?? i;
      merged.__tickets.set(String(spin), ticket);
    });
    const lootboxPayouts = Array.isArray(item?.lootboxPayouts) ? item.lootboxPayouts : [];
    lootboxPayouts.forEach((payout, i) => {
      const transactionHash = String(payout?.transactionHash || '').toLowerCase();
      const logIndex = payout?.logIndex == null ? Number.NaN : Number(payout.logIndex);
      let payload = '';
      try { payload = JSON.stringify(payout?.rewardData ?? null); } catch (_e) { payload = String(i); }
      const payoutKey = transactionHash && Number.isInteger(logIndex) && logIndex >= 0
        ? `event:${transactionHash}:${logIndex}`
        : [payout?.blockNumber, payout?.rewardType, payload].join(':');
      const prior = merged.__lootboxPayouts.get(payoutKey);
      merged.__lootboxPayouts.set(payoutKey, prior ? {
        ...prior,
        ...payout,
        rewardData: payout?.rewardData == null
          ? prior.rewardData
          : { ...(prior.rewardData || {}), ...payout.rewardData },
        spin: payout?.spin == null
          ? prior.spin
          : { ...(prior.spin || {}), ...payout.spin },
      } : payout);
    });
  }
  return Array.from(groups.values()).map((merged) => {
    merged.results = Array.from(merged.__results.values());
    merged.resultTickets = Array.from(merged.__tickets.values());
    merged.lootboxPayouts = Array.from(merged.__lootboxPayouts.values());
    delete merged.__results;
    delete merged.__tickets;
    delete merged.__lootboxPayouts;
    return merged;
  });
}

/**
 * Canonicalise the per-spin events and prove that indexes 0..N-1 all exist.
 * A resolved summary and its individual DegeneretteResult rows can reach an
 * API worker in separate projections. Animation must never interpret that
 * transient state as a shorter round.
 */
export function normalizeDegeneretteSpinResults(
  spinResults,
  expectedSpinCount,
  { player = null, betId = null } = {},
) {
  let expected = 1;
  try { expected = Math.max(1, Math.min(255, Number(BigInt(expectedSpinCount ?? 1)))); }
  catch (_e) { expected = 1; }

  const bySpin = new Map();
  for (const source of Array.isArray(spinResults) ? spinResults : []) {
    const data = source?.resultData || source || {};
    const rawIndex = data.spinIndex ?? data.ticketIndex;
    const rawPlayerTraits = data.playerTraits ?? data.playerTicket;
    if (rawIndex == null || rawPlayerTraits == null) continue;
    let spinIndex;
    let playerTraits;
    let matches;
    let payout;
    try {
      spinIndex = Number(BigInt(rawIndex));
      playerTraits = BigInt(rawPlayerTraits);
      matches = BigInt(data.matches ?? 0);
      payout = BigInt(source?.payout ?? data.payout ?? 0);
    } catch (_e) {
      continue;
    }
    if (!Number.isInteger(spinIndex) || spinIndex < 0 || spinIndex >= expected) continue;
    let rowBetId = betId;
    try {
      if (source?.betId != null || data.betId != null) {
        rowBetId = BigInt(source?.betId ?? data.betId);
      } else if (betId != null) {
        rowBetId = BigInt(betId);
      }
    } catch (_e) { rowBetId = betId; }
    bySpin.set(spinIndex, {
      player: String(source?.player ?? data.player ?? player ?? ''),
      betId: rowBetId,
      spinIndex: BigInt(spinIndex),
      playerTraits,
      matches,
      payout,
    });
  }

  const missingSpinIndexes = [];
  for (let spin = 0; spin < expected; spin += 1) {
    if (!bySpin.has(spin)) missingSpinIndexes.push(spin);
  }
  return {
    expectedSpinCount: expected,
    complete: missingSpinIndexes.length === 0,
    missingSpinIndexes,
    spins: Array.from(bySpin.values()).sort((a, b) => Number(a.spinIndex - b.spinIndex)),
  };
}

/**
 * Build the one canonical presentation payload for a resolved Degenerette bet.
 * Receipt, indexed-feed, and exact chain-log recovery all pass through here so
 * the overlay can never receive a shortened round or reuse spin zero's reel for
 * later spins.
 */
export function buildDegeneretteRevealSequence({
  resolvedEntry,
  spinResults,
  resultTickets = [],
  rngWord = 0n,
  betIndex = 0,
  currency = 0,
  amountPerSpin = 0n,
  heroQuadrant = 0,
} = {}) {
  if (!resolvedEntry) return null;
  const complete = normalizeDegeneretteSpinResults(
    spinResults,
    resolvedEntry.spinCount ?? 1,
    { player: resolvedEntry.player, betId: resolvedEntry.betId },
  );
  if (!complete.complete) return null;

  const hero = Number(heroQuadrant) & 3;
  const resolvedTraits = resolvedEntry.resultTraits == null
    ? null
    : Number(resolvedEntry.resultTraits) >>> 0;
  const derived = dgnDeriveSpins({
    rngWord,
    index: Number(betIndex ?? 0),
    heroQuadrant: hero,
    currency: Number(currency),
    resolvedResultTraits: resolvedEntry.resultTraits,
    spins: complete.spins,
  });

  const projected = new Map();
  for (const ticket of Array.isArray(resultTickets) ? resultTickets : []) {
    const spinIndex = Number(ticket?.spinIndex ?? ticket?.spinIdx ?? 0);
    const raw = ticket?.resultTicket ?? ticket?.resultTraits
      ?? ticket?.houseTicket ?? ticket?.houseTraits;
    if (raw != null && Number.isInteger(spinIndex) && spinIndex >= 0) {
      projected.set(spinIndex, Number(raw) >>> 0);
    }
  }

  const rows = derived.rows.map((row) => {
    const projectedTraits = projected.get(row.spinIndex);
    if (projectedTraits == null) return row;
    const anchorOk = row.spinIndex !== 0
      || resolvedTraits == null
      || projectedTraits === resolvedTraits;
    const scoreOk = dgnScore(row.playerTraits, projectedTraits, hero) === row.score;
    return anchorOk && scoreOk ? { ...row, houseTraits: projectedTraits } : row;
  });

  // Even without a recoverable RNG word, the chain's published spin-zero reel
  // remains authoritative. Multi-spin rounds still wait for every other reel.
  if (!derived.verified) {
    const zero = rows.find((row) => row.spinIndex === 0);
    if (zero && resolvedTraits != null) zero.houseTraits = resolvedTraits;
  }
  const indexes = new Set(rows.map((row) => row.spinIndex));
  if (rows.length !== complete.expectedSpinCount
    || rows.some((row) => row.houseTraits == null)
    || Array.from({ length: complete.expectedSpinCount }, (_, i) => indexes.has(i)).some((ok) => !ok)) {
    return null;
  }

  let perSpin = 0n;
  let totalPayout = 0n;
  try { perSpin = BigInt(amountPerSpin ?? 0); } catch (_e) { perSpin = 0n; }
  try { totalPayout = BigInt(resolvedEntry.totalPayout ?? 0); } catch (_e) { totalPayout = 0n; }
  return {
    kind: 'degenerette',
    betId: resolvedEntry.betId == null ? null : String(resolvedEntry.betId),
    headline: resolvedEntry.betId == null ? null : `BET #${String(resolvedEntry.betId)}`,
    currency: Number(currency),
    heroIdx: hero,
    amountPerSpin: perSpin,
    totalWager: perSpin * BigInt(complete.expectedSpinCount),
    totalPayout,
    spinCount: complete.expectedSpinCount,
    spins: rows,
  };
}

/**
 * Rebuild a settled feed item into the exact reveal payload used by a live
 * receipt. Historical-day controllers use this instead of maintaining a
 * second, inevitably drifting Degenerette decoder.
 */
export function degeneretteRevealSequenceFromFeedItem(item) {
  const merged = mergeDegeneretteFeedItems(item == null ? [] : [item])[0];
  if (!merged) return null;
  const packed = dgnDecodePacked(merged.packedData);
  if (!packed) return null;
  const results = Array.isArray(merged.results) ? merged.results : [];
  const resolvedRow = results.find((row) => row?.resultType === 'resolved');
  if (!resolvedRow) return null;
  const data = resolvedRow.resultData || {};
  let resolvedEntry;
  try {
    resolvedEntry = {
      player: String(merged.player || data.player || ''),
      betId: BigInt(merged.betId ?? data.betId),
      spinCount: BigInt(data.spinCount ?? packed.spinCount ?? 1),
      totalPayout: BigInt(data.totalPayout ?? resolvedRow.payout ?? 0),
      resultTraits: BigInt(data.resultTraits ?? data.resultTicket ?? 0),
    };
  } catch (_e) {
    return null;
  }
  const sequence = buildDegeneretteRevealSequence({
    resolvedEntry,
    spinResults: results.filter((row) => row?.resultType === 'result'),
    resultTickets: merged.resultTickets,
    rngWord: merged.rngWord ?? 0,
    betIndex: merged.betIndex ?? 0,
    currency: packed.currency,
    amountPerSpin: packed.amountPerSpin,
    heroQuadrant: packed.heroQuadrant,
  });
  if (!sequence) return null;
  const rewardLegs = openLegsFromDegenerettePayouts(merged.lootboxPayouts);
  const { lootboxLegs, recordBountySpins } = partitionDegeneretteRewardLegs(rewardLegs);
  sequence.lootboxAwarded = lootboxLegs.length > 0;
  sequence.lootboxLegs = lootboxLegs;
  sequence.lootboxEth = degeneretteLootboxEthFromLegs(lootboxLegs);
  sequence.recordBountySpins = withDegeneretteRecordContext(
    recordBountySpins,
    merged.packedData,
    { rngWord: merged.rngWord, parentBetId: merged.betId },
  );
  return sequence;
}

/**
 * A type-3 BoxSpin shares the box event payload only so its three reels stay
 * itemized. It is not Luckbox content. Keep that semantic boundary in one pure
 * partition used by receipt, chain-replay, and indexed-replay completion paths.
 */
export function partitionDegeneretteRewardLegs(legs) {
  const lootboxLegs = [];
  const recordBountySpins = [];
  for (const leg of Array.isArray(legs) ? legs : []) {
    const spinType = String(leg?.spinType || '').toLowerCase();
    if (leg?.legType === 'spin' && (spinType === 'record' || spinType === 'unknown_3')) {
      recordBountySpins.push(leg);
    } else if (leg) {
      lootboxLegs.push(leg);
    }
  }
  return { lootboxLegs, recordBountySpins };
}

/**
 * Type-3 BoxSpin emits the final post-survival value only. Preserve the parent
 * bet's packed record stake and activity snapshot on that child so a losing
 * double-or-nothing can still show what its reels had produced.
 */
export function withDegeneretteRecordContext(spins, packedData, {
  rngWord = 0n,
  parentBetId = null,
} = {}) {
  const rows = Array.isArray(spins) ? spins : [];
  const packed = dgnDecodePacked(packedData);
  if (!packed) return rows.slice();
  return rows.map((spin) => {
    const spinType = String(spin?.spinType || '').toLowerCase();
    if (spinType !== 'record' && spinType !== 'unknown_3') return spin;
    const reels = Array.isArray(spin?.reels) ? spin.reels : [];
    const heroes = typeof dgnReels.dgnRecordBountyHeroQuadrants === 'function'
      ? dgnReels.dgnRecordBountyHeroQuadrants({
          rngWord,
          parentBetId,
          boxBetId: spin?.betId,
          spinCount: reels.length,
        })
      : null;
    return {
      ...spin,
      ...(packed.recordBountyStake > 0n
        ? { recordStake: packed.recordBountyStake }
        : {}),
      activityScore: packed.activityScore,
      reels: heroes == null ? reels : reels.map((reel, index) => {
        const spinIndex = Number(reel?.spinIndex ?? index);
        const heroQuadrant = heroes[spinIndex];
        return heroQuadrant == null || reel?.heroQuadrant != null
          ? reel
          : { ...reel, heroQuadrant };
      }),
    };
  });
}

/**
 * Expand one settled Degenerette result into its authored replay order. Record
 * bounties are independent FLIP reels, including a legitimate zero-payout
 * survival loss, so they always play between the base result and any genuine
 * Luckbox contents.
 */
export function degeneretteReplaySequences(sequence, {
  lootboxTitle = 'DEGENERETTE LUCKBOX',
  lootboxNoVessel = true,
} = {}) {
  if (!sequence) return [];
  const ordered = [sequence];
  for (const spin of Array.isArray(sequence.recordBountySpins)
    ? sequence.recordBountySpins : []) {
    ordered.push({ kind: 'record-bounty', spin });
  }
  if (Array.isArray(sequence.lootboxLegs) && sequence.lootboxLegs.length > 0) {
    ordered.push({
      kind: 'lootbox',
      title: lootboxTitle,
      legs: sequence.lootboxLegs,
      settledExpected: true,
      ...(lootboxNoVessel ? { noVessel: true } : {}),
    });
  }
  return ordered;
}

/**
 * The first LootBoxOpened leg emitted by a Degenerette ETH settlement is the
 * recirculated part of that bet's gross payout. Any later opened legs can be
 * nested rewards produced while resolving that box and must not be counted a
 * second time as part of the original winnings split.
 */
export function degeneretteLootboxEthFromLegs(legs) {
  const opened = (Array.isArray(legs) ? legs : []).find((leg) => {
    if (leg?.legType !== 'opened') return false;
    try { return BigInt(leg?.amount ?? 0) > 0n; } catch (_e) { return false; }
  });
  if (!opened) return 0n;
  try { return BigInt(opened.amount ?? 0); } catch (_e) { return 0n; }
}

