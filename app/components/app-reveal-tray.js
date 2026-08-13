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
  subscribePendingActionErrors,
  subscribePendingActions,
} from '../app/pending-actions.js';
import { briefTxError } from '../app/ui-error.js';
import {
  applyDgnTicketAccent,
  dgnBadgePath,
  dgnUnpackTicket,
} from '../app/dgn-traits.js';
import {
  isAutomaticPopupBlocked,
  subscribeAutomaticPopupGate,
} from '../app/major-draw-activity.js';
import {
  readRevealAutoOpenPreference,
  subscribeUiPreferences,
} from '../app/ui-preferences.js';
import { applyTicketLevelTone } from '../app/ticket-level-tone.js';
import {
  canRequestLootboxRng,
  readLootboxRngQueueState,
  requestLootboxRng,
} from '../app/lootbox.js';
import { subscribe as subscribeStore } from '../app/store.js';

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
  'affiliate-bonus',
  'wwxrp-draw',
  'golden-ticket',
  'mass-resolution',
  'batch-resolution',
]);
const ERROR_AUTO_CLEAR_MS = 10_000;
const CLEAR_ALL_BUSY_ID = 'reveal-tray:clear-all';
const AUTO_OPEN_RETRY_MS = 7_000;
const RNG_PHASES = new Set([
  'awaitingRng',
  'request-ready',
  'requesting-rng',
  'waiting-rng',
  'result-ready',
  'resolving',
  'indexing',
]);
const RNG_CONFIRMATION_BUBBLES = 5;
const RNG_REQUIRED_CONFIRMATIONS = 10;
// Base blocks land roughly every two seconds. The first four lights are an
// honest time estimate across that confirmation window; the fifth is still
// reserved for the actual ready result, so elapsed time can never unlock work.
const RNG_ESTIMATED_READY_MS = RNG_REQUIRED_CONFIRMATIONS * 2_000;
const RNG_PROGRESS_TICK_MS = 1_000;
const RNG_QUEUE_POLL_MS = 10_000;
const RNG_IN_FLIGHT_POLL_MS = 1_800;
const RNG_REQUEST_RPC_GRACE_MS = 5_000;
const RNG_REQUEST_FLASH_MS = 700;
const RNG_ART_PATHS = Object.freeze({
  idle: '/app/assets/rng-chainlink-idle.svg',
  waiting: '/app/assets/rng-chainlink-waiting.svg',
  request: '/app/assets/rng-chainlink-request.svg',
  incoming: '/app/assets/rng-chainlink-incoming.svg',
  ready: '/app/assets/rng-chainlink-ready.svg',
});
const CLAIM_KINDS = new Set([
  'growth-claim',
  'volume-claim',
  'whale-pass-claim',
  'foil-match',
  'affiliate-bonus',
  'wwxrp-draw',
  'golden-ticket',
]);

// Generic rows used to fall back to punctuation, letters, or a question mark.
// These small line icons keep every action recognizable without adding another
// word to an already narrow bottom surface.
const ACTION_ICON_PATHS = Object.freeze({
  lootbox: [
    'M4 8.25 12 4l8 4.25-8 4.25L4 8.25Z',
    'M4 8.5V16l8 4 8-4V8.5M12 12.5V20',
  ],
  'growth-claim': [
    'M4 18 9.5 12.5l3.5 3L20 7.5',
    'M15.5 7.5H20V12',
  ],
  'volume-claim': [
    'M5 19v-6M12 19V5M19 19V9',
    'M3 19h18',
  ],
  'whale-pass-claim': [
    'M4 7h16v10H4V7Z',
    'M8 7v2M8 15v2M12 10h5M12 14h3',
  ],
  'affiliate-bonus': [
    'M7 19v-5a5 5 0 0 1 10 0v5',
    'M12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  ],
  'wwxrp-draw': [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
    'M8 8l8 8M16 8l-8 8',
  ],
  'golden-ticket': [
    'M4 7h16v10H4V7Z',
    'M8 7v3M8 14v3M12 10h5M12 14h3',
  ],
  baf: [
    'm12 3 1.7 5.2H19l-4.3 3.1 1.7 5.2-4.4-3.2-4.4 3.2 1.7-5.2L5 8.2h5.3L12 3Z',
  ],
});

export function canAutoOpenReveal(item) {
  return item?.state === 'ready'
    && item?.autoOpen === true
    && String(item?.phase || '') !== 'indexing'
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
    && ['requesting-rng', 'waiting-rng'].includes(String(item?.phase || ''));
}

function _isRngLifecycle(item) {
  const phase = String(item?.phase || '');
  if (item?.kind === 'degenerette' && RNG_PHASES.has(phase)) return true;
  return item?.progress === 'indeterminate'
    && /\b(?:rng|random|chainlink)\b/i.test(`${item?.label || ''} ${item?.detail || ''}`);
}

function _isRngLaneOnly(item) {
  // The RNG rail is supplemental status. Player-owned work (a bought spin or
  // lootbox) must keep its receipt/action card from submission through result
  // readiness; otherwise the item appears to vanish during the RNG handoff and
  // can leave a misleading RNG-only shell. Only purpose-built synthetic rail
  // rows may opt out of the action column.
  return item?.rngLaneOnly === true || item?.kind === 'rng';
}

function _usesSharedRngQueue(item) {
  // Degenerette rows predate the explicit marker. Keep that fallback so a
  // restored browser receipt and older publishers still join the same queue.
  return item?.sharedRng === true || item?.kind === 'degenerette';
}

function _rngPriority(item) {
  const phase = String(item?.phase || '');
  if (phase === 'request-ready') return 60;
  if (phase === 'requesting-rng') return 50;
  if (phase === 'waiting-rng') return 40;
  if (phase === 'awaitingRng') return 30;
  // A generic publisher with an indeterminate RNG wait is still live work.
  // Prefer it to an already-fulfilled Degenerette result when both are present.
  if (item?.kind !== 'degenerette') return 20;
  return 10;
}

function _rngBigInt(value) {
  try { return BigInt(value ?? 0); } catch (_e) { return 0n; }
}

function _rngQueueDots(item, forceFull = false) {
  if (forceFull) return RNG_CONFIRMATION_BUBBLES;
  const pending = _rngBigInt(item?.rngQueuePendingMilliEth);
  const threshold = _rngBigInt(item?.rngQueueThresholdMilliEth);
  const pendingFlip = _rngBigInt(item?.rngQueuePendingFlipWhole);
  if (threshold <= 0n) return pending > 0n || pendingFlip > 0n ? RNG_CONFIRMATION_BUBBLES : 0;
  if (pending <= 0n) return 0;
  const dots = Number(
    (pending * BigInt(RNG_CONFIRMATION_BUBBLES) + threshold - 1n) / threshold,
  );
  return Math.max(1, Math.min(RNG_CONFIRMATION_BUBBLES, dots));
}

function _rngQueueStatus(item, completeDots) {
  const pending = _rngBigInt(item?.rngQueuePendingMilliEth);
  const threshold = _rngBigInt(item?.rngQueueThresholdMilliEth);
  if (threshold <= 0n) return completeDots > 0 ? 'Mid-day RNG queue ready' : 'RNG idle';
  const fmt = (milli) => {
    const whole = milli / 1_000n;
    const fraction = String(milli % 1_000n).padStart(3, '0').replace(/0+$/, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
  };
  return `Mid-day RNG queue · ${fmt(pending)}/${fmt(threshold)} ETH`;
}

function _rngConfirmationColor(completeDots) {
  if (completeDots <= 0) return null;
  return {
    solid: 'hsl(120 78% 52%)',
    edge: 'hsl(120 88% 72%)',
    glow: 'hsl(120 84% 54% / 0.72)',
  };
}

function _rngProgressStartedAt(item) {
  for (const value of [
    item?.progressStartedAt,
    item?.rngRequestStartedAt,
    item?.rngStartedAt,
  ]) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    // Contract requestTime values are seconds; browser-owned values are ms.
    return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
  }
  return 0;
}

/**
 * Estimated incoming-light progress. Four lights advance with elapsed time;
 * the fifth remains readiness-only and is never returned by this helper.
 */
export function rngTimedConfirmationDots({
  startedAt = 0,
  now = Date.now(),
  estimatedReadyMs = RNG_ESTIMATED_READY_MS,
} = {}) {
  const start = Number(startedAt);
  const current = Number(now);
  const duration = Number(estimatedReadyMs);
  if (!Number.isFinite(start) || start <= 0
    || !Number.isFinite(current)
    || !Number.isFinite(duration) || duration <= 0) return 1;
  const elapsed = Math.max(0, current - start);
  const progressLights = RNG_CONFIRMATION_BUBBLES - 1;
  const intervals = Math.max(1, progressLights - 1);
  return Math.min(
    progressLights,
    1 + Math.floor(Math.min(1, elapsed / duration) * intervals),
  );
}

function _rngPresentation(item, localBusy = false) {
  const phase = String(item?.phase || '');
  if (!item) return {
    phase: 'idle', mode: 'idle', completeDots: 0,
    requestable: false, logoLit: false, status: 'RNG idle', color: null,
  };
  if (localBusy || phase === 'requesting-rng') {
    return {
      phase: 'requesting', mode: 'confirmations', completeDots: 0,
      requestable: false, logoLit: false, status: 'Submitting RNG request', color: null,
    };
  }
  if (phase === 'request-ready') {
    return {
      phase: 'requestable', mode: 'queue',
      completeDots: item?.rngHasWaitingItem ? RNG_CONFIRMATION_BUBBLES : 0,
      requestable: true, logoLit: true,
      status: 'Mid-day RNG queue full · request RNG', color: null,
    };
  }
  if (phase === 'waiting-rng' || !_usesSharedRngQueue(item)) {
    const namesChainlink = /\bchainlink\b/i.test(`${item?.label || ''} ${item?.detail || ''}`);
    const requestBlock = Number(item?.rngRequestBlock);
    const currentBlock = Number(item?.rngCurrentBlock);
    const hasBlockProgress = Number.isInteger(requestBlock) && requestBlock > 0
      && Number.isInteger(currentBlock) && currentBlock >= requestBlock;
    const requiredConfirmations = Math.max(
      1,
      Number(item?.rngConfirmations) || RNG_REQUIRED_CONFIRMATIONS,
    );
    const observedConfirmations = hasBlockProgress
      ? Math.min(requiredConfirmations, currentBlock - requestBlock + 1)
      : 0;
    // Four bubbles summarize the real confirmation count. The fifth remains
    // readiness-only and lights with the resolvable result.
    const blockDots = hasBlockProgress
      ? Math.max(1, Math.min(
        RNG_CONFIRMATION_BUBBLES - 1,
        Math.ceil(
          observedConfirmations
            * (RNG_CONFIRMATION_BUBBLES - 1)
            / requiredConfirmations,
        ),
      ))
      : 1;
    const timedDots = rngTimedConfirmationDots({
      startedAt: _rngProgressStartedAt(item),
      estimatedReadyMs: Number(item?.rngEstimatedReadyMs) || RNG_ESTIMATED_READY_MS,
    });
    // RPC heads remain useful when they are ahead, but sparse/stalled polling
    // no longer freezes the instrument. Neither path can light the final dot.
    const completeDots = Math.max(blockDots, timedDots);
    const statusRoot = namesChainlink ? 'Waiting for Chainlink' : 'Waiting for RNG';
    return {
      phase: 'fulfilling', mode: 'confirmations', completeDots,
      requestable: false, logoLit: false, color: _rngConfirmationColor(completeDots),
      status: hasBlockProgress
        ? `${statusRoot} · ${observedConfirmations}/${requiredConfirmations} blocks`
        : statusRoot,
    };
  }
  if (['result-ready', 'resolving', 'indexing'].includes(phase)) {
    return {
      phase: 'fulfilled', mode: 'confirmations', completeDots: RNG_CONFIRMATION_BUBBLES,
      requestable: false, logoLit: false,
      color: _rngConfirmationColor(RNG_CONFIRMATION_BUBBLES),
      status: phase === 'indexing' ? 'RNG ready · loading result' : 'RNG ready',
    };
  }
  const completeDots = item?.rngHasWaitingItem ? _rngQueueDots(item) : 0;
  const queueFull = completeDots === RNG_CONFIRMATION_BUBBLES;
  return {
    phase: queueFull ? 'queue-ready' : 'queued', mode: 'queue', completeDots,
    requestable: false, logoLit: queueFull,
    status: _rngQueueStatus(item, completeDots), color: null,
  };
}

/** Compact large fungible-token figures only; ETH and ticket quantities keep
 * their exact display because small decimal precision is meaningful there. */
export function abbreviatePendingTokenAmounts(value) {
  return String(value ?? '').replace(
    /([+-]?[\d,]+(?:\.\d+)?)\s*(FLIP|DGNRS|WWXRP)\b/gi,
    (match, numericText, unit) => {
      const numeric = Number(String(numericText).replace(/,/g, ''));
      if (!Number.isFinite(numeric) || Math.abs(numeric) < 1_000) return match;
      const magnitude = Math.abs(numeric);
      const [divisor, suffix] = magnitude >= 1e12
        ? [1e12, 't']
        : magnitude >= 1e9
          ? [1e9, 'b']
          : magnitude >= 1e6
            ? [1e6, 'm']
            : [1e3, 'k'];
      const scaled = numeric / divisor;
      const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
      const compact = scaled.toFixed(decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
      return `${compact}${suffix} ${String(unit).toUpperCase()}`;
    },
  );
}

function _luckboxUiText(value) {
  return String(value ?? '').replace(/\bloot[\s-]?box(?:es)?\b/gi, (match) => {
    const replacement = 'luckbox';
    if (match === match.toUpperCase()) return replacement.toUpperCase();
    if (match[0] === match[0].toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });
}

function _compactActionLabel(item) {
  const label = _luckboxUiText(item?.label || _kindLabel(item?.kind)).trim();
  if (item?.kind === 'tickets') {
    const meta = _ticketPackMeta(item);
    if (meta.level != null && meta.count != null) {
      return `${meta.count} Lvl ${meta.level}\n${meta.count === 1 ? 'Ticket' : 'Tickets'}`;
    }
    if (meta.level != null) return `Lvl ${meta.level}\nTickets`;
    if (meta.count != null) return `${meta.count}\n${meta.count === 1 ? 'Ticket' : 'Tickets'}`;
  }
  if (item?.kind === 'degenerette') return label.toUpperCase();
  if (item?.kind === 'decimator' || item?.kind === 'baf') {
    const level = /\blevel\s+(\d+)/i.exec(label)?.[1];
    if (item.kind === 'decimator') return `${level ? `L${level} ` : ''}DECIMATOR`;
    return `BAF${level ? ` · L${level}` : ''}`;
  }
  if (item?.kind === 'growth-claim') {
    const level = /\blevel\s+(\d+)/i.exec(label)?.[1];
    return `GROWTH${level ? ` · L${level}` : ''}`;
  }
  if (item?.kind === 'volume-claim') return 'VOLUME BET';
  if (item?.kind === 'whale-pass-claim') {
    const count = /^\s*(\d+)/.exec(label)?.[1];
    return `WHALE PASS${count ? ` · ${count}` : ''}`;
  }
  if (item?.kind === 'bingo') {
    return label.replace(/^level\s+\d+\s+/i, '').toUpperCase();
  }
  return abbreviatePendingTokenAmounts(label.toUpperCase());
}

export function degenerettePendingSummary(item) {
  const amount = abbreviatePendingTokenAmounts(String(item?.amountLabel || '').trim());
  const spins = Math.max(1, Math.floor(Number(item?.spinCount) || 1));
  return {
    amount,
    spins,
    text: `${amount ? `${amount} · ` : ''}luckbox ×${spins} ${spins === 1 ? 'spin' : 'spins'}`,
  };
}

function _appendDecimatorPendingLabel(label, item) {
  const level = /\blevel\s+(\d+)/i.exec(String(item?.label || ''))?.[1];
  label.classList?.add('rrt-decimator-summary');
  const levelLine = document.createElement('span');
  levelLine.className = 'rrt-decimator-summary__level';
  levelLine.textContent = level ? `L${level}` : 'L—';
  const name = document.createElement('span');
  name.className = 'rrt-decimator-summary__name';
  name.textContent = 'DECIMATOR';
  label.appendChild(levelLine);
  label.appendChild(name);
}

function _appendDegenerettePendingLabel(label, item) {
  const summary = degenerettePendingSummary(item);
  label.classList?.add('rrt-degenerette-summary');
  const amount = document.createElement('span');
  amount.className = 'rrt-degenerette-summary__amount';
  amount.textContent = summary.amount;
  if (summary.amount) label.appendChild(amount);
  const count = document.createElement('span');
  count.className = 'rrt-degenerette-summary__count';
  count.textContent = `×${summary.spins}`;
  label.appendChild(count);
  const unit = document.createElement('span');
  unit.className = 'rrt-degenerette-summary__unit';
  unit.textContent = summary.spins === 1 ? 'SPIN' : 'SPINS';
  label.appendChild(unit);
  return summary;
}

export function lootboxPendingSummary(item) {
  const amount = abbreviatePendingTokenAmounts(String(item?.amountLabel || '').trim());
  // Old locally-persisted rows may still carry "LOOTBOX PURCHASE". Pending is
  // a receipt, not a transaction-history sentence, so normalize every source
  // to the same terse noun.
  const unit = _luckboxUiText(item?.lootboxLabel || 'LUCKBOX')
    .replace(/\bPURCHASE\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase() || 'LUCKBOX';
  return { amount, unit, text: `${amount ? `${amount} · ` : ''}${unit.toLowerCase()}` };
}

function _appendLootboxPendingLabel(label, item) {
  const summary = lootboxPendingSummary(item);
  label.classList?.add('rrt-lootbox-summary');
  if (summary.amount) {
    const amount = document.createElement('span');
    amount.className = 'rrt-lootbox-summary__amount';
    amount.textContent = summary.amount;
    label.appendChild(amount);
  }
  const unit = document.createElement('span');
  unit.className = 'rrt-lootbox-summary__unit';
  unit.textContent = summary.unit;
  label.appendChild(unit);
  return summary;
}

export function foilMatchPendingSummary(item) {
  let tier = Number(item?.score);
  if (!Number.isInteger(tier) || tier < 1) {
    const match = /\bT(\d+)\b/i.exec(`${item?.shortLabel || ''} ${item?.label || ''}`);
    tier = Number(match?.[1]);
  }
  const tierText = Number.isInteger(tier) && tier > 0 ? `T${tier}` : 'T?';
  return { tier, tierText, text: `${tierText} FOIL LUCKBOX MATCH` };
}

function _appendFoilMatchPendingLabel(label, item) {
  const summary = foilMatchPendingSummary(item);
  label.classList?.add('rrt-foil-match-summary');
  const lead = document.createElement('span');
  lead.textContent = `${summary.tierText} FOIL`;
  label.appendChild(lead);
  const luckbox = document.createElement('span');
  luckbox.className = 'rrt-foil-match-summary__luckbox';
  luckbox.setAttribute('aria-hidden', 'true');
  _appendLineIcon(luckbox, 'lootbox');
  label.appendChild(luckbox);
  const tail = document.createElement('span');
  tail.textContent = 'MATCH';
  label.appendChild(tail);
  return summary;
}

function _actionVerb(item, { busy = false, waiting = false } = {}) {
  if (waiting) return String(item?.phase || '') === 'indexing' ? 'LOADING' : 'WAITING';
  if (busy) {
    if (CLAIM_KINDS.has(item?.kind) || item?.kind === 'baf') return 'CLAIMING';
    if (['decimator', 'mass-resolution', 'batch-resolution'].includes(item?.kind)) return 'WORKING';
    return 'OPENING';
  }
  if (CLAIM_KINDS.has(item?.kind)) return 'CLAIM';
  if (item?.kind === 'tickets' || item?.kind === 'lootbox') return 'OPEN';
  if (item?.kind === 'degenerette' || item?.kind === 'bingo') return 'VIEW';
  if (item?.kind === 'decimator') return item?.write === true ? 'RESOLVE' : 'VIEW';
  if (item?.kind === 'baf') return item?.write === true ? 'CLAIM' : 'VIEW';
  if (item?.kind === 'mass-resolution' || item?.kind === 'batch-resolution') return 'RUN';
  return 'OPEN';
}

function _appendLineIcon(host, kind) {
  const paths = ACTION_ICON_PATHS[kind];
  if (!host || !paths) return false;
  const ns = 'http://www.w3.org/2000/svg';
  const make = (tag) => typeof document.createElementNS === 'function'
    ? document.createElementNS(ns, tag)
    : document.createElement(tag);
  const svg = make('svg');
  // SVGElement.className is an SVGAnimatedString in browsers and is not a
  // writable string property. Assigning to it throws in module strict mode,
  // which used to abort the whole tray render before any action was appended.
  svg.setAttribute('class', 'rrt-action__glyph');
  // The lightweight DOM used by the focused tests stores classes only on its
  // string className field. Real SVG nodes take the setAttribute path above.
  if (typeof svg.className === 'string') svg.className = 'rrt-action__glyph';
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of paths) {
    const path = make('path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  host.appendChild(svg);
  return true;
}

function _ticketPackMeta(item) {
  const levelMatch = /\blevel\s+(\d+)/i.exec(String(item?.label || ''));
  const countMatch = /\b(\d+(?:\.\d+)?)\s+tickets?\b/i.exec(String(item?.detail || ''));
  const previewLevels = [...new Set((Array.isArray(item?.pendingPacks)
    ? item.pendingPacks : [])
    .map((pack) => Number(pack?.level))
    .filter((level) => Number.isFinite(level) && level >= 0))];
  const rawLevel = item?.ticketLevel
    ?? levelMatch?.[1]
    ?? (previewLevels.length === 1 ? previewLevels[0] : null);
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

function _appendTicketActionLabel(label, meta, { passive = false } = {}) {
  if (!label || (meta?.level == null && meta?.count == null)) return false;
  const first = document.createElement('span');
  first.className = passive ? 'rrt-pack-pending__count' : 'rrt-ticket-ready__line';
  if (meta.count != null) {
    const count = document.createElement('span');
    count.className = 'rrt-ticket-count';
    count.textContent = `${meta.count}${!passive && meta.level != null ? ' ' : ''}`;
    first.appendChild(count);
  }
  // The collapsed Pending receipt only needs quantity + type. Its dropdown
  // owns level-by-level detail; ready pack actions still show their level.
  if (!passive && meta.level != null) {
    const level = document.createElement('span');
    level.className = 'rrt-ticket-level';
    level.textContent = `Lvl ${meta.level}`;
    applyTicketLevelTone(level, meta.level);
    first.appendChild(level);
  }
  const state = document.createElement('span');
  state.className = passive ? 'rrt-pack-pending__state' : 'rrt-ticket-ready__state';
  state.textContent = `${passive ? '' : '\n'}${meta.count === 1 ? 'Ticket' : 'Tickets'}`;
  label.appendChild(first);
  label.appendChild(state);
  return true;
}

export function actionableRevealItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => (
    REVEAL_KINDS.has(String(item?.kind || ''))
    // The Decimator also owns the main jackpot control while due, but Pending is
    // its durable fallback. If the player misses that hero handoff, the resolved
    // fullscreen draw must remain visible here until it is actually opened.
    && (
      item?.state === 'ready'
      || item?.state === 'busy'
      || (item?.state === 'waiting' && item?.pinned === true)
    )
  ));
}

function _kindLabel(kind) {
  if (kind === 'lootbox') return 'LUCKBOX';
  if (kind === 'degenerette') return 'DEGENERETTE';
  if (kind === 'growth-claim') return 'GROWTH BET';
  if (kind === 'volume-claim') return 'VOLUME BET';
  if (kind === 'whale-pass-claim') return 'WHALE PASS CLAIM';
  if (kind === 'decimator') return 'DECIMATOR';
  if (kind === 'baf') return 'BAF CONSOLATION';
  if (kind === 'bingo') return 'BINGO';
  if (kind === 'foil-match') return 'FOIL TICKET MATCH';
  if (kind === 'affiliate-bonus') return 'AFFILIATE BONUS';
  if (kind === 'wwxrp-draw') return 'WWXRP DRAW';
  if (kind === 'golden-ticket') return 'GOLDEN TICKET';
  if (kind === 'mass-resolution' || kind === 'batch-resolution') return 'PROTOCOL RESOLUTION';
  return 'TICKET PACK';
}

class AppRevealTray extends HTMLElement {
  #initialized = false;
  #unsubscribe = null;
  #errorUnsubscribe = null;
  #items = [];
  #hiddenFingerprint = null;
  #busyId = null;
  #errorTimer = null;
  #autoOpen = false;
  #autoAttempted = new Set();
  #autoRetryTimers = new Map();
  #autoScheduledId = null;
  #popupGateUnsubscribe = null;
  #preferenceUnsubscribe = null;
  #expandedPendingId = null;
  #rngItem = null;
  #rngQueueState = null;
  #rngGlobalRequestable = false;
  #rngMonitorTimer = null;
  #rngMonitorToken = 0;
  #rngGlobalRequestBlock = 0;
  #rngGlobalCurrentBlock = 0;
  #rngRequestAcceptedAt = 0;
  #rngProgressTimer = null;
  #rngRequestFlashActive = false;
  #rngRequestFlashTimer = null;
  #storeUnsubs = [];
  #jackpotPhase = false;
  #jackpotRngInFlight = false;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#autoOpen = readRevealAutoOpenPreference();
    this.#renderShell();
    const clear = this.querySelector('[data-bind="rrt-clear"]');
    if (clear) clear.addEventListener('click', () => this.#clearAll());
    const hide = this.querySelector('[data-bind="rrt-hide"]');
    if (hide) hide.addEventListener('click', () => this.#hideCurrent());
    const rngRequest = this.querySelector('[data-bind="rrt-rng-request"]');
    if (rngRequest) rngRequest.addEventListener('click', () => {
      if (this.#rngItem) void this.#run(this.#rngItem);
    });
    this.#preferenceUnsubscribe = subscribeUiPreferences(({ name, value }) => {
      if (name !== 'revealAutoOpen') return;
      this.#autoOpen = Boolean(value);
      if (!this.#autoOpen) this.#clearAutoRetryTimers();
      this.#maybeAutoOpen();
    });
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
    this.#errorUnsubscribe = subscribePendingActionErrors((message) => {
      this.#showError(message);
    });
    // A ready result may arrive while the jackpot or coin is moving. Keep it
    // actionable in the tray, then reconsider the automatic open when the
    // shared post-animation reading window expires.
    this.#popupGateUnsubscribe = subscribeAutomaticPopupGate(() => this.#maybeAutoOpen());
    this.#storeUnsubs = [
      subscribeStore('game.phase', (phase) => {
        this.#jackpotPhase = String(phase || '').toUpperCase() === 'JACKPOT';
        this.#render();
        if (typeof window !== 'undefined') void this.#refreshRngQueue();
      }),
      subscribeStore('game.rngLocked', (locked) => {
        this.#jackpotRngInFlight = locked === true;
        this.#render();
        if (typeof window !== 'undefined') void this.#refreshRngQueue();
      }),
      subscribeStore('app.lastDay', () => this.#render()),
      subscribeStore('app.gameState', () => this.#render()),
    ];
    if (typeof window !== 'undefined') this.#startRngMonitor();
  }

  disconnectedCallback() {
    try { this.#unsubscribe?.(); } catch (_e) { /* defensive */ }
    this.#unsubscribe = null;
    try { this.#errorUnsubscribe?.(); } catch (_e) { /* defensive */ }
    this.#errorUnsubscribe = null;
    try { this.#popupGateUnsubscribe?.(); } catch (_e) { /* defensive */ }
    this.#popupGateUnsubscribe = null;
    try { this.#preferenceUnsubscribe?.(); } catch (_e) { /* defensive */ }
    this.#preferenceUnsubscribe = null;
    for (const unsubscribe of this.#storeUnsubs.splice(0)) {
      try { unsubscribe?.(); } catch (_e) { /* defensive */ }
    }
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_e) { /* defensive */ }
      this.#errorTimer = null;
    }
    this.#hiddenFingerprint = null;
    this.#autoScheduledId = null;
    this.#clearAutoRetryTimers();
    this.#expandedPendingId = null;
    this.#rngItem = null;
    this.#cancelRngMonitor();
    this.#rngQueueState = null;
    this.#rngGlobalRequestable = false;
    this.#rngGlobalRequestBlock = 0;
    this.#rngGlobalCurrentBlock = 0;
    this.#rngRequestAcceptedAt = 0;
    this.#cancelRngProgressTimer();
    this.#rngRequestFlashActive = false;
    this.#jackpotPhase = false;
    this.#jackpotRngInFlight = false;
    if (this.#rngRequestFlashTimer != null) {
      try { clearTimeout(this.#rngRequestFlashTimer); } catch (_e) { /* defensive */ }
      this.#rngRequestFlashTimer = null;
    }
    this.#autoAttempted.clear();
    this.#initialized = false;
  }

  #startRngMonitor() {
    this.#cancelRngMonitor();
    const token = ++this.#rngMonitorToken;
    const tick = async () => {
      if (!this.#initialized || token !== this.#rngMonitorToken) return;
      await this.#refreshRngQueue(token);
      if (!this.#initialized || token !== this.#rngMonitorToken) return;
      const inFlight = Boolean(this.#rngQueueState?.middayRequestInFlight)
        || (this.#jackpotPhase && this.#jackpotRngInFlight);
      this.#rngMonitorTimer = setTimeout(
        tick,
        inFlight ? RNG_IN_FLIGHT_POLL_MS : RNG_QUEUE_POLL_MS,
      );
      if (this.#rngMonitorTimer && typeof this.#rngMonitorTimer.unref === 'function') {
        try { this.#rngMonitorTimer.unref(); } catch (_e) { /* defensive */ }
      }
    };
    void tick();
  }

  #cancelRngMonitor() {
    this.#rngMonitorToken += 1;
    if (this.#rngMonitorTimer != null) {
      try { clearTimeout(this.#rngMonitorTimer); } catch (_e) { /* defensive */ }
      this.#rngMonitorTimer = null;
    }
  }

  #cancelRngProgressTimer() {
    if (this.#rngProgressTimer != null) {
      try { clearTimeout(this.#rngProgressTimer); } catch (_e) { /* defensive */ }
      this.#rngProgressTimer = null;
    }
  }

  #scheduleRngProgressTimer(active) {
    if (!active) {
      this.#cancelRngProgressTimer();
      return;
    }
    if (this.#rngProgressTimer != null) return;
    this.#rngProgressTimer = setTimeout(() => {
      this.#rngProgressTimer = null;
      if (this.#initialized) this.#render();
    }, RNG_PROGRESS_TICK_MS);
    if (this.#rngProgressTimer && typeof this.#rngProgressTimer.unref === 'function') {
      try { this.#rngProgressTimer.unref(); } catch (_e) { /* defensive */ }
    }
  }

  async #refreshRngQueue(token = this.#rngMonitorToken) {
    let next = null;
    try { next = await readLootboxRngQueueState(); } catch (_e) { /* retain the last good display */ }
    if (!this.#initialized || token !== this.#rngMonitorToken) return;
    if (next) {
      const acceptedRecently = this.#rngRequestAcceptedAt > 0
        && Date.now() - this.#rngRequestAcceptedAt < RNG_REQUEST_RPC_GRACE_MS;
      const middayInFlight = Boolean(next.middayRequestInFlight) || acceptedRecently;
      const inFlight = middayInFlight || (this.#jackpotPhase && this.#jackpotRngInFlight);
      const head = Number(next.blockNumber);
      if (inFlight) {
        if (this.#rngRequestAcceptedAt <= 0) {
          const requestTime = Number(next.requestTime);
          this.#rngRequestAcceptedAt = Number.isFinite(requestTime) && requestTime > 0
            ? requestTime * 1_000
            : Date.now();
        }
        if (this.#rngGlobalRequestBlock <= 0 && Number.isInteger(head) && head > 0) {
          this.#rngGlobalRequestBlock = head;
        }
        if (Number.isInteger(head) && head > 0) {
          this.#rngGlobalCurrentBlock = Math.max(
            this.#rngGlobalRequestBlock || head,
            head,
          );
        }
      } else {
        this.#rngGlobalRequestBlock = 0;
        this.#rngGlobalCurrentBlock = 0;
        this.#rngRequestAcceptedAt = 0;
      }
      this.#rngQueueState = { ...next, middayRequestInFlight: middayInFlight };
    }

    let requestable = false;
    if (this.#rngQueueState?.queueReady
      && !this.#rngQueueState?.middayRequestInFlight) {
      try { requestable = await canRequestLootboxRng(); } catch (_e) { requestable = false; }
    }
    if (!this.#initialized || token !== this.#rngMonitorToken) return;
    this.#rngGlobalRequestable = requestable;
    this.#render();
  }

  async #requestGlobalRng() {
    const requested = await requestLootboxRng();
    this.#markGlobalRngIncoming(requested?.receipt?.blockNumber);
    void this.#refreshRngQueue();
  }

  #markGlobalRngIncoming(receiptBlockValue = 0) {
    const receiptBlock = Number(receiptBlockValue);
    const observedBlock = Number(this.#rngQueueState?.blockNumber);
    const startBlock = Number.isInteger(receiptBlock) && receiptBlock > 0
      ? receiptBlock
      : Number.isInteger(observedBlock) && observedBlock > 0 ? observedBlock : 0;
    this.#rngRequestAcceptedAt = Date.now();
    this.#rngGlobalRequestBlock = startBlock;
    this.#rngGlobalCurrentBlock = startBlock;
    this.#rngGlobalRequestable = false;
    this.#rngQueueState = {
      ...(this.#rngQueueState || {}),
      pendingMilliEth: 0n,
      pendingFlipWhole: 0n,
      queueReady: false,
      fillBps: 0,
      middayRequestInFlight: true,
      blockNumber: startBlock || this.#rngQueueState?.blockNumber || null,
    };
    this.#render();
  }

  #rngDisplayItem(item) {
    const queue = this.#rngQueueState;
    const queueMeta = queue ? {
      rngQueuePendingMilliEth: String(queue.pendingMilliEth ?? 0n),
      rngQueueThresholdMilliEth: String(queue.thresholdMilliEth ?? 0n),
      rngQueuePendingFlipWhole: String(queue.pendingFlipWhole ?? 0n),
    } : {};
    const middayInFlight = Boolean(queue?.middayRequestInFlight);
    const jackpotInFlight = this.#jackpotPhase && this.#jackpotRngInFlight;
    const globalInFlight = middayInFlight || jackpotInFlight;
    const global = {
      id: 'reveal-tray:shared-rng',
      kind: 'degenerette',
      label: 'Shared RNG',
      detail: jackpotInFlight
        ? 'Waiting for jackpot RNG'
        : globalInFlight ? 'Waiting for Chainlink result' : 'Mid-day RNG queue',
      state: this.#rngGlobalRequestable ? 'ready' : 'waiting',
      phase: globalInFlight
        ? 'waiting-rng'
        : this.#rngGlobalRequestable ? 'request-ready' : 'awaitingRng',
      progress: globalInFlight ? 'indeterminate' : null,
      progressStartedAt: this.#rngRequestAcceptedAt || null,
      rngRequestBlock: this.#rngGlobalRequestBlock || null,
      rngCurrentBlock: this.#rngGlobalCurrentBlock || null,
      rngConfirmations: RNG_REQUIRED_CONFIRMATIONS,
      run: this.#rngGlobalRequestable ? () => this.#requestGlobalRng() : null,
      ...queueMeta,
    };
    if (!item) return global;

    // Daily/special RNG publishers can use the same compact progress rail,
    // but must never inherit the mid-day queue's request transaction.
    if (!_usesSharedRngQueue(item)) return item;

    const phase = String(item.phase || '');
    if (globalInFlight && ['result-ready', 'resolving', 'indexing'].includes(phase)) {
      return global;
    }
    if (globalInFlight && ['awaitingRng', 'request-ready', 'requesting-rng'].includes(phase)) {
      return {
        ...item,
        ...queueMeta,
        state: 'waiting',
        phase: 'waiting-rng',
        progressStartedAt: this.#rngRequestAcceptedAt || item.progressStartedAt || null,
        rngRequestBlock: this.#rngGlobalRequestBlock || item.rngRequestBlock || null,
        rngCurrentBlock: this.#rngGlobalCurrentBlock || item.rngCurrentBlock || null,
        rngConfirmations: RNG_REQUIRED_CONFIRMATIONS,
        run: null,
      };
    }
    if (phase === 'awaitingRng' && this.#rngGlobalRequestable) {
      return {
        ...item,
        ...queueMeta,
        state: 'ready',
        phase: 'request-ready',
        run: () => this.#requestGlobalRng(),
      };
    }
    return { ...item, ...queueMeta };
  }

  #renderShell() {
    this.innerHTML = `
      <div class="rrt-stage" data-bind="rrt-stage">
        <div class="rrt-error" data-bind="rrt-error" hidden role="alert"></div>
        <aside class="rrt-tray" data-bind="rrt-tray" data-has-pending="false" aria-live="polite"
               aria-label="Actions ready">
          <!-- RNG lives inside the Pending surface and is hidden unless a
               player RNG lifecycle (or an active jackpot request) gives every
               part of this compact instrument something meaningful to show. -->
          <section class="rrt-rng" data-bind="rrt-rng" data-rng-phase="idle"
                   aria-label="Chainlink RNG status">
            <span class="rrt-rng__flow" data-bind="rrt-rng-flow" role="status"
                  aria-label="RNG idle">
              ${Array.from({ length: RNG_CONFIRMATION_BUBBLES }, (_, index) => (
                `<i class="rrt-rng__step" data-bind="rrt-rng-step-${index + 1}" aria-hidden="true"></i>`
              )).join('')}
              <span class="rrt-rng__status" data-bind="rrt-rng-status">RNG IDLE</span>
            </span>
            <span class="rrt-rng__brand">
              <button type="button" class="rrt-rng__request" data-bind="rrt-rng-request"
                      disabled aria-label="Shared RNG is not requestable yet">
                <img class="rrt-rng__art" data-bind="rrt-rng-art"
                     src="/app/assets/rng-chainlink-idle.svg" alt="" aria-hidden="true">
              </button>
            </span>
          </section>
          <div class="rrt-actions" data-bind="rrt-actions"></div>
          <div class="rrt-controls" data-bind="rrt-controls" aria-label="Pending controls">
            <span class="rrt-controls__actions">
              <button type="button" class="rrt-hide" data-bind="rrt-hide" hidden
                      aria-label="Hide pending actions until their status changes">HIDE</button>
              <button type="button" class="rrt-clear" data-bind="rrt-clear" hidden
                      aria-label="Clear all pending reveal reminders">CLEAR</button>
            </span>
          </div>
          <section id="rrt-pending-details" class="rrt-pending-details"
                   data-bind="rrt-pending-details" hidden></section>
        </aside>
      </div>
    `;
  }

  #beginRngRequestFlash() {
    this.#rngRequestFlashActive = true;
    if (this.#rngRequestFlashTimer != null) {
      try { clearTimeout(this.#rngRequestFlashTimer); } catch (_e) { /* defensive */ }
    }
    this.#rngRequestFlashTimer = setTimeout(() => {
      this.#rngRequestFlashTimer = null;
      this.#rngRequestFlashActive = false;
      this.#render();
    }, RNG_REQUEST_FLASH_MS);
    if (this.#rngRequestFlashTimer && typeof this.#rngRequestFlashTimer.unref === 'function') {
      this.#rngRequestFlashTimer.unref();
    }
  }

  async #run(item) {
    if (this.#busyId != null || item?.state !== 'ready' || typeof item.run !== 'function') return false;
    const isRngRequest = String(item?.phase || '') === 'request-ready';
    if (isRngRequest) {
      this.#rngRequestFlashActive = false;
      if (this.#rngRequestFlashTimer != null) {
        try { clearTimeout(this.#rngRequestFlashTimer); } catch (_e) { /* defensive */ }
        this.#rngRequestFlashTimer = null;
      }
    }
    this.#busyId = item.id;
    this.#clearError();
    this.#render();
    let completed = false;
    try {
      completed = await item.run() !== false;
    } catch (error) {
      if (isRngRequest) {
        // A shared request commonly loses a same-block race after another
        // wallet has already opened the Chainlink cycle. Treat every request
        // failure as that benign race and follow the incoming fulfillment;
        // authoritative polling can reopen REQUEST after the short RPC grace
        // window if no request actually landed.
        this.#markGlobalRngIncoming();
        void this.#refreshRngQueue();
      } else {
        // The tray is persistent, tiny chrome. Never dump provider/revert detail
        // into it; domain panels may retain richer recovery copy near the form.
        console.warn?.('[reveal-tray] action failed', error);
        this.#showError(briefTxError(error, 'Action did not go through. Try again.'));
      }
    } finally {
      this.#busyId = null;
      if (completed && isRngRequest) this.#beginRngRequestFlash();
      this.#render();
      this.#maybeAutoOpen();
    }
    return completed;
  }

  #clearAutoRetryTimers() {
    for (const timer of this.#autoRetryTimers.values()) {
      try { clearTimeout(timer); } catch (_e) { /* defensive */ }
    }
    this.#autoRetryTimers.clear();
  }

  #scheduleAutoRetry(id) {
    if (!id || this.#autoRetryTimers.has(id)) return;
    const timer = setTimeout(() => {
      this.#autoRetryTimers.delete(id);
      this.#autoAttempted.delete(id);
      this.#maybeAutoOpen();
    }, AUTO_OPEN_RETRY_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
    this.#autoRetryTimers.set(id, timer);
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
      void this.#run(current).then((completed) => {
        if (!completed && this.#initialized && this.#autoOpen) this.#scheduleAutoRetry(id);
      });
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

  #renderRng(item) {
    const lane = this.querySelector('[data-bind="rrt-rng"]');
    const request = this.querySelector('[data-bind="rrt-rng-request"]');
    const flow = this.querySelector('[data-bind="rrt-rng-flow"]');
    const status = this.querySelector('[data-bind="rrt-rng-status"]');
    const art = this.querySelector('[data-bind="rrt-rng-art"]');
    if (!lane || !request) return;

    const itemPhase = String(item?.phase || '');
    const requestBusy = ['request-ready', 'requesting-rng'].includes(itemPhase)
      && (this.#busyId === item?.id || item?.state === 'busy');
    let model = _rngPresentation(item, requestBusy);
    // The receipt has landed but a publisher/RPC replica can still be one paint
    // behind. During the brief completion flash, lock the request control and
    // show the first green confirmation light immediately.
    if (this.#rngRequestFlashActive && model.phase === 'requestable') {
      model = {
        phase: 'request-confirmed', mode: 'confirmations', completeDots: 1,
        requestable: false, logoLit: false,
        status: 'RNG request confirmed', color: _rngConfirmationColor(1),
      };
    }
    this.#scheduleRngProgressTimer(
      model.phase === 'fulfilling'
        && model.completeDots < RNG_CONFIRMATION_BUBBLES - 1
        && _rngProgressStartedAt(item) > 0,
    );
    const requestable = model.requestable && this.#busyId == null;
    const stateLabel = requestable
      ? 'REQUEST'
      : ['requesting', 'request-confirmed', 'fulfilling'].includes(model.phase)
        ? 'INCOMING'
        : ['queued', 'queue-ready'].includes(model.phase)
          ? 'WAITING'
          : model.phase === 'fulfilled'
            ? 'READY'
          : '';
    this.#rngItem = requestable ? item : null;
    lane.hidden = false;
    lane.setAttribute('data-rng-phase', model.phase);
    lane.setAttribute('data-rng-mode', model.mode);
    if (lane.style?.setProperty) {
      lane.style.setProperty('--rrt-rng-progress-color', model.color?.solid || '#22c55e');
      lane.style.setProperty('--rrt-rng-progress-edge', model.color?.edge || '#86efac');
      lane.style.setProperty('--rrt-rng-progress-glow', model.color?.glow || 'rgba(34, 197, 94, 0.72)');
    } else if (lane.style) {
      lane.style['--rrt-rng-progress-color'] = model.color?.solid || '#22c55e';
      lane.style['--rrt-rng-progress-edge'] = model.color?.edge || '#86efac';
      lane.style['--rrt-rng-progress-glow'] = model.color?.glow || 'rgba(34, 197, 94, 0.72)';
    }
    request.className = [
      'rrt-rng__request',
      model.logoLit ? 'is-lit' : '',
      requestable ? 'is-requestable' : '',
      model.phase === 'requesting' ? 'is-requesting' : '',
      this.#rngRequestFlashActive ? 'is-request-complete' : '',
      stateLabel ? 'has-state' : '',
      stateLabel ? `is-state-${stateLabel.toLowerCase()}` : '',
    ].filter(Boolean).join(' ');
    request.disabled = !requestable;
    request.setAttribute('aria-label', requestable ? 'Request shared RNG' : model.status);
    request.setAttribute('data-rng-button-state', stateLabel.toLowerCase());
    if (flow) flow.setAttribute('aria-label', model.status);
    if (status) status.textContent = model.status.toUpperCase();
    if (art) {
      const artState = stateLabel.toLowerCase() || 'idle';
      art.setAttribute('src', RNG_ART_PATHS[artState] || RNG_ART_PATHS.idle);
    }

    const steps = this.querySelectorAll('.rrt-rng__step');
    steps.forEach((step, index) => {
      if (!step) return;
      const complete = index >= steps.length - model.completeDots;
      step.className = `rrt-rng__step${complete ? ' is-complete' : ''}`;
    });
  }

  #render() {
    const tray = this.querySelector('[data-bind="rrt-tray"]');
    const host = this.querySelector('[data-bind="rrt-actions"]');
    const clear = this.querySelector('[data-bind="rrt-clear"]');
    const hide = this.querySelector('[data-bind="rrt-hide"]');
    const pendingDetails = this.querySelector('[data-bind="rrt-pending-details"]');
    if (!tray || !host) return;
    const items = this.#items;
    const hiddenByUser = this.#hiddenFingerprint != null
      && this.#hiddenFingerprint === _manifestFingerprint(items);
    const actionItems = items.filter((item) => !_isRngLaneOnly(item));
    const pendingVisible = actionItems.length > 0 && !hiddenByUser;
    const rngItems = items.filter(_isRngLifecycle);
    const pendingRngItem = rngItems.reduce((best, candidate) => (
      !best || _rngPriority(candidate) > _rngPriority(best) ? candidate : best
    ), null);
    const playerWaitsOnSharedRng = rngItems.some((item) => (
      _usesSharedRngQueue(item)
      && ['awaitingRng', 'request-ready', 'requesting-rng', 'waiting-rng']
        .includes(String(item?.phase || ''))
    ));
    const publisherRngInFlight = rngItems.some((item) => (
      ['requesting-rng', 'waiting-rng'].includes(String(item?.phase || ''))
    ));
    const requestInFlight = publisherRngInFlight
      || Boolean(this.#rngQueueState?.middayRequestInFlight)
      || (this.#jackpotPhase && this.#jackpotRngInFlight);
    const hasNonTicketPanelReason = pendingVisible
      && actionItems.some((item) => item?.kind !== 'tickets');
    const hasPlayerRngWork = pendingRngItem != null;
    const relevantRequestInFlight = (this.#jackpotPhase && this.#jackpotRngInFlight)
      || (requestInFlight && playerWaitsOnSharedRng)
      || (publisherRngInFlight && hasPlayerRngWork);
    const rngVisible = (hasPlayerRngWork && hasNonTicketPanelReason)
      || relevantRequestInFlight;

    tray.hidden = false;
    tray.setAttribute('data-has-pending', pendingVisible ? 'true' : 'false');
    tray.setAttribute('data-has-rng', rngVisible ? 'true' : 'false');
    tray.setAttribute(
      'aria-label',
      pendingVisible ? 'Actions ready' : rngVisible ? 'Chainlink RNG status' : 'No pending actions',
    );
    host.textContent = '';

    const displayRngItem = this.#rngDisplayItem(pendingRngItem);
    const rngItem = displayRngItem
      ? { ...displayRngItem, rngHasWaitingItem: Boolean(pendingRngItem) }
      : displayRngItem;
    this.#renderRng(rngItem);
    const rngLane = this.querySelector('[data-bind="rrt-rng"]');
    if (rngLane) rngLane.hidden = !rngVisible;

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

    for (const item of actionItems) {
      const localBusy = this.#busyId === item.id;
      const busy = item.state === 'busy' || localBusy;
      const waiting = item.state === 'waiting';
      const rngWaiting = _isRngWaiting(item);
      const resultReady = item.kind === 'degenerette' && item.phase === 'result-ready';
      // The amount + spin receipt is sufficient in every Degenerette state.
      // Keep even a ready result compact; the lit card itself is the action and
      // does not need a trailing VIEW label.
      const compactDegenerette = item.kind === 'degenerette';
      const compactFoilMatch = item.kind === 'foil-match';
      const compactDecimator = item.kind === 'decimator';
      const compact = item.compact === true || compactDegenerette || compactFoilMatch
        || compactDecimator;
      const compactLootbox = item.kind === 'lootbox' && item.compact === true;
      const autoArmed = compactLootbox && this.#autoOpen && item.autoOpen === true && !busy;
      const waitingFeedback = compactLootbox && waiting && !busy;
      const passive = item.passive === true;
      const ticketOpenReady = item.kind === 'tickets'
        && item.state === 'ready'
        && !localBusy
        && !clearingAll
        && !passive
        && typeof item.run === 'function';
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
        compactLootbox ? 'rrt-action--lootbox-summary' : '',
        autoArmed ? 'is-auto-armed' : '',
        waitingFeedback ? 'is-status-clickable' : '',
        ticketOpenReady ? 'rrt-action--ticket-ready' : '',
        passive ? 'rrt-action--passive' : '',
        passive && item.kind === 'tickets' ? 'rrt-action--pack-pending' : '',
        canInspectPending ? 'rrt-action--inspectable' : '',
      ].filter(Boolean).join(' ');
      const rngButtonOwnsRequest = item.kind === 'degenerette' && item.phase === 'request-ready';
      const domainLocked = busy || waiting || clearingAll
        || rngButtonOwnsRequest || typeof item.run !== 'function';
      button.disabled = canInspectPending ? false : domainLocked && !waitingFeedback;
      if (passive && !canInspectPending) {
        button.setAttribute('role', 'status');
        button.setAttribute('aria-disabled', 'true');
      } else if (canInspectPending) {
        button.setAttribute('aria-controls', 'rrt-pending-details');
        button.setAttribute('aria-expanded', String(this.#expandedPendingId === item.id));
      }
      if (item.write === true && !waitingFeedback) {
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
      if (item.kind === 'lootbox') {
        button.setAttribute(
          'data-lootbox-value-tone',
          item.lootboxValueTone || 'unknown',
        );
      }
      const actionVerb = _actionVerb(item, { busy, waiting });
      button.setAttribute('aria-label', compact
        ? canInspectPending
          ? `Show ${String(item.label || 'pending tickets')}`
          : compactDegenerette
            ? degenerettePendingSummary(item).text
            : compactFoilMatch
              ? foilMatchPendingSummary(item).text
            : compactLootbox
              ? lootboxPendingSummary(item).text
            : compactDecimator
              ? _compactActionLabel(item)
            : _luckboxUiText(item.label || item.shortLabel || 'Open')
        : _luckboxUiText(`${actionVerb}: ${item.label}${item.detail ? `. ${item.detail}` : ''}`));
      button.title = `${compactFoilMatch
        ? foilMatchPendingSummary(item).text
        : compactLootbox ? lootboxPendingSummary(item).text
        : _luckboxUiText(`${item.label}${item.detail ? ` · ${item.detail}` : ''}`)}`
        + (item.lootboxTicketUnitsLabel ? ` · ${item.lootboxTicketUnitsLabel} ticket price` : '');

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
      } else if (compactFoilMatch) {
        // The full match comparison belongs in the reveal. Pending is only a
        // terse transaction receipt, so it intentionally has no leading art.
      } else if (item.kind === 'tickets' && passive) {
        const pack = document.createElement('span');
        pack.className = 'rvl-pack rrt-pending-pack-art';
        const brand = document.createElement('span');
        brand.className = 'rvl-pack-brand';
        const logo = document.createElement('img');
        logo.className = 'rvl-pack-logo';
        logo.src = '/whitepaper/flame-logo.svg';
        logo.alt = '';
        const edition = document.createElement('span');
        edition.className = 'rvl-pack-edition';
        edition.textContent = 'TICKET PACK';
        brand.appendChild(logo);
        brand.appendChild(edition);
        pack.appendChild(brand);
        art.appendChild(pack);
      } else if (item.kind === 'tickets') {
        // Keep the tear-pack silhouette, but do not miniaturize the full reveal
        // wrapper into unreadable plaque copy. At this size the useful face is
        // the FLAME, abbreviated level, and physical ticket count.
        const pack = document.createElement('span');
        pack.className = 'rvl-pack rrt-pack-art';
        const brand = document.createElement('span');
        brand.className = 'rvl-pack-brand';
        const logo = document.createElement('img');
        logo.className = 'rvl-pack-logo';
        logo.src = '/whitepaper/flame-logo.svg';
        logo.alt = '';
        brand.appendChild(logo);
        pack.appendChild(brand);
        const meta = _ticketPackMeta(item);
        const level = document.createElement('span');
        level.className = 'rvl-pack-level rrt-pack-level';
        level.textContent = meta.level == null ? 'L—' : `L${meta.level}`;
        const packTone = applyTicketLevelTone(level, meta.level);
        pack.setAttribute('data-pack-level-tone', packTone || 'unknown');
        const quantity = document.createElement('span');
        quantity.className = 'rvl-pack-count rrt-pack-count';
        quantity.textContent = meta.count == null
          ? '— TIX'
          : `${meta.count} TIX`;
        pack.appendChild(level);
        pack.appendChild(quantity);
        art.appendChild(pack);
      } else if (compactLootbox) {
        const box = document.createElement('span');
        box.className = 'rrt-lootbox-mini';
        box.setAttribute('data-lootbox-value-tone', item.lootboxValueTone || 'unknown');
        box.setAttribute('aria-hidden', 'true');
        art.appendChild(box);
      } else if (item.kind === 'decimator') {
        const logo = document.createElement('img');
        logo.className = 'rrt-decimator-mark';
        logo.src = '/app/assets/decimator-draw-mark.svg';
        logo.alt = '';
        art.appendChild(logo);
      } else if (item.icon) {
        const logo = document.createElement('img');
        logo.src = item.icon;
        logo.alt = '';
        art.appendChild(logo);
      } else {
        if (!_appendLineIcon(art, item.kind)) {
          const logo = document.createElement('img');
          logo.className = 'rrt-action__fallback-logo';
          logo.src = '/whitepaper/flame-logo.svg';
          logo.alt = '';
          art.appendChild(logo);
        }
      }

      const copy = document.createElement('span');
      copy.className = 'rrt-action__copy';
      const label = document.createElement('strong');
      label.className = 'rrt-action__label';
      if (compactDegenerette) {
        _appendDegenerettePendingLabel(label, item);
      } else if (compactDecimator) {
        _appendDecimatorPendingLabel(label, item);
      } else if (compactFoilMatch) {
        _appendFoilMatchPendingLabel(label, item);
      } else if (compactLootbox) {
        _appendLootboxPendingLabel(label, item);
      } else if (compact && passive && item.kind === 'tickets') {
        const meta = _ticketPackMeta(item);
        // Keep the receipt terse. Level-by-level identity belongs to the
        // dropdown preview rather than the always-visible Pending chip.
        _appendTicketActionLabel(label, meta, { passive: true });
      } else if (item.kind === 'tickets'
        && _appendTicketActionLabel(label, _ticketPackMeta(item))) {
        // The shared builder isolates the level token so its threat color does
        // not paint the ticket quantity or action copy.
      } else {
        label.textContent = _compactActionLabel(item);
      }
      if (compact) {
        copy.appendChild(label);
      } else {
        const kind = document.createElement('span');
        kind.className = 'rrt-action__kind';
        kind.textContent = _luckboxUiText(item.kindLabel || _kindLabel(item.kind));
        const detail = document.createElement('span');
        detail.className = 'rrt-action__detail';
        detail.textContent = abbreviatePendingTokenAmounts(_luckboxUiText(item.detail));
        copy.appendChild(kind);
        copy.appendChild(label);
        copy.appendChild(detail);
      }
      if (autoArmed) {
        const cue = document.createElement('span');
        cue.className = 'rrt-auto-armed';
        cue.textContent = item.state === 'ready' ? 'AUTO-OPEN ARMED' : 'AUTO-OPEN WHEN READY';
        copy.appendChild(cue);
      }
      const ownsRngLane = pendingRngItem != null
        && item.id === pendingRngItem.id
        && item.source === pendingRngItem.source;
      if (!compact && item.progress === 'indeterminate' && !ownsRngLane) {
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
      cta.textContent = actionVerb;

      if ((!passive || item.kind === 'tickets') && !compactFoilMatch) {
        button.appendChild(art);
      }
      button.appendChild(copy);
      if (!compact && !passive && !ticketOpenReady) button.appendChild(cta);
      if (waitingFeedback) {
        button.addEventListener('click', () => this.#showError(
          autoArmed
            ? 'Auto-open is armed. No click is needed.'
            : item.phase === 'submitting'
              ? 'Transaction is still confirming. No click is needed yet.'
              : item.phase === 'indexing'
                ? 'Reward claimed. The reveal will open when it finishes loading.'
              : 'Waiting for RNG. This will light up when it needs you.',
        ));
      } else if (!passive && !button.disabled) {
        button.addEventListener('click', () => this.#run(item));
      }
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
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rrt-pending-details__close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close pending ticket details');
    close.addEventListener('click', () => {
      this.#expandedPendingId = null;
      this.#render();
    });
    host.appendChild(close);

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
      const packTone = applyTicketLevelTone(level, pendingPack.level);
      pack.setAttribute('data-pack-level-tone', packTone || 'unknown');
      const quantity = document.createElement('span');
      quantity.className = 'rvl-pack-count';
      quantity.textContent = _ticketQuantityText(pendingPack.count);
      pack.appendChild(shine);
      pack.appendChild(brand);
      pack.appendChild(level);
      pack.appendChild(quantity);
      const caption = document.createElement('span');
      caption.className = 'rrt-pending-pack-preview__caption';
      tile.appendChild(pack);
      // The wrapper already says its level and exact ticket quantity. Keep an
      // ordinal only when several physical packs share the dropdown; the
      // enclosing Pending surface already explains their unresolved state.
      if (packs.length > 1) {
        caption.textContent = `PACK ${pendingPack.packIndex} OF ${pendingPack.packCount}`;
        tile.appendChild(caption);
      }
      list.appendChild(tile);
    }
    host.appendChild(list);
  }

  #showError(message) {
    const error = this.querySelector('[data-bind="rrt-error"]');
    if (!error) return;
    error.textContent = String(message || 'Could not complete this action.');
    error.hidden = false;
    this.querySelector('[data-bind="rrt-stage"]')?.setAttribute?.('data-has-error', 'true');
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
    this.querySelector('[data-bind="rrt-stage"]')?.setAttribute?.('data-has-error', 'false');
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
