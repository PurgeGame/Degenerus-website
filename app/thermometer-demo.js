import { update } from './app/store.js';
import './components/app-pool-progress.js';

const ETH = 10n ** 12n;
const LEVEL = 36;
const TARGET_ETH = 4_000n;
const TARGET = TARGET_ETH * ETH;
const history = Array.from({ length: LEVEL - 1 }, (_unused, index) => {
  const level = index + 1;
  const poolEth = BigInt(Math.round(18 * (1.17 ** index)));
  return { level, poolWei: String(poolEth * ETH) };
});

function paint(percent) {
  const next = (TARGET * BigInt(percent)) / 100n;
  update('app.gameState', {
    level: LEVEL,
    phase: 'PURCHASE',
    jackpotPhaseFlag: false,
    phaseTransitionActive: false,
  });
  update('app.goldRush', {
    level: LEVEL,
    phase: 'PURCHASE',
    components: { nextWei: String(next) },
  });
  update('app.poolBenchmarks', {
    level: LEVEL,
    targetWei: String(TARGET),
    ratchets: {
      prev: String(3_600n * ETH),
      current: String(TARGET),
    },
    history,
    contractPhase: {
      level: LEVEL,
      jackpot: false,
      lastPurchaseDay: false,
      rngLocked: false,
    },
  });
}

const initialPercent = Number(new URLSearchParams(window.location.search).get('percent'));
const defaultPercent = [62, 101, 115].includes(initialPercent) ? initialPercent : 115;
paint(defaultPercent);
document.getElementById('thermometer-demo-host')
  ?.appendChild(document.createElement('app-pool-progress'));

for (const button of document.querySelectorAll('[data-percent]')) {
  button.classList.toggle('is-active', Number(button.dataset.percent) === defaultPercent);
  button.addEventListener('click', () => {
    const percent = Number(button.dataset.percent);
    if (!Number.isFinite(percent)) return;
    for (const peer of document.querySelectorAll('[data-percent]')) {
      peer.classList.toggle('is-active', peer === button);
    }
    paint(Math.trunc(percent));
  });
}
