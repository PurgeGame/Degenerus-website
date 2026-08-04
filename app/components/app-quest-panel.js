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
// live level-quest state yet, the LEVEL slot remains visible in a syncing state
// instead of adding a second source of truth or silently collapsing the card.
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
//   Completion feedback stays inside the quest area: one short chime and a
//   small card pulse only when a live false → true transition is observed.
//
// Class palette: .qst-* prefix (RESEARCH R10 verified non-colliding against
// existing 14 prefixes: app/cf/chain/clm/dec/deg/jp/last/lbx/ldj/pass/player/
// view/wallet).
//
// Reward callout (visual only — no JS coupling): the visible label stays terse;
// its title/aria-label retains the complete next-flip win/burn condition.

import { get, update, subscribe, getViewedAddress } from '../app/store.js';
import { ETH_DIVISOR } from '../app/chain-config.js';
import { fetchJSON } from '../../beta/app/api.js';
import { displayEth, displayToken } from '../app/scaling.js';
import { LOOTBOX_MIN_WEI, scaledTicketPriceWei } from '../app/lootbox.js';
import { activeTicketLevel } from '../app/active-level.js';
import { degeneretteLimits } from '../app/degenerette.js';
import {
  applyDgnTicketAccent,
  dgnBadgePath,
  dgnTraitIdsToQuadrants,
} from '../app/dgn-traits.js';
import { readLiveQuestBoard } from '../app/quests.js';
import { questStreakScorePoints, degenScoreLootTier } from '../app/activity-score.js';
import { sfxQuestComplete } from '../app/jackpot-sfx.js';
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
    return `${_trimGrouped(displayToken(amount, 0))} FLIP`;
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
  1: 'Buy tickets or lootboxes',
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

function _parseDgnQuestAmount(value, questType) {
  const match = /^\s*(\d+)(?:\.(\d{0,18}))?\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  try {
    const full = (BigInt(match[1]) * (10n ** 18n))
      + BigInt((match[2] || '').padEnd(18, '0') || '0');
    return Number(questType) === 7 ? full / BigInt(ETH_DIVISOR) : full;
  } catch (_e) {
    return null;
  }
}

function _formatDgnQuestPerSpin(value, questType) {
  const text = Number(questType) === 7
    ? displayEth(BigInt(value || 0), 6)
    : displayToken(BigInt(value || 0), 6);
  return String(text).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

function _parseQuarterTicketCount(value) {
  const match = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  const hundredths = BigInt(match[1]) * 100n
    + BigInt((match[2] || '').padEnd(2, '0'));
  if (hundredths <= 0n || hundredths % 25n !== 0n) return null;
  return hundredths / 25n;
}

const SCORE_COMPONENTS = [
  // Despite its legacy name, questStreakPoints is the raw streak count. The
  // score contribution is floor(count / 2); #renderScoreBreakdown normalizes it.
  { key: 'questStreakPoints', label: 'Quest streak' },
  { key: 'mintLevelStreakPoints', label: 'Level streak' },
  { key: 'mintCountPoints', label: 'Mint count' },
  { key: 'affiliatePoints', label: 'Referrals' },
];

const SCORE_COMPONENT_CAPS = Object.freeze({
  mintLevelStreakPoints: 50,
  mintCountPoints: 25,
  affiliatePoints: 50,
  passBonusPoints: 80,
});
const QUEST_STREAK_HALF_FILL_POINTS = 20;

function _scoreNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function _finiteNullable(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function _liveOnlyScoreBreakdown(liveBoard, streak) {
  const total = _finiteNullable(liveBoard?.activityScore);
  if (total == null) return null;
  const score = {
    totalBps: total,
    liveOnly: true,
  };
  const streakNumber = _finiteNullable(streak);
  if (streakNumber != null) score.questStreakPoints = streakNumber;
  // A deity pass deterministically replaces the two participation components
  // with their maxima and adds the permanent +80 pass component. These rows
  // are therefore safe to show even when the indexer has no player record.
  if (liveBoard?.hasDeityPass === true) {
    score.mintLevelStreakPoints = 50;
    score.mintCountPoints = 25;
    score.passBonus = { kind: 'deity', points: 80 };
  }
  return score;
}

/**
 * Merge indexed component detail with deployment-local identity values.
 * GAME owns the headline total and active afKing streak. The database remains
 * useful for the component breakdown, but only while its total/pass identity
 * agrees with the current deployment.
 */
export function mergeQuestIdentitySnapshot(data, liveBoard) {
  const afkingActive = liveBoard
    ? liveBoard.afkingActive === true
    : data?.afkingActive === true;
  const indexedCurrent = _finiteNullable(data?.currentStreak);
  const liveCurrent = _finiteNullable(liveBoard?.effectiveQuestStreak);
  const useExactLive = liveBoard?.effectiveQuestStreakExact === true
    && liveCurrent != null;
  const fallback = liveBoard?.questStreak || data?.questStreak || null;
  const selectedStreak = afkingActive
    ? (useExactLive
      ? liveCurrent
      : indexedCurrent != null ? indexedCurrent : _finiteNullable(fallback?.baseStreak))
    : (useExactLive ? liveCurrent : _finiteNullable(fallback?.baseStreak));
  const questStreak = selectedStreak != null
    ? {
      ...(fallback || {}),
      baseStreak: selectedStreak,
      lastCompletedDay: fallback?.lastCompletedDay ?? 0,
    }
    : fallback;

  const indexedScore = data?.scoreBreakdown && typeof data.scoreBreakdown === 'object'
    ? data.scoreBreakdown
    : null;
  const liveScore = _finiteNullable(liveBoard?.activityScore);
  let scoreBreakdown = indexedScore;
  if (liveScore != null) {
    const indexedTotal = _finiteNullable(indexedScore?.totalBps);
    const indexedDeity = String(indexedScore?.passBonus?.kind || '').toLowerCase() === 'deity';
    const deityMismatch = liveBoard?.hasDeityPass != null
      && Boolean(liveBoard.hasDeityPass) !== indexedDeity;
    scoreBreakdown = indexedScore
      && indexedTotal != null
      && indexedTotal === liveScore
      && !deityMismatch
      ? { ...indexedScore, totalBps: liveScore }
      : _liveOnlyScoreBreakdown(liveBoard, questStreak?.baseStreak);
  }

  return { afkingActive, questStreak, scoreBreakdown };
}

/**
 * Visual fill for one Degen Score breakdown row. Capped categories compare to
 * their own contract maximum; quest streak uses a diminishing curve where 20
 * credited points is exactly half-full and can approach, but never reach,
 * 100%. Cashout curse is uncapped and uses the same non-relative curve.
 */
export function degenScoreBreakdownBarPercent(key, value) {
  const points = Math.abs(_scoreNumber(value));
  const cap = SCORE_COMPONENT_CAPS[key];
  if (cap) return Math.max(0, Math.min(100, (points / cap) * 100));
  if (key === 'questStreakPoints' || key === 'cursePoints') {
    if (points === 0) return 0;
    return Math.min(99.5, (points / (points + QUEST_STREAK_HALF_FILL_POINTS)) * 100);
  }
  return 0;
}

// Keep the existing component export stable for callers while the tier palette
// itself lives with the other shared Activity/Degen Score helpers.
export { degenScoreLootTier };

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
    return `${_trimGrouped(displayToken(amount, 0))} FLIP`;
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
  #questDgnSpins = 5;
  #questDgnPerSpin = 0n;
  #questDgnTraitIds = null;
  #questDgnHero = 0;
  // --- Pinned data from /player/:address (server-derived) ---
  #questData = null;    // quest_progress rows — per player, sparse
  #questDefs = null;    // /game/quests/day/:day slots — per DAY, always both
  #questDay = null;     // the day #questDefs describes
  #questStreak = null;
  #scoreBreakdown = null;
  #levelQuest = null;   // optional DB projection: active level quest view
  #gameState = null;    // live routing state; foil quests must use the level a buy reaches NOW
  #afkingActive = false;  // subscription runs the dailies — never "missed"
  #pinnedAddress = null;
  #questDialogModel = null;
  #questDialogChoice = 'ticket';
  #questActionAmount = null;
  #questDialogReturnFocus = null;
  #questCompletionIdentity = null;
  #questCompletionState = new Map();

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wireQuestDialog();
    this.#wireVisibilityRePoll();
    this.#wireStoreSubscriptions();
    this.#startPolling();
    // Eager first cycle on mount.
    this.#runMountFetch();
  }

  disconnectedCallback() {
    this.#closeQuestDialog({ restoreFocus: false });
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
    this.#resetQuestCompletionState();
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
          <h2><a class="qst-learn-link" href="/learn/quests/">QUESTS</a></h2>
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
      <div class="qst-action-dialog" data-bind="qst-action-dialog" hidden
           role="dialog" aria-modal="true" aria-labelledby="qst-action-title">
        <button type="button" class="qst-action-dialog__backdrop"
                data-bind="qst-action-backdrop" aria-label="Close quest action"></button>
        <section class="qst-action-dialog__card">
          <button type="button" class="qst-action-dialog__close"
                  data-bind="qst-action-close" aria-label="Close quest action">×</button>
          <span class="qst-action-dialog__eyebrow" data-bind="qst-action-role"></span>
          <h3 id="qst-action-title" data-bind="qst-action-title"></h3>
          <p class="qst-action-dialog__copy" data-bind="qst-action-copy"></p>
          <div class="qst-action-choice" data-bind="qst-action-choice" hidden
               role="group" aria-label="Choose ticket or lootbox">
            <button type="button" data-bind="qst-action-ticket" data-choice="ticket">TICKET</button>
            <button type="button" data-bind="qst-action-lootbox" data-choice="lootbox">LOOTBOX</button>
          </div>
          <label class="qst-action-adjust" data-bind="qst-action-adjust" hidden>
            <span class="qst-action-dgn__field-head">
              <span data-bind="qst-action-adjust-label">AMOUNT</span>
              <small data-bind="qst-action-adjust-needed">NEEDED —</small>
            </span>
            <span class="qst-action-dgn__stepper qst-action-adjust__stepper">
              <button type="button" data-bind="qst-action-adjust-down"
                      aria-label="Decrease quest action amount">−</button>
              <input type="number" name="qst-action-amount" min="0" step="any"
                     inputmode="decimal" aria-label="Quest action amount">
              <strong data-bind="qst-action-adjust-unit"></strong>
              <button type="button" data-bind="qst-action-adjust-up"
                      aria-label="Increase quest action amount">+</button>
            </span>
          </label>
          <div class="qst-action-dgn" data-bind="qst-action-dgn" hidden>
            <div class="ticket-card tc-small dgn-ticket qst-action-dgn__ticket"
                 aria-label="Degenerette quest ticket">
              <div class="trait-quadrant dgn-q" data-bind="qst-action-dgn-cell-0"><img data-bind="qst-action-dgn-img-0" alt=""></div>
              <div class="trait-quadrant dgn-q" data-bind="qst-action-dgn-cell-1"><img data-bind="qst-action-dgn-img-1" alt=""></div>
              <div class="trait-quadrant dgn-q" data-bind="qst-action-dgn-cell-2"><img data-bind="qst-action-dgn-img-2" alt=""></div>
              <div class="trait-quadrant dgn-q" data-bind="qst-action-dgn-cell-3"><img data-bind="qst-action-dgn-img-3" alt=""></div>
              <div class="ticket-card-center"><img src="/whitepaper/flame-center.svg" alt=""></div>
            </div>
            <div class="qst-action-dgn__wager">
              <label class="qst-action-dgn__field">
                <span class="qst-action-dgn__field-head">
                  <span>BET PER SPIN</span>
                  <small data-bind="qst-action-dgn-bet-limit">MIN —</small>
                </span>
                <span class="qst-action-dgn__stepper qst-action-dgn__stepper--bet">
                  <button type="button" data-bind="qst-action-dgn-bet-down"
                          aria-label="Decrease Degenerette bet per spin">−</button>
                  <input type="number" name="qst-action-dgn-bet" min="0" step="any"
                         inputmode="decimal" aria-label="Degenerette bet per spin">
                  <strong data-bind="qst-action-dgn-unit">ETH</strong>
                  <button type="button" data-bind="qst-action-dgn-bet-up"
                          aria-label="Increase Degenerette bet per spin">+</button>
                </span>
              </label>
              <label class="qst-action-dgn__field">
                <span class="qst-action-dgn__field-head">
                  <span>SPINS</span>
                  <small data-bind="qst-action-dgn-spins-limit">MAX —</small>
                </span>
                <span class="qst-action-dgn__stepper">
                  <button type="button" data-bind="qst-action-dgn-spins-down"
                          aria-label="Decrease Degenerette spins">−</button>
                  <input type="number" name="qst-action-dgn-spins" min="1" step="1" value="5"
                         inputmode="numeric" aria-label="Degenerette number of spins">
                  <button type="button" data-bind="qst-action-dgn-spins-up"
                          aria-label="Increase Degenerette spins">+</button>
                </span>
              </label>
            </div>
          </div>
          <div class="qst-action-requirement">
            <span>QUEST ACTION</span>
            <strong data-bind="qst-action-requirement">—</strong>
          </div>
          <button type="button" class="qst-action-confirm" data-bind="qst-action-confirm">
            CONFIRM QUEST ACTION
          </button>
        </section>
      </div>
    `;
  }

  #wireQuestDialog() {
    const dialog = this.querySelector('[data-bind="qst-action-dialog"]');
    const close = this.querySelector('[data-bind="qst-action-close"]');
    const backdrop = this.querySelector('[data-bind="qst-action-backdrop"]');
    const ticket = this.querySelector('[data-bind="qst-action-ticket"]');
    const lootbox = this.querySelector('[data-bind="qst-action-lootbox"]');
    const adjust = this.querySelector('[data-bind="qst-action-adjust"]');
    const adjustInput = this.querySelector('[name="qst-action-amount"]');
    const adjustLabel = this.querySelector('[data-bind="qst-action-adjust-label"]');
    const adjustNeeded = this.querySelector('[data-bind="qst-action-adjust-needed"]');
    const adjustUnit = this.querySelector('[data-bind="qst-action-adjust-unit"]');
    const dgnBet = this.querySelector('[name="qst-action-dgn-bet"]');
    const dgnSpins = this.querySelector('[name="qst-action-dgn-spins"]');
    const actionAmount = this.querySelector('[name="qst-action-amount"]');
    const confirm = this.querySelector('[data-bind="qst-action-confirm"]');
    close?.addEventListener?.('click', () => this.#closeQuestDialog());
    backdrop?.addEventListener?.('click', () => this.#closeQuestDialog());
    ticket?.addEventListener?.('click', () => {
      this.#questDialogChoice = 'ticket';
      this.#resetQuestActionAmount();
      this.#renderQuestDialog();
    });
    lootbox?.addEventListener?.('click', () => {
      this.#questDialogChoice = 'lootbox';
      this.#resetQuestActionAmount();
      this.#renderQuestDialog();
    });
    actionAmount?.addEventListener?.('change', () => {
      const parsed = this.#parseQuestActionAmount(actionAmount.value);
      if (parsed != null) this.#questActionAmount = parsed;
      this.#renderQuestDialog();
    });
    this.querySelector('[data-bind="qst-action-adjust-down"]')
      ?.addEventListener?.('click', () => this.#stepQuestAction(-1));
    this.querySelector('[data-bind="qst-action-adjust-up"]')
      ?.addEventListener?.('click', () => this.#stepQuestAction(1));
    dgnBet?.addEventListener?.('change', () => {
      const parsed = _parseDgnQuestAmount(dgnBet.value, this.#questDialogModel?.questType);
      if (parsed != null && parsed > 0n) this.#questDgnPerSpin = parsed;
      this.#renderQuestDialog();
    });
    dgnSpins?.addEventListener?.('change', () => {
      const type = Number(this.#questDialogModel?.questType);
      const max = degeneretteLimits(type === 7 ? 0 : 1)?.maxSpins ?? 5;
      this.#questDgnSpins = Math.max(1, Math.min(max, Math.trunc(Number(dgnSpins.value) || 5)));
      this.#questDgnPerSpin = this.#questDgnDefaultPerSpin(this.#questDialogModel);
      this.#renderQuestDialog();
    });
    this.querySelector('[data-bind="qst-action-dgn-bet-down"]')
      ?.addEventListener?.('click', () => this.#stepQuestDgn('bet', -1));
    this.querySelector('[data-bind="qst-action-dgn-bet-up"]')
      ?.addEventListener?.('click', () => this.#stepQuestDgn('bet', 1));
    this.querySelector('[data-bind="qst-action-dgn-spins-down"]')
      ?.addEventListener?.('click', () => this.#stepQuestDgn('spins', -1));
    this.querySelector('[data-bind="qst-action-dgn-spins-up"]')
      ?.addEventListener?.('click', () => this.#stepQuestDgn('spins', 1));
    confirm?.addEventListener?.('click', () => this.#confirmQuestDialog());
    dialog?.addEventListener?.('keydown', (event) => {
      if (event?.key !== 'Escape') return;
      try { event.preventDefault?.(); } catch (_e) { /* fakeDOM */ }
      this.#closeQuestDialog();
    });
  }

  #remainingQuestTarget(model) {
    let target = 0n;
    let progress = 0n;
    try { target = BigInt(model?.target ?? 0); } catch (_e) { target = 0n; }
    try { progress = BigInt(model?.progress ?? 0); } catch (_e) { progress = 0n; }
    let remaining = target > progress ? target - progress : target;
    const type = Number(model?.questType);
    // These actions have hard contract floors. If a partially completed quest
    // leaves less than one valid action, the floor is the true minimum that can
    // finish it—not the smaller but unsubmitable arithmetic remainder.
    const floor = type === 2
      ? 100n * (10n ** 18n)
      : type === 5
        ? 1_000n * (10n ** 18n)
        : (type === 4 || type === 9) ? 1n : 0n;
    if (remaining < floor) remaining = floor;
    return remaining;
  }

  #questAdjustConfig(model = this.#questDialogModel) {
    const type = Number(model?.questType);
    const required = this.#remainingQuestTarget(model);
    const price = this.#questTicketPrice(model);
    const purchaseChoice = type === 1 ? this.#questDialogChoice : 'ticket';
    if (type === 1 && purchaseChoice === 'ticket' && price != null && price > 0n) {
      const quarter = (price + 3n) / 4n;
      return { kind: 'tickets', label: 'TICKET COUNT', unit: '', min: quarter, step: quarter, required, price };
    }
    if ((type === 1 && purchaseChoice === 'lootbox') || type === 6) {
      return {
        kind: 'eth', label: 'LOOTBOX VALUE', unit: 'ETH', min: LOOTBOX_MIN_WEI,
        step: price != null && price > 0n ? price : LOOTBOX_MIN_WEI,
        required, price,
      };
    }
    if (type === 2) {
      const step = 100n * (10n ** 18n);
      return { kind: 'flip', label: 'BET AMOUNT', unit: 'FLIP', min: step, step, required, price };
    }
    if (type === 5) {
      const step = 1_000n * (10n ** 18n);
      return { kind: 'flip', label: 'BURN AMOUNT', unit: 'FLIP', min: step, step, required, price };
    }
    if (type === 9) {
      return { kind: 'tickets-count', label: 'TICKETS TO REDEEM', unit: '', min: 1n, step: 1n, required, price };
    }
    return null;
  }

  #resetQuestActionAmount() {
    const config = this.#questAdjustConfig();
    if (!config) {
      this.#questActionAmount = null;
      return;
    }
    let amount = config.required > config.min ? config.required : config.min;
    if (config.kind === 'tickets') {
      amount = this.#ticketActionForSpend(amount, config.price).cost;
    }
    this.#questActionAmount = amount;
  }

  #formatQuestActionAmount(config, amount = this.#questActionAmount) {
    const value = amount == null ? config.min : BigInt(amount);
    if (config.kind === 'tickets') return this.#ticketActionForSpend(value, config.price).count;
    if (config.kind === 'tickets-count') return value.toString();
    return _formatDgnQuestPerSpin(value, config.kind === 'eth' ? 7 : 8);
  }

  #parseQuestActionAmount(value) {
    const config = this.#questAdjustConfig();
    if (!config) return null;
    if (config.kind === 'tickets') {
      const entries = _parseQuarterTicketCount(value);
      if (entries == null || config.price == null) return null;
      return (config.price * entries + 3n) / 4n;
    }
    if (config.kind === 'tickets-count') {
      if (!/^\s*\d+\s*$/.test(String(value ?? ''))) return null;
      try {
        const count = BigInt(String(value).trim());
        return count > 0n ? count : null;
      } catch (_e) { return null; }
    }
    return _parseDgnQuestAmount(value, config.kind === 'eth' ? 7 : 8);
  }

  #stepQuestAction(direction) {
    const config = this.#questAdjustConfig();
    if (!config || ![-1, 1].includes(Number(direction))) return;
    const current = this.#questActionAmount == null
      ? (config.required > config.min ? config.required : config.min)
      : this.#questActionAmount;
    this.#questActionAmount = Number(direction) > 0
      ? current + config.step
      : (current > config.min + config.step - 1n ? current - config.step : config.min);
    this.#renderQuestDialog();
  }

  #stepQuestDgn(kind, direction) {
    const model = this.#questDialogModel;
    if (!model || ![-1, 1].includes(Number(direction))) return;
    const type = Number(model.questType);
    if (type !== 7 && type !== 8) return;
    if (kind === 'bet') {
      const floor = this.#questDgnMinPerSpin(type);
      const current = this.#questDgnPerSpin > 0n ? this.#questDgnPerSpin : floor;
      const next = Number(direction) > 0
        ? current + floor
        : (current > floor ? current - floor : floor);
      this.#questDgnPerSpin = next < floor ? floor : next;
    } else {
      const max = degeneretteLimits(type === 7 ? 0 : 1)?.maxSpins ?? 5;
      this.#questDgnSpins = Math.max(
        1,
        Math.min(max, Math.trunc(this.#questDgnSpins || 5) + Number(direction)),
      );
      // Keep the preset sufficient for the remaining quest after changing the
      // number of spins. The player can still increase the per-spin wager.
      this.#questDgnPerSpin = this.#questDgnDefaultPerSpin(model);
    }
    this.#renderQuestDialog();
  }

  #questTicketPrice(model) {
    let level = Number(model?.level);
    if (!Number.isInteger(level) || level < 0) level = activeTicketLevel(this.#gameState);
    if (!Number.isInteger(level) || level < 0) return null;
    try { return scaledTicketPriceWei(level); } catch (_e) { return null; }
  }

  #ticketActionForSpend(spend, price) {
    if (price == null || price <= 0n) return { count: '1', cost: spend };
    const entries = spend > 0n
      ? (spend * 4n + price - 1n) / price
      : 4n;
    const entryCount = entries > 0n ? entries : 1n;
    const whole = entryCount / 4n;
    const quarter = entryCount % 4n;
    const count = quarter === 0n
      ? whole.toString()
      : `${whole}.${String(Number(quarter) * 25).padStart(2, '0')}`.replace(/^0\./, '0.');
    return {
      count,
      cost: (price * entryCount + 3n) / 4n,
    };
  }

  #questAction(model = this.#questDialogModel) {
    const originalType = Number(model?.questType);
    const required = this.#remainingQuestTarget(model);
    const price = this.#questTicketPrice(model);
    const choice = originalType === 1 ? this.#questDialogChoice : 'ticket';
    const format = (type, amount) => _fmtDailyQuestAmount(type, amount);
    const selected = this.#questActionAmount;

    if (originalType === 1 && choice === 'lootbox') {
      const base = required < LOOTBOX_MIN_WEI ? LOOTBOX_MIN_WEI : required;
      const cost = selected == null ? base : (selected < LOOTBOX_MIN_WEI ? LOOTBOX_MIN_WEI : selected);
      return {
        label: `BUY LOOTBOX · ${format(1, cost)}`,
        target: cost,
        purchaseKind: 'lootbox',
        completes: cost >= required,
        adjustable: true,
      };
    }
    if (originalType === 1) {
      const ticket = this.#ticketActionForSpend(selected == null ? required : selected, price);
      return {
        label: `BUY ${ticket.count} ${ticket.count === '1' ? 'TICKET' : 'TICKETS'} · ${format(1, ticket.cost)}`,
        target: ticket.cost,
        purchaseKind: 'ticket',
        completes: ticket.cost >= required,
        adjustable: price != null,
      };
    }
    if (originalType === 2) {
      const target = selected == null ? required : selected;
      return { label: `ADD BET · ${format(2, target)}`, target, completes: target >= required, adjustable: true };
    }
    if (originalType === 4) {
      const cost = price == null ? null : price * 10n;
      return {
        label: cost == null ? 'ADD FOIL PACK' : `ADD FOIL PACK · ${format(1, cost)}`,
        target: required,
        completes: true,
      };
    }
    if (originalType === 5) {
      const target = selected == null ? required : selected;
      return { label: `BURN · ${format(5, target)}`, target, completes: target >= required, adjustable: true };
    }
    if (originalType === 6) {
      const base = required < LOOTBOX_MIN_WEI ? LOOTBOX_MIN_WEI : required;
      const cost = selected == null ? base : (selected < LOOTBOX_MIN_WEI ? LOOTBOX_MIN_WEI : selected);
      return {
        label: `BUY LOOTBOX · ${format(6, cost)}`, target: cost,
        completes: cost >= required, adjustable: true,
      };
    }
    if (originalType === 7 || originalType === 8) {
      const spinCount = Math.max(1, Math.trunc(this.#questDgnSpins || 5));
      const amountPerSpin = this.#questDgnPerSpin > 0n
        ? this.#questDgnPerSpin
        : this.#questDgnDefaultPerSpin(model);
      const total = amountPerSpin * BigInt(spinCount);
      return {
        label: `DEGENERETTE · ${spinCount} SPINS · ${format(originalType, total)}`,
        target: total,
        amountPerSpin,
        spinCount,
        completes: total >= required
          && amountPerSpin >= this.#questDgnMinPerSpin(originalType)
          && spinCount <= (degeneretteLimits(originalType === 7 ? 0 : 1)?.maxSpins ?? spinCount),
      };
    }
    if (originalType === 9) {
      const target = selected == null ? required : selected;
      return {
        label: `REDEEM ${target.toLocaleString('en-US')} ${target === 1n ? 'TICKET' : 'TICKETS'} · ${(target * 1_000n).toLocaleString('en-US')} FLIP`,
        target,
        completes: target >= required,
        adjustable: true,
      };
    }
    return { label: 'SET UP QUEST', target: required, completes: true };
  }

  #openQuestDialog(model, returnFocus) {
    const dialog = this.querySelector('[data-bind="qst-action-dialog"]');
    if (!dialog) return;
    this.#questDialogModel = { ...model };
    this.#questDialogChoice = 'ticket';
    this.#resetQuestActionAmount();
    this.#prepareQuestDgnDraft(this.#questDialogModel);
    this.#questDialogReturnFocus = returnFocus || null;
    this.#renderQuestDialog();
    dialog.hidden = false;
    dialog.removeAttribute?.('hidden');
    try { this.querySelector('[data-bind="qst-action-confirm"]')?.focus?.({ preventScroll: true }); }
    catch (_e) { /* fakeDOM */ }
  }

  #renderQuestDialog() {
    const model = this.#questDialogModel;
    if (!model) return;
    const role = this.querySelector('[data-bind="qst-action-role"]');
    const title = this.querySelector('[data-bind="qst-action-title"]');
    const copy = this.querySelector('[data-bind="qst-action-copy"]');
    const choice = this.querySelector('[data-bind="qst-action-choice"]');
    const ticket = this.querySelector('[data-bind="qst-action-ticket"]');
    const lootbox = this.querySelector('[data-bind="qst-action-lootbox"]');
    const adjust = this.querySelector('[data-bind="qst-action-adjust"]');
    const adjustInput = this.querySelector('[name="qst-action-amount"]');
    const adjustLabel = this.querySelector('[data-bind="qst-action-adjust-label"]');
    const adjustNeeded = this.querySelector('[data-bind="qst-action-adjust-needed"]');
    const adjustUnit = this.querySelector('[data-bind="qst-action-adjust-unit"]');
    const dgn = this.querySelector('[data-bind="qst-action-dgn"]');
    const dgnBet = this.querySelector('[name="qst-action-dgn-bet"]');
    const dgnSpins = this.querySelector('[name="qst-action-dgn-spins"]');
    const dgnUnit = this.querySelector('[data-bind="qst-action-dgn-unit"]');
    const dgnBetLimit = this.querySelector('[data-bind="qst-action-dgn-bet-limit"]');
    const dgnSpinsLimit = this.querySelector('[data-bind="qst-action-dgn-spins-limit"]');
    const requirement = this.querySelector('[data-bind="qst-action-requirement"]');
    const confirm = this.querySelector('[data-bind="qst-action-confirm"]');
    const hasPurchaseChoice = Number(model.questType) === 1;
    const isDgn = Number(model.questType) === 7 || Number(model.questType) === 8;
    // Ticket/lootbox purchase quests retain their useful product + amount
    // picker. Degenerette retains its ticket, per-spin wager, and spin count.
    // Every other quest is a one-click preset, so an amount stepper only adds
    // noise and makes the confirmation sheet feel like a second game form.
    const adjustConfig = hasPurchaseChoice ? this.#questAdjustConfig(model) : null;
    const action = this.#questAction(model);
    if (role) role.textContent = `${String(model.role || 'QUEST')} QUEST`;
    if (title) title.textContent = String(model.label || 'Complete quest');
    if (copy) {
      const type = Number(model.questType);
      if (isDgn) {
        copy.textContent = 'Choose the bet per spin and number of spins, then confirm.';
      } else if (hasPurchaseChoice) {
        copy.textContent = 'Choose tickets or a lootbox and the amount, then confirm.';
      } else if (type === 2) {
        copy.textContent = `Add ${_fmtDailyQuestAmount(2, action.target)} to Tomorrow's Bet.`;
      } else if (type === 4) {
        copy.textContent = 'Add one foil pack to your next ticket purchase.';
      } else if (type === 5) {
        copy.textContent = `Burn ${_fmtDailyQuestAmount(5, action.target)} in the Decimator.`;
      } else if (type === 6) {
        copy.textContent = `Buy a ${_fmtDailyQuestAmount(6, action.target)} lootbox.`;
      } else if (type === 9) {
        copy.textContent = `Redeem ${BigInt(action.target ?? 0n).toLocaleString('en-US')} ticket${BigInt(action.target ?? 0n) === 1n ? '' : 's'} for FLIP.`;
      } else {
        copy.textContent = 'Confirm to open the matching quest action.';
      }
    }
    if (choice) choice.hidden = !hasPurchaseChoice;
    if (ticket) {
      ticket.textContent = 'TICKET';
      ticket.classList?.toggle('is-selected', this.#questDialogChoice === 'ticket');
      ticket.setAttribute?.('aria-pressed', String(this.#questDialogChoice === 'ticket'));
    }
    if (lootbox) {
      lootbox.textContent = 'LOOTBOX';
      lootbox.classList?.toggle('is-selected', this.#questDialogChoice === 'lootbox');
      lootbox.setAttribute?.('aria-pressed', String(this.#questDialogChoice === 'lootbox'));
    }
    if (adjust) adjust.hidden = !adjustConfig;
    if (adjustConfig) {
      if (adjustInput) {
        adjustInput.value = this.#formatQuestActionAmount(adjustConfig);
        adjustInput.min = this.#formatQuestActionAmount(adjustConfig, adjustConfig.min);
        adjustInput.step = adjustConfig.kind === 'tickets' ? '0.25'
          : adjustConfig.kind === 'tickets-count' ? '1'
            : this.#formatQuestActionAmount(adjustConfig, adjustConfig.step);
      }
      if (adjustLabel) adjustLabel.textContent = adjustConfig.label;
      if (adjustUnit) adjustUnit.textContent = adjustConfig.unit;
      if (adjustNeeded) {
        const needed = adjustConfig.kind === 'tickets'
          ? this.#ticketActionForSpend(adjustConfig.required, adjustConfig.price).count
          : this.#formatQuestActionAmount(adjustConfig, adjustConfig.required);
        adjustNeeded.textContent = `NEEDED ${needed}${adjustConfig.unit ? ` ${adjustConfig.unit}` : ''}`;
      }
    }
    if (dgn) dgn.hidden = !isDgn;
    if (isDgn) {
      const currency = Number(model.questType) === 7 ? 0 : 1;
      const limits = degeneretteLimits(currency);
      const traits = dgnTraitIdsToQuadrants(this.#questDgnTraitIds);
      applyDgnTicketAccent(
        this.querySelector('.qst-action-dgn__ticket'),
        this.#questDgnTraitIds,
      );
      for (let q = 0; q < 4; q += 1) {
        const trait = traits[q];
        const image = this.querySelector(`[data-bind="qst-action-dgn-img-${q}"]`);
        const cell = this.querySelector(`[data-bind="qst-action-dgn-cell-${q}"]`);
        if (image && trait) {
          image.src = dgnBadgePath(q, trait.sym, trait.col);
          image.alt = `Quadrant ${q + 1} trait`;
        }
        cell?.classList?.toggle('q-hero', q === this.#questDgnHero);
      }
      if (dgnBet) {
        dgnBet.value = _formatDgnQuestPerSpin(this.#questDgnPerSpin, model.questType);
        dgnBet.min = _formatDgnQuestPerSpin(this.#questDgnMinPerSpin(model.questType), model.questType);
        dgnBet.step = dgnBet.min;
      }
      if (dgnSpins) {
        dgnSpins.value = String(this.#questDgnSpins);
        dgnSpins.max = String(limits?.maxSpins ?? 5);
      }
      if (dgnUnit) dgnUnit.textContent = limits?.unit || '';
      if (dgnBetLimit) dgnBetLimit.textContent = `MIN ${limits?.minLabel || '—'}`;
      if (dgnSpinsLimit) dgnSpinsLimit.textContent = `MAX ${limits?.maxSpins ?? 5}`;
    }
    if (requirement) requirement.textContent = action.label;
    if (copy && model.isGated) {
      copy.textContent = 'Complete the daily quest first. You can still preview the exact action here.';
    }
    if (confirm) {
      const completes = action.completes !== false;
      const blocked = Boolean(model.isGated);
      confirm.classList?.toggle('is-incomplete', !completes);
      confirm.disabled = blocked;
      confirm.textContent = blocked
        ? `DAILY QUEST FIRST · ${action.label}`
        : completes && !isDgn && !hasPurchaseChoice
          ? 'CONFIRM'
          : `${completes ? 'CONFIRM' : "WON'T COMPLETE"} · ${action.label}`;
      confirm.setAttribute?.('title', completes
        ? (blocked
          ? 'Complete the daily quest before submitting this bonus quest action.'
          : 'This action meets the remaining quest requirement.')
        : 'You can still submit this amount, but it will not complete the quest.');
    }
  }

  #confirmQuestDialog() {
    const model = this.#questDialogModel;
    if (!model || model.isGated
      || typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') return;
    const action = this.#questAction(model);
    const detail = {
      questType: Number(model.questType),
      target: String(action.target ?? 0n),
      variant: String(model.variant || 'daily'),
      submit: true,
      ...(action.adjustable ? { configuredAmount: true } : {}),
      ...(model.level != null ? { level: Number(model.level) } : {}),
      ...(action.purchaseKind ? { purchaseKind: action.purchaseKind } : {}),
      ...(Number(model.questType) === 7 || Number(model.questType) === 8 ? {
        amountPerSpin: String(action.amountPerSpin ?? 0n),
        spinCount: Number(action.spinCount ?? 5),
        traitIds: [...(this.#questDgnTraitIds || [])],
        heroQuadrant: this.#questDgnHero,
      } : {}),
    };
    try {
      let activation;
      if (typeof CustomEvent === 'function') {
        activation = new CustomEvent('quest:activate', { detail });
      } else {
        activation = new Event('quest:activate');
        Object.defineProperty(activation, 'detail', { configurable: true, value: detail });
      }
      document.dispatchEvent(activation);
    } catch (_e) { /* detached/headless document */ }
    this.#closeQuestDialog({ restoreFocus: false });
  }

  #closeQuestDialog({ restoreFocus = true } = {}) {
    const dialog = this.querySelector?.('[data-bind="qst-action-dialog"]');
    if (dialog) {
      dialog.hidden = true;
      dialog.setAttribute?.('hidden', '');
    }
    const returnFocus = this.#questDialogReturnFocus;
    this.#questDialogModel = null;
    this.#questActionAmount = null;
    this.#questDgnPerSpin = 0n;
    this.#questDgnTraitIds = null;
    this.#questDgnHero = 0;
    this.#questDialogReturnFocus = null;
    if (restoreFocus) {
      try { returnFocus?.focus?.({ preventScroll: true }); } catch (_e) { /* fakeDOM */ }
    }
  }

  #questDgnMinPerSpin(questType) {
    const currency = Number(questType) === 7 ? 0 : 1;
    const limits = degeneretteLimits(currency);
    if (!limits) return 0n;
    return currency === 0
      ? limits.minBetFullScale / BigInt(ETH_DIVISOR)
      : limits.minBetFullScale;
  }

  #questDgnDefaultPerSpin(model) {
    const spins = BigInt(Math.max(1, Math.trunc(this.#questDgnSpins || 5)));
    const remaining = this.#remainingQuestTarget(model);
    const divided = remaining > 0n ? (remaining + spins - 1n) / spins : 0n;
    const floor = this.#questDgnMinPerSpin(model?.questType);
    return divided < floor ? floor : divided;
  }

  #prepareQuestDgnDraft(model) {
    const type = Number(model?.questType);
    if (type !== 7 && type !== 8) {
      this.#questDgnPerSpin = 0n;
      this.#questDgnTraitIds = null;
      this.#questDgnHero = 0;
      return;
    }
    this.#questDgnSpins = 5;
    this.#questDgnPerSpin = this.#questDgnDefaultPerSpin(model);
    let draft = null;
    try {
      draft = document.querySelector('app-degenerette-panel')?.getTicketDraft?.() || null;
    } catch (_e) { draft = null; }
    const supplied = Array.isArray(draft?.traitIds) ? draft.traitIds.map(Number) : [];
    const decoded = dgnTraitIdsToQuadrants(supplied);
    const complete = supplied.length === 4 && decoded.every(Boolean);
    this.#questDgnTraitIds = complete
      ? decoded.map((trait, q) => ((q & 3) << 6) | ((trait.col & 7) << 3) | (trait.sym & 7))
      : [0, 73, 146, 219];
    const hero = Number(draft?.heroQuadrant);
    this.#questDgnHero = Number.isInteger(hero) && hero >= 0 && hero < 4 ? hero : 0;
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
      this.#resetQuestCompletionState();
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
      this.#resetQuestCompletionState();
      this.#questData = null;
      this.#questStreak = null;
      this.#scoreBreakdown = null;
      this.#levelQuest = null;
      this.#renderEmpty('Connect a wallet to see your quests.');
      return;
    }

    try {
      // Two quest sources, deliberately. /player/:addr carries quest_progress, which
      // only has a row once THIS player has progressed a quest — driving the
      // panel from it alone showed whatever they last touched, forever (the
      // reported bug: "daily quest is always affiliate and green" — a completed
      // day-241 affiliate row still on screen at day 279). The day's actual two
      // slots come from /game/quests/day/:day, which is player-independent.
      // /game/state is routing metadata only: it tells a foil quest which level
      // a purchase made now will actually enter.
      const day = this.#currentDay();
      const [data, defs, gameState, liveBoard] = await Promise.all([
        // A wallet does not have a /player row until the indexer observes its
        // first event. That 404 is normal for a new player and must not throw
        // away the deployment-local quest board we can read directly from the
        // contract. DB-only extras (score breakdown / unified afKing streak)
        // remain empty until the row appears on a later poll.
        fetchJSON(`/player/${addr}`).catch(() => null),
        day != null ? fetchJSON(`/game/quests/day/${day}`).catch(() => null) : Promise.resolve(null),
        fetchJSON('/game/state').catch(() => null),
        readLiveQuestBoard(addr).catch(() => null),
      ]);
      if (signal.aborted) return;
      // Daily/level quest state is deployment-local. Prefer the live contract
      // board so reused deterministic addresses cannot inherit completion,
      // streak, or afKing flags from an older indexer database.
      this.#questData = Array.isArray(liveBoard?.quests)
        ? liveBoard.quests
        : (Array.isArray(data?.quests) ? data.quests : null);
      this.#questDefs = Array.isArray(liveBoard?.quests)
        ? liveBoard.quests
        : (Array.isArray(defs?.quests) ? defs.quests : null);
      this.#questDay = liveBoard?.day || defs?.day || day || null;
      // GAME supplies the exact deployment-local headline score and, for a
      // live afKing subscriber, the packed streak used to calculate it. Keep a
      // coherent indexed breakdown when one exists; otherwise show only the
      // contract-known components instead of blanking the whole HUD.
      const identity = mergeQuestIdentitySnapshot(data, liveBoard);
      this.#questStreak = identity.questStreak;
      this.#scoreBreakdown = identity.scoreBreakdown;
      this.#levelQuest = liveBoard?.levelQuest && typeof liveBoard.levelQuest === 'object'
        ? liveBoard.levelQuest
        : data?.levelQuest && typeof data.levelQuest === 'object'
          ? data.levelQuest
        : null;
      if (gameState && typeof gameState === 'object') this.#gameState = gameState;
      this.#afkingActive = identity.afkingActive;
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
  // Completion feedback is transition-only; an already-complete initial load
  // remains quiet and static.
  // ---------------------------------------------------------------------

  #resetQuestCompletionState() {
    this.#questCompletionIdentity = null;
    this.#questCompletionState.clear();
  }

  #captureQuestCompletions(sorted, day) {
    const identity = this.#pinnedAddress
      ? String(this.#pinnedAddress).toLowerCase()
      : null;
    if (!identity) {
      this.#resetQuestCompletionState();
      return { dailyKeys: new Map(), levelKey: null, newlyCompleted: new Set() };
    }
    if (identity !== this.#questCompletionIdentity) {
      this.#questCompletionIdentity = identity;
      this.#questCompletionState.clear();
    }

    const dailyKeys = new Map();
    const newlyCompleted = new Set();
    const observe = (key, completed) => {
      const previous = this.#questCompletionState.get(key);
      if (completed && previous === false) newlyCompleted.add(key);
      // Completion is monotonic inside a day/level. A stale RPC response must
      // not arm the same celebration for a second time.
      if (previous !== true) this.#questCompletionState.set(key, Boolean(completed));
    };

    for (const quest of sorted) {
      const slot = Number(quest?.slot ?? 0);
      const key = `${identity}:day:${day}:slot:${slot}`;
      dailyKeys.set(slot, key);
      observe(key, Boolean(quest?.completed));
    }

    const level = this.#levelQuest;
    const levelType = Number(level?.questType ?? 0);
    const levelKey = level && levelType > 0
      ? `${identity}:level:${Number(level?.level ?? -1)}:type:${levelType}`
      : null;
    if (levelKey) observe(levelKey, Boolean(level?.completed));
    return { dailyKeys, levelKey, newlyCompleted };
  }

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
    // The last resolved draw describes where THAT DAY'S tickets were bought;
    // on the first purchase day of a new level it necessarily points one level
    // behind the live purchase route. Using it for a foil quest made the buy
    // panel check the prior level, find the prior foil pack, and hide the new
    // quest-completing pack. Prefer the contract-equivalent route from the live
    // /game/state payload. The last-day value remains only a degraded fallback.
    const livePurchaseLevel = activeTicketLevel(this.#gameState);
    const rawLastDayPurchaseLevel = Number(get('app.lastDay')?.roll1?.purchaseLevel);
    const fallbackPurchaseLevel = Number.isInteger(rawLastDayPurchaseLevel)
      && rawLastDayPurchaseLevel >= 0
      ? rawLastDayPurchaseLevel
      : null;
    const purchaseLevel = livePurchaseLevel ?? fallbackPurchaseLevel;

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

    // A LEVEL slot is always rendered below. If its DB projection is briefly
    // unavailable it carries a compact syncing state, so the panel does not
    // misleadingly look as though this level has no quest.
    emptyEl.hidden = true;

    // Render each slot — sorted by slot index ascending (slot 0 primary, slot 1
    // secondary; matches /beta/components/quest-panel.js convention).
    const sorted = [...slots].sort((a, b) => Number(a?.slot ?? 0) - Number(b?.slot ?? 0));
    const completion = this.#captureQuestCompletions(sorted, day);

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
        progress: s?.progress ?? 0,
        target: s?.target ?? 0,
        level: questTypeRaw === 4 ? purchaseLevel : null,
        justCompleted: completion.newlyCompleted.has(completion.dailyKeys.get(slotIndex)),
      });
    }

    this.#appendLevelQuestCard(slotsEl, {
      justCompleted: completion.levelKey != null
        && completion.newlyCompleted.has(completion.levelKey),
    });

    // Streak — textContent only.
    const streakValue = this.#questStreak?.baseStreak ?? 0;
    streakEl.textContent = String(streakValue);
    this.#renderScoreBreakdown();
    if (completion.newlyCompleted.size > 0) {
      try { sfxQuestComplete(); } catch (_e) { /* decoration must not stop polling */ }
    }
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
    const scoreTier = degenScoreLootTier(points);
    if (scoreTier) valueEl.setAttribute('data-score-tier', scoreTier);
    else valueEl.removeAttribute('data-score-tier');
    headEl.textContent = points == null
      ? 'No Degen Score yet'
      : `Degen Score · ${points.toLocaleString('en-US')}%`;

    if (typeof rowsEl.replaceChildren === 'function') rowsEl.replaceChildren();
    else { rowsEl.children = []; rowsEl._innerHTML = ''; }

    if (score) {
      const rows = SCORE_COMPONENTS
        .filter((component) => !score.liveOnly
          || Object.prototype.hasOwnProperty.call(score, component.key))
        .map((component) => ({
          key: component.key,
          label: component.label,
          points: component.key === 'questStreakPoints'
            ? questStreakScorePoints(score)
            : _scoreNumber(score[component.key]),
        }));
      if (score.passBonus && _scoreNumber(score.passBonus.points) !== 0) {
        rows.push({
          key: 'passBonusPoints',
          label: 'Pass bonus',
          points: _scoreNumber(score.passBonus.points),
        });
      }
      const curse = _scoreNumber(score.cursePoints);
      if (curse !== 0) {
        rows.push({ key: 'cursePoints', label: 'Cashout curse', points: curse, negative: true });
      }

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
        const fillPercent = Math.round(
          degenScoreBreakdownBarPercent(model.key, model.points) * 10,
        ) / 10;
        fill.style.width = `${fillPercent}%`;
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

  #appendLevelQuestCard(slotsEl, { justCompleted = false } = {}) {
    const quest = this.#levelQuest;
    if (!quest) {
      this.#appendQuestCard(slotsEl, {
        variant: 'level',
        role: 'LEVEL',
        roleLabel: 'Level',
        label: 'Awaiting quest data',
        icon: 'L',
        statusText: 'SYNC',
        statusKind: 'locked',
        stateLabel: 'Waiting for the indexed level quest',
        progressPercent: 0,
        isDone: false,
        isGated: true,
        rewardText: '800 FLIP',
        rewardExtraText: '+5 STREAK',
        rewardTitle: 'Completion credits 800 FLIP and adds 5 to the quest streak',
        questType: 0,
        progress: 0,
        target: 0,
      });
      return;
    }
    const questType = Number(quest.questType ?? 0);
    const assigned = questType > 0;
    const isDone = Boolean(quest.completed);
    // Contract eligibility gates COMPLETION only. Progress still accumulates
    // while this is false, so the card must remain active/clickable instead of
    // looking like the quest itself is unavailable.
    const completionLocked = assigned && !quest.eligible && !isDone;
    const progress = quest.progress ?? 0;
    const target = quest.target ?? 0;
    // Absent on older API builds — default to true so an unknown field never blanks the bar.
    const progressAvailable = quest.progressAvailable !== false;
    const label = assigned ? (QUEST_TYPE_LABELS[questType] || 'Level quest') : 'Next level quest';
    const passKind = String(this.#scoreBreakdown?.passBonus?.kind || '').toLowerCase();
    const streak = Number(this.#questStreak?.baseStreak ?? 0);
    const loyaltyQualified = Boolean(passKind) || (Number.isFinite(streak) && streak >= 5);
    const loyaltyLabel = passKind === 'deity'
      ? 'Deity pass recognized'
      : passKind
        ? 'Pass recognized'
        : loyaltyQualified
          ? 'Quest streak recognized'
          : '';
    const completionGateLabel = completionLocked
      ? loyaltyQualified
        ? this.#afkingActive
          ? `${loyaltyLabel}; progress banks now, and the next qualifying afKing purchase clears the activity prerequisite`
          : `${loyaltyLabel}; progress banks now, and one ticket-price of current-level ticket or lootbox activity clears the reward prerequisite`
        : 'Progress banks now; completion also needs current-level purchase activity plus a 5-day streak or pass'
      : '';

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
    } else if (!progressAvailable) {
      // Affiliate level quests only: the API cannot derive per-player progress from events
      // (the credit goes to a rolled winner on a kickback-adjusted base), so it sends
      // progressAvailable:false with progress 0. Show the target, not a fake empty bar.
      statusText = `TARGET ${_fmtLevelQuestAmount(questType, target)}`;
      statusKind = 'progress';
      stateLabel = `Target ${_fmtLevelQuestAmount(questType, target)}; progress is not tracked for this quest${completionGateLabel ? `; ${completionGateLabel}` : ''}`;
    } else {
      statusText = `${_fmtLevelQuestAmount(questType, progress)} / ${_fmtLevelQuestAmount(questType, target)}`;
      statusKind = 'progress';
      stateLabel = `${_fmtLevelQuestAmount(questType, progress)} of ${_fmtLevelQuestAmount(questType, target)}${completionGateLabel ? `; ${completionGateLabel}` : ''}`;
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
      isGated: !assigned,
      rewardText: '800 FLIP',
      rewardExtraText: '+5 STREAK',
      rewardTitle: completionGateLabel
        ? `Completion credits 800 FLIP and adds 5 to the quest streak. ${completionGateLabel}`
        : 'Completion credits 800 FLIP and adds 5 to the quest streak',
      questType,
      progress,
      target,
      level: quest.level,
      justCompleted,
    });
  }

  #appendQuestCard(slotsEl, model) {
    const slotDiv = document.createElement('div');
    slotDiv.className = 'qst-slot';
    slotDiv.classList.add(`qst-slot--${model.variant}`);
    if (model.isDone) slotDiv.classList.add('qst-slot--completed');
    if (model.justCompleted) slotDiv.classList.add('qst-slot--just-completed');
    if (model.isAuto) slotDiv.classList.add('qst-slot--auto');
    if (!model.isDone) slotDiv.classList.add('qst-slot--todo');
    if (model.isUnstarted) slotDiv.classList.add('qst-slot--unstarted');
    if (model.isGated) slotDiv.classList.add('qst-slot--gated');
    const interactive = !model.isDone
      && QUEST_SETUP_TYPES.has(Number(model.questType));
    const actionable = interactive && !model.isGated;
    if (interactive) {
      slotDiv.classList.add(actionable ? 'qst-slot--actionable' : 'qst-slot--explainable');
      slotDiv.setAttribute('role', 'button');
      slotDiv.setAttribute('tabindex', '0');
      const activate = () => {
        this.#openQuestDialog(model, slotDiv);
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
      // The split red/green coin is the FLIP currency mark. Keep the all-red
      // flame reserved for Degenerus protocol branding elsewhere in the UI.
      rewardLogo.src = '/whitepaper/flame-logo-split.svg';
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

    const aria = `${model.roleLabel} quest: ${model.label}. ${model.stateLabel}.${interactive ? ' Open its action setup.' : ''}`;
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
