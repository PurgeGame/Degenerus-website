import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../replay-panel.js', import.meta.url), 'utf8');

test('processing-day retries wait for roll payloads before loading day distributions', () => {
  const handler = source.match(
    /async #onDayChange\(e\)\s*\{([\s\S]*?)\n  #onPlayerChange/,
  )?.[1] || '';
  const rollsAt = handler.indexOf('const rolls = await this.#loadDayRolls(dayNum)');
  const detailAt = handler.indexOf('const detail = await this.#loadDayDetail(dayNum)');

  assert.ok(rollsAt >= 0, 'the retry path loads exact roll readiness');
  assert.ok(detailAt > rollsAt, 'large day detail is never loaded ahead of roll readiness');
  assert.match(
    handler,
    /const rollPayloadsReady =[\s\S]*?if \(rollPayloadsReady\) \{[\s\S]*?await this\.#loadDayDetail\(dayNum\)/,
    'day detail remains behind the complete-roll guard',
  );
});
