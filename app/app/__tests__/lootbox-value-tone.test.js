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

  test('uses bronze below the 3x midpoint, silver through 16x, then the gold case', () => {
    const price = 100n;
    assert.deepEqual(
      [25n, 100n, 299n, 300n, 499n, 500n, 1_599n, 1_600n, 2_499n, 2_500n, 10_000n]
        .map((amount) => lootboxValuePresentation(amount, price).model),
      ['small', 'small', 'small', 'medium', 'medium', 'medium', 'medium', 'large', 'large', 'large', 'large'],
    );
    assert.equal(lootboxCaseModel(299n, price), 'small');
    assert.equal(lootboxCaseModel(300n, price), 'medium');
    assert.deepEqual(lootboxValuePresentation(1_600n, price), {
      tone: 'gold',
      model: 'large',
      unitsLabel: '16×',
      amountWei: 1_600n,
      ticketPriceWei: price,
    });
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
        assert.match(assets.lockedFront, /case-large-v43-side-connected-bracket-locked-front\.png$/);
        assert.match(assets.retractedFront, /case-large-v43-side-connected-bracket-retracted-front\.png$/);
        assert.match(assets.top, /case-large-v32-top\.png$/);
        assert.match(assets.cardTop, /case-large-v33-card\.webp$/,
          'the purchase card does not eagerly download the full-resolution reveal top');
        assets.deadbolts.forEach((deadbolt) => {
          assert.match(deadbolt, /case-large-v31-deadbolt-(?:left|right)\.png$/,
            'the large shell exposes the exact steel bridges from its briefcase latches');
        });
        assert.equal(assets.frontFace, undefined,
          'gold keeps its accepted authored front unchanged');
      } else {
        const iconVersion = model === 'small' ? 'v26' : 'v27';
        assert.match(assets.lockedFront,
          /case-compact-v36-old-panels-clean-lid-continuous-side-rails\.webp$/,
          'both compact openers share one clean, symmetric low-lid front view');
        assert.match(assets.iconFront,
          new RegExp(`case-${model}-${iconVersion}-approved-locked-front\\.webp$`),
          'standalone Buy In icons retain their approved taller render');
        assert.equal(assets.retractedFront, assets.lockedFront,
          'one registered low-angle raster is split into the moving lid and stationary body');
        assert.match(assets.revealToneMask,
          /case-compact-v36-shell-tone-mask\.webp$/,
          'value color is restricted to the shell instead of contaminating hardware edges');
        if (model === 'small') {
          assert.match(assets.trimOverlay,
            /case-small-v34-continuous-bronze-side-rails-overlay\.webp$/,
            'the small case restores a strict bronze hardware layer');
        } else {
          assert.equal(assets.trimOverlay, undefined,
            'the clean base already supplies silver hardware without an edge overlay');
        }
        assert.match(assets.lockedToneMask,
          new RegExp(`case-${model}-${iconVersion}-locked-shell-mask\\.webp$`));
        assert.equal(assets.frontFace, undefined,
          'the complete approved front is a single coherent raster');
        if (model === 'small') {
          assert.match(assets.top, /case-small-v21-plain-lid-large-badge-buy-in-card\.webp$/);
          assert.equal(assets.cardTop, assets.top);
          assert.equal(assets.purchaseTop, assets.top);
        } else {
          assert.match(assets.top, /case-medium-v26-purple-gold-perspective-buy-in-card\.webp$/,
            'the established opening-animation lid remains unchanged');
          assert.match(assets.cardTop, /case-medium-v28-quiet-quadrant-buy-in-card\.webp$/,
            'priced medium cards use the quiet quadrant engraving');
          assert.equal(assets.purchaseTop, assets.cardTop);
        }
        assert.match(assets.topToneMask, /buy-in-shell-mask\.webp$/,
          'custom colors can tint the shell without repainting bronze or silver hardware');
        const deadboltVersion = model === 'small' ? 'v18' : 'v17';
        assets.deadbolts.forEach((deadbolt) => {
          assert.match(deadbolt, new RegExp(`case-${model}-${deadboltVersion}-deadbolt-(?:left|right)\\.webp$`));
        });
      }
    }
    assert.notEqual(lootboxCaseAssets('small').purchaseTop, lootboxCaseAssets('medium').purchaseTop,
      'each compact model keeps the exact Buy In perspective approved for that size');
    assert.match(lootboxCaseAssets('large').purchaseTop, /case-large-v33-card\.webp$/);
    assert.match(
      lootboxCasePresentation('small').css['--lootbox-case-purchase-art'],
      /case-small-v21-plain-lid-large-badge-buy-in-card\.webp/,
    );
    assert.match(lootboxCasePresentation('medium').css['--lootbox-case-reveal-tone-mask'],
      /case-compact-v36-shell-tone-mask\.webp/);
    assert.match(lootboxCasePresentation('small').css['--lootbox-case-trim-overlay'],
      /case-small-v34-continuous-bronze-side-rails-overlay\.webp/);
    assert.equal(lootboxCasePresentation('small').css['--lootbox-case-front-face'], 'none');
    assert.equal(lootboxCasePresentation('medium').css['--lootbox-case-front-face'], 'none');
    assert.equal(lootboxCasePresentation('large').css['--lootbox-case-front-face'], 'none');
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

  test('publishes the compact badge size directly so no reveal path can inflate its housing', () => {
    assert.deepEqual(
      ['small', 'medium', 'large'].map((model) => (
        lootboxCasePresentation(model).css['--lootbox-case-badge-size']
      )),
      ['11.1%', '11.1%', '10.35%'],
    );
    assert.deepEqual(
      ['small', 'medium'].map((model) => (
        lootboxCasePresentation(model).css['--lootbox-case-badge-top']
      )),
      ['62.06%', '62.06%'],
      'both compact badges return to the exact center of the established low-angle diamond',
    );
    assert.deepEqual(
      ['small', 'medium', 'large'].map((model) => (
        lootboxCasePresentation(model).css['--lootbox-case-aspect']
      )),
      ['1200 / 539', '1200 / 539', '1200 / 539'],
      'the compact reveal returns to the established front-facing, nearly lidless perspective',
    );
    assert.deepEqual(
      ['small', 'medium', 'large'].map((model) => (
        lootboxCasePresentation(model).css['--lootbox-case-reveal-tone-opacity']
      )),
      ['1', '1', '0'],
      'compact shells recolor beneath repaired metal trim while gold stays authored',
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
