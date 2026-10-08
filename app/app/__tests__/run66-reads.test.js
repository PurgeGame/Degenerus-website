import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSchema, CURRENT_SCHEMA_HASH } from '../../chain/schema.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';
import { playerState } from '../../chain/state.js';
import { pendingBoxWord } from '../../chain/recycling.js';
import { pendingBoxes } from '../../chain/pending.js';
import { arraySlot, wordHex } from '../../chain/client.js';
import { revealedEntries } from '../../chain/tickets.js';
import { bingoProof, farFutureQueue } from '../../chain/positions.js';
import { ticketBatchWins } from '../../chain/jackpots.js';
import { boxReference, boxQueuePosition } from '../../chain/box-queue.js';
import { prepareWalletReceipt, walletReceiptLog } from '../wallet-receipt.js';
import { contractInterface } from '../../chain/client.js';
import { walletIdOf } from '../../chain/wallets.js';
async function current(fn) { const prior = useSchema(CURRENT_SCHEMA_HASH); try { await fn(); } finally { useSchema(prior); } }

test('run 66 growth winners show only the automatically paid range of the winning side', () => current(async () => {
  const {readBoardRoute}=await import('../../chain/boards.js');
  const f=await rpcFixture();await f.wallet(37,PLAYER);await f.wallet(73,OTHER_PLAYER);
  const third='0x0000000000000000000000000000000000000099';await f.wallet(99,third);
  await f.event('PARIMUTUEL','BetPlaced',{id:37,round:2,over:true,questReward:0},{block:9990});
  await f.event('PARIMUTUEL','BetPlaced',{id:99,round:2,over:false,questReward:0},{block:9991});
  await f.event('PARIMUTUEL','BetPlaced',{id:73,round:2,over:true,questReward:0},{block:9992});
  await f.event('PARIMUTUEL','GrowthRoundSealed',{round:2,over:true},{block:9993});
  await f.event('PARIMUTUEL','GrowthWinnersPaid',{round:2,outcome:1,firstIndex:1,count:1,payout:1500},{block:9994});
  const read=over=>readBoardRoute(f.s,new URL(`/game/parimutuel/growth/2/winners?over=${over}`,'https://example.test'));
  const result=await read(1);
  assert.equal(result.sealed,true);
  assert.deepEqual(result.winners.map(({player,credit})=>({player,credit})),[
    {player:PLAYER,credit:null},{player:OTHER_PLAYER,credit:String(1500n*10n**18n)},
  ]);
  const loser=await read(0);
  assert.equal(loser.sealed,false);assert.equal(loser.winners[0].credit,null);
}));

test('run 66 player state reads ID-keyed quests and scales 12-decimal balances', () => current(async () => {
  const f = await rpcFixture(); await f.wallet(37, PLAYER);
  f.answer('WWXRP','balanceOf',[5n]); f.answer('WWXRP','claimable',[25n]);
  for (const asset of ['DGNRS','SDGNRS']) f.answer(asset,'balanceOf',[7n * 10n ** 12n]);
  const state = await playerState(f.s, PLAYER);
  assert.equal(state.dgnrsBalance, String(7n * 10n ** 18n));
  assert.equal(state.sdgnrsBalance, String(7n * 10n ** 18n));
  assert.equal(state.player, PLAYER);
  assert.equal(state.wwxrpBalance, String(30n * 10n ** 18n));
}));

test('run 66 queued purchases retain separate positions and stop at the settlement cursor', () => current(async () => {
  const f = await rpcFixture(); await f.wallet(37, PLAYER);
  await f.field('GAME','lootboxRngPacked',2n << 120n);
  const {slot} = await f.s.location('GAME','boxQueue',[0]);
  const entry = 37n | (1200n << 56n) | (1n << 100n);
  for (let i=0;i<2;i++) f.storage.set(`${f.contracts.GAME.toLowerCase()}:${arraySlot(slot)+BigInt(i)}`,entry);
  for (let i=0;i<2;i++) await f.event('GAME','LootBoxBuy',{buyer:37,index:0,position:i,amount:10000000000n},{block:9990+i});
  assert.equal((await pendingBoxes(f.s,PLAYER)).length,2);
  assert.equal(await pendingBoxWord(f.s,'boxQueue',0,PLAYER,1),entry);
  assert.equal(boxReference(0,1), (1n << 46n) | 2n);
  assert.deepEqual(boxQueuePosition(boxReference(1,123)), {buffer:1n,position:123n});
  await f.field('GAME','rngFlagsAndNudges',1n << 12n); // write=1, read=0
  await f.field('GAME','boxReadCount',2);
  await f.field('GAME','boxCursor',1);
  assert.equal(await pendingBoxWord(f.s,'boxQueue',0,PLAYER,0),0n);
  assert.equal(await pendingBoxWord(f.s,'boxQueue',0,PLAYER,1),entry);
}));

test('run 66 ticket reveals and Bingo use wallet IDs without subtracting one', () => current(async () => {
  const f = await rpcFixture(); await f.wallet(37,PLAYER);
  await f.field('GAME','ticketGenerationStartBlock',9000,2);
  await f.field('GAME','ticketBufferLevels',2n);
  const traits = 0xc0804000n;
  await f.event('GAME','JackpotTicketBatchTraits',{lvl:2,count:1,owners:[37,0,0,0],traits:[traits,0,0,0]});
  assert.deepEqual((await revealedEntries(f.s,PLAYER,2))[0].traits,[0,64,128,192]);
  f.answer('GAME_LENS','findTraitEntry', args => { assert.deepEqual([...args[3]],[37n]); return [true,5,6,8]; });
  assert.equal((await bingoProof(PLAYER,2,0,{client:f.client})).length,8);
  await f.event('GAME','JackpotTicketBatchWin',{lvl:1,targetLvl:2,count:1,owners:[37,0,0,0],sourceIndices:[0,0,0,0],entriesEach:4});
  assert.equal((await ticketBatchWins(f.s,{},PLAYER)).length,1);
}));

test('run 66 far-future inventory reads the account balance after removal of queue tags', () => current(async () => {
  const f=await rpcFixture();await f.wallet(37,PLAYER);
  f.answer('GAME_LENS','activeTicketLevelOf',[20]);
  f.answer('GAME','entriesOwedView',([level])=>[level===25n?8n:0n]);
  const result=await farFutureQueue(f.s,PLAYER,{levels:[25,26]});
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].entryCount,8);
}));

test('run 66 receipt hydration preserves raw token amounts and resolves wallet IDs', () => current(async () => {
  const f=await rpcFixture();await f.wallet(37,PLAYER);await f.wallet(73,OTHER_PLAYER);
  const log=await f.event('SDGNRS','RedemptionSubmitted',{player:73,sdgnrsAmount:10n**12n,batchId:9});
  const receipt={blockNumber:9999,logs:[log]};
  await prepareWalletReceipt(receipt,f.client);
  const parsed=walletReceiptLog(log,await contractInterface('SDGNRS'));
  assert.equal(parsed.args.player,OTHER_PLAYER);assert.equal(parsed.args.playerId,73n);
  assert.equal(parsed.args.sdgnrsAmount,10n**12n);
}));

test('run 66 wallet address lookup refreshes after liquidation on a later snapshot', () => current(async () => {
  const f=await rpcFixture();await f.wallet(37,PLAYER);
  assert.equal(await walletIdOf(f.s,PLAYER),37);
  f.answer('GAME','walletIdOf',[0]);
  const fresh=await f.client.snapshot({blockTag:9999});
  assert.equal(await walletIdOf(fresh,PLAYER),0);
}));


test('run 66 WWXRP credit receipts resolve the owner and retain the credited amount', () => current(async () => {
  const f=await rpcFixture();await f.wallet(37,PLAYER);
  const log=await f.event('WWXRP','PrizeCredited',{id:37,amount:25,claimableAfter:30});
  const receipt={blockNumber:9999,logs:[log]};await prepareWalletReceipt(receipt,f.client);
  const parsed=walletReceiptLog(log,await contractInterface('WWXRP'));
  assert.equal(parsed.args.player,PLAYER);assert.equal(parsed.args.id,37n);assert.equal(parsed.args.amount,25n);
}));

test('run 66 Craps amount scaling retains hydrated address aliases', () => current(async () => {
  const f=await rpcFixture();await f.wallet(37,PLAYER);
  const iface=await contractInterface('CRAPS');
  const event=iface.getEvent('CrapsDayReserved');
  const values=Object.fromEntries(event.inputs.filter(x=>x.type==='uint32').map(x=>[x.name,37]));
  const log=await f.event('CRAPS',event.name,values);
  await prepareWalletReceipt({blockNumber:9999,logs:[log]},f.client);
  const parsed=walletReceiptLog(log,iface);
  const {scaleDecodedEvent}=await import('../token-units.js');
  const args=scaleDecodedEvent('CRAPS',event,parsed.args);
  assert.equal(args.player,PLAYER);
}));

test('run 66 deity pricing reads bit 172 without mistaking a different field for a pass', () => current(async () => {
  const {crapsNewcomerPricing}=await import('../craps.js');
  assert.equal(crapsNewcomerPricing(1n<<172n,5),false);
  assert.equal(crapsNewcomerPricing(1n<<184n,5),true);
}));


test('run 66 registered-wallet chain routes use the incoming ABI and layout', async t => current(async () => {
  const {readChainRoute}=await import('../../chain/router.js');
  const f=await rpcFixture();await f.wallet(37,PLAYER);
  const routes=[`/player/${PLAYER}/tickets/by-trait?level=0`,`/player/${PLAYER}/foil?level=0`,`/player/${PLAYER}/bingos`,`/player/${PLAYER}/far-future-queue`,`/player/${PLAYER}/holdings`,`/player/${PLAYER}/pending`,
    `/player/${PLAYER}/operators`,`/player/${PLAYER}/approvers`,`/player/${PLAYER}/decimator?level=10`,`/player/${PLAYER}/baf?level=10`,`/player/${PLAYER}/referees`,`/player/${PLAYER}/jackpot-history`,
    '/game/coinflip/day/120','/game/quests/day/120','/game/decimator/10','/leaderboards/baf?level=10','/leaderboards/affiliate?level=10','/leaderboards/coinflip?day=120','/records',
    '/lootbox/feed','/lootbox/legs','/degenerette/feed',`/viewer/player/${PLAYER}/day/120`,`/player/${PLAYER}/reveals`, '/game/jackpot/day/120/summary','/game/jackpot/day/120/winners', '/game/jackpot/10/overview','/game/baf/10/resolution'];
  for(const path of routes) await t.test(path,async()=>{const result=await readChainRoute(path,{client:f.client});assert.ok(result);});
}));


test('run 66 BAF pair-packed board and affiliate leader resolve account IDs', () => current(async () => {
  const {readChainRoute}=await import('../../chain/router.js');
  const f=await rpcFixture();await f.wallet(37,PLAYER);await f.wallet(73,OTHER_PLAYER);
  await f.field('JACKPOTS','bafLevel',2,10,'topLen');
  await f.field('JACKPOTS','bafTop',(37n<<96n)|800n|(((73n<<96n)|600n)<<128n),10,0);
  const board=await readChainRoute('/leaderboards/baf?level=10',{client:f.client});
  assert.deepEqual(board.entries.map(x=>[x.player,x.score]),[[PLAYER,String(800n*10n**18n)],[OTHER_PLAYER,String(600n*10n**18n)]]);
  f.answer('AFFILIATE','affiliateTop',[73,5n]);
  const affiliate=await readChainRoute('/leaderboards/affiliate?level=10',{client:f.client});
  assert.equal(affiliate.entries[0].player,OTHER_PLAYER);assert.equal(affiliate.entries[0].score,String(5n*10n**18n));
}));


test('run 66 Craps comp receipts keep their funding label after wallet-ID migration', () => current(async () => {
  const {crapsEntryWasComped}=await import('../craps.js');
  const {CONTRACTS}=await import('../chain-config.js');
  const f=await rpcFixture();await f.wallet(37,PLAYER);
  const log=await f.event('COIN','CrapsCompSpent',{player:37,amount:25},{index:1});
  const receipt={blockNumber:9999,logs:[log]};await prepareWalletReceipt(receipt,f.client);
  log.address=CONTRACTS.COIN;
  assert.equal(crapsEntryWasComped({entryLogIndex:2},PLAYER,null,receipt),true);
}));
