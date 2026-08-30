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
  deployBlock: 46_170_662,
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
  ICONS_32:                '0x2ea4b6ec2ea73562cb9a5461f2025c85b2a547d3',
  GAME_MINT_MODULE:        '0x22d32ff1b3783d75a9f48f949310e6218c17a067',
  GAME_ADVANCE_MODULE:     '0xc7878aae4314ff2a262bab2e266a9e9c8858d83c',
  GAME_WHALE_MODULE:       '0x68f1fbf5a343df2fdabaa493f6cf25cb15d73356',
  GAME_JACKPOT_MODULE:     '0x8bb0bd503027c4aa64a3c5b811fda371f7bb4436',
  GAME_DECIMATOR_MODULE:   '0x42e9429e421d0ac2192d9303dd8cfa75ab7b5f72',
  GAME_GAMEOVER_MODULE:    '0x843e69f4b41efc0bee1ff0f52ddcba608d282f11',
  GAME_LOOTBOX_MODULE:     '0xc3bbc2b9758400bca9267fd62887fc4740206d6b',
  GAME_BOON_MODULE:        '0xab61a13b935d87e89ddcdbddc604a3cb211c212b',
  GAME_DEGENERETTE_MODULE: '0xbe13937547576f1a86a5f31f979926c99b1e03b6',
  GAME_BINGO_MODULE:       '0x4b77b1858843461ed9b6a2b23bd2fd49697a90da',
  GAME_AFKING_MODULE:      '0x9549175cbd96bc600f583070382fb71db34668ea',
  GAME_FOILPACK_MODULE:    '0xaf840efaca22226eba6a224f2c4deeebf30b0124',
  AFKING_SUB_TOKEN:        '0xb19a0935ef8c1d88a2afeee3fb9dc5b8ec4831f6',
  COIN:                    '0x33198294606ba523313c074a58ffc78d754345c5',
  COINFLIP:                '0x1f3f04e77c23160de454b3205fb7c4be51662fa8',
  // CrapsBattle — run #43, verified at deploy block 46,133,086. The address is
  // stable across runs; the block is not, so re-copy it with the rest.
  CRAPS:                   '0x643c3c3068a734e02d3e4bd22b56545e606e04a3',
  GAME:                    '0x0384187d38218b1beb18d2f6e1776b66fee922f8',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x5b7ed7c8436dce0dc8ac85f5a6d127397648fbc5',
  WWXRP:                   '0x087de0e932d7912d2b3f5b6b122a8b564aa12f97',
  AFFILIATE:               '0x9a4bf1f44ba62237a9123f8a2bac9fbcf6e36ecb',
  JACKPOTS:                '0xc793aae838c0dd28fea911b9db19187242c8e48f',
  QUESTS:                  '0x0cbb54631051e064b630b78f7490ea5ca1d3ea6c',
  PARIMUTUEL:              '0xb5c4d68f741da629bc0ee46f73b42cb66dd93ab5',
  DEITY_PASS:              '0xb7d6b4ca4d273c89cc673c135004c292db8abf27',
  VAULT:                   '0x5df24d9159dabdbab6d4afba6f37d053fa0eb7a8',
  SDGNRS:                  '0xb3110caa2ac118e1ff44e3d109d4a42a399f5ac3',
  DGNRS:                   '0xa371d78c9c85c353f7a7d83297c97dee7a8a5bf6',
  GNRUS:                   '0xc3f6ba764d2ed42c33049a4796404d5c10a6498a',
  ADMIN:                   '0x8e214c09f239da71e8dd7466e52af27bd48d0951',
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
  deployDayBoundary: 1_490_022, // 0x0384187d… @ 46170662
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
