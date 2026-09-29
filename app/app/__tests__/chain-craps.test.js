import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeReplay } from '../../chain/craps-worker.js';
import { createHash } from 'node:crypto';
import { crapsFixture as fixture, manifest, hashes } from './helpers/craps-fixture.js';


test('browser producer reproduces the independent production replay fixture byte for byte', () => {
  const bundle = materializeReplay(fixture());
  assert.equal(bundle.digest, manifest.digest);
  assert.deepEqual(JSON.parse(bundle.manifest.body.toString()), manifest);
  for (const child of bundle.children) assert.equal(createHash('sha256').update(child.body).digest('hex'), hashes[child.name]);
});

test('one wrong settlement wei refuses the entire browser replay', () => {
  const input = fixture(); input.seats[0].chainWon += 1n;
  assert.throws(() => materializeReplay(input), /would publish won/);
});

test('chain input assembly recovers actual seat packing and reproduces every settlement', async()=>{
  const {rpcFixture}=await import('./helpers/chain-rpc.js');
  const {keccak256}=await import('../../vendor/ethers-app.mjs');
  const {loadReplayInputs}=await import('../../chain/craps.js');
  const input=fixture(),f=await rpcFixture({head:4000,timestamp:48000,period:1000});
  const key=input.battleKey,slot=input.settlement.boundSlot;
  f.client.chain.codeHashes={CRAPS:keccak256('0x01')};
  await f.field('CRAPS','_battles',24n|(24n<<32n),key);
  const daySeats=input.seats.filter(s=>s.lane==='day').length;
  await f.field('CRAPS','_dayTickets',daySeats,slot/8n*8n);
  await f.field('GAME','lootboxRngWordByIndex',input.word,512);
  await f.event('CRAPS','CrapsBonusOpened',{battleKey:key,slot,bankroll:input.terms.bankroll,goal:input.terms.goal,boardStake:input.terms.boardStake/10n*7n,battleStake:input.terms.battleStake},{block:3500,index:0});
  await f.event('CRAPS','CrapsBonusArmed',{battleKey:key,slot,index:512},{block:3500,index:1});
  await f.event('CRAPS','CrapsHighRollerDayOpened',{day:42,multiplier:Math.max(...input.seats.map(s=>s.multiple))},{block:3500,index:2});
  for(const [i,seat] of input.seats.entries()){
    const high=seat.multiple>1?1n<<(217n+(seat.lane==='day'?slot%8n-1n:0n)):0n;
    await f.field('CRAPS','_bets',BigInt(seat.player)|(BigInt(seat.chips)<<160n)|(BigInt(seat.standing)<<190n)|high,seat.betId);
    await f.event('CRAPS','CrapsBetSettled',{betId:seat.betId,player:seat.player,won:seat.chainWon,paid:seat.chainPaid},{block:3501,index:i});
  }
  await f.event('CRAPS','CrapsBattleFinalized',{battleKey:key,winningScoreBps:59080},{block:3501,index:24});
  const assembled=await loadReplayInputs(f.s,key);
  assert.deepEqual(assembled.terms,input.terms);assert.deepEqual(assembled.seats,input.seats);
  assert.equal(materializeReplay(assembled).entrants,24);
});

test('run 57+: the period-5 jackpot battle replays through the craps table, paid, day and awarded seats alike', async()=>{
  const {rpcFixture,PLAYER}=await import('./helpers/chain-rpc.js');
  const {keccak256}=await import('../../vendor/ethers-app.mjs');
  const {loadReplayInputs}=await import('../../chain/craps.js');
  const {settleBattle}=await import('../../chain/craps-engine.js');
  const {useSchema,CURRENT_SCHEMA_HASH}=await import('../../chain/schema.js');
  const previous=useSchema(CURRENT_SCHEMA_HASH);
  try{
    const f=await rpcFixture({head:4000,timestamp:48000,period:1000});
    f.client.chain.codeHashes={CRAPS:keccak256('0x01')};
    // Day 42's jackpot slot: _slotOf(42, 5) = 42 * 8 + 6. Its key is its slot (`_slotWindow`).
    const slot=42n*8n+6n,daySlot=42n*8n,key='0x'+slot.toString(16).padStart(64,'0');
    const word=BigInt(keccak256('0x6a61636b706f74'));const bankroll=1_800n*10n**18n;
    const wallet=i=>'0x'+(0xbeef00n+BigInt(i)).toString(16).padStart(40,'0');
    // Dense walk (`_seatId`): two paid seats, one day ticket, then two AWARDED seats (the same wallet
    // twice: an award keys its dice to its bet id, so they are two different runs).
    const seats=[
      {betId:(slot<<64n)|1n,player:PLAYER.toLowerCase(),chips:0o3,award:0n,lane:'window'},
      {betId:(slot<<64n)|2n,player:wallet(1),chips:0o1002,award:0n,lane:'window'},
      {betId:(daySlot<<64n)|1n,player:wallet(2),chips:0,award:0n,lane:'day'},
      {betId:(slot<<64n)|3n,player:wallet(3),chips:0o10,award:1n,lane:'window'},
      {betId:(slot<<64n)|4n,player:wallet(3),chips:0o10,award:1n,lane:'window'},
    ];
    await f.field('CRAPS','_battles',5n|(5n<<32n),key);
    await f.field('CRAPS','_dayTickets',1n,daySlot);
    for(const [member,value] of [['word',word],['bankroll',bankroll],['bountyUnits',12n],['drawnCount',2n],['drawnUnits',2n],['multiplierBps',15_000n]]) await f.field('CRAPS','_jackpotRounds',value,slot,member);
    await f.event('CRAPS','JackpotBattleStarted',{slot,level:7,drawnEntries:2,drawnUnits:2,word},{block:3600,index:0});
    // The day runs a 3x high lane (no high seat sits in this field).
    await f.event('CRAPS','CrapsHighRollerDayOpened',{day:42,multiplier:3,mainBudget:0,highBudget:0},{block:3600,index:1});
    let index=0;
    for(const [i,seat] of seats.entries()){
      const header=BigInt(seat.player)|(BigInt(seat.chips)<<160n)|((seat.award?100n:0n)<<190n)|(seat.award<<224n);
      await f.field('CRAPS','_bets',header,seat.betId);
      const r=settleBattle(seat.betId,header,bankroll/5n/(10n*10n**18n),bankroll,bankroll*5n,slot,(5n<<64n)|BigInt(i+1),word);
      seat.won=r.bankrollOut;seat.paid=r.bankrollIn;
      await f.event('CRAPS','CrapsBetSettled',{betId:seat.betId,player:seat.player,won:seat.won,paid:seat.paid},{block:3700,index:index++});
    }
    await f.event('CRAPS','CrapsBattleFinalized',{battleKey:key,winningScoreBps:12000},{block:3700,index:index++});
    const assembled=await loadReplayInputs(f.s,key);
    assert.equal(assembled.word,word,'the round\'s own word, not a lootbox index');
    assert.equal(assembled.settlement.boundIndex,0n);
    assert.equal(assembled.rollBudget,undefined,'the current contracts replay at the engine\'s 1,000-roll budget');
    // Audit e579cd318: a jackpot high seat rides `bankroll + highExtra` of fee-funded capital,
    // highExtra = (H - 1) * JACKPOT_FEE (8,000 FLIP) * multiplierBps / 20_000 (CrapsBattle.sol:318).
    assert.deepEqual(assembled.terms,{bankroll,goal:bankroll*5n,boardStake:bankroll/5n,battleStake:12n*100n*10n**18n,
      highExtra:(3n-1n)*8_000n*10n**18n*15_000n/20_000n});
    assert.deepEqual(assembled.seats.map(s=>[s.betId,s.lane,s.awardUnits??0]),seats.map(s=>[s.betId,s.lane,Number(s.award)]));
    const bundle=materializeReplay(assembled);
    assert.equal(bundle.entrants,5,'every settlement reproduced, the awarded seats on their own dice');
    // The rotation timeline follows the contract's dense walk: paid, day ticket, then awarded.
    const {rotationTurn,crapsSeed}=await import('../../chain/craps-engine.js');
    const maxHands=JSON.parse(bundle.manifest.body.toString()).tape.maxHands;
    const featured=JSON.parse(bundle.children.find(c=>c.name==='featured').body.toString());
    const expected=seats.flatMap((seat,i)=>{const turn=rotationTurn(crapsSeed(word,slot),5n,BigInt(i+1));
      return turn===0n||turn>BigInt(maxHands)?[]:[[Number(turn-1n),seat.betId.toString()]];}).sort((a,b)=>a[0]-b[0]);
    assert.deepEqual(featured.shooterTimeline.map(row=>[row.shooter,row.betId]),expected);
  }finally{useSchema(previous);}
});
