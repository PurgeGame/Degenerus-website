import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { useSchema, CURRENT_SCHEMA_HASH, loadSchema } from '../../chain/schema.js';
import { CHAIN } from '../chain-config.js';
import { setProvider, clearProvider } from '../contracts.js';
import { update, __resetForTest } from '../store.js';
import { _setWalletIdForTests, _resetWalletIdsForTests } from '../wallet-id.js';
import * as claims from '../claims.js';
import * as coinflip from '../coinflip.js';
import * as degenerette from '../degenerette.js';
import * as decimator from '../decimator.js';
import * as passes from '../passes.js';
import * as wwxrp from '../wwxrp.js';
import * as sdgnrs from '../sdgnrs.js';
import * as bingo from '../bingo.js';
import * as foil from '../foil-claim.js';
import * as parimutuel from '../parimutuel.js';

const SELF = '0xab12000000000000000000000000000000000000';
const OTHER = '0xdef0000000000000000000000000000000000000';
const TOKEN = 10n ** 18n;
const modules = [claims, coinflip, degenerette, decimator, passes, wwxrp, sdgnrs, bingo, foil, parimutuel];
let previous;
beforeEach(() => {
  previous = useSchema(CURRENT_SCHEMA_HASH);
  __resetForTest();
  update('connected.address', SELF);
  update('viewing.address', null);
  update('ui.mode', 'self');
  _setWalletIdForTests(OTHER, 73);
  _setWalletIdForTests(SELF, 41);
  setProvider({ getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
    getSigner: async () => ({ getAddress: async () => SELF }) });
});
afterEach(() => {
  for (const mod of modules) mod.__resetContractFactoryForTest?.();
  clearProvider(); _resetWalletIdsForTests(); useSchema(previous);
});

async function contractFor(mod, contractName, method, expected) {
  const iface = new Interface((await loadSchema(contractName)).abi);
  const calls = [];
  const check = args => {
    const fragment = iface.getFunction(method, args.slice(0, expected.length));
    // Encoding against the generated ABI catches old addresses, missing IDs,
    // obsolete overloads and amounts that do not fit the actual contract.
    const values = args.slice(0, fragment.inputs.length);
    iface.encodeFunctionData(fragment, values);
    assert.deepEqual(values, expected);
    calls.push(values);
  };
  const fn = Object.assign(async (...args) => {
    check(args); return { hash: '0x1234', wait: async () => ({ status: 1, hash: '0x1234', logs: [] }) };
  }, { staticCall: async (...args) => { check(args); return 0n; } });
  const contract = { [method]: fn, connect() { return this; }, interface: iface,
    claimableWinningsOf: async () => 0n };
  mod.__setContractFactoryForTest(() => contract);
  return calls;
}

const cases = [
  ['ETH claim', claims, 'GAME', 'claimWinnings(uint32)', [0], () => claims.claimEth()],
  ['third-party ETH claim', claims, 'GAME', 'claimWinnings(uint32)', [73], () => claims.claimEth({ player: OTHER })],
  ['partial ETH claim', claims, 'GAME', 'claimWinnings(uint32,uint256)', [0, 123n], () => claims.claimEthAmount({ amount: 123n })],
  ['whale-pass claim', claims, 'GAME', 'claimWhalePass', [73], () => claims.claimWhalePass({ player: OTHER })],
  ['affiliate claim', claims, 'GAME', 'claimAffiliateDgnrs(uint32)', [0], () => claims.claimAffiliateDgnrs()],
  ['Golden Ticket claim', claims, 'GAME', 'claimGoldenTicket', [73, 8], () => claims.claimGoldenTicket({ player: OTHER, level: 8 })],
  ['FLIP claim', claims, 'COINFLIP', 'claimCoinflips', [0, 100n], () => claims.claimFlip({ amount: 100n * TOKEN })],
  ['FLIP deposit', coinflip, 'COINFLIP', 'depositCoinflip', [0, 100n], () => coinflip.depositCoinflip({ amount: 100n * TOKEN, useCarry: false })],
  ['auto-rebuy', coinflip, 'COINFLIP', 'setCoinflipAutoRebuy', [0, true, 0n], () => coinflip.setCoinflipAutoRebuy({ enabled: true })],
  ['WWXRP draw', wwxrp, 'WWXRP', 'enter', [0, 25n], () => wwxrp.burnWwxrp({ amount: 25n * TOKEN })],
  ['sDGNRS burn', sdgnrs, 'SDGNRS', 'burn', [10n ** 12n], () => sdgnrs.burnSdgnrs({ amount: TOKEN })],
  ['wrapped DGNRS burn', sdgnrs, 'SDGNRS', 'burnWrapped', [10n ** 12n], () => sdgnrs.burnDgnrs({ amount: TOKEN })],
  ['AFKing funding', passes, 'GAME', 'depositAfkingFunding', [41], () => passes.fundAfkingSubscription({ msgValueWei: 100n })],
  ['AFKing cancellation', passes, 'GAME', 'subscribe', [0, true, true, 0, 0, 0n], () => passes.updateAfkingSubscription({ dailyQuantity: 0 })],
  ['growth bet', parimutuel, 'PARIMUTUEL', 'placeBet', [0, true], () => parimutuel.placeGrowthBet({ player: SELF, over: true })],
  ['Bingo claim', bingo, 'GAME', 'claimBingo', [73, 2, 1, [0,1,2,3,4,5,6,7]], () => bingo.claimBingo({ player: OTHER, level: 2, symbol: 1, slots: [0,1,2,3,4,5,6,7] })],
];
for (const [name, mod, contractName, signature, expected, act] of cases) {
  test(`run 66 ${name} encodes and sends the current ABI`, async () => {
    const method = signature.split('(')[0];
    const calls = await contractFor(mod, contractName, signature, expected);
    // Factories expose bare method names, just like ethers Contracts.
    if (signature !== method) {
      const iface = new Interface((await loadSchema(contractName)).abi);
      const fn = Object.assign(async (...args) => {
        iface.encodeFunctionData(signature, args.slice(0, expected.length));
        assert.deepEqual(args.slice(0, expected.length), expected); calls.push(args);
        return { hash: '0x1234', wait: async () => ({ status: 1, logs: [] }) };
      }, { staticCall: async (...args) => { iface.encodeFunctionData(signature, args); assert.deepEqual(args, expected); calls.push(args); } });
      mod.__setContractFactoryForTest(() => ({ [method]: fn, connect() { return this; } }));
    }
    await act(); assert.equal(calls.length, 2, 'simulate and send the same arguments');
  });
}

test('run 66 hides removed Growth claims before any wallet call', async () => {
  await assert.rejects(() => parimutuel.claimGrowth({ player: SELF, rounds: [1] }), /automatically/);
});

test('run 66 claim balance views keep address arguments in the actual contract ABI', async () => {
  const iface = new Interface((await loadSchema('GAME')).abi);
  const calls = [];
  // Keep the real ethers Contract construction: a method-only double would
  // miss the accidental claimableWinningsOf(address) -> (uint32) rewrite.
  setProvider({ call: async tx => {
    const parsed = iface.parseTransaction(tx);
    assert.ok(parsed, 'read must use a deployed selector');
    assert.equal(parsed.args[0].toLowerCase(), SELF);
    calls.push(parsed.name);
    return iface.encodeFunctionResult(parsed.fragment, [parsed.name === 'claimableWinningsOf' ? 123n : 3n]);
  } });
  assert.equal(await claims.readClaimableEth(), 123n);
  assert.equal(await claims.readWhalePassClaimAmount(), 3n);
  assert.deepEqual(calls, ['claimableWinningsOf', 'whalePassClaimAmount']);
});
