// components/jackpot-panel.js -- Jackpot panel Custom Element
// Animated sequential trait reveal, pool/day/allocation display, badge visualization, confetti celebration.
// All data transformation delegated to jackpot-data.js.
// Plan 03: day scrubber (shared with viewer.html) + winners dropdown above existing 4-card reveal.

import { subscribe, get } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { deriveWinningTraits, traitToBadge, estimateAllocation } from '../app/jackpot-data.js';
import { formatEth } from '../app/utils.js';
import { playSound } from '../app/audio.js';
import { createScrubber } from '../viewer/scrubber.js';

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

        <!-- Plan 03: day scrubber + winners dropdown (above existing 4-card reveal per user addendum A6) -->
        <div class="jp-day-port" data-bind="jp-day-port">
          <div class="jp-day-scrubber" data-bind="jp-day-scrubber"></div>
          <div class="jp-winners">
            <label class="jp-winners-label">Winner</label>
            <select class="jp-winners-select" data-bind="jp-winners-select"></select>
          </div>
          <div class="jp-rolls-slot" data-bind="jp-rolls-slot"></div>
          <details class="jp-overview" data-bind="jp-overview">
            <summary>Day Overview</summary>
            <div class="jp-overview-body" data-bind="jp-overview-body"></div>
          </details>
        </div>

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
      console.error('[jackpot-panel] winners fetch failed:', err);
      if (selectEl) {
        selectEl.disabled = false;
        selectEl.innerHTML = '<option disabled selected>Error loading winners</option>';
      }
      return;
    }

    // Stale-fetch guard — discard if a newer request has been issued since this one started
    if (v !== this.#winnersRequestVersion) return;

    this.#currentDay = day;
    this.#currentLevel = res.level;
    this.#winners = res.winners || [];

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
    this.#onWinnerChange(this.#winners[0].address);
  }

  // Format a winner entry for the dropdown label per D-08:  "0xABCD…1234 — 0.42 ETH"
  #formatWinnerLabel(w) {
    const short = w.address.slice(0, 6) + '…' + w.address.slice(-4);
    const eth = formatEth(w.totalEth);
    return `${short} — ${eth} ETH`;
  }

  // Called when the user picks a different winner from the dropdown (or auto-select on day change).
  // Plan 03: stub — logs the selection. Plan 04 will implement the full two-phase flow.
  #onWinnerChange(address) {
    console.log('[jackpot-panel] winner selected:', address);
    // Plan 04: wire preFlightAndRunPlayer + Roll 1/2 flow here
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
      cardEls.forEach((card, i) => {
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
