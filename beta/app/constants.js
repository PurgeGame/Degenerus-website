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

export const DEATH_CLOCK = {
  TIMEOUT_LEVEL_0: 365 * 86400,   // 365 days in seconds
  TIMEOUT_DEFAULT: 120 * 86400,   // 120 days in seconds
  IMMINENT_THRESHOLD: 5 * 86400,  // 5 days in seconds
  DISTRESS_THRESHOLD: 6 * 3600,   // 6 hours in seconds
};

export const COINFLIP_ABI = [
  'function depositCoinflip(address player, uint256 amount) external',
  'function claimCoinflips(address player, address to) external',
  'function previewClaimCoinflips(address player) external view returns (uint256)',
  'function coinflipAmount(address player) external view returns (uint256)',
  'function coinflipAutoRebuyInfo(address player) external view returns (bool enabled, uint256 stopAmount, uint256 carryAmount, uint48 startDay)',
  'function setCoinflipAutoRebuy(address player, bool enabled, uint256 takeProfit) external',
  'function currentBounty() external view returns (uint128)',
  'function biggestFlipEver() external view returns (uint128)',
];

export const COINFLIP = {
  MIN_DEPOSIT: '100',       // 100 BURNIE minimum (whole tokens, not wei)
  RECYCLING_BONUS_PCT: 1.6, // 1.6% recycling bonus
};

export const DEGENERETTE_ABI = [
  'function placeFullTicketBets(address player, uint8 currency, uint128 amountPerTicket, uint8 ticketCount, uint32 customTicket, uint8 heroQuadrant) payable',
  'function resolveBets(address player, uint64[] betIds) external',
  'function degeneretteBetNonce(address player) view returns (uint64)',
];

export const CLAIMS_ABI = [
  'function claimWinnings(address player) external',
  'function claimableWinningsOf(address player) view returns (uint256)',
];

export const QUEST_ABI = [
  'function getPlayerQuestView(address player) view returns (tuple(tuple(uint48 day, uint8 questType, bool highDifficulty, tuple(uint32 mints, uint256 tokenAmount) requirements)[2] quests, uint128[2] progress, bool[2] completed, uint32 lastCompletedDay, uint32 baseStreak))',
];

export const AFFILIATE_ABI = [
  'function createAffiliateCode(bytes32 code, uint8 kickbackPct) external',
  'function referPlayer(bytes32 code) external',
  'function getReferrer(address player) view returns (address)',
  'function affiliateCode(bytes32 code) view returns (address owner, uint8 kickback)',
];

export const DEGENERETTE = {
  CURRENCY: { ETH: 0, BURNIE: 1, WWXRP: 3 },
  MIN_BET: { ETH: '0.005', BURNIE: '100', WWXRP: '1' },
  MAX_SPINS: 10,
  PENDING_BETS_KEY: 'degenerus_pending_bets',
};

export const DECIMATOR_ABI = [
  'function decimatorBurn(address player, uint256 amount) external',
  'function terminalDecimatorBurn(address player, uint256 amount) external',
];

export const DECIMATOR_VIEW_ABI = [
  'function decWindow() view returns (bool on, uint24 lvl)',
  'function decWindowOpenFlag() view returns (bool)',
  'function terminalDecWindow() view returns (bool open, uint24 lvl)',
  'function decClaimable(address player, uint24 lvl) view returns (uint256 amountWei, bool winner)',
  'function terminalDecClaimable(address player) view returns (uint256 amountWei, bool winner)',
  'function yieldAccumulatorView() view returns (uint256)',
  'function playerActivityScore(address player) view returns (uint256)',
  'function futurePrizePoolTotalView() view returns (uint256)',
  'function ticketsOwedView(uint24 lvl, address player) view returns (uint32)',
];

export const DECIMATOR_CLAIM_ABI = [
  'function claimDecimatorJackpot(uint24 lvl) external',
  'function claimTerminalDecimatorJackpot() external',
];

export const DECIMATOR = {
  MIN_BURN: '1000',             // 1,000 BURNIE minimum (whole tokens, not wei)
  BUCKET_BASE: 12,              // Starting bucket (worst odds)
  MIN_BUCKET_NORMAL: 5,         // Best bucket for non-x00 levels
  MIN_BUCKET_100: 2,            // Best bucket for x00 levels
  ACTIVITY_CAP_BPS: 23500,      // Activity score cap for bucket/multiplier calc
  MULTIPLIER_CAP_BURNIE: 200000, // After 200k BURNIE, burns count at 1x
  POOL_SHARE_NORMAL: 0.10,      // 10% of futurepool at x5 levels
  POOL_SHARE_100: 0.30,         // 30% of futurepool at x00 levels
};

export const QUEST_TYPE_LABELS = {
  0: 'Mint BURNIE Tickets',
  1: 'Mint ETH Tickets',
  2: 'Coinflip',
  3: 'Affiliate Earnings',
  4: 'Reserved',
  5: 'Decimator Burns',
  6: 'Lootbox',
  7: 'Degenerette (ETH)',
  8: 'Degenerette (BURNIE)',
};
