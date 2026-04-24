// play/components/baf-panel.js -- <baf-panel> Custom Element (Phase 54 Wave 1)
//
// Three-section hydrated markup + dual-fetch wiring with stale-response guards
// and keep-old-data-dim. Data flow:
//   - BAF-02 leaderboard top-4: GET /leaderboards/baf?level=N (live pre-Phase-54)
//   - BAF-01 your-rank + BAF-03 round-status: GET /player/:address/baf?level=N
//     (INTEG-05; Wave 1 emits the call and tolerates 404 silently; Wave 2 enables
//     rendering once the endpoint ships per INTEG-05-SPEC.md)
//
// Sections (top to bottom, per 54-RESEARCH.md Section 10):
//   1. Context row (BAF-03 partial) -- next-baf-level label + levels-until label
//      + round-status pill. Level arithmetic is inline (bafContext); round-status
//      reads from INTEG-05 response in Wave 2 with Wave 1 fallback derivation.
//   2. Top-4 leaderboard (BAF-02) -- 4 rows with rank + truncated address + score.
//      Each row has data-rank="1..4" so CSS applies the D-06 gold/silver/bronze/
//      regular tier styling.
//   3. Your-rank row (BAF-01; hidden until INTEG-05 returns data) -- "You: rank N
//      of M -- {score}". Source: INTEG-05 per-player endpoint.
//
// Data flow:
//   subscribe('replay.level')  --> #refetchLeaderboard() + #refetchPlayer()
//   subscribe('replay.player') --> #refetchPlayer()  (leaderboard unchanged)
//
//   Two stale-guard counters (Phase 54 Wave 1 +1 vs Phase 51 precedent):
//     #bafFetchId        -- bumped on leaderboard refetch; 2 token checks
//     #bafPlayerFetchId  -- bumped on INTEG-05 refetch; 2 token checks
//
// Prominence (D-06 -- approach-based not rank-based):
//   Panel-level data-prominence="low|medium|high" reflects how close the game
//   is to the next BAF level. bafContext() below derives prominence.
//   Rank-tier colors (rank 1 gold, rank 2 silver, rank 3 bronze, rank 4 regular)
//   are applied via data-rank attribute + CSS selectors in play.css.
//
// SECURITY (T-54-01): the innerHTML template is a static string with no
// user interpolation. All dynamic writes go through textContent or
// element.setAttribute. URL parameters are URL-encoded at the call site.
//
// SHELL-01: imports only from the wallet-free surface. The three new
// Wave 0 FORBIDDEN entries (beta/components/baf-panel.js, beta/app/baf.js,
// beta/app/coinflip.js) are honored -- none are imported here.
//
// SCORE-UNIT DISCIPLINE (Pitfall 8):
//   /leaderboards/baf score field -> WEI-scale BURNIE. formatBurnie(score).
//   INTEG-05 score field           -> WEI-scale BURNIE. formatBurnie(data.score).
//   Different from coinflip leaderboard (integer-scale) -- do NOT reuse the
//   coinflip-panel String() pattern here.

import { subscribe, get } from '../../beta/app/store.js';
import { API_BASE } from '../app/constants.js';
import { formatBurnie, truncateAddress } from '../../beta/viewer/utils.js';

// Inline bafContext derivation (54-PATTERNS.md recommendation: 15 LOC inline
// avoids a new helper file + avoids importing from wallet-tainted beta/app/baf.js).
function bafContext(level) {
  if (level == null) {
    return { nextBafLevel: null, levelsUntilBaf: null, isBafLevel: false, prominence: 'low' };
  }
  const nextBafLevel = Math.ceil((level + 1) / 10) * 10;
  const levelsUntilBaf = nextBafLevel - level;
  const isBafLevel = level % 10 === 0;
  let prominence;
  if (isBafLevel)               prominence = 'high';
  else if (levelsUntilBaf <= 3) prominence = 'high';
  else if (levelsUntilBaf <= 7) prominence = 'medium';
  else                          prominence = 'low';
  return { nextBafLevel, levelsUntilBaf, isBafLevel, prominence };
}

const TEMPLATE = `
<section data-slot="baf" class="panel play-baf-panel" data-prominence="low">

  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:60%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:100px"></div></div>
  </div>

  <div data-bind="content" hidden>
    <h2 class="panel-title">BAF Leaderboard</h2>

    <!-- BAF-03 context row + round-status pill -->
    <div class="play-baf-context">
      <span data-bind="next-baf-level">Next BAF: Level --</span>
      <span data-bind="levels-until">-- levels away</span>
      <span class="play-baf-round-status" data-bind="round-status" data-status="">--</span>
    </div>

    <!-- BAF-02 top-4 leaderboard -->
    <div class="play-baf-leaderboard">
      <div class="play-baf-header">
        <span>Rank</span><span>Player</span><span>Score</span>
      </div>
      <div class="play-baf-entries" data-bind="leaderboard-entries">
      </div>
    </div>

    <!-- BAF-01 your-rank row (hidden until INTEG-05 returns data in Wave 2) -->
    <div class="play-baf-your-rank" data-bind="your-rank" hidden>
      <span>You: rank </span>
      <span data-bind="your-rank-value">--</span>
      <span> of </span>
      <span data-bind="total-participants">--</span>
      <span> -- </span>
      <span data-bind="your-score">--</span>
    </div>
  </div>
</section>
`;

class BafPanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #bafFetchId = 0;
  #bafPlayerFetchId = 0;

  connectedCallback() {
    this.innerHTML = TEMPLATE;

    // Wave 1: BAF is level-scoped for the leaderboard; INTEG-05 per-player
    // refetches on both level AND player change.
    this.#unsubs.push(
      subscribe('replay.level',  () => { this.#refetchLeaderboard(); this.#refetchPlayer(); }),
      subscribe('replay.player', () => this.#refetchPlayer()),
    );

    // Kick initial fetches in case the store already has values.
    this.#refetchLeaderboard();
    this.#refetchPlayer();
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }

  // --- BAF-02 + BAF-03 partial fetch (leaderboard + context row) --------

  async #refetchLeaderboard() {
    const level = get('replay.level');
    const token = ++this.#bafFetchId;

    if (level == null) return;

    if (this.#loaded) {
      this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
    }

    try {
      const res = await fetch(`${API_BASE}/leaderboards/baf?level=${encodeURIComponent(level)}`);
      if (token !== this.#bafFetchId) return;
      const data = res.ok ? await res.json() : null;
      if (token !== this.#bafFetchId) return;

      const entries = Array.isArray(data?.entries) ? data.entries : [];

      this.#renderContext(level);
      this.#renderLeaderboard(entries, get('replay.player'));
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
    } catch (err) {
      if (token === this.#bafFetchId) {
        this.#renderContext(level);
        this.#renderLeaderboardError();
        this.#showContent();
        this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
      }
    }
  }

  // --- BAF-01 + BAF-03 roundStatus fetch (INTEG-05; 404-tolerant in Wave 1) -

  async #refetchPlayer() {
    const level = get('replay.level');
    const addr = get('replay.player');
    const token = ++this.#bafPlayerFetchId;

    if (level == null || !addr) return;

    try {
      const res = await fetch(`${API_BASE}/player/${addr}/baf?level=${encodeURIComponent(level)}`);
      if (token !== this.#bafPlayerFetchId) return;

      if (!res.ok) {
        // Wave 1: INTEG-05 not yet shipped in /home/zak/Dev/PurgeGame/database/.
        // Silent 404 tolerance. Wave 2 flips this to live rendering.
        // Fall back to inline roundStatus derivation for the pill.
        this.#renderRoundStatusFallback(level);
        return;
      }

      const data = await res.json();
      if (token !== this.#bafPlayerFetchId) return;

      this.#renderYourRank(data);
      this.#renderRoundStatus(data?.roundStatus);
    } catch (err) {
      if (token === this.#bafPlayerFetchId) {
        this.#renderRoundStatusFallback(level);
      }
    }
  }

  // --- Render helpers ---------------------------------------------------

  #bind(key) {
    return this.querySelector(`[data-bind="${key}"]`);
  }

  #renderContext(level) {
    const ctx = bafContext(level);

    this.setAttribute('data-prominence', ctx.prominence);

    const nextEl = this.#bind('next-baf-level');
    if (nextEl) {
      nextEl.textContent = ctx.isBafLevel
        ? `BAF Active! Level ${level}`
        : `Next BAF: Level ${ctx.nextBafLevel ?? '--'}`;
    }

    const levelsEl = this.#bind('levels-until');
    if (levelsEl) {
      if (ctx.isBafLevel)                  levelsEl.textContent = 'This level';
      else if (ctx.levelsUntilBaf != null) levelsEl.textContent = `${ctx.levelsUntilBaf} levels away`;
      else                                 levelsEl.textContent = '--';
    }
  }

  #renderLeaderboard(entries, selectedAddr) {
    const container = this.#bind('leaderboard-entries');
    if (!container) return;

    container.textContent = '';

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'play-baf-empty';
      const level = get('replay.level');
      empty.textContent = (level != null && level % 10 !== 0)
        ? 'BAF active only at every 10th level.'
        : 'No BAF activity at this level yet.';
      container.appendChild(empty);
      return;
    }

    const lowerSelected = selectedAddr ? selectedAddr.toLowerCase() : null;

    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'play-baf-entry';
      row.setAttribute('data-rank', String(entry.rank));

      if (lowerSelected && entry.player && entry.player.toLowerCase() === lowerSelected) {
        row.setAttribute('aria-current', 'true');
      }

      const rankCell = document.createElement('span');
      rankCell.textContent = `#${entry.rank}`;

      const playerCell = document.createElement('span');
      playerCell.className = 'play-baf-player';
      playerCell.textContent = truncateAddress(entry.player);

      // Score-unit discipline: BAF scores are WEI-scale BURNIE
      // (live sample level 20 rank 1 = "475215212469240581904067" = 475,215 BURNIE).
      // MUST formatBurnie; raw string would show ~475 sextillion in UI.
      const scoreCell = document.createElement('span');
      scoreCell.textContent = `${formatBurnie(entry.score)} BURNIE`;

      row.appendChild(rankCell);
      row.appendChild(playerCell);
      row.appendChild(scoreCell);
      container.appendChild(row);
    }
  }

  #renderLeaderboardError() {
    const container = this.#bind('leaderboard-entries');
    if (container) {
      container.textContent = '';
      const err = document.createElement('div');
      err.className = 'play-baf-empty';
      err.textContent = 'BAF leaderboard unavailable.';
      container.appendChild(err);
    }
  }

  #renderYourRank(data) {
    // Wave 1: data is null from the 404 branch; Wave 2 will populate.
    // Even in Wave 1 we handle the live-data case defensively in case the
    // endpoint ships early.
    const row = this.#bind('your-rank');
    if (!row) return;

    if (!data || data.rank == null) {
      row.hidden = true;
      return;
    }

    row.hidden = false;

    const rankEl = this.#bind('your-rank-value');
    if (rankEl) rankEl.textContent = String(data.rank);

    const totalEl = this.#bind('total-participants');
    if (totalEl) totalEl.textContent = String(data.totalParticipants ?? '--');

    // Score-unit: INTEG-05 score is WEI-scale -> formatBurnie.
    const scoreEl = this.#bind('your-score');
    if (scoreEl) {
      scoreEl.textContent = (data.score && data.score !== '0')
        ? `${formatBurnie(data.score)} BURNIE`
        : '0 BURNIE';
    }
  }

  #renderRoundStatus(status) {
    const pill = this.#bind('round-status');
    if (!pill) return;

    const LABELS = {
      open: 'OPEN',
      closed: 'CLOSED',
      skipped: 'SKIPPED',
      not_eligible: 'NOT ELIGIBLE',
    };

    pill.setAttribute('data-status', status ?? '');
    pill.textContent = LABELS[status] ?? '--';
  }

  #renderRoundStatusFallback(level) {
    // Wave 1 fallback when INTEG-05 404s. Correct in the simple case
    // (level % 10 !== 0 is definitively "not_eligible"; otherwise assume "open").
    // Wave 2 replaces with authoritative INTEG-05 response including
    // "skipped" and "closed" states.
    const status = (level != null && level % 10 === 0) ? 'open' : 'not_eligible';
    this.#renderRoundStatus(status);
  }

  #showContent() {
    const skeleton = this.querySelector('[data-bind="skeleton"]');
    const content = this.querySelector('[data-bind="content"]');
    if (skeleton) skeleton.hidden = true;
    if (content) content.hidden = false;
    this.#loaded = true;
  }
}

customElements.define('baf-panel', BafPanel);
