import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { activeBoonForProduct, boonIndicatorModel, decodePackedBoons } from '../boons.js';

describe('active boon product mapping', () => {
  test('decodes only currently consumable boons from GAME boonPacked state', () => {
    const day = 62n;
    const slot0 = (
      // Coinflip +10 from a lootbox on day 61: active through day 63.
      (61n << 0n) | (2n << 48n)
      // Lootbox +25 deity boon from day 61: expired at day rollover.
      | (61n << 56n) | (61n << 80n) | (3n << 104n)
      // Ticket purchase +15 from day 60: active through day 64.
      | (60n << 112n) | (2n << 160n)
      // Persistent Decimator +50 until it is consumed.
      | (3n << 168n)
    );
    const slot1 = (
      // Accumulated activity amount is presented exactly, not rounded to tier.
      75n | (61n << 24n)
      // Lazy -25 deity boon from today.
      | (62n << 128n) | (62n << 152n) | (2n << 176n)
    );
    const rows = decodePackedBoons(slot0, slot1, day);
    assert.deepEqual(rows.map((row) => row.boonType), [2, 8, 15, 19, 30]);
    assert.equal(rows.find((row) => row.boonType === 19)?.boostAmount, 75);
    assert.equal(
      boonIndicatorModel({ day: 62, boons: rows }, 'activity').label,
      'BOON +75 SCORE',
    );
  });

  test('rejects malformed packed state instead of inventing a boon', () => {
    assert.deepEqual(decodePackedBoons('not-a-word', 0, 62), []);
    assert.deepEqual(decodePackedBoons(0, 0, 0), []);
  });

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
