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
const PROFILE_TTL_MS = 60_000;
const RETRY_MS = 5_000;
const REQUEST_TIMEOUT_MS = 4_000;
const MAX_PROFILES = 1_000;
// The session service accepts at most eight addresses per lookup.
const PROFILE_BATCH_SIZE = 8;
const linkedCache = new Map();
const pendingProfiles = new Map();
const queuedProfiles = new Map();
let drainingProfiles = false;
let linkedRetryAt = 0;
let simRosterPromise = null;
let simRetryAt = 0;

async function readJSON(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error('Profile lookup unavailable');
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

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
    const body = await readJSON(url);
    if (!Array.isArray(body?.profiles)) return null;
    for (const profile of (Array.isArray(body?.profiles) ? body.profiles : [])) {
      const address = normalizeAddress(profile?.address);
      const name = String(profile?.discord_name || '').trim();
      if (!address || !name) continue;
      const avatar = String(profile?.discord_avatar || '').trim();
      profiles.set(address, Object.freeze({
        name,
        // Linked avatars must remain secure remote URLs. Anything else is
        // discarded rather than written into an img src.
        avatar: /^https:\/\//.test(avatar) ? avatar : null,
      }));
    }
  } catch (_e) { return null; /* retry briefly; do not cache as unlinked */ }
  return profiles;
}

async function drainProfiles() {
  try {
    while (queuedProfiles.size > 0) {
      const batch = [];
      for (const entry of queuedProfiles) {
        batch.push(entry);
        if (batch.length === PROFILE_BATCH_SIZE) break;
      }
      for (const [address] of batch) queuedProfiles.delete(address);
      const profiles = Date.now() < linkedRetryAt
        ? null
        : await fetchLinkedProfiles(batch.map(([address]) => address));
      if (profiles === null) linkedRetryAt = Date.now() + RETRY_MS;
      for (const [address, resolve] of batch) {
        const profile = profiles?.get(address) ?? null;
        if (profiles !== null) {
          linkedCache.delete(address);
          linkedCache.set(address, { profile, expiresAt: Date.now() + PROFILE_TTL_MS });
          while (linkedCache.size > MAX_PROFILES) {
            linkedCache.delete(linkedCache.keys().next().value);
          }
        }
        pendingProfiles.delete(address);
        resolve(profile);
      }
    }
  } finally {
    drainingProfiles = false;
  }
}

function loadLinkedProfile(address) {
  const cached = linkedCache.get(address);
  if (cached?.expiresAt > Date.now()) {
    linkedCache.delete(address);
    linkedCache.set(address, cached);
    return Promise.resolve(cached.profile);
  }
  if (pendingProfiles.has(address)) return pendingProfiles.get(address);
  if (Date.now() < linkedRetryAt) return Promise.resolve(null);
  const request = new Promise((resolve) => queuedProfiles.set(address, resolve));
  pendingProfiles.set(address, request);
  if (!drainingProfiles) {
    drainingProfiles = true;
    // Merge the records/BAF/Craps mount wave, including overlapping wallets.
    queueMicrotask(drainProfiles);
  }
  return request;
}

async function fetchSimRoster() {
  const profiles = new Map();
  try {
    const body = await readJSON(`${API_BASE}/players/sim`);
    if (!Array.isArray(body?.players)) return null;
    for (const player of (Array.isArray(body?.players) ? body.players : [])) {
      const address = normalizeAddress(player?.address);
      const identity = player?.simIdentity;
      const name = String(identity?.discordName || '').trim();
      if (!address || !name) continue;
      profiles.set(address, Object.freeze({ name, avatar: simAvatarUrl(identity) }));
    }
  } catch (_e) { return null; /* allow the next refresh to recover */ }
  return profiles;
}

function loadSimRoster() {
  // The roster is immutable for one published testnet run and can be shared by
  // Craps, records, BAF, and referrals without downloading it per component.
  if (!simRosterPromise && Date.now() < simRetryAt) return Promise.resolve(new Map());
  simRosterPromise ??= fetchSimRoster().then((profiles) => {
    if (profiles !== null) return profiles;
    simRosterPromise = null;
    simRetryAt = Date.now() + RETRY_MS;
    return new Map();
  });
  return simRosterPromise;
}

/**
 * Map addresses to their public Discord display identity.
 *
 * @param {string[]} addresses Any mix of cased/uncased addresses; deduped here.
 * @returns {Promise<Map<string, {name: string, avatar: string|null}>>} keyed by
 *          lowercased address. Unlinked addresses are absent from the map.
 */
export async function fetchProfiles(addresses, { fresh = false } = {}) {
  const unique = [...new Set(
    (addresses || [])
      .map(normalizeAddress)
      .filter(Boolean),
  )];
  const out = new Map();
  if (unique.length === 0) return out;

  if (fresh) {
    // A successful Discord link explicitly requests new identity data. Let
    // older lookups settle before discarding them so their eventual response
    // cannot repopulate the cache after the new identity has arrived.
    await Promise.all(unique.map((address) => pendingProfiles.get(address)));
    for (const address of unique) linkedCache.delete(address);
    linkedRetryAt = 0;
  }

  const [linked, simulated] = await Promise.all([
    Promise.all(unique.map(loadLinkedProfile)),
    loadSimRoster(),
  ]);
  for (const [index, address] of unique.entries()) {
    const profile = linked[index] || simulated.get(address);
    if (profile) out.set(address, profile);
  }
  return out;
}

/** Test seam; call only after outstanding profile reads have settled. */
export function __resetSimRosterForTest() {
  linkedCache.clear();
  pendingProfiles.clear();
  queuedProfiles.clear();
  drainingProfiles = false;
  linkedRetryAt = 0;
  simRosterPromise = null;
  simRetryAt = 0;
}
