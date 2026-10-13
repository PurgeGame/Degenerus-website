import {
  ACTIVE_TICKET_TRAITS, SECOND_ACTIVE_TICKET_TRAITS, COMMON_QUADRANT, SILVER_QUADRANT,
  TUTORIAL_LEVEL, TUTORIAL_PURCHASE_DAY, TUTORIAL_HISTORICAL_DAY,
  TUTORIAL_PLAYER, TUTORIAL_STORAGE_KEY, TUTORIAL_STEPS,
  applyTutorialEvent, createInitialTutorialState, hydrateTutorialState, tutorialJackpotFixture, previousTutorialPage,
} from './tutorial-state.js?v=22';
import { renderBadgeLesson } from './tutorial-traits.js?v=22';

const FRAME_URL = '/app/?as=0x000000000000000000000000000000000000dead&tutorial=1&lesson=22';
const frame = document.querySelector('[data-bind="app-frame"]');
const outer = name => document.querySelector('[data-bind="' + name + '"]');
const formatNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const BADGE_STEPS = new Set(['badge-closeup', 'badge-symbols', 'badge-colors', 'badges']);
let state = loadState();
let frameDocument = null, frameWindow = null, frameReady = false;
let coinAnimating = false, activeRevealKind = null, revealCompleted = false, revealWasOpen = false, revealAborted = false;
let revealMonitorTimer = 0, coinTimer = 0, loadGeneration = 0;
let historicalDayObserver = null, scratchObserver = null, feedbackObserver = null, audioContext = null;
let lastScrolledStep = null;
let restoringPage = false;

function loadState() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.has('restart')) {
      localStorage.removeItem(TUTORIAL_STORAGE_KEY);
      params.delete('restart');
      history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
    }
    return hydrateTutorialState(JSON.parse(localStorage.getItem(TUTORIAL_STORAGE_KEY)));
  } catch { return createInitialTutorialState(); }
}
function saveState() {
  try { localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(state)); } catch {}
}
function currentStep() { return TUTORIAL_STEPS[state.step]; }
function reviewingPage() { return state.step < state.furthestStep; }
function dispatch(event, payload = {}) {
  const previous = state.step;
  state = applyTutorialEvent(state, event, payload);
  saveState();
  render(state.step !== previous);
}
function render(scroll = false) {
  const step = currentStep();
  document.body.dataset.step = step.id;
  document.body.classList.toggle('is-welcome', step.id === 'welcome');
  document.body.classList.toggle('is-badges', BADGE_STEPS.has(step.id));
  setOuterText('coach-step', step.id === 'welcome' ? ''
    : step.id === 'complete' ? 'LESSON COMPLETE' : 'STEP ' + state.step + ' OF ' + (TUTORIAL_STEPS.length - 2));
  outer('coach-step').hidden = step.id === 'welcome';
  setOuterText('coach-title', step.id === 'buy-ticket' && state.draftTickets === 1 ? 'One more ticket.' : step.title);
  outer('coach-title').hidden = step.id === 'welcome';
  setOuterText('coach-copy', step.copy);
  setOuterText('coach-hint', step.id === 'buy-ticket' ? state.draftTickets + ' / 2 tickets' : step.hint);
  outer('coach-hint-area').hidden = !step.hint && step.id !== 'buy-ticket';
  outer('coach-progress').style.width = (state.step / (TUTORIAL_STEPS.length - 1) * 100) + '%';
  const cta = outer('coach-cta');
  cta.disabled = (!step.action && !reviewingPage()) || !frameReady || restoringPage;
  cta.dataset.action = reviewingPage() ? 'next-page' : step.action || '';
  cta.textContent = step.cta || 'Continue';
  const nextLabel = step.cta || (reviewingPage() ? 'Next tutorial page' : 'Complete the highlighted action to continue');
  cta.setAttribute('aria-label', nextLabel);
  cta.title = nextLabel;
  outer('coach-back').disabled = !frameReady || restoringPage || previousTutorialPage(state) == null;
  outer('coach-navigation').hidden = false;
  outer('scratch-accessible').hidden = !step.id.startsWith('scratch-') || reviewingPage();
  const badges = frameQuery('[data-bind="badges"]');
  if (badges) {
    badges.hidden = !BADGE_STEPS.has(step.id);
    if (BADGE_STEPS.has(step.id)) renderBadgeLesson(badges, step.id, state.selectedBadgeId, frameWindow.__DEGENERUS_TUTORIAL_REVEAL__.buildPaperTicket);
  }
  if (frameReady) {
    applyFramePresentation();
    if (scroll) scrollToCurrentTarget();
  }
  const coachHeight = outer('coach').getBoundingClientRect().height + 'px';
  document.documentElement.style.setProperty('--tut-coach-height', coachHeight);
  frameDocument?.documentElement.style.setProperty('--tut-coach-height', coachHeight);
  if (frameReady && !restoringPage && step.id === 'pack' && !activeRevealKind) queueFrameReveal();
}

async function onFrameLoad() {
  const generation = ++loadGeneration;
  try {
    frameDocument = frame.contentDocument; frameWindow = frame.contentWindow;
    if (!frameDocument || frameDocument.location.href === 'about:blank') return;
    frameDocument.documentElement.setAttribute('data-degenerus-tutorial', '');
    // Hiding the first-visit dialog with CSS leaves its body scroll lock active.
    // Removal also cancels a pending show timer, including in cached app code.
    frameDocument.querySelector('app-onboarding')?.remove();
    const style = frameDocument.createElement('link');
    style.rel = 'stylesheet'; style.href = '/learn/tutorial/tutorial-frame.css?v=22';
    frameDocument.head.appendChild(style);
    const traitStyle = frameDocument.createElement('link');
    traitStyle.rel = 'stylesheet'; traitStyle.href = '/learn/tutorial/tutorial-traits.css?v=22';
    frameDocument.head.appendChild(traitStyle);
    frameDocument.body.appendChild(frameDocument.importNode(outer('badges'), true));
    const bridgeScript = frameDocument.createElement('script');
    bridgeScript.type = 'module'; bridgeScript.src = '/learn/tutorial/tutorial-frame.js?v=22';
    frameDocument.head.appendChild(bridgeScript);
    for (let i = 0; i < 150 && !frameWindow.__DEGENERUS_TUTORIAL_REVEAL__; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (generation !== loadGeneration) return;
    }
    if (!frameWindow.__DEGENERUS_TUTORIAL_REVEAL__) throw Error('The game components did not load.');
    freezeLiveFrame();
    frameQuery('.play-grid')?.setAttribute('aria-label', 'Quests');
    frameDocument.addEventListener('click', handleFrameClick, true);
    for (const type of ['pointerdown', 'mousedown', 'mousemove', 'touchstart', 'touchmove', 'keydown', 'submit', 'input', 'change']) {
      frameDocument.addEventListener(type, guardFrameEvent, { capture: true, passive: false });
    }
    frameWindow.addEventListener('scroll', updateSpotlight, { passive: true });
    frameDocument.addEventListener('scroll', updateSpotlight, true);
    frameDocument.addEventListener('degenerus:pack-reveal-complete', event => {
      if (String(event.detail?.address).toLowerCase() === TUTORIAL_PLAYER) revealCompleted = true;
    });
    frameDocument.addEventListener('replay:spin-complete', event => {
      if (restoringPage || reviewingPage()) return;
      if (event.detail?.player !== TUTORIAL_PLAYER || event.detail?.bonusPhase || currentStep().id !== 'main-spin') return;
      dispatch('main-spin-complete');
    });
    scratchObserver = new frameWindow.MutationObserver(() => {
      if (restoringPage || reviewingPage()) return;
      const id = currentStep().id;
      const kind = id === 'scratch-common' ? 'common' : id === 'scratch-silver' ? 'silver' : null;
      if (!kind) return;
      const quadrant = frameQuery('[data-tutorial-quadrant="' + kind + '"]');
      // Wait for the WHOLE cover, not just the first prize badge, to be revealed.
      if (quadrant?.classList.contains('q-result-revealed') && !quadrant.querySelector('.replay-bubble-trigger')) {
        dispatch('scratch-quadrant', { quadrant: kind === 'common' ? COMMON_QUADRANT : SILVER_QUADRANT });
        tone(kind === 'silver' ? 'reveal' : 'tap');
      }
    });
    const replay = frameQuery('replay-panel');
    if (replay) scratchObserver.observe(replay, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    const feedback = frameQuery('[data-bind="qst-complete-toast"]');
    if (feedback) {
      feedbackObserver = new frameWindow.MutationObserver(updateSpotlight);
      feedbackObserver.observe(feedback, { attributes: true, attributeFilter: ['hidden', 'class'] });
    }
    // Reload the exact visited page, including its covered/revealed quadrants.
    restoringPage = true;
    await restoreReplayPage();
    if (generation !== loadGeneration) return;
    restoringPage = false;
    frameReady = true;
    render(true);
    outer('loading').classList.add('is-ready');
    window.dispatchEvent(new Event('degenerus:tutorial-ready'));
    frameWindow.__DEGENERUS_TUTORIAL_REVEAL__.setSound?.(state.sound);
  } catch (error) {
    if (generation !== loadGeneration) return;
    frameReady = false;
    restoringPage = false;
    window.dispatchEvent(new CustomEvent('degenerus:tutorial-error', { detail: error.message }));
  }
}

function paintPracticeBalances() {
  const root = frameQuery('app-decimator-panel');
  if (!root) return;
  setText(root, '[data-bind="dec-funds-wallet"]', formatEth(state.eth));
  setText(root, '[data-bind="dec-funds-total"]', formatNumber.format(state.eth + state.claimableEth));
  setText(root, '[data-bind="dec-funds-claimable"]', formatNumber.format(state.claimableEth));
  setText(root, '[data-bind="dec-flip-balance-value"]', formatNumber.format(state.flip));
  for (const bind of ['dec-funds-faucet', 'dec-error', 'dec-combined-summary']) setHidden(root.querySelector('[data-bind="' + bind + '"]'), true);
  revealTutorialBalance(root, '[data-bind="dec-funds-total-display"]', '[data-bind="dec-funds-total"]', 'dec-funds__display--spoiler');
  revealTutorialBalance(root, '[data-bind="dec-funds-claimable-display"]', '[data-bind="dec-funds-claimable"]', 'dec-funds__display--spoiler');
}

function paintJackpot() {
  const replay = frameQuery('replay-panel');
  if (!replay) return;
  frameQuery('last-day-jackpot')?.removeAttribute('data-day-warming');
  replay.removeAttribute('data-day-warming'); replay.hidden = false;
  setHidden(replay.querySelector('.replay-panel'), false);
  setHidden(replay.querySelector('[data-bind="empty-state"]'), true);
  const inJackpot = ['main-spin', 'scratch-common', 'common-result', 'scratch-silver', 'two-wins'].includes(currentStep().id);
  frameDocument.documentElement.classList.toggle('tutorial-jackpot-active', inJackpot);
  if (inJackpot && !replay.dataset.tutorialFixture && replay.setTutorialFixture?.(tutorialJackpotFixture())) {
    replay.dataset.tutorialFixture = 'v10';
  }
  const quads = replay.querySelectorAll('.replay-tq');
  if (quads[COMMON_QUADRANT]) quads[COMMON_QUADRANT].dataset.tutorialQuadrant = 'common';
  if (quads[SILVER_QUADRANT]) quads[SILVER_QUADRANT].dataset.tutorialQuadrant = 'silver';
  if (state.phase === 'purchase') setHidden(replay.querySelector('[data-bind="reveal-btn"]'), true);
  setText(replay, '[data-bind="ticket-count"]', '2 CURRENT TICKETS');
  setText(replay, '[data-bind="ticket-detail"]', 'LEVEL ' + TUTORIAL_LEVEL + ' · 8 ENTRIES');
}

function paintCoin() {
  const root = frameQuery('app-daily-flip');
  if (!root) return;
  setHidden(root.querySelector('[data-bind="df-reveal-hint"]'), currentStep().id !== 'coin' || coinAnimating);
}

function allowedSelectorsForStep(id) {
  if (restoringPage || reviewingPage()) return [];
  return ({
    'buy-ticket': ['app-decimator-panel [data-bind="dec-ticket-add-ticket"]'],
    buy: ['app-decimator-panel [data-bind="dec-buy-cta"]'],
    pack: ['[data-tutorial-pending="pack"]'],
    'main-spin': ['replay-panel [data-bind="reveal-btn"]'],
    'scratch-common': ['[data-tutorial-quadrant="common"] .replay-bubble-trigger'],
    'scratch-silver': ['[data-tutorial-quadrant="silver"] .replay-bubble-trigger'],
    coin: ['app-daily-flip .df-coin', 'app-daily-flip [data-bind="df-reveal-hint"]'],
  })[id] || [];
}
function paintControlLocks() {
  frameDocument.querySelectorAll('button,input,select,textarea,a,[tabindex]').forEach(control => {
    if (control.closest('reveal-overlay')) return;
    control.classList.add('tutorial-locked'); control.classList.remove('tutorial-enabled');
    control.tabIndex = -1; control.setAttribute('aria-disabled', 'true');
  });
  frameDocument.querySelectorAll('.replay-scratch-canvas').forEach(canvas => { canvas.style.pointerEvents = 'none'; });
  for (const selector of allowedSelectorsForStep(currentStep().id)) {
    frameDocument.querySelectorAll(selector).forEach(control => {
      control.classList.remove('tutorial-locked'); control.classList.add('tutorial-enabled');
      control.removeAttribute('disabled'); control.removeAttribute('title');
      control.removeAttribute('data-write-locked'); control.removeAttribute('aria-disabled');
      control.tabIndex = 0;
      if (control.matches('canvas')) control.style.pointerEvents = 'auto';
    });
  }
}
function applyFramePresentation() {
  frameDocument.documentElement.dataset.tutorialStep = currentStep().id;
  frameWindow.__DEGENERUS_TUTORIAL_REVEAL__.paintGame(state, { coinAnimating, step: currentStep().id });
  paintHistoricalChrome(); paintPracticeBalances(); paintJackpot(); paintCoin(); paintControlLocks(); updateSpotlight();
}
function targetElement() { return currentStep().target ? frameQuery(currentStep().target) : null; }
function spotlightElement() {
  return ['buy-ticket', 'buy'].includes(currentStep().id)
    ? frameQuery('app-decimator-panel .app-decimator-panel') : targetElement();
}
function scrollToCurrentTarget() {
  if (lastScrolledStep === state.step) return;
  lastScrolledStep = state.step;
  const target = spotlightElement();
  if (!target) { updateSpotlight(); return; }
  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  // Reserve the actual dialogue height, keeping the whole Buy In desk in view.
  if (innerWidth <= 760 && getComputedStyle(target).position !== 'fixed') {
    const available = innerHeight - outer('coach').getBoundingClientRect().height - 80;
    const rect = target.getBoundingClientRect();
    const desiredTop = 52 + Math.max(0, (available - rect.height) / 2);
    frameWindow.scrollBy(0, rect.top - desiredTop);
  }
  requestAnimationFrame(updateSpotlight);
  setTimeout(updateSpotlight, 180);
}
function updateSpotlight() {
  const ring = outer('focus-ring');
  const actionRing = outer('action-ring');
  actionRing.classList.remove('is-visible');
  if (!frameReady || activeRevealKind || BADGE_STEPS.has(currentStep().id) || currentStep().id === 'welcome') {
    ring.classList.remove('is-visible'); resetCoachPosition(); return;
  }
  const target = spotlightElement();
  if (!target) { ring.classList.remove('is-visible'); return; }
  let rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) { ring.classList.remove('is-visible'); return; }
  if (currentStep().id === 'credits') {
    // The felt labels sit outside the betting oval. Include their real bounds
    // so the spotlight never runs through TOMORROW'S BET or the center logo.
    for (const label of frameQuery('app-daily-flip').querySelectorAll('.df-tomorrow-layout__felt-label, .df-table-watermark')) {
      const printed = label.getBoundingClientRect();
      if (!printed.width || !printed.height) continue;
      rect = { left: Math.min(rect.left, printed.left), top: Math.min(rect.top, printed.top),
        right: Math.max(rect.right, printed.right), bottom: Math.max(rect.bottom, printed.bottom) };
    }
  }
  // The normal completion toast is a floating game element. Keep it lit and
  // place the conversation around it without moving or restyling the toast.
  const feedback = frameQuery('[data-bind="qst-complete-toast"]');
  const feedbackRect = feedback && !feedback.hidden ? feedback.getBoundingClientRect() : null;
  if (feedbackRect?.width) {
    rect = { left: Math.min(rect.left, feedbackRect.left), top: Math.min(rect.top, feedbackRect.top),
      right: Math.max(rect.right, feedbackRect.right), bottom: Math.max(rect.bottom, feedbackRect.bottom) };
  }
  const left = Math.max(4, rect.left - 8), top = Math.max(44, rect.top - 8);
  const right = Math.min(innerWidth - 4, rect.right + 8), bottom = Math.min(innerHeight - 4, rect.bottom + 8);
  Object.assign(ring.style, { left: left + 'px', top: top + 'px', width: (right - left) + 'px', height: (bottom - top) + 'px' });
  ring.classList.add('is-visible');
  if (target !== targetElement()) {
    const action = targetElement()?.getBoundingClientRect();
    if (action?.width && action?.height) {
      Object.assign(actionRing.style, { left: (action.left - 5) + 'px', top: (action.top - 5) + 'px',
        width: (action.width + 10) + 'px', height: (action.height + 10) + 'px' });
      actionRing.classList.add('is-visible');
      actionRing.classList.toggle('is-below', currentStep().id === 'buy-ticket');
    }
  }
  if (innerWidth <= 760 && bottom <= innerHeight - outer('coach').getBoundingClientRect().height - 24) {
    Object.assign(outer('coach').style, { top: 'auto', bottom: '10px', left: '10px', right: '10px' });
  } else positionCoachNear({ left, top, right, bottom, width: right - left, height: bottom - top });
  if (feedbackRect?.width) {
    const coach = outer('coach').getBoundingClientRect();
    if (coach.left < feedbackRect.right && coach.right > feedbackRect.left
      && coach.top < feedbackRect.bottom && coach.bottom > feedbackRect.top) positionCoachNear(feedbackRect);
  }
}
function blockFrameEvent(event) { event.preventDefault(); event.stopImmediatePropagation(); }
function overlayIsOpen() { const overlay = frameQuery('reveal-overlay [data-bind="rvl-backdrop"]'); return !!overlay && !overlay.hidden; }
function eventIsAllowed(event) { return allowedSelectorsForStep(currentStep().id).some(selector => event.target.closest?.(selector)); }
function guardFrameEvent(event) {
  if (outer('wallet-prompt').open) { blockFrameEvent(event); return; }
  if (activeRevealKind && overlayIsOpen()) return;
  if (event.type === 'keydown' && event.key === 'Tab') return;
  const interactive = event.target.closest?.('button,a,input,select,textarea,canvas,[role="button"]');
  if (interactive && !eventIsAllowed(event)) blockFrameEvent(event);
  if (['submit', 'input', 'change'].includes(event.type)) blockFrameEvent(event);
}
function handleFrameClick(event) {
  if (restoringPage) {
    if (event.target.closest('[data-bind="rvl-close"]')) return;
    blockFrameEvent(event); return;
  }
  if (outer('wallet-prompt').open) { blockFrameEvent(event); return; }
  if (activeRevealKind && overlayIsOpen()) {
    // The native vessel opens the pack; only its visible art is a click target.
    // Keep a stray click on the backdrop from skipping the reveal animation.
    if (!event.target.closest('[data-bind="rvl-pack"], .rvl-ticket-actions button')) blockFrameEvent(event);
    return;
  }
  if (!eventIsAllowed(event)) { blockFrameEvent(event); return; }
  const id = currentStep().id;
  if (id === 'main-spin' || id.startsWith('scratch-')) return;
  blockFrameEvent(event);
  if (id === 'buy-ticket') { dispatch('add-ticket'); tone('tap'); }
  else if (id === 'buy') openPracticeWallet();
  else if (id === 'pack') queueFrameReveal();
  else if (id === 'coin') handleCoin();
}
function openPracticeWallet() {
  if (currentStep().id !== 'buy' || state.draftTickets !== 2 || outer('wallet-prompt').open) return;
  outer('wallet-prompt').showModal();
  tone('tap');
}
function closePracticeWallet(confirm = false) {
  const prompt = outer('wallet-prompt');
  if (!prompt.open) return;
  prompt.close();
  if (confirm && currentStep().id === 'buy' && state.draftTickets === 2) {
    dispatch('buy'); tone('reveal');
  } else frameQuery('[data-bind="dec-buy-cta"]')?.focus({ preventScroll: true });
}
function handleCoin() {
  if (coinAnimating || currentStep().id !== 'coin') return;
  const inner = frameQuery('app-daily-flip .df-coin3d__inner');
  if (!inner) return;
  coinAnimating = true;
  frameDocument.documentElement.classList.add('tutorial-coin-active');
  inner.classList.add('df-reveal-active', 'df-reveal-track--comet', 'df-reveal-bias--win-heavy', 'df-reveal-ending--win');
  inner.style.setProperty('--df-track-duration', '2400ms'); inner.style.setProperty('--df-ending-duration', '520ms');
  tone('spin');
  coinTimer = setTimeout(() => {
    coinAnimating = false; frameDocument.documentElement.classList.remove('tutorial-coin-active');
    dispatch('coin-complete'); tone('reveal');
  }, 2920);
}
async function restoreReplayPage() {
  const replay = frameQuery('replay-panel');
  if (!replay || (state.phase !== 'jackpot' && !replay.dataset.tutorialFixture)) return;
  replay.setTutorialFixture(tutorialJackpotFixture());
  replay.dataset.tutorialFixture = 'navigation';
  if (state.mainSpinComplete) await replay.restoreTutorialProgress(state);
}
async function navigateTutorial(action) {
  if (!frameReady || restoringPage) return;
  const next = applyTutorialEvent(state, action);
  if (next.step === state.step) return;
  const generation = loadGeneration;
  restoringPage = true;
  clearTimeout(coinTimer); coinTimer = 0; coinAnimating = false;
  frameQuery('app-daily-flip .df-coin3d__inner')?.classList.remove(
    'df-reveal-active', 'df-reveal-track--comet', 'df-reveal-bias--win-heavy', 'df-reveal-ending--win');
  frameDocument.documentElement.classList.remove('tutorial-coin-active');
  outer('wallet-prompt').close();
  // Close through the real engine so its timers, tap waits, and scroll lock
  // are released before restoring another page or opening another pack.
  clearInterval(revealMonitorTimer);
  if (activeRevealKind) frameQuery('[data-bind="rvl-close"]')?.click();
  clearActiveReveal();
  state = next; saveState();
  render(true);
  try {
    await restoreReplayPage();
  } finally {
    if (generation === loadGeneration) {
      restoringPage = false;
      lastScrolledStep = null;
      render(true);
    }
  }
}
function queueFrameReveal() {
  if (activeRevealKind) return;
  const bridge = frameWindow.__DEGENERUS_TUTORIAL_REVEAL__;
  activeRevealKind = 'pack'; revealCompleted = false; revealWasOpen = false; revealAborted = false;
  document.body.classList.add('is-frame-reveal', 'is-pack-sealed');
  outer('coach').removeAttribute('style');
  frameDocument.documentElement.classList.add('tutorial-reveal-active', 'tutorial-pack-sealed');
  const accepted = bridge.queueReveal({ kind: 'pack', count: 2, level: TUTORIAL_LEVEL, pending: false,
    packRelease: { address: TUTORIAL_PLAYER, level: TUTORIAL_LEVEL, cardIndexes: [0, 1] },
    tickets: [{ traitIds: [...ACTIVE_TICKET_TRAITS] }, { traitIds: [...SECOND_ACTIVE_TICKET_TRAITS] }] });
  if (!accepted) { clearActiveReveal(); return; }
  updateSpotlight();
  revealMonitorTimer = setInterval(() => {
    if (overlayIsOpen()) {
      revealWasOpen = true;
      const sealed = !frameQuery('[data-bind="rvl-vessel"]')?.hidden;
      document.body.classList.toggle('is-pack-sealed', sealed);
      frameDocument.documentElement.classList.toggle('tutorial-pack-sealed', sealed);
      return;
    }
    if (!revealWasOpen) return;
    const completed = revealCompleted && !revealAborted;
    clearActiveReveal();
    if (completed) dispatch(reviewingPage() ? 'next-page' : 'collect-pack');
    else render(true);
  }, 100);
}
function clearActiveReveal() {
  clearInterval(revealMonitorTimer); revealMonitorTimer = 0; activeRevealKind = null;
  document.body.classList.remove('is-frame-reveal', 'is-pack-sealed');
  frameDocument?.documentElement.classList.remove('tutorial-reveal-active', 'tutorial-pack-sealed');
}
function revealCurrentQuadrant() {
  const kind = currentStep().id === 'scratch-common' ? 'common' : currentStep().id === 'scratch-silver' ? 'silver' : null;
  if (!kind) return;
  frameQuery('[data-tutorial-quadrant="' + kind + '"] .replay-bubble-trigger')?.click();
}
function restartTutorial() {
  restoringPage = false;
  outer('wallet-prompt').close();
  ++loadGeneration; clearTimeout(coinTimer); clearActiveReveal();
  historicalDayObserver?.disconnect(); historicalDayObserver = null;
  scratchObserver?.disconnect(); scratchObserver = null;
  feedbackObserver?.disconnect(); feedbackObserver = null;
  state = createInitialTutorialState(); saveState();
  coinAnimating = false; frameReady = false; lastScrolledStep = null;
  frameDocument = null; frameWindow = null;
  outer('loading').classList.remove('is-ready');
  window.dispatchEvent(new Event('degenerus:tutorial-loading'));
  frame.src = FRAME_URL + '&restart=' + Date.now(); render();
}
document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (control?.disabled) return;
  const action = control?.dataset.action;
  if (!action) return;
  if (action === 'wallet-confirm') closePracticeWallet(true);
  else if (action === 'wallet-reject') closePracticeWallet();
  else if (outer('wallet-prompt').open) return;
  else if (action === 'previous' || action === 'next-page') void navigateTutorial(action);
  else if (action === 'restart') restartTutorial();
  else if (action === 'finish') location.href = '/app/';
  else if (action === 'reveal-quadrant') revealCurrentQuadrant();
  else if (action === 'toggle-sound') {
    dispatch(action); frameWindow?.__DEGENERUS_TUTORIAL_REVEAL__?.setSound?.(state.sound);
  } else if (frameReady) { getAudioContext(); dispatch(action); tone('tap'); }
});
outer('wallet-prompt').addEventListener('cancel', event => {
  event.preventDefault(); closePracticeWallet();
});
window.addEventListener('resize', updateSpotlight);
window.addEventListener('pagehide', () => { clearTimeout(coinTimer); clearActiveReveal(); scratchObserver?.disconnect(); feedbackObserver?.disconnect(); historicalDayObserver?.disconnect(); });
frame.addEventListener('load', onFrameLoad);
frame.src = FRAME_URL;
render();

function setOuterText(name, value) {
  const element = outer(name);
  if (element && element.textContent !== String(value)) element.textContent = String(value);
}

function setText(root, selector, value) {
  const element = root && root.querySelector(selector);
  if (element && element.textContent !== String(value)) element.textContent = String(value);
  return element;
}

function setHidden(element, hidden) {
  if (!element) return;
  element.hidden = Boolean(hidden);
}

function revealTutorialBalance(root, displaySelector, valueSelector, spoilerClass) {
  const display = root?.querySelector(displaySelector);
  const value = root?.querySelector(valueSelector);
  display?.classList.remove(spoilerClass);
  display?.removeAttribute('aria-label');
  if (!value) return;
  value.removeAttribute('aria-hidden');
  value.removeAttribute('aria-label');
  value.removeAttribute('role');
  value.removeAttribute('tabindex');
  value.removeAttribute('title');
  value.style?.setProperty?.('filter', 'none', 'important');
  value.style?.setProperty?.('opacity', '1', 'important');
  value.style?.setProperty?.('user-select', 'auto', 'important');
}

function formatEth(value) {
  return formatNumber.format(value) + ' ETH';
}

function freezeLiveFrame() {
  try {
    frameWindow?.__DEGENERUS_TUTORIAL_FREEZE__?.freeze?.();
  } catch (_error) {}

  // These production elements own additional subscriptions or one-off fetch
  // controllers beyond the app-wide polling loop. Their rendered DOM stays in
  // place after disconnection; only their background writers are released.
  // The reveal overlay deliberately remains connected.
  const stablePanels = [
    'gold-rush-headline',
    'app-pool-progress',
    'last-day-jackpot',
    'replay-panel',
    'app-decimator-panel',
    'app-daily-flip',
    'app-quest-panel',
    'app-degenerette-panel',
    'app-parimutuel-panel',
    'app-tickets-inventory',
    'app-pass-section',
    'app-reveal-tray',
  ];
  for (const selector of stablePanels) {
    const panel = frameDocument?.querySelector(selector);
    try { panel?.disconnectedCallback?.(); } catch (_error) {}
  }
}

function frameQuery(selector) {
  try { return frameDocument && frameDocument.querySelector(selector); }
  catch (_error) { return null; }
}

function paintHistoricalChrome() {
  const day = frameDocument?.getElementById('unav-day');
  const pinDay = function () {
    if (!day) return;
    const historicalDay = state.phase === 'purchase'
      ? TUTORIAL_PURCHASE_DAY
      : TUTORIAL_HISTORICAL_DAY;
    let option = Array.from(day.options || []).find(function (candidate) {
      return String(candidate.value) === String(historicalDay);
    });
    if (!option) {
      option = frameDocument.createElement('option');
      option.value = String(historicalDay);
      option.textContent = 'DAY ' + historicalDay;
      day.appendChild(option);
    }
    day.value = String(historicalDay);
    day.dataset.tutorialDay = String(historicalDay);
  };
  if (day) {
    pinDay();
    if (!historicalDayObserver && frameWindow?.MutationObserver) {
      historicalDayObserver = new frameWindow.MutationObserver(pinDay);
      historicalDayObserver.observe(day, { childList: true });
    }
  }
  setText(frameDocument, '[data-bind="nav-jackpot-countdown-value"]', state.phase === 'jackpot' ? 'READY' : '00:30');
}

function resetCoachPosition() {
  const coach = outer('coach');
  if (!coach) return;
  for (const property of ['top', 'right', 'bottom', 'left']) {
    coach.style.removeProperty(property);
  }
}

function positionCoachNear(rect) {
  const coach = outer('coach');
  if (!coach || !rect) return;
  const viewportWidth = document.documentElement.clientWidth || innerWidth;
  const viewportHeight = document.documentElement.clientHeight || innerHeight;
  const size = coach.getBoundingClientRect();
  const width = Math.min(size.width || 370, viewportWidth - 16);
  const height = Math.min(size.height || 180, viewportHeight - 52);
  const edge = 10;
  const topEdge = 44;
  const gap = 14;
  const centeredLeft = rect.left + rect.width / 2 - width / 2;
  const centeredTop = rect.top + rect.height / 2 - height / 2;
  const horizontal = rect.left + rect.width / 2 > viewportWidth / 2
    ? [
        { left: rect.left - width - gap, top: centeredTop },
        { left: rect.right + gap, top: centeredTop },
      ]
    : [
        { left: rect.right + gap, top: centeredTop },
        { left: rect.left - width - gap, top: centeredTop },
      ];
  const vertical = [
    { left: centeredLeft, top: rect.bottom + gap },
    { left: centeredLeft, top: rect.top - height - gap },
  ];
  const candidates = viewportWidth <= 760 ? vertical : [...horizontal, ...vertical];
  const fits = function (candidate) {
    return candidate.left >= edge
      && candidate.top >= topEdge
      && candidate.left + width <= viewportWidth - edge
      && candidate.top + height <= viewportHeight - edge;
  };
  let chosen = candidates.find(fits);
  if (!chosen) {
    const clamp = function (value, min, max) {
      return Math.max(min, Math.min(max, value));
    };
    const roomBelow = viewportHeight - rect.bottom;
    const roomAbove = rect.top - topEdge;
    chosen = {
      left: clamp(centeredLeft, edge, viewportWidth - width - edge),
      top: clamp(
        roomBelow >= roomAbove ? rect.bottom + gap : rect.top - height - gap,
        topEdge,
        viewportHeight - height - edge,
      ),
    };
  }
  coach.style.top = Math.round(chosen.top) + 'px';
  coach.style.left = Math.round(chosen.left) + 'px';
  coach.style.right = 'auto';
  coach.style.bottom = 'auto';
}

function getAudioContext() {
  if (!audioContext) {
    const AudioConstructor = window.AudioContext || window.webkitAudioContext;
    if (AudioConstructor) audioContext = new AudioConstructor();
  }
  return audioContext;
}

function tone(kind) {
  if (!state.sound) return;
  const context = getAudioContext();
  if (!context) return;
  if (context.state === 'suspended') context.resume().catch(function () {});
  const presets = {
    tap: [[510, 0, 0.045]],
    tick: [[440, 0, 0.035]],
    'tick-blue': [[660, 0, 0.045]],
    good: [[660, 0, 0.08], [880, 0.07, 0.13]],
    reveal: [[430, 0, 0.07], [680, 0.06, 0.09], [980, 0.14, 0.14]],
    miss: [[255, 0, 0.075]],
    spin: [[310, 0, 0.06], [470, 0.08, 0.06], [690, 0.16, 0.08]],
  };
  (presets[kind] || presets.tap).forEach(function (note) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === 'miss' ? 'triangle' : 'sine';
    oscillator.frequency.value = note[0];
    gain.gain.setValueAtTime(0.0001, context.currentTime + note[1]);
    gain.gain.exponentialRampToValueAtTime(0.05, context.currentTime + note[1] + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + note[1] + note[2]);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(context.currentTime + note[1]);
    oscillator.stop(context.currentTime + note[1] + note[2] + 0.02);
  });
}
