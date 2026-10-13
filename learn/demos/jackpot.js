// /learn/demos/jackpot.js: embeddable demo of the app's current Daily Drawing.
//
// It mounts the app's real <replay-panel single-button> inside the same
// .jackpot-hero__machine markup index.html uses, and feeds it canned draws
// through the panel's tutorial-fixture hook. No wallet, no RPC, no indexer.
//
// Classic script on purpose: an import map is ignored once any module has
// started loading, and this page needs to install the app's own map first so
// every /app/ module is requested under the same ?v= URL the app uses.
(function () {
  'use strict';

  var APP_SHELL = '/app/index.html';
  // Stylesheets of the app shell that the machine needs, in the app's order.
  // Matched by file name against the shell's own <link> list so the ?v= suffixes
  // stay identical to the app's; these bare paths are the fallback.
  var STYLES = [
    '/shared/nav.css', '/app/styles/base.css', '/app/styles/panels.css',
    '/app/styles/buttons.css', '/app/styles/skeleton.css', '/app/styles/forms.css',
    '/app/styles/jackpot.css', '/app/styles/replay.css', '/app/styles/app.min.css',
    '/app/styles/daily-drawing.css', '/app/styles/jackpot-processing.css',
  ];
  var PLAYER = '0x0000000000000000000000000000000000000001';
  var OTHER = ['0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000003'];

  var $ = function (bind) { return document.querySelector('[data-bind="' + bind + '"]'); };
  var machine = $('machine');
  var hintEl = $('hint');
  var runBtn = $('run');
  var muteBtn = $('mute');
  var styleTag = document.getElementById('demo-style');

  // ---- isolation -----------------------------------------------------------
  // Same-origin storage is shared with /app/. Keep this page's reads and writes
  // (sound mute, UI preferences) in memory so the demo never changes the real
  // app's settings.
  var restoreStorage = function () {};
  (function isolateStorage() {
    var data = {};
    var shim = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[k]; },
      clear: function () { data = {}; },
      key: function (i) { return Object.keys(data)[i] || null; },
      get length() { return Object.keys(data).length; },
    };
    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: shim });
      if (window.localStorage === shim) return;
    } catch (e) { /* fall through to the save-and-restore path */ }
    // Browser refused the override: touch only the mute key, and put it back.
    var KEY = 'degenerus.sfxMuted';
    var before = null;
    try { before = localStorage.getItem(KEY); } catch (e) { return; }
    restoreStorage = function () {
      try {
        if (before === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, before);
      } catch (e) { /* storage unavailable */ }
    };
    window.addEventListener('pagehide', restoreStorage);
  })();

  // Static files only: anything cross-origin, or not a GET/HEAD, is refused.
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (url.origin !== location.origin || (method !== 'GET' && method !== 'HEAD')) {
        return Promise.reject(new TypeError('Offline demo: network request blocked'));
      }
    } catch (e) { return Promise.reject(new TypeError('Offline demo: bad request')); }
    return realFetch(input, init);
  };

  // ---- app shell: import map + stylesheet URLs -----------------------------
  function loadShell() {
    return realFetch(APP_SHELL).then(function (res) {
      if (!res.ok) throw new Error('shell ' + res.status);
      return res.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var mapEl = doc.querySelector('script[type="importmap"]');
      var map = mapEl ? JSON.parse(mapEl.textContent) : { imports: {} };
      var hrefs = {};
      doc.querySelectorAll('link[rel="stylesheet"][href]').forEach(function (l) {
        var href = l.getAttribute('href');
        hrefs[href.split('?')[0]] = href;
      });
      return { map: map, hrefs: hrefs };
    }).catch(function () { return { map: { imports: {} }, hrefs: {} }; });
  }

  function installImportMap(map) {
    map.imports = map.imports || {};
    // The panel lazily imports the chain reader for its startup day-list read.
    map.imports['/app/chain/router.js'] = '/learn/demos/jackpot-offline.js';
    var tag = document.createElement('script');
    tag.type = 'importmap';
    tag.textContent = JSON.stringify(map);
    document.head.appendChild(tag);
  }

  function loadStyles(hrefs) {
    var waits = STYLES.map(function (path) {
      return new Promise(function (resolve) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = hrefs[path] || path;
        link.onload = link.onerror = function () { resolve(); };
        styleTag.parentNode.insertBefore(link, styleTag);
      });
    });
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 6000); });
    return Promise.race([Promise.all(waits), timeout]);
  }

  // ---- canned draws --------------------------------------------------------
  // Quadrant N owns trait ids [64N, 64N + 63]. For each quadrant the outcome is
  // set by ownership and by the win rows behind it:
  //   not owned, no win               -> dull miss
  //   owned, nobody wins              -> near miss
  //   the player wins, 2+ rows        -> shared win
  //   the player wins, exactly 1 row  -> solo win (the gold pop)
    function buildDeck(ETH_DIVISOR) {
    var eth = function (n) { return String(BigInt(Math.round(n * 1e6)) * 10n ** 12n / ETH_DIVISOR); };
    var flip = function (n) { return String(BigInt(Math.round(n * 1e6)) * 10n ** 12n); };
    var win = function (winner, traitId, amount, awardType) {
      return { winner: winner, traitId: traitId, amount: amount, awardType: awardType };
    };
    var base = function (o) {
      return Object.assign({
        day: 42, level: 3, purchaseLevel: 3, player: PLAYER, dayInPhase: 5, entryCount: 8, bonusTraitDraw: false,
        playerTraits: [], futureTraits: [], roll1Wins: [], roll2Wins: [],
      }, o);
    };
    return [
      {
        recap: 'This draw: a shared ETH win and a solo ETH win.',
        fixture: base({
          mainTraits: [10, 70, 140, 200], bonusTraits: [20, 80, 150, 210],
          playerTraits: [70, 140, 200],
          roll1Wins: [
            win(PLAYER, 140, eth(0.24), 'eth'), win(OTHER[0], 140, eth(0.16), 'eth'),
            win(PLAYER, 200, eth(0.62), 'eth'),
          ],
          roll2Wins: [],
        }),
      },
      {
        recap: 'This draw: two solo ETH wins and a near miss.',
        fixture: base({
          mainTraits: [27, 85, 163, 226], bonusTraits: [41, 98, 171, 238],
          playerTraits: [27, 85, 163],
          roll1Wins: [win(PLAYER, 27, eth(0.48), 'eth'), win(PLAYER, 163, eth(0.31), 'eth')],
          roll2Wins: [],
        }),
      },
      {
        recap: 'This draw: a three-way split, a solo ETH win, and the rest miss.',
        fixture: base({
          mainTraits: [5, 109, 133, 236], bonusTraits: [14, 74, 172, 215],
          playerTraits: [5, 109, 236],
          roll1Wins: [
            win(PLAYER, 5, eth(0.2), 'eth'), win(OTHER[0], 5, eth(0.2), 'eth'),
            win(OTHER[1], 5, eth(0.14), 'eth'),
            win(PLAYER, 236, eth(0.55), 'eth'),
          ],
          roll2Wins: [],
        }),
      },
    ];
  }

  // ---- demo controller -----------------------------------------------------
  function start(sfx, deck) {
    var panel = null;
    var deckIndex = 0;
    var current = null;
    var started = false;   // the current panel has been spun at least once
    var finished = false;
    var muted = true;

    function setHint(text) { hintEl.textContent = text; }

    function measure() {
      var main = document.querySelector('[data-bind="demo"]');
      document.documentElement.dataset.naturalHeight = String(Math.ceil(main.getBoundingClientRect().height));
    }

    function applyMute() {
      sfx.setMuted(muted);
      muteBtn.textContent = muted ? 'Sound off' : 'Sound on';
      muteBtn.setAttribute('aria-pressed', String(muted));
      muteBtn.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
    }

    function mount(scenario) {
      if (panel) panel.remove();
      current = scenario;
      started = false;
      finished = false;
      panel = document.createElement('replay-panel');
      panel.setAttribute('single-button', '');
      panel.addEventListener('replay:spin-progress', function () { started = true; });
      panel.addEventListener('replay:spin-complete', function (e) {
        started = true;
        runBtn.textContent = 'Run again';
        setHint('Tap the bubbles to pop them and see what you hit.');
        measure();
      });
      panel.addEventListener('replay:scratch-complete', function (e) {
        finished = true;
        setHint(current.recap + ' Press Run again for a different one.');
        measure();
      });
      machine.appendChild(panel);
      panel.setTutorialFixture(current.fixture);
      measure();
    }

    function pressKey(tries) {
      var key = panel && panel.querySelector('[data-bind="reveal-btn"]');
      if (key && !key.disabled && !key.hidden) { key.click(); return; }
      if (tries > 0) setTimeout(function () { pressKey(tries - 1); }, 50);
    }

    function run() {
      sfx.warmup();
      if (started || finished) {
        deckIndex += 1;
        mount(deck[deckIndex % deck.length]);
      }
      started = true;
      setHint('Drawing the day\'s badges...');
      pressKey(40);
    }

    runBtn.addEventListener('click', run);
    muteBtn.addEventListener('click', function () { muted = !muted; applyMute(); if (!muted) sfx.warmup(); });
    window.addEventListener('resize', measure);

    applyMute();
    mount(deck[0]);
    document.body.classList.remove('is-booting');
    setTimeout(measure, 800);
  }

  function fail(error) {
    if (window.console) console.error('Jackpot demo failed to load', error);
    document.body.classList.remove('is-booting');
    var p = document.createElement('p');
    p.className = 'demo-fail';
    p.innerHTML = 'The demo could not load. <a href="/app/" target="_top">Open the game</a> to see the real thing.';
    document.querySelector('[data-bind="demo"]').replaceChildren(p);
  }

  loadShell().then(function (shell) {
    installImportMap(shell.map);
    return loadStyles(shell.hrefs);
  }).then(function () {
    return Promise.all([
      import('/app/components/replay-panel.js'),
      import('/app/app/jackpot-sfx.js'),
      import('/app/app/chain-config.js'),
    ]);
  }).then(function (mods) {
    start(mods[1], buildDeck(mods[2].ETH_DIVISOR));
  }).catch(fail);
}());
