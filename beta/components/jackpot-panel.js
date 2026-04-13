// components/jackpot-panel.js -- Jackpot panel Custom Element
// Animated sequential trait reveal, pool/day/allocation display, badge visualization, confetti celebration.
// All data transformation delegated to jackpot-data.js.
// Plan 03: day scrubber (shared with viewer.html) + winners dropdown above existing 4-card reveal.
// Plan 04: createJackpotRolls factory mounted in jp-rolls-slot; winner/day events wired.

import { subscribe, get } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { deriveWinningTraits, traitToBadge, estimateAllocation } from '../app/jackpot-data.js';
import { formatEth } from '../app/utils.js';
import { playSound } from '../app/audio.js';
import { createScrubber } from '../viewer/scrubber.js';
import { createJackpotRolls } from '../app/jackpot-rolls.js';
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

  // Plan 04: factory instance
  #rolls = null;
  // Track whether the overview has been rendered at least once (for lazy first-open render)
  #overviewRendered = false;
  // Panel-local roll state machine — mirrors factory's rollPhase but owned here
  // so that direct preFlightAndRunPlayer calls (from #onWinnerChange) reset it cleanly.
  // 'idle' | 'roll1' | 'roll2' | 'done'
  #rollPhase = 'idle';
  // Cached pre-flight response for current selection (used by Roll Bonus click)
  #playerData = null;
  // Timer handle for the "No bonus" flash — cancelled on winner/day change (Pitfall 6)
  #noBonusTimer = null;

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

        <!-- Historical jackpot explorer (Plan 03 + 04) -->
        <h3 class="jp-section-title">Historical jackpot explorer</h3>
        <div class="jp-day-port" data-bind="jp-day-port">
          <div class="jp-day-scrubber" data-bind="jp-day-scrubber"></div>
          <div class="jp-winners">
            <label class="jp-winners-label">Winner</label>
            <select class="jp-winners-select" data-bind="jp-winners-select"></select>
          </div>

          <!-- Plan 04: Roll 1 result grid + state-machine button -->
          <div class="jp-rolls-slot" data-bind="jp-rolls-slot">
            <div id="jp-roll1-section" class="jp-roll1-section" style="display:none;">
              <div class="jackpot-overview-heading">Roll 1 — Current Level</div>
              <div class="jo-grid" id="jp-roll1-grid">
                <div class="jo-header">Type</div>
                <div class="jo-header">Win</div>
                <div class="jo-header">Uniq</div>
                <div class="jo-header">Coin</div>
                <div class="jo-header">Tkts</div>
                <div class="jo-header">ETH</div>
                <div class="jo-header">Spread</div>
              </div>
              <div id="jp-roll1-empty" class="jo-empty" style="display:none;">No current-level wins.</div>
            </div>

            <!-- Plan 04: Roll 2 panel (pre-created so factory finds it; hidden by default) -->
            <section id="jp-roll2-panel" class="jackpot-overview" style="display:none;">
              <div class="jackpot-overview-heading">Bonus Roll</div>
              <div id="jp-roll2-future-block">
                <div class="jo-subheading">Future</div>
                <div class="jo-grid" id="jp-roll2-future-grid">
                  <div class="jo-header">Type</div><div class="jo-header">Win</div>
                  <div class="jo-header">Uniq</div><div class="jo-header">Coin</div>
                  <div class="jo-header">Tkts</div><div class="jo-header">ETH</div>
                  <div class="jo-header">Spread</div>
                </div>
                <div id="jp-roll2-future-empty" class="jo-empty" style="display:none;">No future-ticket wins.</div>
              </div>
              <div id="jp-roll2-far-block" style="margin-top:16px;">
                <div class="jo-subheading">Far-Future</div>
                <div class="jo-grid" id="jp-roll2-far-grid">
                  <div class="jo-header">Type</div><div class="jo-header">Win</div>
                  <div class="jo-header">Uniq</div><div class="jo-header">Coin</div>
                  <div class="jo-header">Tkts</div><div class="jo-header">ETH</div>
                  <div class="jo-header">Spread</div>
                </div>
                <div id="jp-roll2-far-empty" class="jo-empty" style="display:none;">No far-future wins.</div>
              </div>
            </section>

            <div class="jp-roll-controls">
              <button id="jp-roll-btn" class="jp-roll-btn" style="display:none;">Roll</button>
            </div>
          </div>

          <!-- Plan 04: Day Overview — collapsed by default (D-12) -->
          <details class="jp-overview" data-bind="jp-overview">
            <summary>Day Overview</summary>
            <div class="jp-overview-body" data-bind="jp-overview-body">
              <!-- Plan 04: overview grid injected by createJackpotRolls.renderOverview -->
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

    // Plan 04: instantiate factory with panel-scoped selectors so all DOM lookups
    // are scoped to this element — no collision with the wtf/jackpot-demo.html IDs.
    this.#rolls = createJackpotRolls({
      root: this,
      apiBase: API_BASE,
      selectors: {
        // Overview selectors (used by renderOverview)
        joGrid:          '#jp-jo-grid',
        joStatus:        '#jp-jo-status',
        joFarFuture:     '#jp-jo-far-future',
        // Roll button (used by state machine + flash logic)
        rollBtn:         '#jp-roll-btn',
        // Roll 2 panel (pre-created above so _ensureRoll2Container is a no-op)
        roll2Panel:      '#jp-roll2-panel',
        roll2FutureGrid: '#jp-roll2-future-grid',
        roll2FarGrid:    '#jp-roll2-far-grid',
        roll2FutureEmpty:'#jp-roll2-future-empty',
        roll2FarEmpty:   '#jp-roll2-far-empty',
        roll2FutureBlock:'#jp-roll2-future-block',
        roll2FarBlock:   '#jp-roll2-far-block',
        // jackpotOverview / demoWrap / demoCenterFlame — not used in panel context;
        // roll2-panel is pre-created so _ensureRoll2Container short-circuits.
        jackpotOverview: '#jp-roll2-panel',
        demoWrap:        '[data-bind="jp-rolls-slot"]',
        demoCenterFlame: '.jp-roll-controls',  // unused visual effect; points to a safe no-op target
      },
    });
    this.#unsubs.push(() => this.#rolls.dispose());

    // Plan 04: wire the roll button with a panel-owned state machine.
    // We call preFlightAndRunPlayer directly from #onWinnerChange (not via the
    // factory's attachButtonStateMachine) so that dropdown re-selection always
    // resets cleanly — the factory's attachButtonStateMachine has a one-shot
    // 'started' flag that can't reset across winner changes.
    const rollBtn = this.querySelector('#jp-roll-btn');
    if (rollBtn) {
      rollBtn.addEventListener('click', () => this.#onRollBtnClick());
    }

    // Wire the jp-overview toggle for lazy first-render (D-12)
    const overviewDetails = this.querySelector('[data-bind="jp-overview"]');
    if (overviewDetails) {
      overviewDetails.addEventListener('toggle', () => {
        if (overviewDetails.open && !this.#overviewRendered && this.#currentLevel) {
          this.#overviewRendered = true;
          this.#rolls.renderOverview(this.#currentLevel);
        }
      });
    }

    // Plan 03: wire winners select change handler
    const selectEl = this.querySelector('[data-bind="jp-winners-select"]');
    if (selectEl) {
      selectEl.addEventListener('change', (e) => this.#onWinnerChange(e.target.value));
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
    if (this.#noBonusTimer !== null) {
      clearTimeout(this.#noBonusTimer);
      this.#noBonusTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Plan 04: Roll 1 grid renderer
  // Populates #jp-roll1-grid from data.roll1Rows (per-symbol aggregated rows for
  // the selected player's current-level tickets).
  // ---------------------------------------------------------------------------

  #renderRoll1(data) {
    const section = this.querySelector('#jp-roll1-section');
    const grid = this.querySelector('#jp-roll1-grid');
    const emptyEl = this.querySelector('#jp-roll1-empty');
    if (!section || !grid) return;

    // Clear previous data rows (keep .jo-header children)
    Array.from(grid.children).forEach(child => {
      if (!child.classList.contains('jo-header')) grid.removeChild(child);
    });

    const rows = (data && Array.isArray(data.roll1Rows)) ? data.roll1Rows : [];
    section.style.display = '';

    if (rows.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    // Import the row renderer from the factory's shared utility.
    // Since _appendOverviewRow is internal to the factory, we use a local equivalent
    // that mirrors the same logic using the factory's exported helpers.
    import('../app/jackpot-rolls.js').then(({ joBadgePath, JO_CATEGORIES, JO_SYMBOLS, joFormatWeiToEth }) => {
      // Re-check in case grid was cleared by a newer call while import was resolving
      Array.from(grid.children).forEach(child => {
        if (!child.classList.contains('jo-header')) grid.removeChild(child);
      });

      const joFormatCoin = (s) => joFormatWeiToEth(s);

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
          const col = t % 8;
          const img = document.createElement('img');
          img.src = joBadgePath(q, sym, col);
          img.alt = JO_SYMBOLS[JO_CATEGORIES[q]][sym];
          typeCell.appendChild(img);
        }

        const winCell = document.createElement('div');
        winCell.className = 'jo-winners';
        winCell.textContent = String(row.winnerCount);

        const uniqCell = document.createElement('div');
        uniqCell.className = 'jo-unique';
        uniqCell.textContent = String(row.uniqueWinnerCount);

        const coinCell = document.createElement('div');
        coinCell.className = 'jo-coin';
        coinCell.textContent = (!row.coinPerWinner || row.coinPerWinner === '0') ? '\u2014' : joFormatCoin(row.coinPerWinner);

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
        rowEl.appendChild(typeCell);
        rowEl.appendChild(winCell);
        rowEl.appendChild(uniqCell);
        rowEl.appendChild(coinCell);
        rowEl.appendChild(tktCell);
        rowEl.appendChild(ethCell);
        rowEl.appendChild(spreadCell);
        grid.appendChild(rowEl);
      }
    }).catch(err => {
      console.error('[jackpot-panel] failed to load row renderer:', err);
    });
  }

  // ---------------------------------------------------------------------------
  // Plan 03: scrubber + winners dropdown methods
  // ---------------------------------------------------------------------------

  // Compute the latest completed jackpot day for a given game state.
  // Each emission level spans exactly 5 jackpot days (per jackpot_distributions.level
  // cadence documented in Phase 37/38 context).
  // During JACKPOT phase the current day is in-progress, so exclude it.
  #computeLatestCompletedDay(game) {
    const level = game.level || 0;
    if (level === 0) return 1;
    const jackpotCounter = game.jackpotDay || 0; // 1-5 within the current level
    if (game.phase === 'JACKPOT') {
      // in-progress day: exclude it; completed = (level-1)*5 + (jackpotCounter - 1)
      const completed = (level - 1) * 5 + (jackpotCounter - 1);
      return Math.max(1, completed);
    }
    // Between jackpot phases: all 5 days of the current level are complete
    return level * 5;
  }

  // Called when the scrubber day changes — fetches winners and populates the dropdown.
  async #onDayChange(day) {
    this.#winnersRequestVersion++;
    const v = this.#winnersRequestVersion;

    // Plan 04: cancel pending flashes (factory timer + panel "No bonus" timer)
    if (this.#rolls) this.#rolls.cancelPendingFlashes();
    if (this.#noBonusTimer !== null) {
      clearTimeout(this.#noBonusTimer);
      this.#noBonusTimer = null;
    }
    this.#rollPhase = 'idle';
    this.#playerData = null;

    // Reset Roll 1 section and hide roll button
    const roll1Section = this.querySelector('#jp-roll1-section');
    if (roll1Section) roll1Section.style.display = 'none';
    const rollBtn = this.querySelector('#jp-roll-btn');
    if (rollBtn) rollBtn.style.display = 'none';

    const selectEl = this.querySelector('[data-bind="jp-winners-select"]');
    if (selectEl) {
      selectEl.disabled = true;
      selectEl.innerHTML = '<option disabled>Loading…</option>';
    }

    let res;
    try {
      res = await fetchJSON(`/game/jackpot/day/${day}/winners`);
    } catch (err) {
      if (v !== this.#winnersRequestVersion) return; // stale
      // Day-based winners endpoint unavailable (route not yet deployed or API stale).
      // Fall back: derive level from day (each level = 5 jackpot days) and fetch
      // overview to confirm the level exists, so #currentLevel gets set and the
      // roll flow can still proceed even without individual winner addresses.
      const derivedLevel = Math.ceil(day / 5);
      let overviewLevel = derivedLevel;
      try {
        const ov = await fetchJSON(`/game/jackpot/${derivedLevel}/overview`);
        if (ov && ov.level) overviewLevel = ov.level;
      } catch { /* ignore — use derived level */ }
      if (v !== this.#winnersRequestVersion) return; // stale after overview fetch
      this.#currentDay = day;
      this.#currentLevel = overviewLevel;
      this.#winners = [];
      if (selectEl) {
        selectEl.disabled = true;
        selectEl.innerHTML = '<option disabled selected>Winners unavailable — API updating</option>';
      }
      // Overview and roll flow can still proceed with the derived level.
      if (overviewLevel) {
        this.#overviewRendered = false;
        const overviewDetails = this.querySelector('[data-bind="jp-overview"]');
        if (overviewDetails && overviewDetails.open) {
          this.#overviewRendered = true;
          this.#rolls.renderOverview(overviewLevel);
        }
      }
      return;
    }

    // Stale-fetch guard — discard if a newer request has been issued since this one started
    if (v !== this.#winnersRequestVersion) return;

    this.#currentDay = day;
    this.#currentLevel = res.level;
    this.#winners = res.winners || [];

    // Plan 04: refresh overview whenever day changes (D-12); mark for re-render
    // (whether or not the <details> is currently open)
    this.#overviewRendered = false;
    const overviewDetails = this.querySelector('[data-bind="jp-overview"]');
    if (overviewDetails && overviewDetails.open && this.#currentLevel) {
      this.#overviewRendered = true;
      this.#rolls.renderOverview(this.#currentLevel);
    }

    if (!selectEl) return;
    selectEl.innerHTML = '';
    selectEl.disabled = false;

    if (this.#winners.length === 0) {
      const opt = document.createElement('option');
      opt.disabled = true;
      opt.selected = true;
      opt.textContent = 'No winners for this day';
      selectEl.appendChild(opt);
      return;
    }

    for (const w of this.#winners) {
      const opt = document.createElement('option');
      opt.value = w.address;
      opt.dataset.hasBonus = String(w.hasBonus);
      opt.textContent = this.#formatWinnerLabel(w);
      selectEl.appendChild(opt);
    }

    // D-10: auto-select row 0 (highest payout — server returns payout-desc)
    selectEl.selectedIndex = 0;
    await this.#onWinnerChange(this.#winners[0].address);
  }

  // Format a winner entry for the dropdown label per D-08:  "0xABCD…1234 — 0.42 ETH"
  #formatWinnerLabel(w) {
    const short = w.address.slice(0, 6) + '…' + w.address.slice(-4);
    const eth = formatEth(w.totalEth);
    return `${short} — ${eth} ETH`;
  }

  // Called when the user picks a different winner from the dropdown (or auto-select on day change).
  // Plan 04: cancel pending flash, reset panel roll state, then run pre-flight.
  async #onWinnerChange(address) {
    if (!address || !this.#currentLevel) return;
    this.#rolls.cancelPendingFlashes();   // Pitfall 6: factory timer guard

    // Pitfall 6: cancel panel-owned "No bonus" flash timer if still pending
    if (this.#noBonusTimer !== null) {
      clearTimeout(this.#noBonusTimer);
      this.#noBonusTimer = null;
    }

    // Reset local roll state machine so button starts fresh for the new winner
    this.#rollPhase = 'idle';
    this.#playerData = null;

    // Reset button label and hide it until pre-flight data arrives
    const btn = this.querySelector('#jp-roll-btn');
    if (btn) {
      btn.textContent = 'Roll';
      btn.disabled = false;
      btn.style.display = 'none';
    }

    // Hide Roll 2 panel from previous selection
    const roll2Panel = this.querySelector('#jp-roll2-panel');
    if (roll2Panel) roll2Panel.style.display = 'none';

    await this.#rolls.preFlightAndRunPlayer({
      level: this.#currentLevel,
      addr: address,
      onData: (data) => {
        // Cache pre-flight result and render Roll 1 grid
        this.#playerData = data;
        this.#renderRoll1(data);
        // Show and label the roll button
        if (btn) {
          btn.textContent = 'Roll';
          btn.disabled = false;
          btn.style.display = '';
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Plan 04: panel-owned roll button state machine
  // Sequence: Roll → Next → Roll Bonus → Next Day →
  //           Roll → Next → (no bonus flash) → Next Day
  // ---------------------------------------------------------------------------

  #onRollBtnClick() {
    const btn = this.querySelector('#jp-roll-btn');
    if (!btn || btn.disabled) return;

    if (this.#rollPhase === 'idle') {
      // "Roll" clicked — Roll 1 data is already shown; advance to waiting-for-next
      this.#rollPhase = 'roll1';
      btn.textContent = 'Next';
      return;
    }

    if (this.#rollPhase === 'roll1') {
      if (this.#playerData && this.#playerData.hasBonus) {
        // Has bonus → prepare Roll Bonus
        const roll2Panel = this.querySelector('#jp-roll2-panel');
        if (roll2Panel) roll2Panel.style.display = 'none';
        this.#rollPhase = 'roll2';
        btn.textContent = 'Roll Bonus';
      } else {
        // No bonus → flash "No bonus" for ≤500ms then return to Next Day
        this.#rollPhase = 'done';
        btn.textContent = 'No bonus';
        btn.disabled = true;
        if (this.#noBonusTimer !== null) clearTimeout(this.#noBonusTimer);
        this.#noBonusTimer = setTimeout(() => {
          this.#noBonusTimer = null;
          btn.textContent = 'Next Day \u2192';
          btn.disabled = false;
        }, 500);
      }
      return;
    }

    if (this.#rollPhase === 'roll2') {
      // "Roll Bonus" clicked — animate then show Roll 2 data
      btn.textContent = 'Rolling\u2026';
      btn.disabled = true;
      setTimeout(() => {
        try {
          this.#rolls.renderRoll2(
            (this.#playerData && this.#playerData.roll2) || { future: [], farFuture: [] }
          );
          const roll2Panel = this.querySelector('#jp-roll2-panel');
          if (roll2Panel) {
            roll2Panel.style.display = 'block';
            roll2Panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } catch (e) {
          console.error('[jackpot-panel] roll2 render failed:', e);
        }
        btn.textContent = 'Next Day \u2192';
        btn.disabled = false;
        this.#rollPhase = 'done';
      }, 900);
      return;
    }

    if (this.#rollPhase === 'done') {
      // "Next Day" clicked — advance scrubber by 1
      if (this.#scrubber && this.#currentDay !== null) {
        const nextDay = this.#currentDay + 1;
        this.#scrubber.setDay(nextDay);
        this.#onDayChange(this.#scrubber.getDay());
      }
    }
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

    // Plan 03: update scrubber range once we know the game level
    if (this.#scrubber && game.level) {
      const latestCompleted = this.#computeLatestCompletedDay(game);
      this.#scrubber.setRange(1, latestCompleted);
      // Only set the day if we haven't already navigated (currentDay null = first load)
      if (this.#currentDay === null) {
        this.#scrubber.setDay(latestCompleted);
        // Trigger initial winners fetch
        this.#onDayChange(latestCompleted);
      }
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
      // Live reveal during JACKPOT phase
      this.#currentRngWord = rngWord;
      this.#revealPlayed = false;
      try {
        const data = await fetchJSON(`/game/jackpot/${currentLevel}`);
        this.#triggerReveal(rngWord, data.distributions);
      } catch {
        this.#triggerReveal(rngWord);
      }
    } else if (!this.#revealPlayed && currentLevel > 0) {
      // Historical: show the most recent jackpot results
      this.#revealPlayed = true; // prevent re-entry from subsequent store updates
      // Try levels from 1 upward — jackpot data is most reliably at low levels
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
      // No data found — reset so it can retry later
      this.#revealPlayed = false;
    }
  }

  async #triggerReveal(rngWord, distributions = null) {
    if (this.#revealPlayed) return;
    this.#revealPlayed = true;

    let traits;
    if (distributions && distributions.length > 0) {
      // API path: use actual event-sourced traitIds (TEST-02 requirement)
      traits = distributions
        .filter(d => d.traitId != null)
        .slice(0, 4)
        .map(d => d.traitId);
      // Pad to 4 if fewer than 4 distributions have traitId
      while (traits.length < 4) traits.push(null);
    } else {
      // Fallback: derive from RNG word (approximation)
      traits = deriveWinningTraits(rngWord);
    }
    const badges = traits.map(t => traitToBadge(t));

    // Set badge images on back faces before animation
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
    // Pick up to 4 unique traits from distributions to show as badge cards
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

    // Set badge images and flip instantly (no animation for historical)
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

    // Show result summary
    const resultEl = this.querySelector('[data-bind="result"]');
    if (resultEl) resultEl.hidden = false;
    const textEl = this.querySelector('.jackpot-result-text');
    if (textEl) {
      const uniqueWinners = new Set(distributions.map(d => d.winner)).size;
      textEl.textContent = `${distributions.length} prizes awarded to ${uniqueWinners} winners`;
    }

    // Populate winner breakdown dropdown — aggregate total amount per player
    const byPlayer = {};
    for (const d of distributions) {
      if (!byPlayer[d.winner]) byPlayer[d.winner] = { total: 0n, types: new Set() };
      byPlayer[d.winner].total += BigInt(d.amount || '0');
      byPlayer[d.winner].types.add(d.awardType || 'unknown');
    }

    // Sort by total descending
    const sorted = Object.entries(byPlayer)
      .sort(([, a], [, b]) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));

    const listEl = this.querySelector('[data-bind="winners-list"]');
    const dropdownEl = this.querySelector('[data-bind="winners-dropdown"]');
    if (listEl && dropdownEl) {
      listEl.innerHTML = sorted.map(([addr, { total, types }]) => {
        const short = addr.slice(0, 6) + '…' + addr.slice(-4);
        const typeLabel = [...types].join(', ');
        return `<div class="jackpot-winner-row">
          <span class="winner-addr" title="${addr}">${short}</span>
          <span class="winner-type">${typeLabel}</span>
          <span class="winner-amount">${formatEth(total.toString())} ETH</span>
        </div>`;
      }).join('');
      dropdownEl.hidden = false;
    }
  }

  async #animateReveal(cardEls, badges) {
    // Check reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Instant reveal without animation
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

      // Sequential card reveals with delay between each
      cardEls.forEach((card, i) => {
        const inner = card.querySelector('.trait-card-inner');
        const badgeImg = card.querySelector('.badge-img');

        // Flip the card
        tl.to(inner, {
          rotateY: 180,
          duration: 0.5,
          ease: 'power2.inOut',
        }, i === 0 ? '+=0.3' : '+=0.5');

        // Winner highlight: scale pop + data attribute for CSS glow
        tl.call(() => card.setAttribute('data-winner', 'true'));
        tl.fromTo(badgeImg, { scale: 0.8 }, {
          scale: 1.1,
          duration: 0.3,
          ease: 'back.out(1.7)',
        });
        tl.to(badgeImg, { scale: 1.0, duration: 0.2 });
      });

      // Celebration at the end
      tl.call(() => this.#celebrate());

      tl.play();
    } catch (err) {
      // GSAP load failure: instant reveal fallback
      console.warn('[JackpotPanel] GSAP load failed, using instant reveal:', err);
      cardEls.forEach(card => {
        const inner = card.querySelector('.trait-card-inner');
        if (inner) inner.style.transform = 'rotateY(180deg)';
        card.setAttribute('data-winner', 'true');
      });
    }
  }

  async #celebrate() {
    playSound('win');
    try {
      const { default: confetti } = await import('canvas-confetti');

      // Center burst
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#22c55e', '#8b5cf6', '#eab308', '#06b6d4'],
      });

      // Side bursts after short delay
      setTimeout(() => {
        confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0 } });
        confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1 } });
      }, 200);
    } catch (err) {
      console.warn('[JackpotPanel] Confetti load failed:', err);
    }

    // Show result section
    const resultEl = this.querySelector('[data-bind="result"]');
    if (resultEl) resultEl.hidden = false;

    const textEl = this.querySelector('.jackpot-result-text');
    if (textEl) textEl.textContent = 'Winning traits revealed!';

    // Animate prize amount with RAF counter
    const amountEl = this.querySelector('.jackpot-prize-amount');
    if (amountEl) {
      const poolWei = get('game.pools.current') || '0';
      const day = get('game.jackpotDay') || 0;
      const alloc = estimateAllocation(poolWei, day);
      // Use midpoint estimate for display
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
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = (targetNum * eased).toFixed(3);
      el.textContent = current + ' ETH';
      if (progress < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }
}

customElements.define('jackpot-panel', JackpotPanel);
