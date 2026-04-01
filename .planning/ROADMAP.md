# Roadmap: Degenerus Protocol Website

## Milestones

- v1.0 **Paper Audit** - Phases 1-5 (shipped 2026-03-18)
- v2.0 **Game Frontend** - Phases 6-12 (shipped 2026-03-18)
- v2.1 **Contract-Paper Gap Audit** - Phases 13-14 (shipped 2026-03-19)
- v2.2 **Contract-Paper Parity Check** - Phases 15-17 (in progress)

## Phases

<details>
<summary>v1.0 Paper Audit (Phases 1-5) - SHIPPED 2026-03-18</summary>

- [x] Phase 1: Preparation (1/1 plans) - completed 2026-03-16
- [x] Phase 2: Number-Heavy Sections Audit (3/3 plans) - completed 2026-03-16
- [x] Phase 3: Mechanism-Heavy Sections Audit (2/2 plans) - completed 2026-03-16
- [x] Phase 4: Prose and Framing Sections Audit (2/2 plans) - completed 2026-03-16
- [x] Phase 5: Cross-Section Consistency and Report (2/2 plans) - completed 2026-03-17

</details>

<details>
<summary>v2.0 Game Frontend (Phases 6-12) - SHIPPED 2026-03-18</summary>

- [x] Phase 6: Foundation (3/3 plans) - completed 2026-03-18
- [x] Phase 7: Purchasing & Core UI (2/2 plans) - completed 2026-03-18
- [x] Phase 8: Hero Displays (3/3 plans) - completed 2026-03-18
- [x] Phase 9: Supporting Features (4/4 plans) - completed 2026-03-18
- [x] Phase 10: Decimator & Terminal (2/2 plans) - completed 2026-03-18
- [x] Phase 11: Audio & Polish (2/2 plans) - completed 2026-03-18
- [x] Phase 12: Integration Fixes & Cleanup (1/1 plans) - completed 2026-03-18

</details>

<details>
<summary>v2.1 Contract-Paper Gap Audit (Phases 13-14) - SHIPPED 2026-03-19</summary>

- [x] Phase 13: Contract Mechanic Extraction (4/4 plans) - completed 2026-03-19
- [x] Phase 14: Gap Analysis and Report (2/2 plans) - completed 2026-03-19

</details>

### v2.2 Contract-Paper Parity Check

- [x] **Phase 15: Game & Modules Parity** - Verify 14 core game contracts against paper claims (completed 2026-04-01)
- [x] **Phase 16: Token & Support Systems Parity** - Verify token contracts and support system contracts (completed 2026-04-01)
- [x] **Phase 17: Consolidated Parity Report** - Merge all parity notes into final deliverable (completed 2026-04-01)

## Phase Details

### Phase 16: Token & Support Systems Parity
**Goal**: Every paper claim about token contracts (BurnieCoin, BurnieCoinflip, DegenerusStonk, StakedDegenerusStonk, WrappedWrappedXRP, GNRUS) and support systems (Affiliate, DeityPass, Quests, Vault) is verified against contract source
**Depends on**: Phase 15 (methodology and format established)
**Requirements**: VER-03, VER-04
**Plans:** 4/4 plans complete
Plans:
- [ ] 16-01-PLAN.md -- DGNRS ecosystem + WWXRP verification (resolves Phase 15 deferred items #1, #2)
- [ ] 16-02-PLAN.md -- Coinflip system + BURNIE token verification
- [ ] 16-03-PLAN.md -- Support systems verification (resolves Phase 15 deferred item #3)
- [ ] 16-04-PLAN.md -- GNRUS verification + delta tracking + consolidation into parity notes

**Success Criteria** (what must be TRUE):
  1. Every paper claim about BURNIE supply, coinflip odds, DGNRS distribution, staking, and WWXRP is verified against token contract source
  2. Every paper claim about affiliate tiers, deity pass pricing, quest rewards, and vault mechanics is verified against support contract source
  3. Any new or changed mechanics since v2.1 catalog are identified
  4. Any removed or renamed mechanics since v2.1 catalog are identified
  5. Discrepancies follow D-01 format: paper location, contract location, nature of mismatch, severity

### Phase 17: Consolidated Parity Report
**Goal**: A single deliverable merging all parity notes (Phases 15-16) into a complete cross-contract parity report with recommendations
**Depends on**: Phase 16
**Requirements**: VER-01, VER-02, OUT-01, OUT-03
**Plans:** 1/1 plans complete
Plans:
- [x] 17-01-PLAN.md -- Consolidate all 24 discrepancies into severity-first report with fix guidance, new mechanics inventory, and coverage proof

**Success Criteria** (what must be TRUE):
  1. All numerical claims in the game theory paper verified against current contract constants
  2. All mechanism descriptions verified against current contract implementations
  3. Structured parity notes produced per contract group (Game & Modules, Token Contracts, Support Systems)
  4. Summary of new mechanics not yet covered in the paper with recommendation on documentation
  5. Single consolidated report ready for user action

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 13. Contract Mechanic Extraction | v2.1 | 4/4 | Complete | 2026-03-19 |
| 14. Gap Analysis and Report | v2.1 | 2/2 | Complete | 2026-03-19 |
| 15. Game & Modules Parity | v2.2 | 4/4 | Complete | 2026-04-01 |
| 16. Token & Support Systems Parity | v2.2 | 0/4 | Complete    | 2026-04-01 |
| 17. Consolidated Parity Report | v2.2 | 1/1 | Complete    | 2026-04-01 |
