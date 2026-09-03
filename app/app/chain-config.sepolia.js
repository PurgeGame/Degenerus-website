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
  deployBlock: 46_321_273,
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
  ICONS_32:                '0x4d7fcfa9cddee50de70e80eeec66dbace87d85c6',
  GAME_MINT_MODULE:        '0x8e57b34704ee3722c9ae7586c197d884e1969a91',
  GAME_ADVANCE_MODULE:     '0x0d0f037e9a43eff4a0bae75248603fe71ccc84eb',
  GAME_WHALE_MODULE:       '0x35a4b53f185ef042afbb10bdca8c0f707f5880f7',
  GAME_JACKPOT_MODULE:     '0xc4cb1c363870588f543fb0bbe06b1d492aba7e65',
  GAME_DECIMATOR_MODULE:   '0x9a2e47760358a53bad0e739ece73353ecee6fd12',
  GAME_GAMEOVER_MODULE:    '0xd5885b618a855603c8e2ac1471e3943fc7a1c15e',
  GAME_LOOTBOX_MODULE:     '0xaee3d1eff54c8e820cacf9fd4013564f18cdd1a0',
  GAME_BOON_MODULE:        '0x32fc3ca77d9b846febc7a56f34841c2c27b9e828',
  GAME_DEGENERETTE_MODULE: '0xe68d60c3440f4667a23781588f99fcb566ea9e6d',
  GAME_BINGO_MODULE:       '0xfaad07c0ede3435963a260b4832ad362fec79726',
  GAME_AFKING_MODULE:      '0x8211e69cfa0601ad2ec300b4633980a4fa2f7c5a',
  GAME_FOILPACK_MODULE:    '0x073d3ed74815fa2c3ef4145bf94e643086925449',
  AFKING_SUB_TOKEN:        '0xd5ce04753c7db67826df2078b1dc19aeb24da53f',
  COIN:                    '0x30720a279cd5275be9a2b7059369efea09a93a5f',
  COINFLIP:                '0x2d6a2cc37ac5b9d0f5a212176e2781d7cbb7a2ba',
  // CrapsBattle — run #43, verified at deploy block 46,133,086. The address is
  // stable across runs; the block is not, so re-copy it with the rest.
  CRAPS:                   '0xc2393a907589f037ce97284ef32dd4dbe04d0f6d',
  GAME:                    '0x17b65ee1a1bd0ad900825ee32e4072b2ab2dd6cf',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0xc70e2b8fc9f2b8c9c6ca613934cc1a15824aba72',
  WWXRP:                   '0xadec1cd6e2c5c8deb1efdfa448af3c820b547a31',
  AFFILIATE:               '0xebe9509fa6eabad92ceec2896f16b5f27af4af5b',
  JACKPOTS:                '0x504037b5b2f49f1bf164b4e3f5f1971b03d998d5',
  QUESTS:                  '0xab3e2c2bab6965dcf5e9444a55878fcc572a455f',
  PARIMUTUEL:              '0xe5896457fcd3881149c83b93fb16e72667abc50f',
  DEITY_PASS:              '0xeafd490390b353ba0110e3dbc04328c29bac1481',
  VAULT:                   '0x8d214fd3bef26fd1e8db46ef06466c92fb26a8cc',
  SDGNRS:                  '0x7f789d8cf9a971991cd433171ea5c43f3363a25e',
  DGNRS:                   '0x77e008a9fba56850e282849dda9258a71126e19a',
  GNRUS:                   '0xf7d16ea7cc0eda7cb9a6046d336757327bcafd85',
  ADMIN:                   '0x6ac831c1b50d866cf6b4de32f7089be27a2b83da',
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
  deployDayBoundary: 1_490_273, // 0x17b65ee1… @ 46321273
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
