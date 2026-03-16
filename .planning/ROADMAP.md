# Roadmap: Game Theory Paper Audit

## Overview

Systematic audit of every numerical claim, mechanism description, and worked example in the Degenerus game theory paper (theory/index.html) against contract source code and audit documentation. The paper has 11 main sections and 6 appendices spanning 5000+ lines. Phases are organized by section clusters: preparation first, then three audit passes grouped by claim density (number-heavy, mechanism-heavy, prose/framing), then cross-section consistency and final report compilation.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Preparation** - Internalize pitfalls and map paper structure with claim density per section
- [x] **Phase 2: Number-Heavy Sections Audit** - Audit SS6, SS8, SS9, Appendix A/B/C/E (BPS, ETH amounts, timing, BURNIE, endgame, worked examples)
- [ ] **Phase 3: Mechanism-Heavy Sections Audit** - Audit SS4, SS5, Appendix D (pool architecture, jackpots, activity score, formulas)
- [ ] **Phase 4: Prose and Framing Sections Audit** - Audit SS1-SS3, SS7, SS10-SS11, Appendix F (cross-subsidy claims, player type numbers, affiliate/deity/pass mechanics)
- [ ] **Phase 5: Cross-Section Consistency and Report** - Validate internal consistency, compile theory/AUDIT-REPORT.md

## Phase Details

### Phase 1: Preparation
**Goal**: Auditor has internalized common reasoning pitfalls and has a complete map of the paper's structure with claim density annotations
**Depends on**: Nothing (first phase)
**Requirements**: PREP-01, PREP-02
**Success Criteria** (what must be TRUE):
  1. All 12 pitfalls from economics primer Section 9 are documented with notes on how each applies to specific paper sections
  2. Paper structure map exists listing every section/subsection with count of numerical claims, mechanism claims, and worked examples
  3. Section clusters for Phases 2-4 are validated against actual claim density (not just assumed from instructions)
**Plans**: 1 plan

Plans:
- [x] 01-01-PLAN.md — Produce AUDIT-PREP.md with pitfall annotations and claim density map

### Phase 2: Number-Heavy Sections Audit
**Goal**: Every numerical claim and worked example in the most number-dense sections is verified against contract source and audit docs
**Depends on**: Phase 1
**Requirements**: NUM-01, NUM-02, NUM-03, MECH-03, MECH-06, ARITH-01
**Success Criteria** (what must be TRUE):
  1. Every BPS value, ETH amount, pool target, and timing constant in SS6 (BURNIE Economics 6.1-6.3) is verified against v1.1-burnie-coinflip.md, v1.1-burnie-supply.md, and parameter reference
  2. Every death clock duration, terminal payout formula, and endgame worked example in SS8 (Failure Modes 8.1-8.4) is verified against v1.1-endgame-and-activity.md and contracts
  3. Every stress test calculation in SS9 (9.1-9.3) including terminal paradox math is re-derived from contract parameters, with the known pre-drawdown futurepool issue confirmed or resolved
  4. Every parameter value in Appendix A matches parameter reference; every jackpot number in Appendix B matches v1.1-jackpot-phase-draws.md; every model input in Appendix C and bear market figure in Appendix E is traceable to source
  5. All discrepancies found are logged with section location, claimed value, correct value, source of truth, and severity
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Audit SS6 BURNIE Economics (pricing table, decimator, 100-level cycle)
- [x] 02-02-PLAN.md — Audit SS8 Failure Modes and SS9 Stress Tests (death spiral resistance, bear market, terminal paradox re-derivation)
- [x] 02-03-PLAN.md — Audit Appendix A, B, C, E (parameter summary, jackpot distribution, model detail, bear market formal)

### Phase 3: Mechanism-Heavy Sections Audit
**Goal**: Every mechanism description and formula in the mechanism design and equilibrium sections is verified against contract implementation
**Depends on**: Phase 1
**Requirements**: MECH-01, MECH-02, MECH-04, ARITH-02, NUM-04
**Success Criteria** (what must be TRUE):
  1. Every pool architecture claim in SS4 (Mechanism Design 4.1-4.3) including flow paths, transition triggers, freeze conditions, and drawdown mechanics matches v1.1-pool-architecture.md and contracts
  2. Every jackpot and prize distribution claim (daily drip percentages, 5-day draw mechanics, BAF, decimator) matches v1.1-purchase-phase-distribution.md, v1.1-jackpot-phase-draws.md, v1.1-transition-jackpots.md
  3. Every activity score component, EV curve, threshold, ratio, and multiplier in SS5 (Equilibrium 5.1-5.5) matches v1.1-endgame-and-activity.md and contracts
  4. Every formula and equation in SS4/SS5 is checked against the equivalent contract logic, with any simplifications or approximations flagged
  5. All discrepancies found are logged with section location, claimed mechanism, correct mechanism, source of truth, and severity
**Plans**: 2 plans

Plans:
- [ ] 03-01-PLAN.md — Audit SS4 Mechanism Design (solvency invariant, zero-rake property, permissionless execution)
- [ ] 03-02-PLAN.md — Audit SS5 Equilibrium Analysis and Appendix D Attack Vectors (active participation, commitment devices, five attack vectors)

### Phase 4: Prose and Framing Sections Audit
**Goal**: Every numerical claim and mechanism reference in the framing/argument sections is verified, even where prose dominates
**Depends on**: Phase 1
**Requirements**: MECH-05
**Success Criteria** (what must be TRUE):
  1. Every number cited in SS1 (Intro), SS2 (Cross-Subsidy 2.1-2.6), and SS3 (Player Types 3.1-3.6) is traced to its source section or audit doc and confirmed correct
  2. Every affiliate, deity, whale pass, and lootbox mechanic referenced in SS2/SS3 matches v1.1-affiliate-system.md, v1.1-deity-system.md, v1.1-level-progression.md, v1.1-quest-rewards.md
  3. Every claim in SS7 (Robustness 7.1-7.2), SS10 (Growth), SS11 (Conclusion), and Appendix F (Misreadings) that cites specific numbers or mechanisms is verified against the stated source
  4. All discrepancies found are logged with section location, claimed value/mechanism, correct value/mechanism, source of truth, and severity
**Plans**: TBD

Plans:
- [ ] 04-01: Audit SS1-SS3 (Intro, Cross-Subsidy, Player Types)
- [ ] 04-02: Audit SS7, SS10-SS11, Appendix F (Robustness, Growth, Conclusion, Misreadings)

### Phase 5: Cross-Section Consistency and Report
**Goal**: Internal consistency across all sections is validated and the complete audit report is compiled at theory/AUDIT-REPORT.md
**Depends on**: Phase 2, Phase 3, Phase 4
**Requirements**: XREF-01, XREF-02, RPT-01, RPT-02
**Success Criteria** (what must be TRUE):
  1. Every cross-reference between sections is checked (where Section N assumes a number or mechanism stated in Section M, both agree)
  2. Appendix parameter tables are confirmed consistent with every in-text citation of those parameters
  3. theory/AUDIT-REPORT.md exists with every finding organized by section, each including: location (section + paragraph), claimed value/mechanism, correct value/mechanism per source of truth, severity (WRONG/STALE/IMPRECISE/MISSING-CONTEXT), and sketched fix
  4. Report includes a summary table with finding counts by severity and by section
**Plans**: TBD

Plans:
- [ ] 05-01: Cross-section consistency check
- [ ] 05-02: Compile and write AUDIT-REPORT.md

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5
Note: Phases 2, 3, and 4 depend only on Phase 1 (not on each other) and could run in parallel.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Preparation | 1/1 | Complete | 2026-03-16 |
| 2. Number-Heavy Sections Audit | 3/3 | Complete | 2026-03-16 |
| 3. Mechanism-Heavy Sections Audit | 0/2 | Not started | - |
| 4. Prose and Framing Sections Audit | 0/2 | Not started | - |
| 5. Cross-Section Consistency and Report | 0/2 | Not started | - |
