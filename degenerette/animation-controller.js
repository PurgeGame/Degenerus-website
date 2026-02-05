/**
 * Degenerette Enhanced Animation Controller
 * Adds visual polish to house token reveals and match celebrations
 */

(function() {
  'use strict';

  // ===== PARTICLE SYSTEM =====
  class ParticleSystem {
    constructor() {
      this.container = null;
      this.init();
    }

    init() {
      this.container = document.createElement('div');
      this.container.className = 'particle-container';
      document.body.appendChild(this.container);
    }

    burst(x, y, count = 20, options = {}) {
      const { color = 'purple', star = false } = options;

      for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = star ? 'particle star' : 'particle';

        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
        const velocity = 80 + Math.random() * 120;
        const tx = Math.cos(angle) * velocity;
        const ty = Math.sin(angle) * velocity - 20; // Slight upward bias
        const duration = 0.6 + Math.random() * 0.4;

        particle.style.setProperty('--tx', `${tx}px`);
        particle.style.setProperty('--ty', `${ty}px`);
        particle.style.setProperty('--duration', `${duration}s`);
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;

        if (color === 'gold') {
          particle.style.background = 'radial-gradient(circle, #fef3c7 0%, #fbbf24 100%)';
          particle.style.boxShadow = '0 0 10px rgba(251, 191, 36, 0.9)';
        } else if (color === 'green') {
          particle.style.background = 'radial-gradient(circle, #bbf7d0 0%, #22c55e 100%)';
          particle.style.boxShadow = '0 0 10px rgba(34, 197, 94, 0.9)';
        }

        this.container.appendChild(particle);

        setTimeout(() => particle.remove(), duration * 1000);
      }
    }

    celebrate(element, type = 'win') {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      if (type === 'jackpot') {
        // Multiple bursts for jackpot
        this.burst(centerX, centerY, 30, { color: 'gold', star: true });
        setTimeout(() => this.burst(centerX - 40, centerY - 20, 15, { color: 'gold' }), 100);
        setTimeout(() => this.burst(centerX + 40, centerY - 20, 15, { color: 'gold' }), 200);
      } else if (type === 'special') {
        this.burst(centerX, centerY, 25, { color: 'purple' });
      } else {
        this.burst(centerX, centerY, 15, { color: 'green' });
      }
    }
  }

  // ===== WIN CELEBRATION =====
  class WinCelebration {
    show(text, isJackpot = false) {
      const overlay = document.createElement('div');
      overlay.className = 'win-celebration';

      const textEl = document.createElement('div');
      textEl.className = isJackpot ? 'win-text jackpot' : 'win-text';
      textEl.textContent = text;

      overlay.appendChild(textEl);
      document.body.appendChild(overlay);

      setTimeout(() => overlay.remove(), isJackpot ? 1500 : 1000);
    }
  }

  // ===== ANIMATION CONTROLLER =====
  class AnimationController {
    constructor() {
      this.particles = new ParticleSystem();
      this.celebration = new WinCelebration();
      this.observer = null;
      this.lastHouseState = null;
      this.revealedQuadrants = new Set();
      this.isAnimating = false;
      this.hasCelebrated = false;

      this.init();
    }

    init() {
      // Watch for changes to the house token
      this.setupObserver();

      // Patch the spin button for shimmer effect
      this.enhanceSpinButton();

      console.log('[AnimationController] Initialized');
    }

    setupObserver() {
      const houseContainer = document.getElementById('ft-house');
      if (!houseContainer) {
        // Retry after DOM is ready
        setTimeout(() => this.setupObserver(), 100);
        return;
      }

      this.observer = new MutationObserver((mutations) => {
        this.onHouseChanged(mutations);
      });

      this.observer.observe(houseContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'src']
      });
    }

    onHouseChanged(mutations) {
      const houseEl = document.getElementById('ft-house');
      if (!houseEl) return;

      const gamepiece = houseEl.querySelector('.gamepiece-result');
      if (!gamepiece) return;

      // Check for empty state (waiting for reveal)
      const isEmpty = gamepiece.classList.contains('is-empty');

      if (isEmpty && this.lastHouseState !== 'empty') {
        // Starting new spin - reset state
        this.revealedQuadrants.clear();
        this.isAnimating = true;
        this.hasCelebrated = false;
        this.lastHouseState = 'empty';
        return;
      }

      if (!isEmpty && this.isAnimating && !this.hasCelebrated) {
        // Token is being revealed
        this.handleReveal(gamepiece);
      }
    }

    handleReveal(gamepiece) {
      const quadrants = gamepiece.querySelectorAll('.gp-quadrant');

      quadrants.forEach((q, index) => {
        const hasContent = q.querySelector('.gamepiece-badge');
        const wasRevealed = this.revealedQuadrants.has(index);

        if (hasContent && !wasRevealed) {
          // This quadrant was just revealed
          this.revealedQuadrants.add(index);

          // Add reveal animation
          q.classList.add('revealing');
          setTimeout(() => q.classList.remove('revealing'), 600);
        }
      });

      // Check for special token reveal
      const specialContainer = gamepiece.querySelector('.gamepiece-special-container');
      if (specialContainer) {
        const specialIcon = specialContainer.querySelector('.gamepiece-special-icon');
        const wasSpecialRevealed = this.revealedQuadrants.has('special');

        if (specialIcon && !wasSpecialRevealed && specialIcon.src && !specialIcon.src.includes('none')) {
          this.revealedQuadrants.add('special');
          specialContainer.classList.add('revealing');
          setTimeout(() => specialContainer.classList.remove('revealing'), 900);
        }
      }

      // Check for match celebrations
      this.checkForMatches(gamepiece);
    }

    checkForMatches(gamepiece) {
      // Only celebrate once per spin
      if (this.hasCelebrated) return;

      // Small delay to let the DOM settle
      setTimeout(() => {
        const quadrants = gamepiece.querySelectorAll('.gp-quadrant');
        let fullMatches = 0;
        let partialMatches = 0;

        quadrants.forEach(q => {
          if (q.classList.contains('q-both-match')) {
            fullMatches++;
          } else if (q.classList.contains('q-partial-match')) {
            partialMatches++;
          }
        });

        const specialContainer = gamepiece.querySelector('.gamepiece-special-container');
        const hasSpecialMatch = specialContainer?.classList.contains('special-match');

        // Determine celebration level
        const totalMatches = fullMatches * 2 + partialMatches;

        // Only do particles/text celebration once
        if (!this.hasCelebrated && this.revealedQuadrants.size >= 5) {
          this.hasCelebrated = true;

          if (hasSpecialMatch || totalMatches >= 8) {
            // Jackpot or near-jackpot!
            this.particles.celebrate(gamepiece, 'jackpot');
            this.celebration.show(hasSpecialMatch ? 'SPECIAL!' : 'JACKPOT!', true);
          } else if (fullMatches >= 3 || totalMatches >= 6) {
            // Big win
            this.particles.celebrate(gamepiece, 'win');
            this.celebration.show('BIG WIN!');
          } else if (totalMatches >= 4) {
            // Nice win - just particles, no text
            this.particles.celebrate(gamepiece, 'win');
          }

          this.isAnimating = false;
        }

        this.lastHouseState = 'revealed';
      }, 100);
    }

    enhanceSpinButton() {
      const spinBtn = document.getElementById('spin-full');
      if (!spinBtn) {
        setTimeout(() => this.enhanceSpinButton(), 100);
        return;
      }

      // Watch for text changes to detect spinning state
      const originalOnClick = spinBtn.onclick;

      const textObserver = new MutationObserver(() => {
        const text = spinBtn.textContent?.trim().toUpperCase();
        if (text === 'SKIP') {
          spinBtn.classList.add('spinning');
        } else {
          spinBtn.classList.remove('spinning');
        }
      });

      textObserver.observe(spinBtn, { childList: true, characterData: true, subtree: true });
    }
  }

  // Hover effects removed for cleaner feel
  function setupQuadrantHoverEffects() {}

  // ===== RANDOM BUTTON =====
  class RandomizeController {
    constructor() {
      this.init();
    }

    init() {
      this.addRandomButton();
    }

    addRandomButton() {
      const selectionActions = document.querySelector('.selection-actions');
      if (!selectionActions) {
        setTimeout(() => this.addRandomButton(), 100);
        return;
      }

      const btn = document.createElement('button');
      btn.id = 'random-btn';
      btn.className = 'secondary-button random-button';
      btn.textContent = 'Random';
      btn.title = 'Randomize your token';

      btn.addEventListener('click', () => {
        if (window.__DEGEN__?.randomize) {
          window.__DEGEN__.randomize();
        }
      });

      selectionActions.insertBefore(btn, selectionActions.firstChild);
    }
  }

  // ===== INITIALIZATION =====
  function init() {
    // Wait for DOM
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        new AnimationController();
        setupQuadrantHoverEffects();
        new RandomizeController();
      });
    } else {
      new AnimationController();
      setupQuadrantHoverEffects();
      new RandomizeController();
    }
  }

  init();
})();
