// /app/app/work-queue.js — executable work for the MINE FLIP nav widget.
//
// This queue deliberately contains only the permissionless Mine Flip crank.
// Claim balances, owed tickets, and presentation-only reveal rows belong to
// their gameplay surfaces and must never make this button imply it can batch
// work that it cannot execute.
//
// A future database-backed batch resolver can publish an explicitly tagged
// executable row through pending-actions.js; app-mine-flip.js accepts only
// those tagged rows. The database currently exposes no such batch-work feed,
// so there is no guessed client-side substitute.

import { probeMineFlip, mineFlip } from './mine-flip.js';

/**
 * Build the executable chain queue from the contract probe.
 *
 * Extra properties are intentionally ignored so old `/pending` payloads cannot
 * leak claims or presentation work back into the widget.
 */
export function buildWorkQueue({ probe } = {}) {
  if (!probe?.hasWork) return [];
  return [{
    id: 'mineFlip',
    label: 'Mine FLIP',
    autoRun: true,
    run: ({ player }) => mineFlip({ player }),
  }];
}

/** The one-click target, when the crank probe says work exists. */
export function nextAction(queue) {
  return (queue || []).find((item) => item.id === 'mineFlip' && item.autoRun) ?? null;
}

/** Probe only the action this widget can actually execute. */
export async function loadWorkQueue({ player } = {}) {
  if (!player) return { queue: [], probe: null };
  const probe = await probeMineFlip({ player }).catch(() => null);
  return { queue: buildWorkQueue({ probe }), probe };
}
