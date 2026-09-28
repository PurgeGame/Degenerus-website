import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from '../../vendor/ethers-app.mjs';
import {
  FOIL_CLAIM_ABI_CURRENT,
  FOIL_CLAIM_ABI_RUN56,
  FOIL_TIER_FACES,
  FOIL_TIER_FACES_RUN56,
  __resetContractFactoryForTest,
  __setContractFactoryForTest,
  claimFoilMatch,
  foilClaimAbi,
  foilTierFaces,
  parseFoilMatchClaimedFromReceipt,
} from '../foil-claim.js';
import { decodeRevertReason } from '../reason-map.js';
import { clearProvider, setProvider } from '../contracts.js';
import { update } from '../store.js';
import { CHAIN } from '../chain-config.js';
import { useSchema, loadSchema, CURRENT_SCHEMA_HASH, RUN56_SCHEMA_HASH } from '../../chain/schema.js';

const PLAYER = '0x1234567890123456789012345678901234567890';
const RUN56_DEFAULT = useSchema(RUN56_SCHEMA_HASH);
afterEach(() => {
  useSchema(RUN56_DEFAULT);
  __resetContractFactoryForTest();
  clearProvider();
  update('connected.address', null);
});

test('foil claim ABI decodes terminal permissionless races', () => {
  for (const abi of [FOIL_CLAIM_ABI_RUN56, FOIL_CLAIM_ABI_CURRENT]) {
    assert.ok(abi.includes('error NoClaimableMatch()'));
    assert.ok(abi.includes('error GameOver()'));
  }
  assert.deepEqual(decodeRevertReason({ revert: { name: 'NoClaimableMatch' } }), {
    code: 'NoClaimableMatch',
    userMessage: 'This foil match is already settled.',
    recoveryAction: 'Refresh foil results.',
  });
});

// The hand-written ABI must be the deployed one: same claim selector and event topic as the
// generated game schema of each deployment.
test('each deployment claims with its own calldata and event shape', async () => {
  for (const schema of [RUN56_SCHEMA_HASH, CURRENT_SCHEMA_HASH]) {
    useSchema(schema);
    const deployed = new Interface((await loadSchema('GAME')).abi);
    const ours = new Interface(foilClaimAbi());
    assert.equal(ours.getFunction('claimFoilMatch').selector, deployed.getFunction('claimFoilMatch').selector);
    assert.equal(ours.getEvent('FoilMatchClaimed').topicHash, deployed.getEvent('FoilMatchClaimed').topicHash);
  }
  useSchema(CURRENT_SCHEMA_HASH);
  assert.equal(foilClaimAbi(), FOIL_CLAIM_ABI_CURRENT);
  useSchema(RUN56_SCHEMA_HASH);
  assert.equal(foilClaimAbi(), FOIL_CLAIM_ABI_RUN56);
});

test('the face table follows the deployment (FoilPackModule FOIL_FACES_T4..T8)', () => {
  assert.deepEqual(FOIL_TIER_FACES_RUN56, { 4: 8, 5: 24, 6: 140, 7: 1_600, 8: 40_000 });
  assert.deepEqual(FOIL_TIER_FACES, { 4: 16, 5: 48, 6: 280, 7: 3_200, 8: 80_000 });
  useSchema(CURRENT_SCHEMA_HASH);
  assert.equal(foilTierFaces(), FOIL_TIER_FACES);
  useSchema(RUN56_SCHEMA_HASH);
  assert.equal(foilTierFaces(), FOIL_TIER_FACES_RUN56);
});

async function sendClaim(schema, drawKind) {
  useSchema(schema);
  let simulated = null; let sent = null;
  const receipt = { status: 1, logs: [], hash: '0xfoilclaim', blockNumber: 99 };
  const method = async (...args) => { sent = args; return { hash: receipt.hash, wait: async () => receipt }; };
  method.staticCall = async (...args) => { simulated = args; };
  const contract = { claimFoilMatch: method, connect() { return this; }, interface: { parseLog() { return null; } } };
  update('connected.address', PLAYER);
  setProvider({ getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }), getSigner: async () => ({ getAddress: async () => PLAYER }) });
  __setContractFactoryForTest(() => contract);
  await claimFoilMatch({ player: PLAYER, day: 44, ticketIndex: 2, drawKind });
  return { simulated, sent };
}

test('the claim tx matches the deployment: drawKind only on run 56', async () => {
  const run56 = await sendClaim(RUN56_SCHEMA_HASH, 1);
  assert.deepEqual(run56.simulated, [PLAYER, 44n, 2n, 1]);
  assert.deepEqual(run56.sent, [PLAYER, 44n, 2n, 1]);
  const current = await sendClaim(CURRENT_SCHEMA_HASH, 0);
  assert.deepEqual(current.simulated, [PLAYER, 44n, 2n], 'run 57+ has one board, so no draw to name');
  assert.deepEqual(current.sent, [PLAYER, 44n, 2n]);
});

test('claim receipts parse per deployment; a run-57+ claim is the main draw', () => {
  for (const schema of [RUN56_SCHEMA_HASH, CURRENT_SCHEMA_HASH]) {
    useSchema(schema);
    const iface = new Interface(foilClaimAbi());
    const run56 = schema === RUN56_SCHEMA_HASH;
    const log = iface.encodeEventLog('FoilMatchClaimed', run56 ? [PLAYER, 44, 2, 1, 6, 140] : [PLAYER, 44, 2, 6, 280]);
    const rows = parseFoilMatchClaimedFromReceipt({ logs: [log] }, { interface: iface });
    assert.deepEqual(rows, [{ player: PLAYER, day: 44, ticketIndex: 2, drawKind: run56 ? 1 : 0, tier: 6, faces: run56 ? 140 : 280 }]);
    assert.equal(rows[0].faces, foilTierFaces()[6], 'the event faces and the site table agree');
  }
});
