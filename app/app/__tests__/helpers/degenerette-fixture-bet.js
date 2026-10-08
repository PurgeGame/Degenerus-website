import { hasWalletIds, hasDegeneretteWilds } from '../../../chain/schema.js';
import * as legacy from '../../legacy/dgn-reels.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A settled bet in the DegeneretteResolved wire format, built from the shared
// wild-color vectors: spin 0 is a fixture vector (its player lanes, score byte
// and house reel are the contract's own values); later spins take their player
// lanes and score byte from the reel replicas.
export async function fixtureBetFeedItem(spinCount, { owner = '0xfe5b92e655d8b1732e47cb0a2f00ec6a50ea4200' } = {}) {
  const { dgnHouseTraits, dgnPlayerTicket, dgnScoreWilds, dgnSpinSymbol } = await import('../../dgn-reels.js');
  const { degeneretteStakeUnit } = await import('../../degenerette.js');
  const { ETH_DIVISOR } = await import('../../chain-config.js');
  const { keccak256, toBeHex, zeroPadValue } = await import('ethers');
  const word32 = (x) => zeroPadValue(toBeHex(BigInt(x)), 32).slice(2);
  const vectors = JSON.parse(readFileSync(new URL('../fixtures/degenerette-wild-vectors.json', import.meta.url)));
  const v = vectors.bet_spins.find((row) => row.spin === 0 && row.score >= 3 && row.wilds >= 1);
  assert.ok(v, 'the fixture has a paying spin-0 bet with a house wild');
  const word = BigInt(v.word);
  const unit = degeneretteStakeUnit(0);
  const amountPerSpin = BigInt(v.eth_stake_wei) / BigInt(ETH_DIVISOR);
  assert.equal((amountPerSpin / unit) * unit, amountPerSpin, 'the fixture stake is a whole unit');
  const shift = hasWalletIds() ? 128n : 0n;
  const packed = (hasWalletIds() ? 37n : BigInt(owner)) | (BigInt(v.symbol) << (160n-shift)) | (BigInt(spinCount) << (165n-shift))
    | (BigInt(v.activity) << (172n-shift)) | ((amountPerSpin / unit) << (188n-shift));
  let firstHouse = Number(BigInt(v.house));
  let spins = '0x';
  for (let i = 0; i < spinCount; i += 1) {
    let player = Number(BigInt(v.player));
    let tail = v.tail_byte;
    if (i > 0) {
      const seed = BigInt(keccak256(`0x${[word, v.index, v.symbol, i].map(word32).join('')}`));
      player = dgnPlayerTicket(seed, dgnSpinSymbol(seed, v.symbol));
      const { score, wilds } = dgnScoreWilds(player, dgnHouseTraits({ rngWord: word, index: v.index, spinIdx: i }));
      tail = score | (wilds << 4);
    }
    if (!hasDegeneretteWilds()) {
      const house = legacy.dgnHouseTraits({rngWord:word, index:v.index, spinIdx:i, currency:0});
      player = house;
      const score = legacy.dgnScore(player,house,v.symbol >> 3);
      tail = score | (legacy.dgnGoldMatches(player,house) << 4);
      if (!i) firstHouse = house;
    }
    spins += player.toString(16).padStart(8, '0') + tail.toString(16).padStart(2, '0');
  }
  return {
    vector: {...v, house: String(firstHouse)},
    amountPerSpin,
    item: {
      player: owner, betIndex: v.index, betId: '1', packedData: String(packed),
      rngWord: String(word), rngReady: true,
      results: [{
        resultType: 'resolved',
        resultData: {
          player: owner, index: String(v.index), betId: '1', totalPayout: '0',
          resultTraits: String(firstHouse), spins,
        },
      }],
    },
  };
}
