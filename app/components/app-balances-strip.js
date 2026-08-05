// /app/components/app-balances-strip.js — Phase 64 follow-up (user ask).
//
// Top-of-page balances strip. The numbers are FUZZED (CSS blur via the
// `abs-strip--fuzzed` host class) until the player reveals the pinned day's
// pending outcomes — balances spoil results (FLIP jumping = coinflip won,
// claimable ETH = jackpot hit), so they stay unreadable until:
//
//   gate 1 — jackpot scratch:  localStorage `spun_day_${CHAIN.id}_${day}`
//            (written by last-day-jackpot on replay:scratch-complete);
//   gate 2 — daily coinflip:   localStorage `flip_day_${CHAIN.id}_${day}`
//            (written by the app-daily-flip widget beside the jackpot when
//            the player reveals the coin — it dispatches 'flip:revealed').
//            A day with no coinflip result row waives gate 2.
//
// Degenerette bets resolve by explicit player tx (not a daily reveal), so
// they don't participate in the fuzz gate.
//
// Tiles (all viewed-player, from /player/:address):
//   WINNINGS  claimableEth  — displayEth (testnet /1M re-scale)
//   FLIP      flipBalance   — displayToken (UNSCALED 18-dec)
//   TICKETS   Σ tickets[].entryCount / 4 — entryCount is an ENTRY count
//             (4 entries = 1 ticket; play/components/tickets-panel.js:121-133)
//   DGNRS     dgnrsBalance  — displayToken
// The /game/coinflip/day/:day fetch is kept ONLY for the gate-waive rule —
// the coin reveal itself lives in app-daily-flip (user call: "its own thing
// next to the jackpot draw rather than in the top bar").
//
// T-58-18 discipline: ALL server-derived strings via textContent.

import { CHAIN } from '../app/chain-config.js';
import { displayEth, displayToken } from '../app/scaling.js';
import { getViewedAddress, get, subscribe } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
// Inline ETH-winnings claim (user call: the big claims banner is gone; the
// Winnings tile carries the claim instead).
import { claimEth } from '../app/claims.js';

const ENTRIES_PER_TICKET = 4;

function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

class AppBalancesStrip extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #dashboard = null;       // /player/:address payload
  #flipResult = null;      // /game/coinflip/day/:day payload (null = no row)
  #flipFetchedDay = null;  // day the flip result was fetched for
  #day = null;             // latest resolved day (store app.lastDay)
  #address = null;
  #dashboardAddr = null;   // address the cached dashboard belongs to
  #pollHandle = null;
  #fetchSeq = 0;           // stale-response guard
  #claimBusy = false;
  #storageListener = null;
  #revealListener = null;
  // Account-switcher (2026-07-16) — mode 'combined' renders from the merged
  // app.playerCombined payload instead of a single-address /player fetch.
  #combined = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();

    // Day pin — polling.js writes app.lastDay. On a NEW day, re-render
    // IMMEDIATELY (the gates are day-scoped, so the fuzz must snap back
    // before the async refresh lands — codex finding), then refresh.
    this.#unsubs.push(subscribe('app.lastDay', (payload) => {
      if (!payload || payload.day == null) return;
      const payloadDay = Number(payload.day);
      if (!Number.isInteger(payloadDay) || payloadDay <= 0) return;
      const directDay = Number(get('app.daySync')?.day);
      // Once the direct chain clock has crossed the boundary, the indexed
      // last-day poll can briefly publish N-1 again. Never let that stale
      // payload restore yesterday's reveal keys and unblur spoiled values.
      if (Number.isInteger(directDay) && directDay > 0 && payloadDay !== directDay) return;
      if (payloadDay !== Number(this.#day)) {
        this.#day = payloadDay;
        this.#flipResult = null;
        this.#flipFetchedDay = null;
        this.#render();
        this.#refresh();
      }
    }));
    // app.lastDay is rich but indexed. GAME.currentDayView moves first, and
    // balance deltas can spoil both draws during that catch-up gap. Re-pin the
    // day-scoped keys from the direct clock so the strip re-fuzzes on the
    // actual boundary.
    this.#unsubs.push(subscribe('app.daySync', (sync) => {
      const day = Number(sync?.day);
      if (!Number.isInteger(day) || day <= 0 || day === Number(this.#day)) return;
      this.#day = day;
      this.#flipResult = null;
      this.#flipFetchedDay = null;
      this.#render();
      this.#refresh();
    }));
    this.#unsubs.push(subscribe('connected.address', () => this.#refresh()));
    this.#unsubs.push(subscribe('viewing.address', () => this.#refresh()));
    // Account-switcher (2026-07-16): mode flips trigger an immediate re-render
    // (switching combined ↔ single-address changes the data source, not just
    // the target address). app.playerCombined is written by polling.js's
    // combined-mode cycle — re-render on every update while combined.
    this.#unsubs.push(subscribe('ui.mode', () => this.#refresh()));
    this.#unsubs.push(subscribe('app.playerCombined', (payload) => {
      this.#combined = payload;
      if (get('ui.mode') === 'combined') this.#render();
    }));

    // Same-tab reveals — last-day-jackpot dispatches 'jackpot:revealed' after
    // the scratch completes; app-daily-flip dispatches 'flip:revealed' when
    // the coin lands. Either flips a gate key → re-evaluate the fuzz.
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.#revealListener = () => this.#render();
      document.addEventListener('jackpot:revealed', this.#revealListener);
      document.addEventListener('flip:revealed', this.#revealListener);
    }
    // Cross-tab reveals (storage events don't fire same-tab).
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const prefix = `_day_${CHAIN.id}_`;  // matches both spun_day_* and flip_day_*
      this.#storageListener = (e) => {
        if (!e || typeof e.key !== 'string') return;
        if (e.key.includes(prefix)) this.#render();
      };
      window.addEventListener('storage', this.#storageListener);
    }

    if (typeof setInterval === 'function') {
      this.#pollHandle = _setIntervalUnref(() => this.#refresh(), 30_000);
    }
    this.#refresh();
  }

  disconnectedCallback() {
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#revealListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try {
        document.removeEventListener('jackpot:revealed', this.#revealListener);
        document.removeEventListener('flip:revealed', this.#revealListener);
      } catch (_) { /* defensive */ }
    }
    this.#revealListener = null;
    if (this.#storageListener
      && typeof window !== 'undefined'
      && typeof window.removeEventListener === 'function') {
      try { window.removeEventListener('storage', this.#storageListener); }
      catch (_) { /* defensive */ }
    }
    this.#storageListener = null;
  }

  // ---------------------------------------------------------------------
  // Gates — chainId + day scoped localStorage keys (claims-panel pattern;
  // SecurityError fail-safe: stay fuzzed, don't spoil).
  // ---------------------------------------------------------------------

  #readKey(name) {
    if (this.#day == null) return true;  // nothing resolved yet — no spoiler
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(`${name}_${CHAIN.id}_${this.#day}`) === '1';
    } catch (_e) {
      return false;
    }
  }

  #jackpotRevealed() { return this.#readKey('spun_day'); }

  #flipRevealed() {
    // No coinflip result row for the pinned day → gate waived.
    if (this.#flipFetchedDay === this.#day && this.#flipResult == null) return true;
    return this.#readKey('flip_day');
  }

  #fuzzed() {
    return !(this.#jackpotRevealed() && this.#flipRevealed());
  }

  // ---------------------------------------------------------------------
  // Data — dashboard per address + flip result per day.
  // ---------------------------------------------------------------------

  async #refresh() {
    // Account-switcher (2026-07-16): mode 'combined' renders from the merged
    // app.playerCombined payload (written by polling.js's combined-mode
    // cycle) instead of fetching a single /player/:address. No network call
    // here — the subscription above keeps #combined current.
    if (get('ui.mode') === 'combined') {
      this.#address = null;
      this.#combined = get('app.playerCombined');
      this.#render();
      return;
    }

    const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || get('viewing.address')
      || get('connected.address')
      || null;
    this.#address = addr;
    const day = this.#day;
    const seq = ++this.#fetchSeq;

    const [dash, flip] = await Promise.allSettled([
      addr ? fetchJSON(`/player/${String(addr).toLowerCase()}`) : Promise.resolve(null),
      day != null ? fetchJSON(`/game/coinflip/day/${day}`) : Promise.resolve(null),
    ]);
    if (seq !== this.#fetchSeq) return;  // superseded

    if (dash.status === 'fulfilled' && dash.value) {
      this.#dashboard = dash.value;
      this.#dashboardAddr = addr;
    } else if (this.#dashboardAddr !== addr) {
      // Fetch failed / no address AND the cached dashboard belongs to a
      // different player — never show someone else's balances.
      this.#dashboard = null;
      this.#dashboardAddr = null;
    }
    this.#flipResult = flip.status === 'fulfilled' ? flip.value : null;
    this.#flipFetchedDay = day;
    this.#render();
  }

  // ---------------------------------------------------------------------
  // Render.
  // ---------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <div class="panel abs-strip">
        <div class="abs-tiles" data-bind="abs-tiles"></div>
        <p class="abs-hint" data-bind="abs-hint" hidden></p>
      </div>
    `;
  }

  // Whole-token display with thousands separators (FLIP/DGNRS balances run
  // into the millions; "4,526,397" reads, "4526397" doesn't).
  #fmtWhole(weiStr) {
    const whole = displayToken(BigInt(weiStr || '0'), 0);
    const n = Number(whole);
    return Number.isSafeInteger(n) ? n.toLocaleString('en-US') : whole;
  }

  #tileValues() {
    if (get('ui.mode') === 'combined') return this.#tileValuesCombined();
    const d = this.#dashboard;
    const vals = { winnings: null, winningsAllTime: null, flip: null, tickets: null, dgnrs: null };
    if (!d) return vals;
    // Winnings tile = CURRENT claimable (not all-time). All-time credited rides
    // a sub-line so both are visible without conflating them.
    try { vals.winnings = `${displayEth(BigInt(d.claimableEth || '0'))} ETH`; } catch (_e) { /* keep null */ }
    try { vals.winningsAllTime = `${displayEth(BigInt(d.totalCredited || '0'))} ETH won all-time`; } catch (_e) { /* keep null */ }
    try { vals.flip = this.#fmtWhole(d.flipBalance); } catch (_e) { /* keep null */ }
    try { vals.dgnrs = this.#fmtWhole(d.dgnrsBalance); } catch (_e) { /* keep null */ }
    if (Array.isArray(d.tickets)) {
      let entries = 0;
      for (const t of d.tickets) entries += Number(t?.entryCount || 0);
      vals.tickets = String(Math.floor(entries / ENTRIES_PER_TICKET));
    }
    return vals;
  }

  // Account-switcher (2026-07-16) — combined-mode tile values, sourced from
  // app.playerCombined (combine.js's summed shape). totalCredited has no
  // combined analog (not a combine.js SUM field) — the all-time sub-line
  // stays blank rather than showing a misleadingly-partial number.
  #tileValuesCombined() {
    const d = this.#combined;
    const vals = { winnings: null, winningsAllTime: null, flip: null, tickets: null, dgnrs: null };
    if (!d) return vals;
    try { vals.winnings = `${displayEth(BigInt(d.claimableEth || '0'))} ETH`; } catch (_e) { /* keep null */ }
    try { vals.flip = this.#fmtWhole(d.flipBalance); } catch (_e) { /* keep null */ }
    try { vals.dgnrs = this.#fmtWhole(d.dgnrsBalance); } catch (_e) { /* keep null */ }
    if (Array.isArray(d.tickets)) {
      let entries = 0;
      for (const t of d.tickets) entries += Number(t?.entryCount || 0);
      vals.tickets = String(Math.floor(entries / ENTRIES_PER_TICKET));
    }
    return vals;
  }

  #render() {
    const tiles = this.querySelector('[data-bind="abs-tiles"]');
    const hint = this.querySelector('[data-bind="abs-hint"]');
    const strip = this.querySelector('.abs-strip');
    if (!tiles) return;
    tiles.textContent = '';

    const fuzzed = this.#fuzzed();
    if (strip) strip.classList.toggle('abs-strip--fuzzed', fuzzed);
    if (hint) {
      hint.hidden = !fuzzed;
      hint.textContent = 'Balances hidden — reveal the jackpot draw and the daily coinflip first.';
    }

    const vals = this.#tileValues();
    // Winnings only (user call: no FLIP / Tickets / DGNRS in the head bar). FLIP
    // is already on the coinflip widget's bet/claimable/balance rows, and the ticket
    // count is the tickets inventory's whole job — repeating them up here spent
    // the most valuable strip on the page restating panels further down.
    // #tileValues() still computes flip/tickets/dgnrs and this render now drops
    // them on the floor. Left in deliberately: both it and #tileValuesCombined
    // return one shape, and a pro-mode strip re-enables these by adding rows to
    // `defs` — not by rebuilding the value math.
    const defs = [
      ['Winnings', vals.winnings],
    ];
    for (const [labelText, valueText] of defs) {
      const tile = document.createElement('div');
      tile.className = 'abs-tile';
      const label = document.createElement('span');
      label.className = 'abs-tile__label';
      label.textContent = labelText;
      tile.appendChild(label);
      const value = document.createElement('span');
      value.className = 'abs-tile__value';
      value.textContent = valueText == null ? '—' : valueText;
      tile.appendChild(value);
      // Winnings tile: "claimable" qualifier + all-time won sub-line (not fuzzed).
      if (labelText === 'Winnings') {
        const claimableTag = document.createElement('span');
        claimableTag.className = 'abs-tile__tag';
        claimableTag.textContent = 'claimable now';
        tile.appendChild(claimableTag);
        if (!fuzzed && vals.winningsAllTime) {
          const allTime = document.createElement('span');
          allTime.className = 'abs-tile__alltime';
          allTime.textContent = vals.winningsAllTime;
          tile.appendChild(allTime);
        }
        this.#appendClaimButton(tile, fuzzed);
      }
      tiles.appendChild(tile);
    }
  }

  // Compact ETH-winnings claim on the Winnings tile — renders only when the
  // reveals are done, the connected wallet IS the viewed player, and there
  // is something to claim.
  #appendClaimButton(tile, fuzzed) {
    if (fuzzed) return;
    // Combined view is read-only (no single account to claim into) — the
    // aggregate winnings number isn't any one account's actual claimable().
    if (get('ui.mode') === 'combined') return;
    const connected = get('connected.address');
    if (!connected) return;
    const viewed = getViewedAddress() || get('viewing.address') || connected;
    if (String(viewed).toLowerCase() !== String(connected).toLowerCase()) return;
    let claimable = 0n;
    try { claimable = BigInt(this.#dashboard?.claimableEth || '0'); } catch (_e) { claimable = 0n; }
    if (claimable <= 0n) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'abs-claim-cta';
    btn.setAttribute('data-write', '');
    btn.textContent = 'Claim';
    btn.addEventListener('click', async () => {
      if (this.#claimBusy) return;
      this.#claimBusy = true;
      btn.disabled = true;
      btn.textContent = 'Claiming…';
      try {
        await claimEth({ player: connected });
        setTimeout(() => this.#refresh(), 250);
      } catch (error) {
        btn.textContent = 'Claim';
        this.#renderClaimError(error?.userMessage || error?.message || 'Claim failed.');
      } finally {
        btn.disabled = false;
        setTimeout(() => { this.#claimBusy = false; }, 500);
      }
    });
    tile.appendChild(btn);
  }

  #renderClaimError(msg) {
    const hint = this.querySelector('[data-bind="abs-hint"]');
    if (!hint) return;
    hint.hidden = false;
    hint.textContent = String(msg);
  }
}

// Idempotency-guarded register (Phase 58 pattern).
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-balances-strip')) {
    customElements.define('app-balances-strip', AppBalancesStrip);
  }
}

export { AppBalancesStrip };
