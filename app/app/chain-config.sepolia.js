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
  deployBlock: 45_702_811,
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
  ICONS_32:                '0xdbad5b15cec94d5461ab63ca2641b45e4408dee4',
  GAME_MINT_MODULE:        '0xc516c31bcc70bfecb4c84565ad638d350704ad9c',
  GAME_ADVANCE_MODULE:     '0xaba6859246a99a7622de8dfc22fe6c042ca0a548',
  GAME_WHALE_MODULE:       '0x5d315dbed2c13564199a7fde1b22a86bca124307',
  GAME_JACKPOT_MODULE:     '0x21f421a36a2752a1a2cb407fe9203a0c43ed4d88',
  GAME_DECIMATOR_MODULE:   '0xdc0ee44e337e533f5432852b9348c606580b2c64',
  GAME_GAMEOVER_MODULE:    '0xa552154c0f8c26b421374081812d79f535a8408f',
  GAME_LOOTBOX_MODULE:     '0xe25dc81f5f1026ab7c95dbebd81e5bac3c3c6773',
  GAME_BOON_MODULE:        '0xd28a6737a14a383f51e65e5063a5c7e1d5fccf37',
  GAME_DEGENERETTE_MODULE: '0x54352ddd2c424b0b9d5f470cce83c97e4f1b0135',
  GAME_BINGO_MODULE:       '0xc2d623b6059c7fdd683976c4be59824d2aebbf80',
  GAME_AFKING_MODULE:      '0x95f8fcf14d5d8012ba278acc9a2fdd788c14682c',
  GAME_FOILPACK_MODULE:    '0x458572452dac189f9bd31e6b08e830678b84d608',
  AFKING_SUB_TOKEN:        '0xab69c9766e7282e16207584a6a429512645e5b15',
  COIN:                    '0x59964f3a468835042cb7b8676ba1fda5801161cb',
  COINFLIP:                '0x608c233960c40434b02c43790d809cbf173e2ce6',
  GAME:                    '0x07db44b18abb654a77d7017e5b98d47c3789a746',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0xf5708e35e4e95885fdca017c3f98a9c5615aefa5',
  WWXRP:                   '0x828babcb88bcf345e5922ab5254d8665cbb2f538',
  AFFILIATE:               '0x618258d0abe2c73648b2881663cf7a480f847a1e',
  JACKPOTS:                '0xda3f37a48743d6e6121cba5e2261c0b9e30f0d6d',
  QUESTS:                  '0xa6d5d7ea2ba74fe71a28c54d42850697eaa13765',
  PARIMUTUEL:              '0x1b4efd410f651def21ab4f1ad363b21c4c6187b2',
  DEITY_PASS:              '0x45a49a76121cc279faf76ce279ae762691aa6411',
  VAULT:                   '0xc3879f7feeab8607259bec0c0348e3abb50c8702',
  SDGNRS:                  '0x1fe9466c5309d0873bbb6795e6f5a799a3824636',
  DGNRS:                   '0x0207ddde5724d0932f7d5fd1374a0b13029143bd',
  GNRUS:                   '0x45f57eadd4dc94d527d5a47d31e150204ad2005f',
  ADMIN:                   '0xc04ef9d58a737674e2ab020a8f87d69edd2941b8',
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
  deployDayBoundary: 2_978_485, // 0x07db44b1… @ 45702811
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// REAL Reown project id, supplied by the user 2026-08-14 (replaced the demo
// placeholder whose relay answered "Project not found", so WC never connected).
export const WALLETCONNECT_PROJECT_ID = '168de5f2661e82f9976d6b05212c1d44';
