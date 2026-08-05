// /app/components/app-degenerette-panel.js — Phase 62 Plan 62-03 (BUY-05)
//
// Degenerette two-tx bet panel: place → poll RNG → resolve. Custom Element
// shell mirrors Phase 60 / 61 / 62-01 / 62-02 patterns: light DOM, idempotent
// customElements.define, symmetric connectedCallback / disconnectedCallback,
// #unsubs[], panel-owned 30s poll cycle PLUS a per-bet RNG poll subcycle.
//
// On-chain surfaces (RESEARCH R5):
//   - DegenerusGame.placeDegeneretteBet(player, currency, amountPerTicket,
//                                       ticketCount, customTicket, heroQuadrant)
//                                       payable
//                                       → emits BetPlaced(player, index, betId, packed)
//   - poll the indexed Degenerette feed for lootbox_rng readiness + word
//                    (RESEARCH R5 OPTION B). The word is KEPT: every spin's
//                    house reel is derived from it (dgn-reels.js).
//   - DegenerusGame.resolveDegeneretteBets(player, betIds[])
//                                       → emits DegeneretteResolved + per-spin
//                                          DegeneretteResult
//
// Two-stage state machine:
//   idle → placing → awaitingRng → ready → resolving → resolved
//                                                       ↓
//                                                       idle (on user "Place another")
//
// The widget owns ticket construction, wagering, pending-RNG state, and the
// permissionless resolve transaction. Every completed result is handed to the
// shared branded reveal overlay; there is deliberately no second reel player
// embedded in this panel.
//
// Carry-forwards (CONTEXT 62-CONTEXT.md):
//   CF-01: Phase 58 closure-form sendTx — flows through degenerette.js (place + resolve).
//   CF-02: Phase 56 reason-map decodeRevertReason on every catch.
//   CF-03: Phase 56 requireStaticCall pre-flight inside degenerette.js.
//   CF-05: receipt-log-first parsers (BetPlaced + DegeneretteResolved + DegeneretteResult).
//   CF-06: NEVER optimistic balance subtraction. 250ms post-confirm refetch.
//   CF-07: T-58-18 — error.userMessage rendered via .textContent.
//   CF-15: data-write attribute on Place; RNG/resolve writes are exposed only
//          through the shared pending-action tray.
//
// Class palette: .deg-* prefix.

import { CHAIN, ETH_DIVISOR } from '../app/chain-config.js';
import { displayEth, displayToken, displayTokenSnapped } from '../app/scaling.js';
import { get, subscribe, getViewedAddress, getActingAddress } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import {
  placeBet,
  canResolveBets,
  readBetInfo,
  readResolvedBet,
  resolveCommunityBets,
  parseBetPlacedFromReceipt,
  parseBetResolvedFromReceipt,
  parseSpinResultsFromReceipt,
  degeneretteLimits,
  degenerettePayoutTable,
} from '../app/degenerette.js';
import {
  scaledTicketPriceWei,
  canRequestLootboxRng,
  requestLootboxRng,
  readPurchaseFundingPriority,
} from '../app/lootbox.js';
import {
  enrichLootboxBoonLegs,
  openLegsFromDegenerettePayouts,
  parseOpenLegsFromReceipt,
} from '../app/lootbox-legs.js';
import { recordLootboxTicketPacks } from '../app/pack-watch.js';
import { compactUiError } from '../app/ui-error.js';
import {
  readDegeneretteBetSize,
  writeDegeneretteBetSize,
} from '../app/degenerette-preferences.js';
import { readDeityPassCatalog } from '../app/passes.js';
import {
  buildAffiliateUrl,
  createAffiliateCode,
  defaultCodeForAddress,
  formatPurchaseAffiliateCode,
  readRegisteredCode,
  resolveRegisteredCode,
} from '../app/affiliate.js';
// Shared trait codecs (extracted from this file — see dgn-traits.js header).
import {
  DGN_QUADRANTS, DGN_SYMBOLS, DGN_COLORS, DGN_COLOR_HEX,
  applyDgnTicketAccent,
  DGN_TICKET_COPY_EVENT,
  dgnBadgePath, dgnSymbolPath, dgnUnpackTicket, dgnComputeMatches,
  dgnScoringMatchStates, dgnTraitIdsToQuadrants,
  dgnReconstructTicketTraits,
} from '../app/dgn-traits.js';
// Per-spin house reels: the chain publishes spin 0's only.
import { dgnDeriveSpins, dgnScore } from '../app/dgn-reels.js';
import { publishPendingActions, clearPendingActions } from '../app/pending-actions.js';
import { queueReveal } from './reveal-overlay.js';

function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

// Clipboard API calls must happen during the original click's transient user
// activation. This fallback uses a real, temporarily mounted field instead of
// the referral dialog input, which may be hidden when the main card is used.
function _copyTextFallback(text) {
  if (typeof document === 'undefined'
    || !document.body
    || typeof document.createElement !== 'function'
    || typeof document.execCommand !== 'function') return false;
  const previousFocus = document.activeElement;
  let field = null;
  try {
    field = document.createElement('textarea');
    field.value = String(text || '');
    field.setAttribute('readonly', '');
    field.setAttribute('aria-hidden', 'true');
    Object.assign(field.style, {
      position: 'fixed',
      top: '0',
      left: '-9999px',
      width: '1px',
      height: '1px',
      opacity: '0.01',
      pointerEvents: 'none',
    });
    document.body.appendChild(field);
    field.focus?.({ preventScroll: true });
    field.select?.();
    field.setSelectionRange?.(0, field.value.length);
    return Boolean(document.execCommand('copy'));
  } catch (_e) {
    return false;
  } finally {
    field?.remove?.();
    try { previousFocus?.focus?.({ preventScroll: true }); } catch (_e) { /* defensive */ }
  }
}

const POLL_INTERVAL_MS = 30_000;          // panel-owned 30s poll for /player snapshot.
const RNG_POLL_INTERVAL_MS = 7_000;       // 7s per-bet RNG poll cadence.
const POST_CONFIRM_REFETCH_MS = 250;      // CF-06.
// A mined request is stronger evidence than an immediately-following
// requestable static call from a lagging/load-balanced RPC. Hold the receipt
// state long enough for every reader to catch up before allowing a retry.
const RNG_REQUEST_RECEIPT_GRACE_MS = 30_000;
const ERROR_AUTO_CLEAR_MS = 10_000;       // 10s.
const DEBOUNCE_MS = 500;                  // 500ms click debounce window.
const PENDING_SOURCE = 'degenerette';
const COMMUNITY_MAX_BETS = 8;
const COMMUNITY_MAX_SPINS = 30;
const INDEX_REPLAY_RETRIES = 3;
const INDEX_REPLAY_DELAY_MS = 650;
const PLAYER_FEED_MAX_PAGES = 20;
const DEFAULT_ETH_BET_WEI = (10n ** 16n) / BigInt(ETH_DIVISOR); // 0.01 displayed ETH
const DEFAULT_FLIP_BET = '250';
const DEFAULT_WWXRP_BET = '1';
const DEGENERETTE_TOKEN_SCALE = 10n ** 18n;

/** Parse the player-facing decimal without crossing through lossy Number math. */
export function parseDegeneretteAmountInput(value, currency) {
  const match = /^\s*(\d+)(?:\.(\d{0,18}))?\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  try {
    const fraction = (match[2] || '').padEnd(18, '0');
    const fullScale = (BigInt(match[1]) * DEGENERETTE_TOKEN_SCALE)
      + BigInt(fraction || '0');
    return Number(currency) === 0 ? fullScale / BigInt(ETH_DIVISOR) : fullScale;
  } catch (_e) {
    return null;
  }
}

function _degeneretteGoldTicket(goldTraits) {
  const count = Math.max(0, Math.min(4, Math.floor(Number(goldTraits) || 0)));
  let ticket = 0n;
  for (let quadrant = 0; quadrant < count; quadrant += 1) {
    ticket |= 7n << BigInt(quadrant * 8 + 3);
  }
  return ticket;
}

function _formatBaseCentiX(value) {
  const cents = BigInt(value ?? 0);
  const whole = cents / 100n;
  const fraction = cents % 100n;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (fraction === 0n) return `${grouped}×`;
  return `${grouped}.${fraction.toString().padStart(2, '0').replace(/0$/, '')}×`;
}

export function degeneretteBasePayoutTables() {
  return Array.from({ length: 5 }, (_, goldTraits) => {
    const customTicket = _degeneretteGoldTicket(goldTraits);
    const heroGold = 0;
    const heroNotGold = goldTraits < 4 ? goldTraits : 0;
    const honestHeroGold = degenerettePayoutTable({
      customTicket, heroQuadrant: heroGold, currency: 0, activityScore: 0,
    }).rows;
    const honestHeroOther = degenerettePayoutTable({
      customTicket, heroQuadrant: heroNotGold, currency: 0, activityScore: 0,
    }).rows;
    return Object.freeze({
      goldTraits,
      heroMatters: goldTraits > 0 && goldTraits < 4,
      rows: Object.freeze(honestHeroGold.map((row, score) => Object.freeze({
        score,
        honestHeroGold: row.basePayoutCentiX,
        honestHeroOther: honestHeroOther[score].basePayoutCentiX,
      }))),
    });
  });
}

// Two-stage state machine (RESEARCH R5).
const STATE = Object.freeze({
  IDLE: 'idle',
  PLACING: 'placing',
  AWAITING_RNG: 'awaitingRng',
  REQUESTING_RNG: 'requestingRng',
  READY: 'ready',
  RESOLVING: 'resolving',
  INDEXING: 'indexing',
  RESOLVED: 'resolved',
});

const STATE_LABELS = Object.freeze({
  idle: '',
  placing: 'Placing…',
  awaitingRng: 'Awaiting RNG…',
  requestingRng: 'Requesting RNG…',
  ready: 'Ready to resolve.',
  resolving: 'Resolving…',
  indexing: 'Loading spins…',
  resolved: 'Resolved.',
});

export function pendingDegeneretteKey(address) {
  // Bet ids and queue indexes restart on every deployment. Chain id alone is
  // therefore not a safe namespace on testnet: an old run can leave a valid-
  // looking local row that can never resolve against the replacement GAME.
  return `pending-degenerette:${CHAIN.id}:${CHAIN.deployBlock}:${String(address || '').toLowerCase()}`;
}

function _legacyPendingDegeneretteKey(address) {
  return `pending-degenerette:${CHAIN.id}:${String(address || '').toLowerCase()}`;
}

function _readPendingBet(address) {
  if (!address || typeof localStorage === 'undefined') return null;
  try {
    // Pre-deployment-scoped records are ambiguous by construction. The DB +
    // current GAME slot can recover a genuinely live bet below, so remove the
    // legacy reminder instead of ever presenting it as current work.
    localStorage.removeItem(_legacyPendingDegeneretteKey(address));
    const raw = localStorage.getItem(pendingDegeneretteKey(address));
    const row = raw ? JSON.parse(raw) : null;
    if (!row || row.betId == null || row.index == null) return null;
    return {
      betId: BigInt(row.betId),
      index: BigInt(row.index),
      currency: Number(row.currency ?? 0),
      amountPerSpin: BigInt(row.amountPerSpin ?? 0),
      spinCount: Math.max(1, Number(row.spinCount ?? 1)),
      hero: Number(row.hero ?? 0) & 3,
      ticket: row.ticket == null ? null : BigInt(row.ticket),
      rngRequestPending: Boolean(row.rngRequestPending),
      rngRequestStartedAt: Math.max(0, Number(row.rngRequestStartedAt ?? 0)),
    };
  } catch (_e) {
    return null;
  }
}

function _writePendingBet(address, row) {
  if (!address || typeof localStorage === 'undefined') return;
  try {
    const key = pendingDegeneretteKey(address);
    if (!row) {
      localStorage.removeItem(key);
      return;
    }
    const payload = {
      betId: String(row.betId),
      index: String(row.index),
      currency: Number(row.currency ?? 0),
      amountPerSpin: String(row.amountPerSpin ?? 0),
      spinCount: Number(row.spinCount ?? 1),
      hero: Number(row.hero ?? 0) & 3,
    };
    if (row.ticket != null) payload.ticket = String(row.ticket);
    // Keep old pending-bet records compact, but persist a submitted shared RNG
    // request so its tray card survives a refresh until the word is ready.
    if (row.rngRequestPending) {
      payload.rngRequestPending = true;
      payload.rngRequestStartedAt = Math.max(0, Number(row.rngRequestStartedAt ?? Date.now()));
    }
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (_e) { /* private mode: session state still works */ }
}

// ---------------------------------------------------------------------------
// Ticket-picker constants + trait codecs (task #11) — canonical tables live in
// app/app/dgn-traits.js now (shared with the reveal overlay's box-spin reels;
// duplicated decoders are how the f47f106 bit-swap bug shipped).
//
// Canonical trait byte is [QQ][CCC][SSS]: color = bits 5:3, symbol = bits 2:0.
// The QQ bits are IGNORED on the customTicket send path — the contract derives
// quadrant from byte position and masks each byte with &7 / >>3&7
// (DegenerusGameDegeneretteModule.sol:637, :1099-1102) — so the packer leaves
// them 0. Result tickets decode the same low 6 bits per byte.
// ---------------------------------------------------------------------------

// v75 BetPlaced.packed layout (DegeneretteModule:377-398 repack; the indexer's
// degenerette-feed route mirrors it): customTraits[0..31], spinCount[32..39],
// currency[40..41], amountPerSpin[42..169], heroQuadrant[218..219].
// (The pre-v75 layout — hero at 238 — is what app-compact still decodes; STALE.)
const DGN_MASK128 = (1n << 128n) - 1n;
export function dgnDecodePacked(packedStr) {
  let p = 0n;
  try { p = BigInt(packedStr ?? 0); } catch (_e) { return null; }
  return {
    customTicket: p & 0xFFFFFFFFn,
    spinCount: Number((p >> 32n) & 0xFFn),
    currency: Number((p >> 40n) & 0x3n),
    amountPerSpin: (p >> 42n) & DGN_MASK128,
    heroQuadrant: Number((p >> 218n) & 0x3n),
  };
}

function _degeneretteResultKey(row, fallbackIndex) {
  const type = String(row?.resultType || 'unknown');
  const data = row?.resultData || {};
  if (type === 'result') {
    const spin = data.spinIndex ?? data.ticketIndex;
    if (spin != null) return `${type}:spin:${String(spin)}`;
  }
  if (type === 'resolved') return `${type}:summary`;
  const tx = row?.transactionHash ?? '';
  const log = row?.logIndex ?? '';
  if (tx || log !== '') return `${type}:${String(tx)}:${String(log)}`;
  try { return `${type}:data:${JSON.stringify(data)}:${String(row?.payout ?? '')}`; }
  catch (_e) { return `${type}:row:${fallbackIndex}`; }
}

/**
 * The API normally emits one item per bet, but an indexer/page transition can
 * briefly surface more than one fragment for the same player+betId. Merge
 * those fragments before deciding which spins exist so a late spin cannot be
 * dropped merely because the summary arrived in a different item.
 */
export function mergeDegeneretteFeedItems(items) {
  const groups = new Map();
  let anonymous = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const player = String(item?.player || '').toLowerCase();
    const betId = item?.betId;
    const key = player && betId != null
      ? `${player}:${String(betId)}`
      : `anonymous:${anonymous++}`;
    let merged = groups.get(key);
    if (!merged) {
      merged = { ...item, results: [], resultTickets: [], lootboxPayouts: [] };
      merged.__results = new Map();
      merged.__tickets = new Map();
      merged.__lootboxPayouts = new Map();
      groups.set(key, merged);
    } else {
      // Prefer whichever fragment has the concrete placement/replay fields.
      for (const field of [
        'id', 'player', 'betIndex', 'betId', 'packedData', 'blockNumber',
        'transactionHash', 'logIndex', 'rngReady', 'rngWord',
      ]) {
        if (merged[field] == null && item?.[field] != null) merged[field] = item[field];
      }
    }
    const rows = Array.isArray(item?.results) ? item.results : [];
    rows.forEach((row, i) => {
      const resultKey = _degeneretteResultKey(row, i);
      const prior = merged.__results.get(resultKey);
      // A later projection can contain more complete resultData, so retain it.
      if (!prior) {
        merged.__results.set(resultKey, row);
      } else {
        const next = {
          ...prior,
          ...row,
          resultData: {
            ...(prior?.resultData || {}),
            ...(row?.resultData || {}),
          },
        };
        for (const field of ['payout', 'blockNumber', 'transactionHash', 'logIndex']) {
          if (next[field] == null && prior[field] != null) next[field] = prior[field];
        }
        merged.__results.set(resultKey, next);
      }
    });
    const tickets = Array.isArray(item?.resultTickets) ? item.resultTickets : [];
    tickets.forEach((ticket, i) => {
      const spin = ticket?.spinIndex ?? ticket?.spinIdx ?? i;
      merged.__tickets.set(String(spin), ticket);
    });
    const lootboxPayouts = Array.isArray(item?.lootboxPayouts) ? item.lootboxPayouts : [];
    lootboxPayouts.forEach((payout, i) => {
      let payload = '';
      try { payload = JSON.stringify(payout?.rewardData ?? null); } catch (_e) { payload = String(i); }
      const payoutKey = [payout?.blockNumber, payout?.rewardType, payload].join(':');
      merged.__lootboxPayouts.set(payoutKey, payout);
    });
  }
  return Array.from(groups.values()).map((merged) => {
    merged.results = Array.from(merged.__results.values());
    merged.resultTickets = Array.from(merged.__tickets.values());
    merged.lootboxPayouts = Array.from(merged.__lootboxPayouts.values());
    delete merged.__results;
    delete merged.__tickets;
    delete merged.__lootboxPayouts;
    return merged;
  });
}

/**
 * Canonicalise the per-spin events and prove that indexes 0..N-1 all exist.
 * A resolved summary and its individual DegeneretteResult rows can reach an
 * API worker in separate projections. Animation must never interpret that
 * transient state as a shorter round.
 */
export function normalizeDegeneretteSpinResults(
  spinResults,
  expectedSpinCount,
  { player = null, betId = null } = {},
) {
  let expected = 1;
  try { expected = Math.max(1, Math.min(255, Number(BigInt(expectedSpinCount ?? 1)))); }
  catch (_e) { expected = 1; }

  const bySpin = new Map();
  for (const source of Array.isArray(spinResults) ? spinResults : []) {
    const data = source?.resultData || source || {};
    const rawIndex = data.spinIndex ?? data.ticketIndex;
    const rawPlayerTraits = data.playerTraits ?? data.playerTicket;
    if (rawIndex == null || rawPlayerTraits == null) continue;
    let spinIndex;
    let playerTraits;
    let matches;
    let payout;
    try {
      spinIndex = Number(BigInt(rawIndex));
      playerTraits = BigInt(rawPlayerTraits);
      matches = BigInt(data.matches ?? 0);
      payout = BigInt(source?.payout ?? data.payout ?? 0);
    } catch (_e) {
      continue;
    }
    if (!Number.isInteger(spinIndex) || spinIndex < 0 || spinIndex >= expected) continue;
    let rowBetId = betId;
    try {
      if (source?.betId != null || data.betId != null) {
        rowBetId = BigInt(source?.betId ?? data.betId);
      } else if (betId != null) {
        rowBetId = BigInt(betId);
      }
    } catch (_e) { rowBetId = betId; }
    bySpin.set(spinIndex, {
      player: String(source?.player ?? data.player ?? player ?? ''),
      betId: rowBetId,
      spinIndex: BigInt(spinIndex),
      playerTraits,
      matches,
      payout,
    });
  }

  const missingSpinIndexes = [];
  for (let spin = 0; spin < expected; spin += 1) {
    if (!bySpin.has(spin)) missingSpinIndexes.push(spin);
  }
  return {
    expectedSpinCount: expected,
    complete: missingSpinIndexes.length === 0,
    missingSpinIndexes,
    spins: Array.from(bySpin.values()).sort((a, b) => Number(a.spinIndex - b.spinIndex)),
  };
}

/**
 * Build the one canonical presentation payload for a resolved Degenerette bet.
 * Receipt, indexed-feed, and exact chain-log recovery all pass through here so
 * the overlay can never receive a shortened round or reuse spin zero's reel for
 * later spins.
 */
export function buildDegeneretteRevealSequence({
  resolvedEntry,
  spinResults,
  resultTickets = [],
  rngWord = 0n,
  betIndex = 0,
  currency = 0,
  amountPerSpin = 0n,
  heroQuadrant = 0,
} = {}) {
  if (!resolvedEntry) return null;
  const complete = normalizeDegeneretteSpinResults(
    spinResults,
    resolvedEntry.spinCount ?? 1,
    { player: resolvedEntry.player, betId: resolvedEntry.betId },
  );
  if (!complete.complete) return null;

  const hero = Number(heroQuadrant) & 3;
  const resolvedTraits = resolvedEntry.resultTraits == null
    ? null
    : Number(resolvedEntry.resultTraits) >>> 0;
  const derived = dgnDeriveSpins({
    rngWord,
    index: Number(betIndex ?? 0),
    heroQuadrant: hero,
    currency: Number(currency),
    resolvedResultTraits: resolvedEntry.resultTraits,
    spins: complete.spins,
  });

  const projected = new Map();
  for (const ticket of Array.isArray(resultTickets) ? resultTickets : []) {
    const spinIndex = Number(ticket?.spinIndex ?? ticket?.spinIdx ?? 0);
    const raw = ticket?.resultTicket ?? ticket?.resultTraits
      ?? ticket?.houseTicket ?? ticket?.houseTraits;
    if (raw != null && Number.isInteger(spinIndex) && spinIndex >= 0) {
      projected.set(spinIndex, Number(raw) >>> 0);
    }
  }

  const rows = derived.rows.map((row) => {
    const projectedTraits = projected.get(row.spinIndex);
    if (projectedTraits == null) return row;
    const anchorOk = row.spinIndex !== 0
      || resolvedTraits == null
      || projectedTraits === resolvedTraits;
    const scoreOk = dgnScore(row.playerTraits, projectedTraits, hero) === row.score;
    return anchorOk && scoreOk ? { ...row, houseTraits: projectedTraits } : row;
  });

  // Even without a recoverable RNG word, the chain's published spin-zero reel
  // remains authoritative. Multi-spin rounds still wait for every other reel.
  if (!derived.verified) {
    const zero = rows.find((row) => row.spinIndex === 0);
    if (zero && resolvedTraits != null) zero.houseTraits = resolvedTraits;
  }
  const indexes = new Set(rows.map((row) => row.spinIndex));
  if (rows.length !== complete.expectedSpinCount
    || rows.some((row) => row.houseTraits == null)
    || Array.from({ length: complete.expectedSpinCount }, (_, i) => indexes.has(i)).some((ok) => !ok)) {
    return null;
  }

  let perSpin = 0n;
  let totalPayout = 0n;
  try { perSpin = BigInt(amountPerSpin ?? 0); } catch (_e) { perSpin = 0n; }
  try { totalPayout = BigInt(resolvedEntry.totalPayout ?? 0); } catch (_e) { totalPayout = 0n; }
  return {
    kind: 'degenerette',
    betId: resolvedEntry.betId == null ? null : String(resolvedEntry.betId),
    headline: resolvedEntry.betId == null ? null : `BET #${String(resolvedEntry.betId)}`,
    currency: Number(currency),
    heroIdx: hero,
    amountPerSpin: perSpin,
    totalWager: perSpin * BigInt(complete.expectedSpinCount),
    totalPayout,
    spinCount: complete.expectedSpinCount,
    spins: rows,
  };
}

/**
 * Rebuild a settled feed item into the exact reveal payload used by a live
 * receipt. Historical-day controllers use this instead of maintaining a
 * second, inevitably drifting Degenerette decoder.
 */
export function degeneretteRevealSequenceFromFeedItem(item) {
  const merged = mergeDegeneretteFeedItems(item == null ? [] : [item])[0];
  if (!merged) return null;
  const packed = dgnDecodePacked(merged.packedData);
  if (!packed) return null;
  const results = Array.isArray(merged.results) ? merged.results : [];
  const resolvedRow = results.find((row) => row?.resultType === 'resolved');
  if (!resolvedRow) return null;
  const data = resolvedRow.resultData || {};
  let resolvedEntry;
  try {
    resolvedEntry = {
      player: String(merged.player || data.player || ''),
      betId: BigInt(merged.betId ?? data.betId),
      spinCount: BigInt(data.spinCount ?? packed.spinCount ?? 1),
      totalPayout: BigInt(data.totalPayout ?? resolvedRow.payout ?? 0),
      resultTraits: BigInt(data.resultTraits ?? data.resultTicket ?? 0),
    };
  } catch (_e) {
    return null;
  }
  const sequence = buildDegeneretteRevealSequence({
    resolvedEntry,
    spinResults: results.filter((row) => row?.resultType === 'result'),
    resultTickets: merged.resultTickets,
    rngWord: merged.rngWord ?? 0,
    betIndex: merged.betIndex ?? 0,
    currency: packed.currency,
    amountPerSpin: packed.amountPerSpin,
    heroQuadrant: packed.heroQuadrant,
  });
  if (!sequence) return null;
  const lootboxLegs = openLegsFromDegenerettePayouts(merged.lootboxPayouts);
  sequence.lootboxAwarded = lootboxLegs.length > 0;
  sequence.lootboxLegs = lootboxLegs;
  sequence.lootboxEth = degeneretteLootboxEthFromLegs(lootboxLegs);
  return sequence;
}

/**
 * The first LootBoxOpened leg emitted by a Degenerette ETH settlement is the
 * recirculated part of that bet's gross payout. Any later opened legs can be
 * nested rewards produced while resolving that box and must not be counted a
 * second time as part of the original winnings split.
 */
export function degeneretteLootboxEthFromLegs(legs) {
  const opened = (Array.isArray(legs) ? legs : []).find((leg) => {
    if (leg?.legType !== 'opened') return false;
    try { return BigInt(leg?.amount ?? 0) > 0n; } catch (_e) { return false; }
  });
  if (!opened) return 0n;
  try { return BigInt(opened.amount ?? 0); } catch (_e) { return 0n; }
}

/**
 * Identity shared with app-box-strip's durable result ledger. Degenerette
 * settles its direct box at index zero, so the settlement transaction hash is
 * the only collision-free key. Carrying it into the reveal lets the overlay
 * suppress and then retire the strip's duplicate presentation action.
 */
export function degeneretteLootboxRelease(player, legs, fallbackTransactionHash = null) {
  const address = String(player || '').toLowerCase();
  const opened = (Array.isArray(legs) ? legs : []).find((leg) => leg?.legType === 'opened');
  if (!address || !opened) return null;
  let index;
  try { index = Number(BigInt(opened.lootboxIndex ?? 0)); } catch (_e) { return null; }
  const transactionHash = String(
    opened.transactionHash || fallbackTransactionHash || '',
  ).toLowerCase();
  const key = index === 0
    ? (transactionHash ? `tx:${transactionHash}` : '')
    : String(index);
  if (!key) return null;
  return {
    address,
    key,
    lootboxIndex: index,
    transactionHash: transactionHash || null,
  };
}

/**
 * Stable fallback while a just-mined API projection is missing its settlement
 * transaction metadata. One Degenerette bet can award at most one direct
 * lootbox presentation, so player + bet id collapses the receipt/indexer race
 * without merging rewards from different bets.
 */
export function degeneretteLootboxPresentationId(player, betId) {
  const address = String(player || '').toLowerCase();
  if (!address || betId == null || String(betId) === '') return null;
  return `degenerette-lootbox:${address}:${String(betId)}`;
}

/**
 * Read enough feed pages to obtain the viewed player's latest resolved bets.
 * Current API workers honour `player`; older workers ignore it and return a
 * global page. Client-side filtering plus the cursor makes both versions safe
 * during a rolling deploy instead of losing a player's round after 200 rows.
 */
export async function fetchDegenerettePlayerFeed(player, {
  betId = null,
  targetResolved = 12,
  maxPages = PLAYER_FEED_MAX_PAGES,
} = {}) {
  const owner = String(player || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(owner)) return [];
  const wantedBet = betId == null ? null : String(betId);
  const collected = [];
  const seenCursors = new Set();
  let before = null;

  for (let page = 0; page < Math.max(1, Number(maxPages) || 1); page += 1) {
    const cursor = before == null ? '' : `&before=${encodeURIComponent(String(before))}`;
    const response = await fetchJSON(
      `/degenerette/feed?limit=200&player=${encodeURIComponent(owner)}${cursor}`,
    );
    collected.push(...(Array.isArray(response?.items) ? response.items : []));
    const merged = mergeDegeneretteFeedItems(collected)
      .filter((item) => String(item?.player || '').toLowerCase() === owner);
    if (wantedBet != null && merged.some((item) => String(item?.betId) === wantedBet)) {
      return merged;
    }
    const resolvedCount = merged.filter((item) => (
      Array.isArray(item?.results)
      && item.results.some((row) => row?.resultType === 'resolved')
    )).length;
    if (wantedBet == null && resolvedCount >= Math.max(1, Number(targetResolved) || 1)) {
      return merged;
    }
    const next = response?.nextCursor;
    if (next == null || seenCursors.has(String(next))) return merged;
    seenCursors.add(String(next));
    before = next;
  }
  return mergeDegeneretteFeedItems(collected)
    .filter((item) => String(item?.player || '').toLowerCase() === owner);
}

/**
 * Pick the first complete upcoming-draw ticket carrying gold, falling back to
 * the first complete ticket. The returned shape matches the editor's {s,c}
 * state and makes the first gold quadrant Hero.
 */
export function selectDegeneretteDefaultTicket(payload) {
  const candidates = [];
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  for (const traitIds of dgnReconstructTicketTraits(cards)) {
    const quadrants = dgnTraitIdsToQuadrants(traitIds);
    if (!quadrants.every(Boolean)) continue;
    const goldAt = quadrants.findIndex((trait) => trait?.col === 7);
    candidates.push({
      cardIndex: candidates.length,
      hasGold: goldAt >= 0,
      hero: goldAt >= 0 ? goldAt : 0,
      traits: quadrants.map((trait) => ({ s: trait.sym, c: trait.col })),
    });
  }
  return candidates.find((ticket) => ticket.hasGold) || candidates[0] || null;
}

export function degeneretteDeitySymbolForOwner(catalog, owner) {
  const address = String(owner || '').toLowerCase();
  if (!address || !(catalog?.ownersBySymbol instanceof Map)) return null;
  for (const [symbolId, symbolOwner] of catalog.ownersBySymbol.entries()) {
    const id = Number(symbolId);
    if (String(symbolOwner || '').toLowerCase() === address
      && Number.isInteger(id)
      && id >= 0
      && id < 32) {
      return id;
    }
  }
  return null;
}

class AppDegenerettePanel extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #busyPlace = false;
  #busyResolve = false;
  #errorTimer = null;
  // Panel-owned 30s poll lifecycle.
  #pollHandle = null;
  #pollController = null;
  #lastPollAt = 0;
  #visibilityListener = null;
  // Per-bet RNG poll cycle (T-62-03-07 mitigation).
  #rngPollAbort = null;
  #rngPollTimer = null;
  // Bet state.
  #state = STATE.IDLE;
  #currentBetId = null;
  #currentLootboxIndex = null;
  #currentCurrency = 0;        // currency of the in-flight bet (payout display)
  #currentAmountPerSpin = 0n;  // raw chain units, retained for the result board
  #currentSpinCount = 0;       // retained so the reveal can show the full wager
  #draftCurrency = 0;          // selected setup currency; detects real switches
  // Receipt parsing is the fastest path, but a confirmed placement must remain
  // recoverable if a wallet/provider omits logs. The DB snapshot identifies the
  // pending bet and the indexed placement/on-chain slot restores its packed data.
  #pendingRecoverySeq = 0;
  #pendingRecoveryAddress = null;
  // A resolved bet is presentation work exactly once per mounted session.
  // Mark it before searching for another DB-pending row so a stale indexer
  // snapshot cannot send NEXT ACTION back into the result just consumed.
  #presentedBetKeys = new Set();
  // The RNG word the bet resolves against, kept from the poll that ended the
  // wait: every spin's house reel is derived from it and it is NOT readable
  // from the resolve receipt.
  #currentRngWord = 0n;
  #rngRequestAvailable = false;
  #rngRequestPending = false;
  #rngRequestStartedAt = 0;
  #currentHero = null;         // hero quadrant of the in-flight bet
  #currentTicket = null;       // exact submitted uint32 ticket for pending-card art
  #pendingAddress = null;
  #pickerContextKey = null;
  #defaultTicketKey = null;
  #pickerTouched = false;
  // Ticket-picker state (task #11): 4 × {s: symbol 0-7, c: color 0-7},
  // randomized per mount (app-compact behavior), hero quadrant. The editor is
  // closed until the player clicks a quadrant.
  #dgnTraits = [0, 1, 2, 3].map(() => ({
    s: Math.floor(Math.random() * 8),
    c: Math.floor(Math.random() * 8),
  }));
  #dgnHero = Math.floor(Math.random() * 4);
  #dgnEditing = null;
  // Legacy private state remains declared while the now-unmounted embedded
  // result implementation is retired below. No live path writes or renders it;
  // complete results go straight to reveal-overlay.
  #inlineBoard = null;
  #inlineNextSpin = 0;
  #inlineBusy = false;
  #inlineRunToken = 0;
  #inlineViewedSpin = null;
  #historyItems = [];
  #historyAddress = null;
  #historyFetchedAt = 0;
  #historySeq = 0;
  #resultsMode = false;
  #localResultReady = false;
  // Compact referral card + detail sheet. The affiliate module remains the
  // sole owner of code resolution/registration; this panel only presents it
  // at the bottom-right of the full Degenerette panel.
  #referralAddress = null;
  #referralCode = null;
  #referralUrl = '';
  #referralResolveSeq = 0;
  #referralBusy = false;
  #referralCopied = false;
  #referralCopyTimer = null;
  #referralDialogReturnFocus = null;
  #basicsDialogReturnFocus = null;
  #ticketCopyListener = (event) => this.#copyInventoryTicket(event?.detail);
  #questActivateListener = (event) => {
    const detail = event?.detail;
    const ready = this.#applyQuestPreset(detail);
    if (ready && detail?.submit) void this.#onPlaceClick();
  };

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#restoreBetPreference(this.#draftCurrency);
    this.#renderPayoutTables();
    this.#wireEventHandlers();
    this.#wireVisibilityRePoll();
    this.#wireStoreSubscriptions();
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener(DGN_TICKET_COPY_EVENT, this.#ticketCopyListener);
      document.addEventListener('quest:activate', this.#questActivateListener);
    }
    this.#startPolling();
    this.#restorePendingBet();
    this.#renderState();
    this.#renderCurrencyGate();
    this.#renderBetLimits();
    this.#refreshReferralLink();
    this.#runPollCycle();
  }

  disconnectedCallback() {
    this.#persistBetPreference(this.#draftCurrency);
    this.#pendingRecoverySeq += 1;
    this.#pendingRecoveryAddress = null;
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#pollController) {
      try { this.#pollController.abort(); } catch (_) { /* defensive */ }
      this.#pollController = null;
    }
    this.#cancelRngPoll();
    if (this.#visibilityListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('visibilitychange', this.#visibilityListener); }
      catch (_) { /* defensive */ }
    }
    this.#visibilityListener = null;
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener(DGN_TICKET_COPY_EVENT, this.#ticketCopyListener); }
      catch (_) { /* defensive */ }
      try { document.removeEventListener('quest:activate', this.#questActivateListener); }
      catch (_) { /* defensive */ }
    }
    clearPendingActions(PENDING_SOURCE);
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
      this.#errorTimer = null;
    }
    this.#referralResolveSeq += 1;
    if (this.#referralCopyTimer != null) {
      try { clearTimeout(this.#referralCopyTimer); } catch (_) { /* defensive */ }
      this.#referralCopyTimer = null;
    }
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
  }

  // ---------------------------------------------------------------------
  // Render shell — STATIC innerHTML.
  // Currency picker: ETH (0), FLIP (1), WWXRP (3) — the RESEARCH Q7
  // deferral that hid WWXRP is superseded (user ask 2026-07-03); the
  // contract + degenerette.js accepted currency 3 all along. Currency 2 is
  // unsupported on-chain (UnsupportedCurrency revert) and stays out.
  // ---------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <section class="panel app-degenerette-panel">
        <header class="panel-header deg-header">
          <div class="deg-heading">
            <h2><a class="deg-learn-link" href="/learn/degenerette/">DEGENERETTE</a></h2>
            <button type="button" class="deg-header__info" data-bind="deg-basics-info"
                    aria-haspopup="dialog" aria-label="How Degenerette works">i</button>
          </div>
          <span class="deg-state" data-bind="deg-state"></span>
        </header>

        <div class="deg-setup" data-bind="deg-setup">
          <section class="deg-block deg-block--ticket" aria-label="Build Degenerette ticket">
            <!-- Visual ticket picker replaces raw quadrant/uint32 inputs. -->
            <div class="dgn-selector">
              <div class="dgn-ticket-column">
                <div class="dgn-ticket-wrap">
                  <div class="ticket-card tc-small dgn-ticket" data-bind="dgn-ticket"
                       title="Click a quadrant to edit it">
                    <div class="trait-quadrant dgn-q" data-bind="dgn-cell-0"><img data-bind="dgn-img-0" alt=""></div>
                    <div class="trait-quadrant dgn-q" data-bind="dgn-cell-1"><img data-bind="dgn-img-1" alt=""></div>
                    <div class="trait-quadrant dgn-q" data-bind="dgn-cell-2"><img data-bind="dgn-img-2" alt=""></div>
                    <div class="trait-quadrant dgn-q" data-bind="dgn-cell-3"><img data-bind="dgn-img-3" alt=""></div>
                    <div class="ticket-card-center"><img src="/whitepaper/flame-center.svg" alt=""></div>
                  </div>
                </div>
                <p class="dgn-ticket-hint" data-bind="dgn-ticket-hint">CLICK TO EDIT</p>
              </div>
              <div class="dgn-editor" data-bind="dgn-editor"></div>
            </div>

          </section>

          <div class="deg-wager-column">
          <section class="deg-block deg-block--wager" aria-label="Degenerette wager">
            <span class="deg-wager-field__label deg-currency-picker__label">Currency</span>
            <div class="deg-currency-picker" role="group" aria-label="Wager currency">
              <button type="button" class="deg-currency-option is-selected"
                      data-bind="deg-currency-option-0" value="0" aria-pressed="true"
                      aria-label="Pay with ETH" title="ETH">
                <img src="/badges-circular/crypto_06_ethereum_green.svg" alt="">
              </button>
              <button type="button" class="deg-currency-option"
                      data-bind="deg-currency-option-1" value="1" aria-pressed="false"
                      aria-label="Pay with FLIP" title="FLIP">
                <img src="/whitepaper/flame-logo-split.svg" alt="">
              </button>
              <button type="button" class="deg-currency-option"
                      data-bind="deg-currency-option-3" value="3" aria-pressed="false"
                      aria-label="Pay with WWXRP" title="WWXRP">
                <img src="/shared/coinflip-face-red.svg" alt="">
              </button>
            </div>
            <select name="deg-currency" class="deg-currency-select deg-currency-native"
                    aria-label="Wager currency" title="Wager currency">
                <option value="0" selected>ETH</option>
                <option value="1">FLIP</option>
                <option value="3" data-bind="deg-currency-wwxrp">WWXRP</option>
            </select>
            <div class="deg-controls">
              <!-- Amount min/step and spin options follow the selected
                   currency's contract limits in #renderBetLimits. -->
              <div class="deg-wager-field deg-amount-control">
                <span class="deg-wager-field__label">Bet per spin</span>
                <span class="deg-amount-shell" role="group" aria-label="Adjust bet per spin">
                  <button type="button" class="deg-stepper__button deg-stepper__button--down"
                          data-bind="deg-amount-down" aria-label="Decrease bet per spin"
                          title="Decrease bet per spin">−</button>
                  <input type="number" name="deg-amount" class="deg-amount-input"
                         min="0.005" step="0.001" value="0.01"
                         aria-label="Bet per spin" title="Bet per spin">
                  <button type="button" class="deg-stepper__button deg-stepper__button--up"
                          data-bind="deg-amount-up" aria-label="Increase bet per spin"
                          title="Increase bet per spin">+</button>
                </span>
              </div>
              <div class="deg-wager-field">
                <span class="deg-wager-field__label">Spins</span>
                <span class="deg-spin-shell" role="group" aria-label="Adjust spins">
                  <button type="button" class="deg-stepper__button deg-stepper__button--down"
                          data-bind="deg-spins-down" aria-label="Decrease spins"
                          title="Decrease spins">−</button>
                  <select name="deg-ticket-count" class="deg-ticket-count-select"
                          data-bind="deg-spins-select" aria-label="Number of spins" title="Number of spins">
                    <option value="5" selected>5</option>
                  </select>
                  <button type="button" class="deg-stepper__button deg-stepper__button--up"
                          data-bind="deg-spins-up" aria-label="Increase spins"
                          title="Increase spins">+</button>
                </span>
              </div>
            </div>
            <!-- Account-switcher: operator WWXRP bets are unavailable. -->
            <span class="deg-wwxrp-note" data-bind="deg-wwxrp-note" hidden>WWXRP bets aren't available in operator mode.</span>
            <button type="button" class="deg-place-cta" data-write data-bind="deg-place-cta">
              Place Bet · 0.05 ETH
            </button>
          </section>

          <aside class="deg-referral-card" aria-label="Refer friends and earn free FLIP forever">
            <img class="deg-referral-card__logo" src="/whitepaper/flame-logo.svg" alt="" aria-hidden="true">
            <div class="deg-referral-card__copy">
              <strong>
                <span>REFER FRIENDS</span>
                <span>EARN <span class="deg-referral-card__free">FREE</span> <span class="deg-referral-card__flip">FLIP</span></span>
                <span class="deg-referral-card__forever">
                  <span>FOREVER</span>
                  <button type="button" class="deg-referral-card__coin"
                          data-bind="deg-referral-coin-toggle" aria-pressed="false"
                          aria-label="Pause animation and copy referral link"
                          title="Pause coin + copy link">
                    <span class="deg-referral-card__coin-inner">
                      <img src="/shared/coinflip-face-red.svg" alt="">
                      <img src="/shared/coinflip-face-eth.svg" alt="">
                    </span>
                  </button>
                </span>
              </strong>
            </div>
            <div class="deg-referral-card__actions">
              <button type="button" class="deg-referral-card__copy-btn"
                      data-bind="deg-referral-copy" disabled>COPY LINK</button>
              <button type="button" class="deg-referral-card__info-btn"
                      data-bind="deg-referral-info" aria-haspopup="dialog"
                      aria-label="How referrals and kickback work">i</button>
            </div>
            <span class="deg-referral-card__feedback" data-bind="deg-referral-feedback"
                  hidden role="status"></span>
          </aside>
          </div>
        </div>

        <div class="deg-outcome" data-bind="deg-outcome"></div>
        <div class="deg-error" data-bind="deg-error" hidden role="alert"></div>

      </section>
      <div class="deg-referral-dialog deg-basics-dialog" data-bind="deg-basics-dialog" hidden
           role="dialog" aria-modal="true" aria-labelledby="deg-basics-title">
        <button type="button" class="deg-referral-dialog__backdrop"
                data-bind="deg-basics-close" aria-label="Close Degenerette basics"></button>
        <section class="deg-referral-dialog__card deg-basics-dialog__card">
          <button type="button" class="deg-referral-dialog__close"
                  data-bind="deg-basics-close" aria-label="Close Degenerette basics">×</button>
          <h3 id="deg-basics-title">How Degenerette works</h3>
          <div class="deg-referral-dialog__mechanics">
            <p><strong>Build your ticket.</strong> Pick a symbol and color for each quadrant. The starred Hero earns an extra point when its symbol matches.</p>
            <p><strong>Set the wager.</strong> Choose ETH, FLIP, or WWXRP, then choose the bet per spin and number of spins.</p>
            <p><strong>Spin for matches.</strong> Matching symbols score; a matching color adds another point. Higher scores can pay more in the currency you wagered.</p>
          </div>
          <section class="deg-payouts" aria-labelledby="deg-payouts-title">
            <div class="deg-payouts__head">
              <h4 id="deg-payouts-title">ETH / FLIP payouts</h4>
              <p>Base gross multiplier (× wager) before activity adjustment. Scores 0–1 pay 0; Hero position only changes the 1–3 gold schedules.</p>
            </div>
            <div class="deg-payouts__tables" data-bind="deg-payout-tables"></div>
          </section>
          <a class="deg-referral-dialog__learn" href="/learn/degenerette/">
            Full rules <span aria-hidden="true">→</span>
          </a>
        </section>
      </div>
      <div class="deg-referral-dialog" data-bind="deg-referral-dialog" hidden
           role="dialog" aria-modal="true" aria-labelledby="deg-referral-title">
        <button type="button" class="deg-referral-dialog__backdrop"
                data-bind="deg-referral-close" aria-label="Close referral details"></button>
        <section class="deg-referral-dialog__card">
          <button type="button" class="deg-referral-dialog__close"
                  data-bind="deg-referral-close" aria-label="Close referral details">×</button>
          <h3 id="deg-referral-title">Refer a friend</h3>
          <div class="deg-referral-dialog__mechanics">
            <p><strong>Earn 20% commission in FLIP</strong> on eligible purchases made by players who join through your link.</p>
            <p><strong>Their first valid referral is permanent.</strong> Your default address link works immediately.</p>
            <p><strong>Want to share it?</strong> A custom code can kick back 0–25% of your commission to referred players.</p>
          </div>
          <label class="deg-referral-dialog__link-label">
            <span>SHAREABLE LINK</span>
            <input type="text" readonly data-bind="deg-referral-url"
                   aria-label="Copy your referral link" title="Copy referral link">
          </label>
          <div class="deg-referral-dialog__custom">
            <div class="deg-referral-dialog__custom-head">
              <strong>Create a custom code</strong>
              <span data-bind="deg-referral-current-code">Optional</span>
            </div>
            <label>
              <span>CODE</span>
              <input type="text" name="deg-referral-code" minlength="3" maxlength="31"
                     pattern="[A-Za-z0-9]{3,31}" autocomplete="off" placeholder="DEGEN123">
            </label>
            <label>
              <span>KICKBACK</span>
              <span class="deg-referral-dialog__pct-field">
                <input type="number" name="deg-referral-kickback" min="0" max="25"
                       step="1" value="0" inputmode="numeric" aria-label="Kickback percent">
                <span>%</span>
              </span>
            </label>
            <button type="button" class="deg-referral-dialog__register"
                    data-write data-bind="deg-referral-register">CREATE CODE</button>
          </div>
          <p class="deg-referral-dialog__feedback" data-bind="deg-referral-dialog-feedback"
             hidden role="status"></p>
          <a class="deg-referral-dialog__learn" href="/learn/affiliates/">
            Full referral mechanics <span aria-hidden="true">→</span>
          </a>
        </section>
      </div>
    `;
  }

  #wireEventHandlers() {
    const place = this.querySelector('[data-bind="deg-place-cta"]');
    if (place) place.addEventListener('click', (e) => this.#onPlaceClick(e));
    // Spin cap and minimum bet are per currency, so the controls follow it.
    const currency = this.querySelector('[name="deg-currency"]');
    if (currency) currency.addEventListener('change', () => {
      this.#applyCurrencySelection(Number(currency.value || 0));
    });
    for (const value of [0, 1, 3]) {
      const option = this.querySelector(`[data-bind="deg-currency-option-${value}"]`);
      if (!option) continue;
      option.addEventListener('click', () => {
        if (option.disabled || !currency) return;
        if (String(currency.value) === String(value)) return;
        currency.value = String(value);
        this.#applyCurrencySelection(value);
      });
    }
    const amount = this.querySelector('[name="deg-amount"]');
    if (amount) amount.addEventListener('input', () => {
      this.#renderPlaceLabel();
      this.#renderStepperState();
      this.#persistBetPreference(this.#draftCurrency);
    });
    const spins = this.querySelector('[name="deg-ticket-count"]');
    if (spins) spins.addEventListener('change', () => {
      this.#renderPlaceLabel();
      this.#renderStepperState();
    });
    this.querySelector('[data-bind="deg-amount-up"]')
      ?.addEventListener('click', () => this.#stepBetAmount(1));
    this.querySelector('[data-bind="deg-amount-down"]')
      ?.addEventListener('click', () => this.#stepBetAmount(-1));
    this.querySelector('[data-bind="deg-spins-up"]')
      ?.addEventListener('click', () => this.#stepSpinCount(1));
    this.querySelector('[data-bind="deg-spins-down"]')
      ?.addEventListener('click', () => this.#stepSpinCount(-1));

    this.querySelector('[data-bind="deg-referral-copy"]')
      ?.addEventListener('click', (event) => this.#copyReferralLink(event));
    this.querySelector('[data-bind="deg-referral-coin-toggle"]')
      ?.addEventListener('click', (event) => this.#toggleReferralCoin(event));
    this.querySelector('[data-bind="deg-referral-url"]')
      ?.addEventListener('click', (event) => this.#copyReferralLink(event));
    this.querySelector('[data-bind="deg-referral-info"]')
      ?.addEventListener('click', (event) => this.#openReferralDialog(event));
    for (const close of this.querySelectorAll('[data-bind="deg-referral-close"]')) {
      close.addEventListener('click', () => this.#closeReferralDialog());
    }
    this.querySelector('[data-bind="deg-referral-register"]')
      ?.addEventListener('click', (event) => this.#registerReferralCode(event));
    const referralDialog = this.querySelector('[data-bind="deg-referral-dialog"]');
    referralDialog?.addEventListener('keydown', (event) => {
      if (event?.key !== 'Escape') return;
      try { event.preventDefault?.(); } catch (_) { /* fakeDOM */ }
      this.#closeReferralDialog();
    });
    this.querySelector('[data-bind="deg-basics-info"]')
      ?.addEventListener('click', (event) => this.#openBasicsDialog(event));
    for (const close of this.querySelectorAll('[data-bind="deg-basics-close"]')) {
      close.addEventListener('click', () => this.#closeBasicsDialog());
    }
    const basicsDialog = this.querySelector('[data-bind="deg-basics-dialog"]');
    basicsDialog?.addEventListener('keydown', (event) => {
      if (event?.key !== 'Escape') return;
      try { event.preventDefault?.(); } catch (_) { /* fakeDOM */ }
      this.#closeBasicsDialog();
    });

    // Picker interactions per quadrant cell (app-compact port; wheel uses
    // Shift as the color modifier instead of the radius test — fakeDOM has
    // no layout, and Shift is discoverable from the hint line).
    for (let q = 0; q < 4; q++) {
      const cell = this.querySelector(`[data-bind="dgn-cell-${q}"]`);
      if (!cell) continue;
      cell.addEventListener('click', () => {
        this.#pickerTouched = true;
        this.#dgnEditing = this.#dgnEditing === q ? null : q;
        this.#renderPicker();
      });
      cell.addEventListener('contextmenu', (e) => {
        try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
        this.#pickerTouched = true;
        this.#dgnHero = q;
        this.#renderPicker();
      });
      cell.addEventListener('wheel', (e) => {
        try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
        this.#pickerTouched = true;
        const dir = (e && Number(e.deltaY) < 0) ? -1 : 1;
        const t = this.#dgnTraits[q];
        if (e && e.shiftKey) t.c = (t.c + dir + 8) % 8;
        else t.s = (t.s + dir + 8) % 8;
        this.#renderPicker();
      }, { passive: false });
    }
    this.#renderPicker();
  }

  /** Snapshot used by the quest action sheet so it submits the card it shows. */
  getTicketDraft() {
    return {
      traitIds: this.#dgnTraits.map(({ s, c }, q) => ((q & 3) << 6) | ((c & 7) << 3) | (s & 7)),
      heroQuadrant: this.#dgnHero & 3,
    };
  }

  #renderReferralLink() {
    const copy = this.querySelector('[data-bind="deg-referral-copy"]');
    const url = this.querySelector('[data-bind="deg-referral-url"]');
    const current = this.querySelector('[data-bind="deg-referral-current-code"]');
    const register = this.querySelector('[data-bind="deg-referral-register"]');
    const effectiveCode = this.#referralAddress
      ? (this.#referralCode || defaultCodeForAddress(this.#referralAddress))
      : null;
    const friendly = effectiveCode ? formatPurchaseAffiliateCode(effectiveCode) : '';
    if (copy) {
      copy.disabled = !this.#referralAddress || this.#referralBusy;
      if (!this.#referralBusy) copy.textContent = this.#referralCopied ? 'CODE COPIED' : 'COPY LINK';
    }
    if (url) url.value = String(this.#referralUrl || '');
    if (current) current.textContent = friendly ? `ACTIVE · ${friendly}` : 'Optional';
    if (register) {
      register.disabled = !this.#referralAddress || this.#referralBusy;
      if (!this.#referralBusy) register.textContent = 'CREATE CODE';
    }
  }

  #refreshReferralLink() {
    const address = get('connected.address') || null;
    const normalized = address ? String(address).toLowerCase() : null;
    const seq = ++this.#referralResolveSeq;
    this.#referralAddress = normalized;
    this.#referralCopied = false;
    this.#referralCode = normalized ? readRegisteredCode(normalized) : null;
    this.#referralUrl = normalized
      ? buildAffiliateUrl(normalized, this.#referralCode)
      : '';
    this.#renderReferralLink();
    if (!normalized) return Promise.resolve(null);

    return resolveRegisteredCode(normalized).then((code) => {
      if (seq !== this.#referralResolveSeq
        || this.#referralAddress !== normalized) return null;
      // A confirmed local registration remains a useful fast fallback during
      // indexer/RPC trouble. A positive resolver result always wins.
      if (code) this.#referralCode = code;
      this.#referralUrl = buildAffiliateUrl(normalized, this.#referralCode);
      this.#renderReferralLink();
      return this.#referralCode;
    }).catch(() => null);
  }

  #setReferralFeedback(message, { error = false, persist = false } = {}) {
    const compact = this.querySelector('[data-bind="deg-referral-feedback"]');
    const dialog = this.querySelector('[data-bind="deg-referral-dialog-feedback"]');
    for (const node of [compact, dialog]) {
      if (!node) continue;
      node.hidden = !message;
      node.textContent = String(message || '');
      node.classList?.toggle('is-error', Boolean(error));
    }
    if (this.#referralCopyTimer != null) {
      try { clearTimeout(this.#referralCopyTimer); } catch (_) { /* defensive */ }
      this.#referralCopyTimer = null;
    }
    if (!message || persist) return;
    this.#referralCopyTimer = setTimeout(() => {
      this.#referralCopyTimer = null;
      this.#referralCopied = false;
      for (const node of [compact, dialog]) {
        if (!node) continue;
        node.hidden = true;
        node.textContent = '';
      }
      this.#renderReferralLink();
    }, 2_000);
    if (this.#referralCopyTimer && typeof this.#referralCopyTimer.unref === 'function') {
      try { this.#referralCopyTimer.unref(); } catch (_) { /* defensive */ }
    }
  }

  #toggleReferralCoin(event) {
    const coin = this.querySelector('[data-bind="deg-referral-coin-toggle"]');
    if (!coin) return;
    const paused = !coin.classList?.contains('is-paused');
    coin.classList?.toggle('is-paused', paused);
    coin.setAttribute('aria-pressed', paused ? 'true' : 'false');
    coin.setAttribute('aria-label', paused
      ? 'Resume animation and copy referral link'
      : 'Pause animation and copy referral link');
    coin.title = paused ? 'Resume coin + copy link' : 'Pause coin + copy link';
    void this.#copyReferralLink(event);
  }

  async #copyReferralLink(event) {
    try { event?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#referralBusy || !get('connected.address')) return;
    const button = this.querySelector('[data-bind="deg-referral-copy"]');
    this.#referralBusy = true;
    if (button) { button.disabled = true; button.textContent = 'COPYING…'; }
    try {
      // Prime a guaranteed-valid address URL synchronously. Do not await the
      // optional cross-device vanity-code lookup before calling writeText:
      // waiting can consume the browser's transient clipboard permission.
      void this.#refreshReferralLink();
      const link = this.#referralUrl;
      if (!link) throw new Error('Connect a wallet to create your referral link.');
      let copied = false;
      try {
        if (typeof navigator !== 'undefined'
          && navigator.clipboard
          && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(link);
          copied = true;
        }
      } catch (_) { copied = false; }
      if (!copied) copied = _copyTextFallback(link);
      if (!copied) throw new Error('Could not copy the referral link.');
      this.#referralCopied = true;
      this.#setReferralFeedback('CODE COPIED');
    } catch (error) {
      this.#setReferralFeedback(compactUiError(error, 'Could not copy the referral link.'), { error: true });
    } finally {
      this.#referralBusy = false;
      this.#renderReferralLink();
    }
  }

  #openReferralDialog(event) {
    const dialog = this.querySelector('[data-bind="deg-referral-dialog"]');
    if (!dialog) return;
    this.#referralDialogReturnFocus = event?.currentTarget
      || this.querySelector('[data-bind="deg-referral-info"]');
    dialog.hidden = false;
    dialog.removeAttribute?.('hidden');
    this.#refreshReferralLink();
    try { this.querySelector('[name="deg-referral-code"]')?.focus?.({ preventScroll: true }); }
    catch (_) { /* fakeDOM */ }
  }

  #closeReferralDialog() {
    const dialog = this.querySelector('[data-bind="deg-referral-dialog"]');
    if (dialog) {
      dialog.hidden = true;
      dialog.setAttribute?.('hidden', '');
    }
    const returnFocus = this.#referralDialogReturnFocus;
    this.#referralDialogReturnFocus = null;
    try { returnFocus?.focus?.({ preventScroll: true }); } catch (_) { /* defensive */ }
  }

  #renderPayoutTables() {
    const host = this.querySelector('[data-bind="deg-payout-tables"]');
    if (!host) return;
    host.textContent = '';
    const currentGold = this.#dgnTraits.filter((trait) => Number(trait?.c) === 7).length;
    const schedules = degeneretteBasePayoutTables();
    const columns = schedules.flatMap((schedule) => schedule.heroMatters
      ? [
        { schedule, field: 'honestHeroGold' },
        { schedule, field: 'honestHeroOther' },
      ]
      : [{ schedule, field: 'honestHeroGold' }]);

    const scroll = document.createElement('div');
    scroll.className = 'deg-payout-table-wrap deg-payout-matrix';
    const table = document.createElement('table');
    table.className = 'deg-payout-table';
    table.setAttribute('aria-label', 'ETH and FLIP payout multipliers by score and gold traits');
    const thead = document.createElement('thead');
    const goldRow = document.createElement('tr');
    const scoreHeading = document.createElement('th');
    scoreHeading.setAttribute('scope', 'col');
    scoreHeading.setAttribute('rowspan', '2');
    scoreHeading.textContent = 'SCORE';
    goldRow.appendChild(scoreHeading);
    const heroRow = document.createElement('tr');
    for (const schedule of schedules) {
      const goldHeading = document.createElement('th');
      goldHeading.setAttribute('scope', 'colgroup');
      goldHeading.setAttribute('data-gold-traits', String(schedule.goldTraits));
      if (schedule.heroMatters) goldHeading.setAttribute('colspan', '2');
      else goldHeading.setAttribute('rowspan', '2');
      if (schedule.goldTraits === currentGold) goldHeading.className = 'is-current';
      goldHeading.textContent = `${schedule.goldTraits} GOLD`;
      goldRow.appendChild(goldHeading);
      if (schedule.heroMatters) {
        for (const label of ['HERO GOLD', 'OTHER HERO']) {
          const heroHeading = document.createElement('th');
          heroHeading.setAttribute('scope', 'col');
          heroHeading.setAttribute('data-gold-traits', String(schedule.goldTraits));
          if (schedule.goldTraits === currentGold) heroHeading.className = 'is-current';
          heroHeading.textContent = label;
          heroRow.appendChild(heroHeading);
        }
      }
    }
    thead.appendChild(goldRow);
    thead.appendChild(heroRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const scoreRows = [{ label: '0–1', score: 0 }]
      .concat(Array.from({ length: 8 }, (_, index) => ({ label: String(index + 2), score: index + 2 })));
    for (const scoreRow of scoreRows) {
      const tr = document.createElement('tr');
      const score = document.createElement('th');
      score.setAttribute('scope', 'row');
      score.textContent = scoreRow.label;
      tr.appendChild(score);
      for (const column of columns) {
        const td = document.createElement('td');
        td.setAttribute('data-gold-traits', String(column.schedule.goldTraits));
        if (column.schedule.goldTraits === currentGold) td.className = 'is-current';
        td.textContent = _formatBaseCentiX(
          column.schedule.rows[scoreRow.score][column.field],
        ).replace(/×$/, '');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    host.appendChild(scroll);
  }

  #openBasicsDialog(event) {
    const dialog = this.querySelector('[data-bind="deg-basics-dialog"]');
    if (!dialog) return;
    this.#basicsDialogReturnFocus = event?.currentTarget
      || this.querySelector('[data-bind="deg-basics-info"]');
    dialog.hidden = false;
    dialog.removeAttribute?.('hidden');
    try { dialog.querySelector?.('[data-bind="deg-basics-close"]')?.focus?.({ preventScroll: true }); }
    catch (_) { /* fakeDOM */ }
  }

  #closeBasicsDialog() {
    const dialog = this.querySelector('[data-bind="deg-basics-dialog"]');
    if (dialog) dialog.hidden = true;
    try { this.#basicsDialogReturnFocus?.focus?.({ preventScroll: true }); }
    catch (_) { /* fakeDOM */ }
    this.#basicsDialogReturnFocus = null;
  }

  async #registerReferralCode(event) {
    try { event?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#referralBusy) return;
    const address = String(get('connected.address') || '').toLowerCase();
    if (!address) {
      this.#setReferralFeedback('Connect a wallet to create a code.', { error: true, persist: true });
      return;
    }
    const codeInput = this.querySelector('[name="deg-referral-code"]');
    const kickbackInput = this.querySelector('[name="deg-referral-kickback"]');
    const register = this.querySelector('[data-bind="deg-referral-register"]');
    this.#referralBusy = true;
    this.#setReferralFeedback('');
    if (register) { register.disabled = true; register.textContent = 'CREATING…'; }
    try {
      const { encodedCode } = await createAffiliateCode({
        codeStr: String(codeInput?.value || '').trim(),
        kickbackPct: String(kickbackInput?.value ?? '0'),
      });
      if (String(get('connected.address') || '').toLowerCase() === address) {
        this.#referralAddress = address;
        this.#referralCode = encodedCode;
        this.#referralUrl = buildAffiliateUrl(address, encodedCode);
      }
      this.#setReferralFeedback(
        `CODE CREATED · ${formatPurchaseAffiliateCode(encodedCode)} — COPY LINK NOW USES IT`,
        { persist: true },
      );
      try {
        document.dispatchEvent(new CustomEvent('affiliate:code-registered', {
          detail: { address, code: encodedCode },
        }));
      } catch (_) { /* headless */ }
    } catch (error) {
      this.#setReferralFeedback(
        compactUiError(error, 'Could not create that referral code.'),
        { error: true, persist: true },
      );
    } finally {
      this.#referralBusy = false;
      this.#renderReferralLink();
    }
  }

  // Configure exactly the total the quest asks for while retaining the normal
  // five-spin draft. Bare quest events only select the lane; the confirmation
  // dialog may then submit this already-configured bet with submit:true.
  #applyQuestPreset(detail) {
    const questType = Number(detail?.questType);
    if (questType !== 7 && questType !== 8) return false;
    const currency = questType === 7 ? 0 : 1;
    const suppliedTraits = dgnTraitIdsToQuadrants(detail?.traitIds);
    if (Array.isArray(detail?.traitIds)
      && detail.traitIds.length === 4
      && suppliedTraits.every(Boolean)) {
      this.#dgnTraits = suppliedTraits.map((trait) => ({ s: trait.sym, c: trait.col }));
      const suppliedHero = Number(detail?.heroQuadrant);
      this.#dgnHero = Number.isInteger(suppliedHero) && suppliedHero >= 0 && suppliedHero < 4
        ? suppliedHero : this.#dgnHero;
      this.#dgnEditing = null;
      this.#pickerTouched = true;
      this.#renderPicker();
    }

    let total;
    try { total = BigInt(detail?.target ?? 0); } catch (_e) { total = 0n; }
    if (total <= 0n) {
      if (currency === 0) {
        const level = Number(get('app.lastDay')?.roll1?.purchaseLevel);
        try { total = scaledTicketPriceWei(level) * 2n; } catch (_e) { total = 0n; }
      } else {
        total = 2_000n * (10n ** 18n);
      }
    }
    if (total <= 0n) return false;

    const limits = degeneretteLimits(currency);
    const minPerSpin = currency === 0
      ? limits.minBetFullScale / BigInt(ETH_DIVISOR)
      : limits.minBetFullScale;
    let explicitPerSpin = 0n;
    try { explicitPerSpin = BigInt(detail?.amountPerSpin ?? 0); }
    catch (_e) { explicitPerSpin = 0n; }
    const explicitSpins = Number(detail?.spinCount);
    const hasExplicitWager = explicitPerSpin >= minPerSpin
      && Number.isInteger(explicitSpins)
      && explicitSpins >= 1
      && explicitSpins <= limits.maxSpins;
    // The quest sheet sends the exact wager it displayed. Legacy bare quest
    // events retain the earlier safe-divisor setup.
    let spinCount = hasExplicitWager
      ? explicitSpins
      : Math.max(1, Math.min(5, Number(total / minPerSpin)));
    if (!hasExplicitWager) {
      while (spinCount > 1 && total % BigInt(spinCount) !== 0n) spinCount -= 1;
    }
    const currencyInput = this.querySelector('[name="deg-currency"]');
    const spinsInput = this.querySelector('[name="deg-ticket-count"]');
    const amountInput = this.querySelector('[name="deg-amount"]');
    if (!currencyInput || !spinsInput || !amountInput) return false;
    currencyInput.value = String(currency);
    this.#applyCurrencySelection(currency, { forceReset: true });
    spinsInput.value = String(spinCount);
    const perSpin = hasExplicitWager ? explicitPerSpin : total / BigInt(spinCount);
    const rendered = currency === 0
      ? displayEth(perSpin, 6)
      : displayToken(perSpin, 0);
    const renderedText = String(rendered);
    amountInput.value = renderedText.includes('.')
      ? renderedText.replace(/0+$/, '').replace(/\.$/, '')
      : renderedText;
    this.#renderBetLimits();
    this.#renderCurrencyPicker();
    try { this.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_e) {}
    try { amountInput.focus?.({ preventScroll: true }); } catch (_e) {}
    return true;
  }

  #copyInventoryTicket(detail) {
    const traits = dgnTraitIdsToQuadrants(detail?.traitIds);
    if (!Array.isArray(traits) || traits.length !== 4 || traits.some((trait) => !trait)) return;
    this.#dgnTraits = traits.map((trait) => ({ s: trait.sym, c: trait.col }));
    const goldHero = this.#dgnTraits.findIndex((trait) => trait.c === 7);
    if (goldHero >= 0) this.#dgnHero = goldHero;
    else if (!Number.isInteger(this.#dgnHero) || this.#dgnHero < 0 || this.#dgnHero > 3) this.#dgnHero = 0;
    // Copying a complete inventory ticket is a selection action, not a request
    // to manually edit one of its traits. Keep the compact editor collapsed;
    // the player can still open it explicitly by clicking a quadrant.
    this.#dgnEditing = null;
    this.#pickerTouched = true;
    this.#defaultTicketKey = null;
    this.#renderPicker();
    const state = this.querySelector('[data-bind="deg-state"]');
    if (state && this.#state === STATE.IDLE) state.textContent = 'Ticket copied';
  }

  // ---------------------------------------------------------------------
  // Ticket picker (task #11).
  // ---------------------------------------------------------------------

  // uint32 customTicket from picker state — byte q = ((c&7)<<3)|(s&7); QQ
  // bits left 0 (contract ignores them on the send path).
  #packCustomTicket() {
    let packed = 0;
    for (let q = 0; q < 4; q++) {
      const { s, c } = this.#dgnTraits[q];
      const byte = ((c & 7) << 3) | (s & 7);
      packed |= (byte << (q * 8));
    }
    return packed >>> 0;
  }

  #renderPicker() {
    applyDgnTicketAccent(
      this.querySelector('[data-bind="dgn-ticket"]'),
      this.#dgnTraits,
    );
    for (let q = 0; q < 4; q++) {
      const cell = this.querySelector(`[data-bind="dgn-cell-${q}"]`);
      const img = this.querySelector(`[data-bind="dgn-img-${q}"]`);
      const t = this.#dgnTraits[q];
      if (img) {
        img.src = dgnBadgePath(q, t.s, t.c);
        img.alt = `${DGN_SYMBOLS[DGN_QUADRANTS[q]][t.s]} ${DGN_COLORS[t.c]}`;
      }
      if (cell && cell.classList) {
        cell.classList.toggle('q-hero', this.#dgnHero === q);
        cell.classList.toggle('is-editing', this.#dgnEditing === q);
      }
    }
    this.#renderEditor();
  }

  #renderEditor() {
    const host = this.querySelector('[data-bind="dgn-editor"]');
    const hint = this.querySelector('[data-bind="dgn-ticket-hint"]');
    if (!host) return;
    host.textContent = '';
    const q = this.#dgnEditing;
    if (q == null) {
      host.hidden = true;
      if (hint) hint.hidden = false;
      return;
    }
    host.hidden = false;
    if (hint) hint.hidden = true;
    const t = this.#dgnTraits[q];

    const colorRow = document.createElement('div');
    colorRow.className = 'dgn-row dgn-colors';
    colorRow.setAttribute('aria-label', 'Color and Hero trait');
    for (let c = 0; c < 8; c++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dgn-color-btn';
      if (c === t.c) btn.classList.add('is-selected');
      btn.title = DGN_COLORS[c];
      btn.setAttribute('aria-label', DGN_COLORS[c]);
      btn.style.background = DGN_COLOR_HEX[DGN_COLORS[c]];
      btn.addEventListener('click', () => {
        this.#pickerTouched = true;
        t.c = c;
        this.#renderPicker();
      });
      colorRow.appendChild(btn);
    }

    const heroBtn = document.createElement('button');
    heroBtn.type = 'button';
    heroBtn.className = 'dgn-hero-toggle';
    heroBtn.classList.toggle('is-selected', this.#dgnHero === q);
    heroBtn.textContent = this.#dgnHero === q ? '★' : '☆';
    heroBtn.title = this.#dgnHero === q ? 'Hero quadrant' : 'Make this the Hero quadrant';
    heroBtn.setAttribute('aria-label', heroBtn.title);
    heroBtn.disabled = this.#dgnHero === q;
    heroBtn.addEventListener('click', () => {
      this.#pickerTouched = true;
      this.#dgnHero = q;
      this.#renderPicker();
    });
    colorRow.appendChild(heroBtn);
    host.appendChild(colorRow);

    const symRow = document.createElement('div');
    symRow.className = 'dgn-row dgn-symbols';
    symRow.setAttribute('aria-label', 'Symbol');
    for (let s = 0; s < 8; s++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `dgn-symbol-btn dgn-symbol-btn--${DGN_QUADRANTS[q]}`;
      // Crypto marks already carry their own strong brand shapes and colors;
      // unlike the other quadrants, a dark contrast tile makes them muddier.
      if (q !== 0 && (t.c === 0 || t.c === 2)) {
        btn.classList.add('dgn-symbol-btn--dark-trait');
      }
      if (q === 0 && (s === 3 || s === 7)) btn.classList.add('dgn-symbol-btn--round');
      if (s === t.s) btn.classList.add('is-selected');
      btn.title = DGN_SYMBOLS[DGN_QUADRANTS[q]][s];
      btn.setAttribute('aria-label', DGN_SYMBOLS[DGN_QUADRANTS[q]][s]);
      const img = document.createElement('img');
      img.src = dgnSymbolPath(q, s, t.c);
      img.alt = DGN_SYMBOLS[DGN_QUADRANTS[q]][s];
      btn.appendChild(img);
      btn.addEventListener('click', () => {
        this.#pickerTouched = true;
        t.s = s;
        this.#renderPicker();
      });
      symRow.appendChild(btn);
    }
    host.appendChild(symRow);
  }

  // ---------------------------------------------------------------------
  // Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED).
  // ---------------------------------------------------------------------

  #startPolling() {
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
    }
    if (typeof setInterval !== 'function') return;
    this.#pollHandle = _setIntervalUnref(() => this.#runPollCycle(), POLL_INTERVAL_MS);
  }

  #syncPickerContext() {
    const address = getActingAddress();
    const level = Number(get('app.lastDay')?.roll1?.purchaseLevel);
    const key = address && Number.isFinite(level) && level > 0
      ? `${String(address).toLowerCase()}:${level}`
      : null;
    if (key == null) return null;
    if (key !== this.#pickerContextKey) {
      const changedExistingContext = this.#pickerContextKey != null;
      this.#pickerContextKey = key;
      this.#defaultTicketKey = null;
      // If the user edited the random draft before the first last-day payload
      // arrived, do not clobber it. A real account/level change starts fresh.
      if (changedExistingContext) this.#pickerTouched = false;
    }
    return key;
  }

  // Transitional no-op history hooks for the retired embedded results code.
  // Result replay will move to a dedicated history launcher in a later slice;
  // nothing in the mounted widget calls these methods.
  #historyOwner() { return null; }
  async #loadHistoryItems() { return []; }

  async #runPollCycle() {
    if (typeof document !== 'undefined'
      && document.visibilityState
      && document.visibilityState !== 'visible') {
      return;
    }
    // This is intentionally independent of the ticket-picker request below:
    // an edited ticket must not prevent recovery of an already-confirmed bet.
    void this.#recoverPendingBetFromDb();
    if (this.#pollController) {
      try { this.#pollController.abort(); } catch (_) { /* defensive */ }
    }
    this.#pollController = new AbortController();
    const signal = this.#pollController.signal;
    this.#lastPollAt = Date.now();

    try {
      this.#syncPickerContext();
      const addr = getActingAddress();
      const level = Number(get('app.lastDay')?.roll1?.purchaseLevel);
      if (!addr || !Number.isFinite(level) || level <= 0 || this.#pickerTouched) {
        return;
      }
      const key = `${String(addr).toLowerCase()}:${level}`;
      if (key === this.#defaultTicketKey) {
        return;
      }

      const [data, deityCatalog] = await Promise.all([
        fetchJSON(`/player/${String(addr).toLowerCase()}/tickets/by-trait?level=${level}`),
        readDeityPassCatalog().catch(() => null),
      ]);
      if (signal.aborted || this.#pickerTouched) return;
      // The account or purchase level can change while this request is in
      // flight. Never apply a ticket fetched for the old drawing.
      const currentAddress = getActingAddress();
      const currentLevel = Number(get('app.lastDay')?.roll1?.purchaseLevel);
      const currentKey = currentAddress && Number.isFinite(currentLevel)
        ? `${String(currentAddress).toLowerCase()}:${currentLevel}`
        : null;
      if (currentKey !== key) return;

      const selected = selectDegeneretteDefaultTicket(data);
      const deitySymbol = degeneretteDeitySymbolForOwner(deityCatalog, addr);
      if (!selected && deitySymbol == null) return; // retry while entries/ownership materialise
      if (selected) {
        this.#dgnTraits = selected.traits;
        this.#dgnHero = selected.hero;
      }
      if (deitySymbol != null) {
        // A deity pass binds to one symbol, not a color. Preserve the selected
        // ticket's color in that quadrant, replace only its symbol, and make
        // that quadrant Hero. Explicit inventory copies and manual edits set
        // #pickerTouched and therefore remain authoritative afterward.
        const quadrant = (deitySymbol >> 3) & 3;
        const symbol = deitySymbol & 7;
        this.#dgnTraits[quadrant] = { ...this.#dgnTraits[quadrant], s: symbol };
        this.#dgnHero = quadrant;
      }
      this.#dgnEditing = null;
      this.#defaultTicketKey = key;
      this.#renderPicker();
    } catch (_e) {
      // Network blip — next cycle retries.
    }
  }

  #wireVisibilityRePoll() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#visibilityListener = () => {
      if (document.visibilityState !== 'visible') return;
      const elapsed = Date.now() - this.#lastPollAt;
      if (elapsed >= 5 * 60 * 1000) {
        this.#runPollCycle();
      }
    };
    document.addEventListener('visibilitychange', this.#visibilityListener);
  }

  #wireStoreSubscriptions() {
    const u1 = subscribe('connected.address', () => {
      this.#refreshReferralLink();
      this.#syncPickerContext();
      this.#restorePendingBet();
      this.#runPollCycle();
    });
    const u2 = subscribe('viewing.address', () => {
      this.#syncPickerContext();
      this.#runPollCycle();
    });
    const u3 = subscribe('ui.mode', () => {
      this.#syncPickerContext();
      this.#renderCurrencyGate();
      this.#restorePendingBet();
      this.#runPollCycle();
    });
    const u4 = subscribe('app.lastDay', () => {
      this.#syncPickerContext();
      this.#runPollCycle();
    });
    this.#unsubs.push(u1, u2, u3, u4);
  }

  #restorePendingBet() {
    const address = getActingAddress();
    const lower = address ? String(address).toLowerCase() : null;
    if (lower === this.#pendingAddress && this.#currentBetId != null) return;
    if (lower !== this.#pendingAddress) {
      this.#pendingRecoverySeq += 1;
      this.#pendingRecoveryAddress = null;
    }
    this.#cancelRngPoll();
    this.#pendingAddress = lower;
    const row = _readPendingBet(lower);
    if (!row) {
      this.#currentBetId = null;
      this.#currentLootboxIndex = null;
      this.#currentTicket = null;
      this.#currentRngWord = 0n;
      this.#rngRequestPending = false;
      this.#rngRequestStartedAt = 0;
      if (![STATE.PLACING, STATE.RESOLVING].includes(this.#state)) this.#setState(STATE.IDLE);
      return;
    }
    this.#currentBetId = row.betId;
    this.#currentLootboxIndex = row.index;
    this.#currentCurrency = row.currency;
    this.#currentAmountPerSpin = row.amountPerSpin;
    this.#currentSpinCount = row.spinCount;
    this.#currentHero = row.hero;
    this.#currentTicket = row.ticket;
    this.#currentRngWord = 0n;
    this.#rngRequestPending = row.rngRequestPending;
    this.#rngRequestStartedAt = row.rngRequestStartedAt;
    this.#setState(STATE.AWAITING_RNG);
    this.#startRngPollCycle();
  }

  async #recoverPendingBetFromDb() {
    const acting = getActingAddress();
    const address = acting ? String(acting).toLowerCase() : null;
    if (!address
      || this.#currentBetId != null
      || [STATE.PLACING, STATE.RESOLVING, STATE.INDEXING].includes(this.#state)
      || this.#pendingRecoveryAddress === address) {
      return false;
    }

    const seq = ++this.#pendingRecoverySeq;
    this.#pendingRecoveryAddress = address;
    const stillCurrent = () => (
      seq === this.#pendingRecoverySeq
      && getActingAddress()
      && String(getActingAddress()).toLowerCase() === address
      && this.#currentBetId == null
      && ![STATE.PLACING, STATE.RESOLVING, STATE.INDEXING].includes(this.#state)
    );

    try {
      const snapshot = await fetchJSON(`/player/${address}`);
      if (!stillCurrent()) return false;

      const pending = (Array.isArray(snapshot?.degenerette?.pendingBets)
        ? snapshot.degenerette.pendingBets
        : [])
        .map((row) => {
          try {
            return {
              betId: BigInt(row.betId),
              index: BigInt(row.betIndex),
            };
          } catch (_e) {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => (a.betId === b.betId ? 0 : a.betId > b.betId ? -1 : 1));
      if (pending.length === 0) return false;

      let feed = [];
      try {
        const response = await fetchJSON(
          `/degenerette/feed?limit=200&player=${encodeURIComponent(address)}`,
        );
        feed = mergeDegeneretteFeedItems(response?.items);
      } catch (_e) { /* the chain read below can recover without the feed */ }

      for (const candidate of pending) {
        if (!stillCurrent()) return false;
        const candidateKey = `${address}:${String(candidate.betId)}`;
        if (this.#presentedBetKeys.has(candidateKey)) continue;
        const indexed = feed.find((item) => (
          String(item?.player || '').toLowerCase() === address
          && String(item?.betId) === String(candidate.betId)
        ));
        if ((Array.isArray(indexed?.results) ? indexed.results : [])
          .some((result) => result?.resultType === 'resolved')) {
          // The player snapshot can retain a pending row for one projection
          // after the result feed is complete. That row is already terminal.
          continue;
        }
        const chainPacked = await readBetInfo({
          player: address,
          betId: candidate.betId,
        }).catch(() => null);
        if (!stillCurrent()) return false;
        // Zero is authoritative: the DB placement snapshot is briefly behind
        // an already-completed resolution, so do not resurrect it as pending.
        if (chainPacked === 0n) continue;

        // Recovery records in the DB can survive a redeploy. Only the current
        // GAME slot is authoritative enough to resurrect one; an RPC failure
        // waits for the next poll rather than trusting old indexed packedData.
        if (chainPacked == null || chainPacked === 0n) continue;
        const packed = chainPacked;
        const decoded = dgnDecodePacked(packed);
        if (!decoded
          || decoded.spinCount < 1
          || !degeneretteLimits(decoded.currency)) {
          continue;
        }

        const row = {
          betId: candidate.betId,
          index: candidate.index,
          currency: decoded.currency,
          amountPerSpin: decoded.amountPerSpin,
          spinCount: decoded.spinCount,
          hero: decoded.heroQuadrant,
          ticket: decoded.customTicket,
        };
        if (!stillCurrent()) return false;
        this.#pendingAddress = address;
        this.#currentBetId = row.betId;
        this.#currentLootboxIndex = row.index;
        this.#currentCurrency = row.currency;
        this.#currentAmountPerSpin = row.amountPerSpin;
        this.#currentSpinCount = row.spinCount;
        this.#currentHero = row.hero;
        this.#currentTicket = row.ticket;
        this.#currentRngWord = 0n;
        this.#rngRequestPending = false;
        this.#rngRequestStartedAt = 0;
        _writePendingBet(address, row);
        this.#clearError();
        this.#setState(STATE.AWAITING_RNG);
        this.#startRngPollCycle();
        return true;
      }
    } catch (_e) {
      // Snapshot/indexer blip — the panel's regular poll retries without
      // replacing a useful on-chain placement with an error state.
    } finally {
      if (seq === this.#pendingRecoverySeq) this.#pendingRecoveryAddress = null;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // Account-switcher (2026-07-16) — WWXRP currency lane gating. The contract
  // reverts NotApproved for operator-mode WWXRP bets (DegenerusGameDegenerette
  // Module.sol:431-437); every other currency + degenerette entry point takes
  // the generic _resolvePlayer(player) approved-operator path. Disable the
  // option (defense-in-depth alongside the contract revert) + surface a short
  // note; auto-revert an already-selected WWXRP choice back to ETH so an
  // in-flight bet draft doesn't silently become unplaceable.
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Contract bet limits (user call 2026-07-29: the UI offers whatever the
  // contract allows). Both bounds are per currency — ETH 25 spins / 0.005 min,
  // FLIP 15 / 100, WWXRP 5 / 1 — so the spin options are rebuilt and the amount
  // field's min/step follow the selected currency. A spin count that no longer
  // exists (25 spins, then a switch to WWXRP) clamps down to the new cap rather
  // than sending a bet the contract rejects.
  // ---------------------------------------------------------------------

  #ethDefaultBetLabel() {
    let amountWei = DEFAULT_ETH_BET_WEI;
    const level = Number(get('app.lastDay')?.roll1?.purchaseLevel);
    if (Number.isFinite(level) && level >= 0) {
      try {
        const quarterTicketPrice = scaledTicketPriceWei(level) / 4n;
        if (quarterTicketPrice > amountWei) amountWei = quarterTicketPrice;
      } catch (_e) { /* retain the 0.01 ETH floor */ }
    }
    return displayEth(amountWei, 6).replace(/0+$/, '').replace(/\.$/, '');
  }

  #defaultBetLabel(currency) {
    if (Number(currency) === 0) return this.#ethDefaultBetLabel();
    if (Number(currency) === 1) return DEFAULT_FLIP_BET;
    return DEFAULT_WWXRP_BET;
  }

  #preferredBetLabel(currency) {
    const stored = readDegeneretteBetSize(currency);
    const limits = degeneretteLimits(currency);
    const fallback = this.#defaultBetLabel(currency);
    if (stored == null || !limits) return fallback;
    const numeric = Number(stored);
    // ETH's useful default follows one quarter of the current ticket price.
    // Do not let an automatically persisted default from an earlier, cheaper
    // level pin the field below that moving floor when the player returns to
    // ETH. Explicit preferences above the current floor remain untouched.
    const preferenceFloor = Number(currency) === 0
      ? Math.max(Number(limits.minLabel), Number(fallback))
      : Number(limits.minLabel);
    return Number.isFinite(numeric) && numeric >= preferenceFloor
      ? stored
      : fallback;
  }

  #restoreBetPreference(currency) {
    const amount = this.querySelector('[name="deg-amount"]');
    if (amount) amount.value = this.#preferredBetLabel(currency);
  }

  #persistBetPreference(currency) {
    const amount = this.querySelector('[name="deg-amount"]');
    const limits = degeneretteLimits(currency);
    const numeric = Number(amount?.value);
    if (!amount || !limits || !Number.isFinite(numeric)
      || numeric < Number(limits.minLabel)) return false;
    return writeDegeneretteBetSize(currency, amount.value);
  }

  #applyCurrencySelection(currency, { forceReset = false } = {}) {
    const next = Number(currency);
    const previous = this.#draftCurrency;
    if (next !== previous) this.#persistBetPreference(previous);
    const changed = forceReset || next !== this.#draftCurrency;
    this.#draftCurrency = next;
    if (changed) {
      const amount = this.querySelector('[name="deg-amount"]');
      if (amount) amount.value = this.#preferredBetLabel(next);
    }
    this.#renderBetLimits();
    this.#renderCurrencyPicker();
  }

  #renderBetLimits() {
    const currencySel = this.querySelector('[name="deg-currency"]');
    const currency = currencySel ? Number(currencySel.value || 0) : 0;
    const limits = degeneretteLimits(currency);
    if (!limits) return;

    const spins = this.querySelector('[data-bind="deg-spins-select"]');
    if (spins) {
      const wanted = Number(spins.value || 5) || 5;
      const keep = Math.min(Math.max(wanted, 1), limits.maxSpins);
      // Options are createElement'd (no innerHTML with interpolated values).
      spins.textContent = '';
      for (let n = 1; n <= limits.maxSpins; n++) {
        const opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = String(n);
        if (n === keep) opt.selected = true;
        spins.appendChild(opt);
      }
      spins.value = String(keep);
    }

    const amount = this.querySelector('[name="deg-amount"]');
    if (amount) {
      amount.setAttribute('min', limits.minLabel);
      // Step one notch below the minimum so the spinner can reach it exactly.
      amount.setAttribute('step', currency === 0 ? '0.001' : '1');
      const current = Number(amount.value);
      if (!Number.isFinite(current) || current < Number(limits.minLabel)) {
        amount.value = limits.minLabel;
      }
    }
    this.#renderPlaceLabel();
    this.#renderStepperState();
  }

  #renderStepperState() {
    const currency = Number(this.querySelector('[name="deg-currency"]')?.value || 0);
    const limits = degeneretteLimits(currency);
    if (!limits) return;
    const amount = Number(this.querySelector('[name="deg-amount"]')?.value || 0);
    const spins = Number(this.querySelector('[name="deg-ticket-count"]')?.value || 5);
    const amountDown = this.querySelector('[data-bind="deg-amount-down"]');
    const spinsDown = this.querySelector('[data-bind="deg-spins-down"]');
    const spinsUp = this.querySelector('[data-bind="deg-spins-up"]');
    if (amountDown) amountDown.disabled = amount <= Number(limits.minLabel);
    if (spinsDown) spinsDown.disabled = spins <= 1;
    if (spinsUp) spinsUp.disabled = spins >= limits.maxSpins;
  }

  #stepBetAmount(direction) {
    const input = this.querySelector('[name="deg-amount"]');
    if (!input) return;
    const currency = Number(this.querySelector('[name="deg-currency"]')?.value || 0);
    const limits = degeneretteLimits(currency);
    const stepText = String(limits?.minLabel || input.getAttribute('step') || '1');
    const step = Number(stepText);
    const min = Number(input.getAttribute('min') || 0);
    const current = Number(input.value);
    const decimals = stepText.includes('.') ? stepText.split('.')[1].length : 0;
    const next = Math.max(min, (Number.isFinite(current) ? current : min) + direction * step);
    input.value = decimals > 0
      ? next.toFixed(decimals).replace(/\.?0+$/, '')
      : String(Math.round(next));
    this.#persistBetPreference(currency);
    this.#renderPlaceLabel();
    this.#renderStepperState();
  }

  #stepSpinCount(direction) {
    const input = this.querySelector('[name="deg-ticket-count"]');
    const currency = Number(this.querySelector('[name="deg-currency"]')?.value || 0);
    const limits = degeneretteLimits(currency);
    if (!input || !limits) return;
    const current = Number(input.value || 5) || 5;
    input.value = String(Math.min(limits.maxSpins, Math.max(1, current + direction)));
    this.#renderPlaceLabel();
    this.#renderStepperState();
  }

  #renderPlaceLabel() {
    const button = this.querySelector('[data-bind="deg-place-cta"]');
    if (!button) return;
    const amount = Number(this.querySelector('[name="deg-amount"]')?.value || 0);
    const spins = Math.max(1, Number(this.querySelector('[name="deg-ticket-count"]')?.value || 1));
    const currency = Number(this.querySelector('[name="deg-currency"]')?.value || 0);
    const unit = degeneretteLimits(currency)?.unit || 'FLIP';
    const total = amount * spins;
    const formatted = Number.isFinite(total) && total > 0
      ? total.toLocaleString('en-US', { maximumFractionDigits: currency === 0 ? 6 : 0 })
      : '—';
    const verb = this.#state === STATE.PLACING ? 'Placing' : 'Place Bet';
    button.textContent = `${verb} · ${formatted} ${unit}`;
    button.setAttribute(
      'aria-label',
      `${verb} ${formatted} ${unit} total across ${spins} spin${spins === 1 ? '' : 's'}`,
    );
  }

  #renderCurrencyPicker() {
    const selected = String(this.querySelector('[name="deg-currency"]')?.value || '0');
    const isOperator = get('ui.mode') === 'operator';
    for (const value of [0, 1, 3]) {
      const option = this.querySelector(`[data-bind="deg-currency-option-${value}"]`);
      if (!option) continue;
      const active = selected === String(value);
      option.classList?.toggle('is-selected', active);
      option.setAttribute('aria-pressed', active ? 'true' : 'false');
      option.disabled = value === 3 && isOperator;
    }
  }

  #renderCurrencyGate() {
    const isOperator = get('ui.mode') === 'operator';
    const sel = this.querySelector('[name="deg-currency"]');
    const wwxrpOpt = this.querySelector('[data-bind="deg-currency-wwxrp"]');
    if (wwxrpOpt) wwxrpOpt.disabled = isOperator;
    if (sel && isOperator && String(sel.value) === '3') {
      sel.value = '0';
      // A programmatic revert fires no change event — re-derive the bounds so
      // the WWXRP 5-spin cap doesn't stick on an ETH bet.
      this.#applyCurrencySelection(0, { forceReset: true });
    }
    const note = this.querySelector('[data-bind="deg-wwxrp-note"]');
    if (note) note.hidden = !isOperator;
    this.#renderCurrencyPicker();
  }

  // ---------------------------------------------------------------------
  // State machine — drives the compact status and the shared pending tray.
  // ---------------------------------------------------------------------

  #persistPendingBet() {
    if (!this.#pendingAddress || this.#currentBetId == null || this.#currentLootboxIndex == null) return;
    _writePendingBet(this.#pendingAddress, {
      betId: this.#currentBetId,
      index: this.#currentLootboxIndex,
      currency: this.#currentCurrency,
      amountPerSpin: this.#currentAmountPerSpin,
      spinCount: this.#currentSpinCount,
      hero: this.#currentHero,
      ticket: this.#currentTicket,
      rngRequestPending: this.#rngRequestPending,
      rngRequestStartedAt: this.#rngRequestStartedAt,
    });
  }

  #setState(next) {
    // Availability belongs to one awaiting cycle only. A newly placed/restored
    // bet must earn it from a fresh on-chain simulation.
    if (next !== STATE.AWAITING_RNG || this.#state !== STATE.AWAITING_RNG) {
      this.#rngRequestAvailable = false;
    }
    // Once the word exists, the request phase is over. Persist that transition
    // so a refresh cannot resurrect an obsolete waiting progress card.
    if ([STATE.READY, STATE.RESOLVED, STATE.IDLE].includes(next)) {
      const hadPendingRequest = this.#rngRequestPending;
      this.#rngRequestPending = false;
      this.#rngRequestStartedAt = 0;
      if (hadPendingRequest && next === STATE.READY) this.#persistPendingBet();
    }
    this.#state = next;
    this.#renderState();
  }

  #renderState() {
    const stateEl = this.querySelector('[data-bind="deg-state"]');
    // idle → '' (STATE_LABELS.idle is empty): no dead "Idle" line. ?? keeps the
    // empty label instead of falling through to a default.
    if (stateEl) {
      // The fixed pending-action tray owns the whole RNG wait lifecycle. Keep
      // the main wager form still after placement instead of echoing that
      // state in a second bubble above it.
      stateEl.textContent = this.#state === STATE.AWAITING_RNG
        ? ''
        : (STATE_LABELS[this.#state] ?? '');
    }
    const placeBtn = this.querySelector('[data-bind="deg-place-cta"]');
    if (placeBtn) {
      // Placing another bet is safe while an earlier bet waits on RNG or its
      // complete result projection. The contract stores bets by betId; the DB
      // keeps older rows recoverable after the newest active card is retired.
      placeBtn.disabled = (
        this.#state === STATE.PLACING
        || this.#state === STATE.REQUESTING_RNG
        || this.#state === STATE.RESOLVING
      );
      this.#renderPlaceLabel();
    }
    this.#publishPending();
  }

  #publishPending() {
    const resolutionActive = [
      STATE.AWAITING_RNG, STATE.REQUESTING_RNG, STATE.READY, STATE.RESOLVING, STATE.INDEXING,
    ].includes(this.#state) && this.#currentBetId != null;
    if (!resolutionActive || !this.#pendingAddress) {
      clearPendingActions(PENDING_SOURCE);
      return;
    }
    const units = ['ETH', 'FLIP', 'DGNRS', 'WWXRP'];
    const spins = Math.max(1, Number(this.#currentSpinCount || 1));
    const phase = this.#state === STATE.READY
      ? 'result-ready'
      : this.#state === STATE.REQUESTING_RNG
        ? 'requesting-rng'
        : this.#state === STATE.AWAITING_RNG && this.#rngRequestPending
          ? 'waiting-rng'
          : this.#state === STATE.AWAITING_RNG && this.#rngRequestAvailable
            ? 'request-ready'
            : this.#state;
    publishPendingActions(PENDING_SOURCE, [{
      id: `degenerette:${String(this.#currentBetId)}`,
      dismissScope: this.#pendingAddress,
      kind: 'degenerette',
      label: `${spins} spin${spins === 1 ? '' : 's'}`,
      ticketPacked: this.#currentTicket == null ? null : String(this.#currentTicket),
      heroQuadrant: this.#currentHero == null ? null : Number(this.#currentHero) & 3,
      shortLabel: phase === 'waiting-rng'
        ? 'Waiting for RNG'
        : phase === 'requesting-rng'
          ? 'Requesting RNG'
          : phase === 'request-ready'
            ? 'Request RNG'
            : this.#state === STATE.INDEXING
              ? 'Open spins'
            : 'Resolve degen',
      detail: this.#state === STATE.READY
        ? `RNG ready · ${units[this.#currentCurrency] || 'FLIP'} result locked`
        : this.#state === STATE.REQUESTING_RNG
          ? 'Requesting shared RNG on-chain'
        : this.#state === STATE.RESOLVING
          ? 'Resolving on-chain'
          : this.#state === STATE.INDEXING
            ? 'Resolved on-chain · load verified spins'
          : phase === 'waiting-rng'
            ? 'RNG requested · waiting for Chainlink result'
          : this.#rngRequestAvailable
            ? 'RNG request ready'
            : 'Waiting for Chainlink RNG',
      state: [STATE.READY, STATE.INDEXING].includes(this.#state) || this.#rngRequestAvailable
        ? 'ready'
        : [STATE.REQUESTING_RNG, STATE.RESOLVING].includes(this.#state) ? 'busy' : 'waiting',
      phase,
      // The bottom card appears as soon as placement confirms. Waiting is a
      // real player-owned state even before the permissionless request window
      // opens; the same card later lights up for Request RNG / Resolve.
      pinned: [STATE.AWAITING_RNG, STATE.INDEXING].includes(this.#state)
        || phase === 'requesting-rng',
      progress: this.#state === STATE.AWAITING_RNG || phase === 'requesting-rng'
        ? 'indeterminate'
        : null,
      progressStartedAt: this.#rngRequestStartedAt,
      order: 15,
      run: () => this.#onPendingAction(),
    }]);
  }

  async #onPendingAction(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#state !== STATE.INDEXING) {
      await this.#onResolveClick(e);
      return;
    }
    if (this.#busyResolve || this.#currentBetId == null) return;
    this.#busyResolve = true;
    this.#clearError();
    try {
      const opened = await this.#replayIndexedResolution(
        this.#pendingAddress || getActingAddress(),
        this.#currentBetId,
      );
      if (!opened) {
        this.#renderError('The result is confirmed and still indexing. Try OPEN SPINS again shortly.');
        this.#setState(STATE.INDEXING);
        this.#startRngPollCycle();
      }
    } finally {
      setTimeout(() => { this.#busyResolve = false; }, DEBOUNCE_MS);
    }
  }

  // ---------------------------------------------------------------------
  // Place click — stage 1 of two-tx flow.
  // ---------------------------------------------------------------------

  async #onPlaceClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyPlace) return;
    this.#busyPlace = true;
    const previousActive = this.#currentBetId != null
      && [STATE.AWAITING_RNG, STATE.READY, STATE.INDEXING].includes(this.#state)
      ? {
          betId: this.#currentBetId,
          index: this.#currentLootboxIndex,
          currency: this.#currentCurrency,
          amountPerSpin: this.#currentAmountPerSpin,
          spinCount: this.#currentSpinCount,
          hero: this.#currentHero,
          ticket: this.#currentTicket,
          rngWord: this.#currentRngWord,
          rngRequestPending: this.#rngRequestPending,
          rngRequestStartedAt: this.#rngRequestStartedAt,
          state: this.#state,
          address: this.#pendingAddress,
        }
      : null;

    // A new bet becomes the active card. Stop the older card's poll so a late
    // response cannot overwrite the identifiers parsed from this receipt; the
    // older bet remains durable in the player DB snapshot.
    this.#cancelRngPoll();
    const priorOutcome = this.querySelector('[data-bind="deg-outcome"]');
    if (priorOutcome) priorOutcome.textContent = '';
    this.#clearError();
    this.#setState(STATE.PLACING);

    try {
      const currencySel = this.querySelector('[name="deg-currency"]');
      const amountInput = this.querySelector('[name="deg-amount"]');
      const ticketSel = this.querySelector('[name="deg-ticket-count"]');

      const currencyRaw = currencySel ? currencySel.value : '0';
      const currency = currencyRaw === '' || currencyRaw == null ? 0 : Number(currencyRaw);
      // Amount input is in ETH units for ETH currency, FLIP units for FLIP.
      // Both ETH and FLIP use 18-decimal scaling on the wire.
      const amountText = amountInput ? String(amountInput.value || '0') : '0';
      const amountPerTicketWei = parseDegeneretteAmountInput(amountText, currency);
      if (amountPerTicketWei == null || amountPerTicketWei <= 0n) {
        this.#renderError('Amount must be greater than 0.');
        this.#setState(STATE.IDLE);
        return;
      }
      // The parser above reads the decimal string directly into 18-decimal
      // units. ETH is /1M-descaled there for the testnet deployment; token
      // lanes stay unscaled on every chain.
      const ticketRaw = ticketSel ? ticketSel.value : '1';
      const ticketCount = ticketRaw === '' || ticketRaw == null ? 1 : Number(ticketRaw);
      // v48: hero quadrant is mandatory (0-3) — the picker always has one
      // (right-click / "Set as Hero"). Custom ticket packs from picker state.
      const heroQuadrant = this.#dgnHero;
      const customTicket = this.#packCustomTicket();
      // Degenerette shares the purchase panel's funding choice. The write
      // helper re-reads raw claimable on-chain and sends only the wallet
      // shortfall; token wagers never enter the ETH funding waterfall.
      const preferClaimable = currency === 0
        && readPurchaseFundingPriority() === 'claimable';

      const { receipt } = await placeBet({
        currency,
        amountPerTicketWei,
        ticketCount,
        customTicket,
        heroQuadrant,
        preferClaimable,
      });

      // Parse BetPlaced from the real ABI. The canonical parser also accepts
      // tests' log.parsed seam; a parsed-only adapter here made every genuine
      // wallet receipt look empty and stranded otherwise-valid bets.
      const placed = parseBetPlacedFromReceipt(receipt);
      if (placed.length === 0) {
        // The transaction is confirmed, so never invite a duplicate wager.
        // A provider can occasionally return a receipt without decoded/log
        // data; recover its identifiers from the DB snapshot on this poll and
        // subsequent panel polls instead of requiring a manual resolution.
        this.#pendingAddress = getActingAddress()
          ? String(getActingAddress()).toLowerCase()
          : String(get('connected.address') || '').toLowerCase();
        this.#currentBetId = null;
        this.#currentLootboxIndex = null;
        this.#currentCurrency = currency;
        this.#currentAmountPerSpin = amountPerTicketWei;
        this.#currentSpinCount = ticketCount;
        this.#currentHero = heroQuadrant;
        this.#currentTicket = BigInt(customTicket);
        this.#currentRngWord = 0n;
        this.#rngRequestPending = false;
        this.#rngRequestStartedAt = 0;
        this.#setState(STATE.AWAITING_RNG);
        this.#renderError('Bet placed — syncing its RNG status…');
        void this.#recoverPendingBetFromDb();
        setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
        return;
      }
      this.#currentBetId = placed[0].betId;
      this.#currentLootboxIndex = placed[0].index;
      this.#currentCurrency = currency;
      this.#currentAmountPerSpin = amountPerTicketWei;
      this.#currentSpinCount = ticketCount;
      this.#currentHero = heroQuadrant;
      this.#currentTicket = BigInt(customTicket);
      this.#currentRngWord = 0n;
      this.#rngRequestPending = false;
      this.#rngRequestStartedAt = 0;
      this.#pendingAddress = getActingAddress()
        ? String(getActingAddress()).toLowerCase()
        : String(get('connected.address') || '').toLowerCase();
      _writePendingBet(this.#pendingAddress, {
        betId: this.#currentBetId,
        index: this.#currentLootboxIndex,
        currency: this.#currentCurrency,
        amountPerSpin: this.#currentAmountPerSpin,
        spinCount: this.#currentSpinCount,
        hero: this.#currentHero,
        ticket: this.#currentTicket,
      });
      this.#setState(STATE.AWAITING_RNG);
      this.#startRngPollCycle();

      // 250ms post-confirm refetch (CF-06).
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      this.#renderError(compactUiError(error, 'Bet did not go through. Try again.'));
      if (previousActive) {
        this.#currentBetId = previousActive.betId;
        this.#currentLootboxIndex = previousActive.index;
        this.#currentCurrency = previousActive.currency;
        this.#currentAmountPerSpin = previousActive.amountPerSpin;
        this.#currentSpinCount = previousActive.spinCount;
        this.#currentHero = previousActive.hero;
        this.#currentTicket = previousActive.ticket;
        this.#currentRngWord = previousActive.rngWord;
        this.#rngRequestPending = previousActive.rngRequestPending;
        this.#rngRequestStartedAt = previousActive.rngRequestStartedAt;
        this.#pendingAddress = previousActive.address;
        _writePendingBet(this.#pendingAddress, previousActive);
        this.#setState(previousActive.state);
        this.#startRngPollCycle();
      } else {
        this.#setState(STATE.IDLE);
      }
    } finally {
      // Release debounce after window expires.
      setTimeout(() => { this.#busyPlace = false; }, DEBOUNCE_MS);
    }
  }

  // ---------------------------------------------------------------------
  // RNG poll subcycle — the DB supplies the exact hidden word used to rebuild
  // every reel. The deployed GAME intentionally has no public word getter, so
  // an eth_call of the exact resolver is the chain-authoritative readiness
  // fallback while that DB projection catches up.
  // ---------------------------------------------------------------------

  #startRngPollCycle() {
    this.#cancelRngPoll();
    this.#rngPollAbort = new AbortController();
    const ac = this.#rngPollAbort;
    const tick = async () => {
      if (ac.signal.aborted) return;
      try {
        const player = this.#pendingAddress || getActingAddress();
        let bet = null;
        try {
          const response = await fetchJSON(
            `/degenerette/feed?limit=200&player=${encodeURIComponent(String(player || '').toLowerCase())}`,
          );
          bet = mergeDegeneretteFeedItems(response?.items).find((item) => (
          String(item?.player || '').toLowerCase() === String(player || '').toLowerCase()
          && String(item?.betId) === String(this.#currentBetId)
          ));
        } catch (_e) {
          // The chain probes below remain useful during an API restart.
        }
        if (ac.signal.aborted) return;
        const results = Array.isArray(bet?.results) ? bet.results : [];
        const resolvedInFeed = results.some((row) => row?.resultType === 'resolved');
        if (resolvedInFeed) {
          if (await this.#replayIndexedResolution(player, this.#currentBetId, 1)) return;
        }
        let word = 0n;
        try { word = BigInt(bet?.rngWord ?? 0); } catch (_e) { word = 0n; }
        if (word !== 0n) this.#currentRngWord = word;

        // A refresh can restore a bet that another wallet already resolved.
        // Zero is authoritative even if the result feed is a block behind.
        const packed = await readBetInfo({
          player,
          betId: this.#currentBetId,
        }).catch(() => null);
        if (packed != null && packed !== 0n && this.#currentTicket == null) {
          const decoded = dgnDecodePacked(packed);
          if (decoded) {
            this.#currentTicket = decoded.customTicket;
            if (this.#currentHero == null) this.#currentHero = decoded.heroQuadrant;
            this.#persistPendingBet();
            this.#renderState();
          }
        }
        if (packed === 0n) {
          if (await this.#replayIndexedResolution(player, this.#currentBetId, 1)) return;
          // A zero slot by itself is not proof that resolution happened. In
          // particular, the first poll immediately after a shared mid-day RNG
          // request can race the RPC/indexer view and briefly return zero while
          // Chainlink has not supplied a word yet. Only show "Loading spins"
          // after we have positive resolution/readiness evidence; otherwise
          // preserve the honest RNG wait (and its persisted request latch).
          const resolutionKnown = resolvedInFeed
            || word !== 0n
            || this.#currentRngWord !== 0n
            || this.#state === STATE.INDEXING;
          this.#setState(resolutionKnown ? STATE.INDEXING : STATE.AWAITING_RNG);
        } else {
          const ready = word !== 0n || await canResolveBets({
            player,
            betIds: [this.#currentBetId],
          }).catch(() => false);
          if (ready) {
            this.#setState(STATE.READY);
            return;  // stop polling
          }

          // Mid-day RNG is permissionless but gated. When the exact on-chain
          // request simulates successfully, light the same resolve action so a
          // player can start the shared batch instead of waiting forever.
          if (this.#state === STATE.AWAITING_RNG) {
            let requestable = await canRequestLootboxRng().catch(() => false);
            // If the request gate opens again before a word arrives, the prior
            // request is no longer in flight. Restore the actionable request
            // instead of leaving a permanently animated waiting card. A fresh
            // successful receipt gets a grace window: an RPC replica can still
            // simulate the old state for a few reads immediately after mining.
            if (requestable && this.#rngRequestPending) {
              const requestAge = Date.now() - Number(this.#rngRequestStartedAt || 0);
              if (requestAge >= RNG_REQUEST_RECEIPT_GRACE_MS) {
                this.#rngRequestPending = false;
                this.#rngRequestStartedAt = 0;
                this.#persistPendingBet();
              } else {
                requestable = false;
              }
            }
            if (requestable !== this.#rngRequestAvailable) {
              this.#rngRequestAvailable = requestable;
              this.#renderState();
            }
          }
        }
      } catch (_e) {
        // network blip — schedule next tick anyway.
      }
      if (ac.signal.aborted) return;
      this.#rngPollTimer = setTimeout(tick, RNG_POLL_INTERVAL_MS);
      if (this.#rngPollTimer && typeof this.#rngPollTimer.unref === 'function') {
        try { this.#rngPollTimer.unref(); } catch (_) { /* defensive */ }
      }
    };
    tick();
  }

  #cancelRngPoll() {
    if (this.#rngPollAbort) {
      try { this.#rngPollAbort.abort(); } catch (_) { /* defensive */ }
      this.#rngPollAbort = null;
    }
    if (this.#rngPollTimer != null) {
      try { clearTimeout(this.#rngPollTimer); } catch (_) { /* defensive */ }
      this.#rngPollTimer = null;
    }
  }

  // ---------------------------------------------------------------------
  // Resolve click — stage 2 of two-tx flow.
  // ---------------------------------------------------------------------

  async #onResolveClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyResolve) return;
    if (this.#state === STATE.AWAITING_RNG && this.#rngRequestAvailable) {
      await this.#onRequestRng();
      return;
    }
    if (this.#state !== STATE.READY) return;
    if (this.#currentBetId == null) return;
    this.#busyResolve = true;

    this.#clearError();
    this.#setState(STATE.RESOLVING);

    try {
      const player = this.#pendingAddress || getActingAddress();
      const betId = this.#currentBetId;

      // The UI's ready bit only means the RNG word exists. Re-read the actual
      // bet slot before opening a wallet prompt: zero is the chain's definitive
      // "somebody already resolved it" state.
      const packed = await readBetInfo({ player, betId }).catch(() => null);
      if (packed === 0n) {
        if (!(await this.#replayIndexedResolution(player, betId))) {
          // The write is already complete. Do not put the stale Resolve action
          // back or ask for another click; keep watching the exact bet until
          // every verified spin is available, then open the normal reveal.
          const outcomeEl = this.querySelector('[data-bind="deg-outcome"]');
          if (outcomeEl) outcomeEl.textContent = 'Resolved — loading every spin…';
          this.#setState(STATE.INDEXING);
          this.#startRngPollCycle();
        }
        return;
      }

      const candidates = await this.#communityResolveCandidates(player, betId);
      const { receipt } = await resolveCommunityBets({ player, betId, candidates });

      // A community receipt contains results for several owners. Select only
      // the clicked bet for this animation; the other settlements still credit
      // their owners and remain visible in their own histories.
      const wantPlayer = String(player || '').toLowerCase();
      const wantBet = String(betId);
      const resolved = parseBetResolvedFromReceipt(receipt).find(
        (row) => String(row.player || '').toLowerCase() === wantPlayer
          && String(row.betId) === wantBet,
      );
      const spinResults = parseSpinResultsFromReceipt(receipt).filter(
        (row) => String(row.player || '').toLowerCase() === wantPlayer
          && String(row.betId) === wantBet,
      );
      let lootboxLegs = parseOpenLegsFromReceipt(receipt, wantPlayer);
      lootboxLegs = await enrichLootboxBoonLegs(lootboxLegs, {
        player: wantPlayer,
        blockNumber: receipt?.blockNumber ?? null,
      });
      if (resolved) {
        if (!this.#finishResolvedBet(resolved, spinResults, [], lootboxLegs)
          && !(await this.#replayIndexedResolution(player, betId, 1))) {
          const count = Math.max(1, Number(resolved.spinCount || 1n));
          const outcomeEl = this.querySelector('[data-bind="deg-outcome"]');
          if (outcomeEl) outcomeEl.textContent = `Resolved — loading all ${count} spins…`;
          this.#setState(STATE.INDEXING);
          this.#startRngPollCycle();
        }
      } else if (!(await this.#replayIndexedResolution(player, betId, 1))) {
        const outcomeEl = this.querySelector('[data-bind="deg-outcome"]');
        if (outcomeEl) outcomeEl.textContent = 'Resolved — loading every spin…';
        this.#setState(STATE.INDEXING);
        this.#startRngPollCycle();
      }
    } catch (error) {
      const msg = compactUiError(error, 'Resolve did not go through. Try again.');
      // A resolver can win after our state read but before broadcast. The
      // batch's item-zero race gate turns that into a cheap revert; recover the
      // canonical indexed outcome and animate it instead of reporting failure.
      const raced = error?.code === 'BatchAlreadyTaken'
        || /already|taken|no work|nothing to resolve|resolved/i.test(String(msg));
      if (raced && await this.#replayIndexedResolution(
        this.#pendingAddress || getActingAddress(),
        this.#currentBetId,
      )) {
        // Replay completed and retired the row.
      } else if (raced) {
        // Another resolver landed between our preflight and broadcast. That is
        // a successful resolution from the player's perspective; automatically
        // follow its events instead of surfacing a failed tx or another button.
        const outcomeEl = this.querySelector('[data-bind="deg-outcome"]');
        if (outcomeEl) outcomeEl.textContent = 'Resolved — loading every spin…';
        this.#setState(STATE.INDEXING);
        this.#startRngPollCycle();
      } else {
        this.#renderError(msg);
        this.#setState(STATE.READY);
      }
    } finally {
      setTimeout(() => { this.#busyResolve = false; }, DEBOUNCE_MS);
    }
  }

  async #onRequestRng() {
    if (this.#busyResolve || this.#currentBetId == null) return;
    this.#busyResolve = true;
    this.#clearError();
    this.#setState(STATE.REQUESTING_RNG);
    let requestAccepted = false;
    try {
      await requestLootboxRng();
      requestAccepted = true;
    } catch (error) {
      // A competing request between simulation and broadcast is success from
      // this player's perspective; resume the wait without a loud red wall.
      const msg = compactUiError(error, 'RNG request did not go through.');
      requestAccepted = /in flight|already|locked/i.test(String(msg));
      if (!requestAccepted) this.#renderError(msg);
    } finally {
      this.#rngRequestPending = requestAccepted;
      this.#rngRequestStartedAt = requestAccepted
        ? (this.#rngRequestStartedAt || Date.now())
        : 0;
      this.#persistPendingBet();
      this.#setState(STATE.AWAITING_RNG);
      this.#startRngPollCycle();
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
      setTimeout(() => { this.#busyResolve = false; }, DEBOUNCE_MS);
    }
  }

  #finishResolvedBet(resolved, spinResults, resultTickets = [], lootboxLegs = []) {
    const spins = Array.isArray(spinResults) ? spinResults : [];
    const outcomeEl = this.querySelector('[data-bind="deg-outcome"]');
    const resolvedBetId = resolved?.betId ?? this.#currentBetId;
    const resolvedPlayer = String(
      resolved?.player || this.#pendingAddress || getActingAddress() || '',
    ).toLowerCase();
    const presentationKey = resolvedPlayer && resolvedBetId != null
      ? `${resolvedPlayer}:${String(resolvedBetId)}`
      : null;
    if (presentationKey && this.#presentedBetKeys.has(presentationKey)) return true;
    // Do not retire the pending bet or start a shortened animation. A summary
    // may be visible one projection before its final per-spin row; the replay
    // path will fetch the exact complete event set.
    const sequence = buildDegeneretteRevealSequence({
      resolvedEntry: resolved,
      spinResults: spins,
      resultTickets,
      rngWord: this.#currentRngWord,
      betIndex: this.#currentLootboxIndex,
      currency: this.#currentCurrency,
      amountPerSpin: this.#currentAmountPerSpin,
      heroQuadrant: this.#currentHero == null ? this.#dgnHero : this.#currentHero,
    });
    if (!sequence) return false;
    const directBoxLegs = Array.isArray(lootboxLegs) ? lootboxLegs.filter(Boolean) : [];
    sequence.lootboxAwarded = directBoxLegs.length > 0;
    sequence.lootboxLegs = directBoxLegs;
    sequence.lootboxEth = degeneretteLootboxEthFromLegs(directBoxLegs);
    const lootboxRelease = degeneretteLootboxRelease(
      resolvedPlayer,
      directBoxLegs,
      resolved?.transactionHash,
    );
    const lootboxPresentationId = degeneretteLootboxPresentationId(
      resolvedPlayer,
      resolvedBetId,
    );
    if (outcomeEl) outcomeEl.textContent = '';
    const completesActiveSlot = this.#currentBetId == null
      || resolvedBetId == null
      || String(this.#currentBetId) === String(resolvedBetId);
    // Do not retire a player-owned result unless the full-screen queue accepts
    // it. This keeps OPEN SPINS available if the reveal surface is temporarily
    // unavailable instead of silently dropping a confirmed result.
    if (!queueReveal(sequence)) return false;
    if (presentationKey) this.#presentedBetKeys.add(presentationKey);
    if (completesActiveSlot) _writePendingBet(this.#pendingAddress, null);
    if (directBoxLegs.length > 0) {
      const address = this.#pendingAddress || getActingAddress();
      recordLootboxTicketPacks({
        address,
        legs: directBoxLegs,
        sourceKey: `degenerette:${String(resolvedBetId ?? '')}`,
        settledExpected: true,
      }).catch(() => {});
      // The contract has already settled this recirculated box in the resolve
      // transaction. Keep its contents sealed in presentation, directly after
      // the reels, so OPEN LOOTBOX reveals the real emitted rewards without a
      // second wallet transaction.
      queueReveal({
        kind: 'lootbox',
        title: 'DEGENERETTE LOOTBOX',
        legs: directBoxLegs,
        settledExpected: true,
        // OPEN LOOTBOX on the finished Degenerette board arms this already
        // settled sequence's autoStart path. It plays the case animation once,
        // then reveals the emitted rewards without another click or wallet tx.
        ...(lootboxRelease
          ? { lootboxRelease }
          : lootboxPresentationId ? { presentationId: lootboxPresentationId } : {}),
      });
    }
    // The overlay has accepted the complete audit trail. Release this active
    // slot immediately so another older pending bet can light up while the
    // player is watching the reveal.
    if (completesActiveSlot) {
      this.#cancelRngPoll();
      this.#currentBetId = null;
      this.#currentLootboxIndex = null;
      this.#currentTicket = null;
      this.#currentRngWord = 0n;
      this.#setState(STATE.IDLE);
      void this.#recoverPendingBetFromDb();
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    }
    return true;
  }

  async #communityResolveCandidates(player, primaryBetId) {
    let items = [];
    try {
      const response = await fetchJSON('/degenerette/feed?limit=200');
      items = mergeDegeneretteFeedItems(response?.items);
    } catch (_e) {
      return [];
    }

    const out = [];
    const primaryKey = `${String(player || '').toLowerCase()}:${String(primaryBetId)}`;
    let spinBudget = Math.max(1, Number(this.#currentSpinCount || 1));
    for (const item of items) {
      if (out.length + 1 >= COMMUNITY_MAX_BETS) break;
      const owner = String(item?.player || '');
      if (!/^0x[0-9a-fA-F]{40}$/.test(owner) || item?.betId == null) continue;
      // A player's other unresolved bets need their own result sequence. If
      // they ride along in this community batch, their LootBox events would
      // otherwise be indistinguishable from the primary bet's direct box in
      // the shared resolve receipt.
      if (owner.toLowerCase() === String(player || '').toLowerCase()) continue;
      const key = `${owner.toLowerCase()}:${String(item.betId)}`;
      if (key === primaryKey) continue;
      const results = Array.isArray(item?.results) ? item.results : [];
      if (results.some((result) => result?.resultType === 'resolved')) continue;
      const decoded = dgnDecodePacked(item?.packedData);
      const spins = Math.max(1, Number(decoded?.spinCount || 1));
      if (spinBudget + spins > COMMUNITY_MAX_SPINS) continue;
      spinBudget += spins;
      out.push({ player: owner, betId: item.betId });
    }
    return out;
  }

  async #replayIndexedResolution(player, betId, retries = INDEX_REPLAY_RETRIES) {
    if (!player || betId == null) return false;
    const wantPlayer = String(player).toLowerCase();
    const wantBet = String(betId);

    const replayFromChain = async () => {
      const replay = await readResolvedBet({ player, betId }).catch(() => null);
      if (!replay?.resolved) return false;
      const complete = normalizeDegeneretteSpinResults(
        replay.spins,
        replay.resolved.spinCount,
        { player, betId },
      );
      if (!complete.complete) return false;
      let lootboxLegs = parseOpenLegsFromReceipt(replay.receipt, player);
      lootboxLegs = await enrichLootboxBoonLegs(lootboxLegs, {
        player,
        blockNumber: replay.receipt?.blockNumber ?? replay.resolved?.blockNumber ?? null,
      });
      return this.#finishResolvedBet(replay.resolved, complete.spins, [], lootboxLegs);
    };

    // Exact player+betId topics are complete immediately after a receipt and
    // bypass stale API workers that ignore the player query entirely.
    if (await replayFromChain()) return true;

    for (let attempt = 0; attempt < retries; attempt += 1) {
      let items = [];
      try {
        items = await fetchDegenerettePlayerFeed(wantPlayer, {
          betId: wantBet,
          targetResolved: 1,
          maxPages: 4,
        });
      } catch (_e) { /* retry below */ }

      const bet = items.find((item) => String(item?.player || '').toLowerCase() === wantPlayer
        && String(item?.betId) === wantBet
        && (Array.isArray(item?.results) ? item.results : [])
          .some((result) => result?.resultType === 'resolved'));
      if (bet) {
        const decoded = dgnDecodePacked(bet.packedData);
        if (bet.betIndex != null) {
          try { this.#currentLootboxIndex = BigInt(bet.betIndex); } catch (_e) { /* malformed feed row */ }
        }
        if (decoded) {
          this.#currentCurrency = decoded.currency;
          this.#currentAmountPerSpin = decoded.amountPerSpin;
          this.#currentSpinCount = Math.max(1, decoded.spinCount);
          this.#currentHero = decoded.heroQuadrant;
          this.#currentTicket = decoded.customTicket;
        }
        const results = Array.isArray(bet.results) ? bet.results : [];
        const resolvedRow = results.find((result) => result?.resultType === 'resolved');
        const data = resolvedRow?.resultData || {};
        let resolved;
        try {
          resolved = {
            player,
            betId: BigInt(betId),
            spinCount: BigInt(data.spinCount ?? decoded?.spinCount ?? 1),
            totalPayout: BigInt(data.totalPayout ?? resolvedRow?.payout ?? 0),
            resultTraits: BigInt(data.resultTraits ?? data.resultTicket ?? 0),
            transactionHash: resolvedRow?.transactionHash || null,
          };
        } catch (_e) {
          resolved = null;
        }
        const complete = normalizeDegeneretteSpinResults(
          results.filter((row) => row?.resultType === 'result'),
          resolved?.spinCount ?? decoded?.spinCount ?? 1,
          { player, betId },
        );
        if (resolved) {
          // The DB owns both the fulfilled word and the replayed house reels;
          // either one is sufficient for a verified multi-spin presentation.
          if (this.#currentRngWord === 0n && this.#currentLootboxIndex != null) {
            try { this.#currentRngWord = BigInt(bet.rngWord ?? 0); }
            catch (_e) { this.#currentRngWord = 0n; }
          }
          let replayLootboxLegs = openLegsFromDegenerettePayouts(bet.lootboxPayouts);
          replayLootboxLegs = await enrichLootboxBoonLegs(replayLootboxLegs, {
            player,
            blockNumber: resolvedRow?.blockNumber ?? null,
          });
          if (complete.complete
            && this.#finishResolvedBet(
              resolved,
              complete.spins,
              bet.resultTickets,
              replayLootboxLegs,
            )) {
            return true;
          }
        }
      }

      if (attempt + 1 < retries) {
        await new Promise((resolve) => setTimeout(resolve, INDEX_REPLAY_DELAY_MS));
      }
    }
    // One final exact read covers an RPC head that was a block behind at the
    // beginning of the loop without repeatedly scanning logs on every retry.
    return replayFromChain();
  }

  // ---------------------------------------------------------------------
  // Results surface. Two feeds into the same in-widget surface:
  //   - #showReceiptResults: the just-resolved bet (from receipt events);
  //   - #onResultsClick: history from GET /degenerette/feed (canonical
  //     resultData keys: resolved → {spinCount, totalPayout, resultTraits},
  //     result → {matches, spinIndex, playerTraits} + row payout).
  // All server-derived strings via textContent (T-58-18).
  // ---------------------------------------------------------------------

  #enterResultsMode({
    payoutWei = null,
    currency = 0,
    meta = '',
    eyebrow = 'ROUND WINNINGS',
  } = {}) {
    const setup = this.querySelector('[data-bind="deg-setup"]');
    const summary = this.querySelector('[data-bind="dgn-results-summary"]');
    const eyebrowEl = this.querySelector('[data-bind="dgn-results-eyebrow"]');
    const total = this.querySelector('[data-bind="dgn-results-total"]');
    const metaEl = this.querySelector('[data-bind="dgn-results-meta"]');
    this.#resultsMode = true;
    if (setup) setup.hidden = true;
    if (summary) summary.hidden = false;
    if (eyebrowEl) eyebrowEl.textContent = String(eyebrow || 'ROUND WINNINGS');
    if (total) {
      total.textContent = payoutWei == null ? '—' : this.#payoutText(payoutWei, currency);
      total.classList?.toggle('is-win', payoutWei != null && BigInt(payoutWei || 0) > 0n);
    }
    if (metaEl) metaEl.textContent = String(meta || '');
  }

  #exitResultsMode() {
    this.#resultsMode = false;
    const setup = this.querySelector('[data-bind="deg-setup"]');
    const summary = this.querySelector('[data-bind="dgn-results-summary"]');
    const panel = this.querySelector('[data-bind="dgn-results-panel"]');
    if (setup) setup.hidden = false;
    if (summary) summary.hidden = true;
    if (panel) panel.hidden = true;
    this.#clearInlineSpin();
    const outcome = this.querySelector('[data-bind="deg-outcome"]');
    if (outcome) outcome.textContent = '';
    this.#renderState();
  }

  #openResultsPanel(title, summary = {}) {
    const panel = this.querySelector('[data-bind="dgn-results-panel"]');
    const titleEl = this.querySelector('[data-bind="dgn-results-title"]');
    const body = this.querySelector('[data-bind="dgn-results-body"]');
    if (!panel || !body) return null;
    this.#enterResultsMode(summary);
    const inline = this.querySelector('[data-bind="dgn-inline-spin"]');
    if (inline) inline.hidden = true;
    if (titleEl) titleEl.textContent = String(title || 'Results');
    body.textContent = '';
    panel.hidden = false;
    return body;
  }

  #closeResultsPanel() {
    const panel = this.querySelector('[data-bind="dgn-results-panel"]');
    if (panel) panel.hidden = true;
  }

  #payoutText(wei, currency) {
    try {
      if (currency === 0) return `${displayEth(BigInt(wei ?? 0))} ETH`;
      const label = currency === 3 ? 'WWXRP' : 'FLIP';
      return `${displayTokenSnapped(BigInt(wei ?? 0))} ${label}`;
    } catch (_e) {
      return String(wei ?? 0);
    }
  }

  #signedPayoutText(wei, currency) {
    let value = 0n;
    try { value = BigInt(wei ?? 0); } catch (_e) { value = 0n; }
    const sign = value > 0n ? '+' : value < 0n ? '−' : '';
    return `${sign}${this.#payoutText(value < 0n ? -value : value, currency)}`;
  }

  // One 4-quadrant mini ticket card. matchStates colors the player side;
  // pass null for the house side (the house IS truth). heroIdx enlarges the
  // player's hero quadrant.
  #buildTicketCard(traits, matchStates, heroIdx) {
    const card = document.createElement('div');
    card.className = 'dgn-result-card';
    applyDgnTicketAccent(card, traits);
    for (let q = 0; q < 4; q++) {
      const cell = document.createElement('div');
      cell.className = 'dgn-rq';
      if (matchStates) cell.classList.add(`q-${matchStates[q]}`);
      if (heroIdx === q) cell.classList.add('q-hero');
      const t = traits[q];
      if (t) {
        const img = document.createElement('img');
        img.src = dgnBadgePath(q, t.sym, t.col);
        img.alt = '';
        cell.appendChild(img);
      }
      card.appendChild(cell);
    }
    const center = document.createElement('div');
    center.className = 'dgn-result-center';
    const flame = document.createElement('img');
    flame.src = '/whitepaper/flame-center.svg';
    flame.alt = '';
    center.appendChild(flame);
    card.appendChild(center);
    return card;
  }

  #clearInlineSpin() {
    this.#inlineRunToken += 1;
    this.#inlineBusy = false;
    this.#inlineBoard = null;
    this.#inlineNextSpin = 0;
    this.#inlineViewedSpin = null;
    this.#setInlineSpinning(false);
    const host = this.querySelector('[data-bind="dgn-inline-spin"]');
    if (host) host.hidden = true;
  }

  #setInlineSpinning(spinning) {
    const host = this.querySelector('[data-bind="dgn-inline-spin"]');
    const summary = this.querySelector('[data-bind="dgn-results-summary"]');
    host?.classList?.toggle('is-spinning', Boolean(spinning));
    summary?.classList?.toggle('is-spinning', Boolean(spinning));
  }

  #setInlineOutcome(row = null) {
    const host = this.querySelector('[data-bind="dgn-inline-spin"]');
    if (!host?.classList) return;
    host.classList.remove('has-win-result', 'has-miss-result');
    if (!row) return;
    host.classList.add(BigInt(row.payout || 0n) > 0n
      ? 'has-win-result'
      : 'has-miss-result');
  }

  #inlineWait(ms) {
    return new Promise((resolve) => {
      const h = setTimeout(resolve, ms);
      if (h && typeof h.unref === 'function') {
        try { h.unref(); } catch (_e) { /* browser timer */ }
      }
    });
  }

  #renderInlineTicket(bind, traits, matchStates = null, heroIdx = null, {
    rolling = false,
    unknown = false,
    lockFrame = null,
    matchPulse = false,
    landed = false,
  } = {}) {
    const host = this.querySelector(`[data-bind="${bind}"]`);
    if (!host) return;
    host.textContent = '';
    const card = this.#buildTicketCard(
      traits || [null, null, null, null],
      matchStates,
      heroIdx,
    );
    if (rolling && card.classList) card.classList.add('dgn-inline-ticket--rolling');
    if (matchPulse && card.classList) card.classList.add('dgn-inline-ticket--match');
    if (landed && card.classList) card.classList.add('dgn-inline-ticket--landed');
    if (lockFrame) {
      const cells = Array.from(card.querySelectorAll?.('.dgn-rq') || []);
      for (let q = 0; q < cells.length; q += 1) {
        if (lockFrame.lockedColors?.[q]) cells[q].classList.add('dgn-lock-color');
        if (lockFrame.lockedSymbols?.[q]) cells[q].classList.add('dgn-lock-symbol');
      }
    }
    if (unknown && card.classList) {
      card.classList.add('dgn-inline-ticket--unknown');
      for (const cell of Array.from(card.querySelectorAll?.('.dgn-rq') || [])) {
        cell.textContent = '?';
      }
    }
    host.appendChild(card);
  }

  #renderInlineRow(row, { settled = false, frame = null } = {}) {
    let states = null;
    let matchingLocks = 0;
    let liveScore = 0;
    let lockMatched = false;
    const playerTraits = dgnUnpackTicket(row.playerTraits);
    const targetTraits = row.houseTraits == null ? null : dgnUnpackTicket(row.houseTraits);
    if (settled && row.houseTraits != null) {
      states = dgnScoringMatchStates(
        playerTraits,
        targetTraits,
      );
    } else if (frame && row.houseTraits != null) {
      const finalStates = dgnScoringMatchStates(playerTraits, targetTraits);
      states = targetTraits.map((_trait, q) => {
        const colorLocked = Boolean(frame.lockedColors?.[q]);
        const symbolLocked = Boolean(frame.lockedSymbols?.[q]);
        const colorMatch = playerTraits[q].col === targetTraits[q].col;
        const symbolMatch = playerTraits[q].sym === targetTraits[q].sym;
        if (colorLocked && colorMatch) matchingLocks += 1;
        if (symbolLocked && symbolMatch) matchingLocks += 1;
        if (symbolLocked && symbolMatch) {
          liveScore += (this.#inlineBoard?.heroIdx === q ? 2 : 1);
          if (colorLocked && colorMatch) liveScore += 1;
        }
        if (colorLocked && symbolLocked) return finalStates[q];
        if (colorLocked) return colorMatch ? 'lock-hit' : 'lock-miss';
        if (symbolLocked) return symbolMatch ? 'lock-hit' : 'lock-miss';
        return 'rolling';
      });
      if (frame.lock) {
        const q = frame.lock.quadrant;
        const symbolMatch = playerTraits[q].sym === targetTraits[q].sym;
        lockMatched = frame.lock.type === 'color'
          ? symbolMatch && playerTraits[q].col === targetTraits[q].col
          : symbolMatch;
      }
    }
    this.#renderInlineTicket(
      'dgn-inline-player',
      playerTraits,
      states,
      this.#inlineBoard?.heroIdx ?? null,
      {
        lockFrame: frame,
        matchPulse: Boolean(frame?.lock && lockMatched && matchingLocks >= 3),
        landed: settled,
      },
    );
    if (settled) {
      this.#renderInlineTicket(
        'dgn-inline-house',
        row.houseTraits == null ? null : dgnUnpackTicket(row.houseTraits),
        states,
        null,
        { unknown: row.houseTraits == null, landed: row.houseTraits != null },
      );
    } else if (frame == null) {
      this.#renderInlineTicket(
        'dgn-inline-house',
        null,
        null,
        null,
        { unknown: true },
      );
    } else {
      this.#renderInlineTicket(
        'dgn-inline-house',
        frame.traits,
        states,
        null,
        {
          rolling: true,
          lockFrame: frame,
          matchPulse: Boolean(frame.lock && lockMatched && matchingLocks >= 3),
        },
      );
    }
    this.#setInlineOutcome(settled ? row : null);
    return { matchingLocks, liveScore, lockMatched };
  }

  #updateInlineRunningTotal(revealedCount) {
    const board = this.#inlineBoard;
    if (!board) return;
    const count = Math.max(0, Math.min(board.rows.length, Number(revealedCount) || 0));
    const faceTotal = board.rows.slice(0, count)
      .reduce((sum, row) => sum + BigInt(row.payout || 0n), 0n);
    const eyebrow = this.querySelector('[data-bind="dgn-results-eyebrow"]');
    const total = this.querySelector('[data-bind="dgn-results-total"]');
    const meta = this.querySelector('[data-bind="dgn-results-meta"]');
    const complete = count >= board.rows.length;
    const settledTotal = complete ? BigInt(board.totalPayout || 0n) : faceTotal;
    const hits = board.rows.slice(0, count)
      .filter((row) => BigInt(row.payout || 0n) > 0n).length;
    const survivalBust = complete && board.currency === 1 && hits > 0 && settledTotal === 0n;
    if (eyebrow) eyebrow.textContent = complete ? 'ROUND PAYOUT' : 'WON SO FAR';
    if (total) {
      total.textContent = this.#payoutText(settledTotal, board.currency);
      total.classList?.toggle('is-win', settledTotal > 0n);
    }
    if (meta) {
      meta.textContent = count === 0
        ? 'Reveal the first spin to uncover the round size'
        : complete
        ? survivalBust
          ? `${hits} hit${hits === 1 ? '' : 's'} · survival flip lost`
          : `${hits} hit${hits === 1 ? '' : 's'} across ${board.rows.length} spin${board.rows.length === 1 ? '' : 's'}`
        : `${count} of ${board.rows.length} spins revealed`;
    }
  }

  #renderInlineHistory(revealedCount) {
    const host = this.querySelector('[data-bind="dgn-inline-history"]');
    const board = this.#inlineBoard;
    if (!host || !board) return;
    host.textContent = '';
    const count = Math.max(0, Math.min(board.rows.length, Number(revealedCount) || 0));
    board.rows.slice(0, count).forEach((row, rowIndex) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const won = BigInt(row.payout || 0n) > 0n;
      chip.className = `dgn-inline-spin__history-chip ${won ? 'is-win' : 'is-miss'}`;
      if (rowIndex === this.#inlineViewedSpin) chip.classList?.add('is-selected');
      chip.textContent = won
        ? `SCORE: ${row.score} · +${this.#payoutText(row.payout, board.currency)}`
        : `SCORE: ${row.score}`;
      chip.setAttribute('aria-pressed', rowIndex === this.#inlineViewedSpin ? 'true' : 'false');
      chip.setAttribute('aria-label', `Show revealed spin ${rowIndex + 1}: ${chip.textContent}`);
      chip.addEventListener('click', () => this.#showInlineHistorySpin(rowIndex));
      host.appendChild(chip);
    });
  }

  #showInlineHistorySpin(rowIndex) {
    const board = this.#inlineBoard;
    const index = Number(rowIndex);
    if (!board || this.#inlineBusy || !Number.isInteger(index)
      || index < 0 || index >= this.#inlineNextSpin) return;
    const row = board.rows[index];
    if (!row) return;
    this.#inlineViewedSpin = index;
    this.#renderInlineRow(row, { settled: true });
    this.#renderInlineHistory(this.#inlineNextSpin);
  }

  #showInlinePop(row) {
    const pop = this.querySelector('[data-bind="dgn-inline-pop"]');
    const board = this.#inlineBoard;
    if (!pop || !board) return;
    const won = row.payout > 0n;
    pop.textContent = won ? `+${this.#payoutText(row.payout, board.currency)}` : '';
    pop.className = `dgn-inline-spin__pop ${won ? 'is-win' : 'is-miss'}`;
    if (!won) return;
    pop.classList?.remove('is-show');
    void pop.offsetWidth;
    pop.classList?.add('is-show');
  }

  #primeInlineBoard() {
    const board = this.#inlineBoard;
    if (!board || board.rows.length === 0) return;
    this.#enterResultsMode({
      payoutWei: 0n,
      currency: board.currency,
      meta: 'Reveal the first spin to uncover the round size',
      eyebrow: 'WON SO FAR',
    });
    this.#closeResultsPanel();
    this.#inlineRunToken += 1;
    this.#inlineBusy = false;
    this.#inlineNextSpin = 0;
    this.#inlineViewedSpin = null;
    this.#setInlineSpinning(false);
    this.#setInlineOutcome(null);
    const host = this.querySelector('[data-bind="dgn-inline-spin"]');
    const spin = this.querySelector('[data-bind="dgn-inline-spin-cta"]');
    const skip = this.querySelector('[data-bind="dgn-inline-skip-cta"]');
    if (host) host.hidden = false;
    if (spin) {
      spin.hidden = false;
      spin.disabled = false;
      spin.textContent = 'SPIN';
    }
    if (skip) {
      skip.hidden = false;
      skip.disabled = false;
    }
    const pop = this.querySelector('[data-bind="dgn-inline-pop"]');
    if (pop) {
      pop.textContent = '';
      pop.className = 'dgn-inline-spin__pop';
    }
    this.#renderInlineHistory(0);
    this.#updateInlineRunningTotal(0);
    this.#renderInlineRow(board.rows[0]);
    const outcome = this.querySelector('[data-bind="deg-outcome"]');
    if (outcome) outcome.textContent = '';
    this.#publishPending();
  }

  #finishInlineBoard(lastRow = null) {
    const board = this.#inlineBoard;
    if (!board) return;
    const biggestHitIndex = board.rows.reduce((best, row, index, rows) => (
      BigInt(row.payout || 0n) > BigInt(rows[best]?.payout || 0n) ? index : best
    ), 0);
    if (BigInt(board.rows[biggestHitIndex]?.payout || 0n) > 0n) {
      this.#inlineViewedSpin = biggestHitIndex;
      this.#renderInlineRow(board.rows[biggestHitIndex], { settled: true });
    }
    this.#updateInlineRunningTotal(board.rows.length);
    this.#renderInlineHistory(board.rows.length);
    const spin = this.querySelector('[data-bind="dgn-inline-spin-cta"]');
    const skip = this.querySelector('[data-bind="dgn-inline-skip-cta"]');
    if (spin) {
      spin.hidden = false;
      spin.disabled = false;
      spin.textContent = 'REPLAY';
    }
    if (skip) skip.hidden = true;
    const outcome = this.querySelector('[data-bind="deg-outcome"]');
    if (outcome) outcome.textContent = '';
    const boardBet = board.betId == null ? null : String(board.betId);
    if (boardBet != null
      && this.#currentBetId != null
      && boardBet === String(this.#currentBetId)
      && this.#state === STATE.RESOLVED) {
      // The active result has been consumed. Release its in-memory slot so the
      // DB snapshot can surface the next older unresolved bet when a player
      // placed several wagers while RNG was pending.
      this.#currentBetId = null;
      this.#currentLootboxIndex = null;
      this.#currentRngWord = 0n;
      this.#setState(STATE.IDLE);
      void this.#recoverPendingBetFromDb();
    } else {
      this.#publishPending();
    }
  }

  async #onInlineSpinClick() {
    const board = this.#inlineBoard;
    if (!board || this.#inlineBusy) return;
    if (this.#inlineNextSpin >= board.rows.length) {
      this.#primeInlineBoard();
      return;
    }
    this.#inlineBusy = true;
    _initInlineAudio();
    this.#setInlineSpinning(true);
    const token = ++this.#inlineRunToken;
    const row = board.rows[this.#inlineNextSpin];
    const spin = this.querySelector('[data-bind="dgn-inline-spin-cta"]');
    if (spin) spin.disabled = true;

    try {
      if (row.houseTraits != null) {
        const reducedMotion = Boolean(
          globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
        );
        const plan = buildDegeneretteSpinFrames({
          playerTraits: row.playerTraits,
          houseTraits: row.houseTraits,
          spinIndex: row.spinIndex,
          idleMin: 2,
          idleMax: 4,
        });
        const frames = reducedMotion ? plan.slice(-1) : plan;
        let matchSoundCount = 0;
        for (const frame of frames) {
          if (token !== this.#inlineRunToken) return;
          const live = this.#renderInlineRow(row, { frame });
          if (frame.lock && !reducedMotion) {
            if (live.lockMatched) {
              matchSoundCount = Math.min(8, matchSoundCount + 1);
              _playInlineSound(`match${matchSoundCount}`);
            } else {
              _playInlineSound('click');
            }
          }
          if (!reducedMotion) await this.#inlineWait(INLINE_SPIN_FRAME_MS);
        }
      }
      if (token !== this.#inlineRunToken) return;
      this.#renderInlineRow(row, { settled: true });
      const revealedIndex = this.#inlineNextSpin;
      this.#inlineNextSpin += 1;
      this.#inlineViewedSpin = revealedIndex;
      this.#renderInlineHistory(this.#inlineNextSpin);
      this.#updateInlineRunningTotal(this.#inlineNextSpin);
      this.#showInlinePop(row);
      if (!globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
        await this.#inlineWait(140);
      }
      if (token !== this.#inlineRunToken) return;
      _playInlineSound(row.score >= 3 || BigInt(row.payout || 0n) > 0n ? 'win' : 'lose');

      if (this.#inlineNextSpin >= board.rows.length) {
        this.#finishInlineBoard(row);
      } else {
        if (spin) {
          spin.disabled = false;
          spin.textContent = 'NEXT SPIN';
        }
      }
    } finally {
      if (token === this.#inlineRunToken) {
        this.#inlineBusy = false;
        this.#setInlineSpinning(false);
      }
    }
  }

  #skipInlineSpins() {
    const board = this.#inlineBoard;
    if (!board || board.rows.length === 0) return;
    this.#inlineRunToken += 1;
    this.#inlineBusy = false;
    this.#setInlineSpinning(false);
    this.#inlineNextSpin = board.rows.length;
    const last = board.rows[board.rows.length - 1];
    this.#inlineViewedSpin = board.rows.length - 1;
    this.#renderInlineRow(last, { settled: true });
    this.#showInlinePop(last);
    this.#finishInlineBoard(last);
  }

  #stageHistoryReplay(replay) {
    const spins = Array.isArray(replay?.spins) ? replay.spins : [];
    const rows = spins
      .map((spin, i) => {
        let payout = 0n;
        try { payout = BigInt(spin?.payout ?? 0); } catch (_e) { payout = 0n; }
        return {
          spinIndex: Number(spin?.spinIndex ?? i),
          playerTraits: Number(spin?.playerTraits ?? 0) >>> 0,
          houseTraits: spin?.houseTraits == null
            ? null
            : Number(spin.houseTraits) >>> 0,
          score: Number(spin?.score ?? 0),
          payout,
        };
      })
      .sort((a, b) => a.spinIndex - b.spinIndex);
    const expected = Math.max(1, Number(replay?.spinCount ?? rows.length ?? 1));
    const indexes = new Set(rows.map((row) => row.spinIndex));
    if (rows.length !== expected
      || rows.some((row) => row.houseTraits == null)
      || Array.from({ length: expected }, (_, spin) => indexes.has(spin)).some((ok) => !ok)) {
      return;
    }

    let amountPerSpin = 0n;
    let totalWager = 0n;
    let totalPayout = 0n;
    try { amountPerSpin = BigInt(replay?.amountPerSpin ?? 0); } catch (_e) { amountPerSpin = 0n; }
    try { totalWager = BigInt(replay?.totalWager ?? 0); } catch (_e) { totalWager = 0n; }
    try { totalPayout = BigInt(replay?.totalPayout ?? 0); } catch (_e) { totalPayout = 0n; }
    this.#inlineBoard = {
      betId: replay?.betId ?? null,
      currency: Number(replay?.currency ?? 0),
      heroIdx: replay?.heroIdx == null ? null : Number(replay.heroIdx) & 3,
      amountPerSpin,
      totalWager,
      totalPayout,
      rows,
    };
    this.#primeInlineBoard();
  }

  // One result row: player card vs house card + meta + payout.
  #buildResultRow({
    playerTraits, houseTraits, heroIdx, metaText, subText, payoutWei, currency, won,
    wagerWei = null, netWei = null, replay = null,
  }) {
    const row = document.createElement('div');
    row.className = 'dgn-result-row';
    row.classList.add(won ? 'is-win' : 'is-miss');
    const states = dgnScoringMatchStates(playerTraits, houseTraits);
    row.appendChild(this.#buildTicketCard(playerTraits, states, heroIdx));
    const vs = document.createElement('span');
    vs.className = 'dgn-result-vs';
    vs.textContent = 'vs';
    row.appendChild(vs);
    row.appendChild(this.#buildTicketCard(houseTraits, null, null));
    const meta = document.createElement('div');
    meta.className = 'dgn-result-meta';
    const matches = document.createElement('span');
    matches.className = `matches ${won ? 'is-win' : 'is-miss'}`;
    matches.textContent = String(metaText || '');
    meta.appendChild(matches);
    if (subText) {
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = String(subText);
      meta.appendChild(sub);
    }
    if (wagerWei != null) {
      const wager = document.createElement('span');
      wager.className = 'sub dgn-result-wager';
      wager.textContent = `Wager ${this.#payoutText(wagerWei, currency)}`;
      meta.appendChild(wager);
    }
    const payout = document.createElement('span');
    payout.className = `dgn-result-payout ${won ? 'is-win' : 'is-miss'}`;
    payout.textContent = `Payout ${this.#payoutText(payoutWei, currency)}`;
    meta.appendChild(payout);
    if (netWei != null) {
      const net = document.createElement('span');
      let netValue = 0n;
      try { netValue = BigInt(netWei); } catch (_e) { netValue = 0n; }
      net.className = `dgn-result-net ${netValue > 0n ? 'is-win' : netValue < 0n ? 'is-loss' : ''}`;
      net.textContent = `Net ${this.#signedPayoutText(netValue, currency)}`;
      meta.appendChild(net);
    }
    if (replay) {
      const replayBtn = document.createElement('button');
      replayBtn.type = 'button';
      replayBtn.className = 'dgn-result-replay';
      replayBtn.textContent = 'REPLAY IN WIDGET';
      replayBtn.addEventListener('click', (e) => {
        try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
        this.#stageHistoryReplay(replay);
      });
      meta.appendChild(replayBtn);
    }
    row.appendChild(meta);
    return row;
  }

  // ---------------------------------------------------------------------
  // The resolved spin UI now lives directly in this widget. One button press
  // advances one spin; Skip all settles the board immediately. History rows
  // replay through the same embedded surface.
  //
  // Only spin 0's reel is published (DegeneretteResolved.resultTraits); the
  // rest are re-derived from the bet's RNG word in dgn-reels.js, which
  // self-checks against spin 0 and against every emitted score before the
  // board is drawn. Rows that fail that check show the score with no reel
  // instead of borrowing spin 0's, which is what the static modal used to do
  // for every spin of a multi-spin bet.
  //
  // Returns false when there is nothing to play (no per-spin events), leaving
  // the caller on the static modal.
  // ---------------------------------------------------------------------

  #stageInlineResolvedBet(resolvedEntry, spinResults, resultTickets = []) {
    const complete = normalizeDegeneretteSpinResults(
      spinResults,
      resolvedEntry?.spinCount ?? this.#currentSpinCount ?? 1,
      { player: resolvedEntry?.player, betId: resolvedEntry?.betId },
    );
    if (!complete.complete) return false;
    const hero = this.#currentHero == null ? this.#dgnHero : this.#currentHero;
    const derived = dgnDeriveSpins({
      rngWord: this.#currentRngWord,
      index: Number(this.#currentLootboxIndex ?? 0),
      heroQuadrant: hero,
      currency: this.#currentCurrency,
      resolvedResultTraits: resolvedEntry.resultTraits,
      spins: complete.spins,
    });
    const projected = new Map();
    for (const ticket of Array.isArray(resultTickets) ? resultTickets : []) {
      const spin = Number(ticket?.spinIndex ?? ticket?.spinIdx ?? 0);
      const raw = ticket?.resultTicket ?? ticket?.resultTraits
        ?? ticket?.houseTicket ?? ticket?.houseTraits;
      if (raw != null && Number.isInteger(spin) && spin >= 0) {
        projected.set(spin, Number(raw) >>> 0);
      }
    }
    const anchor = resolvedEntry?.resultTraits == null
      ? null
      : Number(resolvedEntry.resultTraits) >>> 0;
    const rows = derived.rows.map((row) => {
      if (!projected.has(row.spinIndex)) return row;
      const houseTraits = projected.get(row.spinIndex);
      // A projected reel must agree with the two facts emitted by the chain:
      // spin zero's anchor and this spin's score. If not, retain the independently
      // verified RNG derivation (or leave it unavailable) instead of showing it.
      const anchorOk = row.spinIndex !== 0 || anchor == null || houseTraits === anchor;
      const scoreOk = dgnScore(row.playerTraits, houseTraits, hero) === row.score;
      return anchorOk && scoreOk ? { ...row, houseTraits } : row;
    });
    if (!derived.verified) {
      // The chain's own spin-0 reel still stands even when the derivation for
      // the rest could not be confirmed.
      const zero = rows.find((r) => r.spinIndex === 0);
      if (zero && anchor != null) {
        zero.houseTraits = anchor;
      }
    }
    // The interaction promises one real house token for every paid spin. Wait
    // for the DB projection or verified RNG recovery rather than presenting a
    // partly blank board that can never reveal its later reels.
    if (rows.length !== complete.expectedSpinCount
      || rows.some((row) => row.houseTraits == null)) {
      return false;
    }
    this.#inlineBoard = {
      betId: resolvedEntry?.betId ?? null,
      currency: this.#currentCurrency,
      heroIdx: hero,
      amountPerSpin: this.#currentAmountPerSpin,
      totalWager: this.#currentAmountPerSpin * BigInt(complete.expectedSpinCount),
      totalPayout: resolvedEntry.totalPayout,
      rows,
    };
    this.#primeInlineBoard();
    return true;
  }

  // The just-resolved bet: header verdict + one row per spin (each spin has
  // its own playerTraits/matches/payout; the published reel is spin 0's).
  #showReceiptResults(resolvedEntry, spinResults) {
    const won = resolvedEntry.totalPayout > 0n;
    const spins = Array.isArray(spinResults) ? [...spinResults] : [];
    const roundSpins = spins.length || Number(resolvedEntry.spinCount || 1n);
    const body = this.#openResultsPanel(
      won ? 'Winning spins' : 'Round results',
      {
        payoutWei: resolvedEntry.totalPayout,
        currency: this.#currentCurrency,
        meta: `${roundSpins} spin${roundSpins === 1 ? '' : 's'} in this round`,
      },
    );
    if (!body) return;
    const houseTraits = dgnUnpackTicket(resolvedEntry.resultTraits);
    spins.sort((a, b) => Number(a.spinIndex ?? 0n) - Number(b.spinIndex ?? 0n));
    if (spins.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'dgn-results-empty';
      empty.textContent = won
        ? 'Per-spin detail unavailable for this receipt.'
        : 'No matching quadrants across your spins.';
      body.appendChild(empty);
      return;
    }
    for (const spin of spins) {
      body.appendChild(this.#buildResultRow({
        playerTraits: dgnUnpackTicket(spin.playerTraits),
        houseTraits,
        heroIdx: this.#currentHero == null ? this.#dgnHero : this.#currentHero,
        metaText: `score ${Number(spin.matches ?? 0n)}`,
        subText: `spin ${Number(spin.spinIndex ?? 0n) + 1} of ${spins.length}`,
        payoutWei: spin.payout ?? 0n,
        currency: this.#currentCurrency,
        won: (spin.payout ?? 0n) > 0n,
      }));
    }
  }

  async #buildHistoryResult(bet) {
    const results = Array.isArray(bet?.results) ? bet.results : [];
    const resolved = results.find((row) => row?.resultType === 'resolved');
    if (!resolved) return null;

    let resolvedData = resolved.resultData || {};
    let houseRaw = resolvedData.resultTraits ?? resolvedData.resultTicket;
    const packed = dgnDecodePacked(bet.packedData);
    let perSpin = results
      .filter((row) => row?.resultType === 'result')
      .sort((a, b) => Number(a.resultData?.spinIndex ?? a.resultData?.ticketIndex ?? 0)
        - Number(b.resultData?.spinIndex ?? b.resultData?.ticketIndex ?? 0));
    let spinCount = Math.max(
      1,
      Number(packed?.spinCount || resolvedData.spinCount || perSpin.length || 1),
    );

    // The result summary can become visible one indexer write before every
    // DegeneretteResult row. If any spin index is missing, recover the exact
    // player+betId event set from chain instead of silently building a
    // one-spin replay. readResolvedBet refuses partial event sets itself.
    const indexedSpins = new Set(perSpin.map((row, i) => Number(
      row?.resultData?.spinIndex ?? row?.resultData?.ticketIndex ?? i,
    )));
    if ((houseRaw == null || indexedSpins.size < spinCount)
      && bet?.player
      && bet?.betId != null) {
      const chain = await readResolvedBet({
        player: bet.player,
        betId: bet.betId,
      }).catch(() => null);
      if (chain?.resolved) {
        if (houseRaw == null) houseRaw = chain.resolved.resultTraits;
        if (resolvedData.totalPayout == null) {
          resolvedData = {
            ...resolvedData,
            totalPayout: chain.resolved.totalPayout,
          };
        }
        spinCount = Math.max(spinCount, Number(chain.resolved.spinCount || 0n));
      }
      if (Array.isArray(chain?.spins) && chain.spins.length > 0) {
        const bySpin = new Map(perSpin.map((row, i) => [
          Number(row?.resultData?.spinIndex ?? row?.resultData?.ticketIndex ?? i),
          row,
        ]));
        for (const spin of chain.spins) {
          const idx = Number(spin.spinIndex ?? 0n);
          if (bySpin.has(idx)) continue;
          bySpin.set(idx, {
            resultType: 'result',
            payout: String(spin.payout ?? 0n),
            blockNumber: String(resolved.blockNumber || 0),
            resultData: {
              spinIndex: idx,
              playerTraits: String(spin.playerTraits),
              matches: Number(spin.matches ?? 0n),
            },
          });
        }
        perSpin = Array.from(bySpin.values()).sort((a, b) => (
          Number(a.resultData?.spinIndex ?? a.resultData?.ticketIndex ?? 0)
          - Number(b.resultData?.spinIndex ?? b.resultData?.ticketIndex ?? 0)
        ));
      }
    }
    if (houseRaw == null) return null;
    const spinZero = perSpin[0];
    const playerRaw = spinZero?.resultData?.playerTraits
      ?? spinZero?.resultData?.playerTicket
      ?? (packed ? packed.customTicket : null);
    if (playerRaw == null) return null;

    let totalMatches = 0;
    for (const row of perSpin) totalMatches += Number(row.resultData?.matches ?? 0);
    let totalPayout = 0n;
    try { totalPayout = BigInt(resolvedData.totalPayout ?? resolved.payout ?? 0); }
    catch (_e) { totalPayout = 0n; }
    const amountPerSpin = packed?.amountPerSpin ?? 0n;
    const totalWager = amountPerSpin * BigInt(spinCount);

    // Prefer any per-spin reels already projected by the DB. The current feed
    // has the published spin-zero anchor plus betIndex; newer projections can
    // attach resultTicket/houseTraits directly to each result row.
    const projectedTickets = new Map();
    for (const row of Array.isArray(bet.resultTickets) ? bet.resultTickets : []) {
      const idx = Number(row?.spinIndex ?? row?.spinIdx ?? 0);
      const ticket = row?.resultTraits ?? row?.resultTicket
        ?? row?.houseTraits ?? row?.houseTicket;
      if (ticket != null) projectedTickets.set(idx, ticket);
    }

    let replaySpins = perSpin.map((result, i) => {
      const data = result.resultData || {};
      const spinIndex = Number(data.spinIndex ?? data.ticketIndex ?? i);
      const rawPlayer = data.playerTraits ?? data.playerTicket ?? playerRaw;
      const projected = data.resultTraits ?? data.resultTicket
        ?? data.houseTraits ?? data.houseTicket
        ?? projectedTickets.get(spinIndex)
        ?? (spinIndex === 0 ? houseRaw : null);
      let rowPayout = 0n;
      try { rowPayout = BigInt(result.payout ?? data.payout ?? 0); }
      catch (_e) { rowPayout = 0n; }
      return {
        spinIndex,
        playerTraits: Number(rawPlayer) >>> 0,
        houseTraits: projected == null ? null : Number(projected) >>> 0,
        score: Number(data.matches ?? 0),
        payout: rowPayout,
      };
    });

    // The DB gives us betIndex, so missing projected reels can be reproduced
    // from the exact batch RNG and verified against both spin zero and every
    // emitted score. Fetch all history words in parallel in #onResultsClick.
    if (replaySpins.some((spin) => spin.houseTraits == null)
      && bet.betIndex != null
      && packed) {
      let rngWord = 0n;
      try { rngWord = BigInt(bet.rngWord ?? 0); }
      catch (_e) { rngWord = 0n; }
      const derived = dgnDeriveSpins({
        rngWord,
        index: Number(bet.betIndex),
        heroQuadrant: packed.heroQuadrant,
        currency: packed.currency,
        resolvedResultTraits: houseRaw,
        spins: replaySpins.map((spin) => ({
          spinIndex: spin.spinIndex,
          playerTraits: spin.playerTraits,
          matches: spin.score,
          payout: spin.payout,
        })),
      });
      const bySpin = new Map(derived.rows.map((row) => [row.spinIndex, row]));
      replaySpins = replaySpins.map((spin) => {
        if (spin.houseTraits != null) return spin;
        const row = bySpin.get(spin.spinIndex);
        return row?.houseTraits == null
          ? spin
          : { ...spin, houseTraits: row.houseTraits };
      });
    }

    if (replaySpins.length === 0) {
      replaySpins = [{
        spinIndex: 0,
        playerTraits: Number(playerRaw) >>> 0,
        houseTraits: Number(houseRaw) >>> 0,
        score: totalMatches,
        payout: totalPayout,
      }];
    }
    const firstHouse = replaySpins.find((spin) => spin.spinIndex === 0)?.houseTraits
      ?? Number(houseRaw) >>> 0;
    const replayIndexes = new Set(replaySpins.map((spin) => spin.spinIndex));
    const allReelsReady = replaySpins.length === spinCount
      && replaySpins.every((spin) => spin.houseTraits != null)
      && Array.from({ length: spinCount }, (_, spin) => replayIndexes.has(spin)).every(Boolean);

    return {
      blk: Number(resolved.blockNumber || 0),
      betId: String(bet.betId),
      spinCount,
      playerTraits: dgnUnpackTicket(playerRaw),
      houseTraits: dgnUnpackTicket(firstHouse),
      heroIdx: packed ? packed.heroQuadrant : null,
      currency: packed ? packed.currency : 0,
      metaText: spinCount > 1
        ? `score ${totalMatches} across ${spinCount} spins`
        : `score ${totalMatches}`,
      subText: spinCount > 1
        ? `bet #${bet.betId} · ${allReelsReady ? `${spinCount} reels ready` : 'reels still indexing'}`
        : `bet #${bet.betId}`,
      payoutWei: totalPayout,
      wagerWei: totalWager,
      netWei: totalPayout - totalWager,
      won: totalPayout > 0n,
      replay: allReelsReady ? {
        kind: 'degenerette',
        betId: String(bet.betId),
        headline: `BET #${bet.betId} · REPLAY`,
        currency: packed ? packed.currency : 0,
        heroIdx: packed ? packed.heroQuadrant : null,
        amountPerSpin,
        totalWager,
        totalPayout,
        spinCount,
        spins: replaySpins,
      } : null,
    };
  }

  // History from the indexer feed — the viewed player's resolved bets.
  async #onResultsClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    const body = this.#openResultsPanel('Degenerette results');
    if (!body) return;
    const loading = document.createElement('p');
    loading.className = 'dgn-results-empty';
    loading.textContent = 'Loading…';
    body.appendChild(loading);

    // Account-switcher (2026-07-16): bet history is a per-account identity
    // stat — the combined view aggregates money fields (combine.js), not
    // degenerette history, so a single "which account?" answer doesn't
    // exist. Match the panel's existing empty-state markup (the modal's
    // loading/empty paragraph) with the identity-panel note instead of
    // fetching /degenerette/feed.
    if (get('ui.mode') === 'combined') {
      loading.textContent = 'Per-account stat. Pick a single account.';
      return;
    }

    const addr = this.#historyOwner();
    if (!addr) {
      loading.textContent = 'Connect a wallet (or pick a player) to see results.';
      return;
    }

    let items = [];
    try {
      items = await this.#loadHistoryItems({ force: true });
    } catch (_e) {
      loading.textContent = 'Could not load results — indexer unreachable.';
      return;
    }

    const bets = items
      .filter((bet) => (Array.isArray(bet?.results) ? bet.results : [])
        .some((row) => row?.resultType === 'resolved'))
      .slice(0, 12);
    const rows = (await Promise.all(bets.map((bet) => this.#buildHistoryResult(bet))))
      .filter(Boolean);
    rows.sort((a, b) => b.blk - a.blk);

    body.textContent = '';
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'dgn-results-empty';
      empty.textContent = 'No resolved bets yet for this player.';
      body.appendChild(empty);
      return;
    }
    const latest = rows[0];
    this.#enterResultsMode({
      payoutWei: latest.payoutWei,
      currency: latest.currency,
      meta: `Bet #${latest.betId} · ${latest.spinCount} spin${
        latest.spinCount === 1 ? '' : 's'
      } in this round`,
    });
    for (const r of rows) {
      body.appendChild(this.#buildResultRow(r));
    }
  }

  // ---------------------------------------------------------------------
  // Error rendering — textContent only (T-58-18). 10s auto-clear timer.
  // ---------------------------------------------------------------------

  #renderError(msg) {
    const errEl = this.querySelector('[data-bind="deg-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
    }
    this.#errorTimer = setTimeout(() => this.#clearError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimer && typeof this.#errorTimer.unref === 'function') {
      try { this.#errorTimer.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearError() {
    const errEl = this.querySelector('[data-bind="deg-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
      this.#errorTimer = null;
    }
  }
}

// Idempotency-guarded registration.
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-degenerette-panel')) {
    customElements.define('app-degenerette-panel', AppDegenerettePanel);
  }
}

export { AppDegenerettePanel };
