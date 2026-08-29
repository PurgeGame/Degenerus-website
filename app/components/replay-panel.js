// components/replay-panel.js -- Jackpot Replay Viewer
// Browse historical jackpot draws: pick a level/day, view tickets, replay the reveal animation.
// Slot-machine spin cycles badges through quadrants with live background coloring per player
// trait ownership, then owned quadrants get a canvas scratch-off that reveals prize amounts.
// Center diamond scratches to reveal FLIP wins (farFutureCoin distributions).
//
// Ported faithfully from jackpot-demo.html scratch/reveal UX.

import { deriveWinningTraits, traitToBadge, toDisplayOrder, DISPLAY_ORDER } from '../app/jackpot-data.js';
import { joScaledToTickets } from '../app/jackpot-rolls.js';
import {
  buildRoll1BucketSummaries,
  buildRoll2BucketSummaries,
  splitOpeningFlipDraw,
} from '../app/jackpot-buckets.js';
import {
  winningBadgeLayout,
  winningBadgeRewardDirection,
} from '../app/jackpot-badge-layout.js';
// SHELL-01 patch (Phase 52 followup, mirrors D-09 from jackpot-panel.js):
// swap the wallet-tainted utils.js import for the wallet-free viewer/utils.js
// equivalents so play/ can consume this component via a recursive-import walk
// without tripping the SHELL-01 guardrail on `ethers`.
import {
  formatEth,
  formatEthTruncated,
  formatFlip,
  truncateAddress,
} from '../viewer/utils.js';
import { BADGE_QUADRANTS, BADGE_COLORS, BADGE_ITEMS, badgeCircularPath } from '../app/constants.js';
import { warmBadgeStore } from '../app/badge-sprite.js';
import { fetchJSON } from '../app/api.js';
import { batch, update } from '../app/reactive-store.js';
import { setMajorDrawActivity } from '../app/major-draw-activity.js';
import { isMuted as isSfxMuted } from '../app/jackpot-sfx.js';
import { subscribePendingActions } from '../app/pending-actions.js';
import { celebrateProtocol } from '../protocol-celebration.js';
import {
  jackpotProcessingPresentationStep,
  jackpotSpinControlState,
  latchedJackpotProcessingStage,
  rngMilestoneSatisfied,
} from '../app/jackpot-processing.js';

const DAY_DATA_RETRY_BASE_MS = 1_500;
const DAY_DATA_RETRY_MAX_MS = 15_000;
const RATE_LIMIT_FALLBACK_MS = 15_000;
const MAIN_SPIN_LABEL = 'SPIN JACKPOT';
const BONUS_SPIN_LABEL = 'BONUS SPIN';
const BONUS_SPIN_LOCKED_LABEL = 'SCRATCH TO UNLOCK BONUS';
const SPIN_AGAIN_LABEL = 'SPIN AGAIN';
const COINFLIP_LABEL = 'FLIP COIN';
// Shown on the LCD key while the resolver owns its action phase. The resolver's
// successful mineFlip() simulation is the chain-authoritative work predicate;
// the face is `white-space: nowrap` monospace at 0.12em tracking, so this stays
// at or under the longest label the key already carries (RESOLVE + RUN
// DECIMATOR), which keeps it on one line down to a 390px viewport.
const MINE_FLIP_CRANK_LABEL = 'MINE FLIP · PROCESSING';
// Same family, shown while one crank call is in flight. The key is disabled
// for that window, so without this it would sit inert on the idle wording and
// give a player who just pressed it nothing back.
const MINE_FLIP_MINING_LABEL = 'MINE FLIP · MINING';
let replayApiRetryAfterUntil = 0;

/** Resolve the ticket cohort used to color the main jackpot reel. */
export function replayHoldingsLevel({
  exactPurchaseLevel = null,
  processingPurchaseLevel = null,
  processingDay = null,
  selectedDay = null,
  selectedLevel = null,
} = {}) {
  const exact = Number(exactPurchaseLevel);
  if (Number.isInteger(exact) && exact > 0) return exact;

  const live = Number(processingPurchaseLevel);
  if (Number(processingDay) === Number(selectedDay)
    && Number.isInteger(live) && live > 0) return live;

  const settled = Number(selectedLevel);
  return Number.isInteger(settled) && settled >= 0 ? settled + 1 : null;
}

/** Keep a live reel on screen anywhere the board does not yet own a final face. */
export function replayAttractShouldRun({
  revealCleared = null,
  dayLoading = false,
  dayWarming = false,
  spinning = false,
  interactiveReveal = false,
} = {}) {
  return !spinning && !interactiveReveal && (
    revealCleared !== true
    || Boolean(dayLoading)
    || Boolean(dayWarming)
  );
}

function ticketWinIdentity(win) {
  const traitId = win?.traitId == null ? '' : Number(win.traitId);
  const level = win?.level == null ? '' : Number(win.level);
  const ticketIndex = win?.ticketIndex == null ? '' : Number(win.ticketIndex);
  return [
    String(win?.winner || '').toLowerCase(),
    String(win?.awardType || '').toLowerCase(),
    traitId,
    String(win?.amount ?? '0'),
    level,
    ticketIndex,
  ].join('|');
}

/**
 * Restore day-one early-bird ticket awards to the bonus reel.
 *
 * The exact Roll 1/2 endpoints currently omit these rows, while the
 * composed winner total (and therefore DAY SUMMARY) included them. The replay
 * day feed already contains every discrete payout, so subtract the ticket rows
 * represented by the two exact rolls and seat the remaining bonus-trait rows
 * on Roll 2. The multiset subtraction also makes this safe once the API starts
 * returning early-bird rows directly: already-accounted rows are never added
 * twice.
 */
export function includeEarlyBirdTicketWins({ roll1, roll2, distributions, bonusTraits } = {}) {
  const roll1Wins = Array.isArray(roll1?.wins) ? roll1.wins : [];
  const roll2Wins = Array.isArray(roll2?.wins) ? roll2.wins : [];
  const allRows = Array.isArray(distributions) ? distributions : [];
  const allowedTraits = new Set(
    (Array.isArray(bonusTraits) ? bonusTraits : [])
      .map(Number)
      .filter((traitId) => Number.isInteger(traitId) && traitId >= 0 && traitId <= 255),
  );
  if (allowedTraits.size === 0) return roll2;

  const accounted = new Map();
  for (const win of [...roll1Wins, ...roll2Wins]) {
    if (!['ticket', 'tickets'].includes(String(win?.awardType || '').toLowerCase())) continue;
    const key = ticketWinIdentity(win);
    accounted.set(key, (accounted.get(key) || 0) + 1);
  }

  const earlyBirdWins = [];
  for (const row of allRows) {
    if (!['ticket', 'tickets'].includes(String(row?.awardType || '').toLowerCase())) continue;
    const key = ticketWinIdentity(row);
    const remaining = accounted.get(key) || 0;
    if (remaining > 0) {
      accounted.set(key, remaining - 1);
      continue;
    }
    const traitId = Number(row?.traitId);
    if (!Number.isInteger(traitId) || !allowedTraits.has(traitId)) continue;
    earlyBirdWins.push({
      winner: String(row?.winner || '').toLowerCase(),
      awardType: 'tickets',
      traitId,
      quadrant: Math.floor(traitId / 64),
      amount: String(row?.amount ?? '0'),
      level: row?.level == null ? null : Number(row.level),
      sourceLevel: row?.sourceLevel == null ? null : Number(row.sourceLevel),
      ticketIndex: row?.ticketIndex == null ? null : Number(row.ticketIndex),
      earlyBird: true,
    });
  }
  if (earlyBirdWins.length === 0) return roll2;

  return {
    ...(roll2 || {}),
    day: roll2?.day ?? roll1?.day ?? null,
    level: roll2?.level ?? roll1?.level ?? null,
    purchaseLevel: roll2?.purchaseLevel ?? roll1?.purchaseLevel ?? null,
    wins: [...roll2Wins, ...earlyBirdWins],
  };
}

/** Keep the tiny center-diamond FLIP prize to three significant figures. */
export function formatCenterBonusFlip(weiValue) {
  let raw;
  try { raw = BigInt(weiValue ?? 0); }
  catch (_error) { return '0'; }
  if (raw < 0n) raw = -raw;

  const whole = raw / (10n ** 18n);
  if (whole < 1_000n) return whole.toLocaleString('en-US');

  const scientific = () => {
    const source = whole.toString();
    let exponent = source.length - 1;
    let leading = BigInt(source.slice(0, 3));
    if (Number(source[3] || 0) >= 5) leading += 1n;
    if (leading >= 1_000n) {
      leading = 100n;
      exponent += 1;
    }
    const digits = leading.toString().padStart(3, '0');
    const fraction = digits.slice(1).replace(/0+$/, '');
    return `${digits[0]}${fraction ? `.${fraction}` : ''}e${exponent}`;
  };

  const tiers = [
    [10n ** 15n, 'Q'],
    [10n ** 12n, 'T'],
    [10n ** 9n, 'B'],
    [10n ** 6n, 'M'],
    [10n ** 3n, 'K'],
  ];
  let tierIndex = tiers.findIndex(([scale]) => whole >= scale);
  if (tierIndex < 0) tierIndex = tiers.length - 1;

  for (;;) {
    const [scale, suffix] = tiers[tierIndex];
    const units = whole / scale;
    const decimals = units >= 100n ? 0 : units >= 10n ? 1 : 2;
    const factor = 10n ** BigInt(decimals);
    const rounded = ((whole * factor) + (scale / 2n)) / scale;
    if (rounded >= (1_000n * factor)) {
      if (tierIndex === 0) return scientific();
      tierIndex -= 1;
      continue;
    }

    const integer = rounded / factor;
    const fraction = decimals === 0
      ? ''
      : (rounded % factor).toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${integer}${fraction ? `.${fraction}` : ''}${suffix}`;
  }
}

function noteReplayApiResponse(response, now = Date.now()) {
  if (Number(response?.status) !== 429) return;
  const raw = response?.headers?.get?.('retry-after');
  const seconds = raw == null || String(raw).trim() === '' ? NaN : Number(raw);
  let delay = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1_000
    : NaN;
  if (!Number.isFinite(delay) && raw) {
    const date = Date.parse(raw);
    if (Number.isFinite(date)) delay = Math.max(0, date - now);
  }
  if (!Number.isFinite(delay)) delay = RATE_LIMIT_FALLBACK_MS;
  replayApiRetryAfterUntil = Math.max(replayApiRetryAfterUntil, now + delay);
}

function replayApiCooldownRemaining(now = Date.now()) {
  return Math.max(0, replayApiRetryAfterUntil - now);
}

function dayDataRetryDelay(attempt, now = Date.now()) {
  const retryNumber = Math.max(0, Math.trunc(Number(attempt) || 0));
  const backoff = Math.min(
    DAY_DATA_RETRY_MAX_MS,
    DAY_DATA_RETRY_BASE_MS * (2 ** Math.min(retryNumber, 8)),
  );
  return Math.max(backoff, replayApiCooldownRemaining(now));
}

async function replayFetch(path, init) {
  try {
    return await fetchJSON('/replay' + path, {
      signal: init?.signal,
      force: init?.cache === 'no-store',
      cache: init?.cache,
    });
  } catch (error) {
    noteReplayApiResponse(error?.response);
    throw error;
  }
}

// How far above the day's level Roll 2 can still find rolled traits. Mirrors
// app-tickets-inventory.js FAR_FUTURE_OFFSET: past this, a level has not been
// drawn, so its tickets have no traits to match.
const FAR_FUTURE_HORIZON = 4;

// Scratch-cover fill when the viewed player cannot win a quadrant. This is the
// darker locked/unscratched face; the paper beneath is the lighter loser pink
// from `.q-win-impossible` in replay.css.
const NO_WIN_COVER_FILL = 'rgb(218, 104, 104)';
// The settled scratch face uses the original pale-blue ticket color. Actual
// green/pink results stay hidden behind the separate neutral underlay below.
const POSSIBLE_WIN_COVER_FILL = '#b8d4e8';
const GOLD_TRAIT_COVER_FILL = 'rgb(212, 175, 55)';
// Let the eighth lock remain visibly settled before the scratch surface is
// mounted. Without this beat the final reel frame and completed board happened
// in one task, so the last quadrant appeared to snap to its result colour.
const FINAL_LOCK_SETTLE_MS = 260;
// A revealed win has two deliberate vertical zones. The receipt lives against
// the ticket's outer edge (top for TL/TR, bottom for BL/BR); badges stay in the
// remaining art band beside the center diamond instead of being scattered
// underneath the payout copy.
const BUCKET_REVEAL_POSITION_CLASSES = [
  'replay-bucket-reveal--q0',
  'replay-bucket-reveal--q1',
  'replay-bucket-reveal--q2',
  'replay-bucket-reveal--q3',
];
const BUCKET_REVEAL_VARIANT_CLASSES = [
  'replay-bucket-reveal--solo-eth',
  'replay-bucket-reveal--main-miss',
];

function isGoldTrait(traitId) {
  const id = Number(traitId);
  return Number.isInteger(id) && id >= 0
    && Math.floor((id % 64) / 8) === 7;
}

// --- Module-level scratch helpers ---

const BRUSH_R = 28;
const REVEAL_THRESHOLD = 0.5;
const KNOWN_LOSER_REVEAL_THRESHOLD = 0.4;
const GRID_RES = 40;
const CENTER_GRID_RES = 20;

function makeScratchGrid(res) { return new Uint8Array(res * res); }

function markGridCells(grid, res, canvasW, canvasH, cx, cy, brushR) {
  const cellW = canvasW / res, cellH = canvasH / res;
  const gridCX = cx / cellW, gridCY = cy / cellH;
  const gridR = brushR / Math.min(cellW, cellH);
  const minGX = Math.max(0, Math.floor(gridCX - gridR));
  const maxGX = Math.min(res - 1, Math.ceil(gridCX + gridR));
  const minGY = Math.max(0, Math.floor(gridCY - gridR));
  const maxGY = Math.min(res - 1, Math.ceil(gridCY + gridR));
  for (let gy = minGY; gy <= maxGY; gy++) {
    for (let gx = minGX; gx <= maxGX; gx++) {
      const dx = gx + 0.5 - gridCX, dy = gy + 0.5 - gridCY;
      if (dx * dx + dy * dy <= gridR * gridR) {
        grid[gy * res + gx] = 1;
      }
    }
  }
}

function gridCoverage(grid) {
  let cleared = 0;
  for (let i = 0; i < grid.length; i++) { if (grid[i]) cleared++; }
  return cleared / grid.length;
}

/**
 * Format a prize amount for display in overlays.
 * For ETH: uses formatEth (wei string).
 * For FLIP: uses formatFlip (wei string).
 */
function formatPrizeAmount(weiString, currency) {
  if (currency === 'FLIP') return formatFlip(weiString);
  return formatEth(weiString);
}

function positiveBigInt(value) {
  try {
    const parsed = BigInt(value || 0);
    return parsed > 0n ? parsed : 0n;
  } catch (_error) {
    return 0n;
  }
}

/**
 * JackpotWhalePassWin.amount is a half-pass count. A purchased Whale Pass is
 * two half-passes, so never present this raw contract unit as whole passes.
 */
export function formatWhalePassAward(halfPassValue) {
  const halfPasses = positiveBigInt(halfPassValue);
  const wholePasses = halfPasses / 2n;
  const hasHalf = halfPasses % 2n === 1n;
  const amount = hasHalf
    ? (wholePasses === 0n ? '½' : `${wholePasses}½`)
    : wholePasses.toString();
  const singular = wholePasses === 1n && !hasHalf
    || wholePasses === 0n && hasHalf;
  return `${amount} whale pass${singular ? '' : 'es'}`;
}

/** Compact icon-and-amount rows shown the first time a paid badge is hovered. */
export function winningBadgeRewardLines(win = {}) {
  const rows = [];
  const awardType = String(win.awardType || '').toLowerCase();
  const eth = positiveBigInt(win.ethTotal ?? (awardType === 'eth' ? win.amount : 0));
  const flip = positiveBigInt(win.flipTotal ?? (
    ['flip', 'farfuturecoin'].includes(awardType) ? win.amount : 0
  ));
  const rawTicketEntries = Number(win.ticketTotal ?? (
    ['ticket', 'tickets'].includes(awardType) ? win.amount : 0
  ));
  const tickets = Number.isFinite(rawTicketEntries) && rawTicketEntries > 0
    ? joScaledToTickets(rawTicketEntries)
    : 0;
  if (eth > 0n) {
    const amount = win.isSolo
      ? formatEthTruncated(eth.toString())
      : formatEth(eth.toString());
    rows.push({ kind: 'eth', amount, aria: `${amount} ETH` });
  }
  if (flip > 0n) {
    const amount = formatFlip(flip.toString());
    rows.push({ kind: 'flip', amount, aria: `${amount} FLIP` });
  }
  if (tickets > 0) {
    const amount = tickets.toLocaleString('en-US', { maximumFractionDigits: 2 });
    rows.push({ kind: 'tickets', amount, aria: `${amount} ticket${tickets === 1 ? '' : 's'}` });
  }
  return rows;
}

/**
 * Count the player's still-covered possible-win panels on Roll 1.
 *
 * Blue/gold already tells the player that they owned the offered trait, so
 * every such quadrant must be uncovered before Bonus Spin even when it turns
 * out to be a miss. Red guaranteed-loss quadrants remain optional. The center
 * is included only when it contains a player payout and therefore has a cover.
 */
export function countUnscratchedPotentialWinPanels({
  quadOwned = [],
  scratched = [],
  centerWinCount = 0,
  centerScratched = false,
} = {}) {
  let remaining = 0;
  for (let i = 0; i < 4; i++) {
    if (Boolean(quadOwned[i]) && !scratched[i]) remaining++;
  }
  if (Number(centerWinCount) > 0 && !centerScratched) remaining++;
  return remaining;
}

/** Miniature four-trait ticket shared by jackpot receipts and badge popups. */
function createJackpotTicketIcon(extraClass = '') {
  const ticketIcon = document.createElement('span');
  ticketIcon.className = `replay-bucket-ticket-icon ${extraClass}`.trim();
  ticketIcon.setAttribute('aria-hidden', 'true');
  [1, 74, 147, 228].forEach((traitId, miniQ) => {
    const miniBadge = traitToBadge(traitId);
    if (!miniBadge) return;
    const miniBadgeImg = document.createElement('img');
    miniBadgeImg.className = `replay-bucket-ticket-badge replay-bucket-ticket-badge--q${miniQ}`;
    miniBadgeImg.src = miniBadge.path;
    miniBadgeImg.alt = '';
    ticketIcon.appendChild(miniBadgeImg);
  });
  const ticketFlame = document.createElement('img');
  ticketFlame.className = 'replay-bucket-ticket-flame';
  ticketFlame.src = '/whitepaper/flame-center.svg';
  ticketFlame.alt = '';
  ticketIcon.appendChild(ticketFlame);
  return ticketIcon;
}

// --- Component ---

class ReplayPanel extends HTMLElement {
  static get observedAttributes() {
    return ['data-day-loading', 'data-day-warming'];
  }

  #rngDays = [];       // [{day, finalWord}]
  #players = [];       // [address, ...]
  #tickets = [];       // [{address, entryCount, totalMintedOnLevel}] — entryCount is ENTRIES (4 = 1 ticket)
  #selectedDay = null;
  #selectedLevel = null;
  #selectedPlayer = null;
  #openingFlipDay = false; // game level 0: two FLIP boards, no normal ETH/ticket Roll 1
  #distributions = []; // raw distributions from replay/day endpoint (used for prize mapping)
  #winners = [];       // winner objects from /game/jackpot/day/:day/winners

  // Per-day roll caches from /game/jackpot/day/:day/roll1 and /roll2
  #dayRoll1 = null;    // full response: { day, level, purchaseLevel, wins: [...] }
  #dayRoll2 = null;    // full response: { day, level, purchaseLevel, wins: [...] }

  // Per-player filtered wins (derived from day caches by filtering on winner address)
  #playerRoll1Wins = [];  // wins[].filter(w => w.winner === selectedAddr)
  #playerRoll2Wins = [];  // wins[].filter(w => w.winner === selectedAddr)
  #hasBonus = false;      // gates the bonus-roll button. True when player won
                          // Roll 2 OR has any future-level ticket holdings
                          // (eligible to roll but possibly miss).
  #playerHasFutureTickets = null;  // Bool|null; cached per (day,player) by
                                   // #refreshPlayerEligibility(). null => unknown.

  // Spin + scratch state
  #playerTraitIds = new Set();  // Set<number> of owned trait IDs (for spin coloring)
  #traitsCacheAddress = null;   // address for which #playerTraitIds was fetched
  #playerTraitsPending = false; // target level/player is known but its holdings are not
  #playerTraitsLoadSeq = 0;     // prevents an older day/player read settling over a newer one
  // Roll 2 draws against the player's FUTURE-level holdings, not the day's
  // level, so the bonus spin colours off its own set. Union of the traits held
  // at every level above the day's, out to the far-future horizon (levels past
  // that cannot have rolled traits yet).
  #futureTraitIds = new Set();
  #futureTraitsCacheKey = null;
  #futureTraitsInflight = null; // shared flight: the warm-up and the bonus press
                                // must await the same hydration, never two.
  #animId = 0;                  // spin cancellation token (increment to cancel running spin)
  #spinning = false;            // true while spin animation is running
  #scratched = [false, false, false, false];  // per-quadrant scratch completion
  #scratchGrids = [null, null, null, null];   // per-quadrant Uint8Array scratch grids
  #greenRevealed = [false, false, false, false]; // per-quadrant first-badge win surface
  #badgesRevealed = [[], [], [], []];         // per-badge tracking within each quadrant
  #quadBadgeBounds = [null, null, null, null]; // per-quadrant badge hit circles
  #quadOwned = [false, false, false, false];  // per-quadrant win presence (from playerRoll1Wins)
  #quadWinArrays = [[], [], [], []];          // per-quadrant prize arrays (from playerRoll1/2Wins)
  #centerWins = [];                            // far-future coin wins (center diamond)
  #centerScratched = false;                    // center diamond scratch state
  #centerScratchGrid = null;                   // center diamond scratch grid

  // Bonus Spin (Roll 2) state — reuses the main widget
  #bonusPhase = false;          // true while bonus roll is active (Roll 2 reveal)
  #mainScratchComplete = false; // full Roll 1 board; remains the spoiler/persistence boundary
  #mainPotentialScratchComplete = false; // durable Bonus Spin gate: every blue/gold Roll 1 panel uncovered
  #bonusScratchComplete = false;// both boards can be revisited once Roll 2 is uncovered
  #drawViewSwitching = false;   // coalesces rapid center-flame view toggles
  #bonusTraitIds = new Set();   // traitIds the player won in Roll 2 (unused — kept for compat)
  #bonusQuadrants = new Set();  // contract quadrant numbers with roll2.future wins

  // Single-button mode (`single-button` attribute, set by /app/): the main
  // Spin button is the ONLY roll trigger — after Roll 1 it becomes the Bonus
  // Spin trigger, and the day ends with no button rather than a replay spin.
  #btnMode = 'reveal';          // 'reveal' | 'bonus' — what reveal-btn fires
  #mainSpinComplete = false;    // durable spin-complete flags; scratch state is separate
  #bonusSpinComplete = false;
  #coinflipHandoff = { day: null, available: false, revealed: false };
  #coinflipHandoffStarting = false;
  // Public main-draw result under each scratch cover. When the viewed player
  // has no winning entry, the quadrant still reveals its badge, ETH per win,
  // and the number of winning entries.
  #quadPublicSummaries = [null, null, null, null];

  #audioCtx = null;             // Web Audio context for SFX
  #sfxBus = null;               // dry, compressed slot-cabinet output
  #soloEthCuePlayed = false;    // replaces the generic roll fanfare for this reveal
  #scratchNode = null;          // active scratch noise node
  #mouseIsDown = false;         // global mouse button state
  #badgeCache = new Map();      // path → warmed Image (preloaded badge SVG cache)
  #rewardPopSequence = 0;       // earlier concurrent reward callouts stay in front
  #rewardDirectionPhase = Math.random(); // random starting side; sequence fans a burst around
  #daysRefreshPromise = null;   // coalesce initial/new-day option reloads
  #lastDaysRefreshAt = 0;       // retry throttle while the indexer catches up
  // /app/ owns the persisted "already scratched" bit.  The replay component
  // accepts that state through setPersistedRevealState(): a cleared draw is
  // reconstructed immediately, while an uncleared draw idles its four reels
  // slowly and silently until the player starts the real spin.
  #hostRevealCleared = null;
  #hostAllRollsCleared = false;
  #hostRevealSeq = 0;
  // The app shell publishes the same persisted state on every data poll. Keep
  // the latest requested key as well as the applied key so duplicate polls are
  // inert even while the first async restore is still loading.
  #hostRevealRequestKey = null;
  #hostRevealAppliedKey = null;
  #loadedDay = null;
  #dayLoadSeq = 0;
  #dayLoadInFlight = null;
  #dayReloadTimer = null;
  #dayReloadAttempt = 0;
  #dayReloadTarget = null;
  #idleSpinTimer = null;
  // Once the player starts this selection's reveal, polling may update the
  // persisted flags but must not rebuild/cancel the live main or bonus board.
  #interactiveRevealKey = null;
  // Only a direct center-flame click is allowed to turn cancellation into an
  // immediate final frame. Day/player changes and refreshes abort silently.
  #skipSpinId = null;
  // Deterministic, off-chain data used only by /learn/tutorial/. The tutorial
  // still runs this component's real buttons, reel timing, scratch canvases,
  // sounds, and result renderers; this replaces network reads, not gameplay UI.
  #tutorialFixture = null;
  // A due Decimator temporarily owns the app's primary jackpot action. Keep a
  // complete snapshot of the ordinary spin control so closing the draw returns
  // to exactly the prior day-summary/spin state.
  #primaryDecimatorAction = null;
  #primaryDecimatorBusy = false;
  #primaryDecimatorError = '';
  // The permissionless Mine FLIP crank, mirrored off the same pending-actions
  // feed the bottom tray renders. It is never re-derived here: this holds the
  // resolver's own published row and calls the resolver's own `run`.
  #mineFlipAction = null;
  #mineFlipBusy = false;
  #mineFlipArmed = false;
  #pendingActionUnsubscribe = null;
  #revealStateBeforeDecimator = null;
  // Highest processing-milestone count seen for the day being handed off, so a
  // retry that re-requests a roll cannot slide the progress bar backwards.
  #jpProgressLatch = null;
  #jpProcessingSignals = null;
  #jpPresentationState = null;
  #jpPresentationTimer = null;
  #jpPresentationArmed = false;

  connectedCallback() {
    this.innerHTML = `
      <div class="panel replay-panel">
        <div class="panel-header">
          <h2>JACKPOT REPLAY</h2>
        </div>

        <div class="replay-controls">
          <div class="replay-control-group">
            <label class="replay-label">Day</label>
            <select class="replay-select" data-bind="day-select">
              <option value="">Loading days...</option>
            </select>
          </div>
          <div class="replay-control-group">
            <label class="replay-label">Player</label>
            <select class="replay-select" data-bind="player-select">
              <option value="">Select a day first</option>
            </select>
          </div>
          <button class="btn-primary replay-reveal-btn" data-bind="reveal-btn" disabled>
            SPIN JACKPOT
          </button>
          <div class="jackpot-chainlink jackpot-chainlink--right" aria-hidden="true">
            <span class="jackpot-chainlink__lead jackpot-chainlink__lead--top"></span>
            <span class="jackpot-chainlink__lead jackpot-chainlink__lead--bottom"></span>
            <span class="jackpot-chainlink__pins"></span>
            <span class="jackpot-chainlink__cell jackpot-chainlink__cell--1"></span>
            <span class="jackpot-chainlink__cell jackpot-chainlink__cell--2"></span>
            <span class="jackpot-chainlink__cell jackpot-chainlink__cell--3"></span>
            <span class="jackpot-chainlink__cell jackpot-chainlink__cell--4"></span>
            <span class="jackpot-chainlink__cell jackpot-chainlink__cell--5"></span>
            <span class="jackpot-chainlink__cell jackpot-chainlink__cell--6"></span>
            <span class="jackpot-chainlink__core">VRF</span>
          </div>
        </div>

        <div class="replay-ticket-bar" data-bind="ticket-info" hidden>
          <span class="replay-ticket-count" data-bind="ticket-count"></span>
          <span class="replay-ticket-detail" data-bind="ticket-detail"></span>
        </div>

        <div class="replay-ticket" data-bind="card-grid">
          <div class="replay-tq" data-pos="tl">
            <img class="badge-img" src="" alt="">
            <div class="replay-prize-reveal" data-pos="tl"></div>
            <canvas class="replay-scratch-canvas" data-pos="tl"></canvas>
          </div>
          <div class="replay-tq" data-pos="tr">
            <img class="badge-img" src="" alt="">
            <div class="replay-prize-reveal" data-pos="tr"></div>
            <canvas class="replay-scratch-canvas" data-pos="tr"></canvas>
          </div>
          <div class="replay-tq" data-pos="bl">
            <img class="badge-img" src="" alt="">
            <div class="replay-prize-reveal" data-pos="bl"></div>
            <canvas class="replay-scratch-canvas" data-pos="bl"></canvas>
          </div>
          <div class="replay-tq" data-pos="br">
            <img class="badge-img" src="" alt="">
            <div class="replay-prize-reveal" data-pos="br"></div>
            <canvas class="replay-scratch-canvas" data-pos="br"></canvas>
          </div>
          <div class="replay-ticket-center" data-bind="center">
            <img src="/specials/special_none.svg" alt="Flame" class="replay-flame">
            <div class="replay-center-prize" data-bind="center-prize"></div>
            <canvas class="replay-center-canvas" data-bind="center-canvas"></canvas>
          </div>
        </div>

        <p class="replay-hint" aria-hidden="true"></p>

        <div class="replay-bonus-section" data-bind="bonus-section" hidden>
          <button class="btn-primary replay-bonus-btn" data-bind="bonus-btn">
            BONUS SPIN
          </button>
        </div>

        <!-- Plan 39-10: compact day summary mounted between card grid and winners list -->
        <day-jackpot-summary></day-jackpot-summary>

        <div class="replay-player-decimator" data-bind="player-decimator" hidden>
          <h3 class="replay-dist-title">Player Decimator Claims</h3>
          <div class="replay-player-decimator-list" data-bind="player-decimator-list"></div>
        </div>

        <div class="replay-distributions" data-bind="distributions" hidden>
          <h3 class="replay-dist-title">Jackpot Winners</h3>
          <div class="replay-dist-list" data-bind="dist-list"></div>
        </div>

        <div class="replay-empty" data-bind="empty-state">
          Select a day to replay a jackpot draw
        </div>
      </div>
    `;

    this.querySelector('[data-bind="day-select"]').addEventListener('change', (e) => this.#onDayChange(e));
    this.querySelector('[data-bind="player-select"]').addEventListener('change', (e) => this.#onPlayerChange(e));
    const revealBtn = this.querySelector('[data-bind="reveal-btn"]');
    revealBtn.addEventListener('click', () => {
      if (this.#primaryDecimatorAction) {
        void this.#triggerPrimaryDecimator();
        return;
      }
      // While the day's results are still being ground out, this key feeds the
      // crank that grinds them. It takes many mineFlip calls to walk ticket and
      // jackpot processing to a resolved day, and the player staring at this
      // LCD is the one who wants it finished. The face and click route share
      // one explicit action token, so a key rendered as Mine FLIP cannot fall
      // through into an ordinary jackpot spin. #triggerMineFlip still performs
      // the final callable check, including its in-flight/double-fire guard.
      if (revealBtn.dataset?.replayAction === 'mine-flip') {
        void this.#triggerMineFlip();
        return;
      }
      // Read the owned control directly. Synthetic/custom click dispatchers do
      // not all preserve Event.currentTarget, and a missing value here would
      // incorrectly replay the jackpot instead of handing off to the coin.
      if (revealBtn.dataset?.replayAction === 'coinflip') {
        this.#triggerCoinflipHandoff();
        return;
      }
      if (this.#btnMode === 'bonus') this.#triggerBonusRoll();
      else this.#triggerReveal();
    });
    this.querySelector('[data-bind="bonus-btn"]').addEventListener('click', () => this.#triggerBonusRoll());

    // Global mouse button tracking for scratch stop on mouseup
    this._onMouseDown = () => {
      this.#mouseIsDown = true;
      if (this.#audioCtx && this.#audioCtx.state === 'suspended') this.#audioCtx.resume();
    };
    this._onMouseUp = () => {
      this.#mouseIsDown = false;
      this.#sfxScratchStop();
    };
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);

    // During a spin the center skips to the result. Once both draws have been
    // uncovered, the same flame switches between their saved final states.
    const centerEl = this.querySelector('[data-bind="center"]');
    if (centerEl) {
      centerEl.addEventListener('click', (event) => {
        if (this.#spinning) {
          this.#skipSpinId = this.#animId;
          this.#animId++;
          this.#spinning = false;
          return;
        }
        // Finishing a center scratch can synthesize a click on its canvas;
        // don't immediately switch away from the result the player just won.
        if (event?.target?.classList?.contains('replay-center-canvas')) return;
        void this.#toggleRevealedDraw();
      });
      centerEl.addEventListener('keydown', (event) => {
        if (event?.key !== 'Enter' && event?.key !== ' ') return;
        if (!this.#mainReadyForBonus() || !this.#bonusScratchComplete) return;
        try { event.preventDefault?.(); } catch { /* fake DOM */ }
        void this.#toggleRevealedDraw();
      });
    }

    this.#pendingActionUnsubscribe = subscribePendingActions((items) => {
      this.#setPrimaryDecimatorAction(items);
      this.#setMineFlipAction(items);
    });
    this.#syncSpinControlState();
    // Paint the first attract frame synchronously. The replay/day and persisted
    // reveal reads arrive independently, so waiting for either one used to
    // expose the neutral grey reset board during a cold load.
    this.#startIdleSpin();
    this.refreshDays();
    void this.#preloadBadges(); // decode-warm every badge in the background
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === 'data-day-loading' || name === 'data-day-warming') {
      if (newValue !== null && this.hasAttribute(name)) this.#startIdleSpin();
      else if (!this.#idleSpinWanted()) this.#stopIdleSpin();
      this.#syncSpinControlState();
    }
  }

  disconnectedCallback() {
    this.#animId++;  // cancel any running spin
    this.#dayLoadSeq++;
    this.#dayLoadInFlight = null;
    if (this.#dayReloadTimer != null) {
      try { clearTimeout(this.#dayReloadTimer); } catch { /* defensive */ }
      this.#dayReloadTimer = null;
    }
    if (this.#jpPresentationTimer != null) {
      try { clearTimeout(this.#jpPresentationTimer); } catch { /* defensive */ }
      this.#jpPresentationTimer = null;
    }
    this.#dayReloadAttempt = 0;
    this.#dayReloadTarget = null;
    this.#skipSpinId = null;
    this.#interactiveRevealKey = null;
    try { this.#pendingActionUnsubscribe?.(); } catch { /* defensive */ }
    this.#pendingActionUnsubscribe = null;
    this.#primaryDecimatorAction = null;
    this.#primaryDecimatorBusy = false;
    this.#primaryDecimatorError = '';
    this.#mineFlipAction = null;
    this.#mineFlipBusy = false;
    this.#mineFlipArmed = false;
    this.#revealStateBeforeDecimator = null;
    this.removeAttribute?.('data-primary-action');
    this.#stopIdleSpin();
    this.#sfxScratchStop();
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
  }

  /**
   * Install one deterministic draw for the interactive tutorial.
   *
   * The hook is intentionally unavailable on ordinary app pages. It supplies
   * the same exact-day records the component normally receives from the replay
   * API, then enters the normal quiet attract state. Every interaction after
   * this call travels through #triggerReveal/#triggerBonusRoll/#runSpin and the
   * production scratch engine.
   */
  setTutorialFixture(fixture) {
    if (typeof document === 'undefined'
      || !document.documentElement?.hasAttribute?.('data-degenerus-tutorial')
      || !fixture || typeof fixture !== 'object') return false;

    const day = Number(fixture.day);
    const level = Number(fixture.level);
    const purchaseLevel = Number(fixture.purchaseLevel ?? level);
    const player = String(fixture.player || '').toLowerCase();
    const normalizeTraits = (value) => {
      if (!Array.isArray(value) || value.length !== 4) return null;
      const traits = value.map(Number);
      return traits.every((trait, quadrant) => (
        Number.isInteger(trait) && trait >= quadrant * 64 && trait < (quadrant + 1) * 64
      )) ? traits : null;
    };
    const mainTraits = normalizeTraits(fixture.mainTraits);
    const bonusTraits = normalizeTraits(fixture.bonusTraits);
    const validWins = (wins) => Array.isArray(wins) && wins.every((win) => {
      if (!win || !String(win.winner || '') || !String(win.awardType || '') || win.amount == null) {
        return false;
      }
      try { BigInt(win.amount); } catch { return false; }
      return win.traitId == null
        || (Number.isInteger(Number(win.traitId))
          && Number(win.traitId) >= 0 && Number(win.traitId) <= 255);
    });
    if (!Number.isInteger(day) || day <= 0
      || !Number.isInteger(level) || level < 0
      || !Number.isInteger(purchaseLevel) || purchaseLevel < 0
      || !player || !mainTraits || !bonusTraits
      || !validWins(fixture.roll1Wins) || !validWins(fixture.roll2Wins)) return false;

    const packed = (traits) => (
      (traits[0]
        | (traits[1] << 8)
        | (traits[2] << 16)
        | (traits[3] << 24)) >>> 0
    );
    const playerTraits = new Set((fixture.playerTraits || []).map(Number).filter(Number.isInteger));
    const futureTraits = new Set((fixture.futureTraits || []).map(Number).filter(Number.isInteger));
    this.#tutorialFixture = {
      day,
      level,
      purchaseLevel,
      player,
      mainTraits,
      bonusTraits,
      playerTraits,
      futureTraits,
      roll1Wins: fixture.roll1Wins.map((win) => ({ ...win, amount: String(win.amount) })),
      roll2Wins: fixture.roll2Wins.map((win) => ({ ...win, amount: String(win.amount) })),
    };

    this.#dayLoadSeq += 1;
    this.#dayLoadInFlight = null;
    if (this.#dayReloadTimer != null) {
      try { clearTimeout(this.#dayReloadTimer); } catch { /* defensive */ }
      this.#dayReloadTimer = null;
    }
    this.removeAttribute('data-day-warming');
    this.removeAttribute('data-day-loading');
    this.removeAttribute('aria-busy');
    this.#rngDays = [{
      day,
      level,
      phase: 'J',
      dayInPhase: fixture.dayInPhase ?? 5,
      finalWord: String(fixture.finalWord || '1'),
      mainTraitsPacked: packed(mainTraits),
      bonusTraitsPacked: packed(bonusTraits),
    }];
    this.#selectedDay = day;
    this.#loadedDay = day;
    this.#selectedLevel = level;
    this.#selectedPlayer = player;
    this.#openingFlipDay = false;
    this.#dayRoll1 = {
      day,
      level,
      purchaseLevel,
      wins: this.#tutorialFixture.roll1Wins,
    };
    this.#dayRoll2 = {
      day,
      level,
      purchaseLevel,
      wins: this.#tutorialFixture.roll2Wins,
    };
    this.#tickets = [{
      address: player,
      entryCount: Number(fixture.entryCount) || 8,
      totalMintedOnLevel: Number(fixture.entryCount) || 8,
    }];
    this.#players = [player];
    this.#winners = [];
    this.#distributions = [];
    this.#playerTraitIds = new Set(playerTraits);
    this.#traitsCacheAddress = `${player}|${purchaseLevel}`;
    this.#playerTraitsPending = false;
    this.#playerTraitsLoadSeq += 1;
    this.#futureTraitIds = new Set(futureTraits);
    this.#futureTraitsCacheKey = `${player}|${purchaseLevel}`;
    this.#playerHasFutureTickets = futureTraits.size > 0;
    this.#hostRevealCleared = false;
    this.#hostAllRollsCleared = false;
    this.#hostRevealRequestKey = null;
    this.#hostRevealAppliedKey = null;
    this.#interactiveRevealKey = null;
    this.#resetCards();
    this.#filterPlayerWins(player);

    const daySelect = this.querySelector('[data-bind="day-select"]');
    if (daySelect) {
      daySelect.innerHTML = `<option value="${day}">Day ${day} — L${level} J${fixture.dayInPhase ?? 5}</option>`;
      daySelect.value = String(day);
    }
    const playerSelect = this.querySelector('[data-bind="player-select"]');
    if (playerSelect) {
      playerSelect.innerHTML = `<option value="${player}">${truncateAddress(player)} (${Number(fixture.entryCount) || 8} entries)</option>`;
      playerSelect.value = player;
    }
    const empty = this.querySelector('[data-bind="empty-state"]');
    if (empty) empty.hidden = true;
    const distributions = this.querySelector('[data-bind="distributions"]');
    if (distributions) distributions.hidden = true;
    const ticketInfo = this.querySelector('[data-bind="ticket-info"]');
    if (ticketInfo) ticketInfo.hidden = false;
    const reveal = this.querySelector('[data-bind="reveal-btn"]');
    if (reveal) {
      reveal.hidden = false;
      reveal.disabled = false;
      reveal.textContent = MAIN_SPIN_LABEL;
      reveal.title = '';
    }
    this.#startIdleSpin();
    return true;
  }

  #hasExactDayRolls(day = this.#selectedDay) {
    const target = Number(day);
    if (!Number.isInteger(target) || target <= 0) return false;
    const rng = this.#rngDays.find((entry) => Number(entry?.day) === target);
    let hasFinalWord = false;
    try { hasFinalWord = BigInt(rng?.finalWord ?? 0) > 0n; } catch { /* malformed row */ }
    if (!hasFinalWord || rng?.mainTraitsPacked == null || rng?.bonusTraitsPacked == null) {
      return false;
    }

    const roll1Wins = this.#dayRoll1?.wins;
    const roll2Wins = this.#dayRoll2?.wins;
    if (Number(this.#dayRoll1?.day) !== target || !Array.isArray(roll1Wins)
      || Number(this.#dayRoll2?.day) !== target || !Array.isArray(roll2Wins)) {
      return false;
    }
    const validWin = (win) => {
      if (!win || typeof win !== 'object') return false;
      if (!String(win.winner || '').trim() || !String(win.awardType || '').trim()) return false;
      if (win.amount == null) return false;
      try { BigInt(win.amount); } catch { return false; }
      const traitId = win.traitId;
      return traitId == null
        || (Number.isInteger(Number(traitId)) && Number(traitId) >= 0 && Number(traitId) <= 255);
    };
    if (!roll1Wins.every(validWin) || !roll2Wins.every(validWin)) return false;

    // DailyWinningTraits is emitted before the remaining winner rows in the
    // same block. Even non-empty arrays can therefore be incomplete. The app
    // shell keeps this flag set until PrizePoolDailySnapshot seals the day;
    // never cache a pre-seal response as complete. Once it clears, genuinely
    // empty draws are valid and can be shown.
    if (this.hasAttribute('data-day-warming')) return false;
    return true;
  }

  #dayDataReady(day = this.#selectedDay) {
    const target = Number(day);
    return Number.isInteger(target)
      && target > 0
      && Number(this.#selectedDay) === target
      && Number(this.#loadedDay) === target
      && this.#hasExactDayRolls(target);
  }

  /** App-shell readiness hook used during the exact-day handoff. */
  isDayReady(day = this.#selectedDay) {
    return this.#dayDataReady(day);
  }

  /** App-shell hook: publish the exact-day coinflip's reveal state to the LCD. */
  setCoinflipHandoff({ day = null, available = false, revealed = false } = {}) {
    const parsedDay = Number(day);
    const nextDay = Number.isInteger(parsedDay) && parsedDay > 0 ? parsedDay : null;
    if (nextDay !== this.#coinflipHandoff.day || revealed) {
      this.#coinflipHandoffStarting = false;
    }
    this.#coinflipHandoff = {
      day: nextDay,
      available: Boolean(available),
      revealed: Boolean(revealed),
    };
    this.#syncSpinControlState();
  }

  /** App-shell hook: exact contract/indexer phases for the incoming live day. */
  setJackpotProcessingState(signals = null) {
    const day = Number(signals?.day);
    const normalizedDay = Number.isInteger(day) && day > 0 ? day : null;
    const priorDay = Number(this.#jpProcessingSignals?.day);
    const priorPurchaseLevel = Number(this.#jpProcessingSignals?.purchaseLevel);
    const rawPurchaseLevel = Number(signals?.purchaseLevel);
    const purchaseLevel = Number.isInteger(rawPurchaseLevel) && rawPurchaseLevel > 0
      ? rawPurchaseLevel
      : null;
    if (normalizedDay !== (Number.isInteger(priorDay) ? priorDay : null)) {
      if (this.#jpPresentationTimer != null) {
        try { clearTimeout(this.#jpPresentationTimer); } catch { /* defensive */ }
        this.#jpPresentationTimer = null;
      }
      this.#jpProgressLatch = null;
      this.#jpPresentationState = null;
      this.#jpPresentationArmed = false;
    }
    this.#jpProcessingSignals = normalizedDay == null ? null : {
      day: normalizedDay,
      active: signals?.active === true,
      requested: signals?.requested === true,
      rngReady: signals?.rngReady === true,
      // The direct isRngFulfilled() contract witness, kept distinct from the
      // inferred rngReady so the milestone can consume authoritative proof.
      rngFulfilled: signals?.rngFulfilled === true,
      coinflipReady: signals?.coinflipReady === true,
      ticketsReady: signals?.ticketsReady === true,
      jackpotReady: signals?.jackpotReady === true,
      purchaseLevel,
    };
    // Before RNG settles there is no Roll 1 payload to identify the ticket
    // cohort. When the app shell supplies (or corrects) that live level, load
    // its traits immediately; the already-running slow reel reads this Set on
    // every frame and will switch each face to the proper pink/blue state.
    const purchaseLevelChanged = purchaseLevel != null
      && purchaseLevel !== (Number.isInteger(priorPurchaseLevel) ? priorPurchaseLevel : null);
    const selectedDayIsLive = normalizedDay != null
      && normalizedDay === Number(this.#selectedDay);
    const hasExactPurchaseLevel = Number.isInteger(Number(this.#dayRoll1?.purchaseLevel))
      && Number(this.#dayRoll1?.purchaseLevel) > 0;
    if (purchaseLevelChanged && selectedDayIsLive && this.#selectedPlayer
      && !hasExactPurchaseLevel) {
      this.#playerTraitIds = new Set();
      this.#traitsCacheAddress = null;
      this.#playerTraitsPending = true;
      void this.#loadPlayerTraits();
    }
    // Only a day observed while genuinely incomplete replays the full visual
    // pipeline. Opening an already-finished historical day starts at its real
    // PREPARING SPIN fetch instead of pretending to request Chainlink again.
    if (this.#jpProcessingSignals?.active && !this.#jpProcessingSignals.jackpotReady) {
      this.#jpPresentationArmed = true;
    }
    this.#syncSpinControlState();
  }

  #setDayDataLoading(day, loading) {
    const target = Number(day);
    const btn = this.querySelector('[data-bind="reveal-btn"]');
    if (loading) {
      if (btn) btn.disabled = true;
      this.setAttribute('data-day-loading', Number.isInteger(target) ? String(target) : '');
      this.setAttribute('aria-busy', 'true');
      this.#syncSpinControlState();
      return;
    }
    if (Number(this.getAttribute('data-day-loading')) === target) {
      this.removeAttribute('data-day-loading');
    }
    if (!this.hasAttribute('data-day-warming') && !this.hasAttribute('data-day-loading')) {
      this.removeAttribute('aria-busy');
    }
    this.#syncSpinControlState();
  }

  /** Every confirmed contract and indexed step needed before Spin is enabled. */
  #jackpotProcessingMilestones(day = this.#selectedDay) {
    const target = Number(day);
    if (!Number.isInteger(target) || target <= 0) {
      return {
        rng: false, coinflip: false, packs: false, jackpot: false,
        draw: false, rolls: false, sealed: false,
      };
    }
    const live = Number(this.#jpProcessingSignals?.day) === target
      && this.#jpProcessingSignals?.active === true
      ? this.#jpProcessingSignals
      : null;
    const rng = this.#rngDays.find((entry) => Number(entry?.day) === target);
    let hasFinalWord = false;
    try { hasFinalWord = BigInt(rng?.finalWord ?? 0) > 0n; } catch { /* malformed row */ }
    return {
      // Two witnesses, because the live feed has a blind spot in exactly the
      // window the player is watching. `hasFinalWord` is the indexed row this
      // method already loads for `draw`; see rngMilestoneSatisfied.
      rng: rngMilestoneSatisfied({ live, hasIndexedFinalWord: hasFinalWord }),
      coinflip: live ? live.coinflipReady : true,
      packs: live ? live.ticketsReady : true,
      jackpot: live ? live.jackpotReady : true,
      draw: Boolean(hasFinalWord && rng?.mainTraitsPacked != null && rng?.bonusTraitsPacked != null),
      // One milestone: #loadDayRolls resolves both endpoints together and the
      // caller assigns both fields in one block, so a half-loaded pair is a
      // failed fetch awaiting retry, never an intermediate state to render.
      rolls: Number(this.#dayRoll1?.day) === target && Array.isArray(this.#dayRoll1?.wins)
        && Number(this.#dayRoll2?.day) === target && Array.isArray(this.#dayRoll2?.wins),
      // The seal is what makes a non-empty winner array trustworthy; see the
      // DailyWinningTraits note in #hasExactDayRolls.
      sealed: !this.hasAttribute('data-day-warming'),
    };
  }

  #jackpotProcessingStage() {
    const day = Number(this.#selectedDay);
    const { stage, latch } = latchedJackpotProcessingStage({
      day,
      milestones: this.#jackpotProcessingMilestones(day),
      latch: this.#jpProgressLatch,
    });
    this.#jpProgressLatch = latch;
    return stage;
  }

  #presentJackpotProcessingStage(target) {
    const out = jackpotProcessingPresentationStep({
      target,
      state: this.#jpPresentationState,
      day: this.#selectedDay,
    });
    this.#jpPresentationState = out.state;
    if (out.pending && this.#jpPresentationTimer == null && typeof setTimeout === 'function') {
      this.#jpPresentationTimer = setTimeout(() => {
        this.#jpPresentationTimer = null;
        this.#syncSpinControlState();
      }, Math.max(1, Number(out.delay) || 1));
      try { this.#jpPresentationTimer?.unref?.(); } catch { /* browser timer */ }
    } else if (!out.pending && this.#jpPresentationTimer != null) {
      try { clearTimeout(this.#jpPresentationTimer); } catch { /* defensive */ }
      this.#jpPresentationTimer = null;
    }
    return out;
  }

  #syncSpinControlState() {
    // Disarmed by default, re-armed only by the processing branch below. Every
    // other path through this method — spinning, decimator, day summary, spin
    // ready, coinflip handoff — is a state where the key has its own live
    // action, and the crank must not be able to eat that press.
    this.#mineFlipArmed = false;
    const btn = this.querySelector?.('[data-bind="reveal-btn"]');
    if (!btn) return;
    // Cleared here for the same reason as #mineFlipArmed above: only the
    // processing branch may set it, so no other path can inherit a stale
    // pickaxe from a state the key has already left.
    btn.removeAttribute?.('data-jp-action');
    // `data-jp-stage="rng"` begins at the day boundary so the LCD can describe
    // what the pipeline is waiting for. It is NOT proof that a request exists.
    // Keep that proof on its own short-lived hook; the Chainlink instrument and
    // its current layer use it to remain dormant until the exact-day watcher has
    // seen the request (or a later state that proves it happened).
    btn.removeAttribute?.('data-jp-rng-requested');
    // Contract/indexer polling continues while the reels animate. Those
    // refreshes own the processing labels, but they must never repaint an
    // already-running main or bonus action back to its idle CTA. The class is
    // set before the async trait reads begin, while #spinning covers the reel
    // loop itself, so together they close both sides of that race.
    if (this.#spinning || btn.classList?.contains('is-spinning')) {
      btn.disabled = true;
      btn.setAttribute?.('aria-busy', 'true');
      return;
    }
    const decimator = this.#primaryDecimatorAction;
    if (decimator) {
      const busy = this.#primaryDecimatorBusy || decimator.state === 'busy';
      const ready = decimator.state === 'ready' && typeof decimator.run === 'function';
      btn.hidden = false;
      btn.classList?.add('is-decimator');
      btn.classList?.remove('is-bonus', 'is-coinflip');
      if (btn.dataset) btn.dataset.replayAction = 'decimator';
      btn.classList?.toggle('is-processing', busy);
      btn.disabled = busy || this.#spinning || !ready;
      btn.textContent = this.#primaryDecimatorError
        ? 'DECIMATOR DRAW · TRY AGAIN'
        : busy
          ? (decimator.write === true ? 'RESOLVING DECIMATOR…' : 'LOADING DECIMATOR…')
          : (decimator.write === true ? 'RESOLVE + RUN DECIMATOR' : 'RUN DECIMATOR DRAW');
      btn.setAttribute?.('aria-label', btn.textContent);
      if (busy) btn.setAttribute?.('aria-busy', 'true');
      else btn.removeAttribute?.('aria-busy');
      btn.title = this.#primaryDecimatorError
        ? 'The draw could not be loaded. Press to try again.'
        : 'Open the resolved Decimator wheel';
      return;
    }
    btn.classList?.remove('is-decimator', 'is-coinflip');
    // DAY SUMMARY is another owner of this exact LCD face. On reload its
    // durable completion gates can resolve while the replay fetch is still
    // marked loading; give the already-valid summary precedence so a later
    // loading repaint cannot put two controls in the one hardware socket.
    const resultsCta = this.querySelector?.('.ldj-results-cta');
    if (resultsCta && resultsCta.hidden === false) {
      btn.hidden = true;
      btn.classList?.remove('is-processing', 'is-bonus');
      if (btn.dataset) delete btn.dataset.replayAction;
      btn.style?.removeProperty?.('--jp-progress');
      btn.removeAttribute?.('data-jp-stage');
      btn.removeAttribute?.('aria-busy');
      btn.removeAttribute?.('aria-label');
      return;
    }
    const sourceProcessing = this.hasAttribute('data-day-warming')
      || this.hasAttribute('data-day-loading');
    let stage = null;
    let presentationPending = false;
    if (sourceProcessing || this.#jpPresentationArmed) {
      const target = this.#jackpotProcessingStage();
      if (this.#jpPresentationArmed) {
        const presentation = this.#presentJackpotProcessingStage(target);
        stage = presentation.stage;
        presentationPending = presentation.pending;
        if (!presentationPending && stage.key === 'ready') {
          this.#jpPresentationArmed = false;
        }
      } else {
        stage = target;
      }
    }
    const exactDayReady = this.#dayDataReady(this.#selectedDay);
    const control = jackpotSpinControlState({
      sourceProcessing,
      presentationPending,
      presentationArmed: this.#jpPresentationArmed,
      stage,
      dayReady: exactDayReady,
    });
    stage = control.stage;
    const processing = control.processing;
    btn.classList?.toggle('is-processing', processing);
    if (processing) {
      // The processing LCD and a scratched result can never describe the same
      // selected day. A late persisted restore used to win this render race at
      // the Mine FLIP step, replacing the live attract reel with yesterday's
      // pink NO HIT board until the exact roll payload arrived. Retire that
      // stale result synchronously before painting the processing action.
      if (sourceProcessing) this.#keepProcessingReelLive();
      btn.hidden = false;
      stage ||= this.#jackpotProcessingStage();
      const rngRequestObserved = this.#jpProcessingSignals?.active === true
        && Number(this.#jpProcessingSignals?.day) === Number(this.#selectedDay)
        && this.#jpProcessingSignals?.requested === true;
      if (rngRequestObserved) {
        btn.setAttribute?.('data-jp-rng-requested', 'true');
      }
      // The one thing a player can DO while this window is open is turn the
      // crank. Availability is the resolver's, not ours: it publishes the row
      // only when a simulated mineFlip actually succeeds, so an armed key means
      // the chain really does have pending work for this wallet right now. An
      // in-flight call disarms it, which is what stops a double-fire; the
      // resolver re-probes and republishes after each receipt, and that
      // re-arms the key for the next call.
      const mineFlipKeyActive = this.#mineFlipKeyPhaseActive();
      this.#mineFlipArmed = mineFlipKeyActive && this.#mineFlipCallable();
      if (btn.dataset) {
        btn.dataset.replayAction = this.#mineFlipArmed ? 'mine-flip' : 'processing';
      }
      btn.disabled = !this.#mineFlipArmed;
      // The LABEL follows the resolver-owned PHASE, not the momentary armed
      // flag or a second RNG witness: a press
      // disarms the key for the length of its transaction, and the key must
      // keep saying what it is doing across that whole window. With no crank
      // published at all it still falls back to the stage, so a wallet-less or
      // finished board never advertises an action nobody can take.
      const crankLabel = mineFlipKeyActive;
      btn.textContent = crankLabel
        ? (this.#mineFlipBusy ? MINE_FLIP_MINING_LABEL : MINE_FLIP_CRANK_LABEL)
        : stage.label;
      // The LCD's indicator glyph is keyed off data-jp-stage, so while the key
      // is naming the crank it would still be showing the pipeline stage's own
      // mark — the coinflip stage paints a full-colour ETH coin face there.
      // This attribute is the hook that swaps in the pickaxe for exactly this
      // state; every other state keeps whatever its stage puts there.
      if (crankLabel) btn.setAttribute?.('data-jp-action', 'mine-flip');
      // The fill and the flame cadence are both driven off this one number, so
      // there is exactly one place where progress can disagree with itself.
      btn.style?.setProperty?.('--jp-progress', String(stage.progress));
      btn.setAttribute?.('data-jp-stage', stage.key);
      btn.setAttribute?.('aria-busy', 'true');
      btn.setAttribute?.(
        'aria-label',
        crankLabel
          ? `${btn.textContent}. ${stage.label}. Step ${stage.done} of ${stage.total}.`
          : `${stage.label}. Step ${stage.done} of ${stage.total}.`,
      );
      btn.title = stage.label;
      return;
    }
    btn.style?.removeProperty?.('--jp-progress');
    btn.removeAttribute?.('data-jp-stage');
    btn.removeAttribute?.('aria-busy');
    btn.removeAttribute?.('aria-label');
    if (this.#coinflipHandoffReady()) {
      btn.hidden = false;
      btn.classList?.remove('is-bonus');
      btn.classList?.add('is-coinflip');
      if (btn.dataset) btn.dataset.replayAction = 'coinflip';
      btn.disabled = this.#coinflipHandoffStarting;
      btn.textContent = this.#coinflipHandoffStarting ? 'COIN FLIPPING…' : COINFLIP_LABEL;
      btn.title = this.#coinflipHandoffStarting
        ? 'The Community Coinflip is playing'
        : 'Reveal the Community Coinflip';
      btn.setAttribute?.('aria-label', btn.textContent);
      return;
    }
    if (this.#singleButton() && this.#jackpotSpinsComplete()) {
      // Once the player's draw actions are exhausted this LCD would otherwise
      // be an empty hardware socket. Let the resolver-owned permissionless
      // crank occupy that fallback, but only after Decimator, Day Summary,
      // processing state, and the Community Coinflip have all had priority.
      if (this.#paintMineFlipFallback(btn)) return;
      btn.hidden = true;
      if (btn.dataset) delete btn.dataset.replayAction;
      return;
    }
    btn.hidden = false;
    if (btn.dataset) btn.dataset.replayAction = this.#btnMode;
    btn.classList?.toggle('is-bonus', this.#btnMode === 'bonus');
    if (this.#btnMode === 'bonus') {
      const ready = this.#mainReadyForBonus();
      btn.textContent = ready ? BONUS_SPIN_LABEL : BONUS_SPIN_LOCKED_LABEL;
      btn.disabled = !ready || !this.#dayDataReady(this.#selectedDay);
      btn.title = ready ? '' : 'Scratch blue and gold panels first';
    } else {
      btn.textContent = MAIN_SPIN_LABEL;
      btn.disabled = !exactDayReady;
      btn.title = '';
    }
  }

  #setPrimaryDecimatorAction(items) {
    const next = (Array.isArray(items) ? items : []).find((item) => (
      item?.kind === 'decimator' && item?.primarySurface === 'jackpot'
    )) || null;
    const btn = this.querySelector?.('[data-bind="reveal-btn"]');

    if (next && !this.#primaryDecimatorAction && btn) {
      this.#revealStateBeforeDecimator = {
        hidden: Boolean(btn.hidden),
        disabled: Boolean(btn.disabled),
        textContent: btn.textContent,
        title: btn.title || '',
        ariaBusy: btn.getAttribute?.('aria-busy'),
        ariaLabel: btn.getAttribute?.('aria-label'),
        isBonus: Boolean(btn.classList?.contains('is-bonus')),
        isProcessing: Boolean(btn.classList?.contains('is-processing')),
        isSpinning: Boolean(btn.classList?.contains('is-spinning')),
        jpProgress: btn.style?.getPropertyValue?.('--jp-progress') || '',
        jpStage: btn.getAttribute?.('data-jp-stage'),
      };
      this.setAttribute?.('data-primary-action', 'decimator');
    }

    const hadAction = Boolean(this.#primaryDecimatorAction);
    this.#primaryDecimatorAction = next;
    if (next) {
      this.#primaryDecimatorError = '';
      this.#syncSpinControlState();
      return;
    }
    if (!hadAction) return;

    this.removeAttribute?.('data-primary-action');
    this.#primaryDecimatorBusy = false;
    this.#primaryDecimatorError = '';
    if (btn && this.#revealStateBeforeDecimator) {
      const saved = this.#revealStateBeforeDecimator;
      const resultsCta = this.querySelector?.('.ldj-results-cta');
      btn.hidden = resultsCta && resultsCta.hidden === false ? true : saved.hidden;
      btn.disabled = saved.disabled;
      btn.textContent = saved.textContent;
      btn.title = saved.title;
      btn.classList?.remove('is-decimator');
      btn.classList?.toggle('is-bonus', saved.isBonus);
      btn.classList?.toggle('is-processing', saved.isProcessing);
      // Only re-apply the spin latch over a reel that is still turning. The
      // snapshot can outlive its spin, and #syncSpinControlState() refuses to
      // repaint a button carrying `is-spinning`, so restoring a stale one
      // locks the control for the rest of the day. A latch dropped a beat
      // early is cosmetic; the owning flow relabels when it lands.
      btn.classList?.toggle('is-spinning', saved.isSpinning && this.#spinning);
      if (saved.jpProgress) btn.style?.setProperty?.('--jp-progress', saved.jpProgress);
      else btn.style?.removeProperty?.('--jp-progress');
      if (saved.jpStage == null) btn.removeAttribute?.('data-jp-stage');
      else btn.setAttribute?.('data-jp-stage', saved.jpStage);
      if (saved.ariaBusy == null) btn.removeAttribute?.('aria-busy');
      else btn.setAttribute?.('aria-busy', saved.ariaBusy);
      if (saved.ariaLabel == null) btn.removeAttribute?.('aria-label');
      else btn.setAttribute?.('aria-label', saved.ariaLabel);
    }
    this.#revealStateBeforeDecimator = null;
    // The ordinary draw may have finished loading while Decimator owned this
    // button. Recompute from today's live readiness instead of leaving the
    // stale pre-takeover "JACKPOT PROCESSING" snapshot disabled forever.
    this.#syncSpinControlState();
  }

  /**
   * Mirror the resolver's published Mine FLIP row. Nothing about availability
   * is decided here: app-mine-flip.js publishes the row only when a simulated
   * `mineFlip()` succeeds for the connected wallet, and clears it when another
   * keeper wins the race. Reading that row is how this key stays honest.
   */
  #setMineFlipAction(items) {
    const next = (Array.isArray(items) ? items : []).find((item) => (
      typeof item?.id === 'string' && item.id.startsWith('mine-flip:')
    )) || null;
    const had = Boolean(this.#mineFlipAction);
    this.#mineFlipAction = next;
    if (next || had) this.#syncSpinControlState();
  }

  /** Test-only seam: the exact payload the pending-actions subscription hands us. */
  __setPendingActionsForTest(items) {
    this.#setPrimaryDecimatorAction(items);
    this.#setMineFlipAction(items);
  }

  /** Test-only seam: the press the armed LCD key performs. */
  __triggerMineFlipForTest() {
    return this.#triggerMineFlip();
  }

  /**
   * Test-only seam: pin the day the key is reporting on, without the network
   * load `#loadDay` would otherwise perform to set it.
   */
  __setSelectedDayForTest(day) {
    const target = Number(day);
    this.#selectedDay = Number.isInteger(target) && target > 0 ? target : null;
  }

  /** Test-only seam for the post-spin empty-LCD action priority. */
  __setCompletedSpinsForTest({ hasBonus = false, bonusComplete = true } = {}) {
    this.#hasBonus = Boolean(hasBonus);
    this.#mainSpinComplete = true;
    this.#bonusSpinComplete = !this.#hasBonus || Boolean(bonusComplete);
    this.#btnMode = 'reveal';
    this.#syncSpinControlState();
  }

  /**
   * Lowest-priority owner of the shared LCD: permissionless maintenance after
   * every player-facing draw action has vacated it.
   */
  #paintMineFlipFallback(btn) {
    if (!btn || !this.#mineFlipPhaseActive()) return false;
    this.#mineFlipArmed = this.#mineFlipCallable();
    btn.hidden = false;
    btn.classList?.remove('is-bonus', 'is-coinflip');
    btn.classList?.add('is-processing');
    if (btn.dataset) {
      btn.dataset.replayAction = this.#mineFlipArmed ? 'mine-flip' : 'processing';
    }
    btn.disabled = !this.#mineFlipArmed;
    btn.textContent = this.#mineFlipBusy ? MINE_FLIP_MINING_LABEL : MINE_FLIP_CRANK_LABEL;
    btn.title = 'Process pending jackpot work';
    btn.setAttribute?.('data-jp-action', 'mine-flip');
    btn.setAttribute?.('aria-label', btn.textContent);
    if (this.#mineFlipBusy) btn.setAttribute?.('aria-busy', 'true');
    else btn.removeAttribute?.('aria-busy');
    return true;
  }

  /**
   * Does the resolver-owned crank belong on this selected-day LCD?
   *
   * The resolver row is authoritative for whether Mine FLIP work exists, but
   * it is global and can briefly outlive this panel's exact-day processing
   * context. With live context present, keep both the label and click route
   * scoped to the selected active unresolved day. A warming panel without the
   * live feed yet may still trust the resolver row; its click re-probes before
   * opening the wallet.
   */
  #mineFlipKeyPhaseActive() {
    if (!this.#mineFlipPhaseActive()) return false;
    const live = this.#jpProcessingSignals;
    if (!live) return true;
    const target = Number(this.#selectedDay);
    return Number.isInteger(target)
      && target > 0
      && Number(live.day) === target
      && live.active === true
      && live.jackpotReady !== true;
  }

  /**
   * Is the crank the thing this key is FOR right now?
   *
   * Deliberately not the same question as #mineFlipCallable. Callability is
   * momentary — it drops the instant a press puts a transaction in flight, and
   * the resolver itself republishes the row as `state: 'busy'` while it runs —
   * so a label driven off it flipped back to the pipeline stage the moment the
   * player pressed the key, which is exactly when they most needed it to still
   * say what they had just started.
   *
   * The row EXISTING is the resolver's statement that this wallet has crank
   * work; its `state` only says whether it can be pressed this instant. So the
   * phase runs from the first published row until the resolver clears it —
   * which it does when the chain reports no work left, or the wallet goes
   * away. That makes the label a function of the phase: press, in flight,
   * confirm, re-arm and press again all sit inside it, and it ends only when
   * the processing branch yields to results/another action or the resolver
   * reports that mining is genuinely done.
   */
  #mineFlipPhaseActive() {
    return Boolean(this.#mineFlipAction) || this.#mineFlipBusy;
  }

  /** Callable right now: a ready row, a real runner, and nothing in flight. */
  #mineFlipCallable() {
    const action = this.#mineFlipAction;
    return Boolean(
      action
      && action.state === 'ready'
      && typeof action.run === 'function'
      && !this.#mineFlipBusy
      && !this.#spinning,
    );
  }

  /**
   * One deliberate press, one crank call. The resolver's own `run` re-probes at
   * intent time, opens the wallet, and refreshes the day feeds on a receipt, so
   * there is no transaction logic here and no loop: the player presses again
   * when the key re-arms.
   */
  async #triggerMineFlip() {
    if (!this.#mineFlipCallable()) return false;
    const action = this.#mineFlipAction;
    this.#mineFlipBusy = true;
    this.#syncSpinControlState();
    try {
      await action.run();
      return true;
    } catch (error) {
      // The tray owns the visible error surface for this action; this key just
      // stops claiming to be armed.
      console.warn('[replay-panel] Mine FLIP crank failed', error);
      return false;
    } finally {
      this.#mineFlipBusy = false;
      this.#syncSpinControlState();
    }
  }

  async #triggerPrimaryDecimator() {
    const action = this.#primaryDecimatorAction;
    if (!action || this.#primaryDecimatorBusy || this.#spinning
      || action.state !== 'ready' || typeof action.run !== 'function') return false;
    this.#primaryDecimatorBusy = true;
    this.#primaryDecimatorError = '';
    this.#syncSpinControlState();
    try {
      await action.run();
      return true;
    } catch (error) {
      console.warn('[replay-panel] Decimator draw failed', error);
      this.#primaryDecimatorError = 'retry';
      return false;
    } finally {
      this.#primaryDecimatorBusy = false;
      if (this.#primaryDecimatorAction) this.#syncSpinControlState();
    }
  }

  #scheduleDayDataReload(day) {
    const target = Number(day);
    if (!Number.isInteger(target) || target <= 0 || this.#dayReloadTimer != null) return;
    if (this.#dayReloadTarget !== target) {
      this.#dayReloadTarget = target;
      this.#dayReloadAttempt = 0;
    }
    const delay = dayDataRetryDelay(this.#dayReloadAttempt);
    this.#dayReloadAttempt += 1;
    this.#dayReloadTimer = setTimeout(async () => {
      this.#dayReloadTimer = null;
      if (Number(this.#selectedDay) !== target || this.#dayDataReady(target)) return;
      const expectedLoadSeq = this.#dayLoadSeq;
      // Refresh the RNG metadata as well as the roll endpoints. The day option
      // itself can arrive before its packed winning traits on an indexing edge.
      try { await this.refreshDays({ force: true }); } catch { /* retry rolls anyway */ }
      if (this.#dayLoadSeq !== expectedLoadSeq
        || Number(this.#selectedDay) !== target
        || this.#dayDataReady(target)) return;
      const select = this.querySelector('[data-bind="day-select"]');
      if (!select) return;
      select.value = String(target);
      void this.#onDayChange({ target: select, retry: true });
    }, delay);
    try { this.#dayReloadTimer?.unref?.(); } catch { /* browser timer */ }
  }

  /**
   * App-shell hook. `cleared` comes from the chain/day-scoped spun_day key.
   * Beta/play consumers never call this, so their replay behaviour is unchanged.
   */
  setPersistedRevealState(cleared, allRollsCleared = false) {
    if (!this.#singleButton()) return;
    const nextCleared = Boolean(cleared);
    const nextAllRollsCleared = Boolean(nextCleared && allRollsCleared);
    const requestKey = this.#persistedRevealKey(nextCleared, nextAllRollsCleared);
    // Routine same-day polling must not rebuild the visible draw. In
    // particular, #startIdleSpin() resets every quadrant before painting its
    // next frame, which looked like a random mid-day jackpot reset.
    if (this.#hostRevealRequestKey === requestKey) return;
    this.#hostRevealCleared = nextCleared;
    this.#hostAllRollsCleared = nextAllRollsCleared;
    this.#hostRevealRequestKey = requestKey;
    this.#hostRevealSeq += 1;
    // A polling/bridge update for the draw the player is actively uncovering
    // must not put the attract reel over that live board. This guard has to run
    // before the eager idle paint below, not only before the async restore.
    if (this.#selectionKey() === this.#interactiveRevealKey) return;
    // The host can learn that a brand-new day is uncleared before the replay
    // endpoints finish loading it. Start the quiet attract reels immediately;
    // #applyPersistedRevealState restarts them with the exact level holdings
    // once that asynchronous selection is fully pinned.
    if (!nextCleared && !this.#spinning) {
      this.#startIdleSpin();
    }
    void this.#applyPersistedRevealState(this.#hostRevealSeq);
  }

  #selectionKey() {
    if (this.#selectedDay == null || !this.#selectedPlayer) return null;
    return `${Number(this.#selectedDay)}|${String(this.#selectedPlayer).toLowerCase()}`;
  }

  #interactiveSelectionActive(selectionKey = this.#selectionKey()) {
    return selectionKey != null && selectionKey === this.#interactiveRevealKey;
  }

  #claimInteractiveReveal(selectionKey) {
    if (selectionKey == null) return;
    this.#interactiveRevealKey = selectionKey;
    // Invalidate a persisted-state restore that began before the press. Its
    // network read may finish after the real reel starts; that older task must
    // not put the attract reel or an instant restored board over the player's
    // live result.
    this.#hostRevealSeq += 1;
  }

  #persistedRevealKey(cleared, allRollsCleared) {
    const selection = this.#selectionKey() || 'selection-pending';
    return `${selection}|${cleared ? 'cleared' : 'waiting'}`
      + `|${allRollsCleared ? 'all-rolls' : 'main-only'}`;
  }

  async #applyPersistedRevealState(seq = this.#hostRevealSeq) {
    if (this.#hostRevealCleared == null
      || this.#selectedDay == null
      || !this.#selectedPlayer
      || this.#loadedDay !== this.#selectedDay) return false;
    if (this.#interactiveSelectionActive()) return false;

    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    if (!rngEntry || !rngEntry.finalWord || rngEntry.finalWord === '0') {
      return false;
    }

    const day = this.#selectedDay;
    const player = this.#selectedPlayer;
    const cleared = this.#hostRevealCleared;
    const key = this.#persistedRevealKey(cleared, this.#hostAllRollsCleared);
    // Day/player changes can invoke this method directly after their data
    // finishes loading. Record that request too, so the next host poll cannot
    // eagerly repaint while this restore is in flight.
    this.#hostRevealRequestKey = key;
    if (this.#hostRevealAppliedKey === key) return true;

    if (cleared) {
      this.#stopIdleSpin();
      const restored = await this.#triggerReveal({ instant: true, persisted: true });
      if (!restored) return false;
      if (seq !== this.#hostRevealSeq
        || day !== this.#selectedDay
        || player !== this.#selectedPlayer) return false;
      this.#restoreCompletedDrawViews();
    } else {
      await this.#loadPlayerTraits();
      if (seq !== this.#hostRevealSeq
        || day !== this.#selectedDay
        || player !== this.#selectedPlayer
        || this.#hostRevealCleared !== false
        || this.#interactiveSelectionActive()) return false;
      this.#startIdleSpin();
    }

    if (seq !== this.#hostRevealSeq
      || day !== this.#selectedDay
      || player !== this.#selectedPlayer) return false;
    this.#hostRevealAppliedKey = key;
    return true;
  }

  /**
   * A completed two-roll day always reloads onto the cleared main draw. The
   * bonus result remains available through the center flame, but its purchase-
   * style button must not come back after refresh.
   */
  #restoreCompletedDrawViews() {
    if (!this.#hostAllRollsCleared || !this.#hasBonus) return;
    this.#bonusPhase = false;
    this.#mainScratchComplete = true;
    this.#mainPotentialScratchComplete = true;
    this.#bonusScratchComplete = true;
    this.#mainSpinComplete = true;
    this.#bonusSpinComplete = true;
    this.#btnMode = 'reveal';
    const btn = this.querySelector('[data-bind="reveal-btn"]');
    if (btn) {
      btn.hidden = true;
      btn.disabled = true;
      btn.title = '';
    }
    const bonusSection = this.querySelector('[data-bind="bonus-section"]');
    if (bonusSection) bonusSection.hidden = true;
    this.#syncDrawToggleAffordance();
    this.#syncSpinControlState();
  }

  #idleSpinWanted() {
    return replayAttractShouldRun({
      revealCleared: this.#hostRevealCleared,
      dayLoading: this.hasAttribute('data-day-loading'),
      dayWarming: this.hasAttribute('data-day-warming'),
      spinning: this.#spinning,
      interactiveReveal: this.#interactiveSelectionActive(),
    });
  }

  #keepProcessingReelLive() {
    if (this.#spinning || !this.#idleSpinWanted()) return;
    const processingDay = Number(this.#jpProcessingSignals?.day);
    const selectedDay = Number(this.#selectedDay);
    if (!Number.isInteger(processingDay) || processingDay <= 0
      || processingDay !== selectedDay) return;

    const staleResult = Array.from(this.querySelectorAll('.replay-tq')).some((quad) => (
      quad.classList?.contains('q-result-revealed')
      || quad.classList?.contains('q-public-result')
      || quad.classList?.contains('q-scratch-underlay')
      || quad.classList?.contains('q-result-pending')
      || quad.querySelector?.('.replay-prize-reveal')?.classList?.contains('visible')
    ));
    if (!staleResult) return;

    // Force one clean restart even if the attract timer itself survived. The
    // ordinary #startIdleSpin guard intentionally treats a running timer as a
    // no-op; here the timer is alive but its visible layers were overwritten.
    this.#stopIdleSpin();
    this.#startIdleSpin();
  }

  #startIdleSpin() {
    // Starting an attract reel that is already running is a no-op. This is the
    // final safety boundary around the visible ticket: even if a future host
    // refresh produces a different request key, it cannot clear four painted
    // badges merely to restart the same timer loop.
    if (this.#idleSpinTimer != null && this.#idleSpinWanted()) return;
    this.#stopIdleSpin();
    if (!this.#idleSpinWanted()) return;
    if (this.querySelectorAll('.replay-tq').length < 4) return;

    // Always enter the attract loop from one clean main-draw face. A previous
    // bonus scratch can leave transparent canvases, revealed prize paper, and
    // result classes mounted; random badge swaps on top of those layers produce
    // the mixed front/underside frame reported during bonus clearing.
    this.#bonusPhase = false;
    this.#mainScratchComplete = false;
    this.#mainPotentialScratchComplete = false;
    this.#bonusScratchComplete = false;
    this.#drawViewSwitching = false;
    this.#resetMainWidget();
    this.#syncDrawToggleAffordance();

    const tick = () => {
      this.#idleSpinTimer = null;
      if (!this.#idleSpinWanted()) {
        this.querySelector('[data-bind="center"]')?.classList.remove('spinning');
        return;
      }
      const quads = this.querySelectorAll('.replay-tq');
      for (let i = 0; i < 4; i++) {
        const contractQ = DISPLAY_ORDER[i];
        const sym = Math.floor(Math.random() * 8);
        const col = Math.floor(Math.random() * 8);
        const category = BADGE_QUADRANTS[contractQ];
        const img = quads[i]?.querySelector('.badge-img');
        if (img) {
          img.src = badgeCircularPath(category, sym, col);
          img.style.display = '';
          img.style.opacity = '1';
        }
        quads[i]?.classList.remove(
          'q-has-trait', 'q-no-tickets', 'q-traits-pending', 'q-scratchable', 'q-has-tickets',
          'q-public-result', 'q-win-impossible', 'q-win-impossible-lock',
          'q-owned-miss', 'q-player-win', 'q-solo-eth-win',
          'q-gold-trait', 'q-scratch-underlay', 'q-result-pending', 'q-result-revealed',
        );
        const shownTrait = contractQ * 64 + col * 8 + sym;
        const ownsShown = !this.#playerTraitsPending && this.#playerTraitIds.has(shownTrait);
        quads[i]?.classList.add(
          this.#playerTraitsPending
            ? 'q-traits-pending'
            : ownsShown ? 'q-has-trait' : 'q-no-tickets',
        );
        if (!this.#bonusPhase && !this.#playerTraitsPending && ownsShown && col === 7) {
          quads[i]?.classList.add('q-gold-trait');
        }
      }
      this.#syncOwnedGoldState(quads);
      this.querySelector('[data-bind="center"]')?.classList.add('spinning');

      // Deliberately much slower than the reveal animation. This is a quiet
      // attract loop, not a second outcome animation.
      this.#idleSpinTimer = setTimeout(tick, 620);
      if (this.#idleSpinTimer && typeof this.#idleSpinTimer.unref === 'function') {
        this.#idleSpinTimer.unref();
      }
    };
    tick();
  }

  #stopIdleSpin() {
    if (this.#idleSpinTimer != null) {
      try { clearTimeout(this.#idleSpinTimer); } catch { /* defensive */ }
      this.#idleSpinTimer = null;
    }
    if (!this.#spinning) {
      this.querySelector('[data-bind="center"]')?.classList.remove('spinning');
    }
  }

  // Decode-warm all 256 badges so spin src-swaps render instantly. Awaits the
  // badge bundle FIRST — generating paths before it lands resolves them to
  // /badges-circular/ file URLs and re-creates the 256-request cold-load storm
  // this preloader used to be. Once the bundle is in, every path below is a
  // local blob URL and the whole warm costs zero network.
  async #preloadBadges() {
    await warmBadgeStore();
    const BADGE_CATEGORIES = ['crypto', 'zodiac', 'cards', 'dice'];
    let i = 0;
    const paths = [];
    for (const cat of BADGE_CATEGORIES) {
      for (let sym = 0; sym < 8; sym++) {
        for (let col = 0; col < 8; col++) {
          paths.push(badgeCircularPath(cat, sym, col));
        }
      }
    }
    // Load one at a time to avoid flooding the network on first visit
    const loadNext = () => {
      if (i >= paths.length) return;
      const path = paths[i++];
      if (this.#badgeCache.has(path)) { loadNext(); return; }
      const img = new Image();
      img.onload = img.onerror = () => {
        this.#badgeCache.set(path, img);
        loadNext();
      };
      img.src = path;
    };
    // Kick off up to 8 parallel preload chains
    const concurrency = Math.min(8, paths.length);
    for (let c = 0; c < concurrency; c++) loadNext();
  }

  // --- Data Loading ---

  /**
   * Refresh the day option source. The app's last-day bridge calls this when a
   * newly resolved day is not in the once-loaded list yet. Calls coalesce, and
   * a short throttle lets the bridge retry without hammering the replay API.
   * @returns {Promise<boolean>}
   */
  refreshDays({ force = false } = {}) {
    if (this.#tutorialFixture) return Promise.resolve(true);
    if (this.#daysRefreshPromise) return this.#daysRefreshPromise;
    const now = Date.now();
    // A 429 applies to this whole API origin. Forced rollover retries must not
    // bypass Retry-After, and even a cold/empty selector gets the ordinary
    // short throttle so the host's 500ms bridge cannot create a request loop.
    if (replayApiCooldownRemaining(now) > 0
      || (!force && now - this.#lastDaysRefreshAt < 2_000)) {
      return Promise.resolve(false);
    }
    this.#lastDaysRefreshAt = now;
    const pending = this.#loadDays();
    const tracked = pending.finally(() => {
      if (this.#daysRefreshPromise === tracked) this.#daysRefreshPromise = null;
    });
    this.#daysRefreshPromise = tracked;
    return this.#daysRefreshPromise;
  }

  async #loadDays() {
    const select = this.querySelector('[data-bind="day-select"]');
    // Rebuilding a <select> clears its value before the app shell can pin it
    // again. Preserve the logical selection as well as the DOM value: during
    // indexer catch-up the latter can already be empty even though this panel
    // is still displaying a perfectly valid day.
    const previous = String(select?.value || this.#selectedDay || '');
    const previousOption = select?.options
      ? Array.from(select.options).find((option) => String(option.value) === previous)
      : null;
    try {
      const data = await replayFetch('/rng', { cache: 'no-store' });
      if (this.#tutorialFixture) return true;
      const days = Array.isArray(data?.days) ? data.days : [];
      this.#rngDays = days;
      if (!select) return false;
      select.innerHTML = '<option value="">Pick a jackpot day</option>' +
        days.map(d => `<option value="${d.day}">Day ${d.day} — L${d.level} ${d.phase}${d.dayInPhase}</option>`).join('');
      if (previous) {
        let matching = Array.from(select.options || [])
          .find((option) => String(option.value) === previous);
        // A resolved day cannot legitimately disappear from the replay feed.
        // Keep its option through a transient partial response so the bridge
        // cannot manufacture an empty -> same-day change and blank the board.
        if (!matching && typeof document !== 'undefined'
          && typeof document.createElement === 'function') {
          matching = document.createElement('option');
          matching.value = previous;
          matching.textContent = previousOption?.textContent || `Day ${previous}`;
          matching.dataset.retainedSelection = 'true';
          select.appendChild(matching);
        }
        if (matching) select.value = matching.value;
      }
      return true;
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load days:', err);
      // A network blip is not a day change. Keep the last usable options and
      // visible board; only show the failure placeholder on a true cold load.
      const hasUsableDay = select?.options
        && Array.from(select.options).some((option) => Number(option.value) > 0);
      if (select && !hasUsableDay) {
        select.innerHTML = '<option value="">Failed to load</option>';
      }
      return false;
    }
  }

  async #loadTickets(level) {
    try {
      const data = await replayFetch(`/tickets/${level}`);
      const players = Array.isArray(data?.players) ? data.players : [];
      this.#tickets = players;

      // Compute winnings per player from distributions (ETH vs FLIP)
      const ethByAddr = {};
      const flipByAddr = {};
      let ethCount = 0, flipCount = 0;
      for (const dist of this.#distributions) {
        const addr = dist.winner.toLowerCase();
        const t = dist.awardType || '';
        const isFlip = dist.currency === 'FLIP' || t === 'flip' || t === 'farFutureCoin';
        const isEth = t === 'eth';
        if (isFlip) {
          flipByAddr[addr] = (flipByAddr[addr] || 0n) + BigInt(dist.amount || '0');
        } else if (isEth) {
          ethByAddr[addr] = (ethByAddr[addr] || 0n) + BigInt(dist.amount || '0');
        }
      }

      const select = this.querySelector('[data-bind="player-select"]');
      const previous = String(this.#selectedPlayer || select?.value || '');
      const previousOption = select?.options
        ? Array.from(select.options).find(
            (option) => String(option.value).toLowerCase() === previous.toLowerCase(),
          )
        : null;
      select.innerHTML = '<option value="">All players (' + players.length + ')</option>' +
        players.map(p => {
          const addr = p.address.toLowerCase();
          const eth = ethByAddr[addr];
          const flip = flipByAddr[addr];
          const parts = [];
          if (eth) parts.push(`${formatEth(eth.toString())} ETH`);
          if (flip) parts.push(`${formatFlip(flip.toString())} FLIP`);
          const wonLabel = parts.length > 0 ? ` | Won ${parts.join(' + ')}` : '';
          return `<option value="${p.address}">${truncateAddress(p.address)} (${p.entryCount} entries${wonLabel})</option>`;
        }).join('');

      if (previous) {
        let matching = Array.from(select.options || []).find(
          (option) => String(option.value).toLowerCase() === previous.toLowerCase(),
        );
        // The app intentionally supports viewing a wallet with zero entries.
        // Retain that synthetic selection when the level's ticket list reloads
        // instead of briefly selecting "All players" and resetting the draw.
        if (!matching && typeof document !== 'undefined'
          && typeof document.createElement === 'function') {
          matching = document.createElement('option');
          matching.value = previous;
          matching.textContent = previousOption?.textContent
            || `${truncateAddress(previous)} (0 entries)`;
          matching.dataset.zeroEntry = 'true';
          select.appendChild(matching);
        }
        if (matching) select.value = matching.value;
      }

      this.#players = players.map(p => p.address);
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load tickets:', err);
    }
  }

  async #loadDayDetail(day) {
    try {
      const data = await replayFetch(`/day/${day}`, { cache: 'no-store' });
      return data;
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load day detail:', err);
      return null;
    }
  }

  async #loadDayRolls(day) {
    let roll1 = null;
    let roll2 = null;
    const [r1Res, r2Res] = await Promise.allSettled([
      fetchJSON(`/game/jackpot/day/${day}/roll1`, { force: true }),
      fetchJSON(`/game/jackpot/day/${day}/roll2`, { force: true }),
    ]);
    if (r1Res.status === 'fulfilled') roll1 = r1Res.value;
    else noteReplayApiResponse(r1Res.reason?.response);
    if (r2Res.status === 'fulfilled') roll2 = r2Res.value;
    else noteReplayApiResponse(r2Res.reason?.response);
    if (!roll1) console.warn('[ReplayPanel] roll1 endpoint unavailable for day', day);
    if (!roll2) console.warn('[ReplayPanel] roll2 endpoint unavailable for day', day);
    return { roll1, roll2 };
  }

  #isOpeningFlipDraw(day) {
    const row = this.#rngDays.find((entry) => Number(entry.day) === Number(day));
    // During game level 0 the replay clock correctly advertises the tickets on
    // sale (L1), so L1 purchase-phase rows are the opening double-FLIP path.
    return Number(row?.level) === 1 && String(row?.phase || '').toUpperCase() === 'P';
  }

  #packedTraits(packed) {
    if (packed == null) return [];
    const value = Number(packed) >>> 0;
    return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
  }

  #repairOpeningFlipRolls(day) {
    this.#openingFlipDay = this.#isOpeningFlipDraw(day);
    if (!this.#openingFlipDay) return;
    const rng = this.#rngDays.find((entry) => Number(entry.day) === Number(day));
    const { mainWins, bonusWins } = splitOpeningFlipDraw(
      this.#distributions,
      this.#packedTraits(rng?.mainTraitsPacked),
      this.#packedTraits(rng?.bonusTraitsPacked),
    );
    this.#dayRoll1 = { day: Number(day), level: 0, purchaseLevel: 1, wins: mainWins };
    this.#dayRoll2 = { day: Number(day), level: 0, purchaseLevel: 1, wins: bonusWins };
  }

  #filterPlayerWins(addr) {
    const norm = addr.toLowerCase();
    this.#playerRoll1Wins = (this.#dayRoll1?.wins || [])
      .filter(w => String(w?.winner || '').toLowerCase() === norm);
    this.#playerRoll2Wins = (this.#dayRoll2?.wins || [])
      .filter(w => String(w?.winner || '').toLowerCase() === norm);
    // The bonus draw is public just like Roll 1. An exact Roll 2 payload is the
    // authoritative witness even when its valid public result has zero winners;
    // player holdings control only cover colour and personal payout.
    const hasResolvedRoll2 = Number(this.#dayRoll2?.day) === Number(this.#selectedDay)
      && Array.isArray(this.#dayRoll2?.wins);
    this.#hasBonus = hasResolvedRoll2;
  }

  // Pulled by #onDayChange/#onPlayerChange after fetching player.tickets.
  // True when the player owns >0 tickets at any level > the day's level
  // (near-future) OR any level the contract has not yet drawn (far-future,
  // already covered by the same > dayLevel comparison since draws are level-
  // ordered).
  async #refreshPlayerEligibility() {
    if (this.#tutorialFixture) {
      this.#playerHasFutureTickets = this.#tutorialFixture.futureTraits.size > 0;
      return;
    }
    this.#playerHasFutureTickets = null;
    if (!this.#selectedPlayer || !this.#selectedDay) return;
    const dayLevel = Number(this.#dayRoll1?.purchaseLevel ?? this.#selectedLevel);
    if (!Number.isFinite(dayLevel)) return;
    try {
      const data = await fetchJSON(`/player/${encodeURIComponent(this.#selectedPlayer)}?day=${encodeURIComponent(this.#selectedDay)}`);
      const tickets = Array.isArray(data?.tickets) ? data.tickets : [];
      this.#playerHasFutureTickets = tickets.some((t) => Number(t.level) > dayLevel && Number(t.entryCount ?? 0) > 0);
    } catch {
      this.#playerHasFutureTickets = null;
    }
  }

  async #loadDistributionsForLevel(level) {
    // Try new endpoint first (has traitId), fall back to history endpoint
    try {
      const data = await replayFetch('/distributions/' + level);
      this.#distributions = data.distributions || [];
      return;
    } catch {}
    try {
      const data = await fetchJSON('/history/jackpots?level=' + level + '&limit=100');
      this.#distributions = (data.items || []).map(d => ({
        level: d.level, winner: d.winner, amount: d.amount,
        traitId: d.traitId ?? null, ticketIndex: d.ticketIndex ?? null,
        awardType: d.awardType,
      }));
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load distributions:', err);
    }
  }

  // Traits the player holds ABOVE the day's level — what Roll 2 grades against.
  // Bounded by FAR_FUTURE_HORIZON: levels past it have no rolled traits, so
  // fetching them would cost a request per level to learn nothing.
  //
  // Shared flight: the warm-up the main spin starts and the bonus press itself
  // await one hydration instead of racing two identical waves through the
  // transport's three-slot personalized lane. If the player reaches Bonus Spin
  // before that background warm finishes, attach interaction-priority consumers
  // to the same URL-keyed requests so queued levels are promoted, not duplicated.
  #promoteFutureTraitReads() {
    const dayLevel = Number(this.#dayRoll1?.purchaseLevel ?? this.#selectedLevel);
    if (!this.#selectedPlayer || !Number.isFinite(dayLevel)) return;
    for (let level = dayLevel + 1; level <= dayLevel + FAR_FUTURE_HORIZON; level += 1) {
      void fetchJSON(
        `/player/${encodeURIComponent(this.#selectedPlayer)}/tickets/by-trait?level=${level}`,
        { priority: 'interaction' },
      ).catch(() => null);
    }
  }

  #loadFutureTraits({ priority = 'background' } = {}) {
    if (this.#futureTraitsInflight) {
      if (priority === 'interaction') this.#promoteFutureTraitReads();
      return this.#futureTraitsInflight;
    }
    const flight = this.#hydrateFutureTraits(priority).finally(() => {
      if (this.#futureTraitsInflight === flight) this.#futureTraitsInflight = null;
    });
    this.#futureTraitsInflight = flight;
    return flight;
  }

  async #hydrateFutureTraits(priority = 'background') {
    if (this.#tutorialFixture) {
      this.#futureTraitIds = new Set(this.#tutorialFixture.futureTraits);
      this.#futureTraitsCacheKey = `${this.#tutorialFixture.player}|${this.#tutorialFixture.purchaseLevel}`;
      return;
    }
    const dayLevel = Number(this.#dayRoll1?.purchaseLevel ?? this.#selectedLevel);
    if (!this.#selectedPlayer || !Number.isFinite(dayLevel)) {
      this.#futureTraitIds = new Set();
      this.#futureTraitsCacheKey = null;
      return;
    }
    const cacheKey = `${this.#selectedPlayer.toLowerCase()}|${dayLevel}`;
    if (this.#futureTraitsCacheKey === cacheKey) return;

    const levels = [];
    for (let l = dayLevel + 1; l <= dayLevel + FAR_FUTURE_HORIZON; l++) levels.push(l);
    const owned = new Set();
    try {
      const payloads = await Promise.all(levels.map(async (l) => {
        // No &day= param — same 404 gotcha as #loadPlayerTraits.
        return fetchJSON(
          `/player/${encodeURIComponent(this.#selectedPlayer)}/tickets/by-trait?level=${l}`,
          { priority },
        )
          .catch(() => null);
      }));
      for (const data of payloads) {
        for (const card of (Array.isArray(data?.cards) ? data.cards : [])) {
          for (const entry of (Array.isArray(card?.entries) ? card.entries : [])) {
            if (entry && entry.traitId != null) owned.add(Number(entry.traitId));
          }
        }
      }
      this.#futureTraitIds = owned;
      // Each level catches its own rejection, so a shed/cooldown burst that
      // failed every request still arrives here as an empty set. Caching that
      // as the answer painted every bonus quadrant red for the rest of the
      // session with no retry. An answer needs at least one real payload.
      this.#futureTraitsCacheKey = payloads.some((data) => data != null)
        ? cacheKey
        : null;
    } catch (err) {
      console.warn('[ReplayPanel] Failed to load future-level traits:', err);
      // Fail-closed, like #loadPlayerTraits: an empty set spins red rather than
      // promising a match the player does not hold.
      this.#futureTraitIds = new Set();
      this.#futureTraitsCacheKey = null;
    }
  }

  async #loadPlayerTraits() {
    const loadSeq = ++this.#playerTraitsLoadSeq;
    if (this.#tutorialFixture) {
      this.#playerTraitIds = new Set(this.#tutorialFixture.playerTraits);
      this.#traitsCacheAddress = `${this.#tutorialFixture.player}|${this.#tutorialFixture.purchaseLevel}`;
      this.#playerTraitsPending = false;
      return;
    }
    if (!this.#selectedPlayer) {
      this.#playerTraitIds = new Set();
      this.#traitsCacheAddress = null;
      this.#playerTraitsPending = false;
      return;
    }
    // Roll 1 samples its winners from tickets at the day's PURCHASE level, so
    // scratch eligibility must be scoped to the traits the player holds at
    // that level. The old /replay/player-traits endpoint aggregated ALL
    // levels, which lit quadrants scratchable for players who could never
    // win the day's draw (user bug report: "should be red and unscratchable").
    const level = replayHoldingsLevel({
      exactPurchaseLevel: this.#dayRoll1?.purchaseLevel,
      processingPurchaseLevel: this.#jpProcessingSignals?.purchaseLevel,
      processingDay: this.#jpProcessingSignals?.day,
      selectedDay: this.#selectedDay,
      selectedLevel: this.#selectedLevel,
    });
    if (level == null) {
      this.#playerTraitIds = new Set();
      this.#traitsCacheAddress = null;
      // The selected day is still resolving its purchase level. This is an
      // unknown cohort, not proof that the player owns no traits.
      this.#playerTraitsPending = true;
      return;
    }
    const player = this.#selectedPlayer;
    const cacheKey = `${player.toLowerCase()}|${level}`;
    if (this.#traitsCacheAddress === cacheKey) {
      this.#playerTraitsPending = false;
      return;
    }
    this.#playerTraitsPending = true;
    try {
      // No &day= param — the endpoint 404s on days without an indexed
      // daily_rng row (same gotcha as app-tickets-inventory).
      const data = await fetchJSON(
        `/player/${encodeURIComponent(player)}/tickets/by-trait?level=${level}`,
        { priority: 'interaction' },
      );
      if (loadSeq !== this.#playerTraitsLoadSeq
        || String(this.#selectedPlayer || '').toLowerCase() !== player.toLowerCase()) return;
      const owned = new Set();
      for (const card of (Array.isArray(data?.cards) ? data.cards : [])) {
        for (const entry of (Array.isArray(card?.entries) ? card.entries : [])) {
          if (entry && entry.traitId != null) owned.add(Number(entry.traitId));
        }
      }
      this.#playerTraitIds = owned;
      this.#traitsCacheAddress = cacheKey;
      this.#playerTraitsPending = false;
    } catch (err) {
      if (loadSeq !== this.#playerTraitsLoadSeq) return;
      console.warn('[ReplayPanel] Failed to load player traits:', err);
      // Fail-closed: an empty set renders non-winning quadrants red and
      // unscratchable instead of inviting a scratch that can't pay.
      this.#playerTraitIds = new Set();
      this.#traitsCacheAddress = null;
      this.#playerTraitsPending = false;
    }
  }

  // --- Event Handlers ---

  async #onDayChange(e) {
    const dayNum = Number.parseInt(e?.target?.value, 10);
    const validDay = Number.isInteger(dayNum) && dayNum > 0;
    const sameDay = validDay && Number(this.#selectedDay) === dayNum;
    // A same-day bridge/poll event is never a new reveal. Once the player has
    // started this exact day/address, preserve its landed or in-flight board
    // even if a transient warming flag makes #dayDataReady() false. The player
    // could not have started this reveal without complete exact-day data.
    if (sameDay && this.#interactiveSelectionActive()) return true;
    // Same-day selector refreshes are normally inert. A day whose exact roll
    // payloads failed during rollover is the exception: keep it masked and
    // retry instead of declaring a half-loaded scratch board ready.
    if (sameDay && this.#dayDataReady(dayNum)) return true;
    if (sameDay && Number(this.#dayLoadInFlight?.day) === dayNum) return false;
    // In app/single-button mode an empty value can only be a transient option
    // rebuild. There is no user-facing "no day" selection there, so retain the
    // current board until the hidden selector is repopulated.
    if (!validDay && this.#singleButton() && this.#selectedDay != null) {
      const matching = e?.target?.options
        ? Array.from(e.target.options).find(
            (option) => Number(option.value) === Number(this.#selectedDay),
          )
        : null;
      if (matching) e.target.value = matching.value;
      return;
    }

    this.#hostRevealSeq += 1;
    this.#interactiveRevealKey = null;
    this.#skipSpinId = null;
    this.#loadedDay = null;
    if (!validDay) {
      this.#playerTraitsLoadSeq += 1;
      this.#playerTraitsPending = false;
      this.#dayLoadSeq++;
      this.#dayLoadInFlight = null;
      this.#dayReloadAttempt = 0;
      this.#dayReloadTarget = null;
      if (this.#dayReloadTimer != null) {
        try { clearTimeout(this.#dayReloadTimer); } catch { /* defensive */ }
        this.#dayReloadTimer = null;
      }
      this.removeAttribute('data-day-loading');
      if (!this.hasAttribute('data-day-warming')) this.removeAttribute('aria-busy');
      this.#selectedDay = null;
      this.#resetCards();
      this.querySelector('[data-bind="empty-state"]').hidden = false;
      this.querySelector('[data-bind="distributions"]').hidden = true;
      this.querySelector('[data-bind="ticket-info"]').hidden = true;
      this.querySelector('[data-bind="reveal-btn"]').disabled = true;
      batch([['replay.day', null], ['replay.level', null]]);
      return false;
    }

    if (this.#dayReloadTimer != null) {
      try { clearTimeout(this.#dayReloadTimer); } catch { /* defensive */ }
      this.#dayReloadTimer = null;
    }
    if (!sameDay || this.#dayReloadTarget !== dayNum) {
      this.#dayReloadAttempt = 0;
      this.#dayReloadTarget = dayNum;
    }
    const loadSeq = ++this.#dayLoadSeq;
    this.#dayLoadInFlight = { day: dayNum, seq: loadSeq };
    const loadIsCurrent = () => (
      this.#dayLoadSeq === loadSeq && Number(this.#selectedDay) === dayNum
    );
    const finishStaleLoad = () => {
      if (this.#dayLoadInFlight?.seq === loadSeq) this.#dayLoadInFlight = null;
      return false;
    };

    this.#selectedDay = dayNum;
    this.#openingFlipDay = false;
    // A new day can route to a different purchase level. Never color its
    // refresh animation from the prior day's cached trait set.
    this.#distributions = [];
    this.#winners = [];
    this.#selectedLevel = null;
    this.#dayRoll1 = null;
    this.#dayRoll2 = null;
    this.#playerTraitsLoadSeq += 1;
    this.#playerTraitIds = new Set();
    this.#traitsCacheAddress = null;
    this.#playerTraitsPending = Boolean(this.#selectedPlayer);
    this.#resetCards();
    this.#setDayDataLoading(dayNum, true);
    // Loading is itself enough reason to run the reel. The persisted reveal
    // bit commonly lands later than these exact-day requests.
    this.#startIdleSpin();

    const rngEntry = this.#rngDays.find(d => d.day === dayNum);
    const hasRng = rngEntry && rngEntry.finalWord && rngEntry.finalWord !== '0';

    this.querySelector('[data-bind="empty-state"]').hidden = true;

    // Both exact roll payloads are mandatory scratch-underlay data. A transient
    // 404 here used to enable Reveal anyway, producing an empty or prior-day
    // underside; retain the loading gate and retry instead.
    const rolls = await this.#loadDayRolls(dayNum);
    if (!loadIsCurrent()) return finishStaleLoad();
    this.#dayRoll1 = rolls.roll1;
    this.#dayRoll2 = rolls.roll2;
    this.#repairOpeningFlipRolls(dayNum);

    // Do not request the potentially large distribution feed while the two
    // exact roll endpoints still say this processing day is not ready. The
    // retry loop only needs those small readiness payloads; once both exist we
    // load day detail exactly as before for player labels and prize mapping.
    const rollPayloadsReady = Number(this.#dayRoll1?.day) === dayNum
      && Array.isArray(this.#dayRoll1?.wins)
      && Number(this.#dayRoll2?.day) === dayNum
      && Array.isArray(this.#dayRoll2?.wins);
    if (rollPayloadsReady) {
      const detail = await this.#loadDayDetail(dayNum);
      if (!loadIsCurrent()) return finishStaleLoad();
      this.#distributions = Array.isArray(detail?.distributions) ? detail.distributions : [];
      // The opening level has no Roll 1 endpoint, so its main FLIP board is
      // synthesized from this distribution feed. #repairOpeningFlipRolls()
      // also runs before the readiness check above to let that 404 path load
      // the detail payload; rebuild once more now that the awards actually
      // exist or every public quadrant is permanently rendered as 0 x 0.
      this.#repairOpeningFlipRolls(dayNum);
      const rng = this.#rngDays.find((entry) => Number(entry?.day) === dayNum);
      this.#dayRoll2 = includeEarlyBirdTicketWins({
        roll1: this.#dayRoll1,
        roll2: this.#dayRoll2,
        distributions: this.#distributions,
        bonusTraits: this.#packedTraits(rng?.bonusTraitsPacked),
      });
    }

    // Load winners from the authoritative day/winners endpoint.
    // This gives us level, winner list with breakdown, and hasBonus flags.
    let nextWinners = [];
    let nextSelectedLevel = null;
    try {
      const wJson = await fetchJSON(`/game/jackpot/day/${dayNum}/winners`, { force: true });
      nextSelectedLevel = this.#openingFlipDay
        ? 0
        : (wJson.level ?? (this.#distributions[0]?.level ?? null));
      nextWinners = wJson.winners || [];
    } catch (error) {
      noteReplayApiResponse(error?.response);
      if (this.#distributions.length > 0) {
        nextSelectedLevel = this.#distributions[0].level;
      }
    }
    if (!loadIsCurrent()) return finishStaleLoad();
    this.#winners = Array.isArray(nextWinners) ? nextWinners : [];
    this.#selectedLevel = nextSelectedLevel
      ?? (this.#openingFlipDay ? 0 : (this.#dayRoll1?.level ?? null));

    // Roll 1 grades the purchase level itself. Prefer the endpoint's explicit
    // source level; modal winner level can be the level receiving ticket prizes
    // (or an opening bonus target), which is not the ownership cohort.
    if (this.#selectedLevel != null) {
      await this.#loadTickets(this.#dayRoll1?.purchaseLevel ?? (this.#selectedLevel + 1));
    }
    if (!loadIsCurrent()) return finishStaleLoad();

    // The loading reel uses the same pink/blue ownership language as the
    // settled draw. Hydrate this level's traits as soon as its purchase level
    // is known, even while the exact roll payload is still catching up.
    await this.#loadPlayerTraits();
    if (!loadIsCurrent()) return finishStaleLoad();

    // A valid draw can have zero winners. RNG + a selected player are enough
    // to run the public board, but only after both exact roll payloads exist.
    const rollDataReady = this.#hasExactDayRolls(dayNum);
    const canReveal = rollDataReady && hasRng && this.#selectedPlayer;
    this.querySelector('[data-bind="reveal-btn"]').disabled = !canReveal;

    if (this.#winners.length > 0) {
      this.#showDistributions(this.#winners);
    } else {
      this.querySelector('[data-bind="distributions"]').hidden = true;
    }

    // Publish selected day + level to store so game-status-bar can display them.
    batch([
      ['replay.day', dayNum],
      ['replay.level', this.#selectedLevel],
    ]);
    if (loadIsCurrent() && rollDataReady) {
      this.#loadedDay = dayNum;
      this.#dayReloadAttempt = 0;
      this.#dayReloadTarget = null;
      this.#setDayDataLoading(dayNum, false);
      try {
        this.dispatchEvent(new CustomEvent('replay:day-ready', {
          detail: { day: dayNum },
          bubbles: true,
        }));
      } catch { /* headless / CustomEvent shim absent */ }
      void this.#applyPersistedRevealState(this.#hostRevealSeq);
    } else if (loadIsCurrent()) {
      this.#loadedDay = null;
      this.#setDayDataLoading(dayNum, true);
      this.#scheduleDayDataReload(dayNum);
    }
    if (this.#dayLoadInFlight?.seq === loadSeq) this.#dayLoadInFlight = null;
    return rollDataReady;
  }

  #onPlayerChange(e) {
    const addr = String(e?.target?.value || '').trim();
    const nextPlayer = addr || null;
    const currentPlayer = this.#selectedPlayer == null
      ? null
      : String(this.#selectedPlayer);
    if ((nextPlayer == null && currentPlayer == null)
      || (nextPlayer != null && currentPlayer != null
        && nextPlayer.toLowerCase() === currentPlayer.toLowerCase())) return;
    // The app always has a concrete viewed address. If a ticket-list rebuild
    // momentarily drops its option, keep the rendered player's draw instead of
    // clearing all four quadrants while the bridge restores the same address.
    if (nextPlayer == null && this.#singleButton() && currentPlayer != null) {
      const matching = e?.target?.options
        ? Array.from(e.target.options).find(
            (option) => String(option.value).toLowerCase() === currentPlayer.toLowerCase(),
          )
        : null;
      if (matching) e.target.value = matching.value;
      return;
    }

    this.#hostRevealSeq += 1;
    this.#interactiveRevealKey = null;
    this.#skipSpinId = null;
    this.#selectedPlayer = nextPlayer;
    this.#playerTraitsLoadSeq += 1;
    this.#playerTraitIds = new Set();
    this.#traitsCacheAddress = null;
    this.#playerTraitsPending = Boolean(nextPlayer);
    this.#resetCards();
    this.#startIdleSpin();
    // Publish replay-player selection so sibling widgets (status-bar activity
    // score) can react without coupling to this panel.
    update('replay.player', this.#selectedPlayer);
    this.#updateTicketInfo();
    this.#loadPlayerTraits();
    this.#loadPlayerDecimator();
    // Re-render distributions to update (YOU) labels
    if (this.#winners.length > 0) {
      this.#showDistributions(this.#winners);
    }
    // Update reveal button state
    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    const hasRng = rngEntry && rngEntry.finalWord && rngEntry.finalWord !== '0';
    this.querySelector('[data-bind="reveal-btn"]').disabled = !hasRng
      || !this.#selectedPlayer
      || !this.#dayDataReady(this.#selectedDay);
    void this.#applyPersistedRevealState(this.#hostRevealSeq);
  }

  async #loadPlayerDecimator() {
    const container = this.querySelector('[data-bind="player-decimator"]');
    const list = this.querySelector('[data-bind="player-decimator-list"]');
    if (!container || !list) return;
    if (!this.#selectedPlayer) {
      container.hidden = true;
      list.innerHTML = '';
      return;
    }
    // /app/ basic mode hides this block outright (app.css: `.replay-player-decimator
    // { display: none }` — decimator deferred per product call), so the request below
    // is pure waste there. Skipping it also silences a 404 on every page load.
    if (getComputedStyle(container).display === 'none') return;
    list.innerHTML = '<div class="jp-summary-note">Loading…</div>';
    container.hidden = false;
    try {
      const data = await fetchJSON(`/game/decimator/player/${this.#selectedPlayer}`);
      const rounds = Array.isArray(data.rounds) ? data.rounds : [];
      if (rounds.length === 0) {
        list.innerHTML = '<div class="jp-summary-note">Player has no decimator burns.</div>';
        return;
      }
      // Render one row per round.  Status priority: claimed > pending winner > not eligible.
      list.innerHTML = rounds.map((r) => {
        let status, amountText;
        if (r.claimed) {
          const ethStr = formatEth(r.claimedEthAmount || '0');
          const lbStr  = formatEth(r.claimedLootboxAmount || '0');
          const lbPart = (r.claimedLootboxAmount && BigInt(r.claimedLootboxAmount) > 0n) ? ` + ${lbStr} ETH luckbox` : '';
          status = '<span class="replay-dec-status replay-dec-claimed">Claimed</span>';
          amountText = `${ethStr} ETH${lbPart}`;
        } else if (r.isWinner && BigInt(r.claimableEth || '0') > 0n) {
          status = '<span class="replay-dec-status replay-dec-pending">Claimable (pending)</span>';
          amountText = `${formatEth(r.claimableEth)} ETH`;
        } else if (!r.resolved) {
          status = '<span class="replay-dec-status replay-dec-unresolved">Not yet resolved</span>';
          amountText = '—';
        } else {
          status = '<span class="replay-dec-status replay-dec-loser">Not eligible</span>';
          amountText = `bucket ${r.bucket}/sub ${r.playerSubBucket} (winner sub ${r.winningSubBucket ?? '—'})`;
        }
        return `<div class="replay-dec-row">
          <span class="replay-dec-level"><strong>L${r.level}</strong></span>
          ${status}
          <span class="replay-dec-amount">${amountText}</span>
        </div>`;
      }).join('');
    } catch (err) {
      console.warn('[ReplayPanel] decimator fetch failed', err);
      list.innerHTML = '<div class="jp-summary-note">Could not load decimator state.</div>';
    }
  }

  #updateTicketInfo() {
    const infoEl = this.querySelector('[data-bind="ticket-info"]');
    const countEl = this.querySelector('[data-bind="ticket-count"]');
    const detailEl = this.querySelector('[data-bind="ticket-detail"]');

    if (!this.#selectedPlayer) {
      const total = this.#tickets.reduce((sum, t) => sum + t.entryCount, 0);
      countEl.textContent = `${total.toLocaleString()} total entries`;
      detailEl.textContent = `across ${this.#tickets.length} players`;
      infoEl.hidden = false;
      return;
    }

    const player = this.#tickets.find(t => t.address === this.#selectedPlayer);
    if (player) {
      countEl.textContent = `${player.entryCount.toLocaleString()} entries`;
      detailEl.textContent = `${player.totalMintedOnLevel.toLocaleString()} minted on level`;
      infoEl.hidden = false;

      const won = this.#winners.find(w => w.address.toLowerCase() === this.#selectedPlayer.toLowerCase());
      if (won) {
        countEl.textContent += ' · WINNER';
        countEl.classList.add('replay-winner-text');
      } else {
        countEl.classList.remove('replay-winner-text');
      }
    } else {
      infoEl.hidden = true;
    }
  }

  #showDistributions(winners) {
    // winners: array from /game/jackpot/day/:day/winners response
    const container = this.querySelector('[data-bind="distributions"]');
    const list = this.querySelector('[data-bind="dist-list"]');

    if (!winners || !winners.length) {
      container.hidden = true;
      return;
    }

    const myAddr = this.#selectedPlayer?.toLowerCase();

    list.innerHTML = winners.map(w => {
      const addr = w.address.toLowerCase();
      const isMe = myAddr && addr === myAddr;

      // Build trait-grouped tooltip from breakdown entries, partitioned by roll phase
      const tipHtml = this.#buildWinnerTooltip(w.breakdown || [], w.hasBonus);

      return `
      <div class="replay-dist-item${isMe ? ' replay-dist-mine' : ''}" style="position:relative">
        <span class="replay-dist-winner">${truncateAddress(w.address)}${isMe ? ' (YOU)' : ''}</span>
        ${w.hasBonus ? '<span class="replay-dist-bonus-badge">+BONUS</span>' : ''}
        <div class="winner-tip">${tipHtml}</div>
      </div>`;
    }).join('');

    container.hidden = false;
  }

  /**
   * Build HTML for the hover tooltip grouped by trait, partitioned by roll phase.
   * breakdown: [{awardType, amount, count, traitId}]
   * hasBonus: if true, split entries into Roll 1 (eth/tickets) vs Bonus Roll (flip non-null traitId)
   *           vs Bonus Center (null-traitId flip). This matches exactly what the widget renders
   *           across Roll 1 quadrants + Roll 2 bonus quadrants + center diamond.
   */
  #buildWinnerTooltip(breakdown, hasBonus = false) {
    if (!breakdown || breakdown.length === 0) return '<em>No detail available</em>';

    /**
     * Render a set of entries grouped by traitId into tooltip HTML.
     * entries: [{awardType, amount, count, traitId}]
     */
    const renderEntryGroup = (entries) => {
      // Solo-bucket detection: whale_pass (traitId=null) always goes to the
      // single solo-bucket winner. We identify that bucket as the trait with
      // the largest single ETH slice in this player's entries, and fold the
      // whale pass row INTO that trait group instead of showing a separate
      // "Solo Winner" section.
      let soloTraitKey = null;
      let soloMaxEth = 0n;
      for (const e of entries) {
        if ((e.awardType || '') === 'eth' && e.traitId != null) {
          const v = BigInt(e.amount || '0');
          if (v > soloMaxEth) { soloMaxEth = v; soloTraitKey = e.traitId; }
        }
      }

      const byTrait = new Map(); // traitId|'bonus'|'solo' -> entries[]
      for (const entry of entries) {
        let key;
        if (entry.traitId != null) {
          key = entry.traitId;
        } else if ((entry.awardType || '') === 'whale_pass') {
          // Fold whale pass into the solo-bucket trait group when we can
          // identify it; otherwise fall back to a labeled Solo Winner section.
          key = soloTraitKey != null ? soloTraitKey : 'solo';
        } else {
          key = 'bonus';
        }
        if (!byTrait.has(key)) byTrait.set(key, []);
        byTrait.get(key).push(entry);
      }
      const sections = [];
      for (const [key, ents] of byTrait) {
        let headerHtml;
        if (key === 'solo') {
          headerHtml = '<span class="tip-trait-name">Solo Winner</span>';
        } else if (key === 'bonus') {
          headerHtml = '<span class="tip-trait-name">Bonus Center</span>';
        } else {
          const traitId = Number(key);
          const badge = traitToBadge(traitId);
          const quadrant = Math.floor(traitId / 64);
          const quadrantName = BADGE_QUADRANTS[quadrant] || 'Unknown';
          const label = badge ? `${badge.item} (${quadrantName} Q${quadrant + 1})` : `Trait ${traitId}`;
          headerHtml = `<span class="tip-trait-name">${label}</span>`;
        }
        const rows = ents.map(e => {
          const at = e.awardType || '';
          let formatted;
          if (at === 'eth') {
            formatted = `${formatEth(e.amount)} ETH`;
          } else if (at === 'eth_baf') {
            formatted = `${formatEth(e.amount)} ETH (BAF)`;
          } else if (at === 'flip' || at === 'farFutureCoin' || at.includes('flip')) {
            formatted = `${formatFlip(e.amount)} FLIP`;
          } else if (at === 'tickets' || at === 'ticket') {
            // Amounts are in ENTRIES (4 = 1 whole ticket); joScaledToTickets /4 for display.
            const n = joScaledToTickets(e.amount);
            formatted = `${n} ticket${n !== 1 ? 's' : ''}`;
          } else if (at === 'tickets_baf') {
            const n = joScaledToTickets(e.amount);
            formatted = `${n} ticket${n !== 1 ? 's' : ''} (BAF)`;
          } else if (at === 'whale_pass') {
            formatted = formatWhalePassAward(e.amount);
          } else {
            formatted = `${e.amount} ${at}`;
          }
          const countStr = e.count > 1 ? ` ×${e.count}` : '';
          return `<span class="tip-row">${formatted}${countStr}</span>`;
        }).join('');
        sections.push(`<div class="tip-trait-group">${headerHtml}${rows}</div>`);
      }
      return sections.join('');
    };

    if (!hasBonus) {
      // No bonus roll — render entries flat, grouped by traitId.  BAF entries
      // (traitId=420 sentinel) must still be partitioned out so they don't
      // render under a phantom "horseshoe Q7" badge.
      const nonBaf = breakdown.filter(e => e.awardType !== 'eth_baf' && e.awardType !== 'tickets_baf');
      const baf = breakdown.filter(e => e.awardType === 'eth_baf' || e.awardType === 'tickets_baf');
      const renderBafFlat = (entries) =>
        entries.map(e => {
          const at = e.awardType || '';
          let formatted;
          if (at === 'eth_baf') {
            formatted = `${formatEth(e.amount)} ETH`;
          } else {
            const n = joScaledToTickets(e.amount);
            formatted = `${n} ticket${n !== 1 ? 's' : ''}`;
          }
          const countStr = e.count > 1 ? ` ×${e.count}` : '';
          return `<span class="tip-row">${formatted}${countStr}</span>`;
        }).join('');
      const parts = [];
      if (nonBaf.length > 0) parts.push(renderEntryGroup(nonBaf));
      if (baf.length > 0) parts.push('<div class="tip-phase-header">BAF</div><div class="tip-trait-group">' + renderBafFlat(baf) + '</div>');
      return parts.length > 0 ? parts.join('') : '<em>No detail available</em>';
    }

    // Partition: Roll 1 entries (eth / tickets / whale_pass) vs Bonus Roll entries (flip with
    // non-null traitId) vs Bonus Center (null-traitId flip / farFutureCoin) vs BAF (eth_baf /
    // tickets_baf — traitId=420 sentinel, must be partitioned out so the trait grouper doesn't
    // render them under a phantom "horseshoe Q7" badge).
    const roll1Entries = [];
    const bonusQuadEntries = [];
    const bonusCenterEntries = [];
    const bafEntries = [];

    for (const entry of breakdown) {
      const at = entry.awardType || '';
      const isFlip = at === 'flip' || at === 'farFutureCoin' || at.includes('flip');
      if (at === 'eth_baf' || at === 'tickets_baf') {
        bafEntries.push(entry);
      } else if (this.#openingFlipDay
        && isFlip
        && entry.traitId != null
        && Number(entry.level) === 1) {
        roll1Entries.push(entry);
      } else if (isFlip && entry.traitId == null) {
        bonusCenterEntries.push(entry);
      } else if (isFlip && entry.traitId != null) {
        bonusQuadEntries.push(entry);
      } else {
        roll1Entries.push(entry);
      }
    }

    // BAF entries are not trait-keyed (traitId=420 is the sentinel, not a real
    // trait), so render them flat without the per-trait grouping.
    const renderBafFlat = (entries) =>
      entries.map(e => {
        const at = e.awardType || '';
        let formatted;
        if (at === 'eth_baf') {
          formatted = `${formatEth(e.amount)} ETH`;
        } else {
          const n = joScaledToTickets(e.amount);
          formatted = `${n} ticket${n !== 1 ? 's' : ''}`;
        }
        const countStr = e.count > 1 ? ` ×${e.count}` : '';
        return `<span class="tip-row">${formatted}${countStr}</span>`;
      }).join('');

    const parts = [];
    if (roll1Entries.length > 0) {
      parts.push('<div class="tip-phase-header">Main Spin</div>' + renderEntryGroup(roll1Entries));
    }
    if (bonusQuadEntries.length > 0) {
      parts.push('<div class="tip-phase-header">Bonus Spin</div>' + renderEntryGroup(bonusQuadEntries));
    }
    if (bonusCenterEntries.length > 0) {
      parts.push('<div class="tip-phase-header">Bonus Center</div>' + renderEntryGroup(bonusCenterEntries));
    }
    if (bafEntries.length > 0) {
      parts.push('<div class="tip-phase-header">BAF</div><div class="tip-trait-group">' + renderBafFlat(bafEntries) + '</div>');
    }
    return parts.length > 0 ? parts.join('') : '<em>No detail available</em>';
  }

  // --- Reveal / Spin ---

  /**
   * The main reveal carries the same hard latch as the bonus roll: it adds
   * `is-spinning` before two network reads, and #syncSpinControlState() will
   * not repaint a button that carries one. Clear it on any path that never
   * reaches the reel — #resetCards() only clears it once the flow gets that
   * far, which the selection-changed bail above it does not.
   */
  #releaseMainSpinLatch() {
    const btn = this.querySelector('[data-bind="reveal-btn"]');
    if (!btn) return;
    btn.classList?.remove('is-spinning');
    btn.removeAttribute?.('aria-busy');
    this.#syncSpinControlState();
  }

  async #triggerReveal({ instant = false, persisted = false } = {}) {
    if (!this.#selectedDay || !this.#selectedPlayer) return;
    // The RNG row can arrive before its roll/bucket endpoints. Never construct
    // a scratch board until its exact-day underside is complete.
    if (!this.#dayDataReady(this.#selectedDay)) return false;

    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    if (!rngEntry || !rngEntry.finalWord || rngEntry.finalWord === '0') return;

    const selectionKey = this.#selectionKey();
    if (persisted) {
      if (this.#interactiveSelectionActive(selectionKey)) return false;
    } else {
      this.#claimInteractiveReveal(selectionKey);
    }

    // Create/resume WebAudio while the reveal click still owns user activation.
    // Jackpot cues are synthesized locally, so the spin never waits on an
    // audio download/decode path.
    if (!instant) {
      try { this.#getAudio(); } catch (_error) { /* visuals remain authoritative */ }
    }

    const btn = this.querySelector('[data-bind="reveal-btn"]');
    btn.disabled = true;
    if (!instant) {
      btn.classList?.add('is-spinning');
      btn.textContent = 'PREPARING SPIN…';
    }

    let settled = false;
    try {
      // Everything needed by the later Bonus Spin and DAY SUMMARY is already
      // knowable here. Start those reads with the main trait read so the reel
      // and scratch interaction provide their loading window; later buttons
      // only consume the shared result.
      const playerTraitsPromise = this.#loadPlayerTraits();
      if (this.#hasBonus) void this.#loadFutureTraits();
      if (!instant && !persisted) {
        try {
          this.dispatchEvent(new CustomEvent('replay:spin-start', {
            detail: {
              day: this.#selectedDay,
              player: this.#selectedPlayer,
              bonusPhase: false,
            },
            bubbles: true,
          }));
        } catch { /* headless / CustomEvent shim absent */ }
      }

      await playerTraitsPromise; // ensure traits loaded for spin coloring
      if (this.#selectionKey() !== selectionKey) return false;
      // A persisted restore can begin before the player's click and finish its
      // trait read afterward. At that point the click owns the selection; do
      // not let the older restore clear or instantly replace the live reel.
      if (persisted && this.#interactiveSelectionActive(selectionKey)) return false;

      // Keep the existing attract/result face painted during the asynchronous
      // trait reads above. Clear it only when the derived player result is
      // ready to be rebuilt for the very next spin frame.
      this.#resetCards();

      // Filter the pre-cached day roll1/roll2 responses down to this player's wins.
      this.#filterPlayerWins(this.#selectedPlayer);

      const displayTraits = this.#displayTraitsForRoll(false);

      // Map per-player roll1 wins to quadrant prize arrays.
      this.#distributePrizesFromRoll1();
      if (!instant) btn.textContent = 'SPINNING…';

      const completed = await this.#runSpin(displayTraits, { instant, announce: !persisted });
      if (!completed || this.#selectionKey() !== selectionKey) return false;
      this.#mainSpinComplete = true;
      settled = true;
      btn.classList?.remove('is-spinning');
      btn.removeAttribute?.('aria-busy');

      if (this.#singleButton()) {
        // Same button carries Roll 2; with no bonus ahead the day is played out.
        if (this.#hasBonus) {
          this.#btnMode = 'bonus';
          btn.classList?.add('is-bonus');
          btn.disabled = !this.#mainReadyForBonus();
          btn.textContent = this.#mainReadyForBonus() ? BONUS_SPIN_LABEL : BONUS_SPIN_LOCKED_LABEL;
          btn.title = this.#mainReadyForBonus()
            ? ''
            : 'Scratch blue and gold panels first';
        } else {
          this.#syncSpinControlState();
        }
      } else {
        btn.disabled = false;
        btn.textContent = SPIN_AGAIN_LABEL;
      }

      // After Roll 1 spin: show bonus section
      this.#showBonusSection();
      if (this.#primaryDecimatorAction) this.#syncSpinControlState();
      return true;
    } finally {
      // A bail between the latch and the reel would otherwise leave the button
      // stuck at "PREPARING SPIN…" with nothing able to repaint it.
      if (!instant && !settled) this.#releaseMainSpinLatch();
    }
  }

  /**
   * Build a per-traitId lookup from the winner's breakdown array.
   * breakdown entries have { awardType, amount, count, traitId }.
   * Returns Map<traitId, { ethTotal: bigint, flipTotal: bigint }>.
   * Also returns { centerFlip: bigint } for null-traitId flip/farFutureCoin entries.
   */
  #buildBreakdownLookup(breakdown) {
    const byTrait = new Map();
    let centerFlip = 0n;
    for (const entry of (breakdown || [])) {
      const at = entry.awardType || '';
      const amt = BigInt(entry.amount || '0');
      const cnt = BigInt(entry.count || 1);
      const total = amt * cnt;
      if (entry.traitId == null) {
        // null-traitId flip = farFutureCoin center wins
        if (at === 'flip' || at === 'farFutureCoin') centerFlip += total;
        continue;
      }
      if (!byTrait.has(entry.traitId)) byTrait.set(entry.traitId, { ethTotal: 0n, flipTotal: 0n });
      const rec = byTrait.get(entry.traitId);
      if (at === 'eth') rec.ethTotal += total;
      else if (at === 'flip' || at === 'farFutureCoin') rec.flipTotal += total;
      // tickets are read from row.ticketsPerWinner (already aggregated correctly)
    }
    return { byTrait, centerFlip };
  }

  /**
   * Map #playerRoll1Wins (already filtered to this player, one row per discrete payout)
   * to quadrant prize arrays. Each win row is exactly one badge/emission — no expansion.
   * whale_pass / dgnrs rows land under a "Solo Winner" quadrant entry (no traitId quadrant).
   */
  #distributePrizesFromRoll1() {
    this.#quadWinArrays = [[], [], [], []];
    this.#centerWins = [];

    if (!this.#playerRoll1Wins || this.#playerRoll1Wins.length === 0) return;

    const MAX_VISUAL_BADGES = 20;
    // Track total wins per display pos for overflow sentinel
    const totalPerPos = [0, 0, 0, 0];

    for (const win of this.#playerRoll1Wins) {
      const at = win.awardType || '';

      // whale_pass / dgnrs: no quadrant from traitId — place in quadrant with most ETH wins
      // (handled after loop below). Skip here.
      if (win.traitId == null) continue;

      const contractQ = Math.floor(win.traitId / 64);
      const displayPos = DISPLAY_ORDER.indexOf(contractQ);
      if (displayPos < 0 || displayPos > 3) continue;

      totalPerPos[displayPos]++;
      const currentCount = this.#quadWinArrays[displayPos].length;
      if (currentCount >= MAX_VISUAL_BADGES) continue;

      this.#quadWinArrays[displayPos].push({
        awardType: 'aggregated',
        ethTotal: at === 'eth' ? (win.amount || '0') : '0',
        flipTotal: (at === 'flip' || at === 'farFutureCoin') ? (win.amount || '0') : '0',
        ticketTotal: (at === 'tickets' || at === 'ticket') ? Number(win.amount || 0) : 0,
        traitId: win.traitId,
        ticketIndex: win.ticketIndex ?? null,
        level: win.level ?? null,
        sourceLevel: win.sourceLevel ?? null,
      });
    }

    // whale_pass / dgnrs wins (no traitId) → merge INTO the solo-bucket ETH
    // entry.  The solo bucket is where this player is the only winner, which
    // on the contract side pays the biggest single ETH slice (60% on final
    // day, 20% otherwise — still larger than the per-winner share in
    // multi-winner buckets), and whale pass / dgnrs ride along with that
    // same payout — they aren't distinct prizes.  Picking the entry with the
    // largest *single* ETH win lands on that bucket, whereas summing totals
    // can tip toward a multi-winner quadrant whose cumulative payout exceeds
    // the solo share.
    const noTraitWins = this.#playerRoll1Wins.filter(w => w.traitId == null);
    if (noTraitWins.length > 0) {
      let bestEntry = null, bestSingle = 0n;
      for (let i = 0; i < 4; i++) {
        for (const d of this.#quadWinArrays[i]) {
          const amt = BigInt(d.ethTotal || '0');
          if (amt > bestSingle) { bestSingle = amt; bestEntry = d; }
        }
      }
      if (bestEntry) {
        bestEntry.isSolo = true;
        for (const win of noTraitWins) {
          const at = win.awardType || '';
          if (at === 'whale_pass') {
            bestEntry.whalePassCount = (bestEntry.whalePassCount || 0) + Number(win.amount || 1);
          } else if (at === 'dgnrs') {
            const prev = BigInt(bestEntry.dgnrsTotal || '0');
            bestEntry.dgnrsTotal = (prev + BigInt(win.amount || '0')).toString();
          }
        }
      }
    }

    // Overflow sentinels
    for (let pos = 0; pos < 4; pos++) {
      const rendered = this.#quadWinArrays[pos].length;
      const total = totalPerPos[pos];
      if (total > rendered) {
        const lastEntry = this.#quadWinArrays[pos][rendered - 1];
        this.#quadWinArrays[pos].push({
          awardType: 'overflow',
          overflowCount: total - rendered,
          traitId: lastEntry ? lastEntry.traitId : null,
          ethTotal: '0',
          flipTotal: '0',
          ticketTotal: 0,
        });
      }
    }
  }

  // Legacy method — kept so existing #checkAllScratched / farFutureCoin center logic
  // still has a reference point. Not called from #triggerReveal anymore.
  #distributePrizes(displayTraits) {
    this.#quadWinArrays = [[], [], [], []];
    this.#centerWins = [];
    const addr = this.#selectedPlayer?.toLowerCase();
    if (!addr) return;

    const todaysTraits = new Set(displayTraits.filter(t => t != null));
    const playerDists = this.#distributions.filter(d => d.winner.toLowerCase() === addr);
    if (playerDists.length === 0) return;

    const quadDists = [];
    for (const dist of playerDists) {
      if (dist.awardType === 'farFutureCoin') {
        this.#centerWins.push(dist);
      } else if (dist.traitId == null || todaysTraits.has(dist.traitId)) {
        quadDists.push(dist);
      }
    }

    const noTraitDists = [];
    for (const dist of quadDists) {
      if (dist.traitId != null) {
        const contractQ = Math.floor(dist.traitId / 64);
        const displayPos = DISPLAY_ORDER.indexOf(contractQ);
        if (displayPos >= 0 && displayPos <= 3) this.#quadWinArrays[displayPos].push(dist);
      } else {
        noTraitDists.push(dist);
      }
    }
    if (noTraitDists.length > 0) {
      let bestQ = 0, bestEth = 0n;
      for (let i = 0; i < 4; i++) {
        const qEth = this.#quadWinArrays[i]
          .filter(d => d.awardType === 'eth')
          .reduce((s, d) => s + BigInt(d.amount || '0'), 0n);
        if (qEth > bestEth) { bestEth = qEth; bestQ = i; }
      }
      for (const dist of noTraitDists) this.#quadWinArrays[bestQ].push(dist);
    }
  }

  // --- Bonus Roll (Roll 2) ---

  // Authoritative packed traits for either board. Keeping this in one helper
  // guarantees a post-reveal flame toggle reconstructs the exact same faces as
  // the original main/bonus spins.
  #displayTraitsForRoll(bonus) {
    if (this.#tutorialFixture) {
      return toDisplayOrder(
        bonus ? this.#tutorialFixture.bonusTraits : this.#tutorialFixture.mainTraits,
      );
    }
    const rngEntry = this.#rngDays.find(d => d.day === this.#selectedDay);
    const packed = bonus ? rngEntry?.bonusTraitsPacked : rngEntry?.mainTraitsPacked;
    let traits;
    if (packed != null) {
      const p = Number(packed) >>> 0;
      traits = [p & 0xff, (p >>> 8) & 0xff, (p >>> 16) & 0xff, (p >>> 24) & 0xff];
    } else {
      traits = deriveWinningTraits(rngEntry?.finalWord || '0');
    }
    return toDisplayOrder(traits);
  }

  #prepareRoll2Prizes() {
    const nearFutureWins = this.#playerRoll2Wins.filter(w => w.traitId != null);
    const farFutureWins = this.#playerRoll2Wins.filter(w => w.traitId == null);
    this.#bonusTraitIds = new Set(nearFutureWins.map(w => w.traitId));
    this.#bonusQuadrants = new Set(nearFutureWins.map(w => Math.floor(w.traitId / 64)));
    this.#distributePrizesFromRoll2(nearFutureWins, farFutureWins);
  }

  /** /app/ opts into one shared roll button (see #btnMode). */
  #singleButton() {
    return this.hasAttribute('single-button');
  }

  #jackpotSpinsComplete() {
    return this.#mainSpinComplete && (!this.#hasBonus || this.#bonusSpinComplete);
  }

  #coinflipHandoffReady() {
    return this.#singleButton()
      && this.#jackpotSpinsComplete()
      && Number(this.#coinflipHandoff.day) === Number(this.#selectedDay)
      && this.#coinflipHandoff.available
      && !this.#coinflipHandoff.revealed;
  }

  #triggerCoinflipHandoff() {
    if (!this.#coinflipHandoffReady() || this.#coinflipHandoffStarting) return false;
    const target = typeof document !== 'undefined'
      ? document.querySelector?.('app-daily-flip')
      : null;
    if (!target) return false;
    let mobile = false;
    try {
      mobile = typeof matchMedia === 'function'
        ? matchMedia('(max-width: 760px)').matches
        : Number(globalThis.innerWidth) <= 760;
    } catch (_error) { /* desktop fallback */ }
    this.#coinflipHandoffStarting = true;
    this.#syncSpinControlState();
    let started = false;
    try {
      started = target.startCoinflipFromJackpot?.({ scroll: mobile }) === true;
    } catch (_error) { started = false; }
    if (!started) {
      this.#coinflipHandoffStarting = false;
      this.#syncSpinControlState();
    }
    return started;
  }

  #refreshMainPotentialScratchGate() {
    const remaining = countUnscratchedPotentialWinPanels({
      quadOwned: this.#quadOwned,
      scratched: this.#scratched,
      centerWinCount: this.#centerWins.length,
      centerScratched: this.#centerScratched,
    });
    // Once the player has exposed every visibly possible Roll 1 result, keep
    // that disclosure durable while Roll 2 replaces this widget's ownership
    // state and while the two completed draws are revisited through the toggle.
    if (remaining === 0) this.#mainPotentialScratchComplete = true;
    return remaining;
  }

  #mainReadyForBonus() {
    return this.#mainSpinComplete
      && this.#mainPotentialScratchComplete;
  }

  #showBonusSection() {
    const section = this.querySelector('[data-bind="bonus-section"]');
    const btn = this.querySelector('[data-bind="bonus-btn"]');
    if (!section) return;

    // Single-button mode keeps every actionable state on the shared LCD.
    if (this.#singleButton()) {
      if (btn) btn.hidden = true;
      section.hidden = true;
      return;
    }

    // Standalone replay needs a second control only when Roll 2 exists.
    section.hidden = !this.#hasBonus;
    if (this.#hasBonus) {
      btn.hidden = false;
      btn.disabled = !this.#mainReadyForBonus();
      btn.textContent = this.#mainReadyForBonus() ? BONUS_SPIN_LABEL : BONUS_SPIN_LOCKED_LABEL;
      btn.title = this.#mainReadyForBonus()
        ? ''
        : 'Scratch blue and gold panels first';
    } else {
      btn.hidden = true;
    }
  }

  /**
   * Drop the bonus press's busy latch on every path that leaves
   * #triggerBonusRoll without a finished reel.
   *
   * `is-spinning` is a hard lock, not a decoration: #syncSpinControlState()
   * returns early on any button carrying it, so that a background processing
   * poll cannot repaint a live spin. Nothing else ever removed it except
   * #resetCards() — day change, player change, a fresh main reveal — so a bail
   * between the latch and the reel stranded the control at "BONUS SPINNING…"
   * over the settled Roll 1 board until the day rolled or the page reloaded.
   */
  async #releaseBonusSpinLatch(selectionKey, boardCleared) {
    const btn = this.querySelector('[data-bind="reveal-btn"]');
    btn?.classList?.remove('is-spinning');
    btn?.removeAttribute?.('aria-busy');
    // A day/player change, or a spin that has since taken the widget over,
    // already owns both the control and the board. Releasing the latch is the
    // only thing this path may still do.
    if (this.#selectionKey() !== selectionKey || this.#spinning) return;

    // Re-open the gate at the top of #triggerBonusRoll so the press retries.
    this.#bonusPhase = false;
    this.#bonusScratchComplete = false;
    this.#syncDrawToggleAffordance();

    // A reel that never ran leaves the blank board #resetMainWidget() made for
    // it. Put the settled main draw back underneath the retry offer.
    if (boardCleared) {
      try {
        this.#distributePrizesFromRoll1();
        this.#resetMainWidget();
        await this.#runSpin(this.#displayTraitsForRoll(false), {
          instant: true,
          announce: false,
        });
      } catch (err) {
        // A board that will not repaint must not also cost the player the
        // button: the release below is the part that has to happen.
        console.warn('[ReplayPanel] Failed to restore the main draw:', err);
      }
    }

    if (this.#singleButton()) {
      this.#btnMode = 'bonus';
      if (btn) {
        btn.hidden = false;
        btn.classList?.add('is-bonus');
        btn.disabled = false;
        btn.textContent = BONUS_SPIN_LABEL;
        btn.title = '';
      }
    } else {
      if (btn) {
        btn.disabled = false;
        btn.textContent = SPIN_AGAIN_LABEL;
      }
      this.#showBonusSection();
    }
  }

  async #triggerBonusRoll() {
    // Public Roll 2 results remain viewable even for a player with no eligible
    // future ticket. The button is hidden only when no bonus draw exists.
    if (!this.#dayDataReady(this.#selectedDay)
      || !this.#hasBonus
      || !this.#mainReadyForBonus()
      || this.#bonusPhase
      || this.#bonusScratchComplete) return;
    // Resume WebAudio while the bonus click still owns user activation.
    try { this.#getAudio(); } catch (_error) { /* visuals remain authoritative */ }
    const selectionKey = this.#selectionKey();
    this.#claimInteractiveReveal(selectionKey);
    const bonusSection = this.querySelector('[data-bind="bonus-section"]');
    if (bonusSection) bonusSection.hidden = true;

    this.#bonusPhase = true;
    this.#bonusScratchComplete = false;
    this.#syncDrawToggleAffordance();

    // Near-future wins (traitId != null) go to quadrants; null-traitId = center diamond FLIP.
    this.#prepareRoll2Prizes();

    // Derive display traits for the spin — Roll 2 uses the *bonus* trait set
    // the contract rolled from the salted RNG (keccak(randWord, BONUS_TRAITS)),
    // NOT the main Roll 1 traits.  The indexer stores it in
    // daily_winning_traits.bonusTraitsPacked, served via /replay/rng.
    // Fallback to the main RNG word derivation when bonusTraitsPacked is
    // unavailable (legacy DB / first day) so the widget still animates.
    const displayTraits = this.#displayTraitsForRoll(true);

    const btn = this.querySelector('[data-bind="reveal-btn"]');
    if (btn) {
      btn.disabled = true;
      btn.classList?.add('is-bonus', 'is-spinning');
      btn.textContent = 'BONUS SPINNING…';
    }

    let boardCleared = false;
    let settled = false;
    try {
      // Colouring for this roll comes from the future-level holdings.
      await this.#loadFutureTraits({ priority: 'interaction' });
      if (this.#selectionKey() !== selectionKey || !this.#bonusPhase) return false;
      // Keep the settled main board painted during an uncached trait request.
      // Once hydration finishes, clear it immediately before #runSpin paints
      // the bonus reel's first frame, leaving no blank intermediate board.
      this.#resetMainWidget();
      boardCleared = true;
      const completed = await this.#runSpin(displayTraits);
      if (!completed || this.#selectionKey() !== selectionKey || !this.#bonusPhase) return false;
      this.#bonusSpinComplete = true;
      settled = true;
      btn?.classList?.remove('is-spinning');
      btn?.removeAttribute?.('aria-busy');

      if (btn) {
        if (this.#singleButton()) {
          // Both rolls are done — nothing left to fire until the day changes.
          this.#btnMode = 'reveal';
          this.#syncSpinControlState();
        } else {
          btn.disabled = false;
          btn.textContent = SPIN_AGAIN_LABEL;
        }
      }
      if (this.#primaryDecimatorAction) this.#syncSpinControlState();
      return true;
    } finally {
      // Every early return above leaves the latch on, and no other code path
      // in this panel can take it off. Release it here or the control is dead
      // for the rest of the day.
      if (!settled) await this.#releaseBonusSpinLatch(selectionKey, boardCleared);
    }
  }

  #syncDrawToggleAffordance() {
    const center = this.querySelector('[data-bind="center"]');
    if (!center) return;
    const ready = this.#hasBonus
      && this.#mainReadyForBonus()
      && this.#bonusScratchComplete
      && !this.#spinning
      && !this.#drawViewSwitching;
    center.classList.toggle('replay-ticket-center--draw-toggle', ready);
    if (!ready) {
      center.removeAttribute('role');
      center.removeAttribute('tabindex');
      center.removeAttribute('aria-label');
      center.removeAttribute('title');
      return;
    }
    const destination = this.#bonusPhase ? 'main' : 'bonus';
    center.setAttribute('role', 'button');
    center.setAttribute('tabindex', '0');
    center.setAttribute('aria-label', `Show ${destination} jackpot draw`);
    center.title = `Show ${destination} draw`;
  }

  async #toggleRevealedDraw() {
    if (this.#drawViewSwitching
      || this.#spinning
      || !this.#hasBonus
      || !this.#mainReadyForBonus()
      || !this.#bonusScratchComplete) return;

    this.#drawViewSwitching = true;
    this.#syncDrawToggleAffordance();
    const showBonus = !this.#bonusPhase;
    try {
      this.#bonusPhase = showBonus;
      if (showBonus) {
        this.#prepareRoll2Prizes();
        await this.#loadFutureTraits({ priority: 'interaction' });
      } else {
        this.#distributePrizesFromRoll1();
      }
      this.#resetMainWidget();
      await this.#runSpin(this.#displayTraitsForRoll(showBonus), {
        instant: true,
        announce: false,
      });
    } finally {
      this.#drawViewSwitching = false;
      this.#syncDrawToggleAffordance();
    }
  }

  /**
   * Distribute Roll 2 prizes into quadrant arrays and center wins.
   * nearFutureWins (traitId != null) → one badge per win row per display-position quadrant.
   * farFutureWins (traitId == null) → center diamond FLIP total.
   * Each win row from /roll2 is already one discrete payout — no expansion needed.
   */
  #distributePrizesFromRoll2(nearFutureWins, farFutureWins) {
    this.#quadWinArrays = [[], [], [], []];
    this.#centerWins = [];

    const MAX_VISUAL_BADGES = 20;
    const totalPerPos = [0, 0, 0, 0];

    for (const win of nearFutureWins) {
      const contractQ = Math.floor(win.traitId / 64);
      const displayPos = DISPLAY_ORDER.indexOf(contractQ);
      if (displayPos < 0 || displayPos > 3) continue;

      totalPerPos[displayPos]++;
      if (this.#quadWinArrays[displayPos].length >= MAX_VISUAL_BADGES) continue;

      const at = win.awardType || '';
      this.#quadWinArrays[displayPos].push({
        awardType: 'aggregated',
        ethTotal: '0',
        flipTotal: (at === 'flip' || at === 'farFutureCoin') ? (win.amount || '0') : '0',
        ticketTotal: (at === 'tickets' || at === 'ticket') ? Number(win.amount || 0) : 0,
        traitId: win.traitId,
        ticketIndex: win.ticketIndex ?? null,
        level: win.level ?? null,
        sourceLevel: win.sourceLevel ?? null,
      });
    }

    // Overflow sentinels
    for (let pos = 0; pos < 4; pos++) {
      const rendered = this.#quadWinArrays[pos].length;
      const total = totalPerPos[pos];
      if (total > rendered) {
        const lastEntry = this.#quadWinArrays[pos][rendered - 1];
        this.#quadWinArrays[pos].push({
          awardType: 'overflow',
          overflowCount: total - rendered,
          traitId: lastEntry ? lastEntry.traitId : null,
          ethTotal: '0',
          flipTotal: '0',
          ticketTotal: 0,
        });
      }
    }

    // farFuture wins → center diamond: sum all amounts
    let ffTotal = 0n;
    for (const win of farFutureWins) {
      ffTotal += BigInt(win.amount || '0');
    }
    if (ffTotal > 0n) {
      this.#centerWins.push({ awardType: 'flip', amount: ffTotal.toString(), traitId: null });
    }
  }

  /**
   * Reset only the scratch/reveal state of the main widget (canvases, prizes, badges)
   * without touching data-loading state. Used before re-running the spin for Roll 2.
   */
  #resetMainWidget() {
    this.#animId++;
    this.#skipSpinId = null;
    this.#spinning = false;
    this.#sfxScratchStop();

    const quads = this.querySelectorAll('.replay-tq');
    quads.forEach(q => {
      q.classList.remove(
        'revealed', 'q-has-trait', 'q-no-tickets', 'q-traits-pending', 'q-scratchable',
        'q-has-tickets', 'q-public-result', 'q-win-impossible', 'q-win-impossible-lock',
        'q-owned-miss', 'q-player-win', 'q-solo-eth-win', 'q-gold-trait', 'q-scratch-underlay',
        'q-result-pending', 'q-result-revealed',
      );
      const img = q.querySelector('.badge-img');
      if (img) { img.src = ''; img.alt = ''; img.style.opacity = '0'; img.style.display = ''; }
      const canvas = q.querySelector('.replay-scratch-canvas');
      if (canvas) { canvas.style.opacity = '0'; canvas.style.pointerEvents = 'none'; }
      const prize = q.querySelector('.replay-prize-reveal');
      if (prize) {
        prize.classList.remove(
          'visible',
          'replay-bucket-reveal',
          'replay-player-win-reveal',
          ...BUCKET_REVEAL_POSITION_CLASSES,
          ...BUCKET_REVEAL_VARIANT_CLASSES,
        );
        prize.innerHTML = '';
        prize.removeAttribute('aria-label');
      }
    });
    this.#clearScatteredBadges();
    this.#hideCenterScratch();
    this.querySelector('[data-bind="card-grid"]')
      ?.classList.remove('replay-ticket--has-owned-gold');

    this.#scratched = [false, false, false, false];
    this.#scratchGrids = [null, null, null, null];
    this.#greenRevealed = [false, false, false, false];
    this.#badgesRevealed = [[], [], [], []];
    this.#quadBadgeBounds = [null, null, null, null];
    this.#quadOwned = [false, false, false, false];
    this.#quadPublicSummaries = [null, null, null, null];
    this.#centerScratched = false;
    this.#centerScratchGrid = null;

  }

  async #runSpin(displayTraits, { instant = false, announce = true } = {}) {
    this.#stopIdleSpin();
    const myId = ++this.#animId;
    const spinSelectionKey = this.#selectionKey();
    const spinBonusPhase = this.#bonusPhase;
    this.#skipSpinId = null;
    this.#spinning = true;
    const quads = this.querySelectorAll('.replay-tq');
    // Track the viewed player's result in each quadrant. The main draw now lets
    // every quadrant scratch; this ownership state still drives the reel colours
    // and win sound. Roll 2 keeps its player-eligible-only scratch behavior.
    if (this.#bonusPhase) {
      for (let i = 0; i < 4; i++) {
        const contractQ = displayTraits[i] != null ? Math.floor(displayTraits[i] / 64) : -1;
        const hasPlayerWin = contractQ >= 0 && this.#bonusQuadrants.has(contractQ);
        // Roll 2 uses future-level holdings. A held offered trait that missed
        // its bucket is still a possible-win blue face, just like Roll 1; an
        // actual win is authoritative even if the by-trait endpoint lags.
        this.#quadOwned[i] = hasPlayerWin
          || (displayTraits[i] != null && this.#futureTraitIds.has(displayTraits[i]));
      }
    } else {
      const roll1TraitIds = new Set(this.#playerRoll1Wins.map(r => r.traitId).filter(t => t != null));
      for (let i = 0; i < 4; i++) {
        // Ownership and winning are different states. A player can hold the
        // offered trait and lose the bucket; that face must stay blue/gold
        // ("didn't win"), not flip to the red "win not possible" treatment.
        // A winner row is also authoritative ownership if the trait endpoint
        // happens to lag.
        this.#quadOwned[i] = displayTraits[i] != null
          && (this.#playerTraitIds.has(displayTraits[i])
            || roll1TraitIds.has(displayTraits[i]));
      }
    }

    // The set the spin colours against: the bonus roll grades the player's
    // future-level holdings, the main roll the day's level.
    const spinOwned = this.#bonusPhase ? this.#futureTraitIds : this.#playerTraitIds;

    // Reset state
    this.#scratched = [false, false, false, false];
    this.#scratchGrids = [null, null, null, null];
    this.#greenRevealed = [false, false, false, false];
    this.#badgesRevealed = [[], [], [], []];
    this.#quadBadgeBounds = [null, null, null, null];
    this.#centerScratched = false;
    this.#centerScratchGrid = null;
    this.#soloEthCuePlayed = false;
    this.#sfxScratchStop();

    // Start flame spinning animation
    const center = this.querySelector('[data-bind="center"]');
    if (center) center.classList.add('spinning');

    // Hide center scratch canvas and prize
    this.#hideCenterScratch();

    // Clear canvases and prizes
    this.#clearScatteredBadges();
    const mainBadges = this.querySelectorAll('.replay-ticket .badge-img');
    for (const mb of mainBadges) {
      mb.style.display = '';
      mb.removeAttribute('width');
      mb.removeAttribute('height');
    }

    for (let i = 0; i < 4; i++) {
      const canvas = quads[i].querySelector('.replay-scratch-canvas');
      if (canvas) {
        canvas.style.transition = 'none';
        canvas.style.opacity = '0';
        canvas.style.pointerEvents = 'none';
      }
      const prize = quads[i].querySelector('.replay-prize-reveal');
      if (prize) {
        prize.classList.remove(
          'visible',
          'replay-bucket-reveal',
          'replay-player-win-reveal',
          ...BUCKET_REVEAL_POSITION_CLASSES,
          ...BUCKET_REVEAL_VARIANT_CLASSES,
        );
        prize.innerHTML = '';
        prize.removeAttribute('aria-label');
      }
    }

    // Compute target for each display position
    const targets = displayTraits.map((traitId, i) => {
      if (traitId == null) return { contractQ: DISPLAY_ORDER[i], sym: 0, col: 0 };
      const contractQ = Math.floor(traitId / 64);
      const within = traitId % 64;
      // Canonical decode: symbol = bits 2:0 (within % 8), color = bits 5:3
      // (within / 8) — matches traitToBadge / foil-match.js. The prior swap
      // transposed symbol and color on every reel badge.
      return { contractQ, sym: within % 8, col: Math.floor(within / 8) };
    });

    // Refresh restoration: use the exact same ownership/prize preparation as
    // a played spin, but land synchronously and remove every cover. No sound,
    // celebration, or completion event is replayed on page load.
    if (instant) {
      this.#spinning = false;
      for (let i = 0; i < 4; i++) {
        const category = BADGE_QUADRANTS[DISPLAY_ORDER[i]];
        const img = quads[i].querySelector('.badge-img');
        if (img) {
          img.src = badgeCircularPath(category, targets[i].sym, targets[i].col);
          img.style.opacity = '1';
        }
      }
      this.#afterSpin(displayTraits, targets, quads, { announce });
      for (let i = 0; i < 4; i++) {
        this.#revealQuadrant(i, { instant: true, silent: true });
      }
      this.#revealCenter({ instant: true, silent: true });
      return true;
    }

    // Spin state
    const lockedColors = [false, false, false, false];
    const lockedSymbols = [false, false, false, false];
    let locksDone = 0;
    const totalLocks = 8;
    let idleCount = 2 + Math.floor(Math.random() * 3);
    let finalLockSettling = false;

    // Phase 64 (app embed): publish two separate views of the reel state.
    // `traits` contains durable locks only: a quadrant commits once BOTH its
    // colour and symbol stop. `liveTraits` is the exact badge painted on this
    // frame, including still-cycling reels. Hosts can therefore replace a
    // transient lamp on every frame without losing already-committed locks.
    // The opening emit contains four nulls in both arrays and clears the prior
    // roll before the first new frame is painted.
    const emitSpinProgress = (liveTraits = [null, null, null, null]) => {
      const traits = [null, null, null, null];
      for (let i = 0; i < 4; i++) {
        if (!lockedSymbols[i] || !lockedColors[i]) continue;
        if (displayTraits[i] == null) continue;
        const { contractQ, col, sym } = targets[i];
        if (!(contractQ >= 0 && contractQ < 4)) continue;
        traits[contractQ] = (contractQ * 64) + (col * 8) + sym;
      }
      if (!announce) return;
      try {
        this.dispatchEvent(new CustomEvent('replay:spin-progress', {
          detail: {
            day: this.#selectedDay,
            player: this.#selectedPlayer,
            bonusPhase: this.#bonusPhase,
            traits,
            liveTraits,
          },
          bubbles: true,
        }));
      } catch { /* headless / CustomEvent shim absent */ }
    };

    setMajorDrawActivity('jackpot-replay', true);
    return new Promise(resolve => {
      let activitySettled = false;
      const settle = (completed) => {
        if (!activitySettled) {
          activitySettled = true;
          setMajorDrawActivity('jackpot-replay', false);
        }
        resolve(completed);
      };
      const step = () => {
        if (myId !== this.#animId) {
          const intentionalSkip = this.#skipSpinId === myId
            && this.#selectionKey() === spinSelectionKey
            && this.#bonusPhase === spinBonusPhase;
          if (!intentionalSkip) {
            settle(false);
            return;
          }
          this.#skipSpinId = null;
          this.#spinning = false;
          // A center-flame click is an explicit request to skip this exact
          // spin. Paint and reveal one coherent captured main/bonus result.
          for (let i = 0; i < 4; i++) {
            const contractQ = DISPLAY_ORDER[i];
            const category = BADGE_QUADRANTS[contractQ];
            const path = badgeCircularPath(category, targets[i].sym, targets[i].col);
            const img = quads[i].querySelector('.badge-img');
            if (img) { img.src = path; img.style.opacity = '1'; }
          }
          this.#afterSpin(displayTraits, targets, quads);
          // Auto-reveal all quadrants and center
          for (let i = 0; i < 4; i++) this.#revealQuadrant(i);
          this.#revealCenter();
          settle(true);
          return;
        }

        // The final frame already contains all four authoritative traits and
        // their locked eligibility colours. Hold it for one paint interval
        // before mounting the identically coloured scratch covers.
        if (finalLockSettling) {
          this.#spinning = false;
          for (let i = 0; i < 4; i++) {
            const category = BADGE_QUADRANTS[DISPLAY_ORDER[i]];
            const img = quads[i].querySelector('.badge-img');
            if (img) img.src = badgeCircularPath(category, targets[i].sym, targets[i].col);
          }
          this.#afterSpin(displayTraits, targets, quads);
          settle(true);
          return;
        }

        // Advance one color/symbol lock before painting this frame. That makes
        // the selected quadrant visibly assume its final trait and eligibility
        // state at the moment its lock sound plays, including the eighth lock.
        let lockedQuadrant = null;
        if (idleCount <= 0 && locksDone < totalLocks) {
          const available = [];
          for (let q = 0; q < 4; q++) {
            if (!lockedColors[q]) available.push({ q, type: 'color' });
            else if (!lockedSymbols[q]) available.push({ q, type: 'symbol' });
          }
          if (available.length > 0) {
            const pick = available[Math.floor(Math.random() * available.length)];
            if (pick.type === 'color') lockedColors[pick.q] = true;
            else lockedSymbols[pick.q] = true;
            locksDone++;
            if (pick.type === 'symbol') lockedQuadrant = pick.q;
            idleCount = 2 + Math.floor(Math.random() * 3);
          }
        } else {
          idleCount--;
        }

        // Render random or locked badges and capture the exact four traits
        // shown by this painted frame in contract-quadrant order.
        let frameWinnableCount = 0;
        let frameHasGoldWinnable = false;
        const liveTraits = [null, null, null, null];
        for (let i = 0; i < 4; i++) {
          const contractQ = DISPLAY_ORDER[i];
          const sym = lockedSymbols[i] ? targets[i].sym : Math.floor(Math.random() * 8);
          const col = lockedColors[i] ? targets[i].col : Math.floor(Math.random() * 8);
          const shownTrait = contractQ * 64 + col * 8 + sym;
          liveTraits[contractQ] = shownTrait;
          const category = BADGE_QUADRANTS[contractQ];
          const path = badgeCircularPath(category, sym, col);

          const img = quads[i].querySelector('.badge-img');
          if (img) { img.src = path; img.style.opacity = '1'; }

          // Background colouring during the spin. Blue means "you hold THIS
          // trait" and is checked against the badge currently on screen, so the
          // colour tracks the reels instead of flashing at random (user call).
          // Which holdings count depends on the roll: the main spin draws from
          // the day's level, the bonus spin from the levels above it.
          quads[i].classList.remove(
            'q-has-trait',
            'q-no-tickets',
            'q-traits-pending',
            'q-scratchable',
            'q-has-tickets',
            'q-gold-trait',
            'q-win-impossible-lock',
          );
          if (lockedSymbols[i] && lockedColors[i]) {
            // Fully locked -- ownership state, which is also what decides
            // scratchability once the reels stop.
            quads[i].classList.add(this.#quadOwned[i] ? 'q-has-trait' : 'q-no-tickets');
            // A target not owned for this draw = guaranteed loss. Commit the darker
            // scratch-front color as THIS quadrant locks. #afterSpin swaps the
            // paper underneath to the lighter pink while painting this same
            // dark color onto the removable canvas, so there is no face snap.
            if (!this.#quadOwned[i]) {
              quads[i].classList.add('q-win-impossible-lock');
            } else {
              quads[i].classList.remove('q-win-impossible-lock');
            }
            if (!this.#bonusPhase && this.#quadOwned[i] && targets[i].col === 7) {
              quads[i].classList.add('q-gold-trait');
            }
            if (this.#quadOwned[i]) {
              frameWinnableCount += 1;
              if (!this.#bonusPhase && targets[i].col === 7) frameHasGoldWinnable = true;
            }
          } else {
            quads[i].classList.remove('q-win-impossible-lock');
            const ownsShown = spinOwned.has(shownTrait);
            quads[i].classList.add(ownsShown ? 'q-has-trait' : 'q-no-tickets');
            if (ownsShown) frameWinnableCount += 1;
            if (!this.#bonusPhase && ownsShown && col === 7) {
              quads[i].classList.add('q-gold-trait');
              frameHasGoldWinnable = true;
            }
          }
        }
        this.#syncOwnedGoldState(quads);
        emitSpinProgress(liveTraits);
        // Ordinary frames get one terse digital pulse whose pitch/volume
        // follows the blue count. A lock frame substitutes its red/blue/gold
        // cue instead of stacking both sounds on the same animation frame.
        if (lockedQuadrant != null) {
          this.#sfxLock({
            winnable: this.#quadOwned[lockedQuadrant],
            gold: !this.#bonusPhase
              && this.#quadOwned[lockedQuadrant]
              && targets[lockedQuadrant].col === 7,
          });
        } else {
          this.#sfxSpinFrame(frameWinnableCount, frameHasGoldWinnable, locksDone);
        }

        // Check if all locked
        if (locksDone >= totalLocks) {
          const anyOwned = this.#quadOwned.some(o => o);
          this.#sfxAllLocked(anyOwned);
          finalLockSettling = true;
          setTimeout(step, FINAL_LOCK_SETTLE_MS);
          return;
        }

        const delay = 80 + Math.floor((locksDone / totalLocks) * 120);
        setTimeout(step, delay);
      };
      emitSpinProgress();
      step();
    });
  }

  #afterSpin(displayTraits, targets, quads, { announce = true } = {}) {
    // Stop flame spinning
    const center = this.querySelector('[data-bind="center"]');
    if (center) center.classList.remove('spinning');

    // Both draws expose the complete public board. A player with no winning
    // entry uncovers the public bucket result: badge, per-entry payout, and
    // winning-entry count (ETH for Roll 1, FLIP for Roll 2).
    this.#quadPublicSummaries = this.#bonusPhase
      ? buildRoll2BucketSummaries(this.#dayRoll2?.wins, displayTraits)
      : buildRoll1BucketSummaries(
          this.#dayRoll1?.wins,
          displayTraits,
          this.#openingFlipDay ? 'FLIP' : 'ETH',
        );

    let anyScratchable = false;
    for (let i = 0; i < 4; i++) {
      quads[i].classList.remove(
        'q-has-trait',
        'q-no-tickets',
        'q-traits-pending',
        'q-public-result',
        'q-win-impossible',
        'q-win-impossible-lock',
        'q-owned-miss',
        'q-player-win',
        'q-gold-trait',
        'q-scratch-underlay',
        'q-result-pending',
        'q-result-revealed',
        'q-solo-eth-win',
      );
      const hasPlayerWin = this.#quadWinArrays[i]
        .some((d) => d.awardType !== 'overflow');
      const isSoloEthWin = hasPlayerWin
        && !this.#bonusPhase
        && this.#isSoloEthWinner(i);
      const heldTraits = this.#bonusPhase ? this.#futureTraitIds : this.#playerTraitIds;
      const winnerProvesDisplayedOwnership = this.#quadWinArrays[i]
        .some((d) => d.traitId != null && Number(d.traitId) === Number(displayTraits[i]));
      const ownsDisplayedTrait = displayTraits[i] != null
        && (heldTraits.has(displayTraits[i]) || winnerProvesDisplayedOwnership);
      // Gold is a special main-jackpot eligibility signal. The bonus jackpot
      // does not pay that gold-trait mechanic, so its held/winning gold badges
      // keep the ordinary blue/green treatment instead of advertising a prize
      // that is not available in Roll 2.
      const ownsDisplayedGold = !this.#bonusPhase
        && ownsDisplayedTrait
        && isGoldTrait(displayTraits[i]);
      const publicResult = !hasPlayerWin
        ? (this.#quadPublicSummaries[i] || {
            traitId: displayTraits[i],
            winnerCount: null,
            perWinWei: null,
            currency: (this.#bonusPhase || this.#openingFlipDay) ? 'FLIP' : 'ETH',
          })
        : null;
      const scratchable = true;
      if (!scratchable) {
        this.#scratched[i] = true;
        quads[i].classList.add('q-no-tickets');
        continue;
      }

      anyScratchable = true;
      // The scratch cover carries blue/red/gold eligibility. Beneath it, keep
      // potential/actual wins neutral until the completion threshold (or an actual
      // win badge is uncovered). The same neutral grey also sits beneath a
      // darker-pink known-loss cover, so a partial scratch never leaks the final
      // pink paper before the completion threshold.
      quads[i].classList.add('q-scratchable');
      quads[i].classList.add('q-scratch-underlay');
      if (isSoloEthWin) quads[i].classList.add('q-solo-eth-win');
      if (ownsDisplayedGold) {
        quads[i].classList.add('q-gold-trait');
      } else if (hasPlayerWin) {
        quads[i].classList.add('q-player-win');
      } else if (publicResult && ownsDisplayedTrait) {
        quads[i].classList.add('q-owned-miss');
      } else if (publicResult) {
        quads[i].classList.add('q-win-impossible');
      }
      if (!(publicResult && !ownsDisplayedTrait)) {
        quads[i].classList.add('q-result-pending');
      }
      const canvas = quads[i].querySelector('.replay-scratch-canvas');
      const badge = quads[i].querySelector('.badge-img');
      this.#initScratchCanvasWithBadge(
        canvas,
        badge ? badge.src : '',
        ownsDisplayedGold
          ? GOLD_TRAIT_COVER_FILL
          : hasPlayerWin
            ? POSSIBLE_WIN_COVER_FILL
          : publicResult && !ownsDisplayedTrait
            ? NO_WIN_COVER_FILL
            : POSSIBLE_WIN_COVER_FILL,
      );
      canvas.style.transition = 'none';
      canvas.style.opacity = '1';
      canvas.style.pointerEvents = 'auto';

      if (publicResult) {
        quads[i].classList.add('q-public-result');
        // The badge is already painted into the removable canvas; the smaller
        // result badge below should be what appears as the player scratches.
        if (badge) badge.style.display = 'none';
        this.#renderPublicBucketReveal(i, publicResult);
      }
      this.#wireCanvas(canvas, i);
    }
    this.#syncOwnedGoldState(quads);

    // Hide main badges and place scattered badges only where THIS player won.
    // Bug 1 fix: sync the scratch canvas cover badge to the actual winning trait
    // (first entry's traitId) rather than the RNG-derived displayTrait, so the top
    // symbol matches the revealed symbols underneath.
    for (let i = 0; i < 4; i++) {
      const wins = this.#quadWinArrays[i];
      const hasPlayerWin = wins.some((d) => d.awardType !== 'overflow');
      if (hasPlayerWin) {
        const mainBadge = quads[i].querySelector('.badge-img');

        // Determine the canonical winning traitId for this quadrant.
        // For Roll 2 bonus the displayed RNG trait can differ from the player's
        // actual winning trait — use the first win entry's traitId when present.
        const canonicalTraitId = wins.length > 0 && wins[0].traitId != null
          ? wins[0].traitId
          : displayTraits[i];
        const canonicalBadge = traitToBadge(canonicalTraitId);
        const canonicalSrc = canonicalBadge ? canonicalBadge.path : (mainBadge ? mainBadge.src : '');

        // Re-paint the scratch cover with the winning trait badge so top = reveal.
        const canvas = quads[i].querySelector('.replay-scratch-canvas');
        if (canvas && canonicalSrc) {
          const canonicalGold = !this.#bonusPhase && isGoldTrait(canonicalTraitId);
          this.#initScratchCanvasWithBadge(
            canvas,
            canonicalSrc,
            canonicalGold ? GOLD_TRAIT_COVER_FILL : POSSIBLE_WIN_COVER_FILL,
          );
          if (canonicalGold) {
            quads[i].classList.add('q-gold-trait');
            quads[i].classList.remove('q-player-win');
          } else {
            quads[i].classList.add('q-player-win');
          }
        }
        // Also update the visible badge-img to match (shown briefly before hide).
        if (mainBadge && canonicalSrc) mainBadge.src = canonicalSrc;

        if (mainBadge) mainBadge.style.display = 'none';
        if (wins.length > 0) {
          this.#placeWinBadges(i, canonicalTraitId);
        }
      }
    }
    this.#syncOwnedGoldState(quads);

    // Show center diamond scratch if player has FLIP wins
    if (this.#centerWins.length > 0) {
      this.#showCenterScratch();
      anyScratchable = true;
    }

    // Blue/gold already identifies possible wins. Require those covers even
    // when they hide an owned miss; red guaranteed-loss results stay optional.
    if (!this.#bonusPhase) this.#refreshMainPotentialScratchGate();

    // Phase 64 (app embed): announce spin completion so host shells can sync
    // post-spin visuals such as foil match lighting. Scratch completion below
    // remains the spoiler/persistence gate. Additive — no behavior change for
    // /play or /beta consumers.
    if (announce) {
      try {
        this.dispatchEvent(new CustomEvent('replay:spin-complete', {
          detail: {
            day: this.#selectedDay,
            player: this.#selectedPlayer,
            bonusPhase: this.#bonusPhase,
          },
          bubbles: true,
        }));
      } catch { /* headless / CustomEvent shim absent */ }
    }

    // Nothing scratchable this roll (defensive malformed/empty board) —
    // the reveal is trivially complete, so fire scratch-complete right away
    // or host gates would never open on lossless days.
    if (!anyScratchable && announce) this.#dispatchScratchComplete();
  }

  // Phase 64 (app embed): announce full scratch completion — every owned
  // quadrant revealed and the center diamond (when present) scratched.
  // Fires once per roll (Roll 1 and the bonus Roll 2 complete independently);
  // #revealQuadrant/#revealCenter guards keep it single-shot within a roll.
  // Additive — no behavior change for /play or /beta consumers.
  //
  // detail.bonusAvailable — a bonus Roll 2 is still ahead of the player
  // (eligible + not yet in the bonus phase). Hosts that gate "the whole
  // board is played out" on this: final = bonusPhase || !bonusAvailable.
  #dispatchScratchComplete() {
    try {
      this.dispatchEvent(new CustomEvent('replay:scratch-complete', {
        detail: {
          day: this.#selectedDay,
          player: this.#selectedPlayer,
          bonusPhase: this.#bonusPhase,
          bonusAvailable: this.#hasBonus && !this.#bonusPhase,
        },
        bubbles: true,
      }));
    } catch { /* headless / CustomEvent shim absent */ }
  }

  // --- Canvas scratch initialization ---

  /**
   * Paint a main-draw bucket result under the scratch cover when the viewed
   * player has no winning entry in that quadrant.
   */
  #renderPublicBucketReveal(qIdx, summary) {
    const quads = this.querySelectorAll('.replay-tq');
    const host = quads[qIdx] && quads[qIdx].querySelector('.replay-prize-reveal');
    if (!host) return;
    host.textContent = '';
    host.classList.remove(
      'replay-player-win-reveal',
      ...BUCKET_REVEAL_POSITION_CLASSES,
      ...BUCKET_REVEAL_VARIANT_CLASSES,
    );
    host.classList.add('replay-bucket-reveal', `replay-bucket-reveal--q${qIdx}`);
    if (!this.#bonusPhase) host.classList.add('replay-bucket-reveal--main-miss');

    const currencyWinnerCount = summary.winnerCount == null
      ? null
      : Number(summary.winnerCount);
    const currency = summary.currency === 'FLIP' ? 'FLIP' : 'ETH';
    const isSoloEth = currency === 'ETH' && currencyWinnerCount === 1;
    if (isSoloEth) {
      host.classList.add('replay-bucket-reveal--solo-eth');
    }

    const badge = traitToBadge(summary.traitId);
    // Keep badge geometry independent from the variable-height receipt below.
    // A solo result may use larger type or omit tickets entirely; neither may
    // move the badge off the center shared by its neighboring quadrant.
    const badgeStage = document.createElement('div');
    badgeStage.className = 'replay-bucket-badge-stage';
    if (badge) {
      const badgeImg = document.createElement('img');
      badgeImg.className = 'replay-bucket-badge';
      badgeImg.src = badge.path;
      badgeImg.alt = '';
      badgeStage.appendChild(badgeImg);
    }
    host.appendChild(badgeStage);

    const receipt = document.createElement('div');
    receipt.className = 'replay-bucket-receipt';

    const amount = document.createElement('div');
    amount.className = 'replay-bucket-amount';
    if (isSoloEth) amount.classList.add('replay-bucket-amount--solo-eth');
    const num = document.createElement('span');
    num.className = 'replay-bucket-value';
    const formattedCurrencyAward = summary.perWinWei == null
      ? '—'
      : currency === 'FLIP'
        ? formatFlip(summary.perWinWei.toString())
        : currencyWinnerCount === 1
          ? formatEthTruncated(summary.perWinWei.toString())
          : formatEth(summary.perWinWei.toString());
    num.textContent = formattedCurrencyAward;
    const currencyIcon = document.createElement('img');
    currencyIcon.className = 'replay-bucket-eth replay-bucket-currency';
    currencyIcon.src = currency === 'FLIP'
      ? '/whitepaper/flame-logo-split.svg'
      : '/symbols/crypto_06_ethereum_silver.svg';
    currencyIcon.alt = currency;
    if (currency === 'FLIP') {
      amount.appendChild(currencyIcon);
      amount.appendChild(num);
    } else {
      amount.appendChild(num);
      amount.appendChild(currencyIcon);
    }
    // The featured treatment already communicates that this is the lone ETH
    // winner; repeating ×1 beside it adds noise without adding information.
    if (!isSoloEth) {
      const currencyWinners = document.createElement('span');
      currencyWinners.className = 'replay-bucket-row-count replay-bucket-row-count--currency';
      currencyWinners.textContent = `×${Number.isFinite(currencyWinnerCount) ? currencyWinnerCount : '—'}`;
      amount.appendChild(currencyWinners);
    }
    receipt.appendChild(amount);

    const ticketEntriesMin = Number(
      summary.ticketEntriesMin ?? summary.ticketEntriesPerWinner,
    );
    const ticketEntriesMax = Number(
      summary.ticketEntriesMax ?? summary.ticketEntriesPerWinner,
    );
    const ticketCountMin = Number.isFinite(ticketEntriesMin)
      ? joScaledToTickets(ticketEntriesMin)
      : null;
    const ticketCountMax = Number.isFinite(ticketEntriesMax)
      ? joScaledToTickets(ticketEntriesMax)
      : null;
    const ticketCountLabel = ticketCountMin == null || ticketCountMax == null
      ? '—'
      : ticketCountMin === ticketCountMax
        ? ticketCountMin.toLocaleString('en-US', { maximumFractionDigits: 2 })
        : `${ticketCountMin.toLocaleString('en-US', { maximumFractionDigits: 2 })}–${ticketCountMax.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    const ticketWinnerCount = summary.ticketWinnerCount == null
      ? null
      : Number(summary.ticketWinnerCount);
    const hasTicketAward = ticketCountMax != null && ticketCountMax > 0;
    if (hasTicketAward) {
      const tickets = document.createElement('div');
      tickets.className = 'replay-bucket-tickets';
      const perWinnerTickets = document.createElement('span');
      perWinnerTickets.className = 'replay-bucket-ticket-count';
      perWinnerTickets.textContent = ticketCountLabel;
      // Keep the award icon recognizably Degenerus at its tiny display size: it
      // is a complete four-badge ticket, not a blank admission-ticket glyph.
      // Mix both symbol and color across the four quadrants. The old 0/64/128/192
      // sample picked color slot zero four times, so the award looked like four
      // copies of the same pink/red ticket rather than a real inventory ticket.
      const ticketIcon = createJackpotTicketIcon();
      tickets.appendChild(perWinnerTickets);
      tickets.appendChild(ticketIcon);
      const ticketWinners = document.createElement('span');
      ticketWinners.className = 'replay-bucket-row-count replay-bucket-row-count--tickets';
      ticketWinners.textContent = `×${Number.isFinite(ticketWinnerCount) ? ticketWinnerCount : '—'}`;
      tickets.appendChild(ticketWinners);
      receipt.appendChild(tickets);
    }
    host.appendChild(receipt);

    const perWin = summary.perWinWei == null
      ? `unknown ${currency}`
      : `${formattedCurrencyAward} ${currency}`;
    const currencyWinnersLabel = Number.isFinite(currencyWinnerCount)
      ? `${currencyWinnerCount} currency winner${currencyWinnerCount === 1 ? '' : 's'}`
      : 'unknown currency winners';
    const ticketWinnersLabel = Number.isFinite(ticketWinnerCount)
      ? `${ticketWinnerCount} ticket winner${ticketWinnerCount === 1 ? '' : 's'}`
      : 'unknown ticket winners';
    const ticketLabel = ticketCountMin == null || ticketCountMax == null
      ? 'unknown tickets'
      : `${ticketCountLabel} ticket${ticketCountMin === 1 && ticketCountMax === 1 ? '' : 's'}`;
    const ticketAwardLabel = hasTicketAward
      ? `; ticket award ${ticketLabel}, ${ticketWinnersLabel}`
      : '';
    host.setAttribute(
      'aria-label',
      `You did not win this quadrant. Bucket result: currency award ${perWin}, ${currencyWinnersLabel}${ticketAwardLabel}`,
    );
  }

  #syncOwnedGoldState(quads = this.querySelectorAll('.replay-tq')) {
    const hasOwnedGold = Array.from(quads || [])
      .some((quad) => quad.classList?.contains('q-gold-trait'));
    this.querySelector('[data-bind="card-grid"]')
      ?.classList.toggle('replay-ticket--has-owned-gold', hasOwnedGold);
  }

  /** Render the viewed player's actual payout inside a revealed win quadrant. */
  #renderPlayerWinReveal(qIdx, host) {
    if (!host) return;
    const wins = (this.#quadWinArrays[qIdx] || [])
      .filter((win) => win.awardType !== 'overflow');
    if (wins.length === 0) return;

    let ethTotal = 0n;
    let flipTotal = 0n;
    let dgnrsTotal = 0n;
    let ticketEntries = 0;
    let whaleCount = 0;
    for (const win of wins) {
      const type = String(win.awardType || '').toLowerCase();
      if (type === 'aggregated') {
        ethTotal += BigInt(win.ethTotal || '0');
        flipTotal += BigInt(win.flipTotal || '0');
        dgnrsTotal += BigInt(win.dgnrsTotal || '0');
        ticketEntries += Number(win.ticketTotal || 0);
        whaleCount += Number(win.whalePassCount || 0);
      } else if (type === 'flip' || type === 'farfuturecoin' || win.currency === 'FLIP') {
        flipTotal += BigInt(win.amount || '0');
      } else if (type === 'dgnrs' || win.currency === 'DGNRS') {
        dgnrsTotal += BigInt(win.amount || '0');
      } else if (type === 'tickets' || type === 'ticket') {
        ticketEntries += Number(win.amount || 0);
      } else if (type === 'whale_pass') {
        whaleCount += Number(win.amount || 1);
      } else {
        ethTotal += BigInt(win.amount || '0');
      }
    }

    const lines = [];
    const isSoloBucket = Number(this.#quadPublicSummaries[qIdx]?.winnerCount) === 1
      || wins.some((win) => win.isSolo);
    if (ethTotal > 0n) {
      const formattedEth = isSoloBucket
        ? formatEthTruncated(ethTotal.toString())
        : formatEth(ethTotal.toString());
      lines.push({ text: `${formattedEth} ETH`, aria: `${formattedEth} ETH` });
    }
    if (flipTotal > 0n) {
      const amount = formatFlip(flipTotal.toString());
      lines.push({
        text: amount,
        aria: `${amount} FLIP`,
        icon: '/whitepaper/flame-logo-split.svg',
      });
    }
    if (dgnrsTotal > 0n) {
      const amount = formatFlip(dgnrsTotal.toString());
      lines.push({ text: `${amount} DGNRS`, aria: `${amount} DGNRS` });
    }
    // JackpotTicketWin stores entryCount (4 entries = one whole ticket).
    // Day Summary already uses this conversion; keeping raw entries here is
    // what produced contradictory receipts such as 56 tickets versus 14.
    const ticketCount = joScaledToTickets(ticketEntries);
    if (ticketCount > 0) {
      const text = `${ticketCount} ticket${ticketCount === 1 ? '' : 's'}`;
      lines.push({ text, aria: text });
    }
    if (whaleCount > 0) {
      const text = formatWhalePassAward(whaleCount);
      lines.push({ text, aria: text });
    }
    if (lines.length === 0) {
      const text = `${wins.length} win${wins.length === 1 ? '' : 's'}`;
      lines.push({ text, aria: text });
    }

    host.textContent = '';
    host.classList.remove(
      'replay-bucket-reveal',
      ...BUCKET_REVEAL_POSITION_CLASSES,
      ...BUCKET_REVEAL_VARIANT_CLASSES,
    );
    host.classList.add('replay-player-win-reveal');
    const receipt = document.createElement('div');
    // Hold the receipt through the quadrant's opening beat. If one or more
    // badge reward callouts start under the pointer, #syncWinReceiptVisibility
    // keeps every YOU WON receipt out of their way until the last callout has
    // finished. The gate is released alongside the prize layer below.
    receipt.className = 'replay-win-description is-waiting-for-reward-popups';
    receipt.dataset.rewardPopGate = 'pending';
    const title = document.createElement('strong');
    title.className = 'replay-win-description__title';
    title.textContent = 'YOU WON';
    receipt.appendChild(title);
    const details = document.createElement('div');
    details.className = 'replay-win-description__lines';
    for (const line of lines) {
      const item = document.createElement('span');
      item.className = 'replay-win-description__line';
      if (line.icon) {
        const icon = document.createElement('img');
        icon.className = 'replay-win-description__currency-icon';
        icon.src = line.icon;
        icon.alt = '';
        item.appendChild(icon);
      }
      const copy = document.createElement('span');
      copy.className = 'replay-win-description__line-copy';
      copy.textContent = line.text;
      item.appendChild(copy);
      details.appendChild(item);
    }
    receipt.appendChild(details);
    host.appendChild(receipt);
    host.setAttribute('aria-label', `You won ${lines.map((line) => line.aria).join(', ')}`);
    return receipt;
  }

  #syncWinReceiptVisibility() {
    const rewardPopActive = Boolean(
      this.querySelector('.replay-badge-wrap.is-reward-pop'),
    );
    for (const receipt of this.querySelectorAll('.replay-win-description')) {
      const openingGateActive = receipt.dataset.rewardPopGate === 'pending';
      receipt.classList.toggle(
        'is-waiting-for-reward-popups',
        openingGateActive || rewardPopActive,
      );
    }
  }

  #releaseWinReceipt(receipt) {
    if (receipt) delete receipt.dataset.rewardPopGate;
    this.#syncWinReceiptVisibility();
  }

  #initScratchCanvasWithBadge(canvas, badgeSrc, fillColor) {
    const quad = canvas.parentElement;
    const rect = quad.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    const ctx = canvas.getContext('2d');
    // Draw the cover with badge image (matching demo's drawBadgeCover). Default
    // is the blue scratch cover; a known loser passes the darker locked-face
    // pink while the lighter loser paper remains visible through scratches.
    ctx.fillStyle = fillColor || POSSIBLE_WIN_COVER_FILL;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => {
      // Circular badge SVGs have a generous transparent artboard. Match the
      // larger live badge without letting the painted ring crowd the center
      // diamond; the canvas clips the small intentional outer bleed.
      const size = Math.min(canvas.width, canvas.height) * 1.18;
      const x = (canvas.width - size) / 2;
      const y = (canvas.height - size) / 2;
      ctx.drawImage(img, x, y, size, size);
    };
    img.src = badgeSrc;
  }

  #scratchAt(canvas, cx, cy) {
    const dpr = window.devicePixelRatio || 1;
    const r = BRUSH_R * dpr;
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // --- Quadrant scratch wiring ---

  #wireCanvas(canvas, qIdx) {
    const knownLoser = canvas.parentElement?.classList?.contains('q-win-impossible');
    const revealThreshold = knownLoser
      ? KNOWN_LOSER_REVEAL_THRESHOLD
      : REVEAL_THRESHOLD;
    let lastPos = null;
    const onScratch = (cx, cy) => {
      if (this.#scratched[qIdx]) return;
      this.#sfxScratchStart();
      const dpr = window.devicePixelRatio || 1;
      const brushR = BRUSH_R * dpr;
      this.#scratchAt(canvas, cx, cy);
      if (!this.#scratchGrids[qIdx]) this.#scratchGrids[qIdx] = makeScratchGrid(GRID_RES);
      markGridCells(this.#scratchGrids[qIdx], GRID_RES, canvas.width, canvas.height, cx, cy, brushR);

      // Check if the scratch stroke reveals a paid badge and its win surface.
      if (this.#quadWinArrays[qIdx].length > 0 && this.#quadBadgeBounds[qIdx]) {
        const pctX = (cx / canvas.width) * 100;
        const pctY = (cy / canvas.height) * 100;
        const circles = this.#quadBadgeBounds[qIdx];
        const quads = this.querySelectorAll('.replay-tq');
        const quad = quads[qIdx];
        const badgeWraps = quad?.querySelectorAll?.('.replay-badge-wrap') || [];
        for (let ci = 0; ci < circles.length; ci++) {
          if (this.#badgesRevealed[qIdx].indexOf(ci) !== -1) continue;
          const ddx = pctX - circles[ci].cx, ddy = pctY - circles[ci].cy;
          if (ddx * ddx + ddy * ddy <= circles[ci].r * circles[ci].r) {
            this.#badgesRevealed[qIdx].push(ci);
            if (!this.#greenRevealed[qIdx]) {
              this.#greenRevealed[qIdx] = true;
              quad.classList.remove('q-scratchable', 'q-scratch-underlay', 'q-result-pending');
              quad.classList.add('q-result-revealed', 'q-has-tickets');
            }
            // The reward readout belongs to the exact paid-badge hit, not the
            // later full-quadrant threshold. Keep it on the same event turn as
            // the arcade coin cue so sight and sound identify one reveal.
            this.#sfxGreenReveal();
            this.#activateBadgeReward(badgeWraps[ci]);
          }
        }
      }

      // Interpolate between last position for smooth strokes
      if (lastPos) {
        const dx = cx - lastPos.x, dy = cy - lastPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.floor(dist / 4));
        for (let s = 1; s < steps; s++) {
          const ix = lastPos.x + dx * s / steps, iy = lastPos.y + dy * s / steps;
          this.#scratchAt(canvas, ix, iy);
          markGridCells(this.#scratchGrids[qIdx], GRID_RES, canvas.width, canvas.height, ix, iy, brushR);
        }
      }
      lastPos = { x: cx, y: cy };
      if (gridCoverage(this.#scratchGrids[qIdx]) >= revealThreshold) {
        this.#revealQuadrant(qIdx);
      }
    };

    const getPos = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      return { x: (clientX - rect.left) * dpr, y: (clientY - rect.top) * dpr };
    };

    canvas.addEventListener('mousemove', (e) => {
      if (this.#scratched[qIdx]) return;
      const p = getPos(e.clientX, e.clientY);
      onScratch(p.x, p.y);
    });
    canvas.addEventListener('mouseleave', () => { lastPos = null; this.#sfxScratchStop(); });
    canvas.addEventListener('touchstart', (e) => {
      if (this.#scratched[qIdx]) return;
      e.preventDefault(); lastPos = null;
      const t = e.touches[0], p = getPos(t.clientX, t.clientY);
      onScratch(p.x, p.y);
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (this.#scratched[qIdx]) return;
      e.preventDefault();
      const t = e.touches[0], p = getPos(t.clientX, t.clientY);
      onScratch(p.x, p.y);
    }, { passive: false });
    canvas.addEventListener('touchend', () => { lastPos = null; this.#sfxScratchStop(); });
  }

  // --- Center diamond scratch ---

  #hideCenterScratch() {
    const canvas = this.querySelector('[data-bind="center-canvas"]');
    const prize = this.querySelector('[data-bind="center-prize"]');
    const flame = this.querySelector('.replay-flame');
    const center = this.querySelector('[data-bind="center"]');
    if (canvas) { canvas.style.display = 'none'; canvas.style.opacity = '1'; canvas.style.pointerEvents = 'auto'; }
    if (prize) {
      prize.style.display = 'none';
      prize.innerHTML = '';
      prize.classList.remove('visible', 'replay-bucket-reveal');
      prize.removeAttribute('aria-label');
    }
    if (flame) { flame.style.display = ''; flame.style.filter = ''; }
    if (center) { center.classList.remove('revealed'); }
  }

  #showCenterScratch() {
    const canvas = this.querySelector('[data-bind="center-canvas"]');
    if (!canvas) return;
    const center = canvas.parentElement;
    const rect = center.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    // Hide the flame image
    const flame = this.querySelector('.replay-flame');
    if (flame) flame.style.display = 'none';

    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    // Dark cover with green-tinted flame
    ctx.fillStyle = '#0a1e1a';
    ctx.fillRect(0, 0, w, h);

    // Draw tinted flame on the cover
    const img = new Image();
    img.onload = () => {
      // Flame SVG viewBox is 38x54 (portrait) -- preserve aspect ratio
      const svgRatio = 38 / 54;
      const maxSize = Math.min(w, h) * 0.7;
      const drawW = maxSize * svgRatio;
      const drawH = maxSize;
      ctx.filter = 'sepia(1) saturate(3) hue-rotate(120deg) brightness(1.4)';
      ctx.drawImage(img, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
      ctx.filter = 'none';
    };
    img.src = '/specials/special_none.svg';

    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'auto';

    // Wire center scratch events
    this.#wireCenterCanvas(canvas);
  }

  #wireCenterCanvas(canvas) {
    let lastPos = null;
    const onScratch = (cx, cy) => {
      if (this.#centerScratched) return;
      this.#sfxScratchStart();
      const dpr = window.devicePixelRatio || 1;
      const brushR = BRUSH_R * dpr;
      this.#scratchAt(canvas, cx, cy);
      if (!this.#centerScratchGrid) this.#centerScratchGrid = makeScratchGrid(CENTER_GRID_RES);
      markGridCells(this.#centerScratchGrid, CENTER_GRID_RES, canvas.width, canvas.height, cx, cy, brushR);

      // Interpolate between last position for smooth strokes
      if (lastPos) {
        const dx = cx - lastPos.x, dy = cy - lastPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.floor(dist / 4));
        for (let s = 1; s < steps; s++) {
          const ix = lastPos.x + dx * s / steps, iy = lastPos.y + dy * s / steps;
          this.#scratchAt(canvas, ix, iy);
          markGridCells(this.#centerScratchGrid, CENTER_GRID_RES, canvas.width, canvas.height, ix, iy, brushR);
        }
      }
      lastPos = { x: cx, y: cy };
      // Center uses 50% threshold (smaller area)
      if (gridCoverage(this.#centerScratchGrid) >= 0.5) {
        this.#revealCenter();
      }
    };

    const getPos = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      return { x: (clientX - rect.left) * dpr, y: (clientY - rect.top) * dpr };
    };

    canvas.addEventListener('mousemove', (e) => {
      if (this.#centerScratched) return;
      const p = getPos(e.clientX, e.clientY);
      onScratch(p.x, p.y);
    });
    canvas.addEventListener('mouseleave', () => { lastPos = null; this.#sfxScratchStop(); });
    canvas.addEventListener('touchstart', (e) => {
      if (this.#centerScratched) return;
      e.preventDefault(); lastPos = null;
      const t = e.touches[0], p = getPos(t.clientX, t.clientY);
      onScratch(p.x, p.y);
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (this.#centerScratched) return;
      e.preventDefault();
      const t = e.touches[0], p = getPos(t.clientX, t.clientY);
      onScratch(p.x, p.y);
    }, { passive: false });
    canvas.addEventListener('touchend', () => { lastPos = null; this.#sfxScratchStop(); });
  }

  #revealCenter({ instant = false, silent = false } = {}) {
    if (this.#centerScratched || this.#centerWins.length === 0) return;
    this.#centerScratched = true;
    this.#sfxScratchStop();
    if (!silent) this.#sfxGreenReveal();

    const canvas = this.querySelector('[data-bind="center-canvas"]');
    const prize = this.querySelector('[data-bind="center-prize"]');
    const center = this.querySelector('[data-bind="center"]');

    // Darken diamond background
    if (center) center.classList.add('revealed');

    if (canvas) {
      canvas.style.transition = instant ? 'none' : 'opacity 0.35s ease';
      canvas.style.opacity = '0';
      canvas.style.pointerEvents = 'none';
    }

    if (prize) {
      const totalFlip = this.#centerWins.reduce((s, d) => s + BigInt(d.amount || '0'), 0n);
      const amountStr = formatFlip(totalFlip.toString());
      const compactAmountStr = formatCenterBonusFlip(totalFlip);
      prize.innerHTML = `
        <img class="ff-logo" src="/whitepaper/flame-logo-split.svg" alt="" aria-hidden="true">
        <span class="ff-amount">${compactAmountStr}</span>
        <span class="ff-label">BONUS</span>`;
      prize.setAttribute('aria-label', `${amountStr} FLIP bonus`);
      prize.setAttribute('title', `${amountStr} FLIP bonus`);
      prize.style.display = 'flex';
      prize.classList.remove('visible');
      if (instant) prize.classList.add('visible');
      else setTimeout(() => prize.classList.add('visible'), 200);
    }

    this.#checkAllScratched({ silent });
  }

  // --- Quadrant reveal ---

  #revealQuadrant(qIdx, { instant = false, silent = false } = {}) {
    if (this.#scratched[qIdx]) return;
    this.#scratched[qIdx] = true;
    this.#sfxScratchStop();
    const quads = this.querySelectorAll('.replay-tq');
    const quad = quads[qIdx];
    const canvas = quad.querySelector('.replay-scratch-canvas');
    const prize = quad.querySelector('.replay-prize-reveal');

    // Fade out canvas
    canvas.style.transition = instant ? 'none' : 'opacity 0.35s ease';
    canvas.style.opacity = '0';
    canvas.style.pointerEvents = 'none';

    const isWin = this.#quadWinArrays[qIdx].some(d => d.awardType !== 'overflow');
    const isSoloEthWin = isWin && !this.#bonusPhase && this.#isSoloEthWinner(qIdx);
    const publicSummary = this.#quadPublicSummaries[qIdx];
    const isSoloEthLoss = !isWin
      && !this.#bonusPhase
      && String(publicSummary?.currency || 'ETH').toUpperCase() !== 'FLIP'
      && Number(publicSummary?.winnerCount) === 1;
    // q-result-pending means the cover was blue/gold and the player could not
    // know the outcome yet. Give that specific blue→pink miss a small cue;
    // already-red guaranteed losses keep the ordinary quiet loss landing.
    const wasPotentialWin = quad.classList.contains('q-result-pending');
    if (!silent) {
      if (isSoloEthWin) {
        this.#soloEthCuePlayed = true;
        this.#sfxSoloEthReveal();
      } else if (isSoloEthLoss) {
        // The special cue belongs only to the actual solo winner. A losing
        // viewer uncovering the public solo bucket gets no reveal sound.
      } else if (isWin) this.#sfxReveal(true);
      else if (wasPotentialWin) this.#sfxPinkReveal();
      else this.#sfxReveal(false);
    }

    quad.classList.remove('q-scratchable', 'q-scratch-underlay', 'q-result-pending');
    quad.classList.add('q-result-revealed');
    if (isWin) {
      quad.classList.add('q-has-tickets');
      const badges = quad.querySelectorAll('.replay-badge-wrap');
      for (const badge of badges) badge.tabIndex = 0;
    } else {
      quad.classList.add('q-no-tickets');
      // Show main badge again for non-win owned quadrants
      const mainBadge = quad.querySelector('.badge-img');
      if (mainBadge) mainBadge.style.display = '';
    }

    // A public bucket result uses the same prize layer as a player win. Since
    // `isWin` is false, explicitly reveal it and keep the full-size live badge
    // hidden; the result carries its own smaller badge.
    if (quad.classList.contains('q-public-result') && prize && !isWin) {
      prize.classList.add('visible');
      const mainBadge = quad.querySelector('.badge-img');
      if (mainBadge) mainBadge.style.display = 'none';
    }

    // The public-result rebuild accidentally dropped the viewed player's own
    // payout copy. Restore it as a compact receipt inside the quadrant (not the
    // obsolete full-width winnings bar) and reveal it only after the cover is gone.
    if (prize && isWin) {
      const receipt = this.#renderPlayerWinReveal(qIdx, prize);
      prize.classList.remove('visible');
      const revealReceipt = () => {
        prize.classList.add('visible');
        this.#releaseWinReceipt(receipt);
      };
      if (instant) revealReceipt();
      else setTimeout(revealReceipt, 200);
    }

    // Append "+N more" overflow label only now that the quadrant is revealed
    // (deferred from #placeWinBadges so it doesn't show through the scratch canvas).
    const overflowEntry = this.#quadWinArrays[qIdx].find(d => d.awardType === 'overflow');
    if (isWin && overflowEntry && overflowEntry.overflowCount > 0) {
      const label = document.createElement('div');
      label.className = 'replay-badge-overflow-label';
      label.textContent = '+' + overflowEntry.overflowCount + ' more';
      quad.appendChild(label);
    }

    this.#checkAllScratched({ silent });
  }

  #checkAllScratched({ silent = false } = {}) {
    const centerPending = this.#centerWins.length > 0 && !this.#centerScratched;
    const allDone = this.#scratched.every(s => s) && !centerPending;
    if (!this.#bonusPhase) this.#refreshMainPotentialScratchGate();
    if (allDone) {
      if (!this.#bonusPhase) {
        this.#mainScratchComplete = true;
        this.#mainPotentialScratchComplete = true;
      } else {
        this.#bonusScratchComplete = true;
      }
      const anyWon = this.#quadWinArrays.some(w => w.some(d => d.awardType !== 'overflow')) || this.#centerWins.length > 0;
      if (!silent) {
        if (anyWon) this.#celebrate({ sound: !this.#soloEthCuePlayed });
        this.#dispatchScratchComplete();
      }
    }
    if (!this.#bonusPhase) {
      this.#syncSpinControlState();
      this.#showBonusSection();
    }
    this.#syncDrawToggleAffordance();
  }

  #isSoloEthWinner(qIdx) {
    const wins = (this.#quadWinArrays[qIdx] || [])
      .filter((win) => win.awardType !== 'overflow');
    const summary = this.#quadPublicSummaries[qIdx];
    if (String(summary?.currency || 'ETH').toUpperCase() === 'FLIP') return false;
    const positive = (value) => {
      try { return BigInt(value || '0') > 0n; }
      catch { return false; }
    };
    const hasEth = wins.some((win) => {
      const type = String(win.awardType || '').toLowerCase();
      if (type === 'aggregated' || win.isSolo) return positive(win.ethTotal);
      return (type === 'eth' || String(win.currency || '').toUpperCase() === 'ETH')
        && positive(win.amount ?? win.ethTotal);
    });
    return hasEth && (
      Number(summary?.winnerCount) === 1
      || wins.some((win) => win.isSolo)
    );
  }

  // --- Scattered win badges ---

  #activateBadgeReward(wrap) {
    if (!wrap || wrap.dataset.rewardShown === 'true') return;
    const reward = wrap.querySelector?.('.replay-badge-reward-pop');
    if (!reward) return;
    wrap.dataset.rewardShown = 'true';
    // Several fresh wins may reveal together. Let their arcade callouts
    // coexist briefly; descending layers keep the first one in front without
    // forcing later rewards to wait or erase it.
    const sequence = this.#rewardPopSequence++;
    const stack = Math.max(1, 20 - sequence);
    // Quadrants need ordering against one another, but their paper must stay
    // beneath the center seal at z20. Badge callouts retain the full stack.
    const quadrantStack = Math.max(1, stack - 2);
    wrap.style.setProperty('--replay-reward-stack', String(stack));
    const quad = wrap.parentElement;
    if (quad) {
      const currentQuadStack = Number.parseInt(
        quad.style.getPropertyValue('--replay-quadrant-reward-stack'),
        10,
      ) || 0;
      quad.style.setProperty(
        '--replay-quadrant-reward-stack',
        String(Math.max(currentQuadStack, quadrantStack)),
      );
      quad.classList.add('q-reward-pop-active');
    }
    try {
      const quadRect = quad?.getBoundingClientRect?.();
      const badgeRect = wrap.getBoundingClientRect?.();
      const popupRect = reward.getBoundingClientRect?.();
      const direction = winningBadgeRewardDirection({
        badge: {
          left: badgeRect.left - quadRect.left,
          top: badgeRect.top - quadRect.top,
          width: badgeRect.width,
          height: badgeRect.height,
        },
        popup: { width: popupRect.width, height: popupRect.height },
        container: { width: quadRect.width, height: quadRect.height },
        randomValue: this.#rewardDirectionPhase,
        sequence,
      });
      wrap.dataset.rewardDirection = direction;
    } catch (_e) {
      // Headless/legacy DOM fallback still varies concurrent rewards instead
      // of collapsing them back into the old always-above position.
      wrap.dataset.rewardDirection = ['above', 'right', 'below', 'left'][sequence % 4];
    }
    wrap.classList.add('is-reward-pop');
    this.#syncWinReceiptVisibility();
  }

  #placeWinBadges(qIdx, traitId) {
    const quads = this.querySelectorAll('.replay-tq');
    const quad = quads[qIdx];
    const wins = this.#quadWinArrays[qIdx];
    if (!wins || wins.length === 0) return;

    // Separate overflow sentinel (awardType='overflow') from real badge entries
    const realWins = wins.filter(w => w.awardType !== 'overflow');
    if (realWins.length === 0) return;

    // Default badge for this quadrant (used for wins without traitId)
    const defaultBadge = traitToBadge(traitId);
    const defaultPath = defaultBadge ? defaultBadge.path : '';
    const allBounds = [];
    // Solo-bucket entry (ETH + whale_pass + dgnrs merged) is the main draw's
    // marquee prize, so its badge fills nearly the entire winning quadrant.
    const soloIdx = !this.#bonusPhase && this.#isSoloEthWinner(qIdx)
      ? Math.max(0, realWins.findIndex((win) => win.isSolo))
      : -1;
    const soloSize = soloIdx < 0 ? 0 : 92;
    // Pack badges into stable cells inside the art band, then apply bounded
    // deterministic scatter. That preserves every result while keeping large
    // winning reveals loose and celebratory instead of grid-like.
    const layout = winningBadgeLayout({
      count: realWins.length,
      quadrant: qIdx,
      soloIndex: soloIdx,
      soloSize,
    });
    for (let w = 0; w < realWins.length; w++) {
      const position = layout[w];
      if (!position) continue;
      const isSoloBadge = w === soloIdx;
      const sizePct = isSoloBadge ? soloSize : position.size;
      const growth = (sizePct - position.size) / 2;
      const bestLeft = isSoloBadge
        ? Math.max(0, Math.min(100 - sizePct, position.left - growth))
        : position.left;
      const bestTop = isSoloBadge
        ? Math.max(0, Math.min(100 - sizePct, position.top - growth))
        : position.top;
      allBounds.push({ left: bestLeft, top: bestTop, right: bestLeft + sizePct, bottom: bestTop + sizePct });

      // Use each win's own traitId for its badge; fall back to quadrant default
      const winBadge = realWins[w].traitId != null ? traitToBadge(realWins[w].traitId) : defaultBadge;
      const winPath = winBadge ? winBadge.path : defaultPath;

      const wrap = document.createElement('div');
      wrap.className = isSoloBadge
        ? 'replay-badge-wrap replay-badge-wrap--solo'
        : 'replay-badge-wrap';
      wrap.tabIndex = -1;
      wrap.style.width = sizePct + '%';
      wrap.style.left = bestLeft + '%';
      wrap.style.top = bestTop + '%';
      wrap.style.setProperty('--replay-badge-rotation', `${position.rotation || 0}deg`);
      wrap.style.setProperty('--replay-badge-layer', String(isSoloBadge ? 0 : (position.layer || 1)));
      const img = document.createElement('img');
      img.src = winPath; img.className = 'replay-scattered-badge'; img.alt = '';
      wrap.appendChild(img);
      const rewardLines = winningBadgeRewardLines(realWins[w]);
      if (rewardLines.length > 0) {
        wrap.setAttribute('role', 'img');
        wrap.setAttribute('aria-label', `Winning badge: ${rewardLines.map((line) => line.aria).join(', ')}`);
        const reward = document.createElement('span');
        reward.className = 'replay-badge-reward-pop';
        reward.setAttribute('aria-hidden', 'true');
        for (const line of rewardLines) {
          const row = document.createElement('span');
          row.className = `replay-badge-reward-pop__row replay-badge-reward-pop__row--${line.kind}`;
          if (line.kind === 'tickets') {
            row.appendChild(createJackpotTicketIcon('replay-badge-reward-pop__ticket'));
          } else {
            const icon = document.createElement('img');
            icon.className = 'replay-badge-reward-pop__icon';
            icon.src = line.kind === 'flip'
              ? '/whitepaper/flame-logo-split.svg'
              : '/symbols/crypto_06_ethereum_silver.svg';
            icon.alt = '';
            row.appendChild(icon);
          }
          const amount = document.createElement('b');
          amount.textContent = line.amount;
          row.appendChild(amount);
          reward.appendChild(row);
        }
        wrap.appendChild(reward);
        const showReward = () => this.#activateBadgeReward(wrap);
        wrap.addEventListener('mouseenter', showReward, { once: true });
        wrap.addEventListener('focus', showReward, { once: true });
        reward.addEventListener('animationend', () => {
          wrap.classList.remove('is-reward-pop');
          if (!quad.querySelector('.replay-badge-wrap.is-reward-pop')) {
            quad.classList.remove('q-reward-pop-active');
            quad.style.removeProperty('--replay-quadrant-reward-stack');
          }
          this.#syncWinReceiptVisibility();
        }, { once: true });
      }
      quad.appendChild(wrap);
    }

    // Overflow "+N more" label is deferred until the quadrant is fully
    // scratched — appended inside #revealQuadrant.

    // Store badge hit circles for green-reveal detection during scratch
    const circles = [];
    for (const bb of allBounds) {
      circles.push({ cx: (bb.left + bb.right) / 2, cy: (bb.top + bb.bottom) / 2, r: (bb.right - bb.left) / 2 });
    }
    this.#quadBadgeBounds[qIdx] = circles;
  }

  #clearScatteredBadges() {
    this.#rewardPopSequence = 0;
    this.#rewardDirectionPhase = Math.random();
    const els = this.querySelectorAll('.replay-badge-wrap, .replay-badge-overflow-label');
    for (const el of els) el.remove();
    const activeQuads = this.querySelectorAll('.replay-tq.q-reward-pop-active');
    for (const quad of activeQuads) {
      quad.classList.remove('q-reward-pop-active');
      quad.style.removeProperty('--replay-quadrant-reward-stack');
    }
  }

  #resetCards() {
    this.#animId++; // cancel any running spin
    this.#skipSpinId = null;
    this.#spinning = false;
    this.#stopIdleSpin();
    this.#sfxScratchStop();
    const quads = this.querySelectorAll('.replay-tq');
    quads.forEach(q => {
      q.classList.remove(
        'revealed', 'q-has-trait', 'q-no-tickets', 'q-traits-pending', 'q-scratchable',
        'q-has-tickets', 'q-public-result', 'q-win-impossible', 'q-win-impossible-lock',
        'q-owned-miss', 'q-player-win', 'q-solo-eth-win', 'q-gold-trait', 'q-scratch-underlay',
        'q-result-pending', 'q-result-revealed',
      );
      const img = q.querySelector('.badge-img');
      if (img) { img.src = ''; img.alt = ''; img.style.opacity = '0'; img.style.display = ''; img.removeAttribute('width'); img.removeAttribute('height'); }
      const canvas = q.querySelector('.replay-scratch-canvas');
      if (canvas) { canvas.style.opacity = '0'; canvas.style.pointerEvents = 'none'; }
      const prize = q.querySelector('.replay-prize-reveal');
      if (prize) {
        prize.classList.remove(
          'visible',
          'replay-bucket-reveal',
          'replay-player-win-reveal',
          ...BUCKET_REVEAL_POSITION_CLASSES,
          ...BUCKET_REVEAL_VARIANT_CLASSES,
        );
        prize.innerHTML = '';
        prize.removeAttribute('aria-label');
      }
    });
    this.#clearScatteredBadges();
    this.querySelector('[data-bind="card-grid"]')
      ?.classList.remove('replay-ticket--has-owned-gold');

    // Reset center diamond
    this.#hideCenterScratch();

    this.#scratched = [false, false, false, false];
    this.#scratchGrids = [null, null, null, null];
    this.#greenRevealed = [false, false, false, false];
    this.#badgesRevealed = [[], [], [], []];
    this.#quadBadgeBounds = [null, null, null, null];
    this.#quadOwned = [false, false, false, false];
    this.#quadWinArrays = [[], [], [], []];
    this.#quadPublicSummaries = [null, null, null, null];
    this.#centerWins = [];
    this.#centerScratched = false;
    this.#centerScratchGrid = null;

    // Reset per-player roll win caches
    this.#playerRoll1Wins = [];
    this.#playerRoll2Wins = [];

    // Reset bonus roll state
    this.#bonusPhase = false;
    this.#mainScratchComplete = false;
    this.#mainPotentialScratchComplete = false;
    this.#bonusScratchComplete = false;
    this.#mainSpinComplete = false;
    this.#bonusSpinComplete = false;
    this.#coinflipHandoffStarting = false;
    this.#drawViewSwitching = false;
    this.#bonusTraitIds = new Set();
    this.#bonusQuadrants = new Set();
    this.#syncDrawToggleAffordance();
    // Single-button mode hides/relabels the main button as the spins play out;
    // a new day (or a re-spin) puts it back to the main action.
    this.#btnMode = 'reveal';
    const revealBtn = this.querySelector('[data-bind="reveal-btn"]');
    if (revealBtn) {
      revealBtn.hidden = false;
      revealBtn.classList?.remove('is-bonus', 'is-coinflip', 'is-spinning');
      revealBtn.removeAttribute?.('aria-busy');
      revealBtn.textContent = MAIN_SPIN_LABEL;
    }
    const bonusSection = this.querySelector('[data-bind="bonus-section"]');
    if (bonusSection) bonusSection.hidden = true;
    const bonusBtn = this.querySelector('[data-bind="bonus-btn"]');
    if (bonusBtn) {
      bonusBtn.disabled = true;
      bonusBtn.hidden = false;
      bonusBtn.textContent = BONUS_SPIN_LOCKED_LABEL;
      bonusBtn.title = 'Scratch blue and gold panels first';
    }
  }

  #celebrate({ sound = true } = {}) {
    if (sound) this.#sfxFanfare();
    celebrateProtocol({
      target: this.querySelector('[data-bind="card-grid"]') || this,
      tone: 'jackpot',
      big: true,
    });
  }

  // --- Web Audio SFX: short, dry crypto-slot cues ---

  #getAudio() {
    if (!this.#audioCtx) this.#audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.#audioCtx.state === 'suspended') this.#audioCtx.resume();
    return this.#audioCtx;
  }

  #sfxOutput(ctx) {
    if (this.#sfxBus) return this.#sfxBus;
    if (typeof ctx.createDynamicsCompressor !== 'function') return ctx.destination;
    const bus = ctx.createDynamicsCompressor();
    bus.threshold.value = -10;
    bus.knee.value = 3;
    bus.ratio.value = 6;
    bus.attack.value = 0.002;
    bus.release.value = 0.055;
    bus.connect(ctx.destination);
    this.#sfxBus = bus;
    return bus;
  }

  #slotTone({
    frequency,
    endFrequency = frequency,
    type = 'square',
    gain: level = 0.1,
    delay = 0,
    duration = 0.05,
  }) {
    if (isSfxMuted()) return;
    const ctx = this.#getAudio();
    const start = ctx.currentTime + Math.max(0, delay);
    const stop = start + Math.max(0.012, duration);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, frequency), start);
    if (endFrequency !== frequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), stop);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(Math.max(0.001, level), start + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);
    osc.connect(gain);
    gain.connect(this.#sfxOutput(ctx));
    osc.start(start);
    osc.stop(stop + 0.008);
  }

  #slotNoise({
    center = 2200,
    type = 'bandpass',
    q = 0.7,
    gain: level = 0.06,
    delay = 0,
    duration = 0.025,
  } = {}) {
    if (isSfxMuted()) return;
    const ctx = this.#getAudio();
    if (typeof ctx.createBuffer !== 'function'
      || typeof ctx.createBufferSource !== 'function'
      || typeof ctx.createBiquadFilter !== 'function') return;
    const seconds = Math.max(0.012, duration);
    const samples = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = (Math.random() * 2) - 1;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const start = ctx.currentTime + Math.max(0, delay);
    source.buffer = buffer;
    filter.type = type;
    filter.frequency.setValueAtTime(center, start);
    filter.Q.setValueAtTime(q, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(Math.max(0.001, level), start + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.#sfxOutput(ctx));
    source.start(start);
    source.stop(start + seconds + 0.005);
  }

  #sfxSpinFrame(winnableCount, goldWinnable, lockCount) {
    const count = Math.max(0, Math.min(4, Math.trunc(Number(winnableCount) || 0)));
    const progress = Math.max(0, Math.min(8, Math.trunc(Number(lockCount) || 0)));
    // A dry musical pulse on EVERY painted frame. The chord walks upward as
    // more blue faces appear, while lock progress cycles a four-step arp so the
    // reel has actual motion instead of isolated mechanical clicks.
    const reelPitches = [330, 392, 494, 587, 740];
    const reelGains = [0.105, 0.135, 0.17, 0.215, 0.265];
    const arpRatios = [1, 1.125, 1.25, 1.5];
    const root = goldWinnable
      ? 988 * arpRatios[progress % arpRatios.length]
      : reelPitches[count] * arpRatios[progress % arpRatios.length];
    this.#slotTone({
      frequency: root,
      type: 'triangle',
      gain: goldWinnable ? 0.3 : reelGains[count],
      duration: 0.072,
    });
    this.#slotTone({
      frequency: root * 2,
      type: 'sine',
      gain: goldWinnable ? 0.115 : 0.035 + (count * 0.012),
      delay: 0.012,
      duration: 0.058,
    });
  }

  #sfxLock({ winnable = false, gold = false } = {}) {
    if (gold) {
      [1047, 1319, 1568, 2093].forEach((frequency, index) => {
        this.#slotTone({
          frequency,
          type: 'triangle',
          gain: 0.25 - (index * 0.025),
          delay: index * 0.035,
          duration: 0.13,
        });
      });
    } else if (winnable) {
      this.#slotTone({
        frequency: 659, type: 'triangle', gain: 0.245, duration: 0.13,
      });
      this.#slotTone({
        frequency: 988, type: 'sine', gain: 0.15, delay: 0.035, duration: 0.15,
      });
    } else {
      this.#slotTone({
        frequency: 247, endFrequency: 196, type: 'triangle', gain: 0.16, duration: 0.085,
      });
    }
  }

  #sfxAllLocked(anyOwned) {
    // Delay the final confirmation until the eighth lock cue has cleared.
    this.#slotTone({
      frequency: anyOwned ? 1047 : 262,
      type: 'triangle',
      gain: anyOwned ? 0.235 : 0.14,
      delay: 0.2,
      duration: anyOwned ? 0.16 : 0.1,
    });
    if (anyOwned) this.#slotTone({
      frequency: 1568,
      type: 'sine',
      gain: 0.13,
      delay: 0.245,
      duration: 0.18,
    });
  }

  #sfxScratchStart() {
    if (this.#scratchNode || isSfxMuted()) return;
    const ctx = this.#getAudio();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    noise.buffer = buf; noise.loop = true;
    filter.type = 'bandpass'; filter.frequency.value = 3000; filter.Q.value = 0.5;
    noise.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    gain.gain.value = 0.05;
    noise.start();
    this.#scratchNode = { noise, gain };
  }

  #sfxScratchStop() {
    if (!this.#scratchNode) return;
    try { this.#scratchNode.noise.stop(); } catch {}
    this.#scratchNode = null;
  }

  #sfxGreenReveal() {
    // A crisp arcade-coin sparkle for EACH paid badge. A 14ms high-frequency
    // attack gives it definition over the scratch bed; short triangle/square
    // voices keep it bright without the rounded pitch glide that read as a
    // water droplet.
    this.#slotNoise({ center: 5800, type: 'highpass', q: 0.55, gain: 0.07, duration: 0.014 });
    this.#slotTone({
      frequency: 1568, type: 'triangle', gain: 0.22, duration: 0.075,
    });
    this.#slotTone({
      frequency: 2349, type: 'square', gain: 0.085,
      delay: 0.018, duration: 0.06,
    });
    this.#slotTone({
      frequency: 3136, type: 'sine', gain: 0.075,
      delay: 0.04, duration: 0.12,
    });
  }

  #sfxPinkReveal() {
    // A restrained paper-puff + soft falling pair for a blue/gold cover that
    // resolves pink. It acknowledges the near-miss without sounding like a
    // jackpot loss stinger or competing with paid-badge dings.
    this.#slotNoise({
      center: 1650, type: 'bandpass', q: 0.65, gain: 0.025, duration: 0.018,
    });
    this.#slotTone({
      frequency: 523, endFrequency: 392,
      type: 'triangle', gain: 0.07, duration: 0.12,
    });
    this.#slotTone({
      frequency: 330, endFrequency: 294,
      type: 'sine', gain: 0.035, delay: 0.045, duration: 0.13,
    });
  }

  #sfxReveal(isWin) {
    if (isWin) {
      this.#slotTone({
        frequency: 784, type: 'triangle', gain: 0.17, duration: 0.09,
      });
      this.#slotTone({
        frequency: 1175, type: 'sine', gain: 0.1, delay: 0.025, duration: 0.12,
      });
    } else {
      this.#slotTone({
        frequency: 170, endFrequency: 72, type: 'triangle', gain: 0.145, duration: 0.09,
      });
    }
  }

  #sfxSoloEthReveal() {
    // A solo bucket is the main draw's rare one-wallet ETH hit. Give it a
    // two-stage vault-open cue: a low rising foundation, then a crystalline
    // C-major coin burst. It replaces both the ordinary two-note reveal and
    // the end-of-roll fanfare so the identity stays unmistakable.
    this.#slotNoise({
      center: 6400, type: 'highpass', q: 0.5, gain: 0.085, duration: 0.022,
    });
    this.#slotTone({
      frequency: 130.81, endFrequency: 261.63,
      type: 'sawtooth', gain: 0.075, duration: 0.56,
    });
    this.#slotTone({
      frequency: 261.63, endFrequency: 523.25,
      type: 'triangle', gain: 0.15, delay: 0.025, duration: 0.5,
    });
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      this.#slotTone({
        frequency,
        type: 'triangle',
        gain: 0.245 - (index * 0.022),
        delay: 0.075 + (index * 0.075),
        duration: 0.34,
      });
    });
    [1568, 2093, 3136].forEach((frequency, index) => {
      this.#slotTone({
        frequency,
        type: 'sine',
        gain: 0.105 - (index * 0.018),
        delay: 0.24 + (index * 0.06),
        duration: 0.42,
      });
    });
  }

  #sfxFanfare() {
    // Bright C-major cabinet win: no low drone and no descending sample, so it
    // resolves celebratory rather than ominous. The octave sparkle supplies a
    // crypto/arcade edge without turning into a long coin-shower loop.
    [1047, 1319, 1568, 2093].forEach((frequency, index) => {
      this.#slotTone({
        frequency,
        type: 'triangle',
        gain: 0.255 - (index * 0.025),
        delay: index * 0.07,
        duration: 0.24,
      });
    });
    [2093, 2637, 3136].forEach((frequency, index) => this.#slotTone({
      frequency,
      type: 'sine',
      gain: 0.11 - (index * 0.015),
      delay: 0.19 + (index * 0.055),
      duration: 0.28,
    }));
  }
}

customElements.define('replay-panel', ReplayPanel);
