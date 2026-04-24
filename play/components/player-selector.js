// play/components/player-selector.js -- <player-selector> Custom Element
// Lifted from beta/viewer/player-selector.js with two changes:
//   1. archetypes JSON fetched from /shared/ (Phase 50 move)
//   2. imports truncateAddress from ../../beta/viewer/utils.js (wallet-free)
// SHELL-01: no imports from beta/app/utils.js (ethers-tainted) or wallet/contracts.

import { subscribe } from '../../beta/app/store.js';
import { fetchJSON } from '../app/api.js';
import { truncateAddress } from '../../beta/viewer/utils.js';

const ARCHETYPE_LABEL = {
  degen:       'Degen',
  evMaximizer: 'EV Max',
  whale:       'Whale',
  hybrid:      'Hybrid',
};

let archetypeMap = null;

async function loadArchetypeMap() {
  if (archetypeMap) return archetypeMap;
  const res = await fetch('/shared/player-archetypes.json');
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
      for (const d of distributions || []) {
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

/**
 * Populate the dropdown and wire change events. Signature matches beta/viewer.
 * main.js calls this with the element's internal <select>.
 */
export async function initPlayerSelector(selectEl, onPlayerChange) {
  const loadingEl = selectEl.parentElement
    ? selectEl.parentElement.querySelector('[data-role="player-loading"]')
    : null;

  selectEl.disabled = true;
  if (loadingEl) loadingEl.style.display = 'block';

  try {
    const [{ players }, archMap, jackpotTotals] = await Promise.all([
      fetchJSON('/replay/players'),
      loadArchetypeMap(),
      loadJackpotTotals(),
    ]);

    // SECURITY (T-50-01): build options with createElement + textContent, never innerHTML.
    selectEl.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Select a player --';
    selectEl.appendChild(placeholder);

    for (const addr of (players || [])) {
      const opt = document.createElement('option');
      opt.value = addr;
      const archetype = archMap[addr.toLowerCase()];
      const label = ARCHETYPE_LABEL[archetype] ?? 'Unknown';
      const winnings = jackpotTotals[addr] || jackpotTotals[addr.toLowerCase()] || 0n;
      const winLabel = winnings > 0n ? ` -- won ${formatEthShort(winnings)}` : '';
      opt.textContent = `${label} (${truncateAddress(addr)})${winLabel}`;
      selectEl.appendChild(opt);
    }

    selectEl.disabled = false;
  } catch (err) {
    console.error('[play] Failed to load players:', err);
    const errorEl = document.createElement('div');
    errorEl.className = 'viewer-error';
    errorEl.textContent = 'Could not load players. Check the API server is running.';
    if (selectEl.parentElement) selectEl.parentElement.appendChild(errorEl);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }

  selectEl.addEventListener('change', () => {
    const addr = selectEl.value;
    if (addr) onPlayerChange(addr);
  });
}

export function setSelectedPlayer(selectEl, addr) {
  if (!addr) return;
  selectEl.value = addr;
}

class PlayerSelector extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    // Render the host's internal DOM: one <select> + a skeleton-line loading sibling.
    // SECURITY (T-50-01): template is a static string with no interpolation.
    this.innerHTML = `
      <label class="viewer-select-label" for="play-player-select">Player</label>
      <select id="play-player-select" class="viewer-select" disabled>
        <option value="">-- Select a player --</option>
      </select>
      <div data-role="player-loading" class="skeleton-line skeleton-shimmer" style="height:12px;display:none"></div>
    `;

    // Subscription hooks (no-op for Phase 50; Phases 51-55 wire panel hydration).
    this.#unsubs.push(
      subscribe('replay.player', (addr) => console.log('[player-selector] replay.player =', addr)),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
  }
}

customElements.define('player-selector', PlayerSelector);
