// /app/app/polling.js — Phase 56 Plan 56-03 (APP-04 + APP-06).
//
// Three timed API cycles plus two event-driven shared reads (D-04):
//   - gameTimer     15s
//   - playerTimer   30s
//   - healthTimer   60s
//   - lastDay       eager + chain-completion/day-mismatch only (no timer)
//   - goldRushTimer  5s   (direct-chain headline ticker — see POLL_INTERVALS.goldRush)
//
// AbortController-per-cycle (D-06): each timer firing creates a new AbortController;
// the previous in-flight cycle for the same timer is aborted before the new one starts.
// All fetches in a cycle share that cycle's signal via Promise.allSettled
// (NOT the short-circuiting variant) — one bad endpoint does not blank the
// other 3 panels (Pitfall 7).
//
// document.visibilitychange handler with 100ms debounce (Pitfall 3 iOS Safari double-fire):
// hidden → pauseAllTimers + abortAllInflight; visible → immediate re-poll across all 4 cycles.
//
// All reads share api.js's abort-aware request broker. A polling cycle keeps its
// own AbortController, but an independently mounted panel can now consume the
// same in-flight response without one caller's abort cancelling the other.
//
// abortAllInflight() exported as a stub for Phase 58 accountsChanged/disconnect wiring.
//
// Account-switcher extension (2026-07-16) — player cycle now does up to 3 things,
// still sharing the SAME 'player' timer AbortController (D-06 unchanged):
//   1. poll the viewed target's /player/:addr (existing, unwritten — Phase 60+ wires it)
//   2. when a wallet is connected, ALSO poll /player/:connected/approvers (the ONLY
//      source of operator approvals — NOT embedded in /player/:address, see combine.js
//      header note) and write the normalized owner list to approvals.list
//   3. when ui.mode === 'combined', ALSO poll /player/:addr for [connected, ...approvals.list]
//      and fold the results with combine.js's mergePlayerPayloads into app.playerCombined
// Disconnect-triggered approvals.list clearing lives in wallet.js, NOT here — every
// disconnect path (accountsChanged([]), 'disconnect' event, explicit disconnect(),
// the nav.js wallet-disconnected bridge) already resets connected/viewing/mode in one
// place; approvals.list joins that same reset block rather than duplicating the logic
// inside polling.js's stop()/pauseAllTimers (which owns timers only, no store writes).

import { fetchJSON as sharedFetchJSON, invalidateJSONCache } from './api.js';
import { clearApiCooldown, cooldownUntil } from './api-cooldown.js';
import { update, get } from './store.js';
import { mergePlayerPayloads } from './combine.js';
import { ethers, getProvider, TX_CONFIRMED_EVENT } from './contracts.js';
import { CHAIN, CONTRACTS } from './chain-config.js';
import { sharedReadProvider } from './read-provider.js';
import { decodePackedBoons } from './boons.js';
import {
  lastDayPayloadNeedsRecheck,
  normalizeLastDayPayload,
} from './last-day-state.js';
import { isMajorDrawActive } from './major-draw-activity.js';

// ---------------------------------------------------------------------------
// LOCKED constants (D-04 + Pitfall 3)
// ---------------------------------------------------------------------------

export const POLL_INTERVALS = {
  gameState: 15_000,   // 15s
  playerData: 30_000,  // 30s
  health: 60_000,      // 60s
  // NO lastDay interval. /game/jackpot/last-day is keyed to the last SEALED day:
  // once sealed the record is permanent, so a timer re-downloads ~13.4 KB of
  // identical bytes every tick — 83% of everything the client transferred, for a
  // value that changes once a day. It is fetched eagerly at start() and then only
  // when the day actually moves: publishGameState() fires it whenever the resolved
  // day runs ahead of the displayed one (and keeps a low-rate 15s fallback until
  // the indexer catches up). The fast path is refreshJackpotAfterChainCompletion:
  // it waits briefly on Cloudflare's tiny same-origin token and then downloads
  // the immutable result from the edge. A single ordinary read recovers when
  // the pointer's storage origin is unavailable; nothing is held open on Fly.
  // Gold-rush headline ticker — the FLOOR of an adaptive cadence, not a fixed
  // interval (see GOLD_RUSH_CADENCE). Each tick is one same-block Multicall3 read
  // through the player's wallet RPC, or a keyless public RPC when no compatible
  // wallet is connected. Nothing passes through our API or database.
  goldRush: 5_000,
};

/**
 * Adaptive cadence for the gold-rush ticker.
 *
 * A fixed 5s poll is wrong for how this number actually behaves. Money enters the
 * pools in bursts — a run-#18 day rollover moved the headline five times in 22
 * seconds, then nothing at all for the next five minutes (zero protocol events on
 * chain, so genuinely nothing to show). A fixed interval spends the same request
 * budget on both, and the quiet stretch is the common case.
 *
 * So: run at the floor while the headline is moving, and double the gap after every
 * couple of polls that find the same sample, up to `max`. Any change snaps straight
 * back to the floor, so a burst is still caught within ~5s of its first move and the
 * count-up animation is unaffected. Idle cost drops from 12 requests/minute to 1.
 */
const GOLD_RUSH_CADENCE = {
  active: POLL_INTERVALS.goldRush,  // headline just moved — keep the tick tight
  max: 60_000,                      // nothing moving — back all the way off
  backoffAfter: 2,                  // consecutive unchanged polls before each step
};

const VISIBILITY_DEBOUNCE_MS = 100; // Pitfall 3 mitigation
// No lastDay slot: that cycle is event-driven, not timed (see POLL_INTERVALS).
const TIMER_HANDLES = { game: null, player: null, health: null, goldRush: null };
const ACTIVE_CYCLES = new Map(); // timerName → AbortController

// Module-level state captured by start() so the visibilitychange handler
// can re-arm cadence + re-poll without losing the playerAddress (WR-01 fix).
let _activePlayerAddress = null;
let _forceGameCycle = null;
let _forceLastDayCycle = null;
let _forcePlayerCycle = null;
let _jackpotCompletionDay = null;
let _jackpotCompletionPromise = null;
let _jackpotCompletionPending = false;
let _jackpotCompletionController = null;
const JACKPOT_EDGE_WAIT_MS = 6_000;
const JACKPOT_EDGE_POLL_MS = 1_000;
const JACKPOT_EDGE_FETCH_TIMEOUT_MS = 2_500;
const JACKPOT_PLAYER_REFRESH_SPREAD_MS = 15_000;

// Gold-rush adaptive-cadence state. Reset by start() so a tab-switch return begins
// at the floor rather than inheriting a backed-off delay from before it was hidden.
let _goldRushLastBlock = null;
let _goldRushQuietPolls = 0;
let _goldRushDelay = GOLD_RUSH_CADENCE.active;
let _goldRushSnapshotReader = null;
let _goldRushPublicProvider = null;
let _boonStateReader = null;
let _boonReadProvider = null;

const GOLD_RUSH_GAME_ABI = [
  'function currentPrizePoolView() external view returns (uint256)',
  'function nextPrizePoolView() external view returns (uint256)',
  'function futurePrizePoolView() external view returns (uint256)',
  'function yieldAccumulatorView() external view returns (uint256)',
  'function currentDayView() external view returns (uint24)',
  'function extsload(bytes32 slot) external view returns (bytes32)',
];
const GOLD_RUSH_VIEW_NAMES = [
  'currentPrizePoolView',
  'nextPrizePoolView',
  'futurePrizePoolView',
  'yieldAccumulatorView',
  'currentDayView',
  'extsload',
];
const GAME_SLOT_ZERO = `0x${'00'.repeat(32)}`;
// Canonical CREATE2 Multicall3 deployment on Base Sepolia and Ethereum. Besides
// keeping the pool getters and phase clock to one wallet request, blockAndAggregate
// gives us the exact block every value came from; mixed-block state is impossible.
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
const GOLD_RUSH_MULTICALL_ABI = [
  'function blockAndAggregate(tuple(address target,bytes callData)[] calls) payable '
    + 'returns (uint256 blockNumber,bytes32 blockHash,tuple(bool success,bytes returnData)[] returnData)',
];

const BOON_STATE_ABI = [
  'function currentDayView() external view returns (uint24)',
  'function boonPacked(address player) external view returns (uint256 slot0, uint256 slot1)',
];

export async function readExactBoonState(address, { blockTag = null } = {}) {
  if (_boonStateReader) return _boonStateReader(address, { blockTag });
  if (!_boonReadProvider && CHAIN.rpcUrl) {
    _boonReadProvider = sharedReadProvider();  // C15: shared batched read stream
  }
  if (!_boonReadProvider || !CONTRACTS.GAME) throw new Error('Boon state reader unavailable');
  const game = new ethers.Contract(CONTRACTS.GAME, BOON_STATE_ABI, _boonReadProvider);
  const callOverrides = blockTag == null ? [] : [{ blockTag }];
  const [packed, currentDay] = await Promise.all([
    game.boonPacked(address, ...callOverrides),
    game.currentDayView(...callOverrides),
  ]);
  return {
    slot0: BigInt(packed?.slot0 ?? packed?.[0] ?? 0),
    slot1: BigInt(packed?.slot1 ?? packed?.[1] ?? 0),
    currentDay: Number(currentDay),
  };
}

function goldRushPublicProvider() {
  if (!_goldRushPublicProvider && CHAIN.goldRushPublicRpcUrl) {
    _goldRushPublicProvider = new ethers.JsonRpcProvider(
      CHAIN.goldRushPublicRpcUrl,
      Number(CHAIN.id),
      { staticNetwork: true, batchMaxCount: 1 },
    );
  }
  return _goldRushPublicProvider;
}

async function readGoldRushFromProvider(provider, source) {
  if (!provider || !CONTRACTS.GAME) throw new Error('Gold-rush chain reader unavailable');
  const game = new ethers.Interface(GOLD_RUSH_GAME_ABI);
  const multicall = new ethers.Contract(
    MULTICALL3_ADDRESS,
    GOLD_RUSH_MULTICALL_ABI,
    provider,
  );
  const calls = GOLD_RUSH_VIEW_NAMES.map((name) => ({
    target: CONTRACTS.GAME,
    callData: game.encodeFunctionData(name, name === 'extsload' ? [GAME_SLOT_ZERO] : []),
  }));
  const aggregate = await multicall.blockAndAggregate.staticCall(calls);
  const rows = aggregate?.returnData ?? aggregate?.[2];
  if (!Array.isArray(rows) || rows.length !== GOLD_RUSH_VIEW_NAMES.length) {
    throw new Error('Incomplete Gold-rush multicall response');
  }
  const values = rows.map((row, index) => {
    const success = row?.success ?? row?.[0];
    const returnData = row?.returnData ?? row?.[1];
    if (!success) throw new Error(`Gold-rush getter failed: ${GOLD_RUSH_VIEW_NAMES[index]}`);
    return BigInt(game.decodeFunctionResult(GOLD_RUSH_VIEW_NAMES[index], returnData)?.[0] ?? 0);
  });
  const blockNumber = Number(aggregate?.blockNumber ?? aggregate?.[0]);
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
    throw new Error('Invalid Gold-rush block number');
  }
  return {
    blockNumber,
    currentWei: values[0],
    nextWei: values[1],
    futureWei: values[2],
    yieldAccumulatorWei: values[3],
    currentDay: values[4],
    phaseSlot0: values[5],
    source,
  };
}

async function readGoldRushSnapshot() {
  if (_goldRushSnapshotReader) return _goldRushSnapshotReader();

  // A connected, correctly-networked wallet owns its own read transport. Never
  // request accounts or a signature here; BrowserProvider eth_call is silent.
  const wallet = getProvider();
  if (wallet && get('ui.chainOk') === true) {
    try {
      return await readGoldRushFromProvider(wallet, 'wallet');
    } catch (_error) {
      // A wallet RPC can be temporarily stale or rate-limited. The public reader
      // below is keyless and client-side; falling through never touches our API.
    }
  }

  const publicProvider = goldRushPublicProvider();
  if (!publicProvider) throw new Error('No compatible wallet or public Gold-rush RPC');
  return readGoldRushFromProvider(publicProvider, 'public');
}

function snapshotWei(snapshot, key) {
  const raw = snapshot?.[key];
  if (raw == null || raw === '') throw new Error(`Missing ${key}`);
  const value = BigInt(raw);
  if (value < 0n) throw new Error(`Invalid ${key}`);
  return value;
}

/**
 * Build the ticker payload from one same-block chain snapshot. This is the exact
 * contract sum: current + next + future + yieldAccumulator. Claimable is context
 * only and is deliberately excluded. `atBlock` stays pinned while both the amount
 * and phase clock are unchanged, so cadence reacts to player-visible state rather
 * than empty blocks.
 */
function buildGoldRushChainPayload(snapshot, gameState, previous = null) {
  const pools = gameState?.prizePools;
  const current = snapshotWei(snapshot, 'currentWei');
  const next = snapshotWei(snapshot, 'nextWei');
  const future = snapshotWei(snapshot, 'futureWei');
  const yieldAcc = snapshotWei(snapshot, 'yieldAccumulatorWei');
  const claimable = BigInt(pools?.claimableWinnings ?? 0);
  const headline = current + next + future + yieldAcc;
  let previousHeadline = null;
  try {
    if (previous?.headlineWei != null) previousHeadline = BigInt(previous.headlineWei);
  } catch { /* malformed prior payload is ignored */ }
  const observedBlock = Number(snapshot?.blockNumber);
  if (!Number.isSafeInteger(observedBlock) || observedBlock < 0) {
    throw new Error('Invalid Gold-rush snapshot block');
  }
  const chainPhase = decodeGoldRushPhase(snapshot?.phaseSlot0, snapshot?.currentDay);
  const priorPhase = previous?.phaseClock || null;
  const phaseChanged = Boolean(chainPhase) && (
    !priorPhase
    || chainPhase.currentDay !== priorPhase.currentDay
    || chainPhase.purchaseStartDay !== priorPhase.purchaseStartDay
    || chainPhase.level !== priorPhase.level
    || chainPhase.jackpot !== priorPhase.jackpot
    || chainPhase.jackpotCounter !== priorPhase.jackpotCounter
    || chainPhase.lastPurchaseDay !== priorPhase.lastPurchaseDay
    || chainPhase.rngLocked !== priorPhase.rngLocked
    || chainPhase.transition !== priorPhase.transition
    || chainPhase.gameOver !== priorPhase.gameOver
    || chainPhase.compressedFlag !== priorPhase.compressedFlag
  );
  const changed = previousHeadline == null || previousHeadline !== headline || phaseChanged;
  const priorMoveBlock = Number(previous?.atBlock);
  const atBlock = changed || !Number.isSafeInteger(priorMoveBlock) || priorMoveBlock < 0
    ? observedBlock
    : priorMoveBlock;
  const level = Number(gameState?.level);
  const phaseDay = Number(gameState?.jackpotCounter);

  return {
    headlineWei: headline.toString(),
    prevHeadlineWei: previousHeadline == null ? null : previousHeadline.toString(),
    deltaWei: previousHeadline == null ? '0' : (headline - previousHeadline).toString(),
    atBlock,
    fromBlock: changed ? (previous?.atBlock ?? null) : (previous?.fromBlock ?? null),
    sampledAt: null,
    components: {
      currentWei: current.toString(),
      nextWei: next.toString(),
      futureWei: future.toString(),
      yieldAccumulatorWei: yieldAcc.toString(),
      claimableWei: claimable.toString(),
    },
    grandEthWei: (future / 4n).toString(),
    indexedBlock: observedBlock,
    chainTip: observedBlock,
    lagBlocks: 0,
    level: chainPhase?.level
      ?? (Number.isSafeInteger(level) && level >= 0 ? level : null),
    phase: chainPhase
      ? chainPhase.phase
      : gameState?.phase == null ? null : String(gameState.phase),
    phaseDay: chainPhase?.jackpotCounter
      ?? (Number.isSafeInteger(phaseDay) && phaseDay >= 0 ? phaseDay : null),
    phaseDayCap: 5,
    phaseClock: chainPhase,
    frozen: Boolean(pools?.frozen ?? gameState?.prizePoolFrozen),
    ready: true,
    armed: previous?.armed ?? null,
    source: snapshot?.source === 'wallet' ? 'wallet' : 'public',
  };
}

function decodeGoldRushPhase(slot0Raw, currentDayRaw) {
  if (slot0Raw == null || currentDayRaw == null) return null;
  try {
    const slot0 = BigInt(slot0Raw);
    const currentDay = Number(currentDayRaw);
    const purchaseStartDay = Number(slot0 & 0xffffffn);
    const level = Number((slot0 >> 96n) & 0xffffffn);
    const jackpot = Boolean((slot0 >> 120n) & 0xffn);
    const jackpotCounter = Number((slot0 >> 128n) & 0xffn);
    const lastPurchaseDay = Boolean((slot0 >> 136n) & 0xffn);
    const rngLocked = Boolean((slot0 >> 152n) & 0xffn);
    const transition = Boolean((slot0 >> 160n) & 0xffn);
    const gameOver = Boolean((slot0 >> 168n) & 0xffn);
    const compressedFlag = Number((slot0 >> 184n) & 0xffn);
    if (!Number.isInteger(currentDay) || currentDay <= 0
      || !Number.isInteger(purchaseStartDay) || purchaseStartDay <= 0
      || currentDay < purchaseStartDay) return null;
    return {
      currentDay,
      purchaseStartDay,
      level,
      jackpot,
      jackpotCounter,
      purchaseDay: !jackpot && !transition
        ? currentDay - purchaseStartDay + 1
        : null,
      lastPurchaseDay: !jackpot && lastPurchaseDay,
      rngLocked,
      transition,
      gameOver,
      compressedFlag,
      phase: gameOver ? 'GAMEOVER' : jackpot ? 'JACKPOT' : 'PURCHASE',
    };
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Named wrapper retained for the polling test seam. Transport, coalescing,
// caching, and backpressure all live in api.js.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shed-load cooldown.
//
// Every timer here used to fire on schedule regardless of what came back, so a
// 429 or a 503 changed nothing: the client kept knocking at full cadence and an
// API already shedding load could not climb back out. That is the difference
// between a slow afternoon and an unrecoverable one, and it matters most at the
// moment it is least affordable — the whole player base is watching the same
// jackpot, so the overload and the traffic peak are the same event.
//
// One module-level gate rather than per-cycle handling: every read in this file
// goes through fetchJSONWithSignal, so throttling here covers all of them and
// stays correct when a new poller is added.
//
// 503 is included deliberately — it is what the lag guard returns when the
// indexer has fallen behind, and hammering a struggling indexer is exactly
// wrong. Retry-After wins when the server sends one.
// ---------------------------------------------------------------------------

/** ±20% around the nominal period. See the call sites in start(). */
function jittered(ms) {
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}

function fetchJSONWithSignal(path, { signal, force = false, cache } = {}) {
  return sharedFetchJSON(path, { signal, force, cache });
}

// ---------------------------------------------------------------------------
// 4 pollers — each accepts a signal arg threaded through fetchJSONWithSignal.
// Phase 59 (Plan 59-02) establishes "poller writes its own store path" pattern
// via pollLastDay → update('app.lastDay', payload). Phase 60+ extends to game/player/health.
// ---------------------------------------------------------------------------

async function pollGame(signal) {
  return fetchJSONWithSignal('/game/state', { signal });
}

function resolvedDayFromGameState(payload) {
  const raw = payload?.dailyRng?.day ?? payload?.currentDay ?? null;
  const day = Number(raw);
  return Number.isInteger(day) && day > 0 ? day : null;
}

/**
 * Publish the shared game snapshot and pull the jackpot whenever the exact
 * resolved day is ahead of the draw currently displayed. Comparing against
 * app.lastDay (rather than only the previous game-state sample) is important:
 * if the first jackpot request races the indexer at rollover and returns the
 * old day, every 15s state sample keeps retrying until the draw catches up.
 *
 * /game/state is pure indexed state with no volatile fields — between protocol
 * events consecutive polls return byte-identical JSON (the API serves it from
 * a 2s TTL cache). store.js has no equality check, so an unconditional publish
 * re-runs every app.gameState subscriber each 15s tick, and several treat any
 * publish as a data-changed signal (work-queue reloads, lobby refreshes). Skip
 * the store write when nothing changed; the lastDay catch-up below still runs
 * every tick, because app.lastDay can lag behind a steady game state.
 */
let _lastPublishedGameStateJson = null;

function publishGameState(payload, refreshLastDay) {
  const displayedPayload = get('app.lastDay');
  const displayedDay = Number(displayedPayload?.day);
  const nextDay = resolvedDayFromGameState(payload);
  let payloadJson = null;
  try { payloadJson = JSON.stringify(payload); } catch { payloadJson = null; }
  if (payloadJson == null || payloadJson !== _lastPublishedGameStateJson) {
    _lastPublishedGameStateJson = payloadJson;
    update('app.gameState', payload);
  }
  if (nextDay != null
    && (!Number.isInteger(displayedDay)
      || displayedDay <= 0
      || nextDay !== displayedDay
      || lastDayPayloadNeedsRecheck(displayedPayload))
    // The completion path already owns the bounded edge-first/direct-fallback
    // attempt. Do not let the 15s game fallback abort and duplicate it. Once
    // that attempt settles, this flag clears and ordinary retries can resume.
    && !(_jackpotCompletionPending && _jackpotCompletionDay === nextDay)) {
    try { refreshLastDay?.(); } catch { /* the fallback timer is still armed */ }
  }
  return payload;
}

async function pollPlayer(addr, signal) {
  if (!addr) return null;
  return fetchJSONWithSignal(`/player/${addr}`, { signal });
}

// The DB route carries deity-issued history only. Pair it with the GAME's
// public packed state so product markers also see lootbox-awarded boons and
// immediately stop showing pass discounts that were consumed without a
// BoonConsumed event. The chain answer wins when available; DB remains the
// soft-fail fallback during RPC trouble.
async function pollCurrentBoons(addr, signal) {
  const address = addr ? String(addr).toLowerCase() : null;
  if (!address) return { address: null, day: null, boons: [] };
  const state = await pollGame(signal);
  // resolvedDayFromGameState, NOT state.currentDay: /game/state carries the day
  // as `dailyRng.day` and has no `currentDay` field at all, so the bare read was
  // always NaN and this function returned an empty boon list before it ever
  // reached the indexed route or the packed chain state. The indicator could
  // never light up. That helper already encodes the correct fallback chain.
  const day = resolvedDayFromGameState(state);
  if (!Number.isInteger(day) || day < 1) return { address, day: null, boons: [] };
  const [indexed, exact] = await Promise.allSettled([
    fetchJSONWithSignal(`/player/${address}/boons/${day}`, { signal }),
    readExactBoonState(address),
  ]);
  if (exact.status === 'fulfilled') {
    const exactDay = Number(exact.value?.currentDay ?? day);
    return {
      address,
      day: exactDay,
      exact: true,
      boons: decodePackedBoons(exact.value?.slot0, exact.value?.slot1, exactDay),
    };
  }
  if (indexed.status === 'fulfilled') {
    const payload = indexed.value;
    return {
      address,
      day: Number(payload?.day ?? day),
      exact: false,
      boons: Array.isArray(payload?.boons) ? payload.boons : [],
    };
  }
  throw indexed.reason || exact.reason || new Error('Boon state unavailable');
}

// Account-switcher — dedicated approvers endpoint (NOT part of /player/:address;
// see combine.js header note). Returns { operator, approvers: [{owner, blockNumber}] }.
async function pollApprovers(addr, signal) {
  if (!addr) return null;
  return fetchJSONWithSignal(`/player/${addr}/approvers`, { signal });
}

async function pollHealth(signal) {
  return fetchJSONWithSignal('/health', { signal });
}

/** True unless a block-bearing jackpot payload demonstrably predates this deploy. */
export function lastDayMatchesDeployment(payload) {
  const rawStart = payload?.summary?.blockRange?.start
    ?? payload?.blockRange?.start
    ?? null;
  // pre-game / older API response shapes carry no draw block and cannot be
  // disproved here. Resolved current API payloads always carry summary range.
  if (rawStart == null || rawStart === '') return true;
  try { return BigInt(rawStart) >= BigInt(CHAIN.deployBlock || 0); }
  catch (_e) { return false; }
}

function publishLastDayPayload(rawPayload) {
  const payload = normalizeLastDayPayload(rawPayload);
  if (!lastDayMatchesDeployment(payload)) {
    const observedStartBlock = payload?.summary?.blockRange?.start
      ?? payload?.blockRange?.start
      ?? null;
    update('app.deploymentMismatch', {
      surface: 'jackpot',
      expectedDeployBlock: Number(CHAIN.deployBlock || 0),
      observedStartBlock: observedStartBlock == null ? null : String(observedStartBlock),
      observedDay: payload?.day ?? null,
    });
    if (get('app.lastDay') != null) update('app.lastDay', null);
    return null;
  }
  if (get('app.deploymentMismatch') != null) update('app.deploymentMismatch', null);
  update('app.lastDay', payload);
  return payload;
}

async function pollLastDay(
  signal,
  { force = false, targetDay = null, waitMs = 0 } = {},
) {
  // Phase 57 ships /game/jackpot/last-day. On 404 / network error, soft-fail returns null
  // (UI panel — Phase 59 widget — renders cold-start state by default).
  // Phase 59 Plan 59-02: write payload to store on success so the widget's
  // subscribe('app.lastDay', ...) subscriber fires per polling cycle.
  try {
    const requestedDay = Number(targetDay);
    const requestedWait = Number(waitMs);
    const waitQuery = Number.isInteger(requestedDay) && requestedDay > 0
      && Number.isFinite(requestedWait) && requestedWait > 0
      ? `?targetDay=${requestedDay}&waitMs=${Math.trunc(requestedWait)}`
      : '';
    const payload = publishLastDayPayload(
      await fetchJSONWithSignal(`/game/jackpot/last-day${waitQuery}`, {
        signal,
        force,
        cache: force ? 'no-store' : undefined,
      }),
    );
    return payload;
  } catch (_e) {
    return null;  // catch branch unchanged: no store write on failure
  }
}

// Gold-rush headline. Writes app.goldRush; gold-rush-headline.js subscribes.
// This path is chain-only: it never calls the indexer API. A failed wallet/public
// RPC read keeps the last good number rather than blanking to zero mid-animation.
async function pollGoldRush(signal) {
  if (signal?.aborted) return null;
  try {
    const snapshot = await readGoldRushSnapshot();
    if (signal?.aborted) return null;
    const payload = buildGoldRushChainPayload(
      snapshot,
      get('app.gameState'),
      get('app.goldRush'),
    );
    update('app.goldRush', payload);
    return payload;
  } catch (_error) {
    return null;
  }
}

/**
 * Pick the next gold-rush delay from what the poll just returned, and record the
 * block so the next call can tell "moved" from "same sample again".
 *
 * A null payload (RPC failed or was aborted) counts as unchanged, so a down wallet
 * or public endpoint gets backed off rather than hammered.
 *
 * @param {{atBlock?: number|null}|null} payload
 * @returns {number} delay in ms until the next poll
 */
function goldRushNextDelay(payload) {
  const block = payload && payload.atBlock != null ? payload.atBlock : null;
  const moved = block !== null && block !== _goldRushLastBlock;
  if (block !== null) _goldRushLastBlock = block;

  if (moved) {
    _goldRushQuietPolls = 0;
    _goldRushDelay = GOLD_RUSH_CADENCE.active;
    return _goldRushDelay;
  }

  _goldRushQuietPolls += 1;
  if (_goldRushQuietPolls >= GOLD_RUSH_CADENCE.backoffAfter) {
    _goldRushQuietPolls = 0;
    _goldRushDelay = Math.min(_goldRushDelay * 2, GOLD_RUSH_CADENCE.max);
  }
  return _goldRushDelay;
}

// ---------------------------------------------------------------------------
// runCycle (D-06 abort-per-cycle + Promise.allSettled)
// ---------------------------------------------------------------------------

function runCycle(timerName, fetchers) {
  // Abort the previous cycle for this timer if still running.
  const prev = ACTIVE_CYCLES.get(timerName);
  if (prev) prev.abort();
  const ctrl = new AbortController();
  ACTIVE_CYCLES.set(timerName, ctrl);
  // Promise.allSettled — D-06 + Pitfall 7: one rejected fetcher does not blank the others.
  return Promise.allSettled(fetchers.map((f) => f(ctrl.signal))).finally(() => {
    if (ACTIVE_CYCLES.get(timerName) === ctrl) ACTIVE_CYCLES.delete(timerName);
  });
}

// ---------------------------------------------------------------------------
// Player cycle orchestration (account-switcher extension).
//
// buildPlayerFetchers() snapshots store state AT CYCLE-RUN TIME (not at start()
// registration time) so a mode switch mid-session is picked up on the very next
// tick without touching the timer/abort machinery above. It returns a fetcher
// array (same shape runCycle already accepts) plus parallel `meta` describing
// what each array slot is for, so processPlayerCycleResults can route each
// Promise.allSettled result back to the right store write.
// ---------------------------------------------------------------------------

function buildPlayerFetchers() {
  const connected = get('connected.address');
  const mode = get('ui.mode');
  const approvalsList = get('approvals.list') || [];

  const fetchers = [(s) => pollPlayer(_activePlayerAddress, s)];
  const meta = [{ kind: 'viewed' }];

  // Boons and approvers used to ride this 30s timer. Neither is time-driven:
  //   - approvals change only when someone sends setApprovalForAll — a rare,
  //     deliberate transaction. Read once per start() (which also covers account
  //     switch and tab return).
  //   - boons change when the player opens a box or buys (their own tx, which
  //     fires degenerus:tx-confirmed), when a deity issues one of its 3 daily
  //     grants, or at day rollover. A boon only alters the value of the NEXT
  //     purchase, so a buy surface appearing is the moment the answer matters —
  //     boon-product-indicator asks on mount.
  // Between them they cost 4 requests a minute to move 148 bytes.
  // See refreshApprovers() / refreshBoons() below.

  // Combined mode — fetch every account's /player/:addr in the SAME cycle
  // (same AbortController) so one slow/failed account can't blank the rest
  // (Pitfall 7, same allSettled guarantee as the other 3 pollers).
  if (mode === 'combined' && connected) {
    const combinedAddrs = [connected, ...approvalsList];
    for (const addr of combinedAddrs) {
      fetchers.push((s) => pollPlayer(addr, s));
      meta.push({ kind: 'combined' });
    }
  }

  return { fetchers, meta, mode, connected };
}

/**
 * processPlayerCycleResults — routes the player cycle's Promise.allSettled
 * output back to store writes. A rejected/aborted slot is simply skipped
 * (soft-fail, matching pollLastDay's catch-and-skip convention) so one bad
 * endpoint never wipes a previously-good approvals.list or playerCombined.
 */
function processPlayerCycleResults(results, meta, mode, connected) {
  if (mode === 'combined' && connected) {
    const payloads = results
      .filter((_r, i) => meta[i].kind === 'combined')
      .map((r) => (r.status === 'fulfilled' ? r.value : null));
    update('app.playerCombined', mergePlayerPayloads(payloads));
  } else if (get('app.playerCombined') != null) {
    // Avoid churn — only write null when leaving combined mode with a stale value present.
    update('app.playerCombined', null);
  }
}

function runPlayerCycle() {
  const { fetchers, meta, mode, connected } = buildPlayerFetchers();
  return runCycle('player', fetchers).then((results) => {
    processPlayerCycleResults(results, meta, mode, connected);
    return results;
  });
}

// ---------------------------------------------------------------------------
// Gold-rush cycle — the one self-rescheduling timer.
//
// The other four are setInterval at a fixed cadence; this one re-arms itself after
// each poll so the gap can adapt (GOLD_RUSH_CADENCE). A setTimeout handle lives in
// the same TIMER_HANDLES slot the others use: per the HTML spec setTimeout and
// setInterval share one handle map and clearTimeout/clearInterval both remove from
// it, so pauseAllTimers' clearInterval cancels this correctly and needs no special
// case. `handle === null` is therefore the "still armed?" test after an await.
// ---------------------------------------------------------------------------

function scheduleGoldRush() {
  TIMER_HANDLES.goldRush = setTimeout(runScheduledGoldRushCycle, _goldRushDelay);
}

function runBackgroundCycle(cycle) {
  if (isMajorDrawActive() || typeof cycle !== 'function') return null;
  return cycle();
}

function runScheduledGoldRushCycle() {
  if (!isMajorDrawActive()) return runGoldRushCycle();
  // This timeout has fired, so replace it with a fresh cadence instead of
  // letting a skipped poll burst at the reel-to-scratch boundary.
  if (TIMER_HANDLES.goldRush !== null) {
    clearTimeout(TIMER_HANDLES.goldRush);
    scheduleGoldRush();
  }
  return Promise.resolve([]);
}

function runGoldRushCycle() {
  return runCycle('goldRush', [(s) => pollGoldRush(s)]).then((results) => {
    const r = results[0];
    _goldRushDelay = goldRushNextDelay(r && r.status === 'fulfilled' ? r.value : null);
    // pauseAllTimers (hidden tab / stop()) nulls the slot while a poll is in flight;
    // re-arming here would resurrect a timer the caller just cancelled.
    if (TIMER_HANDLES.goldRush !== null) {
      // Cancel the pending timeout before arming the next one. start() pre-arms a
      // timer so the handle is non-null the moment it returns, and the eager first
      // cycle lands here while that one is still pending — without this clear, both
      // fire and the ticker polls twice per gap.
      clearTimeout(TIMER_HANDLES.goldRush);
      scheduleGoldRush();
    }
    return results;
  });
}

// ---------------------------------------------------------------------------
// Event-driven refreshes. Neither of these has a timer; see buildPlayerFetchers.
//
// Both coalesce concurrent callers onto one in-flight request. That matters for
// boons in particular: several <boon-product-indicator> elements mount together
// when a buy surface opens, and each one asks. Without coalescing that is one
// request per product marker instead of one per surface.
// ---------------------------------------------------------------------------

let _approversInflight = null;
let _boonsInflight = null;

/**
 * Re-read operator approvals for the connected wallet and republish
 * approvals.list. Called from start(), which covers first connect, account
 * switch, and return-from-hidden. Soft-fails: a rejected read leaves the
 * previous good list in place rather than blanking the account switcher.
 */
export function refreshApprovers() {
  const connected = get('connected.address');
  if (!connected) return Promise.resolve(null);
  if (_approversInflight) return _approversInflight;

  _approversInflight = (async () => {
    try {
      const payload = await pollApprovers(connected, undefined);
      const raw = Array.isArray(payload?.approvers) ? payload.approvers : [];
      const connectedLc = String(connected).toLowerCase();
      const seen = new Set();
      const normalized = [];
      for (const row of raw) {
        const owner = row && row.owner != null ? String(row.owner).toLowerCase() : null;
        if (!owner || owner === connectedLc || seen.has(owner)) continue;
        seen.add(owner);
        normalized.push(owner);
      }
      update('approvals.list', normalized);
      return normalized;
    } catch (_e) {
      return null;
    } finally {
      _approversInflight = null;
    }
  })();
  return _approversInflight;
}

/**
 * Re-read the viewed account's boons and republish app.boons. Triggered by a
 * buy surface mounting, by the player's own confirmed transaction, and by day
 * rollover. Combined mode has no single boon owner, so it publishes empty
 * rather than showing one account's boon on the aggregate view.
 */
export function refreshBoons() {
  if (_boonsInflight) return _boonsInflight;
  const address = get('ui.mode') === 'combined' ? null : _activePlayerAddress;

  _boonsInflight = (async () => {
    try {
      const payload = await pollCurrentBoons(address, undefined);
      if (payload) update('app.boons', payload);
      return payload;
    } catch (_e) {
      return null;
    } finally {
      _boonsInflight = null;
    }
  })();
  return _boonsInflight;
}

// The two moments boons can go stale under the player's nose:
//   - their own confirmed transaction (they opened a box, or spent a boon on a
//     purchase). contracts.js dispatches TX_CONFIRMED_EVENT for every write.
//   - a buy surface appearing, which is when a deity's grant since the last
//     refresh starts to matter. boon-product-indicator announces its own mount.
// Day rollover is handled by the lastDay fan-out in start().
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener(TX_CONFIRMED_EVENT, () => {
    // contracts.js invalidates the shared read cache before dispatching this
    // event, so every listener's follow-up starts beyond the receipt boundary.
    void refreshBoons();
  });
  document.addEventListener('degenerus:boon-surface-open', () => { void refreshBoons(); });
}

/**
 * Immediate, coalesced API reconciliation requested by the direct chain-day
 * watcher. These are the same abort-per-cycle functions as normal polling;
 * rollover does not create a second fetching implementation or timer stack.
 */
export function refreshForDayShift({ includePlayer = false, includeLastDay = true } = {}) {
  const cycles = [];
  // The day watcher itself is chain-direct. Refresh the phase-bearing chain
  // snapshot immediately as well, so a stalled indexer cannot hold the strip on
  // yesterday's purchase day until the adaptive ticker's next (up to 60s) poll.
  cycles.push(runGoldRushCycle());
  if (typeof _forceGameCycle === 'function') cycles.push(_forceGameCycle());
  if (includeLastDay && typeof _forceLastDayCycle === 'function') cycles.push(_forceLastDayCycle());
  if (includePlayer && typeof _forcePlayerCycle === 'function') cycles.push(_forcePlayerCycle());
  return Promise.allSettled(cycles);
}

function abortableDelay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function validJackpotPointer(pointer) {
  const day = Number(pointer?.day);
  const digest = String(pointer?.digest ?? '');
  return pointer?.schemaVersion === 1
    && Number.isInteger(day) && day > 0
    && /^[0-9a-f]{16}$/.test(digest)
    && pointer?.resultPath === `/jackpots/results/${day}-${digest}.json`;
}

/**
 * Pages Functions do not exist behind the local static-file server. Keep the
 * production site same-origin, but let localhost consume the exact same public
 * edge token/result pair instead of falling through a stream of local 404s.
 */
export function jackpotEdgeUrl(path, locationLike = globalThis.location) {
  const hostname = String(locationLike?.hostname ?? '').toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return `https://degener.us${path}`;
  }
  return path;
}

async function fetchJackpotEdgeJSON(path, signal, timeoutMs) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  timer?.unref?.();
  try {
    const response = await fetch(jackpotEdgeUrl(path), {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    return {
      response,
      payload: response.ok ? await response.json() : null,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function waitForJackpotEdgeSnapshot(
  targetDay,
  signal,
  {
    waitMs = JACKPOT_EDGE_WAIT_MS,
    fetchTimeoutMs = JACKPOT_EDGE_FETCH_TIMEOUT_MS,
  } = {},
) {
  const deadline = Date.now() + Math.max(1, Number(waitMs) || JACKPOT_EDGE_WAIT_MS);
  while (!signal?.aborted && Date.now() < deadline) {
    try {
      // Production remains same-origin. The local static server has no Pages
      // Function, so localhost reads the same public Cloudflare endpoint.
      const remaining = Math.max(1, deadline - Date.now());
      const token = await fetchJackpotEdgeJSON(
        '/jackpots/latest.json',
        signal,
        Math.min(remaining, fetchTimeoutMs),
      );
      if (token.response.ok) {
        const pointer = token.payload;
        if (validJackpotPointer(pointer) && Number(pointer.day) >= targetDay) {
          const result = await fetchJackpotEdgeJSON(
            pointer.resultPath,
            signal,
            Math.min(Math.max(1, deadline - Date.now()), fetchTimeoutMs),
          );
          if (result.response.ok) {
            // The edge pointer can briefly belong to the prior deployment
            // when a testnet run reuses the same logical day number. Validate
            // the optional CDN candidate BEFORE publishing it. Calling the
            // ordinary deployment-mismatch publisher first cleared
            // app.lastDay and its UI high-water mark, which let the direct
            // fallback repin yesterday until the current result arrived.
            const candidate = normalizeLastDayPayload(result.payload);
            const candidateDay = Number(candidate?.day);
            if (candidateDay !== Number(pointer.day)
              || candidateDay < targetDay
              || !lastDayMatchesDeployment(candidate)) return null;
            return publishLastDayPayload(candidate);
          }
          // A failed immutable-result read is an edge outage, not an
          // unpublished token. Let the direct last-day fallback take over now.
          return null;
        }
      } else {
        // A cold edge miss can surface the origin's R2 failure as a 5xx. Do not
        // retry that same path for a minute while the board says processing.
        return null;
      }
    } catch (error) {
      if (signal?.aborted) return null;
      // Includes the per-attempt timeout. A hung edge read is precisely when
      // the ordinary last-day route should take over immediately.
      return null;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      await abortableDelay(Math.min(remaining, jittered(JACKPOT_EDGE_POLL_MS)), signal);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Fetch the sealed jackpot only after GAME.advanceDue() has fallen to false.
 * Tabs check a ~150-byte token on Cloudflare, then fetch one content-addressed
 * immutable result from the edge. A bounded direct read is retained as the
 * recovery path when the edge token's storage origin is unavailable.
 */
export function refreshJackpotAfterChainCompletion({ day, includePlayer = true } = {}) {
  const targetDay = Number(day);
  if (!Number.isInteger(targetDay) || targetDay <= 0) return Promise.resolve(null);
  if (_jackpotCompletionDay === targetDay && _jackpotCompletionPromise) {
    return _jackpotCompletionPromise;
  }

  _jackpotCompletionController?.abort();
  const controller = new AbortController();
  _jackpotCompletionController = controller;

  let request;
  request = (async () => {
    let payload = await waitForJackpotEdgeSnapshot(targetDay, controller.signal);
    if (!(Number(payload?.day) >= targetDay) && !controller.signal.aborted) {
      const direct = await pollLastDay(controller.signal, { force: true });
      payload = Number(direct?.day) >= targetDay ? direct : null;
    }

    if (Number(payload?.day) >= targetDay
      && includePlayer
      && typeof _forcePlayerCycle === 'function') {
      // Player data is personalized and cannot be shared through the CDN.
      // Spread those smaller refreshes instead of replacing one global herd
      // with a synchronized personalized one.
      const playerRefreshTimer = setTimeout(() => { void _forcePlayerCycle?.(); }, Math.floor(
        Math.random() * JACKPOT_PLAYER_REFRESH_SPREAD_MS,
      ));
      playerRefreshTimer?.unref?.();
    }
    return payload;
  })();

  _jackpotCompletionDay = targetDay;
  _jackpotCompletionPromise = request;
  _jackpotCompletionPending = true;
  const clearPending = () => {
    if (_jackpotCompletionPromise === request) {
      _jackpotCompletionPending = false;
      if (_jackpotCompletionController === controller) _jackpotCompletionController = null;
    }
  };
  void request.then(clearPending, clearPending);
  return request;
}

// ---------------------------------------------------------------------------
// Lifecycle: start / stop / abortAllInflight / pauseAllTimers
// ---------------------------------------------------------------------------

export function start({ playerAddress = null } = {}) {
  _activePlayerAddress = playerAddress;
  // Never carry another account's product markers across a target switch while
  // the new DB request is in flight. A same-account visibility resume retains
  // the last good payload until its refresh completes.
  const nextBoonAddress = get('ui.mode') === 'combined' || !playerAddress
    ? null
    : String(playerAddress).toLowerCase();
  const priorBoonAddress = get('app.boons')?.address ?? null;
  if (get('app.boons') == null || priorBoonAddress !== nextBoonAddress) {
    update('app.boons', { address: nextBoonAddress, day: null, boons: [] });
  }
  // Clear any previously registered handles before re-registering.
  pauseAllTimers();
  // A new sealed day zeroes the previous day's boons (playerBoonState is keyed
  // on player+day), so the day-change fan-out carries boons with it.
  const lastDay  = ({
    force = false,
    includeBoons = true,
    targetDay = null,
    waitMs = 0,
  } = {}) => {
    if (includeBoons) void refreshBoons();
    return runCycle('lastDay', [(s) => pollLastDay(s, {
      force,
      targetDay,
      waitMs,
    })]);
  };
  const game     = () => runCycle('game',     [
    (s) => pollGame(s).then((payload) => publishGameState(payload, lastDay)),
  ]);
  const player   = () => runPlayerCycle();
  const health   = () => runCycle('health',   [(s) => pollHealth(s)]);
  _forceGameCycle = game;
  _forceLastDayCycle = lastDay;
  _forcePlayerCycle = player;
  // A fresh start() (boot, account switch, return-from-hidden) republishes the
  // next game sample once even if it matches the pre-pause payload, so any
  // subscriber that mounted or reset while timers were down gets a publish.
  _lastPublishedGameStateJson = null;
  // Gold-rush cadence restarts at the floor: a tab that comes back after ten minutes
  // hidden should react to the next move promptly, not inherit a 60s backed-off gap.
  _goldRushLastBlock = null;
  _goldRushQuietPolls = 0;
  _goldRushDelay = GOLD_RUSH_CADENCE.active;
  // Pre-arm before the eager cycle so TIMER_HANDLES.goldRush is non-null the moment
  // start() returns (the eager poll is async and would otherwise leave it null, and
  // its own re-arm treats a null slot as "cancelled, do not resurrect").
  scheduleGoldRush();
  // Eager first cycle (each timer fires immediately, before the first tick).
  // refreshApprovers covers first connect, account switch and return-from-hidden,
  // which is every moment the approval set can differ from what we hold.
  game(); player(); health(); lastDay(); runGoldRushCycle(); void refreshApprovers();
  // Jittered periods, not the nominal ones. Players arrive together — a link
  // drop, a jackpot, a tab-visible burst — and identical intervals keep that
  // cohort phase-locked forever, so the origin sees a spike every 15s instead of
  // a flat line. A per-client ±20% period makes them drift apart within a few
  // ticks. The mean cadence is unchanged, so nothing gets staler on average.
  TIMER_HANDLES.game = setInterval(
    () => runBackgroundCycle(game),
    jittered(POLL_INTERVALS.gameState),
  );
  TIMER_HANDLES.player = setInterval(
    () => runBackgroundCycle(player),
    jittered(POLL_INTERVALS.playerData),
  );
  TIMER_HANDLES.health = setInterval(
    () => runBackgroundCycle(health),
    jittered(POLL_INTERVALS.health),
  );
  // lastDay is deliberately NOT on an interval — see POLL_INTERVALS.
}

export function stop() {
  pauseAllTimers();
  _forceGameCycle = null;
  _forceLastDayCycle = null;
  _forcePlayerCycle = null;
  _jackpotCompletionController?.abort();
  _jackpotCompletionController = null;
  _jackpotCompletionDay = null;
  _jackpotCompletionPromise = null;
  _jackpotCompletionPending = false;
}

export function abortAllInflight() {
  // Phase 58 (WLT) wires this to accountsChanged / disconnect events.
  for (const ctrl of ACTIVE_CYCLES.values()) ctrl.abort();
  ACTIVE_CYCLES.clear();
}

function pauseAllTimers() {
  for (const k of Object.keys(TIMER_HANDLES)) {
    if (TIMER_HANDLES[k]) clearInterval(TIMER_HANDLES[k]);
    TIMER_HANDLES[k] = null;
  }
  abortAllInflight();
  _jackpotCompletionController?.abort();
  _jackpotCompletionController = null;
  _jackpotCompletionDay = null;
  _jackpotCompletionPromise = null;
  _jackpotCompletionPending = false;
  // Visibility return is an explicit eager-refresh boundary. Do not let a
  // sub-second response from immediately before the tab hid suppress it.
  invalidateJSONCache();
}

// ---------------------------------------------------------------------------
// visibilitychange handler with 100ms debounce (Pitfall 3 + APP-04)
// ---------------------------------------------------------------------------

let visTimeout = null;
export function handleVisibilityChange() {
  if (visTimeout) clearTimeout(visTimeout);
  visTimeout = setTimeout(() => {
    visTimeout = null;
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      // CR-01 + WR-01: re-arm cadence AND fire eager cycle (start() does both).
      // Preserves the playerAddress captured at the most recent start() call so
      // the player feed survives tab-switch + return.
      start({ playerAddress: _activePlayerAddress });
    } else {
      pauseAllTimers();
    }
  }, VISIBILITY_DEBOUNCE_MS);
}

// Browser-only side-effect registration. typeof guard makes polling.js importable
// inside `node --test` without throwing (browser runtime is unaffected).
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

// ---------------------------------------------------------------------------
// Test-only introspection surface (NOT for downstream consumers).
// ---------------------------------------------------------------------------

export const _testing = {
  get TIMER_HANDLES() { return TIMER_HANDLES; },
  get ACTIVE_CYCLES() { return ACTIVE_CYCLES; },
  runCycle,
  runBackgroundCycle,
  runPlayerCycle,
  clearApiCooldown,
  invalidateJSONCache,
  jittered,
  get cooldownUntil() { return cooldownUntil(); },
  pauseAllTimers,
  fetchJSONWithSignal,
  pollApprovers,
  pollCurrentBoons,
  publishGameState,
  resolvedDayFromGameState,
  pollLastDay,
  publishLastDayPayload,
  validJackpotPointer,
  waitForJackpotEdgeSnapshot,
  get jackpotCompletionDay() { return _jackpotCompletionDay; },
  get jackpotCompletionPending() { return _jackpotCompletionPending; },
  lastDayMatchesDeployment,
  pollGoldRush,
  readGoldRushSnapshot,
  buildGoldRushChainPayload,
  setGoldRushSnapshotReader(fn) {
    _goldRushSnapshotReader = typeof fn === 'function' ? fn : null;
  },
  resetGoldRushSnapshotReader() {
    _goldRushSnapshotReader = null;
    _goldRushPublicProvider = null;
  },
  setBoonStateReader(fn) {
    _boonStateReader = typeof fn === 'function' ? fn : null;
  },
  resetBoonStateReader() {
    _boonStateReader = null;
    _boonReadProvider = null;
  },
  buildPlayerFetchers,
  runPlayerCycle,
  GOLD_RUSH_CADENCE,
  goldRushNextDelay,
  get goldRushDelay() { return _goldRushDelay; },
  resetGoldRushCadence() {
    _goldRushLastBlock = null;
    _goldRushQuietPolls = 0;
    _goldRushDelay = GOLD_RUSH_CADENCE.active;
  },
};
