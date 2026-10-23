import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeReplay } from '../../chain/craps-worker.js';
import { createHash } from 'node:crypto';
import { crapsFixture as fixture, manifest, hashes } from './helpers/craps-fixture.js';


test('browser producer reproduces the independent wallet-ID replay fixture byte for byte', async () => {
  const bundle = await materializeReplay(fixture());
  assert.equal(bundle.digest, manifest.digest);
  assert.deepEqual(JSON.parse(bundle.manifest.body.toString()), manifest);
  for (const child of bundle.children) assert.equal(createHash('sha256').update(child.body).digest('hex'), hashes[child.name]);
});

test('one wrong settlement wei refuses the entire browser replay', async () => {
  const input = fixture(); input.seats[0].chainWon += 1n;
  await assert.rejects(() => materializeReplay(input), /would publish won/);
});

// A scheduled bet lives in one of 64 day banks. Three 72-bit seats share a storage word: a seat's
// lane holds its wallet ID (bits 0..31), its chips (32..61) and its high bit (65 + the window it
// holds high for a day ticket); the word's bits 216..239 carry the bank's exact day
// (CrapsBattleStorage._storeBet).
const seatWords = new WeakMap();
const storeScheduledBet = async (f, betId, lane) => {
  const { crapsBetStorageKey } = await import('../../chain/craps.js');
  const id = BigInt(betId), seat = id & ((1n << 64n) - 1n), key = crapsBetStorageKey(id);
  // A bank reused by a later day starts over: only the new day's seats are in it.
  if (!seatWords.has(f)) seatWords.set(f, new Map());
  const words = seatWords.get(f);
  const prior = words.get(key);
  const tag = (id >> 67n) << 216n;
  const word = (prior != null && (prior >> 216n) === (id >> 67n) ? prior : tag) | (BigInt(lane) << (((seat - 1n) % 3n) * 72n));
  words.set(key, word);
  await f.field('CRAPS', '_bets', word, key);
};

test('chain input assembly recovers actual seat packing and reproduces every settlement', async()=>{
  const {rpcFixture}=await import('./helpers/chain-rpc.js');
  const {keccak256}=await import('../../vendor/ethers-app.mjs');
  const {loadReplayInputs}=await import('../../chain/craps.js');
  // The reader reports no standing for any seat (the retired bits carry the day tag).
  const input={...fixture(),seats:fixture().seats.map(seat=>({...seat,standing:0}))},f=await rpcFixture({head:4000,timestamp:48000,period:1000});
  const key=input.battleKey,slot=input.settlement.boundSlot;
  f.client.chain.codeHashes={CRAPS:keccak256('0x01')};
  for(const seat of input.seats) await f.wallet(seat.playerId,seat.player);
  await f.crapsField('_battles',24n|(24n<<32n),key);
  const daySeats=input.seats.filter(s=>s.lane==='day').length;
  await f.crapsField('_dayTickets',daySeats,slot/8n*8n);
  await f.event('GAME','LootboxRngApplied',{index:1,word:input.word},{block:3500,index:4});
  // Raw logs carry whole FLIP; the decoder scales them to token wei and the reader undoes that.
  await f.event('CRAPS','CrapsBonusOpened',{battleKey:key,slot,bankroll:input.terms.bankroll,goal:input.terms.goal,boardStake:input.terms.boardStake/10n*7n,battleStake:input.terms.battleStake},{block:3500,index:0});
  await f.event('CRAPS','CrapsBonusArmed',{battleKey:key,slot,index:1},{block:3500,index:1});
  await f.event('CRAPS','CrapsHighRollerDayOpened',{day:42,multiplier:Math.max(...input.seats.map(s=>s.multiple))},{block:3500,index:2});
  for(const [i,seat] of input.seats.entries()){
    const high=seat.multiple>1?1n<<(65n+(seat.lane==='day'?slot%8n-1n:0n)):0n;
    await storeScheduledBet(f,seat.betId,BigInt(seat.playerId)|(BigInt(seat.chips)<<32n)|high);
    await f.event('CRAPS','CrapsBetSettled',{betId:seat.betId,playerId:seat.playerId,won:seat.chainWon,paid:seat.chainPaid},{block:3501,index:i});
  }
  await f.event('CRAPS','CrapsProgressiveFunded',{day:42,contribution:1000,balance:123456},{block:3500,index:3});
  await f.event('CRAPS','CrapsBattleFinalized',{battleKey:key,winningScoreBps:59080},{block:3501,index:24});
  await f.event('CRAPS','CrapsProgressiveFunded',{day:43,contribution:1000,balance:124456},{block:3501,index:25});
  const assembled=await loadReplayInputs(f.s,key);
  assert.deepEqual(assembled.terms,input.terms,'whole-FLIP terms reach the producer unscaled');
  assert.deepEqual(assembled.seats,input.seats);
  assert.equal((await materializeReplay(assembled)).entrants,24);
  assert.equal(assembled.prize.progressivePoolWei,String(123456n*10n**18n),'presentation keeps token wei');
  // The pointer carries the boost rung drawn off (word, battle key), independently re-derived here.
  const {AbiCoder}=await import('../../vendor/ethers-app.mjs');
  const roll=BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','uint256','uint256'],[29n,input.word,BigInt(key)])))%1000n;
  assert.equal(assembled.prize.bonusMultiplier,roll<768n?0.25:roll<976n?1:roll<996n?10:100);
  assert.equal(assembled.progressive.amountWei,123456n,'the producer takes the chain figure');
  // A day bank reused 64 days later no longer holds this field's slips.
  const seat=input.seats[0]; const later=seat.betId+(64n<<67n);
  await storeScheduledBet(f,later,BigInt(seat.playerId));
  assert.deepEqual((await loadReplayInputs(f.s,key)).seats, input.seats,
    'the immutable placement events recover slips after their retained bank is reused');
});

test('a jackpot high seat rides extra capital at its round\'s own fee', async () => {
  const { jackpotHighExtra } = await import('../../chain/craps-engine.js');
  const { crapsJackpotEntryPrice } = await import('../../chain/craps.js');
  const extra = (high, round) => jackpotHighExtra(BigInt(high), BigInt(round.multiplierBps), crapsJackpotEntryPrice(round));
  assert.equal(extra(1, { entryPrice: 10_000n, multiplierBps: 30_000n }), 0n);
  assert.equal(extra(10, { entryPrice: 10_000n, multiplierBps: 30_000n }), 135_000n);
  assert.equal(extra(10, { entryPrice: 6_000n, multiplierBps: 5_000n }), 13_500n);
  assert.throws(() => jackpotHighExtra(10n, 5_000n), /entryPrice/, 'the engine refuses a constant-fee form');
});

test('the period-5 jackpot battle replays through the craps table, paid, day and awarded seats alike', async()=>{
  const {rpcFixture}=await import('./helpers/chain-rpc.js');
  const {keccak256}=await import('../../vendor/ethers-app.mjs');
  const {loadReplayInputs}=await import('../../chain/craps.js');
  const {settleBattle,rotationTurn,crapsSeed}=await import('../../chain/craps-engine.js');
  const f=await rpcFixture({head:4000,timestamp:48000,period:1000});
  f.client.chain.codeHashes={CRAPS:keccak256('0x01')};
  // Day 42's jackpot slot: _slotOf(42, 5) = 42 * 8 + 6. Its key is its slot (`_slotWindow`).
  // Every money figure is whole FLIP; token wei is 10^18 per FLIP.
  const slot=42n*8n+6n,daySlot=42n*8n,key='0x'+slot.toString(16).padStart(64,'0'),WEI=10n**18n;
  const word=BigInt(keccak256('0x6a61636b706f74'));const bankroll=1_800n;
  const wallet=i=>'0x'+(0xbeef00n+BigInt(i)).toString(16).padStart(40,'0');
  const player=wallet(0);
  // Dense walk (`_seatId`): two paid seats, one day ticket, then two AWARDED seats (the same wallet
  // twice: an award keys its dice to its bet id, so they are two different runs).
  const seats=[
    {betId:(slot<<64n)|1n,player,id:5,chips:0o3,award:0n,lane:'window'},
    {betId:(slot<<64n)|2n,player:wallet(1),id:6,chips:0o1002,award:0n,lane:'window'},
    {betId:(daySlot<<64n)|1n,player:wallet(2),id:7,chips:0,award:0n,lane:'day'},
    {betId:(slot<<64n)|3n,player:wallet(3),id:8,chips:0o10,award:1n,lane:'window'},
    {betId:(slot<<64n)|4n,player:wallet(3),id:8,chips:0o10,award:1n,lane:'window'},
  ];
  for(const seat of seats) await f.wallet(seat.id,seat.player);
  await f.crapsField('_battles',5n|(5n<<32n),key);
  await f.crapsField('_dayTickets',1n,daySlot);
  // The round keeps its own drawn fee (`entryPrice`) — this day drew 10,000 — and the paid field's
  // size, which is how an awarded seat (one past the paid count) is told from a paid one.
  for(const [member,value] of [['drawWord',word],['drawCursor',1n<<207n],['started',1n],['bankroll',bankroll],['bountyUnits',12n],['requestDay',42n],['paidCount',3n],['drawnCount',2n],['drawnUnits',2n],['multiplierBps',30_000n],['entryPrice',10_000n]]) await f.crapsField('_jackpotRounds',value,slot,member);
  await f.event('CRAPS','JackpotBattleStarted',{slot,level:7,drawnEntries:2,drawnUnits:2,word},{block:3600,index:0});
  // The day runs a 3x high lane (no high seat sits in this field).
  await f.event('CRAPS','CrapsHighRollerDayOpened',{day:42,multiplier:3,mainBoostBudget:0,highRollerBoostBudget:0},{block:3600,index:1});
  let index=0;
  for(const [i,seat] of seats.entries()){
    const lane=BigInt(seat.id)|(BigInt(seat.chips)<<32n);
    await storeScheduledBet(f,seat.betId,lane);
    // The reader flags an awarded seat above the lane (`crapsBetWord`); the engine reads the flag.
    const header=lane|(seat.award<<72n);
    const r=settleBattle(seat.betId,header,bankroll*2n/5n/10n,bankroll,bankroll*5n,slot,(5n<<64n)|BigInt(i+1),word);
    seat.won=r.bankrollOut;seat.paid=r.bankrollIn;
    await f.event('CRAPS','CrapsBetSettled',{betId:seat.betId,playerId:seat.id,won:seat.won,paid:seat.paid},{block:3700,index:index++});
  }
  const pot = 6_017n; // Exact remainder, not just five posted bounties.
  await f.event('CRAPS','CrapsBattleFinalized',{battleKey:key,winningScoreBps:12000,pot},{block:3700,index:index++});
  // The RIU award is 5% of the pool. Later funding in the same block must
  // neither replace the historical pool nor inflate the winner's receipt.
  const poolBefore = 129_039n, award = poolBefore / 20n;
  await f.event('CRAPS','CrapsProgressivePaid',{
    battleKey:key,betId:seats[0].betId,playerId:seats[0].id,
    poolBps:500,scoreBps:350000,candidate:award,paid:award,balance:poolBefore-award,
  },{block:3700,index:index++});
  await f.event('CRAPS','CrapsProgressiveFunded',{
    day:43,contribution:500_000n,balance:poolBefore-award+500_000n,
  },{block:3700,index:index++});
  const assembled=await loadReplayInputs(f.s,key);
  assert.equal(assembled.word,word,'the round\'s own word, not a lootbox index');
  assert.equal(assembled.settlement.boundIndex,0n);
  assert.deepEqual(assembled.prize,{mainPotWei:String(pot*WEI),jackpotMultiplierBps:30_000,bonusMultiplier:null,progressivePoolWei:String(poolBefore*WEI)},
    'presentation figures are token wei');
  assert.equal(assembled.rollBudget,undefined,'the contract replays at the engine\'s default roll budget');
  // A jackpot high seat rides `bankroll + highExtra` of fee-funded capital, highExtra =
  // (H - 1) * r.entryPrice * multiplierBps / 20_000 (`_slotWindow`), in whole FLIP.
  assert.deepEqual(assembled.terms,{bankroll,goal:bankroll*5n,boardStake:bankroll*2n/5n,battleStake:12n*100n,
    highExtra:(3n-1n)*10_000n*30_000n/20_000n});
  assert.deepEqual(assembled.seats.map(s=>[s.betId,s.lane,s.awardUnits??0]),seats.map(s=>[s.betId,s.lane,Number(s.award)]));
  const bundle=await materializeReplay(assembled);
  assert.equal(bundle.entrants,5,'every settlement reproduced, the awarded seats on their own dice');
  // The rotation timeline follows the contract's dense walk: paid, day ticket, then awarded.
  const maxHands=JSON.parse(bundle.manifest.body.toString()).tape.maxHands;
  const featured=JSON.parse(bundle.children.find(c=>c.name==='featured').body.toString());
  const expected=seats.flatMap((seat,i)=>{const turn=rotationTurn(crapsSeed(word,slot),5n,BigInt(i+1));
    const rows=[]; if(turn!==0n) for(let hand=Number(turn-1n);hand<maxHands;hand+=seats.length) rows.push([hand,seat.betId.toString()]); return rows;}).sort((a,b)=>a[0]-b[0]);
  assert.deepEqual(featured.shooterTimeline.map(row=>[row.shooter,row.betId]),expected);
  assert.equal(assembled.progressive.amountWei,award);
  assert.equal(assembled.progressive.status,'won');
});
