// Deterministic visual fixture: every boon-consuming production surface is
// active together without a wallet, RPC, or backend dependency.

import { update } from './store.js';
import '../components/boon-product-indicator.js';

export const BOON_REVIEW_ROWS = Object.freeze([
  { boonType: 3, consumed: false },                    // Coinflip +25%
  { boonType: 4, consumed: false },                    // Quest streak shield
  { boonType: 22, consumed: false },                   // Luckbox +25%
  { boonType: 9, consumed: false },                    // Tickets +25%
  { boonType: 15, consumed: false },                   // Decimator +50%
  { boonType: 24, consumed: false },                   // Whale pass -35%
  { boonType: 19, consumed: false, boostAmount: 50 },  // +25 Degen Score
  { boonType: 27, consumed: false },                   // Deity pass -35%
  { boonType: 31, consumed: false },                   // Lazy pass -50%
]);

update('app.boons', {
  address: '0x000000000000000000000000000000000000b00a',
  day: 99,
  boons: BOON_REVIEW_ROWS.map((row) => ({ ...row })),
});

document.documentElement.setAttribute('data-boon-review-ready', 'true');
