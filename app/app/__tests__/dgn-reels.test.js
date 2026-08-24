// /app/app/__tests__/dgn-reels.test.js
// Run: cd website && node --test app/app/__tests__/dgn-reels.test.js
//
// dgn-reels.js re-derives the house reel of every spin after the first, because
// the chain only publishes spin 0's. If this port ever drifts from the contract
// the UI starts drawing reels that never rolled, so the vectors below are REAL
// EVM output, not expectations written by hand.
//
// Provenance: a forge harness compiled from
//   degenerus-audit/contracts/DegenerusTraitUtils.sol (packedTraitsDegenerette)
//   degenerus-audit/contracts/modules/DegenerusGameDegeneretteModule.sol
//     (per-spin resultSeed assembly, _rigWwxrpResult, _score)
// emitted 576 (rngWord × index × spinIdx × pick × hero) rows plus a 4000-case
// pseudo-random sweep. Six deterministic rows are pinned here, followed by a
// current-deployment regression for the lower edge of the rigging band.
//
// CSV columns: rngWord, index, spinIdx, playerPick, hero, seed, traits,
// riggedWwxrpTraits, score.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  dgnResultSeed, dgnPackedTraits, dgnScore, dgnHouseTraits, dgnDeriveSpins,
  dgnRecordBountyHeroQuadrants,
} from '../dgn-reels.js';

const VECTORS = [
  // spin 0 uses the short (37-byte) preimage; index 0 exercises the zero word.
  ['1', 0, 0, 66051, 0,
    '54563773627536592521444775552203127473189100646861316999417033431525509631980',
    3751506983, 3751506983, 0],
  // spin 3 → the 38-byte preimage with the spinIdx byte.
  ['1', 7, 3, 1061109567, 1,
    '89767951094207727465106638732841574777053465870579166324065181459775816641120',
    3551810326, 3551810326, 0],
  ['100720434724302814903610305981132438410357946783027813146856713896787785412351', 7, 0, 1061109567, 3,
    '36962743352121630359270447779448437739478612465861952230540408423993854550058',
    4119352877, 4119352877, 0],
  // max rngWord, and a rig that actually lifts a cell (traits != rigged).
  ['115792089237316195423570985008687907853269984665640564039457584007913129639935', 0, 0, 118957879, 3,
    '9254415729536171786013759717895929061947002794078871850200023801124971627342',
    3716966155, 3717162763, 2],
  // max index (uint32) — the 4 index bytes land at 0x20..0x23.
  ['115792089237316195423570985008687907853269984665640564039457584007913129639935', 4294967295, 2, 118957879, 3,
    '41620300697377120835912208807644665055056100693075817333013691223595885505481',
    3651815474, 3651815474, 0],
  ['74158540597562961298676378875079351819634584590352076869952930171588285113734', 4294967295, 3, 118957879, 3,
    '115436490784823612758593072696709701608786935507293936845360631204579206647804',
    3498470432, 3498470432, 0],
];

describe('dgn-reels: contract parity', () => {
  test('biggest-spin bounty derives one exact Hero per reel from its parent bet', () => {
    const boxBetId = 12_829_128_780_424_407_998n;
    assert.deepEqual(dgnRecordBountyHeroQuadrants({
      rngWord: 123_456_789n,
      parentBetId: 42n,
      boxBetId,
      spinCount: 3,
    }), [1, 2, 1]);
    assert.equal(dgnRecordBountyHeroQuadrants({
      rngWord: 123_456_789n,
      parentBetId: 42n,
      boxBetId: boxBetId + 1n,
      spinCount: 3,
    }), null, 'a mismatched child event cannot borrow another bet\'s Hero quadrants');
  });

  test('seed, traits, WWXRP rig and score match EVM output on every pinned vector', () => {
    for (const [word, index, spinIdx, pick, hero, seed, traits, rigged, score] of VECTORS) {
      const label = `word=${word.slice(0, 8)}… idx=${index} spin=${spinIdx} hero=${hero}`;
      const jsSeed = dgnResultSeed(BigInt(word), index, spinIdx);
      assert.equal(jsSeed, BigInt(seed), `seed — ${label}`);
      assert.equal(dgnPackedTraits(jsSeed), traits, `traits — ${label}`);
      assert.equal(dgnScore(pick, traits, hero), score, `score — ${label}`);
      // ETH (0) and FLIP (1) bets take the raw reel; only WWXRP (3) is rigged.
      assert.equal(
        dgnHouseTraits({ rngWord: BigInt(word), index, spinIdx, currency: 0, playerTraits: pick, heroQuadrant: hero }),
        traits,
        `eth reel — ${label}`,
      );
      assert.equal(
        dgnHouseTraits({ rngWord: BigInt(word), index, spinIdx, currency: 3, playerTraits: pick, heroQuadrant: hero }),
        rigged,
        `wwxrp rigged reel — ${label}`,
      );
    }
  });

  test('spin 0 and spin 1 hash different preimages (37 vs 38 bytes)', () => {
    const a = dgnResultSeed(12345n, 3, 0);
    const b = dgnResultSeed(12345n, 3, 1);
    assert.notEqual(a, b, 'the short spin-0 preimage cannot collide with spin 1');
  });

  test('near-empty WWXRP reels stay honest on the current contract', () => {
    // Live deployment: bet 437 / RNG index 793. Both emitted scores are zero.
    // The old off-chain port rigged spin 1 to 3551744046, creating a score
    // mismatch that made the UI leave the WWXRP reveal in its loading state.
    const rngWord = 94785635529052655787036115730634316830314989858265885133859745622195257968941n;
    const out = dgnDeriveSpins({
      rngWord,
      index: 793,
      heroQuadrant: 0,
      currency: 3,
      resolvedResultTraits: 3750386740,
      spins: [
        { spinIndex: 0, playerTraits: 0, matches: 0, payout: 0n },
        { spinIndex: 1, playerTraits: 0, matches: 0, payout: 0n },
      ],
    });

    assert.equal(out.verified, true, out.reason || 'verified');
    assert.deepEqual(out.rows.map((row) => row.houseTraits), [3750386740, 3551745582]);
  });
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
