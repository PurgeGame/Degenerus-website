// app/constants.js -- Contract addresses, chain config, badge paths

export const CHAIN = {
  id: 31337,
  name: 'Anvil Local',
  rpcUrl: 'http://127.0.0.1:8545',
};

export const CONTRACTS = {
  GAME: '0xa2868ed96cd3cc873db6d84035b4cf5ca05db623',
  COIN: '0xedfcd8373cc1f9980af967f1ef167c631433e8ba',
  COINFLIP: '0x31779ab167664d38fcb6188390073e3c0aee260d',
  WWXRP: '0x6085b0e2e2bcea8b3fa8c0148ce0a31ecc080fc5',
  AFFILIATE: '0xcbdbd43c9f49f48de245d81d008c6835741076de',
  JACKPOTS: '0xc7d63825feb5e43dd615400d2bfe8db72b7a57c0',
  QUESTS: '0xcb0b0357df6478fd4bf09c60b395e0c9fe51d806',
  DEITY_PASS: '0xc83a9b319f2ebb61183c0a11667aa80ea4d5296f',
  VAULT: '0x7b965575249ea39bdef7e5652404004a8bfd7496',
  DGNRS: '0xd424da01909200db0088453331c1371f2bedabdc',
  GAME_MINT_MODULE: '0xd33b2cf3c9e112ca008e18406a1a8a1a5e3c1a52',
  GAME_LOOTBOX_MODULE: '0x9f8e8841612fd1b305d2704f8cc74634da9f104b',
  GAME_DEGENERETTE_MODULE: '0x393f56bcf8f8f1bb2746a1ff59fc25fc0b3a29ab',
  GAME_DECIMATOR_MODULE: '0xabd3a4decd62e3074be1ad627d22bcf81dc1b098',
  GAME_JACKPOT_MODULE: '0xca8bd2ba9f3e23cdd65599fcd5fd6d65461bc776',
  GAME_WHALE_MODULE: '0x0b2c9f878eaa4494a8cbae4b6f39e5a13ce22754',
  GAME_BOON_MODULE: '0x8bc69e042937b76291fd8609e510bac294c7fc69',
  GAME_ADVANCE_MODULE: '0x8c6c70aaa9e28ad2471ff38e16fd01b490a6bb56',
  GAME_ENDGAME_MODULE: '0xb7f8bc63bbcad18155201308c8f3540b07f84f5e',
  GAME_GAMEOVER_MODULE: '0x7e35e3924e897b484f8c915d45717775a86a8d49',
  ADMIN: '0x16ea80a57ac86ef97f62d0ea1b6f0d260e36d684',
};

export const ETHERSCAN_BASE = 'http://localhost:8545';

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
