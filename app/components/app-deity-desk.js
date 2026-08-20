import { get, subscribe, getActingAddress, deriveCanSign } from '../app/store.js';
import { registerComponentPoll } from '../app/component-poll.js';
import {
  readDeityPassCatalog,
  readDeityBoonSlots,
  issueDeityBoon,
  smiteWithDeity,
} from '../app/passes.js';
import { boonTypePresentation } from '../app/boons.js';
import { decodeRevertReason } from '../app/reason-map.js';
import { deitySymbolPresentation } from '../app/deity-symbol.js';
import { fetchPlayerSuggestions, resolvePlayerTarget } from '../app/player-target.js';
import { compactUiError } from '../app/ui-error.js';

const POLL_MS = 30_000;
const ERROR_MS = 10_000;
const SUGGEST_DEBOUNCE_MS = 220;

function _ownedSymbolId(catalog, owner) {
  const wanted = String(owner || '').toLowerCase();
  if (!wanted || !(catalog?.ownersBySymbol instanceof Map)) return null;
  for (const [symbolId, address] of catalog.ownersBySymbol.entries()) {
    if (String(address || '').toLowerCase() === wanted) return Number(symbolId);
  }
  return null;
}

export function deityBoonActionLabel(presentation, slot = 0) {
  const product = String(presentation?.product || '').trim();
  const compactNames = {
    purchase: 'TICKETS BOON',
    lootbox: 'LUCKBOX BOON',
    coinflip: 'COINFLIP BOON',
    quests: 'QUEST BOON',
    decimator: 'DECIMATOR BOON',
    whale: 'WHALE BOON',
    activity: 'RATING BOON',
    deity: 'DEITY BOON',
    lazy: 'LAZY BOON',
    'degenerette-eth': 'DEGENERETTE BOON',
    'degenerette-flip': 'DEGENERETTE BOON',
    'degenerette-wwxrp': 'DEGENERETTE BOON',
  };
  if (compactNames[product]) return compactNames[product];
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
  #suggestTimer = null;
  #suggestAbort = null;
  #suggestIndex = -1;
  #outsideTarget = null;

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
    this.#poll = registerComponentPoll(() => this.#refresh(), POLL_MS);
    this.#refresh();
  }

  disconnectedCallback() {
    if (typeof this.#poll === 'function') this.#poll();
    this.#poll = null;
    if (this.#errorTimer != null) clearTimeout(this.#errorTimer);
    this.#errorTimer = null;
    if (this.#suggestTimer != null) clearTimeout(this.#suggestTimer);
    this.#suggestTimer = null;
    this.#suggestAbort?.abort?.();
    this.#suggestAbort = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener?.('click', this.#outsideTarget);
    }
    this.#outsideTarget = null;
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
          <span class="deity-desk__identity-copy">
            <span class="deity-pass-lockup deity-desk__wordmark">
              <img class="deity-pass-lockup__symbol" data-bind="deity-desk-symbol" src="" alt="">
              <img class="deity-pass-lockup__frame" src="/app/assets/deity-pass-lockup-v3.webp"
                   width="1400" height="320" alt="Deity Pass">
            </span>
            <strong data-bind="deity-desk-title">God of —</strong>
            <span class="deity-desk__budget" data-bind="deity-desk-budget">
              <b>—</b> OF 3 BOONS LEFT TODAY
            </span>
          </span>
        </header>
        <div class="deity-desk__target">
          <div class="deity-desk__target-head">
            <label for="deity-desk-target-input">TARGET PLAYER</label>
            <span class="deity-desk__feedback" data-bind="deity-desk-feedback"
                  hidden role="status"></span>
          </div>
          <span class="deity-desk__target-control">
            <input id="deity-desk-target-input" type="text" name="deity-desk-target"
                   placeholder="Wallet, Discord ID, or @name" autocomplete="off" spellcheck="false"
                   role="combobox" aria-autocomplete="list" aria-expanded="false"
                   aria-controls="deity-desk-target-results"
                   aria-label="Target player wallet, Discord user ID, or Discord name">
            <ul id="deity-desk-target-results" class="deity-desk__suggestions"
                data-bind="deity-desk-suggestions" role="listbox" hidden></ul>
          </span>
        </div>
        <div class="deity-desk__actions" aria-label="Deity actions">
          <button type="button" class="deity-desk__smite" data-write data-bind="deity-desk-smite" data-boon-direction="down" data-boon-strength="low" disabled title="Burn 200 FLIP to smite this player"><i class="deity-desk__boon-mark deity-desk__smite-mark" aria-hidden="true"><img class="deity-desk__boon-icon deity-desk__smite-icon" src="/app/assets/boons/smite-crash-bolt-down.svg" alt=""></i><span>SMITE</span><strong>-2 DEGEN RATING</strong><small class="deity-desk__smite-cost">COST:<img src="/whitepaper/flame-logo-split.svg" alt="FLIP">200</small></button>
          ${[0, 1, 2].map((slot) => `<button type="button" data-write data-slot="${slot}" data-bind="deity-desk-boon-${slot}" disabled><i class="deity-desk__boon-mark" data-bind="deity-desk-boon-mark-${slot}" aria-hidden="true" hidden><img class="deity-desk__boon-icon" data-bind="deity-desk-boon-icon-${slot}" alt=""></i><span data-bind="deity-desk-boon-name-${slot}">BOON ${slot + 1}</span><strong data-bind="deity-desk-boon-effect-${slot}">RNG PENDING</strong></button>`).join('')}
        </div>
      </section>`;
  }

  #wire() {
    for (let slot = 0; slot < 3; slot += 1) {
      this.querySelector(`[data-bind="deity-desk-boon-${slot}"]`)
        ?.addEventListener('click', (event) => this.#act(event, slot));
    }
    this.querySelector('[data-bind="deity-desk-smite"]')
      ?.addEventListener('click', (event) => this.#act(event, 'smite'));
    const input = this.querySelector('[name="deity-desk-target"]');
    input?.addEventListener('input', () => {
      delete input.dataset.targetAddress;
      delete input.dataset.targetName;
      input.classList?.remove('is-player-selected');
      this.#scheduleSuggestions(input.value);
    });
    input?.addEventListener('keydown', (event) => this.#onTargetKeydown(event));
    this.#outsideTarget = (event) => {
      if (event?.target && this.contains?.(event.target)) return;
      this.#closeSuggestions();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener?.('click', this.#outsideTarget);
    }
  }

  #scheduleSuggestions(value) {
    if (this.#suggestTimer != null) clearTimeout(this.#suggestTimer);
    this.#suggestTimer = null;
    const query = String(value || '').trim().replace(/^@/, '');
    if (query.length < 2 || !/[a-z]/i.test(query)) {
      this.#suggestAbort?.abort?.();
      this.#suggestAbort = null;
      this.#closeSuggestions();
      return;
    }
    this.#suggestTimer = setTimeout(() => {
      this.#suggestTimer = null;
      void this.#loadSuggestions(query);
    }, SUGGEST_DEBOUNCE_MS);
    this.#suggestTimer?.unref?.();
  }

  async #loadSuggestions(query) {
    this.#suggestAbort?.abort?.();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    this.#suggestAbort = controller;
    try {
      const suggestions = await fetchPlayerSuggestions(query, {
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (controller?.signal?.aborted || this.#suggestAbort !== controller) return;
      this.#renderSuggestions(suggestions);
    } catch (error) {
      if (error?.name !== 'AbortError') this.#closeSuggestions();
    } finally {
      if (this.#suggestAbort === controller) this.#suggestAbort = null;
    }
  }

  #renderSuggestions(suggestions) {
    const list = this.querySelector('[data-bind="deity-desk-suggestions"]');
    const input = this.querySelector('[name="deity-desk-target"]');
    if (!list || !input) return;
    list.textContent = '';
    this.#suggestIndex = -1;
    for (const [index, suggestion] of (suggestions || []).entries()) {
      const option = document.createElement('li');
      option.id = `deity-desk-target-option-${index}`;
      option.className = 'deity-desk__suggestion';
      option.tabIndex = -1;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.dataset.address = suggestion.address;
      option.dataset.name = suggestion.name;

      if (suggestion.avatar) {
        const avatar = document.createElement('img');
        avatar.className = 'deity-desk__suggestion-avatar';
        avatar.src = suggestion.avatar;
        avatar.alt = '';
        option.appendChild(avatar);
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'deity-desk__suggestion-avatar is-fallback';
        fallback.textContent = suggestion.name.slice(0, 1).toUpperCase();
        fallback.setAttribute('aria-hidden', 'true');
        option.appendChild(fallback);
      }

      const identity = document.createElement('span');
      identity.className = 'deity-desk__suggestion-identity';
      const name = document.createElement('strong');
      name.textContent = `@${suggestion.name}`;
      const address = document.createElement('small');
      address.textContent = `${suggestion.address.slice(0, 6)}…${suggestion.address.slice(-4)}`;
      identity.appendChild(name);
      identity.appendChild(address);
      option.appendChild(identity);
      option.addEventListener('mouseenter', () => this.#setSuggestionIndex(index));
      option.addEventListener('mousedown', (event) => event?.preventDefault?.());
      option.addEventListener('click', (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this.#selectSuggestion(option);
      });
      list.appendChild(option);
    }
    const hasSuggestions = list.children.length > 0;
    list.hidden = !hasSuggestions;
    input.setAttribute('aria-expanded', String(hasSuggestions));
    this.querySelector('[data-bind="deity-desk"]')
      ?.classList?.toggle('has-target-suggestions', hasSuggestions);
  }

  #suggestionRows() {
    return Array.from(this.querySelectorAll('.deity-desk__suggestion'));
  }

  #setSuggestionIndex(index) {
    const rows = this.#suggestionRows();
    if (rows.length === 0) return;
    this.#suggestIndex = Math.max(0, Math.min(rows.length - 1, Number(index) || 0));
    const input = this.querySelector('[name="deity-desk-target"]');
    rows.forEach((row, rowIndex) => {
      const active = rowIndex === this.#suggestIndex;
      row.classList?.toggle('is-active', active);
      row.setAttribute('aria-selected', String(active));
    });
    input?.setAttribute('aria-activedescendant', rows[this.#suggestIndex].id);
  }

  #onTargetKeydown(event) {
    const rows = this.#suggestionRows();
    if (event?.key === 'Escape') {
      this.#closeSuggestions();
      return;
    }
    if (rows.length === 0 || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event?.key)) return;
    event.preventDefault?.();
    if (event.key === 'Enter') {
      this.#selectSuggestion(rows[Math.max(0, this.#suggestIndex)]);
      return;
    }
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const current = this.#suggestIndex < 0 ? (direction > 0 ? -1 : 0) : this.#suggestIndex;
    this.#setSuggestionIndex((current + direction + rows.length) % rows.length);
  }

  #selectSuggestion(option) {
    const input = this.querySelector('[name="deity-desk-target"]');
    const address = String(option?.dataset?.address || '');
    const name = String(option?.dataset?.name || '');
    if (!input || !address || !name) return;
    input.value = `@${name}`;
    input.dataset.targetAddress = address;
    input.dataset.targetName = name;
    input.classList?.add('is-player-selected');
    this.#closeSuggestions();
    input.focus?.();
  }

  #closeSuggestions() {
    const list = this.querySelector('[data-bind="deity-desk-suggestions"]');
    const input = this.querySelector('[name="deity-desk-target"]');
    if (list) list.hidden = true;
    input?.setAttribute('aria-expanded', 'false');
    input?.removeAttribute?.('aria-activedescendant');
    this.querySelector('[data-bind="deity-desk"]')
      ?.classList?.remove('has-target-suggestions');
    this.#suggestIndex = -1;
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
      if (input) {
        input.value = '';
        delete input.dataset.targetAddress;
        delete input.dataset.targetName;
        input.classList?.remove('is-player-selected');
      }
      this.#closeSuggestions();
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
    // The one number a deity owner checks daily: how much power is still unspent.
    const budget = this.querySelector('[data-bind="deity-desk-budget"] b');
    if (budget) budget.textContent = String(model.remaining);
    this.querySelector('[data-bind="deity-desk-budget"]')
      ?.classList?.toggle('is-spent', model.remaining === 0);
    const canSign = deriveCanSign();
    const input = this.querySelector('[name="deity-desk-target"]');
    if (input) input.disabled = !canSign || this.#busy != null;
    if (input?.disabled) this.#closeSuggestions();
    for (let slot = 0; slot < 3; slot += 1) {
      const button = this.querySelector(`[data-bind="deity-desk-boon-${slot}"]`);
      const mark = this.querySelector(`[data-bind="deity-desk-boon-mark-${slot}"]`);
      const icon = this.querySelector(`[data-bind="deity-desk-boon-icon-${slot}"]`);
      const name = this.querySelector(`[data-bind="deity-desk-boon-name-${slot}"]`);
      const effect = this.querySelector(`[data-bind="deity-desk-boon-effect-${slot}"]`);
      const used = (model.usedMask & (1 << slot)) !== 0;
      const boonType = Number(this.#boonState?.slots?.[slot] ?? 0);
      const presentation = boonType > 0 ? boonTypePresentation(boonType) : null;
      if (mark) mark.hidden = !presentation;
      if (icon) {
        icon.hidden = !presentation?.icon;
        if (presentation?.icon) icon.src = presentation.icon;
        else icon.removeAttribute?.('src');
      }
      if (name) name.textContent = deityBoonActionLabel(presentation, slot);
      if (effect) effect.textContent = used ? 'ISSUED' : (presentation?.effect || 'RNG PENDING');
      if (button) {
        if (presentation?.product) {
          button.setAttribute('data-boon-product', presentation.product);
          button.setAttribute('data-boon-strength', presentation.strength);
          button.setAttribute('data-boon-tier', String(presentation.tier));
          button.setAttribute('data-boon-pips', presentation.pips);
          button.setAttribute('data-boon-direction', presentation.direction);
        } else {
          button.removeAttribute?.('data-boon-product');
          button.removeAttribute?.('data-boon-strength');
          button.removeAttribute?.('data-boon-tier');
          button.removeAttribute?.('data-boon-pips');
          button.removeAttribute?.('data-boon-direction');
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
      const target = await resolvePlayerTarget(input?.dataset?.targetAddress || input?.value);
      if (action === 'smite') {
        await smiteWithDeity({ deityId: model.symbolId, target });
      } else {
        await issueDeityBoon({ recipient: target, slot: action });
        this.#boonState = {
          ...this.#boonState,
          usedMask: Number(this.#boonState?.usedMask || 0) | (1 << action),
        };
      }
      if (input) {
        input.value = '';
        delete input.dataset.targetAddress;
        delete input.dataset.targetName;
        input.classList?.remove('is-player-selected');
      }
      this.#closeSuggestions();
      this.#setFeedback(action === 'smite' ? 'Smite confirmed.' : 'Boon issued.', false);
      this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
        detail: { kind: action === 'smite' ? 'deity-smite' : 'deity-boon', target, slot: action },
        bubbles: true,
      }));
      setTimeout(() => this.#refresh(), 250);
    } catch (error) {
      const decoded = error?.userMessage ? error : decodeRevertReason(error);
      this.#setFeedback(
        compactUiError(error, decoded?.userMessage || 'Deity action did not go through.'),
        true,
      );
    } finally {
      this.#busy = null;
      this.#render();
    }
  }

  #setFeedback(message, error) {
    const feedback = this.querySelector('[data-bind="deity-desk-feedback"]');
    if (!feedback) return;
    feedback.textContent = String(message || '');
    feedback.title = String(message || '');
    feedback.hidden = !message;
    feedback.classList?.toggle('is-error', Boolean(error));
    if (this.#errorTimer != null) clearTimeout(this.#errorTimer);
    this.#errorTimer = message ? setTimeout(() => {
      feedback.textContent = '';
      feedback.removeAttribute?.('title');
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
