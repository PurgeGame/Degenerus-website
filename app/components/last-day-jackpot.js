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
//   - renders a one-line day stat (no winner-address dumps — leaderboards
//     are pro-mode content) and the player's foil-ticket strip.
//
// Phase 59 relics removed in the rebuild: the roll1/roll2 data grids, the
// Replay state machine, winner classification lists, and the winner summary
// table (the "Type/Win/Uniq/Spread" spam).

import { subscribe, get, getViewedAddress } from '../app/store.js';
import { formatEth, formatFlip } from '../../beta/viewer/utils.js';
import { CHAIN } from '../app/chain-config.js';
// Phase 64 — foil-ticket strip: pure grading helpers + the indexer base URL
// (API_BASE cross-import only, mirroring polling.js Pitfall 5 discipline).
import { bestGrade, FOIL_CLAIM_THRESHOLD } from '../app/foil-match.js';
import { API_BASE } from '../../beta/app/constants.js';
// Reveal-engine wiring: the viewed player's jackpot winnings auto-play a
// celebration sequence; a claimed foil match reveals its payout box-spin.
import { queueReveal } from './reveal-overlay.js';
import { claimFoilMatch, parseFoilMatchClaimedFromReceipt } from '../app/foil-claim.js';
import { parseOpenLegsFromReceipt } from '../app/lootbox-legs.js';
import { sfxTick, sfxRollDone } from '../app/jackpot-sfx.js';

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
  #foilSeq = 0;
  #bridgeTimer = null;
  #bridgeAttempts = 0;
  #scratchCompleteListener = null;
  #celebratedDay = null;  // host confetti fires once per pinned day (bonus roll re-fires the event)
  #foilClaimBusy = false; // one in-flight foil claim at a time
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

  #showContent() {
    if (this.#loaded) return;
    this.#loaded = true;
    this.querySelector('[data-bind="skeleton"]')?.remove();
    const el = this.querySelector('[data-bind="content"]');
    if (el) el.style.display = '';
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
    this.#hasNewDayAvailable = false;
    this.#hideNewDayBanner();
    this.#foilSeq += 1; // invalidate any older-day request still in flight
    this.#foilData = null;
    this.#winners = [];
    if (resetGates) this.#resetDayGates();
    this.#renderForStatus(payload);
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
  }

  #renderColdStart() {
    const cold = this.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = this.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = this.querySelector('[data-bind="ldj-status-resolved"]');
    if (cold) cold.style.display = '';
    if (empty) empty.style.display = 'none';
    if (resolved) resolved.style.display = 'none';
  }

  #renderEmptyDay(day) {
    const cold = this.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = this.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = this.querySelector('[data-bind="ldj-status-resolved"]');
    if (cold) cold.style.display = 'none';
    if (empty) empty.style.display = '';
    if (resolved) resolved.style.display = 'none';
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
    const playerOk = addr ? this.#setSelectAndFire(playerSelect, addr) : false;
    if (dayOk && playerOk && typeof panel.setPersistedRevealState === 'function') {
      // The replay panel owns rendering; this shell owns the chain/day-scoped
      // completion key. Feeding it here lets refresh restore a cleared board
      // or run the silent waiting reels without duplicating jackpot logic.
      panel.setPersistedRevealState(
        this.#hasSpunPinnedDay(),
        this.#hasCompletedPinnedDay(),
      );
    }
    return dayOk && playerOk;
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
      // Leaving the newest day pinned means the banner has nothing left to offer.
      this.#hasNewDayAvailable = false;
      const banner = this.querySelector('[data-bind="ldj-new-day-banner"]');
      if (banner) banner.setAttribute('hidden', '');
    });
  }

  #syncReplayPanel() {
    this.#wireDayPicker();
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
    this.#renderFoil(true);
    // Inline confetti when the viewed player is among the day's winners —
    // part of the board playing out. The full-reveal popup does NOT auto-pop
    // here (user call): it sits behind the results CTA once the WHOLE board
    // (bonus roll included) and the coin flip are done.
    const viewed = getViewedAddress();
    const target = viewed ? String(viewed).toLowerCase() : null;
    const mine = Boolean(target && (this.#winners || []).some(
      (w) => String(w.address || '').toLowerCase() === target,
    ));
    if (mine && this.#celebratedDay !== this.#pinnedDay) {
      this.#celebratedDay = this.#pinnedDay;
      this.#fireConfetti(true);
    }
    // Final roll? (bonus phase completing, or roll 1 with no bonus ahead).
    // A detail-less event (older panel / tests) counts as final.
    const d = e?.detail;
    if (!d || d.bonusPhase === true || !d.bonusAvailable) {
      this.#boardDone = true;
      this.#markCompletedPinnedDay();
    }
    this.#maybeShowResultsCta();
    // Same-tab signal consumed by the winnings banner (app-claims-panel).
    try {
      const detail = { day: this.#pinnedDay, mine };
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
    const boardDone = this.#boardDone
      || (!this.#sawScratchEvent && this.#hasSpunPinnedDay());
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
    const address = encodeURIComponent(String(viewed).toLowerCase());
    const dayParam = encodeURIComponent(String(day));
    const read = async (path) => {
      const res = await fetch(`${API_BASE}${path}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      return res.json();
    };
    const [packsResult, viewerResult] = await Promise.allSettled([
      read(`/player/${address}/packs?day=${dayParam}`),
      read(`/viewer/player/${address}/day/${dayParam}`),
    ]);
    const packs = packsResult.status === 'fulfilled' ? packsResult.value : null;
    const viewer = viewerResult.status === 'fulfilled' ? viewerResult.value : null;
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
        row?.rewardType === 'opened' || row?.rewardType === 'flipOpened'
      )).length;
    let hasCoinflipBet = false;
    try { hasCoinflipBet = BigInt(activity?.coinflip?.stakeAmount || '0') > 0n; } catch { /* malformed row */ }
    const coinflipWon = activity?.coinflip?.win === true
      ? true
      : activity?.coinflip?.win === false ? false : null;
    return {
      ticketPacks: ticketPacks.length,
      ticketCount,
      lootboxesBought,
      lootboxesOpened,
      hasCoinflipBet,
      coinflipWon,
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
        if (BigInt(winnerRow.totalEth || '0') > 0n) {
          prizes.push({ type: 'eth', amount: BigInt(winnerRow.totalEth) });
        }
        if (BigInt(winnerRow.coinTotal || '0') > 0n) {
          prizes.push({ type: 'flip', amount: BigInt(winnerRow.coinTotal) });
        }
        const wholeTickets = Math.round(Number(winnerRow.ticketCount || 0) / 4);
        if (wholeTickets > 0) {
          // Ticket awards land at the winning trait's award level when the
          // breakdown carries one (award rows are next-level).
          const ticketRow = Array.isArray(winnerRow.breakdown)
            ? winnerRow.breakdown.find((b) => b && b.awardType === 'tickets') : null;
          prizes.push({ type: 'tickets', amount: wholeTickets, level: ticketRow?.level });
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
        noWin: prizes.length === 0 ? { sub: this.#dayStatsText() } : null,
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
  // Phase 64: foil-ticket strip — the viewed player's four foil lines for the
  // pinned day's level, lit up where they match the day's winning sets.
  // Match lighting is SPOILER-GATED on #hasSpunPinnedDay; the strip itself
  // (the player's own tickets) shows regardless.
  // ---------------------------------------------------------------------------

  async #refreshFoil() {
    if (!this.querySelector('[data-bind="ldj-foil"]')) return;
    const addr = getViewedAddress();
    // Foil packs key on the day's PURCHASE level (roll1.purchaseLevel) — the
    // aggregate payload.level is the count-weighted winner level and reads
    // one high (same wrong-level class as the inventory/scratch-gate fixes).
    const level = this.#lastPayload?.roll1?.purchaseLevel
      ?? this.#lastPayload?.level
      ?? this.#pinnedLevel;
    if (!addr || level == null || typeof fetch !== 'function') {
      this.#foilData = null;
      this.#renderFoil();
      return;
    }
    const seq = ++this.#foilSeq;
    try {
      const res = await fetch(`${API_BASE}/player/${addr}/foil?level=${level}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      if (seq !== this.#foilSeq) return; // superseded by a newer refresh
      this.#foilData = data;
    } catch (_e) {
      if (seq !== this.#foilSeq) return;
      this.#foilData = null; // network blip / no route → strip hides
    }
    this.#renderFoil();
  }

  /**
   * The foil CLAIM affordance — all that is left of the foil strip (user call
   * 2026-07-29). The strip itself (ladder chips, four badge lines, partial-tier
   * chips) is gone; a claimable match still has to be claimable, so this renders
   * one button for the best unclaimed line and stays hidden otherwise.
   */
  #renderFoil(animate = false) {
    const bar = this.querySelector('[data-bind="ldj-foil-claimbar"]');
    if (!bar) return;
    bar.textContent = '';
    bar.hidden = true;
    const d = this.#foilData;
    if (!d || !d.present || !Array.isArray(d.lines) || d.lines.length === 0) return;
    // Grading is spoiler-gated the same way the strip was: no lighting up a match
    // before the player has scratched the day.
    if (!this.#hasSpunPinnedDay()) return;

    const summary = this.#lastPayload?.summary || null;
    const mainSet = summary?.rollOne?.mainTraitsPacked ?? null;
    const bonusSet = summary?.rollTwo?.bonusTraitsPacked ?? null;
    const claims = Array.isArray(d.claims) ? d.claims : [];
    const day = this.#pinnedDay;

    let best = null;
    d.lines.forEach((line, i) => {
      if (claims.find((c) => c && c.day === day && c.ticketIndex === i)) return;
      const grade = bestGrade(line, mainSet, bonusSet);
      if (!grade || grade.score < FOIL_CLAIM_THRESHOLD) return;
      if (!best || grade.score > best.grade.score) best = { i, grade };
    });
    if (!best) return;

    bar.hidden = false;
    const label = document.createElement('span');
    label.className = 'ldj-foil-claimbar__label';
    label.textContent = `Foil match T${best.grade.score}`;
    bar.appendChild(label);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ldj-foil-claim';
    btn.setAttribute('data-write', '');
    btn.textContent = `CLAIM T${best.grade.score}`;
    btn.addEventListener('click', () => this.#onFoilClaim(best.i, best.grade, btn));
    bar.appendChild(btn);
    if (animate && !this.#reducedMotion()) {
      const t = setTimeout(() => sfxRollDone(true), 200);
      if (t && typeof t.unref === 'function') { try { t.unref(); } catch { /* defensive */ } }
    }
  }

  // Claim a matched foil line — the payout is an isolated Degenerette
  // box-spin; its BoxSpin event replays through the reveal overlay.
  async #onFoilClaim(ticketIndex, grade, btn) {
    if (this.#foilClaimBusy) return;
    this.#foilClaimBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Claiming…'; }
    try {
      const player = getViewedAddress();
      const { receipt, contract } = await claimFoilMatch({
        player,
        day: this.#pinnedDay,
        ticketIndex,
        drawKind: grade.drawKind ?? 0,
      });
      const claimedInfo = parseFoilMatchClaimedFromReceipt(receipt, contract);
      const tier = claimedInfo[0]?.tier ?? grade.score;
      const legs = parseOpenLegsFromReceipt(receipt, player);
      if (legs.length > 0) {
        // This receipt carries the same verified BoxSpin shape as a lootbox,
        // but there is no sealed box to crack — go directly to the spin card.
        queueReveal({
          kind: 'lootbox',
          title: `FOIL MATCH T${tier}`,
          noVessel: true,
          legs,
        });
      }
      // Re-pull claims so the line flips to "Claimed T{n}".
      this.#refreshFoil();
    } catch (error) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = String(error?.userMessage || 'Claim failed — retry');
      }
    } finally {
      this.#foilClaimBusy = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 64 — celebration helpers.
  // ---------------------------------------------------------------------------

  #reducedMotion() {
    try {
      return typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  async #fireConfetti(big) {
    if (this.#reducedMotion()) return;
    try {
      const mod = await import('canvas-confetti');
      const confetti = mod.default || mod;
      const colors = ['#f5a623', '#ffc04d', '#ffffff', '#22c55e'];
      confetti({ particleCount: big ? 160 : 80, spread: big ? 100 : 70, origin: { y: 0.5 }, colors });
      if (big) {
        setTimeout(() => {
          try {
            confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors });
            confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors });
          } catch { /* no-op */ }
        }, 250);
      }
    } catch { /* node:test / offline — no confetti, no crash */ }
  }

  // ---------------------------------------------------------------------------
  // Mount / unmount.
  // ---------------------------------------------------------------------------

  connectedCallback() {
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
          <div data-bind="ldj-status-cold-start" class="ldj-cold-start">
            <p>Game starts soon, no jackpots yet.</p>
            <p class="ldj-subtle">When the first day completes, this is where the wins will appear.</p>
          </div>

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

            <!-- The day-results list ("What the draw paid"), the foil-ticket
                 strip, and the "N winners this day · top hit …" caption were all
                 removed 2026-07-29 (user calls: "the ugly foil tickets and the
                 big list of what everyone else won", then the caption). The
                 widget is the draw and the scratch; DAY SUMMARY still opens
                 the player's own popup, and the caption survives as that popup's
                 NO HIT subtitle (#dayStatsText).
                 What could NOT just go: a matched foil line pays a bonus spin, and
                 the CLAIM button lived inside that strip. This bar is that button
                 and nothing else — hidden unless a line is actually claimable. -->
            <div class="ldj-foil-claimbar" data-bind="ldj-foil-claimbar" hidden></div>
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

    this.#showContent();
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
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
  }
}

// Idempotency-guarded register (Phase 58 pattern).
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('last-day-jackpot')) {
    customElements.define('last-day-jackpot', LastDayJackpot);
  }
}
