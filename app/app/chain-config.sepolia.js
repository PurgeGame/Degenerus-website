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
  deployBlock: 46_133_083,
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
  ICONS_32:                '0xf512dcd533e72fe12d7bdaea2a99bde5da4f1a49',
  GAME_MINT_MODULE:        '0x7d1a829ea9bbcb5e2afd5504145404e0687257e8',
  GAME_ADVANCE_MODULE:     '0xf46d68929808b0543e7abc652ef49603968ff8c3',
  GAME_WHALE_MODULE:       '0x76b7b3ade77cffebafb02ef1d740fc1e2a719a57',
  GAME_JACKPOT_MODULE:     '0xdf72c96c386aa1f5e738a4e39857ea50432ad0d9',
  GAME_DECIMATOR_MODULE:   '0xdc448da7e5a7928b2ecf0e78f9267d5322a380a3',
  GAME_GAMEOVER_MODULE:    '0x282da091a3664579faa3640e8f15128ce7d06146',
  GAME_LOOTBOX_MODULE:     '0x65e7d4b99ba372f510332124eaff3e24895d3e06',
  GAME_BOON_MODULE:        '0x06c8b1b01a8cf2576e89b454f5156ea57f1c55d9',
  GAME_DEGENERETTE_MODULE: '0x88ad3a2b5a2e0de579b56e51873fd533bfda00d7',
  GAME_BINGO_MODULE:       '0xd9b8002c8f65f08f51ba38cd553932ab7daac9a3',
  GAME_AFKING_MODULE:      '0x7727127edc66de014b5760b22939d3eb0f7ed1ee',
  GAME_FOILPACK_MODULE:    '0x4c5c15c816cbb5f9c346ea9765837396d808f571',
  AFKING_SUB_TOKEN:        '0xa3570afe2be3761d9996e737a122fcd9211d8e9d',
  COIN:                    '0xbb9f2531c4bb3df6d41760e0ea3756c09540c2d3',
  COINFLIP:                '0xd1d475e59e14c791fe2a1f9fbc6ccbb2b5984d07',
  // CrapsBattle — run #42, verified at deploy block 46,081,197.
  CRAPS:                   '0x006c1c3978475b1e6533ec598af6f51934082053',
  GAME:                    '0xc74dd514f0e242ce8cfb267880dd55dbbe1d950a',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x6e35cbb1e63aadc447ea8e865509e4ecb12b0ff2',
  WWXRP:                   '0x6b3ddacd849f8649c2a87ee6ad59aec1e41ba1fb',
  AFFILIATE:               '0x1683ef2e6e2041e25544b3b5c069aa2e9fd66e04',
  JACKPOTS:                '0x9ce258fc7a0d6c64d0f261370545382b4fdde1ae',
  QUESTS:                  '0x54bfb2a471cebf99d52d8fc9d452ec5891cb73dc',
  PARIMUTUEL:              '0x2f6fe81c8911e46a3151064b2169b7676266669b',
  DEITY_PASS:              '0xab19db0ee9ee4a79b7daa2d0a5025e5811923300',
  VAULT:                   '0x85ab42715cbbd48e51cec829f0f25c785a3192b4',
  SDGNRS:                  '0xc009d4e97238f5d8617c6b0d36f1a53b745d7d82',
  DGNRS:                   '0x4d82df612b8bf6cdcf09bbaf1cc4162e8d94694b',
  GNRUS:                   '0xa0202e641dfaaffec9a3ac36c7e0db287c0fec3b',
  ADMIN:                   '0xef36da61db853c94448f3ba8d32fb544d6181d41',
  // Exact LINK constant compiled into this deployment's verified ADMIN.
  LINK_TOKEN:              '0xe4ab69c077896252fafbd49efd26b5d171a32410',
};

// Ticket-volume parimutuel window, for the COUNTDOWN ONLY — the contract's own
// `openRound` return is what gates the buttons. Mirrors this deploy's current
// contracts-testnet/DegenerusParimutuel.sol:478 `(ts - 82620) % 600 < 540` and
// its rescaled credit ladder (25 FLIP, -5 per 86s from 154s into the game day).
// The testnet overlay rescales the window with the day; mainnet does NOT
// (see chain-config.mainnet.js).
// Protocol day clock. GameTimeLib (testnet overlay) counts day boundaries as
// `(ts - JACKPOT_RESET_TIME) / 1200 seconds`, so the testnet day is 20 minutes
// (mainnet 86400 ÷ 72) anchored at 22:57 UTC.
export const VOLUME_WINDOW = {
  anchor: 82_620,        // GameTimeLib.JACKPOT_RESET_TIME — 22:57 UTC, the day boundary
  period: 1_200,         // one game day (1200s testnet overlay — GameTimeLib:56)
  // Readiness polling hint only. The visible clock uses the exact boundary so
  // the real keeper/RNG activation lag remains observable.
  jackpotReadyDelay: 60,
  // ContractAddresses.DEPLOY_DAY_BOUNDARY — day indices are DEPLOY-relative
  // (GameTimeLib:34, day 1 = deploy day), so day numbers are small, not
  // epoch-scale. REDEPLOY-SENSITIVE: this moves with every deploy; it is
  // `deployDayBoundary` in the sim's sepolia-manifest.json and must be
  // re-copied alongside the addresses above.
  deployDayBoundary: 1_489_959, // 0xc74dd514… @ 46133083
};

// contracts-testnet/CrapsBattle.sol compresses the production daily schedule
// into the active 20-minute testnet day. Keep these deployment constants next
// to the other testnet clock overlay so entry gating matches the contract.
export const CRAPS_SCHEDULE = Object.freeze({
  daySeconds: 1_200,
  anchorSeconds: 82_620,
  openerCloseSeconds: 0,
  clockAlignSeconds: 300,
  routinePeriodSeconds: 120,
  eventLeadSeconds: 180,
});

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// REAL Reown project id, supplied by the user 2026-08-14 (replaced the demo
// placeholder whose relay answered "Project not found", so WC never connected).
export const WALLETCONNECT_PROJECT_ID = '168de5f2661e82f9976d6b05212c1d44';
