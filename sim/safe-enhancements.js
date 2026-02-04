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
      delayMs: 1200,       // Wait for app to settle (increased)
      enabled: true,       // Auto-randomize on load
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
   * Randomize player selection by dispatching wheel events.
   * Synchronous for instant response.
   */
  function randomize() {
    const ftPlayer = $('#ft-player');
    if (!ftPlayer) {
      console.debug('[degen] randomize: #ft-player not found');
      return Promise.resolve();
    }

    // Wait for main app to render gamepiece (has .gp-quadrant elements)
    if (!ftPlayer.querySelector('.gp-quadrant')) {
      console.debug('[degen] randomize: waiting for app to render...');
      return Promise.resolve();
    }

    // Randomize all quadrants synchronously (instant)
    for (let qIdx = 0; qIdx < 4; qIdx++) {
      const q = ftPlayer.querySelector(`.gp-quadrant[data-quadrant="${qIdx}"]`);
      if (!q) continue;

      const rect = q.getBoundingClientRect();
      const colorScrolls = 1 + Math.floor(Math.random() * 7);
      const symbolScrolls = 1 + Math.floor(Math.random() * 7);

      // Color scrolls (outer area)
      for (let i = 0; i < colorScrolls; i++) {
        dispatchWheelEvent(q, rect, true);
      }

      // Symbol scrolls (inner area)
      for (let i = 0; i < symbolScrolls; i++) {
        dispatchWheelEvent(q, rect, false);
      }
    }

    // Randomize special after a tiny delay
    setTimeout(randomizeSpecial, 60);

    console.debug('[degen] Randomized player selection');
    return Promise.resolve();
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

  function randomizeSpecial() {
    const special = $('#ft-player .gamepiece-special-container');
    if (!special) return;

    special.click();

    setTimeout(() => {
      const selector = $('#quick-selector');
      if (!selector || selector.classList.contains('hidden')) return;

      const targetSpecial = 1 + Math.floor(Math.random() * 3);
      const btn = selector.querySelector(`button[data-special="${targetSpecial}"]`);
      if (btn) btn.click();
    }, 40);
  }

  // Expose for manual use
  window.__DEGEN__.randomize = randomize;

  // Wire up randomize button
  function initRandomizeButton() {
    const btn = $('#randomize-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      randomize().finally(() => {
        btn.disabled = false;
      });
    });
  }

  // ===========================================
  // Audio (Lazy-loaded on user gesture)
  // ===========================================

  let audioContext = null;
  let audioBuffers = {};
  let audioInitialized = false;

  // Sound scheme:
  // - match1-match8: Progressive coin sounds (like Mario dragon coins)
  // - win: Victory fanfare
  // - lose: Sad trombone / fail sound
  // - click: UI lock-in click
  const SOUNDS = {
    match1: '/sounds/match1.mp3',
    match2: '/sounds/match2.mp3',
    match3: '/sounds/match3.mp3',
    match4: '/sounds/match4.mp3',
    match5: '/sounds/match5.mp3',
    match6: '/sounds/match6.mp3',
    match7: '/sounds/match7.mp3',
    match8: '/sounds/match8.mp3',
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

  // Fallback tones for match progression (C major scale ascending)
  const MATCH_FREQUENCIES = [262, 294, 330, 349, 392, 440, 494, 523]; // C4 to C5

  function playTone(frequency, duration = 0.15, type = 'square') {
    if (!audioContext) return;
    try {
      if (audioContext.state === 'suspended') audioContext.resume();

      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = type;
      osc.frequency.value = frequency;
      gain.gain.value = CONFIG.audio.volume * 0.3;
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);

      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + duration);
    } catch {
      // Silently fail
    }
  }

  function playSound(name) {
    if (!audioContext) return;

    try {
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }

      // Check for loaded buffer first
      if (audioBuffers[name]) {
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        source.buffer = audioBuffers[name];
        gain.gain.value = CONFIG.audio.volume;
        source.connect(gain);
        gain.connect(audioContext.destination);
        source.start(0);
        return;
      }

      // Fallback: generate tones for match sounds
      const matchNum = name.match(/^match(\d)$/);
      if (matchNum) {
        const idx = parseInt(matchNum[1], 10) - 1;
        if (idx >= 0 && idx < MATCH_FREQUENCIES.length) {
          playTone(MATCH_FREQUENCIES[idx], 0.2, 'square');
        }
        return;
      }

      // Fallback tones for win/lose/click
      if (name === 'win') {
        // Quick arpeggio up
        [0, 2, 4, 7].forEach((n, i) => {
          setTimeout(() => playTone(MATCH_FREQUENCIES[n] * 2, 0.15), i * 80);
        });
      } else if (name === 'lose') {
        // Descending sad tone
        playTone(200, 0.4, 'sawtooth');
      } else if (name === 'click') {
        playTone(800, 0.05, 'square');
      }
    } catch {
      // Silently fail
    }
  }

  /**
   * Play progressive match sounds (like Mario dragon coins)
   * @param {number} matchCount - Number of matches (1-8)
   * @param {number} delayMs - Delay between each sound
   */
  async function playMatchSequence(matchCount, delayMs = 120) {
    if (!audioContext || matchCount < 1) return;

    const count = Math.min(matchCount, 8);
    for (let i = 1; i <= count; i++) {
      playSound(`match${i}`);
      if (i < count) {
        await yieldToMain(delayMs);
      }
    }
  }

  // Expose for manual use
  window.__DEGEN__.playSound = playSound;
  window.__DEGEN__.playMatchSequence = playMatchSequence;
  window.__DEGEN__.initAudio = initAudio;

  // ===========================================
  // Initialization (Safe, Deferred)
  // ===========================================

  function safeInit() {
    // 0. Wire up UI buttons
    initRandomizeButton();

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
