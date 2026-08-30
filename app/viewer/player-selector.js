// viewer/player-selector.js -- Player dropdown population with archetype labels
// Imports only from ./api.js and ./utils.js (no app/ imports) -- SHELL-01

import { API_BASE, fetchJSON } from './api.js';
import { truncateAddress } from './utils.js';

const ARCHETYPE_LABEL = {
  degen:       'Degen',
  evMaximizer: 'EV Max',
  whale:       'Whale',
  hybrid:      'Hybrid',
  afkPassive:  'AFK Passive',
  afkQuestFlip:'AFK Quest + Flip',
  vault:       'Protocol Vault',
  sdgnrs:      'Protocol Token',
};

let archetypeMap = null;
let simIdentityMap = new Map();

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

async function loadSimRoster() {
  try {
    return await fetchJSON('/players/sim');
  } catch (err) {
    // Backward-compatible fallback for a viewer pointed at an older API.
    console.warn('[viewer] Sim Discord roster unavailable:', err);
    return { players: [] };
  }
}

function resolveAvatarUrl(identity, path) {
  if (!path) return '';
  return identity?.avatarSource === 'api' ? `${API_BASE}${path}` : path;
}

function avatarImage(src, className) {
  const image = document.createElement('img');
  image.src = src;
  image.alt = '';
  image.className = className;
  image.loading = 'lazy';
  return image;
}

function renderIdentityCard(address) {
  const card = document.getElementById('viewer-player-profile');
  if (!card) return;
  const identity = address ? simIdentityMap.get(address.toLowerCase()) : null;
  card.hidden = !identity;
  if (!identity) return;

  const avatar = card.querySelector('[data-bind="avatar"]');
  const name = card.querySelector('[data-bind="name"]');
  const handle = card.querySelector('[data-bind="handle"]');
  const type = card.querySelector('[data-bind="type"]');
  avatar.replaceChildren();

  if (identity.avatarLayers) {
    avatar.classList.add('is-layered');
    avatar.append(
      avatarImage(resolveAvatarUrl(identity, identity.avatarLayers.frameUrl), 'viewer-profile__avatar-frame'),
      avatarImage(resolveAvatarUrl(identity, identity.avatarLayers.markUrl), 'viewer-profile__avatar-mark'),
    );
  } else {
    avatar.classList.remove('is-layered');
    avatar.append(avatarImage(resolveAvatarUrl(identity, identity.avatarUrl), 'viewer-profile__avatar-image'));
  }

  card.style.setProperty('--profile-color', identity.avatarColor);
  name.textContent = identity.discordName;
  handle.textContent = identity.discordHandle;
  type.textContent = ARCHETYPE_LABEL[identity.playerType] ?? identity.playerType;
}

export function getPlayerIdentity(address) {
  return address ? simIdentityMap.get(address.toLowerCase()) ?? null : null;
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
    const [{ players }, archMap, jackpotTotals, simRoster] = await Promise.all([
      fetchJSON('/replay/players'),
      loadArchetypeMap(),
      loadJackpotTotals(),
      loadSimRoster(),
    ]);

    simIdentityMap = new Map(simRoster.players.map(({ address, simIdentity }) => [
      address.toLowerCase(),
      simIdentity,
    ]));

    // The manifest is the complete sim roster (including players that have not
    // acted yet). Preserve replay-only addresses as a compatibility fallback.
    const addresses = [];
    const seen = new Set();
    for (const { address } of simRoster.players) {
      const normalized = address.toLowerCase();
      if (!seen.has(normalized)) addresses.push(address);
      seen.add(normalized);
    }
    for (const address of players) {
      const normalized = address.toLowerCase();
      if (!seen.has(normalized)) addresses.push(address);
      seen.add(normalized);
    }

    // Clear and populate — show jackpot winnings in label
    selectEl.innerHTML = '<option value="">-- Select a player --</option>';
    for (const addr of addresses) {
      const opt = document.createElement('option');
      opt.value = addr;
      const identity = simIdentityMap.get(addr.toLowerCase());
      const archetype = identity?.playerType ?? archMap[addr.toLowerCase()];
      const label = ARCHETYPE_LABEL[archetype] ?? 'Unknown';
      const winnings = jackpotTotals[addr] || jackpotTotals[addr.toLowerCase()] || 0n;
      const winLabel = winnings > 0n ? ` — won ${formatEthShort(winnings)}` : '';
      const name = identity ? `${identity.discordName} — ` : '';
      opt.textContent = `${name}${label} (${truncateAddress(addr)})${winLabel}`;
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
    renderIdentityCard(addr);
    if (addr) onPlayerChange(addr, getPlayerIdentity(addr));
  });
}

export function setSelectedPlayer(selectEl, addr) {
  if (!addr) return;
  selectEl.value = addr;
  renderIdentityCard(addr);
}
