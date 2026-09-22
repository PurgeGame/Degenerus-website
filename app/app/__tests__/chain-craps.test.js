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
