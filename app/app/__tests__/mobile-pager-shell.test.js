import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../styles/mobile-pager.css', import.meta.url), 'utf8');

// Android Chrome resolves 100vh to the toolbar-hidden height. The shared
// body min-height: 100vh (nav.css, site-composition.css) made the phone shell
// taller than the visible screen and pushed the section dock below it.
test('the phone shell resets the shared body min-height so the dock stays on screen', () => {
  const shell = css.match(/body\.layout-basic \{\s*display: flex;\s*flex-direction: column;[^}]*\}/)?.[0];
  assert.ok(shell, 'phone shell body rule present');
  assert.match(shell, /height: 100dvh;/);
  assert.match(shell, /min-height: 0;/);
});
