// Shell for the /learn/craps/ demo: one button, a sound toggle, a status line, and an inner frame that
// holds the app's craps table (see craps-table.js). The inner frame is same-origin; it reports its state,
// the battle's progress and the height of the table card by postMessage, and this page calls its small
// `crapsDemo` API. This page also reports its own drawn height to the embedding page.
(function () {
  'use strict';

  var stage = document.querySelector('[data-bind="stage"]');
  var frame = document.querySelector('[data-bind="table"]');
  var go = document.querySelector('[data-bind="go"]');
  var sound = document.querySelector('[data-bind="sound"]');
  var note = document.querySelector('[data-bind="note"]');
  var bar = document.querySelector('.bar');

  // The table is laid out for a phone (up to 600px wide) or for the 960px desktop layout. Frames
  // wider than a phone run the 960px layout and scale down to fit; phones run it at native size.
  var DESKTOP_WIDTH = 960;
  var PHONE_MAX = 600;
  var PADDING = 10;
  var GAP = 10;
  var cardHeight = 0;
  var facts = null;
  var rolls = 0;
  var current = 'loading';

  var BUTTONS = {
    loading: ['Watch a run', true],
    ready: ['Watch a run', false],
    playing: ['Rolling', true],
    done: ['Run again', false],
    error: ['Watch a run', true]
  };

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
  }

  function describe() {
    if (current === 'error') return 'The recorded battle could not load. Reload the page to try again.';
    if (!facts) return 'Loading the recorded battle.';
    if (current === 'playing') return 'Roll <b>' + rolls + '</b> of ' + facts.rolls;
    if (current === 'done') {
      var money = function (value) { return Number(value).toLocaleString('en-US'); };
      return facts.seat + ' cashed out at ' + money(facts.payout) + ' FLIP on roll ' + facts.rolls +
        (facts.rank ? ' and finished #' + facts.rank + ' of ' + facts.players : '') + '. ' +
        (facts.winner ? facts.winner + ' won the battle and its ' + money(facts.winnerPrize) + ' FLIP prize.' : '');
    }
    return 'A recorded testnet battle: <b>' + facts.players + ' players</b> on one set of dice. You follow ' +
      facts.seat + '.';
  }

  function render() {
    var entry = BUTTONS[current] || BUTTONS.loading;
    go.textContent = entry[0];
    go.disabled = entry[1];
    go.setAttribute('aria-busy', current === 'playing' ? 'true' : 'false');
    note.innerHTML = describe();
    report();
  }

  function api() {
    try { return frame.contentWindow && frame.contentWindow.crapsDemo; }
    catch (_error) { return null; }
  }

  function report() {
    var total = PADDING * 2 + stage.offsetHeight + GAP + bar.offsetHeight + GAP + note.offsetHeight + 2;
    try { window.parent.postMessage({ source: 'craps-demo-embed', height: total }, window.location.origin); }
    catch (_error) { /* standalone */ }
  }

  function layout() {
    var width = stage.clientWidth;
    if (!width) return;
    var inner = width > PHONE_MAX ? DESKTOP_WIDTH : width;
    var scale = width / inner;
    frame.style.width = inner + 'px';
    frame.style.transform = scale === 1 ? '' : 'scale(' + scale + ')';
    frame.style.transformOrigin = 'top left';
    if (cardHeight > 120) stage.style.height = Math.ceil(cardHeight * scale) + 'px';
    report();
  }

  window.addEventListener('resize', layout);

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || data.source !== 'craps-demo') return;
    if (data.type === 'state') {
      current = data.state;
      if (data.facts) facts = data.facts;
      rolls = current === 'playing' ? data.rolls || 0 : 0;
      render();
    } else if (data.type === 'progress') {
      rolls = data.rolls;
      if (current === 'playing') note.innerHTML = describe();
    } else if (data.type === 'height' && data.height > 120) {
      cardHeight = data.height;
      layout();
    }
  });

  go.addEventListener('click', function () {
    var demo = api();
    if (demo) demo.start();
  });

  sound.addEventListener('click', function () {
    var on = sound.getAttribute('aria-pressed') !== 'true';
    sound.setAttribute('aria-pressed', String(on));
    sound.textContent = on ? 'Sound on' : 'Sound off';
    var demo = api();
    if (demo) demo.setSound(on);
  });

  // The inner frame may finish loading before this listener existed; ask for its state once.
  frame.addEventListener('load', function () {
    var demo = api();
    if (demo && demo.getState) { current = demo.getState(); render(); }
    try {
      var card = frame.contentDocument.querySelector('[data-bind="craps-card"]');
      if (card && card.offsetHeight > 120) { cardHeight = card.offsetHeight; layout(); }
    } catch (_error) { /* the message channel still reports it */ }
  });

  render();
  layout();
})();
