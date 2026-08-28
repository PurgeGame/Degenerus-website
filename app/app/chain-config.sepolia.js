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
  deployBlock: 46_081_195,
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
  ICONS_32:                '0xf38ba26a6ca8af0452e5fe515715267b21d8f42b',
  GAME_MINT_MODULE:        '0x4929ebf0f6b2ff7e996abe22b2bdc84b2177ba6f',
  GAME_ADVANCE_MODULE:     '0xdc0d02fd352820cecfc3370d3ad0852183032c83',
  GAME_WHALE_MODULE:       '0x55fa4cff4b5508e0ad6c46f4b4e6d95b4930eeed',
  GAME_JACKPOT_MODULE:     '0x27ad52b50b53d015c8ba1eb48bc28abb923e8f0b',
  GAME_DECIMATOR_MODULE:   '0xd15380eb74c7889fe584929fd6f6eacd9a2bd648',
  GAME_GAMEOVER_MODULE:    '0x2d5374a0b25fe10543c2c4a838d055d485c39c10',
  GAME_LOOTBOX_MODULE:     '0xc2168c0dfeb300bbea96649a3961c4301edaad1d',
  GAME_BOON_MODULE:        '0x6003e09df8cb0d275cc7ebdfe9586efd4e81dcba',
  GAME_DEGENERETTE_MODULE: '0xbcc9ef748aa2754b13f00562bf2056ce733029cc',
  GAME_BINGO_MODULE:       '0xb26ee2f7439073f7dc157331dd9fa5bb71208c32',
  GAME_AFKING_MODULE:      '0x0a7d4486a1de83bca84c6d3447ec242772122b60',
  GAME_FOILPACK_MODULE:    '0x70793fde788ff63a2a722612a5c11438abc223f9',
  AFKING_SUB_TOKEN:        '0x89e498a2d1b06cf852006925cf4cb123669b9c41',
  COIN:                    '0x00182d6ee6f6c625e6f194117a2c351574b6d7a3',
  COINFLIP:                '0xf5f650c56eeae593d1a88df58259ffa5470203bd',
  // FlipCraps is built into the UI but not deployed yet.
  CRAPS:                   null,
  GAME:                    '0x99e51f7e63bca418f8b9cdf64581479e84d5fd0b',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x153de2eab9d5c093ced036997063bcca56033021',
  WWXRP:                   '0xaf5f20e349605f3e925def5f0133dff4c72a8cc5',
  AFFILIATE:               '0xcc0e31e287e4fceba1399d470f33bf31e602dead',
  JACKPOTS:                '0x5004cc844e051c1dfcd624b2b11566bd10f063c9',
  QUESTS:                  '0x8ae6adaba21d7a47cd5d394b5ebefedd6c30af39',
  PARIMUTUEL:              '0x5f543dadedcf1a48fbc1ed91cb2f725e161c0850',
  DEITY_PASS:              '0xf5270d8621cdb318d6aac82bea6d9bccbde8b5c5',
  VAULT:                   '0xccd3b48a528d680b0c89d0051b6244e5549d2544',
  SDGNRS:                  '0xdbef127b386692dd7954c6e5de2f85ca9e0923ed',
  DGNRS:                   '0xb37a9f72920b53ebed34886e0fd4a442c5cd7810',
  GNRUS:                   '0x096c3512d347e96b64f9e5bb63d3897794e9d12f',
  ADMIN:                   '0x778c646cbac5cf9ccc8fe3141790b98de1fed91f',
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
  deployDayBoundary: 1_489_873, // 0x99e51f7e… @ 46081195
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// REAL Reown project id, supplied by the user 2026-08-14 (replaced the demo
// placeholder whose relay answered "Project not found", so WC never connected).
export const WALLETCONNECT_PROJECT_ID = '168de5f2661e82f9976d6b05212c1d44';
