// JackpotWhalePassWin is declared in TWO game modules with one topic0 (audit 4254a877): the
// JackpotModule copy names the count `halfPassCount`, WhaleModule's (sources 4 early-bird /
// 5 quadrant) names it `halfPasses`. Whichever copy a decoder picks, the row must keep its count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jackpotWin } from '../../chain/jackpots.js';

const base = { name: 'JackpotWhalePassWin', blockNumber: 1, transactionHash: `0x${'1'.repeat(64)}` };
for (const [field, source] of [['halfPassCount', 2], ['halfPasses', 5]]) {
  test(`JackpotWhalePassWin keeps its count when decoded as ${field}`, () => {
    const row = jackpotWin({ ...base, args: { winner: `0x${'a'.repeat(40)}`, [field]: 4n, source } });
    assert.equal(row.awardType, 'whale_pass');
    assert.equal(row.amount, '4');
    assert.equal(String(row.halfPassCount), '4');
  });
}
