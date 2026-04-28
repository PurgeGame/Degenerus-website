// website/app/app/chain-config.mainnet.js
// Mainnet profile — addresses populated at v5.0 mainnet cutover.
// MAINNET_PENDING = true is the canonical flag downstream phases check.
//
// WR-06 PRE-CUTOVER REMINDER: rpcUrl and nativeAddEntry.rpcUrls below are
// placeholders. BEFORE flipping chain-config.js to import this file, populate
// both with a non-empty production RPC URL (see ../shared/nav.js usage and
// EIP-3085 wallet_addEthereumChain validation requirements). The guard in
// chain-config.js will throw at import-time if either is left empty after
// cutover.

export const CHAIN = {
  id: 1,
  hexId: '0x1',
  name: 'Ethereum',
  rpcUrl: '',  // WR-06: populate before cutover (e.g. 'https://eth.llamarpc.com')
  indexerBase: 'https://api.degener.us',
  etherscanBase: 'https://etherscan.io',
  nativeAddEntry: {
    chainId: '0x1',
    chainName: 'Ethereum',
    rpcUrls: [],  // WR-06: populate before cutover; EIP-3085 requires non-empty array
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://etherscan.io'],
  },
};

// 21 contract slots — populated at v5.0 mainnet cutover.
// `null` placeholder keeps the file forward-compatible without introducing
// hex-address literals (Pitfall 1 grep gate).
export const CONTRACTS = {
  ICONS_32:                null,
  GAME_MINT_MODULE:        null,
  GAME_ADVANCE_MODULE:     null,
  GAME_WHALE_MODULE:       null,
  GAME_JACKPOT_MODULE:     null,
  GAME_DECIMATOR_MODULE:   null,
  GAME_GAMEOVER_MODULE:    null,
  GAME_LOOTBOX_MODULE:     null,
  GAME_BOON_MODULE:        null,
  GAME_DEGENERETTE_MODULE: null,
  COIN:                    null,
  COINFLIP:                null,
  GAME:                    null,
  WWXRP:                   null,
  AFFILIATE:               null,
  JACKPOTS:                null,
  QUESTS:                  null,
  DEITY_PASS:              null,
  VAULT:                   null,
  SDGNRS:                  null,
  DGNRS:                   null,
};

export const ETH_DIVISOR = 1n;             // No /1M scaling on mainnet
export const TICKET_DIVISOR = 100n;        // BAF scaling preserved
export const MAINNET_PENDING = true;       // Phase 56 verification asserts true
