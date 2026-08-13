// /app/app/profiles.js — public Discord display identity for on-chain addresses.
//
// Leaderboards and record rails all show the same thing: a wallet that may or
// may not be linked to a Discord account. This module is the one place that
// turns a batch of addresses into names and avatars. It is deliberately free of
// chain imports so any component can use it without pulling in ethers.
//
// Identity is decoration. An outage here must never blank the numbers, so this
// never throws and simply omits anyone it cannot resolve — callers keep their
// shortened-address fallback.

const SESSION_API = 'https://api.degener.us';

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
      .map((address) => String(address || '').toLowerCase())
      .filter((address) => /^0x[0-9a-f]{40}$/.test(address)),
  )];
  const out = new Map();
  if (unique.length === 0) return out;

  try {
    const url = `${SESSION_API}/api/profiles?addresses=${encodeURIComponent(unique.join(','))}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return out;
    const body = await res.json();
    for (const profile of (Array.isArray(body?.profiles) ? body.profiles : [])) {
      const address = String(profile?.address || '').toLowerCase();
      const name = String(profile?.discord_name || '').trim();
      if (!address || !name) continue;
      const avatar = String(profile?.discord_avatar || '').trim();
      out.set(address, {
        name,
        // Only ever an https CDN URL. Anything else is dropped rather than
        // written into an img src.
        avatar: /^https:\/\//.test(avatar) ? avatar : null,
      });
    }
  } catch (_e) { /* identity is decoration; the numbers still render */ }
  return out;
}
