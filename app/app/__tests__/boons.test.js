import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityBoonScore,
  activeBoonForProduct,
  boonBoostBps,
  boonBoostDelta,
  coinflipBoonBoostDelta,
  boonIndicatorModel,
  boonTypePresentation,
  boonTypeVisual,
  decodePackedBoons,
  passBoonDiscountBps,
} from '../boons.js';
import { BOON_BOOST_PCT, BOON_FULL_NAMES, BOON_TYPE_NAMES } from '../boon-types.js';

describe('active boon product mapping', () => {
  test('decodes only currently consumable boons from GAME boonPacked state', () => {
    const day = 62n;
    const slot0 = (
      // Coinflip +10 from a lootbox on day 61: active through day 63.
      (61n << 0n) | (2n << 48n)
      // Luckbox +25 deity boon from day 61: expired at day rollover.
      | (61n << 56n) | (61n << 80n) | (3n << 104n)
      // Ticket purchase +15 from day 60: active through day 64.
      | (60n << 112n) | (2n << 160n)
      // Persistent Decimator +50 until it is consumed.
      | (3n << 168n)
    );
    const slot1 = (
      // Craps +10 from a lootbox yesterday: active through day 63.
      ((61n << 3n) | 2n)
      // Lazy -25 deity boon from today.
      | (62n << 128n) | (62n << 152n) | (2n << 176n)
      // ETH +8 lootbox boon from yesterday: active through day 63.
      | (((61n << 3n) | 2n) << 184n)
      // FLIP +12 deity boon from yesterday: expired at midnight.
      | (((61n << 3n) | 4n | 3n) << 208n)
      // WWXRP +4 lootbox boon from day 60: active through today.
      | (((60n << 3n) | 1n) << 232n)
    );
    const rows = decodePackedBoons(slot0, slot1, day);
    assert.deepEqual(rows.map((row) => row.boonType), [2, 8, 15, 30, 42, 33, 38]);
    assert.equal(
      boonIndicatorModel({ day: 62, boons: rows }, 'craps').label,
      'BOON +10%',
    );
    assert.match(
      boonIndicatorModel({ day: 62, boons: rows }, 'craps').title,
      /bankroll return from your next paid Craps entry/,
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
        { boonType: 34, consumed: false },
        { boonType: 37, consumed: false },
        { boonType: 40, consumed: false },
        { boonType: 43, consumed: false },
      ],
    };
    assert.equal(boonIndicatorModel(payload, 'coinflip').label, 'BOON +25%');
    assert.equal(boonIndicatorModel(payload, 'lootbox').label, 'BOON +25%');
    assert.equal(boonIndicatorModel(payload, 'purchase').label, 'BOON +25%');
    assert.equal(boonIndicatorModel(payload, 'decimator').label, 'BOON +50%');
    assert.equal(boonIndicatorModel(payload, 'whale').label, 'BOON −35%');
    assert.equal(boonIndicatorModel(payload, 'activity').label, 'BOON +25 RATING');
    assert.equal(boonIndicatorModel(payload, 'deity').label, 'BOON −35%');
    assert.equal(boonIndicatorModel(payload, 'lazy').label, 'BOON −50%');
    assert.equal(boonIndicatorModel(payload, 'degenerette-eth').label, '12% BONUS ETH BET');
    assert.equal(boonIndicatorModel(payload, 'degenerette-flip').label, '12% BONUS FLIP BET');
    assert.equal(boonIndicatorModel(payload, 'degenerette-wwxrp').label, '12% BONUS WWXRP BET');
    assert.equal(boonIndicatorModel(payload, 'craps').label, 'BOON +15%');
    assert.match(boonIndicatorModel(payload, 'purchase').title, /Day 62/);
  });

  test('activity boon labels halve raw quest streak into Degen Rating', () => {
    assert.equal(activityBoonScore(10), 5);
    assert.equal(activityBoonScore(25), 12.5);
    assert.equal(activityBoonScore(50), 25);
    assert.equal(boonTypePresentation(17).effect, '+5 DEGEN RATING');
    assert.equal(boonTypePresentation(18).effect, '+12.5 DEGEN RATING');
    assert.equal(boonTypePresentation(19).effect, '+25 DEGEN RATING');
  });

  test('deity choices state the concrete player benefit instead of a bare percent', () => {
    assert.equal(boonTypePresentation(5).effect, '5% BIGGER LUCKBOX');
    assert.equal(boonTypePresentation(9).effect, '25% MORE TICKETS');
    assert.equal(boonTypePresentation(3).effect, '25% BONUS FLIP');
    assert.equal(boonTypePresentation(15).effect, '50% MORE ENTRY WEIGHT');
    assert.equal(boonTypePresentation(24).effect, '35% OFF WHALE PASS');
    assert.equal(boonTypePresentation(4).effect, '1 MISSED DAY SHIELDED');
    assert.equal(boonTypePresentation(32).effect, '4% BONUS ETH BET');
    assert.equal(boonTypePresentation(36).effect, '8% BONUS FLIP BET');
    assert.equal(boonTypePresentation(40).effect, '12% BONUS WWXRP BET');
    assert.equal(boonTypePresentation(41).effect, '5% MORE CRAPS BANKROLL RETURN');
    assert.equal(boonTypePresentation(42).effect, '10% MORE CRAPS BANKROLL RETURN');
    assert.equal(boonTypePresentation(43).effect, '15% MORE CRAPS BANKROLL RETURN');
    assert.equal(boonTypePresentation(32).name, 'Degenerette');
    assert.equal(boonTypePresentation(36).name, 'Degenerette');
    assert.equal(boonTypePresentation(40).name, 'Degenerette');
    assert.equal(boonTypePresentation(42).name, 'Craps');
  });

  test('exposes the affected product for color-coded Deity boon controls', () => {
    assert.equal(boonTypePresentation(6).product, 'lootbox');
    assert.equal(boonTypePresentation(15).product, 'decimator');
    assert.equal(boonTypePresentation(30).product, 'lazy');
  });

  test('uses native currency badges on one amount-colored arrow language', () => {
    const ticketTiers = [7, 8, 9].map(boonTypeVisual);
    assert.deepEqual(ticketTiers.map(({ tier, strength }) => [tier, strength]), [
      [1, 'low'], [2, 'mid'], [3, 'high'],
    ]);
    assert.equal(new Set(ticketTiers.map(({ icon }) => icon)).size, 1,
      'amount tiers share the same contextual marker');
    assert.equal(ticketTiers[0].icon, null,
      'Tickets is already named by its host control, so it needs no invented pictogram');
    assert.equal(boonTypeVisual(4).icon, '/app/assets/boons/boon-quest-micro.svg',
      'the quest shield uses the shield mark, not the generic arrow');
    assert.notEqual(boonTypeVisual(9).icon, boonTypeVisual(22).icon,
      'the real Luckbox case can still identify its product away from the buy control');
    assert.equal(boonTypeVisual(32).icon, '/badges-circular/crypto_06_ethereum_green.svg');
    assert.equal(boonTypeVisual(36).icon, '/whitepaper/flame-logo-split.svg');
    assert.equal(boonTypeVisual(40).icon, '/shared/coinflip-face-red.svg');
    assert.equal(boonTypeVisual(42).icon, '/badges-circular/dice_04_5_silver.svg');
    assert.doesNotMatch([
      boonTypeVisual(32).icon,
      boonTypeVisual(36).icon,
      boonTypeVisual(40).icon,
    ].join(' '), /bount|crosshair|target|app\/assets\/boons/i);
    assert.equal(boonTypeVisual(40).pips, '●●●');
    assert.equal(boonTypeVisual(4).strength, 'utility');
    assert.equal(boonTypeVisual(7).direction, 'up');
    assert.equal(boonTypeVisual(24).direction, 'down');
    assert.equal(boonTypeVisual(28).direction, 'up', 'a pass award is not a discount');
    assert.equal(boonTypeVisual(7).amountColor, '#60a5fa');
    assert.equal(boonTypeVisual(8).amountColor, '#cbd5e1');
    assert.equal(boonTypeVisual(9).amountColor, '#facc15');
  });

  test('names Degenerette boons in the active-boon history instead of generic type IDs', () => {
    assert.equal(BOON_TYPE_NAMES[32], 'DGN_ETH_4');
    assert.equal(BOON_TYPE_NAMES[36], 'DGN_FLIP_8');
    assert.equal(BOON_TYPE_NAMES[40], 'DGN_WWXRP_12');
    assert.equal(BOON_FULL_NAMES[36], '8% BONUS FLIP BET');
    assert.equal(BOON_BOOST_PCT[40], 12);
    assert.equal(BOON_TYPE_NAMES[42], 'CRAPS_10');
    assert.equal(BOON_FULL_NAMES[42], 'Craps bankroll return +10%');
    assert.equal(BOON_BOOST_PCT[43], 15);
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

  test('exposes exact contract BPS for pass-price quotes', () => {
    const payload = { boons: [
      { boonType: 24, consumed: false },
      { boonType: 26, consumed: false },
      { boonType: 31, consumed: false },
    ] };
    assert.equal(passBoonDiscountBps(payload, 'whale'), 3500);
    assert.equal(passBoonDiscountBps(payload, 'deity'), 2000);
    assert.equal(passBoonDiscountBps(payload, 'lazy'), 5000);
    assert.equal(passBoonDiscountBps(payload, 'coinflip'), 0);
    assert.equal(passBoonDiscountBps([{ boonType: 28, consumed: false }], 'whale'), 0,
      'the immediate Whale-pass award is not a purchase discount');
  });

  test('exposes exact positive purchase effects for numeric transaction previews', () => {
    const payload = { boons: [
      { boonType: 9, consumed: false },
      { boonType: 22, consumed: false },
      { boonType: 3, consumed: false },
      { boonType: 34, consumed: false },
      { boonType: 43, consumed: false },
    ] };
    assert.equal(boonBoostBps(payload, 'purchase'), 2500);
    assert.equal(boonBoostBps(payload, 'lootbox'), 2500);
    assert.equal(boonBoostBps(payload, 'coinflip'), 2500);
    assert.equal(boonBoostBps(payload, 'degenerette-eth'), 1200);
    assert.equal(boonBoostBps(payload, 'craps'), 1500);
    assert.equal(boonBoostDelta(5_000n, payload, 'lootbox'), 1_250n);
    const flip = 10n ** 18n;
    assert.equal(coinflipBoonBoostDelta(50_000n * flip, payload), 12_500n * flip);
    assert.equal(coinflipBoonBoostDelta(500_000n * flip, payload), 25_000n * flip,
      'Coinflip mirrors the contract cap while other product boosts remain uncapped');
    assert.equal(boonBoostDelta('bad', payload, 'lootbox'), 0n);
    assert.equal(boonBoostBps({ boons: [{ boonType: 9, consumed: true }] }, 'purchase'), 0);
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
