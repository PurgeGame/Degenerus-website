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
  deployBlock: 46_433_058,
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
  ICONS_32:                '0x1332e34cf570c8d3a8b71cfb2c8fcadc3179e832',
  GAME_MINT_MODULE:        '0x2ee86f44ba5cfb9fcbb40739a4ac45f5cbb5b03b',
  GAME_ADVANCE_MODULE:     '0x70d253f67489473efeafff980ba3ac53e009d51c',
  GAME_WHALE_MODULE:       '0x7391d7e5d540990dd425ae914b71a82d36fae70c',
  GAME_JACKPOT_MODULE:     '0xdc395392208901248c6ddb4f4ad86dbf6f51481f',
  GAME_DECIMATOR_MODULE:   '0xfd3900010a3cb4ea6acbd463c5d69e628e86cbc4',
  GAME_GAMEOVER_MODULE:    '0x9c1367aa8956356936d0dcecf258c16844635b41',
  GAME_LOOTBOX_MODULE:     '0x5e46cce02bcd104483d9c1d65ca064e265d07f4c',
  GAME_BOON_MODULE:        '0x98c91600f1dcc55e6b4d86f752eb244cfd3ab591',
  GAME_DEGENERETTE_MODULE: '0x98295c9da4189768f0967a07cb086208fe9bc50c',
  GAME_BINGO_MODULE:       '0xc8872fd04a2b0f20cebc22ac39b8f9213ab78e8e',
  GAME_AFKING_MODULE:      '0x5df3163654690b3f77d5277c301824fb4f40e228',
  GAME_FOILPACK_MODULE:    '0xa4668ebb2a46d4f4ffb75a8c45d265f02374db86',
  AFKING_SUB_TOKEN:        '0x4d9c6ebc881647b349fb3496b6da79f694b60398',
  COIN:                    '0xfebebd125308be4b4472db76d71106e86ae5c3f5',
  COINFLIP:                '0x476b492e78410d69496c0327b2c8870c7784e6d9',
  // CrapsBattle — run #43, verified at deploy block 46,133,086. The address is
  // stable across runs; the block is not, so re-copy it with the rest.
  CRAPS:                   '0xf864dc42f0806ed9247acaff98545bde7f1b241a',
  GAME:                    '0xda9cbbb99500d4c32d15484928748707543dc188',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x71a63eee2c8077875e6d69a60e8e930b581f5559',
  WWXRP:                   '0x3e5e33b47514ef56f70b6dc5d8a40e34afb036c1',
  AFFILIATE:               '0x69a1c8d723937dbdabaf0f1eb76fc5735b7b1b43',
  JACKPOTS:                '0x841390175cb09b05ef595f1d0a824995eda6f395',
  QUESTS:                  '0x3a34fd7b04a653275e4e1035145f4d594d8ea235',
  PARIMUTUEL:              '0x0ea19c248b64370ddb94bdc8153d29ab61617c66',
  DEITY_PASS:              '0xe738585c5463ad0df57f2257d816ace10d79fd0c',
  VAULT:                   '0xcaa57582f2f4360accf5269a394b543690ede3ac',
  SDGNRS:                  '0x26f2653eb3ec1d548f02a8148478289c42a7e05b',
  DGNRS:                   '0x6712236d25fe9a7ef113246ae1e7bbb38c35a0ec',
  GNRUS:                   '0x2340b321d36857ecc2bc142efb777a81f2a5f323',
  ADMIN:                   '0x7d959c6ecae9031cf8b51480e7a30f992a0e2c98',
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
  deployDayBoundary: 1_490_459, // 0xda9cbbb9… @ 46433058
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
