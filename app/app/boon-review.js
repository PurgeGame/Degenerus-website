// Deterministic visual fixture: every boon-consuming production surface is
// active together without a wallet, RPC, or backend dependency.

import { update } from './store.js';
import '../components/boon-product-indicator.js';

export const BOON_REVIEW_ROWS = Object.freeze([
  { boonType: 3, consumed: false },                    // Coinflip +25%
  { boonType: 4, consumed: false },                    // Quest streak shield
  { boonType: 6, consumed: false },                    // Luckbox +15%
  { boonType: 7, consumed: false },                    // Tickets +5%
  { boonType: 15, consumed: false },                   // Decimator +50%
  { boonType: 23, consumed: false },                   // Whale pass -20%
  { boonType: 18, consumed: false, boostAmount: 25 },  // +12.5 Degen Rating
  { boonType: 27, consumed: false },                   // Deity pass -35%
  { boonType: 29, consumed: false },                   // Lazy pass -10%
  { boonType: 32, consumed: false },                   // ETH Degenerette +4%
  { boonType: 36, consumed: false },                   // FLIP Degenerette +8%
  { boonType: 40, consumed: false },                   // WWXRP Degenerette +12%
]);

update('app.boons', {
  address: '0x000000000000000000000000000000000000b00a',
  day: 99,
  boons: BOON_REVIEW_ROWS.map((row) => ({ ...row })),
});

document.documentElement.setAttribute('data-boon-review-ready', 'true');
