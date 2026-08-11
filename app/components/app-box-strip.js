// /app/components/app-box-strip.js — pending lootboxes: buy → RNG wait →
// pulsing OPEN → full-screen prize reveal.
//
// Basic mode's box-open controller (the Phase 60 packs panel stays unmounted;
// the combined buy panel owns purchasing). In `tray-only` mode it renders no
// duplicate inline chips: it polls pending RNG indices every 7s and publishes
// open/replay actions to the fixed bottom reveal tray. A direct mount without
// that attribute retains the legacy chip surface for isolated embeds/tests.
//
// Box tracking:
//   - Listens document-level for 'app-decimator:tx-confirmed' (bubbles from
//     the buy panel) carrying receipt-parsed LootBoxIdx entries.
//   - Persists pending indices at pending-boxes:${CHAIN.id}:${addr}
//     (chainId-scoped, mirrors the revealed-packs:* convention).
//   - openBox is permissionless (anyone can open; rewards credit the owner) —
//     a fresh status read avoids doomed writes, and an already-open race replays
//     the receipt's actual prize legs instead of replacing them with an error.
//
// One chip = one RNG batch index. Multiple boxes bought in one purchase()
// share the index and open together in one openBox call (LootboxModule
// resolves every box queued at the index).
//
// Class palette: .bxs-* (non-colliding).

import { CHAIN } from '../app/chain-config.js';
import { displayEth } from '../app/scaling.js';
import { get, subscribe } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import {
  openLootBox,
  canOpenLootbox,
  readLootboxStatus,
  readLootboxPurchaseReceipt,
} from '../app/lootbox.js';
import { compactUiError } from '../app/ui-error.js';
import {
  enrichLootboxBoonLegs,
  parseOpenLegsFromReceipt,
  openLegsFromFeed,
  readOpenLegsFromChain,
} from '../app/lootbox-legs.js';
import {
  publishPendingActions,
  clearPendingActions,
  reportPendingActionError,
} from '../app/pending-actions.js';
import { recordLootboxTicketPacks } from '../app/pack-watch.js';
import { lootboxValuePresentation } from '../app/lootbox-value-tone.js';
import {
  queueReveal,
  LOOTBOX_REVEAL_QUEUED_EVENT,
  LOOTBOX_REVEAL_COMPLETE_EVENT,
  LOOTBOX_REVEAL_ABORT_EVENT,
} from './reveal-overlay.js';

const RNG_POLL_INTERVAL_MS = 7_000;   // Phase 60 packs-panel cadence.
const ERROR_AUTO_CLEAR_MS = 10_000;
const PENDING_SOURCE = 'lootboxes';

function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

/** chainId+address-scoped storage key. */
export function pendingBoxesKey(chainId, address) {
  return `pending-boxes:${chainId}:${String(address || '').toLowerCase()}`;
}

export function revealedBoxesKey(chainId, address) {
  return `revealed-lootboxes:${chainId}:${String(address || '').toLowerCase()}`;
}

export function lootboxResultCursorKey(chainId, address) {
  return `lootbox-result-cursor:${chainId}:${String(address || '').toLowerCase()}`;
}

function _readResultCursor(addr) {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(lootboxResultCursorKey(CHAIN.id, addr)) : null;
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch (_e) { return null; }
}

function _writeResultCursor(addr, ord) {
  if (!addr || !Number.isFinite(Number(ord))) return;
  try {
    localStorage.setItem(lootboxResultCursorKey(CHAIN.id, addr), String(Number(ord)));
  } catch (_e) { /* private mode */ }
}

function _boxKey(box) {
  if (box?.resultKey != null && String(box.resultKey)) return String(box.resultKey);
  const index = Number(box?.index);
  return Number.isFinite(index) ? String(index) : '';
}

function _firstPositiveAmount(...values) {
  for (const value of values) {
    try {
      if (value != null && BigInt(value) > 0n) return String(value);
    } catch (_e) { /* malformed optional source */ }
  }
  return values.find((value) => value != null) ?? null;
}

function _boxLabel(box, upper = false) {
  const label = box?.hasPresaleLeg
    ? box?.hasLootboxLeg ? 'Luckbox + presale box' : 'Presale box'
    : box?.index == null || !Number.isFinite(Number(box.index))
      ? 'Luckbox'
      : Number(box.index) === 0 ? 'AFKing luckbox' : 'Luckbox';
  return upper ? label.toUpperCase() : label;
}

function _boxAmountLabel(box) {
  try {
    const raw = BigInt(box?.amountWei ?? 0);
    if (raw <= 0n) return null;
    const rendered = displayEth(raw, 4);
    const amount = String(rendered).includes('.')
      ? String(rendered).replace(/0+$/, '').replace(/\.$/, '')
      : String(rendered);
    return `${amount} ETH`;
  } catch (_e) {
    return null;
  }
}

function _boxValuePresentation(box) {
  return box?.ticketPriceWei == null
    ? lootboxValuePresentation(box?.amountWei)
    : lootboxValuePresentation(box?.amountWei, box.ticketPriceWei);
}

function _readRevealed(addr) {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(revealedBoxesKey(CHAIN.id, addr)) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch (_e) {
    return new Set();
  }
}

function _markRevealed(addr, key) {
  if (!addr) return;
  try {
    const seen = _readRevealed(addr);
    seen.add(String(key));
    localStorage.setItem(revealedBoxesKey(CHAIN.id, addr), JSON.stringify([...seen]));
  } catch (_e) { /* private mode: replay may reappear after refresh */ }
}

function _unmarkRevealed(addr, key) {
  if (!addr || !key) return;
  try {
    const seen = _readRevealed(addr);
    if (!seen.delete(String(key))) return;
    if (seen.size === 0) localStorage.removeItem(revealedBoxesKey(CHAIN.id, addr));
    else localStorage.setItem(revealedBoxesKey(CHAIN.id, addr), JSON.stringify([...seen]));
  } catch (_e) { /* private mode */ }
}

function _boxDismissKey(box) {
  const key = _boxKey(box);
  const hashes = [...new Set([
    ...(Array.isArray(box?.transactionHashes) ? box.transactionHashes : []),
    box?.transactionHash,
  ].filter(Boolean).map((hash) => String(hash).toLowerCase()))].sort();
  return hashes.length > 0
    ? `lootbox:${key}:purchases:${hashes.join(',')}`
    : `lootbox:${key}`;
}

function _readPending(addr) {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(pendingBoxesKey(CHAIN.id, addr)) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && (Number.isFinite(Number(e.index)) || e.resultKey != null))
      .map((e) => ({
        index: e.index == null || !Number.isFinite(Number(e.index)) ? null : Number(e.index),
        resultKey: e.resultKey == null ? null : String(e.resultKey),
        transactionHash: e.transactionHash == null ? null : String(e.transactionHash),
        resultTransactionHash: e.resultTransactionHash == null
          ? null
          : String(e.resultTransactionHash),
        transactionHashes: [...new Set([
          ...(Array.isArray(e.transactionHashes) ? e.transactionHashes : []),
          e.transactionHash,
        ].filter(Boolean).map((hash) => String(hash).toLowerCase()))],
        ord: Number.isFinite(Number(e.ord)) ? Number(e.ord) : null,
        day: e.day != null ? Number(e.day) : null,
        // Old cache rows predate this flag and were all receipt-sourced.
        // DB-discovered rows persist false so a stale API row cannot become a
        // trusted receipt row merely because the page refreshed.
        fromReceipt: e.fromReceipt !== false,
        createdAt: Number.isFinite(Number(e.createdAt)) ? Number(e.createdAt) : null,
        amountWei: e.amountWei == null ? null : String(e.amountWei),
        ticketPriceWei: e.ticketPriceWei == null ? null : String(e.ticketPriceWei),
        hasLootboxLeg: Boolean(e.hasLootboxLeg),
        hasPresaleLeg: Boolean(e.hasPresaleLeg),
        optimistic: Boolean(e.optimistic),
        resultSyncing: Boolean(e.resultSyncing),
        ready: Boolean(!e.resultSyncing && (e.ready || e.resolved)),
        resolved: Boolean(e.resolved),
      }));
  } catch (_e) {
    return [];
  }
}

function _writePending(addr, entries) {
  try {
    if (typeof localStorage === 'undefined') return;
    const key = pendingBoxesKey(CHAIN.id, addr);
    if (!entries || entries.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(entries.map((e) => ({
      index: e.index == null || !Number.isFinite(Number(e.index)) ? null : Number(e.index),
      resultKey: e.resultKey ?? null,
      transactionHash: e.transactionHash ?? null,
      resultTransactionHash: e.resultTransactionHash ?? null,
      transactionHashes: [...new Set([
        ...(Array.isArray(e.transactionHashes) ? e.transactionHashes : []),
        e.transactionHash,
      ].filter(Boolean).map((hash) => String(hash).toLowerCase()))],
      ord: Number.isFinite(Number(e.ord)) ? Number(e.ord) : null,
      day: e.day,
      fromReceipt: e.fromReceipt !== false,
      createdAt: Number.isFinite(Number(e.createdAt)) ? Number(e.createdAt) : null,
      amountWei: e.amountWei == null ? null : String(e.amountWei),
      ticketPriceWei: e.ticketPriceWei == null ? null : String(e.ticketPriceWei),
      hasLootboxLeg: Boolean(e.hasLootboxLeg),
      hasPresaleLeg: Boolean(e.hasPresaleLeg),
      optimistic: Boolean(e.optimistic),
      resultSyncing: Boolean(e.resultSyncing),
      ready: Boolean(e.ready),
      resolved: Boolean(e.resolved),
    }))));
  } catch (_e) { /* quota / private mode — session-only tracking */ }
}

/**
 * Collapse the durable per-leg result feed into one resolved row per opening
 * transaction. Normal boxes use their shared RNG index; AFKing auto-opens all
 * use index zero, so their transaction hash is the only collision-free key.
 */
export function resolvedBoxRowsFromLegs(items, player) {
  const wantPlayer = String(player || '').toLowerCase();
  const rows = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (String(item?.player || '').toLowerCase() !== wantPlayer) continue;
    const legType = String(item?.legType || '');
    if (!['opened', 'flipOpened', 'presale', 'spin'].includes(legType)) continue;
    // The normal player feed cannot infer an index for BoxSpin. Treating its
    // null as Number(null) === 0 would fabricate an AFKing result; only an
    // exact-index response is allowed to promote a spin-only settlement.
    if (legType === 'spin' && item?.lootboxIndex == null) continue;
    const index = Number(item?.lootboxIndex);
    if (!Number.isFinite(index) || index < 0) continue;
    const transactionHash = String(item?.transactionHash || '').toLowerCase();
    if (index === 0 && !transactionHash) continue;
    const resultKey = index === 0 ? `tx:${transactionHash}` : String(index);
    const ord = Number(item?.ord ?? item?.logIndex ?? 0);
    const prior = rows.get(resultKey);
    const hasPresaleLeg = legType === 'presale';
    const hasLootboxLeg = !hasPresaleLeg;
    if (!prior || ord > prior.ord) {
      rows.set(resultKey, {
        index,
        resultKey,
        transactionHash: transactionHash || null,
        // The SETTLEMENT transaction, distinct from the purchase hash a
        // receipt-discovered box carries. This row exists because a leg proved
        // the open, so the opening tx is already known — replay must reuse this
        // exact key instead of re-deriving one from a fresh anchor lookup that
        // can miss and leave the box latched resolved with nothing to show.
        resultTransactionHash: transactionHash || null,
        amountWei: String(
          item?.rewardData?.amount
          ?? item?.boxAmountRawWei
          ?? item?.amount
          ?? 0,
        ),
        day: null,
        ready: true,
        resolved: true,
        opening: false,
        ord,
        hasLootboxLeg: Boolean(prior?.hasLootboxLeg || hasLootboxLeg),
        hasPresaleLeg: Boolean(prior?.hasPresaleLeg || hasPresaleLeg),
      });
    } else {
      prior.hasLootboxLeg ||= hasLootboxLeg;
      prior.hasPresaleLeg ||= hasPresaleLeg;
    }
  }
  return [...rows.values()].sort((a, b) => b.ord - a.ord || b.index - a.index);
}

function _mergeLegRows(...groups) {
  const merged = new Map();
  for (const item of groups.flatMap((group) => Array.isArray(group) ? group : [])) {
    const key = item?.uid
      || `${String(item?.transactionHash || '').toLowerCase()}:${Number(item?.logIndex ?? -1)}:${item?.legType || ''}`;
    merged.set(key, item);
  }
  return [...merged.values()];
}

function _needsReceiptRecovery(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return true;
  return legs.some((leg) => {
    if (leg?.legType !== 'opened' || leg?.source === 'presale') return false;
    let flip = 0n;
    try { flip = BigInt(leg.flip ?? 0); } catch (_e) { /* malformed feed value */ }
    return Number(leg.wholeTickets ?? 0) === 0 && flip === 0n;
  });
}

class AppBoxStrip extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #pollHandle = null;
  #pollBusy = false;
  #errorTimer = null;
  #docListener = null;
  #submittedListener = null;
  #failedListener = null;
  #revealQueuedListener = null;
  #revealCompleteListener = null;
  #revealAbortListener = null;
  // API history can contain legacy purchase rows whose result never received
  // an index-bearing settlement anchor. Once the authoritative on-chain slot
  // confirms one of those indexes is empty, do not probe/promote it every 7s.
  #emptyIndexes = new Set();
  // A queued presentation leaves the durable receipt in storage until the
  // overlay actually completes. Hiding it only in-memory means an abort or a
  // refresh can restore the result instead of permanently eating the box.
  #activeRevealKeys = new Set();
  #purchaseReceipts = new Map();
  // Once a background sync has assembled a complete result, hold those exact
  // legs until the pending action consumes them. This prevents a transient API
  // miss between the poll and the click from dropping the row back into sync.
  #resolvedLegCache = new Map();
  // [{index, day, ready, opening, fromReceipt, createdAt}]
  #boxes = [];
  #addr = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wireStore();
    this.#wireDocEvents();
    this.#startPolling();
  }

  disconnectedCallback() {
    // In-flight API reads may settle after detachment. Clearing the owner makes
    // their address-stability guard abort before a stale strip republishes the
    // shared pending-action source.
    this.#addr = null;
    this.#boxes = [];
    this.#emptyIndexes.clear();
    this.#activeRevealKeys.clear();
    this.#purchaseReceipts.clear();
    this.#resolvedLegCache.clear();
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
      this.#errorTimer = null;
    }
    if (this.#docListener && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('app-decimator:tx-confirmed', this.#docListener); }
      catch (_) { /* defensive */ }
      try { document.removeEventListener('app-pass:tx-confirmed', this.#docListener); }
      catch (_) { /* defensive */ }
      try { document.removeEventListener('app-decimator:tx-submitted', this.#submittedListener); }
      catch (_) { /* defensive */ }
      try { document.removeEventListener('app-decimator:tx-failed', this.#failedListener); }
      catch (_) { /* defensive */ }
      try { document.removeEventListener(LOOTBOX_REVEAL_QUEUED_EVENT, this.#revealQueuedListener); }
      catch (_) { /* defensive */ }
      try { document.removeEventListener(LOOTBOX_REVEAL_COMPLETE_EVENT, this.#revealCompleteListener); }
      catch (_) { /* defensive */ }
      try { document.removeEventListener(LOOTBOX_REVEAL_ABORT_EVENT, this.#revealAbortListener); }
      catch (_) { /* defensive */ }
    }
    this.#docListener = null;
    this.#submittedListener = null;
    this.#failedListener = null;
    this.#revealQueuedListener = null;
    this.#revealCompleteListener = null;
    this.#revealAbortListener = null;
    clearPendingActions(PENDING_SOURCE);
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
  }

  #renderShell() {
    if (this.getAttribute?.('tray-only') != null) {
      // Stay connected for receipt listening, durable discovery, readiness
      // probes, and action publishing. The reveal tray is the sole visible UI.
      this.innerHTML = '';
      return;
    }
    this.innerHTML = `
      <div class="bxs-strip" data-bind="bxs-strip" hidden>
        <span class="bxs-label">YOUR BOXES</span>
        <div class="bxs-chips" data-bind="bxs-chips"></div>
        <div class="bxs-error" data-bind="bxs-error" hidden role="alert"></div>
      </div>
    `;
  }

  #bind(name) { return this.querySelector(`[data-bind="${name}"]`); }

  #wireStore() {
    const u = subscribe('connected.address', (addr) => {
      this.#addr = addr ? String(addr).toLowerCase() : null;
      this.#emptyIndexes.clear();
      this.#activeRevealKeys.clear();
      this.#purchaseReceipts.clear();
      this.#resolvedLegCache.clear();
      this.#boxes = this.#addr
        ? _readPending(this.#addr).map((e) => ({
            ...e,
            ready: Boolean(!e.resultSyncing && (e.ready || e.resolved)),
            resolved: Boolean(e.resolved),
            opening: false,
          }))
        : [];
      this.#render();
      // The DB is the durable inventory and result ledger; localStorage only
      // bridges the short purchase-to-indexing window.
      if (this.#addr) this.#runPollCycle();
    });
    this.#unsubs.push(u);
  }

  #wireDocEvents() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#submittedListener = (e) => {
      const detail = e?.detail || {};
      const player = String(detail.player || '').toLowerCase();
      const transactionHash = String(detail.transactionHash || '').toLowerCase();
      if (!this.#addr || player !== this.#addr || !transactionHash) return;
      const resultKey = `submitted:${transactionHash}`;
      if (this.#boxes.some((box) => _boxKey(box) === resultKey)) return;
      this.#boxes.push({
        index: null,
        resultKey,
        transactionHash,
        transactionHashes: [transactionHash],
        day: null,
        ready: false,
        resolved: false,
        opening: false,
        fromReceipt: true,
        optimistic: true,
        createdAt: Date.now(),
        amountWei: (() => {
          try {
            return String(
              BigInt(detail.lootBoxAmountWei ?? 0)
              + BigInt(detail.presaleBoxAmountWei ?? 0),
            );
          } catch (_e) { return null; }
        })(),
        hasLootboxLeg: (() => {
          try { return BigInt(detail.lootBoxAmountWei ?? 0) > 0n; } catch (_e) { return false; }
        })(),
        hasPresaleLeg: (() => {
          try { return BigInt(detail.presaleBoxAmountWei ?? 0) > 0n; } catch (_e) { return false; }
        })(),
        ticketPriceWei: detail.ticketPriceWei == null
          ? null
          : String(detail.ticketPriceWei),
      });
      _writePending(this.#addr, this.#boxes);
      this.#render();
    };
    this.#failedListener = (e) => {
      const detail = e?.detail || {};
      const player = String(detail.player || '').toLowerCase();
      const transactionHash = String(detail.transactionHash || '').toLowerCase();
      if (!this.#addr || player !== this.#addr || !transactionHash) return;
      this.#removeBox(`submitted:${transactionHash}`);
    };
    this.#docListener = (e) => {
      const detail = e?.detail || {};
      const boxes = detail.boxes;
      if (!this.#addr) return;
      const player = String(e?.detail?.player || '').toLowerCase();
      if (player && player !== this.#addr) return;
      const submittedHash = String(
        e?.detail?.submittedTransactionHash || e?.detail?.transactionHash || '',
      ).toLowerCase();
      const submittedKey = submittedHash ? `submitted:${submittedHash}` : '';
      const submitted = submittedKey
        ? this.#boxes.find((box) => _boxKey(box) === submittedKey)
        : null;
      if (!Array.isArray(boxes) || boxes.length === 0) {
        if (submitted) {
          submitted.optimistic = false;
          submitted.createdAt = Date.now();
          if (detail.ticketPriceWei != null) {
            submitted.ticketPriceWei = String(detail.ticketPriceWei);
          }
          _writePending(this.#addr, this.#boxes);
          this.#render();
          this.#runPollCycle();
        }
        return;
      }
      if (submittedKey) {
        this.#boxes = this.#boxes.filter((box) => _boxKey(box) !== submittedKey);
      }
      for (const b of boxes) {
        const index = Number(b?.index);
        if (!Number.isFinite(index)) continue;
        // afking idx-0 boxes auto-open in the buy tx — never pending.
        if (index === 0) continue;
        const incomingHash = String(
          detail.transactionHash || submitted?.transactionHash || submittedHash || '',
        ).toLowerCase();
        const existing = this.#boxes.find((x) => _boxKey(x) === String(index));
        if (existing) {
          // A regular lootbox and a presale box intentionally share the same
          // RNG index. That is one open action with two box legs, not a
          // duplicate. Merge later purchases into the batch while using their
          // tx hashes to keep repeated browser events idempotent.
          const knownHashes = new Set([
            ...(Array.isArray(existing.transactionHashes) ? existing.transactionHashes : []),
            existing.transactionHash,
          ].filter(Boolean).map((hash) => String(hash).toLowerCase()));
          const addsNewLeg = (Boolean(b?.hasLootboxLeg) && !existing.hasLootboxLeg)
            || (Boolean(b?.hasPresaleLeg) && !existing.hasPresaleLeg);
          const addsPurchase = incomingHash ? !knownHashes.has(incomingHash) : addsNewLeg;
          if (addsPurchase) _unmarkRevealed(this.#addr, String(index));
          if (addsPurchase && b?.amountWei != null) {
            try {
              existing.amountWei = String(
                BigInt(existing.amountWei ?? 0) + BigInt(b.amountWei),
              );
            } catch (_e) { /* retain the already-known amount */ }
          }
          existing.hasLootboxLeg ||= Boolean(b?.hasLootboxLeg);
          existing.hasPresaleLeg ||= Boolean(b?.hasPresaleLeg);
          existing.fromReceipt = true;
          existing.optimistic = false;
          existing.createdAt = Date.now();
          if (incomingHash) {
            knownHashes.add(incomingHash);
            existing.transactionHash ||= incomingHash;
          }
          existing.transactionHashes = [...knownHashes];
          if (b?.ticketPriceWei != null || detail.ticketPriceWei != null) {
            existing.ticketPriceWei = String(b?.ticketPriceWei ?? detail.ticketPriceWei);
          }
          this.#emptyIndexes.delete(index);
          continue;
        }
        // CLEAR historically marked only the shared RNG index. A newly mined
        // purchase can legitimately join that same still-open batch, so its
        // receipt must retire the stale presentation marker.
        _unmarkRevealed(this.#addr, String(index));
        this.#boxes.push({
          index,
          resultKey: String(index),
          transactionHash: incomingHash || null,
          transactionHashes: incomingHash ? [incomingHash] : [],
          day: b?.day != null ? Number(b.day) : null,
          ready: false,
          resolved: false,
          opening: false,
          fromReceipt: true,
          optimistic: false,
          createdAt: Date.now(),
          amountWei: b?.amountWei == null && boxes.length === 1
            ? (() => {
                try {
                  return String(
                    BigInt(detail.lootBoxAmountWei ?? 0)
                    + BigInt(detail.presaleBoxAmountWei ?? 0),
                  );
                } catch (_e) { return null; }
              })()
            : b?.amountWei == null ? null : String(b.amountWei),
          hasLootboxLeg: Boolean(b?.hasLootboxLeg),
          hasPresaleLeg: Boolean(b?.hasPresaleLeg),
          ticketPriceWei: b?.ticketPriceWei == null
            ? detail.ticketPriceWei == null
              ? submitted?.ticketPriceWei ?? null
              : String(detail.ticketPriceWei)
            : String(b.ticketPriceWei),
        });
        this.#emptyIndexes.delete(index);
      }
      _writePending(this.#addr, this.#boxes);
      this.#render();
      this.#runPollCycle();
    };
    document.addEventListener('app-decimator:tx-submitted', this.#submittedListener);
    document.addEventListener('app-decimator:tx-failed', this.#failedListener);
    document.addEventListener('app-decimator:tx-confirmed', this.#docListener);
    document.addEventListener('app-pass:tx-confirmed', this.#docListener);

    // A direct Degenerette settlement and the durable box feed can discover the
    // same index-zero box independently. Hide that exact tray copy while the
    // presentation is active, but do not tombstone its durable receipt until
    // the player completes it; an aborted overlay must restore the action.
    this.#revealQueuedListener = (event) => {
      const detail = event?.detail;
      const address = String(detail?.address || '').toLowerCase();
      const key = String(detail?.key || '');
      if (!address || !key) return;
      if (address === this.#addr) {
        this.#activeRevealKeys.add(key);
        const box = this.#boxes.find((row) => _boxKey(row) === key);
        if (box) box.opening = true;
        if (this.#addr) _writePending(this.#addr, this.#boxes);
        this.#render();
      }
    };
    this.#revealCompleteListener = (event) => {
      const detail = event?.detail;
      const address = String(detail?.address || '').toLowerCase();
      const key = String(detail?.key || '');
      if (!address || !key) return;
      _markRevealed(address, key);
      if (address === this.#addr) {
        this.#activeRevealKeys.delete(key);
        this.#removeBox(key);
      }
    };
    this.#revealAbortListener = (event) => {
      for (const release of Array.isArray(event?.detail?.releases)
        ? event.detail.releases : []) {
        if (String(release?.address || '').toLowerCase() !== this.#addr) continue;
        const key = String(release?.key || '');
        this.#activeRevealKeys.delete(key);
        const box = this.#boxes.find((row) => _boxKey(row) === key);
        if (box) box.opening = false;
      }
      if (this.#addr) {
        _writePending(this.#addr, this.#boxes);
        this.#render();
      }
    };
    document.addEventListener(LOOTBOX_REVEAL_QUEUED_EVENT, this.#revealQueuedListener);
    document.addEventListener(LOOTBOX_REVEAL_COMPLETE_EVENT, this.#revealCompleteListener);
    document.addEventListener(LOOTBOX_REVEAL_ABORT_EVENT, this.#revealAbortListener);
  }

  // -------------------------------------------------------------------------
  // RNG polling — 7s tick over not-yet-ready boxes.
  // -------------------------------------------------------------------------

  #startPolling() {
    if (typeof setInterval !== 'function') return;
    this.#pollHandle = _setIntervalUnref(() => this.#runPollCycle(), RNG_POLL_INTERVAL_MS);
  }

  async #readPurchaseKinds(box, owner) {
    const hashes = [...new Set([
      ...(Array.isArray(box?.transactionHashes) ? box.transactionHashes : []),
      box?.transactionHash,
    ].filter(Boolean).map((hash) => String(hash).toLowerCase()))];
    let found = null;
    for (const hash of hashes) {
      const cacheKey = `${owner}:${box.index}:${hash}`;
      let receipt = this.#purchaseReceipts.get(cacheKey);
      if (receipt === undefined) {
        receipt = await readLootboxPurchaseReceipt({
          transactionHash: hash,
          player: owner,
          lootboxIndex: box.index,
        });
        if (receipt) this.#purchaseReceipts.set(cacheKey, receipt);
      }
      if (!receipt) continue;
      found ||= { hasLootboxLeg: false, hasPresaleLeg: false, amountWei: 0n };
      found.hasLootboxLeg ||= Boolean(receipt.hasLootboxLeg);
      found.hasPresaleLeg ||= Boolean(receipt.hasPresaleLeg);
      found.amountWei += BigInt(receipt.amountWei ?? 0);
    }
    return found;
  }

  async #runPollCycle() {
    if (this.#pollBusy) return;
    if (typeof document !== 'undefined'
      && document.visibilityState
      && document.visibilityState !== 'visible') return;
    if (!this.#addr) return;
    this.#pollBusy = true;
    const owner = this.#addr;
    try {
      // Purchases tell us about boxes still waiting for RNG. Settlement legs
      // are the durable source for completed boxes and full BoxSpin reels.
      // Keep the calls independent: an old/mid-deploy API can serve one route
      // correctly while the other is temporarily unavailable.
      const [feedCall, legsCall] = await Promise.allSettled([
        fetchJSON(`/lootbox/feed?limit=200&player=${encodeURIComponent(owner)}`),
        fetchJSON(`/lootbox/legs?limit=200&player=${encodeURIComponent(owner)}`),
      ]);
      if (this.#addr !== owner) return;
      const response = feedCall.status === 'fulfilled' ? feedCall.value : null;
      const legsResponse = legsCall.status === 'fulfilled' ? legsCall.value : null;
      const revealed = _readRevealed(owner);
      const feedRows = new Map();
      for (const item of Array.isArray(response?.items) ? response.items : []) {
        // Client-side filtering is deliberate. It keeps the wallet view honest
        // against older API deployments that accepted `player` but ignored it.
        if (String(item?.player || '').toLowerCase() !== owner) continue;
        const index = Number(item?.resolvedIndex);
        if (!Number.isFinite(index) || index <= 0) continue;
        const row = feedRows.get(index) || {
          index, day: null, ready: false, resolved: false, opening: false,
          fromReceipt: false, transactionHash: null, transactionHashes: [],
          amountWei: '0', hasLootboxLeg: false, hasPresaleLeg: false,
        };
        row.transactionHash = String(item?.transactionHash || row.transactionHash || '').toLowerCase() || null;
        if (row.transactionHash && !row.transactionHashes.includes(row.transactionHash)) {
          row.transactionHashes.push(row.transactionHash);
        }
        try {
          // costRawWei is the pre-boon spend. The credited box amount is what
          // the deterministic BoxSpin id commits to, so retain it when the
          // feed supplies it and use cost only for older API rows.
          row.amountWei = String(
            BigInt(row.amountWei) + BigInt(item?.boxAmountRawWei ?? item?.costRawWei ?? 0),
          );
        }
        catch (_e) { /* retain the sum recovered so far */ }
        if (item?.presale === true) row.hasPresaleLeg = true;
        if (item?.presale === false) row.hasLootboxLeg = true;
        const resultTypes = new Set((Array.isArray(item?.results) ? item.results : [])
          .map((result) => String(result?.rewardType || '')));
        row.hasPresaleLeg ||= resultTypes.has('presale_opened');
        row.hasLootboxLeg ||= resultTypes.has('opened') || resultTypes.has('flipOpened');
        row.ready ||= Boolean(item?.rngReady);
        row.resolved ||= Boolean(item?.opened)
          || resultTypes.has('opened')
          || resultTypes.has('flipOpened')
          || resultTypes.has('presale_opened');
        if (row.resolved) row.ready = true;
        feedRows.set(index, row);
      }

      const local = new Map(this.#boxes.map((box) => [_boxKey(box), box]));
      const tracked = new Set(local.keys());
      const resolvedRows = resolvedBoxRowsFromLegs(legsResponse?.items, owner);
      const resolvedByKey = new Map(resolvedRows.map((row) => [_boxKey(row), row]));

      // If receipt parsing could not recover the index, the indexed purchase
      // later promotes the exact submitted-hash placeholder without touching
      // any other box already in Pending.
      for (const feed of feedRows.values()) {
        if (!feed.transactionHash) continue;
        const submittedKey = `submitted:${feed.transactionHash}`;
        const submitted = local.get(submittedKey);
        if (!submitted) continue;
        local.delete(submittedKey);
        local.set(String(feed.index), {
          ...submitted,
          ...feed,
          resultKey: String(feed.index),
          optimistic: false,
          fromReceipt: true,
          amountWei: submitted.amountWei ?? feed.amountWei,
          hasLootboxLeg: Boolean(submitted.hasLootboxLeg || feed.hasLootboxLeg),
          hasPresaleLeg: Boolean(submitted.hasPresaleLeg || feed.hasPresaleLeg),
        });
      }
      const priorCursor = _readResultCursor(owner);
      const newestOrd = resolvedRows.reduce(
        (highest, row) => Math.max(highest, Number(row.ord) || 0),
        priorCursor ?? 0,
      );

      // Reconcile only rows the browser was already tracking. Feeding every
      // historical `opened` purchase into the tray is what produced dozens of
      // phantom OPEN notifications on a fresh browser.
      for (const key of tracked) {
        if (revealed.has(key)) {
          local.delete(key);
          continue;
        }
        const prior = local.get(key);
        const feed = Number(prior?.index) > 0 ? feedRows.get(Number(prior.index)) : null;
        const settled = resolvedByKey.get(key);
        if (settled) {
          local.set(key, {
            ...prior,
            ...settled,
            transactionHashes: [...new Set([
              ...(Array.isArray(prior?.transactionHashes) ? prior.transactionHashes : []),
              ...(Array.isArray(feed?.transactionHashes) ? feed.transactionHashes : []),
            ].filter(Boolean).map((hash) => String(hash).toLowerCase()))],
            amountWei: _firstPositiveAmount(
              feed?.amountWei,
              prior?.amountWei,
              settled.amountWei,
            ),
            hasLootboxLeg: Boolean(
              prior?.hasLootboxLeg || feed?.hasLootboxLeg || settled.hasLootboxLeg,
            ),
            hasPresaleLeg: Boolean(
              prior?.hasPresaleLeg || feed?.hasPresaleLeg || settled.hasPresaleLeg,
            ),
            ready: true,
            resolved: true,
            resultSyncing: false,
          });
        } else if (feed) {
          local.set(key, {
            ...prior,
            transactionHash: prior?.transactionHash ?? feed.transactionHash,
            transactionHashes: [...new Set([
              ...(Array.isArray(prior?.transactionHashes) ? prior.transactionHashes : []),
              prior?.transactionHash,
              ...(Array.isArray(feed.transactionHashes) ? feed.transactionHashes : []),
              feed.transactionHash,
            ].filter(Boolean).map((hash) => String(hash).toLowerCase()))],
            amountWei: BigInt(feed.amountWei ?? 0) > 0n
              ? feed.amountWei
              : prior?.amountWei,
            hasLootboxLeg: Boolean(prior?.hasLootboxLeg || feed.hasLootboxLeg),
            hasPresaleLeg: Boolean(prior?.hasPresaleLeg || feed.hasPresaleLeg),
            ready: Boolean(feed.ready),
            resolved: Boolean(feed.resolved),
          });
        }
      }

      // First visit establishes a history baseline and offers only the newest
      // result. After that, EVERY result newer than the durable cursor is kept,
      // so several boxes settling between polls cannot collapse into one chip.
      const discovered = priorCursor == null
        ? resolvedRows.slice(0, 1)
        : resolvedRows.filter((row) => Number(row.ord) > priorCursor);
      for (const settled of discovered) {
        const key = _boxKey(settled);
        if (!key || revealed.has(key)) continue;
        const prior = local.get(key);
        const feed = Number(settled.index) > 0 ? feedRows.get(Number(settled.index)) : null;
        local.set(key, {
          ...prior,
          ...settled,
          transactionHashes: [...new Set([
            ...(Array.isArray(prior?.transactionHashes) ? prior.transactionHashes : []),
            ...(Array.isArray(feed?.transactionHashes) ? feed.transactionHashes : []),
          ].filter(Boolean).map((hash) => String(hash).toLowerCase()))],
          amountWei: _firstPositiveAmount(
            feed?.amountWei,
            prior?.amountWei,
            settled.amountWei,
          ),
          hasLootboxLeg: Boolean(
            prior?.hasLootboxLeg || feed?.hasLootboxLeg || settled.hasLootboxLeg,
          ),
          hasPresaleLeg: Boolean(
            prior?.hasPresaleLeg || feed?.hasPresaleLeg || settled.hasPresaleLeg,
          ),
          ready: true,
          resolved: true,
          resultSyncing: false,
          opening: false,
          fromReceipt: Boolean(prior?.fromReceipt),
        });
      }
      if (legsCall.status === 'fulfilled') _writeResultCursor(owner, newestOrd);

      // Unresolved DB purchases are only candidates. `opened:false` is not
      // authoritative for legacy rows whose settlement event lacked an index;
      // the player's live amount slot decides whether a box really exists.
      const candidates = new Map(
        [...local.values()]
          .filter((box) => !box.resolved && Number(box.index) > 0)
          .map((box) => [_boxKey(box), box]),
      );
      for (const row of feedRows.values()) {
        if (row.resolved
          || revealed.has(String(row.index))
          || this.#emptyIndexes.has(row.index)) continue;
        const key = String(row.index);
        if (!candidates.has(key)) candidates.set(key, { ...row, resultKey: key });
      }

      const probes = [...candidates.values()];
      const probeResults = await Promise.allSettled(probes.map(async (box) => {
        const status = await readLootboxStatus({
          player: owner,
          lootboxIndex: box.index,
        }).catch(() => null);
        const hasAmount = Boolean(status && BigInt(status.amount ?? 0) > 0n);
        let hasLootboxLeg = Boolean(box.hasLootboxLeg);
        let hasPresaleLeg = Boolean(box.hasPresaleLeg);
        let receiptAmountWei = null;
        const purchaseHashes = [
          ...(Array.isArray(box?.transactionHashes) ? box.transactionHashes : []),
          box?.transactionHash,
        ].filter(Boolean);
        if (purchaseHashes.length > 0) {
          const purchase = await this.#readPurchaseKinds(box, owner);
          if (purchase) {
            hasLootboxLeg ||= purchase.hasLootboxLeg;
            hasPresaleLeg ||= purchase.hasPresaleLeg;
            receiptAmountWei = String(purchase.amountWei);
          }
        }
        const presaleOnly = hasPresaleLeg && !hasLootboxLeg;
        let chainReady = false;
        // Re-probe a box that has actually failed. `ready` used to latch: once
        // true it was never checked again, so a box the chain had stopped
        // accepting stayed armed forever and every click failed the same way.
        // Healthy ready boxes still skip the RPC — only failures pay for it.
        const suspect = Number(box.openFailures) > 0;
        if ((hasAmount || presaleOnly) && (!box.ready || suspect)) {
          chainReady = await canOpenLootbox({
            player: owner,
            lootboxIndex: box.index,
          }).catch(() => false);
        }
        return {
          key: _boxKey(box),
          index: box.index,
          candidate: box,
          statusKnown: status != null,
          amountWei: status == null ? null : String(status.amount ?? 0),
          hasAmount,
          hasLootboxLeg,
          hasPresaleLeg,
          presaleOnly,
          receiptAmountWei,
          ready: (hasAmount || presaleOnly)
            && (suspect ? chainReady : (Boolean(box.ready) || chainReady)),
        };
      }));
      if (this.#addr !== owner) return;
      for (const result of probeResults) {
        if (result.status !== 'fulfilled') continue;
        const {
          key, index, candidate, statusKnown, amountWei, hasAmount, ready,
          hasLootboxLeg, hasPresaleLeg, presaleOnly, receiptAmountWei,
        } = result.value;
        const prior = local.get(key);
        if (!statusKnown && !presaleOnly) {
          // A receipt row survives an RPC blip; an unverified DB-history row
          // never earns a notification from an unavailable status read.
          if (!prior?.fromReceipt) local.delete(key);
          continue;
        }
        if (presaleOnly) {
          local.set(key, {
            ...candidate,
            ...prior,
            ready,
            resolved: false,
            opening: Boolean(prior?.opening),
            fromReceipt: Boolean(prior?.fromReceipt),
            hasLootboxLeg,
            hasPresaleLeg,
            amountWei: prior?.amountWei ?? candidate?.amountWei ?? receiptAmountWei,
          });
          continue;
        }
        if (!hasAmount) {
          if (prior?.fromReceipt) {
            // A receipt-confirmed box cannot become disposable merely because
            // somebody else won the permissionless open race. A zero slot
            // proves settlement, but result legs can trail it in the indexer.
            local.set(key, {
              ...candidate,
              ...prior,
              ready: false,
              resolved: true,
              resultSyncing: true,
              opening: false,
              amountWei: prior?.amountWei ?? candidate?.amountWei ?? amountWei,
            });
          } else {
            local.delete(key);
            this.#emptyIndexes.add(index);
          }
          continue;
        }
        local.set(key, {
          ...candidate,
          ...prior,
          ready,
          resolved: false,
          amountWei: prior?.amountWei ?? candidate?.amountWei ?? amountWei,
          opening: Boolean(prior?.opening),
          fromReceipt: Boolean(prior?.fromReceipt),
          hasLootboxLeg,
          hasPresaleLeg,
        });
      }

      this.#boxes = [...local.values()].sort((a, b) => (
        (Number(b.ord) || 0) - (Number(a.ord) || 0)
        || Number(b.index) - Number(a.index)
      ));
      await this.#refreshSyncingResults(owner);
      if (this.#addr !== owner) return;
      _writePending(owner, this.#boxes);
      this.#render();
    } catch (_e) {
      // API/indexer blip — keep the last honest state and retry next tick.
    } finally {
      this.#pollBusy = false;
    }
  }

  async #refreshSyncingResults(owner) {
    const syncing = this.#boxes.filter((box) => (
      box.resolved
      && box.resultSyncing
      && !this.#activeRevealKeys.has(_boxKey(box))
    ));
    if (syncing.length === 0) return;

    // A settled slot is no longer an action the wallet can perform. Poll for
    // its immutable result in the background and promote it exactly once when
    // a complete replay is available; never make Auto retry the same miss.
    for (const box of syncing) box.ready = false;
    const recovered = await Promise.allSettled(syncing.map(async (box) => ({
      key: _boxKey(box),
      legs: await this.#readResolvedBoxLegs(box),
    })));
    if (this.#addr !== owner) return;
    for (const result of recovered) {
      if (result.status !== 'fulfilled' || result.value.legs.length === 0) continue;
      const box = this.#boxes.find((candidate) => _boxKey(candidate) === result.value.key);
      if (!box) continue;
      const resultHash = result.value.legs.find((leg) => leg?.transactionHash)?.transactionHash;
      if (resultHash) box.resultTransactionHash = String(resultHash).toLowerCase();
      box.ready = true;
      box.resultSyncing = false;
    }
  }

  // -------------------------------------------------------------------------
  // Open click → openBox tx → receipt legs → reveal overlay.
  // -------------------------------------------------------------------------

  async #onOpenClick(box) {
    if (box.opening || !box.ready) return false;
    box.opening = true;
    this.#render();
    this.#clearError();
    const presaleOnly = Boolean(box.hasPresaleLeg && !box.hasLootboxLeg);
    try {
      if (box.resolved) {
        return await this.#replayResolvedBox(box);
      }
      // The indexer can learn about a settlement between polling cycles (or
      // while the connected RPC is still serving the pre-settlement block).
      // Prefer that immutable result before consulting the mutable amount
      // slot; otherwise a stale non-zero RPC read can send the player into an
      // unnecessary openBox wallet flow for a box that is already finished.
      if (await this.#replayResolvedBox(box, { silentIfMissing: true })) return;
      // Never open from a stale UI snapshot. The amount slot is cleared before
      // the settlement events emit, so zero means another wallet/crank already
      // won the race and this click should replay, not ask for a doomed tx.
      const status = await readLootboxStatus({
        player: this.#addr,
        lootboxIndex: box.index,
      }).catch(() => null);
      if (!presaleOnly && status && status.amount === 0n) {
        return await this.#replayResolvedBox(box);
      }

      const { receipt } = await openLootBox({
        player: this.#addr,
        lootboxIndex: box.index,
      });
      let legs = parseOpenLegsFromReceipt(receipt, this.#addr);
      legs = await enrichLootboxBoonLegs(legs, {
        player: this.#addr,
        blockNumber: receipt?.blockNumber ?? null,
      });
      const settlementHash = receipt?.hash || receipt?.transactionHash || null;
      if (legs.length > 0) {
        box.resultTransactionHash = settlementHash || box.resultTransactionHash || null;
        box.transactionHash = settlementHash || box.transactionHash || null;
        return this.#queueBoxReveal(box, legs);
      } else {
        // The transaction landed, but its result ABI was newer than this
        // client. Persist the settlement hash and let the background result
        // reader recover it; this is no longer an open action and must not be
        // auto-clicked every polling interval.
        box.resultTransactionHash = settlementHash || box.resultTransactionHash || null;
        box.opening = false;
        box.ready = false;
        box.resolved = true;
        box.resultSyncing = true;
        if (this.#addr) _writePending(this.#addr, this.#boxes);
        this.#render();
        void this.#runPollCycle();
        return false;
      }
    } catch (error) {
      box.opening = false;
      const rawMsg = error?.userMessage || error?.message || '';
      const latest = await readLootboxStatus({
        player: this.#addr,
        lootboxIndex: box.index,
      }).catch(() => null);
      const clearedByRace = !presaleOnly
        && latest != null && BigInt(latest.amount ?? 0) === 0n;
      // A competitor can land between the read and our wallet broadcast. Treat
      // the contract's race signal exactly like the pre-read's zero slot:
      // recover the indexed result and replay it, without dropping the receipt
      // row while its settlement legs are still indexing.
      if (clearedByRace || /already|nothing|no box|resolved/i.test(String(rawMsg))) {
        return await this.#replayResolvedBox(box);
      } else {
        // Record the failure so the next poll RE-PROBES this box instead of
        // trusting its latched `ready`. A box the chain has stopped accepting
        // (the terminal liveness gate reverts every openBox, LootboxModule:648)
        // otherwise stays armed and fails identically on every click.
        box.openFailures = Math.max(0, Number(box.openFailures) || 0) + 1;
        this.#renderError(compactUiError(error, 'Box did not open. Try again.'));
        this.#render();
        return false;
      }
    }
  }

  async #readResolvedBoxLegs(box) {
    const key = _boxKey(box);
    const cached = this.#resolvedLegCache.get(key);
    if (Array.isArray(cached) && cached.length > 0) return cached;
    let legs = [];
    try {
      // Ask for both the exact index and the player's newest legs. Current APIs
      // attach the opening index to every same-transaction leg; older deployed
      // APIs leave BoxSpin.index null and only the unfiltered player page can
      // carry those reels. Merging both shapes preserves every spin.
      const base = `/lootbox/legs?limit=200&player=${encodeURIComponent(this.#addr)}`;
      const [exactCall, recentCall] = await Promise.allSettled([
        fetchJSON(`${base}&lootboxIndex=${encodeURIComponent(box.index)}`),
        fetchJSON(base),
      ]);
      const rows = _mergeLegRows(
        exactCall.status === 'fulfilled' ? exactCall.value?.items : [],
        recentCall.status === 'fulfilled' ? recentCall.value?.items : [],
      );
      legs = openLegsFromFeed(rows, {
        player: this.#addr,
        lootboxIndex: box.index,
        // Prefer the settlement hash recorded when the leg feed proved this box
        // was opened (resolvedBoxRowsFromLegs). Discarding it and re-deriving an
        // anchor by index is what let the two matching rules disagree: the poll
        // marked the box resolved, this lookup found no anchor, and the box
        // latched resolved with nothing to replay. Falling back to
        // `box.transactionHash` only for index zero preserves the old behaviour
        // for receipt-discovered boxes, where that hash IS the purchase.
        transactionHash: box.resultTransactionHash
          || (Number(box.index) === 0 ? box.transactionHash : null),
      });
    } catch (_e) {
      // Fall through to the exact chain-event replay below.
    }
    if (_needsReceiptRecovery(legs) && Number(box.index) > 0) {
      try {
        const receiptLegs = await readOpenLegsFromChain({
          player: this.#addr,
          lootboxIndex: box.index,
          boxAmountWei: box.amountWei,
          purchaseTransactionHashes: [
            box.resultTransactionHash,
            ...(Array.isArray(box.transactionHashes) ? box.transactionHashes : []),
            box.transactionHash,
          ].filter(Boolean),
        });
        if (receiptLegs.length > 0) legs = receiptLegs;
      } catch (_e) {
        // Keep the indexed result if receipt recovery is temporarily
        // unavailable; its concrete zero/fractional result is still truthful.
      }
    }

    legs = await enrichLootboxBoonLegs(legs, {
      player: this.#addr,
      blockNumber: box.blockNumber ?? null,
    });
    if (key && legs.length > 0) this.#resolvedLegCache.set(key, legs);
    return legs;
  }

  async #replayResolvedBox(box, {
    silentIfMissing = false,
  } = {}) {
    const legs = await this.#readResolvedBoxLegs(box);
    if (legs.length > 0) {
      const accepted = this.#queueBoxReveal(box, legs, { settledExpected: true });
      if (!accepted) {
        // A matching presentation is already queued or was shown this session.
        // The indexed legs still prove settlement, so retire this duplicate
        // action instead of falling through to an impossible wallet write.
        const address = this.#addr;
        const key = _boxKey(box);
        if (address && key) _markRevealed(address, key);
        if (key) this.#removeBox(key);
      }
      return true;
    }

    // Probe mode is used immediately before a write. A miss simply continues
    // to the fresh amount-slot check without changing the button's busy state.
    if (silentIfMissing) return false;

    // A miss here used to unconditionally re-arm `ready + resolved`, which put
    // the box straight back into this same branch on the next click: a silent
    // loop that never opened and never gave up, because `resultSyncing`
    // suppresses the error toast. Ask the chain what is actually true before
    // deciding whether waiting is even the right thing to do.
    box.opening = false;
    const status = await readLootboxStatus({
      player: this.#addr,
      lootboxIndex: box.index,
    }).catch(() => null);

    if (status != null && BigInt(status.amount ?? 0) > 0n) {
      // The slot still holds ETH, so the box is NOT settled and there are no
      // legs to replay — it was marked resolved in error (the poll matches the
      // leg feed by index, this path re-filters it by a different rule, and the
      // two can disagree). Hand it back to the normal open path.
      box.resolved = false;
      box.resultSyncing = false;
      this.#resolvedLegCache.delete(_boxKey(box));
      if (this.#addr) _writePending(this.#addr, this.#boxes);
      this.#render();
      return false;
    }

    // Settled on chain, legs still indexing. This is passive synchronization,
    // not a repeatable player action: disarm the row and let the normal poll
    // promote it once a complete result is available.
    box.ready = false;
    box.resolved = true;
    box.resultSyncing = true;
    if (this.#addr) _writePending(this.#addr, this.#boxes);
    this.#render();
    return false;
  }

  #queueBoxReveal(box, legs, { title = null, settledExpected = false } = {}) {
    const address = this.#addr;
    const key = _boxKey(box);
    if (!address || !key || !Array.isArray(legs) || legs.length === 0) return false;
    recordLootboxTicketPacks({
      address,
      legs,
      sourceKey: `lootbox:${key}`,
      settledExpected,
    }).catch(() => {});
    const accepted = queueReveal({
      kind: 'lootbox',
      ...(title ? { title } : {}),
      lootboxIndex: box.index,
      amountWei: box.amountWei,
      ticketPriceWei: box.ticketPriceWei,
      legs,
      settledExpected,
      lootboxRelease: {
        address,
        key,
        lootboxIndex: Number(box.index),
        transactionHash: box.transactionHash || null,
      },
    });
    if (!accepted) return false;
    // Hide the action while its presentation is active, but keep its durable
    // receipt until completion. If the overlay aborts or the page reloads, the
    // player gets the result action back instead of losing it from Pending.
    // The indexed legs are now in hand, so an aborted presentation is a normal
    // "View result" retry instead of falling back to the stale syncing label.
    box.resultSyncing = false;
    this.#activeRevealKeys.add(key);
    box.opening = true;
    _writePending(address, this.#boxes);
    this.#render();
    return true;
  }

  #removeBox(keyOrIndex) {
    const key = String(keyOrIndex);
    this.#activeRevealKeys.delete(key);
    this.#resolvedLegCache.delete(key);
    this.#boxes = this.#boxes.filter((box) => _boxKey(box) !== key);
    if (this.#addr) _writePending(this.#addr, this.#boxes);
    this.#render();
  }

  #clearAllBoxes() {
    const address = this.#addr;
    if (!address || this.#boxes.some((box) => box.opening)) return false;
    // CLEAR is presentation-only. Mark every tracked result as seen so the
    // database discovery pass does not recreate the same notification after a
    // refresh; any unopened box and all of its rewards remain untouched on
    // chain and can still be resolved permissionlessly later.
    for (const box of this.#boxes) {
      const key = _boxKey(box);
      if (key) _markRevealed(address, key);
    }
    this.#boxes = [];
    this.#resolvedLegCache.clear();
    _writePending(address, this.#boxes);
    this.#render();
    return true;
  }

  // -------------------------------------------------------------------------
  // Render — chips via createElement (T-58-18).
  // -------------------------------------------------------------------------

  #publishPending() {
    if (!this.#addr) {
      clearPendingActions(PENDING_SOURCE);
      return;
    }
    const visibleBoxes = this.#boxes.filter((box) => !this.#activeRevealKeys.has(_boxKey(box)));
    publishPendingActions(PENDING_SOURCE, visibleBoxes.map((box) => {
      const value = _boxValuePresentation(box);
      const resultSyncing = Boolean(box.resolved && box.resultSyncing);
      return {
      id: `lootbox:${_boxKey(box)}`,
      dismissScope: this.#addr,
      // Several buys can share one live RNG index. Version the presentation
      // tombstone by its mined purchase receipts so clearing an older box does
      // not hide a later pass or presale purchase in the same batch.
      dismissKey: _boxDismissKey(box),
      kind: 'lootbox',
      mayAddEth: Boolean(box.resolved),
      amountWei: box.amountWei == null ? null : String(box.amountWei),
      amountLabel: _boxAmountLabel(box),
      ticketPriceWei: value.ticketPriceWei == null ? null : String(value.ticketPriceWei),
      lootboxValueTone: value.tone,
      lootboxTicketUnitsLabel: value.unitsLabel,
      label: _boxLabel(box),
      lootboxLabel: _boxLabel(box, true),
      shortLabel: box.optimistic
        ? 'Transaction sent'
        : box.index == null
          ? 'Syncing purchase'
          : resultSyncing ? 'Syncing result' : box.resolved ? 'View result' : 'Open box',
      detail: box.optimistic
        ? 'Purchase sent · waiting for confirmation'
        : box.index == null
          ? 'Purchase confirmed · syncing RNG queue'
        : resultSyncing
          ? 'Settlement confirmed · loading the reveal receipt'
        : box.opening
        ? box.resolved ? 'Loading indexed result' : 'Opening on-chain'
        : box.ready
          ? box.resolved ? 'Result indexed · ready to replay' : 'RNG ready · prizes locked'
          : `Waiting for RNG${box.day == null ? '' : ` · Day ${box.day}`}`,
      state: box.opening ? 'busy' : resultSyncing ? 'waiting' : box.ready ? 'ready' : 'waiting',
      // Normal purchased boxes and Degenerette share the mid-day Chainlink
      // batch. Publishing that relationship explicitly lets the permanent RNG
      // widget appear on the receipt paint, inherit the real queue fill, and
      // become the request control without waiting for the indexer.
      sharedRng: !box.optimistic,
      phase: box.optimistic
        ? 'submitting'
        : resultSyncing ? 'indexing' : box.opening ? 'resolving' : box.ready ? 'result-ready' : 'awaitingRng',
      // Pending/RNG-ready boxes cannot spoil a payout that does not exist yet.
      // Consumers may gate balances only after an indexed settlement exists.
      resolved: Boolean(box.resolved),
      pinned: true,
      // Readiness changes what clicking the receipt does, not its shape. The
      // compact amount + box-glyph label remains the entire open target.
      compact: true,
      progress: resultSyncing || (!box.ready && !box.opening) ? 'indeterminate' : null,
      write: !box.resolved,
      // A resolved/indexed box only replays its popup. An unresolved ready box
      // still needs an explicit openBox wallet transaction and is never run by
      // the tray's OPEN WHEN READY preference.
      autoOpen: Boolean(box.resolved && box.ready && !box.opening && !resultSyncing),
      order: 20,
      chronology: Number.isFinite(Number(box.createdAt))
        ? Number(box.createdAt)
        : Number.isFinite(Number(box.ord)) ? Number(box.ord) : Number(box.index),
      run: () => this.#onOpenClick(box),
      clearAll: () => this.#clearAllBoxes(),
      };
    }));
  }

  #render() {
    this.#publishPending();
    const strip = this.#bind('bxs-strip');
    const chips = this.#bind('bxs-chips');
    if (!strip || !chips) return;
    const visibleBoxes = this.#boxes.filter((box) => !this.#activeRevealKeys.has(_boxKey(box)));
    const show = Boolean(this.#addr) && visibleBoxes.length > 0;
    strip.hidden = !show;
    chips.textContent = '';
    if (!show) return;
    for (const box of visibleBoxes) {
      const value = _boxValuePresentation(box);
      const chip = document.createElement('div');
      chip.className = `bxs-chip${box.ready ? ' bxs-chip--ready' : ''}`
        + (box.opening ? ' bxs-chip--opening' : '');
      chip.setAttribute('data-lootbox-value-tone', value.tone);
      if (value.unitsLabel) chip.title = `${value.unitsLabel} ticket-price box`;

      const art = document.createElement('span');
      art.className = 'bxs-chip-art';
      art.setAttribute('data-lootbox-value-tone', value.tone);
      chip.appendChild(art);

      const copy = document.createElement('span');
      copy.className = 'bxs-chip-copy';
      const amountLabel = _boxAmountLabel(box);
      if (amountLabel) {
        const amount = document.createElement('span');
        amount.className = 'bxs-chip-amount';
        amount.textContent = amountLabel;
        copy.appendChild(amount);
      }
      const title = document.createElement('strong');
      title.className = 'bxs-chip-title';
      title.textContent = _boxLabel(box, true);
      copy.appendChild(title);
      chip.appendChild(copy);

      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'bxs-open-cta';
      if (!box.resolved) cta.setAttribute('data-write', '');
      cta.disabled = !box.ready || box.opening;
      cta.textContent = box.opening
        ? 'OPENING…'
        : box.ready ? box.resolved ? 'VIEW RESULT' : `OPEN ${_boxLabel(box, true)}` : 'RNG PENDING';
      cta.setAttribute('aria-label', box.ready
        ? Number(box.index) === 0
          ? `${box.resolved ? 'View result for' : 'Open'} AFKing luckbox`
          : `${box.resolved ? 'View result for' : 'Open'} luckbox ${box.index}`
        : `${_boxLabel(box)} waiting for RNG`);
      if (box.ready && !box.opening) {
        cta.addEventListener('click', () => this.#onOpenClick(box));
      }
      chip.appendChild(cta);
      chips.appendChild(chip);
    }
  }

  /** Test-only: land one tracked box without an RPC. */
  __setReadyForTest(index) {
    const box = this.#boxes.find((item) => item.index === Number(index));
    if (!box) return false;
    box.ready = true;
    this.#render();
    return true;
  }

  /** Test-only deterministic polling seam. */
  async __pollForTest() { await this.#runPollCycle(); }

  #renderError(msg) {
    const errEl = this.#bind('bxs-error');
    if (!errEl) {
      // Production mounts this controller in tray-only mode. Route failures to
      // the one visible Pending surface instead of swallowing them in an
      // inline error node that does not exist there.
      reportPendingActionError(msg);
      return;
    }
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
    const errEl = this.#bind('bxs-error');
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

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-box-strip')) {
    customElements.define('app-box-strip', AppBoxStrip);
  }
}

export { AppBoxStrip };
