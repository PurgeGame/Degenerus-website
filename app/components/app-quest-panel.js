// /app/components/app-quest-panel.js — Phase 62 Plan 62-04 (QST-01 + QST-02)
//
// Read-only quest display panel. Custom Element shell mirrors Phase 60's
// app-packs-panel.js + Phase 61's app-claims-panel.js + Phase 62-01's
// app-decimator-panel.js + Phase 62-03's app-coinflip-panel.js: light DOM,
// idempotent customElements.define guard, symmetric connectedCallback /
// disconnectedCallback, #unsubs[] for store subscriptions, panel-owned 30s
// poll cycle (Phase 61 D-04 LOCKED — NOT polling.js).
//
// On-chain surface: NONE. There is no user-facing start/claim/select quest
// transaction; every quest progresses through game actions. This panel reads
// only the database API. The optional `levelQuest` player field is deliberately
// not filled by an in-browser RPC fallback: if the indexer has not projected
// live level-quest state yet, the card stays absent instead of adding a second
// source of truth.
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
// Reward callout (visual only — no JS coupling): the visible label stays terse;
// its title/aria-label retains the complete next-flip win/burn condition.

import { get, update, subscribe, getViewedAddress } from '../app/store.js';
import { fetchJSON } from '../../beta/app/api.js';
import { displayEth, displayToken } from '../app/scaling.js';
import { scaledTicketPriceWei } from '../app/lootbox.js';
import './boon-product-indicator.js';

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

// /player/:address returns the FULL quest history (one row per slot per day).
// The daily panel only shows the current day's slots, so format + day-filter
// live here. Token-amount quests (coinflip / degenerette) carry 18-dec wei
// targets; mint-count quests carry small integers — 16+ digits = wei.
function _fmtQuestAmount(v) {
  const str = String(v ?? '0');
  if (/^\d{16,}$/.test(str)) {
    try { return (BigInt(str) / (10n ** 18n)).toLocaleString('en-US'); }
    catch (_e) { return str; }
  }
  const n = Number(str);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : str;
}

function _positiveTarget(value) {
  try {
    const target = BigInt(value ?? 0);
    return target > 0n ? target : null;
  } catch (_e) {
    return null;
  }
}

function _dailyQuestTarget(questType, slot, level, projectedTarget) {
  const indexed = _positiveTarget(projectedTarget);
  if (indexed != null) return indexed.toString();
  const type = Number(questType);
  if (type === 4 || type === 9) return '1';
  if ([2, 3, 5, 8].includes(type)) return String(2_000n * 10n ** 18n);
  if ([1, 6, 7].includes(type) && Number.isFinite(level) && level >= 0) {
    const price = scaledTicketPriceWei(level);
    const mult = type === 1 && Number(slot) === 0 ? 1n : 2n;
    return String(price * mult);
  }
  return '0';
}

function _fmtDailyQuestAmount(questType, raw) {
  let amount;
  try { amount = BigInt(raw ?? 0); } catch (_e) { return _fmtQuestAmount(raw); }
  const type = Number(questType);
  // Tiny values are retained for legacy/indexer fixtures that stored simple
  // count targets before native-unit requirements were projected.
  if ([1, 6, 7].includes(type)) {
    if (amount < 1_000_000n) return amount.toLocaleString('en-US');
    return `${_trimGrouped(displayEth(amount, 4))} ETH`;
  }
  if ([2, 3, 5, 8].includes(type)) {
    if (amount < 1_000_000n) return amount.toLocaleString('en-US');
    return `${_trimGrouped(displayToken(amount, 2))} FLIP`;
  }
  if (type === 4) return `${amount.toLocaleString('en-US')} ${amount === 1n ? 'pack' : 'packs'}`;
  if (type === 9) return `${amount.toLocaleString('en-US')} ${amount === 1n ? 'ticket' : 'tickets'}`;
  return amount.toLocaleString('en-US');
}

// Quest type → human-readable label. Mirrors /beta/app/constants.js
// QUEST_TYPE_LABELS (read-only reference — DO NOT cross-import; constants.js
// has known signature drift per Phase 61 / Pitfall 4). Inline keeps the panel
// self-contained.
// Verified against degenerus-audit/contracts/DegenerusQuests.sol:196-223.
// The previous map put the FLIP-redemption label on type 0 — there is no quest
// type 0, and MINT_FLIP is 9. Types 4 (FOIL) and 9 were missing entirely, so a foil-pack
// day or a redeem-window day rendered "Unknown" as its bonus quest.
const QUEST_TYPE_LABELS = {
  1: 'Buy a ticket or lootbox',
  2: 'Coinflip',
  3: 'Affiliate',
  4: 'Foil pack',
  5: 'Decimator',
  6: 'Lootbox',
  7: 'Degenerette (ETH)',
  8: 'Degenerette (FLIP)',
  9: 'Redeem FLIP',
};

// Compact, font-native marks keep the quest board game-like without adding an
// image request per slot. Values are static and only selected by questType.
const QUEST_TYPE_ICONS = {
  1: 'Ξ',
  2: '◐',
  3: '↗',
  4: '✦',
  5: '10×',
  6: '◆',
  7: 'D',
  8: 'D',
  9: 'F',
};

// Every setup-oriented quest has a matching form listener. Affiliate rewards
// are earned by other players' purchases, so there is no honest amount field
// to prefill for type 3 and its card remains informational.
const QUEST_SETUP_TYPES = new Set([1, 2, 4, 5, 6, 7, 8, 9]);

const SCORE_COMPONENTS = [
  // Despite its legacy name, questStreakPoints is the raw streak count. The
  // score contribution is floor(count / 2); #renderScoreBreakdown normalizes it.
  { key: 'questStreakPoints', label: 'Quest streak' },
  { key: 'mintLevelStreakPoints', label: 'Level streak' },
  { key: 'mintCountPoints', label: 'Mint count' },
  { key: 'affiliatePoints', label: 'Referrals' },
];

function _scoreNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function _questProgressPercent(progress, target, completed) {
  if (completed) return 100;
  try {
    const current = BigInt(String(progress ?? 0));
    const goal = BigInt(String(target ?? 0));
    if (goal > 0n) {
      const basisPoints = (current * 10_000n) / goal;
      return Math.max(0, Math.min(100, Number(basisPoints) / 100));
    }
  } catch (_e) {
    const current = Number(progress);
    const goal = Number(target);
    if (Number.isFinite(current) && Number.isFinite(goal) && goal > 0) {
      return Math.max(0, Math.min(100, (current / goal) * 100));
    }
  }
  return 0;
}

function _trimGrouped(value) {
  const trimmed = String(value)
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '');
  const [whole, fraction] = trimmed.split('.');
  let grouped = whole;
  try { grouped = BigInt(whole || '0').toLocaleString('en-US'); }
  catch (_e) { /* retain formatter output */ }
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function _fmtLevelQuestAmount(questType, raw) {
  let amount;
  try { amount = BigInt(raw ?? 0); }
  catch (_e) { amount = 0n; }
  const type = Number(questType);
  if (type === 1 || type === 6 || type === 7) {
    return `${_trimGrouped(displayEth(amount, 4))} ETH`;
  }
  if (type === 2 || type === 3 || type === 5 || type === 8) {
    return `${_trimGrouped(displayToken(amount, 2))} FLIP`;
  }
  if (type === 9) {
    return `${amount.toLocaleString('en-US')} ${amount === 1n ? 'ticket' : 'tickets'}`;
  }
  return amount.toLocaleString('en-US');
}

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
  #questData = null;    // quest_progress rows — per player, sparse
  #questDefs = null;    // /game/quests/day/:day slots — per DAY, always both
  #questDay = null;     // the day #questDefs describes
  #questStreak = null;
  #scoreBreakdown = null;
  #levelQuest = null;   // optional DB projection: active level quest view
  #afkingActive = false;  // subscription runs the dailies — never "missed"
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
    update('ui.foilQuest', null);
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
          <div class="qst-streak-chip" title="Complete the daily quest to extend your streak">
            <span class="qst-streak-flame" aria-hidden="true">◆</span>
            <strong class="qst-streak" data-bind="qst-streak">—</strong>
            <span class="qst-streak-label">STREAK</span>
          </div>
          <div class="qst-score-control" data-bind="qst-score-control" tabindex="0">
            <strong class="qst-score-value" data-bind="qst-score-value">—</strong>
            <span class="qst-score-label">DEGEN SCORE
              <boon-product-indicator product="activity"></boon-product-indicator>
            </span>
            <div class="ac-pop qst-score-pop" data-bind="qst-score-pop" hidden>
              <div class="ac-pop__head" data-bind="qst-score-head"></div>
              <div class="ac-pop__rows" data-bind="qst-score-rows"></div>
              <div class="ac-pop__quest" data-bind="qst-score-quest"></div>
            </div>
          </div>
        </header>
        <div class="qst-slots" data-bind="qst-slots"></div>
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

    // Account-switcher (2026-07-16): quest progress + streak are per-account
    // identity stats (not summable across the combined view's accounts —
    // combine.js intentionally omits `quests`/`questStreak`). Render the
    // panel's existing empty-state instead of fetching.
    if (get('ui.mode') === 'combined') {
      this.#questData = null;
      this.#questStreak = null;
      this.#scoreBreakdown = null;
      this.#levelQuest = null;
      this.#renderEmpty('Per-account stat. Pick a single account.');
      return;
    }

    const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || get('viewing.address')
      || get('connected.address')
      || null;
    this.#pinnedAddress = addr;

    if (!addr) {
      this.#questData = null;
      this.#questStreak = null;
      this.#scoreBreakdown = null;
      this.#levelQuest = null;
      this.#renderEmpty('Connect a wallet to see your quests.');
      return;
    }

    try {
      // TWO sources, deliberately. /player/:addr carries quest_progress, which
      // only has a row once THIS player has progressed a quest — driving the
      // panel from it alone showed whatever they last touched, forever (the
      // reported bug: "daily quest is always affiliate and green" — a completed
      // day-241 affiliate row still on screen at day 279). The day's actual two
      // slots come from /game/quests/day/:day, which is player-independent.
      const day = this.#currentDay();
      const [data, defs] = await Promise.all([
        fetchJSON(`/player/${addr}`),
        day != null ? fetchJSON(`/game/quests/day/${day}`).catch(() => null) : Promise.resolve(null),
      ]);
      if (signal.aborted) return;
      this.#questData = Array.isArray(data?.quests) ? data.quests : null;
      this.#questDefs = Array.isArray(defs?.quests) ? defs.quests : null;
      this.#questDay = defs?.day ?? day ?? null;
      this.#questStreak = data?.questStreak || null;
      this.#scoreBreakdown = data?.scoreBreakdown || null;
      this.#levelQuest = data?.levelQuest && typeof data.levelQuest === 'object'
        ? data.levelQuest
        : null;
      this.#afkingActive = data?.afkingActive === true;
      this.#renderQuests();
    } catch (_e) {
      // Network blip — render empty/error message; next cycle retries.
      this.#renderEmpty('Could not load quests.');
    }
  }

  /**
   * The day whose quests we should be showing: the live game day, NOT the max
   * day present in the player's progress rows. Those diverge for any player who
   * has not progressed a quest recently, and that divergence was the bug.
   */
  #currentDay() {
    // `app.lastDay` is the only day the store carries — polling.js's game poller
    // fetches /game/state but does not write it to a store path, so there is no
    // `app.gameState` to prefer over this. It lands after this component's eager
    // mount fetch, which is why #wireStoreSubscriptions re-fetches on it.
    const fromLastDay = get('app.lastDay')?.day;
    return fromLastDay != null ? Number(fromLastDay) : null;
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
    const u3 = subscribe('ui.mode', () => this.#runMountFetch());
    // The day is what we ask /game/quests/day/:day for, and it arrives from the
    // lastDay poll AFTER this component's eager mount fetch. Without this the
    // first cycle has no day, fetches no definitions, and the panel sits on the
    // player's own stale rows until the 30s tick — which is the bug this whole
    // change is fixing, just with a shorter fuse.
    const u4 = subscribe('app.lastDay', (payload) => {
      const d = payload?.day;
      if (d == null) return;
      if (this.#questDay != null && Number(d) === Number(this.#questDay)) return;
      this.#runMountFetch();
    });
    this.#unsubs.push(u1, u2, u3, u4);
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

    // The DAY defines the slots; the PLAYER supplies progress. Driving this off
    // quest_progress alone (the old `maxDay` of the player's own rows) pinned the
    // panel to whatever quest the player last touched — for an inactive player
    // that is one stale row shown as today's quest forever.
    const all = Array.isArray(this.#questData) ? this.#questData : [];
    const defs = Array.isArray(this.#questDefs) ? this.#questDefs : null;
    const day = this.#questDay != null
      ? Number(this.#questDay)
      : all.reduce((m, q) => Math.max(m, Number(q?.day ?? 0)), 0);
    const rawPurchaseLevel = Number(get('app.lastDay')?.roll1?.purchaseLevel);
    const purchaseLevel = Number.isInteger(rawPurchaseLevel) && rawPurchaseLevel >= 0
      ? rawPurchaseLevel
      : null;

    // Progress rows for THIS day only, indexed by slot.
    const progressBySlot = new Map();
    for (const q of all) {
      if (Number(q?.day ?? -1) === day) progressBySlot.set(Number(q?.slot ?? 0), q);
    }

    // Merge: one entry per slot the day defines, progress overlaid where the
    // player has any. No progress row is NOT "no quest" — it is "not started".
    let slots;
    if (defs && defs.length) {
      slots = defs.map((d) => {
        const slot = Number(d?.slot ?? 0);
        const p = progressBySlot.get(slot);
        const questType = Number(d?.questType ?? p?.questType ?? 0);
        const target = _dailyQuestTarget(
          questType,
          slot,
          purchaseLevel,
          _positiveTarget(p?.target) != null ? p.target : d?.target,
        );
        return p
          ? { ...p, slot, questType, target }
          : { slot, questType, progress: '0', target, completed: false, notStarted: true };
      });
    } else {
      // Definitions unavailable (older day, or the endpoint failed) — fall back
      // to the player's own rows for the day rather than showing nothing.
      slots = all.filter((q) => Number(q?.day ?? 0) === day);
    }

    const hasLevelQuest = Boolean(this.#levelQuest);
    if (slots.length === 0 && !hasLevelQuest) {
      emptyEl.hidden = false;
      emptyEl.textContent = 'No quests today.';
    } else {
      emptyEl.hidden = true;
    }

    // Render each slot — sorted by slot index ascending (slot 0 primary, slot 1
    // secondary; matches /beta/components/quest-panel.js convention).
    const sorted = [...slots].sort((a, b) => Number(a?.slot ?? 0) - Number(b?.slot ?? 0));

    // A forced foil quest and its purchasable pack are the same day/level
    // window. Publish that exact purchase level for the buy panel so it does
    // not hide the option after independently guessing against a stale phase
    // snapshot.
    const foilQuest = sorted.find((s) => Number(s?.questType) === 4 && !s?.completed);
    update('ui.foilQuest', foilQuest ? {
      active: true,
      completed: false,
      day,
      level: purchaseLevel,
      address: this.#pinnedAddress ? String(this.#pinnedAddress).toLowerCase() : null,
    } : null);

    // Publish the merged primary state for other read-only consumers.
    this.#publishPrimaryStatus(sorted);

    const primary = sorted.find((s) => Number(s?.slot ?? 0) === 0);
    const primaryComplete = this.#afkingActive || Boolean(primary?.completed);
    const bonus = sorted.find((s) => Number(s?.slot ?? 0) === 1);
    const allDailyComplete = primaryComplete && (!bonus || Boolean(bonus.completed));
    this.#paintStreakState(primaryComplete, allDailyComplete);

    for (const s of sorted) {
      const slotIndex = Number(s?.slot ?? 0);
      const isAuto = this.#afkingActive && slotIndex === 0 && !s?.completed;
      const isDone = !!s?.completed || isAuto;
      const isGated = slotIndex === 1 && !primaryComplete && !isDone;
      const questTypeRaw = Number(s?.questType ?? -1);
      const label = QUEST_TYPE_LABELS[questTypeRaw] || 'Unknown';
      let stateLabel;
      let statusText;
      let statusKind;
      if (isGated) {
        statusKind = 'locked';
        statusText = `${_fmtDailyQuestAmount(questTypeRaw, s?.progress ?? 0)} / ${_fmtDailyQuestAmount(questTypeRaw, s?.target)}`;
        stateLabel = 'Complete the daily quest first';
      } else if (isAuto) {
        statusKind = 'done';
        statusText = 'AUTO';
        stateLabel = 'Handled by afKing';
      } else if (isDone) {
        statusKind = 'done';
        statusText = 'COMPLETE';
        stateLabel = 'Complete';
      } else if (s?.notStarted) {
        statusKind = 'progress';
        statusText = `${_fmtDailyQuestAmount(questTypeRaw, 0)} / ${_fmtDailyQuestAmount(questTypeRaw, s?.target)}`;
        stateLabel = `0 of ${_fmtDailyQuestAmount(questTypeRaw, s?.target)}`;
      } else {
        statusKind = 'progress';
        statusText = `${_fmtDailyQuestAmount(questTypeRaw, s?.progress)} / ${_fmtDailyQuestAmount(questTypeRaw, s?.target)}`;
        stateLabel = `${_fmtDailyQuestAmount(questTypeRaw, s?.progress)} of ${_fmtDailyQuestAmount(questTypeRaw, s?.target)}`;
      }
      this.#appendQuestCard(slotsEl, {
        variant: slotIndex === 0 ? 'primary' : 'secondary',
        role: slotIndex === 0 ? 'DAILY' : 'BONUS',
        roleLabel: slotIndex === 0 ? 'Daily' : 'Bonus',
        label,
        icon: QUEST_TYPE_ICONS[questTypeRaw] || '?',
        statusText,
        statusKind,
        stateLabel,
        progressPercent: _questProgressPercent(s?.progress, s?.target, isDone),
        isDone,
        isAuto,
        isUnstarted: !isDone && Boolean(s?.notStarted),
        isGated,
        rewardText: '100 FLIP',
        rewardTitle: 'Quest reward: 100 FLIP',
        questType: questTypeRaw,
        target: s?.target ?? 0,
        level: questTypeRaw === 4 ? purchaseLevel : null,
      });
    }

    this.#appendLevelQuestCard(slotsEl);

    // Streak — textContent only.
    const streakValue = this.#questStreak?.baseStreak ?? 0;
    streakEl.textContent = String(streakValue);
    this.#renderScoreBreakdown();
  }

  #paintStreakState(primaryComplete, allDailyComplete) {
    const chip = this.querySelector('.qst-streak-chip');
    if (!chip?.classList) return;
    chip.classList.toggle('qst-streak-chip--primary-open', !primaryComplete);
    chip.classList.toggle('qst-streak-chip--primary-done', primaryComplete && !allDailyComplete);
    chip.classList.toggle('qst-streak-chip--all-done', allDailyComplete);
    chip.setAttribute('title', allDailyComplete
      ? 'Both daily quests complete'
      : primaryComplete ? 'Daily quest complete · bonus quest still open'
        : 'Daily quest incomplete');
  }

  #renderScoreBreakdown() {
    const valueEl = this.querySelector('[data-bind="qst-score-value"]');
    const headEl = this.querySelector('[data-bind="qst-score-head"]');
    const rowsEl = this.querySelector('[data-bind="qst-score-rows"]');
    const questEl = this.querySelector('[data-bind="qst-score-quest"]');
    if (!valueEl || !headEl || !rowsEl || !questEl) return;

    const score = this.#scoreBreakdown;
    const points = score ? _scoreNumber(score.totalBps) : null;
    valueEl.textContent = points == null ? '—' : `${points.toLocaleString('en-US')}%`;
    headEl.textContent = points == null
      ? 'No Degen Score yet'
      : `Degen Score · ${points.toLocaleString('en-US')}%`;

    if (typeof rowsEl.replaceChildren === 'function') rowsEl.replaceChildren();
    else { rowsEl.children = []; rowsEl._innerHTML = ''; }

    if (score) {
      // Use the same DB-backed streak shown in the header. This also avoids an
      // afKing API compatibility edge where the legacy score field may already
      // contain the halved contribution instead of the raw streak count.
      const questStreakCount = _scoreNumber(
        this.#questStreak?.baseStreak ?? score.questStreakPoints,
      );
      const rows = SCORE_COMPONENTS.map((component) => ({
        label: component.label,
        points: component.key === 'questStreakPoints'
          ? Math.floor(Math.max(0, questStreakCount) / 2)
          : _scoreNumber(score[component.key]),
      }));
      if (score.passBonus && _scoreNumber(score.passBonus.points) !== 0) {
        rows.push({ label: 'Pass bonus', points: _scoreNumber(score.passBonus.points) });
      }
      const curse = _scoreNumber(score.cursePoints);
      if (curse !== 0) rows.push({ label: 'Cashout curse', points: curse, negative: true });
      const max = rows.reduce((largest, row) => Math.max(largest, Math.abs(row.points)), 0) || 1;

      for (const model of rows) {
        const row = document.createElement('div');
        row.className = model.negative ? 'ac-pop__row ac-pop__row--neg' : 'ac-pop__row';
        const label = document.createElement('span');
        label.className = 'ac-pop__label';
        label.textContent = model.label;
        const bar = document.createElement('span');
        bar.className = 'ac-pop__bar';
        const fill = document.createElement('span');
        fill.className = 'ac-pop__fill';
        fill.style.width = `${Math.round((Math.abs(model.points) / max) * 100)}%`;
        bar.appendChild(fill);
        const rowPoints = document.createElement('span');
        rowPoints.className = 'ac-pop__pts';
        rowPoints.textContent = String(model.points);
        row.appendChild(label);
        row.appendChild(bar);
        row.appendChild(rowPoints);
        rowsEl.appendChild(row);
      }
    }

    const primary = get('ui.primaryQuest');
    const state = !primary || primary.completed == null
      ? 'unknown'
      : primary.completed ? 'done' : 'todo';
    questEl.className = `ac-pop__quest ac-pop__quest--${state}`;
    questEl.textContent = state === 'done'
      ? (primary?.afking ? 'Daily quest: handled by afKing' : 'Daily quest: complete')
      : state === 'todo' ? 'Daily quest: not complete'
        : 'Daily quest: unknown';
  }

  #appendLevelQuestCard(slotsEl) {
    const quest = this.#levelQuest;
    if (!quest) return;
    const questType = Number(quest.questType ?? 0);
    const assigned = questType > 0;
    const isDone = Boolean(quest.completed);
    const isLocked = assigned && !quest.eligible && !isDone;
    const progress = quest.progress ?? 0;
    const target = quest.target ?? 0;
    // Absent on older API builds — default to true so an unknown field never blanks the bar.
    const progressAvailable = quest.progressAvailable !== false;
    const label = assigned ? (QUEST_TYPE_LABELS[questType] || 'Level quest') : 'Next level quest';

    let statusText;
    let statusKind;
    let stateLabel;
    if (!assigned) {
      statusText = 'WAIT';
      statusKind = 'locked';
      stateLabel = 'Waiting for the next level quest';
    } else if (isDone) {
      statusText = 'COMPLETE';
      statusKind = 'done';
      stateLabel = 'Complete';
    } else if (isLocked) {
      statusText = 'QUALIFY';
      statusKind = 'locked';
      stateLabel = 'Buy one ticket for this level, then reach a 5-day streak or hold a pass';
    } else if (!progressAvailable) {
      // Affiliate level quests only: the API cannot derive per-player progress from events
      // (the credit goes to a rolled winner on a kickback-adjusted base), so it sends
      // progressAvailable:false with progress 0. Show the target, not a fake empty bar.
      statusText = `TARGET ${_fmtLevelQuestAmount(questType, target)}`;
      statusKind = 'progress';
      stateLabel = `Target ${_fmtLevelQuestAmount(questType, target)}; progress is not tracked for this quest`;
    } else {
      statusText = `${_fmtLevelQuestAmount(questType, progress)} / ${_fmtLevelQuestAmount(questType, target)}`;
      statusKind = 'progress';
      stateLabel = `${_fmtLevelQuestAmount(questType, progress)} of ${_fmtLevelQuestAmount(questType, target)}`;
    }

    this.#appendQuestCard(slotsEl, {
      variant: 'level',
      role: 'LEVEL',
      roleLabel: 'Level',
      label,
      icon: QUEST_TYPE_ICONS[questType] || 'L',
      statusText,
      statusKind,
      stateLabel,
      progressPercent: progressAvailable ? _questProgressPercent(progress, target, isDone) : 0,
      isDone,
      isGated: isLocked || !assigned,
      rewardText: '800 FLIP',
      rewardExtraText: '+5 STREAK',
      rewardTitle: 'Completion credits 800 FLIP and adds 5 to the quest streak',
      questType,
      target,
    });
  }

  #appendQuestCard(slotsEl, model) {
    const slotDiv = document.createElement('div');
    slotDiv.className = 'qst-slot';
    slotDiv.classList.add(`qst-slot--${model.variant}`);
    if (model.isDone) slotDiv.classList.add('qst-slot--completed');
    if (model.isAuto) slotDiv.classList.add('qst-slot--auto');
    if (!model.isDone) slotDiv.classList.add('qst-slot--todo');
    if (model.isUnstarted) slotDiv.classList.add('qst-slot--unstarted');
    if (model.isGated) slotDiv.classList.add('qst-slot--gated');
    const actionable = !model.isDone
      && !model.isGated
      && QUEST_SETUP_TYPES.has(Number(model.questType));
    if (actionable) {
      slotDiv.classList.add('qst-slot--actionable');
      slotDiv.setAttribute('role', 'button');
      slotDiv.setAttribute('tabindex', '0');
      const activate = () => {
        if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') return;
        try {
          document.dispatchEvent(new CustomEvent('quest:activate', {
            detail: {
              questType: Number(model.questType),
              target: String(model.target ?? '0'),
              variant: String(model.variant || 'daily'),
              ...(model.level != null ? { level: Number(model.level) } : {}),
            },
          }));
        } catch (_e) { /* headless CustomEvent shim */ }
      };
      slotDiv.addEventListener('click', activate);
      slotDiv.addEventListener('keydown', (event) => {
        if (event?.key !== 'Enter' && event?.key !== ' ') return;
        try { event.preventDefault?.(); } catch (_e) { /* fakeDOM */ }
        activate();
      });
    }

    const topEl = document.createElement('div');
    topEl.className = 'qst-slot-top';
    const roleEl = document.createElement('span');
    roleEl.className = 'qst-slot-role';
    roleEl.textContent = model.role;
    const statusEl = document.createElement('span');
    statusEl.className = 'qst-slot-status';
    statusEl.classList.add(`qst-slot-status--${model.statusKind}`);
    statusEl.textContent = model.statusText;
    topEl.appendChild(roleEl);
    topEl.appendChild(statusEl);
    slotDiv.appendChild(topEl);

    const coreEl = document.createElement('div');
    coreEl.className = 'qst-slot-core';
    const iconEl = document.createElement('span');
    iconEl.className = 'qst-slot-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = model.icon;
    const copyEl = document.createElement('div');
    copyEl.className = 'qst-slot-copy';
    const nameEl = document.createElement('div');
    nameEl.className = 'qst-slot-name';
    nameEl.textContent = model.label;
    copyEl.appendChild(nameEl);
    if (model.rewardText) {
      const rewardEl = document.createElement('span');
      rewardEl.className = 'qst-slot-reward';
      if (model.rewardTitle) {
        rewardEl.setAttribute('title', model.rewardTitle);
        rewardEl.setAttribute('aria-label', model.rewardTitle);
      }
      const rewardLogo = document.createElement('img');
      rewardLogo.className = 'qst-slot-reward-logo';
      // Degenerus' red flame mark is also the FLIP mark. Keep it attached to
      // the reward copy — the larger quest-type emblem remains independent.
      rewardLogo.src = '/whitepaper/flame-logo.svg';
      rewardLogo.alt = '';
      rewardLogo.setAttribute('aria-hidden', 'true');
      const rewardText = document.createElement('span');
      rewardText.textContent = model.rewardText;
      const rewardLabel = document.createElement('span');
      rewardLabel.className = 'qst-slot-reward-label';
      rewardLabel.textContent = 'REWARD:';
      rewardEl.appendChild(rewardLabel);
      rewardEl.appendChild(rewardLogo);
      rewardEl.appendChild(rewardText);
      copyEl.appendChild(rewardEl);
      if (model.rewardExtraText) {
        const rewardExtra = document.createElement('span');
        rewardExtra.className = 'qst-slot-reward-extra';
        rewardExtra.textContent = model.rewardExtraText;
        copyEl.appendChild(rewardExtra);
      }
    }
    coreEl.appendChild(iconEl);
    coreEl.appendChild(copyEl);
    slotDiv.appendChild(coreEl);

    const meterEl = document.createElement('div');
    meterEl.className = 'qst-meter';
    meterEl.setAttribute('role', 'progressbar');
    meterEl.setAttribute('aria-valuemin', '0');
    meterEl.setAttribute('aria-valuemax', '100');
    meterEl.setAttribute('aria-valuenow', String(Math.round(model.progressPercent)));
    meterEl.setAttribute('aria-label', `${model.label}: ${model.stateLabel}`);
    const fillEl = document.createElement('span');
    fillEl.className = 'qst-meter-fill';
    fillEl.style.width = `${model.progressPercent}%`;
    meterEl.appendChild(fillEl);
    slotDiv.appendChild(meterEl);

    const aria = `${model.roleLabel} quest: ${model.label}. ${model.stateLabel}.${actionable ? ' Activate to set up this action.' : ''}`;
    slotDiv.setAttribute('aria-label', aria);
    slotDiv.setAttribute('title', aria);
    slotsEl.appendChild(slotDiv);
  }

  /**
   * Publish the PRIMARY (slot 0) quest's status to the store. This component
   * already owns the definitions + progress merge, so other consumers should
   * not derive a competing answer.
   *
   * `completed: null` means "unknown" (no definitions, no wallet) — distinct
   * from false, so read-only consumers can stay neutral instead of claiming a miss.
   */
  #publishPrimaryStatus(sorted) {
    // An afKing subscription delivers the PRIMARY quest (slot 0 is always
    // MINT_ETH and the sub mints with ETH daily) without filing a
    // quest_progress row, so "no completed row" is not a miss for a subscriber.
    // The secondary is still the player's own job and the panel says so.
    if (this.#afkingActive) {
      update('ui.primaryQuest', { completed: true, afking: true, questType: -1, day: this.#questDay });
      return;
    }
    const primary = (sorted || []).find((s) => Number(s?.slot ?? 0) === 0);
    update('ui.primaryQuest', primary
      ? { completed: !!primary.completed, afking: false, questType: Number(primary.questType ?? -1), day: this.#questDay }
      : { completed: null, afking: false, questType: -1, day: this.#questDay });
  }

  #renderEmpty(msg) {
    update('ui.foilQuest', null);
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
    if (streakEl) streakEl.textContent = '—';
    const scoreEl = this.querySelector('[data-bind="qst-score-value"]');
    if (scoreEl) scoreEl.textContent = '—';
    const streakChip = this.querySelector('.qst-streak-chip');
    if (streakChip?.classList) {
      streakChip.classList.remove(
        'qst-streak-chip--primary-open',
        'qst-streak-chip--primary-done',
        'qst-streak-chip--all-done',
      );
    }
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
