# Phase 52: Tickets, Packs & Jackpot Reveal - Research

**Researched:** 2026-04-24
**Domain:** Vanilla Custom Element hydration for ticket-inventory (4-trait quadrant cards) + GSAP pack-opening animation + reuse of the beta jackpot Roll widget
**Confidence:** HIGH on frontend patterns + contract math + reuse feasibility; MEDIUM on INTEG-01 response shape (proposed; database repo may refine); MEDIUM on pack-animation visual timing (visual-polish discretion)

## Summary

Phase 52 is the largest phase in v2.4 Player UI by requirement count (12: TICKETS-01..04, PACKS-01..05, JACKPOT-01..03), plus INTEG-01 as a hard gate. It replaces three Phase 50 skeletons (`<tickets-panel>`, `<jackpot-panel>`, and a new `<packs-panel>` — see Section 7 for the split rationale) with fully hydrated components that:

1. Render a player's ticket inventory as 4-trait quadrant cards grouped from `entryId/4` per level (TICKETS-01..04)
2. Show sealed-pack placeholders for pending/partial cards that open via GSAP timeline on user click (purchase + jackpot-win) or automatically on appear (lootbox) (PACKS-01..05)
3. Reuse beta's 1075-line `jackpot-panel.js` Roll 1/Roll 2 widget directly after a single 1-line upstream patch (JACKPOT-01..03, D-09)

The phase is hard-gated on INTEG-01: the database repo must ship `GET /player/:address/tickets/by-trait?level=N&day=M` per the spec in `.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md`. Wave 0's website-side deliverables are the Nyquist test harness (3-4 new test files) + a 1-line patch to `beta/components/jackpot-panel.js` swapping one wallet-tainted import; Wave 1 is pre-backend scaffolding; Wave 2 is hard-gated backend wiring; Wave 3 is optional UAT.

Frontend risk is LOW-MEDIUM. The store contract, skeleton-to-content swap, day-aware re-subscribe, stale-response guard, keep-old-data-dim overlay, and wallet-free helper re-implementation are all proven in Phases 50-51 and sit in `play/components/profile-panel.js` as the gold-standard template. The new-pattern surface is narrow: (a) a 4-SVG quadrant card grid, (b) a GSAP open-pack timeline (existing beta demonstrates 313-line GSAP timelines in `degenerette-panel.js` — reusable shape), (c) a Web Audio API sound wrapper with localStorage mute persistence (new, but ~50 LOC), and (d) a thin wrapper Custom Element around `beta/components/jackpot-panel.js` feeding it `game.*` state derived from `state.replay.*`.

**Primary recommendation:** Wave 0 ships (1) four Nyquist test files (`play-tickets-panel.test.js`, `play-packs-panel.test.js`, `play-jackpot-wrapper.test.js`, `play-shell-01-regression.test.js`), (2) a 1-line surgical patch to `beta/components/jackpot-panel.js:7` swapping `'../app/utils.js'` to `'../viewer/utils.js'`, (3) INTEG-01-SPEC.md copied-forward (or symlinked) into `.planning/phases/52-tickets-packs-jackpot/`, and (4) no REQUIREMENTS.md edits (no D-20-style dead-field drops discovered). Wave 1 (pre-backend) builds `<tickets-panel>` + `<packs-panel>` skeletons, adds `<jackpot-panel-wrapper>` importing beta's panel directly, installs `play/assets/audio/pack-open.mp3`, and adds CSS for cards/packs/animations. Wave 2 (hard-gated on INTEG-01) wires the `/player/:addr/tickets/by-trait?level=N&day=M` fetch with the double-stale-guard pattern, hydrates the card grids, triggers the GSAP pack-open timeline on click (or auto for lootbox-sourced), and connects the jackpot wrapper's `game.*` shim to `state.replay.level`. Wave 3 (optional UAT) validates gacha feel, audio gating, SVG render fidelity, rapid-scrub stability.

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-10)

**Area 1 — Ticket card visual design**
- **D-01** Grid of small cards (~120-160px wide). Dense deckbuilder-style inventory; scrolls vertically.
- **D-02** Trait SVGs via `traitToBadge(traitId)` from `beta/viewer/badge-inventory.js:22-32`, each filling ~80-90% of its quadrant cell. No text labels inside the card; tooltip on hover/focus shows the trait label (e.g., `zodiac_cancer_blue`).
- **D-03** Pending / partial / opened visuals:
  - **Opened**: 2x2 grid of 4 trait SVGs.
  - **Pending**: sealed "pack" graphic (CSS-only or a single `/play/assets/pack.svg`) with pulsing "tap to open" affordance once RNG resolves.
  - **Partial**: pack with N-of-4 quadrants peeked through torn wrapper; SVGs where traits known, pack-wrapper texture where not.
- **D-04** Pack source tint: purchase = neutral/white-tint, jackpot-win = gold-tint, lootbox = auto-opens (no sealed state). Shared silhouette across sources; small source-label pill ("purchased" / "won" / "lootbox") under each card.

**Area 2 — Pack reveal UX**
- **D-05** User-click gacha reveal for purchase + jackpot-win. Pack stays sealed with pulsing affordance post-RNG; click triggers GSAP timeline.
- **D-06** Lootbox-sourced (PACKS-04): auto-open on appear. Same GSAP timeline, auto-triggered on first render.
- **D-07** Quick-pop timeline, 300-500ms total: shake ~80ms, flash ~50ms, snap-open + bounce ~120ms, 4 SVGs slide/scale in ~150ms. `prefers-reduced-motion` fallback: instant state swap.
- **D-08** Day-change mid-animation: current animation completes (no abort); underlying list re-renders to new day. `onComplete` is a no-op if the element is gone.

**Area 3 — Jackpot widget reuse**
- **D-09** Import `beta/components/jackpot-panel.js` directly after a single upstream-patch fix: swap line 7 `'../app/utils.js'` → `'../viewer/utils.js'`. `beta/viewer/utils.js` exports the identical `formatEth` signature. Surgical, reversible, propagates future beta bug-fixes automatically.
- Audit trail: a grep-based test in `play/app/__tests__/` verifies `beta/components/jackpot-panel.js` does NOT import `'../app/utils.js'` post-patch — regression guard.

**Area 4 — Sound + audio UX**
- **D-10** On-by-default + speaker-icon toggle. One bundled MP3 (`play/assets/audio/pack-open.mp3`, ~300ms, single cue). Web Audio API wrapper (AudioContext → decodeAudioData → AudioBufferSource). First sound fires on user's first pack-open click (autoplay policy satisfied). Volume fixed at 0.4 in GainNode. Mute state persists in `localStorage.play.audio.muted`. Fail-silent on 404 or unsupported API (single console.warn). Sound plays even in `prefers-reduced-motion` unless muted.

### Claude's Discretion

- Card minimum size within the 120-160px range
- Exact GSAP easing curves (linear / ease-out / back.out)
- Pack SVG design (hand-crafted vs. generated; single shared silhouette)
- Partial-card rendering specifics (cut-line, wrapper opacity)
- Exact pulsing "tap to open" animation (border glow / scale / hue-rotate)
- Sound volume tuning (user chose 0.4 as "not too loud"; fine tuning at UAT)
- `<tickets-panel>` vs `<packs-panel>` split vs combined — Section 7 recommends two distinct panels sharing a data fetch; CONTEXT.md D-01..D-03 implies two
- Pagination/virtualization threshold for high-ticket players (Section 12 recommends scroll-only up to ~100 cards)

### Deferred Ideas (OUT OF SCOPE)

- Per-trait badge metadata tooltips (rarity, drop rate) — future polish
- Ticket card sort/filter controls (by source / by level) — raw inventory view suffices
- Multi-select / batch operations (e.g., "reveal all pending") — display-only this phase
- Trait statistics badges on opened cards (e.g., "1 of 17 this day") — future leaderboard feature
- Sound volume slider in UI — hardcoded 0.4 is fine for v2.4
- Separate "pack history" view — the card IS the history
- High-ticket pagination — defer until real-world usage shows the need

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TICKETS-01 | Selected player's ticket inventory rendered as 4-trait quadrant cards | Section 5 (badge SVG decomposer), Section 7 (Custom Element structure), Section 8 (fetch pattern) |
| TICKETS-02 | Each card visually shows 4 traits in the 4 quadrants in a consistent aesthetic | Section 5 (`traitToBadge` + CARD_IDX reshuffle), Section 3 (reusable asset inventory) |
| TICKETS-03 | Rendering groups 4 consecutive entries per card; partial groups render as pending | Section 10 (INTEG-01 cardIndex semantics), Section 9 (partial-state rendering) |
| TICKETS-04 | Untraited entries (awaiting VRF) render as "pending pack" placeholders | Section 9 (pending state + CSS), Section 10 (`traitId: null` handling) |
| PACKS-01 | Animated pack appears on ticket purchase | Section 9 (GSAP timeline + source-tint), Section 8 (day-aware re-fetch surfaces new packs) |
| PACKS-02 | Animated pack appears on jackpot-win | Section 10 (`source: "jackpot-win"` from INTEG-01), Section 9 (gold-tint variant) |
| PACKS-03 | Pack stays closed until VRF resolves then opens to reveal 4-trait tickets | Section 10 (`status: "pending"` / `"partial"` / `"opened"`), Section 9 (state machine) |
| PACKS-04 | Lootbox-sourced packs open immediately on lootbox open | Section 9 (auto-open first-render path), Section 10 (`source: "lootbox"`) |
| PACKS-05 | Pack-opening animation uses GSAP timeline with optional sound cue | Section 9 (GSAP timeline), Section 9.4 (Web Audio wrapper + mute toggle + autoplay unlock) |
| JACKPOT-01 | Roll 1/Roll 2 trait reveal animation for the selected effective day's jackpot | Section 6 (wrapper architecture), Section 4 (SHELL-01 transitive audit — safe to import) |
| JACKPOT-02 | Jackpot widget reuses beta's jackpot-panel Roll components without rewrite | Section 6 (direct import after 1-line patch), Section 4 (import graph verification) |
| JACKPOT-03 | Jackpot panel updates when day scrubber changes effective day | Section 6 (game.* shim bridging `replay.{day, level}` → beta's `game` subscription), Section 6.3 (level derivation) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ticket card grid render | Browser | API (database) | `<tickets-panel>` queries `/player/:addr/tickets/by-trait?level=N&day=M`; browser iterates `cards[]` and builds 2×2 SVG grids |
| Trait-id → SVG path decomposition | Browser | — | Pure formula: quadrant = id/64, symbolIdx = (id%64)/8, colorIdx = id%8. Reuses `traitToBadge()` at `beta/viewer/badge-inventory.js:22-32` |
| Per-card source/status determination | API (database) | Contracts | INTEG-01 returns `status` and `source` per card (grouped server-side from `traits_generated` + `lootbox_results` + `jackpot_distributions`). Browser renders it. |
| Pack-open GSAP timeline | Browser | — | Pure DOM manipulation; no server involvement. GSAP instance loaded from importmap (same as Phase 50 — verified at `play/index.html:17`) |
| Pack-open sound playback | Browser | — | AudioContext + fetch → decodeAudioData → AudioBufferSource. `localStorage.play.audio.muted` toggle. |
| Jackpot Roll 1/Roll 2 animation | Browser | API (database) | Beta's `jackpot-panel.js` fetches `/game/jackpot/{level}/player/{addr}?day=N` via `createJackpotRolls` factory; browser does the animation |
| Day-resolution (end-of-day-N snapshot) | API (database) | Contracts | INTEG-01 reuses `/activity-score?day=N` block-resolution SQL; identical to INTEG-02 pattern |
| Trait assignment authoritative source | Contracts | API (database) | `TraitsGenerated` event + on-chain `_raritySymbolBatch`; database replays via `replayTraits()` in `lcg-traits.ts` and stores `traitIds: jsonb` in `traits_generated` table |
| SHELL-01 wallet-free enforcement | Browser | — | Recursive scan in `play-shell-01.test.js`; new regression assertion guards `beta/components/jackpot-panel.js` doesn't re-introduce wallet-tainted import after D-09 patch |
| Jackpot widget level context | Browser | — | Wrapper derives `game.level` from `state.replay.level` via a store-shim; no server involvement |

## Reusable Assets Inventory

All paths absolute from `/home/zak/Dev/PurgeGame/website/`. SHELL-01 status confirmed via Section 4 below.

### Direct reuse (import verbatim after Wave 0 patch)
| Path | Purpose | Wallet-Free? | Notes |
|------|---------|--------------|-------|
| `beta/components/jackpot-panel.js` (1075 lines) | Roll 1/Roll 2 trait reveal widget | YES after 1-line patch (currently tainted at line 7) | D-09: Wave 0 swaps line 7 `'../app/utils.js'` → `'../viewer/utils.js'`. All other imports already clean. |
| `beta/app/jackpot-rolls.js` (954 lines) | Factory that jackpot-panel uses for Roll state-machine, grid rendering, pre-flight fetch | YES | Zero imports (pure module). Safe to reference for `CARD_IDX`, `JO_CATEGORIES`, `JO_SYMBOLS`, `joBadgePath`, `joFormatWeiToEth`, `joScaledToTickets`. |
| `beta/viewer/scrubber.js` | Day scrubber factory (beta/jackpot-panel's internal scrubber, not play's) | YES | Only imports `./api.js` which only imports `../app/constants.js` (wallet-free). |
| `beta/viewer/api.js` | Thin `fetchJSON` | YES | Imports only `../app/constants.js`. |
| `beta/viewer/utils.js` | `formatEth`, `formatBurnie`, `truncateAddress`, `formatWei` | YES (explicit SHELL-01 comment at line 2) | Drop-in replacement for beta/app/utils.js versions. The D-09 patch target. |
| `beta/app/store.js` | Reactive Proxy store (`subscribe`, `get`, `update`, `batch`) | YES | Already in use by Phase 50-51. `state.replay.{day, level, player}` namespace. |
| `beta/app/constants.js` | `API_BASE`, `BADGE_*`, `badgePath()`, `badgeCircularPath()` | YES (verified by direct grep — no ethers) | play/app/constants.js re-exports narrow surface per SHELL-01. |
| `beta/app/api.js` | `fetchJSON` (and a bunch of polling state) | YES for `fetchJSON` only; `fetchPlayerData` etc. are OK but carry unrelated logic | jackpot-panel imports `fetchJSON` from `../app/api.js` — that specific helper is wallet-free. |

### Re-implement locally (pattern only, not import)

| Play target | Beta analog | Why re-implement |
|-------------|-------------|------------------|
| `play/app/tickets-inventory.js` (NEW helper) | `beta/viewer/badge-inventory.js` lines 22-32 (`traitToBadge`) | Beta file renders a different UI shape (cumulative-counts grid); only the decomposer function is reusable. Copy `traitToBadge()` + `badgePath()` into a wallet-free helper. 20 LOC. |
| `play/app/pack-animator.js` (NEW helper) | `beta/components/degenerette-panel.js` lines 310-361 (GSAP timeline) | Beta does a slot-machine reveal; pack-open is a 4-corner reveal. Reference the timeline-building shape, not the specific animation. 40-60 LOC. |
| `play/app/pack-audio.js` (NEW helper) | `beta/components/replay-panel.js` lines 1900-1998 (Web Audio SFX) AND `beta/app/audio.js` (simpler `new Audio(path)` pattern) | Beta has two audio patterns: AudioContext-oscillator (replay-panel) and HTML5 `<audio>` element (app/audio.js). D-10 specifies AudioContext + decodeAudioData; neither beta pattern fits exactly. New wallet-free module ~50 LOC. |

### Visual / CSS references (don't copy DOM structure verbatim)
| Path | Relevance |
|------|-----------|
| `beta/styles/viewer.css:178-245` | `.badge-inventory__*` classes — visual grid + per-quadrant-category grouping. Phase 52 card grid is a DIFFERENT shape (per-player entry cards grouped by 4, not per-symbol counts), so borrow the SVG-sizing conventions only. |
| `beta/styles/replay.css:158-175` | `.replay-tq .badge-img` — 2×2 quadrant with badge-img styling; closer to D-02 target than viewer.css. Has `spinning` / `q-has-trait` / `q-no-tickets` / `q-scratchable` / `q-has-tickets` variants that pre-figure the pending/partial/opened states. |
| `beta/styles/skeleton.css:1-46` | Skeleton shimmer pre-Phase-50. Phase 52 reuses for card-grid first-load state. |
| `beta/styles/jackpot.css` entirely | Styles used by `beta/components/jackpot-panel.js` — the wrapper import in play/ must link this file too from `play/index.html`. |

### Files that MUST NOT be imported by play/

Already enforced by `play/app/__tests__/play-shell-01.test.js` (recursive scan); Phase 52 inherits coverage for any new files.

| Forbidden | Why |
|-----------|-----|
| `beta/app/utils.js` | `import { ethers } from 'ethers'` at line 3 |
| `beta/app/wallet.js` | EIP-6963 discovery; chains into ethers |
| `beta/app/contracts.js` | Imports ethers at line 5 |
| `beta/components/connect-prompt.js` | Wallet UI |
| `beta/components/purchase-panel.js` | Wallet writes |
| `beta/components/coinflip-panel.js` | Wallet writes |
| `beta/components/decimator-panel.js` | Wallet writes |
| `beta/app/quests.js` | Transitively wallet-tainted via `./utils.js` (Phase 51 finding) |

New forbidden pattern Phase 52 adds:

| New Forbidden | Why |
|---------------|-----|
| `beta/components/jackpot-panel.js` via its current `../app/utils.js` import | ONLY until Wave 0 lands the 1-line patch. After patch: safe to import. |

## SHELL-01 Transitive Audit (Answer to Q1)

**Question:** Beyond `beta/components/jackpot-panel.js:7` (`'../app/utils.js'`), does the jackpot-panel have other wallet-tainted transitive imports?

**Method:** Recursive grep of every import in the transitive closure.

**Full import graph for `beta/components/jackpot-panel.js` (direct + transitive):**

```
beta/components/jackpot-panel.js
├── ../app/store.js         [WALLET-FREE — zero imports at module level]
├── ../app/api.js           [WALLET-FREE]
│   ├── ./store.js                [↑]
│   └── ./constants.js            [WALLET-FREE — zero imports]
├── ../app/utils.js         [TAINTED — line 3: `import { ethers } from 'ethers'`] ← THE ONLY TAINT
├── ../viewer/scrubber.js   [WALLET-FREE]
│   └── ./api.js                  [WALLET-FREE — beta/viewer/api.js imports only ../app/constants.js]
│       └── ../app/constants.js   [WALLET-FREE, already verified]
└── ../app/jackpot-rolls.js [WALLET-FREE — zero imports; pure module]
```

**Verification commands (run at research time):**
```bash
grep -n "^import\|from " beta/components/jackpot-panel.js  # 5 imports, line 7 is the only wallet-taint
grep -n "ethers" beta/app/{store,api,constants,jackpot-rolls}.js  # 0 matches each
grep -n "ethers" beta/viewer/{scrubber,api,utils}.js  # 0 matches
grep -rn "ethers\|wallet.js\|contracts.js" beta/app/jackpot-rolls.js beta/app/store.js beta/app/api.js beta/app/constants.js beta/viewer/scrubber.js beta/viewer/api.js beta/viewer/utils.js
# → zero output
```

**Conclusion — HIGH confidence:**

1. **D-09 is GO.** The 1-line patch at `beta/components/jackpot-panel.js:7` (swap `'../app/utils.js'` → `'../viewer/utils.js'`) removes the only wallet-taint in the entire transitive graph. After the patch, `play/components/jackpot-panel-wrapper.js` can import `beta/components/jackpot-panel.js` directly with no SHELL-01 violation.

2. **The patch is safe for beta.** `beta/viewer/utils.js:22-30` `formatEth(weiString)` takes the SAME input (wei-string) and returns the SAME shape (human-readable string with the same precision tiers: `<0.001`, `.toFixed(4)` below 1, `.toFixed(3)` below 100, `.toFixed(2)` above). Runtime behavior is identical for every call site in jackpot-panel.js (verified: 10 call sites, all pass `weiString.toString()` or `BigInt(...).toString()` — wei format).

3. **No copy-and-scrub needed.** If the D-09 patch were not viable, the fallback would be to copy `beta/components/jackpot-panel.js` into `play/components/` and replace the wallet-tainted import. That's a 1075-LOC maintenance burden with divergence risk over time. The direct-import path is strictly better.

4. **Wave 0 regression guard REQUIRED.** `play/app/__tests__/play-jackpot-shell01-regression.test.js` (new) asserts `beta/components/jackpot-panel.js` does NOT match `/from\s+['"][^'"]*\/app\/utils\.js['"]/`. This catches any accidental beta-side revert of the patch. The existing `play-shell-01.test.js` only scans play/; a separate beta-file regression test is needed because jackpot-panel.js is in beta/ (the recursive play/ scan wouldn't catch its taint).

5. **The 10 formatEth call sites are all pre-existing beta code paths** (e.g., `jp-winner-summary`, `_buildSummaryHtml`) — the patch doesn't break anything because the replacement formatter has identical behavior.

## Badge SVG System Deep-Dive (Answer to Q2, Q11 CARD_IDX)

### Does `/badges-circular/` serve files correctly in the website repo?

**YES — verified.** The directory exists at `/home/zak/Dev/PurgeGame/website/badges-circular/` (website root); contains 256 pre-rendered SVG files (6 categories × 8 items × 8 colors — but `cards` uses a reshuffle map, see below). File naming convention: `{category}_{zero-padded fileIdx}_{itemName}_{colorName}.svg` (e.g., `cards_00_horseshoe_blue.svg`, `zodiac_03_cancer_gold.svg`).

Path used across all three routes:
- `play/index.html:31` uses `/badges-circular/flame_red.svg`
- `beta/index.html:47` uses `/badges-circular/flame_red.svg`
- `beta/viewer.html:34` uses `/badges-circular/flame_red.svg`

All three render via the same Python dev server (`python3 -m http.server 8080` per PROJECT.md); production Cloudflare Pages serves the static directory at the same `/badges-circular/*` path. No path-resolution special-casing needed for play/.

### `traitToBadge()` decomposer — the formula

Source: `beta/viewer/badge-inventory.js:22-32` (wallet-free, safe to reuse/copy):

```javascript
// QUADRANTS[0]=crypto, [1]=zodiac, [2]=cards, [3]=dice
const QUADRANTS = ['crypto', 'zodiac', 'cards', 'dice'];
const COLORS = ['pink', 'purple', 'green', 'red', 'blue', 'orange', 'silver', 'gold'];
const ITEMS = {
  crypto: ['xrp', 'tron', 'sui', 'monero', 'solana', 'chainlink', 'ethereum', 'bitcoin'],
  zodiac: ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'libra', 'sagittarius', 'aquarius'],
  cards:  ['club', 'diamond', 'heart', 'spade', 'horseshoe', 'cashsack', 'king', 'ace'],
  dice:   ['1', '2', '3', '4', '5', '6', '7', '8'],
};
// THE CARD_IDX RESHUFFLE (DO NOT SIMPLIFY):
const CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7];

function badgePath(category, symbolIdx, colorIdx) {
  const fileIdx = category === 'cards' ? CARD_IDX[symbolIdx] : symbolIdx;
  const name = ITEMS[category][symbolIdx];
  return `/badges-circular/${category}_${String(fileIdx).padStart(2, '0')}_${name}_${COLORS[colorIdx]}.svg`;
}

function traitToBadge(traitIndex) {
  const quadrant = Math.floor(traitIndex / 64);     // 0..3
  const category = QUADRANTS[quadrant];
  const within = traitIndex % 64;
  const itemIdx = Math.floor(within / 8);           // 0..7 (symbolIdx in contract)
  const colorIdx = within % 8;                      // 0..7
  return { category, item: ITEMS[category][itemIdx], itemIdx, colorIdx, color: COLORS[colorIdx],
           path: badgePath(category, itemIdx, colorIdx) };
}
```

### The CARD_IDX reshuffle (CRITICAL — easy to get wrong)

**What it does:** For the `cards` quadrant ONLY, the contract's `symbolIdx` (0-7) does NOT map 1-to-1 to the filesystem's `fileIdx`. The mapping is `fileIdx = CARD_IDX[symbolIdx]`.

| Contract symbolIdx | Contract symbol name | Filesystem fileIdx | Filesystem filename prefix |
|-------------------|---------------------|--------------------|--------------------------|
| 0 | `club` | 3 | `cards_03_club_*` |
| 1 | `diamond` | 4 | `cards_04_diamond_*` |
| 2 | `heart` | 5 | `cards_05_heart_*` |
| 3 | `spade` | 6 | `cards_06_spade_*` |
| 4 | `horseshoe` | 0 | `cards_00_horseshoe_*` |
| 5 | `cashsack` | 2 | `cards_02_cashsack_*` |
| 6 | `king` | 1 | `cards_01_king_*` |
| 7 | `ace` | 7 | `cards_07_ace_*` |

**Why it exists:** The filesystem naming dates back to an earlier contract schema; the `CARD_IDX` array preserves legacy filenames while the contract uses the "rarity ordering" (higher symbolIdx = rarer). Don't "fix" it — both beta modules depend on this mapping, and the SVG files on disk reflect the old order.

**Verified identical in three places:**
- `beta/app/constants.js:53` — used by `badgePath()` and `badgeCircularPath()`
- `beta/app/jackpot-rolls.js:26` — used by `joBadgePath()`
- `beta/viewer/badge-inventory.js:14` — used by `badgePath()`

All three are module-local constants; no shared import. Phase 52 should define it once in a new `play/app/tickets-inventory.js` helper and not re-import from beta (keeps SHELL-01 narrow).

### Trait ID encoding summary

Contract emits `uint8 traitId` (0-255). Decomposition:

```
traitId (0-255)
├── quadrant = traitId / 64        // (0-3) → crypto, zodiac, cards, dice
├── symbolIdx = (traitId % 64) / 8 // (0-7) → item within quadrant
└── colorIdx = traitId % 8         // (0-7) → color
```

Quadrant is an explicit bit-field in the contract: `(category << 3) | sub`. See `DegenerusGameMintModule.sol` comment at lines 440-478. `traitFromWord` in `degenerus-audit/contracts/modules/DegenerusGameMintStreakUtils.sol` emits the 6-bit combination; quadrant bits (`(i & 3) << 6`) are added when the trait is written to a ticket slot.

**Recommended: create `play/app/tickets-inventory.js`** with a single export `traitToBadge(traitId)` returning `{ path, category, item, color, itemIdx, colorIdx }`. 22 LOC. Wallet-free (no imports). Gets SHELL-01 coverage via the existing `play-shell-01.test.js` recursive scan.

## Jackpot Widget Integration Architecture (Answer to Q3, Q4)

### Current state of `beta/components/jackpot-panel.js`

**1075 lines.** Functional responsibilities:

| Feature | Lines | Notes |
|---------|-------|-------|
| Skeleton + content template (`data-bind="skeleton"` / `"content"`) | 41-137 | Standard Phase 50-compatible dual-template shape. |
| Internal scrubber wire-up | 139-148 | Uses `createScrubber` from `beta/viewer/scrubber.js` |
| Overview `<details>` lazy-open wiring | 150-160 | `#renderOverview(level)` called on first expand |
| Replay state machine + button wiring | 163-189 | `createJackpotRolls` factory instance; `#jp-replay-btn` event wiring |
| `#renderOverview` | 201-297 | Fetches `/game/jackpot/:level/overview[?day=N]`; badge-grid render |
| `#renderWinnerSummary` | 318-425 | Aggregates per-category winner rows |
| `#onDayChange` | 440-675 | Fetches winners, auto-selects highest-payout, sets state |
| Replay state transitions | 749-1027 | roll1/roll2 animations, spinning flame, reveal staggers |
| `#onGameUpdate(game)` | 1036-1071 | **THE ONLY STORE SUBSCRIPTION** — subscribes to top-level `game` state |

### How does it hook into state? (Answer to Q3)

**Only one subscription:** `subscribe('game', (game) => this.#onGameUpdate(game))` at line 188.

`#onGameUpdate(game)` reads:
- `game.jackpotDay` → sets the "Day N/5" header label
- `game.level` → used in first-load path to initialize scrubber range via `/game/jackpot/latest-day` + `/game/jackpot/earliest-day`
- `game.phase` → used internally in `#computeLatestCompletedDay(game)` (PURCHASE vs JACKPOT phase logic)

**It does NOT subscribe to `replay.day` or `replay.player`.** It has its own internal scrubber inside the panel. The scrubber updates `#currentDay` (private field) and triggers `#onDayChange(day)` → re-fetch.

**It does NOT know about `replay.level`.** The level comes from `game.level` (top-level app state reflecting the current contract-state level, NOT the day-scrubber's level).

### Implication for JACKPOT-03 ("panel updates when day scrubber changes effective day")

The beta panel's internal scrubber operates on `#currentDay` — its OWN cursor, independent of `state.replay.day`. If we put `<jackpot-panel>` inside `<play-route>` and the user moves play's top-level `<day-scrubber>`, beta's panel's internal scrubber stays where it was.

**The fix — wrapper Custom Element (`<jackpot-panel-wrapper>` on play/):**

```javascript
// play/components/jackpot-panel-wrapper.js (sketch; Wave 1/2 materializes)

import { subscribe, get, update } from '../../beta/app/store.js';
import '../../beta/components/jackpot-panel.js';  // registers <jackpot-panel>

class JackpotPanelWrapper extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    this.innerHTML = `<jackpot-panel></jackpot-panel>`;
    const panelEl = this.querySelector('jackpot-panel');

    // Shim: beta/jackpot-panel subscribes to `game.*` — we rebroadcast
    // replay.* into game.* so the panel thinks the scrubber moved.
    this.#unsubs.push(
      subscribe('replay.day', (day) => {
        if (day == null) return;
        // Write into beta store's game.jackpotDay slot; panel's #onGameUpdate will fire
        update('game.jackpotDay', (day - 1) % 5 + 1);  // see note on level→day mapping
      }),
      subscribe('replay.level', (level) => {
        if (level == null) return;
        update('game.level', level);
      }),
    );

    // Also propagate the scrubber day directly into beta's internal scrubber
    // state. This requires reaching into the child panel — see Section 6.2.
  }

  disconnectedCallback() { this.#unsubs.forEach(fn => fn()); this.#unsubs = []; }
}
customElements.define('jackpot-panel-wrapper', JackpotPanelWrapper);
```

**Trade-offs the planner must weigh:**

**Option A — Shim via `update('game.*', ...)` (sketch above).**
- Pros: No changes to beta/jackpot-panel.js beyond D-09 patch. Unidirectional: play's scrubber → beta panel.
- Cons: Requires understanding beta's `game.jackpotDay` math (day counter within level, 1..5). The day-scrubber's `state.replay.day` is a GLOBAL day number (e.g., day 47); beta's `game.jackpotDay` is a within-level counter. Mapping is `day → level` via `/game/jackpot/day/{day}/winners` or `(day - 1) / 5 + 1` for uniform 5-day levels.
- Mitigation: `/replay/rng` already returns days with their levels (every day has one row). Wrapper can fetch or reuse a map of day→level.

**Option B — Reach into the child and call `scrubber.setDay()` programmatically.**
- Pros: Directly drives beta's internal scrubber; same code path as a user click.
- Cons: Tight coupling to beta's private scrubber instance. Beta's panel stores it as `#scrubber` (private field). Not exposed.
- Mitigation: Add a public method `setDay(day)` to beta/jackpot-panel (requires a second small beta patch; divergence risk).

**Option C — Add a subscription to `replay.day` inside beta/jackpot-panel directly.**
- Pros: Cleanest — beta panel listens to both `game` AND `replay.day`; play and beta both work.
- Cons: Invasive change to beta (>1 line); can break beta's own replay logic (replay-panel populates replay.day too).

**Recommendation: Option A (store-shim wrapper).** Lowest-invasiveness on beta, and the day-to-level mapping is cheap (either pre-computed once from `/replay/rng` or derived arithmetically).

### Level derivation for JACKPOT-01/02 (Answer to Q4)

ROADMAP Success Criterion 4 says: *"Roll 1 / Roll 2 trait reveal animation for the selected effective day's jackpot"*. The jackpot is identified by **level** (not day); the mapping is "day N → level resolved at that day".

**Three ways to get the level:**

1. **From `state.replay.level`** — Phase 50 establishes this as "the jackpot level for that day" (source: `beta/app/store.js:88-94` comment: *"Replay mode: populated by replay-panel on day-change; consumed by status-bar"*). If Phase 52 wires the day-scrubber to populate `replay.level` on day-change, JACKPOT-03 falls out automatically.
2. **From the INTEG-01 query itself** — `/player/:addr/tickets/by-trait?level=N` requires a level, so the `<tickets-panel>` already needs to know the level. Both panels can share a single `state.replay.level`.
3. **Derived arithmetically** — `level = ceil(day / 5)` for uniform 5-day levels. But not all levels are 5 days (purchase phase vs jackpot phase, compressed/normal mode). Rely on indexed data (option 1 or 2), not arithmetic.

**Who writes `state.replay.level`?** As of Phase 50 it's declared but not populated by `play/app/main.js`. Phase 50 only writes `replay.day` and `replay.player` (verified in `play/app/main.js:102` and `:73`). **Phase 52 must populate `replay.level` as part of the day-scrubber wiring OR as a side-effect of the INTEG-01 fetch.**

**Recommended approach:** On day-scrubber change, fetch `/game/jackpot/day/{day}/winners` which returns `{ level, winners: [...] }` (shipped in Phase 50; beta's jackpot-panel already calls it at line 473) and write `level` into `state.replay.level`. Both `<tickets-panel>` and `<jackpot-panel-wrapper>` can then read `replay.level` via `subscribe` / `get`.

**Alternative (simpler):** Since `/replay/rng` already enumerates days (Phase 50 bootstrap), extend that response to include `level` per day (backend change — would need coordination with database repo). Probably overkill.

**Simplest of all:** Hardcode `level = Math.ceil(day / 5)` as a first approximation for Wave 1 (works for all v1.1 contract runs except compressed terminal mode); replace with real lookup in Wave 2. This lets Wave 1 build the wrapper skeleton pre-backend.

### What `beta/components/jackpot-panel.js` expects from the environment

Beyond the 1-line utils.js patch, the imported panel expects:

1. **Beta API endpoints present at `API_BASE`**: `/game/jackpot/day/{day}/winners`, `/game/jackpot/{level}/overview?day=N`, `/game/jackpot/{level}/player/{addr}?day=N`, `/game/jackpot/{level}/latest-day`, `/game/jackpot/{level}/earliest-day`. All shipped (used by beta in production; play's `/play/` dev server hits the same Fastify at localhost:3000).
2. **CSS classes defined**: `.panel`, `.jackpot-panel`, `.jp-day-scrubber`, `.jp-winner-summary`, `.jp-replay-section`, `.jp-spin-flame`, `.jp-replay-btn`, `.jp-roll1-result`, `.jp-roll2-result`, `.jp-roll2-slot-grid`, `.jp-slot-symbol`, `.jp-slot-wins`, `.jp-slot-amount`, `.jp-ticket-subrow`, `.jp-overview`, `.jo-grid`, `.jo-header`, `.jo-row`, `.jo-type-badge`, `.jo-bonus`, `.jo-winners`, `.jo-unique`, `.jo-coin`, `.jo-tickets`, `.jo-eth`, `.jo-spread`, `.jo-spread-bar`, `.jp-winners`, `.jp-winners-group`, `.jp-winners-list`, `.jp-winner-item`, `.jp-winner-item--selected`, `.jp-winner-item--empty`, `.jp-summary-*`, `.jp-row-reveal`.

   All defined in `beta/styles/jackpot.css` (1050+ lines). **Phase 52 must add `<link rel="stylesheet" href="/beta/styles/jackpot.css">` to `play/index.html`.**

3. **`gsap` importmap entry** — already present in `play/index.html:17-19`.
4. **`canvas-confetti` importmap entry** — already present; beta's jackpot-panel doesn't import it, but if we later extend with a confetti-on-win burst it's wired.

## Custom Elements Structure Proposal (Answer to Q10)

### Recommendation: Three distinct Custom Elements

| Element | Role | Data source | LOC est |
|---------|------|-------------|---------|
| `<tickets-panel>` | Renders the grid of opened ticket cards. Pulls INTEG-01, filters `cards[]` where `status === 'opened'`, renders 4-SVG quadrants. Handles empty states (0 tickets), stale overlay, day/player re-subscribe. | `/player/:addr/tickets/by-trait?level=N&day=M` | 250-350 |
| `<packs-panel>` | Renders the grid of pending/partial packs (same INTEG-01 response, filtered `status !== 'opened'`). Owns the GSAP timeline + audio wrapper + mute toggle. Emits state transition (pending → opened) locally after user click animates. | Same INTEG-01 endpoint (shared fetch token? see below) | 350-450 |
| `<jackpot-panel-wrapper>` | Thin wrapper around beta's `<jackpot-panel>`. Shims `replay.*` → `game.*`, links `beta/styles/jackpot.css` in index.html, ensures level context is populated. | N/A (delegates to beta) | 60-100 |

### Why two panels not one combined?

CONTEXT.md D-01 says "Grid of small cards" (singular grid) but D-03 describes three visually distinct states (opened, pending, partial). Splitting along "opened vs not" gives cleaner UX: opened cards are "inventory" (browse your traits), pending/partial are "packs to open" (call-to-action). Two panels means two grid areas that can be laid out independently (packs above tickets, or side-by-side).

**Shared data fetch:** Both panels want the same INTEG-01 response. Three approaches:

**Approach 1 — Each panel fetches independently.**
- Pros: Each panel owns its own fetch token; independent stale-guards; easier to reason about.
- Cons: Same URL hit twice on every day/player/level change. API-server load doubles (acceptable at N-player scale, but a code smell).

**Approach 2 — One fetches, writes to store; other subscribes.**
- Pros: One fetch per change. No duplicate request.
- Cons: Adds a new store slot (`state.replay.ticketsByTrait`?). Requires ordering: `<tickets-panel>` fetches only if `<packs-panel>` hasn't; invariant unclear.

**Approach 3 — Shared helper module with in-flight promise dedup.**
- Pros: Panel-agnostic; clean; dedup is a 10-LOC pattern.
- Cons: Requires a new `play/app/tickets-fetch.js` helper module.

**Recommendation: Approach 3** (shared helper). Pattern:

```javascript
// play/app/tickets-fetch.js
let inFlight = null;
let lastKey = null;
let lastResult = null;
let lastResultKey = null;

export async function fetchTicketsByTrait(addr, level, day) {
  const key = `${addr}::${level}::${day}`;
  if (key === lastResultKey && lastResult) return lastResult;  // already cached
  if (key === lastKey && inFlight) return inFlight;             // dedup in-flight
  lastKey = key;
  inFlight = fetch(`${API_BASE}/player/${addr}/tickets/by-trait?level=${level}&day=${day}`)
    .then(r => r.ok ? r.json() : null)
    .then(data => { lastResult = data; lastResultKey = key; inFlight = null; return data; })
    .catch(err => { inFlight = null; throw err; });
  return inFlight;
}
```

Both panels call `fetchTicketsByTrait(addr, level, day)`; first call fires the HTTP request, second returns the in-flight promise. Cache by key prevents refetch on reconnect-re-subscribe within the same key. Invalidation is implicit via the key change (day/player/level change → new key → new fetch).

Stale-guard still lives in each panel (`#ticketsFetchId` private field). The helper dedups wire-level requests; the panel dedups stale-render races.

### `<packs-panel>` sub-structure — responsibilities

1. Fetch INTEG-01 via `fetchTicketsByTrait(...)`
2. Filter to `cards.filter(c => c.status !== 'opened')`
3. Render a grid of pack placeholders (CSS-only initially)
4. For each card:
   - If `status === 'pending'`: sealed pack, pulsing affordance
   - If `status === 'partial'`: pack with N-of-4 quadrants peeked
   - Click handler → GSAP timeline (D-07)
5. Lootbox-sourced cards from INTEG-01 (if `source === 'lootbox'`): auto-trigger timeline on first render (D-06). Track "already animated" in a WeakSet keyed by card DOM node to avoid re-animating on re-render.
6. Speaker-icon mute toggle in top-right; persists to `localStorage.play.audio.muted`.

### `<tickets-panel>` sub-structure — responsibilities

1. Same fetch path (deduped via helper)
2. Filter to `cards.filter(c => c.status === 'opened')`
3. Render a grid of opened cards (2×2 trait SVGs per card)
4. Hover/focus tooltips showing trait labels (D-02: "zodiac_cancer_blue")
5. Empty state: "No tickets at level N" if `cards[]` is empty
6. Source-label pill under each card ("purchased" / "won" / "lootbox")

### Ordering in the grid

Panel-grid order (`play/index.html:48-57`) currently has `<tickets-panel>` in slot 2 (after profile). Phase 52 replaces it with:

```html
<profile-panel data-slot="profile"></profile-panel>
<packs-panel data-slot="packs"></packs-panel>      <!-- NEW -->
<tickets-panel data-slot="tickets"></tickets-panel>
<purchase-panel data-slot="purchase"></purchase-panel>
<coinflip-panel data-slot="coinflip"></coinflip-panel>
<baf-panel data-slot="baf"></baf-panel>
<decimator-panel data-slot="decimator"></decimator-panel>
<jackpot-panel-wrapper data-slot="jackpot"></jackpot-panel-wrapper>  <!-- WAS: <jackpot-panel> -->
```

**Note:** `<jackpot-panel>` was registered as a Phase 50 skeleton. Phase 52 replaces it with `<jackpot-panel-wrapper>` (new tag, renders beta's `<jackpot-panel>` inside it). The Phase 50 tag name collision: we either (a) keep the tag `<jackpot-panel>` and change its class implementation (risky — two classes define the same tag throws), or (b) rename the play/ tag to `<jackpot-panel-wrapper>` and update `play/index.html`.

**Recommendation: (b) rename the play/ tag to `<jackpot-panel-wrapper>`.** Clean separation from beta's `<jackpot-panel>`; no registry collision; obvious at read-time that this is a wrapper.

**Wave 0 test update:** `play/app/__tests__/play-panel-stubs.test.js` at line 30 currently asserts `<jackpot-panel>` exists in play/. Phase 52 removes the play/ `<jackpot-panel>` stub (delete `play/components/jackpot-panel.js`) and adds assertions for `<jackpot-panel-wrapper>`. Fix the test expectations in Wave 0 so the stub tests don't break when the wrapper replaces the stub in Wave 1.

## Day-Aware Fetch Pattern Adaptation (building on Phase 51 §8)

Pattern is mature. Phase 52 reuses the exact shape from `play/components/profile-panel.js:327-365`:

```javascript
// Template: stale-guard fetch pattern (copy from profile-panel.js)

#ticketsFetchId = 0;

async #refetch() {
  const addr = get('replay.player');
  const level = get('replay.level');
  const day = get('replay.day');
  const token = ++this.#ticketsFetchId;
  if (!addr || level == null || day == null) return;

  if (this.#loaded) {
    this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
  }

  try {
    const data = await fetchTicketsByTrait(addr, level, day);  // via shared helper
    if (token !== this.#ticketsFetchId) return;                // stale guard #1
    if (!data) { this.#renderError(404); return; }
    this.#renderCards(data.cards);
    this.#showContent();
    this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
  } catch (err) {
    if (token === this.#ticketsFetchId) this.#renderError(0);
  }
}
```

**Differences from profile-panel.js:**

1. **Three subscribes, not two.** Subscribe to `replay.day` + `replay.player` + `replay.level` (profile-panel only needs day + player; tickets panel is per-level because the endpoint is per-level).
2. **Wait until all three are populated.** Phase 50's boot order: day and player populate first (via scrubber init and player-selector change); `replay.level` is not yet populated in Phase 50. Phase 52 must either (a) populate `replay.level` from the scrubber change, or (b) have the tickets-panel fetch its own level from `/game/jackpot/day/{day}/winners`. Recommend (a) — write `replay.level` in Phase 52 from the day-scrubber wiring (or from a helper).
3. **Shared helper for dedup** — `fetchTicketsByTrait()` instead of raw `fetch()`. The stale-guard still lives in the panel (the helper only dedups wire requests, not renders).
4. **Double stale-guard** — Phase 51's profile-panel.js does a SINGLE token check (post-fetch). The INTEG-01 response is larger; add the POST-json check too (matches the Phase 51 D-18 intent):

```javascript
const response = await fetch(url);
if (token !== this.#ticketsFetchId) return;  // post-fetch
const data = await response.json();
if (token !== this.#ticketsFetchId) return;  // post-json (double guard)
```

5. **Keep-old-data-dim applies to the card grid, not just the content wrapper.** During refetch, existing cards dim to 60% opacity, retain click handlers (in-flight animations complete per D-08), and swap on fetch success. The `.is-stale` class on `[data-bind="content"]` covers this.

## Pack Animation Pipeline (Answer to Q5, Q6, Q11 day-change, Q11 GSAP cleanup)

### GSAP availability in play/

**GSAP is already loaded** via `play/index.html:17-19`:

```html
<script type="importmap">
{
  "imports": {
    "gsap": "https://esm.sh/gsap@3.14",
    "gsap/Flip": "https://esm.sh/gsap@3.14/Flip",
    "gsap/TextPlugin": "https://esm.sh/gsap@3.14/TextPlugin",
    ...
  }
}
</script>
```

**Existing Phase 50 test verifies this** (`play/app/__tests__/play-route-structure.test.js:34`: `assert.match(src, /gsap@3\.14/);`). The `<packs-panel>` can `import gsap from 'gsap';` at the top of the module; ESM loader resolves via importmap; no CDN jank because Phase 50 pre-loaded the importmap on every page.

### GSAP timeline — D-07 breakdown

D-07 specifies: **shake ~80ms → flash ~50ms → snap-open + bounce ~120ms → 4 SVGs slide/scale in ~150ms** (total ~400ms).

Sketch:

```javascript
// play/app/pack-animator.js (new module)
import gsap from 'gsap';

export function animatePackOpen(packEl, onComplete) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) {
    // Instant state swap (D-07 fallback)
    packEl.classList.remove('pack-sealed');
    packEl.classList.add('pack-opened');
    if (onComplete) onComplete();
    return null;  // no timeline returned
  }

  const traits = packEl.querySelectorAll('.pack-trait');
  const wrapper = packEl.querySelector('.pack-wrapper');

  const tl = gsap.timeline({ onComplete });

  // Phase 1: shake (~80ms)
  tl.to(packEl, { x: -2, duration: 0.020, yoyo: true, repeat: 3, ease: 'power1.inOut' });

  // Phase 2: flash (~50ms)
  tl.to(packEl, { opacity: 0.6, duration: 0.025, yoyo: true, repeat: 1 }, '>');

  // Phase 3: snap-open + bounce (~120ms)
  tl.to(wrapper, { scale: 1.05, opacity: 0, duration: 0.12, ease: 'back.in(1.5)' }, '>');

  // Phase 4: slide/scale traits in (~150ms, staggered)
  tl.fromTo(traits,
    { scale: 0.3, opacity: 0 },
    { scale: 1, opacity: 1, duration: 0.15, stagger: 0.02, ease: 'back.out(1.3)' },
    '>');

  return tl;  // caller can kill() if needed
}
```

### Day-change mid-animation (D-08)

CONTEXT.md D-08 says: *"the CURRENT animation runs to completion (no abort), but the underlying card list re-renders"*.

**Implementation path:**

1. Don't kill the GSAP timeline on day-change — let it play out.
2. The underlying `<packs-panel>` re-fetches on `replay.day` change (via stale-guard), which swaps the DOM. The in-flight timeline targets elements that may no longer be in the DOM.
3. GSAP's default `onComplete` runs even if the targeted elements have been removed — the callback just fails to do anything useful. **No memory leak** — GSAP stores a weak reference; when the element is garbage-collected, the timeline references are freed.

**Verified by reading GSAP 3.14 docs:** timelines do NOT hold strong references to removed DOM nodes beyond the timeline's own internal tween storage. Once the timeline completes, the tween storage is released. For an animating element that's removed mid-timeline, the tween completes against a detached node and the node becomes GC-eligible once the timeline finishes.

**Belt-and-suspenders — tl.kill() on disconnect:** If the WHOLE `<packs-panel>` is disconnected (not just individual cards), we should explicitly kill any in-flight timelines:

```javascript
#activeTimelines = new Set();

animatePack(packEl) {
  const tl = animatePackOpen(packEl, () => this.#activeTimelines.delete(tl));
  if (tl) this.#activeTimelines.add(tl);
}

disconnectedCallback() {
  this.#activeTimelines.forEach(tl => tl.kill());
  this.#activeTimelines.clear();
  // ...
}
```

This handles the edge case where the Custom Element is removed entirely (e.g., page navigation); individual card removals during re-render are fine without explicit kill().

### Web Audio API — `play/app/pack-audio.js` (new module)

D-10 specifies: AudioContext + decodeAudioData + AudioBufferSource + GainNode at 0.4 + localStorage persistence + fail-silent + first-gesture autoplay unlock.

```javascript
// play/app/pack-audio.js (sketch; ~60 LOC)

const STORAGE_KEY = 'play.audio.muted';
const VOLUME = 0.4;

let ctx = null;
let buffer = null;
let loadError = null;

async function ensureLoaded() {
  if (ctx || loadError) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const resp = await fetch('/play/assets/audio/pack-open.mp3');
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
  if (!buffer || !ctx) return;  // fail-silent per D-10
  // Resume if suspended (browser autoplay policy — first-gesture unlock)
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

**Call site:** Inside `animatePackOpen()`'s Phase 3 (snap-open), fire `playPackOpen()` at the same beat — the sound timing aligns with the visual open. Per D-10, sound plays in `prefers-reduced-motion` too (unless muted) — so the reduced-motion branch should also call `playPackOpen()`.

**Mute toggle UI:** A speaker icon button in the top-right of `<packs-panel>`. Click toggles `setMuted(!isMuted())` and updates the icon (🔊/🔇 or a CSS-styled div). Persist across refreshes via localStorage. Do NOT subscribe to storage events — single-tab assumption is fine.

## INTEG-01 Endpoint Implementation Notes (Answer to Q7)

This section refines the existing INTEG-01-SPEC.md (123 lines at `.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md`) with database-side implementation detail so the planner can structure the Wave-2 side-quest delivery plan precisely like Phase 51's INTEG-02 side-quest (3 atomic commits: feat, docs, test).

### Where the endpoint lives in the database repo

- Handler file: `/home/zak/Dev/PurgeGame/database/src/api/routes/player.ts` (extend the existing `playerRoutes` plugin)
- Schema file: `/home/zak/Dev/PurgeGame/database/src/api/schemas/player.ts` (add new `ticketsByTraitResponseSchema` and `ticketsByTraitQuerySchema`)
- Test file: `/home/zak/Dev/PurgeGame/database/src/api/routes/__tests__/player-tickets-by-trait.test.ts` (new)

### Data sources audit

**The endpoint must assemble `cards[]` from three data sources:**

1. **Per-level ticket counts** (for totalEntries): `player_tickets` table (`database/src/db/schema/tickets.ts`). Schema:
   ```sql
   player_tickets(id, player, level, ticketCount, totalMintedOnLevel, bufferSlot, blockNumber, blockHash)
   ```
   **Problem:** This is upsert-accumulated, not append-only. A single `player_tickets(player='0xAA', level=5, ticketCount=12)` row doesn't distinguish the 4-ticket grouping into cards. The endpoint must count entries via a DIFFERENT source.

2. **Trait assignments** (for traitId per entry): `traits_generated` table (`database/src/db/schema/lootbox.ts:36`). Schema:
   ```sql
   traits_generated(id, player, level, entropy, count, traitIds, blockNumber, blockHash, transactionHash, logIndex)
   ```
   The `traitIds` is a JSONB array — one element per entry in the event. Events have `startIndex` + `count` semantics:
   - Each row represents a single `TraitsGenerated` event
   - `startIndex` is the entry-position within the player's level (NOT stored directly — need to query raw_events or add a column)
   - `count` is the array length; `traitIds[i]` is the trait for entry `startIndex + i`

   **Problem:** `startIndex` is NOT currently a column in the `traits_generated` schema. It's passed to `replayTraits()` to generate the array, but then the array itself is stored without its positional context.

   **Implementation options for INTEG-01:**
   - **Option A (simplest):** Add `startIndex` column to the `traits_generated` table. Requires a backfill migration (re-read raw events). One-shot, then stable.
   - **Option B (reconstruct at read time):** Join `traits_generated` rows for (player, level), sum their `count` fields to reconstruct entryIds. Since `startIndex` of row N = sum(count of rows 0..N-1), this works only if rows are guaranteed to insert in startIndex order (which requires ordering by `blockNumber, logIndex`).
   - **Option C (add an `entry_positions` table):** New schema joining `(traitsGeneratedId, entryId, traitId)`. Most flexible but highest backend lift.

   **Recommendation: Option B for initial implementation** (zero schema change, purely a query-level change). Option A is a follow-up if B proves too slow.

3. **Per-card source determination:**
   - `source: "purchase"` — derived from `TicketsQueued`/`TicketsQueuedScaled`/`TicketsQueuedRange` raw events where `buyer === player`. The buyer is who paid.
   - `source: "lootbox"` — derived from `lootbox_results` rows with `rewardType IN ('opened', 'burnieOpened')` where the player opened a lootbox. BUT: lootbox-derived tickets are ALSO `TicketsQueued*` events (the lootbox handler emits them). The distinction is "did the player OPEN a lootbox in this batch?" — tracked by cross-referencing `lootbox_results(player, blockNumber)` with `TicketsQueued(buyer=player, blockNumber)` in the same tx.
   - `source: "jackpot-win"` — derived from `jackpot_distributions` rows where `winner === player AND awardType IN ('tickets', 'tickets_baf')` AND the `TicketsQueued*` event fires as part of the same transaction. The jackpot distribution has `rebuyTickets INTEGER` field indicating ticket count awarded.

   **Simpler heuristic:** For each `TicketsQueued*` event, check if the transaction hash matches a `lootbox_results.rewardType='opened'` OR a `jackpot_distributions.awardType='tickets'` in the same block. Default: `purchase`.

### Response shape per INTEG-01-SPEC.md

Already specified (123 lines). Key observations:

- **`cards[]` is ordered by `cardIndex` ascending** (cardIndex = entryId / 4).
- **`status: "partial"`** — when the player has fewer than 4 entries in the trailing card. E.g., player has 10 entries at level 5: cards 0, 1 have 4 entries each (opened or pending); card 2 has 2 entries with `status: "partial"`.
- **`status: "pending"`** — all 4 entries exist but none have traits yet (VRF not resolved). Source: `player_tickets.ticketCount >= (cardIndex+1)*4` BUT no `traits_generated` row covers this range.
- **`status: "opened"`** — all 4 entries have traits (every `entryId` in the group has a `traitIds[...]` assignment).

### Proposed backend algorithm

```pseudocode
Input: address, level, day

1. Resolve end-of-day-N block (reuse /activity-score?day=N pattern)
2. SELECT ticketCount FROM player_tickets WHERE player=addr AND level=level AND blockNumber <= endBlock
   → totalEntries
3. SELECT traitIds, count, blockNumber, logIndex FROM traits_generated
   WHERE player=addr AND level=level AND blockNumber <= endBlock
   ORDER BY blockNumber, logIndex
   → traitAssignments[] (each row is one TraitsGenerated event)
4. Flatten traitAssignments into entryTraits[entryId] = traitId
   (startIndex of row N = sum of count of rows 0..N-1)
5. SELECT * FROM raw_events
   WHERE eventName IN ('TicketsQueued', 'TicketsQueuedScaled', 'TicketsQueuedRange')
     AND args.buyer=addr AND args.targetLevel=level
     AND blockNumber <= endBlock
   ORDER BY blockNumber, logIndex
   → purchases[] (ordered events; each reveals how many entries and WHICH entryIds were added)
6. For each purchase event, look up same-tx lootbox_results or jackpot_distributions to determine source
   → entrySource[entryId] = 'purchase' | 'lootbox' | 'jackpot-win'
7. Group entryIds into cards: cardIndex = entryId / 4
   For each card:
     - entries = [{ entryId, traitId: entryTraits[entryId] ?? null, traitLabel: ... }, ...]
     - status: 'opened' if all 4 traits known; 'pending' if none; 'partial' if < 4 entries
     - source: entrySource[entries[0].entryId] (all 4 typically share source; use card's first)
8. Return { address, level, day, totalEntries, cards }
```

### Gotchas flagged

- **Source determination for multi-ticket lootbox purchases:** A single lootbox can emit multiple `TicketsQueued*` events (for each level the lootbox affects). These all share `source: 'lootbox'` for the same lootbox-open event.
- **Trait-LCG replay is deterministic.** If `traits_generated` rows are missing for a known entryId (unlikely but possible), the endpoint can replay via `replayTraits()` at read-time. Recommend: do this for robustness. The `count * num_entries` is tiny (<1ms).
- **The `jackpot-win` source is rare.** Jackpot wins result in distinct `TicketsQueuedRange` events scoped to level+1, not same-level wins. Need to verify by checking actual DB contents; if jackpot-win tickets appear differently, the heuristic above needs adjustment.
- **`day_not_found` semantics** must mirror `/activity-score?day=N` (same 404 shape: `{statusCode: 404, error: "Not Found", message: "day_not_found", day: N}`).
- **Backward compatibility** — since this is a NEW endpoint (not an extension of `/player/:addr`), there's no backcompat concern. Beta and viewer continue using `/replay/player-traits/:addr` (which returns the deduplicated trait list, different shape).

### Planner hint — INTEG-01 side-quest structure (mirror Phase 51's INTEG-02 execution)

The INTEG-02 side-quest (`d135605`, `dab5adf`, `64fe8db` on `database/main`) shipped as 3 atomic commits in 5 minutes. INTEG-01 is comparable scope. Suggested execution:

- **Commit 1 (feat):** Handler implementation + schema definitions + response shape (`d135605` shape).
- **Commit 2 (docs):** Update database repo's `TODOS.md` or `CHANGES.md` with the new endpoint (matches `dab5adf` shape).
- **Commit 3 (test):** Vitest tests for happy path + 404 + empty cards + partial trailing card (matches `64fe8db` shape). Reference data from an existing fixture.

Phase 52 Wave 2 cannot merge until all three land on `database/main`.

### Known database-side TODOs expected (non-blocking for Phase 52 UI)

Per the INTEG-02 precedent, some fields may be stubbed to sensible defaults in the first commit with follow-up improvements flagged:

- `status: 'partial'` may be conflated with `'pending'` if the trailing-card count heuristic is simplified (fix: two distinct checks).
- `source` may default to `'purchase'` for everything in the first pass (fix: cross-reference lootbox_results + jackpot_distributions in the same transaction).
- `purchaseBlock` may be null initially (fix: join raw_events by tx hash).

UI accepts whatever ships; each of these renders a best-effort display.

## Validation Architecture (Nyquist)

`workflow.nyquist_validation` is not explicitly false in `.planning/config.json` — treat as enabled. (Per Phase 51 VALIDATION.md template.)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node built-in) + `node:assert/strict` |
| Config file | none — test discovery via `node --test` glob args |
| Quick run command | `node --test play/app/__tests__/play-tickets-panel.test.js play/app/__tests__/play-packs-panel.test.js play/app/__tests__/play-jackpot-wrapper.test.js play/app/__tests__/play-jackpot-shell01-regression.test.js` |
| Full suite command | `node --test play/app/__tests__/*.test.js` |
| Estimated runtime | ~3-5 seconds |

Tests are **contract-grep style** (source-file regex assertions). No JSDOM, no build, no runtime. Pattern verified by Phase 50-51 test files (112/112 green).

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TICKETS-01 | `<tickets-panel>` renders card grid from INTEG-01 response | contract-grep | `node --test play/app/__tests__/play-tickets-panel.test.js` | ❌ Wave 0 |
| TICKETS-02 | Cards use 2×2 CSS grid with 4 trait SVG imgs | contract-grep | same | ❌ Wave 0 |
| TICKETS-03 | Cards group by `cardIndex = entryId/4`; partial trailing card renders | contract-grep | same | ❌ Wave 0 |
| TICKETS-04 | Pending-status cards render pack placeholder, not empty | contract-grep | same | ❌ Wave 0 |
| PACKS-01 | `<packs-panel>` renders animated pack on purchase-source | contract-grep | `node --test play/app/__tests__/play-packs-panel.test.js` | ❌ Wave 0 |
| PACKS-02 | Jackpot-win-source packs render with gold-tint variant | contract-grep | same | ❌ Wave 0 |
| PACKS-03 | Pending packs have `pack-sealed` class + click handler | contract-grep | same | ❌ Wave 0 |
| PACKS-04 | Lootbox-source packs auto-trigger timeline on render | contract-grep | same | ❌ Wave 0 |
| PACKS-05 | GSAP timeline is imported; audio wrapper module exists | contract-grep | same | ❌ Wave 0 |
| JACKPOT-01 | `<jackpot-panel-wrapper>` imports `beta/components/jackpot-panel.js` | contract-grep | `node --test play/app/__tests__/play-jackpot-wrapper.test.js` | ❌ Wave 0 |
| JACKPOT-02 | Wrapper renders `<jackpot-panel>` inside its innerHTML | contract-grep | same | ❌ Wave 0 |
| JACKPOT-03 | Wrapper subscribes to `replay.day` AND `replay.level`, shims to `game.*` | contract-grep | same | ❌ Wave 0 |
| SHELL-01 (guardrail) | No new play/ files import forbidden paths | recursive grep (existing) | `node --test play/app/__tests__/play-shell-01.test.js` | ✅ exists; inherits coverage |
| SHELL-01 beta-regression | `beta/components/jackpot-panel.js` does NOT import `'../app/utils.js'` post-D-09 patch | contract-grep | `node --test play/app/__tests__/play-jackpot-shell01-regression.test.js` | ❌ Wave 0 |

### Proposed Wave 0 Test File Outlines

**`play/app/__tests__/play-tickets-panel.test.js`** (~30-40 assertions, mirroring play-profile-panel.test.js shape):

```javascript
// Existence + registration
test('tickets-panel.js exists', ...);
test('tickets-panel.js registers <tickets-panel>', ...);
test('tickets-panel.js defines class extending HTMLElement', ...);
test('tickets-panel.js has connectedCallback + disconnectedCallback', ...);
test('tickets-panel.js subscribes to replay.day, replay.player, replay.level', ...);
test('tickets-panel.js imports subscribe from reused beta store', ...);

// TICKETS-01..04
test('TICKETS-01: renders card-grid container', () => { assert.match(src, /data-bind=["']card-grid["']/); });
test('TICKETS-02: cards use 2x2 quadrant grid', () => { assert.match(src, /class=["']ticket-card["']/); assert.match(src, /class=["']trait-quadrant["']/); });
test('TICKETS-03: groups entries by cardIndex (entryId/4)', () => { assert.match(src, /cardIndex|entryId/); });  // accepts either term
test('TICKETS-04: pending state rendered as pack placeholder', () => { assert.match(src, /pack-sealed|status\s*===\s*['"]pending['"]/); });

// Fetch wiring
test('fetches /player/${addr}/tickets/by-trait?level=${level}&day=${day}', () => {
  assert.match(src, /\/player\/\$\{[^}]+\}\/tickets\/by-trait\?level=/);
});
test('uses #ticketsFetchId stale-guard counter', () => { assert.match(src, /#ticketsFetchId/); });
test('toggles is-stale class for keep-old-data-dim', () => { assert.match(src, /is-stale/); });

// Shared fetch helper
test('imports from play/app/tickets-fetch.js', () => {
  assert.match(src, /from\s+['"]\.\.\/app\/tickets-fetch\.js['"]/);
});

// play/app/tickets-inventory.js helper (NEW)
test('play/app/tickets-inventory.js exists and exports traitToBadge', ...);
test('play/app/tickets-inventory.js is wallet-free (no beta/app/utils.js import)', ...);
test('play/app/tickets-inventory.js includes CARD_IDX reshuffle', () => {
  assert.match(src, /CARD_IDX\s*=\s*\[\s*3\s*,\s*4\s*,\s*5\s*,\s*6\s*,\s*0\s*,\s*2\s*,\s*1\s*,\s*7/);
});
```

**`play/app/__tests__/play-packs-panel.test.js`** (~30-40 assertions):

```javascript
test('packs-panel.js exists', ...);
test('packs-panel.js registers <packs-panel>', ...);
test('packs-panel.js imports from gsap', () => { assert.match(src, /from\s+['"]gsap['"]/); });

// PACKS-01..04
test('PACKS-01: renders pack per card with purchase source tint', () => {
  assert.match(src, /source\s*===\s*['"]purchase['"]|source=["']purchase["']/);
});
test('PACKS-02: jackpot-win packs get gold-tint class', () => { assert.match(src, /jackpot-win|gold-tint/); });
test('PACKS-03: click handler on pack element', () => { assert.match(src, /addEventListener\(\s*['"]click['"]/); });
test('PACKS-04: lootbox source triggers animation on first render', () => {
  assert.match(src, /source\s*===\s*['"]lootbox['"]|autoOpen|auto-animate/);
});

// PACKS-05
test('PACKS-05: imports pack-audio module', () => {
  assert.match(src, /from\s+['"][^'"]*\/pack-audio\.js['"]/);
});
test('PACKS-05: imports pack-animator module', () => {
  assert.match(src, /from\s+['"][^'"]*\/pack-animator\.js['"]/);
});

// Mute toggle
test('renders speaker-icon mute toggle', () => { assert.match(src, /data-bind=["']mute-toggle["']/); });
test('mute toggle reads localStorage', () => {
  assert.match(src, /localStorage|isMuted/);
});

// Pack assets
test('play/assets/audio/pack-open.mp3 referenced', () => {
  assert.match(src, /pack-open\.mp3|\/play\/assets\/audio/);
});

// prefers-reduced-motion
test('pack-animator handles prefers-reduced-motion', () => {
  // Check the helper module
  const animatorSrc = readFileSync(PACK_ANIMATOR, 'utf8');
  assert.match(animatorSrc, /prefers-reduced-motion/);
});
```

**`play/app/__tests__/play-jackpot-wrapper.test.js`** (~15-20 assertions):

```javascript
test('jackpot-panel-wrapper.js exists', ...);
test('jackpot-panel-wrapper.js registers <jackpot-panel-wrapper>', ...);
test('imports beta/components/jackpot-panel.js', () => {
  assert.match(src, /from\s+['"][^'"]*\/beta\/components\/jackpot-panel\.js['"]/);
});
test('wraps <jackpot-panel> inside innerHTML template', () => {
  assert.match(src, /<jackpot-panel>|jackpot-panel>/);
});

// JACKPOT-03
test('subscribes to replay.day and replay.level', ...);
test('shims replay.level into game.level via update()', () => {
  assert.match(src, /update\(\s*['"]game\.level['"]/);
});

// CSS link
test('play/index.html links beta/styles/jackpot.css', () => {
  const html = readFileSync(PLAY_INDEX, 'utf8');
  assert.match(html, /beta\/styles\/jackpot\.css/);
});
```

**`play/app/__tests__/play-jackpot-shell01-regression.test.js`** (~3 assertions):

```javascript
test('SHELL-01 regression: beta/jackpot-panel.js does NOT import beta/app/utils.js (post-D-09 patch)', () => {
  const src = readFileSync(BETA_JACKPOT, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\.\.\/app\/utils\.js['"]/);
});

test('SHELL-01 regression: beta/jackpot-panel.js imports from beta/viewer/utils.js', () => {
  const src = readFileSync(BETA_JACKPOT, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\.\.\/viewer\/utils\.js['"]/);
});

test('beta/jackpot-panel.js imports at lines 5-9 (smoke check on import count)', () => {
  const src = readFileSync(BETA_JACKPOT, 'utf8');
  const lines = src.split('\n').filter(l => /^import\s/.test(l));
  assert.ok(lines.length >= 5 && lines.length <= 7, `expected 5-7 imports, found ${lines.length}`);
});
```

### Sampling Rate

- **Per task commit:** `node --test play/app/__tests__/play-{tickets,packs,jackpot-wrapper,jackpot-shell01-regression}-panel.test.js` (sub-5-second)
- **Per wave merge:** Full suite (`node --test play/app/__tests__/*.test.js`)
- **Phase gate:** Full suite + `play-shell-01.test.js` green + INTEG-01 endpoint live + optional UAT

### Wave 0 Gaps

- [ ] `play/app/__tests__/play-tickets-panel.test.js` — covers TICKETS-01..04 + helper assertions
- [ ] `play/app/__tests__/play-packs-panel.test.js` — covers PACKS-01..05 + audio + reduced-motion
- [ ] `play/app/__tests__/play-jackpot-wrapper.test.js` — covers JACKPOT-01..03 + CSS link
- [ ] `play/app/__tests__/play-jackpot-shell01-regression.test.js` — guards D-09 patch against beta-side regression
- [ ] 1-line patch: `beta/components/jackpot-panel.js:7` swap `'../app/utils.js'` → `'../viewer/utils.js'`
- [ ] `.planning/phases/52-tickets-packs-jackpot/INTEG-01-SPEC.md` — copy-forward or symlink from Phase 50 directory (Q2 resolution: copy-forward; precedent from Phase 51 which authored INTEG-02-SPEC in-phase)

*(Existing `play-shell-01.test.js` provides recursive SHELL-01 coverage for the new play/ files — no new wallet-free guard test needed for new play/ modules.)*

### Manual-Only Verifications (Wave 3, UAT-deferrable)

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Gacha reveal feel — pack shakes, flashes, pops open, traits bounce in | PACKS-05 / D-07 | Visual timing + feel; not assertable by grep | Load /play/, select a player with purchase-source tickets, click a sealed pack. Verify total animation ~400ms; shake visible; flash visible; traits arrive with staggered bounce; reduced-motion preference instant-swaps. |
| Sound plays on first click (autoplay unlock) | PACKS-05 / D-10 | Browser autoplay policy varies by user-gesture | Reload /play/, mute system audio off. Click first pack. Sound fires on this click. Click second pack — sound fires. Toggle speaker icon to mute. Click third pack — silent. Toggle back — sound fires on next click. Refresh page — mute state persisted. |
| Jackpot widget renders Roll 1 + Roll 2 on a known winning day | JACKPOT-01 / JACKPOT-02 | Requires live backend with known winning day | Select a player known to have won on a specific day. Scrub to that day. Click Replay in the jackpot panel. Watch Roll 1 populate; click Bonus Roll. Watch Roll 2 slot grid populate. All trait SVGs render correctly (check `cards` quadrant specifically — CARD_IDX sensitive). |
| Trait SVG correctness for high-rarity traits | TICKETS-02 | Visual fidelity; filesystem/contract index alignment | Select a player with a wide variety of traits (all 4 quadrants). Verify every SVG renders (no broken img tags). Pay special attention to `cards` quadrant: club/diamond/heart/spade (symbolIdx 0-3) must show the correct file (fileIdx 3-6) via CARD_IDX reshuffle. |
| Day-scrub during pack animation — animation completes, list re-renders | PACKS-05 / D-08 | Timing edge case | Click a pack to start animation. Within 400ms, scrub day to a different day. Animation on the now-stale card must complete visually with no console error. New day's card list appears. |
| Empty states — player with 0 tickets at selected level | TICKETS-01..04 | UX polish | Select a player+level with 0 tickets. `<tickets-panel>` shows "No tickets" empty state. `<packs-panel>` shows "No packs to open" or similar. |
| 404 on INTEG-01 (day not indexed) | TICKETS-01..04 | Error path | Scrub to an un-indexed day (if possible). Panels should gracefully degrade (dim overlay + error message); no uncaught rejection. |
| Rapid day-scrub stability | TICKETS-01..04 / PACKS-01..04 | Visual polish | Scrub rapidly across 10+ days. Latest data always wins (no stale renders). Dim overlay is smooth; no layout thrash. |
| High-ticket player (100+ entries = 25+ cards) scrolls OK | TICKETS-01 | Performance | Select a high-ticket player. 25+ cards render; page scrolls smoothly; no jank loading 100+ SVGs. |

### UAT deferral

Following Phase 50 and Phase 51 precedent (both deferred Wave 3 UAT — 51-UAT.md records the rationale), Phase 52 Wave 3 is likely deferrable. The planner should structure Wave 3 as optional; automated verification + Wave 2 acceptance-criteria grep is sufficient to close the phase.

## Pitfalls and Landmines (Answer to Q11)

### Pitfall 1: CARD_IDX reshuffle silently corrupts `cards` quadrant
**What goes wrong:** Developer copies `ITEMS` or `QUADRANTS` but omits `CARD_IDX`, or uses `symbolIdx` directly as `fileIdx`. The UI renders `cards_00_horseshoe_*` for the `club` symbol and wrong images appear in the inventory.
**How to avoid:** Single source of truth in `play/app/tickets-inventory.js`. Test asserts `CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7]`. Document the "don't linearize" comment from `jackpot-rolls.js:25`.
**Warning signs:** `cards` quadrant renders wrong SVGs. Other quadrants OK.

### Pitfall 2: `state.replay.level` never populated — tickets-panel and jackpot-wrapper stay stuck
**What goes wrong:** Phase 50 declared `replay.level` but doesn't write it. Without a level, INTEG-01 can't be called and the jackpot wrapper has no level context.
**How to avoid:** Wave 1 adds level population logic. Either (a) fetch `/game/jackpot/day/{day}/winners` on day change and write `response.level` to store, or (b) derive via `Math.ceil(day/5)` as a stopgap. Recommend (a) — robust to compressed/normal mode differences.
**Warning signs:** Both panels stuck at "loading" or emit "level is null" console errors. Check `get('replay.level')` in devtools.

### Pitfall 3: GSAP timeline held forever on stale card — memory leak
**What goes wrong:** Pack animation starts at day N=50; user scrubs to N=51; card grid re-renders; the animating card is removed but the GSAP tween storage holds its reference until the timeline completes. On rapid scrub across 100 days, this accumulates 100 detached-but-still-tweening nodes.
**How to avoid:** Track active timelines in a `Set`; on `disconnectedCallback`, kill all. Individual card removals are fine (GC releases once timeline completes) but whole-panel teardowns require explicit cleanup. GSAP 3.14's `timeline.kill()` is idempotent.
**Warning signs:** Devtools Performance tab shows retained DOM after day-scrub. Chrome's "Detached elements" count grows.

### Pitfall 4: Browser autoplay policy blocks first sound playback
**What goes wrong:** `AudioContext` starts in `suspended` state. First `playPackOpen()` is silent. Console warns "AudioContext was not allowed to start. It must be resumed after a user gesture."
**How to avoid:** The pack-open is itself a user-click — AudioContext can be resumed there. Wrap `playPackOpen()` in `if (ctx.state === 'suspended') await ctx.resume();` before the first `createBufferSource`. Lootbox auto-open (D-06) fires on component render, NOT on user gesture — its sound will be blocked until the user interacts. Accept silent first auto-opens on lootbox source, OR add a "click anywhere to enable audio" overlay on first load (too invasive; accept the tradeoff).
**Warning signs:** First pack-open is silent; all subsequent are fine.

### Pitfall 5: Multiple panels' rapid-scrub fires N INTEG-01 fetches
**What goes wrong:** `<tickets-panel>` and `<packs-panel>` both subscribe to `replay.{day,player,level}`. Each scrubs → each calls `#refetch()` → each hits `/player/:addr/tickets/by-trait` once. 2× network traffic per day-change, unrelated to the stale-guard (stale-guard prevents render races, not wire requests).
**How to avoid:** `play/app/tickets-fetch.js` shared helper with in-flight promise dedup (Section 7 Approach 3). Both panels call `fetchTicketsByTrait(addr, level, day)`; first call fires HTTP request; second returns the in-flight promise. Cache-by-key prevents refetch within same key.
**Warning signs:** DevTools Network tab shows 2× requests per scrub.

### Pitfall 6: INTEG-01 SHELL-01 regression when beta introduces a new wallet-tainted import
**What goes wrong:** Future beta work adds a new `import { ... } from '../app/utils.js'` line to jackpot-panel.js — silently re-taints play/ via the direct import.
**How to avoid:** `play-jackpot-shell01-regression.test.js` (Wave 0) explicitly asserts the negative pattern. Runs in CI; blocks any PR that re-taints.
**Warning signs:** `play/` CI fails with a message pointing at `beta/components/jackpot-panel.js`.

### Pitfall 7: `<jackpot-panel-wrapper>` tag-rename breaks Phase 50 test expectations
**What goes wrong:** Phase 50's `play-panel-stubs.test.js:30` expects `jackpot-panel.js` to exist in `play/components/`. Phase 52 removes that file (wrapper replaces it) → test fails.
**How to avoid:** Wave 0 updates `play-panel-stubs.test.js` to replace the `jackpot-panel` entry with `jackpot-panel-wrapper`. Wave 1 deletes `play/components/jackpot-panel.js`.
**Warning signs:** Phase 50 tests fail in a regression suite.

### Pitfall 8: Beta's `jackpot-panel.js` relies on `game.phase` and `game.jackpotDay` — shim mismatch
**What goes wrong:** The wrapper only shims `game.level`, but `#onGameUpdate` also reads `game.phase` and `game.jackpotDay`. Panel may set the "Day --" header incorrectly.
**How to avoid:** Shim all three fields in the wrapper. Derive `game.phase` from current contract state (via `/game/state` fetch) or default to `'PURCHASE'`. `game.jackpotDay` is a within-level counter (1-5); can derive as `(replayDay - 1) % 5 + 1`.
**Warning signs:** Jackpot panel header shows "Day --" instead of "Day 3/5" or similar.

### Pitfall 9: Shared fetch cache grows unbounded
**What goes wrong:** `tickets-fetch.js` cache stores `lastResult` per key but never evicts. Over a long session, memory grows.
**How to avoid:** Keep ONE slot (`lastResult` / `lastResultKey`) — not a full cache. Latest value only. Stale results are replaced; no accumulation.
**Warning signs:** N/A if single-slot pattern is followed.

### Pitfall 10: Large player (100+ tickets) loads 400+ SVG files simultaneously
**What goes wrong:** Each ticket card has 4 SVG `<img>` elements. 100 cards = 400 img src requests. At 4KB per SVG, that's ~1.5MB of SVG — not catastrophic, but stalls the server briefly.
**How to avoid:** (a) Accept it for v2.4 — players with 100+ tickets at a single level are rare in practice; (b) sprite-sheet the SVGs into a single file using `<use>` + `xlink:href` — major refactor, defer; (c) lazy-load SVGs with `loading="lazy"` on img — browser handles viewport-based loading automatically.
**Warning signs:** Slow first-render on high-ticket players; network waterfall in DevTools.
**Recommendation:** Add `loading="lazy"` on the `<img>` tag — one-line change, browser handles the rest.

### Pitfall 11: Pack-open sound plays across re-renders (lootbox auto-open loop)
**What goes wrong:** Lootbox-sourced packs auto-open on render (D-06). On day-scrub re-fetch, the same card re-renders (same `entryId`), and `connectedCallback`-like logic re-triggers auto-open → sound fires every scrub.
**How to avoid:** Track animated cards in a `WeakSet` (or Map keyed by `entryId`). Only auto-animate once per entryId per session. On re-fetch, already-animated cards render in their final opened state without replaying.
**Warning signs:** Multiple sound triggers during rapid day-scrub.

### Pitfall 12: Phase 50's `<jackpot-panel>` skeleton stub conflicts with beta's `<jackpot-panel>`
**What goes wrong:** Phase 50's stub at `play/components/jackpot-panel.js` registers `customElements.define('jackpot-panel', ...)`. Beta's `beta/components/jackpot-panel.js` does the same. Importing the beta file after play's stub throws DOMException: 'jackpot-panel' has already been defined.
**How to avoid:** Phase 52 Wave 1 DELETES `play/components/jackpot-panel.js` entirely. The beta file is imported via `<jackpot-panel-wrapper>` (new file). Only one `customElements.define('jackpot-panel', ...)` call happens — beta's.
**Warning signs:** Console throws on `<jackpot-panel>` tag; panel is blank.

### Pitfall 13: `beta/styles/jackpot.css` not linked from `play/index.html` — widget unstyled
**What goes wrong:** Beta's `<jackpot-panel>` uses ~60 class names defined in `beta/styles/jackpot.css` (1050+ lines). `play/index.html` links only `base.css`, `panels.css`, `buttons.css`, `skeleton.css`, `viewer.css`, `play.css` — no `jackpot.css`. Panel renders but layout is broken.
**How to avoid:** Wave 1 edits `play/index.html` to add `<link rel="stylesheet" href="/beta/styles/jackpot.css">`. Add a test assertion (covered in play-jackpot-wrapper.test.js Wave 0).
**Warning signs:** Jackpot panel renders but looks like plain text (no grid, no spacing).

### Pitfall 14: Default volume 0.4 too loud on user's system
**What goes wrong:** User's system volume is already at 100%, D-10's 0.4 GainNode makes pack-open louder than whitepaper/game theory page audio or other site audio.
**How to avoid:** 0.4 is the stated default (D-10). Deferred idea: volume slider. Manual UAT adjusts during Wave 3. For now, 0.4 is the locked choice.

### Pitfall 15: `traits_generated.traitIds` JSONB array lookup is O(n) per card
**What goes wrong:** INTEG-01 backend scans `traits_generated` for each card lookup → O(cards × events). Slow for high-ticket players.
**How to avoid:** Backend fetches all relevant `traits_generated` rows ONCE, flattens into `entryTraits[entryId]` map; then groups. O(cards + events). Covered in Section 10 Proposed backend algorithm step 4.
**Warning signs:** API latency > 1s for 100-ticket players.

### Pitfall 16: D-09 patch applied but formatEth behavior differs in edge cases
**What goes wrong:** The 1-line swap assumes `formatEth` in `beta/viewer/utils.js` behaves identically to `beta/app/utils.js`. Subtle BigInt-string vs ethers.BigNumber-instance input might differ.
**How to avoid:** Verify the 10 call sites in jackpot-panel.js all pass string inputs (confirmed via Section 4 audit — all pass `.toString()` or `BigInt(...).toString()`). After patching, run the existing beta tests to confirm no behavior change.
**Warning signs:** Beta UAT shows different ETH display values before/after patch.

## Open Questions (Post-Research)

Most CONTEXT.md Open Questions are now RESOLVED (answered in Sections 4, 5, 6 above). Remaining open questions for the planner:

### Q1: Which pack SVG design ships with Wave 1?
CONTEXT.md D-03 defers between "CSS-only pack" and "single pack SVG (`/play/assets/pack.svg`)". No sample exists.
**Recommendation for planner:** CSS-only for Wave 1 (no asset dependency). Thin gradient rectangle with CSS border; pulsing box-shadow on `.pack-sealed`. Upgrade to hand-crafted SVG in a follow-up phase if visual polish demands. Keeps Phase 52 self-contained.

### Q2: `<packs-panel>` vs `<tickets-panel>` layout in `play-grid`?
Side-by-side? Stacked (packs above tickets)? CSS-only decision.
**Recommendation for planner:** Stacked vertically in the page grid, packs first. Matches gacha-first mental model (user opens packs → cards go into inventory below). `play-grid` CSS doesn't need a change; element order in `play/index.html` controls it.

### Q3: Should the shared `fetchTicketsByTrait()` helper write into the store?
If YES: a new `state.replay.tickets` slot exposes the cached result to any panel; cleaner but adds store contract.
If NO: helper-local cache; simpler but tied to helper call-site.
**Recommendation for planner:** NO for Wave 1 — helper-local is simpler. Revisit if a third panel needs the same data.

### Q4: INTEG-01 endpoint delivery timeline — how many commits?
INTEG-02 shipped in 3 commits (feat/docs/test) in 5 min. INTEG-01 is comparable scope.
**Recommendation for planner:** Structure the Wave 2 side-quest checkpoint to expect 3 commits on `database/main`. Use the `endpoint-shipped` signal pattern from Phase 51 Plan 03.

### Q5: Do we need the `source: "partial"` visual (partial pack with peeked quadrants)?
D-03 describes this but it's the most complex visual. For Wave 1, render partial as "pending" placeholder.
**Recommendation for planner:** Implement `partial` as a distinct visual in Wave 2, not Wave 1. Wave 1's `<packs-panel>` treats partial-status same as pending (`.pack-sealed` class). Wave 2 adds the peeked-quadrant CSS once real data is flowing.

### Q6: What happens if `replay.level` lags `replay.day` (TOCTOU race)?
Scenario: scrubber moves to day 45; INTEG-01 fires immediately with stale level = 8. Server returns inconsistent data.
**Recommendation for planner:** `#refetch()` must read BOTH `replay.day` AND `replay.level` fresh via `get()` at the top. If they're transiently inconsistent, stale-guard catches it (second fetch with consistent values wins). Not a blocker.

### Q7: INTEG-01 "implementation note" size — is this worth calling it out as a separate sub-plan?
The database-side work has real thinking attached (trait-group reconstruction, source determination, startIndex resolution). 3-4 hours to implement cleanly.
**Recommendation for planner:** Track the INTEG-01 side-quest as its own checkpoint in Wave 2, same as Phase 51 Plan 03's Task 1 `endpoint-shipped` checkpoint. No separate plan file; the side-quest is a checkpoint inside the Wave 2 plan.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Wallet-coupled ticket/jackpot panels (beta) | Wallet-free panels with shared SHELL-01 guardrail | Phase 52 | Re-implement helpers locally (tickets-inventory.js); no contract reads from browser |
| Copy-and-maintain-two-files for beta jackpot widget | D-09: direct import with 1-line beta patch | Phase 52 | Single source; future beta jackpot fixes propagate to play automatically |
| Each panel fetches INTEG-01 independently | Shared `fetchTicketsByTrait()` helper with in-flight dedup | Phase 52 | Halves network traffic on day-scrub; cleaner code |
| HTML5 `<audio>` element (beta/app/audio.js pattern) | AudioContext + decodeAudioData + AudioBufferSource + GainNode | Phase 52 / D-10 | Better playback control, gain knob, fail-silent path; matches modern browser best practice |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7]` is the only reshuffle; other quadrants map 1:1 | Section 5 [VERIFIED] | None — three independent places in beta confirm this |
| A2 | `beta/viewer/utils.js` `formatEth` is behaviorally identical to `beta/app/utils.js` `formatEth` for all wei-string inputs | Section 4 [VERIFIED by reading both implementations] | If wrong, Beta UAT after D-09 patch would show different ETH display. Low risk — both use the same precision tiers with the same inputs. |
| A3 | INTEG-01 will ship with 3 atomic commits like INTEG-02 did | Section 10 [CITED: Phase 51 precedent] | If database team takes longer, Wave 2 blocks until delivery. Same solo-dev timeline as Phase 51; risk is low. |
| A4 | `startIndex` can be reconstructed from `traits_generated` rows ordered by (blockNumber, logIndex) — sum of prior counts | Section 10 [ASSUMED based on event-ordering invariant] | If event ordering is not monotonic per (player, level), reconstruction fails. Backend must either add startIndex column or verify the order invariant. |
| A5 | Lootbox-source detection via same-transaction cross-reference is robust | Section 10 [ASSUMED] | If contracts emit `TicketsQueued*` events in a different block than the lootbox open, the cross-reference misses. Verify against live data before locking. |
| A6 | GSAP 3.14's timeline does not hold strong references to removed DOM after timeline completion | Section 9 [CITED: GSAP 3.14 docs] | If wrong, memory leaks on rapid day-scrub. Mitigated by explicit `timeline.kill()` on panel `disconnectedCallback`. |
| A7 | `play-shell-01.test.js` recursive scan will catch any new wallet-tainted file in play/ (inherited coverage) | Section 4 [VERIFIED: reads `play-shell-01.test.js` + confirms recursive walk] | None |
| A8 | `/badges-circular/*.svg` is served at the website root across dev + prod; no path rewriting needed for play/ | Section 5 [VERIFIED: ls directory + grep 3 index.html files] | None |
| A9 | Phase 50's `<jackpot-panel>` stub can be cleanly deleted without cascading failures | Section 7 [ASSUMED — Phase 50 test dependency exists] | `play-panel-stubs.test.js:30` needs update (already planned in Pitfall 7). |
| A10 | Beta's `jackpot-panel.js` will continue to work after D-09 patch (no behavior change from formatEth swap) | Section 4 [VERIFIED by cross-checking all 10 call sites] | None — both formatters produce identical output for wei strings. |
| A11 | The Web Audio API is available in all Phase 52 target browsers (Chrome, Firefox, Safari, mobile variants) | Section 9 [ASSUMED — Web Audio is universal on 2021+ browsers] | Old iOS Safari and some embedded browsers don't have it. D-10's fail-silent path handles this: `new AudioContext()` throws → loadError set → `playPackOpen()` no-ops. |
| A12 | localStorage is available for the mute-toggle persistence | Section 9 [ASSUMED] | Some privacy-mode browsers block localStorage. Catch-block in `isMuted()`/`setMuted()` falls back to in-memory state for the session. |

## Environment Availability

| Dependency | Required By | Available | Notes | Fallback |
|------------|------------|-----------|-------|----------|
| Node.js `node:test` | test suite | ✓ | Phase 50-51 precedent | — |
| Python `http.server` (dev static server) | manual UAT | ✓ | Serves `/badges-circular/*.svg` | — |
| Fastify API at localhost:3000 | runtime | ✓ | Shipped from database repo | — |
| GSAP 3.14 via importmap | pack animations | ✓ | `play/index.html:17` | Fallback to CSS-only animations if GSAP CDN 404s — degraded but functional |
| Web Audio API | pack-open sound | ✓ (universal) | AudioContext constructor available in all modern browsers | Fail-silent per D-10 — single console.warn, no visual error |
| `localStorage` | mute-toggle persistence | ✓ (standard) | — | In-memory session-scoped fallback when localStorage unavailable |
| `/badges-circular/*.svg` static assets | card quadrant rendering | ✓ (256 files) | Served at website root | — |
| `/replay/rng` (Phase 50 bootstrap) | — | ✓ | — | — |
| `/replay/players` (Phase 50 bootstrap) | — | ✓ | — | — |
| `/game/jackpot/:level/*` endpoints (beta) | jackpot widget | ✓ | Used by beta today | — |
| `/game/jackpot/day/:day/winners` | level derivation | ✓ | — | — |
| **INTEG-01** `/player/:addr/tickets/by-trait?level=N&day=M` | Phase 52 Wave 2 | ✗ | **HARD GATE** — database repo must ship | No fallback. UI Wave 2 does not merge until endpoint is live. Solo-dev self-coordinates per Phase 50/51 precedent. |
| `play/assets/audio/pack-open.mp3` | PACKS-05 | ✗ | **Wave 1 deliverable** — user provides or developer generates a 300ms click/pop cue | D-10 fail-silent path: if 404, console.warn once, no visual error |

**Missing dependencies with no fallback:**
- INTEG-01 endpoint — the single hard gate on this phase.

**Missing dependencies with fallback:**
- `pack-open.mp3` — Wave 1 ships the file OR accepts fail-silent. Recommend: add the file in Wave 1 (free asset from freesound.org or similar; 30-second research lookup).

## Risks / Open Questions / Blockers

### Blockers

- **INTEG-01 delivery (hard gate, D-09 + Wave 2 spec).** UI hydration waves cannot merge until database repo ships the endpoint. Same solo-dev pattern as Phase 50 INTEG-01 and Phase 51 INTEG-02. Risk is LOW — two prior side-quests shipped in 3-5 minutes each.
- **Beta upstream patch at Wave 0 is non-negotiable for D-09.** If the patch breaks existing beta tests, the planner must fall back to copy-and-scrub (increases Wave 1 LOC by ~1075 and adds ongoing divergence risk). Mitigation: Section 4 proves the patch is safe (all 10 call sites pass wei-strings; both formatters behave identically on wei-string input).

### Risks

- **Pack SVG design (Q1 above).** CSS-only for Wave 1 is recommended; if UAT finds it feels cheap, Wave 3 or a follow-up polish phase upgrades to a hand-crafted SVG. Non-blocking.
- **High-ticket player perf (Pitfall 10).** 100+ tickets = 400+ SVG img requests. Mitigated by `loading="lazy"`. If real-world bottleneck emerges, defer sprite-sheet to a performance phase.
- **Source-determination heuristic complexity (A5).** The lootbox/jackpot-win cross-reference may produce false-positives/negatives. Non-blocking — panel displays whichever source comes back.
- **`state.replay.level` population lag (Pitfall 2).** Mitigation: populate in Wave 1 alongside the day-scrubber wiring.
- **GSAP import via esm.sh CDN.** If CDN goes down, pack animations fail. Degrade to CSS-only animation fallback (covered by `prefers-reduced-motion` code path; could extend to CDN-failure detection with `dynamic import` + catch).

### Non-Risks (Rejected Concerns)

- **SHELL-01 regression.** Covered by existing `play-shell-01.test.js` (inherits coverage for new play/ files) + new `play-jackpot-shell01-regression.test.js` (guards beta file).
- **Store contract drift.** `state.replay.{day, level, player}` is unchanged. `game.level`/`game.jackpotDay` shim is ADDITIVE — doesn't break beta.
- **Tag-name collision between Phase 50 `<jackpot-panel>` stub and beta's `<jackpot-panel>`.** Mitigation: Phase 52 renames play/'s to `<jackpot-panel-wrapper>` and deletes the stub.
- **INTEG-01 spec mismatch with what frontend expects.** Spec authored in Phase 50 (123 lines) and reviewed before research; no material gaps found.

## Sources

### Primary (HIGH confidence)

- `/home/zak/Dev/PurgeGame/website/beta/components/jackpot-panel.js:1-1075` — full file read + 10 formatEth call sites audited
- `/home/zak/Dev/PurgeGame/website/beta/app/jackpot-rolls.js:1-954` — factory, CARD_IDX, joBadgePath, rebucket logic
- `/home/zak/Dev/PurgeGame/website/beta/viewer/badge-inventory.js:1-97` — `traitToBadge()` decomposer
- `/home/zak/Dev/PurgeGame/website/beta/viewer/utils.js:1-39` — wallet-free `formatEth`, `formatBurnie`, `truncateAddress`, `formatWei`
- `/home/zak/Dev/PurgeGame/website/beta/app/store.js:1-95` — Proxy store with `replay.{day, level, player}` namespace
- `/home/zak/Dev/PurgeGame/website/beta/app/constants.js:1-70` — BADGE_*, `badgePath()`, `badgeCircularPath()`, `CARD_IDX` (line 53)
- `/home/zak/Dev/PurgeGame/website/beta/app/api.js:1-14` — `fetchJSON` (wallet-free path)
- `/home/zak/Dev/PurgeGame/website/beta/viewer/scrubber.js:1-30` — scrubber factory (transitive import target via jackpot-panel)
- `/home/zak/Dev/PurgeGame/website/beta/viewer/api.js:1-12` — `fetchJSON` (only imports constants; SHELL-01 safe)
- `/home/zak/Dev/PurgeGame/website/beta/app/audio.js:1-37` — HTML5 `<audio>` element pattern (reference, not template)
- `/home/zak/Dev/PurgeGame/website/beta/components/replay-panel.js:1900-1998` — Web Audio SFX via oscillator (reference for AudioContext patterns)
- `/home/zak/Dev/PurgeGame/website/beta/components/degenerette-panel.js:310-361` — GSAP timeline example
- `/home/zak/Dev/PurgeGame/website/play/components/profile-panel.js:1-418` — gold-standard Phase 51 hydrated Custom Element
- `/home/zak/Dev/PurgeGame/website/play/app/quests.js:1-99` — wallet-free helper pattern (mold for `play/app/tickets-inventory.js`)
- `/home/zak/Dev/PurgeGame/website/play/components/tickets-panel.js` — Phase 50 stub (45 lines; to be replaced)
- `/home/zak/Dev/PurgeGame/website/play/components/jackpot-panel.js` — Phase 50 stub (42 lines; to be DELETED per Pitfall 7/12)
- `/home/zak/Dev/PurgeGame/website/play/index.html:1-80` — importmap + CSS links + panel grid
- `/home/zak/Dev/PurgeGame/website/play/app/main.js:1-119` — bootstrap pattern
- `/home/zak/Dev/PurgeGame/website/play/app/__tests__/play-shell-01.test.js:1-107` — recursive SHELL-01 guardrail
- `/home/zak/Dev/PurgeGame/website/play/app/__tests__/play-panel-stubs.test.js:1-129` — panel-stub contract-grep template
- `/home/zak/Dev/PurgeGame/website/play/app/__tests__/play-profile-panel.test.js:1-184` — test-file structure template
- `/home/zak/Dev/PurgeGame/website/badges-circular/` — 256 SVG files verified by ls
- `/home/zak/Dev/PurgeGame/database/src/db/schema/tickets.ts:1-18` — playerTickets upsert schema
- `/home/zak/Dev/PurgeGame/database/src/db/schema/lootbox.ts:1-51` — lootboxPurchases + lootboxResults + traitsGenerated schemas
- `/home/zak/Dev/PurgeGame/database/src/db/schema/jackpot-history.ts:1-38` — jackpotDistributions schema (awardType enum)
- `/home/zak/Dev/PurgeGame/database/src/handlers/lootbox.ts:128-149` — `handleTraitsGenerated` writes JSONB array
- `/home/zak/Dev/PurgeGame/database/src/handlers/tickets.ts:1-89` — `TicketsQueued*` upsert handlers
- `/home/zak/Dev/PurgeGame/database/src/handlers/jackpot.ts:35-109` — awardType routing (`tickets`, `tickets_baf` variants)
- `/home/zak/Dev/PurgeGame/database/src/indexer/trait-derivation.ts:1-72` — startIndex/count semantics
- `/home/zak/Dev/PurgeGame/database/src/api/routes/player.ts:1-95` — existing `/player/:address/activity-score?day=N` handler (day-resolution pattern to reuse)
- `/home/zak/Dev/PurgeGame/database/src/api/routes/replay.ts:400-430` — existing `/replay/player-traits/:address` (deduplicated; not usable for card grouping)
- `/home/zak/Dev/PurgeGame/website/.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md:1-123` — endpoint contract (already authored)
- `/home/zak/Dev/PurgeGame/website/.planning/phases/51-profile-quests/51-RESEARCH.md:1-989` — Phase 51 precedent (structure, validation-architecture pattern, side-quest delivery)
- `/home/zak/Dev/PurgeGame/website/.planning/phases/51-profile-quests/51-PATTERNS.md:1-543` — pattern-mapping style
- `/home/zak/Dev/PurgeGame/website/.planning/phases/51-profile-quests/51-VALIDATION.md:1-80` — validation-md template
- `/home/zak/Dev/PurgeGame/website/.planning/phases/51-profile-quests/51-03-SUMMARY.md:1-205` — Wave 2 hydration summary (references patterns to clone)
- `/home/zak/Dev/PurgeGame/website/.planning/phases/51-profile-quests/INTEG-02-SPEC.md:1-217` — side-quest spec template
- `/home/zak/Dev/PurgeGame/website/.planning/REQUIREMENTS.md:1-185` — authoritative requirement IDs
- `/home/zak/Dev/PurgeGame/website/.planning/ROADMAP.md:115-127` — Phase 52 goal + success criteria
- `/home/zak/Dev/PurgeGame/website/.planning/STATE.md:1-106` — project state as of 2026-04-24
- `/home/zak/Dev/PurgeGame/website/.planning/PROJECT.md:107-131` — v2.4 milestone framing
- `/home/zak/Dev/PurgeGame/website/CLAUDE.md` — project instructions (no em-dashes, precise language, contract source-of-truth directive)
- `/home/zak/Dev/PurgeGame/degenerus-audit/contracts/modules/DegenerusGameMintModule.sol:440-491, 800-807` — `TraitsGenerated` event emission points
- `/home/zak/Dev/PurgeGame/degenerus-audit/contracts/storage/DegenerusGameStorage.sol:482-491` — event signature
- `/home/zak/Dev/PurgeGame/degenerus-audit/contracts/modules/DegenerusGameMintStreakUtils.sol` — `traitFromWord` (6-bit trait structure)

### Secondary (MEDIUM confidence)

- INTEG-01 JSON response shape (Section 10) — authored in Phase 50; database team may refine during implementation (e.g., rename `source` to `origin`; adjust `purchaseBlock` to `purchaseTx`).
- Pack-animator timing (Section 9 / D-07) — visual UAT will refine the exact timings; the framework holds.
- Source-determination heuristic (Section 10 + A5) — lootbox / jackpot-win detection by same-transaction cross-reference may need refinement; `purchase` is the safe default.

### Tertiary (LOW confidence)

- None. All claims are `[VERIFIED]` by direct file read or `[CITED]` to a file+line. `[ASSUMED]` items are logged explicitly in the Assumptions Log with risk assessment.

## Metadata

**Confidence breakdown:**
- SHELL-01 transitive audit + D-09 feasibility: HIGH — verified all 5 imports + 10 formatEth call sites + recursive grep on transitive imports
- Frontend patterns (fetch + stale-guard + keep-old-data-dim + subscribe): HIGH — Phase 51 `<profile-panel>` is a live template
- Badge SVG decomposition + CARD_IDX: HIGH — three independent beta places confirm the mapping; filesystem verified
- Jackpot wrapper architecture (shim vs reach-in vs invasive): MEDIUM — three options presented; recommended store-shim is low-risk but untested at Phase 52 scope
- INTEG-01 backend algorithm: MEDIUM — solid on data-source location + pseudocode; `startIndex` reconstruction is an ASSUMED invariant
- Pack animation timing (D-07): MEDIUM — GSAP is proven; exact timing will refine at UAT
- Web Audio API fail-silent path: HIGH — pattern is standard; D-10 locks the approach
- Validation architecture: HIGH — Phase 51 precedent established the template

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days — contracts are stable; beta/components/jackpot-panel.js is under active maintenance so the D-09 patch is the only mutable upstream target; any beta-side refactor that adds new wallet-tainted imports would invalidate the direct-import decision, caught by the new SHELL-01 regression test).

**Files the planner MUST read before creating plans:**

1. `.planning/phases/52-tickets-packs-jackpot/52-CONTEXT.md` (136 lines) — 10 locked decisions D-01..D-10
2. `.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md` (123 lines) — endpoint contract
3. `.planning/phases/51-profile-quests/51-RESEARCH.md` sections on validation architecture + fetch pattern (cloneable templates)
4. `.planning/phases/51-profile-quests/51-PATTERNS.md` (543 lines) — pattern-mapping format
5. `play/components/profile-panel.js` (418 lines) — the gold-standard hydrated Custom Element
6. `play/app/quests.js` (99 lines) — wallet-free helper template
7. `beta/components/jackpot-panel.js` (1075 lines) — skim Section 4 audit conclusions; the wrapper doesn't re-implement this
8. `beta/app/jackpot-rolls.js` (954 lines) — skim only for CARD_IDX, JO_CATEGORIES, JO_SYMBOLS, joBadgePath signatures
9. `beta/viewer/badge-inventory.js:1-35` — `traitToBadge()` source
10. `beta/viewer/utils.js` (39 lines) — the D-09 patch target file
11. `play/app/__tests__/play-profile-panel.test.js` (184 lines) — test-structure template
12. `play/app/__tests__/play-shell-01.test.js` (107 lines) — SHELL-01 recursive scanner (inherited coverage)
13. `database/src/db/schema/{tickets,lootbox,jackpot-history}.ts` — INTEG-01 data sources
14. `database/src/handlers/{tickets,lootbox,jackpot}.ts` — event-to-table wiring
15. `database/src/api/routes/player.ts:1-95` — day-resolution SQL to reuse
16. `.planning/phases/51-profile-quests/INTEG-02-SPEC.md` (217 lines) — side-quest delivery template

## RESEARCH COMPLETE
