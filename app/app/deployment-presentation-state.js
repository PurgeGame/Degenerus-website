// Presentation/reveal keys historically used only chainId + logical day.
// Testnet redeploys restart day numbering on the same chain, so an old run's
// "already revealed" flags can otherwise suppress a brand-new jackpot/flip.

import { CHAIN } from './chain-config.js';

const PRESENTATION_PREFIXES = Object.freeze([
  `flip_day_${CHAIN.id}_`,
  `spun_day_${CHAIN.id}_`,
  `jackpot_complete_day_${CHAIN.id}_`,
  `jackpot_bonus_pending_day_${CHAIN.id}_`,
  `flip_settlement_${CHAIN.id}_`,
  `flip_reward_reveal_gate_${CHAIN.id}_`,
  `coinflip_resolved_stake_v2:${CHAIN.id}:`,
  `pari-results-seen:${CHAIN.id}:`,
]);

export function resetPresentationStateForDeployment(storage = globalThis.localStorage) {
  if (!storage) return false;
  const markerKey = `presentation_deploy_${CHAIN.id}`;
  const deployment = String(CHAIN.deployBlock || 0);
  try {
    if (storage.getItem(markerKey) === deployment) return false;
    const doomed = [];
    for (let index = 0; index < Number(storage.length || 0); index += 1) {
      const key = storage.key(index);
      if (key && PRESENTATION_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        doomed.push(key);
      }
    }
    for (const key of doomed) storage.removeItem(key);
    storage.setItem(markerKey, deployment);
    return true;
  } catch (_e) {
    // Private browsing can deny enumeration. Network state still refreshes;
    // only the one-time stale-presentation cleanup degrades.
    return false;
  }
}

