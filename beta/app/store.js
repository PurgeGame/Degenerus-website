// app/store.js -- Proxy-based reactive store with path-based subscriptions
// Per CONTEXT.md locked decision: store MUST use JavaScript Proxy.

const _state = {
  game: {
    level: 0,
    phase: 'PURCHASE',        // 'PURCHASE' | 'JACKPOT' | 'GAMEOVER'
    gameOver: false,
    rngLocked: false,
    price: null,               // wei string or null
    pools: { future: '0', next: '0', current: '0', claimable: '0' },
    decWindowOpen: false,
    levelStartTime: null,
    jackpotDay: 0,
    phaseTransitionActive: false,
    dailyRng: null,
  },
  player: {
    address: null,
    balances: { eth: '0', burnie: '0', dgnrs: '0', wwxrp: '0' },
    activityScore: { total: 0, quest: 0, mint: 0, affiliate: 0, pass: 0 },
    shields: 0,
    claimable: '0',
  },
  coinflip: {
    playerStake: '0',
    claimable: '0',
    autoRebuy: { enabled: false, stop: '0', carry: '0' },
    bounty: { pool: '0', recordHolder: null, recordAmount: '0' },
    lastResult: null,
  },
  ui: {
    connectionState: 'disconnected', // disconnected | connecting | connected | wrong-chain
    activePanel: null,
    pendingTxs: [],
    staleData: false,
    apiHealthy: true,
  },
  degenerette: {
    pendingBets: [],      // Array of { betId, rngIndex, currency, amount, ticketCount, timestamp }
    lastResults: [],      // Array of resolved bet results { betId, matches, payout, currency }
    playerNonce: 0,       // Current bet nonce from contract
  },
  quest: {
    slots: [null, null],  // QuestInfo[2] from getPlayerQuestView
    progress: [0, 0],     // uint128[2] progress values
    completed: [false, false],
    baseStreak: 0,
    lastCompletedDay: 0,
    shields: 0,
  },
  claims: {
    eth: '0',             // ETH claimable (after 1 wei sentinel subtraction)
    burnie: '0',          // BURNIE claimable from coinflip
  },
  affiliate: {
    code: null,           // Player's own affiliate code (string or null)
    referredBy: null,     // Address of referrer (or null)
    totalEarned: '0',     // Cumulative ETH earned (wei string)
  },
  baf: {
    playerScore: '0',     // Player's BAF score for current level
    top4: [],             // Array of { player, score, rank }
    prominence: 'low',    // 'high' | 'medium' | 'low'
  },
  decimator: {
    windowOpen: false,
    windowLevel: 0,
    playerBurnTotal: '0',
    playerBucket: 0,
    activityMultiplier: 1.0,
    burnPool: '0',
    claimable: '0',
    isWinner: false,
  },
  terminal: {
    decWindowOpen: false,
    decLevel: 0,
    playerBurnTotal: '0',
    timeMultiplier: 1.0,
    daysRemaining: 0,
    yieldAccumulator: '0',
    futurePool: '0',
    playerTicketsNextLevel: 0,
    claimable: '0',
    isWinner: false,
  },
  // Replay mode: populated by replay-panel on day-change; consumed by status-bar.
  replay: {
    day: null,    // currently selected game day (number | null)
    level: null,  // jackpot level for that day (number | null)
  },
};

// Shallow Proxy wrapping the top-level state object.
// Intercepts set traps on top-level keys and triggers notification.
// Nested updates go through update(path, value) which walks the path
// on _state directly and calls notify() manually.
const state = new Proxy(_state, {
  set(target, prop, value) {
    target[prop] = value;
    notify(prop);
    return true;
  },
  get(target, prop) {
    return target[prop];
  },
});

const listeners = new Map();

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

// Notify exact path AND all ancestor paths.
// E.g., updating 'player.balances.eth' notifies listeners on
// 'player.balances.eth', 'player.balances', and 'player'.
function notify(path) {
  const parts = path.split('.');
  let current = '';
  for (const part of parts) {
    current = current ? `${current}.${part}` : part;
    const set = listeners.get(current);
    if (set) set.forEach(fn => fn(getPath(state, current)));
  }
}

/**
 * Subscribe to state changes at a dot-separated path.
 * Callback is invoked immediately with current value, then on every change.
 * Returns an unsubscribe function.
 */
export function subscribe(path, callback) {
  if (!listeners.has(path)) listeners.set(path, new Set());
  listeners.get(path).add(callback);
  callback(getPath(state, path));
  return () => listeners.get(path)?.delete(callback);
}

/**
 * Update state at the given dot-separated path.
 * Walks _state directly (not through Proxy) to avoid redundant top-level notifications.
 */
export function update(path, value) {
  const parts = path.split('.');
  let obj = _state;
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
  obj[parts[parts.length - 1]] = value;
  notify(path);
}

/**
 * Read state at the given dot-separated path.
 */
export function get(path) {
  return getPath(state, path);
}

/**
 * Apply multiple updates atomically, then deduplicate notifications.
 * Each entry is [path, value].
 */
export function batch(updates) {
  const paths = [];
  for (const [path, value] of updates) {
    const parts = path.split('.');
    let obj = _state;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    paths.push(path);
  }
  // Deduplicate: each ancestor path fires at most once
  const notified = new Set();
  for (const path of paths) {
    const parts = path.split('.');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}.${part}` : part;
      if (!notified.has(current)) {
        notified.add(current);
        const set = listeners.get(current);
        if (set) set.forEach(fn => fn(getPath(state, current)));
      }
    }
  }
}
