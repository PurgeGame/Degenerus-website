// Full-width Big Ass Flip preview rail. It appears for the whole x9 level so
// the approaching x10 draw has a stable home even while the daily RNG/jackpot
// surfaces are changing state.

import { fetchJSON } from '../app/api.js';
import { fetchProfiles } from '../app/profiles.js';
import { gameDay, readGameState } from '../app/game-state.js';
import { readBafFinalPurchaseDay } from '../app/coinflip.js';
import { formatBafDrawPercent, normalizeBafDraw } from '../app/baf-draw.js';
import { displayEthCompact, displayToken } from '../app/scaling.js';
import { getActingAddress, getViewedAddress, subscribe, update } from '../app/store.js';

const POLL_MS = 15_000;
const FLIP = 10n ** 18n;
const LEADER_COUNT = 4;

export { formatBafDrawPercent, normalizeBafDraw };

/** Scatter slice geometry, straight off DegenerusJackpots.runBafJackpot. */
const SCATTER_ROUNDS = 50;
const SCATTER_SAMPLED = 4;
const SCATTER_PAID = 2;

/**
 * The BAF payout table (DegenerusJackpots.sol, runBafJackpot). Percentages of
 * the BAF pool, collapsed into the four lanes a player can actually act on:
 * the two score-gated ticket lanes, the ranked lane, and the final-day raffle.
 */
export const BAF_SLICES = [
  { key: 'scatter', percent: 70, label: 'SCATTER', gated: true },
  { key: 'far', percent: 10, label: 'FAR-FUTURE', gated: true },
  { key: 'rank', percent: 15, label: 'RANK', gated: false },
  { key: 'raffle', percent: 5, label: 'RAFFLE', gated: false },
];

/** Share of the pool that pays nothing at all to a zero-score wallet. */
export const BAF_GATED_PERCENT = BAF_SLICES
  .filter((slice) => slice.gated)
  .reduce((total, slice) => total + slice.percent, 0);

let _readGame = readGameState;
let _readFinalDay = readBafFinalPurchaseDay;
let _fetch = fetchJSON;
let _fetchProfiles = fetchProfiles;

function _bigint(value) {
  try { return BigInt(value ?? 0); } catch (_e) { return 0n; }
}

function _group(value) {
  const [whole, fraction] = String(value ?? '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction == null ? grouped : `${grouped}.${fraction}`;
}

function _shortAddress(value) {
  const address = String(value || '');
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address || '—';
}

/** The upcoming BAF level while the game is on the immediately preceding x9. */
export function bafEveTargetLevel(stateOrLevel) {
  if (stateOrLevel?.gameOver === true) return null;
  const raw = typeof stateOrLevel === 'object' ? stateOrLevel?.level : stateOrLevel;
  const level = Number(raw);
  if (!Number.isInteger(level) || level < 1) return null;
  const target = level + 1;
  return target % 10 === 0 ? target : null;
}

/** BAF takes 20% at level 50 and centuries, otherwise 10%. */
export function bafPoolPercent(targetLevel) {
  const level = Number(targetLevel);
  if (!Number.isInteger(level) || level <= 0 || level % 10 !== 0) return 0;
  return level === 50 || level % 100 === 0 ? 20 : 10;
}

export function bafPrizePoolWei(futurePoolWei, targetLevel) {
  const percent = bafPoolPercent(targetLevel);
  if (percent === 0 || futurePoolWei == null) return null;
  try { return (BigInt(futurePoolWei) * BigInt(percent)) / 100n; } catch (_e) { return null; }
}

/** Defensive normalization keeps stale/mixed-level API rows out of the rail. */
export function normalizeBafLeaders(payload, targetLevel, count = LEADER_COUNT) {
  const level = Number(targetLevel);
  const rows = Array.isArray(payload) ? payload : payload?.entries;
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  return rows
    .filter((row) => Number(row?.level) === level)
    .map((row) => ({
      level,
      player: String(row?.player || ''),
      score: _bigint(row?.score),
      rank: Number(row?.rank),
    }))
    .filter((row) => row.player && Number.isInteger(row.rank) && row.rank > 0 && row.rank <= count)
    .sort((a, b) => a.rank - b.rank)
    .filter((row) => {
      if (seen.has(row.rank)) return false;
      seen.add(row.rank);
      return true;
    })
    .slice(0, count);
}

/** Coinflip deposits made now settle on the next numbered daily flip. */
export function bafFinalFlipTargetDay(gameState) {
  const settledDay = gameDay(gameState);
  return settledDay == null ? null : settledDay + 1;
}

/** Backward-compatible rank-one readout: this is the biggest weight, not the winner. */
export function normalizeBafFinalFlipLeader(payload, targetDay) {
  const day = Number(targetDay);
  const rows = Array.isArray(payload) ? payload : payload?.entries;
  if (!Number.isInteger(day) || !Array.isArray(rows)) return null;
  const row = rows.find((entry) => Number(entry?.day) === day && Number(entry?.rank) === 1);
  if (!row?.player) return null;
  return { day, player: String(row.player), score: _bigint(row.score), rank: 1 };
}

export function formatWholeFlipCompact(raw) {
  return formatBafScoreCompact(_bigint(raw) * FLIP);
}

export function formatBafScoreCompact(raw) {
  const whole = _bigint(raw) / FLIP;
  const units = [
    [1_000_000_000_000n, 'T'],
    [1_000_000_000n, 'B'],
    [1_000_000n, 'M'],
    [1_000n, 'K'],
  ];
  for (const [unit, suffix] of units) {
    if (whole < unit) continue;
    const tenths = (whole * 10n) / unit;
    const major = tenths / 10n;
    const minor = tenths % 10n;
    return `${major}${minor === 0n ? '' : `.${minor}`}${suffix}`;
  }
  return whole.toLocaleString('en-US');
}

/**
 * The scatter slice, drawn: one cell per round, four sampled tickets, the top
 * two by BAF score paid. Entirely static — nothing on this rail moves.
 */
export function bafScatterFieldMarkup(rounds = SCATTER_ROUNDS) {
  const pitch = 20;
  const cells = Array.from({ length: rounds }, (_, index) =>
    `<use href="#baf-round" x="${index * pitch}" y="0" style="--i:${index}"/>`).join('');
  // Four tickets per round, drawn left to right in score order: the two paid
  // slots lead, the two that miss trail. Sorted, top two — the rule, not decor.
  // The viewBox aspect is the band's aspect, so the strip spans the full rail
  // width without squashing the tickets into ellipses.
  return `<footer class="baf-eve__band" aria-label="How the scatter slice pays">
      <span class="baf-eve__band-label">
        <b>SCATTER</b><small>${SCATTER_ROUNDS} ROUNDS · ${SCATTER_SAMPLED} TICKETS EACH · TOP ${SCATTER_PAID} BY SCORE</small>
      </span>
      <svg class="baf-eve__scatter" viewBox="0 0 ${rounds * pitch} 12"
           aria-hidden="true" focusable="false">
        <defs><g id="baf-round">
          <circle class="baf-eve__ticket is-paid" cx="3" cy="6" r="1.9"/>
          <circle class="baf-eve__ticket is-paid" cx="7.5" cy="6" r="1.9"/>
          <circle class="baf-eve__ticket" cx="12" cy="6" r="1.9"/>
          <circle class="baf-eve__ticket" cx="16.5" cy="6" r="1.9"/>
        </g></defs>${cells}
      </svg>
    </footer>`;
}

/** The split bar: where the pool actually goes, at the width it actually goes. */
export function bafSplitMarkup() {
  const bar = BAF_SLICES.map((slice) =>
    `<i data-slice="${slice.key}" style="--w:${slice.percent}"></i>`).join('');
  const key = BAF_SLICES.map((slice) =>
    `<b data-slice="${slice.key}"><u></u>${slice.percent} ${slice.label}</b>`).join('');
  const readout = BAF_SLICES.map((slice) => `${slice.percent}% ${slice.label}`).join(', ');
  return `<div class="baf-eve__split">
      <span class="baf-eve__split-bar" role="img"
            aria-label="Pool split: ${readout}">${bar}</span>
      <span class="baf-eve__split-key" aria-hidden="true">${key}</span>
    </div>`;
}

/**
 * The player's own numbers. Far-future and scatter — 80% of the pool — skip any
 * candidate whose BAF score is zero and refund the share, so the score is not
 * just a ranking input: at zero it is a hard exclusion from most of the money.
 * Score only accrues when a winning flip is CLAIMED (Coinflip.sol claim walk),
 * so the zero-state names the action rather than the state.
 */
export function bafGateModel({ score, rank, total } = {}) {
  const armed = _bigint(score) > 0n;
  const ranked = Number.isInteger(Number(rank)) && Number(rank) > 0;
  const field = Number(total);
  return {
    armed,
    score: _formatScore(score),
    rank: ranked ? `#${Number(rank)}` : '—',
    // Reads as "#12 of 247" when ranked, and states the stake when not.
    context: ranked && Number.isInteger(field) && field > 0
      ? `OF ${field.toLocaleString('en-US')}`
      : (armed ? 'UNRANKED' : `LOCKED OUT OF ${BAF_GATED_PERCENT}%`),
    note: armed ? 'BAF SCORE' : 'CLAIM A WON FLIP TO SCORE',
  };
}

function _formatScore(raw) {
  try { return _group(displayToken(_bigint(raw), 0)); } catch (_e) { return '—'; }
}

function _formatPrize(raw) {
  if (raw == null) return '—';
  try { return _group(displayEthCompact(BigInt(raw), 3)); } catch (_e) { return '—'; }
}

class AppBafEve extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #timer = null;
  #seq = 0;
  #targetLevel = null;
  #gameState = null;
  #leaders = [];
  #finalPurchaseDay = false;
  #finalFlipDay = null;
  #finalFlipLeader = null;
  #finalFlipDraw = null;
  #player = null;
  #viewedAddress = null;
  #profiles = new Map();

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    for (const key of ['connected.address', 'viewing.address']) {
      this.#unsubs.push(subscribe(key, () => { void this.#refresh(); }));
    }
    this.#unsubs.push(subscribe('app.bafPosition', (position) => {
      const address = String(this.#viewedAddress || '').toLowerCase();
      if (!position || String(position.address || '').toLowerCase() !== address) return;
      if (Number(position.level) !== Number(this.#targetLevel)) return;
      this.#player = position;
      this.#render();
    }));
    this.#timer = setInterval(() => { void this.#refresh(); }, POLL_MS);
    try { this.#timer?.unref?.(); } catch (_e) { /* browser timer */ }
    void this.#refresh();
  }

  disconnectedCallback() {
    for (const unsubscribe of this.#unsubs) {
      try { unsubscribe(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (this.#timer != null) clearInterval(this.#timer);
    this.#timer = null;
    this.#seq += 1;
    this.#initialized = false;
  }

  #renderShell() {
    this.hidden = true;
    this.innerHTML = `
      <section class="baf-eve" data-bind="baf-eve-shell" hidden aria-labelledby="baf-eve-title">
        <header class="baf-eve__identity">
          <span class="baf-eve__mark" aria-hidden="true">
            <img src="/app/assets/baf-mark.svg" width="64" height="64" alt="">
          </span>
          <span class="baf-eve__identity-copy">
            <small>LEVEL <b data-bind="baf-eve-level">—</b> · NEXT</small>
            <h2 id="baf-eve-title">BIG ASS FLIP</h2>
            <span class="baf-eve__countdown"><i></i>ONE LEVEL OUT</span>
          </span>
        </header>

        <article class="baf-eve__pool" aria-label="BAF prize pool">
          <header>
            <span class="baf-eve__pool-icon"><img src="/badges-circular/crypto_06_ethereum_green.svg" alt=""></span>
            <small>BAF PRIZE POOL</small>
            <span class="baf-eve__pool-status">PROJECTED</span>
          </header>
          <strong><b data-bind="baf-eve-prize">—</b><em>ETH</em></strong>
          ${bafSplitMarkup()}
          <footer><span data-bind="baf-eve-percent">—</span><i>AT THE DRAW</i></footer>
        </article>

        <article class="baf-eve__mine" data-bind="baf-eve-gate" aria-label="Your BAF position">
          <small>YOUR SCORE</small>
          <strong class="baf-eve__gate-score" data-bind="baf-eve-score">—</strong>
          <span class="baf-eve__gate-rank">
            <b data-bind="baf-eve-rank">—</b><i data-bind="baf-eve-gate-context">—</i>
          </span>
          <span class="baf-eve__gate-note" data-bind="baf-eve-gate-note">BAF SCORE</span>
        </article>

        <section class="baf-eve__board" aria-label="Big Ass Flip top four and final-day flip leader">
          <header>
            <strong data-bind="baf-eve-board-title">TOP 4</strong>
            <span data-bind="baf-eve-field">— PLAYERS</span>
          </header>
          <ol class="baf-eve__leaders" data-bind="baf-eve-leaders"></ol>
          <p class="baf-eve__board-note">15% OF THE POOL</p>
          <div class="baf-eve__draw-slot" data-bind="baf-eve-draw-slot"></div>
        </section>

        ${bafScatterFieldMarkup()}
      </section>
    `;
  }

  async #refresh() {
    const seq = ++this.#seq;
    let gameState = null;
    let finalDayState = null;
    const [gameResult, finalResult] = await Promise.allSettled([_readGame(), _readFinalDay()]);
    if (gameResult.status === 'fulfilled') gameState = gameResult.value;
    if (finalResult.status === 'fulfilled') finalDayState = finalResult.value;
    if (seq !== this.#seq) return;

    const target = bafEveTargetLevel(gameState);
    const targetChanged = target !== this.#targetLevel;
    const finalPurchaseDay = target != null && Number(finalDayState?.targetLevel) === target;
    const finalFlipDay = finalPurchaseDay ? bafFinalFlipTargetDay(gameState) : null;
    const finalChanged = finalPurchaseDay !== this.#finalPurchaseDay
      || finalFlipDay !== this.#finalFlipDay;
    this.#gameState = gameState;
    this.#targetLevel = target;
    this.#finalPurchaseDay = finalPurchaseDay;
    this.#finalFlipDay = finalFlipDay;
    this.#viewedAddress = getViewedAddress?.() || getActingAddress?.() || null;
    if (targetChanged || finalChanged) {
      this.#leaders = [];
      this.#player = null;
      this.#finalFlipLeader = null;
      this.#finalFlipDraw = null;
    }
    this.#render();
    if (target == null) return;

    const leaderboardPath = `/leaderboards/baf?level=${encodeURIComponent(target)}`;
    const playerPath = this.#viewedAddress
      ? `/player/${encodeURIComponent(this.#viewedAddress)}/baf?level=${encodeURIComponent(target)}`
      : null;
    const finalFlipPath = finalFlipDay == null
      ? null
      : `/leaderboards/coinflip?day=${encodeURIComponent(finalFlipDay)}${this.#viewedAddress
        ? `&player=${encodeURIComponent(this.#viewedAddress)}`
        : ''}`;
    const [leadersResult, playerResult, finalFlipResult] = await Promise.allSettled([
      _fetch(leaderboardPath),
      playerPath ? _fetch(playerPath) : Promise.resolve(null),
      finalFlipPath ? _fetch(finalFlipPath) : Promise.resolve(null),
    ]);
    if (seq !== this.#seq || target !== this.#targetLevel) return;
    if (leadersResult.status === 'fulfilled') {
      this.#leaders = normalizeBafLeaders(leadersResult.value, target);
    }
    if (playerResult.status === 'fulfilled') {
      this.#player = playerResult.value;
      if (this.#player && this.#viewedAddress) {
        // The Daily Flip score lane and this full-width rail are two views of
        // one position. Publish the freshly polled row so they cannot retain
        // different ranks for the same player/bracket.
        update('app.bafPosition', {
          ...this.#player,
          address: String(this.#viewedAddress).toLowerCase(),
          level: target,
        });
      }
    }
    if (finalFlipResult.status === 'fulfilled') {
      this.#finalFlipDraw = normalizeBafDraw(
        finalFlipResult.value,
        finalFlipDay,
        this.#viewedAddress,
      );
      const leader = this.#finalFlipDraw.entries[0] || null;
      this.#finalFlipLeader = leader ? { ...leader, score: _bigint(leader.score) } : null;
    }
    this.#render();
    void this.#loadProfiles(
      [...this.#leaders.map((row) => row.player), this.#finalFlipLeader?.player],
      seq,
    );
  }

  /**
   * A linked player shows their Discord avatar; everyone else gets a stable
   * initial so the column never collapses into a ragged mix of sizes.
   */
  #avatarNode(row, profile) {
    if (profile?.avatar) {
      const image = document.createElement('img');
      image.className = 'baf-eve__avatar';
      image.src = profile.avatar;
      image.alt = '';
      image.loading = 'lazy';
      return image;
    }
    const fallback = document.createElement('span');
    fallback.className = 'baf-eve__avatar is-fallback';
    fallback.setAttribute('aria-hidden', 'true');
    fallback.textContent = profile?.name
      ? profile.name.slice(0, 1).toUpperCase()
      : (row ? row.player.slice(2, 3).toUpperCase() : '·');
    return fallback;
  }

  /**
   * Identity is decoration over the numbers: it is fetched after the board has
   * already rendered, and a failure simply leaves the shortened addresses.
   */
  async #loadProfiles(addresses, seq) {
    const wanted = addresses.filter(Boolean).map((address) => address.toLowerCase());
    if (wanted.length === 0) return;
    if (wanted.every((address) => this.#profiles.has(address))) return;
    const profiles = await _fetchProfiles(wanted);
    if (seq !== this.#seq || profiles.size === 0) return;
    for (const [address, profile] of profiles) this.#profiles.set(address, profile);
    this.#render();
  }

  #render() {
    const shell = this.querySelector('[data-bind="baf-eve-shell"]');
    const visible = this.#targetLevel != null;
    this.hidden = !visible;
    if (shell) shell.hidden = !visible;
    if (!visible || !shell) return;

    shell.dataset.level = String(this.#targetLevel);
    shell.classList?.toggle('is-final-day', this.#finalPurchaseDay);
    const prize = bafPrizePoolWei(
      this.#gameState?.prizePools?.futurePrizePool,
      this.#targetLevel,
    );
    const rank = Number(this.#player?.rank);
    const rankKnown = Number.isInteger(rank) && rank > 0;
    const score = _bigint(this.#player?.score);
    const totalPlayers = Number(this.#player?.totalParticipants);
    const gate = bafGateModel({ score, rank: rankKnown ? rank : null, total: totalPlayers });
    shell.classList?.toggle('is-armed', gate.armed);
    const values = [
      ['baf-eve-level', String(this.#targetLevel)],
      ['baf-eve-prize', _formatPrize(prize)],
      ['baf-eve-percent', `${bafPoolPercent(this.#targetLevel)}% OF FUTURE POOL`],
      ['baf-eve-score', gate.score],
      ['baf-eve-rank', gate.rank],
      ['baf-eve-gate-context', gate.context],
      ['baf-eve-gate-note', gate.note],
      ['baf-eve-field', `${Number.isInteger(totalPlayers) && totalPlayers >= 0 ? totalPlayers.toLocaleString('en-US') : '—'} PLAYERS`],
      // The final-day draw now carries its own labelled row under the board,
      // so the ranked strip is only ever the top four.
      ['baf-eve-board-title', 'TOP 4'],
    ];
    for (const [bind, value] of values) {
      const node = this.querySelector(`[data-bind="${bind}"]`);
      if (node) node.textContent = value;
    }

    const list = this.querySelector('[data-bind="baf-eve-leaders"]');
    if (!list) return;
    list.textContent = '';
    const byRank = new Map(this.#leaders.map((row) => [row.rank, row]));
    const mine = String(this.#viewedAddress || '').toLowerCase();
    for (let place = 1; place <= LEADER_COUNT; place += 1) {
      const row = byRank.get(place) || null;
      const item = document.createElement('li');
      item.dataset.rank = String(place);
      if (!row) item.classList.add('is-empty');
      if (row && mine && row.player.toLowerCase() === mine) item.classList.add('is-you');

      const placeNode = document.createElement('span');
      placeNode.className = 'baf-eve__place';
      placeNode.textContent = String(place);

      const profile = row ? this.#profiles.get(row.player.toLowerCase()) : null;
      const displayName = profile?.name ? `@${profile.name}` : (row ? _shortAddress(row.player) : '—');
      item.appendChild(placeNode);
      item.appendChild(this.#avatarNode(row, profile));

      const copy = document.createElement('span');
      copy.className = 'baf-eve__leader-copy';
      const name = document.createElement('small');
      name.textContent = displayName;
      copy.appendChild(name);

      const leaderScore = document.createElement('strong');
      leaderScore.textContent = row ? formatBafScoreCompact(row.score) : '—';
      if (row) {
        const who = profile?.name ? `@${profile.name} (${row.player})` : row.player;
        item.title = `${who} · ${_formatScore(row.score)} FLIP score`;
        item.setAttribute('aria-label', `Rank ${place}, ${who}, ${_formatScore(row.score)} score`);
      }
      item.appendChild(copy);
      item.appendChild(leaderScore);
      list.appendChild(item);
    }

    // The final-day 5% is an amount-weighted draw, not a fifth ranked place, so
    // it gets its own row under the board instead of a card in the ranked strip.
    const drawSlot = this.querySelector('[data-bind="baf-eve-draw-slot"]');
    if (drawSlot) drawSlot.textContent = '';
    if (this.#finalPurchaseDay && drawSlot) {
      const draw = this.#finalFlipDraw;
      const leader = this.#finalFlipLeader;
      const playerWeight = _bigint(draw?.player?.score);
      const playerPercent = formatBafDrawPercent(playerWeight, draw?.totalWeight);
      const daily = document.createElement('div');
      daily.className = 'baf-eve__daily-flip';
      daily.setAttribute('data-bind', 'baf-eve-final-flip');
      if (!leader) daily.classList.add('is-empty');
      const slice = document.createElement('span');
      slice.className = 'baf-eve__place';
      slice.textContent = '5%';
      const copy = document.createElement('span');
      copy.className = 'baf-eve__daily-copy';
      // The 5% slice is an amount-weighted draw over the armed day's deposits
      // (Coinflip.bafDrawWinner), not a prize for the biggest staker. Label it a
      // DRAW so the ranked row beside it cannot read as "this wallet wins 5%".
      const label = document.createElement('small');
      label.textContent = 'FINAL-DAY DRAW';
      const drawProfile = leader ? this.#profiles.get(leader.player.toLowerCase()) : null;
      const address = document.createElement('strong');
      address.textContent = leader
        ? (drawProfile?.name ? `@${drawProfile.name}` : _shortAddress(leader.player))
        : 'NO BETS YET';
      const amount = document.createElement('span');
      amount.textContent = leader ? `${formatWholeFlipCompact(leader.score)} FLIP` : '5% BAF SLICE';
      copy.appendChild(label);
      copy.appendChild(address);
      copy.appendChild(amount);

      const mine = document.createElement('span');
      mine.className = 'baf-eve__daily-mine';
      const mineLabel = document.createElement('small');
      mineLabel.textContent = 'YOUR DRAW WEIGHT';
      const mineAmount = document.createElement('strong');
      mineAmount.textContent = draw?.player
        ? `${formatWholeFlipCompact(playerWeight)} FLIP`
        : '— FLIP';
      const minePercent = document.createElement('b');
      minePercent.textContent = playerPercent;
      mine.appendChild(mineLabel);
      mine.appendChild(mineAmount);
      mine.appendChild(minePercent);
      daily.appendChild(slice);
      daily.appendChild(copy);
      daily.appendChild(mine);
      drawSlot.appendChild(daily);
      const totalLabel = draw?.totalWeight == null
        ? 'total weight syncing'
        : `${_group(draw.totalWeight)} FLIP total weight`;
      daily.title = leader
        ? `${leader.player} · ${_group(leader.score)} FLIP top weight · ${totalLabel}`
        : totalLabel;
      daily.setAttribute(
        'aria-label',
        `Final-day weighted draw for five percent of the BAF pool. Your weight ${draw?.player ? _group(playerWeight) : 'unknown'} FLIP, ${playerPercent} of ${totalLabel}.`,
      );
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-baf-eve')) {
  customElements.define('app-baf-eve', AppBafEve);
}

export function __setBafEveWidgetDepsForTest({ game, finalDay, fetcher, profiles } = {}) {
  if (typeof game === 'function') _readGame = game;
  if (typeof finalDay === 'function') _readFinalDay = finalDay;
  if (typeof fetcher === 'function') _fetch = fetcher;
  if (typeof profiles === 'function') _fetchProfiles = profiles;
}

export function __resetBafEveWidgetDepsForTest() {
  _readGame = readGameState;
  _readFinalDay = readBafFinalPurchaseDay;
  _fetch = fetchJSON;
  _fetchProfiles = fetchProfiles;
}
