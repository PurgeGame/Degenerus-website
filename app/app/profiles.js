// /app/app/profiles.js — public Discord display identity for on-chain addresses.
//
// Leaderboards and record rails all show the same thing: a wallet that may or
// may not be linked to a Discord account. This module is the one place that
// turns a batch of addresses into names and avatars. It imports only the light
// chain config so any component can use it without pulling in ethers.
//
// Identity is decoration. An outage here must never blank the numbers, so this
// never throws and simply omits anyone it cannot resolve — callers keep their
// shortened-address fallback. Genuine Discord links always take precedence;
// the testnet simulation roster only fills wallets that remain unlinked.

import { API_BASE } from './constants.js';

const SESSION_API = 'https://api.degener.us';
let simRosterPromise = null;

function normalizeAddress(address) {
  const normalized = String(address || '').toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(normalized) ? normalized : null;
}

function simAvatarUrl(identity) {
  const path = String(identity?.avatarUrl || '').trim();
  if (identity?.avatarSource === 'api'
      && /^\/players\/0x[0-9a-f]{40}\/avatar\.svg$/.test(path)) {
    return `${API_BASE}${path}`;
  }
  if (identity?.avatarSource === 'site'
      && /^\/(?:badges-circular|specials)\/[a-zA-Z0-9._/-]+$/.test(path)) {
    return path;
  }
  return null;
}

async function fetchLinkedProfiles(addresses) {
  const profiles = new Map();
  try {
    const url = `${SESSION_API}/api/profiles?addresses=${encodeURIComponent(addresses.join(','))}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return profiles;
    const body = await res.json();
    for (const profile of (Array.isArray(body?.profiles) ? body.profiles : [])) {
      const address = normalizeAddress(profile?.address);
      const name = String(profile?.discord_name || '').trim();
      if (!address || !name) continue;
      const avatar = String(profile?.discord_avatar || '').trim();
      profiles.set(address, {
        name,
        // Linked avatars must remain secure remote URLs. Anything else is
        // discarded rather than written into an img src.
        avatar: /^https:\/\//.test(avatar) ? avatar : null,
      });
    }
  } catch (_e) { /* use sim/address fallback */ }
  return profiles;
}

async function fetchSimRoster() {
  const profiles = new Map();
  try {
    const res = await fetch(`${API_BASE}/players/sim`, { credentials: 'omit' });
    if (!res.ok) return profiles;
    const body = await res.json();
    for (const player of (Array.isArray(body?.players) ? body.players : [])) {
      const address = normalizeAddress(player?.address);
      const identity = player?.simIdentity;
      const name = String(identity?.discordName || '').trim();
      if (!address || !name) continue;
      profiles.set(address, { name, avatar: simAvatarUrl(identity) });
    }
  } catch (_e) { /* keep shortened-address fallback */ }
  return profiles;
}

function loadSimRoster() {
  // The roster is immutable for one published testnet run and can be shared by
  // Craps, records, BAF, and referrals without downloading it per component.
  simRosterPromise ??= fetchSimRoster();
  return simRosterPromise;
}

/**
 * Map addresses to their public Discord display identity.
 *
 * @param {string[]} addresses Any mix of cased/uncased addresses; deduped here.
 * @returns {Promise<Map<string, {name: string, avatar: string|null}>>} keyed by
 *          lowercased address. Unlinked addresses are absent from the map.
 */
export async function fetchProfiles(addresses) {
  const unique = [...new Set(
    (addresses || [])
      .map(normalizeAddress)
      .filter(Boolean),
  )];
  const out = new Map();
  if (unique.length === 0) return out;

  const [linked, simulated] = await Promise.all([
    fetchLinkedProfiles(unique),
    loadSimRoster(),
  ]);
  for (const address of unique) {
    const profile = linked.get(address) || simulated.get(address);
    if (profile) out.set(address, profile);
  }
  return out;
}

/** Test seam; production callers should share the run-scoped cache. */
export function __resetSimRosterForTest() {
  simRosterPromise = null;
}
