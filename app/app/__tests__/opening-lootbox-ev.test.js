import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSchema, CURRENT_SCHEMA_HASH } from '../../chain/schema.js';
import { boxReference } from '../../chain/box-queue.js';
import { queuedBoxRolls } from '../box-queue-rolls.js';
import { deriveHumanLootboxAuraTiers, deriveHumanLootboxBoonType, deriveHumanLootboxSpinBetIds, deriveHumanBoxSpinPayoutAtRisk } from '../lootbox-legs.js';

function current(fn) {
  const previous = useSchema(CURRENT_SCHEMA_HASH);
  try { fn(); } finally { useSchema(previous); }
}
const args = () => ({
  packedBox: 37n | (12n << 32n) | (30000n << 56n) | (2500n << 71n)
    | (10000n << 85n) | (2n << 100n),
  rngWord: 123456789n, lootboxIndex: boxReference(0, 7), currentLevel: 13,
});

test('opening EV never mistakes the reserved purchase lane for a bonus allowance', () => current(() => {
  const input = args();
  const rolls = queuedBoxRolls(input, () => 10000n, () => 14500n);
  assert.deepEqual(rolls.rolls.map(row => row.scaled), [null, null]);
  assert.equal(deriveHumanLootboxBoonType(input), null);
  assert.equal(deriveHumanLootboxSpinBetIds(input).length, 6);
  assert.equal(deriveHumanLootboxAuraTiers(input).length, 2);
  assert.equal(deriveHumanBoxSpinPayoutAtRisk({ ...input, spin: {
    spinType: 'flip', betId: deriveHumanLootboxSpinBetIds(input)[1],
  } }), 0n, 'a lost flip must not acquire a fabricated pre-survival stake');
}));

test('an exact opening allowance scales the raw amount without increasing the boon boost', () => current(() => {
  const input = { ...args(), openingEvBps: 5000n };
  const rolls = queuedBoxRolls(input, () => 10000n, () => 14500n);
  assert.deepEqual(rolls.rolls.map(row => row.scaled), [14750n, 14750n]);
  const exhausted = queuedBoxRolls({ ...input, openingEvBps: 0n }, () => 10000n, () => 14500n);
  assert.deepEqual(exhausted.rolls.map(row => row.scaled), [12500n, 12500n]);
  assert.deepEqual(rolls.rolls.map(row => row.seed), exhausted.rolls.map(row => row.seed));
  assert.throws(() => queuedBoxRolls({ ...input, openingEvBps: 10001n }, () => 10000n, () => 14500n), /Invalid opening EV/);
}));

test('neutral and penalty scores remain exactly replayable without an opening allowance', () => current(() => {
  assert.deepEqual(queuedBoxRolls(args(), () => 10000n, () => 8000n).rolls.map(row => row.scaled), [10000n, 10000n]);
  assert.deepEqual(queuedBoxRolls(args(), () => 10000n, () => 10000n).rolls.map(row => row.scaled), [12500n, 12500n]);
}));
