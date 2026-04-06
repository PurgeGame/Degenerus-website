// app/api.js -- REST client with polling, exponential backoff, stale data detection
// Reads game/player state from the database API and updates the reactive store.

import { update, batch, get, subscribe } from './store.js';
import { API_BASE, POLL_INTERVALS } from './constants.js';

let consecutiveFails = 0;
const MAX_BACKOFF = 30000;
let gameTimer = null;
let playerTimer = null;
let healthTimer = null;
let jackpotPollTimer = null;

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

/**
 * Fetch full player dashboard from /player/:address and fan out all domain
 * fields to the store via batch(). Single call per D-03.
 * @param {string} address - Player wallet address
 */
export async function fetchPlayerData(address) {
  if (!address) return;
  try {
    const data = await fetchJSON(`/player/${address}`);
    const updates = [
      // Top-level summary
      ['player.balances.burnie', data.burnieBalance],
      ['player.balances.dgnrs', data.dgnrsBalance],
      ['player.balances.wwxrp', data.wwxrpBalance],
      ['player.claimable', data.claimableEth],
      ['player.shields', data.shields],

      // Coinflip (UI-01) — data.coinflip may be null
      ['coinflip.playerStake', data.coinflip?.depositedAmount ?? '0'],
      ['coinflip.claimable', data.coinflip?.claimablePreview ?? '0'],
      ['coinflip.autoRebuy', {
        enabled: data.coinflip?.autoRebuyEnabled ?? false,
        stop: data.coinflip?.autoRebuyStop ?? '0',
        carry: '0',  // not stored in DB; safe default per RESEARCH Pitfall 1
      }],
      ['coinflip.bounty.pool', data.coinflip?.currentBounty ?? '0'],
      ['coinflip.bounty.recordHolder', data.coinflip?.biggestFlipPlayer ?? null],
      ['coinflip.bounty.recordAmount', data.coinflip?.biggestFlipAmount ?? '0'],

      // Decimator (UI-02) — data.decimator may be null
      ['decimator.windowOpen', data.decimator?.windowOpen ?? false],
      // burnPool: compute 10% of futurePoolTotal (safe default; x00 detection requires windowLevel which API lacks)
      ['decimator.burnPool', data.decimator?.futurePoolTotal
        ? (BigInt(data.decimator.futurePoolTotal) * 10n / 100n).toString()
        : '0'],

      // Terminal (UI-03) — futurePool from decimator data (shared pool)
      ['terminal.futurePool', data.decimator?.futurePoolTotal ?? '0'],

      // Degenerette (UI-04) — data.degenerette may be null
      ['degenerette.playerNonce', data.degenerette?.betNonce ?? 0],

      // Affiliate (UI-05) — data.affiliate always present
      ['affiliate.referredBy', data.affiliate?.referrer ?? null],
      ['affiliate.code', data.affiliate?.ownCode ?? null],
      ['affiliate.totalEarned', data.totalAffiliateEarned ?? '0'],
    ];

    // Quest mapping (UI-06)
    if (data.quests?.length > 0) {
      const slots = [null, null];
      const progress = [0, 0];
      const completed = [false, false];
      for (const q of data.quests) {
        const i = q.slot;
        if (i === 0 || i === 1) {
          slots[i] = {
            day: q.day,
            questType: q.questType,
            highDifficulty: q.highDifficulty ?? false,
            requirements: {
              mints: q.requirementMints ?? 0,
              tokenAmount: q.requirementTokenAmount ?? '0',
            },
          };
          progress[i] = Number(q.progress);
          completed[i] = q.completed;
        }
      }
      updates.push(
        ['quest.slots', slots],
        ['quest.progress', progress],
        ['quest.completed', completed],
      );
    }

    // Quest streak
    if (data.questStreak) {
      updates.push(
        ['quest.baseStreak', data.questStreak.baseStreak ?? 0],
        ['quest.lastCompletedDay', data.questStreak.lastCompletedDay ?? 0],
      );
    }

    // Decimator claimable per level — pick current window level claim
    if (data.decimator?.claimablePerLevel?.length > 0) {
      const windowLevel = get('game.level') || 0;
      const claim = data.decimator.claimablePerLevel.find(c => c.level === windowLevel);
      if (claim) {
        updates.push(
          ['decimator.claimable', claim.ethAmount],
          ['decimator.isWinner', !claim.claimed && claim.ethAmount !== '0'],
        );
      }
    }

    batch(updates);
  } catch {
    // Non-critical — leave store unchanged on failure
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

  // Jackpot window polling (D-04): re-fetch player data every 30s during jackpot phase
  subscribe('game', (g) => {
    if (g?.phase === 'JACKPOT' && g?.jackpotDay > 0) {
      if (!jackpotPollTimer) {
        jackpotPollTimer = setInterval(() => {
          const addr = get('player.address');
          if (addr) fetchPlayerData(addr);
        }, 30000);
      }
    } else if (jackpotPollTimer) {
      clearInterval(jackpotPollTimer);
      jackpotPollTimer = null;
    }
  });
}

export function stopPolling() {
  clearTimeout(gameTimer);
  clearTimeout(playerTimer);
  clearInterval(healthTimer);
  if (jackpotPollTimer) {
    clearInterval(jackpotPollTimer);
    jackpotPollTimer = null;
  }
  gameTimer = null;
  playerTimer = null;
  healthTimer = null;
}

// Immediate re-fetch after user actions (D-07)
export async function refreshAfterAction() {
  const addr = get('player.address');
  await Promise.all([
    pollGameState(),
    pollPlayerData(),
    ...(addr ? [fetchPlayerData(addr)] : []),
  ]);
}

// Visibility change handler: re-fetch when tab becomes visible
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    pollGameState();
    pollPlayerData();
  }
});
