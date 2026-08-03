import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement ||= class {};
globalThis.document ||= {
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
};
globalThis.customElements ||= {
  _items: new Map(),
  define(name, ctor) { this._items.set(name, ctor); },
  get(name) { return this._items.get(name); },
};

const { historicalLootboxReplayRows } = await import('../app-day-history-replays.js');

describe('historical day reward reconstruction', () => {
  test('groups the selected player/day into one settled replay per opening transaction', () => {
    const player = `0x${'a'.repeat(40)}`;
    const rows = [
      {
        player, legType: 'opened', lootboxIndex: 8, transactionHash: '0xfeed',
        blockNumber: 105, logIndex: 2, ord: 105_000_002,
        rewardData: {
          amount: '100', futureLevel: 9, futureTickets: 2,
          roundedUp: false, flip: '25',
        },
      },
      {
        player, legType: 'spin', lootboxIndex: null, transactionHash: '0xfeed',
        blockNumber: 105, logIndex: 3, ord: 105_000_003,
        spin: {
          spinType: 'flip', spinCount: 1, survived: true, payout: '50',
          reels: [{ spinIndex: 0, score: 1, playerTraits: [], resultTraits: [] }],
        },
      },
      {
        player, legType: 'opened', lootboxIndex: 7, transactionHash: '0xold',
        blockNumber: 90, logIndex: 1, ord: 90_000_001,
        rewardData: { amount: '5', futureTickets: 0, flip: '0' },
      },
      {
        player: `0x${'b'.repeat(40)}`, legType: 'opened', lootboxIndex: 9,
        transactionHash: '0xother', blockNumber: 105, logIndex: 4, ord: 105_000_004,
        rewardData: { amount: '5', futureTickets: 0, flip: '0' },
      },
    ];

    const result = historicalLootboxReplayRows(rows, {
      player,
      day: 12,
      startBlock: 100,
      endBlock: 110,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'history:12:lootbox:0xfeed:2');
    assert.equal(result[0].sequence.kind, 'lootbox');
    assert.equal(result[0].sequence.settledExpected, true);
    assert.equal(result[0].sequence.legs.length, 2,
      'same-transaction companion reels stay attached to the box result');
  });

  test('can exclude a Degenerette settlement transaction to prevent duplicate boxes', () => {
    const player = `0x${'a'.repeat(40)}`;
    const rows = [{
      player, legType: 'opened', lootboxIndex: 8, transactionHash: '0xdeg',
      blockNumber: 105, logIndex: 2, ord: 105_000_002,
      rewardData: { amount: '100', futureTickets: 0, flip: '0' },
    }];
    assert.deepEqual(historicalLootboxReplayRows(rows, {
      player, day: 12, startBlock: 100, endBlock: 110,
      excludedTransactions: new Set(['0xdeg']),
    }), []);
  });

  test('splits a many-box catch-up transaction at each terminal opening event', () => {
    const player = `0x${'a'.repeat(40)}`;
    const transactionHash = `0x${'c'.repeat(64)}`;
    const rows = Array.from({ length: 40 }, (_, index) => {
      const rewardLog = index * 2 + 1;
      const openedLog = rewardLog + 1;
      return [{
        uid: `reward-${index}`,
        player,
        legType: 'dgnrs',
        transactionHash,
        blockNumber: 105,
        logIndex: rewardLog,
        ord: 105_000_000 + rewardLog,
        rewardData: { dgnrsAmount: String(index + 1) },
      }, {
        uid: `opened-${index}`,
        player,
        legType: 'opened',
        lootboxIndex: 0,
        transactionHash,
        blockNumber: 105,
        logIndex: openedLog,
        ord: 105_000_000 + openedLog,
        rewardData: {
          amount: '100', futureLevel: 12, futureTickets: 0,
          roundedUp: false, flip: '0',
        },
      }];
    }).flat();

    const result = historicalLootboxReplayRows(rows, {
      player,
      day: 12,
      startBlock: 100,
      endBlock: 110,
    });

    assert.equal(result.length, 40, 'each settlement remains a distinct replay row');
    assert.ok(result.every((row) => row.sequence.legs.length === 2),
      'no row absorbs the other 39 boxes from the same transaction');
    assert.deepEqual(result[19].sequence.legs.map((leg) => leg.legType), ['dgnrs', 'opened']);
    assert.equal(result[19].sequence.legs[0].amount, 20n);
  });

  test('exact pack anchors select only their own openings inside a shared transaction', () => {
    const player = `0x${'a'.repeat(40)}`;
    const transactionHash = `0x${'d'.repeat(64)}`;
    const rows = [1, 2, 3].flatMap((number) => [{
      player, legType: 'dgnrs', transactionHash, blockNumber: 105,
      logIndex: number * 2 - 1, rewardData: { dgnrsAmount: String(number) },
    }, {
      player, legType: 'opened', lootboxIndex: number, transactionHash, blockNumber: 105,
      logIndex: number * 2,
      rewardData: { amount: '100', futureTickets: 0, flip: '0' },
    }]);

    const result = historicalLootboxReplayRows(rows, {
      player,
      day: 12,
      wantedTransactions: new Set([transactionHash]),
      wantedAnchors: new Map([[transactionHash, new Set([4])]]),
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].lootboxIndex, 2);
    assert.equal(result[0].sequence.legs[0].amount, 2n,
      'the selected anchor does not inherit rewards from the prior opening');
  });
});
