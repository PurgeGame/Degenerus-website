// app/wallet.js -- EIP-6963 wallet discovery with MetaMask fallback
// Handles multi-wallet detection, connection, chain verification,
// auto-reconnect, and bidirectional sync with nav.js via CustomEvents.

import { update, get } from './store.js';
import { emit } from './events.js';
import { initProvider, checkChain, switchToSepolia, readActivityScore, readEthBalance } from './contracts.js';
import { pollPlayerData } from './api.js';
import { CHAIN } from './constants.js';

const LAST_WALLET_KEY = 'degenerus_last_wallet';
const discoveredProviders = [];

// --- EIP-6963 Discovery ---

export function discoverWallets() {
  window.addEventListener('eip6963:announceProvider', (event) => {
    const { info, provider } = event.detail;
    if (discoveredProviders.some(p => p.info.uuid === info.uuid)) return;
    discoveredProviders.push({ info, provider });
    emit('wallet:discovered', { info, provider });
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export function getDiscoveredProviders() {
  return [...discoveredProviders];
}

// Fallback for wallets that don't support EIP-6963
function getFallbackProvider() {
  if (discoveredProviders.length > 0) return null;
  if (window.ethereum) {
    return {
      info: {
        uuid: 'legacy-injected',
        name: window.ethereum.isMetaMask ? 'MetaMask' : 'Browser Wallet',
        icon: '',
        rdns: 'unknown',
      },
      provider: window.ethereum,
    };
  }
  return null;
}

// --- Connection ---

export async function connectWallet(providerEntry) {
  // If no specific provider given, use first discovered or fallback
  if (!providerEntry) {
    providerEntry = discoveredProviders[0] || getFallbackProvider();
  }
  if (!providerEntry) {
    update('ui.connectionState', 'disconnected');
    emit('wallet:error', { message: 'No wallet detected' });
    return false;
  }

  update('ui.connectionState', 'connecting');

  try {
    const walletProvider = providerEntry.provider;

    // Request accounts
    const accounts = await walletProvider.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) {
      update('ui.connectionState', 'disconnected');
      return false;
    }

    const address = accounts[0];

    // Initialize ethers provider
    initProvider(walletProvider);

    // Check chain
    const correctChain = await checkChain();
    if (!correctChain) {
      update('ui.connectionState', 'wrong-chain');
      const switched = await switchToSepolia(walletProvider);
      if (!switched) {
        emit('wallet:wrong-chain', { expected: CHAIN.id });
        return false;
      }
      // Re-init provider after chain switch
      initProvider(walletProvider);
    }

    // Update store
    update('player.address', address);
    update('ui.connectionState', 'connected');

    // Save for auto-reconnect
    localStorage.setItem(LAST_WALLET_KEY, providerEntry.info.rdns || providerEntry.info.uuid);

    // Fetch initial player data
    const [ethBalance, activityScore] = await Promise.all([
      readEthBalance(address),
      readActivityScore(address),
    ]);
    if (ethBalance !== null) update('player.balances.eth', ethBalance);
    if (activityScore !== null) update('player.activityScore.total', activityScore);

    // Trigger player data poll from API
    pollPlayerData();

    emit('wallet:connected', { address });

    // Listen for account/chain changes
    walletProvider.on?.('accountsChanged', handleAccountsChanged);
    walletProvider.on?.('chainChanged', handleChainChanged);

    return true;
  } catch (err) {
    update('ui.connectionState', 'disconnected');
    emit('wallet:error', { message: err.message || 'Connection failed' });
    return false;
  }
}

export function disconnectWallet() {
  update('player.address', null);
  update('ui.connectionState', 'disconnected');
  localStorage.removeItem(LAST_WALLET_KEY);
  emit('wallet:disconnected', {});
}

// --- Auto-reconnect ---

export async function autoReconnect() {
  const savedId = localStorage.getItem(LAST_WALLET_KEY);
  if (!savedId) return false;

  // Wait briefly for EIP-6963 providers to announce
  await new Promise(resolve => setTimeout(resolve, 500));

  // Find matching provider
  let match = discoveredProviders.find(
    p => p.info.rdns === savedId || p.info.uuid === savedId
  );

  // Fallback check
  if (!match && savedId === 'legacy-injected') {
    match = getFallbackProvider();
  }

  if (!match) {
    // Provider not found. Try the fallback if window.ethereum exists.
    const fb = getFallbackProvider();
    if (fb) match = fb;
  }

  if (!match) return false;

  // Try silent connection (eth_accounts, not eth_requestAccounts -- no popup)
  try {
    const accounts = await match.provider.request({ method: 'eth_accounts' });
    if (accounts && accounts.length > 0) {
      return connectWallet(match);
    }
  } catch {
    // Silent reconnect failed -- not an error, just means user needs to connect manually
  }
  return false;
}

// --- Event Handlers ---

function handleAccountsChanged(accounts) {
  if (!accounts || accounts.length === 0) {
    disconnectWallet();
  } else {
    update('player.address', accounts[0]);
    emit('wallet:accountChanged', { address: accounts[0] });
    pollPlayerData();
  }
}

function handleChainChanged(chainIdHex) {
  const chainId = parseInt(chainIdHex, 16);
  if (chainId !== CHAIN.id) {
    update('ui.connectionState', 'wrong-chain');
    emit('wallet:wrong-chain', { expected: CHAIN.id, actual: chainId });
  } else {
    update('ui.connectionState', 'connected');
    emit('wallet:chainChanged', { chainId });
  }
}

// --- Listen for nav.js bridge events ---

document.addEventListener('wallet-connected', (e) => {
  const address = e.detail?.address;
  if (address && get('ui.connectionState') !== 'connected') {
    // nav.js connected a wallet before our module loaded.
    // Sync our store state.
    update('player.address', address);
    update('ui.connectionState', 'connected');
    pollPlayerData();
  }
});

document.addEventListener('wallet-disconnected', () => {
  if (get('ui.connectionState') === 'connected') {
    disconnectWallet();
  }
});
