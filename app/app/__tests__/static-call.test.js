// /app/app/__tests__/static-call.test.js — APP-05 unit (D-10 LOCKED)
// Run: node --test website/app/app/__tests__/static-call.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { requireStaticCall } from '../static-call.js';

describe('requireStaticCall happy path', () => {
  test('returns {ok:true, simResult} on successful staticCall', async () => {
    const contract = {
      purchase: { staticCall: async (...args) => ({ simulated: true, args }) },
    };
    const result = await requireStaticCall(contract, 'purchase', [42n]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.simResult, { simulated: true, args: [42n] });
  });

  test('args are spread into staticCall', async () => {
    let captured = null;
    const contract = {
      claim: { staticCall: async (...args) => { captured = args; return null; } },
    };
    await requireStaticCall(contract, 'claim', ['a', 'b', 'c']);
    assert.deepEqual(captured, ['a', 'b', 'c']);
  });

  test('default empty args (no args param) calls staticCall with no arguments', async () => {
    let captured = null;
    const contract = {
      ping: { staticCall: async (...args) => { captured = args; return 'pong'; } },
    };
    const result = await requireStaticCall(contract, 'ping');
    assert.equal(result.ok, true);
    assert.equal(result.simResult, 'pong');
    assert.deepEqual(captured, []);
  });
});

describe('requireStaticCall revert path', () => {
  test('returns {ok:false, error} on revert (does NOT re-throw)', async () => {
    const err = new Error('reverted: NotTimeYet');
    const contract = {
      claim: { staticCall: async () => { throw err; } },
    };
    const result = await requireStaticCall(contract, 'claim', []);
    assert.equal(result.ok, false);
    assert.equal(result.error, err);
  });

  test('captures CallExceptionError-shaped object without re-throwing', async () => {
    const err = Object.assign(new Error('reverted'), {
      revert: { name: 'RngNotReady', signature: 'RngNotReady()', args: [], selector: '0xdeadbeef' },
      reason: null,
      shortMessage: 'execution reverted',
    });
    const contract = {
      requestRng: { staticCall: async () => { throw err; } },
    };
    const result = await requireStaticCall(contract, 'requestRng', []);
    assert.equal(result.ok, false);
    assert.equal(result.error, err);
    assert.equal(result.error.revert.name, 'RngNotReady');
  });
});

describe('requireStaticCall signer handling', () => {
  test('signer triggers contract.connect(signer)', async () => {
    let connectArg = null;
    const connectedContract = {
      mint: { staticCall: async () => 'connected-result' },
    };
    const baseContract = {
      connect(signer) { connectArg = signer; return connectedContract; },
      mint: { staticCall: async () => 'base-result' },
    };
    const fakeSigner = { addr: '0xabc' };
    const result = await requireStaticCall(baseContract, 'mint', [], fakeSigner);
    assert.equal(connectArg, fakeSigner);
    assert.equal(result.ok, true);
    assert.equal(result.simResult, 'connected-result');
  });

  test('no signer → contract.connect NOT called', async () => {
    let connectCalled = false;
    const contract = {
      connect() { connectCalled = true; return {}; },
      mint: { staticCall: async () => 'ok' },
    };
    const result = await requireStaticCall(contract, 'mint', []);
    assert.equal(connectCalled, false);
    assert.equal(result.ok, true);
    assert.equal(result.simResult, 'ok');
  });

  test('null signer → contract.connect NOT called (treated as falsy)', async () => {
    let connectCalled = false;
    const contract = {
      connect() { connectCalled = true; return {}; },
      mint: { staticCall: async () => 'ok' },
    };
    const result = await requireStaticCall(contract, 'mint', [], null);
    assert.equal(connectCalled, false);
    assert.equal(result.ok, true);
  });
});
