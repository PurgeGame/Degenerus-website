// /app/components/app-sdgnrs-redemptions.js — durable sDGNRS redemption tray.
//
// A live-game sDGNRS burn only SUBMITS a delayed redemption. Once the period
// roll lands, claimRedemption creates/resolves the redemption lootbox in the
// claim receipt. This headless controller keeps that second step visible in
// the fixed bottom tray, survives refreshes, and can replay a recently claimed
// redemption from its immutable transaction receipt.

import { CHAIN } from '../app/chain-config.js';
import { getProvider } from '../app/contracts.js';
import { subscribe } from '../app/store.js';
import {
  claimSdgnrsRedemption,
  discoverSdgnrsRedemptions,
  formatSdgnrsRedemptionAmount,
  parseSdgnrsRedemptionReceipt,
  readSdgnrsRedemptionState,
  SDGNRS_REDEMPTION_SUBMITTED_EVENT,
} from '../app/sdgnrs.js';
import { enrichLootboxBoonLegs, parseOpenLegsFromReceipt } from '../app/lootbox-legs.js';
import { clearPendingActions, publishPendingActions } from '../app/pending-actions.js';
import { LOOTBOX_REVEAL_COMPLETE_EVENT, queueReveal } from './reveal-overlay.js';

const PENDING_SOURCE = 'sdgnrs-redemptions';
const POLL_MS = 12_000;
const MAX_RECENT_RESULTS = 6;

export function pendingSdgnrsRedemptionsKey(chainId, address) {
  return `pending-sdgnrs-redemptions:${chainId}:${String(address || '').toLowerCase()}`;
}

export function revealedSdgnrsRedemptionsKey(chainId, address) {
  return `revealed-sdgnrs-redemptions:${chainId}:${String(address || '').toLowerCase()}`;
}

function _readJsonArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function _readPeriods(address) {
  return [...new Set(_readJsonArray(pendingSdgnrsRedemptionsKey(CHAIN.id, address))
    .map(Number)
    .filter((period) => Number.isInteger(period) && period >= 0 && period <= 0xFFFFFF))];
}

function _writePeriods(address, periods) {
  if (!address) return;
  const key = pendingSdgnrsRedemptionsKey(CHAIN.id, address);
  const values = [...new Set((Array.isArray(periods) ? periods : [])
    .map(Number)
    .filter((period) => Number.isInteger(period) && period >= 0 && period <= 0xFFFFFF))];
  try {
    if (values.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(values));
  } catch (_e) { /* private mode */ }
}

function _readSeen(address) {
  return new Set(_readJsonArray(revealedSdgnrsRedemptionsKey(CHAIN.id, address)).map(String));
}

function _markSeen(address, ...keys) {
  if (!address) return;
  try {
    const seen = _readSeen(address);
    for (const key of keys) if (key) seen.add(String(key));
    localStorage.setItem(
      revealedSdgnrsRedemptionsKey(CHAIN.id, address),
      JSON.stringify([...seen]),
    );
  } catch (_e) { /* private mode */ }
}

// Redemption lootboxes emit the same index-zero settlement legs as AFKing.
// Mark the transaction in the ordinary box controller's durable seen set so
// the claim receipt cannot be offered a second time as a generic lootbox.
function _markGenericBoxSeen(address, transactionHash) {
  if (!address || !transactionHash) return;
  try {
    const key = `revealed-lootboxes:${CHAIN.id}:${String(address).toLowerCase()}`;
    const seen = new Set(_readJsonArray(key).map(String));
    seen.add(`tx:${String(transactionHash).toLowerCase()}`);
    localStorage.setItem(key, JSON.stringify([...seen]));
  } catch (_e) { /* private mode */ }
}

function _reserveClaimResult(address, transactionHash) {
  if (!address || !transactionHash) return;
  const key = `tx:${String(transactionHash).toLowerCase()}`;
  _markGenericBoxSeen(address, transactionHash);
  try {
    document.dispatchEvent(new CustomEvent(LOOTBOX_REVEAL_COMPLETE_EVENT, {
      detail: { address: String(address).toLowerCase(), key },
    }));
  } catch (_e) { /* headless */ }
}

function _claimCards(claim) {
  if (!claim) return [];
  const legs = [];
  if (BigInt(claim.ethPayout ?? 0) > 0n) {
    legs.push({ legType: 'eth', amount: BigInt(claim.ethPayout), claimable: true });
  }
  if (BigInt(claim.flipPaid ?? 0) > 0n) {
    legs.push({ legType: 'flip', amount: BigInt(claim.flipPaid) });
  }
  return legs;
}

function _rowKey(row) {
  return row.type === 'claim'
    ? `tx:${String(row.transactionHash || '').toLowerCase()}`
    : `period:${Number(row.periodIndex)}`;
}

class AppSdgnrsRedemptions extends HTMLElement {
  #initialized = false;
  #address = null;
  #rows = [];
  #refreshing = false;
  #poll = null;
  #unsubscribe = null;
  #submissionListener = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.hidden = true;
    this.#submissionListener = (event) => this.#onSubmission(event?.detail);
    document.addEventListener(SDGNRS_REDEMPTION_SUBMITTED_EVENT, this.#submissionListener);
    this.#unsubscribe = subscribe('connected.address', (address) => {
      this.#address = address ? String(address).toLowerCase() : null;
      this.#rows = this.#address
        ? _readPeriods(this.#address).map((periodIndex) => ({
            type: 'period', periodIndex, state: 'waiting', ready: false,
          }))
        : [];
      this.#publish();
      if (this.#address) void this.#refresh();
    });
    this.#poll = setInterval(() => void this.#refresh(), POLL_MS);
    if (this.#poll && typeof this.#poll.unref === 'function') this.#poll.unref();
  }

  disconnectedCallback() {
    this.#initialized = false;
    this.#address = null;
    this.#rows = [];
    if (this.#poll != null) clearInterval(this.#poll);
    this.#poll = null;
    try { this.#unsubscribe?.(); } catch (_e) { /* defensive */ }
    this.#unsubscribe = null;
    if (this.#submissionListener) {
      try { document.removeEventListener(SDGNRS_REDEMPTION_SUBMITTED_EVENT, this.#submissionListener); }
      catch (_e) { /* defensive */ }
    }
    this.#submissionListener = null;
    clearPendingActions(PENDING_SOURCE);
  }

  #onSubmission(detail) {
    if (!this.#address) return;
    if (String(detail?.player || '').toLowerCase() !== this.#address) return;
    const periodIndex = Number(detail?.periodIndex);
    if (!Number.isInteger(periodIndex) || periodIndex < 0) return;
    const periods = new Set(_readPeriods(this.#address));
    periods.add(periodIndex);
    _writePeriods(this.#address, [...periods]);
    let submittedAmount = 0n;
    try { submittedAmount = BigInt(detail?.sdgnrsAmount ?? 0); }
    catch (_e) { /* keep the durable period even if an old event omitted amount */ }
    const existing = this.#rows.find((row) => (
      row.type === 'period' && row.periodIndex === periodIndex
    ));
    if (existing) {
      existing.sdgnrsAmount = BigInt(existing.sdgnrsAmount ?? 0) + submittedAmount;
    } else {
      this.#rows.push({
        type: 'period', periodIndex, state: 'waiting', ready: false,
        sdgnrsAmount: submittedAmount,
      });
    }
    this.#publish();
    void this.#refresh();
  }

  async #refresh() {
    if (this.#refreshing || !this.#address) return;
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    this.#refreshing = true;
    const owner = this.#address;
    try {
      const stored = _readPeriods(owner);
      const [discovered, ...storedStates] = await Promise.all([
        discoverSdgnrsRedemptions({ player: owner }),
        ...stored.map((periodIndex) => readSdgnrsRedemptionState({
          player: owner,
          periodIndex,
        })),
      ]);
      if (this.#address !== owner) return;
      const states = new Map();
      for (const state of [...(discovered?.periods || []), ...storedStates]) {
        if (!state?.exists) continue;
        const periodIndex = Number(state.periodIndex);
        const prior = states.get(periodIndex);
        states.set(periodIndex, {
          ...prior,
          ...state,
          sdgnrsAmount: state.sdgnrsAmount ?? prior?.sdgnrsAmount ?? null,
        });
      }
      const seen = _readSeen(owner);
      const periodRows = [...states.values()]
        .filter((state) => !seen.has(`period:${state.periodIndex}`))
        .map((state) => ({
          type: 'period',
          periodIndex: state.periodIndex,
          roll: state.roll,
          sdgnrsAmount: state.sdgnrsAmount ?? null,
          state: state.ready ? 'ready' : 'waiting',
          ready: state.ready,
        }));
      _writePeriods(owner, [...states.keys()]);

      const claimRows = (Array.isArray(discovered?.claims) ? discovered.claims : [])
        .filter((claim) => claim.transactionHash
          && !seen.has(`tx:${String(claim.transactionHash).toLowerCase()}`))
        .slice(0, MAX_RECENT_RESULTS)
        .map((claim) => ({ ...claim, type: 'claim', state: 'ready', ready: true }));
      for (const claim of claimRows) _reserveClaimResult(owner, claim.transactionHash);
      this.#rows = [...periodRows, ...claimRows];
      this.#publish();
    } catch (_e) {
      // Keep the last durable rows visible; the next poll retries.
    } finally {
      this.#refreshing = false;
    }
  }

  async #receipt(transactionHash) {
    const provider = getProvider();
    if (!provider || typeof provider.getTransactionReceipt !== 'function') return null;
    try { return await provider.getTransactionReceipt(transactionHash); }
    catch (_e) { return null; }
  }

  async #run(row) {
    if (!this.#address || row.state !== 'ready') return;
    const owner = this.#address;
    row.state = 'busy';
    this.#publish();
    try {
      let receipt;
      let claim = row.type === 'claim' ? row : null;
      if (row.type === 'period') {
        const exact = await readSdgnrsRedemptionState({
          player: owner,
          periodIndex: row.periodIndex,
        });
        if (!exact?.ready) throw new Error('This sDGNRS redemption is still waiting for RNG.');
        const result = await claimSdgnrsRedemption({
          player: owner,
          periodIndex: row.periodIndex,
        });
        receipt = result.receipt;
        claim = result.claim;
      } else {
        receipt = await this.#receipt(row.transactionHash);
        const parsed = parseSdgnrsRedemptionReceipt(receipt, owner);
        claim = parsed.claims.at(-1) || claim;
      }

      let boxLegs = parseOpenLegsFromReceipt(receipt, owner);
      boxLegs = await enrichLootboxBoonLegs(boxLegs, {
        player: owner,
        blockNumber: receipt?.blockNumber ?? null,
      });
      if (!receipt && BigInt(claim?.lootboxEth ?? 0) > 0n) {
        throw new Error('The sDGNRS box result is still syncing. Try again shortly.');
      }
      const legs = [..._claimCards(claim), ...boxLegs];
      if (legs.length === 0) {
        throw new Error('The sDGNRS result is still syncing. Try again shortly.');
      }
      const transactionHash = String(
        receipt?.hash || receipt?.transactionHash || claim?.transactionHash || row.transactionHash || '',
      ).toLowerCase();
      const accepted = queueReveal({
        kind: 'lootbox',
        title: 'sDGNRS REDEMPTION',
        lootboxIndex: 0,
        legs,
      });
      if (!accepted) throw new Error('The sDGNRS result could not be displayed.');

      const seenKeys = [_rowKey(row)];
      if (row.type === 'period') seenKeys.push(`period:${row.periodIndex}`);
      if (transactionHash) seenKeys.push(`tx:${transactionHash}`);
      _markSeen(owner, ...seenKeys);
      _reserveClaimResult(owner, transactionHash);
      const periods = _readPeriods(owner).filter((period) => period !== Number(row.periodIndex));
      _writePeriods(owner, periods);
      this.#rows = this.#rows.filter((candidate) => _rowKey(candidate) !== _rowKey(row));
      this.#publish();
      void this.#refresh();
    } catch (error) {
      row.state = 'ready';
      this.#publish();
      throw error;
    }
  }

  #publish() {
    if (!this.#address) {
      clearPendingActions(PENDING_SOURCE);
      return;
    }
    publishPendingActions(PENDING_SOURCE, this.#rows.map((row) => {
      const ready = row.state === 'ready';
      const compactAmount = row.sdgnrsAmount != null && BigInt(row.sdgnrsAmount) > 0n
        ? `${formatSdgnrsRedemptionAmount(row.sdgnrsAmount)} sDGNRS`
        : '';
      return {
        id: `sdgnrs-redemption:${_rowKey(row)}`,
        dismissScope: this.#address,
        kind: 'lootbox',
        kindLabel: 'sDGNRS REDEMPTION',
        label: `${compactAmount ? `${compactAmount} ` : ''}REDEMPTION`,
        amountLabel: compactAmount,
        lootboxLabel: 'REDEMPTION',
        compact: true,
        shortLabel: row.type === 'claim' ? 'View result' : 'Claim & open',
        detail: row.state === 'busy'
          ? row.type === 'claim' ? 'Loading result' : 'Claiming on-chain'
          : ready
            ? row.type === 'claim' ? 'Resolved · ready to view' : `RNG landed${row.roll ? ` · ${row.roll}%` : ''}`
            : 'Waiting for the daily RNG result',
        state: row.state,
        resolved: row.type === 'claim',
        autoOpen: row.type === 'claim' && ready,
        pinned: true,
        progress: row.state === 'waiting' ? 'indeterminate' : null,
        order: 18,
        chronology: Number(row.periodIndex ?? row.id ?? 0),
        run: () => this.#run(row),
      };
    }));
  }

  /** Test-only refresh hook. */
  async __refreshForTest() { await this.#refresh(); }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-sdgnrs-redemptions')) {
  customElements.define('app-sdgnrs-redemptions', AppSdgnrsRedemptions);
}
