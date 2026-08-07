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
  deployBlock: 45_159_538,
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
  ICONS_32:                '0x316a0a826fecd118909338c437cbaea56bd18371',
  GAME_MINT_MODULE:        '0xb6a18ed006e68b09007587d92e1b04dc4f60efb1',
  GAME_ADVANCE_MODULE:     '0xda9abe30f6382bffd2e7dd563f84aee359830664',
  GAME_WHALE_MODULE:       '0x4316a45a794a5fa38bc90372b7f5d4b43dcdbe77',
  GAME_JACKPOT_MODULE:     '0xf52bc34b42c4b696368d0186241a4ff384dfd0f6',
  GAME_DECIMATOR_MODULE:   '0xfd374599efc5768bb7b9aeba46408842cff8501c',
  GAME_GAMEOVER_MODULE:    '0x9814350a34f30120329fedbadb68b96f818f0572',
  GAME_LOOTBOX_MODULE:     '0x20db15ec4d2d45ee4b7baab60dfdf4b8e0bdf42c',
  GAME_BOON_MODULE:        '0x61192e4cfd8ce1c8829bdaa28dbfa8275ad1ba53',
  GAME_DEGENERETTE_MODULE: '0x37e21b7c1e339ce59521268757a1af0f3b34fe63',
  GAME_BINGO_MODULE:       '0x555e35e7da4b702a6639ae873835c21265830936',
  GAME_AFKING_MODULE:      '0x0e2911ab70f763810b6601205ec5cce56fd6c4b7',
  GAME_FOILPACK_MODULE:    '0x892851b6590b635bec772c68d772c7cc650ccb9b',
  AFKING_SUB_TOKEN:        '0x57dba11e0cb674ae7be6b5d831081ec5e0de4986',
  COIN:                    '0x222828601647a7264b13924df0ca3dbe88f455ef',
  COINFLIP:                '0x7908e94db99ba66abf47b1db0a83ef9397f07705',
  GAME:                    '0x6d3dd6866bd213212013965e38d8310c40fbbdb5',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0xd26080e69ed2a35b26afc4d6d0e1e12c6deb0980',
  WWXRP:                   '0x942f8e3fced73ab69206fe2288240240ff922f2d',
  AFFILIATE:               '0xafd4fce94bdce6bc18954c7b8814ca3e21ca7096',
  JACKPOTS:                '0x2a6bc46ce01057be1fbf4adacb7811775b96c13a',
  QUESTS:                  '0x0466411b3124a68682167a827500e3762d209c38',
  PARIMUTUEL:              '0xd1c481699c634a1b232df40869e9bbae67c16792',
  DEITY_PASS:              '0x37cbc55945e8a87c83f4c9430d2b9bef15ae0f66',
  VAULT:                   '0x83d1cde17120bbe10746e0c959867ee8aed2fb40',
  SDGNRS:                  '0x241aa53d77b9cce31eaa25a67ff407b06307e4ad',
  DGNRS:                   '0x44949d6c301e3b00785d91238feefdb431568955',
  GNRUS:                   '0xed14ebf1e8a5d2a3571e11ec16c75e8804a83428',
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
  deployDayBoundary: 2_976_674, // 0x6d3dd686… @ 45159538
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// TODO(63-01): replace with real cloud.reown.com projectId before mainnet deploy.
// User pre-authorized demo value (2026-04-29) — autonomous-chain placeholder.
export const WALLETCONNECT_PROJECT_ID = 'demoa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
