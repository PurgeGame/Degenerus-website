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
//     prizes) to write the spun_day spoiler key and run the winner effect when
//     viewed player won, light up the cabinet's foil bank, and dispatch
//     `jackpot:revealed` (winnings banner signal);
//   - renders the compact day shell and publishes earned foil-match claims to
//     the shared pending tray (no winner-address dumps or inline foil strip).
//
// Phase 59 relics removed in the rebuild: the roll1/roll2 data grids, the
// Replay state machine, winner classification lists, and the winner summary
// table (the "Type/Win/Uniq/Spread" spam).

import { subscribe, get, getViewedAddress } from '../app/store.js';
import { formatEth, formatFlip } from '../viewer/utils.js';
import { CHAIN } from '../app/chain-config.js';
// Phase 64 — foil-ticket matching pure grading helpers.
import {
  claimableDrawGrades,
  FOIL_CLAIM_THRESHOLD,
  gradeLine,
  normalizeFoilLine,
  unpackWinSet,
} from '../app/foil-match.js';
import { traitToBadge } from '../app/jackpot-data.js';
import { applyDgnTicketAccent } from '../app/dgn-traits.js';
import { fetchJSON } from '../app/api.js';
// Reveal-engine wiring: the viewed player's jackpot winnings auto-play a
// celebration sequence; a claimed foil match reveals its payout box-spin.
import {
  PACK_REVEAL_COMPLETE_EVENT,
  REVEAL_OVERLAY_IDLE_EVENT,
  queueReveal,
} from './reveal-overlay.js';
import {
  claimFoilMatch,
  FOIL_TIER_FACES,
  parseFoilMatchClaimedFromReceipt,
} from '../app/foil-claim.js';
import { parseOpenLegsFromReceipt } from '../app/lootbox-legs.js';
import { readResolvedCoinflipStake } from '../app/coinflip.js';
import { loadDayLootboxResults } from '../app/day-lootbox-results.js';
import {
  publishPendingActions,
  clearPendingActions,
  reportPendingActionError,
} from '../app/pending-actions.js';
import { compactUiError } from '../app/ui-error.js';
import { dailyJackpotProcessingSignals } from '../app/jackpot-processing.js';
import { normalizeLastDayPayload } from '../app/last-day-state.js';
import { foilPackDisplayLevel } from '../app/active-level.js';
import { buildDaySummaryPrizes } from '../app/day-summary-prizes.js';
import { registerComponentPoll } from '../app/component-poll.js';

const FOIL_MATCH_ACTION_SOURCE = 'foil-match';
const FOIL_MATCH_FLASH_MS = 640;
const FOIL_REFRESH_INTERVAL_MS = 60_000;
const DAY_SUMMARY_RECEIPT_REVISION = 'v3';

function _terminalFoilClaimError(error) {
  const seen = new Set();
  const pending = [error];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || (typeof current !== 'object' && typeof current !== 'function')
      || seen.has(current)) continue;
    seen.add(current);
    for (const value of [
      current.code,
      current.errorName,
      current.revert?.name,
      current.reason,
      current.shortMessage,
      current.message,
    ]) {
      const match = /(NoClaimableMatch|GameOver)/.exec(String(value || ''));
      if (match) return match[1];
    }
    for (const nested of [current.cause, current.error, current.info?.error]) {
      if (nested) pending.push(nested);
    }
  }
  return null;
}

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
  #daySync = null;       // direct GAME day; jackpot and coinflip expose independent lanes
  #gameState = null;     // /game/state exposes the ticket-drain phase between those lanes
  #poolBenchmarks = null; // direct contract phase closes the final sealed-window gap
  #hasNewDayAvailable = false; // Legacy banner fallback; normal flow auto-follows.
  #winners = [];
  // Phase 64 — foil strip state + panel bridge state.
  #foilData = null;
  #foilDataKey = null;
  #foilSeq = 0;
  #foilPollHandle = null;
  #bridgeTimer = null;
  #bridgeAttempts = 0;
  #spinStartListener = null;
  #spinCompleteListener = null;
  #scratchCompleteListener = null;
  #decimatorOpenedListener = null;
  #packRevealCompleteListener = null;
  #revealOverlayIdleListener = null;
  #foilSlottingArmed = null;
  #foilSlottingPending = false;
  // A completed foil reveal is the authority for the four tickets that must
  // visibly seat. A one-day jackpot can advance the live purchase target while
  // the fullscreen pack is still open; without this pin the idle refresh would
  // fetch the next level and animate an entirely different pack into the bank.
  #slottedFoilLevel = null;
  #foilClaimBusy = false; // one in-flight foil claim at a time
  #locallyClaimedFoilMatches = new Set(); // bridge tx receipt → indexer catch-up
  // A completed final board audits its resolved-level pack before the cabinet
  // follows the contract into the next buy level. The audit stays open while
  // any payable tuple remains unclaimed, so a level handoff cannot eject the
  // winning ticket the player still needs to collect.
  #foilRetiredResolvedLevel = null;
  #foilMainActivated = false;  // this tab has landed Roll 1 for the pinned day
  #foilBonusActivated = false; // this tab has landed Roll 2 for the pinned day
  #foilMainClaimReady = false;  // Roll 1 scratch gate cleared in this tab
  #foilBonusClaimReady = false; // Roll 2 scratch gate cleared in this tab
  // The reels' presentation for the spin currently on screen, as published by
  // replay:spin-progress. `traits` reports reel locks; while a spin is active,
  // only main-draw locks are durable foil grades. `liveTraits` holds the exact
  // current frame and is replaced as the reels cycle. Bonus completion promotes
  // the authoritative packed set separately. This presentation is never a
  // record — nothing here opens a spoiler or claim gate.
  #foilPresentation = null;
  #foilFlashQuadrants = new Set();
  #foilFlashTimers = new Map();
  #spinProgressListener = null;
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
  // DAY SUMMARY becomes available only after the board and flip are complete,
  // but every input is already knowable when the main jackpot spin starts.
  // Warm it beneath the reel/scratch choreography, then let the eventual click
  // consume shared values instead of beginning any history work of its own.
  #summaryActivityKey = null;
  #summaryActivityValue = undefined;
  #summaryActivityPromise = null;
  #summaryWinnersKey = null;
  #summaryWinnersValue = undefined;
  #summaryWinnersPromise = null;
  #summaryCoinflipKey = null;
  #summaryCoinflipValue = undefined;
  #summaryCoinflipPromise = null;
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

  #syncAppliesToPinned() {
    return this.#manualReplayDay == null
      && Number(this.#daySync?.day) === Number(this.#pinnedDay);
  }

  #hasExactResolvedJackpotPayload() {
    return Number(this.#lastPayload?.day) === Number(this.#pinnedDay)
      && (this.#lastPayload?.status === 'resolved'
        || this.#lastPayload?.status === 'resolved-no-winners');
  }

  #syncWarming() {
    // The exact resolved jackpot payload is the data the board needs. It is
    // sufficient even if app.daySync has not latched the same app.lastDay
    // update yet; requiring both copies could strand a completed draw.
    return this.#syncAppliesToPinned() && !this.#hasExactResolvedJackpotPayload();
  }

  #syncReplayProcessingState(panel = this.#panel()) {
    if (!panel || typeof panel.setJackpotProcessingState !== 'function') return;
    const gameState = this.#gameState ?? get('app.gameState');
    const contractPhase = (this.#poolBenchmarks ?? get('app.poolBenchmarks'))?.contractPhase;
    const payloadIsPinned = Number(this.#lastPayload?.day) === Number(this.#pinnedDay);
    const indexedPurchaseLevel = Number(
      payloadIsPinned ? this.#lastPayload?.roll1?.purchaseLevel : null,
    );
    const livePurchaseLevel = this.#syncAppliesToPinned()
      ? foilPackDisplayLevel(gameState, contractPhase)
      : null;
    const purchaseLevel = Number.isInteger(indexedPurchaseLevel) && indexedPurchaseLevel > 0
      ? indexedPurchaseLevel
      : livePurchaseLevel;
    panel.setJackpotProcessingState({
      ...dailyJackpotProcessingSignals({
      day: this.#pinnedDay,
      daySync: this.#daySync,
      gameState,
      jackpotPayload: this.#lastPayload,
      }),
      // The slow pre-RNG reel exists before replay/day has a settled Roll 1
      // row. Give it the cabinet's live ticket level so pink/blue can still be
      // graded against the viewed player's real holdings during that window.
      purchaseLevel,
    });
  }

  #onGameState(state) {
    const priorFoilLevel = this.#foilTargetLevel();
    this.#gameState = state && typeof state === 'object' ? state : null;
    const slottedLevel = Number(this.#slottedFoilLevel);
    const liveFoilLevel = foilPackDisplayLevel(
      this.#gameState,
      this.#poolBenchmarks?.contractPhase,
    );
    const levelPassedSlottedPack = Number.isInteger(slottedLevel)
      && slottedLevel > 0
      && Number.isInteger(liveFoilLevel)
      && liveFoilLevel > slottedLevel;
    // A phase handoff can land while the fullscreen foil pack is still open.
    // Finish that release and its seating frame before retiring the old level;
    // the next routine game-state poll completes the rollover. Without this
    // guard the PURCHASE update deletes the very pack the player is watching.
    const armedLevel = Number(this.#foilSlottingArmed);
    const slottingInFlight = (Number.isInteger(armedLevel) && armedLevel > 0)
      || this.#foilSlottingPending === true;
    // The chain can enter PURCHASE/end-phase while the final jackpot is still
    // spinning or being scratched. The presentation owns its resolved pack
    // until completion; an unclaimed payout continues owning it afterward.
    const cabinetStillOwnsSlottedPack = Number(this.#foilTargetLevel()) === slottedLevel;
    const deferSlottedRollover = levelPassedSlottedPack
      && (slottingInFlight || cabinetStillOwnsSlottedPack);
    if (levelPassedSlottedPack && !deferSlottedRollover) {
      // A completed reveal may pin its exact pack while the same numeric level
      // changes cadence. That protection ends at the real cabinet rollover:
      // old-level foil tickets must vacate before the new level's read lands.
      this.#resetFoilSlotting();
      this.#foilSeq += 1;
      this.#foilData = null;
      this.#foilDataKey = null;
      this.#renderFoil();
    }
    const resolvedLevel = this.#resolvedFoilLevel();
    const needsResolvedPackAudit = this.#foilBoardComplete()
      && resolvedLevel != null
      && Number(liveFoilLevel) !== resolvedLevel
      && Number(this.#foilRetiredResolvedLevel) !== resolvedLevel;
    if (needsResolvedPackAudit) this.#renderFoil();
    this.#syncReplayProcessingState();
    if (!deferSlottedRollover
      && (levelPassedSlottedPack || this.#foilTargetLevel() !== priorFoilLevel)) {
      void this.#refreshFoil();
    }
  }

  #onPoolBenchmarks(benchmarks) {
    const priorFoilLevel = this.#foilTargetLevel();
    this.#poolBenchmarks = benchmarks && typeof benchmarks === 'object' ? benchmarks : null;
    if (this.#foilTargetLevel() !== priorFoilLevel) void this.#refreshFoil();
  }

  #replayShowsPinnedDay(panel = this.#panel()) {
    const daySelect = panel?.querySelector?.('[data-bind="day-select"]');
    const replayDay = Number(daySelect?.value);
    return Number.isInteger(replayDay)
      && replayDay > 0
      && replayDay === Number(this.#pinnedDay);
  }

  #setReplayWarming(warming) {
    const panel = this.#panel();
    if (!panel) return;
    // During the indexer handoff the replay panel can still be showing the
    // previous resolved day. That board remains a real, playable draw (most
    // importantly, its pending Bonus Spin), so the new-day blue/inert mask
    // must not be painted over it. Apply the mask only after the target day is
    // actually selected in replay-panel.
    if (warming && this.#replayShowsPinnedDay(panel)) {
      panel.setAttribute?.('data-day-warming', '');
      panel.setAttribute?.('aria-busy', 'true');
    } else {
      panel.removeAttribute?.('data-day-warming');
      // replay-panel owns a second, narrower gate while its exact roll/bucket
      // endpoints are loading. Do not clear that busy signal merely because
      // the outer chain/indexer handoff has completed.
      if (!panel.hasAttribute?.('data-day-loading')) panel.removeAttribute?.('aria-busy');
    }
  }

  #primeChainDay(day) {
    this.#pinnedDay = day;
    this.#pinnedLevel = null;
    this.#manualReplayDay = null;
    this.#lastPayload = null;
    this.#hasNewDayAvailable = false;
    this.#hideNewDayBanner();
    this.#foilSeq += 1;
    this.#foilData = null;
    this.#foilDataKey = null;
    this.#resetFoilSlotting({ preserveInFlight: true });
    clearPendingActions(FOIL_MATCH_ACTION_SOURCE);
    this.#winners = [];
    this.#resetDayGates();
    this.#clearFoilMatchLamps();
    const label = this.querySelector('[data-bind="day"]');
    if (label) label.textContent = `Day ${day}`;
    this.#renderColdStart();
    this.#setReplayWarming(true);
    this.#syncReplayPanel();
    this.#dispatchDaySelection(false);
  }

  #onDaySync(sync) {
    const day = Number(sync?.day);
    this.#daySync = Number.isInteger(day) && day > 0 ? sync : null;
    if (!this.#daySync) return;
    // This is the same direct day boundary that re-fuzzes player amounts. Move
    // the board with it immediately: clear yesterday, start the slow attract
    // roll, and expose the RNG-INCOMING progress state in one visual handoff.
    const genuinelyNew = this.#latestDaySeen == null || day > this.#latestDaySeen;
    if (genuinelyNew) this.#latestDaySeen = day;
    if (this.#pinnedDay == null
      || (genuinelyNew && day !== Number(this.#pinnedDay))
      || (this.#manualReplayDay == null && day !== Number(this.#pinnedDay))) {
      this.#primeChainDay(day);
    }
    this.#syncReplayProcessingState();
    if (Number(this.#pinnedDay) !== day || this.#manualReplayDay != null) return;
    // Coinflip normally resolves first, but it is an independent result. The
    // jackpot becomes playable as soon as its own exact-day payload is ready;
    // a slow or missing coinflip response must never keep this board inert.
    if (!sync.jackpotReady && !this.#hasExactResolvedJackpotPayload()) {
      this.#renderColdStart();
      this.#setReplayWarming(true);
      this.#syncReplayPanel();
      return;
    }
    if (Number(this.#lastPayload?.day) === day) this.#renderForStatus(this.#lastPayload);
    else {
      this.#renderColdStart();
      this.#setReplayWarming(true);
      this.#syncReplayPanel();
    }
  }

  // ---------------------------------------------------------------------------
  // Plan 59-03: localStorage spin-idempotency (chainId-scoped per Pitfall B).
  // All ops try/catch wrapped (Pitfall F — private browsing / QuotaExceededError).
  // Key shape: `spun_day_${CHAIN.id}_${this.#pinnedDay}` → '1' (truthy presence).
  // Phase 64: the key is written when the embedded replay-panel's reveal is
  // FULLY scratched (replay:scratch-complete) — spin end alone would spoil
  // still-covered prizes. It remains the claims-panel spoiler gate.
  // ---------------------------------------------------------------------------
  #spunKey(day = this.#pinnedDay) {
    return `spun_day_${CHAIN.id}_${Number(day)}`;
  }

  #boardCompleteKey(day = this.#pinnedDay) {
    return `jackpot_complete_day_${CHAIN.id}_${Number(day)}`;
  }

  #bonusPendingKey(day = this.#pinnedDay) {
    return `jackpot_bonus_pending_day_${CHAIN.id}_${Number(day)}`;
  }

  #hasSpunPinnedDay() {
    if (this.#pinnedDay == null) return false;
    try {
      return localStorage.getItem(this.#spunKey()) === '1';
    } catch {
      return false;  // private browsing / SecurityError → re-spin acceptable
    }
  }

  #markSpunPinnedDay(day = this.#pinnedDay) {
    if (!Number.isInteger(Number(day)) || Number(day) <= 0) return;
    try {
      localStorage.setItem(this.#spunKey(day), '1');
    } catch {
      // QuotaExceededError / SecurityError — swallow; user re-spins next visit
    }
  }

  #hasCompletedPinnedDay() {
    if (this.#pinnedDay == null) return false;
    try { return localStorage.getItem(this.#boardCompleteKey()) === '1'; }
    catch { return false; }
  }

  #foilBoardComplete() {
    return this.#boardDone || this.#hasCompletedPinnedDay();
  }

  #markCompletedPinnedDay(day = this.#pinnedDay) {
    if (!Number.isInteger(Number(day)) || Number(day) <= 0) return;
    try { localStorage.setItem(this.#boardCompleteKey(day), '1'); }
    catch { /* private browsing: only this refresh loses the preferred view */ }
  }

  #markBonusPending(pending, day = this.#pinnedDay) {
    if (!Number.isInteger(Number(day)) || Number(day) <= 0) return;
    try {
      if (pending) localStorage.setItem(this.#bonusPendingKey(day), '1');
      else localStorage.removeItem(this.#bonusPendingKey(day));
    } catch { /* same-tab event still carries the authoritative final state */ }
  }

  #resolvedFoilLevel() {
    const level = Number(
      this.#lastPayload?.roll1?.purchaseLevel
      ?? this.#lastPayload?.level
      ?? this.#pinnedLevel,
    );
    return Number.isInteger(level) && level > 0 ? level : null;
  }

  #foilTargetLevel() {
    const resolved = this.#resolvedFoilLevel();
    const retiredResolved = Number(this.#foilRetiredResolvedLevel);
    // Contract cadence may already route new purchases forward while this
    // browser is still presenting the old level's last eligible jackpot. Fetch
    // and retain that old pack until the final scratch is complete. Afterward,
    // keep it long enough to audit and settle every outstanding foil payout.
    if (resolved != null
      && (!this.#foilBoardComplete() || retiredResolved !== resolved)) {
      return resolved;
    }

    const slotted = Number(this.#slottedFoilLevel);
    const slottedIsRetiredResolved = resolved != null
      && slotted === resolved
      && retiredResolved === resolved;
    if (Number.isInteger(slotted) && slotted > 0 && !slottedIsRetiredResolved) {
      return slotted;
    }

    // A shell can reconnect after polling has already populated the store.
    // Read that snapshot until the initial subscription callbacks hydrate the
    // instance, so the first paint cannot flash the resolved level's old pack.
    const gameState = this.#gameState ?? get('app.gameState');
    const benchmarks = this.#poolBenchmarks ?? get('app.poolBenchmarks');
    const active = foilPackDisplayLevel(
      gameState,
      benchmarks?.contractPhase,
    );
    return Number.isInteger(active) && active > 0 ? active : resolved;
  }

  #resetFoilSlotting({ preserveInFlight = false } = {}) {
    const armedLevel = Number(this.#foilSlottingArmed);
    const slottedLevel = Number(this.#slottedFoilLevel);
    const releaseInFlight = (Number.isInteger(armedLevel) && armedLevel > 0)
      || (this.#foilSlottingPending
        && Number.isInteger(slottedLevel)
        && slottedLevel > 0);
    if (preserveInFlight && releaseInFlight) return;
    this.#foilSlottingArmed = null;
    this.#foilSlottingPending = false;
    this.#slottedFoilLevel = null;
  }

  #activatedFoilSets({ claimableOnly = false } = {}) {
    const replayFresh = Number(this.#manualReplayDay) === Number(this.#pinnedDay);
    const mainActive = (claimableOnly ? this.#foilMainClaimReady : this.#foilMainActivated)
      || (!replayFresh && this.#hasSpunPinnedDay());
    // The landed bonus result lights the cabinet immediately, just like Roll 1.
    // Its claim tuple remains independently hidden until the bonus scratch gate
    // opens, so lighting the foils cannot spoil or publish the covered payout.
    const bonusActive = (claimableOnly ? this.#foilBonusClaimReady : this.#foilBonusActivated)
      || (!replayFresh && this.#hasCompletedPinnedDay());
    const summary = this.#lastPayload?.summary;
    const levelLocked = this.#foilLevelLocked();
    return {
      mainSet: mainActive && levelLocked ? (summary?.rollOne?.mainTraitsPacked ?? null) : null,
      bonusSet: bonusActive && levelLocked ? (summary?.rollTwo?.bonusTraitsPacked ?? null) : null,
    };
  }

  // The seated pack is only comparable to the board in front of it when both
  // belong to the same level. Every path that lights a foil face — settled or
  // mid-spin — passes through here, so a pack bought for the next level cannot
  // light against the level currently resolving.
  #foilLevelLocked() {
    const foilLevel = Number(this.#foilData?.level ?? this.#foilTargetLevel());
    const resolvedLevel = this.#resolvedFoilLevel();
    return resolvedLevel != null && foilLevel === resolvedLevel;
  }

  // Grade one foil line against the current reel presentation. A committed
  // main face wins over its live counterpart and remains durable; every bonus
  // face and every unlocked main face uses the replaceable live grade. Returns null
  // whenever there is no valid presentation, it belongs to another day, or the
  // pack is off-level.
  //
  // Grading is gradeLine, unmodified. The presentation shows the real draw, so
  // these faces are the same faces the settled render arrives at; merging the
  // two with Math.max is what makes settling a lit quadrant a no-op instead of
  // a repaint.
  #foilPresentationGrade(line) {
    const presentation = this.#foilPresentation;
    const traits = Array.isArray(presentation?.traits) ? presentation.traits : [];
    const liveTraits = Array.isArray(presentation?.liveTraits) ? presentation.liveTraits : [];
    if (traits.length === 0 && liveTraits.length === 0) return null;
    if (Number(presentation.day) !== Number(this.#pinnedDay)) return null;
    if (!this.#foilLevelLocked()) return null;
    let committed = 0;
    let visible = 0;
    let packed = 0;
    const validTrait = (trait) => typeof trait === 'number'
      && Number.isInteger(trait) && trait >= 0 && trait <= 255;
    for (let quadrant = 0; quadrant < 4; quadrant += 1) {
      // Main locks are durable. While Roll 2 is still moving, its locks only
      // describe where a reel stopped, so only the exact currently displayed
      // live face may grade. Completion swaps this presentation for the packed
      // bonus set in #onPanelSpinComplete.
      const lockedTrait = presentation?.bonusPhase === true ? null : traits[quadrant];
      const trait = validTrait(lockedTrait) ? lockedTrait : liveTraits[quadrant];
      // Deliberately typeof-strict rather than Number()-coerced: null means no
      // painted/committed face, while Number(null) is a valid trait byte (0).
      if (!validTrait(trait)) continue;
      packed |= trait << (quadrant * 8);
      visible |= 1 << quadrant;
      if (validTrait(lockedTrait)) committed |= 1 << quadrant;
    }
    if (visible === 0) return null;
    const { faces } = gradeLine(line, packed >>> 0);
    return {
      committed,
      visible,
      faces: faces.map((face, quadrant) => (((visible >> quadrant) & 1) ? face : 0)),
    };
  }

  // Match classes carry the steady lamps: badge-only for a symbol and badge +
  // quadrant for a full match. Keep the brighter lock-on pop on its own clock
  // so each reel landing still has a crisp beginning without restarting the
  // lamps that earlier reels already earned.
  #clearFoilMatchFlashes() {
    for (const handle of this.#foilFlashTimers.values()) {
      try { clearTimeout(handle); } catch { /* defensive */ }
    }
    this.#foilFlashTimers.clear();
    this.#foilFlashQuadrants.clear();
    this.querySelectorAll?.('.ldj-foil-machine-cell')?.forEach?.((cell) => {
      cell.classList?.remove?.('is-match-flash');
    });
  }

  #startFoilMatchFlashes(quadrants) {
    for (const quadrant of quadrants) {
      const previous = this.#foilFlashTimers.get(quadrant);
      if (previous != null) {
        try { clearTimeout(previous); } catch { /* defensive */ }
      }
      this.#foilFlashQuadrants.add(quadrant);
      if (typeof setTimeout !== 'function') continue;
      const handle = setTimeout(() => {
        this.#foilFlashTimers.delete(quadrant);
        this.#foilFlashQuadrants.delete(quadrant);
        this.querySelectorAll?.('.ldj-foil-machine-cell')?.forEach?.((cell) => {
          if (Number(cell.getAttribute?.('data-foil-quadrant')) === quadrant) {
            cell.classList?.remove?.('is-match-flash');
          }
        });
      }, FOIL_MATCH_FLASH_MS);
      if (handle && typeof handle.unref === 'function') handle.unref();
      this.#foilFlashTimers.set(quadrant, handle);
    }
  }

  // ---------------------------------------------------------------------------
  // Plan 59-02: app.lastDay subscriber — drives 3-status branch rendering.
  // ---------------------------------------------------------------------------
  #onLastDayUpdate(payload) {
    if (!payload) return;  // first cycle 404 / undefined initial subscribe fire
    payload = normalizeLastDayPayload(payload);
    const parsedDay = payload.day == null ? null : Number(payload.day);
    const payloadDay = Number.isFinite(parsedDay) && parsedDay > 0 ? parsedDay : null;
    const isNewLatest = payloadDay != null
      && (this.#latestDaySeen == null || payloadDay > this.#latestDaySeen);
    if (isNewLatest) this.#latestDaySeen = payloadDay;

    if (this.#pinnedDay == null) {
      this.#lastPayload = payload;
      if (payloadDay != null) this.#adoptLatestDay(payload, false);
      else this.#renderForStatus(payload);
      return;
    }

    if (isNewLatest && payloadDay !== Number(this.#pinnedDay)) {
      this.#lastPayload = payload;
      this.#adoptLatestDay(payload, true);
      return;
    }

    if (payloadDay === Number(this.#pinnedDay)) {
      this.#lastPayload = payload;
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
    this.#resetFoilSlotting({ preserveInFlight: true });
    clearPendingActions(FOIL_MATCH_ACTION_SOURCE);
    this.#winners = [];
    if (resetGates) this.#resetDayGates();
    // Same boundary, reached from the indexed lastDay feed instead of the
    // chain clock. resetGates IS the "this is a different day" signal here;
    // the first adoption of a freshly mounted board has no lit sockets to
    // clear and no pack fetched yet.
    if (resetGates) this.#clearFoilMatchLamps();
    this.#renderForStatus(payload);
    this.#dispatchDaySelection(false);
  }

  /**
   * Put the foil cabinet back to dormant on a day boundary.
   *
   * The match lamps are day state that lives in the DOM. Both day-advance
   * paths clear the MODEL the lamps derive from — the day's payload, the
   * activation gates, the cached pack — but a socket already showing
   * is-symbol-match/is-color-match keeps showing it until something repaints
   * the cabinet, and neither path did. Every trigger that eventually cleared
   * them (a level change, a wallet change, the next spin, a manual day pick)
   * is an unrelated event that may not arrive for hours, so yesterday's hits
   * sat lit over today's undrawn board.
   *
   * Call this AFTER the gates are down: the repaint reads them, so the
   * sockets fail closed to dormant. The refresh then re-seats them against
   * the new day's own data, which is the only thing allowed to light them
   * again.
   */
  #clearFoilMatchLamps() {
    this.#renderFoilBackdrop();
    void this.#refreshFoil();
  }

  #renderForStatus(payload) {
    this.#showContent();
    if (this.#syncWarming()) {
      this.#renderColdStart();
      this.#setReplayWarming(true);
      this.#syncReplayPanel();
      this.#renderHistoryNav();
      return;
    }
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
    this.#resetFoilSlotting();
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
    this.#syncReplayProcessingState(panel);
    const daySelect = panel.querySelector('[data-bind="day-select"]');
    const playerSelect = panel.querySelector('[data-bind="player-select"]');
    let insertedProcessingDay = false;
    let hasPinnedDay = daySelect?.options
      && Array.from(daySelect.options).some(
        (option) => String(option.value) === String(this.#pinnedDay),
      );
    if (!hasPinnedDay && this.#syncWarming() && daySelect
      && typeof document !== 'undefined' && typeof document.createElement === 'function') {
      // The request exists before the indexer's replay row. Mount a temporary
      // target immediately so replay-panel clears yesterday's board and its
      // existing determinate JACKPOT PROCESSING button starts at step zero.
      const option = document.createElement('option');
      option.value = String(this.#pinnedDay);
      option.textContent = `Day ${this.#pinnedDay} — processing`;
      option.dataset.processingDay = 'true';
      daySelect.appendChild(option);
      if (Array.isArray(daySelect.options) && !daySelect.options.includes(option)) {
        daySelect.options.push(option);
      }
      hasPinnedDay = true;
      insertedProcessingDay = true;
    }
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
    // Start the forced feed reload only after selecting the placeholder. The
    // replay loader snapshots the current selection before its first await;
    // doing this earlier would snapshot yesterday and restore it over the new
    // processing board when an early /rng response still omitted today.
    if (insertedProcessingDay && typeof panel.refreshDays === 'function') {
      try { Promise.resolve(panel.refreshDays({ force: true })).catch(() => {}); }
      catch { /* older replay-panel / fakeDOM */ }
    }
    // Player defaults are seeded by main.js (sDGNRS house view when nothing
    // else is connected), so getViewedAddress() is the single source of truth.
    const addr = getViewedAddress();
    if (addr) this.#ensureZeroEntryPlayerOption(playerSelect, addr);
    const playerOk = addr ? this.#setSelectAndFire(playerSelect, addr) : false;
    this.#renderHistoryNav();
    const synced = dayOk && playerOk;
    if (synced) {
      const warming = this.#syncWarming();
      this.#setReplayWarming(warming);
      // Persistence belongs to the day currently mounted in replay-panel.
      // Sending the incoming day's state while yesterday is still selected
      // can reset that live board and strand its Bonus Spin.
      if (this.#replayShowsPinnedDay(panel)
        && typeof panel.setPersistedRevealState === 'function') {
        const replayFresh = Number(this.#manualReplayDay) === Number(this.#pinnedDay);
        panel.setPersistedRevealState(
          (replayFresh || warming) ? false : this.#hasSpunPinnedDay(),
          (replayFresh || warming) ? false : this.#hasCompletedPinnedDay(),
        );
      }
    }
    return synced;
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
      this.#setReplayWarming(false);
      this.#historyMetadataSeq += 1;
      this.#foilSeq += 1;
      this.#foilData = null;
      this.#foilDataKey = null;
      this.#resetFoilSlotting();
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
    this.#setReplayWarming(this.#syncWarming());
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

  // Repaint the seated foils against what is on the board RIGHT NOW. Cycling
  // faces contribute replaceable transient lamps; newly committed quadrants
  // become durable and receive the one-shot lock pop.
  //
  // Presentation only. It opens no gate, writes no key, and publishes no
  // claim; #onPanelSpinComplete below is still what powers the settled state,
  // and scratch completion is still the spoiler/claim gate. Malformed or
  // absent arrays fail closed to dormant.
  #onPanelSpinProgress(e) {
    const d = e?.detail;
    const eventDay = Number(d?.day);
    if (!Number.isInteger(eventDay) || eventDay <= 0
      || eventDay !== Number(this.#pinnedDay)) return;
    const traits = Array.isArray(d?.traits) ? d.traits.slice(0, 4) : null;
    const liveTraits = Array.isArray(d?.liveTraits) ? d.liveTraits.slice(0, 4) : null;
    const bonusPhase = d?.bonusPhase === true;
    const prior = Number(this.#foilPresentation?.day) === eventDay
      && this.#foilPresentation?.bonusPhase === bonusPhase
      && Array.isArray(this.#foilPresentation?.traits)
      ? this.#foilPresentation.traits
      : [];
    const validTrait = (trait) => typeof trait === 'number'
      && Number.isInteger(trait) && trait >= 0 && trait <= 255;
    const newlyCommitted = traits
      ? traits.flatMap((trait, quadrant) => (
        validTrait(trait) && !validTrait(prior[quadrant]) ? [quadrant] : []
      ))
      : [];
    if (!traits || !traits.some(validTrait)) this.#clearFoilMatchFlashes();
    this.#foilPresentation = traits || liveTraits
      ? { day: eventDay, bonusPhase, traits: traits || [], liveTraits: liveTraits || [] }
      : null;
    this.#startFoilMatchFlashes(newlyCommitted);
    this.#renderFoilBackdrop();
  }

  #warmDaySummary(viewed, day) {
    void this.#dayActivity(viewed, day);
    void this.#daySummaryWinners(day);
    void this.#loadExactSummaryCoinflip(day);
  }

  #onPanelSpinStart(e) {
    const d = e?.detail;
    const eventDay = Number(d?.day);
    if (!Number.isInteger(eventDay) || eventDay <= 0
      || eventDay !== Number(this.#pinnedDay)) return;
    this.#warmDaySummary(d?.player || getViewedAddress(), eventDay);
  }

  // A completed spin promotes its settled draw into a durable foil lane. Bonus
  // completion also replaces Roll 2's live presentation with the authoritative
  // packed result, so its final lights remain on instead of disappearing.
  // Claims, persistence, and follow-on UI remain gated behind the player's
  // scratch completion below.
  #onPanelSpinComplete(e) {
    const d = e?.detail;
    const eventDay = Number(d?.day);
    if (!Number.isInteger(eventDay) || eventDay <= 0
      || eventDay !== Number(this.#pinnedDay)) return;
    // Compatibility fallback for older replay panels without spin-start. The
    // current panel began this shared warm before its first reel frame.
    this.#warmDaySummary(d?.player || getViewedAddress(), eventDay);
    if (d?.bonusPhase === true) {
      this.#foilBonusActivated = true;
      this.#foilPresentation = null;
      this.#clearFoilMatchFlashes();
    } else {
      this.#foilMainActivated = true;
    }
    this.#renderFoilBackdrop();
  }

  // Panel reveal fully scratched — open the spoiler gate and fire follow-on
  // UI. Fires per roll (Roll 1, then bonus Roll 2); every step below is
  // idempotent, and the winner effect is additionally once-per-day guarded.
  #onPanelScratchComplete(e) {
    const d = e?.detail;
    const reportedDay = Number(d?.day);
    const eventDay = Number.isInteger(reportedDay) && reportedDay > 0
      ? reportedDay
      : Number(this.#pinnedDay);
    if (!Number.isInteger(eventDay) || eventDay <= 0) return;

    // The chain clock can pin tomorrow while yesterday's still-mounted board
    // remains scratchable. Persist against the board that emitted the event,
    // never whichever day the host happened to pin a few milliseconds later.
    const appliesToPinnedDay = eventDay === Number(this.#pinnedDay);
    this.#markSpunPinnedDay(eventDay);
    if (appliesToPinnedDay) {
      this.#sawScratchEvent = true;
      // Keep scratch completion as a compatibility fallback for older panels
      // that do not emit replay:spin-complete.
      this.#foilMainActivated = true;
      this.#foilMainClaimReady = true;
      if (d?.bonusPhase === true) {
        this.#foilBonusActivated = true;
        this.#foilBonusClaimReady = true;
      }
      this.#renderFoil();
    }
    // The replay board itself knows whether THIS scratch phase contained an
    // actual personal payout and owns its phase-scoped celebration. Do not add
    // day-wide host celebration here: a player who wins only the other roll
    // would otherwise get a winner effect over a losing scratchoff.
    const viewed = d?.player || (appliesToPinnedDay ? getViewedAddress() : null);
    const target = viewed ? String(viewed).toLowerCase() : null;
    const mine = Boolean(appliesToPinnedDay && target && (this.#winners || []).some(
      (w) => String(w.address || '').toLowerCase() === target,
    ));
    // Final roll? (bonus phase completing, or roll 1 with no bonus ahead).
    // A detail-less event (older panel / tests) counts as final.
    const final = !d || d.bonusPhase === true || !d.bonusAvailable;
    if (final) {
      if (appliesToPinnedDay) {
        this.#boardDone = true;
        this.#manualReplayDay = null;
      }
      this.#markCompletedPinnedDay(eventDay);
      this.#markBonusPending(false, eventDay);
      // #renderFoil above ran while #boardDone was still false. Re-run the
      // resolved-pack audit now that the final presentation is actually over;
      // it either preserves an unclaimed winner or releases the cabinet.
      if (appliesToPinnedDay) this.#renderFoil();
    } else {
      // `spun_day` predates the all-roll completion key and is written after
      // Roll 1. Persist the distinction so a reload cannot mistake a still-
      // available bonus roll for a fully played legacy board.
      this.#markBonusPending(true, eventDay);
    }
    if (appliesToPinnedDay) this.#maybeShowResultsCta();
    // Same-tab signal consumed by the winnings banner (app-claims-panel).
    try {
      const detail = {
        day: eventDay,
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

  // A due Decimator owns the transition before the ordinary daily jackpot.
  // Older builds could accidentally persist the previous board's late
  // scratch event against this incoming day, making the fresh draw jump from
  // PROCESSING straight to its completed state. Once the Decimator really
  // opens, clear only this exact day's reveal receipts and re-arm its board.
  #onDecimatorOpened(e) {
    const eventDay = Number(e?.detail?.day);
    const eventLevel = Number(e?.detail?.level);
    if (!Number.isInteger(eventDay) || eventDay <= 0
      || eventDay !== Number(this.#pinnedDay)) return;
    if (this.#pinnedLevel != null
      && Number.isInteger(eventLevel)
      && eventLevel !== Number(this.#pinnedLevel)) return;

    try {
      localStorage.removeItem(this.#spunKey(eventDay));
      localStorage.removeItem(this.#boardCompleteKey(eventDay));
      localStorage.removeItem(this.#bonusPendingKey(eventDay));
    } catch { /* private browsing: the in-memory reset still repairs this tab */ }
    this.#boardDone = false;
    this.#sawScratchEvent = false;
    this.#foilMainActivated = false;
    this.#foilBonusActivated = false;
    this.#foilMainClaimReady = false;
    this.#foilBonusClaimReady = false;
    this.#foilRetiredResolvedLevel = null;
    this.#foilPresentation = null;
    this.#clearFoilMatchFlashes();
    this.#manualReplayDay = null;
    this.#setResultsCtaVisible(this.#resultsCta(), false);

    const panel = this.#panel();
    if (!this.#syncWarming()
      && this.#replayShowsPinnedDay(panel)
      && typeof panel?.setPersistedRevealState === 'function') {
      panel.setPersistedRevealState(false, false);
    }
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
    this.#clearSummaryActivityCache();
    this.#boardDone = false;
    this.#sawScratchEvent = false;
    this.#foilMainActivated = false;
    this.#foilBonusActivated = false;
    this.#foilMainClaimReady = false;
    this.#foilBonusClaimReady = false;
    this.#foilRetiredResolvedLevel = null;
    this.#foilPresentation = null;
    this.#clearFoilMatchFlashes();
    this.#flipResult = undefined;
    this.#flipFetchedDay = null;
    const cta = this.#resultsCta();
    this.#setResultsCtaVisible(cta, false);
    this.#syncCoinflipHandoff();
  }

  #syncCoinflipHandoff() {
    const panel = this.#panel();
    if (!panel || typeof panel.setCoinflipHandoff !== 'function') return;
    const exactRowKnown = this.#pinnedDay != null
      && Number(this.#flipFetchedDay) === Number(this.#pinnedDay);
    panel.setCoinflipHandoff({
      day: this.#pinnedDay,
      available: Boolean(exactRowKnown && this.#flipResult != null),
      revealed: this.#flipGateOpen(),
    });
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
    // v3 re-arms receipts whose coinflip card may have inherited a level-scoped
    // outcome from another day. The existing deployment cleanup prefix still
    // covers every revision.
    return `day_summary_${CHAIN.id}_${this.#pinnedDay}_${player}_${DAY_SUMMARY_RECEIPT_REVISION}`;
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
      const data = await fetchJSON(`/game/coinflip/day/${day}`);
      if (this.#pinnedDay !== day) return; // day re-pinned mid-flight
      this.#flipResult = data ?? null;
      this.#flipFetchedDay = day;
    } catch { /* network blip / headless — key-only gate */ }
    this.#maybeShowResultsCta();
  }

  /** Share replay-panel's single action row with Spin Jackpot. */
  #mountResultsCta(cta) {
    if (!cta || typeof document === 'undefined') return;
    const replay = document.querySelector('replay-panel');
    const controls = replay?.querySelector?.('.replay-controls');
    // This action replaces Spin Jackpot; it must never fall through into a
    // second row below the cabinet while replay-panel is still upgrading.
    if (!controls || cta.parentNode === controls || cta.parentElement === controls) return;
    try { controls.appendChild(cta); } catch { /* fakeDOM — leave it in the shell */ }
  }

  #setResultsCtaVisible(cta, visible) {
    if (cta) cta.hidden = !visible;
    if (typeof document === 'undefined') return;
    const replay = document.querySelector('replay-panel');
    const controls = replay?.querySelector?.('.replay-controls');
    const reveal = replay?.querySelector?.('[data-bind="reveal-btn"]');
    // Never force Spin Jackpot back on: replay-panel owns when that button is
    // valid. We only guarantee that the two actions cannot coexist.
    if (visible && reveal && replay?.getAttribute?.('data-primary-action') !== 'decimator') {
      reveal.hidden = true;
    }
    const slot = document.querySelector('[data-bind="day-summary-slot"]');
    if (slot) slot.hidden = true;
  }

  #maybeShowResultsCta() {
    const cta = this.#resultsCta();
    if (!cta) return;
    this.#syncCoinflipHandoff();
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
    if (show) this.#warmDaySummary(getViewedAddress(), this.#pinnedDay);
  }

  #clearSummaryActivityCache() {
    this.#summaryActivityKey = null;
    this.#summaryActivityValue = undefined;
    this.#summaryActivityPromise = null;
    this.#summaryWinnersKey = null;
    this.#summaryWinnersValue = undefined;
    this.#summaryWinnersPromise = null;
    this.#summaryCoinflipKey = null;
    this.#summaryCoinflipValue = undefined;
    this.#summaryCoinflipPromise = null;
  }

  #dayActivity(viewed, day) {
    const player = viewed ? String(viewed).toLowerCase() : '';
    const numericDay = Number(day);
    if (!player || !Number.isInteger(numericDay) || numericDay <= 0) {
      return Promise.resolve(null);
    }
    const key = `${player}|${numericDay}`;
    if (this.#summaryActivityKey === key) {
      if (this.#summaryActivityValue !== undefined) {
        return Promise.resolve(this.#summaryActivityValue);
      }
      if (this.#summaryActivityPromise) return this.#summaryActivityPromise;
    }

    this.#summaryActivityKey = key;
    this.#summaryActivityValue = undefined;
    let flight;
    flight = this.#loadDayActivity(player, numericDay)
      .catch(() => null)
      .then((activity) => {
        if (this.#summaryActivityKey === key) this.#summaryActivityValue = activity;
        return activity;
      })
      .finally(() => {
        if (this.#summaryActivityKey === key && this.#summaryActivityPromise === flight) {
          this.#summaryActivityPromise = null;
        }
      });
    this.#summaryActivityPromise = flight;
    return flight;
  }

  async #loadDayActivity(viewed, day) {
    if (!viewed || day == null || typeof fetch !== 'function') return null;
    const player = String(viewed).toLowerCase();
    const address = encodeURIComponent(player);
    const dayParam = encodeURIComponent(String(day));
    const read = (path) => fetchJSON(path, { priority: 'interaction' });
    const [packsResult, viewerResult, resolvedStakeResult] = await Promise.allSettled([
      read(`/player/${address}/packs?day=${dayParam}`),
      read(`/viewer/player/${address}/day/${dayParam}`),
      // The viewer day snapshot currently resolves its coinflip lookup through
      // the jackpot level. A level can span several flip days, so none of that
      // row's coinflip fields are authoritative for this day. Use the immutable
      // exact-day event read for the player's stake and fail closed if unreadable.
      readResolvedCoinflipStake({ player, day }),
    ]);
    // Both APIs have an all-time mode. Treat their echoed day as part of the
    // response contract so a dropped/mishandled query parameter cannot turn a
    // one-day summary into the player's entire history.
    const packsCandidate = packsResult.status === 'fulfilled' ? packsResult.value : null;
    const viewerCandidate = viewerResult.status === 'fulfilled' ? viewerResult.value : null;
    const packs = _isExactDayPayload(packsCandidate, day, player) ? packsCandidate : null;
    const viewer = _isExactDayPayload(viewerCandidate, day, player) ? viewerCandidate : null;
    const ticketRevealPacks = Array.isArray(packs?.ticketRevealPacks)
      ? packs.ticketRevealPacks : [];
    // Count entries, not each pack's rounded-up ticketCount. A reveal drain can
    // stop mid-ticket, so summing per-pack ceilings double-counts a ticket whose
    // four entries land across two packs. Four entries make a ticket.
    const revealedEntries = ticketRevealPacks.reduce((sum, pack) => sum + (
      Array.isArray(pack?.tickets)
        ? pack.tickets.reduce(
            (inner, ticket) => inner + (Array.isArray(ticket?.traits) ? ticket.traits.length : 0),
            0,
          )
        : 0
    ), 0);
    const ticketsRevealed = revealedEntries > 0
      ? revealedEntries / 4
      : ticketRevealPacks.reduce(
          (sum, pack) => sum + Math.max(0, Number(pack?.ticketCount) || 0),
          0,
        );
    const activity = viewer?.activity;
    let crapsActivity = activity?.craps;
    // Completed-day viewer snapshots can predate the Craps field because the
    // cold-history objects are intentionally immutable. Only those legacy
    // shapes need the dedicated, still-indexed fallback; current snapshots
    // carry `craps` (including null) and avoid a fourth request.
    if (!activity || !Object.prototype.hasOwnProperty.call(activity, 'craps')) {
      const fallback = await read(`/viewer/player/${address}/day/${dayParam}/craps`)
        .catch(() => null);
      crapsActivity = _isExactDayPayload(fallback, day, player) ? fallback : null;
    }
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
          player, day, snapshot: viewer, dayPacks: packs, priority: 'interaction',
        }).catch(() => [])
      : [];
    const resolvedStake = resolvedStakeResult.status === 'fulfilled'
      && resolvedStakeResult.value != null
      ? resolvedStakeResult.value
      : null;
    let coinflipStakeAmount = '0';
    let hasCoinflipBet = false;
    try {
      coinflipStakeAmount = BigInt(resolvedStake ?? 0).toString();
      hasCoinflipBet = BigInt(coinflipStakeAmount) > 0n;
    } catch { /* malformed row */ }
    const exactDayResult = this.#flipFetchedDay === day ? this.#flipResult : null;
    const coinflipWon = exactDayResult?.win === true
      ? true
      : exactDayResult?.win === false ? false : null;
    const dayRewardRaw = exactDayResult?.rewardPercent;
    const dayReward = dayRewardRaw == null ? NaN : Number(dayRewardRaw);
    const coinflipRewardPercent = Number.isFinite(dayReward)
      ? Math.max(0, Math.trunc(dayReward))
      : 0;
    let crapsWinningsAmount = '0';
    let crapsWinCount = 0;
    try {
      const indexedWinnings = BigInt(crapsActivity?.totalWinnings ?? 0);
      const indexedWins = Math.max(0, Math.trunc(Number(crapsActivity?.winCount) || 0));
      if (indexedWinnings > 0n && indexedWins > 0) {
        crapsWinningsAmount = indexedWinnings.toString();
        crapsWinCount = indexedWins;
      }
    } catch { /* malformed or stale viewer row: omit the Craps receipt */ }
    return {
      // PACKS-V2 batches every ten revealed tickets for presentation. Those
      // tickets may have been purchased, won, or otherwise awarded, so only
      // report the fact this feed actually proves: how many were revealed.
      ticketsRevealed,
      lootboxesBought,
      lootboxesOpened,
      lootboxResults,
      hasCoinflipBet,
      coinflipWon,
      coinflipStakeAmount,
      coinflipRewardPercent,
      ...(crapsWinCount > 0 ? { crapsWinningsAmount, crapsWinCount } : {}),
    };
  }

  #daySummaryWinners(day, { priority = 'background' } = {}) {
    const numericDay = Number(day);
    if (!Number.isInteger(numericDay) || numericDay <= 0 || typeof fetch !== 'function') {
      return Promise.resolve(null);
    }
    const key = String(numericDay);
    const path = `/game/jackpot/day/${encodeURIComponent(numericDay)}/winners`;
    if (this.#summaryWinnersKey === key) {
      if (this.#summaryWinnersValue !== undefined) {
        return Promise.resolve(this.#summaryWinnersValue);
      }
      if (this.#summaryWinnersPromise) {
        // fetchJSON coalesces by URL; this only promotes a queued warm request.
        if (priority === 'interaction') {
          void fetchJSON(path, { force: true, priority }).catch(() => null);
        }
        return this.#summaryWinnersPromise;
      }
    }

    this.#summaryWinnersKey = key;
    this.#summaryWinnersValue = undefined;
    let flight;
    flight = fetchJSON(path, { force: true, priority })
      .catch(() => null)
      .then((payload) => {
        const exact = Number(payload?.day) === numericDay && Array.isArray(payload?.winners)
          ? payload
          : null;
        // A transient must remain retryable at click time. An exact empty list
        // is a real, cacheable answer.
        if (exact && this.#summaryWinnersKey === key) this.#summaryWinnersValue = exact;
        return exact;
      })
      .finally(() => {
        if (this.#summaryWinnersKey === key && this.#summaryWinnersPromise === flight) {
          this.#summaryWinnersPromise = null;
        }
      });
    this.#summaryWinnersPromise = flight;
    return flight;
  }

  // The exact global day row is the sole authority for the flip outcome. The
  // viewer activity row is level-derived and can describe a different flip day.
  // Usually #refreshFlipRow already owns this immutable result; the spin-start
  // warm fills any gap and the summary click merely consumes it.
  #loadExactSummaryCoinflip(day, { priority = 'background' } = {}) {
    const numericDay = Number(day);
    if (!Number.isInteger(numericDay) || numericDay <= 0 || typeof fetch !== 'function') {
      return Promise.resolve(null);
    }
    const key = String(numericDay);
    const path = `/game/coinflip/day/${encodeURIComponent(numericDay)}`;
    if (this.#summaryCoinflipKey === key) {
      if (this.#summaryCoinflipValue !== undefined) {
        return Promise.resolve(this.#summaryCoinflipValue);
      }
      if (this.#summaryCoinflipPromise) {
        if (priority === 'interaction') {
          void fetchJSON(path, { force: true, priority }).catch(() => null);
        }
        return this.#summaryCoinflipPromise;
      }
    }

    // A populated exact row is immutable and can be promoted directly into the
    // summary cache. A pre-index no-row is deliberately not: spin-start gets
    // one authoritative re-read, then even a legitimate no-row is cached.
    if (Number(this.#flipFetchedDay) === numericDay) {
      const cached = this.#flipResult;
      if (cached?.win === true || cached?.win === false) {
        const reward = Number(cached?.rewardPercent);
        const normalized = {
          coinflipWon: cached.win,
          coinflipRewardPercent: Number.isFinite(reward)
            ? Math.max(0, Math.trunc(reward))
            : 0,
        };
        this.#summaryCoinflipKey = key;
        this.#summaryCoinflipValue = normalized;
        return Promise.resolve(normalized);
      }
    }

    this.#summaryCoinflipKey = key;
    this.#summaryCoinflipValue = undefined;
    let flight;
    flight = fetchJSON(path, { force: true, priority })
      .then((exact) => {
        let normalized;
        if (exact == null) {
          normalized = null;
        } else if (Number(exact?.day) === numericDay
          && (exact?.win === true || exact?.win === false)) {
          const reward = Number(exact?.rewardPercent);
          normalized = {
            coinflipWon: exact.win,
            coinflipRewardPercent: Number.isFinite(reward)
              ? Math.max(0, Math.trunc(reward))
              : 0,
          };
        } else {
          // Invalid/mismatched payloads stay retryable.
          return undefined;
        }
        if (Number(this.#pinnedDay) === numericDay) {
          this.#flipResult = exact ?? null;
          this.#flipFetchedDay = numericDay;
        }
        if (this.#summaryCoinflipKey === key) this.#summaryCoinflipValue = normalized;
        return normalized;
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.#summaryCoinflipKey === key && this.#summaryCoinflipPromise === flight) {
          this.#summaryCoinflipPromise = null;
        }
      });
    this.#summaryCoinflipPromise = flight;
    return flight;
  }

  // Build + queue the viewed player's full day summary. Winner → prize cards;
  // non-winner → an honest NO HIT card. Day-scoped DB feeds add the ticket
  // revealed tickets plus lootboxes the player bought/opened during the round.
  async #onResultsCtaClick() {
    if (this.#summaryBusy || this.#hasOpenedSummary()) return;
    const cta = this.#resultsCta();
    this.#summaryBusy = true;
    if (cta) {
      cta.disabled = true;
      cta.textContent = 'LOADING DAY SUMMARY…';
    }
    try {
      const viewed = getViewedAddress();
      const target = viewed ? String(viewed).toLowerCase() : null;
      const summaryDay = this.#pinnedDay;
      // All three reads began with the main jackpot spin. These calls consume
      // their shared values (or promote an unusually slow warm request) rather
      // than starting fresh click-time work.
      const activityPromise = this.#dayActivity(viewed, summaryDay);
      const exactWinnersPromise = target
        ? this.#daySummaryWinners(summaryDay, { priority: 'interaction' })
        : Promise.resolve(null);
      const exactCoinflipPromise = target
        ? this.#loadExactSummaryCoinflip(summaryDay, { priority: 'interaction' })
        : Promise.resolve(null);

      const [cachedActivity, exactWinners, exactCoinflip] = await Promise.all([
        activityPromise,
        exactWinnersPromise,
        exactCoinflipPromise,
      ]);
      if (exactWinners
        && (exactWinners.winners.length > 0 || this.#winners.length === 0)) {
        this.#winners = exactWinners.winners;
        const exactLevel = Number(exactWinners?.level);
        if (Number.isInteger(exactLevel) && exactLevel > 0) this.#pinnedLevel = exactLevel;
      }
      const winnerRow = target ? (this.#winners || []).find(
        (winner) => String(winner?.address || '').toLowerCase() === target,
      ) : null;
      const prizes = buildDaySummaryPrizes(winnerRow);
      // Always overwrite the cached composition. If the click-time exact read
      // is unavailable, make no outcome claim instead of resurrecting a stale
      // level-derived result from an earlier viewer response.
      const activity = cachedActivity == null ? null : {
        ...cachedActivity,
        coinflipWon: exactCoinflip?.coinflipWon ?? null,
        coinflipRewardPercent: exactCoinflip?.coinflipRewardPercent ?? 0,
      };
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
        title: summaryDay != null ? `DAY ${summaryDay} SUMMARY` : 'DAY SUMMARY',
        day: summaryDay,
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

  async #refreshFoil({ force = false } = {}) {
    if (this.#viewingPastDay()) {
      this.#foilData = null;
      this.#foilDataKey = null;
      this.#renderFoil();
      return;
    }
    const addr = getViewedAddress();
    // The target follows two clocks: contract cadence identifies the next buy
    // level, while #foilTargetLevel keeps the resolved pack seated until its
    // final presentation and any outstanding match claims are finished.
    const level = this.#foilTargetLevel();
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
      const data = await fetchJSON(`/player/${addr}/foil?level=${level}`, { force });
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

  // One authoritative list feeds both the shared Pending tray and the ticket
  // mounted in the cabinet. Keeping those surfaces on the same tuples prevents
  // a merely visual T4-looking presentation, an already-indexed claim, or an
  // in-flight replay face from receiving a clickable claim marker.
  #foilClaimCandidates() {
    const d = this.#foilData;
    const player = getViewedAddress();
    if (!player || !d?.present || !Array.isArray(d.lines) || d.lines.length === 0) return [];

    // Each draw is independently spoiler-gated. In particular, Roll 1 cannot
    // publish a bonus match merely because the bonus packed set already exists.
    const { mainSet, bonusSet } = this.#activatedFoilSets({ claimableOnly: true });
    if (mainSet == null && bonusSet == null) return [];

    const claims = Array.isArray(d.claims) ? d.claims : [];
    const day = Number(this.#pinnedDay);
    const level = Number(d.level);
    const candidates = [];
    d.lines.forEach((rawLine, ticketIndex) => {
      const line = normalizeFoilLine(rawLine);
      if (!line) return;
      for (const grade of claimableDrawGrades(line, mainSet, bonusSet)) {
        const key = this.#foilClaimKey(player, day, ticketIndex, grade.drawKind);
        const indexed = claims.some((claim) => (
          Number(claim?.day) === day
          && Number(claim?.ticketIndex) === ticketIndex
          && Number(claim?.drawKind) === grade.drawKind
        ));
        if (indexed || this.#locallyClaimedFoilMatches.has(key)) continue;
        candidates.push({
          player: String(player),
          day,
          level: Number.isFinite(level) ? level : null,
          foilMultBps: Number.isInteger(Number(d.multBps)) ? Number(d.multBps) : null,
          ticketIndex,
          lineTraits: [...line],
          winningTraits: unpackWinSet(grade.packedSet),
          grade,
          key,
        });
      }
    });
    return candidates.sort((a, b) => (
      b.grade.score - a.grade.score
      || a.ticketIndex - b.ticketIndex
      || a.grade.drawKind - b.grade.drawKind
    ));
  }

  #activateFoilClaim(candidate) {
    if (!candidate || this.#foilClaimBusy) return;
    // Start the wallet flow synchronously from the click so injected providers
    // retain user activation. The shared Pending tray remains the one visible
    // error surface for both entry points.
    void this.#onFoilClaim(candidate).catch((error) => {
      reportPendingActionError(compactUiError(
        error,
        'Foil match claim did not go through. Try again.',
      ));
    });
  }

  // The machine keeps four quiet foil indents around the draw. Owned lines use
  // the same real ticket-card artwork as inventory. Once a draw is uncovered,
  // every face displays its protocol score: miss (0), symbol (1), exact (2).
  #renderFoilBackdrop() {
    const slots = [...this.querySelectorAll('.ldj-foil-machine-slot')];
    if (slots.length === 0) return;
    const lines = this.#foilData?.present && Array.isArray(this.#foilData?.lines)
      ? this.#foilData.lines.slice(0, slots.length)
      : [];
    const slottingThisPack = this.#foilSlottingPending === true
      && Number(this.#foilData?.level) === Number(this.#slottedFoilLevel);
    const { mainSet, bonusSet } = this.#activatedFoilSets();
    const claimByTicket = new Map();
    for (const candidate of this.#foilClaimCandidates()) {
      // A foil line may pay independently on both draws. Surface its best
      // outstanding tuple first; claiming it immediately reveals the next one.
      if (!claimByTicket.has(candidate.ticketIndex)) {
        claimByTicket.set(candidate.ticketIndex, candidate);
      }
    }

    let slotted = 0;
    slots.forEach((slot, index) => {
      slot.textContent = '';
      slot.classList.remove(
        'is-loaded',
        'is-graded',
        'is-match',
        'is-slotting',
        'is-claimable',
        'is-claim-busy',
      );
      slot.removeAttribute('data-score');
      slot.removeAttribute('data-draw-kind');
      slot.removeAttribute('data-claim-score');
      slot.removeAttribute('data-claim-draw-kind');
      const line = normalizeFoilLine(lines[index]);
      if (!line) return;
      const claimCandidate = claimByTicket.get(index) || null;

      const presented = this.#foilPresentationGrade(line);
      const bonusPresentationActive = Boolean(
        this.#foilPresentation?.bonusPhase === true
        && Number(this.#foilPresentation?.day) === Number(this.#pinnedDay),
      );

      // Every painted lamp must belong to one independently payable draw.
      // Roll 1 and Roll 2 scores do not add together, so retaining the strongest
      // face from each made a non-paying card look like T4. Once Roll 2 starts,
      // it replaces a non-paying/settled Roll 1 display. The sole exception is
      // an outstanding payable tuple: keep that exact draw lit until its claim
      // receipt settles, then the next render advances to the current draw.
      let grade = null;
      let displayFaces = [0, 0, 0, 0];
      let faceMask = 0;
      let showingPresentation = false;
      if (claimCandidate) {
        grade = claimCandidate.grade;
        displayFaces = [...grade.faces];
        faceMask = 0b1111;
      } else if (bonusPresentationActive) {
        // The opening Roll 2 frame intentionally clears all four old lamps,
        // even before its first reel exposes a valid face.
        if (presented) {
          displayFaces = [...presented.faces];
          faceMask = presented.visible;
          showingPresentation = true;
        }
      } else if (bonusSet != null) {
        grade = { ...gradeLine(line, bonusSet), drawKind: 1 };
        displayFaces = [...grade.faces];
        faceMask = 0b1111;
      } else if (mainSet != null) {
        grade = { ...gradeLine(line, mainSet), drawKind: 0 };
        displayFaces = [...grade.faces];
        faceMask = 0b1111;
      } else if (presented) {
        displayFaces = [...presented.faces];
        faceMask = presented.visible;
        showingPresentation = true;
      }
      const locked = Boolean(grade && grade.score >= FOIL_CLAIM_THRESHOLD);
      slot.classList.add('is-loaded');
      if (grade) slot.classList.add('is-graded');
      if (locked) {
        slot.classList.add('is-match');
        slot.setAttribute('data-score', `T${grade.score}`);
        slot.setAttribute('data-draw-kind', String(grade.drawKind));
      }
      if (claimCandidate) {
        slot.classList.add('is-claimable');
        slot.setAttribute('data-claim-score', `T${claimCandidate.grade.score}`);
        slot.setAttribute('data-claim-draw-kind', String(claimCandidate.grade.drawKind));
        if (this.#foilClaimBusy) slot.classList.add('is-claim-busy');
      }
      if (slottingThisPack) {
        slot.classList.add('is-slotting');
        slot.style?.setProperty?.('--foil-slot-index', String(index));
        slotted += 1;
      }

      const ticket = document.createElement(claimCandidate ? 'button' : 'span');
      ticket.className = 'ldj-foil-machine-ticket ticket-card tc-small ticket-card--foil';
      let claimLabel = '';
      if (claimCandidate) {
        const drawLabel = claimCandidate.grade.drawKind === 1 ? 'bonus spin' : 'main spin';
        claimLabel = `Claim T${claimCandidate.grade.score} ${drawLabel} foil match from ticket ${index + 1}`;
        ticket.classList.add('ldj-foil-machine-ticket--claimable');
        ticket.setAttribute('type', 'button');
        ticket.setAttribute('aria-label', claimLabel);
        ticket.setAttribute('title', claimLabel);
        ticket.disabled = this.#foilClaimBusy;
        if (this.#foilClaimBusy) ticket.setAttribute('aria-busy', 'true');
        ticket.addEventListener('click', () => this.#activateFoilClaim(claimCandidate));
      }
      applyDgnTicketAccent(ticket, line);
      line.forEach((traitId, quadrant) => {
        const badge = traitToBadge(traitId);
        const cell = document.createElement('span');
        cell.className = 'ldj-foil-machine-cell trait-quadrant';
        cell.setAttribute('data-foil-quadrant', String(quadrant));
        if (badge?.color) cell.setAttribute('data-trait-color', badge.color);
        if (badge?.color === 'gold') cell.classList.add('trait-quadrant--gold');
        const face = Number(displayFaces[quadrant] || 0);
        if ((faceMask >> quadrant) & 1) {
          cell.setAttribute('data-match-points', String(face));
          if (face === 0) cell.classList.add('is-no-match');
          if (face === 1) cell.classList.add('is-symbol-match');
          if (face === 2) cell.classList.add('is-color-match');
          if (showingPresentation && face > 0 && this.#foilFlashQuadrants.has(quadrant)) {
            cell.classList.add('is-match-flash');
          }
        }
        if (badge) {
          const image = document.createElement('img');
          image.src = badge.path;
          image.alt = badge.label;
          image.loading = 'lazy';
          image.decoding = 'async';
          cell.appendChild(image);
        }
        ticket.appendChild(cell);
      });
      const center = document.createElement('span');
      center.className = 'ldj-foil-machine-center ticket-card-center';
      const flame = document.createElement('img');
      flame.src = '/whitepaper/flame-center.svg';
      flame.alt = '';
      flame.loading = 'lazy';
      flame.decoding = 'async';
      center.appendChild(flame);
      ticket.appendChild(center);
      slot.appendChild(ticket);
      if (claimCandidate) {
        const marker = document.createElement('button');
        marker.className = 'ldj-foil-claim-marker';
        marker.setAttribute('type', 'button');
        marker.setAttribute('aria-label', claimLabel);
        marker.setAttribute('title', claimLabel);
        marker.disabled = this.#foilClaimBusy;
        if (this.#foilClaimBusy) marker.setAttribute('aria-busy', 'true');
        marker.addEventListener('click', () => this.#activateFoilClaim(claimCandidate));
        slot.appendChild(marker);
      }
    });
    if (slotted > 0 && slottingThisPack) this.#foilSlottingPending = false;
  }

  #renderFoil() {
    this.#renderFoilBackdrop();
    const player = getViewedAddress();
    const publishEmpty = () => publishPendingActions(FOIL_MATCH_ACTION_SOURCE, []);
    const candidates = this.#foilClaimCandidates();
    const best = candidates[0];
    const resolvedLevel = this.#resolvedFoilLevel();
    const dataLevel = Number(this.#foilData?.level);
    const liveLevel = foilPackDisplayLevel(
      this.#gameState ?? get('app.gameState'),
      (this.#poolBenchmarks ?? get('app.poolBenchmarks'))?.contractPhase,
    );
    const mayRetireResolvedPack = player
      && this.#foilBoardComplete()
      && resolvedLevel != null
      && dataLevel === resolvedLevel
      && Number.isInteger(Number(liveLevel))
      && Number(liveLevel) !== resolvedLevel;
    if (mayRetireResolvedPack
      && !best
      && Number(this.#foilRetiredResolvedLevel) !== resolvedLevel) {
      this.#foilRetiredResolvedLevel = resolvedLevel;
      // Re-fetch on the next microtask so this render can finish consistently
      // on one pack. The new target is now the active/slotted buy level.
      const retarget = () => { void this.#refreshFoil(); };
      if (typeof queueMicrotask === 'function') queueMicrotask(retarget);
      else Promise.resolve().then(retarget);
    }
    if (!player || !best) {
      publishEmpty();
      return;
    }

    const rewardFaces = FOIL_TIER_FACES[best.grade.score] ?? 0;
    publishPendingActions(FOIL_MATCH_ACTION_SOURCE, [{
      id: `foil-match:${best.key}`,
      dismissScope: player,
      kind: 'foil-match',
      kindLabel: 'FOIL TICKET MATCH',
      label: `T${best.grade.score} FOIL LUCKBOX MATCH`,
      shortLabel: `T${best.grade.score} FOIL LUCKBOX MATCH`,
      detail: '',
      lineTraits: best.lineTraits,
      winningTraits: best.winningTraits,
      matchFaces: best.grade.faces,
      drawKind: best.grade.drawKind,
      score: best.grade.score,
      rewardFaces,
      state: this.#foilClaimBusy ? 'busy' : 'ready',
      write: true,
      // The claim is permissionless and always credits `player`. AUTO may
      // safely settle it; a keeper winning the same race is reconciled below.
      autoOpen: true,
      order: 15,
      chronology: (best.day * 100_000) + (best.ticketIndex * 2) + best.grade.drawKind,
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
      // Receipt confirmation is the authority. Retire the immutable tuple
      // before presentation parsing so a malformed/foreign log can never
      // strand an already-settled row in Pending.
      this.#locallyClaimedFoilMatches.add(candidate.key);
      let claimedInfo = [];
      try { claimedInfo = parseFoilMatchClaimedFromReceipt(receipt, contract); }
      catch (_e) { /* fallback to the already-graded candidate */ }
      const claimed = claimedInfo.find((row) => (
        Number(row?.day) === Number(day)
        && Number(row?.ticketIndex) === Number(ticketIndex)
        && Number(row?.drawKind) === Number(grade.drawKind)
      )) || claimedInfo[0] || null;
      const tier = claimed?.tier ?? grade.score;
      const rewardFaces = claimed?.faces ?? FOIL_TIER_FACES[tier] ?? 0;
      let legs = [];
      try { legs = parseOpenLegsFromReceipt(receipt, player); }
      catch (_e) { /* the match card can still explain the settled tier */ }
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
        foilMultBps: candidate.foilMultBps,
        legs,
      });
      this.#renderFoil();
      void this.#refreshFoil();
      return true;
    } catch (error) {
      if (_terminalFoilClaimError(error)) {
        // Another wallet/keeper settled this permissionless tuple first, or
        // the game permanently closed it. The indexed claim will reconcile on
        // refresh; keeping the stale write visible only guarantees repeat
        // failures.
        this.#locallyClaimedFoilMatches.add(candidate.key);
        this.#renderFoil();
        void this.#refreshFoil();
        return true;
      }
      throw error;
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

          <div class="ldj-foil-machine-bank" data-bind="ldj-foil-machine-bank"
               aria-hidden="true">
            <span class="ldj-foil-machine-slot"></span>
            <span class="ldj-foil-machine-slot"></span>
            <span class="ldj-foil-machine-slot"></span>
            <span class="ldj-foil-machine-slot"></span>
            <!-- The bank's current sheet. Every other sheet on this machine is
                 a CSS background, and this one is not, for one reason: an SVG
                 used as a background-image is an isolated document that the
                 page stylesheet cannot reach into, and Chrome does not pass
                 prefers-reduced-motion down to it either (verified against
                 both this geometry and daily-drawing-board-current-v4.svg — a
                 reduce-emulated capture kept animating). Inline, the page owns
                 both halves of the behaviour: which socket's feeds carry
                 current, and whether the current moves.

                 It is the LAST child on purpose. The four sockets are placed
                 on the bank grid by .ldj-foil-machine-slot:nth-child(1..4) in
                 app.css; anything inserted ahead of them shifts every one of
                 those placements.

                 The eight paths are the eight paths of
                 daily-drawing-foil-routing-v5.svg, copied verbatim in its own
                 socket order (upper left, lower left, upper right, lower
                 right) — the copper is the functional net and the current is
                 not allowed to invent a route. A test asserts the two lists
                 are identical, so they cannot drift.

                 Eight, not sixteen. Every one of these leaves the draw
                 processor's own edge (x=186 / x=1186 are literally the board's
                 left and right edges in this viewBox) and ends on a socket
                 edge, so each lit lane is a visible board-to-socket
                 connection. The eight the copper sheet dropped in v5 ran from
                 the perimeter ground rail instead, and current on those read
                 as light crawling in from the frame — a rail is not a thing a
                 player can name, so nothing here is allowed to flow out of
                 one.

                 Both ramps are pinned in user space to a Chainlink VRF module,
                 which is where the board sheet pins its own: the modules sit
                 at (250,1132) and (1030,1132) in the board sheet's 1280x1280
                 space and project into this 1372x1000 one at x=229 / x=1143 in
                 both layouts, at y=1144 desktop and y=1267 phone. Current
                 leaves the module blue and cools with distance, exactly as it
                 does on the board. The radius is 1850 rather than the board's
                 430 so the bank spans the same PART of that ramp the board
                 actually uses: the board's lanes are all within ~254 units of
                 a module and so run offset 0 to ~0.6, blue through green,
                 never reaching the gold stop. The bank's lanes are 336 units
                 away at the near end and 1143 at the far end; 1850 puts them
                 at 0.18 and 0.62. On the board's own 430 every lane here would
                 land past the last stop and the whole bank would flatten to
                 gold on copper. -->
            <svg class="ldj-foil-machine-current" viewBox="0 0 1372 1000"
                 preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <defs>
                <radialGradient id="ldjFoilCurrentL" gradientUnits="userSpaceOnUse"
                                cx="229" cy="1200" r="1850">
                  <stop stop-color="#a5cbff"/>
                  <stop offset="0.2" stop-color="#5f93ff"/>
                  <stop offset="0.55" stop-color="#73e8b0"/>
                  <stop offset="1" stop-color="#e4b54e"/>
                </radialGradient>
                <radialGradient id="ldjFoilCurrentR" gradientUnits="userSpaceOnUse"
                                cx="1143" cy="1200" r="1850">
                  <stop stop-color="#a5cbff"/>
                  <stop offset="0.2" stop-color="#5f93ff"/>
                  <stop offset="0.55" stop-color="#73e8b0"/>
                  <stop offset="1" stop-color="#e4b54e"/>
                </radialGradient>
              </defs>
              <g class="ldj-foil-lane ldj-foil-lane--1" stroke="url(#ldjFoilCurrentL)">
                <path d="M186 58H166L130 94V164"/>
                <path d="M186 442H166L130 406V336"/>
              </g>
              <g class="ldj-foil-lane ldj-foil-lane--2" stroke="url(#ldjFoilCurrentL)">
                <path d="M186 558H166L130 594V664"/>
                <path d="M186 942H166L130 906V836"/>
              </g>
              <g class="ldj-foil-lane ldj-foil-lane--3" stroke="url(#ldjFoilCurrentR)">
                <path d="M1186 58H1206L1242 94V164"/>
                <path d="M1186 442H1206L1242 406V336"/>
              </g>
              <g class="ldj-foil-lane ldj-foil-lane--4" stroke="url(#ldjFoilCurrentR)">
                <path d="M1186 558H1206L1242 594V664"/>
                <path d="M1186 942H1206L1242 906V836"/>
              </g>
            </svg>
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
      subscribe('app.daySync', (sync) => this.#onDaySync(sync))
    );
    this.#unsubs.push(
      subscribe('app.gameState', (state) => this.#onGameState(state))
    );
    this.#unsubs.push(
      subscribe('app.poolBenchmarks', (benchmarks) => this.#onPoolBenchmarks(benchmarks))
    );
    this.#unsubs.push(
      subscribe('app.deploymentMismatch', (payload) => this.#renderDeploymentMismatch(payload))
    );

    // Viewed-player changes re-target both the spin panel and the foil strip.
    this.#unsubs.push(
      subscribe('viewing.address', () => {
        this.#clearSummaryActivityCache();
        this.#foilRetiredResolvedLevel = null;
        this.#resetFoilSlotting();
        this.#syncReplayPanel();
        this.#refreshFoil();
        this.#maybeShowResultsCta();
      })
    );
    this.#unsubs.push(
      subscribe('connected.address', () => {
        this.#clearSummaryActivityCache();
        this.#foilRetiredResolvedLevel = null;
        this.#resetFoilSlotting();
        this.#syncReplayPanel();
        this.#refreshFoil();
        this.#maybeShowResultsCta();
      })
    );

    // A foil purchase can become visible in the player projection after every
    // day/level/address signal above has already fired. The Tickets inventory
    // has always polled that projection, but the cabinet used to read it only
    // on those signals, so Tickets could show all four foils while these four
    // sockets stayed empty for the rest of the session. Follow the same quiet
    // one-minute cadence (and the shared scheduler's immediate visible-tab
    // catch-up) so an indexed pack seats without requiring a page reload.
    this.#foilPollHandle = registerComponentPoll(
      () => this.#refreshFoil({ force: true }),
      FOIL_REFRESH_INTERVAL_MS,
    );

    // Spin completion powers each foil bank as soon as its four winning
    // quadrants land. Scratch completion separately opens the spoiler/claim
    // gates and feeds the results-CTA "whole board done" state.
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.#spinStartListener = (e) => this.#onPanelSpinStart(e);
      document.addEventListener('replay:spin-start', this.#spinStartListener);
      this.#spinProgressListener = (e) => this.#onPanelSpinProgress(e);
      document.addEventListener('replay:spin-progress', this.#spinProgressListener);
      this.#spinCompleteListener = (e) => this.#onPanelSpinComplete(e);
      document.addEventListener('replay:spin-complete', this.#spinCompleteListener);
      this.#scratchCompleteListener = (e) => this.#onPanelScratchComplete(e);
      document.addEventListener('replay:scratch-complete', this.#scratchCompleteListener);
      this.#decimatorOpenedListener = (e) => this.#onDecimatorOpened(e);
      document.addEventListener('decimator:opened', this.#decimatorOpenedListener);
      // A pack's completion fires before the fullscreen queue necessarily
      // ends. Arm on the foil release, then seat the tickets only when the
      // reveal overlay announces that every queued fullscreen beat is gone.
      this.#packRevealCompleteListener = (event) => {
        const detail = event?.detail;
        if (detail?.foilPack !== true) return;
        const viewed = String(getViewedAddress() || '').toLowerCase();
        const releasedFor = String(detail?.address || '').toLowerCase();
        if (viewed && releasedFor && releasedFor !== viewed) return;
        const releasedLevel = Number(detail?.level);
        if (!Number.isInteger(releasedLevel) || releasedLevel <= 0) return;
        // Do not compare this with the live target. In a turbo jackpot the
        // target may already be the next level by the time the player closes
        // the pack; the completed pack itself identifies what must be seated.
        this.#foilSlottingArmed = releasedLevel;
        this.#slottedFoilLevel = releasedLevel;
      };
      document.addEventListener(PACK_REVEAL_COMPLETE_EVENT, this.#packRevealCompleteListener);
      this.#revealOverlayIdleListener = (event) => {
        const releasedLevel = Number(this.#foilSlottingArmed);
        if (!Number.isInteger(releasedLevel) || releasedLevel <= 0) return;
        this.#foilSlottingArmed = null;
        if (event?.detail?.aborted === true) {
          this.#foilSlottingPending = false;
          if (Number(this.#slottedFoilLevel) === releasedLevel) {
            this.#slottedFoilLevel = null;
            void this.#refreshFoil();
          }
          return;
        }
        this.#slottedFoilLevel = releasedLevel;
        this.#foilSlottingPending = true;
        void this.#refreshFoil();
      };
      document.addEventListener(REVEAL_OVERLAY_IDLE_EVENT, this.#revealOverlayIdleListener);
      // Coin-flip reveal (app-daily-flip) — the other half of the CTA gate.
      this.#flipListener = () => this.#maybeShowResultsCta();
      document.addEventListener('flip:revealed', this.#flipListener);
    }

    this.#showContent();
    this.#renderFoilBackdrop();
    this.#wireHistoryNav();
  }

  disconnectedCallback() {
    this.#clearSummaryActivityCache();
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
    if (typeof this.#foilPollHandle === 'function') {
      try { this.#foilPollHandle(); } catch { /* defensive */ }
      this.#foilPollHandle = null;
    }
    // Invalidate any foil read still in flight BEFORE clearing the tray.
    // #refreshFoil checks this sequence after its await and bails, so a
    // response that lands after teardown cannot render into a detached board
    // or republish the claim row the next line is about to remove. Day
    // boundaries now kick a refresh of their own, which makes an unlucky
    // unmount-during-fetch that much easier to hit.
    this.#foilSeq += 1;
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
    if (this.#spinStartListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('replay:spin-start', this.#spinStartListener); }
      catch { /* defensive */ }
    }
    this.#spinStartListener = null;
    if (this.#spinProgressListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('replay:spin-progress', this.#spinProgressListener); }
      catch { /* defensive */ }
    }
    this.#spinProgressListener = null;
    this.#foilPresentation = null;
    this.#clearFoilMatchFlashes();
    if (this.#spinCompleteListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('replay:spin-complete', this.#spinCompleteListener); }
      catch { /* defensive */ }
    }
    this.#spinCompleteListener = null;
    if (this.#scratchCompleteListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('replay:scratch-complete', this.#scratchCompleteListener); }
      catch { /* defensive */ }
    }
    this.#scratchCompleteListener = null;
    if (this.#decimatorOpenedListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('decimator:opened', this.#decimatorOpenedListener); }
      catch { /* defensive */ }
    }
    this.#decimatorOpenedListener = null;
    if (this.#packRevealCompleteListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener(PACK_REVEAL_COMPLETE_EVENT, this.#packRevealCompleteListener); }
      catch { /* defensive */ }
    }
    this.#packRevealCompleteListener = null;
    if (this.#revealOverlayIdleListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener(REVEAL_OVERLAY_IDLE_EVENT, this.#revealOverlayIdleListener); }
      catch { /* defensive */ }
    }
    this.#revealOverlayIdleListener = null;
    this.#resetFoilSlotting();
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
