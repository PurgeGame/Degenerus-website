// db/craps-schedule.mjs: the six-period schedule build-chain-manifest.mjs pins into a deployment's
// crapsSchedule, parsed from CrapsBattle._currentBonusSlot's if-chain (audit 0889affc1), against the
// vendored run-57 sources the launcher deploys: the 1,200 s testnet overlay and the mainnet tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCrapsSchedule } from '../../../db/craps-schedule.mjs';

const SIM = new URL('../../../../degenerus-sim/', import.meta.url);
const source = (tree) => readFileSync(new URL(`${tree}/CrapsBattle.sol`, SIM), 'utf8');

test('the testnet overlay closes periods 0-4 at 300, 480, 660, 840 and 1,020 s of a 1,200 s day', () => {
  assert.deepEqual(parseCrapsSchedule(source('contracts-testnet'), { anchor: 82_620, period: 1_200 }), [300, 480, 660, 840, 1_020]);
});

test('mainnet closes at 20 min, 6 h 3 min, 12 h 3 min, 18 h 3 min and a day less 20 min', () => {
  assert.deepEqual(parseCrapsSchedule(source('contracts'), { anchor: 82_620, period: 86_400 }), [1_200, 21_780, 43_380, 64_980, 85_200]);
});

test('the parse refuses a schedule that disagrees with the day clock or loses a close', () => {
  const overlay = source('contracts-testnet');
  assert.throws(() => parseCrapsSchedule(overlay, { anchor: 0, period: 1_200 }), /anchor/);
  assert.throws(() => parseCrapsSchedule(overlay, { anchor: 82_620, period: 600 }), /modulus/);
  assert.throws(() => parseCrapsSchedule(overlay.replace(/else if \(elapsed < 660 seconds\) period = 2;/, ''), { anchor: 82_620, period: 1_200 }));
});
