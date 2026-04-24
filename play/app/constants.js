// play/app/constants.js -- Re-exports from beta/app/constants.js (safe: no ethers)
// SHELL-01: beta/app/constants.js exports pure data (addresses as strings, badge helpers).
// The ABI exports in that file are plain string arrays (not ethers objects) so re-exporting
// is safe, but we deliberately narrow the surface to just what the play/ route needs.
export {
  API_BASE,
  BADGE_CATEGORIES,
  BADGE_QUADRANTS,
  BADGE_COLORS,
  BADGE_ITEMS,
  badgePath,
  badgeCircularPath,
} from '../../beta/app/constants.js';
