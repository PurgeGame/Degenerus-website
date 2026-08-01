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
//   CLAIM                — claim / claimVolume over the unclaimed rounds
//
// T-58-18: every server- and chain-derived string lands via textContent.

import { CHAIN, VOLUME_WINDOW } from '../app/chain-config.js';
import { displayEth, displayToken } from '../app/scaling.js';
import { get, subscribe, getViewedAddress, getActingAddress } from '../app/store.js';
import { fetchJSON } from '../../beta/app/api.js';
import {
  readGrowthMarket, readVolumeMarket, readVolumeCredit,
  placeGrowthBet, placeVolumeBet, claimGrowth, claimVolume,
  claimGrowthRound, claimVolumeRound, readRoundWinners,
  volumeWindow, volumeRoundNow,
  readLastVolumeSeal, readCurrentTicketVolume, readGrowthRatchets,
  growthBps, payoutPerWinner, UNITS_PER_TICKET,
  STAKE_WEI, SIDE_OVER, SIDE_UNDER,
} from '../app/parimutuel.js';
import { burnForDecimator, DECIMATOR_MIN_FLIP_WEI } from '../app/decimator.js';
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
    return displayEth(BigInt(wei || 0), 2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
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
  #decimatorDraft = '1000';
  #questActivateListener = null;
  #pollHandle = null;
  #tickHandle = null;
  #busy = false;
  #errorTimer = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.#questActivateListener = (event) => this.#applyQuestPreset(event?.detail);
      document.addEventListener('quest:activate', this.#questActivateListener);
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
    for (const h of [this.#pollHandle, this.#tickHandle, this.#errorTimer]) {
      if (h != null) {
        try { clearTimeout(h); } catch (_e) { /* defensive */ }
      }
    }
    this.#pollHandle = null;
    this.#tickHandle = null;
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
    this.#player = player;

    // The growth book numbers its rounds by LEVEL, and the level only comes off
    // the game state. The volume book numbers by day and is computable from the
    // clock, so it never waits on the API.
    let level = this.#level;
    try {
      const state = await fetchJSON('/game/state');
      if (state && Number.isFinite(Number(state.level))) level = Number(state.level);
      if (state && typeof state === 'object') this.#gameState = state;
    } catch (_e) { /* keep the last known level — the books still render */ }
    if (seq !== this.#fetchSeq) return;
    this.#level = level;

    const growthRounds = this.#lookback(level);
    const volumeRounds = this.#lookback(volumeRoundNow());

    // The credit quote is only asked for when it can be earned. On the testnet
    // overlay volumeBetCredit() UNDERFLOWS outside the window — its decay clock
    // is anchored 7s into a 600s day with 4s steps, so a `tod` past ~30s
    // subtracts more than the 25 FLIP base and the view panics (mainnet's
    // 23:15-anchored ladder tops out at 4 steps and cannot). The soft-fail below
    // covers it either way; not asking is just cheaper.
    const win = volumeWindow();
    const wantCredit = win.open || win.secondsToOpen <= (VOLUME_WINDOW.leadSeconds || 0);
    const decimatorLevel = Number.isInteger(level) && level >= 0 ? level + 1 : null;
    const decimatorRead = player && decimatorLevel != null
      ? fetchJSON(`/player/${player}/decimator?level=${decimatorLevel}`).catch(() => null)
      : Promise.resolve(null);
    const [growth, volume, credit, decimatorPosition] = await Promise.all([
      Promise.allSettled(growthRounds.map((round) => readGrowthMarket({ player, round }))),
      Promise.allSettled(volumeRounds.map((round) => readVolumeMarket({ player, round }))),
      wantCredit ? readVolumeCredit().then((c) => c, () => 0n) : Promise.resolve(0n),
      decimatorRead,
    ]);
    if (seq !== this.#fetchSeq) return;

    this.#growth = this.#foldBook(growth);
    this.#volume = this.#foldBook(volume);
    this.#volume.credit = credit;
    this.#decimatorPosition = decimatorPosition;

    // Context for each book: the number the open round has to beat. Fired
    // WITHOUT awaiting — a log query and a view call must never hold up the
    // books themselves, so they land later and re-render.
    this.#loadBenchmarks(seq, level);

    // The round anchors are off-chain guesses — the level comes from the
    // indexer (which can lag a transition) and the volume round from the local
    // clock. `openRound` is the chain's own answer, so when it falls outside
    // the window just read, go get it rather than render a headless book.
    await Promise.all([
      this.#backfillOpen(this.#growth, (round) => readGrowthMarket({ player, round })),
      this.#backfillOpen(this.#volume, (round) => readVolumeMarket({ player, round })),
    ]);
    if (seq !== this.#fetchSeq) return;

    this.#render();
    this.#armPoll();
  }

  // Benchmarks are decoration, not settlement inputs: both soft-fail to null and
  // the books render without them.
  async #loadBenchmarks(seq, level) {
    const [seal, ratchets] = await Promise.all([
      readLastVolumeSeal().catch(() => null),
      readGrowthRatchets({ round: level }).catch(() => null),
    ]);
    if (seq !== this.#fetchSeq) return;
    const currentVolume = seal?.blockNumber > 0
      ? await readCurrentTicketVolume({ afterBlock: seal.blockNumber }).catch(() => null)
      : null;
    if (seq !== this.#fetchSeq) return;
    if (!seal && !ratchets && currentVolume == null) return;
    // These are three independent, best-effort reads. A transient historical-log
    // failure must not erase the last good volume line just because the growth
    // ratchet read succeeded on the same poll; doing that made both the ticket
    // threshold and its red/green result color blink out of the live card.
    if (seal) this.#lastSeal = seal;
    if (currentVolume != null) this.#currentVolume = currentVolume;
    if (ratchets) this.#ratchets = ratchets;
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
    return Boolean(this.#growth.openRound)
      || Boolean(this.#volume.openRound)
      || Boolean(this.#gameState?.decWindowOpen)
      || this.#claimableTotal(this.#growth) > 0n
      || this.#claimableTotal(this.#volume) > 0n
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
      || Boolean(this.#gameState?.decWindowOpen);
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
          <h2>SIDE BETS</h2>
        </div>
        <div class="pari-books">
          <article class="pari-book" data-bind="pari-growth" hidden></article>
          <article class="pari-book" data-bind="pari-volume" hidden></article>
          <article class="pari-book pari-decimator" data-bind="pari-decimator" hidden></article>
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
        empty.textContent = win.secondsToOpen > 0
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
    const open = Boolean(this.#gameState?.decWindowOpen);
    host.hidden = !open;
    host.textContent = '';
    if (!open) return;

    const level = Number.isInteger(this.#level) ? this.#level + 1 : null;
    const head = document.createElement('div');
    head.className = 'pari-book__head';
    const title = document.createElement('h3');
    title.className = 'pari-book__title';
    title.textContent = `DECIMATOR${level != null ? ` · Level ${level}` : ''}`;
    const boon = document.createElement('boon-product-indicator');
    boon.setAttribute('product', 'decimator');
    title.appendChild(boon);
    const state = document.createElement('span');
    state.className = 'pari-clock pari-clock--open';
    state.textContent = 'Entry open';
    head.appendChild(title);
    head.appendChild(state);
    host.appendChild(head);

    const ask = document.createElement('p');
    ask.className = 'pari-book__ask';
    ask.textContent = level == null
      ? 'Burn FLIP for a weighted share of the next Decimator pool.'
      : `Burn FLIP for a weighted share of the Level ${level} Decimator pool.`;
    host.appendChild(ask);

    const stats = document.createElement('div');
    stats.className = 'pari-decimator__stats';
    const pool = document.createElement('span');
    pool.textContent = `Pool · ${_fmtPoolEth(this.#gameState?.prizePools?.futurePrizePool)} ETH`;
    stats.appendChild(pool);
    const effective = (() => {
      try { return BigInt(this.#decimatorPosition?.effectiveAmount ?? 0); }
      catch (_e) { return 0n; }
    })();
    if (effective > 0n) {
      const mine = document.createElement('span');
      const bucket = Number(this.#decimatorPosition?.bucket);
      mine.textContent = `Yours · ${_fmtFlip(effective)} FLIP${Number.isInteger(bucket) ? ` · Bucket ${bucket}` : ''}`;
      stats.appendChild(mine);
    }
    host.appendChild(stats);

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
    input.addEventListener('input', () => { this.#decimatorDraft = String(input.value || ''); });
    const unit = document.createElement('span');
    unit.textContent = 'FLIP';
    inputWrap.appendChild(input);
    inputWrap.appendChild(unit);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pari-decimator__cta';
    button.setAttribute('data-write', '');
    button.setAttribute('data-bind', 'pari-decimator-cta');
    button.textContent = 'Enter';
    button.addEventListener('click', () => this.#enterDecimator());
    entry.appendChild(inputWrap);
    entry.appendChild(button);
    host.appendChild(entry);

    const hint = document.createElement('p');
    hint.className = 'pari-book__foot pari-decimator__hint';
    hint.textContent = 'Minimum 1,000 · uses wallet + claimable FLIP';
    host.appendChild(hint);
  }

  #applyQuestPreset(detail) {
    if (Number(detail?.questType) !== 5) return;
    let target;
    try { target = BigInt(detail?.target ?? 0); } catch (_e) { target = 0n; }
    if (target <= 0n) target = 2_000n * (10n ** 18n);
    const fixed = String(displayToken(target, 6));
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
        const place = kind === 'growth' ? `Level ${result.round}` : `Round ${result.round}`;
        rows.push({
          id: `pari:${id}`,
          kind: 'pari',
          label: `${kind === 'growth' ? 'Growth' : 'Volume'} pari · ${place}`,
          shortLabel: 'Pari result',
          detail: this.#busy
            ? 'Processing result'
            : ready
              ? claimable
                ? `${side} paid · ${_fmtFlip(result.payout)} FLIP ready`
                : `${side} result ready`
              : `${side} · waiting for settlement`,
          state: this.#busy ? 'busy' : ready ? 'ready' : 'waiting',
          order: 30,
          run: claimable
            ? () => this.#claim(kind, [result.round])
            : settledLoss ? () => this.#revealPari(kind, result) : null,
        });
      }
    }
    publishPendingActions(PENDING_SOURCE, rows);
  }

  #revealPari(kind, result) {
    const id = `${kind}:${result.round}`;
    _markResultSeen(this.#player, id);
    queueReveal({
      kind: 'pari',
      market: kind,
      round: result.round,
      side: result.side,
      outcome: result.outcome,
      payout: result.payout,
      voided: result.voided,
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
    const win = volumeWindow();
    const volumeSoon = !win.open && win.secondsToOpen <= (VOLUME_WINDOW.leadSeconds || 0);
    const show = Boolean(book.openRound)
      || claimable.length > 0
      || lost.length > 0
      || pending.length > 0;
    host.hidden = !show;
    host.textContent = '';
    if (!show) return;

    const open = this.#openState(book);
    const latestPosition = [...claimable, ...lost, ...pending]
      .sort((a, b) => Number(b.round) - Number(a.round))[0];
    const round = book.openRound || open?.round || latestPosition?.round || 0;
    const settledOnly = !book.openRound
      && (claimable.length > 0 || lost.length > 0 || pending.length > 0);
    if (host.classList) {
      if (settledOnly) host.classList.add('pari-book--settled');
      else host.classList.remove('pari-book--settled');
    }

    const head = document.createElement('div');
    head.className = 'pari-book__head';
    const title = document.createElement('h3');
    title.className = 'pari-book__title';
    title.textContent = kind === 'growth'
      ? `GROWTH${round ? ` · Level ${round}` : ''}`
      : `VOLUME${round ? ` · Round ${round}` : ''}`;
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

    if (round && !settledOnly) {
      // Pair the prior benchmark with the upcoming period label on one compact
      // context row. Volume adds TODAY at the right edge; keeping it out of the
      // choice grid lets OVER and UNDER use full width.
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

    this.#renderPositions(
      host,
      kind,
      book,
      claimable,
      lost,
      featuredGrowthPosition ? pending.slice(1) : pending,
    );
  }

  // "Yesterday: N tickets" — strictly the immediately preceding round's
  // result. A stale seal must never make Round 429 look like it is betting
  // against Round 427; Round 427 only matters through Round 428's recorded
  // OVER/UNDER outcome.
  #volumeMark(round) {
    const seal = this.#lastSeal;
    if (!seal) return null;
    const open = Number(round || this.#volume.openRound || volumeRoundNow());
    if (!Number.isInteger(open) || seal.round !== open - 1) return null;
    return { lead: 'Yesterday: ', offered: `${_fmtTickets(seal.total)} tickets` };
  }

  // "Last level: X%" — the growth rate the next level has to beat. The book
  // compares RATIOS of consecutive prize pools, so this is the realized ratio of
  // the step just completed.
  #growthMark(round) {
    const r = this.#ratchets;
    if (!r) return null;
    const bps = growthBps(r.prev, r.current);
    if (bps == null) return null;
    const pct = _fmtPct(Math.abs(bps) / 100);
    return {
      lead: 'Last level: ',
      offered: `${bps < 0 ? '-' : ''}${pct}%`,
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
    today.className = 'pari-today';
    if (kind === 'volume') {
      const todayLabel = document.createElement('span');
      todayLabel.className = 'pari-today__label';
      todayLabel.textContent = 'TODAY';
      const context = host.querySelector('.pari-book__context');
      if (context) context.appendChild(todayLabel);
      else today.appendChild(todayLabel);
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

    for (const side of [SIDE_OVER, SIDE_UNDER]) {
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
        if (kind === 'volume' && offered) {
          const verb = document.createElement('span');
          verb.className = 'pari-side__verb';
          // Keep a separating space in the accessibility/fake-DOM aggregate;
          // CSS places this on its own visual row.
          verb.textContent = `${sideText} `;
          const target = document.createElement('span');
          target.className = 'pari-side__target';
          target.textContent = `TARGET · ${offered.offered}`;
          action.appendChild(verb);
          action.appendChild(target);
        } else {
          action.textContent = offered ? `${sideText} ${offered.offered}` : sideText;
        }
        btn.appendChild(action);
        btn.setAttribute(
          'aria-label',
          `Bet ${isOver ? 'over' : 'under'}${offered
            ? kind === 'volume'
              ? ` the target of ${offered.offered}`
              : ` ${offered.offered}`
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
          target.textContent = `TARGET · ${offered.offered}`;
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
    host.appendChild(today);
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
    pick.textContent = `${sideText}${offered ? ` ${offered.offered}` : ''} GROWTH`;
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
    claimable,
    lost = this.#lost(book, kind),
    pending = this.#pendingSettlement(book),
  ) {
    if (claimable.length === 0 && lost.length === 0 && pending.length === 0) return;

    const list = document.createElement('div');
    list.className = 'pari-results';

    for (const r of pending) {
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

    // Settled history is intentionally absent here. It duplicated the reveal
    // receipt as a tall “Level N · OVER won / 1,000 FLIP” stack. Retain only a
    // still-settling position and the useful action below.
    if (claimable.length > 0 && get('connected.address')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pari-claim-cta';
      btn.setAttribute('data-write', '');
      btn.textContent = `Claim ${_fmtFlip(this.#claimableTotal(book))} FLIP`;
      btn.addEventListener('click', () => this.#claim(kind, claimable.map((r) => r.round)));
      list.appendChild(btn);
    }
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
      button.textContent = 'Entering…';
    }
    await this.#run((player) => burnForDecimator({ player, amount }));
    if (button) {
      button.disabled = false;
      button.textContent = 'Enter';
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
    for (const row of alreadySettled) this.#revealPari(kind, this.#pariReplayResult(row));
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
        this.#revealPari(kind, this.#pariReplayResult(result));
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
          for (const row of claimed) this.#revealPari(kind, this.#pariReplayResult(row));
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
      _setTimeoutUnref(() => this.#refresh(), 250);
      return true;
    } catch (error) {
      this.#renderError(compactUiError(error));
      return false;
    } finally {
      _setTimeoutUnref(() => {
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
