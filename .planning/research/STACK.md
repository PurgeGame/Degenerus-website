# Technology Stack

**Project:** Degenerus Game Frontend v2.0
**Researched:** 2026-03-18
**Constraint:** No build step. Static hosting. ESM imports via esm.sh (established pattern).

## Current Stack (Validated, Keep As-Is)

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| Vanilla HTML/CSS/JS | N/A | Core framework | Keep |
| ethers.js | 6.x (latest 6.16.0) | Wallet + contract interaction | Keep, import via `esm.sh/ethers@6` |
| CSS custom properties | N/A | Design system (dark theme, Inter) | Keep |
| Canvas 2D | Native | Scratch-off reveals | Keep for scratch mechanic |
| Web Audio API | Native | Procedural sound synthesis | Keep + extend (see below) |
| CSS 3D transforms | Native | Coin flip animation | Keep for coinflip base |
| SVG badge system | N/A | 6 categories x 8 symbols x 8 colors | Keep |
| shared/nav.js + nav.css | N/A | Navigation component | Keep |
| esm.sh CDN | N/A | ESM module delivery | Keep as import pattern |

## Recommended Additions

### GSAP (GreenSock Animation Platform)

| Property | Value |
|----------|-------|
| **Technology** | GSAP |
| **Version** | 3.14.x (latest 3.14.2) |
| **Purpose** | Timeline-based animation orchestration |
| **License** | Free for all use (Webflow acquisition, 2025) |
| **Confidence** | HIGH (official docs, CDN verified, 2M+ weekly downloads) |

**Why GSAP instead of Web Animations API or raw CSS:**

1. **Timeline sequencing.** The jackpot reveal, coinflip, and degenerette all require multi-step choreographed animations (spin slots, lock one, pause, lock next, pause, final reveal, celebrate). WAAPI can animate individual elements but has no native timeline/sequence concept. Building sequencing from scratch with WAAPI means reimplementing what GSAP already provides.

2. **Callback integration.** Each animation step needs to trigger sound effects, DOM updates, and state changes at precise moments. GSAP's `onStart`, `onComplete`, `onUpdate` callbacks on individual tweens within a timeline solve this cleanly. With WAAPI you'd wire up `finished` promises and chain them manually.

3. **Easing library.** GSAP ships dozens of easing functions including `elastic`, `bounce`, `back`, and `steps()` that are perfect for game UI (slot reel deceleration, coin bounce, win celebration overshoot). CSS/WAAPI easing is limited to cubic-bezier or `steps()`.

4. **Flip plugin.** Layout transitions (switching panels, expanding cards, reordering leaderboard entries) with Flip are trivial. Capture state, change DOM, animate from old to new. No manual position math.

5. **Battle-tested at scale.** 12M+ sites. Every edge case (transform conflicts, will-change management, GPU acceleration) handled internally.

**Why NOT Three.js/WebGL for the 3D coin:** The existing CSS `transform: rotateY()` with `preserve-3d` already produces a convincing coin flip. Adding Three.js (~150KB min) for a single coin is massive overkill. GSAP can orchestrate the existing CSS 3D transforms with better easing and timing control.

**Import pattern (matches existing ethers.js pattern):**
```javascript
import { gsap } from 'https://esm.sh/gsap@3.14';
import { Flip } from 'https://esm.sh/gsap@3.14/Flip';
import { TextPlugin } from 'https://esm.sh/gsap@3.14/TextPlugin';

gsap.registerPlugin(Flip, TextPlugin);
```

**Plugins to use:**
| Plugin | Purpose | Size Impact |
|--------|---------|-------------|
| Core | Tweens, timelines, easing | ~30KB gzipped |
| Flip | Layout state transitions (panel swaps, card reveals) | ~5KB |
| TextPlugin | Animated number counters (ETH amounts, timer digits) | ~2KB |

**Plugins to skip:**
| Plugin | Why Not |
|--------|---------|
| ScrollTrigger | Not a scroll-driven site. Game is interaction-driven. |
| ScrollSmoother | Same reason. |
| MorphSVG | Badge SVGs don't morph between states. |
| Draggable | No drag interactions in the game. |
| SplitText | No text splitting effects needed. |
| MotionPath | No path-following animations needed. |

### canvas-confetti

| Property | Value |
|----------|-------|
| **Technology** | canvas-confetti |
| **Version** | 1.9.x (latest 1.9.4) |
| **Purpose** | Win celebration particle effects |
| **Size** | ~6KB gzipped |
| **Confidence** | HIGH (GitHub verified, CDN available) |

**Why this and not custom particles:**

Writing a performant particle system from scratch is a known time sink. canvas-confetti is 6KB, zero-dependency, canvas-based, and handles cleanup automatically. It provides confetti, fireworks, snow, and custom shapes out of the box. Perfect for jackpot wins, coinflip payouts, and degenerette matches.

**Why not tsParticles:** tsParticles is 40KB+ and designed for persistent ambient effects. We need burst-on-event celebrations, not background ambiance. canvas-confetti is purpose-built for exactly this use case.

**Import pattern:**
```javascript
import confetti from 'https://esm.sh/canvas-confetti@1.9';
```

**Usage:** Fire on jackpot trait match, coinflip win, degenerette payout. Parametrize intensity by payout size (small win = small burst, jackpot = full screen).

### Import Maps

| Property | Value |
|----------|-------|
| **Technology** | `<script type="importmap">` |
| **Version** | Native browser feature |
| **Purpose** | Clean import paths, version pinning |
| **Browser support** | 93%+ (Chrome 89+, Firefox 108+, Safari 16.4+) |
| **Confidence** | HIGH (MDN, caniuse score 88) |

**Why:** The existing code uses full esm.sh URLs inline (`import { ethers } from 'https://esm.sh/ethers@6'`). With multiple new dependencies, repeating full URLs across many module files becomes fragile and hard to update. Import maps centralize version pinning in one place.

```html
<script type="importmap">
{
  "imports": {
    "ethers": "https://esm.sh/ethers@6.16",
    "gsap": "https://esm.sh/gsap@3.14",
    "gsap/Flip": "https://esm.sh/gsap@3.14/Flip",
    "gsap/TextPlugin": "https://esm.sh/gsap@3.14/TextPlugin",
    "canvas-confetti": "https://esm.sh/canvas-confetti@1.9"
  }
}
</script>
```

Then in any module file:
```javascript
import { gsap } from 'gsap';
import { ethers } from 'ethers';
import confetti from 'canvas-confetti';
```

Version bumps happen in one place. No find-and-replace across files.

## Explicitly NOT Adding

### Animation Frameworks

| Rejected | Why |
|----------|-----|
| Three.js | 150KB+ for a single coin animation. CSS 3D transforms + GSAP do the job. |
| Anime.js | Weaker timeline system than GSAP, smaller ecosystem, less battle-tested. |
| Motion (Framer Motion) | React-centric. Won't work cleanly with vanilla JS. |
| Lottie/lottie-web | Requires After Effects export pipeline. No AE workflow exists here. |
| Pixi.js | WebGL 2D renderer. Overkill for DOM-based game UI with occasional canvas. |

### Audio Libraries

| Rejected | Why |
|----------|-----|
| Howler.js | v2.2.4 is 2 years stale, no native ESM, and the existing Web Audio API procedural synthesis is already working well. Howler's value is cross-browser compat for audio file playback, but we're synthesizing procedurally, not loading files. |
| Tone.js | Full music production framework (~150KB). We need simple oscillators and noise bursts, not DAW features. The existing ~150 lines of Web Audio code already handle this. |

### UI Frameworks

| Rejected | Why |
|----------|-----|
| React/Vue/Svelte | Project constraint: no build step. Adding a framework now would require a build pipeline and rewrite. Vanilla JS with ES modules is the validated choice. |
| Lit / Web Components | Adds abstraction without clear benefit for this use case. Standard ES modules with a simple component convention achieve the same modularity. |
| Alpine.js | Reactive templating that works without build step, but the game doesn't need reactive data binding. It needs imperative animation control and direct DOM manipulation. |
| htmx | Server-driven updates. The game reads from REST API and writes to contracts. Not a server-rendered app. |

### State Management

| Rejected | Why |
|----------|-----|
| Redux/MobX/Zustand | These solve React state management. With vanilla JS, a simple event bus or pub/sub pattern (50 lines of code) handles cross-component communication without a library. |

### CSS Frameworks

| Rejected | Why |
|----------|-----|
| Tailwind | Requires build step (PostCSS). Existing CSS custom properties design system works well. |
| Bootstrap/Bulma | Generic component styling that conflicts with the custom dark theme aesthetic. |

## Architecture Patterns (No Library Needed)

### ES Module File Structure

Extract the 4600-line monolith into focused modules. No library needed, just native `import`/`export`.

```
game/
  index.html              -- Shell: importmap, layout, module entry
  css/
    base.css              -- Design tokens, reset, layout
    jackpot.css           -- Jackpot panel styles
    coinflip.css          -- Coinflip panel styles
    degenerette.css       -- Degenerette panel styles
    death-timer.css       -- Timer + urgency escalation
    ...
  js/
    app.js                -- Entry point, init, routing
    state.js              -- Game state singleton + event bus
    api.js                -- REST API client (fetch wrapper)
    wallet.js             -- ethers.js wallet connection
    contracts.js          -- Contract ABIs + write methods
    sfx.js                -- Web Audio procedural sound (extracted from beta)
    animations.js         -- GSAP timeline factories
    panels/
      jackpot.js          -- Jackpot hero display
      coinflip.js         -- Coinflip widget
      degenerette.js      -- Slot machine / trait picker
      death-timer.js      -- Countdown with urgency
      tickets.js          -- Ticket purchasing
      lootbox.js          -- Lootbox purchasing
      passes.js           -- Pass cards
      quests.js           -- Quest streak panel
      decimator.js        -- Decimator interface
      claims.js           -- Claim payouts
      affiliate.js        -- Affiliate code management
      baf.js              -- BAF leaderboard
      leaderboard.js      -- General leaderboards
```

### Event Bus Pattern (Build, Don't Install)

```javascript
// state.js -- ~30 lines, no library
const bus = new EventTarget();
const state = { level: 0, phase: 'purchase', wallet: null, /* ... */ };

export function emit(event, detail) {
  bus.dispatchEvent(new CustomEvent(event, { detail }));
}

export function on(event, handler) {
  bus.addEventListener(event, (e) => handler(e.detail));
}

export function getState() { return state; }
export function setState(patch) {
  Object.assign(state, patch);
  emit('state:changed', state);
}
```

This replaces any need for a state management library. Panels subscribe to events they care about, emit events when user acts. Simple, debuggable, zero dependencies.

### API Polling Pattern (Build, Don't Install)

```javascript
// api.js -- fetch wrapper with polling
const API_BASE = 'http://localhost:3000';
let pollInterval = null;

export async function get(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export function startPolling(path, callback, ms = 10000) {
  const tick = async () => {
    try { callback(await get(path)); } catch (e) { console.warn('Poll failed:', e); }
  };
  tick(); // immediate first call
  pollInterval = setInterval(tick, ms);
  return () => clearInterval(pollInterval);
}
```

No need for a real-time library (Socket.IO, etc.) since the backend is REST. Simple polling at 10-second intervals for game state, with faster polling (2s) during active animations (jackpot draws, death timer critical zone).

### Sound Effect Module (Extend Existing Pattern)

The existing ~150 lines of Web Audio procedural synthesis in beta/index.html are well-written. Extract them into `sfx.js` and extend with new effects for:

- Death timer heartbeat (escalating BPM as time runs out)
- Degenerette reel spin (continuous noise, decelerating)
- Win fanfare (layered ascending chords)
- Multiplier tier hit (pitch scales with tier)
- Urgency tick (metronome with increasing tempo)

No library needed. The existing pattern of `createOscillator()` + `createGain()` + envelope shaping is the right approach for these effects.

## Version Pinning Summary

| Package | Pinned Version | esm.sh URL |
|---------|---------------|------------|
| ethers | 6.16 | `https://esm.sh/ethers@6.16` |
| gsap | 3.14 | `https://esm.sh/gsap@3.14` |
| gsap/Flip | 3.14 | `https://esm.sh/gsap@3.14/Flip` |
| gsap/TextPlugin | 3.14 | `https://esm.sh/gsap@3.14/TextPlugin` |
| canvas-confetti | 1.9 | `https://esm.sh/canvas-confetti@1.9` |

Total new dependency weight: ~38KB gzipped (GSAP core + Flip + TextPlugin + canvas-confetti).

## What Changed vs Current Stack

| Area | Before (beta/) | After (game/) |
|------|----------------|---------------|
| Animation | CSS keyframes + manual `setTimeout` chains | GSAP timelines with callbacks |
| Celebrations | None | canvas-confetti particle bursts |
| Module system | Single 4600-line `<script>` | ES modules with import map |
| Sound | Web Audio API (keep) | Same, extracted to `sfx.js` module |
| 3D coin | CSS 3D transforms (keep) | Same, orchestrated by GSAP |
| Canvas scratch-off | Canvas 2D (keep) | Same, orchestrated by GSAP |
| State management | Global variables | Event bus singleton |
| API integration | None | Fetch wrapper with polling |
| Import management | Inline esm.sh URLs | Import map in HTML |

## Sources

- [GSAP Installation Docs](https://gsap.com/docs/v3/Installation/) - Version 3.14.x, CDN/ESM details
- [GSAP GitHub](https://github.com/greensock/GSAP) - License, releases
- [GSAP Free Announcement (CSS-Tricks)](https://css-tricks.com/gsap-is-now-completely-free-even-for-commercial-use/) - License change details
- [GSAP Flip Plugin Docs](https://gsap.com/docs/v3/Plugins/Flip/) - Layout transition animation
- [canvas-confetti GitHub](https://github.com/catdad/canvas-confetti) - Version, size, API
- [canvas-confetti jsDelivr](https://www.jsdelivr.com/package/npm/canvas-confetti) - CDN availability
- [esm.sh](https://esm.sh/) - ESM CDN patterns, standalone/tree-shaking
- [Import Maps (Can I Use)](https://caniuse.com/import-maps) - Browser support score 88
- [Import Maps (web.dev)](https://web.dev/blog/import-maps-in-all-modern-browsers) - Cross-browser milestone
- [Web Animations API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API) - Capabilities and limitations
- [Web Audio API Best Practices (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) - Procedural audio guidance
- [ethers.js npm](https://www.npmjs.com/package/ethers) - v6.16.0 latest
- [Howler.js ESM Issue](https://github.com/goldfire/howler.js/issues/1367) - No native ESM in stable release
