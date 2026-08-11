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
  deployBlock: 45_351_398,
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
  ICONS_32:                '0x050e5141fa38938bfe987e64e3c621c1aa03a1dc',
  GAME_MINT_MODULE:        '0x3af2979feee8770ed680fa569ebdc43284dde731',
  GAME_ADVANCE_MODULE:     '0xe65d49e4034e5c05a55bb24850cc4d0705ac5ba7',
  GAME_WHALE_MODULE:       '0x00545c5de9fe89120ccce951bbbae6d86c04aa84',
  GAME_JACKPOT_MODULE:     '0x97641517960c2bc27f2daafe07566dbaee03c15c',
  GAME_DECIMATOR_MODULE:   '0xdc965cfbdfaccdaba24907ac71d2cb31424f72c2',
  GAME_GAMEOVER_MODULE:    '0x67aa6b3ac10e10fbf6da47bf561f7a16c0e463c0',
  GAME_LOOTBOX_MODULE:     '0xf86705b2f4009722914b1821d116669555fc213d',
  GAME_BOON_MODULE:        '0x0a3aaa1eac4263c5f37468b33834670fee7d78d5',
  GAME_DEGENERETTE_MODULE: '0x39a567739d41cacf3c09bdf7e763c277a2f2f601',
  GAME_BINGO_MODULE:       '0xd636d87cc98752e2c26896acb0a0ee4b5d9d02e1',
  GAME_AFKING_MODULE:      '0x5e62bcd5370440a2d9aac7030ca498593552d283',
  GAME_FOILPACK_MODULE:    '0x43d449d5170b5f1b03c79c8fd40cd73407dfd7aa',
  AFKING_SUB_TOKEN:        '0x8345ca8d951283ad33fd324dd3786c4704fff5e7',
  COIN:                    '0xba30742c39bd96d8570add03886fa8b844cea6e4',
  COINFLIP:                '0x5ee6d356856aa897c25c55cf096a8c99af8b0fc2',
  GAME:                    '0x8500a7a9d312f9db9d1f12c1643255a3b0f7aed6',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0xd1db6f3b1ef11b092ee4922e65c31228ab84e566',
  WWXRP:                   '0x9f8c0f24e0f4dac26d216cf4732080cbd851d22f',
  AFFILIATE:               '0x608c151db3ff6212b9b5a77483eda9d46b637f89',
  JACKPOTS:                '0xfdc06b491bdf683c1a71bc8ceb92cc3ebf4b81f2',
  QUESTS:                  '0x40749e89e6e2b0eed34a7a481aaf8925d35bac73',
  PARIMUTUEL:              '0xbddd75edacf7ea58cbf68deeeed51f14b928374b',
  DEITY_PASS:              '0xe1de469c571400df3cc67bb26fbc2b9e6d241eb6',
  VAULT:                   '0xb81cda8ba31c15a0bf56520290bb19fb94aa0899',
  SDGNRS:                  '0x7484a9df8e7cb1e5ba7898651de907bbc8d49571',
  DGNRS:                   '0x073fd8f992d04cc5b3b56ee405b04ed3b40966a7',
  GNRUS:                   '0xe86d6cd02be3a30c54c219a61d785731634b6760',
  ADMIN:                   '0xaf9902f8420e282a7afbeafc8004cc4a5092ce77',
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
  deployDayBoundary: 2_977_314, // 0x8500a7a9… @ 45351398
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// TODO(63-01): replace with real cloud.reown.com projectId before mainnet deploy.
// User pre-authorized demo value (2026-04-29) — autonomous-chain placeholder.
export const WALLETCONNECT_PROJECT_ID = 'demoa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
