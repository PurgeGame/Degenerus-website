// Fullscreen, player-centric BAF resolution ceremony.

import { displayEthCompact } from '../app/scaling.js';
import {
  formatBafResolutionScore,
  loadBafResolutionSnapshot,
} from '../app/baf-resolution.js';
import {
  buildBafDrawAllocation,
  formatBafDrawPercent,
} from '../app/baf-draw.js';
import { appendCoinFaces } from '../app/coin-faces.js';
import {
  warmup as warmupCoinflipSfx,
  sfxCoinflipLand,
  sfxCoinflipStart,
  sfxCoinflipWhoosh,
} from '../app/jackpot-sfx.js';

const NORMAL_TIMING = Object.freeze({ lineup: 1_350, flip: 3_250, draw: 1_450, cut: 900 });
const REDUCED_TIMING = Object.freeze({ lineup: 80, flip: 80, draw: 80, cut: 80 });
let active = null;
let openSeq = 0;

function _big(value) {
  try { return BigInt(value ?? 0); } catch (_e) { return 0n; }
}

function _short(value) {
  const address = String(value || '');
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address || '—';
}

function _formatEth(value, digits = 3) {
  try {
    const [whole, fraction] = displayEthCompact(_big(value), digits).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction == null ? grouped : `${grouped}.${fraction}`;
  } catch (_e) { return '0'; }
}

function _formatDrawWeight(value) {
  const amount = _big(value);
  const units = [
    [1_000_000_000_000n, 'T'],
    [1_000_000_000n, 'B'],
    [1_000_000n, 'M'],
    [1_000n, 'K'],
  ];
  for (const [unit, suffix] of units) {
    if (amount < unit) continue;
    const tenths = (amount * 10n) / unit;
    return `${tenths / 10n}${tenths % 10n === 0n ? '' : `.${tenths % 10n}`}${suffix}`;
  }
  return amount.toLocaleString('en-US');
}

function _motionReduced() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (_e) { return false; }
}

function _sound(fn) {
  try {
    const result = fn?.();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (_e) { /* audio is enhancement only */ }
}

function _schedule(fn, ms) {
  if (!active) return null;
  const handle = setTimeout(() => {
    if (!active) return;
    active.timers.delete(handle);
    fn();
  }, ms);
  active.timers.add(handle);
  try { handle?.unref?.(); } catch (_e) { /* browser timer */ }
  return handle;
}

function _destroyActive() {
  const current = active;
  active = null;
  if (current) {
    for (const handle of current.timers) clearTimeout(handle);
    current.timers.clear();
    try { document.removeEventListener('keydown', current.onKeydown); } catch (_e) {}
    try { current.overlay.remove(); } catch (_e) {}
  }
  // Always repair the scroll lock, even if an interrupted render lost its
  // in-memory `active` record.
  try { document.body?.classList?.remove('baf-resolution-open'); } catch (_e) {}
}

function _clearActive() {
  openSeq += 1;
  _destroyActive();
}

export function closeBafResolution() {
  _clearActive();
}

function _leaderCard(row, snapshot) {
  const item = document.createElement('li');
  const rank = Number(row?.rank);
  item.className = 'baf-res__leader';
  item.dataset.rank = String(rank);
  if (rank === 1) item.classList.add('is-locked');
  if (rank === 2) item.classList.add('is-eliminated', 'is-precut');
  if (row?.player && row.player === snapshot.player.address) item.classList.add('is-you');

  const rankNode = document.createElement('span');
  rankNode.className = 'baf-res__leader-rank';
  rankNode.textContent = `#${rank}`;
  const copy = document.createElement('span');
  copy.className = 'baf-res__leader-copy';
  const address = document.createElement('small');
  address.textContent = row ? _short(row.player) : '—';
  const score = document.createElement('strong');
  score.textContent = row ? formatBafResolutionScore(row.score) : '—';
  const state = document.createElement('b');
  state.className = 'baf-res__leader-state';
  state.textContent = rank === 1
    ? '10% LOCKED'
    : (rank === 2 ? 'OUT' : (snapshot.cutKnown ? 'FLIP CUT' : 'CUT SYNCING'));
  copy.appendChild(address);
  copy.appendChild(score);
  item.appendChild(rankNode);
  item.appendChild(copy);
  item.appendChild(state);
  return item;
}

function _paintWeightedDraw(overlay, snapshot) {
  const draw = snapshot.draw;
  const allocation = buildBafDrawAllocation(draw, snapshot.player.address);
  const pie = overlay.querySelector('[data-bind="baf-draw-pie"]');
  const legend = overlay.querySelector('[data-bind="baf-draw-legend"]');
  const chance = overlay.querySelector('[data-bind="baf-draw-player-percent"]');
  const playerWeight = overlay.querySelector('[data-bind="baf-draw-player-weight"]');
  const context = overlay.querySelector('[data-bind="baf-draw-context"]');
  const state = overlay.querySelector('[data-bind="baf-draw-state"]');
  const total = draw?.totalWeight;
  const ownWeight = draw?.player?.score;

  if (chance) chance.textContent = formatBafDrawPercent(ownWeight, total);
  if (playerWeight) {
    playerWeight.textContent = draw?.player
      ? `${_formatDrawWeight(ownWeight)} FLIP WEIGHT`
      : 'WEIGHT SYNCING';
  }
  if (context) {
    const playerCount = draw?.totalParticipants == null
      ? '— PLAYERS'
      : `${draw.totalParticipants.toLocaleString('en-US')} PLAYERS`;
    context.textContent = total == null
      ? `TOTAL SYNCING · ${playerCount}`
      : `${_formatDrawWeight(total)} FLIP TOTAL · ${playerCount}`;
  }
  if (state) state.textContent = snapshot.gateWon ? 'DRAW BOOK LOCKED' : 'VOID · BAF LOSS';

  const visibleSlices = allocation.entries.filter((entry) => entry.endPpm > entry.startPpm);
  if (pie) {
    pie.classList.toggle('is-empty', visibleSlices.length === 0);
    if (visibleSlices.length > 0) {
      const stops = visibleSlices.flatMap((entry) => {
        const start = (entry.startPpm / 10_000).toFixed(4);
        const end = (entry.endPpm / 10_000).toFixed(4);
        return `${entry.color} ${start}% ${end}%`;
      });
      pie.style.setProperty('--baf-draw-pie', `conic-gradient(from -90deg, ${stops.join(', ')})`);
    } else {
      pie.style.removeProperty('--baf-draw-pie');
    }
    pie.setAttribute(
      'aria-label',
      `Final-day BAF draw weights. Your chance ${formatBafDrawPercent(ownWeight, total)}.`,
    );
  }

  if (!legend) return;
  legend.textContent = '';
  for (const entry of allocation.entries) {
    const row = document.createElement('li');
    row.dataset.kind = entry.kind;
    if (entry.isPlayer) row.classList.add('is-player');

    const swatch = document.createElement('i');
    swatch.style.setProperty('--baf-draw-color', entry.color);
    swatch.setAttribute('aria-hidden', 'true');
    const identity = document.createElement('span');
    if (entry.kind === 'other') identity.textContent = 'EVERYONE ELSE';
    else if (entry.isPlayer) identity.textContent = entry.rank ? `#${entry.rank} · YOU` : 'YOU';
    else identity.textContent = `#${entry.rank} · ${_short(entry.player)}`;
    const score = document.createElement('b');
    score.textContent = `${_formatDrawWeight(entry.score)} FLIP`;
    const percent = document.createElement('strong');
    percent.textContent = entry.percent;
    row.appendChild(swatch);
    row.appendChild(identity);
    row.appendChild(score);
    row.appendChild(percent);
    legend.appendChild(row);
  }
}

function _renderSnapshot(overlay, snapshot) {
  overlay.classList.remove('is-loading');
  overlay.dataset.gate = snapshot.gateWon ? 'win' : 'loss';
  overlay.innerHTML = `
    <div class="baf-res__ambient" aria-hidden="true"></div>
    <main class="baf-res__shell" data-bind="baf-shell" data-stage="lineup">
      <header class="baf-res__header">
        <span class="baf-res__brand">
          <span class="baf-res__mark" aria-hidden="true"><b>BAF</b><small>×10</small></span>
          <span><small>LEVEL ${snapshot.level} FINAL</small><h1>BIG ASS FLIP</h1></span>
        </span>
        <span class="baf-res__pool" data-bind="baf-pool" ${snapshot.estimatedPoolWei == null ? 'hidden' : ''}>
          <img src="/badges-circular/crypto_06_ethereum_green.svg" alt="ETH">
          <span><small>FINAL PRIZE POOL</small><strong>${_formatEth(snapshot.estimatedPoolWei)} <em>ETH</em></strong></span>
        </span>
        <span class="baf-res__steps" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </header>

      <section class="baf-res__standing" aria-label="Your Big Ass Flip standing">
        <small>YOUR STANDING</small>
        <strong>${snapshot.player.rank == null ? 'UNRANKED' : `RANK #${snapshot.player.rank}`}</strong>
        <span><b>${formatBafResolutionScore(snapshot.player.score)}</b> SCORE</span>
        <em>${snapshot.player.totalParticipants == null ? '—' : snapshot.player.totalParticipants.toLocaleString('en-US')} PLAYERS</em>
      </section>

      <section class="baf-res__lineup" aria-label="BAF top four">
        <header><strong>TOP FOUR</strong><span>${snapshot.cutKnown ? '#2 CUT BEFORE THE GATE' : 'FINAL CUT SYNCING'}</span></header>
        <ol data-bind="baf-leaders"></ol>
      </section>

      <section class="baf-res__gate" aria-live="polite">
        <span class="baf-res__gate-line baf-res__gate-line--left" aria-hidden="true"></span>
        <div class="baf-res__coin-wrap">
          <small data-bind="baf-gate-eyebrow">BAF GATE</small>
          <div class="baf-res__coin-scene" aria-hidden="true">
            <span class="baf-res__coin-shadow"></span>
            <span class="baf-res__coin-rotor" data-bind="baf-coin"></span>
          </div>
          <strong data-bind="baf-gate-result">FLIP INCOMING</strong>
        </div>
        <span class="baf-res__gate-line baf-res__gate-line--right" aria-hidden="true"></span>
      </section>

      <section class="baf-res__weighted" data-bind="baf-weighted"
               aria-label="Final purchase day BAF weighted draw">
        <header>
          <span><small>5% BAF SLICE</small><strong>FINAL-DAY WEIGHTED DRAW</strong></span>
          <b data-bind="baf-draw-state">DRAW BOOK LOCKED</b>
        </header>
        <div class="baf-res__weighted-body">
          <div class="baf-res__draw-wheel">
            <span class="baf-res__draw-ticks" aria-hidden="true"></span>
            <div class="baf-res__draw-pie" data-bind="baf-draw-pie" role="img">
              <span class="baf-res__draw-core">
                <img src="/app/assets/baf-mark.svg" alt="">
                <small>YOUR CHANCE</small>
                <strong data-bind="baf-draw-player-percent">—</strong>
                <b data-bind="baf-draw-player-weight">WEIGHT SYNCING</b>
              </span>
            </div>
          </div>
          <ol class="baf-res__draw-legend" data-bind="baf-draw-legend"></ol>
        </div>
        <footer data-bind="baf-draw-context">TOTAL SYNCING</footer>
      </section>

      <section class="baf-res__prizes" aria-label="BAF prize lanes">
        <header>
          <strong>PRIZE MAP</strong>
          <span>${snapshot.resolutionDetailsAvailable
            ? `<b>${snapshot.awards.ethCount}</b> ETH AWARDS · <b>${snapshot.awards.ticketCount}</b> TICKET AWARDS`
            : 'PAYOUT DETAILS SYNCING'}</span>
        </header>
        <div class="baf-res__prize-grid" data-bind="baf-prize-grid"></div>
      </section>

      <footer class="baf-res__footer">
        <div class="baf-res__payout" data-bind="baf-payout"></div>
        <button type="button" class="baf-res__done" data-bind="baf-done" hidden>BACK TO GAME</button>
      </footer>
    </main>
    <button type="button" class="baf-res__close" data-bind="baf-close" aria-label="Close BAF resolution">×</button>
  `;

  const leaders = overlay.querySelector('[data-bind="baf-leaders"]');
  const byRank = new Map(snapshot.topFour.map((row) => [Number(row.rank), row]));
  for (let rank = 1; rank <= 4; rank += 1) {
    leaders?.appendChild(_leaderCard(byRank.get(rank) || { rank }, snapshot));
  }

  const prizeGrid = overlay.querySelector('[data-bind="baf-prize-grid"]');
  for (const lane of snapshot.prizeLanes) {
    const card = document.createElement('article');
    card.className = 'baf-res__prize';
    card.dataset.lane = lane.id;
    const mine = (lane.id === 'leader' && snapshot.player.leaderSlicePct === 10)
      || (lane.id === 'cut' && snapshot.player.leaderSlicePct === 5);
    if (mine) card.classList.add('is-player-win');
    const detail = document.createElement('small');
    detail.textContent = lane.detail;
    const label = document.createElement('span');
    label.textContent = lane.label;
    const share = document.createElement('strong');
    share.textContent = `${lane.share}%`;
    card.appendChild(detail);
    card.appendChild(label);
    card.appendChild(share);
    prizeGrid?.appendChild(card);
  }

  _paintWeightedDraw(overlay, snapshot);

  const rotor = overlay.querySelector('[data-bind="baf-coin"]');
  appendCoinFaces(rotor, { initialSide: 'red' });
  overlay.querySelector('[data-bind="baf-close"]')?.addEventListener('click', _clearActive);
  overlay.querySelector('[data-bind="baf-done"]')?.addEventListener('click', _clearActive);
}

function _paintPayout(overlay, snapshot) {
  const payout = overlay.querySelector('[data-bind="baf-payout"]');
  if (!payout) return;
  payout.textContent = '';
  payout.className = 'baf-res__payout';

  const heading = document.createElement('strong');
  const rewards = document.createElement('span');
  rewards.className = 'baf-res__reward-list';
  const addReward = (label, kind, icon = null) => {
    const reward = document.createElement('b');
    reward.className = 'baf-res__reward';
    reward.dataset.kind = kind;
    if (icon) {
      const image = document.createElement('img');
      image.src = icon;
      image.alt = '';
      reward.appendChild(image);
    }
    const copy = document.createElement('span');
    copy.textContent = label;
    reward.appendChild(copy);
    rewards.appendChild(reward);
  };
  if (!snapshot.gateWon) {
    payout.classList.add('is-loss');
    heading.textContent = 'BAF LOSS';
    rewards.classList.add('is-summary');
    rewards.textContent = _big(snapshot.player.consolation) > 0n
      ? `${formatBafResolutionScore(snapshot.player.consolation)} WWXRP CONSOLATION`
      : 'NO BAF PAYOUT';
  } else if (snapshot.player.wonAny) {
    payout.classList.add('is-win');
    heading.textContent = 'YOU WON';
    if (_big(snapshot.player.eth) > 0n) {
      addReward(
        `${_formatEth(snapshot.player.eth, 4)} ETH`,
        'eth',
        '/badges-circular/crypto_06_ethereum_green.svg',
      );
    }
    if (_big(snapshot.player.tickets) > 0n) {
      addReward(
        `${snapshot.player.tickets} TICKET${_big(snapshot.player.tickets) === 1n ? '' : 'S'}`,
        'tickets',
        '/whitepaper/flame-center.svg',
      );
    }
    if (!rewards.childElementCount && snapshot.player.leaderSlicePct > 0) {
      addReward(`${snapshot.player.leaderSlicePct}% LEADER PRIZE`, 'leader');
    }
  } else {
    payout.classList.add('is-loss');
    heading.textContent = 'NO BAF PAYOUT';
    rewards.classList.add('is-summary');
    rewards.textContent = `RANK #${snapshot.player.rank ?? '—'} · ${formatBafResolutionScore(snapshot.player.score)} SCORE`;
  }
  payout.appendChild(heading);
  payout.appendChild(rewards);
}

function _runCeremony(overlay, snapshot) {
  const shell = overlay.querySelector('[data-bind="baf-shell"]');
  const rotor = overlay.querySelector('[data-bind="baf-coin"]');
  const result = overlay.querySelector('[data-bind="baf-gate-result"]');
  const eyebrow = overlay.querySelector('[data-bind="baf-gate-eyebrow"]');
  const timing = _motionReduced() ? REDUCED_TIMING : NORMAL_TIMING;

  _schedule(() => {
    if (!shell || !rotor) return;
    shell.dataset.stage = 'gate';
    rotor.classList.add('is-flipping', snapshot.gateWon ? 'is-win' : 'is-loss');
    if (result) result.textContent = 'FLIPPING';
    _sound(warmupCoinflipSfx);
    _sound(sfxCoinflipStart);
    _schedule(() => _sound(() => sfxCoinflipWhoosh(0.78)), Math.floor(timing.flip * 0.46));

    _schedule(() => {
      if (!shell) return;
      _sound(() => sfxCoinflipLand(snapshot.gateWon));
      shell.dataset.stage = snapshot.gateWon ? 'draw' : 'draw-loss';
      if (eyebrow) eyebrow.textContent = snapshot.gateWon ? 'BAF LIVE' : 'BAF LOSS';
      if (result) result.textContent = snapshot.gateWon ? 'GATE WON' : 'BAF LOSS';

      _schedule(() => {
        if (!shell) return;
        shell.dataset.stage = snapshot.gateWon ? 'cut' : 'draw-loss';
        if (snapshot.gateWon && snapshot.cutKnown) {
          const eliminated = overlay.querySelector(`.baf-res__leader[data-rank="${snapshot.eliminatedCutRank}"]`);
          const survivor = overlay.querySelector(`.baf-res__leader[data-rank="${snapshot.survivorRank}"]`);
          eliminated?.classList.add('is-eliminated', 'is-cut-now');
          const eliminatedState = eliminated?.querySelector('.baf-res__leader-state');
          if (eliminatedState) eliminatedState.textContent = 'OUT';
          survivor?.classList.add('is-survivor');
          const survivorState = survivor?.querySelector('.baf-res__leader-state');
          if (survivorState) survivorState.textContent = '5% WINNER';
        } else if (!snapshot.gateWon) {
          for (const card of overlay.querySelectorAll('.baf-res__leader')) card.classList.add('is-gate-out');
        } else {
          for (const rank of [3, 4]) {
            const pending = overlay.querySelector(`.baf-res__leader[data-rank="${rank}"] .baf-res__leader-state`);
            if (pending) pending.textContent = 'CUT SYNCING';
          }
        }

        _schedule(() => {
          if (!shell) return;
          shell.dataset.stage = 'prizes';
          _paintPayout(overlay, snapshot);
          const done = overlay.querySelector('[data-bind="baf-done"]');
          if (done) {
            done.hidden = false;
            try { done.focus({ preventScroll: true }); } catch (_e) { try { done.focus(); } catch (_ignore) {} }
          }
          try {
            document.dispatchEvent(new CustomEvent('baf:revealed', {
              detail: { level: snapshot.level, won: snapshot.gateWon },
            }));
          } catch (_e) { /* optional integration event */ }
        }, timing.cut);
      }, timing.draw);
    }, timing.flip);
  }, timing.lineup);
}

export async function openBafResolution({
  level,
  player,
  consolation = 0,
  snapshot = null,
  playerOutcome = null,
  history = null,
} = {}) {
  if (typeof document === 'undefined' || !document.body) return false;
  const seq = ++openSeq;
  _destroyActive();

  // Fetch first. The Pending row supplies the loading feedback while the app
  // remains completely usable; only a ready ceremony is allowed to scroll-lock
  // the page.
  const resolved = snapshot || await loadBafResolutionSnapshot({
    level,
    player,
    consolation,
    playerOutcome,
    history,
  });
  if (seq !== openSeq) return false;

  const overlay = document.createElement('section');
  overlay.className = 'baf-res-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Level ${Number(level)} Big Ass Flip resolution`);
  const onKeydown = (event) => { if (event?.key === 'Escape') _clearActive(); };
  active = { overlay, timers: new Set(), onKeydown };

  try {
    _renderSnapshot(overlay, resolved);
    if (seq !== openSeq || active?.overlay !== overlay) return false;
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);
    document.body.classList.add('baf-resolution-open');
    _runCeremony(overlay, resolved);
    try { overlay.querySelector('[data-bind="baf-close"]')?.focus({ preventScroll: true }); } catch (_e) {}
    return true;
  } catch (error) {
    if (active?.overlay === overlay) _destroyActive();
    throw error;
  }
}
