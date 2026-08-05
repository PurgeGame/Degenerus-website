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
  deployBlock: 45_093_474,
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

// 27 contract addresses from the current Base Sepolia deploy manifest
// (GAME 0x54ad8e5f...1044, deploy block 45005925). ADMIN excluded per Plan 56-01
// (deployer-only EOA reference, not a player-facing contract).
export const CONTRACTS = {
  ICONS_32:                '0xae81fe04be9d373aa835af61a2a290ec07a9e37b',
  GAME_MINT_MODULE:        '0x18d6478aefa75018d5fc1945ba156aa1d7c6fc05',
  GAME_ADVANCE_MODULE:     '0xded76f43d9cb2c0c5a321853b51455d010f0731e',
  GAME_WHALE_MODULE:       '0x22a714a05c691eed658f37ccbceedbc087120f39',
  GAME_JACKPOT_MODULE:     '0xc3aa180996dc9d80ff8414ae4e89dbdf37c04380',
  GAME_DECIMATOR_MODULE:   '0x5bbb9ba7ec930e0316cd343a80a7fd2d38d7eb2d',
  GAME_GAMEOVER_MODULE:    '0xa53dd54bcf97d27a69c84ed51bf03d6e833391cb',
  GAME_LOOTBOX_MODULE:     '0x9da25d5e8eaf4649cb8e88564411ceea30d78dc4',
  GAME_BOON_MODULE:        '0xb1bb50d6c84574e443ffd6eda8630033819882ba',
  GAME_DEGENERETTE_MODULE: '0x0272e75dc71451ca4f000a8530b41f65ee024d55',
  GAME_BINGO_MODULE:       '0x6d221f26c3f073473a3cf427041158806bf19547',
  GAME_AFKING_MODULE:      '0x1d56a02269bebed11e6c1fac234f06ff80c71221',
  GAME_FOILPACK_MODULE:    '0xa51972cb0e5f9a9b915ef052031472568c084aa1',
  AFKING_SUB_TOKEN:        '0xf0714f1ca410adab6b824d77d13b2444b4b34bb8',
  COIN:                    '0xda0984df96f7a38bda27d5f151720442dcae66f5',
  COINFLIP:                '0x411ac227939ea945d9a1387404c3c515bfe2393d',
  GAME:                    '0x9f6f2d323982001f9034ed11eb14c83a6a323f53',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x54af457203a30aeb17c3dc0c456a13f41c63f88e',
  WWXRP:                   '0xfb9200809217fb967959cacc74ffc57b9085a2ec',
  AFFILIATE:               '0x4f78014f2fca20ee74733a18e29827c626d54285',
  JACKPOTS:                '0xcd2981c68181a93cd7659fbf6caa9efa1187df7f',
  QUESTS:                  '0x43661e92f315cf0ff107ebdf643d8af0e23b0d19',
  PARIMUTUEL:              '0x6b4ff5bbf82cd9e7db6324c24432daf8a7944ca8',
  DEITY_PASS:              '0x06e958c337cfd92ac846037998c540f4f662d988',
  VAULT:                   '0x2fe7d00a1356a6d75752bc020efc648b7eed8539',
  SDGNRS:                  '0xf54ffa0e94d80a3b82398bd2e2952b5158ee1d79',
  DGNRS:                   '0x7546a373c0d92897d5057161191d7e2f05bc368b',
  GNRUS:                   '0x715832ea3c1ac93cc2c52d82c9c045b3023d2c09',
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
  deployDayBoundary: 2_976_454, // 0x9f6f2d32… @ 45093474
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// TODO(63-01): replace with real cloud.reown.com projectId before mainnet deploy.
// User pre-authorized demo value (2026-04-29) — autonomous-chain placeholder.
export const WALLETCONNECT_PROJECT_ID = 'demoa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
