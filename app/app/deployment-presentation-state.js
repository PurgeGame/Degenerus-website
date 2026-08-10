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
  // Keep v2 so a long-idle browser still sheds the pre-rename keys, and carry v3:
  // coinflip.js renamed this prefix (the auto-rebuy carry fix) without updating
  // this list, which silently orphaned the sweep for resolved stakes — every run
  // since then inherited the previous run's per-day stake numbers.
  `coinflip_resolved_stake_v2:${CHAIN.id}:`,
  `coinflip_resolved_stake_v3:${CHAIN.id}:`,
  // last-day-jackpot's per-day summary cache — day-scoped like the reveal gates
  // above, so an old run's day N summary otherwise renders on the new run's day N.
  `day_summary_${CHAIN.id}_`,
  `pari-results-seen:${CHAIN.id}:`,
  `jackpot-resolution-seen:${CHAIN.id}:`,
]);

// Keys already scoped by a per-run CONTRACT address self-namespace and are
// deliberately NOT listed — `degenerus:bingo:{chain}:{GAME}` (bingo-watch) and
// `coinflip_biggest_record_v1:{chain}:{COINFLIP}`. A redeploy changes the address,
// so the old run's entries become unreachable rather than stale.
//
// When adding a presentation key: scope it by a contract address, OR add its
// prefix here. A key scoped only by chainId + day WILL collide across runs,
// because a testnet redeploy restarts day numbering on the same chain.

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
