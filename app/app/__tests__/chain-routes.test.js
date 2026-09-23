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
  const f=await rpcFixture();
  await f.event('GAME','DegeneretteBetPlaced',{player:PLAYER,index:7,betId:1,packed:123},{block:2});
  await f.event('GAME','DegeneretteBetPlaced',{player:PLAYER,index:8,betId:2,packed:456},{block:3});
  await f.event('GAME','DegeneretteResolved',{player:PLAYER,betId:2},{block:4});
  await f.field('GAME','degeneretteBets',123,PLAYER,1);
  const data=await readChainRoute(`/player/${PLAYER}?pending=1`,{client:f.client});
  assert.deepEqual(data.degenerette.pendingBets,[{betId:'1',betIndex:7,packedData:'123'}]);
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
