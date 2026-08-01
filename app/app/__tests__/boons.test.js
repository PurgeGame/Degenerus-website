import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { activeBoonForProduct, boonIndicatorModel } from '../boons.js';

describe('active boon product mapping', () => {
  test('maps every actionable boon family to the control it affects', () => {
    const payload = {
      day: 62,
      boons: [
        { boonType: 3, consumed: false },
        { boonType: 22, consumed: false },
        { boonType: 9, consumed: false },
        { boonType: 15, consumed: false },
        { boonType: 24, consumed: false },
        { boonType: 19, consumed: false },
        { boonType: 27, consumed: false },
        { boonType: 31, consumed: false },
      ],
    };
    assert.equal(boonIndicatorModel(payload, 'coinflip').label, 'BOON +25%');
    assert.equal(boonIndicatorModel(payload, 'lootbox').label, 'BOON +25%');
    assert.equal(boonIndicatorModel(payload, 'purchase').label, 'BOON +25%');
    assert.equal(boonIndicatorModel(payload, 'decimator').label, 'BOON +50%');
    assert.equal(boonIndicatorModel(payload, 'whale').label, 'BOON −35%');
    assert.equal(boonIndicatorModel(payload, 'activity').label, 'BOON +50 SCORE');
    assert.equal(boonIndicatorModel(payload, 'deity').label, 'BOON −35%');
    assert.equal(boonIndicatorModel(payload, 'lazy').label, 'BOON −50%');
    assert.match(boonIndicatorModel(payload, 'purchase').title, /Day 62/);
  });

  test('consumed boons do not remain lit beside a product', () => {
    const payload = { day: 62, boons: [{ boonType: 9, consumed: true }] };
    assert.equal(activeBoonForProduct(payload, 'purchase'), null);
    assert.equal(boonIndicatorModel(payload, 'purchase'), null);
  });

  test('pass tier labels use their effective contract discounts', () => {
    assert.equal(
      boonIndicatorModel([{ boonType: 23, consumed: false }], 'whale').label,
      'BOON −20%',
    );
    assert.equal(
      boonIndicatorModel([{ boonType: 26, consumed: false }], 'deity').label,
      'BOON −20%',
    );
  });

  test('a real pass discount takes precedence over the generic pass boon', () => {
    const payload = {
      boons: [
        { boonType: 28, consumed: false },
        { boonType: 24, consumed: false },
      ],
    };
    assert.equal(boonIndicatorModel(payload, 'whale').label, 'BOON −35%');
  });
});
