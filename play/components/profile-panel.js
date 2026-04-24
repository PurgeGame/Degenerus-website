// play/components/profile-panel.js -- <profile-panel> Custom Element (Phase 51 Wave 1)
//
// Four-section hydrated markup + popover a11y wiring + render helpers.
// Fetch wiring is Wave 2 (hard-gated on INTEG-02 backend delivery).
//
// Sections (top to bottom, per CONTEXT.md D-02):
//   1. Activity Score (number + info-icon popover with decomposition)
//   2. Quest Streak banner (baseStreak + lastCompletedDay)
//   3. Quest Slots (two slots with progress bar + target; no high-difficulty
//      styling per D-20 -- the flag is a schema-only vestige)
//   4. Daily Activity (four counts: lootboxes purchased/opened, tickets
//      purchased, ticket wins)
//
// SECURITY (T-51-01): the innerHTML template is a static string with no
// user interpolation. All dynamic writes go through textContent or
// element.style (never .innerHTML with response data). Matches the
// Phase 50 scaffold's T-50-01 hardening.
//
// SHELL-01: imports only from the wallet-free surface -- beta/app/store.js
// (verified) and play/app/quests.js (local, wallet-free per Task 1).
//
// Wave 2 will add: a private fetch-id stale-guard counter, a refetch()
// method hitting the extended player endpoint with a day query param,
// the is-stale class toggle for keep-old-data-dim, and will replace the
// subscribe() console.log callbacks with refetch() calls.

import { subscribe } from '../../beta/app/store.js';
import { formatQuestTarget, getQuestProgress, QUEST_TYPE_LABELS } from '../app/quests.js';

// Placeholder. Wave 2 replaces these with fetch + render from INTEG-02.
// Wave 1 keeps the Phase 50 console.log behavior so PROFILE-04's subscribe
// assertions stay green via the existing stubs.
// Note: CSS class .is-stale is defined in play/styles/play.css and will be
// applied to [data-bind="content"] by Wave 2's #refetch() during
// keep-old-data-dim (D-17). Wave 1 does not toggle it.

const TEMPLATE = `
<section data-slot="profile" class="panel profile-panel">

  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:60%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:120px"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:80px"></div></div>
  </div>

  <div data-bind="content" hidden>

    <!-- SECTION 1: Activity Score (PROFILE-01) -->
    <div class="profile-section profile-score">
      <h3 class="profile-section-title">Activity Score</h3>
      <div class="score-row">
        <span class="score-value tier-default" data-bind="score">--</span>
        <button
          type="button"
          class="score-info-btn"
          aria-label="Show score decomposition"
          aria-expanded="false"
          aria-controls="score-popover"
          data-bind="info-btn"
        >i</button>
        <div
          id="score-popover"
          class="score-popover"
          role="dialog"
          aria-label="Activity score decomposition"
          hidden
          data-bind="popover"
        >
          <div class="popover-row">
            <span class="popover-label">Quest floor</span>
            <span class="popover-value" data-bind="row-quest">--</span>
          </div>
          <div class="popover-row">
            <span class="popover-label">Mint floor</span>
            <span class="popover-value" data-bind="row-mint">--</span>
          </div>
          <div class="popover-row">
            <span class="popover-label">Affiliate</span>
            <span class="popover-value" data-bind="row-affiliate">--</span>
          </div>
          <div class="popover-row" data-bind="row-pass-container" hidden>
            <span class="popover-label" data-bind="row-pass-label">Pass</span>
            <span class="popover-value" data-bind="row-pass-value">--</span>
          </div>
        </div>
      </div>
    </div>

    <!-- SECTION 2: Quest Streak banner (PROFILE-03) -->
    <div class="profile-section streak-banner">
      <span class="streak-label">Quest streak:</span>
      <span class="streak-value" data-bind="base-streak">--</span>
      <span class="streak-separator"> day(s), last completed </span>
      <span class="streak-last-day" data-bind="last-completed-day">--</span>
    </div>

    <!-- SECTION 3: Quest Slots (PROFILE-02; no high-difficulty styling per D-20) -->
    <div class="profile-section quest-slots">
      <h3 class="profile-section-title">Today's Quests</h3>
      <div class="quest-slot quest-slot-primary" data-slot-idx="0">
        <div class="quest-label">
          <span class="quest-type">--</span>
        </div>
        <div class="quest-progress-bar">
          <div class="quest-progress-fill" style="width:0%"></div>
        </div>
        <span class="quest-target">--</span>
      </div>
      <div class="quest-slot quest-slot-secondary" data-slot-idx="1">
        <div class="quest-label">
          <span class="quest-type">--</span>
        </div>
        <div class="quest-progress-bar">
          <div class="quest-progress-fill" style="width:0%"></div>
        </div>
        <span class="quest-target">--</span>
      </div>
    </div>

    <!-- SECTION 4: Daily Activity (PROFILE-05; D-11, D-12) -->
    <div class="profile-section daily-activity">
      <h3 class="profile-section-title">Daily Activity</h3>
      <div class="daily-activity-grid">
        <div class="activity-cell">
          <span class="activity-count" data-bind="lootboxes-purchased">...</span>
          <span class="activity-label">Lootboxes purchased</span>
        </div>
        <div class="activity-cell">
          <span class="activity-count" data-bind="lootboxes-opened">...</span>
          <span class="activity-label">Lootboxes opened</span>
        </div>
        <div class="activity-cell">
          <span class="activity-count" data-bind="tickets-purchased">...</span>
          <span class="activity-label">Tickets purchased</span>
        </div>
        <div class="activity-cell">
          <span class="activity-count" data-bind="ticket-wins">...</span>
          <span class="activity-label">Ticket wins</span>
        </div>
      </div>
    </div>

  </div>

</section>
`;

class ProfilePanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #popoverAbort = null;

  connectedCallback() {
    this.innerHTML = TEMPLATE;
    this.#bindPopover();

    // PROFILE-04 wiring Wave-1: preserve Phase 50 console.log stubs so the
    // subscribe assertions stay green. Wave 2 replaces these callback bodies
    // with #refetch() invocations once INTEG-02 backend is delivered.
    this.#unsubs.push(
      subscribe('replay.day', (day) => {
        console.log('[profile-panel] replay.day =', day);
      }),
      subscribe('replay.player', (addr) => {
        console.log('[profile-panel] replay.player =', addr);
      }),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
    if (this.#popoverAbort) {
      this.#popoverAbort.abort();
      this.#popoverAbort = null;
    }
  }

  // -- Render helpers (defined now so Wave 2 only needs to call them) --

  #bind(key, value) {
    const el = this.querySelector(`[data-bind="${key}"]`);
    if (el) el.textContent = value;
  }

  #showContent() {
    if (this.#loaded) return;
    this.#loaded = true;
    this.querySelector('[data-bind="skeleton"]')?.remove();
    const el = this.querySelector('[data-bind="content"]');
    if (el) el.hidden = false;
  }

  #scoreTier(totalBps) {
    // D-04 tier thresholds: decimal = totalBps / 10000
    //   < 0.60 -> tier-dim (below lootbox breakeven)
    //   0.60..2.55 -> tier-default
    //   > 2.55 -> tier-accent (above lootbox EV cap)
    if (totalBps == null) return 'tier-default';
    if (totalBps < 6000) return 'tier-dim';
    if (totalBps > 25500) return 'tier-accent';
    return 'tier-default';
  }

  #renderScore(scoreBreakdown) {
    if (!scoreBreakdown || scoreBreakdown.totalBps == null) {
      this.#bind('score', '--');
      this.#bind('row-quest', '--');
      this.#bind('row-mint', '--');
      this.#bind('row-affiliate', '--');
      const passRow = this.querySelector('[data-bind="row-pass-container"]');
      if (passRow) passRow.hidden = true;
      return;
    }
    const scoreDecimal = (scoreBreakdown.totalBps / 10000).toFixed(2);
    const scoreEl = this.querySelector('[data-bind="score"]');
    if (scoreEl) {
      scoreEl.textContent = scoreDecimal;
      scoreEl.classList.remove('tier-dim', 'tier-default', 'tier-accent');
      scoreEl.classList.add(this.#scoreTier(scoreBreakdown.totalBps));
    }
    // Points-to-decimal: each row's points / 100 = decimal display.
    const qp = scoreBreakdown.questStreakPoints;
    const mp = scoreBreakdown.mintCountPoints;
    const ap = scoreBreakdown.affiliatePoints;
    this.#bind('row-quest', qp == null ? '--' : (qp / 100).toFixed(2));
    this.#bind('row-mint', mp == null ? '--' : (mp / 100).toFixed(2));
    this.#bind('row-affiliate', ap == null ? '--' : (ap / 100).toFixed(2));

    const passRow = this.querySelector('[data-bind="row-pass-container"]');
    const pass = scoreBreakdown.passBonus;
    if (!passRow) return;
    if (!pass) {
      passRow.hidden = true;
      return;
    }
    passRow.hidden = false;
    const label = pass.kind === 'deity' ? 'Deity'
      : pass.kind === 'whale_100' ? 'Whale'
      : pass.kind === 'whale_10' ? 'Lazy / Whale'
      : 'Pass';
    this.#bind('row-pass-label', label);
    this.#bind('row-pass-value', '+' + (pass.points / 100).toFixed(2));
  }

  #renderStreak(questStreak) {
    if (!questStreak) {
      this.#bind('base-streak', '--');
      this.#bind('last-completed-day', '--');
      return;
    }
    this.#bind('base-streak', String(questStreak.baseStreak ?? '--'));
    this.#bind(
      'last-completed-day',
      questStreak.lastCompletedDay != null
        ? 'day ' + questStreak.lastCompletedDay
        : '--',
    );
  }

  #renderQuestSlots(quests) {
    const slots = this.querySelectorAll('.quest-slot');
    for (let i = 0; i < 2; i++) {
      const slotEl = slots[i];
      if (!slotEl) continue;
      const row = Array.isArray(quests) ? quests.find((q) => q.slot === i) : null;
      const info = getQuestProgress(row);
      const typeEl = slotEl.querySelector('.quest-type');
      const fillEl = slotEl.querySelector('.quest-progress-fill');
      const targetEl = slotEl.querySelector('.quest-target');
      if (!info) {
        if (typeEl) typeEl.textContent = '--';
        if (fillEl) fillEl.style.width = '0%';
        if (targetEl) targetEl.textContent = '--';
        slotEl.classList.remove('completed');
        continue;
      }
      if (typeEl) typeEl.textContent = (i === 0 ? 'Primary: ' : '') + info.type;
      if (fillEl) fillEl.style.width = Math.round(info.progress) + '%';
      if (targetEl) targetEl.textContent = info.completed ? 'Complete' : info.target;
      if (info.completed) slotEl.classList.add('completed');
      else slotEl.classList.remove('completed');
    }
  }

  #renderDailyActivity(dailyActivity) {
    const da = dailyActivity || {};
    this.#bind('lootboxes-purchased', da.lootboxesPurchased == null ? '...' : String(da.lootboxesPurchased));
    this.#bind('lootboxes-opened', da.lootboxesOpened == null ? '...' : String(da.lootboxesOpened));
    this.#bind('tickets-purchased', da.ticketsPurchased == null ? '...' : String(da.ticketsPurchased));
    this.#bind('ticket-wins', da.ticketWins == null ? '...' : String(da.ticketWins));
  }

  // Defined for Wave 2 to call after a successful fetch.
  // Wave 1 never invokes this -- the skeleton stays visible until Wave 2 lands.
  #renderAll(data) {
    this.#renderScore(data?.scoreBreakdown);
    this.#renderStreak(data?.questStreak);
    this.#renderQuestSlots(data?.quests);
    this.#renderDailyActivity(data?.dailyActivity);
  }

  // Defined for Wave 2 to call on 404/500. Wave 1 does not invoke.
  #renderError(status) {
    this.#bind('score', '--');
    this.#bind('base-streak', '--');
    this.#bind('last-completed-day', '--');
    const slots = this.querySelectorAll('.quest-slot');
    for (const slotEl of slots) {
      slotEl.querySelector('.quest-type').textContent = status === 404
        ? 'No data for day'
        : 'Error';
    }
  }

  // Popover accessibility (D-05): tap on mobile AND hover on desktop both
  // open the popover. ESC + outside-click close. Uses AbortController so
  // disconnectedCallback can drop all listeners cleanly.
  #bindPopover() {
    const btn = this.querySelector('[data-bind="info-btn"]');
    const pop = this.querySelector('[data-bind="popover"]');
    if (!btn || !pop) return;
    this.#popoverAbort = new AbortController();
    const { signal } = this.#popoverAbort;

    const open = () => {
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    };
    const close = () => {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    const toggle = () => (pop.hidden ? open() : close());

    // Tap / click (mobile + desktop click)
    btn.addEventListener('click', toggle, { signal });

    // Hover for mouse only; pointerType filters out touch pointers which
    // already fire click via browser default.
    btn.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') open();
    }, { signal });
    btn.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') close();
    }, { signal });

    // Keyboard: focus opens (so Tab-to-button reveals); ESC closes and
    // returns focus to the button.
    btn.addEventListener('focus', () => open(), { signal });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    }, { signal });
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); btn.focus(); }
    }, { signal });

    // Outside-click dismiss (D-05 mobile tap-outside).
    document.addEventListener('click', (e) => {
      if (pop.hidden) return;
      if (!this.contains(e.target)) close();
    }, { signal });
  }
}

customElements.define('profile-panel', ProfilePanel);
