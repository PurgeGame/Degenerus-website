// app/main.js -- Application bootstrap
// Wires all foundation modules together: wallet discovery, router,
// API polling, component registration, transaction event handling.

// Import components (side-effect: registers Custom Elements)
import '../components/status-bar.js';
import '../components/connect-prompt.js';
import '../components/purchase-panel.js';
import '../components/tx-status-list.js';

// Import modules
import { update, get } from './store.js';
import { on } from './events.js';
import { startPolling, checkHealth } from './api.js';
import { discoverWallets, autoReconnect } from './wallet.js';
import { initRouter } from './router.js';

async function init() {
  console.log('[Degenerus] Initializing v2.0...');

  // 1. Start wallet discovery (EIP-6963)
  discoverWallets();

  // 2. Initialize router (subscribes to store, manages panel visibility)
  initRouter();

  // 3. Check API health before starting data polls
  const health = await checkHealth();
  if (health) {
    console.log(`[Degenerus] API healthy. Indexed block: ${health.indexedBlock}, lag: ${health.lagSeconds}s`);
  } else {
    console.warn('[Degenerus] API health check failed. Data polling will retry with backoff.');
  }

  // 4. Start polling game state (runs regardless of wallet connection)
  startPolling();

  // 5. Attempt auto-reconnect to last wallet
  const reconnected = await autoReconnect();
  if (reconnected) {
    console.log('[Degenerus] Auto-reconnected to wallet.');
  }

  // 6. Wire transaction lifecycle events to store
  on('tx:pending', ({ txId, action }) => {
    const pending = [...getTxList(), { txId, action, status: 'pending', hash: null }];
    update('ui.pendingTxs', pending);
  });

  on('tx:submitted', ({ txId, hash }) => {
    updateTxStatus(txId, 'submitted', hash);
  });

  on('tx:confirmed', ({ txId, hash }) => {
    updateTxStatus(txId, 'confirmed', hash);
    setTimeout(() => removeTx(txId), 5000);
  });

  on('tx:reverted', ({ txId, hash }) => {
    updateTxStatus(txId, 'reverted', hash);
    setTimeout(() => removeTx(txId), 10000);
  });

  on('tx:rejected', ({ txId }) => {
    removeTx(txId);
  });

  on('tx:error', ({ txId }) => {
    updateTxStatus(txId, 'error', null);
    setTimeout(() => removeTx(txId), 10000);
  });

  console.log('[Degenerus] Initialization complete.');
}

// Transaction list helpers
function getTxList() {
  return get('ui.pendingTxs') || [];
}

function updateTxStatus(txId, status, hash) {
  const list = getTxList().map(tx =>
    tx.txId === txId ? { ...tx, status, hash: hash || tx.hash } : tx
  );
  update('ui.pendingTxs', list);
}

function removeTx(txId) {
  const list = getTxList().filter(tx => tx.txId !== txId);
  update('ui.pendingTxs', list);
}

init().catch(err => {
  console.error('[Degenerus] Initialization failed:', err);
});
