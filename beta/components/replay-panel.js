// components/replay-panel.js -- Jackpot Replay Viewer
// Browse historical jackpot draws: pick a level/day, view tickets, replay the reveal animation.
// Slot-machine spin cycles badges through quadrants with live background coloring per player
// trait ownership, then owned quadrants get a canvas scratch-off that reveals prize amounts.
// Center diamond scratches to reveal FLIP wins (farFutureCoin distributions).
//
// Ported faithfully from jackpot-demo.html scratch/reveal UX.

import { deriveWinningTraits, traitToBadge, toDisplayOrder, DISPLAY_ORDER } from '../app/jackpot-data.js';
import { joScaledToTickets } from '../app/jackpot-rolls.js';
import {
  buildRoll1BucketSummaries,
  buildRoll2BucketSummaries,
  splitOpeningFlipDraw,
} from '../app/jackpot-buckets.js';
// SHELL-01 patch (Phase 52 followup, mirrors D-09 from jackpot-panel.js):
// swap the wallet-tainted utils.js import for the wallet-free viewer/utils.js
// equivalents so play/ can consume this component via a recursive-import walk
// without tripping the SHELL-01 guardrail on `ethers`.
import { formatEth, formatFlip, truncateAddress } from '../viewer/utils.js';
import { playSound } from '../app/audio.js';
import { API_BASE, BADGE_QUADRANTS, BADGE_COLORS, BADGE_ITEMS, badgeCircularPath } from '../app/constants.js';
import { batch, update } from '../app/store.js';

async function replayFetch(path) {
  const res = await fetch(API_BASE + '/replay' + path);
  if (!res.ok) throw new Error(`Replay API ${res.status}: ${path}`);
  return res.json();
}

// How far above the day's level Roll 2 can still find rolled traits. Mirrors
// app-tickets-inventory.js FAR_FUTURE_OFFSET: past this, a level has not been
// drawn, so its tickets have no traits to match.
const FAR_FUTURE_HORIZON = 4;

// Scratch-cover fill when the viewed player cannot win a quadrant. This is the
// darker locked/unscratched face; the paper beneath is the lighter loser pink
// from `.q-win-impossible` in replay.css.
const NO_WIN_COVER_FILL = 'rgb(218, 104, 104)';
// A real winner must not be visible before scratching. Winning quadrants and
// owned "could win" misses share this exact blue cover; green lives underneath.
const POSSIBLE_WIN_COVER_FILL = '#b8d4e8';
const GOLD_TRAIT_COVER_FILL = 'rgb(212, 175, 55)';
// Let the eighth lock remain visibly settled before the scratch surface is
// mounted. Without this beat the final reel frame and completed board happened
// in one task, so the last quadrant appeared to snap to its result colour.
const FINAL_LOCK_SETTLE_MS = 260;

function isGoldTrait(traitId) {
  const id = Number(traitId);
  return Number.isInteger(id) && id >= 0
    && Math.floor((id % 64) / 8) === 7;
}

// --- Module-level scratch helpers ---

const BRUSH_R = 22;
const REVEAL_THRESHOLD = 0.5;
const KNOWN_LOSER_REVEAL_THRESHOLD = 0.4;
const GRID_RES = 40;
const CENTER_GRID_RES = 20;

function makeScratchGrid(res) { return new Uint8Array(res * res); }

function markGridCells(grid, res, canvasW, canvasH, cx, cy, brushR) {
  const cellW = canvasW / res, cellH = canvasH / res;
  const gridCX = cx / cellW, gridCY = cy / cellH;
  const gridR = brushR / Math.min(cellW, cellH);
  const minGX = Math.max(0, Math.floor(gridCX - gridR));
  const maxGX = Math.min(res - 1, Math.ceil(gridCX + gridR));
  const minGY = Math.max(0, Math.floor(gridCY - gridR));
  const maxGY = Math.min(res - 1, Math.ceil(gridCY + gridR));
  for (let gy = minGY; gy <= maxGY; gy++) {
    for (let gx = minGX; gx <= maxGX; gx++) {
      const dx = gx + 0.5 - gridCX, dy = gy + 0.5 - gridCY;
      if (dx * dx + dy * dy <= gridR * gridR) {
        grid[gy * res + gx] = 1;
      }
    }
  }
}

function gridCoverage(grid) {
  let cleared = 0;
  for (let i = 0; i < grid.length; i++) { if (grid[i]) cleared++; }
  return cleared / grid.length;
}

/**
 * Format a prize amount for display in overlays.
 * For ETH: uses formatEth (wei string).
 * For FLIP: uses formatFlip (wei string).
 */
function formatPrizeAmount(weiString, currency) {
  if (currency === 'FLIP') return formatFlip(weiString);
  return formatEth(weiString);
}

// --- Component ---

class ReplayPanel extends HTMLElement {
  #rngDays = [];       // [{day, finalWord}]
  #players = [];       // [address, ...]
  #tickets = [];       // [{address, entryCount, totalMintedOnLevel}] — entryCount is ENTRIES (4 = 1 ticket)
  #selectedDay = null;
  #selectedLevel = null;
  #selectedPlayer = null;
  #openingFlipDay = false; // game level 0: two FLIP boards, no normal ETH/ticket Roll 1
  #distributions = []; // raw distributions from replay/day endpoint (used for prize mapping)
  #winners = [];       // winner objects from /game/jackpot/day/:day/winners

  // Per-day roll caches from /game/jackpot/day/:day/roll1 and /roll2
  #dayRoll1 = null;    // full response: { day, level, purchaseLevel, wins: [...] }
  #dayRoll2 = null;    // full response: { day, level, purchaseLevel, wins: [...] }

  // Per-player filtered wins (derived from day caches by filtering on winner address)
  #playerRoll1Wins = [];  // wins[].filter(w => w.winner === selectedAddr)
  #playerRoll2Wins = [];  // wins[].filter(w => w.winner === selectedAddr)
  #hasBonus = false;      // gates the bonus-roll button. True when player won
                          // Roll 2 OR has any future-level ticket holdings
                          // (eligible to roll but possibly miss).
  #playerHasFutureTickets = null;  // Bool|null; cached per (day,player) by
                                   // #refreshPlayerEligibility(). null => unknown.

  // Spin + scratch state
  #playerTraitIds = new Set();  // Set<number> of owned trait IDs (for spin coloring)
  #traitsCacheAddress = null;   // address for which #playerTraitIds was fetched
  // Roll 2 draws against the player's FUTURE-level holdings, not the day's
  // level, so the bonus spin colours off its own set. Union of the traits held
  // at every level above the day's, out to the far-future horizon (levels past
  // that cannot have rolled traits yet).
  #futureTraitIds = new Set();
  #futureTraitsCacheKey = null;
  #animId = 0;                  // spin cancellation token (increment to cancel running spin)
  #spinning = false;            // true while spin animation is running
  #scratched = [false, false, false, false];  // per-quadrant scratch completion
  #scratchGrids = [null, null, null, null];   // per-quadrant Uint8Array scratch grids
  #greenRevealed = [false, false, false, false]; // per-quadrant first-badge green flash
  #badgesRevealed = [[], [], [], []];         // per-badge tracking within each quadrant
  #quadBadgeBounds = [null, null, null, null]; // per-quadrant badge hit circles
  #quadOwned = [false, false, false, false];  // per-quadrant win presence (from playerRoll1Wins)
  #quadWinArrays = [[], [], [], []];          // per-quadrant prize arrays (from playerRoll1/2Wins)
  #centerWins = [];                            // far-future coin wins (center diamond)
  #centerScratched = false;                    // center diamond scratch state
  #centerScratchGrid = null;                   // center diamond scratch grid

  // Bonus Roll (Roll 2) state — reuses the main widget
  #bonusPhase = false;          // true while bonus roll is active (Roll 2 reveal)
  #mainScratchComplete = false; // Roll 2 stays locked until Roll 1 is uncovered
  #mainAllRed = false;          // no owned quadrant/center win: Roll 2 may start immediately
  #bonusScratchComplete = false;// both boards can be revisited once Roll 2 is uncovered
  #drawViewSwitching = false;   // coalesces rapid center-flame view toggles
  #bonusTraitIds = new Set();   // traitIds the player won in Roll 2 (unused — kept for compat)
  #bonusQuadrants = new Set();  // contract quadrant numbers with roll2.future wins

  // Single-button mode (`single-button` attribute, set by /app/): the main
  // Reveal button is the ONLY roll trigger — after Roll 1 it becomes the Bonus
  // Roll trigger, and the day ends with no button rather than a "Replay"
  // re-spin. /beta/ and /play/ keep the separate Bonus Roll button and Replay.
  #btnMode = 'reveal';          // 'reveal' | 'bonus' — what reveal-btn fires
  // Public main-draw result under each scratch cover. When the viewed player
  // has no winning entry, the quadrant still reveals its badge, ETH per win,
  // and the number of winning entries.
  #quadPublicSummaries = [null, null, null, null];

  #audioCtx = null;             // Web Audio context for SFX
  #scratchNode = null;          // active scratch noise node
  #mouseIsDown = false;         // global mouse button state
  #badgeCache = new Map();      // path → warmed Image (preloaded badge SVG cache)
  #daysRefreshPromise = null;   // coalesce initial/new-day option reloads
  #lastDaysRefreshAt = 0;       // retry throttle while the indexer catches up
  // /app/ owns the persisted "already scratched" bit.  The replay component
  // accepts that state through setPersistedRevealState(): a cleared draw is
  // reconstructed immediately, while an uncleared draw idles its four reels
  // slowly and silently until the player starts the real spin.
  #hostRevealCleared = null;
  #hostAllRollsCleared = false;
  #hostRevealSeq = 0;
  #hostRevealAppliedKey = null;
  #loadedDay = null;
  #idleSpinTimer = null;

  connectedCallback() {
    this.innerHTML = `
      <div class="panel replay-panel">
        <div class="panel-header">
          <h2>JACKPOT REPLAY</h2>
        </div>

        <div class="replay-controls">
          <div class="replay-control-group">
            <label class="replay-label">Day</label>
            <select class="replay-select" data-bind="day-select">
              <option value="">Loading days...</option>
            </select>
          </div>
          <div class="replay-control-group">
            <label class="replay-label">Player</label>
            <select class="replay-select" data-bind="player-select">
              <option value="">Select a day first</option>
            </select>
          </div>
          <button class="btn-primary replay-reveal-btn" data-bind="reveal-btn" disabled>
            Reveal Draw
          </button>
        </div>

        <div class="replay-ticket-bar" data-bind="ticket-info" hidden>
          <span class="replay-ticket-count" data-bind="ticket-count"></span>
          <span class="replay-ticket-detail" data-bind="ticket-detail"></span>
        </div>

        <div class="replay-ticket" data-bind="card-grid">
          <div class="replay-tq" data-pos="tl">
            <img class="badge-img" src="" alt="">
            <div class="replay-prize-reveal" data-pos="tl"></div>
            <canvas class="replay-scratch-canvas" data-pos="tl"></canvas>
          </div>
          <div class="replay-tq" data-pos="tr">
            <img class="badge-img" src="" alt="">
            <div class="replay-prize-reveal" data-pos="tr"></div>
            <canvas class="replay-scratch-canvas" data-pos="tr"></canvas>
          </div>
          <div class="replay-tq" data-pos="bl">
            <img class="badge-img" src="" alt="">
            <div class="replay-prize-reveal" data-pos="bl"></div>
            <canvas class="replay-scratch-canvas" data-pos="bl"></canvas>
          </div>
          <div class="replay-tq" data-pos="br">
            <img class="badge-img" src="" alt="">
            <div class="replay-prize-reveal" data-pos="br"></div>
            <canvas class="replay-scratch-canvas" data-pos="br"></canvas>
          </div>
          <div class="replay-ticket-center" data-bind="center">
            <img src="/specials/special_none.svg" alt="Flame" class="replay-flame">
            <div class="replay-center-prize" data-bind="center-prize"></div>
            <canvas class="replay-center-canvas" data-bind="center-canvas"></canvas>
          </div>
        </div>

        <p class="replay-hint" data-bind="hint"></p>

        <div class="replay-bonus-section" data-bind="bonus-section" hidden>
          <button class="btn-primary replay-bonus-btn" data-bind="bonus-btn">
            Bonus Roll
          </button>
          <p class="replay-no-bonus" data-bind="no-bonus" hidden>No bonus this draw</p>
        </div>

        <!-- Plan 39-10: compact day summary mounted between card grid and winners list -->
        <day-jackpot-summary></day-jackpot-summary>

        <div class="replay-player-decimator" data-bind="player-decimator" hidden>
          <h3 class="replay-dist-title">Player Decimator Claims</h3>
          <div class="replay-player-decimator-list" data-bind="player-decimator-list"></div>
        </div>

        <div class="replay-distributions" data-bind="distributions" hidden>
          <h3 class="replay-dist-title">Jackpot Winners</h3>
          <div class="replay-dist-list" data-bind="dist-list"></div>
        </div>

        <div class="replay-empty" data-bind="empty-state">
          Select a day to replay a jackpot draw
        </div>
      </div>
    `;

    this.querySelector('[data-bind="day-select"]').addEventListener('change', (e) => this.#onDayChange(e));
    this.querySelector('[data-bind="player-select"]').addEventListener('change', (e) => this.#onPlayerChange(e));
    this.querySelector('[data-bind="reveal-btn"]').addEventListener('click', () => {
      if (this.#btnMode === 'bonus') this.#triggerBonusRoll();
      else this.#triggerReveal();
    });
    this.querySelector('[data-bind="bonus-btn"]').addEventListener('click', () => this.#triggerBonusRoll());

    // Global mouse button tracking for scratch stop on mouseup
    this._onMouseDown = () => {
      this.#mouseIsDown = true;
      if (this.#audioCtx && this.#audioCtx.state === 'suspended') this.#audioCtx.resume();
    };
    this._onMouseUp = () => {
      this.#mouseIsDown = false;
      this.#sfxScratchStop();
    };
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);

    // During a spin the center skips to the result. Once both draws have been
    // uncovered, the same flame switches between their saved final states.
    const centerEl = this.querySelector('[data-bind="center"]');
    if (centerEl) {
      centerEl.addEventListener('click', (event) => {
        if (this.#spinning) {
          this.#animId++;
          this.#spinning = false;
          return;
        }
        // Finishing a center scratch can synthesize a click on its canvas;
        // don't immediately switch away from the result the player just won.
        if (event?.target?.classList?.contains('replay-center-canvas')) return;
        void this.#toggleRevealedDraw();
      });
      centerEl.addEventListener('keydown', (event) => {
        if (event?.key !== 'Enter' && event?.key !== ' ') return;
        if (!this.#mainReadyForBonus() || !this.#bonusScratchComplete) return;
        try { event.preventDefault?.(); } catch { /* fake DOM */ }
        void this.#toggleRevealedDraw();
      });
    }

    this.refreshDays();
    this.#preloadBadges(); // warm browser cache for all badge SVGs in background
  }

  disconnectedCallback() {
    this.#animId++;  // cancel any running spin
    this.#stopIdleSpin();
    this.#sfxScratchStop();
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
  }

  /**
   * App-shell hook. `cleared` comes from the chain/day-scoped spun_day key.
   * Beta/play consumers never call this, so their replay behaviour is unchanged.
   */
  setPersistedRevealState(cleared, allRollsCleared = false) {
    if (!this.#singleButton()) return;
    this.#hostRevealCleared = Boolean(cleared);
    this.#hostAllRollsCleared = Boolean(cleared && allRollsCleared);
    this.#hostRevealSeq += 1;
    void this.#applyPersistedRevealState(this.#hostRevealSeq);
  }

  async #applyPersistedRevealState(seq = this.#hostRevealSeq) {
    if (this.#hostRevealCleared == null
      || this.#selectedDay == null
      || !this.#selectedPlayer
      || this.#loadedDay !== this.#selectedDay) return false;

    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    if (!rngEntry || !rngEntry.finalWord || rngEntry.finalWord === '0') {
      return false;
    }

    const day = this.#selectedDay;
    const player = this.#selectedPlayer;
    const cleared = this.#hostRevealCleared;
    const key = `${day}|${String(player).toLowerCase()}|${cleared ? 'cleared' : 'waiting'}`
      + `|${this.#hostAllRollsCleared ? 'all-rolls' : 'main-only'}`;
    if (this.#hostRevealAppliedKey === key) return true;

    if (cleared) {
      this.#stopIdleSpin();
      await this.#triggerReveal({ instant: true, persisted: true });
      if (seq !== this.#hostRevealSeq
        || day !== this.#selectedDay
        || player !== this.#selectedPlayer) return false;
      this.#restoreCompletedDrawViews();
    } else {
      await this.#loadPlayerTraits();
      if (seq !== this.#hostRevealSeq
        || day !== this.#selectedDay
        || player !== this.#selectedPlayer
        || this.#hostRevealCleared !== false) return false;
      this.#startIdleSpin();
    }

    if (seq !== this.#hostRevealSeq
      || day !== this.#selectedDay
      || player !== this.#selectedPlayer) return false;
    this.#hostRevealAppliedKey = key;
    return true;
  }

  /**
   * A completed two-roll day always reloads onto the cleared main draw. The
   * bonus result remains available through the center flame, but its purchase-
   * style button must not come back after refresh.
   */
  #restoreCompletedDrawViews() {
    if (!this.#hostAllRollsCleared || !this.#hasBonus) return;
    this.#bonusPhase = false;
    this.#mainScratchComplete = true;
    this.#bonusScratchComplete = true;
    this.#btnMode = 'reveal';
    const btn = this.querySelector('[data-bind="reveal-btn"]');
    if (btn) {
      btn.hidden = true;
      btn.disabled = true;
      btn.title = '';
    }
    const bonusSection = this.querySelector('[data-bind="bonus-section"]');
    if (bonusSection) bonusSection.hidden = true;
    this.#syncDrawToggleAffordance();
  }

  #startIdleSpin() {
    this.#stopIdleSpin();
    if (this.#hostRevealCleared !== false || this.#spinning) return;

    const tick = () => {
      this.#idleSpinTimer = null;
      if (this.#hostRevealCleared !== false || this.#spinning) return;
      const quads = this.querySelectorAll('.replay-tq');
      for (let i = 0; i < 4; i++) {
        const contractQ = DISPLAY_ORDER[i];
        const sym = Math.floor(Math.random() * 8);
        const col = Math.floor(Math.random() * 8);
        const category = BADGE_QUADRANTS[contractQ];
        const img = quads[i]?.querySelector('.badge-img');
        if (img) {
          img.src = badgeCircularPath(category, sym, col);
          img.style.display = '';
          img.style.opacity = '1';
        }
        quads[i]?.classList.remove(
          'q-has-trait', 'q-no-tickets', 'q-scratchable', 'q-has-tickets',
          'q-public-result', 'q-win-impossible', 'q-win-impossible-lock',
          'q-owned-miss', 'q-player-win',
          'q-gold-trait', 'q-result-pending', 'q-result-revealed',
        );
        const shownTrait = contractQ * 64 + col * 8 + sym;
        const ownsShown = this.#playerTraitIds.has(shownTrait);
        quads[i]?.classList.add(ownsShown ? 'q-has-trait' : 'q-no-tickets');
        if (ownsShown && col === 7) quads[i]?.classList.add('q-gold-trait');
      }
      this.#syncOwnedGoldState(quads);
      this.querySelector('[data-bind="center"]')?.classList.add('spinning');

      // Deliberately much slower than the reveal animation. This is a quiet
      // attract loop, not a second outcome animation.
      this.#idleSpinTimer = setTimeout(tick, 620);
      if (this.#idleSpinTimer && typeof this.#idleSpinTimer.unref === 'function') {
        this.#idleSpinTimer.unref();
      }
    };
    tick();
  }

  #stopIdleSpin() {
    if (this.#idleSpinTimer != null) {
      try { clearTimeout(this.#idleSpinTimer); } catch { /* defensive */ }
      this.#idleSpinTimer = null;
    }
    if (!this.#spinning) {
      this.querySelector('[data-bind="center"]')?.classList.remove('spinning');
    }
  }

  // Preload all 256 badge SVGs into the browser cache so spin src-swaps render instantly.
  // Fires-and-forgets in the background; does not block the UI.
  #preloadBadges() {
    const BADGE_CATEGORIES = ['crypto', 'zodiac', 'cards', 'dice'];
    let i = 0;
    const paths = [];
    for (const cat of BADGE_CATEGORIES) {
      for (let sym = 0; sym < 8; sym++) {
        for (let col = 0; col < 8; col++) {
          paths.push(badgeCircularPath(cat, sym, col));
        }
      }
    }
    // Load one at a time to avoid flooding the network on first visit
    const loadNext = () => {
      if (i >= paths.length) return;
      const path = paths[i++];
      if (this.#badgeCache.has(path)) { loadNext(); return; }
      const img = new Image();
      img.onload = img.onerror = () => {
        this.#badgeCache.set(path, img);
        loadNext();
      };
      img.src = path;
    };
    // Kick off up to 8 parallel preload chains
    const concurrency = Math.min(8, paths.length);
    for (let c = 0; c < concurrency; c++) loadNext();
  }

  // --- Data Loading ---

  /**
   * Refresh the day option source. The app's last-day bridge calls this when a
   * newly resolved day is not in the once-loaded list yet. Calls coalesce, and
   * a short throttle lets the bridge retry without hammering the replay API.
   * @returns {Promise<boolean>}
   */
  refreshDays() {
    if (this.#daysRefreshPromise) return this.#daysRefreshPromise;
    const now = Date.now();
    const select = this.querySelector('[data-bind="day-select"]');
    const hasLoadedDays = select?.options
      && Array.from(select.options).some((option) => Number(option.value) > 0);
    if (hasLoadedDays && now - this.#lastDaysRefreshAt < 2_000) {
      return Promise.resolve(false);
    }
    this.#lastDaysRefreshAt = now;
    const pending = this.#loadDays();
    const tracked = pending.finally(() => {
      if (this.#daysRefreshPromise === tracked) this.#daysRefreshPromise = null;
    });
    this.#daysRefreshPromise = tracked;
    return this.#daysRefreshPromise;
  }

  async #loadDays() {
    const select = this.querySelector('[data-bind="day-select"]');
    const previous = String(select?.value || '');
    try {
      const data = await replayFetch('/rng');
      this.#rngDays = data.days;
      // The replay feed already carries the DB-derived day-within-phase clock.
      // Share its newest row with the headline/nav instead of making that bar
      // issue a duplicate history request just to label PURCHASE DAY N.
      const latestPhaseDay = Array.isArray(data.days) && data.days.length > 0
        ? data.days.reduce((latest, row) => (
          !latest || Number(row.day) > Number(latest.day) ? row : latest
        ), null)
        : null;
      if (latestPhaseDay && typeof document !== 'undefined' && document.dispatchEvent) {
        try {
          const event = typeof CustomEvent === 'function'
            ? new CustomEvent('replay:phase-clock', { detail: latestPhaseDay })
            : { type: 'replay:phase-clock', detail: latestPhaseDay };
          document.dispatchEvent(event);
        } catch (_e) { /* headless — the replay selector still works */ }
      }
      if (!select) return false;
      select.innerHTML = '<option value="">Pick a jackpot day</option>' +
        data.days.map(d => `<option value="${d.day}">Day ${d.day} — L${d.level} ${d.phase}${d.dayInPhase}</option>`).join('');
      if (previous && data.days.some((d) => String(d.day) === previous)) {
        select.value = previous;
      }
      return true;
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load days:', err);
      if (select) select.innerHTML = '<option value="">Failed to load</option>';
      return false;
    }
  }

  async #loadTickets(level) {
    try {
      const data = await replayFetch(`/tickets/${level}`);
      this.#tickets = data.players;

      // Compute winnings per player from distributions (ETH vs FLIP)
      const ethByAddr = {};
      const flipByAddr = {};
      let ethCount = 0, flipCount = 0;
      for (const dist of this.#distributions) {
        const addr = dist.winner.toLowerCase();
        const t = dist.awardType || '';
        const isFlip = dist.currency === 'FLIP' || t === 'flip' || t === 'farFutureCoin';
        const isEth = t === 'eth';
        if (isFlip) {
          flipByAddr[addr] = (flipByAddr[addr] || 0n) + BigInt(dist.amount || '0');
        } else if (isEth) {
          ethByAddr[addr] = (ethByAddr[addr] || 0n) + BigInt(dist.amount || '0');
        }
      }

      const select = this.querySelector('[data-bind="player-select"]');
      select.innerHTML = '<option value="">All players (' + data.players.length + ')</option>' +
        data.players.map(p => {
          const addr = p.address.toLowerCase();
          const eth = ethByAddr[addr];
          const flip = flipByAddr[addr];
          const parts = [];
          if (eth) parts.push(`${formatEth(eth.toString())} ETH`);
          if (flip) parts.push(`${formatFlip(flip.toString())} FLIP`);
          const wonLabel = parts.length > 0 ? ` | Won ${parts.join(' + ')}` : '';
          return `<option value="${p.address}">${truncateAddress(p.address)} (${p.entryCount} entries${wonLabel})</option>`;
        }).join('');

      this.#players = data.players.map(p => p.address);
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load tickets:', err);
    }
  }

  async #loadDayDetail(day) {
    try {
      const data = await replayFetch(`/day/${day}`);
      this.#distributions = data.distributions;
      return data;
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load day detail:', err);
      return null;
    }
  }

  async #loadDayRolls(day) {
    this.#dayRoll1 = null;
    this.#dayRoll2 = null;
    const [r1Res, r2Res] = await Promise.allSettled([
      fetch(`${API_BASE}/game/jackpot/day/${day}/roll1`),
      fetch(`${API_BASE}/game/jackpot/day/${day}/roll2`),
    ]);
    if (r1Res.status === 'fulfilled' && r1Res.value.ok) {
      try { this.#dayRoll1 = await r1Res.value.json(); } catch {}
    }
    if (r2Res.status === 'fulfilled' && r2Res.value.ok) {
      try { this.#dayRoll2 = await r2Res.value.json(); } catch {}
    }
    if (!this.#dayRoll1) console.warn('[ReplayPanel] roll1 endpoint unavailable for day', day);
    if (!this.#dayRoll2) console.warn('[ReplayPanel] roll2 endpoint unavailable for day', day);
    this.#repairOpeningFlipRolls(day);
  }

  #isOpeningFlipDraw(day) {
    const row = this.#rngDays.find((entry) => Number(entry.day) === Number(day));
    // During game level 0 the replay clock correctly advertises the tickets on
    // sale (L1), so L1 purchase-phase rows are the opening double-FLIP path.
    return Number(row?.level) === 1 && String(row?.phase || '').toUpperCase() === 'P';
  }

  #packedTraits(packed) {
    if (packed == null) return [];
    const value = Number(packed) >>> 0;
    return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
  }

  #repairOpeningFlipRolls(day) {
    this.#openingFlipDay = this.#isOpeningFlipDraw(day);
    if (!this.#openingFlipDay) return;
    const rng = this.#rngDays.find((entry) => Number(entry.day) === Number(day));
    const { mainWins, bonusWins } = splitOpeningFlipDraw(
      this.#distributions,
      this.#packedTraits(rng?.mainTraitsPacked),
      this.#packedTraits(rng?.bonusTraitsPacked),
    );
    this.#dayRoll1 = { day: Number(day), level: 0, purchaseLevel: 1, wins: mainWins };
    this.#dayRoll2 = { day: Number(day), level: 0, purchaseLevel: 1, wins: bonusWins };
  }

  #filterPlayerWins(addr) {
    const norm = addr.toLowerCase();
    this.#playerRoll1Wins = (this.#dayRoll1?.wins || []).filter(w => w.winner.toLowerCase() === norm);
    this.#playerRoll2Wins = (this.#dayRoll2?.wins || []).filter(w => w.winner.toLowerCase() === norm);
    // The bonus draw is public just like Roll 1. Show it whenever Roll 2 has a
    // recorded outcome, even when this player held no eligible ticket; their
    // own holdings still control the cover colour and personal payout.
    this.#hasBonus = this.#playerRoll2Wins.length > 0
      || (this.#playerHasFutureTickets === true)
      || (Array.isArray(this.#dayRoll2?.wins) && this.#dayRoll2.wins.length > 0);
  }

  // Pulled by #onDayChange/#onPlayerChange after fetching player.tickets.
  // True when the player owns >0 tickets at any level > the day's level
  // (near-future) OR any level the contract has not yet drawn (far-future,
  // already covered by the same > dayLevel comparison since draws are level-
  // ordered).
  async #refreshPlayerEligibility() {
    this.#playerHasFutureTickets = null;
    if (!this.#selectedPlayer || !this.#selectedDay) return;
    const dayLevel = Number(this.#dayRoll1?.purchaseLevel ?? this.#selectedLevel);
    if (!Number.isFinite(dayLevel)) return;
    try {
      const url = `${API_BASE}/player/${encodeURIComponent(this.#selectedPlayer)}?day=${encodeURIComponent(this.#selectedDay)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const tickets = Array.isArray(data?.tickets) ? data.tickets : [];
      this.#playerHasFutureTickets = tickets.some((t) => Number(t.level) > dayLevel && Number(t.entryCount ?? 0) > 0);
    } catch {
      this.#playerHasFutureTickets = null;
    }
  }

  async #loadDistributionsForLevel(level) {
    // Try new endpoint first (has traitId), fall back to history endpoint
    try {
      const data = await replayFetch('/distributions/' + level);
      this.#distributions = data.distributions || [];
      return;
    } catch {}
    try {
      const res = await fetch(API_BASE + '/history/jackpots?level=' + level + '&limit=100');
      if (!res.ok) return;
      const data = await res.json();
      this.#distributions = (data.items || []).map(d => ({
        level: d.level, winner: d.winner, amount: d.amount,
        traitId: d.traitId ?? null, ticketIndex: d.ticketIndex ?? null,
        awardType: d.awardType,
      }));
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load distributions:', err);
    }
  }

  // Traits the player holds ABOVE the day's level — what Roll 2 grades against.
  // Bounded by FAR_FUTURE_HORIZON: levels past it have no rolled traits, so
  // fetching them would cost a request per level to learn nothing.
  async #loadFutureTraits() {
    const dayLevel = Number(this.#dayRoll1?.purchaseLevel ?? this.#selectedLevel);
    if (!this.#selectedPlayer || !Number.isFinite(dayLevel)) {
      this.#futureTraitIds = new Set();
      this.#futureTraitsCacheKey = null;
      return;
    }
    const cacheKey = `${this.#selectedPlayer.toLowerCase()}|${dayLevel}`;
    if (this.#futureTraitsCacheKey === cacheKey) return;

    const levels = [];
    for (let l = dayLevel + 1; l <= dayLevel + FAR_FUTURE_HORIZON; l++) levels.push(l);
    const owned = new Set();
    try {
      const payloads = await Promise.all(levels.map(async (l) => {
        // No &day= param — same 404 gotcha as #loadPlayerTraits.
        const res = await fetch(`${API_BASE}/player/${encodeURIComponent(this.#selectedPlayer)}/tickets/by-trait?level=${l}`);
        if (!res.ok) return null;
        return res.json();
      }));
      for (const data of payloads) {
        for (const card of (Array.isArray(data?.cards) ? data.cards : [])) {
          for (const entry of (Array.isArray(card?.entries) ? card.entries : [])) {
            if (entry && entry.traitId != null) owned.add(Number(entry.traitId));
          }
        }
      }
      this.#futureTraitIds = owned;
      this.#futureTraitsCacheKey = cacheKey;
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load future-level traits:', err);
      // Fail-closed, like #loadPlayerTraits: an empty set spins red rather than
      // promising a match the player does not hold.
      this.#futureTraitIds = new Set();
      this.#futureTraitsCacheKey = null;
    }
  }

  async #loadPlayerTraits() {
    if (!this.#selectedPlayer) {
      this.#playerTraitIds = new Set();
      this.#traitsCacheAddress = null;
      return;
    }
    // Roll 1 samples its winners from tickets at the day's PURCHASE level, so
    // scratch eligibility must be scoped to the traits the player holds at
    // that level. The old /replay/player-traits endpoint aggregated ALL
    // levels, which lit quadrants scratchable for players who could never
    // win the day's draw (user bug report: "should be red and unscratchable").
    const level = this.#dayRoll1?.purchaseLevel
      ?? (this.#selectedLevel != null ? Number(this.#selectedLevel) + 1 : null);
    if (level == null) {
      this.#playerTraitIds = new Set();
      this.#traitsCacheAddress = null;
      return;
    }
    const cacheKey = `${this.#selectedPlayer.toLowerCase()}|${level}`;
    if (this.#traitsCacheAddress === cacheKey) return; // cache hit
    try {
      // No &day= param — the endpoint 404s on days without an indexed
      // daily_rng row (same gotcha as app-tickets-inventory).
      const res = await fetch(`${API_BASE}/player/${encodeURIComponent(this.#selectedPlayer)}/tickets/by-trait?level=${level}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const owned = new Set();
      for (const card of (Array.isArray(data?.cards) ? data.cards : [])) {
        for (const entry of (Array.isArray(card?.entries) ? card.entries : [])) {
          if (entry && entry.traitId != null) owned.add(Number(entry.traitId));
        }
      }
      this.#playerTraitIds = owned;
      this.#traitsCacheAddress = cacheKey;
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load player traits:', err);
      // Fail-closed: an empty set renders non-winning quadrants red and
      // unscratchable instead of inviting a scratch that can't pay.
      this.#playerTraitIds = new Set();
      this.#traitsCacheAddress = null;
    }
  }

  // --- Event Handlers ---

  async #onDayChange(e) {
    this.#hostRevealSeq += 1;
    this.#loadedDay = null;
    const dayNum = parseInt(e.target.value);
    if (!dayNum) {
      this.#selectedDay = null;
      this.#resetCards();
      this.querySelector('[data-bind="empty-state"]').hidden = false;
      this.querySelector('[data-bind="distributions"]').hidden = true;
      this.querySelector('[data-bind="ticket-info"]').hidden = true;
      this.querySelector('[data-bind="reveal-btn"]').disabled = true;
      batch([['replay.day', null], ['replay.level', null]]);
      return;
    }

    this.#selectedDay = dayNum;
    this.#openingFlipDay = false;
    this.#resetCards();

    const rngEntry = this.#rngDays.find(d => d.day === dayNum);
    const hasRng = rngEntry && rngEntry.finalWord && rngEntry.finalWord !== '0';

    this.querySelector('[data-bind="empty-state"]').hidden = true;

    // Load day detail (replay endpoint — still needed for distributions used in player-select label)
    await this.#loadDayDetail(dayNum);

    // Prefetch per-day roll1/roll2 caches (new cleaner endpoints)
    await this.#loadDayRolls(dayNum);

    // Load winners from the authoritative day/winners endpoint.
    // This gives us level, winner list with breakdown, and hasBonus flags.
    this.#winners = [];
    this.#selectedLevel = null;
    try {
      const wRes = await fetch(`${API_BASE}/game/jackpot/day/${dayNum}/winners`);
      if (wRes.ok) {
        const wJson = await wRes.json();
        this.#selectedLevel = this.#openingFlipDay
          ? 0
          : (wJson.level ?? (this.#distributions[0]?.level ?? null));
        this.#winners = wJson.winners || [];
      } else if (this.#distributions.length > 0) {
        this.#selectedLevel = this.#distributions[0].level;
      }
    } catch {
      if (this.#distributions.length > 0) {
        this.#selectedLevel = this.#distributions[0].level;
      }
    }

    // Roll 1 grades the purchase level itself. Prefer the endpoint's explicit
    // source level; modal winner level can be the level receiving ticket prizes
    // (or an opening bonus target), which is not the ownership cohort.
    if (this.#selectedLevel != null) {
      await this.#loadTickets(this.#dayRoll1?.purchaseLevel ?? (this.#selectedLevel + 1));
    }

    // A valid draw can have zero winners. RNG + a selected player are enough
    // to run (or idle) the public board; winner rows only affect payouts.
    const canReveal = hasRng && this.#selectedPlayer;
    this.querySelector('[data-bind="reveal-btn"]').disabled = !canReveal;

    if (this.#winners.length > 0) {
      this.#showDistributions(this.#winners);
    } else {
      this.querySelector('[data-bind="distributions"]').hidden = true;
    }

    // Publish selected day + level to store so game-status-bar can display them.
    batch([
      ['replay.day', dayNum],
      ['replay.level', this.#selectedLevel],
    ]);
    if (this.#selectedDay === dayNum) {
      this.#loadedDay = dayNum;
      void this.#applyPersistedRevealState(this.#hostRevealSeq);
    }
  }

  #onPlayerChange(e) {
    this.#hostRevealSeq += 1;
    const addr = e.target.value;
    this.#selectedPlayer = addr || null;
    // Publish replay-player selection so sibling widgets (status-bar activity
    // score) can react without coupling to this panel.
    update('replay.player', this.#selectedPlayer);
    this.#updateTicketInfo();
    this.#loadPlayerTraits();
    this.#loadPlayerDecimator();
    // Re-render distributions to update (YOU) labels
    if (this.#winners.length > 0) {
      this.#showDistributions(this.#winners);
    }
    // Update reveal button state
    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    const hasRng = rngEntry && rngEntry.finalWord && rngEntry.finalWord !== '0';
    this.querySelector('[data-bind="reveal-btn"]').disabled = !hasRng || !this.#selectedPlayer;
    void this.#applyPersistedRevealState(this.#hostRevealSeq);
  }

  async #loadPlayerDecimator() {
    const container = this.querySelector('[data-bind="player-decimator"]');
    const list = this.querySelector('[data-bind="player-decimator-list"]');
    if (!container || !list) return;
    if (!this.#selectedPlayer) {
      container.hidden = true;
      list.innerHTML = '';
      return;
    }
    // /app/ basic mode hides this block outright (app.css: `.replay-player-decimator
    // { display: none }` — decimator deferred per product call), so the request below
    // is pure waste there. Skipping it also silences a 404 on every page load.
    if (getComputedStyle(container).display === 'none') return;
    list.innerHTML = '<div class="jp-summary-note">Loading…</div>';
    container.hidden = false;
    try {
      const res = await fetch(`${API_BASE}/game/decimator/player/${this.#selectedPlayer}`);
      if (!res.ok) {
        list.innerHTML = '<div class="jp-summary-note">Could not load decimator state.</div>';
        return;
      }
      const data = await res.json();
      const rounds = Array.isArray(data.rounds) ? data.rounds : [];
      if (rounds.length === 0) {
        list.innerHTML = '<div class="jp-summary-note">Player has no decimator burns.</div>';
        return;
      }
      // Render one row per round.  Status priority: claimed > pending winner > not eligible.
      list.innerHTML = rounds.map((r) => {
        let status, amountText;
        if (r.claimed) {
          const ethStr = formatEth(r.claimedEthAmount || '0');
          const lbStr  = formatEth(r.claimedLootboxAmount || '0');
          const lbPart = (r.claimedLootboxAmount && BigInt(r.claimedLootboxAmount) > 0n) ? ` + ${lbStr} ETH lootbox` : '';
          status = '<span class="replay-dec-status replay-dec-claimed">Claimed</span>';
          amountText = `${ethStr} ETH${lbPart}`;
        } else if (r.isWinner && BigInt(r.claimableEth || '0') > 0n) {
          status = '<span class="replay-dec-status replay-dec-pending">Claimable (pending)</span>';
          amountText = `${formatEth(r.claimableEth)} ETH`;
        } else if (!r.resolved) {
          status = '<span class="replay-dec-status replay-dec-unresolved">Not yet resolved</span>';
          amountText = '—';
        } else {
          status = '<span class="replay-dec-status replay-dec-loser">Not eligible</span>';
          amountText = `bucket ${r.bucket}/sub ${r.playerSubBucket} (winner sub ${r.winningSubBucket ?? '—'})`;
        }
        return `<div class="replay-dec-row">
          <span class="replay-dec-level"><strong>L${r.level}</strong></span>
          ${status}
          <span class="replay-dec-amount">${amountText}</span>
        </div>`;
      }).join('');
    } catch (err) {
      console.warn('[ReplayPanel] decimator fetch failed', err);
      list.innerHTML = '<div class="jp-summary-note">Could not load decimator state.</div>';
    }
  }

  #updateTicketInfo() {
    const infoEl = this.querySelector('[data-bind="ticket-info"]');
    const countEl = this.querySelector('[data-bind="ticket-count"]');
    const detailEl = this.querySelector('[data-bind="ticket-detail"]');

    if (!this.#selectedPlayer) {
      const total = this.#tickets.reduce((sum, t) => sum + t.entryCount, 0);
      countEl.textContent = `${total.toLocaleString()} total entries`;
      detailEl.textContent = `across ${this.#tickets.length} players`;
      infoEl.hidden = false;
      return;
    }

    const player = this.#tickets.find(t => t.address === this.#selectedPlayer);
    if (player) {
      countEl.textContent = `${player.entryCount.toLocaleString()} entries`;
      detailEl.textContent = `${player.totalMintedOnLevel.toLocaleString()} minted on level`;
      infoEl.hidden = false;

      const won = this.#winners.find(w => w.address.toLowerCase() === this.#selectedPlayer.toLowerCase());
      if (won) {
        countEl.textContent += ' · WINNER';
        countEl.classList.add('replay-winner-text');
      } else {
        countEl.classList.remove('replay-winner-text');
      }
    } else {
      infoEl.hidden = true;
    }
  }

  #showDistributions(winners) {
    // winners: array from /game/jackpot/day/:day/winners response
    const container = this.querySelector('[data-bind="distributions"]');
    const list = this.querySelector('[data-bind="dist-list"]');

    if (!winners || !winners.length) {
      container.hidden = true;
      return;
    }

    const myAddr = this.#selectedPlayer?.toLowerCase();

    list.innerHTML = winners.map(w => {
      const addr = w.address.toLowerCase();
      const isMe = myAddr && addr === myAddr;

      // Build trait-grouped tooltip from breakdown entries, partitioned by roll phase
      const tipHtml = this.#buildWinnerTooltip(w.breakdown || [], w.hasBonus);

      return `
      <div class="replay-dist-item${isMe ? ' replay-dist-mine' : ''}" style="position:relative">
        <span class="replay-dist-winner">${truncateAddress(w.address)}${isMe ? ' (YOU)' : ''}</span>
        ${w.hasBonus ? '<span class="replay-dist-bonus-badge">+BONUS</span>' : ''}
        <div class="winner-tip">${tipHtml}</div>
      </div>`;
    }).join('');

    container.hidden = false;
  }

  /**
   * Build HTML for the hover tooltip grouped by trait, partitioned by roll phase.
   * breakdown: [{awardType, amount, count, traitId}]
   * hasBonus: if true, split entries into Roll 1 (eth/tickets) vs Bonus Roll (flip non-null traitId)
   *           vs Bonus Center (null-traitId flip). This matches exactly what the widget renders
   *           across Roll 1 quadrants + Roll 2 bonus quadrants + center diamond.
   */
  #buildWinnerTooltip(breakdown, hasBonus = false) {
    if (!breakdown || breakdown.length === 0) return '<em>No detail available</em>';

    /**
     * Render a set of entries grouped by traitId into tooltip HTML.
     * entries: [{awardType, amount, count, traitId}]
     */
    const renderEntryGroup = (entries) => {
      // Solo-bucket detection: whale_pass (traitId=null) always goes to the
      // single solo-bucket winner. We identify that bucket as the trait with
      // the largest single ETH slice in this player's entries, and fold the
      // whale pass row INTO that trait group instead of showing a separate
      // "Solo Winner" section.
      let soloTraitKey = null;
      let soloMaxEth = 0n;
      for (const e of entries) {
        if ((e.awardType || '') === 'eth' && e.traitId != null) {
          const v = BigInt(e.amount || '0');
          if (v > soloMaxEth) { soloMaxEth = v; soloTraitKey = e.traitId; }
        }
      }

      const byTrait = new Map(); // traitId|'bonus'|'solo' -> entries[]
      for (const entry of entries) {
        let key;
        if (entry.traitId != null) {
          key = entry.traitId;
        } else if ((entry.awardType || '') === 'whale_pass') {
          // Fold whale pass into the solo-bucket trait group when we can
          // identify it; otherwise fall back to a labeled Solo Winner section.
          key = soloTraitKey != null ? soloTraitKey : 'solo';
        } else {
          key = 'bonus';
        }
        if (!byTrait.has(key)) byTrait.set(key, []);
        byTrait.get(key).push(entry);
      }
      const sections = [];
      for (const [key, ents] of byTrait) {
        let headerHtml;
        if (key === 'solo') {
          headerHtml = '<span class="tip-trait-name">Solo Winner</span>';
        } else if (key === 'bonus') {
          headerHtml = '<span class="tip-trait-name">Bonus Center</span>';
        } else {
          const traitId = Number(key);
          const badge = traitToBadge(traitId);
          const quadrant = Math.floor(traitId / 64);
          const quadrantName = BADGE_QUADRANTS[quadrant] || 'Unknown';
          const label = badge ? `${badge.item} (${quadrantName} Q${quadrant + 1})` : `Trait ${traitId}`;
          headerHtml = `<span class="tip-trait-name">${label}</span>`;
        }
        const rows = ents.map(e => {
          const at = e.awardType || '';
          let formatted;
          if (at === 'eth') {
            formatted = `${formatEth(e.amount)} ETH`;
          } else if (at === 'eth_baf') {
            formatted = `${formatEth(e.amount)} ETH (BAF)`;
          } else if (at === 'flip' || at === 'farFutureCoin' || at.includes('flip')) {
            formatted = `${formatFlip(e.amount)} FLIP`;
          } else if (at === 'tickets' || at === 'ticket') {
            // Amounts are in ENTRIES (4 = 1 whole ticket); joScaledToTickets /4 for display.
            const n = joScaledToTickets(e.amount);
            formatted = `${n} ticket${n !== 1 ? 's' : ''}`;
          } else if (at === 'tickets_baf') {
            const n = joScaledToTickets(e.amount);
            formatted = `${n} ticket${n !== 1 ? 's' : ''} (BAF)`;
          } else if (at === 'whale_pass') {
            formatted = `${e.amount} whale pass${e.amount !== '1' ? 'es' : ''}`;
          } else {
            formatted = `${e.amount} ${at}`;
          }
          const countStr = e.count > 1 ? ` ×${e.count}` : '';
          return `<span class="tip-row">${formatted}${countStr}</span>`;
        }).join('');
        sections.push(`<div class="tip-trait-group">${headerHtml}${rows}</div>`);
      }
      return sections.join('');
    };

    if (!hasBonus) {
      // No bonus roll — render entries flat, grouped by traitId.  BAF entries
      // (traitId=420 sentinel) must still be partitioned out so they don't
      // render under a phantom "horseshoe Q7" badge.
      const nonBaf = breakdown.filter(e => e.awardType !== 'eth_baf' && e.awardType !== 'tickets_baf');
      const baf = breakdown.filter(e => e.awardType === 'eth_baf' || e.awardType === 'tickets_baf');
      const renderBafFlat = (entries) =>
        entries.map(e => {
          const at = e.awardType || '';
          let formatted;
          if (at === 'eth_baf') {
            formatted = `${formatEth(e.amount)} ETH`;
          } else {
            const n = joScaledToTickets(e.amount);
            formatted = `${n} ticket${n !== 1 ? 's' : ''}`;
          }
          const countStr = e.count > 1 ? ` ×${e.count}` : '';
          return `<span class="tip-row">${formatted}${countStr}</span>`;
        }).join('');
      const parts = [];
      if (nonBaf.length > 0) parts.push(renderEntryGroup(nonBaf));
      if (baf.length > 0) parts.push('<div class="tip-phase-header">BAF</div><div class="tip-trait-group">' + renderBafFlat(baf) + '</div>');
      return parts.length > 0 ? parts.join('') : '<em>No detail available</em>';
    }

    // Partition: Roll 1 entries (eth / tickets / whale_pass) vs Bonus Roll entries (flip with
    // non-null traitId) vs Bonus Center (null-traitId flip / farFutureCoin) vs BAF (eth_baf /
    // tickets_baf — traitId=420 sentinel, must be partitioned out so the trait grouper doesn't
    // render them under a phantom "horseshoe Q7" badge).
    const roll1Entries = [];
    const bonusQuadEntries = [];
    const bonusCenterEntries = [];
    const bafEntries = [];

    for (const entry of breakdown) {
      const at = entry.awardType || '';
      const isFlip = at === 'flip' || at === 'farFutureCoin' || at.includes('flip');
      if (at === 'eth_baf' || at === 'tickets_baf') {
        bafEntries.push(entry);
      } else if (this.#openingFlipDay
        && isFlip
        && entry.traitId != null
        && Number(entry.level) === 1) {
        roll1Entries.push(entry);
      } else if (isFlip && entry.traitId == null) {
        bonusCenterEntries.push(entry);
      } else if (isFlip && entry.traitId != null) {
        bonusQuadEntries.push(entry);
      } else {
        roll1Entries.push(entry);
      }
    }

    // BAF entries are not trait-keyed (traitId=420 is the sentinel, not a real
    // trait), so render them flat without the per-trait grouping.
    const renderBafFlat = (entries) =>
      entries.map(e => {
        const at = e.awardType || '';
        let formatted;
        if (at === 'eth_baf') {
          formatted = `${formatEth(e.amount)} ETH`;
        } else {
          const n = joScaledToTickets(e.amount);
          formatted = `${n} ticket${n !== 1 ? 's' : ''}`;
        }
        const countStr = e.count > 1 ? ` ×${e.count}` : '';
        return `<span class="tip-row">${formatted}${countStr}</span>`;
      }).join('');

    const parts = [];
    if (roll1Entries.length > 0) {
      parts.push('<div class="tip-phase-header">Main Roll</div>' + renderEntryGroup(roll1Entries));
    }
    if (bonusQuadEntries.length > 0) {
      parts.push('<div class="tip-phase-header">Bonus Roll</div>' + renderEntryGroup(bonusQuadEntries));
    }
    if (bonusCenterEntries.length > 0) {
      parts.push('<div class="tip-phase-header">Bonus Center</div>' + renderEntryGroup(bonusCenterEntries));
    }
    if (bafEntries.length > 0) {
      parts.push('<div class="tip-phase-header">BAF</div><div class="tip-trait-group">' + renderBafFlat(bafEntries) + '</div>');
    }
    return parts.length > 0 ? parts.join('') : '<em>No detail available</em>';
  }

  // --- Reveal / Spin ---

  async #triggerReveal({ instant = false, persisted = false } = {}) {
    if (!this.#selectedDay || !this.#selectedPlayer) return;

    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    if (!rngEntry || !rngEntry.finalWord || rngEntry.finalWord === '0') return;

    this.#resetCards();
    await this.#loadPlayerTraits(); // ensure traits loaded for spin coloring
    await this.#refreshPlayerEligibility(); // populate #playerHasFutureTickets

    // Filter the pre-cached day roll1/roll2 responses down to this player's wins.
    this.#filterPlayerWins(this.#selectedPlayer);

    const displayTraits = this.#displayTraitsForRoll(false);

    // Map per-player roll1 wins to quadrant prize arrays.
    this.#distributePrizesFromRoll1();

    const btn = this.querySelector('[data-bind="reveal-btn"]');
    btn.disabled = true;
    if (!instant) btn.textContent = 'Revealing...';

    await this.#runSpin(displayTraits, { instant, announce: !persisted });

    if (this.#singleButton()) {
      // Same button carries Roll 2; with no bonus ahead the day is played out.
      if (this.#hasBonus) {
        this.#btnMode = 'bonus';
        btn.textContent = 'Bonus Roll';
        btn.disabled = !this.#mainReadyForBonus();
        btn.title = this.#mainReadyForBonus()
          ? (this.#mainAllRed && !this.#mainScratchComplete ? 'All red — bonus roll ready' : '')
          : 'Scratch the main draw first';
      } else {
        btn.hidden = true;
      }
    } else {
      btn.disabled = false;
      btn.textContent = 'Replay';
    }

    // After Roll 1 spin: show bonus section
    this.#showBonusSection();
  }

  /**
   * Build a per-traitId lookup from the winner's breakdown array.
   * breakdown entries have { awardType, amount, count, traitId }.
   * Returns Map<traitId, { ethTotal: bigint, flipTotal: bigint }>.
   * Also returns { centerFlip: bigint } for null-traitId flip/farFutureCoin entries.
   */
  #buildBreakdownLookup(breakdown) {
    const byTrait = new Map();
    let centerFlip = 0n;
    for (const entry of (breakdown || [])) {
      const at = entry.awardType || '';
      const amt = BigInt(entry.amount || '0');
      const cnt = BigInt(entry.count || 1);
      const total = amt * cnt;
      if (entry.traitId == null) {
        // null-traitId flip = farFutureCoin center wins
        if (at === 'flip' || at === 'farFutureCoin') centerFlip += total;
        continue;
      }
      if (!byTrait.has(entry.traitId)) byTrait.set(entry.traitId, { ethTotal: 0n, flipTotal: 0n });
      const rec = byTrait.get(entry.traitId);
      if (at === 'eth') rec.ethTotal += total;
      else if (at === 'flip' || at === 'farFutureCoin') rec.flipTotal += total;
      // tickets are read from row.ticketsPerWinner (already aggregated correctly)
    }
    return { byTrait, centerFlip };
  }

  /**
   * Map #playerRoll1Wins (already filtered to this player, one row per discrete payout)
   * to quadrant prize arrays. Each win row is exactly one badge/emission — no expansion.
   * whale_pass / dgnrs rows land under a "Solo Winner" quadrant entry (no traitId quadrant).
   */
  #distributePrizesFromRoll1() {
    this.#quadWinArrays = [[], [], [], []];
    this.#centerWins = [];

    if (!this.#playerRoll1Wins || this.#playerRoll1Wins.length === 0) return;

    const MAX_VISUAL_BADGES = 20;
    // Track total wins per display pos for overflow sentinel
    const totalPerPos = [0, 0, 0, 0];

    for (const win of this.#playerRoll1Wins) {
      const at = win.awardType || '';

      // whale_pass / dgnrs: no quadrant from traitId — place in quadrant with most ETH wins
      // (handled after loop below). Skip here.
      if (win.traitId == null) continue;

      const contractQ = Math.floor(win.traitId / 64);
      const displayPos = DISPLAY_ORDER.indexOf(contractQ);
      if (displayPos < 0 || displayPos > 3) continue;

      totalPerPos[displayPos]++;
      const currentCount = this.#quadWinArrays[displayPos].length;
      if (currentCount >= MAX_VISUAL_BADGES) continue;

      this.#quadWinArrays[displayPos].push({
        awardType: 'aggregated',
        ethTotal: at === 'eth' ? (win.amount || '0') : '0',
        flipTotal: (at === 'flip' || at === 'farFutureCoin') ? (win.amount || '0') : '0',
        ticketTotal: (at === 'tickets' || at === 'ticket') ? Number(win.amount || 0) : 0,
        traitId: win.traitId,
        ticketIndex: win.ticketIndex ?? null,
        level: win.level ?? null,
        sourceLevel: win.sourceLevel ?? null,
      });
    }

    // whale_pass / dgnrs wins (no traitId) → merge INTO the solo-bucket ETH
    // entry.  The solo bucket is where this player is the only winner, which
    // on the contract side pays the biggest single ETH slice (60% on final
    // day, 20% otherwise — still larger than the per-winner share in
    // multi-winner buckets), and whale pass / dgnrs ride along with that
    // same payout — they aren't distinct prizes.  Picking the entry with the
    // largest *single* ETH win lands on that bucket, whereas summing totals
    // can tip toward a multi-winner quadrant whose cumulative payout exceeds
    // the solo share.
    const noTraitWins = this.#playerRoll1Wins.filter(w => w.traitId == null);
    if (noTraitWins.length > 0) {
      let bestEntry = null, bestSingle = 0n;
      for (let i = 0; i < 4; i++) {
        for (const d of this.#quadWinArrays[i]) {
          const amt = BigInt(d.ethTotal || '0');
          if (amt > bestSingle) { bestSingle = amt; bestEntry = d; }
        }
      }
      if (bestEntry) {
        bestEntry.isSolo = true;
        for (const win of noTraitWins) {
          const at = win.awardType || '';
          if (at === 'whale_pass') {
            bestEntry.whalePassCount = (bestEntry.whalePassCount || 0) + Number(win.amount || 1);
          } else if (at === 'dgnrs') {
            const prev = BigInt(bestEntry.dgnrsTotal || '0');
            bestEntry.dgnrsTotal = (prev + BigInt(win.amount || '0')).toString();
          }
        }
      }
    }

    // Overflow sentinels
    for (let pos = 0; pos < 4; pos++) {
      const rendered = this.#quadWinArrays[pos].length;
      const total = totalPerPos[pos];
      if (total > rendered) {
        const lastEntry = this.#quadWinArrays[pos][rendered - 1];
        this.#quadWinArrays[pos].push({
          awardType: 'overflow',
          overflowCount: total - rendered,
          traitId: lastEntry ? lastEntry.traitId : null,
          ethTotal: '0',
          flipTotal: '0',
          ticketTotal: 0,
        });
      }
    }
  }

  // Legacy method — kept so existing #checkAllScratched / farFutureCoin center logic
  // still has a reference point. Not called from #triggerReveal anymore.
  #distributePrizes(displayTraits) {
    this.#quadWinArrays = [[], [], [], []];
    this.#centerWins = [];
    const addr = this.#selectedPlayer?.toLowerCase();
    if (!addr) return;

    const todaysTraits = new Set(displayTraits.filter(t => t != null));
    const playerDists = this.#distributions.filter(d => d.winner.toLowerCase() === addr);
    if (playerDists.length === 0) return;

    const quadDists = [];
    for (const dist of playerDists) {
      if (dist.awardType === 'farFutureCoin') {
        this.#centerWins.push(dist);
      } else if (dist.traitId == null || todaysTraits.has(dist.traitId)) {
        quadDists.push(dist);
      }
    }

    const noTraitDists = [];
    for (const dist of quadDists) {
      if (dist.traitId != null) {
        const contractQ = Math.floor(dist.traitId / 64);
        const displayPos = DISPLAY_ORDER.indexOf(contractQ);
        if (displayPos >= 0 && displayPos <= 3) this.#quadWinArrays[displayPos].push(dist);
      } else {
        noTraitDists.push(dist);
      }
    }
    if (noTraitDists.length > 0) {
      let bestQ = 0, bestEth = 0n;
      for (let i = 0; i < 4; i++) {
        const qEth = this.#quadWinArrays[i]
          .filter(d => d.awardType === 'eth')
          .reduce((s, d) => s + BigInt(d.amount || '0'), 0n);
        if (qEth > bestEth) { bestEth = qEth; bestQ = i; }
      }
      for (const dist of noTraitDists) this.#quadWinArrays[bestQ].push(dist);
    }
  }

  // --- Bonus Roll (Roll 2) ---

  // Authoritative packed traits for either board. Keeping this in one helper
  // guarantees a post-reveal flame toggle reconstructs the exact same faces as
  // the original main/bonus spins.
  #displayTraitsForRoll(bonus) {
    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    const packed = bonus ? rngEntry?.bonusTraitsPacked : rngEntry?.mainTraitsPacked;
    let traits;
    if (packed != null) {
      const p = Number(packed) >>> 0;
      traits = [p & 0xff, (p >>> 8) & 0xff, (p >>> 16) & 0xff, (p >>> 24) & 0xff];
    } else {
      traits = deriveWinningTraits(rngEntry?.finalWord || '0');
    }
    return toDisplayOrder(traits);
  }

  #prepareRoll2Prizes() {
    const nearFutureWins = this.#playerRoll2Wins.filter(w => w.traitId != null);
    const farFutureWins = this.#playerRoll2Wins.filter(w => w.traitId == null);
    this.#bonusTraitIds = new Set(nearFutureWins.map(w => w.traitId));
    this.#bonusQuadrants = new Set(nearFutureWins.map(w => Math.floor(w.traitId / 64)));
    this.#distributePrizesFromRoll2(nearFutureWins, farFutureWins);
  }

  /** /app/ opts into one shared roll button (see #btnMode). */
  #singleButton() {
    return this.hasAttribute('single-button');
  }

  #mainReadyForBonus() {
    return this.#mainScratchComplete || this.#mainAllRed;
  }

  #showBonusSection() {
    const section = this.querySelector('[data-bind="bonus-section"]');
    const btn = this.querySelector('[data-bind="bonus-btn"]');
    const noBonus = this.querySelector('[data-bind="no-bonus"]');
    if (!section) return;

    // Single-button mode: the main Reveal button already became "Bonus Roll",
    // so this section is only ever the no-bonus note.
    if (this.#singleButton()) {
      if (btn) btn.hidden = true;
      if (noBonus) noBonus.hidden = this.#hasBonus;
      section.hidden = this.#hasBonus;
      return;
    }

    // Only show after Roll 1 is done
    section.hidden = false;
    if (this.#hasBonus) {
      btn.hidden = false;
      btn.disabled = !this.#mainReadyForBonus();
      btn.title = this.#mainReadyForBonus()
        ? (this.#mainAllRed && !this.#mainScratchComplete ? 'All red — bonus roll ready' : '')
        : 'Scratch the main draw first';
      noBonus.hidden = true;
    } else {
      btn.hidden = true;
      noBonus.hidden = false;
    }
  }

  async #triggerBonusRoll() {
    // Public Roll 2 results remain viewable even for a player with no eligible
    // future ticket. The button is hidden only when no bonus draw exists.
    if (!this.#hasBonus
      || !this.#mainReadyForBonus()
      || this.#bonusPhase
      || this.#bonusScratchComplete) return;
    const bonusSection = this.querySelector('[data-bind="bonus-section"]');
    if (bonusSection) bonusSection.hidden = true;

    this.#bonusPhase = true;
    this.#bonusScratchComplete = false;
    this.#syncDrawToggleAffordance();

    // Near-future wins (traitId != null) go to quadrants; null-traitId = center diamond FLIP.
    this.#prepareRoll2Prizes();

    // Derive display traits for the spin — Roll 2 uses the *bonus* trait set
    // the contract rolled from the salted RNG (keccak(randWord, BONUS_TRAITS)),
    // NOT the main Roll 1 traits.  The indexer stores it in
    // daily_winning_traits.bonusTraitsPacked, served via /replay/rng.
    // Fallback to the main RNG word derivation when bonusTraitsPacked is
    // unavailable (legacy DB / first day) so the widget still animates.
    const displayTraits = this.#displayTraitsForRoll(true);

    // Reset canvases / scratch state so the main widget is fresh for Roll 2
    this.#resetMainWidget();

    const btn = this.querySelector('[data-bind="reveal-btn"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Bonus Roll...'; }

    // Colouring for this roll comes from the future-level holdings.
    await this.#loadFutureTraits();
    await this.#runSpin(displayTraits);

    if (btn) {
      if (this.#singleButton()) {
        // Both rolls are done — nothing left to fire until the day changes.
        this.#btnMode = 'reveal';
        btn.hidden = true;
      } else {
        btn.disabled = false;
        btn.textContent = 'Replay';
      }
    }
  }

  #syncDrawToggleAffordance() {
    const center = this.querySelector('[data-bind="center"]');
    if (!center) return;
    const ready = this.#hasBonus
      && this.#mainReadyForBonus()
      && this.#bonusScratchComplete
      && !this.#spinning
      && !this.#drawViewSwitching;
    center.classList.toggle('replay-ticket-center--draw-toggle', ready);
    if (!ready) {
      center.removeAttribute('role');
      center.removeAttribute('tabindex');
      center.removeAttribute('aria-label');
      center.removeAttribute('title');
      return;
    }
    const destination = this.#bonusPhase ? 'main' : 'bonus';
    center.setAttribute('role', 'button');
    center.setAttribute('tabindex', '0');
    center.setAttribute('aria-label', `Show ${destination} jackpot draw`);
    center.title = `Show ${destination} draw`;
  }

  async #toggleRevealedDraw() {
    if (this.#drawViewSwitching
      || this.#spinning
      || !this.#hasBonus
      || !this.#mainReadyForBonus()
      || !this.#bonusScratchComplete) return;

    this.#drawViewSwitching = true;
    this.#syncDrawToggleAffordance();
    const showBonus = !this.#bonusPhase;
    try {
      this.#bonusPhase = showBonus;
      if (showBonus) {
        this.#prepareRoll2Prizes();
        await this.#loadFutureTraits();
      } else {
        this.#distributePrizesFromRoll1();
      }
      this.#resetMainWidget();
      await this.#runSpin(this.#displayTraitsForRoll(showBonus), {
        instant: true,
        announce: false,
      });
    } finally {
      this.#drawViewSwitching = false;
      this.#syncDrawToggleAffordance();
    }
  }

  /**
   * Distribute Roll 2 prizes into quadrant arrays and center wins.
   * nearFutureWins (traitId != null) → one badge per win row per display-position quadrant.
   * farFutureWins (traitId == null) → center diamond FLIP total.
   * Each win row from /roll2 is already one discrete payout — no expansion needed.
   */
  #distributePrizesFromRoll2(nearFutureWins, farFutureWins) {
    this.#quadWinArrays = [[], [], [], []];
    this.#centerWins = [];

    const MAX_VISUAL_BADGES = 20;
    const totalPerPos = [0, 0, 0, 0];

    for (const win of nearFutureWins) {
      const contractQ = Math.floor(win.traitId / 64);
      const displayPos = DISPLAY_ORDER.indexOf(contractQ);
      if (displayPos < 0 || displayPos > 3) continue;

      totalPerPos[displayPos]++;
      if (this.#quadWinArrays[displayPos].length >= MAX_VISUAL_BADGES) continue;

      const at = win.awardType || '';
      this.#quadWinArrays[displayPos].push({
        awardType: 'aggregated',
        ethTotal: '0',
        flipTotal: (at === 'flip' || at === 'farFutureCoin') ? (win.amount || '0') : '0',
        ticketTotal: (at === 'tickets' || at === 'ticket') ? Number(win.amount || 0) : 0,
        traitId: win.traitId,
        ticketIndex: win.ticketIndex ?? null,
        level: win.level ?? null,
        sourceLevel: win.sourceLevel ?? null,
      });
    }

    // Overflow sentinels
    for (let pos = 0; pos < 4; pos++) {
      const rendered = this.#quadWinArrays[pos].length;
      const total = totalPerPos[pos];
      if (total > rendered) {
        const lastEntry = this.#quadWinArrays[pos][rendered - 1];
        this.#quadWinArrays[pos].push({
          awardType: 'overflow',
          overflowCount: total - rendered,
          traitId: lastEntry ? lastEntry.traitId : null,
          ethTotal: '0',
          flipTotal: '0',
          ticketTotal: 0,
        });
      }
    }

    // farFuture wins → center diamond: sum all amounts
    let ffTotal = 0n;
    for (const win of farFutureWins) {
      ffTotal += BigInt(win.amount || '0');
    }
    if (ffTotal > 0n) {
      this.#centerWins.push({ awardType: 'flip', amount: ffTotal.toString(), traitId: null });
    }
  }

  /**
   * Reset only the scratch/reveal state of the main widget (canvases, prizes, badges)
   * without touching data-loading state. Used before re-running the spin for Roll 2.
   */
  #resetMainWidget() {
    this.#animId++;
    this.#spinning = false;
    this.#sfxScratchStop();

    const quads = this.querySelectorAll('.replay-tq');
    quads.forEach(q => {
      q.classList.remove(
        'revealed', 'q-has-trait', 'q-no-tickets', 'q-scratchable',
        'q-has-tickets', 'q-public-result', 'q-win-impossible', 'q-win-impossible-lock',
        'q-owned-miss', 'q-player-win', 'q-gold-trait',
        'q-result-pending', 'q-result-revealed',
      );
      const img = q.querySelector('.badge-img');
      if (img) { img.src = ''; img.alt = ''; img.style.opacity = '0'; img.style.display = ''; }
      const canvas = q.querySelector('.replay-scratch-canvas');
      if (canvas) { canvas.style.opacity = '0'; canvas.style.pointerEvents = 'none'; }
      const prize = q.querySelector('.replay-prize-reveal');
      if (prize) {
        prize.classList.remove('visible', 'replay-bucket-reveal');
        prize.innerHTML = '';
        prize.removeAttribute('aria-label');
      }
    });
    this.#clearScatteredBadges();
    this.#hideCenterScratch();
    this.querySelector('[data-bind="card-grid"]')
      ?.classList.remove('replay-ticket--has-owned-gold');

    this.#scratched = [false, false, false, false];
    this.#scratchGrids = [null, null, null, null];
    this.#greenRevealed = [false, false, false, false];
    this.#badgesRevealed = [[], [], [], []];
    this.#quadBadgeBounds = [null, null, null, null];
    this.#quadOwned = [false, false, false, false];
    this.#quadPublicSummaries = [null, null, null, null];
    this.#centerScratched = false;
    this.#centerScratchGrid = null;

    const hint = this.querySelector('[data-bind="hint"]');
    if (hint) hint.textContent = '';
  }

  async #runSpin(displayTraits, { instant = false, announce = true } = {}) {
    this.#stopIdleSpin();
    const myId = ++this.#animId;
    this.#spinning = true;
    const quads = this.querySelectorAll('.replay-tq');
    const hint = this.querySelector('[data-bind="hint"]');

    // Track the viewed player's result in each quadrant. The main draw now lets
    // every quadrant scratch; this ownership state still drives the reel colours
    // and win sound. Roll 2 keeps its player-eligible-only scratch behavior.
    if (this.#bonusPhase) {
      for (let i = 0; i < 4; i++) {
        const contractQ = displayTraits[i] != null ? Math.floor(displayTraits[i] / 64) : -1;
        const hasPlayerWin = contractQ >= 0 && this.#bonusQuadrants.has(contractQ);
        // Roll 2 uses future-level holdings. A held offered trait that missed
        // its bucket is still a possible-win blue face, just like Roll 1; an
        // actual win is authoritative even if the by-trait endpoint lags.
        this.#quadOwned[i] = hasPlayerWin
          || (displayTraits[i] != null && this.#futureTraitIds.has(displayTraits[i]));
      }
    } else {
      const roll1TraitIds = new Set(this.#playerRoll1Wins.map(r => r.traitId).filter(t => t != null));
      for (let i = 0; i < 4; i++) {
        // Ownership and winning are different states. A player can hold the
        // offered trait and lose the bucket; that face must stay blue/gold
        // ("didn't win"), not flip to the red "win not possible" treatment.
        // A winner row is also authoritative ownership if the trait endpoint
        // happens to lag.
        this.#quadOwned[i] = displayTraits[i] != null
          && (this.#playerTraitIds.has(displayTraits[i])
            || roll1TraitIds.has(displayTraits[i]));
      }
    }

    // The set the spin colours against: the bonus roll grades the player's
    // future-level holdings, the main roll the day's level.
    const spinOwned = this.#bonusPhase ? this.#futureTraitIds : this.#playerTraitIds;

    // Reset state
    this.#scratched = [false, false, false, false];
    this.#scratchGrids = [null, null, null, null];
    this.#greenRevealed = [false, false, false, false];
    this.#badgesRevealed = [[], [], [], []];
    this.#quadBadgeBounds = [null, null, null, null];
    this.#centerScratched = false;
    this.#centerScratchGrid = null;
    this.#sfxScratchStop();

    // Start flame spinning animation
    const center = this.querySelector('[data-bind="center"]');
    if (center) center.classList.add('spinning');

    // Hide center scratch canvas and prize
    this.#hideCenterScratch();

    // Clear canvases and prizes
    if (hint) hint.textContent = '';
    this.#clearScatteredBadges();
    const mainBadges = this.querySelectorAll('.replay-ticket .badge-img');
    for (const mb of mainBadges) {
      mb.style.display = '';
      mb.removeAttribute('width');
      mb.removeAttribute('height');
    }

    for (let i = 0; i < 4; i++) {
      const canvas = quads[i].querySelector('.replay-scratch-canvas');
      if (canvas) {
        canvas.style.transition = 'none';
        canvas.style.opacity = '0';
        canvas.style.pointerEvents = 'none';
      }
      const prize = quads[i].querySelector('.replay-prize-reveal');
      if (prize) {
        prize.classList.remove('visible', 'replay-bucket-reveal');
        prize.innerHTML = '';
        prize.removeAttribute('aria-label');
      }
    }

    // Compute target for each display position
    const targets = displayTraits.map((traitId, i) => {
      if (traitId == null) return { contractQ: DISPLAY_ORDER[i], sym: 0, col: 0 };
      const contractQ = Math.floor(traitId / 64);
      const within = traitId % 64;
      // Canonical decode: symbol = bits 2:0 (within % 8), color = bits 5:3
      // (within / 8) — matches traitToBadge / foil-match.js. The prior swap
      // transposed symbol and color on every reel badge.
      return { contractQ, sym: within % 8, col: Math.floor(within / 8) };
    });

    // Refresh restoration: use the exact same ownership/prize preparation as
    // a played spin, but land synchronously and remove every cover. No sound,
    // celebration, or completion event is replayed on page load.
    if (instant) {
      this.#spinning = false;
      for (let i = 0; i < 4; i++) {
        const category = BADGE_QUADRANTS[DISPLAY_ORDER[i]];
        const img = quads[i].querySelector('.badge-img');
        if (img) {
          img.src = badgeCircularPath(category, targets[i].sym, targets[i].col);
          img.style.opacity = '1';
        }
      }
      this.#afterSpin(displayTraits, targets, quads, hint, { announce });
      for (let i = 0; i < 4; i++) {
        this.#revealQuadrant(i, { instant: true, silent: true });
      }
      this.#revealCenter({ instant: true, silent: true });
      return;
    }

    // Spin state
    const lockedColors = [false, false, false, false];
    const lockedSymbols = [false, false, false, false];
    let locksDone = 0;
    const totalLocks = 8;
    let idleCount = 2 + Math.floor(Math.random() * 3);
    let finalLockSettling = false;

    return new Promise(resolve => {
      const step = () => {
        if (myId !== this.#animId) {
          // Spin was cancelled (e.g. flame click) -- render final state and finish
          for (let i = 0; i < 4; i++) {
            const contractQ = DISPLAY_ORDER[i];
            const category = BADGE_QUADRANTS[contractQ];
            const path = badgeCircularPath(category, targets[i].sym, targets[i].col);
            const img = quads[i].querySelector('.badge-img');
            if (img) { img.src = path; img.style.opacity = '1'; }
          }
          this.#afterSpin(displayTraits, targets, quads, hint);
          // Auto-reveal all quadrants and center
          for (let i = 0; i < 4; i++) this.#revealQuadrant(i);
          this.#revealCenter();
          resolve();
          return;
        }

        // The final frame already contains all four authoritative traits and
        // their locked eligibility colours. Hold it for one paint interval
        // before mounting the identically coloured scratch covers.
        if (finalLockSettling) {
          this.#spinning = false;
          for (let i = 0; i < 4; i++) {
            const category = BADGE_QUADRANTS[DISPLAY_ORDER[i]];
            const img = quads[i].querySelector('.badge-img');
            if (img) img.src = badgeCircularPath(category, targets[i].sym, targets[i].col);
          }
          this.#afterSpin(displayTraits, targets, quads, hint);
          resolve();
          return;
        }

        this.#sfxTick(locksDone);

        // Advance one color/symbol lock before painting this frame. That makes
        // the selected quadrant visibly assume its final trait and eligibility
        // state at the moment its lock sound plays, including the eighth lock.
        if (idleCount <= 0 && locksDone < totalLocks) {
          const available = [];
          for (let q = 0; q < 4; q++) {
            if (!lockedColors[q]) available.push({ q, type: 'color' });
            else if (!lockedSymbols[q]) available.push({ q, type: 'symbol' });
          }
          if (available.length > 0) {
            const pick = available[Math.floor(Math.random() * available.length)];
            if (pick.type === 'color') lockedColors[pick.q] = true;
            else lockedSymbols[pick.q] = true;
            locksDone++;
            if (pick.type === 'symbol') this.#sfxLock(this.#quadOwned[pick.q]);
            else this.#sfxTick(locksDone);
            idleCount = 2 + Math.floor(Math.random() * 3);
          }
        } else {
          idleCount--;
        }

        // Render random or locked badges
        for (let i = 0; i < 4; i++) {
          const contractQ = DISPLAY_ORDER[i];
          const sym = lockedSymbols[i] ? targets[i].sym : Math.floor(Math.random() * 8);
          const col = lockedColors[i] ? targets[i].col : Math.floor(Math.random() * 8);
          const category = BADGE_QUADRANTS[contractQ];
          const path = badgeCircularPath(category, sym, col);

          const img = quads[i].querySelector('.badge-img');
          if (img) { img.src = path; img.style.opacity = '1'; }

          // Background colouring during the spin. Blue means "you hold THIS
          // trait" and is checked against the badge currently on screen, so the
          // colour tracks the reels instead of flashing at random (user call).
          // Which holdings count depends on the roll: the main spin draws from
          // the day's level, the bonus spin from the levels above it.
          quads[i].classList.remove(
            'q-has-trait',
            'q-no-tickets',
            'q-scratchable',
            'q-has-tickets',
            'q-gold-trait',
            'q-win-impossible-lock',
          );
          if (lockedSymbols[i] && lockedColors[i]) {
            // Fully locked -- ownership state, which is also what decides
            // scratchability once the reels stop.
            quads[i].classList.add(this.#quadOwned[i] ? 'q-has-trait' : 'q-no-tickets');
            // A target not owned for this draw = guaranteed loss. Commit the darker
            // scratch-front color as THIS quadrant locks. #afterSpin swaps the
            // paper underneath to the lighter pink while painting this same
            // dark color onto the removable canvas, so there is no face snap.
            if (!this.#quadOwned[i]) {
              quads[i].classList.add('q-win-impossible-lock');
            } else {
              quads[i].classList.remove('q-win-impossible-lock');
            }
            if (this.#quadOwned[i] && targets[i].col === 7) {
              quads[i].classList.add('q-gold-trait');
            }
          } else {
            quads[i].classList.remove('q-win-impossible-lock');
            // Mid-spin: the shown trait is quadrant/colour/symbol packed the
            // same way the contract packs it ([QQ][CCC][SSS]).
            const shownTrait = contractQ * 64 + col * 8 + sym;
            const ownsShown = spinOwned.has(shownTrait);
            quads[i].classList.add(ownsShown ? 'q-has-trait' : 'q-no-tickets');
            if (ownsShown && col === 7) quads[i].classList.add('q-gold-trait');
          }
        }
        this.#syncOwnedGoldState(quads);

        // Check if all locked
        if (locksDone >= totalLocks) {
          const anyOwned = this.#quadOwned.some(o => o);
          this.#sfxAllLocked(anyOwned);
          finalLockSettling = true;
          setTimeout(step, FINAL_LOCK_SETTLE_MS);
          return;
        }

        const delay = 80 + Math.floor((locksDone / totalLocks) * 120);
        setTimeout(step, delay);
      };
      step();
    });
  }

  #afterSpin(displayTraits, targets, quads, hint, { announce = true } = {}) {
    // Stop flame spinning
    const center = this.querySelector('[data-bind="center"]');
    if (center) center.classList.remove('spinning');

    // Both draws expose the complete public board. A player with no winning
    // entry uncovers the public bucket result: badge, per-entry payout, and
    // winning-entry count (ETH for Roll 1, FLIP for Roll 2).
    this.#quadPublicSummaries = this.#bonusPhase
      ? buildRoll2BucketSummaries(this.#dayRoll2?.wins, displayTraits)
      : buildRoll1BucketSummaries(
          this.#dayRoll1?.wins,
          displayTraits,
          this.#openingFlipDay ? 'FLIP' : 'ETH',
        );

    let anyScratchable = false;
    for (let i = 0; i < 4; i++) {
      quads[i].classList.remove(
        'q-has-trait',
        'q-no-tickets',
        'q-public-result',
        'q-win-impossible',
        'q-win-impossible-lock',
        'q-owned-miss',
        'q-player-win',
        'q-gold-trait',
        'q-result-pending',
        'q-result-revealed',
      );
      const hasPlayerWin = this.#quadWinArrays[i]
        .some((d) => d.awardType !== 'overflow');
      const heldTraits = this.#bonusPhase ? this.#futureTraitIds : this.#playerTraitIds;
      const winnerProvesDisplayedOwnership = this.#quadWinArrays[i]
        .some((d) => d.traitId != null && Number(d.traitId) === Number(displayTraits[i]));
      const ownsDisplayedTrait = displayTraits[i] != null
        && (heldTraits.has(displayTraits[i]) || winnerProvesDisplayedOwnership);
      const ownsDisplayedGold = ownsDisplayedTrait && isGoldTrait(displayTraits[i]);
      const publicResult = !hasPlayerWin
        ? (this.#quadPublicSummaries[i] || {
            traitId: displayTraits[i],
            winnerCount: null,
            perWinWei: null,
            currency: (this.#bonusPhase || this.#openingFlipDay) ? 'FLIP' : 'ETH',
          })
        : null;
      const scratchable = true;
      if (!scratchable) {
        this.#scratched[i] = true;
        quads[i].classList.add('q-no-tickets');
        continue;
      }

      anyScratchable = true;
      // The scratch cover carries blue/red/gold eligibility. Beneath it, keep
      // potential/actual wins neutral until the completion threshold (or an actual
      // win badge is uncovered). A truly unwinnable quadrant is already known
      // to be a loser, so it keeps the ordinary pink loser paper immediately.
      quads[i].classList.add('q-scratchable');
      if (ownsDisplayedGold) {
        quads[i].classList.add('q-gold-trait');
      } else if (hasPlayerWin) {
        quads[i].classList.add('q-player-win');
      } else if (publicResult && ownsDisplayedTrait) {
        quads[i].classList.add('q-owned-miss');
      } else if (publicResult) {
        quads[i].classList.add('q-win-impossible');
      }
      if (!(publicResult && !ownsDisplayedTrait)) {
        quads[i].classList.add('q-result-pending');
      }
      const canvas = quads[i].querySelector('.replay-scratch-canvas');
      const badge = quads[i].querySelector('.badge-img');
      this.#initScratchCanvasWithBadge(
        canvas,
        badge ? badge.src : '',
        ownsDisplayedGold
          ? GOLD_TRAIT_COVER_FILL
          : hasPlayerWin
            ? POSSIBLE_WIN_COVER_FILL
          : publicResult && !ownsDisplayedTrait
            ? NO_WIN_COVER_FILL
            : POSSIBLE_WIN_COVER_FILL,
      );
      canvas.style.transition = 'none';
      canvas.style.opacity = '1';
      canvas.style.pointerEvents = 'auto';

      if (publicResult) {
        quads[i].classList.add('q-public-result');
        // The badge is already painted into the removable canvas; the smaller
        // result badge below should be what appears as the player scratches.
        if (badge) badge.style.display = 'none';
        this.#renderPublicBucketReveal(i, publicResult);
      }
      this.#wireCanvas(canvas, i);
    }
    this.#syncOwnedGoldState(quads);

    // Hide main badges and place scattered badges only where THIS player won.
    // Bug 1 fix: sync the scratch canvas cover badge to the actual winning trait
    // (first entry's traitId) rather than the RNG-derived displayTrait, so the top
    // symbol matches the revealed symbols underneath.
    for (let i = 0; i < 4; i++) {
      const wins = this.#quadWinArrays[i];
      const hasPlayerWin = wins.some((d) => d.awardType !== 'overflow');
      if (hasPlayerWin) {
        const mainBadge = quads[i].querySelector('.badge-img');

        // Determine the canonical winning traitId for this quadrant.
        // For Roll 2 bonus the displayed RNG trait can differ from the player's
        // actual winning trait — use the first win entry's traitId when present.
        const canonicalTraitId = wins.length > 0 && wins[0].traitId != null
          ? wins[0].traitId
          : displayTraits[i];
        const canonicalBadge = traitToBadge(canonicalTraitId);
        const canonicalSrc = canonicalBadge ? canonicalBadge.path : (mainBadge ? mainBadge.src : '');

        // Re-paint the scratch cover with the winning trait badge so top = reveal.
        const canvas = quads[i].querySelector('.replay-scratch-canvas');
        if (canvas && canonicalSrc) {
          const canonicalGold = isGoldTrait(canonicalTraitId);
          this.#initScratchCanvasWithBadge(
            canvas,
            canonicalSrc,
            canonicalGold ? GOLD_TRAIT_COVER_FILL : POSSIBLE_WIN_COVER_FILL,
          );
          if (canonicalGold) {
            quads[i].classList.add('q-gold-trait');
            quads[i].classList.remove('q-player-win');
          } else {
            quads[i].classList.add('q-player-win');
          }
        }
        // Also update the visible badge-img to match (shown briefly before hide).
        if (mainBadge && canonicalSrc) mainBadge.src = canonicalSrc;

        if (mainBadge) mainBadge.style.display = 'none';
        if (wins.length > 0) {
          this.#placeWinBadges(i, canonicalTraitId);
        }
      }
    }
    this.#syncOwnedGoldState(quads);

    // Show center diamond scratch if player has FLIP wins
    if (this.#centerWins.length > 0) {
      this.#showCenterScratch();
      anyScratchable = true;
    }

    // A board with four guaranteed-loss faces and no center payout contains no
    // hidden personal result. Let the player continue directly to Roll 2; they
    // can still scratch or revisit the public main-board results later.
    if (!this.#bonusPhase) {
      this.#mainAllRed = this.#quadOwned.every((owned) => !owned)
        && this.#centerWins.length === 0;
    }

    if (!this.#bonusPhase) {
      if (hint) {
        hint.textContent = this.#mainAllRed && this.#hasBonus
          ? 'All red — bonus roll is ready.'
          : 'Scratch every quadrant to reveal the draw!';
      }
    } else if (anyScratchable) {
      if (hint) hint.textContent = 'Scratch every quadrant to reveal the bonus draw!';
    } else {
      if (hint) hint.textContent = '';
    }

    // Phase 64 (app embed): announce spin completion so host shells (the app's
    // last-day-jackpot wrapper) can open their spoiler gates + fire follow-on
    // UI (winnings banner, foil match lighting). Additive — no behavior change
    // for /play or /beta consumers.
    if (announce) {
      try {
        this.dispatchEvent(new CustomEvent('replay:spin-complete', {
          detail: { day: this.#selectedDay, player: this.#selectedPlayer },
          bubbles: true,
        }));
      } catch { /* headless / CustomEvent shim absent */ }
    }

    // Nothing scratchable this roll (defensive malformed/empty board) —
    // the reveal is trivially complete, so fire scratch-complete right away
    // or host gates would never open on lossless days.
    if (!anyScratchable && announce) this.#dispatchScratchComplete();
  }

  // Phase 64 (app embed): announce full scratch completion — every owned
  // quadrant revealed and the center diamond (when present) scratched.
  // Fires once per roll (Roll 1 and the bonus Roll 2 complete independently);
  // #revealQuadrant/#revealCenter guards keep it single-shot within a roll.
  // Additive — no behavior change for /play or /beta consumers.
  //
  // detail.bonusAvailable — a bonus Roll 2 is still ahead of the player
  // (eligible + not yet in the bonus phase). Hosts that gate "the whole
  // board is played out" on this: final = bonusPhase || !bonusAvailable.
  #dispatchScratchComplete() {
    try {
      this.dispatchEvent(new CustomEvent('replay:scratch-complete', {
        detail: {
          day: this.#selectedDay,
          player: this.#selectedPlayer,
          bonusPhase: this.#bonusPhase,
          bonusAvailable: this.#hasBonus && !this.#bonusPhase,
        },
        bubbles: true,
      }));
    } catch { /* headless / CustomEvent shim absent */ }
  }

  // --- Canvas scratch initialization ---

  /**
   * Paint a main-draw bucket result under the scratch cover when the viewed
   * player has no winning entry in that quadrant.
   */
  #renderPublicBucketReveal(qIdx, summary) {
    const quads = this.querySelectorAll('.replay-tq');
    const host = quads[qIdx] && quads[qIdx].querySelector('.replay-prize-reveal');
    if (!host) return;
    host.textContent = '';
    host.classList.add('replay-bucket-reveal', `replay-bucket-reveal--q${qIdx}`);

    const badge = traitToBadge(summary.traitId);
    if (badge) {
      const badgeImg = document.createElement('img');
      badgeImg.className = 'replay-bucket-badge';
      badgeImg.src = badge.path;
      badgeImg.alt = '';
      host.appendChild(badgeImg);
    }

    const amount = document.createElement('div');
    amount.className = 'replay-bucket-amount';
    const currencyWinnerCount = summary.winnerCount == null
      ? null
      : Number(summary.winnerCount);
    const num = document.createElement('span');
    const currency = summary.currency === 'FLIP' ? 'FLIP' : 'ETH';
    num.textContent = summary.perWinWei == null
      ? '—'
      : currency === 'FLIP'
        ? formatFlip(summary.perWinWei.toString())
        : formatEth(summary.perWinWei.toString());
    const currencyIcon = document.createElement('img');
    currencyIcon.className = 'replay-bucket-eth replay-bucket-currency';
    currencyIcon.src = currency === 'FLIP'
      ? '/badges-circular/flame_red.svg'
      : '/symbols/crypto_06_ethereum_silver.svg';
    currencyIcon.alt = currency;
    amount.appendChild(num);
    amount.appendChild(currencyIcon);
    const currencyWinners = document.createElement('span');
    currencyWinners.className = 'replay-bucket-row-count replay-bucket-row-count--currency';
    currencyWinners.textContent = `×${Number.isFinite(currencyWinnerCount) ? currencyWinnerCount : '—'}`;
    amount.appendChild(currencyWinners);
    host.appendChild(amount);

    const ticketEntriesPerWinner = summary.ticketEntriesPerWinner == null
      ? null
      : Number(summary.ticketEntriesPerWinner);
    const ticketCountPerWinner = ticketEntriesPerWinner == null
      || !Number.isFinite(ticketEntriesPerWinner)
      ? null
      : joScaledToTickets(ticketEntriesPerWinner);
    const ticketWinnerCount = summary.ticketWinnerCount == null
      ? null
      : Number(summary.ticketWinnerCount);
    const hasTicketAward = ticketCountPerWinner !== 0;
    if (hasTicketAward) {
      const tickets = document.createElement('div');
      tickets.className = 'replay-bucket-tickets';
      const perWinnerTickets = document.createElement('span');
      perWinnerTickets.className = 'replay-bucket-ticket-count';
      perWinnerTickets.textContent = ticketCountPerWinner == null
        ? '—'
        : ticketCountPerWinner.toLocaleString();
      const ticketIcon = document.createElement('span');
      ticketIcon.className = 'replay-bucket-ticket-icon';
      ticketIcon.setAttribute('aria-hidden', 'true');
      // Keep the award icon recognizably Degenerus at its tiny display size: it
      // is a complete four-badge ticket, not a blank admission-ticket glyph.
      // Mix both symbol and color across the four quadrants. The old 0/64/128/192
      // sample picked color slot zero four times, so the award looked like four
      // copies of the same pink/red ticket rather than a real inventory ticket.
      [1, 74, 147, 228].forEach((traitId, miniQ) => {
        const miniBadge = traitToBadge(traitId);
        if (!miniBadge) return;
        const miniBadgeImg = document.createElement('img');
        miniBadgeImg.className = `replay-bucket-ticket-badge replay-bucket-ticket-badge--q${miniQ}`;
        miniBadgeImg.src = miniBadge.path;
        miniBadgeImg.alt = '';
        ticketIcon.appendChild(miniBadgeImg);
      });
      const ticketFlame = document.createElement('img');
      ticketFlame.className = 'replay-bucket-ticket-flame';
      ticketFlame.src = '/whitepaper/flame-center.svg';
      ticketFlame.alt = '';
      ticketIcon.appendChild(ticketFlame);
      tickets.appendChild(perWinnerTickets);
      tickets.appendChild(ticketIcon);
      const ticketWinners = document.createElement('span');
      ticketWinners.className = 'replay-bucket-row-count replay-bucket-row-count--tickets';
      ticketWinners.textContent = `×${Number.isFinite(ticketWinnerCount) ? ticketWinnerCount : '—'}`;
      tickets.appendChild(ticketWinners);
      host.appendChild(tickets);
    }

    const perWin = summary.perWinWei == null
      ? `unknown ${currency}`
      : `${currency === 'FLIP'
        ? formatFlip(summary.perWinWei.toString())
        : formatEth(summary.perWinWei.toString())} ${currency}`;
    const currencyWinnersLabel = Number.isFinite(currencyWinnerCount)
      ? `${currencyWinnerCount} currency winner${currencyWinnerCount === 1 ? '' : 's'}`
      : 'unknown currency winners';
    const ticketWinnersLabel = Number.isFinite(ticketWinnerCount)
      ? `${ticketWinnerCount} ticket winner${ticketWinnerCount === 1 ? '' : 's'}`
      : 'unknown ticket winners';
    const ticketLabel = ticketCountPerWinner == null
      ? 'unknown tickets'
      : `${ticketCountPerWinner} ticket${ticketCountPerWinner === 1 ? '' : 's'}`;
    const ticketAwardLabel = hasTicketAward
      ? `; ticket award ${ticketLabel}, ${ticketWinnersLabel}`
      : '';
    host.setAttribute(
      'aria-label',
      `Currency award ${perWin}, ${currencyWinnersLabel}${ticketAwardLabel}`,
    );
  }

  #syncOwnedGoldState(quads = this.querySelectorAll('.replay-tq')) {
    const hasOwnedGold = Array.from(quads || [])
      .some((quad) => quad.classList?.contains('q-gold-trait'));
    this.querySelector('[data-bind="card-grid"]')
      ?.classList.toggle('replay-ticket--has-owned-gold', hasOwnedGold);
  }

  /** Render the viewed player's actual payout inside a revealed win quadrant. */
  #renderPlayerWinReveal(qIdx, host) {
    if (!host) return;
    const wins = (this.#quadWinArrays[qIdx] || [])
      .filter((win) => win.awardType !== 'overflow');
    if (wins.length === 0) return;

    let ethTotal = 0n;
    let flipTotal = 0n;
    let dgnrsTotal = 0n;
    let ticketEntries = 0;
    let whaleCount = 0;
    for (const win of wins) {
      const type = String(win.awardType || '').toLowerCase();
      if (type === 'aggregated') {
        ethTotal += BigInt(win.ethTotal || '0');
        flipTotal += BigInt(win.flipTotal || '0');
        dgnrsTotal += BigInt(win.dgnrsTotal || '0');
        ticketEntries += Number(win.ticketTotal || 0);
        whaleCount += Number(win.whalePassCount || 0);
      } else if (type === 'flip' || type === 'farfuturecoin' || win.currency === 'FLIP') {
        flipTotal += BigInt(win.amount || '0');
      } else if (type === 'dgnrs' || win.currency === 'DGNRS') {
        dgnrsTotal += BigInt(win.amount || '0');
      } else if (type === 'tickets' || type === 'ticket') {
        ticketEntries += Number(win.amount || 0);
      } else if (type === 'whale_pass') {
        whaleCount += Number(win.amount || 1);
      } else {
        ethTotal += BigInt(win.amount || '0');
      }
    }

    const lines = [];
    if (ethTotal > 0n) lines.push(`${formatEth(ethTotal.toString())} ETH`);
    if (flipTotal > 0n) lines.push(`${formatFlip(flipTotal.toString())} FLIP`);
    if (dgnrsTotal > 0n) lines.push(`${formatFlip(dgnrsTotal.toString())} DGNRS`);
    // JackpotTicketWin stores entryCount (4 entries = one whole ticket).
    // Day Summary already uses this conversion; keeping raw entries here is
    // what produced contradictory receipts such as 56 tickets versus 14.
    const ticketCount = joScaledToTickets(ticketEntries);
    if (ticketCount > 0) lines.push(`${ticketCount} ticket${ticketCount === 1 ? '' : 's'}`);
    if (whaleCount > 0) lines.push(`${whaleCount} whale pass${whaleCount === 1 ? '' : 'es'}`);
    if (lines.length === 0) lines.push(`${wins.length} win${wins.length === 1 ? '' : 's'}`);

    host.textContent = '';
    host.classList.remove('replay-bucket-reveal');
    const receipt = document.createElement('div');
    receipt.className = 'replay-win-description';
    const title = document.createElement('strong');
    title.className = 'replay-win-description__title';
    title.textContent = 'YOU WON';
    receipt.appendChild(title);
    const details = document.createElement('div');
    details.className = 'replay-win-description__lines';
    for (const line of lines) {
      const item = document.createElement('span');
      item.className = 'replay-win-description__line';
      item.textContent = line;
      details.appendChild(item);
    }
    receipt.appendChild(details);
    host.appendChild(receipt);
    host.setAttribute('aria-label', `You won ${lines.join(', ')}`);
  }

  #initScratchCanvasWithBadge(canvas, badgeSrc, fillColor) {
    const quad = canvas.parentElement;
    const rect = quad.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    const ctx = canvas.getContext('2d');
    // Draw the cover with badge image (matching demo's drawBadgeCover). Default
    // is the blue scratch cover; a known loser passes the darker locked-face
    // pink while the lighter loser paper remains visible through scratches.
    ctx.fillStyle = fillColor || POSSIBLE_WIN_COVER_FILL;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => {
      // Circular badge SVGs have a generous transparent artboard. Match the
      // larger live badge without letting the painted ring crowd the center
      // diamond; the canvas clips the small intentional outer bleed.
      const size = Math.min(canvas.width, canvas.height) * 1.18;
      const x = (canvas.width - size) / 2;
      const y = (canvas.height - size) / 2;
      ctx.drawImage(img, x, y, size, size);
    };
    img.src = badgeSrc;
  }

  #scratchAt(canvas, cx, cy) {
    const dpr = window.devicePixelRatio || 1;
    const r = BRUSH_R * dpr;
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // --- Quadrant scratch wiring ---

  #wireCanvas(canvas, qIdx) {
    const knownLoser = canvas.parentElement?.classList?.contains('q-win-impossible');
    const revealThreshold = knownLoser
      ? KNOWN_LOSER_REVEAL_THRESHOLD
      : REVEAL_THRESHOLD;
    let lastPos = null;
    const onScratch = (cx, cy) => {
      if (this.#scratched[qIdx]) return;
      this.#sfxScratchStart();
      const dpr = window.devicePixelRatio || 1;
      const brushR = BRUSH_R * dpr;
      this.#scratchAt(canvas, cx, cy);
      if (!this.#scratchGrids[qIdx]) this.#scratchGrids[qIdx] = makeScratchGrid(GRID_RES);
      markGridCells(this.#scratchGrids[qIdx], GRID_RES, canvas.width, canvas.height, cx, cy, brushR);

      // Check if scratch stroke reveals a win badge (green flash like demo)
      if (this.#quadWinArrays[qIdx].length > 0 && this.#quadBadgeBounds[qIdx]) {
        const pctX = (cx / canvas.width) * 100;
        const pctY = (cy / canvas.height) * 100;
        const circles = this.#quadBadgeBounds[qIdx];
        for (let ci = 0; ci < circles.length; ci++) {
          if (this.#badgesRevealed[qIdx].indexOf(ci) !== -1) continue;
          const ddx = pctX - circles[ci].cx, ddy = pctY - circles[ci].cy;
          if (ddx * ddx + ddy * ddy <= circles[ci].r * circles[ci].r) {
            this.#badgesRevealed[qIdx].push(ci);
            this.#sfxGreenReveal();
            if (!this.#greenRevealed[qIdx]) {
              this.#greenRevealed[qIdx] = true;
              const quads = this.querySelectorAll('.replay-tq');
              const quad = quads[qIdx];
              quad.classList.remove('q-scratchable', 'q-result-pending');
              quad.classList.add('q-result-revealed', 'q-has-tickets');
            }
          }
        }
      }

      // Interpolate between last position for smooth strokes
      if (lastPos) {
        const dx = cx - lastPos.x, dy = cy - lastPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.floor(dist / 4));
        for (let s = 1; s < steps; s++) {
          const ix = lastPos.x + dx * s / steps, iy = lastPos.y + dy * s / steps;
          this.#scratchAt(canvas, ix, iy);
          markGridCells(this.#scratchGrids[qIdx], GRID_RES, canvas.width, canvas.height, ix, iy, brushR);
        }
      }
      lastPos = { x: cx, y: cy };
      if (gridCoverage(this.#scratchGrids[qIdx]) >= revealThreshold) {
        this.#revealQuadrant(qIdx);
      }
    };

    const getPos = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      return { x: (clientX - rect.left) * dpr, y: (clientY - rect.top) * dpr };
    };

    canvas.addEventListener('mousemove', (e) => {
      if (this.#scratched[qIdx]) return;
      const p = getPos(e.clientX, e.clientY);
      onScratch(p.x, p.y);
    });
    canvas.addEventListener('mouseleave', () => { lastPos = null; this.#sfxScratchStop(); });
    canvas.addEventListener('touchstart', (e) => {
      if (this.#scratched[qIdx]) return;
      e.preventDefault(); lastPos = null;
      const t = e.touches[0], p = getPos(t.clientX, t.clientY);
      onScratch(p.x, p.y);
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (this.#scratched[qIdx]) return;
      e.preventDefault();
      const t = e.touches[0], p = getPos(t.clientX, t.clientY);
      onScratch(p.x, p.y);
    }, { passive: false });
    canvas.addEventListener('touchend', () => { lastPos = null; this.#sfxScratchStop(); });
  }

  // --- Center diamond scratch ---

  #hideCenterScratch() {
    const canvas = this.querySelector('[data-bind="center-canvas"]');
    const prize = this.querySelector('[data-bind="center-prize"]');
    const flame = this.querySelector('.replay-flame');
    const center = this.querySelector('[data-bind="center"]');
    if (canvas) { canvas.style.display = 'none'; canvas.style.opacity = '1'; canvas.style.pointerEvents = 'auto'; }
    if (prize) {
      prize.style.display = 'none';
      prize.innerHTML = '';
      prize.classList.remove('visible', 'replay-bucket-reveal');
      prize.removeAttribute('aria-label');
    }
    if (flame) { flame.style.display = ''; flame.style.filter = ''; }
    if (center) { center.classList.remove('revealed'); }
  }

  #showCenterScratch() {
    const canvas = this.querySelector('[data-bind="center-canvas"]');
    if (!canvas) return;
    const center = canvas.parentElement;
    const rect = center.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    // Hide the flame image
    const flame = this.querySelector('.replay-flame');
    if (flame) flame.style.display = 'none';

    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    // Dark cover with green-tinted flame
    ctx.fillStyle = '#0a1e1a';
    ctx.fillRect(0, 0, w, h);

    // Draw tinted flame on the cover
    const img = new Image();
    img.onload = () => {
      // Flame SVG viewBox is 38x54 (portrait) -- preserve aspect ratio
      const svgRatio = 38 / 54;
      const maxSize = Math.min(w, h) * 0.7;
      const drawW = maxSize * svgRatio;
      const drawH = maxSize;
      ctx.filter = 'sepia(1) saturate(3) hue-rotate(120deg) brightness(1.4)';
      ctx.drawImage(img, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
      ctx.filter = 'none';
    };
    img.src = '/specials/special_none.svg';

    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'auto';

    // Wire center scratch events
    this.#wireCenterCanvas(canvas);
  }

  #wireCenterCanvas(canvas) {
    let lastPos = null;
    const onScratch = (cx, cy) => {
      if (this.#centerScratched) return;
      this.#sfxScratchStart();
      const dpr = window.devicePixelRatio || 1;
      const brushR = BRUSH_R * dpr;
      this.#scratchAt(canvas, cx, cy);
      if (!this.#centerScratchGrid) this.#centerScratchGrid = makeScratchGrid(CENTER_GRID_RES);
      markGridCells(this.#centerScratchGrid, CENTER_GRID_RES, canvas.width, canvas.height, cx, cy, brushR);

      // Interpolate between last position for smooth strokes
      if (lastPos) {
        const dx = cx - lastPos.x, dy = cy - lastPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.floor(dist / 4));
        for (let s = 1; s < steps; s++) {
          const ix = lastPos.x + dx * s / steps, iy = lastPos.y + dy * s / steps;
          this.#scratchAt(canvas, ix, iy);
          markGridCells(this.#centerScratchGrid, CENTER_GRID_RES, canvas.width, canvas.height, ix, iy, brushR);
        }
      }
      lastPos = { x: cx, y: cy };
      // Center uses 50% threshold (smaller area)
      if (gridCoverage(this.#centerScratchGrid) >= 0.5) {
        this.#revealCenter();
      }
    };

    const getPos = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      return { x: (clientX - rect.left) * dpr, y: (clientY - rect.top) * dpr };
    };

    canvas.addEventListener('mousemove', (e) => {
      if (this.#centerScratched) return;
      const p = getPos(e.clientX, e.clientY);
      onScratch(p.x, p.y);
    });
    canvas.addEventListener('mouseleave', () => { lastPos = null; this.#sfxScratchStop(); });
    canvas.addEventListener('touchstart', (e) => {
      if (this.#centerScratched) return;
      e.preventDefault(); lastPos = null;
      const t = e.touches[0], p = getPos(t.clientX, t.clientY);
      onScratch(p.x, p.y);
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (this.#centerScratched) return;
      e.preventDefault();
      const t = e.touches[0], p = getPos(t.clientX, t.clientY);
      onScratch(p.x, p.y);
    }, { passive: false });
    canvas.addEventListener('touchend', () => { lastPos = null; this.#sfxScratchStop(); });
  }

  #revealCenter({ instant = false, silent = false } = {}) {
    if (this.#centerScratched || this.#centerWins.length === 0) return;
    this.#centerScratched = true;
    this.#sfxScratchStop();
    if (!silent) this.#sfxGreenReveal();

    const canvas = this.querySelector('[data-bind="center-canvas"]');
    const prize = this.querySelector('[data-bind="center-prize"]');
    const center = this.querySelector('[data-bind="center"]');

    // Darken diamond background
    if (center) center.classList.add('revealed');

    if (canvas) {
      canvas.style.transition = instant ? 'none' : 'opacity 0.35s ease';
      canvas.style.opacity = '0';
      canvas.style.pointerEvents = 'none';
    }

    if (prize) {
      const totalFlip = this.#centerWins.reduce((s, d) => s + BigInt(d.amount || '0'), 0n);
      const amountStr = formatFlip(totalFlip.toString()) + ' FLIP';
      prize.innerHTML = `<span class="ff-amount">${amountStr}</span><span class="ff-label">Far Future</span>`;
      prize.style.display = 'flex';
      prize.classList.remove('visible');
      if (instant) prize.classList.add('visible');
      else setTimeout(() => prize.classList.add('visible'), 200);
    }

    this.#checkAllScratched({ silent });
  }

  // --- Quadrant reveal ---

  #revealQuadrant(qIdx, { instant = false, silent = false } = {}) {
    if (this.#scratched[qIdx]) return;
    this.#scratched[qIdx] = true;
    this.#sfxScratchStop();
    const quads = this.querySelectorAll('.replay-tq');
    const quad = quads[qIdx];
    const canvas = quad.querySelector('.replay-scratch-canvas');
    const prize = quad.querySelector('.replay-prize-reveal');

    // Fade out canvas
    canvas.style.transition = instant ? 'none' : 'opacity 0.35s ease';
    canvas.style.opacity = '0';
    canvas.style.pointerEvents = 'none';

    const isWin = this.#quadWinArrays[qIdx].some(d => d.awardType !== 'overflow');
    if (!silent) this.#sfxReveal(isWin);

    quad.classList.remove('q-scratchable', 'q-result-pending');
    quad.classList.add('q-result-revealed');
    if (isWin) {
      quad.classList.add('q-has-tickets');
    } else {
      quad.classList.add('q-no-tickets');
      // Show main badge again for non-win owned quadrants
      const mainBadge = quad.querySelector('.badge-img');
      if (mainBadge) mainBadge.style.display = '';
    }

    // A public bucket result uses the same prize layer as a player win. Since
    // `isWin` is false, explicitly reveal it and keep the full-size live badge
    // hidden; the result carries its own smaller badge.
    if (quad.classList.contains('q-public-result') && prize && !isWin) {
      prize.classList.add('visible');
      const mainBadge = quad.querySelector('.badge-img');
      if (mainBadge) mainBadge.style.display = 'none';
    }

    // The public-result rebuild accidentally dropped the viewed player's own
    // payout copy. Restore it as a compact receipt inside the quadrant (not the
    // obsolete full-width winnings bar) and reveal it only after the cover is gone.
    if (prize && isWin) {
      this.#renderPlayerWinReveal(qIdx, prize);
      prize.classList.remove('visible');
      if (instant) prize.classList.add('visible');
      else setTimeout(() => prize.classList.add('visible'), 200);
    }

    // Append "+N more" overflow label only now that the quadrant is revealed
    // (deferred from #placeWinBadges so it doesn't show through the scratch canvas).
    const overflowEntry = this.#quadWinArrays[qIdx].find(d => d.awardType === 'overflow');
    if (isWin && overflowEntry && overflowEntry.overflowCount > 0) {
      const label = document.createElement('div');
      label.className = 'replay-badge-overflow-label';
      label.textContent = '+' + overflowEntry.overflowCount + ' more';
      quad.appendChild(label);
    }

    this.#checkAllScratched({ silent });
  }

  #checkAllScratched({ silent = false } = {}) {
    const hint = this.querySelector('[data-bind="hint"]');
    const centerPending = this.#centerWins.length > 0 && !this.#centerScratched;
    const allDone = this.#scratched.every(s => s) && !centerPending;
    if (allDone) {
      if (hint) hint.textContent = '';
      if (!this.#bonusPhase) {
        this.#mainScratchComplete = true;
        const sharedBtn = this.querySelector('[data-bind="reveal-btn"]');
        if (this.#singleButton() && this.#btnMode === 'bonus' && sharedBtn) {
          sharedBtn.disabled = false;
          sharedBtn.title = '';
        }
        const bonusBtn = this.querySelector('[data-bind="bonus-btn"]');
        if (bonusBtn) {
          bonusBtn.disabled = false;
          bonusBtn.title = '';
        }
      } else {
        this.#bonusScratchComplete = true;
      }
      this.#syncDrawToggleAffordance();
      const anyWon = this.#quadWinArrays.some(w => w.some(d => d.awardType !== 'overflow')) || this.#centerWins.length > 0;
      if (!silent) {
        if (anyWon) this.#celebrate();
        this.#dispatchScratchComplete();
      }
    } else {
      let remaining = this.#scratched.filter(s => !s).length;
      if (centerPending) remaining++;
      if (hint) hint.textContent = remaining + ' area' + (remaining !== 1 ? 's' : '') + ' left to scratch';
    }
  }

  // --- Scattered win badges ---

  #placeWinBadges(qIdx, traitId) {
    const quads = this.querySelectorAll('.replay-tq');
    const quad = quads[qIdx];
    const wins = this.#quadWinArrays[qIdx];
    if (!wins || wins.length === 0) return;

    // Separate overflow sentinel (awardType='overflow') from real badge entries
    const overflowEntry = wins.find(w => w.awardType === 'overflow');
    const realWins = wins.filter(w => w.awardType !== 'overflow');
    if (realWins.length === 0) return;

    // Default badge for this quadrant (used for wins without traitId)
    const defaultBadge = traitToBadge(traitId);
    const defaultPath = defaultBadge ? defaultBadge.path : '';
    const count = realWins.length;
    let maxSize, minSize;
    if (count === 1) { minSize = 30; maxSize = 65; }
    else if (count <= 3) { minSize = 25; maxSize = 50; }
    else if (count <= 8) { minSize = 18; maxSize = 35; }
    else { minSize = 14; maxSize = 26; }

    const placed = [];
    const allBounds = [];
    // Solo-bucket entry (ETH + whale_pass + dgnrs merged) gets a dominant badge.
    // Scale up more aggressively when the solo ETH slice is large — main
    // jackpot wins on final days pay 60% of the trait pool, so the badge
    // should read as the centerpiece of the quadrant.
    const soloIdx = realWins.findIndex(w => w.isSolo);
    const soloEthFloatEth = soloIdx >= 0
      ? Number(BigInt(realWins[soloIdx].ethTotal || '0') / 10n**15n) / 1000  // wei → ETH
      : 0;
    const soloSize = soloIdx < 0 ? 0
      : soloEthFloatEth >= 5 ? 95
      : soloEthFloatEth >= 1 ? 85
      : soloEthFloatEth >= 0.1 ? 75
      : 65;
    for (let w = 0; w < realWins.length; w++) {
      let sizePct = minSize + (w / Math.max(1, realWins.length - 1)) * (maxSize - minSize);
      if (realWins.length === 1) sizePct = maxSize;
      if (w === soloIdx) sizePct = soloSize;
      let bestLeft = null, bestTop = null, bestOverlap = Infinity;
      for (let a = 0; a < 50; a++) {
        const tryLeft = Math.random() * (100 - sizePct);
        const tryTop = Math.random() * (90 - sizePct);
        const tryCX = tryLeft + sizePct / 2, tryCY = tryTop + sizePct / 2;
        let overlap = 0;
        for (const p of placed) {
          const dx = tryCX - p.cx, dy = tryCY - p.cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = (sizePct + p.size) / 2;
          if (dist < minDist) overlap += minDist - dist;
        }
        if (overlap < bestOverlap) { bestOverlap = overlap; bestLeft = tryLeft; bestTop = tryTop; }
        if (overlap === 0) break;
      }
      placed.push({ cx: bestLeft + sizePct / 2, cy: bestTop + sizePct / 2, size: sizePct });
      allBounds.push({ left: bestLeft, top: bestTop, right: bestLeft + sizePct, bottom: bestTop + sizePct });

      // Use each win's own traitId for its badge; fall back to quadrant default
      const winBadge = realWins[w].traitId != null ? traitToBadge(realWins[w].traitId) : defaultBadge;
      const winPath = winBadge ? winBadge.path : defaultPath;

      const wrap = document.createElement('div');
      wrap.className = 'replay-badge-wrap';
      wrap.style.width = sizePct + '%';
      wrap.style.left = bestLeft + '%';
      wrap.style.top = bestTop + '%';
      const img = document.createElement('img');
      img.src = winPath; img.className = 'replay-scattered-badge'; img.alt = '';
      wrap.appendChild(img);
      quad.appendChild(wrap);
    }

    // Overflow "+N more" label is deferred until the quadrant is fully
    // scratched — appended inside #revealQuadrant.

    // Store badge hit circles for green-reveal detection during scratch
    const circles = [];
    for (const bb of allBounds) {
      circles.push({ cx: (bb.left + bb.right) / 2, cy: (bb.top + bb.bottom) / 2, r: (bb.right - bb.left) / 2 });
    }
    this.#quadBadgeBounds[qIdx] = circles;
  }

  #clearScatteredBadges() {
    const els = this.querySelectorAll('.replay-badge-wrap, .replay-badge-overflow-label');
    for (const el of els) el.remove();
  }

  #resetCards() {
    this.#animId++; // cancel any running spin
    this.#spinning = false;
    this.#stopIdleSpin();
    this.#sfxScratchStop();
    const quads = this.querySelectorAll('.replay-tq');
    quads.forEach(q => {
      q.classList.remove(
        'revealed', 'q-has-trait', 'q-no-tickets', 'q-scratchable',
        'q-has-tickets', 'q-public-result', 'q-win-impossible', 'q-win-impossible-lock',
        'q-owned-miss', 'q-player-win', 'q-gold-trait',
        'q-result-pending', 'q-result-revealed',
      );
      const img = q.querySelector('.badge-img');
      if (img) { img.src = ''; img.alt = ''; img.style.opacity = '0'; img.style.display = ''; img.removeAttribute('width'); img.removeAttribute('height'); }
      const canvas = q.querySelector('.replay-scratch-canvas');
      if (canvas) { canvas.style.opacity = '0'; canvas.style.pointerEvents = 'none'; }
      const prize = q.querySelector('.replay-prize-reveal');
      if (prize) {
        prize.classList.remove('visible', 'replay-bucket-reveal');
        prize.innerHTML = '';
        prize.removeAttribute('aria-label');
      }
    });
    this.#clearScatteredBadges();
    this.querySelector('[data-bind="card-grid"]')
      ?.classList.remove('replay-ticket--has-owned-gold');

    // Reset center diamond
    this.#hideCenterScratch();

    this.#scratched = [false, false, false, false];
    this.#scratchGrids = [null, null, null, null];
    this.#greenRevealed = [false, false, false, false];
    this.#badgesRevealed = [[], [], [], []];
    this.#quadBadgeBounds = [null, null, null, null];
    this.#quadOwned = [false, false, false, false];
    this.#quadWinArrays = [[], [], [], []];
    this.#quadPublicSummaries = [null, null, null, null];
    this.#centerWins = [];
    this.#centerScratched = false;
    this.#centerScratchGrid = null;

    // Reset per-player roll win caches
    this.#playerRoll1Wins = [];
    this.#playerRoll2Wins = [];

    // Reset bonus roll state
    this.#bonusPhase = false;
    this.#mainScratchComplete = false;
    this.#mainAllRed = false;
    this.#bonusScratchComplete = false;
    this.#drawViewSwitching = false;
    this.#bonusTraitIds = new Set();
    this.#bonusQuadrants = new Set();
    this.#syncDrawToggleAffordance();
    // Single-button mode hides/relabels the main button as the rolls play out;
    // a new day (or a re-reveal) puts it back to "Reveal Draw".
    this.#btnMode = 'reveal';
    const revealBtn = this.querySelector('[data-bind="reveal-btn"]');
    if (revealBtn) { revealBtn.hidden = false; revealBtn.textContent = 'Reveal Draw'; }
    const bonusSection = this.querySelector('[data-bind="bonus-section"]');
    if (bonusSection) bonusSection.hidden = true;
    const bonusBtn = this.querySelector('[data-bind="bonus-btn"]');
    if (bonusBtn) {
      bonusBtn.disabled = true;
      bonusBtn.hidden = false;
      bonusBtn.title = 'Scratch the main draw first';
    }
    const noBonus = this.querySelector('[data-bind="no-bonus"]');
    if (noBonus) noBonus.hidden = true;

    const hint = this.querySelector('[data-bind="hint"]');
    if (hint) hint.textContent = '';
  }

  async #celebrate() {
    playSound('win');
    this.#sfxFanfare();
    try {
      const { default: confetti } = await import('canvas-confetti');
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 }, colors: ['#22c55e', '#8b5cf6', '#eab308', '#06b6d4'] });
      setTimeout(() => {
        confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0 } });
        confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1 } });
      }, 200);
    } catch {}
  }

  // --- Web Audio SFX (ported faithfully from jackpot-demo.html) ---

  #getAudio() {
    if (!this.#audioCtx) this.#audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.#audioCtx.state === 'suspended') this.#audioCtx.resume();
    return this.#audioCtx;
  }

  #sfxTick(lockCount) {
    const ctx = this.#getAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 400 + (lockCount / 8) * 500;
    osc.type = 'square';
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.06);
  }

  #sfxLock(owned) {
    const ctx = this.#getAudio();
    if (owned) {
      const o1 = ctx.createOscillator(), g1 = ctx.createGain();
      o1.connect(g1); g1.connect(ctx.destination);
      o1.frequency.value = 660; o1.type = 'sine';
      g1.gain.setValueAtTime(0.12, ctx.currentTime);
      g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      o1.start(ctx.currentTime); o1.stop(ctx.currentTime + 0.15);
      const o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.connect(g2); g2.connect(ctx.destination);
      o2.frequency.value = 880; o2.type = 'sine';
      g2.gain.setValueAtTime(0.12, ctx.currentTime + 0.08);
      g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      o2.start(ctx.currentTime + 0.08); o2.stop(ctx.currentTime + 0.22);
    } else {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.12);
      osc.type = 'triangle';
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
    }
  }

  #sfxAllLocked(anyOwned) {
    const ctx = this.#getAudio();
    if (anyOwned) {
      const o1 = ctx.createOscillator(), g1 = ctx.createGain();
      o1.connect(g1); g1.connect(ctx.destination);
      o1.frequency.setValueAtTime(200, ctx.currentTime);
      o1.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.15);
      o1.type = 'sine';
      g1.gain.setValueAtTime(0.18, ctx.currentTime);
      g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      o1.start(ctx.currentTime); o1.stop(ctx.currentTime + 0.2);
      const o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.connect(g2); g2.connect(ctx.destination);
      o2.frequency.value = 1320; o2.type = 'sine';
      g2.gain.setValueAtTime(0.06, ctx.currentTime + 0.05);
      g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      o2.start(ctx.currentTime + 0.05); o2.stop(ctx.currentTime + 0.5);
    } else {
      const o1 = ctx.createOscillator(), g1 = ctx.createGain();
      o1.connect(g1); g1.connect(ctx.destination);
      o1.frequency.setValueAtTime(120, ctx.currentTime);
      o1.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.3);
      o1.type = 'sawtooth';
      g1.gain.setValueAtTime(0.1, ctx.currentTime);
      g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      o1.start(ctx.currentTime); o1.stop(ctx.currentTime + 0.35);
    }
  }

  #sfxScratchStart() {
    if (this.#scratchNode) return;
    const ctx = this.#getAudio();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    noise.buffer = buf; noise.loop = true;
    filter.type = 'bandpass'; filter.frequency.value = 3000; filter.Q.value = 0.5;
    noise.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    gain.gain.value = 0.04;
    noise.start();
    this.#scratchNode = { noise, gain };
  }

  #sfxScratchStop() {
    if (!this.#scratchNode) return;
    try { this.#scratchNode.noise.stop(); } catch {}
    this.#scratchNode = null;
  }

  #sfxGreenReveal() {
    const ctx = this.#getAudio();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.05);
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
  }

  #sfxReveal(isWin) {
    const ctx = this.#getAudio();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (isWin) {
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.25);
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35);
    } else {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(349, ctx.currentTime + 0.2);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.6);
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.6);
    }
  }

  #sfxFanfare() {
    const ctx = this.#getAudio();
    const notes = [523, 659, 784, 1047];
    for (let i = 0; i < notes.length; i++) {
      const freq = notes[i], delay = i * 0.12;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = 'sine';
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.4);
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.4);
    }
  }
}

customElements.define('replay-panel', ReplayPanel);
