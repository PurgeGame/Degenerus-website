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
  deployBlock: 45_905_836,
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
  ICONS_32:                '0x35a2e4ae0c1cc4b74b123e04fbd44b5b192d3abd',
  GAME_MINT_MODULE:        '0x5bb214e6f48680a76beb59aef9c9ce331406ad91',
  GAME_ADVANCE_MODULE:     '0xced6f2132c647fdba7e417a1ef06943f2b25fd78',
  GAME_WHALE_MODULE:       '0xf164396b31027169a9dbf255d9b422cd50f7582b',
  GAME_JACKPOT_MODULE:     '0x1cf579e1d622111901762c04c57082b87791c61c',
  GAME_DECIMATOR_MODULE:   '0x45cf4047e6bda4ded81cf7b1e69fa792f8793b87',
  GAME_GAMEOVER_MODULE:    '0xd933ed651bb2887d5094857b102e8fc4cec3f5cd',
  GAME_LOOTBOX_MODULE:     '0x8021e9affeaa1b63b32a01d1f746a75ff3417c56',
  GAME_BOON_MODULE:        '0xfe12bb8529ceff4abd678f55917d39f74fd31457',
  GAME_DEGENERETTE_MODULE: '0xa2759f762b22115286ee0a61a45116d9f0a474d5',
  GAME_BINGO_MODULE:       '0xece2ecc0cb93ef9d566fc1e69ba1fdbfdc40f80c',
  GAME_AFKING_MODULE:      '0x5d25971975f200ab21f75531258551f559149904',
  GAME_FOILPACK_MODULE:    '0xf4256735586d897f7e6cf0539cc7409e221ceeb8',
  AFKING_SUB_TOKEN:        '0xcbd29b6c91431cc6fb21e0effb5cbbc49b5d95f8',
  COIN:                    '0xfc064d4376026705ef679c0311e6ed678614db32',
  COINFLIP:                '0x0b7a8b4a3974694dc2c671449d855ee0bfaa8ff5',
  GAME:                    '0xe10a14281d29947dd85c7ae3b8762ae596f83867',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x643defb52b58a64c107a2c19c9fdd5c72d2ef5c5',
  WWXRP:                   '0x864e2ee57ea77d35a3445420114d93a23424830c',
  AFFILIATE:               '0x6ab2b748084966c23b2cf283f9890f9bca2aeecd',
  JACKPOTS:                '0xe2d4e83a0de2b41c3f8fb42e04365eaf859b32bb',
  QUESTS:                  '0x6effc3d85579d1709c9cb17ebe772f86c72c8746',
  PARIMUTUEL:              '0x7f5516f7c169e3ee6f6fe84a7f1fbd05300174d1',
  DEITY_PASS:              '0xb356e58fa0db779681a97cfb68e0f93b35682c98',
  VAULT:                   '0x69af9d55c492aca917717e03b8f14f843e0fc37f',
  SDGNRS:                  '0xf5cd3dad397da35cd1d686132b1f7eeedf13f6ef',
  DGNRS:                   '0x3b5b196f737fe543d9d029d98143eecc2d898583',
  GNRUS:                   '0x719c09a2a94cce8006ea45b64468d706cca03125',
  ADMIN:                   '0x23789d196a9676a629e647796bf97affcf5c1e05',
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
  deployDayBoundary: 2_979_162, // 0xe10a1428… @ 45905836
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// REAL Reown project id, supplied by the user 2026-08-14 (replaced the demo
// placeholder whose relay answered "Project not found", so WC never connected).
export const WALLETCONNECT_PROJECT_ID = '168de5f2661e82f9976d6b05212c1d44';
