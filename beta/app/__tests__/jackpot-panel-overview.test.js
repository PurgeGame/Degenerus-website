import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANEL_SRC = readFileSync(join(__dirname, '../../components/jackpot-panel.js'), 'utf8');
const CSS_SRC   = readFileSync(join(__dirname, '../../styles/jackpot.css'), 'utf8');

test('jp-overview details element exists in template with non-empty summary', () => {
  assert.match(PANEL_SRC, /<details[^>]*class="jp-overview"[^>]*data-bind="jp-overview">/);
  assert.match(PANEL_SRC, /<summary>\s*Day Overview\s*<\/summary>/);
});

test('jp-overview is positioned between jp-replay-section and jp-winners in source', () => {
  const replayIdx  = PANEL_SRC.indexOf('jp-replay-section');
  const overviewIdx = PANEL_SRC.indexOf('class="jp-overview"');
  const winnersIdx = PANEL_SRC.indexOf('class="jp-winners"');
  assert.ok(replayIdx > 0 && overviewIdx > 0 && winnersIdx > 0, 'all three markers present');
  assert.ok(replayIdx < overviewIdx, 'replay-section before overview');
  assert.ok(overviewIdx < winnersIdx, 'overview before winners');
});

test('jp-overview CSS has visibility guarantees (plan 39-08 defensive block)', () => {
  // 39-06 base styles
  assert.match(CSS_SRC, /\.jp-overview\s*\{[^}]*border[^}]*\}/);
  assert.match(CSS_SRC, /\.jp-overview\[open\]\s*>\s*summary::before/);
  // 39-08 defensive hardening
  assert.match(CSS_SRC, /Plan 39-08: Defensive guarantees/);
  assert.match(CSS_SRC, /\.jp-day-port\s*>\s*\.jp-overview[^{]*\{[^}]*display:\s*block\s*!important/);
});

test('jp-overview is NOT inside a shadow root (light DOM only)', () => {
  assert.doesNotMatch(PANEL_SRC, /attachShadow/);
});
