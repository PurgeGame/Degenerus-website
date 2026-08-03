// /app/app/work-queue.js — executable work for the Mine FLIP tray resolver.
//
// This queue deliberately contains only the permissionless Mine Flip crank.
// Claim balances, owed tickets, and presentation-only reveal rows belong to
// their gameplay surfaces and publish independently into pending-actions.js.
// app-mine-flip.js contributes only this crank to the same bottom tray, so it
// cannot imply that unrelated claims are batched into the transaction.

import { probeMineFlip, mineFlip } from './mine-flip.js';

/**
 * Build the executable chain queue from the contract probe.
 *
 * Extra properties are intentionally ignored so legacy aggregate payloads
 * cannot leak claims or presentation work into this resolver.
 */
export function buildWorkQueue({ probe } = {}) {
  // A successful simulation is the sole authority for showing the crank.  Do
  // not treat a truthy compatibility field from an unknown/failed probe as
  // executable work: that creates a button whose own preflight immediately
  // retires it without doing anything.
  if (probe?.known !== true || probe?.hasWork !== true) return [];
  return [{
    id: 'mineFlip',
    label: 'Mine FLIP',
    autoRun: true,
    run: ({ player }) => mineFlip({ player }),
  }];
}

/** The bottom-tray target, when the crank probe says work exists. */
export function nextAction(queue) {
  return (queue || []).find((item) => item.id === 'mineFlip' && item.autoRun) ?? null;
}

/** Probe only the action the resolver can actually execute. */
export async function loadWorkQueue({ player } = {}) {
  if (!player) return { queue: [], probe: null };
  const probe = await probeMineFlip({ player }).catch(() => null);
  return { queue: buildWorkQueue({ probe }), probe };
}
