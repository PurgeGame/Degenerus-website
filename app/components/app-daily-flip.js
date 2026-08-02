// /app/components/app-daily-flip.js — the daily coinflip widget (user ask).
//
// Lives INSIDE the jackpot hero as its right column (user call: the coinflip
// is part of the jackpot widget, not a sibling panel). The coin is a CSS-3D
// two-facer (shared/coinflip-face-red.svg = WWXRP/Purge side,
// shared/coinflip-face-eth.svg = green ETH side, both derived from the
// user's coinflip-coin.svg):
//
//   - unrevealed: the coin spins continuously (rotateX loop, end over end); the REVEAL
//     FLIP button (or tapping the coin) writes `flip_day_${CHAIN.id}_${day}`
//     (the SAME key the balances strip's fuzz gate reads) and plays one of four
//     deterministic, day-wide motion tracks followed by the day's ending — then
//     dispatches document 'flip:revealed';
//   - revealed: the static landed face + outcome copy.
//
// Data: /game/coinflip/day/:day (global outcome; one flip per day protocol-
// wide) + /player/:addr dashboard coinflip.{depositedAmount, claimablePreview}
// and top-level flipBalance.
//
// Actions (all Phase 58 sendTx chokepoint paths):
//   FLIP — depositCoinflip(player, amount) stake (FLIP wei, UNSCALED).
// Ticket redemption belongs to the purchase panel, so this side only owns the
// coinflip stake, its winnings claim, and the post-result Reverse Flip card.
// (CLAIM DGNRS removed — user call: no DGNRS claim in the coinflip column.
// The inline FLIP-winnings claim chip on the Claimable row stays.)
//
// T-58-18: server-derived strings via textContent.

import { CHAIN } from '../app/chain-config.js';
import { displayEth, displayToken } from '../app/scaling.js';
import { get, subscribe, getViewedAddress } from '../app/store.js';
import { fetchJSON } from '../../beta/app/api.js';
import {
  depositCoinflip,
  readClaimableCoinflip,
  readCurrentCoinflipStake,
  readResolvedCoinflipStake,
  readReverseFlipQuote,
  reverseFlip,
  reverseFlipCostWei,
} from '../app/coinflip.js';
import { claimFlip } from '../app/claims.js';
import {
  burnSdgnrs,
  MIN_SDGNRS_BURN_WEI,
  previewSdgnrsBurn,
} from '../app/sdgnrs.js';
import { compactUiError } from '../app/ui-error.js';
import { updateBalanceDisplay, resetBalanceDisplay } from '../app/balance-countup.js';
import './boon-product-indicator.js';

// Four equally-common reveal profiles, with the requested conditional win
// rates. The protocol result remains authoritative; the UI chooses a profile
// *after* resolution with complementary win/loss weights. Given the protocol's
// fair 50/50 result:
//
//   P(profile | win)  = winRate / 200
//   P(profile | loss) = (100 - winRate) / 200
//
// Therefore every profile appears 25% of the time and P(win | profile) is
// exactly its declared 60/55/45/40% in expectation. Selection uses only the
// global day and global outcome, never a player/address or browser RNG, so
// everybody receives the same reveal on the same day.
const FLIP_REVEAL_PROFILES = Object.freeze([
  Object.freeze({ id: 'comet', winRate: 60 }),
  Object.freeze({ id: 'ricochet', winRate: 55 }),
  Object.freeze({ id: 'orbit', winRate: 45 }),
  Object.freeze({ id: 'pulse', winRate: 40 }),
]);
const REVEAL_PROFILE_WEIGHT_TOTAL = 200;
const REVEAL_TRACK_MS = 3300;
const REVEAL_END_MS = 700;
const REVEAL_FAKE_END_MS = 1600;
const REVEAL_DOUBLE_END_MS = 2500;
const REVEAL_TRIPLE_END_MS = 3400;
const REVERSE_CARD_STAGGER_MS = 900;
const REVEAL_BIASED_EXTENSION_MS = 650;
const REVEAL_BIASED_END_MS = REVEAL_END_MS + REVEAL_BIASED_EXTENSION_MS;
const REVERSE_CARD_ANIMATION_MS = 700;
const METER_SETTLE_MS = 700;
const METER_FLASH_MS = 850;
const METER_DRAIN_MS = 350;
const METER_RECOVERY_TAIL_MS = 250;
const METER_REBOUND_MS = REVERSE_CARD_STAGGER_MS + METER_RECOVERY_TAIL_MS;
const METER_TERMINAL_DRAIN_MS = REVERSE_CARD_STAGGER_MS - METER_RECOVERY_TAIL_MS;
const MODIFIER_MIN_PERCENT = 50;
const MODIFIER_MAX_PERCENT = 156;
const ERROR_AUTO_CLEAR_MS = 10_000;
const POLL_INTERVAL_MS = 30_000;
const REVERSE_FLIP_HELP = Object.freeze([
  'Reverses the outcome of the next flip.',
  'Alters all jackpot outcomes unpredictably.',
]);

/** Stable 32-bit day mixer. Math.imul + bitwise ops are identical in browsers. */
function _revealDayHash(day, salt) {
  const numericDay = Number(day);
  let x = ((Number.isFinite(numericDay) ? Math.trunc(numericDay) : 0) ^ salt) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Public pure helper for tests/replays. The original one-card fakeout keeps
 * its 10% day-wide chance (5% in each direction under a fair result). Three
 * disjoint hash buckets add exact 2% double- and 1% triple-reversal chances.
 * Every reversal toggles the visible face; even sequences therefore begin on
 * the authoritative face and odd sequences begin opposite it, so the final
 * face always remains the protocol result.
 */
function selectFlipRevealPlan(day, won) {
  const isWin = Boolean(won);
  const bucket = _revealDayHash(day, 0x51ed270b) % REVEAL_PROFILE_WEIGHT_TOTAL;
  let cursor = 0;
  let profile = FLIP_REVEAL_PROFILES.at(-1);
  for (const candidate of FLIP_REVEAL_PROFILES) {
    cursor += isWin ? candidate.winRate : 100 - candidate.winRate;
    if (bucket < cursor) {
      profile = candidate;
      break;
    }
  }

  // The last decimal digit preserves every existing one-card fakeout day.
  // Buckets 1, 2, and 3 were previously ordinary days, making the additions
  // disjoint and exactly 1% / 2% across the stable 100-bucket mixer.
  const reversalBucket = _revealDayHash(day, 0xa341316c) % 100;
  const reversalCount = reversalBucket === 1
    ? 3
    : (reversalBucket === 2 || reversalBucket === 3)
      ? 2
      : reversalBucket % 10 === 0
        ? 1
        : 0;
  const fakeOut = reversalCount > 0;
  const openingWon = reversalCount % 2 === 0 ? isWin : !isWin;
  const prefersWin = profile.winRate > 50;
  const openingMs = openingWon === prefersWin ? REVEAL_BIASED_END_MS : REVEAL_END_MS;
  let ending;
  if (reversalCount === 0) {
    ending = isWin ? 'win' : 'loss';
  } else if (reversalCount === 1) {
    ending = isWin ? 'loss-to-win' : 'win-to-loss';
  } else if (reversalCount === 2) {
    ending = isWin ? 'double-to-win' : 'double-to-loss';
  } else {
    ending = isWin ? 'triple-to-win' : 'triple-to-loss';
  }
  const endingMs = openingMs + (reversalCount * REVERSE_CARD_STAGGER_MS);

  return Object.freeze({
    profile: profile.id,
    winRate: profile.winRate,
    ending,
    fakeOut,
    reversalCount,
    bias: prefersWin ? 'win-heavy' : 'loss-heavy',
    openingWon,
    openingMs,
    trackMs: REVEAL_TRACK_MS,
    endingMs,
    totalMs: REVEAL_TRACK_MS + endingMs,
  });
}

function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

function compactBetAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  const tiers = [
    [1e12, 't'],
    [1e9, 'b'],
    [1e6, 'm'],
    [1e3, 'k'],
  ];
  for (const [size, suffix] of tiers) {
    if (amount < size) continue;
    return `${Math.round(amount / size)}${suffix}`;
  }
  return String(Math.round(amount));
}

function parseTokenAmount(value) {
  const match = /^\s*(\d+)(?:\.(\d{0,18}))?\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  const fraction = (match[2] || '').padEnd(18, '0');
  try { return (BigInt(match[1]) * (10n ** 18n)) + BigInt(fraction || '0'); }
  catch (_e) { return null; }
}

function tokenAmountInput(wei) {
  const raw = BigInt(wei || 0);
  const unit = 10n ** 18n;
  const whole = raw / unit;
  const fraction = String(raw % unit).padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

class AppDailyFlip extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #day = null;
  #flipResult = null;      // /game/coinflip/day payload or null
  #flipFetchedDay = null;
  #dashboard = null;
  #dashboardAddress = null;
  #currentBetWei = null;   // live coinflipAmount(player), scoped to the current target day
  #resolvedBetWei = null;  // final CoinflipStakeUpdated.newTotal for the exact result day
  #liveClaimableWei = null; // direct previewClaimCoinflips, bypassing indexer lag
  #fetchSeq = 0;
  #refreshQueued = false;
  #active = false;
  #pollHandle = null;
  #landing = false;        // coin is mid-landing animation
  #meterSettling = false;
  #meterRecoveryTail = false;
  #meterFlashVisible = false;
  #meterTimer = null;
  #fakeoutMeterVisible = false;
  #fakeoutMeterDraining = false;
  #fakeoutMeterTerminalDraining = false;
  #fakeoutMeterRebounding = false;
  #fakeoutMeterTimers = new Set();
  #revealTimer = null;
  #busy = false;
  #errorTimer = null;
  #reverseFlipQuote = null;
  #showLiveSideOnCoin = false;
  #questActivateListener = null;
  #sdgnrsQuote = null;
  #sdgnrsQuoteAmount = null;
  #sdgnrsQuotePending = false;
  #sdgnrsQuoteSeq = 0;
  // Day-scoped resolved receipt. It preserves the stake/payout named in the
  // result copy and the optimistic claimable total across a browser reload.
  // "Your bet" deliberately does NOT read this receipt: it comes from the
  // contract's live current-day coinflipAmount(player) view.
  #settlementState = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#active = true;
    this.#renderShell();
    this.#wireActions();
    this.#wireQuestPreset();

    // On a NEW day: cancel any in-flight landing, re-render immediately so
    // the stale coin can't take clicks against the new day's key, then
    // refresh (codex finding — the old coin stayed clickable and a running
    // landing would dispatch with the mutated day).
    this.#unsubs.push(subscribe('app.lastDay', (payload) => {
      if (!payload || payload.day == null) return;
      if (payload.day !== this.#day) {
        this.#clearRevealTimer();
        this.#day = payload.day;
        this.#landing = false;
        this.#clearModifierMeter();
        this.#clearFakeoutMeter();
        this.#settlementState = null;
        this.#currentBetWei = null;
        this.#resolvedBetWei = null;
        this.#liveClaimableWei = null;
        this.#reverseFlipQuote = null;
        this.#showLiveSideOnCoin = false;
        this.#render();
        this.#scheduleRefresh();
      }
    }));
    this.#unsubs.push(subscribe('connected.address', () => {
      this.#settlementState = null;
      this.#dashboardAddress = null;
      this.#currentBetWei = null;
      this.#resolvedBetWei = null;
      this.#liveClaimableWei = null;
      this.#scheduleRefresh();
    }));
    this.#unsubs.push(subscribe('viewing.address', () => {
      this.#settlementState = null;
      this.#dashboardAddress = null;
      this.#currentBetWei = null;
      this.#resolvedBetWei = null;
      this.#liveClaimableWei = null;
      this.#scheduleRefresh();
    }));

    if (typeof setInterval === 'function') {
      this.#pollHandle = _setIntervalUnref(() => this.#scheduleRefresh(), POLL_INTERVAL_MS);
    }
    this.#scheduleRefresh();
  }

  disconnectedCallback() {
    resetBalanceDisplay(this.querySelector('[data-bind="df-funds-wallet"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="df-funds-claimable"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="df-funds-sdgnrs"]'));
    this.#active = false;
    this.#fetchSeq += 1;
    this.#refreshQueued = false;
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (this.#questActivateListener && typeof document !== 'undefined') {
      try { document.removeEventListener('quest:activate', this.#questActivateListener); }
      catch (_e) { /* defensive */ }
      this.#questActivateListener = null;
    }
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
      this.#errorTimer = null;
    }
    this.#clearModifierMeter();
    this.#clearFakeoutMeter();
    this.#clearRevealTimer();
    this.#sdgnrsQuoteSeq += 1;
    this.#sdgnrsQuotePending = false;
    this.#initialized = false;
  }

  #clearRevealTimer() {
    if (this.#revealTimer == null) return;
    try { clearTimeout(this.#revealTimer); } catch (_) { /* defensive */ }
    this.#revealTimer = null;
  }

  #clearFakeoutMeter() {
    for (const timer of this.#fakeoutMeterTimers) {
      try { clearTimeout(timer); } catch (_) { /* defensive */ }
    }
    this.#fakeoutMeterTimers.clear();
    this.#fakeoutMeterVisible = false;
    this.#fakeoutMeterDraining = false;
    this.#fakeoutMeterTerminalDraining = false;
    this.#fakeoutMeterRebounding = false;
  }

  #scheduleFakeoutMeter(revealDay, delay, state) {
    const timer = setTimeout(() => {
      this.#fakeoutMeterTimers.delete(timer);
      if (!this.#landing || this.#day !== revealDay) return;
      this.#fakeoutMeterVisible = state !== 'hide';
      this.#fakeoutMeterDraining = state === 'drain' || state === 'terminal-drain';
      this.#fakeoutMeterTerminalDraining = state === 'terminal-drain';
      this.#fakeoutMeterRebounding = state === 'rebound';
      this.#renderModifierMeter();
    }, delay);
    this.#fakeoutMeterTimers.add(timer);
    if (timer && typeof timer.unref === 'function') {
      try { timer.unref(); } catch (_) { /* defensive */ }
    }
  }

  #scheduleApparentWinMeters(revealDay, revealPlan, won) {
    const reversalCount = Math.max(0, Math.trunc(Number(revealPlan?.reversalCount) || 0));
    if (reversalCount === 0) return;
    let apparentWon = reversalCount % 2 === 0 ? Boolean(won) : !Boolean(won);
    let meterVisible = apparentWon;
    let meterHasRebounded = false;
    if (apparentWon) {
      this.#scheduleFakeoutMeter(revealDay, revealPlan.trackMs + revealPlan.openingMs, 'show');
    }

    // Each reversal completes on one of these ending offsets. A final red
    // result runs the thermometer to minimum and removes it on that exact
    // landing frame. Whenever another card remains, the mounted rail instead
    // rebounds from its floor and preserves the shorter branch it is mimicking.
    for (let completed = 1; completed <= reversalCount; completed += 1) {
      const nextWon = !apparentWon;
      const landingAt = revealPlan.trackMs
        + revealPlan.openingMs
        + (completed * REVERSE_CARD_STAGGER_MS);
      const anotherCardRemains = completed < reversalCount;
      if (apparentWon && !nextWon) {
        if (anotherCardRemains) {
          this.#scheduleFakeoutMeter(revealDay, landingAt - METER_DRAIN_MS, 'drain');
          this.#scheduleFakeoutMeter(revealDay, landingAt, 'rebound');
          meterHasRebounded = true;
        } else {
          const drainMs = meterHasRebounded ? METER_TERMINAL_DRAIN_MS : METER_DRAIN_MS;
          this.#scheduleFakeoutMeter(
            revealDay,
            landingAt - drainMs,
            meterHasRebounded ? 'terminal-drain' : 'drain',
          );
          this.#scheduleFakeoutMeter(revealDay, landingAt, 'hide');
          meterVisible = false;
        }
      } else if (!apparentWon && nextWon && completed < reversalCount && !meterVisible) {
        this.#scheduleFakeoutMeter(revealDay, landingAt, 'show');
        meterVisible = true;
      }
      apparentWon = nextWon;
    }
  }

  #clearModifierMeter() {
    if (this.#meterTimer != null) {
      try { clearTimeout(this.#meterTimer); } catch (_) { /* defensive */ }
      this.#meterTimer = null;
    }
    this.#meterSettling = false;
    this.#meterRecoveryTail = false;
    this.#meterFlashVisible = false;
  }

  // ---------------------------------------------------------------------
  // Reveal gate — same key family as the balances strip fuzz gate.
  // ---------------------------------------------------------------------

  #flipKey() { return `flip_day_${CHAIN.id}_${this.#day}`; }

  #revealed() {
    if (this.#day == null) return false;
    try {
      return typeof localStorage !== 'undefined'
        && localStorage.getItem(this.#flipKey()) === '1';
    } catch (_e) {
      return false;
    }
  }

  #markRevealed() {
    if (this.#day == null) return;
    try { localStorage.setItem(this.#flipKey(), '1'); } catch (_e) { /* private browsing */ }
  }

  #viewedAddress() {
    return (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || get('viewing.address')
      || get('connected.address')
      || null;
  }

  #settlementKey(day, address) {
    if (day == null || !address) return null;
    return `flip_settlement_${CHAIN.id}_${day}_${String(address).toLowerCase()}`;
  }

  #saveSettlement(state) {
    const key = this.#settlementKey(state?.day, state?.address);
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({
        day: state.day,
        address: state.address,
        betWei: String(state.betWei),
        claimableBaseWei: String(state.claimableBaseWei),
        claimableTotalWei: String(state.claimableTotalWei ?? 0n),
        rewardPercent: Number(state.rewardPercent || 0),
        won: Boolean(state.won),
      }));
    } catch (_e) { /* private browsing / quota */ }
  }

  #loadSettlement(day, address) {
    const key = this.#settlementKey(day, address);
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (String(saved?.day) !== String(day)) return null;
      if (String(saved?.address || '').toLowerCase() !== String(address).toLowerCase()) return null;
      return {
        day,
        address: String(address).toLowerCase(),
        betWei: this.#asWei(saved.betWei),
        claimableBaseWei: this.#asWei(saved.claimableBaseWei),
        claimableTotalWei: saved.claimableTotalWei == null
          ? null
          : this.#asWei(saved.claimableTotalWei),
        rewardPercent: Number(saved.rewardPercent || 0),
        won: Boolean(saved.won),
      };
    } catch (_e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------

  #scheduleRefresh() {
    if (this.#refreshQueued || !this.#active) return;
    this.#refreshQueued = true;
    const run = () => {
      this.#refreshQueued = false;
      if (this.#active) void this.#refresh();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  #repairSettlement() {
    const settlement = this.#activeSettlement();
    if (!settlement || this.#resolvedBetWei == null) return;
    // Repair receipts saved by older UI builds that inferred the resolved bet
    // from the dashboard's newest stake (which may already belong to tomorrow).
    settlement.betWei = this.#resolvedBetWei;
    if (this.#flipFetchedDay === this.#day && this.#flipResult) {
      settlement.rewardPercent = Number(
        this.#flipResult.rewardPercent || settlement.rewardPercent || 0,
      );
    }
    if (this.#liveClaimableWei != null) {
      settlement.claimableTotalWei = this.#liveClaimableWei;
    } else if (settlement.claimableTotalWei == null) {
      settlement.claimableTotalWei = settlement.claimableBaseWei
        + this.#settlementGainWei(settlement);
    }
    this.#saveSettlement(settlement);
  }

  #runRefreshTask(seq, promise, onValue, onFailure = null) {
    return Promise.resolve(promise).then(
      (value) => {
        if (!this.#active || seq !== this.#fetchSeq) return;
        onValue(value);
        this.#render();
      },
      () => {
        if (!this.#active || seq !== this.#fetchSeq || !onFailure) return;
        onFailure();
        this.#render();
      },
    );
  }

  async #refresh() {
    const addr = this.#viewedAddress();
    const day = this.#day;
    const seq = ++this.#fetchSeq;
    const address = addr == null ? null : String(addr).toLowerCase();
    const targetChanged = this.#dashboardAddress !== address;

    // Establish the target immediately so a slow response can never leave the
    // previous player's values on screen. Immutable reveal receipts can render
    // from local storage while the network catches up.
    if (targetChanged) {
      this.#dashboard = null;
      this.#dashboardAddress = address;
      this.#currentBetWei = null;
      this.#resolvedBetWei = null;
      this.#liveClaimableWei = null;
    }
    const currentSettlement = this.#activeSettlement();
    if (!currentSettlement) {
      this.#settlementState = this.#loadSettlement(day, address);
    }
    if (targetChanged || this.#settlementState) this.#render();

    const tasks = [
      this.#runRefreshTask(
        seq,
        addr ? fetchJSON(`/player/${address}`) : Promise.resolve(null),
        (value) => {
          if (value) this.#dashboard = value;
          else this.#dashboard = null;
        },
      ),
      this.#runRefreshTask(
        seq,
        day != null ? fetchJSON(`/game/coinflip/day/${day}`) : Promise.resolve(null),
        (value) => {
          this.#flipResult = value;
          this.#flipFetchedDay = day;
          this.#repairSettlement();
        },
        () => {
          this.#flipResult = null;
          this.#flipFetchedDay = day;
        },
      ),
      this.#runRefreshTask(
        seq,
        addr ? readCurrentCoinflipStake({ player: addr }) : Promise.resolve(null),
        (value) => {
          this.#currentBetWei = value == null ? null : this.#asWei(value);
        },
        () => { this.#currentBetWei = null; },
      ),
      this.#runRefreshTask(
        seq,
        addr ? readClaimableCoinflip({ player: addr }) : Promise.resolve(null),
        (value) => {
          this.#liveClaimableWei = value == null ? null : this.#asWei(value);
          this.#repairSettlement();
        },
        () => { this.#liveClaimableWei = null; },
      ),
      this.#runRefreshTask(
        seq,
        addr && day != null
          ? readResolvedCoinflipStake({ player: addr, day })
          : Promise.resolve(null),
        (value) => {
          this.#resolvedBetWei = value == null ? null : this.#asWei(value);
          this.#repairSettlement();
        },
        () => { this.#resolvedBetWei = null; },
      ),
      this.#runRefreshTask(
        seq,
        readReverseFlipQuote(),
        (value) => {
          this.#reverseFlipQuote = value == null ? null : {
            queued: this.#asWei(value.queued),
            costWei: this.#asWei(value.costWei),
            locked: Boolean(value.locked),
          };
        },
        () => { this.#reverseFlipQuote = null; },
      ),
    ];
    await Promise.allSettled(tasks);
  }

  // ---------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <section class="panel app-daily-flip">
        <div class="df-coin-zone" data-bind="df-coin-zone"></div>
        <div class="df-modifier-meter-slot" data-bind="df-modifier-meter-slot"></div>
        <p class="df-reveal-hint" data-bind="df-reveal-hint" hidden>Click the coin to reveal</p>
        <p class="df-outcome" data-bind="df-outcome"></p>
        <div class="df-error" data-bind="df-error" hidden role="alert"></div>
        <div class="df-position" data-bind="df-position">
          <div class="df-position-slot" data-bind="df-position-today"></div>
          <div class="df-tomorrow-layout">
            <span class="df-flip-group df-next-bet" data-bind="df-add-bet-controls">
              <span class="df-next-bet__stepper">
                <input type="number" name="df-amount" class="df-amount" min="0" step="100" value="1000" aria-label="FLIP to add to tomorrow's bet">
                <span class="df-next-bet__arrows" aria-hidden="false">
                  <button type="button" data-bind="df-bet-up" aria-label="Increase bet by 100 FLIP">▲</button>
                  <button type="button" data-bind="df-bet-down" aria-label="Decrease bet by 100 FLIP">▼</button>
                </span>
                <boon-product-indicator class="df-boon-indicator"
                                        product="coinflip"></boon-product-indicator>
              </span>
              <button type="button" class="df-flip-cta" data-write data-bind="df-flip-cta" aria-label="Add bet" title="Bet 1k">ADD BET</button>
            </span>
            <div class="df-position-slot" data-bind="df-position-tomorrow"></div>
          </div>
        </div>
        <div class="df-funds" data-bind="df-funds">
          <div class="df-funds__display df-funds__display--claimable" data-bind="df-funds-claimable-box">
            <span class="df-funds__label">CLAIMABLE</span>
            <strong class="df-funds__value" data-bind="df-funds-claimable">—</strong>
            <button type="button" class="df-claim-flip-cta" data-write
                    data-bind="df-claim-flip-cta" disabled>CLAIM</button>
          </div>
          <div class="df-funds__display df-funds__display--wallet" data-bind="df-funds-wallet-box">
            <span class="df-funds__label">WALLET</span>
            <strong class="df-funds__value" data-bind="df-funds-wallet">—</strong>
          </div>
          <div class="df-funds__display df-funds__display--sdgnrs" data-bind="df-funds-sdgnrs-box">
            <span class="sdgnrs-badge df-sdgnrs-badge" aria-hidden="true">
              <img class="sdgnrs-badge__frame" src="/badges-circular/crypto_06_ethereum_purple.svg" alt="">
              <img class="sdgnrs-badge__mark" src="/specials/special_eth.svg" alt="">
            </span>
            <button type="button" class="df-burn-sdgnrs-cta" data-write data-write-locked
                    data-write-lock-title="sDGNRS balance is loading"
                    data-bind="df-burn-sdgnrs-cta" aria-haspopup="dialog">BURN</button>
            <span class="df-funds__label">sDGNRS</span>
            <strong class="df-funds__value" data-bind="df-funds-sdgnrs">—</strong>
          </div>
        </div>
        <div class="df-reverse-dialog df-burn-dialog" data-bind="df-burn-dialog" hidden
             role="dialog" aria-modal="true" aria-labelledby="df-burn-title">
          <div class="df-reverse-dialog__card df-burn-dialog__card">
            <button type="button" class="df-reverse-dialog__close" data-bind="df-burn-cancel"
                    aria-label="Close sDGNRS burn">×</button>
            <h3 id="df-burn-title">Burn sDGNRS</h3>
            <p class="df-reverse-dialog__copy">
              <span>Live-game burns settle on the next daily RNG at 25%–175% of the previewed ETH value.</span>
              <span>The payout normally splits between claimable ETH and a lootbox; FLIP backing pays only if the next flip wins.</span>
            </p>
            <label class="df-burn-dialog__amount">
              <span>Amount</span>
              <span class="df-burn-dialog__field">
                <input type="number" name="df-sdgnrs-amount" min="1" step="1" value="1"
                       inputmode="decimal" aria-label="sDGNRS to burn">
                <button type="button" data-bind="df-burn-max">MAX</button>
              </span>
            </label>
            <div class="df-burn-dialog__quote" data-bind="df-burn-quote">
              <span>Expected ETH value</span>
              <strong data-bind="df-burn-expected">—</strong>
              <small data-bind="df-burn-flip-expected"></small>
            </div>
            <div class="df-reverse-dialog__actions">
              <button type="button" class="df-reverse-dialog__later" data-bind="df-burn-cancel">Cancel</button>
              <button type="button" class="df-reverse-dialog__accept df-burn-dialog__accept"
                      data-write data-write-locked data-write-lock-title="Enter an sDGNRS amount"
                      data-bind="df-burn-accept">Burn</button>
            </div>
          </div>
        </div>
        <div class="df-reverse-dialog" data-bind="df-reverse-dialog" hidden
             role="dialog" aria-modal="true" aria-labelledby="df-reverse-title">
          <div class="df-reverse-dialog__card">
            <button type="button" class="df-reverse-dialog__close" data-bind="df-reverse-cancel"
                    aria-label="Close Reverse Flip explanation">×</button>
            <div class="df-reverse-dialog__visuals">
              <img class="df-reverse-dialog__mark" src="/shared/reverse-flip-card.svg" alt="">
              <div class="df-reverse-dialog__side">
                <span>Current side</span>
                <div class="df-reverse-dialog__side-face">
                  <img data-bind="df-reverse-side-img" alt="" hidden>
                </div>
              </div>
            </div>
            <h3 id="df-reverse-title">Reverse Flip</h3>
            <p class="df-reverse-dialog__copy">
              <span>${REVERSE_FLIP_HELP[0]}</span>
              <span>${REVERSE_FLIP_HELP[1]}</span>
            </p>
            <div class="df-reverse-dialog__price">
              <span>Current cost</span>
              <strong data-bind="df-reverse-cost">Loading…</strong>
            </div>
            <div class="df-reverse-dialog__actions">
              <button type="button" class="df-reverse-dialog__later" data-bind="df-reverse-cancel">Not now</button>
              <button type="button" class="df-reverse-dialog__accept" data-write
                      data-bind="df-reverse-accept" data-write-locked
                      data-write-lock-title="Reverse Flip price is loading">Accept</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  #render() {
    this.#renderCoin();
    this.#renderModifierMeter();
    this.#renderPosition();
    this.#renderFunds();
    this.#renderReverseFlip();
    this.#renderBetTooltip();
  }

  #formatFlipPrice(wei) {
    // Costs are shown as whole FLIP too. Round a fractional exact contract
    // quote up so the label never understates what the wallet will spend.
    const unit = 10n ** 18n;
    const raw = BigInt(wei || 0);
    const whole = raw > 0n ? (raw + unit - 1n) / unit : 0n;
    return whole.toLocaleString('en-US');
  }

  #renderBetTooltip() {
    const input = this.querySelector('[name="df-amount"]');
    const add = this.querySelector('[data-bind="df-flip-cta"]');
    if (!add) return;
    const abbreviated = compactBetAmount(input?.value ?? 0);
    add.title = `Bet ${abbreviated}`;
  }

  #stepBetAmount(direction) {
    const input = this.querySelector('[name="df-amount"]');
    if (!input) return;
    const current = Number(input.value);
    const step = Number(input.step || 100);
    const minimum = Number(input.min || 0);
    const next = Math.max(
      Number.isFinite(minimum) ? minimum : 0,
      (Number.isFinite(current) ? current : 0)
        + (Number(direction) < 0 ? -1 : 1) * (Number.isFinite(step) && step > 0 ? step : 100),
    );
    input.value = Number.isInteger(next)
      ? String(next)
      : String(Number(next.toFixed(6)));
    this.#renderBetTooltip();
  }

  #renderReverseFlip() {
    const card = this.querySelector('[data-bind="df-reverse-cta"]');
    const sideImg = this.querySelector('[data-bind="df-reverse-side-img"]');
    const cost = this.querySelector('[data-bind="df-reverse-cost"]');
    const accept = this.querySelector('[data-bind="df-reverse-accept"]');
    const quote = this.#reverseFlipQuote;
    if (card) card.hidden = Boolean(quote?.locked);
    card?.classList?.toggle('df-reversi-card--locked', Boolean(quote?.locked));
    if (!quote) {
      card?.classList?.remove('df-reversi-card--target-eth', 'df-reversi-card--target-wwxrp');
      card?.removeAttribute?.('data-reverse-target');
      if (sideImg) sideImg.hidden = true;
      if (card) card.title = 'Reverse Flip price is loading';
      if (cost) cost.textContent = 'Loading…';
      if (accept) {
        accept.textContent = 'Accept';
        accept.disabled = true;
        accept.setAttribute('data-write-locked', '');
        accept.setAttribute('data-write-lock-title', 'Reverse Flip price is loading');
      }
      return;
    }
    const odd = (quote.queued & 1n) === 1n;
    // The small card advertises the side this *next* reversal will create,
    // which is the opposite of the currently queued side shown in the dialog.
    const targetEth = !odd;
    if (card) {
      card.classList?.toggle('df-reversi-card--target-eth', targetEth);
      card.classList?.toggle('df-reversi-card--target-wwxrp', !targetEth);
      card.setAttribute('data-reverse-target', targetEth ? 'eth' : 'wwxrp');
      card.setAttribute('aria-label', `Explain Reverse Flip to ${targetEth ? 'ETH' : 'WWXRP'}`);
    }
    if (sideImg) {
      sideImg.src = odd
        ? '/shared/coinflip-face-eth.svg'
        : '/shared/coinflip-face-red.svg';
      sideImg.alt = odd ? 'ETH — odd side' : 'WWXRP — even side';
      sideImg.title = odd ? 'ETH (odd)' : 'WWXRP (even)';
      sideImg.hidden = false;
    }
    if (quote.locked) {
      if (card) card.title = 'The next RNG is already locked';
      if (cost) cost.textContent = 'RNG locked';
      if (accept) {
        accept.textContent = 'RNG locked';
        accept.disabled = true;
        accept.setAttribute('data-write-locked', '');
        accept.setAttribute('data-write-lock-title', 'The next RNG is already locked');
      }
      return;
    }
    const price = `${this.#formatFlipPrice(quote.costWei)} FLIP`;
    if (card) card.title = `Reverse Flip · ${price}`;
    if (cost) cost.textContent = price;
    if (accept) {
      accept.textContent = `Accept · ${price}`;
      accept.removeAttribute('data-write-locked');
      accept.removeAttribute('data-write-lock-title');
      accept.disabled = this.#busy;
    }
  }

  #openReverseDialog() {
    const dialog = this.querySelector('[data-bind="df-reverse-dialog"]');
    if (!dialog) return;
    this.#renderReverseFlip();
    dialog.hidden = false;
    const accept = this.querySelector('[data-bind="df-reverse-accept"]');
    try { accept?.focus?.(); } catch (_e) { /* headless / detached */ }
  }

  #closeReverseDialog() {
    const dialog = this.querySelector('[data-bind="df-reverse-dialog"]');
    if (dialog) dialog.hidden = true;
    if (this.#reverseFlipQuote) {
      this.#showLiveSideOnCoin = true;
      this.#renderCoin();
    }
    const card = this.querySelector('[data-bind="df-reverse-cta"]');
    try { card?.focus?.(); } catch (_e) { /* headless / detached */ }
  }

  #sdgnrsBalanceWei() {
    if (this.#dashboard?.sdgnrsBalance == null) return null;
    return this.#asWei(this.#dashboard.sdgnrsBalance);
  }

  #ownsDisplayedSdgnrs() {
    const connected = get('connected.address');
    return Boolean(connected && this.#dashboardAddress
      && String(connected).toLowerCase() === String(this.#dashboardAddress).toLowerCase());
  }

  #renderSdgnrsBurn() {
    const button = this.querySelector('[data-bind="df-burn-sdgnrs-cta"]');
    const accept = this.querySelector('[data-bind="df-burn-accept"]');
    const input = this.querySelector('[name="df-sdgnrs-amount"]');
    const balance = this.#sdgnrsBalanceWei();
    const ownsBalance = this.#ownsDisplayedSdgnrs();
    const hasMinimum = balance != null && balance >= MIN_SDGNRS_BURN_WEI;
    const amount = parseTokenAmount(input?.value);
    const validAmount = amount != null
      && amount >= MIN_SDGNRS_BURN_WEI
      && balance != null
      && amount <= balance;

    if (button) {
      const locked = this.#busy || !ownsBalance || !hasMinimum;
      button.disabled = locked;
      button.textContent = this.#busy ? 'WAIT' : 'BURN';
      if (locked) {
        const reason = this.#busy
          ? 'Transaction in progress'
          : !ownsBalance
            ? 'Open your own wallet view to burn sDGNRS'
            : 'Minimum burn is 1 sDGNRS';
        button.setAttribute('data-write-locked', '');
        button.setAttribute('data-write-lock-title', reason);
        button.title = reason;
      } else {
        button.removeAttribute('data-write-locked');
        button.removeAttribute('data-write-lock-title');
        button.removeAttribute('title');
      }
    }
    if (accept) {
      const locked = this.#busy || !ownsBalance || !validAmount;
      accept.disabled = locked;
      accept.textContent = this.#busy ? 'Burning…' : 'Burn';
      if (locked) {
        accept.setAttribute('data-write-locked', '');
        accept.setAttribute('data-write-lock-title', this.#busy
          ? 'Transaction in progress'
          : 'Enter an amount from 1 through your sDGNRS balance');
      } else {
        accept.removeAttribute('data-write-locked');
        accept.removeAttribute('data-write-lock-title');
      }
    }
  }

  #renderSdgnrsBurnQuote() {
    const expected = this.querySelector('[data-bind="df-burn-expected"]');
    const flip = this.querySelector('[data-bind="df-burn-flip-expected"]');
    if (!expected || !flip) return;
    const input = this.querySelector('[name="df-sdgnrs-amount"]');
    const amount = parseTokenAmount(input?.value);
    const sameAmount = amount != null && amount === this.#sdgnrsQuoteAmount;

    if (!sameAmount || amount < MIN_SDGNRS_BURN_WEI) {
      expected.textContent = '—';
      flip.textContent = 'Enter at least 1 sDGNRS';
      return;
    }
    if (this.#sdgnrsQuotePending) {
      expected.textContent = 'Calculating…';
      flip.textContent = '';
      return;
    }
    if (!this.#sdgnrsQuote) {
      expected.textContent = 'Unavailable';
      flip.textContent = 'The wallet preview could not be read';
      return;
    }

    const ethFixed = displayEth(this.#sdgnrsQuote.ethOut, 4);
    const eth = ethFixed.includes('.')
      ? ethFixed.replace(/0+$/, '').replace(/\.$/, '')
      : ethFixed;
    expected.textContent = `${eth} ETH`;
    flip.textContent = this.#sdgnrsQuote.flipOut > 0n
      ? `${this.#fmtWhole(this.#sdgnrsQuote.flipOut)} FLIP backing · pays only on a win`
      : 'No contingent FLIP backing';
  }

  #refreshSdgnrsBurnQuote() {
    const input = this.querySelector('[name="df-sdgnrs-amount"]');
    const amount = parseTokenAmount(input?.value);
    const balance = this.#sdgnrsBalanceWei();
    const valid = amount != null
      && amount >= MIN_SDGNRS_BURN_WEI
      && balance != null
      && amount <= balance;
    const seq = ++this.#sdgnrsQuoteSeq;
    this.#sdgnrsQuoteAmount = amount;
    this.#sdgnrsQuote = null;
    this.#sdgnrsQuotePending = valid;
    this.#renderSdgnrsBurnQuote();
    if (!valid) return;

    void previewSdgnrsBurn({ amount }).then((quote) => {
      if (!this.#active || seq !== this.#sdgnrsQuoteSeq) return;
      this.#sdgnrsQuote = quote;
      this.#sdgnrsQuotePending = false;
      this.#renderSdgnrsBurnQuote();
    }, () => {
      if (!this.#active || seq !== this.#sdgnrsQuoteSeq) return;
      this.#sdgnrsQuote = null;
      this.#sdgnrsQuotePending = false;
      this.#renderSdgnrsBurnQuote();
    });
  }

  #openSdgnrsBurnDialog() {
    if (!this.#ownsDisplayedSdgnrs()) return;
    const balance = this.#sdgnrsBalanceWei();
    if (balance == null || balance < MIN_SDGNRS_BURN_WEI) return;
    const dialog = this.querySelector('[data-bind="df-burn-dialog"]');
    if (!dialog) return;
    const input = this.querySelector('[name="df-sdgnrs-amount"]');
    if (input && (parseTokenAmount(input.value) ?? 0n) > balance) input.value = '1';
    dialog.hidden = false;
    this.#renderSdgnrsBurn();
    this.#refreshSdgnrsBurnQuote();
    try { input?.focus?.({ preventScroll: true }); } catch (_e) { /* headless */ }
  }

  #closeSdgnrsBurnDialog() {
    const dialog = this.querySelector('[data-bind="df-burn-dialog"]');
    if (dialog) dialog.hidden = true;
    const button = this.querySelector('[data-bind="df-burn-sdgnrs-cta"]');
    try { button?.focus?.(); } catch (_e) { /* headless */ }
  }

  #setMaxSdgnrsBurn() {
    const balance = this.#sdgnrsBalanceWei();
    const input = this.querySelector('[name="df-sdgnrs-amount"]');
    if (!input || balance == null) return;
    input.value = tokenAmountInput(balance);
    this.#renderSdgnrsBurn();
    this.#refreshSdgnrsBurnQuote();
  }

  #renderCoin() {
    const zone = this.querySelector('[data-bind="df-coin-zone"]');
    const outcome = this.querySelector('[data-bind="df-outcome"]');
    const revealHint = this.querySelector('[data-bind="df-reveal-hint"]');
    if (!zone) return;

    const hasResult = this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;

    // Mid-landing: the deceleration animation is running on the existing
    // DOM — do NOT rebuild the zone out from under it. (#onCoinClick
    // already hid the reveal button.)
    if (this.#landing) return;

    zone.textContent = '';
    // The coin itself is the reveal control; this is only its compact hint.
    if (revealHint) {
      revealHint.textContent = 'Click the coin to reveal';
      revealHint.hidden = !(hasResult && !this.#revealed());
    }

    if (!hasResult) {
      if (outcome) {
        outcome.textContent = this.#day == null
          ? 'Waiting for the first resolved day…'
          : `No coinflip result for day ${this.#day} yet.`;
      }
      return;
    }

    const won = Boolean(this.#flipResult.win);
    if (!this.#revealed()) {
      // CSS-3D two-faced coin: front = red WWXRP face, back = green ETH
      // face. Idles on a continuous rotateX loop; #onCoinClick swaps the
      // animation to a decelerating df-land-* that FINISHES on the day's
      // face (whole turns → red front; +half turn → ETH back).
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'df-coin df-coin--spinning';
      btn.setAttribute('aria-label', 'Reveal the daily coinflip result');
      const inner = document.createElement('span');
      inner.className = 'df-coin3d__inner';
      const faceRed = document.createElement('span');
      faceRed.className = 'df-coin3d__face df-coin3d__face--red';
      const redImg = document.createElement('img');
      redImg.src = '/shared/coinflip-face-red.svg';
      redImg.alt = '';
      faceRed.appendChild(redImg);
      inner.appendChild(faceRed);
      const faceEth = document.createElement('span');
      faceEth.className = 'df-coin3d__face df-coin3d__face--eth';
      const ethImg = document.createElement('img');
      ethImg.src = '/shared/coinflip-face-eth.svg';
      ethImg.alt = '';
      faceEth.appendChild(ethImg);
      inner.appendChild(faceEth);
      btn.appendChild(inner);
      btn.addEventListener('click', () => this.#onCoinClick());
      zone.appendChild(btn);
      if (outcome) {
        outcome.textContent = '';
        outcome.className = 'df-outcome';
      }
    } else {
      const showLiveSide = this.#showLiveSideOnCoin && this.#reverseFlipQuote != null;
      const faceIsEth = showLiveSide
        ? (this.#reverseFlipQuote.queued & 1n) === 1n
        : won;
      const face = document.createElement('div');
      face.className = 'df-coin df-coin--landed';
      if (showLiveSide) {
        face.classList.add('df-coin--current-side');
        face.setAttribute('data-current-side', faceIsEth ? 'eth' : 'wwxrp');
      }
      const img = document.createElement('img');
      img.src = faceIsEth ? '/shared/coinflip-face-eth.svg' : '/shared/coinflip-face-red.svg';
      img.alt = showLiveSide
        ? (faceIsEth ? 'Current side — ETH (odd)' : 'Current side — WWXRP (even)')
        : (won ? 'Green ETH face — win' : 'Red face — loss');
      face.appendChild(img);
      zone.appendChild(face);
      // Reverse Flip is a post-result move. Its card sits beside the landed
      // coin and only opens the explanation; the write is gated behind the
      // dialog's explicit Accept button.
      const reverse = document.createElement('button');
      reverse.type = 'button';
      reverse.className = 'df-reversi-card';
      reverse.setAttribute('data-bind', 'df-reverse-cta');
      reverse.setAttribute('aria-haspopup', 'dialog');
      reverse.setAttribute('aria-label', 'Explain Reverse Flip');
      const reverseArt = document.createElement('img');
      reverseArt.className = 'df-reversi-card__art';
      reverseArt.src = '/shared/reverse-flip-card.svg';
      reverseArt.alt = '';
      reverse.appendChild(reverseArt);
      reverse.addEventListener('click', () => this.#openReverseDialog());
      zone.appendChild(reverse);
      if (outcome) {
        // The resolved receipt now lives in Today's Bet for both outcomes.
        // Keep this line available only for transient/loading copy so a result
        // is never duplicated elsewhere in the widget.
        outcome.textContent = '';
        outcome.className = 'df-outcome';
      }
    }
  }

  #renderModifierMeter() {
    const host = this.querySelector('[data-bind="df-modifier-meter-slot"]');
    if (!host) return;
    host.textContent = '';

    const hasResult = this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;
    if (!hasResult) return;
    const won = Boolean(this.#flipResult.win);
    const revealComplete = this.#revealed() && !this.#landing;
    const stakeWei = this.#resultStakeWei();
    const hasStake = stakeWei != null && this.#asWei(stakeWei) > 0n;
    // A real rail begins after the authoritative win has landed. During a
    // reversal sequence, the scanner follows any apparent green face that has
    // another card pending; this does not reveal which face will be final.
    const showWinningMeter = won
      && hasStake
      && revealComplete
      && (this.#meterSettling || this.#meterFlashVisible);
    const showFakeoutMeter = hasStake
      && this.#landing
      && this.#fakeoutMeterVisible;
    if (!showWinningMeter && !showFakeoutMeter) return;

    const pct = Math.max(
      MODIFIER_MIN_PERCENT,
      Math.min(MODIFIER_MAX_PERCENT, Number(this.#flipResult.rewardPercent || 0)),
    );
    const position = ((pct - MODIFIER_MIN_PERCENT)
      / (MODIFIER_MAX_PERCENT - MODIFIER_MIN_PERCENT)) * 100;
    const totalPct = 100 + pct;

    if (showWinningMeter && this.#meterFlashVisible) {
      const flash = document.createElement('div');
      flash.className = 'df-modifier-flash';
      flash.textContent = `${totalPct}%`;
      flash.setAttribute('role', 'status');
      flash.setAttribute('aria-label', `${totalPct} percent total win multiplier`);
      host.appendChild(flash);
      return;
    }

    const meter = document.createElement('div');
    meter.className = this.#landing
      ? `df-modifier-meter ${this.#fakeoutMeterRebounding
        ? 'df-modifier-meter--rebounding'
        : this.#fakeoutMeterTerminalDraining
          ? 'df-modifier-meter--terminal-draining'
          : this.#fakeoutMeterDraining
          ? 'df-modifier-meter--draining'
          : 'df-modifier-meter--settled df-modifier-meter--settling'}`
      : `df-modifier-meter df-modifier-meter--settled${
        this.#meterSettling
          ? (this.#meterRecoveryTail
            ? ' df-modifier-meter--recovery-tail'
            : ' df-modifier-meter--settling')
          : ''
      }`;
    if (meter.style && typeof meter.style.setProperty === 'function') {
      meter.style.setProperty('--df-meter-rebound-duration', `${METER_REBOUND_MS}ms`);
      meter.style.setProperty('--df-meter-recovery-tail-duration', `${METER_RECOVERY_TAIL_MS}ms`);
      meter.style.setProperty('--df-meter-terminal-drain-duration', `${METER_TERMINAL_DRAIN_MS}ms`);
    }
    meter.setAttribute('role', 'img');
    meter.setAttribute(
      'aria-label',
      this.#landing
        ? (this.#fakeoutMeterRebounding
          ? `Win multiplier rebounding from minimum to ${totalPct} percent`
          : this.#fakeoutMeterDraining
            ? 'Win multiplier falling to minimum'
            : `Win multiplier stopped at ${totalPct} percent`)
        : (this.#meterRecoveryTail
          ? `Win multiplier recovering to ${totalPct} percent`
          : `Win multiplier stopped at ${totalPct} percent`),
    );

    const scale = document.createElement('div');
    scale.className = 'df-modifier-meter__scale';
    for (const labelText of ['256%', '200%', '150%']) {
      const label = document.createElement('span');
      label.textContent = labelText;
      scale.appendChild(label);
    }
    meter.appendChild(scale);

    const track = document.createElement('div');
    track.className = 'df-modifier-meter__track';
    const marker = document.createElement('span');
    marker.className = 'df-modifier-meter__marker';
    marker.setAttribute('data-bind', 'df-modifier-marker');
    marker.style.bottom = `${position}%`;
    if (marker.style && typeof marker.style.setProperty === 'function') {
      marker.style.setProperty('--df-meter-stop', `${position}%`);
    }
    track.appendChild(marker);
    meter.appendChild(track);

    const readout = document.createElement('div');
    readout.className = 'df-modifier-meter__readout';
    readout.textContent = this.#landing
      ? (this.#fakeoutMeterDraining ? '150%' : `${totalPct}%`)
      : `${totalPct}%`;
    meter.appendChild(readout);
    host.appendChild(meter);
  }

  // Whole-FLIP with thousands separators (mirrors app-balances-strip).
  #fmtWhole(weiStr) {
    const whole = displayToken(BigInt(weiStr || '0'), 0);
    const n = Number(whole);
    return Number.isSafeInteger(n) ? n.toLocaleString('en-US') : whole;
  }

  #fmtSdgnrs(weiStr) {
    const whole = BigInt(weiStr || '0') / (10n ** 18n);
    if (whole < 1_000_000n) return whole.toLocaleString('en-US');
    const millions = (whole + 500_000n) / 1_000_000n;
    return `${millions.toLocaleString('en-US')}M`;
  }

  #asWei(value) {
    try { return BigInt(value || '0'); } catch (_e) { return 0n; }
  }

  #activeSettlement() {
    const state = this.#settlementState;
    if (!state || String(state.day) !== String(this.#day)) return null;
    if (state.address && state.address !== this.#dashboardAddress) return null;
    return state;
  }

  #resultStakeWei() {
    const settlement = this.#activeSettlement();
    return settlement?.betWei
      ?? this.#resolvedBetWei
      ?? null;
  }

  #winPayoutWei(stakeWei, rewardPercent) {
    const stake = this.#asWei(stakeWei);
    const pct = BigInt(Math.max(0, Math.trunc(Number(rewardPercent) || 0)));
    return stake + ((stake * pct) / 100n);
  }

  #settlementGainWei(settlement) {
    if (!settlement?.won) return 0n;
    const pct = this.#flipResult?.rewardPercent ?? settlement.rewardPercent;
    return this.#winPayoutWei(settlement.betWei, pct);
  }

  #visibleClaimableWei() {
    const indexed = this.#asWei(this.#dashboard?.coinflip?.claimablePreview);
    const settlement = this.#activeSettlement();
    let visible = this.#liveClaimableWei == null ? indexed : this.#liveClaimableWei;
    if (!settlement) return visible;
    const settledTotal = settlement.claimableTotalWei == null
      ? settlement.claimableBaseWei + this.#settlementGainWei(settlement)
      : this.#asWei(settlement.claimableTotalWei);
    if (indexed > visible) visible = indexed;
    return settledTotal > visible ? settledTotal : visible;
  }

  #renderPosition() {
    const host = this.querySelector('[data-bind="df-position"]');
    if (!host) return;
    // Keep both day buckets mounted so a result never replaces one amount with
    // a different day's amount. Today becomes the one resolved receipt;
    // the live next-day stake remains safe to show beside its Add Bet controls.
    const hasResult = this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;
    const revealComplete = hasResult && this.#revealed() && !this.#landing;
    const resolvedStake = this.#resultStakeWei();
    const won = Boolean(this.#flipResult?.win);
    const modifier = Math.max(0, Math.trunc(Number(this.#flipResult?.rewardPercent) || 0));
    // A resolved zero-stake day has no economic win or loss. Keep that receipt
    // identical for either protocol outcome so a lucky global flip cannot read
    // as a personal payout when this player did not participate.
    const noBet = revealComplete
      && resolvedStake != null
      && this.#asWei(resolvedStake) === 0n;
    const rows = [
      {
        key: 'today',
        label: "Today's bet",
        value: resolvedStake == null
          ? '—'
          : revealComplete
            ? noBet
              ? 'NO BET'
              : won
                ? `WIN +${this.#fmtWhole(this.#winPayoutWei(resolvedStake, modifier))} FLIP`
                : `LOSS -${this.#fmtWhole(resolvedStake)} FLIP`
            : '•••• FLIP',
        modifier: resolvedStake == null || !revealComplete || !won || noBet
          ? null
          : `${100 + modifier}%`,
        outcome: revealComplete ? (noBet ? 'no-bet' : (won ? 'win' : 'loss')) : null,
        spoiler: !revealComplete,
      },
      {
        key: 'tomorrow',
        label: "Tomorrow's bet",
        value: this.#currentBetWei == null ? '—' : `${this.#fmtWhole(this.#currentBetWei)} FLIP`,
        spoiler: false,
      },
    ];
    for (const item of rows) {
      const slot = this.querySelector(`[data-bind="df-position-${item.key}"]`);
      if (!slot) continue;
      slot.textContent = '';
      const row = document.createElement('div');
      row.className = [
        'df-position-row',
        item.spoiler ? 'df-position-row--spoiler' : '',
        item.outcome ? `df-position-row--${item.outcome}` : '',
      ].filter(Boolean).join(' ');
      row.setAttribute('data-position', item.key);
      const l = document.createElement('span');
      l.className = 'df-position-label';
      l.textContent = item.label;
      // Every red ledger instrument uses the same hierarchy: title directly
      // above its right-aligned FLIP figure. The add controls remain a separate
      // compact lane inside Tomorrow's Bet.
      row.appendChild(l);
      if (item.modifier != null) {
        const multi = document.createElement('span');
        multi.className = 'df-position-multiplier';
        multi.textContent = item.modifier;
        row.appendChild(multi);
      }
      const result = document.createElement('span');
      result.className = 'df-position-result';
      const v = document.createElement('span');
      v.className = `df-position-value${item.outcome ? ` df-position-value--${item.outcome}` : ''}`;
      v.textContent = item.value;
      result.appendChild(v);
      if (item.spoiler) result.setAttribute('aria-hidden', 'true');
      row.appendChild(result);
      slot.appendChild(row);
    }
  }

  #renderFunds() {
    const wallet = this.querySelector('[data-bind="df-funds-wallet"]');
    const walletBox = this.querySelector('[data-bind="df-funds-wallet-box"]');
    const claimable = this.querySelector('[data-bind="df-funds-claimable"]');
    const claimBox = this.querySelector('[data-bind="df-funds-claimable-box"]');
    const claim = this.querySelector('[data-bind="df-claim-flip-cta"]');
    const sdgnrs = this.querySelector('[data-bind="df-funds-sdgnrs"]');
    const sdgnrsBox = this.querySelector('[data-bind="df-funds-sdgnrs-box"]');
    const visibleClaimable = this.#visibleClaimableWei();
    const walletRaw = this.#dashboard?.flipBalance;
    const hasResult = this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;
    const revealComplete = hasResult && this.#revealed() && !this.#landing;
    updateBalanceDisplay(wallet, {
      container: walletBox,
      scope: this.#dashboardAddress,
      value: walletRaw,
      format: (raw) => `${this.#fmtWhole(raw)} FLIP`,
      formatDelta: (delta) => `+${this.#fmtWhole(delta)} FLIP`,
    });
    if (claimable) {
      updateBalanceDisplay(claimable, {
        container: claimBox,
        scope: this.#dashboardAddress,
        value: this.#dashboard == null ? null : visibleClaimable,
        visible: revealComplete,
        format: (raw) => `${this.#fmtWhole(raw)} FLIP`,
        formatDelta: (delta) => `+${this.#fmtWhole(delta)} FLIP`,
        hiddenText: '•••• FLIP',
      });
      if (revealComplete) claimable.removeAttribute('aria-hidden');
      else claimable.setAttribute('aria-hidden', 'true');
    }
    claimBox?.classList?.toggle('df-funds__display--spoiler', !revealComplete);
    claimBox?.classList?.toggle('has-claimable', revealComplete && visibleClaimable > 0n);
    if (claim) {
      claim.disabled = !revealComplete || this.#busy || visibleClaimable <= 0n || !get('connected.address');
      claim.textContent = this.#busy ? 'WAIT' : 'CLAIM';
    }
    updateBalanceDisplay(sdgnrs, {
      container: sdgnrsBox,
      scope: this.#dashboardAddress,
      value: this.#dashboard == null ? null : this.#dashboard.sdgnrsBalance,
      format: (raw) => `${this.#fmtSdgnrs(raw)} sDGNRS`,
      formatDelta: (delta) => `+${this.#fmtSdgnrs(delta)} sDGNRS`,
    });
    this.#renderSdgnrsBurn();
  }

  #reducedMotion() {
    try {
      return typeof matchMedia !== 'function'
        || matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_e) {
      return true;
    }
  }

  #mountFakeoutReverseCards(revealPlan, won) {
    const reversalCount = Math.max(0, Math.trunc(Number(revealPlan?.reversalCount) || 0));
    if (reversalCount === 0) return;
    const zone = this.querySelector('[data-bind="df-coin-zone"]');
    if (!zone) return;

    for (let index = 1; index <= reversalCount; index += 1) {
      const remainingReversals = reversalCount - index;
      const targetWon = remainingReversals % 2 === 0 ? Boolean(won) : !Boolean(won);
      const target = targetWon ? 'eth' : 'wwxrp';
      const card = document.createElement('span');
      card.className = `df-fakeout-reverse-card df-fakeout-reverse-card--to-${target}`;
      card.setAttribute('data-bind', 'df-fakeout-reverse-card');
      card.setAttribute('data-fakeout-target', target);
      card.setAttribute('data-reversal-index', String(index));
      card.setAttribute('aria-hidden', 'true');
      if (card.style && typeof card.style.setProperty === 'function') {
        const delay = revealPlan.trackMs
          + revealPlan.openingMs
          + ((index - 1) * REVERSE_CARD_STAGGER_MS);
        card.style.setProperty('--df-fakeout-delay', `${delay}ms`);
        card.style.setProperty('--df-fakeout-duration', `${REVERSE_CARD_ANIMATION_MS}ms`);
      }

      const art = document.createElement('img');
      art.className = 'df-fakeout-reverse-card__art';
      art.src = '/shared/reverse-flip-card.svg';
      art.alt = '';
      card.appendChild(art);
      zone.appendChild(card);
    }
  }

  #onCoinClick() {
    if (this.#landing || this.#revealed()) return;
    // Stale-DOM guard (codex finding): a click on a coin rendered for a
    // PREVIOUS day must not mark the new day revealed. Only act when the
    // fetched result belongs to the current day.
    if (this.#day == null || this.#flipFetchedDay !== this.#day || this.#flipResult == null) return;
    const revealDay = this.#day;
    const viewedAddress = this.#viewedAddress();
    const revealAddress = this.#dashboardAddress
      || (viewedAddress == null ? null : String(viewedAddress).toLowerCase());
    // Never substitute the dashboard's newest stake here: once a new target
    // day has started it may already be tomorrow's unresolved total. The exact
    // resolved-day cumulative credit is the only valid reveal basis.
    if (this.#resolvedBetWei == null) {
      this.#renderError("Today's credited bet is still loading. Try again in a moment.");
      this.#scheduleRefresh();
      return;
    }
    const settledBet = this.#resolvedBetWei;
    const won = Boolean(this.#flipResult.win);
    const revealPlan = selectFlipRevealPlan(revealDay, won);
    const rewardPercent = Number(this.#flipResult.rewardPercent || 0);
    const settlementState = {
      day: revealDay,
      address: revealAddress,
      betWei: settledBet,
      claimableBaseWei: this.#asWei(this.#dashboard?.coinflip?.claimablePreview),
      claimableTotalWei: this.#liveClaimableWei,
      rewardPercent,
      won,
    };
    const reducedMotion = this.#reducedMotion();
    this.#markRevealed();
    const finish = () => {
      this.#revealTimer = null;
      this.#clearFakeoutMeter();
      this.#landing = false;
      const stillCurrent = this.#day === revealDay;
      this.#clearModifierMeter();
      this.#meterRecoveryTail = stillCurrent
        && won
        && revealPlan.reversalCount >= 2
        && this.#asWei(settledBet) > 0n
        && !reducedMotion;
      this.#meterSettling = stillCurrent
        && won
        && this.#asWei(settledBet) > 0n
        && !reducedMotion;
      if (stillCurrent) {
        // Production normally has the direct chain total already. If that read
        // was temporarily unavailable, preserve the old optimistic fallback
        // until the post-landing refresh obtains the exact contract value.
        if (settlementState.claimableTotalWei == null) {
          settlementState.claimableTotalWei = settlementState.claimableBaseWei
            + this.#settlementGainWei(settlementState);
        }
        this.#settlementState = settlementState;
        this.#saveSettlement(settlementState);
      }
      this.#render();
      if (this.#meterSettling && typeof setTimeout === 'function') {
        if (this.#meterTimer != null) {
          try { clearTimeout(this.#meterTimer); } catch (_) { /* defensive */ }
        }
        this.#meterTimer = setTimeout(() => {
          this.#meterSettling = false;
          this.#meterRecoveryTail = false;
          this.#meterFlashVisible = true;
          this.#renderModifierMeter();
          this.#meterTimer = setTimeout(() => {
            this.#meterTimer = null;
            this.#meterFlashVisible = false;
            this.#renderModifierMeter();
          }, METER_FLASH_MS);
          if (this.#meterTimer && typeof this.#meterTimer.unref === 'function') {
            try { this.#meterTimer.unref(); } catch (_) { /* defensive */ }
          }
        }, METER_SETTLE_MS);
        if (this.#meterTimer && typeof this.#meterTimer.unref === 'function') {
          try { this.#meterTimer.unref(); } catch (_) { /* defensive */ }
        }
      }
      try {
        const ev = (typeof CustomEvent === 'function')
          ? new CustomEvent('flip:revealed', { detail: { day: revealDay } })
          : { type: 'flip:revealed', detail: { day: revealDay } };
        document.dispatchEvent(ev);
      } catch (_e) { /* headless — best-effort */ }
      // The reveal is presentation-only, but it is the point at which the
      // previously hidden claimable ledger becomes visible. Refresh the live
      // contract value on that frame instead of waiting up to 30 seconds for
      // the indexed dashboard poll.
      if (stillCurrent) this.#scheduleRefresh();
    };
    if (reducedMotion || typeof setTimeout !== 'function') {
      finish();
      return;
    }
    // Swap the idle loop for the day's deterministic motion track + ending.
    // All eight possible endings begin only after the profile's identical
    // 3.3-second track frame. Every Reverse card toggles the visible face;
    // rare two- and three-card endings keep alternating until the last tap
    // lands on the authoritative protocol result.
    // #renderCoin leaves this DOM intact while #landing.
    this.#landing = true;
    this.#clearFakeoutMeter();
    const revealHint = this.querySelector('[data-bind="df-reveal-hint"]');
    if (revealHint) revealHint.hidden = true;
    const inner = this.querySelector('.df-coin3d__inner');
    if (inner && inner.classList) {
      inner.classList.add(
        'df-reveal-active',
        `df-reveal-track--${revealPlan.profile}`,
        `df-reveal-bias--${revealPlan.bias}`,
        `df-reveal-ending--${revealPlan.ending}`,
      );
      inner.setAttribute('data-reveal-profile', revealPlan.profile);
      inner.setAttribute('data-reveal-win-rate', String(revealPlan.winRate));
      inner.setAttribute('data-reveal-ending', revealPlan.ending);
      if (inner.style && typeof inner.style.setProperty === 'function') {
        inner.style.setProperty('--df-track-duration', `${revealPlan.trackMs}ms`);
        inner.style.setProperty('--df-ending-duration', `${revealPlan.endingMs}ms`);
      }
    }
    this.#mountFakeoutReverseCards(revealPlan, won);
    this.#scheduleApparentWinMeters(revealDay, revealPlan, won);
    this.#renderModifierMeter();
    const outcome = this.querySelector('[data-bind="df-outcome"]');
    if (outcome) outcome.textContent = '';
    const h = setTimeout(finish, revealPlan.totalMs);
    this.#revealTimer = h;
    if (h && typeof h.unref === 'function') {
      try { h.unref(); } catch (_) { /* defensive */ }
    }
  }

  // ---------------------------------------------------------------------
  // Actions.
  // ---------------------------------------------------------------------

  #wireActions() {
    const flip = this.querySelector('[data-bind="df-flip-cta"]');
    if (flip) flip.addEventListener('click', () => this.#runAction('flip'));
    const amount = this.querySelector('[name="df-amount"]');
    if (amount) amount.addEventListener('input', () => this.#renderBetTooltip());
    const betUp = this.querySelector('[data-bind="df-bet-up"]');
    if (betUp) betUp.addEventListener('click', () => this.#stepBetAmount(1));
    const betDown = this.querySelector('[data-bind="df-bet-down"]');
    if (betDown) betDown.addEventListener('click', () => this.#stepBetAmount(-1));
    const claim = this.querySelector('[data-bind="df-claim-flip-cta"]');
    if (claim) claim.addEventListener('click', () => this.#runAction('claim-flip'));
    const burn = this.querySelector('[data-bind="df-burn-sdgnrs-cta"]');
    if (burn) burn.addEventListener('click', () => this.#openSdgnrsBurnDialog());
    const burnInput = this.querySelector('[name="df-sdgnrs-amount"]');
    if (burnInput) burnInput.addEventListener('input', () => {
      this.#renderSdgnrsBurn();
      this.#refreshSdgnrsBurnQuote();
    });
    const burnMax = this.querySelector('[data-bind="df-burn-max"]');
    if (burnMax) burnMax.addEventListener('click', () => this.#setMaxSdgnrsBurn());
    const burnAccept = this.querySelector('[data-bind="df-burn-accept"]');
    if (burnAccept) burnAccept.addEventListener('click', () => this.#runAction('burn-sdgnrs'));
    for (const cancel of this.querySelectorAll('[data-bind="df-burn-cancel"]')) {
      cancel.addEventListener('click', () => this.#closeSdgnrsBurnDialog());
    }
    const burnDialog = this.querySelector('[data-bind="df-burn-dialog"]');
    if (burnDialog) {
      burnDialog.addEventListener('keydown', (event) => {
        if (event?.key === 'Escape') this.#closeSdgnrsBurnDialog();
      });
      burnDialog.addEventListener('click', (event) => {
        if (event?.target === burnDialog) this.#closeSdgnrsBurnDialog();
      });
    }
    const accept = this.querySelector('[data-bind="df-reverse-accept"]');
    if (accept) accept.addEventListener('click', () => this.#runAction('reverse'));
    for (const cancel of this.querySelectorAll('[data-bind="df-reverse-cancel"]')) {
      cancel.addEventListener('click', () => this.#closeReverseDialog());
    }
    const dialog = this.querySelector('[data-bind="df-reverse-dialog"]');
    if (dialog) {
      dialog.addEventListener('keydown', (event) => {
        if (event?.key === 'Escape') this.#closeReverseDialog();
      });
      dialog.addEventListener('click', (event) => {
        if (event?.target === dialog) this.#closeReverseDialog();
      });
    }
  }

  // Quest cards are shortcuts into the existing form, never transaction
  // triggers. Token-amount quest targets are projected by the API/UI in
  // ordinary 18-decimal FLIP wei, so preserve the exact amount in the input.
  #wireQuestPreset() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#questActivateListener = (event) => {
      if (Number(event?.detail?.questType) !== 2) return;
      const input = this.querySelector('[name="df-amount"]');
      if (!input) return;
      let targetWei;
      try { targetWei = BigInt(event?.detail?.target ?? 0); }
      catch (_e) { targetWei = 0n; }
      if (targetWei <= 0n) targetWei = 2_000n * (10n ** 18n);
      const unit = 10n ** 18n;
      const whole = targetWei / unit;
      const fraction = String(targetWei % unit).padStart(18, '0').replace(/0+$/, '');
      input.value = fraction ? `${whole}.${fraction}` : String(whole);
      try { input.dispatchEvent(new Event('input', { bubbles: true })); }
      catch (_e) { try { input.dispatchEvent({ type: 'input', bubbles: true }); } catch (_e2) {} }
      try { this.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_e) {}
      try { input.focus?.({ preventScroll: true }); } catch (_e) {}
    };
    document.addEventListener('quest:activate', this.#questActivateListener);
  }

  async #runAction(kind) {
    if (this.#busy) return;
    this.#busy = true;
    this.#renderFunds();
    this.#clearError();
    this.#setStatus('');
    try {
      const player = get('connected.address');
      if (!player) throw new Error('Connect a wallet first.');
      if (kind === 'flip') {
        const input = this.querySelector('[name="df-amount"]');
        const amountFloat = Number(input ? input.value : '0');
        if (!Number.isFinite(amountFloat) || amountFloat <= 0) {
          throw new Error('Stake must be greater than 0 FLIP.');
        }
        // FLIP is UNSCALED 18-dec on every chain (only ETH /1M-scales).
        const amount = BigInt(Math.round(amountFloat * 1e6)) * (10n ** 12n);
        // The stake is burned from the WALLET (FLIP.burnForCoinflip does not
        // touch claimable), so a short wallet claims the gap first — two
        // signatures, narrated so the second one is not a surprise.
        const { claimed } = await depositCoinflip({
          player,
          amount,
          onStep: ({ kind, amount: stepAmount }) => {
            if (kind === 'claiming') {
              this.#setStatus(`Claiming ${this.#fmtWhole(String(stepAmount))} FLIP from your winnings first…`);
            } else {
              this.#setStatus('Placing your stake…');
            }
          },
        });
        this.#setStatus(claimed > 0n
          ? `Staked. ${this.#fmtWhole(String(claimed))} FLIP came from your winnings.`
          : '');
      } else if (kind === 'claim-flip') {
        // Coinflip FLIP winnings — amount from the dashboard's
        // claimablePreview plus any just-landed win that the next dashboard
        // refresh has not absorbed yet.
        const amount = this.#visibleClaimableWei();
        if (amount <= 0n) throw new Error('Nothing to claim.');
        await claimFlip({ player, amount });
      } else if (kind === 'burn-sdgnrs') {
        const input = this.querySelector('[name="df-sdgnrs-amount"]');
        const amount = parseTokenAmount(input?.value);
        const balance = this.#sdgnrsBalanceWei();
        if (amount == null || amount < MIN_SDGNRS_BURN_WEI) {
          throw new Error('Minimum burn is 1 sDGNRS.');
        }
        if (balance == null || amount > balance) {
          throw new Error('Not enough sDGNRS for that burn.');
        }
        await burnSdgnrs({ amount });
        this.#closeSdgnrsBurnDialog();
      } else if (kind === 'reverse') {
        const quote = this.#reverseFlipQuote;
        if (!quote) throw new Error('Reverse Flip price is still loading.');
        if (quote.locked) {
          throw new Error('RNG is locked while the next result is settling.');
        }
        this.#setStatus(`Reversing for ${this.#formatFlipPrice(quote.costWei)} FLIP…`);
        await reverseFlip();
        const queued = quote.queued + 1n;
        this.#reverseFlipQuote = {
          queued,
          costWei: reverseFlipCostWei(queued),
          locked: false,
        };
        this.#showLiveSideOnCoin = true;
        this.#closeReverseDialog();
        // Closing rebuilds the landed coin + card. Style that fresh card from
        // the incremented parity so both the coin face and reversal target
        // change immediately on confirmation.
        this.#renderReverseFlip();
        this.#setStatus('Next flip outcome reversed.');
      }
      setTimeout(() => this.#scheduleRefresh(), 250);
    } catch (error) {
      this.#setStatus('');
      this.#renderError(compactUiError(error));
    } finally {
      setTimeout(() => {
        this.#busy = false;
        this.#renderFunds();
        this.#renderReverseFlip();
      }, 500);
    }
  }

  // A one-line progress/receipt note for the multi-step flip. Distinct from
  // #renderError: this is not a failure, and it must not look like one.
  #setStatus(msg) {
    // Transaction state is already reflected by disabled controls and the
    // wallet flow. Keep the compact coinflip surface free of receipt chatter.
    void msg;
  }

  #renderError(msg) {
    const errEl = this.querySelector('[data-bind="df-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
    }
    this.#errorTimer = setTimeout(() => this.#clearError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimer && typeof this.#errorTimer.unref === 'function') {
      try { this.#errorTimer.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearError() {
    const errEl = this.querySelector('[data-bind="df-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
      this.#errorTimer = null;
    }
  }
}

// Idempotency-guarded register (Phase 58 pattern).
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-daily-flip')) {
    customElements.define('app-daily-flip', AppDailyFlip);
  }
}

export {
  AppDailyFlip,
  FLIP_REVEAL_PROFILES,
  REVEAL_TRACK_MS,
  REVEAL_END_MS,
  REVEAL_BIASED_END_MS,
  REVEAL_FAKE_END_MS,
  REVEAL_DOUBLE_END_MS,
  REVEAL_TRIPLE_END_MS,
  selectFlipRevealPlan,
};
