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
  deployBlock: 46_326_608,
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
  ICONS_32:                '0xd0185b380c2a7039d49a6730d0df53ffbe55f1e3',
  GAME_MINT_MODULE:        '0x8926d7a40dac7d13d9fa082c337fbbc1460544d8',
  GAME_ADVANCE_MODULE:     '0xd742eeacf11e3705f3b5755bc3e3e8262c0078a9',
  GAME_WHALE_MODULE:       '0xdac4e8fedba65abd1ef5b7ac092784937e0ae3b6',
  GAME_JACKPOT_MODULE:     '0xd8cc23bfa83dfaf22966bc9f12911766626b5dd1',
  GAME_DECIMATOR_MODULE:   '0x7afcd1d2132ab54e43f3a579b085bc48a50e5091',
  GAME_GAMEOVER_MODULE:    '0xe6c32597d4f4378156fb97c0a26075971d49edcb',
  GAME_LOOTBOX_MODULE:     '0xc2744afab10640658e3e41836ae2b783f3becc74',
  GAME_BOON_MODULE:        '0x8e17b7b1187066ed07250db9997c5448b027a2b1',
  GAME_DEGENERETTE_MODULE: '0xa6f3ea0703a5ec632e3ece515ae7f81982262518',
  GAME_BINGO_MODULE:       '0x45829aaff28fe36b3877d4b25b0997358d7e9ee7',
  GAME_AFKING_MODULE:      '0xb813760f92ee5803059669926ee7d74b924ae045',
  GAME_FOILPACK_MODULE:    '0xde14e64ff1b41cbb1499e9a2638cb032a39fd7c6',
  AFKING_SUB_TOKEN:        '0xf694f939f7a9198a24633dcbaedde2f7ec88c52a',
  COIN:                    '0x343e020cd3d23fd283b265a307814b69cf72e531',
  COINFLIP:                '0x23da475c7cbd461c7ccdf9b8d6d7b91c3a6b08db',
  // CrapsBattle — run #43, verified at deploy block 46,133,086. The address is
  // stable across runs; the block is not, so re-copy it with the rest.
  CRAPS:                   '0x5e237980b5190f7f32593015ad109b7eeda506ff',
  GAME:                    '0x84ec3d913f1d183620ea9361584e32e0fad3903b',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x1438ecaa89e6bb8ed8e94302361a699fbb733f0e',
  WWXRP:                   '0xb7003186eaf7acbe608083ec3d1ffec0795b7430',
  AFFILIATE:               '0x527917da9de2d65ca31dc32e507fd61d27921809',
  JACKPOTS:                '0x6158e5ec6b5a731bb123b6876bd5f53d80b6b743',
  QUESTS:                  '0x35a4bf1bca5a1a36f5632685418e2b3ec2e01652',
  PARIMUTUEL:              '0x8e4db16c34947e27b075c5de8e2ec57fb1310f70',
  DEITY_PASS:              '0x31d7d70a5da1ca399af80db5a33b6975897b8af1',
  VAULT:                   '0x44807ae1b80eb9bc3e5796c3f98e69b81f88a39f',
  SDGNRS:                  '0x5c8c24d02268c36c079d8100746e630168cede7e',
  DGNRS:                   '0xb5f8cdf2fe550609570c9af2ad42579fd6e6a7fe',
  GNRUS:                   '0x2bfa96c50948b8993f1c692c40587e9c302f08e0',
  ADMIN:                   '0x3cd920977e64f68bfdc4c9a8d6c585aaff8c6c27',
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
  deployDayBoundary: 1_490_282, // 0x84ec3d91… @ 46326608
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
