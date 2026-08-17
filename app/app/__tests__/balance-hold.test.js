import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetHeldBalancesForTest,
  heldBalanceValue,
} from '../balance-hold.js';

function storage() {
  return {
    values: new Map(),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
    clear() { this.values.clear(); },
  };
}

describe('balance-hold', () => {
  beforeEach(() => {
    __resetHeldBalancesForTest();
    globalThis.localStorage = storage();
  });

  test('keeps the last released value until the RNG presentation releases', () => {
    const input = (value, released) => heldBalanceValue({
      namespace: 'coinflip-backing:84532',
      scope: '0xAbC',
      value,
      released,
    });

    assert.equal(input(100n, true), 100n);
    assert.equal(input(175n, false), 100n, 'the unresolved award is not painted');
    assert.equal(input(190n, false), 100n, 'polling cannot advance the held value');
    assert.equal(input(190n, true), 190n, 'release applies the newest queued value');
  });

  test('a cold held ledger is unknown rather than showing the live result', () => {
    assert.equal(heldBalanceValue({
      namespace: 'claimable-eth:84532',
      scope: '0xabc',
      value: 500n,
      released: false,
    }), null);
  });

  test('claimable spending can decrease while a possible payout increase stays held', () => {
    const input = (value) => heldBalanceValue({
      namespace: 'claimable-eth:84532',
      scope: '0xabc',
      value,
      released: false,
      allowDecrease: true,
    });
    heldBalanceValue({
      namespace: 'claimable-eth:84532',
      scope: '0xabc',
      value: 100n,
      released: true,
    });

    assert.equal(input(140n), 100n, 'a possible award remains queued');
    assert.equal(input(60n), 60n, 'a claim or spend remains visible');
    assert.equal(input(90n), 60n, 'a later increase is held from the new baseline');
  });

  test('holds are isolated by ledger and account', () => {
    heldBalanceValue({ namespace: 'flip', scope: '0xaaa', value: 10n, released: true });
    heldBalanceValue({ namespace: 'flip', scope: '0xbbb', value: 20n, released: true });
    heldBalanceValue({ namespace: 'eth', scope: '0xaaa', value: 30n, released: true });

    assert.equal(heldBalanceValue({ namespace: 'flip', scope: '0xaaa', value: 99n, released: false }), 10n);
    assert.equal(heldBalanceValue({ namespace: 'flip', scope: '0xbbb', value: 99n, released: false }), 20n);
    assert.equal(heldBalanceValue({ namespace: 'eth', scope: '0xaaa', value: 99n, released: false }), 30n);
  });
});
