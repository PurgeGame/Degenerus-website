// components/replay-panel.js -- Jackpot Replay Viewer
// Browse historical jackpot draws: pick a level/day, view tickets, replay the reveal animation.
// Slot-machine spin cycles badges through quadrants with live background coloring per player
// trait ownership, then owned quadrants get a canvas scratch-off that reveals prize amounts.
// Center diamond scratches to reveal BURNIE wins (farFutureCoin distributions).
//
// Ported faithfully from jackpot-demo.html scratch/reveal UX.

import { deriveWinningTraits, traitToBadge, toDisplayOrder, DISPLAY_ORDER } from '../app/jackpot-data.js';
import { joScaledToTickets } from '../app/jackpot-rolls.js';
import { formatEth, formatBurnie, truncateAddress } from '../app/utils.js';
import { playSound } from '../app/audio.js';
import { API_BASE, BADGE_QUADRANTS, BADGE_COLORS, BADGE_ITEMS, badgeCircularPath } from '../app/constants.js';
import { batch, update } from '../app/store.js';

async function replayFetch(path) {
  const res = await fetch(API_BASE + '/replay' + path);
  if (!res.ok) throw new Error(`Replay API ${res.status}: ${path}`);
  return res.json();
}

// --- Module-level scratch helpers ---

const BRUSH_R = 22;
const REVEAL_THRESHOLD = 0.75;
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
 * For BURNIE: uses formatBurnie (wei string).
 */
function formatPrizeAmount(weiString, currency) {
  if (currency === 'BURNIE') return formatBurnie(weiString);
  return formatEth(weiString);
}

// --- Component ---

class ReplayPanel extends HTMLElement {
  #rngDays = [];       // [{day, finalWord}]
  #players = [];       // [address, ...]
  #tickets = [];       // [{address, ticketCount, totalMintedOnLevel}]
  #selectedDay = null;
  #selectedLevel = null;
  #selectedPlayer = null;
  #distributions = []; // raw distributions from replay/day endpoint (used for prize mapping)
  #winners = [];       // winner objects from /game/jackpot/day/:day/winners

  // Per-day roll caches from /game/jackpot/day/:day/roll1 and /roll2
  #dayRoll1 = null;    // full response: { day, level, purchaseLevel, wins: [...] }
  #dayRoll2 = null;    // full response: { day, level, purchaseLevel, wins: [...] }

  // Per-player filtered wins (derived from day caches by filtering on winner address)
  #playerRoll1Wins = [];  // wins[].filter(w => w.winner === selectedAddr)
  #playerRoll2Wins = [];  // wins[].filter(w => w.winner === selectedAddr)
  #hasBonus = false;      // whether this player has Roll 2 wins

  // Spin + scratch state
  #playerTraitIds = new Set();  // Set<number> of owned trait IDs (for spin coloring)
  #traitsCacheAddress = null;   // address for which #playerTraitIds was fetched
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
  #bonusTraitIds = new Set();   // traitIds the player won in Roll 2 (unused — kept for compat)
  #bonusQuadrants = new Set();  // contract quadrant numbers with roll2.future wins

  #audioCtx = null;             // Web Audio context for SFX
  #scratchNode = null;          // active scratch noise node
  #mouseIsDown = false;         // global mouse button state
  #badgeCache = new Map();      // path → warmed Image (preloaded badge SVG cache)

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
    this.querySelector('[data-bind="reveal-btn"]').addEventListener('click', () => this.#triggerReveal());
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

    // Skip spin on center flame click
    const centerEl = this.querySelector('[data-bind="center"]');
    if (centerEl) {
      centerEl.addEventListener('click', () => {
        if (!this.#spinning) return;
        this.#animId++;
        this.#spinning = false;
      });
    }

    this.#loadDays();
    this.#preloadBadges(); // warm browser cache for all badge SVGs in background
  }

  disconnectedCallback() {
    this.#animId++;  // cancel any running spin
    this.#sfxScratchStop();
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
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

  async #loadDays() {
    try {
      const data = await replayFetch('/rng');
      this.#rngDays = data.days;
      const select = this.querySelector('[data-bind="day-select"]');
      select.innerHTML = '<option value="">Pick a jackpot day</option>' +
        data.days.map(d => `<option value="${d.day}">Day ${d.day} — L${d.level} ${d.phase}${d.dayInPhase}</option>`).join('');
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load days:', err);
      const select = this.querySelector('[data-bind="day-select"]');
      select.innerHTML = '<option value="">Failed to load</option>';
    }
  }

  async #loadTickets(level) {
    try {
      const data = await replayFetch(`/tickets/${level}`);
      this.#tickets = data.players;

      // Compute winnings per player from distributions (ETH vs BURNIE)
      const ethByAddr = {};
      const burnieByAddr = {};
      let ethCount = 0, burnieCount = 0;
      for (const dist of this.#distributions) {
        const addr = dist.winner.toLowerCase();
        const t = dist.awardType || '';
        const isBurnie = dist.currency === 'BURNIE' || t === 'burnie' || t === 'farFutureCoin';
        const isEth = t === 'eth';
        if (isBurnie) {
          burnieByAddr[addr] = (burnieByAddr[addr] || 0n) + BigInt(dist.amount || '0');
        } else if (isEth) {
          ethByAddr[addr] = (ethByAddr[addr] || 0n) + BigInt(dist.amount || '0');
        }
      }

      const select = this.querySelector('[data-bind="player-select"]');
      select.innerHTML = '<option value="">All players (' + data.players.length + ')</option>' +
        data.players.map(p => {
          const addr = p.address.toLowerCase();
          const eth = ethByAddr[addr];
          const burnie = burnieByAddr[addr];
          const parts = [];
          if (eth) parts.push(`${formatEth(eth.toString())} ETH`);
          if (burnie) parts.push(`${formatBurnie(burnie.toString())} BURNIE`);
          const wonLabel = parts.length > 0 ? ` | Won ${parts.join(' + ')}` : '';
          return `<option value="${p.address}">${truncateAddress(p.address)} (${p.ticketCount} tix${wonLabel})</option>`;
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
  }

  #filterPlayerWins(addr) {
    const norm = addr.toLowerCase();
    this.#playerRoll1Wins = (this.#dayRoll1?.wins || []).filter(w => w.winner.toLowerCase() === norm);
    this.#playerRoll2Wins = (this.#dayRoll2?.wins || []).filter(w => w.winner.toLowerCase() === norm);
    this.#hasBonus = this.#playerRoll2Wins.length > 0;
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

  async #loadPlayerTraits() {
    if (!this.#selectedPlayer) {
      this.#playerTraitIds = new Set();
      this.#traitsCacheAddress = null;
      return;
    }
    if (this.#traitsCacheAddress === this.#selectedPlayer) return; // cache hit
    try {
      const data = await replayFetch('/player-traits/' + this.#selectedPlayer);
      this.#playerTraitIds = new Set(Array.isArray(data.traitIds) ? data.traitIds : []);
      this.#traitsCacheAddress = this.#selectedPlayer;
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load player traits:', err);
      this.#playerTraitIds = new Set();
      this.#traitsCacheAddress = null;
    }
  }

  // --- Event Handlers ---

  async #onDayChange(e) {
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
        this.#selectedLevel = wJson.level ?? (this.#distributions[0]?.level ?? null);
        this.#winners = wJson.winners || [];
      } else if (this.#distributions.length > 0) {
        this.#selectedLevel = this.#distributions[0].level;
      }
    } catch {
      if (this.#distributions.length > 0) {
        this.#selectedLevel = this.#distributions[0].level;
      }
    }

    // Tickets are stored at purchaseLevel = gameLevel + 1
    if (this.#selectedLevel != null) {
      await this.#loadTickets(this.#selectedLevel + 1);
    }

    // Enable reveal button if we have RNG + player + winners
    const canReveal = hasRng && this.#selectedPlayer && this.#winners.length > 0;
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
  }

  #onPlayerChange(e) {
    const addr = e.target.value;
    this.#selectedPlayer = addr || null;
    // Publish replay-player selection so sibling widgets (status-bar activity
    // score) can react without coupling to this panel.
    update('replay.player', this.#selectedPlayer);
    this.#updateTicketInfo();
    this.#loadPlayerTraits();
    // Re-render distributions to update (YOU) labels
    if (this.#winners.length > 0) {
      this.#showDistributions(this.#winners);
    }
    // Update reveal button state
    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    const hasRng = rngEntry && rngEntry.finalWord && rngEntry.finalWord !== '0';
    this.querySelector('[data-bind="reveal-btn"]').disabled = !hasRng || !this.#selectedPlayer || !this.#winners.length;
  }

  #updateTicketInfo() {
    const infoEl = this.querySelector('[data-bind="ticket-info"]');
    const countEl = this.querySelector('[data-bind="ticket-count"]');
    const detailEl = this.querySelector('[data-bind="ticket-detail"]');

    if (!this.#selectedPlayer) {
      const total = this.#tickets.reduce((sum, t) => sum + t.ticketCount, 0);
      countEl.textContent = `${total.toLocaleString()} total tickets`;
      detailEl.textContent = `across ${this.#tickets.length} players`;
      infoEl.hidden = false;
      return;
    }

    const player = this.#tickets.find(t => t.address === this.#selectedPlayer);
    if (player) {
      countEl.textContent = `${player.ticketCount.toLocaleString()} tickets`;
      detailEl.textContent = `${player.totalMintedOnLevel.toLocaleString()} minted on level`;
      infoEl.hidden = false;

      const won = this.#winners.find(w => w.address.toLowerCase() === this.#selectedPlayer.toLowerCase());
      if (won) {
        countEl.textContent += ' -- WINNER';
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
   * hasBonus: if true, split entries into Roll 1 (eth/tickets) vs Bonus Roll (burnie non-null traitId)
   *           vs Bonus Center (null-traitId burnie). This matches exactly what the widget renders
   *           across Roll 1 quadrants + Roll 2 bonus quadrants + center diamond.
   */
  #buildWinnerTooltip(breakdown, hasBonus = false) {
    if (!breakdown || breakdown.length === 0) return '<em>No detail available</em>';

    /**
     * Render a set of entries grouped by traitId into tooltip HTML.
     * entries: [{awardType, amount, count, traitId}]
     */
    const renderEntryGroup = (entries) => {
      const byTrait = new Map(); // traitId|'bonus'|'solo' -> entries[]
      for (const entry of entries) {
        let key;
        if (entry.traitId != null) {
          key = entry.traitId;
        } else if ((entry.awardType || '') === 'whale_pass') {
          key = 'solo'; // whale_pass is awarded to the solo-winner quadrant, not the bonus center
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
          } else if (at === 'burnie' || at === 'farFutureCoin' || at.includes('burnie')) {
            formatted = `${formatBurnie(e.amount)} BURNIE`;
          } else if (at === 'tickets' || at === 'ticket') {
            formatted = `${e.amount} ticket${e.amount !== '1' ? 's' : ''}`;
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
      // No bonus roll — render all entries flat, grouped by traitId
      return renderEntryGroup(breakdown);
    }

    // Partition: Roll 1 entries (eth / tickets / whale_pass) vs Bonus Roll entries (burnie with
    // non-null traitId) vs Bonus Center (null-traitId burnie / farFutureCoin).
    // This mirrors the two-phase widget exactly: Roll 1 quadrants show ETH+tickets, Roll 2 bonus
    // quadrants show BURNIE per trait, center diamond shows null-traitId BURNIE.
    const roll1Entries = [];
    const bonusQuadEntries = [];
    const bonusCenterEntries = [];

    for (const entry of breakdown) {
      const at = entry.awardType || '';
      const isBurnie = at === 'burnie' || at === 'farFutureCoin' || at.includes('burnie');
      if (isBurnie && entry.traitId == null) {
        bonusCenterEntries.push(entry);
      } else if (isBurnie && entry.traitId != null) {
        bonusQuadEntries.push(entry);
      } else {
        roll1Entries.push(entry);
      }
    }

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
    return parts.length > 0 ? parts.join('') : '<em>No detail available</em>';
  }

  // --- Reveal / Spin ---

  async #triggerReveal() {
    if (!this.#selectedDay || !this.#selectedPlayer) return;

    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    if (!rngEntry || !rngEntry.finalWord || rngEntry.finalWord === '0') return;

    this.#resetCards();
    await this.#loadPlayerTraits(); // ensure traits loaded for spin coloring

    // Filter the pre-cached day roll1/roll2 responses down to this player's wins.
    this.#filterPlayerWins(this.#selectedPlayer);

    // Derive winning traits from the RNG word for the spin animation display.
    const traits = deriveWinningTraits(rngEntry.finalWord);
    const displayTraits = toDisplayOrder(traits);

    // Map per-player roll1 wins to quadrant prize arrays.
    this.#distributePrizesFromRoll1();

    const btn = this.querySelector('[data-bind="reveal-btn"]');
    btn.disabled = true;
    btn.textContent = 'Revealing...';

    await this.#runSpin(displayTraits);

    btn.disabled = false;
    btn.textContent = 'Replay';

    // After Roll 1 spin: show bonus section
    this.#showBonusSection();
  }

  /**
   * Build a per-traitId lookup from the winner's breakdown array.
   * breakdown entries have { awardType, amount, count, traitId }.
   * Returns Map<traitId, { ethTotal: bigint, burnieTotal: bigint }>.
   * Also returns { centerBurnie: bigint } for null-traitId burnie/farFutureCoin entries.
   */
  #buildBreakdownLookup(breakdown) {
    const byTrait = new Map();
    let centerBurnie = 0n;
    for (const entry of (breakdown || [])) {
      const at = entry.awardType || '';
      const amt = BigInt(entry.amount || '0');
      const cnt = BigInt(entry.count || 1);
      const total = amt * cnt;
      if (entry.traitId == null) {
        // null-traitId burnie = farFutureCoin center wins
        if (at === 'burnie' || at === 'farFutureCoin') centerBurnie += total;
        continue;
      }
      if (!byTrait.has(entry.traitId)) byTrait.set(entry.traitId, { ethTotal: 0n, burnieTotal: 0n });
      const rec = byTrait.get(entry.traitId);
      if (at === 'eth') rec.ethTotal += total;
      else if (at === 'burnie' || at === 'farFutureCoin') rec.burnieTotal += total;
      // tickets are read from row.ticketsPerWinner (already aggregated correctly)
    }
    return { byTrait, centerBurnie };
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
        burnieTotal: (at === 'burnie' || at === 'farFutureCoin') ? (win.amount || '0') : '0',
        ticketTotal: (at === 'tickets' || at === 'ticket') ? Number(win.amount || 0) : 0,
        traitId: win.traitId,
        ticketIndex: win.ticketIndex ?? null,
        level: win.level ?? null,
        sourceLevel: win.sourceLevel ?? null,
      });
    }

    // whale_pass / dgnrs wins (no traitId) → attach to the SOLO bucket.
    // The solo bucket is where this player is the only winner, which on the
    // contract side pays the biggest single ETH slice (60% on final day,
    // 20% otherwise — still larger than the per-winner share in multi-winner
    // buckets).  Picking the quadrant with the largest *single* ETH win
    // lands on that bucket, whereas summing totals can tip toward a
    // multi-winner quadrant whose cumulative payout exceeds the solo share.
    const noTraitWins = this.#playerRoll1Wins.filter(w => w.traitId == null);
    if (noTraitWins.length > 0) {
      let bestPos = 0, bestSingle = 0n;
      for (let i = 0; i < 4; i++) {
        for (const d of this.#quadWinArrays[i]) {
          const amt = BigInt(d.ethTotal || '0');
          if (amt > bestSingle) { bestSingle = amt; bestPos = i; }
        }
      }
      for (const win of noTraitWins) {
        const at = win.awardType || '';
        totalPerPos[bestPos]++;
        if (this.#quadWinArrays[bestPos].length < MAX_VISUAL_BADGES) {
          this.#quadWinArrays[bestPos].push({
            awardType: 'aggregated',
            ethTotal: '0',
            burnieTotal: '0',
            ticketTotal: 0,
            whalePassCount: at === 'whale_pass' ? Number(win.amount || 1) : 0,
            dgnrsTotal: at === 'dgnrs' ? (win.amount || '0') : '0',
            traitId: null,
          });
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
          burnieTotal: '0',
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

  #showBonusSection() {
    const section = this.querySelector('[data-bind="bonus-section"]');
    const btn = this.querySelector('[data-bind="bonus-btn"]');
    const noBonus = this.querySelector('[data-bind="no-bonus"]');
    if (!section) return;

    // Only show after Roll 1 is done
    section.hidden = false;
    if (this.#hasBonus) {
      btn.hidden = false;
      noBonus.hidden = true;
    } else {
      btn.hidden = true;
      noBonus.hidden = false;
    }
  }

  async #triggerBonusRoll() {
    if (!this.#playerRoll2Wins || this.#playerRoll2Wins.length === 0) return;
    const bonusSection = this.querySelector('[data-bind="bonus-section"]');
    if (bonusSection) bonusSection.hidden = true;

    this.#bonusPhase = true;

    // Near-future wins (traitId != null) go to quadrants; null-traitId = center diamond BURNIE.
    const nearFutureWins = this.#playerRoll2Wins.filter(w => w.traitId != null);
    const farFutureWins  = this.#playerRoll2Wins.filter(w => w.traitId == null);

    // Store Roll 2 contract quadrant numbers for spin quadrant-ownership detection.
    this.#bonusTraitIds = new Set(nearFutureWins.map(w => w.traitId));
    this.#bonusQuadrants = new Set(nearFutureWins.map(w => Math.floor(w.traitId / 64)));

    // Build prize arrays from filtered wins
    this.#distributePrizesFromRoll2(nearFutureWins, farFutureWins);

    // Derive display traits for the spin — use the same RNG word (same draw)
    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    const traits = deriveWinningTraits(rngEntry.finalWord);
    const displayTraits = toDisplayOrder(traits);

    // Reset canvases / scratch state so the main widget is fresh for Roll 2
    this.#resetMainWidget();

    const btn = this.querySelector('[data-bind="reveal-btn"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Bonus Roll...'; }

    await this.#runSpin(displayTraits);

    if (btn) { btn.disabled = false; btn.textContent = 'Replay'; }
  }

  /**
   * Distribute Roll 2 prizes into quadrant arrays and center wins.
   * nearFutureWins (traitId != null) → one badge per win row per display-position quadrant.
   * farFutureWins (traitId == null) → center diamond BURNIE total.
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

      this.#quadWinArrays[displayPos].push({
        awardType: 'aggregated',
        ethTotal: '0',
        burnieTotal: win.awardType === 'burnie' ? (win.amount || '0') : '0',
        ticketTotal: 0,
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
          burnieTotal: '0',
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
      this.#centerWins.push({ awardType: 'burnie', amount: ffTotal.toString(), traitId: null });
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
      q.classList.remove('revealed', 'q-has-trait', 'q-no-tickets', 'q-scratchable', 'q-has-tickets');
      const img = q.querySelector('.badge-img');
      if (img) { img.src = ''; img.alt = ''; img.style.opacity = '0'; img.style.display = ''; }
      const canvas = q.querySelector('.replay-scratch-canvas');
      if (canvas) { canvas.style.opacity = '0'; canvas.style.pointerEvents = 'none'; }
      const prize = q.querySelector('.replay-prize-reveal');
      if (prize) { prize.classList.remove('visible'); prize.innerHTML = ''; }
    });
    this.#clearScatteredBadges();
    this.#hideCenterScratch();

    this.#scratched = [false, false, false, false];
    this.#scratchGrids = [null, null, null, null];
    this.#greenRevealed = [false, false, false, false];
    this.#badgesRevealed = [[], [], [], []];
    this.#quadBadgeBounds = [null, null, null, null];
    this.#quadOwned = [false, false, false, false];
    this.#centerScratched = false;
    this.#centerScratchGrid = null;

    const hint = this.querySelector('[data-bind="hint"]');
    if (hint) hint.textContent = '';
  }

  async #runSpin(displayTraits) {
    const myId = ++this.#animId;
    this.#spinning = true;
    const quads = this.querySelectorAll('.replay-tq');
    const hint = this.querySelector('[data-bind="hint"]');

    // Determine which quadrants are scratchable: a quadrant is scratchable only if
    // this player actually has a winning row for that display position.
    // Roll 1: match by exact traitId (display trait must be a won trait).
    // Roll 2 bonus: match by contract quadrant — future rows are the player's own traits
    //   which differ from the drawn display traits, so we check if the contract quadrant
    //   of the drawn trait (displayTraits[i]/64) appears in #bonusQuadrants.
    // Fall back to player trait ownership when no row data is available.
    if (this.#bonusPhase) {
      for (let i = 0; i < 4; i++) {
        if (this.#bonusQuadrants.size > 0) {
          const contractQ = displayTraits[i] != null ? Math.floor(displayTraits[i] / 64) : -1;
          this.#quadOwned[i] = contractQ >= 0 && this.#bonusQuadrants.has(contractQ);
        } else {
          this.#quadOwned[i] = false;
        }
      }
    } else {
      const roll1TraitIds = new Set(this.#playerRoll1Wins.map(r => r.traitId).filter(t => t != null));
      for (let i = 0; i < 4; i++) {
        if (roll1TraitIds.size > 0) {
          this.#quadOwned[i] = displayTraits[i] != null && roll1TraitIds.has(displayTraits[i]);
        } else {
          // Fallback: use player trait ownership (pre-D3 behaviour)
          this.#quadOwned[i] = displayTraits[i] != null && this.#playerTraitIds.has(displayTraits[i]);
        }
      }
    }

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
      if (prize) { prize.classList.remove('visible'); prize.innerHTML = ''; }
    }

    // Compute target for each display position
    const targets = displayTraits.map((traitId, i) => {
      if (traitId == null) return { contractQ: DISPLAY_ORDER[i], sym: 0, col: 0 };
      const contractQ = Math.floor(traitId / 64);
      const within = traitId % 64;
      return { contractQ, sym: Math.floor(within / 8), col: within % 8 };
    });

    // Spin state
    const lockedColors = [false, false, false, false];
    const lockedSymbols = [false, false, false, false];
    let locksDone = 0;
    const totalLocks = 8;
    let idleCount = 2 + Math.floor(Math.random() * 3);

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

        this.#sfxTick(locksDone);

        // Render random or locked badges
        for (let i = 0; i < 4; i++) {
          const contractQ = DISPLAY_ORDER[i];
          const sym = lockedSymbols[i] ? targets[i].sym : Math.floor(Math.random() * 8);
          const col = lockedColors[i] ? targets[i].col : Math.floor(Math.random() * 8);
          const category = BADGE_QUADRANTS[contractQ];
          const path = badgeCircularPath(category, sym, col);

          const img = quads[i].querySelector('.badge-img');
          if (img) { img.src = path; img.style.opacity = '1'; }

          // Background coloring during spin
          quads[i].classList.remove('q-has-trait', 'q-no-tickets', 'q-scratchable', 'q-has-tickets');
          if (lockedSymbols[i] && lockedColors[i]) {
            // Fully locked -- show ownership state
            quads[i].classList.add(this.#quadOwned[i] ? 'q-has-trait' : 'q-no-tickets');
          } else if (lockedSymbols[i]) {
            // Symbol locked but color still spinning -- show based on actual ownership
            quads[i].classList.add(this.#quadOwned[i] ? 'q-has-trait' : 'q-no-tickets');
          } else {
            // Still spinning -- flash randomly like the demo
            quads[i].classList.add(Math.random() < 0.5 ? 'q-has-trait' : 'q-no-tickets');
          }
        }

        // Lock logic
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

        // Check if all locked
        if (locksDone >= totalLocks) {
          const anyOwned = this.#quadOwned.some(o => o);
          this.#sfxAllLocked(anyOwned);
          this.#spinning = false;

          // Render final badges
          for (let i = 0; i < 4; i++) {
            const contractQ = DISPLAY_ORDER[i];
            const category = BADGE_QUADRANTS[contractQ];
            const path = badgeCircularPath(category, targets[i].sym, targets[i].col);
            const img = quads[i].querySelector('.badge-img');
            if (img) img.src = path;
          }

          this.#afterSpin(displayTraits, targets, quads, hint);
          resolve();
          return;
        }

        const delay = 80 + Math.floor((locksDone / totalLocks) * 120);
        setTimeout(step, delay);
      };
      step();
    });
  }

  #afterSpin(displayTraits, targets, quads, hint) {
    // Stop flame spinning
    const center = this.querySelector('[data-bind="center"]');
    if (center) center.classList.remove('spinning');

    let anyOwned = false;
    for (let i = 0; i < 4; i++) {
      quads[i].classList.remove('q-has-trait', 'q-no-tickets');
      if (this.#quadOwned[i]) {
        anyOwned = true;
        quads[i].classList.remove('q-no-tickets');
        quads[i].classList.add('q-scratchable');

        // Init scratch canvas with badge cover
        const canvas = quads[i].querySelector('.replay-scratch-canvas');
        const badgeSrc = quads[i].querySelector('.badge-img').src;
        this.#initScratchCanvasWithBadge(canvas, badgeSrc);
        canvas.style.transition = 'none';
        canvas.style.opacity = '1';
        canvas.style.pointerEvents = 'auto';

        // Wire scratch events
        this.#wireCanvas(canvas, i);
      } else {
        this.#scratched[i] = true;
        quads[i].classList.add('q-no-tickets');
      }
    }

    // Now hide main badges and place scattered win badges for owned quadrants.
    // Bug 1 fix: sync the scratch canvas cover badge to the actual winning trait
    // (first entry's traitId) rather than the RNG-derived displayTrait, so the top
    // symbol matches the revealed symbols underneath.
    for (let i = 0; i < 4; i++) {
      if (this.#quadOwned[i]) {
        const mainBadge = quads[i].querySelector('.badge-img');

        // Determine the canonical winning traitId for this quadrant.
        // For Roll 2 bonus the displayed RNG trait can differ from the player's
        // actual winning trait — use the first win entry's traitId when present.
        const wins = this.#quadWinArrays[i];
        const canonicalTraitId = wins.length > 0 && wins[0].traitId != null
          ? wins[0].traitId
          : displayTraits[i];
        const canonicalBadge = traitToBadge(canonicalTraitId);
        const canonicalSrc = canonicalBadge ? canonicalBadge.path : (mainBadge ? mainBadge.src : '');

        // Re-paint the scratch cover with the winning trait badge so top = reveal.
        const canvas = quads[i].querySelector('.replay-scratch-canvas');
        if (canvas && canonicalSrc) {
          this.#initScratchCanvasWithBadge(canvas, canonicalSrc);
        }
        // Also update the visible badge-img to match (shown briefly before hide).
        if (mainBadge && canonicalSrc) mainBadge.src = canonicalSrc;

        mainBadge.style.display = 'none';
        if (wins.length > 0) {
          this.#placeWinBadges(i, canonicalTraitId);
        }
      }
    }

    // Show center diamond scratch if player has BURNIE wins
    if (this.#centerWins.length > 0) {
      this.#showCenterScratch();
      anyOwned = true;
    }

    if (anyOwned) {
      if (hint) hint.textContent = 'Scratch to find your winners!';
    } else if (this.#centerWins.length > 0) {
      if (hint) hint.textContent = 'You won BURNIE from the center pool!';
    } else {
      if (hint) hint.textContent = 'No matching tickets this round';
    }
  }

  // --- Canvas scratch initialization ---

  #initScratchCanvasWithBadge(canvas, badgeSrc) {
    const quad = canvas.parentElement;
    const rect = quad.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    const ctx = canvas.getContext('2d');
    // Draw blue cover with badge image (matching demo's drawBadgeCover)
    ctx.fillStyle = '#b8d4e8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => {
      const size = Math.min(canvas.width, canvas.height) * 0.92;
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
              quad.classList.remove('q-scratchable');
              quad.classList.add('q-has-tickets');
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
      if (gridCoverage(this.#scratchGrids[qIdx]) >= REVEAL_THRESHOLD) {
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
    if (prize) { prize.style.display = 'none'; prize.innerHTML = ''; prize.classList.remove('visible'); }
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

  #revealCenter() {
    if (this.#centerScratched || this.#centerWins.length === 0) return;
    this.#centerScratched = true;
    this.#sfxScratchStop();
    this.#sfxGreenReveal();

    const canvas = this.querySelector('[data-bind="center-canvas"]');
    const prize = this.querySelector('[data-bind="center-prize"]');
    const center = this.querySelector('[data-bind="center"]');

    // Darken diamond background
    if (center) center.classList.add('revealed');

    if (canvas) {
      canvas.style.transition = 'opacity 0.35s ease';
      canvas.style.opacity = '0';
      canvas.style.pointerEvents = 'none';
    }

    if (prize) {
      const totalBurnie = this.#centerWins.reduce((s, d) => s + BigInt(d.amount || '0'), 0n);
      const amountStr = formatBurnie(totalBurnie.toString()) + ' BURNIE';
      prize.innerHTML = `<span class="ff-amount">${amountStr}</span><span class="ff-label">Far Future</span>`;
      prize.style.display = 'flex';
      prize.classList.remove('visible');
      setTimeout(() => prize.classList.add('visible'), 200);
    }

    this.#checkAllScratched();
  }

  // --- Quadrant reveal ---

  #revealQuadrant(qIdx) {
    if (this.#scratched[qIdx]) return;
    this.#scratched[qIdx] = true;
    this.#sfxScratchStop();
    const quads = this.querySelectorAll('.replay-tq');
    const quad = quads[qIdx];
    const canvas = quad.querySelector('.replay-scratch-canvas');
    const prize = quad.querySelector('.replay-prize-reveal');

    // Fade out canvas
    canvas.style.transition = 'opacity 0.35s ease';
    canvas.style.opacity = '0';
    canvas.style.pointerEvents = 'none';

    const isWin = this.#quadWinArrays[qIdx].some(d => d.awardType !== 'overflow');
    this.#sfxReveal(isWin);

    quad.classList.remove('q-scratchable');
    if (isWin) {
      quad.classList.add('q-has-tickets');
    } else {
      quad.classList.add('q-no-tickets');
      // Show main badge again for non-win owned quadrants
      const mainBadge = quad.querySelector('.badge-img');
      if (mainBadge) mainBadge.style.display = '';
    }

    // Show prize overlay — sum by currency type (skip overflow sentinels)
    if (prize && isWin) {
      const wins = this.#quadWinArrays[qIdx].filter(d => d.awardType !== 'overflow');
      // ticketScaledSum: scaled ticketCount (×TICKET_SCALE=100), rounded to
      // whole tickets at display (see line below).
      let ethTotal = 0n, burnieTotal = 0n, dgnrsTotal = 0n, ticketScaledSum = 0, whaleCount = 0;
      for (const d of wins) {
        const t = d.awardType || '';
        if (t === 'aggregated') {
          // Entry produced by #distributePrizesFromRoll1/2 — all amounts pre-normalised
          ethTotal += BigInt(d.ethTotal || '0');
          burnieTotal += BigInt(d.burnieTotal || '0');
          ticketScaledSum += Number(d.ticketTotal || 0);
          whaleCount += Number(d.whalePassCount || 0);
          dgnrsTotal += BigInt(d.dgnrsTotal || '0');
        } else if (t === 'burnie' || t === 'farFutureCoin' || d.currency === 'BURNIE') {
          burnieTotal += BigInt(d.amount || '0');
        } else if (t === 'dgnrs') {
          dgnrsTotal += BigInt(d.amount || '0');
        } else if (t === 'tickets') {
          ticketScaledSum += Number(d.amount || '0');
        } else if (t === 'whale_pass') {
          whaleCount += Number(d.amount || '1');
        } else {
          ethTotal += BigInt(d.amount || '0');
        }
      }
      const ticketCount = joScaledToTickets(ticketScaledSum);
      const lines = [];
      if (ethTotal > 0n) lines.push(formatEth(ethTotal.toString()) + ' ETH');
      if (burnieTotal > 0n) lines.push(formatBurnie(burnieTotal.toString()) + ' BURNIE');
      if (dgnrsTotal > 0n) {
        const dgnrsNum = Number(dgnrsTotal / 10n**18n);
        const label = dgnrsNum >= 1e9 ? (dgnrsNum / 1e9).toFixed(1) + 'B'
          : dgnrsNum >= 1e6 ? (dgnrsNum / 1e6).toFixed(1) + 'M'
          : dgnrsNum >= 1e3 ? (dgnrsNum / 1e3).toFixed(1) + 'K'
          : String(dgnrsNum);
        lines.push(label + ' DGNRS');
      }
      if (ticketCount > 0) lines.push(ticketCount + ' ticket' + (ticketCount !== 1 ? 's' : ''));
      if (whaleCount > 0) lines.push(whaleCount + ' whale pass' + (whaleCount !== 1 ? 'es' : ''));
      if (lines.length === 0) lines.push(wins.length + ' win' + (wins.length !== 1 ? 's' : ''));
      prize.innerHTML = '<div class="replay-prize-bar">' +
        lines.map(l => '<span class="replay-prize-total">' + l + '</span>').join('') +
        '</div>';
      prize.classList.remove('visible');
      setTimeout(() => prize.classList.add('visible'), 200);
    }

    this.#checkAllScratched();
  }

  #checkAllScratched() {
    const hint = this.querySelector('[data-bind="hint"]');
    const centerPending = this.#centerWins.length > 0 && !this.#centerScratched;
    const allDone = this.#scratched.every(s => s) && !centerPending;
    if (allDone) {
      if (hint) hint.textContent = '';
      const anyWon = this.#quadWinArrays.some(w => w.some(d => d.awardType !== 'overflow')) || this.#centerWins.length > 0;
      if (anyWon) this.#celebrate();
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
    for (let w = 0; w < realWins.length; w++) {
      let sizePct = minSize + (w / Math.max(1, realWins.length - 1)) * (maxSize - minSize);
      if (realWins.length === 1) sizePct = maxSize;
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

    // If there were more emissions than the visual cap, show a "+N more" label
    if (overflowEntry && overflowEntry.overflowCount > 0) {
      const label = document.createElement('div');
      label.className = 'replay-badge-overflow-label';
      label.textContent = '+' + overflowEntry.overflowCount + ' more';
      quad.appendChild(label);
    }

    // Store badge hit circles for green-reveal detection during scratch
    const circles = [];
    for (const bb of allBounds) {
      circles.push({ cx: (bb.left + bb.right) / 2, cy: (bb.top + bb.bottom) / 2, r: (bb.right - bb.left) / 2 });
    }
    this.#quadBadgeBounds[qIdx] = circles;
  }

  #clearScatteredBadges() {
    const els = this.querySelectorAll('.replay-badge-wrap');
    for (const el of els) el.remove();
  }

  #resetCards() {
    this.#animId++; // cancel any running spin
    this.#spinning = false;
    this.#sfxScratchStop();
    const quads = this.querySelectorAll('.replay-tq');
    quads.forEach(q => {
      q.classList.remove('revealed', 'q-has-trait', 'q-no-tickets', 'q-scratchable', 'q-has-tickets');
      const img = q.querySelector('.badge-img');
      if (img) { img.src = ''; img.alt = ''; img.style.opacity = '0'; img.style.display = ''; img.removeAttribute('width'); img.removeAttribute('height'); }
      const canvas = q.querySelector('.replay-scratch-canvas');
      if (canvas) { canvas.style.opacity = '0'; canvas.style.pointerEvents = 'none'; }
      const prize = q.querySelector('.replay-prize-reveal');
      if (prize) { prize.classList.remove('visible'); prize.innerHTML = ''; }
    });
    this.#clearScatteredBadges();

    // Reset center diamond
    this.#hideCenterScratch();

    this.#scratched = [false, false, false, false];
    this.#scratchGrids = [null, null, null, null];
    this.#greenRevealed = [false, false, false, false];
    this.#badgesRevealed = [[], [], [], []];
    this.#quadBadgeBounds = [null, null, null, null];
    this.#quadOwned = [false, false, false, false];
    this.#quadWinArrays = [[], [], [], []];
    this.#centerWins = [];
    this.#centerScratched = false;
    this.#centerScratchGrid = null;

    // Reset per-player roll win caches
    this.#playerRoll1Wins = [];
    this.#playerRoll2Wins = [];

    // Reset bonus roll state
    this.#bonusPhase = false;
    this.#bonusTraitIds = new Set();
    this.#bonusQuadrants = new Set();
    const bonusSection = this.querySelector('[data-bind="bonus-section"]');
    if (bonusSection) bonusSection.hidden = true;
    const bonusBtn = this.querySelector('[data-bind="bonus-btn"]');
    if (bonusBtn) { bonusBtn.disabled = false; bonusBtn.hidden = false; }
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
