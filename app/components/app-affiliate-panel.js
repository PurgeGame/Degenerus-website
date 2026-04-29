// /app/components/app-affiliate-panel.js — Phase 62 Plan 62-06 (AFF-01 + AFF-02)
//
// Affiliate panel — default URL + Customize CTA + referee table.
//
// Plan history:
//   - Plan 62-06: AFF-01 (default URL + Customize CTA) + AFF-02 (referee table)
//                 + AFF-03 hook is in <app-claims-panel> via VISIBLE_PRIZE_KEYS
//                 whitelist extension (THIS PLAN; separate file edit)
//
// Mount: <app-affiliate-panel></app-affiliate-panel> in /app/index.html below
//        <app-boons-panel> per CONTEXT D-08 sequential execution.
//
// Custom Element shell mirrors Phase 60's app-packs-panel.js + Phase 61's
// app-claims-panel.js + Phase 62-04's app-quest-panel.js: light DOM,
// idempotent customElements.define guard, symmetric connectedCallback /
// disconnectedCallback, #unsubs[] for store subscriptions, panel-owned 30s
// poll cycle (Phase 61 D-04 LOCKED — NOT polling.js).
//
// On-chain surface:
//   - createAffiliateCode (Customize CTA — Phase 58 chokepoint via affiliate.js).
//   - claimAffiliateDgnrs is dispatched FROM <app-claims-panel> (AFF-03 row;
//     1-line whitelist edit). NOT this panel.
//
// Read surface:
//   - GET /player/:address/referees → AFF-02 referee table (Plan 62-00 deliverable).
//
// CRITICAL — RESEARCH Pitfall 5:
//   defaultCodeForAddress LEFT-pad enforcement lives in affiliate.js. The
//   panel never directly constructs the URL; it always goes through
//   buildAffiliateUrl (which calls defaultCodeForAddress under the hood).
//
// CRITICAL — RESEARCH R2 (HIGH confidence):
//   Default URL works for ANY connected user with NO prior createAffiliateCode
//   tx required AND full commission flows. Customize CTA copy guidance:
//     "The default URL works for sharing AND earns you commission immediately.
//      Customize your code if you want a shorter / vanity hex code OR want to
//      share kickback % with referees."
//
// CRITICAL — Phase 60 D-05 reuse (RESEARCH R6):
//   readAffiliateCode from lootbox.js is reused as-is. After the Customize
//   tx confirms, affiliate.js writes the new code to localStorage; on the
//   next panel mount or address-change cycle, this panel reads it back via
//   readAffiliateCode and builds the URL with the registered code.
//
// Carry-forwards (CONTEXT 62-CONTEXT.md):
//   CF-01: Phase 58 closure-form sendTx (via affiliate.js helper).
//   CF-02: Phase 56 reason-map (Zero/Insufficient/InvalidKickback registered
//          by affiliate.js's module-load side effect).
//   CF-03: Phase 56 requireStaticCall (via affiliate.js helper).
//   CF-04: Phase 56 D-04 / Phase 61 D-04 — panel-owned 30s poll cycle with
//          AbortController-per-cycle + visibility-aware foreground re-poll.
//   CF-06: NEVER optimistic — URL only flips after confirmed Customize tx.
//   CF-07: T-58-18 — server-derived strings via textContent.
//   CF-15: Phase 58 [data-write] disable manager — Copy + Customize-submit
//          buttons carry data-write so view-others mode auto-disables them.
//
// Class palette: .aff-* + .aff-customize-* (RESEARCH R10 verified non-colliding).

import { CHAIN } from '../app/chain-config.js';
import { get, subscribe, getViewedAddress } from '../app/store.js';
import { fetchJSON } from '../../beta/app/api.js';
import {
  defaultCodeForAddress,
  buildAffiliateUrl,
  createAffiliateCode,
} from '../app/affiliate.js';
import { readAffiliateCode } from '../app/lootbox.js';   // Phase 60 D-05 reuse (R6)

// Wraps setInterval with .unref() in Node.js (no-op in browsers). Used for the
// 30s poll tick so node:test processes exit cleanly when no other open handles
// remain. Verbatim port of app-quest-panel.js _setIntervalUnref.
function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

const POLL_INTERVAL_MS = 30_000;        // Phase 56 D-04 / Phase 61 D-04 LOCKED.
const VISIBILITY_RESUME_GATE_MS = 1000; // ≥1s since last fetch → re-poll on foreground.
const ERROR_AUTO_CLEAR_MS = 10_000;     // 10s auto-clear for inline errors (Phase 61 D-05 mirror).
const COPY_FEEDBACK_MS = 2_000;         // 2s copy-success feedback.
const ZERO_BYTES32 = '0x' + '0'.repeat(64);

class AppAffiliatePanel extends HTMLElement {
  // --- Phase 60/61/62 idempotency-guard pattern ---
  #unsubs = [];
  #initialized = false;
  // --- Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED) ---
  #pollHandle = null;
  #pollController = null;
  #lastFetchAt = 0;
  #visibilityListener = null;
  // --- Pinned data ---
  #pinnedAddress = null;
  #defaultUrl = '';
  #registeredCode = null;   // bytes32 hex OR null (= use defaultCodeForAddress)
  #refereesData = null;     // { referees: [...], total: number }
  // --- Click-handler debounce ---
  #busyCustomize = false;
  // --- Auto-clear timers (cleared on disconnect) ---
  #copyFeedbackTimer = null;
  #errorClearTimer = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wireVisibilityRePoll();
    this.#wireStoreSubscriptions();
    this.#wireClickHandlers();
    this.#startPolling();
    this.#runMountFetch();
  }

  disconnectedCallback() {
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#pollController) {
      try { this.#pollController.abort(); } catch (_) { /* defensive */ }
      this.#pollController = null;
    }
    if (this.#visibilityListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('visibilitychange', this.#visibilityListener); }
      catch (_) { /* defensive */ }
    }
    this.#visibilityListener = null;
    if (this.#copyFeedbackTimer != null) {
      try { clearTimeout(this.#copyFeedbackTimer); } catch (_) { /* defensive */ }
      this.#copyFeedbackTimer = null;
    }
    if (this.#errorClearTimer != null) {
      try { clearTimeout(this.#errorClearTimer); } catch (_) { /* defensive */ }
      this.#errorClearTimer = null;
    }
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
  }

  // ---------------------------------------------------------------------
  // Render shell — STATIC innerHTML; T-58-18 hardening (no server data).
  // ---------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <section class="panel app-affiliate-panel">
        <header class="aff-header">
          <h2>AFFILIATE</h2>
        </header>
        <div class="aff-default-section">
          <p class="aff-hint">Share your link to earn commission. Works immediately — no setup required.</p>
          <div class="aff-url-row">
            <input type="text" readonly class="aff-url-input" data-bind="aff-url" value="" />
            <button type="button" class="aff-copy-cta" data-write data-bind="aff-copy">Copy link</button>
          </div>
          <div class="aff-copy-feedback" data-bind="aff-copy-feedback" hidden></div>
        </div>
        <details class="aff-customize-section">
          <summary class="aff-customize-summary">Customize your code (optional)</summary>
          <p class="aff-customize-hint">
            The default URL works for sharing AND earns you commission immediately.
            Customize your code if you want a shorter or vanity hex code, or want to share kickback % with referees.
          </p>
          <div class="aff-customize-form">
            <label class="aff-customize-label">Hex code (3-31 alphanumeric):
              <input type="text" name="aff-customize-code" pattern="[A-Za-z0-9]{3,31}" class="aff-customize-input" />
            </label>
            <label class="aff-customize-label">Kickback % (0-25):
              <input type="number" name="aff-customize-pct" min="0" max="25" value="0" class="aff-customize-input" />
            </label>
            <button type="button" class="aff-customize-submit" data-write>Register code</button>
          </div>
          <div class="aff-customize-error" data-bind="aff-customize-error" hidden></div>
          <div class="aff-customize-success" data-bind="aff-customize-success" hidden></div>
        </details>
        <div class="aff-referees-section">
          <h3 class="aff-referees-heading">Your referees</h3>
          <div class="aff-referees-table" data-bind="aff-referees"></div>
          <div class="aff-referees-empty" data-bind="aff-referees-empty" hidden>No referees yet — share your link to get started.</div>
        </div>
        <p class="aff-claim-link">
          Commission ready to claim? Visit the <a href="#claims" class="aff-claim-link-anchor">Claims tray</a>.
        </p>
      </section>
    `;
  }

  // ---------------------------------------------------------------------
  // Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED).
  // ---------------------------------------------------------------------

  #startPolling() {
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
    }
    if (typeof setInterval !== 'function') return;
    this.#pollHandle = _setIntervalUnref(() => this.#runMountFetch(), POLL_INTERVAL_MS);
  }

  async #runMountFetch() {
    // Visibility guard — pause polling while tab hidden.
    if (typeof document !== 'undefined'
      && document.visibilityState
      && document.visibilityState !== 'visible') {
      return;
    }
    if (this.#pollController) {
      try { this.#pollController.abort(); } catch (_) { /* defensive */ }
    }
    this.#pollController = new AbortController();
    const signal = this.#pollController.signal;
    this.#lastFetchAt = Date.now();

    const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || get('viewing.address')
      || get('connected.address')
      || null;
    this.#pinnedAddress = addr;

    if (!addr) {
      this.#defaultUrl = '';
      this.#registeredCode = null;
      this.#refereesData = null;
      this.#setUrl('');
      this.#renderRefereesEmpty('Connect a wallet to see your link.');
      return;
    }

    // Phase 60 D-05 reuse — read any previously-registered vanity code from
    // localStorage. If absent or zero, fall back to defaultCodeForAddress.
    let stored = null;
    try { stored = readAffiliateCode(CHAIN.id, addr); } catch (_) { stored = null; }
    this.#registeredCode = (stored && stored !== ZERO_BYTES32) ? stored : null;
    this.#defaultUrl = buildAffiliateUrl(addr, this.#registeredCode);
    this.#setUrl(this.#defaultUrl);

    try {
      const data = await fetchJSON(`/player/${addr}/referees`);
      if (signal.aborted) return;
      this.#refereesData = data || null;
      this.#renderReferees(Array.isArray(data?.referees) ? data.referees : []);
    } catch (_e) {
      this.#renderRefereesEmpty('Could not load referees.');
    }
  }

  // Visibility-aware refresh — on foreground return AFTER ≥1s elapsed since
  // last fetch, fire an immediate cycle. Mirrors Phase 56 D-04 + Phase 61 D-04
  // (1s gate per Plan 62-04 D-A — light data, frequent foreground re-polls fine).
  #wireVisibilityRePoll() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#visibilityListener = () => {
      if (document.visibilityState !== 'visible') return;
      const elapsed = Date.now() - this.#lastFetchAt;
      if (elapsed >= VISIBILITY_RESUME_GATE_MS) {
        this.#runMountFetch();
      }
    };
    document.addEventListener('visibilitychange', this.#visibilityListener);
  }

  // Store subscriptions — on wallet switch (connected.address) OR view-target
  // switch (viewing.address), fire an immediate cycle restart.
  #wireStoreSubscriptions() {
    const u1 = subscribe('connected.address', () => this.#runMountFetch());
    const u2 = subscribe('viewing.address', () => this.#runMountFetch());
    this.#unsubs.push(u1, u2);
  }

  // ---------------------------------------------------------------------
  // Click handlers — Copy CTA + Customize submit.
  // ---------------------------------------------------------------------

  #wireClickHandlers() {
    const copyBtn = this.querySelector('[data-bind="aff-copy"]');
    if (copyBtn) {
      copyBtn.addEventListener('click', (ev) => this.#onCopyClick(ev));
    }
    const submitBtn = this.querySelector('.aff-customize-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', (ev) => this.#onCustomizeSubmit(ev));
    }
  }

  // ---------------------------------------------------------------------
  // Copy CTA — navigator.clipboard.writeText + execCommand fallback.
  // T-58-18: feedback rendered via textContent.
  // ---------------------------------------------------------------------

  async #onCopyClick(ev) {
    try { ev?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (!this.#defaultUrl) return;
    let copied = false;
    try {
      if (typeof navigator !== 'undefined'
        && navigator.clipboard
        && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(this.#defaultUrl);
        copied = true;
      }
    } catch (_e) {
      copied = false;
    }
    if (!copied) {
      // Fallback for browsers without Clipboard API or non-secure context.
      try {
        const input = this.querySelector('[data-bind="aff-url"]');
        if (input && typeof input.select === 'function') input.select();
        if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
          document.execCommand('copy');
          copied = true;
        }
      } catch (_e) { /* defensive */ }
    }
    this.#renderCopyFeedback(copied ? 'Link copied!' : 'Could not copy — try selecting the text manually.');
  }

  #renderCopyFeedback(msg) {
    const fb = this.querySelector('[data-bind="aff-copy-feedback"]');
    if (!fb) return;
    fb.hidden = false;
    fb.textContent = String(msg || '');
    if (this.#copyFeedbackTimer != null) {
      try { clearTimeout(this.#copyFeedbackTimer); } catch (_) { /* defensive */ }
    }
    this.#copyFeedbackTimer = setTimeout(() => {
      try {
        fb.hidden = true;
        fb.textContent = '';
      } catch (_) { /* defensive */ }
    }, COPY_FEEDBACK_MS);
    if (this.#copyFeedbackTimer && typeof this.#copyFeedbackTimer.unref === 'function') {
      try { this.#copyFeedbackTimer.unref(); } catch (_) { /* defensive */ }
    }
  }

  // ---------------------------------------------------------------------
  // Customize submit — fires createAffiliateCode through Phase 58 chokepoint.
  // CF-06: NEVER optimistic — URL only flips after confirmed receipt.
  // ---------------------------------------------------------------------

  async #onCustomizeSubmit(ev) {
    try { ev?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyCustomize) return;
    this.#busyCustomize = true;

    const btn = this.querySelector('.aff-customize-submit');
    const originalLabel = btn ? btn.textContent : '';
    const errEl = this.querySelector('[data-bind="aff-customize-error"]');
    const okEl = this.querySelector('[data-bind="aff-customize-success"]');
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    if (okEl) { okEl.hidden = true; okEl.textContent = ''; }
    if (btn) { btn.disabled = true; btn.textContent = 'Registering…'; }

    try {
      const codeInput = this.querySelector('input[name="aff-customize-code"]');
      const pctInput = this.querySelector('input[name="aff-customize-pct"]');
      const codeStr = (codeInput && (codeInput.value || codeInput._value)) || '';
      const pctStr = (pctInput && (pctInput.value || pctInput._value));
      const kickbackPct = parseInt(pctStr == null ? '0' : pctStr, 10) || 0;

      const { encodedCode } = await createAffiliateCode({ codeStr, kickbackPct });

      // CF-06: ONLY flip URL after confirmed receipt.
      this.#registeredCode = encodedCode;
      const addr = this.#pinnedAddress
        || (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
        || get('connected.address');
      this.#defaultUrl = buildAffiliateUrl(addr, encodedCode);
      this.#setUrl(this.#defaultUrl);

      if (okEl) {
        okEl.hidden = false;
        okEl.textContent = 'Code registered.';
      }
    } catch (error) {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = String(
          error?.userMessage || error?.message || 'Could not register code.',
        );
        // 10s auto-clear (Phase 61 D-05 mirror).
        if (this.#errorClearTimer != null) {
          try { clearTimeout(this.#errorClearTimer); } catch (_) { /* defensive */ }
        }
        this.#errorClearTimer = setTimeout(() => {
          try {
            errEl.hidden = true;
            errEl.textContent = '';
          } catch (_) { /* defensive */ }
        }, ERROR_AUTO_CLEAR_MS);
        if (this.#errorClearTimer && typeof this.#errorClearTimer.unref === 'function') {
          try { this.#errorClearTimer.unref(); } catch (_) { /* defensive */ }
        }
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalLabel || 'Register code'; }
      this.#busyCustomize = false;
    }
  }

  // ---------------------------------------------------------------------
  // URL display — input.value assignment (form-control exempt from textContent
  // rule — there is no innerHTML interpolation).
  // ---------------------------------------------------------------------

  #setUrl(url) {
    const input = this.querySelector('[data-bind="aff-url"]');
    if (!input) return;
    input.value = String(url || '');
    // Also reflect via _value for the fakeDOM in tests (which observes _value
    // on initial-render attributes); production browsers ignore this.
    if (typeof input._value !== 'undefined') input._value = String(url || '');
  }

  // ---------------------------------------------------------------------
  // Referee table — server-derived strings via textContent (T-58-18).
  // FD-2 honored: when row.available === false, render '—' with tooltip.
  // ---------------------------------------------------------------------

  #renderReferees(rows) {
    const table = this.querySelector('[data-bind="aff-referees"]');
    const empty = this.querySelector('[data-bind="aff-referees-empty"]');
    if (!table || !empty) return;

    if (typeof table.replaceChildren === 'function') {
      table.replaceChildren();
    } else {
      table.children = [];
      table._innerHTML = '';
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      empty.hidden = false;
      empty.textContent = 'No referees yet — share your link to get started.';
      return;
    }
    empty.hidden = true;

    // Header row — static text via textContent on createElement-built nodes.
    const header = document.createElement('div');
    header.className = 'aff-referees-row aff-referees-row--header';
    const hAddr = document.createElement('span');
    hAddr.className = 'aff-referees-cell aff-referees-cell--addr';
    hAddr.textContent = 'Address';
    const hAt = document.createElement('span');
    hAt.className = 'aff-referees-cell aff-referees-cell--at';
    hAt.textContent = 'Referred at';
    const hAmt = document.createElement('span');
    hAmt.className = 'aff-referees-cell aff-referees-cell--amt';
    hAmt.textContent = 'Commission (BURNIE)';
    header.appendChild(hAddr);
    header.appendChild(hAt);
    header.appendChild(hAmt);
    table.appendChild(header);

    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'aff-referees-row';

      const addrCell = document.createElement('span');
      addrCell.className = 'aff-referees-cell aff-referees-cell--addr';
      addrCell.textContent = String(r?.address || '');
      row.appendChild(addrCell);

      const atCell = document.createElement('span');
      atCell.className = 'aff-referees-cell aff-referees-cell--at';
      atCell.textContent = String(r?.referredAt ?? '');
      row.appendChild(atCell);

      const amtCell = document.createElement('span');
      amtCell.className = 'aff-referees-cell aff-referees-cell--amt';
      if (r?.available === false) {
        // FD-2 honored — display "—" with reason as tooltip.
        amtCell.textContent = '—';
        amtCell.title = String(r?.reason || 'pending');
      } else {
        amtCell.textContent = String(r?.totalCommissionBurnie ?? '0');
      }
      row.appendChild(amtCell);

      table.appendChild(row);
    }
  }

  #renderRefereesEmpty(msg) {
    const table = this.querySelector('[data-bind="aff-referees"]');
    const empty = this.querySelector('[data-bind="aff-referees-empty"]');
    if (table) {
      if (typeof table.replaceChildren === 'function') {
        table.replaceChildren();
      } else {
        table.children = [];
        table._innerHTML = '';
      }
    }
    if (empty) {
      empty.hidden = false;
      empty.textContent = String(msg || 'No referees yet — share your link to get started.');
    }
  }
}

// Idempotency-guarded registration (Phase 58/59/60/61/62 pattern). Required
// for node:test re-import safety AND production hot-module-replacement.
if (typeof customElements !== 'undefined'
  && typeof customElements.get === 'function'
  && typeof customElements.define === 'function') {
  if (!customElements.get('app-affiliate-panel')) {
    customElements.define('app-affiliate-panel', AppAffiliatePanel);
  }
}
