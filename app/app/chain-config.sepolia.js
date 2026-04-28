// website/app/app/chain-config.sepolia.js
// Sepolia testnet profile — sourced from .testnet/sepolia-manifest.json (Phase 52 D-09).
// Addresses inlined verbatim (lowercase, no checksum) for diff stability.

export const CHAIN = {
  id: 11155111,
  hexId: '0xaa36a7',
  name: 'Sepolia',
  rpcUrl: 'https://ethereum-sepolia.publicnode.com',
  indexerBase: 'http://localhost:3000',
  etherscanBase: 'https://sepolia.etherscan.io',
  nativeAddEntry: {
    chainId: '0xaa36a7',
    chainName: 'Sepolia',
    rpcUrls: ['https://ethereum-sepolia.publicnode.com'],
    nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
  },
};

// 21 contract addresses sourced from .testnet/sepolia-manifest.json contracts.* at plan time.
// ADMIN excluded per Plan 56-01 (deployer-only EOA reference, not a player-facing contract).
export const CONTRACTS = {
  ICONS_32:                '0x7e563bb797a378a232b66bdf3e852156d6c504b6',
  GAME_MINT_MODULE:        '0x78fc1ab8041d6bb0d092164c8bbf8824cc095900',
  GAME_ADVANCE_MODULE:     '0x333ba9d34196f6ccb960bac89eea068d1569ec15',
  GAME_WHALE_MODULE:       '0x36f3e18e18e706159c2d12ef59ef53449d09ec27',
  GAME_JACKPOT_MODULE:     '0xe8913226ca28874741f16d6791681474826957fe',
  GAME_DECIMATOR_MODULE:   '0xa0f2fcc2b632f85fb407deb2ced4cb12179b442e',
  GAME_GAMEOVER_MODULE:    '0x8b967235f7a687276698c48656dcc89c783c1228',
  GAME_LOOTBOX_MODULE:     '0x052d228e7c54c2583181c533b583335bafc0a4ec',
  GAME_BOON_MODULE:        '0xa69dcbcbba89d1de933918929fd5e5e30bb4588f',
  GAME_DEGENERETTE_MODULE: '0x3a2a7e07c875b6e97d2ebd1f8608f7b42f4b2ac2',
  COIN:                    '0x40098352663c361acb6dc692dd88405c80a8e4cb',
  COINFLIP:                '0x8e0d5a1fc2816bc6714bc45cacf28376e9e2bf22',
  GAME:                    '0x8d034a80301ac66237db8b4f6bfe29cfcdb11057',
  WWXRP:                   '0x13c1dd7d8447262ecf38876756aeb239151eba79',
  AFFILIATE:               '0x98e4087639c0dbb2de0a0693595360243a6a7b17',
  JACKPOTS:                '0xf0aaccbfbb17ab57fff2d20d79673034df4de93e',
  QUESTS:                  '0xe4a0770fa02aeabd10ddf6fd235af8ea6a7e1dc0',
  DEITY_PASS:              '0x69fc9555117fff808ceabb8941fa819c14d79e16',
  VAULT:                   '0x3018163c816537dd39dd178422dc567995fd6a08',
  SDGNRS:                  '0x0730ecfa8a5ab9a50b1bd920e6be1df3fee4a54b',
  DGNRS:                   '0xeef06f0e3e82dbe85b7469943abc06b1c4b21c74',
};

export const ETH_DIVISOR = 1_000_000n;     // /1M scaleEth on Sepolia (Phase 51 51-03 decision)
export const TICKET_DIVISOR = 100n;        // BAF scaling — same on both chains
export const MAINNET_PENDING = false;
