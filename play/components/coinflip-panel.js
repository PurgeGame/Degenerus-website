// play/components/coinflip-panel.js -- <coinflip-panel> Custom Element (Phase 54 Wave 1)
//
// Three-section hydrated markup + parallel-fetch wiring with stale-response guard
// and keep-old-data-dim. All data flows from two endpoints shipped prior to Phase 54:
//   - GET /player/:address?day=N (coinflip block; shipped by Phase 51 INTEG-02)
//   - GET /leaderboards/coinflip?day=N (shipped earlier; verified live 2026-04-24)
//
// Sections (top to bottom, per CONTEXT.md D-08 bounty-above-state-above-leaderboard):
//   1. Bounty header (COINFLIP-03) -- current pool + armed indicator + biggest-flip
//      record holder + record amount. Source: /player/:addr?day=N coinflip block.
//   2. Player state (COINFLIP-01) -- deposited amount, claimable preview,
//      auto-rebuy enabled/stop (read-only display; no write UI per read-only scope).
//      Source: same coinflip block.
//   3. Leaderboard (COINFLIP-02) -- top-10 table with rank + truncated address + score.
//      Source: /leaderboards/coinflip?day=N.
//
// Data flow (Wave 1 ship; matches Phase 51 PROFILE-04 pattern):
//   subscribe('replay.day')    \
//                                --> #refetch() --> Promise.all([
//   subscribe('replay.player') /                      fetch /player/:addr?day=,
//                                                     fetch /leaderboards/coinflip?day=,
//                                                   ])
//                                                   --> #renderBounty(coinflip)
//                                                   --> #renderState(coinflip)
//                                                   --> #renderLeaderboard(entries)
//                                                   --> #showContent()
//   #coinflipFetchId stale-guard: token bumped on each #refetch() call; checked
//   after Promise.all resolves, after playerRes.json(), after lbRes.json() so
//   rapid scrubbing never lets a late response clobber a fresh one (D-18).
//   On second-and-later fetches, [data-bind="content"] gets .is-stale
//   (0.6 opacity dim) until the new data renders -- keep-old-data-dim (D-17).
//
// SECURITY (T-54-01): the innerHTML template is a static string with no
// user interpolation. All dynamic writes go through textContent or
// element.setAttribute (never .innerHTML with response data). Day query
// value is URL-encoded at the call site (T-54-21).
//
// SHELL-01: imports only from the wallet-free surface -- beta/app/store.js
// (verified wallet-free), beta/viewer/utils.js (explicit SHELL-01 comment at
// line 2), and play/app/constants.js (pure re-exports).
//
// SCORE-UNIT DISCIPLINE (Pitfall 8 -- 54-RESEARCH.md line 1517):
//   /leaderboards/coinflip score field -> INTEGER-scale BURNIE (NOT wei).
//     Render via String(entry.score). Do NOT call formatBurnie on it
//     (would misinterpret "52875" as 5.2875e-14 BURNIE).
//   coinflip block amounts (deposited, claimable, bounty pool, biggest-flip,
//     take-profit) -> WEI-scale BURNIE. Render via formatBurnie(value).

import { subscribe, get } from '../../beta/app/store.js';
import { API_BASE } from '../app/constants.js';
import { formatBurnie, truncateAddress } from '../../beta/viewer/utils.js';

const TEMPLATE = `
<section data-slot="coinflip" class="panel play-coinflip-panel">

  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:60%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:120px"></div></div>
  </div>

  <div data-bind="content" hidden>
    <h2 class="panel-title">Coinflip</h2>

    <!-- COINFLIP-03 bounty header -->
    <div class="play-coinflip-bounty" data-bind="bounty">
      <div class="play-coinflip-section-header">Bounty</div>
      <div class="play-coinflip-bounty-armed" data-bind="armed" data-armed="false">NOT ARMED</div>
      <div class="play-coinflip-state-row">
        <span>Pool</span><span data-bind="bounty-pool">0</span>
      </div>
      <div class="play-coinflip-state-row">
        <span>Record flip</span><span data-bind="bounty-record">--</span>
      </div>
      <div class="play-coinflip-state-row">
        <span>Record holder</span><span data-bind="bounty-holder">--</span>
      </div>
    </div>

    <!-- COINFLIP-01 per-player state -->
    <div class="play-coinflip-state">
      <div class="play-coinflip-section-header">Your state</div>
      <div class="play-coinflip-state-row">
        <span>Deposited</span><span data-bind="deposited">0</span>
      </div>
      <div class="play-coinflip-state-row">
        <span>Claimable preview</span><span data-bind="claimable">0</span>
      </div>
      <div class="play-coinflip-state-row">
        <span>Auto-rebuy</span><span data-bind="autorebuy">--</span>
      </div>
      <div class="play-coinflip-state-row">
        <span>Take-profit</span><span data-bind="takeprofit">--</span>
      </div>
    </div>

    <!-- COINFLIP-02 daily leaderboard -->
    <div class="play-coinflip-leaderboard">
      <div class="play-coinflip-header">
        <span>Rank</span><span>Player</span><span>Score</span>
      </div>
      <div class="play-coinflip-entries" data-bind="leaderboard-entries">
      </div>
    </div>
  </div>
</section>
`;

class CoinflipPanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #coinflipFetchId = 0;

  connectedCallback() {
    this.innerHTML = TEMPLATE;

    // Wave 1: subscribe-driven refetch. Coinflip is day-scoped, not level-scoped.
    this.#unsubs.push(
      subscribe('replay.day',    () => this.#refetch()),
      subscribe('replay.player', () => this.#refetch()),
    );

    // Kick an initial fetch in case the store already has both values on first load.
    this.#refetch();
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }

  // --- Stale-guard fetch with 3-checkpoint token comparison -------------

  async #refetch() {
    const addr = get('replay.player');
    const day = get('replay.day');
    const token = ++this.#coinflipFetchId;

    // Pitfall 9: first-day-load race -- no-op until both store values exist.
    if (!addr || day == null) return;

    // D-17 keep-old-data-dim on second-and-later fetches.
    if (this.#loaded) {
      this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
    }

    try {
      // Parallel fetches: COINFLIP-01+03 from player coinflip block,
      // COINFLIP-02 from leaderboards/coinflip.
      const [playerRes, lbRes] = await Promise.all([
        fetch(`${API_BASE}/player/${addr}?day=${encodeURIComponent(day)}`),
        fetch(`${API_BASE}/leaderboards/coinflip?day=${encodeURIComponent(day)}`),
      ]);
      if (token !== this.#coinflipFetchId) return;

      const playerData = playerRes.ok ? await playerRes.json() : null;
      if (token !== this.#coinflipFetchId) return;

      const lbData = lbRes.ok ? await lbRes.json() : null;
      if (token !== this.#coinflipFetchId) return;

      // Graceful partial failure: if leaderboard 404s, still render the bounty+state.
      const coinflip = playerData?.coinflip ?? null;
      const entries = Array.isArray(lbData?.entries) ? lbData.entries : [];

      this.#renderBounty(coinflip);
      this.#renderState(coinflip);
      this.#renderLeaderboard(entries, addr);
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
    } catch (err) {
      if (token === this.#coinflipFetchId) {
        this.#renderError();
        this.#showContent();
        this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
      }
    }
  }

  // --- Render helpers ---------------------------------------------------

  #bind(key) {
    return this.querySelector(`[data-bind="${key}"]`);
  }

  #renderBounty(coinflip) {
    const pool = coinflip?.currentBounty ?? '0';
    const biggestAmount = coinflip?.biggestFlipAmount ?? '0';
    const biggestPlayer = coinflip?.biggestFlipPlayer ?? null;
    const isArmed = pool && pool !== '0';

    const armedEl = this.#bind('armed');
    if (armedEl) {
      armedEl.setAttribute('data-armed', isArmed ? 'true' : 'false');
      armedEl.textContent = isArmed ? 'ARMED' : 'NOT ARMED';
    }

    // Wei-scale BURNIE -> formatBurnie for user display (score-unit discipline).
    const poolEl = this.#bind('bounty-pool');
    if (poolEl) poolEl.textContent = isArmed ? `${formatBurnie(pool)} BURNIE` : '0';

    const recordEl = this.#bind('bounty-record');
    if (recordEl) {
      recordEl.textContent = (biggestAmount && biggestAmount !== '0')
        ? `${formatBurnie(biggestAmount)} BURNIE`
        : '--';
    }

    const holderEl = this.#bind('bounty-holder');
    if (holderEl) {
      holderEl.textContent = biggestPlayer ? truncateAddress(biggestPlayer) : '--';
    }
  }

  #renderState(coinflip) {
    const deposited = coinflip?.depositedAmount ?? '0';
    const claimable = coinflip?.claimablePreview ?? '0';
    const autoRebuy = coinflip?.autoRebuyEnabled === true;
    const takeProfit = coinflip?.autoRebuyStop ?? '0';

    // All amounts WEI-scale -> formatBurnie.
    const depEl = this.#bind('deposited');
    if (depEl) depEl.textContent = `${formatBurnie(deposited)} BURNIE`;

    const claimEl = this.#bind('claimable');
    if (claimEl) claimEl.textContent = `${formatBurnie(claimable)} BURNIE`;

    const autoEl = this.#bind('autorebuy');
    if (autoEl) autoEl.textContent = autoRebuy ? 'ON' : 'OFF';

    const tpEl = this.#bind('takeprofit');
    if (tpEl) {
      tpEl.textContent = (takeProfit && takeProfit !== '0')
        ? `${formatBurnie(takeProfit)} BURNIE`
        : '--';
    }
  }

  #renderLeaderboard(entries, selectedAddr) {
    const container = this.#bind('leaderboard-entries');
    if (!container) return;

    container.textContent = '';

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'play-coinflip-empty';
      const day = get('replay.day');
      empty.textContent = `No coinflip activity for day ${day ?? '--'}.`;
      container.appendChild(empty);
      return;
    }

    const lowerSelected = selectedAddr ? selectedAddr.toLowerCase() : null;

    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'play-coinflip-entry';
      row.setAttribute('data-rank', String(entry.rank));

      if (lowerSelected && entry.player && entry.player.toLowerCase() === lowerSelected) {
        row.setAttribute('aria-current', 'true');
      }

      const rankCell = document.createElement('span');
      rankCell.textContent = `#${entry.rank}`;

      const playerCell = document.createElement('span');
      playerCell.className = 'play-coinflip-player';
      playerCell.textContent = truncateAddress(entry.player);

      // Score-unit discipline: coinflip leaderboard scores are INTEGER-scale BURNIE
      // (live sample day 64 rank 1 = "52875" = 52,875 BURNIE). Do NOT call
      // formatBurnie on these (would misinterpret as wei -> 5.2875e-14).
      const scoreCell = document.createElement('span');
      scoreCell.textContent = `${String(entry.score ?? '0')} BURNIE`;

      row.appendChild(rankCell);
      row.appendChild(playerCell);
      row.appendChild(scoreCell);
      container.appendChild(row);
    }
  }

  #renderError() {
    const container = this.#bind('leaderboard-entries');
    if (container) {
      container.textContent = '';
      const err = document.createElement('div');
      err.className = 'play-coinflip-empty';
      err.textContent = 'Coinflip data unavailable.';
      container.appendChild(err);
    }
  }

  #showContent() {
    const skeleton = this.querySelector('[data-bind="skeleton"]');
    const content = this.querySelector('[data-bind="content"]');
    if (skeleton) skeleton.hidden = true;
    if (content) content.hidden = false;
    this.#loaded = true;
  }
}

customElements.define('coinflip-panel', CoinflipPanel);
