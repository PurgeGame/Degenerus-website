// /app/app/__tests__/work-queue.test.js
// Run: cd website && node --test app/app/__tests__/work-queue.test.js
//
// Covers the contract-authoritative Mine FLIP probe queue consumed by the
// bottom pending-actions tray. Claims and reveal work have their own publishers
// and must never leak into this resolver.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
globalThis.HTMLElement = globalThis.HTMLElement ?? class {};

const { buildWorkQueue, nextAction } = await import('../work-queue.js');
const { isNoWorkRevert, _testing: mineFlipTesting } = await import('../mine-flip.js');

describe('buildWorkQueue — Mine FLIP only', () => {
  test('requires a known successful contract simulation', () => {
    assert.deepEqual(buildWorkQueue(), []);
    assert.deepEqual(buildWorkQueue({ probe: null }), []);
    assert.deepEqual(buildWorkQueue({ probe: { known: false, hasWork: true } }), []);
    assert.deepEqual(buildWorkQueue({ probe: { known: true, hasWork: false } }), []);
  });

  test('a known positive probe produces exactly one executable crank row', async () => {
    const queue = buildWorkQueue({ probe: { known: true, hasWork: true } });
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, 'mineFlip');
    assert.equal(queue[0].label, 'Mine FLIP');
    assert.equal(queue[0].autoRun, true);
    assert.equal(typeof queue[0].run, 'function');
  });

  test('ignores unrelated pending/claim compatibility fields', () => {
    const queue = buildWorkQueue({
      probe: { known: true, hasWork: true },
      pending: {
        eth: { amount: '99' },
        tickets: { amount: '400' },
        lootbox: { state: 'ready' },
      },
    });
    assert.deepEqual(queue.map((item) => item.id), ['mineFlip']);
  });
});

describe('nextAction', () => {
  test('returns the executable crank and nothing else', () => {
    const crank = buildWorkQueue({ probe: { known: true, hasWork: true } });
    assert.equal(nextAction(crank)?.id, 'mineFlip');
    assert.equal(nextAction([]), null);
    assert.equal(nextAction(undefined), null);
    assert.equal(nextAction([{ id: 'eth', autoRun: true }]), null);
  });
});

describe('isNoWorkRevert — stale permissionless work', () => {
  test('matches raw and ethers-decoded NoWork errors', () => {
    assert.equal(isNoWorkRevert({ data: mineFlipTesting.NO_WORK_SELECTOR }), true);
    assert.equal(isNoWorkRevert({ revert: { name: 'NoWork' } }), true);
    assert.equal(isNoWorkRevert({ revert: { name: 'NotApproved' } }), false);
    assert.equal(isNoWorkRevert(null), false);
  });
});

describe('source gates', () => {
  const mineFlipSource = readFileSync(resolvePath(__dirname, '../mine-flip.js'), 'utf8');
  const queueSource = readFileSync(resolvePath(__dirname, '../work-queue.js'), 'utf8');

  test('pins the deployed selector and keeper-tested gas ceiling', () => {
    assert.equal(mineFlipTesting.NO_WORK_SELECTOR, '0x5c78c46f');
    assert.equal(mineFlipTesting.MINE_FLIP_MIN_GAS_LIMIT, 10_000_000n);
    assert.equal(mineFlipTesting.MINE_FLIP_MAX_GAS_LIMIT, 16_000_000n);
    assert.match(mineFlipSource, /gasEstimateWithHeadroom\(estimate\)/);
    assert.match(mineFlipSource, /balance\s*>=\s*requiredWei/);
    assert.match(mineFlipSource, /contract\.mineFlip\(\{ gasLimit \}\)/,
      'every sent Mine FLIP transaction carries the shared gas floor');
  });

  test('the affordability quote and send path share a 10m minimum gas budget', async () => {
    const mine = Object.assign(async () => {}, { estimateGas: async () => 125_000n });
    const budget = await mineFlipTesting.mineFlipGasBudget(
      { mineFlip: mine, connect() { return this; } },
      { getAddress: async () => '0xab12000000000000000000000000000000000000' },
      {
        getBalance: async () => 10n ** 18n,
        getFeeData: async () => ({ maxFeePerGas: 1_000_000_000n }),
      },
    );
    assert.equal(budget.gasLimit, 10_000_000n);
    assert.equal(budget.requiredWei, 10_000_000n * 1_000_000_000n);
  });

  test('uses only the deployed mineFlip entrypoint and closure-form sendTx', () => {
    assert.equal(mineFlipTesting.CRANK_NAME, 'mineFlip');
    assert.equal(/mintFlip/.test(mineFlipSource.replace(/^\s*\/\/.*$/gm, '')), false);
    assert.match(mineFlipSource, /sendTx\(\s*\(s\) =>/);
  });

  test('does not reimplement the contract work predicate or import claim feeds', () => {
    assert.equal(/advanceDue|jackpotPhaseFlag|rngLock/.test(queueSource), false);
    assert.equal(/fetchPending|\/pending|claimable/.test(queueSource), false);
  });
});
