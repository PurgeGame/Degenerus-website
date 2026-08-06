import { BADGE_ITEMS, BADGE_QUADRANTS, badgeCircularPath } from './constants.js';

export function deitySymbolPresentation(symbolId) {
  const id = Number(symbolId);
  if (!Number.isInteger(id) || id < 0 || id > 31) return null;
  const quadrant = (id >> 3) & 3;
  const symbol = id & 7;
  const category = BADGE_QUADRANTS[quadrant];
  const slug = BADGE_ITEMS[category]?.[symbol];
  if (!category || !slug) return null;
  const displayName = slug === 'xrp' ? 'WWXRP' : slug.charAt(0).toUpperCase() + slug.slice(1);
  return {
    id,
    name: displayName,
    title: `God of ${displayName}`,
    path: badgeCircularPath(category, symbol, 'gold'),
  };
}
