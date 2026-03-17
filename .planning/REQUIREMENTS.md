# Requirements: Game Theory Paper Audit

**Defined:** 2026-03-16
**Core Value:** Every number and mechanism claim in the game theory paper is verifiably correct

## v1 Requirements

### Preparation

- [x] **PREP-01**: Primer Section 9 pitfalls read and internalized before auditing begins
- [x] **PREP-02**: Paper structure mapped with claim density per section

### Numerical Claims

- [x] **NUM-01**: All BPS/percentage values verified against parameter reference
- [x] **NUM-02**: All ETH amounts, pool targets, and price curve values verified
- [x] **NUM-03**: All timing constants verified (death clock, drip frequency, jackpot phases)
- [x] **NUM-04**: All ratios, multipliers, and score thresholds verified

### Mechanism Claims

- [x] **MECH-01**: Pool architecture claims verified (flow, transitions, freeze, drawdown)
- [x] **MECH-02**: Jackpot/prize distribution mechanics verified (daily drip, 5-day draws, BAF, decimator)
- [x] **MECH-03**: BURNIE economics verified (coinflip, supply, ticket conversion, price floor)
- [x] **MECH-04**: Activity score mechanics verified (components, EV curves, thresholds)
- [x] **MECH-05**: Affiliate, deity, whale pass, and lootbox mechanics verified
- [x] **MECH-06**: Death clock, endgame, and terminal distribution mechanics verified

### Arithmetic

- [x] **ARITH-01**: All worked examples re-derived (terminal paradox, bear market, extraction)
- [x] **ARITH-02**: All formulas/equations checked against contract implementation

### Consistency & Report

- [x] **XREF-01**: Cross-section consistency validated (assumptions match stated facts)
- [x] **XREF-02**: Appendix parameter tables match in-text claims
- [ ] **RPT-01**: Discrepancy report written to theory/AUDIT-REPORT.md with severity ratings
- [ ] **RPT-02**: Every finding includes location, source of truth, severity, and sketched fix

## v2 Requirements

None. This is a one-shot audit.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Editing the paper | Read-only audit; fixes are a separate task |
| Prose quality review | Numbers and mechanisms only, not writing quality |
| Game theory correctness | Whether equilibria are valid, vs whether the numbers feeding them are right |
| External system claims | ETH gas costs, Chainlink VRF behavior, stETH yield rates |
| Turbo mode mechanics | Not yet in contracts; paper may reference future plans |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PREP-01 | Phase 1: Preparation | Complete |
| PREP-02 | Phase 1: Preparation | Complete |
| NUM-01 | Phase 2: Number-Heavy Sections Audit | Complete |
| NUM-02 | Phase 2: Number-Heavy Sections Audit | Complete |
| NUM-03 | Phase 2: Number-Heavy Sections Audit | Complete |
| NUM-04 | Phase 3: Mechanism-Heavy Sections Audit | Complete |
| MECH-01 | Phase 3: Mechanism-Heavy Sections Audit | Complete |
| MECH-02 | Phase 3: Mechanism-Heavy Sections Audit | Complete |
| MECH-03 | Phase 2: Number-Heavy Sections Audit | Complete |
| MECH-04 | Phase 3: Mechanism-Heavy Sections Audit | Complete |
| MECH-05 | Phase 4: Prose and Framing Sections Audit | Complete |
| MECH-06 | Phase 2: Number-Heavy Sections Audit | Complete |
| ARITH-01 | Phase 2: Number-Heavy Sections Audit | Complete |
| ARITH-02 | Phase 3: Mechanism-Heavy Sections Audit | Complete |
| XREF-01 | Phase 5: Cross-Section Consistency and Report | Complete |
| XREF-02 | Phase 5: Cross-Section Consistency and Report | Complete |
| RPT-01 | Phase 5: Cross-Section Consistency and Report | Pending |
| RPT-02 | Phase 5: Cross-Section Consistency and Report | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-03-16*
*Last updated: 2026-03-16 after roadmap creation*
