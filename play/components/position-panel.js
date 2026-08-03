// play/components/position-panel.js -- compact "Net Position" widget.
//
// Shows three day/player-scoped numbers:
//   1. Total ETH spent (lootboxes only -- ticket-purchase ETH not indexed)
//   2. Total ETH won (totalCredited from /player; live cumulative)
//   3. Total tickets owned + estimated value at 0.04 ETH/ticket baseline
//
// Subscribes to replay.day + replay.player. Re-fetches /player on change.
// SHELL-01: imports only from beta/app/store.js (wallet-free).

import { subscribe, get } from '../../beta/app/store.js';
import { API_BASE } from '../app/constants.js';

const TEMPLATE = `
<section data-slot="position" class="panel position-panel">
  <h2 class="panel-title">Net Position</h2>
  <div class="position-grid" data-bind="content">
    <div class="position-row">
      <span class="position-label">Spent</span>
      <span class="position-value" data-bind="spent">--</span>
    </div>
    <div class="position-row">
      <span class="position-label">Won</span>
      <span class="position-value position-value-win" data-bind="won">--</span>
    </div>
    <div class="position-row">
      <span class="position-label">Tickets</span>
      <span class="position-value" data-bind="tickets">--</span>
    </div>
    <div class="position-row">
      <span class="position-label">FLIP</span>
      <span class="position-value" data-bind="flip">--</span>
    </div>
    <div class="position-row position-row-net">
      <span class="position-label">Net value</span>
      <span class="position-value position-value-net" data-bind="netValue">--</span>
    </div>
  </div>
</section>`;

// After the database/src/handlers/tickets.ts unit fix + backfill,
// player_entries.entryCount is the entry count (each entry = 1 trait roll).
// A "card" is 4 entries (the 4 trait quadrants on a jackpot ticket).
const ENTRIES_PER_CARD = 4;

// Ported verbatim from contracts/libraries/PriceLookupLib.sol::priceForLevel.
// Returns the per-ticket price in ETH (where "ticket" = 4 entries, the unit
// the contract calls a "whole_ticket" / "card" and the UI calls a "ticket").
function ticketPriceEthForLevel(level) {
  if (level < 5) return 0.01;
  if (level < 10) return 0.02;
  if (level < 30) return 0.04;
  if (level < 60) return 0.08;
  if (level < 90) return 0.12;
  if (level < 100) return 0.16;
  const offset = level % 100;
  if (offset === 0) return 0.24;
  if (offset < 30) return 0.04;
  if (offset < 60) return 0.08;
  if (offset < 90) return 0.12;
  return 0.16;
}

function formatEth(weiStr) {
  try {
    const wei = BigInt(weiStr ?? '0');
    const eth = Number(wei) / 1e18;
    return `${eth.toFixed(eth < 0.01 ? 4 : 2)} ETH`;
  } catch {
    return '0 ETH';
  }
}

// Resolve the level applicable to the currently-selected replay day.
// main.js populates `replay.level` per-day from /game/jackpot/day/{day}/winners
// (with an arithmetic fallback). Falls back to live /game/state only when the
// store hasn't been hydrated for the day yet.
async function resolveDayLevel() {
  const replayLevel = Number(get('replay.level'));
  if (Number.isFinite(replayLevel) && replayLevel > 0) return replayLevel;
  try {
    const res = await fetch(`${API_BASE}/game/state`);
    if (!res.ok) return null;
    const data = await res.json();
    const lvl = Number(data?.level);
    return Number.isFinite(lvl) && lvl > 0 ? lvl : null;
  } catch {
    return null;
  }
}

class PositionPanel extends HTMLElement {
  #unsubs = [];
  #fetchId = 0;

  connectedCallback() {
    this.innerHTML = TEMPLATE;
    this.#unsubs.push(
      subscribe('replay.day', () => this.#refetch()),
      subscribe('replay.player', () => this.#refetch()),
      subscribe('replay.level', () => this.#refetch()),
    );
    this.#refetch();
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }

  #bind(slot, value) {
    const el = this.querySelector(`[data-bind="${slot}"]`);
    if (el) el.textContent = String(value);
  }

  async #refetch() {
    const addr = get('replay.player');
    const day = get('replay.day');
    const token = ++this.#fetchId;
    if (!addr) return;

    const url = day != null
      ? `${API_BASE}/player/${addr}?day=${encodeURIComponent(day)}`
      : `${API_BASE}/player/${addr}`;
    let data = null;
    try {
      const res = await fetch(url);
      if (token !== this.#fetchId) return;
      if (!res.ok) {
        this.#renderEmpty();
        return;
      }
      data = await res.json();
      if (token !== this.#fetchId) return;
    } catch {
      this.#renderEmpty();
      return;
    }

    const spend = data?.spendSummary ?? {};
    const spentEth = (() => {
      try { return Number(BigInt(spend.lootboxEthSpent ?? '0')) / 1e18; }
      catch { return 0; }
    })();
    const wonEth = (() => {
      try { return Number(BigInt(data?.totalCredited ?? '0')) / 1e18; }
      catch { return 0; }
    })();
    this.#bind('spent', formatEth(spend.lootboxEthSpent));
    this.#bind('won', formatEth(data?.totalCredited ?? '0'));

    // Filter to current+future levels relative to the SELECTED day. Prior-level
    // tickets at that day are already resolved (jackpot drawn) and have no
    // remaining value as of the day in view.
    const dayLevel = await resolveDayLevel();
    if (token !== this.#fetchId) return;
    const ticketsList = Array.isArray(data?.tickets) ? data.tickets : [];
    const activeList = dayLevel != null
      ? ticketsList.filter((t) => Number(t.level) >= dayLevel)
      : ticketsList;

    // entryCount is entries; one card = 4 entries; one card costs priceForLevel
    // ETH at its level.
    let totalTickets = 0;
    let totalValueEth = 0;
    for (const t of activeList) {
      const level = Number(t.level);
      const cards = Number(t.entryCount ?? 0) / ENTRIES_PER_CARD;
      totalTickets += cards;
      totalValueEth += cards * ticketPriceEthForLevel(level);
    }
    this.#bind('tickets', `${Math.round(totalTickets).toLocaleString()} (${(totalTickets * 4).toLocaleString(undefined, {maximumFractionDigits: 0})} entries)`);

    // FLIP valuation: 1,000 FLIP buys 1 ticket at any level (per CLAUDE.md
    // FLIP economics). Value = (flip / 1000) * priceForLevel(currentLevel).
    let flipCount = 0;
    try {
      const wei = BigInt(data?.flipBalance ?? '0');
      flipCount = Number(wei) / 1e18;  // 1 FLIP = 1e18 wei
    } catch {
      flipCount = 0;
    }
    this.#bind('flip', Math.trunc(flipCount).toLocaleString());
    const ticketsBuyable = flipCount / 1000;
    const flipValueEth = dayLevel != null
      ? ticketsBuyable * ticketPriceEthForLevel(dayLevel)
      : 0;

    // Net value = winnings + ticket value + flip value - spent.
    const netEth = wonEth + totalValueEth + flipValueEth - spentEth;
    const sign = netEth >= 0 ? '+' : '-';
    const abs = Math.abs(netEth);
    const formatted = abs.toFixed(abs < 0.01 ? 4 : 2);
    const netEl = this.querySelector('[data-bind="netValue"]');
    if (netEl) {
      netEl.textContent = `${sign}${formatted} ETH`;
      netEl.classList.toggle('position-value-win', netEth >= 0);
      netEl.classList.toggle('position-value-loss', netEth < 0);
    }
  }

  #renderEmpty() {
    this.#bind('spent', '--');
    this.#bind('won', '--');
    this.#bind('tickets', '--');
    this.#bind('flip', '--');
    this.#bind('netValue', '--');
  }
}

customElements.define('position-panel', PositionPanel);
