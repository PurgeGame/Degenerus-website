// /app/app/foil-match.js — Phase 64 foil-ticket match grading (pure, headless).
//
// Mirrors DegenerusGameFoilPackModule._tryClaimFoilMatch's graded "Variant-2"
// scoring: a foil line is four full trait IDs (quadrant order A..D); the day's
// winning set is a packed uint32 (byte q = quadrant q's winning trait). Per
// quadrant, a symbol match (bits 2:0) scores +1 and a color match (bits 5:3)
// on TOP of the symbol match upgrades it to +2 — color never counts alone.
// Score T in 0..8; the contract pays T >= 4 (tiers 4..8).
//
// Trait bit layout (DegenerusTraitUtils, canonical): [QQ][CCC][SSS] —
// bits 7:6 quadrant, 5:3 color, 2:0 symbol. NOTE the swapped-decoder pitfall
// fixed in f47f106: color is the MIDDLE 3 bits, symbol the LOW 3.

export const FOIL_CLAIM_THRESHOLD = 4;

/** Decode a trait ID (0-255) into badge coordinates. */
export function decodeTrait(traitId) {
  const t = Number(traitId) & 0xff;
  return {
    quadrant: t >> 6,
    colorIdx: (t >> 3) & 7,
    symbolIdx: t & 7,
  };
}

/**
 * Put one four-trait foil line into canonical quadrant order.
 *
 * The quadrant is encoded in the trait byte itself, so API/contract adapters
 * are free to return a set in a different iteration order. Rendering the raw
 * array makes otherwise valid badges land in the wrong panel and also applies
 * match faces to the wrong art. Duplicate or missing quadrants are malformed.
 */
export function normalizeFoilLine(lineTraits) {
  if (!Array.isArray(lineTraits) || lineTraits.length !== 4) return null;
  const ordered = new Array(4);
  for (const raw of lineTraits) {
    const trait = Number(raw);
    if (!Number.isInteger(trait) || trait < 0 || trait > 255) return null;
    const quadrant = trait >> 6;
    if (ordered[quadrant] != null) return null;
    ordered[quadrant] = trait;
  }
  return ordered.every((trait) => Number.isInteger(trait)) ? ordered : null;
}

/** Unpack a winning-set uint32 into its 4 per-quadrant trait bytes. */
export function unpackWinSet(packed) {
  const p = Number(packed) >>> 0;
  return [p & 0xff, (p >> 8) & 0xff, (p >> 16) & 0xff, (p >>> 24) & 0xff];
}

/**
 * Grade one foil line against one packed winning set.
 * @param {number[]} lineTraits - 4 full trait IDs in quadrant order A..D.
 * @param {number} packedSet - uint32 winning set (mainTraitsPacked / bonusTraitsPacked).
 * @returns {{score: number, faces: number[]}} faces[q]: 0 = miss, 1 = symbol, 2 = symbol+color.
 */
export function gradeLine(lineTraits, packedSet) {
  const win = unpackWinSet(packedSet);
  const faces = [0, 0, 0, 0];
  let score = 0;
  for (let q = 0; q < 4; q++) {
    const sel = Number(lineTraits[q]) & 0xff;
    const w = win[q];
    if ((sel & 7) === (w & 7)) {
      faces[q] = ((sel >> 3) & 7) === ((w >> 3) & 7) ? 2 : 1;
      score += faces[q];
    }
  }
  return { score, faces };
}

/**
 * Grade a line against both of a day's sets and keep the better result.
 * Either set may be null/undefined (e.g. bonus set absent pre-Phase-57 data).
 * Tie goes to the main draw (drawKind 0), matching claim preference.
 * @returns {{score: number, faces: number[], drawKind: number} | null} null when no set available.
 */
export function bestGrade(lineTraits, mainSet, bonusSet) {
  const main = mainSet != null ? gradeLine(lineTraits, mainSet) : null;
  const bonus = bonusSet != null ? gradeLine(lineTraits, bonusSet) : null;
  if (!main && !bonus) return null;
  if (main && (!bonus || main.score >= bonus.score)) {
    return { ...main, drawKind: 0 };
  }
  return { ...bonus, drawKind: 1 };
}

/**
 * Return every independently claimable draw tuple for one foil line.
 *
 * The contract's replay marker includes drawKind, so a line that reaches T4+
 * against both the main and bonus sets owns two claims. `bestGrade` remains the
 * display helper for callers that need one headline result; transaction queues
 * must use this function so the lower of two real wins is never discarded.
 */
export function claimableDrawGrades(lineTraits, mainSet, bonusSet) {
  const draws = [
    { drawKind: 0, packedSet: mainSet },
    { drawKind: 1, packedSet: bonusSet },
  ];
  return draws.flatMap(({ drawKind, packedSet }) => {
    if (packedSet == null) return [];
    const grade = gradeLine(lineTraits, packedSet);
    return grade.score >= FOIL_CLAIM_THRESHOLD
      ? [{ ...grade, drawKind, packedSet: Number(packedSet) >>> 0 }]
      : [];
  });
}
