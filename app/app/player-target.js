import { getAddress, isAddress } from 'ethers';

export const PLAYER_SESSION_API = 'https://api.degener.us';

export function isDiscordSnowflake(value) {
  return /^\d{5,24}$/.test(String(value || '').trim());
}

export async function resolvePlayerTarget(
  value,
  { fetcher = globalThis.fetch, baseUrl = PLAYER_SESSION_API } = {},
) {
  const raw = String(value || '').trim();
  if (isAddress(raw)) return getAddress(raw.toLowerCase());
  if (!isDiscordSnowflake(raw)) {
    throw new Error('Enter a wallet address or Discord user ID.');
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
