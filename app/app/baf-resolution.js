// Data model for the fullscreen Big Ass Flip ceremony.
//
// The x10 gate uses rngWord bit 0. Once it wins, the 3rd/4th-place survivor is
// selected from keccak256(abi.encode(rngWord, 1)) bit 0 — exactly the first
// EntropyLib.hash2 call in DegenerusJackpots.runBafJackpot.

import { fetchJSON } from './api.js';
import { ethers } from './contracts.js';
import { summarizeBafAwards } from './jackpot-resolutions.js';

const FLIP = 10n ** 18n;
const ENTRIES_PER_TICKET = 4n;
const LOAD_TIMEOUT_MS = 8_000;

function _big(value) {
  try { return BigInt(value ?? 0); } catch (_e) { return 0n; }
}

function _address(value) { return String(value || '').toLowerCase(); }

export const BAF_PRIZE_LANES = Object.freeze([
  Object.freeze({ id: 'leader', label: 'TOP SCORE', share: 10, detail: '#1' }),
  Object.freeze({ id: 'daily', label: 'TOP DAILY FLIP', share: 5, detail: '24H' }),
  Object.freeze({ id: 'cut', label: 'CUT SURVIVOR', share: 5, detail: '#3 / #4' }),
  Object.freeze({ id: 'future', label: 'FUTURE DRAWS', share: 10, detail: '2 DRAWS' }),
  Object.freeze({ id: 'scatter', label: 'SCATTER', share: 70, detail: '50 ROUNDS' }),
]);

export function bafGateWon(rngWord) {
  if (rngWord == null) return null;
  try { return (_big(rngWord) & 1n) === 1n; } catch (_e) { return null; }
}

/** Rank 3 or 4 receiving the random leaderboard slice on a winning gate. */
export function bafCutSurvivorRank(rngWord) {
  if (rngWord == null) return null;
  try {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'uint256'],
      [_big(rngWord), 1n],
    );
    const entropy = BigInt(ethers.keccak256(encoded));
    return 3 + Number(entropy & 1n);
  } catch (_e) { return null; }
}

export function normalizeBafTopFour(payload, level) {
  const target = Number(level);
  const rows = Array.isArray(payload) ? payload : payload?.entries;
  if (!Array.isArray(rows)) return [];
  const byRank = new Map();
  for (const row of rows) {
    const rank = Number(row?.rank);
    if (Number(row?.level) !== target || !Number.isInteger(rank) || rank < 1 || rank > 4) continue;
    if (byRank.has(rank)) continue;
    const player = _address(row?.player);
    if (!player) continue;
    byRank.set(rank, { rank, player, score: _big(row?.score).toString() });
  }
  return [...byRank.values()].sort((a, b) => a.rank - b.rank);
}

export function buildBafResolutionSnapshot({
  level,
  player,
  metadata,
  leaderboard,
  playerOutcome,
  history,
  consolation = 0,
} = {}) {
  const lvl = Number(level);
  if (!Number.isInteger(lvl) || lvl <= 0 || lvl % 10 !== 0) {
    throw new Error('Invalid BAF resolution level.');
  }
  const status = String(metadata?.status || playerOutcome?.roundStatus || 'open');
  if (!['closed', 'skipped'].includes(status)) {
    throw new Error(`Level ${lvl} BAF is not resolved yet.`);
  }
  const rngWord = metadata?.rngWord == null ? null : String(metadata.rngWord);
  const gateFromWord = bafGateWon(rngWord);
  const gateWon = status === 'closed' ? true : (status === 'skipped' ? false : gateFromWord);
  // The metadata endpoint can deploy a few minutes behind the player and
  // leaderboard endpoints. A closed round still has an honest, useful receipt
  // without that word; only the rank-3/4 cut replay is deferred.
  const survivorRank = gateWon && rngWord != null ? bafCutSurvivorRank(rngWord) : null;
  const cutKnown = !gateWon || survivorRank != null;

  const topFour = normalizeBafTopFour(leaderboard, lvl);
  const viewed = _address(player || playerOutcome?.player);
  const playerAwards = summarizeBafAwards(history?.wins ?? history, lvl);
  const rank = Number(playerOutcome?.rank);
  const playerRank = Number.isInteger(rank) && rank > 0 ? rank : null;
  const leaderSlicePct = gateWon && playerRank === 1
    ? 10
    : (gateWon && playerRank === survivorRank ? 5 : 0);
  const wonAny = gateWon && (
    leaderSlicePct > 0
    || playerAwards.eth > 0n
    || playerAwards.tickets > 0n
  );
  const ticketEntries = _big(metadata?.awards?.ticketEntries);

  return {
    level: lvl,
    day: Number.isInteger(Number(metadata?.day)) ? Number(metadata.day) : null,
    status,
    rngWord,
    gateWon,
    cutKnown,
    survivorRank,
    eliminatedCutRank: gateWon && survivorRank != null
      ? (survivorRank === 3 ? 4 : 3)
      : null,
    resolutionDetailsAvailable: metadata?.detailsAvailable !== false,
    estimatedPoolWei: metadata?.estimatedPoolWei == null
      ? null
      : _big(metadata.estimatedPoolWei).toString(),
    topFour,
    player: {
      address: viewed || null,
      score: _big(playerOutcome?.score).toString(),
      rank: playerRank,
      totalParticipants: Number.isInteger(Number(playerOutcome?.totalParticipants))
        ? Number(playerOutcome.totalParticipants)
        : null,
      eth: playerAwards.eth.toString(),
      tickets: playerAwards.tickets.toString(),
      consolation: _big(consolation).toString(),
      leaderSlicePct,
      wonAny,
    },
    awards: {
      ethCount: Number(metadata?.awards?.ethCount || 0),
      ethUnique: Number(metadata?.awards?.ethUnique || 0),
      ethTotal: _big(metadata?.awards?.ethTotal).toString(),
      ticketCount: Number(metadata?.awards?.ticketCount || 0),
      ticketUnique: Number(metadata?.awards?.ticketUnique || 0),
      ticketEntries: ticketEntries.toString(),
      tickets: (ticketEntries / ENTRIES_PER_TICKET).toString(),
    },
    prizeLanes: BAF_PRIZE_LANES.map((lane) => ({ ...lane })),
  };
}

let _fetch = fetchJSON;

function _fetchWithin(path) {
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`BAF final timed out: ${path}`)), LOAD_TIMEOUT_MS);
    try { timer?.unref?.(); } catch (_e) { /* browser timer */ }
  });
  return Promise.race([
    Promise.resolve().then(() => _fetch(path)),
    timeout,
  ]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}

export async function loadBafResolutionSnapshot({
  level,
  player,
  consolation = 0,
  playerOutcome: seededPlayerOutcome = null,
  history: seededHistory = null,
} = {}) {
  const lvl = Number(level);
  const address = _address(player);
  if (!address) throw new Error('A player address is required for the BAF draw.');
  const encodedLevel = encodeURIComponent(lvl);
  const encodedPlayer = encodeURIComponent(address);
  const [metadataResult, leaderboardResult, playerResult, historyResult] = await Promise.allSettled([
    _fetchWithin(`/game/baf/${encodedLevel}/resolution`),
    _fetchWithin(`/leaderboards/baf?level=${encodedLevel}`),
    seededPlayerOutcome != null
      ? Promise.resolve(seededPlayerOutcome)
      : _fetchWithin(`/player/${encodedPlayer}/baf?level=${encodedLevel}`),
    seededHistory != null
      ? Promise.resolve(seededHistory)
      : _fetchWithin(`/player/${encodedPlayer}/jackpot-history`),
  ]);

  const playerOutcome = playerResult.status === 'fulfilled' ? playerResult.value : null;
  if (!playerOutcome) {
    throw new Error(`Level ${lvl} BAF final is still syncing. Try again shortly.`);
  }

  const terminalStatus = ['closed', 'skipped'].includes(String(playerOutcome?.roundStatus || ''))
    ? String(playerOutcome.roundStatus)
    : null;
  const fetchedMetadata = metadataResult.status === 'fulfilled'
    && metadataResult.value && typeof metadataResult.value === 'object'
    ? metadataResult.value
    : null;
  const metadataStatus = String(fetchedMetadata?.status || '');
  const metadata = {
    ...(fetchedMetadata || {}),
    status: terminalStatus || metadataStatus || String(playerOutcome?.roundStatus || 'open'),
    detailsAvailable: fetchedMetadata != null,
  };
  const leaderboard = leaderboardResult.status === 'fulfilled'
    ? leaderboardResult.value
    : { entries: [] };
  const history = historyResult.status === 'fulfilled'
    ? historyResult.value
    : { wins: [] };

  return buildBafResolutionSnapshot({
    level: lvl,
    player: address,
    metadata,
    leaderboard,
    playerOutcome,
    history,
    consolation,
  });
}

export function formatBafResolutionScore(raw) {
  const whole = _big(raw) / FLIP;
  return whole.toLocaleString('en-US');
}

export function __setBafResolutionFetcherForTest(fetcher) {
  _fetch = typeof fetcher === 'function' ? fetcher : fetchJSON;
}

export function __resetBafResolutionFetcherForTest() {
  _fetch = fetchJSON;
}
