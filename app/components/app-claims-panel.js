// /app/components/app-claims-panel.js — Phase 61 Plan 61-01 (CLM-01 + CLM-04)
//
// Multi-prize claim tray — UI shell. Plan history:
//   - Plan 61-01: panel shell + spoiler gate (D-06) + render gate (D-01) + zero-state
//                 (CLM-04) + on-mount Promise.allSettled fetch (THIS PLAN)
//   - Plan 61-02: per-prize claim helpers (claimEth/claimBurnie/decimator loop) +
//                 reason-map registrations + per-row pending UX
//   - Plan 61-03: 30s polling lifecycle + visibility-aware refresh + cross-tab
//                 spun_day storage event + post-confirm 250ms debounce
//
// Mount: <app-claims-panel></app-claims-panel> in /app/index.html directly below
//        <app-packs-panel></app-packs-panel> per CONTEXT D-07 (page-grid grows
//        top-down: spin → buy → claim narrative).
//
// Spoiler-gate signal: Phase 59 OWNS the write at /app/components/last-day-jackpot.js:71;
// Phase 61 reads only. Key format: `spun_day_${CHAIN.id}_${pinnedDay}` → '1' when
// the user has watched the spin reveal. SecurityError fail-safe: show CTA, don't spoil.
//
// T-58-18 hardening: ALL server-derived strings via textContent. innerHTML reserved
// for static template literals (containers, headers, anchor scaffolding).
//
// Plan 61-01 shipped the panel shell with stubbed (disabled) Claim buttons.
// Plan 61-02 (THIS PLAN) wires the click handlers through Phase 58's sendTx
// chokepoint and removes the stub attributes — buttons are now interactive.

import { CHAIN } from '../app/chain-config.js';
import { displayEth } from '../app/scaling.js';
import { getViewedAddress, get } from '../app/store.js';
import { fetchJSON } from '../../beta/app/api.js';
// Plan 61-02: claims write path — three named exports wired into per-row click
// handlers below. `import` triggers reason-map registrations as a side-effect
// (DecClaimInactive / DecAlreadyClaimed / DecNotWinner).
import { claimEth, claimBurnie, claimDecimatorLevels } from '../app/claims.js';

// v4.6 render whitelist (D-01 LOCKED). The 4 hidden keys (tickets, vault,
// farFutureCoin, terminal) are read from /pending but NEVER rendered in v4.6;
// each is documented out-of-scope at CONTEXT.md lines 50-54.
const VISIBLE_PRIZE_KEYS = ['eth', 'burnie', 'decimator'];

// Friendly per-prize labels (textContent only). Decimator label is dynamic
// based on row.levels.length — see #renderRows.
const PRIZE_LABELS = {
  eth: 'ETH winnings',
  burnie: 'BURNIE coinflip winnings',
  decimator: 'Decimator jackpot',
};

class AppClaimsPanel extends HTMLElement {
  // --- private fields (Phase 60 idempotency-guard pattern) ---
  #unsubs = [];
  #pendingData = null;     // /player/:address/pending → { eth, burnie, decimator, ... }
  #lastDayData = null;     // /game/jackpot/last-day → { day, status, ... }
  #dashboardData = null;   // /player/:address → { decimator: { claimablePerLevel: [...] } }
  #pinnedDay = null;       // pinned at fetch time, never mutated mid-render
  #pinnedAddress = null;
  #initialized = false;    // idempotency — connectedCallback re-mount safety
  // Plan 61-02 — per-row click debounce (500ms). Tracks which rowKeys have an
  // in-flight claim; prevents double-fire on rapid double-clicks (T-61-02-07).
  #busyRows = new Set();

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    // Plan 61-01: single-shot mount fetch. Polling lifecycle lands in Plan 61-03.
    this.#runMountFetch();
  }

  disconnectedCallback() {
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
  }

  // ---------------------------------------------------------------------
  // Spoiler gate (D-06) — chainId-scoped localStorage read.
  // Phase 59 OWNS the write at last-day-jackpot.js:71; Phase 61 reads only.
  // ---------------------------------------------------------------------

  #spunKey(day) {
    return `spun_day_${CHAIN.id}_${day}`;
  }

  #hasSpunPinnedDay() {
    // Cold-start (no resolved day yet) — no spoiler to gate.
    if (this.#pinnedDay == null) return true;
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(this.#spunKey(this.#pinnedDay)) === '1';
    } catch (_e) {
      // T-61-01-01 SecurityError fail-safe (Pitfall F): show CTA, don't spoil.
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Mount fetch (Plan 61-01 single-shot; Plan 61-03 wraps in 30s poller).
  // Promise.allSettled fan-out per T-61-01-05 — one bad endpoint cannot
  // blank the entire panel.
  // ---------------------------------------------------------------------

  async #runMountFetch() {
    const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || get('viewing.address')
      || get('connected.address')
      || null;
    this.#pinnedAddress = addr;

    // Build URL list — /pending + /player/:address require an address; /last-day
    // is global. fetchJSON prepends API_BASE (== CHAIN.indexerBase).
    const urls = addr
      ? [
          `/player/${addr}/pending`,
          `/game/jackpot/last-day`,
          `/player/${addr}`,
        ]
      : [
          null,
          `/game/jackpot/last-day`,
          null,
        ];

    const results = await Promise.allSettled(
      urls.map((u) => (u ? fetchJSON(u) : Promise.resolve(null))),
    );
    const [pending, lastDay, dashboard] = results.map(
      (r) => (r.status === 'fulfilled' ? r.value : null),
    );

    this.#pendingData = pending?.pending || null;
    this.#lastDayData = lastDay || null;
    this.#dashboardData = dashboard || null;
    this.#pinnedDay = (lastDay && typeof lastDay.day === 'number') ? lastDay.day : null;

    this.#render();
  }

  // ---------------------------------------------------------------------
  // Render shell (one-time scaffold; subsequent renders are mode-conditional).
  // ---------------------------------------------------------------------

  #renderShell() {
    // Static template literal — T-58-18: NO server data flows into innerHTML.
    this.innerHTML = `
      <div class="panel app-claims-panel">
        <div class="panel-header">
          <h2>CLAIMS</h2>
        </div>
        <div class="clm-content" data-bind="clm-content"></div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Render dispatcher — chooses spoiler-gate / zero-state / rows path.
  // ---------------------------------------------------------------------

  #render() {
    const content = this.querySelector('[data-bind="clm-content"]');
    if (!content) return;
    // Clear prior render (textContent='' empties children in fakeDOM + browser).
    content.textContent = '';

    const gateOpen = this.#hasSpunPinnedDay();
    if (!gateOpen) {
      this.#renderSpoilerGate(content);
      return;
    }
    const rows = this.#computeVisibleRows();
    if (rows.length === 0) {
      this.#renderZeroState(content);
      return;
    }
    this.#renderRows(content, rows);
  }

  // ---------------------------------------------------------------------
  // Render: spoiler gate (D-06) — blocking CTA pointing at <last-day-jackpot>.
  // Static template literal — no server data; safe to use innerHTML for scaffold.
  // ---------------------------------------------------------------------

  #renderSpoilerGate(content) {
    // Build via createElement + textContent so server-derived display strings
    // never flow through innerHTML (T-58-18 hardening; the strings here are
    // static literals, but we follow the discipline uniformly).
    const wrap = document.createElement('div');
    wrap.className = 'clm-spoiler-gate';

    const header = document.createElement('p');
    header.className = 'clm-spoiler-gate__header';
    header.textContent = "Spin last day's jackpot first";
    wrap.appendChild(header);

    const cta = document.createElement('a');
    cta.className = 'clm-spoiler-gate__cta';
    cta.setAttribute('href', '#');
    cta.setAttribute('data-bind', 'clm-spoiler-cta');
    cta.textContent = 'Take me to the spin widget →';
    cta.addEventListener('click', (e) => {
      try { e.preventDefault(); } catch (_) { /* defensive */ }
      if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
        const target = document.querySelector('last-day-jackpot');
        if (target && typeof target.scrollIntoView === 'function') {
          try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
          catch (_) { /* defensive */ }
        }
      }
    });
    wrap.appendChild(cta);
    content.appendChild(wrap);
  }

  // ---------------------------------------------------------------------
  // Render: zero-state (CLM-04). Static template — no server data.
  // ---------------------------------------------------------------------

  #renderZeroState(content) {
    // Build via createElement + textContent (T-58-18 discipline applied uniformly
    // even on static copy — keeps the surface area for future XSS issues at zero
    // when a future plan adds dynamic copy).
    const wrap = document.createElement('div');
    wrap.className = 'clm-zero-state';

    const msg = document.createElement('p');
    msg.textContent = 'Nothing to claim right now.';
    wrap.appendChild(msg);

    const link = document.createElement('a');
    link.setAttribute('href', '#how-prizes-work');
    link.textContent = 'How prizes work';
    wrap.appendChild(link);

    content.appendChild(wrap);
  }

  // ---------------------------------------------------------------------
  // Compute visible rows (D-01 render gate).
  //   - Whitelist filter: only eth | burnie | decimator are eligible.
  //   - Amount gate: amount > 0n required.
  //   - Decimator special: ALSO requires non-empty levels list (Pitfall 7
  //     belt-and-suspenders — even if the SUM amount is non-zero, an empty
  //     claimablePerLevel implies nothing actionable).
  // ---------------------------------------------------------------------

  #computeVisibleRows() {
    const p = this.#pendingData || {};
    const rows = [];

    const ethRaw = String(p.eth?.amount || '0');
    let ethBig = 0n;
    try { ethBig = BigInt(ethRaw); } catch (_) { ethBig = 0n; }
    if (ethBig > 0n) {
      rows.push({ key: 'eth', amountWei: ethBig, levels: null });
    }

    const burnieRaw = String(p.burnie?.amount || '0');
    let burnieBig = 0n;
    try { burnieBig = BigInt(burnieRaw); } catch (_) { burnieBig = 0n; }
    if (burnieBig > 0n) {
      rows.push({ key: 'burnie', amountWei: burnieBig, levels: null });
    }

    const decRaw = String(p.decimator?.amount || '0');
    let decBig = 0n;
    try { decBig = BigInt(decRaw); } catch (_) { decBig = 0n; }
    const dashLevels = Array.isArray(this.#dashboardData?.decimator?.claimablePerLevel)
      ? this.#dashboardData.decimator.claimablePerLevel
      : [];
    const decLevels = dashLevels
      .filter((l) => {
        if (!l || l.claimed) return false;
        let n = 0n;
        try { n = BigInt(l.ethAmount || '0'); } catch (_) { n = 0n; }
        return n > 0n;
      })
      .map((l) => Number(l.level))
      .sort((a, b) => a - b);  // ascending — lowest level first per Plan 61-02 hint.
    if (decBig > 0n && decLevels.length > 0) {
      rows.push({ key: 'decimator', amountWei: decBig, levels: decLevels });
    }

    // Forward-compat: VISIBLE_PRIZE_KEYS sentinel — if a future plan extends
    // the whitelist (e.g. Phase 62 affiliate row), the array drives inclusion.
    return rows.filter((r) => VISIBLE_PRIZE_KEYS.includes(r.key));
  }

  // ---------------------------------------------------------------------
  // Render: rows (D-01). Each row uses textContent for ALL server-derived
  // strings (T-58-18 hardening). innerHTML reserved for static container scaffold.
  // ---------------------------------------------------------------------

  #renderRows(content, rows) {
    // Build container via createElement (no innerHTML interpolation needed).
    const rowsContainer = document.createElement('div');
    rowsContainer.className = 'clm-rows';
    rowsContainer.setAttribute('data-bind', 'clm-rows');
    content.appendChild(rowsContainer);

    for (const row of rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'clm-row';
      rowEl.setAttribute('data-prize-key', row.key);

      // Label: textContent (server-influenced for decimator level count).
      const labelEl = document.createElement('span');
      labelEl.className = 'clm-row__label';
      if (row.key === 'decimator') {
        const n = row.levels?.length || 0;
        labelEl.textContent = `Decimator jackpot — ${n} ${n === 1 ? 'level' : 'levels'}`;
      } else {
        labelEl.textContent = PRIZE_LABELS[row.key] || row.key;
      }
      rowEl.appendChild(labelEl);

      // Amount: textContent — formatted via Phase 56 displayEth (BURNIE is also
      // wei-scaled per Phase 56 D-03; displayEth is the right divider for both).
      const amountEl = document.createElement('span');
      amountEl.className = 'clm-row__amount';
      let amountStr = '0';
      try {
        amountStr = displayEth(row.amountWei);
      } catch (_e) {
        // Defensive: bad data → show raw wei as text (still safe via textContent).
        amountStr = String(row.amountWei);
      }
      amountEl.textContent = amountStr;
      rowEl.appendChild(amountEl);

      // Claim CTA — Plan 61-02 wires the click handler. The Plan 61-01 stub
      // attributes (`disabled`, stub-marker) are REMOVED. The `data-write`
      // attribute REMAINS — Phase 58's view-mode disable manager auto-disables
      // when ui.mode === 'view' (defense in depth).
      const btn = document.createElement('button');
      btn.className = 'clm-row__claim-cta';
      btn.setAttribute('data-write', '');
      if (row.key === 'decimator') {
        const n = row.levels?.length || 0;
        btn.textContent = `Claim ${n} ${n === 1 ? 'level' : 'levels'}`;
      } else {
        btn.textContent = 'Claim';
      }
      rowEl.appendChild(btn);

      // Plan 61-02 — wire per-row click handler (state machine: idle →
      // claiming → error or success). Captured row reference is per-iteration
      // and survives async closure (no shared mutable closure capture).
      this.#wireRowHandler(rowEl, btn, row);

      rowsContainer.appendChild(rowEl);
    }
  }

  // ---------------------------------------------------------------------
  // Plan 61-02 — Per-row click handler.
  //
  // State machine:
  //   idle → (click) → claiming (.clm-row--claiming + 'Claiming…' label)
  //                  → success → dispatch app-claims:tx-confirmed → idle
  //                              (Plan 61-03 listens and re-fetches; Plan 61-02
  //                              clears all sibling .clm-row--error states)
  //                  → error → .clm-row--error + .clm-row__error textContent
  //                            → 10s auto-clear timer OR cleared on next-success
  //
  // Idempotency: 500ms debounce via #busyRows Set (T-61-02-07).
  // D-05 LOCKED + Pitfall 6 #3: NEVER optimistic balance subtraction —
  // the row's amount stays at the pre-click value during pending; the next
  // poll cycle (Plan 61-03) refreshes it.
  // T-58-18: error.userMessage rendered via textContent only.
  // ---------------------------------------------------------------------

  #wireRowHandler(rowEl, btn, row) {
    btn.addEventListener('click', async (ev) => {
      try { ev?.preventDefault?.(); } catch (_) { /* defensive */ }
      // 500ms debounce gate (T-61-02-07).
      if (this.#busyRows.has(row.key)) return;
      this.#busyRows.add(row.key);

      // Snapshot UI for restore in finally.
      const originalLabel = btn.textContent;

      rowEl.classList.add('clm-row--claiming');
      // Defensive: drop any prior error styling before a fresh attempt.
      rowEl.classList.remove('clm-row--error');
      const priorErr = rowEl.querySelector?.('.clm-row__error');
      if (priorErr) priorErr.remove();
      btn.disabled = true;
      btn.textContent = 'Claiming…';

      try {
        const player = get('connected.address');
        if (row.key === 'eth') {
          await claimEth({ player });
        } else if (row.key === 'burnie') {
          // Pitfall 6: amount sourced from /pending's burnie.amount field
          // (NOT the /beta address-cast trick).
          const amount = BigInt(this.#pendingData?.burnie?.amount || '0');
          await claimBurnie({ player, amount });
        } else if (row.key === 'decimator') {
          // Panel pre-sorts ascending — keeps claims.js a pure executor.
          const levels = Array.isArray(row.levels)
            ? [...row.levels].sort((a, b) => a - b)
            : [];
          await claimDecimatorLevels({
            player,
            levels,
            onProgress: (p) => this.#renderDecimatorProgress(rowEl, p),
          });
        }

        // Success — dispatch panel-internal event so Plan 61-03 can subscribe
        // and run the 250ms post-confirm debounce + re-fetch. Plan 61-02 only
        // dispatches; the row stays at its pre-click amount until refetch.
        try {
          this.dispatchEvent(new CustomEvent('app-claims:tx-confirmed', {
            detail: { rowKey: row.key },
            bubbles: true,
          }));
        } catch (_e) { /* defensive — fakeDOM CustomEvent shim */ }

        // Clear all error states across the panel on next-success-anywhere.
        this.#clearAllErrorStates();
      } catch (error) {
        // Decoded structured-revert error from claims.js (.userMessage / .code
        // / .recoveryAction / .cause). Render via textContent (T-58-18).
        rowEl.classList.add('clm-row--error');
        rowEl.classList.remove('clm-row--claiming');
        let errEl = rowEl.querySelector?.('.clm-row__error');
        if (!errEl) {
          errEl = document.createElement('div');
          errEl.className = 'clm-row__error';
          rowEl.appendChild(errEl);
        }
        errEl.textContent = error?.userMessage || error?.message || 'Claim failed.';
        // 10s auto-clear timer.
        setTimeout(() => {
          rowEl.classList.remove('clm-row--error');
          const stillErr = rowEl.querySelector?.('.clm-row__error');
          if (stillErr) stillErr.remove();
        }, 10000);
      } finally {
        rowEl.classList.remove('clm-row--claiming');
        btn.disabled = false;
        btn.textContent = originalLabel;
        // Release debounce after 500ms (idempotency window).
        setTimeout(() => this.#busyRows.delete(row.key), 500);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Plan 61-02 — Decimator progress UX. Updates a `.clm-progress` text
  // element under the row's button. Server-derived numbers via textContent
  // (T-58-18). Phase 60 wording mirror.
  // ---------------------------------------------------------------------

  #renderDecimatorProgress(rowEl, p) {
    let prog = rowEl.querySelector?.('.clm-progress');
    if (!prog) {
      prog = document.createElement('div');
      prog.className = 'clm-progress';
      rowEl.appendChild(prog);
    }
    const status = p?.status === 'pending' ? 'pending' : 'confirmed';
    prog.textContent = `${p?.done ?? 0}/${p?.total ?? 0} ${status}…`;
  }

  // ---------------------------------------------------------------------
  // Plan 61-02 — Cross-row error clearing (next-success-anywhere). Walks
  // the panel's render root and removes `.clm-row--error` states + their
  // `.clm-row__error` children.
  // ---------------------------------------------------------------------

  #clearAllErrorStates() {
    const errorRows = this.querySelectorAll?.('.clm-row--error') || [];
    for (const r of errorRows) {
      r.classList.remove('clm-row--error');
      const err = r.querySelector?.('.clm-row__error');
      if (err) err.remove();
    }
  }
}

// Idempotency-guarded register (Phase 58/59/60 pattern — verbatim port of
// app-packs-panel.js:965-967). Required for node:test re-import safety AND
// for production hot-module-replacement / accidental double-mount scenarios.
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-claims-panel')) {
    customElements.define('app-claims-panel', AppClaimsPanel);
  }
}

export { AppClaimsPanel };
