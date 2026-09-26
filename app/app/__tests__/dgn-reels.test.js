// Current contract parity: WWXRP vectors emitted by _rollSpin from the
// authoritative degenerus-audit module using a Forge harness (2026-09-25).
// word=1..80, index=538, symbol=word%32, spinIndex=word%5; draw domain
// hash2(word, WWXRP_DRAW_TAG), result seed uses the packed 37/38-byte form.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dgnResultSeed, dgnPackedTraits, dgnScore, dgnHouseTraits, dgnDeriveSpins,
  dgnRecordBountyHeroQuadrants,
} from '../dgn-reels.js';
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

test('all uniform color codes are preserved, including gold', () => {
  for (let color = 0; color < 8; color++) {
    const packed = dgnPackedTraits(BigInt(color));
    assert.equal((packed >>> 3) & 7, color);
  }
});

test('WWXRP house tickets match current-contract EVM output', () => {
  const vectors = fixture('degenerette-wwxrp-vectors');
  assert.equal(vectors.length, 80);
  for (const [word, spinIdx, symbol, playerTraits, expected] of vectors) {
    assert.equal(dgnHouseTraits({rngWord: word, index: 538, spinIdx,
      currency: 3, playerTraits, heroQuadrant: symbol >> 3}), expected, `word ${word}`);
  }
});

test('live five-card ETH receipt verifies every card', () => {
  const bet = fixture('degenerette-run55-bet1');
  const result = dgnDeriveSpins({ rngWord: bet.rngWord, index: bet.betIndex,
    heroQuadrant: 0, currency: 0,
    resolvedResultTraits: bet.results.find(r => r.resultType === 'resolved').resultData.resultTraits,
    spins: bet.results.filter(r => r.resultType === 'result').map(r => r.resultData),
  });
  assert.equal(result.verified, true, result.reason);
  assert.equal(result.rows.length, 5);
  assert.ok(result.rows.every(r => r.houseTraits != null));
});

test('record bounty retains champion and verifies the live parent seed', () => {
  const bet = fixture('degenerette-run55-bet1');
  const input = { rngWord: bet.rngWord, parentBetId: bet.betId,
    player: bet.player, symbol: 0, boxBetId: '12824114803960323210' };
  assert.deepEqual(dgnRecordBountyHeroQuadrants(input), [0,0,0]);
  assert.equal(dgnRecordBountyHeroQuadrants({...input, parentBetId: '2'}), null);
  assert.equal(dgnRecordBountyHeroQuadrants({...input, player: null}), null);
});

describe('dgn-reels: dgnDeriveSpins self-check', () => {
  const WORD = 0xfeedfacecafebabe1234567890abcdefn;
  const INDEX = 11;
  const HERO = 2;
  const PICK = 0x03020100;

  function realSpins(count, currency = 0) {
    const spins = [];
    for (let i = 0; i < count; i++) {
      const house = dgnHouseTraits({
        rngWord: WORD, index: INDEX, spinIdx: i, currency, playerTraits: PICK, heroQuadrant: HERO,
      });
      spins.push({
        spinIndex: i,
        playerTraits: PICK,
        matches: dgnScore(PICK, house, HERO),
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
      heroQuadrant: HERO,
      currency: 0,
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
      heroQuadrant: HERO,
      currency: 0,
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
      heroQuadrant: HERO,
      currency: 0,
      resolvedResultTraits: 0x11111111,   // not what this word derives
      spins,
    });
    assert.equal(out.verified, false);
    assert.match(out.reason, /spin 0/);
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
      heroQuadrant: HERO,
      currency: 0,
      resolvedResultTraits: spins[0]._house,
      spins,
    });
    assert.equal(out.verified, false);
    assert.match(out.reason, /score mismatch on spin 3/);
    assert.equal(out.rows[0].houseTraits, spins[0]._house);
    assert.equal(out.rows[1].houseTraits, spins[1]._house);
    assert.equal(out.rows[2].houseTraits, null, 'only the mismatched spin fails closed');
  });

  test('a missing RNG word fails closed instead of deriving from zero', () => {
    const out = dgnDeriveSpins({
      rngWord: 0n, index: INDEX, heroQuadrant: HERO, currency: 0, spins: realSpins(2),
    });
    assert.equal(out.verified, false);
    assert.match(out.reason, /rng word/);
  });

  test('no per-spin events → nothing to show', () => {
    const out = dgnDeriveSpins({ rngWord: WORD, index: INDEX, heroQuadrant: HERO, currency: 0, spins: [] });
    assert.equal(out.verified, false);
    assert.equal(out.rows.length, 0);
  });

  test('WWXRP bets verify through the rig', () => {
    const spins = realSpins(4, 3);
    const out = dgnDeriveSpins({
      rngWord: WORD,
      index: INDEX,
      heroQuadrant: HERO,
      currency: 3,
      resolvedResultTraits: spins[0]._house,
      spins,
    });
    assert.equal(out.verified, true, out.reason || 'verified');
    assert.equal(out.rows[3].houseTraits, spins[3]._house);
  });
});
