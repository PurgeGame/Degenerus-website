// /app/components/app-affiliate-panel.js — Phase 62 Plan 62-06 (AFF-01 + AFF-02)
//
// Referrals panel — upline identity + default URL + Customize CTA + direct
// referral list, with three-generation network counts in the summary bar.
//
// Plan history:
//   - Plan 62-06: AFF-01 (default URL + Customize CTA) + AFF-02 (referee table)
//                 + AFF-03 hook is in <app-claims-panel> via VISIBLE_PRIZE_KEYS
//                 whitelist extension (THIS PLAN; separate file edit)
//
// Mount: <app-affiliate-panel></app-affiliate-panel> at the bottom of
//        /app/index.html, directly below <app-transaction-history>.
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
//   - GET /player/:address/referees → referred-by identity + AFF-02 direct
//     referral table (Plan 62-00 deliverable, extended additively).
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
// Own-code sourcing (semantics fixed 2026-07-16):
//   readRegisteredCode (affiliate.js) paints the URL synchronously from the
//   own-code localStorage key (written after a confirmed Customize tx), then
//   resolveRegisteredCode refreshes DB-first (indexer affiliate.ownCode —
//   knows codes registered on ANY device, and ownership-verifies legacy
//   localStorage values). lootbox.js readAffiliateCode is NOT used here —
//   that helper is the purchase-tx default (the code that referred YOU),
//   never your own code.
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
import { fetchJSON } from '../app/api.js';
import './quest-objective-indicator.js';
import {
  defaultCodeForAddress,
  buildAffiliateUrl,
  createAffiliateCode,
  readRegisteredCode,
  resolveRegisteredCode,
} from '../app/affiliate.js';

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

function _shortAddress(value) {
  const address = String(value || '');
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

class AppAffiliatePanel extends HTMLElement {
  // --- Phase 60/61/62 idempotency-guard pattern ---
  #unsubs = [];
  #initialized = false;
  // --- Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED) ---
  #pollHandle = null;
  #pollController = null;
  #lastFetchAt = 0;
  #visibilityListener = null;
  #disclosureListener = null;
  // --- Pinned data ---
  #pinnedAddress = null;
  #defaultUrl = '';
  #registeredCode = null;   // bytes32 hex OR null (= use defaultCodeForAddress)
  #refereesData = null;     // { referredBy, referees: [...], total, counts }
  // --- Click-handler debounce ---
  #busyCustomize = false;
  // --- Auto-clear timers (cleared on disconnect) ---
  #copyFeedbackTimer = null;
  #errorClearTimer = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wireDisclosure();
    this.#wireVisibilityRePoll();
    this.#wireStoreSubscriptions();
    this.#wireClickHandlers();
    // Counts belong in the closed summary bar, so the first account-scoped
    // referral read runs immediately even though the disclosure starts shut.
    this.#runMountFetch();
  }

  disconnectedCallback() {
    this.#stopPolling();
    if (this.#visibilityListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('visibilitychange', this.#visibilityListener); }
      catch (_) { /* defensive */ }
    }
    this.#visibilityListener = null;
    const details = this.querySelector('[data-bind="aff-details"]');
    if (details && this.#disclosureListener) {
      try { details.removeEventListener('toggle', this.#disclosureListener); }
      catch (_) { /* defensive */ }
    }
    this.#disclosureListener = null;
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
      <details class="app-affiliate-panel aff-disclosure section-disclosure" data-bind="aff-details">
        <summary class="aff-summary section-disclosure__bar">
          <span class="aff-summary-main">
            <strong class="section-disclosure__title">
              REFERRALS <quest-objective-indicator product="affiliate"></quest-objective-indicator>
            </strong>
            <span class="aff-summary-counts" aria-label="Referral network counts">
              <span class="aff-summary-count"><span>DIRECT</span> <strong data-bind="aff-count-direct">—</strong></span>
              <span class="aff-summary-count"><span>LEVEL 2</span> <strong data-bind="aff-count-level2">—</strong></span>
              <span class="aff-summary-count"><span>LEVEL 3</span> <strong data-bind="aff-count-level3">—</strong></span>
            </span>
          </span>
          <span class="section-disclosure__chevron" aria-hidden="true"></span>
        </summary>
        <div class="aff-content">
          <div class="aff-network-section">
            <span class="aff-network-label">REFERRED BY</span>
            <div class="aff-referred-by" data-bind="aff-referred-by"></div>
          </div>
          <div class="aff-default-section">
            <p class="aff-hint">Share your referral link. It works immediately — no setup required.</p>
            <div class="aff-url-row">
              <input type="text" readonly class="aff-url-input" data-bind="aff-url" value="" />
              <button type="button" class="aff-copy-cta" data-write data-bind="aff-copy">Copy link</button>
            </div>
            <div class="aff-copy-feedback" data-bind="aff-copy-feedback" hidden></div>
          </div>
          <details class="aff-customize-section">
            <summary class="aff-customize-summary">Customize your code (optional)</summary>
            <p class="aff-customize-hint">
              The default URL works immediately.
              Customize your code if you want a shorter or vanity hex code, or want to share kickback % with people you refer.
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
            <h3 class="aff-referees-heading">YOU REFERRED</h3>
            <div class="aff-referees-table" data-bind="aff-referees"></div>
            <div class="aff-referees-empty" data-bind="aff-referees-empty" hidden>No referrals yet — share your link to get started.</div>
          </div>
        </div>
      </details>
    `;
  }

  // ---------------------------------------------------------------------
  // Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED).
  // ---------------------------------------------------------------------

  #startPolling() {
    if (!this.#isDisclosureOpen()) return;
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
    }
    if (typeof setInterval !== 'function') return;
    this.#pollHandle = _setIntervalUnref(() => this.#runMountFetch(), POLL_INTERVAL_MS);
  }

  #stopPolling() {
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#pollController) {
      try { this.#pollController.abort(); } catch (_) { /* defensive */ }
      this.#pollController = null;
    }
  }

  #isDisclosureOpen() {
    return this.querySelector('[data-bind="aff-details"]')?.open === true;
  }

  #wireDisclosure() {
    const details = this.querySelector('[data-bind="aff-details"]');
    if (!details) return;
    this.#disclosureListener = () => {
      if (details.open) {
        this.#startPolling();
        this.#runMountFetch();
      } else {
        this.#stopPolling();
      }
    };
    details.addEventListener('toggle', this.#disclosureListener);
  }

  async #runMountFetch() {
    // The summary counts load while closed. The 30-second refresh loop still
    // runs only while open, keeping the collapsed panel inexpensive.
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

    // Account-switcher (2026-07-16): the affiliate link + referee table are
    // per-account identity data (combine.js intentionally omits `affiliate` —
    // not summable across the combined view's accounts). Render the panel's
    // existing empty-state instead of fetching.
    if (get('ui.mode') === 'combined') {
      this.#defaultUrl = '';
      this.#registeredCode = null;
      this.#refereesData = null;
      this.#setUrl('');
      this.#renderReferralCounts(null);
      this.#renderReferredBy(null, 'Pick a single account to see who referred it.');
      this.#renderRefereesEmpty('Per-account stat. Pick a single account.');
      return;
    }

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
      this.#renderReferralCounts(null);
      this.#renderReferredBy(null, 'Connect a wallet to see who referred you.');
      this.#renderRefereesEmpty('Connect a wallet to see your link.');
      return;
    }

    // Own registered code: fast paint from the own-code localStorage key
    // (this-device registrations), then DB-first async refresh so codes
    // registered on other devices appear too. Absent → defaultCodeForAddress.
    this.#registeredCode = readRegisteredCode(addr);
    this.#defaultUrl = buildAffiliateUrl(addr, this.#registeredCode);
    this.#setUrl(this.#defaultUrl);
    resolveRegisteredCode(addr).then((code) => {
      if (this.#pinnedAddress !== addr) return; // address churn — stale
      if (!code || code === this.#registeredCode) return;
      this.#registeredCode = code;
      this.#defaultUrl = buildAffiliateUrl(addr, code);
      this.#setUrl(this.#defaultUrl);
    }).catch(() => { /* resolver never throws, defensive */ });

    try {
      const data = await fetchJSON(`/player/${addr}/referees`, { signal });
      if (signal.aborted) return;
      this.#refereesData = data || null;
      this.#renderReferralCounts(data?.counts, data?.total);
      this.#renderReferredBy(data?.referredBy ?? null);
      this.#renderReferees(Array.isArray(data?.referees) ? data.referees : []);
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      const message = Number(error?.status) === 503
        ? 'Referral index is catching up. Retrying automatically.'
        : 'Referral service unavailable. Retrying automatically.';
      this.#renderReferralCounts(null);
      this.#renderReferredBy(null, message);
      this.#renderRefereesEmpty(message);
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
    const u3 = subscribe('ui.mode', () => this.#runMountFetch());
    this.#unsubs.push(u1, u2, u3);
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
  // Referral network — server-derived strings via textContent (T-58-18).
  // The endpoint returns both sides of the relationship: `referredBy` is the
  // single incoming edge and `referees` are the outgoing/direct edges. The
  // collapsed bar shows the size of the first three outgoing generations.
  // ---------------------------------------------------------------------

  #renderReferralCounts(counts, directFallback = null) {
    const normalized = counts && typeof counts === 'object'
      ? counts
      : { direct: directFallback, level2: null, level3: null };
    const bindings = [
      ['aff-count-direct', normalized.direct],
      ['aff-count-level2', normalized.level2],
      ['aff-count-level3', normalized.level3],
    ];

    for (const [binding, raw] of bindings) {
      const target = this.querySelector(`[data-bind="${binding}"]`);
      if (!target) continue;
      const value = Number(raw);
      target.textContent = raw != null && raw !== ''
        && Number.isSafeInteger(value) && value >= 0
        ? value.toLocaleString('en-US')
        : '—';
    }
  }

  #renderReferredBy(address, emptyMessage = 'No referrer recorded.') {
    const target = this.querySelector('[data-bind="aff-referred-by"]');
    if (!target) return;
    // textContent also resets any prior empty-state text in the lightweight
    // test DOM before an address link is appended on a later poll.
    target.textContent = '';
    if (typeof target.replaceChildren === 'function') {
      target.replaceChildren();
    } else {
      target.children = [];
      target._innerHTML = '';
    }

    const normalized = String(address || '');
    if (!normalized) {
      target.classList?.add?.('is-empty');
      target.textContent = String(emptyMessage);
      return;
    }

    target.classList?.remove?.('is-empty');
    const link = document.createElement('a');
    link.className = 'aff-referral-person';
    link.textContent = _shortAddress(normalized);
    link.title = normalized;
    link.setAttribute('aria-label', `View referrer ${normalized} on the block explorer`);
    link.setAttribute('href', `${String(CHAIN.etherscanBase || '').replace(/\/$/, '')}/address/${encodeURIComponent(normalized)}`);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    target.appendChild(link);
  }

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
      empty.textContent = 'No referrals yet — share your link to get started.';
      return;
    }
    empty.hidden = true;

    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'aff-referees-row';

      const addrCell = document.createElement('span');
      addrCell.className = 'aff-referees-cell aff-referees-cell--addr';
      const referralAddress = String(r?.address || '');
      const addrLink = document.createElement('a');
      addrLink.className = 'aff-referral-person';
      addrLink.textContent = _shortAddress(referralAddress);
      addrLink.title = referralAddress;
      addrLink.setAttribute('aria-label', `View referral ${referralAddress} on the block explorer`);
      addrLink.setAttribute('href', `${String(CHAIN.etherscanBase || '').replace(/\/$/, '')}/address/${encodeURIComponent(referralAddress)}`);
      addrLink.setAttribute('target', '_blank');
      addrLink.setAttribute('rel', 'noopener noreferrer');
      addrCell.appendChild(addrLink);
      row.appendChild(addrCell);

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
      empty.textContent = String(msg || 'No referrals yet — share your link to get started.');
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
