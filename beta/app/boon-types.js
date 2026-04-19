// app/boon-types.js -- Single source of truth for deity boon type IDs.
// Mirrored from contracts/DeityBoonViewer.sol. Per Phase 44 D-05.
//
// Single-day boons issued by deities; expire at end of their issue day.
// Reserved/unused IDs (4, 10, 11, 12, 20, 21) are omitted. 25 entries total.
//
// This module is imported by both <jackpot-panel> (handoff work) and
// <boons-panel> (Phase 44 BOON-03) — neither component should redefine
// these tables locally.

export const BOON_TYPE_NAMES = {
  1:  'CF_5',
  2:  'CF_10',
  3:  'CF_25',
  5:  'LB_5',
  6:  'LB_15',
  7:  'PUR_5',
  8:  'PUR_15',
  9:  'PUR_25',
  13: 'DEC_10',
  14: 'DEC_25',
  15: 'DEC_50',
  16: 'WH_10',
  17: 'ACT_10',
  18: 'ACT_25',
  19: 'ACT_50',
  22: 'LB_25',
  23: 'WH_25',
  24: 'WH_50',
  25: 'DP_10',
  26: 'DP_25',
  27: 'DP_50',
  28: 'WHPASS',
  29: 'LAZY_10',
  30: 'LAZY_25',
  31: 'LAZY_50',
};

// Full human-readable names for tooltips. WHPASS has no numeric boost (pass-type).
export const BOON_FULL_NAMES = {
  1:  'Coinflip +5%',
  2:  'Coinflip +10%',
  3:  'Coinflip +25%',
  5:  'Lootbox +5%',
  6:  'Lootbox +15%',
  7:  'Purchase +5%',
  8:  'Purchase +15%',
  9:  'Purchase +25%',
  13: 'Decimator +10%',
  14: 'Decimator +25%',
  15: 'Decimator +50%',
  16: 'Whale +10%',
  17: 'Activity +10%',
  18: 'Activity +25%',
  19: 'Activity +50%',
  22: 'Lootbox +25%',
  23: 'Whale +25%',
  24: 'Whale +50%',
  25: 'Deity Pass +10%',
  26: 'Deity Pass +25%',
  27: 'Deity Pass +50%',
  28: 'Whale Pass',
  29: 'Lazy +10%',
  30: 'Lazy +25%',
  31: 'Lazy +50%',
};

// Percent boost parsed from the numeric suffix of each BOON_TYPE_NAMES entry.
// e.g. CF_5 -> 5, CF_10 -> 10, DEC_50 -> 50, WHPASS -> null (no numeric suffix).
// Derived programmatically to stay in sync with BOON_TYPE_NAMES — do NOT
// hand-maintain a parallel literal table.
export const BOON_BOOST_PCT = Object.fromEntries(
  Object.entries(BOON_TYPE_NAMES).map(([id, name]) => {
    const m = /_(\d+)$/.exec(name);
    return [Number(id), m ? Number(m[1]) : null];
  }),
);
