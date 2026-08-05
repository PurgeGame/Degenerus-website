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
//     the indexed prizes (or an honest settled card) instead of erroring.
//
// One chip = one RNG batch index. Multiple boxes bought in one purchase()
// share the index and open together in one openBox call (LootboxModule
// resolves every box queued at the index).
//
// Class palette: .bxs-* (non-colliding).

import { CHAIN } from '../app/chain-config.js';
import { get, subscribe } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import {
  openLootBox,
  canOpenLootbox,
  readLootboxStatus,
} from '../app/lootbox.js';
import { compactUiError } from '../app/ui-error.js';
import {
  enrichLootboxBoonLegs,
  parseOpenLegsFromReceipt,
  openLegsFromFeed,
  readOpenLegsFromChain,
} from '../app/lootbox-legs.js';
import { publishPendingActions, clearPendingActions } from '../app/pending-actions.js';
import { recordLootboxTicketPacks } from '../app/pack-watch.js';
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

function _boxLabel(box, upper = false) {
  const label = Number(box?.index) === 0 ? 'AFKing lootbox' : `Lootbox #${box?.index}`;
  return upper ? label.toUpperCase() : label;
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

function _readPending(addr) {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(pendingBoxesKey(CHAIN.id, addr)) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && (Number.isFinite(Number(e.index)) || e.resultKey != null))
      .map((e) => ({
        index: Number(e.index),
        resultKey: e.resultKey == null ? null : String(e.resultKey),
        transactionHash: e.transactionHash == null ? null : String(e.transactionHash),
        ord: Number.isFinite(Number(e.ord)) ? Number(e.ord) : null,
        day: e.day != null ? Number(e.day) : null,
        // Old cache rows predate this flag and were all receipt-sourced.
        // DB-discovered rows persist false so a stale API row cannot become a
        // trusted receipt row merely because the page refreshed.
        fromReceipt: e.fromReceipt !== false,
        createdAt: Number.isFinite(Number(e.createdAt)) ? Number(e.createdAt) : null,
        ready: Boolean(e.ready || e.resolved),
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
      index: e.index,
      resultKey: e.resultKey ?? null,
      transactionHash: e.transactionHash ?? null,
      ord: Number.isFinite(Number(e.ord)) ? Number(e.ord) : null,
      day: e.day,
      fromReceipt: e.fromReceipt !== false,
      createdAt: Number.isFinite(Number(e.createdAt)) ? Number(e.createdAt) : null,
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
    if (!['opened', 'flipOpened', 'presale'].includes(String(item?.legType || ''))) continue;
    const index = Number(item?.lootboxIndex);
    if (!Number.isFinite(index) || index < 0) continue;
    const transactionHash = String(item?.transactionHash || '').toLowerCase();
    if (index === 0 && !transactionHash) continue;
    const resultKey = index === 0 ? `tx:${transactionHash}` : String(index);
    const ord = Number(item?.ord ?? item?.logIndex ?? 0);
    const prior = rows.get(resultKey);
    if (!prior || ord > prior.ord) {
      rows.set(resultKey, {
        index,
        resultKey,
        transactionHash: transactionHash || null,
        day: null,
        ready: true,
        resolved: true,
        opening: false,
        ord,
      });
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

class AppBoxStrip extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #pollHandle = null;
  #pollBusy = false;
  #errorTimer = null;
  #docListener = null;
  #revealQueuedListener = null;
  #revealCompleteListener = null;
  #revealAbortListener = null;
  // API history can contain legacy purchase rows whose result never received
  // an index-bearing settlement anchor. Once the authoritative on-chain slot
  // confirms one of those indexes is empty, do not probe/promote it every 7s.
  #emptyIndexes = new Set();
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
      try { document.removeEventListener(LOOTBOX_REVEAL_QUEUED_EVENT, this.#revealQueuedListener); }
      catch (_) { /* defensive */ }
      try { document.removeEventListener(LOOTBOX_REVEAL_COMPLETE_EVENT, this.#revealCompleteListener); }
      catch (_) { /* defensive */ }
      try { document.removeEventListener(LOOTBOX_REVEAL_ABORT_EVENT, this.#revealAbortListener); }
      catch (_) { /* defensive */ }
    }
    this.#docListener = null;
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
      this.#boxes = this.#addr
        ? _readPending(this.#addr).map((e) => ({
            ...e,
            ready: Boolean(e.ready || e.resolved),
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
    this.#docListener = (e) => {
      const boxes = e?.detail?.boxes;
      if (!Array.isArray(boxes) || boxes.length === 0) return;
      if (!this.#addr) return;
      for (const b of boxes) {
        const index = Number(b?.index);
        if (!Number.isFinite(index)) continue;
        // afking idx-0 boxes auto-open in the buy tx — never pending.
        if (index === 0) continue;
        if (this.#boxes.some((x) => _boxKey(x) === String(index))) continue;
        this.#boxes.push({
          index,
          resultKey: String(index),
          day: b?.day != null ? Number(b.day) : null,
          ready: false,
          resolved: false,
          opening: false,
          fromReceipt: true,
          createdAt: Date.now(),
        });
        this.#emptyIndexes.delete(index);
      }
      _writePending(this.#addr, this.#boxes);
      this.#render();
      this.#runPollCycle();
    };
    document.addEventListener('app-decimator:tx-confirmed', this.#docListener);

    // A direct Degenerette settlement and the durable box feed can discover the
    // same index-zero box independently. As soon as that exact result is queued
    // behind the reels, retire the tray copy; waiting until the reveal finishes
    // leaves a second OPEN LOOTBOX button pointing at the same on-chain legs.
    this.#revealQueuedListener = (event) => {
      const detail = event?.detail;
      const address = String(detail?.address || '').toLowerCase();
      const key = String(detail?.key || '');
      if (!address || !key) return;
      _markRevealed(address, key);
      if (address === this.#addr) this.#removeBox(key);
    };
    this.#revealCompleteListener = (event) => {
      const detail = event?.detail;
      const address = String(detail?.address || '').toLowerCase();
      const key = String(detail?.key || '');
      if (!address || !key) return;
      _markRevealed(address, key);
      if (address === this.#addr) this.#removeBox(key);
    };
    this.#revealAbortListener = (event) => {
      for (const release of Array.isArray(event?.detail?.releases)
        ? event.detail.releases : []) {
        if (String(release?.address || '').toLowerCase() !== this.#addr) continue;
        const key = String(release?.key || '');
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
          fromReceipt: false,
        };
        const resultTypes = new Set((Array.isArray(item?.results) ? item.results : [])
          .map((result) => String(result?.rewardType || '')));
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
          local.set(key, { ...prior, ...settled, ready: true, resolved: true });
        } else if (feed) {
          local.set(key, {
            ...prior,
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
        local.set(key, {
          ...prior,
          ...settled,
          ready: true,
          resolved: true,
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
        let chainReady = false;
        if (hasAmount && !box.ready) {
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
          hasAmount,
          ready: hasAmount && (Boolean(box.ready) || chainReady),
        };
      }));
      if (this.#addr !== owner) return;
      for (const result of probeResults) {
        if (result.status !== 'fulfilled') continue;
        const { key, index, candidate, statusKnown, hasAmount, ready } = result.value;
        const prior = local.get(key);
        if (!statusKnown) {
          // A receipt row survives an RPC blip; an unverified DB-history row
          // never earns a notification from an unavailable status read.
          if (!prior?.fromReceipt) local.delete(key);
          continue;
        }
        if (!hasAmount) {
          const indexedPurchase = feedRows.has(index);
          const recentReceipt = prior?.fromReceipt
            && Number.isFinite(Number(prior?.createdAt))
            && Date.now() - Number(prior.createdAt) < 120_000;
          if (recentReceipt && !indexedPurchase) {
            // A real recent purchase may have been opened by somebody else
            // before either DB route sees it. Keep only that short receipt-to-
            // indexer bridge hidden; once the purchase itself is indexed, a
            // zero amount is authoritative and the stale notification is gone.
            local.set(key, { ...prior, ready: false, resolved: false });
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
          opening: Boolean(prior?.opening),
          fromReceipt: Boolean(prior?.fromReceipt),
        });
      }

      this.#boxes = [...local.values()].sort((a, b) => (
        (Number(b.ord) || 0) - (Number(a.ord) || 0)
        || Number(b.index) - Number(a.index)
      ));
      _writePending(owner, this.#boxes);
      this.#render();
    } catch (_e) {
      // API/indexer blip — keep the last honest state and retry next tick.
    } finally {
      this.#pollBusy = false;
    }
  }

  // -------------------------------------------------------------------------
  // Open click → openBox tx → receipt legs → reveal overlay.
  // -------------------------------------------------------------------------

  async #onOpenClick(box) {
    if (box.opening || !box.ready) return;
    box.opening = true;
    this.#render();
    this.#clearError();
    try {
      if (box.resolved) {
        await this.#replayResolvedBox(box);
        return;
      }
      // Never open from a stale UI snapshot. The amount slot is cleared before
      // the settlement events emit, so zero means another wallet/crank already
      // won the race and this click should replay, not ask for a doomed tx.
      const status = await readLootboxStatus({
        player: this.#addr,
        lootboxIndex: box.index,
      }).catch(() => null);
      if (status && status.amount === 0n) {
        await this.#replayResolvedBox(box, { retireIfMissing: true });
        return;
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
      if (legs.length > 0) {
        box.transactionHash = receipt?.hash || receipt?.transactionHash || box.transactionHash || null;
        this.#queueBoxReveal(box, legs);
      } else {
        // The transaction landed, but its result ABI was newer than this
        // client. Keep the item ready so the DB leg feed can recover it.
        box.opening = false;
        box.ready = true;
        box.resolved = true;
        this.#renderError('Result syncing — try again shortly.');
        this.#render();
      }
    } catch (error) {
      box.opening = false;
      const rawMsg = error?.userMessage || error?.message || '';
      // A competitor can land between the read and our wallet broadcast. Treat
      // the contract's race signal exactly like the pre-read's zero slot:
      // recover the indexed result and replay it, without surfacing a failure.
      if (/already|nothing|no box|resolved/i.test(String(rawMsg))) {
        await this.#replayResolvedBox(box, { retireIfMissing: true });
      } else {
        this.#renderError(compactUiError(error, 'Box did not open. Try again.'));
        this.#render();
      }
    }
  }

  async #replayResolvedBox(box, { retireIfMissing = false } = {}) {
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
        transactionHash: box.transactionHash,
      });
    } catch (_e) {
      // Fall through to the exact chain-event replay below.
    }
    if (legs.length === 0 && Number(box.index) > 0) {
      try {
        legs = await readOpenLegsFromChain({
          player: this.#addr,
          lootboxIndex: box.index,
        });
      } catch (_e) {
        // A spin-only outcome carries no index-bearing event. The honest
        // settled presentation below handles that irreducible case.
      }
    }

    legs = await enrichLootboxBoonLegs(legs, {
      player: this.#addr,
      blockNumber: box.blockNumber ?? null,
    });
    if (legs.length > 0 && this.#queueBoxReveal(box, legs, {
      settledExpected: true,
    })) return;

    if (retireIfMissing) {
      // The live amount slot is authoritative: zero means there is no box left
      // to open. If neither indexed nor chain event legs can reconstruct an old
      // result, keeping a dead button forever cannot improve that situation.
      const address = this.#addr;
      const key = _boxKey(box);
      if (address && key) _markRevealed(address, key);
      this.#removeBox(key);
      return;
    }

    // Do not retire an indexed result just because a companion leg is still
    // catching up. It remains actionable and the next poll/click can rebuild
    // the complete transaction result instead of losing it forever.
    box.opening = false;
    box.ready = true;
    box.resolved = true;
    this.#renderError('Result syncing — try again shortly.');
    if (this.#addr) _writePending(this.#addr, this.#boxes);
    this.#render();
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
      legs,
      lootboxRelease: {
        address,
        key,
        lootboxIndex: Number(box.index),
        transactionHash: box.transactionHash || null,
      },
    });
    if (!accepted) return false;
    // A click consumes the presentation action, not the underlying on-chain
    // prize. Retire it as soon as the reveal engine accepts the sequence so the
    // bottom tray cannot offer the same box again while the overlay is playing,
    // and persist that dismissal so an indexed historical row stays gone after
    // refresh. Completion events remain as an idempotent safety net.
    _markRevealed(address, key);
    this.#removeBox(key);
    return true;
  }

  #removeBox(keyOrIndex) {
    const key = String(keyOrIndex);
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
    publishPendingActions(PENDING_SOURCE, this.#boxes.map((box) => ({
      id: `lootbox:${_boxKey(box)}`,
      dismissScope: this.#addr,
      kind: 'lootbox',
      label: _boxLabel(box),
      shortLabel: box.resolved ? 'View result' : 'Open box',
      detail: box.opening
        ? box.resolved ? 'Loading indexed result' : 'Opening on-chain'
        : box.ready
          ? box.resolved ? 'Result indexed · ready to replay' : 'RNG ready · prizes locked'
          : `Waiting for RNG${box.day == null ? '' : ` · Day ${box.day}`}`,
      state: box.opening ? 'busy' : box.ready ? 'ready' : 'waiting',
      // Pending/RNG-ready boxes cannot spoil a payout that does not exist yet.
      // Consumers may gate balances only after an indexed settlement exists.
      resolved: Boolean(box.resolved),
      pinned: true,
      progress: !box.ready && !box.opening ? 'indeterminate' : null,
      write: !box.resolved,
      // A resolved/indexed box only replays its popup. An unresolved ready box
      // still needs an explicit openBox wallet transaction and is never run by
      // the tray's OPEN WHEN READY preference.
      autoOpen: Boolean(box.resolved && box.ready && !box.opening),
      order: 20,
      chronology: Number.isFinite(Number(box.createdAt))
        ? Number(box.createdAt)
        : Number.isFinite(Number(box.ord)) ? Number(box.ord) : Number(box.index),
      run: () => this.#onOpenClick(box),
      clearAll: () => this.#clearAllBoxes(),
    })));
  }

  #render() {
    this.#publishPending();
    const strip = this.#bind('bxs-strip');
    const chips = this.#bind('bxs-chips');
    if (!strip || !chips) return;
    const show = Boolean(this.#addr) && this.#boxes.length > 0;
    strip.hidden = !show;
    chips.textContent = '';
    if (!show) return;
    for (const box of this.#boxes) {
      const chip = document.createElement('div');
      chip.className = `bxs-chip${box.ready ? ' bxs-chip--ready' : ''}`
        + (box.opening ? ' bxs-chip--opening' : '');

      const art = document.createElement('span');
      art.className = 'bxs-chip-art';
      chip.appendChild(art);

      const copy = document.createElement('span');
      copy.className = 'bxs-chip-copy';
      const title = document.createElement('strong');
      title.className = 'bxs-chip-title';
      title.textContent = _boxLabel(box, true);
      copy.appendChild(title);
      const status = document.createElement('span');
      status.className = 'bxs-chip-status';
      status.textContent = box.opening
        ? box.resolved ? 'Loading result…' : 'Opening on-chain…'
        : box.ready
          ? box.resolved ? 'Result ready to replay' : 'RNG ready · prizes locked'
          : `Waiting for RNG${box.day == null ? '…' : ` · Day ${box.day}`}`;
      copy.appendChild(status);
      chip.appendChild(copy);

      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'bxs-open-cta';
      if (!box.resolved) cta.setAttribute('data-write', '');
      cta.disabled = !box.ready || box.opening;
      cta.textContent = box.opening
        ? 'OPENING…'
        : box.ready ? box.resolved ? 'VIEW RESULT' : 'OPEN LOOTBOX' : 'RNG PENDING';
      cta.setAttribute('aria-label', box.ready
        ? Number(box.index) === 0
          ? `${box.resolved ? 'View result for' : 'Open'} AFKing lootbox`
          : `${box.resolved ? 'View result for' : 'Open'} lootbox ${box.index}`
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

  #renderError(msg) {
    const errEl = this.#bind('bxs-error');
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
