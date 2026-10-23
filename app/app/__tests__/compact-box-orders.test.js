// Compact box orders, the 85-bit queue entry (three per word) and the Degenesis order feed. LOOTBOX-COMPACT-ORDER-CLIENT-HANDOFF §9 acceptance checks for the browser readers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';
import { pendingBoxWord, boxQueueEntry } from '../../chain/recycling.js';
import { arraySlot } from '../../chain/client.js';
import { degenesisOrders } from '../../chain/feeds.js';
import {
  encodeBoxScoreCode, decodeBoxScoreCode, decodeBoxQueueEntry, BOX_ENTRY_VALUE_UNIT_WEI,
} from '../box-queue-rolls.js';
import { ETH_DIVISOR } from '../chain-config.js';

const entryFor = ({ id = 37n, units = 10n, code = 0n, boost = 0n, quantity = 1n, distress = 0n } = {}) =>
  id | (units << 32n) | (code << 53n) | (boost << 65n) | (quantity << 77n) | (distress << 84n);

test('§4 score code round trip: exact to 2,042, 14-point steps above, clamp at 30,000', () => {
  const cases = [
    [0n, 0n, 0n], [2042n, 2042n, 2042n], [2043n, 2042n, 2042n], [2055n, 2042n, 2042n],
    [2056n, 2043n, 2056n], [4096n, 2188n, 4086n], [30000n, 4039n, 30000n],
    [30001n, 4039n, 30000n], [65534n, 4039n, 30000n],
  ];
  for (const [score, code, decoded] of cases) {
    assert.equal(encodeBoxScoreCode(score), code, `encode ${score}`);
    assert.equal(decodeBoxScoreCode(code), decoded, `decode ${score}`);
    assert.ok(score - decodeBoxScoreCode(encodeBoxScoreCode(score)) <= 13n || score > 30000n,
      'at most 13 points low below the cap');
  }
});

test('§2 entry fields decode exactly; the value unit follows the chain profile', () => {
  assert.equal(BOX_ENTRY_VALUE_UNIT_WEI, (10n ** 15n) / ETH_DIVISOR);
  const order = decodeBoxQueueEntry(entryFor({ id: 0xffffffffn, units: 2_000_000n, code: 4039n, boost: 2500n, quantity: 100n, distress: 1n }));
  assert.equal(order.id, 0xffffffffn);
  assert.equal(order.units, 2_000_000n);
  assert.equal(order.score, 30000n);
  assert.equal(order.boostBps, 2500n);
  assert.equal(order.quantity, 100);
  assert.equal(order.distress, true);
  assert.equal(order.perBoxWei, 2_000_000n * BOX_ENTRY_VALUE_UNIT_WEI);
  assert.equal(order.nominalWei, 100n * 2_000_000n * BOX_ENTRY_VALUE_UNIT_WEI);
  assert.ok(entryFor({ id: 0xffffffffn, units: 0x1fffffn, code: 0xfffn, boost: 0xfffn, quantity: 0x7fn, distress: 1n }) < 1n << 85n,
    'one entry fits 85 bits');
});

test('§3 raw reads at positions 0-6 return word p / 3, lane p % 3, bounded by the count', async () => {
  const f = await rpcFixture(); await f.wallet(37, PLAYER); await f.wallet(73, OTHER_PLAYER);
  const { slot } = await f.s.location('GAME', 'boxQueue', [0]);
  const entries = Array.from({ length: 7 }, (_, p) => entryFor({ id: p === 4 ? 73n : 37n, units: 10n + BigInt(p), quantity: BigInt(p + 1) }));
  for (let w = 0; w < 3; w++) {
    let word = 0n;
    for (let lane = 0; lane < 3 && w * 3 + lane < 7; lane++) word |= entries[w * 3 + lane] << BigInt(lane * 85);
    assert.equal(word >> 255n, 0n, 'bit 255 is always zero');
    f.storage.set(`${f.contracts.GAME.toLowerCase()}:${arraySlot(slot) + BigInt(w)}`, word);
  }
  // Word 3 holds a stale lane from an older cohort: never read past the count.
  f.storage.set(`${f.contracts.GAME.toLowerCase()}:${arraySlot(slot) + 3n}`, entryFor({ units: 999n }) << 85n);
  // Buffer 0 is the write buffer here; the count lives in lootboxRngPacked bits 120-151.
  await f.field('GAME', 'lootboxRngPacked', 7n << 120n);
  for (let p = 0; p < 7; p++) {
    assert.equal(await boxQueueEntry(f.s, 0, p), entries[p], `position ${p}`);
    assert.equal(await pendingBoxWord(f.s, 'boxQueue', 0, PLAYER, p), p === 4 ? 0n : entries[p],
      `position ${p} belongs to wallet ${p === 4 ? 73 : 37}`);
  }
  assert.equal(await pendingBoxWord(f.s, 'boxQueue', 0, OTHER_PLAYER, 4), entries[4]);
  assert.equal(await pendingBoxWord(f.s, 'boxQueue', 0, PLAYER, 10), 0n, 'beyond the count reads nothing');
});

test('Degenesis orders join DegenesisBuy with DegenesisOrderResolved by cohort day and index', async () => {
  const f = await rpcFixture(); await f.wallet(37, PLAYER); await f.wallet(73, OTHER_PLAYER);
  await f.event('GAME', 'DegenesisBuy', { buyer: 37, degenesisDay: 1, orderIndex: 0, amount: 10_000_000_000n, secondsIntoDay: 12 }, { block: 9990 });
  await f.event('GAME', 'DegenesisBuy', { buyer: 73, degenesisDay: 1, orderIndex: 1, amount: 20_000_000_000n, secondsIntoDay: 30 }, { block: 9990 });
  await f.event('GAME', 'DegenesisBuy', { buyer: 37, degenesisDay: 2, orderIndex: 0, amount: 30_000_000_000n, secondsIntoDay: 300 }, { block: 9991 });
  await f.event('GAME', 'DegenesisOrderResolved', { id: 37, degenesisDay: 1, orderIndex: 0, amount: 10_000_000_000n,
    flip: 25, dgnrs: 0, wwxrp: 1, normalPasses: 0, highPasses: 2 }, { block: 9995 });
  const { items, supported } = await degenesisOrders(f.s, PLAYER);
  assert.equal(supported, true);
  assert.deepEqual(items.map((row) => [row.degenesisDay, row.orderIndex, row.amountRawWei, row.resolved?.highPasses ?? null]),
    [[2, 0, '30000000000', null], [1, 0, '10000000000', 2]], 'newest first; only this wallet; day 2 still pending');
  // Event rows carry FLIP/WWXRP (and 12-decimal sDGNRS) in 18-decimal token wei (token-units.js).
  assert.equal(items[1].resolved.flip, String(25n * 10n ** 18n));
  assert.equal(items[1].resolved.wwxrp, String(10n ** 18n));
});
