// Full-width Big Ass Flip preview rail. It appears for the whole x9 level so
// the approaching x10 draw has a stable home even while the daily RNG/jackpot
// surfaces are changing state.

import { fetchJSON } from '../app/api.js';
import { gameDay, readGameState } from '../app/game-state.js';
import { readBafFinalPurchaseDay } from '../app/coinflip.js';
import { displayEthCompact, displayToken } from '../app/scaling.js';
import { getActingAddress, getViewedAddress, subscribe, update } from '../app/store.js';

const POLL_MS = 15_000;
const FLIP = 10n ** 18n;
const LEADER_COUNT = 4;

let _readGame = readGameState;
let _readFinalDay = readBafFinalPurchaseDay;
let _fetch = fetchJSON;

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

/** The rank-one current-day stake that receives the BAF pool's 5% slice. */
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
  #player = null;
  #viewedAddress = null;

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
          <span class="baf-eve__mark" aria-hidden="true"><b>BAF</b><small>×10</small></span>
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
          <footer><span data-bind="baf-eve-percent">—</span><i>AT THE DRAW</i></footer>
        </article>

        <article class="baf-eve__mine" aria-label="Your BAF position">
          <small>YOUR POSITION</small>
          <strong data-bind="baf-eve-rank">RANK —</strong>
          <span><b data-bind="baf-eve-score">—</b> SCORE</span>
        </article>

        <section class="baf-eve__board" aria-label="Big Ass Flip top four and final-day flip leader">
          <header>
            <strong data-bind="baf-eve-board-title">TOP 4</strong>
            <span data-bind="baf-eve-field">— PLAYERS</span>
          </header>
          <ol class="baf-eve__leaders" data-bind="baf-eve-leaders"></ol>
        </section>
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
    }
    this.#render();
    if (target == null) return;

    const leaderboardPath = `/leaderboards/baf?level=${encodeURIComponent(target)}`;
    const playerPath = this.#viewedAddress
      ? `/player/${encodeURIComponent(this.#viewedAddress)}/baf?level=${encodeURIComponent(target)}`
      : null;
    const finalFlipPath = finalFlipDay == null
      ? null
      : `/leaderboards/coinflip?day=${encodeURIComponent(finalFlipDay)}`;
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
      this.#finalFlipLeader = normalizeBafFinalFlipLeader(finalFlipResult.value, finalFlipDay);
    }
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
    const values = [
      ['baf-eve-level', String(this.#targetLevel)],
      ['baf-eve-prize', _formatPrize(prize)],
      ['baf-eve-percent', `${bafPoolPercent(this.#targetLevel)}% OF FUTURE POOL`],
      ['baf-eve-rank', rankKnown ? `RANK #${rank}` : 'UNRANKED'],
      ['baf-eve-score', _formatScore(score)],
      ['baf-eve-field', `${Number.isInteger(totalPlayers) && totalPlayers >= 0 ? totalPlayers.toLocaleString('en-US') : '—'} PLAYERS`],
      ['baf-eve-board-title', this.#finalPurchaseDay ? 'TOP 4 + FINAL FLIP' : 'TOP 4'],
    ];
    for (const [bind, value] of values) {
      const node = this.querySelector(`[data-bind="${bind}"]`);
      if (node) node.textContent = value;
    }

    const list = this.querySelector('[data-bind="baf-eve-leaders"]');
    if (!list) return;
    list.textContent = '';
    list.classList?.toggle('has-final-flip', this.#finalPurchaseDay);
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
      const copy = document.createElement('span');
      copy.className = 'baf-eve__leader-copy';
      const address = document.createElement('small');
      address.textContent = row ? _shortAddress(row.player) : '—';
      const leaderScore = document.createElement('strong');
      leaderScore.textContent = row ? formatBafScoreCompact(row.score) : '—';
      if (row) {
        item.title = `${row.player} · ${_formatScore(row.score)} FLIP score`;
        item.setAttribute('aria-label', `Rank ${place}, ${row.player}, ${_formatScore(row.score)} score`);
      }
      copy.appendChild(address);
      copy.appendChild(leaderScore);
      item.appendChild(placeNode);
      item.appendChild(copy);
      list.appendChild(item);
    }

    if (this.#finalPurchaseDay) {
      const leader = this.#finalFlipLeader;
      const daily = document.createElement('li');
      daily.className = 'baf-eve__daily-flip';
      daily.setAttribute('data-bind', 'baf-eve-final-flip');
      if (!leader) daily.classList.add('is-empty');
      const slice = document.createElement('span');
      slice.className = 'baf-eve__place';
      slice.textContent = '5%';
      const copy = document.createElement('span');
      copy.className = 'baf-eve__daily-copy';
      const label = document.createElement('small');
      label.textContent = 'FINAL-DAY FLIP';
      const address = document.createElement('strong');
      address.textContent = leader ? _shortAddress(leader.player) : 'NO BETS YET';
      const amount = document.createElement('span');
      amount.textContent = leader ? `${formatWholeFlipCompact(leader.score)} FLIP` : '5% BAF SLICE';
      copy.appendChild(label);
      copy.appendChild(address);
      copy.appendChild(amount);
      daily.appendChild(slice);
      daily.appendChild(copy);
      if (leader) {
        daily.title = `${leader.player} · ${_group(leader.score)} FLIP staked · 5% of the BAF pool if the gate fires`;
        daily.setAttribute('aria-label', `Final-day flip leader ${leader.player}, ${_group(leader.score)} FLIP staked, eligible for five percent of the BAF pool`);
      }
      list.appendChild(daily);
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-baf-eve')) {
  customElements.define('app-baf-eve', AppBafEve);
}

export function __setBafEveWidgetDepsForTest({ game, finalDay, fetcher } = {}) {
  if (typeof game === 'function') _readGame = game;
  if (typeof finalDay === 'function') _readFinalDay = finalDay;
  if (typeof fetcher === 'function') _fetch = fetcher;
}

export function __resetBafEveWidgetDepsForTest() {
  _readGame = readGameState;
  _readFinalDay = readBafFinalPurchaseDay;
  _fetch = fetchJSON;
}
