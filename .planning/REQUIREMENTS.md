# Requirements: Contract-Paper Gap Audit

**Defined:** 2026-03-18
**Core Value:** Make the on-chain game playable, entertaining, and visually compelling from a browser

## v2.1 Requirements

### Extraction

- [x] **EXTR-01**: All mechanics in DegenerusGame.sol and 12 game modules catalogued (Advance, Boon, Decimator, Degenerette, Endgame, GameOver, Jackpot, Lootbox, Mint, MintStreakUtils, PayoutUtils, Whale)
- [x] **EXTR-02**: All mechanics in token contracts catalogued (BurnieCoin, BurnieCoinflip, DegenerusStonk, StakedDegenerusStonk, WrappedWrappedXRP)
- [x] **EXTR-03**: All mechanics in support systems catalogued (DegenerusAffiliate, DegenerusDeityPass, DegenerusQuests, DegenerusVault)
- [x] **EXTR-04**: All mechanics in infrastructure catalogued (DegenerusJackpots, DegenerusAdmin, DegenerusTraitUtils, DeityBoonViewer, Icons32Data, 5 libraries, storage)

### Analysis

- [ ] **ANLS-01**: Each mechanic cross-referenced to specific game theory paper section or marked undocumented
- [ ] **ANLS-02**: Consolidated gap report listing every undocumented mechanic with contract file, function name, what it does, and a blank decision column

## Out of Scope

| Feature | Reason |
|---------|--------|
| Code changes to contracts | Separate repo, decisions come after audit |
| Paper edits | Decisions come after audit; edits are a follow-up milestone |
| Whitepaper cross-reference | Game theory paper only |
| Frontend changes | Analysis-only milestone |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EXTR-01 | Phase 13 | Complete |
| EXTR-02 | Phase 13 | Complete |
| EXTR-03 | Phase 13 | Complete |
| EXTR-04 | Phase 13 | Complete |
| ANLS-01 | Phase 14 | Pending |
| ANLS-02 | Phase 14 | Pending |

**Coverage:**
- v2.1 requirements: 6 total
- Mapped to phases: 6
- Unmapped: 0

---
*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after roadmap creation*
