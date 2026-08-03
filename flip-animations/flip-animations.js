import {
  isMuted,
  setMuted,
  warmup,
  sfxCoinflipStart,
  sfxCoinflipWhoosh,
  sfxReverseBonk,
  sfxCoinflipLand,
} from '/app/app/jackpot-sfx.js';

const TRACK_MS = 3300;
const SHORT_END_MS = 700;
const BIASED_EXTENSION_MS = 650;
const BIASED_END_MS = SHORT_END_MS + BIASED_EXTENSION_MS;
const METER_SETTLE_MS = 1600;
const METER_FLASH_MS = 850;
const METER_DRAIN_MS = 350;
const METER_RECOVERY_TAIL_MS = 250;
const LOOP_PAUSE_MS = 500;
const DEMO_REWARD_PERCENT = 96;
const REVERSE_CARD_STAGGER_MS = 900;
const REVERSE_CARD_ENTRY_WAIT_MS = 100;
const REVERSE_CARD_ANIMATION_MS = 600;
const LOSS_VERDICT_DELAY_MS = 300;
const METER_REBOUND_MS = REVERSE_CARD_STAGGER_MS + METER_RECOVERY_TAIL_MS;
const METER_TERMINAL_DRAIN_MS = REVERSE_CARD_STAGGER_MS - METER_RECOVERY_TAIL_MS;

const patternSelect = document.querySelector('[data-bind="pattern"]');
const playAllButton = document.querySelector('[data-bind="play-all"]');
const soundInput = document.querySelector('[data-bind="sound"]');
const loopInput = document.querySelector('[data-bind="loop"]');
const demos = [...document.querySelectorAll('.flip-demo[data-ending]')];
const demoTimers = new Map();
let loopTimer = null;
let audioUnlocked = false;
let audibleDemo = demos[0] || null;

if (soundInput) soundInput.checked = !isMuted();

function unlockAudio() {
  if (!soundInput?.checked) return;
  setMuted(false);
  warmup();
  audioUnlocked = true;
}

function demoCanSound(demo) {
  return Boolean(audioUnlocked && soundInput?.checked && audibleDemo === demo);
}

function playDemoCue(demo, cue) {
  if (!demoCanSound(demo)) return;
  try { cue(); } catch (_e) { /* the motion lab still works without WebAudio */ }
}

function markAudibleDemo() {
  demos.forEach((demo) => demo.classList.toggle('is-audible', demo === audibleDemo));
}

function isWinEnding(ending) {
  return ending === 'win' || ending.endsWith('-to-win');
}

function isFakeoutEnding(ending) {
  return ending === 'loss-to-win' || ending === 'win-to-loss';
}

function reversalCountForEnding(ending) {
  if (ending.startsWith('triple-')) return 3;
  if (ending.startsWith('double-')) return 2;
  return isFakeoutEnding(ending) ? 1 : 0;
}

function isWinHeavyProfile(profile) {
  return profile === 'comet' || profile === 'ricochet';
}

function endingPlan(profile, ending) {
  const reversalCount = reversalCountForEnding(ending);
  const finalWon = isWinEnding(ending);
  const openingWon = reversalCount % 2 === 0 ? finalWon : !finalWon;
  const prefersWin = isWinHeavyProfile(profile);
  const openingMs = openingWon === prefersWin ? BIASED_END_MS : SHORT_END_MS;
  return {
    bias: prefersWin ? 'win-heavy' : 'loss-heavy',
    openingWon,
    openingMs,
    reversalCount,
    endingMs: openingMs + (reversalCount * REVERSE_CARD_STAGGER_MS),
  };
}

function makeFace(className, src) {
  const face = document.createElement('span');
  face.className = `df-coin3d__face ${className}`;
  const image = document.createElement('img');
  image.src = src;
  image.alt = '';
  face.appendChild(image);
  return face;
}

function makeAnimatedCoin(profile, ending, plan) {
  const coin = document.createElement('button');
  coin.type = 'button';
  coin.className = 'df-coin df-coin--spinning';
  coin.setAttribute('aria-label', `Replay ${profile} flip animation`);

  const rotor = document.createElement('span');
  rotor.className = [
    'df-coin3d__inner',
    'df-reveal-active',
    `df-reveal-track--${profile}`,
    `df-reveal-bias--${plan.bias}`,
    `df-reveal-ending--${ending}`,
  ].join(' ');
  rotor.style.setProperty('--df-track-duration', `${TRACK_MS}ms`);
  rotor.style.setProperty('--df-ending-duration', `${plan.endingMs}ms`);
  rotor.append(
    makeFace('df-coin3d__face--red', '/shared/coinflip-face-red.svg'),
    makeFace('df-coin3d__face--eth', '/shared/coinflip-face-eth.svg'),
  );
  coin.appendChild(rotor);
  return coin;
}

function makeReverseCards(ending, plan) {
  const { reversalCount } = plan;
  const finalWon = isWinEnding(ending);
  return Array.from({ length: reversalCount }, (_, offset) => {
    const index = offset + 1;
    const remaining = reversalCount - index;
    const targetWon = remaining % 2 === 0 ? finalWon : !finalWon;
    const target = targetWon ? 'eth' : 'wwxrp';
    const card = document.createElement('span');
    card.className = `df-fakeout-reverse-card df-fakeout-reverse-card--to-${target}`;
    card.setAttribute('aria-hidden', 'true');
    card.setAttribute('data-reversal-index', String(index));
    card.style.setProperty(
      '--df-fakeout-delay',
      `${TRACK_MS + plan.openingMs + REVERSE_CARD_ENTRY_WAIT_MS
        + (offset * REVERSE_CARD_STAGGER_MS)}ms`,
    );
    card.style.setProperty('--df-fakeout-duration', `${REVERSE_CARD_ANIMATION_MS}ms`);

    const art = document.createElement('img');
    art.className = 'df-fakeout-reverse-card__art';
    art.src = '/shared/reverse-flip-card.svg';
    art.alt = '';
    card.appendChild(art);
    return card;
  });
}

function makeMeterHost() {
  const host = document.createElement('div');
  host.className = 'df-modifier-meter-slot';
  host.setAttribute('data-bind', 'modifier-meter');
  return host;
}

function renderMeter(
  host,
  {
    apparent = false,
    draining = false,
    terminalDraining = false,
    rebounding = false,
    recoveryTail = false,
  } = {},
) {
  host.replaceChildren();
  const totalPercent = 100 + DEMO_REWARD_PERCENT;
  const position = ((DEMO_REWARD_PERCENT - 50) / (156 - 50)) * 100;
  const meter = document.createElement('div');
  meter.className = rebounding
    ? 'df-modifier-meter df-modifier-meter--rebounding'
    : terminalDraining
      ? 'df-modifier-meter df-modifier-meter--terminal-draining'
      : draining
      ? 'df-modifier-meter df-modifier-meter--draining'
      : `df-modifier-meter df-modifier-meter--settled${
        recoveryTail ? ' df-modifier-meter--recovery-tail' : ' df-modifier-meter--settling'
      }`;
  meter.style.setProperty('--df-meter-rebound-duration', `${METER_REBOUND_MS}ms`);
  meter.style.setProperty('--df-meter-recovery-tail-duration', `${METER_RECOVERY_TAIL_MS}ms`);
  meter.style.setProperty('--df-meter-terminal-drain-duration', `${METER_TERMINAL_DRAIN_MS}ms`);
  meter.setAttribute('role', 'img');
  meter.setAttribute('aria-label', rebounding
    ? `Win multiplier rebounding from minimum to ${totalPercent} percent`
    : draining || terminalDraining
      ? 'Win multiplier falling to minimum'
      : recoveryTail
        ? `Win multiplier recovering to ${totalPercent} percent`
        : `Win multiplier stopped at ${totalPercent} percent`);

  const scale = document.createElement('div');
  scale.className = 'df-modifier-meter__scale';
  for (const label of ['256%', '200%', '150%']) {
    const tick = document.createElement('span');
    tick.textContent = label;
    scale.appendChild(tick);
  }

  const track = document.createElement('div');
  track.className = 'df-modifier-meter__track';
  const marker = document.createElement('span');
  marker.className = 'df-modifier-meter__marker';
  marker.style.bottom = `${position}%`;
  marker.style.setProperty('--df-meter-stop', `${position}%`);
  track.appendChild(marker);

  const readout = document.createElement('div');
  readout.className = 'df-modifier-meter__readout';
  readout.textContent = draining || terminalDraining ? '150%' : `${totalPercent}%`;
  meter.append(scale, track, readout);
  host.appendChild(meter);
}

function renderMeterFlash(host) {
  const flash = document.createElement('div');
  flash.className = 'df-modifier-flash';
  flash.setAttribute('role', 'status');
  flash.textContent = `${100 + DEMO_REWARD_PERCENT}%`;
  host.replaceChildren(flash);
}

function clearDemoTimers(demo) {
  const timers = demoTimers.get(demo);
  if (timers) timers.forEach(clearTimeout);
  demoTimers.delete(demo);
}

function scheduleDemo(demo, callback, delay) {
  let timers = demoTimers.get(demo);
  if (!timers) {
    timers = new Set();
    demoTimers.set(demo, timers);
  }
  const timer = setTimeout(() => {
    timers.delete(timer);
    callback();
  }, delay);
  timers.add(timer);
}

function scheduleApparentWinMeter(demo, ending, plan, meterHost) {
  const show = () => renderMeter(meterHost, { apparent: true });
  const drain = () => renderMeter(meterHost, { apparent: true, draining: true });
  const terminalDrain = () => renderMeter(meterHost, { apparent: true, terminalDraining: true });
  const rebound = () => renderMeter(meterHost, { apparent: true, rebounding: true });
  const hide = () => meterHost.replaceChildren();
  const { reversalCount } = plan;
  if (reversalCount === 0) return;
  let apparentWon = reversalCount % 2 === 0 ? isWinEnding(ending) : !isWinEnding(ending);
  let meterVisible = apparentWon;
  let meterHasRebounded = false;
  if (apparentWon) scheduleDemo(demo, show, TRACK_MS + plan.openingMs);

  for (let completed = 1; completed <= reversalCount; completed += 1) {
    const nextWon = !apparentWon;
    const landingAt = TRACK_MS + plan.openingMs + (completed * REVERSE_CARD_STAGGER_MS);
    const anotherCardRemains = completed < reversalCount;
    if (apparentWon && !nextWon) {
      if (anotherCardRemains) {
        scheduleDemo(demo, drain, landingAt - METER_DRAIN_MS);
        scheduleDemo(demo, rebound, landingAt);
        meterHasRebounded = true;
      } else {
        const drainMs = meterHasRebounded ? METER_TERMINAL_DRAIN_MS : METER_DRAIN_MS;
        scheduleDemo(demo, meterHasRebounded ? terminalDrain : drain, landingAt - drainMs);
        scheduleDemo(demo, hide, landingAt);
        meterVisible = false;
      }
    } else if (!apparentWon && nextWon && anotherCardRemains && !meterVisible) {
      scheduleDemo(demo, show, landingAt);
      meterVisible = true;
    }
    apparentWon = nextWon;
  }
}

function resultStatus(won) {
  return won ? 'WIN · ETH' : 'LOSS · WWXRP';
}

function scheduleApparentResultStatus(demo, ending, plan, status) {
  const { reversalCount } = plan;
  let apparentWon = reversalCount % 2 === 0 ? isWinEnding(ending) : !isWinEnding(ending);
  const openingWon = apparentWon;
  scheduleDemo(demo, () => {
    status.textContent = resultStatus(openingWon);
  }, TRACK_MS + plan.openingMs);

  for (let completed = 1; completed <= reversalCount; completed += 1) {
    apparentWon = !apparentWon;
    const landedWon = apparentWon;
    scheduleDemo(demo, () => {
      status.textContent = resultStatus(landedWon);
    }, TRACK_MS + plan.openingMs + (completed * REVERSE_CARD_STAGGER_MS));
  }
}

function scheduleCoinflipMotionSfx(demo, plan) {
  playDemoCue(demo, () => sfxCoinflipStart());
  const profileBeats = {
    comet: [0.18, 0.45, 0.75],
    ricochet: [0.14, 0.31, 0.54, 0.75],
    orbit: [0.19, 0.46, 0.71],
    pulse: [0.14, 0.34, 0.57, 0.79],
  };
  const beats = profileBeats[patternSelect.value] || [0.2, 0.48, 0.76];
  beats.forEach((fraction, index) => {
    scheduleDemo(demo, () => playDemoCue(
      demo,
      () => sfxCoinflipWhoosh(0.48 + (index * 0.11), index % 2 === 1),
    ), Math.max(80, Math.round(TRACK_MS * fraction)));
  });
  scheduleDemo(demo, () => playDemoCue(
    demo,
    () => sfxCoinflipWhoosh(0.46, true),
  ), TRACK_MS + Math.round(plan.openingMs * 0.38));

  for (let index = 1; index <= plan.reversalCount; index += 1) {
    const cardStart = TRACK_MS + plan.openingMs + REVERSE_CARD_ENTRY_WAIT_MS
      + ((index - 1) * REVERSE_CARD_STAGGER_MS);
    scheduleDemo(demo, () => playDemoCue(
      demo,
      () => sfxCoinflipWhoosh(0.72 + (index * 0.06), index % 2 === 0),
    ), cardStart);
    scheduleDemo(demo, () => playDemoCue(
      demo,
      () => sfxReverseBonk(0.88 + (index * 0.06)),
    ), cardStart + (REVERSE_CARD_ANIMATION_MS / 2));
  }
}

function settleDemo(demo, ending) {
  const zone = demo.querySelector('[data-bind="coin-zone"]');
  const status = demo.querySelector('[data-bind="status"]');
  const won = isWinEnding(ending);
  const landed = document.createElement('button');
  landed.type = 'button';
  landed.className = 'df-coin df-coin--landed';
  landed.setAttribute('aria-label', `Replay ${patternSelect.value} ${ending} animation`);
  const face = document.createElement('img');
  face.src = won ? '/shared/coinflip-face-eth.svg' : '/shared/coinflip-face-red.svg';
  face.alt = won ? 'Green ETH face — win' : 'Red WWXRP face — loss';
  landed.appendChild(face);
  landed.addEventListener('click', () => replayDemo(demo));
  const meterHost = makeMeterHost();
  zone.replaceChildren(meterHost, landed);

  demo.classList.remove('is-running');
  demo.classList.toggle('is-win', won);
  demo.classList.toggle('is-loss', !won);
  status.textContent = resultStatus(won);
  if (won) {
    renderMeter(meterHost, { recoveryTail: reversalCountForEnding(ending) >= 2 });
    scheduleDemo(demo, () => {
      renderMeterFlash(meterHost);
      // This is the exact production commitment point: the winning sound and
      // the thermometer's final number enter on the same callback.
      playDemoCue(demo, () => sfxCoinflipLand(true));
      scheduleDemo(demo, () => meterHost.replaceChildren(), METER_FLASH_MS);
    }, METER_SETTLE_MS);
  } else {
    scheduleDemo(
      demo,
      () => playDemoCue(demo, () => sfxCoinflipLand(false)),
      LOSS_VERDICT_DELAY_MS,
    );
  }
}

function playDemo(demo) {
  clearDemoTimers(demo);

  const profile = patternSelect.value;
  const ending = demo.dataset.ending;
  const plan = endingPlan(profile, ending);
  const zone = demo.querySelector('[data-bind="coin-zone"]');
  const status = demo.querySelector('[data-bind="status"]');
  const coin = makeAnimatedCoin(profile, ending, plan);
  coin.addEventListener('click', () => replayDemo(demo));
  const meterHost = makeMeterHost();
  zone.replaceChildren(meterHost, coin);
  const reverseCards = makeReverseCards(ending, plan);
  if (reverseCards.length > 0) zone.append(...reverseCards);

  demo.classList.add('is-running');
  demo.classList.remove('is-win', 'is-loss');
  status.textContent = 'FLIPPING';

  scheduleApparentWinMeter(demo, ending, plan, meterHost);
  scheduleApparentResultStatus(demo, ending, plan, status);
  scheduleCoinflipMotionSfx(demo, plan);
  scheduleDemo(demo, () => settleDemo(demo, ending), TRACK_MS + plan.endingMs);
}

function replayDemo(demo) {
  audibleDemo = demo;
  markAudibleDemo();
  unlockAudio();
  playDemo(demo);
}

function clearLoopTimer() {
  if (loopTimer != null) clearTimeout(loopTimer);
  loopTimer = null;
}

function playAll() {
  clearLoopTimer();
  markAudibleDemo();
  demos.forEach(playDemo);
  if (loopInput.checked) {
    const longestEnding = Math.max(...demos.map((demo) => (
      endingPlan(patternSelect.value, demo.dataset.ending).endingMs
    )));
    const duration = TRACK_MS + longestEnding + METER_SETTLE_MS + METER_FLASH_MS + LOOP_PAUSE_MS;
    loopTimer = setTimeout(playAll, duration);
  }
}

playAllButton.addEventListener('click', () => {
  unlockAudio();
  playAll();
});
patternSelect.addEventListener('change', () => {
  unlockAudio();
  playAll();
});
soundInput?.addEventListener('change', () => {
  setMuted(!soundInput.checked);
  if (soundInput.checked) unlockAudio();
});
loopInput.addEventListener('change', () => {
  if (loopInput.checked) {
    unlockAudio();
    playAll();
  }
  else clearLoopTimer();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearLoopTimer();
  else if (loopInput.checked) playAll();
});

markAudibleDemo();
requestAnimationFrame(playAll);
