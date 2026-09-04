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
  deployBlock: 46_375_867,
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
  ICONS_32:                '0xb2c063e6441af6aa21bcbef4e19d8661d70069c8',
  GAME_MINT_MODULE:        '0x2593aaba0d9b24c9d2f39c587f8b6a79f61fbf8c',
  GAME_ADVANCE_MODULE:     '0xa98628d297f2cdcf1146c691c1a0252355496d42',
  GAME_WHALE_MODULE:       '0xaf194ad62324e9b5f5ec3e36447433fae832fa3f',
  GAME_JACKPOT_MODULE:     '0x0f810296e669ef04dcc9df9e024ee986b21de206',
  GAME_DECIMATOR_MODULE:   '0x1a3655fdb4755a2906485ddd674ad0ad61cec9de',
  GAME_GAMEOVER_MODULE:    '0x77823db113c98f3554a3a7ebca29a2f9a924698e',
  GAME_LOOTBOX_MODULE:     '0x9013deed3c7ab3f96baa18d28f1bfeb224475dd4',
  GAME_BOON_MODULE:        '0x89f4048544661305f149d73827bc9283fcb77240',
  GAME_DEGENERETTE_MODULE: '0xb399e49b4d275ac01806dd86b69f11fbf00cea9b',
  GAME_BINGO_MODULE:       '0xd43e62c40c6ad0082a293cf71a07b0230184665c',
  GAME_AFKING_MODULE:      '0x3a8dbcc42864a96c7b50d3d70fc81da9ea223bd0',
  GAME_FOILPACK_MODULE:    '0xfbb463482d4d5e9eaa935d035a8a23487f165500',
  AFKING_SUB_TOKEN:        '0x51ff4f2d40948036479816b98d9749c648ae6d60',
  COIN:                    '0x8ed0056ea37a2d154640761c4acd7b515a1a89e0',
  COINFLIP:                '0x1546587a618dfeb0600b0f44ff2fc190924d4c13',
  // CrapsBattle — run #43, verified at deploy block 46,133,086. The address is
  // stable across runs; the block is not, so re-copy it with the rest.
  CRAPS:                   '0xc75f47d034930ee002a736f1e64d10102830cc56',
  GAME:                    '0x8450f69dbb7124773fd269440aed99cad36d22e2',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0xa1fdac315dd0ec47a4de05e7079537960ad5fe25',
  WWXRP:                   '0x71b1b3357684e9f794ced3dc8f0a1852bfd44e64',
  AFFILIATE:               '0x5db22aa00ac4cc50d14a9bdbdc8290d56da83978',
  JACKPOTS:                '0xd215478d307889716d801016e6c21f4ffee4c700',
  QUESTS:                  '0x941a59e062bea67ec886bf582a8fb17b0bac196f',
  PARIMUTUEL:              '0xad17bb78c85a01f078f7ebfa6c5a4bb061d1483b',
  DEITY_PASS:              '0x9bf8f9718f3393a49c9e23df843345698af2001c',
  VAULT:                   '0x1a513a1762a22fe967e4e2e7f3640471f68bc74c',
  SDGNRS:                  '0x73638bc9eff3896db2e78bc1f7c884457ccfb4d7',
  DGNRS:                   '0xda0fe20c7e918a2112fecf6816521ca8b95b0ae1',
  GNRUS:                   '0x9d2dd127ddd4aa02d03f67d823c6580d08905bc7',
  ADMIN:                   '0xc24ccf4bb3b055ddff5202c7280badfe5442d0c6',
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
  deployDayBoundary: 1_490_364, // 0x8450f69d… @ 46375867
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
