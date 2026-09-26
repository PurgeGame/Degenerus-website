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
`DegeneretteMathHarness.payout` — the production `_degenerettePayout` — compiled
at degenerus-audit 224de529 (the prebuilt `forge-out` artifact, deployed to a
scratch anvil), September 26, 2026. They span ETH, FLIP and WWXRP, stakes from
the 1,000-wei testnet ETH unit to 777 FLIP, activity 0 to 65,535, scores 0-9 and
0/1/4 matched golds. DegeneretteResolved no longer emits per-spin payouts, so the
UI prices every settled spin with `degeneretteSpinPayout`; these vectors pin it to
the contract. The full 5,616-tuple run matched with zero mismatches.
