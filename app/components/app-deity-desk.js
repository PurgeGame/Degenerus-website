import { get, subscribe, getActingAddress, deriveCanSign } from '../app/store.js';
import {
  readDeityPassCatalog,
  readDeityBoonSlots,
  issueDeityBoon,
  smiteWithDeity,
} from '../app/passes.js';
import { boonTypePresentation } from '../app/boons.js';
import { decodeRevertReason } from '../app/reason-map.js';
import { deitySymbolPresentation } from '../app/deity-symbol.js';
import { resolvePlayerTarget } from '../app/player-target.js';

const POLL_MS = 30_000;
const ERROR_MS = 10_000;

function _ownedSymbolId(catalog, owner) {
  const wanted = String(owner || '').toLowerCase();
  if (!wanted || !(catalog?.ownersBySymbol instanceof Map)) return null;
  for (const [symbolId, address] of catalog.ownersBySymbol.entries()) {
    if (String(address || '').toLowerCase() === wanted) return Number(symbolId);
  }
  return null;
}

export function deityBoonActionLabel(presentation, slot = 0) {
  const name = String(presentation?.name || '').trim();
  if (!name) return `BOON ${Number(slot) + 1}`;
  return /\bboon\b/i.test(name) ? name : `${name} BOON`;
}

export function deityDeskModel({ catalog, owner, connected, boonState, mode = 'self' } = {}) {
  const symbolId = _ownedSymbolId(catalog, owner);
  const connectedSymbolId = _ownedSymbolId(catalog, connected);
  const usedMask = Number(boonState?.usedMask ?? 0) & 0b111;
  return {
    visible: symbolId != null && mode !== 'combined',
    symbolId,
    symbol: deitySymbolPresentation(symbolId),
    usedMask,
    canSmite: mode === 'self' && symbolId != null && connectedSymbolId === symbolId,
    remaining: 3 - [0, 1, 2].filter((slot) => (usedMask & (1 << slot)) !== 0).length,
  };
}

class AppDeityDesk extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #poll = null;
  #catalog = null;
  #boonState = null;
  #address = null;
  #busy = null;
  #requestId = 0;
  #errorTimer = null;
  #passEvent = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wire();
    for (const key of ['connected.address', 'viewing.address', 'ui.mode']) {
      this.#unsubs.push(subscribe(key, () => this.#refresh()));
    }
    this.#passEvent = () => this.#refresh();
    if (typeof document !== 'undefined') {
      document.addEventListener?.('app-pass:tx-confirmed', this.#passEvent);
    }
    this.#poll = setInterval(() => this.#refresh(), POLL_MS);
    this.#poll?.unref?.();
    this.#refresh();
  }

  disconnectedCallback() {
    if (this.#poll != null) clearInterval(this.#poll);
    this.#poll = null;
    if (this.#errorTimer != null) clearTimeout(this.#errorTimer);
    this.#errorTimer = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener?.('app-pass:tx-confirmed', this.#passEvent);
    }
    this.#passEvent = null;
    for (const unsubscribe of this.#unsubs) unsubscribe?.();
    this.#unsubs = [];
    this.#requestId += 1;
  }

  #renderShell() {
    this.innerHTML = `
      <section class="deity-desk" data-bind="deity-desk" hidden>
        <header class="deity-desk__identity">
          <span class="deity-desk__crest"><img data-bind="deity-desk-symbol" src="" alt=""></span>
          <span class="deity-desk__identity-copy"><small>DEITY PASS</small><strong data-bind="deity-desk-title">God of —</strong></span>
        </header>
        <label class="deity-desk__target">
          <span>PLAYER</span>
          <input type="text" name="deity-desk-target" placeholder="0x address or Discord ID"
                 autocomplete="off" spellcheck="false" aria-label="Wallet address or Discord user ID">
        </label>
        <div class="deity-desk__actions" aria-label="Deity actions">
          <button type="button" class="deity-desk__smite" data-write data-bind="deity-desk-smite" disabled title="Burn 200 FLIP to smite this player"><span>SMITE</span><strong>-2 SCORE</strong><small class="deity-desk__smite-cost">COST:<img src="/whitepaper/flame-logo-split.svg" alt="FLIP">200</small></button>
          ${[0, 1, 2].map((slot) => `<button type="button" data-write data-slot="${slot}" data-bind="deity-desk-boon-${slot}" disabled><span data-bind="deity-desk-boon-name-${slot}">BOON ${slot + 1}</span><strong data-bind="deity-desk-boon-effect-${slot}">RNG PENDING</strong></button>`).join('')}
        </div>
        <p class="deity-desk__feedback" data-bind="deity-desk-feedback" hidden role="status"></p>
      </section>`;
  }

  #wire() {
    for (let slot = 0; slot < 3; slot += 1) {
      this.querySelector(`[data-bind="deity-desk-boon-${slot}"]`)
        ?.addEventListener('click', (event) => this.#act(event, slot));
    }
    this.querySelector('[data-bind="deity-desk-smite"]')
      ?.addEventListener('click', (event) => this.#act(event, 'smite'));
  }

  async #refresh() {
    const address = getActingAddress();
    const mode = get('ui.mode');
    const requestId = ++this.#requestId;
    if (!address || mode === 'combined') {
      this.#address = address || null;
      this.#render();
      return;
    }
    if (String(address).toLowerCase() !== String(this.#address || '').toLowerCase()) {
      this.#catalog = null;
      this.#boonState = null;
      const input = this.querySelector('[name="deity-desk-target"]');
      if (input) input.value = '';
    }
    this.#address = address;
    const [catalog, boons] = await Promise.allSettled([
      readDeityPassCatalog(),
      readDeityBoonSlots(address),
    ]);
    if (requestId !== this.#requestId) return;
    if (catalog.status === 'fulfilled' && catalog.value) this.#catalog = catalog.value;
    this.#boonState = boons.status === 'fulfilled' ? boons.value : null;
    this.#render();
  }

  #model() {
    return deityDeskModel({
      catalog: this.#catalog,
      owner: this.#address,
      connected: get('connected.address'),
      boonState: this.#boonState,
      mode: get('ui.mode'),
    });
  }

  #render() {
    const shell = this.querySelector('[data-bind="deity-desk"]');
    if (!shell) return;
    const model = this.#model();
    shell.hidden = !model.visible;
    if (!model.visible) return;
    const symbol = this.querySelector('[data-bind="deity-desk-symbol"]');
    const title = this.querySelector('[data-bind="deity-desk-title"]');
    if (symbol && model.symbol) {
      symbol.src = model.symbol.path;
      symbol.alt = `${model.symbol.name} deity symbol`;
    }
    if (title) title.textContent = model.symbol?.title || 'Deity pass';
    const canSign = deriveCanSign();
    const input = this.querySelector('[name="deity-desk-target"]');
    if (input) input.disabled = !canSign || this.#busy != null;
    for (let slot = 0; slot < 3; slot += 1) {
      const button = this.querySelector(`[data-bind="deity-desk-boon-${slot}"]`);
      const name = this.querySelector(`[data-bind="deity-desk-boon-name-${slot}"]`);
      const effect = this.querySelector(`[data-bind="deity-desk-boon-effect-${slot}"]`);
      const used = (model.usedMask & (1 << slot)) !== 0;
      const boonType = Number(this.#boonState?.slots?.[slot] ?? 0);
      const presentation = boonType > 0 ? boonTypePresentation(boonType) : null;
      if (name) name.textContent = deityBoonActionLabel(presentation, slot);
      if (effect) effect.textContent = used ? 'ISSUED' : (presentation?.effect || 'RNG PENDING');
      if (button) {
        if (presentation?.product) {
          button.setAttribute('data-boon-product', presentation.product);
        } else {
          button.removeAttribute?.('data-boon-product');
        }
        button.disabled = !canSign || !this.#boonState?.ready || used || this.#busy != null;
        button.classList?.toggle('is-used', used);
        button.classList?.toggle('is-busy', this.#busy === slot);
        button.title = used ? 'Already issued today' : (presentation?.detail || 'Available after daily RNG');
      }
    }
    const smite = this.querySelector('[data-bind="deity-desk-smite"]');
    if (smite) {
      smite.disabled = !canSign || !model.canSmite || this.#busy != null;
      smite.title = model.canSmite
        ? 'Burn 200 FLIP to smite this player'
        : 'Only the directly connected deity owner can smite';
    }
  }

  async #act(event, action) {
    event?.preventDefault?.();
    if (this.#busy != null || !deriveCanSign()) return;
    const model = this.#model();
    if (!model.visible || (action === 'smite' && !model.canSmite)) return;
    const input = this.querySelector('[name="deity-desk-target"]');
    this.#busy = action;
    this.#setFeedback(action === 'smite' ? 'Resolving target…' : 'Resolving recipient…', false);
    this.#render();
    try {
      const target = await resolvePlayerTarget(input?.value);
      if (action === 'smite') {
        await smiteWithDeity({ deityId: model.symbolId, target });
      } else {
        await issueDeityBoon({ recipient: target, slot: action });
        this.#boonState = {
          ...this.#boonState,
          usedMask: Number(this.#boonState?.usedMask || 0) | (1 << action),
        };
      }
      if (input) input.value = '';
      this.#setFeedback(action === 'smite' ? 'Smite confirmed.' : 'Boon issued.', false);
      this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
        detail: { kind: action === 'smite' ? 'deity-smite' : 'deity-boon', target, slot: action },
        bubbles: true,
      }));
      setTimeout(() => this.#refresh(), 250);
    } catch (error) {
      const decoded = error?.userMessage ? error : decodeRevertReason(error);
      this.#setFeedback(decoded?.userMessage || error?.message || 'Deity action failed.', true);
    } finally {
      this.#busy = null;
      this.#render();
    }
  }

  #setFeedback(message, error) {
    const feedback = this.querySelector('[data-bind="deity-desk-feedback"]');
    if (!feedback) return;
    feedback.textContent = String(message || '');
    feedback.hidden = !message;
    feedback.classList?.toggle('is-error', Boolean(error));
    if (this.#errorTimer != null) clearTimeout(this.#errorTimer);
    this.#errorTimer = message ? setTimeout(() => {
      feedback.textContent = '';
      feedback.hidden = true;
      feedback.classList?.remove('is-error');
      this.#errorTimer = null;
    }, ERROR_MS) : null;
    this.#errorTimer?.unref?.();
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-deity-desk')) {
  customElements.define('app-deity-desk', AppDeityDesk);
}

export { AppDeityDesk };
