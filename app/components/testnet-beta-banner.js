// Compact environment warning for the player app. The markup lives in
// app/index.html so it reserves its normal place above the jackpot headline;
// this module only decides whether the active build is Base Sepolia.

import { CHAIN } from '../app/chain-config.js';

export const BASE_SEPOLIA_FAUCET_URL = 'https://www.alchemy.com/faucets/base-sepolia';

export function isBaseSepolia(chain = CHAIN) {
  return Number(chain?.id) === 84_532;
}

export function renderTestnetBetaBanner(root = globalThis.document, chain = CHAIN) {
  const banner = root?.getElementById?.('testnet-beta-banner')
    || root?.querySelector?.('#testnet-beta-banner');
  if (!banner) return false;

  const visible = isBaseSepolia(chain);
  banner.hidden = !visible;
  if (visible) banner.removeAttribute?.('hidden');
  else banner.setAttribute?.('hidden', '');
  return visible;
}

if (typeof document !== 'undefined') renderTestnetBetaBanner(document, CHAIN);
