// /app/app/__tests__/degenerette.test.js — Phase 62 Plan 62-03 (BUY-05).
//
// Run: cd website && node --test app/app/__tests__/degenerette.test.js
//
// Tests for degenerette.js write-path module: placeBet + resolveBets +
// parseBetPlacedFromReceipt + parseBetResolvedFromReceipt +
// parseFullTicketResultsFromReceipt + InvalidBet + UnsupportedCurrency
// reason-map registrations.
//
// RESEARCH R5 confirmed: BUY-05 is a TWO-tx flow.
//   tx 1: placeDegeneretteBet(player, currency, amountPerTicket, ticketCount,
//                             customTicket, heroQuadrant) payable
//                             → emits BetPlaced(player, index, betId, packed)
//   tx 2 (after RNG ready):  resolveDegeneretteBets(player, betIds[])
//                             → emits FullTicketResolved + FullTicketResult per ticket
//
// Sources:
//  - DegenerusGame.sol:714 — placeDegeneretteBet (delegate-called via GAME).
//  - DegenerusGame.sol:743 — resolveDegeneretteBets (delegate-called via GAME).
//  - DegenerusGameDegeneretteModule.sol:55 — error InvalidBet();
//  - DegenerusGameDegeneretteModule.sol:58 — error UnsupportedCurrency();
//  - DegenerusGameDegeneretteModule.sol:69-104 — BetPlaced / FullTicketResolved / FullTicketResult events.
//
// RESEARCH Q7: WWXRP (currency 3) deferred from Phase 62 — UI restricts currency
// to ETH (0) + BURNIE (1). Currency 2 → UnsupportedCurrency revert.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as degeneretteMod from '../degenerette.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';
import * as reasonMapMod from '../reason-map.js';

// ---------------------------------------------------------------------------
// Fake provider/signer/contract harness — verbatim port of passes.test.js shape.
// ---------------------------------------------------------------------------

function makeFakeReceipt(logs) {
  return { status: 1, hash: '0xreceipt-hash', logs: logs || [] };
}

function makeFakeTx(receipt) {
  return { hash: '0xtx-hash', wait: async () => receipt };
}

function makeFakeContract(opts = {}) {
  const calls = {
    placeDegeneretteBet: [],
    resolveDegeneretteBets: [],
  };
  const order = [];
  const staticCallStub = (methodName) => async (..._args) => {
    order.push(`static:${methodName}`);
    if (opts.staticCallShouldRevert?.[methodName]) {
      const err = new Error('static-call revert');
      err.revert = {
        name: opts.staticCallRevertName?.[methodName] || 'InvalidBet',
      };
      throw err;
    }
    return undefined;
  };
  const sendTxStub = (methodName) => async (..._args) => {
    order.push(`send:${methodName}`);
    if (opts.sendTxShouldRevert?.[methodName]) {
      const err = new Error('sendTx revert');
      err.revert = { name: opts.sendTxRevertName?.[methodName] || 'InvalidBet' };
      throw err;
    }
    return makeFakeTx(makeFakeReceipt(opts[methodName + 'Logs']));
  };

  const c = {
    placeDegeneretteBet: Object.assign(
      async (...args) => {
        calls.placeDegeneretteBet.push(args);
        return sendTxStub('placeDegeneretteBet')(...args);
      },
      { staticCall: staticCallStub('placeDegeneretteBet') }
    ),
    resolveDegeneretteBets: Object.assign(
      async (...args) => {
        calls.resolveDegeneretteBets.push(args);
        return sendTxStub('resolveDegeneretteBets')(...args);
      },
      { staticCall: staticCallStub('resolveDegeneretteBets') }
    ),
    interface: { parseLog: (log) => log.parsed ?? null },
    connect(_signer) { return this; },
    _calls: calls,
    _order: order,
  };
  return c;
}

function makeFakeProvider(connectedAddr) {
  return {
    getNetwork: async () => ({ chainId: 11155111n }),
    getSigner: async () => ({
      getAddress: async () => connectedAddr,
    }),
  };
}

const CONNECTED = '0xab12000000000000000000000000000000000000';

// ===========================================================================
// Reason-map registrations — Plan 62-03 registers InvalidBet + UnsupportedCurrency.
// Phase 56 baseline already covers RngNotReady — DO NOT re-register.
// ===========================================================================

describe('Plan 62-03: degenerette.js reason-map registrations', () => {
  test('registers InvalidBet with friendly userMessage citing inputs', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'InvalidBet' },
    });
    assert.equal(decoded.code, 'InvalidBet');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /invalid|amount|count|inputs/i);
  });

  test('registers UnsupportedCurrency with friendly userMessage', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'UnsupportedCurrency' },
    });
    assert.equal(decoded.code, 'UnsupportedCurrency');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /currency|not supported|ETH|BURNIE/i);
  });

  test('does NOT re-register RngNotReady (Phase 56 baseline already covers per RESEARCH R11)', () => {
    const SRC = readFileSync(new URL('../degenerette.js', import.meta.url), 'utf8');
    assert.equal(
      /register\(\s*['"]RngNotReady['"]/.test(SRC),
      false,
      "degenerette.js must NOT register 'RngNotReady' (Phase 56 baseline)",
    );
  });
});

// ===========================================================================
// placeBet — calls contract.placeDegeneretteBet(...) with msg.value.
// ===========================================================================

describe('Plan 62-03: placeBet', () => {
  let lastFakeContract;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    degeneretteMod.__setContractFactoryForTest(() => lastFakeContract);
  });

  afterEach(() => {
    degeneretteMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('invokes placeDegeneretteBet(player, currency, amount, count, customTicket, heroQuadrant) with closure-form sendTx + msg.value', async () => {
    const amountPerTicket = 10n ** 16n;  // 0.01 ETH
    const ticketCount = 3;
    const msgValueWei = amountPerTicket * BigInt(ticketCount);
    await degeneretteMod.placeBet({
      currency: 0,
      amountPerTicketWei: amountPerTicket,
      ticketCount,
      customTicket: 0,
      heroQuadrant: 0xFF,
      msgValueWei,
    });
    assert.equal(lastFakeContract._calls.placeDegeneretteBet.length, 1);
    const [args] = lastFakeContract._calls.placeDegeneretteBet;
    assert.equal(args[0], CONNECTED, 'player = connected.address');
    assert.equal(args[1], 0, 'currency = ETH (0)');
    assert.equal(args[2], amountPerTicket, 'amountPerTicket bigint');
    assert.equal(args[3], 3, 'ticketCount = 3');
    assert.equal(args[4], 0, 'customTicket = 0');
    assert.equal(args[5], 0xFF, 'heroQuadrant = 0xFF (no hero)');
    // 7th arg = overrides object containing value
    assert.ok(args[6] && typeof args[6] === 'object', 'overrides object passed');
    assert.equal(args[6].value, msgValueWei, 'msg.value matches msgValueWei');
  });

  test('rejects ticketCount < 1', async () => {
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 0,
        amountPerTicketWei: 10n ** 16n,
        ticketCount: 0,
        customTicket: 0,
        heroQuadrant: 0xFF,
        msgValueWei: 0n,
      }),
      /Ticket count must be 1-10/i,
    );
  });

  test('rejects ticketCount > 10', async () => {
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 0,
        amountPerTicketWei: 10n ** 16n,
        ticketCount: 11,
        customTicket: 0,
        heroQuadrant: 0xFF,
        msgValueWei: 0n,
      }),
      /Ticket count must be 1-10/i,
    );
  });

  test('rejects currency 2 (unsupported) client-side', async () => {
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 2,
        amountPerTicketWei: 10n ** 16n,
        ticketCount: 1,
        customTicket: 0,
        heroQuadrant: 0xFF,
        msgValueWei: 0n,
      }),
      /Unsupported currency|UnsupportedCurrency|not supported/i,
    );
  });

  test('rejects amountPerTicketWei = 0', async () => {
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 0,
        amountPerTicketWei: 0n,
        ticketCount: 1,
        customTicket: 0,
        heroQuadrant: 0xFF,
        msgValueWei: 0n,
      }),
      /Amount.*greater than 0|Amount must|InvalidBet/i,
    );
  });

  test('rejects when wallet not connected', async () => {
    storeMod.update('connected.address', null);
    contractsMod.clearProvider();
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 0,
        amountPerTicketWei: 10n ** 16n,
        ticketCount: 1,
        customTicket: 0,
        heroQuadrant: 0xFF,
        msgValueWei: 10n ** 16n,
      }),
      /Wallet not connected/i,
    );
  });

  test('static-call gate runs BEFORE sendTx — order verification', async () => {
    const reverting = makeFakeContract({
      staticCallShouldRevert: { placeDegeneretteBet: true },
      staticCallRevertName: { placeDegeneretteBet: 'InvalidBet' },
    });
    degeneretteMod.__setContractFactoryForTest(() => reverting);
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 0,
        amountPerTicketWei: 10n ** 16n,
        ticketCount: 1,
        customTicket: 0,
        heroQuadrant: 0xFF,
        msgValueWei: 10n ** 16n,
      }),
    );
    assert.equal(
      reverting._calls.placeDegeneretteBet.length, 0,
      'sendTx NOT invoked when static-call gate trips',
    );
  });
});

// ===========================================================================
// resolveBets — calls contract.resolveDegeneretteBets(player, betIds[]).
// ===========================================================================

describe('Plan 62-03: resolveBets', () => {
  let lastFakeContract;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    degeneretteMod.__setContractFactoryForTest(() => lastFakeContract);
  });

  afterEach(() => {
    degeneretteMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('invokes resolveDegeneretteBets(player, betIds[]) with closure-form sendTx + Resolve degenerette bet label', async () => {
    await degeneretteMod.resolveBets({ betIds: [42n] });
    assert.equal(lastFakeContract._calls.resolveDegeneretteBets.length, 1);
    const [args] = lastFakeContract._calls.resolveDegeneretteBets;
    assert.equal(args[0], CONNECTED, 'player = connected.address');
    assert.deepEqual(args[1], [42n], 'betIds passed as array of BigInt');
  });

  test('rejects empty betIds array', async () => {
    await assert.rejects(
      degeneretteMod.resolveBets({ betIds: [] }),
      /betIds.*non-empty|at least one bet|empty/i,
    );
  });

  test('coerces betIds entries to BigInt', async () => {
    await degeneretteMod.resolveBets({ betIds: [42] });
    const [args] = lastFakeContract._calls.resolveDegeneretteBets;
    assert.equal(args[1][0], 42n, 'number coerced to BigInt');
  });
});

// ===========================================================================
// Receipt parsers — Phase 60 D-03 receipt-log-first source of truth.
// ===========================================================================

describe('Plan 62-03: degenerette.js receipt parsers', () => {
  test('parseBetPlacedFromReceipt returns [{player, index, betId, packed}]', () => {
    const receipt = makeFakeReceipt([
      {
        parsed: {
          name: 'BetPlaced',
          args: {
            player: CONNECTED,
            index: 7n,
            betId: 42n,
            packed: 0xdeadbeefn,
          },
        },
      },
    ]);
    const fakeContract = { interface: { parseLog: (log) => log.parsed ?? null } };
    const out = degeneretteMod.parseBetPlacedFromReceipt(receipt, fakeContract);
    assert.equal(out.length, 1);
    assert.equal(out[0].player, CONNECTED);
    assert.equal(out[0].index, 7n);
    assert.equal(out[0].betId, 42n);
    assert.equal(out[0].packed, 0xdeadbeefn);
  });

  test('parseBetResolvedFromReceipt returns FullTicketResolved entries', () => {
    const receipt = makeFakeReceipt([
      {
        parsed: {
          name: 'FullTicketResolved',
          args: {
            player: CONNECTED,
            betId: 42n,
            ticketCount: 3,
            totalPayout: 5n * 10n ** 16n,
            resultTicket: 1234n,
          },
        },
      },
    ]);
    const fakeContract = { interface: { parseLog: (log) => log.parsed ?? null } };
    const out = degeneretteMod.parseBetResolvedFromReceipt(receipt, fakeContract);
    assert.equal(out.length, 1);
    assert.equal(out[0].player, CONNECTED);
    assert.equal(out[0].betId, 42n);
    assert.equal(out[0].ticketCount, 3n);
    assert.equal(out[0].totalPayout, 5n * 10n ** 16n);
    assert.equal(out[0].resultTicket, 1234n);
  });

  test('parseFullTicketResultsFromReceipt returns FullTicketResult per-spin entries', () => {
    const receipt = makeFakeReceipt([
      {
        parsed: {
          name: 'FullTicketResult',
          args: {
            player: CONNECTED,
            betId: 42n,
            ticketIndex: 0,
            playerTicket: 1234n,
            matches: 4,
            payout: 1n * 10n ** 16n,
          },
        },
      },
      {
        parsed: {
          name: 'FullTicketResult',
          args: {
            player: CONNECTED,
            betId: 42n,
            ticketIndex: 1,
            playerTicket: 5678n,
            matches: 2,
            payout: 0n,
          },
        },
      },
    ]);
    const fakeContract = { interface: { parseLog: (log) => log.parsed ?? null } };
    const out = degeneretteMod.parseFullTicketResultsFromReceipt(receipt, fakeContract);
    assert.equal(out.length, 2);
    assert.equal(out[0].matches, 4n);
    assert.equal(out[0].payout, 1n * 10n ** 16n);
    assert.equal(out[1].matches, 2n);
    assert.equal(out[1].payout, 0n);
  });

  test('parseBetPlacedFromReceipt ignores foreign logs gracefully', () => {
    const throwingContract = {
      interface: { parseLog: () => { throw new Error('foreign'); } },
    };
    const receipt = makeFakeReceipt([{ topics: [], data: '0x' }]);
    assert.deepEqual(degeneretteMod.parseBetPlacedFromReceipt(receipt, throwingContract), []);
  });

  test('all parsers return empty array on null/empty receipt', () => {
    const fakeContract = { interface: { parseLog: () => null } };
    assert.deepEqual(degeneretteMod.parseBetPlacedFromReceipt(null, fakeContract), []);
    assert.deepEqual(degeneretteMod.parseBetResolvedFromReceipt({ logs: undefined }, fakeContract), []);
    assert.deepEqual(degeneretteMod.parseFullTicketResultsFromReceipt({ logs: [] }, fakeContract), []);
  });
});

// ===========================================================================
// degenerette.js source-level invariants.
// ===========================================================================

describe('Plan 62-03: degenerette.js source-level invariants', () => {
  const SRC = readFileSync(new URL('../degenerette.js', import.meta.url), 'utf8');

  test('uses closure-form sendTx — minimum 2 occurrences (one per writer)', () => {
    const matches = SRC.match(/sendTx\(\s*\(s\)\s*=>/g) || [];
    assert.ok(matches.length >= 2, `expected >= 2 closure-form sendTx, got ${matches.length}`);
  });

  test('action label `Place degenerette bet` is sent to sendTx', () => {
    assert.ok(SRC.includes("'Place degenerette bet'"), 'place action label present');
  });

  test('action label `Resolve degenerette bet` is sent to sendTx', () => {
    assert.ok(SRC.includes("'Resolve degenerette bet'"), 'resolve action label present');
  });

  test('canonical ABI: placeDegeneretteBet signature', () => {
    assert.ok(
      SRC.includes('function placeDegeneretteBet(address player, uint8 currency, uint128 amountPerTicket, uint8 ticketCount, uint32 customTicket, uint8 heroQuadrant) external payable'),
      'canonical placeDegeneretteBet ABI fragment present',
    );
  });

  test('canonical ABI: resolveDegeneretteBets signature', () => {
    assert.ok(
      SRC.includes('function resolveDegeneretteBets(address player, uint64[] calldata betIds) external'),
      'canonical resolveDegeneretteBets ABI fragment present',
    );
  });

  test('canonical event ABIs: BetPlaced + FullTicketResolved + FullTicketResult', () => {
    assert.ok(SRC.includes('event BetPlaced(address indexed player, uint32 indexed index, uint64 indexed betId, uint256 packed)'));
    assert.ok(SRC.includes('event FullTicketResolved(address indexed player, uint64 indexed betId, uint8 ticketCount, uint256 totalPayout, uint32 resultTicket)'));
    assert.ok(SRC.includes('event FullTicketResult(address indexed player, uint64 indexed betId, uint8 ticketIndex, uint32 playerTicket, uint8 matches, uint256 payout)'));
  });

  test('reason-map registers EXACTLY 2 NEW codes (InvalidBet + UnsupportedCurrency)', () => {
    const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const registers = stripped.match(/register\s*\(/g) || [];
    assert.equal(registers.length, 2, `exactly 2 register calls expected, got ${registers.length}`);
    assert.ok(/register\(\s*['"]InvalidBet['"]/.test(stripped));
    assert.ok(/register\(\s*['"]UnsupportedCurrency['"]/.test(stripped));
  });

  test('NO pre-resolved-promise sendTx (Phase 58 closure-form gate)', () => {
    const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(
      /sendTx\([a-zA-Z_]+\.[a-zA-Z_]+\(/.test(stripped),
      false,
      'NO pre-resolved promise sendTx pattern allowed',
    );
  });

  test('requireStaticCall invoked at least 2 times (one per writer)', () => {
    const matches = SRC.match(/requireStaticCall\(/g) || [];
    assert.ok(matches.length >= 2, `expected >= 2 requireStaticCall, got ${matches.length}`);
  });

  test('exports 5 named functions (placeBet, resolveBets, 3 parsers)', () => {
    assert.ok(/export\s+async\s+function\s+placeBet\b/.test(SRC));
    assert.ok(/export\s+async\s+function\s+resolveBets\b/.test(SRC));
    assert.ok(/export\s+function\s+parseBetPlacedFromReceipt\b/.test(SRC));
    assert.ok(/export\s+function\s+parseBetResolvedFromReceipt\b/.test(SRC));
    assert.ok(/export\s+function\s+parseFullTicketResultsFromReceipt\b/.test(SRC));
  });

  test('imports pollRngForLootbox from lootbox.js (RESEARCH R5 OPTION B reuse)', () => {
    assert.match(
      SRC,
      /import\s+\{[^}]*pollRngForLootbox[^}]*\}\s*from\s*['"]\.\/lootbox\.js['"]/,
      'degenerette.js imports pollRngForLootbox from lootbox.js',
    );
  });
});
