// website/app/app/chain-config.sepolia.js
// ACTIVE TESTNET PROFILE — Base Sepolia (chainId 84532). Sourced from
// degenerus-sim/.testnet/sepolia-manifest.json (mirrored at website/db/deployment.json).
// Addresses inlined verbatim (lowercase, no checksum) for diff stability.
// Filename kept as chain-config.sepolia.js: it is the testnet slot the
// chain-config.js selector points at (mainnet cutover flips to .mainnet.js).

export const CHAIN = {
  id: 84532,
  hexId: '0x14a34',
  name: 'Base Sepolia',
  // READ path for every public provider in the app (polling, coinflip, quests,
  // charity-vote, pack-watch, claims/decimator raw-slot reads).
  // NOT sepolia.base.org: that endpoint rate-limits hard under this app's read
  // volume — a burst of 25 eth_blockNumber calls measured 17/25 HTTP 429, which
  // surfaced as dozens of console 429s and blank panels on a single page load.
  // publicnode answered 25/25 and supports every method used here
  // (eth_call, eth_getStorageAt, eth_getLogs). sepolia.base.org is retained
  // below as the wallet-add fallback.
  rpcUrl: 'https://base-sepolia-rpc.publicnode.com',
  deployBlock: 45_161_197,
  indexerBase: 'http://localhost:3000',
  etherscanBase: 'https://sepolia.basescan.org',
  nativeAddEntry: {
    chainId: '0x14a34',
    chainName: 'Base Sepolia',
    // Order matters: wallets take the first that works. The rate-limited
    // canonical endpoint stays as a fallback rather than the default.
    rpcUrls: ['https://base-sepolia-rpc.publicnode.com', 'https://sepolia.base.org'],
    nativeCurrency: { name: 'Base Sepolia ETH', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://sepolia.basescan.org'],
  },
};

// 27 contract addresses from the current Base Sepolia deploy manifest
// (GAME 0x54ad8e5f...1044, deploy block 45005925). ADMIN excluded per Plan 56-01
// (deployer-only EOA reference, not a player-facing contract).
export const CONTRACTS = {
  ICONS_32:                '0x250ef2594d904e053df350d5d35ad2cee2cf9554',
  GAME_MINT_MODULE:        '0x4b70a9a509ac8c0cfc633b3bc492a4bc77ef7842',
  GAME_ADVANCE_MODULE:     '0xe888458177757805ef302bb26974a087de1f2baa',
  GAME_WHALE_MODULE:       '0xdcd62630124adebe71dd0d4764b0dfccc509719f',
  GAME_JACKPOT_MODULE:     '0x5f66e54e834a61b6efba0815d1e8118fa276be21',
  GAME_DECIMATOR_MODULE:   '0x4907cc578417a48d74cffede0ca21131278e2529',
  GAME_GAMEOVER_MODULE:    '0xa028320aea04202f62da51ebe06e61b8596a990b',
  GAME_LOOTBOX_MODULE:     '0xc57638f0e5b9a281a1d0c7527bc4e0c74a52a214',
  GAME_BOON_MODULE:        '0x9014a36e58ec8b661e9b807e8e36501d983fead6',
  GAME_DEGENERETTE_MODULE: '0xa4e42fc6bac118dc7506a816ba5552cc440f09e4',
  GAME_BINGO_MODULE:       '0x592bc665bba6ad5ddd1143639bce4384d5af8feb',
  GAME_AFKING_MODULE:      '0x22c458bc37e7658ee9442d9ffd12230b9af02a04',
  GAME_FOILPACK_MODULE:    '0x9f668b6dba7c995489b778a65146487b4227702e',
  AFKING_SUB_TOKEN:        '0x5285fc1768ed66707755cf66f5110f78f9b14040',
  COIN:                    '0x3cb8572f87d5989cc5855c0005a3b9350689479a',
  COINFLIP:                '0x06ae635963f9c0a716b609e5e23c7a3073facb90',
  GAME:                    '0xef9de925f59382293d4e394aebb0ab4399e0d4b9',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x47804351c3c506cfb818126272cbf9445eb5bc49',
  WWXRP:                   '0xd383800983fe2d02271494c44056d30411765ec1',
  AFFILIATE:               '0xf6be2b5487632c203e7db922f13d5732b54ac90f',
  JACKPOTS:                '0x4c7869599c04ab848bd50bed4fea2f35cae0a6c2',
  QUESTS:                  '0x42f4c5c6cc57b0e30e5b637d3334c861156565fc',
  PARIMUTUEL:              '0x1fdeb40cdbe8fce4f54285fd374a8fad27f65f19',
  DEITY_PASS:              '0x9058d2d151ae556226a16cfc71608646a701d164',
  VAULT:                   '0xff3af941321335849498d64bc56da75ed56642ea',
  SDGNRS:                  '0xa7b0d20278f3e1ba84d6b43d23e4b05bcae47be6',
  DGNRS:                   '0x3104b793ee09a312319ed29b4d23a85c39225c71',
  GNRUS:                   '0xbeb45b2d3c31a1a020c71a4195a447b0dec0df18',
};

// Ticket-volume parimutuel window, for the COUNTDOWN ONLY — the contract's own
// `openRound` return is what gates the buttons. Mirrors this deploy's current
// contracts-testnet/DegenerusParimutuel.sol:478 `(ts - 82620) % 600 < 540` and
// its rescaled credit ladder (25 FLIP, -5 per 86s from 154s into the game day).
// The testnet overlay rescales the window with the day; mainnet does NOT
// (see chain-config.mainnet.js).
export const VOLUME_WINDOW = {
  anchor: 82_620,        // GameTimeLib.JACKPOT_RESET_TIME — 22:57 UTC, the day boundary
  period: 600,           // one game day (600s testnet overlay)
  // Readiness polling hint only. The visible clock uses the exact boundary so
  // the real keeper/RNG activation lag remains observable.
  jackpotReadyDelay: 60,
  openSeconds: 540,      // betting is open for the first nine minutes
  creditDecayStart: 154, // full 25 FLIP through the first rescaled credit tier
  creditDecayStep: 86,   // -5 FLIP per rescaled step
  leadSeconds: 90,       // how early the widget surfaces the card ahead of the open
  // ContractAddresses.DEPLOY_DAY_BOUNDARY — day indices are DEPLOY-relative
  // (GameTimeLib:34, day 1 = deploy day), so the volume book's rounds are small
  // numbers, not epoch-scale ones. REDEPLOY-SENSITIVE: this moves with every
  // deploy; it is `deployDayBoundary` in the sim's sepolia-manifest.json and
  // must be re-copied alongside the addresses above. Verified against live
  // VolumeRoundSealed logs (round 22 sealed on day index 22).
  deployDayBoundary: 2_976_680, // 0xef9de925… @ 45161197
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// TODO(63-01): replace with real cloud.reown.com projectId before mainnet deploy.
// User pre-authorized demo value (2026-04-29) — autonomous-chain placeholder.
export const WALLETCONNECT_PROJECT_ID = 'demoa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
