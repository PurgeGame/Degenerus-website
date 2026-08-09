import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../../boon-review.html', import.meta.url), 'utf8');
const JS = readFileSync(new URL('../boon-review.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../styles/boon-review.css', import.meta.url), 'utf8');

test('the review page activates every boon-consuming production surface', () => {
  for (const product of [
    'coinflip', 'quests', 'lootbox', 'purchase', 'decimator',
    'whale', 'activity', 'deity', 'lazy',
  ]) {
    assert.match(HTML, new RegExp(`data-review-products="[^"]*\\b${product}\\b`));
  }

  for (const product of [
    'coinflip', 'lootbox', 'purchase', 'decimator',
    'whale', 'activity', 'deity', 'lazy',
  ]) {
    assert.match(HTML, new RegExp(`product="${product}"`));
  }
  assert.match(HTML, /qst-streak-chip--shielded/,
    'the quest boon uses the actual held-shield treatment');
});

test('the fixture publishes the strongest active row for every boon product', () => {
  for (const boonType of [3, 4, 22, 9, 15, 24, 19, 27, 31]) {
    assert.match(JS, new RegExp(`boonType:\\s*${boonType}\\b`));
  }
  assert.match(JS, /boostAmount:\s*50/);
  assert.match(JS, /update\('app\.boons'/);
});

test('the review surface is responsive without changing production components', () => {
  assert.match(HTML, /app\/styles\/app\.css/);
  assert.match(HTML, /app\/styles\/status-indicators\.css/,
    'the review fixture uses the same final boon styling layer as the live app');
  assert.match(HTML, /class="panel app-daily-flip"/);
  assert.doesNotMatch(HTML, /<app-daily-flip>/,
    'the static coinflip fixture must not be replaced when the live custom element upgrades');
  assert.match(CSS, /@media \(max-width:\s*760px\)/);
  assert.match(CSS, /@media \(max-width:\s*520px\)/);
  assert.match(CSS, /\.boon-review__surface--wide\s*\{\s*grid-column:\s*1 \/ -1/);
});
