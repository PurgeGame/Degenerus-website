// /app/app/dgn-traits.js — shared Degenerette trait codecs.
//
// Single source of truth for the badge-path / ticket-unpack / match-compare
// trio. Previously module-private in app-degenerette-panel.js; extracted so
// the reveal overlay (box-spin reels) renders tickets with the SAME decode.
// Duplicated decoders are how the color/symbol bit-swap bug (f47f106) shipped
// — do not copy these tables into another file.
//
// Byte layout per quadrant (LSB-first, byte q = quadrant q):
//   [QQ: bits 6-7 quadrant | CCC: bits 3-5 color | SSS: bits 0-2 symbol]
// Matches contracts/modules/DegenerusGameDegeneretteModule.sol packing and the
// indexer's box-spins handler (database/src/handlers/box-spins.ts).

export const DGN_QUADRANTS = ['crypto', 'zodiac', 'cards', 'dice'];

export const DGN_SYMBOLS = Object.freeze({
  crypto: ['xrp', 'tron', 'sui', 'monero', 'solana', 'chainlink', 'ethereum', 'bitcoin'],
  zodiac: ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'libra', 'sagittarius', 'aquarius'],
  cards:  ['club', 'diamond', 'heart', 'spade', 'horseshoe', 'cashsack', 'king', 'ace'],
  dice:   ['1', '2', '3', '4', '5', '6', '7', '8'],
});

// The 'cards' quadrant remaps symbol → SVG file index (legacy filename order).
// Load-bearing — do not simplify.
export const DGN_CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7];

export const DGN_COLORS = ['pink', 'purple', 'green', 'red', 'blue', 'orange', 'silver', 'gold'];

export const DGN_COLOR_HEX = Object.freeze({
  // Exact outer-ring fills from /badges-circular/*.svg. These are deliberately
  // not theme approximations: the picker dot should be the badge it selects.
  pink: '#f409cd', purple: '#7c2bff', green: '#30d100', red: '#ed0e11',
  blue: '#1317f7', orange: '#f7931a', silver: '#5e5e5e', gold: '#ab8d3f',
});

/** Inventory card click → load its four traits into the Degenerette builder. */
export const DGN_TICKET_COPY_EVENT = 'degenerette:copy-ticket';

/** Badge SVG path for (quadrant, symbol, color) — /badges-circular/ set. */
export function dgnBadgePath(q, sym, col) {
  const cat = DGN_QUADRANTS[q];
  const fileIdx = cat === 'cards' ? DGN_CARD_IDX[sym] : sym;
  return `/badges-circular/${cat}_${String(fileIdx).padStart(2, '0')}_${DGN_SYMBOLS[cat][sym]}_${DGN_COLORS[col]}.svg`;
}

/**
 * uint32 ticket (customTicket / resultTraits / playerTraits) → 4 × {sym, col};
 * byte q = quadrant q's trait (LSB-first).
 */
export function dgnUnpackTicket(packed) {
  let p = 0n;
  try { p = BigInt(packed ?? 0); } catch (_e) { p = 0n; }
  const out = [];
  for (let q = 0; q < 4; q++) {
    const b = Number((p >> BigInt(q * 8)) & 0xFFn);
    out.push({ sym: b & 7, col: (b >> 3) & 7 });
  }
  return out;
}

/**
 * A stored trait_id (0-255, the indexer's `traits_generated.traitId`) → its
 * quadrant/symbol/color. Same bit layout as one byte of a packed ticket:
 * quadrant in bits 6-7, color in 3-5, symbol in 0-2.
 *
 * @param {number} tid
 * @returns {{q: number, sym: number, col: number}}
 */
export function dgnTraitIdToQSC(tid) {
  const t = Number(tid) & 0xFF;
  return { q: (t >> 6) & 3, sym: t & 7, col: (t >> 3) & 7 };
}

/**
 * Four trait_ids (one card's entries) → the `traits` array #buildTicket wants,
 * indexed BY QUADRANT. Entries whose trait has not rolled yet come through as
 * null, which renders an empty quadrant.
 *
 * @param {Array<number|null|undefined>} traitIds
 * @returns {Array<{sym: number, col: number} | null>}
 */
export function dgnTraitIdsToQuadrants(traitIds) {
  const out = [null, null, null, null];
  for (const tid of (Array.isArray(traitIds) ? traitIds : [])) {
    if (tid == null) continue;
    const { q, sym, col } = dgnTraitIdToQSC(tid);
    out[q] = { sym, col };
  }
  return out;
}

/**
 * Reconstruct whole tickets from a chronological `/tickets/by-trait` card
 * payload.  The API's four-entry buckets can straddle two independent
 * generation calls when the first call ends on a fractional ticket.  Quadrant
 * bits remain authoritative, so a Q0 restart safely identifies that boundary.
 *
 * Each returned record includes a stable key. Ordinary aligned API cards keep
 * their numeric cardIndex for backward-compatible reveal tracking; repaired
 * tickets spanning buckets use their constituent entry IDs.
 */
export function dgnReconstructTicketRecords(cards) {
  const orderedCards = Array.isArray(cards) ? [...cards] : [];
  orderedCards.sort((a, b) => Number(a?.cardIndex ?? 0) - Number(b?.cardIndex ?? 0));

  const complete = [];
  let current = [];
  for (const card of orderedCards) {
    const entries = Array.isArray(card?.entries) ? [...card.entries] : [];
    entries.sort((a, b) => Number(a?.entryId ?? 0) - Number(b?.entryId ?? 0));
    for (const entry of entries) {
      const tid = Number(entry?.traitId);
      if (!Number.isInteger(tid) || tid < 0 || tid > 255) {
        current = [];
        continue;
      }
      const { q } = dgnTraitIdToQSC(tid);

      // A new Q0 before Q3 is a fresh generation call. Its predecessor was a
      // legitimate fractional ticket, not the top half of this one.
      if (q === 0 && current.length > 0) current = [];
      if (q !== current.length) {
        current = [];
        if (q !== 0) continue;
      }
      current.push({
        traitId: tid,
        entryId: entry?.entryId,
        rawCardIndex: card?.cardIndex,
      });
      if (current.length !== 4) continue;

      const rawIndexes = new Set(current.map((row) => String(row.rawCardIndex)));
      const rawCardIndex = rawIndexes.size === 1 ? current[0].rawCardIndex : null;
      const entryIds = current.map((row) => row.entryId);
      const hasEntryIds = entryIds.every((id) => id != null && Number.isFinite(Number(id)));
      complete.push({
        traitIds: current.map((row) => row.traitId),
        key: rawCardIndex != null
          ? String(rawCardIndex)
          : hasEntryIds
            ? `entries:${entryIds.map(Number).join('.')}`
            : `traits:${current.map((row) => row.traitId).join('.')}:${complete.length}`,
      });
      current = [];
    }
  }
  return complete;
}

/** Canonical Q0..Q3 trait arrays for every reconstructed whole ticket. */
export function dgnReconstructTicketTraits(cards) {
  return dgnReconstructTicketRecords(cards).map((record) => record.traitIds);
}

/** Per-quadrant compare on sym + col → 'full' | 'sym' | 'col' | 'miss'. */
export function dgnComputeMatches(player, house) {
  const states = [];
  let fullCount = 0;
  for (let q = 0; q < 4; q++) {
    const pt = player[q];
    const h = house[q];
    if (!pt || !h) { states.push('miss'); continue; }
    const symEq = pt.sym === h.sym;
    const colEq = pt.col === h.col;
    if (symEq && colEq) { states.push('full'); fullCount++; }
    else if (symEq) states.push('sym');
    else if (colEq) states.push('col');
    else states.push('miss');
  }
  return { states, fullCount };
}
