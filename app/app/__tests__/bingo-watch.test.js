import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.HTMLElement = globalThis.HTMLElement || class HTMLElement {};
globalThis.customElements = globalThis.customElements || {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};
// A real (tiny) dispatcher: the watcher listens for the overlay's abort event,
// so a no-op stub would silently pass every restore assertion.
globalThis.document = globalThis.document || {
  _listeners: new Map(),
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  },
  removeEventListener(type, fn) { this._listeners.get(type)?.delete(fn); },
  dispatchEvent(event) {
    for (const fn of [...(this._listeners.get(event?.type) || [])]) {
      try { fn(event); } catch (_e) { /* listeners are independent */ }
    }
    return true;
  },
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
const { prepareWalletReceipt } = await import('../wallet-receipt.js');
const { rpcFixture } = await import('./helpers/chain-rpc.js');

const PLAYER = '0xab12000000000000000000000000000000000000';
const PLAYER_ID = 37;

const TEST_BLOCK = Number(CHAIN.deployBlock) + 100;
const STORAGE_KEY = `degenerus:bingo:${CHAIN.id}:${String(CONTRACTS.GAME).toLowerCase()}:${PLAYER}`;

// A real wallet-ID BingoClaimed receipt (the player is its uint32 ID), prepared exactly as the
// write path does before a panel parses it: IDs resolved to addresses.
async function claimReceipt({ level = 27, symbol = 14, flipReward = 5_000n, dgnrsPaid = 123n, tx = '0xabc', index = 9 } = {}) {
  const f = await rpcFixture();
  await f.wallet(PLAYER_ID, PLAYER);
  const logs = [await f.event('GAME', 'BingoClaimed', {
    player: PLAYER_ID, level, symbol, flipReward, dgnrsPaid,
  }, { block: TEST_BLOCK, index, tx })];
  const receipt = { blockNumber: TEST_BLOCK, logs };
  await prepareWalletReceipt(receipt, f.client);
  return receipt;
}

describe('bingo event watcher', () => {
  beforeEach(() => {
    localStorage.clear();
    pending.__resetPendingActionsForTest();
    reveal.__resetForTest();
    bingo.__resetBingoWatchForTest();
    store.__resetForTest();
    // These lifecycle tests start after the watcher's initial history sync.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      rows: [], consumed: [], historyBaseline: { blockNumber: 0, logIndex: -1 },
    }));
  });

  afterEach(() => bingo.__resetBingoWatchForTest());

  test('decodes the wallet-ID BingoClaimed receipt to the player address', async () => {
    // flipReward: whole FLIP on chain
    const { logs } = await claimReceipt({ tx: '0xdef' });
    const rows = bingo.decodeBingoLogs(logs, PLAYER);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].player, PLAYER);
    assert.equal(rows[0].level, 27);
    assert.equal(rows[0].symbol, 14);
    assert.equal(rows[0].flipReward, String(5_000n * 10n ** 18n));
    assert.equal(rows[0].dgnrsPaid, '123');
    assert.deepEqual(bingo.decodeBingoLogs(logs, '0xcd34000000000000000000000000000000000000'), [],
      'another wallet\'s claim is not this player\'s receipt');
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

  test('cache-invalidation AbortError is quiet and retains the last published state', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    const warnings = [];
    const priorWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      bingo.__setBingoReadersForTest({ index: async () => { throw abort; } });
      bingo.startBingoWatch({ getAddress: () => PLAYER });
      await bingo.refreshBingoWatch();
      assert.equal(warnings.length, 0, 'expected lifecycle cancellation is not a console failure');
    } finally {
      console.warn = priorWarn;
    }
  });

  test('a genuine indexed Bingo read failure remains visible', async () => {
    const warnings = [];
    const priorWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      bingo.__setBingoReadersForTest({
        index: async () => { throw new Error('indexer unavailable'); },
      });
      bingo.startBingoWatch({ getAddress: () => PLAYER });
      await bingo.refreshBingoWatch();
      assert.equal(warnings.length, 1, 'real failures retain one actionable warning');
      assert.match(String(warnings[0][0]), /indexed Bingo read failed/);
      assert.match(String(warnings[0][1]?.message), /indexer unavailable/);
    } finally {
      console.warn = priorWarn;
    }
  });

  for (const chartState of ['stalled', 'failed', 'wallet-changed']) {
    test(`a ${chartState} ticket chart cannot strand or lose a Bingo reveal`, async (t) => {
      let address = PLAYER;
      let signal;
      bingo.__setBingoReadersForTest({
        index: async () => ({ claimed: [{
          id: '0xbeef:5', transactionHash: '0xbeef', logIndex: 5,
          blockNumber: TEST_BLOCK, player: PLAYER, level: 31, symbol: 0,
          flipReward: '2000', dgnrsPaid: '77',
        }] }),
        tickets: async (args) => {
          signal = args.signal;
          if (chartState === 'failed') throw new Error('API unavailable');
          return new Promise(() => {});
        },
      });
      bingo.startBingoWatch({ getAddress: () => address });
      await bingo.refreshBingoWatch();
      const row = pending.getPendingActions().find((item) => item.kind === 'bingo');
      assert.ok(row);
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const running = row.run();
      if (chartState === 'wallet-changed') address = null;
      t.mock.timers.tick(750);
      const result = await running;
      const queued = reveal.__takeQueuedForTest();
      if (chartState === 'wallet-changed') {
        assert.equal(result, false);
        assert.equal(queued.length, 0);
        address = PLAYER;
        await bingo.refreshBingoWatch();
        assert.ok(pending.getPendingActions().find((item) => item.id === row.id));
      } else {
        assert.equal(queued.length, 1);
        assert.equal(queued[0].kind, 'bingo');
        assert.equal(queued[0].level, 31);
        assert.equal(queued[0].flipReward, '2000');
        assert.deepEqual(queued[0].counts, Array(64).fill(0));
        assert.equal(pending.getPendingActions().some((item) => item.id === row.id), false);
      }
      if (chartState !== 'failed') assert.equal(signal.aborted, true);
    });
  }

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
    assert.equal(rows[0].kindLabel, 'BINGO');
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
    const sentReceipt = await claimReceipt({ level: 35, symbol: 18, dgnrsPaid: 99n, tx: '0xcafe' });
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
        return { receipt: sentReceipt };
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
    assert.equal(receipt.kindLabel, 'BINGO');

    await receipt.run();
    const queued = reveal.__takeQueuedForTest();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].kind, 'bingo');
    assert.deepEqual(queued[0].counts.filter(Boolean), Array(8).fill(1));
  });

  test('closing the overlay restores a Bingo reveal row instead of consuming it unseen', async () => {
    const sentReceipt = await claimReceipt({ level: 35, symbol: 18, dgnrsPaid: 99n, tx: '0xcafe' });
    bingo.__setBingoReadersForTest({
      index: async () => ({
        player: PLAYER,
        claimable: [{
          player: PLAYER, level: 35, quadrant: 2, symbol: 18,
          slots: [2, 4, 6, 8, 10, 12, 14, 16],
        }],
        claimed: [],
      }),
      claim: async () => ({ receipt: sentReceipt }),
      tickets: async () => ({
        cards: Array.from({ length: 8 }, (_unused, color) => ({
          entries: [{ traitId: (2 << 6) | (color << 3) | 2 }],
        })),
      }),
    });
    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    await pending.getPendingActions()
      .find((row) => row.kind === 'bingo' && row.shortLabel === 'Claim Bingo')
      .run();

    const receipt = pending.getPendingActions()
      .find((row) => row.kind === 'bingo' && row.shortLabel === 'Reveal Bingo');
    assert.ok(receipt, 'the confirmed claim receipt becomes a reveal row');

    await receipt.run();
    const [queued] = reveal.__takeQueuedForTest();
    assert.ok(queued?.revealRelease?.id, 'the sequence carries its restore identity');
    assert.equal(
      pending.getPendingActions().some((row) => row.shortLabel === 'Reveal Bingo'),
      false,
      'the row is consumed while its presentation is staged',
    );

    // The player closes the overlay before the Bingo ever plays.
    document.dispatchEvent(new CustomEvent(reveal.RESULT_REVEAL_ABORT_EVENT, {
      detail: {
        released: [{
          kind: 'bingo',
          presentationId: queued.presentationId,
          release: queued.revealRelease,
        }],
      },
    }));
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    const restored = pending.getPendingActions()
      .find((row) => row.kind === 'bingo' && row.shortLabel === 'Reveal Bingo');
    assert.ok(restored, 'an unseen Bingo comes back instead of being lost for good');
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

  test('a cleared Bingo claim does not return under its later receipt id', async () => {
    let snapshot = {
      player: PLAYER,
      claimable: [{
        player: PLAYER,
        level: 36,
        quadrant: 1,
        symbol: 9,
        slots: [1, 2, 3, 4, 5, 6, 7, 8],
      }],
      claimed: [],
    };
    bingo.__setBingoReadersForTest({ index: async () => snapshot });
    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    const [claim] = pending.getPendingActions().filter((row) => row.kind === 'bingo');
    await pending.dismissPendingActionItems([claim]);
    snapshot = {
      player: PLAYER,
      claimable: [],
      claimed: [{
        id: '0xafterclear:4',
        transactionHash: '0xafterclear',
        logIndex: 4,
        blockNumber: TEST_BLOCK + 1,
        player: PLAYER,
        level: 36,
        symbol: 9,
          flipReward: '1',
        dgnrsPaid: '0',
      }],
    };
    await bingo.refreshBingoWatch();

    assert.equal(pending.getPendingActions().some((row) => row.kind === 'bingo'), false,
      'the event hash is a lifecycle detail, not a new Pending item');
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

  test('a Bingo from a level the game has left is never offered (audit 628b3eed7)', async () => {
    // claimBingo reverts BingoExpired once `lvl < level` (DegenerusGameBingoModule.sol:146).
    store.update('app.gameState', { level: 35 });
    bingo.__setBingoReadersForTest({
      index: async () => ({
        player: PLAYER,
        claimable: [
          { player: PLAYER, level: 34, quadrant: 0, symbol: 2, slots: [1, 2, 3, 4, 5, 6, 7, 8] },
          { player: PLAYER, level: 35, quadrant: 1, symbol: 10, slots: [11, 12, 13, 14, 15, 16, 17, 18] },
          { player: PLAYER, level: 36, quadrant: 2, symbol: 18, slots: [21, 22, 23, 24, 25, 26, 27, 28] },
        ],
        claimed: [],
      }),
    });
    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    const claims = pending.getPendingActions().filter((row) => row.shortLabel === 'Claim Bingo');
    assert.deepEqual(claims.map((row) => row.id).sort(), ['bingo-claim:35', 'bingo-claim:36'],
      'the current level and the minted levels above it stay claimable; level 34 expired');
  });

  for (const [reason, nextState] of [
    ['buffer retirement', { level: 35, ticketBufferLevels: [36, 35] }],
    ['game over', { level: 35, ticketBufferLevels: [34, 35], gameOver: true }],
    ['game-over phase', { level: 35, ticketBufferLevels: [34, 35], phase: 'GAMEOVER' }],
  ]) test(`${reason} removes a Bingo immediately and blocks a saved overlay action`, async () => {
    store.update('app.gameState', { level: 35, ticketBufferLevels: [34, 35] });
    let writes = 0;
    let reads = 0;
    bingo.__setBingoReadersForTest({
      index: async () => {
        reads++;
        return { claimable: [{ player: PLAYER, level: 34, quadrant: 0, symbol: 2,
          slots: [1, 2, 3, 4, 5, 6, 7, 8] }], claimed: [] };
      },
      claim: async () => { writes++; return { receipt: { logs: [] } }; },
    });
    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const stale = pending.getPendingActions().find(row => row.write);
    assert.ok(stale, 'a completed level is still eligible while its own buffer is retained');
    const priorReads = reads;
    store.update('app.gameState', nextState);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    assert.equal(pending.getPendingActions().some(row => row.write), false);
    assert.equal(reads, priorReads, 'eligibility changes do not wait for another proof read');
    assert.equal(await stale.run(), false);
    assert.equal(writes, 0, 'the saved action cannot reach the claim writer');
    await bingo.refreshBingoWatch();
    assert.equal(pending.getPendingActions().some(row => row.write), false,
      'a stale candidate response cannot resurrect the expired claim');
  });

  test('an old action cannot claim again after a successful claim or an indexed removal', async () => {
    let writes = 0;
    let claimable = [{ player: PLAYER, level: 35, quadrant: 0, symbol: 2,
      slots: [1, 2, 3, 4, 5, 6, 7, 8] }];
    bingo.__setBingoReadersForTest({
      index: async () => ({ claimable, claimed: [] }),
      claim: async () => { writes++; return { receipt: { logs: [] } }; },
    });
    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const removed = pending.getPendingActions().find(row => row.write);
    claimable = [];
    await bingo.refreshBingoWatch();
    assert.equal(await removed.run(), false);
    assert.equal(writes, 0);

    claimable = [{ player: PLAYER, level: 35, quadrant: 0, symbol: 2,
      slots: [1, 2, 3, 4, 5, 6, 7, 8] }];
    await bingo.refreshBingoWatch();
    const claimed = pending.getPendingActions().find(row => row.write);
    await claimed.run();
    assert.equal(writes, 1);
    assert.equal(await claimed.run(), false);
    assert.equal(writes, 1, 'a consumed action never submits a second claim');
  });

  test('a fresh load retires old claimed Bingo history and cached reveals', async () => {
    store.update('app.gameState', { level: 35 });
    const receipt = (level) => ({
      id: `0xbingo${level}:1`, transactionHash: `0xbingo${level}`, logIndex: 1,
      blockNumber: TEST_BLOCK + level, player: PLAYER, level, symbol: 0,
      flipReward: '2000', dgnrsPaid: '77',
    });
    const storageKey = `degenerus:bingo:${CHAIN.id}:${String(CONTRACTS.GAME).toLowerCase()}:${PLAYER}`;
    localStorage.setItem(storageKey, JSON.stringify({
      rows: [receipt(10)], consumed: [], historyBaseline: { blockNumber: 0, logIndex: -1 },
    }));
    bingo.__setBingoReadersForTest({
      index: async () => ({ claimed: [receipt(10), receipt(34), receipt(35)] }),
    });
    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    assert.deepEqual(pending.getPendingActions().filter(row => row.kind === 'bingo')
      .map(row => row.id), ['bingo:0xbingo34:1', 'bingo:0xbingo35:1']);
    assert.equal(JSON.parse(localStorage.getItem(storageKey)).rows.some(row => row.level === 10), false);
    bingo.__resetBingoWatchForTest();
    pending.__resetPendingActionsForTest();
    bingo.__setBingoReadersForTest({ index: async () => ({ claimed: [receipt(10)] }) });
    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    assert.equal(pending.getPendingActions().some(row => row.id === 'bingo:0xbingo10:1'), false,
      'a new session cannot resurrect the paid historical Bingo');
  });

  test('a fresh browser baselines paid Bingos and preserves newly indexed reveals across reloads', async () => {
    localStorage.clear();
    store.update('app.gameState', { level: 35 });
    const oldReceipt = {
      id: '0xold:1', transactionHash: '0xold', logIndex: 1,
      blockNumber: TEST_BLOCK, player: PLAYER, level: 35, symbol: 0,
      flipReward: '2000', dgnrsPaid: '77',
    };
    // A legacy client could already have cached this historical paid event.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rows: [oldReceipt], consumed: [] }));
    const claimed = [oldReceipt];
    bingo.__setBingoReadersForTest({ index: async () => ({ claimed }) });
    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    assert.equal(pending.getPendingActions().length, 0,
      'even a previously paid current-level Bingo is history on first sync');
    claimed.push({ ...oldReceipt, id: '0xnew:2', transactionHash: '0xnew',
      blockNumber: TEST_BLOCK + 1, logIndex: 2, level: 36 });
    await bingo.refreshBingoWatch();
    assert.deepEqual(pending.getPendingActions().map(row => row.id), ['bingo:0xnew:2']);
    bingo.__resetBingoWatchForTest();
    pending.__resetPendingActionsForTest();
    bingo.__setBingoReadersForTest({ index: async () => ({ claimed }) });
    bingo.startBingoWatch({ getAddress: () => PLAYER });
    await bingo.refreshBingoWatch();
    assert.deepEqual(pending.getPendingActions().map(row => row.id), ['bingo:0xnew:2'],
      'unseen new work survives reload without reviving the baseline');
  });

  test('a BingoExpired race retires the stale Bingo action', async () => {
    bingo.__setBingoReadersForTest({
      index: async () => ({
        player: PLAYER,
        claimable: [{ player: PLAYER, level: 37, quadrant: 3, symbol: 27, slots: [8, 7, 6, 5, 4, 3, 2, 1] }],
        claimed: [],
      }),
      claim: async () => {
        const raw = new Error('execution reverted');
        raw.revert = { name: 'BingoExpired' };
        const wrapped = new Error("This level's Bingo expired when the next level started.");
        wrapped.code = 'BingoExpired';
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
      'an expired Bingo is terminal for its level');
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
