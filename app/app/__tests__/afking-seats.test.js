import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Interface, ZeroAddress } from '../../vendor/ethers-app.mjs';
import { afkingSeatForStart } from '../../chain/afking-seats.js';
import { setChainClientForTests } from '../../chain/client.js';
import { useSchema, CURRENT_SCHEMA_HASH, loadSchema } from '../../chain/schema.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';
import { CHAIN } from '../chain-config.js';
import { setProvider, clearProvider } from '../contracts.js';
import { update, __resetForTest } from '../store.js';
import * as passes from '../passes.js';

let previous;
beforeEach(() => { previous = useSchema(CURRENT_SCHEMA_HASH); });
afterEach(() => {
  useSchema(previous); setChainClientForTests(null); clearProvider();
  passes.__resetContractFactoryForTest(); __resetForTest();
});

async function fixture(active = false) {
  const f = await rpcFixture();
  f.answer('GAME_LENS', 'subInfoFull', ([game, player]) => {
    assert.equal(game.toLowerCase(), f.contracts.GAME);
    assert.equal(player.toLowerCase(), PLAYER);
    return [[active, active ? 10 : 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
  });
  f.answer('AFKING_SUB_TOKEN', 'nextSerial', () => assert.fail('must never scan global seat serials'));
  const owners = [];
  f.answer('AFKING_SUB_TOKEN', 'ownerOf', ([id]) => { owners.push(id); return [PLAYER]; });
  const transfer = (from, to, tokenId) => f.event('AFKING_SUB_TOKEN', 'Transfer', { from, to, tokenId });
  return { ...f, owners, transfer };
}

test('starting after hundreds of burned seats reads only this wallet’s selected seat', async () => {
  const f = await fixture();
  for (let id = 1; id < 389; id++) {
    await f.transfer(ZeroAddress, OTHER_PLAYER, id);
    await f.transfer(OTHER_PLAYER, ZeroAddress, id);
  }
  await f.transfer(ZeroAddress, PLAYER, 389);
  assert.equal(await afkingSeatForStart(PLAYER, { client: f.client }), 389n);
  assert.deepEqual(f.owners, [389n]);
  const logReads = f.requests.filter(row => row.method === 'eth_getLogs');
  assert.equal(logReads.length, 2);
  const walletTopic = '0x' + PLAYER.slice(2).padStart(64, '0');
  assert.ok(logReads.every(row => row.params[0].topics.includes(walletTopic)), 'history queries must filter by wallet');
});

test('burned and transferred-out seats are excluded without probing their owners', async () => {
  const f = await fixture();
  await f.transfer(ZeroAddress, PLAYER, 12);
  await f.transfer(PLAYER, ZeroAddress, 12);
  await f.transfer(ZeroAddress, PLAYER, 19);
  await f.transfer(PLAYER, OTHER_PLAYER, 19);
  await f.transfer(OTHER_PLAYER, PLAYER, 27);
  assert.equal(await afkingSeatForStart(PLAYER, { client: f.client }), 27n);
  assert.deepEqual(f.owners, [27n]);
});

test('returned seats and self-transfers retain ownership; the lowest owned serial is selected', async () => {
  const f = await fixture();
  await f.transfer(ZeroAddress, PLAYER, 8);
  await f.transfer(PLAYER, OTHER_PLAYER, 8);
  await f.transfer(ZeroAddress, PLAYER, 9);
  await f.transfer(OTHER_PLAYER, PLAYER, 8);
  await f.transfer(PLAYER, PLAYER, 8);
  assert.equal(await afkingSeatForStart(PLAYER, { client: f.client }), 8n);
  assert.deepEqual(f.owners, [8n]);
});

test('active subscription updates require no seat or transfer history', async () => {
  const f = await fixture(true);
  assert.equal(await afkingSeatForStart(PLAYER, { client: f.client }), 0n);
  assert.deepEqual(f.owners, []);
  assert.equal(f.requests.filter(row => row.method === 'eth_getLogs').length, 0);
});

test('no unused seat is reported only after successful history reads', async () => {
  const f = await fixture();
  await f.transfer(ZeroAddress, PLAYER, 8);
  await f.transfer(PLAYER, ZeroAddress, 8);
  await assert.rejects(afkingSeatForStart(PLAYER, { client: f.client }), /requires an unused seat/);
  assert.deepEqual(f.owners, []);
});

test('history failures propagate instead of being mistaken for missing seats', async () => {
  const f = await fixture();
  f.client.logs = async () => { throw new Error('Seat history unavailable'); };
  await assert.rejects(afkingSeatForStart(PLAYER, { client: f.client }), /Seat history unavailable/);
  assert.deepEqual(f.owners, []);
});

test('ownership mismatch and reorganized snapshots cannot provide a seat for signing', async () => {
  const f = await fixture();
  await f.transfer(ZeroAddress, PLAYER, 8);
  f.answer('AFKING_SUB_TOKEN', 'ownerOf', [OTHER_PLAYER]);
  await assert.rejects(afkingSeatForStart(PLAYER, { client: f.client }), /seat changed/);
  const g = await fixture();
  await g.transfer(ZeroAddress, PLAYER, 9);
  g.s.verify = async () => { throw new Error('Chain reorganized'); };
  await assert.rejects(afkingSeatForStart(PLAYER, { client: g.client }), /Chain reorganized/);
});

async function wallet(expected) {
  __resetForTest(); update('connected.address', PLAYER); update('ui.mode', 'self');
  let signerRequests = 0;
  setProvider({
    getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
    getSigner: async () => { signerRequests++; return { getAddress: async () => PLAYER }; },
  });
  const iface = new Interface((await loadSchema('GAME')).abi);
  const calls = [];
  const check = (stage, args) => {
    iface.encodeFunctionData('subscribe', args.slice(0, 6));
    assert.deepEqual(args, expected); calls.push(stage);
  };
  const subscribe = Object.assign(async (...args) => {
    check('send', args);
    return { hash: '0x1234', wait: async () => ({ status: 1, hash: '0x1234', logs: [] }) };
  }, { staticCall: async (...args) => check('simulate', args) });
  passes.__setContractFactoryForTest(() => ({ subscribe, connect() { return this; } }));
  return { calls, signerRequests: () => signerRequests };
}

test('subscription start verifies the seat then simulates and sends the same current ABI', async () => {
  const f = await fixture(); await f.transfer(ZeroAddress, PLAYER, 389);
  setChainClientForTests(f.client);
  const w = await wallet([0, true, false, 10, 0, 389n, { value: 60n }]);
  let submitted = 0;
  await passes.updateAfkingSubscription({ dailyQuantity: 10, useTickets: false, msgValueWei: 60n, onSubmitted: () => submitted++ });
  assert.deepEqual(w.calls, ['simulate', 'send']);
  assert.deepEqual(f.owners, [389n]); assert.equal(submitted, 1);
});

test('subscription cancellation bypasses seat lookup entirely', async () => {
  setChainClientForTests({ snapshot: () => assert.fail('cancellation must not discover seats') });
  const w = await wallet([0, true, true, 0, 0, 0n, { value: 0n }]);
  await passes.updateAfkingSubscription({ dailyQuantity: 0 });
  assert.deepEqual(w.calls, ['simulate', 'send']);
});

test('a stalled lookup releases Save after 15 seconds and late reads never request a transaction', async t => {
  const w = await wallet([]);
  let release, started;
  const reading = new Promise(resolve => { started = resolve; });
  setChainClientForTests({ snapshot: () => { started(); return new Promise(resolve => { release = resolve; }); } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = passes.updateAfkingSubscription({ dailyQuantity: 10 });
  await reading;
  const rejected = assert.rejects(pending, error => error.code === 'AFKING_SEAT_LOOKUP_TIMEOUT');
  t.mock.timers.tick(15_001);
  await rejected;
  release({ call: () => assert.fail('timed-out preparation must stop') });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.signerRequests(), 0);
  assert.deepEqual(w.calls, []);
});
