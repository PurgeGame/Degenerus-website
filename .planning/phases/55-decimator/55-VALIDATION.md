---
phase: 55
slug: decimator
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 55 -- Validation Strategy

> Per-phase validation contract. Extracted from 55-RESEARCH.md Section "Validation Architecture (Nyquist)" (lines 1254-1529).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (no JSDOM, no build) |
| **Config file** | none |
| **Quick run command** | `node --test play/app/__tests__/play-decimator-panel.test.js` |
| **Full suite command** | `node --test play/app/__tests__/*.test.js` |
| **Estimated runtime** | ~3-5 seconds |

Contract-grep style. Pattern verified by Phase 50-54 test files (288/288 green at Phase 54 end; target ~325 after Phase 55).

---

## Sampling Rate

- **Per task commit:** `node --test play/app/__tests__/play-decimator-panel.test.js`
- **Per plan wave:** `node --test play/app/__tests__/*.test.js`
- **Phase gate:** full suite + play-shell-01.test.js green AND INTEG-03 endpoint live

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Command | Wave |
|--------|----------|-----------|---------|------|
| DECIMATOR-01 | Window status badge (open/closed/upcoming) + level label | contract-grep | play-decimator-panel.test.js | 0 authors / 1 greens |
| DECIMATOR-02 | Bucket/subbucket assignment (5-12 normal / 2-12 centennial per contract truth) | contract-grep | same | 0/2 |
| DECIMATOR-03 | Weighted + effective amounts per burn level from existing /player response | contract-grep | same | 0/1 partial / 2 full |
| DECIMATOR-04 | Winning subbucket reveal + payout pill for resolved levels | contract-grep | same | 0/2 |
| DECIMATOR-05 | Terminal sub-section conditional on `terminal.burns.length > 0` | contract-grep | same | 0/1 |
| SHELL-01 | 3 new FORBIDDEN entries (terminal-panel.js, decimator.js app, terminal.js app); no play/ imports match | recursive grep | play-shell-01.test.js | every wave |

---

## Test File to Author in Wave 0

### `play/app/__tests__/play-decimator-panel.test.js` (~30-37 assertions)

Mirrors play-baf-panel.test.js shape (dual-signal subscribe + stale-guard + optional per-player fetch).

**Existence + registration (~6):**
- file exists, ES module, registers `<decimator-panel>`, extends HTMLElement, connected/disconnectedCallback

**Subscribes (~4):**
- `replay.level`, `replay.player`, `replay.day` — three subscriptions (decimator is dual-level+day-aware with player filter)

**SHELL-01 surface (~4):**
- No imports of `beta/components/decimator-panel.js`, `beta/components/terminal-panel.js`, `beta/app/decimator.js`, `beta/app/terminal.js`, `beta/app/utils.js`, ethers, wallet, contracts

**Imports from (~3):**
- `beta/app/store.js` (subscribe, get), `beta/viewer/utils.js` (formatEth, truncateAddress), `play/app/constants.js` (API_BASE)

**Fetch paths (~3):**
- Wave 1: `fetch('/player/${addr}?day=${day}')` for decimator + terminal blocks
- Wave 2: `fetch('/player/${addr}/decimator?level=${level}&day=${day}')` for INTEG-03

**Dual stale-guards (~3):**
- `#decimatorFetchId` (main /player response)
- `#decimatorPlayerFetchId` (INTEG-03 per-player)
- Both token-compared after fetch + json per Phase 51/52/54 pattern

**DECIMATOR-01 markup (~3):**
- `data-bind="window-status"` (open/closed/upcoming pill)
- `data-bind="decimator-level"` (level label)
- Time-remaining DROPPED from Wave 1 per RESEARCH Section 7 (game.levelStartTime is null in play/ store)

**DECIMATOR-02 markup (~4, Wave 2-gated):**
- `data-bind="bucket-table"` (table container)
- `.bucket-row[data-bucket-idx]` with indices 5-12 (normal) or 2-12 (centennial) — CONTRACT TRUTH per RESEARCH Pitfall 1, NOT CONTEXT D-03's 1-8
- `[aria-current="true"]` on player's assigned bucket row
- `data-bind="subbucket-display"`

**DECIMATOR-03 markup (~3):**
- `data-bind="weighted-amount"`, `data-bind="effective-amount"`, `data-bind="time-mult-bps"`

**DECIMATOR-04 markup (~3, Wave 2-gated):**
- `data-bind="winning-subbucket"` (pill)
- `data-bind="payout-amount"` (player's payout if in winning subbucket; "Not your subbucket" otherwise)
- State machine: upcoming / open / closed-unresolved / closed-resolved

**DECIMATOR-05 markup (~3):**
- `data-bind="terminal-section"` conditionally rendered
- `data-bind="terminal-burns"` (burn rows with level/effective/weighted/timeMult)
- Empty case: `terminal.burns.length === 0` -> section hidden

**Activity score cross-reference (~1, D-07):**
- `data-bind="activity-score-display"` reads from same store path profile-panel uses

**Bucket range contract-truth assertions (~2):**
- Source contains `bucketRange(level)` helper OR inline `level % 100 === 0 ? 2 : 5` branching
- Source does NOT contain `1-8` or `[1, 2, 3, 4, 5, 6, 7, 8]` as bucket range (reject CONTEXT D-03 error)

**Score-unit discipline (~1):**
- Source uses `formatEth` for payoutAmount + weightedAmount + effectiveAmount (all wei-scale per INTEG-03 spec)

**Empty state (~1):**
- Empty bucket: "No decimator activity at level N"

Total: ~37 assertions.

---

## SHELL-01 FORBIDDEN Extension (Wave 0)

Append to `play/app/__tests__/play-shell-01.test.js` FORBIDDEN array:

```
'beta/components/terminal-panel.js',  // wallet-tainted via beta/app/utils.js:3 ethers import
'beta/app/decimator.js',              // direct ethers import at line 4
'beta/app/terminal.js',               // direct ethers import at line 6
```

Existing `beta/components/decimator-panel.js` entry stays. Count: 11 → 14 after Wave 0.

---

## Manual-Only Verifications (Wave 3, UAT-Deferrable)

| Behavior | Requirement | Why Manual | Instructions |
|----------|-------------|------------|--------------|
| Bucket table visual correctness (5-12 rows normal, 2-12 rows centennial) | DECIMATOR-02 | Visual verification of contract-truth | Scrub to a non-century level — table shows buckets 5..12 (8 rows). Scrub to level 100 — table shows buckets 2..12 (11 rows). Player's bucket row has `aria-current` highlight. |
| Winning subbucket reveal visual | DECIMATOR-04 | Visual correctness | Pick a resolved level where player was in winning subbucket — "You won X ETH" pill; else "Not your subbucket". |
| Terminal section conditional render | DECIMATOR-05 | UX polish | Pick player with 0 terminal burns: section hidden. Pick player with terminal burns: section renders with all three amounts. |
| Empty state | DECIMATOR-02 | UX polish | Pick player with no decimator activity at a level: "No decimator activity at level N". |
| Rapid level-scrub stability | DECIMATOR-02/04 | Stale-guard smoothness | Scrub 10+ levels in <2s. Latest data always wins. |
| Activity score cross-reference accurate | D-07 | Visual verification | Verify decimator panel's activity score matches profile-panel's value for same (player, day). |

**UAT deferral precedent:** Phase 50-54 all deferred their Wave 3 UAT. Phase 55 Wave 3 is similarly deferrable.

---

## Wave 0 Gaps

- [ ] play-decimator-panel.test.js authored
- [ ] INTEG-03-SPEC.md authored (extracted from RESEARCH Section 8)
- [ ] play-shell-01.test.js FORBIDDEN list +3 entries
- [ ] REQUIREMENTS.md: no status changes required (INTEG-03 remains [ ] pending Wave 2 ship)

---

## Phase Gate (Before `/gsd-verify-work`)

- `node --test play/app/__tests__/*.test.js` green (288 prior + ~37 new = ~325)
- play-shell-01.test.js green
- INTEG-03 endpoint live in `/home/zak/Dev/PurgeGame/database/` (3 atomic commits matching precedents)
- Database-side vitest green
- Optional: Wave 3 UAT or formal deferral in 55-UAT.md

---

*Phase 55 validation strategy; extracted from 55-RESEARCH.md Section "Validation Architecture (Nyquist)". Sign-off pending Wave 0.*
