// /app/components/app-mine-flip.js — headless Mine FLIP pending-action resolver.
//
// There is deliberately NO top-bar button. This controller probes the
// permissionless `mineFlip` crank and publishes one executable row through
// pending-actions.js; app-reveal-tray.js is the only player-facing surface.
// Keeping the probe here preserves the important lifecycle behavior from the
// old nav widget: refresh after a confirmed transaction, on acting-wallet
// changes, when the tab regains focus, and every 30 seconds.
//
// Permissionless work is raced. The published tray callback re-probes at intent
// time before opening the wallet, so another keeper winning the race retires a
// stale row quietly. A NoWork revert is likewise an ordinary stale-state
// result; every other error is rethrown for the bottom tray to display.

import { subscribe, get, getActingAddress } from '../app/store.js';
import { VOLUME_WINDOW } from '../app/chain-config.js';
import { loadWorkQueue, nextAction } from '../app/work-queue.js';
import { publishPendingActions, clearPendingActions } from '../app/pending-actions.js';
import { registerComponentPoll } from '../app/component-poll.js';
import { refreshDayRollover } from '../app/day-rollover.js';

const POLL_INTERVAL_MS = 30_000;
const RESOLVER_SOURCE = 'mine-flip-resolver';

function _mineFlipGeneration() {
  const daySync = get('app.daySync') || {};
  const chainDay = Number(daySync?.day);
  if (Number.isInteger(chainDay) && chainDay > 0) return `day-${chainDay}`;

  const gameState = get('app.gameState') || {};
  const resolvedDay = Number(gameState?.dailyRng?.day ?? gameState?.currentDay);
  if (Number.isInteger(resolvedDay) && resolvedDay > 0) return `day-${resolvedDay}`;

  const level = Number(gameState?.level);
  const jackpotDay = Number(gameState?.jackpotCounter);
  if (Number.isInteger(level) && level >= 0 && Number.isInteger(jackpotDay) && jackpotDay >= 0) {
    return `level-${level}-day-${jackpotDay}`;
  }

  // The game-state poll may still be warming up. Its configured day cadence is
  // enough to prevent a cleared generic resolver from suppressing every future
  // Mine FLIP action for this wallet.
  const period = Math.max(1, Number(VOLUME_WINDOW?.period) || 86_400);
  const anchor = Number(VOLUME_WINDOW?.anchor) || 0;
  return `clock-${Math.floor((Date.now() / 1_000 - anchor) / period)}`;
}

class AppMineFlipResolver extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #queue = [];
  #busy = false;
  #loadSeq = 0;
  #pollHandle = null;
  #onFocus = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;

    // getActingAddress derives from all three values, so observe every input.
    this.#unsubs.push(subscribe('connected.address', () => this.#refresh()));
    this.#unsubs.push(subscribe('viewing.address', () => this.#refresh()));
    this.#unsubs.push(subscribe('ui.mode', () => this.#refresh()));
    this.#unsubs.push(subscribe('app.gameState', () => this.#refresh()));
    // day-rollover.js publishes the direct isRngFulfilled() edge here. Probe
    // in that same update instead of making the player wait for this
    // resolver's 30-second fallback poll before the first Mine FLIP press.
    this.#unsubs.push(subscribe('app.daySync', () => this.#refresh()));

    this.#pollHandle = registerComponentPoll(() => this.#refresh(), POLL_INTERVAL_MS);
    this.#onFocus = () => { if (!document.hidden) this.#refresh(); };
    document.addEventListener('visibilitychange', this.#onFocus);
    this.#refresh();
  }

  disconnectedCallback() {
    this.#unsubs.forEach((unsubscribe) => {
      try { unsubscribe(); } catch (_error) { /* defensive */ }
    });
    this.#unsubs = [];
    if (typeof this.#pollHandle === 'function') this.#pollHandle();
    if (this.#onFocus) document.removeEventListener('visibilitychange', this.#onFocus);
    this.#pollHandle = null;
    this.#onFocus = null;
    clearPendingActions(RESOLVER_SOURCE);
    this.#initialized = false;
  }

  /** Test-only seam for replacing the queued transaction callback. */
  __queueForTest() { return this.#queue; }

  async #refresh() {
    const player = getActingAddress();
    const seq = ++this.#loadSeq;
    if (!player) {
      this.#queue = [];
      clearPendingActions(RESOLVER_SOURCE);
      return;
    }

    let result;
    try {
      result = await loadWorkQueue({ player });
    } catch (_error) {
      result = { queue: [] };
    }
    if (seq !== this.#loadSeq) return;

    // Preserve a test/in-flight callback across the intent-time re-probe while
    // still replacing all contract-derived queue metadata with the fresh read.
    const priorRuns = new Map(this.#queue.map((item) => [item.id, item.run]));
    this.#queue = (result.queue || []).map((item) => (
      priorRuns.has(item.id) ? { ...item, run: priorRuns.get(item.id) } : item
    ));
    this.#publish(player);
  }

  #publish(player) {
    const work = nextAction(this.#queue);
    if (!player || !work) {
      clearPendingActions(RESOLVER_SOURCE);
      return;
    }

    const address = String(player).toLowerCase();
    publishPendingActions(RESOLVER_SOURCE, [{
      id: `mine-flip:${address}:${_mineFlipGeneration()}`,
      dismissScope: address,
      kind: 'mass-resolution',
      compact: true,
      label: 'Mine FLIP',
      shortLabel: 'Mine FLIP',
      icon: '/whitepaper/flame-logo-split.svg',
      detail: '',
      state: this.#busy ? 'busy' : 'ready',
      write: true,
      // Permissionless maintenance is useful, but player-owned rewards and
      // reveals should chain first. Keep Mine FLIP at the end of the tray.
      order: 1_000,
      run: this.#busy ? null : async () => {
        if (String(getActingAddress() || '').toLowerCase() !== address) return;

        // Re-check permissionless work at click time. If another keeper already
        // resolved it, #refresh clears the tray row and no wallet opens.
        await this.#refresh();
        const current = nextAction(this.#queue);
        if (!current) return;
        await this.#runAction(current);
      },
    }]);
  }

  async #runAction(item) {
    if (this.#busy) return;
    const player = getActingAddress();
    if (!player) return;

    this.#busy = true;
    this.#publish(player);
    let shouldReconcile = false;
    try {
      await item.run({ player });
      shouldReconcile = true;
    } catch (error) {
      // NoWork means the permissionless state changed between simulation and
      // inclusion. Anything else belongs in the tray's visible error surface.
      if (!error || error.code !== 'NoWork') throw error;
      shouldReconcile = true;
    } finally {
      this.#busy = false;
      // A confirmed Mine FLIP can finish the exact jackpot stage. Re-read the
      // chain immediately; day-rollover requests the indexed result only when
      // advanceDue() proves the advance pipeline has actually drained.
      if (shouldReconcile) void refreshDayRollover();
      await this.#refresh();
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-mine-flip-resolver')) {
  customElements.define('app-mine-flip-resolver', AppMineFlipResolver);
}

// Mount one invisible lifecycle controller in the document body. It contains
// no button or popover; the fixed pending-actions tray is the sole UI.
function mountResolver() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  if (document.querySelector('app-mine-flip-resolver')) return;
  const host = document.body;
  if (!host || typeof host.appendChild !== 'function') return;
  const resolver = document.createElement('app-mine-flip-resolver');
  resolver.hidden = true;
  resolver.setAttribute('aria-hidden', 'true');
  host.appendChild(resolver);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountResolver, { once: true });
  } else {
    setTimeout(mountResolver, 0);
  }
}

export const _testing = { mountResolver };
export { AppMineFlipResolver };
