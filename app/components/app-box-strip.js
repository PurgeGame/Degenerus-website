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
import { fetchJSON } from '../../beta/app/api.js';
import {
  openLootBox,
  pollRngForLootbox,
  readLootboxStatus,
} from '../app/lootbox.js';
import { compactUiError } from '../app/ui-error.js';
import {
  parseOpenLegsFromReceipt,
  openLegsFromFeed,
  readOpenLegsFromChain,
} from '../app/lootbox-legs.js';
import { publishPendingActions, clearPendingActions } from '../app/pending-actions.js';
import { queueReveal } from './reveal-overlay.js';

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

function _markRevealed(addr, index) {
  if (!addr) return;
  try {
    const seen = _readRevealed(addr);
    seen.add(String(index));
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
      .filter((e) => e && Number.isFinite(Number(e.index)))
      .map((e) => ({
        index: Number(e.index),
        day: e.day != null ? Number(e.day) : null,
        // Old cache rows predate this flag and were all receipt-sourced.
        // DB-discovered rows persist false so a stale API row cannot become a
        // trusted receipt row merely because the page refreshed.
        fromReceipt: e.fromReceipt !== false,
        createdAt: Number.isFinite(Number(e.createdAt)) ? Number(e.createdAt) : null,
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
      day: e.day,
      fromReceipt: e.fromReceipt !== false,
      createdAt: Number.isFinite(Number(e.createdAt)) ? Number(e.createdAt) : null,
    }))));
  } catch (_e) { /* quota / private mode — session-only tracking */ }
}

/**
 * Collapse the durable per-leg result feed into one resolved row per nonzero
 * lootbox RNG index. Reward and BoxSpin legs inherit their opening transaction
 * at replay time; discovery only needs the index-bearing settlement anchor.
 */
export function resolvedBoxRowsFromLegs(items, player) {
  const wantPlayer = String(player || '').toLowerCase();
  const rows = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (String(item?.player || '').toLowerCase() !== wantPlayer) continue;
    if (!['opened', 'flipOpened', 'presale'].includes(String(item?.legType || ''))) continue;
    const index = Number(item?.lootboxIndex);
    if (!Number.isFinite(index) || index <= 0) continue;
    const ord = Number(item?.ord ?? item?.logIndex ?? 0);
    const prior = rows.get(index);
    if (!prior || ord > prior.ord) {
      rows.set(index, {
        index,
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
    }
    this.#docListener = null;
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
            ...e, ready: false, resolved: false, opening: false,
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
        if (this.#boxes.some((x) => x.index === index)) continue;
        this.#boxes.push({
          index,
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

      const local = new Map(this.#boxes.map((box) => [box.index, box]));
      const tracked = new Set(local.keys());
      const resolvedRows = resolvedBoxRowsFromLegs(legsResponse?.items, owner);
      const resolvedByIndex = new Map(resolvedRows.map((row) => [row.index, row]));
      const newestResolved = resolvedRows[0]?.index ?? null;

      // Reconcile only rows the browser was already tracking. Feeding every
      // historical `opened` purchase into the tray is what produced dozens of
      // phantom OPEN notifications on a fresh browser.
      for (const index of tracked) {
        if (revealed.has(String(index))) {
          local.delete(index);
          continue;
        }
        const prior = local.get(index);
        const feed = feedRows.get(index);
        const settled = resolvedByIndex.get(index);
        if (settled) {
          local.set(index, { ...prior, ...settled, ready: true, resolved: true });
        } else if (feed) {
          local.set(index, {
            ...prior,
            ready: Boolean(feed.ready),
            resolved: Boolean(feed.resolved),
          });
        }
      }

      // On a new browser, offer exactly the newest indexed result once. Older
      // resolved history belongs in the history feeds, not the action tray.
      if (newestResolved != null && !revealed.has(String(newestResolved))) {
        const prior = local.get(newestResolved);
        const settled = resolvedByIndex.get(newestResolved);
        local.set(newestResolved, {
          ...prior,
          ...settled,
          ready: true,
          resolved: true,
          opening: false,
          fromReceipt: Boolean(prior?.fromReceipt),
        });
      }

      // Unresolved DB purchases are only candidates. `opened:false` is not
      // authoritative for legacy rows whose settlement event lacked an index;
      // the player's live amount slot decides whether a box really exists.
      const candidates = new Map(
        [...local.values()]
          .filter((box) => !box.resolved)
          .map((box) => [box.index, box]),
      );
      for (const row of feedRows.values()) {
        if (row.resolved
          || revealed.has(String(row.index))
          || this.#emptyIndexes.has(row.index)) continue;
        if (!candidates.has(row.index)) candidates.set(row.index, row);
      }

      const probes = [...candidates.values()];
      const probeResults = await Promise.allSettled(probes.map(async (box) => {
        const status = await readLootboxStatus({
          player: owner,
          lootboxIndex: box.index,
        }).catch(() => null);
        const hasAmount = Boolean(status && BigInt(status.amount ?? 0) > 0n);
        let rngWord = 0n;
        if (hasAmount && !box.ready) {
          rngWord = await pollRngForLootbox(box.index).then(
            (word) => BigInt(word || 0),
            () => 0n,
          );
        }
        return {
          index: box.index,
          candidate: box,
          statusKnown: status != null,
          hasAmount,
          ready: hasAmount && (Boolean(box.ready) || rngWord !== 0n),
        };
      }));
      if (this.#addr !== owner) return;
      for (const result of probeResults) {
        if (result.status !== 'fulfilled') continue;
        const { index, candidate, statusKnown, hasAmount, ready } = result.value;
        const prior = local.get(index);
        if (!statusKnown) {
          // A receipt row survives an RPC blip; an unverified DB-history row
          // never earns a notification from an unavailable status read.
          if (!prior?.fromReceipt) local.delete(index);
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
            local.set(index, { ...prior, ready: false, resolved: false });
          } else {
            local.delete(index);
            this.#emptyIndexes.add(index);
          }
          continue;
        }
        local.set(index, {
          ...candidate,
          ...prior,
          ready,
          resolved: false,
          opening: Boolean(prior?.opening),
          fromReceipt: Boolean(prior?.fromReceipt),
        });
      }

      this.#boxes = [...local.values()].sort((a, b) => b.index - a.index);
      _writePending(owner, this.#boxes.filter((box) => !box.resolved));
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
        await this.#replayResolvedBox(box);
        return;
      }

      const { receipt } = await openLootBox({
        player: this.#addr,
        lootboxIndex: box.index,
      });
      const legs = parseOpenLegsFromReceipt(receipt, this.#addr);
      if (legs.length > 0) {
        if (queueReveal({ kind: 'lootbox', lootboxIndex: box.index, legs })) {
          this.#removeBox(box.index);
          _markRevealed(this.#addr, box.index);
        }
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
        await this.#replayResolvedBox(box);
      } else {
        this.#renderError(compactUiError(error, 'Box did not open. Try again.'));
        this.#render();
      }
    }
  }

  async #replayResolvedBox(box) {
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
      });
    } catch (_e) {
      // Fall through to the exact chain-event replay below.
    }
    if (legs.length === 0) {
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

    if (legs.length > 0 && queueReveal({
      kind: 'lootbox',
      title: 'LOOTBOX REPLAY',
      lootboxIndex: box.index,
      legs,
    })) {
      this.#removeBox(box.index);
      _markRevealed(this.#addr, box.index);
      return;
    }

    // The on-chain amount slot is already clear and neither the indexed feed
    // nor exact event scan has revealable legs. There is no transaction this
    // button can successfully send. Retire the stale action now; if settlement
    // legs arrive later, durable discovery will offer the newest result again.
    this.#emptyIndexes.add(box.index);
    this.#removeBox(box.index);
  }

  #removeBox(index) {
    this.#boxes = this.#boxes.filter((b) => b.index !== index);
    if (this.#addr) _writePending(this.#addr, this.#boxes);
    this.#render();
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
      id: `lootbox:${box.index}`,
      kind: 'lootbox',
      label: `Lootbox #${box.index}`,
      shortLabel: box.resolved ? 'View result' : 'Open box',
      detail: box.opening
        ? box.resolved ? 'Loading indexed result' : 'Opening on-chain'
        : box.ready
          ? box.resolved ? 'Result indexed · ready to replay' : 'RNG ready · prizes locked'
          : `Waiting for RNG${box.day == null ? '' : ` · Day ${box.day}`}`,
      state: box.opening ? 'busy' : box.ready ? 'ready' : 'waiting',
      order: 20,
      run: () => this.#onOpenClick(box),
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
      title.textContent = `LOOTBOX #${box.index}`;
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
        ? `${box.resolved ? 'View result for' : 'Open'} lootbox ${box.index}`
        : `Lootbox ${box.index} waiting for RNG`);
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
