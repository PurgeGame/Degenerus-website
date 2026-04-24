// play/components/decimator-panel.js -- <decimator-panel> Custom Element (Phase 55 Waves 1+2)
//
// Hydrated decimator panel with conditional terminal sub-section. Data flow:
//   - DECIMATOR-01 window state + DECIMATOR-03 partial effective/weighted +
//     DECIMATOR-05 terminal burns + D-07 activity score cross-reference:
//     GET /player/:address?day=N (live pre-Phase-55; INTEG-02 shipped Phase 51).
//   - DECIMATOR-02 bucket + subbucket + DECIMATOR-03 full weighted amount +
//     DECIMATOR-04 winning subbucket + payout:
//     GET /player/:address/decimator?level=N&day=M (INTEG-03; Wave 2 live.
//     Wave 1 fetches but tolerates non-OK (404) via safe-degrade stub --
//     the bucket table still renders the correct range per bucketRange(level),
//     just without aria-current highlighting. Stats row shows placeholders.
//     Payout pill stays hidden. No code change between Wave 1 and Wave 2; the
//     endpoint just starts returning 200.)
//
// Sections (top to bottom, per 55-RESEARCH.md Section 10):
//   1. Header + window-status pill (DECIMATOR-01 / D-05) -- OPEN / CLOSED /
//      NOT ELIGIBLE. Wave 1 sources from decimator.windowOpen (binary); Wave 2
//      upgrades to 3-state via INTEG-03 roundStatus.
//      Time-remaining is OMITTED (the level-start timestamp is null in
//      play/ store per Pitfall 4 / Assumption A13).
//   2. Context row (D-07) -- "Activity score: X.XX" + "Level N" label.
//      Sourced from data.scoreBreakdown.totalBps (same path profile-panel uses).
//   3. Stats row (DECIMATOR-02/03) -- 4-cell grid: Bucket / Subbucket /
//      Effective burn / Weighted. Values from INTEG-03 (Wave 2). Wave 1
//      renders "--" placeholders in all four cells.
//   4. Bucket table (DECIMATOR-02 / D-03) -- 8 or 11 rows depending on
//      whether level is centennial. Player's row gets aria-current="true"
//      once INTEG-03 provides the bucket. NOTE: bucket range is 5-12 normal /
//      2-12 centennial per contract source (BurnieCoin.sol:142-147).
//      CONTEXT D-03 "1 through 8" is INCORRECT; see 55-PATTERNS.md CRITICAL
//      OVERRIDE.
//   5. Payout pill (DECIMATOR-04 / D-04 / Pitfall 10) -- 5 states:
//      closed+won     -> "You won X.XX ETH"                data-won="true"
//      closed+lost    -> "Not your subbucket"              data-won="false"
//      closed+no burn -> "You didn't burn at level N"      data-won="false"
//      open           -> "Round in progress"               data-won=""
//      not_eligible   -> "No decimator round at level N"   data-won=""
//   6. Terminal sub-section (DECIMATOR-05 / D-06 / Pitfall 3, CONDITIONAL) --
//      renders only when terminal != null AND terminal.burns.length > 0.
//      Hide the ENTIRE section (not just rows) when empty -- empty table
//      with headers looks like a stuck skeleton.
//
// Data flow (three subscriptions per D-08):
//   subscribe('replay.level')  --> #refetchLevel()                (INTEG-03 only)
//   subscribe('replay.player') --> #refetchPlayer() + #refetchLevel()
//   subscribe('replay.day')    --> #refetchPlayer() + #refetchLevel()
//
//   Two stale-guard counters (Pitfall 2):
//     #decimatorPlayerFetchId  -- bumped on extended-player refetch;
//                                 3 token checks (after fetch, after json)
//     #decimatorLevelFetchId   -- bumped on INTEG-03 refetch;
//                                 3 token checks
//
//   Only #refetchPlayer toggles is-stale dim (the extended-player fetch is
//   heavier; INTEG-03 is fast and double-dim would flicker). Matches
//   baf-panel's asymmetry (only #refetchLeaderboard dims).
//
// SECURITY (T-55-01): the innerHTML template is a static string with no
// user interpolation. All dynamic writes go through textContent or
// element.setAttribute. URL parameters are URL-encoded at the call site.
//
// SHELL-01: imports only from the wallet-free surface. The Wave 0 FORBIDDEN
// list (14 entries post-Phase-55) rejects beta/app/decimator.js (ethers at
// line 4), beta/app/terminal.js (ethers at line 6), beta/app/utils.js
// (ethers at line 3), beta/components/decimator-panel.js (existing; tag
// collision + transitively tainted), beta/components/terminal-panel.js
// (new; tag collision + transitively tainted), and ethers bare specifier.
//
// SCORE-UNIT DISCIPLINE (Pitfall 8):
//   effectiveAmount (BURNIE, wei-scale)     -> formatBurnie(value)
//   weightedAmount  (BURNIE, wei-scale)     -> formatBurnie(value)
//   terminal burn.effectiveAmount           -> formatBurnie(value)
//   terminal burn.weightedAmount            -> formatBurnie(value)
//   payoutAmount    (ETH, wei-scale)        -> formatEth(value)
//   bucket / subbucket / winningSubbucket   -> String(value) integer
//   scoreBreakdown.totalBps (int bps)       -> (v / 10000).toFixed(2)
//   burn.timeMultBps (int bps)              -> formatTimeMultiplier(v)

import { subscribe, get } from '../../beta/app/store.js';
import { API_BASE } from '../app/constants.js';
import { formatBurnie, formatEth, truncateAddress } from '../../beta/viewer/utils.js';

// --- Inline helpers -------------------------------------------------------
//
// Contract-truth bucket range (BurnieCoin.sol:142-147 -- OVERRIDES CONTEXT
// D-03 which incorrectly states the range as 1 through 8). 55-RESEARCH.md
// Pitfall 1 and 55-PATTERNS.md CRITICAL OVERRIDE document the discrepancy.
//
// Inlined per Phase 54's bafContext() decision: 40 LOC of pure derivation
// doesn't warrant a separate file, and keeping the constants colocated
// with the rendering code makes the contract-truth encoding obvious.

const DECIMATOR_BUCKET_BASE = 12;
const DECIMATOR_MIN_BUCKET_NORMAL = 5;
const DECIMATOR_MIN_BUCKET_100 = 2;

function bucketRange(level) {
  if (level == null) return [];
  const isCentennial = level > 0 && level % 100 === 0;
  const min = isCentennial ? DECIMATOR_MIN_BUCKET_100 : DECIMATOR_MIN_BUCKET_NORMAL;
  const max = DECIMATOR_BUCKET_BASE;
  // Returns [5, 6, 7, ..., 12] on normal levels (length 8) or
  // [2, 3, 4, ..., 12] on centennial levels (length 11).
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

// DECIMATOR-05 time-multiplier derivation -- mirrors beta/app/terminal.js:89-96
// (re-implemented inline per SHELL-01 / Wave 0 FORBIDDEN). Used by the
// terminal sub-section renderer. timeMultBps comes from the INTEG-02 terminal
// block in bps format (10000 = 1x).
function formatTimeMultiplier(timeMultBps) {
  if (timeMultBps == null || timeMultBps === 0) return '--';
  return (timeMultBps / 10000).toFixed(2) + 'x';
}

const TEMPLATE = `
<section data-slot="decimator" class="panel play-decimator-panel">

  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:60%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:120px"></div></div>
  </div>

  <div data-bind="content" hidden>

    <div class="panel-header">
      <h2 class="panel-title">Decimator</h2>
      <span class="play-decimator-window-badge" data-bind="window-status" data-status="">--</span>
    </div>

    <div class="play-decimator-context">
      <span data-bind="activity-score">Activity score: --</span>
      <span data-bind="level-label">Level --</span>
    </div>

    <div class="play-decimator-stats-row">
      <div class="stat">
        <div class="stat-label">Bucket</div>
        <div class="stat-value" data-bind="bucket">--</div>
      </div>
      <div class="stat">
        <div class="stat-label">Subbucket</div>
        <div class="stat-value" data-bind="subbucket">--</div>
      </div>
      <div class="stat">
        <div class="stat-label">Effective burn</div>
        <div class="stat-value" data-bind="effective">--</div>
      </div>
      <div class="stat">
        <div class="stat-label">Weighted</div>
        <div class="stat-value" data-bind="weighted">--</div>
      </div>
    </div>

    <div class="play-decimator-payout" data-bind="payout" data-won="" hidden>
      <span data-bind="payout-label">--</span>
      <span data-bind="payout-amount">--</span>
    </div>

    <div class="play-decimator-bucket-table" data-bind="bucket-table">
      <div class="play-decimator-bucket-header">
        <span>Bucket</span><span>Status</span><span>Winning sub</span>
      </div>
      <div data-bind="bucket-rows"></div>
    </div>

    <div class="play-terminal-section" data-bind="terminal-section" hidden>
      <h3>Terminal decimator</h3>
      <div class="play-terminal-burns">
        <div class="play-terminal-burns-header">
          <span>Level</span><span>Effective</span><span>Weighted</span><span>Multiplier</span>
        </div>
        <div data-bind="terminal-burn-rows"></div>
      </div>
    </div>

  </div>
</section>
`;

class DecimatorPanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #decimatorPlayerFetchId = 0;
  #decimatorLevelFetchId = 0;

  connectedCallback() {
    this.innerHTML = TEMPLATE;

    // Decimator is level-aware (bucket/subbucket/payout) AND day-aware
    // (activity score + terminal burns update per-day + INTEG-03 ?day=M
    // historical scoping). Three subscriptions cover the full cadence:
    //   replay.level  --> level-scoped INTEG-03 refetch
    //   replay.player --> both fetches (new player = everything updates)
    //   replay.day    --> both fetches (new day = activity score + terminal
    //                     burns + INTEG-03 block-scoping all shift)
    this.#unsubs.push(
      subscribe('replay.level',  () => this.#refetchLevel()),
      subscribe('replay.player', () => { this.#refetchPlayer(); this.#refetchLevel(); }),
      subscribe('replay.day',    () => { this.#refetchPlayer(); this.#refetchLevel(); }),
    );

    // Kick initial fetches in case the store already has values.
    this.#refetchPlayer();
    this.#refetchLevel();
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }

  // --- DECIMATOR-01 + DECIMATOR-05 + D-07 fetch (extended-player endpoint) ---
  // Day-scoped: refetches on replay.player OR replay.day change. The same
  // endpoint is already fetched by profile-panel (Phase 51) and coinflip-panel
  // (Phase 54); each panel gets its own stale-guard. Browsers coalesce the
  // HTTP requests so there is no performance concern.

  async #refetchPlayer() {
    const addr = get('replay.player');
    const day  = get('replay.day');
    const token = ++this.#decimatorPlayerFetchId;

    if (!addr || day == null) return;

    if (this.#loaded) {
      this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
    }

    try {
      const res = await fetch(
        `${API_BASE}/player/${addr}?day=${encodeURIComponent(day)}`,
      );
      if (token !== this.#decimatorPlayerFetchId) return;
      const data = res.ok ? await res.json() : null;
      if (token !== this.#decimatorPlayerFetchId) return;

      // DECIMATOR-01 binary open/closed badge (Wave 1). Wave 2's #refetchLevel
      // will upgrade to the 3-state roundStatus pill via #renderRoundStatus.
      this.#renderWindowStatus(data?.decimator?.windowOpen);
      // D-07 activity score cross-reference (Pitfall 14 null-guard).
      this.#renderActivityScore(data?.scoreBreakdown?.totalBps);
      this.#renderLevelLabel(get('replay.level'));
      // DECIMATOR-05 terminal sub-section (D-06 / Pitfall 3 -- hide ENTIRE
      // section when terminal === null OR burns.length === 0).
      this.#renderTerminalSection(data?.terminal);

      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
    } catch (err) {
      if (token === this.#decimatorPlayerFetchId) {
        this.#showContent();
        this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
      }
    }
  }

  // --- DECIMATOR-02 + DECIMATOR-03 (full) + DECIMATOR-04 fetch (INTEG-03) ---
  // Wave 1 ships this as a safe-degrade stub: on non-OK (404 pre-Wave-2)
  // the bucket table renders without aria-current, stats row shows placeholders,
  // payout pill hidden. Wave 2 requires NO code change -- the endpoint simply
  // starts returning 200.

  async #refetchLevel() {
    const addr  = get('replay.player');
    const level = get('replay.level');
    const day   = get('replay.day');
    const token = ++this.#decimatorLevelFetchId;

    if (!addr || level == null) return;

    try {
      const url = day != null
        ? `${API_BASE}/player/${addr}/decimator?level=${encodeURIComponent(level)}&day=${encodeURIComponent(day)}`
        : `${API_BASE}/player/${addr}/decimator?level=${encodeURIComponent(level)}`;
      const res = await fetch(url);
      if (token !== this.#decimatorLevelFetchId) return;

      if (!res.ok) {
        // INTEG-03 safe-degrade stub (Wave 1 pre-backend OR Wave 2 error path):
        // render bucket table WITHOUT aria-current, clear stats row placeholders,
        // hide payout pill. Wave 2 on 200 response upgrades these to live data.
        this.#renderBucketTable(level, null);
        this.#renderStatsRow(null);
        this.#renderPayout(null, level);
        return;
      }

      const data = await res.json();
      if (token !== this.#decimatorLevelFetchId) return;

      this.#renderBucketTable(level, data);       // DECIMATOR-02 / D-03
      this.#renderStatsRow(data);                 // DECIMATOR-02 / DECIMATOR-03
      this.#renderPayout(data, level);            // DECIMATOR-04 / Pitfall 10
      this.#renderRoundStatus(data?.roundStatus); // Upgrade D-05 badge from binary
    } catch (err) {
      if (token === this.#decimatorLevelFetchId) {
        this.#renderBucketTable(level, null);
        this.#renderStatsRow(null);
        this.#renderPayout(null, level);
      }
    }
  }

  // --- Render helpers -------------------------------------------------------

  #bind(key) {
    return this.querySelector(`[data-bind="${key}"]`);
  }

  #setText(key, value) {
    const el = this.#bind(key);
    if (el) el.textContent = value;
  }

  #showContent() {
    const skeleton = this.querySelector('[data-bind="skeleton"]');
    const content = this.querySelector('[data-bind="content"]');
    if (skeleton) skeleton.hidden = true;
    if (content) content.hidden = false;
    this.#loaded = true;
  }

  // DECIMATOR-01 / D-05 (Wave 1 binary state -- Wave 2 upgrades via
  // #renderRoundStatus below).
  #renderWindowStatus(windowOpen) {
    const pill = this.#bind('window-status');
    if (!pill) return;
    if (windowOpen == null) {
      pill.textContent = '--';
      pill.setAttribute('data-status', '');
      return;
    }
    pill.textContent = windowOpen ? 'OPEN' : 'CLOSED';
    pill.setAttribute('data-status', windowOpen ? 'open' : 'closed');
  }

  // Wave 2: INTEG-03 roundStatus is authoritative over windowOpen. Prefer it
  // when present (#refetchLevel calls this after #refetchPlayer has already
  // painted the binary state).
  #renderRoundStatus(status) {
    if (!status) return;
    const pill = this.#bind('window-status');
    if (!pill) return;
    const LABELS = {
      open: 'OPEN',
      closed: 'CLOSED',
      not_eligible: 'NOT ELIGIBLE',
    };
    pill.textContent = LABELS[status] ?? '--';
    pill.setAttribute('data-status', status);
  }

  // D-07 activity score cross-reference. Read scoreBreakdown.totalBps (bps
  // integer; divide by 10000 for decimal). Null-guard per Pitfall 14.
  #renderActivityScore(totalBps) {
    if (totalBps == null) {
      this.#setText('activity-score', 'Activity score: --');
      return;
    }
    this.#setText('activity-score', `Activity score: ${(totalBps / 10000).toFixed(2)}`);
  }

  #renderLevelLabel(level) {
    this.#setText('level-label', level != null ? `Level ${level}` : 'Level --');
  }

  // DECIMATOR-02 / DECIMATOR-03 stats row. Four cells: bucket, subbucket,
  // effective, weighted. Null-guard each cell independently per Pitfall 7.
  #renderStatsRow(data) {
    if (!data) {
      this.#setText('bucket', '--');
      this.#setText('subbucket', '--');
      this.#setText('effective', '--');
      this.#setText('weighted', '--');
      return;
    }
    this.#setText('bucket',    data.bucket    != null ? String(data.bucket)    : '--');
    this.#setText('subbucket', data.subbucket != null ? String(data.subbucket) : '--');
    // Score-unit discipline (Pitfall 8): effectiveAmount and weightedAmount
    // are WEI-scale BURNIE. formatBurnie handles both.
    this.#setText('effective',
      data.effectiveAmount && data.effectiveAmount !== '0'
        ? `${formatBurnie(data.effectiveAmount)} BURNIE`
        : '0');
    this.#setText('weighted',
      data.weightedAmount && data.weightedAmount !== '0'
        ? `${formatBurnie(data.weightedAmount)} BURNIE`
        : '0');
  }

  // DECIMATOR-02 / D-03 bucket table. Loops bucketRange(level) to produce
  // one row per possible bucket. Player's assigned bucket gets aria-current.
  // When `data` is null (pre-Wave-2 or INTEG-03 error), renders rows without
  // aria-current -- the bucket range itself is still correct because it
  // depends only on `level`.
  #renderBucketTable(level, data) {
    const container = this.#bind('bucket-rows');
    if (!container) return;

    container.textContent = '';

    const buckets = bucketRange(level);
    if (buckets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'play-decimator-empty';
      empty.textContent = 'No decimator activity (level not set).';
      container.appendChild(empty);
      return;
    }

    const playerBucket    = data?.bucket    ?? null;
    const playerSubBucket = data?.subbucket ?? null;
    const winningSub      = data?.winningSubbucket ?? null;
    const roundClosed     = data?.roundStatus === 'closed';

    for (const bucket of buckets) {
      const row = document.createElement('div');
      row.className = 'play-decimator-bucket-row';

      if (bucket === playerBucket) {
        row.setAttribute('aria-current', 'true');
        if (roundClosed && winningSub != null && playerSubBucket === winningSub) {
          row.setAttribute('data-winning', 'true');
        }
      }

      const bucketCell = document.createElement('span');
      bucketCell.textContent = String(bucket);
      row.appendChild(bucketCell);

      const statusCell = document.createElement('span');
      if (bucket === playerBucket && playerSubBucket != null) {
        statusCell.textContent = `Your subbucket: ${playerSubBucket}`;
      } else if (bucket === playerBucket) {
        statusCell.textContent = 'Your bucket';
      } else {
        statusCell.textContent = '--';
      }
      row.appendChild(statusCell);

      const winningCell = document.createElement('span');
      // Per RESEARCH Section 14 Q6: only show winning subbucket for the
      // player's bucket row (each bucket has its OWN winning subbucket, but
      // the player can only ever be in one bucket at this level).
      if (bucket === playerBucket && roundClosed && winningSub != null) {
        winningCell.textContent = `#${winningSub}`;
      } else {
        winningCell.textContent = '--';
      }
      row.appendChild(winningCell);

      container.appendChild(row);
    }
  }

  // DECIMATOR-04 payout pill (Pitfall 10 -- 5 states):
  //   closed + won      -> "You won X.XX ETH"              data-won="true"
  //   closed + lost     -> "Not your subbucket"            data-won="false"
  //   closed + no burn  -> "You didn't burn at level N"    data-won="false"
  //   open              -> "Round in progress"             data-won=""
  //   not_eligible      -> "No decimator round at level N" data-won=""
  #renderPayout(data, level) {
    const pill = this.#bind('payout');
    if (!pill) return;

    if (!data) {
      pill.hidden = true;
      pill.setAttribute('data-won', '');
      return;
    }

    pill.hidden = false;
    const labelEl  = this.#bind('payout-label');
    const amountEl = this.#bind('payout-amount');

    if (data.roundStatus === 'not_eligible') {
      pill.setAttribute('data-won', '');
      if (labelEl)  labelEl.textContent  = `No decimator round at level ${level}`;
      if (amountEl) amountEl.textContent = '';
      return;
    }

    if (data.roundStatus === 'open') {
      pill.setAttribute('data-won', '');
      if (labelEl)  labelEl.textContent  = 'Round in progress';
      if (amountEl) amountEl.textContent = '';
      return;
    }

    // roundStatus === 'closed' from here.
    if (data.bucket == null) {
      pill.setAttribute('data-won', 'false');
      if (labelEl)  labelEl.textContent  = `You didn't burn at level ${level}`;
      if (amountEl) amountEl.textContent = '';
      return;
    }

    // Score-unit discipline: payoutAmount is WEI-scale ETH, not BURNIE.
    if (data.payoutAmount && data.payoutAmount !== '0') {
      pill.setAttribute('data-won', 'true');
      if (labelEl)  labelEl.textContent  = 'You won';
      if (amountEl) amountEl.textContent = `${formatEth(data.payoutAmount)} ETH`;
      return;
    }

    pill.setAttribute('data-won', 'false');
    if (labelEl)  labelEl.textContent  = 'Not your subbucket';
    if (amountEl) amountEl.textContent = '';
  }

  // DECIMATOR-05 / D-06 terminal sub-section. Conditional on
  // terminal != null AND terminal.burns.length > 0. Per Pitfall 3, hide the
  // ENTIRE section (not just the rows) when no terminal activity -- do not
  // render an empty table with headers (looks like a stuck skeleton).
  #renderTerminalSection(terminal) {
    const section = this.#bind('terminal-section');
    if (!section) return;

    if (!terminal || !Array.isArray(terminal.burns) || terminal.burns.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    const container = this.#bind('terminal-burn-rows');
    if (!container) return;

    container.textContent = '';

    for (const burn of terminal.burns) {
      const row = document.createElement('div');
      row.className = 'play-terminal-burn-row';

      const levelCell = document.createElement('span');
      levelCell.textContent = String(burn.level ?? '--');
      row.appendChild(levelCell);

      // Score-unit discipline: terminal burn amounts are WEI-scale BURNIE.
      const effCell = document.createElement('span');
      effCell.textContent = burn.effectiveAmount && burn.effectiveAmount !== '0'
        ? formatBurnie(burn.effectiveAmount)
        : '0';
      row.appendChild(effCell);

      const weightedCell = document.createElement('span');
      weightedCell.textContent = burn.weightedAmount && burn.weightedAmount !== '0'
        ? formatBurnie(burn.weightedAmount)
        : '0';
      row.appendChild(weightedCell);

      const multCell = document.createElement('span');
      multCell.textContent = formatTimeMultiplier(burn.timeMultBps);
      row.appendChild(multCell);

      container.appendChild(row);
    }
  }
}

customElements.define('decimator-panel', DecimatorPanel);
