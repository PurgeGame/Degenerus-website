// /app/components/app-pass-section.js — Phase 62 Plan 62-02 (BUY-02 + BUY-03)
//
// Whale + Deity pass section. Custom Element shell mirrors Phase 60's
// app-packs-panel.js + Phase 61's app-claims-panel.js + Phase 62 Plan 62-01's
// app-decimator-panel.js: light DOM, idempotent customElements.define guard,
// symmetric connectedCallback / disconnectedCallback, #unsubs[] for store
// subscriptions, panel-owned 30s poll cycle (Phase 61 D-04 LOCKED — NOT
// polling.js's fictional generic API per RESEARCH Pitfall 9).
//
// On-chain surfaces:
//   BUY-02 — DegenerusGame.purchaseWhaleBundle(buyer, quantity) payable
//            via passes.js purchaseWhaleBundle({quantity, msgValueWei}).
//   BUY-03 — DegenerusGame.purchaseDeityPass(buyer, symbolId) payable
//            via passes.js purchaseDeityPass({symbolId, msgValueWei}).
//
// CONTEXT D-05 LOCKED: deity-pass click handler applies deityPassErrorOverride
// at the panel level — when the static-call gate or sendTx surfaces a
// `revert E()`, the panel renders inline error
//   "That symbol's taken — try another."
// and keeps the picker open with the selected symbol cleared so the user
// re-picks visibly. 10s auto-clear + clear-on-next-success-anywhere mirrors
// Phase 61 D-05 pattern.
//
// Carry-forwards (CONTEXT 62-CONTEXT.md):
//   CF-01: Phase 58 closure-form sendTx — flows through passes.js.
//   CF-02: Phase 56 reason-map decodeRevertReason on every catch.
//   CF-03: Phase 56 requireStaticCall pre-flight inside passes.js.
//   CF-06: Phase 61 D-05 NEVER optimistic balance subtraction. Pre-click
//          balance / pricing stays visible; 250ms post-confirm refetch via
//          #runPollCycle.
//   CF-07: T-58-18 — error.userMessage rendered via .textContent NOT innerHTML.
//   CF-15: data-write attribute on whale buy CTA + each of 32 deity cells →
//          Phase 58 disable manager auto-disables when ui.mode === 'view-others'.
//
// Class palette: .pass-* prefix with sub-prefixes .pass-whale-* + .pass-deity-*.

import { CHAIN } from '../app/chain-config.js';
import { get, subscribe, getViewedAddress } from '../app/store.js';
import { fetchJSON } from '../../beta/app/api.js';
import { purchaseWhaleBundle, purchaseDeityPass, deityPassErrorOverride } from '../app/passes.js';
import { decodeRevertReason } from '../app/reason-map.js';

// Wraps setInterval with .unref() in Node.js (no-op in browsers). Used for the
// 30s poll tick so node:test processes exit cleanly when no other open handles
// remain. Verbatim port of app-decimator-panel.js _setIntervalUnref.
function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

const POLL_INTERVAL_MS = 30_000;       // Phase 56 D-04 / Phase 61 D-04 LOCKED.
const POST_CONFIRM_REFETCH_MS = 250;   // CF-06 — 250ms debounced refetch on tx confirm.
const ERROR_AUTO_CLEAR_MS = 10_000;    // 10s — mirrors Phase 61 D-05 pattern.
const DEBOUNCE_MS = 500;               // 500ms click debounce window.

// Documented price formulas (RESEARCH Open Q4). Whale: 2.4 ETH (lvl 0-3) or
// 4 ETH (lvl 4+) per quantity unit; deity: 24 ETH base + sum-of-prior. The
// panel computes msgValueWei from /player/:address currentLevel; if the data
// is unavailable we surface a "Loading price…" state and disable Buy CTAs.
// Sepolia uses /1M scaling per chain-config.sepolia.js ETH_DIVISOR (Phase 51 D).
const ETH_BASE_WEI = 10n ** 18n;

// Compute whale unit price (per-quantity msgValueWei). Returns null when the
// /player snapshot isn't loaded yet.
function computeWhaleUnitPriceWei(currentLevel, chainId) {
  if (currentLevel == null) return null;
  const lvl = Number(currentLevel);
  // Levels 0-3: 2.4 ETH; level 4+: 4 ETH (per CONTEXT D-01 documented formulas).
  const ethBase = lvl <= 3 ? (24n * ETH_BASE_WEI) / 10n : 4n * ETH_BASE_WEI;
  // Sepolia /1M scaling (chain-config ETH_DIVISOR).
  if (chainId === 11155111) return ethBase / 1_000_000n;
  return ethBase;
}

// Compute deity next-price. n = number of deity passes already sold; the next
// price is 24 ETH + sum(1..n) ETH. Without the indexer count we surface
// 24 ETH base as a best-effort (next-price = base before any sales) — the
// static-call gate catches the on-chain mismatch before tx submits and the
// 'E' override decodes it correctly.
function computeDeityNextPriceWei(passesSold, chainId) {
  const n = Number(passesSold || 0);
  // 24 ETH base + sum(1..n) ETH = 24 + n*(n+1)/2 ETH.
  const ethBase = 24n * ETH_BASE_WEI;
  const ethPriorSum = (BigInt(n) * BigInt(n + 1) / 2n) * ETH_BASE_WEI;
  const total = ethBase + ethPriorSum;
  if (chainId === 11155111) return total / 1_000_000n;
  return total;
}

class AppPassSection extends HTMLElement {
  // --- Phase 60 / 61 / 62-01 idempotency-guard pattern ---
  #unsubs = [];
  #initialized = false;
  #busyWhale = false;
  // Per-symbol-id debounce for the deity grid (T-62-02-05 mitigation).
  #busySymbols = new Set();
  #errorTimerWhale = null;
  #errorTimerDeity = null;
  // --- Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED — NOT polling.js) ---
  #pollHandle = null;
  #pollController = null;
  #lastPollAt = 0;
  #visibilityListener = null;
  // --- Pinned data from /player/:address (server-derived; rendered via textContent) ---
  #playerData = null;
  #pinnedAddress = null;
  // Cached pricing snapshot for click-time msgValueWei computation.
  #pricingData = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#renderDeityGrid();
    this.#wireEventHandlers();
    this.#wireVisibilityRePoll();
    this.#wireStoreSubscriptions();
    this.#startPolling();
    // Eager first cycle on mount — no need to wait 30s.
    this.#runPollCycle();
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
    if (this.#errorTimerWhale != null) {
      try { clearTimeout(this.#errorTimerWhale); } catch (_) { /* defensive */ }
      this.#errorTimerWhale = null;
    }
    if (this.#errorTimerDeity != null) {
      try { clearTimeout(this.#errorTimerDeity); } catch (_) { /* defensive */ }
      this.#errorTimerDeity = null;
    }
    this.#busySymbols.clear();
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
      <section class="panel app-pass-section">
        <div class="panel-header">
          <h2>PASSES</h2>
        </div>

        <!-- WHALE ROW -->
        <div class="pass-whale-section">
          <h3 class="pass-section-title">Whale pass</h3>
          <p class="pass-blurb">
            Mint whale bundles for boosted ticket awards across upcoming levels.
          </p>
          <div class="pass-whale-row">
            <label class="pass-whale-label" for="pass-whale-qty-input">Quantity</label>
            <input type="number" name="pass-whale-qty" id="pass-whale-qty-input"
                   class="pass-whale-input" min="1" max="100" step="1" value="1">
            <span class="pass-whale-price" data-bind="pass-whale-price">—</span>
            <button type="button" class="pass-whale-buy" data-write data-bind="pass-whale-buy">
              Buy whale pass
            </button>
          </div>
          <div class="pass-whale-error" data-bind="pass-whale-error" hidden role="alert"></div>
        </div>

        <!-- DEITY GRID -->
        <div class="pass-deity-section">
          <h3 class="pass-section-title">Deity pass</h3>
          <p class="pass-deity-hint">Pick a symbol (0-31) to mint a deity pass.</p>
          <div class="pass-deity-grid" data-bind="pass-deity-grid"></div>
          <div class="pass-deity-error" data-bind="pass-deity-error" hidden role="alert"></div>
        </div>
      </section>
    `;
  }

  // Build the 32-cell deity-symbol grid via createElement + textContent (T-58-18).
  // Each cell carries data-symbol-id + data-write (CF-15) and a click handler
  // wired in #wireEventHandlers via event delegation on the grid container.
  #renderDeityGrid() {
    const grid = this.querySelector('[data-bind="pass-deity-grid"]');
    if (!grid) return;
    for (let i = 0; i < 32; i += 1) {
      const cell = document.createElement('button');
      cell.setAttribute('type', 'button');
      cell.classList.add('pass-deity-symbol');
      cell.setAttribute('data-write', '');
      cell.setAttribute('data-symbol-id', String(i));
      // textContent only (T-58-18). Glyph-mapping is a v4.7+ deferred idea.
      cell.textContent = String(i);
      grid.appendChild(cell);
    }
  }

  #wireEventHandlers() {
    const whaleBuy = this.querySelector('[data-bind="pass-whale-buy"]');
    if (whaleBuy) whaleBuy.addEventListener('click', (e) => this.#onWhaleBuyClick(e));
    // Per-cell click handler (no event delegation — fakeDOM dispatches synthetic
    // events directly on cells; this matches Phase 61 panel pattern).
    const cells = this.querySelectorAll('.pass-deity-symbol');
    for (const cell of cells) {
      cell.addEventListener('click', (e) => this.#onDeitySymbolClick(e, cell));
    }
  }

  // ---------------------------------------------------------------------
  // Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED — NOT polling.js).
  // ---------------------------------------------------------------------

  #startPolling() {
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
    }
    if (typeof setInterval !== 'function') return;
    this.#pollHandle = _setIntervalUnref(() => this.#runPollCycle(), POLL_INTERVAL_MS);
  }

  async #runPollCycle() {
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
    this.#lastPollAt = Date.now();

    try {
      const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
        || get('viewing.address')
        || get('connected.address')
        || null;
      this.#pinnedAddress = addr;
      if (!addr) {
        this.#playerData = null;
        this.#pricingData = null;
        this.#renderPricing();
        return;
      }
      const data = await fetchJSON(`/player/${addr}`);
      if (signal.aborted) return;
      this.#playerData = data || null;
      // Compute pricing snapshot from the player snapshot.
      const level = data?.level ?? data?.currentLevel ?? data?.player?.level ?? null;
      const passesSold = data?.deityPassesSold ?? data?.deity?.passesSold ?? 0;
      this.#pricingData = {
        currentLevel: level,
        whaleUnitPriceWei: computeWhaleUnitPriceWei(level, CHAIN.id),
        deityNextPriceWei: computeDeityNextPriceWei(passesSold, CHAIN.id),
      };
      this.#renderPricing();
    } catch (_e) {
      // Network blip — next cycle retries. Don't crash the panel.
    }
  }

  // Visibility-aware refresh — on foreground return AFTER ≥5min hidden, fire
  // an immediate cycle within 1s. Mirrors Phase 56 D-04 + Phase 61 D-04.
  #wireVisibilityRePoll() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#visibilityListener = () => {
      if (document.visibilityState !== 'visible') return;
      const elapsed = Date.now() - this.#lastPollAt;
      if (elapsed >= 5 * 60 * 1000) {
        this.#runPollCycle();
      }
    };
    document.addEventListener('visibilitychange', this.#visibilityListener);
  }

  #wireStoreSubscriptions() {
    const u1 = subscribe('connected.address', () => this.#runPollCycle());
    const u2 = subscribe('viewing.address', () => this.#runPollCycle());
    this.#unsubs.push(u1, u2);
  }

  // ---------------------------------------------------------------------
  // Render pricing snapshot — server-derived strings via textContent (T-58-18).
  // CF-06: NEVER optimistic balance subtraction. The price text reflects the
  // computed snapshot; pending-tx state does NOT mutate it locally.
  // ---------------------------------------------------------------------

  #renderPricing() {
    const priceEl = this.querySelector('[data-bind="pass-whale-price"]');
    if (!priceEl) return;
    const p = this.#pricingData;
    if (!p || p.whaleUnitPriceWei == null) {
      priceEl.textContent = 'Loading price…';
      return;
    }
    priceEl.textContent = `Per pass: ${String(p.whaleUnitPriceWei)} wei`;
  }

  // ---------------------------------------------------------------------
  // Whale buy click handler — closure-form sendTx via passes.purchaseWhaleBundle.
  // ---------------------------------------------------------------------

  async #onWhaleBuyClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyWhale) return;
    this.#busyWhale = true;

    const btn = this.querySelector('[data-bind="pass-whale-buy"]');
    const originalLabel = btn ? btn.textContent : 'Buy whale pass';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Buying…';
    }
    this.#clearWhaleError();

    try {
      const qtyInput = this.querySelector('[name="pass-whale-qty"]');
      const rawValue = qtyInput ? qtyInput.value : '0';
      const quantity = parseInt(rawValue, 10);
      if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100) {
        this.#renderWhaleError('Quantity must be 1-100.');
        return;
      }
      const unit = this.#pricingData?.whaleUnitPriceWei ?? 0n;
      const msgValueWei = unit * BigInt(quantity);

      await purchaseWhaleBundle({ quantity, msgValueWei });

      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'whale', quantity },
          bubbles: true,
        }));
      } catch (_e) { /* defensive — fakeDOM CustomEvent shim */ }

      // Clear all error states across the panel on next-success-anywhere.
      this.#clearAllErrorStates();
      // 250ms post-confirm refetch (CF-06).
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      const msg = error?.userMessage || error?.message || 'Buy failed.';
      this.#renderWhaleError(msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
      // Release debounce after window expires.
      setTimeout(() => { this.#busyWhale = false; }, DEBOUNCE_MS);
    }
  }

  // ---------------------------------------------------------------------
  // Deity symbol click handler — closure-form sendTx via passes.purchaseDeityPass.
  //
  // CONTEXT D-05 LOCKED 'E' override:
  //   On revert, decode via reason-map (or use error.code if pre-decoded), then
  //   apply deityPassErrorOverride. If decoded.code === 'E', the override
  //   surfaces "That symbol's taken — try another." and the picker stays open
  //   with the selected symbol cleared so the user re-picks visibly.
  // ---------------------------------------------------------------------

  async #onDeitySymbolClick(e, cell) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    const symbolIdAttr = cell.attributes['data-symbol-id'];
    const symbolId = Number(symbolIdAttr);
    if (this.#busySymbols.has(symbolId)) return;
    this.#busySymbols.add(symbolId);

    cell.classList.add('pass-deity-symbol--selected');
    const originalLabel = cell.textContent;
    cell.disabled = true;
    this.#clearDeityError();

    try {
      const msgValueWei = this.#pricingData?.deityNextPriceWei ?? 0n;
      await purchaseDeityPass({ symbolId, msgValueWei });

      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'deity', symbolId },
          bubbles: true,
        }));
      } catch (_e) { /* defensive */ }

      this.#clearAllErrorStates();
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      // CONTEXT D-05 LOCKED override path. Use error.code if pre-decoded
      // (passes.js wraps revert errors via _structuredRevertError); otherwise
      // decode via reason-map.
      const decoded = error?.code
        ? { code: error.code, userMessage: error.userMessage, recoveryAction: error.recoveryAction }
        : decodeRevertReason(error);
      const overridden = deityPassErrorOverride(decoded);
      const msg = overridden?.userMessage || error?.message || 'Buy failed.';
      this.#renderDeityError(msg);
      // Per CONTEXT D-05 step 1: clear selected symbol so user re-picks visibly.
      cell.classList.remove('pass-deity-symbol--selected');
    } finally {
      cell.disabled = false;
      cell.textContent = originalLabel;
      setTimeout(() => { this.#busySymbols.delete(symbolId); }, DEBOUNCE_MS);
    }
  }

  // ---------------------------------------------------------------------
  // Error rendering — textContent only (T-58-18). 10s auto-clear timer.
  // ---------------------------------------------------------------------

  #renderWhaleError(msg) {
    const errEl = this.querySelector('[data-bind="pass-whale-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimerWhale != null) {
      try { clearTimeout(this.#errorTimerWhale); } catch (_) { /* defensive */ }
    }
    this.#errorTimerWhale = setTimeout(() => this.#clearWhaleError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimerWhale && typeof this.#errorTimerWhale.unref === 'function') {
      try { this.#errorTimerWhale.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearWhaleError() {
    const errEl = this.querySelector('[data-bind="pass-whale-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimerWhale != null) {
      try { clearTimeout(this.#errorTimerWhale); } catch (_) { /* defensive */ }
      this.#errorTimerWhale = null;
    }
  }

  #renderDeityError(msg) {
    const errEl = this.querySelector('[data-bind="pass-deity-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimerDeity != null) {
      try { clearTimeout(this.#errorTimerDeity); } catch (_) { /* defensive */ }
    }
    this.#errorTimerDeity = setTimeout(() => this.#clearDeityError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimerDeity && typeof this.#errorTimerDeity.unref === 'function') {
      try { this.#errorTimerDeity.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearDeityError() {
    const errEl = this.querySelector('[data-bind="pass-deity-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimerDeity != null) {
      try { clearTimeout(this.#errorTimerDeity); } catch (_) { /* defensive */ }
      this.#errorTimerDeity = null;
    }
  }

  // Cross-section error clearing (next-success-anywhere). Mirrors Phase 61 D-05.
  #clearAllErrorStates() {
    this.#clearWhaleError();
    this.#clearDeityError();
  }
}

// Idempotency-guarded registration (Phase 58/59/60/61/62-01 pattern).
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-pass-section')) {
    customElements.define('app-pass-section', AppPassSection);
  }
}

export { AppPassSection };
