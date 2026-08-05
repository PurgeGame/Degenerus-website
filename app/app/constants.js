// app/constants.js -- Contract addresses, chain config, badge paths

export const CHAIN = {
  id: 31337,
  name: 'Anvil Local',
  rpcUrl: 'http://127.0.0.1:8545',
};

export const CONTRACTS = {
  GAME: '0x54ad8e5f30f2ce3bf3b0d60301de28a5c2d41044',
  COIN: '0x280a5067694f9deffa767f81d257fbd4f3ac557b',
  COINFLIP: '0x364a407bcc157c47bba3b7943ca1de34dfa619f4',
  WWXRP: '0x8679b4b8c27e15c88807a15980f725924411d3f4',
  AFFILIATE: '0x3631d97d708defc9f3d3d11107459e6fd167a20e',
  JACKPOTS: '0xb29a9d70b1bb47abfbc5800672a7fb9441b99954',
  QUESTS: '0xbc839f05cfc6e03128864c2e89c6b09356145791',
  DEITY_PASS: '0x38ba62d422167ee5ff2db5b3969f00d5991ea8c5',
  VAULT: '0x7265b4d7a9e2d2accc114cf798d74934d2ca45a6',
  DGNRS: '0x77097af720b3915f96d0e512ebcc841037ffeca0',
  GAME_MINT_MODULE: '0xdf1874bb37b87a8befccc645470553a52359ba2d',
  GAME_LOOTBOX_MODULE: '0x87ed4a3b245020a84f566f512782bcebb45f0ea5',
  GAME_DEGENERETTE_MODULE: '0x21ea7c013dd6c20fcdd90e16289b7bdf5f02ef16',
  GAME_DECIMATOR_MODULE: '0x2c55976105e5d2b7cae25870407c9385ad75dd01',
  GAME_JACKPOT_MODULE: '0xaf2043d670ca1f724bbe239f13e1611083a0ffcf',
  GAME_WHALE_MODULE: '0x15a52f903100f04ecc1d71b2ab7943cababa73d3',
  GAME_BOON_MODULE: '0x4af6c15a88a76597b78eff83645c1de326b881ad',
  GAME_ADVANCE_MODULE: '0xa8d9e2d8701133a1d5bfb61b6f65bcccd9ae355b',
  GAME_ENDGAME_MODULE: '0xb7f8bc63bbcad18155201308c8f3540b07f84f5e',
  GAME_GAMEOVER_MODULE: '0x7550466fa05ba43044d6412c768fbf1dda22c0e0',
  ADMIN: '0x84ef3977c26bb6db0a03a067c226e70396a8dc4b',
};

export const ETHERSCAN_BASE = 'http://localhost:8545';

// Sepolia/local deployments store ETH-denominated game amounts at 1/1,000,000
// scale. ERC-20 coin amounts keep their normal 18-decimal units.
export const ETH_DISPLAY_SCALE = 1_000_000n;
export const TOKEN_DISPLAY_SCALE = 1n;

// Indexer/DB API (Fastify, database repo). Host-aware: pages served from
// localhost keep the local dev stack; the deployed site hits the Fly app.
// NOTE: this is NOT the api.degener.us session server (Discord/wallet login) —
// two different services.
export const API_BASE =
  typeof window === 'undefined' ||
  /^(localhost|127\.0\.0\.1)$/.test(window.location?.hostname ?? 'localhost')
    ? 'http://localhost:3000'
    : 'https://degenerus-db.fly.dev';

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
  MIN_DEPOSIT: '100',       // 100 FLIP minimum (whole tokens, not wei)
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
  CURRENCY: { ETH: 0, FLIP: 1, WWXRP: 3 },
  MIN_BET: { ETH: '0.005', FLIP: '100', WWXRP: '1' },
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
  MIN_BURN: '1000',             // 1,000 FLIP minimum (whole tokens, not wei)
  BUCKET_BASE: 12,              // Starting bucket (worst odds)
  MIN_BUCKET_NORMAL: 5,         // Best bucket for non-x00 levels
  MIN_BUCKET_100: 2,            // Best bucket for x00 levels
  ACTIVITY_CAP_BPS: 23500,      // Activity score cap for bucket/multiplier calc
  MULTIPLIER_CAP_FLIP: 200000, // After 200k FLIP, burns count at 1x
  POOL_SHARE_NORMAL: 0.10,      // 10% of futurepool at x5 levels
  POOL_SHARE_100: 0.30,         // 30% of futurepool at x00 levels
};

export const QUEST_TYPE_LABELS = {
  0: 'Mint FLIP Tickets',
  1: 'Mint ETH Tickets',
  2: 'Coinflip',
  3: 'Affiliate Earnings',
  4: 'Reserved',
  5: 'Decimator Burns',
  6: 'Lootbox',
  7: 'Degenerette (ETH)',
  8: 'Degenerette (FLIP)',
};
