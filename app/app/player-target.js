import { getAddress, isAddress } from 'ethers';

export const PLAYER_SESSION_API = 'https://api.degener.us';
const PLAYER_DIRECTORY_LIMIT = 50;
const PLAYER_SUGGESTION_LIMIT = 8;

export function isDiscordSnowflake(value) {
  return /^\d{5,24}$/.test(String(value || '').trim());
}

/**
 * Reduce the public linked-player directory to safe, useful type-ahead rows.
 * Discord snowflakes are intentionally not returned: the action needs the
 * linked wallet, while the player only needs the public name/avatar to choose
 * the right person.
 */
export function filterPlayerSuggestions(rows, value, limit = PLAYER_SUGGESTION_LIMIT) {
  const query = String(value || '').trim().replace(/^@/, '').toLocaleLowerCase();
  if (query.length < 2) return [];
  const cap = Math.max(1, Math.min(PLAYER_SUGGESTION_LIMIT, Number(limit) || 0));
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const rawAddress = String(row?.address || row?.eth_address || '').trim();
      const name = String(row?.name || row?.discord_name || '').trim();
      if (!isAddress(rawAddress) || !name) return null;
      const address = getAddress(rawAddress.toLowerCase());
      const avatarRaw = String(row?.avatar || row?.discord_avatar || '').trim();
      return {
        address,
        name,
        avatar: /^https:\/\//i.test(avatarRaw) ? avatarRaw : null,
        startsWith: name.toLocaleLowerCase().startsWith(query),
      };
    })
    .filter((row) => {
      if (!row || !row.name.toLocaleLowerCase().includes(query)) return false;
      const key = row.address.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(b.startsWith) - Number(a.startsWith)
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .slice(0, cap)
    .map(({ startsWith: _startsWith, ...row }) => row);
}

export async function fetchPlayerSuggestions(
  value,
  {
    fetcher = globalThis.fetch,
    baseUrl = PLAYER_SESSION_API,
    signal,
    limit = PLAYER_SUGGESTION_LIMIT,
  } = {},
) {
  const query = String(value || '').trim().replace(/^@/, '');
  if (query.length < 2 || !/[a-z]/i.test(query)) return [];
  if (typeof fetcher !== 'function') throw new Error('Player suggestions are unavailable.');
  const response = await fetcher(
    `${baseUrl}/api/leaderboard?limit=${PLAYER_DIRECTORY_LIMIT}`,
    { credentials: 'omit', ...(signal ? { signal } : {}) },
  );
  if (!response?.ok) throw new Error('Player suggestions are unavailable.');
  const payload = await response.json();
  return filterPlayerSuggestions(payload?.leaderboard, query, limit);
}

export async function resolvePlayerTarget(
  value,
  { fetcher = globalThis.fetch, baseUrl = PLAYER_SESSION_API } = {},
) {
  const raw = String(value || '').trim();
  if (isAddress(raw)) return getAddress(raw.toLowerCase());
  if (!isDiscordSnowflake(raw)) {
    throw new Error('Enter a wallet address, Discord user ID, or choose a suggested player.');
  }
  if (typeof fetcher !== 'function') throw new Error('Discord lookup is unavailable.');
  const response = await fetcher(`${baseUrl}/api/player/by-discord/${encodeURIComponent(raw)}`, {
    credentials: 'include',
  });
  let payload = null;
  try { payload = await response.json(); } catch (_error) { /* handled below */ }
  if (!response.ok) {
    throw new Error(payload?.error || 'No wallet is linked to that Discord ID.');
  }
  const address = String(payload?.address || payload?.player?.eth_address || '').trim();
  if (!isAddress(address)) throw new Error('That Discord ID has no linked wallet.');
  return getAddress(address.toLowerCase());
}
