// viewer/coinflip-display.js -- Coinflip card-flip display module
// Renders a GSAP card-flip animation for coinflip activity data.
// No wallet, contract, or app/ imports -- viewer-layer only (SHELL-01).

import { formatEth } from './utils.js';
import gsap from 'gsap';

/**
 * Compute the multiplier tier label from rewardPercent.
 * Inline logic -- do NOT import from app/coinflip.js (requires wallet context).
 * @param {number|null} rewardPercent
 * @returns {string|null}
 */
function getTierLabel(rewardPercent) {
  if (rewardPercent == null) return null;
  if (rewardPercent === 50) return '1.50x';
  if (rewardPercent === 150) return '2.50x';
  return (1 + rewardPercent / 100).toFixed(2) + 'x';
}

/**
 * render(coinflipData, container) -- render coinflip card panel into container.
 *
 * When coinflipData is null/falsy, returns immediately (no coinflip activity that day).
 *
 * @param {{ stakeAmount: string|null, win: boolean|null, rewardPercent: number|null }|null} coinflipData
 * @param {HTMLElement} container - parent element to append panel into
 */
export function render(coinflipData, container) {
  if (!coinflipData) return;

  const { stakeAmount, win, rewardPercent } = coinflipData;

  // Outer wrapper: gets perspective for CSS 3D flip
  const wrapper = document.createElement('div');
  wrapper.className = 'coinflip-display-wrapper';

  // Card panel
  const panel = document.createElement('div');
  panel.className = 'panel coinflip-display-panel';

  // Title
  const title = document.createElement('h2');
  title.textContent = 'Coinflip';
  panel.appendChild(title);

  // Card inner container
  const card = document.createElement('div');
  card.className = 'cf-card';

  // Win/loss/pending result indicator
  const indicator = document.createElement('div');
  if (win === true) {
    indicator.className = 'cf-result-indicator cf-win';
    indicator.textContent = 'WIN';
    indicator.style.color = 'var(--success, #22c55e)';
  } else if (win === false) {
    indicator.className = 'cf-result-indicator cf-loss';
    indicator.textContent = 'LOSS';
    indicator.style.color = 'var(--error, #ef4444)';
  } else {
    indicator.className = 'cf-result-indicator cf-pending';
    indicator.textContent = 'PENDING';
    indicator.style.color = 'var(--text-dim, #888)';
  }
  card.appendChild(indicator);

  // Stake row
  const stakeRow = document.createElement('div');
  stakeRow.className = 'info-row' + (win === true ? ' info-row--good' : '');

  const stakeLabel = document.createElement('span');
  stakeLabel.className = 'info-label';
  stakeLabel.textContent = 'Stake';

  const stakeValue = document.createElement('span');
  stakeValue.className = 'info-value';
  stakeValue.textContent = (stakeAmount ? formatEth(stakeAmount) : '0') + ' ETH';

  stakeRow.appendChild(stakeLabel);
  stakeRow.appendChild(stakeValue);
  card.appendChild(stakeRow);

  // Multiplier row (only when rewardPercent is available)
  const tierLabel = getTierLabel(rewardPercent);
  if (tierLabel !== null) {
    const multRow = document.createElement('div');
    multRow.className = 'info-row' + (win === true ? ' info-row--good' : '');

    const multLabel = document.createElement('span');
    multLabel.className = 'info-label';
    multLabel.textContent = 'Multiplier';

    const multValue = document.createElement('span');
    multValue.className = 'info-value';
    multValue.textContent = tierLabel;

    multRow.appendChild(multLabel);
    multRow.appendChild(multValue);
    card.appendChild(multRow);
  }

  panel.appendChild(card);
  wrapper.appendChild(panel);
  container.appendChild(wrapper);

  // GSAP card-flip animation (element must be in DOM for GSAP to read computed styles)
  gsap.set(panel, { rotateY: 90, opacity: 0 });
  gsap.to(panel, {
    rotateY: 0,
    opacity: 1,
    duration: 0.5,
    ease: 'back.out(1.2)',
    onComplete: () => {
      const ind = panel.querySelector('.cf-result-indicator');
      if (ind) {
        gsap.from(ind, { scale: 0.5, opacity: 0, duration: 0.3, ease: 'back.out(2)' });
      }
    }
  });

  // Optional win celebration via canvas-confetti (dynamic import -- does not block rendering)
  if (win === true) {
    import('canvas-confetti').then(mod => {
      mod.default({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#22c55e', '#f5a623']
      });
    }).catch(() => {}); // silent fail if confetti unavailable
  }
}
