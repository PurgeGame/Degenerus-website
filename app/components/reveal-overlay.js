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
//
// Class palette: .rvl-* (verified non-colliding).

import { displayEth, displayToken } from '../app/scaling.js';
import {
  DGN_QUADRANTS, DGN_SYMBOLS,
  dgnBadgePath, dgnComputeMatches, dgnTraitIdsToQuadrants, dgnUnpackTicket,
} from '../app/dgn-traits.js';
import {
  warmup as sfxWarmup, sfxSpinStart, sfxTick, sfxRollDone, sfxFanfare,
  sfxGoldTicket, sfxNoWin, sfxLoserHorn,
} from '../app/jackpot-sfx.js';
import { lock as lockScroll, unlock as unlockScroll } from '../app/scroll-lock.js';
import { canShareWin, shareWin } from '../app/share-win.js';

// ---------------------------------------------------------------------------
// Module-level queue — components can enqueue before the element mounts.
// ---------------------------------------------------------------------------

let _instance = null;
let _buffer = [];

// Ticket inventory listens for these lifecycle events so newly indexed cards
// remain behind their wrapper until the corresponding presentation is actually
// consumed. Pack-watch owns the durable pending/revealed bookkeeping.
export const PACK_REVEAL_COMPLETE_EVENT = 'degenerus:pack-reveal-complete';
export const PACK_REVEAL_ABORT_EVENT = 'degenerus:pack-reveal-abort';

/**
 * Enqueue a reveal sequence. Safe to call before <reveal-overlay> mounts —
 * sequences buffer and play on connect. Returns true if accepted.
 */
export function queueReveal(seq) {
  if (!seq || typeof seq !== 'object') return false;
  if (_instance) {
    _instance.enqueue(seq);
  } else {
    _buffer.push(seq);
  }
  return true;
}

/** Test-only — drop the singleton + buffer. */
export function __resetForTest() {
  _instance = null;
  _buffer = [];
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
  flip: '/specials/special_flip.svg',
  flipFace: '/shared/coinflip-face-red.svg',
  ethFace: '/shared/coinflip-face-eth.svg',
  eth: '/specials/special_eth.svg',
  dgnrs: '/specials/special_dgnrs.svg',
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

function _ethText(wei) {
  try { return displayEth(BigInt(wei ?? 0)); } catch (_e) { return '0'; }
}
function _tokenText(wei) {
  try {
    return String(displayToken(BigInt(wei ?? 0)))
      .replace(/(\.\d*?[1-9])0+$/, '$1')
      .replace(/\.0+$/, '');
  } catch (_e) { return '0'; }
}

function _safeBigInt(value) {
  try { return BigInt(value ?? 0); } catch (_e) { return 0n; }
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
    survived: spinType === 'flip' && spin?.survived != null
      ? Boolean(spin.survived)
      : null,
    heroIdx: null,
    boxSpin: true,
    grossPayout,
    // The box only tells the player which currency lane it rolled after every
    // verified reel lands. Keep the internal unit for payout math, but do not
    // put it in the pre-spin heading.
    headline: 'LOOTBOX SPIN · CURRENCY HIDDEN',
  };
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
          sub: 'Stake it, flip it, or burn it for tickets',
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
      cards.push({
        type: 'boon', rarity: leg.rewardType === 11 ? 'epic' : 'rare',
        icon: leg.rewardType === 11 ? null : ICONS.flame,
        glyph: leg.rewardType === 11 ? '👑' : null,
        label: (leg.label || 'BONUS REWARD').toUpperCase(),
        value: '', sub: 'Active on your account',
        countText: null, spin: null,
      });
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
      cards.push({
        type: 'spins',
        rarity: 'rare',
        revealedRarity: leg.spinType === 'eth' ? 'epic' : 'rare',
        icon: ICONS.flame, glyph: null,
        label: 'MYSTERY BOX SPIN',
        revealedLabel,
        // Three reels identifies the FLIP lane. Keep both the currency and its
        // telltale reel count sealed until reel one has actually landed.
        value: '?',
        revealedValue: `×${spinCount}`,
        sub: 'Run every verified reel to reveal its currency',
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
    const cards = legs.flatMap(_cardsFromLeg);
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
    return {
      kind,
      title: seq.title || 'LOOTBOX',
      big,
      autoStart: false,
      noVessel: Boolean(seq.noVessel),
      boxIndex,
      boxSpinCount,
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
  if (kind === 'pari') {
    const market = String(seq.market || '').toLowerCase() === 'volume' ? 'VOLUME' : 'GROWTH';
    const round = Math.max(0, Number(seq.round ?? 0));
    const side = Number(seq.side) === 2 ? 'UNDER' : 'OVER';
    const outcome = Number(seq.outcome) === 2 ? 'UNDER'
      : Number(seq.outcome) === 1 ? 'OVER' : null;
    const payout = _safeBigInt(seq.payout);
    const voided = Boolean(seq.voided);
    const won = payout > 0n;
    const place = market === 'GROWTH' ? `LEVEL ${round}` : `ROUND ${round}`;
    return {
      kind,
      title: won ? 'PARI PAID' : 'PARI RESULT',
      big: won && payout > 2_000n * 10n ** 18n,
      autoStart: true,
      noVessel: true,
      cards: [{
        type: won ? 'flip' : 'nowin',
        rarity: won ? 'rare' : 'common',
        icon: won ? ICONS.flip : ICONS.flame,
        glyph: null,
        label: `${market} · ${place}`,
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
        if (seq.totalWager != null) return BigInt(seq.totalWager);
        return amountPerSpin * BigInt(rows.length);
      } catch (_e) { return 0n; }
    })();
    const spinSum = rows.reduce((a, r) => a + r.payout, 0n);
    const won = total > 0n;
    const hits = rows.filter((r) => r.payout > 0n).length;
    // FLIP bets double-or-nothing the WHOLE bet on one survival flip, so a
    // FLIP total that isn't 2x the per-spin sum means the flip busted.
    const survived = (currency === 1 && spinSum > 0n) ? won : null;
    const amount = currency === 0 ? _ethText(total) : _tokenText(total);
    return {
      kind,
      // A busted FLIP bet DID hit — the flip took it. Saying "no hits" over a
      // board full of paid rows is the one wrong thing to say here.
      title: seq.title || (won ? 'YOU WON' : (survived === false ? 'FLIP BUSTED' : 'NO HITS')),
      // The verdict above is a SPOILER while the reels are still turning, so the
      // board plays under a neutral heading and swaps to it at the end.
      boardTitle: 'DEGENERETTE',
      big: won,
      // The board owns its own TAP TO SPIN gate, so the sequence-level vessel
      // gate is off and there is no chest to open.
      autoStart: false,
      noVessel: true,
      spinBoard: {
        rows, currency, unit, total, spinSum, survived, amountPerSpin, totalWager,
        headline: seq.headline == null ? null : String(seq.headline),
        heroIdx: seq.heroIdx == null ? null : (Number(seq.heroIdx) & 3),
      },
      cards: [{
        type: won ? DGN_CARD_TYPES[currency] || 'flip' : 'nowin',
        rarity: won ? 'epic' : 'common',
        icon: won ? (ICONS[DGN_CARD_TYPES[currency]] || ICONS.flip) : ICONS.flame,
        glyph: null,
        label: `DEGENERETTE — ${rows.length} SPIN${rows.length === 1 ? '' : 'S'}`,
        value: won ? `${amount} ${unit}` : '',
        sub: won
          ? `${hits} of ${rows.length} paid`
          : (survived === false ? 'Survival flip busted the payout' : 'The house took this one'),
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
          countText: _ethText(p.amount), spin: null,
        });
      } else if (p.type === 'flip' && BigInt(p.amount ?? 0) > 0n) {
        cards.push({
          type: 'flip', rarity: 'rare', icon: ICONS.flip, glyph: null,
          label: 'FLIP', value: _tokenText(p.amount),
          sub: 'Bonus draw payout',
          countText: _tokenText(p.amount), spin: null,
        });
      } else if (p.type === 'wwxrp' && BigInt(p.amount ?? 0) > 0n) {
        cards.push({
          type: 'wwxrp', rarity: 'rare', icon: ICONS.wwxrp, glyph: null,
          label: 'WWXRP', value: _tokenText(p.amount),
          sub: 'Coinflip participation reward',
          countText: _tokenText(p.amount), spin: null,
        });
      } else if (p.type === 'tickets' && Number(p.amount ?? 0) > 0) {
        cards.push({
          type: 'tickets', rarity: 'common', icon: null, glyph: null,
          label: p.level != null ? `LEVEL ${p.level} TICKETS` : 'TICKETS',
          value: String(p.amount), sub: 'Won from the draw',
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
    const ticketPacks = Math.max(0, Number(activity.ticketPacks) || 0);
    const ticketCount = Math.max(0, Number(activity.ticketCount) || 0);
    if (ticketPacks > 0) {
      cards.push({
        type: 'ticket-packs', rarity: 'common', icon: null, glyph: null,
        label: 'TICKET PACKS BOUGHT', value: `×${ticketPacks}`,
        sub: ticketCount > 0
          ? `${ticketCount} ticket${ticketCount === 1 ? '' : 's'} inside`
          : 'Revealed this round',
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
    if (cards.length === 0) return null;
    return {
      kind,
      title: seq.title || (seq.day != null ? `DAY ${seq.day} SUMMARY` : 'DAY SUMMARY'),
      big: won,
      consolationOnly: Boolean(seq.consolationOnly),
      autoStart: true,
      // Day summaries follow an already-played-out board — nothing is sealed,
      // so no mystery-chest vessel; straight to the prize cards.
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
    el.textContent = (target * eased).toFixed(decimals) + suffix;
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
// color, then symbol, for each quadrant. Between locks it shows 2–4 idle rolls.
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
        else if (!lockedSymbols.has(q)) available.push({ quadrant: q, type: 'symbol' });
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
  #controlsOnly = false;

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
            <div class="rvl-chest" data-bind="rvl-chest">
              <div class="rvl-chest-aura"></div>
              <div class="rvl-chest-lid"><span class="rvl-chest-lid-mark"></span></div>
              <div class="rvl-chest-body">
                <div class="rvl-chest-brand">
                  <img class="rvl-chest-logo" src="/whitepaper/flame-logo.svg" alt="">
                  <span class="rvl-chest-wordmark">DEGENERUS</span>
                  <strong class="rvl-chest-edition">LOOTBOX</strong>
                </div>
                <span class="rvl-chest-meta" data-bind="rvl-chest-meta">RNG VERIFIED</span>
              </div>
              <div class="rvl-chest-clasp"><span class="rvl-chest-q">?</span></div>
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
    const openAll = this.#bind('rvl-open-all');
    if (openAll) openAll.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      const seq = this.#currentSequence;
      if (!this.#hasMorePacks(seq) || !seq.batchId) return;
      this.#openAllBatchId = seq.batchId;
      this.#tap('open-all');
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
    return Boolean(seq?.batchId && this.#openAllBatchId === seq.batchId);
  }

  #startOpenAll(seq) {
    if (!this.#hasMorePacks(seq) || !seq.batchId) return false;
    this.#openAllBatchId = seq.batchId;
    this.#tap('open-all');
    return true;
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

  // -------------------------------------------------------------------------
  // Queue driver
  // -------------------------------------------------------------------------

  enqueue(rawSeq) {
    const seq = normalizeSequence(rawSeq);
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
        if (!this.#aborted) this.#emitPackComplete(seq);
      }
    } catch (_e) {
      // Never let a reveal error strand the scroll lock.
      this.#emitPackAbort([this.#currentSequence, ...this.#queue]);
      this.#aborted = true;
      this.#queue = [];
    } finally {
      this.#hideAll();
      if (backdrop) backdrop.hidden = true;
      try { unlockScroll(); } catch (_e) { /* defensive */ }
      this.#running = false;
      this.#currentSequence = null;
      this.#openAllBatchId = null;
    }
  }

  #abort() {
    this.#emitPackAbort([this.#currentSequence, ...this.#queue]);
    this.#aborted = true;
    this.#queue = [];
    this.#currentSequence = null;
    this.#openAllBatchId = null;
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

  #tap(value = 'tap') {
    if (this.#tapResolve) { const r = this.#tapResolve; this.#tapResolve = null; r(value); }
  }

  // Cancellable wait: resolves after ms OR on tap/abort (whichever first).
  #wait(ms) {
    return new Promise((resolve) => {
      if (this.#aborted) { resolve(); return; }
      const t = setTimeout(() => {
        this.#timers.delete(t);
        if (this.#tapResolve === resolve) this.#tapResolve = null;
        resolve();
      }, ms);
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
    }
    // boardTitle is the non-spoiler heading a spin-through plays under; the real
    // verdict lands only after every verified reel has settled.
    if (title) title.textContent = seq.boardTitle || seq.title;

    if (_reducedMotion()) {
      // Motion is optional; the full-size result and its audit trail are not.
      if (seq.spinBoard) {
        await this.#playSpinBoard(seq.spinBoard, {
          reducedMotion: true,
          sequence: seq,
          finalLabel: this.#queue.length > 0 ? 'NEXT ▸' : 'COLLECT',
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
      // A lootbox BoxSpin is carried by a prize card rather than seq.spinBoard,
      // but it still owes the player the complete verified reel result. Land
      // every reel at full size first, reveal the currency second, then show
      // the ordinary multi-prize receipt.
      const boxSpinCards = seq.cards.filter((card) => Boolean(card.spin));
      if (boxSpinCards.length > 0) {
        let playedSpin = false;
        for (let i = 0; i < boxSpinCards.length; i++) {
          const board = buildBoxSpinBoard(boxSpinCards[i].spin);
          if (!board) continue;
          playedSpin = true;
          await this.#playSpinBoard(board, {
            reducedMotion: true,
            finalLabel: i < boxSpinCards.length - 1 ? 'NEXT SPIN ▸' : 'CONTINUE',
          });
          if (this.#aborted) return;
        }
        if (playedSpin) {
          const spinZone = this.#bind('rvl-spin-zone');
          if (spinZone) spinZone.hidden = true;
          this.#renderSummary(seq);
          if (seq.consolationOnly) sfxLoserHorn();
          else if (seq.big) sfxFanfare(true);
          await this.#waitTap();
          return;
        }
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
      await this.#waitTap();
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
    if (seq.noVessel) {
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
        if (vessel.classList) {
          vessel.classList.toggle('rvl-vessel--pack', isPack);
          vessel.classList.toggle('rvl-vessel--chest', !isPack);
          vessel.classList.toggle('rvl-vessel--lootbox', isLootbox);
          vessel.classList.toggle('rvl-vessel--foil-pack', isFoilPack);
        }
      }
      const chestMeta = this.#bind('rvl-chest-meta');
      if (chestMeta) {
        chestMeta.textContent = isLootbox
          ? `${seq.boxIndex ? `BOX #${seq.boxIndex} · ` : ''}RNG VERIFIED`
          : '';
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
        hint.textContent = openingAll
          ? 'OPENING ALL…'
          : seq.autoStart ? ''
            : isFoilPack ? 'TAP TO REVEAL FOIL'
              : isPack ? 'TAP TO TEAR'
                : isLootbox ? 'TAP TO CRACK'
                  : 'TAP TO OPEN';
      }
      const openAll = this.#bind('rvl-open-all');
      if (openAll) {
        const canOpenAll = isPack && this.#hasMorePacks(seq) && !openingAll;
        openAll.hidden = !canOpenAll;
        if (canOpenAll) {
          openAll.textContent = `OPEN ALL ${this.#remainingPacks(seq, { includeCurrent: true })} PACKS`;
        }
      }

      if (openingAll) {
        await this.#wait(120);
      } else if (seq.autoStart) {
        await this.#wait(700);
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
        // --- charging: shake + glow build ---
        if (stage && stage.classList) stage.classList.add('rvl-charging');
        sfxSpinStart(900);
        await this.#wait(900);
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
        await this.#wait(320);
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

    let anyWin = false;
    if (seq.spinBoard) {
      // A resolved Degenerette stays on the large reel/result surface until
      // COLLECT. Do not collapse it back into the old 84px summary card.
      await this.#playSpinBoard(seq.spinBoard, {
        sequence: seq,
        finalLabel: this.#queue.length > 0 ? 'NEXT ▸' : 'COLLECT',
      });
      return;
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
    await this.#waitTap();
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
    zone.appendChild(surface);
    const grid = document.createElement('div');
    grid.className = seq.foilPack
      ? 'rvl-ticket-grid-stage rvl-ticket-grid-stage--foil'
      : 'rvl-ticket-grid-stage';
    if (seq.foilPack) surface.appendChild(this.#buildFoilPresentation(seq));
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

    const hasMore = this.#hasMorePacks(seq);
    if (!openingAll || !hasMore) {
      sfxFanfare(true);
      this.#fireConfetti(Boolean(seq.foilPack) || seq.ticketGrid.length > 4);
    } else {
      sfxRollDone(true);
    }

    if (openingAll && hasMore) {
      const status = document.createElement('div');
      status.className = 'rvl-ticket-batch-status';
      status.textContent = `Opening pack ${Number(seq.packIndex) + 1} of ${seq.packCount}…`;
      footer.appendChild(status);
      await this.#wait(reduced ? 180 : 700);
      return;
    }

    const actions = document.createElement('div');
    actions.className = 'rvl-ticket-actions';

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'rvl-collect-cta';
    next.textContent = hasMore ? 'OPEN NEXT PACK' : 'COLLECT';
    next.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      if (hasMore) this.#armNextPack(seq);
      this.#tap(hasMore ? 'next-pack' : 'collect');
    });
    actions.appendChild(next);

    if (hasMore && !openingAll) {
      const openAll = document.createElement('button');
      openAll.type = 'button';
      openAll.className = 'rvl-open-all-cta';
      const remaining = this.#remainingPacks(seq);
      openAll.textContent = `OPEN ALL ${remaining} REMAINING`;
      openAll.addEventListener('click', (e) => {
        try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
        this.#startOpenAll(seq);
      });
      actions.appendChild(openAll);
    }

    footer.appendChild(actions);
    if (openingAll && !hasMore && this.#openAllBatchId === seq.batchId) {
      this.#openAllBatchId = null;
    }
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

  #buildFoilPresentation(seq) {
    const hero = document.createElement('div');
    hero.className = 'rvl-foil-presentation';
    const logo = document.createElement('img');
    logo.className = 'rvl-foil-presentation__logo';
    logo.src = '/whitepaper/flame-logo.svg';
    logo.alt = '';
    hero.appendChild(logo);
    const copy = document.createElement('div');
    copy.className = 'rvl-foil-presentation__copy';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'rvl-foil-presentation__eyebrow';
    eyebrow.textContent = 'DEGENERUS FOIL';
    copy.appendChild(eyebrow);
    const title = document.createElement('strong');
    title.className = 'rvl-foil-presentation__title';
    const count = Array.isArray(seq.ticketGrid)
      ? seq.ticketGrid.length
      : Math.max(1, Number(seq.totalCount || seq.cards[0]?.value || seq.cards.length));
    title.textContent = `${seq.level != null ? `LEVEL ${seq.level} · ` : ''}${count} BOOSTED ${count === 1 ? 'TICKET' : 'TICKETS'}`;
    copy.appendChild(title);
    const sub = document.createElement('span');
    sub.className = 'rvl-foil-presentation__sub';
    sub.textContent = seq.level != null
      ? `Graded against every Level ${seq.level} draw`
      : 'Graded against every draw in its level';
    copy.appendChild(sub);
    hero.appendChild(copy);
    return hero;
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
      const tag = document.createElement('span');
      tag.className = 'rvl-paper-tag';
      tag.textContent = 'FOIL';
      wrap.appendChild(tag);
    }
    const card = document.createElement('div');
    card.className = 'ticket-card tc-small';
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
    flame.src = '/whitepaper/flame-center.svg';
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

  // -------------------------------------------------------------------------
  // Degenerette bet reveal.
  //
  // Motion users get the full standalone-style two-token spin below. Reduced
  // motion lands the same large stage immediately; only the choreography goes.
  // -------------------------------------------------------------------------

  #dgnAnimationProfile() {
    // The standalone game runs roughly 150–250ms per token frame. Never speed
    // the reel up just because the bet contains more spins: the player now
    // starts each one explicitly and can SKIP TO RESULTS when they are done.
    return { idleMin: 2, idleMax: 4, cadence: 160 };
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

  #dgnMatchText(row) {
    if (row.houseTraits == null) return 'REEL UNAVAILABLE';
    const match = dgnComputeMatches(
      dgnUnpackTicket(row.playerTraits),
      dgnUnpackTicket(row.houseTraits),
    );
    const counts = { full: 0, sym: 0, col: 0, miss: 0 };
    for (const state of match.states) counts[state] += 1;
    const bits = [];
    if (counts.full) bits.push(`${counts.full} FULL`);
    if (counts.sym) bits.push(`${counts.sym} SYMBOL`);
    if (counts.col) bits.push(`${counts.col} COLOR`);
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
    flame.src = ICONS.flame;
    flame.alt = '';
    center.appendChild(flame);
    if (grid) grid.appendChild(center);
    const cells = typeof el.querySelectorAll === 'function'
      ? Array.from(el.querySelectorAll('.rvl-rq')) : [];
    const images = cells.map((cell) => cell.querySelector('img'));
    return { el, grid, center, cells, images };
  }

  #renderFullSpinStage(board) {
    const zone = this.#bind('rvl-spin-zone');
    if (!zone) return null;
    zone.textContent = '';
    zone.hidden = false;

    const head = document.createElement('div');
    head.className = 'rvl-spin-head';
    head.textContent = board.headline
      || `${board.rows.length} SPIN${board.rows.length === 1 ? '' : 'S'} · ${board.unit}`;
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
    if (!board.boxSpin && board.heroIdx != null) {
      betFacts.appendChild(this.#buildDgnFact('HERO', `★ Q${board.heroIdx + 1}`, 'is-hero'));
    }
    if (betFacts.children.length > 0) zone.appendChild(betFacts);

    const running = document.createElement('div');
    running.className = 'rvl-spin-running';
    const runLabel = document.createElement('span');
    runLabel.className = 'rvl-spin-running-label';
    runLabel.textContent = board.boxSpin ? 'BOX RESULT' : 'WON SO FAR';
    const runAmount = document.createElement('span');
    runAmount.className = 'rvl-spin-running-amount';
    runAmount.textContent = board.boxSpin ? 'PAYOUT LOCKED' : `0 ${board.unit}`;
    running.appendChild(runLabel);
    running.appendChild(runAmount);
    zone.appendChild(running);

    const stage = document.createElement('div');
    stage.className = board.boxSpin ? 'rvl-dgn-stage rvl-dgn-stage--box' : 'rvl-dgn-stage';
    const progress = document.createElement('div');
    progress.className = 'rvl-dgn-progress';
    progress.textContent = board.boxSpin ? 'SPIN 1' : `SPIN 1 OF ${board.rows.length}`;
    const compare = document.createElement('div');
    compare.className = 'rvl-dgn-compare';
    const pop = document.createElement('div');
    pop.className = 'rvl-dgn-roll-pop';
    const status = document.createElement('div');
    status.className = 'rvl-dgn-status';
    status.setAttribute('aria-live', 'polite');
    status.textContent = board.boxSpin ? 'BOX SPIN READY' : 'SPIN 1 READY';
    const hint = document.createElement('div');
    hint.className = 'rvl-dgn-hint';
    hint.textContent = 'ONE CLICK PER SPIN · 8 LOCKS · COLOR THEN SYMBOL';
    const actions = document.createElement('div');
    actions.className = 'rvl-dgn-actions';
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'rvl-collect-cta rvl-dgn-spin-cta';
    cta.dataset.mode = 'spin';
    cta.textContent = board.boxSpin ? 'SPIN 1' : `SPIN 1 OF ${board.rows.length}`;
    cta.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
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
    actions.appendChild(cta);
    actions.appendChild(skipCta);
    const history = document.createElement('div');
    history.className = 'rvl-dgn-history';
    stage.appendChild(progress);
    stage.appendChild(compare);
    stage.appendChild(pop);
    stage.appendChild(status);
    stage.appendChild(hint);
    stage.appendChild(actions);
    stage.appendChild(history);
    zone.appendChild(stage);
    return {
      zone, head, stage, compare, progress, pop, status, hint,
      actions, cta, skipCta, history, runAmount,
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

    const finalStates = dgnComputeMatches(pair.playerTraits, pair.targetTraits).states;
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
    const left = Math.max(0, 8 - frame.locksDone);
    if (frame.lock) {
      const phase = frame.lock.type === 'color' ? 'COLOR' : 'SYMBOL';
      pair.rendered.status.textContent = `Q${frame.lock.quadrant + 1} ${phase} LOCKED · ${matchingLocks} MATCHING · ${left} LEFT`;
    } else {
      pair.rendered.status.textContent = `HOUSE TOKEN SPINNING · ${left} LOCKS LEFT`;
    }
    return matchingLocks;
  }

  #settleFullSpinPair(pair) {
    const { row, board, rendered } = pair;
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
    const scoreText = row.score > 0 ? `S ${row.score}` : 'MISS';
    const payoutText = won ? ` · +${this.#formatDgnAmount(board, row.payout)} ${board.unit}` : '';
    rendered.status.textContent = row.houseTraits == null
      ? `SPIN ${row.spinIndex + 1} · REEL UNAVAILABLE · ${scoreText}${payoutText}`
      : `SPIN ${row.spinIndex + 1} · ${scoreText}${payoutText}`;
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
    const chip = document.createElement('div');
    if (board.boxSpin) {
      const scored = row.score > 0;
      chip.className = `rvl-dgn-history-chip ${scored ? 'is-score' : 'is-miss'}`;
      chip.textContent = `#${row.spinIndex + 1} · ${scored ? `S ${row.score}` : 'MISS'}`;
      rendered.history.appendChild(chip);
      return;
    }
    const won = row.payout > 0n;
    chip.className = `rvl-dgn-history-chip ${won ? 'is-win' : 'is-miss'}`;
    const result = row.score > 0 ? `S ${row.score}` : 'MISS';
    chip.textContent = won
      ? `#${row.spinIndex + 1} · ${result} · +${this.#formatDgnAmount(board, row.payout)}`
      : `#${row.spinIndex + 1} · ${result}`;
    rendered.history.appendChild(chip);
  }

  #appendFullSpinResultDetails(rendered, board) {
    if (board.boxSpin) return;
    const scoreTotal = board.rows.reduce((sum, row) => sum + Math.max(0, row.score), 0);
    const paid = board.rows.filter((row) => row.payout > 0n).length;

    const facts = document.createElement('div');
    facts.className = 'rvl-dgn-facts rvl-dgn-facts--result';
    facts.appendChild(this.#buildDgnFact('TOTAL SCORE', `S ${scoreTotal}`));
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
      const line = document.createElement('div');
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
      results.appendChild(line);
    }
    rendered.stage.appendChild(results);
  }

  async #appendBoxSpinCurrencyReveal(rendered, board, reducedMotion) {
    if (!board.boxSpin || this.#aborted) return;
    const currencyKey = DGN_CARD_TYPES[board.currency] || 'flip';
    const reveal = document.createElement('div');
    reveal.className = `rvl-box-currency-reveal rvl-box-currency-reveal--${currencyKey}`;
    reveal.setAttribute('data-currency', board.unit);
    reveal.setAttribute('aria-live', 'polite');

    const icon = document.createElement('div');
    icon.className = 'rvl-box-currency-icon';
    const image = document.createElement('img');
    image.src = ICONS[currencyKey] || ICONS.flip;
    image.alt = '';
    icon.appendChild(image);

    const eyebrow = document.createElement('span');
    eyebrow.className = 'rvl-box-currency-eyebrow';
    eyebrow.textContent = 'BOX SPIN CURRENCY';
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
    rendered.status.textContent = 'CURRENCY REVEAL…';

    if (!reducedMotion) {
      sfxSpinStart(520);
      await this.#wait(420);
      if (this.#aborted) return;
    }

    if (reveal.classList) reveal.classList.add('is-revealed');
    if (rendered.head) rendered.head.textContent = `${board.unit} BOX SPIN · ON-CHAIN RESULT`;
    rendered.status.textContent = `${board.unit} SPIN CONFIRMED`;
    sfxRollDone(board.total > 0n);
    if (!reducedMotion) await this.#wait(480);
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
      await this.#wait(900);
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
      await this.#wait(700);
    }
  }

  async #finishFullSpinBoard(rendered, board, {
    reducedMotion = false,
    sequence = null,
    finalLabel = null,
  } = {}) {
    await this.#appendBoxSpinCurrencyReveal(rendered, board, reducedMotion);
    if (this.#aborted) return board.total > 0n;

    await this.#appendFullSpinSurvival(rendered, board, reducedMotion);
    if (this.#aborted) return board.total > 0n;

    const won = board.total > 0n;
    if (board.boxSpin && board.survived == null) {
      this.#setRunningTotal(rendered, board, board.total, reducedMotion ? 0 : 600);
    }
    this.#appendFullSpinResultDetails(rendered, board);

    const totalEl = document.createElement('div');
    totalEl.className = `rvl-spin-total ${won ? 'is-win' : 'is-miss'}`;
    totalEl.textContent = won
      ? `${this.#formatDgnAmount(board, board.total)} ${board.unit} WON`
      : (board.survived === false ? 'HIT — SURVIVAL FLIP BUSTED' : 'NO HIT');
    rendered.stage.appendChild(totalEl);
    rendered.hint.textContent = 'RESULT LOCKED';

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

    rendered.cta.dataset.mode = 'continue';
    rendered.cta.textContent = finalLabel || (board.boxSpin ? 'CONTINUE' : 'COLLECT');
    rendered.cta.disabled = false;
    rendered.cta.hidden = false;
    if (rendered.skipCta) rendered.skipCta.hidden = true;
    if (rendered.actions) rendered.stage.appendChild(rendered.actions);
    else rendered.stage.appendChild(rendered.cta);
    await this.#waitTap();
    return won;
  }

  async #playSettledSpinBoard(board, options) {
    const rendered = this.#renderFullSpinStage(board);
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
    rendered.progress.textContent = `SPIN ${board.rows.length} OF ${board.rows.length} · COMPLETE`;
    rendered.cta.hidden = true;
    if (rendered.skipCta) rendered.skipCta.hidden = true;
    if (board.boxSpin) rendered.runAmount.textContent = `ALL ${board.rows.length} REELS LOCKED`;
    else this.#setRunningTotal(rendered, board, board.spinSum, 0);
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
      const m = dgnComputeMatches(
        dgnUnpackTicket(row.playerTraits), dgnUnpackTicket(row.houseTraits),
      );
      playerCells.forEach((cell, q) => {
        if (cell.classList) cell.classList.add(`q-${m.states[q]}`);
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

  // The running total, re-rendered as each spin settles.
  #setRunningTotal(rendered, board, amount, ms = 420) {
    const el = rendered.runAmount;
    if (!el) return;
    const text = `${board.currency === 0 ? _ethText(amount) : _tokenText(amount)} ${board.unit}`;
    if (amount > 0n) {
      if (el.classList) el.classList.add('is-win');
      _animateCount(el, text, ms);
    } else {
      if (el.classList) el.classList.remove('is-win');
      el.textContent = text;
    }
  }

  // Full standalone-style reveal: the entire house token keeps changing while
  // color, then symbol, lock independently in all four quadrants. Every spin
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
      let completed = 0;
      for (let i = 0; i < count; i++) {
        const row = board.rows[i];
        const plan = plans[i];
        const countIsRevealed = !board.boxSpin || i > 0;
        rendered.progress.textContent = countIsRevealed
          ? `SPIN ${i + 1} OF ${count} · READY`
          : 'SPIN 1 · READY';
        rendered.cta.dataset.mode = 'spin';
        rendered.cta.textContent = countIsRevealed
          ? `SPIN ${i + 1} OF ${count}`
          : 'SPIN 1';
        rendered.cta.disabled = false;
        rendered.cta.hidden = false;
        rendered.skipCta.hidden = false;
        rendered.skipCta.disabled = false;
        rendered.hint.textContent = i === 0
          ? 'CLICK SPIN · EACH REEL WAITS FOR YOU'
          : `SPIN ${i} LANDED · CLICK FOR THE NEXT REEL`;
        if (i > 0) rendered.status.textContent = `SPIN ${i} LANDED · SPIN ${i + 1} READY`;

        let action = null;
        while (!this.#aborted && action !== 'spin' && action !== 'skip') {
          action = await this.#waitTap();
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
        rendered.progress.textContent = countIsRevealed
          ? `SPIN ${i + 1} OF ${count} · SPINNING`
          : 'SPIN 1 · SPINNING';
        rendered.cta.dataset.mode = 'busy';
        rendered.cta.textContent = 'SPINNING…';
        rendered.cta.disabled = true;
        rendered.hint.textContent = 'SKIP TO RESULTS IS ALWAYS AVAILABLE';
        sfxSpinStart(Math.max(800, plan.length * profile.cadence));

        let matchingLocks = 0;
        if (row.houseTraits != null) {
          for (const frame of plan) {
            matchingLocks = this.#applyFullSpinFrame(pair, frame);
            if (frame.lock) {
              this.#sfxTickSafe(frame.locksDone - 1);
              const q = frame.lock.quadrant;
              const matched = frame.lock.type === 'color'
                ? pair.playerTraits[q].col === pair.targetTraits[q].col
                : pair.playerTraits[q].sym === pair.targetTraits[q].sym;
              if (matched && matchingLocks >= 3) {
                this.#jiggleFullSpin(pair, matchingLocks - 2);
              }
            }
            const frameAction = await this.#wait(profile.cadence);
            if (frameAction === 'skip') { skipped = true; break; }
            if (this.#aborted) return board.total > 0n;
          }
        }
        if (skipped) break;

        this.#settleFullSpinPair(pair);
        this.#appendFullSpinHistory(rendered, row, board);
        this.#showFullSpinPop(rendered, row, board);
        if (board.boxSpin) {
          rendered.runAmount.textContent = `${i + 1}/${count} REELS LOCKED`;
        } else {
          running += row.payout;
          this.#setRunningTotal(rendered, board, running, 520);
        }
        sfxRollDone(board.boxSpin ? row.score > 0 : row.payout > 0n);
        completed = i + 1;
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
        this.#showFullSpinPop(rendered, last, board);
        if (board.boxSpin) rendered.runAmount.textContent = `ALL ${count} REELS LOCKED`;
        else this.#setRunningTotal(rendered, board, board.spinSum, 0);
        rendered.status.textContent = `ALL ${count} SPINS LANDED`;
        sfxRollDone(board.boxSpin
          ? board.rows.some((row) => row.score > 0)
          : board.spinSum > 0n);
      } else if (board.boxSpin) {
        rendered.runAmount.textContent = `ALL ${count} REELS LOCKED`;
      } else {
        this.#setRunningTotal(rendered, board, board.spinSum, 0);
      }
      rendered.progress.textContent = `SPIN ${count} OF ${count} · COMPLETE`;
      rendered.cta.hidden = true;
      rendered.skipCta.hidden = true;

      return await this.#finishFullSpinBoard(rendered, board, options);
    } finally {
      this.#controlsOnly = priorControlsOnly;
      if (restoreCompactStage) rootStage.classList.remove('rvl-stage--degenerette');
    }
  }

  // -------------------------------------------------------------------------
  // DOM builders (createElement only — server data via textContent)
  // -------------------------------------------------------------------------

  #buildCard(card, compact) {
    const el = document.createElement('div');
    const rarity = compact && card.revealedRarity ? card.revealedRarity : card.rarity;
    el.className = `rvl-card rvl-rarity-${rarity}${compact ? ' rvl-card--mini' : ''}`;
    if (card.foil) el.className += ' rvl-card--foil-ticket';
    const inner = document.createElement('div');
    inner.className = 'rvl-card-inner';

    const icon = document.createElement('div');
    icon.className = 'rvl-card-icon';
    if (card.icon) {
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
    } else if (card.type === 'tickets' || card.type === 'ticket-packs') {
      const mini = document.createElement('div');
      mini.className = 'rvl-mini-pack';
      const logo = document.createElement('img');
      logo.src = '/whitepaper/flame-logo.svg';
      logo.alt = '';
      mini.appendChild(logo);
      const wordmark = document.createElement('span');
      wordmark.textContent = 'DEGENERUS';
      mini.appendChild(wordmark);
      icon.appendChild(mini);
    } else if (card.type === 'lootboxes-bought') {
      const mini = document.createElement('div');
      mini.className = 'rvl-mini-lootbox';
      const mark = document.createElement('span');
      mark.textContent = '?';
      mini.appendChild(mark);
      icon.appendChild(mini);
    }
    inner.appendChild(icon);

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
      sub.className = 'rvl-card-sub';
      sub.textContent = card.sub;
      inner.appendChild(sub);
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

  #renderSummary(seq) {
    const summary = this.#bind('rvl-summary');
    if (!summary) return;
    summary.textContent = '';
    summary.hidden = false;
    if (summary.classList) summary.classList.toggle('rvl-summary--foil', Boolean(seq.foilPack));
    if (seq.foilPack) summary.appendChild(this.#buildFoilPresentation(seq));

    const grid = document.createElement('div');
    grid.className = 'rvl-summary-grid';
    for (const card of seq.cards) {
      const el = this.#buildCard(card, true);
      // Summary shows final values (no count-up placeholders).
      const valueEl = el.querySelector('.rvl-card-value');
      if (valueEl) valueEl.textContent = card.revealedValue || card.value || '';
      // A bet board's card is the only thing left on screen once the rows are
      // gone, so it keeps its sub line (compact cards normally drop it).
      if ((seq.spinBoard || card.summaryDetail) && card.sub) {
        const sub = document.createElement('div');
        sub.className = `rvl-card-sub ${seq.spinBoard.total > 0n ? 'is-win' : ''}`;
        sub.textContent = card.sub;
        const inner = el.querySelector('.rvl-card-inner');
        if (inner) inner.appendChild(sub);
      }
      // Spin cards show their outcome in the summary.
      if (card.spin) {
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
    const hasMorePacks = this.#hasMorePacks(seq);
    cta.textContent = hasMorePacks
      ? 'OPEN NEXT PACK'
      : this.#queue.length > 0 ? 'NEXT ▸' : 'COLLECT';
    cta.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (_e) { /* fakeDOM */ }
      if (hasMorePacks) this.#armNextPack(seq);
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
      confetti({ particleCount: big ? 160 : 70, spread: big ? 100 : 70, origin: { y: 0.55 }, colors, zIndex: 1300 });
      if (big) {
        confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors, zIndex: 1300 });
        confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors, zIndex: 1300 });
      }
    }).catch(() => { /* confetti is decoration — never block the reveal */ });
  }

  #fireGoldConfetti() {
    if (_reducedMotion()) return;
    import('canvas-confetti').then(({ default: confetti }) => {
      const colors = ['#fff4b0', '#ffd56f', '#d4af37', '#ffffff'];
      confetti({
        particleCount: 130,
        spread: 92,
        startVelocity: 38,
        origin: { y: 0.54 },
        colors,
        zIndex: 1301,
      });
      confetti({
        particleCount: 36,
        angle: 60,
        spread: 48,
        origin: { x: 0, y: 0.65 },
        colors,
        zIndex: 1301,
      });
      confetti({
        particleCount: 36,
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
