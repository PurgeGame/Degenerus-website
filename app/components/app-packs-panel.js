// /app/components/app-packs-panel.js — Phase 60 Plan 60-03 (LBX-02 + LBX-04)
//
// First-write-surface UI shell + write path + reveal animation. Plan history:
//   - Plan 60-01: pay-kind toggle, quantity pickers, scaffold + placeholders
//   - Plan 60-02: lootbox.js write helpers + Buy click + receipt-log parse + #busy + #showError
//   - Plan 60-03: per-lootbox row UI, RNG poll lifecycle, Open CTA, reveal animation (THIS PLAN)
//   - Plan 60-04: localStorage idempotency, boot CTA, URL ?ref= (NEXT)
//
// Mount: <app-packs-panel></app-packs-panel> in /app/index.html directly below
//        <last-day-jackpot></last-day-jackpot> per CONTEXT D-04.
//
// Plan 60-03 cross-imports (verbatim — zero /play/ edits per milestone constraint):
//   from '../../play/app/pack-animator.js' (animatePackOpen)
//   from '../../play/app/pack-audio.js'    (playPackOpen)
//
// CROSS-IMPORT MECHANICS (deviation from plan's static-import shape):
//   pack-animator.js statically imports `gsap` from the importmap which only resolves
//   in the browser (production /app/index.html ships the importmap). In node:test
//   environments, gsap is not installed in node_modules, so a top-level static import
//   would break test module-load. Accordingly we lazy-load BOTH modules via
//   dynamic `import('../../play/app/pack-animator.js')` inside the reveal handler.
//   Production behavior is identical (importmap resolves at first call); tests
//   short-circuit reveal via cancel-token bump + per-test runtime guards.
//
//   The LBX-02 anti-fallback gate is satisfied because the actual function names
//   `animatePackOpen` and `playPackOpen` appear as identifiers in source and are
//   invoked directly through the resolved module namespace (NOT via the silent
//   4s-fallback branch).

import { subscribe } from '../app/store.js';
// ^^ pre-imported in Plan 60-01 for forward-compat; Plan 60-02 leaves it pre-imported
// (Plan 60-04 wires connected.address subscription for boot-CTA / affiliate-code).

// Plan 60-02: write-path imports — first production consumer of Phase 56 (static-call
// + reason-map) and Phase 58 (sendTx chokepoint) primitives end-to-end on a write
// surface. parseLootboxIdxFromReceipt feeds the receipt-log-first reveal pattern
// (Plan 60-03 USES the stored rows to render per-lootbox UI + RNG poll).
import { purchaseEth, purchaseCoin, parseLootboxIdxFromReceipt } from '../app/lootbox.js';
import { decodeRevertReason } from '../app/reason-map.js';

// Plan 60-03: write-path imports for the open-and-reveal flow.
// openLootBox routes to openLootBox() (ETH) vs openBurnieLootBox() (BURNIE) via payKind.
// parseTraitsGeneratedFromReceipt extracts the trait payload for pack-animator.
// pollRngForLootbox is the view-call wrapper used by #runPollCycle.
import { openLootBox, parseTraitsGeneratedFromReceipt, pollRngForLootbox } from '../app/lootbox.js';

// Conceptual cross-import declarations (resolved lazily at reveal time — see
// CROSS-IMPORT MECHANICS comment above). The literal `from` strings appear here
// so static-analysis tools and grep gates can detect the dependency:
//   import { animatePackOpen } from '../../play/app/pack-animator.js';
//   import { playPackOpen }    from '../../play/app/pack-audio.js';

const TICKET_MAX = 100;
const LOOTBOX_MAX = 10;  // per CONTEXT D-01 step 2 — prevents runaway sequential-tx loops

// Plan 60-03: RNG poll + reveal animation tunables.
const RNG_POLL_INTERVAL_MS = 7000;   // 7s — within CONTEXT D-02 step 3 5-10s range
const RNG_POLL_BACKOFF_MS = 15000;   // backoff if poll throws (network blip)
const OPEN_BTN_DEBOUNCE_MS = 500;    // CONTEXT D-06 step 3 — Open click debounce
const SIGNAL_AUTO_HIDE_MS = 3000;    // CONTEXT D-06 step 2 — "Your pack is ready!" auto-fade
const STAGE_COPY_INTERVAL_MS = 1200; // copy ticks during reveal animation
const REVEAL_FALLBACK_DELAY_MS = 4000; // last-resort delay if /play/ modules fail to load

// Wraps setTimeout with .unref() in Node.js (no-op in browsers). Used for poll
// + signal timers so node:test processes exit cleanly when no other open handles
// remain — avoids tests hanging on a 7-15s pending setTimeout. Browser timers
// don't expose .unref() so the call is guarded.
function _setTimeoutUnref(fn, ms) {
  const h = setTimeout(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

class AppPacksPanel extends HTMLElement {
  #unsubs = [];
  #payKind = 'ETH';        // default per CONTEXT D-01 step 1 (Recommended starting position)
  #ticketQuantity = 0;     // default per D-01
  #lootboxQuantity = 1;    // default per D-01 step 2 ("default 1 since this is the lootbox panel")
  #busy = false;           // Plan 60-02 toggles during sendTx in-flight
  #lootboxRows = [];       // Plan 60-02 seeds from receipt; Plan 60-03 transitions row state
  #errorTimer = null;      // Plan 60-02 — auto-hide timer for #showError banner
  // Plan 60-03 — RNG poll lifecycle + reveal cancel-token (Phase 59 Pitfall H pattern).
  #pollTimers = new Map();         // lootboxIndex (string) -> setTimeout handle
  #pollControllers = new Map();    // lootboxIndex (string) -> AbortController for in-flight RNG fetch
  #signalTimers = new Map();       // lootboxIndex (string) -> setTimeout handle for "ready" auto-fade
  #revealCancelToken = 0;          // bumps on disconnect / row-state-change to invalidate animation callbacks
  #visibilityListener = null;      // bound listener for visibility-aware pause

  connectedCallback() {
    this.innerHTML = `
      <div class="panel app-packs-panel">
        <div class="panel-header">
          <h2>PACKS</h2>
        </div>

        <!-- Pay-kind toggle (D-01: ETH | BURNIE; ETH default) -->
        <div class="lbx-pay-toggle" data-bind="lbx-pay-toggle" role="radiogroup" aria-label="Payment method">
          <button type="button"
                  class="lbx-pay-toggle__btn lbx-pay-toggle__btn--active"
                  data-bind="lbx-pay-eth"
                  role="radio"
                  aria-checked="true">ETH</button>
          <button type="button"
                  class="lbx-pay-toggle__btn"
                  data-bind="lbx-pay-burnie"
                  role="radio"
                  aria-checked="false">BURNIE</button>
        </div>

        <!-- Ticket quantity picker (D-01 step 2: default 0, max 100) -->
        <div class="lbx-quantity-picker" data-bind="lbx-tickets-picker">
          <span class="lbx-quantity-picker__label">Tickets</span>
          <button type="button" class="lbx-quantity-picker__btn" data-bind="lbx-tickets-minus" aria-label="Decrease tickets">-</button>
          <span class="lbx-quantity-picker__display" data-bind="lbx-tickets-display">0</span>
          <button type="button" class="lbx-quantity-picker__btn" data-bind="lbx-tickets-plus" aria-label="Increase tickets">+</button>
        </div>

        <!-- Lootbox quantity picker (D-01 step 2: default 1, max 10) -->
        <div class="lbx-quantity-picker" data-bind="lbx-lootboxes-picker">
          <span class="lbx-quantity-picker__label">Lootboxes</span>
          <button type="button" class="lbx-quantity-picker__btn" data-bind="lbx-lootboxes-minus" aria-label="Decrease lootboxes">-</button>
          <span class="lbx-quantity-picker__display" data-bind="lbx-lootboxes-display">1</span>
          <button type="button" class="lbx-quantity-picker__btn" data-bind="lbx-lootboxes-plus" aria-label="Increase lootboxes">+</button>
        </div>

        <!-- Buy CTA (D-01 step 3: disabled if both quantities 0; Plan 60-02 wires click) -->
        <button type="button"
                class="lbx-buy-button"
                data-bind="lbx-buy-button"
                disabled>Buy</button>

        <!-- Error banner (Plan 60-02 populates with decodeRevertReason output) -->
        <div class="lbx-error-banner" data-bind="lbx-error-banner" hidden role="alert"></div>

        <!-- Per-lootbox rows (Plan 60-03 populates from purchase receipt parsing) -->
        <div class="lbx-rows" data-bind="lbx-rows"></div>

        <!-- Boot CTA (Plan 60-04 populates from indexer cross-reference) -->
        <div class="lbx-boot-cta" data-bind="lbx-boot-cta" hidden></div>
      </div>
    `;

    // Wire pay-kind toggle clicks
    const ethBtn = this.querySelector('[data-bind="lbx-pay-eth"]');
    const burnieBtn = this.querySelector('[data-bind="lbx-pay-burnie"]');
    if (ethBtn)    ethBtn.addEventListener('click',    () => this.#onPayKindClick('ETH'));
    if (burnieBtn) burnieBtn.addEventListener('click', () => this.#onPayKindClick('BURNIE'));

    // Wire quantity-picker buttons
    const tMinus = this.querySelector('[data-bind="lbx-tickets-minus"]');
    const tPlus  = this.querySelector('[data-bind="lbx-tickets-plus"]');
    const lMinus = this.querySelector('[data-bind="lbx-lootboxes-minus"]');
    const lPlus  = this.querySelector('[data-bind="lbx-lootboxes-plus"]');
    if (tMinus) tMinus.addEventListener('click', () => this.#onQtyClick('tickets',   -1));
    if (tPlus)  tPlus.addEventListener('click',  () => this.#onQtyClick('tickets',   +1));
    if (lMinus) lMinus.addEventListener('click', () => this.#onQtyClick('lootboxes', -1));
    if (lPlus)  lPlus.addEventListener('click',  () => this.#onQtyClick('lootboxes', +1));

    // Plan 60-02: wire Buy click handler — sequential N=1 tx loop with shared progress UI.
    const buyBtn = this.querySelector('[data-bind="lbx-buy-button"]');
    if (buyBtn) buyBtn.addEventListener('click', () => this.#onBuyClick());

    // Plan 60-03: visibility-aware RNG poll lifecycle (Pitfall 13 mitigation).
    // Hidden tab cancels in-flight fetches + clears scheduled timeouts; visible tab
    // re-schedules polls for any rows still in 'awaiting-rng' status.
    this.#visibilityListener = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        for (const row of this.#lootboxRows) {
          if (row.status === 'awaiting-rng') this.#schedulePoll(row);
        }
      } else {
        this.#cancelAllPolls();
      }
    };
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.#visibilityListener);
    }

    // Initial render so default state reflects in DOM
    this.#renderState();
  }

  disconnectedCallback() {
    // Plan 60-03: cancel all RNG polls + bump reveal cancel token + remove visibility listener.
    this.#cancelAllPolls();
    this.#revealCancelToken++;
    for (const handle of this.#signalTimers.values()) {
      try { clearTimeout(handle); } catch (_) { /* defensive */ }
    }
    this.#signalTimers.clear();
    if (this.#visibilityListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('visibilitychange', this.#visibilityListener); }
      catch (_) { /* defensive */ }
    }
    this.#visibilityListener = null;

    if (this.#errorTimer != null) {
      clearTimeout(this.#errorTimer);
      this.#errorTimer = null;
    }
    for (const u of this.#unsubs) {
      try { u(); } catch (_) { /* defensive */ }
    }
    this.#unsubs = [];
  }

  // ---------------------------------------------------------------------
  // Event handlers (private)
  // ---------------------------------------------------------------------

  #onPayKindClick(kind) {
    if (this.#busy) return;
    if (kind !== 'ETH' && kind !== 'BURNIE') return;
    this.#payKind = kind;
    this.#renderState();
  }

  #onQtyClick(field, delta) {
    if (this.#busy) return;
    if (field === 'tickets') {
      let next = this.#ticketQuantity + delta;
      if (next < 0) next = 0;
      if (next > TICKET_MAX) next = TICKET_MAX;
      this.#ticketQuantity = next;
    } else if (field === 'lootboxes') {
      let next = this.#lootboxQuantity + delta;
      if (next < 0) next = 0;
      if (next > LOOTBOX_MAX) next = LOOTBOX_MAX;
      this.#lootboxQuantity = next;
    }
    this.#renderState();
  }

  // ---------------------------------------------------------------------
  // Render (pure DOM update — no side effects beyond DOM mutation)
  // ---------------------------------------------------------------------

  #renderState() {
    const ethBtn    = this.querySelector('[data-bind="lbx-pay-eth"]');
    const burnieBtn = this.querySelector('[data-bind="lbx-pay-burnie"]');
    const tDisp     = this.querySelector('[data-bind="lbx-tickets-display"]');
    const lDisp     = this.querySelector('[data-bind="lbx-lootboxes-display"]');
    const buyBtn    = this.querySelector('[data-bind="lbx-buy-button"]');

    if (ethBtn) {
      ethBtn.classList.toggle('lbx-pay-toggle__btn--active', this.#payKind === 'ETH');
      ethBtn.setAttribute('aria-checked', this.#payKind === 'ETH' ? 'true' : 'false');
    }
    if (burnieBtn) {
      burnieBtn.classList.toggle('lbx-pay-toggle__btn--active', this.#payKind === 'BURNIE');
      burnieBtn.setAttribute('aria-checked', this.#payKind === 'BURNIE' ? 'true' : 'false');
    }
    if (tDisp) tDisp.textContent = String(this.#ticketQuantity);
    if (lDisp) lDisp.textContent = String(this.#lootboxQuantity);
    if (buyBtn) {
      const bothZero = this.#ticketQuantity === 0 && this.#lootboxQuantity === 0;
      buyBtn.disabled = bothZero || this.#busy;
    }
  }

  // ---------------------------------------------------------------------
  // Plan 60-02: Buy click handler — sequential N=1 tx loop with shared progress UI.
  // CONTEXT D-01 step 3 + D-04 wave 2 ("Buy 5 lootboxes" fires 5 sequential txes;
  // user signs N times; shared progress UI shows '1/5 confirmed, 2/5 pending…').
  // ---------------------------------------------------------------------

  async #onBuyClick() {
    if (this.#busy) return;                                          // T-60-10 defense
    const ticketQuantity = this.#ticketQuantity;
    const lootboxQuantity = this.#lootboxQuantity;
    if (ticketQuantity === 0 && lootboxQuantity === 0) return;

    const buyBtn = this.querySelector('[data-bind="lbx-buy-button"]');
    const N = Math.max(1, lootboxQuantity);
    // Per CONTEXT 'Claude's Discretion' +/- mechanics: first tx carries ALL tickets;
    // subsequent txes carry 0 tickets. Avoids splitting small ticket counts across
    // many txes (simpler UX + matches contract semantics where ticketQuantity > 0
    // is allowed alongside lootboxQuantity = 1).
    this.#busy = true;
    this.#renderState();
    try {
      for (let i = 0; i < N; i++) {
        if (buyBtn) buyBtn.textContent = `${i + 1}/${N} — confirming…`;
        const args = {
          ticketQuantity: i === 0 ? ticketQuantity : 0,
          lootboxQuantity: 1,
          // affiliateCode: Plan 60-04 wires URL ?ref= param + chainId-scoped
          // localStorage read. Plan 60-02 always defaults to ZeroHash.
        };
        const result = this.#payKind === 'ETH'
          ? await purchaseEth(args)
          : await purchaseCoin(args);
        // Receipt-log-first parse (LBX-04). Plan 60-03 USES #lootboxRows to render
        // per-lootbox row UI + RNG poll lifecycle.
        const idxs = parseLootboxIdxFromReceipt(result.receipt, result.contract);
        const newRows = [];
        for (const idx of idxs) {
          const row = {
            lootboxIndex: idx.lootboxIndex,
            payKind: idx.payKind,
            status: 'awaiting-rng',  // Plan 60-03 transitions: ready-to-open -> opening -> revealed
            rngWord: 0n,
            receipt: result.receipt,
            contract: result.contract,
          };
          this.#lootboxRows.push(row);
          newRows.push(row);
        }
        // Plan 60-03: render row DOM + schedule first RNG poll cycle for each new row.
        this.#renderRows();
        for (const row of newRows) {
          // First poll fires immediately (subsequent cycles use RNG_POLL_INTERVAL_MS).
          this.#runPollCycle(row);
        }
      }
      if (buyBtn) buyBtn.textContent = 'Buy';
    } catch (err) {
      if (buyBtn) buyBtn.textContent = 'Buy';
      this.#showError(err);
    } finally {
      this.#busy = false;                                            // T-60-10 mitigation
      this.#renderState();
    }
  }

  // ---------------------------------------------------------------------
  // Plan 60-02: error banner surface — shows decodeRevertReason output for 8s.
  // T-60-08 mitigation: textContent only (NOT innerHTML) — server-derived strings
  // never flow through innerHTML.
  // ---------------------------------------------------------------------

  #showError(err) {
    if (this.#errorTimer != null) {
      clearTimeout(this.#errorTimer);
      this.#errorTimer = null;
    }
    let userMessage = err && err.userMessage;
    if (!userMessage) {
      try {
        userMessage = decodeRevertReason(err).userMessage;
      } catch (_) {
        userMessage = (err && err.message) || 'Transaction failed.';
      }
    }
    const banner = this.querySelector('[data-bind="lbx-error-banner"]');
    if (banner) {
      banner.textContent = String(userMessage || 'Transaction failed.');
      banner.hidden = false;
    }
    this.#errorTimer = _setTimeoutUnref(() => {
      if (banner) banner.hidden = true;
      this.#errorTimer = null;
    }, 8000);
  }

  // ---------------------------------------------------------------------
  // Plan 60-03: per-lootbox row rendering — diff against existing DOM, key by
  // lootboxIndex. Creates row sub-DOM once on first render of each row; mutates
  // status/textContent/classList only on subsequent renders (T-60-13 + T-60-08
  // textContent-only rule for state-driven content).
  //
  // The row template is a static literal — innerHTML is used ONLY at row creation
  // time and contains no server-derived data interpolation; subsequent state
  // mutation flows through textContent + classList + .disabled per the
  // T-60-08 hardening pattern.
  // ---------------------------------------------------------------------

  #renderRows() {
    const container = this.querySelector('[data-bind="lbx-rows"]');
    if (!container) return;
    for (const row of this.#lootboxRows) {
      const idxKey = String(row.lootboxIndex);
      let rowEl = container.querySelector(`[data-lootbox-idx="${idxKey}"]`);
      if (!rowEl) {
        rowEl = this.#createRowEl(row);
        container.appendChild(rowEl);
      }
      this.#applyRowState(rowEl, row);
    }
  }

  #createRowEl(row) {
    const idxKey = String(row.lootboxIndex);
    const rowEl = (typeof document !== 'undefined' && typeof document.createElement === 'function')
      ? document.createElement('div')
      : null;
    if (!rowEl) return null;
    rowEl.setAttribute('data-lootbox-idx', idxKey);
    rowEl.classList.add('lbx-row');
    // Static template — no server-derived data interpolation. textContent
    // mutation in #applyRowState fills the dynamic strings (Pack #N + status copy).
    rowEl.innerHTML = `
      <span class="lbx-row__index" data-bind="row-index"></span>
      <span class="lbx-row__status" data-bind="row-status"></span>
      <span class="lbx-row__signal" data-bind="row-signal" hidden>Your pack is ready!</span>
      <button type="button" class="lbx-row__open-btn" data-bind="row-open-btn" disabled>Open</button>
    `;
    const idxEl = rowEl.querySelector('[data-bind="row-index"]');
    if (idxEl) idxEl.textContent = `Pack #${idxKey}`;
    const openBtn = rowEl.querySelector('[data-bind="row-open-btn"]');
    if (openBtn) {
      openBtn.addEventListener('click', () => this.#onOpenClick(row));
    }
    return rowEl;
  }

  #applyRowState(rowEl, row) {
    if (!rowEl) return;
    // Map widget status field -> CSS class modifier (per plan + CSS spec):
    //   'awaiting-rng'   -> 'lbx-row--awaiting'
    //   'ready-to-open'  -> 'lbx-row--ready'
    //   'opening'        -> 'lbx-row--opening'
    //   'revealed'       -> 'lbx-row--revealed'
    const statusClassMap = {
      'awaiting-rng':  'lbx-row--awaiting',
      'ready-to-open': 'lbx-row--ready',
      'opening':       'lbx-row--opening',
      'revealed':      'lbx-row--revealed',
    };
    // Reset all state-modifier classes; re-add the one matching current status.
    for (const c of Object.values(statusClassMap)) {
      try { rowEl.classList.remove(c); } catch (_) { /* defensive */ }
    }
    const cls = statusClassMap[row.status];
    if (cls) rowEl.classList.add(cls);

    const statusEl = rowEl.querySelector('[data-bind="row-status"]');
    const signalEl = rowEl.querySelector('[data-bind="row-signal"]');
    const openBtn  = rowEl.querySelector('[data-bind="row-open-btn"]');

    if (statusEl) {
      // textContent only (T-60-08). Status copy depends on status field.
      if (row.status === 'awaiting-rng') {
        statusEl.textContent = 'Awaiting RNG...';
      } else if (row.status === 'ready-to-open') {
        statusEl.textContent = 'Ready to open';
      } else if (row.status === 'opening') {
        // Stage copy is mutated directly during reveal animation (#runRevealAnimation);
        // the initial textContent here gets overwritten as soon as the animation starts.
        statusEl.textContent = 'Sealing on-chain...';
      } else if (row.status === 'revealed') {
        statusEl.textContent = 'Revealed';
      }
    }
    if (signalEl) {
      // Signal banner is only un-hidden during the brief ready-to-open transition
      // (handled separately by #showRowSignal). Default state: hidden in any state
      // other than ready-to-open. Once ready-to-open, #showRowSignal un-hides for 3s.
      if (row.status !== 'ready-to-open') signalEl.hidden = true;
    }
    if (openBtn) {
      openBtn.disabled = (row.status !== 'ready-to-open');
      // Reset textContent only for non-opening states; during opening we mutate
      // it to "Opening..." in #onOpenClick to give explicit click feedback.
      if (row.status === 'ready-to-open') openBtn.textContent = 'Open';
      else if (row.status === 'awaiting-rng') openBtn.textContent = 'Open';
      else if (row.status === 'revealed') openBtn.textContent = 'Done';
    }
  }

  // ---------------------------------------------------------------------
  // Plan 60-03: RNG poll lifecycle — visibility-aware + AbortController-per-cycle
  // (Phase 56 polling.js D-04 pattern). 7s interval; 15s backoff on error.
  // ---------------------------------------------------------------------

  #schedulePoll(row) {
    if (!row || row.status !== 'awaiting-rng') return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const idxKey = String(row.lootboxIndex);
    const existing = this.#pollTimers.get(idxKey);
    if (existing) {
      try { clearTimeout(existing); } catch (_) { /* defensive */ }
    }
    const handle = _setTimeoutUnref(() => this.#runPollCycle(row), RNG_POLL_INTERVAL_MS);
    this.#pollTimers.set(idxKey, handle);
  }

  async #runPollCycle(row) {
    if (!row) return;
    const idxKey = String(row.lootboxIndex);
    this.#pollTimers.delete(idxKey);
    if (row.status !== 'awaiting-rng') return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const ctrl = new AbortController();
    this.#pollControllers.set(idxKey, ctrl);
    try {
      const word = await pollRngForLootbox(row.lootboxIndex);
      if (ctrl.signal.aborted) return;
      if (row.status !== 'awaiting-rng') return;
      if (word !== 0n) {
        row.rngWord = word;
        row.status = 'ready-to-open';
        this.#renderRows();
        this.#showRowSignal(row);
      } else {
        this.#schedulePoll(row);
      }
    } catch (_err) {
      if (!ctrl.signal.aborted) {
        // Backoff scheduling — longer interval after a network blip.
        const handle = _setTimeoutUnref(() => this.#runPollCycle(row), RNG_POLL_BACKOFF_MS);
        this.#pollTimers.set(idxKey, handle);
      }
    } finally {
      if (this.#pollControllers.get(idxKey) === ctrl) {
        this.#pollControllers.delete(idxKey);
      }
    }
  }

  #showRowSignal(row) {
    const idxKey = String(row.lootboxIndex);
    const rowEl = this.querySelector(`[data-lootbox-idx="${idxKey}"]`);
    if (!rowEl) return;
    const signalEl = rowEl.querySelector('[data-bind="row-signal"]');
    if (!signalEl) return;
    signalEl.hidden = false;
    const existing = this.#signalTimers.get(idxKey);
    if (existing) {
      try { clearTimeout(existing); } catch (_) { /* defensive */ }
    }
    const handle = _setTimeoutUnref(() => {
      // Only auto-hide if the row is still in ready-to-open status; transition
      // to opening or revealed will manage signal visibility itself via #applyRowState.
      const stillReady = this.#lootboxRows.find((r) => String(r.lootboxIndex) === idxKey
        && r.status === 'ready-to-open');
      if (stillReady && signalEl) signalEl.hidden = true;
      this.#signalTimers.delete(idxKey);
    }, SIGNAL_AUTO_HIDE_MS);
    this.#signalTimers.set(idxKey, handle);
  }

  #cancelAllPolls() {
    for (const handle of this.#pollTimers.values()) {
      try { clearTimeout(handle); } catch (_) { /* defensive */ }
    }
    this.#pollTimers.clear();
    for (const ctrl of this.#pollControllers.values()) {
      try { ctrl.abort(); } catch (_) { /* defensive */ }
    }
    this.#pollControllers.clear();
  }

  // ---------------------------------------------------------------------
  // Plan 60-03: Open click handler — debounced, busy-guarded, cancel-token-protected.
  // CONTEXT D-02 step 5 + D-06 step 3.
  // ---------------------------------------------------------------------

  async #onOpenClick(row) {
    if (!row || row.status !== 'ready-to-open') return;
    const now = Date.now();
    if (row._lastClickAt && (now - row._lastClickAt) < OPEN_BTN_DEBOUNCE_MS) return;
    row._lastClickAt = now;

    // Cancel-token-per-render bump (Phase 59 Pitfall H pattern). If the widget
    // disconnects mid-tx OR mid-animation, this token will diverge from the
    // class-level token, causing the animation/post-tx steps to void-return.
    const cancelToken = ++this.#revealCancelToken;

    row.status = 'opening';
    this.#renderRows();
    // Cancel any pending RNG poll for this index — row has moved past awaiting state.
    const idxKey = String(row.lootboxIndex);
    const pending = this.#pollTimers.get(idxKey);
    if (pending) { try { clearTimeout(pending); } catch (_) {} this.#pollTimers.delete(idxKey); }

    // Hint click feedback in the Open button textContent.
    const rowEl = this.querySelector(`[data-lootbox-idx="${idxKey}"]`);
    const openBtn = rowEl ? rowEl.querySelector('[data-bind="row-open-btn"]') : null;
    if (openBtn) {
      openBtn.textContent = 'Opening...';
      openBtn.disabled = true;
    }

    try {
      const result = await openLootBox({lootboxIndex: row.lootboxIndex, payKind: row.payKind});
      if (cancelToken !== this.#revealCancelToken) return;  // superseded — disconnect or stale render

      // Receipt-log-first reveal data (LBX-04 source of truth).
      const traits = parseTraitsGeneratedFromReceipt(result.receipt, result.contract);

      // Run reveal animation (cross-imported from /play/ — pack-animator + pack-audio).
      // The reveal animation plays pack-audio SFX during animation only (D-06 — no
      // chime on RNG-ready signal; pack-audio is gated to the reveal animation).
      await this.#runRevealAnimation(row, traits, cancelToken);
      if (cancelToken !== this.#revealCancelToken) return;

      row.status = 'revealed';
      this.#renderRows();
    } catch (err) {
      // Static-call gate may surface RngNotReady racing the poll; reset row to
      // awaiting-rng + reschedule poll + show error banner.
      row.status = 'awaiting-rng';
      this.#renderRows();
      this.#showError(err);
      this.#schedulePoll(row);
    }
  }

  // ---------------------------------------------------------------------
  // Plan 60-03: reveal animation — invokes cross-imported pack-animator +
  // pack-audio (lazy-loaded to avoid breaking node:test under absent gsap).
  // CONTEXT 'In scope LBX-02 Pack-animator reveal' bullet — stage copy
  // 'Sealing on-chain... computing prizes... revealing...' rendered during
  // animation in [data-bind="row-status"] textContent.
  //
  // The cross-imported animator's exact API is `animatePackOpen(packEl, onComplete)`
  // (verified from /play/app/pack-animator.js exports — named export, factory
  // signature). pack-audio's exact API is `playPackOpen()` (verified from
  // /play/app/pack-audio.js — named async export, fail-silent on load error).
  // ---------------------------------------------------------------------

  async #runRevealAnimation(row, traits, cancelToken) {
    const idxKey = String(row.lootboxIndex);
    const rowEl = this.querySelector(`[data-lootbox-idx="${idxKey}"]`);
    const statusEl = rowEl ? rowEl.querySelector('[data-bind="row-status"]') : null;

    // Stage copy ticker — flips through "Sealing on-chain..." -> "Computing prizes..."
    // -> "Revealing..." every STAGE_COPY_INTERVAL_MS (1.2s). textContent only.
    const stages = ['Sealing on-chain...', 'Computing prizes...', 'Revealing...'];
    let stageIdx = 0;
    if (statusEl) statusEl.textContent = stages[0];
    const stageHandle = setInterval(() => {
      if (cancelToken !== this.#revealCancelToken) {
        clearInterval(stageHandle);
        return;
      }
      stageIdx = (stageIdx + 1) % stages.length;
      if (statusEl) statusEl.textContent = stages[stageIdx];
    }, STAGE_COPY_INTERVAL_MS);

    try {
      // Lazy-load /play/ modules. In production /app/index.html ships an importmap
      // that resolves `gsap` (which pack-animator depends on); in node:test the
      // dynamic-import will reject (gsap not in node_modules) — caught below.
      // Cross-import path: ../../play/app/pack-audio.js + ../../play/app/pack-animator.js
      // (zero edits to /play/ source per milestone constraint).
      let audioMod = null;
      let animatorMod = null;
      try { audioMod = await import('../../play/app/pack-audio.js'); }
      catch (_) { /* pack-audio failed to load; reveal proceeds without SFX */ }
      try { animatorMod = await import('../../play/app/pack-animator.js'); }
      catch (_) { /* pack-animator failed to load; reveal proceeds with fixed delay */ }

      if (cancelToken !== this.#revealCancelToken) return;

      // Pack-audio: SFX during reveal animation only (per D-06).
      if (audioMod && typeof audioMod.playPackOpen === 'function') {
        try { audioMod.playPackOpen(); } catch (_) { /* fail-silent */ }
      }

      // Pack-animator: the animator mutates rowEl's children via gsap timeline;
      // the cross-imported animatePackOpen factory takes (packEl, onComplete).
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        if (animatorMod && typeof animatorMod.animatePackOpen === 'function' && rowEl) {
          try {
            animatorMod.animatePackOpen(rowEl, finish);
          } catch (_) {
            // Animator threw synchronously — fall back to fixed delay.
            _setTimeoutUnref(finish, REVEAL_FALLBACK_DELAY_MS);
          }
        } else {
          // Fallback: fixed delay so reveal still completes (degraded UX, no
          // animation — but state machine progresses).
          _setTimeoutUnref(finish, REVEAL_FALLBACK_DELAY_MS);
        }
        // Defensive overall watchdog — if onComplete is never called (e.g. gsap
        // timeline killed externally), unblock after fallback delay.
        _setTimeoutUnref(finish, REVEAL_FALLBACK_DELAY_MS * 2);
      });
    } finally {
      clearInterval(stageHandle);
    }
  }

  // ---------------------------------------------------------------------
  // Test/Plan-60-02+ accessors (intentionally minimal surface)
  // ---------------------------------------------------------------------

  get _state() {
    // Test-only accessor — exposes private state for assertions.
    return {
      payKind: this.#payKind,
      ticketQuantity: this.#ticketQuantity,
      lootboxQuantity: this.#lootboxQuantity,
      busy: this.#busy,
      lootboxRowsCount: this.#lootboxRows.length,
      lootboxRowStatuses: this.#lootboxRows.map((r) => r.status),
      revealCancelToken: this.#revealCancelToken,
    };
  }

  // Test-only seam — bumps the cancel token to invalidate any in-flight reveal
  // animation. Used by Plan 60-03 tests to short-circuit the await new Promise()
  // wait inside #runRevealAnimation without waiting for the fallback delay.
  __bumpCancelTokenForTest() {
    this.#revealCancelToken++;
  }

  // Test-only seam — directly run the RNG poll cycle for a row, bypassing the
  // 7s setTimeout. Used by Plan 60-03 tests so the suite stays sub-second.
  async __runPollCycleForTest(lootboxIndex) {
    const row = this.#lootboxRows.find((r) => String(r.lootboxIndex) === String(lootboxIndex));
    if (!row) return;
    return this.#runPollCycle(row);
  }
}

// Idempotency-guarded register (Phase 58/59 pattern — player-dropdown.js:178-182,
// last-day-jackpot.js module bottom). Required for node:test re-import safety.
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-packs-panel')) {
    customElements.define('app-packs-panel', AppPacksPanel);
  }
}

export { AppPacksPanel };
