// Dedicated ALL IN confirmation sheet. The purchase panel owns balance reads
// and exact writes; this component only chooses a currency/format and presents
// the fresh quote. It never edits the player's ordinary purchase drafts.

import { lock, unlock } from '../app/scroll-lock.js';
import { questCompletionBonusModel } from '../app/quest-objectives.js';
import { get, subscribe } from '../app/store.js';
import { compactUiError } from '../app/ui-error.js';

export function allInQuestProduct(quote) {
  const target = String(quote?.target || '');
  const currency = String(quote?.currency || '').toUpperCase();
  if (target === 'tickets') return currency === 'FLIP' ? 'redeem-flip' : 'purchase';
  if (target === 'lootbox') return 'lootbox';
  if (target === 'coinflip') return 'coinflip';
  if (target === 'decimator') return 'decimator';
  if (target === 'degenerette') {
    return currency === 'FLIP' ? 'degenerette-flip' : 'degenerette-eth';
  }
  return null;
}

export function randomAllInTarget(targets = [], random = Math.random) {
  const choices = Array.isArray(targets) ? targets.filter(Boolean) : [];
  if (choices.length === 0) return null;
  let roll = 0;
  try { roll = Number(random()); } catch (_e) { roll = 0; }
  if (!Number.isFinite(roll)) roll = 0;
  const index = Math.min(choices.length - 1, Math.max(0, Math.floor(roll * choices.length)));
  return choices[index];
}

export function randomAllInSelection({
  destinations = [],
  currency = 'ETH',
  currentSpins = 5,
  maxSpins = 25,
  quote,
  random = Math.random,
} = {}) {
  if (typeof quote !== 'function') return null;
  const concrete = Array.isArray(destinations)
    ? destinations.filter((target) => target && target !== 'random')
    : [];
  const spinsByTarget = new Map();
  const viable = concrete.filter((target) => {
    if (target !== 'degenerette') {
      try { return Boolean(quote({ currency, target, spins: currentSpins })?.valid); }
      catch (_error) { return false; }
    }
    const spins = Array.from(
      { length: Math.max(1, Math.trunc(Number(maxSpins) || 1)) },
      (_unused, index) => index + 1,
    ).filter((spinCount) => {
      try { return Boolean(quote({ currency, target, spins: spinCount })?.valid); }
      catch (_error) { return false; }
    });
    spinsByTarget.set(target, spins);
    return spins.length > 0;
  });
  const target = randomAllInTarget(viable, random);
  if (!target) return null;
  if (target !== 'degenerette') return { target, spins: currentSpins };
  return { target, spins: Number(randomAllInTarget(spinsByTarget.get(target), random)) || 1 };
}

export function allInTargetState({ target, currency = 'ETH', destinations = [] } = {}) {
  const choices = Array.isArray(destinations) ? destinations.filter(Boolean) : [];
  const isRandom = target === 'random';
  const available = isRandom ? choices.length > 0 : choices.includes(target);
  const redemptionClosed = currency === 'FLIP' && target === 'tickets' && !available;
  return {
    available,
    visible: available || redemptionClosed,
    unavailableLabel: redemptionClosed ? 'REDEMPTION CLOSED' : '',
  };
}

class AppAllInDialog extends HTMLElement {
  #initialized = false;
  #open = false;
  #busy = false;
  #detail = null;
  #returnFocus = null;
  #currency = 'ETH';
  #target = 'tickets';
  #spins = 5;
  #blindSelection = null;
  #refreshSeq = 0;
  #questUnsub = null;
  #targetByCurrency = { ETH: 'tickets', FLIP: 'coinflip' };
  #openListener = (event) => this.#show(event);

  connectedCallback() {
    if (!this.#initialized) {
      this.#initialized = true;
      this.#renderShell();
      this.#wire();
    }
    if (typeof document !== 'undefined') {
      document.addEventListener?.('app-all-in:open', this.#openListener);
    }
    this.#questUnsub ??= subscribe('ui.questObjectives', () => {
      if (this.#open) this.#render();
    });
  }

  disconnectedCallback() {
    if (typeof document !== 'undefined') {
      document.removeEventListener?.('app-all-in:open', this.#openListener);
    }
    try { this.#questUnsub?.(); } catch (_e) { /* defensive */ }
    this.#questUnsub = null;
    if (this.#open) {
      this.#open = false;
      unlock();
    }
  }

  #renderShell() {
    this.innerHTML = `
      <div class="qst-action-dialog allin-dialog" data-bind="allin-dialog" role="dialog"
           aria-modal="true" aria-labelledby="allin-title" hidden>
        <button type="button" class="qst-action-dialog__backdrop" data-bind="allin-close"
                aria-label="Close ALL IN"></button>
        <section class="qst-action-dialog__card allin-dialog__card">
          <span class="qst-action-dialog__eyebrow">RISK IT ALL</span>
          <h3 id="allin-title">CHOOSE YOUR ALL IN</h3>

          <div class="allin-step">
            <span class="allin-step__label">1 · CURRENCY</span>
            <div class="deg-currency-picker allin-currencies" role="group" aria-label="ALL IN currency">
              <button type="button" class="deg-currency-option allin-currency is-selected"
                      data-currency="ETH" aria-pressed="true" aria-label="Go all in with ETH">
                <img src="/badges-circular/crypto_06_ethereum_green.svg" alt="">
                <strong>ETH</strong>
              </button>
              <button type="button" class="deg-currency-option allin-currency"
                      data-currency="FLIP" aria-pressed="false" aria-label="Go all in with FLIP">
                <img src="/whitepaper/flame-logo-split.svg" alt="">
                <strong>FLIP</strong>
              </button>
            </div>
          </div>

          <div class="allin-step">
            <span class="allin-step__label">2 · FORMAT</span>
            <div class="qst-action-choice allin-targets" role="group" aria-label="ALL IN format">
              <button type="button" data-target="tickets">▦ TICKETS</button>
              <button type="button" data-target="lootbox">◇ LUCKBOX</button>
              <button type="button" data-target="degenerette">✦ DEGENERETTE</button>
              <button type="button" data-target="coinflip">◐ COINFLIP</button>
              <button type="button" data-target="decimator">◆ DECIMATOR</button>
              <button type="button" data-target="random" aria-label="Choose a hidden random format">🎲 RANDOM</button>
            </div>
          </div>

          <label class="qst-action-adjust allin-spins" data-bind="allin-spins" hidden>
            <span class="allin-spins__readout">SPINS <output data-bind="allin-spins-value">5</output></span>
            <input class="allin-spins__range" type="range" name="allin-spins"
                   min="1" max="25" value="5" step="1" aria-label="Degenerette spins">
          </label>

          <p class="allin-feedback" data-bind="allin-feedback" aria-live="polite"></p>
          <p class="allin-quest-bonus" data-bind="allin-quest-bonus" role="status" hidden></p>
          <button type="button" class="qst-action-confirm allin-confirm is-incomplete"
                  data-bind="allin-confirm" disabled>ALL IN UNAVAILABLE</button>
          <button type="button" class="allin-too-risky" data-bind="allin-close">TOO RISKY</button>
        </section>
      </div>`;
  }

  #wire() {
    for (const close of this.querySelectorAll('[data-bind="allin-close"]')) {
      close.addEventListener('click', () => this.#close());
    }
    for (const button of this.querySelectorAll('[data-currency]')) {
      button.addEventListener('click', () => this.#selectCurrency(button.dataset.currency));
    }
    for (const button of this.querySelectorAll('[data-target]')) {
      button.addEventListener('click', () => this.#selectTarget(button.dataset.target));
    }
    const spins = this.querySelector('[name="allin-spins"]');
    spins?.addEventListener('input', () => this.#readSpins());
    spins?.addEventListener('change', () => this.#readSpins());
    this.querySelector('[data-bind="allin-confirm"]')?.addEventListener('click', () => this.#confirm());
    this.querySelector('[data-bind="allin-dialog"]')?.addEventListener('keydown', (event) => {
      if (event?.key === 'Escape') this.#close();
    });
  }

  #show(event) {
    const detail = event?.detail;
    if (typeof detail?.quote !== 'function' || typeof detail?.confirm !== 'function') return;
    this.#detail = detail;
    this.#returnFocus = event?.target || null;
    this.#currency = 'ETH';
    this.#targetByCurrency = { ETH: 'tickets', FLIP: 'coinflip' };
    this.#target = this.#firstTarget('ETH', 'tickets');
    this.#spins = 5;
    this.#blindSelection = null;
    this.#busy = false;
    const dialog = this.querySelector('[data-bind="allin-dialog"]');
    if (!dialog) return;
    if (!this.#open) lock();
    this.#open = true;
    dialog.hidden = false;
    dialog.removeAttribute?.('hidden');
    this.#render();
    // Privacy spoilers belong only to presentation. Warm both real balances
    // together so the initial ETH quote and a later FLIP switch cannot remain
    // stranded at "balance loading" behind a hidden display value.
    void this.#refreshCurrencies(['ETH', 'FLIP']);
    try { this.querySelector('[data-currency="ETH"]')?.focus?.({ preventScroll: true }); }
    catch (_e) { /* focus is progressive enhancement */ }
  }

  #close() {
    if (!this.#open || this.#busy) return;
    const dialog = this.querySelector('[data-bind="allin-dialog"]');
    if (dialog) {
      dialog.hidden = true;
      dialog.setAttribute?.('hidden', '');
    }
    this.#open = false;
    this.#refreshSeq += 1;
    this.#detail = null;
    unlock();
    try { this.#returnFocus?.focus?.({ preventScroll: true }); } catch (_e) { /* optional */ }
    this.#returnFocus = null;
  }

  #destinations(currency = this.#currency) {
    const rows = this.#detail?.destinations?.[currency];
    return Array.isArray(rows) ? rows.filter(Boolean) : [];
  }

  #firstTarget(currency, preferred) {
    const destinations = this.#destinations(currency);
    return destinations.includes(preferred) ? preferred : (destinations[0] || '');
  }

  #selection(target = this.#target, spins = this.#spins) {
    if (target === 'random') {
      return this.#blindSelection
        ? { currency: this.#currency, ...this.#blindSelection, blind: true }
        : { currency: this.#currency, target: '', spins: 1, blind: true };
    }
    return { currency: this.#currency, target, spins };
  }

  #quote(target = this.#target, spins = this.#spins) {
    try { return this.#detail?.quote?.(this.#selection(target, spins)) || null; }
    catch (error) {
      return {
        valid: false,
        message: compactUiError(error, 'ALL IN quote unavailable.'),
        buttonLabel: 'ALL IN UNAVAILABLE',
      };
    }
  }

  #selectCurrency(currency) {
    const next = currency === 'FLIP' ? 'FLIP' : 'ETH';
    this.#currency = next;
    this.#blindSelection = null;
    this.#target = this.#firstTarget(next, this.#targetByCurrency[next]);
    this.#targetByCurrency[next] = this.#target;
    this.#render();
    void this.#refreshCurrency(next);
  }

  async #refreshCurrency(currency) {
    return this.#refreshCurrencies([currency]);
  }

  async #refreshCurrencies(currencies) {
    const detail = this.#detail;
    if (!detail || typeof detail.refreshCurrency !== 'function') return;
    const seq = ++this.#refreshSeq;
    const unique = [...new Set((Array.isArray(currencies) ? currencies : []).filter(Boolean))];
    await Promise.allSettled(unique.map(async (currency) => {
      try { await detail.refreshCurrency(currency); }
      catch (_error) { /* the existing indexed quote remains a valid fallback */ }
      // Paint each balance as soon as it settles. A slow FLIP RPC must not
      // hold the initial ETH quote at "balance loading" (or vice versa).
      if (!this.#open || this.#detail !== detail || seq !== this.#refreshSeq) return;
      this.#render();
    }));
  }

  #selectTarget(target) {
    if (target === 'random') {
      this.#blindSelection = this.#rollBlindSelection();
      this.#target = 'random';
      this.#render();
      return;
    }
    if (!this.#destinations().includes(target)) return;
    this.#blindSelection = null;
    this.#target = target;
    this.#targetByCurrency[this.#currency] = target;
    this.#render();
  }

  #rollBlindSelection() {
    return randomAllInSelection({
      destinations: this.#destinations(),
      currency: this.#currency,
      currentSpins: this.#spins,
      maxSpins: this.#spinMax(),
      quote: (selection) => this.#detail?.quote?.(selection),
    });
  }

  #spinMax() {
    return this.#currency === 'FLIP' ? 15 : 25;
  }

  #readSpins() {
    const input = this.querySelector('[name="allin-spins"]');
    const raw = Math.trunc(Number(input?.value) || 1);
    this.#spins = Math.max(1, Math.min(this.#spinMax(), raw));
    if (input) input.value = String(this.#spins);
    this.#render();
  }

  #render() {
    if (!this.#detail) return;
    const destinations = this.#destinations();
    this.querySelector('.allin-targets')?.classList?.toggle(
      'has-decimator',
      destinations.includes('decimator'),
    );
    // RANDOM is a chooser state rather than a concrete destination. Keep it
    // selected after its hidden destination has been rolled; otherwise every
    // render immediately falls back to the first visible format and the dice
    // appears to do nothing.
    if (this.#target !== 'random' && !destinations.includes(this.#target)) {
      this.#target = this.#firstTarget(this.#currency, '');
    }
    for (const button of this.querySelectorAll('[data-currency]')) {
      const selected = button.dataset.currency === this.#currency;
      button.classList?.toggle('is-selected', selected);
      button.setAttribute?.('aria-pressed', String(selected));
    }
    for (const button of this.querySelectorAll('[data-target]')) {
      const state = allInTargetState({
        target: button.dataset.target,
        currency: this.#currency,
        destinations,
      });
      const selected = state.available && button.dataset.target === this.#target;
      button.hidden = !state.visible;
      if (state.visible) button.removeAttribute?.('hidden');
      else button.setAttribute?.('hidden', '');
      button.disabled = !state.available || this.#busy;
      button.classList?.toggle('is-selected', selected);
      button.classList?.toggle('is-unavailable', state.visible && !state.available);
      button.setAttribute?.('aria-pressed', String(selected));
      button.setAttribute?.('aria-disabled', String(!state.available || this.#busy));
      if (state.unavailableLabel) {
        button.setAttribute?.('data-availability-label', state.unavailableLabel);
        button.title = 'FLIP ticket redemption is not open';
      } else {
        button.removeAttribute?.('data-availability-label');
        if (button.dataset.target === 'tickets') button.removeAttribute?.('title');
      }
    }
    const spinsWrap = this.querySelector('[data-bind="allin-spins"]');
    const showSpins = this.#target === 'degenerette';
    if (spinsWrap) {
      spinsWrap.hidden = !showSpins;
      if (showSpins) spinsWrap.removeAttribute?.('hidden');
      else spinsWrap.setAttribute?.('hidden', '');
    }
    const spinInput = this.querySelector('[name="allin-spins"]');
    if (spinInput) {
      this.#spins = Math.max(1, Math.min(this.#spinMax(), this.#spins));
      spinInput.value = String(this.#spins);
      spinInput.max = String(this.#spinMax());
      spinInput.disabled = this.#busy;
    }
    const spinValue = this.querySelector('[data-bind="allin-spins-value"]');
    if (spinValue) spinValue.textContent = String(this.#spins);
    for (const button of this.querySelectorAll('[data-currency]')) {
      button.disabled = this.#busy;
    }

    const quote = this.#quote();
    const valid = Boolean(quote?.valid);
    const feedback = this.querySelector('[data-bind="allin-feedback"]');
    const questBonus = this.querySelector('[data-bind="allin-quest-bonus"]');
    const confirm = this.querySelector('[data-bind="allin-confirm"]');
    if (feedback) feedback.textContent = valid ? '' : (quote?.message || 'Choose another format.');
    if (questBonus) {
      const completion = valid
        ? questCompletionBonusModel(
            get('ui.questObjectives'),
            allInQuestProduct(quote),
            quote.spendWei,
          )
        : null;
      questBonus.hidden = completion == null;
      questBonus.textContent = completion?.message || '';
    }
    if (confirm) {
      const buttonLabel = this.#target === 'random' && valid
        ? `ALL IN BLIND: ${quote.spendLabel}`
        : (quote?.buttonLabel || 'ALL IN UNAVAILABLE');
      confirm.textContent = this.#busy ? 'SUBMITTING ALL IN…' : buttonLabel;
      confirm.disabled = this.#busy || !valid;
      confirm.classList?.toggle('is-incomplete', !valid);
    }
  }

  async #confirm() {
    if (this.#busy) return;
    const quote = this.#quote();
    if (!quote?.valid) return;
    this.#busy = true;
    this.#render();
    try {
      const completed = await this.#detail.confirm(this.#selection(), quote.fingerprint);
      this.#busy = false;
      if (completed !== false) this.#close();
      else this.#render();
    } catch (error) {
      this.#busy = false;
      const feedback = this.querySelector('[data-bind="allin-feedback"]');
      const message = compactUiError(error, 'ALL IN did not go through. Try again.');
      if (feedback) feedback.textContent = message;
      this.#render();
      if (feedback) feedback.textContent = message;
    }
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-all-in-dialog')) {
    customElements.define('app-all-in-dialog', AppAllInDialog);
  }
}

export { AppAllInDialog };
