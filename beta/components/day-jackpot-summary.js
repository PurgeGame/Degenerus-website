// components/day-jackpot-summary.js -- Day Jackpot Summary widget
//
// Plan 39-11 (REWRITTEN): Day-based role-aware summary rendering.
//
// Each day = one jackpot, drawn as two rolls:
//   Roll 1 (main, unsalted)  → 4 shared traits, produces ETH + tickets.
//                              One of those trait wins may be a "solo" bucket
//                              (single winner receiving the whale_pass, too).
//   Roll 2 (bonus, salted)   → 4 different traits, produces coin + far-future.
//
// Widget subscribes to `replay.day` (NOT replay.level — level conflates across
// jackpot boundaries post-level-100). It fetches
// /game/jackpot/day/{day}/summary and renders three role-grouped sections.

import { subscribe } from '../app/store.js';
import { API_BASE } from '../app/constants.js';
import { joBadgePath, joFormatWeiToEth, joScaledToTickets } from '../app/jackpot-rolls.js';

function shortAddr(addr) {
  if (!addr || typeof addr !== 'string') return '';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function badgeCellHTML(traitId) {
  if (traitId == null) return '';
  // Canonical [QQ][CCC][SSS]: bits[5:3]=color (heavy-tail), bits[2:0]=symbol (uniform).
  const q = Math.floor(traitId / 64);
  const s = traitId % 8;
  const c = Math.floor((traitId % 64) / 8);
  const src = joBadgePath(q, s, c);
  return `<span class="jp-summary-badge"><img src="${src}" alt="trait-${traitId}" width="22" height="22"/></span>`;
}

function ethRowHTML(row) {
  return `
    <div class="jp-summary-row">
      ${badgeCellHTML(row.traitId)}
      <span class="jp-summary-type">${row.winnerCount} winner${row.winnerCount === 1 ? '' : 's'} (${row.uniqueCount} unique)</span>
      <span class="jp-summary-amount">${joFormatWeiToEth(row.ethPerWinner)} ETH</span>
    </div>`;
}

function ticketRowHTML(row) {
  // v76: ticketsPerWinner is in ENTRIES (4 = 1 whole ticket); joScaledToTickets /4.
  const tkts = joScaledToTickets(row.ticketsPerWinner);
  return `
    <div class="jp-summary-row">
      ${badgeCellHTML(row.traitId)}
      <span class="jp-summary-type">${row.winnerCount} winner${row.winnerCount === 1 ? '' : 's'} (${row.uniqueCount} unique)</span>
      <span class="jp-summary-amount">${tkts} tkts ea</span>
    </div>`;
}

function coinRowHTML(row) {
  return `
    <div class="jp-summary-row">
      ${badgeCellHTML(row.traitId)}
      <span class="jp-summary-type">${row.winnerCount} winner${row.winnerCount === 1 ? '' : 's'} (${row.uniqueCount} unique)</span>
      <span class="jp-summary-amount">${joFormatWeiToEth(row.coinPerWinner)} FLIP</span>
    </div>`;
}

function soloRowHTML(solo) {
  const wpCount = Number(solo.whalePassCount || 0);
  const wpBadge = solo.hasWhalePass
    ? ` <span class="jp-whale-pass-badge">${wpCount > 0 ? wpCount + '× ' : ''}WHALE PASS${wpCount > 1 ? 'ES' : ''}</span>`
    : '';
  return `
    <div class="jp-summary-row jp-solo-bucket">
      ${badgeCellHTML(solo.traitId)}
      <span class="jp-summary-type"><strong>SOLO</strong> ${shortAddr(solo.winner)}${wpBadge}</span>
      <span class="jp-summary-amount">${joFormatWeiToEth(solo.ethAmount)} ETH</span>
    </div>`;
}

class DayJackpotSummary extends HTMLElement {
  #unsubs = [];
  #currentDay = null;

  connectedCallback() {
    this.innerHTML = `
      <section class="day-jackpot-summary jp-summary">
        <header data-bind="header">Day Jackpot Summary</header>
        <div class="day-jackpot-summary-body" data-bind="content">
          <div class="jp-summary-status" data-bind="status">Select a day to see jackpot details.</div>
        </div>
      </section>
    `;

    this.#unsubs.push(
      subscribe('replay.day', (day) => this.#refresh(day)),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }

  async #refresh(day) {
    const header = this.querySelector('[data-bind="header"]');
    const body = this.querySelector('[data-bind="content"]');
    if (!body) return;

    if (day == null) {
      this.#currentDay = null;
      if (header) header.textContent = 'Day Jackpot Summary';
      body.innerHTML = `<div class="jp-summary-status">Select a day to see jackpot details.</div>`;
      return;
    }

    this.#currentDay = day;
    if (header) header.textContent = `Day ${day} Jackpot Summary`;
    body.innerHTML = `<div class="jp-summary-status jo-loading">Loading day ${day}…</div>`;

    let data = null;
    try {
      const res = await fetch(`${API_BASE}/game/jackpot/day/${day}/summary`);
      if (res.status === 404) {
        body.innerHTML = `<div class="jp-summary-status jp-summary-empty">No jackpot data for day ${day}.</div>`;
        return;
      }
      if (!res.ok) {
        body.innerHTML = `<div class="jp-summary-status jp-summary-error">Error ${res.status} loading day ${day}.</div>`;
        return;
      }
      data = await res.json();
    } catch (err) {
      console.error('[day-jackpot-summary] fetch failed', err);
      body.innerHTML = `<div class="jp-summary-status jp-summary-error">Unable to load day ${day}.</div>`;
      return;
    }

    // Stale-guard — user may have scrubbed to a different day while fetching.
    if (this.#currentDay !== day) return;

    this.#render(body, data);
  }

  #render(body, data) {
    const r1 = data.rollOne || {};
    const r2 = data.rollTwo || {};
    const baf = data.baf || { triggered: false };
    const eth = Array.isArray(r1.eth) ? r1.eth : [];
    const tickets = Array.isArray(r1.tickets) ? r1.tickets : [];
    const coin = Array.isArray(r2.coin) ? r2.coin : [];
    const r2Tickets = Array.isArray(r2.tickets) ? r2.tickets : [];
    const ff = r2.farFuture || { resolved: false, winnerCount: 0, totalCoin: '0' };

    const soloHTML = r1.solo ? soloRowHTML(r1.solo) : '';
    const ethHTML = eth.length > 0
      ? eth.map(ethRowHTML).join('')
      : `<div class="jp-summary-note">No ETH distribution on this day.</div>`;
    const ticketsHTML = tickets.length > 0
      ? tickets.map(ticketRowHTML).join('')
      : `<div class="jp-summary-note">No ticket distribution on this day.</div>`;

    // Always render the 4 chosen bonus traits when bonusDraw is available,
    // even on no-winner days, so the chosen traits and target level are visible.
    const bonusDraw = Array.isArray(r2.bonusDraw) ? r2.bonusDraw : null;
    const coinHTML = bonusDraw
      ? bonusDraw.map((b) => {
          const winnersLine = b.winnerCount > 0
            ? `${b.winnerCount} winner${b.winnerCount === 1 ? '' : 's'} (${b.uniqueCount} unique)`
            : `<em>no winners</em>`;
          const amountLine = b.winnerCount > 0
            ? `${joFormatWeiToEth(b.coinPerWinner)} FLIP each`
            : `bucket: ${b.bucketTickets} tkt${b.bucketTickets === 1 ? '' : 's'} / ${b.bucketHolders} holder${b.bucketHolders === 1 ? '' : 's'}`;
          return `
            <div class="jp-summary-row${b.winnerCount === 0 ? ' jp-summary-empty-bucket' : ''}">
              ${badgeCellHTML(b.traitId)}
              <span class="jp-summary-type">${winnersLine}</span>
              <span class="jp-summary-amount">${amountLine}</span>
            </div>`;
        }).join('')
      : (coin.length > 0
          ? coin.map(coinRowHTML).join('')
          : `<div class="jp-summary-note">No bonus coin distribution on this day.</div>`);
    const r2TicketsHTML = r2Tickets.length > 0
      ? r2Tickets.map(ticketRowHTML).join('')
      : `<div class="jp-summary-note">No carryover ticket distribution on this day.</div>`;
    const ffHTML = ff.resolved
      ? `<div class="jp-summary-row jp-far-future">
           <span class="jp-summary-type">Far-Future resolved (${ff.winnerCount} winners)</span>
           <span class="jp-summary-amount">${joFormatWeiToEth(ff.totalCoin)} FLIP total</span>
         </div>`
      : `<div class="jp-summary-note">Far-Future: pending / unresolved.</div>`;

    // BAF section — fires every 10 levels, but only when the advance day's
    // daily coinflip wins. When the flip loses, markBafSkipped fires and the
    // pool stays in futurePool (no redistribution this bracket).
    const bafSkippedLevels = Array.isArray(baf.skippedLevels) ? baf.skippedLevels : [];
    const bafSkippedLabel = bafSkippedLevels.length > 0
      ? `(Level ${bafSkippedLevels.join(', ')})`
      : '';
    const bafSkippedRow = baf.skipped
      ? `<div class="jp-summary-row jp-baf-skipped">
           <span class="jp-summary-type"><strong>BAF skipped</strong> ${bafSkippedLabel} — daily flip lost</span>
           <span class="jp-summary-amount">pool stays in futurePool</span>
         </div>`
      : '';
    const bafSectionHTML = baf.triggered
      ? `
        <div class="jp-section jp-section-baf">
          <h4 class="jp-section-title">BAF — Big Ass Fortune ${baf.level != null ? `(Level ${baf.level})` : ''}</h4>
          ${bafSkippedRow}
          <div class="jp-subsection jp-subsection-baf-eth">
            <h5 class="jp-subsection-title">BAF ETH</h5>
            <div class="jp-summary-row jp-baf-row">
              <span class="jp-summary-type">${baf.eth.winnerCount} win${baf.eth.winnerCount === 1 ? '' : 's'} across ${baf.eth.uniqueCount} unique winner${baf.eth.uniqueCount === 1 ? '' : 's'}</span>
              <span class="jp-summary-amount">${joFormatWeiToEth(baf.eth.total)} ETH total</span>
            </div>
          </div>
          <div class="jp-subsection jp-subsection-baf-tickets">
            <h5 class="jp-subsection-title">BAF Lootbox Tickets</h5>
            <div class="jp-summary-row jp-baf-row">
              <span class="jp-summary-type">${baf.tickets.winnerCount} roll${baf.tickets.winnerCount === 1 ? '' : 's'} across ${baf.tickets.uniqueCount} unique winner${baf.tickets.uniqueCount === 1 ? '' : 's'}</span>
              <span class="jp-summary-amount">${joScaledToTickets(baf.tickets.total)} tkts total</span>
            </div>
          </div>
        </div>
      `
      : baf.skipped
      ? `
        <div class="jp-section jp-section-baf">
          <h4 class="jp-section-title">BAF — Big Ass Fortune ${bafSkippedLabel}</h4>
          <div class="jp-summary-row jp-baf-skipped">
            <span class="jp-summary-type"><strong>BAF skipped</strong> — daily coinflip for the advance day lost</span>
            <span class="jp-summary-amount">pool stays in futurePool</span>
          </div>
        </div>
      `
      : `
        <div class="jp-section jp-section-baf">
          <h4 class="jp-section-title">BAF — Big Ass Fortune</h4>
          <div class="jp-summary-note">No BAF this day (fires every 10 levels, attributed to each level's primary day).</div>
        </div>
      `;

    // Decimator section — resolution events (eligible-winner snapshots) +
    // regular claims + terminal (game-over) claim.  Resolutions show on the day
    // the decimator FIRED so winners are visible before they call claim.
    // Shown completely separate from jackpot draws so ETH amounts don't lump.
    // Always visible: when no decimator activity landed this day, render an empty-state row.
    const dec = data.decimator || { triggered: false };
    const decResolutions = Array.isArray(dec.resolutions) ? dec.resolutions : [];
    const decimatorSectionHTML = dec.triggered
      ? `
        <div class="jp-section jp-section-decimator">
          <h4 class="jp-section-title">Decimator</h4>
          ${decResolutions.length > 0 ? `
            <div class="jp-subsection jp-subsection-dec-resolved">
              <h5 class="jp-subsection-title">Resolved (Eligible Winners)</h5>
              ${decResolutions.map((r) => `
                <div class="jp-summary-row jp-decimator-row jp-decimator-resolved">
                  <span class="jp-summary-type">L${r.level}: ${r.eligibleWinners} eligible winner${r.eligibleWinners === 1 ? '' : 's'}${r.unclaimedEligible > 0 ? ` (${r.unclaimedEligible} unclaimed)` : ''}</span>
                  <span class="jp-summary-amount">${joFormatWeiToEth(r.poolEth)} ETH pool</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
          ${dec.regular && dec.regular.claimCount > 0 ? `
            <div class="jp-subsection jp-subsection-dec-regular">
              <h5 class="jp-subsection-title">Regular</h5>
              <div class="jp-summary-row jp-decimator-row jp-decimator-total">
                <span class="jp-summary-type">${dec.regular.claimCount} claim${dec.regular.claimCount === 1 ? '' : 's'} across ${dec.regular.uniquePlayers} unique player${dec.regular.uniquePlayers === 1 ? '' : 's'}</span>
                <span class="jp-summary-amount">${joFormatWeiToEth(dec.regular.ethTotal)} ETH${BigInt(dec.regular.lootboxEthTotal || '0') > 0n ? ` + ${joFormatWeiToEth(dec.regular.lootboxEthTotal)} ETH (lootbox)` : ''}</span>
              </div>
              ${Array.isArray(dec.regular.perRound) && dec.regular.perRound.length > 1 ? `
                <div class="jp-decimator-perround">
                  ${dec.regular.perRound.map((r) => `
                    <div class="jp-summary-row jp-decimator-row jp-decimator-round">
                      <span class="jp-summary-type">L${r.level}: ${r.claims} claim${r.claims === 1 ? '' : 's'}${r.uniquePlayers !== r.claims ? ` (${r.uniquePlayers} unique)` : ''}</span>
                      <span class="jp-summary-amount">${joFormatWeiToEth(r.ethTotal)} ETH${BigInt(r.lootboxEthTotal || '0') > 0n ? ` + ${joFormatWeiToEth(r.lootboxEthTotal)} ETH (lootbox)` : ''}</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          ` : ''}
          ${dec.terminal && dec.terminal.claimCount > 0 ? `
            <div class="jp-subsection jp-subsection-dec-terminal">
              <h5 class="jp-subsection-title">Terminal (Game-Over)</h5>
              <div class="jp-summary-row jp-decimator-row">
                <span class="jp-summary-type">${dec.terminal.claimCount} claim${dec.terminal.claimCount === 1 ? '' : 's'} across ${dec.terminal.uniquePlayers} unique player${dec.terminal.uniquePlayers === 1 ? '' : 's'}</span>
                <span class="jp-summary-amount">${joFormatWeiToEth(dec.terminal.ethTotal)} ETH</span>
              </div>
            </div>
          ` : ''}
        </div>
      `
      : `
        <div class="jp-section jp-section-decimator">
          <h4 class="jp-section-title">Decimator</h4>
          <div class="jp-summary-note">No decimator activity this day.</div>
        </div>
      `;

    body.innerHTML = `
      <div class="jp-section jp-section-rollone">
        <h4 class="jp-section-title">Roll 1 — Main Draw</h4>
        <div class="jp-subsection jp-subsection-eth">
          <h5 class="jp-subsection-title">ETH Wins</h5>
          ${soloHTML}
          ${ethHTML}
        </div>
        <div class="jp-subsection jp-subsection-tickets">
          <h5 class="jp-subsection-title">Ticket Wins</h5>
          ${ticketsHTML}
        </div>
      </div>

      <div class="jp-section jp-section-rolltwo">
        <h4 class="jp-section-title">Roll 2 — Bonus Draw${r2.bonusTargetLevel != null ? ` (target Level ${r2.bonusTargetLevel})` : ''}</h4>
        <div class="jp-subsection jp-subsection-coin">
          <h5 class="jp-subsection-title">Bonus Coin</h5>
          ${coinHTML}
        </div>
        <div class="jp-subsection jp-subsection-tickets">
          <h5 class="jp-subsection-title">Carryover Ticket Wins</h5>
          ${r2TicketsHTML}
        </div>
        <div class="jp-subsection jp-subsection-far-future">
          <h5 class="jp-subsection-title">Far-Future</h5>
          ${ffHTML}
        </div>
      </div>

      ${bafSectionHTML}

      ${decimatorSectionHTML}
    `;
  }
}

customElements.define('day-jackpot-summary', DayJackpotSummary);
