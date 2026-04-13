/**
 * jackpot-rolls.js — Shared factory module for the two-phase jackpot draw UI.
 *
 * Extracted from wtf/jackpot-demo.html (Phase 37 Day Overview + Phase 38 two-phase draw).
 * Plan: 39-02 — /beta/app/jackpot-rolls.js
 *
 * Exports:
 *   - createJackpotRolls({ root, apiBase, selectors }) — per-instance factory
 *   - JO_CATEGORIES, JO_SYMBOLS, CARD_IDX, joBadgePath, joFormatWeiToEth — for consumers
 */

// ---------------------------------------------------------------------------
// Module-level constants only — NO module-level mutable state.
// ---------------------------------------------------------------------------

export const JO_CATEGORIES = ['crypto', 'zodiac', 'cards', 'dice'];

export const JO_SYMBOLS = {
  crypto: ['xrp', 'tron', 'sui', 'monero', 'solana', 'chainlink', 'ethereum', 'bitcoin'],
  zodiac: ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'libra', 'sagittarius', 'aquarius'],
  cards:  ['club', 'diamond', 'heart', 'spade', 'horseshoe', 'cashsack', 'king', 'ace'],
  dice:   ['1', '2', '3', '4', '5', '6', '7', '8']
};

// Non-identity remap for the 'cards' quadrant — DO NOT simplify/linearize.
export const CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7];

const JO_COLORS = ['pink', 'purple', 'green', 'red', 'blue', 'orange', 'silver', 'gold'];

/**
 * Build the badge SVG path for a given trait.
 *
 * @param {number} quadrant  0=crypto, 1=zodiac, 2=cards, 3=dice
 * @param {number} symbolIdx 0-7 within the quadrant's symbol list
 * @param {number} colorIdx  0-7 within JO_COLORS
 * @returns {string} Absolute path to the badge SVG
 */
export function joBadgePath(quadrant, symbolIdx, colorIdx) {
  var cat = JO_CATEGORIES[quadrant];
  var idx = cat === 'cards' ? CARD_IDX[symbolIdx] : symbolIdx;
  return '/badges-circular/' + cat + '_0' + idx + '_' + JO_SYMBOLS[cat][symbolIdx] + '_' + JO_COLORS[colorIdx] + '.svg';
}

/**
 * Format a wei-denominated BigInt string to ETH display (up to 4 decimals).
 * Does not depend on an external BigNumber library.
 *
 * @param {string|number} weiStr
 * @returns {string}
 */
export function joFormatWeiToEth(weiStr) {
  if (!weiStr || weiStr === '0') return '0';
  var s = String(weiStr);
  if (s.length <= 18) {
    var pad = ('000000000000000000' + s).slice(-18).replace(/0+$/, '');
    return pad.length ? '0.' + pad.slice(0, 4) : '0';
  }
  var whole = s.slice(0, s.length - 18);
  var frac = s.slice(s.length - 18).replace(/0+$/, '').slice(0, 4);
  return frac.length ? whole + '.' + frac : whole;
}

// Internal: BURNIE is also 18-decimal — treat like ETH for display.
function joFormatCoin(amtStr) {
  return joFormatWeiToEth(amtStr);
}

// ---------------------------------------------------------------------------
// Per-instance factory
// ---------------------------------------------------------------------------

/**
 * Create a per-instance jackpot-rolls controller.
 *
 * All mutable state lives in this closure — no module-level mutable variables.
 *
 * @param {object}      opts
 * @param {HTMLElement|Document} opts.root      DOM root; `root.querySelector` used for all lookups.
 *                                              Pass `document` for the wtf/jackpot-demo.html use case.
 * @param {string}      opts.apiBase            API prefix, e.g. '/beta/api'
 * @param {object}     [opts.selectors]         Override default CSS selectors.
 * @returns {{
 *   preFlightAndRunPlayer: (args: {level: number, day?: number, addr: string}) => Promise<void>,
 *   renderOverview:        (level: number, day?: number) => Promise<void>,
 *   renderRoll2:           (roll2: object) => void,
 *   cancelPendingFlashes:  () => void,
 *   dispose:               () => void
 * }}
 */
export function createJackpotRolls({ root, apiBase, selectors }) {
  // ------------------------------------------------------------------
  // Per-instance mutable state — all owned by this closure.
  // ------------------------------------------------------------------
  var playerDataToken  = 0;    // bumped on every preFlight — stale-fetch guard (Pitfall 5)
  var pendingFlashTimer = null; // Timeout handle for "No bonus" flash (Pitfall 6)
  var rollPhase        = 'idle'; // 'idle' | 'roll1' | 'roll2' | 'done'
  var playerData       = null;  // cached pre-flight response for current token
  var joRenderToken    = 0;    // bumps per overview fetch — stale overview guard

  // ------------------------------------------------------------------
  // Test seam — only populated when globalThis.__JACKPOT_ROLLS_TEST__ === true.
  // Zero production overhead when the flag is absent.
  // ------------------------------------------------------------------
  var _testFetch        = null;  // injectable fetch replacement
  var _testTimerFactory = null;  // injectable setTimeout replacement

  function _fetch(url) {
    if (_testFetch) return _testFetch(url);
    return fetch(url);
  }

  function _setTimeout(fn, ms) {
    if (_testTimerFactory) return _testTimerFactory(fn, ms);
    return setTimeout(fn, ms);
  }

  function _clearTimeout(id) {
    if (_testTimerFactory) {
      // If injected timer factory also provides clearTimeout, use it.
      if (_testTimerFactory.clear) return _testTimerFactory.clear(id);
    }
    return clearTimeout(id);
  }

  // ------------------------------------------------------------------
  // Selector helpers — default to demo IDs; consumers can override.
  // ------------------------------------------------------------------
  var sel = Object.assign({
    rollBtn:        '#demo-next-btn',
    roll2Panel:     '#roll2-panel',
    roll2FutureGrid:'#roll2-future-grid',
    roll2FarGrid:   '#roll2-farfuture-grid',
    roll2FutureEmpty: '#roll2-future-empty',
    roll2FarEmpty:  '#roll2-farfuture-empty',
    roll2FutureBlock:'#roll2-future-block',
    roll2FarBlock:  '#roll2-farfuture-block',
    joGrid:         '#jo-grid',
    joStatus:       '#jo-status',
    joFarFuture:    '#jo-far-future',
    demoCenterFlame:'.demo-center',
    demoWrap:       '#demo-wrap',
    jackpotOverview:'#jackpot-overview'
  }, selectors || {});

  function $(selector) {
    return root.querySelector(selector);
  }

  // ------------------------------------------------------------------
  // Roll 2 panel helpers (ported from jackpot-demo.html lines 1587-1656)
  // ------------------------------------------------------------------

  function _ensureRoll2Container() {
    if ($(sel.roll2Panel)) return;
    var panel = document.createElement('section');
    panel.id = sel.roll2Panel.replace('#', '');
    panel.className = 'jackpot-overview';
    panel.style.display = 'none';
    panel.innerHTML =
      '<div class="jackpot-overview-heading">Bonus Roll</div>' +
      '<div id="' + sel.roll2FutureBlock.replace('#', '') + '">' +
      '  <div class="jo-subheading">Future</div>' +
      '  <div class="jo-grid" id="' + sel.roll2FutureGrid.replace('#', '') + '">' +
      '    <div class="jo-header">Type</div><div class="jo-header">Win</div>' +
      '    <div class="jo-header">Uniq</div><div class="jo-header">Coin</div>' +
      '    <div class="jo-header">Tkts</div><div class="jo-header">ETH</div>' +
      '    <div class="jo-header">Spread</div>' +
      '  </div>' +
      '  <div id="' + sel.roll2FutureEmpty.replace('#', '') + '" class="jo-empty" style="display:none;">No future-ticket wins.</div>' +
      '</div>' +
      '<div id="' + sel.roll2FarBlock.replace('#', '') + '" style="margin-top:16px;">' +
      '  <div class="jo-subheading">Far-Future</div>' +
      '  <div class="jo-grid" id="' + sel.roll2FarGrid.replace('#', '') + '">' +
      '    <div class="jo-header">Type</div><div class="jo-header">Win</div>' +
      '    <div class="jo-header">Uniq</div><div class="jo-header">Coin</div>' +
      '    <div class="jo-header">Tkts</div><div class="jo-header">ETH</div>' +
      '    <div class="jo-header">Spread</div>' +
      '  </div>' +
      '  <div id="' + sel.roll2FarEmpty.replace('#', '') + '" class="jo-empty" style="display:none;">No far-future wins.</div>' +
      '</div>';
    var overview = $(sel.jackpotOverview);
    if (overview && overview.parentNode) {
      overview.parentNode.insertBefore(panel, overview);
    } else {
      var wrap = $(sel.demoWrap);
      if (wrap) wrap.appendChild(panel);
      else if (root.body) root.body.appendChild(panel);
      else root.appendChild(panel);
    }
  }

  function _clearRoll2Grid(gridSelector) {
    var grid = $(gridSelector);
    if (!grid) return;
    var children = Array.prototype.slice.call(grid.children);
    for (var i = 0; i < children.length; i++) {
      if (!children[i].classList.contains('jo-header')) grid.removeChild(children[i]);
    }
  }

  function _hideRoll2Panel() {
    var panel = $(sel.roll2Panel);
    if (panel) panel.style.display = 'none';
  }

  // ------------------------------------------------------------------
  // _isZeroPrizeRow — true when a row has no prizes assigned at all.
  // Zero-prize rows (ethPerWinner=0, coinPerWinner=0, ticketsPerWinner=0)
  // carry no actionable information and should not be rendered in the grid.
  // ------------------------------------------------------------------

  function _isZeroPrizeRow(row) {
    if (!row) return true;
    var eth  = row.ethPerWinner;
    var coin = row.coinPerWinner;
    var tkts = row.ticketsPerWinner;
    var hasEth  = eth  && eth  !== '0';
    var hasCoin = coin && coin !== '0';
    var hasTkts = tkts && tkts !== 0;
    return !hasEth && !hasCoin && !hasTkts;
  }

  // ------------------------------------------------------------------
  // appendOverviewRow — shared by renderOverview and renderRoll2
  // (ported from jackpot-demo.html lines 1896-1952)
  // ------------------------------------------------------------------

  function _appendOverviewRow(grid, row) {
    var isBonus = row.type === 'bonus';

    var typeCell = document.createElement('div');
    typeCell.className = 'jo-type-badge' + (isBonus ? ' jo-bonus' : '');
    if (isBonus) {
      typeCell.textContent = 'Bonus';
    } else {
      var t = row.traitId | 0;
      var q = Math.floor(t / 64);
      var sym = Math.floor((t % 64) / 8);
      var col = t % 8;
      var img = document.createElement('img');
      img.src = joBadgePath(q, sym, col);
      img.alt = JO_SYMBOLS[JO_CATEGORIES[q]][sym];
      typeCell.appendChild(img);
    }

    var winCell = document.createElement('div');
    winCell.className = 'jo-winners';
    winCell.textContent = String(row.winnerCount);

    var uniqCell = document.createElement('div');
    uniqCell.className = 'jo-unique';
    uniqCell.textContent = String(row.uniqueWinnerCount);

    var coinCell = document.createElement('div');
    coinCell.className = 'jo-coin';
    coinCell.textContent = (!row.coinPerWinner || row.coinPerWinner === '0') ? '\u2014' : joFormatCoin(row.coinPerWinner);

    var tktCell = document.createElement('div');
    tktCell.className = 'jo-tickets';
    tktCell.textContent = row.ticketsPerWinner ? String(row.ticketsPerWinner) : '\u2014';

    var ethCell = document.createElement('div');
    ethCell.className = 'jo-eth';
    ethCell.textContent = (!row.ethPerWinner || row.ethPerWinner === '0') ? '\u2014' : joFormatWeiToEth(row.ethPerWinner);

    var spreadCell = document.createElement('div');
    spreadCell.className = 'jo-spread';
    var buckets = Array.isArray(row.spreadBuckets) ? row.spreadBuckets : [false, false, false];
    for (var b = 0; b < 3; b++) {
      var bar = document.createElement('div');
      bar.className = 'jo-spread-bar' + (buckets[b] ? ' active' : '');
      spreadCell.appendChild(bar);
    }

    var rowEl = document.createElement('div');
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

  // ------------------------------------------------------------------
  // renderRoll2 — public method (ported from renderRoll2Subsections, lines 1632-1656)
  // ------------------------------------------------------------------

  function renderRoll2(roll2) {
    _ensureRoll2Container();
    var panel = $(sel.roll2Panel);
    if (panel) panel.style.display = 'block';
    var future = (roll2 && roll2.future) || [];
    var farFuture = (roll2 && roll2.farFuture) || [];
    _clearRoll2Grid(sel.roll2FutureGrid);
    _clearRoll2Grid(sel.roll2FarGrid);
    var fGrid = $(sel.roll2FutureGrid);
    var ffGrid = $(sel.roll2FarGrid);
    var fEmpty = $(sel.roll2FutureEmpty);
    var ffEmpty = $(sel.roll2FarEmpty);
    var futureFiltered = future.filter(function(r) { return !_isZeroPrizeRow(r); });
    var farFiltered    = farFuture.filter(function(r) { return !_isZeroPrizeRow(r); });
    if (futureFiltered.length === 0) {
      if (fEmpty) fEmpty.style.display = 'block';
    } else {
      if (fEmpty) fEmpty.style.display = 'none';
      for (var i = 0; i < futureFiltered.length; i++) _appendOverviewRow(fGrid, futureFiltered[i]);
    }
    if (farFiltered.length === 0) {
      if (ffEmpty) ffEmpty.style.display = 'block';
    } else {
      if (ffEmpty) ffEmpty.style.display = 'none';
      for (var j = 0; j < farFiltered.length; j++) _appendOverviewRow(ffGrid, farFiltered[j]);
    }
  }

  // ------------------------------------------------------------------
  // cancelPendingFlashes — Pitfall 6 guard (plan Task 1 item 4)
  // ------------------------------------------------------------------

  function cancelPendingFlashes() {
    if (pendingFlashTimer !== null) {
      _clearTimeout(pendingFlashTimer);
      pendingFlashTimer = null;
    }
  }

  // ------------------------------------------------------------------
  // flashNoBonus — transient 500ms button label flash (demo line 1664)
  // ------------------------------------------------------------------

  function _flashNoBonus(btn, ms) {
    cancelPendingFlashes(); // clear any prior pending flash first
    btn.textContent = 'No bonus';
    btn.disabled = true;
    pendingFlashTimer = _setTimeout(function () {
      pendingFlashTimer = null;
      btn.textContent = 'Next Day \u2192';
      btn.disabled = false;
    }, ms);
  }

  // ------------------------------------------------------------------
  // renderOverview — public method (ported from renderJackpotOverview, demo lines 1850-1894)
  // Accepts optional day parameter; when omitted, derives level from apiBase call.
  // ------------------------------------------------------------------

  function renderOverview(level, day) {
    var grid = $(sel.joGrid);
    var status = $(sel.joStatus);
    var ffNote = $(sel.joFarFuture);
    if (!grid || !status) return;

    // Clear previous rows (keep .jo-header children)
    var children = Array.prototype.slice.call(grid.children);
    for (var i = 0; i < children.length; i++) {
      if (!children[i].classList.contains('jo-header')) grid.removeChild(children[i]);
    }
    if (ffNote) ffNote.style.display = 'none';
    status.className = 'jo-loading';
    status.textContent = 'Loading...';
    status.style.display = 'block';

    var token = ++joRenderToken;

    // Build URL: level-keyed endpoint (day-keyed variant deferred per D-04 amendment)
    var url = apiBase + '/game/jackpot/' + level + '/overview';

    _fetch(url).then(function(r) {
      if (!r.ok && r.status !== 404) throw new Error('HTTP ' + r.status);
      if (r.status === 404) return { level: level, day: day || null, farFutureResolved: false, rows: [] };
      return r.json();
    }).then(function(data) {
      if (token !== joRenderToken) return; // stale response — superseded
      if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
        status.className = 'jo-empty';
        status.textContent = 'No jackpot draws for this day.';
        if (ffNote) ffNote.style.display = (data && data.farFutureResolved) ? 'block' : 'none';
        return;
      }
      status.style.display = 'none';
      var visibleRows = 0;
      for (var j = 0; j < data.rows.length; j++) {
        if (_isZeroPrizeRow(data.rows[j])) continue; // skip zero-prize rows — no info to show
        _appendOverviewRow(grid, data.rows[j]);
        visibleRows++;
      }
      if (visibleRows === 0) {
        status.className = 'jo-empty';
        status.textContent = 'No jackpot draws for this day.';
        status.style.display = 'block';
      }
      if (ffNote) ffNote.style.display = data.farFutureResolved ? 'block' : 'none';
    }).catch(function(err) {
      if (token !== joRenderToken) return;
      console.error('[jo] fetch failed', err);
      status.className = 'jo-empty';
      status.textContent = 'Could not load jackpot data. Try advancing to another day.';
      if (ffNote) ffNote.style.display = 'none';
    });
  }

  // ------------------------------------------------------------------
  // waitForRevealCompleteAndSetLabel — button state poller
  // (ported from demo lines 1716-1736; internal only, called by preFlightAndRunPlayer)
  // ------------------------------------------------------------------

  function _waitForRevealCompleteAndSetLabel(currentRevealRef) {
    var btn = $(sel.rollBtn);
    if (!btn) return;
    var start = Date.now();
    function tick() {
      if (!btn.disabled) {
        if (currentRevealRef.value === 'roll1') {
          btn.textContent = 'Next';
          rollPhase = 'roll1';
        } else if (currentRevealRef.value === 'roll2') {
          btn.textContent = 'Next Day \u2192';
          rollPhase = 'done';
        }
        currentRevealRef.value = null;
        return;
      }
      if (Date.now() - start > 30000) return; // safety timeout
      _setTimeout(tick, 80);
    }
    _setTimeout(tick, 80);
  }

  // ------------------------------------------------------------------
  // preFlightAndRunPlayer — public method
  // (ported from preFlightAndRunDay, demo lines 1674-1707)
  //
  // args.level  — jackpot emission level
  // args.addr   — player address (may be empty string for no-player path)
  // args.onData — optional callback(data) invoked on successful pre-flight
  //               (used to wire the demo's runDay() + renderJackpotOverview())
  //
  // The caller is responsible for triggering the Roll 1 reveal animation via
  // onData (or by wiring the returned controller methods). The factory owns
  // only the state-machine and Roll 2 rendering; Roll 1 animation lives in the
  // demo's existing pipeline which is NOT extracted (out-of-scope per plan).
  // ------------------------------------------------------------------

  function preFlightAndRunPlayer({ level, day, addr, onData }) {
    var token = ++playerDataToken;
    _hideRoll2Panel();
    rollPhase = 'idle';

    // currentReveal is a mutable boxed reference shared with the poller.
    var currentRevealRef = { value: 'roll1' };

    function applyDataAndRun(data) {
      if (token !== playerDataToken) return; // superseded by a newer call
      playerData = data;

      // Invoke consumer's Roll 1 handler (e.g. demo's runDay + renderJackpotOverview)
      if (typeof onData === 'function') onData(data, currentRevealRef);

      var btn = $(sel.rollBtn);
      if (btn) btn.textContent = 'Roll';
    }

    if (!addr) {
      applyDataAndRun({ level: level, player: '', roll1Rows: [], roll2: { future: [], farFuture: [] }, hasBonus: false });
      return;
    }

    var url = apiBase + '/game/jackpot/' + level + '/player/' + addr;
    _fetch(url).then(function(r) {
      if (!r.ok) return { level: level, player: addr, roll1Rows: [], roll2: { future: [], farFuture: [] }, hasBonus: false };
      return r.json();
    }).then(function(data) {
      applyDataAndRun(data || { level: level, player: addr, roll1Rows: [], roll2: { future: [], farFuture: [] }, hasBonus: false });
    }).catch(function() {
      applyDataAndRun({ level: level, player: addr, roll1Rows: [], roll2: { future: [], farFuture: [] }, hasBonus: false });
    });
  }

  // ------------------------------------------------------------------
  // Button state machine click handler — attaches to rollBtn once.
  // Called by consumers after instantiation to wire the two-phase flow.
  //
  // The state machine matches the demo's behaviour exactly:
  //   Next Day → Roll → Next → Roll Bonus → Next Day
  //
  // Consumers must call attachButtonStateMachine({ getLevel, getAddr, onAdvance })
  // to bind the machine to their data sources.
  //
  // getLevel()  -> current jackpot level (number)
  // getAddr()   -> currently selected player address (string)
  // onAdvance() -> called when "Next Day" is clicked (i.e. advance to next day/player)
  // ------------------------------------------------------------------

  function attachButtonStateMachine({ getLevel, getAddr, onAdvance, onData }) {
    var btn = $(sel.rollBtn);
    if (!btn) return;

    var started = false;

    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      // Note: the demo checks `spinning` here via a closure; consumers may pass
      // an isSpinning() getter via selectors if needed. Omitted by default —
      // the button is disabled during spin, which is the primary guard.

      if (!started) {
        started = true;
        var currentRevealRef = { value: 'roll1' };
        preFlightAndRunPlayer({ level: getLevel(), addr: getAddr(), onData: function(data, ref) {
          if (typeof onData === 'function') onData(data);
          // Merge the ref from preFlightAndRunPlayer's closure
          if (ref) currentRevealRef = ref;
          _waitForRevealCompleteAndSetLabel(currentRevealRef);
        }});
        return;
      }

      if (rollPhase === 'roll1') {
        if (playerData && playerData.hasBonus) {
          _hideRoll2Panel();
          rollPhase = 'roll2';
          btn.textContent = 'Roll Bonus';
        } else {
          rollPhase = 'done';
          _flashNoBonus(btn, 500);
        }
        return;
      }

      if (rollPhase === 'roll2') {
        btn.disabled = true;
        var flame = $(sel.demoCenterFlame);
        if (flame) flame.classList.add('spinning');
        _setTimeout(function () {
          try {
            if (flame) flame.classList.remove('spinning');
            renderRoll2((playerData && playerData.roll2) || { future: [], farFuture: [] });
          } catch (e) { console.error('[roll2] render failed:', e); }
          btn.textContent = 'Next Day \u2192';
          rollPhase = 'done';
          btn.disabled = false;
        }, 900);
        return;
      }

      if (rollPhase === 'done' || rollPhase === 'idle') {
        if (typeof onAdvance === 'function') onAdvance();
      }
    });
  }

  // ------------------------------------------------------------------
  // dispose — clear timers and null refs; call on disconnectedCallback
  // ------------------------------------------------------------------

  function dispose() {
    cancelPendingFlashes();
    playerData = null;
    rollPhase = 'idle';
  }

  // ------------------------------------------------------------------
  // Assemble controller
  // ------------------------------------------------------------------

  var controller = {
    preFlightAndRunPlayer: preFlightAndRunPlayer,
    renderOverview:        renderOverview,
    renderRoll2:           renderRoll2,
    cancelPendingFlashes:  cancelPendingFlashes,
    attachButtonStateMachine: attachButtonStateMachine,
    dispose:               dispose
  };

  // Test seam — only attached when flag is set; zero production overhead otherwise.
  if (typeof globalThis !== 'undefined' && globalThis.__JACKPOT_ROLLS_TEST__ === true) {
    Object.defineProperty(controller, '_internals', {
      enumerable: false,
      value: {
        getPlayerDataToken: function () { return playerDataToken; },
        getPendingFlashTimer: function () { return pendingFlashTimer; },
        getPlayerData: function () { return playerData; },
        getRollPhase: function () { return rollPhase; },
        _setFetch: function (fn) { _testFetch = fn; },
        _setTimerFactory: function (fn) { _testTimerFactory = fn; }
      }
    });
  }

  return controller;
}
