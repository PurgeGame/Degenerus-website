// /app/app/__tests__/pack-watch.test.js — deferred ticket reveals.
//
// Run: cd website && node --test app/app/__tests__/pack-watch.test.js
//
// The rule being guarded: a ticket has no symbols until the level draw rolls
// them, so the buy records the purchase and the reveal waits. The dangerous
// failure mode is the opposite of a missing popup — revealing a player's whole
// back catalogue the first time the watcher runs — so the seeding behaviour gets
// the most coverage here.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../chain-config.js';

const ADDR = '0xAb12000000000000000000000000000000000000';
const LEVEL = 12;

// ---------------------------------------------------------------------------
// Globals the module needs at import time (localStorage, fetch, DOM shims for
// the reveal-overlay import chain).
// ---------------------------------------------------------------------------

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.customElements = globalThis.customElements || {
  _r: new Map(), define(n, c) { this._r.set(n, c); }, get(n) { return this._r.get(n); },
};
globalThis.HTMLElement = globalThis.HTMLElement || class {};
globalThis.document = globalThis.document || {
  createElement: () => ({ appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {} }),
  addEventListener() {}, removeEventListener() {}, querySelector: () => null,
};

let _routes = {};
globalThis.fetch = async (url) => {
  const u = String(url);
  for (const [frag, handler] of Object.entries(_routes)) {
    if (u.includes(frag)) {
      const body = typeof handler === 'function' ? handler(u) : handler;
      if (body === undefined) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    }
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const packWatch = await import('../pack-watch.js');
const pendingActions = await import('../pending-actions.js');
const overlay = await import('../../components/reveal-overlay.js');
const store = await import('../store.js');

// queueReveal buffers whenever no <reveal-overlay> is mounted, and
// __takeQueuedForTest drains that buffer — so the assertion surface is what the
// watcher queued, with no DOM in the way.
function takeQueued() {
  return overlay.__takeQueuedForTest();
}

/** One by-trait card. `rolled` decides whether its four entries have traits. */
function card(cardIndex, rolled) {
  return {
    cardIndex,
    status: rolled ? 'opened' : 'pending',
    entries: [0, 1, 2, 3].map((i) => ({
      entryId: cardIndex * 4 + i,
      // One trait per quadrant, matching the contract's [QQ][CCC][SSS] byte.
      traitId: rolled ? i * 64 + ((cardIndex * 4 + i) % 64) : null,
      traitLabel: rolled ? 'x' : null,
    })),
    source: 'purchase',
    purchaseBlock: '1',
  };
}

function byTrait(cards) {
  return { address: ADDR.toLowerCase(), level: LEVEL, day: null, totalEntries: cards.length * 4, cards };
}

function partialCard(cardIndex, entryCount = 1) {
  return {
    cardIndex,
    status: 'pending',
    entries: Array.from({ length: entryCount }, (_unused, i) => ({
      entryId: cardIndex * 4 + i,
      traitId: null,
      traitLabel: null,
    })),
    source: 'jackpot',
    purchaseBlock: '2',
  };
}

describe('pack-watch — deferred ticket reveals', () => {
  beforeEach(() => {
    localStorage.clear();
    _routes = {
      '/game/state': { level: LEVEL, jackpotPhaseFlag: true },
    };
    overlay.__resetForTest();
    pendingActions.__resetPendingActionsForTest();
    store.__resetForTest();
  });

  afterEach(() => {
    packWatch.stopPackWatch();
    packWatch.__setClockForTest(null);
    packWatch.__setEntriesOwedReaderForTest(null);
  });

  test('recording seeds already-rolled cards so old tickets never re-reveal', async () => {
    // Two tickets already rolled before this buy, plus the two just bought.
    _routes['/tickets/by-trait'] = byTrait([card(0, true), card(1, true), card(2, false), card(3, false)]);
    const ok = await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });
    assert.equal(ok, true);
    assert.equal(packWatch.pendingPacks().length, 1);

    // Nothing new has rolled yet → no reveal.
    const n = await packWatch.checkPendingPacks({ address: ADDR });
    assert.equal(n, 0, 'the pre-existing rolled tickets are seeded, not revealed');
  });

  test('chain-only pending packs from an earlier deploy are discarded', () => {
    const legacyKey = `pack_pending_${CHAIN.id}`;
    localStorage.setItem(legacyKey, JSON.stringify([{
      address: ADDR.toLowerCase(),
      level: 1,
      expectedTickets: 1,
      at: Date.now(),
    }]));

    assert.deepEqual(packWatch.pendingPacks(), []);
    assert.equal(localStorage.getItem(legacyKey), null,
      'an old Level 1 record cannot leak into the current GAME');
  });

  test('a fast-indexed purchase keeps its newest rolled ticket revealable', async () => {
    _routes['/tickets/by-trait'] = byTrait([card(0, true), card(1, true)]);
    await packWatch.recordPendingPack({
      address: ADDR,
      level: LEVEL,
      expectedTickets: 1,
      sourceKey: 'purchase:fast-indexed',
    });

    assert.equal(await packWatch.checkPendingPacks({ address: ADDR }), 1);
    const [seq] = takeQueued();
    assert.deepEqual(seq.tickets.map((ticket) => ticket.cardIndex), [1],
      'old card is seeded while the newest receipt-backed card remains fresh');
  });

  test('reveals only the newly rolled tickets, with their real trait ids', async () => {
    _routes['/tickets/by-trait'] = byTrait([card(0, true), card(1, false)]);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });

    // The draw lands: card 1 now carries traits.
    _routes['/tickets/by-trait'] = byTrait([card(0, true), card(1, true)]);
    const n = await packWatch.checkPendingPacks({ address: ADDR });
    const seqs = takeQueued();

    assert.equal(n, 1, 'one sequence queued');
    const seq = seqs[0];
    assert.equal(seq.kind, 'pack');
    assert.equal(seq.level, LEVEL);
    assert.equal(seq.tickets.length, 1, 'only the new ticket');
    assert.deepEqual(seq.tickets[0].traitIds, card(1, true).entries.map((e) => e.traitId));
    assert.equal(seq.count, 1);
  });

  test('shared widget moves a bought pack from waiting to ready, then opens its real reveal', async () => {
    _routes['/tickets/by-trait'] = byTrait([card(0, false)]);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL, expectedTickets: 1 });
    let [item] = pendingActions.getPendingActions();
    assert.equal(item.id, 'ticket-packs:pending');
    assert.equal(item.state, 'waiting');
    assert.equal(item.label, '1 TICKET PENDING');
    assert.equal(item.shortLabel, 'Pack pending');
    assert.equal(item.passive, true);
    assert.equal(item.compact, true);
    assert.deepEqual(item.pendingPacks, [{
      level: LEVEL, count: 1, foilPack: false, packIndex: 1, packCount: 1,
    }]);
    assert.doesNotMatch(item.detail, /foil/i,
      'an ordinary pack never inherits foil indexing copy');
    assert.equal(item.run, null, 'an unresolved pack never doubles as a protocol crank button');

    _routes['/tickets/by-trait'] = byTrait([card(0, true)]);
    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((r) => setTimeout(r, 10));
    [item] = pendingActions.getPendingActions();
    assert.equal(item.state, 'ready');
    assert.equal(typeof item.run, 'function');
    assert.match(item.detail, /1 ticket ready/);

    await item.run();
    const [seq] = takeQueued();
    assert.equal(seq.kind, 'pack');
    assert.equal(seq.level, LEVEL);
    assert.equal(seq.tickets.length, 1);
    assert.equal(pendingActions.getPendingActions()[0]?.state, 'busy',
      'queued presentation stays tracked until the player actually opens it');

    await packWatch.completePackReveal(seq.packRelease);
    packWatch.refreshPackWatch();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(pendingActions.getPendingActions().length, 0,
      'collecting the pack retires it from the widget');
  });

  // ------------------------------------------------------------------
  // Request cost. A pending record is durable for months, so what the
  // watcher asks for every 45s is the app's largest source of API load.
  // ------------------------------------------------------------------

  /** Route that records the level of every /tickets/by-trait read. */
  function countingByTrait(seen, cards = []) {
    return (url) => {
      const match = /level=(\d+)/.exec(String(url));
      seen.push(Number(match?.[1]));
      return byTrait(cards);
    };
  }

  test('a far-future pack record is not polled until the sweep reaches its level', async () => {
    // level 12 + the six-key window: nothing past level 17 can have rolled.
    const farLevel = LEVEL + 40;
    const seen = [];
    _routes['/tickets/by-trait'] = countingByTrait(seen);
    await packWatch.recordPendingPack({ address: ADDR, level: farLevel, expectedTickets: 4 });
    seen.length = 0;   // the seed read at purchase time is not the poll cost

    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((r) => setTimeout(r, 10));
    packWatch.refreshPackWatch();
    await new Promise((r) => setTimeout(r, 10));

    assert.deepEqual(seen, [],
      'a level weeks out from its draw is never asked whether its traits rolled');
    assert.equal(packWatch.pendingPacks().length, 1,
      'the record survives so the level inspects normally once it goes live');
  });

  test('an unknown game state gates nothing', async () => {
    // Number(null) is 0 — a null cap must not read as "cap every level".
    delete _routes['/game/state'];
    const seen = [];
    _routes['/tickets/by-trait'] = countingByTrait(seen, [card(0, true)]);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL + 40, expectedTickets: 1 });
    seen.length = 0;

    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(seen, [LEVEL + 40],
      'without a snapshot the watcher must fall back to asking');
  });

  test('a settled level is read once, then served from the cache', async () => {
    // jackpotPhaseFlag at level 12 puts the unresolved floor at 12, so level 5
    // has drawn and drained: its by-trait answer can no longer change.
    const seen = [];
    _routes['/tickets/by-trait'] = countingByTrait(seen, [card(0, false)]);
    await packWatch.recordPendingPack({ address: ADDR, level: 5, expectedTickets: 1 });
    packWatch.clearSettledCardCache();   // recording already inspects once
    seen.length = 0;

    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(seen, [5], 'first inspection still reads the endpoint');

    packWatch.refreshPackWatch();
    await new Promise((r) => setTimeout(r, 10));
    packWatch.refreshPackWatch();
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(seen, [5], 'a finished level is not re-asked every cycle');

    packWatch.clearSettledCardCache();
    packWatch.refreshPackWatch();
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(seen, [5, 5],
      'dropping the cache (confirmed write, day shift) re-reads it');
  });

  test('a live level is re-read every cycle', async () => {
    const seen = [];
    _routes['/tickets/by-trait'] = countingByTrait(seen, [card(0, false)]);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL, expectedTickets: 1 });
    seen.length = 0;

    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((r) => setTimeout(r, 10));
    packWatch.refreshPackWatch();
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(seen, [LEVEL, LEVEL],
      'the draw this level is waiting on is exactly what polling is for');
  });

  test('purchase-phase future packs publish a passive receipt without posing as an action', async () => {
    _routes['/game/state'] = {
      level: LEVEL - 1,
      phase: 'PURCHASE',
      jackpotPhaseFlag: false,
      rngLockedFlag: false,
    };
    _routes['/tickets/by-trait'] = byTrait([card(0, false)]);
    await packWatch.recordPendingPack({
      address: ADDR, level: LEVEL, expectedTickets: 2,
    });

    assert.equal(packWatch.pendingPacks().length, 1,
      'the future pack remains recorded for its eventual level draw');
    let [item] = pendingActions.getPendingActions();
    assert.equal(item?.label, '2 TICKETS PENDING');
    assert.equal(item?.state, 'waiting');
    assert.equal(item?.passive, true);
    assert.equal(item?.run, null,
      'a future ticket receipt cannot submit work before its draw');

    _routes['/game/state'] = {
      level: LEVEL,
      phase: 'JACKPOT',
      jackpotPhaseFlag: true,
      rngLockedFlag: false,
    };
    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((r) => setTimeout(r, 10));
    [item] = pendingActions.getPendingActions();
    assert.equal(item?.id, 'ticket-packs:pending');
    assert.equal(item?.state, 'waiting',
      'the same record returns when the next RNG really does cover its level');
  });

  test('aggregates every owed entry due before the next jackpot and excludes resolved levels', async () => {
    _routes['/game/state'] = {
      level: LEVEL,
      phase: 'PURCHASE',
      jackpotPhaseFlag: false,
      rngLockedFlag: false,
      phaseTransitionActive: false,
    };
    _routes['/tickets/by-trait'] = (url) => {
      const level = Number(/[?&]level=(\d+)/.exec(url)?.[1]);
      return { address: ADDR.toLowerCase(), level, totalEntries: 0, cards: [] };
    };
    const owed = new Map([
      [LEVEL, 400],       // fully resolved purchase-phase level: never count it
      [LEVEL + 1, 4],
      [LEVEL + 3, 5],
      [LEVEL + 6, 80],    // outside the next sweep: keep it in the bank
    ]);
    const queried = [];
    packWatch.__setEntriesOwedReaderForTest(async (_address, level) => {
      queried.push(level);
      return owed.get(level) || 0;
    });

    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((r) => setTimeout(r, 10));

    assert.deepEqual([...new Set(queried)].sort((a, b) => a - b),
      [LEVEL + 1, LEVEL + 2, LEVEL + 3, LEVEL + 4, LEVEL + 5],
      'only unresolved levels in the contract live window are queried');
    const [item] = pendingActions.getPendingActions();
    assert.equal(pendingActions.getPendingActions().length, 1,
      'all queue levels collapse into one quiet receipt');
    assert.equal(item.id, 'ticket-packs:pending');
    assert.equal(item.ticketCount, 2.25, 'nine owed entries retain quarter-ticket precision');
    assert.deepEqual(item.pendingPacks, [{
      level: LEVEL + 1, count: 1, foilPack: false, packIndex: 1, packCount: 2,
    }, {
      level: LEVEL + 3, count: 1.25, foilPack: false, packIndex: 2, packCount: 2,
    }]);
    assert.equal(item.label, '2.25 TICKETS PENDING');
    assert.equal(item.passive, true);
    assert.equal(item.run, null);
  });

  test('a chain-discovered owed receipt promotes to an opener when its entries materialize', async () => {
    let owedEntries = 8;
    let cards = [];
    _routes['/tickets/by-trait'] = (url) => {
      const level = Number(/[?&]level=(\d+)/.exec(url)?.[1]);
      return { address: ADDR.toLowerCase(), level, totalEntries: cards.length * 4, cards };
    };
    packWatch.__setEntriesOwedReaderForTest(async (_address, level) => (
      level === LEVEL ? owedEntries : 0
    ));
    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((r) => setTimeout(r, 10));

    let [item] = pendingActions.getPendingActions();
    assert.equal(item?.id, 'ticket-packs:pending');
    assert.equal(item?.label, '2 TICKETS PENDING');

    owedEntries = 0;
    packWatch.refreshPackWatch();
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(pendingActions.getPendingActions().length, 0,
      'the exact zero clears Pending at jackpot processing, even before indexing catches up');
    assert.equal(packWatch.pendingPacks().length, 1,
      'the hidden recovery record survives the chain-to-indexer gap');

    cards = [card(0, true), card(1, true)];
    packWatch.refreshPackWatch();
    await new Promise((r) => setTimeout(r, 10));

    [item] = pendingActions.getPendingActions();
    assert.equal(item?.id, `ticket-pack:${LEVEL}`);
    assert.equal(item?.state, 'ready');
    assert.equal(item?.ticketCount, 2);
    assert.equal(typeof item?.run, 'function');
    assert.equal(pendingActions.getPendingActions().some((row) => row.passive), false,
      'materialized whole tickets leave the pending count');

    await item.run();
    const [seq] = takeQueued();
    assert.deepEqual(seq.tickets.map((ticket) => ticket.cardIndex), [0, 1]);
    await packWatch.completePackReveal(seq.packRelease);
    assert.equal(packWatch.pendingPacks().length, 0,
      'the chain-backed record retires after its real entries are opened');
  });

  test('jackpot processing hides an unattributed award but keeps receipt-backed packs visible', async () => {
    _routes['/game/state'] = {
      level: LEVEL,
      phase: 'JACKPOT',
      jackpotPhaseFlag: true,
      rngLockedFlag: true,
      dailyRng: { day: 55, finalWord: '1' },
    };
    _routes['/tickets/by-trait'] = byTrait([]);
    store.update('app.daySync', { day: 55, rngRequested: true, jackpotReady: false });
    packWatch.__setEntriesOwedReaderForTest(async (_address, level) => (
      level === LEVEL ? 72 : 0
    ));

    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(pendingActions.getPendingActions().length, 0,
      'a newly discovered 18-ticket jackpot award cannot enter Pending under the covered board');
    assert.equal(packWatch.pendingPacks().length, 0,
      'the hidden chain discovery is deferred instead of becoming durable spoiler state');

    packWatch.stopPackWatch();
    await packWatch.recordPendingPack({
      address: ADDR,
      level: LEVEL,
      expectedTickets: 2,
      sourceKey: 'degenerette-receipt:1',
      publish: false,
    });
    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const [known] = pendingActions.getPendingActions();
    assert.equal(known?.ticketCount, 2,
      'the known player-started pack remains visible while the unexplained jackpot tail is withheld');

    localStorage.setItem(`jackpot_complete_day_${CHAIN.id}_55`, '1');
    packWatch.refreshPackWatch();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const [openedGate] = pendingActions.getPendingActions();
    assert.equal(openedGate?.ticketCount, 18,
      'finishing the jackpot lets the same authoritative queue amount surface');
  });

  test('a drained receipt clears phantom Pending and promptly promotes when the index catches up', async () => {
    let owedEntries = 4;
    let cards = [card(0, false)];
    _routes['/tickets/by-trait'] = () => byTrait(cards);
    packWatch.__setEntriesOwedReaderForTest(async (_address, level) => (
      level === LEVEL ? owedEntries : 0
    ));
    await packWatch.recordPendingPack({
      address: ADDR,
      level: LEVEL,
      expectedTickets: 1,
      sourceKey: 'settled-boundary-receipt',
      settledExpected: true,
    });

    owedEntries = 0;
    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((resolve) => setTimeout(resolve, 10));

    let [item] = pendingActions.getPendingActions();
    assert.equal(item, undefined,
      'an authoritative chain zero cannot retain the receipt count as pending');
    assert.ok(Number(packWatch.pendingPacks()[0]?.chainDrainedAt) > 0,
      'the zero transition arms the short chain-to-index catch-up window');

    cards = [card(0, true)];
    packWatch.refreshPackWatch();
    await new Promise((resolve) => setTimeout(resolve, 10));
    [item] = pendingActions.getPendingActions();
    assert.equal(item?.id, `ticket-pack:${LEVEL}`);
    assert.equal(item?.state, 'ready');
    assert.equal(item?.ticketCount, 1);
  });

  test('an indexed jackpot award stays hidden until its draw, then survives the drain blind spot', async () => {
    let now = 10_000;
    packWatch.__setClockForTest(() => now);
    packWatch.__setEntriesOwedReaderForTest(async () => 0);
    let ticketPayload = {
      address: ADDR.toLowerCase(), level: LEVEL, day: null,
      totalEntries: 5,
      cards: [card(0, true), partialCard(1)],
    };
    _routes['/tickets/by-trait'] = () => ticketPayload;
    const award = {
      day: 55, level: LEVEL, awardType: 'tickets', amount: '72',
    };
    assert.equal(packWatch.ingestJackpotTicketAwards({ address: ADDR, wins: [award] }), 1);
    assert.equal(packWatch.ingestJackpotTicketAwards({ address: ADDR, wins: [award] }), 0,
      'the repeated indexed day cannot double the same 18-ticket award');

    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((resolve) => setTimeout(resolve, 10));
    let [item] = pendingActions.getPendingActions();
    assert.equal(item, undefined,
      'the indexed ticket count cannot spoil an unplayed jackpot draw');

    localStorage.setItem(`jackpot_complete_day_${CHAIN.id}_55`, '1');
    packWatch.refreshPackWatch();
    await new Promise((resolve) => setTimeout(resolve, 10));
    [item] = pendingActions.getPendingActions();
    assert.equal(item?.id, 'ticket-packs:pending');
    assert.equal(item?.ticketCount, 18);
    assert.deepEqual(item?.pendingPacks, [{
      level: LEVEL, count: 9, foilPack: false, packIndex: 1, packCount: 2,
    }, {
      level: LEVEL, count: 9, foilPack: false, packIndex: 2, packCount: 2,
    }], 'the details popup shows the two physical packs the award will become');

    ticketPayload = {
      address: ADDR.toLowerCase(), level: LEVEL, day: null,
      totalEntries: 77,
      cards: [
        ...Array.from({ length: 19 }, (_unused, index) => card(index, true)),
        partialCard(19),
      ],
    };
    now += 2_100;
    packWatch.refreshPackWatch();
    await new Promise((resolve) => setTimeout(resolve, 10));
    [item] = pendingActions.getPendingActions();
    assert.equal(item?.id, `ticket-pack:${LEVEL}`);
    assert.equal(item?.state, 'ready');
    assert.equal(item?.ticketCount, 18,
      'the prior complete ticket and trailing partial are not mistaken for the jackpot hand');

    await item.run();
    const sequences = takeQueued();
    assert.deepEqual(sequences.map((sequence) => sequence.tickets.length), [9, 9]);
    assert.deepEqual(
      sequences.flatMap((sequence) => sequence.tickets.map((ticket) => ticket.cardIndex)),
      Array.from({ length: 18 }, (_unused, index) => index + 1),
      'only the 18 newly awarded complete tickets are opened',
    );
  });

  test('entriesOwed and materialized cards cannot leak a jackpot ticket award before reveal', async () => {
    let owedEntries = 72;
    let ticketPayload = byTrait([card(0, true)]);
    _routes['/tickets/by-trait'] = () => ticketPayload;
    packWatch.__setEntriesOwedReaderForTest(async (_address, level) => (
      level === LEVEL ? owedEntries : 0
    ));
    packWatch.ingestJackpotTicketAwards({
      address: ADDR,
      wins: [{ day: 55, level: LEVEL, awardType: 'tickets', amount: '72' }],
    });

    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(pendingActions.getPendingActions()[0], undefined,
      'the exact on-chain owed count is spoiler-gated');

    owedEntries = 0;
    ticketPayload = byTrait(Array.from({ length: 19 }, (_unused, index) => card(index, true)));
    packWatch.refreshPackWatch();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(pendingActions.getPendingActions()[0], undefined,
      'the indexed ticket cards remain hidden after processing too');

    localStorage.setItem(`jackpot_complete_day_${CHAIN.id}_55`, '1');
    packWatch.refreshPackWatch();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const [item] = pendingActions.getPendingActions();
    assert.equal(item?.id, `ticket-pack:${LEVEL}`);
    assert.equal(item?.state, 'ready');
    assert.equal(item?.ticketCount, 18,
      'the exact awarded hand appears immediately after the player completes the draw');
  });

  test('a ticket API outage cannot bypass the jackpot-award spoiler gate', async () => {
    _routes['/tickets/by-trait'] = undefined;
    packWatch.__setEntriesOwedReaderForTest(async (_address, level) => (
      level === LEVEL ? 72 : 0
    ));
    packWatch.ingestJackpotTicketAwards({
      address: ADDR,
      wins: [{ day: 55, level: LEVEL, awardType: 'tickets', amount: '72' }],
    });

    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(pendingActions.getPendingActions()[0], undefined,
      'fallback receipt math is spoiler-safe while the ticket projection is unavailable');
  });

  test('jackpot-history catch-up reads at most once per connected wallet and resolved day', async () => {
    let reads = 0;
    _routes['/jackpot-history'] = () => {
      reads += 1;
      return {
        wins: [{ day: 55, level: LEVEL, awardType: 'tickets', amount: '72' }],
      };
    };
    assert.equal(await packWatch.backfillRecentJackpotTicketAwards({
      address: ADDR, day: 55,
    }), 1);
    assert.equal(await packWatch.backfillRecentJackpotTicketAwards({
      address: ADDR, day: 55,
    }), 0);
    assert.equal(reads, 1, 'routine same-day jackpot polls add no database reads');

    await packWatch.backfillRecentJackpotTicketAwards({ address: ADDR, day: 56 });
    assert.equal(reads, 2, 'a genuinely new resolved day gets one catch-up read');
  });

  test('a revealed ticket is not revealed twice, and the record is cleared', async () => {
    _routes['/tickets/by-trait'] = byTrait([card(0, false)]);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });
    _routes['/tickets/by-trait'] = byTrait([card(0, true)]);

    await packWatch.checkPendingPacks({ address: ADDR });
    const [seq] = takeQueued();
    assert.ok(seq);
    assert.equal(packWatch.pendingPacks().length, 1,
      'record remains until the pack presentation is consumed');
    assert.deepEqual(
      [...packWatch.unopenedPackCardIndexes({
        address: ADDR,
        level: LEVEL,
        cards: [card(0, true)],
      })],
      [0],
      'inventory keeps the queued card behind its wrapper',
    );

    await packWatch.completePackReveal(seq.packRelease);
    assert.equal(packWatch.pendingPacks().length, 0,
      'record retires after the terminal acknowledgement');

    await packWatch.checkPendingPacks({ address: ADDR });
    assert.equal(takeQueued().length, 0, 'nothing left pending');
  });

  test('never reveals a partial ticket and keeps watching until all four quadrants exist', async () => {
    _routes['/tickets/by-trait'] = byTrait([card(0, false)]);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });

    const partial = card(0, true);
    partial.status = 'partial';
    partial.entries = partial.entries.slice(0, 3);
    _routes['/tickets/by-trait'] = byTrait([partial]);
    assert.equal(await packWatch.checkPendingPacks({ address: ADDR }), 0);
    assert.equal(takeQueued().length, 0, 'three symbols never become a reveal card');
    assert.equal(packWatch.pendingPacks().length, 1, 'watch survives the partial index state');

    _routes['/tickets/by-trait'] = byTrait([card(0, true)]);
    assert.equal(await packWatch.checkPendingPacks({ address: ADDR }), 1);
    const [seq] = takeQueued();
    assert.equal(seq.tickets[0].traitIds.length, 4);
    assert.deepEqual(
      seq.tickets[0].traitIds.map((tid) => tid >> 6),
      [0, 1, 2, 3],
      'the revealed card has exactly one symbol in every quadrant',
    );
    assert.equal(packWatch.pendingPacks().length, 1, 'whole ticket waits for its opening');
    await packWatch.completePackReveal(seq.packRelease);
    assert.equal(packWatch.pendingPacks().length, 0);
  });

  test('a finalized five-entry award reveals one ticket plus one quarter-ticket entry', async () => {
    _routes['/tickets/by-trait'] = byTrait([]);
    await packWatch.recordPendingPack({
      address: ADDR,
      level: LEVEL,
      expectedTickets: 1.25,
    });
    const loose = {
      cardIndex: 1,
      status: 'opened',
      entries: [{ entryId: 4, traitId: 2, traitLabel: 'x' }],
      source: 'jackpot',
      purchaseBlock: '2',
    };
    _routes['/tickets/by-trait'] = {
      address: ADDR.toLowerCase(),
      level: LEVEL,
      totalEntries: 5,
      cards: [card(0, true), loose],
    };

    assert.equal(await packWatch.checkPendingPacks({ address: ADDR }), 1);
    const [seq] = takeQueued();
    assert.equal(seq.count, 1.25);
    assert.equal(seq.tickets.length, 1);
    assert.deepEqual(seq.entries, [{ traitId: 2 }]);
    assert.equal(seq.packRelease.entryCount, 5);
    assert.deepEqual(seq.packRelease.itemKeys, ['0', 'entry:4']);
    assert.deepEqual([...packWatch.unopenedPackItemKeys({
      address: ADDR,
      level: LEVEL,
      cards: [card(0, true), loose],
    })], ['0', 'entry:4']);

    await packWatch.completePackReveal(seq.packRelease);
    assert.equal(packWatch.pendingPacks().length, 0,
      'exact entry-count release retires a fractional pack cleanly');
  });

  test('duplicate-quadrant rolls reveal as truthful individual entries, never a malformed ticket', async () => {
    _routes['/tickets/by-trait'] = byTrait([card(0, false)]);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });
    const malformed = card(0, true);
    malformed.entries[3].traitId = malformed.entries[2].traitId + 1; // q2 twice; q3 absent
    _routes['/tickets/by-trait'] = byTrait([malformed]);

    assert.equal(await packWatch.checkPendingPacks({ address: ADDR }), 1);
    const [seq] = takeQueued();
    assert.equal(seq.tickets.length, 0, 'duplicate quadrants can never masquerade as a whole ticket');
    assert.deepEqual(seq.entries.map((entry) => entry.traitId),
      malformed.entries.map((entry) => entry.traitId));
    assert.equal(seq.count, 1, 'four independent entries retain one-ticket-equivalent accounting');
    await packWatch.completePackReveal(seq.packRelease);
    assert.equal(packWatch.pendingPacks().length, 0);
  });

  test('no record → no reveal, however many tickets have rolled', async () => {
    _routes['/tickets/by-trait'] = byTrait([card(0, true), card(1, true), card(2, true)]);
    const n = await packWatch.checkPendingPacks({ address: ADDR });
    assert.equal(n, 0);
    assert.equal(takeQueued().length, 0, 'the watcher is inert without a purchase to answer for');
  });

  test('a failed seed fetch keeps a guarded seed-pending record for later recovery', async () => {
    _routes = {};   // endpoint down
    const ok = await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });
    assert.equal(ok, true);
    assert.equal(packWatch.pendingPacks().length, 1);
    assert.equal(packWatch.pendingPacks()[0].seedPending, true,
      'the next trustworthy response establishes the baseline before revealing');
  });

  test('a second record for the same level does not re-seed over the first', async () => {
    _routes['/tickets/by-trait'] = byTrait([card(0, false)]);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });
    // A foil leg in the same buy records again — by now the indexer may already
    // show the ticket leg as rolled, and re-seeding would swallow its reveal.
    _routes['/tickets/by-trait'] = byTrait([card(0, true)]);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });
    assert.equal(packWatch.pendingPacks().length, 1, 'one record per level, not two');

    await packWatch.checkPendingPacks({ address: ADDR });
    assert.equal(takeQueued().length, 1, 'the first record still gets its reveal');
  });

  test('a record older than the TTL is dropped unopened', async () => {
    _routes['/tickets/by-trait'] = byTrait([card(0, false)]);
    let now = 1_000_000_000_000;
    packWatch.__setClockForTest(() => now);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });
    now += 61 * 24 * 60 * 60 * 1000;   // past the 60-day TTL
    _routes['/tickets/by-trait'] = byTrait([card(0, true)]);

    await packWatch.checkPendingPacks({ address: ADDR });
    assert.equal(takeQueued().length, 0, 'stale record does not pop months later');
    assert.equal(packWatch.pendingPacks().length, 0, 'and is cleaned up');
  });

  test('splits large drops into sequential 3×3 packs of at most 9 tickets', async () => {
    _routes['/tickets/by-trait'] = byTrait([card(0, false)]);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });
    _routes['/tickets/by-trait'] = byTrait(
      Array.from({ length: 23 }, (_, i) => card(i, true)),
    );
    const queued = await packWatch.checkPendingPacks({ address: ADDR });
    const seqs = takeQueued();
    assert.equal(queued, 3, 'one reveal sequence per physical pack');
    assert.deepEqual(seqs.map((s) => s.tickets.length), [9, 9, 5]);
    assert.ok(seqs.every((s) => s.tickets.length <= 9), 'no pack exceeds nine tickets');
    assert.deepEqual(seqs.map((s) => s.packIndex), [1, 2, 3]);
    assert.ok(seqs.every((s) => s.packCount === 3));
    assert.ok(seqs.every((s) => s.batchId === seqs[0].batchId), 'packs share one open-all batch');
    assert.ok(seqs.every((s) => s.totalCount === 23));
  });

  test('uses the foil projection as authoritative and opens it after the ordinary pack', async () => {
    const pending = [card(0, false)];
    _routes['/tickets/by-trait'] = byTrait(pending);
    await packWatch.recordPendingPack({
      address: ADDR,
      level: LEVEL,
      foilExpected: true,
      expectedTickets: 5,
    });
    assert.equal(packWatch.pendingPacks()[0].foilExpected, true, 'foil expectation persisted');

    const rolled = [card(0, true)];
    _routes['/tickets/by-trait'] = byTrait(rolled);
    _routes['/foil'] = { present: false, level: LEVEL, lines: [] };
    assert.equal(await packWatch.checkPendingPacks({ address: ADDR }), 0,
      'does not mislabel foil tickets while /foil is behind');
    assert.equal(takeQueued().length, 0);
    assert.equal(packWatch.pendingPacks().length, 1, 'record remains pending through indexer lag');

    const foilLines = Array.from({ length: 4 }, (_unused, i) => (
      card(i + 1, true).entries.map((entry) => entry.traitId)
    ));
    _routes['/foil'] = { present: true, level: LEVEL, lines: foilLines };
    assert.equal(await packWatch.checkPendingPacks({ address: ADDR }), 2);
    const [standard, foil] = takeQueued();
    assert.equal(standard.foilPack, false);
    assert.equal(standard.level, LEVEL);
    assert.equal(standard.tickets.length, 1, 'ordinary ticket keeps its own pack');
    assert.equal(foil.foilPack, true);
    assert.equal(foil.level, LEVEL);
    assert.equal(foil.title, `FOIL PACK · LEVEL ${LEVEL}`);
    assert.equal(foil.tickets.length, 4);
    assert.ok(foil.tickets.every((ticket) => ticket.foil), 'foil pack contains only foil lines');
    assert.equal(standard.batchId, foil.batchId, 'OPEN ALL includes the final foil pack');
    assert.deepEqual([standard.packIndex, foil.packIndex], [1, 2]);
    assert.ok([standard, foil].every((pack) => pack.packCount === 2));
    assert.ok([standard, foil].every((pack) => pack.totalCount === 5));
  });

  test('a resolved foil-only purchase cannot stay pending behind an empty generic ticket feed', async () => {
    _routes['/tickets/by-trait'] = byTrait([]);
    _routes['/foil'] = { present: false, level: LEVEL, lines: null };
    await packWatch.recordPendingPack({
      address: ADDR,
      level: LEVEL,
      foilExpected: true,
      standardExpected: false,
      expectedTickets: 4,
      sourceKey: 'foil-only-resolved',
    });
    assert.equal(packWatch.unopenedFoilPackPending({ address: ADDR, level: LEVEL }), true);

    _routes['/foil'] = {
      present: true,
      level: LEVEL,
      lines: Array.from({ length: 4 }, (_unused, i) => (
        card(i + 8, true).entries.map((entry) => entry.traitId)
      )),
    };
    assert.equal(await packWatch.checkPendingPacks({ address: ADDR }), 1);
    const [foil] = takeQueued();
    assert.equal(foil.foilPack, true);
    assert.equal(foil.tickets.length, 4);
    assert.deepEqual(foil.tickets.map((ticket) => ticket.traitIds), _routes['/foil'].lines);

    await packWatch.completePackReveal(foil.packRelease);
    assert.equal(packWatch.pendingPacks().length, 0);
    assert.equal(packWatch.unopenedFoilPackPending({ address: ADDR, level: LEVEL }), false);
  });

  test('bottom-panel indexing copy follows foil-only versus mixed pack identity', async () => {
    _routes['/tickets/by-trait'] = byTrait([card(0, false)]);
    await packWatch.recordPendingPack({
      address: ADDR,
      level: LEVEL,
      foilExpected: true,
      standardExpected: false,
      expectedTickets: 4,
      sourceKey: 'foil-only',
    });
    let [item] = pendingActions.getPendingActions();
    assert.equal(item.label, '4 TICKETS PENDING');
    assert.equal(item.detail, 'Foil pack is still indexing');

    // Pending rows merge per level. Adding an ordinary pack must immediately
    // change the shared row to neutral ticket-pack copy even though its foil
    // companion is still catching up.
    await packWatch.recordPendingPack({
      address: ADDR,
      level: LEVEL,
      expectedTickets: 1,
      sourceKey: 'ordinary-pack',
    });
    [item] = pendingActions.getPendingActions();
    assert.equal(item.label, '5 TICKETS PENDING');
    assert.equal(item.detail, 'Ticket pack is still indexing');
    assert.doesNotMatch(item.detail, /foil/i);
  });
});
