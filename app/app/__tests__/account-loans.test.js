import { test, beforeEach, afterEach } from 'node:test';
import './helpers/http-transport.js';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import * as loans from '../account-loans.js';
import * as store from '../store.js';
import { setProvider, clearProvider } from '../contracts.js';
import { CHAIN } from '../chain-config.js';
import { useSchema, loadSchema, CURRENT_SCHEMA_HASH, BEFORE_LOANS_SCHEMA_HASH } from '../../chain/schema.js';

const PLAYER = '0xab12000000000000000000000000000000000000';
const OTHER = '0xcd34000000000000000000000000000000000000';
let state, calls;
const tx = { hash: '0xloan', wait: async () => ({ status: 1, logs: [] }) };
beforeEach(() => {
  useSchema(CURRENT_SCHEMA_HASH); store.__resetForTest();
  store.update('connected.address', PLAYER); store.update('ui.mode', 'self');
  state = { payee: PLAYER, level: 10, principal: 0n, owed: 0n, claimable: 1n, quote: 100n, tickets: 20n, eligible: true };
  calls = [];
  setProvider({ getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
    getSigner: async () => ({ getAddress: async () => state.signer ?? PLAYER }) });
  const method = name => Object.assign(async (...args) => { calls.push([name, ...args]); return tx; },
    { staticCall: async (...args) => { calls.push([`${name}:simulate`, ...args]); } });
  loans.__setLoanFactoryForTest(() => ({
    game: { walletIdOf: async () => 42, resolveAccount: async () => ({ payee: state.payee }),
      level: async () => state.level, jackpotPhase: async () => false,
      borrow: method('borrow'), repay: method('repay'), sweepAccounts: method('sweepAccounts') },
    lens: { activeTicketLevelOf: async () => state.level + 1, loanOf: async () => ({ principal: state.principal, owed: state.owed, lenderId: 2, startLevel: 10, dueLevel: 15, family: 1 }),
      accountBalances: async () => ({ claimable: state.claimable }),
      previewBorrow: async (_game, accountId) => ({ accountId, lenderId: 2, eligible: state.eligible,
        face: 1000n, maxPrincipal: 200n, principal: state.quote, ticketWei: state.tickets }) },
  }));
});
afterEach(() => { loans.__setLoanFactoryForTest(undefined); clearProvider(); useSchema(CURRENT_SCHEMA_HASH); });
const borrow = () => loans.borrowAgainstAccount({ player: PLAYER, accountId: 42, dueLevel: 15, amount: 100n, minEthOut: 80n });
test('loan doors and quote fields match the vendored ABI', async () => {
  const game = new Interface((await loadSchema('GAME')).abi), lens = new Interface((await loadSchema('GAME_LENS')).abi);
  assert.equal(game.getFunction('borrow').format('sighash'), 'borrow(uint32,uint24,uint256,uint256)');
  assert.equal(game.getFunction('repay').payable, true);
  const output = lens.getFunction('previewBorrow').outputs[0].components.map(value => value.name);
  assert.deepEqual(output, ['accountId', 'lenderId', 'eligible', 'face', 'maxPrincipal', 'principal', 'ticketWei']);
  assert.equal(game.getFunction('liquidateAccount'), null);
});
test('loan quote separates ticket principal from the protected ETH/stETH payout', async () => {
  const quote = await loans.previewAccountLoan({ player: PLAYER, dueLevel: 15, amount: 100n });
  assert.equal(quote.ethOut, 80n); assert.equal(quote.ticketWei, 20n);
});
test('borrow simulates and sends the exact quoted ID, term, amount and payout floor', async () => {
  await borrow();
  assert.deepEqual(calls, [['borrow:simulate', 42, 15, 100n, 80n], ['borrow', 42, 15, 100n, 80n]]);
});
for (const [key, value] of [['quote', 99n], ['tickets', 21n], ['eligible', false], ['principal', 10n], ['payee', OTHER], ['signer', OTHER]]) {
  test(`borrow refuses a changed ${key} before signing`, async () => {
    state[key] = value; await assert.rejects(borrow); assert.deepEqual(calls, []);
  });
}
test('repayment uses claimable above its sentinel, and only sends the shortfall', async () => {
  state.principal = 100n; state.owed = 112n; state.claimable = 81n;
  await loans.repayAccountLoan({ player: PLAYER, accountId: 42, maxOwed: 112n });
  assert.deepEqual(calls, [['repay:simulate', 42, { value: 32n }], ['repay', 42, { value: 32n }]]);
});
test('repayment refuses increased interest and an expired term', async () => {
  state.principal = 100n; state.owed = 115n;
  await assert.rejects(() => loans.repayAccountLoan({ player: PLAYER, accountId: 42, maxOwed: 112n }), /increased/);
  state.level = 15;
  await assert.rejects(() => loans.repayAccountLoan({ player: PLAYER, accountId: 42, maxOwed: 120n }), /no longer/);
  assert.deepEqual(calls, []);
});
test('historical deployments cannot call loan methods', async () => {
  useSchema(BEFORE_LOANS_SCHEMA_HASH);
  assert.equal((await loans.readAccountLoan({ player: PLAYER })).supported, false);
  await assert.rejects(borrow, /not available/); assert.deepEqual(calls, []);
});
test('sweeps preflight ownership on chain and enforce the 32-account limit', async () => {
  await assert.rejects(() => loans.sweepSubaccounts({ player: PLAYER, accountIds: Array.from({ length: 33 }, (_, i) => i + 42) }), /32/);
  await loans.sweepSubaccounts({ player: PLAYER, accountIds: [43, 44, 43] });
  assert.deepEqual(calls, [['sweepAccounts:simulate', [43, 44]], ['sweepAccounts', [43, 44]]]);
});
