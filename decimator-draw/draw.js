import { decimatorPayoutBreakdown } from '../app/app/decimator-payout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const UNIT = 10n ** 18n;
const DISCORD_DIRECTORY_URL = 'https://api.degener.us/api/leaderboard?limit=50';
const WINNER_COLORS = Object.freeze([
  '#ed0e11', '#f7931a', '#d7dce2', '#ff4d8d', '#2f9cff',
  '#35d88a', '#9d64ff', '#f4c542', '#ce384c', '#50cbd7',
]);
export const DRAW_ORDER = Object.freeze([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
export const BUCKET_MIN_DEGEN_SCORE = Object.freeze({
  12: 0, 11: 10, 10: 30, 9: 55, 8: 85, 7: 120,
  6: 180, 5: 250, 4: 300, 3: 500, 2: 1_000,
});

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function raw(value) {
  try { return BigInt(value ?? 0); } catch (_error) { return 0n; }
}

export function formatUnits(value, maxFraction = 2) {
  const amount = raw(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / UNIT;
  const fraction = (absolute % UNIT).toString().padStart(18, '0')
    .slice(0, Math.max(0, maxFraction))
    .replace(/0+$/, '');
  return `${negative ? '−' : ''}${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}

export function formatScore(value) {
  const amount = raw(value);
  if (amount === 0n) return '0';
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  if (absolute < 1_000n * UNIT) return formatUnits(amount, 1);
  // One tenth of a K is 100 whole FLIP. Round once with integer math so every
  // score surface agrees at suffix boundaries.
  const tenthsOfK = (absolute + (50n * UNIT)) / (100n * UNIT);
  return `${negative ? '−' : ''}${(tenthsOfK / 10n).toLocaleString('en-US')}.${tenthsOfK % 10n}K`;
}

export function formatEth(value, displayScale = 1n, maxFraction = 2) {
  const scale = raw(displayScale) || 1n;
  return formatUnits(raw(value) * scale, maxFraction);
}

function settlementEthLabel(value, displayScale = 1n) {
  const displayed = raw(value) * (raw(displayScale) || 1n);
  const digits = displayed >= 100n * UNIT ? 1 : displayed >= UNIT ? 3 : 5;
  return `${formatEth(value, displayScale, digits)} ETH`;
}

/** Exact player-facing settlement shown only after the resolved wheel ends. */
export function formatDecimatorSettlement(totalWei, displayScale = 1n, options = {}) {
  const split = decimatorPayoutBreakdown(totalWei, options);
  const claimable = settlementEthLabel(split.claimableEthWei, displayScale);
  if (split.rewardKind === 'eth') {
    return {
      ...split,
      claimableLabel: claimable,
      rewardLabel: 'NO REWARD LEG',
      ruleLabel: 'TERMINAL PAYOUT · 100% CLAIMABLE ETH',
    };
  }
  if (split.rewardKind === 'luckbox') {
    return {
      ...split,
      claimableLabel: claimable,
      rewardLabel: `${settlementEthLabel(split.luckboxWei, displayScale)} LUCKBOX`,
      ruleLabel: '50% CLAIMABLE ETH · 50% LUCKBOX',
    };
  }

  const passCount = split.halfPasses.toLocaleString('en-US');
  const rewardParts = [
    `${passCount} WHALE HALF-${split.halfPasses === 1n ? 'PASS' : 'PASSES'}`,
  ];
  if (split.luckboxWei > 0n) {
    rewardParts.push(`${settlementEthLabel(split.luckboxWei, displayScale)} LUCKBOX`);
  }
  return {
    ...split,
    claimableLabel: claimable,
    rewardLabel: rewardParts.join(' + '),
    ruleLabel: split.recirculatedDustWei > 0n
      ? 'WHALE HALF-PASSES · SMALL ON-CHAIN REMAINDER RECIRCULATED'
      : 'WHALE HALF-PASSES · LUCKBOX REMAINDER WHEN ELIGIBLE',
  };
}

export function minDegenScoreForBucket(bucket) {
  return BUCKET_MIN_DEGEN_SCORE[integer(bucket, -1)] ?? null;
}

function bucketScoreLabel(bucket) {
  const minimum = minDegenScoreForBucket(bucket);
  if (minimum == null) return '—';
  return minimum >= 1_000 ? `${minimum / 1_000}K+` : `${minimum.toLocaleString('en-US')}+`;
}

function scoreLookup(snapshot) {
  return new Map((snapshot?.subbucketTotals || []).map((row) => [
    `${integer(row.bucket)}:${integer(row.subbucket)}`,
    raw(row.score),
  ]));
}

export function playerSubbucketScore(snapshot, player) {
  if (!player) return 0n;
  return scoreLookup(snapshot).get(`${integer(player.bucket, -1)}:${integer(player.subbucket, -1)}`)
    ?? 0n;
}

export function totalFlipBurned(snapshot) {
  // Raw FLIP destroyed comes from FLIP.DecimatorBurn.amountBurned. Do not
  // substitute the activity/boon-weighted subbucket scores: those are the
  // effective-burn denominator shown in the score board below the wheel.
  return snapshot?.totalFlipBurned == null ? null : raw(snapshot.totalFlipBurned);
}

/** Player ownership of their one aggregate subbucket, in basis points. */
export function playerSubbucketShareBps(snapshot, player) {
  if (!player) return 0;
  const total = playerSubbucketScore(snapshot, player);
  const playerScore = raw(player.score);
  if (total <= 0n || playerScore <= 0n) return 0;
  const rounded = (playerScore * 10_000n + (total / 2n)) / total;
  return Number(rounded > 10_000n ? 10_000n : rounded);
}

function formatSharePercent(bps) {
  const value = Math.max(0, Math.min(10_000, integer(bps)));
  if (value === 0) return '0%';
  if (value < 10) return '<0.1%';
  if (value % 100 === 0) return `${value / 100}%`;
  return `${(value / 100).toFixed(1).replace(/\.0$/, '')}%`;
}

/**
 * Live pro-rata payout if the viewed player's slice were selected. Previously
 * locked winning slices stay in the denominator; before the player's score
 * group resolves, their whole slice joins it because every burn in that slice
 * wins together. Once that group resolves, the real win/loss is authoritative.
 */
export function projectedPlayerPayout(
  snapshot,
  player,
  runningWinningScore = 0n,
  completedBuckets = [],
) {
  if (!player) return null;
  const pool = raw(snapshot?.poolWei);
  const playerBurn = raw(player.score);
  if (pool <= 0n || playerBurn <= 0n) return 0n;
  const completed = new Set((completedBuckets || []).map((entry) => (
    integer(entry?.bucket ?? entry, -1)
  )));
  const playerBucket = integer(player.bucket, -1);
  const playerResolved = completed.has(playerBucket);
  if (playerResolved && playerResult(snapshot, player)?.won !== true) return 0n;
  let denominator = raw(runningWinningScore);
  if (!playerResolved) denominator += playerSubbucketScore(snapshot, player);
  if (denominator <= 0n) return null;
  return (pool * playerBurn) / denominator;
}

/**
 * The protocol packs an offset for every denominator, including buckets nobody
 * entered. A replay should only spend time on buckets that could actually pay:
 * at least one of their subbuckets has a non-zero indexed burn total.
 */
export function possibleBuckets(snapshot) {
  const populated = new Set((snapshot?.subbucketTotals || []).flatMap((row) => {
    const bucket = integer(row?.bucket, -1);
    return raw(row?.score) > 0n && DRAW_ORDER.includes(bucket) ? [bucket] : [];
  }));
  return DRAW_ORDER.filter((bucket) => populated.has(bucket));
}

/**
 * Build one wheel frame per populated bucket. Completed picks occupy an ordered
 * lock lane beginning at one o'clock. The live subbuckets sit after the next
 * open lock position, so the selected slice can visibly slide into that lane.
 * Winner indices and score totals remain the exact indexed on-chain values.
 */
export function buildDrawFrames(snapshot) {
  const totals = scoreLookup(snapshot);
  const buckets = possibleBuckets(snapshot);
  if (buckets.length === 0) throw new Error('No populated Decimator buckets in this round.');
  // One extra slot is the destination for the current winner. When populated
  // buckets descend consecutively (as in the level-15 run), the wheel stays
  // perfectly full while locks accumulate across its top edge.
  const slotCount = buckets[0] + 1;
  return buckets.map((bucket, index) => {
    const winningSubbucket = integer(snapshot?.winningSubbuckets?.[String(bucket)], -1);
    if (winningSubbucket < 0 || winningSubbucket >= bucket) {
      throw new Error(`Invalid winning subbucket ${winningSubbucket} for bucket ${bucket}.`);
    }
    const firstActiveSlot = slotCount - bucket;
    if (index >= firstActiveSlot) {
      throw new Error(`Decimator lock lane overlaps bucket ${bucket}.`);
    }
    const activeSlots = Array.from(
      { length: bucket },
      (_value, subbucket) => firstActiveSlot + subbucket,
    );
    const targetPhysical = activeSlots[winningSubbucket];
    const winningScore = totals.get(`${bucket}:${winningSubbucket}`) ?? 0n;
    const subbucketScores = Array.from(
      { length: bucket },
      (_value, subbucket) => totals.get(`${bucket}:${subbucket}`) ?? 0n,
    );
    const frame = {
      bucket,
      slotCount,
      lockPhysical: index,
      activeSlots,
      winningSubbucket,
      targetPhysical,
      winningScore,
      subbucketScores,
    };
    return frame;
  });
}

export function sumWinningScore(frames) {
  return frames.reduce((sum, frame) => sum + frame.winningScore, 0n);
}

export function playerResult(snapshot, player) {
  if (!player) return null;
  const winner = integer(snapshot?.winningSubbuckets?.[String(player.bucket)], -1);
  return {
    ...player,
    won: winner === integer(player.subbucket, -2),
    winningSubbucket: winner,
  };
}

/**
 * Exact final payout slices: ten highest effective burns, the viewed winner
 * when outside that ten, and one remainder slice so the pie always totals the
 * protocol denominator.
 */
export function buildWinnerAllocation(snapshot, playerAddress = '') {
  const byAddress = new Map();
  for (const row of [
    ...(Array.isArray(snapshot?.winnerPlayers) ? snapshot.winnerPlayers : []),
    ...(Array.isArray(snapshot?.players) ? snapshot.players : []),
  ]) {
    const address = String(row?.address || '').toLowerCase();
    if (!address || raw(row?.score) <= 0n || playerResult(snapshot, row)?.won !== true) continue;
    byAddress.set(address, { ...row, address, score: raw(row.score).toString() });
  }
  const winners = [...byAddress.values()].sort((left, right) => {
    const leftScore = raw(left.score);
    const rightScore = raw(right.score);
    if (leftScore === rightScore) return left.address.localeCompare(right.address);
    return leftScore > rightScore ? -1 : 1;
  });
  const viewed = String(playerAddress || '').toLowerCase();
  const viewedWinner = winners.find((winner) => winner.address === viewed) || null;
  const top = winners.slice(0, 10);
  const shown = [...top];
  if (viewedWinner && !top.some((winner) => winner.address === viewedWinner.address)) {
    shown.push(viewedWinner);
  }

  const indexedTotal = raw(snapshot?.winningScore);
  const knownTotal = winners.reduce((sum, winner) => sum + raw(winner.score), 0n);
  const total = indexedTotal > 0n ? indexedTotal : knownTotal;
  const pool = raw(snapshot?.poolWei);
  const toEntry = (winner) => {
    const score = raw(winner.score);
    const rank = winners.findIndex((candidate) => candidate.address === winner.address) + 1;
    const shareBps = total > 0n
      ? Number(((score * 10_000n) + (total / 2n)) / total)
      : 0;
    return {
      kind: 'winner',
      address: winner.address,
      rank,
      score: score.toString(),
      payoutWei: total > 0n ? ((pool * score) / total).toString() : '0',
      shareBps: Math.max(0, Math.min(10_000, shareBps)),
      isPlayer: winner.address === viewed,
      color: WINNER_COLORS[(rank - 1) % WINNER_COLORS.length],
    };
  };
  const entries = shown.map(toEntry);
  const shownScore = shown.reduce((sum, winner) => sum + raw(winner.score), 0n);
  const otherScore = total > shownScore ? total - shownScore : 0n;
  if (otherScore > 0n) {
    entries.push({
      kind: 'other',
      address: null,
      rank: null,
      score: otherScore.toString(),
      payoutWei: total > 0n ? ((pool * otherScore) / total).toString() : '0',
      shareBps: Number(((otherScore * 10_000n) + (total / 2n)) / total),
      isPlayer: false,
      color: '#333947',
    });
  }
  return {
    total: total.toString(),
    winnerCount: winners.length,
    viewedWinner: Boolean(viewedWinner),
    entries,
  };
}

const FULL_DEMO_NAMES = Object.freeze([
  'Burnie', 'FullSend', 'ZeroRake', 'HotWallet', 'LastBlock', 'GasGoblin',
  'RedCandle', 'FlameKeeper', 'PinkSlip', 'DeepLiquidity', 'NoBrakes',
  'AshCollector', 'FinalForm', 'DiamondHands', 'BlockBurner', 'RiskOn',
  'ExitLiquidity', 'HighVoltage', 'ColdStorage', 'ProtocolOwned', 'DayOne',
  'OneMoreSpin', 'BlackFlame', 'MaxPressure', 'NoSleep', 'BurnNotice',
  'TerminalDegen',
]);

function demoAddress(index) {
  return `0x${BigInt(0xd300 + index).toString(16).padStart(40, '0')}`;
}

/**
 * Deterministic, explicitly non-chain art fixture. It populates every protocol
 * bucket and gives every selected subbucket multiple winners so the complete
 * wheel and top-ten payout treatment can be judged without misrepresenting the
 * unusually sparse archived level-15 result.
 */
export function buildFullDemoSnapshot(source = {}) {
  const subbucketTotals = [];
  const winningSubbuckets = {};
  const winnerPlayers = [];
  const players = [];
  const winnerNames = {};
  let addressIndex = 1;
  let winningScore = 0n;
  let totalFlipBurnedValue = 0n;

  for (const bucket of DRAW_ORDER) {
    const selected = (bucket * 7 + 3) % bucket;
    winningSubbuckets[String(bucket)] = selected;
    let selectedScore = 0n;

    for (let subbucket = 0; subbucket < bucket; subbucket += 1) {
      const whole = 18_000
        + (((bucket * 31) + (subbucket * 17)) % 67) * 1_250
        + ((bucket - subbucket) * 1_900);
      const score = BigInt(whole) * UNIT;
      subbucketTotals.push({ bucket, subbucket, score: score.toString() });
      totalFlipBurnedValue += score;
      if (subbucket === selected) selectedScore = score;
    }

    winningScore += selectedScore;
    const weights = bucket % 2 === 0 ? [64n, 36n] : [52n, 31n, 17n];
    let distributed = 0n;
    weights.forEach((weight, splitIndex) => {
      const score = splitIndex === weights.length - 1
        ? selectedScore - distributed
        : (selectedScore * weight) / 100n;
      distributed += score;
      const address = demoAddress(addressIndex);
      const row = {
        address,
        bucket,
        subbucket: selected,
        score: score.toString(),
      };
      winnerPlayers.push(row);
      players.push(row);
      winnerNames[address.toLowerCase()] = FULL_DEMO_NAMES[addressIndex - 1]
        || `Degen ${addressIndex}`;
      addressIndex += 1;
    });
  }

  // A few misses keep the player picker useful for checking loss states too.
  for (const bucket of DRAW_ORDER.slice(0, 4)) {
    const selected = winningSubbuckets[String(bucket)];
    const subbucket = (selected + 1) % bucket;
    const total = raw(subbucketTotals.find((row) => (
      row.bucket === bucket && row.subbucket === subbucket
    ))?.score);
    players.push({
      address: demoAddress(addressIndex),
      bucket,
      subbucket,
      score: (total / 3n).toString(),
    });
    addressIndex += 1;
  }

  const ranked = [...winnerPlayers].sort((left, right) => (
    raw(right.score) > raw(left.score) ? 1 : -1
  ));
  return {
    ...source,
    network: 'FULL DATA ART PREVIEW',
    isDemo: true,
    ethDisplayScale: String(source.ethDisplayScale || '1000000'),
    poolWei: '486750000000000',
    totalFlipBurned: ((totalFlipBurnedValue * 13n) / 10n).toString(),
    winningScore: winningScore.toString(),
    defaultPlayer: ranked[7]?.address || ranked[0]?.address || '',
    winningSubbuckets,
    subbucketTotals,
    winnerPlayers,
    winnerNames,
    players,
  };
}

/** Best-effort public Discord directory. Missing entries simply use last-4. */
export async function loadKnownWinnerNames({ fetcher = globalThis.fetch } = {}) {
  if (typeof fetcher !== 'function') return new Map();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), 1_800);
  try { timeout?.unref?.(); } catch (_error) { /* browser timer */ }
  try {
    const response = await fetcher(DISCORD_DIRECTORY_URL, {
      credentials: 'include',
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response?.ok) return new Map();
    const payload = await response.json();
    const names = new Map();
    for (const row of Array.isArray(payload?.leaderboard) ? payload.leaderboard : []) {
      const address = String(row?.eth_address || '').toLowerCase();
      const name = String(row?.discord_name || '').trim();
      if (address && name) names.set(address, name.slice(0, 64));
    }
    return names;
  } catch (_error) {
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

function shortAddress(address) {
  const value = String(address || '');
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function polar(radius, degrees) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: 300 + radius * Math.cos(radians),
    y: 300 + radius * Math.sin(radians),
  };
}

function wheelRingSector(start, end, outerRadius, innerRadius) {
  const safeEnd = end - start >= 360 ? start + 359.999 : end;
  const outerStart = polar(outerRadius, start);
  const outerEnd = polar(outerRadius, safeEnd);
  const innerEnd = polar(innerRadius, safeEnd);
  const innerStart = polar(innerRadius, start);
  const largeArc = safeEnd - start > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function mixHex(color, target, ratio) {
  const read = (value) => Number.parseInt(value, 16);
  const source = String(color || '#777777').replace('#', '').padEnd(6, '7').slice(0, 6);
  const destination = String(target || '#ffffff').replace('#', '').padEnd(6, 'f').slice(0, 6);
  const mixed = [0, 2, 4].map((offset) => {
    const start = read(source.slice(offset, offset + 2));
    const end = read(destination.slice(offset, offset + 2));
    return Math.round(start + ((end - start) * ratio)).toString(16).padStart(2, '0');
  });
  return `#${mixed.join('')}`;
}

function wheelSlotCenter(slot, slotCount) {
  // Physical slot zero is the first ordered winner, at roughly one o'clock.
  return -60 + (slot * (360 / slotCount));
}

function selectorAngle(slot, slotCount) {
  // The selector artwork points to twelve o'clock at rotate(0).
  return wheelSlotCenter(slot, slotCount) + 90;
}

function wheelRingSlice(slot, slotCount, outerRadius, innerRadius) {
  const arc = 360 / slotCount;
  const gap = Math.min(1.35, arc * 0.06);
  const center = wheelSlotCenter(slot, slotCount);
  const start = center - (arc / 2) + gap;
  const end = center + (arc / 2) - gap;
  return wheelRingSector(start, end, outerRadius, innerRadius);
}

function wheelSlice(slot, slotCount) {
  return wheelRingSlice(slot, slotCount, 262, 112);
}

function wheelPlayerShare(slot, slotCount, shareBps) {
  const ratio = Math.max(0, Math.min(1, Number(shareBps) / 10_000));
  if (ratio <= 0) return '';
  // Ownership is an actual angular pie slice inside the selected subbucket.
  // With identical inner/outer radii, angular share equals annulus-area share.
  const arc = 360 / slotCount;
  const gap = Math.min(1.35, arc * 0.06);
  const center = wheelSlotCenter(slot, slotCount);
  const available = arc - (gap * 2);
  const playerArc = available * ratio;
  return wheelRingSector(
    center - (playerArc / 2),
    center + (playerArc / 2),
    262,
    112,
  );
}

function svg(name, className = '') {
  const element = document.createElementNS(SVG_NS, name);
  if (className) element.setAttribute('class', className);
  return element;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DecimatorDrawReplay {
  constructor(snapshot) {
    this.snapshot = snapshot;
    this.frames = buildDrawFrames(snapshot);
    this.player = null;
    this.completed = [];
    this.runningTotal = 0n;
    this.pointerAngle = 30;
    this.speed = 1;
    this.runToken = 0;
    this.animations = new Set();
    this.winnerNames = new Map(Object.entries(snapshot.winnerNames || {}).map(([address, name]) => (
      [String(address).toLowerCase(), String(name)]
    )));
    this.allocationVisible = false;
    this.totalBurned = totalFlipBurned(snapshot);
    this.ethDisplayScale = raw(snapshot.ethDisplayScale) || 1n;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    this.bind = (name) => document.querySelector(`[data-bind="${name}"]`);
  }

  async init() {
    document.body?.classList?.toggle('is-demo', this.snapshot.isDemo === true);
    const roundContext = this.bind('round-context');
    if (roundContext) {
      roundContext.textContent = this.snapshot.isDemo ? 'FULL DATA ART PREVIEW' : 'LAST RESOLVED';
    }
    this.bind('round-level').textContent = `LEVEL ${this.snapshot.level}`;
    this.bind('prize-pool').textContent = formatEth(
      this.snapshot.poolWei,
      this.ethDisplayScale,
      2,
    );
    this.#buildWheelHardware();
    this.#buildPlayerPicker();
    const initialAddress = await this.#resolvePlayerAddress();
    this.#selectPlayer(initialAddress);
    this.#wireControls();
    this.#resetView();
    if (new URLSearchParams(window.location.search).get('result') === '1') {
      this.finish();
      return;
    }
    await sleep(this.reducedMotion ? 50 : 550);
    this.play();
  }

  setWinnerNames(names) {
    if (names instanceof Map) {
      for (const [address, name] of names) {
        this.winnerNames.set(String(address).toLowerCase(), String(name));
      }
    }
    if (this.allocationVisible) {
      this.#renderWinnerLegend(buildWinnerAllocation(this.snapshot, this.player?.address));
    }
  }

  #buildPlayerPicker() {
    const select = this.bind('player-select');
    const sorted = [...this.snapshot.players].sort((left, right) => {
      if (left.address === this.snapshot.defaultPlayer) return -1;
      if (right.address === this.snapshot.defaultPlayer) return 1;
      return raw(right.score) > raw(left.score) ? 1 : -1;
    });
    for (const player of sorted) {
      const option = document.createElement('option');
      option.value = player.address.toLowerCase();
      const identity = this.winnerNames.get(player.address.toLowerCase()) || shortAddress(player.address);
      option.textContent = `${identity} · ${bucketScoreLabel(player.bucket)} DEGEN RATING`;
      select.appendChild(option);
    }
  }

  async #resolvePlayerAddress() {
    const requested = new URLSearchParams(window.location.search).get('player')?.toLowerCase();
    if (this.snapshot.players.some((player) => player.address.toLowerCase() === requested)) {
      return requested;
    }
    try {
      const accounts = await window.ethereum?.request?.({ method: 'eth_accounts' });
      const connected = String(accounts?.[0] || '').toLowerCase();
      if (this.snapshot.players.some((player) => player.address.toLowerCase() === connected)) {
        return connected;
      }
    } catch (_error) { /* an authorized account is helpful, never required */ }
    return String(this.snapshot.defaultPlayer || this.snapshot.players[0]?.address || '').toLowerCase();
  }

  #selectPlayer(address) {
    const normalized = String(address || '').toLowerCase();
    this.player = this.snapshot.players.find(
      (player) => player.address.toLowerCase() === normalized,
    ) || this.snapshot.players[0] || null;
    if (this.player) this.bind('player-select').value = this.player.address.toLowerCase();
    this.#renderPlayer('waiting');
    this.#renderPayout();
  }

  #buildWheelHardware() {
    const host = this.bind('wheel-hardware');
    host.replaceChildren();
    const slotCount = this.frames[0].slotCount;
    const arc = 360 / slotCount;
    for (let slot = 0; slot < slotCount; slot += 1) {
      const center = wheelSlotCenter(slot, slotCount);
      const seam = center - (arc / 2);
      const markStart = polar(282, seam);
      const markEnd = polar(291, seam);
      const mark = svg('line', 'wheel-index-mark');
      mark.setAttribute('x1', String(markStart.x));
      mark.setAttribute('y1', String(markStart.y));
      mark.setAttribute('x2', String(markEnd.x));
      mark.setAttribute('y2', String(markEnd.y));
      host.appendChild(mark);

      const boltPoint = polar(275, center);
      const bolt = svg('circle', 'wheel-bolt');
      bolt.setAttribute('cx', String(boltPoint.x));
      bolt.setAttribute('cy', String(boltPoint.y));
      bolt.setAttribute('r', '5');
      host.appendChild(bolt);
      const core = svg('circle', 'wheel-bolt-core');
      core.setAttribute('cx', String(boltPoint.x - 1.2));
      core.setAttribute('cy', String(boltPoint.y - 1.2));
      core.setAttribute('r', '1.45');
      host.appendChild(core);
    }
  }

  #wireControls() {
    this.bind('replay').addEventListener('click', () => this.play());
    this.bind('skip').addEventListener('click', () => this.finish());
    this.bind('speed').addEventListener('click', () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
      this.bind('speed').textContent = `${this.speed}×`;
    });
    this.bind('player-select').addEventListener('change', (event) => {
      this.#selectPlayer(event.target.value);
      const url = new URL(window.location.href);
      url.searchParams.set('player', this.player.address);
      window.history.replaceState(null, '', url);
      this.play();
    });
  }

  #cancelRun() {
    this.runToken += 1;
    for (const animation of this.animations) {
      try { animation.cancel(); } catch (_error) { /* already finished */ }
    }
    this.animations.clear();
    this.bind('result-pop').hidden = true;
    this.bind('wheel-wrap').classList.remove(
      'is-locking', 'is-drawing', 'is-settled', 'is-complete',
      'is-combining', 'is-allocation',
    );
    this.bind('winner-pie').replaceChildren();
    this.bind('winner-allocation').hidden = true;
    this.bind('winner-allocation').parentElement?.classList?.remove('has-winner-allocation');
    this.allocationVisible = false;
  }

  #resetView() {
    this.completed = [];
    this.runningTotal = 0n;
    this.pointerAngle = selectorAngle(0, this.frames[0].slotCount);
    this.bind('wheel-selector').style.transform = `rotate(${this.pointerAngle}deg)`;
    this.bind('winning-score').textContent = '0';
    this.#showHubBurned();
    this.bind('skip').disabled = false;
    this.#renderPlayer('waiting');
    this.#renderPayout();
    this.#renderFrame(this.frames[0], { phase: 'ready', current: 0 });
  }

  async play() {
    this.#cancelRun();
    const token = this.runToken;
    this.#resetView();
    this.#showHubWinning(0n);
    for (let index = 0; index < this.frames.length; index += 1) {
      if (token !== this.runToken) return;
      const frame = this.frames[index];
      this.#renderFrame(frame, { phase: 'spinning', current: index });
      await this.#spin(frame, token);
      if (token !== this.runToken) return;
      await this.#lockSelection(frame, token);
      if (token !== this.runToken) return;

      const before = this.runningTotal;
      const payoutBefore = this.#projectedPayout();
      this.completed.push(frame);
      this.runningTotal += frame.winningScore;
      const payoutAfter = this.#projectedPayout();
      this.#renderFrame(frame, { phase: 'locked', current: index, settled: true });
      const resolvedPlayer = this.player?.bucket === frame.bucket
        ? playerResult(this.snapshot, this.player)
        : null;
      if (resolvedPlayer) this.#renderPlayer(resolvedPlayer.won ? 'won' : 'lost');
      // The instant the player's slice resolves, stop presenting its value as
      // a hypothetical. A winner's amount remains live while later winning
      // slices join the denominator, but the entitlement itself is real.
      this.#renderPayout(payoutBefore);
      await Promise.all([
        this.#countScore(before, this.runningTotal, token),
        this.#countPayout(payoutBefore, payoutAfter, token),
      ]);
      if (token !== this.runToken) return;

      if (resolvedPlayer) await this.#showPlayerResult(resolvedPlayer, token);
      await sleep((this.reducedMotion ? 25 : 420) / this.speed);
    }
    if (token !== this.runToken) return;
    await this.#renderComplete(token);
  }

  finish() {
    this.#cancelRun();
    const token = this.runToken;
    this.completed = [...this.frames];
    this.runningTotal = sumWinningScore(this.frames);
    this.bind('winning-score').textContent = formatScore(this.runningTotal);
    this.#showHubWinning(this.runningTotal);
    const result = playerResult(this.snapshot, this.player);
    this.#renderPlayer(result?.won ? 'won' : 'lost');
    this.#renderPayout();
    this.#renderFrame(this.frames.at(-1), {
      phase: 'complete',
      current: null,
      settled: true,
    });
    void this.#renderComplete(token, { fast: true });
  }

  async #renderComplete(token = this.runToken, { fast = false } = {}) {
    const wrap = this.bind('wheel-wrap');
    wrap.classList.remove('is-drawing', 'is-settled', 'is-locking');
    wrap.classList.add('is-complete');
    this.bind('draw-phase').textContent = 'COMPLETE';
    this.bind('active-bucket').textContent = 'SCORE GROUPS LOCKED';
    this.bind('active-detail').textContent = `${this.frames.length} RESULTS`;
    this.bind('skip').disabled = true;
    this.#renderRail(null);
    this.#renderWheel(this.frames.at(-1), { settled: true, complete: true });
    await this.#showFinalAllocation(token, { fast });
  }

  #winnerIdentity(entry) {
    if (entry?.isPlayer) return 'YOU';
    if (entry?.kind === 'other') return 'OTHER WINNERS';
    const known = this.winnerNames.get(String(entry?.address || '').toLowerCase());
    if (known) return known;
    const address = String(entry?.address || '');
    return address ? `0x…${address.slice(-4)}` : 'UNKNOWN';
  }

  #winnerPayoutLabel(value) {
    const displayed = raw(value) * this.ethDisplayScale;
    const digits = displayed >= 100n * UNIT ? 1 : displayed >= UNIT ? 3 : 5;
    return `${formatEth(value, this.ethDisplayScale, digits)} ETH`;
  }

  #renderWinnerLegend(allocation) {
    const panel = this.bind('winner-allocation');
    const legend = this.bind('winner-legend');
    legend.replaceChildren();
    this.bind('winner-count').textContent = `${allocation.winnerCount} ${allocation.winnerCount === 1 ? 'WINNER' : 'WINNERS'}`;

    for (const entry of allocation.entries) {
      const row = document.createElement('div');
      row.className = `winner-legend__row${entry.isPlayer ? ' is-player' : ''}${entry.kind === 'other' ? ' is-other' : ''}`;
      const rank = document.createElement('span');
      rank.className = 'winner-legend__rank';
      rank.textContent = entry.rank ? `#${entry.rank}` : '+';
      const swatch = document.createElement('span');
      swatch.className = 'winner-legend__swatch';
      swatch.style.setProperty('--winner-color', entry.color);
      const identity = document.createElement('strong');
      identity.className = 'winner-legend__identity';
      identity.textContent = this.#winnerIdentity(entry);
      const award = document.createElement('span');
      award.className = 'winner-legend__award';
      const amount = document.createElement('b');
      amount.textContent = this.#winnerPayoutLabel(entry.payoutWei);
      award.appendChild(amount);
      row.appendChild(rank);
      row.appendChild(swatch);
      row.appendChild(identity);
      row.appendChild(award);
      legend.appendChild(row);
    }

    if (this.player && !allocation.viewedWinner) {
      const row = document.createElement('div');
      row.className = 'winner-legend__row is-player is-miss';
      const rank = document.createElement('span');
      rank.className = 'winner-legend__rank';
      rank.textContent = '—';
      const swatch = document.createElement('span');
      swatch.className = 'winner-legend__swatch';
      swatch.style.setProperty('--winner-color', '#555b68');
      const identity = document.createElement('strong');
      identity.className = 'winner-legend__identity';
      identity.textContent = 'YOU';
      const award = document.createElement('span');
      award.className = 'winner-legend__award';
      const amount = document.createElement('b');
      amount.textContent = '0 ETH';
      award.appendChild(amount);
      row.appendChild(rank);
      row.appendChild(swatch);
      row.appendChild(identity);
      row.appendChild(award);
      legend.appendChild(row);
    }
    panel.parentElement?.classList?.add('has-winner-allocation');
    panel.hidden = false;
  }

  #appendWinnerPie(allocation, host) {
    const total = raw(allocation.total);
    if (total <= 0n) return [];
    let cursor = -90;
    const rendered = [];
    allocation.entries.forEach((entry, index) => {
      const score = raw(entry.score);
      const span = index === allocation.entries.length - 1
        ? 270 - cursor
        : Number((score * 3_600_000n) / total) / 10_000;
      const end = cursor + Math.max(0, span);
      const gap = Math.min(0.8, Math.max(0, span) * 0.035);
      const path = svg('path', 'winner-pie__slice');
      path.setAttribute('d', wheelRingSector(cursor + gap, end - gap, 262, 112));
      path.style.setProperty('--winner-color', entry.color);
      const gradientId = `winner-pie-fill-${this.runToken}-${index}`;
      const gradient = svg('linearGradient');
      gradient.id = gradientId;
      gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
      gradient.setAttribute('x1', '110');
      gradient.setAttribute('y1', '85');
      gradient.setAttribute('x2', '500');
      gradient.setAttribute('y2', '520');
      [
        ['0%', mixHex(entry.color, '#ffffff', 0.34)],
        ['46%', entry.color],
        ['100%', mixHex(entry.color, '#030307', 0.55)],
      ].forEach(([offset, color]) => {
        const stop = svg('stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('stop-color', color);
        gradient.appendChild(stop);
      });
      host.appendChild(gradient);
      path.style.fill = `url(#${gradientId})`;
      if (entry.isPlayer) path.classList.add('is-player');
      if (entry.kind === 'other') path.classList.add('is-other');
      const identity = this.#winnerIdentity(entry);
      const title = svg('title');
      title.textContent = `${identity}: ${this.#winnerPayoutLabel(entry.payoutWei)}`;
      path.appendChild(title);
      host.appendChild(path);
      rendered.push(path);

      const center = cursor + (span / 2);
      // Dense rounds can put a dozen identified payouts around one edge. Keep
      // the chart legible by labeling broad slices plus YOU; the complete top
      // ten remains visible in the adjacent exact-value ledger.
      if (span >= 22 || entry.isPlayer) {
        const labelPoint = polar(span >= 22 ? 190 : 224, center);
        const label = svg('g', 'winner-pie__label');
        if (entry.isPlayer) label.classList.add('is-player');
        if (span < 22) label.classList.add('is-tiny');
        const plate = svg('rect', 'winner-pie__label-plate');
        plate.setAttribute('x', String(labelPoint.x - 44));
        plate.setAttribute('y', String(labelPoint.y - 21));
        plate.setAttribute('width', '88');
        plate.setAttribute('height', '43');
        plate.setAttribute('rx', '4');
        label.appendChild(plate);
        const key = svg('text', 'winner-pie__label-key');
        key.setAttribute('x', String(labelPoint.x));
        key.setAttribute('y', String(labelPoint.y - 2));
        key.setAttribute('text-anchor', 'middle');
        key.textContent = entry.isPlayer ? 'YOU' : entry.kind === 'other' ? 'OTHER' : `#${entry.rank}`;
        const amount = svg('text', 'winner-pie__label-amount');
        amount.setAttribute('x', String(labelPoint.x));
        amount.setAttribute('y', String(labelPoint.y + 16));
        amount.setAttribute('text-anchor', 'middle');
        amount.textContent = this.#winnerPayoutLabel(entry.payoutWei);
        label.appendChild(key);
        label.appendChild(amount);
        host.appendChild(label);
        rendered.push(label);
      }
      cursor = end;
    });
    return rendered;
  }

  async #showFinalAllocation(token, { fast = false } = {}) {
    const allocation = buildWinnerAllocation(this.snapshot, this.player?.address);
    const host = this.bind('winner-pie');
    const wrap = this.bind('wheel-wrap');
    host.replaceChildren();
    this.allocationVisible = true;

    if (raw(allocation.total) <= 0n || allocation.entries.length === 0) {
      this.bind('active-bucket').textContent = 'NO PAYOUT WINNERS';
      this.bind('active-detail').textContent = 'WINNING SCORE WAS ZERO';
      this.#renderWinnerLegend(allocation);
      return;
    }

    this.bind('draw-phase').textContent = 'COMBINING';
    this.bind('active-bucket').textContent = 'MERGING WINNING POOLS';
    this.bind('active-detail').textContent = 'BUILDING FINAL PAYOUT PIE';
    wrap.classList.add('is-combining');
    const merge = svg('circle', 'winner-pie__merge');
    merge.setAttribute('cx', '300');
    merge.setAttribute('cy', '300');
    merge.setAttribute('r', '187');
    merge.setAttribute('pathLength', '100');
    merge.setAttribute('transform', 'rotate(-90 300 300)');
    host.appendChild(merge);

    const mergeDuration = this.reducedMotion ? 1 : (fast ? 520 : 980) / this.speed;
    const mergeAnimation = merge.animate([
      { strokeDashoffset: '100', opacity: 0.28 },
      { strokeDashoffset: '0', opacity: 1 },
    ], {
      duration: mergeDuration,
      easing: 'cubic-bezier(.2,.78,.16,1)',
      fill: 'forwards',
    });
    this.animations.add(mergeAnimation);
    // Do not gate the final result on Animation.finished. Chromium can leave
    // that promise pending when a tab/iframe is backgrounded or when reduced
    // motion is emulated, which stranded the replay on the green merge ring.
    // A bounded clock preserves the animation while guaranteeing progression.
    await sleep(mergeDuration + (this.reducedMotion ? 0 : 34));
    merge.style.strokeDashoffset = '0';
    merge.style.opacity = '1';
    mergeAnimation.cancel();
    this.animations.delete(mergeAnimation);
    if (token !== this.runToken) return;
    await sleep((this.reducedMotion ? 1 : fast ? 90 : 220) / this.speed);
    if (token !== this.runToken) return;

    const pieElements = this.#appendWinnerPie(allocation, host);
    this.#renderWinnerLegend(allocation);
    wrap.classList.remove('is-combining');
    wrap.classList.add('is-allocation');
    this.bind('draw-phase').textContent = 'PAYOUTS';
    this.bind('active-bucket').textContent = 'FINAL WINNER SHARES';
    this.bind('active-detail').textContent = `TOP 10${allocation.viewedWinner ? ' + YOU' : ''}`;
    this.bind('draw-wheel').setAttribute(
      'aria-label',
      `Final Decimator payout pie for ${allocation.winnerCount} winners. The ten largest winners and the viewed player's share are identified.`,
    );

    const revealDuration = this.reducedMotion ? 1 : (fast ? 420 : 760) / this.speed;
    const revealAnimations = pieElements.map((element, index) => {
      const animation = element.animate([
        { opacity: 0, transform: 'scale(.82) rotate(-2deg)' },
        { opacity: 1, transform: 'scale(1) rotate(0deg)' },
      ], {
        duration: revealDuration,
        delay: this.reducedMotion ? 0 : Math.min(index, 12) * (18 / this.speed),
        easing: 'cubic-bezier(.16,.8,.2,1)',
        fill: 'both',
      });
      this.animations.add(animation);
      return animation;
    });
    const mergeFade = merge.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: revealDuration,
      easing: 'ease-out',
      fill: 'forwards',
    });
    this.animations.add(mergeFade);
    const maxRevealDelay = this.reducedMotion
      ? 0
      : Math.min(Math.max(0, pieElements.length - 1), 12) * (18 / this.speed);
    await sleep(revealDuration + maxRevealDelay + (this.reducedMotion ? 0 : 34));
    if (token !== this.runToken) return;
    for (const [index, element] of pieElements.entries()) {
      element.style.opacity = '1';
      element.style.transform = 'scale(1) rotate(0deg)';
      revealAnimations[index]?.cancel();
      this.animations.delete(revealAnimations[index]);
    }
    mergeFade.cancel();
    this.animations.delete(mergeFade);
    merge.remove();
  }

  #renderFrame(frame, { phase, current, settled = false }) {
    const wrap = this.bind('wheel-wrap');
    wrap.classList.toggle('is-drawing', phase === 'spinning');
    wrap.classList.toggle('is-settled', phase === 'locked');
    wrap.classList.remove('is-complete');
    this.bind('draw-phase').textContent = phase === 'spinning'
      ? 'DRAWING'
      : phase === 'locked' ? 'LOCKED'
        : phase === 'complete' ? 'COMPLETE' : 'READY';
    this.bind('active-bucket').textContent = `${bucketScoreLabel(frame.bucket)} DEGEN RATING`;
    this.bind('active-detail').textContent = settled
      ? 'WINNER LOCKED'
      : `${frame.bucket} POSSIBLE SLICES`;
    this.bind('winning-progress').textContent = `${this.completed.length} OF ${this.frames.length} WINNING SLICES LOCKED`;
    this.#renderRail(current);
    this.#renderWheel(frame, {
      settled,
      complete: phase === 'complete',
      justLocked: settled ? frame : null,
    });
  }

  #renderRail(currentIndex) {
    const rail = this.bind('bucket-rail');
    rail.replaceChildren();
    rail.style.setProperty('--bucket-count', String(this.frames.length));
    for (let index = 0; index < this.frames.length; index += 1) {
      const frame = this.frames[index];
      const item = document.createElement('span');
      item.className = 'bucket-token';
      item.textContent = bucketScoreLabel(frame.bucket);
      item.setAttribute('aria-label', `Minimum ${bucketScoreLabel(frame.bucket)} Degen Rating`);
      if (this.completed.includes(frame)) item.classList.add('is-complete');
      if (index === currentIndex) item.classList.add('is-current');
      if (this.player?.bucket === frame.bucket) item.classList.add('is-player');
      const locked = this.completed.includes(frame);
      item.title = locked
        ? `${bucketScoreLabel(frame.bucket)} Degen Rating winner locked`
        : this.player?.bucket === frame.bucket
          ? `Your minimum-rating group: ${bucketScoreLabel(frame.bucket)}`
          : `Minimum Degen Rating: ${bucketScoreLabel(frame.bucket)}`;
      rail.appendChild(item);
    }
  }

  #renderWheel(frame, { settled = false, complete = false, justLocked = null } = {}) {
    const segmentHost = this.bind('wheel-segments');
    const playerShareHost = this.bind('wheel-player-shares');
    const highlightHost = this.bind('wheel-highlights');
    const labelHost = this.bind('wheel-labels');
    segmentHost.replaceChildren();
    playerShareHost.replaceChildren();
    highlightHost.replaceChildren();
    labelHost.replaceChildren();
    const lockByPhysical = new Map(this.completed.map((lock) => [lock.lockPhysical, lock]));

    for (let physical = 0; physical < frame.slotCount; physical += 1) {
      const locked = lockByPhysical.get(physical) || null;
      const subbucket = settled ? -1 : frame.activeSlots.indexOf(physical);
      const isActive = subbucket >= 0 && !locked;
      const isReserved = !locked && !isActive && !complete && physical === frame.lockPhysical;
      const isPlayer = isActive
        && this.player?.bucket === frame.bucket
        && integer(this.player.subbucket, -1) === subbucket;
      const isPlayerWin = locked
        && this.player?.bucket === locked.bucket
        && integer(this.player.subbucket, -1) === locked.winningSubbucket;
      const isPlayerSlice = isPlayer || isPlayerWin;
      const shareBps = isPlayerSlice
        ? playerSubbucketShareBps(this.snapshot, this.player)
        : 0;

      const path = svg('path', 'wheel-segment');
      path.setAttribute('d', wheelSlice(physical, frame.slotCount));
      path.setAttribute('data-physical', String(physical));
      if (isActive) path.classList.add(`wheel-segment--${subbucket % 2 ? 'odd' : 'even'}`);
      if (isActive) path.classList.add('is-active');
      if (isActive) path.setAttribute('data-subbucket', String(subbucket));
      if (locked) path.classList.add('is-locked-winner');
      if (isReserved) path.classList.add('is-reserved');
      if (!locked && !isActive && !isReserved) path.classList.add('is-empty');
      if (justLocked && justLocked === locked) path.classList.add('is-just-locked');
      if (isPlayer) path.classList.add('is-player');
      if (isPlayerWin) path.classList.add('is-player-win');
      segmentHost.appendChild(path);

      if (isPlayerSlice && shareBps > 0) {
        const share = svg('path', 'wheel-player-share');
        share.setAttribute('d', wheelPlayerShare(physical, frame.slotCount, shareBps));
        share.setAttribute('data-physical', String(physical));
        share.setAttribute('data-share-bps', String(shareBps));
        if (isActive) share.setAttribute('data-subbucket', String(subbucket));
        if (locked) share.classList.add('is-locked');
        if (justLocked && justLocked === locked) share.classList.add('is-just-locked');
        const title = svg('title');
        title.textContent = `Your ${formatScore(this.player.score)} score is ${formatSharePercent(shareBps)} of this subbucket`;
        share.appendChild(title);
        playerShareHost.appendChild(share);
      }

      if (locked || isActive) {
        const sheen = svg('path', 'wheel-sheen');
        sheen.setAttribute('d', wheelSlice(physical, frame.slotCount));
        sheen.setAttribute('data-physical', String(physical));
        if (isActive) sheen.setAttribute('data-subbucket', String(subbucket));
        if (locked) sheen.classList.add('is-locked');
        if (isPlayer) sheen.classList.add('is-player');
        highlightHost.appendChild(sheen);
      }

      if (!locked && !isActive) continue;

      const point = polar(187, wheelSlotCenter(physical, frame.slotCount));
      const label = svg('g', 'wheel-label');
      label.setAttribute('data-physical', String(physical));
      if (isActive) label.setAttribute('data-subbucket', String(subbucket));
      if (isActive) label.classList.add('is-active');
      if (locked) label.classList.add('is-locked');
      if (isPlayerSlice) label.classList.add('is-player');

      const scoreLine = svg('text', 'wheel-label__score');
      scoreLine.setAttribute('x', String(point.x));
      scoreLine.setAttribute('y', String(point.y + 6));
      scoreLine.setAttribute('text-anchor', 'middle');
      scoreLine.textContent = locked
        ? (locked.winningScore === 0n ? 'EMPTY' : formatScore(locked.winningScore))
        : formatScore(frame.subbucketScores[subbucket]);
      label.appendChild(scoreLine);

      // The YOU/% badge explains ownership while the slice is in play. Once
      // the winner moves into the lock lane, the mint slice is enough; moving
      // the pill with it looks distorted and crowds the ordered winners.
      if (isPlayer) {
        const playerBadge = svg('g', 'wheel-label__player');
        const badge = svg('rect', 'wheel-label__player-badge');
        badge.setAttribute('x', String(point.x - 46));
        badge.setAttribute('y', String(point.y + 9));
        badge.setAttribute('width', '92');
        badge.setAttribute('height', '30');
        badge.setAttribute('rx', '15');
        playerBadge.appendChild(badge);

        const key = svg('text', 'wheel-label__player-key');
        key.setAttribute('x', String(point.x - 30));
        key.setAttribute('y', String(point.y + 29));
        key.setAttribute('text-anchor', 'middle');
        key.textContent = 'YOU';
        playerBadge.appendChild(key);

        const divider = svg('line', 'wheel-label__player-divider');
        divider.setAttribute('x1', String(point.x - 12));
        divider.setAttribute('x2', String(point.x - 12));
        divider.setAttribute('y1', String(point.y + 15));
        divider.setAttribute('y2', String(point.y + 33));
        playerBadge.appendChild(divider);

        const value = svg('text', 'wheel-label__player-value');
        value.setAttribute('x', String(point.x + 15));
        value.setAttribute('y', String(point.y + 31));
        value.setAttribute('text-anchor', 'middle');
        value.textContent = formatSharePercent(shareBps);
        playerBadge.appendChild(value);

        const title = svg('title');
        title.textContent = `Your share: ${formatSharePercent(shareBps)}`;
        playerBadge.appendChild(title);
        label.appendChild(playerBadge);
      }
      labelHost.appendChild(label);
    }

    const wheel = this.bind('draw-wheel');
    wheel.setAttribute(
      'aria-label',
      `${this.frames.length} populated Degen Rating groups. The ${bucketScoreLabel(frame.bucket)} minimum group has ${frame.bucket} possible slices; one winning slice is selected. Slice values are Decimator scores.${this.player?.bucket === frame.bucket ? ` Your mint-colored area is ${formatSharePercent(playerSubbucketShareBps(this.snapshot, this.player))} of your subbucket.` : ''}`,
    );
  }

  #setCurrentSelection(frame, physical) {
    for (const host of [
      this.bind('wheel-segments'),
      this.bind('wheel-player-shares'),
      this.bind('wheel-highlights'),
      this.bind('wheel-labels'),
    ]) {
      for (const element of host.querySelectorAll('[data-physical]')) {
        const current = Number(element.getAttribute('data-physical')) === physical
          && element.hasAttribute('data-subbucket');
        element.classList.toggle('is-current', current);
      }
    }
  }

  #closestActivePhysical(frame, angle) {
    let closest = frame.activeSlots[0];
    let distance = Infinity;
    for (const physical of frame.activeSlots) {
      const candidate = Math.abs(selectorAngle(physical, frame.slotCount) - angle);
      if (candidate < distance) {
        distance = candidate;
        closest = physical;
      }
    }
    return closest;
  }

  async #spin(frame, token) {
    const selector = this.bind('wheel-selector');
    const target = selectorAngle(frame.targetPhysical, frame.slotCount);
    if (this.reducedMotion) {
      selector.style.transform = `rotate(${target}deg)`;
      this.pointerAngle = target;
      this.#setCurrentSelection(frame, frame.targetPhysical);
      await sleep(25);
      return;
    }

    const forward = frame.activeSlots.map((slot) => selectorAngle(slot, frame.slotCount));
    const reverse = [...forward].reverse();
    // One full sweep, back across every live choice, then a final sweep that
    // decelerates onto the indexed result. The direction never jumps through a
    // locked winner, so the ordered green lane reads as out of play.
    const route = [this.pointerAngle, ...forward, ...reverse, ...forward, target]
      .filter((angle, index, list) => index === 0 || angle !== list[index - 1]);
    const legs = route.slice(1).map((to, index) => ({
      from: route[index],
      to,
      distance: Math.abs(to - route[index]),
    }));
    const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0) || 1;
    const duration = (2_250 + frame.bucket * 35) / this.speed;
    const started = performance.now();

    await new Promise((resolve) => {
      const tick = (now) => {
        if (token !== this.runToken) return resolve();
        const elapsed = Math.min(1, (now - started) / duration);
        // Ease only the final approach; the sweeps themselves remain a steady,
        // readable scan across each candidate.
        const traveled = totalDistance * (elapsed < 0.82
          ? elapsed
          : 0.82 + (0.18 * (1 - ((1 - ((elapsed - 0.82) / 0.18)) ** 3))));
        let remaining = traveled;
        let angle = route.at(-1);
        for (const leg of legs) {
          if (remaining <= leg.distance) {
            const progress = leg.distance === 0 ? 1 : remaining / leg.distance;
            angle = leg.from + ((leg.to - leg.from) * progress);
            break;
          }
          remaining -= leg.distance;
        }
        selector.style.transform = `rotate(${angle}deg)`;
        this.#setCurrentSelection(frame, this.#closestActivePhysical(frame, angle));
        if (elapsed < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    if (token !== this.runToken) return;
    selector.style.transform = `rotate(${target}deg)`;
    this.pointerAngle = target;
    this.#setCurrentSelection(frame, frame.targetPhysical);
  }

  async #lockSelection(frame, token) {
    this.bind('wheel-wrap').classList.remove('is-drawing');
    this.bind('draw-phase').textContent = 'LOCKING';
    this.bind('active-detail').textContent = 'WINNER SELECTED';
    const segmentHost = this.bind('wheel-segments');
    const playerShareHost = this.bind('wheel-player-shares');
    const labelHost = this.bind('wheel-labels');
    const highlightHost = this.bind('wheel-highlights');
    const winnerPath = segmentHost.querySelector(
      `[data-physical="${frame.targetPhysical}"][data-subbucket]`,
    );
    const winnerLabel = labelHost.querySelector(
      `[data-physical="${frame.targetPhysical}"][data-subbucket]`,
    );
    const winnerSheen = highlightHost.querySelector(
      `[data-physical="${frame.targetPhysical}"][data-subbucket]`,
    );
    const winnerShare = playerShareHost.querySelector(
      `[data-physical="${frame.targetPhysical}"][data-subbucket]`,
    );
    for (const path of segmentHost.querySelectorAll('[data-subbucket]')) {
      path.classList.add(path === winnerPath ? 'is-winner' : 'is-loser');
    }
    for (const label of labelHost.querySelectorAll('[data-subbucket]')) {
      label.classList.add(label === winnerLabel ? 'is-winner' : 'is-loser');
    }
    for (const sheen of highlightHost.querySelectorAll('[data-subbucket]')) {
      sheen.classList.add(sheen === winnerSheen ? 'is-winner' : 'is-loser');
    }
    for (const share of playerShareHost.querySelectorAll('[data-subbucket]')) {
      share.classList.add(share === winnerShare ? 'is-winner' : 'is-loser');
    }
    this.bind('wheel-wrap').classList.add('is-locking');

    await sleep((this.reducedMotion ? 20 : 260) / this.speed);
    if (token !== this.runToken) return;
    // Keep the selected score visible for the winner flash, but do not rotate
    // text around the wheel with the artwork. The settled frame rebuilds a
    // fresh label at the lock position as soon as the slice arrives.
    winnerLabel?.remove();
    const lockAngle = selectorAngle(frame.lockPhysical, frame.slotCount);
    if (!this.reducedMotion && winnerPath) {
      const rawDegrees = (frame.lockPhysical - frame.targetPhysical) * (360 / frame.slotCount);
      const degrees = ((rawDegrees + 540) % 360) - 180;
      const moving = [winnerPath, winnerShare, winnerSheen].filter(Boolean);
      const pending = moving.map((element) => {
        const animation = element.animate([
          { transform: 'rotate(0deg)', offset: 0 },
          { transform: `rotate(${degrees * 0.92}deg)`, offset: 0.76 },
          { transform: `rotate(${degrees}deg)`, offset: 1 },
        ], {
          duration: 720 / this.speed,
          easing: 'cubic-bezier(.18,.78,.16,1)',
          fill: 'forwards',
        });
        this.animations.add(animation);
        return animation.finished.catch(() => {}).finally(() => {
          this.animations.delete(animation);
          try { animation.cancel(); } catch (_error) { /* already cancelled */ }
        });
      });
      const selector = this.bind('wheel-selector');
      const needle = selector.animate([
        { transform: `rotate(${this.pointerAngle}deg)` },
        { transform: `rotate(${this.pointerAngle + degrees}deg)` },
      ], {
        duration: 720 / this.speed,
        easing: 'cubic-bezier(.18,.78,.16,1)',
        fill: 'forwards',
      });
      this.animations.add(needle);
      pending.push(needle.finished.catch(() => {}).finally(() => {
        this.animations.delete(needle);
        try { needle.cancel(); } catch (_error) { /* already cancelled */ }
      }));
      await Promise.all(pending);
    }
    if (token === this.runToken) {
      this.pointerAngle = lockAngle;
      this.bind('wheel-selector').style.transform = `rotate(${lockAngle}deg)`;
      this.bind('wheel-wrap').classList.remove('is-locking');
    }
  }

  async #countScore(from, to, token) {
    const output = this.bind('winning-score');
    const hubOutput = this.bind('hub-flip-value');
    const renderValue = (value) => {
      const formatted = formatScore(value);
      output.textContent = formatted;
      hubOutput.textContent = formatted;
    };
    if (this.reducedMotion || to === from) {
      renderValue(to);
      return;
    }
    const duration = 340 / this.speed;
    const started = performance.now();
    await new Promise((resolve) => {
      const tick = (now) => {
        if (token !== this.runToken) return resolve();
        const progress = Math.max(0, Math.min(1, (now - started) / duration));
        const eased = 1 - ((1 - progress) ** 3);
        const steps = BigInt(Math.round(eased * 1_000));
        const value = from + ((to - from) * steps) / 1_000n;
        renderValue(value);
        if (progress < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  #showHubBurned() {
    this.bind('wheel-wrap').classList.remove('is-winning-total');
    this.bind('hub-flip-label').textContent = 'TOTAL FLIP BURNED';
    this.bind('hub-flip-unit').textContent = 'FLIP';
    this.bind('hub-flip-value').textContent = this.totalBurned == null
      ? '—'
      : formatScore(this.totalBurned);
  }

  #showHubWinning(value = this.runningTotal) {
    this.bind('wheel-wrap').classList.add('is-winning-total');
    this.bind('hub-flip-label').textContent = 'TOTAL WINNING SCORE';
    this.bind('hub-flip-unit').textContent = 'SCORE';
    this.bind('hub-flip-value').textContent = formatScore(value);
  }

  #projectedPayout() {
    return projectedPlayerPayout(
      this.snapshot,
      this.player,
      this.runningTotal,
      this.completed,
    );
  }

  #renderSettlement(value = null) {
    const settlement = this.bind('player-payout-settlement');
    const unit = this.bind('player-payout-unit');
    if (unit) unit.textContent = value == null ? 'ETH' : 'TOTAL ETH VALUE';
    if (!settlement) return null;
    settlement.hidden = value == null;
    if (value == null) return null;
    const formatted = formatDecimatorSettlement(value, this.ethDisplayScale);
    this.bind('player-payout-eth').textContent = formatted.claimableLabel;
    this.bind('player-payout-reward').textContent = formatted.rewardLabel;
    this.bind('player-payout-rule').textContent = formatted.ruleLabel;
    return formatted;
  }

  #renderPayout(value = this.#projectedPayout()) {
    const card = this.bind('player-payout-card');
    const label = this.bind('player-payout-label');
    const output = this.bind('player-payout');
    const detail = this.bind('player-payout-detail');
    card.classList.remove('is-win', 'is-loss');
    this.#renderSettlement();
    output.textContent = value == null
      ? '—'
      : formatEth(value, this.ethDisplayScale, 2);
    if (!this.player) {
      label.textContent = 'YOUR PAYOUT';
      detail.textContent = 'NO ENTRY';
      return;
    }
    const playerFrame = this.completed.find((frame) => frame.bucket === this.player.bucket);
    const result = playerResult(this.snapshot, this.player);
    if (playerFrame && !result?.won) {
      card.classList.add('is-loss');
      label.textContent = 'YOUR PAYOUT';
      detail.textContent = 'YOUR SLICE WAS NOT SELECTED';
    } else if (this.completed.length === this.frames.length && result?.won) {
      card.classList.add('is-win');
      label.textContent = 'YOUR FINAL PRIZE';
      detail.textContent = 'FINAL PRO-RATA SHARE';
      this.#renderSettlement(value);
    } else if (playerFrame && result?.won) {
      card.classList.add('is-win');
      label.textContent = 'YOUR LIVE PAYOUT';
      detail.textContent = 'SLICE LOCKED · UPDATES WITH EACH WINNER';
    } else {
      label.textContent = 'IF YOUR SLICE HITS';
      detail.textContent = 'LIVE PRO-RATA ESTIMATE';
    }
    const payoutKind = playerFrame ? 'current' : 'projected';
    const finalSettlement = this.completed.length === this.frames.length && result?.won
      ? formatDecimatorSettlement(value, this.ethDisplayScale)
      : null;
    output.setAttribute(
      'aria-label',
      value == null
        ? `${payoutKind[0].toUpperCase()}${payoutKind.slice(1)} prize unavailable`
        : finalSettlement
          ? `${formatEth(value, this.ethDisplayScale, 4)} ETH total prize value; ${finalSettlement.claimableLabel} claimable; ${finalSettlement.rewardLabel}`
          : `${formatEth(value, this.ethDisplayScale, 4)} ETH ${payoutKind} prize value`,
    );
  }

  async #countPayout(from, to, token) {
    const output = this.bind('player-payout');
    const card = this.bind('player-payout-card');
    if (from == null || to == null || this.reducedMotion || from === to) {
      this.#renderPayout(to);
      return;
    }
    const duration = 520 / this.speed;
    const started = performance.now();
    if (to < from) card.classList.add('is-dropping');
    await new Promise((resolve) => {
      const tick = (now) => {
        if (token !== this.runToken) return resolve();
        const progress = Math.max(0, Math.min(1, (now - started) / duration));
        const eased = 1 - ((1 - progress) ** 3);
        const steps = BigInt(Math.round(eased * 1_000));
        const value = from + ((to - from) * steps) / 1_000n;
        output.textContent = formatEth(value, this.ethDisplayScale, 2);
        if (progress < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    card.classList.remove('is-dropping');
    if (token === this.runToken) this.#renderPayout(to);
  }

  #renderPlayer(state) {
    const card = this.bind('player-score-card');
    card.classList.remove('is-win', 'is-loss');
    const result = playerResult(this.snapshot, this.player);
    this.bind('player-score').textContent = this.player ? formatScore(this.player.score) : '—';
    this.bind('player-position').textContent = this.player
      ? `${bucketScoreLabel(this.player.bucket)} DEGEN RATING`
      : 'NO ENTRY';
    const outcome = this.bind('player-outcome');
    if (state === 'won') {
      card.classList.add('is-win');
      outcome.textContent = 'WINNING SLICE';
    } else if (state === 'lost') {
      card.classList.add('is-loss');
      outcome.textContent = 'YOUR SLICE MISSED';
    } else {
      outcome.textContent = this.player ? 'WAITING FOR YOUR BUCKET' : 'NO ENTRY';
    }
  }

  async #showPlayerResult(result, token) {
    const pop = this.bind('result-pop');
    pop.className = `result-pop ${result.won ? 'is-win' : 'is-loss'}`;
    this.bind('result-pop-title').textContent = result.won ? 'YOU WIN' : 'YOU LOSE';
    this.bind('result-pop-copy').textContent = result.won
      ? 'YOUR SLICE LOCKED'
      : 'ANOTHER SLICE LOCKED';
    pop.hidden = false;
    // Restart the CSS entrance even when a player change replays immediately.
    void pop.offsetWidth;
    pop.classList.add('is-showing');
    await sleep((this.reducedMotion ? 60 : 850) / this.speed);
    if (token !== this.runToken) return;
    pop.classList.remove('is-showing');
    await sleep((this.reducedMotion ? 20 : 180) / this.speed);
    if (token === this.runToken) pop.hidden = true;
  }
}

export async function loadSnapshot() {
  const params = new URLSearchParams(window.location.search);
  const storageKey = params.get('snapshot');
  if (storageKey) {
    let serialized = null;
    try { serialized = sessionStorage.getItem(storageKey); } catch (_error) { /* private mode */ }
    if (!serialized) throw new Error('The Decimator draw snapshot expired. Open it again.');
    try { return JSON.parse(serialized); }
    catch (_error) { throw new Error('The Decimator draw snapshot is invalid.'); }
  }
  const response = await fetch(new URL('./last-decimator.json', import.meta.url));
  if (!response.ok) throw new Error(`Last Decimator snapshot failed (${response.status}).`);
  const snapshot = await response.json();
  return params.get('demo') === 'full' ? buildFullDemoSnapshot(snapshot) : snapshot;
}

async function bootstrap() {
  try {
    document.body?.classList?.toggle(
      'is-embedded',
      new URLSearchParams(window.location.search).get('embed') === '1',
    );
    const snapshot = await loadSnapshot();
    const frames = buildDrawFrames(snapshot);
    if (sumWinningScore(frames) !== raw(snapshot.winningScore)) {
      throw new Error('Last Decimator winning-score snapshot does not reconcile.');
    }
    const replay = new DecimatorDrawReplay(snapshot);
    // Names are decorative and best-effort. Start the draw immediately; if the
    // public Discord directory returns before (or after) the final pie, update
    // only its legend without delaying authoritative on-chain animation data.
    void loadKnownWinnerNames().then((names) => replay.setWinnerNames(names));
    await replay.init();
  } catch (error) {
    const status = document.querySelector('[data-bind="draw-phase"]');
    const detail = document.querySelector('[data-bind="active-detail"]');
    if (status) status.textContent = 'UNAVAILABLE';
    if (detail) detail.textContent = error?.message || 'DRAW DATA FAILED';
  }
}

if (typeof document !== 'undefined') bootstrap();
