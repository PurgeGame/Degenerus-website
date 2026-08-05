// /app/components/app-activity-panel.js — activity score + streak display (user ask).
//
// Read-only panel. Mirrors app-quest-panel.js: light DOM, idempotent
// customElements.define guard, symmetric connectedCallback / disconnectedCallback,
// #unsubs[] for store subscriptions, panel-owned 30s poll cycle (Phase 61 D-04
// LOCKED — NOT polling.js), and T-58-18 textContent-only rendering (server data
// never flows through innerHTML).
//
// On-chain surface: NONE. Activity score + streaks are event-derived, read from
// /player/:address:
//   scoreBreakdown: { totalBps (whole POINTS, v69: 100 pts = 1.00 score),
//                     mintLevelStreakPoints, questStreakPoints, mintCountPoints,
//                     affiliatePoints, cursePoints,
//                     passBonus: { kind: 'deity'|'whale_100'|'whale_10', points } | null }
//   currentStreak:  the quest streak counter (consecutive quest days).
//   questStreak:    { baseStreak, lastCompletedDay } | null (same source).
//
// The score is a MULTIPLIER on jackpot/degenerette odds (0.00–3.00, effective
// cap 300 points). "Level streak" = mintLevelStreakPoints (the consecutive-level
// mint streak, capped at 50 pts); "Quest streak" = currentStreak (day count).
//
// Class palette: .act-* prefix (non-colliding with the existing app/cf/chain/clm/
// dec/deg/df/jp/last/lbx/ldj/pass/player/qst/view/wallet prefixes).

import { get, subscribe, getViewedAddress } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { questStreakScorePoints } from '../app/activity-score.js';

function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

const POLL_INTERVAL_MS = 30_000;        // Phase 61 D-04 LOCKED.
const VISIBILITY_RESUME_GATE_MS = 1000; // ≥1s since last fetch → re-poll on foreground.
// No gameplay cap on the activity score — the contract's
// ACTIVITY_SCORE_HARD_CAP_POINTS (65_534) is a uint16 safety bound, never
// reached in play — so no "X / cap" meter (it would imply a ceiling there isn't).

// Score-breakdown components, in display order. Each bar fills to its OWN cap
// (full = that component is maxed), independent of the others — NOT a share of
// the total. `cap` = hard ceiling (fill = pts/cap, full at cap). `softCap` = for
// components with no hard max (quest streak): the bar saturates via diminishing
// returns and reads near-full (~95%) once points reach softCap, never locking to
// a flat 100%.
const QUEST_STREAK_SOFT_CAP = 150;  // ~95% fill at 150 pts (deep streak); tune freely.
const CURSE_SOFT_CAP = 60;          // curse is negative + uncapped — same soft treatment.
const DEITY_PASS_MAX = 80;          // deity = top pass → full bar; whale passes fill proportionally.
const COMPONENTS = [
  { key: 'mintLevelStreakPoints', label: 'Level streak', cap: 50 },
  { key: 'questStreakPoints',     label: 'Quest streak', cap: null, softCap: QUEST_STREAK_SOFT_CAP },
  { key: 'mintCountPoints',       label: 'Mint count',   cap: 25 },
  { key: 'affiliatePoints',       label: 'Affiliate',    cap: 50 },
];

// Per-row bar fill %. Hard cap → linear pts/cap (full at cap). Soft cap →
// exponential saturation reaching ~95% at softCap (K = softCap/3), so an uncapped
// streak reads near-full at deep values without ever pinning to 100%.
function activityBarFillPct(pts, cap, softCap) {
  const v = Math.abs(Number(pts) || 0);
  if (cap) return Math.max(0, Math.min(100, (v / cap) * 100));
  if (softCap) return Math.max(0, Math.min(100, 100 * (1 - Math.exp(-v / (softCap / 3)))));
  return 0;
}

const PASS_LABELS = {
  deity: 'Deity pass',
  whale_100: 'Whale pass (100-lvl)',
  whale_10: 'Whale pass (10-lvl)',
};

class AppActivityPanel extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #pollHandle = null;
  #pollController = null;
  #lastFetchAt = 0;
  #visibilityListener = null;
  #score = null;        // scoreBreakdown object or null
  #streak = null;       // { baseStreak, lastCompletedDay } or null
  #currentStreak = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wireVisibilityRePoll();
    this.#wireStoreSubscriptions();
    this.#startPolling();
    this.#runFetch();
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
  // Render shell — STATIC innerHTML; T-58-18 (no server data).
  // ---------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <section class="panel app-activity-panel">
        <header class="act-header">
          <h2>ACTIVITY <span class="act-score-sub" data-bind="act-score-sub"></span></h2>
          <span class="act-score" data-bind="act-score">—</span>
        </header>

        <div class="act-streaks">
          <div class="act-streak-tile act-streak-tile--quest">
            <span class="act-streak-value" data-bind="act-quest-streak">—</span>
            <span class="act-streak-label">🔥 Quest streak</span>
          </div>
          <div class="act-streak-tile act-streak-tile--level">
            <span class="act-streak-value" data-bind="act-level-streak">—</span>
            <span class="act-streak-label">⛰️ Level streak</span>
          </div>
        </div>

        <div class="act-breakdown" data-bind="act-breakdown"></div>
        <div class="act-empty" data-bind="act-empty">Loading…</div>
      </section>
    `;
  }

  // ---------------------------------------------------------------------
  // Poll lifecycle.
  // ---------------------------------------------------------------------

  #startPolling() {
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
    }
    if (typeof setInterval !== 'function') return;
    this.#pollHandle = _setIntervalUnref(() => this.#runFetch(), POLL_INTERVAL_MS);
  }

  async #runFetch() {
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

    // Account-switcher (2026-07-16): activity score + streaks are per-account
    // identity stats (scoreBreakdown/questStreak are intentionally omitted
    // from combine.js's merged payload — not summable). Render the panel's
    // existing empty-state instead of fetching.
    if (get('ui.mode') === 'combined') {
      this.#score = null;
      this.#streak = null;
      this.#currentStreak = null;
      this.#renderEmpty('Per-account stat. Pick a single account.');
      return;
    }

    const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || get('viewing.address')
      || get('connected.address')
      || null;

    if (!addr) {
      this.#score = null;
      this.#streak = null;
      this.#currentStreak = null;
      this.#renderEmpty('Connect a wallet to see your activity score.');
      return;
    }

    try {
      const data = await fetchJSON(`/player/${addr}`);
      if (signal.aborted) return;
      this.#score = data?.scoreBreakdown || null;
      this.#streak = data?.questStreak || null;
      this.#currentStreak = data?.currentStreak ?? this.#streak?.baseStreak ?? null;
      this.#render();
    } catch (_e) {
      this.#renderEmpty('Could not load activity score.');
    }
  }

  #wireVisibilityRePoll() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#visibilityListener = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - this.#lastFetchAt >= VISIBILITY_RESUME_GATE_MS) this.#runFetch();
    };
    document.addEventListener('visibilitychange', this.#visibilityListener);
  }

  #wireStoreSubscriptions() {
    this.#unsubs.push(subscribe('connected.address', () => this.#runFetch()));
    this.#unsubs.push(subscribe('viewing.address', () => this.#runFetch()));
    this.#unsubs.push(subscribe('ui.mode', () => this.#runFetch()));
  }

  // ---------------------------------------------------------------------
  // Render — server-derived numbers via textContent (T-58-18).
  // ---------------------------------------------------------------------

  #num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  #render() {
    const s = this.#score;
    const emptyEl = this.querySelector('[data-bind="act-empty"]');
    if (!s) {
      this.#renderEmpty('No activity score yet — start playing to build one.');
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    const points = this.#num(s.totalBps);
    const score = (points / 100).toFixed(2);

    const scoreEl = this.querySelector('[data-bind="act-score"]');
    if (scoreEl) scoreEl.textContent = `${score}×`;

    const subEl = this.querySelector('[data-bind="act-score-sub"]');
    if (subEl) subEl.textContent = `${points} pts · odds multiplier`;

    // --- Streak tiles (label carries units to stay compact) ---
    const qs = this.#num(this.#currentStreak);
    const questEl = this.querySelector('[data-bind="act-quest-streak"]');
    if (questEl) questEl.textContent = String(qs);

    const lvlPts = this.#num(s.mintLevelStreakPoints);
    const lvlEl = this.querySelector('[data-bind="act-level-streak"]');
    if (lvlEl) lvlEl.textContent = String(lvlPts);
    // Flag the tile as maxed for styling (the breakdown row carries "max 50").
    const lvlTile = lvlEl ? lvlEl.parentElement : null;
    if (lvlTile && lvlTile.classList) lvlTile.classList.toggle('act-streak-tile--maxed', lvlPts >= 50);

    // --- Breakdown rows ---
    this.#renderBreakdown(s);
  }

  #renderBreakdown(s) {
    const host = this.querySelector('[data-bind="act-breakdown"]');
    if (!host) return;
    if (typeof host.replaceChildren === 'function') host.replaceChildren();
    else { host.children = []; host._innerHTML = ''; }

    const rows = [];
    for (const c of COMPONENTS) {
      const pts = c.key === 'questStreakPoints'
        ? questStreakScorePoints(s)
        : this.#num(s[c.key]);
      rows.push({ label: c.label, pts, cap: c.cap, softCap: c.softCap });
    }
    // Pass bonus — labelled by kind. Deity is the top pass (fills to DEITY_PASS_MAX);
    // whale passes carry fewer points and fill proportionally.
    if (s.passBonus && this.#num(s.passBonus.points) !== 0) {
      const kind = s.passBonus.kind;
      rows.push({ label: PASS_LABELS[kind] || 'Pass bonus', pts: this.#num(s.passBonus.points), cap: DEITY_PASS_MAX });
    }
    // Curse — negative, rendered distinctly (uncapped → soft fill).
    const curse = this.#num(s.cursePoints);
    if (curse !== 0) {
      rows.push({ label: 'Cashout curse', pts: curse, softCap: CURSE_SOFT_CAP, negative: true });
    }

    // Each bar fills to its OWN cap (full = that component maxed) — independent rows.
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'act-row';
      if (r.pts === 0) row.classList.add('act-row--zero');
      if (r.negative || r.pts < 0) row.classList.add('act-row--neg');

      const label = document.createElement('span');
      label.className = 'act-row-label';
      label.textContent = r.label;
      row.appendChild(label);

      const barWrap = document.createElement('span');
      barWrap.className = 'act-row-bar';
      const bar = document.createElement('span');
      bar.className = 'act-row-bar__fill';
      if (bar.style) {
        const fill = activityBarFillPct(r.pts, r.cap, r.softCap);
        bar.style.width = `${fill.toFixed(1)}%`;
      }
      barWrap.appendChild(bar);
      row.appendChild(barWrap);

      const val = document.createElement('span');
      val.className = 'act-row-val';
      val.textContent = r.pts > 0 ? `+${r.pts}` : String(r.pts);
      row.appendChild(val);

      host.appendChild(row);
    }
  }

  #renderEmpty(msg) {
    const emptyEl = this.querySelector('[data-bind="act-empty"]');
    const scoreEl = this.querySelector('[data-bind="act-score"]');
    const subEl = this.querySelector('[data-bind="act-score-sub"]');
    const host = this.querySelector('[data-bind="act-breakdown"]');
    if (scoreEl) scoreEl.textContent = '—';
    if (subEl) subEl.textContent = '';
    for (const b of ['act-quest-streak', 'act-level-streak']) {
      const el = this.querySelector(`[data-bind="${b}"]`);
      if (el) el.textContent = '—';
    }
    if (host) {
      if (typeof host.replaceChildren === 'function') host.replaceChildren();
      else { host.children = []; host._innerHTML = ''; }
    }
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = String(msg || 'Loading…');
    }
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-activity-panel')) {
    customElements.define('app-activity-panel', AppActivityPanel);
  }
}

export { AppActivityPanel };
