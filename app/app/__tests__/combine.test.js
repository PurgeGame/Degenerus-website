// /app/app/__tests__/combine.test.js — combined-view merge util (account-switcher CORE layer).
//
// Run: cd website && node --test app/app/__tests__/combine.test.js
//
// Covers mergePlayerPayloads:
//   - SUM wei-denominated strings with BigInt (no float precision loss)
//   - CONCAT tickets[] + terminal.burns[] with owner tags
//   - IDENTITY fields (quests/questStreak/scoreBreakdown/affiliate/degenerette) omitted
//   - decimator.claimablePerLevel per-level sum; futurePoolTotal GLOBAL (first, not summed)
//   - addresses[] + perAddress{} round-trip; null/failed payloads ignored
//
// Pure JS (no DOM).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mergePlayerPayloads } from '../combine.js';

const A = '0xaaaa000000000000000000000000000000000001';
const B = '0xbbbb000000000000000000000000000000000002';

// A big wei value that overflows Number precision — proves BigInt folding.
const BIG = '1000000000000000000000'; // 1000 ETH in wei

function payload(addr, over = {}) {
  return {
    player: addr,
    claimableEth: '0',
    flipBalance: '0',
    dgnrsBalance: '0',
    currentStreak: 3,            // identity
    quests: [{ day: 1 }],        // identity
    questStreak: { baseStreak: 5 }, // identity
    scoreBreakdown: { totalBps: 100 }, // identity
    affiliate: { code: 'X' },    // identity
    degenerette: { betNonce: 2 }, // identity
    coinflip: null,
    decimator: { windowOpen: false, activityScore: 0, claimablePerLevel: [], futurePoolTotal: '800' },
    terminal: null,
    tickets: [],
    ...over,
  };
}

describe('mergePlayerPayloads — SUM wei balances', () => {
  test('sums claimableEth / flipBalance / dgnrsBalance as BigInt decimal strings', () => {
    const merged = mergePlayerPayloads([
      payload(A, { claimableEth: BIG, flipBalance: '100', dgnrsBalance: '7' }),
      payload(B, { claimableEth: BIG, flipBalance: '250', dgnrsBalance: '0' }),
    ]);
    assert.equal(merged.claimableEth, '2000000000000000000000');
    assert.equal(merged.flipBalance, '350');
    assert.equal(merged.dgnrsBalance, '7');
    assert.equal(typeof merged.claimableEth, 'string');
  });

  test('tolerates numbers, null, and empty strings', () => {
    const merged = mergePlayerPayloads([
      payload(A, { claimableEth: 5, flipBalance: null }),
      payload(B, { claimableEth: '', flipBalance: '10' }),
    ]);
    assert.equal(merged.claimableEth, '5');
    assert.equal(merged.flipBalance, '10');
  });
});

describe('mergePlayerPayloads — coinflip nested sum + identity omission', () => {
  test('sums coinflip.depositedAmount + claimablePreview; drops autoRebuy*/biggestFlip*', () => {
    const merged = mergePlayerPayloads([
      payload(A, { coinflip: { depositedAmount: '100', claimablePreview: '5', autoRebuyEnabled: true, biggestFlipAmount: '999' } }),
      payload(B, { coinflip: { depositedAmount: '200', claimablePreview: '3', autoRebuyEnabled: false, biggestFlipAmount: '111' } }),
    ]);
    assert.equal(merged.coinflip.depositedAmount, '300');
    assert.equal(merged.coinflip.claimablePreview, '8');
    assert.equal('autoRebuyEnabled' in merged.coinflip, false);
    assert.equal('biggestFlipAmount' in merged.coinflip, false);
  });

  test('coinflip null when no account has coinflip data', () => {
    const merged = mergePlayerPayloads([payload(A), payload(B)]);
    assert.equal(merged.coinflip, null);
  });
});

describe('mergePlayerPayloads — decimator per-level sum + global futurePool', () => {
  test('sums ethAmount + lootboxCount per level; futurePoolTotal taken (not summed)', () => {
    const merged = mergePlayerPayloads([
      payload(A, {
        decimator: {
          futurePoolTotal: '800',
          claimablePerLevel: [
            { level: 1, ethAmount: '100', lootboxCount: 2, claimed: false },
            { level: 2, ethAmount: '50', lootboxCount: 1, claimed: true },
          ],
        },
      }),
      payload(B, {
        decimator: {
          futurePoolTotal: '800',
          claimablePerLevel: [
            { level: 1, ethAmount: '300', lootboxCount: 3, claimed: false },
          ],
        },
      }),
    ]);
    // futurePoolTotal is GLOBAL — first value, NOT 1600
    assert.equal(merged.decimator.futurePoolTotal, '800');
    const lvl1 = merged.decimator.claimablePerLevel.find((r) => Number(r.level) === 1);
    const lvl2 = merged.decimator.claimablePerLevel.find((r) => Number(r.level) === 2);
    assert.equal(lvl1.ethAmount, '400');
    assert.equal(lvl1.lootboxCount, 5);
    assert.equal(lvl1.claimed, false);
    assert.equal(lvl2.ethAmount, '50');
    assert.equal(lvl2.claimed, true); // only B lacks it; A had it claimed → all-claimed
  });

  test('level rows are ascending', () => {
    const merged = mergePlayerPayloads([
      payload(A, { decimator: { futurePoolTotal: '0', claimablePerLevel: [
        { level: 3, ethAmount: '1', lootboxCount: 0, claimed: false },
        { level: 1, ethAmount: '1', lootboxCount: 0, claimed: false },
      ] } }),
    ]);
    const levels = merged.decimator.claimablePerLevel.map((r) => Number(r.level));
    assert.deepEqual(levels, [1, 3]);
  });
});

describe('mergePlayerPayloads — CONCAT with owner tags', () => {
  test('tickets concatenated and tagged with lowercased owner', () => {
    const merged = mergePlayerPayloads([
      payload(A, { tickets: [{ level: 1, entryCount: 4 }] }),
      payload(B, { tickets: [{ level: 1, entryCount: 8 }, { level: 2, entryCount: 4 }] }),
    ]);
    assert.equal(merged.tickets.length, 3);
    assert.equal(merged.tickets[0].owner, A);
    assert.equal(merged.tickets[1].owner, B);
    assert.equal(merged.tickets[2].owner, B);
    assert.equal(merged.tickets[0].entryCount, 4);
  });

  test('terminal.burns concatenated + owner-tagged; null when none', () => {
    const withBurns = mergePlayerPayloads([
      payload(A, { terminal: { burns: [{ level: 5, effectiveAmount: '10' }] } }),
      payload(B),
    ]);
    assert.equal(withBurns.terminal.burns.length, 1);
    assert.equal(withBurns.terminal.burns[0].owner, A);

    const noBurns = mergePlayerPayloads([payload(A), payload(B)]);
    assert.equal(noBurns.terminal, null);
  });
});

describe('mergePlayerPayloads — identity omission + addresses/perAddress', () => {
  test('per-account identity fields are NOT present on the merged root', () => {
    const merged = mergePlayerPayloads([payload(A), payload(B)]);
    for (const k of ['quests', 'questStreak', 'scoreBreakdown', 'affiliate', 'degenerette', 'currentStreak']) {
      assert.equal(k in merged, false, `${k} must be omitted from merged root`);
    }
  });

  test('addresses[] + perAddress{} preserve raw payloads for drill-in', () => {
    const pa = payload(A, { flipBalance: '1' });
    const pb = payload(B, { flipBalance: '2' });
    const merged = mergePlayerPayloads([pa, pb]);
    assert.deepEqual(merged.addresses, [A, B]);
    assert.equal(merged.perAddress[A], pa);
    assert.equal(merged.perAddress[B], pb);
  });

  test('null / undefined / non-object payloads are ignored', () => {
    const merged = mergePlayerPayloads([payload(A, { flipBalance: '5' }), null, undefined, 42]);
    assert.equal(merged.addresses.length, 1);
    assert.equal(merged.flipBalance, '5');
  });

  test('empty input yields a well-formed zero aggregate', () => {
    const merged = mergePlayerPayloads([]);
    assert.deepEqual(merged.addresses, []);
    assert.equal(merged.claimableEth, '0');
    assert.equal(merged.coinflip, null);
    assert.equal(merged.terminal, null);
    assert.deepEqual(merged.tickets, []);
    assert.deepEqual(merged.decimator.claimablePerLevel, []);
  });
});
