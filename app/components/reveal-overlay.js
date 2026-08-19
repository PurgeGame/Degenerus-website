// /app/components/reveal-overlay.js — full-screen prize reveal engine.
//
// The mobile-game reveal moment for everything that pays out: lootbox opens
// (prize cards per leg, box-spins expand into Degenerette reels), ticket-pack
// creation (sealed pack tears open), and jackpot winnings (auto-playing
// celebration). One singleton element; other components enqueue sequences via
// the exported queueReveal() (module-level buffer, safe before mount).
//
// Stage machine per sequence:
//   intro (vessel drops in, TAP TO OPEN)
//   → charging (shake + glow build, riser SFX)
//   → burst (flash, vessel out, protocol energy seal for big sequences)
//   → cards (one prize card at a time: flip-in, count-up, tick SFX,
//            then shrink to the tray; 'spins' cards expand into the
//            Degenerette reel sub-stage first)
//   → summary (ordinary rewards) OR persistent full result (Degenerette), with
//              an outcome-specific exit + optional SHARE YOUR WIN
// Queue: multiple sequences chain under one backdrop (multi-box opens).
//
// Juice sources: app/app/jackpot-sfx.js (WebAudio cues — first production
// consumer), protocol-celebration.js (reduced-motion gated), CSS
// keyframes in app.css (.rvl-* palette).
//
// Interaction rules:
//   - Tap anywhere = advance/skip the current beat (mobile-game standard).
//   - ✕ aborts the whole queue (always available).
//   - prefers-reduced-motion: skip choreography, but keep the full-size settled
//     Degenerette result; ordinary rewards render their summary directly.
//
// Sequence shapes accepted by queueReveal():
//   {kind:'lootbox', legs: [...]}                    — legs from lootbox-legs.js
//   {kind:'pack', count, level, pending, day?,       — ticket creation
//    foilPack?, tickets?}                              (foil gets its own wrapper)
//   {kind:'jackpot', day, prizes:[{type,amount,level?}], activity?}
//                                                    — post-scratch day summary
//   {kind:'degenerette', currency, heroIdx, amountPerSpin, totalWager, totalPayout,
//    spins:[{spinIndex,playerTraits,houseTraits,score,payout}]}
//                                                    — a resolved bet, one row
//                                                      per spin (house reels
//                                                      from dgn-reels.js)
//   {kind:'record-bounty', spin}                     — a type-3 BoxSpin played
//                                                      directly without a case
//   {kind:'bingo', level, symbol, tier, flipReward, dgnrsPaid, counts}
//                                                    — keeper-settled color Bingo
//   {kind:'foil-match', day, level, lineTraits, winningTraits, matchFaces,
//    score, rewardFaces, legs}                       — why a foil tuple paid,
//                                                      then its reward spin
//
// Class palette: .rvl-* (verified non-colliding).

import { displayEth, displayToken, displayTokenSnapped } from '../app/scaling.js';
import { ETH_DIVISOR } from '../app/chain-config.js';
import {
  DGN_COLORS, DGN_QUADRANTS,
  applyDgnTicketAccent, applyDgnTraitColor,
  dgnBadgePath, dgnComputeMatches, dgnScoringMatchStates,
  dgnDisplaySymbol,
  dgnTraitIdToQSC, dgnTraitIdsToQuadrants, dgnUnpackTicket,
} from '../app/dgn-traits.js';
import {
  warmup as sfxWarmup, sfxSpinStart, sfxTick, sfxMatchLock, sfxRollDone, sfxFanfare,
  sfxGoldTicket, sfxNoWin, sfxLoserHorn,
} from '../app/jackpot-sfx.js';
import { lock as lockScroll, unlock as unlockScroll } from '../app/scroll-lock.js';
import { canShareWin, shareWin } from '../app/share-win.js';
import {
  dismissPendingActionItems,
  getPendingActions,
} from '../app/pending-actions.js';
import {
  boxSpinHeroQuadrant,
  lootboxRewardPresentation,
  lootboxRewardVisual,
} from '../app/lootbox-legs.js';
import { FOIL_CLAIM_THRESHOLD } from '../app/foil-match.js';
import {
  readDegeneretteSpeed,
  writeDegeneretteSpeed,
} from '../app/degenerette-preferences.js';
import { degenerettePayoutTable } from '../app/degenerette.js';
import { applyTicketLevelTone } from '../app/ticket-level-tone.js';
import {
  lootboxTicketPriceForLevel,
  lootboxValuePresentation,
} from '../app/lootbox-value-tone.js';
import { celebrateProtocol } from '../protocol-celebration.js';
import { appendCoinFaces } from '../app/coin-faces.js';
import { flipPileLevel, flipPileArt, flipPileVariant } from '../app/flip-piles.js';

// ---------------------------------------------------------------------------
// Module-level queue — components can enqueue before the element mounts.
// ---------------------------------------------------------------------------

let _instance = null;
let _buffer = [];
let _lootboxPresentationSeq = 0;
let _queuedLootboxPresentationIds = new Set();
let _queuedBingoPresentationIds = new Set();
let _queuedPariPresentationIds = new Set();

// Ticket inventory listens for these lifecycle events so newly indexed cards
// remain behind their wrapper until the corresponding presentation is actually
// consumed. Pack-watch owns the durable pending/revealed bookkeeping.
export const PACK_REVEAL_COMPLETE_EVENT = 'degenerus:pack-reveal-complete';
export const PACK_REVEAL_ABORT_EVENT = 'degenerus:pack-reveal-abort';
// Fired only after the complete fullscreen queue has drained and its backdrop
// is hidden. Consumers that reveal background state (for example seating a
// foil pack in the Daily Drawing cabinet) must wait for this rather than a
// per-sequence completion event, because more fullscreen rewards may follow.
export const REVEAL_OVERLAY_IDLE_EVENT = 'degenerus:reveal-overlay-idle';
export const LOOTBOX_REVEAL_COMPLETE_EVENT = 'degenerus:lootbox-reveal-complete';
export const LOOTBOX_REVEAL_ABORT_EVENT = 'degenerus:lootbox-reveal-abort';
export const LOOTBOX_REVEAL_QUEUED_EVENT = 'degenerus:lootbox-reveal-queued';

function _withLootboxPresentationId(seq) {
  if (seq?.kind !== 'lootbox') return seq;
  if (seq.presentationId) return seq;
  const release = seq?.lootboxRelease;
  const address = String(release?.address || '').toLowerCase();
  const key = String(release?.key || '');
  if (address && key) {
    return { ...seq, presentationId: `lootbox-reveal:${address}:${key}` };
  }
  return { ...seq, presentationId: `lootbox-reveal:${++_lootboxPresentationSeq}` };
}

function _withBingoPresentationId(seq) {
  if (seq?.kind !== 'bingo' || seq.presentationId) return seq;
  const player = String(seq.player || seq.address || '').toLowerCase();
  const level = Number(seq.level);
  const symbol = Number(seq.symbol ?? seq.sym);
  const quadrant = Number.isInteger(Number(seq.quadrant))
    ? Number(seq.quadrant)
    : (Number.isInteger(symbol) ? symbol >> 3 : Number.NaN);
  if (!player || !Number.isInteger(level) || level < 0
    || !Number.isInteger(quadrant) || quadrant < 0) return seq;
  // One player can claim a given level/quadrant Bingo only once. Use that
  // protocol identity rather than a receipt id: the local transaction receipt
  // and the indexer can discover the same claim through different paths.
  return { ...seq, presentationId: `bingo-reveal:${player}:${level}:${quadrant}` };
}

function _withPariPresentationId(seq) {
  if (seq?.kind !== 'pari' || seq.presentationId) return seq;
  const market = String(seq.market || '').toLowerCase() === 'volume' ? 'volume' : 'growth';
  const round = Number(seq.round);
  if (!Number.isInteger(round) || round < 0) return seq;
  const player = String(seq.player || seq.address || 'current').toLowerCase();
  return { ...seq, presentationId: `pari-reveal:${player}:${market}:${round}` };
}

function _emitLootboxQueued(seq) {
  const id = seq?.kind === 'lootbox' ? String(seq.presentationId || '') : '';
  if (!id || _queuedLootboxPresentationIds.has(id)) return;
  _queuedLootboxPresentationIds.add(id);
  if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function'
    || typeof CustomEvent !== 'function') return;
  const release = seq?.lootboxRelease;
  try {
    document.dispatchEvent(new CustomEvent(LOOTBOX_REVEAL_QUEUED_EVENT, {
      detail: {
        presentationId: id,
        address: release?.address == null ? null : String(release.address).toLowerCase(),
        key: release?.key == null ? null : String(release.key),
        lootboxIndex: release?.lootboxIndex == null ? null : Number(release.lootboxIndex),
        transactionHash: release?.transactionHash == null
          ? null
          : String(release.transactionHash).toLowerCase(),
      },
    }));
  } catch (_e) { /* spoiler bookkeeping must never break a reveal */ }
}

/**
 * Enqueue a reveal sequence. Safe to call before <reveal-overlay> mounts —
 * sequences buffer and play on connect. Returns true if accepted.
 */
export function queueReveal(seq) {
  if (!seq || typeof seq !== 'object') return false;
  const queued = _withPariPresentationId(
    _withBingoPresentationId(_withLootboxPresentationId(seq)),
  );
  const presentationId = String(queued?.presentationId || '');
  // Live receipt parsing and the indexed pending tray can discover the same
  // settled box independently. A stable release-derived id keeps that one
  // logical box from entering the overlay twice while buffered/active and
  // remains a session tombstone after completion. Abort explicitly releases
  // the id so a presentation the player never finished can be retried.
  if (queued?.kind === 'lootbox'
    && presentationId && _queuedLootboxPresentationIds.has(presentationId)) return false;
  if (queued?.kind === 'bingo'
    && presentationId && _queuedBingoPresentationIds.has(presentationId)) return false;
  if (queued?.kind === 'pari'
    && presentationId && _queuedPariPresentationIds.has(presentationId)) return false;
  // Bingo ids are session tombstones, not merely active-queue locks. A claimed
  // Bingo is immutable, so aborting or completing its visual must not let a
  // delayed indexer refresh present the same prize again.
  if (queued?.kind === 'bingo' && presentationId) {
    _queuedBingoPresentationIds.add(presentationId);
  }
  // A settled side-bet round is immutable too. Claim/read races can discover
  // it twice, but the player should only see one result presentation.
  if (queued?.kind === 'pari' && presentationId) {
    _queuedPariPresentationIds.add(presentationId);
  }
  _emitLootboxQueued(queued);
  if (_instance) {
    _instance.enqueue(queued);
  } else {
    _buffer.push(queued);
  }
  return true;
}

/** Test-only — drop the singleton + buffer. */
export function __resetForTest() {
  _instance = null;
  _buffer = [];
  _lootboxPresentationSeq = 0;
  _queuedLootboxPresentationIds = new Set();
  _queuedBingoPresentationIds = new Set();
  _queuedPariPresentationIds = new Set();
}

/**
 * Test-only — the sequences queued since the last call, cleared on read.
 * Lets a caller assert WHAT it queued without mounting the element.
 */
export function __takeQueuedForTest() {
  const out = _buffer;
  _buffer = [];
  return out;
}

// ---------------------------------------------------------------------------
// Normalization — every sequence becomes {kind, title, big, autoStart, cards[]}.
// Card: {type, rarity, icon, glyph, label, value, sub, countText, spin}.
//   value/countText are display strings (countText animates 0 → value).
// Exported pure for unit tests.
// ---------------------------------------------------------------------------

const ICONS = Object.freeze({
  flip: '/whitepaper/flame-logo-split.svg',
  flipFace: '/shared/coinflip-face-red.svg',
  ethFace: '/shared/coinflip-face-eth.svg',
  eth: '/shared/coinflip-face-eth.svg',
  dgnrs: '/specials/special_eth.svg',
  dgnrsBadge: '/badges-circular/crypto_06_ethereum_purple.svg',
  wwxrp: '/shared/coinflip-face-red.svg',
  flame: '/specials/special_none.svg',
});

const LOOTBOX_CASE_ART = '/app/assets/lootbox/degenerus-lootbox-case-v3.webp';

/**
 * A pile-scale FLIP win lands as a physical chip pile (the same wager ladder
 * the coinflip felt uses); smaller wins keep the flame logo.
 */
function _flipPrizeArt(amountWei) {
  const pile = flipPileLevel(amountWei);
  return pile > 0
    ? { icon: flipPileArt(pile, flipPileVariant(amountWei)), pile }
    : { icon: ICONS.flip, pile: null };
}

/** Warm an asset that will be swapped in mid-animation. Best-effort only. */
function _preloadImage(src) {
  try {
    const scope = typeof window !== 'undefined' ? window : globalThis;
    if (typeof scope?.Image !== 'function') return;
    const image = new scope.Image();
    image.decoding = 'sync';
    image.src = src;
  } catch (_e) { /* a cold swap still paints, just a frame later */ }
}

const SPIN_LABELS = Object.freeze({
  wwxrp: 'WWXRP SPIN', flip: 'FLIP SPINS', eth: 'ETH SPIN', record: 'RECORD BOUNTY',
});

// Degenerette bet currencies (DegenerusGameDegeneretteModule: 0=ETH, 1=FLIP,
// 3=WWXRP; 2 is unsupported on-chain).
const DGN_UNITS = Object.freeze({ 0: 'ETH', 1: 'FLIP', 3: 'WWXRP' });
const DGN_CARD_TYPES = Object.freeze({ 0: 'eth', 1: 'flip', 3: 'wwxrp' });
const BOX_SPIN_CURRENCIES = Object.freeze({ eth: 0, flip: 1, record: 1, wwxrp: 3 });
// FlipRoundLib.FLIP_ROUND_THRESHOLD: above this a surviving FLIP mint is
// collapsed onto a whole 100-FLIP multiple, so halving it is an estimate.
const FLIP_ROUND_THRESHOLD = 1_000n * (10n ** 18n);
const TOKEN_WEI = 10n ** 18n;
const BOX_ESTIMATE_VARIANCE_BPS = 12_448n;
const BOX_ESTIMATE_MAIN_BPS = 9_000n;
const BOX_ESTIMATE_STAKE_BPS = 7_060n;
const BOX_ESTIMATE_SPLIT_THRESHOLD = (TOKEN_WEI / 2n) / BigInt(ETH_DIVISOR);

// Keep batched boxes moving, but spend the saved time where the player can
// actually read what came out. Manual receipts remain tap-to-dismiss.
const LOOTBOX_AUTO_START_MS = 480;
const LOOTBOX_MANUAL_CHARGE_MS = 820;
const LOOTBOX_AUTO_CHARGE_MS = 560;
const LOOTBOX_MANUAL_BURST_MS = 360;
const LOOTBOX_AUTO_BURST_MS = 260;
const LOOTBOX_AUTO_RESULT_MS = 1_750;
const LOOTBOX_AUTO_RESULT_REDUCED_MS = 1_200;
// The denomination lock uses the Daily Flip's complete 3.3s airborne track
// plus 0.7s landing at 1x. The player's reveal-speed preference scales both
// authored phases together, so the face switch and the wait remain in sync.
const BOX_CURRENCY_FLIP_MS = 4_000;
const BOX_CURRENCY_RESULT_MS = 850;
// Match the ordinary daily coinflip: one 3.3s toss plus its 0.7s truthful
// landing. Survival never inherits reel/reveal speed and never gets a Reverse
// Flip correction, so the double-or-nothing result is readable every time.
const SURVIVAL_FLIP_MS = 4_000;
const SURVIVAL_RESULT_MS = 950;

const TRAIT_LABEL_OVERRIDES = Object.freeze({ cashsack: 'CASH SACK' });

/** The player-facing name for every gold symbol carried by one whole ticket. */
export function goldTicketLabel(traitIds) {
  const quadrants = dgnTraitIdsToQuadrants(traitIds);
  const names = quadrants.flatMap((trait, q) => {
    if (!trait || trait.col !== 7) return [];
    const raw = dgnDisplaySymbol(q, trait.sym, trait.col);
    if (!raw) return [];
    if (raw === 'xrp') return ['GOLD WWXRP'];
    const name = TRAIT_LABEL_OVERRIDES[raw] || String(raw).replace(/[_-]+/g, ' ').toUpperCase();
    return [`GOLD ${name}`];
  });
  return names.length > 0
    ? names.join(' · ')
    : 'GOLD TICKET';
}

function _groupAmountText(value) {
  const text = String(value ?? '0');
  const match = /^([+-]?)(\d+)(\.\d+)?$/.exec(text);
  if (!match) return text;
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[3] || ''}`;
}

function _ethText(wei) {
  try {
    const trimmed = String(displayEth(BigInt(wei ?? 0)))
      .replace(/(\.\d*?[1-9])0+$/, '$1')
      .replace(/\.0+$/, '');
    return _groupAmountText(trimmed);
  } catch (_e) { return '0'; }
}

function _winningTraitIds(values) {
  const unique = new Set();
  for (const raw of (Array.isArray(values) ? values : [])) {
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 0 && value <= 255) unique.add(value);
  }
  return [...unique];
}
function _tokenText(wei) {
  try {
    const trimmed = String(displayTokenSnapped(BigInt(wei ?? 0)))
      .replace(/(\.\d*?[1-9])0+$/, '$1')
      .replace(/\.0+$/, '');
    return _groupAmountText(trimmed);
  } catch (_e) { return '0'; }
}

function _safeBigInt(value) {
  try { return BigInt(value ?? 0); } catch (_e) { return 0n; }
}

function _ticketQuantityText(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return '0';
  return count.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function ticketGridSizeClass(count) {
  const ticketCount = Math.max(0, Math.floor(Number(count) || 0));
  if (ticketCount <= 1) return 'rvl-ticket-grid-stage--size-1';
  if (ticketCount <= 4) return 'rvl-ticket-grid-stage--size-4';
  return 'rvl-ticket-grid-stage--size-9';
}

/**
 * Loose entries keep their real quadrant and share a ticket-sized silhouette
 * only when they can occupy different positions. Duplicate quadrants start a
 * new silhouette; four arbitrary singletons must never be mistaken for one
 * complete ticket.
 */
function _clusterTicketEntries(pieces) {
  const clusters = [];
  for (const piece of Array.isArray(pieces) ? pieces : []) {
    const traitId = _entryTraitId(piece?.traitId);
    if (traitId == null) continue;
    const quadrant = dgnTraitIdToQSC(traitId).q;
    let cluster = clusters.find((candidate) => (
      candidate.length < 3
      && !candidate.some((entry) => entry.quadrant === quadrant)
    ));
    if (!cluster) {
      cluster = [];
      clusters.push(cluster);
    }
    cluster.push({ piece, quadrant });
  }
  return clusters;
}

/**
 * A positive payout is not necessarily a win: paid Degenerette bets can
 * return less than their stake. Reserve celebration cues for break-even or
 * better. Box spins are granted rewards rather than wagers, so any payout
 * from one remains celebratory. Missing wager metadata preserves the older
 * positive-payout behaviour instead of silently downgrading a valid result.
 */
export function shouldCelebrateDegenerette({ total, totalWager, boxSpin = false } = {}) {
  const payout = _safeBigInt(total);
  if (payout <= 0n) return false;
  if (boxSpin) return true;
  const wager = _safeBigInt(totalWager);
  return wager <= 0n || payout >= wager;
}

/** Reserve the negative verdict for a return strictly below 40% of stake. */
export function isUnluckyDegenerette({ total, totalWager, boxSpin = false } = {}) {
  if (boxSpin) return false;
  const payout = _safeBigInt(total);
  const wager = _safeBigInt(totalWager);
  if (wager <= 0n) return payout <= 0n;
  return payout * 5n < wager * 2n;
}

/**
 * Terminal copy describes the screen the player is leaving, not a fictional
 * transfer. Rewards shown here are already indexed/credited; only explicitly
 * named Pending actions such as CLAIM or OPEN perform another operation.
 */
export function revealTerminalActionLabel(sequence = null, board = null) {
  const seq = sequence && typeof sequence === 'object' ? sequence : {};
  const boardResult = board && typeof board === 'object' ? board : null;
  const lost = Boolean(seq.unlucky || seq.consolationOnly)
    || (boardResult != null && _safeBigInt(boardResult.total) <= 0n);
  if (lost) return 'UNLUCKY';
  // WWXRP is a consolation result, not a win to claim. The landed board is
  // authoritative here: mixed Luckboxes and legacy callers do not always set
  // the sequence-level `wwxrpOnly` flag, but neither may show TAKE THE WIN.
  if (boardResult?.unit === 'WWXRP' || Number(boardResult?.currency) === 3) {
    return 'BACK TO GAME';
  }
  if (seq.kind === 'pack') return 'GOOD LUCK';
  if (boardResult) {
    return shouldCelebrateDegenerette(boardResult) ? 'TAKE THE WIN' : 'BACK TO GAME';
  }
  if (seq.daySummary) return 'BACK TO GAME';
  if (seq.kind === 'pari') {
    const paid = Array.isArray(seq.cards) && seq.cards.some((card) => card?.type === 'flip');
    return paid ? 'TAKE THE WIN' : 'BACK TO GAME';
  }
  return 'GOOD LUCK';
}

/**
 * Project a partial Degenerette ETH total into its two final receipt lanes.
 *
 * `lootboxEth` is emitted only as a final aggregate, so attributing each
 * settled spin with a guessed contract tier makes the two numbers jump when
 * the receipt eventually wins. Keep every animation frame on the final
 * on-chain ratio instead. Integer dust stays in the immediately claimable ETH
 * lane and the final frame is exact.
 */
export function projectDegeneretteEthSplit({ gross, total, lootboxEth } = {}) {
  const shown = _safeBigInt(gross);
  const finalTotal = _safeBigInt(total);
  const emittedBox = _safeBigInt(lootboxEth);
  if (shown <= 0n) return { actual: 0n, lootbox: 0n };
  if (finalTotal <= 0n || emittedBox <= 0n) return { actual: shown, lootbox: 0n };

  const finalBox = emittedBox > finalTotal ? finalTotal : emittedBox;
  const progress = shown > finalTotal ? finalTotal : shown;
  const box = progress === finalTotal
    ? finalBox
    : (finalBox * progress) / finalTotal;
  return { actual: shown - box, lootbox: box };
}

function _packedTraits(traits) {
  if (!Array.isArray(traits) || traits.length < 4) return null;
  let packed = 0n;
  for (let q = 0; q < 4; q++) {
    const sym = Number(traits[q]?.sym);
    const col = Number(traits[q]?.col);
    if (!Number.isInteger(sym) || !Number.isInteger(col)) return null;
    const byte = (q << 6) | ((col & 7) << 3) | (sym & 7);
    packed |= BigInt(byte) << BigInt(q * 8);
  }
  return Number(packed & 0xFFFFFFFFn) >>> 0;
}

function _reelTicket(reel, side) {
  const packedKey = side === 'player' ? 'playerTicket' : 'resultTicket';
  if (reel?.[packedKey] != null) {
    try { return Number(BigInt(reel[packedKey]) & 0xFFFFFFFFn) >>> 0; }
    catch (_e) { /* fall through to decoded traits */ }
  }
  return _packedTraits(reel?.[side === 'player' ? 'playerTraits' : 'resultTraits']);
}

/** Box-spin payout tables are zero at S0/S1 for every supported currency. */
export function boxSpinScorePays(score) {
  const value = Number(score);
  return Number.isFinite(value) && value >= 2;
}

function _boxSpinScoreForHero(row, heroQuadrant) {
  if (row?.houseTraits == null) return null;
  const player = dgnUnpackTicket(row.playerTraits);
  const house = dgnUnpackTicket(row.houseTraits);
  let score = 0;
  for (let q = 0; q < 4; q += 1) {
    if (player[q]?.sym !== house[q]?.sym) continue;
    score += q === heroQuadrant ? 2 : 1;
    if (player[q]?.col === house[q]?.col) score += 1;
  }
  return score;
}

// The BoxSpin event publishes the final group payout rather than three row
// payouts. FLIP rows all share one stake and one ROI, so their relative payout
// weights are still recoverable exactly from the emitted ticket + score table.
// When the packed score leaves more than one possible hero, average only if the
// candidate table weights differ and mark the eventual amount as approximate.
function _boxSpinFlipWeight(row) {
  if (!boxSpinScorePays(row?.score)) return { weight: 0n, ambiguous: false };
  const candidates = [];
  for (let hero = 0; hero < 4; hero += 1) {
    if (_boxSpinScoreForHero(row, hero) !== Number(row.score)) continue;
    try {
      const table = degenerettePayoutTable({
        currency: 1,
        customTicket: row.playerTraits,
        heroQuadrant: hero,
        activityScore: 0,
      });
      candidates.push(BigInt(table.rows[Number(row.score)]?.basePayoutCentiX ?? 0));
    } catch (_e) { /* malformed reel falls through to an equal hit weight */ }
  }
  const positive = candidates.filter((weight) => weight > 0n);
  if (positive.length === 0) return { weight: 1n, ambiguous: true };
  const unique = new Set(positive.map(String));
  if (unique.size === 1) return { weight: positive[0], ambiguous: false };
  return {
    weight: positive.reduce((sum, weight) => sum + weight, 0n) / BigInt(positive.length),
    ambiguous: true,
  };
}

function _allocateBoxSpinPreview(rows, amount, approximate = false) {
  const total = _safeBigInt(amount);
  if (total <= 0n) return false;
  const weighted = rows.map(_boxSpinFlipWeight);
  const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0n);
  if (weightTotal <= 0n) return false;
  let allocated = 0n;
  let lastPaid = -1;
  weighted.forEach((item, index) => { if (item.weight > 0n) lastPaid = index; });
  const paidRows = weighted.filter((item) => item.weight > 0n).length;
  rows.forEach((row, index) => {
    const item = weighted[index];
    if (item.weight <= 0n) {
      row.previewPayout = 0n;
      row.previewApproximate = false;
      return;
    }
    const value = index === lastPaid
      ? total - allocated
      : (total * item.weight) / weightTotal;
    row.previewPayout = value;
    // A lone hit owns the whole survival stake. With multiple hits, the
    // score-table split is still exact unless the packed reel permits more
    // than one hero interpretation with different payout weights.
    row.previewApproximate = approximate || (paidRows > 1 && item.ambiguous);
    row.previewWeightAmbiguous = item.ambiguous;
    allocated += value;
  });
  return true;
}

// A losing survival draw publishes a final payout of zero, so the BoxSpin
// event alone cannot say how much the three record reels produced first. The
// parent Degenerette bet does retain both inputs needed by the contract's
// payout formula: the whole-FLIP bounty stake and its snapshotted activity
// score. Re-evaluate every hero interpretation compatible with the emitted
// score; differing candidates are averaged and explicitly presented as an
// estimate rather than hiding the stake altogether.
function _recordSpinPayoutAtRisk(spin, rows) {
  const totalStake = _safeBigInt(spin?.recordStake);
  const suppliedActivityScore = Number(spin?.activityScore);
  const activityKnown = spin?.activityScore != null
    && Number.isInteger(suppliedActivityScore)
    && suppliedActivityScore >= 0
    && suppliedActivityScore <= 0xFFFF;
  const activityScore = activityKnown ? suppliedActivityScore : 0;
  if (totalStake <= 0n) return null;

  // The protocol's record chain is authored as exactly three FLIP spins. Its
  // integer remainder is deliberately unstaked, matching totalStake / 3 here.
  const perSpin = totalStake / 3n;
  if (perSpin <= 0n) return null;
  let amount = 0n;
  let approximate = !activityKnown;
  for (const row of rows) {
    if (!boxSpinScorePays(row?.score)) continue;
    const candidates = [];
    for (let hero = 0; hero < 4; hero += 1) {
      if (_boxSpinScoreForHero(row, hero) !== Number(row.score)) continue;
      try {
        const payout = degenerettePayoutTable({
          currency: 1,
          customTicket: row.playerTraits,
          heroQuadrant: hero,
          activityScore,
        }).rows[Number(row.score)];
        const value = (perSpin * BigInt(payout?.multiplierNumerator ?? 0))
          / BigInt(payout?.multiplierDenominator ?? 1);
        if (value > 0n) candidates.push(value);
      } catch (_e) { /* malformed candidate is excluded below */ }
    }
    const unique = [...new Set(candidates.map(String))].map(BigInt);
    if (unique.length === 0) return null;
    if (unique.length === 1) {
      amount += unique[0];
    } else {
      amount += unique.reduce((sum, value) => sum + value, 0n) / BigInt(unique.length);
      approximate = true;
    }
  }
  return amount > 0n ? { amount, approximate } : null;
}

/**
 * Result-independent fallback for a human Luckbox whose historical storage
 * context is unavailable. The opened box value and level price still support
 * a neutral-EV estimate: average the contract's twenty FLIP-size rolls, then
 * apply the real 70.6% three-reel stake and the visible score-table weights.
 * This deliberately cannot announce whether the later survival coin won.
 */
function _humanBoxSpinPayoutEstimate(spin, rows) {
  const amountWei = _safeBigInt(spin?.estimateBoxAmountWei);
  const ticketPriceWei = _safeBigInt(spin?.estimateTicketPriceWei);
  if (amountWei <= 0n || ticketPriceWei <= 0n) return null;
  let rollAmount = (amountWei * BOX_ESTIMATE_MAIN_BPS) / 10_000n;
  if (rollAmount > BOX_ESTIMATE_SPLIT_THRESHOLD) rollAmount /= 2n;
  const largeFlip = ((rollAmount * BOX_ESTIMATE_VARIANCE_BPS) / 10_000n)
    * (1_000n * TOKEN_WEI) / ticketPriceWei;
  const perSpin = ((largeFlip * BOX_ESTIMATE_STAKE_BPS) / 10_000n) / 3n;
  if (perSpin <= 0n) return null;
  let amount = 0n;
  for (const row of rows) {
    const { weight } = _boxSpinFlipWeight(row);
    if (weight > 0n) amount += (perSpin * weight) / 100n;
  }
  return amount > 0n ? { amount, approximate: true } : null;
}

/**
 * A receipt-decoded BoxSpin → the same verified eight-lock board used by the
 * standalone Degenerette reveal. BoxSpin only publishes one group payout
 * (three FLIP reels share it), so rows deliberately carry no invented
 * per-spin payout; scores land per reel and money lands once at the end.
 */
export function buildBoxSpinBoard(spin) {
  const rawSpinType = String(spin?.spinType || '').toLowerCase();
  const spinType = rawSpinType === 'unknown_3' ? 'record' : rawSpinType;
  const flipLike = spinType === 'flip' || spinType === 'record';
  const currency = BOX_SPIN_CURRENCIES[spinType];
  if (currency == null) return null;
  const reels = (Array.isArray(spin?.reels) ? spin.reels : []).slice(0, 3);
  if (reels.length === 0) return null;
  const rows = reels.map((reel, i) => {
    const score = Number.isFinite(Number(reel?.score)) ? Number(reel.score) : 0;
    return {
      spinIndex: Number.isFinite(Number(reel?.spinIndex)) ? Number(reel.spinIndex) : i,
      playerTraits: _reelTicket(reel, 'player') ?? 0,
      houseTraits: _reelTicket(reel, 'result'),
      score,
      won: boxSpinScorePays(score),
      payout: null,
      previewPayout: 0n,
      previewApproximate: false,
    };
  });
  const grossPayout = _safeBigInt(spin?.payout);
  const total = spinType === 'eth' ? _safeBigInt(spin?.ethShare) : grossPayout;
  const decodedHero = spin?.heroQuadrant == null
    ? boxSpinHeroQuadrant(spin?.betId)
    : Number(spin.heroQuadrant);
  const heroIdx = Number.isInteger(decodedHero) ? (decodedHero & 3) : null;
  // FLIP's score table pays from S2 upward. The packed survival bit is false
  // both when all three reels miss and when a real preliminary payout loses
  // its double-or-nothing draw, so preserve that distinction for the reveal.
  const survivalStake = flipLike && rows.some((row) => row.won);
  const explicitAtRisk = _safeBigInt(
    spin?.preSurvivalPayout ?? spin?.survivalPayout ?? spin?.payoutAtRisk,
  );
  const reconstructedAtRisk = spinType === 'record'
    ? _recordSpinPayoutAtRisk(spin, rows)
    : null;
  const estimatedAtRisk = flipLike
    ? _humanBoxSpinPayoutEstimate(spin, rows)
    : null;
  // Last-resort inference, and the reason a bust used to show no amount at
  // all: BoxSpin omits the pre-survival sum, so halving the final payout is
  // the only stake source that needs no reconstruction — and it exists solely
  // on the surviving branch. It is also not exact. The contract doubles the
  // preliminary sum and then collapses it onto a whole 100-FLIP granule above
  // 1,000 FLIP (DegenerusGameDegeneretteModule.sol:1954-1965), so half of the
  // emitted payout recovers the stake to within 50 FLIP there.
  const inferredAtRisk = survivalStake && total > 0n ? total / 2n : 0n;
  const payoutAtRisk = explicitAtRisk > 0n
    ? explicitAtRisk
    : reconstructedAtRisk?.amount ?? estimatedAtRisk?.amount ?? inferredAtRisk;
  const payoutAtRiskApproximate = explicitAtRisk > 0n
    ? false
    : reconstructedAtRisk != null
      ? reconstructedAtRisk.approximate
      : estimatedAtRisk != null
        ? true
        : inferredAtRisk > 0n && total > FLIP_ROUND_THRESHOLD;
  if (flipLike) _allocateBoxSpinPreview(rows, payoutAtRisk, payoutAtRiskApproximate);
  else if (rows[0]) rows[0].previewPayout = total;
  return {
    rows,
    currency,
    unit: DGN_UNITS[currency],
    total,
    spinSum: null,
    // A positive final FLIP payout is itself authoritative evidence that the
    // gate survived, which also keeps older feeds without the packed bit sane.
    survived: survivalStake ? (total > 0n || spin?.survived === true) : null,
    // A survival stage exists only when at least one reel produced a payout to
    // risk. An all-miss FLIP lane has no gate and should settle immediately.
    survivalStage: survivalStake,
    survivalStake,
    payoutAtRisk,
    payoutAtRiskApproximate,
    // Derive the "WIN x" figure from the stake, never from the settled total.
    // Sourcing it from `total` published a number on survivors and nothing on
    // busts, which announced the coin's result before it was thrown.
    survivalWinPayout: _safeBigInt(spin?.survivalWinPayout) || (
      payoutAtRisk > 0n ? payoutAtRisk * 2n : 0n
    ),
    heroIdx,
    boxSpin: true,
    // A record bounty is never a mystery denomination: the contract routes it
    // directly through the FLIP chain. Ordinary Luckbox spins still reveal
    // their currency only after reel one.
    currencyKnown: spinType === 'record',
    grossPayout,
    // Keep the internal unit (and its telltale reel count) out of the pre-spin
    // UI; both become visible only after reel one lands.
    headline: spinType === 'record' ? 'BIGGEST SPIN BOUNTY' : 'LUCKBOX SPIN',
  };
}

/** Highest-paying reel is the useful post-autospin default. Score breaks ties
 * (and is the primary signal for BoxSpin rows, which have no per-row payout). */
export function pickBiggestSpinResult(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let best = null;
  for (const row of list) {
    if (!row) continue;
    const payout = _safeBigInt(row.payout);
    const score = Number.isFinite(Number(row.score)) ? Number(row.score) : 0;
    if (!best || payout > best.payout || (payout === best.payout && score > best.score)) {
      best = { row, payout, score };
    }
  }
  return best?.row ?? null;
}

// Reveal cards are always whole tickets: exactly one valid trait per quadrant.
// pack-watch enforces this at the API edge; this second gate keeps every other
// queueReveal caller from ever drawing a convincing three-symbol "ticket".
function _wholeTicketTraitIds(ids) {
  if (!Array.isArray(ids) || ids.length !== 4) return null;
  const byQuadrant = new Array(4).fill(null);
  for (const raw of ids) {
    const tid = Number(raw);
    if (!Number.isInteger(tid) || tid < 0 || tid > 255) return null;
    const q = (tid >> 6) & 3;
    if (byQuadrant[q] != null) return null;
    byQuadrant[q] = tid;
  }
  return byQuadrant.every((tid) => tid != null) ? byQuadrant : null;
}

function _entryTraitId(raw) {
  const tid = Number(raw?.traitId ?? raw);
  return Number.isInteger(tid) && tid >= 0 && tid <= 255 ? tid : null;
}

function _entryHasGold(traitId) {
  return traitId != null && ((Number(traitId) >> 3) & 7) === 7;
}

function _goldEntryLabel(traitId) {
  const { q, sym, col } = dgnTraitIdToQSC(traitId);
  const raw = dgnDisplaySymbol(q, sym, col);
  const name = TRAIT_LABEL_OVERRIDES[raw] || String(raw || 'ENTRY').replace(/[_-]+/g, ' ').toUpperCase();
  return `GOLD ${name} ENTRY`;
}

function _ticketHasGold(traitIds) {
  return Array.isArray(traitIds)
    && traitIds.some((tid) => ((Number(tid) >> 3) & 7) === 7);
}

/** One leg from lootbox-legs.js → zero or more prize cards. */
function _cardsFromLeg(leg) {
  const cards = [];
  if (!leg) return cards;
  switch (leg.legType) {
    case 'opened': {
      const wholeTickets = Number(leg.wholeTickets ?? 0);
      if (wholeTickets > 0) {
        cards.push({
          type: 'tickets', rarity: 'common', icon: null, glyph: null,
          // The illustrated pack already carries the level and ticket count.
          // Lootbox pulls should not repeat that copy around the artwork.
          packOnly: true,
          level: Number.isFinite(Number(leg.futureLevel)) ? Number(leg.futureLevel) : null,
          label: `LEVEL ${leg.futureLevel} TICKETS`,
          value: String(wholeTickets),
          sub: 'Traits reveal with the level draw',
          countText: String(wholeTickets), spin: null,
        });
      } else if (Number(leg.futureTickets ?? 0) > 0) {
        // The event preserves the pre-Bernoulli ticket quantity. A fractional
        // roll that did not round up is still the real box outcome; show that
        // zero-ticket pack instead of replacing it with settlement status.
        cards.push({
          type: 'tickets', rarity: 'common', icon: null, glyph: null,
          packOnly: true,
          level: Number.isFinite(Number(leg.futureLevel)) ? Number(leg.futureLevel) : null,
          label: `LEVEL ${leg.futureLevel} TICKET ROLL`,
          value: '0',
          sub: 'The fractional ticket roll did not round up',
          countText: '0', spin: null,
        });
      }
      if ((leg.flip ?? 0n) > 0n) {
        const art = _flipPrizeArt(leg.flip);
        cards.push({
          type: 'flip', rarity: 'common', icon: art.icon, pile: art.pile, glyph: null,
          label: 'FLIP', value: _tokenText(leg.flip),
          countText: _tokenText(leg.flip), spin: null,
        });
      }
      break;
    }
    case 'dgnrs':
      cards.push({
        type: 'dgnrs', rarity: 'rare', icon: ICONS.dgnrs, glyph: null,
        label: 'DGNRS', value: _tokenText(leg.amount),
        sub: 'Soulbound protocol token',
        countText: _tokenText(leg.amount), spin: null,
      });
      break;
    case 'wwxrp':
      cards.push({
        type: 'wwxrp', rarity: 'rare', icon: ICONS.wwxrp, glyph: null,
        label: 'WWXRP', value: _tokenText(leg.amount),
        sub: 'Coinflip currency credited to your wallet',
        countText: _tokenText(leg.amount), spin: null,
      });
      break;
    case 'eth':
      cards.push({
        type: 'eth', rarity: 'rare', icon: ICONS.eth, glyph: null,
        label: leg.claimable ? 'CLAIMABLE ETH' : 'ETH', value: _ethText(leg.amount),
        sub: leg.claimable ? 'Credited to your claimable balance' : '',
        countText: _ethText(leg.amount), spin: null,
      });
      break;
    case 'flip': {
      const art = _flipPrizeArt(leg.amount);
      cards.push({
        type: 'flip', rarity: 'rare', icon: art.icon, pile: art.pile, glyph: null,
        label: 'FLIP', value: _tokenText(leg.amount),
        sub: 'Redemption coinflip payout',
        countText: _tokenText(leg.amount), spin: null,
      });
      break;
    }
    case 'whalepass':
      cards.push({
        type: 'whalepass', rarity: 'legendary', icon: null, glyph: '🐳',
        label: 'WHALE PASS JACKPOT',
        value: `${leg.entriesPerLevel ?? ''}`,
        sub: 'Entries every level — claim to start it',
        countText: null, spin: null,
      });
      break;
    case 'reward':
      {
        const rewardType = Number(leg.rewardType);
        const isBoon = [2, 4, 5, 6, 8, 9, 10, 11, 13].includes(rewardType);
        const isShield = rewardType === 12;
        const presentation = lootboxRewardPresentation(rewardType, leg.amount, {
          boonBps: leg.boonBps,
          boonType: leg.boonType,
        });
        const visual = lootboxRewardVisual(rewardType, leg.amount, {
          boonBps: leg.boonBps,
          boonType: leg.boonType,
        });
        cards.push({
          type: isBoon ? 'boon' : (isShield ? 'quest-shield' : 'reward'),
          rarity: isShield ? 'rare' : (isBoon ? 'rare' : 'common'),
          icon: (isBoon || isShield) ? visual.icon : null,
          glyph: isShield && !visual.icon ? '🛡︎' : (isBoon ? null : '?'),
          label: presentation.label,
          value: presentation.value,
          sub: presentation.detail,
          boonProduct: (isBoon || isShield) ? visual.product : null,
          boonStrength: (isBoon || isShield) ? visual.strength : null,
          boonTier: (isBoon || isShield) ? visual.tier : null,
          boonPips: (isBoon || isShield) ? visual.pips : null,
          boonDirection: (isBoon || isShield) ? visual.direction : null,
          countText: null, spin: null,
        });
      }
      break;
    case 'spin': {
      const revealedLabel = SPIN_LABELS[leg.spinType] || 'DEGENERETTE SPIN';
      const reels = Array.isArray(leg.reels) ? leg.reels : [];
      const spinCount = reels.length || Number(leg.spinCount) || 1;
      // The first reel now always resolves the mystery-currency flip. Payout
      // determines the outcome copy, never whether ETH/FLIP/WWXRP is disclosed.
      const revealsCurrency = Boolean(SPIN_LABELS[leg.spinType]);
      cards.push({
        type: 'spins',
        rarity: 'rare',
        revealedRarity: revealsCurrency
          ? (leg.spinType === 'eth' ? 'epic' : 'rare')
          : null,
        icon: ICONS.flame, glyph: null,
        label: 'BOX SPIN',
        revealedLabel: revealsCurrency ? revealedLabel : null,
        // Three reels identifies the FLIP lane. Keep both the currency and its
        // telltale reel count sealed until reel one has actually landed.
        value: '?',
        revealedValue: revealsCurrency ? `×${spinCount}` : null,
        sub: 'Land the first reel to reveal its currency',
        countText: null,
        spin: {
          betId: leg.betId ?? null,
          heroQuadrant: leg.heroQuadrant == null
            ? boxSpinHeroQuadrant(leg.betId)
            : Number(leg.heroQuadrant),
          spinType: leg.spinType,
          survived: leg.survived,
          payout: leg.payout ?? 0n,
          ethShare: leg.ethShare ?? 0n,
          // Newer result sources may carry the exact FLIP stake before its
          // final double-or-nothing. Keep it intact so even a survival bust
          // can name the amount earned by each winning reel.
          preSurvivalPayout: leg.preSurvivalPayout
            ?? leg.survivalPayout
            ?? leg.payoutAtRisk
            ?? null,
          survivalWinPayout: leg.survivalWinPayout ?? null,
          estimateBoxAmountWei: leg.estimateBoxAmountWei ?? null,
          estimateTicketPriceWei: leg.estimateTicketPriceWei ?? null,
          boxOrigin: Boolean(leg.boxOrigin),
          reels,
        },
      });
      break;
    }
    default:
      break;
  }
  return cards;
}

function _settledBoxSpinSummaryCard(card, resultLabel) {
  const board = buildBoxSpinBoard(card?.spin);
  const rawType = String(card?.spin?.spinType || '').toLowerCase();
  const currency = board?.currency ?? BOX_SPIN_CURRENCIES[rawType];
  const unit = board?.unit ?? DGN_UNITS[currency] ?? 'FLIP';
  const credited = board?.total ?? (rawType === 'eth'
    ? _safeBigInt(card?.spin?.ethShare)
    : _safeBigInt(card?.spin?.payout));
  const won = credited > 0n;
  const rows = Array.isArray(board?.rows) ? board.rows : [];
  const hits = rows.filter((row) => row?.won).length;
  const resultDetail = rows.length > 0
    ? board?.survivalStage && board?.survived === false
      ? `${hits} of ${rows.length} hit · survival lost`
      : `${hits} of ${rows.length} paid`
    : 'Settled result';
  const amount = currency === 0 ? _ethText(credited) : _tokenText(credited);
  return {
    ...card,
    type: 'spins',
    rarity: won ? (currency === 0 ? 'epic' : 'rare') : 'common',
    revealedRarity: null,
    icon: currency === 0 ? ICONS.ethFace : currency === 3 ? ICONS.wwxrp : ICONS.flip,
    label: `${unit} BOX SPIN`,
    revealedLabel: null,
    value: `${amount} ${unit}`,
    revealedValue: null,
    sub: [resultDetail, resultLabel].filter(Boolean).join(' · '),
    outcome: won ? 'win' : 'loss',
    summaryDetail: true,
    settledBoxSpin: true,
    countText: null,
    // A Day Summary is a receipt for already-consumed outcomes. Keeping the
    // payload here made #playSequence launch the full reel a second time.
    spin: null,
  };
}

/** Normalize any accepted sequence shape. Returns null if nothing to show. */
export function normalizeSequence(seq) {
  if (!seq || typeof seq !== 'object') return null;
  const kind = seq.kind;
  if (kind === 'lootbox') {
    const legs = Array.isArray(seq.legs) ? seq.legs : [];
    let cards = legs.flatMap(_cardsFromLeg);
    const openedLegs = legs.filter((leg) => leg?.legType === 'opened');
    // Legacy feed rows may omit the scaled fractional-ticket fields. An
    // index-bearing LootBoxOpened still tells us the concrete empty main-prize
    // result; settlement timing is not box content and is never shown as one.
    if (cards.length === 0 && openedLegs.length > 0) {
      cards = [{
        type: 'nowin', rarity: 'common', icon: ICONS.flame, glyph: null,
        label: 'LUCKBOX RESULT', value: '0 TICKETS · 0 FLIP',
        sub: 'No main-prize payout landed',
        countText: null, spin: null,
      }];
    }
    if (cards.length === 0) return null;
    const big = cards.some((c) => (
      (c.revealedRarity || c.rarity) === 'epic'
      || (c.revealedRarity || c.rarity) === 'legendary'
    ));
    const isEmptyResult = (card) => card?.type === 'nowin'
      || (card?.type === 'tickets' && card?.value === '0');
    const isWwxrpResult = (card) => card?.type === 'wwxrp'
      || (card?.type === 'spins' && card?.spin?.spinType === 'wwxrp');
    // WWXRP is the Luckbox consolation lane. If it is the only credited
    // result (a zero-ticket roll may accompany it), the reveal is a loss—not
    // a TAKE THE WIN outcome. A real prize beside it keeps the normal result.
    const wwxrpOnly = cards.some(isWwxrpResult)
      && cards.every((card) => isWwxrpResult(card) || isEmptyResult(card));
    const unlucky = cards.every((card) => isWwxrpResult(card) || isEmptyResult(card));
    const opened = openedLegs.find((leg) => leg?.lootboxIndex != null) ?? openedLegs[0];
    const amountWei = seq.amountWei ?? opened?.amount ?? null;
    const routedPriceWei = seq.ticketPriceWei
      ?? (opened?.source === 'presale'
        ? null
        : lootboxTicketPriceForLevel(opened?.futureLevel));
    const boxValue = routedPriceWei == null
      ? lootboxValuePresentation(amountWei)
      : lootboxValuePresentation(amountWei, routedPriceWei);
    // Exact event-block enrichment remains authoritative. When it is absent,
    // give FLIP boards the result-independent inputs for a clearly marked
    // estimate so a blank meter cannot spoil the survival coin.
    cards = cards.map((card) => card?.spin?.spinType === 'flip'
      && _safeBigInt(card.spin.preSurvivalPayout) <= 0n
      ? {
          ...card,
          spin: {
            ...card.spin,
            estimateBoxAmountWei: card.spin.estimateBoxAmountWei ?? amountWei,
            estimateTicketPriceWei: card.spin.estimateTicketPriceWei ?? routedPriceWei,
          },
        }
      : card);
    const rawIndex = seq.lootboxIndex ?? opened?.lootboxIndex;
    const boxIndex = rawIndex == null || String(rawIndex) === '0' ? null : String(rawIndex);
    const boxSpinCount = cards.reduce(
      (sum, card) => sum + (card.spin?.reels?.length || 0),
      0,
    );
    const rawRelease = seq.lootboxRelease;
    const lootboxRelease = rawRelease && typeof rawRelease === 'object'
      ? {
          address: String(rawRelease.address || '').toLowerCase(),
          key: String(rawRelease.key || ''),
          lootboxIndex: rawRelease.lootboxIndex == null
            ? null
            : Number(rawRelease.lootboxIndex),
          transactionHash: rawRelease.transactionHash == null
            ? null
            : String(rawRelease.transactionHash).toLowerCase(),
        }
      : null;
    const validLootboxRelease = lootboxRelease
      && lootboxRelease.address
      && lootboxRelease.key
      ? lootboxRelease
      : null;
    return {
      kind,
      presentationId: seq.presentationId == null ? null : String(seq.presentationId),
      title: String(seq.title || 'LUCKBOX').replace(/\bLOOTBOX(?:ES)?\b/gi, 'LUCKBOX'),
      // Ordinary box openings need no heading—the case/rewards identify the
      // flow. Preserve a heading only for callers with real custom context,
      // such as "FOIL MATCH T4".
      hideTitle: !seq.title,
      big,
      unlucky,
      wwxrpOnly,
      autoStart: false,
      noVessel: Boolean(seq.noVessel),
      boxIndex,
      boxSpinCount,
      amountWei: boxValue.amountWei,
      ticketPriceWei: boxValue.ticketPriceWei,
      lootboxValueTone: boxValue.tone,
      lootboxTicketUnitsLabel: boxValue.unitsLabel,
      lootboxRelease: validLootboxRelease,
      cards,
    };
  }
  if (kind === 'record-bounty') {
    const recordType = String(seq?.spin?.spinType || '').toLowerCase();
    if (recordType !== 'record' && recordType !== 'unknown_3') return null;
    const spinBoard = buildBoxSpinBoard(seq.spin);
    if (!spinBoard) return null;
    const won = spinBoard.total > 0n;
    const hits = spinBoard.rows.filter((row) => row.won).length;
    const art = won ? _flipPrizeArt(spinBoard.total) : null;
    return {
      kind,
      title: 'BIGGEST SPIN BOUNTY',
      boardTitle: 'BIGGEST SPIN BOUNTY',
      big: won,
      unlucky: !won,
      autoStart: false,
      noVessel: true,
      spinBoard,
      cards: [{
        type: won ? 'flip' : 'nowin',
        rarity: won ? 'epic' : 'common',
        icon: won ? art.icon : ICONS.flame,
        pile: won ? art.pile : null,
        glyph: null,
        label: 'BIGGEST SPIN BOUNTY',
        value: `${_tokenText(spinBoard.total)} FLIP`,
        sub: spinBoard.survived === false
          ? `${hits} of ${spinBoard.rows.length} hit · survival flip lost`
          : `${hits} of ${spinBoard.rows.length} paid`,
        countText: null,
        spin: null,
      }],
    };
  }
  if (kind === 'pack') {
    const count = Number(seq.count ?? 0);
    if (!(count > 0)) return null;
    const level = Number(seq.level);
    const normalizedLevel = Number.isFinite(level) ? level : null;
    const wholeTickets = (Array.isArray(seq.tickets) ? seq.tickets : [])
      .map((ticket) => ({
        traitIds: _wholeTicketTraitIds(ticket?.traitIds),
        foil: Boolean(ticket?.foil),
      }))
      .filter((ticket) => ticket.traitIds != null);
    const looseEntries = (Array.isArray(seq.entries) ? seq.entries : [])
      .map((entry) => ({ traitId: _entryTraitId(entry) }))
      .filter((entry) => entry.traitId != null);
    // Gold is the finale for either physical form. Modern Array#sort is stable,
    // so the original order survives within the plain and gold groups.
    const revealPieces = [
      ...wholeTickets.map((ticket) => ({ ...ticket, entry: false })),
      ...looseEntries.map((entry) => ({ ...entry, entry: true, foil: false })),
    ].sort((a, b) => Number(a.entry ? _entryHasGold(a.traitId) : _ticketHasGold(a.traitIds))
      - Number(b.entry ? _entryHasGold(b.traitId) : _ticketHasGold(b.traitIds)));
    const foilPack = Boolean(seq.foilPack)
      || (wholeTickets.length > 0 && wholeTickets.every((ticket) => ticket.foil));
    const packCount = Math.max(1, Math.floor(Number(seq.packCount ?? 1)) || 1);
    const packIndex = Math.min(
      packCount,
      Math.max(1, Math.floor(Number(seq.packIndex ?? 1)) || 1),
    );
    const batchId = seq.batchId == null ? null : String(seq.batchId);
    const rawRelease = seq.packRelease;
    const packRelease = rawRelease && typeof rawRelease === 'object'
      ? {
          address: String(rawRelease.address || '').toLowerCase(),
          level: Number(rawRelease.level),
          cardIndexes: [...new Set((Array.isArray(rawRelease.cardIndexes)
            ? rawRelease.cardIndexes : [])
            .map(Number)
            .filter((index) => Number.isInteger(index) && index >= 0))],
        }
      : null;
    if (packRelease && Array.isArray(rawRelease.itemKeys)) {
      packRelease.itemKeys = [...new Set(rawRelease.itemKeys.map(String).filter(Boolean))];
    }
    if (packRelease && Number.isInteger(Number(rawRelease.entryCount))
      && Number(rawRelease.entryCount) > 0) {
      packRelease.entryCount = Number(rawRelease.entryCount);
    }
    const validPackRelease = packRelease
      && packRelease.address
      && Number.isInteger(packRelease.level)
      && (packRelease.cardIndexes.length > 0 || packRelease.itemKeys?.length > 0)
      ? packRelease
      : null;
    const baseTitle = seq.title
      || (foilPack
        ? (normalizedLevel != null ? `FOIL PACK · LEVEL ${normalizedLevel}` : 'FOIL PACK')
        : wholeTickets.length > 0
        ? (Number.isFinite(level) ? `LEVEL ${level} TICKETS` : 'YOUR TICKETS')
        : (normalizedLevel != null ? `TICKET PACK · LEVEL ${normalizedLevel}` : 'TICKET PACK'));
    const title = packCount > 1 ? `${baseTitle} · PACK ${packIndex}/${packCount}` : baseTitle;

    // Real tickets — the traits have rolled, so deal one card per ticket showing
    // the four symbols it actually got. The sealed shape below is what the buy
    // receipt used to pop; it survives for callers that genuinely have nothing
    // to show yet (see app/app/pack-watch.js for why the buy no longer does).
    if (revealPieces.length > 0) {
      const extra = Number(seq.extra ?? 0);
      return {
        kind,
        title,
        hideTitle: true,
        big: true,
        autoStart: Boolean(seq.autoStart),
        level: normalizedLevel,
        foilPack,
        batchId,
        packIndex,
        packCount,
        packRelease: validPackRelease,
        count,
        totalCount: Math.max(count, Number(seq.totalCount ?? count) || count),
        // This deliberately uses a tutorial-specific input flag. Live pack
        // reveals always get the large direct single-ticket presentation, but
        // can never accidentally inherit the tutorial's explanatory panel.
        ticketLesson: Boolean(seq.tutorialTicketLesson),
        // Tickets are dealt as a GRID rather than one card at a time (user
        // call): a pack is a hand, and reading it as a hand is the point. The
        // per-ticket cards below still back the tray/summary path.
        ticketGrid: revealPieces.map((piece, i) => ({
          traitIds: piece.traitIds,
          traitId: piece.traitId,
          entry: Boolean(piece.entry),
          foil: Boolean(piece?.foil),
          label: piece.entry ? `ENTRY ${i + 1}` : `TICKET ${i + 1}`,
        })),
        extra,
        cards: revealPieces.map((piece, i) => ({
          type: piece.entry ? 'ticket-entry' : 'tickets',
          rarity: piece?.foil ? 'epic' : 'common', icon: null, glyph: null,
          level: normalizedLevel,
          traitIds: piece.traitIds,
          entryTraitId: piece.traitId,
          foil: Boolean(piece?.foil),
          label: piece.entry ? `ENTRY ${i + 1}` : `TICKET ${i + 1}`,
          value: '',
          sub: (i === revealPieces.length - 1 && extra > 0)
            ? `+${extra} more in your inventory`
            : (Number.isFinite(level) ? `Level ${level}` : ''),
          countText: null, spin: null,
        })),
      };
    }
    const dayTxt = seq.day != null ? ` with the Day ${seq.day} draw` : ' with the level draw';
    return {
      kind,
      title,
      hideTitle: true,
      big: foilPack,
      autoStart: Boolean(seq.autoStart),
      level: normalizedLevel,
      foilPack,
      batchId,
      packIndex,
      packCount,
      packRelease: validPackRelease,
      count,
      totalCount: Math.max(count, Number(seq.totalCount ?? count) || count),
      cards: [{
        type: 'tickets', rarity: foilPack ? 'epic' : 'common', icon: null, glyph: null,
        level: normalizedLevel,
        foil: foilPack,
        label: Number.isFinite(level)
          ? `LEVEL ${level}${foilPack ? ' FOIL' : ''} TICKETS`
          : `${foilPack ? 'FOIL ' : ''}TICKETS`,
        value: String(count),
        sub: seq.pending === false ? 'Traits revealed — check your inventory'
          : `Sealed — traits reveal${dayTxt}`,
        countText: String(count), spin: null,
      }],
    };
  }
  if (kind === 'foil-match') {
    const lineTraits = _wholeTicketTraitIds(seq.lineTraits);
    const winningTraits = _wholeTicketTraitIds(seq.winningTraits);
    if (!lineTraits || !winningTraits) return null;
    const matchFaces = Array.from({ length: 4 }, (_unused, index) => {
      const face = Math.trunc(Number(seq.matchFaces?.[index]) || 0);
      return face === 2 ? 2 : face === 1 ? 1 : 0;
    });
    const derivedScore = matchFaces.reduce((sum, face) => sum + face, 0);
    const rawScore = Math.trunc(Number(seq.score) || derivedScore);
    if (rawScore < FOIL_CLAIM_THRESHOLD || rawScore > 8) return null;
    const score = rawScore;
    const rewardFaces = Math.max(0, Math.trunc(Number(seq.rewardFaces) || 0));
    const drawKind = Number(seq.drawKind) === 1 ? 1 : 0;
    const exact = matchFaces.filter((face) => face === 2).length;
    const symbolOnly = matchFaces.filter((face) => face === 1).length;
    const drawLabel = drawKind === 1 ? 'BONUS JACKPOT' : 'MAIN JACKPOT';
    const rarity = score >= 8 ? 'legendary' : score >= 6 ? 'epic' : 'rare';
    const matchCard = {
      type: 'foil-match', rarity, icon: null, glyph: null,
      label: `FOIL T${score} MATCH`,
      value: `${score} / 8`,
      sub: `${drawLabel} · ${exact} exact (+2) · ${symbolOnly} symbol (+1)`,
      summaryDetail: true,
      countText: null,
      spin: null,
      foilMatch: {
        day: Number(seq.day),
        level: Number(seq.level),
        ticketIndex: Number(seq.ticketIndex),
        drawKind,
        score,
        rewardFaces,
        lineTraits,
        winningTraits,
        matchFaces,
      },
    };
    const rewardCards = (Array.isArray(seq.legs) ? seq.legs : []).flatMap(_cardsFromLeg);
    return {
      kind,
      title: `FOIL MATCH · T${score}`,
      big: score >= 6 || rewardCards.some((card) => (
        card.rarity === 'epic' || card.rarity === 'legendary'
      )),
      autoStart: true,
      noVessel: true,
      cards: [matchCard, ...rewardCards],
    };
  }
  if (kind === 'bingo') {
    const level = Number(seq.level);
    const symbol = Number(seq.symbol);
    if (!Number.isInteger(level) || level < 0 || !Number.isInteger(symbol)
      || symbol < 0 || symbol >= 32) return null;
    const quadrant = Number.isInteger(Number(seq.quadrant))
      ? (Number(seq.quadrant) & 3)
      : (symbol >> 3);
    const sym = Number.isInteger(Number(seq.sym)) ? (Number(seq.sym) & 7) : (symbol & 7);
    const quadrantName = String(DGN_QUADRANTS[quadrant] || 'trait').toUpperCase();
    const symbolName = String(dgnDisplaySymbol(quadrant, sym) || `symbol ${sym + 1}`)
      .replace(/[_-]+/g, ' ')
      .toUpperCase();
    const tier = ['first-quadrant', 'first-symbol'].includes(String(seq.tier))
      ? String(seq.tier)
      : 'regular';
    const tierTitle = tier === 'first-quadrant'
      ? 'QUADRANT-FIRST BINGO'
      : tier === 'first-symbol' ? 'FIRST-SYMBOL BINGO' : 'BINGO';
    const tierSub = tier === 'first-quadrant'
      ? `First ${quadrantName} Bingo at Level ${level}`
      : tier === 'first-symbol'
        ? `First ${symbolName} Bingo at Level ${level}`
        : `All 8 ${symbolName} colors collected at Level ${level}`;
    const rarity = tier === 'first-quadrant' ? 'legendary'
      : tier === 'first-symbol' ? 'epic' : 'rare';
    const flipReward = _safeBigInt(seq.flipReward);
    const dgnrsPaid = _safeBigInt(seq.dgnrsPaid);
    const counts = Array.from({ length: 64 }, (_unused, index) => (
      Math.max(0, Math.floor(Number(seq.counts?.[index]) || 0))
    ));
    const cards = [{
      type: 'bingo',
      rarity,
      icon: null,
      glyph: null,
      label: `${quadrantName} · ${symbolName} BINGO`,
      value: `LEVEL ${level}`,
      sub: tierSub,
      summaryDetail: true,
      countText: null,
      spin: null,
      bingo: { level, symbol, quadrant, sym, counts, tier },
    }];
    if (flipReward > 0n) {
      const art = _flipPrizeArt(flipReward);
      cards.push({
        type: 'flip', rarity: 'rare', icon: art.icon, pile: art.pile, glyph: null,
        label: 'FLIP', value: _tokenText(flipReward),
        sub: 'Credited to your coinflip balance',
        countText: _tokenText(flipReward), spin: null,
      });
    }
    if (dgnrsPaid > 0n) cards.push({
      type: 'dgnrs', rarity, icon: ICONS.dgnrs, glyph: null,
      label: 'sDGNRS', value: _tokenText(dgnrsPaid),
      sub: 'Paid from the Bingo reward pool',
      countText: _tokenText(dgnrsPaid), spin: null,
    });
    return {
      kind,
      title: tierTitle,
      big: tier !== 'regular' || dgnrsPaid > 0n,
      autoStart: true,
      noVessel: true,
      cards,
    };
  }
  if (kind === 'pari') {
    const market = String(seq.market || '').toLowerCase() === 'volume' ? 'VOLUME' : 'GROWTH';
    const marketLabel = `${market} BET`;
    const round = Math.max(0, Number(seq.round ?? 0));
    const side = Number(seq.side) === 2 ? 'UNDER' : 'OVER';
    const outcome = Number(seq.outcome) === 2 ? 'UNDER'
      : Number(seq.outcome) === 1 ? 'OVER' : null;
    const payout = _safeBigInt(seq.payout);
    const voided = Boolean(seq.voided);
    const won = payout > 0n;
    const label = market === 'GROWTH' ? `${marketLabel} · LEVEL ${round}` : marketLabel;
    const betTickets = seq.betTickets == null ? '' : String(seq.betTickets).trim();
    const resultTickets = seq.resultTickets == null ? '' : String(seq.resultTickets).trim();
    const hasVolumeResult = market === 'VOLUME' && betTickets && resultTickets;
    const art = won ? _flipPrizeArt(payout) : null;
    return {
      kind,
      title: won ? `${marketLabel} PAID` : `${marketLabel} RESULT`,
      big: won && payout > 2_000n * 10n ** 18n,
      // A settled losing bet has no reward to collect. Keep voided rounds out
      // of the loss treatment because their stake was returned.
      unlucky: !won && !voided,
      autoStart: true,
      noVessel: true,
      cards: [{
        type: won ? 'flip' : 'nowin',
        rarity: won ? 'rare' : 'common',
        icon: won ? art.icon : ICONS.flame,
        pile: won ? art.pile : null,
        glyph: null,
        label: hasVolumeResult
          ? `YOUR BET: ${side} ${betTickets} TICKETS`
          : label,
        value: hasVolumeResult
          ? `RESULT: ${resultTickets} TICKETS`
          : won ? `${_tokenText(payout)} FLIP` : `${side} LOST`,
        sub: hasVolumeResult
          ? (voided
              ? `RETURNED ${_tokenText(payout)} FLIP`
              : won ? `WIN ${_tokenText(payout)} FLIP` : 'LOSS · 0 FLIP')
          : voided
            ? 'Round voided · your stake was returned'
            : won
              ? `${side} paid`
              : `${outcome || 'THE OTHER SIDE'} paid`,
        countText: won ? `${_tokenText(payout)} FLIP` : null,
        spin: null,
        summaryDetail: true,
        labelFirst: true,
      }],
    };
  }
  if (kind === 'degenerette') {
    // A resolved Degenerette bet. Every spin gets its own row: the pick is the
    // same all the way down (one custom ticket per bet), the house reel is not
    // — spin 0's comes off DegeneretteResolved, the rest are derived in
    // dgn-reels.js. A row whose reel could not be verified arrives with
    // houseTraits null and renders as a score-only row rather than a fiction.
    const rows = (Array.isArray(seq.spins) ? seq.spins : []).map((s, i) => ({
      spinIndex: Number(s?.spinIndex ?? i),
      playerTraits: Number(s?.playerTraits ?? 0) >>> 0,
      houseTraits: s?.houseTraits == null ? null : (Number(s.houseTraits) >>> 0),
      score: Number(s?.score ?? 0),
      payout: (() => { try { return BigInt(s?.payout ?? 0); } catch (_e) { return 0n; } })(),
    }));
    if (rows.length === 0) return null;
    const currency = Number(seq.currency ?? 0);
    const unit = DGN_UNITS[currency] || 'FLIP';
    const total = (() => { try { return BigInt(seq.totalPayout ?? 0); } catch (_e) { return 0n; } })();
    const amountPerSpin = (() => {
      try { return BigInt(seq.amountPerSpin ?? 0); } catch (_e) { return 0n; }
    })();
    const totalWager = (() => {
      try {
        // Per-spin amount and the complete verified row set are authoritative.
        // A caller aggregate can be stale while a multi-spin result indexes.
        if (amountPerSpin > 0n) return amountPerSpin * BigInt(rows.length);
        if (seq.totalWager != null) return BigInt(seq.totalWager);
        return 0n;
      } catch (_e) { return 0n; }
    })();
    const spinSum = rows.reduce((a, r) => a + r.payout, 0n);
    const lootboxEth = (() => {
      if (currency !== 0) return 0n;
      try {
        const raw = BigInt(seq.lootboxEth ?? 0);
        if (raw <= 0n) return 0n;
        // DegeneretteResolved.totalPayout is gross ETH. The direct box can
        // never represent more than that gross; clamp malformed/stale feed
        // joins instead of allowing the displayed cash leg to go negative.
        return raw > total ? total : raw;
      } catch (_e) { return 0n; }
    })();
    const won = total > 0n;
    const celebrate = shouldCelebrateDegenerette({ total, totalWager });
    const unlucky = isUnluckyDegenerette({ total, totalWager });
    const hits = rows.filter((r) => r.payout > 0n).length;
    // FLIP per-spin payouts are the hits entering its final survival flip. A
    // zero settled total after one or more hits is a survival bust, not a
    // no-hit round; preserve that distinction in the final presentation.
    const survived = currency === 1 && hits > 0 ? won : null;
    const amount = currency === 0 ? _ethText(total) : _tokenText(total);
    return {
      kind,
      title: seq.title || (celebrate
        ? 'YOU WON'
        : won
          ? 'PARTIAL RETURN'
          : survived === false
            ? 'SURVIVAL FLIP LOST'
            : 'NO HITS'),
      // The verdict above is a SPOILER while the reels are still turning, so the
      // board plays under a neutral heading and swaps to it at the end.
      boardTitle: 'DEGENERETTE',
      big: celebrate,
      unlucky,
      // The board owns its own TAP TO SPIN gate, so the sequence-level vessel
      // gate is off and there is no chest to open.
      autoStart: false,
      noVessel: true,
      spinBoard: {
        rows, currency, unit, total, spinSum, survived, amountPerSpin, totalWager, celebrate, unlucky,
        headline: seq.headline == null ? null : String(seq.headline),
        heroIdx: seq.heroIdx == null ? null : (Number(seq.heroIdx) & 3),
        lootboxAwarded: Boolean(seq.lootboxAwarded),
        lootboxEth,
      },
      cards: [{
        type: won ? DGN_CARD_TYPES[currency] || 'flip' : 'nowin',
        rarity: won ? 'epic' : 'common',
        icon: won
          ? (currency === 0 ? ICONS.ethFace : (ICONS[DGN_CARD_TYPES[currency]] || ICONS.flip))
          : ICONS.flame,
        glyph: null,
        label: `DEGENERETTE — ${rows.length} SPIN${rows.length === 1 ? '' : 'S'}`,
        value: won ? `${amount} ${unit}` : (survived === false ? `0 ${unit}` : ''),
        sub: won
          ? `${hits} of ${rows.length} paid`
          : survived === false
            ? `${hits} of ${rows.length} hit · survival flip lost`
            : 'The house took this one',
        countText: null, spin: null,
      }],
    };
  }
  if (kind === 'jackpot') {
    const prizes = Array.isArray(seq.prizes) ? seq.prizes : [];
    const cards = [];
    for (const p of prizes) {
      if (!p) continue;
      if (p.type === 'eth' && BigInt(p.amount ?? 0) > 0n) {
        cards.push({
          type: 'eth', rarity: 'epic', icon: ICONS.eth, glyph: null,
          label: 'ETH', value: _ethText(p.amount),
          sub: 'Claim from your winnings tile',
          winningTraitIds: _winningTraitIds(p.winningTraitIds),
          countText: _ethText(p.amount), spin: null,
        });
      } else if (p.type === 'flip' && BigInt(p.amount ?? 0) > 0n) {
        const art = _flipPrizeArt(p.amount);
        cards.push({
          type: 'flip', rarity: 'rare', icon: art.icon, pile: art.pile, glyph: null,
          label: 'FLIP', value: _tokenText(p.amount),
          sub: 'Bonus draw payout',
          winningTraitIds: _winningTraitIds(p.winningTraitIds),
          countText: _tokenText(p.amount), spin: null,
        });
      } else if (p.type === 'wwxrp' && BigInt(p.amount ?? 0) > 0n) {
        cards.push({
          type: 'wwxrp', rarity: 'rare', icon: ICONS.wwxrp, glyph: null,
          label: 'WWXRP', value: _tokenText(p.amount),
          sub: 'Coinflip participation reward',
          countText: _tokenText(p.amount), spin: null,
        });
      } else if (p.type === 'decimator') {
        const direct = _safeBigInt(p.amount);
        const lootbox = _safeBigInt(p.lootboxAmount);
        if (direct > 0n || lootbox > 0n) {
          const directText = direct > 0n ? `${_ethText(direct)} ETH` : '';
          const lootboxText = lootbox > 0n ? `${_ethText(lootbox)} ETH LUCKBOX` : '';
          cards.push({
            type: 'decimator', rarity: 'epic', icon: ICONS.eth, glyph: null,
            label: 'DECIMATOR WIN',
            value: directText || lootboxText,
            sub: directText && lootboxText ? lootboxText : 'Decimator payout',
            summaryDetail: true,
            countText: null, spin: null,
          });
        }
      } else if (p.type === 'tickets' && Number(p.amount ?? 0) > 0) {
        cards.push({
          type: 'tickets', rarity: 'common', icon: null, glyph: null,
          // The wrapper already prints DEGENERUS / TICKET PACK, level, and
          // ticket count. Keep the day receipt from echoing the same facts
          // underneath a smaller copy of the artwork.
          packOnly: true,
          level: p.level == null ? null : Number(p.level),
          label: p.level != null ? `LEVEL ${p.level} TICKETS` : 'TICKETS',
          value: String(p.amount), sub: 'Won from the draw',
          winningTraitIds: _winningTraitIds(p.winningTraitIds),
          countText: String(p.amount), spin: null,
        });
      }
    }
    const won = cards.length > 0;
    if (!won && seq.noWin) {
      cards.push({
        type: 'nowin', rarity: 'common', icon: ICONS.flame, glyph: null,
        label: 'NO HIT', value: '',
        sub: seq.noWin.sub || 'The draw paid others today — better luck tomorrow',
        summaryDetail: true,
        countText: null, spin: null,
      });
    }

    const activity = seq.activity && typeof seq.activity === 'object' ? seq.activity : {};
    if (activity.hasCoinflipBet && typeof activity.coinflipWon === 'boolean') {
      let stake = 0n;
      try { stake = BigInt(activity.coinflipStakeAmount ?? 0); } catch (_e) { stake = 0n; }
      const rewardPercent = Math.max(0, Math.trunc(Number(activity.coinflipRewardPercent) || 0));
      const flipWon = activity.coinflipWon;
      let consolationWwxrp = 0n;
      if (!flipWon) {
        // The protocol's +1 WWXRP is part of losing the daily flip, not a
        // second independent prize. Fold every indexed consolation row into
        // this receipt and retain the guaranteed +1 even while that row lags.
        for (const prize of prizes) {
          if (prize?.type === 'wwxrp') consolationWwxrp += _safeBigInt(prize.amount);
        }
        for (let index = cards.length - 1; index >= 0; index -= 1) {
          if (cards[index]?.type !== 'wwxrp') continue;
          cards.splice(index, 1);
        }
        if (consolationWwxrp <= 0n) consolationWwxrp = 10n ** 18n;
      }
      const payout = flipWon
        ? stake + ((stake * BigInt(rewardPercent)) / 100n)
        : stake;
      cards.push({
        type: 'coinflip-result',
        outcome: flipWon ? 'win' : 'loss',
        rarity: flipWon ? 'epic' : 'common',
        icon: flipWon ? ICONS.ethFace : ICONS.wwxrp,
        glyph: null,
        label: flipWon ? 'COINFLIP' : 'COINFLIP LOSS',
        value: flipWon
          ? `+${_tokenText(payout)} FLIP`
          : `-${_tokenText(stake)} FLIP`,
        // Keep the amount as the visual headline and put the outcome on its
        // own line in the fullscreen day-summary card.
        sub: flipWon
          ? `WIN ${100 + rewardPercent}%`
          : `+${_tokenText(consolationWwxrp)} WWXRP`,
        outcomeLabel: flipWon ? 'WIN' : null,
        outcomePercent: flipWon ? `${100 + rewardPercent}%` : null,
        consolationWwxrp: flipWon ? null : `+${_tokenText(consolationWwxrp)} WWXRP`,
        summaryDetail: true,
        countText: null,
        spin: null,
      });
    }
    // The day receipt is for settled outcomes, not an activity log. Ticket
    // reveals and generic lootbox opened/bought counts have already had their
    // own live UI moments, so only include the actual resolved box contents.
    const resolvedLootboxes = Array.isArray(activity.lootboxResults)
      ? activity.lootboxResults : [];
    for (const result of resolvedLootboxes) {
      const rawIndex = result?.lootboxIndex;
      const resultLabel = rawIndex == null || String(rawIndex) === '0'
        ? 'AUTO-RESOLVED LUCKBOX'
        : `LUCKBOX #${String(rawIndex)}`;
      const resultCards = (Array.isArray(result?.legs) ? result.legs : [])
        .flatMap(_cardsFromLeg)
        .map((card) => card.spin
          ? _settledBoxSpinSummaryCard(card, resultLabel)
          : ({
              ...card,
              // These are final historical results, so the compact receipt can
              // show the reward immediately without replaying a second box flow.
              summaryDetail: true,
              sub: [card.sub, resultLabel].filter(Boolean).join(' · '),
            }));
      cards.push(...resultCards);
    }
    if (cards.length === 0) return null;
    // Activity cards are context, and WWXRP is the consolation side of a
    // losing flip. Derive the terminal treatment from the complete summary so
    // callers cannot accidentally leave a full loss on the positive terminal
    // action merely because they omitted the old consolationOnly hint.
    const hasNonConsolationWin = cards.some((card) => {
      if (card.type === 'coinflip-result') return card.outcome === 'win';
      if (card.settledBoxSpin) return card.outcome === 'win';
      return !['nowin', 'wwxrp'].includes(card.type);
    });
    const hasSettledLoss = Boolean(seq.consolationOnly) || cards.some((card) => (
      card.type === 'nowin'
      || card.type === 'wwxrp'
      || (card.settledBoxSpin && card.outcome === 'loss')
      || (card.type === 'coinflip-result' && card.outcome === 'loss')
    ));
    const fullLoss = hasSettledLoss && !hasNonConsolationWin;
    return {
      kind,
      title: seq.title || (seq.day != null ? `DAY ${seq.day} SUMMARY` : 'DAY SUMMARY'),
      big: won,
      consolationOnly: Boolean(seq.consolationOnly || fullLoss),
      unlucky: Boolean(seq.consolationOnly || fullLoss),
      autoStart: true,
      daySummary: true,
      // Day summaries follow an already-played-out board — nothing is sealed,
      // so no mystery-chest vessel; straight to the prize cards.
      noVessel: true,
      cards,
    };
  }
  if (kind === 'resolution') {
    const cards = (Array.isArray(seq.cards) ? seq.cards : [])
      .filter((card) => card && typeof card === 'object')
      .map((card) => {
        const outcome = ['win', 'loss', 'skipped'].includes(String(card.outcome || ''))
          ? String(card.outcome)
          : null;
        return {
          type: String(card.type || 'resolution').toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
          outcome,
          rarity: String(card.rarity || (outcome === 'win' ? 'epic' : 'common')),
          icon: null,
          glyph: card.glyph == null ? '✦' : String(card.glyph),
          label: String(card.label || 'FINAL DRAW'),
          value: String(card.value || ''),
          sub: card.sub == null ? '' : String(card.sub),
          summaryDetail: true,
          countText: card.countText == null ? null : String(card.countText),
          spin: null,
        };
      });
    if (cards.length === 0) return null;
    const won = cards.some((card) => card.outcome === 'win');
    const lost = !won && cards.some((card) => (
      card.outcome === 'loss' || card.outcome === 'skipped'
    ));
    return {
      kind,
      title: String(seq.title || 'FINAL DRAW'),
      big: Boolean(seq.big || won),
      unlucky: lost,
      autoStart: true,
      noVessel: true,
      cards,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _reducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_e) { return false; }
}

// rAF count-up on the numeric head of `text` (suffix preserved). Falls back
// to an instant set when rAF is unavailable (fakeDOM / node:test).
function _animateCount(el, text, ms = 750) {
  if (!el) return;
  const m = /^([\d,]+(?:\.\d+)?)/.exec(String(text));
  const hasRaf = typeof requestAnimationFrame === 'function'
    && typeof performance !== 'undefined';
  const duration = Number(ms);
  if (!m || !hasRaf || _reducedMotion() || !Number.isFinite(duration) || duration <= 0) {
    el.textContent = String(text);
    return;
  }
  const target = Number(m[1].replace(/,/g, ''));
  const suffix = String(text).slice(m[1].length);
  const decimals = (m[1].split('.')[1] || '').length;
  if (!Number.isFinite(target)) { el.textContent = String(text); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = _groupAmountText((target * eased).toFixed(decimals)) + suffix;
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = String(text);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Standalone Degenerette spin plan
// ---------------------------------------------------------------------------
//
// The standalone simulator does not reveal four already-known cells. It keeps
// rerolling the whole house token and locks eight independent attributes:
// four symbols and four colors in a seeded random order. Between locks it
// shows 2–4 idle rolls. A color or symbol can therefore be the first settled
// component in any quadrant; presentation code keeps those two partial-match
// states visually and audibly distinct.
// This deterministic planner ports that choreography without inventing a new
// result — every plan ends at the chain-derived `houseTraits`.

function _dgnU32(value) {
  try { return Number(BigInt(value ?? 0) & 0xFFFFFFFFn) >>> 0; }
  catch (_e) { return Number(value) >>> 0; }
}

/**
 * Build the intermediate house-token frames used by the full reveal.
 *
 * @param {{playerTraits:number|bigint, houseTraits:number|bigint, spinIndex?:number,
 *          idleMin?:number, idleMax?:number}} args
 * @returns {Array<{traits:Array<{sym:number,col:number}>,
 *   lockedColors:boolean[],lockedSymbols:boolean[],
 *   lock:null|{quadrant:number,type:'color'|'symbol'},locksDone:number}>}
 */
export function buildDegeneretteSpinFrames({
  playerTraits = 0,
  houseTraits = 0,
  spinIndex = 0,
  idleMin = 2,
  idleMax = 4,
} = {}) {
  const target = dgnUnpackTicket(houseTraits);
  const minIdle = Math.max(0, Math.min(4, Math.floor(Number(idleMin) || 0)));
  const maxIdle = Math.max(minIdle, Math.min(4, Math.floor(Number(idleMax) || 0)));
  let state = (
    _dgnU32(houseTraits)
    ^ Math.imul(_dgnU32(playerTraits), 0x9E3779B1)
    ^ Math.imul((Number(spinIndex) + 1) >>> 0, 0x85EBCA6B)
  ) >>> 0;
  if (state === 0) state = 0x6D2B79F5;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
  const idleCount = () => minIdle + (next() % (maxIdle - minIdle + 1));
  const lockedColors = new Set();
  const lockedSymbols = new Set();
  const current = target.map(() => ({ sym: next() & 7, col: next() & 7 }));
  const frames = [];
  let locksDone = 0;
  let idleRemaining = idleCount();

  while (locksDone < 8 && frames.length < 64) {
    let lock = null;
    if (idleRemaining > 0) {
      idleRemaining -= 1;
    } else {
      const available = [];
      for (let q = 0; q < 4; q++) {
        if (!lockedColors.has(q)) available.push({ quadrant: q, type: 'color' });
        if (!lockedSymbols.has(q)) available.push({ quadrant: q, type: 'symbol' });
      }
      lock = available[next() % available.length];
      if (lock.type === 'color') lockedColors.add(lock.quadrant);
      else lockedSymbols.add(lock.quadrant);
      locksDone += 1;
      idleRemaining = idleCount();
    }

    for (let q = 0; q < 4; q++) {
      current[q] = {
        sym: lockedSymbols.has(q) ? target[q].sym : next() & 7,
        col: lockedColors.has(q) ? target[q].col : next() & 7,
      };
    }
    frames.push({
      traits: current.map((t) => ({ ...t })),
      lockedColors: Array.from({ length: 4 }, (_, q) => lockedColors.has(q)),
      lockedSymbols: Array.from({ length: 4 }, (_, q) => lockedSymbols.has(q)),
      lock: lock ? { ...lock } : null,
      locksDone,
    });
  }
  return frames;
}

/**
 * Classify the component that just locked against the player's ticket.
 * `both` is reserved for the second matching component completing a full
 * quadrant; a color by itself remains a non-scoring, provisional match.
 *
 * @returns {'color'|'symbol'|'both'|null}
 */
export function degeneretteLockMatchType(playerTraits, targetTraits, frame) {
  const lock = frame?.lock;
  const q = Number(lock?.quadrant);
  if ((lock?.type !== 'color' && lock?.type !== 'symbol')
    || !Number.isInteger(q) || q < 0 || q > 3
    || !playerTraits?.[q] || !targetTraits?.[q]) return null;

  const colorMatched = playerTraits[q].col === targetTraits[q].col;
  const symbolMatched = playerTraits[q].sym === targetTraits[q].sym;
  const componentMatched = lock.type === 'color' ? colorMatched : symbolMatched;
  if (!componentMatched) return null;

  const colorLocked = Boolean(frame.lockedColors?.[q]);
  const symbolLocked = Boolean(frame.lockedSymbols?.[q]);
  if (colorLocked && symbolLocked && colorMatched && symbolMatched) return 'both';
  return lock.type;
}

export function shouldBobDegeneretteLock(matchType, matchingLocks) {
  return (matchType === 'symbol' || matchType === 'both')
    && Number(matchingLocks) >= 3;
}

class RevealOverlay extends HTMLElement {
  #initialized = false;
  #queue = [];
  #running = false;
  #aborted = false;
  #timers = new Set();
  #tapResolve = null;
  #tapLocked = false;
  #currentSequence = null;
  #openAllBatchId = null;
  #openAllPacks = false;
  #skipAllPacks = false;
  #packHistory = [];
  #controlsOnly = false;
  #continuationBusy = false;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wire();
    _instance = this;
    // Drain anything queued before mount.
    if (_buffer.length > 0) {
      const pending = _buffer;
      _buffer = [];
      for (const seq of pending) this.enqueue(seq);
    }
  }

  disconnectedCallback() {
    if (_instance === this) _instance = null;
    this.#clearTimers();
    try { unlockScroll(); } catch (_e) { /* defensive */ }
  }

  // -------------------------------------------------------------------------
  // Shell — static markup only (T-58-18: dynamic content via createElement).
  // -------------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <div class="rvl-backdrop" data-bind="rvl-backdrop" hidden>
        <div class="rvl-corner-actions">
          <button type="button" class="rvl-clear-pending" data-bind="rvl-clear-pending"
                  aria-label="Clear this reveal and every pending reminder">CLEAR PENDING</button>
          <button type="button" class="rvl-close" data-bind="rvl-close" aria-label="Close reveal">✕</button>
        </div>
        <div class="rvl-stage" data-bind="rvl-stage">
          <div class="rvl-title" data-bind="rvl-title" aria-live="polite"></div>
          <div class="rvl-vessel" data-bind="rvl-vessel" hidden>
            <div class="rvl-lootbox-fx" aria-hidden="true">
              <span class="rvl-lootbox-beam"></span>
              <span class="rvl-lootbox-rays"></span>
              <span class="rvl-lootbox-ring rvl-lootbox-ring--outer"></span>
              <span class="rvl-lootbox-ring rvl-lootbox-ring--inner"></span>
              <span class="rvl-lootbox-spark rvl-lootbox-spark--1"></span>
              <span class="rvl-lootbox-spark rvl-lootbox-spark--2"></span>
              <span class="rvl-lootbox-spark rvl-lootbox-spark--3"></span>
              <span class="rvl-lootbox-spark rvl-lootbox-spark--4"></span>
              <span class="rvl-lootbox-spark rvl-lootbox-spark--5"></span>
              <span class="rvl-lootbox-spark rvl-lootbox-spark--6"></span>
              <span class="rvl-lootbox-spark rvl-lootbox-spark--7"></span>
              <span class="rvl-lootbox-spark rvl-lootbox-spark--8"></span>
            </div>
            <div class="rvl-chest" data-bind="rvl-chest">
              <div class="rvl-chest-aura"></div>
              <div class="rvl-chest-lid"></div>
              <div class="rvl-chest-seam"></div>
              <div class="rvl-chest-body"></div>
              <div class="rvl-chest-clasp">
                <img class="rvl-chest-q rvl-chest-logo" src="/whitepaper/flame-logo.svg" alt="">
              </div>
              <div class="rvl-chest-platform"></div>
            </div>
            <div class="rvl-pack" data-bind="rvl-pack">
              <div class="rvl-pack-shine"></div>
              <div class="rvl-pack-brand">
                <img class="rvl-pack-logo" src="/whitepaper/flame-logo.svg" alt="">
                <span class="rvl-pack-wordmark">DEGENERUS</span>
                <span class="rvl-pack-edition" data-bind="rvl-pack-edition">TICKET PACK</span>
              </div>
              <span class="rvl-pack-level" data-bind="rvl-pack-level"></span>
              <span class="rvl-pack-count" data-bind="rvl-pack-count"></span>
            </div>
            <div class="rvl-vessel-hint" data-bind="rvl-hint">TAP TO OPEN</div>
            <div class="rvl-vessel-pack-actions" data-bind="rvl-pack-actions" hidden>
              <button type="button" class="rvl-vessel-open-pack" data-bind="rvl-open-pack" hidden>
                OPEN PACK
              </button>
              <button type="button" class="rvl-vessel-open-all" data-bind="rvl-open-all" hidden>
                OPEN ALL
              </button>
              <button type="button" class="rvl-vessel-skip" data-bind="rvl-skip-pack"
                      aria-label="Skip this pack reveal">
                SKIP
              </button>
            </div>
          </div>
          <div class="rvl-card-zone" data-bind="rvl-card-zone" hidden></div>
          <div class="rvl-spin-zone" data-bind="rvl-spin-zone" hidden></div>
          <div class="rvl-tray" data-bind="rvl-tray"></div>
          <div class="rvl-summary" data-bind="rvl-summary" hidden></div>
        </div>
      </div>
    `;
  }

  #bind(name) { return this.querySelector(`[data-bind="${name}"]`); }

  #wire() {
    const clearPending = this.#bind('rvl-clear-pending');
    if (clearPending) clearPending.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      this.#clearPendingQueue();
    });
    const close = this.#bind('rvl-close');
    if (close) close.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      this.#abort();
    });
    const backdrop = this.#bind('rvl-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => {
      if (!this.#controlsOnly) this.#tap();
    });
    const vessel = this.#bind('rvl-vessel');
    if (vessel) {
      vessel.addEventListener('click', (e) => {
        try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
        this.#tap();
      });
      vessel.addEventListener('keydown', (e) => {
        if (e?.key !== 'Enter' && e?.key !== ' ') return;
        try { e.preventDefault(); e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
        this.#tap();
      });
    }
    const openPack = this.#bind('rvl-open-pack');
    if (openPack) openPack.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      if (this.#currentSequence?.kind === 'pack') this.#tap('open-pack');
    });
    const openAll = this.#bind('rvl-open-all');
    if (openAll) openAll.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      const seq = this.#currentSequence;
      this.#startOpenAll(seq);
    });
    const skipPack = this.#bind('rvl-skip-pack');
    if (skipPack) skipPack.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      if (this.#currentSequence?.kind !== 'pack') return;
      const openAll = this.#bind('rvl-open-all');
      // Keep the secondary action's scope identical to the primary action
      // beside it. If the wrapper advertises OPEN ALL, SKIP consumes that
      // same pack set instead of advancing to another sealed wrapper.
      this.#tap(openAll && !openAll.hidden ? 'skip-all-packs' : 'skip-pack');
    });
  }

  #hasMorePacks(seq) {
    return Boolean(
      seq
      && seq.kind === 'pack'
      && seq.batchId
      && Number(seq.packIndex || 1) < Number(seq.packCount || 1),
    );
  }

  #rememberOpenedPack(seq) {
    if (seq?.kind !== 'pack' || !Array.isArray(seq.ticketGrid) || seq.ticketGrid.length === 0) {
      return -1;
    }
    const existing = this.#packHistory.indexOf(seq);
    if (existing >= 0) return existing;
    this.#packHistory.push(seq);
    return this.#packHistory.length - 1;
  }

  #appendSinglePackBadge(seq, grid) {
    if (!grid || !Array.isArray(seq?.ticketGrid) || seq.ticketGrid.length !== 1) return;
    // A one-piece reveal skips the sealed-wrapper interaction, but it still
    // needs a compact pack identity so the player can see which level produced
    // the ticket/entry. This is informational art, not another tap target.
    const badge = this.#buildRewardPack({
      foil: Boolean(seq.foilPack),
      level: seq.level,
      value: '',
    });
    badge.classList?.add('rvl-single-pack-badge');
    badge.setAttribute?.(
      'aria-label',
      `${seq.foilPack ? 'Foil ' : ''}ticket pack${seq.level == null ? '' : ` level ${seq.level}`}`,
    );
    grid.appendChild(badge);
  }

  #appendTicketGridPieces(
    seq,
    grid,
    { singlePiece = false, showLesson = false, queued = false } = {},
  ) {
    const dealt = [];
    const pieces = Array.isArray(seq?.ticketGrid) ? seq.ticketGrid : [];
    const wholeTickets = pieces.filter((piece) => !piece?.entry);
    const looseEntries = pieces.filter((piece) => piece?.entry);

    for (const ticket of wholeTickets) {
      const paper = this.#buildPaperTicket(ticket.traitIds, ticket.foil);
      if (singlePiece || showLesson) {
        paper.querySelector('.ticket-card')?.classList?.remove('tc-small');
      }
      // A motion-enabled deal must enter the DOM concealed. Adding this class
      // after append lets the browser paint the completed hand for a frame
      // (and for the whole inline-wrapper beat during OPEN ALL).
      if (queued) paper.classList?.add('rvl-paper--queued');
      grid.appendChild(paper);
      dealt.push({ el: paper, ticket });
    }

    // One to three loose entries share a normal ticket-sized 2x2 footprint.
    // Empty quadrants remain empty, and the gap keeps the pieces visibly
    // separate from a real four-entry ticket.
    for (const clusterEntries of _clusterTicketEntries(looseEntries)) {
      const cluster = document.createElement('div');
      cluster.className = 'rvl-entry-cluster';
      cluster.setAttribute('data-entry-count', String(clusterEntries.length));
      cluster.setAttribute(
        'aria-label',
        `${clusterEntries.length} loose ticket ${clusterEntries.length === 1 ? 'entry' : 'entries'}`,
      );
      const clusterGrid = document.createElement('div');
      clusterGrid.className = 'rvl-entry-cluster__grid';
      for (const { piece: ticket, quadrant } of clusterEntries) {
        const paper = this.#buildPaperEntry(ticket.traitId);
        paper.classList?.add(`rvl-entry-cluster__slot--q${quadrant}`);
        if (showLesson) {
          paper.querySelector('.ticket-entry-card')?.classList?.remove('tc-small');
        }
        if (queued) paper.classList?.add('rvl-paper--queued');
        clusterGrid.appendChild(paper);
        dealt.push({ el: paper, ticket });
      }
      cluster.appendChild(clusterGrid);
      grid.appendChild(cluster);
    }
    return dealt;
  }

  #paintOpenedPack(seq, surface, grid) {
    if (!seq || !surface || !grid) return;
    const singlePiece = seq.ticketGrid.length === 1;
    const singleEntry = singlePiece && Boolean(seq.ticketGrid[0]?.entry);
    surface.className = (seq.foilPack
      ? 'rvl-ticket-pack-stage rvl-ticket-pack-stage--foil'
      : 'rvl-ticket-pack-stage')
      + (singlePiece ? ' rvl-ticket-pack-stage--single' : '')
      + (singleEntry ? ' rvl-ticket-pack-stage--single-entry' : '')
      + (seq.ticketLesson ? ' rvl-ticket-pack-stage--lesson' : '');
    grid.className = (seq.foilPack
      ? 'rvl-ticket-grid-stage rvl-ticket-grid-stage--foil'
      : 'rvl-ticket-grid-stage')
      + ` ${ticketGridSizeClass(seq.ticketGrid.length)}`
      + (singlePiece ? ' rvl-ticket-grid-stage--single' : '')
      + (singleEntry ? ' rvl-ticket-grid-stage--single-entry' : '')
      + (seq.ticketLesson ? ' rvl-ticket-grid-stage--lesson' : '')
      + (seq.ticketLesson && !singlePiece ? ' rvl-ticket-grid-stage--lesson-stack' : '');
    grid.textContent = '';
    this.#appendSinglePackBadge(seq, grid);
    this.#appendTicketGridPieces(seq, grid, {
      singlePiece,
      showLesson: Boolean(seq.ticketLesson),
    });
    if (seq.extra > 0) {
      const more = document.createElement('div');
      more.className = 'rvl-ticket-more';
      more.textContent = `+${seq.extra} more in your inventory`;
      grid.appendChild(more);
    }
  }

  #appendPackHistoryControls({ actions, central, surface, grid, currentIndex }) {
    if (!actions || !central || this.#packHistory.length < 2) {
      actions?.appendChild?.(central);
      return;
    }
    const row = document.createElement('div');
    row.className = 'rvl-pack-history-actions';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'rvl-pack-history-nav rvl-pack-history-nav--previous';
    previous.textContent = '<';
    previous.setAttribute('aria-label', 'View previous opened pack');
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'rvl-pack-history-nav rvl-pack-history-nav--next';
    next.textContent = '>';
    next.setAttribute('aria-label', 'View next opened pack');
    const label = document.createElement('div');
    label.className = 'rvl-pack-history-label';

    const currentRip = surface.querySelector?.('.rvl-auto-pack-rip');
    let viewedIndex = currentIndex;
    const paint = (index) => {
      viewedIndex = Math.max(0, Math.min(this.#packHistory.length - 1, Number(index)));
      const viewed = this.#packHistory[viewedIndex];
      this.#paintOpenedPack(viewed, surface, grid);
      if (currentRip) {
        const showingCurrent = viewedIndex === currentIndex;
        currentRip.hidden = !showingCurrent;
        if (showingCurrent) surface.classList?.add('rvl-ticket-pack-stage--inline-rip');
      }
      previous.disabled = viewedIndex <= 0;
      next.disabled = viewedIndex >= this.#packHistory.length - 1;
      const level = viewed?.level == null ? '' : ` · LEVEL ${viewed.level}`;
      label.textContent = `PACK ${viewedIndex + 1} OF ${this.#packHistory.length} OPENED${level}`;
    };
    previous.addEventListener('click', (event) => {
      try { event.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      if (!previous.disabled) paint(viewedIndex - 1);
    });
    next.addEventListener('click', (event) => {
      try { event.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      if (!next.disabled) paint(viewedIndex + 1);
    });
    row.appendChild(previous);
    row.appendChild(central);
    row.appendChild(next);
    actions.appendChild(label);
    actions.appendChild(row);
    paint(currentIndex);
  }

  #remainingPacks(seq, { includeCurrent = false } = {}) {
    if (!seq || seq.kind !== 'pack') return 0;
    const count = Math.max(1, Number(seq.packCount || 1));
    const index = Math.max(1, Number(seq.packIndex || 1));
    return Math.max(0, count - index + (includeCurrent ? 1 : 0));
  }

  #sortQueuedPacksFoilLast() {
    const slots = [];
    const packs = [];
    this.#queue.forEach((candidate, index) => {
      if (candidate?.kind !== 'pack') return;
      slots.push(index);
      packs.push(candidate);
    });
    const ordered = [
      ...packs.filter((candidate) => !candidate.foilPack),
      ...packs.filter((candidate) => candidate.foilPack),
    ];
    slots.forEach((slot, index) => { this.#queue[slot] = ordered[index]; });
  }

  #isOpeningAll(seq) {
    return Boolean(
      seq?.kind === 'pack'
      && (this.#openAllPacks || (seq.batchId && this.#openAllBatchId === seq.batchId)),
    );
  }

  #startOpenAll(seq) {
    if (!this.#canOpenAllPacks(seq)) return false;
    this.#sortQueuedPacksFoilLast();
    this.#openAllPacks = true;
    this.#openAllBatchId = seq?.batchId || null;
    this.#tap('open-all');
    return true;
  }

  #pendingMatchesPackRelease(item, release) {
    if (!release || item?.kind !== 'tickets') return false;
    return Number(item?.ticketLevel) === Number(release.level);
  }

  #readyPendingPacks(excludeRelease = null) {
    return getPendingActions().filter((item) => (
      item?.kind === 'tickets'
      && item?.state === 'ready'
      && typeof item.run === 'function'
      && !this.#pendingMatchesPackRelease(item, excludeRelease)
    )).sort((a, b) => Number(Boolean(a.foilPack)) - Number(Boolean(b.foilPack)));
  }

  #hasExternalPacks(seq) {
    return this.#queue.some((queued) => (
      queued?.kind === 'pack' && queued.batchId !== seq?.batchId
    ))
      || this.#readyPendingPacks(seq?.packRelease).length > 0;
  }

  #canOpenAllPacks(seq) {
    return Boolean(
      seq?.kind === 'pack'
      && (this.#hasMorePacks(seq) || this.#hasExternalPacks(seq)),
    );
  }

  #openAllPacksLabel(seq, { includeCurrent = false } = {}) {
    if (this.#hasExternalPacks(seq)) return 'OPEN ALL PACKS';
    const remaining = this.#remainingPacks(seq, { includeCurrent });
    return includeCurrent
      ? `OPEN ALL ${remaining} PACKS`
      : `OPEN ALL ${remaining} REMAINING`;
  }

  async #queueNextPendingPack(seq, { autoStart = true, ordinaryOnly = false } = {}) {
    const ready = this.#readyPendingPacks(seq?.packRelease);
    const action = ordinaryOnly
      ? ready.find((candidate) => !candidate.foilPack) || null
      : ready[0] || null;
    if (!action) return false;
    const close = this.#bind('rvl-close');
    if (close) close.disabled = true;
    const queueLength = this.#queue.length;
    try {
      await action.run();
    } catch (_e) {
      // The pack watcher owns retry state and concise errors. A rejected or
      // stale action simply ends OPEN ALL on the current readable hand.
    } finally {
      if (close) close.disabled = false;
    }
    const added = this.#queue.splice(queueLength);
    const packs = [];
    const unrelated = [];
    for (const queued of added) {
      if (queued?.kind === 'pack') {
        queued.autoStart = Boolean(autoStart);
        packs.push(queued);
      } else {
        unrelated.push(queued);
      }
    }
    if (this.#aborted) {
      this.#emitPackAbort(packs);
      this.#queue.push(...unrelated);
      return false;
    }
    // The player explicitly selected packs. Keep the newly materialized pack
    // immediately behind the current pack, while unrelated rewards retain
    // their existing order at the tail.
    this.#queue.unshift(...packs);
    this.#queue.push(...unrelated);
    this.#sortQueuedPacksFoilLast();
    return packs.length > 0;
  }

  // OPEN NEXT is a one-pack promise: carry that click into the following
  // sealed pack so the player is not asked to tap the wrapper a second time.
  // It deliberately arms only the immediate sibling, unlike OPEN ALL.
  #armNextPack(seq) {
    if (!this.#hasMorePacks(seq) || !seq?.batchId) return false;
    const nextIndex = Number(seq.packIndex || 1) + 1;
    const next = this.#queue.find((candidate) => (
      candidate?.kind === 'pack'
      && candidate.batchId === seq.batchId
      && Number(candidate.packIndex || 1) === nextIndex
    ));
    if (!next) return false;
    next.autoStart = true;
    return true;
  }

  #pendingMatchesLootboxRelease(item, release) {
    if (!release?.key || item?.kind !== 'lootbox') return false;
    return String(item.id || '') === `lootbox:${String(release.key)}`;
  }

  #readyPendingLootboxes(excludeRelease = null) {
    return getPendingActions().filter((item) => (
      item?.kind === 'lootbox'
      && item?.state === 'ready'
      && typeof item.run === 'function'
      && !this.#pendingMatchesLootboxRelease(item, excludeRelease)
    ));
  }

  #nextReadyPendingAction(excludeRelease = null) {
    return getPendingActions().find((item) => (
      item?.state === 'ready' && typeof item.run === 'function'
      // Mine FLIP is permissionless maintenance, not part of a player's
      // reward-opening flow. Keep it in Pending for an explicit click, but do
      // not let a reveal popup chain into it automatically.
      && item?.source !== 'mine-flip-resolver'
      && !String(item?.id || '').startsWith('mine-flip:')
      && !this.#pendingMatchesLootboxRelease(item, excludeRelease)
    )) || null;
  }

  #queuedContinuationLabel() {
    if (this.#queue.length === 0) return null;
    return this.#queue[0]?.kind === 'lootbox' ? 'OPEN LUCKBOX' : 'NEXT ▸';
  }

  #armQueuedContinuation() {
    if (this.#queue[0]?.kind === 'lootbox') this.#queue[0].autoStart = true;
  }

  #pendingContinuationLabel(action) {
    if (action?.kind === 'lootbox') return 'OPEN LUCKBOX';
    if (action?.kind === 'tickets') return 'OPEN TICKETS';
    if (action?.kind === 'bingo') return 'REVEAL BINGO';
    if (action?.kind === 'foil-match') return 'CLAIM FOIL MATCH';
    return String(action?.shortLabel || 'GOOD LUCK').toUpperCase();
  }

  #setPendingContinuation(button, action, fallback = null) {
    if (!button) return;
    const terminal = fallback || button.__rvlTerminalLabel || 'GOOD LUCK';
    button.__rvlTerminalLabel = terminal;
    button.__rvlPendingAction = action || null;
    button.dataset.mode = action ? 'pending-action' : 'continue';
    button.textContent = action ? this.#pendingContinuationLabel(action) : terminal;
    button.classList?.toggle(
      'rvl-collect-cta--unlucky',
      !action && terminal === 'UNLUCKY',
    );
    button.disabled = false;
  }

  async #runPendingContinuation(action, button, refresh) {
    if (this.#continuationBusy || !action || typeof action.run !== 'function') return;
    this.#continuationBusy = true;
    const priorControlsOnly = this.#controlsOnly;
    this.#controlsOnly = true;
    const close = this.#bind('rvl-close');
    if (close) close.disabled = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'CONTINUING…';
    }
    const queueLength = this.#queue.length;
    try {
      await action.run();
    } catch (_e) {
      // The action owner keeps rejected/failed work retryable and owns its
      // compact error copy. Do not replace a useful result with raw tx text.
    } finally {
      this.#continuationBusy = false;
      this.#controlsOnly = priorControlsOnly;
      if (close) close.disabled = false;
    }
    if (this.#aborted) return;
    if (this.#queue.length > queueLength) {
      this.#tap('next-action');
      return;
    }
    if (typeof refresh === 'function') refresh();
  }

  // A pending-action owner remains responsible for the chain read/write and
  // receipt parsing. This helper only collects the normalized reveals that
  // those honest actions append, then moves them directly behind the box the
  // player is currently viewing.
  async #queuePendingLootboxes({ all = false } = {}) {
    const actions = this.#readyPendingLootboxes();
    const boxes = [];
    const unrelated = [];
    for (const action of actions) {
      const queueLength = this.#queue.length;
      try { await action.run(); } catch (_e) { /* the owner keeps failed rows retryable */ }
      const added = this.#queue.splice(queueLength);
      for (const seq of added) {
        if (seq?.kind === 'lootbox') {
          seq.autoStart = true;
          seq.autoAdvance = all;
          boxes.push(seq);
        } else {
          unrelated.push(seq);
        }
      }
      if (!all && boxes.length > 0) break;
    }
    // Keep non-box work at its original tail while making OPEN NEXT literal.
    this.#queue.unshift(...boxes);
    this.#queue.push(...unrelated);
    return boxes.length;
  }

  async #openPendingLootboxes(seq, { all = false } = {}) {
    if (this.#controlsOnly) return;
    this.#controlsOnly = true;
    const summary = this.#bind('rvl-summary');
    for (const button of summary?.querySelectorAll?.('button') || []) button.disabled = true;
    const close = this.#bind('rvl-close');
    if (close) close.disabled = true;

    let queued = 0;
    try {
      queued = await this.#queuePendingLootboxes({ all });
    } finally {
      this.#controlsOnly = false;
      if (close) close.disabled = false;
    }
    if (this.#aborted) return;
    if (queued > 0) {
      this.#tap(all ? 'open-all-boxes' : 'next-box');
      return;
    }
    // A wallet rejection or an indexer race leaves the current result intact
    // and refreshes the controls so the player can retry instead of getting a
    // dead, disabled button.
    this.#renderSummary(seq);
  }

  // -------------------------------------------------------------------------
  // Queue driver
  // -------------------------------------------------------------------------

  enqueue(rawSeq) {
    const queued = _withLootboxPresentationId(rawSeq);
    _emitLootboxQueued(queued);
    const seq = normalizeSequence(queued);
    if (!seq) {
      this.#emitLootboxAbort([queued]);
      return;
    }
    this.#queue.push(seq);
    // Same-tick pack releases are ordered before the runner claims the first
    // item. This prevents a foil-only record from becoming the current pack
    // while an ordinary pack already waiting in the queue should precede it.
    if (!this.#running || this.#currentSequence == null) this.#sortQueuedPacksFoilLast();
    if (!this.#running) {
      // Claim the runner synchronously, but start on a microtask so every
      // same-tick enqueue (multi-box opens, buy legs + pack) lands in the
      // queue before the first sequence renders — the summary CTA can then
      // correctly name the next reveal instead of showing a terminal action.
      this.#running = true;
      Promise.resolve().then(() => this.#run());
    }
  }

  async #run() {
    this.#running = true;
    this.#aborted = false;
    this.#packHistory = [];
    try { lockScroll(); } catch (_e) { /* defensive */ }
    const backdrop = this.#bind('rvl-backdrop');
    if (backdrop) backdrop.hidden = false;
    try {
      while (this.#queue.length > 0 && !this.#aborted) {
        if (this.#openAllPacks
          && this.#queue[0]?.kind === 'pack'
          && this.#queue[0]?.foilPack
          && this.#readyPendingPacks(this.#currentSequence?.packRelease)
            .some((candidate) => !candidate.foilPack)) {
          await this.#queueNextPendingPack(this.#currentSequence, { ordinaryOnly: true });
          if (this.#aborted) break;
        }
        const seq = this.#queue.shift();
        this.#currentSequence = seq;
        // Once SKIP ALL is armed, consume subsequent packs through their
        // normal completion bookkeeping without mounting another wrapper or
        // ticket hand. Non-pack rewards retain their place in the queue.
        const result = this.#skipAllPacks && seq?.kind === 'pack'
          ? 'skip-all-packs'
          : await this.#playSequence(seq);
        if (!this.#aborted) {
          this.#emitPackComplete(seq);
          this.#emitLootboxComplete(seq);
          if (result === 'skip-all-packs') {
            this.#skipAllPacks = true;
            let hasMore = this.#hasMorePacks(seq)
              || this.#queue.some((candidate) => candidate?.kind === 'pack');
            if (!hasMore) {
              // Completion listeners get a microtask to retire the current
              // release before a different ready Pending pack is materialized.
              await Promise.resolve();
              hasMore = await this.#queueNextPendingPack(seq, { autoStart: false });
            }
            if (!hasMore) this.#skipAllPacks = false;
            continue;
          }
          // SKIP consumes only this presentation. Once its release bookkeeping
          // has run, materialize the next ready pack if the queue did not
          // already contain one, and leave that next wrapper sealed.
          if (result === 'skip-pack' && this.#queue.length === 0) {
            await Promise.resolve();
            await this.#queueNextPendingPack(seq, { autoStart: false });
          }
        }
      }
    } catch (_e) {
      // Never let a reveal error strand the scroll lock.
      this.#emitPackAbort([this.#currentSequence, ...this.#queue]);
      this.#emitLootboxAbort([this.#currentSequence, ...this.#queue]);
      this.#aborted = true;
      this.#queue = [];
    } finally {
      this.#hideAll();
      if (backdrop) backdrop.hidden = true;
      try { unlockScroll(); } catch (_e) { /* defensive */ }
      this.#running = false;
      this.#currentSequence = null;
      this.#openAllBatchId = null;
      this.#openAllPacks = false;
      this.#skipAllPacks = false;
      this.#packHistory = [];
      if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function'
        && typeof CustomEvent === 'function') {
        try {
          document.dispatchEvent(new CustomEvent(REVEAL_OVERLAY_IDLE_EVENT, {
            detail: { aborted: this.#aborted },
          }));
        } catch (_e) { /* background presentation must never break cleanup */ }
      }
    }
  }

  #abort() {
    this.#emitPackAbort([this.#currentSequence, ...this.#queue]);
    this.#emitLootboxAbort([this.#currentSequence, ...this.#queue]);
    this.#aborted = true;
    this.#queue = [];
    this.#currentSequence = null;
    this.#openAllBatchId = null;
    this.#openAllPacks = false;
    this.#skipAllPacks = false;
    this.#clearTimers();
    if (this.#tapResolve) { const r = this.#tapResolve; this.#tapResolve = null; r(); }
  }

  #clearPendingQueue() {
    // Tombstone the shared manifest before completion events can make a
    // controller refresh. That keeps CLEAR materially different from the X:
    // X merely closes this presentation; CLEAR retires every reminder that is
    // currently in the queue and prevents routine polling from bringing it
    // straight back.
    const clearing = dismissPendingActionItems(getPendingActions());
    const sequences = [this.#currentSequence, ...this.#queue].filter(Boolean);
    for (const seq of sequences) {
      this.#emitPackComplete(seq);
      this.#emitLootboxComplete(seq);
    }
    this.#aborted = true;
    this.#queue = [];
    this.#currentSequence = null;
    this.#openAllBatchId = null;
    this.#openAllPacks = false;
    this.#skipAllPacks = false;
    this.#clearTimers();
    if (this.#tapResolve) {
      const resolve = this.#tapResolve;
      this.#tapResolve = null;
      resolve();
    }
    void clearing.catch((error) => {
      console.warn?.('[reveal-overlay] pending clear failed', error);
    });
  }

  #emitPackComplete(seq) {
    const release = seq?.packRelease;
    if (!release || typeof document === 'undefined' || typeof document.dispatchEvent !== 'function'
      || typeof CustomEvent !== 'function') return;
    try {
      document.dispatchEvent(new CustomEvent(PACK_REVEAL_COMPLETE_EVENT, {
        detail: {
          ...release,
          ...(seq?.foilPack ? { foilPack: true } : {}),
          cardIndexes: [...release.cardIndexes],
          ...(release.itemKeys ? { itemKeys: [...release.itemKeys] } : {}),
        },
      }));
    } catch (_e) { /* presentation bookkeeping must never break the overlay */ }
  }

  #emitPackAbort(sequences) {
    if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function'
      || typeof CustomEvent !== 'function') return;
    const releases = (Array.isArray(sequences) ? sequences : [])
      .map((seq) => seq?.packRelease)
      .filter(Boolean)
      .map((release) => ({
        ...release,
        cardIndexes: [...release.cardIndexes],
        ...(release.itemKeys ? { itemKeys: [...release.itemKeys] } : {}),
      }));
    if (releases.length === 0) return;
    try {
      document.dispatchEvent(new CustomEvent(PACK_REVEAL_ABORT_EVENT, {
        detail: { releases },
      }));
    } catch (_e) { /* presentation bookkeeping must never break the overlay */ }
  }

  #emitLootboxComplete(seq) {
    if (seq?.kind !== 'lootbox'
      || typeof document === 'undefined' || typeof document.dispatchEvent !== 'function'
      || typeof CustomEvent !== 'function') return;
    const release = seq?.lootboxRelease;
    try {
      document.dispatchEvent(new CustomEvent(LOOTBOX_REVEAL_COMPLETE_EVENT, {
        detail: {
          ...(release || {}),
          presentationId: seq.presentationId == null ? null : String(seq.presentationId),
        },
      }));
    } catch (_e) { /* presentation bookkeeping must never break the overlay */ }
  }

  #emitLootboxAbort(sequences) {
    if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function'
      || typeof CustomEvent !== 'function') return;
    const releases = (Array.isArray(sequences) ? sequences : [])
      .map((seq) => seq?.lootboxRelease)
      .filter(Boolean)
      .map((release) => ({ ...release }));
    const presentationIds = (Array.isArray(sequences) ? sequences : [])
      .filter((seq) => seq?.kind === 'lootbox' && seq?.presentationId != null)
      .map((seq) => String(seq.presentationId));
    if (releases.length === 0 && presentationIds.length === 0) return;
    try {
      document.dispatchEvent(new CustomEvent(LOOTBOX_REVEAL_ABORT_EVENT, {
        detail: { releases, presentationIds },
      }));
    } catch (_e) { /* presentation bookkeeping must never break the overlay */ }
    for (const id of presentationIds) _queuedLootboxPresentationIds.delete(id);
  }

  #tap(value = 'tap') {
    if (this.#tapLocked) return;
    if (this.#tapResolve) { const r = this.#tapResolve; this.#tapResolve = null; r(value); }
  }

  // Cancellable wait: resolves after ms OR on tap/abort (whichever first).
  #wait(ms, { fixedSpeed = false } = {}) {
    return new Promise((resolve) => {
      if (this.#aborted) { resolve(); return; }
      // Degenerette applies its live slider at each reel/frame. Every other
      // reveal uses the same browser preference here, giving Pending one
      // honest global speed control without double-scaling Degenerette.
      const speed = fixedSpeed ? 1 : this.#currentSequence?.kind === 'degenerette'
        ? 1
        : readDegeneretteSpeed();
      const delay = Math.max(0, Math.round((Number(ms) || 0) / speed));
      const t = setTimeout(() => {
        this.#timers.delete(t);
        if (this.#tapResolve === resolve) this.#tapResolve = null;
        resolve();
      }, delay);
      if (t && typeof t.unref === 'function') { try { t.unref(); } catch (_e) { /* defensive */ } }
      this.#timers.add(t);
      this.#tapResolve = (v) => { clearTimeout(t); this.#timers.delete(t); resolve(v); };
    });
  }

  // A resolved coinflip is a result, not a skippable transition. Preserve the
  // close/abort path, but ignore backdrop taps and local speed preferences
  // until the normal four-second toss reaches its truthful face.
  async #waitForCoinflip(ms) {
    this.#tapLocked = true;
    try {
      await this.#wait(ms, { fixedSpeed: true });
    } finally {
      this.#tapLocked = false;
    }
  }

  // Wait for an explicit tap (no timeout) — the TAP TO OPEN gate.
  #waitTap() {
    return new Promise((resolve) => {
      if (this.#aborted) { resolve(); return; }
      this.#tapResolve = resolve;
    });
  }

  async #waitAfterSummary(seq) {
    if (seq?.kind === 'pack'
      && this.#isOpeningAll(seq)
      && this.#hasMorePacks(seq)) {
      // OPEN ALL is the player's one confirmation for the whole batch. The
      // legacy sealed-card receipt must advance just like the ticket-grid
      // path instead of presenting an enabled OPEN NEXT button elsewhere.
      await this.#wait(_reducedMotion() ? 180 : 700);
      return;
    }
    if (seq?.kind === 'lootbox'
      && seq.autoAdvance
      && this.#queue[0]?.kind === 'lootbox') {
      await this.#wait(
        _reducedMotion() ? LOOTBOX_AUTO_RESULT_REDUCED_MS : LOOTBOX_AUTO_RESULT_MS,
      );
      return;
    }
    await this.#waitTap();
  }

  #clearTimers() {
    for (const t of this.#timers) { try { clearTimeout(t); } catch (_e) { /* defensive */ } }
    this.#timers.clear();
  }

  #hideAll() {
    for (const name of ['rvl-vessel', 'rvl-card-zone', 'rvl-spin-zone', 'rvl-summary']) {
      const el = this.#bind(name);
      if (el) el.hidden = true;
    }
    const tray = this.#bind('rvl-tray');
    if (tray) tray.textContent = '';
    const openPack = this.#bind('rvl-open-pack');
    if (openPack) openPack.hidden = true;
    const openAll = this.#bind('rvl-open-all');
    if (openAll) openAll.hidden = true;
    const packActions = this.#bind('rvl-pack-actions');
    if (packActions) packActions.hidden = true;
    const stage = this.#bind('rvl-stage');
    if (stage && stage.classList) {
      stage.classList.remove(
        'rvl-charging',
        'rvl-bursting',
        'rvl-stage--degenerette',
        'rvl-stage--ticket-pack',
        'rvl-stage--single-ticket',
        'rvl-stage--single-entry',
        'rvl-stage--ticket-lesson',
        'rvl-stage--lootbox',
        'rvl-stage--auto-lootbox',
        'rvl-stage--day-summary',
        'rvl-stage--bingo',
        'rvl-stage--pari',
        'rvl-stage--foil-match',
      );
      stage.setAttribute?.('data-lootbox-value-tone', 'unknown');
    }
  }

  // -------------------------------------------------------------------------
  // Sequence player
  // -------------------------------------------------------------------------

  async #playSequence(seq) {
    this.#hideAll();
    const title = this.#bind('rvl-title');
    const rootStage = this.#bind('rvl-stage');
    const singleTicket = seq.kind === 'pack'
      && Array.isArray(seq.ticketGrid)
      && seq.ticketGrid.length === 1
      && !seq.ticketGrid[0]?.entry;
    const singleEntry = seq.kind === 'pack'
      && Array.isArray(seq.ticketGrid)
      && seq.ticketGrid.length === 1
      && Boolean(seq.ticketGrid[0]?.entry);
    if (rootStage?.classList) {
      rootStage.classList.toggle(
        'rvl-stage--degenerette',
        Boolean(seq.spinBoard && !seq.spinBoard.boxSpin),
      );
      rootStage.classList.toggle(
        'rvl-stage--ticket-pack',
        Array.isArray(seq.ticketGrid) && seq.ticketGrid.length > 0,
      );
      rootStage.classList.toggle('rvl-stage--single-ticket', singleTicket);
      rootStage.classList.toggle('rvl-stage--single-entry', singleEntry);
      rootStage.classList.toggle(
        'rvl-stage--ticket-lesson',
        Boolean(seq.ticketLesson),
      );
      rootStage.classList.toggle('rvl-stage--lootbox', seq.kind === 'lootbox');
      rootStage.classList.toggle(
        'rvl-stage--auto-lootbox',
        seq.kind === 'lootbox' && Boolean(seq.autoStart),
      );
      rootStage.classList.toggle('rvl-stage--day-summary', Boolean(seq.daySummary));
      rootStage.classList.toggle('rvl-stage--bingo', seq.kind === 'bingo');
      rootStage.classList.toggle('rvl-stage--pari', seq.kind === 'pari');
      rootStage.classList.toggle('rvl-stage--foil-match', seq.kind === 'foil-match');
      rootStage.setAttribute?.(
        'data-lootbox-value-tone',
        seq.kind === 'lootbox' ? seq.lootboxValueTone || 'unknown' : 'unknown',
      );
    }
    // boardTitle is the non-spoiler heading a spin-through plays under; the real
    // verdict lands only after every verified reel has settled.
    if (title) {
      title.hidden = Boolean(seq.hideTitle);
      title.textContent = seq.boardTitle || seq.title;
    }

    if (_reducedMotion()) {
      // Motion is optional; the full-size result and its audit trail are not.
      if (seq.spinBoard) {
        await this.#playSpinBoard(seq.spinBoard, {
          reducedMotion: true,
          sequence: seq,
          finalLabel: this.#queuedContinuationLabel(),
        });
        return;
      }
      // Reduced motion removes choreography, not the actual ticket hand.
      // Sending ticketGrid through the generic prize-card summary collapsed
      // foil packs into tiny cards and could leave half the 2×2 behind a
      // scrollbar.
      if (Array.isArray(seq.ticketGrid) && seq.ticketGrid.length > 0) {
        await this.#playTicketGrid(seq, { openingAll: this.#isOpeningAll(seq) });
        return;
      }
      // A BoxSpin is a child reward of this lootbox. Show the parent receipt
      // first (with the currency still sealed), then let the player continue
      // into each verified reel exactly once.
      const boxSpinCards = seq.cards.filter((card) => Boolean(card.spin));
      if (boxSpinCards.length > 0) {
        const playedSpin = await this.#playLootboxSpinGrant(seq, boxSpinCards, {
          reducedMotion: true,
        });
        if (playedSpin) return;
      }
      this.#renderSummary(seq, { includeFoilMatch: seq.kind === 'foil-match' });
      if (seq.consolationOnly) sfxLoserHorn();
      else if (seq.big) sfxFanfare(true);
      if (this.#isOpeningAll(seq) && this.#hasMorePacks(seq)) {
        // OPEN ALL keeps every pack bounded to nine; reduced-motion users just
        // skip the repeated confirmation between those pack summaries.
        await this.#wait(180);
        return;
      }
      if (this.#isOpeningAll(seq) && !this.#hasMorePacks(seq)) {
        this.#openAllBatchId = null;
      }
      await this.#waitAfterSummary(seq);
      return;
    }

    const stage = this.#bind('rvl-stage');
    // Hoisted: BOTH the day-results burst and the vessel burst below need it.
    // `seq.big` only says "this is a headline sequence" — it says nothing about
    // whether the player won, so gating celebration on it alone used to put a
    // win effect over a sequence of pure losses.
    const hasSpins = seq.cards.some((c) => Boolean(c.spin));
    const hasTicketGrid = Array.isArray(seq.ticketGrid) && seq.ticketGrid.length > 0;
    const allNoWin = seq.cards.every((c) => {
      if (c.type === 'nowin') return true;
      if (!c.spin) return false;
      const paid = c.spin.spinType === 'eth'
        ? _safeBigInt(c.spin.ethShare)
        : _safeBigInt(c.spin.payout);
      return paid <= 0n;
    });
    const inlineAutoPack = seq.kind === 'pack'
      && this.#isOpeningAll(seq)
      && Array.isArray(seq.ticketGrid)
      && seq.ticketGrid.length > 1
      && Number(seq.packIndex || 1) > 1;
    if (singleTicket) {
      // One resolved ticket is already the interesting object. Do not make the
      // player open a wrapper just to reach it; the large ticket surface below
      // is the complete reveal.
      sfxWarmup();
    } else if (inlineAutoPack) {
      // OPEN ALL already had its deliberate wrapper click on pack one. Keep
      // later hands on the ticket surface; #playTicketGrid supplies a small
      // ripping wrapper above the next hand instead of cutting back to the
      // full-screen sealed-pack scene.
    } else if (seq.noVessel) {
      // Day-results popup: the board already played out — no sealed vessel
      // to open. Brief title beat, protocol celebration for wins, then cards.
      sfxWarmup();
      // A spin-through celebrates at the END: an effect here would tell the
      // player they won before the first reel stops.
      if (seq.big && !seq.consolationOnly && !allNoWin
        && !seq.spinBoard && !hasSpins && !hasTicketGrid) {
        this.#celebrateWin(false);
      }
      await this.#wait(450);
      if (this.#aborted) return;
    } else {
      // --- intro: vessel in ---
      const vessel = this.#bind('rvl-vessel');
      const isPack = seq.kind === 'pack';
      const isLootbox = seq.kind === 'lootbox';
      const isFoilPack = isPack && Boolean(seq.foilPack);
      let openingAll = this.#isOpeningAll(seq);
      if (vessel) {
        vessel.hidden = false;
        vessel.setAttribute('role', 'button');
        vessel.setAttribute('tabindex', '0');
        vessel.setAttribute(
          'aria-label',
          isPack
            ? `Open ${isFoilPack ? 'foil ' : ''}ticket pack${seq.level != null ? ` for Level ${seq.level}` : ''}`
            : isLootbox ? 'Open luckbox' : 'Open reward',
        );
        vessel.setAttribute(
          'data-lootbox-value-tone',
          isLootbox ? seq.lootboxValueTone || 'unknown' : 'unknown',
        );
        vessel.setAttribute(
          'title',
          isLootbox && seq.lootboxTicketUnitsLabel
            ? `${seq.lootboxTicketUnitsLabel} ticket-price luckbox`
            : '',
        );
        if (vessel.classList) {
          vessel.classList.toggle('rvl-vessel--pack', isPack);
          vessel.classList.toggle('rvl-vessel--chest', !isPack);
          vessel.classList.toggle('rvl-vessel--lootbox', isLootbox);
          vessel.classList.toggle('rvl-vessel--foil-pack', isFoilPack);
        }
      }
      const packEdition = this.#bind('rvl-pack-edition');
      if (packEdition) packEdition.textContent = isFoilPack ? 'FOIL PACK' : 'TICKET PACK';
      const packLevel = this.#bind('rvl-pack-level');
      const packArt = this.#bind('rvl-pack');
      if (packLevel) {
        packLevel.textContent = isPack
          ? (seq.level != null ? `LEVEL ${seq.level}` : 'LEVEL —')
          : '';
        const packTone = applyTicketLevelTone(packLevel, isPack ? seq.level : null);
        packArt?.setAttribute?.('data-pack-level-tone', packTone || 'unknown');
      }
      const packCount = this.#bind('rvl-pack-count');
      if (packCount) {
        const count = seq.count ?? seq.cards[0]?.value ?? '';
        const countText = _ticketQuantityText(count);
        packCount.textContent = isPack
          ? `${countText} ${Number(count) === 1 ? 'TICKET' : 'TICKETS'}`
          : '';
      }
      const hint = this.#bind('rvl-hint');
      if (hint) {
        hint.hidden = isPack;
        hint.textContent = isPack
          ? ''
          : openingAll ? 'OPENING ALL…'
            : seq.autoStart ? ''
              : isLootbox ? 'TAP TO CRACK' : 'TAP TO OPEN';
      }
      const openPack = this.#bind('rvl-open-pack');
      const openAll = this.#bind('rvl-open-all');
      const skipPack = this.#bind('rvl-skip-pack');
      const packActions = this.#bind('rvl-pack-actions');
      if (packActions) {
        packActions.hidden = !isPack || openingAll || Boolean(seq.autoStart)
          || Boolean(seq.ticketLesson);
      }
      const canOpenAll = isPack && this.#canOpenAllPacks(seq)
        && !openingAll && !seq.autoStart;
      if (openAll) {
        openAll.hidden = !canOpenAll;
        if (canOpenAll) {
          openAll.textContent = this.#openAllPacksLabel(seq, { includeCurrent: true });
        }
      }
      if (skipPack) {
        skipPack.textContent = canOpenAll ? 'SKIP ALL' : 'SKIP';
        skipPack.setAttribute(
          'aria-label',
          canOpenAll ? 'Skip all pack reveals' : 'Skip this pack reveal',
        );
      }
      if (openPack) {
        const canOpenPack = isPack && !this.#canOpenAllPacks(seq)
          && !openingAll && !seq.autoStart && !seq.ticketLesson;
        openPack.hidden = !canOpenPack;
        if (canOpenPack) openPack.textContent = 'OPEN PACK';
      }

      if (openingAll) {
        await this.#wait(120);
      } else if (seq.autoStart) {
        await this.#wait(isLootbox ? LOOTBOX_AUTO_START_MS : 700);
      } else {
        const action = await this.#waitTap();
        if ((action === 'skip-pack' || action === 'skip-all-packs') && isPack) {
          if (packActions) packActions.hidden = true;
          return action;
        }
        openingAll = action === 'open-all' || this.#isOpeningAll(seq);
      }
      if (this.#aborted) return;
      if (packActions) packActions.hidden = true;
      sfxWarmup();
      if (openPack) openPack.hidden = true;
      if (openAll) openAll.hidden = true;

      if (openingAll) {
        // The player explicitly chose the batch fast path: keep each 3×3
        // pack as its own hand, but collapse the repeated charge animation.
        if (stage && stage.classList) stage.classList.add('rvl-bursting');
        await this.#wait(140);
      } else {
        // --- charging: lock, energy build, then the crack ---
        if (stage && stage.classList) stage.classList.add('rvl-charging');
        const chargeMs = isLootbox
          ? (seq.autoStart ? LOOTBOX_AUTO_CHARGE_MS : LOOTBOX_MANUAL_CHARGE_MS)
          : 900;
        sfxSpinStart(chargeMs);
        await this.#wait(chargeMs);
        if (this.#aborted) return;

        // --- burst ---
        if (stage && stage.classList) {
          stage.classList.remove('rvl-charging');
          stage.classList.add('rvl-bursting');
        }
        // Burst fires BEFORE the cards are turned, so it has to consult the
        // sequence's contents rather than the reveal-so-far: a big sequence whose
        // every card is a `nowin` gets the burst animation without a win seal.
        if (seq.big && !seq.consolationOnly && !allNoWin
          && !hasSpins && !hasTicketGrid && !seq.ticketLesson) {
          this.#celebrateWin(false);
        }
        if (isLootbox) sfxRollDone(true);
        const burstMs = isLootbox
          ? (seq.autoStart ? LOOTBOX_AUTO_BURST_MS : LOOTBOX_MANUAL_BURST_MS)
          : 320;
        await this.#wait(burstMs);
      }
      if (vessel) vessel.hidden = true;
      if (stage && stage.classList) stage.classList.remove('rvl-bursting');
      if (this.#aborted) return;
    }

    // --- ticket packs: the whole hand at once ---
    if (Array.isArray(seq.ticketGrid) && seq.ticketGrid.length > 0) {
      await this.#playTicketGrid(seq, { openingAll: this.#isOpeningAll(seq) });
      return;
    }

    // Bingo is already one composed result: the completed 8×8 board and its
    // FLIP/sDGNRS payouts explain each other. Land them together on the final
    // receipt instead of dealing those same three objects individually first.
    if (seq.kind === 'bingo') {
      this.#renderSummary(seq);
      if (seq.big) {
        sfxFanfare(true);
        this.#celebrateWin(true);
      } else {
        sfxRollDone(true);
      }
      await this.#waitAfterSummary(seq);
      return;
    }

    // A one-card day summary used to deal the result full-size, wait for a
    // tap, then redraw the identical card in the receipt. There is nothing to
    // summarize in that case: render the settled card once with its terminal
    // action and keep multi-card summaries on the normal reveal sequence.
    if (seq.daySummary && seq.cards.length === 1) {
      this.#renderSummary(seq);
      if (seq.consolationOnly) sfxLoserHorn();
      else if (seq.big) sfxFanfare(true);
      else sfxNoWin();
      await this.#waitAfterSummary(seq);
      return;
    }

    // A side-bet result is already one complete receipt. Dealing it full-size
    // and then immediately redrawing the same card in the summary looked like
    // the bet resolved twice. Land directly on the terminal receipt instead.
    if (seq.kind === 'pari' && seq.cards.length === 1) {
      this.#renderSummary(seq);
      if (seq.unlucky) sfxNoWin();
      else if (seq.big) sfxFanfare(true);
      else sfxRollDone(true);
      await this.#waitAfterSummary(seq);
      return;
    }

    let anyWin = false;
    if (seq.spinBoard) {
      // A resolved Degenerette stays on the large reel/result surface until
      // acknowledgement. Do not collapse it back into the old 84px summary card.
      await this.#playSpinBoard(seq.spinBoard, {
        sequence: seq,
        finalLabel: this.#queuedContinuationLabel(),
      });
      return;
    }

    // A BoxSpin is always a child presentation, including when it is replayed
    // from a DAY SUMMARY. Motion mode used to special-case only a live
    // lootbox, so historical reward cards were dealt into the carry-forward
    // tray and remained underneath the full reel. Use the same receipt ->
    // isolated reel flow for every sequence that contains a BoxSpin.
    const boxSpinCards = seq.cards.filter((card) => Boolean(card.spin));
    if (boxSpinCards.length > 0) {
      const playedSpin = await this.#playLootboxSpinGrant(seq, boxSpinCards);
      if (playedSpin) return;
    }
    if (seq.kind !== 'lootbox') {
      // --- cards, one at a time ---
      for (let i = 0; i < seq.cards.length; i++) {
        if (this.#aborted) return;
        const card = seq.cards[i];
        await this.#playCard(card, i);
        if (card.spin) {
          const spinWon = await this.#playSpin(card.spin);
          anyWin = anyWin || spinWon;
        }
        this.#pushToTray(card);
      }
    }

    if (this.#aborted) return;

    // --- summary ---
    const zone = this.#bind('rvl-card-zone');
    if (zone) zone.hidden = true;
    const spinZone = this.#bind('rvl-spin-zone');
    if (spinZone) spinZone.hidden = true;
    const tray = this.#bind('rvl-tray');
    if (tray) tray.textContent = '';
    this.#renderSummary(seq);
    if (allNoWin) {
      sfxNoWin();
    } else if (seq.consolationOnly) {
      sfxLoserHorn();
    } else if (seq.big || anyWin) {
      sfxFanfare(seq.big);
      this.#celebrateWin(seq.big);
    } else {
      sfxRollDone(true);
    }
    await this.#waitAfterSummary(seq);
  }

  // One prize card: flip in, count up, beat, out.
  // A ticket pack, dealt as a hand: every ticket on screen at once, in the same
  // paper-ticket graphic the inventory uses (four badges around a flame). Foil
  // lines keep that shape and gain a shining edge, so a pack reads as tickets
  // rather than as a stack of prize cards (user call).
  async #playTicketGrid(seq, { openingAll = false } = {}) {
    const zone = this.#bind('rvl-card-zone');
    if (!zone) return;
    zone.hidden = false;
    zone.textContent = '';

    const singlePiece = seq.ticketGrid.length === 1;
    const singleEntry = singlePiece && Boolean(seq.ticketGrid[0]?.entry);
    const showLesson = Boolean(seq.ticketLesson);
    const surface = document.createElement('div');
    surface.className = (seq.foilPack
      ? 'rvl-ticket-pack-stage rvl-ticket-pack-stage--foil'
      : 'rvl-ticket-pack-stage')
      + (singlePiece ? ' rvl-ticket-pack-stage--single' : '')
      + (singleEntry ? ' rvl-ticket-pack-stage--single-entry' : '')
      + (showLesson ? ' rvl-ticket-pack-stage--lesson' : '');
    const inlineAutoPack = openingAll && !singlePiece && Number(seq.packIndex || 1) > 1;
    if (inlineAutoPack) {
      surface.classList.add('rvl-ticket-pack-stage--inline-rip');
      const rip = document.createElement('div');
      rip.className = 'rvl-auto-pack-rip';
      rip.setAttribute('aria-label', `Opening pack ${seq.packIndex} of ${seq.packCount}`);
      const pack = this.#buildRewardPack({
        foil: Boolean(seq.foilPack),
        level: seq.level,
        value: _ticketQuantityText(seq.count ?? seq.ticketGrid.length),
      });
      pack.classList.add('rvl-auto-pack-rip__pack');
      const tear = document.createElement('span');
      tear.className = 'rvl-auto-pack-rip__tear';
      const count = document.createElement('strong');
      count.className = 'rvl-auto-pack-rip__count';
      count.textContent = `PACK ${seq.packIndex}/${seq.packCount}`;
      rip.appendChild(pack);
      rip.appendChild(tear);
      rip.appendChild(count);
      surface.appendChild(rip);
    }
    zone.appendChild(surface);
    const historyIndex = this.#rememberOpenedPack(seq);
    const lessonLayout = showLesson ? document.createElement('div') : null;
    if (lessonLayout) {
      lessonLayout.className = 'rvl-ticket-lesson-layout';
      surface.appendChild(lessonLayout);
    }
    const grid = document.createElement('div');
    grid.className = (seq.foilPack
      ? 'rvl-ticket-grid-stage rvl-ticket-grid-stage--foil'
      : 'rvl-ticket-grid-stage')
      + ` ${ticketGridSizeClass(seq.ticketGrid.length)}`
      + (singlePiece ? ' rvl-ticket-grid-stage--single' : '')
      + (singleEntry ? ' rvl-ticket-grid-stage--single-entry' : '')
      + (showLesson ? ' rvl-ticket-grid-stage--lesson' : '')
      + (showLesson && !singlePiece ? ' rvl-ticket-grid-stage--lesson-stack' : '');
    (lessonLayout || surface).appendChild(grid);

    const reduced = _reducedMotion();

    // Reserve the complete hand before dealing it. Appending one ticket at a
    // time used to add whole grid rows mid-animation and shove the controls.
    // Motion-enabled tickets are concealed before insertion so the completed
    // hand cannot flash before the one-by-one deal begins.
    this.#appendSinglePackBadge(seq, grid);
    const dealt = this.#appendTicketGridPieces(seq, grid, {
      singlePiece,
      showLesson,
      queued: !reduced,
    });
    if (lessonLayout) lessonLayout.appendChild(this.#buildTicketLesson(seq));
    const footer = document.createElement('div');
    footer.className = 'rvl-ticket-footer';
    surface.appendChild(footer);

    if (inlineAutoPack && !reduced) {
      // Let the enlarged wrapper arrive and begin tearing before the first
      // ticket deals. Previously the hand appeared in the same frame as the
      // tiny pack, which made the opening beat almost impossible to read.
      await this.#wait(420);
      if (this.#aborted) return;
    }
    if (seq.extra > 0) {
      const more = document.createElement('div');
      more.className = 'rvl-ticket-more';
      more.textContent = `+${seq.extra} more in your inventory`;
      grid.appendChild(more);
    }

    for (let i = 0; i < dealt.length; i++) {
      if (this.#aborted) return;
      const { el, ticket: t } = dealt[i];
      if (!reduced) {
        // Deal one at a time so a gold-trait ticket can interrupt the hand with
        // its own hero beat instead of being buried in a simultaneous grid.
        if (el.classList) {
          el.classList.remove('rvl-paper--queued');
          el.classList.add('rvl-paper--in');
        }
        this.#sfxTickSafe(i);
        await this.#wait(70);
        if (el.classList?.contains('rvl-paper--gold')) {
          if (t.entry) await this.#playGoldEntryHit(surface, t.traitId);
          else await this.#playGoldTicketHit(surface, el, t.traitIds, t.foil);
        }
      }
    }

    if (!reduced) await this.#wait(320);
    if (this.#aborted) return;

    let loadingNext = null;
    if (openingAll) {
      // A ready per-level action materializes lazily. If the next queued hand
      // is foil, pull one ordinary ready action forward before continuing so a
      // cross-Pending OPEN ALL can never strand ordinary packs behind foil.
      const foilIsNext = this.#queue[0]?.kind === 'pack'
        && Boolean(this.#queue[0]?.foilPack);
      const ordinaryPending = this.#readyPendingPacks(seq?.packRelease)
        .some((candidate) => !candidate.foilPack);
      if (foilIsNext && ordinaryPending) {
        loadingNext = document.createElement('div');
        loadingNext.className = 'rvl-ticket-batch-status';
        loadingNext.textContent = 'Loading next pending pack…';
        footer.appendChild(loadingNext);
        await this.#queueNextPendingPack(seq, { ordinaryOnly: true });
        if (this.#aborted) return;
      }
    }
    const nextQueued = this.#queue[0];
    const hasMoreInBatch = Boolean(
      this.#hasMorePacks(seq)
      && nextQueued?.kind === 'pack'
      && nextQueued.batchId === seq.batchId,
    );
    let hasMore = hasMoreInBatch;
    if (openingAll) {
      hasMore = this.#queue[0]?.kind === 'pack';
      if (!hasMore) {
        if (!loadingNext) {
          loadingNext = document.createElement('div');
          loadingNext.className = 'rvl-ticket-batch-status';
          loadingNext.textContent = 'Loading next pending pack…';
          footer.appendChild(loadingNext);
        }
        hasMore = await this.#queueNextPendingPack(seq);
        if (this.#aborted) return;
      }
    }

    if (!openingAll || !hasMore) {
      sfxFanfare(true);
      // The dealt ticket hand is already the celebration. The protocol-wide
      // layer adds several Degenerus sigils, which read as random flashing
      // flames during a pack opening and can obscure the ticket art.
    } else {
      sfxRollDone(true);
    }

    if (openingAll && hasMore) {
      const status = loadingNext || document.createElement('div');
      status.className = 'rvl-ticket-batch-status';
      status.textContent = hasMoreInBatch
        ? `Opening pack ${Number(seq.packIndex) + 1} of ${seq.packCount}…`
        : 'Opening next pending pack…';
      if (!status.parentElement) footer.appendChild(status);
      await this.#wait(reduced ? 180 : 700);
      return;
    }
    if (loadingNext?.parentElement) loadingNext.remove();
    if (openingAll && !hasMore) {
      this.#openAllPacks = false;
      this.#openAllBatchId = null;
    }

    const actions = document.createElement('div');
    actions.className = 'rvl-ticket-actions';

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'rvl-collect-cta';
    const queuedLabel = hasMore ? null : this.#queuedContinuationLabel();
    const pendingAction = !hasMore && !queuedLabel ? this.#nextReadyPendingAction() : null;
    const terminalLabel = revealTerminalActionLabel(seq);
    next.__rvlTerminalLabel = terminalLabel;
    next.textContent = hasMore
      ? 'OPEN NEXT PACK'
      : showLesson
        ? 'GOOD LUCK'
        : queuedLabel || (pendingAction ? this.#pendingContinuationLabel(pendingAction) : terminalLabel);
    next.dataset.mode = pendingAction ? 'pending-action' : 'continue';
    next.__rvlPendingAction = pendingAction;
    next.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      if (next.dataset.mode === 'pending-action' && next.__rvlPendingAction) {
        void this.#runPendingContinuation(next.__rvlPendingAction, next, () => {
          this.#setPendingContinuation(next, this.#nextReadyPendingAction(), terminalLabel);
        });
        return;
      }
      if (hasMore) this.#armNextPack(seq);
      else this.#armQueuedContinuation();
      this.#tap(hasMore ? 'next-pack' : 'collect');
    });
    this.#appendPackHistoryControls({
      actions,
      central: next,
      surface,
      grid,
      currentIndex: historyIndex,
    });

    if (!openingAll && this.#canOpenAllPacks(seq)) {
      const openAll = document.createElement('button');
      openAll.type = 'button';
      openAll.className = 'rvl-open-all-cta';
      openAll.textContent = this.#openAllPacksLabel(seq);
      openAll.addEventListener('click', (e) => {
        try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
        this.#startOpenAll(seq);
      });
      actions.appendChild(openAll);
    }

    footer.appendChild(actions);
    await this.#waitTap();
  }

  #buildTicketLesson(seq) {
    const lesson = document.createElement('aside');
    lesson.className = 'rvl-ticket-lesson';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'rvl-ticket-lesson__eyebrow';
    eyebrow.textContent = 'YOUR FIRST PACK';

    const title = document.createElement('h2');
    title.className = 'rvl-ticket-lesson__title';
    title.setAttribute('aria-label', 'ONE TICKET = FOUR JACKPOT ENTRIES');
    for (const copy of ['ONE TICKET = FOUR', 'JACKPOT ENTRIES']) {
      const line = document.createElement('span');
      line.className = 'rvl-ticket-lesson__title-line';
      line.textContent = copy;
      title.appendChild(line);
    }

    const intro = document.createElement('p');
    intro.className = 'rvl-ticket-lesson__intro';
    intro.textContent = 'Each quadrant is one entry. These two tickets give you eight entries.';

    const facts = document.createElement('div');
    facts.className = 'rvl-ticket-lesson__facts';

    const equation = document.createElement('div');
    equation.className = 'rvl-ticket-lesson__equation';
    for (const [index, term] of [
      ['8', 'SYMBOLS', ''],
      ['8', 'COLORS', ''],
      ['64', 'TRAITS', 'is-total'],
    ].entries()) {
      if (index > 0) {
        const operator = document.createElement('b');
        operator.setAttribute('aria-hidden', 'true');
        operator.textContent = index === 1 ? '×' : '=';
        equation.appendChild(operator);
      }
      const part = document.createElement('span');
      if (term[2]) part.className = term[2];
      const value = document.createElement('strong');
      value.textContent = term[0];
      const label = document.createElement('small');
      label.textContent = term[1];
      part.appendChild(value);
      part.appendChild(label);
      equation.appendChild(part);
    }
    const equationNote = document.createElement('p');
    equationNote.textContent = '64 possible traits in every quadrant.';
    equation.appendChild(equationNote);

    const examples = document.createElement('div');
    examples.className = 'rvl-ticket-lesson__examples';
    const exampleSpecs = [
      {
        ticketIndex: 0,
        name: 'GREEN ETHEREUM',
        tier: 'COMMON COLOR',
        copy: 'Green appears on about 1 in 4 ticket rolls.',
      },
      {
        ticketIndex: 1,
        name: 'ORANGE BITCOIN',
        tier: 'RARER COLOR',
        copy: 'Orange appears on about 1 in 32 ticket rolls.',
      },
    ];
    for (const spec of exampleSpecs) {
      const example = document.createElement('div');
      example.className = 'rvl-ticket-lesson__example';
      example.dataset.example = spec.ticketIndex === 0 ? 'green-ethereum' : 'orange-bitcoin';
      const traitIds = seq.ticketGrid?.[spec.ticketIndex]?.traitIds || [];
      const traitId = traitIds.find((value) => dgnTraitIdToQSC(value).q === 0);
      const trait = dgnTraitIdToQSC(traitId ?? (spec.ticketIndex === 0 ? 22 : 47));
      const badge = document.createElement('img');
      badge.src = dgnBadgePath(trait.q, trait.sym, trait.col);
      badge.alt = spec.name;
      const copy = document.createElement('span');
      const tier = document.createElement('small');
      tier.textContent = spec.tier;
      const name = document.createElement('strong');
      name.textContent = spec.name;
      const detail = document.createElement('b');
      detail.textContent = spec.copy;
      copy.appendChild(tier);
      copy.appendChild(name);
      copy.appendChild(detail);
      example.appendChild(badge);
      example.appendChild(copy);
      examples.appendChild(example);
    }

    facts.appendChild(equation);
    facts.appendChild(examples);

    const rule = document.createElement('p');
    rule.className = 'rvl-ticket-lesson__rule';
    const rarityTitle = document.createElement('strong');
    rarityTitle.textContent = 'COLOR SHOWS RARITY.';
    const rarityCopy = document.createElement('span');
    rarityCopy.textContent = ' The symbol says what the trait is. The color says how hard it was to get on a ticket.';
    rule.appendChild(rarityTitle);
    rule.appendChild(rarityCopy);

    lesson.appendChild(eyebrow);
    lesson.appendChild(title);
    lesson.appendChild(intro);
    lesson.appendChild(facts);
    lesson.appendChild(rule);
    return lesson;
  }

  // Tick per dealt ticket, but never more than a short burst of them.
  #sfxTickSafe(i) {
    if (i < 8) {
      try { sfxTick(i); } catch (_e) { /* audio is decoration */ }
    }
  }

  async #playGoldTicketHit(surface, ticket, traitIds, foil) {
    if (!surface || !ticket || this.#aborted) return;
    const hit = document.createElement('div');
    hit.className = 'rvl-gold-hit';
    const flare = document.createElement('span');
    flare.className = 'rvl-gold-hit__flare';
    // The dealt grid ticket can be quite small (especially in a 3×3 hand).
    // Build the same complete four-quadrant ticket again as a full-screen hero
    // so the gold moment shows every trait, not an enlarged single badge.
    const heroTicket = this.#buildPaperTicket(traitIds, foil);
    heroTicket.classList?.add('rvl-gold-hit__ticket', 'rvl-paper--gold-hero');
    const label = document.createElement('strong');
    label.className = 'rvl-gold-hit__label';
    label.textContent = goldTicketLabel(traitIds);
    hit.appendChild(flare);
    hit.appendChild(heroTicket);
    hit.appendChild(label);
    const host = this.#bind('rvl-backdrop') || surface;
    host.appendChild(hit);
    try { sfxGoldTicket(); } catch (_e) { /* audio is decoration */ }
    await this.#wait(1200);
    hit.remove?.();
  }

  async #playGoldEntryHit(surface, traitId) {
    if (!surface || this.#aborted) return;
    const hit = document.createElement('div');
    hit.className = 'rvl-gold-hit rvl-gold-hit--entry';
    const flare = document.createElement('span');
    flare.className = 'rvl-gold-hit__flare';
    const heroEntry = this.#buildPaperEntry(traitId);
    heroEntry.classList?.add('rvl-gold-hit__ticket', 'rvl-gold-hit__entry', 'rvl-paper--gold-hero');
    heroEntry.querySelector('.ticket-entry-card')?.classList?.remove('tc-small');
    const label = document.createElement('strong');
    label.className = 'rvl-gold-hit__label';
    label.textContent = _goldEntryLabel(traitId);
    hit.appendChild(flare);
    hit.appendChild(heroEntry);
    hit.appendChild(label);
    const host = this.#bind('rvl-backdrop') || surface;
    host.appendChild(hit);
    try { sfxGoldTicket(); } catch (_e) { /* audio is decoration */ }
    await this.#wait(1200);
    hit.remove?.();
  }

  /**
   * The inventory's ticket graphic: 4 trait quadrants around the flame centre.
   * Same class names, so it inherits the paper styling already in app.css.
   */
  #buildPaperTicket(traitIds, foil) {
    const quads = dgnTraitIdsToQuadrants(traitIds);
    const hasGold = quads.some((trait) => trait?.col === 7);
    const wrap = document.createElement('div');
    wrap.className = `rvl-paper${foil ? ' rvl-paper--foil' : ''}${hasGold ? ' rvl-paper--gold' : ''}`;
    if (foil) {
      const shine = document.createElement('span');
      shine.className = 'rvl-paper-shine';
      wrap.appendChild(shine);
    }
    const card = document.createElement('div');
    card.className = `ticket-card tc-small${foil ? ' ticket-card--foil' : ''}`;
    applyDgnTicketAccent(card, traitIds);
    for (let q = 0; q < 4; q++) {
      const cell = document.createElement('div');
      cell.className = 'trait-quadrant';
      const t = quads[q];
      if (t) {
        if (foil) cell.setAttribute('data-trait-color', DGN_COLORS[t.col]);
        // Gold gets the metal treatment the inventory gives it.
        if (t.col === 7) cell.classList.add('trait-quadrant--gold');
        const img = document.createElement('img');
        img.src = dgnBadgePath(q, t.sym, t.col);
        img.alt = '';
        cell.appendChild(img);
      }
      card.appendChild(cell);
    }
    const center = document.createElement('div');
    center.className = 'ticket-card-center';
    const flame = document.createElement('img');
    // One guaranteed asset path; `.ticket-card--foil` supplies the silver
    // material treatment without relying on a deploy-specific second SVG.
    flame.src = '/whitepaper/flame-center.svg';
    flame.alt = '';
    center.appendChild(flame);
    card.appendChild(center);
    wrap.appendChild(card);
    return wrap;
  }

  /** One centerless quadrant, preserving the trait's position in a full ticket. */
  #buildPaperEntry(traitId) {
    const tid = _entryTraitId(traitId);
    const { q, sym, col } = dgnTraitIdToQSC(tid ?? 0);
    const wrap = document.createElement('div');
    wrap.className = `rvl-paper rvl-paper--entry${col === 7 ? ' rvl-paper--gold' : ''}`;
    wrap.setAttribute('data-quadrant', String(q));
    const card = document.createElement('div');
    card.className = 'ticket-entry-card tc-small';
    card.setAttribute('data-quadrant', String(q));
    applyDgnTicketAccent(card, [tid]);
    const cell = document.createElement('div');
    cell.className = 'trait-quadrant';
    if (col === 7) cell.classList.add('trait-quadrant--gold');
    const img = document.createElement('img');
    img.src = dgnBadgePath(q, sym, col);
    img.alt = '';
    cell.appendChild(img);
    card.appendChild(cell);
    wrap.appendChild(card);
    return wrap;
  }

  async #playCard(card, index) {
    const zone = this.#bind('rvl-card-zone');
    const spinZone = this.#bind('rvl-spin-zone');
    if (spinZone) spinZone.hidden = true;
    if (!zone) return;
    zone.textContent = '';
    zone.hidden = false;
    const el = this.#buildCard(card, false);
    zone.appendChild(el);
    sfxTick(index);
    // Let the flip-in keyframe run, then count up. A Bingo chart contains the
    // whole 8x8 entry board, so give the winning line enough time to travel
    // across all eight colors before replacing it with the payout card.
    const bingo = card.type === 'bingo';
    await this.#wait(bingo ? 520 : 360);
    if (this.#aborted) return;
    const valueEl = el.querySelector('.rvl-card-value');
    if (valueEl && card.countText) _animateCount(valueEl, card.countText, 650);
    if (card.rarity === 'epic' || card.rarity === 'legendary') sfxRollDone(true);
    // The foil comparison is the explanation for why this claim exists. It
    // used to disappear on the generic 1.15s prize-card timer, often before a
    // player could compare all four quadrants. Keep it open until an explicit
    // click/tap, with a visible control so the interaction is unambiguous.
    if (card.type === 'foil-match') {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'rvl-foil-match__continue';
      action.textContent = 'GOOD LUCK';
      action.setAttribute('aria-label', 'Continue from the foil match comparison');
      action.addEventListener('click', (event) => {
        try { event.stopPropagation(); } catch (_e) { /* fakeDOM */ }
        this.#tap('foil-match-continue');
      });
      (el.querySelector('.rvl-card-inner') || el).appendChild(action);
      await this.#waitTap();
      return;
    }
    await this.#wait(card.spin ? 650 : bingo ? 2600 : 1150);
  }

  // BoxSpin sub-stage. The event already contains every verified reel and
  // score, so it runs through the same full eight-lock presentation as a
  // standalone Degenerette bet. Money remains group-level: a three-reel FLIP
  // BoxSpin exposes one final payout, never three fictional row payouts.
  async #playSpin(spin) {
    const zone = this.#bind('rvl-card-zone');
    if (zone) zone.hidden = true;
    const board = buildBoxSpinBoard(spin);
    if (!board) return false;
    return this.#playSpinBoard(board);
  }

  async #playLootboxSpinGrant(seq, spinCards, { reducedMotion = false } = {}) {
    const boards = (Array.isArray(spinCards) ? spinCards : [])
      .map((card) => buildBoxSpinBoard(card?.spin))
      .filter(Boolean);
    if (boards.length === 0) return false;

    // This parent reveal names the granted BOX SPIN while keeping its
    // denomination and outcome hidden. The next screen is the one actual
    // spin, not a replay of a result already shown here.
    this.#renderSummary(seq, {
      spinGrant: true,
      spinCount: boards.length,
      includeFoilMatch: reducedMotion && seq.kind === 'foil-match',
    });
    await this.#waitTap();
    if (this.#aborted) return true;
    const summary = this.#bind('rvl-summary');
    if (summary) summary.hidden = true;

    for (let i = 0; i < boards.length; i++) {
      const isLast = i === boards.length - 1;
      await this.#playSpinBoard(boards[i], {
        reducedMotion,
        sequence: isLast ? seq : null,
        finalLabel: isLast ? this.#queuedContinuationLabel() : 'NEXT SPIN ▸',
      });
      if (this.#aborted) return true;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Degenerette bet reveal.
  //
  // Motion users get the full standalone-style two-token spin below. Reduced
  // motion lands the same large stage immediately; only the choreography goes.
  // -------------------------------------------------------------------------

  #dgnAnimationProfile() {
    // The standalone game runs roughly 150–250ms per token frame. Never speed
    // the reel up just because the bet contains more spins. Standalone players
    // can opt into AUTOSPIN or SKIP TO RESULTS; BoxSpin always keeps every
    // mystery-currency gate manual.
    return { idleMin: 2, idleMax: 4, cadence: 160 };
  }

  #scaledDgnDelay(rendered, milliseconds) {
    const multiplier = Math.max(0.5, Math.min(3, Number(
      rendered?.speedState?.multiplier ?? 1,
    ) || 1));
    return Math.max(16, Math.round(Number(milliseconds || 0) / multiplier));
  }

  #formatDgnAmount(board, amount) {
    return board.currency === 0 ? _ethText(amount) : _tokenText(amount);
  }

  #boxSpinAmountText(board, amount, approximate = false) {
    const value = this.#formatDgnAmount(board, amount);
    return `${approximate ? '≈' : ''}${value} ${board.unit}`;
  }

  #boxSpinRowPresentation(row, board, currencyRevealed) {
    const won = boxSpinScorePays(row?.score);
    const number = `#${Number(row?.spinIndex ?? 0) + 1}`;
    const hero = board?.heroIdx != null && Number.isInteger(Number(board.heroIdx))
      ? dgnUnpackTicket(row?.playerTraits)?.[Number(board.heroIdx) & 3]
      : null;
    const houseHero = hero && row?.houseTraits != null
      ? dgnUnpackTicket(row.houseTraits)?.[Number(board.heroIdx) & 3]
      : null;
    const heroPoints = hero && houseHero && hero.sym === houseHero.sym
      ? 2 + (hero.col === houseHero.col ? 1 : 0)
      : 0;
    const heroText = heroPoints > 0 ? `HERO +${heroPoints}` : '';
    if (!currencyRevealed) {
      return {
        won,
        className: won || Number(row?.score) > 0 ? 'is-score' : 'is-miss',
        chip: `${number} · ${Number(row?.score) > 0 ? `S ${row.score}` : 'MISS'}${
          heroText ? ` · ${heroText}` : ''
        }`,
        pop: Number(row?.score) > 0
          ? `SCORE ${row.score}${heroText ? ` · ${heroText}` : ''}`
          : 'NO MATCH',
      };
    }
    if (!won) {
      return {
        won: false,
        className: 'is-miss',
        chip: `${number} · MISS${Number(row?.score) > 0 ? ` · S ${row.score}` : ''}`,
        pop: 'NO PAYOUT',
      };
    }
    const preview = _safeBigInt(row?.previewPayout);
    const amount = preview > 0n
      ? this.#boxSpinAmountText(board, preview, row?.previewApproximate === true)
      : '';
    return {
      won: true,
      className: 'is-win',
      chip: `${number} · WIN${heroText ? ` · ${heroText}` : ''}${
        amount ? ` · ${amount}` : ` · S ${row.score}`
      }`,
      pop: `${heroText ? `${heroText} · ` : ''}WIN · ${amount || `S ${row.score}`}`,
    };
  }

  #refreshBoxSpinSelectors(rendered, board) {
    if (!rendered?.currencyRevealed || !board?.boxSpin) return;
    for (const selector of rendered.resultSelectors || []) {
      const presentation = this.#boxSpinRowPresentation(selector.row, board, true);
      selector.element.classList?.remove('is-score', 'is-win', 'is-miss');
      selector.element.classList?.add(presentation.className);
      selector.element.textContent = presentation.chip;
      selector.element.setAttribute?.(
        'aria-label',
        `Show reel ${Number(selector.row.spinIndex) + 1}: ${presentation.pop}`,
      );
    }
    this.#syncFullSpinSelection(rendered);
  }

  #syncBoxSpinPayoutMeter(rendered, board, revealedCount = 0) {
    const meter = rendered?.boxPayoutMeter;
    if (!meter || !board?.boxSpin || !rendered.currencyRevealed) return;
    const count = Math.max(0, Math.min(board.rows.length, Number(revealedCount) || 0));
    rendered.boxReelsRevealed = Math.max(Number(rendered.boxReelsRevealed) || 0, count);
    const revealed = board.rows.slice(0, rendered.boxReelsRevealed);
    const winningRows = revealed.filter((row) => boxSpinScorePays(row.score));
    const built = winningRows.reduce((sum, row) => sum + _safeBigInt(row.previewPayout), 0n);
    const remaining = Math.max(0, board.rows.length - rendered.boxReelsRevealed);
    meter.hidden = false;
    meter.classList?.toggle('is-win', winningRows.length > 0);
    if (winningRows.length === 0) {
      rendered.boxPayoutLabel.textContent = 'PAYOUT BUILT';
      rendered.boxPayoutValue.textContent = `0 ${board.unit}`;
      rendered.boxPayoutDetail.textContent = remaining > 0
        ? `${remaining} REEL${remaining === 1 ? '' : 'S'} LEFT`
        : 'NO PAYOUT';
      return;
    }
    const payoutKnown = built > 0n;
    rendered.boxPayoutLabel.textContent = payoutKnown ? 'REEL PAYOUT' : 'PAYING REELS';
    rendered.boxPayoutValue.textContent = payoutKnown
      ? this.#boxSpinAmountText(
          board,
          built,
          board.payoutAtRiskApproximate === true
            || winningRows.some((row) => row.previewApproximate === true),
        )
      : (remaining > 0
          ? `${winningRows.length} SO FAR`
          : `${winningRows.length} OF ${board.rows.length}`);
    if (remaining > 0) {
      rendered.boxPayoutDetail.textContent = `${remaining} REEL${remaining === 1 ? '' : 'S'} LEFT`;
    } else if (board.survivalStage && board.survivalWinPayout > 0n) {
      rendered.boxPayoutDetail.textContent = `DOUBLE OR NOTHING · WIN ${this.#boxSpinAmountText(
        board,
        board.survivalWinPayout,
        board.payoutAtRiskApproximate === true,
      )}`;
    } else if (board.survivalStage) {
      rendered.boxPayoutDetail.textContent = 'DOUBLE OR NOTHING';
    } else {
      rendered.boxPayoutDetail.textContent = 'FINAL PAYOUT';
    }
  }

  #buildDgnFact(labelText, valueText, tone = '') {
    const fact = document.createElement('div');
    fact.className = `rvl-dgn-fact${tone ? ` ${tone}` : ''}`;
    const label = document.createElement('span');
    label.className = 'rvl-dgn-fact-label';
    label.textContent = String(labelText);
    const value = document.createElement('strong');
    value.className = 'rvl-dgn-fact-value';
    value.textContent = String(valueText);
    fact.appendChild(label);
    fact.appendChild(value);
    return fact;
  }

  #buildDgnEthWinningsFact() {
    const fact = document.createElement('div');
    fact.className = 'rvl-dgn-fact rvl-dgn-fact--eth-split is-running';
    const label = document.createElement('span');
    label.className = 'rvl-dgn-fact-label';
    label.textContent = 'WINNINGS';
    const values = document.createElement('div');
    values.className = 'rvl-dgn-eth-split';

    const makeLine = (text, append = true) => {
      const line = document.createElement('span');
      line.className = 'rvl-dgn-eth-split__line';
      const amount = document.createElement('strong');
      amount.className = 'rvl-dgn-fact-value rvl-dgn-eth-split__value';
      amount.textContent = text;
      line.appendChild(amount);
      if (append) values.appendChild(line);
      return { line, amount };
    };

    const actual = makeLine('0 ETH');
    // Do not reserve a second line for a hypothetical box. It joins the fact
    // only once the running/final split contains positive lootbox ETH.
    const lootbox = makeLine('', false);
    fact.appendChild(label);
    fact.appendChild(values);
    return {
      fact,
      values,
      actual: actual.amount,
      lootbox: lootbox.amount,
      lootboxLine: lootbox.line,
    };
  }

  #buildFullGamepiece(traits, sideLabel, heroIdx = null) {
    const el = this.#buildTicket(traits, null, sideLabel, heroIdx);
    if (el.classList) el.classList.add('rvl-gamepiece');
    const grid = el.querySelector('.rvl-ticket-grid');
    const center = document.createElement('div');
    center.className = 'rvl-gamepiece-center';
    const flame = document.createElement('img');
    flame.src = '/whitepaper/flame-center.svg';
    flame.alt = '';
    center.appendChild(flame);
    if (grid) grid.appendChild(center);
    const cells = typeof el.querySelectorAll === 'function'
      ? Array.from(el.querySelectorAll('.rvl-rq')) : [];
    const images = cells.map((cell) => cell.querySelector('img'));
    return { el, grid, center, cells, images };
  }

  #renderFullSpinStage(board, { speedEnabled = true } = {}) {
    const zone = this.#bind('rvl-spin-zone');
    if (!zone) return null;
    zone.textContent = '';
    zone.hidden = false;

    const head = document.createElement('div');
    head.className = 'rvl-spin-head';
    const headTitle = document.createElement('span');
    headTitle.className = 'rvl-spin-head__title';
    headTitle.textContent = board.currencyKnown
      ? `${board.headline || 'BOX SPIN'} · ${board.rows.length} ${board.unit} REEL${
        board.rows.length === 1 ? '' : 'S'
      }`
      : board.headline
        || `${board.rows.length} SPIN${board.rows.length === 1 ? '' : 'S'} · ${board.unit}`;
    head.appendChild(headTitle);
    // BoxSpin/foil child reels inherit the global reveal pacing through
    // #wait(). Only a full Degenerette resolver owns the visible reel slider.
    const initialSpeed = speedEnabled ? readDegeneretteSpeed() : 1;
    const speedState = { multiplier: initialSpeed };
    if (speedEnabled) {
      const speed = document.createElement('label');
      speed.className = 'rvl-dgn-speed';
      speed.title = 'Degenerette animation speed';
      const speedLabel = document.createElement('span');
      speedLabel.textContent = 'SPEED';
      const speedRange = document.createElement('input');
      speedRange.type = 'range';
      speedRange.min = '0.5';
      speedRange.max = '3';
      speedRange.step = '0.5';
      speedRange.value = String(initialSpeed);
      speedRange.setAttribute('aria-label', 'Degenerette animation speed');
      const speedValue = document.createElement('output');
      speedValue.textContent = `${initialSpeed}×`;
      const syncSpeed = ({ persist = false } = {}) => {
        speedState.multiplier = Math.max(0.5, Math.min(3, Number(speedRange.value) || 1));
        speedValue.textContent = `${speedState.multiplier}×`;
        if (persist) writeDegeneretteSpeed(speedState.multiplier);
      };
      speedRange.addEventListener('input', () => syncSpeed());
      speedRange.addEventListener('change', () => syncSpeed({ persist: true }));
      speedRange.addEventListener('pointerdown', (event) => event.stopPropagation?.());
      speedRange.addEventListener('click', (event) => event.stopPropagation?.());
      speed.appendChild(speedLabel);
      speed.appendChild(speedRange);
      speed.appendChild(speedValue);
      head.appendChild(speed);
    }
    zone.appendChild(head);

    const betFacts = document.createElement('div');
    betFacts.className = 'rvl-dgn-facts rvl-dgn-facts--bet';
    if (!board.boxSpin && board.amountPerSpin > 0n) {
      betFacts.appendChild(this.#buildDgnFact(
        'BET / SPIN',
        `${this.#formatDgnAmount(board, board.amountPerSpin)} ${board.unit}`,
      ));
    }
    if (!board.boxSpin && board.totalWager > 0n) {
      betFacts.appendChild(this.#buildDgnFact(
        'TOTAL WAGER',
        `${this.#formatDgnAmount(board, board.totalWager)} ${board.unit}`,
      ));
    }
    let runAmount = null;
    if (!board.boxSpin) {
      if (board.currency === 0) {
        runAmount = this.#buildDgnEthWinningsFact();
        betFacts.appendChild(runAmount.fact);
      } else {
        const runningFact = this.#buildDgnFact('WINNINGS', `0 ${board.unit}`, 'is-running');
        runAmount = runningFact.querySelector('.rvl-dgn-fact-value');
        betFacts.appendChild(runningFact);
      }
    }
    if (betFacts.children.length > 0) zone.appendChild(betFacts);

    const stage = document.createElement('div');
    stage.className = board.boxSpin ? 'rvl-dgn-stage rvl-dgn-stage--box' : 'rvl-dgn-stage';
    const compare = document.createElement('div');
    compare.className = 'rvl-dgn-compare';
    const pop = document.createElement('div');
    pop.className = 'rvl-dgn-roll-pop';
    const actions = document.createElement('div');
    actions.className = board.boxSpin
      ? 'rvl-dgn-actions rvl-dgn-actions--box'
      : 'rvl-dgn-actions';
    const autoCta = document.createElement('button');
    autoCta.type = 'button';
    autoCta.className = 'rvl-dgn-auto-cta';
    autoCta.textContent = 'AUTOSPIN';
    autoCta.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      this.#tap('auto');
    });
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'rvl-collect-cta rvl-dgn-spin-cta';
    cta.dataset.mode = 'spin';
    cta.textContent = board.boxSpin && !board.currencyKnown
      ? 'SPIN 1'
      : `SPIN 1 OF ${board.rows.length}`;
    cta.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      if (cta.dataset.mode === 'pending-action' && cta.__rvlPendingAction) {
        void this.#runPendingContinuation(cta.__rvlPendingAction, cta, () => {
          this.#setPendingContinuation(cta, this.#nextReadyPendingAction());
        });
        return;
      }
      if (cta.dataset.mode === 'continue') this.#armQueuedContinuation();
      this.#tap(cta.dataset.mode || 'tap');
    });
    const skipCta = document.createElement('button');
    skipCta.type = 'button';
    skipCta.className = 'rvl-dgn-skip-cta';
    skipCta.dataset.mode = 'skip';
    skipCta.textContent = 'SKIP TO RESULTS';
    skipCta.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      this.#tap(skipCta.dataset.mode === 'exit' ? 'continue' : 'skip');
    });
    if (!board.boxSpin) actions.appendChild(autoCta);
    actions.appendChild(cta);
    if (!board.boxSpin) actions.appendChild(skipCta);
    const history = document.createElement('div');
    history.className = 'rvl-dgn-history';
    const boxPayoutMeter = document.createElement('div');
    boxPayoutMeter.className = 'rvl-box-payout-meter';
    boxPayoutMeter.hidden = true;
    const boxPayoutLabel = document.createElement('span');
    boxPayoutLabel.className = 'rvl-box-payout-meter__label';
    const boxPayoutValue = document.createElement('strong');
    boxPayoutValue.className = 'rvl-box-payout-meter__value';
    const boxPayoutDetail = document.createElement('span');
    boxPayoutDetail.className = 'rvl-box-payout-meter__detail';
    boxPayoutMeter.appendChild(boxPayoutLabel);
    boxPayoutMeter.appendChild(boxPayoutValue);
    boxPayoutMeter.appendChild(boxPayoutDetail);
    stage.appendChild(compare);
    stage.appendChild(pop);
    if (board.boxSpin) stage.appendChild(boxPayoutMeter);
    stage.appendChild(actions);
    stage.appendChild(history);
    zone.appendChild(stage);
    return {
      zone, head, headTitle, stage, compare, pop, speedState,
      actions, autoCta, cta, skipCta, history, runAmount,
      boxPayoutMeter, boxPayoutLabel, boxPayoutValue, boxPayoutDetail,
      boxReelsRevealed: 0, currencyRevealed: Boolean(board.currencyKnown),
      resultSelectors: [], selectionEnabled: false, selectedSpinIndex: null,
    };
  }

  #mountFullSpinPair(rendered, row, houseTraits, board) {
    rendered.compare.textContent = '';
    const playerTraits = dgnUnpackTicket(row.playerTraits);
    const player = this.#buildFullGamepiece(playerTraits, 'YOURS', board.heroIdx);
    const vs = document.createElement('span');
    vs.className = 'rvl-spin-vs rvl-dgn-vs';
    vs.textContent = 'vs';
    const house = this.#buildFullGamepiece(houseTraits, 'HOUSE', null);
    if (row.houseTraits == null) {
      if (house.el.classList) house.el.classList.add('rvl-ticket--unknown');
    } else if (house.el.classList) {
      house.el.classList.add('rvl-ticket--rolling-full');
    }
    rendered.compare.appendChild(player.el);
    rendered.compare.appendChild(vs);
    rendered.compare.appendChild(house.el);
    const pair = {
      row, board, rendered, player, house, playerTraits,
      targetTraits: row.houseTraits == null ? null : dgnUnpackTicket(row.houseTraits),
    };
    rendered.activePair = pair;
    return pair;
  }

  #applyFullSpinFrame(pair, frame) {
    if (!pair || !frame || !pair.targetTraits) return 0;
    const dynamic = [
      'q-full', 'q-sym', 'q-col', 'q-miss', 'q-lock-hit', 'q-lock-miss',
      'q-lock-color-hit', 'q-lock-symbol-hit',
      'rvl-rq--color-locked', 'rvl-rq--symbol-locked',
    ];
    for (let q = 0; q < 4; q++) {
      const cell = pair.house.cells[q];
      let img = pair.house.images[q];
      if (!img && cell) {
        img = document.createElement('img');
        img.alt = '';
        cell.appendChild(img);
        pair.house.images[q] = img;
      }
      if (img) img.src = dgnBadgePath(q, frame.traits[q].sym, frame.traits[q].col);
      for (const sideCell of [pair.player.cells[q], cell]) {
        if (sideCell?.classList) sideCell.classList.remove(...dynamic);
      }
    }
    for (const center of [pair.player.center, pair.house.center]) {
      if (center?.classList) center.classList.remove('is-win', 'is-miss');
    }

    const finalStates = dgnScoringMatchStates(pair.playerTraits, pair.targetTraits);
    let matchingLocks = 0;
    for (let q = 0; q < 4; q++) {
      const colorLocked = Boolean(frame.lockedColors[q]);
      const symbolLocked = Boolean(frame.lockedSymbols[q]);
      if (colorLocked && pair.playerTraits[q].col === pair.targetTraits[q].col) matchingLocks += 1;
      if (symbolLocked && pair.playerTraits[q].sym === pair.targetTraits[q].sym) matchingLocks += 1;
      let state = '';
      if (colorLocked && symbolLocked) {
        state = `q-${finalStates[q]}`;
      } else if (colorLocked) {
        state = pair.playerTraits[q].col === pair.targetTraits[q].col
          ? 'q-lock-color-hit' : 'q-lock-miss';
      } else if (symbolLocked) {
        state = pair.playerTraits[q].sym === pair.targetTraits[q].sym
          ? 'q-lock-symbol-hit' : 'q-lock-miss';
      }
      for (const sideCell of [pair.player.cells[q], pair.house.cells[q]]) {
        if (state && sideCell?.classList) sideCell.classList.add(state);
      }
      if (colorLocked && pair.house.cells[q]?.classList) {
        pair.house.cells[q].classList.add('rvl-rq--color-locked');
      }
      if (symbolLocked && pair.house.cells[q]?.classList) {
        pair.house.cells[q].classList.add('rvl-rq--symbol-locked');
      }
    }
    return matchingLocks;
  }

  #settleFullSpinPair(pair) {
    const { row, board } = pair;
    if (pair.targetTraits) {
      this.#applyFullSpinFrame(pair, {
        traits: pair.targetTraits,
        lockedColors: [true, true, true, true],
        lockedSymbols: [true, true, true, true],
        lock: null,
        locksDone: 8,
      });
      if (pair.house.el.classList) {
        pair.house.el.classList.remove('rvl-ticket--rolling-full');
        pair.house.el.classList.add('rvl-ticket--landed');
      }
    }
    const hasRowPayout = typeof row.payout === 'bigint';
    const boxResultVisible = board.boxSpin && pair.rendered?.currencyRevealed === true;
    const won = boxResultVisible ? boxSpinScorePays(row.score) : hasRowPayout && row.payout > 0n;
    if (!board.boxSpin || boxResultVisible) {
      for (const center of [pair.player.center, pair.house.center]) {
        if (center?.classList) center.classList.add(won ? 'is-win' : 'is-miss');
      }
    }
  }

  #jiggleFullSpin(pair, intensity) {
    const amp = Math.min(16, 4 + intensity * 2);
    const rot = Math.min(9, 2 + intensity * 0.8);
    for (const item of [pair.player.el, pair.house.el]) {
      if (!item) continue;
      if (item.style?.setProperty) {
        item.style.setProperty('--jiggle-amp', `${amp}px`);
        item.style.setProperty('--jiggle-rot', `${rot}deg`);
      } else if (item.style) {
        item.style['--jiggle-amp'] = `${amp}px`;
        item.style['--jiggle-rot'] = `${rot}deg`;
      }
      if (item.classList) {
        item.classList.remove('rvl-dgn-jiggle');
        void item.offsetWidth;
        item.classList.add('rvl-dgn-jiggle');
      }
    }
  }

  #showFullSpinPop(rendered, row, board) {
    if (board.boxSpin) {
      const presentation = this.#boxSpinRowPresentation(
        row,
        board,
        rendered.currencyRevealed === true,
      );
      rendered.pop.textContent = presentation.pop;
      rendered.pop.className = `rvl-dgn-roll-pop ${presentation.className}`;
      if (rendered.pop.classList) {
        rendered.pop.classList.remove('is-show');
        void rendered.pop.offsetWidth;
        rendered.pop.classList.add('is-show');
      }
      return;
    }
    const won = row.payout > 0n;
    rendered.pop.textContent = won
      ? `+${this.#formatDgnAmount(board, row.payout)} ${board.unit}`
      : 'NO PAYOUT';
    rendered.pop.className = `rvl-dgn-roll-pop ${won ? 'is-win' : 'is-miss'}`;
    if (rendered.pop.classList) {
      rendered.pop.classList.remove('is-show');
      void rendered.pop.offsetWidth;
      rendered.pop.classList.add('is-show');
    }
  }

  #appendFullSpinHistory(rendered, row, board) {
    const chip = document.createElement('button');
    chip.type = 'button';
    if (board.boxSpin) {
      const presentation = this.#boxSpinRowPresentation(
        row,
        board,
        rendered.currencyRevealed === true,
      );
      chip.className = `rvl-dgn-history-chip ${presentation.className}`;
      chip.textContent = presentation.chip;
      this.#registerFullSpinSelector(rendered, chip, row, board);
      rendered.history.appendChild(chip);
      return;
    }
    const won = row.payout > 0n;
    chip.className = `rvl-dgn-history-chip ${won ? 'is-win' : 'is-miss'}`;
    const result = row.score > 0 ? `S ${row.score}` : 'MISS';
    chip.textContent = won
      ? `#${row.spinIndex + 1} · ${result} · +${this.#formatDgnAmount(board, row.payout)}`
      : `#${row.spinIndex + 1} · ${result}`;
    this.#registerFullSpinSelector(rendered, chip, row, board);
    rendered.history.appendChild(chip);
  }

  #registerFullSpinSelector(rendered, element, row, board) {
    if (!rendered || !element || !row) return;
    element.disabled = !rendered.selectionEnabled;
    const boxPresentation = board?.boxSpin
      ? this.#boxSpinRowPresentation(row, board, rendered.currencyRevealed === true)
      : null;
    element.setAttribute(
      'aria-label',
      boxPresentation
        ? `Show reel ${Number(row.spinIndex) + 1}: ${boxPresentation.pop}`
        : `Show spin ${Number(row.spinIndex) + 1}`,
    );
    element.addEventListener('click', (event) => {
      try { event.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      if (!rendered.selectionEnabled) return;
      this.#showFullSpinResult(rendered, row, board);
    });
    rendered.resultSelectors.push({ element, row });
    if (Number(rendered.selectedSpinIndex) === Number(row.spinIndex)) {
      element.classList?.add('is-selected');
    }
  }

  #syncFullSpinSelection(rendered) {
    for (const selector of rendered?.resultSelectors || []) {
      selector.element.disabled = !rendered.selectionEnabled;
      selector.element.classList?.toggle(
        'is-selected',
        Number(selector.row.spinIndex) === Number(rendered.selectedSpinIndex),
      );
    }
  }

  #showFullSpinResult(rendered, row, board) {
    if (!rendered || !row) return null;
    const pair = this.#mountFullSpinPair(
      rendered,
      row,
      row.houseTraits == null ? null : dgnUnpackTicket(row.houseTraits),
      board,
    );
    this.#settleFullSpinPair(pair);
    this.#showFullSpinPop(rendered, row, board);
    rendered.selectedSpinIndex = Number(row.spinIndex);
    this.#syncFullSpinSelection(rendered);
    return pair;
  }

  #enableFullSpinSelection(rendered) {
    if (!rendered) return;
    rendered.selectionEnabled = true;
    this.#syncFullSpinSelection(rendered);
  }

  async #appendBoxSpinCurrencyReveal(rendered, board, reducedMotion, {
    interstitial = false,
  } = {}) {
    if (!board.boxSpin || this.#aborted) return;
    const currencyKey = DGN_CARD_TYPES[board.currency] || 'flip';
    const flipContinues = board.currency === 1 && board.rows.length > 1;
    const reveal = document.createElement('div');
    reveal.className = `rvl-box-currency-reveal rvl-box-currency-reveal--${currencyKey}`;
    reveal.setAttribute('data-currency', board.unit);
    reveal.setAttribute('aria-live', 'polite');

    const icon = document.createElement('div');
    icon.className = 'rvl-box-currency-icon';
    const coin = document.createElement('span');
    coin.className = [
      'rvl-box-currency-coin',
      `rvl-box-currency-coin--${currencyKey}`,
      'df-coin3d__inner',
    ].join(' ');
    // ETH and FLIP both land on the rotor's back-facing side, so loading the
    // destination art there up front put the FLIP flame on screen at every one
    // of the track's half-turns. Seeing it even once settled the currency
    // several seconds early, and seeing the ETH face instead ruled FLIP out —
    // the plane leaked the answer whichever way it fell. Spin one neutral back
    // for all three outcomes and install the real art later.
    const faces = appendCoinFaces(coin, {
      frontSrc: ICONS.wwxrp,
      backSrc: ICONS.ethFace,
    });
    // Only a FLIP result changes this plane. Decode the flame now so the swap
    // at the boundary cannot land on an unpainted frame.
    if (board.currency === 1) _preloadImage(ICONS.flip);
    icon.appendChild(coin);

    const eyebrow = document.createElement('span');
    eyebrow.className = 'rvl-box-currency-eyebrow';
    eyebrow.textContent = 'CURRENCY FLIP';
    const name = document.createElement('strong');
    name.className = 'rvl-box-currency-name';
    name.textContent = '?';
    const sub = document.createElement('span');
    sub.className = 'rvl-box-currency-sub';
    sub.textContent = 'ETH · WWXRP · FLIP';

    reveal.appendChild(icon);
    reveal.appendChild(eyebrow);
    reveal.appendChild(name);
    reveal.appendChild(sub);
    rendered.stage.appendChild(reveal);

    if (!reducedMotion) {
      const revealSpeed = Math.max(0.5, Math.min(3, Number(readDegeneretteSpeed()) || 1));
      const landingBaseMs = 700;
      const trackMs = Math.max(1, Math.round(
        (BOX_CURRENCY_FLIP_MS - landingBaseMs) / revealSpeed,
      ));
      const endingMs = Math.max(1, Math.round(landingBaseMs / revealSpeed));
      const flipMs = trackMs + endingMs;
      if (typeof coin.style?.setProperty === 'function') {
        coin.style.setProperty('--df-track-duration', `${trackMs}ms`);
        coin.style.setProperty('--df-ending-duration', `${endingMs}ms`);
      } else if (coin.style) {
        coin.style['--df-track-duration'] = `${trackMs}ms`;
        coin.style['--df-ending-duration'] = `${endingMs}ms`;
      }
      reveal.classList?.add('is-flipping');
      coin.classList?.add(
        'df-reveal-active',
        'df-reveal-track--comet',
        board.currency === 3 ? 'df-reveal-ending--loss' : 'df-reveal-ending--win',
      );
      sfxSpinStart(flipMs);
      // Preserve the truthful, non-skippable landing while honoring the
      // player's chosen animation pace exactly once.
      await this.#waitForCoinflip(trackMs);
      if (this.#aborted) return;
      // The track ends on rotateX(2070deg) — an exact multiple of 90 that is
      // not a multiple of 180, so the surface is edge-on and the back plane
      // occupies zero pixels. Repainting it here is invisible, and the ending
      // keyframes then carry the coin through one last WWXRP pass before the
      // back face arrives at 2340deg. A FLIP flame can therefore only ever be
      // seen on the final turn, and only when FLIP is the actual result.
      if (board.currency === 1 && faces?.backImage) faces.backImage.src = ICONS.flip;
      await this.#waitForCoinflip(endingMs);
      if (this.#aborted) return;
    }

    const landedImage = document.createElement('img');
    landedImage.className = 'rvl-box-currency-landed';
    landedImage.src = board.currency === 0
      ? ICONS.ethFace
      : (ICONS[currencyKey] || ICONS.flip);
    landedImage.alt = '';
    icon.textContent = '';
    icon.appendChild(landedImage);
    name.textContent = board.unit;
    sub.textContent = flipContinues
      ? `${board.rows.length - 1} MORE FLIP SPINS`
      : 'CURRENCY REVEALED';
    reveal.classList?.remove('is-flipping');
    if (reveal.classList) reveal.classList.add('is-revealed');
    if (rendered.headTitle) {
      rendered.headTitle.textContent = `${board.unit} BOX SPIN · ${board.rows.length} REEL${
        board.rows.length === 1 ? '' : 'S'
      }`;
    }
    // Currency is the information gate. Only now may an S2+ reel become an
    // explicit WIN and carry a denominated amount in the board/history UI.
    rendered.currencyRevealed = true;
    this.#refreshBoxSpinSelectors(rendered, board);
    if (rendered.activePair) {
      this.#settleFullSpinPair(rendered.activePair);
      // The live popout is not one of the registered history selectors. It
      // used to remain frozen on the pre-currency SCORE/WIN copy while the
      // history chip beside it correctly changed to the actual payout.
      this.#showFullSpinPop(rendered, rendered.activePair.row, board);
    }
    this.#syncBoxSpinPayoutMeter(
      rendered,
      board,
      Math.max(1, Number(rendered.boxReelsRevealed) || 0),
    );
    // This sound confirms the currency lock, not the eventual wager outcome.
    sfxRollDone(true);
    if (!reducedMotion) {
      await this.#wait(this.#scaledDgnDelay(
        rendered,
        BOX_CURRENCY_RESULT_MS + (interstitial ? 240 : 0),
      ));
    }
    if (interstitial && !this.#aborted) {
      reveal.classList?.add('is-leaving');
      if (!reducedMotion) await this.#wait(this.#scaledDgnDelay(rendered, 220));
      reveal.hidden = true;
      reveal.remove?.();
    }
    if (rendered.activePair && !this.#aborted && !reducedMotion) {
      this.#showFullSpinPop(rendered, rendered.activePair.row, board);
    }
  }

  async #appendFullSpinSurvival(rendered, board, reducedMotion) {
    const hasResult = board.survived === true || board.survived === false;
    // No preliminary payout means there was no survival flip. Move directly
    // to the verdict instead of rendering a disabled gate for a nonexistent
    // contract draw.
    if (!hasResult) return;
    if (this.#aborted) return;
    const flipEl = document.createElement('div');
    flipEl.className = 'rvl-survival';
    flipEl.setAttribute('aria-live', 'polite');

    const eyebrow = document.createElement('span');
    eyebrow.className = 'rvl-survival-eyebrow';
    eyebrow.textContent = 'SURVIVAL FLIP';

    const arena = document.createElement('div');
    arena.className = 'rvl-survival-arena';
    const shell = document.createElement('span');
    shell.className = 'rvl-survival-coin-shell';
    const coin = document.createElement('span');
    coin.className = [
      'rvl-survival-coin',
      `rvl-survival-coin--${board.survived ? 'win' : 'bust'}`,
    ].join(' ');
    // Survival owns its own single-surface rotor. It deliberately does not use
    // the shared Daily Flip rotor class: that installs its easing at higher
    // specificity, which can desynchronize these exact edge-on artwork swaps
    // and briefly project an upside-down WWXRP face.
    const coinFace = document.createElement('span');
    coinFace.className = 'rvl-survival-coin-face';
    coinFace.setAttribute('aria-hidden', 'true');
    coin.appendChild(coinFace);
    shell.appendChild(coin);
    // Preload the authoritative landing in a separate, non-transformed plane.
    // Revealing this sibling (instead of replacing a will-change compositor
    // layer) prevents a stale upside-down WWXRP frame surviving the landing.
    const landedImage = document.createElement('img');
    landedImage.className = 'rvl-survival-landed';
    landedImage.src = board.survived ? ICONS.ethFace : ICONS.wwxrp;
    landedImage.alt = board.survived
      ? 'Green ETH face — survived'
      : 'Red WWXRP face — busted';
    landedImage.decoding = 'sync';
    landedImage.hidden = true;
    shell.appendChild(landedImage);
    arena.appendChild(shell);
    const resultMark = document.createElement('span');
    resultMark.className = 'rvl-survival-result-mark';
    resultMark.setAttribute('aria-hidden', 'true');
    resultMark.hidden = true;
    arena.appendChild(resultMark);

    const label = document.createElement('span');
    label.className = 'rvl-survival-label';
    label.textContent = 'DOUBLE OR NOTHING';
    const detail = document.createElement('span');
    detail.className = 'rvl-survival-detail';
    const atRisk = board.boxSpin ? _safeBigInt(board.payoutAtRisk) : _safeBigInt(board.spinSum);
    const payingReels = board.rows.filter((row) => boxSpinScorePays(row.score)).length;
    const payingReelsText = `${payingReels} PAYING REEL${payingReels === 1 ? '' : 'S'}`;
    const reelResultText = board.boxSpin
      ? (atRisk > 0n
          ? `${board.payoutAtRiskApproximate ? '≈' : ''}${_tokenText(atRisk)} FLIP FROM REELS`
          : payingReelsText)
      : `${_tokenText(atRisk)} FLIP AT RISK`;
    const survivalWin = board.boxSpin ? _safeBigInt(board.survivalWinPayout) : atRisk * 2n;
    detail.textContent = survivalWin > 0n
      ? `${reelResultText} · WIN ${board.boxSpin
          ? this.#boxSpinAmountText(board, survivalWin, board.payoutAtRiskApproximate === true)
          : `${_tokenText(survivalWin)} FLIP`}`
      : `${reelResultText} · DOUBLE OR NOTHING`;

    flipEl.appendChild(eyebrow);
    flipEl.appendChild(arena);
    flipEl.appendChild(label);
    flipEl.appendChild(detail);
    rendered.stage.appendChild(flipEl);

    if (!reducedMotion) {
      flipEl.classList?.add('is-flipping');
      coin.classList?.add(
        'df-reveal-active',
        'df-reveal-track--comet',
        board.survived ? 'df-reveal-ending--win' : 'df-reveal-ending--loss',
      );
      sfxSpinStart(SURVIVAL_FLIP_MS);
      await this.#waitForCoinflip(SURVIVAL_FLIP_MS);
      if (this.#aborted) return;
    }
    coin.classList?.remove(
      'df-reveal-active',
      'df-reveal-track--comet',
      'df-reveal-ending--win',
      'df-reveal-ending--loss',
    );
    coin.hidden = true;
    if (coin.style) {
      coin.style.animation = 'none';
      coin.style.transform = 'none';
      coin.style.display = 'none';
    }
    // The animated rotor contains the red WWXRP plane. Remove it completely
    // before exposing the authoritative static landing so Chromium cannot
    // composite that stale plane over a successful green ETH result.
    coin.remove?.();
    landedImage.hidden = false;
    resultMark.textContent = board.survived ? '✓' : '×';
    resultMark.hidden = false;
    flipEl.classList?.remove('is-flipping');
    if (flipEl.classList) flipEl.classList.add(board.survived ? 'is-win' : 'is-bust');
    // The two-faced coin's normal landing already ends on green ETH for a
    // survivor or red WWXRP for a bust; no late image swap or reversal occurs.
    eyebrow.textContent = board.survived ? 'PAYOUT KEPT' : 'PAYOUT LOST';
    label.textContent = board.survived ? 'SURVIVED' : 'BUSTED';
    detail.textContent = board.boxSpin
      ? (board.survived
          ? `${this.#formatDgnAmount(board, board.total)} ${board.unit} PAID`
          // The reels really did earn this before the coin took it. Naming the
          // amount is the whole point of the panel; falling back to a bare reel
          // count is the fail-closed branch for a stake we could not rebuild.
          : atRisk > 0n
            ? `${payingReelsText} · ${this.#boxSpinAmountText(
              board,
              atRisk,
              board.payoutAtRiskApproximate === true,
            )} LOST`
            : `${payingReelsText} · LOST ON SURVIVAL FLIP`)
      : board.survived
        ? `${_tokenText(board.spinSum)} FLIP PAID DOUBLE`
        : `${_tokenText(board.spinSum)} FLIP LOST`;
    this.#setRunningTotal(rendered, board, board.total, reducedMotion ? 0 : 600);
    if (!reducedMotion) {
      sfxRollDone(Boolean(board.survived) && shouldCelebrateDegenerette(board));
      await this.#wait(this.#scaledDgnDelay(rendered, SURVIVAL_RESULT_MS));
    }
  }

  async #finishFullSpinBoard(rendered, board, {
    reducedMotion = false,
    sequence = null,
    finalLabel = null,
    currencyRevealed = false,
    skippedToResults = false,
  } = {}) {
    if (!currencyRevealed && !board.currencyKnown && board.boxSpin) {
      await this.#appendBoxSpinCurrencyReveal(rendered, board, reducedMotion, {
        // Once the denomination lands it is copied into the board heading,
        // reel history, live result, and payout meter. Keeping the large
        // currency card below a one-reel result only duplicates that fact and
        // pushes the terminal action off-screen.
        interstitial: true,
      });
    }
    if (this.#aborted) return board.total > 0n;

    await this.#appendFullSpinSurvival(rendered, board, reducedMotion);
    if (this.#aborted) return board.total > 0n;

    const won = board.total > 0n;
    const wwxrpOnly = sequence?.wwxrpOnly === true && board.unit === 'WWXRP';
    const celebrate = !wwxrpOnly && shouldCelebrateDegenerette(board);
    // When there is no survival beat, settle the tracker on the authoritative
    // final payout. This matters for a FLIP round whose per-spin rows contain
    // hits but whose final payout is zero.
    if (board.survived == null) {
      this.#setRunningTotal(rendered, board, board.total, reducedMotion ? 0 : 600);
    }
    this.#enableFullSpinSelection(rendered);

    const totalEl = document.createElement('div');
    totalEl.className = `rvl-spin-total ${celebrate ? 'is-win' : 'is-miss'}`;
    const ethSplit = board.currency === 0 && won
      ? this.#runningEthSplit(board, board.total)
      : null;
    if (ethSplit?.lootbox > 0n) {
      // Degenerette's ETH total is gross: part is immediately claimable and
      // part has already been recirculated into the awarded Luckbox. Keep the
      // terminal receipt from calling both destinations "ETH won".
      totalEl.classList.add('rvl-spin-total--eth-split');
      const cash = document.createElement('span');
      cash.className = 'rvl-spin-total__cash';
      cash.textContent = `${this.#formatDgnAmount(board, ethSplit.actual)} ETH ${
        celebrate ? 'WON' : 'RETURNED'
      }`;
      const plus = document.createElement('span');
      plus.className = 'rvl-spin-total__separator';
      plus.textContent = '+';
      plus.setAttribute('aria-hidden', 'true');
      const lootbox = document.createElement('span');
      lootbox.className = 'rvl-spin-total__lootbox';
      lootbox.textContent = `${this.#formatDgnAmount(board, ethSplit.lootbox)} ETH LUCKBOX`;
      totalEl.appendChild(cash);
      totalEl.appendChild(plus);
      totalEl.appendChild(lootbox);
    } else {
      totalEl.textContent = wwxrpOnly
        ? (won ? `${this.#formatDgnAmount(board, board.total)} ${board.unit} · UNLUCKY` : 'UNLUCKY')
        : won
        ? `${this.#formatDgnAmount(board, board.total)} ${board.unit} ${
          celebrate ? 'WON' : 'RETURNED'
        }`
        : (board.survived === false ? 'HIT — SURVIVAL FLIP BUSTED' : 'UNLUCKY');
    }
    rendered.stage.appendChild(totalEl);

    if (sequence) {
      const title = this.#bind('rvl-title');
      if (title) title.textContent = sequence.title;
      const share = this.#buildShareButton(sequence);
      if (share) rendered.stage.appendChild(share);
      if (celebrate) {
        sfxFanfare(Boolean(sequence.big));
        this.#celebrateWin(Boolean(sequence.big));
      } else if (sequence.unlucky) {
        sfxNoWin();
      }
    }

    const pendingAction = sequence && !finalLabel && this.#queue.length === 0
      ? this.#nextReadyPendingAction(sequence?.lootboxRelease)
      : null;
    const terminalLabel = revealTerminalActionLabel(sequence, board);
    const unlucky = terminalLabel === 'UNLUCKY' && !finalLabel && !pendingAction;
    rendered.cta.__rvlTerminalLabel = terminalLabel;
    if (pendingAction) {
      this.#setPendingContinuation(rendered.cta, pendingAction, terminalLabel);
    } else {
      rendered.cta.__rvlPendingAction = null;
      rendered.cta.dataset.mode = 'continue';
      rendered.cta.textContent = finalLabel || terminalLabel;
      rendered.cta.classList?.toggle('rvl-collect-cta--unlucky', unlucky);
      rendered.cta.disabled = false;
    }
    if (rendered.autoCta) rendered.autoCta.hidden = true;
    if (!board.boxSpin && rendered.skipCta && skippedToResults) {
      // A player who used Skip keeps the exit under the same pointer once the
      // verified result lands. It is the only terminal action on that path.
      rendered.cta.hidden = true;
      rendered.skipCta.dataset.mode = 'exit';
      rendered.skipCta.textContent = 'BACK TO GAME';
      rendered.skipCta.setAttribute?.('aria-label', 'Exit Degenerette results');
      rendered.skipCta.disabled = false;
      rendered.skipCta.hidden = false;
      rendered.skipCta.classList?.add('is-result-exit');
      rendered.actions?.classList?.remove('rvl-dgn-actions--result-ready');
      rendered.actions?.classList?.add('rvl-dgn-actions--result-exit');
    } else {
      rendered.cta.hidden = false;
      if (rendered.skipCta) rendered.skipCta.hidden = true;
      if (!board.boxSpin && rendered.actions) {
        // Once every reel resolves naturally, the primary verdict or pending
        // continuation is sufficient. Do not leave a second Back to Game CTA
        // beside TAKE THE WIN, GOOD LUCK, or another Back to Game.
        rendered.actions.classList?.remove('rvl-dgn-actions--result-exit');
        rendered.actions.classList?.add('rvl-dgn-actions--result-ready');
      }
    }
    if (rendered.actions) rendered.stage.appendChild(rendered.actions);
    else rendered.stage.appendChild(rendered.cta);
    await this.#waitTap();
    return won;
  }

  async #playSettledSpinBoard(board, options) {
    const rendered = this.#renderFullSpinStage(board, { speedEnabled: false });
    if (!rendered) return board.total > 0n;
    for (const row of board.rows) this.#appendFullSpinHistory(rendered, row, board);
    const last = board.rows[board.rows.length - 1];
    const pair = this.#mountFullSpinPair(
      rendered,
      last,
      last.houseTraits == null ? null : dgnUnpackTicket(last.houseTraits),
      board,
    );
    this.#settleFullSpinPair(pair);
    rendered.selectedSpinIndex = Number(last.spinIndex);
    rendered.boxReelsRevealed = board.rows.length;
    if (board.boxSpin && rendered.currencyRevealed) {
      // Mystery spins populate this meter when their denomination interstitial
      // lands. A known-FLIP record bounty skips that interstitial, so reduced
      // motion must settle the same meter directly.
      this.#syncBoxSpinPayoutMeter(rendered, board, board.rows.length);
    }
    rendered.cta.hidden = true;
    if (rendered.autoCta) rendered.autoCta.hidden = true;
    if (rendered.skipCta) rendered.skipCta.hidden = true;
    if (!board.boxSpin) this.#setRunningTotal(rendered, board, board.spinSum, 0);
    return this.#finishFullSpinBoard(rendered, board, {
      ...options,
      reducedMotion: true,
      currencyRevealed: rendered.currencyRevealed,
    });
  }

  #preloadDgnPlans(plans) {
    if (typeof Image !== 'function') return;
    const urls = new Set();
    for (const plan of plans) {
      for (const frame of plan) {
        frame.traits.forEach((trait, q) => urls.add(dgnBadgePath(q, trait.sym, trait.col)));
      }
    }
    for (const src of urls) {
      try {
        const img = new Image();
        img.src = src;
      } catch (_e) { /* preloading is only polish */ }
    }
  }

  #renderSpinBoard(board, { locked = false } = {}) {
    const zone = this.#bind('rvl-spin-zone');
    if (!zone) return null;
    zone.textContent = '';
    zone.hidden = false;

    const head = document.createElement('div');
    head.className = 'rvl-spin-head';
    head.textContent = `${board.rows.length} SPIN${board.rows.length === 1 ? '' : 'S'} · ${board.unit} · YOUR PICK vs THE HOUSE`;
    zone.appendChild(head);

    // Running total (user ask): the point of spinning through the reels one at a
    // time is watching this climb. It sits above the board so a long board
    // scrolling under it never pushes the number off screen.
    const running = document.createElement('div');
    running.className = 'rvl-spin-running';
    const runLabel = document.createElement('span');
    runLabel.className = 'rvl-spin-running-label';
    runLabel.textContent = 'WON SO FAR';
    const runAmount = document.createElement('span');
    runAmount.className = 'rvl-spin-running-amount';
    runAmount.textContent = `0 ${board.unit}`;
    running.appendChild(runLabel);
    running.appendChild(runAmount);
    zone.appendChild(running);

    const boardEl = document.createElement('div');
    boardEl.className = 'rvl-spin-board';
    zone.appendChild(boardEl);

    const built = [];
    for (const row of board.rows) {
      const el = document.createElement('div');
      el.className = 'rvl-spin-row rvl-spin-row--board';

      const n = document.createElement('span');
      n.className = 'rvl-spin-n';
      n.textContent = String(row.spinIndex + 1);
      el.appendChild(n);

      const mine = this.#buildTicket(
        dgnUnpackTicket(row.playerTraits), null, 'YOURS', board.heroIdx,
      );
      el.appendChild(mine);

      const vs = document.createElement('span');
      vs.className = 'rvl-spin-vs';
      vs.textContent = 'vs';
      el.appendChild(vs);

      const house = row.houseTraits == null
        ? this.#buildTicket(null, null, 'HOUSE', null)
        : this.#buildTicket(dgnUnpackTicket(row.houseTraits), null, 'HOUSE', null);
      if (row.houseTraits == null && house.classList) house.classList.add('rvl-ticket--unknown');
      el.appendChild(house);

      const score = document.createElement('span');
      score.className = 'rvl-spin-score';
      el.appendChild(score);

      const payout = document.createElement('span');
      payout.className = 'rvl-spin-payout';
      el.appendChild(payout);

      boardEl.appendChild(el);
      const cells = typeof house.querySelectorAll === 'function'
        ? Array.from(house.querySelectorAll('.rvl-rq')) : [];
      const playerCells = typeof mine.querySelectorAll === 'function'
        ? Array.from(mine.querySelectorAll('.rvl-rq')) : [];
      if (!locked && row.houseTraits != null && house.classList) {
        house.classList.add('rvl-ticket--rolling');
      }
      built.push({ row, el, house, cells, playerCells, score, payout });
      if (locked) {
        const entry = built[built.length - 1];
        this.#lockSpinCells(entry);
        this.#settleSpinRow(entry, board);
      }
    }

    // A gate rather than an auto-play: the popup OFFERS the spin (user ask).
    const hint = document.createElement('div');
    hint.className = 'rvl-spin-hint';
    hint.textContent = 'TAP TO SPIN';
    hint.hidden = true;
    zone.appendChild(hint);

    return { zone, built, runAmount, hint };
  }

  // Lock the whole house reel at once (reduced motion / skip).
  #lockSpinCells(entry) {
    if (entry.house.classList) entry.house.classList.remove('rvl-ticket--rolling');
    for (const cell of entry.cells) {
      if (cell.classList) cell.classList.add('rvl-rq--locked');
    }
  }

  // Settle a row: the pick lights up where it hit, chips fill.
  #settleSpinRow(entry, board) {
    const { row, playerCells, score, payout } = entry;
    if (row.houseTraits != null) {
      const states = dgnScoringMatchStates(
        dgnUnpackTicket(row.playerTraits), dgnUnpackTicket(row.houseTraits),
      );
      playerCells.forEach((cell, q) => {
        if (cell.classList) cell.classList.add(`q-${states[q]}`);
      });
    }
    // Chip colour tracks the MONEY, not the score: the payout tables pay
    // nothing on the low end of S, so a green "S 2" next to a dash reads as a
    // contradiction.
    const won = row.payout > 0n;
    score.className = `rvl-spin-score ${won ? 'is-hit' : 'is-miss'}`;
    score.textContent = row.score > 0 ? `S ${row.score}` : 'MISS';
    payout.className = `rvl-spin-payout ${won ? 'is-win' : 'is-miss'}`;
    payout.textContent = won
      ? `+${board.currency === 0 ? _ethText(row.payout) : _tokenText(row.payout)}`
      : '—';
    if (entry.el.classList) entry.el.classList.add(won ? 'is-win' : 'is-miss');
  }

  #runningEthSplit(board, amount) {
    return projectDegeneretteEthSplit({
      gross: amount,
      total: board.total,
      lootboxEth: board.lootboxEth,
    });
  }

  // The running total, re-rendered as each spin settles.
  #setRunningTotal(rendered, board, amount, ms = 420) {
    const el = rendered.runAmount;
    if (!el) return;
    const duration = ms > 0 ? this.#scaledDgnDelay(rendered, ms) : 0;
    if (board.currency === 0 && el.actual && el.lootbox) {
      const split = this.#runningEthSplit(board, amount);
      const paint = (target, value, suffix = '') => {
        const text = `${_ethText(value)} ETH${suffix}`;
        target.classList?.toggle('is-win', value > 0n);
        if (value > 0n && duration > 0) _animateCount(target, text, duration);
        else target.textContent = text;
      };
      el.fact?.classList?.toggle('has-winnings', BigInt(amount ?? 0) > 0n);
      paint(el.actual, split.actual);
      if (split.lootbox > 0n) {
        if (!el.lootboxLine?.parentElement) el.values?.appendChild(el.lootboxLine);
        paint(el.lootbox, split.lootbox, ' LUCKBOX');
      } else {
        el.lootbox?.classList?.remove('is-win');
        if (el.lootbox) el.lootbox.textContent = '';
        if (el.lootboxLine?.parentElement) el.lootboxLine.remove();
      }
      return;
    }
    const text = `${board.currency === 0 ? _ethText(amount) : _tokenText(amount)} ${board.unit}`;
    if (amount > 0n) {
      if (el.classList) el.classList.add('is-win');
      _animateCount(el, text, duration);
    } else {
      if (el.classList) el.classList.remove('is-win');
      el.textContent = text;
    }
  }

  // Full standalone-style reveal: the entire house token keeps changing while
  // color and symbol lock independently in a seeded random order. Every spin
  // has its own explicit gate. Only standalone Degenerette exposes AUTOSPIN or
  // SKIP TO RESULTS; a mystery-currency BoxSpin must play every authored beat.
  async #playSpinBoard(board, options = {}) {
    const priorControlsOnly = this.#controlsOnly;
    const rootStage = this.#bind('rvl-stage');
    const tray = this.#bind('rvl-tray');
    const priorTrayHidden = Boolean(tray?.hidden);
    const restoreCompactStage = Boolean(
      board.boxSpin
      && rootStage?.classList
      && !rootStage.classList.contains('rvl-stage--degenerette')
    );
    if (restoreCompactStage) rootStage.classList.add('rvl-stage--degenerette');
    // The full reel is a focused game surface, never another item in the
    // receipt stack. This also protects callers that do not use the normal
    // parent-summary path from leaking previously dealt cards below it.
    if (tray) tray.hidden = true;
    this.#controlsOnly = true;
    try {
      if (options.reducedMotion) return await this.#playSettledSpinBoard(board, options);
      const count = board.rows.length;
      const profile = this.#dgnAnimationProfile();
      const plans = board.rows.map((row) => row.houseTraits == null ? [] : (
        buildDegeneretteSpinFrames({
          playerTraits: row.playerTraits,
          houseTraits: row.houseTraits,
          spinIndex: row.spinIndex,
          idleMin: profile.idleMin,
          idleMax: profile.idleMax,
        })
      ));
      this.#preloadDgnPlans(plans);

      // A BoxSpin is a child of the lootbox sequence, whose #wait() already
      // applies the shared reveal preference. Giving that child its own local
      // multiplier as well turns 2× into 4×. Only a standalone Degenerette
      // resolution owns and applies the local speed control.
      const rendered = this.#renderFullSpinStage(board, { speedEnabled: !board.boxSpin });
      if (!rendered) return board.total > 0n;
      const firstRow = board.rows[0];
      let pair = this.#mountFullSpinPair(
        rendered,
        firstRow,
        plans[0][0]?.traits ?? (
          firstRow.houseTraits == null ? null : dgnUnpackTicket(firstRow.houseTraits)
        ),
        board,
      );

      let running = 0n;
      let skipped = false;
      let autoSpinning = false;
      let usedAutoSpin = false;
      let autoPauseMs = 420;
      let completed = 0;
      let currencyRevealed = rendered.currencyRevealed;
      const allowAcceleration = !board.boxSpin;
      const acceptedActions = allowAcceleration ? ['spin', 'skip'] : ['spin'];
      for (let i = 0; i < count; i++) {
        const row = board.rows[i];
        const plan = plans[i];
        const countIsRevealed = !board.boxSpin || currencyRevealed || i > 0;
        rendered.cta.dataset.mode = 'spin';
        rendered.cta.textContent = countIsRevealed
          ? `SPIN ${i + 1} OF ${count}`
          : 'SPIN 1';
        rendered.cta.disabled = false;
        rendered.cta.hidden = autoSpinning;
        rendered.autoCta.hidden = !allowAcceleration;
        rendered.autoCta.disabled = !allowAcceleration;
        rendered.autoCta.textContent = autoSpinning ? 'STOP AUTO' : 'AUTOSPIN';
        if (rendered.autoCta.classList) {
          rendered.autoCta.classList.toggle('is-active', autoSpinning);
        }
        rendered.skipCta.hidden = !allowAcceleration || autoSpinning;
        rendered.skipCta.disabled = !allowAcceleration;

        let action = null;
        while (!this.#aborted && !acceptedActions.includes(action)) {
          if (autoSpinning) {
            const queuedAction = await this.#wait(this.#scaledDgnDelay(rendered, autoPauseMs));
            if (queuedAction === 'skip') {
              action = 'skip';
            } else if (queuedAction === 'auto') {
              // STOP AUTO takes effect between reels. Keep the already-settled
              // ticket on screen and restore the manual middle control without
              // starting another spin behind the player's back.
              autoSpinning = false;
              rendered.cta.hidden = false;
              rendered.skipCta.hidden = false;
              rendered.autoCta.textContent = 'AUTOSPIN';
              if (rendered.autoCta.classList) rendered.autoCta.classList.remove('is-active');
            } else {
              action = 'spin';
            }
          } else {
            const tapped = await this.#waitTap();
            if (allowAcceleration && tapped === 'auto') {
              autoSpinning = true;
              usedAutoSpin = true;
              rendered.cta.hidden = true;
              rendered.skipCta.hidden = true;
              rendered.autoCta.textContent = 'STOP AUTO';
              if (rendered.autoCta.classList) rendered.autoCta.classList.add('is-active');
              action = 'spin';
            } else {
              action = tapped;
            }
          }
        }
        if (this.#aborted) return board.total > 0n;
        if (action === 'skip') { skipped = true; break; }

        if (i > 0) {
          pair = this.#mountFullSpinPair(
            rendered,
            row,
            plan[0]?.traits ?? (
              row.houseTraits == null ? null : dgnUnpackTicket(row.houseTraits)
            ),
            board,
          );
        }
        rendered.cta.dataset.mode = 'busy';
        rendered.cta.disabled = true;
        rendered.cta.hidden = true;
        sfxSpinStart(Math.max(
          420,
          this.#scaledDgnDelay(rendered, plan.length * profile.cadence),
        ));

        let matchingLocks = 0;
        let matchingSoundCount = 0;
        if (row.houseTraits != null) {
          for (const frame of plan) {
            matchingLocks = this.#applyFullSpinFrame(pair, frame);
            if (frame.lock) {
              const lockMatch = degeneretteLockMatchType(
                pair.playerTraits,
                pair.targetTraits,
                frame,
              );
              if (lockMatch) {
                try {
                  sfxMatchLock(lockMatch, matchingSoundCount);
                } catch (_e) { /* audio is decoration */ }
                matchingSoundCount = Math.min(7, matchingSoundCount + 1);
              } else {
                this.#sfxTickSafe(frame.locksDone - 1);
              }
              if (shouldBobDegeneretteLock(lockMatch, matchingLocks)) {
                this.#jiggleFullSpin(pair, matchingLocks - 2);
              }
            }
            const frameAction = await this.#wait(this.#scaledDgnDelay(rendered, profile.cadence));
            if (allowAcceleration && frameAction === 'skip') { skipped = true; break; }
            if (allowAcceleration && frameAction === 'auto' && autoSpinning) {
              // Turning autospin off never interrupts the reel in motion; it
              // simply restores the manual gate for the following reel.
              autoSpinning = false;
              rendered.skipCta.hidden = false;
              rendered.autoCta.textContent = 'AUTOSPIN';
              if (rendered.autoCta.classList) rendered.autoCta.classList.remove('is-active');
            }
            if (this.#aborted) return board.total > 0n;
          }
        }
        if (skipped) break;

        this.#settleFullSpinPair(pair);
        rendered.selectedSpinIndex = Number(row.spinIndex);
        this.#appendFullSpinHistory(rendered, row, board);
        this.#showFullSpinPop(rendered, row, board);
        if (!board.boxSpin) {
          running += row.payout;
          // A miss must not replay the count animation on an unchanged value.
          if (row.payout > 0n) {
            this.#setRunningTotal(rendered, board, running, 520);
          }
        }
        const rowWon = board.boxSpin ? boxSpinScorePays(row.score) : row.payout > 0n;
        sfxRollDone(rowWon);
        autoPauseMs = autoSpinning && rowWon ? 900 : 420;
        completed = i + 1;
        if (board.boxSpin) {
          rendered.boxReelsRevealed = completed;
          if (rendered.currencyRevealed) {
            this.#syncBoxSpinPayoutMeter(rendered, board, completed);
          }
        }
        if (board.boxSpin && i === 0 && !currencyRevealed) {
          await this.#appendBoxSpinCurrencyReveal(rendered, board, false, {
            interstitial: true,
          });
          if (this.#aborted) return board.total > 0n;
          currencyRevealed = true;
        }
      }

      if (skipped) {
        if (this.#aborted) return board.total > 0n;
        // Keep the complete audit trail even on skip, but only mount the final
        // row so a 25-spin result lands immediately.
        for (let i = completed; i < count; i++) {
          this.#appendFullSpinHistory(rendered, board.rows[i], board);
        }
        const last = board.rows[count - 1];
        pair = this.#mountFullSpinPair(
          rendered,
          last,
          last.houseTraits == null ? null : dgnUnpackTicket(last.houseTraits),
          board,
        );
        this.#settleFullSpinPair(pair);
        rendered.selectedSpinIndex = Number(last.spinIndex);
        this.#showFullSpinPop(rendered, last, board);
        if (!board.boxSpin) this.#setRunningTotal(rendered, board, board.spinSum, 0);
        sfxRollDone(board.boxSpin
          ? board.rows.some((row) => boxSpinScorePays(row.score))
          : board.spinSum > 0n);
      } else if (!board.boxSpin) {
        this.#setRunningTotal(rendered, board, board.spinSum, 0);
      }
      rendered.cta.hidden = true;
      rendered.autoCta.hidden = true;
      rendered.skipCta.hidden = true;

      if (usedAutoSpin) {
        const biggest = pickBiggestSpinResult(board.rows);
        if (biggest) pair = this.#showFullSpinResult(rendered, biggest, board);
      } else {
        this.#syncFullSpinSelection(rendered);
      }

      return await this.#finishFullSpinBoard(rendered, board, {
        ...options,
        currencyRevealed,
        skippedToResults: skipped,
      });
    } finally {
      this.#controlsOnly = priorControlsOnly;
      if (tray) tray.hidden = priorTrayHidden;
      if (restoreCompactStage) rootStage.classList.remove('rvl-stage--degenerette');
    }
  }

  // -------------------------------------------------------------------------
  // DOM builders (createElement only — server data via textContent)
  // -------------------------------------------------------------------------

  #buildRewardPack(card) {
    const pack = document.createElement('div');
    pack.className = `rvl-pack rvl-reward-pack${card.foil ? ' rvl-reward-pack--foil' : ''}`;

    const shine = document.createElement('div');
    shine.className = 'rvl-pack-shine';
    pack.appendChild(shine);

    const brand = document.createElement('div');
    brand.className = 'rvl-pack-brand';
    const logo = document.createElement('img');
    logo.className = 'rvl-pack-logo';
    logo.src = '/whitepaper/flame-logo.svg';
    logo.alt = '';
    brand.appendChild(logo);
    const wordmark = document.createElement('span');
    wordmark.className = 'rvl-pack-wordmark';
    wordmark.textContent = 'DEGENERUS';
    brand.appendChild(wordmark);
    const edition = document.createElement('span');
    edition.className = 'rvl-pack-edition';
    edition.textContent = card.type === 'tickets-revealed'
      ? 'REVEALED TICKETS'
      : card.foil ? 'FOIL PACK' : 'TICKET PACK';
    brand.appendChild(edition);
    pack.appendChild(brand);

    let level = card.level == null ? NaN : Number(card.level);
    if (!Number.isFinite(level)) {
      const match = /\bLEVEL\s+(\d+)/i.exec(String(card.label || ''));
      level = match ? Number(match[1]) : NaN;
    }
    const levelTag = document.createElement('span');
    levelTag.className = 'rvl-pack-level';
    levelTag.textContent = Number.isFinite(level) ? `LEVEL ${level}` : 'PACK REWARD';
    const packTone = applyTicketLevelTone(levelTag, Number.isFinite(level) ? level : null);
    pack.setAttribute('data-pack-level-tone', packTone || 'unknown');
    pack.appendChild(levelTag);

    const rawCount = String(card.value || '').replace(/^×/, '').trim();
    const singular = Number(rawCount.replace(/,/g, '')) === 1;
    const count = document.createElement('span');
    count.className = 'rvl-pack-count';
    count.textContent = rawCount
      ? `${rawCount} ${singular ? 'TICKET' : 'TICKETS'}`
      : 'TICKET REWARD';
    pack.appendChild(count);
    return pack;
  }

  #buildRewardLootbox() {
    const box = document.createElement('div');
    box.className = 'rvl-reward-lootbox';
    const art = document.createElement('img');
    art.className = 'rvl-reward-lootbox__art';
    art.src = LOOTBOX_CASE_ART;
    art.alt = '';
    art.decoding = 'async';
    const mark = document.createElement('img');
    mark.className = 'rvl-reward-lootbox__mark';
    mark.src = '/whitepaper/flame-logo.svg';
    mark.alt = '';
    box.appendChild(art);
    box.appendChild(mark);
    return box;
  }

  #buildSdgnrsBadge() {
    const badge = document.createElement('span');
    badge.className = 'sdgnrs-badge';
    badge.setAttribute('aria-hidden', 'true');

    const frame = document.createElement('img');
    frame.className = 'sdgnrs-badge__frame';
    frame.src = ICONS.dgnrsBadge;
    frame.alt = '';
    badge.appendChild(frame);

    const mark = document.createElement('img');
    mark.className = 'sdgnrs-badge__mark';
    mark.src = ICONS.dgnrs;
    mark.alt = '';
    badge.appendChild(mark);
    return badge;
  }

  #buildFoilMatchChart(meta, compact) {
    const lineTraits = _wholeTicketTraitIds(meta?.lineTraits) || [];
    const winningTraits = _wholeTicketTraitIds(meta?.winningTraits) || [];
    const faces = Array.from({ length: 4 }, (_unused, index) => {
      const face = Number(meta?.matchFaces?.[index]);
      return face === 2 ? 2 : face === 1 ? 1 : 0;
    });
    const drawLabel = Number(meta?.drawKind) === 1 ? 'BONUS JACKPOT' : 'MAIN JACKPOT';
    const score = Math.max(0, Math.trunc(Number(meta?.score) || 0));
    const rewardFaces = Math.max(0, Math.trunc(Number(meta?.rewardFaces) || 0));
    const states = faces.map((face) => face === 2 ? 'full' : face === 1 ? 'sym' : 'miss');
    const chart = document.createElement('div');
    chart.className = `rvl-foil-match${compact ? ' rvl-foil-match--compact' : ''}`;
    chart.setAttribute('aria-label', `Foil ticket compared with the ${drawLabel.toLowerCase()}`);

    const head = document.createElement('div');
    head.className = 'rvl-foil-match__head';
    const yours = document.createElement('strong');
    yours.textContent = 'FOIL MATCH';
    const versus = document.createElement('span');
    versus.textContent = `T${score} · ${drawLabel}`;
    head.appendChild(yours);
    head.appendChild(versus);
    chart.appendChild(head);

    const compare = document.createElement('div');
    compare.className = 'rvl-foil-match__compare';
    const makeTicket = (traitIds, sideLabel, { foil = false } = {}) => {
      const traits = dgnTraitIdsToQuadrants(traitIds);
      const ticket = this.#buildFullGamepiece(traits, sideLabel, null);
      ticket.el.classList?.add(
        'rvl-foil-match__ticket',
        foil ? 'rvl-foil-match__ticket--foil' : 'rvl-foil-match__ticket--jackpot',
      );
      if (foil) {
        ticket.grid?.classList?.add('rvl-ticket-grid--foil');
      }
      ticket.cells.forEach((cell, quadrant) => {
        cell.classList?.add(`q-${states[quadrant]}`);
        if (traits[quadrant]?.col === 7) cell.classList?.add('rvl-rq--gold');
        if (!foil) return;
        const face = document.createElement('strong');
        face.className = `rvl-foil-match__face rvl-foil-match__face--q${quadrant}`;
        face.textContent = faces[quadrant] === 2 ? '+2' : faces[quadrant] === 1 ? '+1' : '0';
        cell.appendChild(face);
      });
      return ticket.el;
    };

    compare.appendChild(makeTicket(lineTraits, 'YOUR FOIL', { foil: true }));
    const vs = document.createElement('span');
    vs.className = 'rvl-foil-match__vs';
    vs.textContent = 'VS';
    compare.appendChild(vs);
    compare.appendChild(makeTicket(winningTraits, drawLabel));
    chart.appendChild(compare);

    const exact = faces.filter((face) => face === 2).length;
    const symbol = faces.filter((face) => face === 1).length;
    const miss = faces.filter((face) => face === 0).length;
    const legend = document.createElement('div');
    legend.className = 'rvl-foil-match__legend';
    for (const [kind, text] of [
      ['exact', `${exact} EXACT · +2 EACH`],
      ['symbol', `${symbol} SYMBOL · +1 EACH`],
      ['miss', `${miss} MISS`],
    ]) {
      const chip = document.createElement('span');
      chip.className = `rvl-foil-match__legend-item rvl-foil-match__legend-item--${kind}`;
      chip.textContent = text;
      legend.appendChild(chip);
    }
    chart.appendChild(legend);

    const foot = document.createElement('div');
    foot.className = 'rvl-foil-match__foot';
    const bonusTier = document.createElement('strong');
    bonusTier.textContent = `T${score} BONUS`;
    const bonus = document.createElement('span');
    bonus.textContent = rewardFaces > 0
      ? `${_groupAmountText(rewardFaces)}-FACE DEGENERETTE SPIN`
      : 'BONUS DETAILS PENDING';
    foot.appendChild(bonusTier);
    foot.appendChild(bonus);
    chart.appendChild(foot);
    return chart;
  }

  #buildBingoChart(meta, compact) {
    const quadrant = Number(meta?.quadrant) & 3;
    const winningSym = Number(meta?.sym) & 7;
    const category = DGN_QUADRANTS[quadrant];
    const symbolName = String(dgnDisplaySymbol(quadrant, winningSym)
      || `symbol ${winningSym + 1}`)
      .replace(/[_-]+/g, ' ')
      .toUpperCase();
    const counts = Array.from({ length: 64 }, (_unused, index) => (
      Math.max(0, Math.floor(Number(meta?.counts?.[index]) || 0))
    ));
    const chart = document.createElement('div');
    chart.className = `rvl-bingo-chart${compact ? ' rvl-bingo-chart--compact' : ''}`;
    chart.setAttribute('aria-label', `${symbolName} Bingo: all eight colors collected`);

    const head = document.createElement('div');
    head.className = 'rvl-bingo-chart__head';
    const title = document.createElement('strong');
    title.textContent = `LEVEL ${Number(meta?.level) || 0} · ${String(category || 'trait').toUpperCase()}`;
    const reason = document.createElement('span');
    reason.textContent = `${symbolName} BINGO · ALL 8 COLORS`;
    head.appendChild(title);
    head.appendChild(reason);
    chart.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'rvl-bingo-chart__grid';
    for (let symbolIndex = 0; symbolIndex < 8; symbolIndex += 1) {
      const winningRow = symbolIndex === winningSym;
      const row = document.createElement('div');
      row.className = `rvl-bingo-chart__row${winningRow ? ' is-bingo-row' : ''}`;
      if (winningRow) {
        row.setAttribute('aria-label', `${symbolName} Bingo line`);
      } else {
        row.setAttribute('aria-hidden', 'true');
      }
      for (let color = 0; color < 8; color += 1) {
        const count = counts[(color * 8) + symbolIndex];
        const winning = winningRow;
        const cell = document.createElement('span');
        cell.className = `rvl-bingo-chart__cell${count > 0 ? ' has' : ''}${winning ? ' is-bingo' : ''}`;
        cell.dataset.bingoColor = String(color);
        if (cell.style && typeof cell.style.setProperty === 'function') {
          cell.style.setProperty('--bingo-color-index', String(color));
        }
        const badge = document.createElement('img');
        badge.src = dgnBadgePath(quadrant, symbolIndex, color);
        badge.alt = winning ? `${symbolName} Bingo color ${color + 1}` : '';
        cell.appendChild(badge);
        if (count > 0) {
          const amount = document.createElement('span');
          amount.className = 'rvl-bingo-chart__count';
          amount.textContent = String(count);
          cell.appendChild(amount);
        }
        row.appendChild(cell);
      }
      grid.appendChild(row);
    }
    chart.appendChild(grid);
    return chart;
  }

  #buildCardSub(card, positiveResult = false) {
    const sub = document.createElement('div');
    sub.className = `rvl-card-sub${positiveResult ? ' is-win' : ''}${card.type === 'coinflip-result' ? ' rvl-card-sub--coinflip' : ''}`;
    if (card.type === 'coinflip-result' && (card.outcomeLabel || card.outcomePercent)) {
      sub.setAttribute('aria-label', card.sub);
      if (card.outcomeLabel) {
        const outcome = document.createElement('span');
        outcome.className = 'rvl-card-coinflip-outcome';
        outcome.textContent = card.outcomeLabel;
        sub.appendChild(outcome);
      }
      if (card.outcomePercent) {
        const percent = document.createElement('span');
        percent.className = 'rvl-card-coinflip-percent';
        percent.textContent = card.outcomePercent;
        sub.appendChild(percent);
      }
    } else {
      sub.textContent = card.sub;
    }
    return sub;
  }

  #buildCard(card, compact) {
    const el = document.createElement('div');
    const rarity = compact && card.revealedRarity ? card.revealedRarity : card.rarity;
    const typeClass = String(card.type || 'reward').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    el.className = `rvl-card rvl-card--${typeClass} rvl-rarity-${rarity}${compact ? ' rvl-card--mini' : ''}`;
    if (card.boonProduct) el.setAttribute('data-boon-product', card.boonProduct);
    if (card.boonStrength) el.setAttribute('data-boon-strength', card.boonStrength);
    if (card.boonTier != null) el.setAttribute('data-boon-tier', String(card.boonTier));
    if (card.boonPips) el.setAttribute('data-boon-pips', card.boonPips);
    if (card.boonDirection) el.setAttribute('data-boon-direction', card.boonDirection);
    if (card.outcome) el.className += ` rvl-card--outcome-${card.outcome}`;
    if (card.foil) el.className += ' rvl-card--foil-ticket';
    if (card.packOnly) el.className += ' rvl-card--pack-only';
    const inner = document.createElement('div');
    inner.className = 'rvl-card-inner';

    const icon = document.createElement('div');
    icon.className = 'rvl-card-icon';
    if (card.type === 'foil-match') {
      icon.className = 'rvl-card-icon rvl-card-icon--foil-match';
      icon.appendChild(this.#buildFoilMatchChart(card.foilMatch, compact));
    } else if (card.type === 'bingo') {
      icon.className = 'rvl-card-icon rvl-card-icon--bingo';
      icon.appendChild(this.#buildBingoChart(card.bingo, compact));
    } else if (card.type === 'dgnrs') {
      icon.className = 'rvl-card-icon rvl-card-icon--sdgnrs';
      icon.appendChild(this.#buildSdgnrsBadge());
    } else if (card.icon) {
      // A pile-scale FLIP prize renders as its chip pile: a wide bottom-
      // anchored lane instead of the square logo slot.
      if (card.pile) icon.className = 'rvl-card-icon rvl-card-icon--flip-pile';
      const img = document.createElement('img');
      img.src = card.icon;
      img.alt = '';
      icon.appendChild(img);
    } else if (card.glyph) {
      icon.textContent = card.glyph;
    } else if (_entryTraitId(card.entryTraitId) != null) {
      icon.className = 'rvl-card-icon rvl-card-icon--ticket-entry';
      icon.appendChild(this.#buildPaperEntry(card.entryTraitId));
    } else if (Array.isArray(card.traitIds) && card.traitIds.length > 0) {
      // A ticket whose symbols are known: show the ticket, not a pack glyph.
      // Same #buildTicket the degenerette reels use, so one decode serves both.
      // The modifier lets the 2x2 grid set the card's size — the icon slot is a
      // fixed square sized for a single glyph, which clips the ticket.
      icon.className = 'rvl-card-icon rvl-card-icon--ticket';
      icon.appendChild(this.#buildTicket(dgnTraitIdsToQuadrants(card.traitIds), null, null));
    } else if (card.type === 'tickets' || card.type === 'tickets-revealed') {
      icon.className = 'rvl-card-icon rvl-card-icon--pack';
      icon.appendChild(this.#buildRewardPack(card));
    } else if (card.type === 'lootboxes-bought') {
      icon.className = 'rvl-card-icon rvl-card-icon--lootbox';
      icon.appendChild(this.#buildRewardLootbox());
    }
    inner.appendChild(icon);

    if (Array.isArray(card.winningTraitIds) && card.winningTraitIds.length > 0) {
      const traits = document.createElement('div');
      traits.className = 'rvl-winning-traits';
      traits.setAttribute('aria-label', 'Winning jackpot traits');
      for (const traitId of card.winningTraitIds) {
        const { q, sym, col } = dgnTraitIdToQSC(traitId);
        const badge = document.createElement('img');
        badge.src = dgnBadgePath(q, sym, col);
        badge.alt = 'Winning trait';
        traits.appendChild(badge);
      }
      inner.appendChild(traits);
    }

    if (!card.packOnly) {
      const coinflipConsolation = card.type === 'coinflip-result' && card.consolationWwxrp;
      if (coinflipConsolation) {
        // A lost flip still awards WWXRP. It is a peer of the FLIP amount,
        // not a footnote or a second branded badge, so give it the same
        // typographic lane immediately above the lost stake.
        const consolation = document.createElement('div');
        consolation.className = 'rvl-card-coinflip-consolation';
        consolation.textContent = card.consolationWwxrp;
        inner.appendChild(consolation);
      }
      const value = document.createElement('div');
      value.className = 'rvl-card-value';
      // Center-stage cards start empty and count up (#playCard drives
      // _animateCount); compact tray/summary cards show the final value.
      value.textContent = (!compact && card.countText)
        ? ''
        : (compact && card.revealedValue ? card.revealedValue : (card.value || ''));
      if (card.type === 'coinflip-result' && value.textContent.length > 12) {
        value.classList.add('rvl-card-value--long');
      }
      const label = document.createElement('div');
      label.className = 'rvl-card-label';
      // BoxSpin cards remain mystery cards before the reel. Compact cards are
      // only built after the full result has been acknowledged, so the tray and
      // final receipt can safely name the revealed currency.
      label.textContent = compact && card.revealedLabel
        ? card.revealedLabel
        : (card.label || '');
      // Volume-bet receipts read as a small statement: the player's line,
      // then the actual settled ticket count, then the payout. Generic reward
      // cards retain their larger value-first hierarchy.
      if (card.labelFirst) {
        inner.appendChild(label);
        inner.appendChild(value);
      } else {
        inner.appendChild(value);
        inner.appendChild(label);
      }

      if (!compact && card.sub && !coinflipConsolation) {
        inner.appendChild(this.#buildCardSub(card));
      }
    }
    el.appendChild(inner);
    return el;
  }

  // 4-quadrant Degenerette ticket (mirrors .dgn-result-card semantics with the
  // .rvl-* palette so overlay styling stays self-contained).
  #buildTicket(traits, matchStates, sideLabel, heroIdx = null) {
    const wrap = document.createElement('div');
    wrap.className = `rvl-ticket${sideLabel === 'YOURS' ? ' rvl-ticket--yours' : ''}`;
    if (sideLabel) {
      const tag = document.createElement('span');
      tag.className = 'rvl-ticket-tag';
      tag.textContent = sideLabel;
      wrap.appendChild(tag);
    }
    const grid = document.createElement('div');
    grid.className = 'rvl-ticket-grid';
    applyDgnTicketAccent(grid, traits);
    for (let q = 0; q < 4; q++) {
      const cell = document.createElement('div');
      cell.className = 'rvl-rq';
      // The hero quadrant is the one whose symbol scores +2 — worth marking on
      // the player's side so the score reads.
      if (heroIdx === q) cell.classList.add('rvl-rq--hero');
      if (matchStates && matchStates[q]) cell.classList.add(`q-${matchStates[q]}`);
      const t = traits && traits[q];
      if (t) {
        applyDgnTraitColor(cell, t.col);
        const img = document.createElement('img');
        img.src = dgnBadgePath(q, t.sym, t.col);
        img.alt = '';
        cell.appendChild(img);
      }
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  #pushToTray(card) {
    const tray = this.#bind('rvl-tray');
    if (!tray) return;
    // Bingo and foil comparison boards are dedicated hero beats. Repeating
    // either wide chart in the tiny carry-forward tray crowds the actual
    // payout/spin off-screen; the player has already seen the comparison.
    if (card?.type === 'bingo' || card?.type === 'foil-match') return;
    tray.appendChild(this.#buildCard(card, true));
  }

  #buildShareButton(seq) {
    if (!canShareWin(seq)) return null;
    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'rvl-share-cta';
    share.textContent = 'SHARE YOUR WIN';
    share.addEventListener('click', async (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      if (share.disabled) return;
      share.disabled = true;
      share.textContent = 'BUILDING…';
      let result = 'failed';
      try { result = await shareWin(seq); } catch (_e) { /* keep 'failed' */ }
      share.disabled = false;
      share.textContent = result === 'shared' ? 'SHARED ✓'
        : result === 'downloaded' ? 'SAVED — LINK COPIED ✓'
          : result === 'cancelled' ? 'SHARE YOUR WIN'
            : 'SHARE FAILED';
    });
    return share;
  }

  #renderSummary(seq, {
    spinGrant = false,
    spinCount = 0,
    includeFoilMatch = false,
  } = {}) {
    const summary = this.#bind('rvl-summary');
    if (!summary) return;
    summary.textContent = '';
    summary.hidden = false;
    if (summary.classList) {
      summary.classList.toggle('rvl-summary--foil', Boolean(seq.foilPack));
      summary.classList.toggle('rvl-summary--bingo', seq.kind === 'bingo');
    }

    const grid = document.createElement('div');
    grid.className = `rvl-summary-grid${seq.kind === 'bingo' ? ' rvl-summary-grid--bingo' : ''}`;
    // A foil comparison already held on its own explicit GOOD LUCK frame. The
    // terminal receipt should contain its rewards, not redraw the same board.
    const summaryCards = seq.cards.filter((item) => (
      includeFoilMatch || item?.type !== 'foil-match'
    ));
    grid.setAttribute('data-card-count', String(summaryCards.length));
    for (const card of summaryCards) {
      const displayCard = spinGrant && card.spin
        ? {
            ...card,
            revealedLabel: null,
            revealedValue: null,
            revealedRarity: null,
          }
        : card;
      const el = this.#buildCard(displayCard, true);
      // Summary shows final values (no count-up placeholders).
      const valueEl = el.querySelector('.rvl-card-value');
      if (valueEl) valueEl.textContent = displayCard.revealedValue || displayCard.value || '';
      // A bet board's card is the only thing left on screen once the rows are
      // gone, so it keeps its sub line (compact cards normally drop it).
      if (!card.packOnly
          && !(card.type === 'coinflip-result' && card.consolationWwxrp)
          && (seq.spinBoard || card.summaryDetail
            || (seq.kind === 'lootbox' && (!card.spin || spinGrant)))
          && card.sub) {
        const positiveResult = card.outcome === 'win'
          || (seq.spinBoard != null && _safeBigInt(seq.spinBoard.total) > 0n);
        const inner = el.querySelector('.rvl-card-inner');
        if (inner) inner.appendChild(this.#buildCardSub(card, positiveResult));
      }
      // Spin cards show their outcome in the summary.
      if (card.spin && !spinGrant) {
        const outcome = document.createElement('div');
        const payout = _safeBigInt(card.spin.payout);
        const credited = card.spin.spinType === 'eth'
          ? _safeBigInt(card.spin.ethShare)
          : payout;
        outcome.className = `rvl-card-sub ${credited > 0n ? 'is-win' : ''}`;
        if (credited > 0n) {
          if (card.spin.spinType === 'eth') {
            outcome.textContent = `won ${_ethText(credited)} ETH`;
          } else if (card.spin.spinType === 'wwxrp') {
            outcome.textContent = `won ${_tokenText(credited)} WWXRP`;
          } else {
            const amount = `${_tokenText(credited)} FLIP`;
            outcome.classList.add('rvl-card-sub--asset');
            outcome.setAttribute('aria-label', `Won ${amount}`);
            const icon = document.createElement('img');
            icon.className = 'rvl-card-sub__asset-icon';
            icon.src = ICONS.flip;
            icon.alt = '';
            icon.setAttribute('aria-hidden', 'true');
            const value = document.createElement('span');
            value.textContent = amount;
            outcome.appendChild(icon);
            outcome.appendChild(value);
          }
        } else {
          outcome.textContent = 'no hit';
        }
        const inner = el.querySelector('.rvl-card-inner');
        if (inner) inner.appendChild(outcome);
      }
      grid.appendChild(el);
    }
    summary.appendChild(grid);

    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'rvl-collect-cta';
    if (spinGrant) {
      cta.textContent = Number(spinCount) > 1 ? `PLAY ${Number(spinCount)} SPINS` : 'PLAY SPIN';
      cta.dataset.mode = 'spin-grant';
      cta.addEventListener('click', (e) => {
        try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
        this.#tap('spin-grant');
      });
      summary.appendChild(cta);
      return;
    }
    const hasMorePacks = this.#hasMorePacks(seq);
    const openingNextPack = hasMorePacks && this.#isOpeningAll(seq);
    const readyLootboxes = seq.kind === 'lootbox'
      ? this.#readyPendingLootboxes(seq.lootboxRelease)
      : [];
    const hasMoreLootboxes = readyLootboxes.length > 0;
    const autoNextLootbox = Boolean(
      seq.kind === 'lootbox' && seq.autoAdvance && this.#queue[0]?.kind === 'lootbox'
    );
    const queuedLabel = this.#queuedContinuationLabel();
    const pendingAction = !hasMorePacks && !hasMoreLootboxes && !autoNextLootbox
      && !queuedLabel
      ? this.#nextReadyPendingAction(seq.lootboxRelease)
      : null;
    const unlucky = Boolean(
      (seq.unlucky || seq.consolationOnly)
      && !hasMorePacks
      && !hasMoreLootboxes
      && !autoNextLootbox
      && !queuedLabel
      && !pendingAction
    );
    const terminalLabel = revealTerminalActionLabel(seq);
    cta.__rvlTerminalLabel = terminalLabel;
    cta.textContent = unlucky
      ? 'UNLUCKY'
      : openingNextPack
      ? 'OPENING NEXT PACK…'
      : hasMorePacks
      ? 'OPEN NEXT PACK'
      : hasMoreLootboxes ? 'OPEN NEXT LUCKBOX'
        : autoNextLootbox ? 'OPENING NEXT LUCKBOX…'
          : queuedLabel || (pendingAction ? this.#pendingContinuationLabel(pendingAction) : terminalLabel);
    cta.classList?.toggle('rvl-collect-cta--unlucky', unlucky);
    cta.disabled = autoNextLootbox || openingNextPack;
    cta.dataset.mode = pendingAction ? 'pending-action' : 'continue';
    cta.__rvlPendingAction = pendingAction;
    cta.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      if (hasMorePacks) this.#armNextPack(seq);
      if (hasMoreLootboxes) {
        void this.#openPendingLootboxes(seq, { all: false });
        return;
      }
      if (cta.dataset.mode === 'pending-action' && cta.__rvlPendingAction) {
        void this.#runPendingContinuation(cta.__rvlPendingAction, cta, () => {
          this.#renderSummary(seq);
        });
        return;
      }
      this.#armQueuedContinuation();
      this.#tap();
    });
    summary.appendChild(cta);

    if (hasMorePacks && !this.#isOpeningAll(seq)) {
      const openAll = document.createElement('button');
      openAll.type = 'button';
      openAll.className = 'rvl-open-all-cta';
      openAll.textContent = `OPEN ALL ${this.#remainingPacks(seq)} REMAINING`;
      openAll.addEventListener('click', (e) => {
        try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
        this.#startOpenAll(seq);
      });
      summary.appendChild(openAll);
    }

    if (hasMoreLootboxes && readyLootboxes.length > 1) {
      const openAllBoxes = document.createElement('button');
      openAllBoxes.type = 'button';
      openAllBoxes.className = 'rvl-open-all-cta rvl-open-all-cta--lootboxes';
      openAllBoxes.textContent = `OPEN ALL ${readyLootboxes.length} LUCKBOX`;
      openAllBoxes.addEventListener('click', (e) => {
        try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
        void this.#openPendingLootboxes(seq, { all: true });
      });
      summary.appendChild(openAllBoxes);
    }

    // SHARE YOUR WIN — genuinely big winnings only (jackpot prizes / 5x paid spins;
    // never packs, NO HIT, or view-mode). Builds the share card (total +
    // affiliate-link QR) and hands it to the Web Share API; desktop saves
    // the PNG instead. share-win.js owns the whole flow.
    const share = this.#buildShareButton(seq);
    if (share) summary.appendChild(share);
  }

  #celebrateWin(big) {
    celebrateProtocol({
      target: this.#bind('rvl-stage') || this,
      tone: big ? 'jackpot' : 'win',
      big: Boolean(big),
    });
  }

}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('reveal-overlay')) {
    customElements.define('reveal-overlay', RevealOverlay);
  }
}

export { RevealOverlay };
