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
  deployBlock: 46_570_486,
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
  ICONS_32:                '0x6873e6f37e69c43d2accebbccea4e23964436aec',
  GAME_MINT_MODULE:        '0x5b45f5f48939c30af17428a7d93efb3ee03e8c7b',
  GAME_ADVANCE_MODULE:     '0x1bd2112915ddf6d8134500ac8e1ff2d1c78bd578',
  GAME_WHALE_MODULE:       '0x4a45bf26c873c71b061b9450c19237a11b14a39d',
  GAME_JACKPOT_MODULE:     '0xf5495bd3e5b52ea9da98790e6402632e535da9f4',
  GAME_DECIMATOR_MODULE:   '0x1d7106fb4b5805f49a653209c7e9eac53b476a3e',
  GAME_GAMEOVER_MODULE:    '0x7710171167a3f382cb10ca076dabc850451222b5',
  GAME_LOOTBOX_MODULE:     '0xa0ae3c536f4f2a6b836fc59bd028bc6c99d4ae34',
  GAME_BOON_MODULE:        '0x5392c9b3e4b260c6ca51fe833efec1896bb8690d',
  GAME_DEGENERETTE_MODULE: '0x96be29f58aa4ed82d989375fb41ba1dc7d479dba',
  GAME_BINGO_MODULE:       '0xd27e431ce2fd605f91d98ff981739be2e179ec6b',
  GAME_AFKING_MODULE:      '0x2da261b4ccca1c67bde172b356f7b8c4a855a2a9',
  GAME_FOILPACK_MODULE:    '0xb798fdfdd8da0de78afd745f774203fff4aec00a',
  AFKING_SUB_TOKEN:        '0x070ea5445163f14c4245f0b42f32fad52f83053d',
  COIN:                    '0x1d37205ffe124549e111634bdb7594676af3700e',
  COINFLIP:                '0x7459f9eb78427ec09def3f95114f215e560d26d5',
  // CrapsBattle — run #43, verified at deploy block 46,133,086. The address is
  // stable across runs; the block is not, so re-copy it with the rest.
  CRAPS:                   '0x4c85cd904508b9cc06e88cad99306714c32d790c',
  GAME:                    '0xb6da648a25283ba40dbae10b1dc912740ff91e4b',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x72cac25255deea51c8d095cffefe60f7b0174f94',
  WWXRP:                   '0xd1070a8065783dbca1e3261528aae7730761ec0a',
  AFFILIATE:               '0x6bdecf582aa65dfc84b313c99b84b49c03e3299b',
  JACKPOTS:                '0x65b9dbc69b989ee923f291a3c9a4d3027261bfaa',
  QUESTS:                  '0xacec42b9f81ed0c04f96ae1d96c9e36de6034e39',
  PARIMUTUEL:              '0x5b0c57dad76f57689822f096cc3b79939d353312',
  DEITY_PASS:              '0x728eea235b15265ea9cd86dad488cc56e1b18c1b',
  VAULT:                   '0x4de0b4f28dde4ab53c3d0d0c61f67e1a8e4bbe97',
  SDGNRS:                  '0x61b48d0b82167d934bb14504816b2fc6ec80ba75',
  DGNRS:                   '0x1738a7157ff540cf2169504c00152acdf4677ffa',
  GNRUS:                   '0x45eb9ab561bab046d8370dc30633b6754d273161',
  ADMIN:                   '0x796be5ae32a61403d317686fb0a8868eb94d26df',
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
  deployDayBoundary: 1_490_688, // 0xb6da648a… @ 46570486
};

// contracts-testnet/CrapsBattle.sol compresses the production daily schedule
// into the active 20-minute testnet day. Keep these deployment constants next
// to the other testnet clock overlay so entry gating matches the contract.
export const CRAPS_SCHEDULE = Object.freeze({
  daySeconds: 1_200,
  // Nominal block interval; sizes block-count lookbacks derived from daySeconds.
  blockSeconds: 2,
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
