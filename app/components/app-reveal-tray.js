// /app/components/app-reveal-tray.js — bottom-pinned actionable reveal tray.
//
// Lootboxes, Degenerette bets, and ticket packs already publish their honest
// waiting/ready/busy state through pending-actions.js. This component is only
// the presentation and click router for READY presentation work:
//
//   - lootbox run() re-checks whether openBox is still needed, then either sends
//     it or replays the already-indexed contents;
//   - Degenerette run() resolves a live bet (including community batch work) or
//     replays an externally-resolved result, then stages the reel player;
//   - ticket-pack run() opens the fully indexed pack reveal with no write.
//
// Waiting-for-RNG rows deliberately do not pin a popup over the app. As soon as
// a publisher promotes one to ready, every subscriber receives the same row and
// the tray appears. The full-screen reveal overlay sits above this tray.

import { subscribePendingActions } from '../app/pending-actions.js';

const REVEAL_KINDS = new Set(['lootbox', 'degenerette', 'tickets']);
const ERROR_AUTO_CLEAR_MS = 10_000;

export function actionableRevealItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => (
    REVEAL_KINDS.has(String(item?.kind || ''))
    && (item?.state === 'ready' || item?.state === 'busy')
  ));
}

function _kindLabel(kind) {
  if (kind === 'lootbox') return 'LOOTBOX';
  if (kind === 'degenerette') return 'DEGENERETTE';
  return 'TICKET PACK';
}

class AppRevealTray extends HTMLElement {
  #initialized = false;
  #unsubscribe = null;
  #items = [];
  #busyId = null;
  #errorTimer = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#unsubscribe = subscribePendingActions((items) => {
      this.#items = actionableRevealItems(items);
      this.#render();
    });
  }

  disconnectedCallback() {
    try { this.#unsubscribe?.(); } catch (_e) { /* defensive */ }
    this.#unsubscribe = null;
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_e) { /* defensive */ }
      this.#errorTimer = null;
    }
    this.#initialized = false;
  }

  #renderShell() {
    this.innerHTML = `
      <aside class="rrt-tray" data-bind="rrt-tray" hidden aria-live="polite"
             aria-label="Reveals ready">
        <div class="rrt-head">
          <img class="rrt-head__logo" src="/whitepaper/flame-logo.svg" alt="">
          <span class="rrt-head__copy">
            <strong>READY TO OPEN</strong>
            <span data-bind="rrt-count"></span>
          </span>
        </div>
        <div class="rrt-actions" data-bind="rrt-actions"></div>
        <div class="rrt-error" data-bind="rrt-error" hidden role="alert"></div>
      </aside>
    `;
  }

  async #run(item) {
    if (this.#busyId != null || item?.state !== 'ready' || typeof item.run !== 'function') return;
    this.#busyId = item.id;
    this.#clearError();
    this.#render();
    try {
      await item.run();
    } catch (error) {
      this.#showError(error?.userMessage || error?.message || 'Could not open this result.');
    } finally {
      this.#busyId = null;
      this.#render();
    }
  }

  #render() {
    const tray = this.querySelector('[data-bind="rrt-tray"]');
    const count = this.querySelector('[data-bind="rrt-count"]');
    const host = this.querySelector('[data-bind="rrt-actions"]');
    if (!tray || !count || !host) return;
    const items = this.#items;
    tray.hidden = items.length === 0;
    count.textContent = `${items.length} ${items.length === 1 ? 'result' : 'results'}`;
    host.textContent = '';

    for (const item of items) {
      const localBusy = this.#busyId === item.id;
      const busy = item.state === 'busy' || localBusy;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `rrt-action rrt-action--${item.kind}${busy ? ' is-busy' : ''}`;
      button.disabled = busy || typeof item.run !== 'function';
      button.setAttribute('data-action-id', item.id);
      button.setAttribute('aria-label', `${item.shortLabel || 'Open'}: ${item.label}`);

      const art = document.createElement('span');
      art.className = `rrt-action__art rrt-action__art--${item.kind}`;
      art.setAttribute('aria-hidden', 'true');
      art.textContent = item.kind === 'lootbox' ? '?' : item.kind === 'degenerette' ? 'D' : '✦';

      const copy = document.createElement('span');
      copy.className = 'rrt-action__copy';
      const kind = document.createElement('span');
      kind.className = 'rrt-action__kind';
      kind.textContent = _kindLabel(item.kind);
      const label = document.createElement('strong');
      label.className = 'rrt-action__label';
      label.textContent = item.label;
      const detail = document.createElement('span');
      detail.className = 'rrt-action__detail';
      detail.textContent = item.detail;
      copy.appendChild(kind);
      copy.appendChild(label);
      copy.appendChild(detail);

      const cta = document.createElement('span');
      cta.className = 'rrt-action__cta';
      cta.textContent = busy ? 'OPENING…' : String(item.shortLabel || 'Open').toUpperCase();

      button.appendChild(art);
      button.appendChild(copy);
      button.appendChild(cta);
      if (!button.disabled) button.addEventListener('click', () => this.#run(item));
      host.appendChild(button);
    }
  }

  #showError(message) {
    const error = this.querySelector('[data-bind="rrt-error"]');
    if (!error) return;
    error.textContent = String(message || 'Could not open this result.');
    error.hidden = false;
    if (this.#errorTimer != null) clearTimeout(this.#errorTimer);
    this.#errorTimer = setTimeout(() => this.#clearError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimer && typeof this.#errorTimer.unref === 'function') {
      try { this.#errorTimer.unref(); } catch (_e) { /* browser timer */ }
    }
  }

  #clearError() {
    const error = this.querySelector('[data-bind="rrt-error"]');
    if (error) {
      error.textContent = '';
      error.hidden = true;
    }
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_e) { /* defensive */ }
      this.#errorTimer = null;
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-reveal-tray')) {
  customElements.define('app-reveal-tray', AppRevealTray);
}

export { AppRevealTray };
