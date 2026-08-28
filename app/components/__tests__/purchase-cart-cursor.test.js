import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const purchaseCss = readFileSync(
  new URL('../../styles/purchase-desk.css', import.meta.url),
  'utf8',
);
const cursorUrl = new URL('../../assets/shopping-cart-cursor.svg', import.meta.url);
const cursorSvg = readFileSync(cursorUrl, 'utf8');

describe('Buy In shopping-cart cursor', () => {
  test('uses the cart cursor on purchasable product surfaces and enabled checkout actions', () => {
    assert.match(purchaseCss, /@media \(hover: hover\) and \(pointer: fine\)/);
    assert.match(purchaseCss, /\.dec-ticket-piece:not\(:disabled\)/);
    assert.match(purchaseCss, /\.dec-box-card__add:not\(:disabled\)/);
    assert.match(purchaseCss, /\.dec-buy-cta\[data-write\]:not\(:disabled\)/);
    assert.match(purchaseCss, /\[data-bind="dec-buy-dialog-confirm"\]:not\(:disabled\)/);
    assert.match(
      purchaseCss,
      /cursor:\s*url\('\/app\/assets\/shopping-cart-cursor\.svg'\) 3 3, pointer/,
      'the cart handle is the precise hotspot and pointer remains the fallback',
    );
  });

  test('ships a compact, high-contrast SVG cursor asset', () => {
    assert.ok(statSync(cursorUrl).size > 500);
    assert.match(cursorSvg, /width="32" height="32"/);
    assert.match(cursorSvg, /linearGradient id="cart-metal"/);
    assert.equal((cursorSvg.match(/<circle /g) || []).length, 4, 'outlined wheels stay visible on light and dark art');
  });
});
