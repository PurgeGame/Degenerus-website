// /app/components/app-mine-flip.js — the MINE FLIP chip (user ask).
//
// A small pill in the TOP BAR, dark when there is nothing to do and lit when
// there is, wired to whatever transaction is next in `work-queue.js`. The queue
// mixes the permissionless crank (raced, pays a bounty) with the player's own
// claims (unraced), ordered so the chip never spends the player's turn on a
// claim while a bounty is sitting there for someone else to take.
//
// Why one button rather than a row of them: the actions are sequential anyway —
// each is its own transaction and each changes what the next one should be — so
// a list of buttons would mostly be a list of things you must not press yet. The
// full manifest lives in the hover popover; only the head of the queue is
// actionable, and the chip's own label is the queue depth.
//
// NOT auto-run (see work-queue.js header): ticket awards are informational
// until their traits materialise, and decimator/terminal rows need context the
// indexer rollup does not carry. Those render in the manifest with a muted
// style and no click target.
//
// Data refresh: after every confirmed tx (the queue is stale by definition), on
// wallet/acting-address change, on tab focus, and on a 30s poll — the crank's
// work state is set by other players and by the day rolling over, so a chip
// that only refreshed on user action would sit dark through a live bounty.
//
// Mount: NOT in index.html. Like the day/level/activity chips it injects itself
// into the nav, which shared/nav.js builds at runtime — there is no markup to
// hang it off declaratively.
//
// T-58-18: every server-derived string goes through textContent.

import { subscribe, getActingAddress } from '../app/store.js';
import { loadWorkQueue, nextAction } from '../app/work-queue.js';
import { subscribePendingActions } from '../app/pending-actions.js';
import { displayEth, displayToken } from '../app/scaling.js';

const POLL_INTERVAL_MS = 30_000;
const ERROR_AUTO_CLEAR_MS = 10_000;
// A ticket is 4 entries (`<<2` on-chain). Mirrors app-balances-strip.js.
const ENTRIES_PER_TICKET = 4;

// Presentation work (boxes, packs, Degenerette) belongs to the bottom reveal
// tray. This nav button accepts only an explicitly tagged DB-backed batch
// resolver in addition to Mine Flip, matching work-queue.js's contract.
function _batchResolutionRows(items) {
  return (Array.isArray(items) ? items : []).filter((item) => (
    item?.batchResolution === true || item?.kind === 'batch-resolution'
  ));
}

// Chip labels per queue id — short enough for the nav chip, and each one names
// the transaction the press actually sends (work-queue.js owns the ordering).
const ACTION_LABELS = Object.freeze({
  mineFlip: 'MINE FLIP',
  eth: 'CLAIM ETH',
  flip: 'CLAIM FLIP',
  decimator: 'CLAIM DECIMATOR',
  terminal: 'CLAIM TERMINAL',
  tickets: 'TICKETS OWED',
});

function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

/** Format a queue row's amount for display; null amount renders no chip. */
function formatAmount(item) {
  if (item == null || item.amount == null) return '';
  try {
    // BigInt() is REQUIRED, not defensive: /pending hands back decimal STRINGS,
    // and displayEth multiplies by ETH_DIVISOR, so a string argument throws
    // "cannot mix BigInt and other types" straight into the catch below and the
    // row silently renders with no amount. Same wrapping as
    // app-balances-strip.js and reveal-overlay.js.
    if (item.unit === 'eth') return `${displayEth(BigInt(item.amount), 4)} ETH`;
    if (item.unit === 'flip') return `${displayToken(BigInt(item.amount))} FLIP`;
    // `entries` is the raw ticketsOwedView unit; 4 entries = 1 ticket. Show both
    // so the number matches the inventory's ticket counts without hiding the
    // unit the API actually returned.
    if (item.unit === 'entries') {
      const entries = Number(item.amount) || 0;
      const tickets = Math.floor(entries / ENTRIES_PER_TICKET);
      return `${tickets} ticket${tickets === 1 ? '' : 's'} (${entries} entries)`;
    }
  } catch (_e) { /* malformed indexer value — fall through to no chip */ }
  return '';
}

class AppMineFlip extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #queue = [];
  #pending = [];
  #busy = false;
  #loadSeq = 0;
  #pollHandle = null;
  #errorTimer = null;
  #onFocus = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wire();
    this.#unsubs.push(subscribePendingActions((items) => {
      this.#pending = _batchResolutionRows(items);
      this.#render();
    }));

    // The acting address drives everything, and it is DERIVED (store.js
    // getActingAddress reads ui.mode + connected/viewing), so there is no single
    // key to watch — subscribe to all three inputs, same as the balances strip.
    this.#unsubs.push(subscribe('connected.address', () => this.#refresh()));
    this.#unsubs.push(subscribe('viewing.address', () => this.#refresh()));
    this.#unsubs.push(subscribe('ui.mode', () => this.#refresh()));

    this.#pollHandle = _setIntervalUnref(() => this.#refresh(), POLL_INTERVAL_MS);
    this.#onFocus = () => { if (!document.hidden) this.#refresh(); };
    document.addEventListener('visibilitychange', this.#onFocus);

    this.#refresh();
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => { try { fn(); } catch (_) { /* defensive */ } });
    this.#unsubs = [];
    if (this.#pollHandle) clearInterval(this.#pollHandle);
    if (this.#errorTimer) clearTimeout(this.#errorTimer);
    if (this.#onFocus) document.removeEventListener('visibilitychange', this.#onFocus);
    this.#initialized = false;
  }

  /**
   * Test-only: the live queue, so a case can swap a row's `run` for a stub and
   * exercise the click path without a chain. Same seam as app-packs-panel's
   * __…ForTest methods; nothing in production reads it.
   */
  __queueForTest() { return this.#queue; }
  __pendingForTest() { return this.#pending; }

  #renderShell() {
    this.innerHTML = `
      <button type="button" class="unav-day mf-chip" data-write data-bind="mf-cta" disabled
              aria-label="Outstanding on-chain work">
        <span class="mf-chip__label" data-bind="mf-label">MINE FLIP</span>
        <span class="mf-chip__count" data-bind="mf-count" hidden></span>
      </button>
      <div class="mf-pop" data-bind="mf-pop">
        <div class="mf-pop__head" data-bind="mf-sub">Checking…</div>
        <ul class="mf-list" data-bind="mf-list"></ul>
        <div class="mf-error" data-bind="mf-error" hidden role="alert"></div>
      </div>
    `;
  }

  #wire() {
    const cta = this.querySelector('[data-bind="mf-cta"]');
    if (cta) cta.addEventListener('click', () => this.#runNext());
  }

  async #refresh() {
    const player = getActingAddress();
    const seq = ++this.#loadSeq;
    if (!player) { this.#queue = []; this.#render(); return; }
    let result;
    try {
      result = await loadWorkQueue({ player });
    } catch (_e) {
      result = { queue: [] };
    }
    if (seq !== this.#loadSeq) return;   // a newer refresh already landed
    this.#queue = result.queue || [];
    this.#render();
  }

  #firstReady() {
    const work = nextAction(this.#queue);
    if (work) return { item: work, external: false };
    const external = this.#pending.find((item) => item.state === 'ready' && item.run);
    return external ? { item: external, external: true } : null;
  }

  async #runNext() {
    const next = this.#firstReady();
    if (!next) return;
    return this.#runAction(next.item, next.external);
  }

  async #runAction(item, external) {
    if (this.#busy) return;
    const player = getActingAddress();
    if (!player) return;

    this.#busy = true;
    this.#render();
    try {
      if (external) await item.run();
      else await item.run({ player });
      this.#clearError();
    } catch (err) {
      // NoWork is not a failure — the queue simply went stale between the
      // probe and the click (another keeper got there first). Refresh quietly.
      if (err && (external || err.code !== 'NoWork')) {
        this.#showError(err.userMessage || err.message || 'Transaction failed.');
      }
    } finally {
      this.#busy = false;
      await this.#refresh();
    }
  }

  #showError(msg) {
    const el = this.querySelector('[data-bind="mf-error"]');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    if (this.#errorTimer) clearTimeout(this.#errorTimer);
    this.#errorTimer = setTimeout(() => this.#clearError(), ERROR_AUTO_CLEAR_MS);
  }

  #clearError() {
    const el = this.querySelector('[data-bind="mf-error"]');
    if (el) { el.textContent = ''; el.hidden = true; }
    if (this.#errorTimer) { clearTimeout(this.#errorTimer); this.#errorTimer = null; }
  }

  #render() {
    const cta = this.querySelector('[data-bind="mf-cta"]');
    const label = this.querySelector('[data-bind="mf-label"]');
    const sub = this.querySelector('[data-bind="mf-sub"]');
    const list = this.querySelector('[data-bind="mf-list"]');
    if (!cta || !label || !sub || !list) return;

    const next = this.#firstReady();
    const all = this.#queue.length + this.#pending.length;
    const hasWork = all > 0;
    const readyCount = (nextAction(this.#queue) ? 1 : 0)
      + this.#pending.filter((item) => item.state === 'ready' && item.run).length;
    const count = this.querySelector('[data-bind="mf-count"]');

    // The chip NAMES THE TX IT WILL SEND. It used to always read MINE FLIP,
    // which is the widget's name but not always the button's action: the crank
    // is only in the queue when it has work (it reverts NoWork() otherwise), so
    // a press often fired a claim instead — indistinguishable from a bug from
    // the outside (user call 2026-07-29). Idle still reads MINE FLIP so the
    // chip keeps a stable identity when there is nothing to do.
    label.textContent = next
      ? (next.external
        ? (next.item.shortLabel || 'RESOLVE').toUpperCase()
        : ACTION_LABELS[next.item.id] || next.item.label.toUpperCase())
      : (hasWork ? 'PENDING' : 'MINE FLIP');
    cta.classList.toggle('is-live', !!next && !this.#busy);
    cta.classList.toggle('has-pending', hasWork && !next);
    // Waiting-only stays focusable/clickable so phone users can open the
    // manifest; #runNext is a no-op until one row is truly ready.
    cta.disabled = !hasWork || this.#busy;
    if (count) {
      if (hasWork) { count.textContent = String(all); count.hidden = false; }
      else { count.textContent = ''; count.hidden = true; }
    }

    if (this.#busy) {
      sub.textContent = 'Sending…';
    } else if (next) {
      // "Next:" prefix — the head says what PRESSING does; the list below is the
      // manifest. Without it the head just repeated the first row verbatim.
      const amt = next.external ? next.item.detail : formatAmount(next.item);
      const prefix = next.external ? 'Ready' : 'Next';
      sub.textContent = amt
        ? `${prefix}: ${next.item.label} · ${amt}`
        : `${prefix}: ${next.item.label}`;
    } else if (hasWork) {
      sub.textContent = `${all} waiting · none ready yet`;
    } else {
      sub.textContent = 'Nothing to do';
    }

    list.textContent = '';
    const workHead = nextAction(this.#queue);
    for (const item of this.#queue) {
      const li = document.createElement('li');
      const actionable = Boolean(workHead && item.id === workHead.id && !this.#busy);
      li.className = `mf-row ${actionable ? 'mf-row--ready mf-row--next' : 'mf-row--waiting'}`
        + (item.autoRun ? '' : ' mf-row--manual');
      const body = document.createElement(actionable ? 'button' : 'div');
      body.className = 'mf-row__body';
      if (actionable) {
        body.type = 'button';
        body.setAttribute('data-write', '');
        body.addEventListener('click', (event) => {
          try { event.stopPropagation(); } catch (_e) { /* fakeDOM */ }
          this.#runAction(item, false);
        });
      }
      const name = document.createElement('span');
      name.className = 'mf-row__label';
      name.textContent = item.label;
      const amt = document.createElement('span');
      amt.className = 'mf-row__amount';
      amt.textContent = formatAmount(item);
      const state = document.createElement('span');
      state.className = 'mf-row__state';
      state.textContent = actionable ? 'READY' : 'WAITING';
      body.appendChild(name);
      body.appendChild(amt);
      body.appendChild(state);
      li.appendChild(body);
      list.appendChild(li);
    }
    for (const item of this.#pending) {
      const actionable = item.state === 'ready' && item.run && !this.#busy;
      const li = document.createElement('li');
      li.className = `mf-row mf-row--${item.state}${actionable ? ' mf-row--actionable' : ''}`;
      const body = document.createElement(actionable ? 'button' : 'div');
      body.className = 'mf-row__body';
      if (actionable) {
        body.type = 'button';
        body.setAttribute('data-write', '');
        body.addEventListener('click', (event) => {
          try { event.stopPropagation(); } catch (_e) { /* fakeDOM */ }
          this.#runAction(item, true);
        });
      }
      const name = document.createElement('span');
      name.className = 'mf-row__label';
      name.textContent = item.label;
      const detail = document.createElement('span');
      detail.className = 'mf-row__amount';
      detail.textContent = item.detail;
      const state = document.createElement('span');
      state.className = 'mf-row__state';
      state.textContent = item.state === 'ready' ? 'READY'
        : item.state === 'busy' ? 'OPENING…' : 'WAITING';
      body.appendChild(name);
      body.appendChild(detail);
      body.appendChild(state);
      li.appendChild(body);
      list.appendChild(li);
    }

    cta.setAttribute(
      'aria-label',
      readyCount > 0
        ? `${readyCount} pending action${readyCount === 1 ? '' : 's'} ready`
        : hasWork ? `${all} pending action${all === 1 ? '' : 's'} waiting`
          : 'No outstanding on-chain work',
    );
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-mine-flip')) {
  customElements.define('app-mine-flip', AppMineFlip);
}

// Inject into the nav once it exists (shared/nav.js builds it at runtime).
// Placed after the activity chip so the bar reads day → level → score → action.
function mountIntoNav() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  if (document.querySelector('app-mine-flip')) return;
  const host = document.querySelector('.nav-right') || document.querySelector('.nav-left');
  if (!host) return;
  const el = document.createElement('app-mine-flip');
  const anchor = document.querySelector('app-activity-chip')
    || (document.getElementById ? (document.getElementById('unav-state') || document.getElementById('unav-day')) : null);
  try {
    if (anchor && anchor.parentNode === host) host.insertBefore(el, anchor.nextSibling);
    else host.insertBefore(el, host.firstChild);
  } catch (_e) { host.appendChild(el); }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mountIntoNav, 0));
  else setTimeout(mountIntoNav, 0);
  // The activity chip lands on its own timer, so retry briefly to sit after it
  // rather than ahead of it.
  let tries = 0;
  const t = setInterval(() => { mountIntoNav(); if (++tries > 20 || document.querySelector('app-mine-flip')) clearInterval(t); }, 500);
  if (t && typeof t.unref === 'function') { try { t.unref(); } catch (_) { /* defensive */ } }
}

export const _testing = { formatAmount, mountIntoNav, _batchResolutionRows };
