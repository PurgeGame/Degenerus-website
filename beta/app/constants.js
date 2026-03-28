// app/constants.js -- Contract addresses, chain config, badge paths

export const CHAIN = {
  id: 31337,
  name: 'Anvil Local',
  rpcUrl: 'http://127.0.0.1:8545',
};

export const CONTRACTS = {
  GAME: '0x68b1d87f95878fe05b998f19b66f4baba5de1aed',
  COIN: '0x959922be3caee4b8cd9a407cc3ac1c251c2007b1',
  COINFLIP: '0x9a9f2ccfde556a7e9ff0848998aa4a0cfd8863ae',
  WWXRP: '0x3aa5ebb10dc797cac828524e59a333d0a371443c',
  AFFILIATE: '0xc6e7df5e7b4f2a278906862b61205850344d4e7d',
  JACKPOTS: '0x59b670e9fa9d0a427751af201d676719a970857b',
  QUESTS: '0x4ed7c70f96b99c776995fb64377f0d4ab3b0e1c1',
  DEITY_PASS: '0x322813fd9a801c5507c9de605d63cea4f2ce6c44',
  VAULT: '0xa85233c63b9ee964add6f2cffe00fd84eb32338f',
  DGNRS: '0x7a2088a1bfc9d81c55368ae168c2c02570cb814f',
  GAME_MINT_MODULE: '0x0165878a594ca255338adfa4d48449f69242eb8f',
  GAME_LOOTBOX_MODULE: '0x0dcd1bf9a1b36ce34237eeafef220932846bcd82',
  GAME_DEGENERETTE_MODULE: '0x0b306bf915c4d645ff596e518faf3f9669b97016',
  GAME_DECIMATOR_MODULE: '0x610178da211fef7d417bc0e6fed39f05609ad788',
  GAME_JACKPOT_MODULE: '0x8a791620dd6260079bf849dc5567adc3f2fdc318',
  GAME_WHALE_MODULE: '0x2279b7a0a67db372996a5fab50d91eaa73d2ebe6',
  GAME_BOON_MODULE: '0x9a676e781a523b5d0c0e43731313a708cb607508',
  GAME_ADVANCE_MODULE: '0xa513e6e4b8f2a923d98304ec87f64353c4d5c853',
  GAME_ENDGAME_MODULE: '0xb7f8bc63bbcad18155201308c8f3540b07f84f5e',
  GAME_GAMEOVER_MODULE: '0xa51c1fc2f0d1a1b8494ed1fe312d7c3a78ed91c0',
  ADMIN: '0x09635f643e140090a9a8dcd712ed6285858cebef',
};

export const ETHERSCAN_BASE = 'http://localhost:8545';

export const API_BASE = 'http://localhost:3000';

export const POLL_INTERVALS = {
  gameState: 15000,    // 15 seconds
  playerData: 30000,   // 30 seconds
  health: 60000,       // 60 seconds
};

export const BADGE_CATEGORIES = ['crypto', 'zodiac', 'cards', 'dice', 'gemstones', 'mythology'];
export const BADGE_QUADRANTS = ['crypto', 'zodiac', 'cards', 'dice'];
export const BADGE_COLORS = ['pink', 'purple', 'green', 'red', 'blue', 'orange', 'silver', 'gold'];
// SYMBOLS: ordered by symbol index (0-7) as the contract sees them
export const BADGE_ITEMS = {
  crypto: ['xrp', 'tron', 'sui', 'monero', 'solana', 'chainlink', 'ethereum', 'bitcoin'],
  zodiac: ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'libra', 'sagittarius', 'aquarius'],
  cards: ['club', 'diamond', 'heart', 'spade', 'horseshoe', 'cashsack', 'king', 'ace'],
  dice: ['1', '2', '3', '4', '5', '6', '7', '8'],
};
// Cards filesystem indices differ from symbol indices — CARD_IDX[symbolIdx] = fileIdx
const CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7];

export function badgePath(category, symbolIdx, color) {
  const fileIdx = category === 'cards' ? CARD_IDX[symbolIdx] : symbolIdx;
  const items = BADGE_ITEMS[category];
  const name = items ? items[symbolIdx] : symbolIdx;
  return `/badges-circular/${category}_${String(fileIdx).padStart(2, '0')}_${name}_${BADGE_COLORS[color]}.svg`;
}

export function badgeCircularPath(category, symbolIdx, color) {
  const fileIdx = category === 'cards' ? CARD_IDX[symbolIdx] : symbolIdx;
  const items = BADGE_ITEMS[category];
  const name = items ? items[symbolIdx] : symbolIdx;
  const colorName = typeof color === 'number' ? BADGE_COLORS[color] : color;
  return `/badges-circular/${category}_${String(fileIdx).padStart(2, '0')}_${name}_${colorName}.svg`;
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
