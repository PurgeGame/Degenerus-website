// Run: node --test app/app/__tests__/jackpot-resolutions.test.js

import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import * as resolutions from '../jackpot-resolutions.js';
import * as contracts from '../contracts.js';
import * as store from '../store.js';

const PLAYER = '0xab12000000000000000000000000000000000000';

function provider() {
  const signer = { getAddress: async () => PLAYER };
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => signer,
  };
}

function method({ result, error, sendResult } = {}) {
  const calls = [];
  const fn = Object.assign(
    async (...args) => {
      calls.push(['send', ...args]);
      return sendResult || { hash: '0xresolution', wait: async () => ({ status: 1, logs: [] }) };
    },
    {
      staticCall: async (...args) => {
        calls.push(['static', ...args]);
        if (error) throw error;
        return result;
      },
    },
  );
  fn.calls = calls;
  return fn;
}

describe('resolution level routing', () => {
  test('Decimator routes x4/x99 windows forward and otherwise keeps the latest eligible round', () => {
    assert.equal(resolutions.decimatorResolutionLevel(4), 5);
    assert.equal(resolutions.decimatorResolutionLevel(24), 25);
    assert.equal(resolutions.decimatorResolutionLevel(94), 85, 'x94/x95 round is excluded');
    assert.equal(resolutions.decimatorResolutionLevel(99), 100);
    assert.equal(resolutions.decimatorResolutionLevel(100), 100);
    assert.equal(resolutions.decimatorResolutionLevel(15, true), 15,
      'the active resolved level wins over a stale open-window latch');
    assert.equal(resolutions.decimatorResolutionLevel(117), 115);
    assert.equal(resolutions.decimatorResolutionLevel(2), 5, 'first round is a useful upcoming target');
    assert.equal(resolutions.decimatorResolutionLevel(42, true), 43, 'exact open latch targets level + 1');
  });

  test('the latest finished draw remains news until it is actually viewed', () => {
    const news = (currentLevel, extra = {}) => resolutions.decimatorFinalIsNews({
      closed: true, seen: false, currentLevel, ...extra,
    });

    assert.equal(news(18), true, 'the fullscreen Level 15 receipt survives past its transition');
    assert.equal(news(17), true);
    assert.equal(news(16), true);
    assert.equal(news(15), true, 'x5 IS the resolution level');
    assert.equal(news(25), true);
    assert.equal(news(20), true, 'level position no longer discards an unseen receipt');
    assert.equal(news(100), true);
    assert.equal(news(95), true);

    assert.equal(news(15, { seen: true }), false, 'dismissed stays dismissed');
    assert.equal(news(15, { closed: false }), false, 'an unfinished round is not a final');
    assert.equal(resolutions.decimatorFinalIsNews(), false, 'no args is not news');
  });

  test('BAF keeps the latest x10 bracket and previews the first one', () => {
    assert.equal(resolutions.bafResolutionLevel(1), 10);
    assert.equal(resolutions.bafResolutionLevel(9), 10);
    assert.equal(resolutions.bafResolutionLevel(10), 10);
    assert.equal(resolutions.bafResolutionLevel(19), 10);
    assert.equal(resolutions.bafResolutionLevel(20), 20);
  });
});

describe('chain-authoritative resolution probes', () => {
  beforeEach(() => {
    store.__resetForTest();
    store.update('connected.address', PLAYER);
    store.update('ui.mode', 'self');
    store.update('ui.chainOk', true);
    contracts.setProvider(provider());
  });

  afterEach(() => {
    resolutions.__resetResolutionFactoriesForTest();
    contracts.clearProvider();
    store.__resetForTest();
  });

  test('Decimator static-call success is ready and canonical reverts become stable states', async () => {
    const ready = method();
    resolutions.__setResolutionFactoriesForTest({
      decimator: () => ({ claimDecimatorJackpot: ready, connect() { return this; } }),
    });
    assert.deepEqual(
      await resolutions.readDecimatorClaimState({ player: PLAYER, level: 25 }),
      { state: 'ready', errorName: null },
    );
    assert.deepEqual(ready.calls, [['static', PLAYER, 25]]);

    for (const [name, state] of [
      ['DecAlreadyClaimed', 'claimed'],
      ['DecNotWinner', 'lost'],
      ['DecClaimInactive', 'pending'],
      ['RngNotReady', 'waiting'],
      ['NoWork', 'pending'],
    ]) {
      const error = new Error(name);
      error.revert = { name };
      const reverting = method({ error });
      resolutions.__setResolutionFactoriesForTest({
        decimator: () => ({ claimDecimatorJackpot: reverting, connect() { return this; } }),
      });
      assert.equal(
        (await resolutions.readDecimatorClaimState({ player: PLAYER, level: 25 })).state,
        state,
      );
    }
  });

  test('BAF reads exact consolation and preflights before the closure-form send', async () => {
    const claim = method();
    const fake = {
      bafConsolationOf: async (player, level) => {
        assert.equal(player, PLAYER);
        assert.equal(level, 20);
        return 42n * 10n ** 18n;
      },
      claimBafConsolation: claim,
      connect() { return this; },
    };
    resolutions.__setResolutionFactoriesForTest({ baf: () => fake });

    assert.equal(
      await resolutions.readBafConsolation({ player: PLAYER, level: 20 }),
      42n * 10n ** 18n,
    );
    const result = await resolutions.claimBafConsolation({ player: PLAYER, level: 20 });
    assert.equal(result.receipt.status, 1);
    assert.deepEqual(claim.calls, [
      ['static', PLAYER, 20],
      ['send', PLAYER, 20],
    ]);
  });

  test('stale BAF action decodes NothingToClaim before sending', async () => {
    const error = new Error('stale');
    error.revert = { name: 'NothingToClaim' };
    const claim = method({ error });
    resolutions.__setResolutionFactoriesForTest({
      baf: () => ({ claimBafConsolation: claim, connect() { return this; } }),
    });
    await assert.rejects(
      resolutions.claimBafConsolation({ player: PLAYER, level: 10 }),
      (caught) => caught.code === 'NothingToClaim' && /already claimed/i.test(caught.userMessage),
    );
    assert.deepEqual(claim.calls, [['static', PLAYER, 10]], 'stale action never reaches sendTx');
  });
});

test('summarizeBafAwards keeps BAF award types and the requested level only', () => {
  assert.deepEqual(
    resolutions.summarizeBafAwards([
      { level: 20, awardType: 'eth_baf', amount: '10' },
      { level: 20, awardType: 'eth_baf', amount: '15' },
      { level: 20, awardType: 'tickets_baf', amount: '12' },
      { level: 20, awardType: 'eth', amount: '999' },
      { level: 10, awardType: 'eth_baf', amount: '500' },
    ], 20),
    { eth: 25n, tickets: 3n },
  );
});
