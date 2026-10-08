import { useSchema, CURRENT_SCHEMA_HASH } from '../../chain/schema.js';
useSchema(CURRENT_SCHEMA_HASH);
// Reel replica behavior. Exact reel/score/rig/payout parity with the contract
// is pinned by degenerette-wild-vectors.test.js against the shared fixture.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toBeHex, zeroPadValue } from 'ethers';
import {
  dgnResultSeed, dgnScoreWilds, dgnHouseTraits, dgnDeriveSpins, dgnPlayerTicket,
  dgnHouseLanes, dgnOrdinaryLanes, dgnRigWwxrp, dgnRecordBountyHeroQuadrants,
} from '../dgn-reels.js';
import { dgnHeroQuadrant } from '../dgn-traits.js';

const word32 = (x) => zeroPadValue(toBeHex(BigInt(x)), 32).slice(2);
const hash4 = (a, b, c, d) => BigInt(keccak256(`0x${[a, b, c, d].map(word32).join('')}`));

test('every ordinary color code is preserved, including gold; no lane carries a wild or tag bit', () => {
  for (let color = 0; color < 8; color++) {
    const packed = dgnOrdinaryLanes(BigInt(color));
    assert.equal((packed >>> 3) & 7, color);
    assert.equal(packed & 0xC0, 0);
  }
});

test('a house lane is wild exactly when bits 64q+3..6 are zero, keeping its symbol', () => {
  const rand = (3n << 32n) | (5n << 96n) | (0xFn << 67n); // lane 0 sym 3 wild, lane 1 sym 5 color/bits set
  const house = dgnHouseLanes(rand);
  assert.equal(house & 0xFF, 0x40 | 3);
  assert.equal((house >>> 8) & 0x40, 0, 'lane 1 has non-zero bits 3..6');
  assert.equal(((house >>> 8) & 7), 5);
});

test('the player ticket is ordinary with exactly one wild hero lane', () => {
  for (let symbol = 0; symbol < 24; symbol++) {
    const ticket = dgnPlayerTicket(BigInt(symbol) * 977n + 1n, symbol);
    assert.equal(dgnHeroQuadrant(ticket), symbol >> 3);
    assert.equal((ticket >>> ((symbol >> 3) * 8)) & 0xFF, 0x40 | (symbol & 7));
    assert.equal([0, 8, 16, 24].filter((s) => (ticket >>> s) & 0x40).length, 1);
  }
});

test('scoring: one point per symbol, wild colors, wild vs wild 2, house wilds counted', () => {
  const lane = (sym, col, wild = false) => (wild ? 0x40 | sym : (col << 3) | sym);
  const pack = (a, b, c, d) => (a | (b << 8) | (c << 16) | (d << 24)) >>> 0;
  const player = pack(lane(1, 0, true), lane(2, 3), lane(3, 4), lane(4, 5));
  // Hero symbol hit against an ordinary color: 1 + 1; lane 1 full match 2; lane 2 color only 1; lane 3 miss.
  assert.deepEqual(dgnScoreWilds(player, pack(lane(1, 6), lane(2, 3), lane(0, 4), lane(0, 0))), { score: 5, wilds: 0 });
  // Hero lane wild vs wild: 1 + 2; a second house wild scores its color for the ordinary player lane.
  assert.deepEqual(dgnScoreWilds(player, pack(lane(1, 0, true), lane(7, 0, true), lane(7, 0), lane(7, 0))),
    { score: 3 + 1, wilds: 2 });
  // A perfect card: all symbols, three colors and the house wild on the hero lane.
  assert.deepEqual(dgnScoreWilds(player, pack(lane(1, 0, true), lane(2, 3), lane(3, 4), lane(4, 5))),
    { score: 9, wilds: 1 });
});

test('the WWXRP rig is a no-op unless rigSeed % 20 == 0', () => {
  const player = dgnPlayerTicket(7n, 1);
  const house = dgnHouseLanes(0x123456789abcdef0123456789abcdef0n);
  assert.equal(dgnRigWwxrp(player, house, 0, 7n), house);
});

test('record bounty retains champion and verifies the parent seed', () => {
  const player = '0xfe5b92e655d8b1732e47cb0a2f00ec6a50ea4200';
  const rngWord = 0x1234567890abcdefn;
  const parentBetId = 1n;
  const seed = hash4(rngWord, 37n, parentBetId, 0x5265636f7264n);
  const boxBetId = (1n << 63n) | (3n << 60n) | (seed & ((1n << 60n) - 1n));
  const input = { rngWord, parentBetId, player, playerId:37, symbol: 9, boxBetId };
  assert.deepEqual(dgnRecordBountyHeroQuadrants(input), [1, 1, 1]);
  assert.equal(dgnRecordBountyHeroQuadrants({ ...input, parentBetId: 2n }), null);
  assert.equal(dgnRecordBountyHeroQuadrants({ ...input, playerId: null }), null);
});

describe('dgn-reels: dgnDeriveSpins self-check', () => {
  const WORD = 0xfeedfacecafebabe1234567890abcdefn;
  const INDEX = 11;
  const PICK = dgnPlayerTicket(4242n, 17);

  function realSpins(count) {
    const spins = [];
    for (let i = 0; i < count; i++) {
      const house = dgnHouseTraits({
        rngWord: WORD, index: INDEX, spinIdx: i,
      });
      const { score, wilds } = dgnScoreWilds(PICK, house);
      spins.push({
        spinIndex: i,
        playerTraits: PICK,
        matches: score,
        wilds,
        payout: 0n,
        _house: house,
      });
    }
    return spins;
  }

  test('a truthful receipt verifies and yields one reel per spin', () => {
    const spins = realSpins(5);
    const out = dgnDeriveSpins({
      rngWord: WORD,
      index: INDEX,
      resolvedResultTraits: spins[0]._house,
      spins,
    });
    assert.equal(out.verified, true, out.reason || 'verified');
    assert.equal(out.rows.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.equal(out.rows[i].houseTraits, spins[i]._house, `spin ${i} reel`);
      assert.equal(out.rows[i].spinIndex, i);
    }
    // Every spin plays the SAME pick against a DIFFERENT reel — the whole
    // reason this module exists.
    const reels = new Set(out.rows.map((r) => r.houseTraits));
    assert.ok(reels.size > 1, 'reels differ across spins');
  });

  test('rows arrive in spin order even when the events do not', () => {
    const spins = realSpins(3);
    const out = dgnDeriveSpins({
      rngWord: WORD,
      index: INDEX,
      resolvedResultTraits: spins[0]._house,
      spins: [spins[2], spins[0], spins[1]],
    });
    assert.equal(out.verified, true, out.reason || 'verified');
    assert.deepEqual(out.rows.map((r) => r.spinIndex), [0, 1, 2]);
  });

  test('a bad spin-0 projection does not erase independently verified later reels', () => {
    const spins = realSpins(3);
    const out = dgnDeriveSpins({
      rngWord: WORD,
      index: INDEX,
      resolvedResultTraits: 0x11111111,   // not what this word derives
      spins,
    });
    assert.equal(out.verified, false);
    assert.match(out.reason, /card 0/);
    assert.equal(out.rows[0].houseTraits, null, 'unverified spin zero stays blank for caller fallback');
    assert.equal(out.rows[1].houseTraits, spins[1]._house, 'spin two remains playable');
    assert.equal(out.rows[2].houseTraits, spins[2]._house, 'spin three remains playable');
  });

  test('a score that disagrees with the derived reel fails closed', () => {
    const spins = realSpins(3);
    spins[2].matches = spins[2].matches === 9 ? 8 : 9;
    const out = dgnDeriveSpins({
      rngWord: WORD,
      index: INDEX,
      resolvedResultTraits: spins[0]._house,
      spins,
    });
    assert.equal(out.verified, false);
    assert.match(out.reason, /score mismatch on card 3/);
    assert.equal(out.rows[0].houseTraits, spins[0]._house);
    assert.equal(out.rows[1].houseTraits, spins[1]._house);
    assert.equal(out.rows[2].houseTraits, null, 'only the mismatched spin fails closed');
  });

  test('a missing RNG word fails closed instead of deriving from zero', () => {
    const out = dgnDeriveSpins({
      rngWord: 0n, index: INDEX, spins: realSpins(2),
    });
    assert.equal(out.verified, false);
    assert.match(out.reason, /rng word/);
  });

  test('no per-spin events → nothing to show', () => {
    const out = dgnDeriveSpins({ rngWord: WORD, index: INDEX, spins: [] });
    assert.equal(out.verified, false);
    assert.equal(out.rows.length, 0);
  });

  test('a wild count that disagrees with the derived reel fails closed', () => {
    const spins = realSpins(3);
    spins[1].wilds = (spins[1].wilds + 1) & 7;
    const out = dgnDeriveSpins({
      rngWord: WORD,
      index: INDEX,
      resolvedResultTraits: spins[0]._house,
      spins,
    });
    assert.equal(out.verified, false);
    assert.match(out.reason, /score mismatch on card 2/);
    assert.equal(out.rows[1].houseTraits, null);
    assert.equal(out.rows[2].houseTraits, spins[2]._house);
  });
});
