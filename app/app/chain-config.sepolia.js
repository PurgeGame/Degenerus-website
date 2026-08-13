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
  // Gold Rush is intentionally restricted to an explicitly keyless endpoint.
  // Keeping this separate from rpcUrl prevents a future private provider key
  // from silently turning browser ticker traffic into our infrastructure bill.
  goldRushPublicRpcUrl: 'https://base-sepolia-rpc.publicnode.com',
  deployBlock: 45_438_973,
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
  ICONS_32:                '0x68c92d21bec461ebb6f2dece5afbd741442393ff',
  GAME_MINT_MODULE:        '0xea39d8eec316ae3a006c00349796a02011722073',
  GAME_ADVANCE_MODULE:     '0x149835fe562905e3c2b0e0cab319743d80d5f357',
  GAME_WHALE_MODULE:       '0x031d54ae1cd9f11f0fc62314d46f78c9776d358f',
  GAME_JACKPOT_MODULE:     '0xac8a4be04f587322f8d1af5af53f904198edc92a',
  GAME_DECIMATOR_MODULE:   '0xd1a6106e27c3f7ca7e64fbb4f9839cf93e03e2b1',
  GAME_GAMEOVER_MODULE:    '0x96330b49cc168f407041dedd33b858816ece5de3',
  GAME_LOOTBOX_MODULE:     '0xb0fcb0e9bbf624c28abf80b4975311b049655b6c',
  GAME_BOON_MODULE:        '0xf6949f290a558cbc0233d073f8ae4636cf01e6ff',
  GAME_DEGENERETTE_MODULE: '0xc01acbec7f33231c04668f357b1e9468a0c8cc81',
  GAME_BINGO_MODULE:       '0x136ad03ebf40cd271ad469708a4dd1f631391354',
  GAME_AFKING_MODULE:      '0x0491cfcf3a6aab82e61bf2237b717e9e372f274a',
  GAME_FOILPACK_MODULE:    '0x0e8d9a523c4624a788542e28bb1451e6fb6f0c39',
  AFKING_SUB_TOKEN:        '0xc3156ef42e4328ba6a96f7c96bff72eaae106ff4',
  COIN:                    '0x8971e2f7f1512f9c3ee7dc54795e40d5a43b3271',
  COINFLIP:                '0x2ed2d91dcccbb3f4fcafe633817c562c732432d1',
  GAME:                    '0xe57d3910ddd15831942c77be8757ad8a4bda01f7',
  // Read-only periphery (DegenerusGameLens). Redeployed every run — it bakes
  // QUESTS and DEPLOY_DAY_BOUNDARY as compile-time constants.
  GAME_LENS:               '0xd1f59b1755c042c46dabd579e7706df50c174ef2',
  WWXRP:                   '0xd3a2e3249d959c03d6a7934e757466e4c5797f08',
  AFFILIATE:               '0x38249d3ae7933a21cb112b36b853216ef12b68eb',
  JACKPOTS:                '0xffa8efa094260ca5ae9fee3647728ed15a086aff',
  QUESTS:                  '0xdf0b4f8f5707134bfb429115cb55f77bc8a19329',
  PARIMUTUEL:              '0xc52fe6b527cdb05118672bb1e462c36fbd28b4e7',
  DEITY_PASS:              '0xa963f37c2f8debfa3e0b73c80916431aef2104c9',
  VAULT:                   '0x037543fa2b4f2af7b0498fccd4679f559b5b37ad',
  SDGNRS:                  '0xe9805af4ac12663fd887ef841825277b8c52abab',
  DGNRS:                   '0x0e088c42ab920baa2f6e42acd29f718404ee7967',
  GNRUS:                   '0x90211c56b2684e4ed02962dcb1416bfa2914bd61',
  ADMIN:                   '0x083762f404847e97ce237600534afd8b6d84518b',
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
  deployDayBoundary: 2_977_605, // 0xe57d3910… @ 45438973
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// TODO(63-01): replace with real cloud.reown.com projectId before mainnet deploy.
// User pre-authorized demo value (2026-04-29) — autonomous-chain placeholder.
export const WALLETCONNECT_PROJECT_ID = 'demoa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
