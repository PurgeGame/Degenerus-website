// /app/app/__tests__/degenerette.test.js — Phase 62 Plan 62-03 (BUY-05).
//
// Run: cd website && node --test app/app/__tests__/degenerette.test.js
//
// Tests for degenerette.js write-path module: placeBet + resolveBets +
// parseBetPlacedFromReceipt + parseBetResolvedFromReceipt +
// parseSpinResultsFromReceipt + InvalidBet + UnsupportedCurrency
// reason-map registrations.
//
// RESEARCH R5 confirmed: BUY-05 is a TWO-tx flow.
//   tx 1: placeDegeneretteBet(player, currency, amountPerTicket, ticketCount,
//                             customTicket, heroQuadrant) payable
//                             → emits BetPlaced(player, index, betId, packed)
//   tx 2 (after RNG ready):  resolveDegeneretteBets(player, betIds[])
//                             → emits DegeneretteResolved + DegeneretteResult per spin
//
// Sources:
//  - DegenerusGame.sol:714 — placeDegeneretteBet (delegate-called via GAME).
//  - DegenerusGame.sol:743 — resolveDegeneretteBets (delegate-called via GAME).
//  - DegenerusGameDegeneretteModule.sol:55 — error InvalidBet();
//  - DegenerusGameDegeneretteModule.sol:58 — error UnsupportedCurrency();
//  - DegenerusGameDegeneretteModule.sol:69-104 — BetPlaced / DegeneretteResolved / DegeneretteResult events.
//
// RESEARCH Q7: WWXRP (currency 3) deferred from Phase 62 — UI restricts currency
// to ETH (0) + FLIP (1). Currency 2 → UnsupportedCurrency revert.

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
    degeneretteResolve: [],
    degeneretteBetInfo: [],
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
    degeneretteResolve: Object.assign(
      async (...args) => {
        calls.degeneretteResolve.push(args);
        return sendTxStub('degeneretteResolve')(...args);
      },
      { staticCall: staticCallStub('degeneretteResolve') }
    ),
    degeneretteBetInfo: async (...args) => {
      calls.degeneretteBetInfo.push(args);
      return opts.betInfo ?? 1n;
    },
    interface: { parseLog: (log) => log.parsed ?? null },
    connect(_signer) { return this; },
    _calls: calls,
    _order: order,
  };
  return c;
}

function makeFakeProvider(connectedAddr) {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
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
    assert.match(decoded.userMessage, /currency|not supported|ETH|FLIP/i);
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
      heroQuadrant: 0,
      msgValueWei,
    });
    assert.equal(lastFakeContract._calls.placeDegeneretteBet.length, 1);
    const [args] = lastFakeContract._calls.placeDegeneretteBet;
    assert.equal(args[0], CONNECTED, 'player = connected.address');
    assert.equal(args[1], 0, 'currency = ETH (0)');
    assert.equal(args[2], amountPerTicket, 'amountPerTicket bigint');
    assert.equal(args[3], 3, 'ticketCount = 3');
    assert.equal(args[4], 0, 'customTicket = 0');
    assert.equal(args[5], 0, 'heroQuadrant = 0 (quadrant A; v48 requires a valid 0-3)');
    // 7th arg = overrides object containing value
    assert.ok(args[6] && typeof args[6] === 'object', 'overrides object passed');
    assert.equal(args[6].value, msgValueWei, 'msg.value matches msgValueWei');
  });

  test('rejects spinCount < 1', async () => {
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 0,
        amountPerTicketWei: 10n ** 16n,
        ticketCount: 0,
        customTicket: 0,
        heroQuadrant: 0,
        msgValueWei: 0n,
      }),
      /Spins must be 1-25 for ETH/i,
    );
  });

  // Per-currency caps, verbatim from DegenerusGameDegeneretteModule.sol:236-238
  // (MAX_SPINS_ETH 25 / FLIP 15 / WWXRP 5). The old flat 1-10 UI cap hid 15 of
  // the ETH spins the contract allows.
  test('accepts the contract cap per currency and rejects one past it', async () => {
    const cases = [
      { currency: 0, cap: 25, amount: 10n ** 16n, unit: 'ETH' },
      { currency: 1, cap: 15, amount: 100n * 10n ** 18n, unit: 'FLIP' },
      { currency: 3, cap: 5, amount: 10n ** 18n, unit: 'WWXRP' },
    ];
    for (const { currency, cap, amount, unit } of cases) {
      await degeneretteMod.placeBet({
        currency,
        amountPerTicketWei: amount,
        ticketCount: cap,
        customTicket: 0,
        heroQuadrant: 0,
        msgValueWei: currency === 0 ? amount * BigInt(cap) : 0n,
      });
      await assert.rejects(
        degeneretteMod.placeBet({
          currency,
          amountPerTicketWei: amount,
          ticketCount: cap + 1,
          customTicket: 0,
          heroQuadrant: 0,
          msgValueWei: 0n,
        }),
        new RegExp(`Spins must be 1-${cap} for ${unit}`, 'i'),
        `${unit} rejects ${cap + 1} spins`,
      );
    }
    assert.equal(
      lastFakeContract._calls.placeDegeneretteBet.length, 3,
      'all three at-cap bets went through',
    );
  });

  test('rejects a bet below the contract minimum, per currency', async () => {
    // MIN_BET_* (module :227-233): 0.005 ETH / 100 FLIP / 1 WWXRP per spin.
    // ETH callers pass CHAIN-scale wei, so the boundary is scale-dependent —
    // derive it rather than hardcoding a mainnet figure that passes on testnet.
    const { ETH_DIVISOR } = await import('../chain-config.js');
    const ethMinChainWei = (5n * 10n ** 15n) / BigInt(ETH_DIVISOR);
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 0, amountPerTicketWei: ethMinChainWei - 1n, ticketCount: 1, heroQuadrant: 0,
      }),
      /Minimum bet is 0.005 ETH per spin/i,
    );
    // …and exactly at the ETH minimum goes through.
    await degeneretteMod.placeBet({
      currency: 0, amountPerTicketWei: ethMinChainWei, ticketCount: 1, heroQuadrant: 0,
      msgValueWei: ethMinChainWei,
    });
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 1, amountPerTicketWei: 99n * 10n ** 18n, ticketCount: 1, heroQuadrant: 0,
      }),
      /Minimum bet is 100 FLIP per spin/i,
    );
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 3, amountPerTicketWei: 10n ** 17n, ticketCount: 1, heroQuadrant: 0,
      }),
      /Minimum bet is 1 WWXRP per spin/i,
    );
    // Exactly at the minimum is a valid bet.
    await degeneretteMod.placeBet({
      currency: 1, amountPerTicketWei: 100n * 10n ** 18n, ticketCount: 1, heroQuadrant: 0,
    });
  });

  test('rejects currency 2 (unsupported) client-side', async () => {
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 2,
        amountPerTicketWei: 10n ** 16n,
        ticketCount: 1,
        customTicket: 0,
        heroQuadrant: 0,
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
        heroQuadrant: 0,
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
        heroQuadrant: 0,
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
        heroQuadrant: 0,
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
// Fresh-state + community resolver — clicked bet is the race probe at item 0.
// ===========================================================================

describe('degenerette fresh-state and community resolution', () => {
  let fake;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    fake = makeFakeContract({ betInfo: 0x1234n });
    degeneretteMod.__setContractFactoryForTest(() => fake);
  });

  afterEach(() => {
    degeneretteMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('readBetInfo checks the named owner and exact bet id', async () => {
    assert.equal(
      await degeneretteMod.readBetInfo({ player: CONNECTED, betId: 42 }),
      0x1234n,
    );
    assert.deepEqual(fake._calls.degeneretteBetInfo, [[CONNECTED, 42n]]);
  });

  test('community batch keeps the clicked bet first and dedupes its tail', async () => {
    const other = '0xcd34000000000000000000000000000000000000';
    const result = await degeneretteMod.resolveCommunityBets({
      player: CONNECTED,
      betId: 42,
      candidates: [
        { player: other, betId: 9 },
        { player: CONNECTED.toUpperCase(), betId: 42 },
        { player: other, betId: 9 },
      ],
    });

    assert.deepEqual(
      fake._calls.degeneretteResolve,
      [[[CONNECTED, other], [42n, 9n]]],
      'item zero is the clicked race probe; stale duplicate candidates are omitted',
    );
    assert.deepEqual(result.players, [CONNECTED, other]);
    assert.deepEqual(result.betIds, [42n, 9n]);
    assert.deepEqual(fake._order, ['static:degeneretteResolve', 'send:degeneretteResolve']);
  });

  test('already-resolved spins can be replayed directly from exact chain-event topics', async () => {
    const queries = [];
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getBlockNumber: async () => 5000,
    });
    const eventContract = {
      filters: {
        DegeneretteResolved: (player, betId) => ({ event: 'resolved', player, betId }),
        DegeneretteResult: (player, betId) => ({ event: 'result', player, betId }),
      },
      queryFilter: async (filter, from, to) => {
        queries.push({ filter, from, to });
        if (filter.event === 'resolved') {
          return [{
            args: {
              player: CONNECTED,
              betId: 42n,
              spinCount: 1,
              totalPayout: 5n,
              resultTraits: 13n,
            },
          }];
        }
        return [{
          args: {
            player: CONNECTED,
            betId: 42n,
            spinIndex: 0,
            playerTraits: 21n,
            matches: 4,
            payout: 5n,
          },
        }];
      },
    };
    degeneretteMod.__setContractFactoryForTest(() => eventContract);

    const replay = await degeneretteMod.readResolvedBet({ player: CONNECTED, betId: 42 });
    assert.equal(replay.resolved.totalPayout, 5n);
    assert.equal(replay.resolved.resultTraits, 13n);
    assert.equal(replay.spins.length, 1);
    assert.equal(replay.spins[0].playerTraits, 21n);
    assert.equal(queries.length, 2);
    assert.ok(queries.every((query) => query.to - query.from < 1800));
    assert.ok(queries.every((query) => query.filter.player === CONNECTED));
    assert.ok(queries.every((query) => query.filter.betId === 42n));
  });

  test('chain replay refuses duplicate spin indexes that leave a later spin missing', async () => {
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getBlockNumber: async () => 5000,
    });
    const eventContract = {
      filters: {
        DegeneretteResolved: (player, betId) => ({ event: 'resolved', player, betId }),
        DegeneretteResult: (player, betId) => ({ event: 'result', player, betId }),
      },
      queryFilter: async (filter) => {
        if (filter.event === 'resolved') {
          return [{
            args: {
              player: CONNECTED,
              betId: 42n,
              spinCount: 2,
              totalPayout: 5n,
              resultTraits: 13n,
            },
          }];
        }
        return [
          {
            args: {
              player: CONNECTED,
              betId: 42n,
              spinIndex: 0,
              playerTraits: 21n,
              matches: 4,
              payout: 5n,
            },
          },
          {
            args: {
              player: CONNECTED,
              betId: 42n,
              spinIndex: 0,
              playerTraits: 22n,
              matches: 0,
              payout: 0n,
            },
          },
        ];
      },
    };
    degeneretteMod.__setContractFactoryForTest(() => eventContract);

    const replay = await degeneretteMod.readResolvedBet({ player: CONNECTED, betId: 42 });
    assert.equal(replay, null, 'spin 1 must exist before a two-spin reveal is staged');
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

  test('parseBetResolvedFromReceipt returns DegeneretteResolved entries', () => {
    const receipt = makeFakeReceipt([
      {
        parsed: {
          name: 'DegeneretteResolved',
          args: {
            player: CONNECTED,
            betId: 42n,
            spinCount: 3,
            totalPayout: 5n * 10n ** 16n,
            resultTraits: 1234n,
          },
        },
      },
    ]);
    const fakeContract = { interface: { parseLog: (log) => log.parsed ?? null } };
    const out = degeneretteMod.parseBetResolvedFromReceipt(receipt, fakeContract);
    assert.equal(out.length, 1);
    assert.equal(out[0].player, CONNECTED);
    assert.equal(out[0].betId, 42n);
    assert.equal(out[0].spinCount, 3n);
    assert.equal(out[0].totalPayout, 5n * 10n ** 16n);
    assert.equal(out[0].resultTraits, 1234n);
  });

  test('parseSpinResultsFromReceipt returns DegeneretteResult per-spin entries', () => {
    const receipt = makeFakeReceipt([
      {
        parsed: {
          name: 'DegeneretteResult',
          args: {
            player: CONNECTED,
            betId: 42n,
            spinIndex: 0,
            playerTraits: 1234n,
            matches: 4,
            payout: 1n * 10n ** 16n,
          },
        },
      },
      {
        parsed: {
          name: 'DegeneretteResult',
          args: {
            player: CONNECTED,
            betId: 42n,
            spinIndex: 1,
            playerTraits: 5678n,
            matches: 2,
            payout: 0n,
          },
        },
      },
    ]);
    const fakeContract = { interface: { parseLog: (log) => log.parsed ?? null } };
    const out = degeneretteMod.parseSpinResultsFromReceipt(receipt, fakeContract);
    assert.equal(out.length, 2);
    assert.equal(out[0].matches, 4n);
    assert.equal(out[0].payout, 1n * 10n ** 16n);
    assert.equal(out[1].matches, 2n);
    assert.equal(out[1].payout, 0n);
  });

  // The regression that made all of this dead: production logs carry
  // topics+data, not a `parsed` property. With no parser injected the module
  // must decode them off its own ABI.
  test('parsers decode REAL encoded logs with no injected parser', async () => {
    const { ethers } = await import('ethers');
    const iface = new ethers.Interface([
      'event DegeneretteResolved(address indexed player, uint64 indexed betId, uint8 spinCount, uint256 totalPayout, uint32 resultTraits)',
      'event DegeneretteResult(address indexed player, uint64 indexed betId, uint8 spinIndex, uint32 playerTraits, uint8 matches, uint256 payout)',
    ]);
    const enc = (name, args) => {
      const { data, topics } = iface.encodeEventLog(iface.getEvent(name), args);
      return { data, topics, address: '0x0000000000000000000000000000000000000001' };
    };
    const receipt = {
      status: 1,
      logs: [
        enc('DegeneretteResolved', [CONNECTED, 42n, 2, 7n * 10n ** 15n, 1234]),
        enc('DegeneretteResult', [CONNECTED, 42n, 0, 1234, 4, 7n * 10n ** 15n]),
        enc('DegeneretteResult', [CONNECTED, 42n, 1, 1234, 0, 0n]),
      ],
    };

    const resolved = degeneretteMod.parseBetResolvedFromReceipt(receipt);
    assert.equal(resolved.length, 1, 'resolved entry decoded from a real log');
    assert.equal(resolved[0].spinCount, 2n);
    assert.equal(resolved[0].totalPayout, 7n * 10n ** 15n);
    assert.equal(resolved[0].resultTraits, 1234n);

    const spins = degeneretteMod.parseSpinResultsFromReceipt(receipt);
    assert.equal(spins.length, 2, 'both per-spin entries decoded');
    assert.equal(spins[0].spinIndex, 0n);
    assert.equal(spins[0].matches, 4n);
    assert.equal(spins[1].payout, 0n);

    // A log from another contract/event must not throw or leak through.
    const foreign = { status: 1, logs: [{ data: '0x', topics: ['0x' + '11'.repeat(32)] }] };
    assert.deepEqual(degeneretteMod.parseBetResolvedFromReceipt(foreign), []);
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
    assert.deepEqual(degeneretteMod.parseSpinResultsFromReceipt({ logs: [] }, fakeContract), []);
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

  test('payable preflight carries the same ETH value as the wallet send', () => {
    assert.match(
      SRC,
      /requireStaticCall\([\s\S]*?'placeDegeneretteBet'[\s\S]*?\[buyer, cur, amount, tc, ct, hq, \{ value \}\]/,
      'ETH bets must not be simulated with msg.value=0',
    );
  });

  test('canonical ABI: resolveDegeneretteBets signature', () => {
    assert.ok(
      SRC.includes('function resolveDegeneretteBets(address player, uint64[] calldata betIds) external'),
      'canonical resolveDegeneretteBets ABI fragment present',
    );
  });

  // Event names are the 2026-07-29 fix: the module emits DegeneretteResolved /
  // DegeneretteResult (checked against degenerus-sim/deployments/abis/
  // GAME_DEGENERETTE_MODULE.json). The old FullTicket* names matched no topic,
  // so every resolve parsed as zero events.
  test('canonical event ABIs: BetPlaced + DegeneretteResolved + DegeneretteResult', () => {
    assert.ok(SRC.includes('event BetPlaced(address indexed player, uint32 indexed index, uint64 indexed betId, uint256 packed)'));
    assert.ok(SRC.includes('event DegeneretteResolved(address indexed player, uint64 indexed betId, uint8 spinCount, uint256 totalPayout, uint32 resultTraits)'));
    assert.ok(SRC.includes('event DegeneretteResult(address indexed player, uint64 indexed betId, uint8 spinIndex, uint32 playerTraits, uint8 matches, uint256 payout)'));
    // Comments still name the old events (they explain the fix); code must not.
    const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/FullTicket/.test(stripped), 'no stale FullTicket* event names in code');
  });

  test('reason-map registers input errors plus the public-resolver race signal', () => {
    const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const registers = stripped.match(/register\s*\(/g) || [];
    assert.equal(registers.length, 3, `exactly 3 register calls expected, got ${registers.length}`);
    assert.ok(/register\(\s*['"]InvalidBet['"]/.test(stripped));
    assert.ok(/register\(\s*['"]UnsupportedCurrency['"]/.test(stripped));
    assert.ok(/register\(\s*['"]BatchAlreadyTaken['"]/.test(stripped));
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

  test('exports placement, both resolver paths, fresh-state read, parsers, and receiptParser', () => {
    assert.ok(/export\s+async\s+function\s+placeBet\b/.test(SRC));
    assert.ok(/export\s+async\s+function\s+resolveBets\b/.test(SRC));
    assert.ok(/export\s+async\s+function\s+readBetInfo\b/.test(SRC));
    assert.ok(/export\s+async\s+function\s+readResolvedBet\b/.test(SRC));
    assert.ok(/export\s+async\s+function\s+resolveCommunityBets\b/.test(SRC));
    assert.ok(/export\s+function\s+parseBetPlacedFromReceipt\b/.test(SRC));
    assert.ok(/export\s+function\s+parseBetResolvedFromReceipt\b/.test(SRC));
    assert.ok(/export\s+function\s+parseSpinResultsFromReceipt\b/.test(SRC));
    assert.ok(/export\s+function\s+receiptParser\b/.test(SRC));
  });

  // The parsers must decode REAL logs when no parser is injected — the panel
  // used to pass a `log.parsed`-only stub, so production parsed nothing.
  test('parsers default to receiptParser() rather than requiring a contract', () => {
    assert.match(SRC, /parseBetPlacedFromReceipt\(receipt, contract = receiptParser\(\)\)/);
    assert.match(SRC, /parseBetResolvedFromReceipt\(receipt, contract = receiptParser\(\)\)/);
    assert.match(SRC, /parseSpinResultsFromReceipt\(receipt, contract = receiptParser\(\)\)/);
    assert.match(SRC, /new ethers\.Interface\(DEGENERETTE_ABI\)/);
  });

  test('imports pollRngForLootbox from lootbox.js (RESEARCH R5 OPTION B reuse)', () => {
    assert.match(
      SRC,
      /import\s+\{[^}]*pollRngForLootbox[^}]*\}\s*from\s*['"]\.\/lootbox\.js['"]/,
      'degenerette.js imports pollRngForLootbox from lootbox.js',
    );
  });
});
