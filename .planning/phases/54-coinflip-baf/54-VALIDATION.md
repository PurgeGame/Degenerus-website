---
phase: 54
slug: coinflip-baf
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 54 -- Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Extracted from 54-RESEARCH.md Section "Validation Architecture (Nyquist)" (lines 1181-1479).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (no JSDOM, no build) |
| **Config file** | none -- runs directly via `node --test` |
| **Quick run command** | `node --test play/app/__tests__/play-coinflip-panel.test.js play/app/__tests__/play-baf-panel.test.js` |
| **Full suite command** | `node --test play/app/__tests__/*.test.js` |
| **Estimated runtime** | ~3-5 seconds |

Tests are **contract-grep style** -- source-file regex assertions against the Custom Element modules. No runtime rendering. Pattern verified by Phase 50-53 test files (230/230 green after Phase 53 Option B ship).

---

## Sampling Rate

- **After every task commit:** `node --test play/app/__tests__/play-coinflip-panel.test.js play/app/__tests__/play-baf-panel.test.js`
- **After every plan wave:** `node --test play/app/__tests__/*.test.js` (full /play/ suite)
- **Before `/gsd-verify-work`:** Full suite + `play-shell-01.test.js` must be green AND INTEG-05 endpoint live
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | Wave |
|--------|----------|-----------|-------------------|------|
| COINFLIP-01 | `<coinflip-panel>` renders player coinflip state (depositedAmount, claimablePreview, autoRebuy) from INTEG-02 response | contract-grep | `node --test play/app/__tests__/play-coinflip-panel.test.js` | 0 authors / 1 greens |
| COINFLIP-02 | Daily coinflip leaderboard (top-10) renders from `/leaderboards/coinflip?day=N` | contract-grep | same | 0/1 |
| COINFLIP-03 | Bounty + biggest-flip-today render from INTEG-02 coinflip block | contract-grep | same | 0/1 |
| BAF-01 | Selected player's BAF score + rank + "Your rank" row (hard-gated on INTEG-05) | contract-grep | `node --test play/app/__tests__/play-baf-panel.test.js` | 0/2 |
| BAF-02 | Top-4 BAF leaderboard with gold/silver/bronze prominence styling | contract-grep | same | 0/1 |
| BAF-03 | BAF round-status pill (open/closed/skipped/not_eligible) + level label | contract-grep | same | 0/2 |
| SHELL-01 (cross-play) | No new play/ files import forbidden paths (incl. newly added beta/components/baf-panel.js, beta/app/coinflip.js, beta/app/baf.js to FORBIDDEN list) | recursive grep (existing) | `node --test play/app/__tests__/play-shell-01.test.js` | every wave |

---

## Test Files to Author in Wave 0

### 1. `play/app/__tests__/play-coinflip-panel.test.js` (~25 assertions)

Mirrors `play-profile-panel.test.js` shape. Covers:
- Existence, registration, class extends HTMLElement
- Subscribes to `replay.day`, `replay.player` (2 signals); no `replay.level` (coinflip is day-based)
- SHELL-01 surface: no imports of `beta/app/coinflip.js`, `beta/app/utils.js`, ethers, wallet, contracts
- Imports from: `beta/app/store.js` (subscribe, get), `beta/viewer/utils.js` (formatBurnie / truncateAddress)
- Fetch paths: `Promise.all([fetch('/player/${addr}?day=${day}'), fetch('/leaderboards/coinflip?day=${day}')])` (no shared helper per RESEARCH Section 10)
- Stale-guard: `#coinflipFetchId` counter with 3 token comparisons (after fetch1, fetch2, both json()s)
- COINFLIP-01 markup: `data-bind="coinflip-deposited"`, `data-bind="coinflip-claimable"`, `data-bind="coinflip-rebuy"`
- COINFLIP-02 markup: `data-bind="coinflip-leaderboard"`, `.coinflip-row[data-rank]`, `data-bind="coinflip-empty"`
- COINFLIP-03 markup: `data-bind="coinflip-bounty"`, `data-bind="coinflip-biggest-flip"`
- Selected-player highlighting: `[aria-current="true"]` when row's player matches `replay.player`
- Empty states: when player has no coinflip activity, render "No coinflip activity"
- Score-unit discipline (Pitfall 8): coinflip leaderboard scores render as integer BURNIE (no wei division); player-block amounts render as wei-scale BURNIE (via formatBurnie)

### 2. `play/app/__tests__/play-baf-panel.test.js` (~25 assertions)

Covers:
- Existence, registration, class extends HTMLElement
- Subscribes to `replay.level`, `replay.player` (2 signals); no `replay.day` (BAF is level-based)
- SHELL-01: no imports of `beta/components/baf-panel.js`, `beta/app/baf.js`, `beta/app/utils.js`, ethers
- Imports from: `beta/app/store.js`, `beta/viewer/utils.js` (formatBurnie, truncateAddress)
- Fetch paths: Wave 1 -- `/leaderboards/baf?level=${level}` (top-4 live); Wave 2 -- `/player/${addr}/baf?level=${level}` (per-player INTEG-05)
- Dual stale-guards: `#bafFetchId` (leaderboard) + `#bafPlayerFetchId` (per-player) — invalidated at different cadences
- BAF-02 markup: `data-bind="baf-leaderboard"`, `.baf-row[data-rank]` with rank 1-4, prominence tiers via `data-rank` attribute selectors
- BAF-01 markup (Wave 2 hydration): `data-bind="baf-your-rank"`, `data-bind="baf-your-score"`, rendered only when player is not in top-4
- BAF-03 markup: `data-bind="baf-round-status"` (pill: open/closed/skipped/not_eligible), `data-bind="baf-level-label"`
- Round-status derivation per RESEARCH Section 10: 4 states from level arithmetic + baf_skipped + jackpot_distributions eth_baf/tickets_baf
- Prominence CSS classes: rank 1 gold, rank 2 silver, rank 3 bronze, rank 4 regular (per CONTEXT D-06)
- Score-unit discipline: BAF scores are wei-scale BURNIE (via formatBurnie, not raw integer)
- Selected-player highlighting in top-4: `[aria-current="true"]` when row's player matches `replay.player`

### 3. (Optional, planner decision) `play/app/__tests__/play-leaderboards-fetch.test.js`

Only if the planner chooses to extract a shared `play/app/leaderboards-fetch.js` helper. Default recommendation per RESEARCH Section 10: SKIP (no wire-dedup benefit; two panels have zero endpoint overlap).

---

## Manual-Only Verifications (Wave 3, UAT-Deferrable)

| Behavior | Requirement | Why Manual | Instructions |
|----------|-------------|------------|--------------|
| Prominence styling visual correctness (rank 1 gold, rank 2 silver, rank 3 bronze, rank 4 regular) | BAF-02 / D-06 | Visual fidelity; CSS var resolution | Load /play/; scrub to a level with 4+ BAF participants. Verify rank 1 row uses --accent-primary or similar gold-tone; rank 2 silver; rank 3 bronze; rank 4 default. |
| Selected-player highlighting in both leaderboards | COINFLIP-02 + BAF-02 | Selector tree inspection | Pick a player known to be in top-10 coinflip or top-4 BAF. Row should have visible highlight (bold + underline or background tint) via `[aria-current="true"]`. |
| "Your rank: N of M" row for player NOT in top-4 BAF (Wave 2 INTEG-05) | BAF-01 / D-04 | Needs live INTEG-05 | Pick a player outside top-4 on a given level. Below the top-4 leaderboard, a "Your rank: 15 of 42" style row appears with the player's score. |
| Round-status pill visual states | BAF-03 / D-09 | Visual verification of 4 states | Scrub across levels: a level with baf_skipped shows "skipped"; a resolved BAF shows "closed"; current active level shows "open"; level 0 shows "not_eligible". Pill color-codes accordingly. |
| Rapid day-scrub stability on coinflip leaderboard | COINFLIP-02 | Stale-guard visual smoothness | Scrub day 10 -> 20 in under 2 seconds. Leaderboard content should dim (`.is-stale`) briefly, then update to the final day. No intermediate-state render artifacts. |
| Empty BAF level | BAF-02 | Edge case | Pick a level with 0 or <4 BAF participants. Empty / partial states render cleanly. |
| Empty coinflip day | COINFLIP-02 | Edge case | Pick a day with no coinflip activity. "No coinflip activity for day N" message renders. |

**UAT deferral precedent:** Phase 50, 51, 52, and 53 all deferred their Wave 3 UAT. Phase 54 Wave 3 is similarly deferrable -- automated verification + Wave 2 acceptance-criteria grep is sufficient to close the phase if the user opts to defer.

---

## Wave 0 Gaps (to be closed by Wave 0 plan)

- [ ] `play/app/__tests__/play-coinflip-panel.test.js` -- authored
- [ ] `play/app/__tests__/play-baf-panel.test.js` -- authored
- [ ] `.planning/phases/54-coinflip-baf/INTEG-05-SPEC.md` -- authored (drafted in RESEARCH Section 8; Wave 0 extracts to standalone spec)
- [ ] `play/app/__tests__/play-shell-01.test.js` FORBIDDEN list updated: add `beta/components/baf-panel.js`, `beta/app/coinflip.js`, `beta/app/baf.js`
- [ ] REQUIREMENTS.md updates: INTEG-04 status changed to [~] (deferred per ROADMAP success criterion 5); INTEG-05 stays [ ] pending Wave 2 ship

---

## Phase Gate (Before `/gsd-verify-work`)

- `node --test play/app/__tests__/*.test.js` green (all new + existing = 230 + ~50 new = ~280 pass)
- `play-shell-01.test.js` green
- INTEG-05 endpoint live in `/home/zak/Dev/PurgeGame/database/` (3 atomic commits: feat + docs + test, matching INTEG-01 and INTEG-02 precedents)
- Database-side vitest green (no regressions)
- Optional: Wave 3 UAT completed OR formally deferred in 54-UAT.md

---

*Phase 54 validation strategy; extracted from 54-RESEARCH.md Section "Validation Architecture (Nyquist)" lines 1181-1479. Sign-off pending Wave 0 completion.*
