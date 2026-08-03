# Degenerus Protocol — Website & Papers Repo

## Economics Reference

**CRITICAL: The ONLY source of truth for Degenerus contract code and economics is `/home/zak/Dev/PurgeGame/degenerus-audit/contracts/`. NEVER read contracts from `degenerus-contracts/` or `testing/contracts/` as they are stale and will give you wrong numbers.**

The old v1.1 economics primer and subsystem docs (`audit/v1.1-*.md`) no longer exist. Any question about how a mechanism works: read the contracts. Papers and site content get corrected to match contracts, never the reverse without asking.

## Writing & Editing Rules

When editing the whitepaper or game theory paper:
- Do NOT add unnecessary context about internal mechanics changes.
- Do NOT duplicate content across sections.
- Do NOT add teaser sentences ("as we will see in Section X...").
- Keep edits precise and minimal. Don't rewrite surrounding prose unless asked.
- Verify all numbers against contract source before writing.
- Do NOT flag or soften precise technical language just because it resembles marketing buzzwords when used loosely elsewhere. If a term describes exactly what the mechanism does, it's the right word. "Zero-rake" means zero rake. "Trustless" means trustless. Don't add disclaimers because other projects misuse these terms. Standard technical vocabulary ("incentive structure," "mechanism design," "Nash equilibrium") belongs in a game theory paper. Don't flag it as jargon.

## Agent Review Instructions

When spawning review agents (degen-skeptic, protocol-advocate, readability-reviewer, etc.), instruct them to verify mechanics against contract source before making suggestions. Degenerus is both a financial protocol and an entertainment product. Different sections emphasize different aspects. Agents should match the framing of the section they're reviewing rather than imposing one lens everywhere.
