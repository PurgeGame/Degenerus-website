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
  deployBlock: 45_261_413,
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
  ICONS_32:                '0x64fb92c4adbf4296351a4443bc27c98bbe0eefcf',
  GAME_MINT_MODULE:        '0x26dc21e6a6cb49508140a45ffca7405451b7d5d5',
  GAME_ADVANCE_MODULE:     '0x0e84625ad4a365270864a257fa7457b97772d8a2',
  GAME_WHALE_MODULE:       '0x77c6f7f16de9922da0420aeb6347e6df2f9169b2',
  GAME_JACKPOT_MODULE:     '0x6744ed53f7bcd8e35b811f5b9d7dd8119195f361',
  GAME_DECIMATOR_MODULE:   '0xe8e403afbffa5cf26b6e80e5dcbedd91bb94fa5a',
  GAME_GAMEOVER_MODULE:    '0xb2615451f7415b985d5377f6ad4bac918b1d15e5',
  GAME_LOOTBOX_MODULE:     '0xf06db64726b4988e90b67d8ce4efead76a51efe0',
  GAME_BOON_MODULE:        '0x47c384d5076aac0c0cc49a3cca7c45f2c87a85ba',
  GAME_DEGENERETTE_MODULE: '0x91539e18c8269cbc2a2061cadc3ce17ce3ecf1af',
  GAME_BINGO_MODULE:       '0x6fe6217c1f98032f1dbdf2a06433026751f639b5',
  GAME_AFKING_MODULE:      '0x2d6dd958cec4ff8a3c5b40ae6ac13b524fc211bf',
  GAME_FOILPACK_MODULE:    '0xb58378392741b6e3aaf69a25d26a303373079fa0',
  AFKING_SUB_TOKEN:        '0x6159d0501de8e69d183e1f787a3c56adc4e04a02',
  COIN:                    '0x4853a3a7cea13baa488c6733c6a3be7456a97282',
  COINFLIP:                '0x19f3a78f2cad84d8eca75fd227ff46880479198b',
  GAME:                    '0x898e53ba1fd36236f5931161ee151148dd194627',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0x45d1ef79d517db6404782128e08f6933f815b3af',
  WWXRP:                   '0x2752745d274182cf5961c79da908a1e85e574920',
  AFFILIATE:               '0x0d4aa9113144cc58355e4e666412b3abd3650101',
  JACKPOTS:                '0x316eab2740bc130d0bde69b7c71c8cec91a86deb',
  QUESTS:                  '0x0cd6c4db2ca6cd75fc6e2db68d8a267d2abb9e17',
  PARIMUTUEL:              '0x7f409812f464401022d2afd181f7528a269c11f7',
  DEITY_PASS:              '0xbc8607b45e1701af0c9a26f58e40963cbcf36a44',
  VAULT:                   '0x7a0a268812094b753ea8e375abadb9c10d8d8d37',
  SDGNRS:                  '0x73bba33c98356dd4d876ef8fbf6edf3e0631a6da',
  DGNRS:                   '0xda5a56673b1a67e5effb50e8ee2e5e7f3f8b1885',
  GNRUS:                   '0x44ee02f9fec69bd9006be9ed5ddadb42ae57be9a',
  ADMIN:                   '0x288acdc9394ecf881de33a136f930c13fea4c97b',
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
  deployDayBoundary: 2_977_014, // 0x898e53ba… @ 45261413
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// TODO(63-01): replace with real cloud.reown.com projectId before mainnet deploy.
// User pre-authorized demo value (2026-04-29) — autonomous-chain placeholder.
export const WALLETCONNECT_PROJECT_ID = 'demoa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
