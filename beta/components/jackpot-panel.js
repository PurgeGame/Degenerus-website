// components/jackpot-panel.js -- Jackpot panel Custom Element
// Animated sequential trait reveal, pool/day/allocation display, badge visualization, confetti celebration.
// All data transformation delegated to jackpot-data.js.

import { subscribe, get } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { deriveWinningTraits, traitToBadge, estimateAllocation } from '../app/jackpot-data.js';
import { formatEth } from '../app/utils.js';
import { playSound } from '../app/audio.js';

class JackpotPanel extends HTMLElement {
  #unsubs = [];
  #revealPlayed = false;
  #currentRngWord = null;
  #timeline = null;
  #loaded = false;

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
      </div>
      </div>
    `;

    // Preload GSAP when panel mounts (avoids jank on first reveal)
    import('gsap').catch(() => {});

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

    // Check for RNG reveal trigger:
    // When phase is JACKPOT and rngLocked transitions from true to false, RNG is resolved.
    // We check for dailyRng.finalWord in game state (populated by API extension when available).
    // Primary path: fetch event-sourced distributions from /game/jackpot/:level (TEST-02).
    // Fallback: derive from RNG word if API unavailable.
    const rngWord = game.dailyRng?.finalWord || null;
    if (game.phase === 'JACKPOT' && rngWord && rngWord !== '0' && rngWord !== this.#currentRngWord) {
      this.#currentRngWord = rngWord;
      this.#revealPlayed = false;
      // Try to fetch actual event-sourced distributions from API
      try {
        const data = await fetchJSON(`/game/jackpot/${game.level}`);
        this.#triggerReveal(rngWord, data.distributions);
      } catch {
        // API unavailable or 404 -- fall back to RNG derivation
        this.#triggerReveal(rngWord);
      }
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
