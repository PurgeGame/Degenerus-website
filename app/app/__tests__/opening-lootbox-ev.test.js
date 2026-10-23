import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxReference } from '../../chain/box-queue.js';
import { queuedBoxRolls, BOX_ENTRY_VALUE_UNIT_WEI } from '../box-queue-rolls.js';
import { deriveHumanLootboxAuraTiers, deriveHumanLootboxBoonType, deriveHumanLootboxSpinBetIds, deriveHumanBoxSpinPayoutAtRisk } from '../lootbox-legs.js';

// §2 entry (audit 4f4aa8377): wallet 37, 10 value units per box, score code 4,039 (30,000),
// boost 2,500 bps, quantity 2. The EV allowance is drawn at opening, never stored.
const UNIT = BOX_ENTRY_VALUE_UNIT_WEI;
const args = () => ({
  packedBox: 37n | (10n << 32n) | (4039n << 53n) | (2500n << 65n) | (2n << 77n),
  rngWord: 123456789n, lootboxIndex: boxReference(0, 7), currentLevel: 13,
});

test('opening EV never mistakes the reserved purchase lane for a bonus allowance', () => {
  const input = args();
  const rolls = queuedBoxRolls(input, () => 10000n, () => 14500n);
  assert.deepEqual(rolls.rolls.map(row => row.scaled), [null, null]);
  assert.equal(deriveHumanLootboxBoonType(input), null);
  assert.equal(deriveHumanLootboxSpinBetIds(input).length, 6);
  assert.equal(deriveHumanLootboxAuraTiers(input).length, 2);
  assert.equal(deriveHumanBoxSpinPayoutAtRisk({ ...input, spin: {
    spinType: 'flip', betId: deriveHumanLootboxSpinBetIds(input)[1],
  } }), 0n, 'a lost flip must not acquire a fabricated pre-survival stake');
});

test('an exact opening allowance scales the raw amount without increasing the boon boost', () => {
  const input = { ...args(), openingEvBps: 5000n };
  const rolls = queuedBoxRolls(input, () => 10000n, () => 14500n);
  assert.deepEqual(rolls.rolls.map(row => row.scaled), [1475n * UNIT, 1475n * UNIT].map(v => v / 100n));
  const exhausted = queuedBoxRolls({ ...input, openingEvBps: 0n }, () => 10000n, () => 14500n);
  assert.deepEqual(exhausted.rolls.map(row => row.scaled), [1250n * UNIT / 100n, 1250n * UNIT / 100n]);
  assert.deepEqual(rolls.rolls.map(row => row.seed), exhausted.rolls.map(row => row.seed));
  assert.throws(() => queuedBoxRolls({ ...input, openingEvBps: 10001n }, () => 10000n, () => 14500n), /Invalid opening EV/);
});

test('neutral and penalty scores remain exactly replayable without an opening allowance', () => {
  assert.deepEqual(queuedBoxRolls(args(), () => 10000n, () => 8000n).rolls.map(row => row.scaled), [10n * UNIT, 10n * UNIT]);
  assert.deepEqual(queuedBoxRolls(args(), () => 10000n, () => 10000n).rolls.map(row => row.scaled), [1250n * UNIT / 100n, 1250n * UNIT / 100n]);
});
