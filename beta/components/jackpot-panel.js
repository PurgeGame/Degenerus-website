// components/jackpot-panel.js -- Jackpot panel Custom Element
// Animated sequential trait reveal, pool/day/allocation display, badge visualization, confetti celebration.
// All data transformation delegated to jackpot-data.js.
// Plan 03: day scrubber (shared with viewer.html) + winners dropdown above existing 4-card reveal.
// Plan 04 Roll 1/2 flow removed — kept: scrubber, winners dropdown, summary, Day Overview, live reveal.

import { subscribe, get } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { deriveWinningTraits, traitToBadge, estimateAllocation } from '../app/jackpot-data.js';
import { formatEth } from '../app/utils.js';
import { playSound } from '../app/audio.js';
import { createScrubber } from '../viewer/scrubber.js';
import { joFormatWeiToEth, createJackpotRolls } from '../app/jackpot-rolls.js';
import { API_BASE } from '../app/constants.js';

class JackpotPanel extends HTMLElement {
  #unsubs = [];
  #revealPlayed = false;
  #currentRngWord = null;
  #timeline = null;
  #loaded = false;

  // Plan 03: scrubber + winners dropdown
  #scrubber = null;
  #winnersRequestVersion = 0;
  #currentDay = null;
  #currentLevel = null;
  #winners = [];

  // Track whether the overview has been rendered at least once (for lazy first-open render)
  #overviewRendered = false;

  // Plan 04 (rebuild): Replay/Bonus Roll state machine
  // States: idle | roll1_playing | roll1_done | roll2_playing | roll2_done
  #replayState = 'idle';
  #replayData = null;   // last runRoll1 result (holds .hasBonus + .roll2)
  #rolls = null;        // createJackpotRolls instance
  #replayCancelToken = 0; // bumped on day/winner change to cancel stale animations

  #showContent() {
    if (this.#loaded) return;
    this.#loaded = true;
    this.querySelector('[data-bind="skeleton"]')?.remove();
    const el = this.querySelector('[data-bind="content"]');
    if (el) el.style.display = '';
  }

  connectedCallback() {
    // Build 4 trait cards programmatically
    const cards = [0, 1, 2, 3].map(q => `
      <div class="trait-card" data-quadrant="${q}">
        <div class="trait-card-inner">
          <div class="trait-card-front"><span class="trait-q-label">?</span></div>
          <div class="trait-card-back"><img class="badge-img" src="" alt=""><span class="trait-name"></span></div>
        </div>
      </div>
    `).join('');

    this.innerHTML = `
      <div data-bind="skeleton" class="panel jackpot-panel">
        <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
        <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:50%"></div><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem"><div class="skeleton-block skeleton-shimmer" style="height:80px"></div><div class="skeleton-block skeleton-shimmer" style="height:80px"></div><div class="skeleton-block skeleton-shimmer" style="height:80px"></div><div class="skeleton-block skeleton-shimmer" style="height:80px"></div></div>
      </div>
      <div data-bind="content" style="display:none">
      <div class="panel jackpot-panel">
        <div class="panel-header">
          <h2>JACKPOT DRAW</h2>
          <span class="jackpot-day" data-bind="day">Day --</span>
        </div>

        <!-- Historical jackpot explorer (Plan 03) -->
        <h3 class="jp-section-title">Historical jackpot explorer</h3>
        <div class="jp-day-port" data-bind="jp-day-port">
          <div class="jp-day-scrubber" data-bind="jp-day-scrubber"></div>
          <!-- Winner summary: rendered by #renderWinnerSummary on day change -->
          <div class="jp-winner-summary" data-bind="jp-winner-summary" style="display:none;"></div>

          <div class="jp-winners">
            <label class="jp-winners-label">Winner</label>
            <select class="jp-winners-select" data-bind="jp-winners-select"></select>
          </div>

          <!-- Day Overview — collapsed by default (D-12) -->
          <details class="jp-overview" data-bind="jp-overview">
            <summary>Day Overview</summary>
            <div class="jp-overview-body" data-bind="jp-overview-body">
              <div class="jo-grid" id="jp-jo-grid">
                <div class="jo-header">Type</div>
                <div class="jo-header">Win</div>
                <div class="jo-header">Uniq</div>
                <div class="jo-header">Coin</div>
                <div class="jo-header">Tkts</div>
                <div class="jo-header">ETH</div>
                <div class="jo-header">Spread</div>
              </div>
              <div id="jp-jo-status" class="jo-loading" style="display:none;"></div>
              <div id="jp-jo-far-future" class="jo-far-future-note" style="display:none;">Far-future coin resolved — see center flame above.</div>
            </div>
          </details>

          <!-- Replay / Bonus Roll section (Plan 04 rebuild) -->
          <div class="jp-replay-section" data-bind="jp-replay-section">
            <div class="jp-replay-controls">
              <div class="jp-spin-flame" data-bind="jp-spin-flame" aria-hidden="true"></div>
              <button class="jp-replay-btn" id="jp-replay-btn" data-state="idle" disabled>Replay</button>
            </div>

            <!-- Roll 1 result grid -->
            <div class="jp-roll1-result" data-bind="jp-roll1-result" style="display:none;">
              <div class="jp-roll-heading">Roll 1 — current-level ticket wins</div>
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

            <!-- Roll 2 result grid -->
            <div class="jp-roll2-result" data-bind="jp-roll2-result" style="display:none;">
              <div class="jp-roll-heading jp-roll2-heading">Bonus Roll — future-level wins</div>
              <div class="jo-grid jp-roll2-future-grid" data-bind="jp-roll2-future-grid">
                <div class="jo-header">Type</div>
                <div class="jo-header">Win</div>
                <div class="jo-header">Uniq</div>
                <div class="jo-header">Coin</div>
                <div class="jo-header">Tkts</div>
                <div class="jo-header">ETH</div>
                <div class="jo-header">Spread</div>
              </div>
              <div class="jp-roll2-farfuture" data-bind="jp-roll2-farfuture" style="display:none;">
                <div class="jp-roll-subheading">Far-Future (BURNIE)</div>
                <div class="jo-grid jp-roll2-far-grid" data-bind="jp-roll2-far-grid">
                  <div class="jo-header">Type</div>
                  <div class="jo-header">Win</div>
                  <div class="jo-header">Uniq</div>
                  <div class="jo-header">Coin</div>
                  <div class="jo-header">Tkts</div>
                  <div class="jo-header">ETH</div>
                  <div class="jo-header">Spread</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Live reveal section (existing 4-card flow, user addendum A6 + O-04) -->
        <h3 class="jp-section-title">Live reveal</h3>
        <div class="jackpot-stats">
          <div class="stat">
            <div class="stat-label">Prize Pool</div>
            <div class="stat-value" data-bind="pool">--</div>
          </div>
          <div class="stat">
            <div class="stat-label">Today's Allocation</div>
            <div class="stat-value" data-bind="allocation">--</div>
          </div>
        </div>
        <div class="jackpot-grid">${cards}</div>
        <div class="jackpot-result" data-bind="result" hidden>
          <span class="jackpot-result-text"></span>
          <span class="jackpot-prize-amount"></span>
        </div>
        <details class="jackpot-winners-dropdown" data-bind="winners-dropdown" hidden>
          <summary>Winner Breakdown</summary>
          <div class="jackpot-winners-list" data-bind="winners-list"></div>
        </details>
      </div>
      </div>
    `;

    // Preload GSAP when panel mounts (avoids jank on first reveal)
    import('gsap').catch(() => {});

    // Plan 03: instantiate scrubber inside the jp-day-scrubber container
    this.#scrubber = createScrubber({
      root: this.querySelector('[data-bind="jp-day-scrubber"]'),
      idPrefix: 'jp-day',
      minDay: 1,
      maxDay: 1,  // updated in #onGameUpdate once we know the latest completed day
      initialDay: 1,
      onDayChange: (day) => this.#onDayChange(day),
    });
    this.#unsubs.push(() => this.#scrubber.dispose());

    // Wire the jp-overview toggle for lazy first-render (D-12)
    const overviewDetails = this.querySelector('[data-bind="jp-overview"]');
    if (overviewDetails) {
      overviewDetails.addEventListener('toggle', () => {
        if (overviewDetails.open && !this.#overviewRendered && this.#currentLevel) {
          this.#overviewRendered = true;
          this.#renderOverview(this.#currentLevel);
        }
      });
    }

    // Plan 03: wire winners select change handler
    const selectEl = this.querySelector('[data-bind="jp-winners-select"]');
    if (selectEl) {
      selectEl.addEventListener('change', (e) => this.#onWinnerChange(e.target.value));
    }

    // Plan 04 (rebuild): initialise rolls factory and wire Replay button
    this.#rolls = createJackpotRolls({
      root: this,
      apiBase: '/beta/api',
      selectors: {
        roll2Panel:      '[data-bind="jp-roll2-result"]',
        roll2FutureGrid: '[data-bind="jp-roll2-future-grid"]',
        roll2FarGrid:    '[data-bind="jp-roll2-far-grid"]',
        roll2FutureEmpty:'[data-bind="jp-roll2-future-empty"]',
        roll2FarEmpty:   '[data-bind="jp-roll2-far-empty"]',
        roll2FutureBlock:'[data-bind="jp-roll2-future-grid"]',
        roll2FarBlock:   '[data-bind="jp-roll2-farfuture"]',
        joGrid:          '#jp-jo-grid',
        joStatus:        '#jp-jo-status',
        joFarFuture:     '#jp-jo-far-future',
        demoCenterFlame: '[data-bind="jp-spin-flame"]',
        demoWrap:        '[data-bind="jp-replay-section"]',
        jackpotOverview: '[data-bind="jp-overview"]',
      }
    });
    this.#unsubs.push(() => this.#rolls.dispose());

    const replayBtn = this.querySelector('#jp-replay-btn');
    if (replayBtn) {
      replayBtn.addEventListener('click', () => this.#onReplayClick());
    }

    // Subscribe to game state
    this.#unsubs.push(
      subscribe('game', (game) => this.#onGameUpdate(game))
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
    if (this.#timeline) {
      this.#timeline.kill();
      this.#timeline = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Day Overview renderer — fetches /game/jackpot/:level/overview and populates
  // the jo-grid inside the <details> block.
  // ---------------------------------------------------------------------------
  async #renderOverview(level) {
    const grid = this.querySelector('#jp-jo-grid');
    const statusEl = this.querySelector('#jp-jo-status');
    const farFutureEl = this.querySelector('#jp-jo-far-future');
    if (!grid) return;

    // Clear previous data rows (keep .jo-header children)
    Array.from(grid.children).forEach(child => {
      if (!child.classList.contains('jo-header')) grid.removeChild(child);
    });
    if (statusEl) { statusEl.textContent = 'Loading\u2026'; statusEl.style.display = ''; }
    if (farFutureEl) farFutureEl.style.display = 'none';

    let overview;
    try {
      overview = await fetchJSON(`/game/jackpot/${level}/overview`);
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Overview unavailable.'; statusEl.style.display = ''; }
      return;
    }

    if (statusEl) statusEl.style.display = 'none';

    const rows = overview.rows || overview.distributions || [];
    if (rows.length === 0) {
      if (statusEl) { statusEl.textContent = 'No overview data for this level.'; statusEl.style.display = ''; }
      return;
    }

    // Dynamic import so the badge path helper stays in jackpot-rolls.js
    let joBadgePath, JO_CATEGORIES, JO_SYMBOLS;
    try {
      ({ joBadgePath, JO_CATEGORIES, JO_SYMBOLS } = await import('../app/jackpot-rolls.js'));
    } catch {
      if (statusEl) { statusEl.textContent = 'Failed to load overview renderer.'; statusEl.style.display = ''; }
      return;
    }

    for (const row of rows) {
      const isBonus = row.type === 'bonus';

      const typeCell = document.createElement('div');
      typeCell.className = 'jo-type-badge' + (isBonus ? ' jo-bonus' : '');
      if (isBonus) {
        typeCell.textContent = 'Bonus';
      } else {
        const t = row.traitId | 0;
        const q = Math.floor(t / 64);
        const sym = Math.floor((t % 64) / 8);
        const img = document.createElement('img');
        img.src = joBadgePath(q, sym, t % 8);
        img.alt = JO_SYMBOLS[JO_CATEGORIES[q]]?.[sym] ?? '';
        typeCell.appendChild(img);
      }

      const winCell = document.createElement('div');
      winCell.className = 'jo-winners';
      winCell.textContent = String(row.winnerCount ?? row.winners ?? '');

      const uniqCell = document.createElement('div');
      uniqCell.className = 'jo-unique';
      uniqCell.textContent = String(row.uniqueWinnerCount ?? row.unique ?? '');

      const coinCell = document.createElement('div');
      coinCell.className = 'jo-coin';
      coinCell.textContent = (!row.coinPerWinner || row.coinPerWinner === '0') ? '\u2014' : joFormatWeiToEth(row.coinPerWinner);

      const tktCell = document.createElement('div');
      tktCell.className = 'jo-tickets';
      tktCell.textContent = row.ticketsPerWinner ? String(row.ticketsPerWinner) : '\u2014';

      const ethCell = document.createElement('div');
      ethCell.className = 'jo-eth';
      ethCell.textContent = (!row.ethPerWinner || row.ethPerWinner === '0') ? '\u2014' : joFormatWeiToEth(row.ethPerWinner);

      const spreadCell = document.createElement('div');
      spreadCell.className = 'jo-spread';
      const buckets = Array.isArray(row.spreadBuckets) ? row.spreadBuckets : [false, false, false];
      for (let b = 0; b < 3; b++) {
        const bar = document.createElement('div');
        bar.className = 'jo-spread-bar' + (buckets[b] ? ' active' : '');
        spreadCell.appendChild(bar);
      }

      const rowEl = document.createElement('div');
      rowEl.className = 'jo-row';
      rowEl.append(typeCell, winCell, uniqCell, coinCell, tktCell, ethCell, spreadCell);
      grid.appendChild(rowEl);
    }

    if (overview.hasFarFuture && farFutureEl) farFutureEl.style.display = '';
  }

  // ---------------------------------------------------------------------------
  // Plan 03: scrubber + winners dropdown methods
  // ---------------------------------------------------------------------------

  // Compute the latest completed jackpot day for a given game state.
  #computeLatestCompletedDay(game) {
    const level = game.level || 0;
    if (level === 0) return 1;
    const jackpotCounter = game.jackpotDay || 0;
    if (game.phase === 'JACKPOT') {
      const completed = (level - 1) * 5 + (jackpotCounter - 1);
      return Math.max(1, completed);
    }
    return level * 5;
  }

  // ---------------------------------------------------------------------------
  // Winner summary — brief per-type breakdown rendered above the winner dropdown.
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
      const counts  = tickWinners.map(w => w.ticketCount || 0);
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

  // Called when the scrubber day changes — fetches winners and populates the dropdown.
  async #onDayChange(day) {
    // Changing day resets the replay flow (Pitfall 6 guard)
    this.#replayCancelToken++;
    this.#replayData = null;
    this.#rolls?.cancelPendingFlashes();
    this.#setReplayState('idle');

    this.#winnersRequestVersion++;
    const v = this.#winnersRequestVersion;

    const selectEl = this.querySelector('[data-bind="jp-winners-select"]');
    if (selectEl) {
      selectEl.disabled = true;
      selectEl.innerHTML = '<option disabled>Loading…</option>';
    }

    let res;
    try {
      res = await fetchJSON(`/game/jackpot/day/${day}/winners`);
    } catch (err) {
      if (v !== this.#winnersRequestVersion) return;
      // Fall back: derive level from day
      const derivedLevel = Math.ceil(day / 5);
      let overviewLevel = derivedLevel;
      try {
        const ov = await fetchJSON(`/game/jackpot/${derivedLevel}/overview`);
        if (ov && ov.level) overviewLevel = ov.level;
      } catch { /* ignore */ }
      if (v !== this.#winnersRequestVersion) return;
      this.#currentDay = day;
      this.#currentLevel = overviewLevel;
      this.#winners = [];
      if (selectEl) {
        selectEl.disabled = true;
        selectEl.innerHTML = '<option disabled selected>Winners unavailable — API updating</option>';
      }
      if (overviewLevel) {
        this.#overviewRendered = false;
        const overviewDetails = this.querySelector('[data-bind="jp-overview"]');
        if (overviewDetails && overviewDetails.open) {
          this.#overviewRendered = true;
          this.#renderOverview(overviewLevel);
        }
      }
      return;
    }

    if (v !== this.#winnersRequestVersion) return;

    this.#currentDay = day;
    this.#currentLevel = res.level;
    this.#winners = res.winners || [];

    // Refresh overview whenever day changes (D-12)
    this.#overviewRendered = false;
    const overviewDetails = this.querySelector('[data-bind="jp-overview"]');
    if (overviewDetails && overviewDetails.open && this.#currentLevel) {
      this.#overviewRendered = true;
      this.#renderOverview(this.#currentLevel);
    }

    if (!selectEl) return;
    selectEl.innerHTML = '';
    selectEl.disabled = false;

    if (this.#winners.length === 0) {
      const opt = document.createElement('option');
      opt.disabled = true;
      opt.selected = true;
      opt.textContent = 'No data for this day';
      selectEl.appendChild(opt);
      const summaryEl = this.querySelector('[data-bind="jp-winner-summary"]');
      if (summaryEl) {
        summaryEl.innerHTML = '<div class="jp-summary-note">No jackpot data indexed for this day — scrub to a nearby day.</div>';
        summaryEl.style.display = '';
      }
      return;
    }

    for (const w of this.#winners) {
      const opt = document.createElement('option');
      opt.value = w.address;
      opt.dataset.hasBonus = String(w.hasBonus);
      if (w.winningLevel != null) opt.dataset.winningLevel = String(w.winningLevel);
      opt.textContent = this.#formatWinnerLabel(w);
      selectEl.appendChild(opt);
    }

    // Render the winner summary block above the dropdown
    this.#renderWinnerSummary(this.#winners, this.#currentDay);

    // D-10: auto-select row 0 (highest payout — server returns payout-desc)
    selectEl.selectedIndex = 0;
    // Enable Replay button now that we have a day + winner
    const replayBtn = this.querySelector('#jp-replay-btn');
    if (replayBtn && this.#replayState === 'idle') replayBtn.disabled = false;
    this.#onWinnerChange(this.#winners[0].address);
  }

  // Format a winner entry for the dropdown label per D-08:  "0xABCD…1234 — 0.42 ETH"
  #formatWinnerLabel(w) {
    const short = w.address.slice(0, 6) + '…' + w.address.slice(-4);
    const eth = formatEth(w.totalEth);
    return `${short} — ${eth} ETH`;
  }

  // Called when the user picks a different winner from the dropdown (or auto-select on day change).
  #onWinnerChange(address) {
    if (!address) return;
    // Changing winner resets the replay flow (Pitfall 6 guard)
    this.#replayCancelToken++;
    this.#replayData = null;
    this.#rolls?.cancelPendingFlashes();
    this.#setReplayState('idle');
  }

  // ---------------------------------------------------------------------------
  // Plan 04: Replay / Bonus Roll state machine
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
        // Enabled only when a day + winner is selected
        btn.disabled = !(this.#currentLevel && this.#currentDay && this._selectedAddress());
        // Clear grids on reset to idle
        if (roll1El) { roll1El.style.display = 'none'; this.#clearGrid('[data-bind="jp-roll1-grid"]'); }
        if (roll2El) { roll2El.style.display = 'none'; this.#clearGrid('[data-bind="jp-roll2-future-grid"]'); this.#clearGrid('[data-bind="jp-roll2-far-grid"]'); }
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
        break;
    }
  }

  // Helper: get the currently selected winner address from dropdown
  _selectedAddress() {
    const sel = this.querySelector('[data-bind="jp-winners-select"]');
    return sel && sel.value && !sel.options[sel.selectedIndex]?.disabled ? sel.value : '';
  }

  // Helper: clear non-header rows from a grid
  #clearGrid(selector) {
    const grid = this.querySelector(selector);
    if (!grid) return;
    Array.from(grid.children).forEach(child => {
      if (!child.classList.contains('jo-header')) grid.removeChild(child);
    });
  }

  // Helper: append a staggered-reveal row into a grid
  #appendRevealRow(grid, row, idx) {
    // Use _appendOverviewRow from the factory via a temporary container
    // Since we can't call the factory's private method directly, we build the row manually
    // mirroring _appendOverviewRow from jackpot-rolls.js
    const { joBadgePath, JO_CATEGORIES, JO_SYMBOLS, joFormatWeiToEth: fmtWei } = this._rollsHelpers || {};
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
      img.src = joBadgePath(q, sym, col);
      img.alt = JO_SYMBOLS[JO_CATEGORIES[q]]?.[sym] ?? '';
      typeCell.appendChild(img);
    }

    const winCell = document.createElement('div'); winCell.className = 'jo-winners'; winCell.textContent = String(row.winnerCount ?? '');
    const uniqCell = document.createElement('div'); uniqCell.className = 'jo-unique'; uniqCell.textContent = String(row.uniqueWinnerCount ?? '');
    const coinCell = document.createElement('div'); coinCell.className = 'jo-coin'; coinCell.textContent = (!row.coinPerWinner || row.coinPerWinner === '0') ? '\u2014' : fmtWei(row.coinPerWinner);
    const tktCell  = document.createElement('div'); tktCell.className = 'jo-tickets'; tktCell.textContent = row.ticketsPerWinner ? String(row.ticketsPerWinner) : '\u2014';
    const ethCell  = document.createElement('div'); ethCell.className = 'jo-eth'; ethCell.textContent = (!row.ethPerWinner || row.ethPerWinner === '0') ? '\u2014' : fmtWei(row.ethPerWinner);
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
    // jo-row uses display:contents — animate each cell directly (display:contents
    // elements cannot be animated in CSS)
    Array.from(rowEl.children).forEach(cell => {
      cell.classList.add('jp-row-reveal');
      cell.style.animationDelay = delay + 'ms';
    });
    grid.appendChild(rowEl);
    return rowEl;
  }

  async #onReplayClick() {
    const btn = this.querySelector('#jp-replay-btn');
    if (!btn || btn.disabled) return;

    const state = this.#replayState;

    if (state === 'idle' || state === 'roll2_done') {
      // Start Roll 1
      const addr = this._selectedAddress();
      const level = this.#currentLevel;
      const day   = this.#currentDay;
      if (!addr || !level) return;

      const cancelToken = ++this.#replayCancelToken;
      this.#replayData = null;
      this.#setReplayState('roll1_playing');

      // Ensure helpers are cached for row rendering
      if (!this._rollsHelpers) {
        try {
          const mod = await import('../app/jackpot-rolls.js');
          this._rollsHelpers = { joBadgePath: mod.joBadgePath, JO_CATEGORIES: mod.JO_CATEGORIES, JO_SYMBOLS: mod.JO_SYMBOLS, joFormatWeiToEth: mod.joFormatWeiToEth };
        } catch { /* ignore */ }
      }

      const spinEl = this.querySelector('[data-bind="jp-spin-flame"]');
      if (spinEl) spinEl.classList.add('jp-spinning');

      const data = await this.#rolls.runRoll1({
        level, day, addr,
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

  async #runRoll2Anim(cancelToken) {
    const roll2 = this.#replayData?.roll2 || { future: [], farFuture: [] };
    const spinEl = this.querySelector('[data-bind="jp-spin-flame"]');

    // 900ms spin
    await new Promise(resolve => setTimeout(resolve, 900));
    if (this.#replayCancelToken !== cancelToken) return;
    if (spinEl) spinEl.classList.remove('jp-spinning');

    const future    = (roll2.future    || []).filter(r => r && (r.ethPerWinner !== '0' || r.coinPerWinner !== '0' || r.ticketsPerWinner));
    const farFuture = (roll2.farFuture || []).filter(r => r && (r.ethPerWinner !== '0' || r.coinPerWinner !== '0' || r.ticketsPerWinner));

    const futureGrid = this.querySelector('[data-bind="jp-roll2-future-grid"]');
    const farSection = this.querySelector('[data-bind="jp-roll2-farfuture"]');
    const farGrid    = this.querySelector('[data-bind="jp-roll2-far-grid"]');

    // Clear existing rows
    this.#clearGrid('[data-bind="jp-roll2-future-grid"]');
    this.#clearGrid('[data-bind="jp-roll2-far-grid"]');

    let totalRows = 0;

    if (futureGrid) {
      for (let i = 0; i < future.length; i++) {
        this.#appendRevealRow(futureGrid, future[i], totalRows++);
      }
    }

    if (farFuture.length > 0 && farSection && farGrid) {
      farSection.style.display = '';
      for (let i = 0; i < farFuture.length; i++) {
        this.#appendRevealRow(farGrid, farFuture[i], totalRows++);
      }
    } else if (farSection) {
      farSection.style.display = 'none';
    }

    if (totalRows === 0) return; // nothing to animate

    // Wait for all animationend events — class is on cells (display:contents rows can't animate)
    await new Promise(resolve => {
      const allCells = [
        ...(futureGrid ? Array.from(futureGrid.querySelectorAll('.jp-row-reveal')) : []),
        ...(farGrid    ? Array.from(farGrid.querySelectorAll('.jp-row-reveal'))    : []),
      ];
      if (!allCells.length) { resolve(); return; }
      let done = 0;
      const onEnd = () => { done++; if (done >= allCells.length) resolve(); };
      allCells.forEach(c => c.addEventListener('animationend', onEnd, { once: true }));
      setTimeout(resolve, totalRows * 80 + 900);
    });
  }

  // -- Private methods --

  #bind(key, value) {
    const el = this.querySelector(`[data-bind="${key}"]`);
    if (el) el.textContent = value;
  }

  async #onGameUpdate(game) {
    if (!game) return;

    if (game.jackpotDay !== undefined) this.#showContent();

    // Update day counter
    const day = game.jackpotDay || 0;
    this.#bind('day', day > 0 ? `Day ${day}/5` : 'Day --');

    // Plan 03: update scrubber range once we know the game level.
    if (this.#scrubber && game.level && this.#currentDay === null) {
      Promise.all([
        fetchJSON('/game/jackpot/latest-day').catch(() => ({ latestDay: null })),
        fetchJSON('/game/jackpot/earliest-day').catch(() => ({ earliestDay: null })),
      ]).then(([latestRes, earliestRes]) => {
        const maxDay = (latestRes.latestDay && latestRes.latestDay > 0)
          ? latestRes.latestDay
          : this.#computeLatestCompletedDay(game);
        const minDay = (earliestRes.earliestDay && earliestRes.earliestDay > 0)
          ? earliestRes.earliestDay
          : 1;
        if (this.#scrubber) this.#scrubber.setRange(minDay, maxDay);
        if (this.#currentDay === null) {
          if (this.#scrubber) this.#scrubber.setDay(maxDay);
          this.#onDayChange(maxDay);
        }
      }).catch(() => {
        const latestCompleted = this.#computeLatestCompletedDay(game);
        if (this.#scrubber) this.#scrubber.setRange(1, latestCompleted);
        if (this.#currentDay === null) {
          if (this.#scrubber) this.#scrubber.setDay(latestCompleted);
          this.#onDayChange(latestCompleted);
        }
      });
    }

    // Update pool display
    const poolWei = game.pools?.current || '0';
    this.#bind('pool', poolWei !== '0' ? formatEth(poolWei) + ' ETH' : '--');

    // Update allocation estimate
    const alloc = estimateAllocation(poolWei, day);
    if (alloc.label === '--') {
      this.#bind('allocation', '--');
    } else if (alloc.label === '100%') {
      this.#bind('allocation', formatEth(alloc.min) + ' ETH (100%)');
    } else {
      this.#bind('allocation', formatEth(alloc.min) + ' - ' + formatEth(alloc.max) + ' ETH (' + alloc.label + ')');
    }

    // Show jackpot results — either live reveal or historical data
    const rngWord = game.dailyRng?.finalWord || null;
    const currentLevel = game.level || 0;

    if (game.phase === 'JACKPOT' && rngWord && rngWord !== '0' && rngWord !== this.#currentRngWord) {
      this.#currentRngWord = rngWord;
      this.#revealPlayed = false;
      try {
        const data = await fetchJSON(`/game/jackpot/${currentLevel}`);
        this.#triggerReveal(rngWord, data.distributions);
      } catch {
        this.#triggerReveal(rngWord);
      }
    } else if (!this.#revealPlayed && currentLevel > 0) {
      this.#revealPlayed = true;
      for (let lvl = 1; lvl <= Math.min(currentLevel, 20); lvl++) {
        try {
          const data = await fetchJSON(`/game/jackpot/${lvl}`);
          if (data.distributions?.length > 0) {
            this.#bind('day', data.distributions[0].day ? `Day ${data.distributions[0].day}` : `Level ${lvl}`);
            this.#showHistoricalResults(data.distributions);
            return;
          }
        } catch { /* no data for this level */ }
      }
      this.#revealPlayed = false;
    }
  }

  async #triggerReveal(rngWord, distributions = null) {
    if (this.#revealPlayed) return;
    this.#revealPlayed = true;

    let traits;
    if (distributions && distributions.length > 0) {
      traits = distributions
        .filter(d => d.traitId != null)
        .slice(0, 4)
        .map(d => d.traitId);
      while (traits.length < 4) traits.push(null);
    } else {
      traits = deriveWinningTraits(rngWord);
    }
    const badges = traits.map(t => traitToBadge(t));

    const cardEls = this.querySelectorAll('.trait-card');
    cardEls.forEach((card, i) => {
      const badge = badges[i];
      const img = card.querySelector('.badge-img');
      const name = card.querySelector('.trait-name');
      if (badge && img) {
        img.src = badge.path;
        img.alt = `${badge.category} ${badge.color}`;
      }
      if (badge && name) {
        name.textContent = badge.label || `${badge.category} ${badge.color}`;
      }
    });

    await this.#animateReveal(cardEls, badges);
  }

  #showHistoricalResults(distributions) {
    const seen = new Set();
    const traits = [];
    for (const d of distributions) {
      if (d.traitId != null && !seen.has(d.traitId)) {
        seen.add(d.traitId);
        traits.push(d.traitId);
        if (traits.length >= 4) break;
      }
    }
    while (traits.length < 4) traits.push(null);

    const badges = traits.map(t => traitToBadge(t));
    const cardEls = this.querySelectorAll('.trait-card');

    cardEls.forEach((card, i) => {
      const badge = badges[i];
      const img = card.querySelector('.badge-img');
      const name = card.querySelector('.trait-name');
      if (badge && img) {
        img.src = badge.path;
        img.alt = `${badge.category} ${badge.color}`;
      }
      if (badge && name) {
        name.textContent = badge.label || `${badge.category} ${badge.color}`;
      }
      const inner = card.querySelector('.trait-card-inner');
      if (inner) inner.style.transform = 'rotateY(180deg)';
      card.setAttribute('data-winner', 'true');
    });

    const resultEl = this.querySelector('[data-bind="result"]');
    if (resultEl) resultEl.hidden = false;
    const textEl = this.querySelector('.jackpot-result-text');
    if (textEl) {
      const uniqueWinners = new Set(distributions.map(d => d.winner)).size;
      textEl.textContent = `${distributions.length} prizes awarded to ${uniqueWinners} winners`;
    }

    const byPlayer = {};
    for (const d of distributions) {
      if (!byPlayer[d.winner]) byPlayer[d.winner] = { ethTotal: 0n, extraTypes: new Set() };
      const awardType = d.awardType || 'unknown';
      if (awardType === 'eth') {
        byPlayer[d.winner].ethTotal += BigInt(d.amount || '0');
      } else if (awardType !== 'dgnrs') {
        byPlayer[d.winner].extraTypes.add(awardType);
      }
    }

    const sorted = Object.entries(byPlayer)
      .sort(([, a], [, b]) => (b.ethTotal > a.ethTotal ? 1 : b.ethTotal < a.ethTotal ? -1 : 0));

    const listEl = this.querySelector('[data-bind="winners-list"]');
    const dropdownEl = this.querySelector('[data-bind="winners-dropdown"]');
    if (listEl && dropdownEl) {
      listEl.innerHTML = sorted.map(([addr, { ethTotal, extraTypes }]) => {
        const short = addr.slice(0, 6) + '…' + addr.slice(-4);
        const typeLabels = [...extraTypes].map(t => {
          if (t === 'whale_pass') return 'Whale Pass';
          if (t === 'tickets') return 'Tickets';
          if (t.includes('burnie') || t === 'farFutureCoin') return 'BURNIE';
          return t;
        });
        const typeLabel = typeLabels.join(' + ');
        const ethDisplay = ethTotal > 0n ? formatEth(ethTotal.toString()) + ' ETH' : '';
        const amountDisplay = [ethDisplay, typeLabel].filter(Boolean).join(' + ');
        return `<div class="jackpot-winner-row">
          <span class="winner-addr" title="${addr}">${short}</span>
          <span class="winner-amount">${amountDisplay || '—'}</span>
        </div>`;
      }).join('');
      dropdownEl.hidden = false;
    }
  }

  async #animateReveal(cardEls, badges) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cardEls.forEach((card) => {
        const inner = card.querySelector('.trait-card-inner');
        if (inner) inner.style.transform = 'rotateY(180deg)';
        card.setAttribute('data-winner', 'true');
      });
      this.#celebrate();
      return;
    }

    try {
      const { default: gsap } = await import('gsap');
      const tl = gsap.timeline({ paused: true });
      this.#timeline = tl;

      cardEls.forEach((card, i) => {
        const inner = card.querySelector('.trait-card-inner');
        const badgeImg = card.querySelector('.badge-img');

        tl.to(inner, {
          rotateY: 180,
          duration: 0.5,
          ease: 'power2.inOut',
        }, i === 0 ? '+=0.3' : '+=0.5');

        tl.call(() => card.setAttribute('data-winner', 'true'));
        tl.fromTo(badgeImg, { scale: 0.8 }, {
          scale: 1.1,
          duration: 0.3,
          ease: 'back.out(1.7)',
        });
        tl.to(badgeImg, { scale: 1.0, duration: 0.2 });
      });

      tl.call(() => this.#celebrate());
      tl.play();
    } catch (err) {
      console.warn('[JackpotPanel] GSAP load failed, using instant reveal:', err);
      cardEls.forEach(card => {
        const inner = card.querySelector('.trait-card-inner');
        if (inner) inner.style.transform = 'rotateY(180deg)';
        card.setAttribute('data-winner', 'true');
      });
      this.#celebrate();
    }
  }

  async #celebrate() {
    playSound('win');
    try {
      const { default: confetti } = await import('canvas-confetti');

      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#22c55e', '#8b5cf6', '#eab308', '#06b6d4'],
      });

      setTimeout(() => {
        confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0 } });
        confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1 } });
      }, 200);
    } catch (err) {
      console.warn('[JackpotPanel] Confetti load failed:', err);
    }

    const resultEl = this.querySelector('[data-bind="result"]');
    if (resultEl) resultEl.hidden = false;

    const textEl = this.querySelector('.jackpot-result-text');
    if (textEl) textEl.textContent = 'Winning traits revealed!';

    const amountEl = this.querySelector('.jackpot-prize-amount');
    if (amountEl) {
      const poolWei = get('game.pools.current') || '0';
      const day = get('game.jackpotDay') || 0;
      const alloc = estimateAllocation(poolWei, day);
      const mid = (BigInt(alloc.min || '0') + BigInt(alloc.max || '0')) / 2n;
      this.#animateNumber(amountEl, mid.toString());
    }
  }

  #animateNumber(el, targetWei) {
    const targetText = formatEth(targetWei);
    const targetNum = parseFloat(targetText) || 0;
    if (targetNum === 0) {
      el.textContent = '0 ETH';
      return;
    }

    const duration = 600;
    const start = performance.now();

    const tick = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = (targetNum * eased).toFixed(3);
      el.textContent = current + ' ETH';
      if (progress < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }
}

customElements.define('jackpot-panel', JackpotPanel);
