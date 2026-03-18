// app/constants.js -- Contract addresses, chain config, badge paths

export const CHAIN = {
  id: 11155111,
  name: 'Sepolia',
  rpcUrl: 'https://rpc.sepolia.org',
};

export const CONTRACTS = {
  GAME: '0xF2f4A709982D54CE55EF832558eFa4969d245D89',
  COIN: '0x503ed729A72dF2180ddCb495aC876700B300a256',
  COINFLIP: '0x17e5a8750D675821106dCc4Aba83C96aC8130A45',
  WWXRP: '0x50cBFf5C616cED643096B18Db0164b33595D2299',
  AFFILIATE: '0xf1d5c9A6Ba6CCF2B81883c5cD1C3bB6167A00e3F',
  JACKPOTS: '0x04d9499fA62937a5B1267b6d1eeb62c4aCC4EbFe',
  QUESTS: '0x52f203e4294BD9828dCB3AbeB314677a84690E85',
  DEITY_PASS: '0xE135C581783B97Ac2d475d3fc3372c987bE4e470',
  VAULT: '0x6e6302AcB49d9Fa94359e709551d114C321Dbbf8',
  DGNRS: '0xaE9e8ee5b7ceC85fD30f7B60182780AF58952a17',
  GAME_MINT_MODULE: '0x83532D99172850bc39078E8CAd48375162b9C2bf',
  GAME_LOOTBOX_MODULE: '0xD2BCd9321C8bAf1E6219C4DCED930865F8e2b8aC',
  GAME_DEGENERETTE_MODULE: '0x89B4aC3815b3177c7C8Dc14DC568ceffeeDE15c8',
  GAME_DECIMATOR_MODULE: '0x04821fDdC454CadeDCE49Dcc8c03f09EEa6CA455',
  GAME_JACKPOT_MODULE: '0x27d7D20f2C9fDbbB585E20f51CE0dB9b9Ea5818b',
  GAME_WHALE_MODULE: '0x9B42393C7998F60bc5B81d856ea8d93bC8B76cCb',
  GAME_BOON_MODULE: '0x581ebfFdaA27Ea87dFC3eB9535aeDB68A42602FE',
  GAME_ADVANCE_MODULE: '0xc23c6b6C64a25a91E6873C8b632c2d5585622362',
  GAME_ENDGAME_MODULE: '0x6E253D564A1be5c75d38242a2F6bE8f0C5022118',
  GAME_GAMEOVER_MODULE: '0xD9f878833D5D898465260dE815eA7f8378b09DCa',
  ADMIN: '0x2ab150B850b1c66F044945c211CD7e71328F1e4d',
};

export const ETHERSCAN_BASE = 'https://sepolia.etherscan.io';

export const API_BASE = 'http://localhost:3000';

export const POLL_INTERVALS = {
  gameState: 15000,    // 15 seconds
  playerData: 30000,   // 30 seconds
  health: 60000,       // 60 seconds
};

export const BADGE_CATEGORIES = ['crypto', 'zodiac', 'cards', 'dice', 'gemstones', 'mythology'];
export const BADGE_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet', 'pink'];

export function badgePath(category, color) {
  return `/badges/${category}_${color}.svg`;
}

export function badgeCircularPath(category, index, color) {
  return `/badges-circular/${category}_${String(index).padStart(2, '0')}_${color}.svg`;
}
