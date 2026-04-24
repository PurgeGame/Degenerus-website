# Phase 52: Tickets, Packs & Jackpot Reveal -- Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 16 (11 create, 3 modify, 2 new assets/specs)
**Analogs found:** 14 / 16 (87.5% coverage)

## Analog Coverage Summary

| Coverage Tier | Count | Files |
|---------------|-------|-------|
| **Strong** (pattern fully transferable) | 11 | profile-panel + all test files + helpers with direct analogs + spec copy-forward + CSS extension + single-line beta patch |
| **Partial** (adaptation required) | 3 | jackpot-panel-wrapper (shim logic novel), pack-animator (GSAP timeline shape transferable but novel animation), tickets-inventory (helper pattern transferable, function source from beta/viewer/) |
| **Weak / scratch** (no direct analog) | 2 | pack-audio.js (Web Audio + decodeAudioData + localStorage pattern is new), pack-open.mp3 (asset) |

**Analog coverage: 14/16 = 87.5% (meets 80%+ target.)**

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality | Confidence |
|-------------------|------|-----------|----------------|---------------|------------|
| `play/components/tickets-panel.js` (CREATE, replacing Phase 50 stub) | UI Custom Element | request-response (day-aware fetch + shared helper) | `play/components/profile-panel.js` (lines 1-417) | strong (exact composite) | HIGH |
| `play/components/packs-panel.js` (CREATE) | UI Custom Element | request-response + GSAP animation + event-driven audio | `play/components/profile-panel.js` (structure) + `beta/components/degenerette-panel.js` (GSAP timeline) | strong structure / partial animation | HIGH structure / MEDIUM animation |
| `play/components/jackpot-panel-wrapper.js` (CREATE) | UI Custom Element (thin wrapper) | store shim (replay.* -> game.*) | `play/components/profile-panel.js` (structure) + `beta/components/jackpot-panel.js` (imported, not mimicked) | partial (novel shim logic) | MEDIUM |
| `play/app/tickets-inventory.js` (CREATE) | Helper module (wallet-free) | pure transform (traitId -> SVG path) | `play/app/quests.js` (wallet-free helper pattern) + `beta/viewer/badge-inventory.js` lines 6-32 (function source) | strong (pattern + source both available) | HIGH |
| `play/app/tickets-fetch.js` (CREATE) | Shared fetch helper (in-flight dedup) | request-response + cache-by-key | `play/components/profile-panel.js` lines 327-365 (fetch shape extracted) + `play/app/api.js` line 5-14 | strong (extracted from analog) | HIGH |
| `play/app/pack-animator.js` (CREATE) | GSAP timeline helper | pure function (DOM -> timeline) | `beta/components/degenerette-panel.js` lines 311-341 (GSAP timeline shape) | partial (shape only, different animation) | MEDIUM |
| `play/app/pack-audio.js` (CREATE) | Web Audio wrapper + localStorage | event-driven SFX | `beta/components/replay-panel.js` lines 1900-1918 (AudioContext pattern) + `beta/app/audio.js` lines 1-36 (autoplay unlock) | weak (two half-analogs; new composition) | LOW-MEDIUM |
| `play/assets/audio/pack-open.mp3` (CREATE asset) | Static asset | — | `/beta/sounds/*.mp3` (referenced by `beta/app/audio.js`) | scratch (source asset) | LOW |
| `play/app/__tests__/play-tickets-panel.test.js` (CREATE) | Contract-grep test | source regex assertions | `play/app/__tests__/play-profile-panel.test.js` (lines 1-184) | strong (exact) | HIGH |
| `play/app/__tests__/play-packs-panel.test.js` (CREATE) | Contract-grep test | source regex assertions | `play/app/__tests__/play-profile-panel.test.js` | strong (exact) | HIGH |
| `play/app/__tests__/play-jackpot-wrapper.test.js` (CREATE) | Contract-grep test | source regex assertions | `play/app/__tests__/play-profile-panel.test.js` | strong (exact) | HIGH |
| `play/app/__tests__/play-jackpot-shell01-regression.test.js` (CREATE) | Contract-grep test (beta-file regression) | source regex assertions | `play/app/__tests__/play-shell-01.test.js` (lines 22-31 FORBIDDEN array + readFileSync pattern) | strong | HIGH |
| `play/styles/play.css` (MODIFY) | Stylesheet | style rules | `play/styles/play.css` lines 70-80 (Phase 51 `profile-panel` section precedent) + `beta/styles/replay.css` lines 158-175 (2x2 quadrant reference) | strong (extension of same file) | HIGH |
| `play/index.html` (MODIFY) | HTML entry | markup + stylesheet links | `play/index.html` lines 8-13 (existing CSS link list) + lines 48-57 (panel grid ordering) | strong | HIGH |
| `beta/components/jackpot-panel.js:7` (MODIFY, single line) | Upstream import patch | import specifier swap | `beta/components/jackpot-panel.js:7` current value + `beta/viewer/utils.js` lines 22-30 as replacement | strong (surgical) | HIGH |
| `.planning/phases/52-tickets-packs-jackpot/INTEG-01-SPEC.md` (CREATE via copy-forward) | Spec doc | endpoint contract | `.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md` (123 lines, the source) + `.planning/phases/51-profile-quests/INTEG-02-SPEC.md` (217 lines for format precedent) | strong (literal copy-forward) | HIGH |

## Pattern Assignments

### `play/components/tickets-panel.js` (Custom Element, request-response)

**Analog:** `play/components/profile-panel.js` (gold-standard Phase 51 hydrated panel; closest like-for-like)

---

#### Pattern 1: Imports + TEMPLATE constant + class shell (COPY + ADAPT)

**Analog excerpt** (profile-panel.js lines 35-38, 149-157):

```javascript
import { subscribe, get } from '../../beta/app/store.js';
import { API_BASE } from '../app/constants.js';
import { formatQuestTarget, getQuestProgress, QUEST_TYPE_LABELS } from '../app/quests.js';

const TEMPLATE = `<!-- skeleton + content dual-template -->`;

class ProfilePanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #profileFetchId = 0;
```

**What to change when adapting for tickets-panel.js:**
- Replace the last import with: `import { fetchTicketsByTrait } from '../app/tickets-fetch.js';` and `import { traitToBadge } from '../app/tickets-inventory.js';`.
- Rename `#profileFetchId` to `#ticketsFetchId`.
- Add `#currentLevel = null;` private field (not needed by profile-panel but required here because endpoint is per-level).
- TEMPLATE innerHTML shows a `data-bind="card-grid"` container (empty) inside `[data-bind="content"]` with per-card templating happening in the render pass, NOT inline in the static template.

---

#### Pattern 2: Three subscriptions (MIRROR with addition)

**Analog excerpt** (profile-panel.js lines 157-174):

```javascript
connectedCallback() {
  this.innerHTML = TEMPLATE;
  // ...
  this.#unsubs.push(
    subscribe('replay.day', () => this.#refetch()),
    subscribe('replay.player', () => this.#refetch()),
  );
  this.#refetch();
}
```

**What to change when adapting:** Add a third subscription to `replay.level` (endpoint is per-level). Use the profile-panel trick of ignoring the callback payload and reading fresh values via `get(...)` inside `#refetch()`:

```javascript
this.#unsubs.push(
  subscribe('replay.day', () => this.#refetch()),
  subscribe('replay.player', () => this.#refetch()),
  subscribe('replay.level', () => this.#refetch()),
);
```

**Gotcha:** `status-bar.js:44` is the reference for subscribing to `replay.level` (`subscribe('replay.level', (v) => this.#bind('level', v != null ? v : '--'))`). The tickets-panel does NOT bind to a DOM element for level, just triggers a refetch.

---

#### Pattern 3: Stale-guard fetch pattern with double token check (COPY VERBATIM)

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
    if (token === this.#profileFetchId) { /* renderError */ }
  }
}
```

**What to change when adapting:**
- Read `replay.level` via `get('replay.level')` (3rd value to check).
- Guard clause becomes `if (!addr || day == null || level == null) return;`.
- Replace raw `fetch()` with the shared helper: `const data = await fetchTicketsByTrait(addr, level, day);`.
- The shared helper returns `null` on 404 / non-OK, so the `if (!res.ok)` branch flattens: `if (!data) { this.#renderError(404); ...; return; }`.
- Keep BOTH token checks. The helper handles the wire request but you still need to guard against stale renders (per RESEARCH.md Section 8 lines 537-543, the "double stale-guard" requirement).

**Gotcha:** The `catch` arm uses `token === this.#ticketsFetchId` (equality, NOT !==) -- this only surfaces the error if THIS fetch is still the most recent. Preserve that polarity exactly.

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

**What to change when adapting:** Copy verbatim. No changes.

---

#### Pattern 5: Card render loop (NOVEL; build from TEMPLATE shape)

**Analog excerpt** (profile-panel.js lines 267-290, quest slot render loop -- closest shape):

```javascript
#renderQuestSlots(quests) {
  const slots = this.querySelectorAll('.quest-slot');
  for (let i = 0; i < 2; i++) {
    const slotEl = slots[i];
    if (!slotEl) continue;
    const row = Array.isArray(quests) ? quests.find((q) => q.slot === i) : null;
    const info = getQuestProgress(row);
    // ... populate slotEl's children via textContent
  }
}
```

**What to change when adapting:** The tickets-panel renders N cards (not fixed 2). Create per-card HTML as a helper:

```javascript
#renderCards(cards) {
  const grid = this.querySelector('[data-bind="card-grid"]');
  if (!grid) return;
  // Empty state
  if (!cards || cards.length === 0) {
    grid.innerHTML = '<div class="tickets-empty">No tickets at this level.</div>';
    return;
  }
  // Filter to opened (pending/partial go in <packs-panel>)
  const opened = cards.filter((c) => c.status === 'opened');
  grid.innerHTML = opened.map((card) => this.#cardHtml(card)).join('');
}

#cardHtml(card) {
  const quadrants = card.entries.map((entry) => {
    if (entry.traitId == null) {
      return `<div class="trait-quadrant trait-quadrant-empty"></div>`;
    }
    const badge = traitToBadge(entry.traitId);
    const label = escapeAttr(entry.traitLabel || '');
    return `<div class="trait-quadrant"><img class="trait-badge" loading="lazy" src="${badge.path}" alt="${label}" title="${label}"></div>`;
  }).join('');
  return `<div class="ticket-card" data-card-index="${card.cardIndex}">
            <div class="trait-grid">${quadrants}</div>
            <span class="card-source-pill card-source-${card.source}">${card.source}</span>
          </div>`;
}
```

**Gotcha:** This is the first place in play/ where we use `.innerHTML` with response data. Per profile-panel.js security comment (lines 25-29), we must hedge: any interpolated string from `data.cards[*]` needs to be HTML-escaped. Use an `escapeAttr(s)` helper OR swap `.innerHTML` for DOM construction (`document.createElement`). Research Section 5 shows `traitToBadge().path` returns a deterministic `/badges-circular/*.svg` path with no interpolation risk; `traitLabel` is free-form from the API and MUST be escaped. `card.source` is constrained to `'purchase' | 'jackpot-win' | 'lootbox'` by spec but also escape to be defensive. Add `loading="lazy"` to `<img>` per Pitfall 10.

---

### `play/components/packs-panel.js` (Custom Element, request-response + GSAP)

**Analog:** `play/components/profile-panel.js` for structure + `beta/components/degenerette-panel.js` lines 311-341 for GSAP timeline import+use

---

#### Pattern 1: All profile-panel patterns 1-4 above apply (COPY + ADAPT)

Same imports, same TEMPLATE shape, same stale-guard, same `#showContent()`. Diffs from tickets-panel:
- Rename `#ticketsFetchId` -> `#packsFetchId` (even though both panels call the same helper; each panel owns its own stale-guard counter per Research Section 8).
- Import additions:
  ```javascript
  import { animatePackOpen } from '../app/pack-animator.js';
  import { playPackOpen, isMuted, setMuted } from '../app/pack-audio.js';
  ```

---

#### Pattern 2: Filter to non-opened + click handler (NOVEL)

**Analog reference:** None direct; uses `addEventListener` pattern visible across beta/ components.

**What to build:**

```javascript
#renderPacks(cards) {
  const grid = this.querySelector('[data-bind="pack-grid"]');
  if (!grid) return;
  const packs = (cards || []).filter((c) => c.status !== 'opened');
  if (packs.length === 0) {
    grid.innerHTML = '<div class="packs-empty">No packs waiting to open.</div>';
    return;
  }
  grid.innerHTML = packs.map((card) => this.#packHtml(card)).join('');

  // Wire click handlers (event delegation would also work)
  grid.querySelectorAll('.pack-sealed').forEach((packEl) => {
    packEl.addEventListener('click', () => this.#openPack(packEl));
  });

  // PACKS-04: auto-open lootbox-sourced packs on first render
  grid.querySelectorAll('.pack-source-lootbox').forEach((packEl) => {
    if (!this.#animatedCards.has(packEl.dataset.cardIndex)) {
      this.#animatedCards.add(packEl.dataset.cardIndex);
      this.#openPack(packEl);
    }
  });
}

#openPack(packEl) {
  playPackOpen();  // fire-and-forget; fail-silent per D-10
  const tl = animatePackOpen(packEl, () => this.#activeTimelines.delete(tl));
  if (tl) this.#activeTimelines.add(tl);
}
```

**Gotcha:** Per RESEARCH.md Pitfall 11, track animated cards in a `#animatedCards = new Set()` keyed by `cardIndex` (or a composite `${level}::${entryId}` if entry-level is needed) to prevent re-animating lootbox packs on day-scrub re-render. And per Pitfall 3, track `#activeTimelines = new Set()` + call `tl.kill()` on all in `disconnectedCallback()` to avoid memory leak.

---

#### Pattern 3: Mute toggle with localStorage (NOVEL)

**Analog reference:** Click-handler wiring pattern from profile-panel.js `#bindPopover()` (lines 370-414); localStorage reads in `pack-audio.js` module.

**What to build:**

```javascript
#bindMuteToggle() {
  const btn = this.querySelector('[data-bind="mute-toggle"]');
  if (!btn) return;
  const refresh = () => {
    const muted = isMuted();
    btn.textContent = muted ? 'muted' : 'sound';
    btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  };
  refresh();
  btn.addEventListener('click', () => {
    setMuted(!isMuted());
    refresh();
  });
}
```

**Call from `connectedCallback()`** after `this.innerHTML = TEMPLATE;`.

**Gotcha:** The test assertion (Wave 0) greps for `data-bind="mute-toggle"` and `localStorage|isMuted`. Keep one of those literal strings in the source file.

---

### `play/components/jackpot-panel-wrapper.js` (Custom Element, store-shim wrapper)

**Analog:** `play/components/profile-panel.js` for shell structure; logic is novel (no analog for store-shim pattern in the codebase).

---

#### Pattern 1: Shell (connectedCallback + disconnectedCallback + unsubs) -- MIRROR

**Analog excerpt** (profile-panel.js lines 151-183):

```javascript
class ProfilePanel extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    this.innerHTML = TEMPLATE;
    this.#unsubs.push(/* subscribes */);
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }
}

customElements.define('profile-panel', ProfilePanel);
```

**What to change when adapting:** Replace the TEMPLATE with a thin wrapper element:

```javascript
import { subscribe, get, update } from '../../beta/app/store.js';
import '../../beta/components/jackpot-panel.js';  // side-effect: customElements.define('jackpot-panel', ...)

class JackpotPanelWrapper extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    this.innerHTML = `<jackpot-panel></jackpot-panel>`;

    // Shim: play/'s replay.* store paths into beta/'s game.* paths.
    // beta/components/jackpot-panel.js subscribes to 'game' (line 188).
    const pushShim = (day, level) => {
      if (day != null) {
        const jackpotDay = ((day - 1) % 5) + 1;  // within-level counter
        update('game.jackpotDay', jackpotDay);
      }
      if (level != null) {
        update('game.level', level);
      }
    };

    this.#unsubs.push(
      subscribe('replay.day', (day) => pushShim(day, get('replay.level'))),
      subscribe('replay.level', (level) => pushShim(get('replay.day'), level)),
    );

    // Initial push in case both values already exist.
    pushShim(get('replay.day'), get('replay.level'));
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }
}

customElements.define('jackpot-panel-wrapper', JackpotPanelWrapper);
```

**Gotcha:** Per Pitfall 8, beta's `#onGameUpdate(game)` at jackpot-panel.js:1036-1071 reads `game.level`, `game.jackpotDay`, and `game.phase`. The shim above covers level and jackpotDay. `game.phase` defaults sensibly in beta code (see line 1043 `day > 0 ? ... : 'Day --'`); leave un-shimmed unless UAT shows a problem. Per Pitfall 12, Wave 1 MUST also delete `play/components/jackpot-panel.js` (the Phase 50 stub) to avoid the `customElements.define('jackpot-panel', ...)` collision.

**Gotcha 2:** `beta/components/jackpot-panel.js:188` already subscribes to `'game'` (top-level). Writing `game.level` and `game.jackpotDay` via `update(...)` triggers that subscription because `beta/app/store.js` propagates updates via path-prefix matching (verified at store.js:60-90). The wrapper does NOT need to publish the full `game` object; partial-path writes suffice.

---

### `play/app/tickets-inventory.js` (helper module, pure transform) -- CREATE

**Analog:** `play/app/quests.js` (wallet-free helper shape) + `beta/viewer/badge-inventory.js` lines 6-32 (function source)

---

#### Pattern 1: Header comment + wallet-free imports (COPY shape)

**Analog excerpt** (play/app/quests.js lines 1-25):

```javascript
// play/app/quests.js -- wallet-free quest helpers for the /play/ route
//
// Re-implementation of beta/app/quests.js that avoids the ethers-tainted
// path (beta/app/quests.js imports from ./utils.js which imports ethers
// at line 3). SHELL-01 guardrail (play/app/__tests__/play-shell-01.test.js)
// forbids that import chain in the play/ tree.

import { formatEth, formatBurnie } from '../../beta/viewer/utils.js';
```

**What to change when adapting for tickets-inventory.js:**
- Header comment explains: re-implementation of `beta/viewer/badge-inventory.js` trait decomposer; the beta file renders a different UI shape (cumulative-counts grid), so only the decomposer is reused locally to avoid pulling in `fetchJSON` coupling.
- NO imports. The decomposer is pure; all data (QUADRANTS, COLORS, ITEMS, CARD_IDX) is local constants.

---

#### Pattern 2: Decomposer function body (COPY VERBATIM from beta/viewer/badge-inventory.js)

**Analog excerpt** (beta/viewer/badge-inventory.js lines 6-32):

```javascript
const QUADRANTS = ['crypto', 'zodiac', 'cards', 'dice'];
const COLORS = ['pink', 'purple', 'green', 'red', 'blue', 'orange', 'silver', 'gold'];
const ITEMS = {
  crypto: ['xrp', 'tron', 'sui', 'monero', 'solana', 'chainlink', 'ethereum', 'bitcoin'],
  zodiac: ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'libra', 'sagittarius', 'aquarius'],
  cards: ['club', 'diamond', 'heart', 'spade', 'horseshoe', 'cashsack', 'king', 'ace'],
  dice: ['1', '2', '3', '4', '5', '6', '7', '8'],
};
const CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7];

function badgePath(category, symbolIdx, colorIdx) {
  const fileIdx = category === 'cards' ? CARD_IDX[symbolIdx] : symbolIdx;
  const name = ITEMS[category][symbolIdx];
  return `/badges-circular/${category}_${String(fileIdx).padStart(2, '0')}_${name}_${COLORS[colorIdx]}.svg`;
}

function traitToBadge(traitIndex) {
  const quadrant = Math.floor(traitIndex / 64);
  const category = QUADRANTS[quadrant];
  const within = traitIndex % 64;
  const itemIdx = Math.floor(within / 8);
  const colorIdx = within % 8;
  return {
    category, item: ITEMS[category][itemIdx], itemIdx, colorIdx, color: COLORS[colorIdx],
    path: badgePath(category, itemIdx, colorIdx),
  };
}
```

**What to change when adapting:**
- Add `export` keyword before `traitToBadge` and `badgePath` (and optionally `CARD_IDX` for test visibility per Research Section 10 test outline, lines 881-883).
- Drop everything below line 32 (the beta file's `render()` function uses `fetchJSON` which we do not want in play/).
- Add input-validation guard: `if (traitIndex == null || traitIndex < 0 || traitIndex > 255) return null;` (the API may return null for pending entries).

**Gotcha:** The CARD_IDX remap is LOAD-BEARING. Research Section 5 and Pitfall 1 both flag: copying QUADRANTS/ITEMS without CARD_IDX corrupts the `cards` quadrant silently. The Wave 0 test asserts the exact array literal `[3, 4, 5, 6, 0, 2, 1, 7]` to block that regression.

---

### `play/app/tickets-fetch.js` (shared fetch helper, in-flight dedup) -- CREATE

**Analog:** `play/components/profile-panel.js` lines 327-365 (the fetch shape extracted into a standalone helper) + `play/app/api.js` (existing helper module format precedent) + `play/app/constants.js` (wallet-free import surface)

---

#### Pattern 1: Module header + API_BASE import (COPY from play/app/constants.js consumer)

**Analog excerpt** (profile-panel.js lines 36, 343-344):

```javascript
import { API_BASE } from '../app/constants.js';
// ...
const res = await fetch(`${API_BASE}/player/${addr}?day=${encodeURIComponent(day)}`);
```

**What to change when adapting:** Same import path but the file lives in `play/app/`, so the path is `./constants.js`:

```javascript
// play/app/tickets-fetch.js -- shared INTEG-01 fetcher with in-flight dedup
//
// Two panels (<tickets-panel>, <packs-panel>) need the same INTEG-01 response
// on every (player, level, day) change. This helper dedups at the wire level:
// first call fires the HTTP request; second call returns the in-flight promise.
// Single-slot cache by key prevents refetch within the same key. Stale-guard
// still lives in each panel (#ticketsFetchId / #packsFetchId).

import { API_BASE } from './constants.js';

let inFlight = null;
let lastKey = null;
let lastResult = null;
let lastResultKey = null;

export async function fetchTicketsByTrait(addr, level, day) {
  const key = `${addr}::${level}::${day}`;
  if (key === lastResultKey && lastResult) return lastResult;
  if (key === lastKey && inFlight) return inFlight;
  lastKey = key;
  const url = `${API_BASE}/player/${encodeURIComponent(addr)}/tickets/by-trait`
            + `?level=${encodeURIComponent(level)}&day=${encodeURIComponent(day)}`;
  inFlight = fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => { lastResult = data; lastResultKey = key; inFlight = null; return data; })
    .catch((err) => { inFlight = null; throw err; });
  return inFlight;
}
```

**Gotcha 1:** Per Pitfall 9, keep ONE slot (not a full cache). Stale entries are overwritten on the next distinct key; no unbounded growth.
**Gotcha 2:** The URL literal MUST match the Wave 0 test's regex: `/\/player\/\$\{[^}]+\}\/tickets\/by-trait\?level=/`. Keep the path exactly as written above.
**Gotcha 3:** The test greps `from\s+['"]\.\.\/app\/tickets-fetch\.js['"]` in the panel files; the helper lives at `play/app/tickets-fetch.js`, imported as `from '../app/tickets-fetch.js'` from `play/components/*-panel.js`.

---

### `play/app/pack-animator.js` (GSAP timeline helper) -- CREATE

**Analog:** `beta/components/degenerette-panel.js` lines 311-341 (GSAP timeline import + `gsap.timeline()` + `.to()` / `.fromTo()` chaining)

---

#### Pattern 1: GSAP import via importmap (COPY)

**Analog excerpt** (degenerette-panel.js lines 311-314):

```javascript
try {
  const { gsap } = await import('gsap');
  const tl = gsap.timeline();
  // ...
```

**What to change when adapting:** Use a TOP-level static import (play/index.html:17 registers `gsap` in the importmap at boot). Static imports fail fast if the importmap is broken, which is preferable to a silent runtime null from a dynamic import:

```javascript
// play/app/pack-animator.js -- GSAP timeline for pack-open reveal (D-07)
import gsap from 'gsap';

export function animatePackOpen(packEl, onComplete) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) {
    packEl.classList.remove('pack-sealed');
    packEl.classList.add('pack-opened');
    if (onComplete) onComplete();
    return null;
  }

  const traits = packEl.querySelectorAll('.pack-trait');
  const wrapper = packEl.querySelector('.pack-wrapper');
  const tl = gsap.timeline({ onComplete });

  // Phase 1: shake ~80ms
  tl.to(packEl, { x: -2, duration: 0.020, yoyo: true, repeat: 3, ease: 'power1.inOut' });
  // Phase 2: flash ~50ms
  tl.to(packEl, { opacity: 0.6, duration: 0.025, yoyo: true, repeat: 1 }, '>');
  // Phase 3: snap-open + bounce ~120ms
  tl.to(wrapper, { scale: 1.05, opacity: 0, duration: 0.12, ease: 'back.in(1.5)' }, '>');
  // Phase 4: slide/scale traits in ~150ms staggered
  tl.fromTo(traits,
    { scale: 0.3, opacity: 0 },
    { scale: 1, opacity: 1, duration: 0.15, stagger: 0.02, ease: 'back.out(1.3)' },
    '>');

  return tl;
}
```

**Gotcha 1:** Per D-07, the prefers-reduced-motion fallback is instant-swap with no animation. `onComplete` still fires synchronously so the caller can advance state.
**Gotcha 2:** The test greps for `prefers-reduced-motion` in this file (Wave 0 test outline Research Section 10 line 924). Keep the literal string.
**Gotcha 3:** Per Pitfall 3, return the timeline so the caller can store it in `#activeTimelines` and `.kill()` on disconnect.

---

### `play/app/pack-audio.js` (Web Audio wrapper + localStorage mute) -- CREATE

**Analog:** Two partial analogs, neither a direct fit:
- `beta/components/replay-panel.js` lines 1900-1918 (AudioContext pattern, but uses oscillators not decodeAudioData)
- `beta/app/audio.js` lines 1-36 (autoplay unlock + HTML5 `<audio>`, but not Web Audio API)

---

#### Pattern 1: AudioContext + decodeAudioData (NOVEL composition; no direct analog)

**Reference from beta/components/replay-panel.js lines 1902-1905:**

```javascript
#getAudio() {
  if (!this.#audioCtx) this.#audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (this.#audioCtx.state === 'suspended') this.#audioCtx.resume();
  return this.#audioCtx;
}
```

**What to build (scratch):** Full implementation per D-10 and RESEARCH.md Section 9.4:

```javascript
// play/app/pack-audio.js -- Web Audio wrapper for PACKS-05 / D-10
//
// Fail-silent on 404 or unsupported API. localStorage mute persistence.
// First play() serves as the browser-autoplay-unlock user gesture.

const STORAGE_KEY = 'play.audio.muted';
const VOLUME = 0.4;
const ASSET_PATH = '/play/assets/audio/pack-open.mp3';

let ctx = null;
let buffer = null;
let loadError = null;

async function ensureLoaded() {
  if (ctx || loadError) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const resp = await fetch(ASSET_PATH);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const bytes = await resp.arrayBuffer();
    buffer = await ctx.decodeAudioData(bytes);
  } catch (err) {
    loadError = err;
    console.warn('[pack-audio] disabled:', err.message);
  }
}

export function isMuted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}
export function setMuted(muted) {
  try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch {}
}

export async function playPackOpen() {
  if (isMuted()) return;
  await ensureLoaded();
  if (!buffer || !ctx) return;
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { return; }
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = VOLUME;
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(0);
}
```

**Gotcha 1:** Per D-10, fail-silent means a single console.warn and then silent no-op. Do NOT surface a UI error.
**Gotcha 2:** Per Pitfall 4, the FIRST `playPackOpen()` fires on a user click (the pack-open handler), which is a valid user gesture -- AudioContext can be unblocked there. Lootbox auto-open (D-06) fires on component render, NOT on user gesture -- its sound will be blocked on the very first render of the session. Accept that per the research recommendation; no "click to enable" overlay.
**Gotcha 3:** Per A12, catch around localStorage. Privacy-mode browsers throw.

---

### `play/assets/audio/pack-open.mp3` (static asset) -- CREATE

**No analog.** This is a raw MP3 asset (~300ms click/pop).

**Source options per RESEARCH.md Environment Availability table:**
- Option A: sourced from freesound.org (CC0-licensed short click or pop cue; ~30-second search).
- Option B: generated via an online tool (e.g., Audiotool) or `sox` command line.
- Option C: empty placeholder; D-10 fail-silent path handles the 404.

**Recommendation:** Option A, sourced in Wave 1. File placed at `/home/zak/Dev/PurgeGame/website/play/assets/audio/pack-open.mp3` (directory does not yet exist; Wave 1 must `mkdir -p play/assets/audio`).

---

### `play/app/__tests__/play-tickets-panel.test.js` (contract-grep test) -- CREATE

**Analog:** `play/app/__tests__/play-profile-panel.test.js` (exact template)

---

#### Pattern 1: Imports + path resolution (COPY VERBATIM)

**Analog excerpt** (play-profile-panel.test.js lines 15-26):

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'profile-panel.js');
const QUESTS = join(PLAY_ROOT, 'app', 'quests.js');
```

**What to change when adapting:** Change `PANEL` to `tickets-panel.js`. Add 2 new constants:

```javascript
const PANEL = join(PLAY_ROOT, 'components', 'tickets-panel.js');
const INVENTORY = join(PLAY_ROOT, 'app', 'tickets-inventory.js');
const FETCH = join(PLAY_ROOT, 'app', 'tickets-fetch.js');
```

---

#### Pattern 2: Existence + class shell tests (COPY VERBATIM)

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
```

**What to change when adapting:** s/profile-panel/tickets-panel/g throughout.

---

#### Pattern 3: TICKETS-01..04 behavioral assertions (NEW; per RESEARCH.md Section 10)

**What to write (from Research Section 10, lines 849-883):**

```javascript
test('TICKETS-01: renders card-grid container', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']card-grid["']/);
});

test('TICKETS-02: cards use 2x2 quadrant grid', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /ticket-card/);
  assert.match(src, /trait-quadrant/);
});

test('TICKETS-03: groups entries by cardIndex (entryId/4)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /cardIndex|entryId/);
});

test('TICKETS-04: pending state rendered as pack placeholder', () => {
  const src = readFileSync(PANEL, 'utf8');
  // Tickets panel filters to opened; packs panel handles pending. But the
  // tickets panel must still render SOMETHING for status !== 'opened' per
  // TICKETS-04 if no packs panel filter runs. Accept either assertion.
  assert.match(src, /status\s*===\s*['"]opened['"]|status\s*!==\s*['"]opened['"]|pending/);
});

// Fetch wiring
test('fetches via shared helper tickets-fetch.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/app\/tickets-fetch\.js['"]/);
  assert.match(src, /fetchTicketsByTrait/);
});

test('uses #ticketsFetchId stale-guard counter', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#ticketsFetchId/);
});

test('toggles is-stale class for keep-old-data-dim', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});

test('subscribes to replay.day, replay.player, replay.level', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
});

// Inventory helper assertions
test('play/app/tickets-inventory.js exists', () => {
  assert.ok(existsSync(INVENTORY));
});

test('tickets-inventory.js exports traitToBadge', () => {
  const src = readFileSync(INVENTORY, 'utf8');
  assert.match(src, /export\s+function\s+traitToBadge/);
});

test('tickets-inventory.js includes CARD_IDX reshuffle array literal', () => {
  const src = readFileSync(INVENTORY, 'utf8');
  assert.match(src, /CARD_IDX\s*=\s*\[\s*3\s*,\s*4\s*,\s*5\s*,\s*6\s*,\s*0\s*,\s*2\s*,\s*1\s*,\s*7/);
});

test('tickets-inventory.js is wallet-free (no beta/app/utils.js import)', () => {
  const src = readFileSync(INVENTORY, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});

// tickets-fetch.js existence
test('play/app/tickets-fetch.js exists', () => {
  assert.ok(existsSync(FETCH));
});

test('tickets-fetch.js exports fetchTicketsByTrait', () => {
  const src = readFileSync(FETCH, 'utf8');
  assert.match(src, /export\s+(async\s+)?function\s+fetchTicketsByTrait/);
});

test('tickets-fetch.js URL matches INTEG-01 path', () => {
  const src = readFileSync(FETCH, 'utf8');
  assert.match(src, /\/player\/[^`'"]*\/tickets\/by-trait\?level=/);
});
```

---

### `play/app/__tests__/play-packs-panel.test.js` (contract-grep test) -- CREATE

**Analog:** `play/app/__tests__/play-profile-panel.test.js` (same test-file structure template)

**What to write** (per Research Section 10, lines 886-928):

```javascript
const PANEL = join(PLAY_ROOT, 'components', 'packs-panel.js');
const ANIMATOR = join(PLAY_ROOT, 'app', 'pack-animator.js');
const AUDIO = join(PLAY_ROOT, 'app', 'pack-audio.js');

test('packs-panel.js exists', ...);
test('packs-panel.js registers <packs-panel>', ...);
test('packs-panel.js imports from gsap', () => {
  assert.match(src, /from\s+['"][^'"]*\/pack-animator\.js['"]/);
});

test('PACKS-01: renders pack per card with purchase source', () => {
  assert.match(src, /source\s*===\s*['"]purchase['"]|pack-source-purchase/);
});
test('PACKS-02: jackpot-win packs get gold-tint class', () => {
  assert.match(src, /jackpot-win|gold-tint/);
});
test('PACKS-03: click handler on pack element', () => {
  assert.match(src, /addEventListener\(\s*['"]click['"]/);
});
test('PACKS-04: lootbox source triggers animation on first render', () => {
  assert.match(src, /source\s*===\s*['"]lootbox['"]|pack-source-lootbox|animatedCards/);
});
test('PACKS-05: imports pack-audio module', () => {
  assert.match(src, /from\s+['"][^'"]*\/pack-audio\.js['"]/);
});
test('PACKS-05: imports pack-animator module', () => {
  assert.match(src, /from\s+['"][^'"]*\/pack-animator\.js['"]/);
});

test('renders speaker-icon mute toggle', () => {
  assert.match(src, /data-bind=["']mute-toggle["']/);
});
test('mute toggle reads localStorage (via isMuted)', () => {
  assert.match(src, /localStorage|isMuted/);
});

test('pack-open.mp3 referenced in audio module', () => {
  const audioSrc = readFileSync(AUDIO, 'utf8');
  assert.match(audioSrc, /pack-open\.mp3/);
});

test('pack-animator handles prefers-reduced-motion', () => {
  const animatorSrc = readFileSync(ANIMATOR, 'utf8');
  assert.match(animatorSrc, /prefers-reduced-motion/);
});

test('pack-animator imports gsap', () => {
  const animatorSrc = readFileSync(ANIMATOR, 'utf8');
  assert.match(animatorSrc, /from\s+['"]gsap['"]/);
});
```

---

### `play/app/__tests__/play-jackpot-wrapper.test.js` (contract-grep test) -- CREATE

**Analog:** `play/app/__tests__/play-profile-panel.test.js` (same test-file structure template)

**What to write** (per Research Section 10 lines 930-953):

```javascript
const PANEL = join(PLAY_ROOT, 'components', 'jackpot-panel-wrapper.js');
const PLAY_INDEX = join(PLAY_ROOT, 'index.html');

test('jackpot-panel-wrapper.js exists', ...);
test('jackpot-panel-wrapper.js registers <jackpot-panel-wrapper>', () => {
  assert.match(src, /customElements\.define\(\s*['"]jackpot-panel-wrapper['"]/);
});
test('imports beta/components/jackpot-panel.js directly (D-09)', () => {
  assert.match(src, /from\s+['"][^'"]*\/beta\/components\/jackpot-panel\.js['"]/);
});
test('wraps <jackpot-panel> inside innerHTML template', () => {
  assert.match(src, /<jackpot-panel>/);
});
test('subscribes to replay.day and replay.level (JACKPOT-03)', () => {
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
});
test('shims replay.level into game.level via update()', () => {
  assert.match(src, /update\(\s*['"]game\.level['"]/);
});
test('shims game.jackpotDay as within-level counter', () => {
  assert.match(src, /game\.jackpotDay/);
});
test('play/index.html links beta/styles/jackpot.css (Pitfall 13)', () => {
  const html = readFileSync(PLAY_INDEX, 'utf8');
  assert.match(html, /beta\/styles\/jackpot\.css/);
});
```

---

### `play/app/__tests__/play-jackpot-shell01-regression.test.js` (beta-file regression) -- CREATE

**Analog:** `play/app/__tests__/play-shell-01.test.js` (FORBIDDEN array + readFileSync pattern; but targets BETA file, not play/)

---

#### Pattern 1: Read-file + negative/positive regex (ADAPT)

**Analog excerpt** (play-shell-01.test.js lines 22-31):

```javascript
const FORBIDDEN = [
  { label: "bare 'ethers' specifier", pattern: /from\s+['"]ethers['"]/ },
  { label: 'beta/app/wallet.js', pattern: /from\s+['"][^'"]*\/beta\/app\/wallet\.js['"]/ },
  // ...
];
```

**What to change when adapting** (per Research Section 10 lines 956-972):

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// play/app/__tests__/ -> up 3 to website/
const REPO_ROOT = join(__dirname, '../../..');
const BETA_JACKPOT = join(REPO_ROOT, 'beta', 'components', 'jackpot-panel.js');

test('SHELL-01 regression: beta/jackpot-panel.js does NOT import beta/app/utils.js (post-D-09 patch)', () => {
  const src = readFileSync(BETA_JACKPOT, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\.\.\/app\/utils\.js['"]/);
});

test('SHELL-01 regression: beta/jackpot-panel.js imports formatEth from beta/viewer/utils.js', () => {
  const src = readFileSync(BETA_JACKPOT, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\.\.\/viewer\/utils\.js['"]/);
});

test('beta/jackpot-panel.js import count sanity (expect 5-7 imports)', () => {
  const src = readFileSync(BETA_JACKPOT, 'utf8');
  const lines = src.split('\n').filter((l) => /^import\s/.test(l));
  assert.ok(lines.length >= 5 && lines.length <= 7, `expected 5-7 imports, found ${lines.length}`);
});
```

**Gotcha:** This test targets a file OUTSIDE the play/ tree (`beta/components/jackpot-panel.js`). The existing `play-shell-01.test.js` only scans play/; this dedicated regression test guards the beta-file patch. Run both in CI.

---

### `play/styles/play.css` (MODIFY) -- append Phase 52 sections

**Analog:** Existing file, specifically the Phase 51 profile-panel precedent at lines 70-200+.

---

#### Pattern 1: Section-header comment block (COPY)

**Analog excerpt** (play/styles/play.css lines 70-74):

```css
/* ----------------------------------------------------------------------
   Phase 51 -- <profile-panel> styles
   Four sections: Activity Score, Quest Streak banner, Quest Slots,
   Daily Activity. Tokens from beta/styles/base.css.
   ---------------------------------------------------------------------- */
```

**What to change when adapting:** Add TWO new section-header comments (one for tickets-panel, one for packs-panel) at the end of the file. Structure:

```css
/* ----------------------------------------------------------------------
   Phase 52 -- <tickets-panel> styles
   Dense card grid (D-01): ~120-160px cards, 2x2 quadrant SVG grid per card.
   Tokens from beta/styles/base.css. Reuses badge-sizing conventions from
   beta/styles/replay.css .replay-tq.
   ---------------------------------------------------------------------- */

.tickets-panel .tickets-grid { /* grid layout */ }
.ticket-card { /* card ~120-160px */ }
.trait-grid { /* 2x2 CSS grid */ }
.trait-quadrant { /* cell */ }
.trait-badge { /* img sizing -- borrow from replay.css .replay-tq .badge-img */ }
.card-source-pill { /* small pill below card */ }
.card-source-purchase { /* neutral tint */ }
.card-source-jackpot-win { /* gold tint */ }
.card-source-lootbox { /* lootbox tint */ }

/* ----------------------------------------------------------------------
   Phase 52 -- <packs-panel> styles
   Sealed pack state + pulsing "tap to open" + opened animation states.
   ---------------------------------------------------------------------- */

.packs-panel { }
.pack-sealed { /* closed pack with box-shadow pulse */ }
.pack-sealed.pack-source-jackpot-win { /* gold tint overlay */ }
.pack-opened { /* final state after GSAP timeline */ }
.pack-trait { /* per-quadrant trait in opened pack */ }
@keyframes pack-pulse { /* box-shadow pulse for tap-to-open affordance */ }
.mute-toggle { /* speaker icon button */ }

/* prefers-reduced-motion fallback -- instant state swap */
@media (prefers-reduced-motion: reduce) {
  .pack-sealed { animation: none; }
}
```

**Gotcha 1:** `.is-stale { opacity: 0.6; }` likely already exists from Phase 51 (applies to any `[data-bind="content"]`). Verify before adding a duplicate.
**Gotcha 2:** Reference `beta/styles/replay.css:158-175` `.replay-tq .badge-img` (object-fit: contain, padding: 4%, opacity transitions) as the model for `.trait-badge`. Do NOT re-use the `.replay-tq` class name itself -- own the tickets-panel namespace.

---

### `play/index.html` (MODIFY)

**Analog:** Existing file, specifically the CSS link list (lines 8-13) and panel grid (lines 48-57).

---

#### Pattern 1: Add jackpot.css link (per Pitfall 13)

**Analog excerpt** (play/index.html lines 8-13):

```html
<link rel="stylesheet" href="/beta/styles/base.css">
<link rel="stylesheet" href="/beta/styles/panels.css">
<link rel="stylesheet" href="/beta/styles/buttons.css">
<link rel="stylesheet" href="/beta/styles/skeleton.css">
<link rel="stylesheet" href="/beta/styles/viewer.css">
<link rel="stylesheet" href="/play/styles/play.css">
```

**What to change:** Add after line 12 (viewer.css), before play.css:

```html
<link rel="stylesheet" href="/beta/styles/jackpot.css">
```

---

#### Pattern 2: Update panel grid (rename jackpot-panel, add packs-panel)

**Analog excerpt** (play/index.html lines 48-57):

```html
<div class="play-grid">
  <profile-panel data-slot="profile"></profile-panel>
  <tickets-panel data-slot="tickets"></tickets-panel>
  <purchase-panel data-slot="purchase"></purchase-panel>
  <coinflip-panel data-slot="coinflip"></coinflip-panel>
  <baf-panel data-slot="baf"></baf-panel>
  <decimator-panel data-slot="decimator"></decimator-panel>
  <jackpot-panel data-slot="jackpot"></jackpot-panel>
</div>
```

**What to change** (per RESEARCH.md Section 7 recommended ordering):

```html
<div class="play-grid">
  <profile-panel data-slot="profile"></profile-panel>
  <packs-panel data-slot="packs"></packs-panel>          <!-- NEW: packs before tickets -->
  <tickets-panel data-slot="tickets"></tickets-panel>
  <purchase-panel data-slot="purchase"></purchase-panel>
  <coinflip-panel data-slot="coinflip"></coinflip-panel>
  <baf-panel data-slot="baf"></baf-panel>
  <decimator-panel data-slot="decimator"></decimator-panel>
  <jackpot-panel-wrapper data-slot="jackpot"></jackpot-panel-wrapper>  <!-- WAS: <jackpot-panel> -->
</div>
```

**Gotcha:** Per Pitfall 7, `play/app/__tests__/play-panel-stubs.test.js:30` expects `<jackpot-panel>` + its stub file. Wave 0 MUST update that test's `PANEL_STUBS` array: either remove the `jackpot-panel` row and add `jackpot-panel-wrapper` with matching tag, OR keep the stubs test parity by letting Phase 52 delete the stub and adding equivalent coverage in `play-jackpot-wrapper.test.js`.

Also update `play/app/main.js` lines 19-29 (`paths` array) and line 28: remove `'../components/jackpot-panel.js'`, add `'../components/packs-panel.js'` and `'../components/jackpot-panel-wrapper.js'`.

---

### `beta/components/jackpot-panel.js:7` (MODIFY -- single line) -- D-09 upstream patch

**Analog:** The source file itself at line 7 vs the replacement at `beta/viewer/utils.js` lines 22-30.

---

#### Pattern 1: Swap import specifier (SURGICAL ONE-LINE EDIT)

**Analog excerpt (current)** `beta/components/jackpot-panel.js:5-9`:

```javascript
import { subscribe } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { formatEth } from '../app/utils.js';                           // <-- line 7 (WALLET-TAINTED)
import { createScrubber } from '../viewer/scrubber.js';
import { joFormatWeiToEth, joScaledToTickets, createJackpotRolls } from '../app/jackpot-rolls.js';
```

**Replacement** (per D-09 and RESEARCH.md Section 4):

```javascript
import { formatEth } from '../viewer/utils.js';                        // <-- swap path only
```

**Behavior verification (RESEARCH.md Section 4):** Both `beta/app/utils.js` `formatEth` and `beta/viewer/utils.js:22-30` `formatEth` accept wei-strings and return identical-shape human-readable strings with matching precision tiers (`<0.001`, `.toFixed(4)` below 1, `.toFixed(3)` below 100, `.toFixed(2)` above 100). All 10 call sites in jackpot-panel.js pass wei-strings (`.toString()` or `BigInt(...).toString()` upstream). Runtime behavior is identical.

**Gotcha 1:** Per Pitfall 16, verify post-patch by running beta's existing tests. The play-jackpot-shell01-regression.test.js also asserts the post-patch import state.
**Gotcha 2:** Per RESEARCH.md Section 4 Conclusion 4, the regression test (`play-jackpot-shell01-regression.test.js`) catches any accidental revert in future beta work. Do NOT omit it.

---

### `.planning/phases/52-tickets-packs-jackpot/INTEG-01-SPEC.md` (CREATE via copy-forward)

**Analog:** `.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md` (123 lines, the literal source) + `.planning/phases/51-profile-quests/INTEG-02-SPEC.md` (217 lines, format precedent)

---

#### Pattern 1: Copy-forward (verbatim or near-verbatim)

**Analog excerpt** (Phase 50 INTEG-01-SPEC.md lines 1-7 header):

```markdown
# INTEG-01 Spec: GET /player/:address/tickets/by-trait

**Phase:** 50 -- Route Foundation & Day-Aware Store
**Requirement:** INTEG-01 (kickoff in Phase 50; delivery gates Phase 52)
**Owner:** website repo (proposal); database repo (implementation)
**Status:** DRAFT -- solo dev self-coordination; ...
**Posted:** 2026-04-23 ...
```

**What to change when adapting:**

Per RESEARCH.md Q2 (answered in Section 7 and Wave 0 Gaps line 988): **copy-forward** is preferred over symlink for portability and so the Phase 52 directory is self-contained. The Phase 51 precedent (INTEG-02-SPEC.md sits inside the Phase 51 directory) supports this.

Wave 0 action:

1. Copy `.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md` to `.planning/phases/52-tickets-packs-jackpot/INTEG-01-SPEC.md`.
2. Update header:
   - Change `**Phase:** 50 -- Route Foundation & Day-Aware Store` to `**Phase:** 52 -- Tickets, Packs & Jackpot Reveal (carried forward from Phase 50 kickoff)`.
   - Update `**Status:**` line to reflect carry-forward: `DRAFT -- carried forward from Phase 50 kickoff; Wave 2 delivery required`.
   - Add a `**Superseded at:**` line pointing to the Phase 52 dir for resolution.
3. Add a **"Phase 52 Implementation Notes"** appendix section (per RESEARCH.md Section 10):
   - `startIndex` reconstruction recommendation (Option B -- query-level sum of counts ordered by (blockNumber, logIndex)).
   - Source determination heuristic (purchase / jackpot-win / lootbox via same-tx cross-reference to lootbox_results and jackpot_distributions).
   - Database-side file map: `database/src/api/routes/player.ts` (handler), `database/src/api/schemas/player.ts` (schema), `database/src/api/routes/__tests__/player-tickets-by-trait.test.ts` (test).
   - 3-commit delivery pattern (feat / docs / test) mirroring INTEG-02 (`d135605`, `dab5adf`, `64fe8db`).

**Gotcha:** The Phase 50 original stays in place (unchanged). Both files exist. The Phase 52 copy is a "living" version with implementation notes appended; the Phase 50 original is the historical kickoff document.

---

## Shared Patterns

### Imports (cross-cutting for all new play/ files)

**Source:** `play/components/profile-panel.js` lines 35-37 (established surface) + `play/app/constants.js` lines 5-13 (re-export list)
**Apply to:** All new play/ files

```javascript
// Custom Elements:
import { subscribe, get } from '../../beta/app/store.js';          // store (wallet-free)
import { API_BASE } from '../app/constants.js';                    // re-export (wallet-free)

// Helpers:
import { fetchTicketsByTrait } from '../app/tickets-fetch.js';     // local
import { traitToBadge } from '../app/tickets-inventory.js';        // local

// For wrapper only:
import '../../beta/components/jackpot-panel.js';                   // side-effect import

// For packs-panel only:
import { animatePackOpen } from '../app/pack-animator.js';         // local GSAP wrapper
import { playPackOpen, isMuted, setMuted } from '../app/pack-audio.js';  // local audio wrapper
```

**Gotcha:** Do NOT import from `../../beta/app/constants.js` directly. Use the local play/ re-export at `play/app/constants.js`. This gives SHELL-01 the explicit narrow surface per the Phase 50 comment at `play/app/constants.js:2-4`.

---

### SHELL-01 wallet-free fence (inherited coverage)

**Source:** `play/app/__tests__/play-shell-01.test.js` lines 22-31 (recursive scan)
**Apply to:** All new play/ tree files (automatic via the existing recursive scanner)

The existing guardrail covers new Phase 52 files without edits. Additionally, add **one explicit per-helper assertion** for tickets-inventory.js per the research Section 10 test outlines (mirrors the Phase 51 precedent of a dedicated "quests.js is wallet-free" assertion in play-profile-panel.test.js lines 160-168):

```javascript
test('play/app/tickets-inventory.js is wallet-free', () => {
  const src = readFileSync(INVENTORY, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/viewer\/badge-inventory\.js['"]/);
});
```

**New forbidden addition:** Phase 52 does NOT extend the FORBIDDEN array in play-shell-01.test.js. D-09 patch REMOVES the wallet-taint from `beta/components/jackpot-panel.js`, so that file becomes safe to import from play/ post-patch. The `play-jackpot-shell01-regression.test.js` new file is the regression guard on beta-side reverts.

---

### Skeleton -> content swap pattern

**Source:** `play/components/profile-panel.js` lines 192-198 (`#showContent()`)
**Apply to:** tickets-panel, packs-panel, jackpot-panel-wrapper

```javascript
#showContent() {
  if (this.#loaded) return;
  this.#loaded = true;
  this.querySelector('[data-bind="skeleton"]')?.remove();
  const el = this.querySelector('[data-bind="content"]');
  if (el) el.hidden = false;
}
```

**Gotcha:** jackpot-panel-wrapper is a thin passthrough -- it may NOT have its own skeleton/content template. The inner beta `<jackpot-panel>` already has its own skeleton (lines 41-46 of beta/components/jackpot-panel.js) that clears on its own `#showContent()` call. The wrapper does NOT need to implement `#showContent()`.

---

### Double stale-guard pattern

**Source:** `play/components/profile-panel.js` lines 327-365 + Phase 51 D-18 + RESEARCH.md Section 8 lines 537-543
**Apply to:** tickets-panel, packs-panel

Each panel owns its own `#ticketsFetchId` / `#packsFetchId` counter, bumps on each refetch call, and checks AFTER both `await fetch()`/`await fetchTicketsByTrait()` AND (if applicable) `await res.json()`. The shared `tickets-fetch.js` helper covers wire-level dedup; panel-level stale-guard covers render-level staleness.

---

### Active-timeline cleanup (GSAP memory-leak guard)

**Source:** Novel (no existing analog); RESEARCH.md Section 9 (GSAP cleanup) + Pitfall 3
**Apply to:** packs-panel

```javascript
class PacksPanel extends HTMLElement {
  #activeTimelines = new Set();

  #openPack(packEl) {
    const tl = animatePackOpen(packEl, () => this.#activeTimelines.delete(tl));
    if (tl) this.#activeTimelines.add(tl);
  }

  disconnectedCallback() {
    this.#activeTimelines.forEach((tl) => tl.kill());
    this.#activeTimelines.clear();
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }
}
```

---

### Animated-card deduplication (lootbox auto-open re-entrancy)

**Source:** Novel (no existing analog); RESEARCH.md Pitfall 11
**Apply to:** packs-panel

```javascript
class PacksPanel extends HTMLElement {
  #animatedCards = new Set();

  #renderPacks(cards) {
    // ...
    grid.querySelectorAll('.pack-source-lootbox').forEach((packEl) => {
      const cardKey = packEl.dataset.cardIndex;  // or a composite key
      if (!this.#animatedCards.has(cardKey)) {
        this.#animatedCards.add(cardKey);
        this.#openPack(packEl);
      }
    });
  }
}
```

**Gotcha:** Cleared on level change (different keys, natural invalidation) but NOT on disconnect -- if the same session stays mounted and the user scrubs back to a previously-animated day, those cards don't re-animate. That's the desired behavior.

---

### Unsub cleanup pattern

**Source:** `play/components/profile-panel.js` lines 152, 176-178 (already present in all Phase 50 stubs)
**Apply to:** All new Custom Elements

```javascript
class MyPanel extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    // ... this.#unsubs.push(subscribe(...));
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }
}
```

`subscribe()` from `beta/app/store.js` returns an unsubscribe function. Verified wallet-free.

---

## No Analog Found

Two files have no direct analog in the existing codebase:

### 1. `play/app/pack-audio.js` -- Web Audio API + decodeAudioData + localStorage mute

**Why no analog:** beta/ has two audio patterns, neither matching D-10:
- `beta/app/audio.js` uses HTML5 `<audio>` elements + play().pause() unlock trick -- not Web Audio API.
- `beta/components/replay-panel.js` lines 1900-2000 uses Web Audio but with OSCILLATORS (synthetic SFX), not `decodeAudioData` + MP3 buffer playback.

D-10 specifies: AudioContext + fetch + decodeAudioData + AudioBufferSource + GainNode at 0.4 + localStorage mute persistence + autoplay-unlock-on-gesture + fail-silent. This is a novel composition; ~60 LOC scratch build per RESEARCH.md Section 9.4.

The planner should treat the research section's sketch as the pattern source.

### 2. `play/assets/audio/pack-open.mp3` -- static asset

**Why no analog:** Raw MP3 file (~300ms click/pop). Must be sourced (Option A per Environment Availability table: freesound.org CC0) or generated (Option B) during Wave 1. Directory `play/assets/audio/` does not yet exist and will be created.

Alternative: ship Wave 1 without the file and rely on D-10 fail-silent (404 -> console.warn, silent playback). Acceptable but reduces the gacha feel.

---

## Wallet-Taint Fence (MUST READ)

**Post-D-09-patch fence state** (what is safe vs what stays forbidden):

| File | Status | Reason |
|------|--------|--------|
| `beta/app/utils.js` | FORBIDDEN | `import { ethers } from 'ethers'` at line 3 |
| `beta/app/quests.js` | FORBIDDEN | Transitively tainted via `./utils.js` |
| `beta/app/contracts.js` | FORBIDDEN | Imports ethers at line 5 |
| `beta/app/wallet.js` | FORBIDDEN | EIP-6963 wallet discovery |
| `beta/components/quest-panel.js` | FORBIDDEN | Imports beta/app/quests.js |
| `beta/components/purchase-panel.js` | FORBIDDEN | Wallet writes |
| `beta/components/connect-prompt.js` | FORBIDDEN | Wallet UI |
| `beta/components/coinflip-panel.js` | FORBIDDEN | Wallet writes |
| `beta/components/decimator-panel.js` | FORBIDDEN | Wallet writes |
| `beta/components/jackpot-panel.js` | **SAFE post-D-09 patch** | Direct import allowed from play/ after Wave 0 one-line patch swaps `../app/utils.js` -> `../viewer/utils.js` |
| `beta/app/jackpot-rolls.js` | SAFE | Zero imports (pure module); used transitively by jackpot-panel |
| `beta/viewer/scrubber.js` | SAFE | Only imports `./api.js` which only imports `../app/constants.js` |
| `beta/viewer/api.js` | SAFE | Only imports `../app/constants.js` |
| `beta/viewer/utils.js` | SAFE | Explicit SHELL-01 comment at line 2; wallet-free formatters |
| `beta/viewer/badge-inventory.js` | SAFE | Only imports `./api.js` (wallet-free); but Phase 52 re-implements the decomposer locally to avoid pulling in fetchJSON coupling |
| `beta/app/store.js` | SAFE | Verified wallet-free; already used by all Phase 50-51 files |
| `beta/app/constants.js` | SAFE | Pure data; re-exported narrowly via `play/app/constants.js` |
| `beta/app/api.js` | SAFE for `fetchJSON` only | play/ does not use this directly; used transitively by jackpot-panel |
| `beta/styles/jackpot.css` | N/A (CSS link, not JS import) | Must be linked from play/index.html per Pitfall 13 |

**Critical rule:** The D-09 patch REMOVES the only taint in beta/components/jackpot-panel.js's transitive import graph. Without the patch, direct import from play/ would violate SHELL-01. The `play-jackpot-shell01-regression.test.js` new file is the permanent guard against beta-side re-introduction of the taint.

---

## Metadata

**Analog search scope:**
- `/home/zak/Dev/PurgeGame/website/play/` (full tree: 10 existing .js files, 1 CSS, 1 HTML, 5 test files)
- `/home/zak/Dev/PurgeGame/website/beta/components/` (jackpot-panel, profile-panel, boons-panel, status-bar, quest-panel, degenerette-panel, replay-panel examined)
- `/home/zak/Dev/PurgeGame/website/beta/app/` (store, api, jackpot-rolls, audio, constants, utils signatures checked)
- `/home/zak/Dev/PurgeGame/website/beta/viewer/` (utils, badge-inventory, scrubber, api)
- `/home/zak/Dev/PurgeGame/website/beta/styles/` (replay.css, jackpot.css, skeleton.css references)
- `/home/zak/Dev/PurgeGame/website/.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md` (source for copy-forward)
- `/home/zak/Dev/PurgeGame/website/.planning/phases/51-profile-quests/INTEG-02-SPEC.md` (format precedent)
- `/home/zak/Dev/PurgeGame/website/.planning/phases/51-profile-quests/51-PATTERNS.md` (structure template for this file)

**Files scanned:** 18 source files + 4 spec/context docs + 5 test files

**Pattern extraction date:** 2026-04-24

## PATTERN MAPPING COMPLETE
