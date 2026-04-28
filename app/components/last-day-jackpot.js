// /app/components/last-day-jackpot.js — Phase 59 Plan 59-01 (JKP-03)
// Copy-and-adapt of /beta/components/jackpot-panel.js — historical-explorer paths
// STRIPPED (D-01); rewired to consume Phase 57 /game/jackpot/last-day composed blob.
// Plan 59-01: shell + 3-status branch rendering. Plan 59-02 wires data flow.
// Plan 59-03 adds localStorage idempotency + new-day banner + wallet-conditional highlight.
//
// Mount: <last-day-jackpot></last-day-jackpot> in /app/index.html (top-of-page hero per D-06).
// Cross-imports /beta/ verbatim per D-01 + Pattern 5 (zero /beta/ edits).

import { subscribe, get, getViewedAddress } from '../app/store.js';
import { formatEth } from '../../beta/viewer/utils.js';
import {
  joFormatWeiToEth,
  joScaledToTickets,
  joBadgePath,
  JO_CATEGORIES,
  JO_SYMBOLS,
  rebucketRoll2BySlot,
  createJackpotRolls,
} from '../../beta/app/jackpot-rolls.js';
import { CHAIN } from '../app/chain-config.js';
// STRIPPED per D-01: import fetchJSON (widget consumes via store subscription, not direct fetch)
// STRIPPED per D-03: import createScrubber (hidden scrubber)

class LastDayJackpot extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  // Pin-at-fetch (D-02): snapshot day from first payload; never mutated mid-render.
  #pinnedDay = null;
  #pinnedLevel = null;
  #lastPayload = null;        // most recent payload (may differ from pinned if newer day arrived)
  #hasNewDayAvailable = false; // Plan 59-03 banner trigger
  #winners = [];
  // Replay/Bonus Roll state machine (verbatim from /beta/ per D-03):
  // States: idle | roll1_playing | roll1_done | roll2_playing | roll2_done
  #replayState = 'idle';
  #replayData = null;          // {hasBonus, roll2, bonusTraitsPacked} — populated from polling payload in Plan 59-02
  #rolls = null;               // createJackpotRolls instance
  #replayCancelToken = 0;      // bumped on day change to cancel stale animations

  #showContent() {
    if (this.#loaded) return;
    this.#loaded = true;
    this.querySelector('[data-bind="skeleton"]')?.remove();
    const el = this.querySelector('[data-bind="content"]');
    if (el) el.style.display = '';
  }

  connectedCallback() {
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

          <!-- Cold-start (status:'pre-game' OR no payload) — JKP-03 first-class state -->
          <div data-bind="ldj-status-cold-start" class="ldj-cold-start">
            <p>Game starts soon, no jackpots yet.</p>
            <p class="ldj-subtle">When the first day completes, this is where the wins will appear.</p>
          </div>

          <!-- Empty-day (status:'resolved-no-winners') — JKP-03 first-class state -->
          <div data-bind="ldj-status-empty-day" class="ldj-empty-day" style="display:none;">
            <p data-bind="ldj-empty-copy">Day -- had no winners — pot rolled to day --.</p>
          </div>

          <!-- Resolved (status:'resolved') — winners + spin reveal -->
          <div data-bind="ldj-status-resolved" style="display:none;">
            <!-- New-day banner (Plan 59-03 — hidden by default) -->
            <div class="ldj-new-day-banner" data-bind="ldj-new-day-banner" hidden>
              <span data-bind="ldj-new-day-text"></span>
              <button class="ldj-view-now" data-bind="ldj-view-now" type="button">View now</button>
            </div>

            <!-- Winner summary (Plan 59-02 populates) -->
            <div class="jp-winner-summary" data-bind="jp-winner-summary" style="display:none;"></div>

            <!-- Replay / Bonus Roll section (D-03 verbatim from /beta/) -->
            <div class="jp-replay-section" data-bind="jp-replay-section">
              <div class="jp-replay-controls">
                <div class="jp-spin-flame" data-bind="jp-spin-flame" aria-hidden="true"></div>
                <button class="jp-replay-btn" id="jp-replay-btn" data-state="idle" disabled>Replay</button>
              </div>

              <!-- Roll 1 result grid -->
              <div class="jp-roll1-result" data-bind="jp-roll1-result" style="display:none;">
                <div class="jp-roll-heading">Roll 1 — current-level wins (ETH + tickets)</div>
                <div class="jo-grid jp-roll1-grid" data-bind="jp-roll1-grid">
                  <div class="jo-header">Type</div>
                  <div class="jo-header">Win</div>
                  <div class="jo-header">Uniq</div>
                  <div class="jo-header">Coin</div>
                  <div class="jo-header">Tkts</div>
                  <div class="jo-header">ETH</div>
                  <div class="jo-header">Spread</div>
                </div>
              </div>

              <!-- Roll 2 bonus-only slot grid -->
              <div class="jp-roll2-result" data-bind="jp-roll2-result" style="display:none;">
                <div class="jp-roll-heading jp-roll2-heading">Bonus Roll — bonus-card draws for this day</div>
                <div class="jp-roll2-slot-grid" data-bind="jp-roll2-slot-grid">
                  <div class="jp-slot-header">Symbol</div>
                  <div class="jp-slot-header">Wins</div>
                  <div class="jp-slot-header">Amount / win</div>
                </div>
              </div>
            </div>

            <!-- Winner groups (KEEP from /beta/ — Plan 59-02 populates) -->
            <div class="jp-winners">
              <div class="jp-winners-group" data-bind="jp-winners-group-normal" style="display:none;">
                <div class="jp-winners-label"><span data-bind="jp-winners-label-normal">Winners (Normal Jackpot)</span></div>
                <ul class="jp-winners-list" data-bind="jp-winners-list-normal" role="listbox" aria-label="Normal jackpot winners"></ul>
              </div>
              <div class="jp-winners-group" data-bind="jp-winners-group-baf" style="display:none;">
                <div class="jp-winners-label"><span data-bind="jp-winners-label-baf">BAF Winners</span></div>
                <ul class="jp-winners-list" data-bind="jp-winners-list-baf" role="listbox" aria-label="BAF winners"></ul>
              </div>
              <div class="jp-winners-group" data-bind="jp-winners-group-decimator" style="display:none;">
                <div class="jp-winners-label"><span data-bind="jp-winners-label-decimator">Decimator Winners</span></div>
                <ul class="jp-winners-list" data-bind="jp-winners-list-decimator" role="listbox" aria-label="Decimator winners"></ul>
              </div>
              <div class="jp-winners-group" data-bind="jp-winners-group-empty" style="display:none;">
                <ul class="jp-winners-list">
                  <li class="jp-winner-item jp-winner-item--empty" data-bind="jp-winners-empty">No data for this day</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // STRIPPED per D-03: createScrubber instantiation
    // STRIPPED per Q12: jp-overview toggle wiring (#renderOverview removed)

    // Plan 04 (rebuild — verbatim from /beta/): initialise rolls factory and wire Replay button.
    // Phase 59 reduced selectors (joGrid/joStatus/joFarFuture/jackpotOverview removed — DOM not present).
    this.#rolls = createJackpotRolls({
      root: this,
      apiBase: '',  // Phase 59 does NOT call factory's fetch methods (D-02 + RESEARCH Q1)
      selectors: {
        roll2Panel:      '[data-bind="jp-roll2-result"]',
        demoCenterFlame: '[data-bind="jp-spin-flame"]',
        demoWrap:        '[data-bind="jp-replay-section"]',
        // STRIPPED per Q12: joGrid, joStatus, joFarFuture, jackpotOverview (DOM removed)
      }
    });
    this.#unsubs.push(() => this.#rolls.dispose());

    const replayBtn = this.querySelector('#jp-replay-btn');
    if (replayBtn) {
      replayBtn.addEventListener('click', () => this.#onReplayClick());
    }

    // STRIPPED per Plan 59-01: subscribe('app.lastDay', ...) — Plan 59-02 will add data-flow wiring.
    // For Plan 59-01: dismiss skeleton immediately so the cold-start section is visible by default.
    this.#showContent();
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
  }

  // ---------------------------------------------------------------------------
  // STRIPPED per Q12 (overview): #renderOverview(level)
  // STRIPPED per Q12: #computeLatestCompletedDay(game)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Winner summary — brief per-type breakdown rendered above the winner dropdown.
  // KEEP verbatim from /beta/ — used by Plan 59-02 #renderResolvedDay.
  // ---------------------------------------------------------------------------
  #renderWinnerSummary(winners, day) {
    const summaryEl = this.querySelector('[data-bind="jp-winner-summary"]');
    if (!summaryEl) return;

    if (!winners || winners.length === 0) {
      summaryEl.style.display = 'none';
      summaryEl.innerHTML = '';
      return;
    }

    const ethWinners  = winners.filter(w => BigInt(w.totalEth  || '0') > 0n);
    const tickWinners = winners.filter(w => (w.ticketCount || 0) > 0);
    const coinWinners = winners.filter(w => BigInt(w.coinTotal || '0') > 0n);
    // BAF winners: rows with bafPrize.eth > 0 OR bafPrize.tickets > 0.
    const bafEthWinners    = winners.filter(w => w.bafPrize && BigInt(w.bafPrize.eth || '0') > 0n);
    const bafTicketWinners = winners.filter(w => w.bafPrize && (w.bafPrize.tickets || 0) > 0);

    const rows = [];

    if (ethWinners.length > 0) {
      const uniqueAddrs = new Set(ethWinners.map(w => w.address)).size;
      const amounts = ethWinners.map(w => BigInt(w.totalEth));
      const topAmt  = amounts.reduce((a, b) => (b > a ? b : a), 0n);
      const allSame = amounts.every(a => a === amounts[0]);
      const amtStr  = allSame
        ? formatEth(amounts[0].toString()) + ' ETH each'
        : formatEth(topAmt.toString()) + ' ETH (top)';
      rows.push({ label: 'ETH', count: ethWinners.length, unique: uniqueAddrs, amount: amtStr });
    }

    if (tickWinners.length > 0) {
      const uniqueAddrs = new Set(tickWinners.map(w => w.address)).size;
      const counts  = tickWinners.map(w => joScaledToTickets(w.ticketCount || 0));
      const topCount = Math.max(...counts);
      const allSame  = counts.every(c => c === counts[0]);
      const amtStr   = allSame ? `${counts[0]} tkts each` : `${topCount} tkts (top)`;
      rows.push({ label: 'Tickets', count: tickWinners.length, unique: uniqueAddrs, amount: amtStr });
    }

    if (coinWinners.length > 0) {
      const uniqueAddrs = new Set(coinWinners.map(w => w.address)).size;
      const amounts = coinWinners.map(w => BigInt(w.coinTotal));
      const topAmt  = amounts.reduce((a, b) => (b > a ? b : a), 0n);
      const allSame = amounts.every(a => a === amounts[0]);
      const amtStr  = allSame
        ? joFormatWeiToEth(amounts[0].toString()) + ' BURNIE each'
        : joFormatWeiToEth(topAmt.toString()) + ' BURNIE (top)';
      rows.push({ label: 'BURNIE', count: coinWinners.length, unique: uniqueAddrs, amount: amtStr });
    }

    if (bafEthWinners.length > 0) {
      const uniqueAddrs = new Set(bafEthWinners.map(w => w.address)).size;
      const amounts = bafEthWinners.map(w => BigInt(w.bafPrize.eth));
      const totalAmt = amounts.reduce((a, b) => a + b, 0n);
      const topAmt   = amounts.reduce((a, b) => (b > a ? b : a), 0n);
      const amtStr   = `${formatEth(totalAmt.toString())} ETH total · ${formatEth(topAmt.toString())} (top)`;
      rows.push({ label: 'BAF ETH', count: bafEthWinners.length, unique: uniqueAddrs, amount: amtStr });
    }

    if (bafTicketWinners.length > 0) {
      const uniqueAddrs = new Set(bafTicketWinners.map(w => w.address)).size;
      const totalTickets = bafTicketWinners.reduce(
        (sum, w) => sum + joScaledToTickets(w.bafPrize.tickets || 0), 0
      );
      const amtStr = `${totalTickets} tkts across ${bafTicketWinners.length} lootbox roll${bafTicketWinners.length === 1 ? '' : 's'}`;
      rows.push({ label: 'BAF Tickets', count: bafTicketWinners.length, unique: uniqueAddrs, amount: amtStr });
    }

    // Decimator — per-winner regularEth + lootboxEth (regular claim) and
    // terminalEth (game-over terminal claim).
    const decRegWinners = winners.filter(w =>
      w.decimatorPrize &&
      (BigInt(w.decimatorPrize.regularEth || '0') > 0n ||
       BigInt(w.decimatorPrize.lootboxEth || '0') > 0n));
    const decTermWinners = winners.filter(w =>
      w.decimatorPrize && BigInt(w.decimatorPrize.terminalEth || '0') > 0n);

    if (decRegWinners.length > 0) {
      const uniqueAddrs = new Set(decRegWinners.map(w => w.address)).size;
      const totalEth = decRegWinners.reduce((acc, w) =>
        acc + BigInt(w.decimatorPrize.regularEth || '0') + BigInt(w.decimatorPrize.lootboxEth || '0'), 0n);
      const amtStr = `${formatEth(totalEth.toString())} ETH total`;
      rows.push({ label: 'Decimator', count: decRegWinners.length, unique: uniqueAddrs, amount: amtStr });
    }

    if (decTermWinners.length > 0) {
      const uniqueAddrs = new Set(decTermWinners.map(w => w.address)).size;
      const totalEth = decTermWinners.reduce((acc, w) =>
        acc + BigInt(w.decimatorPrize.terminalEth || '0'), 0n);
      const amtStr = `${formatEth(totalEth.toString())} ETH total`;
      rows.push({ label: 'Dec. Terminal', count: decTermWinners.length, unique: uniqueAddrs, amount: amtStr });
    }

    if (rows.length > 0) {
      summaryEl.innerHTML = this.#buildSummaryHtml(rows, day);
      summaryEl.style.display = '';
    } else {
      summaryEl.innerHTML = `<div class="jp-summary-note">${winners.length} winner${winners.length !== 1 ? 's' : ''} this day</div>`;
      summaryEl.style.display = '';
    }
  }

  #buildSummaryHtml(rows, day) {
    if (!rows.length) return '';
    const rowHtml = rows.map(r =>
      `<div class="jp-summary-row">
        <span class="jp-summary-type">${r.label}</span>
        <span class="jp-summary-count">${r.count} <span class="jp-summary-uniq">(${r.unique})</span></span>
        <span class="jp-summary-amount">${r.amount}</span>
      </div>`
    ).join('');
    return `<div class="jp-summary-header">Day ${day} Jackpot</div>${rowHtml}`;
  }

  // ---------------------------------------------------------------------------
  // STRIPPED per Plan 59-01: #onDayChange(day) — Plan 59-02 adds #renderResolvedDay
  // (extracted from this method's classification + per-category list-render code).
  // ---------------------------------------------------------------------------

  // Format breakdown array into tooltip HTML lines, partitioned by roll phase.
  // KEEP verbatim from /beta/ — used by Plan 59-02 winner row tooltips.
  #formatBreakdownTooltip(breakdown) {
    const rowLabel = (b) => {
      const { awardType, amount, count } = b;
      let label;
      if (awardType === 'eth') {
        label = joFormatWeiToEth(amount) + ' ETH';
      } else if (awardType === 'eth_baf') {
        label = joFormatWeiToEth(amount) + ' ETH (BAF)';
      } else if (awardType === 'tickets') {
        const n = joScaledToTickets(amount);
        label = n + ' ticket' + (n !== 1 ? 's' : '');
      } else if (awardType === 'tickets_baf') {
        const n = joScaledToTickets(amount);
        label = n + ' ticket' + (n !== 1 ? 's' : '') + ' (BAF)';
      } else if (awardType.includes('burnie') || awardType === 'farFutureCoin') {
        label = joFormatWeiToEth(amount) + ' BURNIE';
      } else if (awardType === 'whale_pass') {
        label = (count > 1 || Number(amount) > 1) ? (amount + ' Whale Passes') : 'Whale Pass';
      } else if (awardType === 'dgnrs') {
        label = joFormatWeiToEth(amount) + ' DGNRS';
      } else {
        label = amount + ' ' + awardType;
      }
      return `<span>×${count} ${label}</span>`;
    };

    const roll1 = breakdown.filter(b => (b.phase || 'roll1') === 'roll1');
    const roll2 = breakdown.filter(b => b.phase === 'roll2');
    const other = breakdown.filter(b => b.phase === 'other');

    const parts = [];
    if (roll1.length > 0) {
      parts.push('<div class="jp-tip-phase">Roll 1 — Main Draw</div>' + roll1.map(rowLabel).join(''));
    }
    if (roll2.length > 0) {
      parts.push('<div class="jp-tip-phase">Roll 2 — Bonus Draw</div>' + roll2.map(rowLabel).join(''));
    }
    if (other.length > 0) {
      parts.push('<div class="jp-tip-phase">Other</div>' + other.map(rowLabel).join(''));
    }
    return parts.join('');
  }

  // ---------------------------------------------------------------------------
  // STRIPPED per Plan 59-01: #onWinnerItemClick(li) and #onWinnerChange(address)
  // — no winner-pick UI in Phase 59 (D-05 wallet-conditional highlight only).
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Plan 04 (verbatim from /beta/): Replay / Bonus Roll state machine
  // Phase 59 adaptation: enable-condition uses #pinnedDay (no winner-pick UI).
  // ---------------------------------------------------------------------------

  #setReplayState(state) {
    this.#replayState = state;
    const btn = this.querySelector('#jp-replay-btn');
    const roll1El = this.querySelector('[data-bind="jp-roll1-result"]');
    const roll2El = this.querySelector('[data-bind="jp-roll2-result"]');
    const spinEl  = this.querySelector('[data-bind="jp-spin-flame"]');

    if (!btn) return;
    btn.dataset.state = state;

    switch (state) {
      case 'idle':
        btn.textContent = 'Replay';
        // Phase 59: enabled whenever a resolved day is pinned (no winner-pick UI).
        btn.disabled = !this.#pinnedDay;
        // Clear grids on reset to idle
        if (roll1El) { roll1El.style.display = 'none'; this.#clearGrid('[data-bind="jp-roll1-grid"]'); }
        if (roll2El) {
          roll2El.style.display = 'none';
          const slotGrid = this.querySelector('[data-bind="jp-roll2-slot-grid"]');
          if (slotGrid) {
            Array.from(slotGrid.children).forEach(c => {
              if (!c.classList.contains('jp-slot-header')) slotGrid.removeChild(c);
            });
          }
        }
        if (spinEl) spinEl.classList.remove('jp-spinning');
        break;
      case 'roll1_playing':
        btn.textContent = 'Rolling…';
        btn.disabled = true;
        if (roll1El) { roll1El.style.display = ''; }
        if (roll2El) { roll2El.style.display = 'none'; }
        break;
      case 'roll1_done':
        // Button label depends on hasBonus
        if (this.#replayData?.hasBonus) {
          btn.textContent = 'Bonus Roll';
          btn.disabled = false;
        } else {
          // Flash "No bonus" for 500ms then reset to "Replay"
          btn.textContent = 'No bonus';
          btn.disabled = true;
          setTimeout(() => {
            if (this.#replayState === 'roll1_done') {
              this.#setReplayState('idle');
            }
          }, 500);
        }
        if (spinEl) spinEl.classList.remove('jp-spinning');
        break;
      case 'roll2_playing':
        btn.textContent = 'Rolling…';
        btn.disabled = true;
        if (roll2El) { roll2El.style.display = ''; }
        break;
      case 'roll2_done':
        btn.textContent = 'Replay';
        btn.disabled = false;
        if (spinEl) spinEl.classList.remove('jp-spinning');
        // Plan 59-03 will add: localStorage.setItem(`spun_day_${CHAIN.id}_${this.#pinnedDay}`, '1');
        break;
    }
  }

  // STRIPPED per Plan 59-01: _selectedAddress() — no winner-pick UI in Phase 59.

  // Helper: clear non-header rows from a grid. KEEP verbatim from /beta/.
  #clearGrid(selector) {
    const grid = this.querySelector(selector);
    if (!grid) return;
    Array.from(grid.children).forEach(child => {
      if (!child.classList.contains('jo-header')) grid.removeChild(child);
    });
  }

  // Helper: append a staggered-reveal row into a grid. KEEP verbatim from /beta/
  // — used by Plan 59-02 Roll 1 animation choreography.
  #appendRevealRow(grid, row, idx) {
    const { joBadgePath: badgePath, JO_CATEGORIES: cats, JO_SYMBOLS: syms, joFormatWeiToEth: fmtWei } = this._rollsHelpers || {};
    if (!fmtWei) return; // helpers not ready yet

    const isBonus = row.type === 'bonus';
    const typeCell = document.createElement('div');
    typeCell.className = 'jo-type-badge' + (isBonus ? ' jo-bonus' : '');
    if (isBonus) {
      typeCell.textContent = 'Bonus';
    } else {
      const t = row.traitId | 0;
      const q = Math.floor(t / 64);
      const sym = Math.floor((t % 64) / 8);
      const col = t % 8;
      const img = document.createElement('img');
      img.src = badgePath(q, sym, col);
      img.alt = syms[cats[q]]?.[sym] ?? '';
      typeCell.appendChild(img);
    }

    const winCell = document.createElement('div'); winCell.className = 'jo-winners'; winCell.textContent = String(row.winnerCount ?? '');
    const uniqCell = document.createElement('div'); uniqCell.className = 'jo-unique'; uniqCell.textContent = String(row.uniqueWinnerCount ?? '');
    const coinCell = document.createElement('div'); coinCell.className = 'jo-coin'; coinCell.textContent = (!row.coinPerWinner || row.coinPerWinner === '0') ? '—' : fmtWei(row.coinPerWinner);
    const tktCell  = document.createElement('div'); tktCell.className = 'jo-tickets'; tktCell.textContent = row.ticketsPerWinner ? String(joScaledToTickets(row.ticketsPerWinner)) : '—';
    const ethCell  = document.createElement('div'); ethCell.className = 'jo-eth'; ethCell.textContent = (!row.ethPerWinner || row.ethPerWinner === '0') ? '—' : fmtWei(row.ethPerWinner);
    const spreadCell = document.createElement('div'); spreadCell.className = 'jo-spread';
    const buckets = Array.isArray(row.spreadBuckets) ? row.spreadBuckets : [false, false, false];
    for (let b = 0; b < 3; b++) {
      const bar = document.createElement('div');
      bar.className = 'jo-spread-bar' + (buckets[b] ? ' active' : '');
      spreadCell.appendChild(bar);
    }

    const delay = idx * 80;
    const rowEl = document.createElement('div');
    rowEl.className = 'jo-row';
    rowEl.append(typeCell, winCell, uniqCell, coinCell, tktCell, ethCell, spreadCell);
    // jo-row uses display:contents — animate each cell directly
    Array.from(rowEl.children).forEach(cell => {
      cell.classList.add('jp-row-reveal');
      cell.style.animationDelay = delay + 'ms';
    });
    grid.appendChild(rowEl);
    return rowEl;
  }

  // KEEP /beta/ shape — Plan 59-02 will adapt to consume payload.roll1.wins[]
  // instead of calling factory's runRoll1 (which fetches). For Plan 59-01, the
  // click handler is wired but won't fire (button stays disabled — #pinnedDay null).
  async #onReplayClick() {
    const btn = this.querySelector('#jp-replay-btn');
    if (!btn || btn.disabled) return;

    const state = this.#replayState;

    if (state === 'idle' || state === 'roll2_done') {
      // Plan 59-02 will replace this with payload-driven rendering (no factory fetch).
      // For Plan 59-01: factory still wired but apiBase='' so no fetch occurs.
      const level = this.#pinnedLevel;
      const day   = this.#pinnedDay;
      if (!day) return;

      const cancelToken = ++this.#replayCancelToken;
      this.#replayData = null;
      this.#setReplayState('roll1_playing');

      // Ensure helpers are cached for row rendering
      if (!this._rollsHelpers) {
        this._rollsHelpers = { joBadgePath, JO_CATEGORIES, JO_SYMBOLS, joFormatWeiToEth };
      }

      const spinEl = this.querySelector('[data-bind="jp-spin-flame"]');
      if (spinEl) spinEl.classList.add('jp-spinning');

      // Plan 59-02 will call this.#animateRoll1FromPayload(this.#lastPayload) here.
      // For Plan 59-01: leave the factory call shape but it's unreachable (button disabled).
      const data = await this.#rolls.runRoll1({
        level, day, addr: '0x0000000000000000000000000000000000000000',
        roll1Grid: this.querySelector('[data-bind="jp-roll1-grid"]'),
        spinEl,
      });

      if (this.#replayCancelToken !== cancelToken) return; // superseded

      this.#replayData = data;
      this.#setReplayState('roll1_done');
      return;
    }

    if (state === 'roll1_done' && this.#replayData?.hasBonus) {
      // Start Roll 2
      const cancelToken = this.#replayCancelToken;
      this.#setReplayState('roll2_playing');

      const spinEl = this.querySelector('[data-bind="jp-spin-flame"]');
      if (spinEl) spinEl.classList.add('jp-spinning');

      // Render Roll 2 rows into our grids with stagger animation
      await this.#runRoll2Anim(cancelToken);

      if (this.#replayCancelToken !== cancelToken) return;
      this.#setReplayState('roll2_done');
    }
  }

  // KEEP verbatim from /beta/ — Roll 2 staggered slot grid render.
  async #runRoll2Anim(cancelToken) {
    const data = this.#replayData;
    if (!data) return;
    const spinEl = this.querySelector('[data-bind="jp-spin-flame"]');

    // 900ms spin
    await new Promise(resolve => setTimeout(resolve, 900));
    if (this.#replayCancelToken !== cancelToken) return;
    if (spinEl) spinEl.classList.remove('jp-spinning');

    // Re-bucket by bonus-card symbol slot (4 bonus + 1 far-future)
    const slots = rebucketRoll2BySlot(
      data.roll2 || {},
      data.bonusTraitsPacked ?? null,
    );

    const grid = this.querySelector('[data-bind="jp-roll2-slot-grid"]');
    if (!grid) return;
    // Clear non-header children
    Array.from(grid.children).forEach(c => {
      if (!c.classList.contains('jp-slot-header')) grid.removeChild(c);
    });

    slots.forEach((slot, idx) => {
      const sym = document.createElement('div');
      sym.className = 'jp-slot-symbol'
        + (slot.isEmpty ? ' jp-slot-empty' : '')
        + (slot.isFarFuture ? ' jp-slot-farfuture' : '');
      if (slot.isFarFuture) {
        sym.textContent = 'Far-Future (BURNIE)';
      } else if (slot.traitId == null) {
        sym.textContent = '—';
      } else {
        const img = document.createElement('img');
        img.src = joBadgePath(slot.quadrant, slot.symbolIdx, slot.colorIdx);
        img.alt = JO_SYMBOLS[JO_CATEGORIES[slot.quadrant]]?.[slot.symbolIdx] ?? '';
        sym.appendChild(img);
      }

      const wins = document.createElement('div');
      wins.className = 'jp-slot-wins' + (slot.isEmpty ? ' jp-slot-empty' : '');
      wins.textContent = String(slot.wins);

      const amt = document.createElement('div');
      amt.className = 'jp-slot-amount' + (slot.isEmpty ? ' jp-slot-empty' : '');
      if (slot.isEmpty) {
        amt.textContent = '—';
      } else {
        const a = slot.amountPerWin;
        amt.textContent = (a && a.length > 10) ? joFormatWeiToEth(a) : String(a);
      }

      [sym, wins, amt].forEach(cell => {
        cell.classList.add('jp-row-reveal');
        cell.style.animationDelay = (idx * 60) + 'ms';
        grid.appendChild(cell);
      });

      // Ticket sub-row under bonus slot (never under far-future).
      if (slot.ticketSubRow && slot.ticketSubRow.wins > 0 && !slot.isFarFuture) {
        const subCell = document.createElement('div');
        subCell.className = 'jp-ticket-subrow';

        const badge = document.createElement('span');
        badge.className = 'jp-ticket-subrow-badge';
        if (slot.traitId != null) {
          const bImg = document.createElement('img');
          bImg.src = joBadgePath(slot.quadrant, slot.symbolIdx, slot.colorIdx);
          bImg.alt = JO_SYMBOLS[JO_CATEGORIES[slot.quadrant]]?.[slot.symbolIdx] ?? '';
          badge.appendChild(bImg);
        }

        const label = document.createElement('span');
        label.className = 'jp-ticket-subrow-label';
        label.textContent = '↳ Tickets won: ' + slot.ticketSubRow.wins;

        subCell.appendChild(badge);
        subCell.appendChild(label);
        subCell.classList.add('jp-row-reveal');
        subCell.style.animationDelay = ((idx * 60) + 30) + 'ms';
        grid.appendChild(subCell);
      }
    });

    // Wait for animations (9 rows * 60ms stagger + ~300ms anim duration)
    await new Promise(resolve => setTimeout(resolve, slots.length * 60 + 400));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  #bind(key, value) {
    const el = this.querySelector(`[data-bind="${key}"]`);
    if (el) el.textContent = value;
  }

  // STRIPPED per Plan 59-01: #onGameUpdate(game) — Plan 59-02 adds #onLastDayUpdate(payload) replacement.
}

// Idempotency-guarded register (Phase 58 pattern — player-dropdown.js:178-182).
// Required for node:test compatibility (re-import does not throw).
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('last-day-jackpot')) {
    customElements.define('last-day-jackpot', LastDayJackpot);
  }
}
