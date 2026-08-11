// Account-scoped AFKing runway warning. The pass panel remains the sole owner
// of contract reads and publishes its exact funded-day calculation to the
// store; this component only decides when to interrupt and routes the player
// back to the existing top-up control.

import { get, subscribe } from '../app/store.js';
import { lock, unlock } from '../app/scroll-lock.js';
import {
  readAfkingLowFundWarningPreference,
  subscribeUiPreferences,
} from '../app/ui-preferences.js';

export const AFKING_LOW_FUND_THRESHOLD_DAYS = 7n;

function normalizedAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  return address || null;
}

function parsedDays(value) {
  try {
    const days = BigInt(value);
    return days >= 0n ? days : null;
  } catch (_error) {
    return null;
  }
}

/**
 * A modal's own `hidden` attribute is not enough to establish visibility:
 * several app dialogs live inside a hidden custom-element host or backdrop.
 * Treat those dormant descendants as closed so they cannot postpone this
 * warning forever.
 */
export function isBlockingModal(dialog, warning) {
  if (!dialog || dialog === warning || warning?.contains?.(dialog)) return false;
  for (let node = dialog; node; node = node.parentElement) {
    if (
      node.hidden === true
      || node.hasAttribute?.('hidden')
      || node.getAttribute?.('aria-hidden') === 'true'
      || node.inert === true
    ) return false;
  }
  return true;
}

export function afkingFundingWarningModel({
  snapshot,
  connectedAddress,
  mode = 'self',
  enabled = true,
} = {}) {
  const connected = normalizedAddress(connectedAddress);
  const owner = normalizedAddress(snapshot?.address);
  const days = parsedDays(snapshot?.fundedDays);
  const visible = Boolean(
    enabled
    && connected
    && mode === 'self'
    && snapshot?.known === true
    && snapshot?.active === true
    && owner === connected
    && days != null
    && days < AFKING_LOW_FUND_THRESHOLD_DAYS
  );
  if (!visible) return Object.freeze({ visible: false });

  const quantity = Math.max(1, Math.trunc(Number(snapshot?.dailyQuantity) || 1));
  const product = snapshot?.settingsKnown
    ? (snapshot?.useTickets ? (quantity === 1 ? 'TICKET' : 'TICKETS') : 'LUCKBOX')
    : (quantity === 1 ? 'ITEM' : 'ITEMS');
  return Object.freeze({
    visible: true,
    address: connected,
    days,
    daysLabel: `${days} DAY${days === 1n ? '' : 'S'} FUNDED`,
    orderLabel: `${quantity} ${product} / DAY`,
    fundedSegments: Number(days),
  });
}

export class AppAfkingFundingWarning extends HTMLElement {
  #initialized = false;
  #open = false;
  #enabled = true;
  #unsubs = [];
  #preferenceUnsubscribe = null;
  #openTimer = null;
  #model = Object.freeze({ visible: false });
  #dismissedLowAddresses = new Set();
  #returnFocus = null;
  #keydown = (event) => {
    if (event?.key === 'Escape' && this.#open) this.#close({ dismiss: true });
  };

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#enabled = readAfkingLowFundWarningPreference();
    this.#renderShell();
    this.#wire();
    this.#unsubs = [
      subscribe('app.afkingSubscription', () => this.#evaluate()),
      subscribe('connected.address', () => this.#evaluate()),
      subscribe('ui.mode', () => this.#evaluate()),
    ];
    this.#preferenceUnsubscribe = subscribeUiPreferences((detail) => {
      if (detail?.name !== 'afkingLowFundWarning') return;
      const wasEnabled = this.#enabled;
      this.#enabled = Boolean(detail.value);
      if (!wasEnabled && this.#enabled) this.#dismissedLowAddresses.clear();
      this.#evaluate();
    });
    globalThis.document?.addEventListener?.('keydown', this.#keydown);
    this.#evaluate();
  }

  disconnectedCallback() {
    for (const unsubscribe of this.#unsubs.splice(0)) {
      try { unsubscribe?.(); } catch (_error) { /* defensive */ }
    }
    try { this.#preferenceUnsubscribe?.(); } catch (_error) { /* defensive */ }
    this.#preferenceUnsubscribe = null;
    globalThis.document?.removeEventListener?.('keydown', this.#keydown);
    this.#clearOpenTimer();
    if (this.#open) {
      this.#open = false;
      unlock();
    }
    this.#initialized = false;
  }

  #renderShell() {
    this.hidden = true;
    this.setAttribute('role', 'dialog');
    this.setAttribute('aria-modal', 'true');
    this.setAttribute('aria-labelledby', 'afking-funding-warning-title');
    this.innerHTML = `
      <button type="button" class="afking-funding-warning__backdrop"
              data-bind="afking-warning-dismiss" aria-label="Dismiss AFKing funding warning"></button>
      <section class="afking-funding-warning__card" tabindex="-1">
        <button type="button" class="afking-funding-warning__close"
                data-bind="afking-warning-dismiss" aria-label="Dismiss AFKing funding warning">×</button>
        <header class="afking-funding-warning__head">
          <span class="afking-funding-warning__sigil" aria-hidden="true">
            <i>AUTO</i><b>!</b>
          </span>
          <span>
            <small>SUBSCRIPTION ALERT</small>
            <h2 id="afking-funding-warning-title">AFKING RUNNING LOW</h2>
          </span>
        </header>
        <div class="afking-funding-warning__runway">
          <strong data-bind="afking-warning-days">— DAYS FUNDED</strong>
          <span class="afking-funding-warning__meter" aria-hidden="true">
            ${Array.from({ length: 7 }, () => '<i></i>').join('')}
          </span>
          <small data-bind="afking-warning-order">— / DAY</small>
        </div>
        <p>Your active AFKing order has less than one week of prepaid funding.
           Top it up before automatic buys stop.</p>
        <div class="afking-funding-warning__actions">
          <button type="button" class="afking-funding-warning__later"
                  data-bind="afking-warning-dismiss">NOT NOW</button>
          <button type="button" class="afking-funding-warning__topup"
                  data-bind="afking-warning-topup">TOP UP AFKING</button>
        </div>
        <small class="afking-funding-warning__setting-note">
          You can turn this alert off in <b>⚙ PLAYER SETTINGS</b>.
        </small>
      </section>`;
  }

  #wire() {
    for (const button of this.querySelectorAll('[data-bind="afking-warning-dismiss"]')) {
      button.addEventListener('click', () => this.#close({ dismiss: true }));
    }
    this.querySelector('[data-bind="afking-warning-topup"]')
      ?.addEventListener('click', () => this.#goToFunding());
  }

  #evaluate() {
    const snapshot = get('app.afkingSubscription');
    const connectedAddress = get('connected.address');
    const connected = normalizedAddress(connectedAddress);
    const snapshotOwner = normalizedAddress(snapshot?.address);
    const days = parsedDays(snapshot?.fundedDays);

    // Dismissing is session-only for one continuous low-funding spell. Once a
    // known balance reaches seven days (or the subscription stops), a future
    // drop below the line is a genuinely new warning.
    if (snapshot?.known === true && connected && snapshotOwner === connected) {
      if (snapshot.active !== true || (days != null && days >= AFKING_LOW_FUND_THRESHOLD_DAYS)) {
        this.#dismissedLowAddresses.delete(connected);
      }
    }

    this.#model = afkingFundingWarningModel({
      snapshot,
      connectedAddress,
      mode: get('ui.mode'),
      enabled: this.#enabled,
    });
    if (!this.#model.visible) {
      this.#clearOpenTimer();
      if (this.#open) this.#close({ dismiss: false });
      return;
    }
    this.#paintModel();
    if (this.#dismissedLowAddresses.has(this.#model.address) || this.#open) return;
    this.#scheduleOpen();
  }

  #paintModel() {
    const days = this.querySelector('[data-bind="afking-warning-days"]');
    const order = this.querySelector('[data-bind="afking-warning-order"]');
    if (days) days.textContent = this.#model.daysLabel || '— DAYS FUNDED';
    if (order) order.textContent = this.#model.orderLabel || '— / DAY';
    const filled = Math.max(0, Math.min(7, Number(this.#model.fundedSegments) || 0));
    this.querySelectorAll('.afking-funding-warning__meter i').forEach((segment, index) => {
      segment.classList.toggle('is-funded', index < filled);
    });
  }

  #scheduleOpen(delay = 450) {
    this.#clearOpenTimer();
    this.#openTimer = setTimeout(() => {
      this.#openTimer = null;
      if (!this.#model.visible || this.#dismissedLowAddresses.has(this.#model.address)) return;
      const otherModal = Array.from(
        globalThis.document?.querySelectorAll?.('[role="dialog"][aria-modal="true"]:not([hidden])') || [],
      ).some((dialog) => isBlockingModal(dialog, this));
      if (otherModal) {
        this.#scheduleOpen(900);
        return;
      }
      this.#show();
    }, delay);
    try { this.#openTimer?.unref?.(); } catch (_error) { /* browser timer */ }
  }

  #clearOpenTimer() {
    if (this.#openTimer != null) clearTimeout(this.#openTimer);
    this.#openTimer = null;
  }

  #show() {
    if (this.#open || !this.#model.visible) return;
    this.#returnFocus = globalThis.document?.activeElement || null;
    this.#open = true;
    this.hidden = false;
    this.removeAttribute('hidden');
    lock();
    try {
      this.querySelector('.afking-funding-warning__card')?.focus?.({ preventScroll: true });
    } catch (_error) { /* focus is progressive enhancement */ }
  }

  #close({ dismiss = false } = {}) {
    this.#clearOpenTimer();
    if (dismiss && this.#model?.address) {
      this.#dismissedLowAddresses.add(this.#model.address);
    }
    if (!this.#open) return;
    this.#open = false;
    this.hidden = true;
    this.setAttribute('hidden', '');
    unlock();
    try { this.#returnFocus?.focus?.({ preventScroll: true }); } catch (_error) { /* optional */ }
    this.#returnFocus = null;
  }

  #goToFunding() {
    this.#close({ dismiss: true });
    const disclosure = globalThis.document?.querySelector?.('#afking-passes');
    if (!disclosure) return;
    disclosure.open = true;
    const focusFunding = () => {
      const section = disclosure.querySelector?.('[data-bind="pass-afking"]') || disclosure;
      try { section.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); }
      catch (_error) { section.scrollIntoView?.(); }
      const input = disclosure.querySelector?.('[name="pass-afking-topup"]');
      try { input?.focus?.({ preventScroll: true }); } catch (_error) { /* optional */ }
      try { input?.select?.(); } catch (_error) { /* optional */ }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusFunding);
    else setTimeout(focusFunding, 0);
  }
}

if (typeof customElements !== 'undefined'
  && !customElements.get('app-afking-funding-warning')) {
  customElements.define('app-afking-funding-warning', AppAfkingFundingWarning);
}
