import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walletIdOf_g3120, walletAddressOf, walletPayeeOf, walletPayees } from '../../chain/wallets.js';
import { decorateWalletRows } from '../../chain/wallet-events.js';
import { readChainRoute } from '../../chain/router.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';

const packed = (key, owner = 0) => BigInt(key || 0) | (BigInt(owner) << 160n);

test('a seized account and its children pay the lender even when the original key is cached', async () => {
  const rows = new Map([[1, packed(OTHER_PLAYER)], [37, packed(PLAYER)], [38, packed(null, 37)]]);
  let reads = 0;
  const client = { chain: { id: 99137 }, address: () => '0x0000000000000000000000000000000000000037' };
  const snapshot = () => ({ client, call: async () => 37n,
    field: async (_contract, _field, id) => { reads++; return rows.get(Number(id)) ?? 0n; } });
  const before = snapshot();
  assert.equal(await walletIdOf_g3120(before, PLAYER), 37);
  assert.equal(await walletAddressOf(before, 37), PLAYER);
  assert.equal(await walletPayeeOf(before, 37), PLAYER);
  rows.set(37, packed(PLAYER, 1)); // _seizeLoan preserves the seller key and changes the owner lane.
  const after = snapshot();
  assert.equal(await walletAddressOf(after, 37), PLAYER, 'historical account identity stays intact');
  assert.equal(await walletPayeeOf(after, 37), OTHER_PLAYER, 'a warmed key cannot override the lender');
  assert.equal(await walletPayeeOf(after, 38), OTHER_PLAYER, 'two owner hops must not stop at the seized main key');
  const at = reads;
  assert.deepEqual(await walletPayees(after, [37, 37, 38, 0]), new Map([[37, OTHER_PLAYER], [38, OTHER_PLAYER]]));
  assert.equal(reads, at, 'one snapshot reuses its payout-owner reads');
  assert.equal(await walletPayeeOf(before, 37), PLAYER, 'historical block snapshots keep their own answer');
});

test('a failed payout-owner read retries and never falls back to the seized key', async () => {
  let fail = true;
  const s = { field: async () => { if (fail) throw Error('RPC offline'); return packed(OTHER_PLAYER); } };
  await assert.rejects(walletPayeeOf(s, 37), /RPC offline/);
  fail = false;
  assert.equal(await walletPayeeOf(s, 37), OTHER_PLAYER);
  assert.equal(await walletPayeeOf(s, 0), null);
  assert.equal(await walletPayeeOf(s, NaN), null);
});

test('jackpot recipient decoration follows seizure without changing account IDs', async () => {
  const f = await rpcFixture();
  await f.wallet(1, f.contracts.VAULT);
  await f.wallet(37, PLAYER, { owner: 1 });
  const events = [
    { name: 'JackpotEthWin', args: { walletId: '37', amount: '100' } },
    { name: 'JackpotFlipWin', args: { walletId: '37', amount: '100' } },
    { name: 'JackpotTicketWin', args: { walletId: '37', entryCount: '8' } },
    { name: 'JackpotWhalePassWin', args: { walletId: '37', halfPassCount: '2' } },
    { name: 'DecimatorGenerated', args: { recipientId: '37', id: '99' } },
  ];
  const rows = await decorateWalletRows(f.s, 'GAME', events);
  for (const row of rows) assert.equal(row.args.winner ?? row.args.recipient, f.contracts.VAULT);
  assert.equal(rows[0].args.walletId, '37');
  assert.equal(rows[4].args.recipientId, '37');
  assert.equal(rows[4].args.id, '99');
  const battle = await decorateWalletRows(f.s, 'CRAPS', [{ name: 'JackpotBattleEntry', args: { playerId: '37' } }]);
  assert.equal(battle[0].args.player, f.contracts.VAULT);
  assert.deepEqual(events[0].args, { walletId: '37', amount: '100' }, 'cached source logs stay unchanged');
});

test('daily totals, both rolls and player results exclude a seized account, including packed tickets', async () => {
  const f = await rpcFixture();
  const day = 120, level = 6, block = 9999;
  await f.wallet(1, f.contracts.VAULT);
  await f.wallet(37, PLAYER, { owner: 1 });
  await f.wallet(38, null, { owner: 37 });
  await f.wallet(73, OTHER_PLAYER);
  // A new account on the same external wallet may still win; only the seized ID moved.
  await f.wallet(74, PLAYER);
  await f.field('GAME', 'dailyFoilDraw', 0xc3824100n | (BigInt(level) << 64n) | (BigInt(day) << 217n), day & 1);
  await f.event('GAME', 'DailyRngApplied', { day, rawWord: 777, finalWord: 777 }, { block });
  await f.event('GAME', 'DailyWinningTraits', { day, mainTraitsPacked: 0xc3824100 }, { block });
  await f.event('GAME', 'JackpotEthWin', { walletId: 37, level, traitId: 0, amount: 100 }, { block });
  await f.event('GAME', 'JackpotFlipWin', { walletId: 38, level, traitId: 65, amount: 200 }, { block });
  await f.event('GAME', 'JackpotTicketBatchWin', { sourceLvl: level, targetLvl: level + 1, trait: 130,
    firstWinner: 0, count: 2, entriesEach: 8, owners: [37n | (73n << 32n), 0, 0, 0], sourceIndices: [1n | (2n << 32n), 0, 0, 0] }, { block });
  await f.event('GAME', 'JackpotEthWin', { walletId: 74, level, traitId: 195, amount: 7 }, { block });
  await f.event('GAME', 'PrizePoolDailySnapshot', { day }, { block });
  const read = path => readChainRoute(path, { client: f.client });
  const { winners } = await read(`/game/jackpot/day/${day}/winners`);
  const mine = winners.find(row => row.address === PLAYER);
  assert.equal(mine.totalEth, '7');
  assert.equal(mine.ticketCount, 0);
  assert.equal(mine.coinTotal, '0');
  const lender = winners.find(row => row.address === f.contracts.VAULT);
  assert.equal(lender.totalEth, '100');
  assert.equal(lender.ticketCount, 8);
  assert.equal(BigInt(lender.coinTotal), 200n * 10n ** 18n);
  const roll1 = await read(`/game/jackpot/day/${day}/roll1`);
  assert.deepEqual(roll1.wins.filter(row => row.winner === PLAYER).map(row => row.amount), ['7']);
  const roll2 = await read(`/game/jackpot/day/${day}/roll2`);
  assert.equal(roll2.wins.filter(row => row.winner === PLAYER).length, 0);
  const player = await read(`/game/jackpot/${level}/player/${PLAYER}?day=${day}`);
  assert.equal(player.roll1Rows.length, 1);
  assert.equal(player.roll1Rows[0].ethPerWinner, '7');
  assert.deepEqual(player.roll2.future, []);
  const history = await read(`/player/${PLAYER}/jackpot-history`);
  assert.deepEqual(history.wins.map(row => row.amount), ['7']);
});
