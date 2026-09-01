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
  deployBlock: 46_230_333,
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
  ICONS_32:                '0xfb8a5276ff365e5115afe573caa47951b061f506',
  GAME_MINT_MODULE:        '0x7358107be81e0b4876a3d4a890147bb33a34b520',
  GAME_ADVANCE_MODULE:     '0xb1d78b68d4f00598d681363d89810d30cf35a2bb',
  GAME_WHALE_MODULE:       '0xb5d1e30b3280a2c27c6afd0cfc7d3a89fc5af343',
  GAME_JACKPOT_MODULE:     '0xb937308d1406a9dacbeed2365b040fc85aed8814',
  GAME_DECIMATOR_MODULE:   '0x095049cfca62ef61e447b5536f88315564b1f1c4',
  GAME_GAMEOVER_MODULE:    '0x7924a16a319c03407a4ceaf1fd9ad95875d06bee',
  GAME_LOOTBOX_MODULE:     '0xcb8300f8035567e0ba93c70f9963127ba32f9d27',
  GAME_BOON_MODULE:        '0x4f0ef74b77cd5b94a396000a429ca4a3db96c35b',
  GAME_DEGENERETTE_MODULE: '0xb321f6db3dabe37dad23201e9a292c3ef6bbca84',
  GAME_BINGO_MODULE:       '0xfb250fbd42ad9c36b6dc53a7ef8d0df270285392',
  GAME_AFKING_MODULE:      '0x50420873bb90430c3d0a0d7e894054915fd329b5',
  GAME_FOILPACK_MODULE:    '0xbe8669b46ca3c1bd717551dd8b0155a5654f6792',
  AFKING_SUB_TOKEN:        '0x515e7cc8c8d30b59b82a14bc432046e42140ead4',
  COIN:                    '0x5fea6adea52702695be9b7303a3cd471ee2ac8bf',
  COINFLIP:                '0x17fc65f5458899861838b03239e35d4b3d8fc677',
  // CrapsBattle — run #43, verified at deploy block 46,133,086. The address is
  // stable across runs; the block is not, so re-copy it with the rest.
  CRAPS:                   '0x387eb017c7252a85b391e79fbb58d0eee3a48e17',
  GAME:                    '0x41c2e98f18b3bf4bb9dd56222bd70e36d69f69c5',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0xaedcacac8190589a527eeecea89d5f3d49f36574',
  WWXRP:                   '0x58d810379be9e548adced0a7c1651f6f9700a458',
  AFFILIATE:               '0x6cb1c3350eb523633c6c38a3e898a307f22f5caf',
  JACKPOTS:                '0xb6215e7eaec503b2e89cb161d34e649d158bee55',
  QUESTS:                  '0x391fea8061c289a1891d63d3c32e53188855d0ee',
  PARIMUTUEL:              '0xef3a5b97595b0c09f63a9928a3c6e987be501383',
  DEITY_PASS:              '0xe67b756386f9667b111c82974109dea4922ee12d',
  VAULT:                   '0x276a86eee392c88801b5d015e57c978d3f1641d0',
  SDGNRS:                  '0x9c7b8549529c4055e6859cd14a16c9c6e1084c9a',
  DGNRS:                   '0x6d5f445fa1de91073f5f37cf29982ae49e8cb5b6',
  GNRUS:                   '0x8bf7b68b3e232f1869445725def585ff8b0df81c',
  ADMIN:                   '0x71c20ace9c1e3658d3936e0b5376ca111c958e23',
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
  deployDayBoundary: 1_490_121, // 0x41c2e98f… @ 46230333
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
