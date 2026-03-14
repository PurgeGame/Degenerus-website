# Degenerus Protocol — Website & Papers Repo

## Economics Reference (v1.1 Contract Audit)

**CRITICAL: The ONLY source of truth for Degenerus contract code is `/home/zak/Dev/PurgeGame/degenerus-audit/contracts/`. NEVER read contracts from `degenerus-contracts/` or `testing/contracts/` as they are stale and will give you wrong numbers.**

The audit repo at `/home/zak/Dev/PurgeGame/degenerus-audit/` contains verified economic flow documentation derived from contract source. When writing about, analyzing, or reasoning about protocol economics:

1. **Start with the primer:** Read `/home/zak/Dev/PurgeGame/degenerus-audit/audit/v1.1-ECONOMICS-PRIMER.md` (286 lines). Covers the complete economic model with enough detail for reasoning.

2. **Drill into source files** when you need exact Solidity expressions, worked examples, or edge cases. The primer's Document Index table maps topics to files.

3. **Parameter lookups:** `/home/zak/Dev/PurgeGame/degenerus-audit/audit/v1.1-parameter-reference.md` has every BPS/ETH/timing constant with contract file + line citations.

4. **Critical pitfalls:** Section 9 of the primer lists 12 common reasoning errors. Read before making economic claims.

### Quick Reference

All files at `/home/zak/Dev/PurgeGame/degenerus-audit/audit/`:

| File | Topic |
|------|-------|
| `v1.1-ECONOMICS-PRIMER.md` | Complete overview (start here) |
| `v1.1-parameter-reference.md` | All ~200+ constants with exact values |
| `v1.1-eth-inflows.md` | 9 purchase paths, cost formulas, pool splits |
| `v1.1-pool-architecture.md` | Pool lifecycle, freeze, level advancement |
| `v1.1-purchase-phase-distribution.md` | Daily drip, BURNIE jackpots |
| `v1.1-jackpot-phase-draws.md` | 5-day draws, trait buckets, winners |
| `v1.1-transition-jackpots.md` | BAF & Decimator mechanics |
| `v1.1-burnie-coinflip.md` | Coinflip odds, payout tiers, recycling |
| `v1.1-burnie-supply.md` | BURNIE supply dynamics, vault, burns |
| `v1.1-level-progression.md` | Price curve, whale/lazy pass economics |
| `v1.1-endgame-and-activity.md` | Activity score, death clock, terminal payouts |
| `v1.1-dgnrs-tokenomics.md` | DGNRS token distribution, soulbound rules |
| `v1.1-deity-system.md` | Deity passes, boons, pricing curve |
| `v1.1-affiliate-system.md` | 3-tier referral, taper, DGNRS claims |
| `v1.1-steth-yield.md` | stETH yield integration |
| `v1.1-quest-rewards.md` | Quest types, streak system, slot mechanics |

### When to use what

- **Writing whitepaper sections:** Primer first, then drill into the specific subsystem file for exact numbers
- **Game theory analysis:** Primer + endgame-and-activity + transition-jackpots + burnie-supply
- **Economic modeling:** Primer + parameter-reference (all constants in one place)
- **Skeptic/advocate review:** Primer's pitfalls section + relevant subsystem files for verification
- **Player-facing content:** Primer is sufficient for most explanations
