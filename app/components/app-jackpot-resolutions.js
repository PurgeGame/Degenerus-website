// Headless watcher for the two level-transition drawings.
//
// The page does not carry a permanent Decimator/BAF dashboard. Once a round
// closes, this controller publishes the Decimator into the main jackpot action
// and mirrors it in the shared Pending tray so the full draw cannot be missed.
// The Decimator opens its reconstructed wheel; genuine permissionless claims
// remain available until mined.

import { fetchJSON } from '../app/api.js';
import { readGameState } from '../app/game-state.js';
import { CHAIN } from '../app/chain-config.js';
import { displayEth, displayToken } from '../app/scaling.js';
import {
  subscribe,
  getViewedAddress,
  getActingAddress,
} from '../app/store.js';
import { claimDecimatorLevels } from '../app/claims.js';
import {
  bafResolutionLevel,
  claimBafConsolation,
  decimatorResolutionLevel,
  decimatorFinalIsNews,
  isDecimatorResolutionLevel,
  readBafConsolation,
  readDecimatorClaimState,
  summarizeBafAwards,
} from '../app/jackpot-resolutions.js';
import { clearPendingActions, publishPendingActions } from '../app/pending-actions.js';
import { openDecimatorDraw } from './app-decimator-draw-overlay.js';
import { openBafResolution } from './app-baf-resolution-overlay.js';

const PENDING_SOURCE = 'jackpot-resolutions';
const POLL_MS = 15_000;

function _setTimeoutUnref(fn, ms) {
  const handle = setTimeout(fn, ms);
  if (handle && typeof handle.unref === 'function') {
    try { handle.unref(); } catch (_e) { /* browser timer */ }
  }
  return handle;
}

function _big(value) {
  try { return BigInt(value ?? 0); } catch (_e) { return 0n; }
}

function _trimFixed(value) {
  const text = String(value ?? '0');
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function _formatEth(value) {
  try { return _trimFixed(displayEth(_big(value), 4)); } catch (_e) { return '0'; }
}

function _formatToken(value, digits = 0) {
  try { return _trimFixed(displayToken(_big(value), digits)); } catch (_e) { return '0'; }
}

export function hasDecimatorPosition(outcome) {
  const bucket = Number(outcome?.bucket);
  return Number.isInteger(bucket) && bucket > 0;
}

export function decimatorResolutionView({ outcome, claimState, currentLevel, level } = {}) {
  const lvl = Number(level);
  const current = Number(currentLevel);
  const future = Number.isInteger(lvl) && Number.isInteger(current) && lvl > current;
  if (!outcome) {
    return future
      ? { status: 'UPCOMING', tone: 'waiting', message: `Resolves when Level ${lvl} starts.`, actionable: false }
      : { status: 'SYNCING', tone: 'waiting', message: 'Loading the latest Decimator result.', actionable: false };
  }

  const status = String(outcome.roundStatus || '');
  const bucket = Number(outcome.bucket);
  const sub = Number(outcome.subbucket);
  const winning = Number(outcome.winningSubbucket);
  const entered = hasDecimatorPosition(outcome);
  const payout = _big(outcome.payoutAmount);

  if (status === 'open') {
    return {
      status: entered ? 'ENTRY LOCKED' : 'IN PROGRESS',
      tone: 'waiting',
      message: entered
        ? `Your Bucket ${bucket} / Sub ${sub} entry is waiting for the level transition.`
        : `Level ${lvl} has not resolved yet.`,
      actionable: false,
    };
  }

  if (status === 'closed' && payout > 0n) {
    if (claimState === 'ready') {
      return {
        status: 'READY TO RESOLVE', tone: 'ready',
        message: `${_formatEth(payout)} ETH estimated pool share.`,
        actionable: true,
      };
    }
    if (claimState === 'claimed') {
      return {
        status: 'RESOLVED', tone: 'won',
        message: 'Settled as claimable ETH plus the final Luckbox / Whale Half-Pass reward.',
        actionable: false,
      };
    }
    return {
      status: 'WINNING SUBBUCKET', tone: 'won',
      message: `${_formatEth(payout)} ETH estimated pool share.`,
      actionable: false,
    };
  }

  if (status === 'closed' && entered) {
    return {
      status: 'NOT SELECTED', tone: 'lost',
      message: Number.isInteger(winning)
        ? `Winning subbucket ${winning}; your entry was subbucket ${sub}.`
        : 'Your bucket result did not produce a claimable payout.',
      actionable: false,
    };
  }

  if (future) {
    return { status: 'UPCOMING', tone: 'waiting', message: `Resolves when Level ${lvl} starts.`, actionable: false };
  }
  return {
    status: 'NO ENTRY', tone: 'muted',
    message: `No Decimator position was recorded for Level ${lvl}.`,
    actionable: false,
  };
}

export function bafResolutionView({ outcome, consolation, awards, currentLevel, level } = {}) {
  const lvl = Number(level);
  const current = Number(currentLevel);
  const future = Number.isInteger(lvl) && Number.isInteger(current) && lvl > current;
  if (!outcome) {
    return future
      ? { status: 'ACCUMULATING', tone: 'waiting', message: `The first BAF resolves at Level ${lvl}.`, actionable: false }
      : { status: 'SYNCING', tone: 'waiting', message: 'Loading the latest BAF result.', actionable: false };
  }

  const status = String(outcome.roundStatus || '');
  const score = _big(outcome.score);
  const eth = _big(awards?.eth);
  const tickets = _big(awards?.tickets);
  const claimable = consolation == null ? null : _big(consolation);

  if (status === 'open') {
    return {
      status: future ? 'ACCUMULATING' : 'AWAITING FLIP', tone: 'waiting',
      message: future
        ? `BAF score is accumulating for the Level ${lvl} bracket.`
        : `Level ${lvl} BAF settles automatically during the transition.`,
      actionable: false,
    };
  }

  if (status === 'skipped') {
    if (claimable != null && claimable > 0n) {
      return {
        status: 'CONSOLATION READY', tone: 'ready',
        message: `${_formatToken(claimable, 4)} WWXRP claimable.`,
        actionable: true,
      };
    }
    return {
      status: score > 0n ? 'SKIPPED · SETTLED' : 'SKIPPED', tone: 'muted',
      message: score > 0n
        ? 'The BAF flip missed; no WWXRP consolation remains on-chain.'
        : 'The BAF flip missed; this account had no consolation.',
      actionable: false,
    };
  }

  if (status === 'closed') {
    if (eth > 0n || tickets > 0n) {
      const pieces = [];
      if (eth > 0n) pieces.push(`${_formatEth(eth)} ETH`);
      if (tickets > 0n) pieces.push(`${tickets.toString()} ticket${tickets === 1n ? '' : 's'}`);
      return {
        status: 'BAF WINNER', tone: 'won',
        message: `${pieces.join(' + ')} paid automatically.`,
        actionable: false,
      };
    }
    return {
      status: 'RESOLVED', tone: 'lost',
      message: `Level ${lvl} BAF paid automatically; this account did not receive a payout.`,
      actionable: false,
    };
  }

  return future
    ? { status: 'ACCUMULATING', tone: 'waiting', message: `BAF score is accumulating for Level ${lvl}.`, actionable: false }
    : { status: 'NO BAF ROUND', tone: 'muted', message: `No BAF result is indexed for Level ${lvl}.`, actionable: false };
}

export function jackpotResolutionSeenKey(kind, address, level) {
  return `jackpot-resolution-seen:${CHAIN.id}:${Number(CHAIN.deployBlock || 0)}:${kind}:${String(address || '').toLowerCase()}:${Number(level)}`;
}

function _wasSeen(kind, address, level) {
  try { return localStorage.getItem(jackpotResolutionSeenKey(kind, address, level)) === '1'; }
  catch (_e) { return false; }
}

function _markSeen(kind, address, level) {
  try { localStorage.setItem(jackpotResolutionSeenKey(kind, address, level), '1'); }
  catch (_e) { /* private browsing: result can be offered again next load */ }
}

class AppJackpotResolutions extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #pollHandle = null;
  #fetchSeq = 0;
  #address = null;
  #gameState = null;
  #decimator = null;
  #baf = null;
  #history = [];
  // Settled rounds, keyed by the level they belong to. See the note in the
  // fetch: a closed round is immutable, and re-asking is the same waste the
  // last-day poll was. A level change invalidates by key, not by clearing.
  #settled = { dec: null, baf: null };
  #decimatorClaimState = 'unknown';
  #bafConsolation = null;
  #busy = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    // Intentionally headless: final results live in the shared action surfaces
    // while unviewed/actionable, then in the full-screen receipt.
    this.innerHTML = '';
    this.hidden = true;
    this.setAttribute?.('aria-hidden', 'true');
    this.#unsubs.push(
      subscribe('connected.address', () => this.#refresh()),
      subscribe('viewing.address', () => this.#refresh()),
      subscribe('viewing.combined', () => this.#refresh()),
      subscribe('ui.mode', () => this.#refresh()),
      subscribe('app.daySync', () => this.#refresh()),
    );
    this.#refresh();
  }

  disconnectedCallback() {
    for (const unsub of this.#unsubs) {
      try { unsub(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (this.#pollHandle != null) clearTimeout(this.#pollHandle);
    this.#pollHandle = null;
    clearPendingActions(PENDING_SOURCE);
    this.#initialized = false;
  }

  #armPoll() {
    if (this.#pollHandle != null) clearTimeout(this.#pollHandle);
    this.#pollHandle = _setTimeoutUnref(() => this.#refresh(), POLL_MS);
  }

  async #refresh() {
    const seq = ++this.#fetchSeq;
    // Combined mode is read-only, but the resolved draw is still global and
    // can use the connected/viewed account as its highlighted slice. Only the
    // claim path below needs getActingAddress(); presentation must not vanish.
    const viewed = getViewedAddress();
    const nextAddress = viewed ? String(viewed).toLowerCase() : null;
    // Settled rounds are per player. Switching accounts must not show the
    // previous one's Decimator/BAF result.
    if (nextAddress !== this.#address) this.#settled = { dec: null, baf: null };
    this.#address = nextAddress;

    let gameState;
    try { gameState = await readGameState(); }
    catch (_e) {
      if (seq === this.#fetchSeq) {
        clearPendingActions(PENDING_SOURCE);
        this.#armPoll();
      }
      return;
    }
    if (seq !== this.#fetchSeq) return;
    this.#gameState = gameState;

    const currentLevel = Number(gameState?.level);
    const decLevel = decimatorResolutionLevel(currentLevel, gameState?.decWindowOpen === true);
    const bafLevel = bafResolutionLevel(currentLevel);
    if (!this.#address || decLevel == null || bafLevel == null) {
      clearPendingActions(PENDING_SOURCE);
      this.#armPoll();
      return;
    }

    const addr = encodeURIComponent(this.#address);

    // A settled round never changes again. The Decimator runs once every ten
    // levels and BAF once per bracket, so between them these two answers are
    // final for the overwhelming majority of the time this panel is mounted —
    // yet each was refetched every 15s, and jackpot-history (26.5 KB) with
    // them. On a live page load that was 21 Decimator + 8 BAF + 7 history
    // requests for data that had already stopped moving.
    //
    // Latch on 'closed'/'skipped' per level: a later level gets a fresh read
    // because the cache key includes it, and an OPEN round keeps polling
    // because that one genuinely is still moving.
    const decDone = this.#settled.dec?.level === decLevel ? this.#settled.dec.value : null;
    const bafDone = this.#settled.baf?.level === bafLevel ? this.#settled.baf.value : null;

    const [decResult, bafResult, historyResult] = await Promise.allSettled([
      decDone
        ? Promise.resolve(decDone)
        : fetchJSON(`/player/${addr}/decimator?level=${encodeURIComponent(decLevel)}`),
      bafDone
        ? Promise.resolve(bafDone)
        : fetchJSON(`/player/${addr}/baf?level=${encodeURIComponent(bafLevel)}`),
      // History only grows when a jackpot resolves, which is what moves decLevel
      // or bafLevel. Refetch only when one of them is still live.
      (decDone && bafDone)
        ? Promise.resolve({ wins: this.#history })
        : fetchJSON(`/player/${addr}/jackpot-history`),
    ]);
    if (seq !== this.#fetchSeq) return;
    this.#decimator = decResult.status === 'fulfilled' ? decResult.value : null;
    this.#baf = bafResult.status === 'fulfilled' ? bafResult.value : null;
    this.#history = historyResult.status === 'fulfilled' && Array.isArray(historyResult.value?.wins)
      ? historyResult.value.wins
      : [];

    if (this.#decimator && ['closed', 'skipped'].includes(String(this.#decimator.roundStatus || ''))) {
      this.#settled.dec = { level: decLevel, value: this.#decimator };
    }
    if (this.#baf && ['closed', 'skipped'].includes(String(this.#baf.roundStatus || ''))) {
      this.#settled.baf = { level: bafLevel, value: this.#baf };
    }

    const [claimProbe, consolationProbe] = await Promise.allSettled([
      readDecimatorClaimState({ player: this.#address, level: decLevel }),
      this.#baf?.roundStatus === 'skipped'
        ? readBafConsolation({ player: this.#address, level: bafLevel })
        : Promise.resolve(0n),
    ]);
    if (seq !== this.#fetchSeq) return;
    this.#decimatorClaimState = claimProbe.status === 'fulfilled'
      ? String(claimProbe.value?.state || 'unknown')
      : 'unknown';
    this.#bafConsolation = consolationProbe.status === 'fulfilled'
      ? consolationProbe.value
      : null;
    this.#publish();
    this.#armPoll();
  }

  #publish() {
    if (!this.#address || !this.#gameState) {
      clearPendingActions(PENDING_SOURCE);
      return;
    }
    const current = Number(this.#gameState.level);
    const decLevel = decimatorResolutionLevel(current, this.#gameState.decWindowOpen === true);
    const bafLevel = bafResolutionLevel(current);
    const acting = getActingAddress();
    const canAct = Boolean(
      acting && String(acting).toLowerCase() === String(this.#address).toLowerCase(),
    );
    const rows = [];

    const decView = decimatorResolutionView({
      outcome: this.#decimator,
      claimState: this.#decimatorClaimState,
      currentLevel: current,
      level: decLevel,
    });
    const decFinal = this.#decimator?.roundStatus === 'closed';
    const decHasPosition = hasDecimatorPosition(this.#decimator);
    const decSeen = _wasSeen('decimator', this.#address, decLevel);
    // Keep the latest unseen fullscreen receipt through the levels after its
    // transition. Opening or clearing it retires the row; the next Decimator
    // level replaces it naturally.
    const decUnseen = decHasPosition
      && decimatorFinalIsNews({
        closed: decFinal,
        seen: decSeen,
        currentLevel: current,
        windowOpen: this.#gameState.decWindowOpen === true,
      });
    // At an x5/x00 level the Decimator owns the shared jackpot action even if
    // its indexed player row is a poll behind. Showing an explicit processing
    // state prevents the normal jackpot control from slipping past it.
    const decWaiting = decHasPosition
      && !decSeen
      && !decFinal
      && Number(decLevel) === current
      && isDecimatorResolutionLevel(current);
    const decCanResolve = canAct && decView.actionable;
    if (decWaiting || decUnseen || decCanResolve) {
      const willWrite = decCanResolve;
      rows.push({
        id: `decimator-resolution:${this.#address}:${decLevel}`,
        dismissScope: this.#address,
        kind: 'decimator',
        mayAddEth: true,
        kindLabel: 'DECIMATOR FINAL',
        label: `Level ${decLevel} final draw`,
        compact: true,
        shortLabel: decWaiting ? 'Processing' : (willWrite ? 'Resolve + view' : 'View draw'),
        detail: this.#busy === 'decimator'
          ? 'Resolving on-chain'
          : decView.message,
        state: this.#busy === 'decimator' || decWaiting ? 'busy' : 'ready',
        write: willWrite,
        // A read-only final honors the Pending tray's Auto open preference.
        // A claimable winner still requires an explicit transaction click.
        autoOpen: !willWrite,
        primarySurface: 'jackpot',
        order: 12,
        run: decWaiting
          ? null
          : () => this.#runDecimator(decLevel, { resolve: willWrite, show: true }),
      });
    }

    const awards = summarizeBafAwards(this.#history, bafLevel);
    const bafView = bafResolutionView({
      outcome: this.#baf,
      consolation: this.#bafConsolation,
      awards,
      currentLevel: current,
      level: bafLevel,
    });
    const bafFinal = ['closed', 'skipped'].includes(String(this.#baf?.roundStatus || ''));
    // A BAF final is transition chrome only at its x10 boundary. Do not revive
    // an older unseen x10 receipt during a later x5 Decimator takeover; that
    // reads as a BAF button opening the Decimator even though they are two
    // separate resolved draws. Actionable consolation remains available below.
    const bafUnseen = Number(bafLevel) === current
      && bafFinal
      && !_wasSeen('baf', this.#address, bafLevel);
    const bafCanResolve = canAct && bafView.actionable;
    if (bafUnseen || bafCanResolve) {
      const willWrite = bafCanResolve;
      rows.push({
        id: `baf-resolution:${this.#address}:${bafLevel}`,
        dismissScope: this.#address,
        kind: 'baf',
        mayAddEth: true,
        kindLabel: 'BAF FINAL',
        label: `Level ${bafLevel} final draw`,
        shortLabel: willWrite ? 'Claim + view' : 'View draw',
        detail: this.#busy === 'baf' ? 'Claiming on-chain' : bafView.message,
        state: this.#busy === 'baf' ? 'busy' : 'ready',
        write: willWrite,
        autoOpen: !willWrite,
        order: 13,
        run: () => this.#runBaf(bafLevel, { resolve: willWrite, show: bafUnseen }),
      });
    }
    publishPendingActions(PENDING_SOURCE, rows);
  }

  async #queueDecimator(level) {
    const opened = await openDecimatorDraw({ level, player: this.#address });
    if (!opened) return false;
    _markSeen('decimator', this.#address, level);
    // Re-arm the ordinary jackpot underneath the takeover. Besides enforcing
    // the intended Decimator -> Jackpot order, this repairs browsers whose
    // current-day reveal receipt was poisoned by the old rollover race.
    try {
      const detail = { level: Number(level), day: Number(this.#gameState?.day) };
      const event = typeof CustomEvent === 'function'
        ? new CustomEvent('decimator:opened', { detail })
        : { type: 'decimator:opened', detail };
      document.dispatchEvent(event);
    } catch (_e) { /* headless: the overlay itself remains authoritative */ }
    return true;
  }

  async #queueBaf(level, consolation = this.#bafConsolation) {
    const opened = await openBafResolution({
      level,
      player: this.#address,
      consolation: _big(consolation),
      // Reuse the watcher data that made the notification actionable. This
      // keeps a slow duplicate player/history request from holding the final.
      playerOutcome: this.#baf,
      history: { wins: this.#history },
    });
    if (!opened) return false;
    _markSeen('baf', this.#address, level);
    return true;
  }

  async #runDecimator(level, { resolve, show }) {
    if (this.#busy) return;
    this.#busy = 'decimator';
    this.#publish();
    try {
      if (resolve) {
        await claimDecimatorLevels({ player: this.#address, levels: [level] });
        this.#decimatorClaimState = 'claimed';
      }
      if (show) await this.#queueDecimator(level);
    } finally {
      this.#busy = null;
      this.#publish();
      void this.#refresh();
    }
  }

  async #runBaf(level, { resolve, show }) {
    if (this.#busy) return;
    this.#busy = 'baf';
    this.#publish();
    const revealConsolation = this.#bafConsolation;
    try {
      if (resolve) {
        await claimBafConsolation({ player: this.#address, level });
        this.#bafConsolation = 0n;
      }
      if (show) await this.#queueBaf(level, revealConsolation);
    } finally {
      this.#busy = null;
      this.#publish();
      void this.#refresh();
    }
  }

  /** Focused test hook; production refreshes through subscriptions and polling. */
  async __refreshForTest() { await this.#refresh(); }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-jackpot-resolutions')) {
  customElements.define('app-jackpot-resolutions', AppJackpotResolutions);
}

export { AppJackpotResolutions };
