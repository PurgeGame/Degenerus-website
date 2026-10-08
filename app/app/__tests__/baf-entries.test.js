import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSchema, CURRENT_SCHEMA_HASH, BEFORE_BAF_CANDIDATES_SCHEMA_HASH } from '../../chain/schema.js';
import { readChainRoute } from '../../chain/router.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';

test('BAF transcript keeps every personal near-level spot, including repeated and non-winning candidates', async () => {
  const prior = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const f = await rpcFixture(); await f.wallet(37, PLAYER); await f.wallet(73, OTHER_PLAYER);
    const event = (args, index) => f.event('GAME', 'BafCandidates', {
      level: 10, day: 119, round: index, sourceLevel: 10, traitId: 7, candidates: [73, 37, 37, 0], ...args,
    }, { block: 9991, index });
    await event({}, 0);
    await event({ sourceLevel: 11, traitId: 78, candidates: [37, 73] }, 1);
    await event({ sourceLevel: 12 }, 2); // never expose far-future candidates
    await event({ day: 118 }, 3);
    await event({ candidates: [73] }, 4);
    const data = await readChainRoute(`/player/${PLAYER}/baf-entries?day=119`, { client: f.client });
    assert.equal(data.supported, true); assert.equal(data.level, 10);
    assert.deepEqual(data.entries.map(({ sourceLevel, traitId, round, spots }) => ({ sourceLevel, traitId, round, spots })), [
      { sourceLevel: 10, traitId: 7, round: 0, spots: [1, 2] },
      { sourceLevel: 11, traitId: 78, round: 1, spots: [0] },
    ]);
    assert.ok(data.entries.every(row => !('winner' in row)), 'sampling is never presented as a prize');
  } finally { useSchema(prior); }
});

test('BAF reader distinguishes an empty personal result from an old deployment without transcripts', async () => {
  const prior = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const f = await rpcFixture(); await f.wallet(37, PLAYER);
    await f.event('GAME', 'BafCandidates', { level: 20, day: 119, round: 0, sourceLevel: 20, traitId: 0, candidates: [] });
    const result = await readChainRoute(`/player/${PLAYER}/baf-entries?day=119`, { client: f.client });
    assert.equal(result.level, 20); assert.deepEqual(result.entries, []);
    useSchema(BEFORE_BAF_CANDIDATES_SCHEMA_HASH);
    const legacy = await rpcFixture();
    const old = await readChainRoute(`/player/${PLAYER}/baf-entries?day=119`, { client: legacy.client });
    assert.equal(old.supported, false); assert.equal(old.level, null);
  } finally { useSchema(prior); }
});
