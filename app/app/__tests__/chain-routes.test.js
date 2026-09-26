import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';

test('contract ABI integration: current state and balances use RPC without any HTTP API', async()=>{
  const f=await rpcFixture();
  await f.field('GAME','level',6);
  f.answer('GAME','mintPrice',[120n]);f.answer('COIN','balanceOf',[987654321n]);f.answer('GAME','claimableWinningsOf',[123456789n]);
  const state=await readChainRoute('/game/state',{client:f.client});assert.equal(state.level,6);assert.equal(state.price,'120');
  // jackpotFlags bit 0 (JACKPOT_TURBO) is the one-day schedule; normal is three days.
  assert.equal(state.jackpotDays,3);await f.field('GAME','jackpotFlags',3);
  const turbo=await readChainRoute('/game/state',{client:f.client});assert.equal(turbo.jackpotFlags,3);assert.equal(turbo.jackpotDays,1);
  const p=await readChainRoute(`/player/${PLAYER}`,{client:f.client});assert.equal(p.claimableEth,'123456789');assert.equal(p.flipBalance,'987654321');
  assert.equal(p.tickets,null);assert.equal(f.requests.filter(r=>r.method==='eth_getLogs').length,0,'money HUD must not scan history');
});

test('contract ABI integration: supported empty-wallet projections do not crash or call the API',async t=>{
  const f=await rpcFixture();
  const routes=[`/player/${PLAYER}/tickets/by-trait?level=0`,`/player/${PLAYER}/foil?level=0`,`/player/${PLAYER}/bingos`,`/player/${PLAYER}/far-future-queue`,`/player/${PLAYER}/holdings`,`/player/${PLAYER}/pending`,
    `/player/${PLAYER}/operators`,`/player/${PLAYER}/approvers`,`/player/${PLAYER}/decimator?level=10`,`/player/${PLAYER}/baf?level=10`,`/player/${PLAYER}/referees`,`/player/${PLAYER}/jackpot-history`,
    '/game/coinflip/day/120','/game/quests/day/120','/game/decimator/10','/leaderboards/baf?level=10','/leaderboards/affiliate?level=10','/leaderboards/coinflip?day=120','/records',
    '/lootbox/feed','/lootbox/legs','/degenerette/feed',`/viewer/player/${PLAYER}/day/120`,`/player/${PLAYER}/reveals`, '/game/jackpot/day/120/summary','/game/jackpot/day/120/winners', '/game/jackpot/10/overview','/game/baf/10/resolution'];
  for(const path of routes) await t.test(path,async()=>{const result=await readChainRoute(path,{client:f.client});assert.ok(result);});
});

test('contract ABI integration: pending wager recovery includes old placements and excludes resolved records',async()=>{
  // Audit 224de529: a bet is (index, betId) — betIds restart in every RNG index — and
  // degeneretteBetInfo(index, betId) is its queued word, zero once settled.
  const f=await rpcFixture();
  await f.event('GAME','DegeneretteBetPlaced',{player:PLAYER,index:7,betId:1,packed:123},{block:2});
  await f.event('GAME','DegeneretteBetPlaced',{player:PLAYER,index:8,betId:2,packed:456},{block:3});
  await f.event('GAME','DegeneretteBetPlaced',{player:PLAYER,index:9,betId:2,packed:789},{block:4});
  await f.event('GAME','DegeneretteResolved',{player:PLAYER,index:8,betId:2,totalPayout:0,resultTraits:0,spins:'0x0000000000'},{block:5});
  const words=new Map([['7:1',123n],['8:2',0n],['9:2',789n]]);
  f.answer('GAME','degeneretteBetInfo',([index,betId])=>[words.get(`${index}:${betId}`)??0n]);
  const data=await readChainRoute(`/player/${PLAYER}?pending=1`,{client:f.client});
  assert.deepEqual(data.degenerette.pendingBets,[
    {betId:'1',betIndex:7,packedData:'123'},
    {betId:'2',betIndex:9,packedData:'789'},
  ],'bet 2 at index 8 settled; bet 2 at index 9 is a different, still-queued bet');
});

test('contract ABI integration: a keeper-swept bet feeds its own spins, Luckbox and record chain only',async()=>{
  // Audit 224de529: mineFlip() settles every bet at an index in ONE transaction, after that
  // index's human boxes. The feed must price each spin from the bet word (no per-spin event)
  // and attribute only the bet's own log window to it.
  const {OTHER_PLAYER}=await import('./helpers/chain-rpc.js');
  const {ETH_DIVISOR}=await import('../chain-config.js');
  const f=await rpcFixture();
  const unit=(10n**9n)/BigInt(ETH_DIVISOR); const stake=(10n**16n)/BigInt(ETH_DIVISOR);
  const packed=BigInt(PLAYER)|(1n<<165n)|(1n<<171n)|((stake/unit)<<188n); // 1 ETH spin, record armed
  const placeTx='0x'+'aa'.repeat(32), sweepTx='0x'+'bb'.repeat(32);
  await f.event('GAME','DegeneretteBetPlaced',{player:PLAYER,index:7,betId:1,packed},{block:9990,index:0,tx:placeTx});
  await f.event('COINFLIP','BigRecordUpdated',{kind:1,player:PLAYER,value:10n**18n,paid:900n*10n**18n+5n,sdgnrsPaid:0},{block:9990,index:1,tx:placeTx});
  await f.field('GAME','lootboxRngWordByIndex',0xabcd,7);
  const spins='0x'+(1234).toString(16).padStart(8,'0')+'04'; // one spin: S4, no gold
  const record=(1n<<63n)|(3n<<60n)|5n;
  await f.event('GAME','LootBoxOpened',{player:PLAYER,lootboxIndex:7,amount:1,futureLevel:1,futureTickets:4},{block:9995,index:10,tx:sweepTx}); // human box
  await f.event('GAME','LootBoxOpened',{player:PLAYER,lootboxIndex:0,amount:2,futureLevel:1,futureTickets:4},{block:9995,index:11,tx:sweepTx}); // our direct box
  await f.event('GAME','DegeneretteResolved',{player:PLAYER,index:7,betId:1,totalPayout:9n*stake,resultTraits:13,spins},{block:9995,index:12,tx:sweepTx});
  await f.event('GAME','BoxSpin',{player:PLAYER,betId:record,packedSpins:0,payout:0,ethShare:0},{block:9995,index:13,tx:sweepTx}); // our record chain
  await f.event('GAME','DegeneretteResolved',{player:OTHER_PLAYER,index:7,betId:2,totalPayout:0,resultTraits:13,spins},{block:9995,index:14,tx:sweepTx});
  const feed=await readChainRoute(`/degenerette/feed?player=${PLAYER}`,{client:f.client});
  assert.equal(feed.items.length,1);
  const [item]=feed.items;
  assert.equal(item.betIndex,7);assert.equal(item.betId,'1');assert.equal(item.rngReady,true);
  assert.equal(item.recordStake,String(900n*10n**18n),'the whole-FLIP record claim comes from the placement receipt');
  const resolved=item.results.find(r=>r.resultType==='resolved');
  assert.equal(resolved.resultData.spinCount,1);assert.equal(resolved.resultData.spins,spins);
  const [spin]=item.results.filter(r=>r.resultType==='result');
  assert.equal(spin.resultData.matches,'4');assert.equal(spin.resultData.playerTraits,'1234');
  assert.equal(spin.payout,String(9n*stake),'S4 at activity 0 is 10x base at 90% — the module payout math');
  assert.deepEqual(item.lootboxPayouts.map(p=>[p.rewardType,Number(p.logIndex)]),[['opened',11],['BoxSpin',13]],
    'the sweep\'s human box and the other bettor\'s settlement are not this bet\'s rewards');
});

test('contract ABI integration: new pending tickets are counted in entries, not packed bits',async()=>{
  const f=await rpcFixture(); f.answer('GAME','entriesOwedView',([level,player])=>{assert.equal(player.toLowerCase(),PLAYER);return [level===5n?12n:0n];});
  const data=await readChainRoute(`/player/${PLAYER}/holdings`,{client:f.client});assert.equal(data.tickets.find(row=>row.level===5).pendingEntries,12);assert.equal(data.tickets.find(row=>row.level===5).entryCount,12);
});

test('contract ABI integration: Decimator winners divide by the entire winning field and split odd wei correctly',async()=>{
  const f=await rpcFixture();
  for(const [member,value] of Object.entries({burn:10,bucket:2,subBucket:1,claimed:0}))await f.field('GAME','decBurn',value,10,PLAYER,member);
  for(const [member,value] of Object.entries({poolWei:303,totalBurn:30}))await f.field('GAME','decClaimRounds',value,10,member);
  await f.field('GAME','decBucketOffsetPacked',1,10);
  const row=await readChainRoute(`/player/${PLAYER}/decimator?level=10`,{client:f.client});assert.equal(row.ethAmount,'50');assert.equal(row.lootboxAmount,'51');
});

test('contract ABI integration: all late settlements in a transaction stay under their actual day anchor',async()=>{
  const f=await rpcFixture();const block=9999;
  await f.event('GAME','DailyRngApplied',{day:118,finalWord:111},{block,index:0});
  await f.event('GAME','DailyRngApplied',{day:119,finalWord:222},{block,index:1});
  await f.event('GAME','DailyRngApplied',{day:120,finalWord:333},{block,index:2});
  await f.event('GAME','DailyWinningTraits',{day:120,mainTraitsPacked:123,bonusTraitsPacked:456},{block,index:3});
  await f.event('GAME','JackpotEthWin',{winner:PLAYER,level:6,traitId:0,amount:44},{block,index:4});
  await f.event('GAME','PrizePoolDailySnapshot',{day:120},{block,index:5});
  const gap=await readChainRoute('/game/jackpot/day/119/winners',{client:f.client});assert.equal(gap.winners.length,0);
  const daily=await readChainRoute('/game/jackpot/day/120/winners',{client:f.client});assert.equal(daily.winners[0].totalEth,'44');
  const replay=await readChainRoute('/replay/day/120',{client:f.client});assert.equal(replay.rng.finalWord,'333');assert.equal(replay.distributions.length,1);
});

test('contract ABI integration: coin-draw craps winners and the fill-draw battle map onto jackpot awards',async()=>{
  // Audit 5790a946: a coin draw's craps half logs CoinDrawCrapsWin (no trait, no amount), and the
  // purchase-day fill draw is played by COIN_DRAW_BATTLE, which logs its own run/pot events.
  const f=await rpcFixture();const block=9999;const OTHER='0x'+'22'.repeat(20);const THIRD='0x'+'33'.repeat(20);
  await f.event('GAME','DailyRngApplied',{day:120,finalWord:333},{block,index:0});
  await f.event('GAME','DailyWinningTraits',{day:120,mainTraitsPacked:123,bonusTraitsPacked:456},{block,index:1});
  await f.event('GAME','CoinDrawCrapsWin',{winner:PLAYER,winnerLevel:7,fullDay:true,refused:false},{block,index:2});
  await f.event('GAME','CoinDrawCrapsWin',{winner:OTHER,winnerLevel:7,fullDay:false,refused:true},{block,index:3});
  await f.event('COIN_DRAW_BATTLE','CoinDrawBattleRun',{level:6,player:THIRD,units:1,bankrollOut:0,rolls:40,paid:0},{block,index:4});
  await f.event('COIN_DRAW_BATTLE','CoinDrawBattleRun',{level:6,player:PLAYER,units:2,bankrollOut:250,rolls:200,paid:500},{block,index:5});
  await f.event('COIN_DRAW_BATTLE','CoinDrawBattlePot',{level:6,winner:PLAYER,pot:1000},{block,index:6});
  await f.event('GAME','PrizePoolDailySnapshot',{day:120},{block,index:7});
  const daily=await readChainRoute('/game/jackpot/day/120/winners',{client:f.client});
  const summary=await readChainRoute('/game/jackpot/day/120/summary',{client:f.client});
  const mine=daily.winners.find(w=>w.address===PLAYER.toLowerCase());
  assert.deepEqual(mine.breakdown.map(r=>[r.awardType,r.amount,r.crapsAward]).sort(),
    [['craps_pass','1','day'],['farFutureCoin','1000',null],['farFutureCoin','500',null]]);
  assert.equal(String(mine.coinTotal),'1500','the battle run and the pot are both FLIP');
  // A refused opener seat was paid its 2,400 FLIP value instead.
  const other=daily.winners.find(w=>w.address===OTHER);
  assert.deepEqual(other.breakdown.map(r=>[r.awardType,r.amount,r.crapsAward]),[['flip',String(2400n*10n**18n),'opener']]);
  // A busted run is an entrant, not a winner.
  assert.equal(daily.winners.some(w=>w.address===THIRD),false);
  assert.equal(summary.rollTwo.farFuture.winnerCount,2);
  assert.equal(summary.rollTwo.farFuture.totalCoin,'1500');
  const history=await readChainRoute(`/player/${PLAYER}/jackpot-history`,{client:f.client});
  assert.deepEqual(history.wins.map(r=>r.name).sort(),['CoinDrawBattlePot','CoinDrawBattleRun','CoinDrawCrapsWin']);
});

test('contract ABI integration: remaining history and replay paths are implemented',async t=>{
  const f=await rpcFixture();
  for(const path of ['/replay/rng','/replay/tickets/10','/replay/distributions/10','/history/levels?level=10','/history/jackpots?level=10',`/history/player/${PLAYER}`,'/game/craps/lobby/120/results']){
    await t.test(path,async()=>assert.ok(await readChainRoute(path,{client:f.client})));
  }
});

test('Coinflip all-time statistics use packed live results and preserve winning percentages',async()=>{
  const f=await rpcFixture();await f.field('COINFLIP','flipsClaimableDay',40);
  await f.field('COINFLIP','coinflipDayResultPacked',1n<<8n|100n<<16n,0);
  await f.field('COINFLIP','coinflipDayResultPacked',150n<<64n,1);
  const data=await readChainRoute('/game/coinflip/stats',{client:f.client});
  assert.equal(data.wins,2);assert.equal(data.losses,1);assert.deepEqual(data.recent.map(x=>x.day),[40,2,1]);assert.equal(data.recent[0].rewardPercent,150);
  assert.equal(f.requests.filter(r=>r.method==='eth_getLogs').length,0);
});

test('closed BAF standings preserve contract tie order and exclude the vault',async()=>{
  const {OTHER_PLAYER}=await import('./helpers/chain-rpc.js');const f=await rpcFixture();await f.field('JACKPOTS','bafLevel',1,10,'epoch');
  await f.event('JACKPOTS','BafFlipRecorded',{lvl:10,player:OTHER_PLAYER,newTotal:10n**18n});
  await f.event('JACKPOTS','BafFlipRecorded',{lvl:10,player:PLAYER,newTotal:10n**18n+1n});
  await f.event('JACKPOTS','BafFlipRecorded',{lvl:10,player:f.contracts.VAULT,newTotal:100n*10n**18n});
  const data=await readChainRoute('/leaderboards/baf?level=10',{client:f.client});
  assert.deepEqual(data.entries.map(e=>e.player),[OTHER_PLAYER,PLAYER]);assert.equal(data.entries[1].score,String(10n**18n));
});
