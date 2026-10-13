// Recorded level-10 jackpot awards from degenerus_run70.jackpot_distributions.
// Block 47910983, day 12:
// 0xeb5fd4e7f61bd40ece8b811b308e3955a6eb9af85c953f44eab966b649b95e83
// ETH amounts are raw testnet wei (the site's ETH display multiplier is 1,000,000).
// Ticket amounts are entries (4 entries = 1 ticket). The intro remaps badges
// and recipients to illustrate four outcomes; it preserves these prize sizes
// and award counts rather than presenting the examples as historical replays.
export const LEVEL_10_PRIZES = [
  { traitId: 48, amount: '147156165323083', winners: 1, tickets: [] },
  { traitId: 108, amount: '200000000000', winners: 128, tickets: [
    { amount: '36', winners: 64, level: 11, sourceLevel: 10 },
    { amount: '20', winners: 64, level: 11, sourceLevel: 11 },
  ] },
  { traitId: 159, amount: '400000000000', winners: 64, tickets: [
    { amount: '36', winners: 64, level: 11, sourceLevel: 10 },
    { amount: '20', winners: 64, level: 11, sourceLevel: 11 },
  ] },
  { traitId: 231, amount: '1900000000000', winners: 16, tickets: [
    { amount: '36', winners: 64, level: 11, sourceLevel: 10 },
    { amount: '20', winners: 64, level: 11, sourceLevel: 11 },
  ] },
];
