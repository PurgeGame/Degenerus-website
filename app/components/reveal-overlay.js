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
//   → burst (flash, vessel out, confetti for big sequences)
//   → cards (one prize card at a time: flip-in, count-up, tick SFX,
//            then shrink to the tray; 'spins' cards expand into the
//            Degenerette reel sub-stage first)
//   → summary (ordinary rewards) OR persistent full result (Degenerette), with
//              COLLECT + optional SHARE MY WIN (share-win.js affiliate QR)
// Queue: multiple sequences chain under one backdrop (multi-box opens).
//
// Juice sources: app/app/jackpot-sfx.js (WebAudio cues — first production
// consumer), canvas-confetti (dynamic import, reduced-motion gated), CSS
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
//   {kind:'bingo', level, symbol, tier, flipReward, dgnrsPaid, counts}
//                                                    — keeper-settled color Bingo
//   {kind:'foil-match', day, level, lineTraits, winningTraits, matchFaces,
//    score, rewardFaces, legs}                       — why a foil tuple paid,
//                                                      then its reward spin
//
// Class palette: .rvl-* (verified non-colliding).

import { displayEth, displayToken, displayTokenSnapped } from '../app/scaling.js';
import {
  DGN_QUADRANTS, DGN_SYMBOLS,
  applyDgnTicketAccent,
  dgnBadgePath, dgnComputeMatches, dgnScoringMatchStates,
  dgnTraitIdToQSC, dgnTraitIdsToQuadrants, dgnUnpackTicket,
} from '../app/dgn-traits.js';
import {
  warmup as sfxWarmup, sfxSpinStart, sfxTick, sfxMatchLock, sfxRollDone, sfxFanfare,
  sfxGoldTicket, sfxNoWin, sfxLoserHorn,
} from '../app/jackpot-sfx.js';
import { lock as lockScroll, unlock as unlockScroll } from '../app/scroll-lock.js';
import { canShareWin, shareWin } from '../app/share-win.js';
import { getPendingActions } from '../app/pending-actions.js';
import { lootboxRewardPresentation } from '../app/lootbox-legs.js';
import { FOIL_CLAIM_THRESHOLD } from '../app/foil-match.js';
import {
  readDegeneretteSpeed,
  writeDegeneretteSpeed,
} from '../app/degenerette-preferences.js';

// ---------------------------------------------------------------------------
// Module-level queue — components can enqueue before the element mounts.
// ---------------------------------------------------------------------------

let _instance = null;
let _buffer = [];
let _lootboxPresentationSeq = 0;
let _queuedLootboxPresentationIds = new Set();

// Ticket inventory listens for these lifecycle events so newly indexed cards
// remain behind their wrapper until the corresponding presentation is actually
// consumed. Pack-watch owns the durable pending/revealed bookkeeping.
export const PACK_REVEAL_COMPLETE_EVENT = 'degenerus:pack-reveal-complete';
export const PACK_REVEAL_ABORT_EVENT = 'degenerus:pack-reveal-abort';
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
  const queued = _withLootboxPresentationId(seq);
  const presentationId = queued?.kind === 'lootbox'
    ? String(queued.presentationId || '')
    : '';
  // Live receipt parsing and the indexed pending tray can discover the same
  // settled box independently. A stable release-derived id keeps that one
  // logical box from entering the overlay twice while its first presentation
  // is buffered, queued, or active.
  if (presentationId && _queuedLootboxPresentationIds.has(presentationId)) return false;
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
  eth: '/shared/eth-blue.svg',
  dgnEthBadge: '/badges-circular/crypto_06_ethereum_blue.svg',
  dgnrs: '/specials/special_eth.svg',
  dgnrsBadge: '/badges-circular/crypto_06_ethereum_purple.svg',
  wwxrp: '/shared/coinflip-face-red.svg',
  flame: '/specials/special_none.svg',
});

const SPIN_LABELS = Object.freeze({
  wwxrp: 'WWXRP SPIN', flip: 'FLIP SPINS', eth: 'ETH SPIN',
});

// Degenerette bet currencies (DegenerusGameDegeneretteModule: 0=ETH, 1=FLIP,
// 3=WWXRP; 2 is unsupported on-chain).
const DGN_UNITS = Object.freeze({ 0: 'ETH', 1: 'FLIP', 3: 'WWXRP' });
const DGN_CARD_TYPES = Object.freeze({ 0: 'eth', 1: 'flip', 3: 'wwxrp' });
const BOX_SPIN_CURRENCIES = Object.freeze({ eth: 0, flip: 1, wwxrp: 3 });

// Keep batched boxes moving, but spend the saved time where the player can
// actually read what came out. Manual receipts remain tap-to-dismiss.
const LOOTBOX_AUTO_START_MS = 480;
const LOOTBOX_MANUAL_CHARGE_MS = 820;
const LOOTBOX_AUTO_CHARGE_MS = 560;
const LOOTBOX_MANUAL_BURST_MS = 360;
const LOOTBOX_AUTO_BURST_MS = 260;
const LOOTBOX_AUTO_RESULT_MS = 1_750;
const LOOTBOX_AUTO_RESULT_REDUCED_MS = 1_200;

const TRAIT_LABEL_OVERRIDES = Object.freeze({ cashsack: 'CASH SACK' });

/** The player-facing name for every gold symbol carried by one whole ticket. */
export function goldTicketLabel(traitIds) {
  const quadrants = dgnTraitIdsToQuadrants(traitIds);
  const names = quadrants.flatMap((trait, q) => {
    if (!trait || trait.col !== 7) return [];
    const raw = DGN_SYMBOLS[DGN_QUADRANTS[q]]?.[trait.sym];
    if (!raw) return [];
    return [TRAIT_LABEL_OVERRIDES[raw] || String(raw).replace(/[_-]+/g, ' ').toUpperCase()];
  });
  return names.length > 0
    ? names.map((name) => `GOLD ${name}`).join(' · ')
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

/**
 * A receipt-decoded BoxSpin → the same verified eight-lock board used by the
 * standalone Degenerette reveal. BoxSpin only publishes one group payout
 * (three FLIP reels share it), so rows deliberately carry no invented
 * per-spin payout; scores land per reel and money lands once at the end.
 */
export function buildBoxSpinBoard(spin) {
  const spinType = String(spin?.spinType || '').toLowerCase();
  const currency = BOX_SPIN_CURRENCIES[spinType];
  if (currency == null) return null;
  const reels = (Array.isArray(spin?.reels) ? spin.reels : []).slice(0, 3);
  if (reels.length === 0) return null;
  const rows = reels.map((reel, i) => ({
    spinIndex: Number.isFinite(Number(reel?.spinIndex)) ? Number(reel.spinIndex) : i,
    playerTraits: _reelTicket(reel, 'player') ?? 0,
    houseTraits: _reelTicket(reel, 'result'),
    score: Number.isFinite(Number(reel?.score)) ? Number(reel.score) : 0,
    payout: null,
  }));
  const grossPayout = _safeBigInt(spin?.payout);
  const total = spinType === 'eth' ? _safeBigInt(spin?.ethShare) : grossPayout;
  return {
    rows,
    currency,
    unit: DGN_UNITS[currency],
    total,
    spinSum: null,
    // A zero-payout FLIP leg has nothing left to present after its reels. The
    // contract still records the survival bit, but replaying a second loss
    // animation here makes an empty result look like it first won something.
    survived: spinType === 'flip' && total > 0n && spin?.survived === true
      ? true
      : null,
    heroIdx: null,
    boxSpin: true,
    grossPayout,
    // The first verified reel is the mystery beat. Keep the internal unit for
    // payout math, but do not put it (or the telltale reel count) anywhere in
    // the pre-spin UI; both become visible only after reel one lands.
    headline: 'LOOTBOX SPIN · CURRENCY HIDDEN',
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
      if (leg.wholeTickets > 0) {
        cards.push({
          type: 'tickets', rarity: 'common', icon: null, glyph: null,
          // The illustrated pack already carries the level and ticket count.
          // Lootbox pulls should not repeat that copy around the artwork.
          packOnly: true,
          level: Number.isFinite(Number(leg.futureLevel)) ? Number(leg.futureLevel) : null,
          label: `LEVEL ${leg.futureLevel} TICKETS`,
          value: String(leg.wholeTickets),
          sub: 'Traits reveal with the level draw',
          countText: String(leg.wholeTickets), spin: null,
        });
      }
      if ((leg.flip ?? 0n) > 0n) {
        cards.push({
          type: 'flip', rarity: 'common', icon: ICONS.flip, glyph: null,
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
    case 'flip':
      cards.push({
        type: 'flip', rarity: 'rare', icon: ICONS.flip, glyph: null,
        label: 'FLIP', value: _tokenText(leg.amount),
        sub: 'Redemption coinflip payout',
        countText: _tokenText(leg.amount), spin: null,
      });
      break;
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
        const isBoon = [2, 4, 5, 6, 8, 9, 10, 11].includes(rewardType);
        const isShield = rewardType === 12;
        const presentation = lootboxRewardPresentation(rewardType, leg.amount, {
          boonBps: leg.boonBps,
        });
        cards.push({
          type: isBoon ? 'boon' : (isShield ? 'quest-shield' : 'reward'),
          rarity: isShield ? 'rare' : (isBoon ? 'rare' : 'common'),
          icon: isBoon ? ICONS.flame : null,
          glyph: isShield ? '🛡' : (isBoon ? null : '?'),
          label: presentation.label,
          value: presentation.value,
          sub: presentation.detail,
          countText: null, spin: null,
        });
      }
      break;
    case 'settled':
      cards.push({
        type: 'settled', rarity: 'common', icon: ICONS.flame, glyph: null,
        label: 'BOX ALREADY RESOLVED', value: '',
        sub: 'Rewards were credited on-chain before this screen opened',
        countText: null, spin: null,
      });
      break;
    case 'spin': {
      const revealedLabel = SPIN_LABELS[leg.spinType] || 'DEGENERETTE SPIN';
      const reels = Array.isArray(leg.reels) ? leg.reels : [];
      const spinCount = reels.length || Number(leg.spinCount) || 1;
      const credited = leg.spinType === 'eth'
        ? _safeBigInt(leg.ethShare)
        : _safeBigInt(leg.payout);
      const revealsCurrency = credited > 0n;
      cards.push({
        type: 'spins',
        rarity: 'rare',
        revealedRarity: revealsCurrency
          ? (leg.spinType === 'eth' ? 'epic' : 'rare')
          : null,
        icon: ICONS.flame, glyph: null,
        label: 'MYSTERY BOX SPIN',
        revealedLabel: revealsCurrency ? revealedLabel : null,
        // Three reels identifies the FLIP lane. Keep both the currency and its
        // telltale reel count sealed until reel one has actually landed.
        value: '?',
        revealedValue: revealsCurrency ? `×${spinCount}` : null,
        sub: 'Land the first reel to reveal its currency',
        countText: null,
        spin: {
          spinType: leg.spinType,
          survived: leg.survived,
          payout: leg.payout ?? 0n,
          ethShare: leg.ethShare ?? 0n,
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

/** Normalize any accepted sequence shape. Returns null if nothing to show. */
export function normalizeSequence(seq) {
  if (!seq || typeof seq !== 'object') return null;
  const kind = seq.kind;
  if (kind === 'lootbox') {
    const legs = Array.isArray(seq.legs) ? seq.legs : [];
    let cards = legs.flatMap(_cardsFromLeg);
    // Some already-settled boxes emit only LootBoxOpened with fractional
    // ticket progress and no whole-ticket/FLIP card. The Degenerette result
    // still awarded and resolved a real box, so keep a truthful result card
    // instead of making its OPEN LOOTBOX continuation disappear.
    if (cards.length === 0 && seq.settledExpected && legs.length > 0) {
      cards = _cardsFromLeg({ legType: 'settled' });
    }
    if (cards.length === 0) return null;
    const big = cards.some((c) => (
      (c.revealedRarity || c.rarity) === 'epic'
      || (c.revealedRarity || c.rarity) === 'legendary'
    ));
    const opened = legs.find((leg) => leg?.legType === 'opened' && leg.lootboxIndex != null);
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
      title: seq.title || 'LOOTBOX',
      // Ordinary box openings need no heading—the case/rewards identify the
      // flow. Preserve a heading only for callers with real custom context,
      // such as "FOIL MATCH T4".
      hideTitle: !seq.title,
      big,
      autoStart: false,
      noVessel: Boolean(seq.noVessel),
      boxIndex,
      boxSpinCount,
      lootboxRelease: validLootboxRelease,
      cards,
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
      .filter((ticket) => ticket.traitIds != null)
      // A gold hit is the pack finale. Modern Array#sort is stable, so this
      // keeps the original order inside the plain and gold groups while moving
      // every ticket with at least one gold trait to the end.
      .sort((a, b) => Number(_ticketHasGold(a.traitIds)) - Number(_ticketHasGold(b.traitIds)));
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
    const validPackRelease = packRelease
      && packRelease.address
      && Number.isInteger(packRelease.level)
      && packRelease.cardIndexes.length > 0
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
    if (wholeTickets.length > 0) {
      const extra = Number(seq.extra ?? 0);
      return {
        kind,
        title,
        hideTitle: true,
        big: true,
        autoStart: false,
        level: normalizedLevel,
        foilPack,
        batchId,
        packIndex,
        packCount,
        packRelease: validPackRelease,
        totalCount: Math.max(count, Number(seq.totalCount ?? count) || count),
        // Tickets are dealt as a GRID rather than one card at a time (user
        // call): a pack is a hand, and reading it as a hand is the point. The
        // per-ticket cards below still back the tray/summary path.
        ticketGrid: wholeTickets.map((t, i) => ({
          traitIds: t.traitIds,
          foil: Boolean(t?.foil),
          label: `TICKET ${i + 1}`,
        })),
        extra,
        cards: wholeTickets.map((t, i) => ({
          type: 'tickets', rarity: t?.foil ? 'epic' : 'common', icon: null, glyph: null,
          level: normalizedLevel,
          traitIds: t.traitIds,
          foil: Boolean(t?.foil),
          label: `TICKET ${i + 1}`,
          value: '',
          sub: (i === wholeTickets.length - 1 && extra > 0)
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
      autoStart: false,
      level: normalizedLevel,
      foilPack,
      batchId,
      packIndex,
      packCount,
      packRelease: validPackRelease,
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
    const drawLabel = drawKind === 1 ? 'BONUS DRAW' : 'MAIN DRAW';
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
    const symbolName = String(DGN_SYMBOLS[DGN_QUADRANTS[quadrant]]?.[sym] || `symbol ${sym + 1}`)
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
    if (flipReward > 0n) cards.push({
      type: 'flip', rarity: 'rare', icon: ICONS.flip, glyph: null,
      label: 'FLIP', value: _tokenText(flipReward),
      sub: 'Credited to your coinflip balance',
      countText: _tokenText(flipReward), spin: null,
    });
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
        icon: won ? ICONS.flip : ICONS.flame,
        glyph: null,
        label,
        value: won ? `${_tokenText(payout)} FLIP` : `${side} LOST`,
        sub: voided
          ? 'Round voided · your stake was returned'
          : won
            ? `${side} paid`
            : `${outcome || 'THE OTHER SIDE'} paid`,
        countText: won ? `${_tokenText(payout)} FLIP` : null,
        spin: null,
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
    const hits = rows.filter((r) => r.payout > 0n).length;
    // FLIP per-spin payouts are the hits entering its final survival flip. A
    // zero settled total after one or more hits is a survival bust, not a
    // no-hit round; preserve that distinction in the final presentation.
    const survived = currency === 1 && hits > 0 ? won : null;
    const amount = currency === 0 ? _ethText(total) : _tokenText(total);
    return {
      kind,
      title: seq.title || (won ? 'YOU WON' : survived === false ? 'SURVIVAL FLIP LOST' : 'NO HITS'),
      // The verdict above is a SPOILER while the reels are still turning, so the
      // board plays under a neutral heading and swaps to it at the end.
      boardTitle: 'DEGENERETTE',
      big: won,
      unlucky: !won,
      // The board owns its own TAP TO SPIN gate, so the sequence-level vessel
      // gate is off and there is no chest to open.
      autoStart: false,
      noVessel: true,
      spinBoard: {
        rows, currency, unit, total, spinSum, survived, amountPerSpin, totalWager,
        headline: seq.headline == null ? null : String(seq.headline),
        heroIdx: seq.heroIdx == null ? null : (Number(seq.heroIdx) & 3),
        lootboxAwarded: Boolean(seq.lootboxAwarded),
        lootboxEth,
      },
      cards: [{
        type: won ? DGN_CARD_TYPES[currency] || 'flip' : 'nowin',
        rarity: won ? 'epic' : 'common',
        icon: won
          ? (currency === 0 ? ICONS.dgnEthBadge : (ICONS[DGN_CARD_TYPES[currency]] || ICONS.flip))
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
        cards.push({
          type: 'flip', rarity: 'rare', icon: ICONS.flip, glyph: null,
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
          const lootboxText = lootbox > 0n ? `${_ethText(lootbox)} ETH LOOTBOX` : '';
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
      const payout = flipWon
        ? stake + ((stake * BigInt(rewardPercent)) / 100n)
        : stake;
      cards.push({
        type: 'coinflip-result',
        outcome: flipWon ? 'win' : 'loss',
        rarity: flipWon ? 'epic' : 'common',
        icon: flipWon ? ICONS.ethFace : ICONS.wwxrp,
        glyph: null,
        label: 'COINFLIP',
        value: flipWon
          ? `+${_tokenText(payout)} FLIP`
          : `-${_tokenText(stake)} FLIP`,
        // Keep the amount as the visual headline and put the outcome on its
        // own line in the fullscreen day-summary card.
        sub: flipWon ? `WIN ${100 + rewardPercent}%` : 'LOSS',
        outcomeLabel: flipWon ? 'WIN' : 'LOSS',
        outcomePercent: flipWon ? `${100 + rewardPercent}%` : null,
        summaryDetail: true,
        countText: null,
        spin: null,
      });
    }
    const ticketsRevealed = Math.max(
      0,
      Number(activity.ticketsRevealed ?? activity.ticketCount) || 0,
    );
    if (ticketsRevealed > 0) {
      cards.push({
        type: 'tickets-revealed', rarity: 'common', icon: null, glyph: null,
        label: 'TICKETS REVEALED', value: String(ticketsRevealed),
        sub: 'Revealed this round',
        summaryDetail: true,
        countText: null, spin: null,
      });
    }
    const lootboxesBought = Math.max(0, Number(activity.lootboxesBought) || 0);
    const lootboxesOpened = Math.max(0, Number(activity.lootboxesOpened) || 0);
    if (lootboxesBought > 0) {
      cards.push({
        type: 'lootboxes-bought', rarity: 'rare', icon: null, glyph: null,
        label: 'LOOTBOXES BOUGHT', value: `×${lootboxesBought}`,
        sub: lootboxesOpened > 0
          ? `${lootboxesOpened} opened this round`
          : 'Waiting to be opened',
        summaryDetail: true,
        countText: null, spin: null,
      });
    }
    const resolvedLootboxes = Array.isArray(activity.lootboxResults)
      ? activity.lootboxResults : [];
    for (const result of resolvedLootboxes) {
      const rawIndex = result?.lootboxIndex;
      const resultLabel = rawIndex == null || String(rawIndex) === '0'
        ? 'AUTO-RESOLVED LOOTBOX'
        : `LOOTBOX #${String(rawIndex)}`;
      const resultCards = (Array.isArray(result?.legs) ? result.legs : [])
        .flatMap(_cardsFromLeg)
        .map((card) => ({
          ...card,
          // These are final historical results, so the compact receipt can
          // show the reward immediately without replaying a second box flow.
          summaryDetail: true,
          sub: card.spin
            ? resultLabel
            : [card.sub, resultLabel].filter(Boolean).join(' · '),
        }));
      cards.push(...resultCards);
    }
    if (cards.length === 0) return null;
    // Activity cards are context, and WWXRP is the consolation side of a
    // losing flip. Derive the terminal treatment from the complete summary so
    // callers cannot accidentally leave a full loss on the yellow COLLECT
    // action merely because they omitted the old consolationOnly hint.
    const hasNonConsolationWin = cards.some((card) => {
      if (card.type === 'coinflip-result') return card.outcome === 'win';
      return ![
        'nowin', 'wwxrp', 'tickets-revealed', 'lootboxes-bought', 'settled',
      ].includes(card.type);
    });
    const hasSettledLoss = Boolean(seq.consolationOnly) || cards.some((card) => (
      card.type === 'nowin'
      || card.type === 'wwxrp'
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
    return {
      kind,
      title: String(seq.title || 'FINAL DRAW'),
      big: Boolean(seq.big || cards.some((card) => card.outcome === 'win')),
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
// all four symbols first, then all four colors. Between locks it shows 2–4 idle
// rolls. Finishing the symbol pass before any color lands prevents a temporary
// color match from flashing as meaningful while another quadrant's symbol is
// still unresolved.
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
      const lockingSymbols = lockedSymbols.size < 4;
      for (let q = 0; q < 4; q++) {
        if (lockingSymbols) {
          if (!lockedSymbols.has(q)) available.push({ quadrant: q, type: 'symbol' });
        } else if (!lockedColors.has(q)) {
          available.push({ quadrant: q, type: 'color' });
        }
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

class RevealOverlay extends HTMLElement {
  #initialized = false;
  #queue = [];
  #running = false;
  #aborted = false;
  #timers = new Set();
  #tapResolve = null;
  #currentSequence = null;
  #openAllBatchId = null;
  #openAllPacks = false;
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
        <button type="button" class="rvl-close" data-bind="rvl-close" aria-label="Close reveal">✕</button>
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
              <div class="rvl-chest-lid">
                <span class="rvl-chest-lid-mark"></span>
                <span class="rvl-chest-rivet rvl-chest-rivet--tl"></span>
                <span class="rvl-chest-rivet rvl-chest-rivet--tr"></span>
              </div>
              <div class="rvl-chest-seam"></div>
              <div class="rvl-chest-body">
                <div class="rvl-chest-brand">
                  <img class="rvl-chest-logo" src="/whitepaper/flame-logo.svg" alt="">
                  <span class="rvl-chest-wordmark">DEGENERUS</span>
                  <strong class="rvl-chest-edition">LOOTBOX</strong>
                </div>
                <span class="rvl-chest-rivet rvl-chest-rivet--bl"></span>
                <span class="rvl-chest-rivet rvl-chest-rivet--br"></span>
              </div>
              <div class="rvl-chest-clasp"><span class="rvl-chest-q">?</span></div>
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
            <button type="button" class="rvl-vessel-open-all" data-bind="rvl-open-all" hidden>
              OPEN ALL
            </button>
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
    const openAll = this.#bind('rvl-open-all');
    if (openAll) openAll.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      const seq = this.#currentSequence;
      this.#startOpenAll(seq);
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

  #remainingPacks(seq, { includeCurrent = false } = {}) {
    if (!seq || seq.kind !== 'pack') return 0;
    const count = Math.max(1, Number(seq.packCount || 1));
    const index = Math.max(1, Number(seq.packIndex || 1));
    return Math.max(0, count - index + (includeCurrent ? 1 : 0));
  }

  #isOpeningAll(seq) {
    return Boolean(
      seq?.kind === 'pack'
      && (this.#openAllPacks || (seq.batchId && this.#openAllBatchId === seq.batchId)),
    );
  }

  #startOpenAll(seq) {
    if (!this.#canOpenAllPacks(seq)) return false;
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
    ));
  }

  #hasExternalPacks(seq) {
    const queued = this.#queue[0];
    return (queued?.kind === 'pack' && queued.batchId !== seq?.batchId)
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

  async #queueNextPendingPack(seq) {
    const action = this.#readyPendingPacks(seq?.packRelease)[0] || null;
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
        queued.autoStart = true;
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
      && !this.#pendingMatchesLootboxRelease(item, excludeRelease)
    )) || null;
  }

  #queuedContinuationLabel() {
    if (this.#queue.length === 0) return null;
    return this.#queue[0]?.kind === 'lootbox' ? 'OPEN LOOTBOX' : 'NEXT ▸';
  }

  #armQueuedContinuation() {
    if (this.#queue[0]?.kind === 'lootbox') this.#queue[0].autoStart = true;
  }

  #pendingContinuationLabel(action) {
    if (action?.kind === 'lootbox') return 'OPEN LOOTBOX';
    if (action?.kind === 'tickets') return 'OPEN TICKETS';
    if (action?.kind === 'bingo') return 'REVEAL BINGO';
    if (action?.kind === 'foil-match') return 'CLAIM FOIL MATCH';
    return String(action?.shortLabel || 'CONTINUE').toUpperCase();
  }

  #setPendingContinuation(button, action, fallback = 'COLLECT') {
    if (!button) return;
    button.__rvlPendingAction = action || null;
    button.dataset.mode = action ? 'pending-action' : 'continue';
    button.textContent = action ? this.#pendingContinuationLabel(action) : fallback;
    button.classList?.toggle(
      'rvl-collect-cta--unlucky',
      !action && fallback === 'UNLUCKY',
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
    if (!seq) return;
    this.#queue.push(seq);
    if (!this.#running) {
      // Claim the runner synchronously, but start on a microtask so every
      // same-tick enqueue (multi-box opens, buy legs + pack) lands in the
      // queue before the first sequence renders — the summary CTA can then
      // correctly say NEXT instead of COLLECT.
      this.#running = true;
      Promise.resolve().then(() => this.#run());
    }
  }

  async #run() {
    this.#running = true;
    this.#aborted = false;
    try { lockScroll(); } catch (_e) { /* defensive */ }
    const backdrop = this.#bind('rvl-backdrop');
    if (backdrop) backdrop.hidden = false;
    try {
      while (this.#queue.length > 0 && !this.#aborted) {
        const seq = this.#queue.shift();
        this.#currentSequence = seq;
        await this.#playSequence(seq);
        if (!this.#aborted) {
          this.#emitPackComplete(seq);
          this.#emitLootboxComplete(seq);
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
    this.#clearTimers();
    if (this.#tapResolve) { const r = this.#tapResolve; this.#tapResolve = null; r(); }
  }

  #emitPackComplete(seq) {
    const release = seq?.packRelease;
    if (!release || typeof document === 'undefined' || typeof document.dispatchEvent !== 'function'
      || typeof CustomEvent !== 'function') return;
    try {
      document.dispatchEvent(new CustomEvent(PACK_REVEAL_COMPLETE_EVENT, {
        detail: { ...release, cardIndexes: [...release.cardIndexes] },
      }));
    } catch (_e) { /* presentation bookkeeping must never break the overlay */ }
  }

  #emitPackAbort(sequences) {
    if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function'
      || typeof CustomEvent !== 'function') return;
    const releases = (Array.isArray(sequences) ? sequences : [])
      .map((seq) => seq?.packRelease)
      .filter(Boolean)
      .map((release) => ({ ...release, cardIndexes: [...release.cardIndexes] }));
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
    if (seq.presentationId != null) {
      _queuedLootboxPresentationIds.delete(String(seq.presentationId));
    }
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
    if (this.#tapResolve) { const r = this.#tapResolve; this.#tapResolve = null; r(value); }
  }

  // Cancellable wait: resolves after ms OR on tap/abort (whichever first).
  #wait(ms) {
    return new Promise((resolve) => {
      if (this.#aborted) { resolve(); return; }
      // Degenerette applies its live slider at each reel/frame. Every other
      // reveal uses the same browser preference here, giving Pending one
      // honest global speed control without double-scaling Degenerette.
      const speed = this.#currentSequence?.kind === 'degenerette'
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

  // Wait for an explicit tap (no timeout) — the TAP TO OPEN gate.
  #waitTap() {
    return new Promise((resolve) => {
      if (this.#aborted) { resolve(); return; }
      this.#tapResolve = resolve;
    });
  }

  async #waitAfterSummary(seq) {
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
    const openAll = this.#bind('rvl-open-all');
    if (openAll) openAll.hidden = true;
    const stage = this.#bind('rvl-stage');
    if (stage && stage.classList) {
      stage.classList.remove(
        'rvl-charging',
        'rvl-bursting',
        'rvl-stage--degenerette',
        'rvl-stage--ticket-pack',
        'rvl-stage--lootbox',
        'rvl-stage--auto-lootbox',
        'rvl-stage--day-summary',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Sequence player
  // -------------------------------------------------------------------------

  async #playSequence(seq) {
    this.#hideAll();
    const title = this.#bind('rvl-title');
    const rootStage = this.#bind('rvl-stage');
    if (rootStage?.classList) {
      rootStage.classList.toggle(
        'rvl-stage--degenerette',
        Boolean(seq.spinBoard && !seq.spinBoard.boxSpin),
      );
      rootStage.classList.toggle(
        'rvl-stage--ticket-pack',
        Array.isArray(seq.ticketGrid) && seq.ticketGrid.length > 0,
      );
      rootStage.classList.toggle('rvl-stage--lootbox', seq.kind === 'lootbox');
      rootStage.classList.toggle(
        'rvl-stage--auto-lootbox',
        seq.kind === 'lootbox' && Boolean(seq.autoStart),
      );
      rootStage.classList.toggle('rvl-stage--day-summary', Boolean(seq.daySummary));
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
      this.#renderSummary(seq);
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
    // whether the player won, so gating celebration on it alone threw confetti
    // over a sequence of pure losses (user call: no confetti on losses).
    const hasSpins = seq.cards.some((c) => Boolean(c.spin));
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
      && Number(seq.packIndex || 1) > 1;
    if (inlineAutoPack) {
      // OPEN ALL already had its deliberate wrapper click on pack one. Keep
      // later hands on the ticket surface; #playTicketGrid supplies a small
      // ripping wrapper above the next hand instead of cutting back to the
      // full-screen sealed-pack scene.
    } else if (seq.noVessel) {
      // Day-results popup: the board already played out — no sealed vessel
      // to open. Brief title beat, celebration confetti for wins, then cards.
      sfxWarmup();
      // A spin-through celebrates at the END: confetti here would tell the
      // player they won before the first reel stops.
      if (seq.big && !seq.consolationOnly && !allNoWin && !seq.spinBoard && !hasSpins) {
        this.#fireConfetti(false);
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
            : isLootbox ? 'Open lootbox' : 'Open reward',
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
      if (packLevel) {
        packLevel.textContent = isPack
          ? (seq.level != null ? `LEVEL ${seq.level}` : 'LEVEL —')
          : '';
      }
      const packCount = this.#bind('rvl-pack-count');
      if (packCount) {
        const count = Array.isArray(seq.ticketGrid) && seq.ticketGrid.length > 0
          ? seq.ticketGrid.length
          : seq.cards[0]?.value ?? '';
        packCount.textContent = isPack
          ? `${count} ${Number(count) === 1 ? 'TICKET' : 'TICKETS'}`
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
      const openAll = this.#bind('rvl-open-all');
      if (openAll) {
        const canOpenAll = isPack && this.#canOpenAllPacks(seq) && !openingAll;
        openAll.hidden = !canOpenAll;
        if (canOpenAll) {
          openAll.textContent = this.#openAllPacksLabel(seq, { includeCurrent: true });
        }
      }

      if (openingAll) {
        await this.#wait(120);
      } else if (seq.autoStart) {
        await this.#wait(isLootbox ? LOOTBOX_AUTO_START_MS : 700);
      } else {
        const action = await this.#waitTap();
        openingAll = action === 'open-all' || this.#isOpeningAll(seq);
      }
      if (this.#aborted) return;
      sfxWarmup();
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
        // every card is a `nowin` gets the burst animation without the confetti.
        if (seq.big && !seq.consolationOnly && !allNoWin && !hasSpins) this.#fireConfetti(false);
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

    let anyWin = false;
    if (seq.spinBoard) {
      // A resolved Degenerette stays on the large reel/result surface until
      // COLLECT. Do not collapse it back into the old 84px summary card.
      await this.#playSpinBoard(seq.spinBoard, {
        sequence: seq,
        finalLabel: this.#queuedContinuationLabel(),
      });
      return;
    }

    if (seq.kind === 'lootbox') {
      // The lootbox owns its granted BoxSpin: contents first, child reel next,
      // and no second copy of the spin card after the result.
      const boxSpinCards = seq.cards.filter((card) => Boolean(card.spin));
      if (boxSpinCards.length > 0) {
        const playedSpin = await this.#playLootboxSpinGrant(seq, boxSpinCards);
        if (playedSpin) return;
      }
    } else {
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
      this.#fireConfetti(seq.big);
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

    const surface = document.createElement('div');
    surface.className = seq.foilPack
      ? 'rvl-ticket-pack-stage rvl-ticket-pack-stage--foil'
      : 'rvl-ticket-pack-stage';
    const inlineAutoPack = openingAll && Number(seq.packIndex || 1) > 1;
    if (inlineAutoPack) {
      surface.classList.add('rvl-ticket-pack-stage--inline-rip');
      const rip = document.createElement('div');
      rip.className = 'rvl-auto-pack-rip';
      rip.setAttribute('aria-label', `Opening pack ${seq.packIndex} of ${seq.packCount}`);
      const pack = this.#buildRewardPack({
        foil: Boolean(seq.foilPack),
        level: seq.level,
        value: String(seq.ticketGrid.length),
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
    const grid = document.createElement('div');
    grid.className = seq.foilPack
      ? 'rvl-ticket-grid-stage rvl-ticket-grid-stage--foil'
      : 'rvl-ticket-grid-stage';
    surface.appendChild(grid);

    // Reserve the complete hand before dealing it. Appending one ticket at a
    // time used to add whole grid rows mid-animation and shove the controls.
    const dealt = seq.ticketGrid.map((t) => {
      const el = this.#buildPaperTicket(t.traitIds, t.foil);
      grid.appendChild(el);
      return { el, ticket: t };
    });
    const footer = document.createElement('div');
    footer.className = 'rvl-ticket-footer';
    surface.appendChild(footer);

    const reduced = _reducedMotion();
    if (!reduced) {
      for (const { el } of dealt) el.classList?.add('rvl-paper--queued');
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
          await this.#playGoldTicketHit(surface, el, t.traitIds, t.foil);
        }
      }
    }

    if (!reduced) await this.#wait(320);
    if (this.#aborted) return;

    const hasMoreInBatch = this.#hasMorePacks(seq);
    let hasMore = hasMoreInBatch;
    let loadingNext = null;
    if (openingAll) {
      hasMore = hasMoreInBatch || this.#queue[0]?.kind === 'pack';
      if (!hasMore) {
        loadingNext = document.createElement('div');
        loadingNext.className = 'rvl-ticket-batch-status';
        loadingNext.textContent = 'Loading next pending pack…';
        footer.appendChild(loadingNext);
        hasMore = await this.#queueNextPendingPack(seq);
        if (this.#aborted) return;
      }
    }

    if (!openingAll || !hasMore) {
      sfxFanfare(true);
      this.#fireConfetti(Boolean(seq.foilPack) || seq.ticketGrid.length > 4);
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
    next.textContent = hasMore
      ? 'OPEN NEXT PACK'
      : queuedLabel || (pendingAction ? this.#pendingContinuationLabel(pendingAction) : 'COLLECT');
    next.dataset.mode = pendingAction ? 'pending-action' : 'continue';
    next.__rvlPendingAction = pendingAction;
    next.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      if (next.dataset.mode === 'pending-action' && next.__rvlPendingAction) {
        void this.#runPendingContinuation(next.__rvlPendingAction, next, () => {
          this.#setPendingContinuation(next, this.#nextReadyPendingAction());
        });
        return;
      }
      if (hasMore) this.#armNextPack(seq);
      else this.#armQueuedContinuation();
      this.#tap(hasMore ? 'next-pack' : 'collect');
    });
    actions.appendChild(next);

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
    this.#fireGoldConfetti();
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
    flame.src = foil
      ? '/whitepaper/flame-center-silver.svg'
      : '/whitepaper/flame-center.svg';
    flame.alt = '';
    center.appendChild(flame);
    card.appendChild(center);
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
    // Let the flip-in keyframe run, then count up.
    await this.#wait(360);
    if (this.#aborted) return;
    const valueEl = el.querySelector('.rvl-card-value');
    if (valueEl && card.countText) _animateCount(valueEl, card.countText, 650);
    if (card.rarity === 'epic' || card.rarity === 'legendary') sfxRollDone(true);
    await this.#wait(card.spin ? 650 : 1150);
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

    // This is the parent reveal: it names the granted MYSTERY BOX SPIN but
    // keeps its denomination and outcome hidden. The next screen is the one
    // actual spin, not a replay of a result already shown here.
    this.#renderSummary(seq, { spinGrant: true, spinCount: boards.length });
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
    // the reel up just because the bet contains more spins: the player can
    // start each one, opt into AUTOSPIN, or SKIP TO RESULTS.
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

  #dgnMatchText(row) {
    if (row.houseTraits == null) return 'REEL UNAVAILABLE';
    const states = dgnScoringMatchStates(
      dgnUnpackTicket(row.playerTraits),
      dgnUnpackTicket(row.houseTraits),
    );
    const counts = { full: 0, sym: 0, col: 0, miss: 0 };
    for (const state of states) counts[state] += 1;
    const bits = [];
    if (counts.full) bits.push(`${counts.full} FULL`);
    if (counts.sym) bits.push(`${counts.sym} SYMBOL`);
    if (counts.miss) bits.push(`${counts.miss} MISS`);
    return bits.join(' · ');
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
    headTitle.textContent = board.headline
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
    actions.className = 'rvl-dgn-actions';
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
    cta.textContent = board.boxSpin ? 'SPIN 1' : `SPIN 1 OF ${board.rows.length}`;
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
    skipCta.textContent = 'SKIP TO RESULTS';
    skipCta.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      this.#tap('skip');
    });
    actions.appendChild(autoCta);
    actions.appendChild(cta);
    actions.appendChild(skipCta);
    const history = document.createElement('div');
    history.className = 'rvl-dgn-history';
    stage.appendChild(compare);
    stage.appendChild(pop);
    stage.appendChild(actions);
    stage.appendChild(history);
    zone.appendChild(stage);
    return {
      zone, head, headTitle, stage, compare, pop, speedState,
      actions, autoCta, cta, skipCta, history, runAmount,
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
    return {
      row, board, rendered, player, house, playerTraits,
      targetTraits: row.houseTraits == null ? null : dgnUnpackTicket(row.houseTraits),
    };
  }

  #applyFullSpinFrame(pair, frame) {
    if (!pair || !frame || !pair.targetTraits) return 0;
    const dynamic = [
      'q-full', 'q-sym', 'q-col', 'q-miss', 'q-lock-hit', 'q-lock-miss',
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
          ? 'q-lock-hit' : 'q-lock-miss';
      } else if (symbolLocked) {
        state = pair.playerTraits[q].sym === pair.targetTraits[q].sym
          ? 'q-lock-hit' : 'q-lock-miss';
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
    const won = hasRowPayout && row.payout > 0n;
    if (!board.boxSpin) {
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
      const scored = row.score > 0;
      rendered.pop.textContent = scored ? `SCORE ${row.score}` : 'NO MATCH';
      rendered.pop.className = `rvl-dgn-roll-pop ${scored ? 'is-score' : 'is-miss'}`;
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
      const scored = row.score > 0;
      chip.className = `rvl-dgn-history-chip ${scored ? 'is-score' : 'is-miss'}`;
      chip.textContent = `#${row.spinIndex + 1} · ${scored ? `S ${row.score}` : 'MISS'}`;
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
    element.setAttribute('aria-label', `Show spin ${Number(row.spinIndex) + 1}`);
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

  #appendFullSpinResultDetails(rendered, board) {
    if (board.boxSpin) return;
    const paid = board.rows.filter((row) => row.payout > 0n).length;

    const facts = document.createElement('div');
    facts.className = 'rvl-dgn-facts rvl-dgn-facts--result';
    facts.appendChild(this.#buildDgnFact(
      'PAID SPINS',
      `${paid} / ${board.rows.length}`,
      paid > 0 ? 'is-win' : 'is-miss',
    ));
    facts.appendChild(this.#buildDgnFact(
      'PAYOUT',
      `${this.#formatDgnAmount(board, board.total)} ${board.unit}`,
      board.total > 0n ? 'is-win' : 'is-miss',
    ));
    if (board.lootboxAwarded) {
      facts.appendChild(this.#buildDgnFact('BONUS', 'LOOTBOX WON', 'is-lootbox'));
    }
    if (board.totalWager > 0n) {
      const net = board.total - board.totalWager;
      const sign = net > 0n ? '+' : net < 0n ? '−' : '';
      const magnitude = net < 0n ? -net : net;
      facts.appendChild(this.#buildDgnFact(
        'NET',
        `${sign}${this.#formatDgnAmount(board, magnitude)} ${board.unit}`,
        net > 0n ? 'is-win' : net < 0n ? 'is-loss' : '',
      ));
    }
    rendered.stage.appendChild(facts);

    const results = document.createElement('div');
    results.className = 'rvl-dgn-results';
    for (const row of board.rows) {
      const won = row.payout > 0n;
      const line = document.createElement('button');
      line.type = 'button';
      line.className = `rvl-dgn-result-line ${won ? 'is-win' : 'is-miss'}`;
      const spin = document.createElement('strong');
      spin.className = 'rvl-dgn-result-spin';
      spin.textContent = `SPIN ${row.spinIndex + 1}`;
      const score = document.createElement('span');
      score.className = 'rvl-dgn-result-score';
      score.textContent = row.score > 0 ? `S ${row.score}` : 'MISS';
      const matches = document.createElement('span');
      matches.className = 'rvl-dgn-result-matches';
      matches.textContent = this.#dgnMatchText(row);
      const payout = document.createElement('strong');
      payout.className = 'rvl-dgn-result-payout';
      payout.textContent = won
        ? `+${this.#formatDgnAmount(board, row.payout)} ${board.unit}`
        : '—';
      line.appendChild(spin);
      line.appendChild(score);
      line.appendChild(matches);
      line.appendChild(payout);
      this.#registerFullSpinSelector(rendered, line, row, board);
      results.appendChild(line);
    }
    rendered.stage.appendChild(results);
  }

  async #appendBoxSpinCurrencyReveal(rendered, board, reducedMotion, {
    interstitial = false,
  } = {}) {
    if (!board.boxSpin || this.#aborted) return;
    const currencyKey = DGN_CARD_TYPES[board.currency] || 'flip';
    const reveal = document.createElement('div');
    reveal.className = `rvl-box-currency-reveal rvl-box-currency-reveal--${currencyKey}`;
    reveal.setAttribute('data-currency', board.unit);
    reveal.setAttribute('aria-live', 'polite');

    const icon = document.createElement('div');
    icon.className = 'rvl-box-currency-icon';
    const image = document.createElement('img');
    image.src = board.currency === 0
      ? ICONS.dgnEthBadge
      : (ICONS[currencyKey] || ICONS.flip);
    image.alt = '';
    icon.appendChild(image);

    const eyebrow = document.createElement('span');
    eyebrow.className = 'rvl-box-currency-eyebrow';
    eyebrow.textContent = 'MYSTERY CURRENCY';
    const name = document.createElement('strong');
    name.className = 'rvl-box-currency-name';
    name.textContent = board.unit;
    const sub = document.createElement('span');
    sub.className = 'rvl-box-currency-sub';
    sub.textContent = 'CURRENCY REVEALED';

    reveal.appendChild(icon);
    reveal.appendChild(eyebrow);
    reveal.appendChild(name);
    reveal.appendChild(sub);
    rendered.stage.appendChild(reveal);

    if (!reducedMotion) {
      sfxSpinStart(520);
      await this.#wait(this.#scaledDgnDelay(rendered, 420));
      if (this.#aborted) return;
    }

    if (reveal.classList) reveal.classList.add('is-revealed');
    if (rendered.headTitle) {
      rendered.headTitle.textContent = `${board.unit} BOX SPIN · ${board.rows.length} REEL${
        board.rows.length === 1 ? '' : 'S'
      }`;
    }
    sfxRollDone(board.total > 0n);
    if (!reducedMotion) {
      await this.#wait(this.#scaledDgnDelay(rendered, interstitial ? 720 : 480));
    }
    if (interstitial && !this.#aborted) {
      reveal.classList?.add('is-leaving');
      if (!reducedMotion) await this.#wait(this.#scaledDgnDelay(rendered, 180));
      reveal.remove?.();
    }
  }

  async #appendFullSpinSurvival(rendered, board, reducedMotion) {
    if (board.survived == null) return;
    if (this.#aborted) return;
    const flipEl = document.createElement('div');
    flipEl.className = 'rvl-survival';
    const coin = document.createElement('img');
    coin.className = 'rvl-survival-coin';
    coin.src = ICONS.flipFace;
    coin.alt = '';
    const label = document.createElement('span');
    label.className = 'rvl-survival-label';
    label.textContent = 'SURVIVAL FLIP';
    flipEl.appendChild(coin);
    flipEl.appendChild(label);
    rendered.stage.appendChild(flipEl);

    if (!reducedMotion) {
      sfxSpinStart(800);
      await this.#wait(this.#scaledDgnDelay(rendered, 900));
      if (this.#aborted) return;
    }
    if (flipEl.classList) flipEl.classList.add(board.survived ? 'is-win' : 'is-bust');
    // A surviving FLIP result crosses to the green ETH side; a bust settles on
    // the red WWXRP side. The prior code left the red face in place for both.
    coin.src = board.survived ? ICONS.ethFace : ICONS.wwxrp;
    label.textContent = board.boxSpin
      ? (board.survived
        ? 'SURVIVED — FINAL PAYOUT UNLOCKED'
        : 'DID NOT SURVIVE — NO FLIP PAYOUT')
      : board.survived
        ? `SURVIVED — ${_tokenText(board.spinSum)} FLIP PAID DOUBLE`
        : `BUSTED — ${_tokenText(board.spinSum)} FLIP GONE`;
    this.#setRunningTotal(rendered, board, board.total, reducedMotion ? 0 : 600);
    if (!reducedMotion) {
      sfxRollDone(Boolean(board.survived));
      await this.#wait(this.#scaledDgnDelay(rendered, 700));
    }
  }

  async #finishFullSpinBoard(rendered, board, {
    reducedMotion = false,
    sequence = null,
    finalLabel = null,
    currencyRevealed = false,
  } = {}) {
    if (!currencyRevealed && board.total > 0n) {
      await this.#appendBoxSpinCurrencyReveal(rendered, board, reducedMotion);
    }
    if (this.#aborted) return board.total > 0n;

    await this.#appendFullSpinSurvival(rendered, board, reducedMotion);
    if (this.#aborted) return board.total > 0n;

    const won = board.total > 0n;
    // When there is no survival beat, settle the tracker on the authoritative
    // final payout. This matters for a FLIP round whose per-spin rows contain
    // hits but whose final payout is zero.
    if (board.survived == null) {
      this.#setRunningTotal(rendered, board, board.total, reducedMotion ? 0 : 600);
    }
    this.#appendFullSpinResultDetails(rendered, board);
    this.#enableFullSpinSelection(rendered);

    const totalEl = document.createElement('div');
    totalEl.className = `rvl-spin-total ${won ? 'is-win' : 'is-miss'}`;
    totalEl.textContent = won
      ? `${this.#formatDgnAmount(board, board.total)} ${board.unit} WON`
      : (board.survived === false ? 'HIT — SURVIVAL FLIP BUSTED' : 'NO HIT');
    rendered.stage.appendChild(totalEl);

    if (sequence) {
      const title = this.#bind('rvl-title');
      if (title) title.textContent = sequence.title;
      const share = this.#buildShareButton(sequence);
      if (share) rendered.stage.appendChild(share);
      if (won) {
        sfxFanfare(Boolean(sequence.big));
        this.#fireConfetti(Boolean(sequence.big));
      } else {
        sfxNoWin();
      }
    }

    const pendingAction = sequence && !finalLabel && this.#queue.length === 0
      ? this.#nextReadyPendingAction(sequence?.lootboxRelease)
      : null;
    const unlucky = Boolean(sequence && !won && !finalLabel && !pendingAction);
    if (pendingAction) {
      this.#setPendingContinuation(rendered.cta, pendingAction);
    } else {
      rendered.cta.__rvlPendingAction = null;
      rendered.cta.dataset.mode = 'continue';
      rendered.cta.textContent = finalLabel
        || (sequence ? (unlucky ? 'UNLUCKY' : 'COLLECT')
          : (board.boxSpin ? 'CONTINUE' : 'COLLECT'));
      rendered.cta.classList?.toggle('rvl-collect-cta--unlucky', unlucky);
      rendered.cta.disabled = false;
    }
    rendered.cta.hidden = false;
    if (rendered.autoCta) rendered.autoCta.hidden = true;
    if (rendered.skipCta) rendered.skipCta.hidden = true;
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
    rendered.cta.hidden = true;
    if (rendered.autoCta) rendered.autoCta.hidden = true;
    if (rendered.skipCta) rendered.skipCta.hidden = true;
    if (!board.boxSpin) this.#setRunningTotal(rendered, board, board.spinSum, 0);
    return this.#finishFullSpinBoard(rendered, board, {
      ...options,
      reducedMotion: true,
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
        paint(el.lootbox, split.lootbox, ' LOOTBOX');
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
  // symbol, then color, lock independently in all four quadrants. Every spin
  // has its own explicit gate; SKIP TO RESULTS is a separate control.
  async #playSpinBoard(board, options = {}) {
    const priorControlsOnly = this.#controlsOnly;
    const rootStage = this.#bind('rvl-stage');
    const restoreCompactStage = Boolean(
      board.boxSpin
      && rootStage?.classList
      && !rootStage.classList.contains('rvl-stage--degenerette')
    );
    if (restoreCompactStage) rootStage.classList.add('rvl-stage--degenerette');
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

      const rendered = this.#renderFullSpinStage(board);
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
      let currencyRevealed = false;
      for (let i = 0; i < count; i++) {
        const row = board.rows[i];
        const plan = plans[i];
        const countIsRevealed = !board.boxSpin || i > 0;
        rendered.cta.dataset.mode = 'spin';
        rendered.cta.textContent = countIsRevealed
          ? `SPIN ${i + 1} OF ${count}`
          : 'SPIN 1';
        rendered.cta.disabled = false;
        rendered.cta.hidden = autoSpinning;
        rendered.autoCta.hidden = false;
        rendered.autoCta.disabled = false;
        rendered.autoCta.textContent = autoSpinning ? 'STOP AUTO' : 'AUTOSPIN';
        if (rendered.autoCta.classList) {
          rendered.autoCta.classList.toggle('is-active', autoSpinning);
        }
        rendered.skipCta.hidden = false;
        rendered.skipCta.disabled = false;

        let action = null;
        while (!this.#aborted && !['spin', 'skip'].includes(action)) {
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
              rendered.autoCta.textContent = 'AUTOSPIN';
              if (rendered.autoCta.classList) rendered.autoCta.classList.remove('is-active');
            } else {
              action = 'spin';
            }
          } else {
            const tapped = await this.#waitTap();
            if (tapped === 'auto') {
              autoSpinning = true;
              usedAutoSpin = true;
              rendered.cta.hidden = true;
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
              const q = frame.lock.quadrant;
              // Color only contributes when this quadrant's symbol matched.
              // A same-color / wrong-symbol landing is an ordinary lock tick,
              // never a misleading match bonk.
              const symbolMatched = pair.playerTraits[q].sym === pair.targetTraits[q].sym;
              const matched = frame.lock.type === 'color'
                ? symbolMatched && pair.playerTraits[q].col === pair.targetTraits[q].col
                : symbolMatched;
              if (matched) {
                try { sfxMatchLock(matchingSoundCount); } catch (_e) { /* audio is decoration */ }
                matchingSoundCount = Math.min(7, matchingSoundCount + 1);
              } else {
                this.#sfxTickSafe(frame.locksDone - 1);
              }
              if (matched && matchingLocks >= 3) {
                this.#jiggleFullSpin(pair, matchingLocks - 2);
              }
            }
            const frameAction = await this.#wait(this.#scaledDgnDelay(rendered, profile.cadence));
            if (frameAction === 'skip') { skipped = true; break; }
            if (frameAction === 'auto' && autoSpinning) {
              // Turning autospin off never interrupts the reel in motion; it
              // simply restores the manual gate for the following reel.
              autoSpinning = false;
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
        const rowWon = board.boxSpin ? row.score > 0 : row.payout > 0n;
        sfxRollDone(rowWon);
        autoPauseMs = autoSpinning && rowWon ? 900 : 420;
        completed = i + 1;
        if (board.boxSpin && i === 0 && board.total > 0n) {
          await this.#appendBoxSpinCurrencyReveal(rendered, board, false, {
            interstitial: count > 1,
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
          ? board.rows.some((row) => row.score > 0)
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
      });
    } finally {
      this.#controlsOnly = priorControlsOnly;
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
    const lid = document.createElement('span');
    lid.className = 'rvl-reward-lootbox__lid';
    const seam = document.createElement('span');
    seam.className = 'rvl-reward-lootbox__seam';
    const body = document.createElement('span');
    body.className = 'rvl-reward-lootbox__body';
    const logo = document.createElement('img');
    logo.src = '/whitepaper/flame-logo.svg';
    logo.alt = '';
    body.appendChild(logo);
    const name = document.createElement('strong');
    name.textContent = 'DEGENERUS';
    body.appendChild(name);
    const clasp = document.createElement('span');
    clasp.className = 'rvl-reward-lootbox__clasp';
    clasp.textContent = '?';
    box.appendChild(lid);
    box.appendChild(seam);
    box.appendChild(body);
    box.appendChild(clasp);
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
    const drawLabel = Number(meta?.drawKind) === 1 ? 'BONUS DRAW' : 'MAIN DRAW';
    const chart = document.createElement('div');
    chart.className = `rvl-foil-match${compact ? ' rvl-foil-match--compact' : ''}`;
    chart.setAttribute('aria-label', `Foil ticket compared with the ${drawLabel.toLowerCase()}`);

    const head = document.createElement('div');
    head.className = 'rvl-foil-match__head';
    const yours = document.createElement('strong');
    yours.textContent = 'YOUR FOIL';
    const versus = document.createElement('span');
    versus.textContent = `vs ${drawLabel}`;
    head.appendChild(yours);
    head.appendChild(versus);
    chart.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'rvl-foil-match__grid';
    for (let quadrant = 0; quadrant < 4; quadrant += 1) {
      const face = faces[quadrant];
      const pair = document.createElement('div');
      pair.className = `rvl-foil-pair rvl-foil-pair--${face === 2 ? 'exact' : face === 1 ? 'symbol' : 'miss'}`;
      const q = document.createElement('span');
      q.className = 'rvl-foil-pair__quadrant';
      q.textContent = `Q${String.fromCharCode(65 + quadrant)}`;
      pair.appendChild(q);

      const badges = document.createElement('span');
      badges.className = 'rvl-foil-pair__badges';
      for (const [role, traitId] of [['foil', lineTraits[quadrant]], ['draw', winningTraits[quadrant]]]) {
        const badge = document.createElement('img');
        const trait = dgnTraitIdToQSC(traitId);
        badge.src = dgnBadgePath(trait.q, trait.sym, trait.col);
        badge.alt = role === 'foil' ? 'Foil ticket trait' : 'Winning draw trait';
        badge.className = `rvl-foil-pair__badge rvl-foil-pair__badge--${role}`;
        badges.appendChild(badge);
        if (role === 'foil') {
          const arrow = document.createElement('span');
          arrow.className = 'rvl-foil-pair__arrow';
          arrow.textContent = '→';
          badges.appendChild(arrow);
        }
      }
      pair.appendChild(badges);

      const why = document.createElement('strong');
      why.className = 'rvl-foil-pair__score';
      why.textContent = face === 2 ? '+2 EXACT' : face === 1 ? '+1 SYMBOL' : 'NO MATCH';
      pair.appendChild(why);
      grid.appendChild(pair);
    }
    chart.appendChild(grid);

    const foot = document.createElement('div');
    foot.className = 'rvl-foil-match__foot';
    const score = Math.max(0, Math.trunc(Number(meta?.score) || 0));
    const rewardFaces = Math.max(0, Math.trunc(Number(meta?.rewardFaces) || 0));
    foot.textContent = rewardFaces > 0
      ? `T${score} UNLOCKED A ${_groupAmountText(rewardFaces)}-FACE REWARD SPIN`
      : `T${score} · FOUR OR MORE POINTS UNLOCKS A REWARD`;
    chart.appendChild(foot);
    return chart;
  }

  #buildBingoChart(meta, compact) {
    const quadrant = Number(meta?.quadrant) & 3;
    const winningSym = Number(meta?.sym) & 7;
    const category = DGN_QUADRANTS[quadrant];
    const symbolName = String(DGN_SYMBOLS[category]?.[winningSym] || `symbol ${winningSym + 1}`)
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
    title.textContent = `${String(category || 'trait').toUpperCase()} · 64 TRAITS`;
    const reason = document.createElement('span');
    reason.textContent = `${symbolName} · ALL 8 COLORS`;
    head.appendChild(title);
    head.appendChild(reason);
    chart.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'rvl-bingo-chart__grid';
    for (let symbolIndex = 0; symbolIndex < 8; symbolIndex += 1) {
      for (let color = 0; color < 8; color += 1) {
        const count = counts[(color * 8) + symbolIndex];
        const winning = symbolIndex === winningSym;
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
        grid.appendChild(cell);
      }
    }
    chart.appendChild(grid);
    return chart;
  }

  #buildCard(card, compact) {
    const el = document.createElement('div');
    const rarity = compact && card.revealedRarity ? card.revealedRarity : card.rarity;
    const typeClass = String(card.type || 'reward').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    el.className = `rvl-card rvl-card--${typeClass} rvl-rarity-${rarity}${compact ? ' rvl-card--mini' : ''}`;
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
      const img = document.createElement('img');
      img.src = card.icon;
      img.alt = '';
      icon.appendChild(img);
    } else if (card.glyph) {
      icon.textContent = card.glyph;
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
      const value = document.createElement('div');
      value.className = 'rvl-card-value';
      // Center-stage cards start empty and count up (#playCard drives
      // _animateCount); compact tray/summary cards show the final value.
      value.textContent = (!compact && card.countText)
        ? ''
        : (compact && card.revealedValue ? card.revealedValue : (card.value || ''));
      inner.appendChild(value);

      const label = document.createElement('div');
      label.className = 'rvl-card-label';
      // BoxSpin cards remain mystery cards before the reel. Compact cards are
      // only built after the full result has been acknowledged, so the tray and
      // final receipt can safely name the revealed currency.
      label.textContent = compact && card.revealedLabel
        ? card.revealedLabel
        : (card.label || '');
      inner.appendChild(label);

      if (!compact && card.sub) {
        const sub = document.createElement('div');
        sub.className = `rvl-card-sub${card.type === 'coinflip-result' ? ' rvl-card-sub--coinflip' : ''}`;
        if (card.type === 'coinflip-result' && card.outcomeLabel) {
          sub.setAttribute('aria-label', card.sub);
          const outcome = document.createElement('span');
          outcome.className = 'rvl-card-coinflip-outcome';
          outcome.textContent = card.outcomeLabel;
          sub.appendChild(outcome);
          if (card.outcomePercent) {
            const percent = document.createElement('span');
            percent.className = 'rvl-card-coinflip-percent';
            percent.textContent = card.outcomePercent;
            sub.appendChild(percent);
          }
        } else {
          sub.textContent = card.sub;
        }
        inner.appendChild(sub);
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
    tray.appendChild(this.#buildCard(card, true));
  }

  #buildShareButton(seq) {
    if (!canShareWin(seq)) return null;
    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'rvl-share-cta';
    share.textContent = 'SHARE MY WIN';
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
          : result === 'cancelled' ? 'SHARE MY WIN'
            : 'SHARE FAILED';
    });
    return share;
  }

  #renderSummary(seq, { spinGrant = false, spinCount = 0 } = {}) {
    const summary = this.#bind('rvl-summary');
    if (!summary) return;
    summary.textContent = '';
    summary.hidden = false;
    if (summary.classList) summary.classList.toggle('rvl-summary--foil', Boolean(seq.foilPack));

    const grid = document.createElement('div');
    grid.className = 'rvl-summary-grid';
    for (const card of seq.cards) {
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
          && (seq.spinBoard || card.summaryDetail
            || (seq.kind === 'lootbox' && (!card.spin || spinGrant)))
          && card.sub) {
        const sub = document.createElement('div');
        const positiveResult = card.outcome === 'win'
          || (seq.spinBoard != null && _safeBigInt(seq.spinBoard.total) > 0n);
        sub.className = `rvl-card-sub${positiveResult ? ' is-win' : ''}`;
        sub.textContent = card.sub;
        const inner = el.querySelector('.rvl-card-inner');
        if (inner) inner.appendChild(sub);
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
          outcome.textContent = card.spin.spinType === 'eth'
            ? `won ${_ethText(credited)} ETH`
            : card.spin.spinType === 'wwxrp'
              ? `won ${_tokenText(credited)} WWXRP`
              : `won ${_tokenText(credited)} FLIP`;
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
    cta.textContent = unlucky
      ? 'UNLUCKY'
      : hasMorePacks
      ? 'OPEN NEXT PACK'
      : hasMoreLootboxes ? 'OPEN NEXT BOX'
        : autoNextLootbox ? 'OPENING NEXT BOX…'
          : queuedLabel || (pendingAction ? this.#pendingContinuationLabel(pendingAction) : 'COLLECT');
    cta.classList?.toggle('rvl-collect-cta--unlucky', unlucky);
    cta.disabled = autoNextLootbox;
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
      openAllBoxes.textContent = `OPEN ALL ${readyLootboxes.length} BOXES`;
      openAllBoxes.addEventListener('click', (e) => {
        try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
        void this.#openPendingLootboxes(seq, { all: true });
      });
      summary.appendChild(openAllBoxes);
    }

    // SHARE MY WIN — winnings sequences only (jackpot prizes / paid spins;
    // never packs, NO HIT, or view-mode). Builds the share card (total +
    // affiliate-link QR) and hands it to the Web Share API; desktop saves
    // the PNG instead. share-win.js owns the whole flow.
    const share = this.#buildShareButton(seq);
    if (share) summary.appendChild(share);
  }

  // Confetti — mirrors last-day-jackpot #fireConfetti (dynamic import, gated).
  #fireConfetti(big) {
    if (_reducedMotion()) return;
    import('canvas-confetti').then(({ default: confetti }) => {
      const colors = ['#f5a623', '#ffc04d', '#ffffff', '#22c55e'];
      confetti({ particleCount: big ? 80 : 35, spread: big ? 100 : 70, origin: { y: 0.55 }, colors, zIndex: 1300 });
      if (big) {
        confetti({ particleCount: 30, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors, zIndex: 1300 });
        confetti({ particleCount: 30, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors, zIndex: 1300 });
      }
    }).catch(() => { /* confetti is decoration — never block the reveal */ });
  }

  #fireGoldConfetti() {
    if (_reducedMotion()) return;
    import('canvas-confetti').then(({ default: confetti }) => {
      const colors = ['#fff4b0', '#ffd56f', '#d4af37', '#ffffff'];
      confetti({
        particleCount: 65,
        spread: 92,
        startVelocity: 38,
        origin: { y: 0.54 },
        colors,
        zIndex: 1301,
      });
      confetti({
        particleCount: 18,
        angle: 60,
        spread: 48,
        origin: { x: 0, y: 0.65 },
        colors,
        zIndex: 1301,
      });
      confetti({
        particleCount: 18,
        angle: 120,
        spread: 48,
        origin: { x: 1, y: 0.65 },
        colors,
        zIndex: 1301,
      });
    }).catch(() => { /* confetti is decoration */ });
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('reveal-overlay')) {
    customElements.define('reveal-overlay', RevealOverlay);
  }
}

export { RevealOverlay };
