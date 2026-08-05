// Base Sepolia presentation helpers shared by the app chrome and purchase
// surfaces. The warning strip belongs in the live beta, but not inside the
// scripted tutorial's production-UI iframe.

import { CHAIN } from '../app/chain-config.js';

export const BASE_SEPOLIA_FAUCET_URL = 'https://www.alchemy.com/faucets/base-sepolia';

export function isBaseSepolia(chain = CHAIN) {
  return Number(chain?.id) === 84_532;
}

export function isTutorialApp(search = '') {
  try { return new URLSearchParams(String(search || '')).get('tutorial') === '1'; }
  catch (_e) { return false; }
}

export function syncTestnetBetaBanner({
  documentRef,
  locationRef,
  chain = CHAIN,
} = {}) {
  const doc = documentRef || (typeof document !== 'undefined' ? document : null);
  const loc = locationRef || (typeof window !== 'undefined' ? window.location : null);
  const banner = doc?.getElementById?.('testnet-beta-banner');
  if (!banner) return false;
  const show = isBaseSepolia(chain) && !isTutorialApp(loc?.search || '');
  banner.hidden = !show;
  return show;
}

if (typeof document !== 'undefined') syncTestnetBetaBanner();
