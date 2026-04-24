# Phase 54: Coinflip & BAF Leaderboards -- Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 9 (2 modify: coinflip-panel/baf-panel; 1 modify: play.css; 4 create: 2 tests + 1 INTEG spec + 1 shell-01 test edit; 1 optional create: leaderboards-fetch helper)
**Analogs found:** 8 / 9 (89% coverage -- exceeds 80% target)

## Analog Coverage Summary

| Coverage Tier | Count | Files |
|---------------|-------|-------|
| **Strong** (pattern fully transferable verbatim or near-verbatim) | 7 | coinflip-panel evolve + baf-panel evolve (Phase 51 profile-panel template); both test files (play-profile-panel.test.js template); INTEG-05-SPEC (INTEG-02-SPEC template); CSS extension (play.css prior-phase pattern); shell-01 FORBIDDEN edit (pattern already exists) |
| **Partial** (adaptation required beyond rename) | 1 | BAF prominence tier colors (D-06 is additive beyond beta's rank-1-only styling) |
| **Weak / scratch** (no direct analog) | 1 | Optional `play/app/leaderboards-fetch.js` (parallel to tickets-fetch.js but different cardinality -- each panel has its own endpoint; flagged as optional per RESEARCH Section 10) |

**Planner decision point:** `play/app/leaderboards-fetch.js` is tagged "optional" per RESEARCH Section 10 (lines 114-121) and the CSS Pitfall recommendation at line 1662. Phase 52's `tickets-fetch.js` dedups TWO panels hitting the SAME endpoint; Phase 54 has two panels hitting TWO DIFFERENT endpoints, so the dedup rationale doesn't apply. If planner wants Phase-52 symmetry, add a thin 30-LOC `leaderboards-fetch.js` exporting `fetchCoinflipLeaderboard(day)` + `fetchBafLeaderboard(level)`. If not, each panel does raw `fetch()`. My pattern assignment defaults to **skip** (simpler surface, zero wire-dedup benefit).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality | Confidence |
|-------------------|------|-----------|----------------|---------------|------------|
| `play/components/coinflip-panel.js` (MODIFY: Phase 50 stub -> Wave 1 hydrated) | UI Custom Element | request-response (day-aware fetch, parallel) | `play/components/profile-panel.js` (lines 151-415 shape) + `play/components/tickets-panel.js` (lines 40-191 list rendering) | strong (exact composite) | HIGH |
| `play/components/baf-panel.js` (MODIFY: Phase 50 stub -> Wave 1+2 hydrated) | UI Custom Element | request-response (level-aware fetch, dual-fetch Wave 1 + INTEG-05 Wave 2) | `play/components/profile-panel.js` (lines 151-415 shape) + `play/components/tickets-panel.js` (lines 40-191 list rendering) | strong (exact composite with +1 fetch-counter for INTEG-05) | HIGH |
| `play/app/leaderboards-fetch.js` (CREATE, OPTIONAL) | Shared fetch helper (no dedup benefit, symmetry only) | request-response (thin fetch wrappers) | `play/app/tickets-fetch.js` (lines 1-42 structure; inFlight dedup can be DROPPED since each call hits distinct endpoint) | weak / scratch if adopted | LOW-MEDIUM |
| `play/styles/play.css` (MODIFY: append ~130 LOC) | Stylesheet | CSS rules (prominence, leaderboard tables, bounty, round-status) | `play/styles/play.css` lines 372-471 (Phase 52 tickets-panel section precedent) + `beta/styles/baf.css` lines 1-80 (prominence source) | strong (extension of same file) | HIGH |
| `play/app/__tests__/play-coinflip-panel.test.js` (CREATE, ~25 assertions) | Contract-grep test | source regex assertions | `play/app/__tests__/play-profile-panel.test.js` (lines 1-184) + `play/app/__tests__/play-tickets-panel.test.js` (lines 1-193) | strong (exact template) | HIGH |
| `play/app/__tests__/play-baf-panel.test.js` (CREATE, ~25 assertions) | Contract-grep test | source regex assertions | `play/app/__tests__/play-profile-panel.test.js` (lines 1-184) + `play/app/__tests__/play-tickets-panel.test.js` (lines 1-193) | strong (exact template) | HIGH |
| `play/app/__tests__/play-shell-01.test.js` (MODIFY: add 3 FORBIDDEN entries) | SHELL-01 guardrail | array edit | `play/app/__tests__/play-shell-01.test.js` lines 22-31 (existing FORBIDDEN array -- same pattern) | strong (one-line surgery) | HIGH |
| `.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md` (CREATE) | Spec doc | endpoint contract | `.planning/phases/51-profile-quests/INTEG-02-SPEC.md` (lines 1-217) + `.planning/phases/52-tickets-packs-jackpot/INTEG-01-SPEC.md` | strong (literal template) | HIGH |
| `.planning/REQUIREMENTS.md` (MODIFY: mark INTEG-04 deferred) | Requirements register | status edit | none (single-line edit per D-10) | n/a | HIGH |

**Unchanged files (already correct from Phase 50):**
- `play/index.html` lines 54-55 already register `<coinflip-panel>` and `<baf-panel>` -- no change. Per CONTEXT D-02 Phase 54 pattern-matches beta, it does NOT import from beta/ so no index edit needed.

**Notable absence vs Phase 52:**
- No beta-patch needed (unlike D-09 in Phase 52 which required `beta/components/jackpot-panel.js:7` import swap). Phase 54 play/ components are evolved in place from stubs; nothing imports from beta/components/coinflip-panel.js or beta/components/baf-panel.js, so no beta-file surgery. CONTEXT D-02 + RESEARCH Section 6 confirm.

---

## Pattern Assignments

### `play/components/coinflip-panel.js` (Custom Element, request-response)

**Analog (primary):** `play/components/profile-panel.js` lines 151-415 (gold-standard hydrated panel shape)
**Analog (list rendering):** `play/components/tickets-panel.js` lines 77-137 (document.createElement row builder -- apply to leaderboard rows)

The Phase 50 stub at `play/components/coinflip-panel.js` (40 LOC) provides the skeleton subscribe scaffold; Wave 1 replaces the body with the composite below. Target LOC: ~220-260.

---

#### Pattern 1: Header comment + imports (COPY shape from profile-panel)

**Analog excerpt** (profile-panel.js lines 1-37):

```javascript
// play/components/profile-panel.js -- <profile-panel> Custom Element (Phase 51 Wave 2)
//
// Four-section hydrated markup + popover a11y wiring + render helpers +
// INTEG-02 fetch wiring with stale-response guard and keep-old-data-dim.
//
// ... (long header explaining sections, data flow, security, SHELL-01)

import { subscribe, get } from '../../beta/app/store.js';
import { API_BASE } from '../app/constants.js';
import { formatQuestTarget, getQuestProgress, QUEST_TYPE_LABELS } from '../app/quests.js';
```

**What to change when adapting for coinflip-panel.js:**
- Header: same shape, but list sections as (1) Bounty header (COINFLIP-03), (2) Player state (COINFLIP-01), (3) Leaderboard (COINFLIP-02).
- Imports:

```javascript
import { subscribe, get } from '../../beta/app/store.js';
import { API_BASE } from '../app/constants.js';
import { formatBurnie, truncateAddress } from '../../beta/viewer/utils.js';
// Optional: import { fetchCoinflipLeaderboard } from '../app/leaderboards-fetch.js';
```

**Gotcha:** Never import from `beta/components/coinflip-panel.js` (already in SHELL-01 FORBIDDEN list), `beta/app/coinflip.js` (ethers at line 4), or `beta/app/utils.js` (ethers at line 3). Use `beta/viewer/utils.js` which is explicitly wallet-free (header comment at line 2).

---

#### Pattern 2: TEMPLATE constant + class shell (COPY VERBATIM with binding renames)

**Analog excerpt** (profile-panel.js lines 39-155):

```javascript
const TEMPLATE = `
<section data-slot="profile" class="panel profile-panel">
  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:60%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:120px"></div></div>
  </div>
  <div data-bind="content" hidden>
    <!-- panel sections -->
  </div>
</section>`;

class ProfilePanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #profileFetchId = 0;
  // ...
}

customElements.define('profile-panel', ProfilePanel);
```

**Target TEMPLATE for coinflip-panel** (from RESEARCH.md Section 10 lines 899-949):

```html
<section data-slot="coinflip" class="panel play-coinflip-panel">
  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:60%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:80px"></div></div>
  </div>
  <div data-bind="content" hidden>
    <h2 class="panel-title">Coinflip</h2>

    <!-- COINFLIP-03 bounty -->
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
      <div class="play-coinflip-section-header">Player state</div>
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

    <!-- COINFLIP-02 leaderboard -->
    <div class="play-coinflip-leaderboard">
      <div class="play-coinflip-header">
        <span>Rank</span><span>Player</span><span>Score</span>
      </div>
      <div class="play-coinflip-entries" data-bind="leaderboard-entries">
        <!-- rows appended by #renderLeaderboard -->
      </div>
    </div>
  </div>
</section>
```

**What to change when adapting:**
- Rename `#profileFetchId` to `#coinflipFetchId` (Wave 0 test asserts this literal identifier at line ~1291 of RESEARCH).
- All 7 data-bind keys (`armed`, `bounty-pool`, `bounty-record`, `bounty-holder`, `deposited`, `claimable`, `autorebuy`, `takeprofit`, `leaderboard-entries`) are explicitly asserted by Wave 0 test greps (RESEARCH Section 12 test outline, lines 1254-1283).

---

#### Pattern 3: Stale-guard fetch with double token check (COPY + EXTEND to parallel fetch)

**Analog excerpt** (profile-panel.js lines 327-365):

```javascript
async #refetch() {
  const addr = get('replay.player');
  const day = get('replay.day');
  const token = ++this.#profileFetchId;

  if (!addr || day == null) return;

  if (this.#loaded) {
    this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
  }

  try {
    const res = await fetch(
      `${API_BASE}/player/${addr}?day=${encodeURIComponent(day)}`,
    );
    if (token !== this.#profileFetchId) return;
    if (!res.ok) {
      this.#renderError(res.status);
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
      return;
    }
    const data = await res.json();
    if (token !== this.#profileFetchId) return;
    this.#renderAll(data);
    this.#showContent();
    this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
  } catch (err) {
    if (token === this.#profileFetchId) {
      this.#renderError(0);
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
    }
  }
}
```

**Target shape for coinflip-panel** (from RESEARCH Section 11 lines 1055-1092): TWO parallel fetches with THREE stale-guard checks:

```javascript
async #refetch() {
  const addr = get('replay.player');
  const day = get('replay.day');
  const token = ++this.#coinflipFetchId;

  if (!addr || day == null) return;

  if (this.#loaded) {
    this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
  }

  try {
    // Parallel fetches: /player for state+bounty, /leaderboards/coinflip for list.
    const [playerRes, lbRes] = await Promise.all([
      fetch(`${API_BASE}/player/${addr}?day=${encodeURIComponent(day)}`),
      fetch(`${API_BASE}/leaderboards/coinflip?day=${encodeURIComponent(day)}`),
    ]);
    if (token !== this.#coinflipFetchId) return;

    const playerData = playerRes.ok ? await playerRes.json() : null;
    if (token !== this.#coinflipFetchId) return;
    const lbData = lbRes.ok ? await lbRes.json() : null;
    if (token !== this.#coinflipFetchId) return;

    this.#renderBounty(playerData?.coinflip);
    this.#renderState(playerData?.coinflip);
    this.#renderLeaderboard(lbData?.entries ?? []);
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
```

**Key differences vs profile-panel:**
1. `Promise.all` for parallel fetches (state endpoint + leaderboard endpoint).
2. Graceful partial failure (leaderboard 404 doesn't nuke the bounty section -- each response nulls independently).
3. THREE stale-guard checks (post-Promise.all, post-player-json, post-lb-json) per RESEARCH Pitfall 1.
4. The `catch` arm uses `token === this.#coinflipFetchId` (equality, NOT `!==`) -- preserve polarity per Gotcha in 51-PATTERNS.md line 73.

---

#### Pattern 4: Skeleton -> content swap via `#showContent()` (COPY VERBATIM)

**Analog excerpt** (profile-panel.js lines 192-198):

```javascript
#showContent() {
  if (this.#loaded) return;
  this.#loaded = true;
  this.querySelector('[data-bind="skeleton"]')?.remove();
  const el = this.querySelector('[data-bind="content"]');
  if (el) el.hidden = false;
}
```

**What to change when adapting:** Nothing. Copy verbatim into coinflip-panel.

---

#### Pattern 5: Subscription wiring (MIRROR from profile-panel -- day + player only, NOT level)

**Analog excerpt** (profile-panel.js lines 157-174):

```javascript
connectedCallback() {
  this.innerHTML = TEMPLATE;
  this.#bindPopover();

  this.#unsubs.push(
    subscribe('replay.day', () => this.#refetch()),
    subscribe('replay.player', () => this.#refetch()),
  );

  this.#refetch();
}

disconnectedCallback() {
  this.#unsubs.forEach((fn) => fn());
  this.#unsubs = [];
}
```

**What to change when adapting:**
- Drop the `#bindPopover()` call (coinflip panel has no popover).
- Keep the TWO subscribes -- DO NOT add `replay.level` (coinflip is day-scoped per RESEARCH Section 10 line 960 and CONTEXT D-07). Unlike tickets-panel which needs level, coinflip leaderboard is `/leaderboards/coinflip?day=N`.

---

#### Pattern 6: Render helpers (ADAPT from profile-panel's `#renderStreak`, `#renderDailyActivity` + tickets-panel's `#renderCards`)

**Analog for simple row binding** (profile-panel.js lines 252-265 -- `#renderStreak`):

```javascript
#renderStreak(questStreak) {
  if (!questStreak) {
    this.#bind('base-streak', '--');
    this.#bind('last-completed-day', '--');
    return;
  }
  this.#bind('base-streak', String(questStreak.baseStreak ?? '--'));
  this.#bind(
    'last-completed-day',
    questStreak.lastCompletedDay != null
      ? 'day ' + questStreak.lastCompletedDay
      : '--',
  );
}
```

Plus `#bind` helper (profile-panel.js lines 187-190):

```javascript
#bind(key, value) {
  const el = this.querySelector(`[data-bind="${key}"]`);
  if (el) el.textContent = value;
}
```

**Target for coinflip `#renderBounty` / `#renderState`:**

```javascript
#renderBounty(cf) {
  if (!cf) {
    this.#bind('armed', 'NOT ARMED');
    const armedEl = this.querySelector('[data-bind="armed"]');
    if (armedEl) armedEl.setAttribute('data-armed', 'false');
    this.#bind('bounty-pool', '0');
    this.#bind('bounty-record', '--');
    this.#bind('bounty-holder', '--');
    return;
  }
  const armed = cf.currentBounty && cf.currentBounty !== '0';
  const armedEl = this.querySelector('[data-bind="armed"]');
  if (armedEl) {
    armedEl.textContent = armed ? 'ARMED' : 'NOT ARMED';
    armedEl.setAttribute('data-armed', armed ? 'true' : 'false');
  }
  this.#bind('bounty-pool', armed ? formatBurnie(cf.currentBounty) : '0');
  // Pitfall 7: biggestFlipPlayer may be null even when bounty > 0
  this.#bind('bounty-record', cf.biggestFlipAmount && cf.biggestFlipAmount !== '0'
    ? formatBurnie(cf.biggestFlipAmount) : '--');
  this.#bind('bounty-holder', cf.biggestFlipPlayer
    ? truncateAddress(cf.biggestFlipPlayer) : '--');
}

#renderState(cf) {
  if (!cf) {
    this.#bind('deposited', '0');
    this.#bind('claimable', '0');
    this.#bind('autorebuy', '--');
    this.#bind('takeprofit', '--');
    return;
  }
  // Pitfall 8: deposited/claimable/autoRebuyStop are wei-encoded BURNIE; formatBurnie handles.
  this.#bind('deposited', formatBurnie(cf.depositedAmount));
  this.#bind('claimable', formatBurnie(cf.claimablePreview));
  this.#bind('autorebuy', cf.autoRebuyEnabled ? 'on' : 'off');
  this.#bind('takeprofit', cf.autoRebuyStop && cf.autoRebuyStop !== '0'
    ? formatBurnie(cf.autoRebuyStop) + ' BURNIE' : 'no limit');
}
```

**Analog for leaderboard row loop** (tickets-panel.js lines 77-137 -- `#renderCards` + `#buildCardNode`):

```javascript
#renderCards(cards) {
  const grid = this.querySelector('[data-bind="card-grid"]');
  if (!grid) return;

  const opened = Array.isArray(cards) ? cards.filter((c) => c && c.status === 'opened') : [];

  while (grid.firstChild) grid.removeChild(grid.firstChild);

  if (opened.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tickets-empty';
    empty.textContent = 'No tickets at this level.';
    grid.appendChild(empty);
    return;
  }

  for (const card of opened) {
    grid.appendChild(this.#buildCardNode(card));
  }
}
```

**Target for coinflip `#renderLeaderboard`** (uses document.createElement + textContent to stay safe per T-51-01 security rule):

```javascript
#renderLeaderboard(entries) {
  const container = this.querySelector('[data-bind="leaderboard-entries"]');
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);

  if (!Array.isArray(entries) || entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'play-coinflip-empty';
    const day = get('replay.day');
    empty.textContent = `No coinflip activity for day ${day ?? '--'}.`;
    container.appendChild(empty);
    return;
  }

  const selectedPlayer = (get('replay.player') || '').toLowerCase();
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'play-coinflip-entry';
    if (entry.player && entry.player.toLowerCase() === selectedPlayer) {
      row.setAttribute('aria-current', 'true');
    }

    const rankCell = document.createElement('span');
    rankCell.textContent = `#${entry.rank}`;
    row.appendChild(rankCell);

    const playerCell = document.createElement('span');
    playerCell.className = 'play-coinflip-player';
    playerCell.textContent = truncateAddress(entry.player || '');
    row.appendChild(playerCell);

    const scoreCell = document.createElement('span');
    // Pitfall 8: coinflip score is integer-scale BURNIE (verified via live data
    // at day=64: scores are 10^4 - 10^5, NOT wei-scale). Use String() directly;
    // do NOT pipe through formatBurnie (which divides by 10^18).
    scoreCell.textContent = String(entry.score ?? '0');
    row.appendChild(scoreCell);

    container.appendChild(row);
  }
}
```

**Gotcha (Pitfall 8 from RESEARCH line 1517):** coinflip scores from `/leaderboards/coinflip` are integer-scale (not wei). BAF scores ARE wei-scale. The render functions for the two panels use DIFFERENT score formatters. Wave 1 Task 1 should verify the emit site in `DegenerusCoinflip.sol` to confirm. Default to `String(entry.score)` for coinflip; default to `formatBurnie(entry.score)` for BAF.

**Gotcha (Pitfall 7):** `biggestFlipPlayer` can be null even when `currentBounty > 0` (verified in live data -- RESEARCH line 318). Guard with `cf.biggestFlipPlayer ? truncateAddress(cf.biggestFlipPlayer) : '--'` to avoid rendering literal "null".

---

### `play/components/baf-panel.js` (Custom Element, level-aware request-response)

**Analog (primary):** `play/components/profile-panel.js` lines 151-415 (gold-standard hydrated panel shape)
**Analog (dual-fetch counter pattern):** NEW for Phase 54 -- two independent fetch-id counters (one for leaderboard, one for per-player INTEG-05); closest shape is profile-panel but profile-panel has only one.

The Phase 50 stub at `play/components/baf-panel.js` (40 LOC) provides the skeleton scaffold. Wave 1 + Wave 2 evolve to ~240-280 LOC.

---

#### Pattern 1: Header + imports (same shape as coinflip-panel; see above)

```javascript
import { subscribe, get } from '../../beta/app/store.js';
import { API_BASE } from '../app/constants.js';
import { formatBurnie, truncateAddress } from '../../beta/viewer/utils.js';
```

---

#### Pattern 2: TEMPLATE (COPY shape from RESEARCH Section 10 lines 971-1003)

Target TEMPLATE for baf-panel:

```html
<section data-slot="baf" class="panel play-baf-panel" data-prominence="low">
  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:50%"></div></div>
    <div class="skeleton-row">
      <div class="skeleton-block skeleton-shimmer" style="width:48px;height:28px"></div>
      <div class="skeleton-block skeleton-shimmer" style="width:48px;height:28px"></div>
      <div class="skeleton-block skeleton-shimmer" style="width:48px;height:28px"></div>
      <div class="skeleton-block skeleton-shimmer" style="width:48px;height:28px"></div>
    </div>
  </div>
  <div data-bind="content" hidden>
    <h2 class="panel-title">BAF Leaderboard</h2>

    <!-- BAF-03 context + round status -->
    <div class="play-baf-context">
      <span data-bind="next-baf-level">Next BAF: Level --</span>
      <span data-bind="levels-until">-- levels away</span>
      <span class="play-baf-round-status" data-bind="round-status" data-status="">--</span>
    </div>

    <!-- BAF-02 leaderboard -->
    <div class="play-baf-leaderboard">
      <div class="play-baf-header">
        <span>Rank</span><span>Player</span><span>Score</span>
      </div>
      <div class="play-baf-entries" data-bind="leaderboard-entries">
        <!-- rows appended by #renderLeaderboard with data-rank="1..4" -->
      </div>
    </div>

    <!-- BAF-01 your rank (hydrated from INTEG-05 in Wave 2) -->
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
```

**Wave 0 test greps:** all 8 data-bind keys (`next-baf-level`, `levels-until`, `round-status`, `leaderboard-entries`, `your-rank`, `your-rank-value`, `total-participants`, `your-score`) are asserted by the Wave 0 test (RESEARCH lines 1368-1397). Plus `data-rank`, `data-status`, `data-prominence` attributes.

---

#### Pattern 3: Dual fetch-counter pattern (NOVEL for Phase 54; closest analog is profile-panel's single counter)

**Analog excerpt** (profile-panel.js lines 151-155):

```javascript
class ProfilePanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #popoverAbort = null;
  #profileFetchId = 0;
  // ...
}
```

**Target for baf-panel** (TWO counters per RESEARCH Section 11 lines 1103-1153):

```javascript
class BafPanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #bafFetchId = 0;            // BAF-02 + BAF-03 leaderboard fetch
  #bafPlayerFetchId = 0;      // BAF-01 INTEG-05 per-player fetch (Wave 2)
```

**Why two counters:** The two fetches run at DIFFERENT cadences:
- Leaderboard (`/leaderboards/baf?level=N`) refetches on `replay.level` change only.
- Per-player (`/player/:addr/baf?level=N`) refetches on BOTH `replay.level` AND `replay.player` change.

Using one counter would mean a player-change would invalidate a still-valid leaderboard response. Two counters keep each fetch path's staleness independent.

**Wave 0 test asserts BOTH identifiers** (RESEARCH lines 1405, 1409).

---

#### Pattern 4: Two refetch methods + subscription wiring (MIRROR profile-panel with split)

**Analog excerpt** (profile-panel.js lines 157-174):

```javascript
connectedCallback() {
  this.innerHTML = TEMPLATE;
  this.#unsubs.push(
    subscribe('replay.day', () => this.#refetch()),
    subscribe('replay.player', () => this.#refetch()),
  );
  this.#refetch();
}
```

**Target for baf-panel** (RESEARCH Section 11 lines 1164-1178):

```javascript
connectedCallback() {
  this.innerHTML = TEMPLATE;
  this.#unsubs.push(
    subscribe('replay.level', () => {
      this.#refetchLeaderboard();
      this.#refetchPlayer();
    }),
    subscribe('replay.player', () => this.#refetchPlayer()),
  );
  this.#refetchLeaderboard();
  this.#refetchPlayer();
}
```

**#refetchLeaderboard shape** (mirrors profile-panel.js #refetch with level substitution):

```javascript
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
    if (!res.ok) {
      this.#renderContext(level);                  // still render the level/prominence label
      this.#renderLeaderboard([]);                 // empty state
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
      return;
    }
    const data = await res.json();
    if (token !== this.#bafFetchId) return;
    this.#renderContext(level);
    this.#renderLeaderboard(data?.entries ?? []);
    this.#showContent();
    this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
  } catch (err) {
    if (token === this.#bafFetchId) {
      this.#renderContext(level);
      this.#renderLeaderboard([]);
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
    }
  }
}
```

**#refetchPlayer shape** (Wave 1 defines as no-op on 404; Wave 2 flips to live INTEG-05):

```javascript
async #refetchPlayer() {
  const level = get('replay.level');
  const addr = get('replay.player');
  const token = ++this.#bafPlayerFetchId;
  if (level == null || !addr) return;

  try {
    const res = await fetch(`${API_BASE}/player/${addr}/baf?level=${encodeURIComponent(level)}`);
    if (token !== this.#bafPlayerFetchId) return;
    if (!res.ok) return;                           // Wave 1 no-op on 404 (INTEG-05 not shipped)
    const data = await res.json();
    if (token !== this.#bafPlayerFetchId) return;
    this.#renderYourRank(data);
    this.#renderRoundStatus(data?.roundStatus);
  } catch {
    // Non-critical -- leaderboard has its own path; silent failure OK.
  }
}
```

**Wave 2 gate** (RESEARCH Open Q7 lines 1567-1570): Wave 1 ships `#refetchPlayer` with the 404-silent fallback. Wave 2 is "no code change" in many panels because the method is already there; Wave 2's work is (a) verify INTEG-05 shipped and (b) run manual UAT to confirm the your-rank row populates.

---

#### Pattern 5: bafContext logic -- INLINE, DO NOT IMPORT (wallet-taint)

**Analog excerpt** (beta/app/baf.js lines 53-68 -- REFERENCE ONLY, DO NOT IMPORT):

```javascript
export function bafContext(level) {
  const nextBafLevel = Math.ceil((level + 1) / 10) * 10;
  const levelsUntilBaf = nextBafLevel - level;
  const isBafLevel = level > 0 && level % 10 === 0;

  let prominence;
  if (levelsUntilBaf <= 3) {
    prominence = 'high';
  } else if (levelsUntilBaf <= 7) {
    prominence = 'medium';
  } else {
    prominence = 'low';
  }

  return { nextBafLevel, levelsUntilBaf, isBafLevel, prominence };
}
```

**Target in baf-panel.js** (per RESEARCH Section 5 line 123 recommendation -- inline; don't create a separate file):

```javascript
#renderContext(level) {
  if (level == null) return;
  // bafContext logic inlined per RESEARCH Section 5 -- avoids creating a
  // one-function helper file, keeps logic locally readable.
  const nextBafLevel = Math.ceil((level + 1) / 10) * 10;
  const levelsUntilBaf = nextBafLevel - level;
  const isBafLevel = level > 0 && level % 10 === 0;
  const prominence = levelsUntilBaf <= 3 ? 'high'
                   : levelsUntilBaf <= 7 ? 'medium'
                   : 'low';

  this.dataset.prominence = prominence;           // panel-level prominence via attribute
  this.#bind('next-baf-level', isBafLevel ? 'BAF Active!' : `Next BAF: Level ${nextBafLevel}`);
  this.#bind('levels-until', isBafLevel ? 'This level!'
    : `${levelsUntilBaf} level${levelsUntilBaf !== 1 ? 's' : ''} away`);
}
```

**Wave 0 test asserts** `Math.ceil((level + 1) / 10)` literal (RESEARCH line 1427).

**Why NOT a separate `play/app/baf.js` file:** The function is 4 lines of arithmetic; RESEARCH line 123 recommends inline. Extract later if future phases reuse the logic.

---

#### Pattern 6: Leaderboard row loop with rank-tier attribute (ADAPT from tickets-panel #buildCardNode)

**Analog excerpt** (tickets-panel.js lines 100-137 -- document.createElement row pattern):

```javascript
#buildCardNode(card) {
  const cardEl = document.createElement('div');
  cardEl.className = 'ticket-card';
  cardEl.setAttribute('data-card-index', String(card.cardIndex));
  // ... quadrants, img elements, pill
  return cardEl;
}
```

**Target for baf `#renderLeaderboard`** (rank-tier via data-rank attribute + aria-current highlight):

```javascript
#renderLeaderboard(entries) {
  const container = this.querySelector('[data-bind="leaderboard-entries"]');
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);

  if (!Array.isArray(entries) || entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'play-baf-empty';
    empty.textContent = 'BAF round not yet live.';
    container.appendChild(empty);
    return;
  }

  const selectedPlayer = (get('replay.player') || '').toLowerCase();
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'play-baf-entry';
    row.setAttribute('data-rank', String(entry.rank));   // D-06 tier coloring via CSS
    if (entry.player && entry.player.toLowerCase() === selectedPlayer) {
      row.setAttribute('aria-current', 'true');
    }

    const rankCell = document.createElement('span');
    rankCell.textContent = `#${entry.rank}`;
    row.appendChild(rankCell);

    const playerCell = document.createElement('span');
    playerCell.className = 'play-baf-player';
    playerCell.textContent = truncateAddress(entry.player || '');
    row.appendChild(playerCell);

    const scoreCell = document.createElement('span');
    // Pitfall 8: BAF scores ARE wei-scale BURNIE (verified at level=20, scores
    // are 10^22 order). formatBurnie divides by 10^18 and returns a compact display.
    scoreCell.textContent = formatBurnie(entry.score) + ' BURNIE';
    row.appendChild(scoreCell);

    container.appendChild(row);
  }
}
```

**Gotcha:** Per CONTEXT D-06, BAF uses per-row rank tiers (gold rank 1, silver rank 2, bronze rank 3, regular rank 4). CSS consumes the `data-rank="N"` attribute. Beta's CSS only styles rank 1 (via `:nth-child(1)`); Phase 54 ADDS styling for ranks 2-4 (see Pattern 3 in `play/styles/play.css` section below).

---

#### Pattern 7: Your-rank row render (NEW for Phase 54 -- no direct analog)

**Target for baf `#renderYourRank` and `#renderRoundStatus`:**

```javascript
#renderYourRank(data) {
  const row = this.querySelector('[data-bind="your-rank"]');
  if (!row) return;
  if (!data || data.rank == null) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  this.#bind('your-rank-value', String(data.rank));
  this.#bind('total-participants', String(data.totalParticipants ?? '--'));
  this.#bind('your-score', data.score && data.score !== '0'
    ? formatBurnie(data.score) + ' BURNIE' : '0 BURNIE');
}

#renderRoundStatus(status) {
  const el = this.querySelector('[data-bind="round-status"]');
  if (!el) return;
  const label = {
    open: 'OPEN',
    closed: 'CLOSED',
    skipped: 'SKIPPED',
    not_eligible: 'NOT ELIGIBLE',
  }[status] || '--';
  el.textContent = label;
  el.setAttribute('data-status', status || '');
}
```

**Gotcha:** `data.rank === null` means the player has no row in `baf_flip_totals` (e.g., they haven't staked at this level). Hide the row entirely rather than rendering `"rank null of 42"`. Matches INTEG-05 spec lines 374-380 edge cases.

---

### `play/styles/play.css` (MODIFY: append Phase 54 section ~130 LOC)

**Analog (prior-phase precedent):** `play/styles/play.css` lines 372-471 (Phase 52 `<tickets-panel>` section) -- extends the existing file with a new header-comment-delimited section.

**Analog (source of prominence + leaderboard grid rules):** `beta/styles/baf.css` lines 1-80 (entire file enumerated below).

---

#### Pattern 1: Append-new-section convention (COPY HEADER SHAPE)

**Analog excerpt** (play.css lines 372-377 -- Phase 52 section header):

```css
/* ======================================================================
   Phase 52 -- <tickets-panel> styles
   Dense card grid (D-01): ~140px cards, 2x2 trait SVG grid per card.
   Reuses skeleton.css + panels.css tokens. Borrows sizing conventions
   from beta/styles/replay.css .replay-tq .badge-img.
   ====================================================================== */
```

**Target header for Phase 54:**

```css
/* ======================================================================
   Phase 54 -- <coinflip-panel> + <baf-panel> styles
   Read-only leaderboard panels with rank-tier prominence (BAF) + bounty
   armed pulse (coinflip). Mirrors beta/styles/baf.css line-by-line for
   the leaderboard grid; adds D-06 tier colors (gold/silver/bronze)
   beyond beta's rank-1-only styling. Reuses skeleton.css tokens.
   ====================================================================== */
```

---

#### Pattern 2: BAF panel prominence + leaderboard (COPY FROM beta/styles/baf.css with `.play-baf-*` rename)

**Analog excerpt** (beta/styles/baf.css lines 1-80 -- full file; copy entire essence):

```css
.baf-panel {
  transition: border-color 0.3s ease;
}
.baf-panel[data-prominence="high"] {
  border-color: var(--accent-primary);
  border-width: 2px;
}
.baf-panel[data-prominence="medium"] {
  border-color: var(--text-secondary);
}
.baf-panel[data-prominence="low"] {
  opacity: 0.8;
}

.baf-context {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 0.75rem;
}

.baf-header,
.baf-entry {
  display: grid;
  grid-template-columns: 50px 1fr 100px;
  padding: 0.5rem 0.75rem;
}
.baf-header {
  background: var(--bg-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 600;
}
.baf-entry {
  border-top: 1px solid var(--border-color);
  font-size: 0.85rem;
}
.baf-entry:nth-child(1) {                       /* ONLY rank 1 in beta */
  color: var(--accent-primary);
  font-weight: 600;
}
```

**Target in play.css** (RESEARCH Section 9 lines 665-808): the same rules under a `.play-baf-panel` scope PLUS D-06 additive rank-2/3/4 tiers:

```css
/* --- BAF panel (Phase 54) --- */

.play-baf-panel {
  transition: border-color 0.3s ease;
}
.play-baf-panel[data-prominence="high"] {
  border-color: var(--accent-primary);
  border-width: 2px;
}
.play-baf-panel[data-prominence="medium"] {
  border-color: var(--text-secondary);
}
.play-baf-panel[data-prominence="low"] {
  opacity: 0.8;
}

.play-baf-context {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 0.75rem;
}

.play-baf-leaderboard {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
}
.play-baf-header,
.play-baf-entry {
  display: grid;
  grid-template-columns: 50px 1fr 100px;
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
}
.play-baf-header {
  background: var(--bg-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 600;
}
.play-baf-entry {
  border-top: 1px solid var(--border-color);
}

/* --- D-06 tier colors (NEW relative to beta) --- */
.play-baf-entry[data-rank="1"] {
  color: #FFD700;                       /* gold */
  font-weight: 700;
  font-size: 0.95rem;
}
.play-baf-entry[data-rank="2"] {
  color: #C0C0C0;                       /* silver */
  font-weight: 600;
}
.play-baf-entry[data-rank="3"] {
  color: #CD7F32;                       /* bronze */
  font-weight: 600;
}
.play-baf-entry[data-rank="4"] {
  color: var(--text-primary);
  font-weight: 500;
}

.play-baf-entry[aria-current="true"] {
  background: var(--bg-tertiary);
  text-decoration: underline;
}

.play-baf-your-rank {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  border-radius: 6px;
  border: 1px solid var(--accent-primary);
}

.play-baf-round-status {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
}
.play-baf-round-status[data-status="open"] {
  background: rgba(34, 197, 94, 0.15);
  color: var(--success);
}
.play-baf-round-status[data-status="closed"] {
  background: rgba(100, 100, 100, 0.2);
  color: var(--text-dim);
}
.play-baf-round-status[data-status="skipped"] {
  background: rgba(239, 68, 68, 0.15);
  color: var(--error);
}
.play-baf-round-status[data-status="not_eligible"] {
  background: rgba(100, 100, 100, 0.1);
  color: var(--text-dim);
}

.play-baf-player {
  font-family: monospace;
  font-size: 0.8rem;
}
.play-baf-empty {
  padding: 1rem;
  text-align: center;
  color: var(--text-dim);
  font-size: 0.85rem;
}

.play-baf-panel [data-bind="content"] {
  transition: opacity 0.2s ease;
}
.play-baf-panel [data-bind="content"].is-stale {
  opacity: 0.6;
  pointer-events: none;
}
```

**Gotcha (Pitfall 8 from RESEARCH line 1517):** DO NOT reuse beta's `.baf-panel` class name unscoped -- the play tree's CSS would cascade conflicts with any embedded beta components. Keep the `.play-*` scope throughout.

---

#### Pattern 3: Coinflip panel styles (ADAPT from Phase 52 tickets-panel pattern)

**Analog excerpt** (play.css lines 386-472 -- tickets-panel follows a similar leaderboard-like grid):

```css
.tickets-panel .tickets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.75rem;
  min-height: 140px;
}
```

**Target for coinflip** (RESEARCH Section 9 lines 811-877):

```css
/* --- Coinflip panel (Phase 54) --- */

.play-coinflip-bounty {
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin-bottom: 1rem;
  background: var(--bg-secondary);
}
.play-coinflip-bounty-armed {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  background: rgba(100, 100, 100, 0.2);
  color: var(--text-dim);
}
.play-coinflip-bounty-armed[data-armed="true"] {
  background: rgba(239, 68, 68, 0.15);
  color: var(--error);
  animation: armed-pulse 2s ease-in-out infinite;
}

@keyframes armed-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.play-coinflip-leaderboard {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
}
.play-coinflip-header,
.play-coinflip-entry {
  display: grid;
  grid-template-columns: 50px 1fr 120px;
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
}
.play-coinflip-header {
  background: var(--bg-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 600;
}
.play-coinflip-entry {
  border-top: 1px solid var(--border-color);
}
.play-coinflip-entry[aria-current="true"] {
  background: var(--bg-tertiary);
  font-weight: 600;
  text-decoration: underline;
}
.play-coinflip-player {
  font-family: monospace;
  font-size: 0.8rem;
}
.play-coinflip-state-row {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
  font-size: 0.85rem;
}
.play-coinflip-empty {
  padding: 1rem;
  text-align: center;
  color: var(--text-dim);
  font-size: 0.85rem;
}

.play-coinflip-panel [data-bind="content"] {
  transition: opacity 0.2s ease;
}
.play-coinflip-panel [data-bind="content"].is-stale {
  opacity: 0.6;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .play-coinflip-bounty-armed[data-armed="true"] {
    animation: none;
  }
}
```

**Gotcha:** The `@keyframes armed-pulse` is defined in `beta/styles/coinflip.css:166-169` but NOT linked from `play/index.html` (verified: `play/index.html` links base, panels, buttons, skeleton, viewer, jackpot, play -- NOT coinflip). Copy the 3 lines into `play.css` directly per RESEARCH line 882 recommendation. This keeps play/ self-contained without adding a CSS link to beta.

---

### `play/app/__tests__/play-coinflip-panel.test.js` (contract-grep test) -- CREATE

**Analog:** `play/app/__tests__/play-profile-panel.test.js` (lines 1-184) -- exact structural template. Phase 52's `play-tickets-panel.test.js` is the closest for list-render assertions.

---

#### Pattern 1: Imports + path resolution (COPY VERBATIM)

**Analog excerpt** (play-profile-panel.test.js lines 15-25):

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// play/app/__tests__/ -> up 1 to play/app -> up 1 to play
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'profile-panel.js');
```

**What to change when adapting:** Change `PANEL` to `coinflip-panel.js`. No other path constants needed (coinflip has no helper file -- optional `leaderboards-fetch.js` would add `const FETCH = join(PLAY_ROOT, 'app', 'leaderboards-fetch.js');`).

```javascript
const PANEL = join(PLAY_ROOT, 'components', 'coinflip-panel.js');
```

---

#### Pattern 2: Existence + class shell tests (COPY VERBATIM with s/profile/coinflip/)

**Analog excerpt** (play-profile-panel.test.js lines 31-49):

```javascript
test('profile-panel.js exists', () => {
  assert.ok(existsSync(PANEL), 'expected play/components/profile-panel.js to exist');
});

test('profile-panel.js registers <profile-panel>', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]profile-panel['"]/);
});

test('profile-panel.js defines a class extending HTMLElement', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /class\s+\w+\s+extends\s+HTMLElement/);
});

test('profile-panel.js has connectedCallback and disconnectedCallback', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /connectedCallback\s*\(/);
  assert.match(src, /disconnectedCallback\s*\(/);
});
```

**What to change:** s/profile-panel/coinflip-panel/g throughout.

---

#### Pattern 3: COINFLIP-01/02/03 behavioral assertions (COPY shape from RESEARCH Section 12 lines 1210-1315)

Target ~25 assertions matching these categories (Wave 0 spec in RESEARCH lines 1210-1315):

- **Existence + registration** (4 tests): exists, registers `<coinflip-panel>`, class extends HTMLElement, connected/disconnected callbacks.
- **SHELL-01 negative assertions** (3 tests): does NOT import `beta/app/coinflip.js`, does NOT import `beta/app/utils.js`, DOES import from `beta/viewer/utils.js`.
- **Store wiring** (2 tests): subscribes to `replay.day` AND `replay.player`, imports subscribe+get from `beta/app/store.js`.
- **COINFLIP-01 state section** (1 test): renders data-binds `deposited`, `claimable`, `autorebuy`, `takeprofit`.
- **COINFLIP-02 leaderboard** (2 tests): fetches `/leaderboards/coinflip?day=`, renders `data-bind="leaderboard-entries"`.
- **COINFLIP-03 bounty** (2 tests): renders data-binds `armed`, `bounty-pool`, `bounty-record`, `bounty-holder`; uses `data-armed` attribute.
- **Fetch wiring** (1 test): fetches `/player/${addr}?day=` for coinflip block.
- **Stale-guard + keep-old-data-dim** (2 tests): uses `#coinflipFetchId`, toggles `is-stale` class.
- **Skeleton pattern** (2 tests): renders `skeleton-shimmer`, has `data-bind="skeleton"` and `data-bind="content"`.
- **Empty-state + aria-current** (2 tests): handles empty leaderboard, highlights selected player with aria-current.

Critical test examples (from RESEARCH lines 1233-1283):

```javascript
test('coinflip-panel.js does NOT import beta/app/coinflip.js (wallet-tainted)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/coinflip\.js['"]/);
});

test('COINFLIP-01: renders state data-binds (deposited, claimable, autorebuy, takeprofit)', () => {
  const src = readFileSync(PANEL, 'utf8');
  for (const key of ['deposited', 'claimable', 'autorebuy', 'takeprofit']) {
    assert.match(src, new RegExp(`data-bind=["']${key}["']`));
  }
});

test('COINFLIP-02: fetches /leaderboards/coinflip?day=', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/leaderboards\/coinflip\?day=/);
});

test('COINFLIP-03: armed indicator uses data-armed attribute', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-armed=/);
});

test('coinflip-panel.js uses #coinflipFetchId stale-guard counter', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#coinflipFetchId/);
});
```

---

### `play/app/__tests__/play-baf-panel.test.js` (contract-grep test) -- CREATE

**Analog:** `play/app/__tests__/play-profile-panel.test.js` (lines 1-184) + `play/app/__tests__/play-tickets-panel.test.js` (lines 1-193) -- same structural template.

---

#### Pattern 1: Imports + path resolution (COPY VERBATIM)

```javascript
const PANEL = join(PLAY_ROOT, 'components', 'baf-panel.js');
```

No helper file (bafContext inlined per Pattern 5 above).

---

#### Pattern 2: BAF-01/02/03 behavioral assertions (COPY shape from RESEARCH Section 12 lines 1317-1432)

Target ~25 assertions:

- **Existence + registration** (4 tests): same shape as coinflip.
- **SHELL-01 negative assertions** (3 tests): does NOT import `beta/app/baf.js`, does NOT import `beta/components/baf-panel.js`, DOES import from `beta/viewer/utils.js`.
- **Store wiring** (2 tests): subscribes to `replay.level` AND `replay.player`.
- **BAF-02 leaderboard + prominence** (3 tests): fetches `/leaderboards/baf?level=`, renders `leaderboard-entries`, uses `data-rank` attribute.
- **BAF-03 round status + context** (3 tests): `data-status` attribute + `round-status` binding, `next-baf-level` binding, `levels-until` binding.
- **BAF-01 your rank (INTEG-05 gated)** (3 tests): fetches `/player/${addr}/baf?level=`, renders `your-rank` binding, renders `your-rank-value`/`total-participants`/`your-score` bindings.
- **Prominence (panel-level)** (1 test): uses `data-prominence` attribute.
- **Stale-guards** (3 tests): `#bafFetchId`, `#bafPlayerFetchId`, `is-stale` class.
- **Skeleton pattern** (2 tests): renders `skeleton-shimmer`, has skeleton/content data-binds.
- **Empty-state + aria-current** (2 tests): handles empty leaderboard, highlights selected player.
- **bafContext logic (inline)** (1 test): asserts `Math.ceil((level + 1) / 10)` literal.

Critical test examples (from RESEARCH lines 1337-1428):

```javascript
test('baf-panel.js does NOT import beta/app/baf.js (transitively tainted)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/baf\.js['"]/);
});

test('BAF-02: fetches /leaderboards/baf?level=', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/leaderboards\/baf\?level=/);
});

test('BAF-02: uses data-rank attribute for prominence tiers', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-rank/);
});

test('BAF-01: fetches /player/${addr}/baf?level=', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/player\/[^`'"]+\/baf\?level=/);
});

test('BAF-03: renders round-status pill with data-status attribute', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-status/);
  assert.match(src, /data-bind=["']round-status["']/);
});

test('baf-panel.js uses #bafFetchId AND #bafPlayerFetchId stale-guard counters', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#bafFetchId/);
  assert.match(src, /#bafPlayerFetchId/);
});

test('baf-panel.js includes nextBafLevel derivation (ceil((level+1)/10)*10)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /Math\.ceil\(\s*\(?\s*level\s*\+\s*1\s*\)?\s*\/\s*10\s*\)/);
});
```

---

### `play/app/__tests__/play-shell-01.test.js` (MODIFY: add 3 FORBIDDEN entries)

**Analog:** The file itself lines 22-31 -- the existing FORBIDDEN array is the shape to extend.

**Analog excerpt** (play-shell-01.test.js lines 22-31):

```javascript
const FORBIDDEN = [
  { label: "bare 'ethers' specifier", pattern: /from\s+['"]ethers['"]/ },
  { label: 'beta/app/wallet.js', pattern: /from\s+['"][^'"]*\/beta\/app\/wallet\.js['"]/ },
  { label: 'beta/app/contracts.js', pattern: /from\s+['"][^'"]*\/beta\/app\/contracts\.js['"]/ },
  { label: 'beta/app/utils.js (ethers-tainted at line 3)', pattern: /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/ },
  { label: 'beta/components/connect-prompt.js', pattern: /from\s+['"][^'"]*\/beta\/components\/connect-prompt\.js['"]/ },
  { label: 'beta/components/purchase-panel.js', pattern: /from\s+['"][^'"]*\/beta\/components\/purchase-panel\.js['"]/ },
  { label: 'beta/components/coinflip-panel.js', pattern: /from\s+['"][^'"]*\/beta\/components\/coinflip-panel\.js['"]/ },
  { label: 'beta/components/decimator-panel.js', pattern: /from\s+['"][^'"]*\/beta\/components\/decimator-panel\.js['"]/ },
];
```

**What to change when adapting** (RESEARCH lines 208-213, Pitfall 5 at line 1502): Add three entries BEFORE the array close-bracket:

```javascript
  { label: 'beta/components/baf-panel.js (transitively wallet-tainted)', pattern: /from\s+['"][^'"]*\/beta\/components\/baf-panel\.js['"]/ },
  { label: 'beta/app/coinflip.js (ethers at line 4)', pattern: /from\s+['"][^'"]*\/beta\/app\/coinflip\.js['"]/ },
  { label: 'beta/app/baf.js (transitively tainted via utils.js)', pattern: /from\s+['"][^'"]*\/beta\/app\/baf\.js['"]/ },
```

**Gotcha:** Pattern 5 in RESEARCH (line 1502) flags the specific risk: a dev seeing `<baf-panel>` in both play/ and beta/ could accidentally import the beta one. The FORBIDDEN entry catches that before CI merges it.

---

### `.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md` (spec doc) -- CREATE

**Analog:** `.planning/phases/51-profile-quests/INTEG-02-SPEC.md` (lines 1-217) -- exact structural template. Phase 52's `INTEG-01-SPEC.md` is secondary.

**Section structure to copy verbatim** (with INTEG-05 content per RESEARCH Section 8 lines 331-553):

1. **Header block** (INTEG-02-SPEC lines 1-7) -- Phase, Requirement, Owner, Status (DRAFT), Posted date.
2. **Why This Endpoint Is Needed** (lines 9-15) -- explain that `/leaderboards/baf` returns only top-4; BAF-01 needs per-player lookup.
3. **Endpoint** (lines 17-30) -- `GET /player/:address/baf?level=N` with path + query params.
4. **Response JSON Schema** (RESEARCH lines 359-370) -- the 6-field `{level, player, score, rank, totalParticipants, roundStatus}` payload.
5. **roundStatus Derivation** (RESEARCH lines 383-398) -- four states with SQL pseudo-code.
6. **Contract-Call Map** (RESEARCH lines 402-409) -- which field comes from which data source.
7. **Proposed Backend Implementation** (RESEARCH lines 411-490) -- the Drizzle handler + schemas.
8. **Error Modes** (RESEARCH lines 512-520) -- 200/400 responses.
9. **Acceptance Criteria** (RESEARCH lines 522-531) -- 8 specific asserts (endpoint reachable, score matches view, rank=null when absent, etc.).
10. **Timeline** (RESEARCH lines 533-541) -- 3 atomic commits (feat, docs, test), same pattern as INTEG-01/02.
11. **Open Questions** (RESEARCH lines 543-548) -- `?day` vs `?level`, dense-rank vs row-number, bundling coinflip state.
12. **Confidence** (RESEARCH lines 549-554).

**What to change when adapting from INTEG-02:**
- INTEG-02 is an extension of an existing route; INTEG-05 is a NEW route class (`/player/:address/baf`). Emphasize the new-route pattern (parallel to INTEG-01's `/tickets/by-trait`).
- Data source is `baf_flip_totals` (not `/player/` dashboard). Reference `database/src/db/schema/baf-jackpot.ts:3-13` for the table.
- `roundStatus` is a three-table derivation; INTEG-02 had simpler day-resolution. Include the SQL pseudo-code from RESEARCH lines 393-398.

**Gotcha:** The INTEG-05 spec is the Wave 0 deliverable that gates Wave 2. Acceptance criteria MUST be precise enough that the database team can implement without further discussion (solo dev self-coordinates by switching repos). RESEARCH lines 522-531 provides the full criteria list -- reuse verbatim.

---

### `.planning/REQUIREMENTS.md` (MODIFY: mark INTEG-04 deferred)

**No analog needed** -- small single-line edit per CONTEXT D-10.

Change the INTEG-04 row's Status column from "Pending" (or similar) to `Deferred per Phase 54 D-10` with a pointer to CONTEXT and ROADMAP success criterion 5.

Verify existing wording before editing. If INTEG-04 is not yet listed, consult RESEARCH lines 56-59 for the deferral rationale.

---

### `play/app/leaderboards-fetch.js` (CREATE, OPTIONAL -- planner decision)

**Analog:** `play/app/tickets-fetch.js` lines 1-42 (structure template) -- but DROP the in-flight dedup logic since each call targets a distinct endpoint.

**Recommendation: SKIP this file** per RESEARCH Section 10 lines 1017-1031:
- Phase 52's `tickets-fetch.js` dedups because TWO panels (tickets + packs) share the SAME endpoint.
- Phase 54 has TWO panels with TWO DIFFERENT endpoints (coinflip-panel hits `/leaderboards/coinflip`, baf-panel hits `/leaderboards/baf`). No wire-dedup benefit.
- Each panel does raw `fetch()` directly in `#refetch()` / `#refetchLeaderboard()` -- simpler surface, zero LOC overhead vs the helper.

**If planner elects to ship for Phase-52 symmetry** (RESEARCH line 1030): thin 30-LOC module:

```javascript
// play/app/leaderboards-fetch.js -- thin wrappers for /leaderboards/* endpoints
// No in-flight dedup: each call targets a distinct endpoint; wire-level dedup
// rationale doesn't apply here (vs tickets-fetch.js). Symmetry-only helper.

import { API_BASE } from './constants.js';

export async function fetchCoinflipLeaderboard(day) {
  const url = `${API_BASE}/leaderboards/coinflip?day=${encodeURIComponent(day)}`;
  const res = await fetch(url);
  return res.ok ? res.json() : null;
}

export async function fetchBafLeaderboard(level) {
  const url = `${API_BASE}/leaderboards/baf?level=${encodeURIComponent(level)}`;
  const res = await fetch(url);
  return res.ok ? res.json() : null;
}
```

**Flag for planner decision:** my default recommendation is SKIP. If the planner wants it for parity, add a Wave 1 task and a few test assertions mirroring `play-tickets-panel.test.js` FETCH-specific tests (lines 167-193).

---

## Shared Patterns

### Imports (wallet-free surface)

**Source:** `play/app/constants.js` lines 1-13 + `beta/viewer/utils.js` lines 1-38 + `beta/app/store.js` (via `../../beta/app/store.js`)
**Apply to:** `play/components/coinflip-panel.js` AND `play/components/baf-panel.js`

Header for both panel files:

```javascript
import { subscribe, get } from '../../beta/app/store.js';
import { API_BASE } from '../app/constants.js';
import { formatBurnie, truncateAddress } from '../../beta/viewer/utils.js';
```

**Gotcha:** Import `formatEth` only if needed. BAF uses `formatBurnie` (scores are wei-scale BURNIE per RESEARCH line 279). Coinflip uses NEITHER for leaderboard scores -- they're integer-scale (Pitfall 8 from RESEARCH line 1517) so use `String(entry.score)` directly. Coinflip state fields (`depositedAmount`, `claimablePreview`, `autoRebuyStop`) ARE wei-scale so DO use `formatBurnie` on those.

---

### SHELL-01 wallet-free fence

**Source:** `play/app/__tests__/play-shell-01.test.js` lines 22-31 (FORBIDDEN array, extended in Wave 0)
**Apply to:** Every file in `play/` tree (enforced by recursive scan)

After Wave 0 edit, FORBIDDEN has 11 entries covering:
- `ethers`, `beta/app/wallet.js`, `beta/app/contracts.js`, `beta/app/utils.js`
- `beta/components/connect-prompt.js`, `/purchase-panel.js`, `/coinflip-panel.js`, `/decimator-panel.js`
- NEW: `beta/components/baf-panel.js`, `beta/app/coinflip.js`, `beta/app/baf.js`

**Gotcha:** The play/ tree is scanned recursively including subdirectories (play/assets, play/components, play/app). Test files themselves live in `play/app/__tests__/` and are excluded from the scan via `isInTestsDir()` filter. No new exclusion needed.

---

### Score-unit discipline (Pitfall 8 -- LOAD-BEARING per RESEARCH line 1517)

**Source:** RESEARCH Section 7 lines 244-246 (coinflip) + 278-279 (BAF) + Pitfall 8 at line 1517
**Apply to:** `play/components/coinflip-panel.js` `#renderLeaderboard` + `play/components/baf-panel.js` `#renderLeaderboard`

| Endpoint | Score format | Sample value | Render with |
|----------|--------------|--------------|-------------|
| `/leaderboards/coinflip?day=N` | Integer-scale BURNIE (NOT wei) | "52875" (day 64, rank 1) | `String(entry.score)` directly |
| `/leaderboards/baf?level=N` | Wei-scale BURNIE (10^22 order) | "475215212469240581904067" (level 20, rank 1) | `formatBurnie(entry.score) + ' BURNIE'` |
| `/player/:addr/baf?level=N` (INTEG-05 `score` field) | Wei-scale BURNIE (same table source) | "344863111573291904385281" | `formatBurnie(entry.score) + ' BURNIE'` |
| `/player/:addr?day=N` coinflip block (`depositedAmount`, `claimablePreview`, `currentBounty`, `biggestFlipAmount`, `autoRebuyStop`) | Wei-scale BURNIE | "200000000000000000000" (200 BURNIE) | `formatBurnie(value) + ' BURNIE'` |

**Critical Wave 1 verification:** Per RESEARCH Open Q8 line 1572, Wave 1 Task 1 confirms the coinflip score unit by reading the contract emit site (`DegenerusCoinflip.sol` `CoinflipTopUpdated` event). If the contract emits a wei value (contra the live-data sample showing integers), the render must change. Live data at day 64 shows 5-digit values (not 22-digit) so integer-scale is the current observation.

**Warning sign of bug:** Coinflip leaderboard displays "0.000000000000052875 BURNIE" (wrong -- treats integer as wei) OR BAF leaderboard displays "475,215,212,469,240,581,904,067 BURNIE" (wrong -- treats wei as integer).

---

### DOM rendering (textContent for user/API strings; innerHTML ONLY for static template)

**Source:** `play/components/profile-panel.js` lines 25-29 (T-51-01 comment) + `#bind` helper at lines 187-190 + `play/components/tickets-panel.js` lines 100-137 (document.createElement row builder)
**Apply to:** Both coinflip-panel and baf-panel for all dynamic row rendering

Static `innerHTML = TEMPLATE` is safe because TEMPLATE is a compile-time string with no interpolation. All row rendering uses `document.createElement` + `element.textContent = value` per tickets-panel.js pattern -- NEVER `element.innerHTML = userString`.

```javascript
// CORRECT (from tickets-panel.js lines 105-121):
const cardEl = document.createElement('div');
cardEl.className = 'ticket-card';
cardEl.setAttribute('data-card-index', String(card.cardIndex));
// ...

// INCORRECT (would be XSS if entry.player contained HTML):
container.innerHTML = entries.map(e => `<div>${e.player}</div>`).join('');
```

**Gotcha:** `truncateAddress(entry.player)` returns a string with no HTML (just hex digits + dots). Safe to interpolate into textContent. But keep the textContent discipline uniformly to avoid future regressions.

---

### Unsub cleanup pattern

**Source:** `play/components/profile-panel.js` lines 152, 176-183 (existing pattern -- already in Phase 50 stubs)
**Apply to:** Both panels -- already correct in Phase 50 stubs, no changes needed

```javascript
class Panel extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    // ... push subscribe(...) calls
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }
}
```

---

### Stale-guard + keep-old-data-dim (D-17 / D-18 carry-forward)

**Source:** `play/components/profile-panel.js` lines 155, 327-365 (fetch-id counter + is-stale toggle) + `play/styles/play.css` lines 334-343 (CSS transition)
**Apply to:** Both panels -- already established pattern in Phase 51; Phase 54 reuses with per-panel counter name

The `.is-stale` class toggle is identical to Phase 51+52. Each panel owns its own counter (`#coinflipFetchId`, `#bafFetchId`, `#bafPlayerFetchId`) so one panel's rapid scrub doesn't invalidate another's response.

**Analog CSS** (play.css lines 341-343 for profile):

```css
.profile-panel [data-bind="content"].is-stale {
  opacity: 0.6;
}
```

**Target additions** (already shown in Pattern 2/3 of play.css section above):

```css
.play-coinflip-panel [data-bind="content"].is-stale { opacity: 0.6; pointer-events: none; }
.play-baf-panel [data-bind="content"].is-stale { opacity: 0.6; pointer-events: none; }
```

---

## Wallet-Taint Fence (MUST READ)

The following files **must not** be imported by any new or modified file in `play/`:

| File | Reason |
|------|--------|
| `beta/app/utils.js` | `import { ethers } from 'ethers'` at line 3 |
| `beta/app/contracts.js` | Imports ethers at line 5 |
| `beta/app/wallet.js` | EIP-6963 wallet discovery |
| `beta/app/coinflip.js` | `import { ethers } from 'ethers'` at line 4 (write-mode contract calls) |
| `beta/app/baf.js` | Transitively tainted via `./utils.js` import at line 6 |
| `beta/components/coinflip-panel.js` | Direct tag-name collision + imports `beta/app/coinflip.js` |
| `beta/components/baf-panel.js` | Direct tag-name collision + imports `beta/app/baf.js` |
| `beta/components/connect-prompt.js` | Wallet UI |
| `beta/components/purchase-panel.js` | Wallet writes |
| `beta/components/decimator-panel.js` | Wallet writes |

**Safe beta/ imports for Phase 54:**

| File | Purpose |
|------|---------|
| `beta/app/store.js` | `subscribe`, `update`, `get`, `batch` (verified wallet-free) |
| `beta/viewer/utils.js` | `formatEth`, `formatBurnie`, `truncateAddress`, `formatWei` (explicit SHELL-01 comment at line 2) |
| `beta/styles/*.css` | Already linked from `play/index.html` |

---

## No Analog Found

None are truly without analog. The only "weak" analog is the optional `play/app/leaderboards-fetch.js` helper, and its closest analog (`tickets-fetch.js`) is a structural match if the planner elects to ship it (just without the in-flight dedup logic since there's no wire-dedup benefit).

**Novel sub-patterns within files that otherwise have strong analogs:**
- **BAF rank-tier CSS coloring** (gold/silver/bronze/regular): Novel beyond beta's rank-1-only styling. Additive layer on top of the beta-mirrored grid rules. Pattern 3 in play.css section covers; confidence HIGH because it's plain CSS with `data-rank` attribute hooks.
- **Dual fetch-id counter pattern in baf-panel**: Novel within play/ tree. Pattern 3 in baf-panel section covers. Closest precedent is profile-panel's single counter, extended by one; no structural risk.
- **roundStatus derivation + label mapping**: Novel endpoint -> UI adapter. Pattern 7 in baf-panel section covers. No analog for the specific state machine but the shape (switch/map object) is generic.

---

## Metadata

**Analog search scope:**
- `/home/zak/Dev/PurgeGame/website/play/` (full tree -- 10 existing components + tests + bootstrap + 1 stylesheet)
- `/home/zak/Dev/PurgeGame/website/beta/components/{baf,coinflip}-panel.js` (visual ref only; wallet-tainted; read for layout structure)
- `/home/zak/Dev/PurgeGame/website/beta/app/{baf,coinflip}.js` (helper reference; wallet-tainted; bafContext logic extracted for inline re-implementation)
- `/home/zak/Dev/PurgeGame/website/beta/styles/{baf,coinflip}.css` (prominence + keyframe source)
- `/home/zak/Dev/PurgeGame/website/beta/viewer/utils.js` (wallet-free formatter surface)
- `/home/zak/Dev/PurgeGame/website/.planning/phases/51-profile-quests/` (INTEG-02-SPEC template + profile-panel gold standard)
- `/home/zak/Dev/PurgeGame/website/.planning/phases/52-tickets-packs-jackpot/` (tickets-panel list-render template + 52-PATTERNS.md structural reference)

**Files scanned:** 12 source files + 4 test files + 2 spec docs + 1 CSS file + 1 requirements file

**Pattern extraction date:** 2026-04-24

**Planner target:** 4 plans mirroring Phase 51/52 wave cadence (Wave 0 spec+tests, Wave 1 pre-backend hydration, Wave 2 hard-gated INTEG-05 wiring, Wave 3 optional UAT likely deferred per precedent).

## PATTERN MAPPING COMPLETE
