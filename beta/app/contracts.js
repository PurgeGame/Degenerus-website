// app/contracts.js -- ethers.js contract setup with receipt verification
// Wraps provider/signer management and provides sendTx() with proper
// receipt.status checking (fixing the existing mint.js bug).

import { ethers } from 'ethers';
import { emit } from './events.js';
import { CHAIN, CONTRACTS, ETHERSCAN_BASE } from './constants.js';

let provider = null;
let signer = null;

export function initProvider(walletProvider) {
  provider = new ethers.BrowserProvider(walletProvider, {
    name: CHAIN.name,
    chainId: CHAIN.id,
  });
  return provider;
}

export async function getSigner() {
  if (!provider) throw new Error('Provider not initialized. Connect wallet first.');
  signer = await provider.getSigner();
  return signer;
}

export function getContract(address, abi) {
  if (!signer) throw new Error('Signer not available. Connect wallet first.');
  return new ethers.Contract(address, abi, signer);
}

export async function sendTx(txPromise, action) {
  const txId = crypto.randomUUID();
  emit('tx:pending', { txId, action });
  try {
    const tx = await txPromise;
    emit('tx:submitted', { txId, hash: tx.hash, action });
    const receipt = await tx.wait();
    // CRITICAL: Check receipt.status. The old mint.js (line 756-757) did NOT
    // check this, treating any mined tx as success. Reverted txs are still
    // mined but have status === 0.
    if (receipt.status === 0) {
      emit('tx:reverted', { txId, hash: tx.hash, action });
      throw new Error(`Transaction reverted: ${tx.hash}`);
    }
    emit('tx:confirmed', { txId, hash: tx.hash, receipt, action });
    return receipt;
  } catch (err) {
    // Distinguish user rejection from other errors
    if (err.code === 'ACTION_REJECTED' || err.code === 4001) {
      emit('tx:rejected', { txId, action, error: err });
    } else {
      emit('tx:error', { txId, action, error: err });
    }
    throw err;
  }
}

// ABI fragments for read-only calls (no signer needed)
export const READ_ABIS = {
  activityScore: ['function playerActivityScore(address) view returns (uint256)'],
  ethBalance: ['function balanceOf(address) view returns (uint256)'],
};

// Read player activity score from contract (returns bps)
export async function readActivityScore(address) {
  if (!provider) return null;
  const game = new ethers.Contract(CONTRACTS.GAME, READ_ABIS.activityScore, provider);
  try {
    const score = await game.playerActivityScore(address);
    return Number(score);
  } catch {
    return null;
  }
}

// Read ETH balance for the connected wallet
export async function readEthBalance(address) {
  if (!provider) return null;
  try {
    const balance = await provider.getBalance(address);
    return balance.toString();
  } catch {
    return null;
  }
}

// Check if connected to correct chain
export async function checkChain() {
  if (!provider) return false;
  try {
    const network = await provider.getNetwork();
    return Number(network.chainId) === CHAIN.id;
  } catch {
    return false;
  }
}

// Request chain switch to Sepolia
export async function switchToSepolia(walletProvider) {
  try {
    await walletProvider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x' + CHAIN.id.toString(16) }],
    });
    return true;
  } catch (err) {
    // 4902 = chain not added to wallet
    if (err.code === 4902) {
      try {
        await walletProvider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x' + CHAIN.id.toString(16),
            chainName: CHAIN.name,
            rpcUrls: [CHAIN.rpcUrl],
            blockExplorerUrls: [ETHERSCAN_BASE],
          }],
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}
