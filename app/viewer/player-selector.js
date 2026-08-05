// viewer/player-selector.js -- Player dropdown population with archetype labels
// Imports only from ./api.js and ./utils.js (no app/ imports) -- SHELL-01

import { fetchJSON } from './api.js';
import { truncateAddress } from './utils.js';

const ARCHETYPE_LABEL = {
  degen:       'Degen',
  evMaximizer: 'EV Max',
  whale:       'Whale',
  hybrid:      'Hybrid',
};

let archetypeMap = null;

async function loadArchetypeMap() {
  if (archetypeMap) return archetypeMap;
  const res = await fetch('/app/viewer/player-archetypes.json');
  if (!res.ok) throw new Error(`Failed to load player-archetypes.json: ${res.status}`);
  archetypeMap = await res.json();
  return archetypeMap;
}

async function loadJackpotTotals() {
  // Aggregate jackpot winnings per player across all levels with data
  const totals = {};
  for (let lvl = 1; lvl <= 20; lvl++) {
    try {
      const { distributions } = await fetchJSON(`/game/jackpot/${lvl}`);
      for (const d of distributions) {
        if (!totals[d.winner]) totals[d.winner] = 0n;
        totals[d.winner] += BigInt(d.amount || '0');
      }
    } catch { /* no data for this level */ }
  }
  return totals;
}

function formatEthShort(wei) {
  const eth = Number(wei) / 1e18;
  if (eth === 0) return '';
  if (eth < 1) return eth.toFixed(3) + ' ETH';
  return eth.toFixed(1) + ' ETH';
}

export async function initPlayerSelector(selectEl, onPlayerChange) {
  const loadingEl = document.getElementById('viewer-player-loading');

  // Show loading state
  selectEl.disabled = true;
  if (loadingEl) loadingEl.style.display = 'block';

  try {
    const [{ players }, archMap, jackpotTotals] = await Promise.all([
      fetchJSON('/replay/players'),
      loadArchetypeMap(),
      loadJackpotTotals(),
    ]);

    // Clear and populate — show jackpot winnings in label
    selectEl.innerHTML = '<option value="">-- Select a player --</option>';
    for (const addr of players) {
      const opt = document.createElement('option');
      opt.value = addr;
      const archetype = archMap[addr.toLowerCase()];
      const label = ARCHETYPE_LABEL[archetype] ?? 'Unknown';
      const winnings = jackpotTotals[addr] || jackpotTotals[addr.toLowerCase()] || 0n;
      const winLabel = winnings > 0n ? ` — won ${formatEthShort(winnings)}` : '';
      opt.textContent = `${label} (${truncateAddress(addr)})${winLabel}`;
      selectEl.appendChild(opt);
    }

    selectEl.disabled = false;
  } catch (err) {
    console.error('[viewer] Failed to load players:', err);
    // Show error below select
    const errorEl = document.createElement('div');
    errorEl.className = 'viewer-error';
    errorEl.textContent = 'Could not load players. Check the API server is running.';
    selectEl.parentElement.appendChild(errorEl);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }

  // Wire change event
  selectEl.addEventListener('change', () => {
    const addr = selectEl.value;
    if (addr) onPlayerChange(addr);
  });
}

export function setSelectedPlayer(selectEl, addr) {
  if (!addr) return;
  selectEl.value = addr;
}
