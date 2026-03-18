// app/api.js -- REST client with polling, exponential backoff, stale data detection
// Reads game/player state from the database API and updates the reactive store.

import { update, batch, get } from './store.js';
import { API_BASE, POLL_INTERVALS } from './constants.js';

let consecutiveFails = 0;
const MAX_BACKOFF = 30000;
let gameTimer = null;
let playerTimer = null;
let healthTimer = null;

export async function fetchJSON(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export async function checkHealth() {
  try {
    const health = await fetchJSON('/health');
    update('ui.apiHealthy', true);
    return health;
  } catch {
    update('ui.apiHealthy', false);
    return null;
  }
}

export async function pollGameState() {
  try {
    const data = await fetchJSON('/game/state');
    batch([
      ['game.level', data.level],
      ['game.phase', data.phase],
      ['game.gameOver', data.gameOver],
      ['game.rngLocked', data.rngLockedFlag],
      ['game.price', data.price],
      ['game.pools.future', data.prizePools.futurePrizePool],
      ['game.pools.next', data.prizePools.nextPrizePool],
      ['game.pools.current', data.prizePools.currentPrizePool],
      ['game.pools.claimable', data.prizePools.claimableWinnings],
      ['game.decWindowOpen', data.decWindowOpen],
      ['game.levelStartTime', data.levelStartTime || null],
      ['game.jackpotDay', data.jackpotCounter || 0],
      ['game.phaseTransitionActive', data.phaseTransitionActive || false],
    ]);
    consecutiveFails = 0;
    update('ui.staleData', false);
  } catch {
    consecutiveFails++;
    if (consecutiveFails >= 3) update('ui.staleData', true);
  }
}

export async function pollPlayerData() {
  const addr = get('player.address');
  if (!addr) return;
  try {
    const data = await fetchJSON(`/player/${addr}`);
    batch([
      ['player.balances.burnie', data.burnieBalance],
      ['player.balances.dgnrs', data.dgnrsBalance],
      ['player.balances.wwxrp', data.wwxrpBalance],
      ['player.claimable', data.claimableEth],
      ['player.shields', data.shields],
    ]);
  } catch {
    // Player polling failures are non-critical -- do not set staleData
  }
}

function getBackoffMs() {
  if (consecutiveFails === 0) return 0;
  return Math.min(1000 * Math.pow(2, consecutiveFails - 1), MAX_BACKOFF);
}

export function startPolling() {
  // Health check first, then start data polling
  checkHealth();
  healthTimer = setInterval(checkHealth, POLL_INTERVALS.health);

  // Game state polling with backoff awareness
  const gameLoop = async () => {
    await pollGameState();
    const delay = getBackoffMs() || POLL_INTERVALS.gameState;
    gameTimer = setTimeout(gameLoop, delay);
  };
  gameLoop();

  // Player data polling (only when connected)
  const playerLoop = async () => {
    await pollPlayerData();
    playerTimer = setTimeout(playerLoop, POLL_INTERVALS.playerData);
  };
  playerLoop();
}

export function stopPolling() {
  clearTimeout(gameTimer);
  clearTimeout(playerTimer);
  clearInterval(healthTimer);
  gameTimer = null;
  playerTimer = null;
  healthTimer = null;
}

// Immediate re-fetch after user actions
export async function refreshAfterAction() {
  await Promise.all([pollGameState(), pollPlayerData()]);
}

// Visibility change handler: re-fetch when tab becomes visible
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    pollGameState();
    pollPlayerData();
  }
});
