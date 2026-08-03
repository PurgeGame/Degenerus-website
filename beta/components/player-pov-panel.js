// components/player-pov-panel.js -- Player POV dashboard
// Pick a player from the ranked dropdown; see their last jackpot result, the
// most recent daily coinflip outcome, their next-day flip stake, FLIP
// balance, activity score, today's lootbox opens with reward details, and
// ticket holdings across all not-yet-complete levels.

import { fetchJSON } from '../app/api.js';
import { API_BASE } from '../app/constants.js';
import { formatEth, formatFlip, truncateAddress } from '../viewer/utils.js';
import {
  joBadgePath,
  joFormatWeiToEth,
  joScaledToTickets,
  JO_CATEGORIES,
  JO_SYMBOLS,
} from '../app/jackpot-rolls.js';

const STORAGE_KEY = 'pov_last_address';

function badgeImg(traitId) {
  if (traitId == null) return '';
  const t = traitId | 0;
  const q = Math.floor(t / 64);
  const sym = Math.floor((t % 64) / 8);
  const col = t % 8;
  const src = joBadgePath(q, sym, col);
  const alt = JO_SYMBOLS[JO_CATEGORIES[q]]?.[sym] ?? '';
  return `<img class="pov-badge-img" src="${src}" alt="${alt}" width="22" height="22"/>`;
}

// Render a lootbox-open reward into a short label.
// rewardType matches indexer enum in handlers/lootbox.ts.
function rewardLabel(r) {
  const t = r.type;
  const d = r.data || {};
  if (t === 'eth') return `${formatEth(String(d.amount ?? '0'))} ETH`;
  if (t === 'flip') return `${joFormatWeiToEth(String(d.amount ?? '0'))} FLIP`;
  if (t === 'tickets') {
    const n = joScaledToTickets(d.amount ?? d.count ?? 0);
    return `${n} ticket${n === 1 ? '' : 's'}`;
  }
  if (t === 'whalePass' || t === 'whale_pass') return 'Whale Pass';
  if (t === 'halfPass' || t === 'half_pass') return 'Half Pass';
  if (t === 'dgnrs') return `${joFormatWeiToEth(String(d.amount ?? '0'))} DGNRS`;
  if (t === 'sdgnrs') return `${joFormatWeiToEth(String(d.amount ?? '0'))} sDGNRS`;
  if (t === 'farFutureCoin') return `${joFormatWeiToEth(String(d.amount ?? '0'))} FLIP (far-future)`;
  // Fallback: print the type + raw amount.
  if (d.amount != null) return `${t}: ${d.amount}`;
  return t;
}

class PlayerPovPanel extends HTMLElement {
  #players = [];
  #currentDay = null;
  #currentLevel = null;
  #lastJackpotDay = null;
  #selected = '';

  connectedCallback() {
    this.innerHTML = `
      <div class="pov-panel">
        <header class="pov-header">
          <label for="pov-player-select">Player:</label>
          <select id="pov-player-select" class="pov-select" disabled>
            <option value="">Loading players...</option>
          </select>
          <span class="pov-meta" data-bind="meta"></span>
        </header>

        <div class="pov-body" data-bind="body">
          <div class="pov-empty">Pick a player to see their snapshot.</div>
        </div>
      </div>
    `;

    this.querySelector('#pov-player-select').addEventListener('change', (e) => {
      this.#selected = e.target.value;
      try { localStorage.setItem(STORAGE_KEY, this.#selected); } catch {}
      this.#renderForSelected();
    });

    this.#bootstrap();
  }

  async #bootstrap() {
    const meta = this.querySelector('[data-bind="meta"]');
    try {
      const [state, ranked] = await Promise.all([
        fetchJSON('/game/state'),
        fetchJSON('/replay/players-ranked'),
      ]);
      this.#currentLevel = state.level ?? null;
      this.#currentDay = state.dailyRng?.day ?? null;
      this.#players = ranked.players || [];

      // Last jackpot day — used for the "most recent jackpot" card. Falls back
      // to currentDay if the latest-day endpoint doesn't return a usable value.
      try {
        const lastDay = await fetchJSON('/game/jackpot/last-day');
        this.#lastJackpotDay = lastDay?.day ?? null;
      } catch {
        this.#lastJackpotDay = null;
      }

      if (meta) {
        meta.textContent = `Game day ${this.#currentDay ?? '?'} · Level ${this.#currentLevel ?? '?'}`;
      }

      const select = this.querySelector('#pov-player-select');
      const stored = (() => { try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; } })();
      const initial = this.#players.find(p => p.address.toLowerCase() === stored.toLowerCase())?.address
        ?? this.#players[0]?.address
        ?? '';
      select.innerHTML =
        '<option value="">— select a player —</option>' +
        this.#players
          .map(p => `<option value="${p.address}">${truncateAddress(p.address)} — ${p.totalEntries} entries</option>`)
          .join('');
      select.disabled = false;
      if (initial) {
        select.value = initial;
        this.#selected = initial;
        this.#renderForSelected();
      }
    } catch (err) {
      const body = this.querySelector('[data-bind="body"]');
      if (body) body.innerHTML = `<div class="pov-error">Failed to load: ${err.message}</div>`;
    }
  }

  async #renderForSelected() {
    const body = this.querySelector('[data-bind="body"]');
    if (!body) return;
    if (!this.#selected) {
      body.innerHTML = `<div class="pov-empty">Pick a player to see their snapshot.</div>`;
      return;
    }
    const addr = this.#selected;
    body.innerHTML = `<div class="pov-loading">Loading ${truncateAddress(addr)}…</div>`;

    const day = this.#currentDay;
    const lastJpDay = this.#lastJackpotDay ?? day;

    let player = null, jpWinners = null, flip = null, opens = null;
    try {
      const reqs = [
        fetchJSON(`/player/${addr}${day ? `?day=${day}` : ''}`),
        lastJpDay ? fetchJSON(`/game/jackpot/day/${lastJpDay}/winners`) : Promise.resolve(null),
        day ? fetchJSON(`/game/coinflip/day/${day}`) : Promise.resolve(null),
        day ? fetchJSON(`/game/lootbox/day/${day}/player/${addr}/opens`) : Promise.resolve(null),
      ];
      [player, jpWinners, flip, opens] = await Promise.all(reqs);
    } catch (err) {
      body.innerHTML = `<div class="pov-error">Failed to load player data: ${err.message}</div>`;
      return;
    }

    body.innerHTML = `
      ${this.#renderJackpotCard(addr, jpWinners, lastJpDay)}
      ${this.#renderFlipCard(flip, player, day)}
      ${this.#renderStatsCard(player)}
      ${this.#renderOpensCard(opens, day)}
      ${this.#renderTicketsCard(player)}
    `;
  }

  #renderJackpotCard(addr, jpWinners, day) {
    if (!jpWinners) {
      return `
        <section class="pov-card">
          <h3>Most Recent Jackpot</h3>
          <div class="pov-note">No jackpot data yet.</div>
        </section>`;
    }
    const lower = addr.toLowerCase();
    const w = (jpWinners.winners || []).find(x => (x.address || '').toLowerCase() === lower);
    const lvl = jpWinners.level ?? '?';

    if (!w) {
      return `
        <section class="pov-card">
          <h3>Most Recent Jackpot — Day ${day} · Level ${lvl}</h3>
          <div class="pov-note">No wins this day.</div>
        </section>`;
    }

    const rows = [];
    if (BigInt(w.totalEth || '0') > 0n) {
      rows.push(`<tr><td>ETH</td><td>${formatEth(w.totalEth)} ETH</td></tr>`);
    }
    if ((w.ticketCount || 0) > 0) {
      const n = joScaledToTickets(w.ticketCount);
      rows.push(`<tr><td>Tickets</td><td>${n} tkts</td></tr>`);
    }
    if (BigInt(w.coinTotal || '0') > 0n) {
      rows.push(`<tr><td>FLIP</td><td>${joFormatWeiToEth(w.coinTotal)} FLIP</td></tr>`);
    }
    if (w.bafPrize) {
      if (BigInt(w.bafPrize.eth || '0') > 0n) {
        rows.push(`<tr><td>BAF ETH</td><td>${formatEth(w.bafPrize.eth)} ETH</td></tr>`);
      }
      if ((w.bafPrize.tickets || 0) > 0) {
        const n = joScaledToTickets(w.bafPrize.tickets);
        rows.push(`<tr><td>BAF Tickets</td><td>${n} tkts</td></tr>`);
      }
    }
    if (w.decimatorPrize) {
      const reg = BigInt(w.decimatorPrize.regularEth || '0') + BigInt(w.decimatorPrize.lootboxEth || '0');
      const term = BigInt(w.decimatorPrize.terminalEth || '0');
      if (reg > 0n) rows.push(`<tr><td>Decimator</td><td>${formatEth(reg.toString())} ETH</td></tr>`);
      if (term > 0n) rows.push(`<tr><td>Decimator (terminal)</td><td>${formatEth(term.toString())} ETH</td></tr>`);
    }

    const breakdown = (w.breakdown || []).map(b => {
      const badge = badgeImg(b.traitId);
      const phase = b.phase === 'roll2' ? 'R2' : b.phase === 'other' ? 'Other' : 'R1';
      let amt;
      if (b.awardType === 'eth' || b.awardType === 'eth_baf') amt = `${joFormatWeiToEth(b.amount)} ETH`;
      else if (b.awardType === 'tickets' || b.awardType === 'tickets_baf') amt = `${joScaledToTickets(b.amount)} tkts`;
      else if (b.awardType.includes('flip') || b.awardType === 'farFutureCoin') amt = `${joFormatWeiToEth(b.amount)} FLIP`;
      else amt = `${b.amount} ${b.awardType}`;
      return `<li>${badge}<span class="pov-bd-phase">${phase}</span> ×${b.count} ${amt}</li>`;
    }).join('');

    return `
      <section class="pov-card">
        <h3>Most Recent Jackpot — Day ${day} · Level ${lvl}</h3>
        <table class="pov-kv">${rows.join('')}</table>
        ${breakdown ? `<details class="pov-breakdown"><summary>Breakdown (${w.breakdown.length})</summary><ul class="pov-bd-list">${breakdown}</ul></details>` : ''}
      </section>`;
  }

  #renderFlipCard(flip, player, day) {
    const last = flip && flip.win != null
      ? `<div class="pov-flip-result pov-flip-${flip.win ? 'win' : 'loss'}">
           ${flip.win ? 'WIN' : 'LOSS'} · ${flip.rewardPercent}% reward${BigInt(flip.bountyPaid || '0') > 0n ? ` · bounty ${formatEth(flip.bountyPaid)} ETH` : ''}
         </div>`
      : `<div class="pov-note">No flip recorded for day ${day}.</div>`;

    const cf = player?.coinflip;
    const stake = cf?.depositedAmount ?? '0';
    const stakeLabel = BigInt(stake) > 0n
      ? `<strong>${formatEth(stake)} ETH</strong> staked for next flip`
      : `<em>Nothing staked for next flip</em>`;
    const bounty = cf?.currentBounty && BigInt(cf.currentBounty) > 0n
      ? ` · bounty pool ${formatEth(cf.currentBounty)} ETH`
      : '';

    return `
      <section class="pov-card">
        <h3>Daily Flip</h3>
        ${last}
        <div class="pov-flip-stake">${stakeLabel}${bounty}</div>
      </section>`;
  }

  #renderStatsCard(player) {
    const flip = player?.flipBalance ?? '0';
    const score = player?.scoreBreakdown?.totalBps;
    const scoreLabel = (score == null) ? '—' : `${(Number(score) / 100).toFixed(2)}%`;
    const lbBuy = player?.dailyActivity?.lootboxesPurchased ?? 0;
    const lbOpen = player?.dailyActivity?.lootboxesOpened ?? 0;
    return `
      <section class="pov-card">
        <h3>Stats</h3>
        <table class="pov-kv">
          <tr><td>Activity score (today)</td><td>${scoreLabel}</td></tr>
          <tr><td>FLIP balance</td><td>${formatFlip(flip)}</td></tr>
          <tr><td>Lootboxes bought today</td><td>${lbBuy}</td></tr>
          <tr><td>Lootboxes opened today</td><td>${lbOpen}</td></tr>
        </table>
      </section>`;
  }

  #renderOpensCard(opens, day) {
    const list = opens?.opens ?? [];
    if (list.length === 0) {
      return `
        <section class="pov-card">
          <h3>Lootbox Opens — Day ${day}</h3>
          <div class="pov-note">No opens today.</div>
        </section>`;
    }
    const rows = list.map(o => {
      const traits = (o.traitIds || []).map(t => badgeImg(t)).join('');
      const rewardsHtml = (o.rewards || []).length === 0
        ? '<em>no extra rewards</em>'
        : o.rewards.map(r => `<span class="pov-reward-chip">${rewardLabel(r)}</span>`).join('');
      return `
        <li class="pov-open-row">
          <div class="pov-open-head">
            <span>L${o.targetLevel} · ${o.count} trait${o.count === 1 ? '' : 's'}</span>
            <a href="https://sepolia.etherscan.io/tx/${o.txHash}" target="_blank" rel="noopener">tx</a>
          </div>
          <div class="pov-open-traits">${traits}</div>
          <div class="pov-open-rewards">${rewardsHtml}</div>
        </li>`;
    }).join('');
    return `
      <section class="pov-card">
        <h3>Lootbox Opens — Day ${day} (${list.length})</h3>
        <ul class="pov-open-list">${rows}</ul>
      </section>`;
  }

  #renderTicketsCard(player) {
    const tickets = player?.tickets ?? [];
    const minLevel = this.#currentLevel ?? 0;
    const filtered = tickets
      .filter(t => (t.level ?? -1) >= minLevel && (t.entryCount ?? 0) > 0)
      .sort((a, b) => a.level - b.level);
    if (filtered.length === 0) {
      return `
        <section class="pov-card">
          <h3>Tickets — Active Levels (≥ L${minLevel})</h3>
          <div class="pov-note">No active tickets.</div>
        </section>`;
    }
    const rows = filtered.map(t => `<tr><td>L${t.level}</td><td>${t.entryCount} entries</td></tr>`).join('');
    return `
      <section class="pov-card">
        <h3>Tickets — Active Levels (≥ L${minLevel})</h3>
        <table class="pov-kv">${rows}</table>
      </section>`;
  }
}

customElements.define('player-pov-panel', PlayerPovPanel);
