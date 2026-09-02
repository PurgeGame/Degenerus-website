// /app/app/__tests__/coinflip.test.js — Phase 62 Plan 62-03 (BUY-04).
//
// Run: cd website && node --test app/app/__tests__/coinflip.test.js
//
// Tests for coinflip.js write-path module: depositCoinflip + parseCoinflipDepositFromReceipt
// + AmountLTMin + CoinflipLocked reason-map registrations.
//
// RESEARCH R3 (HIGH confidence) invalidated CONTEXT D-01 step 1's conflation of
// coinflip with degenerette. Coinflip.depositCoinflip is a SYNCHRONOUS
// FLIP deposit emitting CoinflipDeposit ONLY (Coinflip.sol:46-95). NO
// BetPlaced event in Coinflip. NO per-bet poll cycle on the deposit tx.
//
// Sources:
//  - Coinflip.sol:46  — event CoinflipDeposit(address indexed player, uint256 creditedFlip)
//  - Coinflip.sol:101 — error AmountLTMin();
//  - Coinflip.sol:102 — error CoinflipLocked();
//  - Coinflip.sol:229 — function depositCoinflip(address player, uint256 amount) external
//
// RESEARCH Q5: FLIP/DGNRS/tickets are UNSCALED on Sepolia (only ETH is /1M
// per chain-config.sepolia.js ETH_DIVISOR). Min coinflip deposit = 100 FLIP
// = 100n * 10n**18n wei.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as coinflipMod from '../coinflip.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';
import * as reasonMapMod from '../reason-map.js';
import { CHAIN, CONTRACTS } from '../chain-config.js';

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
    depositCoinflip: [],
    depositCoinflipWithCarry: [],
    setCoinflipAutoRebuy: [],
    setCoinflipAutoRebuyTakeProfit: [],
  };
  const order = [];
  const staticCallStub = (methodName) => async (..._args) => {
    order.push(`static:${methodName}`);
    if (opts.staticCallMissingSelector?.[methodName]) {
      const err = new Error('missing revert data');
      err.code = 'CALL_EXCEPTION';
      err.data = '0x';
      throw err;
    }
    if (opts.staticCallShouldRevert?.[methodName]) {
      const err = new Error('static-call revert');
      err.revert = {
        name: opts.staticCallRevertName?.[methodName] || 'AmountLTMin',
      };
      throw err;
    }
    return undefined;
  };
  const sendTxStub = (methodName) => async (..._args) => {
    order.push(`send:${methodName}`);
    if (opts.sendTxShouldRevert?.[methodName]) {
      const err = new Error('sendTx revert');
      err.revert = { name: opts.sendTxRevertName?.[methodName] || 'CoinflipLocked' };
      throw err;
    }
    return makeFakeTx(makeFakeReceipt(opts[methodName + 'Logs']));
  };

  const c = {
    depositCoinflip: Object.assign(
      async (...args) => {
        calls.depositCoinflip.push(args);
        return sendTxStub('depositCoinflip')(...args);
      },
      { staticCall: staticCallStub('depositCoinflip') }
    ),
    depositCoinflipWithCarry: Object.assign(
      async (...args) => {
        calls.depositCoinflipWithCarry.push(args);
        return sendTxStub('depositCoinflipWithCarry')(...args);
      },
      { staticCall: staticCallStub('depositCoinflipWithCarry') },
    ),
    setCoinflipAutoRebuy: Object.assign(
      async (...args) => {
        calls.setCoinflipAutoRebuy.push(args);
        return sendTxStub('setCoinflipAutoRebuy')(...args);
      },
      { staticCall: staticCallStub('setCoinflipAutoRebuy') },
    ),
    setCoinflipAutoRebuyTakeProfit: Object.assign(
      async (...args) => {
        calls.setCoinflipAutoRebuyTakeProfit.push(args);
        return sendTxStub('setCoinflipAutoRebuyTakeProfit')(...args);
      },
      { staticCall: staticCallStub('setCoinflipAutoRebuyTakeProfit') },
    ),
    interface: { parseLog: (log) => log.parsed ?? null },
    connect(_signer) { return this; },
    _calls: calls,
    _order: order,
  };
  return c;
}

function makeFakeReverseFlipContract(opts = {}) {
  const calls = { reverseFlip: [] };
  const order = [];
  const reverseFlip = Object.assign(
    async (...args) => {
      calls.reverseFlip.push(args);
      order.push('send:reverseFlip');
      return makeFakeTx(makeFakeReceipt([]));
    },
    {
      staticCall: async (..._args) => {
        order.push('static:reverseFlip');
        if (opts.staticCallShouldRevert) {
          const err = new Error('static-call revert');
          err.revert = { name: opts.staticCallRevertName || 'RngLocked' };
          throw err;
        }
      },
    },
  );
  return {
    reverseFlip,
    connect(_signer) { return this; },
    _calls: calls,
    _order: order,
  };
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
// Reason-map registrations — Plan 62-03 registers AmountLTMin + CoinflipLocked.
// Phase 60 already registered NotApproved per RESEARCH R11 — DO NOT re-register.
// ===========================================================================

describe('Plan 62-03: coinflip.js reason-map registrations', () => {
  test('registers AmountLTMin with friendly userMessage citing 100 FLIP minimum', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'AmountLTMin' },
    });
    assert.equal(decoded.code, 'AmountLTMin');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /100|minimum|FLIP/i);
  });

  test('registers CoinflipLocked with friendly userMessage citing jackpot resolution', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'CoinflipLocked' },
    });
    assert.equal(decoded.code, 'CoinflipLocked');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /locked|jackpot|few minutes/i);
  });

  test('does NOT re-register NotApproved (Phase 60 already covers per RESEARCH R11)', () => {
    const SRC = readFileSync(new URL('../coinflip.js', import.meta.url), 'utf8');
    assert.equal(
      /register\(\s*['"]NotApproved['"]/.test(SRC),
      false,
      "coinflip.js must NOT register 'NotApproved' (Phase 60 baseline)",
    );
  });
});

describe('coinflip stake reads', () => {
  afterEach(() => {
    coinflipMod.__resetCurrentStakeReaderForTest();
    coinflipMod.__resetAutoRebuyInfoReaderForTest();
    coinflipMod.__resetResolvedStakeReaderForTest();
    coinflipMod.__resetClaimableReaderForTest();
    coinflipMod.__resetBackingReaderForTest();
    coinflipMod.__resetWidgetBalancesReaderForTest();
    coinflipMod.__resetStakeReadContractFactoryForTest();
    coinflipMod.__resetCoinflipDayFetcherForTest();
    contractsMod.clearProvider();
  });

  test('effective stake adds auto-rebuy carry but never adds inactive carry', () => {
    const stored = 47_232n * 10n ** 18n;
    const carry = 9_910_102n * 10n ** 18n;
    assert.equal(
      coinflipMod.effectiveCoinflipStake(stored, { enabled: true, carry }),
      stored + carry,
    );
    assert.equal(
      coinflipMod.effectiveCoinflipStake(stored, { enabled: false, carry }),
      stored,
    );
    assert.equal(
      coinflipMod.effectiveCoinflipStake(stored, { enabled: true, carryWei: carry }),
      stored + carry,
      'the normalized settings shape uses carryWei too',
    );
  });

  test('replayed previews override stale stored auto-rebuy carry', () => {
    const unit = 10n ** 18n;
    assert.equal(
      coinflipMod.effectiveAutoRebuyCarryWei({
        claimableWei: 20_000n * unit,
        backingWei: 21_286n * unit,
        autoRebuyInfo: { enabled: true, carryWei: 1_300n * unit },
      }),
      1_286n * unit,
    );
    assert.equal(
      coinflipMod.effectiveAutoRebuyCarryWei({
        autoRebuyInfo: { enabled: false, carryWei: 1_300n * unit },
      }),
      0n,
      'disabled leftover storage is not presented as rolling stake',
    );
  });

  test('auto-rebuy display math covers pending, win, loss, full-roll, and disabled states', () => {
    const unit = 10n ** 18n;
    const cases = [
      {
        label: 'pending carry', claimable: 500n, backing: 975n, raw: 475n, expected: 475n,
      },
      {
        label: 'take-profit win', claimable: 20_000n, backing: 21_286n, raw: 1_300n, expected: 1_286n,
      },
      {
        label: 'loss clears carry', claimable: 20_000n, backing: 20_000n, raw: 1_300n, expected: 0n,
      },
      {
        label: 'zero take-profit rolls all', claimable: 0n, backing: 21_286n, raw: 1_300n, expected: 21_286n,
      },
      {
        label: 'disabled carry cashes out', claimable: 21_286n, backing: 21_286n, raw: 1_300n, expected: 0n,
        enabled: false,
      },
    ];
    for (const row of cases) {
      assert.equal(
        coinflipMod.effectiveAutoRebuyCarryWei({
          claimableWei: row.claimable * unit,
          backingWei: row.backing * unit,
          autoRebuyInfo: {
            enabled: row.enabled ?? true,
            carryWei: row.raw * unit,
          },
        }),
        row.expected * unit,
        row.label,
      );
    }
    assert.equal(
      coinflipMod.effectiveAutoRebuyCarryWei({
        autoRebuyInfo: { enabled: true, carryWei: 475n * unit },
      }),
      475n * unit,
      'a temporary preview failure retains the raw compatibility fallback',
    );
  });

  test('one display snapshot reconciles Tomorrow, Rolling Now, and Protocol Coins', async () => {
    const unit = 10n ** 18n;
    coinflipMod.__setCurrentStakeReaderForTest(async () => 1_286n * unit);
    coinflipMod.__setAutoRebuyInfoReaderForTest(async () => ({
      enabled: true,
      takeProfitWei: 10_000n * unit,
      carryWei: 1_300n * unit,
      startDay: 20,
    }));
    coinflipMod.__setClaimableReaderForTest(async () => 20_000n * unit);
    coinflipMod.__setBackingReaderForTest(async () => 21_286n * unit);
    coinflipMod.__setWidgetBalancesReaderForTest(async () => ({
      flipBalance: 165_186n * unit,
      wwxrpBalance: 0n,
      sdgnrsBalance: 0n,
    }));

    const snapshot = await coinflipMod.readCoinflipDisplaySnapshot({
      player: CONNECTED,
      blockTag: 12_345,
    });
    assert.equal(snapshot.blockTag, 12_345);
    assert.equal(snapshot.currentStakeWei, 1_286n * unit);
    assert.equal(snapshot.autoRebuyInfo.storedCarryWei, 1_300n * unit);
    assert.equal(snapshot.autoRebuyInfo.carryWei, 1_286n * unit);
    assert.equal(snapshot.claimableWei, 20_000n * unit);
    assert.equal(snapshot.backingWei, 21_286n * unit);
    assert.equal(
      coinflipMod.protocolFlipTotalWei(
        snapshot.balances.flipBalance,
        snapshot.backingWei,
      ),
      186_472n * unit,
    );
    assert.equal(snapshot.ledgerComplete, true);
  });

  test('normalizes the live auto-rebuy settings tuple', async () => {
    coinflipMod.__setAutoRebuyInfoReaderForTest(async () => [
      true,
      2_000n * 10n ** 18n,
      475n * 10n ** 18n,
      91,
    ]);

    assert.deepEqual(
      await coinflipMod.readCoinflipAutoRebuyInfo({ player: CONNECTED }),
      {
        enabled: true,
        takeProfitWei: 2_000n * 10n ** 18n,
        carryWei: 475n * 10n ** 18n,
        startDay: 91,
      },
    );
  });

  test('reads carry-inclusive withdrawable coinflip backing', async () => {
    const backing = 675n * 10n ** 18n;
    let seenPlayer = null;
    coinflipMod.__setBackingReaderForTest(async ({ player }) => {
      seenPlayer = player;
      return String(backing);
    });

    assert.equal(
      await coinflipMod.readCoinflipBacking({ player: CONNECTED }),
      backing,
    );
    assert.equal(seenPlayer, CONNECTED);
  });

  test('live stake read includes the contract auto-rebuy carry', async () => {
    const blockTag = Number(CHAIN.deployBlock) + 500;
    const seenBlockTags = [];
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getBlockNumber: async () => blockTag,
    });
    coinflipMod.__setStakeReadContractFactoryForTest(() => ({
      coinflipAmount: async (_player, overrides) => {
        seenBlockTags.push(overrides?.blockTag);
        return 47_232n * 10n ** 18n;
      },
      coinflipAutoRebuyInfo: async (_player, overrides) => {
        seenBlockTags.push(overrides?.blockTag);
        return [true, 0n, 9_910_102n * 10n ** 18n, 20];
      },
    }));

    assert.equal(
      await coinflipMod.readCurrentCoinflipStake({ player: CONNECTED }),
      9_957_334n * 10n ** 18n,
    );
    assert.deepEqual(seenBlockTags, [blockTag, blockTag],
      'stored credit and carry come from one atomic chain snapshot');
  });

  test('live stake replays a resolved win instead of showing stale raw carry', async () => {
    const unit = 10n ** 18n;
    const blockTag = Number(CHAIN.deployBlock) + 501;
    const seen = [];
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getBlockNumber: async () => blockTag,
    });
    coinflipMod.__setStakeReadContractFactoryForTest(() => ({
      coinflipAmount: async (_player, overrides) => {
        seen.push(['stored', overrides?.blockTag]);
        return 0n;
      },
      // Storage has not been settled yet and still reports the previous 1,300
      // carry—the exact stale-state shape that produced a zero/old Tomorrow row.
      coinflipAutoRebuyInfo: async (_player, overrides) => {
        seen.push(['raw-carry', overrides?.blockTag]);
        return [true, 10_000n * unit, 1_300n * unit, 20];
      },
      previewClaimCoinflips: async (_player, overrides) => {
        seen.push(['claimable', overrides?.blockTag]);
        return 20_000n * unit;
      },
      previewSalvageFlipBacking: async (_player, overrides) => {
        seen.push(['backing', overrides?.blockTag]);
        return 21_286n * unit;
      },
    }));

    assert.equal(
      await coinflipMod.readCurrentCoinflipStake({ player: CONNECTED }),
      1_286n * unit,
      '21,286 payout minus two 10,000 take-profit chunks leaves 1,286 live',
    );
    assert.deepEqual(seen, [
      ['stored', blockTag],
      ['raw-carry', blockTag],
      ['claimable', blockTag],
      ['backing', blockTag],
    ], 'all four legs share one chain snapshot');
  });

  test('resolved sDGNRS stake adds the carry state from before that resolution', async () => {
    const base = Number(CHAIN.deployBlock);
    const previousResolution = { blockNumber: base + 100, index: 8 };
    const priorState = {
      blockNumber: base + 150,
      index: 12,
      args: { autoRebuyCarry: 4_614_766n * 10n ** 18n },
    };
    const stakeUpdate = {
      blockNumber: base + 250,
      index: 4,
      args: { newTotal: 47_001n * 10n ** 18n },
    };
    const resolution = { blockNumber: base + 300, index: 20 };
    const postResolutionState = {
      blockNumber: base + 300,
      index: 22,
      args: { autoRebuyCarry: 9_910_102n * 10n ** 18n },
    };
    const contract = {
      filters: {
        CoinflipDayResolved: (day) => ({ type: 'resolved', day: Number(day) }),
        CoinflipStakeUpdated: (player, day) => ({
          type: 'stake', player: String(player).toLowerCase(), day: Number(day),
        }),
        CoinflipClaimState: (player) => ({
          type: 'state', player: String(player).toLowerCase(),
        }),
      },
      coinflipAutoRebuyInfo: async () => [true, 0n, postResolutionState.args.autoRebuyCarry, 20],
      queryFilter: async (filter, from, to) => {
        let logs = [];
        if (filter.type === 'resolved' && filter.day === 167) logs = [previousResolution];
        if (filter.type === 'resolved' && filter.day === 168) logs = [resolution];
        if (filter.type === 'stake' && filter.day === 168) logs = [stakeUpdate];
        if (filter.type === 'state') logs = [priorState, postResolutionState];
        return logs.filter((log) => log.blockNumber >= from && log.blockNumber <= to);
      },
    };
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getBlockNumber: async () => base + 400,
    });
    coinflipMod.__setStakeReadContractFactoryForTest(() => contract);
    // readResolvedCoinflipStake is API-first now — force the fetch to throw so
    // this test deterministically exercises the (still-correct) chain fallback.
    coinflipMod.__setCoinflipDayFetcherForTest(async () => { throw new Error('offline'); });

    assert.equal(
      await coinflipMod.readResolvedCoinflipStake({ player: CONTRACTS.SDGNRS, day: 168 }),
      4_661_767n * 10n ** 18n,
      'uses the pre-resolution carry, never the larger post-resolution carry',
    );
  });

  test('resolved stake replays multi-day auto-rebuy carry at the pre-resolution block', async () => {
    const unit = 10n ** 18n;
    const base = Number(CHAIN.deployBlock);
    const previousResolution = { blockNumber: base + 100, index: 8 };
    const stakeUpdate = {
      blockNumber: base + 250,
      index: 4,
      args: { newTotal: 86_906n * unit },
    };
    const resolution = { blockNumber: base + 300, index: 20 };
    const seen = [];
    const contract = {
      filters: {
        CoinflipDayResolved: (day) => ({ type: 'resolved', day: Number(day) }),
        CoinflipStakeUpdated: (player, day) => ({
          type: 'stake', player: String(player).toLowerCase(), day: Number(day),
        }),
        CoinflipClaimState: (player) => ({
          type: 'state', player: String(player).toLowerCase(),
        }),
      },
      previewClaimCoinflips: async (player, overrides) => {
        seen.push(['claimable', player, overrides?.blockTag]);
        return 1_467_374n * unit;
      },
      previewSalvageFlipBacking: async (player, overrides) => {
        seen.push(['backing', player, overrides?.blockTag]);
        return (1_467_374n + 919_901n) * unit;
      },
      queryFilter: async (filter, from, to) => {
        let logs = [];
        if (filter.type === 'resolved' && filter.day === 168) logs = [previousResolution];
        if (filter.type === 'resolved' && filter.day === 169) logs = [resolution];
        if (filter.type === 'stake' && filter.day === 169) logs = [stakeUpdate];
        return logs.filter((log) => log.blockNumber >= from && log.blockNumber <= to);
      },
    };
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getBlockNumber: async () => base + 400,
    });
    coinflipMod.__setStakeReadContractFactoryForTest(() => contract);
    coinflipMod.__setCoinflipDayFetcherForTest(async () => { throw new Error('offline'); });

    assert.equal(
      await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 169 }),
      1_006_807n * unit,
      'Today’s Bet includes the carry produced by every prior unclaimed rebuy day',
    );
    assert.deepEqual(seen, [
      ['claimable', CONNECTED, base + 299],
      ['backing', CONNECTED, base + 299],
    ], 'both replay views use the same block immediately before resolution');
  });

  test('returns the contract-scoped current-day stake as bigint', async () => {
    let seenPlayer = null;
    coinflipMod.__setCurrentStakeReaderForTest(async ({ player }) => {
      seenPlayer = player;
      return '12000000000000000000000';
    });

    const stake = await coinflipMod.readCurrentCoinflipStake({ player: CONNECTED });
    assert.equal(seenPlayer, CONNECTED);
    assert.equal(stake, 12_000n * 10n ** 18n);
  });

  test('returns null when the current-day stake read is unavailable', async () => {
    coinflipMod.__setCurrentStakeReaderForTest(async () => {
      throw new Error('rpc unavailable');
    });
    assert.equal(await coinflipMod.readCurrentCoinflipStake({ player: CONNECTED }), null);
  });

  test('shares concurrent current-day reads for the same player', async () => {
    let calls = 0;
    let finish;
    coinflipMod.__setCurrentStakeReaderForTest(() => {
      calls += 1;
      return new Promise((resolve) => { finish = resolve; });
    });

    const first = coinflipMod.readCurrentCoinflipStake({ player: CONNECTED });
    const second = coinflipMod.readCurrentCoinflipStake({ player: CONNECTED });
    assert.equal(calls, 1, 'only one mutable chain read is in flight');
    finish('12000000000000000000000');
    assert.deepEqual(await Promise.all([first, second]), [
      12_000n * 10n ** 18n,
      12_000n * 10n ** 18n,
    ]);
  });

  test('returns and caches the final cumulative credit for one resolved day', async () => {
    let calls = 0;
    let args = null;
    coinflipMod.__setResolvedStakeReaderForTest(async (received) => {
      calls += 1;
      args = received;
      return '64857550066086392458598';
    });

    const first = await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 309 });
    const second = await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 309 });
    assert.deepEqual(args, { player: CONNECTED, day: 309 });
    assert.equal(first, 64857550066086392458598n);
    assert.equal(second, first);
    assert.equal(calls, 1, 'immutable player/day result is cached');
  });

  test('shares concurrent historical reads and persists the immutable result', async () => {
    let calls = 0;
    let finish;
    coinflipMod.__setResolvedStakeReaderForTest(() => {
      calls += 1;
      return new Promise((resolve) => { finish = resolve; });
    });

    const first = coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 310 });
    const second = coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 310 });
    assert.equal(calls, 1, 'only one historical scan is in flight');
    finish('9000000000000000000000');
    assert.deepEqual(await Promise.all([first, second]), [
      9_000n * 10n ** 18n,
      9_000n * 10n ** 18n,
    ]);
  });

  test('restores an immutable resolved stake from browser storage without RPC', async () => {
    const priorStorage = globalThis.localStorage;
    const values = new Map([
      [`coinflip_resolved_stake_v3:84532:${CONNECTED}:311`, '7000000000000000000000'],
    ]);
    globalThis.localStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    };
    coinflipMod.__resetResolvedStakeReaderForTest();
    try {
      assert.equal(
        await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 311 }),
        7_000n * 10n ** 18n,
      );
    } finally {
      if (priorStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = priorStorage;
    }
  });

  test('resolved day from the API with playerStake skips the CoinflipStakeUpdated lookup entirely', async () => {
    const unit = 10n ** 18n;
    const base = Number(CHAIN.deployBlock);
    const seen = [];
    let queryFilterCalls = 0;
    const contract = {
      filters: {
        CoinflipStakeUpdated: () => ({ type: 'stake' }),
        CoinflipDayResolved: () => ({ type: 'resolved' }),
        CoinflipClaimState: () => ({ type: 'state' }),
      },
      previewClaimCoinflips: async (player, overrides) => {
        seen.push(['claimable', overrides?.blockTag]);
        return 1_467_374n * unit;
      },
      previewSalvageFlipBacking: async (player, overrides) => {
        seen.push(['backing', overrides?.blockTag]);
        return (1_467_374n + 919_901n) * unit;
      },
      queryFilter: async () => { queryFilterCalls += 1; return []; },
    };
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    coinflipMod.__setStakeReadContractFactoryForTest(() => contract);
    coinflipMod.__setCoinflipDayFetcherForTest(async (path) => {
      assert.equal(path, `/coinflip/day/169?player=${CONNECTED}`);
      return {
        win: true,
        rewardPercent: 120,
        blockNumber: base + 300,
        previousResolvedBlock: base + 100,
        playerStake: '86906000000000000000000',
        playerStakeBlock: base + 250,
      };
    });

    assert.equal(
      await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 169 }),
      1_006_807n * unit,
      'stored stake comes straight from the API playerStake; carry replays the same preview pair',
    );
    assert.deepEqual(seen, [
      ['claimable', base + 299],
      ['backing', base + 299],
    ]);
    assert.equal(
      queryFilterCalls,
      0,
      'no CoinflipDayResolved or CoinflipStakeUpdated scan runs when playerStake is present',
    );
  });

  test('resolved day from the API without playerStake runs one bounded CoinflipStakeUpdated lookup and never walks CoinflipDayResolved', async () => {
    const unit = 10n ** 18n;
    const base = Number(CHAIN.deployBlock);
    const stakeUpdate = { blockNumber: base + 250, index: 4, args: { newTotal: 86_906n * unit } };
    const queries = [];
    const contract = {
      filters: {
        CoinflipStakeUpdated: (player, day) => ({
          type: 'stake', player: String(player).toLowerCase(), day: Number(day),
        }),
        CoinflipDayResolved: (day) => ({ type: 'resolved', day: Number(day) }),
        CoinflipClaimState: (player) => ({ type: 'state', player: String(player).toLowerCase() }),
      },
      previewClaimCoinflips: async () => 1_467_374n * unit,
      previewSalvageFlipBacking: async () => (1_467_374n + 919_901n) * unit,
      queryFilter: async (filter, from, to) => {
        queries.push({ filter, from, to });
        const logs = filter.type === 'stake' && filter.day === 169 ? [stakeUpdate] : [];
        return logs.filter((log) => log.blockNumber >= from && log.blockNumber <= to);
      },
    };
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    coinflipMod.__setStakeReadContractFactoryForTest(() => contract);
    coinflipMod.__setCoinflipDayFetcherForTest(async () => ({
      win: true,
      blockNumber: base + 300,
      previousResolvedBlock: base + 100,
      playerStake: null,
    }));

    assert.equal(
      await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 169 }),
      1_006_807n * unit,
    );
    assert.ok(
      queries.every((q) => q.filter.type === 'stake'),
      'the API already supplied both resolution blocks — no CoinflipDayResolved walk runs',
    );
    assert.equal(queries.length, 1, 'a single bounded queryFilter call, not a chunked deploy-to-head walk');
  });

  test('an unresolved day from the API returns null and memoizes it in-memory for 60s', async () => {
    let fetchCalls = 0;
    coinflipMod.__setCoinflipDayFetcherForTest(async () => {
      fetchCalls += 1;
      return { win: null, blockNumber: null, previousResolvedBlock: null, playerStake: null };
    });

    assert.equal(await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 999 }), null);
    assert.equal(fetchCalls, 1);
    assert.equal(await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 999 }), null);
    assert.equal(fetchCalls, 1, 'the 60s negative memo skips the second fetch for the same unresolved day');
  });

  test('an API throw falls back to a 20-chunk-bounded chain scan and memoizes the failure 5 minutes', async () => {
    const unit = 10n ** 18n;
    const base = Number(CHAIN.deployBlock);
    const head = base + 100_000;
    const boundedFloor = head - 20 * 1_800; // RESOLVED_DAY_FALLBACK_LOOKBACK_CHUNKS * LOG_CHUNK_BLOCKS
    const previousResolution = { blockNumber: boundedFloor + 500, index: 1 };
    const stakeUpdate = {
      blockNumber: boundedFloor + 1_400, index: 2, args: { newTotal: 5_000n * unit },
    };
    const resolution = { blockNumber: boundedFloor + 1_500, index: 3 };
    const queries = [];
    const contract = {
      filters: {
        CoinflipDayResolved: (day) => ({ type: 'resolved', day: Number(day) }),
        CoinflipStakeUpdated: (player, day) => ({
          type: 'stake', player: String(player).toLowerCase(), day: Number(day),
        }),
        CoinflipClaimState: (player) => ({ type: 'state', player: String(player).toLowerCase() }),
      },
      previewClaimCoinflips: async () => 100n * unit,
      previewSalvageFlipBacking: async () => 100n * unit,
      queryFilter: async (filter, from, to) => {
        queries.push({ filter, from, to });
        let logs = [];
        if (filter.type === 'resolved' && filter.day === 41) logs = [resolution];
        if (filter.type === 'resolved' && filter.day === 40) logs = [previousResolution];
        if (filter.type === 'stake' && filter.day === 41) logs = [stakeUpdate];
        return logs.filter((log) => log.blockNumber >= from && log.blockNumber <= to);
      },
    };
    contractsMod.setProvider({ ...makeFakeProvider(CONNECTED), getBlockNumber: async () => head });
    coinflipMod.__setStakeReadContractFactoryForTest(() => contract);
    let apiCalls = 0;
    coinflipMod.__setCoinflipDayFetcherForTest(async () => {
      apiCalls += 1;
      throw new Error('API unavailable');
    });

    assert.equal(
      await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 41 }),
      5_000n * unit,
    );
    assert.equal(apiCalls, 1);
    const resolvedQueries = queries.filter((q) => q.filter.type === 'resolved');
    assert.ok(resolvedQueries.length > 0, 'sanity: the resolved-day scan actually ran');
    assert.ok(
      resolvedQueries.every((q) => q.from >= boundedFloor),
      'the CoinflipDayResolved walk never crosses the 36,000-block lookback floor',
    );
    assert.equal(
      Math.min(...resolvedQueries.map((q) => q.from)),
      boundedFloor,
      'the walk is bounded to the lookback floor, not the deploy block',
    );

    // A second call (a different, uncached day) inside the 5-minute window must
    // not retry the API — only the bounded chain fallback may run.
    assert.equal(await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 42 }), null);
    assert.equal(apiCalls, 1, 'the API circuit breaker skips the fetch while memoized');

    coinflipMod.__expireCoinflipDayFallbackMemoForTest();
    await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 43 });
    assert.equal(apiCalls, 2, 'the next poll after the memo expires retries the API');
  });
});

// ===========================================================================
// reverseFlip quote + GAME write path.
// ===========================================================================

describe('reverseFlip quote and action', () => {
  const F = 10n ** 18n;

  afterEach(() => {
    coinflipMod.__resetReverseFlipQuoteReaderForTest();
    coinflipMod.__resetReverseFlipContractFactoryForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('mirrors the contract price: 100 FLIP compounded +50% per queued nudge', () => {
    assert.equal(coinflipMod.reverseFlipCostWei(0), 100n * F);
    assert.equal(coinflipMod.reverseFlipCostWei(1), 150n * F);
    assert.equal(coinflipMod.reverseFlipCostWei(2), 225n * F);
    assert.equal(coinflipMod.reverseFlipCostWei(3), 337_500_000_000_000_000_000n);
  });

  test('normalizes and shares a live reverse-flip quote read', async () => {
    let calls = 0;
    let finish;
    coinflipMod.__setReverseFlipQuoteReaderForTest(() => {
      calls += 1;
      return new Promise((resolve) => { finish = resolve; });
    });

    const first = coinflipMod.readReverseFlipQuote();
    const second = coinflipMod.readReverseFlipQuote();
    assert.equal(calls, 1, 'one storage/lock quote is in flight');
    finish({ queued: '2', locked: false });
    assert.deepEqual(await Promise.all([first, second]), [
      { queued: 2n, costWei: 225n * F, locked: false },
      { queued: 2n, costWei: 225n * F, locked: false },
    ]);
  });

  test('static-calls GAME.reverseFlip before the closure-form transaction', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    const fake = makeFakeReverseFlipContract();
    coinflipMod.__setReverseFlipContractFactoryForTest(() => fake);

    const out = await coinflipMod.reverseFlip();
    assert.equal(out.receipt.status, 1);
    assert.equal(fake._calls.reverseFlip.length, 1, 'one reverseFlip transaction');
    assert.deepEqual(fake._order, ['static:reverseFlip', 'send:reverseFlip']);
  });

  test('RngLocked static-call failure is surfaced with useful copy and sends nothing', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    const fake = makeFakeReverseFlipContract({
      staticCallShouldRevert: true,
      staticCallRevertName: 'RngLocked',
    });
    coinflipMod.__setReverseFlipContractFactoryForTest(() => fake);

    await assert.rejects(
      coinflipMod.reverseFlip(),
      /RNG is locked|settling/i,
    );
    assert.equal(fake._calls.reverseFlip.length, 0);
    assert.deepEqual(fake._order, ['static:reverseFlip']);
  });
});

// ===========================================================================
// depositCoinflip — calls contract.depositCoinflip(player, amount).
// ===========================================================================

describe('Plan 62-03: depositCoinflip', () => {
  let lastFakeContract;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    coinflipMod.__setContractFactoryForTest(() => lastFakeContract);
  });

  afterEach(() => {
    coinflipMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('uses the carry-aware selector by default with closure-form sendTx', async () => {
    const amount = '200000000000000000000'; // 200 FLIP
    await coinflipMod.depositCoinflip({ amount });
    assert.equal(lastFakeContract._calls.depositCoinflipWithCarry.length, 1);
    assert.equal(lastFakeContract._calls.depositCoinflip.length, 0);
    const [args] = lastFakeContract._calls.depositCoinflipWithCarry;
    assert.equal(args[0], CONNECTED, 'player = connected.address');
    assert.equal(args[1], 200n * 10n ** 18n, 'amount converted to BigInt wei');
  });

  test('falls back once when a rolling deploy does not have the carry selector', async () => {
    const legacy = makeFakeContract({
      staticCallMissingSelector: { depositCoinflipWithCarry: true },
    });
    coinflipMod.__setContractFactoryForTest(() => legacy);
    const amount = 200n * 10n ** 18n;

    await coinflipMod.depositCoinflip({ amount });
    await coinflipMod.depositCoinflip({ amount });

    assert.deepEqual(legacy._order, [
      'static:depositCoinflipWithCarry',
      'static:depositCoinflip',
      'send:depositCoinflip',
      'static:depositCoinflip',
      'send:depositCoinflip',
    ]);
    assert.equal(legacy._calls.depositCoinflipWithCarry.length, 0);
    assert.equal(legacy._calls.depositCoinflip.length, 2);
  });

  test('never falls back to wallet funding when the carry selector reports RngLocked', async () => {
    const locked = makeFakeContract({
      staticCallShouldRevert: { depositCoinflipWithCarry: true },
      staticCallRevertName: { depositCoinflipWithCarry: 'RngLocked' },
    });
    coinflipMod.__setContractFactoryForTest(() => locked);

    await assert.rejects(
      coinflipMod.depositCoinflip({ amount: 200n * 10n ** 18n }),
      /RNG|settling/i,
    );
    assert.deepEqual(locked._order, ['static:depositCoinflipWithCarry']);
    assert.equal(locked._calls.depositCoinflip.length, 0);
    assert.equal(locked._calls.depositCoinflipWithCarry.length, 0);
  });

  test('a previously proven carry selector never treats stripped revert data as legacy', async () => {
    const options = {};
    const flakyRpc = makeFakeContract(options);
    coinflipMod.__setContractFactoryForTest(() => flakyRpc);
    const amount = 200n * 10n ** 18n;
    await coinflipMod.depositCoinflip({ amount });

    options.staticCallMissingSelector = { depositCoinflipWithCarry: true };
    await assert.rejects(coinflipMod.depositCoinflip({ amount }));

    assert.equal(flakyRpc._calls.depositCoinflip.length, 0,
      'an ambiguous empty revert never reaches the wallet-funded selector');
    assert.deepEqual(flakyRpc._order, [
      'static:depositCoinflipWithCarry',
      'send:depositCoinflipWithCarry',
      'static:depositCoinflipWithCarry',
    ]);
  });

  test('can explicitly retain the legacy claimable-to-wallet selector', async () => {
    const amount = 200n * 10n ** 18n;
    await coinflipMod.depositCoinflip({ amount, useCarry: false });
    assert.deepEqual(lastFakeContract._order, [
      'static:depositCoinflip',
      'send:depositCoinflip',
    ]);
  });

  test('enables auto rebuy with its take-profit chunk after a static call', async () => {
    const takeProfit = 2_500n * 10n ** 18n;
    await coinflipMod.setCoinflipAutoRebuy({ enabled: true, takeProfit });
    assert.deepEqual(lastFakeContract._calls.setCoinflipAutoRebuy, [
      [CONNECTED, true, takeProfit],
    ]);
    assert.deepEqual(lastFakeContract._order, [
      'static:setCoinflipAutoRebuy',
      'send:setCoinflipAutoRebuy',
    ]);
  });

  test('updates take profit without toggling an enabled auto rebuy', async () => {
    const takeProfit = 750n * 10n ** 18n;
    await coinflipMod.setCoinflipAutoRebuyTakeProfit({ takeProfit });
    assert.deepEqual(lastFakeContract._calls.setCoinflipAutoRebuyTakeProfit, [
      [CONNECTED, takeProfit],
    ]);
    assert.deepEqual(lastFakeContract._order, [
      'static:setCoinflipAutoRebuyTakeProfit',
      'send:setCoinflipAutoRebuyTakeProfit',
    ]);
  });

  test('rejects take profit values that would truncate into uint128 storage', async () => {
    await assert.rejects(
      coinflipMod.setCoinflipAutoRebuy({
        enabled: true,
        takeProfit: coinflipMod.MAX_AUTO_REBUY_TAKE_PROFIT_WEI + 1n,
      }),
      /too large/i,
    );
    assert.equal(lastFakeContract._calls.setCoinflipAutoRebuy.length, 0);
  });

  test('rejects amount below 100 FLIP minimum (AmountLTMin defense-in-depth)', async () => {
    await assert.rejects(
      coinflipMod.depositCoinflip({ amount: '50000000000000000000' }),
      /Minimum|100 FLIP|AmountLTMin/i,
    );
  });

  test('rejects when wallet not connected', async () => {
    storeMod.update('connected.address', null);
    contractsMod.clearProvider();
    await assert.rejects(
      coinflipMod.depositCoinflip({ amount: '200000000000000000000' }),
      /Wallet not connected/i,
    );
  });

  test('accepts amount as string and converts to BigInt', async () => {
    await coinflipMod.depositCoinflip({ amount: '500000000000000000000' });
    const [args] = lastFakeContract._calls.depositCoinflipWithCarry;
    assert.equal(args[1], 500n * 10n ** 18n, 'string amount converted to 500e18 BigInt');
  });

  test('accepts amount as bigint directly', async () => {
    await coinflipMod.depositCoinflip({ amount: 250n * 10n ** 18n });
    const [args] = lastFakeContract._calls.depositCoinflipWithCarry;
    assert.equal(args[1], 250n * 10n ** 18n);
  });

  test('parseCoinflipDepositFromReceipt returns parsed CoinflipDeposit events', () => {
    const receipt = makeFakeReceipt([
      {
        parsed: {
          name: 'CoinflipDeposit',
          args: { player: CONNECTED, creditedFlip: 350n * 10n ** 18n },
        },
      },
    ]);
    const out = coinflipMod.parseCoinflipDepositFromReceipt(receipt, lastFakeContract);
    assert.equal(out.length, 1);
    assert.equal(out[0].player, CONNECTED);
    assert.equal(out[0].creditedFlip, 350n * 10n ** 18n);
  });

  test('parseCoinflipDepositFromReceipt ignores foreign logs gracefully', () => {
    const throwingContract = {
      interface: {
        parseLog: () => { throw new Error('foreign log'); },
      },
    };
    const receipt = makeFakeReceipt([{ topics: [], data: '0x' }]);
    const out = coinflipMod.parseCoinflipDepositFromReceipt(receipt, throwingContract);
    assert.deepEqual(out, []);
  });

  test('parseCoinflipDepositFromReceipt returns empty array on null receipt', () => {
    assert.deepEqual(coinflipMod.parseCoinflipDepositFromReceipt(null, lastFakeContract), []);
    assert.deepEqual(coinflipMod.parseCoinflipDepositFromReceipt({ logs: undefined }, lastFakeContract), []);
  });

  test('static-call gate runs BEFORE sendTx — order verification', async () => {
    const reverting = makeFakeContract({
      staticCallShouldRevert: { depositCoinflipWithCarry: true },
      staticCallRevertName: { depositCoinflipWithCarry: 'AmountLTMin' },
    });
    coinflipMod.__setContractFactoryForTest(() => reverting);
    await assert.rejects(
      coinflipMod.depositCoinflip({ amount: '200000000000000000000' }),
    );
    assert.equal(
      reverting._calls.depositCoinflipWithCarry.length, 0,
      'sendTx NOT invoked when static-call gate trips',
    );
    // Order: static-call before sendTx
    assert.ok(
      reverting._order[0]?.startsWith('static:'),
      'static-call invoked first in sequence',
    );
  });
});

// ===========================================================================
// coinflip.js source-level invariants — closure form, action label, ABI canonical.
// ===========================================================================

describe('Plan 62-03: coinflip.js source-level invariants', () => {
  const SRC = readFileSync(new URL('../coinflip.js', import.meta.url), 'utf8');

  test('uses closure-form sendTx — minimum 1 occurrence', () => {
    const matches = SRC.match(/sendTx\(\s*\(s\)\s*=>/g) || [];
    assert.ok(matches.length >= 1, `expected >= 1 closure-form sendTx, got ${matches.length}`);
  });

  test('action label `Coinflip deposit` is sent to sendTx', () => {
    assert.ok(SRC.includes("'Coinflip deposit'"), 'literal action label present');
  });

  test('funding is one deposit transaction; the contract owns the complete waterfall', () => {
    assert.doesNotMatch(SRC, /claimFirst|readFlipFunding|from ['"]\.\/claims\.js['"]/,
      'the frontend must not add an obsolete preliminary claim transaction');
    assert.match(SRC, /claimableStored first, unlocked auto-rebuy carry second, then burns only/,
      'the carry-aware contract waterfall is documented beside the write path');
    assert.match(SRC, /RngLocked revert is never converted into a[\s\S]*wallet-funded deposit/,
      'the frontend must not bypass the carry safety lock with wallet FLIP');
    assert.match(SRC, /provider\.getCode\(CONTRACTS\.COINFLIP\)[\s\S]*CARRY_DEPOSIT_SELECTOR_HEX/,
      'rolling-deploy support comes from deployed bytecode rather than ambiguous revert data');
  });

  test('canonical ABI: depositCoinflip(address player, uint256 amount) external', () => {
    assert.ok(
      SRC.includes('function depositCoinflip(address player, uint256 amount) external'),
      'canonical COINFLIP_ABI fragment present',
    );
  });

  test('canonical ABI: depositCoinflipWithCarry(address player, uint256 amount) external', () => {
    assert.ok(
      SRC.includes('function depositCoinflipWithCarry(address player, uint256 amount) external'),
      'carry-aware COINFLIP_ABI fragment present',
    );
  });

  test('canonical current-stake ABI: coinflipAmount(address player)', () => {
    assert.ok(
      SRC.includes('function coinflipAmount(address player) external view returns (uint256)'),
      'current-day coinflipAmount ABI fragment present',
    );
  });

  test('canonical exact-day cumulative stake event ABI is present', () => {
    assert.ok(
      SRC.includes('event CoinflipStakeUpdated(address indexed player, uint24 indexed day, uint256 amount, uint256 newTotal)'),
      'resolved-day reader is based on the cumulative newTotal event',
    );
  });

  test('canonical event ABI: CoinflipDeposit(address indexed player, uint256 creditedFlip)', () => {
    assert.ok(
      SRC.includes('event CoinflipDeposit(address indexed player, uint256 creditedFlip)'),
      'canonical CoinflipDeposit event signature present',
    );
  });

  // Insufficient remains a useful contract-side balance failure even though
  // the current deploy consumes claimableStored before the wallet remainder.
  test('reason-map registers 3 codes (AmountLTMin + CoinflipLocked + Insufficient)', () => {
    const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const registers = stripped.match(/register\s*\(/g) || [];
    assert.equal(registers.length, 3, `exactly 3 register calls expected, got ${registers.length}`);
    assert.ok(
      /register\(\s*['"]Insufficient['"]/.test(stripped),
      'Insufficient must be registered',
    );
    assert.ok(
      /register\(\s*['"]AmountLTMin['"]/.test(stripped),
      'AmountLTMin must be registered',
    );
    assert.ok(
      /register\(\s*['"]CoinflipLocked['"]/.test(stripped),
      'CoinflipLocked must be registered',
    );
  });

  test('NO pre-resolved-promise sendTx (Phase 58 closure-form gate)', () => {
    const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(
      /sendTx\([a-zA-Z_]+\.[a-zA-Z_]+\(/.test(stripped),
      false,
      'NO pre-resolved promise sendTx pattern allowed',
    );
  });

  test('requireStaticCall invoked at least once before sendTx', () => {
    const matches = SRC.match(/requireStaticCall\(/g) || [];
    assert.ok(matches.length >= 1, `expected >= 1 requireStaticCall, got ${matches.length}`);
  });

  test('coinflip.js exports deposit, receipt parsing, and current-day stake read', () => {
    assert.ok(/export\s+async\s+function\s+depositCoinflip\b/.test(SRC));
    assert.ok(/export\s+function\s+parseCoinflipDepositFromReceipt\b/.test(SRC));
    assert.ok(/export\s+async\s+function\s+readCurrentCoinflipStake\b/.test(SRC));
    assert.ok(/export\s+async\s+function\s+readResolvedCoinflipStake\b/.test(SRC));
  });

  test('reverseFlip uses the GAME ABI, raw queued-count slot, and closure-form sendTx', () => {
    assert.ok(SRC.includes('function reverseFlip() external'));
    // run23+ generation: price-guarded overload + public quote view.
    assert.ok(SRC.includes('function reverseFlip(uint256 expectedCost) external'));
    assert.ok(SRC.includes('function rngNudgeQuote() external view returns (uint256 queued, uint256 cost)'));
    assert.ok(SRC.includes('readContractStorage(CONTRACTS.GAME, REVERSE_FLIP_STORAGE_SLOT, { provider })'));
    assert.ok(SRC.includes('BigInt(packedSlot) & UINT64_MASK'));
    // Closure-form sendTx; args carry expectedCost on v2 deploys, empty on legacy.
    assert.match(SRC, /sendTx\(\s*\(s\)\s*=>\s*_buildReverseFlipContract\(s\)\.reverseFlip\(\.\.\.args\)/);
    assert.ok(SRC.includes("'Reverse flip'"));
  });
});
