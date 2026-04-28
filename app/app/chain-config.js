// website/app/app/chain-config.js
// MAINNET CUTOVER: change BOTH lines below from './chain-config.sepolia.js'
// to './chain-config.mainnet.js'. Two-line edit (the re-export AND the guard
// import must point at the same active profile). No other file in /app/
// needs to change.
export * from './chain-config.sepolia.js';

// WR-06: cutover guard. The mainnet profile ships placeholder rpcUrl='' /
// rpcUrls=[] until v5.0 cutover. If the cutover flips the imports above and
// below to './chain-config.mainnet.js' before those URLs are populated,
// fail loud at module-import time rather than letting JsonRpcProvider('')
// or wallet_addEthereumChain({rpcUrls: []}) emit confusing downstream errors.
//
// Until cutover, both imports point at sepolia (MAINNET_PENDING=false), so
// the guard is inert. Plan 56-05 verification asserts the active selector
// is sepolia.
import { MAINNET_PENDING as _ACTIVE_MAINNET_PENDING, CHAIN as _ACTIVE_CHAIN } from './chain-config.sepolia.js';
if (
  _ACTIVE_MAINNET_PENDING
  && (!_ACTIVE_CHAIN.rpcUrl
    || !_ACTIVE_CHAIN.nativeAddEntry
    || !_ACTIVE_CHAIN.nativeAddEntry.rpcUrls
    || _ACTIVE_CHAIN.nativeAddEntry.rpcUrls.length === 0)
) {
  throw new Error(
    '[chain-config] mainnet profile selected but RPC URLs are empty — '
    + 'populate CHAIN.rpcUrl and CHAIN.nativeAddEntry.rpcUrls in '
    + 'chain-config.mainnet.js before cutover.',
  );
}
