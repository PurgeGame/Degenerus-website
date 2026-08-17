// viewer/badge-inventory.js -- Badge ownership by day with color variants and real counts
// Uses /viewer/player/:addr/badges which returns ALL traits (not deduped) with block numbers

import { fetchJSON } from './api.js';

const QUADRANTS = ['crypto', 'zodiac', 'cards', 'dice'];
const COLORS = ['pink', 'purple', 'green', 'red', 'blue', 'orange', 'silver', 'gold'];
const ITEMS = {
  crypto: ['xrp', 'tron', 'sui', 'monero', 'solana', 'chainlink', 'ethereum', 'bitcoin'],
  zodiac: ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'libra', 'sagittarius', 'aquarius'],
  cards: ['club', 'diamond', 'heart', 'spade', 'horseshoe', 'cashsack', 'king', 'ace'],
  dice: ['1', '2', '3', '4', '5', '6', '7', '8'],
};
const CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7];

function badgePath(category, symbolIdx, colorIdx) {
  const fileIdx = category === 'cards' ? CARD_IDX[symbolIdx] : symbolIdx;
  const name = ITEMS[category][symbolIdx];
  return `/badges-circular/${category}_${String(fileIdx).padStart(2, '0')}_${name}_${COLORS[colorIdx]}.svg`;
}

function traitToBadge(traitIndex) {
  const quadrant = Math.floor(traitIndex / 64);
  const category = QUADRANTS[quadrant];
  const within = traitIndex % 64;
  const itemIdx = Math.floor(within / 8);
  const colorIdx = within % 8;
  const rawItem = ITEMS[category][itemIdx];
  const item = category === 'dice' && rawItem === '6' && COLORS[colorIdx] === 'gold'
    ? '6ix'
    : rawItem;
  return {
    category, item, itemIdx, colorIdx, color: COLORS[colorIdx],
    path: badgePath(category, itemIdx, colorIdx),
  };
}

let cachedPlayer = null;
let cachedData = null; // { traits: [{ traitIds: number[], blockNumber: number }] }

export async function render(player, day, blockRange, container) {
  if (!player) return;

  // Fetch raw traits (cache per player, filter per call)
  if (player !== cachedPlayer) {
    try {
      cachedData = await fetchJSON(`/viewer/player/${player}/badges`);
      cachedPlayer = player;
    } catch (err) {
      console.warn('[badge-inventory] Failed to load badges:', err);
      return;
    }
  }

  // Flatten all trait IDs earned up to this day (cumulative — blockNumber <= endBlock)
  const allTraitIds = [];
  for (const row of cachedData.traits) {
    if (blockRange && row.blockNumber > blockRange.endBlock) continue;
    for (const tid of row.traitIds) allTraitIds.push(tid);
  }

  // Count each unique badge (by trait index = unique item+color combo)
  const counts = new Map(); // traitIndex -> { badge, count }
  for (const tid of allTraitIds) {
    const existing = counts.get(tid);
    if (existing) existing.count++;
    else counts.set(tid, { badge: traitToBadge(tid), count: 1 });
  }

  const totalOwned = allTraitIds.length;
  const uniqueCount = counts.size;

  let html = `<div class="panel badge-inventory">
    <h2>BADGE COLLECTION — DAY ${day}</h2>
    <div class="badge-inventory__summary">${totalOwned} badges (${uniqueCount} unique)</div>
    <div class="badge-inventory__grid">`;

  for (const cat of QUADRANTS) {
    const catEntries = [...counts.values()].filter(e => e.badge.category === cat);
    if (catEntries.length === 0) continue;
    catEntries.sort((a, b) => b.count - a.count);
    const catTotal = catEntries.reduce((s, e) => s + e.count, 0);

    html += `<div class="badge-inventory__quadrant">
      <div class="badge-inventory__quadrant-label">${cat} <span class="badge-inventory__quadrant-count">${catTotal}</span></div>
      <div class="badge-inventory__items">`;

    for (const { badge, count } of catEntries) {
      html += `<div class="badge-inventory__item">
        <img src="${badge.path}" alt="${badge.item} ${badge.color}" class="badge-inventory__icon">
        <span class="badge-inventory__name">${badge.item}</span>
        <span class="badge-inventory__count">${count}</span>
      </div>`;
    }

    html += `</div></div>`;
  }

  html += `</div></div>`;
  container.insertAdjacentHTML('beforeend', html);
}
