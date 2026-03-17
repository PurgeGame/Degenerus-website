---
phase: 05-cross-section-consistency-and-report
plan: 01
subsystem: cross-reference-audit
tags: [cross-reference, consistency, parameter-validation, inter-section-audit]

requires:
  - phase: 02-number-heavy-sections-audit
    provides: "SS6, SS8, SS9, Appendix A/B/C/E audit findings"
  - phase: 03-mechanism-heavy-sections-audit
    provides: "SS4, SS5, Appendix D audit findings"
  - phase: 04-prose-and-framing-sections-audit
    provides: "SS1-SS3, SS7, SS10, SS11, Appendix F audit findings"
provides:
  - "Cross-reference consistency validation across all 8 clusters"
  - "3 cross-section issues confirmed: DGNRS appendix re-cites '4 tickets' (new location), F.10 re-cites SS9.3 cascade values, F.6 contradicts SS3.4"
  - "Appendix A parameter spot-checks completed"
affects: [05-02-PLAN]

tech-stack:
  added: []
  patterns: [cross-reference-cluster-validation, inter-section-consistency-check]

key-files:
  created:
    - .planning/phases/05-cross-section-consistency-and-report/05-01-SUMMARY.md
  modified: []

key-decisions:
  - "F.10 re-cites SS9.3 cascade values (~1,074 ETH, 0.15 ETH/ticket, 1.8x) but is internally consistent with SS9.3 (both wrong the same way)"
  - "DGNRS appendix line 4784 is a third location citing '4 tickets per level' (SS4.2 lines 2915 and 2919 were the only two known locations from Phase 3)"
  - "All stETH yield 50/25/25 citations are internally consistent (all imprecise the same way across 8+ locations)"
  - "Jackpot compression threshold inconsistency (Appendix A '<3 days' vs B.1 '<=2 days') is confined to appendices, not re-cited in main text"
  - "The known set of cross-section issues is complete with one new location added (DGNRS appendix '4 tickets')"

patterns-established:
  - "Cross-reference audit: check whether imprecise values propagate consistently or inconsistently across sections"

requirements-completed: [XREF-01, XREF-02]

duration: 12min
completed: 2026-03-17
---

# Phase 5 Plan 01: Cross-Section Consistency Check Summary

**8 cross-reference clusters validated across all paper sections: 4 CONSISTENT, 3 INCONSISTENT (KNOWN), 1 NOT APPLICABLE. One new finding: DGNRS appendix (line 4784) re-cites the incorrect "4 tickets per level" value not previously flagged.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-17T00:15:58Z
- **Completed:** 2026-03-17T00:27:58Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Validated all 8 cross-reference clusters identified in Phase 5 research
- Confirmed stETH yield 50/25/25 is internally consistent across 8+ paper locations (all imprecise the same way)
- Confirmed SS9.3 cascade (800 vs 680) propagates into F.10 but is internally consistent with SS9.3
- Discovered one new cross-reference location: DGNRS appendix line 4784 re-cites "4 tickets per level" (the incorrect value from SS4.2, contract says 16)
- Spot-checked 6 high-impact Appendix A parameter rows against in-text citations
- Confirmed the known set of findings from Phases 2-4 is complete (no previously undetected cross-section contradictions)

---

## Cluster 1: stETH Yield Split (46/23/23 vs 50/25/25)

**Result: CONSISTENT (all locations cite 50/25/25 uniformly)**

All locations checked cite the same imprecise values. No location in the paper says 46/23/23. The imprecision is uniform, meaning there is no internal contradiction. All are wrong the same way.

| Location | Line | Value Cited | Notes |
|----------|------|-------------|-------|
| SS4.1 (yield routing) | 2890-2891 | 25% vault, 25% DGNRS, 50% accumulator | Three separate percentage claims |
| SS4.2 (Corollary 4.4) | 2943-2947 | coefficient 0.50, "50% accrues in segregated accumulator", "25% vault", "25% DGNRS" | Full re-citation in formula explanation |
| SS8.2 (death spiral resistance) | 3382 | "50% of stETH yield (continuous)" | Single percentage in terminal insurance discussion |
| SS9.1 (bear market) | 3679 | "player-facing 50%" | Single percentage in mechanical defenses |
| Appendix A (parameter table) | 4282-4283 | "50/25/25% accumulator/vault/DGNRS" | Explicit combined split |
| Appendix C (formal model) | 4605 | "50% accrues to the segregated accumulator... 25% to the vault" | Re-citation in formal framework |
| Appendix F.1 | 5148 | "50% of total yield, via the segregated accumulator" | Re-citation in misreadings section |
| Appendix F.2 | 5173-5175 | "50% of stETH yield goes to the vault (25%) and DGNRS holders (25%)... remaining 50% accrues in a segregated accumulator" | Full re-citation |

**Cross-phase reference:** Root finding documented in Phase 2 (02-02-SUMMARY Claim 2, 02-03-SUMMARY). Actual BPS are 4600/2300/2300 with ~800 buffer. All 8 locations are IMPRECISE identically. No internal contradiction.

---

## Cluster 2: SS9.3 Terminal Paradox Cascade (800 vs 680)

**Result: CONSISTENT (all locations cite the same pre-drawdown values)**

SS9.3 (lines 3867-3909) uses 800 ETH as the starting futurepool and derives all downstream values from it. The 13 cascaded values (including ~1,074 ETH total assets, 0.146 ETH/ticket, 1.8x payout ratio, ~239 ETH residual futurepool, ~701 ETH nextpool) all derive from the 800 starting point.

Appendix F.10 (lines 5462-5464) re-cites: "at level 50 with ~1,074 ETH in non-obligated assets (including ~125 ETH in deposit insurance), terminal share per ticket is approximately 0.15 ETH against a ticket cost of 0.08 ETH. This is a 1.8x payout ratio."

These values are internally consistent with SS9.3's derivation. F.10 does not introduce new numbers. It repeats SS9.3's cascade values verbatim. Both sections are wrong the same way (pre-drawdown starting point should be ~680, not 800).

No other section re-cites specific SS9.3 numerical values. SS7, SS8, SS10, and SS11 reference the terminal paradox conceptually (citing "Section 9.3") but do not re-derive or re-cite specific ETH amounts.

**Cross-phase reference:** Root finding documented in Phase 2 (02-02-SUMMARY). The root cause is 800 ETH pre-drawdown vs 680 ETH post-drawdown. All 13 downstream mismatches cascade from this single root. Qualitative conclusions unaffected.

---

## Cluster 3: BAF Scatter Percentage (60% vs 70%)

**Result: INCONSISTENT (KNOWN) -- Appendix A contradicts Appendix B.3**

| Location | Value | Correct? |
|----------|-------|----------|
| Appendix A line 4409 | "60% (40% + 20%)" | WRONG. Actual is 70% (45% + 25%) |
| Appendix B.3 line 4468-4469 | "45% + 25%" = 70% | CORRECT |
| SS2.5 line 2553 | "remaining 80%" (non-leaderboard) | CORRECT (80% = 10% far-future + 70% scatter) |

The 60% vs 70% discrepancy is confined to Appendix A's parameter row vs Appendix B.3's detailed breakdown. No main-text section (SS1-SS11) cites "60% scatter." SS2.5 correctly says "remaining 80%" which encompasses both scatter and far-future draws. The incorrect 60% figure does not propagate outside Appendix A.

**Cross-phase reference:** Found in Phase 2 (02-03-SUMMARY). BAF scatter is 45% (E1) + 25% (E2) = 70%, not 40% + 20% = 60%. Appendix A needs correction.

---

## Cluster 4: Vault/DGNRS Ticket Count (4 vs 16)

**Result: INCONSISTENT (KNOWN, with one NEW location)**

| Location | Value | Correct? |
|----------|-------|----------|
| SS4.2 line 2915 | "4 tickets per level" (DGNRS) | WRONG. Contract: VAULT_PERPETUAL_TICKETS = 16 |
| SS4.2 line 2918 | "4 tickets per level" (vault deity pass) | WRONG. Contract: VAULT_PERPETUAL_TICKETS = 16 |
| DGNRS appendix line 4784 | "4 tickets per level" (DGNRS holders) | WRONG. Same incorrect value re-cited |

Phase 3 (03-01-SUMMARY) identified the two SS4.2 instances. The DGNRS appendix section (line 4784) is a **third location** citing "4 tickets per level" that was not previously flagged. This is a new cross-reference finding.

No other sections cite a specific ticket count for vault/DGNRS perpetual tickets. The error is confined to these three locations, all citing the same incorrect value.

### NEW Cross-Reference Finding

| Field | Value |
|-------|-------|
| **Location** | DGNRS appendix, line 4784 |
| **Claimed** | "4 tickets per level" for DGNRS holders |
| **Correct** | 16 tickets per level (VAULT_PERPETUAL_TICKETS = 16, AdvanceModule.sol:99) |
| **Source** | AdvanceModule.sol:99,1109-1110 |
| **Severity** | MEDIUM (same as SS4.2 instances, same root value) |
| **Fix** | Change "4 tickets per level" to "16 tickets per level" in all three locations |

---

## Cluster 5: Jackpot Large Winner Split (F.6 vs SS3.4 vs SS5.5)

**Result: INCONSISTENT (KNOWN) -- F.6 contradicts SS3.4 and the contract**

| Location | Mechanic Described | Split Cited | Correct? |
|----------|-------------------|-------------|----------|
| SS3.4 line 2743 | BAF large winners | "half their payout as ETH and half as whale passes" (50/50) | CORRECT |
| SS5.5 line 3132-3134 | BAF large winners | "receive 50% ETH and 50% as lootbox tickets, which convert to whale passes" | CORRECT |
| SS5.5 line 3132 | Daily jackpot solo bucket winners | "75% ETH and 25% as whale passes" (in forced equity device) | CORRECT (different mechanic) |
| F.6 line 5315-5316 | "the largest single jackpot winners" (context: commitment devices) | "approximately 75% of their payout in ETH and 25% as whale passes" | WRONG |

F.6's context discusses "the largest single jackpot winners" and their forced equity conversion. In the F.6 paragraph, the 75/25 split is attributed to "the largest single jackpot winners" generically. The paper's own SS3.4 (line 2743) and SS5.5 (line 3134) correctly state 50/50 for BAF large winners. The daily jackpot solo bucket 75/25 split (SS5.5 line 3132) is a different mechanic for a different payout type.

The confusion is that F.6 appears to conflate the daily jackpot solo bucket 75/25 split with the BAF large winner 50/50 split. The two mechanics have different payout structures:
- Daily jackpot solo bucket winners: 75% ETH / 25% whale passes (PayoutUtils solo bucket logic)
- BAF large winners: 50% ETH / 50% lootbox tickets (EndgameModule:348, ethPortion = amount / 2)

**Cross-phase reference:** Found in Phase 4 (04-02-SUMMARY). F.6 is WRONG. The paper internally contradicts itself (F.6 says 75/25, SS3.4 says 50/50 for the same BAF mechanic).

---

## Cluster 6: Affiliate Tier Fractions

**Result: NOT APPLICABLE (only cited in one location)**

F.11 (lines 5501-5503) is the only location in the paper that cites specific affiliate tier fraction percentages ("75% to the direct referrer, 20% to the referrer's referrer, and 5% to the third level up"). SS3.5 does not cite specific tier fractions (confirmed in Phase 4, 04-01-SUMMARY).

No cross-reference check is possible because the value appears in only one location. The F.11 claim itself is WRONG (tier 3 is 4% not 5%, per Phase 4 finding), but this is an accuracy issue, not a cross-section consistency issue.

**Cross-phase reference:** F.11 WRONG finding documented in Phase 4 (04-02-SUMMARY).

---

## Cluster 7: Death Clock and Terminal References

**Result: CONSISTENT (all citations agree)**

All citations of the 120-day death clock and terminal jackpot mechanics are internally consistent:

| Location | Claim | Consistent? |
|----------|-------|-------------|
| SS1 line 566 | "120 days" | Yes |
| SS5.4 line 3081 | "90% of all locked assets to next-level ticket holders" | Yes |
| SS7.1 (Death Spiral) | Terminal buying as dominant strategy | Yes (references SS9.3) |
| SS7.2 (Griefer Exit) | "GAMEOVER requires 120 days" (line 3321) | Yes |
| SS8.2 (Death Spiral Resistance) | "50% of stETH yield" accumulator inflows during stall (line 3382) | Yes (see Cluster 1) |
| SS8.4 (BURNIE Floor) | BURNIE appreciation as bear market defense | Yes (conceptual, no numerical re-citation) |
| SS9.1 (Bear Market) | "120 days" (line 3869), mechanical drip over 120 days | Yes |
| SS9.3 (Terminal Paradox) | "120 days" (line 3867-3869), full numerical derivation | Yes (root source, all 120-day references agree) |
| SS10/SS11 | Growth and resilience references | Yes (conceptual, no numerical re-citation) |
| Appendix A (parameter table) | "120 days" post-game timeout (line 4367) | Yes |
| Appendix E (Section E.7) | "120 days" (line 5055) | Yes |
| Appendix F.10 | Re-cites SS9.3 numbers (line 5462-5464) | Yes (consistent with SS9.3, both wrong the same way per Cluster 2) |
| Appendix F.13 | References "bear market analysis (Section 9.1)" conceptually, no specific numbers | Yes |

SS5.4's "90% of all locked assets to next-level ticket holders" (line 3081) is consistent with SS9.3's "90% of ~1,074 = ~967 ETH" (line 3889) and Appendix D's "terminal jackpot (90% of all remaining assets)" (line 4836). All correctly say 90% and correctly identify next-level ticket holders as the eligible population.

No death clock duration contradictions found. No section says a different timeout period. All terminal jackpot descriptions agree on 90% payout to next-level holders.

---

## Cluster 8: Appendix A Parameter Rows vs In-Text Citations

**Result: CONSISTENT (with 2 KNOWN discrepancies confined to appendices)**

### Spot-Check Results

| Parameter | Appendix A Value | In-Text Citations | Match? |
|-----------|-----------------|-------------------|--------|
| Ticket price range | 0.01-0.24 ETH (line 4337) | SS1 lines 731-761 (full table), SS6.1 (full table), Appendix E line 4544 | MATCH |
| Activity score range | [0, 3.05] (line 4289) | SS2.3 line 2378 "0 to 3.05", Appendix C line 4624 "[0, 3.05]" | MATCH |
| Lootbox EV range | [0.80, 1.35] (line 4295) | SS2.3 line 2380 "0.80x at zero activity to 1.35x at maximum", Appendix C line 4633 "[0.80, 1.35]" | MATCH |
| stETH yield split | 50/25/25% (line 4282) | See Cluster 1: all 8+ locations agree | MATCH (all imprecise identically) |
| BAF scatter share | 60% (line 4409) | Appendix B.3 says 45%+25%=70% | MISMATCH (KNOWN, Phase 2) |
| Jackpot compression | "3 if purchase phase < 3 days" (line 4404) | B.1 says "Compressed (purchase phase <= 2 days)" (line 4430) | MISMATCH (KNOWN, Phase 2) |
| Post-game timeout | 120 days (line 4367) | See Cluster 7: all locations agree | MATCH |
| Coinflip win payout mean | 1.9685x (line 4325) | SS3 cites "2x" in prose (IMPRECISE, Phase 4) | Appendix A is more precise than prose, no contradiction |

The Appendix A parameter table is internally consistent with in-text citations for all spot-checked parameters. The two known discrepancies (BAF scatter 60% vs B.3's 70%, and jackpot compression "< 3 days" vs B.1's "<= 2 days") are confined to Appendix A vs other appendices. Neither propagates into main-text sections.

### Jackpot Compression Detail

Appendix A (line 4404) says "3 if purchase phase < 3 days." Appendix B.1 (line 4430) says "Compressed (purchase phase <= 2 days): 3 physical days." The formal model (line 4671-4672) says "If the purchase phase lasted fewer than 3 days, the jackpot phase compresses to 3 days." These are describing the same boundary but with different inequality operators: "< 3 days" (A and formal model) vs "<= 2 days" (B.1). In practice these are equivalent for integer day counts (< 3 and <= 2 both mean 0, 1, or 2 days), so this is a notational inconsistency rather than a factual one. Already found in Phase 2 (02-03-SUMMARY).

---

## Summary of All Cross-Section Findings

| Cluster | Description | Result | New Finding? |
|---------|-------------|--------|--------------|
| 1 | stETH Yield Split (50/25/25 vs 46/23/23) | CONSISTENT | No. All 8+ locations imprecise identically. |
| 2 | SS9.3 Terminal Paradox Cascade (800 vs 680) | CONSISTENT | No. F.10 re-cites SS9.3 values, both wrong identically. |
| 3 | BAF Scatter Percentage (60% vs 70%) | INCONSISTENT (KNOWN) | No. Confined to Appendix A vs B.3. |
| 4 | Vault/DGNRS Ticket Count (4 vs 16) | INCONSISTENT (KNOWN + NEW location) | **Yes.** DGNRS appendix line 4784 is a third location citing "4 tickets." |
| 5 | Jackpot Large Winner Split (F.6 vs SS3.4) | INCONSISTENT (KNOWN) | No. F.6 contradicts SS3.4 and SS5.5. |
| 6 | Affiliate Tier Fractions | NOT APPLICABLE | No. Only cited in F.11 (no cross-reference possible). |
| 7 | Death Clock and Terminal References | CONSISTENT | No. All locations agree on 120 days and 90% terminal payout. |
| 8 | Appendix A Parameter Rows | CONSISTENT (2 known appendix-appendix mismatches) | No. All main-text citations match Appendix A. |

## Conclusion

**The known set of cross-section issues from Phases 2-4 is confirmed as essentially complete.** One new location was found: the DGNRS appendix (line 4784) re-cites the incorrect "4 tickets per level" value that Phase 3 flagged in SS4.2. This is the same root finding (VAULT_PERPETUAL_TICKETS = 16), not a new discrepancy type.

No previously undetected inter-section contradictions were found. The paper's internal cross-references are consistent in all cases except:
1. **F.6 vs SS3.4** (75/25 vs 50/50 for BAF large winners) -- already found in Phase 4
2. **Appendix A vs Appendix B.3** (60% vs 70% BAF scatter) -- already found in Phase 2
3. **Appendix A vs Appendix B.1** (< 3 days vs <= 2 days jackpot compression) -- already found in Phase 2, and effectively equivalent for integer day counts

Imprecise values (stETH yield 50/25/25, SS9.3 cascade from 800 ETH) propagate consistently. Where the paper is wrong, it is wrong the same way everywhere, making corrections straightforward (fix the source value and all re-citations update accordingly).

## Deviations from Plan

None. Plan executed exactly as written.

## Self-Check: PASSED

- [x] 05-01-SUMMARY.md exists
- [x] File contains sections for all 8 clusters (8 "Cluster" headings)
- [x] Contains "stETH Yield Split" (Cluster 1)
- [x] Contains "Terminal Paradox" and "800 vs 680" (Cluster 2)
- [x] Contains "BAF Scatter" and "60% vs 70%" (Cluster 3)
- [x] Contains "Ticket Count" and "4 vs 16" (Cluster 4)
- [x] Contains "Large Winner Split" and "F.6" (Cluster 5)
- [x] Contains "Affiliate Tier" and "F.11" (Cluster 6)
- [x] Contains "Death Clock" and "120 days" (Cluster 7)
- [x] Contains "Appendix A" and "Parameter Rows" (Cluster 8)
- [x] Each cluster has CONSISTENT, INCONSISTENT (KNOWN), INCONSISTENT (KNOWN + NEW location), or NOT APPLICABLE result
- [x] Conclusion states whether NEW inconsistencies were found
- [x] NEW finding (DGNRS appendix "4 tickets") has Location, Claimed, Correct, Source, Severity, Fix fields

---
*Phase: 05-cross-section-consistency-and-report*
*Completed: 2026-03-17*
