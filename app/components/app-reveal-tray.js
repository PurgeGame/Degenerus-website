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
//   - whale-pass-claim run() activates an on-chain deferred ticket stream.
//
// Explicitly pinned waiting rows (Degenerette and owed ticket packs) stay put
// as muted progress feedback, then become the same lit actionable result card.
// The full-screen reveal overlay sits above this tray.

import {
  dismissPendingActionItems,
  subscribePendingActions,
} from '../app/pending-actions.js';
import { briefTxError } from '../app/ui-error.js';
import {
  applyDgnTicketAccent,
  dgnBadgePath,
  dgnTraitIdsToQuadrants,
  dgnUnpackTicket,
} from '../app/dgn-traits.js';
import {
  isAutomaticPopupBlocked,
  subscribeAutomaticPopupGate,
} from '../app/major-draw-activity.js';
import {
  readDegeneretteSpeed,
  writeDegeneretteSpeed,
} from '../app/degenerette-preferences.js';

const REVEAL_KINDS = new Set([
  'lootbox',
  'degenerette',
  'tickets',
  'growth-claim',
  'volume-claim',
  'whale-pass-claim',
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
  const countMatch = /\b(\d+(?:\.\d+)?)\s+tickets?\b/i.exec(String(item?.detail || ''));
  const rawLevel = item?.ticketLevel ?? levelMatch?.[1];
  const rawCount = item?.ticketCount ?? countMatch?.[1];
  const level = Number(rawLevel);
  const count = Number(rawCount);
  return {
    level: Number.isFinite(level) && level >= 0 ? level : null,
    count: Number.isFinite(count) && count > 0 ? count : null,
  };
}

function _ticketQuantityText(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 'TICKETS';
  return `${count} ${count === 1 ? 'TICKET' : 'TICKETS'}`;
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
  if (kind === 'whale-pass-claim') return 'WHALE PASS CLAIM';
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
  #hiddenFingerprint = null;
  #busyId = null;
  #errorTimer = null;
  #autoOpen = false;
  #autoAttempted = new Set();
  #autoScheduledId = null;
  #popupGateUnsubscribe = null;
  #expandedPendingId = null;

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
    const speed = this.querySelector('[data-bind="rrt-speed"]');
    const speedValue = this.querySelector('[data-bind="rrt-speed-value"]');
    if (speed) {
      speed.min = '0.5';
      speed.max = '3';
      speed.step = '0.5';
      speed.value = String(readDegeneretteSpeed());
      const syncSpeed = ({ persist = false } = {}) => {
        const multiplier = Math.max(0.5, Math.min(3, Number(speed.value) || 1));
        if (speedValue) speedValue.textContent = `${multiplier}×`;
        if (persist) writeDegeneretteSpeed(multiplier);
      };
      syncSpeed();
      speed.addEventListener('input', () => syncSpeed());
      speed.addEventListener('change', () => syncSpeed({ persist: true }));
    }
    this.#unsubscribe = subscribePendingActions((items) => {
      // CLEAR tombstones are owned by pending-actions, so the same logical row
      // stays gone across publisher polls and tray remounts. HIDE remains the
      // softer, fingerprint-only behavior below.
      const nextItems = actionableRevealItems(items);
      if (this.#expandedPendingId != null
        && !nextItems.some((item) => item.id === this.#expandedPendingId)) {
        this.#expandedPendingId = null;
      }
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
    this.#expandedPendingId = null;
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
          </span>
          <label class="rrt-auto-open">
            <input type="checkbox" data-bind="rrt-auto-open">
            <span>OPEN WHEN READY</span>
          </label>
          <label class="rrt-speed" title="Reveal animation speed">
            <span>SPEED</span>
            <input type="range" data-bind="rrt-speed" aria-label="Reveal animation speed">
            <output data-bind="rrt-speed-value">1×</output>
          </label>
          <span class="rrt-head__actions">
            <button type="button" class="rrt-hide" data-bind="rrt-hide" hidden
                    aria-label="Hide pending actions until their status changes">HIDE</button>
            <button type="button" class="rrt-clear" data-bind="rrt-clear" hidden
                    aria-label="Clear all pending reveal reminders">CLEAR</button>
          </span>
        </div>
        <div class="rrt-actions" data-bind="rrt-actions"></div>
        <section id="rrt-pending-details" class="rrt-pending-details"
                 data-bind="rrt-pending-details" hidden></section>
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
    this.#busyId = CLEAR_ALL_BUSY_ID;
    this.#clearError();
    this.#items = [];
    this.#render();
    try {
      await dismissPendingActionItems(visible);
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
    const host = this.querySelector('[data-bind="rrt-actions"]');
    const clear = this.querySelector('[data-bind="rrt-clear"]');
    const hide = this.querySelector('[data-bind="rrt-hide"]');
    const pendingDetails = this.querySelector('[data-bind="rrt-pending-details"]');
    if (!tray || !host) return;
    const items = this.#items;
    const hiddenByUser = this.#hiddenFingerprint != null
      && this.#hiddenFingerprint === _manifestFingerprint(items);
    tray.hidden = items.length === 0 || hiddenByUser;
    const onlyWaiting = items.length > 0 && items.every((item) => item.state === 'waiting');
    const onlyRngWaiting = onlyWaiting && items.every(_isRngWaiting);
    if (title) title.textContent = onlyRngWaiting
      ? 'RNG PENDING'
      : onlyWaiting ? 'PENDING' : 'READY';
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
      const passive = item.passive === true;
      const canInspectPending = passive
        && item.kind === 'tickets'
        && Array.isArray(item.pendingPacks)
        && item.pendingPacks.length > 0;
      const button = document.createElement(passive && !canInspectPending ? 'div' : 'button');
      if (!passive || canInspectPending) button.type = 'button';
      button.className = [
        'rrt-action',
        `rrt-action--${item.kind}`,
        busy ? 'is-busy' : '',
        waiting ? 'is-waiting' : '',
        rngWaiting ? 'is-rng-waiting' : '',
        resultReady ? 'is-result-ready' : '',
        compact ? 'rrt-action--compact' : '',
        passive ? 'rrt-action--passive' : '',
        passive && item.kind === 'tickets' ? 'rrt-action--pack-pending' : '',
        canInspectPending ? 'rrt-action--inspectable' : '',
      ].filter(Boolean).join(' ');
      const domainLocked = busy || waiting || clearingAll || typeof item.run !== 'function';
      button.disabled = canInspectPending ? false : domainLocked;
      if (passive && !canInspectPending) {
        button.setAttribute('role', 'status');
        button.setAttribute('aria-disabled', 'true');
      } else if (canInspectPending) {
        button.setAttribute('aria-controls', 'rrt-pending-details');
        button.setAttribute('aria-expanded', String(this.#expandedPendingId === item.id));
      }
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
        ? canInspectPending
          ? `Show ${String(item.label || 'pending tickets')}`
          : String(item.label || item.shortLabel || 'Open')
        : `${item.shortLabel || 'Open'}: ${item.label}`);

      const art = document.createElement('span');
      art.className = `rrt-action__art rrt-action__art--${item.kind}`;
      art.setAttribute('aria-hidden', 'true');
      if (item.kind === 'degenerette' && item.ticketPacked != null) {
        const mini = document.createElement('span');
        mini.className = 'ticket-card tc-small dgn-ticket rrt-degenerette-ticket';
        const traits = dgnUnpackTicket(item.ticketPacked);
        applyDgnTicketAccent(mini, traits);
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
        const faces = Array.from({ length: 4 }, (_unused, quadrant) => {
          const face = Number(item.matchFaces?.[quadrant]);
          return face === 2 ? 2 : face === 1 ? 1 : 0;
        });
        const states = faces.map((face) => face === 2 ? 'full' : face === 1 ? 'sym' : 'miss');
        const preview = document.createElement('span');
        preview.className = 'rrt-foil-match-preview';

        const makeTicket = (traitIds, labelText, { foil = false } = {}) => {
          const side = document.createElement('span');
          side.className = 'rrt-foil-match-preview__side';
          const tag = document.createElement('small');
          tag.className = 'rrt-foil-match-preview__tag';
          tag.textContent = labelText;
          side.appendChild(tag);

          const mini = document.createElement('span');
          mini.className = [
            'ticket-card tc-small dgn-ticket rrt-foil-match-ticket',
            foil ? 'ticket-card--foil rrt-foil-match-ticket--foil' : 'rrt-foil-match-ticket--jackpot',
          ].join(' ');
          const traits = dgnTraitIdsToQuadrants(traitIds);
          applyDgnTicketAccent(mini, traitIds);
          traits.forEach((trait, quadrant) => {
            const cell = document.createElement('span');
            cell.className = `trait-quadrant dgn-q rrt-foil-match-ticket__q q-${states[quadrant]}`;
            if (trait?.col === 7) cell.classList?.add('trait-quadrant--gold');
            cell.setAttribute('data-quadrant', String(quadrant));
            if (trait) {
              const badge = document.createElement('img');
              badge.src = dgnBadgePath(quadrant, trait.sym, trait.col);
              badge.alt = '';
              cell.appendChild(badge);
            }
            mini.appendChild(cell);
          });
          const center = document.createElement('span');
          center.className = 'ticket-card-center rrt-foil-match-ticket__center';
          const mark = document.createElement('img');
          mark.src = foil
            ? '/whitepaper/flame-center-silver.svg'
            : '/whitepaper/flame-center.svg';
          mark.alt = '';
          center.appendChild(mark);
          mini.appendChild(center);
          side.appendChild(mini);
          return side;
        };

        preview.appendChild(makeTicket(item.lineTraits, 'FOIL', { foil: true }));
        const vs = document.createElement('span');
        vs.className = 'rrt-foil-match-preview__vs';
        vs.textContent = 'VS';
        preview.appendChild(vs);
        preview.appendChild(makeTicket(
          Array.isArray(item.winningTraits) ? item.winningTraits : [],
          Number(item.drawKind) === 1 ? 'BONUS' : 'MAIN',
        ));
        art.appendChild(preview);
      } else if (item.kind === 'tickets' && passive) {
        const pack = document.createElement('span');
        pack.className = 'rvl-pack rrt-pending-pack-art';
        const logo = document.createElement('img');
        logo.className = 'rvl-pack-logo';
        logo.src = '/whitepaper/flame-logo.svg';
        logo.alt = '';
        pack.appendChild(logo);
        art.appendChild(pack);
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
              : item.kind === 'whale-pass-claim' ? '🐳'
              : item.kind === 'baf' ? 'B'
                : item.kind === 'decimator' ? 'X' : 'D';
      }

      const copy = document.createElement('span');
      copy.className = 'rrt-action__copy';
      const label = document.createElement('strong');
      label.className = 'rrt-action__label';
      if (compact && passive && item.kind === 'tickets') {
        const meta = _ticketPackMeta(item);
        const amount = document.createElement('span');
        amount.className = 'rrt-pack-pending__count';
        amount.textContent = meta.count == null
          ? 'TICKETS'
          : `${meta.count} ${meta.count === 1 ? 'TICKET' : 'TICKETS'}`;
        const state = document.createElement('span');
        state.className = 'rrt-pack-pending__state';
        state.textContent = 'PENDING';
        label.appendChild(amount);
        label.appendChild(state);
      } else {
        label.textContent = item.label;
      }
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
          ? item.kind === 'growth-claim'
            || item.kind === 'volume-claim'
            || item.kind === 'whale-pass-claim'
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

      if (!passive || item.kind === 'tickets') button.appendChild(art);
      button.appendChild(copy);
      if (!compact && !passive) button.appendChild(cta);
      if (!passive && !button.disabled) button.addEventListener('click', () => this.#run(item));
      if (canInspectPending) {
        button.addEventListener('click', () => {
          this.#expandedPendingId = this.#expandedPendingId === item.id ? null : item.id;
          this.#render();
        });
      }
      host.appendChild(button);
    }
    this.#renderPendingPackDetails(
      pendingDetails,
      items.find((item) => item.id === this.#expandedPendingId),
    );
  }

  #renderPendingPackDetails(host, item) {
    if (!host) return;
    host.textContent = '';
    const packs = Array.isArray(item?.pendingPacks) ? item.pendingPacks : [];
    if (packs.length === 0) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const head = document.createElement('span');
    head.className = 'rrt-pending-details__head';
    const title = document.createElement('strong');
    title.textContent = 'PACKS ON THE WAY';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rrt-pending-details__close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close pending ticket details');
    close.addEventListener('click', () => {
      this.#expandedPendingId = null;
      this.#render();
    });
    head.appendChild(title);
    head.appendChild(close);
    host.appendChild(head);

    const list = document.createElement('span');
    list.className = 'rrt-pending-details__packs';
    for (const pendingPack of packs) {
      const tile = document.createElement('span');
      tile.className = 'rrt-pending-pack-preview';
      const pack = document.createElement('span');
      pack.className = `rvl-pack rrt-pending-pack-preview__art${pendingPack.foilPack ? ' is-foil' : ''}`;
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
      edition.textContent = pendingPack.foilPack ? 'FOIL PACK' : 'TICKET PACK';
      brand.appendChild(logo);
      brand.appendChild(edition);
      const level = document.createElement('span');
      level.className = 'rvl-pack-level';
      level.textContent = `LEVEL ${pendingPack.level}`;
      const quantity = document.createElement('span');
      quantity.className = 'rvl-pack-count';
      quantity.textContent = _ticketQuantityText(pendingPack.count);
      pack.appendChild(shine);
      pack.appendChild(brand);
      pack.appendChild(level);
      pack.appendChild(quantity);
      const caption = document.createElement('span');
      caption.className = 'rrt-pending-pack-preview__caption';
      caption.textContent = packs.length > 1
        ? `PACK ${pendingPack.packIndex} OF ${pendingPack.packCount} · PENDING`
        : 'PENDING';
      tile.appendChild(pack);
      tile.appendChild(caption);
      list.appendChild(tile);
    }
    host.appendChild(list);
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
