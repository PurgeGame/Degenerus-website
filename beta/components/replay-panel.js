// components/replay-panel.js -- Jackpot Replay Viewer
// Browse historical jackpot draws: pick a level/day, view tickets, replay the reveal animation.
// Slot-machine spin cycles badges through quadrants with live background coloring per player
// trait ownership, then owned quadrants get a canvas scratch-off that reveals prize amounts.

import { deriveWinningTraits, traitToBadge, toDisplayOrder, DISPLAY_ORDER } from '../app/jackpot-data.js';
import { formatEth, truncateAddress } from '../app/utils.js';
import { playSound } from '../app/audio.js';
import { API_BASE, BADGE_QUADRANTS, BADGE_COLORS, BADGE_ITEMS, badgeCircularPath } from '../app/constants.js';

async function replayFetch(path) {
  const res = await fetch(API_BASE + '/replay' + path);
  if (!res.ok) throw new Error(`Replay API ${res.status}: ${path}`);
  return res.json();
}

// --- Module-level scratch helpers ---

const BRUSH_R = 22;
const REVEAL_THRESHOLD = 0.75;
const GRID_RES = 40;

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

// --- Component ---

class ReplayPanel extends HTMLElement {
  #rngDays = [];       // [{day, finalWord}]
  #players = [];       // [address, ...]
  #tickets = [];       // [{address, ticketCount, totalMintedOnLevel}]
  #selectedDay = null;
  #selectedLevel = null;
  #selectedPlayer = null;
  #distributions = []; // jackpot distributions for selected day

  // Spin + scratch state
  #playerTraitIds = new Set();  // Set<number> of owned trait IDs
  #traitsCacheAddress = null;   // address for which #playerTraitIds was fetched
  #animId = 0;                  // spin cancellation token (increment to cancel running spin)
  #scratched = [false, false, false, false];  // per-quadrant scratch completion
  #scratchGrids = [null, null, null, null];   // per-quadrant Uint8Array scratch grids
  #quadOwned = [false, false, false, false];  // per-quadrant trait ownership after spin
  #quadWinArrays = [[], [], [], []];          // per-quadrant prize arrays
  #audioCtx = null;             // Web Audio context for SFX
  #scratchNode = null;          // active scratch noise node

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
            <span class="trait-label">?</span>
            <div class="replay-prize-reveal" data-pos="tl"></div>
            <canvas class="replay-scratch-canvas" data-pos="tl"></canvas>
          </div>
          <div class="replay-tq" data-pos="tr">
            <img class="badge-img" src="" alt="">
            <span class="trait-label">?</span>
            <div class="replay-prize-reveal" data-pos="tr"></div>
            <canvas class="replay-scratch-canvas" data-pos="tr"></canvas>
          </div>
          <div class="replay-tq" data-pos="bl">
            <img class="badge-img" src="" alt="">
            <span class="trait-label">?</span>
            <div class="replay-prize-reveal" data-pos="bl"></div>
            <canvas class="replay-scratch-canvas" data-pos="bl"></canvas>
          </div>
          <div class="replay-tq" data-pos="br">
            <img class="badge-img" src="" alt="">
            <span class="trait-label">?</span>
            <div class="replay-prize-reveal" data-pos="br"></div>
            <canvas class="replay-scratch-canvas" data-pos="br"></canvas>
          </div>
          <div class="replay-ticket-center"><img src="/whitepaper/flame-center.svg" alt=""></div>
        </div>

        <p class="replay-hint" data-bind="hint"></p>

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

    this.#loadDays();
  }

  disconnectedCallback() {
    this.#animId++;  // cancel any running spin
    this.#sfxScratchStop();
  }

  // --- Data Loading ---

  async #loadDays() {
    try {
      const data = await replayFetch('/rng');
      this.#rngDays = data.days;
      const select = this.querySelector('[data-bind="day-select"]');
      select.innerHTML = '<option value="">Pick a jackpot day</option>' +
        data.days.map(d => `<option value="${d.day}">Day ${d.day}</option>`).join('');
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

      const select = this.querySelector('[data-bind="player-select"]');
      select.innerHTML = '<option value="">All players (' + data.players.length + ')</option>' +
        data.players.map(p =>
          `<option value="${p.address}">${truncateAddress(p.address)} (${p.ticketCount} tickets)</option>`
        ).join('');

      // Also store as player list
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
      return;
    }

    this.#selectedDay = dayNum;
    this.#resetCards();

    const rngEntry = this.#rngDays.find(d => d.day === dayNum);
    const hasRng = rngEntry && rngEntry.finalWord && rngEntry.finalWord !== '0';

    this.querySelector('[data-bind="reveal-btn"]').disabled = !hasRng || !this.#selectedPlayer;
    this.querySelector('[data-bind="empty-state"]').hidden = true;

    // Load day detail + figure out level from distributions
    const detail = await this.#loadDayDetail(dayNum);
    if (detail && detail.distributions.length > 0) {
      this.#selectedLevel = detail.distributions[0].level;
      // Tickets are stored at purchaseLevel = gameLevel + 1
      await this.#loadTickets(this.#selectedLevel + 1);
      this.#showDistributions(detail.distributions);
    } else {
      // No distributions — load tickets for level 1 (purchase level for game level 0)
      this.#selectedLevel = 0;
      await this.#loadTickets(1);
      this.querySelector('[data-bind="distributions"]').hidden = true;
    }
  }

  #onPlayerChange(e) {
    const addr = e.target.value;
    this.#selectedPlayer = addr || null;
    this.#updateTicketInfo();
    this.#loadPlayerTraits();
    // Update reveal button state based on both day and player
    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    const hasRng = rngEntry && rngEntry.finalWord && rngEntry.finalWord !== '0';
    this.querySelector('[data-bind="reveal-btn"]').disabled = !hasRng || !this.#selectedPlayer;
  }

  #updateTicketInfo() {
    const infoEl = this.querySelector('[data-bind="ticket-info"]');
    const countEl = this.querySelector('[data-bind="ticket-count"]');
    const detailEl = this.querySelector('[data-bind="ticket-detail"]');

    if (!this.#selectedPlayer) {
      // Show aggregate
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

      // Highlight if this player won
      const won = this.#distributions.find(d => d.winner === this.#selectedPlayer);
      if (won) {
        countEl.textContent += ' — WINNER';
        countEl.classList.add('replay-winner-text');
      } else {
        countEl.classList.remove('replay-winner-text');
      }
    } else {
      infoEl.hidden = true;
    }
  }

  #showDistributions(distributions) {
    const container = this.querySelector('[data-bind="distributions"]');
    const list = this.querySelector('[data-bind="dist-list"]');

    if (!distributions.length) {
      container.hidden = true;
      return;
    }

    list.innerHTML = distributions.map(d => `
      <div class="replay-dist-item">
        <span class="replay-dist-winner">${truncateAddress(d.winner)}</span>
        <span class="replay-dist-amount">${formatEth(d.amount)} ETH</span>
        <span class="replay-dist-type">${d.distributionType}</span>
      </div>
    `).join('');

    container.hidden = false;
  }

  // --- Reveal / Spin ---

  async #triggerReveal() {
    if (!this.#selectedDay || !this.#selectedPlayer) return;

    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    if (!rngEntry || !rngEntry.finalWord || rngEntry.finalWord === '0') return;

    this.#resetCards();
    await this.#loadPlayerTraits(); // ensure traits loaded

    // Derive winning traits (same logic as before)
    let traits;
    const distTraitIds = this.#distributions
      .filter(d => d.traitId != null)
      .map(d => d.traitId);
    const uniqueTraits = [...new Set(distTraitIds)];
    if (uniqueTraits.length >= 4) {
      traits = uniqueTraits.slice(0, 4);
    } else {
      traits = deriveWinningTraits(rngEntry.finalWord);
    }

    // Map distributions to quadrants for prize data
    this.#distributePrizes();

    const displayTraits = toDisplayOrder(traits);

    const btn = this.querySelector('[data-bind="reveal-btn"]');
    btn.disabled = true;
    btn.textContent = 'Revealing...';

    await this.#runSpin(displayTraits);

    btn.disabled = false;
    btn.textContent = 'Replay';
  }

  #distributePrizes() {
    this.#quadWinArrays = [[], [], [], []];
    for (const dist of this.#distributions) {
      if (dist.traitId == null) continue;
      const contractQuadrant = Math.floor(dist.traitId / 64);
      // DISPLAY_ORDER[displayPos] = contractQuadrant, so indexOf gives displayPos
      const displayPos = DISPLAY_ORDER.indexOf(contractQuadrant);
      if (displayPos >= 0 && displayPos <= 3) {
        this.#quadWinArrays[displayPos].push(dist);
      }
    }
  }

  async #runSpin(displayTraits) {
    const myId = ++this.#animId;
    const quads = this.querySelectorAll('.replay-tq');
    const hint = this.querySelector('[data-bind="hint"]');

    // Determine ownership per display quadrant
    for (let i = 0; i < 4; i++) {
      this.#quadOwned[i] = displayTraits[i] != null && this.#playerTraitIds.has(displayTraits[i]);
    }

    // Reset state
    this.#scratched = [false, false, false, false];
    this.#scratchGrids = [null, null, null, null];
    this.#sfxScratchStop();

    // Start flame spinning animation
    const center = this.querySelector('.replay-ticket-center');
    if (center) center.classList.add('spinning');

    // Clear canvases and prizes
    if (hint) hint.textContent = '';
    this.#clearScatteredBadges();
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
        if (myId !== this.#animId) { resolve(); return; }

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

          // Background coloring based on ownership of currently-displayed trait
          const currentTraitId = contractQ * 64 + sym * 8 + col;
          quads[i].classList.remove('q-has-trait', 'q-no-tickets', 'q-scratchable', 'q-has-tickets');
          if (lockedSymbols[i] && lockedColors[i]) {
            // Fully locked -- show ownership state
            quads[i].classList.add(this.#quadOwned[i] ? 'q-has-trait' : 'q-no-tickets');
          } else {
            // Color or symbol still spinning -- color based on displayed badge ownership
            quads[i].classList.add(this.#playerTraitIds.has(currentTraitId) ? 'q-has-trait' : 'q-no-tickets');
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

          // Render final badges
          for (let i = 0; i < 4; i++) {
            const contractQ = DISPLAY_ORDER[i];
            const category = BADGE_QUADRANTS[contractQ];
            const path = badgeCircularPath(category, targets[i].sym, targets[i].col);
            const img = quads[i].querySelector('.badge-img');
            if (img) img.src = path;
          }

          this.#afterSpin(displayTraits, quads, hint);
          resolve();
          return;
        }

        const delay = 80 + Math.floor((locksDone / totalLocks) * 120);
        setTimeout(step, delay);
      };
      step();
    });
  }

  #afterSpin(displayTraits, quads, hint) {
    // Stop flame spinning
    const center = this.querySelector('.replay-ticket-center');
    if (center) center.classList.remove('spinning');

    let anyOwned = false;
    for (let i = 0; i < 4; i++) {
      quads[i].classList.remove('q-has-trait', 'q-no-tickets');
      if (this.#quadOwned[i]) {
        anyOwned = true;
        quads[i].classList.add('q-scratchable');
        // Init scratch canvas
        const canvas = quads[i].querySelector('.replay-scratch-canvas');
        const badgeSrc = quads[i].querySelector('.badge-img').src;
        this.#initScratchCanvas(canvas, badgeSrc);
        canvas.style.transition = 'none';
        canvas.style.opacity = '1';
        canvas.style.pointerEvents = 'auto';
        // Wire scratch events
        this.#wireCanvas(canvas, i);
        // Hide main badge, place scattered win badges
        const mainBadge = quads[i].querySelector('.badge-img');
        mainBadge.style.display = 'none';
        if (this.#quadWinArrays[i].length > 0) {
          this.#placeWinBadges(i, displayTraits[i]);
        }
      } else {
        this.#scratched[i] = true;
        quads[i].classList.add('q-no-tickets');
      }
    }

    if (anyOwned) {
      if (hint) hint.textContent = 'Scratch to find your winners!';
    } else {
      if (hint) hint.textContent = 'No matching tickets this round';
    }
  }

  #initScratchCanvas(canvas, badgeSrc) {
    const quad = canvas.parentElement;
    const rect = quad.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    const ctx = canvas.getContext('2d');
    // Draw blue cover with badge image
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
    const isWin = this.#quadWinArrays[qIdx].length > 0;
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
    // Show prize overlay
    if (prize && isWin) {
      const wins = this.#quadWinArrays[qIdx];
      const lines = wins.map(d => formatEth(d.amount) + ' ETH');
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
    const allDone = this.#scratched.every(s => s);
    if (allDone) {
      if (hint) hint.textContent = '';
      const anyWon = this.#quadWinArrays.some(w => w.length > 0);
      if (anyWon) this.#celebrate();
    } else {
      const remaining = this.#scratched.filter(s => !s).length;
      if (hint) hint.textContent = remaining + ' area' + (remaining !== 1 ? 's' : '') + ' left to scratch';
    }
  }

  #placeWinBadges(qIdx, traitId) {
    const quads = this.querySelectorAll('.replay-tq');
    const quad = quads[qIdx];
    const wins = this.#quadWinArrays[qIdx];
    if (!wins || wins.length === 0) return;
    // Use the winning badge for this quadrant
    const badge = traitToBadge(traitId);
    const path = badge ? badge.path : '';
    const count = wins.length;
    let maxSize, minSize;
    if (count === 1) { minSize = 30; maxSize = 65; }
    else if (count <= 3) { minSize = 25; maxSize = 50; }
    else { minSize = 20; maxSize = 40; }
    const placed = [];
    for (let w = 0; w < wins.length; w++) {
      let sizePct = minSize + (w / Math.max(1, wins.length - 1)) * (maxSize - minSize);
      if (wins.length === 1) sizePct = maxSize;
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
      const wrap = document.createElement('div');
      wrap.className = 'replay-badge-wrap';
      wrap.style.width = sizePct + '%';
      wrap.style.left = bestLeft + '%';
      wrap.style.top = bestTop + '%';
      const img = document.createElement('img');
      img.src = path; img.className = 'replay-scattered-badge'; img.alt = '';
      wrap.appendChild(img);
      quad.appendChild(wrap);
    }
  }

  #clearScatteredBadges() {
    const els = this.querySelectorAll('.replay-badge-wrap');
    for (const el of els) el.remove();
  }

  #resetCards() {
    this.#animId++; // cancel any running spin
    this.#sfxScratchStop();
    const quads = this.querySelectorAll('.replay-tq');
    quads.forEach(q => {
      q.classList.remove('revealed', 'q-has-trait', 'q-no-tickets', 'q-scratchable', 'q-has-tickets');
      const img = q.querySelector('.badge-img');
      if (img) { img.src = ''; img.alt = ''; img.style.opacity = '0'; img.style.display = ''; }
      const label = q.querySelector('.trait-label');
      if (label) label.textContent = '?';
      const canvas = q.querySelector('.replay-scratch-canvas');
      if (canvas) { canvas.style.opacity = '0'; canvas.style.pointerEvents = 'none'; }
      const prize = q.querySelector('.replay-prize-reveal');
      if (prize) { prize.classList.remove('visible'); prize.innerHTML = ''; }
    });
    this.#clearScatteredBadges();
    this.#scratched = [false, false, false, false];
    this.#scratchGrids = [null, null, null, null];
    this.#quadOwned = [false, false, false, false];
    this.#quadWinArrays = [[], [], [], []];
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

  // --- Web Audio SFX ---

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
