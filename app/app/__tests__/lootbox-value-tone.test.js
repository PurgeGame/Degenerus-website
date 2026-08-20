import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  lootboxCaseAssets,
  lootboxCaseModel,
  lootboxValuePresentation,
} from '../lootbox-value-tone.js';

describe('lootbox value tone', () => {
  test('uses exact doubling bands measured in ticket-price units', () => {
    const price = 100n;
    assert.deepEqual(
      [25n, 99n, 100n, 199n, 200n, 399n, 400n, 799n, 800n, 1599n, 1600n]
        .map((amount) => lootboxValuePresentation(amount, price).tone),
      ['steel', 'steel', 'green', 'green', 'blue', 'blue', 'purple', 'purple', 'red', 'red', 'gold'],
    );
  });

  test('formats fractional ticket units without floating-point loss', () => {
    assert.equal(lootboxValuePresentation(25n, 100n).unitsLabel, '0.25×');
    assert.equal(lootboxValuePresentation(425n, 100n).unitsLabel, '4.25×');
    assert.equal(lootboxValuePresentation(10n ** 30n, 10n ** 28n).unitsLabel, '100×');
  });

  test('keeps unknown or empty values neutral', () => {
    assert.equal(lootboxValuePresentation(null, 100n).tone, 'unknown');
    assert.equal(lootboxValuePresentation(100n, 0n).tone, 'unknown');
    assert.equal(lootboxValuePresentation(null, 100n).model, 'medium');
  });

  test('uses the real 1x / 5x / 25x preset boundaries for one canonical case model', () => {
    const price = 100n;
    assert.deepEqual(
      [25n, 100n, 499n, 500n, 2_499n, 2_500n, 10_000n]
        .map((amount) => lootboxValuePresentation(amount, price).model),
      ['small', 'small', 'small', 'medium', 'medium', 'large', 'large'],
    );
    assert.equal(lootboxCaseModel(500n, price), 'medium');
    assert.equal(lootboxCaseModel(2_500n, price), 'large');
  });

  test('publishes the complete art family from the same canonical selector', () => {
    for (const model of ['small', 'medium', 'large']) {
      const assets = lootboxCaseAssets(model);
      assert.match(assets.lockedFront, new RegExp(`case-${model}-v14-locked-front\\.webp$`));
      assert.match(assets.retractedFront, new RegExp(`case-${model}-v14-retracted-front\\.webp$`));
      assert.match(assets.top, new RegExp(`case-${model}-v14-top\\.webp$`));
      assert.match(assets.innerLid, new RegExp(`case-${model}-v14-inner-lid\\.webp$`));
      assert.equal(assets.deadbolts.length, model === 'large' ? 4 : 2);
    }
    assert.equal(lootboxCaseAssets('unknown'), lootboxCaseAssets('medium'));
  });
});
