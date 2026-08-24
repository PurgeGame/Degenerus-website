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
  deployBlock: 45_907_853,
  // One canonical hosted indexer/API for both degener.us and localhost.
  indexerBase: 'https://degenerus-db.fly.dev',
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
  ICONS_32:                '0xa43271ec995cf8db4be63fcc1387c27f9960046c',
  GAME_MINT_MODULE:        '0x8b12b9e25778f6bad03a9b87d4e130e071570ece',
  GAME_ADVANCE_MODULE:     '0xe8b706e6ac1234b285a9e0c965d205f25dcf401a',
  GAME_WHALE_MODULE:       '0x2ebb0d6d362532735bceefff34ed4ecb43eb69ee',
  GAME_JACKPOT_MODULE:     '0xb9723cf36de8841d059fbfba693449fe79289045',
  GAME_DECIMATOR_MODULE:   '0x98cd70977da151d419cbef6403353abbc3934790',
  GAME_GAMEOVER_MODULE:    '0x3e03114317ffd5772d5b7fe6a9956061a1b6e8dc',
  GAME_LOOTBOX_MODULE:     '0x143f6609fa36d5a1e5afc1f15445f74f1974289d',
  GAME_BOON_MODULE:        '0x751a0b7bc45466246d4e5fd8411e088e62614272',
  GAME_DEGENERETTE_MODULE: '0x195afb9cab9804086c5365258ad70d2cec87c28c',
  GAME_BINGO_MODULE:       '0xc5bdb70c8c4b2d081284332d09f46309ed3fc8aa',
  GAME_AFKING_MODULE:      '0xa05f916278efbedb255c25613a600ebe110b0522',
  GAME_FOILPACK_MODULE:    '0x37be94224d116b26d1a8064e90457ce5548456aa',
  AFKING_SUB_TOKEN:        '0xf87e3fb0e085a50d88993319b187e882319ea9df',
  COIN:                    '0xfefc23d21958a66a0f37bf21bb0c67dc9d936533',
  COINFLIP:                '0xcd5cacab4a429d358d66b93711e9bd93bc821b2a',
  GAME:                    '0x956a02162d79feddf899b77f0a03c658c23b6db3',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0xcfae3b0ff25fcbf42b1bbb0c93057ae61f30f9eb',
  WWXRP:                   '0x724a161564e79a86d6de5ac4879af578422108ba',
  AFFILIATE:               '0xbbd2fa49ce964c2089dd77868ef4dc11deb030fe',
  JACKPOTS:                '0xdb2b3caae3e2842d2f62e42dab4f5fa821682053',
  QUESTS:                  '0xea2f3889185a4444f95af5a7ba946d85f1dd88ac',
  PARIMUTUEL:              '0xe92049d07baf0f1b1bac5e4421d2cd16b93dfffa',
  DEITY_PASS:              '0xc8151cdaefd9ca3f4bc3a59aebdef9702f5ca1a7',
  VAULT:                   '0xe59b7215a85bc87200ab5a95b9f17fdb61960bf3',
  SDGNRS:                  '0xc11f5ed6150be28ee7afe4fbe828bb59320c3e01',
  DGNRS:                   '0x108bfe399181107e1c2013860bd0acc2e79e2d8e',
  GNRUS:                   '0x670931684cc44a43f5fd3fc13151f97f0d41ec2c',
  ADMIN:                   '0x1ef0f8b47dbb3facc5777781bcb21a293b895cd6',
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
  deployDayBoundary: 2_979_168, // 0x956a0216… @ 45907853
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// REAL Reown project id, supplied by the user 2026-08-14 (replaced the demo
// placeholder whose relay answered "Project not found", so WC never connected).
export const WALLETCONNECT_PROJECT_ID = '168de5f2661e82f9976d6b05212c1d44';
