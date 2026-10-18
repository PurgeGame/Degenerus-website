import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { useSchema, CURRENT_SCHEMA_HASH } from '../../chain/schema.js';
import { materializeReplay } from '../../chain/craps-worker.js';
import { crapsFixture } from './helpers/craps-fixture.js';
import { queuedBoxRolls, BOX_ENTRY_VALUE_UNIT_WEI } from '../box-queue-rolls.js';
import { boxReference } from '../../chain/box-queue.js';
import { deriveHumanLootboxSpinBetIds } from '../lootbox-legs.js';

function current(fn) { const prior=useSchema(CURRENT_SCHEMA_HASH);try{return fn();}finally{useSchema(prior);} }

test('run 66 browser replay matches the independent database wallet-ID fixture byte for byte',async()=>{
  const {manifest,players,hashes}=JSON.parse(readFileSync(new URL('../../chain/fixtures/craps-wallet-ids.json',import.meta.url)));
  const input=crapsFixture(), ids=new Map(), byBet=new Map(players.map(p=>[p.betId,p]));
  input.seats=input.seats.map(seat=>{
    if(!ids.has(seat.player))ids.set(seat.player,ids.size+37);
    const expected=byBet.get(String(seat.betId));
    return {...seat,playerId:ids.get(seat.player),chainWon:BigInt(expected.wonWei)/10n**18n,chainPaid:BigInt(expected.paidWei)/10n**18n};
  });
  input.ruleset=manifest.ruleset;
  const bundle=await materializeReplay(input);
  assert.equal(bundle.digest,manifest.digest);
  assert.deepEqual(JSON.parse(bundle.manifest.body.toString()),manifest);
  for(const child of bundle.children)assert.equal(createHash('sha256').update(child.body).digest('hex'),hashes[child.name]);
  input.seats[0].playerId+=100;
  await assert.rejects(()=>materializeReplay(input),/would publish/);
});

test('queued box rolls bind buffer, position and wallet ID; one lane of quantity boxes (audit 4f4aa8377)',()=>current(()=>{
  // §2: wallet 37, 40 units per box, score code 1,500, boost 2,500 bps, quantity 4.
  const packedBox=37n|(40n<<32n)|(1500n<<53n)|(2500n<<65n)|(4n<<77n);
  const args={packedBox,rngWord:123456789n,lootboxIndex:boxReference(0,7)};
  const entry=queuedBoxRolls(args,()=>{throw new Error('the entry stores no preset level');},()=>10000n);
  const perBox=40n*BOX_ENTRY_VALUE_UNIT_WEI;
  assert.deepEqual(entry.rolls.map(r=>r.scaled),Array(4).fill(perBox+perBox*2500n/10000n));
  assert.deepEqual(entry.rolls.map(r=>r.nonce),[0n,1n,2n,3n],'box n draws its boon at nonce n - 1');
  assert.equal(entry.score,1500n);
  assert.equal(new Set(entry.rolls.map(r=>r.seed)).size,4);
  const first=deriveHumanLootboxSpinBetIds(args);
  assert.equal(first.length,12);
  for(const patch of [{lootboxIndex:boxReference(0,8)},{lootboxIndex:boxReference(1,7)},{packedBox:packedBox+1n}]) {
    const next=deriveHumanLootboxSpinBetIds({...args,...patch});
    assert.ok(next.every(id=>!first.includes(id)),'buffer, position and wallet ID each bind the entropy');
  }
  assert.deepEqual(deriveHumanLootboxSpinBetIds({rngWord:123n,player:'0x'+'11'.repeat(20),amountWei:10n}),[],'missing queue commitment cannot fall back to address entropy');
}));


test('run 66 record bounty entropy is bound to the wallet ID', async () => {
  const {AbiCoder,keccak256}=await import('ethers');
  const {dgnRecordBountyHeroQuadrants}=await import('../dgn-reels.js');
  current(()=>{
    const seed=BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','uint256','uint256','uint256'],[123n,37,8,0x5265636f7264n])));
    const args={rngWord:123n,parentBetId:8,playerId:37,symbol:9,boxBetId:(1n<<63n)|(3n<<60n)|(seed&((1n<<60n)-1n))};
    assert.deepEqual(dgnRecordBountyHeroQuadrants(args),[1,1,1]);
    assert.equal(dgnRecordBountyHeroQuadrants({...args,playerId:38}),null);
  });
});


test('run 66 Degenerette decodes testnet ETH stake units independently of the wallet-ID layout', async () => {
  const { decodeDegeneretteBetWord, degeneretteStakeUnit, floorDegeneretteStake } = await import('../degenerette.js');
  const { displayEth } = await import('../scaling.js');
  current(() => {
    // The deployed overlay stores ETH in 1,000-wei units. This is 2.16 display ETH,
    // including its boon, for each of three cards (not 2,160,000 ETH).
    const packed = 261n | (6n << 32n) | (3n << 37n) | (2_160_000_000n << 60n);
    const bet = decodeDegeneretteBetWord(packed);
    assert.equal(degeneretteStakeUnit(0), 1_000n);
    assert.equal(bet.playerId, 261);
    assert.equal(bet.spinCount, 3);
    assert.equal(bet.amountPerSpin, 2_160_000_000_000n);
    assert.equal(displayEth(bet.amountPerSpin, 2), '2.16');
    assert.equal(floorDegeneretteStake(5_123_456_789n, 0), 5_123_456_000n);
    const flip = decodeDegeneretteBetWord(261n | (1n << 42n) | (250n << 60n));
    assert.equal(flip.amountPerSpin, 250n * 10n ** 18n);
  });
});
