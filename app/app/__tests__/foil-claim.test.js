import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from '../../vendor/ethers-app.mjs';
import {
  FOIL_CLAIM_ABI_CURRENT,
  FOIL_TIER_FACES,
  __resetContractFactoryForTest,
  __setContractFactoryForTest,
  claimFoilMatch,
  foilClaimAbi,
  foilTierFaces,
  parseFoilMatchClaimedFromReceipt,
} from '../foil-claim.js';
import { rpcFixture } from './helpers/chain-rpc.js';
import { prepareWalletReceipt } from '../wallet-receipt.js';
import { decodeRevertReason } from '../reason-map.js';
import { clearProvider, setProvider } from '../contracts.js';
import { update } from '../store.js';
import { CHAIN } from '../chain-config.js';
import { loadSchema } from '../../chain/schema.js';

const PLAYER = '0x1234567890123456789012345678901234567890';
afterEach(() => {
  __resetContractFactoryForTest();
  clearProvider();
  update('connected.address', null);
});

test('foil claim ABI decodes terminal permissionless races', () => {
  assert.ok(FOIL_CLAIM_ABI_CURRENT.includes('error NoClaimableMatch()'));
  assert.ok(FOIL_CLAIM_ABI_CURRENT.includes('error GameOver()'));
  assert.deepEqual(decodeRevertReason({ revert: { name: 'NoClaimableMatch' } }), {
    code: 'NoClaimableMatch',
    userMessage: 'This foil match is already settled.',
    recoveryAction: 'Refresh foil results.',
  });
});

// The hand-written ABI must be the deployed one: same claim selector and event topic as the
// generated game schema.
test('the claim ABI carries the deployed calldata and event shape', async () => {
  const deployed = new Interface((await loadSchema('GAME')).abi);
  const ours = new Interface(foilClaimAbi());
  assert.equal(ours.getFunction('claimFoilMatch').selector, deployed.getFunction('claimFoilMatch').selector);
  assert.equal(ours.getEvent('FoilMatchClaimed').topicHash, deployed.getEvent('FoilMatchClaimed').topicHash);
});

test('the face table matches FoilPackModule FOIL_FACES_T4..T8', () => {
  assert.deepEqual(FOIL_TIER_FACES, { 4: 16, 5: 48, 6: 280, 7: 3_200, 8: 80_000 });
  assert.equal(foilTierFaces(), FOIL_TIER_FACES);
});

async function sendClaim(player) {
  let simulated = null; let sent = null;
  const receipt = { status: 1, logs: [], hash: '0xfoilclaim', blockNumber: 99 };
  const method = async (...args) => { sent = args; return { hash: receipt.hash, wait: async () => receipt }; };
  method.staticCall = async (...args) => { simulated = args; };
  const contract = { claimFoilMatch: method, connect() { return this; }, interface: { parseLog() { return null; } } };
  update('connected.address', PLAYER);
  setProvider({ getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }), getSigner: async () => ({ getAddress: async () => PLAYER }) });
  __setContractFactoryForTest(() => contract);
  await claimFoilMatch({ player, day: 44, ticketIndex: 2 });
  return { simulated, sent };
}

test('the claim tx names the caller by ID zero and has no draw-kind argument', async () => {
  const claim = await sendClaim(PLAYER);
  assert.deepEqual(claim.simulated, [0, 44n, 2n], 'one board a day, so no draw to name; the caller resolves with ID zero');
  assert.deepEqual(claim.sent, [0, 44n, 2n]);
});

test('claim receipts parse; a claim is always the main draw', async () => {
  const iface = new Interface(foilClaimAbi());
  const f = await rpcFixture();
  await f.wallet(37, PLAYER);
  const log = await f.event('GAME', 'FoilMatchClaimed', { id: 37, day: 44, ticketIndex: 2, tier: 6, faces: 280 });
  const receipt = { blockNumber: 9999, logs: [log] };
  await prepareWalletReceipt(receipt, f.client);
  const rows = parseFoilMatchClaimedFromReceipt(receipt, { interface: iface });
  assert.deepEqual(rows, [{ player: PLAYER, day: 44, ticketIndex: 2, drawKind: 0, tier: 6, faces: 280 }]);
  assert.equal(rows[0].faces, foilTierFaces()[6], 'the event faces and the site table agree');
});
