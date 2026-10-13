// Inner frame of the /learn/craps/ demo: the app's real <app-craps-table> replaying a REAL recorded
// scheduled battle. No wallet, no RPC, no API: the battle is a pinned JSON file under data/ and the
// app's own replay path (`prepareCrapsReplayTable`, the same loader + model the app uses) reads it
// through an in-memory fetch.
//
// Provenance (also in the JSON's `meta`): run 70, Base Sepolia (chain 84532), CrapsBattle
// 0xcd5525fda8d24305e47d1c768980b74bbecfc0a9, scheduled window battle slot 42 (day 5, period 1),
// battle key 0x...2a, 11 entrants (all day-lane seats), 142 shared rolls over 15 shooters, finalized at
// block 47907016. Exported from the run-70 indexer database through the app's own replay producer; every
// seat's replayed `won` matched its on-chain CrapsBetSettled amount.

import { prepareCrapsReplayTable } from '/app/craps/replay-adapter.js';
import { simAvatarUrl } from '/app/app/sim-avatar.js';
import { warmup, stopDgnPops } from '/app/app/jackpot-sfx.js';
import '/app/components/app-craps-table.js';

const DATA_URL = '/learn/demos/data/craps-battle-run70-0x2a.json';
// The seat the table follows: day seat 2, the first of four seats to reach the 3,000 goal (roll 102),
// leading the field at that moment. The app pauses the replay with its own cash-out screen when the
// followed seat reaches its goal; the demo then settles the rest of the recorded battle instantly and shows
// the app's finished-battle card (final rank, payout, winner), the way a player sees a settled battle.
const VIEWER_BET_ID = '737869762948382064642';
const PACE = 3;

const host = document.querySelector('app-craps-table');
const SELECT = Object.freeze({
  speed: '[data-bind="craps-resolution-speed"]',
  auto: '[data-bind="craps-resolution-auto"]',
  roll: '[data-bind="craps-resolution-roll"]',
  card: '[data-bind="craps-card"]',
});

let state = 'loading';
let tableOptions = null;
let facts = null;
let rollCount = 0;
let settling = false;

function tell(message) {
  try { window.parent?.postMessage({ source: 'craps-demo', ...message }, location.origin); }
  catch (_error) { /* standalone */ }
}

function setState(next) {
  state = next;
  tell({ type: 'state', state, facts, rolls: rollCount });
}

async function load() {
  const pin = await (await fetch(DATA_URL)).json();
  const meta = pin.meta;
  // The app's replay path asks for its artifacts by path; answer from the pinned file.
  const fetchImpl = async (path) => (path in pin.files
    ? { ok: true, status: 200, json: async () => pin.files[path] }
    : { ok: false, status: 404 });
  const prepared = await prepareCrapsReplayTable({
    battleKey: meta.battleKey,
    viewerBetId: VIEWER_BET_ID,
    chainId: meta.chainId,
    contract: meta.contract,
    fetchImpl,
    runtimeCodeHashes: [meta.runtimeCodeHash],
    // Identity lookups and the settlement-word read are network calls in the app; the demo has neither.
    // The settled facts the app passes for a finalized battle (from the chain's payout events, pinned
    // in the JSON's meta): the winner, the winner's battle prize and the hottest-shooter award.
    battleWinner: meta.payouts.battle.player,
    battleWinnerBetId: meta.payouts.battle.betId,
    battlePayoutWei: String(BigInt(meta.payouts.battle.amount) * 10n ** 18n),
    battleWinningStop: meta.winning.stop === 'goal' ? 1 : 0,
    hottestShooterAward: {
      betId: meta.payouts.hottest.betId,
      winner: meta.payouts.hottest.player,
      rolls: meta.payouts.hottest.shooterRolls,
      amountWei: String(BigInt(meta.payouts.hottest.amount) * 10n ** 18n),
      passValueWei: '0',
    },
    // The app's normal name/avatar path, fed from the pinned cast: 11 names drawn once at random from the
    // simulator's invented testnet identities (see meta.castSource), each with the app's own generated
    // sim avatar, except the followed seat: the creator persona with the Degenerus flame as its avatar.
    loadProfiles: async () => new Map(meta.cast.map((member) => [
      member.address.toLowerCase(),
      { name: member.name, avatar: member.avatarUrl ?? simAvatarUrl(member.address.toLowerCase(), member.sim, member.name) },
    ])),
    loadSettlementWord: async () => { throw new Error('offline'); },
  });
  if (!prepared.ready) throw new Error('replay not ready');
  let opened = null;
  prepared.open({ open(options) { opened = options; } });
  const seats = prepared.mainModel.viewport.seats;
  // Where the followed seat's run ends is the last roll it plays; count the field as of that roll.
  const exitRoll = opened.viewerResult.exitRoll;
  const exitOf = (seat) => (seat.events.at(-1)?.globalRoll ?? -1) + 1;
  const settled = seats.filter((seat) => exitOf(seat) <= exitRoll);
  facts = {
    players: seats.length,
    seat: opened.viewerLabel,
    stop: opened.viewerResult.stop,
    // Final, settled figures: the chain's ranking order, the viewer's run payout, the winner and its prize.
    rank: opened.finalRankOrder.indexOf(String(opened.viewerBetId)) + 1 || null,
    payout: String(BigInt(opened.viewerResult.runPayoutWei) / 10n ** 18n),
    winner: meta.cast.find((member) => member.betId === String(meta.payouts.battle.betId))?.name ?? null,
    winnerPrize: meta.payouts.battle.amount,
    goals: settled.filter((seat) => seat.player.stop === 'goal').length,
    busts: settled.filter((seat) => seat.player.stop === 'bust').length,
    rolls: exitRoll,
    battleRolls: opened.resolutionHands.length,
    handLengths: opened.resolutionHands.reduce((lengths, frame) => { lengths[frame.shooter] = (lengths[frame.shooter] ?? 0) + 1; return lengths; }, []),
  };
  return Object.freeze({
    ...opened,
    // Wait for the reader's button: the table deals, then idles until a roll is requested.
    autoRoll: false,
    onResolutionAcknowledged: undefined,
  });
}

function prepare() {
  rollCount = 0;
  settling = false;
  setState('loading');
  host.open(tableOptions);
  // The table idles on its ROLL control once the first board is dealt.
  const poll = setInterval(() => {
    const roll = host.querySelector(SELECT.roll);
    if (roll && !roll.hidden && !roll.disabled) {
      clearInterval(poll);
      setState('ready');
    }
  }, 60);
  setTimeout(() => clearInterval(poll), 8000);
}

function setSpeed(value) {
  const range = host.querySelector(SELECT.speed);
  if (!range) return;
  range.value = String(value);
  // `input` only: `change` would persist the pace into the app's saved preferences.
  range.dispatchEvent(new Event('input', { bubbles: true }));
}

function engage() {
  setSpeed(PACE);
  const roll = host.querySelector(SELECT.roll);
  // Leaving the manual pace turns auto on; a saved non-manual pace needs the AUTO control.
  if (roll && !roll.hidden) host.querySelector(SELECT.auto)?.click();
  setState('playing');
}

function start() {
  if (state === 'ready') { engage(); return; }
  if (state === 'done') {
    prepare();
    const wait = setInterval(() => {
      if (state === 'ready') { clearInterval(wait); engage(); }
    }, 60);
    setTimeout(() => clearInterval(wait), 8000);
  }
}

function setSound(on) {
  window.__crapsDemoSound = Boolean(on);
  if (on) warmup(); else stopDgnPops();
}

window.crapsDemo = Object.freeze({ start, setSound, getState: () => state });

// Report the card height so the shell can crop the frame to the table at any width.
const card = host.querySelector(SELECT.card);
if (card && typeof ResizeObserver === 'function') {
  new ResizeObserver(() => tell({ type: 'height', height: card.offsetHeight })).observe(card);
}

// Progress: the dice bay names the shooter of the roll just settled and the HUD counts that shooter's
// rolls, so the battle's roll number is the earlier shooters' rolls plus the current count.
const bay = host.querySelector('[data-bind="craps-dice-bay"]');
const counter = host.querySelector('[data-bind="craps-shooter-roll-count"]');
setInterval(() => {
  if (state !== 'playing' || !facts || !bay || !counter) return;
  // The table stops on its own cash-out screen when the followed seat reaches its goal.
  if (bay.dataset.state === 'bust-paused' && !settling) {
    settling = true;
    rollCount = facts.rolls;
    tell({ type: 'progress', rolls: rollCount, total: facts.rolls });
    // OBSERVE hands control back to the replay and SKIP settles the remaining rolls at once, which is
    // what raises the app's finished-battle card instead of the live cash-out one.
    host.querySelector('[data-bind="craps-race-observe"]')?.click();
    host.querySelector('[data-bind="craps-resolution-skip"]')?.click();
    setTimeout(() => setState('done'), 400);
    return;
  }
  const shooter = Number(/^Shooter (\d+) rolled /.exec(bay.getAttribute('aria-label') ?? '')?.[1]);
  const inHand = Number(/(\d+) ROLL/.exec(counter.textContent ?? '')?.[1]);
  if (!shooter || !Number.isFinite(inHand)) return;
  const before = facts.handLengths.slice(0, shooter - 1).reduce((total, length) => total + length, 0);
  const next = Math.min(facts.rolls, before + Math.min(inHand, facts.handLengths[shooter - 1] ?? inHand));
  if (next > rollCount) {
    rollCount = next;
    tell({ type: 'progress', rolls: rollCount, total: facts.rolls });
  }
}, 150);

try {
  tableOptions = await load();
  prepare();
} catch (error) {
  console.error('craps demo', error);
  setState('error');
}
