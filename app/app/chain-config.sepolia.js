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
  deployBlock: 45_304_872,
  indexerBase: 'http://localhost:3000',
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
  ICONS_32:                '0x0890ade1f39092b3e847d315b5d306ee83cfda52',
  GAME_MINT_MODULE:        '0x282d903561b998805a2a4a9c3ee5ef78bd0bf329',
  GAME_ADVANCE_MODULE:     '0x58f3599025f8b6efff19ca7435e5a77698d25576',
  GAME_WHALE_MODULE:       '0x39e32877518613ac0bed5249b5538e602643134a',
  GAME_JACKPOT_MODULE:     '0x51d54da478300b24a8d8edd94582fe34afc4a5cf',
  GAME_DECIMATOR_MODULE:   '0xf6d75d87474b91a865ba34be78d0abb423a1c7d0',
  GAME_GAMEOVER_MODULE:    '0x77b41cabee97e0edf4dde29170a207dd5d87021a',
  GAME_LOOTBOX_MODULE:     '0x305496262df7fd399fbdd592a57da9737198cf7c',
  GAME_BOON_MODULE:        '0xe37f624803033e8ee4ce1375fc5ebab2e2b8b3ab',
  GAME_DEGENERETTE_MODULE: '0xe30ac8215eb335e83daf38d0c1cd103d83d748c8',
  GAME_BINGO_MODULE:       '0x1c75f4e52058a521e69cee022ccbe61ad1b9ff33',
  GAME_AFKING_MODULE:      '0x959af1bcc52c76802c16ded87e0c08ecc86c9498',
  GAME_FOILPACK_MODULE:    '0x3645c090fcfa947b2bd5d3169d7f06c1638fa59f',
  AFKING_SUB_TOKEN:        '0x832181ff5557d28d6818191cfe1c0a5e37382649',
  COIN:                    '0x21e66e80c136e7bcdf1918c6f890f169608fc968',
  COINFLIP:                '0x280024005af0c151c8a6b08a8eee6208196275af',
  GAME:                    '0x3a619df4451799ce64259073102c30c28fe65f11',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x61e20d69e2f5e618d7924a60b5d769222305cbdb',
  WWXRP:                   '0x0fa287ed759457e8ab2f51f074837887761d4e92',
  AFFILIATE:               '0x850ef22a6d56637bd455568afe8e75732e07398d',
  JACKPOTS:                '0x1169518da1c4f799b65a1b004429748f7d178f64',
  QUESTS:                  '0xe628379282ef5f7459e8ae0a85c1e7139514d9a4',
  PARIMUTUEL:              '0xc3d201a2afc2a9f51df46ec5c99b65e7d9a3bde4',
  DEITY_PASS:              '0x6fc358c17ed8d1910d240f6aac9d53d3ec0f8070',
  VAULT:                   '0xe6fadd0661dc5bd67c873430c030188fc7e140a4',
  SDGNRS:                  '0xefefdb5d7a4235e1a9c47dc648ce916ae638a89d',
  DGNRS:                   '0x24cd9cd783fd71f0a2db75c3e01ad92bb6011872',
  GNRUS:                   '0x984da6323079ced4ac7bdf784d4ce9c2b25c0e62',
  ADMIN:                   '0x2cdc617a087682df0a53c41ec74930e80e778a71',
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
  deployDayBoundary: 2_977_158, // 0x3a619df4… @ 45304872
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// TODO(63-01): replace with real cloud.reown.com projectId before mainnet deploy.
// User pre-authorized demo value (2026-04-29) — autonomous-chain placeholder.
export const WALLETCONNECT_PROJECT_ID = 'demoa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
