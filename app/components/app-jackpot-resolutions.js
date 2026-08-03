// Headless watcher for the two level-transition drawings.
//
// The page does not carry a permanent Decimator/BAF dashboard. Once a round
// closes, this controller publishes one compact VIEW/RESOLVE action into the
// shared bottom tray. Opening it plays a one-time final-draw receipt through
// reveal-overlay; genuine permissionless claims remain available until mined.

import { fetchJSON } from '../../beta/app/api.js';
import { CHAIN } from '../app/chain-config.js';
import { displayEth, displayToken } from '../app/scaling.js';
import {
  get,
  subscribe,
  getViewedAddress,
  getActingAddress,
} from '../app/store.js';
import { claimDecimatorLevels } from '../app/claims.js';
import {
  bafResolutionLevel,
  claimBafConsolation,
  decimatorResolutionLevel,
  readBafConsolation,
  readDecimatorClaimState,
  summarizeBafAwards,
} from '../app/jackpot-resolutions.js';
import { clearPendingActions, publishPendingActions } from '../app/pending-actions.js';
import { queueReveal } from './reveal-overlay.js';

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

function _formatRank(rank, total) {
  const r = Number(rank);
  const t = Number(total);
  if (!Number.isInteger(r) || r <= 0) return 'UNRANKED';
  return Number.isInteger(t) && t > 0 ? `#${r} / ${t}` : `#${r}`;
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
  const entered = Number.isInteger(bucket) && bucket > 0;
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
        message: `${_formatEth(payout)} ETH payout record.`,
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

function _seenKey(kind, address, level) {
  return `jackpot-resolution-seen:${CHAIN.id}:${kind}:${String(address || '').toLowerCase()}:${Number(level)}`;
}

function _wasSeen(kind, address, level) {
  try { return localStorage.getItem(_seenKey(kind, address, level)) === '1'; }
  catch (_e) { return false; }
}

function _markSeen(kind, address, level) {
  try { localStorage.setItem(_seenKey(kind, address, level), '1'); }
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
  #decimatorClaimState = 'unknown';
  #bafConsolation = null;
  #busy = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    // Intentionally headless: final results live in the bottom tray only while
    // unviewed/actionable, then in the full-screen receipt for one interaction.
    this.innerHTML = '';
    this.hidden = true;
    this.setAttribute?.('aria-hidden', 'true');
    this.#unsubs.push(
      subscribe('connected.address', () => this.#refresh()),
      subscribe('viewing.address', () => this.#refresh()),
      subscribe('viewing.combined', () => this.#refresh()),
      subscribe('ui.mode', () => this.#refresh()),
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
    const combined = get('ui.mode') === 'combined' || get('viewing.combined') === true;
    const viewed = combined ? null : getViewedAddress();
    this.#address = viewed ? String(viewed).toLowerCase() : null;

    let gameState;
    try { gameState = await fetchJSON('/game/state'); }
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
    const [decResult, bafResult, historyResult] = await Promise.allSettled([
      fetchJSON(`/player/${addr}/decimator?level=${encodeURIComponent(decLevel)}`),
      fetchJSON(`/player/${addr}/baf?level=${encodeURIComponent(bafLevel)}`),
      fetchJSON(`/player/${addr}/jackpot-history`),
    ]);
    if (seq !== this.#fetchSeq) return;
    this.#decimator = decResult.status === 'fulfilled' ? decResult.value : null;
    this.#baf = bafResult.status === 'fulfilled' ? bafResult.value : null;
    this.#history = historyResult.status === 'fulfilled' && Array.isArray(historyResult.value?.wins)
      ? historyResult.value.wins
      : [];

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
    const decUnseen = decFinal && !_wasSeen('decimator', this.#address, decLevel);
    const decCanResolve = canAct && decView.actionable;
    if (decUnseen || decCanResolve) {
      const willWrite = decCanResolve;
      rows.push({
        id: `decimator-resolution:${this.#address}:${decLevel}`,
        kind: 'decimator',
        kindLabel: 'DECIMATOR FINAL',
        label: `Level ${decLevel} final draw`,
        shortLabel: willWrite ? 'Resolve + view' : 'View draw',
        detail: this.#busy === 'decimator'
          ? 'Resolving on-chain'
          : decView.message,
        state: this.#busy === 'decimator' ? 'busy' : 'ready',
        write: willWrite,
        autoOpen: !willWrite,
        order: 12,
        run: () => this.#runDecimator(decLevel, { resolve: willWrite, show: decUnseen }),
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
    const bafUnseen = bafFinal && !_wasSeen('baf', this.#address, bafLevel);
    const bafCanResolve = canAct && bafView.actionable;
    if (bafUnseen || bafCanResolve) {
      const willWrite = bafCanResolve;
      rows.push({
        id: `baf-resolution:${this.#address}:${bafLevel}`,
        kind: 'baf',
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

  #queueDecimator(level) {
    const row = this.#decimator || {};
    const bucket = Number(row.bucket);
    const yours = Number(row.subbucket);
    const winning = Number(row.winningSubbucket);
    const entered = Number.isInteger(bucket) && bucket > 0;
    const won = entered && Number.isInteger(yours) && yours === winning && _big(row.payoutAmount) > 0n;
    const drawDetail = entered
      ? `Bucket ${bucket} · yours ${Number.isInteger(yours) ? yours : '—'} · drawn ${Number.isInteger(winning) ? winning : '—'}`
      : 'No Decimator entry was recorded for this account.';
    const cards = [{
      type: 'decimator-final',
      outcome: won ? 'win' : 'loss',
      rarity: won ? 'epic' : 'common',
      glyph: 'Ⅹ',
      label: 'DECIMATOR FINAL',
      value: won ? 'WINNING SUBBUCKET' : (entered ? 'NO HIT' : 'NO ENTRY'),
      sub: drawDetail,
    }];
    const payout = _big(row.payoutAmount);
    if (payout > 0n) {
      cards.push({
        type: 'decimator-share', outcome: 'win', rarity: 'epic', glyph: 'Ξ',
        label: 'YOUR POOL SHARE', value: `${_formatEth(payout)} ETH`,
        sub: this.#decimatorClaimState === 'claimed' ? 'Resolution credited on-chain' : 'Ready to credit on-chain',
      });
    }
    queueReveal({ kind: 'resolution', title: `LEVEL ${level} DECIMATOR DRAW`, big: won, cards });
    _markSeen('decimator', this.#address, level);
  }

  #queueBaf(level) {
    const awards = summarizeBafAwards(this.#history, level);
    const score = _big(this.#baf?.score);
    const skipped = this.#baf?.roundStatus === 'skipped';
    const won = awards.eth > 0n || awards.tickets > 0n;
    const cards = [{
      type: 'baf-final', outcome: skipped ? 'skipped' : (won ? 'win' : 'loss'),
      rarity: won ? 'epic' : 'common', glyph: 'BAF',
      label: skipped ? 'BAF DRAW SKIPPED' : 'FINAL BAF RANK',
      value: skipped ? 'CONSOLATION ROUND' : _formatRank(this.#baf?.rank, this.#baf?.totalParticipants),
      sub: `${_formatToken(score)} FLIP score${skipped ? ' frozen for consolation' : ''}`,
    }];
    if (won) {
      const pieces = [];
      if (awards.eth > 0n) pieces.push(`${_formatEth(awards.eth)} ETH`);
      if (awards.tickets > 0n) pieces.push(`${awards.tickets} TICKET${awards.tickets === 1n ? '' : 'S'}`);
      cards.push({
        type: 'baf-prize', outcome: 'win', rarity: 'epic', glyph: '★',
        label: 'YOUR BAF PAYOUT', value: pieces.join(' + '), sub: 'Paid automatically at transition',
      });
    } else if (skipped && _big(this.#bafConsolation) > 0n) {
      cards.push({
        type: 'baf-consolation', outcome: 'win', rarity: 'rare', glyph: 'W',
        label: 'WWXRP CONSOLATION', value: `${_formatToken(this.#bafConsolation, 4)} WWXRP`,
        sub: 'Credited by the consolation claim',
      });
    }
    queueReveal({ kind: 'resolution', title: `LEVEL ${level} BAF FINAL`, big: won, cards });
    _markSeen('baf', this.#address, level);
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
      if (show) this.#queueDecimator(level);
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
    try {
      if (resolve) {
        await claimBafConsolation({ player: this.#address, level });
        this.#bafConsolation = 0n;
      }
      if (show) this.#queueBaf(level);
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
