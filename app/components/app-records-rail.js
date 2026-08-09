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
import { get, getActingAddress, getViewedAddress, subscribe, update } from '../app/store.js';

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

/** Poker-chip-sized FLIP amount with at most two significant figures. */
export function formatCompactBountyWei(value) {
  let raw;
  try { raw = BigInt(value ?? 0); } catch (_e) { return '—'; }
  if (raw < 0n) raw = -raw;
  const whole = raw / (10n ** 18n);
  if (whole === 0n) return raw > 0n ? '<1' : '0';
  const digits = whole.toString().length;
  const quantum = digits > 2 ? 10n ** BigInt(digits - 2) : 1n;
  const rounded = quantum > 1n
    ? ((whole + (quantum / 2n)) / quantum) * quantum
    : whole;
  const units = [
    [10n ** 15n, 'Q'],
    [10n ** 12n, 'T'],
    [10n ** 9n, 'B'],
    [10n ** 6n, 'M'],
    [10n ** 3n, 'K'],
  ];
  const unit = units.find(([threshold]) => rounded >= threshold);
  if (!unit) return group(rounded.toString());
  const [divisor, suffix] = unit;
  const tenths = (rounded * 10n) / divisor;
  if (tenths < 100n && tenths % 10n !== 0n) {
    return `${tenths / 10n}.${tenths % 10n}${suffix}`;
  }
  return `${rounded / divisor}${suffix}`;
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
        <details class="records-rail__disclosure">
          <summary class="records-rail__summary" title="Show or hide full bounty details">
          <span class="records-rail__identity">
            <span class="records-rail__crest" aria-hidden="true">
              <img src="/app/assets/biggest-bounty-emblem.png" alt="">
            </span>
            <span class="records-rail__identity-copy">
              <span class="records-rail__eyebrow">4 ALL-TIME RECORDS</span>
              <span class="records-rail__title" id="records-rail-title" role="heading" aria-level="2">
                <span class="records-rail__title-name">THE BIGGEST</span>
                <span class="records-rail__title-descriptor">BOUNTY</span>
              </span>
            </span>
          </span>

          <span class="records-rail__leaders" data-bind="records-leaders"
                role="list" aria-label="The four current Biggest records"></span>

          <span class="records-rail__pot" aria-label="Shared record bounty">
            <span class="records-rail__pot-label">LIVE BOUNTY</span>
            <strong><b data-bind="records-pool">—</b><em>FLIP</em></strong>
          </span>

          <span class="records-rail__toggle" aria-hidden="true">
            <span class="records-rail__chevron"></span>
          </span>
          </summary>

          <div class="records-rail__expanded">
            <div class="records-rail__expanded-intro">
              <span class="records-rail__rule">Hit an open minimum or clear a standing record by 20% to collect its live share.</span>
              <span class="records-rail__pot-growth"><b>+2,000 FLIP</b> every unbroken day</span>
            </div>
            <ol class="records-rail__cards" data-bind="records-cards" aria-label="Full details for the four all-time records"></ol>
          </div>
        </details>
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
    // One authoritative snapshot powers both the board and the qualifying
    // glow on the four wager inputs. Publishing it here keeps every surface on
    // the rail's immediate post-transaction refresh and 15-second live poll.
    update('app.records', state);
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

    const leaders = this.querySelector('[data-bind="records-leaders"]');
    if (leaders) {
      leaders.innerHTML = '';
      for (const record of state.records) {
        leaders.appendChild(this.#renderLeader(record));
      }
    }

    const list = this.querySelector('[data-bind="records-cards"]');
    if (!list) return;
    list.innerHTML = '';
    const viewed = String(this.#viewedAddress || '').toLowerCase();

    for (const record of state.records) {
      list.appendChild(this.#renderCard(record, viewed));
    }
  }

  #renderLeader(record) {
    const item = document.createElement('span');
    item.className = 'records-rail__leader';
    item.dataset.kind = String(record.kind);
    item.setAttribute('role', 'listitem');
    if (!record.held) item.classList.add('is-open');

    const value = formatRecordValue(record.kind, record.value);
    const compactSuffix = record.meta.unit === 'flip' ? '' : value.suffix;
    const profile = record.player ? this.#profiles.get(record.player) : null;
    const holder = profile?.name || shortAddress(record.player);
    const payoutWei = this.#recordPayoutWei(record);
    const compactPayout = payoutWei == null ? '—' : formatCompactBountyWei(payoutWei);
    item.title = record.held
      ? `${record.meta.label}: ${value.amount} ${value.suffix}, held by ${holder}; bounty ${compactPayout} FLIP`
      : `${record.meta.label}: unhit, minimum ${record.meta.floorText}; bounty ${compactPayout} FLIP`;
    item.innerHTML = `
      <span class="records-rail__target">
        <span class="records-rail__bounty-sight"
              aria-label="Current bounty ${escapeHtml(compactPayout)} FLIP"
              title="Current payout for breaking this record">
          <span class="records-rail__crosshair" aria-hidden="true"></span>
          <b aria-hidden="true">${escapeHtml(compactPayout)}</b>
        </span>
        ${record.held
          ? this.#portrait(record.player, profile)
          : '<span class="records-rail__portrait records-rail__portrait--open" aria-hidden="true">?</span>'}
      </span>
      <span class="records-rail__leader-copy">
        <span class="records-rail__leader-label">
          <small>BIGGEST</small>
          <b>${escapeHtml(record.meta.short)}</b>
        </span>
        <strong class="records-rail__leader-value">${record.held
          ? `${escapeHtml(value.amount)}${compactSuffix
            ? ` <em>${escapeHtml(compactSuffix)}</em>`
            : ''}`
          : `<i>MIN</i> ${escapeHtml(record.meta.floorText)}`}</strong>
      </span>
    `;
    this.#wirePortraitFallback(item, record.player);
    return item;
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
    const today = Number(get('app.daySync')?.day ?? get('app.lastDay')?.day) || null;
    const shareBps = accruedShareBps({ held: record.held, clockDay: record.clockDay, today });
    const payoutWei = this.#recordPayoutWei(record, today);
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
            <strong class="records-rail__mark records-rail__mark--open">UNHIT</strong>
          </div>
          <div class="records-rail__holder records-rail__holder--open">
            <span class="records-rail__portrait records-rail__portrait--open" aria-hidden="true">?</span>
            <span class="records-rail__holder-copy">
              <small>HELD BY</small>
              <b class="records-rail__holder-name">Nobody yet</b>
            </span>
          </div>
          <div class="records-rail__stakes">
            <span class="records-rail__pays">
              <small>CURRENT BOUNTY</small>
              <b>${payoutWei == null
                ? '—'
                : escapeHtml(group(displayToken(payoutWei, 0)))} <em>FLIP</em></b>
            </span>
            <span class="records-rail__beat">
              <small>MIN TO HIT</small>
              <b>${escapeHtml(record.meta.floorText)}</b>
            </span>
          </div>
        `}
    `;

    // A Discord avatar can 404 long after the record was set (deleted account,
    // rotated hash). Fall back to the monogram rather than leaving a broken
    // image in the hall of fame.
    this.#wirePortraitFallback(item, record.player);
    return item;
  }

  #recordPayoutWei(record, today = Number(
    get('app.daySync')?.day ?? get('app.lastDay')?.day,
  ) || null) {
    const shareBps = accruedShareBps({
      held: record.held,
      clockDay: record.clockDay,
      today,
    });
    return accruedPayoutWei(this.#state?.recordPoolWei, shareBps);
  }

  #wirePortraitFallback(root, address) {
    const portrait = root?.querySelector?.('img.records-rail__portrait');
    if (portrait) {
      portrait.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'records-rail__portrait records-rail__portrait--monogram';
        fallback.setAttribute('aria-hidden', 'true');
        fallback.style.setProperty('--portrait-hue', String(addressHue(address)));
        fallback.textContent = addressMonogram(address);
        portrait.replaceWith(fallback);
      }, { once: true });
    }
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
