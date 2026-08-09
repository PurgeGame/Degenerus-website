import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOIL_CLAIM_ABI } from '../foil-claim.js';
import { decodeRevertReason } from '../reason-map.js';

test('foil claim ABI decodes terminal permissionless races', () => {
  assert.ok(FOIL_CLAIM_ABI.includes('error NoClaimableMatch()'));
  assert.ok(FOIL_CLAIM_ABI.includes('error GameOver()'));
  assert.deepEqual(decodeRevertReason({ revert: { name: 'NoClaimableMatch' } }), {
    code: 'NoClaimableMatch',
    userMessage: 'This foil match is already settled.',
    recoveryAction: 'Refresh foil results.',
  });
});
