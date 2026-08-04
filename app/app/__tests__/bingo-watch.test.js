import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement = globalThis.HTMLElement || class HTMLElement {};
globalThis.customElements = globalThis.customElements || {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};
globalThis.document = globalThis.document || {
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
};
globalThis.localStorage = {
  _values: new Map(),
  getItem(key) { return this._values.get(String(key)) ?? null; },
  setItem(key, value) { this._values.set(String(key), String(value)); },
  removeItem(key) { this._values.delete(String(key)); },
  clear() { this._values.clear(); },
};

const { ethers } = await import('../contracts.js');
const pending = await import('../pending-actions.js');
const reveal = await import('../../components/reveal-overlay.js');
const bingo = await import('../bingo-watch.js');
const { CHAIN } = await import('../chain-config.js');

const PLAYER = '0xab12000000000000000000000000000000000000';
const ABI = [
  'event FirstQuadrantBingo(address indexed player, uint256 level, uint8 symbol)',
  'event FirstSymbolBingo(address indexed player, uint256 level, uint8 symbol)',
  'event BingoClaimed(address indexed player, uint256 level, uint8 symbol, uint256 flipReward, uint256 dgnrsPaid)',
];
const iface = new ethers.Interface(ABI);

const TEST_BLOCK = Number(CHAIN.deployBlock) + 100;

function log(name, args, { blockNumber = TEST_BLOCK, index = 1, tx = '0xabc' } = {}) {
  const event = iface.getEvent(name);
  const encoded = iface.encodeEventLog(event, args);
  return {
    address: '0x449ea82e870feb14a0f990ca7b1410a89c8851ac',
    blockNumber,
    index,
    transactionHash: tx,
    topics: encoded.topics,
    data: encoded.data,
  };
}

describe('bingo event watcher', () => {
  beforeEach(() => {
    localStorage.clear();
    pending.__resetPendingActionsForTest();
    reveal.__resetForTest();
    bingo.__resetBingoWatchForTest();
  });

  afterEach(() => bingo.__resetBingoWatchForTest());

  test('pairs a first-tier event with the universal paid receipt', () => {
    const logs = [
      log('FirstQuadrantBingo', [PLAYER, 27, 14], { index: 8, tx: '0xdef' }),
      log('BingoClaimed', [PLAYER, 27, 14, 5_000n * 10n ** 18n, 123n], {
        index: 9, tx: '0xdef',
      }),
    ];
    const rows = bingo.decodeBingoLogs(logs, PLAYER);
    assert.equal(rows.length, 1, 'the companion first event is not a duplicate reward');
    assert.equal(rows[0].tier, 'first-quadrant');
    assert.equal(rows[0].level, 27);
    assert.equal(rows[0].symbol, 14);
    assert.equal(rows[0].flipReward, String(5_000n * 10n ** 18n));
    assert.equal(rows[0].dgnrsPaid, '123');
  });

  test('chart counts retain inventory orientation: color*8 + symbol', () => {
    const payload = {
      cards: [{ entries: [
        { traitId: 2 },       // crypto, pink, SUI
        { traitId: 2 },
        { traitId: 10 },      // crypto, purple, SUI
        { traitId: 75 },      // zodiac; ignored
      ] }],
    };
    const counts = bingo.bingoQuadrantEntryCounts(payload, 0);
    assert.equal(counts.length, 64);
    assert.equal(counts[(0 * 8) + 2], 2);
    assert.equal(counts[(1 * 8) + 2], 1);
    assert.equal(counts.reduce((sum, count) => sum + count, 0), 3);
  });

  test('publishes one durable reveal, then consumed overlap logs cannot reopen it', async () => {
    const claimLogs = [
      log('FirstSymbolBingo', [PLAYER, 31, 2], { index: 4, tx: '0xbeef' }),
      log('BingoClaimed', [PLAYER, 31, 2, 2_000n * 10n ** 18n, 77n], {
        index: 5, tx: '0xbeef',
      }),
    ];
    bingo.__setBingoReadersForTest({
      logs: async ({ headOnly, fromBlock, toBlock }) => headOnly
        ? { head: TEST_BLOCK + 5, logs: [] }
        : {
            logs: claimLogs.filter((entry) => (
              entry.blockNumber >= fromBlock && entry.blockNumber <= toBlock
            )),
          },
      tickets: async () => ({
        cards: Array.from({ length: 8 }, (_unused, color) => ({
          entries: [{ traitId: (color * 8) + 2 }],
        })),
      }),
    });

    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    let rows = pending.getPendingActions().filter((row) => row.kind === 'bingo');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kindLabel, 'FIRST-SYMBOL BINGO');
    assert.match(rows[0].label, /Level 31 SUI Bingo/);
    assert.match(rows[0].detail, /all 8 colors collected/);

    await rows[0].run();
    const queued = reveal.__takeQueuedForTest();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].kind, 'bingo');
    assert.deepEqual(queued[0].counts.filter(Boolean), Array(8).fill(1));
    assert.equal(pending.getPendingActions().some((row) => row.kind === 'bingo'), false);

    await bingo.refreshBingoWatch();
    rows = pending.getPendingActions().filter((row) => row.kind === 'bingo');
    assert.equal(rows.length, 0, 'reorg-overlap rescan respects the consumed receipt id');
  });

  test('DB proof becomes a write action, then its receipt becomes the Bingo reveal', async () => {
    const writes = [];
    const claimReceiptLogs = [
      log('FirstQuadrantBingo', [PLAYER, 35, 18], { index: 8, tx: '0xcafe' }),
      log('BingoClaimed', [PLAYER, 35, 18, 5_000n * 10n ** 18n, 99n], {
        index: 9,
        tx: '0xcafe',
      }),
    ];
    bingo.__setBingoReadersForTest({
      index: async () => ({
        player: PLAYER,
        claimable: [{
          player: PLAYER,
          level: 35,
          quadrant: 2,
          symbol: 18,
          slots: [2, 4, 6, 8, 10, 12, 14, 16],
        }],
        claimed: [],
      }),
      claim: async (args) => {
        writes.push(args);
        return { receipt: { logs: claimReceiptLogs } };
      },
      tickets: async () => ({
        cards: Array.from({ length: 8 }, (_unused, color) => ({
          entries: [{ traitId: (2 << 6) | (color << 3) | 2 }],
        })),
      }),
    });

    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    let rows = pending.getPendingActions().filter((row) => row.kind === 'bingo');
    const claim = rows.find((row) => row.shortLabel === 'Claim Bingo');
    assert.ok(claim, 'complete DB proof is actionable');
    assert.equal(claim.write, true);
    assert.equal(claim.autoOpen, false, 'wallet writes never auto-open');

    await claim.run();
    assert.deepEqual(writes, [{
      player: PLAYER,
      level: 35,
      symbol: 18,
      slots: [2, 4, 6, 8, 10, 12, 14, 16],
    }]);

    rows = pending.getPendingActions().filter((row) => row.kind === 'bingo');
    assert.equal(rows.some((row) => row.shortLabel === 'Claim Bingo'), false,
      'confirmed proof is durably retired while the API catches up');
    const receipt = rows.find((row) => row.shortLabel === 'Reveal Bingo');
    assert.ok(receipt, 'confirmed receipt immediately becomes a reveal');
    assert.equal(receipt.kindLabel, 'QUADRANT-FIRST BINGO');

    await receipt.run();
    const queued = reveal.__takeQueuedForTest();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].kind, 'bingo');
    assert.deepEqual(queued[0].counts.filter(Boolean), Array(8).fill(1));
  });
});
