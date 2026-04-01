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

## Writing & Editing Rules

When editing the whitepaper or game theory paper:
- Do NOT add unnecessary context about internal mechanics changes.
- Do NOT duplicate content across sections.
- Do NOT add teaser sentences ("as we will see in Section X...").
- Keep edits precise and minimal. Don't rewrite surrounding prose unless asked.
- Verify all numbers against economics docs before writing.
- Do NOT flag or soften precise technical language just because it resembles marketing buzzwords when used loosely elsewhere. If a term describes exactly what the mechanism does, it's the right word. "Zero-rake" means zero rake. "Trustless" means trustless. Don't add disclaimers because other projects misuse these terms. Standard technical vocabulary ("incentive structure," "mechanism design," "Nash equilibrium") belongs in a game theory paper. Don't flag it as jargon.

## Agent Review Instructions

When spawning review agents (degen-skeptic, protocol-advocate, readability-reviewer, etc.), instruct them to read the economics primer before making suggestions. Degenerus is both a financial protocol and an entertainment product. Different sections emphasize different aspects. Agents should match the framing of the section they're reviewing rather than imposing one lens everywhere.
