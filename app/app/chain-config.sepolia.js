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
  deployBlock: 44_904_685,
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
// (GAME 0xa2868ed9...b623, deploy block 44904685). ADMIN excluded per Plan 56-01
// (deployer-only EOA reference, not a player-facing contract).
export const CONTRACTS = {
  ICONS_32:                '0xa91a343939a96cb94a392c47589a3d3da62865e1',
  GAME_MINT_MODULE:        '0xd33b2cf3c9e112ca008e18406a1a8a1a5e3c1a52',
  GAME_ADVANCE_MODULE:     '0x8c6c70aaa9e28ad2471ff38e16fd01b490a6bb56',
  GAME_WHALE_MODULE:       '0x0b2c9f878eaa4494a8cbae4b6f39e5a13ce22754',
  GAME_JACKPOT_MODULE:     '0xca8bd2ba9f3e23cdd65599fcd5fd6d65461bc776',
  GAME_DECIMATOR_MODULE:   '0xabd3a4decd62e3074be1ad627d22bcf81dc1b098',
  GAME_GAMEOVER_MODULE:    '0x7e35e3924e897b484f8c915d45717775a86a8d49',
  GAME_LOOTBOX_MODULE:     '0x9f8e8841612fd1b305d2704f8cc74634da9f104b',
  GAME_BOON_MODULE:        '0x8bc69e042937b76291fd8609e510bac294c7fc69',
  GAME_DEGENERETTE_MODULE: '0x393f56bcf8f8f1bb2746a1ff59fc25fc0b3a29ab',
  GAME_BINGO_MODULE:       '0xbe35e19d7f09e0b30ecf7ea6ec8e180830dec74b',
  GAME_AFKING_MODULE:      '0xec51c5a28d102fdc13dd6144c020bdbc403f71c3',
  GAME_FOILPACK_MODULE:    '0x1ccec6bffc0236964129bc7a609b38993662d0b1',
  AFKING_SUB_TOKEN:        '0x11dd39643c2a0a80aa3f9d123a739461488224d0',
  COIN:                    '0xedfcd8373cc1f9980af967f1ef167c631433e8ba',
  COINFLIP:                '0x31779ab167664d38fcb6188390073e3c0aee260d',
  GAME:                    '0xa2868ed96cd3cc873db6d84035b4cf5ca05db623',
  WWXRP:                   '0x6085b0e2e2bcea8b3fa8c0148ce0a31ecc080fc5',
  AFFILIATE:               '0xcbdbd43c9f49f48de245d81d008c6835741076de',
  JACKPOTS:                '0xc7d63825feb5e43dd615400d2bfe8db72b7a57c0',
  QUESTS:                  '0xcb0b0357df6478fd4bf09c60b395e0c9fe51d806',
  PARIMUTUEL:              '0x0df5828670121b9f00ef68aaa9a0a4adc52ced90',
  DEITY_PASS:              '0xc83a9b319f2ebb61183c0a11667aa80ea4d5296f',
  VAULT:                   '0x7b965575249ea39bdef7e5652404004a8bfd7496',
  SDGNRS:                  '0x1f760c7a222d88a69cf403786c075575553145a6',
  DGNRS:                   '0xd424da01909200db0088453331c1371f2bedabdc',
  GNRUS:                   '0x7dfea5dbb720f693e881e0d8237b85bd6225defa',
};

// Ticket-volume parimutuel window, for the COUNTDOWN ONLY — the contract's own
// `openRound` return is what gates the buttons. Mirrors this deploy's
// contracts-testnet/DegenerusParimutuel.sol:478 `(ts - 82620) % 600 < 26` and
// its credit ladder (25 FLIP, -5 per 4s from 7s into the 600s game day).
// The testnet overlay rescales the window with the day; mainnet does NOT
// (see chain-config.mainnet.js).
export const VOLUME_WINDOW = {
  anchor: 82_620,        // GameTimeLib.JACKPOT_RESET_TIME — 22:57 UTC, the day boundary
  period: 600,           // one game day (600s testnet overlay)
  openSeconds: 26,       // betting window at the top of the day
  creditDecayStart: 7,   // seconds into the day the 25 FLIP placement credit starts decaying
  creditDecayStep: 4,    // -5 FLIP per step
  leadSeconds: 90,       // how early the widget surfaces the card ahead of the open
  // ContractAddresses.DEPLOY_DAY_BOUNDARY — day indices are DEPLOY-relative
  // (GameTimeLib:34, day 1 = deploy day), so the volume book's rounds are small
  // numbers, not epoch-scale ones. REDEPLOY-SENSITIVE: this moves with every
  // deploy; it is `deployDayBoundary` in the sim's sepolia-manifest.json and
  // must be re-copied alongside the addresses above. Verified against live
  // VolumeRoundSealed logs (round 22 sealed on day index 22).
  deployDayBoundary: 2_975_825,
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on testnet (Phase 51 51-03 decision; Base Sepolia run keeps it)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;

// Phase 63 D-01 step 1 — WC v2 projectId (cloud.reown.com).
// Public token (rate-limit metering, NOT a secret — RESEARCH Runtime State Inventory line 531).
// TODO(63-01): replace with real cloud.reown.com projectId before mainnet deploy.
// User pre-authorized demo value (2026-04-29) — autonomous-chain placeholder.
export const WALLETCONNECT_PROJECT_ID = 'demoa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
