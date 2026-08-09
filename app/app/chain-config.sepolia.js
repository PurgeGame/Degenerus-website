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
  deployBlock: 45_259_680,
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
  ICONS_32:                '0x6da8481557604fc36bf7d7f3acc3fbf4002010f1',
  GAME_MINT_MODULE:        '0x0c8b86aa59d405d87b83b85656969b519331913a',
  GAME_ADVANCE_MODULE:     '0xa79ac640644bc52387a846969b09ddd86e8c1030',
  GAME_WHALE_MODULE:       '0x77052da80c26cddb0aaf4ef9ca3a6fab25f56644',
  GAME_JACKPOT_MODULE:     '0x57613b25f85ac79c1522d1a296d34edf74a19bc6',
  GAME_DECIMATOR_MODULE:   '0x7de830410f76db22a2b2944649f8a6defe459a32',
  GAME_GAMEOVER_MODULE:    '0x8384f34115186e2869fff05b89c94d0480f6d566',
  GAME_LOOTBOX_MODULE:     '0x0ba4800b4a2a59f32e008d72786eeb0bcb1ee9b3',
  GAME_BOON_MODULE:        '0x13cb58eb46df93c9497c5f94d199cf438f256aff',
  GAME_DEGENERETTE_MODULE: '0xf37dc854fba827aac9efd07ec40d661e804c0009',
  GAME_BINGO_MODULE:       '0x7382c59ff3fb7aed7760b76ecf93ace6cc4c12db',
  GAME_AFKING_MODULE:      '0xee24af90d39888dfd756ea07ee5ad6714171e5f7',
  GAME_FOILPACK_MODULE:    '0x482507d4989d4086e8ec554a8b2b38d3c729ec70',
  AFKING_SUB_TOKEN:        '0x4146742c466a412a21f85f2935f7b12d360c148a',
  COIN:                    '0x6fbfa03372d67cbdf2c28e91cb2216653065cff2',
  COINFLIP:                '0xe860d2d854affb86d36461de188e224d435301ec',
  GAME:                    '0xed4a96048615c73bc2344e8ce3df2e76a79c4769',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x77ce7474d7e310e01475f0c2613ffc04845298b6',
  WWXRP:                   '0xa0b221c3692d23865096adcbd4bd89273435fc20',
  AFFILIATE:               '0x79adfc024818270ce8a9f299b50bce73d3548c55',
  JACKPOTS:                '0xde6c113c4bbc7e7604b3d85b9ba1f0e37a1e1dfa',
  QUESTS:                  '0xe160e6e647a94481b9ec9a4d46c9e4d2b7b43226',
  PARIMUTUEL:              '0xa10926995e547ae4e145a3c3ba26d52135f193bd',
  DEITY_PASS:              '0x3ccafd36c396de8851935cba2dbb3a03e5743407',
  VAULT:                   '0xa28eac4efa9f19302351e859629c9971649a6bfb',
  SDGNRS:                  '0x256af97455901f44ad596b8df124c7bd3b1ea6a5',
  DGNRS:                   '0xe0b810840c4f676d936c81d37c86d0657cee41f6',
  GNRUS:                   '0x01e30526468aaf32d42f461b99b6075b8071fe6e',
  ADMIN:                   '0xaac88445bdc24799ec4ef0dfdfc7c262df924daf',
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
  deployDayBoundary: 2_977_008, // 0xed4a9604… @ 45259680
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// TODO(63-01): replace with real cloud.reown.com projectId before mainnet deploy.
// User pre-authorized demo value (2026-04-29) — autonomous-chain placeholder.
export const WALLETCONNECT_PROJECT_ID = 'demoa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
