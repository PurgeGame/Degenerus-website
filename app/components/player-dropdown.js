// /app/components/player-dropdown.js — Phase 58 Plan 04 player typeahead (DD-02 consumer).
//
// <player-dropdown> Custom Element. Debounced typeahead consuming Phase 57's
// GET /players/search?q=<2+chars>&limit=25. Picking a not-self result writes
// to viewing.address; store.js's deriveMode subscriber (plan 58-02) auto-flips
// ui.mode to 'view' on the next microtask, and router.js's URL mirror auto-
// syncs ?as= via history.replaceState.
//
// Race-free: AbortController per keystroke (mirrors /app/app/polling.js L88-98).
// Each new search aborts the previous in-flight fetch's signal so a slow earlier
// response cannot overwrite results from a newer keystroke.
//
// Security (T-58-18): server response data (affiliateCode, address) is rendered
// via element.textContent — never innerHTML interpolation. Address abbreviation
// done in JS via String.prototype.slice. Static skeleton uses innerHTML for
// trusted literal markup only.

import { update } from '../app/store.js';
import { API_BASE } from '../../beta/app/constants.js';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;
const SEARCH_LIMIT = 25;
const DISABLED_TOOLTIP_NA = ''; // unused — kept-out by design (no tooltip on the dropdown itself)

export class PlayerDropdown extends HTMLElement {
  constructor() {
    super();
    this._abort = null;
    this._debounceTimer = null;
    this._docClickHandler = null;
  }

  connectedCallback() {
    // Static skeleton — trusted literal markup only. Per-row content is
    // appended via document.createElement + textContent inside #renderResults.
    this.innerHTML = `
      <input class="player-search-input"
        type="text"
        placeholder="Search address or affiliate code…"
        aria-label="Search players"
        autocomplete="off"
        spellcheck="false">
      <ul class="player-search-results" role="listbox" hidden></ul>`;

    const input = this.querySelector('input');
    const results = this.querySelector('ul');

    input.addEventListener('input', () => {
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      const q = (input.value || '').trim();
      if (q.length < MIN_QUERY_LEN) {
        results.hidden = true;
        return;
      }
      this._debounceTimer = setTimeout(() => this._search(q, results), DEBOUNCE_MS);
    });

    // Close result list when clicking outside the dropdown.
    this._docClickHandler = (e) => {
      if (e && e.target && typeof this.contains === 'function' && !this.contains(e.target)) {
        results.hidden = true;
      }
    };
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('click', this._docClickHandler);
    }

    // Close on Escape.
    input.addEventListener('keydown', (e) => {
      if (e && e.key === 'Escape') {
        results.hidden = true;
        if (typeof input.blur === 'function') input.blur();
      }
    });
  }

  disconnectedCallback() {
    if (this._abort) {
      try { this._abort.abort(); } catch { /* swallow */ }
    }
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._abort = null;
    this._debounceTimer = null;
    if (this._docClickHandler && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('click', this._docClickHandler);
    }
    this._docClickHandler = null;
  }

  async _search(q, ul) {
    // AbortController-per-keystroke (mirrors polling.js L88-98 race-free pattern).
    if (this._abort) {
      try { this._abort.abort(); } catch { /* swallow */ }
    }
    this._abort = new AbortController();
    const signal = this._abort.signal;
    try {
      const url = `${API_BASE}/players/search?q=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}`;
      const res = await fetch(url, { signal });
      if (!res || !res.ok) {
        if (res && res.status) {
          // eslint-disable-next-line no-console
          console.warn('[player-dropdown] search failed:', res.status);
        }
        ul.hidden = true;
        return;
      }
      const data = await res.json();
      this._renderResults(data, ul);
    } catch (e) {
      if (e && e.name !== 'AbortError') {
        // eslint-disable-next-line no-console
        console.warn('[player-dropdown] search error:', e);
      }
      // AbortError swallowed silently per T-58-19.
    }
  }

  _renderResults(data, ul) {
    // Clear prior children. innerHTML='' detaches all children in real DOM;
    // the fake-DOM helper's innerHTML setter mirrors that behavior. No
    // untrusted data — empty string only.
    ul.innerHTML = '';

    const results = (data && Array.isArray(data.results)) ? data.results : [];

    if (results.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'player-search-empty';
      empty.textContent = 'No players found';
      ul.appendChild(empty);
      ul.hidden = false;
      return;
    }

    for (const r of results) {
      const li = document.createElement('li');
      li.className = 'player-search-row';
      li.tabIndex = 0;
      li.setAttribute('role', 'option');

      // textContent — NEVER innerHTML for server-supplied data (T-58-18 mitigation).
      // Prefer affiliateCode; fallback to address abbreviation.
      const addr = (r && typeof r.address === 'string') ? r.address : '';
      const aff = (r && typeof r.affiliateCode === 'string' && r.affiliateCode.length > 0) ? r.affiliateCode : null;
      const label = aff
        ? `${aff}  (${addr.slice(0, 8)}…)`
        : addr;
      li.textContent = label;

      const click = () => this._pick(addr);
      li.addEventListener('click', click);
      li.addEventListener('keydown', (e) => {
        if (e && (e.key === 'Enter' || e.key === ' ')) {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          click();
        }
      });
      ul.appendChild(li);
    }

    ul.hidden = false;
  }

  _pick(address) {
    if (typeof address !== 'string' || address.length === 0) return;
    update('viewing.address', address.toLowerCase());
    // ui.mode is auto-derived inside store.js (plan 58-02) on the next microtask;
    // router.js's URL mirror also auto-syncs ?as=. No direct writes needed here.
    const input = this.querySelector('input');
    const results = this.querySelector('ul');
    if (input) input.value = '';
    if (results) results.hidden = true;
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('player-dropdown')) {
    customElements.define('player-dropdown', PlayerDropdown);
  }
}
