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

describe('pack-watch — deferred ticket reveals', () => {
  beforeEach(() => {
    localStorage.clear();
    _routes = {
      '/game/state': { level: LEVEL, jackpotPhaseFlag: true },
    };
    overlay.__resetForTest();
    pendingActions.__resetPendingActionsForTest();
  });

  afterEach(() => {
    packWatch.stopPackWatch();
    packWatch.__setClockForTest(null);
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
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });
    let [item] = pendingActions.getPendingActions();
    assert.equal(item.id, `ticket-pack:${LEVEL}`);
    assert.equal(item.state, 'waiting');
    assert.equal(item.shortLabel, 'Open tickets');
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

  test('purchase-phase future packs stay durable but do not pose as next-RNG work', async () => {
    _routes['/game/state'] = {
      level: LEVEL - 1,
      phase: 'PURCHASE',
      jackpotPhaseFlag: false,
      rngLockedFlag: false,
    };
    _routes['/tickets/by-trait'] = byTrait([card(0, false)]);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });

    assert.equal(packWatch.pendingPacks().length, 1,
      'the future pack remains recorded for its eventual level draw');
    assert.equal(pendingActions.getPendingActions().length, 0,
      'a daily RNG during purchase phase cannot resolve the future ticket pack');

    _routes['/game/state'] = {
      level: LEVEL,
      phase: 'JACKPOT',
      jackpotPhaseFlag: true,
      rngLockedFlag: false,
    };
    packWatch.startPackWatch({ getAddress: () => ADDR });
    await new Promise((r) => setTimeout(r, 10));
    const [item] = pendingActions.getPendingActions();
    assert.equal(item?.id, `ticket-pack:${LEVEL}`);
    assert.equal(item?.state, 'waiting',
      'the same record returns when the next RNG really does cover its level');
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
    assert.equal(packWatch.pendingPacks().length, 0, 'record retires after COLLECT');

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

  test('rejects four rolled entries when their trait IDs collapse into duplicate quadrants', async () => {
    _routes['/tickets/by-trait'] = byTrait([card(0, false)]);
    await packWatch.recordPendingPack({ address: ADDR, level: LEVEL });
    const malformed = card(0, true);
    malformed.entries[3].traitId = malformed.entries[2].traitId + 1; // q2 twice; q3 absent
    _routes['/tickets/by-trait'] = byTrait([malformed]);

    assert.equal(await packWatch.checkPendingPacks({ address: ADDR }), 0);
    assert.equal(takeQueued().length, 0);
    assert.equal(packWatch.pendingPacks().length, 1, 'wait for a corrected index response');
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

  test('waits for foil indexing, then opens the four foil lines as a separate special pack', async () => {
    const pending = Array.from({ length: 5 }, (_, i) => card(i, false));
    _routes['/tickets/by-trait'] = byTrait(pending);
    await packWatch.recordPendingPack({
      address: ADDR,
      level: LEVEL,
      foilExpected: true,
    });
    assert.equal(packWatch.pendingPacks()[0].foilExpected, true, 'foil expectation persisted');

    const rolled = Array.from({ length: 5 }, (_, i) => card(i, true));
    _routes['/tickets/by-trait'] = byTrait(rolled);
    _routes['/foil'] = { present: false, level: LEVEL, lines: [] };
    assert.equal(await packWatch.checkPendingPacks({ address: ADDR }), 0,
      'does not mislabel foil tickets while /foil is behind');
    assert.equal(takeQueued().length, 0);
    assert.equal(packWatch.pendingPacks().length, 1, 'record remains pending through indexer lag');

    const foilLines = rolled.slice(1).map((c) => c.entries.map((entry) => entry.traitId));
    _routes['/foil'] = { present: true, level: LEVEL, lines: foilLines };
    _routes['/tickets/by-trait'] = byTrait(rolled.slice(0, 4));
    assert.equal(await packWatch.checkPendingPacks({ address: ADDR }), 0,
      'four indexed foil lines cannot open while only three matching ticket cards exist');
    assert.equal(takeQueued().length, 0, 'never constructs a three-ticket foil hand');

    _routes['/tickets/by-trait'] = byTrait(rolled);
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
    assert.notEqual(standard.batchId, foil.batchId, 'OPEN ALL cannot skip the foil opening');
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
    assert.equal(item.label, `Level ${LEVEL} foil pack`);
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
    assert.equal(item.label, `Level ${LEVEL} ticket pack`);
    assert.equal(item.detail, 'Ticket pack is still indexing');
    assert.doesNotMatch(item.detail, /foil/i);
  });
});
