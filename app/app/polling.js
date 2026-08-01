// /app/app/polling.js — Phase 56 Plan 56-03 (APP-04 + APP-06).
//
// 5-timer polling hierarchy; the first four at LOCKED cadence (D-04):
//   - gameTimer     15s
//   - playerTimer   30s
//   - healthTimer   60s
//   - lastDayTimer  60s   (NEW — consumed by Phase 59 JKP; route ships in Phase 57)
//   - goldRushTimer  5s   (gold-rush headline ticker — see POLL_INTERVALS.goldRush)
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
// Pitfall 5 reconciliation (D-04 satisfied): cross-imports ONLY the API_BASE constant
// from /beta/app/constants.js (READ-ONLY — zero /beta/ edits). /beta/'s fetchJSON does
// not accept {signal}, so polling.js wraps native fetch (~5 LOC) inline.
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

import { API_BASE } from '../../beta/app/constants.js';
import { update, get } from './store.js';
import { mergePlayerPayloads } from './combine.js';
import { ethers } from './contracts.js';
import { CHAIN, CONTRACTS } from './chain-config.js';

// ---------------------------------------------------------------------------
// LOCKED constants (D-04 + Pitfall 3)
// ---------------------------------------------------------------------------

export const POLL_INTERVALS = {
  gameState: 15_000,   // 15s
  playerData: 30_000,  // 30s
  health: 60_000,      // 60s
  lastDay: 60_000,     // 60s NEW
  // Gold-rush headline ticker — the FLOOR of an adaptive cadence, not a fixed
  // interval (see GOLD_RUSH_CADENCE). 5s is the fastest useful rate: the indexer
  // samples once per follow-mode batch (~5s at POLLING_INTERVAL_MS=5000), so polling
  // harder only re-reads the same row.
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
const TIMER_HANDLES = { game: null, player: null, health: null, lastDay: null, goldRush: null };
const ACTIVE_CYCLES = new Map(); // timerName → AbortController

// Module-level state captured by start() so the visibilitychange handler
// can re-arm cadence + re-poll without losing the playerAddress (WR-01 fix).
let _activePlayerAddress = null;

// Gold-rush adaptive-cadence state. Reset by start() so a tab-switch return begins
// at the floor rather than inheriting a backed-off delay from before it was hidden.
let _goldRushLastBlock = null;
let _goldRushQuietPolls = 0;
let _goldRushDelay = GOLD_RUSH_CADENCE.active;
let _goldRushYieldReader = null;
let _goldRushReadProvider = null;

const GOLD_RUSH_FALLBACK_ABI = [
  'function yieldAccumulatorView() external view returns (uint256)',
];

async function readGoldRushYieldAccumulator() {
  if (_goldRushYieldReader) return BigInt(await _goldRushYieldReader());
  if (!_goldRushReadProvider && CHAIN.rpcUrl) {
    _goldRushReadProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      Number(CHAIN.id),
      { staticNetwork: true, batchMaxCount: 1 },
    );
  }
  if (!_goldRushReadProvider || !CONTRACTS.GAME) throw new Error('Gold-rush chain reader unavailable');
  const game = new ethers.Contract(CONTRACTS.GAME, GOLD_RUSH_FALLBACK_ABI, _goldRushReadProvider);
  return BigInt(await game.yieldAccumulatorView());
}

function fallbackPoolWei(pools, key) {
  const raw = pools?.[key];
  if (raw == null || raw === '') throw new Error(`Missing ${key}`);
  const value = BigInt(raw);
  if (value < 0n) throw new Error(`Invalid ${key}`);
  return value;
}

/**
 * Rebuild the ticker payload from independently available sources when the
 * specialized DB route is unavailable. This is the same contract sum as the
 * indexer's ticker: current + next + future + yieldAccumulator. Claimable is
 * context only and is deliberately excluded.
 */
function buildGoldRushFallbackPayload(gameState, health, yieldAccumulatorWei, previous = null) {
  const pools = gameState?.prizePools;
  const current = fallbackPoolWei(pools, 'currentPrizePool');
  const next = fallbackPoolWei(pools, 'nextPrizePool');
  const future = fallbackPoolWei(pools, 'futurePrizePool');
  const claimable = BigInt(pools?.claimableWinnings ?? 0);
  const hasExactYield = yieldAccumulatorWei != null;
  const yieldAcc = hasExactYield ? BigInt(yieldAccumulatorWei) : 0n;
  const headline = current + next + future + yieldAcc;
  let previousHeadline = null;
  try {
    if (previous?.headlineWei != null) previousHeadline = BigInt(previous.headlineWei);
  } catch { /* malformed prior payload is ignored */ }
  const indexedBlock = Number(health?.indexedBlock);
  const atBlock = Number.isSafeInteger(indexedBlock) && indexedBlock >= 0 ? indexedBlock : null;
  const chainTip = health?.chainTip == null ? null : Number(health.chainTip);
  const lagBlocks = Number(health?.lagBlocks);
  const level = Number(gameState?.level);
  const phaseDay = Number(gameState?.jackpotCounter);

  return {
    headlineWei: headline.toString(),
    prevHeadlineWei: previousHeadline == null ? null : previousHeadline.toString(),
    deltaWei: previousHeadline == null ? '0' : (headline - previousHeadline).toString(),
    atBlock,
    fromBlock: previous?.atBlock ?? null,
    sampledAt: null,
    components: {
      currentWei: current.toString(),
      nextWei: next.toString(),
      futureWei: future.toString(),
      yieldAccumulatorWei: yieldAcc.toString(),
      claimableWei: claimable.toString(),
    },
    grandEthWei: (future / 4n).toString(),
    indexedBlock: atBlock ?? 0,
    chainTip: chainTip != null && Number.isSafeInteger(chainTip) && chainTip >= 0 ? chainTip : null,
    lagBlocks: Number.isSafeInteger(lagBlocks) && lagBlocks >= 0 ? lagBlocks : 0,
    level: Number.isSafeInteger(level) && level >= 0 ? level : null,
    phase: gameState?.phase == null ? null : String(gameState.phase),
    phaseDay: Number.isSafeInteger(phaseDay) && phaseDay >= 0 ? phaseDay : null,
    phaseDayCap: 5,
    frozen: Boolean(pools?.frozen ?? gameState?.prizePoolFrozen),
    ready: hasExactYield,
    armed: previous?.armed ?? null,
    fallback: true,
  };
}

// ---------------------------------------------------------------------------
// Pitfall 5 reconciliation: own fetch wrapper that supports {signal}.
// D-04 satisfied — cross-import API_BASE only, no /beta/ edit, no fetchJSON cross-import.
// ---------------------------------------------------------------------------

async function fetchJSONWithSignal(path, { signal } = {}) {
  const res = await fetch(API_BASE + path, { signal });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// 4 pollers — each accepts a signal arg threaded through fetchJSONWithSignal.
// Phase 59 (Plan 59-02) establishes "poller writes its own store path" pattern
// via pollLastDay → update('app.lastDay', payload). Phase 60+ extends to game/player/health.
// ---------------------------------------------------------------------------

async function pollGame(signal) {
  return fetchJSONWithSignal('/game/state', { signal });
}

async function pollPlayer(addr, signal) {
  if (!addr) return null;
  return fetchJSONWithSignal(`/player/${addr}`, { signal });
}

// Active deity boons are day-scoped in the DB. Resolve the live game day in
// the same abortable player cycle, then publish one normalized payload that
// every product-local indicator can share.
async function pollCurrentBoons(addr, signal) {
  const address = addr ? String(addr).toLowerCase() : null;
  if (!address) return { address: null, day: null, boons: [] };
  const state = await pollGame(signal);
  const day = Number(state?.currentDay);
  if (!Number.isInteger(day) || day < 1) return { address, day: null, boons: [] };
  const payload = await fetchJSONWithSignal(`/player/${address}/boons/${day}`, { signal });
  return {
    address,
    day: Number(payload?.day ?? day),
    boons: Array.isArray(payload?.boons) ? payload.boons : [],
  };
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

async function pollLastDay(signal) {
  // Phase 57 ships /game/jackpot/last-day. On 404 / network error, soft-fail returns null
  // (UI panel — Phase 59 widget — renders cold-start state by default).
  // Phase 59 Plan 59-02: write payload to store on success so the widget's
  // subscribe('app.lastDay', ...) subscriber fires per polling cycle.
  try {
    const payload = await fetchJSONWithSignal('/game/jackpot/last-day', { signal });
    update('app.lastDay', payload);  // Plan 59-02 — single new LOC vs Phase 56 baseline
    return payload;
  } catch (_e) {
    return null;  // catch branch unchanged: no store write on failure
  }
}

// Gold-rush headline. Writes app.goldRush; gold-rush-headline.js subscribes.
// Soft-fails like pollLastDay: on 404 (API not yet carrying the route) or network
// error the store keeps its last good payload and the widget keeps its last number
// rather than blanking to zero mid-animation.
async function pollGoldRush(signal) {
  try {
    const payload = await fetchJSONWithSignal('/game/jackpot/gold-rush', { signal });
    update('app.goldRush', payload);
    return payload;
  } catch (_e) {
    if (signal?.aborted) return null;
    // The local DB can be healthy while only this route fails response-schema
    // serialization. Do not strand the headline at an em dash: reconstruct the
    // exact sum from /game/state plus the one component that endpoint does not
    // expose, read directly from GAME. The chain read is allowed to degrade so
    // the known three-pool subtotal still paints with a "warming up" chip.
    const [stateResult, healthResult, yieldResult] = await Promise.allSettled([
      fetchJSONWithSignal('/game/state', { signal }),
      fetchJSONWithSignal('/health', { signal }),
      readGoldRushYieldAccumulator(),
    ]);
    if (stateResult.status !== 'fulfilled') return null;
    try {
      const payload = buildGoldRushFallbackPayload(
        stateResult.value,
        healthResult.status === 'fulfilled' ? healthResult.value : null,
        yieldResult.status === 'fulfilled' ? yieldResult.value : null,
        get('app.goldRush'),
      );
      update('app.goldRush', payload);
      return payload;
    } catch {
      return null;
    }
  }
}

/**
 * Pick the next gold-rush delay from what the poll just returned, and record the
 * block so the next call can tell "moved" from "same sample again".
 *
 * A null payload (fetch failed or was aborted) counts as unchanged, so a down API
 * gets backed off rather than hammered.
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

  // Combined mode has no single boon owner. Its product writes are disabled,
  // so publish an empty payload instead of showing one account's boon on the
  // aggregate view.
  const boonAddress = mode === 'combined' ? null : _activePlayerAddress;
  fetchers.push((s) => pollCurrentBoons(boonAddress, s));
  meta.push({ kind: 'boons', address: boonAddress });

  // Approvers — the ONLY source of operator approvals (combine.js header note).
  // Fetched whenever a wallet is connected, independent of viewing target/mode.
  if (connected) {
    fetchers.push((s) => pollApprovers(connected, s));
    meta.push({ kind: 'approvers' });
  }

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
  for (let i = 0; i < results.length; i += 1) {
    const m = meta[i];
    const r = results[i];
    if (m.kind === 'approvers' && r.status === 'fulfilled' && r.value) {
      const raw = Array.isArray(r.value.approvers) ? r.value.approvers : [];
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
    }
    if (m.kind === 'boons' && r.status === 'fulfilled' && r.value) {
      update('app.boons', r.value);
    }
  }

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
  TIMER_HANDLES.goldRush = setTimeout(runGoldRushCycle, _goldRushDelay);
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
  const game     = () => runCycle('game',     [(s) => pollGame(s)]);
  const player   = () => runPlayerCycle();
  const health   = () => runCycle('health',   [(s) => pollHealth(s)]);
  const lastDay  = () => runCycle('lastDay',  [(s) => pollLastDay(s)]);
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
  game(); player(); health(); lastDay(); runGoldRushCycle();
  TIMER_HANDLES.game     = setInterval(game,     POLL_INTERVALS.gameState);
  TIMER_HANDLES.player   = setInterval(player,   POLL_INTERVALS.playerData);
  TIMER_HANDLES.health   = setInterval(health,   POLL_INTERVALS.health);
  TIMER_HANDLES.lastDay  = setInterval(lastDay,  POLL_INTERVALS.lastDay);
}

export function stop() {
  pauseAllTimers();
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
  pauseAllTimers,
  fetchJSONWithSignal,
  pollApprovers,
  pollCurrentBoons,
  pollGoldRush,
  buildGoldRushFallbackPayload,
  setGoldRushYieldReader(fn) {
    _goldRushYieldReader = typeof fn === 'function' ? fn : null;
  },
  resetGoldRushYieldReader() {
    _goldRushYieldReader = null;
    _goldRushReadProvider = null;
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
