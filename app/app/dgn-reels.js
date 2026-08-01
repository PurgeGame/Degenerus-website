// /app/app/dgn-reels.js — off-chain derivation of Degenerette house reels.
//
// WHY THIS EXISTS: a Degenerette bet of N spins rolls a DIFFERENT house ticket
// every spin, but the chain only publishes the first one. DegeneretteResolved
// carries `resultTraits` for spin 0 only ("additional spin results are derived
// per spinIndex" — DegenerusGameDegeneretteModule.sol:82), and the per-spin
// DegeneretteResult event carries the player's pick + the score, never the reel
// it played against. So a UI that wants to SHOW spin 3's reel has to re-derive
// it exactly the way the contract did.
//
// Ported verbatim from degenerus-audit/contracts:
//   - modules/DegenerusGameDegeneretteModule.sol:760-800  per-spin resultSeed
//     (scratch-space keccak: rngWord[32] | index[4] | spinIdx[1] (spin>0) | salt[1])
//   - DegenerusTraitUtils.sol:203-225                     packedTraitsDegenerette
//   - modules/DegenerusGameDegeneretteModule.sol           _rigWwxrpResult (WWXRP only)
//   - modules/DegenerusGameDegeneretteModule.sol           _score (S ∈ 0..9)
//
// Verified against real EVM output: 576 (rngWord × index × spinIdx × pick ×
// hero) vectors emitted by a forge harness compiled from those exact sources
// match this port byte-for-byte (seed, traits, rigged traits, score). The live
// self-check is cheaper still: deriving spin 0 must reproduce the resultTraits
// the chain emitted, and every derived score must equal the event's `matches`
// field — dgnDeriveSpins() does both and reports a mismatch rather than
// showing a reel it cannot stand behind.
//
// Decoding (traits → symbols) lives in dgn-traits.js. Do not add a decoder here.

import { keccak256 } from 'ethers';

// DegenerusGameDegeneretteModule.sol:245 / :367
const QUICK_PLAY_SALT = 0x51;               // 'Q'
const WWXRP_RIG_SALT = 0x52494721n;         // "RIG!"
const CURRENCY_WWXRP = 3;

const MASK64 = 0xFFFFFFFFFFFFFFFFn;

function _big(v) {
  try { return BigInt(v ?? 0); } catch (_e) { return 0n; }
}

/** Big-endian 32-byte write of a uint256 into `buf` at `off`. */
function _writeWord(buf, off, word) {
  let w = word;
  for (let i = 31; i >= 0; i--) {
    buf[off + i] = Number(w & 0xFFn);
    w >>= 8n;
  }
}

/**
 * The per-spin result seed. Byte-identical preimage to the module's assembly:
 * spin 0 hashes 37 bytes (no spinIdx), later spins hash 38.
 *
 * @param {bigint|string|number} rngWord lootboxRngWordByIndex[index]
 * @param {number} index the bet's lootbox RNG index (uint32 on the wire)
 * @param {number} spinIdx 0-based spin
 * @returns {bigint}
 */
export function dgnResultSeed(rngWord, index, spinIdx) {
  const s = Number(spinIdx) & 0xFF;
  const idx = Number(index) >>> 0;
  const buf = new Uint8Array(s === 0 ? 37 : 38);
  _writeWord(buf, 0, _big(rngWord));
  buf[32] = (idx >>> 24) & 0xFF;
  buf[33] = (idx >>> 16) & 0xFF;
  buf[34] = (idx >>> 8) & 0xFF;
  buf[35] = idx & 0xFF;
  if (s === 0) {
    buf[36] = QUICK_PLAY_SALT;
  } else {
    buf[36] = s;
    buf[37] = QUICK_PLAY_SALT;
  }
  return _big(keccak256(buf));
}

/** EntropyLib.hash2 — keccak of two words in scratch space. */
function _hash2(a, b) {
  const buf = new Uint8Array(64);
  _writeWord(buf, 0, a);
  _writeWord(buf, 32, b);
  return _big(keccak256(buf));
}

/** DegenerusTraitUtils._degTrait — one quadrant's [CCC][SSS] from a 64-bit word. */
function _degTrait(rnd64) {
  const scaled = Number(((rnd64 & 0xFFFFFFFFn) * 15n) >> 32n);   // 0..14
  const color = scaled === 14 ? 7 : (scaled >> 1);               // 14 → gold
  const symbol = Number((rnd64 >> 32n) & 7n);
  return (color << 3) | symbol;
}

/**
 * DegenerusTraitUtils.packedTraitsDegenerette — a seed → the packed uint32
 * ticket, quadrant bits included (byte q = quadrant q).
 *
 * @param {bigint|string|number} seed
 * @returns {number} uint32
 */
export function dgnPackedTraits(seed) {
  const s = _big(seed);
  const a = _degTrait(s & MASK64);
  const b = _degTrait((s >> 64n) & MASK64) | 64;
  const c = _degTrait((s >> 128n) & MASK64) | 128;
  const d = _degTrait((s >> 192n) & MASK64) | 192;
  return ((a | (b << 8) | (c << 16) | (d << 24)) >>> 0);
}

/**
 * The WWXRP reel rig: with 2+ cells missing, 60% of the time one score-bearing
 * cell is lifted to a real match so the DISPLAYED reel agrees with the scored
 * result. A no-op for ETH/FLIP — which is exactly why the UI has to know about
 * it: skip it and a WWXRP row shows a losing reel next to a winning score.
 *
 * @returns {number} uint32
 */
export function dgnRigWwxrp(playerTraits, resultTraits, heroQuadrant, rigSeed) {
  const p = Number(playerTraits) >>> 0;
  const r = Number(resultTraits) >>> 0;
  const hero = Number(heroQuadrant) & 3;
  const seed = _big(rigSeed);
  let m = 0;
  let u = 0;
  for (let q = 0; q < 4; q++) {
    const pq = (p >>> (q * 8)) & 0xFF;
    const rq = (r >>> (q * 8)) & 0xFF;
    const colorMatch = ((pq >> 3) & 7) === ((rq >> 3) & 7);
    const symMatch = (pq & 7) === (rq & 7);
    if (colorMatch) m++;
    if (symMatch) m++;
    if (symMatch && !colorMatch) u++;
    if (q !== hero && !symMatch) u++;
  }
  if (m >= 7) return r;
  if (seed % 5n >= 3n) return r;
  if (u === 0) return r;
  let pick = Number((seed >> 8n) % BigInt(u));
  for (let q = 0; q < 4; q++) {
    const pq = (p >>> (q * 8)) & 0xFF;
    const rq = (r >>> (q * 8)) & 0xFF;
    const colorMatch = ((pq >> 3) & 7) === ((rq >> 3) & 7);
    const symMatch = (pq & 7) === (rq & 7);
    if (symMatch && !colorMatch) {
      if (pick === 0) {
        return (((r & ~(0x38 << (q * 8))) | (((pq >> 3) & 7) << (q * 8 + 3))) >>> 0);
      }
      pick--;
    }
    if (q !== hero && !symMatch) {
      if (pick === 0) {
        return (((r & ~(0x07 << (q * 8))) | ((pq & 7) << (q * 8))) >>> 0);
      }
      pick--;
    }
  }
  return r;
}

/**
 * Module _score — Variant-2: symbol match +1 (hero +2), that quadrant's color
 * +1 ONLY if its symbol also matched. S ∈ 0..9.
 *
 * @returns {number}
 */
export function dgnScore(playerTraits, resultTraits, heroQuadrant) {
  const p = Number(playerTraits) >>> 0;
  const r = Number(resultTraits) >>> 0;
  const hero = Number(heroQuadrant) & 3;
  let s = 0;
  for (let q = 0; q < 4; q++) {
    const pq = (p >>> (q * 8)) & 0xFF;
    const rq = (r >>> (q * 8)) & 0xFF;
    if ((pq & 7) === (rq & 7)) {
      s += hero === q ? 2 : 1;
      if (((pq >> 3) & 7) === ((rq >> 3) & 7)) s += 1;
    }
  }
  return s;
}

/**
 * One spin's house reel, rig included.
 *
 * @param {{rngWord: bigint|string|number, index: number, spinIdx: number,
 *          currency?: number, playerTraits?: number, heroQuadrant?: number}} a
 * @returns {number} uint32 packed house traits
 */
export function dgnHouseTraits({ rngWord, index, spinIdx, currency, playerTraits, heroQuadrant }) {
  const seed = dgnResultSeed(rngWord, index, spinIdx);
  const raw = dgnPackedTraits(seed);
  if (Number(currency) !== CURRENCY_WWXRP) return raw;
  return dgnRigWwxrp(playerTraits, raw, heroQuadrant, _hash2(seed, WWXRP_RIG_SALT));
}

/**
 * The board behind a resolved bet: one row per spin, each with the reel that
 * spin actually played against.
 *
 * Self-checking. Two independent tells, both from data the chain published:
 *   - spin 0's derived reel must equal `resolvedResultTraits`;
 *   - each derived score must equal that spin's emitted `matches`.
 * Verification is per spin. A stale/malformed row is left blank without
 * erasing the independently verified later reels; `verified` remains the
 * all-rows summary bit for callers that need it.
 *
 * @param {{
 *   rngWord: bigint|string|number,
 *   index: number,
 *   heroQuadrant: number,
 *   currency: number,
 *   resolvedResultTraits?: bigint|string|number,
 *   spins: Array<{spinIndex: bigint|number, playerTraits: bigint|number,
 *                 matches?: bigint|number, payout?: bigint|number}>,
 * }} args
 * @returns {{verified: boolean, reason: string|null,
 *            rows: Array<{spinIndex: number, playerTraits: number,
 *                         houseTraits: number|null, score: number,
 *                         payout: bigint}>}}
 */
export function dgnDeriveSpins({
  rngWord, index, heroQuadrant, currency, resolvedResultTraits, spins,
} = {}) {
  const list = Array.isArray(spins) ? spins : [];
  const hero = Number(heroQuadrant) & 3;
  const cur = Number(currency);
  const word = _big(rngWord);
  const rows = list
    .map((s) => ({
      spinIndex: Number(s?.spinIndex ?? 0),
      playerTraits: Number(s?.playerTraits ?? 0) >>> 0,
      matches: Number(s?.matches ?? 0),
      payout: _big(s?.payout),
    }))
    .sort((a, b) => a.spinIndex - b.spinIndex);

  const fail = (reason) => ({
    verified: false,
    reason,
    rows: rows.map((r) => ({
      spinIndex: r.spinIndex,
      playerTraits: r.playerTraits,
      houseTraits: null,
      score: r.matches,
      payout: r.payout,
    })),
  });

  if (rows.length === 0) return fail('no per-spin events');
  if (word === 0n) return fail('rng word unavailable');

  const derived = rows.map((r) => dgnHouseTraits({
    rngWord: word,
    index,
    spinIdx: r.spinIndex,
    currency: cur,
    playerTraits: r.playerTraits,
    heroQuadrant: hero,
  }));

  const failures = [];
  const valid = derived.map(() => true);

  // Tell #1 — spin 0 against the chain's own published reel.
  const zeroAt = rows.findIndex((r) => r.spinIndex === 0);
  if (resolvedResultTraits != null && zeroAt >= 0) {
    const published = Number(_big(resolvedResultTraits)) >>> 0;
    // The event's uint32 carries the same quadrant bits the packer sets.
    if (published !== derived[zeroAt]) {
      valid[zeroAt] = false;
      failures.push('spin 0 reel mismatch');
    }
  }
  // Tell #2 — every score. Keep good later rows even if one projection is bad.
  for (let i = 0; i < rows.length; i++) {
    if (dgnScore(rows[i].playerTraits, derived[i], hero) !== rows[i].matches) {
      valid[i] = false;
      failures.push(`score mismatch on spin ${rows[i].spinIndex + 1}`);
    }
  }

  return {
    verified: failures.length === 0,
    reason: failures.length > 0 ? failures.join('; ') : null,
    rows: rows.map((r, i) => ({
      spinIndex: r.spinIndex,
      playerTraits: r.playerTraits,
      houseTraits: valid[i] ? derived[i] : null,
      score: r.matches,
      payout: r.payout,
    })),
  };
}
