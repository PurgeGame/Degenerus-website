import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('settled replay helpers import without a DOM or interactive panel registration', async () => {
  assert.equal(typeof globalThis.HTMLElement, 'undefined');
  const replay = await import('../degenerette-replay.js');
  assert.equal(replay.dgnDecodePacked((3n << 32n).toString()).spinCount, 3);
  assert.deepEqual(replay.degeneretteReplaySequences({ kind: 'degenerette' }), [{ kind: 'degenerette' }]);
  assert.equal(typeof globalThis.customElements, 'undefined');
  for (const name of ['app-day-history-replays', 'app-transaction-history']) {
    const source = readFileSync(new URL(`../../components/${name}.js`, import.meta.url), 'utf8');
    assert.match(source, /from '\.\.\/app\/degenerette-replay\.js'/);
    assert.doesNotMatch(source, /from '\.\/app-degenerette-panel\.js'/,
      'history must not import the wager panel as a helper dependency');
  }
});
