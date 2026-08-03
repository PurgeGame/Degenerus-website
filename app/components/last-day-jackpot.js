// /app/components/last-day-jackpot.js — Phase 59 shell, rebuilt Phase 64.
//
// The widget is now a thin PLAYER-CENTRIC shell around the beta
// <replay-panel> (the working spin + scratch reveal from the GT paper demo,
// mounted as a sibling in app/index.html):
//
//   - pins the last resolved day from app.lastDay (polling.js) and BRIDGES
//     (pinned day, viewed player) into the replay-panel's own selects —
//     the panel then runs its slot-machine spin with live per-quadrant
//     ownership lighting and scratch-off prize reveals;
//   - listens for the panel's `replay:scratch-complete` (all owned quadrants
//     + center scratched — NOT mere spin end, which would spoil unscratched
//     prizes) to write the spun_day spoiler key, fire confetti when the
//     viewed player won, light up the foil strip, and dispatch
//     `jackpot:revealed` (winnings banner signal);
//   - renders the compact day shell and publishes earned foil-match claims to
//     the shared pending tray (no winner-address dumps or inline foil strip).
//
// Phase 59 relics removed in the rebuild: the roll1/roll2 data grids, the
// Replay state machine, winner classification lists, and the winner summary
// table (the "Type/Win/Uniq/Spread" spam).

import { subscribe, get, getViewedAddress } from '../app/store.js';
import { formatEth, formatFlip } from '../../beta/viewer/utils.js';
import { CHAIN } from '../app/chain-config.js';
// Phase 64 — foil-ticket matching: pure grading helpers + the indexer base URL
// (API_BASE cross-import only, mirroring polling.js Pitfall 5 discipline).
import {
  claimableDrawGrades,
  FOIL_CLAIM_THRESHOLD,
  unpackWinSet,
} from '../app/foil-match.js';
import { API_BASE } from '../../beta/app/constants.js';
// Reveal-engine wiring: the viewed player's jackpot winnings auto-play a
// celebration sequence; a claimed foil match reveals its payout box-spin.
import { queueReveal } from './reveal-overlay.js';
import {
  claimFoilMatch,
  FOIL_TIER_FACES,
  parseFoilMatchClaimedFromReceipt,
} from '../app/foil-claim.js';
import { parseOpenLegsFromReceipt } from '../app/lootbox-legs.js';
import { readResolvedCoinflipStake } from '../app/coinflip.js';
import { loadDayLootboxResults } from '../app/day-lootbox-results.js';
import { publishPendingActions, clearPendingActions } from '../app/pending-actions.js';

const FOIL_MATCH_ACTION_SOURCE = 'foil-match';

function _isExactDayPayload(payload, day, player) {
  const expectedDay = Number(day);
  const actualDay = Number(payload?.day);
  if (!Number.isInteger(expectedDay) || actualDay !== expectedDay) return false;
  const payloadPlayer = String(payload?.address || payload?.player || '').toLowerCase();
  return !payloadPlayer || payloadPlayer === String(player || '').toLowerCase();
}

// Testnet contracts hold /1M-scaled ETH wei; FLIP/DGNRS are UNSCALED.
//
// This used to pre-multiply by ETH_DIVISOR because beta's formatEth was pinned at a
// 1n display scale and would otherwise floor every ETH amount to "0". That formatter
// now applies the ETH scale itself (beta/viewer/utils.js, fixed 2026-07-28 — the same
// 1n bug was making the draw board's per-quadrant amounts read "0 ETH"), so
// compensating here would double-scale and render 0.03 ETH as 30000.00.
// Kept as a named wrapper rather than inlining formatEth: it is the single chokepoint
// for "this string is an ETH amount", and it keeps the BigInt parse guard.
const fmtEthScaled = (weiStr) => {
  try { BigInt(weiStr || '0'); } catch { return '0'; }
  return formatEth(String(weiStr || '0'));
};

// FLIP display (UNSCALED 18-dec) — beta formatFlip keeps sub-1-FLIP amounts
// visible as decimals instead of flooring to "0 FLIP" (user-reported).

// Bridge cadence: the replay-panel populates its <select> options
// asynchronously; the bridge retries until both selects accept the target
// values (mirrors play/app/replay-panel-sync.js).
const BRIDGE_RETRY_MS = 500;
const BRIDGE_MAX_ATTEMPTS = 60;

class LastDayJackpot extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  // The player may browse an older day, but a genuinely newer resolved day
  // automatically becomes the active day. latestDaySeen distinguishes that
  // event from routine same-day polling, so historical browsing does not snap
  // back on every refresh.
  #pinnedDay = null;
  #pinnedLevel = null;
  #latestDaySeen = null;
  #lastPayload = null;
  #hasNewDayAvailable = false; // Legacy banner fallback; normal flow auto-follows.
  #winners = [];
  // Phase 64 — foil strip state + panel bridge state.
  #foilData = null;
  #foilDataKey = null;
  #foilSeq = 0;
  #bridgeTimer = null;
  #bridgeAttempts = 0;
  #scratchCompleteListener = null;
  #foilClaimBusy = false; // one in-flight foil claim at a time
  #locallyClaimedFoilMatches = new Set(); // bridge tx receipt → indexer catch-up
  // --- "Whole board played out" gates for the results CTA (user call: the
  //     main UI — every scratch roll AND the coin flip — plays out first;
  //     the full-reveal popup sits behind a button, never auto-pops). ---
  #boardDone = false;        // final scratch-complete seen (bonus done or none)
  #sawScratchEvent = false;  // distinguishes live play from a reloaded spun day
  #flipResult;               // /game/coinflip/day/:day — undefined unknown, null no-row (gate waived)
  #flipFetchedDay = null;
  #flipListener = null;
  // The CTA is re-parented into replay-panel's one action row, so a
  // this.querySelector() lookup stops finding it — hold the node instead.
  #resultsCtaEl = null;
  #summaryBusy = false;
  // A deliberate day pick is a request to watch that day's presentation again,
  // even when durable spoiler keys say it was played in an earlier session.
  // This is an in-memory override only: balances/claims keep their honest
  // durable completion state while the draw and flip become replayable.
  #manualReplayDay = null;
  #historyMetadataSeq = 0;
  #historyPrevListener = null;
  #historyNextListener = null;

  #showContent() {
    if (this.#loaded) return;
    this.#loaded = true;
    this.querySelector('[data-bind="skeleton"]')?.remove();
    const el = this.querySelector('[data-bind="content"]');
    if (el) el.style.display = '';
  }

  #setJackpotLoadStatus(text = '') {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const status = document.querySelector('[data-bind="jackpot-load-status"]');
    if (!status) return;
    status.textContent = String(text || '');
    status.setAttribute('aria-hidden', text ? 'false' : 'true');
  }

  // ---------------------------------------------------------------------------
  // Plan 59-03: localStorage spin-idempotency (chainId-scoped per Pitfall B).
  // All ops try/catch wrapped (Pitfall F — private browsing / QuotaExceededError).
  // Key shape: `spun_day_${CHAIN.id}_${this.#pinnedDay}` → '1' (truthy presence).
  // Phase 64: the key is written when the embedded replay-panel's reveal is
  // FULLY scratched (replay:scratch-complete) — spin end alone would spoil
  // still-covered prizes. It remains the claims-panel spoiler gate.
  // ---------------------------------------------------------------------------
  #spunKey() {
    return `spun_day_${CHAIN.id}_${this.#pinnedDay}`;
  }

  #boardCompleteKey() {
    return `jackpot_complete_day_${CHAIN.id}_${this.#pinnedDay}`;
  }

  #bonusPendingKey() {
    return `jackpot_bonus_pending_day_${CHAIN.id}_${this.#pinnedDay}`;
  }

  #hasSpunPinnedDay() {
    if (this.#pinnedDay == null) return false;
    try {
      return localStorage.getItem(this.#spunKey()) === '1';
    } catch {
      return false;  // private browsing / SecurityError → re-spin acceptable
    }
  }

  #markSpunPinnedDay() {
    if (this.#pinnedDay == null) return;
    try {
      localStorage.setItem(this.#spunKey(), '1');
    } catch {
      // QuotaExceededError / SecurityError — swallow; user re-spins next visit
    }
  }

  #hasCompletedPinnedDay() {
    if (this.#pinnedDay == null) return false;
    try { return localStorage.getItem(this.#boardCompleteKey()) === '1'; }
    catch { return false; }
  }

  #markCompletedPinnedDay() {
    if (this.#pinnedDay == null) return;
    try { localStorage.setItem(this.#boardCompleteKey(), '1'); }
    catch { /* private browsing: only this refresh loses the preferred view */ }
  }

  #markBonusPending(pending) {
    if (this.#pinnedDay == null) return;
    try {
      if (pending) localStorage.setItem(this.#bonusPendingKey(), '1');
      else localStorage.removeItem(this.#bonusPendingKey());
    } catch { /* same-tab event still carries the authoritative final state */ }
  }

  // ---------------------------------------------------------------------------
  // Plan 59-02: app.lastDay subscriber — drives 3-status branch rendering.
  // ---------------------------------------------------------------------------
  #onLastDayUpdate(payload) {
    if (!payload) return;  // first cycle 404 / undefined initial subscribe fire
    this.#lastPayload = payload;
    const parsedDay = payload.day == null ? null : Number(payload.day);
    const payloadDay = Number.isFinite(parsedDay) && parsedDay > 0 ? parsedDay : null;
    const isNewLatest = payloadDay != null
      && (this.#latestDaySeen == null || payloadDay > this.#latestDaySeen);
    if (isNewLatest) this.#latestDaySeen = payloadDay;

    if (this.#pinnedDay == null) {
      if (payloadDay != null) this.#adoptLatestDay(payload, false);
      else this.#renderForStatus(payload);
      return;
    }

    if (isNewLatest && payloadDay !== Number(this.#pinnedDay)) {
      this.#adoptLatestDay(payload, true);
      return;
    }

    if (payloadDay === Number(this.#pinnedDay)) {
      this.#renderForStatus(payload);
      return;
    }

    // A routine poll of the already-known latest day while the player is
    // deliberately browsing history is ignored. Only isNewLatest above
    // overrides a manual historical pin.
  }

  #adoptLatestDay(payload, resetGates) {
    this.#pinnedDay = Number(payload.day);
    this.#pinnedLevel = payload.level ?? null;
    this.#manualReplayDay = null;
    this.#hasNewDayAvailable = false;
    this.#hideNewDayBanner();
    this.#foilSeq += 1; // invalidate any older-day request still in flight
    this.#foilData = null;
    this.#foilDataKey = null;
    clearPendingActions(FOIL_MATCH_ACTION_SOURCE);
    this.#winners = [];
    if (resetGates) this.#resetDayGates();
    this.#renderForStatus(payload);
    this.#dispatchDaySelection(false);
  }

  #renderForStatus(payload) {
    this.#showContent();
    switch (payload.status) {
      case 'pre-game':            this.#renderColdStart(); break;
      case 'resolved-no-winners': this.#renderEmptyDay(payload.day); break;
      case 'resolved':            this.#renderResolvedDay(payload); break;
      default:                    this.#renderColdStart(); // defensive fallback
    }
    // These consumers all key off #pinnedDay. Updating them from the same
    // status dispatch prevents the old "label changed, board/flip did not"
    // partial-day state.
    this.#syncReplayPanel();
    this.#refreshFoil();
    this.#refreshFlipRow();
    this.#maybeShowResultsCta();
    this.#renderHistoryNav();
  }

  #renderColdStart() {
    const cold = this.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = this.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = this.querySelector('[data-bind="ldj-status-resolved"]');
    if (cold) cold.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (resolved) resolved.style.display = 'none';
    this.#setJackpotLoadStatus('(loading)');
  }

  #renderDeploymentMismatch(mismatch) {
    if (!mismatch) return;
    // A redeploy restarts logical day numbers. Drop the old run's monotonic
    // high-water mark so a repaired API can legitimately move from (for
    // example) old day 172 to new day 10 in the same browser session.
    this.#pinnedDay = null;
    this.#pinnedLevel = null;
    this.#latestDaySeen = null;
    this.#lastPayload = null;
    this.#hasNewDayAvailable = false;
    this.#foilSeq += 1;
    this.#foilData = null;
    this.#foilDataKey = null;
    clearPendingActions(FOIL_MATCH_ACTION_SOURCE);
    this.#winners = [];
    this.#resetDayGates();
    if (this.#bridgeTimer != null) {
      try { clearInterval(this.#bridgeTimer); } catch { /* defensive */ }
      this.#bridgeTimer = null;
    }
    this.#showContent();
    const cold = this.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = this.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = this.querySelector('[data-bind="ldj-status-resolved"]');
    if (cold) cold.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (resolved) resolved.style.display = 'none';
    const day = this.querySelector('[data-bind="day"]');
    if (day) day.textContent = 'SYNC';
    this.#setJackpotLoadStatus('(syncing)');
  }

  #renderEmptyDay(day) {
    const cold = this.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = this.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = this.querySelector('[data-bind="ldj-status-resolved"]');
    if (cold) cold.style.display = 'none';
    if (empty) empty.style.display = '';
    if (resolved) resolved.style.display = 'none';
    this.#setJackpotLoadStatus('');
    const copy = this.querySelector('[data-bind="ldj-empty-copy"]');
    if (copy) copy.textContent = `Day ${day} had no winners — pot rolled to day ${Number(day) + 1}.`;
    const dayLbl = this.querySelector('[data-bind="day"]');
    if (dayLbl) dayLbl.textContent = `Day ${day}`;
    this.#winners = [];
  }

  #renderResolvedDay(payload) {
    const cold = this.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = this.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = this.querySelector('[data-bind="ldj-status-resolved"]');
    if (cold) cold.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (resolved) resolved.style.display = '';
    this.#setJackpotLoadStatus('');

    if (!this.#hasNewDayAvailable) this.#hideNewDayBanner();

    const dayLbl = this.querySelector('[data-bind="day"]');
    if (dayLbl) dayLbl.textContent = `Day ${payload.day}`;

    this.#winners = Array.isArray(payload.winners) ? payload.winners : [];

  }

  // ---------------------------------------------------------------------------
  // Day stat — the winners/top-hit caption was REMOVED from the board on
  // 2026-07-29 (user call). It survives only as the subtitle on the popup's
  // NO HIT card, where the player has just been told they didn't win and the
  // day's actual scale is the point.
  // ---------------------------------------------------------------------------
  /** True when the board is pinned to a day other than the one the data is for. */
  #viewingPastDay() {
    const payloadDay = this.#lastPayload && this.#lastPayload.day;
    return this.#pinnedDay != null && payloadDay != null
      && Number(payloadDay) !== Number(this.#pinnedDay);
  }

  #dayStatsText() {
    // Winners/top-hit come off /game/jackpot/last-day, which only ever carries the
    // LATEST day, so an older pinned day gets no totals — only its own label.
    if (this.#viewingPastDay()) return `Day ${this.#pinnedDay} draw`;
    const winners = this.#winners;
    if (!winners || winners.length === 0) return 'No winners recorded this day.';
    let topEth = 0n;
    for (const w of winners) {
      try {
        const v = BigInt(w.totalEth || '0');
        if (v > topEth) topEth = v;
      } catch { /* skip malformed */ }
    }
    const unique = new Set(winners.map((w) => String(w.address || '').toLowerCase())).size;
    const parts = [`${unique} winner${unique === 1 ? '' : 's'} this day`];
    if (topEth > 0n) parts.push(`top hit ${fmtEthScaled(topEth.toString())} ETH`);
    return parts.join(' · ');
  }

  // ---------------------------------------------------------------------------
  // Day results — what each winning trait paid (user ask: "the scratchoff
  // still does not reveal winners"). The viewed player often ISN'T a winner
  // (the sDGNRS house default never wins roll 1), so an honest empty scratch
  // needs the day's actual results beside it. Aggregates only — per-trait
  // winner counts + per-winner amounts from payload.summary — never address
  // dumps (leaderboards stay pro-mode). SPOILER-GATED on #hasSpunPinnedDay.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Phase 64: replay-panel bridge — drive the sibling <replay-panel>'s own
  // day/player selects to (pinnedDay, viewedPlayer). The panel populates its
  // options asynchronously, so retry on a short timer until both take
  // (play/app/replay-panel-sync.js pattern). Selects are hidden via app.css;
  // the panel's Reveal button stays as the player's spin trigger.
  // ---------------------------------------------------------------------------

  #panel() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
    return document.querySelector('replay-panel');
  }

  #setSelectAndFire(select, value) {
    if (!select || value == null) return false;
    const target = String(value).toLowerCase ? String(value) : String(value);
    const options = select.options ? Array.from(select.options) : [];
    const matching = options.find((o) => String(o.value).toLowerCase() === target.toLowerCase());
    if (!matching) return false;
    if (String(select.value).toLowerCase() === target.toLowerCase()) return true;
    select.value = matching.value;
    try {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {
      // fakeDOM Event shim absent — dispatch a minimal object instead
      try { select.dispatchEvent({ type: 'change', bubbles: true }); } catch { /* give up */ }
    }
    return true;
  }

  #ensureZeroEntryPlayerOption(select, address) {
    if (!select || !address) return false;
    const target = String(address);
    const options = select.options ? Array.from(select.options) : [];
    if (options.some((option) => String(option.value).toLowerCase() === target.toLowerCase())) {
      return true;
    }

    // replay-panel builds this list from /replay/tickets/:level, so an address
    // with zero entries is correctly absent. It still needs to be selectable:
    // otherwise #setSelectAndFire leaves the previously rendered player in
    // place and the zero-entry viewer appears to own that player's wins (most
    // visibly the far-future result). The synthetic option represents exactly
    // what the API omitted — this address, with no entries — and the panel's
    // normal exact-address filtering then renders an empty personal result.
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false;
    const option = document.createElement('option');
    option.value = target;
    option.textContent = `${target.slice(0, 6)}…${target.slice(-4)} (0 entries)`;
    option.dataset.zeroEntry = 'true';
    select.appendChild(option);
    // The test DOM keeps `options` as a plain array; a real HTMLSelectElement's
    // live HTMLOptionsCollection is updated by appendChild above.
    if (Array.isArray(select.options) && !select.options.includes(option)) {
      select.options.push(option);
    }
    return true;
  }

  #trySyncOnce() {
    const panel = this.#panel();
    if (!panel || this.#pinnedDay == null) return false;
    const daySelect = panel.querySelector('[data-bind="day-select"]');
    const playerSelect = panel.querySelector('[data-bind="player-select"]');
    const hasPinnedDay = daySelect?.options
      && Array.from(daySelect.options).some(
        (option) => String(option.value) === String(this.#pinnedDay),
      );
    if (!hasPinnedDay) {
      // replay-panel historically loaded this list only once. Ask it to
      // refresh when the latest resolved day is not present; its public method
      // coalesces/throttles retries while the indexer catches up.
      if (typeof panel.refreshDays === 'function') {
        try {
          Promise.resolve(panel.refreshDays()).then((refreshed) => {
            if (refreshed && this.#pinnedDay != null) this.#trySyncOnce();
          }).catch(() => {});
        } catch { /* older replay-panel / fakeDOM */ }
      }
      return false;
    }
    const dayOk = this.#setSelectAndFire(daySelect, this.#pinnedDay);
    // Player defaults are seeded by main.js (sDGNRS house view when nothing
    // else is connected), so getViewedAddress() is the single source of truth.
    const addr = getViewedAddress();
    if (addr) this.#ensureZeroEntryPlayerOption(playerSelect, addr);
    const playerOk = addr ? this.#setSelectAndFire(playerSelect, addr) : false;
    this.#renderHistoryNav();
    return dayOk && playerOk;
  }

  #historyNav() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
    return document.querySelector('[data-bind="jackpot-day-history"]');
  }

  #availableReplayDays() {
    const select = this.#panel()?.querySelector?.('[data-bind="day-select"]');
    return (select?.options ? Array.from(select.options) : [])
      .map((option) => Number(option.value))
      .filter((day) => Number.isInteger(day) && day > 0)
      .sort((a, b) => a - b);
  }

  #renderHistoryNav() {
    const nav = this.#historyNav();
    if (!nav || this.#pinnedDay == null) return;
    const label = nav.querySelector?.('[data-bind="jackpot-day-history-label"]');
    const prev = nav.querySelector?.('[data-bind="jackpot-day-prev"]');
    const next = nav.querySelector?.('[data-bind="jackpot-day-next"]');
    const historical = this.#latestDaySeen != null
      && Number(this.#pinnedDay) < Number(this.#latestDaySeen);
    // The replay panel's existing day dropdown is the entry point into
    // history. Keep this compact stepper out of the live jackpot layout; once
    // a past day is chosen it provides adjacent-day navigation and a clear
    // reminder that the board is no longer showing today.
    nav.hidden = !historical;
    if (label) {
      label.textContent = historical
        ? `VIEWING PAST DAY ${this.#pinnedDay}`
        : `LATEST DAY ${this.#pinnedDay}`;
    }
    nav.classList?.toggle('is-historical', historical);
    const days = this.#availableReplayDays();
    const index = days.indexOf(Number(this.#pinnedDay));
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index < 0 || index >= days.length - 1;
  }

  #dispatchDaySelection(manual) {
    if (this.#pinnedDay == null || typeof document === 'undefined'
      || typeof document.dispatchEvent !== 'function') return;
    const historical = this.#latestDaySeen != null
      && Number(this.#pinnedDay) < Number(this.#latestDaySeen);
    const detail = {
      day: Number(this.#pinnedDay),
      latestDay: this.#latestDaySeen == null ? null : Number(this.#latestDaySeen),
      historical,
      manual: Boolean(manual),
    };
    try {
      const event = typeof CustomEvent === 'function'
        ? new CustomEvent('replay:day-selected', { detail })
        : { type: 'replay:day-selected', detail };
      document.dispatchEvent(event);
    } catch { /* headless/fake DOM */ }
  }

  async #refreshHistoricalMetadata(day) {
    const seq = ++this.#historyMetadataSeq;
    try {
      const payload = await fetchJSON(`/game/jackpot/day/${day}/winners`);
      if (seq !== this.#historyMetadataSeq || Number(this.#pinnedDay) !== Number(day)) return;
      this.#winners = Array.isArray(payload?.winners) ? payload.winners : [];
      this.#pinnedLevel = payload?.level ?? this.#pinnedLevel;
    } catch { /* replay-panel still owns the draw when metadata is unavailable */ }
  }

  #selectAdjacentDay(direction) {
    const panel = this.#panel();
    const select = panel?.querySelector?.('[data-bind="day-select"]');
    const days = this.#availableReplayDays();
    const index = days.indexOf(Number(this.#pinnedDay));
    const target = index < 0 ? null : days[index + (Number(direction) < 0 ? -1 : 1)];
    if (!select || target == null) return;
    select.value = String(target);
    try { select.dispatchEvent(new Event('change', { bubbles: true })); }
    catch { try { select.dispatchEvent({ type: 'change', bubbles: true }); } catch { /* no-op */ } }
  }

  #wireHistoryNav() {
    const nav = this.#historyNav();
    if (!nav || this.#historyPrevListener || this.#historyNextListener) return;
    const prev = nav.querySelector?.('[data-bind="jackpot-day-prev"]');
    const next = nav.querySelector?.('[data-bind="jackpot-day-next"]');
    this.#historyPrevListener = () => this.#selectAdjacentDay(-1);
    this.#historyNextListener = () => this.#selectAdjacentDay(1);
    prev?.addEventListener?.('click', this.#historyPrevListener);
    next?.addEventListener?.('click', this.#historyNextListener);
  }

  /**
   * Let a manual pick on the panel's Day select re-pin the board.
   *
   * Without this the select is decorative: #trySyncOnce writes #pinnedDay back into it
   * on every lastDay poll (60s), so a chosen day silently snaps back. Treating the pick
   * as a new pin makes the control authoritative — and doubles as the escape hatch when
   * the board is holding an older day behind the "new day" banner.
   *
   * Idempotent: re-binding on a later sync is a no-op thanks to the wired flag, and the
   * listener ignores the programmatic changes #setSelectAndFire dispatches (they always
   * carry the day already pinned).
   */
  #wireDayPicker() {
    const panel = this.#panel();
    const daySelect = panel && panel.querySelector('[data-bind="day-select"]');
    if (!daySelect || daySelect.dataset.ldjWired === '1') return;
    daySelect.dataset.ldjWired = '1';
    daySelect.addEventListener('change', () => {
      const picked = Number(daySelect.value);
      if (!Number.isFinite(picked) || picked <= 0) return;
      if (picked === this.#pinnedDay) return;   // programmatic re-sync, not a user pick
      this.#pinnedDay = picked;
      this.#pinnedLevel = null;
      this.#manualReplayDay = picked;
      this.#historyMetadataSeq += 1;
      this.#foilSeq += 1;
      this.#foilData = null;
      this.#foilDataKey = null;
      this.#winners = [];
      this.#resetDayGates();
      this.#renderFoil();
      const dayLabel = this.querySelector('[data-bind="day"]');
      if (dayLabel) dayLabel.textContent = `Day ${picked}`;
      if (typeof panel.setPersistedRevealState === 'function') {
        panel.setPersistedRevealState(false, false);
      }
      void this.#refreshHistoricalMetadata(picked);
      void this.#refreshFlipRow();
      this.#renderHistoryNav();
      this.#dispatchDaySelection(true);
      // Leaving the newest day pinned means the banner has nothing left to offer.
      this.#hasNewDayAvailable = false;
      const banner = this.querySelector('[data-bind="ldj-new-day-banner"]');
      if (banner) banner.setAttribute('hidden', '');
    });
  }

  #syncReplayPanel() {
    this.#wireDayPicker();
    const panel = this.#panel();
    // Tell the board whether this day is waiting before the async day/player
    // selectors finish syncing. replay-panel can run its neutral slow reel
    // without those values; delaying this signal left a newly-ready jackpot
    // parked on four blank grey quadrants until the bridge completed.
    if (panel && this.#pinnedDay != null
      && typeof panel.setPersistedRevealState === 'function') {
      const replayFresh = Number(this.#manualReplayDay) === Number(this.#pinnedDay);
      panel.setPersistedRevealState(
        replayFresh ? false : this.#hasSpunPinnedDay(),
        replayFresh ? false : this.#hasCompletedPinnedDay(),
      );
    }
    if (this.#bridgeTimer != null) {
      try { clearInterval(this.#bridgeTimer); } catch { /* defensive */ }
      this.#bridgeTimer = null;
    }
    if (this.#trySyncOnce()) return;
    if (typeof setInterval !== 'function') return;
    this.#bridgeAttempts = 0;
    const handle = setInterval(() => {
      this.#bridgeAttempts += 1;
      if (this.#trySyncOnce() || this.#bridgeAttempts >= BRIDGE_MAX_ATTEMPTS) {
        try { clearInterval(handle); } catch { /* defensive */ }
        if (this.#bridgeTimer === handle) this.#bridgeTimer = null;
      }
    }, BRIDGE_RETRY_MS);
    if (handle && typeof handle.unref === 'function') {
      try { handle.unref(); } catch { /* defensive */ }
    }
    this.#bridgeTimer = handle;
  }

  // Panel reveal fully scratched — open the spoiler gate and fire follow-on
  // UI. Fires per roll (Roll 1, then bonus Roll 2); every step below is
  // idempotent, and confetti is additionally once-per-day guarded.
  #onPanelScratchComplete(e) {
    this.#markSpunPinnedDay();
    this.#sawScratchEvent = true;
    // The spoiler gate is open, so a claimable foil match can surface now.
    this.#renderFoil();
    // The replay board itself knows whether THIS scratch phase contained an
    // actual personal payout and owns its phase-scoped celebration. Do not add
    // day-wide host confetti here: a player who wins only the other roll would
    // otherwise get confetti over a losing scratchoff.
    const viewed = getViewedAddress();
    const target = viewed ? String(viewed).toLowerCase() : null;
    const mine = Boolean(target && (this.#winners || []).some(
      (w) => String(w.address || '').toLowerCase() === target,
    ));
    // Final roll? (bonus phase completing, or roll 1 with no bonus ahead).
    // A detail-less event (older panel / tests) counts as final.
    const d = e?.detail;
    const final = !d || d.bonusPhase === true || !d.bonusAvailable;
    if (final) {
      this.#boardDone = true;
      this.#manualReplayDay = null;
      this.#markCompletedPinnedDay();
      this.#markBonusPending(false);
    } else {
      // `spun_day` predates the all-roll completion key and is written after
      // Roll 1. Persist the distinction so a reload cannot mistake a still-
      // available bonus roll for a fully played legacy board.
      this.#markBonusPending(true);
    }
    this.#maybeShowResultsCta();
    // Same-tab signal consumed by the winnings banner (app-claims-panel).
    try {
      const detail = {
        day: this.#pinnedDay,
        mine,
        complete: final,
        bonusPending: !final,
      };
      const ev = (typeof CustomEvent === 'function')
        ? new CustomEvent('jackpot:revealed', { detail })
        : { type: 'jackpot:revealed', detail };
      document.dispatchEvent(ev);
    } catch { /* headless / fakeDOM — signal is best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // Results CTA — appears only after the WHOLE main UI played out: every
  // scratch roll (bonus included) AND the daily coin flip (waived when the
  // day has no coinflip row — balances-strip rule). Clicking opens the
  // full-reveal popup for the viewed player.
  // ---------------------------------------------------------------------------

  #resultsCta() {
    if (this.#resultsCtaEl) return this.#resultsCtaEl;
    this.#resultsCtaEl = this.querySelector('[data-bind="ldj-results-cta"]');
    return this.#resultsCtaEl;
  }

  #resetDayGates() {
    this.#boardDone = false;
    this.#sawScratchEvent = false;
    this.#flipResult = undefined;
    this.#flipFetchedDay = null;
    const cta = this.#resultsCta();
    this.#setResultsCtaVisible(cta, false);
  }

  // Coin flip revealed for the pinned day? Same gate as app-balances-strip:
  // the flip_day key, waived when the day has no coinflip row.
  #flipGateOpen() {
    if (this.#pinnedDay == null) return false;
    if (this.#flipFetchedDay === this.#pinnedDay && this.#flipResult === null) return true;
    try {
      return typeof localStorage !== 'undefined'
        && localStorage.getItem(`flip_day_${CHAIN.id}_${this.#pinnedDay}`) === '1';
    } catch {
      return false;
    }
  }

  #summaryOpenedKey() {
    if (this.#pinnedDay == null) return null;
    const viewed = getViewedAddress();
    const player = viewed ? String(viewed).toLowerCase() : 'no-player';
    return `day_summary_${CHAIN.id}_${this.#pinnedDay}_${player}`;
  }

  #hasOpenedSummary() {
    const key = this.#summaryOpenedKey();
    if (!key) return false;
    try { return localStorage.getItem(key) === '1'; }
    catch { return false; }
  }

  #markSummaryOpened() {
    const key = this.#summaryOpenedKey();
    if (!key) return;
    try { localStorage.setItem(key, '1'); }
    catch { /* private browsing: hiding for this mount is still enough */ }
  }

  // Fetch the day's coinflip row ONLY to apply the no-row waiver. Failure
  // leaves the waiver unknown (gate falls back to the flip_day key alone).
  async #refreshFlipRow() {
    const day = this.#pinnedDay;
    if (day == null || this.#flipFetchedDay === day || typeof fetch !== 'function') return;
    try {
      const res = await fetch(`${API_BASE}/game/coinflip/day/${day}`);
      if (!res.ok) return; // unknown — key-only gate
      const data = await res.json();
      if (this.#pinnedDay !== day) return; // day re-pinned mid-flight
      this.#flipResult = data ?? null;
      this.#flipFetchedDay = day;
    } catch { /* network blip / headless — key-only gate */ }
    this.#maybeShowResultsCta();
  }

  /** Share replay-panel's single action row with Reveal Draw. */
  #mountResultsCta(cta) {
    if (!cta || typeof document === 'undefined') return;
    const replay = document.querySelector('replay-panel');
    const controls = replay?.querySelector?.('.replay-controls');
    const slot = document.querySelector('[data-bind="day-summary-slot"]');
    const target = controls || slot;
    if (!target || cta.parentNode === target || cta.parentElement === target) return;
    try { target.appendChild(cta); } catch { /* fakeDOM — leave it in the shell */ }
  }

  #setResultsCtaVisible(cta, visible) {
    if (cta) cta.hidden = !visible;
    if (typeof document === 'undefined') return;
    const replay = document.querySelector('replay-panel');
    const controls = replay?.querySelector?.('.replay-controls');
    const reveal = replay?.querySelector?.('[data-bind="reveal-btn"]');
    // Never force Reveal Draw back on: replay-panel owns when that button is
    // valid. We only guarantee that the two actions cannot coexist.
    if (visible && reveal) reveal.hidden = true;
    const slot = document.querySelector('[data-bind="day-summary-slot"]');
    if (slot) slot.hidden = controls ? true : !visible;
  }

  #maybeShowResultsCta() {
    const cta = this.#resultsCta();
    if (!cta) return;
    this.#mountResultsCta(cta);
    // Reloaded spun day: the board was already played out in a prior session
    // (spun_day persisted) — don't force a re-scratch to reach the results.
    const replayFresh = Number(this.#manualReplayDay) === Number(this.#pinnedDay);
    const boardDone = this.#boardDone
      || (!replayFresh && !this.#sawScratchEvent && this.#hasSpunPinnedDay());
    const show = Boolean(
      this.#pinnedDay != null
      && boardDone
      && this.#flipGateOpen()
      && !this.#hasOpenedSummary()
    );
    this.#setResultsCtaVisible(cta, show);
  }

  async #loadDayActivity(viewed, day) {
    if (!viewed || day == null || typeof fetch !== 'function') return null;
    const player = String(viewed).toLowerCase();
    const address = encodeURIComponent(player);
    const dayParam = encodeURIComponent(String(day));
    const read = async (path) => {
      const res = await fetch(`${API_BASE}${path}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      return res.json();
    };
    const [packsResult, viewerResult, resolvedStakeResult] = await Promise.allSettled([
      read(`/player/${address}/packs?day=${dayParam}`),
      read(`/viewer/player/${address}/day/${dayParam}`),
      // The viewer day snapshot currently resolves its coinflip lookup through
      // the jackpot level. A level can span several flip days, so that value can
      // belong to a different result. Use the same immutable exact-day event
      // read as the flip widget and retain the viewer row only as a fallback.
      readResolvedCoinflipStake({ player, day }),
    ]);
    // Both APIs have an all-time mode. Treat their echoed day as part of the
    // response contract so a dropped/mishandled query parameter cannot turn a
    // one-day summary into the player's entire history.
    const packsCandidate = packsResult.status === 'fulfilled' ? packsResult.value : null;
    const viewerCandidate = viewerResult.status === 'fulfilled' ? viewerResult.value : null;
    const packs = _isExactDayPayload(packsCandidate, day, player) ? packsCandidate : null;
    const viewer = _isExactDayPayload(viewerCandidate, day, player) ? viewerCandidate : null;
    const ticketPacks = Array.isArray(packs?.ticketRevealPacks)
      ? packs.ticketRevealPacks : [];
    const ticketCount = ticketPacks.reduce(
      (sum, pack) => sum + Math.max(0, Number(pack?.ticketCount) || 0),
      0,
    );
    const activity = viewer?.activity;
    const openedLootboxes = Array.isArray(packs?.lootboxPacks)
      ? packs.lootboxPacks.length : 0;
    const lootboxesBought = !Array.isArray(activity?.lootboxPurchases)
      ? openedLootboxes
      : activity.lootboxPurchases.length;
    const lootboxesOpened = !Array.isArray(activity?.lootboxResults)
      ? openedLootboxes
      : activity.lootboxResults.filter((row) => (
        row?.rewardType === 'opened'
        || row?.rewardType === 'flipOpened'
        || row?.rewardType === 'presale_opened'
      )).length;
    const lootboxResults = viewer && packs
      ? await loadDayLootboxResults({
          player, day, snapshot: viewer, dayPacks: packs,
        }).catch(() => [])
      : [];
    const resolvedStake = resolvedStakeResult.status === 'fulfilled'
      && resolvedStakeResult.value != null
      ? resolvedStakeResult.value
      : null;
    let coinflipStakeAmount = '0';
    let hasCoinflipBet = false;
    try {
      coinflipStakeAmount = BigInt(
        resolvedStake == null ? (activity?.coinflip?.stakeAmount || '0') : resolvedStake,
      ).toString();
      hasCoinflipBet = BigInt(coinflipStakeAmount) > 0n;
    } catch { /* malformed row */ }
    const exactDayResult = this.#flipFetchedDay === day ? this.#flipResult : null;
    const coinflipWon = exactDayResult?.win === true
      ? true
      : exactDayResult?.win === false
        ? false
        : activity?.coinflip?.win === true
          ? true
          : activity?.coinflip?.win === false ? false : null;
    const dayRewardRaw = exactDayResult?.rewardPercent;
    const activityRewardRaw = activity?.coinflip?.rewardPercent;
    const activityReward = activityRewardRaw == null ? NaN : Number(activityRewardRaw);
    const dayReward = dayRewardRaw == null ? NaN : Number(dayRewardRaw);
    const coinflipRewardPercent = Number.isFinite(dayReward)
      ? Math.max(0, Math.trunc(dayReward))
      : Number.isFinite(activityReward) ? Math.max(0, Math.trunc(activityReward)) : 0;
    return {
      ticketPacks: ticketPacks.length,
      ticketCount,
      lootboxesBought,
      lootboxesOpened,
      lootboxResults,
      hasCoinflipBet,
      coinflipWon,
      coinflipStakeAmount,
      coinflipRewardPercent,
    };
  }

  // Build + queue the viewed player's full day summary. Winner → prize cards;
  // non-winner → an honest NO HIT card. Day-scoped DB feeds add the ticket
  // packs and lootboxes the player bought/opened during the round.
  async #onResultsCtaClick() {
    if (this.#summaryBusy || this.#hasOpenedSummary()) return;
    const viewed = getViewedAddress();
    const target = viewed ? String(viewed).toLowerCase() : null;
    const winnerRow = target ? (this.#winners || []).find(
      (w) => String(w.address || '').toLowerCase() === target,
    ) : null;
    // Winner row units: totalEth = scaled ETH-wei, coinTotal = FLIP-wei,
    // ticketCount = ENTRIES (4 = 1 whole ticket).
    const prizes = [];
    if (winnerRow) {
      try {
        const breakdown = Array.isArray(winnerRow.breakdown) ? winnerRow.breakdown : [];
        const winningTraits = (...awardTypes) => {
          const accepted = new Set(awardTypes.map((type) => String(type).toLowerCase()));
          const traits = new Set();
          for (const row of breakdown) {
            if (!accepted.has(String(row?.awardType || '').toLowerCase())) continue;
            const traitId = Number(row?.traitId);
            if (Number.isInteger(traitId) && traitId >= 0 && traitId <= 255) traits.add(traitId);
          }
          return [...traits];
        };
        if (BigInt(winnerRow.totalEth || '0') > 0n) {
          prizes.push({
            type: 'eth', amount: BigInt(winnerRow.totalEth),
            winningTraitIds: winningTraits('eth', 'eth_baf'),
          });
        }
        if (BigInt(winnerRow.coinTotal || '0') > 0n) {
          prizes.push({
            type: 'flip', amount: BigInt(winnerRow.coinTotal),
            winningTraitIds: winningTraits('flip', 'flip_baf', 'farFutureCoin'),
          });
        }
        // The composed last-day winner row already includes Decimator claims,
        // including players whose only payout that day was Decimator. Reuse it
        // here so the summary gains the missing result without another API or
        // database lookup.
        const decimator = winnerRow.decimatorPrize || {};
        const decimatorRegular = BigInt(decimator.regularEth || '0');
        const decimatorLootbox = BigInt(decimator.lootboxEth || '0');
        const decimatorTerminal = BigInt(decimator.terminalEth || '0');
        if (decimatorRegular > 0n || decimatorLootbox > 0n || decimatorTerminal > 0n) {
          prizes.push({
            type: 'decimator',
            amount: decimatorRegular + decimatorTerminal,
            lootboxAmount: decimatorLootbox,
            terminalAmount: decimatorTerminal,
          });
        }
        const wholeTickets = Math.round(Number(winnerRow.ticketCount || 0) / 4);
        if (wholeTickets > 0) {
          // Ticket awards land at the winning trait's award level when the
          // breakdown carries one (award rows are next-level).
          const ticketRow = Array.isArray(winnerRow.breakdown)
            ? winnerRow.breakdown.find((b) => b && b.awardType === 'tickets') : null;
          prizes.push({
            type: 'tickets', amount: wholeTickets, level: ticketRow?.level,
            winningTraitIds: winningTraits('tickets', 'ticket', 'tickets_baf'),
          });
        }
      } catch { /* malformed row — falls through to the NO HIT summary */ }
    }
    const cta = this.#resultsCta();
    this.#summaryBusy = true;
    if (cta) {
      cta.disabled = true;
      cta.textContent = 'LOADING DAY SUMMARY…';
    }
    try {
      const activity = await this.#loadDayActivity(viewed, this.#pinnedDay);
      // The 1 WWXRP card is the losing-coinflip consolation, not a generic
      // participation award. Requiring an explicit false also prevents a
      // missing/pending outcome from being presented as a loss.
      let consolationOnly = false;
      if (prizes.length === 0 && activity?.hasCoinflipBet && activity.coinflipWon === false) {
        prizes.push({ type: 'wwxrp', amount: 10n ** 18n });
        consolationOnly = true;
      }
      queueReveal({
        kind: 'jackpot',
        title: this.#pinnedDay != null ? `DAY ${this.#pinnedDay} SUMMARY` : 'DAY SUMMARY',
        day: this.#pinnedDay,
        prizes,
        consolationOnly,
        activity,
        noWin: prizes.length === 0 && !activity?.hasCoinflipBet
          ? { sub: this.#dayStatsText() }
          : null,
      });
      // The summary is a one-shot epilogue for this player/day. Persist the
      // consumption so refresh cannot bring the action row back after it has
      // already queued the reveal.
      this.#markSummaryOpened();
      this.#setResultsCtaVisible(cta, false);
    } finally {
      this.#summaryBusy = false;
      if (cta) {
        cta.disabled = false;
        cta.textContent = 'DAY SUMMARY';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Plan 59-03: in-widget new-day-available banner (D-04).
  // ---------------------------------------------------------------------------
  #renderNewDayBanner() {
    const banner = this.querySelector('[data-bind="ldj-new-day-banner"]');
    const text = this.querySelector('[data-bind="ldj-new-day-text"]');
    if (!banner || !text || !this.#lastPayload) return;
    text.textContent = `Day ${this.#lastPayload.day} just resolved — `;
    banner.removeAttribute('hidden');
    banner.hidden = false;
  }

  #hideNewDayBanner() {
    const banner = this.querySelector('[data-bind="ldj-new-day-banner"]');
    if (!banner) return;
    banner.setAttribute('hidden', '');
    banner.hidden = true;
  }

  #onNewDayBannerClick() {
    if (!this.#lastPayload) return;
    this.#adoptLatestDay(this.#lastPayload, true);
  }

  // ---------------------------------------------------------------------------
  // Phase 64: foil-ticket matching. The old inline strip/claim bar is gone;
  // this controller grades the viewed player's four lines after the draw is
  // revealed and publishes the best unclaimed tuple into the shared tray.
  // ---------------------------------------------------------------------------

  async #refreshFoil() {
    if (this.#viewingPastDay()) {
      this.#foilData = null;
      this.#foilDataKey = null;
      this.#renderFoil();
      return;
    }
    const addr = getViewedAddress();
    // Foil packs key on the day's PURCHASE level (roll1.purchaseLevel) — the
    // aggregate payload.level is the count-weighted winner level and reads
    // one high (same wrong-level class as the inventory/scratch-gate fixes).
    const level = this.#lastPayload?.roll1?.purchaseLevel
      ?? this.#lastPayload?.level
      ?? this.#pinnedLevel;
    if (!addr || level == null || typeof fetch !== 'function') {
      this.#foilData = null;
      this.#foilDataKey = null;
      this.#renderFoil();
      return;
    }
    const dataKey = `${String(addr).toLowerCase()}|${Number(level)}|${Number(this.#pinnedDay)}`;
    const sameScope = this.#foilDataKey === dataKey;
    if (!sameScope) {
      this.#foilData = null;
      this.#foilDataKey = dataKey;
      this.#renderFoil();
    }
    const seq = ++this.#foilSeq;
    try {
      const res = await fetch(`${API_BASE}/player/${addr}/foil?level=${level}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      if (seq !== this.#foilSeq) return; // superseded by a newer refresh
      // A foil record cannot disappear for the same player/level/day. Keep the
      // last indexed pack through a transient empty catch-up response, while
      // still accepting fresher lines/claims whenever the record is present.
      if (data?.present || !sameScope || !this.#foilData?.present) {
        this.#foilData = data;
      }
    } catch (_e) {
      if (seq !== this.#foilSeq) return;
      // Network/indexer trouble is not proof that a verified pack vanished.
      // First-load failures remain hidden; same-scope data stays published.
      if (!sameScope) this.#foilData = null;
    }
    this.#renderFoil();
  }

  #foilClaimKey(player, day, ticketIndex, drawKind) {
    return [String(player || '').toLowerCase(), Number(day), Number(ticketIndex), Number(drawKind)].join(':');
  }

  #renderFoil() {
    const d = this.#foilData;
    const player = getViewedAddress();
    const publishEmpty = () => publishPendingActions(FOIL_MATCH_ACTION_SOURCE, []);
    if (!player || !d || !d.present || !Array.isArray(d.lines) || d.lines.length === 0) {
      publishEmpty();
      return;
    }
    // Grading remains spoiler-gated: a pending row must not reveal that one of
    // the covered jackpot traits matched before the player scratches the draw.
    if (!this.#hasSpunPinnedDay()) {
      publishEmpty();
      return;
    }

    const summary = this.#lastPayload?.summary || null;
    const mainSet = summary?.rollOne?.mainTraitsPacked ?? null;
    const bonusSet = summary?.rollTwo?.bonusTraitsPacked ?? null;
    const claims = Array.isArray(d.claims) ? d.claims : [];
    const day = Number(this.#pinnedDay);
    const level = Number(
      this.#lastPayload?.roll1?.purchaseLevel
      ?? this.#lastPayload?.level
      ?? this.#pinnedLevel,
    );

    const candidates = [];
    d.lines.forEach((line, i) => {
      for (const grade of claimableDrawGrades(line, mainSet, bonusSet)) {
        if (grade.score < FOIL_CLAIM_THRESHOLD) continue;
        const key = this.#foilClaimKey(player, day, i, grade.drawKind);
        const indexed = claims.some((claim) => (
          Number(claim?.day) === day
          && Number(claim?.ticketIndex) === i
          && Number(claim?.drawKind) === grade.drawKind
        ));
        if (indexed || this.#locallyClaimedFoilMatches.has(key)) continue;
        candidates.push({
          player: String(player),
          day,
          level: Number.isFinite(level) ? level : null,
          ticketIndex: i,
          lineTraits: [...line],
          winningTraits: unpackWinSet(grade.packedSet),
          grade,
          key,
        });
      }
    });
    candidates.sort((a, b) => (
      b.grade.score - a.grade.score
      || a.ticketIndex - b.ticketIndex
      || a.grade.drawKind - b.grade.drawKind
    ));
    const best = candidates[0];
    if (!best) {
      publishEmpty();
      return;
    }

    const exact = best.grade.faces.filter((face) => face === 2).length;
    const symbolOnly = best.grade.faces.filter((face) => face === 1).length;
    const drawLabel = best.grade.drawKind === 1 ? 'BONUS DRAW' : 'MAIN DRAW';
    publishPendingActions(FOIL_MATCH_ACTION_SOURCE, [{
      id: `foil-match:${best.key}`,
      kind: 'foil-match',
      kindLabel: 'FOIL TICKET MATCH',
      label: `Day ${day} · Foil T${best.grade.score}`,
      shortLabel: `Claim T${best.grade.score}`,
      detail: `${drawLabel} · ${exact} exact + ${symbolOnly} symbol`,
      lineTraits: best.lineTraits,
      state: this.#foilClaimBusy ? 'busy' : 'ready',
      write: true,
      autoOpen: false,
      order: 15,
      chronology: (day * 100_000) + (best.ticketIndex * 2) + best.grade.drawKind,
      run: () => this.#onFoilClaim(best),
    }]);
  }

  // Claim a matched foil tuple. Its explanation card leads directly into the
  // isolated Degenerette BoxSpin from the same transaction receipt.
  async #onFoilClaim(candidate) {
    if (this.#foilClaimBusy) return;
    this.#foilClaimBusy = true;
    this.#renderFoil();
    try {
      const { player, day, ticketIndex, grade } = candidate;
      const { receipt, contract } = await claimFoilMatch({
        player,
        day,
        ticketIndex,
        drawKind: grade.drawKind ?? 0,
      });
      const claimedInfo = parseFoilMatchClaimedFromReceipt(receipt, contract);
      const claimed = claimedInfo.find((row) => (
        Number(row?.day) === Number(day)
        && Number(row?.ticketIndex) === Number(ticketIndex)
        && Number(row?.drawKind) === Number(grade.drawKind)
      )) || claimedInfo[0] || null;
      const tier = claimed?.tier ?? grade.score;
      const rewardFaces = claimed?.faces ?? FOIL_TIER_FACES[tier] ?? 0;
      const legs = parseOpenLegsFromReceipt(receipt, player);
      this.#locallyClaimedFoilMatches.add(candidate.key);
      queueReveal({
        kind: 'foil-match',
        day,
        level: candidate.level,
        ticketIndex,
        drawKind: grade.drawKind,
        score: tier,
        lineTraits: candidate.lineTraits,
        winningTraits: candidate.winningTraits,
        matchFaces: grade.faces,
        rewardFaces,
        legs,
      });
      this.#renderFoil();
      void this.#refreshFoil();
    } finally {
      this.#foilClaimBusy = false;
      this.#renderFoil();
    }
  }

  // ---------------------------------------------------------------------------
  // Mount / unmount.
  // ---------------------------------------------------------------------------

  connectedCallback() {
    // A replacement shell must not inherit a row owned by an older detached
    // instance while its first player/foil read is still in flight.
    clearPendingActions(FOIL_MATCH_ACTION_SOURCE);
    this.#resultsCtaEl = null;   // the markup below mints a fresh one
    this.innerHTML = `
      <div data-bind="skeleton" class="panel last-day-jackpot">
        <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
        <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:50%"></div><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
      </div>
      <div data-bind="content" style="display:none">
        <div class="panel jackpot-panel last-day-jackpot">
          <div class="panel-header">
            <h2>JACKPOT</h2>
            <span class="ldj-day-label" data-bind="day">Day --</span>
          </div>

          <!-- Cold-start (status:'pre-game' OR no payload) -->
          <div data-bind="ldj-status-cold-start" class="ldj-cold-start" style="display:none;"></div>

          <!-- Empty-day (status:'resolved-no-winners') -->
          <div data-bind="ldj-status-empty-day" class="ldj-empty-day" style="display:none;">
            <p data-bind="ldj-empty-copy">Day -- had no winners — pot rolled to day --.</p>
          </div>

          <!-- Resolved: the spin/scratch reveal itself is the sibling
               <replay-panel> (app/index.html); this branch carries the
               player-centric chrome around it. -->
          <div data-bind="ldj-status-resolved" style="display:none;">
            <div class="ldj-new-day-banner" data-bind="ldj-new-day-banner" hidden>
              <span data-bind="ldj-new-day-text"></span>
              <button class="ldj-view-now" data-bind="ldj-view-now" type="button">View now</button>
            </div>

            <!-- Full-reveal summary CTA — hidden until the WHOLE board (bonus
                 roll included) and the coin flip play out (#maybeShowResultsCta).
                 #mountResultsCta relocates it beneath the replay board in the
                 middle draw column; this is just where it is born. -->
            <button type="button" class="ldj-results-cta" data-bind="ldj-results-cta" hidden>
              DAY SUMMARY
            </button>

            <!-- The day-results list and foil strip remain out of this compact
                 widget. Claimable foil matches publish into the shared pending
                 tray; their comparison and payout play in reveal-overlay. -->
          </div>
        </div>
      </div>
    `;

    // New-day banner CTA (Plan 59-03 D-04).
    const viewNowBtn = this.querySelector('[data-bind="ldj-view-now"]');
    if (viewNowBtn) {
      viewNowBtn.addEventListener('click', () => this.#onNewDayBannerClick());
    }

    // Full-reveal popup CTA (gated behind the whole board + flip playing out).
    const resultsCta = this.#resultsCta();
    if (resultsCta) {
      resultsCta.addEventListener('click', () => this.#onResultsCtaClick());
    }

    // app.lastDay subscription (polling.js pollLastDay writes it).
    this.#unsubs.push(
      subscribe('app.lastDay', (payload) => this.#onLastDayUpdate(payload))
    );
    this.#unsubs.push(
      subscribe('app.deploymentMismatch', (payload) => this.#renderDeploymentMismatch(payload))
    );

    // Viewed-player changes re-target both the spin panel and the foil strip.
    this.#unsubs.push(
      subscribe('viewing.address', () => {
        this.#syncReplayPanel();
        this.#refreshFoil();
        this.#maybeShowResultsCta();
      })
    );
    this.#unsubs.push(
      subscribe('connected.address', () => {
        this.#syncReplayPanel();
        this.#refreshFoil();
        this.#maybeShowResultsCta();
      })
    );

    // Panel scratch completion (bubbles from the sibling <replay-panel>) —
    // the spoiler gate opens only after the player scratches every owned
    // area, not at spin end. The event's detail (bonusPhase/bonusAvailable)
    // feeds the results-CTA "whole board done" gate.
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.#scratchCompleteListener = (e) => this.#onPanelScratchComplete(e);
      document.addEventListener('replay:scratch-complete', this.#scratchCompleteListener);
      // Coin-flip reveal (app-daily-flip) — the other half of the CTA gate.
      this.#flipListener = () => this.#maybeShowResultsCta();
      document.addEventListener('flip:revealed', this.#flipListener);
    }

    this.#setJackpotLoadStatus('(loading)');
    this.#showContent();
    this.#wireHistoryNav();
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
    clearPendingActions(FOIL_MATCH_ACTION_SOURCE);
    // The CTA may be parked inside <app-daily-flip>; innerHTML teardown here
    // would not reach it, so pull it out explicitly (connectedCallback mints a
    // fresh one, and an orphan would keep firing this instance's handler).
    if (this.#resultsCtaEl) {
      try { this.#resultsCtaEl.remove(); } catch { /* fakeDOM */ }
      this.#resultsCtaEl = null;
    }
    if (this.#bridgeTimer != null) {
      try { clearInterval(this.#bridgeTimer); } catch { /* defensive */ }
      this.#bridgeTimer = null;
    }
    if (this.#scratchCompleteListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('replay:scratch-complete', this.#scratchCompleteListener); }
      catch { /* defensive */ }
    }
    this.#scratchCompleteListener = null;
    if (this.#flipListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('flip:revealed', this.#flipListener); }
      catch { /* defensive */ }
    }
    this.#flipListener = null;
    const nav = this.#historyNav();
    nav?.querySelector?.('[data-bind="jackpot-day-prev"]')
      ?.removeEventListener?.('click', this.#historyPrevListener);
    nav?.querySelector?.('[data-bind="jackpot-day-next"]')
      ?.removeEventListener?.('click', this.#historyNextListener);
    this.#historyPrevListener = null;
    this.#historyNextListener = null;
    this.#historyMetadataSeq += 1;
  }
}

// Idempotency-guarded register (Phase 58 pattern).
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('last-day-jackpot')) {
    customElements.define('last-day-jackpot', LastDayJackpot);
  }
}
