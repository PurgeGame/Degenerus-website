// /app/components/account-switcher.js — account-switcher / operator-mode UI layer
// (2026-07-16). Consumes the CORE layer already merged in store.js (viewing.combined,
// approvals.list, mode derivation, getActingAddress) + polling.js (which writes
// approvals.list from the indexer's dedicated GET /player/:address/approvers
// endpoint — approvers are NOT part of /player/:address, see combine.js header).
//
// <account-switcher> Custom Element. A single native <select> labeled "Acting as":
//   - "Your wallet 0xab…cd"       — self (viewing.address=null, viewing.combined=false)
//   - one row per approver         — operator mode for that owner
//                                     (viewing.address=<owner>, viewing.combined=false)
//   - "All accounts (N)"           — combined view (viewing.address=null, viewing.combined=true)
// viewing.address and viewing.combined are mutually exclusive (store.js's deriveMode
// checks combined FIRST regardless of a stale viewing.address); every selection here
// writes BOTH paths via a single store.batch() so a subscriber never observes an
// inconsistent half-write.
//
// Visibility (T-58-18-style safety + UX): renders ONLY when a wallet is connected
// AND it has 1+ operator approvals (subscribe to both connected.address and
// approvals.list). Hidden otherwise via the `hidden` attribute — app.css pairs this
// with an `account-switcher[hidden] { display: none !important; }` companion rule
// (repo pitfall: an author `display:` rule on the tag selector beats the UA [hidden]
// rule, so every JS-toggled element needs that explicit companion — see
// project_css_hidden_display_pitfall memory).
//
// External sync: subscribes to viewing.address + viewing.combined so a ?as= deep
// link (router.js) or a player-dropdown pick reflects into the <select> without a
// page reload. Setting `.value` programmatically does not fire a native 'change'
// event, so this cannot loop back into a redundant store write.
//
// Security: every rendered string is server/store-supplied (addresses). Options are
// built via document.createElement + textContent — never innerHTML interpolation
// (T-58-18 convention, mirrors player-dropdown.js). The <select> skeleton itself is
// the ONLY innerHTML write, and it is a trusted static literal.

import { get, subscribe, batch } from '../app/store.js';

/** Abbreviate a 0x address as "0xab…cd" (first 4 chars incl. 0x, last 2). */
function _abbrev(addr) {
  if (typeof addr !== 'string' || addr.length < 8) return addr || '';
  return `${addr.slice(0, 4)}…${addr.slice(-2)}`;
}

export class AccountSwitcher extends HTMLElement {
  constructor() {
    super();
    this._unsubs = [];
    this._select = null;
  }

  connectedCallback() {
    // Static skeleton only — trusted literal markup, no interpolated data.
    this.innerHTML = `<select class="acct-switcher-select" aria-label="Acting as"></select>`;
    this._select = this.querySelector('select');
    this.hidden = true; // default hidden until the first subscribe fire evaluates state

    this._select.addEventListener('change', () => this._onChange());

    // subscribe() fires immediately with the current value (store.js convention),
    // so these four calls also perform the first render/sync.
    this._unsubs.push(subscribe('connected.address', () => this._render()));
    this._unsubs.push(subscribe('approvals.list', () => this._render()));
    this._unsubs.push(subscribe('viewing.address', () => this._syncSelection()));
    this._unsubs.push(subscribe('viewing.combined', () => this._syncSelection()));
  }

  disconnectedCallback() {
    for (const u of this._unsubs) {
      try { u(); } catch { /* swallow */ }
    }
    this._unsubs = [];
    this._select = null;
  }

  /** Rebuild the <option> list from connected.address + approvals.list. */
  _render() {
    if (!this._select) return;
    const connected = get('connected.address');
    const approvals = Array.isArray(get('approvals.list')) ? get('approvals.list') : [];

    if (!connected || approvals.length === 0) {
      this.hidden = true;
      return;
    }
    this.hidden = false;

    // Clear prior options — innerHTML='' detaches all children (matches
    // player-dropdown.js's ul.innerHTML='' idiom); no untrusted data involved.
    this._select.innerHTML = '';

    const selfOpt = document.createElement('option');
    selfOpt.value = 'self';
    selfOpt.textContent = `Your wallet ${_abbrev(connected)}`;
    this._select.appendChild(selfOpt);

    for (const addr of approvals) {
      const opt = document.createElement('option');
      opt.value = addr;
      opt.textContent = _abbrev(addr);
      this._select.appendChild(opt);
    }

    const combinedOpt = document.createElement('option');
    combinedOpt.value = 'combined';
    combinedOpt.textContent = `All accounts (${approvals.length + 1})`;
    this._select.appendChild(combinedOpt);

    this._syncSelection();
  }

  /** Reflect viewing.address / viewing.combined into the <select>'s current value. */
  _syncSelection() {
    if (!this._select) return;
    const combined = get('viewing.combined');
    const viewingAddr = get('viewing.address');
    let value = 'self';
    if (combined) {
      value = 'combined';
    } else if (viewingAddr) {
      value = String(viewingAddr).toLowerCase();
    }
    // `.children` (not `.options`) — matches on both real <select> elements
    // (no <optgroup> nesting here, so children === options) and the project's
    // minimal fakeDOM test harnesses, which do not model `.options`.
    const options = this._select.children || [];
    const hasOption = Array.from(options).some((o) => o.value === value);
    // Falls back to 'self' when viewing an address outside the approvers list
    // (e.g., a plain read-only 'view' pick via player-dropdown) — nothing in
    // the switcher's own option set corresponds to that state.
    this._select.value = hasOption ? value : 'self';
  }

  _onChange() {
    if (!this._select) return;
    const value = this._select.value;
    if (value === 'self') {
      batch({ updates: [
        { path: 'viewing.address', value: null },
        { path: 'viewing.combined', value: false },
      ] });
    } else if (value === 'combined') {
      batch({ updates: [
        { path: 'viewing.address', value: null },
        { path: 'viewing.combined', value: true },
      ] });
    } else {
      batch({ updates: [
        { path: 'viewing.address', value },
        { path: 'viewing.combined', value: false },
      ] });
    }
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('account-switcher')) {
    customElements.define('account-switcher', AccountSwitcher);
  }
}
