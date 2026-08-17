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
  // Transport failover for the shared read provider (read-provider.js): tried
  // in order when rpcUrl fails at the HTTP/network level (outage, 429, hang).
  // base.org 429'd under the FULL pre-multicall read volume (17/25 measured),
  // but as an emergency lane for today's aggregated volume, degraded beats dead.
  fallbackRpcUrls: ['https://sepolia.base.org'],
  // Gold Rush is intentionally restricted to an explicitly keyless endpoint.
  // Keeping this separate from rpcUrl prevents a future private provider key
  // from silently turning browser ticker traffic into our infrastructure bill.
  goldRushPublicRpcUrl: 'https://base-sepolia-rpc.publicnode.com',
  deployBlock: 45_578_224,
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

// Current Base Sepolia deployment. ADMIN and LINK_TOKEN are included because
// the player-facing ERC-677 donation rail sends LINK directly to ADMIN's
// onTokenTransfer callback.
export const CONTRACTS = {
  ICONS_32:                '0x825566804f2e6adbbdfb7d0287472733dd553520',
  GAME_MINT_MODULE:        '0xe96c48c1725b547718fb5be335e7a27a58079fb5',
  GAME_ADVANCE_MODULE:     '0x4481ff1663b99b54fa494bf7f47580007fdba177',
  GAME_WHALE_MODULE:       '0x89a5d0c9d47c31f223089080ab7537c0541a8c24',
  GAME_JACKPOT_MODULE:     '0x01a7f302d552ba3faef9e4788cedee0f1ca23c57',
  GAME_DECIMATOR_MODULE:   '0x51f957dd31611894e963127fff0590502833a248',
  GAME_GAMEOVER_MODULE:    '0x1732bc673c8afccab27beb57d747972dbb207077',
  GAME_LOOTBOX_MODULE:     '0x1da2a514a87b3b9f2e3cd0d0c11d1e5ed5b78eb3',
  GAME_BOON_MODULE:        '0xe5cb5e53f11b4f510af4f5e70671cab937e0da02',
  GAME_DEGENERETTE_MODULE: '0xe2c717f90d62a045754b3b1c944104523544861e',
  GAME_BINGO_MODULE:       '0xdc29f315facb97e344d06e9710917b1698b495f8',
  GAME_AFKING_MODULE:      '0xcbcd2f97c1a8fe8e137a873a348d252cdb58d807',
  GAME_FOILPACK_MODULE:    '0xa039875fd1ca3bb37b7652a6b6700db8d8a53807',
  AFKING_SUB_TOKEN:        '0xdd356e8064310fd506905d814c73b9d333ec7d45',
  COIN:                    '0xf89c358cf9b1b90dd77b395fec466c6d11504064',
  COINFLIP:                '0xd73cc1b313cb83dacb431506a9f18decc069355a',
  GAME:                    '0x0de3e69c5876a857bd45d150d7ad49932102f3e6',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0xe5ab5e3662e687f89702cba8b1f692515b74e0ff',
  WWXRP:                   '0x7dd4f3e5fb0ae71a56d0679376ed3beedf5e0fb3',
  AFFILIATE:               '0x4aac0cd330c3404fa2b39409bb4add886774505d',
  JACKPOTS:                '0x372add762869138eda4b6becef27dfca6fd20b5f',
  QUESTS:                  '0x3babe040a3e08ce3ceb07d959c124ebea58aa9ce',
  PARIMUTUEL:              '0xfe510757024dfd5b7687d5d1c4a9b99805d307f6',
  DEITY_PASS:              '0x6497037849d97281f47be9666702c9fed5f8cbf8',
  VAULT:                   '0x2e4a7e4ce94ba151361cc893462d30da98acb647',
  SDGNRS:                  '0x57092524e55159ab8c9e886a3ee2ac3a145074e0',
  DGNRS:                   '0x98a1000689e7f7a5ed099275e03d762afa554814',
  GNRUS:                   '0x61a92558df45f64676bbe214e5837ae2e4c04bc1',
  ADMIN:                   '0xfe9f891642e30e82a30dc7de2088abf03fe6a49e',
  // Exact LINK constant compiled into this deployment's verified ADMIN.
  LINK_TOKEN:              '0xe4ab69c077896252fafbd49efd26b5d171a32410',
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
  deployDayBoundary: 2_978_070, // 0x0de3e69c… @ 45578224
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// REAL Reown project id, supplied by the user 2026-08-14 (replaced the demo
// placeholder whose relay answered "Project not found", so WC never connected).
export const WALLETCONNECT_PROJECT_ID = '168de5f2661e82f9976d6b05212c1d44';
