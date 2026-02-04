/**
 * Safe Enhancements for Degenerette Simulator
 *
 * Design principles:
 * - Never block main thread
 * - Chunk all heavy operations
 * - Yield between batches
 * - Lazy-load audio on user gesture
 * - Fail silently (no errors that break the app)
 */
(function () {
  'use strict';

  // Expose API for manual triggering
  window.__DEGEN__ = window.__DEGEN__ || {};

  // ===========================================
  // Configuration
  // ===========================================
  const CONFIG = {
    preload: {
      chunkSize: 6,        // Images per batch (conservative)
      chunkDelayMs: 80,    // Yield time between batches
      enabled: true,       // Master switch
    },
    randomize: {
      delayMs: 800,        // Wait for app to settle
      enabled: true,
    },
    audio: {
      enabled: true,
      volume: 0.3,
    },
  };

  // ===========================================
  // Utilities
  // ===========================================

  /** Yields to main thread */
  const yieldToMain = (ms = 0) => new Promise(r => setTimeout(r, ms));

  /** Safe idle callback with timeout */
  const scheduleIdle = (fn, timeoutMs = 3000) => {
    if (window.requestIdleCallback) {
      return requestIdleCallback(fn, { timeout: timeoutMs });
    }
    return setTimeout(fn, 50);
  };

  /** Safe query that won't throw */
  const $ = (sel) => {
    try {
      return document.querySelector(sel);
    } catch {
      return null;
    }
  };

  // ===========================================
  // SVG Preloader (Chunked)
  // ===========================================

  function buildBadgeUrls() {
    const urls = [];
    const colors = ['pink', 'purple', 'green', 'red', 'blue', 'orange', 'silver', 'gold'];
    const categories = {
      crypto: ['xrp', 'tron', 'sui', 'monero', 'solana', 'chainlink', 'ethereum', 'bitcoin'],
      zodiac: ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'libra', 'sagittarius', 'aquarius'],
      cards: ['club', 'diamond', 'heart', 'spade', 'horseshoe', 'cashsack', 'king', 'ace'],
      dice: ['1', '2', '3', '4', '5', '6', '7', '8'],
    };
    const cardOrder = [3, 4, 5, 6, 0, 2, 1, 7];

    for (const [cat, symbols] of Object.entries(categories)) {
      symbols.forEach((sym, idx) => {
        const mapped = cat === 'cards' ? cardOrder[idx] : idx;
        colors.forEach(color => {
          urls.push(`/badges-circular/${cat}_0${mapped}_${sym}_${color}.svg`);
        });
      });
    }

    // Specials
    ['special_eth', 'special_burnie', 'special_burnie_static', 'special_dgnrs', 'special_none'].forEach(s => {
      urls.push(`/specials/${s}.svg`);
    });

    return urls;
  }

  async function preloadBadgesChunked() {
    if (!CONFIG.preload.enabled) return;

    const urls = buildBadgeUrls();
    const { chunkSize, chunkDelayMs } = CONFIG.preload;
    let loaded = 0;

    for (let i = 0; i < urls.length; i += chunkSize) {
      const chunk = urls.slice(i, i + chunkSize);

      chunk.forEach(src => {
        const img = new Image();
        img.decoding = 'async';
        if ('fetchPriority' in img) {
          img.fetchPriority = 'low';
        }
        img.src = src;
        img.onload = () => { loaded++; };
      });

      // Yield to main thread
      await yieldToMain(chunkDelayMs);
    }

    console.debug(`[degen] Preloaded ${loaded}/${urls.length} badges`);
  }

  // Expose for manual use
  window.__DEGEN__.preloadBadges = preloadBadgesChunked;

  // ===========================================
  // Randomizer (Non-blocking)
  // ===========================================

  /**
   * Randomize player selection by directly manipulating the app state
   * via wheel events, but throttled and yielding between each.
   */
  async function randomize() {
    if (!CONFIG.randomize.enabled) return;

    const ftPlayer = $('#ft-player');
    if (!ftPlayer) {
      console.debug('[degen] randomize: #ft-player not found');
      return;
    }

    // Randomize each quadrant with yields between
    for (let qIdx = 0; qIdx < 4; qIdx++) {
      const q = ftPlayer.querySelector(`.gp-quadrant[data-quadrant="${qIdx}"]`);
      if (!q) continue;

      const rect = q.getBoundingClientRect();
      const colorScrolls = 1 + Math.floor(Math.random() * 7);
      const symbolScrolls = 1 + Math.floor(Math.random() * 7);

      // Color scrolls (outer area)
      for (let i = 0; i < colorScrolls; i++) {
        dispatchWheelEvent(q, rect, true);
        await yieldToMain(10); // Small yield between scrolls
      }

      // Symbol scrolls (inner area)
      for (let i = 0; i < symbolScrolls; i++) {
        dispatchWheelEvent(q, rect, false);
        await yieldToMain(10);
      }

      // Yield between quadrants
      await yieldToMain(20);
    }

    // Randomize special (after quadrants settle)
    await yieldToMain(50);
    await randomizeSpecial();

    console.debug('[degen] Randomized player selection');
  }

  function dispatchWheelEvent(element, rect, isColor) {
    const x = isColor ? rect.right - 6 : rect.left + rect.width * 0.3;
    const y = rect.top + rect.height / 2;

    element.dispatchEvent(new WheelEvent('wheel', {
      deltaY: 100,
      clientX: x,
      clientY: y,
      bubbles: true,
    }));
  }

  async function randomizeSpecial() {
    const special = $('#ft-player .gamepiece-special-container');
    if (!special) return;

    special.click();
    await yieldToMain(50);

    const selector = $('#quick-selector');
    if (!selector || selector.classList.contains('hidden')) return;

    const targetSpecial = 1 + Math.floor(Math.random() * 3);
    const btn = selector.querySelector(`button[data-special="${targetSpecial}"]`);
    if (btn) btn.click();
  }

  // Expose for manual use
  window.__DEGEN__.randomize = randomize;

  // ===========================================
  // Audio (Lazy-loaded on user gesture)
  // ===========================================

  let audioContext = null;
  let audioBuffers = {};
  let audioInitialized = false;

  const SOUNDS = {
    spin: '/sounds/spin.mp3',
    win: '/sounds/win.mp3',
    lose: '/sounds/lose.mp3',
    click: '/sounds/click.mp3',
  };

  async function initAudio() {
    if (audioInitialized || !CONFIG.audio.enabled) return;
    audioInitialized = true;

    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // Load sounds lazily in background
      scheduleIdle(() => {
        Object.entries(SOUNDS).forEach(([name, url]) => {
          loadSound(name, url);
        });
      });

      console.debug('[degen] Audio initialized');
    } catch (e) {
      console.debug('[degen] Audio not available:', e.message);
    }
  }

  async function loadSound(name, url) {
    if (!audioContext) return;

    try {
      const response = await fetch(url);
      if (!response.ok) return;

      const arrayBuffer = await response.arrayBuffer();
      audioBuffers[name] = await audioContext.decodeAudioData(arrayBuffer);
    } catch {
      // Silently fail - sounds are optional
    }
  }

  function playSound(name) {
    if (!audioContext || !audioBuffers[name]) return;

    try {
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }

      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();

      source.buffer = audioBuffers[name];
      gain.gain.value = CONFIG.audio.volume;

      source.connect(gain);
      gain.connect(audioContext.destination);
      source.start(0);
    } catch {
      // Silently fail
    }
  }

  // Expose for manual use
  window.__DEGEN__.playSound = playSound;
  window.__DEGEN__.initAudio = initAudio;

  // ===========================================
  // Initialization (Safe, Deferred)
  // ===========================================

  function safeInit() {
    // 1. Audio: Initialize on first user interaction only
    if (CONFIG.audio.enabled) {
      const initOnce = () => {
        initAudio();
        document.removeEventListener('click', initOnce);
        document.removeEventListener('keydown', initOnce);
      };
      document.addEventListener('click', initOnce, { passive: true });
      document.addEventListener('keydown', initOnce, { passive: true });
    }

    // 2. Preload: Start after page is fully loaded and idle
    if (CONFIG.preload.enabled) {
      if (document.readyState === 'complete') {
        scheduleIdle(preloadBadgesChunked, 2000);
      } else {
        window.addEventListener('load', () => {
          scheduleIdle(preloadBadgesChunked, 2000);
        }, { once: true });
      }
    }

    // 3. Randomize: Delay until app has settled
    if (CONFIG.randomize.enabled) {
      setTimeout(() => {
        scheduleIdle(randomize, 1000);
      }, CONFIG.randomize.delayMs);
    }

    console.debug('[degen] Safe enhancements initialized');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInit, { once: true });
  } else {
    // DOM already ready, but yield first
    setTimeout(safeInit, 0);
  }

})();
