Degenerette regression fixtures
==============================

`degenerette-run55-bet1.json` is the Base Sepolia chain feed for the reported
five-card bet, resolved in block 47272023. Its emitted first house ticket and
all five scores independently verify the ETH replay. It also includes the
record bounty event used to check the parent-bound seed and retained champion.

`degenerette-wwxrp-vectors.json` contains 80 tuples emitted by the current
`degenerus-audit/contracts/modules/DegenerusGameDegeneretteModule.sol` through
an inheriting Forge harness, September 25, 2026. Columns are input RNG word,
card index, champion symbol, emitted player traits, emitted house traits.
The RNG index is 538; words range from 1 to 80, symbols are word % 32, and
card indexes are word % 5. The draw word is hash2(word, WWXRP_DRAW_TAG).
The result seed uses the contract's packed 37/38-byte preimage; the player
seed is hash4(drawWord, 538, symbol, cardIndex). Calling `_rollSpin` with
currency 3 produces the last two columns. One vector exercises the correction;
the remaining vectors exercise unchanged house tickets. These expectations
were produced by Solidity, not the JavaScript implementation under test.

`degenerette-payout-vectors.json` holds 642 tuples `[currency, stakePerSpin,
activityScore, score, goldMatches, payout]` returned by
`DegeneretteMathHarness.payout` — the production `_degenerettePayout`. The
inputs were first drawn at degenerus-audit 224de529, September 26, 2026; the
payouts were regenerated September 29, 2026 at degenerus-audit 3c79c1486 (the
250,250x 9/9, 20,354x 8/9, re-weighted ETH bonus factors and WWXRP's own 8/9
prizes from 881ebb32d) from a `forge-out` artifact whose metadata source hashes
match that commit, deployed to a scratch anvil. 368 of the 642 changed. They
span ETH, FLIP and WWXRP, stakes from the 1,000-wei testnet ETH unit to 777
FLIP, activity 0 to 65,535, scores 0-9 and 0/1/4 matched golds.
DegeneretteResolved does not emit per-spin payouts, so the UI prices every
settled spin with `degeneretteSpinPayout`; these vectors pin it to the contract.

`degenerette-paid-stake-vectors.json` holds 168 rows `[betWord, paidUnits,
rawUnits, [amounts], [capped]]` from the same 3c79c1486 harness:
`paidStake(betWord)` in stake units and `capPaidPayout(betWord, amount)` for four
amounts straddling the 1,000,000x paid-stake ceiling. Bet words are built the way
placement builds them (boosted stake units, consumed boon tier 0-3 in bits
252..253) for ETH and FLIP at 1-25 spins. The harness is the mainnet module
(1-gwei ETH unit, 10 ETH boon cap), so ETH rows pin the recovered units; the
capped amounts are compared for FLIP, whose units are unscaled on both chains.
