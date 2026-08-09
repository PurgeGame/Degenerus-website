// Full-width all-time records rail. Four permanent marks, one shared FLIP pool.
//
// This is the only surface in /app/ that shows something the game never resets.
// Levels turn over, jackpots resolve, the Decimator burns — these four numbers
// only ever go up, and the pot behind them grows every day nobody moves one.
//
// The card's signature is the beat bar: the standing mark fills the track, and
// the ice notch past the end is `mark + ceil(mark/5)` — the exact candidate that
// claims a share of the pool rather than ratcheting the mark for free
// (Coinflip.sol:872). The notch sits at the same place on all four cards
// because it is one rule applied four ways.

import {
  accruedPayoutWei,
  accruedShareBps,
  fetchRecords,
  fetchProfiles,
  formatRecordValue,
  shortAddress,
} from '../app/records.js';
import { displayToken } from '../app/scaling.js';
import { TX_CONFIRMED_EVENT } from '../app/contracts.js';
import { get, getActingAddress, getViewedAddress, subscribe } from '../app/store.js';

const POLL_MS = 15_000;

/** Fill share of the track the standing mark occupies; the notch takes the rest. */
const MARK_FILL_PERCENT = 100 / 1.2;

let _fetchRecords = fetchRecords;
let _fetchProfiles = fetchProfiles;

function group(value) {
  const [whole, fraction] = String(value ?? '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction == null ? grouped : `${grouped}.${fraction}`;
}

/** Escape for interpolation into innerHTML. Holder names are user-controlled. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A deterministic two-letter monogram for a holder with no linked Discord
 * account, so every card carries a portrait rather than an empty ring.
 */
export function addressMonogram(address) {
  const hex = String(address || '').replace(/^0x/i, '').toUpperCase();
  return hex.length >= 2 ? hex.slice(0, 2) : '··';
}

/**
 * Hue derived from the address so the same holder keeps the same portrait
 * colour across cards and sessions.
 */
export function addressHue(address) {
  const hex = String(address || '').replace(/^0x/i, '').slice(0, 6);
  const parsed = Number.parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed % 360 : 0;
}

class AppRecordsRail extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #timer = null;
  #txConfirmedListener = null;
  #seq = 0;
  #state = null;
  #profiles = new Map();
  #viewedAddress = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    for (const key of ['connected.address', 'viewing.address']) {
      this.#unsubs.push(subscribe(key, () => {
        this.#viewedAddress = getViewedAddress?.() || getActingAddress?.() || null;
        this.#render();
      }));
    }
    // The accrued share grows every game day, so a rollover re-prices all four
    // cards without needing a poll.
    this.#unsubs.push(subscribe('app.daySync', () => { this.#render(); }));
    // A record can be hit by a flip, Degenerette spin, luckbox, or ticket buy.
    // Every app write publishes this event after its receipt, so re-read the
    // authoritative on-chain pool immediately instead of leaving the winning
    // player looking at the pre-payout balance until the interval fires.
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.#txConfirmedListener = () => { void this.#refresh(); };
      document.addEventListener(TX_CONFIRMED_EVENT, this.#txConfirmedListener);
    }
    this.#timer = setInterval(() => { void this.#refresh(); }, POLL_MS);
    try { this.#timer?.unref?.(); } catch (_e) { /* browser timer */ }
    void this.#refresh();
  }

  disconnectedCallback() {
    for (const unsubscribe of this.#unsubs) {
      try { unsubscribe(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (this.#txConfirmedListener && typeof document !== 'undefined') {
      try { document.removeEventListener?.(TX_CONFIRMED_EVENT, this.#txConfirmedListener); }
      catch (_e) { /* defensive */ }
    }
    this.#txConfirmedListener = null;
    if (this.#timer != null) clearInterval(this.#timer);
    this.#timer = null;
    this.#seq += 1;
    this.#initialized = false;
  }

  #renderShell() {
    this.hidden = true;
    this.innerHTML = `
      <section class="records-rail" data-bind="records-shell" hidden aria-labelledby="records-rail-title">
        <header class="records-rail__top">
          <div class="records-rail__identity">
            <span class="records-rail__crest" aria-hidden="true">
              <img src="/whitepaper/flame-logo-split.svg" alt="">
            </span>
            <span class="records-rail__identity-copy">
              <span class="records-rail__eyebrow">4 ALL-TIME RECORDS · 1 SHARED PRIZE</span>
              <h2 id="records-rail-title">THE BIGGEST BOUNTY</h2>
              <span class="records-rail__rule">Beat a standing record by 20% to claim its live share.</span>
            </span>
          </div>

          <article class="records-rail__pot" aria-label="Shared record bounty">
            <span class="records-rail__pot-label">LIVE BOUNTY POOL</span>
            <strong><b data-bind="records-pool">—</b><em>FLIP</em></strong>
            <span class="records-rail__pot-growth"><b>+2,000 FLIP</b> every unbroken day</span>
          </article>
        </header>

        <ol class="records-rail__cards" data-bind="records-cards" aria-label="The four all-time records"></ol>
      </section>
    `;
  }

  async #refresh() {
    const seq = ++this.#seq;
    let state = null;
    try {
      state = await _fetchRecords();
    } catch (_e) {
      // Keep the last good rail up rather than blanking it on one failed poll.
      return;
    }
    if (seq !== this.#seq) return;
    this.#state = state;
    this.#viewedAddress = getViewedAddress?.() || getActingAddress?.() || null;
    this.#render();

    const holders = state.records.map((record) => record.player).filter(Boolean);
    const profiles = await _fetchProfiles(holders);
    if (seq !== this.#seq) return;
    this.#profiles = profiles;
    this.#render();
  }

  #render() {
    const shell = this.querySelector('[data-bind="records-shell"]');
    if (!shell) return;
    const state = this.#state;
    if (!state) {
      this.hidden = true;
      shell.hidden = true;
      return;
    }
    this.hidden = false;
    shell.hidden = false;

    const pool = this.querySelector('[data-bind="records-pool"]');
    if (pool) pool.textContent = group(displayToken(state.recordPoolWei, 0));

    const list = this.querySelector('[data-bind="records-cards"]');
    if (!list) return;
    list.innerHTML = '';
    const viewed = String(this.#viewedAddress || '').toLowerCase();

    for (const record of state.records) {
      list.appendChild(this.#renderCard(record, viewed));
    }
  }

  #renderCard(record, viewed) {
    const item = document.createElement('li');
    item.className = 'records-rail__card';
    item.dataset.kind = String(record.kind);
    if (!record.held) item.classList.add('is-open');
    if (record.player && record.player === viewed) item.classList.add('is-you');

    const value = formatRecordValue(record.kind, record.value);
    const bar = formatRecordValue(record.kind, record.barToBeat);
    const profile = record.player ? this.#profiles.get(record.player) : null;

    // What breaking this record pays right now. Null when the clock is unknown
    // (a row indexed before clockDay existed) — the card then shows the bar
    // alone rather than inventing a share.
    const today = Number(get('app.daySync')?.day) || null;
    const shareBps = accruedShareBps({ held: record.held, clockDay: record.clockDay, today });
    const payoutWei = accruedPayoutWei(this.#state?.recordPoolWei, shareBps);
    const title = record.claimCount > 0
      ? `${record.meta.label} — paid out ${record.claimCount}×`
      : record.meta.label;
    const number = String(Number(record.kind) + 1).padStart(2, '0');

    item.innerHTML = `
      <header class="records-rail__card-head">
        <span class="records-rail__number" aria-hidden="true">${number}</span>
        <span class="records-rail__card-title">
          <b title="${escapeHtml(title)}">${escapeHtml(record.meta.label)}</b>
        </span>
        ${shareBps
          ? `<i aria-label="${(shareBps / 100).toFixed(1)} percent share"
                title="Share of the bounty pool paid for breaking this record">${(shareBps / 100).toFixed(1)}%</i>`
          : ''}
      </header>
      ${record.held
        ? `
          <div class="records-rail__metric">
            <small>CURRENT RECORD</small>
            <strong class="records-rail__mark">${escapeHtml(value.amount)}<em>${escapeHtml(value.suffix)}</em></strong>
          </div>
          <div class="records-rail__holder">
            ${this.#portrait(record.player, profile)}
            <span class="records-rail__holder-copy">
              <small>HELD BY</small>
              <b class="records-rail__holder-name">${escapeHtml(profile?.name || shortAddress(record.player))}</b>
            </span>
          </div>
          <div class="records-rail__track" role="presentation">
            <span class="records-rail__fill" style="width:${MARK_FILL_PERCENT.toFixed(3)}%"></span>
            <span class="records-rail__notch"></span>
          </div>
          <div class="records-rail__stakes">
            <span class="records-rail__beat">
              <small>TARGET TO CLAIM</small>
              <b>${escapeHtml(bar.amount)} <em>${escapeHtml(bar.suffix)}</em></b>
            </span>
            ${payoutWei == null
              ? ''
              : `<span class="records-rail__pays">
                  <small>PAYOUT NOW</small>
                  <b>${escapeHtml(group(displayToken(payoutWei, 0)))} <em>FLIP</em></b>
                </span>`}
          </div>
        `
        : `
          <div class="records-rail__metric records-rail__metric--open">
            <small>CURRENT RECORD</small>
            <strong class="records-rail__mark records-rail__mark--open">OPEN</strong>
          </div>
          <div class="records-rail__holder records-rail__holder--open">
            <span class="records-rail__portrait records-rail__portrait--open" aria-hidden="true">?</span>
            <span class="records-rail__holder-copy">
              <small>HELD BY</small>
              <b class="records-rail__holder-name">Nobody yet</b>
            </span>
          </div>
          <div class="records-rail__open-callout">
            <small>FIRST MARK TO SET</small>
            <b>${escapeHtml(record.meta.floorText)}</b>
          </div>
        `}
    `;

    // A Discord avatar can 404 long after the record was set (deleted account,
    // rotated hash). Fall back to the monogram rather than leaving a broken
    // image in the hall of fame.
    const portrait = item.querySelector('img.records-rail__portrait');
    if (portrait) {
      portrait.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'records-rail__portrait records-rail__portrait--monogram';
        fallback.setAttribute('aria-hidden', 'true');
        fallback.style.setProperty('--portrait-hue', String(addressHue(record.player)));
        fallback.textContent = addressMonogram(record.player);
        portrait.replaceWith(fallback);
      }, { once: true });
    }
    return item;
  }

  #portrait(address, profile) {
    const alt = escapeHtml(profile?.name || shortAddress(address));
    if (profile?.avatar) {
      return `<img class="records-rail__portrait" src="${escapeHtml(profile.avatar)}"
                   alt="${alt}" loading="lazy" referrerpolicy="no-referrer">`;
    }
    return `<span class="records-rail__portrait records-rail__portrait--monogram"
                  style="--portrait-hue:${addressHue(address)}"
                  aria-hidden="true">${escapeHtml(addressMonogram(address))}</span>`;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-records-rail')) {
  customElements.define('app-records-rail', AppRecordsRail);
}

export function __setRecordsRailDepsForTest({ records, profiles } = {}) {
  if (typeof records === 'function') _fetchRecords = records;
  if (typeof profiles === 'function') _fetchProfiles = profiles;
}

export function __resetRecordsRailDepsForTest() {
  _fetchRecords = fetchRecords;
  _fetchProfiles = fetchProfiles;
}
