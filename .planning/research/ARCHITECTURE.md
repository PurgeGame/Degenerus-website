# Architecture Patterns

**Domain:** Modular vanilla JS game frontend (rebuild from 4600-line monolith)
**Researched:** 2026-03-18
**Confidence:** HIGH (patterns verified against MDN, existing codebase analyzed in full)

## Executive Summary

The existing beta/index.html is a single file containing ~1760 lines of CSS, ~450 lines of HTML, and ~2400 lines of JavaScript across four inline script blocks plus one external module (mint.js at ~900 lines). The JS breaks cleanly into five concerns: (1) contract interaction via ethers.js, (2) jackpot scratch-off widget with canvas/audio, (3) degenerette bet/spin widget, (4) UI helpers (tab switching, input incrementing, payment mode toggling), and (5) data loading from static JSON. The nav component (shared/nav.js) handles wallet connection, Discord auth, and affiliate management via an IIFE that exposes `window.initNav`.

The rebuild should use **ES modules with import maps** for dependency resolution, a **Proxy-based reactive store** for state management, and a **plain Custom Elements (no Shadow DOM)** component pattern for reusable UI. This gives module boundaries, reactive updates, and component lifecycle without a framework or build step.

## Recommended Architecture

### Overview

```
index.html
  |-- <script type="importmap">     (maps "ethers" -> esm.sh, local aliases)
  |-- <script type="module" src="app/main.js">
        |-- app/store.js             (reactive state: game, player, UI)
        |-- app/api.js               (REST client for Fastify API)
        |-- app/contracts.js          (ethers.js contract interaction)
        |-- app/router.js             (phase-aware panel visibility)
        |-- components/               (Custom Element UI components)
        |-- features/                 (feature modules: jackpot, degenerette, etc.)
```

### File Organization

```
beta/
  index.html                          Entry point: import map + shell HTML + <script type="module">
  app/
    main.js                           Bootstrap: init store, connect API, mount components
    store.js                          Proxy-based reactive state (~80 lines)
    api.js                            REST client for database API (~120 lines)
    contracts.js                      ethers.js provider/signer/contract setup (~200 lines)
    router.js                         Phase-dependent panel visibility (~60 lines)
    constants.js                      Contract addresses, chain config, badge paths
    events.js                         EventTarget-based pub/sub bus (~30 lines)
    utils.js                          Shared helpers (formatting, DOM helpers)
  components/
    status-bar.js                     Game status bar (level, phase, presale, score, coinflip)
    panel.js                          Base panel with header/content pattern
    purchase-panel.js                 Ticket/lootbox purchase (ETH and BURNIE modes)
    pass-card.js                      Individual pass card (lazy, whale, deity)
    tx-status.js                      Transaction status indicator
    badge-diamond.js                  4-quadrant badge display (shared by jackpot + degenerette)
    input-incrementer.js              Number input with +N buttons
    pay-toggle.js                     ETH/BURNIE/WWXRP currency switcher
    death-timer.js                    Death clock with escalating urgency
    connect-prompt.js                 Wallet connection prompt
  features/
    jackpot/
      jackpot-widget.js               Jackpot scratch-off orchestration
      scratch-canvas.js               Canvas scratch mechanics
      spin-animation.js               Trait lock-in animation
      prize-display.js                Win/loss prize rendering
      audio.js                        Web Audio sound effects
      coinflip.js                     Coinflip coin + slider animation
    degenerette/
      degenerette-widget.js           Bet placement and spin orchestration
      quick-selector.js               Trait picker popup
      results-tab.js                  Pending/ready/history display
      spin-resolve.js                 On-chain resolve + animation
    passes/
      passes-grid.js                  Pass card layout with afKing tooltip
    quests/
      quest-panel.js                  Streaks + daily quest display
    leaderboards/
      baf-board.js                    BAF scores (contextual by level phase)
      affiliate-board.js              Affiliate leaderboard
    decimator/
      decimator-panel.js              Decimator entry UI (future feature)
    claims/
      claims-panel.js                 Claimable winnings aggregation
  shared/
    nav.js                            Existing nav (keep as IIFE, works cross-page)
    nav.css                           Existing nav styles
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `store.js` | Holds all reactive state (game, player, UI). Single source of truth. | Everything subscribes to it |
| `api.js` | All REST calls to Fastify API. Returns plain objects. | `store.js` (writes fetched data), `main.js` (polling) |
| `contracts.js` | ethers.js provider, signer, contract instances. All write transactions. | `store.js` (wallet state), `events.js` (tx lifecycle) |
| `events.js` | Application-wide event bus (EventTarget). Decouples features. | All features publish/subscribe |
| `router.js` | Shows/hides panels based on game phase + wallet state. | `store.js` (reads phase/wallet), DOM (toggles visibility) |
| `status-bar.js` | Renders game-level stats. Subscribes to store. | `store.js` (reads), `coinflip.js` (delegates flip widget) |
| `purchase-panel.js` | Ticket/lootbox purchase forms, cost calculation, submit. | `store.js` (reads prices), `contracts.js` (writes), `events.js` (tx status) |
| `jackpot-widget.js` | Orchestrates the full jackpot experience: spin, scratch, reveal, claim. | `api.js` (jackpot data), `store.js` (player info), sub-modules |
| `degenerette-widget.js` | Orchestrates degenerette: bet placement, VRF polling, spin reveal. | `contracts.js` (bet/resolve), `store.js` (pending bets), sub-modules |
| `badge-diamond.js` | Shared 4-quadrant badge grid. Used by both jackpot and degenerette. | Parent feature passes data via attributes/methods |

### Data Flow

```
                                    Database API (Fastify @ localhost:3000)
                                              |
                                         api.js (fetch)
                                              |
                                    +---------+---------+
                                    |                   |
                              store.js              events.js
                           (reactive state)       (event bus)
                                    |                   |
                        +-----------+-----------+       |
                        |           |           |       |
                   components    features    router.js  |
                   (read state,  (read state,           |
                    render DOM)   orchestrate)           |
                        |           |                   |
                        +-----+-----+                   |
                              |                         |
                        contracts.js  <-----------------+
                     (ethers.js writes)           (tx events)
                              |
                     Ethereum (Sepolia)
```

**Read path:** `api.js` fetches from database API, writes to `store.js`. Components subscribe to store slices and re-render.

**Write path:** User action in component calls `contracts.js` method. On tx submission, `events.js` emits `tx:pending`. On confirmation, `events.js` emits `tx:confirmed`. Store updates. API re-fetches affected data.

**Polling:** `main.js` sets up periodic API polling (game state every 15s, player state every 30s). Polling updates flow through store, triggering subscribed component re-renders.

## Patterns to Follow

### Pattern 1: Reactive Store with Proxy

The central state management pattern. A Proxy-based store that notifies subscribers on state changes. No framework needed, works with ES modules.

**What:** Single store object wrapped in Proxy. Subscribers register for specific state paths. When a path changes, only relevant subscribers fire.

**When:** Always. Every piece of shared state lives here.

**Example:**

```javascript
// app/store.js
const state = {
  game: { level: 0, phase: 'normal', price: '0', presaleActive: false },
  player: { address: null, score: 0, burnieBalance: '0', claimable: '0' },
  ui: { payMode: 'eth', activeTab: 'bet', walletConnected: false },
};

const listeners = new Map(); // path -> Set<callback>

function notify(path) {
  const parts = path.split('.');
  // Notify exact path and all parent paths
  let current = '';
  for (const part of parts) {
    current = current ? `${current}.${part}` : part;
    const set = listeners.get(current);
    if (set) set.forEach(fn => fn(getPath(state, current)));
  }
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function subscribe(path, callback) {
  if (!listeners.has(path)) listeners.set(path, new Set());
  listeners.get(path).add(callback);
  // Fire immediately with current value
  callback(getPath(state, path));
  return () => listeners.get(path)?.delete(callback);
}

export function update(path, value) {
  const parts = path.split('.');
  let obj = state;
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
  obj[parts[parts.length - 1]] = value;
  notify(path);
}

export function get(path) {
  return getPath(state, path);
}

export function batch(updates) {
  // Apply all updates, then notify once per path
  const paths = [];
  for (const [path, value] of updates) {
    const parts = path.split('.');
    let obj = state;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    paths.push(path);
  }
  paths.forEach(notify);
}
```

### Pattern 2: Custom Elements Without Shadow DOM

UI components as Custom Elements. No Shadow DOM (styles come from the shared stylesheet). Components subscribe to store on connect, unsubscribe on disconnect.

**What:** Each component extends HTMLElement, renders its inner HTML, and reacts to store changes.

**When:** Any reusable UI piece that needs lifecycle management.

**Example:**

```javascript
// components/status-bar.js
import { subscribe } from '../app/store.js';

class StatusBar extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    this.innerHTML = `
      <div class="status-bar">
        <div class="status-item">
          <span class="status-label">Level</span>
          <span class="status-value" data-bind="level">0</span>
        </div>
        <div class="status-item">
          <span class="status-label">Phase</span>
          <span class="status-value" data-bind="phase">--</span>
        </div>
      </div>
    `;

    this.#unsubs.push(
      subscribe('game.level', (v) => this.#update('level', v)),
      subscribe('game.phase', (v) => this.#update('phase', v)),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
  }

  #update(key, value) {
    const el = this.querySelector(`[data-bind="${key}"]`);
    if (el) el.textContent = value;
  }
}

customElements.define('game-status-bar', StatusBar);
```

### Pattern 3: API Client with Caching

A thin REST client that wraps fetch, handles errors, and caches recent responses to avoid redundant network calls.

**What:** Single api.js module exporting typed fetch wrappers per endpoint. Stale-while-revalidate caching.

**When:** All database API reads.

**Example:**

```javascript
// app/api.js
const BASE = 'http://localhost:3000';
const cache = new Map(); // url -> { data, timestamp }
const STALE_MS = 10_000; // 10s cache

async function fetchJSON(path) {
  const url = BASE + path;
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < STALE_MS) {
    return cached.data;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  const data = await res.json();
  cache.set(url, { data, timestamp: Date.now() });
  return data;
}

export const api = {
  gameState: () => fetchJSON('/game/state'),
  player: (addr) => fetchJSON(`/player/${addr}`),
  jackpotHistory: (level) => fetchJSON(`/history/jackpots?level=${level}`),
  levelHistory: () => fetchJSON('/history/levels'),
  bafLeaderboard: (level) => fetchJSON(`/leaderboards/baf?level=${level}`),
  affiliateLeaderboard: (level) => fetchJSON(`/leaderboards/affiliate?level=${level}`),
  coinflipLeaderboard: (day) => fetchJSON(`/leaderboards/coinflip?day=${day}`),
};
```

### Pattern 4: Contract Module with Transaction Lifecycle

Wraps ethers.js contract calls. Emits events for pending/confirmed/error states so any UI component can show transaction status.

**What:** Single contracts.js exporting action functions. Each action emits standardized events.

**When:** All blockchain writes (purchase, claim, advance game, etc.).

**Example:**

```javascript
// app/contracts.js
import { subscribe, update } from './store.js';
import { emit } from './events.js';

let provider = null;
let signer = null;
let gameContract = null;

export async function connect() {
  if (!window.ethereum) throw new Error('No wallet');
  provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  const address = await signer.getAddress();
  update('player.address', address);
  update('ui.walletConnected', true);

  gameContract = new ethers.Contract(CONTRACTS.GAME, ABI, signer);
  return address;
}

export async function purchaseTickets(qty, lootboxAmount, affiliateCode) {
  const txId = crypto.randomUUID();
  emit('tx:pending', { txId, action: 'purchase' });
  try {
    const price = get('game.price');
    const value = BigInt(price) * BigInt(qty) + ethers.parseEther(String(lootboxAmount));
    const tx = await gameContract.purchase(
      await signer.getAddress(), qty, ethers.parseEther(String(lootboxAmount)),
      ethers.encodeBytes32String(affiliateCode || ''), 0, { value }
    );
    emit('tx:submitted', { txId, hash: tx.hash });
    const receipt = await tx.wait();
    emit('tx:confirmed', { txId, hash: tx.hash, receipt });
  } catch (err) {
    emit('tx:error', { txId, error: err });
    throw err;
  }
}
```

### Pattern 5: Import Map for Dependencies

Use an import map in index.html to map bare specifiers to CDN URLs and local module paths. This replaces the current ESM shim approach.

**What:** A `<script type="importmap">` block that maps `"ethers"` to esm.sh and sets up local path aliases.

**When:** Always. Declared once in index.html before any module scripts.

**Example:**

```html
<script type="importmap">
{
  "imports": {
    "ethers": "https://esm.sh/ethers@6.13.4",
    "app/": "./app/",
    "components/": "./components/",
    "features/": "./features/"
  }
}
</script>
<script type="module" src="./app/main.js"></script>
```

This replaces the current pattern of:
```javascript
import { ethers } from 'https://esm.sh/ethers@6';
window.ethers = ethers;
```

With the import map, any module can simply write `import { ethers } from 'ethers'` without knowing the CDN URL. The `window.ethers` global is eliminated.

### Pattern 6: Phase-Aware Router

The game has distinct phases (purchase, jackpot, RNG-locked) that change which panels are visible and prominent. A simple router reads game.phase from the store and toggles panel visibility.

**What:** A module that subscribes to `game.phase` and `ui.walletConnected` and shows/hides feature panels accordingly.

**When:** On every phase change.

**Example:**

```javascript
// app/router.js
import { subscribe } from './store.js';

const PHASE_PANELS = {
  normal: ['purchase-panel', 'passes-grid', 'degenerette-widget', 'quest-panel'],
  jackpot: ['jackpot-widget', 'degenerette-widget', 'baf-board', 'quest-panel'],
  rng: ['jackpot-widget', 'quest-panel'], // minimal during RNG lock
};

const WALLET_REQUIRED = ['purchase-panel', 'degenerette-widget', 'quest-panel', 'claims-panel'];

subscribe('game.phase', (phase) => {
  const visible = PHASE_PANELS[phase] || PHASE_PANELS.normal;
  document.querySelectorAll('[data-panel]').forEach(el => {
    el.hidden = !visible.includes(el.dataset.panel);
  });
});

subscribe('ui.walletConnected', (connected) => {
  document.querySelectorAll('[data-panel]').forEach(el => {
    if (WALLET_REQUIRED.includes(el.dataset.panel)) {
      el.classList.toggle('requires-wallet', !connected);
    }
  });
});
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Global Window Namespace

**What:** Exposing modules on `window` (e.g., `window.Mint`, `window.ethers`, `window.degenSubmit`).

**Why bad:** Creates implicit coupling. Any code anywhere can call or overwrite these globals. Makes dependencies invisible. The existing codebase has `window.Mint`, `window.ethers`, inline `onclick` handlers calling global functions.

**Instead:** Use ES module imports. Each module explicitly declares its dependencies. Replace `onclick="Mint.purchase()"` with event listeners attached in the component's `connectedCallback`.

### Anti-Pattern 2: Inline Event Handlers

**What:** `onclick="functionName()"` attributes in HTML.

**Why bad:** Requires functions to be global. Breaks Content Security Policy. Makes handler registration invisible to tooling.

**Instead:** Attach event listeners in JavaScript. Components wire up their own listeners on mount.

### Anti-Pattern 3: DOM ID Coupling

**What:** Direct `document.getElementById('specific-id')` scattered across unrelated modules.

**Why bad:** Creates fragile coupling between HTML structure and JS. Renaming an ID breaks code in an unknown location. The current codebase has ~80 getElementById calls across the inline scripts.

**Instead:** Components own their own DOM. They query within their own element (`this.querySelector`). Cross-component communication goes through the store or events.

### Anti-Pattern 4: IIFE-Per-Feature in Inline Scripts

**What:** Multiple `(function() { ... })()` blocks in `<script>` tags at the bottom of HTML.

**Why bad:** No module boundaries. Variables leak through `window`. No dependency graph. Can't tree-shake or lazy-load. The current file has three large IIFEs (jackpot ~1500 lines, degenerette ~800 lines, plus utility functions).

**Instead:** Each feature is its own ES module file. Dependencies are explicit imports. Features can be lazy-loaded with dynamic `import()`.

### Anti-Pattern 5: Duplicated Constants Across Modules

**What:** Badge paths, color arrays, symbol names, weights defined separately in jackpot IIFE and degenerette IIFE (currently duplicated verbatim).

**Why bad:** Changes must be made in multiple places. Divergence causes bugs.

**Instead:** Single `constants.js` module exporting shared badge/symbol/color data. Both jackpot and degenerette import from it.

## Integration Points: Existing Code to Preserve vs Replace

### Preserve (with minor adaptation)

| Existing Code | What It Does | Adaptation Needed |
|---------------|-------------|-------------------|
| `shared/nav.js` | Wallet connection, Discord auth, affiliate, LINK donation | Keep as IIFE (used across pages). Wire to store via events. |
| `shared/nav.css` | Design tokens in `:root`, nav styles | Keep as-is. New modules reference same CSS custom properties. |
| ethers.js v6 via esm.sh | Contract interaction | Move to import map. Eliminate `window.ethers` global. |
| Canvas scratch-off logic | Jackpot reveal mechanics | Extract to `features/jackpot/scratch-canvas.js`. Same logic, exported as module. |
| Web Audio sound effects | Jackpot audio feedback | Extract to `features/jackpot/audio.js`. Same logic, exported functions. |
| CSS 3D coin flip | Coinflip animation | Extract CSS to shared stylesheet. JS to `features/jackpot/coinflip.js`. |
| Badge path generation | SVG badge URL construction | Move to `app/constants.js`. Currently duplicated. |

### Replace

| Existing Code | Why Replace | Replacement |
|---------------|-------------|-------------|
| Inline `<style>` (1760 lines) | Can't be shared or scoped | External CSS file(s) in `beta/styles/` |
| Global `incrInput()`, `togglePayMode()` | Global functions, onclick handlers | Component methods with event listeners |
| Static JSON fetch for jackpot data | Not connected to live database | `api.js` fetching from Fastify endpoints |
| `window.Mint` IIFE | Global namespace, not modular | ES module `contracts.js` with named exports |
| Manual DOM updates via `getElementById` | Fragile, no reactivity | Store subscriptions driving component updates |
| Duplicated constants (JP_CATEGORIES, DG_CATEGORIES, etc.) | Copy-paste drift risk | Single `constants.js` import |

## Migration Strategy: From Monolith to Modules

### Phase 1: Foundation (build first, everything else depends on it)

1. Create `app/store.js`, `app/events.js`, `app/constants.js`, `app/utils.js`
2. Create `app/api.js` with Fastify API client
3. Set up import map in new `index.html`
4. Create `app/main.js` bootstrap
5. Extract CSS to `beta/styles/main.css`

**Dependency:** Nothing else can start without the store and import map.

### Phase 2: Contract Layer

1. Create `app/contracts.js` from mint.js
2. Wire wallet connection flow (nav.js emits event, contracts.js handles)
3. Transaction lifecycle events

**Dependency:** Requires store (Phase 1). Purchase panel and degenerette require this.

### Phase 3: Core Components

1. `components/status-bar.js` (level, phase, presale, score)
2. `components/purchase-panel.js` (ticket/lootbox purchase, both modes)
3. `components/pass-card.js` (lazy, whale, deity)
4. `components/tx-status.js`
5. `components/badge-diamond.js` (shared 4-quadrant display)
6. `components/connect-prompt.js`
7. `app/router.js` (phase-dependent visibility)

**Dependency:** Requires store + contracts (Phases 1-2).

### Phase 4: Hero Features

1. `features/jackpot/` (full scratch-off widget: canvas, audio, animation, prizes)
2. `features/degenerette/` (bet placement, VRF polling, spin reveal)
3. `features/jackpot/coinflip.js` (coin + slider in status bar)

**Dependency:** Requires badge-diamond component, store, contracts, API.

### Phase 5: Supporting Features

1. `features/quests/quest-panel.js` (streaks + daily quests)
2. `features/passes/passes-grid.js` (afKing tooltip, pass layout)
3. `features/leaderboards/baf-board.js` and `affiliate-board.js`
4. `features/claims/claims-panel.js`
5. `components/death-timer.js`

**Dependency:** Requires API client and store. Independent of jackpot/degenerette.

### Phase 6: Polish

1. Game utilities panel (advance game, request RNG)
2. Affiliate code input in status bar
3. Responsive layout verification
4. Error states and loading skeletons

## Build Order Rationale

The ordering follows dependency chains:

1. **Store + Events + API must come first** because every component and feature depends on them. There's no way to build a component that doesn't read state.

2. **Contracts before components** because the purchase panel, degenerette, and claims all call contract methods. Building UI without the ability to test write actions is wasted effort.

3. **Core components before hero features** because the jackpot widget reuses badge-diamond, and the purchase panel is the most-used UI element. Getting the component pattern established early means hero features follow the same pattern.

4. **Jackpot and degenerette are the hero features** and the most complex extraction (1500 and 800 lines respectively). They should come after the component pattern is proven on simpler components.

5. **Supporting features are independent** of each other and can be built in any order after the foundation is ready.

## Scalability Considerations

| Concern | Current (1 file) | At 15 modules | At 30+ modules |
|---------|------------------|---------------|----------------|
| Load time | Single 4600-line parse | ~20 HTTP/2 requests, each small | Same; HTTP/2 multiplexing handles it. Consider dynamic import() for below-fold features. |
| Caching | One file change = full re-download | Only changed modules re-download | Same benefit, magnified. Import map makes this automatic. |
| State management | Global variables in IIFEs | Centralized store, explicit subscriptions | Same store pattern. Add slice-based subscriptions if subscriber count grows. |
| Code navigation | Ctrl+F in one file | Each feature in its own file | Directory structure mirrors feature tree. grep/glob finds anything. |
| Testing | Untestable (DOM-coupled globals) | Each module importable in isolation | Store, API, contracts all testable without DOM. |

## Sources

- [MDN: Import Maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) (browser support, constraints, usage)
- [web.dev: Import Maps Cross-Browser](https://web.dev/blog/import-maps-in-all-modern-browsers) (baseline availability since March 2023)
- [MDN: JavaScript Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) (ES module specification)
- [CSS-Tricks: State Management with Vanilla JS](https://css-tricks.com/build-a-state-management-system-with-vanilla-javascript/) (store pattern)
- [Plain Vanilla Web: Components](https://plainvanillaweb.com/pages/components.html) (Custom Elements without Shadow DOM)
- [Go Make Things: Shadow DOM is an Antipattern](https://gomakethings.com/the-shadow-dom-is-an-antipattern/) (rationale for avoiding Shadow DOM)
- [Vanilla JS Component Pattern](https://dev.to/megazear7/the-vanilla-javascript-component-pattern-37la) (Custom Element lifecycle)
- [esm.sh CDN](https://esm.sh/) (no-build ES module CDN for ethers.js)
- [DHH: Modern Web Apps Without Bundling](https://world.hey.com/dhh/modern-web-apps-without-javascript-bundling-or-transpiling-a20f2755) (no-bundler philosophy)
- Existing codebase: `beta/index.html` (4607 lines), `beta/mint.js` (~900 lines), `shared/nav.js` (513 lines), `shared/nav.css` (272 lines)
- Database API: `database/src/api/routes/` (6 route files: game, player, history, leaderboards, tokens, health)
