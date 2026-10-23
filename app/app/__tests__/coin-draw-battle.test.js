// The daily jackpot battle's awarded seat: the viewer opens it through the normal craps replay,
// shares an in-flight preload, never opens after its deadline, and colours the result from the
// chain winner's payout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER } from './helpers/chain-rpc.js';
import { openJackpotDrawRun, preloadJackpotDrawRun } from '../../craps/coin-draw-viewer.js';

test('current jackpot draw opens the awarded seat through the normal replay and preserves its opener', async () => {
  const battleKey = '0x' + '12'.repeat(32);
  const viewerBetId = '12345678901234567890';
  const opener = { id: 'centre' };
  const calls = [];
  const result = await openJackpotDrawRun({ battleKey, viewerBetId, opener,
    doc: { querySelector: () => ({ open: (...args) => calls.push(args) }) },
    prepareReplay: async (request) => {
      assert.equal(request.battleKey, battleKey);
      assert.equal(request.viewerBetId, viewerBetId);
      assert.equal(typeof request.fetchImpl, 'function');
      return { ready: true, open: table => table.open({ viewerBetId, tableIndex: battleKey }) };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [[{ viewerBetId, tableIndex: battleKey }, opener]]);
});

test('an unsettled current jackpot battle stays closed with a retry message', async () => {
  let opened = false;
  const result = await openJackpotDrawRun({
    doc: { querySelector: () => ({ open: () => { opened = true; } }) },
    prepareReplay: async () => ({ ready: false }),
  });
  assert.equal(opened, false);
  assert.equal(result.ok, false);
  assert.match(result.message, /still settling/);
});

test('a current jackpot replay completing after its deadline never opens the table', async () => {
  const controller = new AbortController();
  let opened = false;
  const result = await openJackpotDrawRun({ signal: controller.signal,
    doc: { querySelector: () => ({ open: () => { opened = true; } }) },
    prepareReplay: async () => {
      controller.abort();
      return { ready: true, open: table => table.open({}) };
    },
  });
  assert.equal(opened, false);
  assert.equal(result.ok, false);
  assert.match(result.message, /canceled/);
});

test('jackpot preloading stays hidden, shares an in-flight click, and retains the exact awarded seat', async () => {
  const battleKey = '0x' + '34'.repeat(32);
  const viewerBetId = '777';
  const opened = []; let builds = 0; let finish;
  const doc = { querySelector: () => ({ open: (...args) => opened.push(args) }) };
  const prepareReplay = async request => {
    builds++;
    assert.equal(request.battleKey, battleKey);
    assert.equal(request.viewerBetId, viewerBetId);
    return new Promise(resolve => { finish = () => resolve({ ready: true,
      open: table => table.open({ viewerBetId, tableIndex: battleKey }),
    }); });
  };
  const request = { battleKey, viewerBetId, doc, prepareReplay };
  const warm = preloadJackpotDrawRun(request);
  await Promise.resolve();
  assert.equal(builds, 1);
  assert.equal(opened.length, 0, 'background preparation does not reveal the battle');
  const opener = { id: 'jackpot-button' };
  const click = openJackpotDrawRun({ ...request, opener });
  await Promise.resolve();
  assert.equal(builds, 1, 'clicking mid-preload shares its work');
  finish();
  assert.equal((await warm).ready, true);
  assert.equal((await click).ok, true);
  assert.deepEqual(opened, [[{ viewerBetId, tableIndex: battleKey }, opener]]);
  await openJackpotDrawRun(request);
  assert.equal(builds, 1, 'a later open needs no replay, profile, or table-model reload');
});

test('failed and unsettled preloads do not poison later clicks or another wallet seat', async () => {
  const battleKey = '0x' + '56'.repeat(32);
  const opened = [];
  const doc = { querySelector: () => ({ open: options => opened.push(options) }) };
  let builds = 0;
  const prepareReplay = async ({ viewerBetId }) => {
    builds++;
    if (builds === 1) throw new Error('RPC unavailable');
    if (builds === 2) return { ready: false };
    return { ready: true, open: table => table.open({ viewerBetId }) };
  };
  const request = { battleKey, viewerBetId: '888', doc, prepareReplay };
  await assert.rejects(preloadJackpotDrawRun(request), /RPC unavailable/);
  assert.equal((await preloadJackpotDrawRun(request)).ready, false);
  assert.equal(opened.length, 0);
  assert.equal((await openJackpotDrawRun(request)).ok, true);
  assert.equal((await openJackpotDrawRun({ ...request, viewerBetId: '889' })).ok, true);
  assert.equal(builds, 4);
  assert.deepEqual(opened, [{ viewerBetId: '888' }, { viewerBetId: '889' }]);
});

test('awarded-seat result colors use the chain winner and exact run credit', async () => {
  for (const [seat, paid, winnerId, tone] of [
    ['881', '0', '881', 'won'], ['882', '120', '999', 'profit'], ['883', '0', '999', 'lost'],
  ]) {
    const options = { viewerBetId: seat, viewerResult: { runPayoutWei: paid } };
    const result = await openJackpotDrawRun({
      battleKey: '0x' + '78'.repeat(32), viewerBetId: seat,
      doc: { querySelector: () => ({ open(detail) {
        assert.equal(detail.battleWonByViewer, seat === winnerId);
        assert.equal(detail.battleWinnerBetId, winnerId);
      } }) },
      prepareReplay: async () => ({ ready: true, mainModel: { tableOptions: options },
        open: table => table.open(options) }),
      loadWinner: async () => ({ betId: winnerId, winner: PLAYER, battlePaidWei: 500n }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.resultTone, tone);
  }
});
