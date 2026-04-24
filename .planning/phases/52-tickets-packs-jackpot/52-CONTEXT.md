# Phase 52 -- CONTEXT: Tickets, Packs & Jackpot Reveal

**Phase goal (from ROADMAP.md):** Selected player's tickets render as 4-trait quadrant cards with openable pack animations from every source (purchase, jackpot win, lootbox), reusing the beta jackpot Roll widget for the trait reveal.

**Requirements:** TICKETS-01..04, PACKS-01..05, JACKPOT-01..03 (12 total). INTEG-01 hard-gated.

**Depends on:** Phase 50 (route + store), Phase 51 (day-aware fetch pattern), INTEG-01 endpoint delivery.

## Canonical Refs

- `.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md` (123 lines) -- the endpoint contract for `GET /player/:address/tickets/by-trait?level=N&day=M`. Hard gate for Wave 2+.
- `beta/components/jackpot-panel.js` (1075 lines) -- the Roll widget to reuse for JACKPOT-01..03.
- `beta/app/jackpot-rolls.js` -- helper used by jackpot-panel.js (no imports; safe to use from play/).
- `beta/viewer/badge-inventory.js` (lines 6-34) -- `traitToBadge(traitIndex)` decomposer mapping traitId 0-255 to `/badges-circular/{category}_{fileIdx}_{name}_{color}.svg`. The trait-SVG system used across the project.
- `beta/viewer/utils.js` -- wallet-free `formatEth`, `formatBurnie`, `formatWei`, `truncateAddress`. Drop-in replacement for beta/app/utils.js's wallet-tainted versions.
- `/home/zak/Dev/PurgeGame/database/src/api/routes/player.ts` -- the database handler where INTEG-01 will be implemented (mid-phase side-quest).
- `.planning/phases/51-profile-quests/51-CONTEXT.md` (D-14..D-18) -- day-aware fetch + stale-guard + keep-old-data-dim pattern to carry forward.
- `.planning/phases/51-profile-quests/INTEG-02-SPEC.md` -- precedent for solo-dev side-quest endpoint delivery; same pattern as INTEG-01.
- `CLAUDE.md` -- no em-dashes, no emojis, precise technical language.

## Gray Areas Discussed

Four gray areas were selected for discussion. Ten decisions captured below (D-01..D-10).

### Area 1: Ticket card visual design

**D-01 Card layout: Grid of small cards (~120-160px wide).**
Dense inventory grid like a deckbuilder. Many cards visible, each ~120-160px. Trait badges inside take up most of each quadrant (D-03). Scrolls vertically. Scales to high-ticket players without dominating the page.

**D-02 Trait representation: existing `/badges-circular/*.svg` inline at near-full quadrant size.**
Reuse `beta/viewer/badge-inventory.js:6-34` `traitToBadge(traitId)` decomposer. Each card is a 2x2 CSS grid; each cell contains an `<img src="/badges-circular/{category}_{fileIdx}_{name}_{color}.svg">` sized to fill ~80-90% of the cell with small padding. No text labels inside the card (label is the SVG's visual identity). Tooltip on hover/focus shows the trait label for accessibility (e.g., "zodiac_cancer_blue").

**D-03 Pending / partial / opened visual: Wrapped pack -> open card.**
- **Opened**: 2x2 grid of 4 trait SVGs as in D-02.
- **Pending**: sealed "pack" graphic -- CSS-only or a single pack SVG (e.g., `/play/assets/pack.svg`). Wrapper with subtle ribbon detail, color-tinted per source (purchase vs jackpot-win; see D-04). Has a pulsing "tap to open" affordance once RNG is resolved.
- **Partial** (some entries have traits, others don't): pack with N of 4 quadrants peeked through torn wrapper -- SVGs placed where traits are known, pack-wrapper texture overlay where they aren't. This matches the "wrapped pack" aesthetic while showing progress.

**D-04 Pack source distinction: subtle tint, shared silhouette.**
Purchase packs, jackpot-win packs, and (implicitly) lootbox-sourced packs all use the same pack silhouette. Subtle color-tint differentiates source: purchase = neutral/white-tint, jackpot-win = gold-tint, lootbox = (auto-opens; no sealed state). A small source-label pill sits under each card ("purchased", "won", "lootbox"). Consistent shape keeps the inventory visually coherent.

### Area 2: Pack reveal UX

**D-05 Open trigger: User-click gacha reveal.**
Pack stays sealed with pulsing "tap to open" affordance after RNG resolves. User clicks and then GSAP timeline runs. Feels game-like (gacha / loot box). Applies to purchase and jackpot-win sources.

**D-06 Exception for lootbox-sourced (PACKS-04): auto-open on appear.**
Lootbox-sourced tickets have traits known at lootbox-open time. The lootbox reveal IS the pack reveal -- no separate sealed-pack state. When a lootbox-sourced card appears in inventory, it's already in the opened state and the GSAP timeline plays once on first render (same timeline as user-click, just auto-triggered).

**D-07 Animation feel: Quick pop, 300-500ms total.**
GSAP timeline: pack shakes briefly (~80ms), flashes (~50ms), snaps open with a tiny scale bounce (~120ms), 4 trait SVGs slide/scale in together (~150ms). Total ~400ms. Responsive, not dramatic. Stacks well for 5-10 rapid opens. Uses `prefers-reduced-motion` fallback: instant state swap, no motion.

**D-08 Day-change during active animation.**
If user scrubs the day scrubber while a pack-open animation is mid-flight, the CURRENT animation runs to completion (no abort), but the underlying card list re-renders to the new day's snapshot. The in-flight pack animation may end with the card no longer existing in the new day's snapshot -- that's acceptable; the GSAP timeline's `onComplete` is a no-op if the element is gone. No visual glitch expected because the opacity transition for the new inventory rides on top.

### Area 3: Jackpot widget reuse

**D-09 Import directly from beta/, with a single upstream fix to satisfy SHELL-01.**
`beta/components/jackpot-panel.js:7` imports `formatEth` from `../app/utils.js` (wallet-tainted -- imports ethers). `beta/viewer/utils.js` exports the identical `formatEth` signature. Wave 0 patches the one import line in beta's `jackpot-panel.js` from `'../app/utils.js'` to `'../viewer/utils.js'`. Both beta and play then import the same file with zero runtime behavior change. This is a surgical, reversible edit.

After the patch: `play/components/jackpot-panel-wrapper.js` imports `beta/components/jackpot-panel.js` directly. No copy-and-maintain-two-files problem. No divergence risk. Any future bug fix to beta's jackpot rolls propagates to play automatically.

**Audit trail at Wave 0:** a grep-based test in `play/app/__tests__/` verifies `beta/components/jackpot-panel.js` does NOT import `'../app/utils.js'` after the patch -- regression guard that beta doesn't re-introduce the wallet-tainted import.

### Area 4: Sound + audio UX

**D-10 On by default + toggle. One bundled MP3, Web Audio API wrapper.**
- **File:** `play/assets/audio/pack-open.mp3` (~300ms, single cue reused for all sources).
- **Default state:** Enabled. First sound fires on the user's first pack-open click (which is a user gesture, satisfying browser autoplay policies).
- **Toggle:** Speaker-icon button in the top-right of `<packs-panel>` or similar. Persists to `localStorage.play.audio.muted`.
- **Volume:** Fixed at ~0.4 in a GainNode (not too loud on default system volume).
- **Fail-silent:** If the MP3 file 404s or the Web Audio API is unavailable (old Safari, some embedded browsers), the app logs a single console.warn and runs silently. No visual error.
- **`prefers-reduced-motion` interaction:** audio is independent of motion preference. Sound plays even in reduced-motion mode (unless muted).

## Scope Decisions Captured From Prior Phases (Not Re-Asked)

- **D-50-X (Phase 50):** Stack = vanilla ES modules + Custom Elements + Proxy store + GSAP. No framework introduction.
- **D-50-Y (Phase 50):** `state.replay.{day, level, player}` is the canonical store namespace. Panels subscribe to `replay.day` / `replay.player` and (for this phase) `replay.level` -- the level context matters because ticket inventory is per-jackpot-level.
- **D-51-14 (Phase 51):** One consolidated fetch per (player, day) change per panel, using `?day=N` query where supported.
- **D-51-17 (Phase 51):** Keep-old-data-dim pattern -- `.is-stale` class on `[data-bind="content"]` during refetch, removed on success.
- **D-51-18 (Phase 51):** Double stale-guard pattern: `#fetchId` token bump, compared after BOTH `await fetch()` AND `await res.json()`.
- **SHELL-01 (Phase 50):** no `ethers`, `wallet.js`, `contracts.js`, or `beta/app/utils.js` imports anywhere in play/. Recursive guardrail test runs in CI.

## Scope Additions

None. Phase 52 scope matches ROADMAP.md as authored; no mid-discussion scope creep. PACKS-05 (sound) remains in scope with the narrowed implementation per D-10.

## Deferred Ideas

Captured here so they don't get lost, but NOT in Phase 52 scope:

- **Per-trait badge metadata tooltips** (e.g., rarity indicator, drop rate) -- future polish; not in INTEG-01 spec.
- **Ticket card sort/filter controls** (e.g., sort by source, filter by level) -- defer; raw inventory view satisfies TICKETS-01..04.
- **Multi-select / batch operations on cards** (e.g., "reveal all pending") -- out of scope; TICKETS/PACKS is display-only this phase.
- **Trait statistics badges on opened cards** (e.g., "1 of 17 this day") -- future leaderboard feature, belongs to a different milestone.
- **Sound volume slider in UI** -- defer; hardcoded volume is fine for v2.4.
- **Separate "pack history" view** for packs that have been opened -- defer; the card IS the history.

## Implementation Path Sketch (Wave Plan Hint for Planner)

Not prescriptive -- the planner owns Wave structure. This is pattern-matched on Phase 51:

- **Wave 0 (autonomous):**
  - Author `INTEG-01-SPEC.md` check (already exists in Phase 50 dir; reference or copy forward into phase 52 dir).
  - Write Nyquist test harness `play/app/__tests__/play-packs-panel.test.js`, `play/app/__tests__/play-tickets-panel.test.js`, `play/app/__tests__/play-jackpot-wrapper.test.js` -- contract-grep assertions for the Wave 1+2 deliverables.
  - Write `play/app/__tests__/play-jackpot-shell01-regression.test.js` -- asserts `beta/components/jackpot-panel.js` does NOT import wallet-tainted `../app/utils.js`.
  - Patch `beta/components/jackpot-panel.js:7` -- swap `'../app/utils.js'` -> `'../viewer/utils.js'`. Verify beta still works via existing beta tests.
- **Wave 1 (autonomous, pre-backend):**
  - Build `play/components/tickets-panel.js` skeleton rendering 4-quadrant cards from stub data.
  - Build `play/components/packs-panel.js` skeleton with pack SVG + pending/opened state transitions.
  - Build `play/components/jackpot-panel-wrapper.js` importing beta's jackpot-panel directly.
  - Add `play/assets/audio/pack-open.mp3` + sound wrapper.
  - CSS for cards, packs, sound toggle, GSAP timeline.
- **Side-quest (database repo):** ship INTEG-01 per spec -- same pattern as INTEG-02 did for Phase 51. 3 commits expected: feat + docs + test.
- **Wave 2 (hard-gated on INTEG-01):** wire real fetch to `/player/:address/tickets/by-trait?level=N&day=M` with double stale-guard + keep-old-data-dim. JACKPOT-01..03 hydration from existing `/replay/rng` + jackpot endpoints (no new integration gate -- jackpot-panel.js already does this).
- **Wave 3 (manual UAT, optional):** browser check for gacha reveal feel, audio gating, jackpot widget rendering, trait SVG correctness. Likely deferred following Phase 50/51 precedent.

## Open Questions for Research/Planning

- **Q1:** Does `beta/components/jackpot-panel.js` have any other wallet-tainted transitive imports beyond `../app/utils.js:7`? The grep check at Wave 0 should be recursive (follow imports 2-3 levels deep). If it does, D-09 needs a different path (copy-and-scrub or extract shared core).
- **Q2:** INTEG-01-SPEC.md is at `.planning/phases/50-route-foundation-day-aware-store/INTEG-01-SPEC.md`. Should Phase 52 reference it in place or copy forward? Precedent from Phase 51: INTEG-02-SPEC.md was authored inside Phase 51 dir. Consider symlink or reference-with-path.
- **Q3:** Does `/badges-circular/*.svg` exist at the website repo root? Need to verify the SVG files are served (check `beta/viewer.html` or server config). If they're served by the static file server, play/ can use the same paths.

## Decisions Checksum

D-01 Card layout: Grid of small cards (~120-160px)
D-02 Trait SVGs via traitToBadge() decomposer, badges at near-full quadrant size
D-03 Pending/partial/opened states: wrapped pack -> open card, partial shows peeked quadrants
D-04 Pack source tint: purchase neutral / jackpot-win gold-tint / lootbox auto-opens
D-05 User-click gacha reveal for purchase and jackpot-win
D-06 Lootbox-sourced packs auto-open on appear (PACKS-04)
D-07 Quick-pop GSAP timeline, 300-500ms, prefers-reduced-motion fallback
D-08 Day-change mid-animation: current animation runs to completion, underlying list re-renders
D-09 Import beta/jackpot-panel.js directly after 1-line upstream import patch
D-10 Sound: on by default, bundled MP3, Web Audio API wrapper, localStorage mute toggle, fail-silent

**Ready for:** `/gsd-plan-phase 52`. Research agent should investigate Q1..Q3 before planner locks wave structure.
