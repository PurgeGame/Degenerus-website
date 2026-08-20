import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const store = await import('../store.js');
const { CHAIN, CONTRACTS } = await import('../chain-config.js');

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
    store.__resetForTest();
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

  test('unrevealed entries do not inflate quadrant 0 slot 0 (crypto/pink/XRP)', () => {
    const payload = {
      cards: [{ entries: [
        { traitId: 0 },       // crypto, pink, XRP — the one real hit
        { traitId: null },    // unrevealed; Number(null) is 0, must not count
        { traitId: null },
        { traitId: undefined },
      ] }],
    };
    const counts = bingo.bingoQuadrantEntryCounts(payload, 0);
    assert.equal(counts[0], 1);
    assert.equal(counts.reduce((sum, count) => sum + count, 0), 1);
  });

  // The chain scan this file used to carry walked every block since deploy in
  // 2,000-block getLogs chunks, per player, at the shared project RPC — and it
  // ran precisely when the API was failing, turning an API wobble into a
  // bulk-RPC storm. Bingo state is derived from entries the indexer already
  // holds, so nothing was lost by deleting it. Decoding the CLAIM RECEIPT'S own
  // logs is fine and stays: that comes back from the wallet write, not a read.
  test('reads no chain logs — the indexed API is the only reader', () => {
    const source = readFileSync(new URL('../bingo-watch.js', import.meta.url), 'utf8');
    const code = source.split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    assert.doesNotMatch(code, /getLogs/, 'no getLogs anywhere in this module');
    assert.doesNotMatch(code, /JsonRpcProvider/, 'no provider construction');
    assert.doesNotMatch(code, /getProvider/, 'no wallet provider read either');
    assert.doesNotMatch(code, /CHAIN\.rpcUrl/, 'nothing points at the shared RPC');
    assert.doesNotMatch(code, /deployBlock/, 'no scan-from-deploy cursor');
    assert.match(code, /fetchJSON\(`\/player\/\$\{address\}\/bingos`\)/,
      'the indexed route is the reader');
    // The receipt decoder is deliberately still here.
    assert.match(code, /export function decodeBingoLogs/);
  });

  test('carries no polling interval — main.js already triggers it on every real change', () => {
    const source = readFileSync(new URL('../bingo-watch.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /setInterval/, 'no clock; refreshBingoWatch is event-driven');
  });

  test('publishes one durable reveal, then a repeat API read cannot reopen it', async () => {
    // The indexed `claimed` row is the same receipt the chain used to supply,
    // and the API keeps returning it forever — so the consumed set, not a scan
    // cursor, is what stops a dismissed reveal from coming back.
    bingo.__setBingoReadersForTest({
      index: async () => ({
        player: PLAYER,
        claimable: [],
        claimed: [{
          id: '0xbeef:5',
          transactionHash: '0xbeef',
          logIndex: 5,
          blockNumber: TEST_BLOCK,
          player: PLAYER,
          level: 31,
          symbol: 0,
          tier: 'first-symbol',
          flipReward: String(2_000n * 10n ** 18n),
          dgnrsPaid: '77',
        }],
      }),
      tickets: async () => ({
        cards: Array.from({ length: 8 }, (_unused, color) => ({
          entries: [{ traitId: color * 8 }],
        })),
      }),
    });

    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    let rows = pending.getPendingActions().filter((row) => row.kind === 'bingo');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kindLabel, 'FIRST-SYMBOL BINGO');
    assert.match(rows[0].label, /Level 31 WWXRP Bingo/);
    assert.match(rows[0].detail, /all 8 colors collected/);

    await rows[0].run();
    const queued = reveal.__takeQueuedForTest();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].kind, 'bingo');
    assert.deepEqual(queued[0].counts.filter(Boolean), Array(8).fill(1));
    assert.equal(pending.getPendingActions().some((row) => row.kind === 'bingo'), false);

    await bingo.refreshBingoWatch();
    rows = pending.getPendingActions().filter((row) => row.kind === 'bingo');
    assert.equal(rows.length, 0, 'a repeat API read respects the consumed receipt id');
  });

  test('a newly indexed Bingo stays out of Pending until the jackpot board is complete', async () => {
    store.update('app.daySync', { day: 55, rngRequested: true, jackpotReady: true });
    store.update('app.gameState', { level: 31, dailyRng: { day: 55, finalWord: '1' } });
    bingo.__setBingoReadersForTest({
      index: async () => ({
        player: PLAYER,
        claimable: [{
          player: PLAYER,
          level: 31,
          quadrant: 0,
          symbol: 2,
          slots: [1, 2, 3, 4, 5, 6, 7, 8],
        }],
        claimed: [],
      }),
    });

    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    assert.equal(pending.getPendingActions().some((row) => row.kind === 'bingo'), false,
      'the proof cannot announce a covered jackpot result');

    localStorage.setItem(`jackpot_complete_day_${CHAIN.id}_55`, '1');
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    assert.equal(pending.getPendingActions().find((row) => row.kind === 'bingo')?.shortLabel,
      'Claim Bingo', 'the same proof appears immediately after the board opens');
  });

  test('publishes only one claim per level and suppresses stale proofs once that level is claimed', async () => {
    let claimed = [];
    bingo.__setBingoReadersForTest({
      index: async () => ({
        player: PLAYER,
        // Deliberately return the higher quadrant first, matching the stale
        // indexer behavior that used to create several writes for one level.
        claimable: [{
          player: PLAYER,
          level: 34,
          quadrant: 2,
          symbol: 18,
          slots: [21, 22, 23, 24, 25, 26, 27, 28],
        }, {
          player: PLAYER,
          level: 34,
          quadrant: 0,
          symbol: 2,
          slots: [1, 2, 3, 4, 5, 6, 7, 8],
        }, {
          player: PLAYER,
          level: 35,
          quadrant: 1,
          symbol: 10,
          slots: [11, 12, 13, 14, 15, 16, 17, 18],
        }],
        claimed,
      }),
    });

    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    let claims = pending.getPendingActions()
      .filter((row) => row.shortLabel === 'Claim Bingo');
    assert.equal(claims.length, 2, 'one action per level, not one per quadrant');
    assert.deepEqual(claims.map((row) => row.id).sort(), [
      'bingo-claim:34',
      'bingo-claim:35',
    ]);
    assert.match(claims.find((row) => row.id === 'bingo-claim:34')?.detail || '', /CRYPTO/i,
      'selection is deterministic even when the API order changes');

    claimed = [{
      id: '0xlevel34:4',
      transactionHash: '0xlevel34',
      logIndex: 4,
      blockNumber: TEST_BLOCK,
      player: PLAYER,
      level: 34,
      symbol: 18,
      tier: 'regular',
      flipReward: '10',
      dgnrsPaid: '1',
    }];
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    claims = pending.getPendingActions().filter((row) => row.shortLabel === 'Claim Bingo');
    assert.deepEqual(claims.map((row) => row.id), ['bingo-claim:35'],
      'a receipt for the level suppresses every stale proof at that level');
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

  test('CLEAR durably consumes an unclaimed Bingo proof instead of republishing it', async () => {
    bingo.__setBingoReadersForTest({
      index: async () => ({
        player: PLAYER,
        claimable: [{
          player: PLAYER,
          level: 36,
          quadrant: 1,
          symbol: 9,
          slots: [1, 2, 3, 4, 5, 6, 7, 8],
        }],
        claimed: [],
      }),
    });
    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    const [claim] = pending.getPendingActions().filter((row) => row.kind === 'bingo');
    assert.equal(claim?.shortLabel, 'Claim Bingo');
    await pending.dismissPendingActionItems([claim]);
    assert.equal(pending.getPendingActions().some((row) => row.kind === 'bingo'), false);

    // Simulate a tray/app remount: the registry's session tombstone is gone,
    // while the Bingo watcher's deploy-scoped consumed state remains.
    pending.__resetPendingActionsForTest();
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    assert.equal(pending.getPendingActions().some((row) => row.kind === 'bingo'), false,
      'the unchanged API proof stays cleared after a remount');
  });

  test('migrates old per-quadrant tombstones to suppress the whole level', async () => {
    const storageKey = `degenerus:bingo:${CHAIN.id}:${String(CONTRACTS.GAME).toLowerCase()}:${PLAYER.toLowerCase()}`;
    localStorage.setItem(storageKey, JSON.stringify({
      rows: [],
      consumed: ['claim:38:1'],
    }));
    bingo.__setBingoReadersForTest({
      index: async () => ({
        player: PLAYER,
        claimable: [{
          player: PLAYER,
          level: 38,
          quadrant: 3,
          symbol: 27,
          slots: [1, 2, 3, 4, 5, 6, 7, 8],
        }],
        claimed: [],
      }),
    });

    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    assert.equal(pending.getPendingActions().some((row) => row.kind === 'bingo'), false);
  });

  test('an already-claimed static-call race retires the stale Bingo action', async () => {
    bingo.__setBingoReadersForTest({
      index: async () => ({
        player: PLAYER,
        claimable: [{
          player: PLAYER,
          level: 37,
          quadrant: 3,
          symbol: 27,
          slots: [8, 7, 6, 5, 4, 3, 2, 1],
        }],
        claimed: [],
      }),
      claim: async () => {
        const raw = new Error('execution reverted');
        raw.revert = { name: 'AlreadyClaimed' };
        const wrapped = new Error('Unexpected error — please try again.');
        wrapped.code = 'UNKNOWN';
        wrapped.cause = raw;
        throw wrapped;
      },
    });
    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    const claim = pending.getPendingActions().find((row) => row.shortLabel === 'Claim Bingo');
    assert.ok(claim);
    await claim.run();
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    assert.equal(pending.getPendingActions().some((row) => row.kind === 'bingo'), false,
      'a delayed/permissionless claim cannot strand the old write action');
  });
});
