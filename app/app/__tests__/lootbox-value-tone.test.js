import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  lootboxCaseAssets,
  lootboxCaseModel,
  lootboxCasePresentation,
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
      const innerVersion = model === 'large' ? 'v16' : 'v14';
      assert.ok(assets.cardTop, `${model} exposes a purchase-card asset`);
      assert.ok(assets.purchaseTop, `${model} exposes authored Buy In artwork`);
      assert.match(assets.innerLid, new RegExp(`case-${model}-${innerVersion}-inner-lid\\.webp$`));
      assert.equal(assets.deadbolts.length, 2);
      if (model === 'large') {
        assert.match(assets.lockedFront, /case-large-v32-locked-front\.png$/);
        assert.match(assets.retractedFront, /case-large-v32-retracted-front\.png$/);
        assert.match(assets.top, /case-large-v32-top\.png$/);
        assert.match(assets.cardTop, /case-large-v33-card\.webp$/,
          'the purchase card does not eagerly download the full-resolution reveal top');
        assets.deadbolts.forEach((deadbolt) => {
          assert.match(deadbolt, /case-large-v31-deadbolt-(?:left|right)\.png$/,
            'the large shell exposes the exact steel bridges from its briefcase latches');
        });
      } else {
        assert.match(assets.lockedFront, /case-v6-front\.webp$/);
        assert.match(assets.retractedFront, /case-v7-front\.webp$/);
        assert.match(assets.top, /case-v6-top\.webp$/);
        assert.match(assets.cardTop, /case-v6-top\.webp$/);
        assert.match(assets.purchaseTop, /case-v6-top\.webp$/);
        const deadboltVersion = model === 'small' ? 'v18' : 'v17';
        assets.deadbolts.forEach((deadbolt) => {
          assert.match(deadbolt, new RegExp(`case-${model}-${deadboltVersion}-deadbolt-(?:left|right)\\.webp$`));
        });
      }
    }
    assert.equal(lootboxCaseAssets('small').purchaseTop, lootboxCaseAssets('medium').purchaseTop,
      'small and medium share the original detailed top-down case before palette shifting');
    assert.match(lootboxCaseAssets('large').purchaseTop, /case-large-v33-card\.webp$/);
    assert.match(
      lootboxCasePresentation('small').css['--lootbox-case-purchase-art'],
      /case-v6-top\.webp/,
    );
    assert.equal(lootboxCaseAssets('unknown'), lootboxCaseAssets('medium'));
  });

  test('registers purchase prices to the center of each model-specific lid panel', () => {
    assert.deepEqual(
      ['small', 'medium', 'large'].map((model) => {
        const { css } = lootboxCasePresentation(model);
        return [css['--lootbox-price-top'], css['--lootbox-price-height'], css['--lootbox-price-width']];
      }),
      [
        ['37.25%', '20%', '44%'],
        ['37.25%', '20%', '44%'],
        ['25.4%', '21.5%', '42%'],
      ],
    );
  });

  test('defers the full large top until a reveal asks for full resolution', () => {
    const card = lootboxCasePresentation('large');
    const reveal = lootboxCasePresentation('large', { fullResolution: true });
    assert.match(card.css['--lootbox-case-top-art'], /case-large-v33-card\.webp/);
    assert.match(reveal.css['--lootbox-case-top-art'], /case-large-v32-top\.png/);
  });

  test('all dynamic luckbox surfaces consume the shared model presentation', () => {
    const sources = Object.fromEntries([
      ['shop', '../../components/app-decimator-panel.js'],
      ['pending', '../../components/app-box-strip.js'],
      ['tray', '../../components/app-reveal-tray.js'],
      ['opener', '../../components/reveal-overlay.js'],
    ].map(([name, path]) => [name, readFileSync(new URL(path, import.meta.url), 'utf8')]));

    assert.match(sources.shop,
      /applyLootboxCasePresentation\(element, element\.getAttribute\('data-lootbox-case-model'\)\)/);
    assert.match(sources.pending, /applyLootboxCasePresentation\(art, value\.model\)/);
    assert.match(sources.tray,
      /applyLootboxCasePresentation\((?:button|box), item\.lootboxCaseModel\)/);
    assert.match(sources.opener,
      /isLootbox \? seq\.lootboxCaseModel : 'medium'/);
  });
});
