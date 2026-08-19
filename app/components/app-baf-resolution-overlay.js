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

const NORMAL_TIMING = Object.freeze({ intro: 520, flip: 3_250, results: 2_650, wheel: 1_550 });
const REDUCED_TIMING = Object.freeze({ intro: 80, flip: 80, results: 120, wheel: 80 });
let active = null;
let openSeq = 0;

function _big(value) {
  try { return BigInt(value ?? 0); } catch (_e) { return 0n; }
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

function _formatWhalePassHalves(value) {
  const halves = _big(value);
  if (halves > 0n && halves % 2n === 0n) {
    const passes = halves / 2n;
    return `${passes} WHALE PASS${passes === 1n ? '' : 'ES'}`;
  }
  return `${halves} HALF-PASS${halves === 1n ? '' : 'ES'}`;
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
  // Always repair both handoff states, including an interrupted pre-mount load.
  try {
    document.body?.classList?.remove('baf-resolution-pending');
    document.body?.classList?.remove('baf-resolution-open');
  } catch (_e) {}
}

function _clearActive() {
  openSeq += 1;
  _destroyActive();
}

export function closeBafResolution() {
  _clearActive();
}

function _drawLegendRow({ kind, color, label, weight, percent }) {
  const row = document.createElement('li');
  row.dataset.kind = kind;
  const swatch = document.createElement('i');
  swatch.style.setProperty('--baf-draw-color', color);
  swatch.setAttribute('aria-hidden', 'true');
  const identity = document.createElement('span');
  identity.textContent = label;
  const score = document.createElement('b');
  score.textContent = weight;
  const share = document.createElement('strong');
  share.textContent = percent;
  row.appendChild(swatch);
  row.appendChild(identity);
  row.appendChild(score);
  row.appendChild(share);
  return row;
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
  const total = _big(draw?.totalWeight);
  const ownWeight = _big(draw?.player?.score);
  const ownPercent = formatBafDrawPercent(ownWeight, draw?.totalWeight);

  if (chance) chance.textContent = ownPercent;
  if (playerWeight) {
    playerWeight.textContent = draw?.player
      ? `${_formatDrawWeight(ownWeight)} FLIP WEIGHT`
      : 'NO FINAL-DAY ENTRY';
  }
  if (context) {
    const playerCount = draw?.totalParticipants == null
      ? '— PLAYERS'
      : `${draw.totalParticipants.toLocaleString('en-US')} PLAYERS`;
    context.textContent = total <= 0n
      ? `FINAL-DAY BOOK UNAVAILABLE · ${playerCount}`
      : `${_formatDrawWeight(total)} FLIP IN THE BOOK · ${playerCount}`;
  }
  if (state) state.textContent = snapshot.gateWon ? 'WAITING FOR DRAW' : 'VOID · BAF LOSS';

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
      `Final-day BAF draw weights. Your chance ${ownPercent}.`,
    );
  }

  if (!legend) return;
  legend.textContent = '';
  legend.appendChild(_drawLegendRow({
    kind: 'player',
    color: '#d9fff5',
    label: 'YOU',
    weight: draw?.player ? `${_formatDrawWeight(ownWeight)} FLIP` : 'NO ENTRY',
    percent: ownPercent,
  }));
  const fieldWeight = total > ownWeight ? total - ownWeight : 0n;
  legend.appendChild(_drawLegendRow({
    kind: 'field',
    color: '#334155',
    label: 'EVERYONE ELSE',
    weight: total > 0n ? `${_formatDrawWeight(fieldWeight)} FLIP` : '—',
    percent: formatBafDrawPercent(fieldWeight, draw?.totalWeight),
  }));
}

function _resultCard({ eyebrow, value, detail, kind, icon = null }) {
  const card = document.createElement('article');
  card.className = 'baf-res__result-card';
  card.dataset.kind = kind;
  if (icon) {
    const image = document.createElement('img');
    image.src = icon;
    image.alt = '';
    card.appendChild(image);
  }
  const copy = document.createElement('span');
  const small = document.createElement('small');
  small.textContent = eyebrow;
  const strong = document.createElement('strong');
  strong.textContent = value;
  const note = document.createElement('b');
  note.textContent = detail;
  copy.appendChild(small);
  copy.appendChild(strong);
  copy.appendChild(note);
  card.appendChild(copy);
  return card;
}

function _paintPlayerResults(overlay, snapshot) {
  const scene = overlay.querySelector('[data-bind="baf-player-results"]');
  const heading = overlay.querySelector('[data-bind="baf-results-heading"]');
  const copy = overlay.querySelector('[data-bind="baf-results-copy"]');
  const grid = overlay.querySelector('[data-bind="baf-result-grid"]');
  if (!scene || !heading || !copy || !grid) return;
  grid.textContent = '';

  if (!snapshot.gateWon) {
    scene.dataset.outcome = 'loss';
    heading.textContent = 'THE BAF DID NOT FIRE';
    copy.textContent = 'The red face kept the pool in the futurepool. No ticket samples or final-day draw ran.';
    if (_big(snapshot.player.consolation) > 0n) {
      grid.appendChild(_resultCard({
        eyebrow: 'YOUR CONSOLATION',
        value: `${formatBafResolutionScore(snapshot.player.consolation)} WWXRP`,
        detail: 'CLAIMABLE BAF LOSS REWARD',
        kind: 'consolation',
      }));
    }
    return;
  }

  const hits = Array.isArray(snapshot.player.prizeHits) ? snapshot.player.prizeHits : [];
  scene.dataset.outcome = snapshot.player.wonAny ? 'win' : 'miss';
  if (snapshot.player.wonAny) {
    heading.textContent = 'YOUR BAF RESULTS';
    copy.textContent = 'Only this wallet’s prize-bearing ticket draws and direct BAF awards are shown.';
  } else {
    heading.textContent = 'NO PRIZE LANDED ON YOUR TICKETS';
    copy.textContent = 'The BAF ran, but no prize-bearing ticket result was recorded for this wallet.';
  }

  const visibleHits = hits.slice(0, 6);
  for (let index = 0; index < visibleHits.length; index += 1) {
    const hit = visibleHits[index];
    const suffix = Number(hit.count) > 1 ? ` · ×${hit.count}` : '';
    if (hit.kind === 'eth') {
      grid.appendChild(_resultCard({
        eyebrow: `PRIZE RESULT ${index + 1}${suffix}`,
        value: `${_formatEth(hit.amount, 4)} ETH`,
        detail: 'PAID TO YOUR CLAIMABLE BALANCE',
        kind: 'eth',
        icon: '/badges-circular/crypto_06_ethereum_green.svg',
      }));
    } else if (hit.kind === 'tickets') {
      const amount = _big(hit.amount);
      grid.appendChild(_resultCard({
        eyebrow: `PRIZE RESULT ${index + 1}${suffix}`,
        value: `${amount} TICKET${amount === 1n ? '' : 'S'}`,
        detail: hit.level == null ? 'FUTURE TICKET PAYOUT' : `LEVEL ${hit.level} TICKET PAYOUT`,
        kind: 'tickets',
        icon: '/whitepaper/flame-center.svg',
      }));
    } else {
      grid.appendChild(_resultCard({
        eyebrow: `PRIZE RESULT ${index + 1}${suffix}`,
        value: _formatWhalePassHalves(hit.amount),
        detail: 'DEFERRED BAF TICKET VALUE',
        kind: 'whale-pass',
        icon: '/app/assets/baf-mark.svg',
      }));
    }
  }

  if (hits.length > visibleHits.length) {
    grid.appendChild(_resultCard({
      eyebrow: 'MORE RESULTS',
      value: `+${hits.length - visibleHits.length}`,
      detail: 'INCLUDED IN YOUR TOTAL BELOW',
      kind: 'overflow',
    }));
  }
  if (!grid.childElementCount && snapshot.player.leaderSlicePct > 0) {
    grid.appendChild(_resultCard({
      eyebrow: snapshot.player.leaderSlicePct === 10 ? 'TOP BAF SCORE' : 'CUT SURVIVOR',
      value: `${snapshot.player.leaderSlicePct}% SLICE`,
      detail: 'PAYOUT DETAILS ARE STILL SYNCING',
      kind: 'leader',
    }));
  }
  if (!grid.childElementCount) {
    grid.appendChild(_resultCard({
      eyebrow: 'YOUR FINISH',
      value: snapshot.player.rank == null ? 'UNRANKED' : `RANK #${snapshot.player.rank}`,
      detail: `${formatBafResolutionScore(snapshot.player.score)} BAF SCORE · NO PAYOUT`,
      kind: 'miss',
    }));
  }
}

function _renderSnapshot(overlay, snapshot) {
  overlay.dataset.gate = snapshot.gateWon ? 'win' : 'loss';
  overlay.innerHTML = `
    <div class="baf-res__ambient" aria-hidden="true"></div>
    <main class="baf-res__shell" data-bind="baf-shell" data-stage="coin">
      <header class="baf-res__header">
        <span class="baf-res__brand">
          <span class="baf-res__mark" aria-hidden="true"><b>BAF</b><small>×10</small></span>
          <span><small>LEVEL ${snapshot.level} FINAL</small><h1>BIG ASS FLIP</h1></span>
        </span>
        <span class="baf-res__pool" ${snapshot.estimatedPoolWei == null ? 'hidden' : ''}>
          <img src="/badges-circular/crypto_06_ethereum_green.svg" alt="ETH">
          <span><small>BAF PRIZE POOL</small><strong>${_formatEth(snapshot.estimatedPoolWei)} <em>ETH</em></strong></span>
        </span>
      </header>

      <ol class="baf-res__steps" aria-label="Big Ass Flip reveal progress">
        <li><i></i><span>THE FLIP</span></li>
        <li><i></i><span>YOUR RESULTS</span></li>
        <li><i></i><span>LAST-DAY DRAW</span></li>
      </ol>

      <section class="baf-res__scene baf-res__gate" aria-live="polite">
        <small>50 / 50 FIRE GATE</small>
        <h2>ONE FLIP DECIDES THE WHOLE BAF</h2>
        <div class="baf-res__coin-scene" aria-hidden="true">
          <span class="baf-res__coin-aura"></span>
          <span class="baf-res__coin-shadow"></span>
          <span class="baf-res__coin-rotor" data-bind="baf-coin"></span>
        </div>
        <strong data-bind="baf-gate-result">FLIP TO RUN THE DRAW</strong>
        <p>Green fires the ticket draws. Red leaves the prize pool untouched.</p>
      </section>

      <section class="baf-res__scene baf-res__results" data-bind="baf-player-results" hidden
               aria-label="Your BAF draw results">
        <header>
          <span><small>YOUR WALLET ONLY</small><h2 data-bind="baf-results-heading">YOUR BAF RESULTS</h2></span>
          <span class="baf-res__standing">
            <b>${snapshot.player.rank == null ? 'UNRANKED' : `RANK #${snapshot.player.rank}`}</b>
            <small>${formatBafResolutionScore(snapshot.player.score)} BAF SCORE</small>
          </span>
        </header>
        <p data-bind="baf-results-copy"></p>
        <div class="baf-res__result-grid" data-bind="baf-result-grid"></div>
        <footer>50 SCATTER ROUNDS · 2 FAR-FUTURE DRAWS · ONLY YOUR RESULTS SHOWN</footer>
      </section>

      <section class="baf-res__scene baf-res__weighted" data-bind="baf-weighted" hidden
               aria-label="Final purchase day BAF weighted draw">
        <header>
          <span><small>5% BAF SLICE</small><h2>FINAL-DAY WEIGHTED DRAW</h2></span>
          <b data-bind="baf-draw-state">WAITING FOR GATE</b>
        </header>
        <div class="baf-res__weighted-body">
          <div class="baf-res__draw-wheel" data-bind="baf-draw-wheel">
            <span class="baf-res__draw-pointer" aria-hidden="true"></span>
            <span class="baf-res__draw-ticks" aria-hidden="true"></span>
            <div class="baf-res__draw-pie" data-bind="baf-draw-pie" role="img">
              <span class="baf-res__draw-core">
                <img src="/app/assets/baf-mark.svg" alt="">
                <small>YOUR CHANCE</small>
                <strong data-bind="baf-draw-player-percent">—</strong>
                <b data-bind="baf-draw-player-weight">NO FINAL-DAY ENTRY</b>
              </span>
            </div>
          </div>
          <div class="baf-res__draw-copy">
            <h3>YOUR LAST-DAY FLIP WEIGHT</h3>
            <p>Direct FLIP added on the final purchase day became one weighted chance at this five-percent slice.</p>
            <ol class="baf-res__draw-legend" data-bind="baf-draw-legend"></ol>
          </div>
        </div>
        <footer data-bind="baf-draw-context">FINAL-DAY BOOK UNAVAILABLE</footer>
      </section>

      <footer class="baf-res__footer">
        <div class="baf-res__payout" data-bind="baf-payout"></div>
        <button type="button" class="baf-res__done" data-bind="baf-done" hidden>BACK TO GAME</button>
      </footer>
    </main>
    <button type="button" class="baf-res__close" data-bind="baf-close" aria-label="Close BAF resolution">×</button>
  `;

  _paintPlayerResults(overlay, snapshot);
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
      : 'NO DRAW · POOL STAYS IN THE FUTUREPOOL';
  } else if (snapshot.player.wonAny) {
    payout.classList.add('is-win');
    heading.textContent = 'YOUR BAF RESULT';
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
    if (_big(snapshot.player.whalePassHalves) > 0n) {
      addReward(_formatWhalePassHalves(snapshot.player.whalePassHalves), 'whale-pass', '/app/assets/baf-mark.svg');
    }
    if (!rewards.childElementCount && snapshot.player.leaderSlicePct > 0) {
      addReward(`${snapshot.player.leaderSlicePct}% LEADER PRIZE · SYNCING`, 'leader');
    }
  } else {
    payout.classList.add('is-miss');
    heading.textContent = 'NO BAF PAYOUT';
    rewards.classList.add('is-summary');
    rewards.textContent = `${snapshot.player.rank == null ? 'UNRANKED' : `RANK #${snapshot.player.rank}`} · ${formatBafResolutionScore(snapshot.player.score)} SCORE`;
  }
  payout.appendChild(heading);
  payout.appendChild(rewards);
}

function _finishCeremony(overlay, snapshot) {
  const shell = overlay.querySelector('[data-bind="baf-shell"]');
  if (!shell) return;
  shell.dataset.stage = 'complete';
  const wheel = overlay.querySelector('[data-bind="baf-draw-wheel"]');
  wheel?.classList.remove('is-spinning');
  wheel?.classList.add(snapshot.gateWon ? 'is-settled' : 'is-void');
  const state = overlay.querySelector('[data-bind="baf-draw-state"]');
  if (state) state.textContent = snapshot.gateWon ? 'DRAW COMPLETE' : 'NOT DRAWN · BAF LOSS';
  _paintPayout(overlay, snapshot);
  const done = overlay.querySelector('[data-bind="baf-done"]');
  if (done) {
    done.hidden = false;
    try { done.focus({ preventScroll: true }); } catch (_e) { try { done.focus(); } catch (_ignore) {} }
  }
  try {
    document.dispatchEvent(new CustomEvent('baf:revealed', {
      detail: {
        level: snapshot.level,
        won: snapshot.gateWon,
        prizeHits: snapshot.player.prizeHits?.length || 0,
      },
    }));
  } catch (_e) { /* optional integration event */ }
}

function _runCeremony(overlay, snapshot) {
  const shell = overlay.querySelector('[data-bind="baf-shell"]');
  const rotor = overlay.querySelector('[data-bind="baf-coin"]');
  const result = overlay.querySelector('[data-bind="baf-gate-result"]');
  const gate = overlay.querySelector('.baf-res__gate');
  const playerResults = overlay.querySelector('[data-bind="baf-player-results"]');
  const weighted = overlay.querySelector('[data-bind="baf-weighted"]');
  const wheel = overlay.querySelector('[data-bind="baf-draw-wheel"]');
  const state = overlay.querySelector('[data-bind="baf-draw-state"]');
  const timing = _motionReduced() ? REDUCED_TIMING : NORMAL_TIMING;

  _schedule(() => {
    if (!shell || !rotor) return;
    shell.dataset.stage = 'coin-flip';
    rotor.classList.add('is-flipping', snapshot.gateWon ? 'is-win' : 'is-loss');
    if (result) result.textContent = 'FLIPPING';
    _sound(warmupCoinflipSfx);
    _sound(sfxCoinflipStart);
    _schedule(() => _sound(() => sfxCoinflipWhoosh(0.82)), Math.floor(timing.flip * 0.46));

    _schedule(() => {
      if (!shell) return;
      _sound(() => sfxCoinflipLand(snapshot.gateWon));
      if (result) result.textContent = snapshot.gateWon ? 'BAF FIRES' : 'BAF LOSS';
      shell.dataset.stage = 'results';
      if (gate) gate.hidden = true;
      if (playerResults) playerResults.hidden = false;

      _schedule(() => {
        if (!shell) return;
        shell.dataset.stage = snapshot.gateWon ? 'wheel' : 'wheel-loss';
        if (playerResults) playerResults.hidden = true;
        if (weighted) weighted.hidden = false;
        if (snapshot.gateWon) {
          wheel?.classList.add('is-spinning');
          if (state) state.textContent = 'DRAWING';
          _sound(() => sfxCoinflipWhoosh(0.42, true));
        } else if (state) {
          state.textContent = 'VOID · BAF LOSS';
        }
        _schedule(() => _finishCeremony(overlay, snapshot), timing.wheel);
      }, timing.results);
    }, timing.flip);
  }, timing.intro);
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

  // The normal Community Coinflip uses the same transition moment. Park that
  // background coin while the player-specific fullscreen data loads so it
  // cannot preview or compete with the BAF gate ceremony.
  document.body.classList.add('baf-resolution-pending');
  let resolved;
  try {
    resolved = snapshot || await loadBafResolutionSnapshot({
      level,
      player,
      consolation,
      playerOutcome,
      history,
    });
  } catch (error) {
    if (seq === openSeq) document.body.classList.remove('baf-resolution-pending');
    throw error;
  }
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
    document.body.classList.remove('baf-resolution-pending');
    document.body.classList.add('baf-resolution-open');
    _runCeremony(overlay, resolved);
    try { overlay.querySelector('[data-bind="baf-close"]')?.focus({ preventScroll: true }); } catch (_e) {}
    return true;
  } catch (error) {
    if (active?.overlay === overlay) _destroyActive();
    throw error;
  }
}
