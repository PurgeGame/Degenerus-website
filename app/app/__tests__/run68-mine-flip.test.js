import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { loadSchema } from '../../chain/schema.js';
import { abi as gameAbi } from '../../chain/generated/game.js';
import { walletAbi } from '../wallet-abi.js';
import { CHAIN, CONTRACTS } from '../chain-config.js';
import { setProvider, clearProvider } from '../contracts.js';
import { update, __resetForTest } from '../store.js';
import { _setSharedReadProviderForTests, _resetSharedReadProviderForTests } from '../read-provider.js';
import * as mining from '../mine-flip.js';
import * as lootbox from '../lootbox.js';
import * as degenerette from '../degenerette.js';

const PLAYER = '0xab12000000000000000000000000000000000000';
const modules = [mining, lootbox, degenerette];
let provider;
beforeEach(() => {
  __resetForTest();
  update('connected.address', PLAYER); update('viewing.address', null); update('ui.mode', 'self');
  provider = {
    getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
    getSigner: async () => ({ getAddress: async () => PLAYER, estimateGas: async () => 1_200_000n }),
    getBalance: async () => 10n ** 18n,
    getFeeData: async () => ({ maxFeePerGas: 1n }),
    getBlock: async () => ({ baseFeePerGas: 21n }),
  };
  setProvider(provider); _setSharedReadProviderForTests(provider);
});
afterEach(() => {
  for (const mod of modules) mod.__resetContractFactoryForTest();
  clearProvider(); _resetSharedReadProviderForTests();
});

async function fakeMiner(mod, expected) {
  const iface = new Interface((await loadSchema('GAME')).abi);
  const calls = [];
  const check = (kind, args) => {
    const values = args.slice(0, expected.length);
    assert.deepEqual(values, expected);
    // Encode and decode against the actual schema, catching both missing args and old selectors.
    const data = iface.encodeFunctionData('mineFlip', values);
    assert.equal(iface.parseTransaction({ data }).signature, 'mineFlip(uint32)');
    calls.push({ kind, args, data });
  };
  const fn = Object.assign(async (...args) => {
    check('send', args);
    assert.ok(args.at(-1).gasLimit >= 10_000_000n);
    if (Number(CHAIN.id) === 11155111) assert.equal(args.at(-1).gasLimit, 30_000_000n);
    return { hash: '0x1234', wait: async () => ({ status: 1, hash: '0x1234', logs: [] }) };
  }, {
    staticCall: async (...args) => check('probe', args),
    estimateGas: async (...args) => { check('estimate', args); return 1_200_000n; },
  });
  mod.__setContractFactoryForTest(() => ({ mineFlip: fn, interface: iface, connect() { return this; } }));
  return calls;
}

test('the button probes, estimates and sends mineFlip(0)', async () => {
  const calls = await fakeMiner(mining, [0]);
  await mining.mineFlip({ player: PLAYER });
  assert.deepEqual(calls.map(c => c.kind), ['probe', 'estimate', 'send']);
  assert.equal(new Set(calls.map(c => c.data)).size, 1);
});
test('a real Contract probe encodes mineFlip(0) against the deployed ABI', async () => {
  const iface = new Interface((await loadSchema('GAME')).abi);
  const calls = [];
  provider.call = async tx => {
    const parsed = iface.parseTransaction(tx);
    assert.equal(parsed.signature, 'mineFlip(uint32)');
    assert.deepEqual(Array.from(parsed.args), [0n]);
    calls.push(tx); return '0x';
  };
  const result = await mining.probeMineFlip({ player: PLAYER });
  assert.equal(result.known, true); assert.equal(result.hasWork, true);
  assert.equal(calls.length, 1);
});

for (const [name, mod, action] of [
  ['luckbox opening', lootbox, () => lootbox.openLootBox({ lootboxIndex: 1, player: PLAYER })],
  ['luckbox RNG request', lootbox, () => lootbox.requestLootboxRng()],
  ['Degenerette settlement', degenerette, () => degenerette.resolveBets({ index: 1, betIds: [1] })],
]) {
  test(`${name} probes, estimates and sends mineFlip(0)`, async () => {
    const calls = await fakeMiner(mod, [0]);
    await action();
    assert.deepEqual(calls.map(c => c.kind), ['probe', 'estimate', 'send']);
  });
}

test('an inline mineFlip() fragment resolves to the deployed mineFlip(uint32)', () => {
  assert.equal(new Interface(walletAbi(['function mineFlip()'], gameAbi)).getFunction('mineFlip').inputs.length, 1);
});

test('current wallet-ID receipts show the confirmed mining reward', () => {
  const iface = new Interface(gameAbi);
  const encoded = iface.encodeEventLog(iface.getEvent('MinerBounty'), [1, PLAYER, 125n]);
  assert.equal(mining.readMineFlipReward({ status: 1, logs: [{ address: CONTRACTS.GAME, ...encoded }] }, PLAYER), 125n * 10n ** 18n);
});
