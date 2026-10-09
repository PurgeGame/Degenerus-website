import { test, beforeEach, afterEach } from 'node:test';
import './helpers/http-transport.js';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import * as liquidation from '../account-liquidation.js';
import * as store from '../store.js';
import { setProvider, clearProvider } from '../contracts.js';
import { CHAIN } from '../chain-config.js';
import { abi } from '../../chain/generated/game.js';
import { useSchema, loadSchema, CURRENT_SCHEMA_HASH, BEFORE_WALLET_IDS_SCHEMA_HASH, BEFORE_LIQUIDATION_STETH_SCHEMA_HASH } from '../../chain/schema.js';

const PLAYER = '0xab12000000000000000000000000000000000000';
const OTHER = '0xcd34000000000000000000000000000000000000';
const PRICE = 123456789123456789n;
let calls, state;
beforeEach(() => {
  useSchema(CURRENT_SCHEMA_HASH);
  store.__resetForTest();
  store.update('connected.address', PLAYER); store.update('ui.mode', 'self');
  setProvider({ getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
    getSigner: async () => ({ getAddress: async () => state.signer ?? PLAYER }) });
  calls = []; state = { id: 42, payee: PLAYER, buyerId: 2, eligible: true, nativeLiquidity: true, price: PRICE };
  const sell = Object.assign(async (...args) => {
    calls.push(['sell', ...args]);
    return { hash: '0xliquidate', wait: async () => ({ status: 1, logs: [] }) };
  }, { staticCall: async (...args) => { calls.push(['preflight', ...args]); await state.preflight?.(); } });
  liquidation.__setLiquidationContractFactoryForTest(() => ({
    walletIdOf: async () => state.id,
    resolveAccount: async () => ({ payee: state.payee }),
    previewLiquidateAccount: Object.assign(() => { throw Error('Preview must never send a transaction'); }, {
      staticCall: async id => { calls.push(['preview', id]); return state.rawQuote ?? {
        accountId: state.id, buyerId: state.buyerId, eligible: state.eligible, nativeLiquidity: state.nativeLiquidity,
        faceValue: 999n, quoteBudget: 888n, ticketValue: 777n, price: state.price,
      }; },
    }), liquidateAccount: sell,
  }));
});
afterEach(() => { liquidation.__resetLiquidationContractFactoryForTest(); clearProvider(); store.__resetForTest(); });
const sell = () => liquidation.sellAccountToSdgnrs({ player: PLAYER, accountId: 42, minEthOut: PRICE });

test('liquidation selector and quote tuple match the compiled next-run ABI', () => {
  const actual = new Interface(abi), ui = new Interface(liquidation.LIQUIDATION_ABI);
  for (const name of ['walletIdOf', 'resolveAccount', 'previewLiquidateAccount', 'liquidateAccount']) {
    assert.equal(ui.getFunction(name).selector, actual.getFunction(name).selector);
    assert.deepEqual(ui.getFunction(name).outputs.map(o => o.format('full')), actual.getFunction(name).outputs.map(o => o.format('full')));
  }
});
test('preview is a static read of the explicit current account and preserves exact wei', async () => {
  const quote = await liquidation.previewAccountLiquidation({ player: PLAYER });
  assert.equal(quote.accountId, 42); assert.equal(quote.price, PRICE); assert.equal(quote.payee, PLAYER);
  assert.equal(liquidation.liquidationUnavailableReason(quote), '');
  assert.deepEqual(calls, [['preview', 42]]);
});
test('current seven-field wire quote permits the ETH/stETH payout and preserves every amount', async () => {
  const actual = new Interface(abi);
  state.rawQuote = actual.decodeFunctionResult('previewLiquidateAccount',
    actual.encodeFunctionResult('previewLiquidateAccount', [[42, 2, true, 999n, 888n, 777n, PRICE]]))[0];
  const quote = await liquidation.previewAccountLiquidation({ player: PLAYER });
  assert.deepEqual([quote.faceValue, quote.quoteBudget, quote.ticketValue, quote.price], [999n, 888n, 777n, PRICE]);
  assert.equal(liquidation.liquidationUnavailableReason(quote), '');
  assert.equal((await sell()).receipt.status, 1);
});
test('run 69 wire quote retains its native ETH liquidity restriction', async () => {
  useSchema(BEFORE_LIQUIDATION_STETH_SCHEMA_HASH);
  const actual = new Interface((await loadSchema('GAME')).abi);
  state.rawQuote = actual.decodeFunctionResult('previewLiquidateAccount',
    actual.encodeFunctionResult('previewLiquidateAccount', [[42, 2, true, false, 999n, 888n, 777n, PRICE]]))[0];
  const quote = await liquidation.previewAccountLiquidation({ player: PLAYER });
  assert.equal(quote.price, PRICE);
  assert.match(liquidation.liquidationUnavailableReason(quote), /native ETH/);
  await assert.rejects(sell, /native ETH/);
});
test('a wallet with no account never previews the zero/default ID', async () => {
  state.id = 0;
  const quote = await liquidation.previewAccountLiquidation({ player: PLAYER });
  assert.match(liquidation.liquidationUnavailableReason(quote), /no game account/);
  assert.deepEqual(calls, []);
});
test('old deployments explain unavailability without calling the new ABI', async () => {
  useSchema(BEFORE_WALLET_IDS_SCHEMA_HASH);
  assert.equal((await liquidation.previewAccountLiquidation({ player: PLAYER })).supported, false);
  await assert.rejects(sell, /not available/); assert.deepEqual(calls, []);
});
test('sale rechecks the offer, preflights and sends the explicit ID with the displayed minimum', async () => {
  assert.equal((await sell()).receipt.status, 1);
  assert.deepEqual(calls, [['preview', 42], ['preflight', 42, PRICE], ['sell', 42, PRICE]]);
});
for (const [field, value, reason] of [
  ['id', 43, /account changed/], ['price', PRICE - 1n, /offer decreased/],
  ['buyerId', 1, /sDGNRS cannot fund/], ['nativeLiquidity', false, /native ETH/],
  ['eligible', false, /cannot be liquidated/], ['price', 0n, /No eligible/],
  ['payee', OTHER, /Only the account owner/], ['signer', OTHER, /wallet changed|Account changed/],
]) test(`does not submit when ${field} changes to ${String(value)}`, async () => {
  state[field] = value;
  await assert.rejects(sell, reason);
  assert.equal(calls.some(([kind]) => kind === 'sell'), false);
});
for (const mode of ['view', 'combined', 'operator']) test(`${mode} cannot sell even with a connected wallet`, async () => {
  store.update('ui.mode', mode);
  await assert.rejects(sell, /read.only|Only the account owner/i); assert.deepEqual(calls, []);
});
test('a wallet change during preflight blocks submission', async () => {
  state.preflight = () => store.update('connected.address', OTHER);
  await assert.rejects(sell, /wallet changed/);
  assert.equal(calls.some(([kind]) => kind === 'sell'), false);
});
test('concurrent clicks cannot submit two account sales', async () => {
  let release;
  state.preflight = () => new Promise(resolve => { release = resolve; });
  const first = sell();
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  await assert.rejects(sell, /already has a liquidation pending/);
  release(); await first;
  assert.equal(calls.filter(([kind]) => kind === 'sell').length, 1);
});
test('reverting preflight is reported without sending a transaction', async () => {
  state.preflight = () => { throw { revert: { name: 'Insolvent' } }; };
  await assert.rejects(sell, /no longer fund/);
  assert.equal(calls.some(([kind]) => kind === 'sell'), false);
});
