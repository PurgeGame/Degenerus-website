import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';

test('contract ABI integration: current state and balances use RPC without any HTTP API', async()=>{
  const f=await rpcFixture();
  await f.field('GAME','level',6);
  f.answer('GAME','mintPrice',[120n]);f.answer('COIN','balanceOf',[987654321n]);f.answer('GAME','claimableWinningsOf',[123456789n]);
  const state=await readChainRoute('/game/state',{client:f.client});assert.equal(state.level,6);assert.equal(state.price,'120');
  // jackpotFlags bit 0 (JACKPOT_TURBO) is the one-day schedule; normal is three days.
  assert.equal(state.jackpotDays,3);await f.field('GAME','jackpotFlags',3);
  const turbo=await readChainRoute('/game/state',{client:f.client});assert.equal(turbo.jackpotFlags,3);assert.equal(turbo.jackpotDays,1);
  await f.field('GAME','decimatorFlags',2);
  assert.equal((await readChainRoute('/game/state',{client:f.client})).decWindowOpen,false);
  await f.field('GAME','decimatorFlags',3);
  assert.equal((await readChainRoute('/game/state',{client:f.client})).decWindowOpen,true);
  const p=await readChainRoute(`/player/${PLAYER}`,{client:f.client});assert.equal(p.claimableEth,'123456789');assert.equal(p.flipBalance,String(987654321n*10n**18n),'FLIP is whole tokens on chain, token wei here');
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
  // A bet is (index, betId) — betIds restart in every RNG index — and
  // degeneretteBetInfo(index, betId) is its queued word, zero once settled.
  const f=await rpcFixture();await f.wallet(37,PLAYER);
  await f.event('GAME','DegeneretteBetPlaced',{player:37,index:7,betId:1,packed:123},{block:2});
  await f.event('GAME','DegeneretteBetPlaced',{player:37,index:8,betId:2,packed:456},{block:3});
  await f.event('GAME','DegeneretteBetPlaced',{player:37,index:9,betId:2,packed:789},{block:4});
  await f.event('GAME','DegeneretteResolved',{playerId:37,index:8,betId:2,totalPayout:0,resultTraits:0,spins:'0x0000000000'},{block:5});
  const words=new Map([['7:1',123n],['8:2',0n],['9:2',789n]]);
  f.answer('GAME','degeneretteBetInfo',([index,betId])=>[words.get(`${index}:${betId}`)??0n]);
  const data=await readChainRoute(`/player/${PLAYER}?pending=1`,{client:f.client});
  assert.deepEqual(data.degenerette.pendingBets,[
    {betId:'1',betIndex:7,packedData:'123'},
    {betId:'2',betIndex:9,packedData:'789'},
  ],'bet 2 at index 8 settled; bet 2 at index 9 is a different, still-queued bet');
});

test('contract ABI integration: a keeper-swept bet feeds its own spins, Luckbox and record chain only',async()=>{
  // mineFlip() settles every bet at an index in ONE transaction, after that
  // index's human boxes. The feed must price each spin from the bet word (no per-spin event)
  // and attribute only the bet's own log window to it.
  const {ETH_DIVISOR}=await import('../chain-config.js');
  const f=await rpcFixture();await f.wallet(37,PLAYER);await f.wallet(73,OTHER_PLAYER);
  const unit=(10n**9n)/BigInt(ETH_DIVISOR); const stake=(10n**16n)/BigInt(ETH_DIVISOR);
  const packed=37n|(1n<<37n)|(1n<<43n)|((stake/unit)<<60n); // wallet 37, one ETH spin, record armed
  const placeTx='0x'+'aa'.repeat(32), sweepTx='0x'+'bb'.repeat(32);
  await f.event('GAME','DegeneretteBetPlaced',{player:37,index:7,betId:1,packed},{block:9990,index:0,tx:placeTx});
  await f.event('COINFLIP','BigRecordUpdated',{kind:1,id:37,value:1000n,paid:900n,sdgnrsPaid:0},{block:9990,index:1,tx:placeTx});
  await f.event('GAME','LootboxRngApplied',{index:7,word:0xabcd},{block:9994,index:0});
  const spins='0x'+(1234).toString(16).padStart(8,'0')+'05'; // one spin: S5, no house wilds
  const record=(1n<<63n)|(3n<<60n)|5n;
  await f.event('GAME','LootBoxOpened',{id:37,lootboxIndex:7,amount:1,futureLevel:1,futureTickets:4},{block:9995,index:10,tx:sweepTx}); // human box
  await f.event('GAME','LootBoxOpened',{id:37,lootboxIndex:0,amount:2,futureLevel:1,futureTickets:4},{block:9995,index:11,tx:sweepTx}); // our direct box
  await f.event('GAME','DegeneretteResolved',{playerId:37,index:7,betId:1,totalPayout:9n*stake,resultTraits:13,spins},{block:9995,index:12,tx:sweepTx});
  await f.event('GAME','BoxSpin',{playerId:37,betId:record,packedSpins:0,payout:0,ethShare:0},{block:9995,index:13,tx:sweepTx}); // our record chain
  await f.event('GAME','DegeneretteResolved',{playerId:73,index:7,betId:2,totalPayout:0,resultTraits:13,spins},{block:9995,index:14,tx:sweepTx});
  const feed=await readChainRoute(`/degenerette/feed?player=${PLAYER}`,{client:f.client});
  assert.equal(feed.items.length,1);
  const [item]=feed.items;
  assert.equal(item.betIndex,7);assert.equal(item.betId,'1');assert.equal(item.rngReady,true);
  assert.equal(item.recordStake,String(900n*10n**18n),'the whole-FLIP record claim comes from the placement receipt');
  const resolved=item.results.find(r=>r.resultType==='resolved');
  assert.equal(resolved.resultData.spinCount,1);assert.equal(resolved.resultData.spins,spins);
  const [spin]=item.results.filter(r=>r.resultType==='result');
  assert.equal(spin.resultData.matches,'5');assert.equal(spin.resultData.playerTraits,'1234');
  assert.equal(spin.payout,String(9n*stake),'S5 at activity 0 is the 10x base at 90% ROI with no house wilds — the module payout math');
  assert.deepEqual(item.lootboxPayouts.map(p=>[p.rewardType,Number(p.logIndex)]),[['opened',11],['BoxSpin',13]],
    'the sweep\'s human box and the other bettor\'s settlement are not this bet\'s rewards');
});

test('contract ABI integration: new pending tickets are counted in entries, not packed bits',async()=>{
  const f=await rpcFixture(); f.answer('GAME','entriesOwedView',([level,player])=>{assert.equal(player.toLowerCase(),PLAYER);return [level===5n?12n:0n];});
  const data=await readChainRoute(`/player/${PLAYER}/holdings`,{client:f.client});assert.equal(data.tickets.find(row=>row.level===5).pendingEntries,12);assert.equal(data.tickets.find(row=>row.level===5).entryCount,12);
});

test('contract ABI integration: Decimator winners split the pool with the champion bonus and its odd wei',async()=>{
  // The wallet slot names its entry, one word keyed lvl << 64 | id (owner | chips << 160 |
  // whole-FLIP stack << 190); ranked winners wait in the heap until paid. 303 wei over 3 winners: 5% (15) to the champion, 96 each, and the division dust (3)
  // to the champion too, so the champion's place pays 303 - 2 x 96 = 111.
  const id=4n; const word=5n;
  const seed=async(paid,place,champion)=>{
    const f=await rpcFixture();await f.wallet(37,PLAYER);
    await f.field('GAME','decBattlePlayers',(10n<<64n)|id,PLAYER);
    await f.field('GAME','decBattleEntries',37n|(10n<<190n),(10n<<64n)|id);
    for(const [member,value] of Object.entries({poolWei:303,count:30,phase:2,winners:3,paid,champion}))await f.field('GAME','decBattleRounds',value,10,member);
    await f.event('GAME','DecimatorResolved',{lvl:10,rngWord:word,poolWei:303,entrants:30});
    await f.field('GAME','decBattleHeap',id,place);
    return readChainRoute(`/player/${PLAYER}/decimator?level=10`,{client:f.client});
  };
  const champ=await seed(0,0,id);assert.equal(champ.ethAmount,'111');assert.equal(champ.champion,true);assert.equal(champ.halfPasses,'0');
  const other=await seed(1,2,9n);assert.equal(other.ethAmount,'96');assert.equal(other.winner,true);assert.equal(other.lootboxAmount,'0');
});

test('contract ABI integration: all late settlements in a transaction stay under their actual day anchor',async()=>{
  const f=await rpcFixture();await f.wallet(37,PLAYER);const block=9999;
  await f.event('GAME','DailyRngApplied',{day:118,finalWord:111},{block,index:0});
  await f.event('GAME','DailyRngApplied',{day:119,finalWord:222},{block,index:1});
  await f.event('GAME','DailyRngApplied',{day:120,finalWord:333},{block,index:2});
  await f.event('GAME','DailyWinningTraits',{day:120,mainTraitsPacked:123},{block,index:3});
  await f.event('GAME','JackpotEthWin',{walletId:37,level:6,traitId:0,amount:44},{block,index:4});
  await f.event('GAME','PrizePoolDailySnapshot',{day:120},{block,index:5});
  const gap=await readChainRoute('/game/jackpot/day/119/winners',{client:f.client});assert.equal(gap.winners.length,0);
  const daily=await readChainRoute('/game/jackpot/day/120/winners',{client:f.client});assert.equal(daily.winners[0].totalEth,'44');
  const replay=await readChainRoute('/replay/day/120',{client:f.client});assert.equal(replay.rng.finalWord,'333');assert.equal(replay.distributions.length,1);
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
  const f=await rpcFixture();await f.wallet(1,f.contracts.VAULT);await f.wallet(37,PLAYER);await f.wallet(73,OTHER_PLAYER);
  await f.field('JACKPOTS','bafLevel',1,10,'epoch');
  await f.event('JACKPOTS','BafFlipRecorded',{lvl:10,id:73,newTotal:1});
  await f.event('JACKPOTS','BafFlipRecorded',{lvl:10,id:37,newTotal:1});
  await f.event('JACKPOTS','BafFlipRecorded',{lvl:10,id:1,newTotal:100});
  const data=await readChainRoute('/leaderboards/baf?level=10',{client:f.client});
  assert.deepEqual(data.entries.map(e=>e.player),[OTHER_PLAYER,PLAYER]);assert.equal(data.entries[1].score,String(10n**18n));
});

test('contract ABI integration: a Bingo proof for a level the game has left is refused as expired',async()=>{
  // claimBingo reverts BingoExpired once `lvl < level` (DegenerusGameBingoModule.sol:146).
  const {bingoProof}=await import('../../chain/positions.js');
  const f=await rpcFixture(); await f.field('GAME','level',6);
  await f.field('GAME','ticketBufferLevels',6n | (7n << 24n));
  await assert.rejects(bingoProof(PLAYER,5,3,{client:f.client}),error=>error.code==='BingoExpired');
  await assert.rejects(bingoProof(PLAYER,6,3,{client:f.client}),error=>error.code!=='BingoExpired',
    'the current level is still open (its proof fails later, for want of entries)');
});
