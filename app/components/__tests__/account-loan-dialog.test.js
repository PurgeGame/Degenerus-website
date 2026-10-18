import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxRepayment } from '../account-loan-dialog.js';

test('max repayment mirrors repay(): 5% per used level, 1% per unused, at least one used', () => {
  // One-level term: the only repayable level counts as one used level.
  assert.equal(maxRepayment(10_000n, 10, 11), 10_500n);
  // Five-level term repaid at the last repayable level: four used, one unused.
  assert.equal(maxRepayment(10_000n, 10, 15), 12_100n);
});
