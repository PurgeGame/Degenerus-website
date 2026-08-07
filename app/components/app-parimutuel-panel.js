// /app/components/app-parimutuel-panel.js — the side-bet books and Decimator entry.
// only while there is something to do with them (user ask).
//
// Visibility rule — the panel hides itself unless at least one of:
//   - the GROWTH book is open (jackpot phase; round = level),
//   - the ticket-VOLUME book is open, or opens within VOLUME_WINDOW.leadSeconds,
//   - the viewed player has an unclaimed payout on a recent round.
// Nothing else on the page moves when it appears: it sits between the jackpot
// hero and the primary duo, so an open window reads as an interruption.
//
// Reads: DegenerusParimutuel.marketState / volumeMarketState, three rounds back
// per book (the open round plus two settled ones — the claim + result surface).
// Both views return `openRound` alongside the queried round, so "is it open" and
// "what is my position" cost ONE call each. The book is public, so a visitor with
// no wallet still sees it; only the buttons need a signer.
//
// Cadence: 30s at rest, 5s while the volume window is open or about to be —
// that window is 26s wide on the testnet overlay, so a 30s poll would miss it.
//
// Actions (Phase 58 sendTx chokepoint paths, via app/parimutuel.js):
//   OVER / UNDER — placeBet / placeVolumeBet; the fixed stake stays out of the
//   compact choices and the live book split appears once below them
//   CLAIM                — published into the shared bottom action tray, then
//                          claim / claimVolume over the selected round
//
// T-58-18: every server- and chain-derived string lands via textContent.

import { CHAIN, ETH_DIVISOR, VOLUME_WINDOW } from '../app/chain-config.js';
import { displayEth, displayToken } from '../app/scaling.js';
import { get, update, subscribe, getViewedAddress, getActingAddress } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { readGameState } from '../app/game-state.js';
import {
  readGrowthMarket, readVolumeMarket, readVolumeCredit, readMarketBetGates,
  placeGrowthBet, placeVolumeBet, claimGrowth, claimVolume,
  claimGrowthRound, claimVolumeRound, readRoundWinners,
  volumeWindow, volumeRoundNow,
  readLastVolumeSeal, readCurrentTicketVolume, readGrowthRatchets, readGrowthRatchetHistory,
  readPrizePoolTarget,
  readJackpotPhaseContext,
  growthBps, payoutPerWinner, UNITS_PER_TICKET,
  STAKE_WEI, SIDE_OVER, SIDE_UNDER,
} from '../app/parimutuel.js';
import {
  burnForDecimator,
  DECIMATOR_MIN_FLIP_WEI,
  decimatorWindowIsOpen,
  decimatorCurrentMultiplierBps,
  decimatorEntryScoreWei,
  decimatorPoolWei,
  readDecimatorContext,
} from '../app/decimator.js';
export { decimatorWindowIsOpen };
import { degenScoreLootTier } from '../app/activity-score.js';
import { activeBoonForProduct } from '../app/boons.js';
import { publishPendingActions, clearPendingActions } from '../app/pending-actions.js';
import { queueReveal } from './reveal-overlay.js';
import { compactUiError } from '../app/ui-error.js';
import './boon-product-indicator.js';

const POLL_IDLE_MS = 30_000;
const POLL_HOT_MS = 5_000;
const ERROR_AUTO_CLEAR_MS = 10_000;
const PENDING_SOURCE = 'parimutuel';

function _seenKey(address) {
  return `pari-results-seen:${CHAIN.id}:${String(address || '').toLowerCase()}`;
}

function _seenResults(address) {
  try {
    const parsed = JSON.parse(localStorage.getItem(_seenKey(address)) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch (_e) {
    return new Set();
  }
}

function _markResultSeen(address, id) {
  if (!address) return;
  try {
    const seen = _seenResults(address);
    seen.add(String(id));
    localStorage.setItem(_seenKey(address), JSON.stringify(Array.from(seen).slice(-100)));
  } catch (_e) { /* private mode: the result can reappear next session */ }
}
// How many rounds back each book is inspected: the open round plus two settled
// ones. Winners are normally paid by the permissionless crank, so this is a
// backstop surface, not the main claim path — it does not need to be deep.
const LOOKBACK = 3;

function _setTimeoutUnref(fn, ms) {
  const h = setTimeout(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

function _fmtFlip(wei) {
  const whole = displayToken(BigInt(wei || 0n), 0);
  const n = Number(whole);
  return Number.isSafeInteger(n) ? n.toLocaleString('en-US') : whole;
}

function _fmtPoolEth(wei) {
  try {
    const compact = displayEth(BigInt(wei || 0), 3)
      .replace(/\.000$/, '')
      .replace(/(\.\d*?)0+$/, '$1');
    const [whole, fraction] = compact.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction == null ? grouped : `${grouped}.${fraction}`;
  } catch (_e) {
    return '0';
  }
}

// A held Growth receipt is deliberately conservative: OVER rounds its line up,
// UNDER rounds it down. The live market and settlement retain the exact wei.
function _fmtHeldGrowthEth(wei, side) {
  try {
    const scaled = BigInt(wei || 0n) * ETH_DIVISOR;
    const unit = 10n ** 18n;
    let whole = scaled / unit;
    if (side === SIDE_OVER && scaled % unit !== 0n) whole += 1n;
    return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  } catch (_e) {
    return '0';
  }
}

function _parseFlipInput(raw) {
  const match = String(raw ?? '').trim().replace(/,/g, '').match(/^(\d+)(?:\.(\d{1,18}))?$/);
  if (!match) return null;
  const fraction = String(match[2] || '').padEnd(18, '0');
  return BigInt(match[1]) * 10n ** 18n + BigInt(fraction || '0');
}

function _formatFlipInput(wei) {
  const unit = 10n ** 18n;
  const value = BigInt(wei ?? 0n);
  const whole = value / unit;
  const remainder = value % unit;
  if (remainder === 0n) return String(whole);
  const fraction = String(remainder).padStart(18, '0').replace(/0+$/, '');
  return `${whole}.${fraction}`;
}

function _decimatorBoonBps(payload) {
  const boonType = Number(activeBoonForProduct(payload, 'decimator')?.row?.boonType || 0);
  if (boonType === 13) return 1_000;
  if (boonType === 14) return 2_500;
  if (boonType === 15) return 5_000;
  return 0;
}

/** Percentages read better without a trailing .0 — 62.5% but 50%, not 50.0%. */
function _fmtPct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Raw purchase units → whole tickets (400 units = 1 ticket), thousands-grouped. */
function _fmtTickets(units) {
  let u = 0n;
  try { u = BigInt(units ?? 0); } catch (_e) { return '0'; }
  const whole = u / UNITS_PER_TICKET;
  const rem = u % UNITS_PER_TICKET;
  const head = Number(whole).toLocaleString('en-US');
  // A part-ticket is a real thing here (tickets are bought in quarters), so it
  // is shown rather than rounded away.
  if (rem === 0n) return head;
  const frac = Number((rem * 100n) / UNITS_PER_TICKET) / 100;
  return `${head}${String(frac).slice(1)}`;
}

function _fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function _clampPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

export function thermometerScale(current, target) {
  let now = 0n;
  let line = 0n;
  try {
    now = BigInt(current ?? 0);
    line = BigInt(target ?? 0);
  } catch (_e) {
    return null;
  }
  if (line <= 0n) return null;
  // Leave room above the line so crossing it is visible rather than merely
  // filling a bar to its right edge.
  const scale = now > line
    ? (now * 110n) / 100n || 1n
    : (line * 125n) / 100n || 1n;
  const fillPercent = _clampPercent(Number((now * 10_000n) / scale) / 100);
  const linePercent = _clampPercent(Number((line * 10_000n) / scale) / 100);
  // The fill element ends at "now", so a normal 0→100% background gradient
  // would always end green even far below the target. Stretch the gradient by
  // target/current so its green endpoint stays pinned to the target marker.
  const gradientSpanPercent = now <= line && fillPercent > 0
    ? Math.max(100, (linePercent / fillPercent) * 100)
    : 100;
  return {
    fillPercent,
    linePercent,
    gradientSpanPercent,
    ariaPercent: _clampPercent(Number((now * 10_000n) / line) / 100),
    crossed: now > line,
  };
}

// One book's fetched state. `rounds` is newest-first.
function _emptyBook() {
  return { openRound: 0, rounds: [], credit: 0n, questReward: 0n, error: false };
}

class AppParimutuelPanel extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #growth = _emptyBook();
  #volume = _emptyBook();
  #bonusEligibility = { growth: false, volume: false };
  #level = null;
  #player = null;
  #fetchSeq = 0;
  // Benchmarks the open rounds are measured against: the last sealed volume
  // round (its own total + the total it beat) and the level ratchet terms.
  #lastSeal = null;
  #currentVolume = null;
  #ratchets = null;
  #gameState = null;
  #decimatorPosition = null;
  #decimatorContext = null;
  #decimatorDraft = '1000';
  #questActivateListener = null;
  #decimatorBurnListener = null;
  #pollHandle = null;
  #tickHandle = null;
  #postActionRefreshHandle = null;
  #busyResetHandle = null;
  #busy = false;
  #errorTimer = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.#questActivateListener = (event) => {
        const detail = event?.detail;
        this.#applyQuestPreset(detail);
        if (Number(detail?.questType) === 5 && detail?.submit) void this.#enterDecimator();
      };
      document.addEventListener('quest:activate', this.#questActivateListener);
      this.#decimatorBurnListener = () => this.#refresh();
      document.addEventListener('app-decimator:burn-confirmed', this.#decimatorBurnListener);
    }
    this.#unsubs.push(subscribe('connected.address', () => this.#refresh()));
    this.#unsubs.push(subscribe('viewing.address', () => this.#refresh()));
    this.#armTick();
    this.#refresh();
  }

  disconnectedCallback() {
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (this.#questActivateListener && typeof document !== 'undefined') {
      try { document.removeEventListener('quest:activate', this.#questActivateListener); }
      catch (_e) { /* defensive */ }
      this.#questActivateListener = null;
    }
    if (this.#decimatorBurnListener && typeof document !== 'undefined') {
      try { document.removeEventListener('app-decimator:burn-confirmed', this.#decimatorBurnListener); }
      catch (_e) { /* defensive */ }
      this.#decimatorBurnListener = null;
    }
    for (const h of [
      this.#pollHandle,
      this.#tickHandle,
      this.#postActionRefreshHandle,
      this.#busyResetHandle,
      this.#errorTimer,
    ]) {
      if (h != null) {
        try { clearTimeout(h); } catch (_e) { /* defensive */ }
      }
    }
    this.#pollHandle = null;
    this.#tickHandle = null;
    this.#postActionRefreshHandle = null;
    this.#busyResetHandle = null;
    this.#errorTimer = null;
    clearPendingActions(PENDING_SOURCE);
  }

  // -----------------------------------------------------------------------
  // Fetch
  // -----------------------------------------------------------------------

  async #refresh() {
    const seq = ++this.#fetchSeq;
    const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || get('viewing.address')
      || get('connected.address')
      || null;
    const player = addr ? String(addr).toLowerCase() : null;
    if (player !== this.#player) this.#decimatorContext = null;
    this.#player = player;

    // The growth book numbers its rounds by LEVEL, and the level only comes off
    // the game state. The volume book numbers by day and is computable from the
    // clock, so it never waits on the API.
    let level = this.#level;
    try {
      const state = await readGameState();
      if (state && Number.isFinite(Number(state.level))) level = Number(state.level);
      if (state && typeof state === 'object') this.#gameState = state;
    } catch (_e) { /* keep the last known level — the books still render */ }
    if (seq !== this.#fetchSeq) return;
    this.#level = level;

    // The full-width pool strip is page-level state, not side-bet history.
    // Start its three cheap direct reads as soon as /game/state gives us the
    // level; do not put them behind market lookbacks, player gates, or logs.
    void this.#loadPoolBenchmarks(seq, level);

    const growthRounds = this.#lookback(level);
    const volumeRounds = this.#lookback(volumeRoundNow());

    // The credit quote is only asked for while the book is open or about to
    // open. The profile mirrors the deployed contract's rescaled ladder; the
    // soft-fail still keeps a transient RPC problem from blocking both books.
    const win = volumeWindow();
    const wantCredit = win.open || win.secondsToOpen <= (VOLUME_WINDOW.leadSeconds || 0);
    const decimatorLevel = Number.isInteger(level) && level >= 0 ? level + 1 : null;
    // Gated on the same condition as the context read below. It was not, and the
    // asymmetry cost: the Decimator runs once every ten levels, but this fired
    // every cycle at whatever level happened to be current — asking for a round
    // that cannot exist and can only come back empty. It was the second-heaviest
    // endpoint on a live page load, 21 of 138 requests.
    const decimatorRead = player && decimatorLevel != null
      && decimatorWindowIsOpen(this.#gameState)
      ? fetchJSON(`/player/${player}/decimator?level=${decimatorLevel}`).catch(() => null)
      : Promise.resolve(null);
    const decimatorContextRead = decimatorLevel != null
      && decimatorWindowIsOpen(this.#gameState)
      ? readDecimatorContext(player, decimatorLevel).catch(() => null)
      : Promise.resolve(null);
    const [growth, volume, credit, decimatorPosition, decimatorContext] = await Promise.all([
      Promise.allSettled(growthRounds.map((round) => readGrowthMarket({ player, round }))),
      Promise.allSettled(volumeRounds.map((round) => readVolumeMarket({ player, round }))),
      wantCredit ? readVolumeCredit().then((c) => c, () => 0n) : Promise.resolve(0n),
      decimatorRead,
      decimatorContextRead,
    ]);
    if (seq !== this.#fetchSeq) return;

    this.#growth = this.#foldBook(growth);
    this.#volume = this.#foldBook(volume);
    this.#volume.credit = credit;
    // Retain the last known position when the read was skipped. #visible() and
    // the open-state checks pass #decimatorPosition back into
    // decimatorWindowIsOpen(), where `roundStatus === 'open'` is what keeps a
    // burned-but-unresolved entry on screen after the x4 window closes. Nulling
    // it on every gated cycle would blank the player's own pending entry at
    // exactly the moment they are waiting on it.
    if (decimatorPosition) this.#decimatorPosition = decimatorPosition;
    if (decimatorContext) this.#decimatorContext = decimatorContext;

    // The round anchors are off-chain guesses — the level comes from the
    // indexer (which can lag a transition) and the volume round from the local
    // clock. `openRound` is the chain's own answer, so when it falls outside
    // the window just read, go get it rather than render a headless book.
    await Promise.all([
      this.#backfillOpen(this.#growth, (round) => readGrowthMarket({ player, round })),
      this.#backfillOpen(this.#volume, (round) => readVolumeMarket({ player, round })),
    ]);
    if (seq !== this.#fetchSeq) return;

    // marketState/volumeBetCredit are global quotes. Only QUESTS knows whether
    // this particular player earns them. Growth checks its actual open round;
    // volume passes Game.level(), exactly like placeVolumeBet on-chain.
    const growthLevel = Number(this.#growth.openRound || 0);
    const volumeLevel = Number(level || 0);
    const [growthGate, volumeGate] = await Promise.all([
      player && growthLevel > 0
        ? readMarketBetGates({ player, level: growthLevel }).catch(() => null)
        : Promise.resolve(null),
      player && volumeLevel > 0
        ? readMarketBetGates({ player, level: volumeLevel }).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (seq !== this.#fetchSeq) return;
    this.#bonusEligibility = {
      growth: growthGate?.earnsReward === true,
      volume: volumeGate?.earnsReward === true,
    };

    // Volume history does need the authoritative open round, so its heavier log
    // scan remains here. It cannot delay the already-running page pool reads.
    void this.#loadVolumeBenchmark(seq, this.#volume.openRound);

    this.#render();
    this.#armPoll();
  }

  // Direct pool/phase reads are not settlement inputs and do not depend on any
  // player or market history. Keeping them isolated is what lets the strip
  // paint promptly on cold load and at a phase transition.
  async #loadPoolBenchmarks(seq, level) {
    const [ratchets, poolTarget, phaseContext, history] = await Promise.all([
      readGrowthRatchets({ round: level }).catch(() => null),
      readPrizePoolTarget().catch(() => null),
      readJackpotPhaseContext().catch(() => null),
      readGrowthRatchetHistory({ throughLevel: level }).catch(() => null),
    ]);
    if (seq !== this.#fetchSeq) return;
    const benchmarkLevel = Number(level);
    const contractLevel = Number(ratchets?.currentLevel);
    const benchmarkIsCurrent = Number.isInteger(contractLevel)
      && contractLevel === benchmarkLevel;
    if (ratchets
      && benchmarkIsCurrent
      && Number.isInteger(benchmarkLevel)
      && benchmarkLevel >= 0) {
      const prior = get('app.poolBenchmarks');
      const sameLevel = Number(prior?.level) === benchmarkLevel;
      const targetWei = poolTarget != null && BigInt(poolTarget) > 0n
        ? BigInt(poolTarget).toString()
        : sameLevel ? prior?.targetWei ?? null : null;
      const growth = ratchets
        ? {
          prev: BigInt(ratchets.prev).toString(),
          current: BigInt(ratchets.current).toString(),
          next: BigInt(ratchets.next ?? 0).toString(),
        }
        : sameLevel ? prior?.ratchets ?? null : null;
      const historicalPools = Array.isArray(history)
        ? history.map((row) => ({
          level: Number(row.level),
          poolWei: BigInt(row.poolWei).toString(),
        }))
        : sameLevel ? prior?.history ?? [] : [];
      // The full-width pool thermometer consumes the same contract reads as
      // this book. Publish before the historical volume scan so that an RPC's
      // log latency cannot hold up the page-wide progression display.
      update('app.poolBenchmarks', {
        level: benchmarkLevel,
        targetWei,
        ratchets: growth,
        history: historicalPools,
        contractPhase: phaseContext
          ? {
            level: phaseContext.level != null && Number.isInteger(Number(phaseContext.level))
              ? Number(phaseContext.level)
              : null,
            jackpot: phaseContext.jackpot === true,
            lastPurchaseDay: phaseContext.lastPurchaseDay === true,
            rngLocked: phaseContext.rngLocked === true,
            day: Number(ratchets.phaseDay) || 0,
            compressedFlag: Number(phaseContext.compressedFlag) || 0,
          }
          : null,
      });
    }
    if (ratchets) this.#ratchets = ratchets;
    this.#render();
  }

  // Volume deliberately waits for its adjacent sealed ticket count so the
  // player is never offered an unlabeled OVER / UNDER wager. This backwards
  // log walk can take seconds on public RPCs and must stay off the pool path.
  async #loadVolumeBenchmark(seq, volumeOpenRound) {
    const open = Number(volumeOpenRound || volumeRoundNow());
    const previousVolumeRound = Number.isInteger(open) && open > 1 ? open - 1 : null;
    const seal = await readLastVolumeSeal(
      previousVolumeRound == null ? undefined : { round: previousVolumeRound },
    ).catch(() => null);
    if (seq !== this.#fetchSeq) return;
    const currentVolume = seal?.blockNumber > 0
      ? await readCurrentTicketVolume({ afterBlock: seal.blockNumber }).catch(() => null)
      : null;
    if (seq !== this.#fetchSeq) return;
    if (!seal && currentVolume == null) return;
    // A transient historical-log failure must not erase the last good volume
    // line; doing that made the ticket threshold and result color blink out.
    if (seal) this.#lastSeal = seal;
    if (currentVolume != null) this.#currentVolume = currentVolume;
    this.#render();
  }

  async #backfillOpen(book, read) {
    if (!book.openRound) return;
    // The open row renders the choices; the immediately preceding row supplies
    // the color of the offered benchmark. When the local clock/indexer anchor
    // drifts outside the lookback, fetching only openRound restored the buttons
    // but left their actual line uncolored.
    const wanted = [book.openRound, book.openRound - 1]
      .filter((round) => round > 0 && !book.rounds.some((r) => r.round === round));
    const rows = await Promise.allSettled(wanted.map((round) => read(round)));
    for (const result of rows) {
      if (result.status === 'fulfilled') book.rounds.push(result.value);
    }
    book.rounds.sort((a, b) => Number(b.round) - Number(a.round));
  }

  // Rounds to read for one book. With no usable anchor (no level yet, or a
  // chain profile with no deploy boundary) it still reads round 0: that round
  // can never carry a position, but the view returns `openRound` regardless, so
  // #backfillOpen can then pull the live book off the contract's own answer.
  #lookback(anchor) {
    const top = Number(anchor);
    if (!Number.isInteger(top) || top <= 0) return [0];
    const out = [];
    for (let i = 0; i < LOOKBACK && top - i > 0; i += 1) out.push(top - i);
    return out;
  }

  // allSettled results → one book. openRound and questReward are round-independent
  // returns, so any fulfilled read carries them.
  #foldBook(settled) {
    const book = _emptyBook();
    const fulfilled = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    book.error = fulfilled.length === 0 && settled.length > 0;
    if (fulfilled.length === 0) return book;
    book.openRound = fulfilled[0].openRound;
    book.questReward = fulfilled[0].questReward;
    book.rounds = fulfilled;
    return book;
  }

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  #openState(book) {
    if (!book.openRound) return null;
    return book.rounds.find((r) => r.round === book.openRound) || null;
  }

  // Settled rounds the viewed player still has money on. A voided volume round
  // pays the stake back and reports outcome 0, so `payout` is the test, not the
  // outcome bit.
  #claimable(book) {
    return book.rounds.filter((r) => r.side !== 0 && !r.claimed && r.payout > 0n);
  }

  // Rounds that resolved against the player — shown so a loss is not silence.
  #lost(book, kind = '') {
    const seen = this.#player ? _seenResults(this.#player) : new Set();
    return book.rounds.filter(
      (r) => r.side !== 0
        && r.outcome !== 0
        && r.side !== r.outcome
        && !r.voided
        && !seen.has(`${kind}:${r.round}`),
    );
  }

  #claimableTotal(book) {
    return this.#claimable(book).reduce((sum, r) => sum + r.payout, 0n);
  }

  // A player's book has closed, but the permissionless settlement crank has
  // not landed yet. Only at this point are the counts final, so this is the
  // only state where "TO WIN" is an honest fixed number.
  #pendingSettlement(book) {
    return book.rounds.filter(
      (r) => r.side !== 0
        && r.round !== book.openRound
        && !r.claimed
        && r.outcome === 0
        && !r.voided
        && r.payout === 0n,
    );
  }

  #visible() {
    return Boolean(this.#openState(this.#growth))
      || (Boolean(this.#openState(this.#volume)) && Boolean(this.#volumeMark(this.#volume.openRound)))
      || decimatorWindowIsOpen(this.#gameState, this.#decimatorPosition)
      || this.#lost(this.#growth, 'growth').length > 0
      || this.#lost(this.#volume, 'volume').length > 0
      || this.#pendingSettlement(this.#growth).length > 0
      || this.#pendingSettlement(this.#volume).length > 0;
  }

  // -----------------------------------------------------------------------
  // Cadence — hot while the volume window is open or imminent.
  // -----------------------------------------------------------------------

  #armPoll() {
    if (this.#pollHandle != null) {
      try { clearTimeout(this.#pollHandle); } catch (_e) { /* defensive */ }
    }
    if (typeof setTimeout !== 'function') return;
    const win = volumeWindow();
    const hot = win.open
      || win.secondsToOpen <= (VOLUME_WINDOW.leadSeconds || 0)
      || decimatorWindowIsOpen(this.#gameState, this.#decimatorPosition);
    this.#pollHandle = _setTimeoutUnref(() => this.#refresh(), hot ? POLL_HOT_MS : POLL_IDLE_MS);
  }

  // 1s repaint so the countdown moves without re-reading the chain.
  #armTick() {
    if (typeof setTimeout !== 'function') return;
    this.#tickHandle = _setTimeoutUnref(() => {
      this.#renderCountdown();
      this.#armTick();
    }, 1_000);
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <section class="panel app-parimutuel">
        <div class="panel-header">
          <h2><a class="pari-learn-link" href="/learn/side-bets/">SIDE BETS</a></h2>
        </div>
        <div class="pari-books">
          <!-- Decimator comes first deliberately: its x4/x99 burn window is
               level-gated and must not sit below the always-recurring books. -->
          <article class="pari-book pari-decimator" data-bind="pari-decimator" hidden></article>
          <article class="pari-book" data-bind="pari-growth" hidden></article>
          <article class="pari-book" data-bind="pari-volume" hidden></article>
        </div>
        <p class="pari-empty" data-bind="pari-empty">Checking…</p>
        <div class="pari-error" data-bind="pari-error" hidden role="alert"></div>
      </section>
    `;
  }

  #render() {
    const visible = this.#visible();
    const empty = this.querySelector('[data-bind="pari-empty"]');
    if (empty) {
      empty.hidden = visible;
      if (!visible) {
        const win = volumeWindow();
        const waitingForVolumeLine = Boolean(this.#volume.openRound)
          && !this.#volumeMark(this.#volume.openRound);
        empty.textContent = waitingForVolumeLine
          ? 'Loading yesterday’s ticket total…'
          : win.secondsToOpen > 0
            ? `Books are closed · volume opens in ${_fmtClock(win.secondsToOpen)}`
            : 'Books are closed';
      }
    }
    this.#renderBook('growth');
    this.#renderBook('volume');
    this.#renderDecimator();
    this.#publishPending();
  }

  #renderDecimator() {
    const host = this.querySelector('[data-bind="pari-decimator"]');
    if (!host) return;
    const open = decimatorWindowIsOpen(this.#gameState, this.#decimatorPosition);
    host.hidden = !open;
    host.textContent = '';
    if (!open) return;

    const level = Number.isInteger(this.#level) ? this.#level + 1 : null;
    const head = document.createElement('div');
    head.className = 'pari-book__head';
    const headCopy = document.createElement('div');
    headCopy.className = 'pari-decimator__head-copy';
    const title = document.createElement('h3');
    title.className = 'pari-book__title';
    title.textContent = 'DECIMATOR';
    const boon = document.createElement('boon-product-indicator');
    boon.setAttribute('product', 'decimator');
    title.appendChild(boon);
    const winPrompt = document.createElement('span');
    winPrompt.className = 'pari-decimator__win-prompt';
    const burnPrompt = document.createElement('span');
    burnPrompt.className = 'pari-decimator__win-prompt-burn';
    burnPrompt.textContent = 'BURN FLIP';
    const winPromptEnd = document.createElement('span');
    winPromptEnd.className = 'pari-decimator__win-prompt-win';
    winPromptEnd.textContent = ' TO WIN:';
    winPrompt.appendChild(burnPrompt);
    winPrompt.appendChild(winPromptEnd);
    headCopy.appendChild(title);
    headCopy.appendChild(winPrompt);
    head.appendChild(headCopy);
    const futurePool = this.#decimatorContext?.futurePoolWei
      ?? this.#gameState?.prizePools?.futurePrizePool;
    const prize = decimatorPoolWei(futurePool, level);
    const prizeBox = document.createElement('div');
    prizeBox.className = 'pari-decimator__prize';
    const prizeAmount = document.createElement('strong');
    prizeAmount.textContent = _fmtPoolEth(prize);
    const prizeUnit = document.createElement('span');
    prizeUnit.textContent = 'ETH';
    prizeBox.appendChild(prizeAmount);
    prizeBox.appendChild(prizeUnit);
    head.appendChild(prizeBox);
    host.appendChild(head);

    const ask = document.createElement('p');
    ask.className = 'pari-book__ask pari-decimator__multiplier-line';
    const activityScore = Number(this.#decimatorContext?.activityScore);
    const activityKnown = Number.isFinite(activityScore);
    const activityPoints = activityKnown ? Math.max(0, Math.trunc(activityScore)) : null;
    const activityValue = document.createElement('strong');
    activityValue.className = 'pari-decimator__degen-score';
    activityValue.textContent = activityPoints == null
      ? '—'
      : `${activityPoints.toLocaleString('en-US')}%`;
    const scoreTier = degenScoreLootTier(activityPoints);
    if (scoreTier) activityValue.setAttribute('data-score-tier', scoreTier);
    const activityLabel = document.createElement('span');
    activityLabel.textContent = 'DEGEN';
    const equals = document.createElement('span');
    equals.className = 'pari-decimator__multiplier-equals';
    equals.textContent = '=';
    const multiplier = document.createElement('strong');
    multiplier.className = 'pari-decimator__multiplier-value';
    if (scoreTier) multiplier.setAttribute('data-score-tier', scoreTier);
    const multiplierLabel = document.createElement('span');
    multiplierLabel.className = 'pari-decimator__multiplier-label';
    multiplierLabel.textContent = 'MULTI';
    if (activityPoints == null) {
      multiplier.textContent = '—';
    } else {
      const bps = decimatorCurrentMultiplierBps({
        activityScore: activityPoints,
        dayOneActive: this.#decimatorContext?.dayOneActive === true,
        lastPurchaseDay: this.#decimatorContext?.lastPurchaseDay === true,
      });
      multiplier.textContent = `${(bps + 50n) / 100n}%`;
    }
    ask.appendChild(activityValue);
    ask.appendChild(activityLabel);
    ask.appendChild(equals);
    ask.appendChild(multiplier);
    ask.appendChild(multiplierLabel);
    host.appendChild(ask);

    const scoreBoard = document.createElement('div');
    scoreBoard.className = 'pari-decimator__scoreboard';
    const scoreItems = [
      ['YOUR SCORE', this.#decimatorContext?.totalBurnWeight],
      ['ALL PLAYERS SCORE', this.#decimatorContext?.totalRoundScore],
    ];
    for (const [label, value] of scoreItems) {
      const item = document.createElement('span');
      const itemLabel = document.createElement('small');
      itemLabel.textContent = label;
      const itemValue = document.createElement('strong');
      try { itemValue.textContent = value == null ? '—' : _fmtFlip(BigInt(value)); }
      catch (_e) { itemValue.textContent = '—'; }
      item.appendChild(itemLabel);
      item.appendChild(itemValue);
      scoreBoard.appendChild(item);
    }
    host.appendChild(scoreBoard);

    const entry = document.createElement('div');
    entry.className = 'pari-decimator__entry';
    const inputWrap = document.createElement('label');
    inputWrap.className = 'pari-decimator__input-wrap';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1000';
    input.step = '1000';
    input.inputMode = 'decimal';
    input.value = this.#decimatorDraft;
    input.setAttribute('data-bind', 'pari-decimator-input');
    input.setAttribute('aria-label', 'Decimator entry size in FLIP');
    input.addEventListener('input', () => {
      this.#decimatorDraft = String(input.value || '');
      this.#paintDecimatorQuote(input.value, quote);
    });
    const unit = document.createElement('span');
    unit.className = 'pari-decimator__input-unit';
    unit.textContent = 'FLIP';
    const stepper = document.createElement('span');
    stepper.className = 'pari-decimator__stepper';
    stepper.setAttribute('role', 'group');
    stepper.setAttribute('aria-label', 'Adjust Decimator entry by 1,000 FLIP');
    const makeStepButton = (direction) => {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = `pari-decimator__step pari-decimator__step--${direction > 0 ? 'up' : 'down'}`;
      control.setAttribute(
        'data-bind',
        direction > 0 ? 'pari-decimator-up' : 'pari-decimator-down',
      );
      control.setAttribute(
        'aria-label',
        `${direction > 0 ? 'Increase' : 'Decrease'} Decimator entry by 1,000 FLIP`,
      );
      const arrow = document.createElement('span');
      arrow.className = 'pari-decimator__step-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      control.appendChild(arrow);
      control.addEventListener('click', () => {
        const step = 1_000n * (10n ** 18n);
        const parsed = _parseFlipInput(input.value);
        const current = parsed == null ? 0n : parsed;
        const stepped = direction > 0 ? current + step : current - step;
        const next = stepped < DECIMATOR_MIN_FLIP_WEI
          ? DECIMATOR_MIN_FLIP_WEI
          : stepped;
        const value = _formatFlipInput(next);
        input.value = value;
        this.#decimatorDraft = value;
        this.#paintDecimatorQuote(value, quote);
      });
      return control;
    };
    stepper.appendChild(makeStepButton(1));
    stepper.appendChild(makeStepButton(-1));
    const quote = document.createElement('small');
    quote.className = 'pari-decimator__cta-quote';
    quote.setAttribute('data-bind', 'pari-decimator-quote');
    inputWrap.appendChild(input);
    inputWrap.appendChild(unit);
    inputWrap.appendChild(stepper);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pari-decimator__cta';
    button.setAttribute('data-write', '');
    button.setAttribute('data-bind', 'pari-decimator-cta');
    const buttonAction = document.createElement('span');
    buttonAction.className = 'pari-decimator__cta-action';
    buttonAction.textContent = 'BURN FOR';
    button.appendChild(buttonAction);
    button.appendChild(quote);
    this.#paintDecimatorQuote(input.value, quote);
    button.addEventListener('click', () => this.#enterDecimator());
    entry.appendChild(inputWrap);
    entry.appendChild(button);
    host.appendChild(entry);

  }

  #paintDecimatorQuote(raw, target = null) {
    const quote = target || this.querySelector('[data-bind="pari-decimator-quote"]');
    if (!quote) return;
    const amount = _parseFlipInput(raw);
    const activityScore = Number(this.#decimatorContext?.activityScore);
    if (amount == null || amount <= 0n || !Number.isFinite(activityScore)) {
      quote.textContent = '— SCORE';
      return;
    }
    let previousScore = 0n;
    try { previousScore = BigInt(this.#decimatorContext?.totalBurnWeight ?? 0); }
    catch (_e) { previousScore = 0n; }
    const score = decimatorEntryScoreWei({
      amountWei: amount,
      previousScoreWei: previousScore,
      activityScore: Math.max(0, Math.trunc(activityScore)),
      dayOneActive: this.#decimatorContext?.dayOneActive === true,
      lastPurchaseDay: this.#decimatorContext?.lastPurchaseDay === true,
      boonBps: _decimatorBoonBps(get('app.boons')),
    });
    quote.textContent = `+${_fmtFlip(score)} SCORE`;
  }

  #applyQuestPreset(detail) {
    if (Number(detail?.questType) !== 5) return;
    let target;
    try { target = BigInt(detail?.target ?? 0); } catch (_e) { target = 0n; }
    if (target <= 0n) target = 2_000n * (10n ** 18n);
    const fixed = String(displayToken(target, 0));
    const value = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
    this.#decimatorDraft = value;
    const input = this.querySelector('[data-bind="pari-decimator-input"]');
    if (input) input.value = value;
    try { this.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_e) {}
    try { input?.focus?.({ preventScroll: true }); } catch (_e) {}
  }

  #publishPending() {
    const acting = getActingAddress();
    const player = acting ? String(acting).toLowerCase() : null;
    if (!player || player !== this.#player) {
      clearPendingActions(PENDING_SOURCE);
      return;
    }
    const seen = _seenResults(player);
    const rows = [];
    for (const [kind, book] of [['growth', this.#growth], ['volume', this.#volume]]) {
      for (const result of book.rounds) {
        if (result.side === 0 || result.claimed) continue;
        const id = `${kind}:${result.round}`;
        const settledLoss = result.outcome !== 0
          && result.side !== result.outcome
          && !result.voided;
        const claimable = result.payout > 0n;
        if (settledLoss && seen.has(id)) continue;
        const ready = claimable || settledLoss;
        const side = result.side === SIDE_OVER ? 'OVER' : 'UNDER';
        const place = kind === 'growth' ? ` · Level ${result.round}` : '';
        const pariClaim = claimable;
        rows.push({
          id: `pari:${id}`,
          dismissScope: this.#player,
          // Every ready pari payout belongs in the bottom action tray with
          // packs and lootboxes. The SIDE BETS cards remain the live books,
          // not a second home for claim buttons.
          kind: pariClaim ? `${kind}-claim` : 'pari',
          label: kind === 'growth' ? `GROWTH BET${place}` : 'VOLUME BET',
          shortLabel: pariClaim ? 'Claim' : kind === 'growth' ? 'GROWTH BET' : 'VOLUME BET',
          detail: this.#busy
            ? 'Processing result'
            : ready
              ? claimable
                ? `${side} paid · ${_fmtFlip(result.payout)} FLIP ready`
                : `${side} result ready`
              : `${side} · waiting for settlement`,
          state: this.#busy ? 'busy' : ready ? 'ready' : 'waiting',
          autoOpen: settledLoss,
          order: 30,
          chronology: Number(result.round),
          run: claimable
            ? () => this.#claim(kind, [result.round])
            : settledLoss ? () => this.#revealPari(kind, result) : null,
        });
      }
    }
    publishPendingActions(PENDING_SOURCE, rows);
  }

  async #revealPari(kind, result) {
    let volumeSeal = null;
    if (kind === 'volume') {
      volumeSeal = Number(this.#lastSeal?.round) === Number(result.round)
        ? this.#lastSeal
        : await readLastVolumeSeal({ round: result.round }).catch(() => null);
    }
    const id = `${kind}:${result.round}`;
    _markResultSeen(this.#player, id);
    queueReveal({
      kind: 'pari',
      player: this.#player,
      presentationId: `pari-reveal:${this.#player}:${kind}:${result.round}`,
      market: kind,
      round: result.round,
      side: result.side,
      outcome: result.outcome,
      payout: result.payout,
      voided: result.voided,
      // VolumeRoundSealed is the authoritative public result. Carry its raw
      // 400-units-per-ticket values into player-facing strings here so the
      // overlay can show the exact line the player picked and what landed.
      betTickets: volumeSeal ? _fmtTickets(volumeSeal.previous) : null,
      resultTickets: volumeSeal ? _fmtTickets(volumeSeal.total) : null,
    });
    this.#render();
    this.#publishPending();
  }

  // Only the two countdown chips repaint on the 1s tick.
  #renderCountdown() {
    const host = this.querySelector('[data-bind="pari-volume"]');
    if (!host || host.hidden) return;
    const chip = host.querySelector('[data-bind="pari-clock"]');
    if (chip) {
      const win = volumeWindow();
      chip.textContent = win.open
        ? `closes in ${_fmtClock(win.secondsToClose)}`
        : `opens in ${_fmtClock(win.secondsToOpen)}`;
    }
  }

  #renderBook(kind) {
    const host = this.querySelector(`[data-bind="pari-${kind}"]`);
    if (!host) return;
    const book = kind === 'growth' ? this.#growth : this.#volume;
    const claimable = this.#claimable(book);
    const lost = this.#lost(book, kind);
    const pending = this.#pendingSettlement(book);
    // openRound is only a pointer returned by each lookback read. Do not paint
    // a header-only card unless the authoritative row for that exact round was
    // actually recovered (the targeted backfill can soft-fail on a stale RPC).
    const open = this.#openState(book);
    const win = volumeWindow();
    const volumeSoon = !win.open && win.secondsToOpen <= (VOLUME_WINDOW.leadSeconds || 0);
    const hasContent = Boolean(open)
      || lost.length > 0
      || pending.length > 0;
    const volumeLineReady = kind !== 'volume'
      || !book.openRound
      || Boolean(this.#volumeMark(book.openRound));
    const show = hasContent && volumeLineReady;
    host.hidden = !show;
    host.textContent = '';
    if (!show) return;

    const latestPosition = [...lost, ...pending]
      .sort((a, b) => Number(b.round) - Number(a.round))[0];
    const round = book.openRound || open?.round || latestPosition?.round || 0;
    const settledOnly = !book.openRound
      && (lost.length > 0 || pending.length > 0);
    const heldOpenVolume = kind === 'volume' && Number(open?.side || 0) !== 0;
    if (host.classList) {
      if (settledOnly) host.classList.add('pari-book--settled');
      else host.classList.remove('pari-book--settled');
    }

    const head = document.createElement('div');
    head.className = 'pari-book__head';
    const title = document.createElement('h3');
    title.className = 'pari-book__title';
    title.textContent = kind === 'growth'
      ? `GROWTH BET${round ? ` · Level ${round}` : ''}`
      : 'VOLUME BET';
    head.appendChild(title);
    if (!settledOnly) {
      const chip = document.createElement('span');
      chip.className = 'pari-clock';
      chip.setAttribute('data-bind', 'pari-clock');
      if (kind === 'growth') {
        chip.textContent = book.openRound ? 'Betting open' : 'Closed';
      } else {
        chip.textContent = win.open
          ? `closes in ${_fmtClock(win.secondsToClose)}`
          : `opens in ${_fmtClock(win.secondsToOpen)}`;
      }
      head.appendChild(chip);
    }
    host.appendChild(head);

    if (round && !settledOnly && !heldOpenVolume) {
      // Keep the prior benchmark on its own compact history row. The ticket
      // book adds a centered TODAY line immediately below it while the player
      // is still choosing a side. Once committed, the receipt stands alone.
      const context = document.createElement('div');
      context.className = 'pari-book__context';
      const mark = kind === 'growth' ? this.#growthMark(round) : this.#volumeMark(round);
      if (mark) {
        const bench = document.createElement('p');
        bench.className = 'pari-book__bench';
        const paidSide = this.#benchmarkOutcome(book, round);
        const lead = document.createElement('span');
        lead.textContent = mark.lead;
        bench.appendChild(lead);
        const offered = document.createElement('span');
        offered.className = 'pari-book__offered';
        if (paidSide === SIDE_OVER) offered.className += ' pari-book__offered--won';
        if (paidSide === SIDE_UNDER) offered.className += ' pari-book__offered--lost';
        offered.textContent = mark.offered;
        offered.title = paidSide === SIDE_OVER
          ? 'This result beat the prior offered number'
          : paidSide === SIDE_UNDER
            ? 'This result did not beat the prior offered number'
            : 'Past result';
        bench.appendChild(offered);
        if (kind === 'growth' && mark.target) {
          const target = document.createElement('span');
          target.className = 'pari-book__target';
          target.textContent = ` · Target: ${mark.target}`;
          bench.appendChild(target);
        }
        context.appendChild(bench);
      }
      host.appendChild(context);
      // Keep both pari books to the compact benchmark + live bet split. The
      // ticket-volume thermometer duplicated Yesterday's line and made the
      // small card materially taller without clarifying the player's bet.
    }

    if (book.openRound && open) this.#renderSides(host, kind, open);
    // Once a growth position closes, its counts and payout are final. Replace
    // the live two-sided book with one receipt line and progress toward the
    // purchased-ticket growth target. Older uncranked positions (rare, but
    // possible within the lookback) remain in the fallback result list below.
    const featuredGrowthPosition = kind === 'growth' && !book.openRound
      ? pending[0] || null
      : null;
    if (featuredGrowthPosition) {
      this.#renderHeldGrowth(host, featuredGrowthPosition, { closed: true });
      this.#renderThermometer(host, 'growth');
    }
    if (!book.openRound && kind === 'volume' && volumeSoon) {
      const wait = document.createElement('p');
      wait.className = 'pari-book__wait';
      wait.textContent = `Next round opens in ${_fmtClock(win.secondsToOpen)}.`;
      host.appendChild(wait);
    }

    this.#renderPositions(host, kind, book, lost, featuredGrowthPosition ? pending.slice(1) : pending);
  }

  // "Yesterday: N tickets bought" — strictly the immediately preceding round's
  // result. A stale seal must never make Round 429 look like it is betting
  // against Round 427; Round 427 only matters through Round 428's recorded
  // OVER/UNDER outcome.
  #volumeMark(round) {
    const seal = this.#lastSeal;
    if (!seal) return null;
    const open = Number(round || this.#volume.openRound || volumeRoundNow());
    if (!Number.isInteger(open)) return null;
    // The latest seal includes both its own total and the total it compared
    // against. That second value preserves the exact pick while the just-closed
    // round is showing its TO WIN receipt.
    const total = seal.round === open - 1
      ? seal.total
      : seal.round === open ? seal.previous : null;
    if (total == null) return null;
    const tickets = _fmtTickets(total);
    return {
      lead: 'Yesterday: ',
      offered: `${tickets} tickets bought`,
      target: `${tickets} tickets`,
    };
  }

  // The book compares RATIOS of consecutive prize pools. Keep the prior
  // percentage as context, but make the actionable line the exact ETH pool
  // threshold: OVER is strict, so one raw wei is added after integer division.
  #growthMark(round) {
    const r = this.#ratchets;
    if (!r) return null;
    const bps = growthBps(r.prev, r.current);
    if (bps == null) return null;
    let target;
    try {
      const prev = BigInt(r.prev ?? 0);
      const current = BigInt(r.current ?? 0);
      if (prev <= 0n || current <= 0n) return null;
      target = (current * current) / prev + 1n;
    } catch (_e) {
      return null;
    }
    const pct = _fmtPct(Math.abs(bps) / 100);
    return {
      lead: 'Last level: ',
      offered: `${bps < 0 ? '-' : ''}${pct}%`,
      target: `${_fmtPoolEth(target)} ETH`,
      targetWei: target,
    };
  }

  // The offered number shown in the live book is the immediately previous
  // market's result: green when OVER paid, red when UNDER paid. The result
  // before that is never displayed; it only helped settle this outcome.
  #benchmarkOutcome(book, round) {
    const settledRound = round - 1;
    const settled = book.rounds.find((r) => r.round === settledRound);
    return settled && (settled.outcome === SIDE_OVER || settled.outcome === SIDE_UNDER)
      ? settled.outcome
      : 0;
  }

  #thermometerModel(kind) {
    if (kind === 'volume') {
      const current = this.#currentVolume;
      const seal = this.#lastSeal;
      const open = Number(this.#volume.openRound || volumeRoundNow());
      // A progress bar against an older line is just as misleading as printing
      // that line. Wait for the adjacent seal instead of bridging a gap.
      if (!seal || !Number.isInteger(open) || seal.round !== open - 1) return null;
      const target = seal.total;
      if (current == null || target == null) return null;
      const scale = thermometerScale(current, target);
      if (!scale) return null;
      return {
        ...scale,
        currentText: `${_fmtTickets(current)} now`,
        lineText: `${_fmtTickets(target)} line`,
      };
    }

    const r = this.#ratchets;
    const rawLive = this.#gameState?.prizePools?.nextPrizePool;
    if (!r || rawLive == null) return null;
    let prev;
    let current;
    let live;
    try {
      prev = BigInt(r.prev ?? 0);
      current = BigInt(r.current ?? 0);
      live = BigInt(rawLive ?? 0);
    } catch (_e) {
      return null;
    }
    if (prev <= 0n || current <= 0n) return null;
    // OVER is strict: next * prev > current².
    const target = (current * current) / prev + 1n;
    const scale = thermometerScale(live, target);
    if (!scale) return null;
    const liveBps = growthBps(current, live);
    const signed = liveBps == null
      ? 'filling'
      : `${liveBps > 0 ? '+' : ''}${_fmtPct(liveBps / 100)}% now`;
    return {
      ...scale,
      currentText: signed,
      lineText: 'target',
    };
  }

  #renderThermometer(host, kind) {
    const model = this.#thermometerModel(kind);
    if (!model) return;

    const meter = document.createElement('div');
    meter.className = `pari-thermometer${model.crossed ? ' pari-thermometer--over' : ''}`;

    const labels = document.createElement('div');
    labels.className = 'pari-thermometer__labels';
    const now = document.createElement('span');
    now.className = 'pari-thermometer__now';
    now.textContent = model.currentText;
    const line = document.createElement('span');
    line.className = 'pari-thermometer__line-label';
    line.textContent = model.lineText;
    labels.appendChild(now);
    labels.appendChild(line);

    const track = document.createElement('div');
    track.className = 'pari-thermometer__track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(model.ariaPercent)));
    track.setAttribute('aria-label', `${model.currentText}; ${model.lineText}`);
    const fill = document.createElement('span');
    fill.className = 'pari-thermometer__fill';
    fill.style.width = `${model.fillPercent}%`;
    fill.style.backgroundSize = `${model.gradientSpanPercent}% 100%`;
    const marker = document.createElement('span');
    marker.className = 'pari-thermometer__marker';
    marker.style.left = `${model.linePercent}%`;
    track.appendChild(fill);
    track.appendChild(marker);

    meter.appendChild(labels);
    meter.appendChild(track);
    host.appendChild(meter);
  }

  #renderSides(host, kind, state) {
    const mine = state.side;
    const offered = kind === 'growth'
      ? this.#growthMark(state.round || this.#level)
      : this.#volumeMark(state.round || this.#volume.openRound);
    const today = document.createElement('div');
    today.className = `pari-today pari-today--${kind}`;
    if (kind === 'volume' && mine === 0) {
      const todayLabel = document.createElement('span');
      todayLabel.className = 'pari-today__label';
      todayLabel.textContent = 'TODAY';
      today.appendChild(todayLabel);
    }

    const wrap = document.createElement('div');
    wrap.className = 'pari-sides';

    // Share of the book per side. Counts are intentionally omitted: the split
    // is the useful information while the book is still moving.
    const total = state.overCount + state.underCount;
    const pctOf = (count) => (total === 0n ? null : Number((count * 1000n) / total) / 10);
    const overPct = pctOf(state.overCount);

    // A placed growth bet is read-only. One clear line communicates the side
    // and offered growth threshold; keeping an empty opposite-side cell made
    // the card look actionable after the player had already committed.
    if (kind === 'growth' && mine !== 0) {
      this.#renderHeldGrowth(today, state);
      this.#appendSplit(today, overPct);
      host.appendChild(today);
      return;
    }
    if (kind === 'volume' && mine !== 0) {
      this.#renderHeldVolume(today, state, offered);
      this.#appendSplit(today, overPct);
      host.appendChild(today);
      return;
    }

    for (const side of [SIDE_UNDER, SIDE_OVER]) {
      const isOver = side === SIDE_OVER;
      const sideText = isOver ? 'OVER' : 'UNDER';
      const cell = document.createElement('div');
      cell.className = `pari-side pari-side--${isOver ? 'over' : 'under'}`
        + (mine === side ? ' pari-side--mine' : '');

      if (mine === 0) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pari-side__cta';
        btn.setAttribute('data-write', '');
        const action = document.createElement('span');
        action.className = 'pari-side__action';
        if (offered) {
          const verb = document.createElement('span');
          verb.className = 'pari-side__verb';
          // Keep a separating space in the accessibility/fake-DOM aggregate;
          // CSS places this on its own visual row.
          verb.textContent = `${sideText} `;
          const target = document.createElement('span');
          target.className = 'pari-side__target';
          target.textContent = offered.target;
          action.appendChild(verb);
          action.appendChild(target);
        } else {
          action.textContent = offered ? `${sideText} ${offered.offered}` : sideText;
        }
        btn.appendChild(action);
        btn.setAttribute(
          'aria-label',
          `Bet ${isOver ? 'over' : 'under'}${offered
            ? ` ${offered.target}`
            : ''}`,
        );
        btn.addEventListener('click', () => this.#bet(kind, isOver));
        cell.appendChild(btn);
      } else {
        const label = document.createElement('span');
        label.className = 'pari-side__label';
        label.textContent = sideText;
        cell.appendChild(label);
        // Once a volume position is held, keep the exact line visible. The old
        // layout reduced this to OVER / UNDER + YOUR BET, which left the player
        // with no labelled number for the wager they had actually placed.
        if (kind === 'volume' && offered) {
          const target = document.createElement('span');
          target.className = 'pari-side__target';
          target.textContent = offered.offered;
          cell.appendChild(target);
        }
        if (mine === side) {
          const held = document.createElement('span');
          held.className = 'pari-side__held';
          held.textContent = 'YOUR BET';
          cell.appendChild(held);
        }
      }
      wrap.appendChild(cell);
    }
    today.appendChild(wrap);

    // Keep the choices terse. The percentages appear once under their matching
    // ends of the live split instead of being repeated inside each button.
    this.#appendSplit(today, overPct);
    this.#appendPrebetBonus(today, kind);
    host.appendChild(today);
  }

  // Both contracts expose the exact reward for placing right now: growth's
  // participation reward comes back with marketState, while Daily Volume's
  // placement credit decays through its open window. Keep this beside the live
  // choices only; after the player commits, the held-position receipt takes
  // over and the quote is no longer relevant.
  #appendPrebetBonus(host, kind) {
    if (this.#bonusEligibility[kind] !== true) return;
    const amount = kind === 'growth' ? this.#growth.questReward : this.#volume.credit;
    if (BigInt(amount || 0n) <= 0n) return;

    const bonus = document.createElement('div');
    bonus.className = 'pari-prebet-bonus';
    const label = document.createElement('span');
    label.className = 'pari-prebet-bonus__label';
    label.textContent = `BET: ${_fmtFlip(STAKE_WEI)} FLIP\u00a0\u00a0\u00a0BONUS: `;
    const value = document.createElement('strong');
    value.className = 'pari-prebet-bonus__value';
    value.textContent = `+${_fmtFlip(amount)} FLIP`;
    bonus.appendChild(label);
    bonus.appendChild(value);
    host.appendChild(bonus);
  }

  #renderHeldVolume(host, state, offered, { closed = false } = {}) {
    const sideText = state.side === SIDE_OVER ? 'OVER' : 'UNDER';
    const line = document.createElement('div');
    line.className = `pari-your-bet pari-your-bet--volume pari-your-bet--${
      state.side === SIDE_OVER ? 'over' : 'under'
    }${closed ? ' pari-your-bet--closed' : ''}`;
    const label = document.createElement('span');
    label.className = 'pari-your-bet__label';
    label.textContent = 'YOUR BET:';
    const pick = document.createElement('strong');
    pick.className = 'pari-your-bet__pick';
    const compactTarget = offered?.target || '';
    pick.textContent = `${sideText}${compactTarget ? ` ${compactTarget}` : ''}`;
    line.appendChild(label);
    line.appendChild(pick);
    if (closed) {
      const payout = document.createElement('strong');
      payout.className = 'pari-your-bet__payout';
      payout.textContent = `TO WIN: ${_fmtFlip(
        payoutPerWinner(state.overCount, state.underCount, state.side),
      )} FLIP`;
      line.appendChild(payout);
    }
    host.appendChild(line);
  }

  #renderHeldGrowth(host, state, { closed = false } = {}) {
    const sideText = state.side === SIDE_OVER ? 'OVER' : 'UNDER';
    const offered = this.#growthMark(state.round || this.#level);
    const line = document.createElement('div');
    line.className = `pari-your-bet pari-your-bet--${state.side === SIDE_OVER ? 'over' : 'under'}`
      + (closed ? ' pari-your-bet--closed' : '');
    const label = document.createElement('span');
    label.className = 'pari-your-bet__label';
    label.textContent = 'YOUR BET:';
    const pick = document.createElement('strong');
    pick.className = 'pari-your-bet__pick';
    const heldTarget = offered?.targetWei == null
      ? offered?.target
      : `${_fmtHeldGrowthEth(offered.targetWei, state.side)} ETH`;
    pick.textContent = `${sideText}${heldTarget ? ` ${heldTarget}` : ''}`;
    line.appendChild(label);
    line.appendChild(pick);
    if (closed) {
      const payout = document.createElement('strong');
      payout.className = 'pari-your-bet__payout';
      payout.textContent = `TO WIN: ${_fmtFlip(
        payoutPerWinner(state.overCount, state.underCount, state.side),
      )} FLIP`;
      line.appendChild(payout);
    }
    host.appendChild(line);
  }

  #appendSplit(host, overPct) {
    const bar = document.createElement('div');
    bar.className = 'pari-split';
    const overSeg = document.createElement('span');
    overSeg.className = 'pari-split__over';
    overSeg.style.width = `${overPct == null ? 50 : overPct}%`;
    const underSeg = document.createElement('span');
    underSeg.className = 'pari-split__under';
    underSeg.style.width = `${overPct == null ? 50 : 100 - overPct}%`;
    if (overPct == null && bar.classList) bar.classList.add('pari-split--empty');
    bar.appendChild(overSeg);
    bar.appendChild(underSeg);
    host.appendChild(bar);
    const splitLabels = document.createElement('div');
    splitLabels.className = 'pari-split__labels';
    const overLabel = document.createElement('span');
    overLabel.className = 'pari-split__label pari-split__label--over';
    overLabel.textContent = `${_fmtPct(overPct == null ? 0 : overPct)}%`;
    const underLabel = document.createElement('span');
    underLabel.className = 'pari-split__label pari-split__label--under';
    underLabel.textContent = `${_fmtPct(overPct == null ? 0 : 100 - overPct)}%`;
    splitLabels.appendChild(overLabel);
    splitLabels.appendChild(underLabel);
    host.appendChild(splitLabels);
  }

  #renderPositions(
    host,
    kind,
    book,
    lost = this.#lost(book, kind),
    pending = this.#pendingSettlement(book),
  ) {
    if (lost.length === 0 && pending.length === 0) return;

    const list = document.createElement('div');
    list.className = 'pari-results';

    for (const r of pending) {
      if (kind === 'volume') {
        this.#renderHeldVolume(list, r, this.#volumeMark(r.round), { closed: true });
        continue;
      }
      const row = document.createElement('div');
      row.className = 'pari-result pari-result--pending';
      const label = document.createElement('span');
      label.className = 'pari-result__label';
      label.textContent = `${kind === 'growth' ? 'Level' : 'Round'} ${r.round} · To win`;
      row.appendChild(label);
      const amount = document.createElement('span');
      amount.className = 'pari-result__amount';
      amount.textContent = `${_fmtFlip(payoutPerWinner(r.overCount, r.underCount, r.side))} FLIP`;
      row.appendChild(amount);
      list.appendChild(row);
    }

    // Settled wins and their claim buttons live in the shared bottom action
    // tray. Keep SIDE BETS focused on live and still-settling positions.
    host.appendChild(list);
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  async #bet(kind, over) {
    await this.#run(async (player) => {
      if (kind === 'growth') await placeGrowthBet({ player, over });
      else await placeVolumeBet({ player, over });
    });
  }

  async #enterDecimator() {
    const input = this.querySelector('[data-bind="pari-decimator-input"]');
    const button = this.querySelector('[data-bind="pari-decimator-cta"]');
    const action = button?.querySelector('.pari-decimator__cta-action');
    const amount = _parseFlipInput(input?.value);
    if (amount == null) {
      this.#renderError('Enter a numeric FLIP amount.');
      return;
    }
    if (amount < DECIMATOR_MIN_FLIP_WEI) {
      this.#renderError('Minimum Decimator entry is 1,000 FLIP.');
      return;
    }
    this.#decimatorDraft = String(input?.value || '1000');
    if (button) {
      button.disabled = true;
      if (action) action.textContent = 'BURNING…';
    }
    await this.#run((player) => burnForDecimator({ player, amount }));
    if (button) {
      button.disabled = false;
      if (action) action.textContent = 'BURN FOR';
      this.#paintDecimatorQuote(input?.value);
    }
  }

  async #claim(kind, rounds) {
    const book = kind === 'growth' ? this.#growth : this.#volume;
    const wanted = new Set((rounds || []).map(Number));
    const player = getActingAddress();
    if (!player) {
      this.#renderError('Connect a wallet first.');
      return;
    }

    // Re-read every clicked round before choosing a write. The poll snapshot can
    // be stale because pari settlement is permissionless and the keeper batch
    // may have paid this player since the widget last rendered.
    const read = kind === 'growth' ? readGrowthMarket : readVolumeMarket;
    let results;
    try {
      results = await Promise.all(Array.from(wanted, (round) => read({ player, round })));
      for (const row of results) this.#mergeFreshRound(kind, row);
    } catch (_e) {
      // If the read RPC blinks, the claim's static-call remains the race gate.
      results = book.rounds.filter((row) => wanted.has(row.round));
    }

    const unpaid = results.filter((row) => row.side !== 0 && !row.claimed && row.payout > 0n);
    const alreadySettled = results.filter((row) => row.side !== 0 && row.claimed);
    for (const row of alreadySettled) await this.#revealPari(kind, this.#pariReplayResult(row));
    if (unpaid.length === 0) {
      this.#render();
      return;
    }

    const ok = await this.#run(async (actingPlayer) => {
      // The winner-crank settles everybody we can discover on the SAME round
      // and pays the caller a keeper bounty. Multi-round and void-refund claims
      // use the ordinary per-player batch because their community entrypoints
      // either require one round or deliberately reject voids.
      if (unpaid.length === 1 && !unpaid[0].voided) {
        const target = unpaid[0];
        const winnerCount = target.outcome === SIDE_OVER
          ? target.overCount : target.underCount;
        const players = await readRoundWinners({
          kind,
          round: target.round,
          outcome: target.outcome,
          expectedCount: Number(winnerCount),
        }).catch(() => []);
        if (kind === 'growth') {
          await claimGrowthRound({ player: actingPlayer, round: target.round, players });
        } else {
          await claimVolumeRound({ player: actingPlayer, round: target.round, players });
        }
      } else if (kind === 'growth') {
        await claimGrowth({ player: actingPlayer, rounds: unpaid.map((row) => row.round) });
      } else {
        await claimVolume({ player: actingPlayer, rounds: unpaid.map((row) => row.round) });
      }
    });
    if (ok) {
      for (const result of unpaid) {
        result.claimed = true;
        await this.#revealPari(kind, this.#pariReplayResult(result));
      }
    } else {
      // A community crank can win between the fresh read and our simulation.
      // Re-read once; if the claimed bit landed, replace the error with the
      // canonical result animation.
      try {
        const raced = await Promise.all(unpaid.map((row) => read({ player, round: row.round })));
        const claimed = raced.filter((row) => row.claimed);
        if (claimed.length > 0) {
          this.#clearError();
          for (const row of raced) this.#mergeFreshRound(kind, row);
          for (const row of claimed) await this.#revealPari(kind, this.#pariReplayResult(row));
        }
      } catch (_e) { /* keep the original actionable error */ }
    }
  }

  #mergeFreshRound(kind, row) {
    const book = kind === 'growth' ? this.#growth : this.#volume;
    const index = book.rounds.findIndex((existing) => existing.round === row.round);
    if (index >= 0) book.rounds[index] = row;
    else book.rounds.unshift(row);
  }

  #pariReplayResult(result) {
    const row = { ...result };
    if (row.payout === 0n && row.side !== 0) {
      if (row.voided) row.payout = STAKE_WEI;
      else if (row.outcome !== 0 && row.side === row.outcome) {
        row.payout = payoutPerWinner(row.overCount, row.underCount, row.outcome);
      }
    }
    return row;
  }

  async #run(fn) {
    if (this.#busy) return false;
    this.#busy = true;
    this.#clearError();
    this.#publishPending();
    try {
      const player = getActingAddress();
      if (!player) throw new Error('Connect a wallet first.');
      await fn(player);
      if (this.#postActionRefreshHandle != null) clearTimeout(this.#postActionRefreshHandle);
      this.#postActionRefreshHandle = _setTimeoutUnref(() => {
        this.#postActionRefreshHandle = null;
        this.#refresh();
      }, 250);
      return true;
    } catch (error) {
      this.#renderError(compactUiError(error));
      return false;
    } finally {
      if (this.#busyResetHandle != null) clearTimeout(this.#busyResetHandle);
      this.#busyResetHandle = _setTimeoutUnref(() => {
        this.#busyResetHandle = null;
        this.#busy = false;
        this.#publishPending();
      }, 500);
    }
  }

  #renderError(msg) {
    const errEl = this.querySelector('[data-bind="pari-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_e) { /* defensive */ }
    }
    this.#errorTimer = _setTimeoutUnref(() => this.#clearError(), ERROR_AUTO_CLEAR_MS);
  }

  #clearError() {
    const errEl = this.querySelector('[data-bind="pari-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_e) { /* defensive */ }
      this.#errorTimer = null;
    }
  }
}

// Idempotency-guarded register (Phase 58 pattern).
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-parimutuel-panel')) {
    customElements.define('app-parimutuel-panel', AppParimutuelPanel);
  }
}

export { AppParimutuelPanel };
