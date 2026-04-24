# Phase 55: Decimator -- Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 5 (1 modify: decimator-panel stub -> hydrated; 1 modify: play.css; 1 modify: play-shell-01.test.js; 2 create: play-decimator-panel.test.js + INTEG-03-SPEC.md)
**Analogs found:** 5 / 5 (100% coverage -- exceeds 80% target)

## CRITICAL PLANNER OVERRIDE (read before assigning plans)

**CONTEXT D-03 is wrong.** CONTEXT says "Buckets are 1-8 (per the game model)." Contract source (`BurnieCoin.sol:142-147`) says:

- `DECIMATOR_BUCKET_BASE = 12`
- `DECIMATOR_MIN_BUCKET_NORMAL = 5`
- `DECIMATOR_MIN_BUCKET_100 = 2`

Actual bucket range:
- Normal levels (`level % 100 !== 0`): buckets **5 through 12** (8 possible buckets).
- Centennial levels (`level % 100 === 0` and `level > 0`): buckets **2 through 12** (11 possible buckets).
- SubBucket range is `0` to `bucket - 1` (per `DegenerusGameDecimatorModule.sol:27`).

Plans must use contract-truth. Implementation literal:

```javascript
const DECIMATOR_BUCKET_BASE = 12;
const DECIMATOR_MIN_BUCKET_NORMAL = 5;
const DECIMATOR_MIN_BUCKET_100 = 2;

function bucketRange(level) {
  if (level == null) return [];
  const isCentennial = level > 0 && level % 100 === 0;
  const min = isCentennial ? DECIMATOR_MIN_BUCKET_100 : DECIMATOR_MIN_BUCKET_NORMAL;
  const max = DECIMATOR_BUCKET_BASE;
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}
```

See 55-RESEARCH.md Pitfall 1 (lines 1532-1556) and Assumption A6 (line 1747) for verification trail. The Wave 0 test asserts this literally via `assert.match(src, /\b12\b)` and `assert.match(src, /\b(5|MIN_BUCKET_NORMAL)\b)` at test outline lines 1471-1477.

## Additional planner override

**`game.levelStartTime` is null in play/ store.** play/ does NOT poll `/game/state` (verified via `grep -r pollGameState play/` = no matches -- RESEARCH Pitfall 4 + Assumption A13). Wave 1 DECIMATOR-01 drops time-remaining entirely; renders state-label only ("OPEN" / "CLOSED" / "NOT ELIGIBLE"). Do NOT attempt to derive "X hours remaining" from `game.levelStartTime`. See RESEARCH Section 7 lines 339-346 (option D) and Pitfall 4 lines 1576-1582.

## Analog Coverage Summary

| Coverage Tier | Count | Files |
|---------------|-------|-------|
| **Strong** (pattern fully transferable verbatim or near-verbatim) | 5 | decimator-panel evolve (baf-panel is the direct structural template -- dual-signal subscribe, dual-counter stale-guard, inline helper); play-decimator-panel.test.js (play-baf-panel.test.js template); play.css extension (play.css Phase 54 section precedent); play-shell-01.test.js FORBIDDEN array edit (same-file pattern); INTEG-03-SPEC.md (INTEG-05-SPEC.md template) |
| **Partial** (adaptation required beyond rename) | 0 | -- |
| **Weak / scratch** (no direct analog) | 0 | -- |

**Why 100% vs Phase 54's 89%:** Phase 55 has one panel (not two) and no optional helpers. Every new surface has a direct Phase 54 analog. The two deltas vs baf-panel are (a) a THIRD subscription (`replay.day` in addition to `replay.level` + `replay.player` -- same shape, just +1 unsub push) and (b) a conditional terminal sub-section (no prior analog but trivial `if (burns.length === 0) section.hidden = true` pattern -- no load-bearing novelty).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality | Confidence |
|-------------------|------|-----------|----------------|---------------|------------|
| `play/components/decimator-panel.js` (MODIFY: Phase 50 stub -> Wave 1/2 hydrated) | UI Custom Element | request-response (level-aware + day-aware, dual-fetch Wave 1 + INTEG-03 Wave 2) | `play/components/baf-panel.js` (358 LOC; near-exact structural template) + `play/components/profile-panel.js` lines 151-250 (render-all + #bind pattern) | strong (baf-panel verbatim with +1 subscription, +1 optional sub-section, +1 helper inline) | HIGH |
| `play/styles/play.css` (MODIFY: append ~150 LOC Phase 55 section) | Stylesheet | CSS rules (window-badge, bucket-table, payout-pill, terminal-section) | `play/styles/play.css` existing Phase 54 `.play-baf-panel` section (precedent for `.play-*-panel` scope convention + is-stale + data-prominence + data-status attributes) + `beta/styles/decimator.css` lines 1-116 (stats-row grid source) + `beta/styles/terminal.css` lines 1-27, 80-104 (terminal section layout) | strong (same-file extension + line-by-line beta mirror with scope rename) | HIGH |
| `play/app/__tests__/play-decimator-panel.test.js` (CREATE, ~30-35 assertions) | Contract-grep test | source regex assertions | `play/app/__tests__/play-baf-panel.test.js` (254 LOC; exact structural template) | strong (exact template with +3 SHELL-01 entries, +1 replay.day subscribe, +1 bucket-range test, +1 terminal conditional test, +1 activity-score test) | HIGH |
| `play/app/__tests__/play-shell-01.test.js` (MODIFY: add 3 FORBIDDEN entries) | SHELL-01 guardrail | array edit | `play/app/__tests__/play-shell-01.test.js` lines 22-34 (existing FORBIDDEN array has 11 entries; Phase 55 extends by 3) | strong (one-location surgery; array grows 11 -> 14) | HIGH |
| `.planning/phases/55-decimator/INTEG-03-SPEC.md` (CREATE, ~240 LOC) | Spec doc | endpoint contract | `.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md` (237 LOC; exact structural template) | strong (literal template with Section 8 of 55-RESEARCH.md as content source) | HIGH |

**Unchanged files (already correct from prior phases):**
- `play/index.html` already registers `<decimator-panel>` (Phase 50). No change needed.
- `play/app/main.js` already populates `state.replay.{day, level, player}`. No change needed -- the new subscriptions read existing store paths.
- `play/app/constants.js` already re-exports `API_BASE`. No additions needed -- bucket constants inlined inside decimator-panel.js (see CRITICAL PLANNER OVERRIDE).

**Notable absence vs Phase 52 and Phase 54:**
- No shared fetch helper (vs Phase 52's `play/app/tickets-fetch.js`). Reason: one panel, two endpoints targeting distinct URLs; no wire-dedup benefit. Matches Phase 54's explicit decision (RESEARCH Section 10 lines 1144-1154).
- No beta-patch (unlike Phase 52's `jackpot-panel.js:7` import swap). Nothing in beta/ imports from play/.
- No INTEG-04 deferral edit (that was Phase 54's concern; INTEG-03 IS this phase's hard-gate requirement).

---

## Pattern Assignments

### `play/components/decimator-panel.js` (Custom Element, level + day-aware request-response)

**Analog (primary):** `play/components/baf-panel.js` (358 LOC) -- the closest structural match in the play/ tree. Same dual-signal subscribe pattern, same two-counter stale-guard, same inline helper function strategy, same safe-degrade Wave 1 -> Wave 2 gating.
**Analog (render-all + bind helper):** `play/components/profile-panel.js` lines 185-250 -- the `#bind(key, value)` helper + `#showContent()` skeleton swap.
**Starting point:** `play/components/decimator-panel.js` (40 LOC Phase 50 stub) -- keeps the `customElements.define('decimator-panel', ...)` registration + skeleton markup; everything else gets rewritten.

Target LOC: ~280-320 (vs baf-panel 358). Slightly smaller because no `#renderRoundStatusFallback` equivalent -- decimator's `roundStatus` has three states (open/closed/not_eligible) vs BAF's four (open/closed/skipped/not_eligible), and the window-badge derivation is simpler.

---

#### Pattern 1: Header comment + imports (COPY shape from baf-panel, RENAME identifiers)

**Analog excerpt** (baf-panel.js lines 1-54):

```javascript
// play/components/baf-panel.js -- <baf-panel> Custom Element (Phase 54 Waves 1+2)
//
// Three-section hydrated markup + dual-fetch wiring with stale-response guards
// and keep-old-data-dim. Data flow:
//   - BAF-02 leaderboard top-4: GET /leaderboards/baf?level=N (live pre-Phase-54)
//   - BAF-01 your-rank + BAF-03 round-status: GET /player/:address/baf?level=N
//     (INTEG-05; live as of Wave 2. Endpoint returns 200 with rank=null when the
//     player has no BAF stake at the level; ...
//
// ... (long header explaining data flow, sections, security, SHELL-01,
//      score-unit discipline)

import { subscribe, get } from '../../beta/app/store.js';
import { API_BASE } from '../app/constants.js';
import { formatBurnie, truncateAddress } from '../../beta/viewer/utils.js';
```

**Target for decimator-panel.js:**

```javascript
// play/components/decimator-panel.js -- <decimator-panel> Custom Element (Phase 55 Waves 1+2)
//
// Hydrated decimator panel with conditional terminal sub-section. Data flow:
//   - DECIMATOR-01 window state + DECIMATOR-03 partial effective/weighted +
//     DECIMATOR-05 terminal burns + D-07 activity score cross-reference:
//     GET /player/:address?day=N (live pre-Phase-55; INTEG-02 shipped in Phase 51)
//   - DECIMATOR-02 bucket + subbucket + DECIMATOR-03 full weighted amount +
//     DECIMATOR-04 winning subbucket + payout:
//     GET /player/:address/decimator?level=N&day=M (INTEG-03; live as of Wave 2.
//     Endpoint returns 200 with bucket=null when the player has no burn at the
//     level; non-OK responses fall through to the pre-populated state from the
//     extended-player fetch -- the bucket table still renders the correct range
//     per bucketRange(level), just without aria-current highlighting.)
//
// Sections (top to bottom, per 55-RESEARCH.md Section 10):
//   1. Header + window-status pill (DECIMATOR-01 / D-05) -- OPEN / CLOSED /
//      NOT ELIGIBLE / UPCOMING. Wave 1 sources from decimator.windowOpen
//      (binary); Wave 2 sources from INTEG-03 roundStatus (3-state).
//      Time-remaining is OMITTED (game.levelStartTime is null in play/ store
//      per Pitfall 4 / Assumption A13).
//   2. Context row (D-07) -- "Activity score: X.XX" + "Level N" label.
//      Sourced from data.scoreBreakdown.totalBps (same path profile-panel uses).
//   3. Stats row (DECIMATOR-02/03) -- 4-cell grid: Bucket / Subbucket /
//      Effective burn / Weighted. Values from INTEG-03 response. Wave 1
//      renders "--" placeholders.
//   4. Bucket table (DECIMATOR-02 / D-03) -- 8 or 11 rows depending on
//      whether level is centennial. Player's row gets aria-current="true".
//      NOTE: bucket range is 5-12 normal / 2-12 centennial per contract
//      source (BurnieCoin.sol:142-147). CONTEXT D-03 "1-8" is incorrect;
//      see 55-PATTERNS.md CRITICAL PLANNER OVERRIDE.
//   5. Payout pill (DECIMATOR-04 / D-04) -- "You won X.XX ETH" on
//      closed+won / "Not your subbucket" on closed+lost / "Round in progress"
//      on open / "No decimator round at level N" on not_eligible.
//   6. Terminal sub-section (DECIMATOR-05 / D-06, CONDITIONAL) -- renders
//      only when terminal != null AND terminal.burns.length > 0. Contains
//      a burns table with level / effective / weighted / multiplier columns.
//
// Data flow:
//   subscribe('replay.level')  --> #refetchLevel()                (INTEG-03 only)
//   subscribe('replay.player') --> #refetchPlayer() + #refetchLevel()
//   subscribe('replay.day')    --> #refetchPlayer() + #refetchLevel()
//
//   Two stale-guard counters:
//     #decimatorPlayerFetchId  -- bumped on extended-player refetch; 2 token checks
//     #decimatorLevelFetchId   -- bumped on INTEG-03 refetch; 2 token checks
//
// SECURITY (T-55-01): the innerHTML template is a static string with no
// user interpolation. All dynamic writes go through textContent or
// element.setAttribute. URL parameters are URL-encoded at the call site.
//
// SHELL-01: imports only from the wallet-free surface. The three new
// Wave 0 FORBIDDEN entries (beta/components/terminal-panel.js,
// beta/app/decimator.js, beta/app/terminal.js) are honored -- none are
// imported here. The existing beta/components/decimator-panel.js entry
// also stays honored (registering customElements.define('decimator-panel')
// from beta would collide with this file's registration at bottom).
//
// SCORE-UNIT DISCIPLINE:
//   effectiveAmount (BURNIE, wei-scale) -> formatBurnie(value) + ' BURNIE'
//   weightedAmount  (BURNIE, wei-scale) -> formatBurnie(value) + ' BURNIE'
//   payoutAmount    (ETH, wei-scale)    -> formatEth(value) + ' ETH'
//   activity score  (bps, integer)      -> (totalBps / 10000).toFixed(2)

import { subscribe, get } from '../../beta/app/store.js';
import { API_BASE } from '../app/constants.js';
import { formatBurnie, formatEth, truncateAddress } from '../../beta/viewer/utils.js';
```

**What to change when adapting:**
- `subscribe` + `get` + `API_BASE` + `formatBurnie` + `truncateAddress` are unchanged from baf-panel.
- Phase 55 ADDS `formatEth` to the `beta/viewer/utils.js` import list (needed for ETH payout rendering at DECIMATOR-04). `truncateAddress` stays even though decimator-panel doesn't render arbitrary player addresses -- it's a cheap import and the test asserts it OR formatBurnie is present (see Wave 0 test outline at RESEARCH line 1462-1468). Dropping it is fine too; recommend KEEP for consistency with baf-panel.

**Gotcha:** Never import from `beta/components/decimator-panel.js` (already in SHELL-01 FORBIDDEN at play-shell-01.test.js:30), `beta/components/terminal-panel.js` (Wave 0 NEW FORBIDDEN), `beta/app/decimator.js` (Wave 0 NEW FORBIDDEN -- ethers at line 4), or `beta/app/terminal.js` (Wave 0 NEW FORBIDDEN -- ethers at line 6). Use `beta/viewer/utils.js` (wallet-free per its header at line 2).

---

#### Pattern 2: Inline bucketRange helper (ADAPT FROM baf-panel's inline `bafContext` pattern)

**Analog excerpt** (baf-panel.js lines 56-71):

```javascript
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
```

**Target for decimator-panel.js** (inline per 55-RESEARCH.md Section 5 lines 112-117 + Pitfall 1 lines 1540-1554):

```javascript
// Inline decimator constants + bucketRange + helpers (55-PATTERNS.md CRITICAL
// OVERRIDE: CONTEXT D-03 says buckets are 1-8 but contract source
// BurnieCoin.sol:142-147 says 5-12 normal / 2-12 centennial. Inline literals
// avoid importing from wallet-tainted beta/app/decimator.js (ethers at line 4)
// and keep the correct range colocated with the render code that uses it.)
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
```

**What to change when adapting:**
- `bafContext` returns 4 fields (`nextBafLevel`, `levelsUntilBaf`, `isBafLevel`, `prominence`); `bucketRange` returns a flat array of integers. Different shape, same intent: pure derivation from `level`.
- Decimator has NO "prominence" concept (it's always relevant when the window is open). No data-prominence attribute on the panel element.
- The Wave 0 test asserts BOTH `\b12\b` AND `\b(5|MIN_BUCKET_NORMAL)\b` (see RESEARCH test outline line 1471-1477). The literals `12` and `5` must appear in the source (not just as derived values).
- `formatTimeMultiplier` is a Phase 55 addition with no baf-panel equivalent. 6 LOC. Inline per the same rationale as bafContext.

---

#### Pattern 3: TEMPLATE constant + class shell (COPY shape from baf-panel with binding renames)

**Analog excerpt** (baf-panel.js lines 73-113):

```javascript
const TEMPLATE = `
<section data-slot="baf" class="panel play-baf-panel" data-prominence="low">

  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:60%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:100px"></div></div>
  </div>

  <div data-bind="content" hidden>
    <h2 class="panel-title">BAF Leaderboard</h2>
    <!-- ... context row + leaderboard + your-rank row ... -->
  </div>
</section>
`;

class BafPanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #bafFetchId = 0;
  #bafPlayerFetchId = 0;
  // ...
}

customElements.define('baf-panel', BafPanel);
```

**Target TEMPLATE for decimator-panel** (from RESEARCH Section 10 lines 1042-1114):

```javascript
const TEMPLATE = `
<section data-slot="decimator" class="panel play-decimator-panel">

  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:60%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:120px"></div></div>
  </div>

  <div data-bind="content" hidden>

    <!-- D-05 window status -->
    <div class="panel-header">
      <h2 class="panel-title">Decimator</h2>
      <span class="play-decimator-window-badge" data-bind="window-status" data-status="">--</span>
    </div>

    <!-- D-07 activity-score + level context -->
    <div class="play-decimator-context">
      <span data-bind="activity-score">Activity score: --</span>
      <span data-bind="level-label">Level --</span>
    </div>

    <!-- D-03 stats row (bucket, subbucket, effective, weighted) -->
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

    <!-- D-04 payout pill (conditional on closed/open/not_eligible) -->
    <div class="play-decimator-payout" data-bind="payout" data-won="" hidden>
      <span data-bind="payout-label">--</span>
      <span data-bind="payout-amount">--</span>
    </div>

    <!-- D-03 bucket table -->
    <div class="play-decimator-bucket-table" data-bind="bucket-table">
      <div class="play-decimator-bucket-header">
        <span>Bucket</span><span>Status</span><span>Winning sub</span>
      </div>
      <div data-bind="bucket-rows">
        <!-- rows populated at render time (5-12 normal / 2-12 centennial) -->
      </div>
    </div>

    <!-- D-05 D-06 terminal sub-section (CONDITIONAL -- only when terminal.burns.length > 0) -->
    <div class="play-terminal-section" data-bind="terminal-section" hidden>
      <h3>Terminal decimator</h3>
      <div class="play-terminal-burns">
        <div class="play-terminal-burns-header">
          <span>Level</span><span>Effective</span><span>Weighted</span><span>Multiplier</span>
        </div>
        <div data-bind="terminal-burn-rows">
          <!-- rows populated at render time when terminal.burns.length > 0 -->
        </div>
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

  // ... methods ...
}

customElements.define('decimator-panel', DecimatorPanel);
```

**Data-bind keys asserted by Wave 0 test** (RESEARCH lines 1356-1417):

| Key | Requirement | Assertion |
|-----|-------------|-----------|
| `window-status` | DECIMATOR-01 / D-05 | `/data-bind=["']window-status["']/` + `/data-status/` |
| `activity-score` | D-07 | `/data-bind=["']activity-score["']/` |
| `bucket` | DECIMATOR-02 | `/data-bind=["']bucket["']/` |
| `subbucket` | DECIMATOR-02 | `/data-bind=["']subbucket["']/` |
| `effective` | DECIMATOR-03 | `/data-bind=["']effective["']/` |
| `weighted` | DECIMATOR-03 | `/data-bind=["']weighted["']/` |
| `payout` | DECIMATOR-04 | `/data-bind=["']payout["']/` + `/data-won/` |
| `bucket-table` or `bucket-rows` | DECIMATOR-02 / D-03 | `/data-bind=["']bucket-table["']\|data-bind=["']bucket-rows["']/` |
| `terminal-section` | DECIMATOR-05 | `/data-bind=["']terminal-section["']/` |
| `terminal-burn-rows` | DECIMATOR-05 | `/data-bind=["']terminal-burn-rows["']/` |
| `skeleton` + `content` | skeleton pattern | `/data-bind=["']skeleton["']/` + `/data-bind=["']content["']/` |
| `skeleton-shimmer` class | skeleton pattern | `/skeleton-shimmer/` |
| `aria-current` | DECIMATOR-02 / D-03 player highlighting | `/aria-current/` |

Minor data-binds NOT explicitly asserted but included for readability (`level-label`, `payout-label`, `payout-amount`, `bucket-header`, `terminal-burns-header`) are optional additions -- the test outline doesn't grep them, so they can be renamed freely without breaking tests.

---

#### Pattern 4: Dual stale-guard fetch methods (COPY VERBATIM SHAPE from baf-panel's `#refetchLeaderboard` + `#refetchPlayer` with THREE subscriptions instead of TWO)

**Analog excerpt** (baf-panel.js lines 142-207):

```javascript
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

// --- BAF-01 + BAF-03 roundStatus fetch (INTEG-05; live as of Wave 2) -----

async #refetchPlayer() {
  const level = get('replay.level');
  const addr = get('replay.player');
  const token = ++this.#bafPlayerFetchId;

  if (level == null || !addr) return;

  try {
    const res = await fetch(`${API_BASE}/player/${addr}/baf?level=${encodeURIComponent(level)}`);
    if (token !== this.#bafPlayerFetchId) return;

    if (!res.ok) {
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
```

**Target for decimator-panel** (from RESEARCH Section 11 lines 1162-1233):

```javascript
// --- DECIMATOR-01 + DECIMATOR-05 + D-07 fetch (extended-player endpoint) ---
// Day-scoped: refetches on replay.player OR replay.day change. The same
// endpoint is already fetched by profile-panel (Phase 51) and coinflip-panel
// (Phase 54); each panel gets its own stale-guard. Browsers coalesce the
// HTTP requests so there's no performance concern.

async #refetchPlayer() {
  const addr = get('replay.player');
  const day  = get('replay.day');
  const token = ++this.#decimatorPlayerFetchId;

  if (!addr || day == null) return;

  if (this.#loaded) {
    this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
  }

  try {
    const res = await fetch(`${API_BASE}/player/${addr}?day=${encodeURIComponent(day)}`);
    if (token !== this.#decimatorPlayerFetchId) return;
    const data = res.ok ? await res.json() : null;
    if (token !== this.#decimatorPlayerFetchId) return;

    // DECIMATOR-01 binary open/closed badge (Wave 1). Wave 2's #refetchLevel
    // will upgrade to the 3-state roundStatus pill.
    this.#renderWindowStatus(data?.decimator?.windowOpen);
    // D-07 activity score cross-reference.
    this.#renderActivityScore(data?.scoreBreakdown?.totalBps);
    this.#renderLevelLabel(get('replay.level'));
    // DECIMATOR-05 terminal sub-section (conditional on burns.length).
    this.#renderTerminalSection(data?.terminal);

    this.#showContent();
    this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
  } catch (err) {
    if (token === this.#decimatorPlayerFetchId) {
      // Graceful degradation: keep existing DOM, just clear the dim.
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
    }
  }
}

// --- DECIMATOR-02 + DECIMATOR-03 (full) + DECIMATOR-04 fetch (INTEG-03; ---
// live as of Wave 2). Level-scoped + optional day-scope for historical views.
// Wave 1 ships this as a safe-degrade stub: on 404 (INTEG-03 not yet shipped)
// the bucket table renders without aria-current; other sections are already
// hydrated from #refetchPlayer. Wave 2 flip requires no code change once
// INTEG-03 returns 200.

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
      // INTEG-03 error path: render bucket table without aria-current,
      // clear stats row placeholders, hide the payout pill.
      this.#renderBucketTable(level, null);
      this.#renderStatsRow(null);
      this.#renderPayout(null, level);
      return;
    }

    const data = await res.json();
    if (token !== this.#decimatorLevelFetchId) return;

    this.#renderBucketTable(level, data);              // DECIMATOR-02 / D-03
    this.#renderStatsRow(data);                        // DECIMATOR-02 / DECIMATOR-03
    this.#renderPayout(data, level);                   // DECIMATOR-04
    // Wave 2: upgrade the window badge from binary (windowOpen) to 3-state
    // (roundStatus) using INTEG-03 authority.
    this.#renderRoundStatus(data?.roundStatus);
  } catch (err) {
    if (token === this.#decimatorLevelFetchId) {
      this.#renderBucketTable(level, null);
      this.#renderStatsRow(null);
      this.#renderPayout(null, level);
    }
  }
}
```

**Key differences vs baf-panel:**

1. Three subscriptions, not two (see Pattern 5 below).
2. `#refetchPlayer` adds a stale-guard dim (the extended-player fetch is cheap but day-scrub races can still occur); baf-panel's `#refetchPlayer` did NOT dim because only the leaderboard fetch dimmed (INTEG-05 per-player was too fast to matter). Keep the dim on `#refetchPlayer` because the extended-player endpoint is larger and the three-subscription cadence makes races more frequent.
3. `#refetchLevel` catch-arm renders a placeholder state, NOT a loud error -- this is the safe-degrade Wave 1 stub per D-06 RESEARCH line 1238. Wave 2's INTEG-03 return-200 means the catch-arm rarely fires in practice.
4. URL construction is conditional on `day` being present (INTEG-03 `?day=M` is optional per spec). baf-panel's `/player/:addr/baf?level=` is always level-only.
5. `encodeURIComponent` on all query parameters per T-55-01 security discipline (matches baf-panel's T-54-01).

**Gotcha 1** (Pitfall 3 from RESEARCH line 1568): `#renderTerminalSection(data?.terminal)` MUST hide the entire `<div data-bind="terminal-section">` when `terminal === null` OR `terminal.burns.length === 0`. Setting `section.hidden = true` is correct; do NOT leave the section visible with an empty burns table (that looks like a stuck skeleton).

**Gotcha 2** (Pitfall 9 from RESEARCH line 1620): `#refetchLevel` returns early when `level == null`. The connectedCallback's subscribe + initial kick pattern covers the "null-first-then-populated" case correctly -- first sync call no-ops, subscribe-triggered call refetches once the scrubber populates `replay.level`.

**Gotcha 3** (Pitfall 10 from RESEARCH line 1627): `#renderPayout` must handle `payoutAmount === '0'` + `roundStatus === 'closed'` by labeling "Not your subbucket" (not "You won 0 ETH"). See Pattern 7 below.

---

#### Pattern 5: Subscription wiring with THREE subscribes (EXTEND baf-panel's two-subscribe pattern by one)

**Analog excerpt** (baf-panel.js lines 120-133):

```javascript
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
```

**Target for decimator-panel** (from RESEARCH Section 10 lines 1124-1132):

```javascript
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
```

**What to change when adapting:**
- THREE `subscribe(...)` calls (not two). The Wave 0 test asserts all three literally:

```javascript
assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
```

(see RESEARCH test outline lines 1356-1361).

- The replay.player and replay.day callbacks BOTH fire the full pair (`#refetchPlayer()` + `#refetchLevel()`). Only `replay.level` fires just one (`#refetchLevel()` alone) because level changes don't affect day-scoped state.
- Initial kick order matters minimally, but `#refetchPlayer` first is conventional (larger endpoint, more work). The stale-guards make order irrelevant for correctness.

---

#### Pattern 6: Render helpers (ADAPT from baf-panel's `#renderContext` + profile-panel's `#bind`)

**Analog excerpts:**

profile-panel.js lines 187-190 (the `#bind` helper shape -- LOCAL RE-USE, don't import):

```javascript
#bind(key, value) {
  const el = this.querySelector(`[data-bind="${key}"]`);
  if (el) el.textContent = value;
}
```

baf-panel.js lines 211-213 (an alternative `#bind` that returns the element for when the caller needs to set attributes):

```javascript
#bind(key) {
  return this.querySelector(`[data-bind="${key}"]`);
}
```

baf-panel.js lines 215-233 (the `#renderContext` shape):

```javascript
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
```

**Recommendation for decimator-panel:** Use the baf-panel flavor (`#bind(key)` returns element; caller does textContent / setAttribute). It's more flexible for the stats row + payout pill that need both textContent and data-attributes.

**Target render helpers for decimator-panel:**

```javascript
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
  // Score-unit discipline: effectiveAmount and weightedAmount are WEI-scale
  // BURNIE. formatBurnie handles both.
  this.#setText('effective',
    data.effectiveAmount && data.effectiveAmount !== '0'
      ? `${formatBurnie(data.effectiveAmount)} BURNIE`
      : '0');
  this.#setText('weighted',
    data.weightedAmount && data.weightedAmount !== '0'
      ? `${formatBurnie(data.weightedAmount)} BURNIE`
      : '0');
}
```

**What to change when adapting:**
- `#bind` returns element (baf-panel shape) + `#setText(key, value)` wraps the common case (profile-panel shape). Two-helper pattern.
- `#showContent` differs slightly between profile-panel (skeleton removed) and baf-panel (skeleton `hidden = true`). Use baf-panel's shape (matches the TEMPLATE's `data-bind="skeleton"` lives inside the section, so hiding is correct; removing breaks re-hydration on errors).
- `#renderWindowStatus` + `#renderRoundStatus` are TWO separate helpers because Wave 1 ships only `#renderWindowStatus` (from the extended-player fetch); Wave 2 adds `#renderRoundStatus` (from INTEG-03). The second call from `#refetchLevel` overrides the first. Conservative: Wave 2 code paints "OPEN" / "CLOSED" / "NOT ELIGIBLE" over Wave 1's "OPEN" / "CLOSED" -- the upgrade is seamless because both set data-status.

---

#### Pattern 7: Payout pill render (NEW for Phase 55 -- no direct analog; closest is baf-panel's `#renderYourRank`)

**Analog excerpt** (baf-panel.js lines 294-321 -- the shape of "hide row when no data, show row with fields when data present"):

```javascript
#renderYourRank(data) {
  const row = this.#bind('your-rank');
  if (!row) return;

  if (!data || data.rank == null) {
    row.hidden = true;
    return;
  }

  row.hidden = false;

  const rankEl = this.#bind('your-rank-value');
  if (rankEl) rankEl.textContent = String(data.rank);

  // ...
}
```

**Target for decimator-panel** (per RESEARCH Pitfall 10 lines 1627-1636):

```javascript
// DECIMATOR-04 payout pill. Five states:
//   closed + won       -> "You won X.XX ETH"     data-won="true"
//   closed + lost      -> "Not your subbucket"   data-won="false"
//   closed + no burn   -> "You didn't burn at level N"  data-won="false"
//   open               -> "Round in progress"    data-won=""
//   not_eligible       -> "No decimator round at level N"  data-won=""
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
```

**What to change when adapting:**
- Baf-panel's `#renderYourRank` hides the row on `data.rank == null`; decimator-panel's `#renderPayout` NEVER hides when `data` is truthy -- it always shows some state (which is load-bearing for UX clarity per D-04).
- The `data-won` attribute drives CSS coloring: `"true"` = accent color + green-tinted bg; `"false"` = muted; `""` = neutral.
- `formatEth` (not `formatBurnie`) on `payoutAmount` -- it's wei-scale ETH, not BURNIE.
- Wave 0 test asserts `/data-bind=["']payout["']/` + `/data-won/` (RESEARCH lines 1393-1397).

---

#### Pattern 8: Bucket table render (NEW for Phase 55 -- no direct analog in play/; closest is baf-panel's `#renderLeaderboard`)

**Analog excerpt** (baf-panel.js lines 235-281 -- document.createElement row loop, aria-current highlighting, empty-state branch):

```javascript
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

    // ... cells ...
    container.appendChild(row);
  }
}
```

**Target for decimator-panel** (loops `bucketRange(level)` not a data array; aria-current on the player's bucket row; NO `data-rank` attribute -- no prominence tiering):

```javascript
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
    empty.textContent = 'Decimator bucket range not available (level not set).';
    container.appendChild(empty);
    return;
  }

  const playerBucket   = data?.bucket   ?? null;
  const playerSubBucket = data?.subbucket ?? null;
  const winningSub     = data?.winningSubbucket ?? null;
  const roundClosed    = data?.roundStatus === 'closed';

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
```

**What to change when adapting:**
- Loops `bucketRange(level)` (integer range) not `entries` (data array). This means the table is ALWAYS populated when `level != null`; "empty state" means only when level itself is null (rare edge).
- `aria-current="true"` on the PLAYER'S bucket row (single row, not a per-row match like baf-panel).
- `data-winning="true"` is Phase 55 novel -- applied to the player's row when the round is closed AND their subbucket won. CSS picks this up for a green tint (see play.css Pattern 3).
- Three columns vs baf-panel's three (coincidental same count). Grid-template-columns are different (see play.css section).
- NO `data-rank` attribute -- there's no gold/silver/bronze tiering in decimator.
- Wave 0 test asserts `/data-bind=["']bucket-table["']|data-bind=["']bucket-rows["']/` (either works, RESEARCH line 1378) + `/aria-current/` (RESEARCH line 1381).

**Gotcha 1** (RESEARCH Pitfall 11 lines 1640-1646): Centennial levels show 11 rows (2-12), normal levels show 8 rows (5-12). The panel height jumps ~45% at level 100. Recommended: accept the shift as informative ("centennial = special level"). If UX rejects, add `min-height` to the container equal to the 11-row layout in CSS.

**Gotcha 2** (RESEARCH Section 14 Q6 lines 1708-1712): Only the PLAYER'S bucket row shows the winning subbucket in the third column. Other rows show `--`. Don't imply cross-bucket wins.

---

#### Pattern 9: Terminal sub-section render (NEW for Phase 55 -- conditional visibility + row loop; closest is baf-panel's `#renderLeaderboard` row loop + the `hidden` attribute pattern from `#renderYourRank`)

**Target for decimator-panel** (per RESEARCH Section 10 lines 1100-1111 + D-06 + Pitfall 3):

```javascript
// DECIMATOR-05 / D-06 terminal sub-section. Conditional on
// terminal != null AND terminal.burns.length > 0. Per Pitfall 3, hide the
// ENTIRE section (not just the rows) when no terminal activity -- don't
// render an empty table with headers.
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
```

**What to change when adapting:**
- The conditional check is `!terminal || !Array.isArray(terminal.burns) || terminal.burns.length === 0`. The Wave 0 test asserts the `terminal...burns...length` expression via regex `/terminal[^.\n]*\.burns[^.\n]*\.length|burns\.length\s*(>|!==|\?)/` (RESEARCH line 1412).
- Three wei-scale fields all format through `formatBurnie` (not mixed with `formatEth`).
- `timeMultBps` is in bps (10000 = 1.00x), converted by `formatTimeMultiplier` inline helper (see Pattern 2).
- Row cells don't carry `data-*` attributes (no aria-current on terminal rows -- they're all "the player's").

---

#### Pattern 10: Unsub cleanup (COPY VERBATIM from Phase 50 stub + baf-panel)

**Analog excerpt** (decimator-panel.js Phase 50 stub lines 34-37 + baf-panel.js lines 135-138):

```javascript
disconnectedCallback() {
  this.#unsubs.forEach((fn) => fn());
  this.#unsubs = [];
}
```

**What to change when adapting:** Nothing. Already correct in Phase 50 stub. Keep as-is.

---

### `play/styles/play.css` (MODIFY: append Phase 55 section ~150 LOC)

**Analog (prior-phase precedent):** `play/styles/play.css` existing Phase 54 section (Phase 54 added `.play-baf-panel` + `.play-coinflip-panel` sections with same-file header-comment convention).
**Analog (source layout rules -- pattern-match only per D-02):** `beta/styles/decimator.css` (116 LOC; stats-row grid + window badge) + `beta/styles/terminal.css` (157 LOC; sub-section layout + red section header).

---

#### Pattern 1: Append-new-section convention (COPY HEADER SHAPE from Phase 54)

**Analog excerpt** (Phase 54 section header pattern in play.css):

```css
/* ======================================================================
   Phase 54 -- <coinflip-panel> + <baf-panel> styles
   ...
   ====================================================================== */
```

**Target header for Phase 55:**

```css
/* ======================================================================
   Phase 55 -- <decimator-panel> styles (with conditional terminal sub-section)
   Read-only decimator panel: window-status pill, activity-score cross-ref,
   4-cell stats row, bucket table with player-row highlighting, payout pill,
   and conditional terminal sub-section. Mirrors beta/styles/decimator.css
   stats grid + window badge (lines 7-45) and beta/styles/terminal.css
   section header + dec-info-row layout (lines 1-27, 80-104), all under a
   .play-decimator-panel scope per SHELL-01 / D-02 (no CSS class collisions
   with beta components that may coexist in the same page tree).
   Bucket table is NEW relative to beta -- beta renders bucket as a single
   stat cell; play shows the full range per contract source (5-12 normal,
   2-12 centennial per BurnieCoin.sol:142-147).
   ====================================================================== */
```

---

#### Pattern 2: Panel header + window badge (COPY FROM beta/styles/decimator.css lines 7-20 with `.play-*` rename)

**Analog excerpt** (beta/styles/decimator.css lines 7-20 + RESEARCH Section 9 lines 739-753):

```css
.decimator-panel .panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.decimator-window-badge {
  background: var(--accent-primary);
  color: var(--bg-primary);
  padding: 0.25rem 0.75rem;
  border-radius: 1rem;
  font-size: 0.8rem;
  font-weight: 600;
}
```

**Target in play.css** (RESEARCH Section 9 lines 824-854 -- extended with data-status variants like Phase 54's round-status pill):

```css
/* --- Decimator panel (Phase 55) --- */

.play-decimator-panel .panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.play-decimator-panel .panel-title {
  margin: 0;
}

/* D-05 window status badge -- data-status drives color */
.play-decimator-window-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 1rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.play-decimator-window-badge[data-status="open"] {
  background: rgba(34, 197, 94, 0.15);
  color: var(--success);
}
.play-decimator-window-badge[data-status="closed"] {
  background: rgba(100, 100, 100, 0.2);
  color: var(--text-dim);
}
.play-decimator-window-badge[data-status="not_eligible"] {
  background: rgba(100, 100, 100, 0.1);
  color: var(--text-dim);
}
```

**What to change when adapting:**
- Beta uses a single accent-primary background; Phase 55 uses `data-status` attribute selectors (matches Phase 54's `.play-baf-round-status[data-status="..."]` pattern at play.css prior-phase lines -- precedent for data-status driven coloring).
- No `data-prominence` at the panel level (decimator doesn't have BAF's approach-based prominence).

---

#### Pattern 3: Stats row + context row + payout pill + bucket table (NEW relative to beta -- extend Phase 54 grid conventions)

**Target in play.css** (from RESEARCH Section 9 lines 856-946):

```css
/* Context row: activity score + level label */
.play-decimator-context {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 0.75rem;
}

/* Stats row (bucket + subbucket + effective + weighted per-level) */
.play-decimator-stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin: 1rem 0;
}
.play-decimator-stats-row .stat {
  text-align: center;
}
.play-decimator-stats-row .stat-label {
  font-size: 0.75rem;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.play-decimator-stats-row .stat-value {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-top: 0.25rem;
}

/* D-04 payout pill -- data-won drives color */
.play-decimator-payout {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  border-radius: 6px;
  margin-top: 1rem;
  font-weight: 600;
}
.play-decimator-payout[data-won="true"] {
  border: 1px solid var(--accent-primary);
  background: rgba(245, 166, 35, 0.1);
  color: var(--accent-primary);
}
.play-decimator-payout[data-won="false"] {
  color: var(--text-dim);
}

/* D-03 bucket table -- NEW relative to beta */
.play-decimator-bucket-table {
  margin-top: 1rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
}
.play-decimator-bucket-header {
  display: grid;
  grid-template-columns: 80px 1fr 100px;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 600;
}
.play-decimator-bucket-row {
  display: grid;
  grid-template-columns: 80px 1fr 100px;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border-color);
  font-size: 0.85rem;
}
.play-decimator-bucket-row[aria-current="true"] {
  background: var(--bg-tertiary);
  font-weight: 700;
  border-left: 3px solid var(--accent-primary);
}
.play-decimator-bucket-row[data-winning="true"] {
  background: rgba(34, 197, 94, 0.08);
}

/* Empty state */
.play-decimator-empty {
  padding: 1rem;
  text-align: center;
  color: var(--text-dim);
  font-size: 0.85rem;
}

/* Keep-old-data-dim (Phase 51/52/54 pattern) */
.play-decimator-panel [data-bind="content"] {
  transition: opacity 0.2s ease;
}
.play-decimator-panel [data-bind="content"].is-stale {
  opacity: 0.6;
  pointer-events: none;
}
```

**Gotcha** (RESEARCH Pitfall 11 lines 1640-1646): Recommended layout-shift acceptance rather than min-height workaround. If UX complains later, add `min-height: calc(32px * 11)` to `.play-decimator-bucket-table` so normal-level tables leave whitespace instead of shrinking.

---

#### Pattern 4: Terminal sub-section (COPY FROM beta/styles/terminal.css lines 1-27, 80-104)

**Analog excerpt** (beta/styles/terminal.css lines 1-27 + RESEARCH lines 799-811):

Section header in red (`var(--danger)`) to visually separate from normal decimator. Dec stats row is 3-cell grid vs decimator's 4-cell. Insurance bar (lines 54-78) is OMITTED per Phase 55 scope (REQUIREMENTS.md line 101 TERM-xx deferral + RESEARCH Section 14 Q2 lines 1684-1688).

**Target in play.css** (RESEARCH Section 9 lines 956-1005):

```css
/* --- Terminal sub-section (Phase 55 DECIMATOR-05) --- */

.play-terminal-section {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 2px solid var(--border-color);
}
.play-terminal-section h3 {
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--danger);
  margin-bottom: 0.5rem;
}
.play-terminal-burns {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
}
.play-terminal-burns-header {
  display: grid;
  grid-template-columns: 60px 1fr 1fr 80px;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 600;
}
.play-terminal-burn-row {
  display: grid;
  grid-template-columns: 60px 1fr 1fr 80px;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border-color);
  font-size: 0.85rem;
}

@media (max-width: 480px) {
  .play-decimator-stats-row {
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
  }
  .play-terminal-burns-header,
  .play-terminal-burn-row {
    grid-template-columns: 60px 1fr 80px;
  }
  .play-terminal-burns-header > :nth-child(3),
  .play-terminal-burn-row > :nth-child(3) {
    display: none;
  }
}
```

**What to change when adapting:**
- All class names use `.play-terminal-*` scope (not `.terminal-*`) to avoid collision with any beta terminal-panel styles that may coexist in the page tree.
- Section header color is `var(--danger)` (red) -- matches beta's visual separation of terminal vs normal decimator.
- Skip the 54-78 line insurance bar. Skip the write-mode burn input + claim button styles (out of scope for read-only play/).
- Mobile breakpoint drops the weighted column (3rd child) to keep the row scannable at 480px width.

---

### `play/app/__tests__/play-decimator-panel.test.js` (contract-grep test) -- CREATE

**Analog:** `play/app/__tests__/play-baf-panel.test.js` (254 LOC) -- exact structural template. The file has 42 assertions; Phase 55's target is ~30-35 per RESEARCH Section 12 lines 1281-1483. The decimator test is slightly leaner because there's no equivalent to baf-panel's 4-state roundStatus label mapping or prominence panel-level attribute.

---

#### Pattern 1: Imports + path resolution (COPY VERBATIM)

**Analog excerpt** (play-baf-panel.test.js lines 17-25):

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'baf-panel.js');
```

**Target for decimator test:**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'decimator-panel.js');
```

**What to change:** Just the `PANEL` constant. No other path adjustments (no helper file -- all logic inlined per CRITICAL OVERRIDE above).

---

#### Pattern 2: Existence + class shell tests (COPY VERBATIM with s/baf/decimator/)

**Analog excerpt** (play-baf-panel.test.js lines 31-49):

```javascript
test('baf-panel.js exists', () => {
  assert.ok(existsSync(PANEL), `expected ${PANEL} to exist`);
});

test('baf-panel.js registers the <baf-panel> custom element', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]baf-panel['"]/);
});

test('baf-panel.js defines a class extending HTMLElement', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /class\s+\w+\s+extends\s+HTMLElement/);
});

test('baf-panel.js has connectedCallback and disconnectedCallback', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /connectedCallback\s*\(\s*\)/);
  assert.match(src, /disconnectedCallback\s*\(\s*\)/);
});
```

**What to change:** s/baf-panel/decimator-panel/g throughout (4 tests total).

---

#### Pattern 3: SHELL-01 negative assertions (COPY SHAPE from baf-panel; ADD decimator-specific entries)

**Analog excerpt** (play-baf-panel.test.js lines 55-85):

```javascript
test('SHELL-01: baf-panel.js does NOT import beta/app/baf.js (transitively tainted via utils.js)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/baf\.js['"]/);
});

test('SHELL-01: baf-panel.js does NOT import beta/app/utils.js (ethers at line 3)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});

test('SHELL-01: baf-panel.js does NOT import beta/components/baf-panel.js (tag-name collision + transitively tainted)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/components\/baf-panel\.js['"]/);
});

test('SHELL-01: baf-panel.js does NOT import ethers directly', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"]ethers['"]/);
});

test('baf-panel.js imports from beta/viewer/utils.js (wallet-free surface)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/viewer\/utils\.js['"]/);
});

test('baf-panel.js imports subscribe + get from the reused beta store', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/app\/store\.js['"]/);
  assert.match(src, /subscribe/);
  assert.match(src, /\bget\b/);
});

test('baf-panel.js imports API_BASE from play/app/constants.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/app\/constants\.js['"]/);
  assert.match(src, /API_BASE/);
});
```

**Target for decimator test** (from RESEARCH lines 1315-1353): ADD SHELL-01 entries for the THREE Phase-55-new FORBIDDEN paths (terminal-panel, decimator.js, terminal.js) plus keep the existing five negative checks:

```javascript
test('SHELL-01: decimator-panel.js does NOT import beta/components/decimator-panel.js (tag-name collision)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/components\/decimator-panel\.js['"]/);
});

test('SHELL-01: decimator-panel.js does NOT import beta/components/terminal-panel.js (Phase 55 new FORBIDDEN: wallet-tainted + tag-name collision)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/components\/terminal-panel\.js['"]/);
});

test('SHELL-01: decimator-panel.js does NOT import beta/app/decimator.js (ethers at line 4)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/decimator\.js['"]/);
});

test('SHELL-01: decimator-panel.js does NOT import beta/app/terminal.js (ethers at line 6)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/terminal\.js['"]/);
});

test('SHELL-01: decimator-panel.js does NOT import beta/app/utils.js (ethers at line 3)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});

test('SHELL-01: decimator-panel.js does NOT import ethers directly', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"]ethers['"]/);
});

test('decimator-panel.js imports from beta/viewer/utils.js (wallet-free surface)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/viewer\/utils\.js['"]/);
});

test('decimator-panel.js imports subscribe + get from the reused beta store', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/app\/store\.js['"]/);
  assert.match(src, /subscribe/);
  assert.match(src, /\bget\b/);
});

test('decimator-panel.js imports API_BASE from play/app/constants.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/app\/constants\.js['"]/);
  assert.match(src, /API_BASE/);
});
```

**Delta vs baf-panel:** +3 SHELL-01 negative tests (terminal-panel.js, decimator.js, terminal.js). +1 SHELL-01 negative test for the existing beta/components/decimator-panel.js entry -- baf-panel only had ONE component-level negative (beta/components/baf-panel.js) but decimator has TWO (decimator-panel.js AND terminal-panel.js).

---

#### Pattern 4: Subscription wiring tests (EXTEND baf-panel's two-subscribe test by one)

**Analog excerpt** (play-baf-panel.test.js lines 97-101):

```javascript
test('baf-panel.js subscribes to replay.level AND replay.player', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
});
```

**Target for decimator test:**

```javascript
test('decimator-panel.js subscribes to replay.level, replay.player, AND replay.day (D-08 three-signal)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
});
```

**Delta:** +1 subscribe assertion for `replay.day`.

---

#### Pattern 5: DECIMATOR-01..05 behavioral assertions (ADAPT from baf-panel's BAF-01..03 shape)

Target ~15-18 requirement-specific assertions across DECIMATOR-01, DECIMATOR-02, DECIMATOR-03, DECIMATOR-04, DECIMATOR-05, and INTEG-03 fetch wiring. Full outline in RESEARCH Section 12 lines 1363-1443:

```javascript
// --- DECIMATOR-01: window status badge (D-05) ---
test('DECIMATOR-01: renders window-status data-bind with data-status attribute', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']window-status["']/);
  assert.match(src, /data-status/);
});

// --- DECIMATOR-02: bucket + subbucket + bucket table (D-03) ---
test('DECIMATOR-02: renders bucket + subbucket data-binds', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']bucket["']/);
  assert.match(src, /data-bind=["']subbucket["']/);
});
test('DECIMATOR-02: renders bucket-table container (D-03)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']bucket-table["']|data-bind=["']bucket-rows["']/);
});
test('DECIMATOR-02: uses aria-current for player row highlighting', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /aria-current/);
});

// --- DECIMATOR-03: effective + weighted burn amounts ---
test('DECIMATOR-03: renders effective + weighted data-binds', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']effective["']/);
  assert.match(src, /data-bind=["']weighted["']/);
});

// --- DECIMATOR-04: payout pill + winning subbucket ---
test('DECIMATOR-04: renders payout pill data-bind with data-won attribute', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']payout["']/);
  assert.match(src, /data-won/);
});

// --- DECIMATOR-04 / INTEG-03 fetch wiring ---
test('INTEG-03: fetches /player/${addr}/decimator?level=', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/player\/[^`'"]+\/decimator\?level=/);
});

// --- DECIMATOR-05: terminal sub-section conditional on burns.length ---
test('DECIMATOR-05: renders terminal-section data-bind', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']terminal-section["']/);
});
test('DECIMATOR-05: checks terminal.burns.length for conditional render (D-06)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /terminal[^.\n]*\.burns[^.\n]*\.length|burns\.length\s*(>|!==|\?)/);
});
test('DECIMATOR-05: renders terminal-burn-rows container', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']terminal-burn-rows["']/);
});

// --- Extended player fetch (DECIMATOR-01 + DECIMATOR-05 + D-07) ---
test('fetches /player/${addr}?day= (extended-player endpoint)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/player\/\$\{[^}]+\}\?day=|\/player\/[^`'"]+\?day=/);
});

// --- D-07 activity score cross-reference ---
test('D-07: reads scoreBreakdown.totalBps for activity score display', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /scoreBreakdown[^.\n]*\.totalBps|totalBps/);
});
test('D-07: renders activity-score data-bind', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']activity-score["']/);
});
```

**Delta vs baf-panel's BAF-01..03 tests:**
- DECIMATOR has FIVE requirements (01..05) vs BAF's THREE (01..03). More assertions total (~15 vs ~11 for the requirement surfaces).
- DECIMATOR-05 tests the `terminal.burns.length` conditional check, which has no BAF equivalent.
- INTEG-03 fetch URL pattern is `/player/*/decimator?level=` (vs BAF's `/player/*/baf?level=`).

---

#### Pattern 6: Dual stale-guard tests (COPY VERBATIM with identifier renames)

**Analog excerpt** (play-baf-panel.test.js lines 177-190):

```javascript
test('baf-panel.js uses #bafFetchId stale-guard counter (leaderboard fetch)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#bafFetchId/);
});

test('baf-panel.js uses #bafPlayerFetchId stale-guard counter (INTEG-05 fetch)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#bafPlayerFetchId/);
});

test('baf-panel.js toggles is-stale class for keep-old-data-dim', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});
```

**Target for decimator test** (RESEARCH lines 1436-1447):

```javascript
test('decimator-panel.js uses #decimatorPlayerFetchId stale-guard counter', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#decimatorPlayerFetchId/);
});

test('decimator-panel.js uses #decimatorLevelFetchId stale-guard counter (INTEG-03)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#decimatorLevelFetchId/);
});

test('decimator-panel.js toggles is-stale class for keep-old-data-dim', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});
```

---

#### Pattern 7: Bucket range test (NEW for Phase 55 -- no baf analog; CRITICAL per PLANNER OVERRIDE)

**Target for decimator test** (RESEARCH lines 1471-1477):

```javascript
// --- Bucket range inline derivation (per Pitfall 1: 2-12 or 5-12, NOT 1-8) ---
test('bucket-range: inline derivation uses 12 (BASE) and 5 or MIN_BUCKET_NORMAL', () => {
  const src = readFileSync(PANEL, 'utf8');
  // Accept either direct literal 12 OR named constant via destructure from constants.js.
  // Direct literal check -- panel must encode the bucket range somewhere.
  assert.match(src, /\b12\b/);
  assert.match(src, /\b(5|MIN_BUCKET_NORMAL)\b/);
});

test('bucket-range: centennial check uses level % 100', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /level\s*%\s*100/);
});
```

**What this catches:** A Wave 1 implementer who read CONTEXT D-03 without reading RESEARCH Pitfall 1 might write `bucketRange = [1, 2, 3, 4, 5, 6, 7, 8]`. The `\b12\b` assertion fails because `12` is not in the source. The `level % 100` assertion catches anyone who hard-codes the range without the centennial branch.

---

#### Pattern 8: Skeleton + score-unit + empty-state tests (COPY VERBATIM shape from baf-panel)

**Target for decimator test** (RESEARCH lines 1450-1483):

```javascript
// --- Skeleton + content pattern ---
test('decimator-panel.js has data-bind="skeleton" and data-bind="content"', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']skeleton["']/);
  assert.match(src, /data-bind=["']content["']/);
});
test('decimator-panel.js includes skeleton-shimmer', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /skeleton-shimmer/);
});

// --- Score-unit discipline (wei-scale amounts -> formatBurnie / formatEth) ---
test('score-unit: decimator-panel uses formatBurnie for BURNIE amounts', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /formatBurnie/);
});
test('score-unit: decimator-panel uses formatEth for ETH payout amounts', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /formatEth/);
});

// --- Empty state handling ---
test('decimator-panel.js handles empty state (no burn / bucket null)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /bucket\s*==\s*null|bucket\s*===\s*null|!bucket|No decimator activity/);
});
```

**Delta vs baf-panel score-unit test:** Phase 55 asserts BOTH `formatBurnie` AND `formatEth` (baf-panel only asserts `formatBurnie` because BAF has no ETH amounts in the leaderboard). Decimator has ETH payouts (`payoutAmount`) alongside BURNIE burns (`effectiveAmount`, `weightedAmount`).

**Total target:** ~30-35 assertions. Exact count: 4 (existence) + 8 (SHELL-01) + 3 (store wiring) + 12 (DECIMATOR-01..05 + INTEG-03) + 3 (stale-guards) + 2 (bucket range) + 2 (skeleton) + 2 (score-unit) + 1 (empty state) = **37 assertions**. Slightly over the RESEARCH estimate of 30-35; the extra comes from Phase 55's +1 subscription test + the TWO bucket-range tests (one for literals, one for centennial check). 37 is still comparable to baf-panel's 42.

---

### `play/app/__tests__/play-shell-01.test.js` (MODIFY: add 3 FORBIDDEN entries)

**Analog:** The file itself lines 22-34 -- the existing FORBIDDEN array (11 entries after Phase 54) is the shape to extend.

**Analog excerpt** (play-shell-01.test.js lines 22-34 -- VERIFIED via read):

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
  { label: 'beta/components/baf-panel.js (Phase 54: transitively wallet-tainted + tag-name collision)', pattern: /from\s+['"][^'"]*\/beta\/components\/baf-panel\.js['"]/ },
  { label: 'beta/app/coinflip.js (Phase 54: ethers at line 4)', pattern: /from\s+['"][^'"]*\/beta\/app\/coinflip\.js['"]/ },
  { label: 'beta/app/baf.js (Phase 54: transitively tainted via utils.js)', pattern: /from\s+['"][^'"]*\/beta\/app\/baf\.js['"]/ },
];
```

**What to change when adapting** (RESEARCH lines 225-233, Pitfall 5 and 6 at lines 1584-1598): Add three entries BEFORE the array close-bracket:

```javascript
  { label: 'beta/components/terminal-panel.js (Phase 55: wallet-tainted + tag-name collision)', pattern: /from\s+['"][^'"]*\/beta\/components\/terminal-panel\.js['"]/ },
  { label: 'beta/app/decimator.js (Phase 55: ethers at line 4)', pattern: /from\s+['"][^'"]*\/beta\/app\/decimator\.js['"]/ },
  { label: 'beta/app/terminal.js (Phase 55: ethers at line 6)', pattern: /from\s+['"][^'"]*\/beta\/app\/terminal\.js['"]/ },
```

Net result: FORBIDDEN grows from 11 entries to 14.

**Gotcha:** The existing `beta/components/decimator-panel.js` entry at line 30 stays unchanged -- it was added in a prior phase (Phase 50 Wave 0 per SHELL-01 inception; at that point it was a noop stub but the entry future-proofed) and is still required because beta's decimator-panel.js line 246 calls `customElements.define('decimator-panel', ...)` which would collide with play's at module-load time.

---

### `.planning/phases/55-decimator/INTEG-03-SPEC.md` (spec doc) -- CREATE

**Analog:** `.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md` (237 LOC) -- exact structural template. Section-by-section mapping below. Phase 52's `INTEG-01-SPEC.md` and Phase 51's `INTEG-02-SPEC.md` are secondary.

**Section structure to copy verbatim** (with INTEG-03 content per RESEARCH Section 8 lines 372-727):

| Section # | INTEG-05 Source Lines | INTEG-03 Content Source |
|-----------|----------------------|-------------------------|
| 1. Header block | INTEG-05-SPEC lines 1-7 | Phase 55, INTEG-03, DRAFT, solo dev self-coordination, 2026-04-24 |
| 2. Why This Endpoint Is Needed | lines 9-15 | RESEARCH lines 376-383 (per-level, per-player; existing `/player/:address?day=N` claimablePerLevel lacks bucket/subbucket) |
| 3. Endpoint | lines 17-31 | RESEARCH line 386: `GET /player/:address/decimator?level=N&day=M` |
| 4. Path Parameters | lines 21-23 | same addressParamSchema validation |
| 5. Query Parameters | lines 25-31 | `level` required; `day` optional (NEW vs INTEG-05 which had no day). RESEARCH lines 394-398. |
| 6. Response JSON Schema | lines 33-53 | RESEARCH lines 401-413 -- 9 fields: `level`, `player`, `bucket`, `subbucket`, `effectiveAmount`, `weightedAmount`, `winningSubbucket`, `payoutAmount`, `roundStatus` |
| 7. Edge cases | (INTEG-05 lines 55-63 is a simpler 2-column table) | RESEARCH lines 429-436 -- 5-row table covering all roundStatus/bucket combos |
| 8. roundStatus Derivation | lines 65-81 | RESEARCH lines 437-458 -- THREE states (open/closed/not_eligible), pseudo-code + SQL snippet |
| 9. Contract-Call Map | lines 83-93 | RESEARCH lines 461-472 -- field-to-source map (5-table join) |
| 10. Proposed Backend Implementation | lines 95-173 | RESEARCH lines 474-650 -- the Drizzle handler (~150 LOC) + schema imports |
| 11. New Schema Definitions | lines 175-193 | RESEARCH lines 652-674 -- `decimatorQuerySchema` + `decimatorPlayerResponseSchema` |
| 12. Error Modes | lines 195-203 | RESEARCH lines 677-685 -- 200/400/404 table |
| 13. Acceptance Criteria | lines 205-214 | RESEARCH lines 687-700 -- 11 criteria (bucket range, subbucket range, etc.) |
| 14. Timeline | lines 216-224 | RESEARCH lines 702-710 -- 3 atomic commits (feat/docs/test), same pattern as INTEG-05 |
| 15. Open Questions | lines 226-230 | RESEARCH lines 712-718 -- 5 questions (primary query, multi-row, expose totals, naming, error code) |
| 16. Confidence | lines 232-237 | RESEARCH lines 720-728 |

**What to change when adapting from INTEG-05-SPEC:**

- INTEG-05 is a **new-route class** (`/player/:address/baf`); INTEG-03 is also a **new-route class** (`/player/:address/decimator`). Same new-route rationale.
- INTEG-03 includes an optional `?day=M` query parameter. INTEG-05 did NOT. Add the day-resolution block (matches Phase 52 INTEG-01's `?day=M` pattern via daily_rng lookup). RESEARCH lines 520-537 has the handler code.
- Data source is FIVE tables (`decimator_burns`, `decimator_bucket_totals`, `decimator_winning_subbuckets`, `decimator_rounds`, `decimator_claims`) vs INTEG-05's ONE primary table (`baf_flip_totals`) + two secondary (`baf_skipped`, `jackpot_distributions`). More complex query.
- `roundStatus` has THREE states (open/closed/not_eligible) vs INTEG-05's FOUR (open/closed/skipped/not_eligible). Decimator has no coinflip-loss gate, so no `skipped` state.
- Response has 9 fields (more than INTEG-05's 6) because Phase 55 exposes bucket + subbucket + two amount fields + winning + payout.
- `weightedAmount` is a DERIVED field (`effectiveAmount / bucket`, BigInt divide). This is the novel "semantic layer" per RESEARCH Q4 at lines 715-717 -- document in the openapi description as "UI-convenient pre-division; actual pro-rata uses full effectiveAmount".

**Gotcha:** INTEG-03 is slightly more complex than INTEG-05 (5 tables vs 3, 3-state status vs 4-state but with optional day-scope vs none). Budget 10-15 minutes for careful implementation in the database repo (vs ~3-5 minutes for prior INTEGs). RESEARCH lines 710, 765 both flag this.

**Sections that should be copied verbatim (just with INTEG-03 content):**
- Header format (4 lines)
- "Why This Endpoint Is Needed" paragraph shape (1-2 short paragraphs)
- Table header formats (Edge cases, Error Modes, Contract-Call Map)
- SQL pseudo-code block format (three-branch IF cascade)
- Timeline's numbered-commits list
- "Confidence" bullet list format

---

## Shared Patterns

### Imports (wallet-free surface)

**Source:** `play/app/constants.js` lines 1-13 + `beta/viewer/utils.js` lines 1-38 + `beta/app/store.js` (via `../../beta/app/store.js`)
**Apply to:** `play/components/decimator-panel.js`

Header for the panel file:

```javascript
import { subscribe, get } from '../../beta/app/store.js';
import { API_BASE } from '../app/constants.js';
import { formatBurnie, formatEth, truncateAddress } from '../../beta/viewer/utils.js';
```

**Gotcha:** Phase 55 imports `formatEth` (needed for `payoutAmount` rendering) alongside `formatBurnie` (needed for `effectiveAmount`, `weightedAmount`, terminal `burn.effectiveAmount`, `burn.weightedAmount`). `truncateAddress` is imported for consistency with baf-panel but is NOT strictly necessary -- decimator-panel doesn't render arbitrary player addresses (only the selected player's, which is already rendered by the player-selector in Phase 50). Keep it to match the convention; the test assertion is opt-in (`/truncateAddress/` is not in the Phase 55 required-assertions list).

---

### SHELL-01 wallet-free fence

**Source:** `play/app/__tests__/play-shell-01.test.js` lines 22-34 (FORBIDDEN array, extended in Wave 0 by +3)
**Apply to:** Every file in `play/` tree (enforced by recursive scan)

After Wave 0 edit, FORBIDDEN has 14 entries covering:
- `ethers` bare specifier
- `beta/app/wallet.js`, `beta/app/contracts.js`, `beta/app/utils.js`
- `beta/components/connect-prompt.js`, `/purchase-panel.js`, `/coinflip-panel.js`, `/decimator-panel.js`, `/baf-panel.js`
- `beta/app/coinflip.js`, `beta/app/baf.js`
- **NEW for Phase 55:** `beta/components/terminal-panel.js`, `beta/app/decimator.js`, `beta/app/terminal.js`

**Gotcha:** The recursive scanner walks every `.js` and `.html` file under `play/` (excluding `play/app/__tests__/` itself via `isInTestsDir()` filter). Phase 55's decimator-panel.js file is caught by the scan automatically -- no additional test wiring needed. The scanner runs once per test invocation; adding 3 FORBIDDEN entries adds ~150μs of grep time (negligible).

---

### Score-unit discipline

**Source:** 55-RESEARCH.md Section 10 + Pitfall 8
**Apply to:** `play/components/decimator-panel.js` render helpers + terminal sub-section renderer

| Data field | Scale | Sample value | Render with |
|------------|-------|--------------|-------------|
| `data.effectiveAmount` (INTEG-03) | WEI-scale BURNIE | "5832100000000000000000" | `formatBurnie(value) + ' BURNIE'` |
| `data.weightedAmount` (INTEG-03) | WEI-scale BURNIE | "833157142857142857142" | `formatBurnie(value) + ' BURNIE'` |
| `data.payoutAmount` (INTEG-03) | WEI-scale ETH | "41235700000000000000" | `formatEth(value) + ' ETH'` |
| `data.bucket` / `data.subbucket` (INTEG-03) | Integer | 7 / 3 | `String(value)` directly |
| `data.winningSubbucket` (INTEG-03) | Integer | 3 | `String(value)` directly |
| `scoreBreakdown.totalBps` (extended player) | Integer (bps) | 23100 (= 2.31) | `(value / 10000).toFixed(2)` |
| `decimator.windowOpen` (extended player) | Boolean | true/false | `value ? 'OPEN' : 'CLOSED'` |
| `terminal.burns[].effectiveAmount` | WEI-scale BURNIE | "1234500000000000000000" | `formatBurnie(value)` |
| `terminal.burns[].weightedAmount` | WEI-scale BURNIE | "1850000000000000000000" | `formatBurnie(value)` |
| `terminal.burns[].timeMultBps` | Integer (bps) | 15000 (= 1.50x) | `formatTimeMultiplier(value)` |
| `terminal.burns[].level` | Integer | 95 | `String(value)` directly |

**Critical:** `effectiveAmount` and `weightedAmount` are BOTH wei-scale BURNIE (Pitfall 8 line 1608-1616). Both `formatBurnie(value)`. DO NOT call `formatEth` on either. `payoutAmount` is the ONLY ETH field on INTEG-03 responses.

**Warning signs of bugs:**
- UI shows "5,832,100,000,000,000,000,000 BURNIE" (raw wei string treated as integer -- forgot formatBurnie).
- UI shows "0.00000000000000000000004124 ETH" (wei divided by 10^36 -- double-formatted or wrong formatter).
- UI shows "2310" activity score (forgot the /10000 divide).
- UI shows "13500%" time multiplier (forgot the /10000 divide; should be "1.35x").

---

### DOM rendering (textContent for dynamic; innerHTML ONLY for static TEMPLATE)

**Source:** `play/components/profile-panel.js` lines 25-29 (T-51-01 comment) + `play/components/baf-panel.js` line 40 (T-54-01 comment) + document.createElement row builder pattern at baf-panel lines 254-280
**Apply to:** decimator-panel for ALL dynamic row rendering (bucket table rows, terminal burn rows, payout-pill text updates)

Static `innerHTML = TEMPLATE` is safe because TEMPLATE is a compile-time string with no interpolation. All dynamic row rendering uses `document.createElement` + `element.textContent = value` per baf-panel lines 254-280 pattern -- NEVER `element.innerHTML = userString`.

```javascript
// CORRECT (baf-panel.js lines 254-268):
const row = document.createElement('div');
row.className = 'play-baf-entry';
row.setAttribute('data-rank', String(entry.rank));

if (lowerSelected && entry.player && entry.player.toLowerCase() === lowerSelected) {
  row.setAttribute('aria-current', 'true');
}

const rankCell = document.createElement('span');
rankCell.textContent = `#${entry.rank}`;
// ...

// INCORRECT (would be XSS if data contained HTML):
container.innerHTML = buckets.map(b => `<div>${b}</div>`).join('');
```

**Gotcha:** Neither `data.bucket` (integer) nor `data.subbucket` (integer) nor `burn.level` (integer) can contain HTML, so from a security standpoint template interpolation COULD be used. But keep the textContent discipline uniformly to avoid future regressions when a refactor accidentally pipes a user-string through the same pathway. Matches T-54-01 / T-51-01 security hardening.

---

### Unsub cleanup pattern

**Source:** `play/components/decimator-panel.js` (Phase 50 stub) lines 34-37 + `play/components/baf-panel.js` lines 135-138 (VERIFIED identical shape)
**Apply to:** decimator-panel -- already correct in Phase 50 stub, no changes needed

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

**Gotcha:** Do NOT forget to push THREE subscribe returns in Phase 55 connectedCallback (replay.level + replay.player + replay.day). Forgetting one creates a memory leak on panel re-mount. The test asserts all three subscribe calls exist (Pattern 4 above), which indirectly catches a missing push.

---

### Stale-guard + keep-old-data-dim (D-17 / D-18 carry-forward)

**Source:** `play/components/baf-panel.js` lines 117-118 (counter declarations) + 142-207 (both refetch methods) + play.css `.is-stale` rules (Phase 51+52+54 pattern)
**Apply to:** decimator-panel -- two counters named `#decimatorPlayerFetchId` and `#decimatorLevelFetchId` per RESEARCH Section 11 line 1165

The `.is-stale` class toggle is identical to Phase 51+52+54. Each panel owns its own counters so one panel's rapid scrub doesn't invalidate another's response. The dim is applied at `[data-bind="content"]` scope inside the panel (not at the panel root).

**Analog CSS** (play.css Phase 54 precedent for baf-panel):

```css
.play-baf-panel [data-bind="content"] {
  transition: opacity 0.2s ease;
}
.play-baf-panel [data-bind="content"].is-stale {
  opacity: 0.6;
  pointer-events: none;
}
```

**Target additions** (Pattern 3 in play.css section above; same shape):

```css
.play-decimator-panel [data-bind="content"] {
  transition: opacity 0.2s ease;
}
.play-decimator-panel [data-bind="content"].is-stale {
  opacity: 0.6;
  pointer-events: none;
}
```

**Gotcha:** Which refetch toggles the dim? Per RESEARCH Section 11 lines 1175-1177, ONLY `#refetchPlayer` toggles the dim (because it fires on replay.player + replay.day AND is the heavier fetch). `#refetchLevel` does NOT dim (INTEG-03 is fast and light; a double-dim would look choppy). Baf-panel has the same asymmetry -- only `#refetchLeaderboard` dims.

---

## Wallet-Taint Fence (MUST READ)

The following files **must not** be imported by any new or modified file in `play/`:

| File | Reason |
|------|--------|
| `beta/app/utils.js` | `import { ethers } from 'ethers'` at line 3 |
| `beta/app/contracts.js` | Imports ethers at line 5 |
| `beta/app/wallet.js` | EIP-6963 wallet discovery |
| `beta/app/coinflip.js` | `import { ethers } from 'ethers'` at line 4 |
| `beta/app/baf.js` | Transitively tainted via `./utils.js` import |
| `beta/app/decimator.js` | **NEW Phase 55:** `import { ethers } from 'ethers'` at line 4 |
| `beta/app/terminal.js` | **NEW Phase 55:** `import { ethers } from 'ethers'` at line 6 |
| `beta/components/coinflip-panel.js` | Tag-name collision + imports `beta/app/coinflip.js` |
| `beta/components/baf-panel.js` | Tag-name collision + imports `beta/app/baf.js` |
| `beta/components/decimator-panel.js` | Tag-name collision + imports `beta/app/decimator.js` + `beta/app/utils.js` |
| `beta/components/terminal-panel.js` | **NEW Phase 55:** Tag-name collision (`terminal-panel`) + imports `beta/app/terminal.js` + `beta/app/utils.js` |
| `beta/components/connect-prompt.js` | Wallet UI |
| `beta/components/purchase-panel.js` | Wallet writes |

**Safe beta/ imports for Phase 55:**

| File | Purpose |
|------|---------|
| `beta/app/store.js` | `subscribe`, `update`, `get`, `batch` (verified wallet-free) |
| `beta/viewer/utils.js` | `formatEth`, `formatBurnie`, `truncateAddress`, `formatWei` (explicit SHELL-01 comment at line 2) |
| `beta/styles/*.css` | Already linked from `play/index.html` -- NOT imported at runtime, but `beta/styles/decimator.css` and `beta/styles/terminal.css` are PATTERN REFERENCES (read-only research) NOT linked from play/index.html. Phase 55 writes new rules directly into `play/styles/play.css` under `.play-decimator-panel` scope. |

---

## No Analog Found

None are truly without analog. Every new surface in Phase 55 has a direct Phase 51 or Phase 54 predecessor. The "novel" sub-patterns within decimator-panel.js are:

| Novelty | Closest analog | Risk |
|---------|----------------|------|
| Three subscriptions (vs baf-panel's two) | baf-panel's two-subscribe + profile-panel's two-subscribe | NONE -- just one more push() call |
| Bucket table rendering (no prior-phase row-from-integer-range loop) | baf-panel's `#renderLeaderboard` row loop (data-array-based) | LOW -- same document.createElement shape, just loop over `bucketRange(level)` instead of `entries` |
| Conditional terminal sub-section (hide whole `<div>` when no data) | baf-panel's `#renderYourRank` hides the row on null rank | LOW -- same `section.hidden = true` pattern, just applied at sub-section scope |
| `data-winning` attribute on bucket table row | BAF's `data-rank` attribute on leaderboard row | LOW -- same attribute-driven CSS approach |
| `bucketRange(level)` inline helper | baf-panel's `bafContext(level)` inline helper | NONE -- same inline-helper pattern |
| Three-state roundStatus label (vs BAF's four) | baf-panel's `#renderRoundStatus` LABELS object | NONE -- fewer keys in the map |
| Optional `?day=M` on INTEG-03 URL | Phase 52 INTEG-01 `/tickets/by-trait?day=M` | NONE -- same conditional URL construction |

**Confidence HIGH across all novelties.** Every pattern has a direct structural precursor within the Phase 50-54 shipped code.

---

## Pattern Assignment to Plans (planner guidance)

The planner will likely produce 4 plans matching Phase 54's Wave 0/1/2/3 cadence. Recommended distribution:

**Plan 55-01 (Wave 0 -- autonomous, pre-backend):**
- CREATE `play/app/__tests__/play-decimator-panel.test.js` per Pattern 1-8 above (~37 assertions)
- MODIFY `play/app/__tests__/play-shell-01.test.js` FORBIDDEN array: +3 entries
- CREATE `.planning/phases/55-decimator/INTEG-03-SPEC.md` per INTEG-05-SPEC.md template with RESEARCH Section 8 content

**Plan 55-02 (Wave 1 -- autonomous, pre-backend):**
- MODIFY `play/components/decimator-panel.js`: Phase 50 stub -> hydrated via Patterns 1-10 above. Wave 1 focus:
  - DECIMATOR-01 window badge (binary OPEN/CLOSED from `decimator.windowOpen`; Wave 2 upgrades to 3-state)
  - DECIMATOR-03 partial (effective/weighted from INTEG-03 when available; "--" placeholder otherwise)
  - DECIMATOR-05 terminal sub-section (conditional on `terminal.burns.length > 0`, live from extended player endpoint)
  - D-07 activity score cross-reference
  - `#refetchLevel()` ships as safe-degrade stub (404-silent fallback)
  - Bucket table renders correct range per `bucketRange(level)` WITHOUT aria-current (pre-INTEG-03)
- MODIFY `play/styles/play.css`: append Phase 55 section (~150 LOC) per Patterns 1-4 in the CSS section above

**Plan 55-03 (Wave 2 -- hard-gated on INTEG-03):**
- SIDE-QUEST in `database/` repo: 3-commit INTEG-03 delivery per INTEG-03-SPEC.md (feat/docs/test)
- MODIFY `play/components/decimator-panel.js`: no structural change expected. Verify INTEG-03 response shape matches spec. Confirm:
  - DECIMATOR-02 bucket/subbucket populated (stats row + aria-current on bucket table)
  - DECIMATOR-04 payout pill populates "You won X ETH" / "Not your subbucket" correctly
  - DECIMATOR-03 full weightedAmount correct (not "--" placeholder)
  - Window badge upgrades from binary to 3-state on `#refetchLevel` completing
- Run full `node --test play/app/__tests__/*.test.js` to confirm no regressions

**Plan 55-04 (Wave 3 -- manual UAT, optional, deferrable):**
- Manual UAT per RESEARCH Section 12 "Manual-Only Verifications" table (lines 1513-1524):
  - Bucket table renders correct range per level type (centennial vs normal)
  - Player's bucket row highlighted when burned
  - Payout pill state machine across open/closed/not-eligible
  - Winning subbucket cell highlights correctly on resolved rounds
  - Terminal sub-section renders ONLY when burns exist
  - Terminal time-multiplier format correctness
  - Activity-score updates on day scrub
  - Rapid scrub doesn't flash stale data
  - Empty state for player with no decimator activity
  - Window badge transitions on `decimator.windowOpen` flip
- Likely deferred per Phase 50/51/52/53/54 precedent chain. Record deferral in `55-UAT.md`.

---

## Metadata

**Analog search scope:**
- `/home/zak/Dev/PurgeGame/website/play/` (full tree -- 10 existing components + 5 tests + bootstrap + 1 stylesheet)
- `/home/zak/Dev/PurgeGame/website/beta/components/{decimator,terminal}-panel.js` (visual ref only; wallet-tainted; read for layout structure)
- `/home/zak/Dev/PurgeGame/website/beta/app/{decimator,terminal}.js` (helper ref only; ethers-tainted at lines 4 and 6; inline-only pattern extraction)
- `/home/zak/Dev/PurgeGame/website/beta/styles/{decimator,terminal}.css` (CSS layout source)
- `/home/zak/Dev/PurgeGame/website/beta/viewer/utils.js` (wallet-free formatter surface)
- `/home/zak/Dev/PurgeGame/website/.planning/phases/54-coinflip-baf/` (baf-panel + INTEG-05-SPEC + 54-PATTERNS as structural references)
- `/home/zak/Dev/PurgeGame/website/.planning/phases/51-profile-quests/` (profile-panel + INTEG-02-SPEC as secondary references)

**Files scanned:** 11 source files + 3 test files + 2 spec docs + 2 CSS files + 1 CONTEXT + 1 RESEARCH

**Pattern extraction date:** 2026-04-24

**Planner target:** 4 plans mirroring Phase 54 Wave 0/1/2/3 cadence. Wave 3 UAT likely deferred per precedent chain. INTEG-03 side-quest is the single hard gate.

## PATTERN MAPPING COMPLETE

**Phase:** 55 - Decimator
**Files classified:** 5 (1 modify panel + 1 modify CSS + 1 modify shell-01 test + 1 create panel test + 1 create INTEG spec)
**Analogs found:** 5 / 5 (100%)

### Coverage
- Files with exact analog: 5
- Files with role-match analog: 0
- Files with no analog: 0

### Key Patterns Identified
- **baf-panel.js is the dominant structural template** -- all six methods (connected/disconnected callbacks, two refetch methods, two render helpers, one showContent) transfer nearly verbatim with identifier renames.
- **Three-subscription cadence** extends baf-panel's two-signal pattern by adding `replay.day`. Needed because terminal.burns + scoreBreakdown.totalBps are day-scoped, and INTEG-03 optionally block-scopes by day.
- **Two-counter stale-guard** (`#decimatorPlayerFetchId` + `#decimatorLevelFetchId`) mirrors baf-panel's `#bafFetchId` + `#bafPlayerFetchId`. Dual counters keep day-scoped and level-scoped fetches independent.
- **Inline helpers** (`bucketRange` + `formatTimeMultiplier`) follow Phase 54's inline `bafContext` decision -- avoids a new play/app helper file + avoids importing from wallet-tainted beta/app/* helpers.
- **Contract-truth override** (CONTEXT D-03 says buckets 1-8; contract source says 5-12 / 2-12). Inline constants `DECIMATOR_BUCKET_BASE = 12` + `DECIMATOR_MIN_BUCKET_NORMAL = 5` + `DECIMATOR_MIN_BUCKET_100 = 2` encode the correct range. Wave 0 test asserts the literals `\b12\b` and `\b5\b`.
- **Conditional terminal sub-section** via `section.hidden = true` when `terminal === null || terminal.burns.length === 0`. Hide the ENTIRE section (including header) -- don't render an empty table.
- **Score-unit discipline** (Pitfall 8): `effectiveAmount` + `weightedAmount` are WEI-scale BURNIE (`formatBurnie`); `payoutAmount` is WEI-scale ETH (`formatEth`); `bucket` + `subbucket` + `winningSubbucket` are integers (`String(value)`); `scoreBreakdown.totalBps` is integer bps (`(v/10000).toFixed(2)`); `timeMultBps` is integer bps (`formatTimeMultiplier(v)`).

### File Created
`/home/zak/Dev/PurgeGame/website/.planning/phases/55-decimator/55-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns in PLAN.md files. All critical overrides (bucket range, drop time-remaining) are documented at the top of this file for planner attention.
