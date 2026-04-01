# Roadmap: Degenerus Protocol Website

## Milestones

- v1.0 **Paper Audit** - Phases 1-5 (shipped 2026-03-18)
- v2.0 **Game Frontend** - Phases 6-12 (shipped 2026-03-18)
- v2.1 **Contract-Paper Gap Audit** - Phases 13-14 (in progress)

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

### v2.1 Contract-Paper Gap Audit

- [x] **Phase 13: Contract Mechanic Extraction** - Catalog every mechanic across all 30+ contract files (completed 2026-03-19)
- [ ] **Phase 14: Gap Analysis and Report** - Cross-reference catalog against game theory paper, produce gap report

## Phase Details

### Phase 13: Contract Mechanic Extraction
**Goal**: A complete, structured catalog of every player-facing and system mechanic in the contract codebase
**Depends on**: Nothing (first phase of milestone)
**Requirements**: EXTR-01, EXTR-02, EXTR-03, EXTR-04
**Success Criteria** (what must be TRUE):
  1. Every public/external function in DegenerusGame.sol and its 12 game modules has a catalog entry describing what it does
  2. Every mechanic in token contracts (BurnieCoin, BurnieCoinflip, DegenerusStonk, StakedDegenerusStonk, WrappedWrappedXRP) is catalogued with its parameters and effects
  3. Every mechanic in support systems (Affiliate, DeityPass, Quests, Vault) is catalogued
  4. Every mechanic in infrastructure (Jackpots, Admin, TraitUtils, DeityBoonViewer, Icons32Data, libraries, storage) is catalogued
  5. The catalog is structured consistently: contract file, function/mechanism name, what it does, key parameters
**Plans:** 4/4 plans complete

Plans:
- [ ] 13-01-PLAN.md -- Catalog DegenerusGame.sol dispatcher + 6 smaller modules (Boon, Endgame, GameOver, MintStreakUtils, PayoutUtils, Whale)
- [ ] 13-02-PLAN.md -- Catalog 6 larger modules (Advance, Decimator, Degenerette, Jackpot, Lootbox, Mint)
- [ ] 13-03-PLAN.md -- Catalog 5 token contracts + 4 support system contracts
- [ ] 13-04-PLAN.md -- Catalog infrastructure (Jackpots engine, Admin, TraitUtils, DeityBoonViewer, Icons, libraries, storage)

### Phase 14: Gap Analysis and Report
**Goal**: A complete gap report showing every contract mechanic not documented in the game theory paper, ready for decision-making
**Depends on**: Phase 13
**Requirements**: ANLS-01, ANLS-02
**Success Criteria** (what must be TRUE):
  1. Every catalogued mechanic is either mapped to a specific game theory paper section or explicitly marked as undocumented
  2. The gap report lists each undocumented mechanic with: contract file, function name, what it does, and a blank decision column for the user
  3. No mechanic from the catalog is missing from the cross-reference (100% coverage of the extraction)
**Plans:** 1/2 plans executed

Plans:
- [ ] 14-01-PLAN.md -- Build complete cross-reference mapping every catalog mechanic to paper sections
- [ ] 14-02-PLAN.md -- Compile gap report from cross-reference with decision columns

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Preparation | v1.0 | 1/1 | Complete | 2026-03-16 |
| 2. Number-Heavy Sections Audit | v1.0 | 3/3 | Complete | 2026-03-16 |
| 3. Mechanism-Heavy Sections Audit | v1.0 | 2/2 | Complete | 2026-03-16 |
| 4. Prose and Framing Sections Audit | v1.0 | 2/2 | Complete | 2026-03-16 |
| 5. Cross-Section Consistency and Report | v1.0 | 2/2 | Complete | 2026-03-17 |
| 6. Foundation | v2.0 | 3/3 | Complete | 2026-03-18 |
| 7. Purchasing & Core UI | v2.0 | 2/2 | Complete | 2026-03-18 |
| 8. Hero Displays | v2.0 | 3/3 | Complete | 2026-03-18 |
| 9. Supporting Features | v2.0 | 4/4 | Complete | 2026-03-18 |
| 10. Decimator & Terminal | v2.0 | 2/2 | Complete | 2026-03-18 |
| 11. Audio & Polish | v2.0 | 2/2 | Complete | 2026-03-18 |
| 12. Integration Fixes & Cleanup | v2.0 | 1/1 | Complete | 2026-03-18 |
| 13. Contract Mechanic Extraction | v2.1 | 4/4 | Complete | 2026-03-19 |
| 14. Gap Analysis and Report | v2.1 | 2/2 | Complete | 2026-03-19 |
| 15. Game & Modules Parity | v2.2 | 4/4 | Complete    | 2026-04-01 |
