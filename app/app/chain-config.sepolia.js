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
  rpcUrl: 'https://sepolia.base.org',
  deployBlock: 45_005_925,
  indexerBase: 'http://localhost:3000',
  etherscanBase: 'https://sepolia.basescan.org',
  nativeAddEntry: {
    chainId: '0x14a34',
    chainName: 'Base Sepolia',
    rpcUrls: ['https://sepolia.base.org'],
    nativeCurrency: { name: 'Base Sepolia ETH', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://sepolia.basescan.org'],
  },
};

// 27 contract addresses from the current Base Sepolia deploy manifest
// (GAME 0x54ad8e5f...1044, deploy block 45005925). ADMIN excluded per Plan 56-01
// (deployer-only EOA reference, not a player-facing contract).
export const CONTRACTS = {
  ICONS_32:                '0xe7a5539c1914f1335f3055058182ebd524ad1791',
  GAME_MINT_MODULE:        '0xdf1874bb37b87a8befccc645470553a52359ba2d',
  GAME_ADVANCE_MODULE:     '0xa8d9e2d8701133a1d5bfb61b6f65bcccd9ae355b',
  GAME_WHALE_MODULE:       '0x15a52f903100f04ecc1d71b2ab7943cababa73d3',
  GAME_JACKPOT_MODULE:     '0xaf2043d670ca1f724bbe239f13e1611083a0ffcf',
  GAME_DECIMATOR_MODULE:   '0x2c55976105e5d2b7cae25870407c9385ad75dd01',
  GAME_GAMEOVER_MODULE:    '0x7550466fa05ba43044d6412c768fbf1dda22c0e0',
  GAME_LOOTBOX_MODULE:     '0x87ed4a3b245020a84f566f512782bcebb45f0ea5',
  GAME_BOON_MODULE:        '0x4af6c15a88a76597b78eff83645c1de326b881ad',
  GAME_DEGENERETTE_MODULE: '0x21ea7c013dd6c20fcdd90e16289b7bdf5f02ef16',
  GAME_BINGO_MODULE:       '0xf1c8e1326745a99b5687b6f08d9ce0fb90287211',
  GAME_AFKING_MODULE:      '0x0e940d9a1f0e8c649d038d08616630daa47fe912',
  GAME_FOILPACK_MODULE:    '0x792829de274b6f01344c0d47323d062ecf5bfe0d',
  AFKING_SUB_TOKEN:        '0xdfa02483274e4664c584873f2b9c6d7fca25da10',
  COIN:                    '0x280a5067694f9deffa767f81d257fbd4f3ac557b',
  COINFLIP:                '0x364a407bcc157c47bba3b7943ca1de34dfa619f4',
  GAME:                    '0x54ad8e5f30f2ce3bf3b0d60301de28a5c2d41044',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x6cfa47e1b11355d4e8dc82b6f16c44481aa92886',
  WWXRP:                   '0x8679b4b8c27e15c88807a15980f725924411d3f4',
  AFFILIATE:               '0x3631d97d708defc9f3d3d11107459e6fd167a20e',
  JACKPOTS:                '0xb29a9d70b1bb47abfbc5800672a7fb9441b99954',
  QUESTS:                  '0xbc839f05cfc6e03128864c2e89c6b09356145791',
  PARIMUTUEL:              '0x05c03588754ce03f694b5b299e7bcc1f2d4cfac1',
  DEITY_PASS:              '0x38ba62d422167ee5ff2db5b3969f00d5991ea8c5',
  VAULT:                   '0x7265b4d7a9e2d2accc114cf798d74934d2ca45a6',
  SDGNRS:                  '0x185eff584ea02ffd4928a7796d8fa21594634489',
  DGNRS:                   '0x77097af720b3915f96d0e512ebcc841037ffeca0',
  GNRUS:                   '0x293e3d2dab4736b5155b509bf70c0622a354dc42',
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
  jackpotReadyDelay: 60, // RNG/indexing normally makes the new draw playable ~1m later
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
  deployDayBoundary: 2_976_162, // run #27 (GAME 0x54ad8e5f @ 45005925); was 2_976_020 for run #25
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// TODO(63-01): replace with real cloud.reown.com projectId before mainnet deploy.
// User pre-authorized demo value (2026-04-29) — autonomous-chain placeholder.
export const WALLETCONNECT_PROJECT_ID = 'demoa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
