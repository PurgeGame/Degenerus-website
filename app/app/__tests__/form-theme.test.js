import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../styles/forms.css', import.meta.url), 'utf8');

describe('shared game-field theme', () => {
  test('covers editable text-like controls without swallowing toggles or sliders', () => {
    for (const selector of [
      'input:not([type])',
      'input[type="email"]',
      'input[type="number"]',
      'input[type="search"]',
      'input[type="text"]',
      'input[type="url"]',
      'select',
      'textarea',
    ]) assert.ok(css.includes(selector), `missing ${selector}`);
    assert.doesNotMatch(css, /input\[type="(?:checkbox|radio|range)"\][\s\S]*--game-field-rgb/);
  });

  test('uses a layered instrument surface with hover, focus, invalid, disabled, and readonly states', () => {
    assert.match(css, /--game-field-rgb:\s*245, 166, 35/);
    assert.match(css, /repeating-linear-gradient\(125deg/);
    assert.match(css, /inset 3px 0 rgba\(var\(--game-field-rgb\)/);
    assert.match(css, /:hover:not\(:disabled\)/);
    assert.match(css, /0 0 20px rgba\(var\(--game-field-rgb\), 0\.2\)/);
    assert.match(css, /\[aria-invalid="true"\]/);
    assert.match(css, /:user-invalid/);
    assert.match(css, /\[readonly\]/);
  });

  test('themes old bare fields while allowing product shells to keep their scoped treatment', () => {
    assert.match(css, /\.acct-switcher-select/);
    assert.match(css, /\.player-search-input/);
    assert.match(css, /\.replay-select/);
    assert.match(css, /\.viewer-scrubber__jump/);
    assert.match(css, /\.aff-customize-input/);
    assert.match(css, /\.feedback-form textarea/);
    assert.match(css, /Product controls[\s\S]*keep their stronger scoped styling later in app\.css/);
  });
});
