// /app/components/app-reveal-tray.js — bottom-pinned actionable reveal tray.
//
// Lootboxes, Degenerette bets, ticket packs, and parimutuel payouts publish
// their honest waiting/ready/busy state through pending-actions.js. This
// component is the presentation and click router for READY work:
//
//   - lootbox run() re-checks whether openBox is still needed, then either sends
//     it or replays the already-indexed contents;
//   - Degenerette run() resolves a live bet (including community batch work) or
//     replays an externally-resolved result, then stages the reel player;
//   - ticket-pack run() opens the fully indexed pack reveal with no write.
//   - growth/volume-claim run() claims the settled payout, then stages its result.
//
// Explicitly pinned waiting rows (Degenerette and owed ticket packs) stay put
// as muted progress feedback, then become the same lit actionable result card.
// The full-screen reveal overlay sits above this tray.

import { subscribePendingActions } from '../app/pending-actions.js';
import { briefTxError } from '../app/ui-error.js';
import { dgnBadgePath, dgnTraitIdsToQuadrants, dgnUnpackTicket } from '../app/dgn-traits.js';
import {
  isAutomaticPopupBlocked,
  subscribeAutomaticPopupGate,
} from '../app/major-draw-activity.js';

const REVEAL_KINDS = new Set([
  'lootbox',
  'degenerette',
  'tickets',
  'growth-claim',
  'volume-claim',
  'decimator',
  'baf',
  'bingo',
  'foil-match',
  'mass-resolution',
  'batch-resolution',
]);
const ERROR_AUTO_CLEAR_MS = 10_000;
const CLEAR_ALL_BUSY_ID = 'reveal-tray:clear-all';
const AUTO_OPEN_STORAGE_KEY = 'degenerus:reveal-tray:auto-open:v1';

function _readAutoOpenPreference() {
  if (typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem(AUTO_OPEN_STORAGE_KEY) === '1'; }
  catch (_e) { return false; }
}

function _writeAutoOpenPreference(enabled) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(AUTO_OPEN_STORAGE_KEY, enabled ? '1' : '0'); }
  catch (_e) { /* private mode: keep the in-memory choice */ }
}

export function canAutoOpenReveal(item) {
  return item?.state === 'ready'
    && item?.autoOpen === true
    && typeof item?.run === 'function';
}

function _dismissFingerprint(item) {
  return [item?.state, item?.phase, item?.detail].map((part) => String(part ?? '')).join('|');
}

// HIDE is intentionally softer than CLEAR. Keep a fingerprint of the actual
// manifest that was hidden so routine polling with equivalent objects does not
// reopen the surface. A new row or meaningful transition clears it.
function _manifestFingerprint(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => [
      item?.id,
      item?.kind,
      item?.state,
      item?.phase,
      item?.detail,
      item?.progress,
      item?.pinned ? 1 : 0,
      typeof item?.run === 'function' ? 1 : 0,
    ].map((part) => String(part ?? '')).join('|'))
    .sort()
    .join('\n');
}

function _isRngWaiting(item) {
  return item?.kind === 'degenerette'
    && item?.state === 'waiting'
    && ['awaitingRng', 'requesting-rng', 'waiting-rng'].includes(String(item?.phase || ''));
}

function _ticketPackMeta(item) {
  const levelMatch = /\blevel\s+(\d+)/i.exec(String(item?.label || ''));
  const countMatch = /\b(\d+)\s+tickets?\b/i.exec(String(item?.detail || ''));
  const rawLevel = item?.ticketLevel ?? levelMatch?.[1];
  const rawCount = item?.ticketCount ?? countMatch?.[1];
  const level = Number(rawLevel);
  const count = Math.floor(Number(rawCount));
  return {
    level: Number.isFinite(level) && level >= 0 ? level : null,
    count: Number.isFinite(count) && count > 0 ? count : null,
  };
}

export function actionableRevealItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => (
    REVEAL_KINDS.has(String(item?.kind || ''))
    && (
      item?.state === 'ready'
      || item?.state === 'busy'
      || (item?.state === 'waiting' && item?.pinned === true)
    )
  ));
}

function _kindLabel(kind) {
  if (kind === 'lootbox') return 'LOOTBOX';
  if (kind === 'degenerette') return 'DEGENERETTE';
  if (kind === 'growth-claim') return 'GROWTH BET';
  if (kind === 'volume-claim') return 'VOLUME BET';
  if (kind === 'decimator') return 'DECIMATOR';
  if (kind === 'baf') return 'BAF CONSOLATION';
  if (kind === 'bingo') return 'BINGO';
  if (kind === 'foil-match') return 'FOIL TICKET MATCH';
  if (kind === 'mass-resolution' || kind === 'batch-resolution') return 'PROTOCOL RESOLUTION';
  return 'TICKET PACK';
}

class AppRevealTray extends HTMLElement {
  #initialized = false;
  #unsubscribe = null;
  #items = [];
  #dismissed = new Map();
  #hiddenFingerprint = null;
  #busyId = null;
  #errorTimer = null;
  #autoOpen = false;
  #autoAttempted = new Set();
  #autoScheduledId = null;
  #popupGateUnsubscribe = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#autoOpen = _readAutoOpenPreference();
    this.#renderShell();
    const clear = this.querySelector('[data-bind="rrt-clear"]');
    if (clear) clear.addEventListener('click', () => this.#clearAll());
    const hide = this.querySelector('[data-bind="rrt-hide"]');
    if (hide) hide.addEventListener('click', () => this.#hideCurrent());
    const autoOpen = this.querySelector('[data-bind="rrt-auto-open"]');
    if (autoOpen) {
      autoOpen.checked = this.#autoOpen;
      autoOpen.addEventListener('change', () => {
        this.#autoOpen = Boolean(autoOpen.checked);
        _writeAutoOpenPreference(this.#autoOpen);
        this.#maybeAutoOpen();
      });
    }
    this.#unsubscribe = subscribePendingActions((items) => {
      const nextItems = actionableRevealItems(items).filter((item) => {
        const prior = this.#dismissed.get(item.id);
        const next = _dismissFingerprint(item);
        if (prior == null) return true;
        if (prior === next) return false;
        // A waiting item becoming actionable (or otherwise changing phase)
        // is new information and must return after a prior CLEAR.
        this.#dismissed.delete(item.id);
        return true;
      });
      const nextFingerprint = _manifestFingerprint(nextItems);
      if (this.#hiddenFingerprint != null && nextFingerprint !== this.#hiddenFingerprint) {
        this.#hiddenFingerprint = null;
      }
      this.#items = nextItems;
      this.#render();
      this.#maybeAutoOpen();
    });
    // A ready result may arrive while the jackpot or coin is moving. Keep it
    // actionable in the tray, then reconsider the automatic open when the
    // shared post-animation reading window expires.
    this.#popupGateUnsubscribe = subscribeAutomaticPopupGate(() => this.#maybeAutoOpen());
  }

  disconnectedCallback() {
    try { this.#unsubscribe?.(); } catch (_e) { /* defensive */ }
    this.#unsubscribe = null;
    try { this.#popupGateUnsubscribe?.(); } catch (_e) { /* defensive */ }
    this.#popupGateUnsubscribe = null;
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_e) { /* defensive */ }
      this.#errorTimer = null;
    }
    this.#hiddenFingerprint = null;
    this.#autoScheduledId = null;
    this.#autoAttempted.clear();
    this.#initialized = false;
  }

  #renderShell() {
    this.innerHTML = `
      <aside class="rrt-tray" data-bind="rrt-tray" hidden aria-live="polite"
             aria-label="Actions ready">
        <div class="rrt-head">
          <img class="rrt-head__logo" src="/whitepaper/flame-logo.svg" alt="">
          <span class="rrt-head__copy">
            <strong data-bind="rrt-title">READY</strong>
            <span data-bind="rrt-count"></span>
          </span>
          <label class="rrt-auto-open">
            <input type="checkbox" data-bind="rrt-auto-open">
            <span>OPEN WHEN READY</span>
          </label>
          <span class="rrt-head__actions">
            <button type="button" class="rrt-hide" data-bind="rrt-hide" hidden
                    aria-label="Hide pending actions until their status changes">HIDE</button>
            <button type="button" class="rrt-clear" data-bind="rrt-clear" hidden
                    aria-label="Clear all pending reveal reminders">CLEAR</button>
          </span>
        </div>
        <div class="rrt-actions" data-bind="rrt-actions"></div>
        <div class="rrt-error" data-bind="rrt-error" hidden role="alert"></div>
      </aside>
    `;
  }

  async #run(item) {
    if (this.#busyId != null || item?.state !== 'ready' || typeof item.run !== 'function') return;
    this.#busyId = item.id;
    this.#clearError();
    this.#render();
    try {
      await item.run();
    } catch (error) {
      // The tray is persistent, tiny chrome. Never dump provider/revert detail
      // into it; domain panels may retain richer recovery copy near the form.
      console.warn?.('[reveal-tray] action failed', error);
      this.#showError(briefTxError(error, 'Action did not go through. Try again.'));
    } finally {
      this.#busyId = null;
      this.#render();
      this.#maybeAutoOpen();
    }
  }

  #maybeAutoOpen() {
    if (!this.#autoOpen || this.#busyId != null || this.#autoScheduledId != null
      || isAutomaticPopupBlocked()) return;
    const item = this.#items.find((candidate) => (
      canAutoOpenReveal(candidate) && !this.#autoAttempted.has(candidate.id)
    ));
    if (!item) return;
    this.#autoScheduledId = item.id;
    const schedule = typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (callback) => Promise.resolve().then(callback);
    schedule(() => {
      const id = this.#autoScheduledId;
      this.#autoScheduledId = null;
      if (!this.#initialized || !this.#autoOpen || this.#busyId != null || id == null
        || isAutomaticPopupBlocked()) return;
      const current = this.#items.find((candidate) => candidate.id === id);
      if (!canAutoOpenReveal(current) || this.#autoAttempted.has(id)) return;
      this.#autoAttempted.add(id);
      void this.#run(current);
    });
  }

  #hideCurrent() {
    if (this.#items.length === 0) return;
    this.#hiddenFingerprint = _manifestFingerprint(this.#items);
    this.#clearError();
    this.#render();
  }

  async #clearAll() {
    if (this.#busyId != null) return;
    const visible = [...this.#items];
    if (visible.length === 0 || visible.some((item) => item?.state === 'busy')) return;
    // Hide every current reminder. Rows without an owner-level clear callback
    // are dismissed only for their current state: if a grey wait becomes a lit
    // action it automatically comes back.
    for (const item of visible) this.#dismissed.set(item.id, _dismissFingerprint(item));

    // One controller may publish the same callback on several rows. Collapse
    // by source so it is invoked exactly once.
    const owners = new Map();
    for (const item of visible) {
      if (typeof item.clearAll !== 'function') continue;
      owners.set(String(item.source || item.id), item.clearAll);
    }

    this.#busyId = CLEAR_ALL_BUSY_ID;
    this.#clearError();
    this.#items = [];
    this.#render();
    try {
      for (const clearAll of owners.values()) await clearAll();
    } catch (error) {
      console.warn?.('[reveal-tray] clear failed', error);
      this.#showError(briefTxError(error, 'Could not clear reminders. Try again.'));
    } finally {
      this.#busyId = null;
      this.#render();
    }
  }

  #render() {
    const tray = this.querySelector('[data-bind="rrt-tray"]');
    const title = this.querySelector('[data-bind="rrt-title"]');
    const count = this.querySelector('[data-bind="rrt-count"]');
    const host = this.querySelector('[data-bind="rrt-actions"]');
    const clear = this.querySelector('[data-bind="rrt-clear"]');
    const hide = this.querySelector('[data-bind="rrt-hide"]');
    if (!tray || !count || !host) return;
    const items = this.#items;
    const hiddenByUser = this.#hiddenFingerprint != null
      && this.#hiddenFingerprint === _manifestFingerprint(items);
    tray.hidden = items.length === 0 || hiddenByUser;
    const onlyWaiting = items.length > 0 && items.every((item) => item.state === 'waiting');
    const onlyRngWaiting = onlyWaiting && items.every(_isRngWaiting);
    if (title) title.textContent = onlyRngWaiting
      ? 'RNG PENDING'
      : onlyWaiting ? 'PENDING' : 'READY';
    count.textContent = `${items.length} ${items.length === 1 ? 'action' : 'actions'}`;
    host.textContent = '';

    const clearingAll = this.#busyId === CLEAR_ALL_BUSY_ID;
    if (hide) {
      hide.hidden = items.length === 0;
      hide.disabled = false;
      hide.textContent = 'HIDE';
    }
    if (clear) {
      clear.hidden = items.length === 0;
      clear.disabled = clearingAll || this.#busyId != null
        || items.some((item) => item.state === 'busy');
      clear.textContent = clearingAll ? 'CLEARING…' : 'CLEAR';
    }

    for (const item of items) {
      const localBusy = this.#busyId === item.id;
      const busy = item.state === 'busy' || localBusy;
      const waiting = item.state === 'waiting';
      const rngWaiting = _isRngWaiting(item);
      const resultReady = item.kind === 'degenerette' && item.phase === 'result-ready';
      const compact = item.compact === true;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = [
        'rrt-action',
        `rrt-action--${item.kind}`,
        busy ? 'is-busy' : '',
        waiting ? 'is-waiting' : '',
        rngWaiting ? 'is-rng-waiting' : '',
        resultReady ? 'is-result-ready' : '',
        compact ? 'rrt-action--compact' : '',
      ].filter(Boolean).join(' ');
      const domainLocked = busy || waiting || clearingAll || typeof item.run !== 'function';
      button.disabled = domainLocked;
      if (item.write === true) {
        button.setAttribute('data-write', '');
        if (domainLocked) {
          button.setAttribute('data-write-locked', '');
          button.setAttribute(
            'data-write-lock-title',
            busy ? 'Action in progress' : 'Action unavailable',
          );
        }
      }
      button.setAttribute('data-action-id', item.id);
      button.setAttribute('aria-label', compact
        ? String(item.label || item.shortLabel || 'Open')
        : `${item.shortLabel || 'Open'}: ${item.label}`);

      const art = document.createElement('span');
      art.className = `rrt-action__art rrt-action__art--${item.kind}`;
      art.setAttribute('aria-hidden', 'true');
      if (item.kind === 'degenerette' && item.ticketPacked != null) {
        const mini = document.createElement('span');
        mini.className = 'ticket-card tc-small dgn-ticket rrt-degenerette-ticket';
        const traits = dgnUnpackTicket(item.ticketPacked);
        const hero = Number(item.heroQuadrant ?? 0) & 3;
        traits.forEach((trait, quadrant) => {
          const cell = document.createElement('span');
          cell.className = `trait-quadrant dgn-q rrt-degenerette-ticket__q${quadrant === hero ? ' q-hero' : ''}`;
          cell.setAttribute('data-quadrant', String(quadrant));
          const badge = document.createElement('img');
          badge.className = 'rrt-degenerette-ticket__badge';
          badge.src = dgnBadgePath(quadrant, trait.sym, trait.col);
          badge.alt = '';
          cell.appendChild(badge);
          mini.appendChild(cell);
        });
        const center = document.createElement('span');
        center.className = 'ticket-card-center rrt-degenerette-ticket__center';
        const centerMark = document.createElement('img');
        centerMark.className = 'rrt-degenerette-ticket__center-mark';
        centerMark.src = '/whitepaper/flame-center.svg';
        centerMark.alt = '';
        center.appendChild(centerMark);
        mini.appendChild(center);
        art.appendChild(mini);
      } else if (item.kind === 'bingo' && item.badgePath) {
        const badge = document.createElement('img');
        badge.src = item.badgePath;
        badge.alt = '';
        art.appendChild(badge);
      } else if (item.kind === 'foil-match' && Array.isArray(item.lineTraits)) {
        const mini = document.createElement('span');
        mini.className = 'ticket-card tc-small dgn-ticket rrt-foil-match-ticket';
        const traits = dgnTraitIdsToQuadrants(item.lineTraits);
        traits.forEach((trait, quadrant) => {
          const cell = document.createElement('span');
          cell.className = 'trait-quadrant dgn-q rrt-foil-match-ticket__q';
          cell.setAttribute('data-quadrant', String(quadrant));
          const badge = document.createElement('img');
          badge.src = dgnBadgePath(quadrant, trait.sym, trait.col);
          badge.alt = '';
          cell.appendChild(badge);
          mini.appendChild(cell);
        });
        const center = document.createElement('span');
        center.className = 'ticket-card-center rrt-foil-match-ticket__center';
        const mark = document.createElement('img');
        mark.src = '/whitepaper/flame-center.svg';
        mark.alt = '';
        center.appendChild(mark);
        mini.appendChild(center);
        art.appendChild(mini);
      } else if (item.kind === 'tickets') {
        // Use the same branded tear-pack silhouette as the opening overlay.
        // This miniature has its own fixed aspect ratio so the button grid can
        // never collapse the wrapper into a horizontal sliver.
        const pack = document.createElement('span');
        pack.className = 'rvl-pack rrt-pack-art';
        const shine = document.createElement('span');
        shine.className = 'rvl-pack-shine';
        const brand = document.createElement('span');
        brand.className = 'rvl-pack-brand';
        const logo = document.createElement('img');
        logo.className = 'rvl-pack-logo';
        logo.src = '/whitepaper/flame-logo.svg';
        logo.alt = '';
        const edition = document.createElement('span');
        edition.className = 'rvl-pack-edition';
        edition.textContent = item.foilPack ? 'FOIL PACK' : 'TICKET PACK';
        brand.appendChild(logo);
        brand.appendChild(edition);
        pack.appendChild(shine);
        pack.appendChild(brand);
        const meta = _ticketPackMeta(item);
        const level = document.createElement('span');
        level.className = 'rvl-pack-level rrt-pack-level';
        level.textContent = meta.level == null ? 'LEVEL —' : `LEVEL ${meta.level}`;
        const quantity = document.createElement('span');
        quantity.className = 'rvl-pack-count rrt-pack-count';
        quantity.textContent = meta.count == null
          ? 'TICKETS'
          : `${meta.count} ${meta.count === 1 ? 'TICKET' : 'TICKETS'}`;
        pack.appendChild(level);
        pack.appendChild(quantity);
        art.appendChild(pack);
      } else if (item.kind === 'mass-resolution' || item.kind === 'batch-resolution') {
        const logo = document.createElement('img');
        logo.src = item.icon || '/whitepaper/flame-logo.svg';
        logo.alt = '';
        art.appendChild(logo);
      } else {
        art.textContent = item.kind === 'lootbox' ? '?'
          : item.kind === 'growth-claim' ? '↑'
            : item.kind === 'volume-claim' ? 'V'
              : item.kind === 'baf' ? 'B'
                : item.kind === 'decimator' ? 'X' : 'D';
      }

      const copy = document.createElement('span');
      copy.className = 'rrt-action__copy';
      const label = document.createElement('strong');
      label.className = 'rrt-action__label';
      label.textContent = item.label;
      if (compact) {
        copy.appendChild(label);
      } else {
        const kind = document.createElement('span');
        kind.className = 'rrt-action__kind';
        kind.textContent = item.kindLabel || _kindLabel(item.kind);
        const detail = document.createElement('span');
        detail.className = 'rrt-action__detail';
        detail.textContent = item.detail;
        copy.appendChild(kind);
        copy.appendChild(label);
        copy.appendChild(detail);
      }
      if (!compact && item.progress === 'indeterminate') {
        const progress = document.createElement('span');
        progress.className = 'rrt-action__progress';
        progress.setAttribute('role', 'progressbar');
        progress.setAttribute('aria-label', 'Waiting for shared random number');
        progress.setAttribute('aria-valuetext', 'RNG request in progress');
        const progressFill = document.createElement('span');
        progressFill.className = 'rrt-action__progress-fill';
        progress.appendChild(progressFill);
        copy.appendChild(progress);
      }

      const cta = document.createElement('span');
      cta.className = 'rrt-action__cta';
      cta.textContent = rngWaiting
        ? item.phase === 'requesting-rng' ? 'REQUESTING…' : 'WAITING'
        : item.state === 'waiting'
          ? item.phase === 'indexing' ? 'LOADING…' : 'WAITING'
        : busy
          ? item.kind === 'growth-claim' || item.kind === 'volume-claim'
            ? 'CLAIMING…'
            : item.kind === 'foil-match'
              ? 'CLAIMING…'
            : item.kind === 'baf'
              ? 'CLAIMING…'
              : item.kind === 'decimator'
                ? 'RESOLVING…'
            : item.kind === 'mass-resolution' || item.kind === 'batch-resolution'
              ? 'RESOLVING…'
              : 'OPENING…'
          : String(item.shortLabel || 'Open').toUpperCase();

      button.appendChild(art);
      button.appendChild(copy);
      if (!compact) button.appendChild(cta);
      if (!button.disabled) button.addEventListener('click', () => this.#run(item));
      host.appendChild(button);
    }
  }

  #showError(message) {
    const error = this.querySelector('[data-bind="rrt-error"]');
    if (!error) return;
    error.textContent = String(message || 'Could not complete this action.');
    error.hidden = false;
    if (this.#errorTimer != null) clearTimeout(this.#errorTimer);
    this.#errorTimer = setTimeout(() => this.#clearError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimer && typeof this.#errorTimer.unref === 'function') {
      try { this.#errorTimer.unref(); } catch (_e) { /* browser timer */ }
    }
  }

  #clearError() {
    const error = this.querySelector('[data-bind="rrt-error"]');
    if (error) {
      error.textContent = '';
      error.hidden = true;
    }
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_e) { /* defensive */ }
      this.#errorTimer = null;
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-reveal-tray')) {
  customElements.define('app-reveal-tray', AppRevealTray);
}

export { AppRevealTray };
