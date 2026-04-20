// components/jackpot-panel.js -- Jackpot panel Custom Element
// Historical jackpot explorer: scrubber, winners dropdown, summary, Day Overview, Replay/Bonus Roll.
// Live 4-card draw panel removed (plan 39-04) — historical explorer only.

import { subscribe } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { formatEth } from '../app/utils.js';
import { createScrubber } from '../viewer/scrubber.js';
import { joFormatWeiToEth, joScaledToTickets, createJackpotRolls } from '../app/jackpot-rolls.js';

class JackpotPanel extends HTMLElement {
  #unsubs = [];
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
    this.innerHTML = `
      <div data-bind="skeleton" class="panel jackpot-panel">
        <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
        <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:50%"></div><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
      </div>
      <div data-bind="content" style="display:none">
      <div class="panel jackpot-panel">
        <div class="panel-header">
          <h2>JACKPOT</h2>
          <span class="jackpot-day" data-bind="day">Day --</span>
        </div>

        <!-- Historical jackpot explorer -->
        <div class="jp-day-port" data-bind="jp-day-port">
          <div class="jp-day-scrubber" data-bind="jp-day-scrubber"></div>
          <!-- Winner summary: rendered by #renderWinnerSummary on day change -->
          <div class="jp-winner-summary" data-bind="jp-winner-summary" style="display:none;"></div>

          <!-- Replay / Bonus Roll section (Plan 04 rebuild) -->
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

            <!-- Plan 39-07: Roll 2 bonus-only slot grid (3 cols x 5 rows: 4 bonus + 1 far-future) -->
            <div class="jp-roll2-result" data-bind="jp-roll2-result" style="display:none;">
              <div class="jp-roll-heading jp-roll2-heading">Bonus Roll — bonus-card draws for this day</div>
              <div class="jp-roll2-slot-grid" data-bind="jp-roll2-slot-grid">
                <div class="jp-slot-header">Symbol</div>
                <div class="jp-slot-header">Wins</div>
                <div class="jp-slot-header">Amount / win</div>
              </div>
            </div>
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

          <div class="jp-winners">
            <div class="jp-winners-group" data-bind="jp-winners-group-normal" style="display:none;">
              <div class="jp-winners-label">
                <span data-bind="jp-winners-label-normal">Winners (Normal Jackpot)</span>
              </div>
              <ul class="jp-winners-list" data-bind="jp-winners-list-normal" role="listbox" aria-label="Normal jackpot winners"></ul>
            </div>
            <div class="jp-winners-group" data-bind="jp-winners-group-baf" style="display:none;">
              <div class="jp-winners-label">
                <span data-bind="jp-winners-label-baf">BAF Winners</span>
              </div>
              <ul class="jp-winners-list" data-bind="jp-winners-list-baf" role="listbox" aria-label="BAF winners"></ul>
            </div>
            <div class="jp-winners-group" data-bind="jp-winners-group-decimator" style="display:none;">
              <div class="jp-winners-label">
                <span data-bind="jp-winners-label-decimator">Decimator Winners</span>
              </div>
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

    // Winner-table click wiring moved to the per-item listeners bound during
    // #renderWinners() — the former `change` listener on a single <ul> is no
    // longer meaningful now that winners are split across three lists.

    // Plan 04 (rebuild): initialise rolls factory and wire Replay button
    this.#rolls = createJackpotRolls({
      root: this,
      apiBase: '/beta/api',
      selectors: {
        roll2Panel:      '[data-bind="jp-roll2-result"]',
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
      // Pass current day so the overview is scoped to a single day's block
      // range rather than aggregating all level-N distributions across every
      // calendar day the level spans (a compressed/normal-mode level's
      // tickets fire on multiple days before its ETH jackpot).
      const dayQS = this.#currentDay ? `?day=${this.#currentDay}` : '';
      overview = await fetchJSON(`/game/jackpot/${level}/overview${dayQS}`);
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
      tktCell.textContent = row.ticketsPerWinner ? String(joScaledToTickets(row.ticketsPerWinner)) : '\u2014';

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
    // BAF winners: rows with bafPrize.eth > 0 OR bafPrize.tickets > 0.  The
    // underlying eth_baf amounts are already included in totalEth (eth_total SQL
    // groups LIKE 'eth%'), so BAF winners may double-show in the ETH row — that's
    // intentional: ETH row = total ETH received, BAF row = of that total, how
    // much came from the BAF draw.
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
      // v4.4: ticketCount is scaled ×TICKET_SCALE (=100).  Divide for display.
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
      // v4.4: bafPrize.tickets is the sum of scaled ticketCount per winner.
      // Report total-tickets-awarded + events-count so the user sees both.
      const uniqueAddrs = new Set(bafTicketWinners.map(w => w.address)).size;
      const totalTickets = bafTicketWinners.reduce(
        (sum, w) => sum + joScaledToTickets(w.bafPrize.tickets || 0), 0
      );
      const amtStr = `${totalTickets} tkts across ${bafTicketWinners.length} lootbox roll${bafTicketWinners.length === 1 ? '' : 's'}`;
      rows.push({ label: 'BAF Tickets', count: bafTicketWinners.length, unique: uniqueAddrs, amount: amtStr });
    }

    // Decimator — per-winner regularEth + lootboxEth (regular claim) and
    // terminalEth (game-over terminal claim).  Shown as separate rows so the
    // user can see decimator activity disjoint from jackpot draws.
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

  // Called when the scrubber day changes — fetches winners and populates the dropdown.
  async #onDayChange(day) {
    // Changing day resets the replay flow (Pitfall 6 guard)
    this.#replayCancelToken++;
    this.#replayData = null;
    this.#rolls?.cancelPendingFlashes();
    this.#setReplayState('idle');

    this.#winnersRequestVersion++;
    const v = this.#winnersRequestVersion;

    // Winner lists: one per category (normal / baf / decimator).  Each is an
    // independent <ul>; clicking any item selects the winner for replay.
    const listNormal = this.querySelector('[data-bind="jp-winners-list-normal"]');
    const listBaf    = this.querySelector('[data-bind="jp-winners-list-baf"]');
    const listDec    = this.querySelector('[data-bind="jp-winners-list-decimator"]');
    const groupNormal = this.querySelector('[data-bind="jp-winners-group-normal"]');
    const groupBaf    = this.querySelector('[data-bind="jp-winners-group-baf"]');
    const groupDec    = this.querySelector('[data-bind="jp-winners-group-decimator"]');
    const groupEmpty  = this.querySelector('[data-bind="jp-winners-group-empty"]');
    const emptyLi     = this.querySelector('[data-bind="jp-winners-empty"]');
    // Loading placeholder — render in the normal list until the fetch resolves.
    if (listNormal) {
      listNormal.innerHTML = '<li class="jp-winner-item jp-winner-item--empty">Loading\u2026</li>';
    }
    if (listBaf)    listBaf.innerHTML    = '';
    if (listDec)    listDec.innerHTML    = '';
    if (groupNormal) groupNormal.style.display = '';
    if (groupBaf)    groupBaf.style.display    = 'none';
    if (groupDec)    groupDec.style.display    = 'none';
    if (groupEmpty)  groupEmpty.style.display  = 'none';

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
      if (listNormal) {
        listNormal.innerHTML = '<li class="jp-winner-item jp-winner-item--empty">Winners unavailable \u2014 API updating</li>';
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

    // Clear all three lists (they may contain Loading placeholders from above).
    if (listNormal) listNormal.innerHTML = '';
    if (listBaf)    listBaf.innerHTML    = '';
    if (listDec)    listDec.innerHTML    = '';

    if (this.#winners.length === 0) {
      if (groupNormal) groupNormal.style.display = 'none';
      if (groupBaf)    groupBaf.style.display    = 'none';
      if (groupDec)    groupDec.style.display    = 'none';
      if (groupEmpty)  groupEmpty.style.display  = '';
      if (emptyLi)     emptyLi.textContent       = `No data for day ${day}`;
      const summaryEl = this.querySelector('[data-bind="jp-winner-summary"]');
      if (summaryEl) {
        summaryEl.innerHTML = '<div class="jp-summary-note">No jackpot data indexed for this day — scrub to a nearby day.</div>';
        summaryEl.style.display = '';
      }
      return;
    }

    // Classify each winner into up to three category buckets.  A single winner
    // can appear in multiple lists if they received awards from multiple
    // sources (e.g. normal jackpot + BAF).  The category-specific amount is
    // rendered inline with each list item.
    const normalWinners = [];
    const bafWinners = [];
    const decimatorWinners = [];
    for (const w of this.#winners) {
      const hasNormal = (BigInt(w.totalEth || '0') > 0n)
        || ((w.ticketCount || 0) > 0)
        || (BigInt(w.coinTotal || '0') > 0n);
      const hasBaf = w.bafPrize && (
        BigInt(w.bafPrize.eth || '0') > 0n
        || (w.bafPrize.tickets || 0) > 0
      );
      const hasDec = w.decimatorPrize && (
        BigInt(w.decimatorPrize.regularEth || '0') > 0n
        || BigInt(w.decimatorPrize.lootboxEth || '0') > 0n
        || BigInt(w.decimatorPrize.terminalEth || '0') > 0n
      );
      if (hasNormal) normalWinners.push(w);
      if (hasBaf)    bafWinners.push(w);
      if (hasDec)    decimatorWinners.push(w);
    }

    // Amount-text helpers for per-category display.
    const normalAmtText = (w) => {
      const parts = [];
      if (BigInt(w.totalEth || '0') > 0n) parts.push(`${formatEth(w.totalEth)} ETH`);
      // v4.4: ticketCount is scaled ×TICKET_SCALE (=100).
      if ((w.ticketCount || 0) > 0) {
        const n = joScaledToTickets(w.ticketCount);
        parts.push(`${n} tkts`);
      }
      if (BigInt(w.coinTotal || '0') > 0n) parts.push(`${joFormatWeiToEth(w.coinTotal)} BURNIE`);
      return parts.join(' · ');
    };
    const bafAmtText = (w) => {
      const parts = [];
      if (BigInt(w.bafPrize.eth || '0') > 0n) parts.push(`${formatEth(w.bafPrize.eth)} ETH`);
      // v4.4: bafPrize.tickets is the sum of scaled ticketCount (×TICKET_SCALE)
      // across all BAF lootbox rolls for this winner.  Divide for display.
      if ((w.bafPrize.tickets || 0) > 0) {
        const n = joScaledToTickets(w.bafPrize.tickets);
        parts.push(`${n} tkts`);
      }
      return parts.join(' · ');
    };
    const decAmtText = (w) => {
      const d = w.decimatorPrize;
      const parts = [];
      if (BigInt(d.regularEth || '0') > 0n) parts.push(`${formatEth(d.regularEth)} ETH`);
      if (BigInt(d.lootboxEth || '0') > 0n) parts.push(`${formatEth(d.lootboxEth)} lb`);
      if (BigInt(d.terminalEth || '0') > 0n) parts.push(`${formatEth(d.terminalEth)} term`);
      return parts.join(' · ');
    };

    const buildLi = (w, amountText) => {
      const li = document.createElement('li');
      li.className = 'jp-winner-item';
      li.setAttribute('role', 'option');
      li.dataset.address = w.address;
      li.dataset.hasBonus = String(w.hasBonus);
      if (w.winningLevel != null) li.dataset.winningLevel = String(w.winningLevel);

      const short = w.address.slice(0, 6) + '\u2026' + w.address.slice(-4);
      const addrSpan = document.createElement('span');
      addrSpan.className = 'jp-winner-addr';
      addrSpan.textContent = short;
      li.appendChild(addrSpan);

      if (amountText) {
        const amtSpan = document.createElement('span');
        amtSpan.className = 'jp-winner-amount';
        amtSpan.textContent = amountText;
        li.appendChild(amtSpan);
      }

      if (w.breakdown && w.breakdown.length > 0) {
        const tip = document.createElement('span');
        tip.className = 'jp-winner-tip';
        tip.innerHTML = this.#formatBreakdownTooltip(w.breakdown);
        li.appendChild(tip);
      }

      li.addEventListener('click', () => this.#onWinnerItemClick(li));
      return li;
    };

    if (listNormal) {
      for (const w of normalWinners) listNormal.appendChild(buildLi(w, normalAmtText(w)));
    }
    if (listBaf) {
      for (const w of bafWinners) listBaf.appendChild(buildLi(w, bafAmtText(w)));
    }
    if (listDec) {
      for (const w of decimatorWinners) listDec.appendChild(buildLi(w, decAmtText(w)));
    }

    // Keep all three category groups ALWAYS visible so users can see the
    // separation structure even on days without BAF / decimator activity.
    // Groups with no winners render an empty-state placeholder row.
    const labelNormal = this.querySelector('[data-bind="jp-winners-label-normal"]');
    const labelBaf    = this.querySelector('[data-bind="jp-winners-label-baf"]');
    const labelDec    = this.querySelector('[data-bind="jp-winners-label-decimator"]');
    if (groupNormal) groupNormal.style.display = '';
    if (groupBaf)    groupBaf.style.display    = '';
    if (groupDec)    groupDec.style.display    = '';
    if (groupEmpty)  groupEmpty.style.display  = 'none';
    if (labelNormal) labelNormal.textContent = `Winners (Normal Jackpot) — ${normalWinners.length}`;
    if (labelBaf)    labelBaf.textContent    = `BAF Winners — ${bafWinners.length}`;
    if (labelDec)    labelDec.textContent    = `Decimator Winners — ${decimatorWinners.length}`;

    // Empty-state placeholders for the two secondary tables when they have no
    // winners on this day.  Keeps the UI contract — three tables always present.
    if (listBaf && bafWinners.length === 0) {
      listBaf.innerHTML = '<li class="jp-winner-item jp-winner-item--empty">No BAF winners this day</li>';
    }
    if (listDec && decimatorWinners.length === 0) {
      listDec.innerHTML = '<li class="jp-winner-item jp-winner-item--empty">No decimator claims this day</li>';
    }
    if (listNormal && normalWinners.length === 0) {
      listNormal.innerHTML = '<li class="jp-winner-item jp-winner-item--empty">No normal-jackpot winners this day</li>';
    }

    // Render the winner summary block above the lists.
    this.#renderWinnerSummary(this.#winners, this.#currentDay);

    // Auto-select the highest-payout winner.  Server returns payout-desc order,
    // and the normal list gets top priority; fall back to BAF then decimator.
    const firstGroup = normalWinners.length > 0
      ? listNormal
      : (bafWinners.length > 0 ? listBaf : (decimatorWinners.length > 0 ? listDec : null));
    const firstItem = firstGroup?.querySelector('.jp-winner-item');
    const firstWinner = normalWinners[0] ?? bafWinners[0] ?? decimatorWinners[0];
    if (firstItem && firstWinner) {
      firstItem.classList.add('jp-winner-item--selected');
      const replayBtn = this.querySelector('#jp-replay-btn');
      if (replayBtn && this.#replayState === 'idle') replayBtn.disabled = false;
      this.#onWinnerChange(firstWinner.address);
    }
  }

  // Format breakdown array into tooltip HTML lines.
  #formatBreakdownTooltip(breakdown) {
    return breakdown.map(b => {
      const { awardType, amount, count } = b;
      let label;
      if (awardType === 'eth') {
        label = joFormatWeiToEth(amount) + ' ETH';
      } else if (awardType === 'tickets') {
        label = amount + ' ticket' + (Number(amount) !== 1 ? 's' : '');
      } else if (awardType.includes('burnie') || awardType === 'farFutureCoin') {
        label = joFormatWeiToEth(amount) + ' BURNIE';
      } else if (awardType === 'whale_pass') {
        label = 'Whale Pass';
      } else if (awardType === 'dgnrs') {
        label = joFormatWeiToEth(amount) + ' DGNRS';
      } else {
        label = amount + ' ' + awardType;
      }
      return `<span>\u00d7${count} ${label}</span>`;
    }).join('');
  }

  // Called when a winner list item is clicked.  Clears the --selected state
  // across all three category lists (normal / baf / decimator) so only one
  // item is highlighted at a time regardless of which table the click came
  // from.
  #onWinnerItemClick(li) {
    this.querySelectorAll('.jp-winners-list .jp-winner-item--selected')
      .forEach(el => el.classList.remove('jp-winner-item--selected'));
    li.classList.add('jp-winner-item--selected');
    const address = li.dataset.address;
    if (address) this.#onWinnerChange(address);
  }

  // Called when selection changes (click or auto-select on day change).
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
        if (roll2El) {
          roll2El.style.display = 'none';
          // Plan 39-05: clear slot-grid non-header cells
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
        break;
    }
  }

  // Helper: get the currently selected winner address from any of the three
  // category lists (only one item is ever --selected at a time).
  _selectedAddress() {
    const selected = this.querySelector('.jp-winners-list .jp-winner-item--selected');
    return selected?.dataset?.address ?? '';
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
    const tktCell  = document.createElement('div'); tktCell.className = 'jo-tickets'; tktCell.textContent = row.ticketsPerWinner ? String(joScaledToTickets(row.ticketsPerWinner)) : '\u2014';
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
    const data = this.#replayData;
    if (!data) return;
    const spinEl = this.querySelector('[data-bind="jp-spin-flame"]');

    // 900ms spin
    await new Promise(resolve => setTimeout(resolve, 900));
    if (this.#replayCancelToken !== cancelToken) return;
    if (spinEl) spinEl.classList.remove('jp-spinning');

    // Plan 39-07: re-bucket by bonus-card symbol slot (4 bonus + 1 far-future)
    const { rebucketRoll2BySlot, joBadgePath, JO_CATEGORIES, JO_SYMBOLS, joFormatWeiToEth } =
      await import('../app/jackpot-rolls.js');

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
        sym.textContent = '\u2014';
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
        amt.textContent = '\u2014';
      } else {
        const a = slot.amountPerWin;
        amt.textContent = (a && a.length > 10) ? joFormatWeiToEth(a) : String(a);
      }

      [sym, wins, amt].forEach(cell => {
        cell.classList.add('jp-row-reveal');
        cell.style.animationDelay = (idx * 60) + 'ms';
        grid.appendChild(cell);
      });

      // Plan 39-09: ticket sub-row under bonus slot (never under far-future).
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
        label.textContent = '\u21B3 Tickets won: ' + slot.ticketSubRow.wins;

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
  }

}

customElements.define('jackpot-panel', JackpotPanel);
