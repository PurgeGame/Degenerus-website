// /app/components/app-quest-panel.js — Phase 62 Plan 62-04 (QST-01 + QST-02)
//
// Read-only quest display panel. Custom Element shell mirrors Phase 60's
// app-packs-panel.js + Phase 61's app-claims-panel.js + Phase 62-01's
// app-decimator-panel.js + Phase 62-03's app-coinflip-panel.js: light DOM,
// idempotent customElements.define guard, symmetric connectedCallback /
// disconnectedCallback, #unsubs[] for store subscriptions, panel-owned 30s
// poll cycle (Phase 61 D-04 LOCKED — NOT polling.js).
//
// On-chain surface: NONE. RESEARCH R4 (HIGH confidence): there is NO
// user-facing startQuest / claimQuest / selectQuestSlot / pickQuest external
// function on DegenerusQuests. ALL quest progression is automatic via internal
// onlyGame hooks (handleMint / handleFlip / handleDecimator / handleAffiliate /
// handleLootBox / handleDegenerette / handlePurchase per IDegenerusQuests.sol:
// 46-183). Quest rewards flow into BURNIE coinflip claimable, already covered
// by Phase 61's CLM tray BURNIE row.
//
// Plan 62-04 reads from /player/:address (Phase 57 player.ts:259-281) — fields:
//   quests:        Array<{ slot, questType, progress, target, completed, ... }>
//   questStreak:   { baseStreak, lastCompletedDay } | null
//   scoreBreakdown: { questStreakPoints, ... }
//
// Plan 62-04 ships ZERO write surfaces:
//   - NO sendTx, NO requireStaticCall, NO register() (T-62-04-NoWrite).
//   - NO data-write attributes (read-only — Phase 58 disable manager unused).
//   - NO new reason-map entries.
//
// Carry-forwards (CONTEXT 62-CONTEXT.md):
//   CF-04: Phase 56 D-04 / Phase 61 D-04 — panel-owned 30s poll cycle with
//          AbortController-per-cycle + visibility-aware foreground re-poll.
//   CF-07: T-58-18 — server-derived strings (questName / progress / target /
//          streak / completion flags) rendered via .textContent NOT innerHTML.
//   CF-08: roadmap success-criterion 1 verbatim — NO toast / NO audio / NO
//          animator on quest completion. Inline state change only.
//
// Class palette: .qst-* prefix (RESEARCH R10 verified non-colliding against
// existing 14 prefixes: app/cf/chain/clm/dec/deg/jp/last/lbx/ldj/pass/player/
// view/wallet).
//
// Reward cross-link (visual only — no JS coupling): static template literal
// references "BURNIE" + "Claims tray" — user understands quest rewards arrive
// in their BURNIE balance and can be claimed from Phase 61's <app-claims-panel>.

import { get, subscribe, getViewedAddress } from '../app/store.js';
import { fetchJSON } from '../../beta/app/api.js';

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
const VISIBILITY_RESUME_GATE_MS = 1000; // ≥1s elapsed since last fetch → re-poll on foreground.

// Quest type → human-readable label. Mirrors /beta/app/constants.js
// QUEST_TYPE_LABELS (read-only reference — DO NOT cross-import; constants.js
// has known signature drift per Phase 61 / Pitfall 4). Inline keeps the panel
// self-contained.
const QUEST_TYPE_LABELS = {
  0: 'Mint with BURNIE',
  1: 'Mint with ETH',
  2: 'Coinflip',
  3: 'Affiliate',
  5: 'Decimator',
  6: 'Lootbox',
  7: 'Degenerette (ETH)',
  8: 'Degenerette (BURNIE)',
};

class AppQuestPanel extends HTMLElement {
  // --- Phase 60 / 61 / 62-01 / 62-03 idempotency-guard pattern ---
  #unsubs = [];
  #initialized = false;
  // --- Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED) ---
  #pollHandle = null;
  #pollController = null;
  #lastFetchAt = 0;
  #visibilityListener = null;
  // --- Pinned data from /player/:address (server-derived) ---
  #questData = null;
  #questStreak = null;
  #pinnedAddress = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wireVisibilityRePoll();
    this.#wireStoreSubscriptions();
    this.#startPolling();
    // Eager first cycle on mount.
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
      <section class="panel app-quest-panel">
        <header class="qst-header">
          <h2>QUESTS</h2>
          <span class="qst-streak" data-bind="qst-streak">Streak: —</span>
        </header>
        <p class="qst-blurb">
          Daily quests progress automatically as you play. Complete the primary
          quest first for streak credit.
        </p>
        <div class="qst-slots" data-bind="qst-slots"></div>
        <p class="qst-reward-hint">
          Quest rewards arrive in your BURNIE balance — collect them from the
          <a href="#claims" class="qst-reward-link">Claims tray</a>.
        </p>
        <div class="qst-empty" data-bind="qst-empty">Loading quests…</div>
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
      this.#questData = null;
      this.#questStreak = null;
      this.#renderEmpty('Connect a wallet to see your quests.');
      return;
    }

    try {
      const data = await fetchJSON(`/player/${addr}`);
      if (signal.aborted) return;
      this.#questData = Array.isArray(data?.quests) ? data.quests : null;
      this.#questStreak = data?.questStreak || null;
      this.#renderQuests();
    } catch (_e) {
      // Network blip — render empty/error message; next cycle retries.
      this.#renderEmpty('Could not load quests.');
    }
  }

  // Visibility-aware refresh — on foreground return AFTER ≥1s elapsed since
  // last fetch, fire an immediate cycle. Mirrors Phase 56 D-04 + Phase 61 D-04
  // (1s gate per Plan 62-04 D-A — quest data is light, more frequent foreground
  // re-polls are fine).
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

  // Store subscriptions — Phase 58 namespace. On wallet switch (connected.address)
  // OR view-target switch (viewing.address), fire an immediate cycle restart.
  #wireStoreSubscriptions() {
    const u1 = subscribe('connected.address', () => this.#runMountFetch());
    const u2 = subscribe('viewing.address', () => this.#runMountFetch());
    this.#unsubs.push(u1, u2);
  }

  // ---------------------------------------------------------------------
  // Render quests — server-derived strings via textContent (T-58-18).
  // CF-08: NO toast / NO audio / NO animator on completion. Inline-only.
  // ---------------------------------------------------------------------

  #renderQuests() {
    const slotsEl = this.querySelector('[data-bind="qst-slots"]');
    const streakEl = this.querySelector('[data-bind="qst-streak"]');
    const emptyEl = this.querySelector('[data-bind="qst-empty"]');
    if (!slotsEl || !streakEl || !emptyEl) return;

    // Clear prior nodes — replaceChildren is safer than innerHTML reassignment
    // (preserves parent container; doesn't trigger HTML parsing).
    if (typeof slotsEl.replaceChildren === 'function') {
      slotsEl.replaceChildren();
    } else {
      // fakeDOM portability fallback.
      slotsEl.children = [];
      slotsEl._innerHTML = '';
    }

    const slots = Array.isArray(this.#questData) ? this.#questData : [];

    if (slots.length === 0) {
      emptyEl.hidden = false;
      emptyEl.textContent = 'No quests today.';
    } else {
      emptyEl.hidden = true;
    }

    // Render each slot — sorted by slot index ascending (slot 0 primary, slot 1
    // secondary; matches /beta/components/quest-panel.js convention).
    const sorted = [...slots].sort((a, b) => Number(a?.slot ?? 0) - Number(b?.slot ?? 0));

    for (const s of sorted) {
      const slotDiv = document.createElement('div');
      slotDiv.className = 'qst-slot';
      const slotIndex = Number(s?.slot ?? 0);
      if (slotIndex === 0) slotDiv.classList.add('qst-slot--primary');
      if (slotIndex === 1) slotDiv.classList.add('qst-slot--secondary');
      if (s?.completed) slotDiv.classList.add('qst-slot--completed');

      // Quest name — derived from questType label (textContent only).
      const nameEl = document.createElement('div');
      nameEl.className = 'qst-slot-name';
      const questTypeRaw = Number(s?.questType ?? -1);
      const label = QUEST_TYPE_LABELS[questTypeRaw];
      const namePrefix = slotIndex === 0 ? 'Primary: ' : '';
      nameEl.textContent = `${namePrefix}${label || 'Unknown'}`;
      slotDiv.appendChild(nameEl);

      // Progress display — "X / Y" via textContent.
      const progEl = document.createElement('div');
      progEl.className = 'qst-slot-progress';
      const progress = s?.progress ?? 0;
      const target = s?.target ?? 0;
      progEl.textContent = `${String(progress)} / ${String(target)}`;
      slotDiv.appendChild(progEl);

      // Completion indicator — textContent flag, no toast/audio (CF-08).
      if (s?.completed) {
        const doneEl = document.createElement('div');
        doneEl.className = 'qst-slot-done';
        doneEl.textContent = 'Complete';
        slotDiv.appendChild(doneEl);
      }

      slotsEl.appendChild(slotDiv);
    }

    // Streak — textContent only.
    const streakValue = this.#questStreak?.baseStreak ?? 0;
    streakEl.textContent = `Streak: ${String(streakValue)}`;
  }

  #renderEmpty(msg) {
    const slotsEl = this.querySelector('[data-bind="qst-slots"]');
    const streakEl = this.querySelector('[data-bind="qst-streak"]');
    const emptyEl = this.querySelector('[data-bind="qst-empty"]');
    if (slotsEl) {
      if (typeof slotsEl.replaceChildren === 'function') {
        slotsEl.replaceChildren();
      } else {
        slotsEl.children = [];
        slotsEl._innerHTML = '';
      }
    }
    if (streakEl) streakEl.textContent = 'Streak: —';
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = String(msg || 'Loading quests…');
    }
  }
}

// Idempotency-guarded registration (Phase 58/59/60/61/62 pattern). Required
// for node:test re-import safety AND production hot-module-replacement.
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-quest-panel')) {
    customElements.define('app-quest-panel', AppQuestPanel);
  }
}

export { AppQuestPanel };
