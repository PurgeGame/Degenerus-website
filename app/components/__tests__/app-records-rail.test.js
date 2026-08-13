import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.HTMLElement ||= class HTMLElement {};
globalThis.customElements ||= {
  registry: new Map(),
  get(name) { return this.registry.get(name); },
  define(name, ctor) { this.registry.set(name, ctor); },
};

const {
  accruedShareBps,
  accruedPayoutWei,
  barToBeat,
  candidateRecordPayoutWei,
  candidateClaimsRecord,
  decodeRecordClockSlot,
  fetchRecords,
  formatRecordValue,
  normalizeRecords,
  recordClaimTarget,
  recordClaimTargetForMark,
  __resetRecordsReadersForTest,
  __setRecordsReadersForTest,
  shortAddress,
  recordKindMeta,
  RECORD_KINDS,
  RECORD_KIND_FLIP,
  RECORD_KIND_SPIN,
  RECORD_KIND_LUCKBOX,
  RECORD_KIND_BUY,
} = await import('../../app/records.js');

const {
  addressMonogram,
  addressHue,
  formatCompactBountyWei,
  formatCompactRecordValue,
  BIGGEST_SPIN_MAX_SPINS,
  BIGGEST_SPIN_PRICE_STEP_WEI,
  orderBiggestRecords,
  parseRecordBountyEthInput,
  recordBountyActivationDetail,
  recordBountySpinSelection,
  recordBountyTransactionQuote,
} = await import('../app-records-rail.js');
const { ETH_DIVISOR } = await import('../../app/chain-config.js');

const INDEX = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../styles/records-rail.css', import.meta.url), 'utf8');
const COMPONENT = readFileSync(new URL('../app-records-rail.js', import.meta.url), 'utf8');
const DATA = readFileSync(new URL('../../app/records.js', import.meta.url), 'utf8');
// Discord identity moved to app/profiles.js so chain-free components can use it.
const PROFILES = readFileSync(new URL('../../app/profiles.js', import.meta.url), 'utf8');

const FLIP = 10n ** 18n;

describe('record claim bar', () => {
  // Coinflip.sol:872 — `(candidate - mark) * RECORD_BEAT_DIV >= mark`.
  const contractClaims = (candidate, mark) => (candidate - mark) * 5n >= mark;

  test('is the smallest candidate the contract predicate accepts', () => {
    for (const mark of [1n, 4n, 5n, 6n, 7n, 9n, 10n, 99n, 100n, 1240n, 200_000n * FLIP]) {
      const bar = barToBeat(mark);
      assert.ok(contractClaims(bar, mark), `bar ${bar} should claim against ${mark}`);
      assert.ok(!contractClaims(bar - 1n, mark), `bar-1 ${bar - 1n} must NOT claim against ${mark}`);
    }
  });

  test('floors nothing — a mark not divisible by five rounds the fifth UP', () => {
    // mark + mark/5 would give 8 here, and 8 does not clear the contract bar.
    assert.equal(barToBeat(7n), 9n);
    assert.ok(!contractClaims(8n, 7n));
    assert.equal(barToBeat(1240n), 1488n);
    assert.equal(barToBeat(100n), 120n);
  });

  test('an unset mark has no bar — the entry floor governs there', () => {
    assert.equal(barToBeat(0n), 0n);
    assert.equal(barToBeat(null), 0n);
    assert.equal(barToBeat('nonsense'), 0n);
  });

  test('the live trigger uses the open floor, then the bounty-paying +20% bar', () => {
    const open = normalizeRecords({ records: [] });
    assert.equal(recordClaimTarget(open, RECORD_KIND_FLIP), 200_000n * FLIP);
    assert.equal(candidateClaimsRecord(open, RECORD_KIND_FLIP, 199_999n * FLIP), false);
    assert.equal(candidateClaimsRecord(open, RECORD_KIND_FLIP, 200_000n * FLIP), true);

    const held = normalizeRecords({ records: [{
      kind: RECORD_KIND_BUY,
      player: '0xabc',
      value: '101',
      barToBeat: '122',
    }] });
    assert.equal(recordClaimTarget(held, RECORD_KIND_BUY), 122n);
    assert.equal(candidateClaimsRecord(held, RECORD_KIND_BUY, 121n), false);
    assert.equal(candidateClaimsRecord(held, RECORD_KIND_BUY, 122n), true);
    assert.equal(recordClaimTarget(null, RECORD_KIND_BUY), null);
    assert.equal(recordClaimTargetForMark(RECORD_KIND_BUY, 101n), 122n);
    assert.equal(recordClaimTargetForMark(RECORD_KIND_BUY, 0n), 100n);
  });
});

describe('one-confirm Biggest transaction presets', () => {
  const state = normalizeRecords({
    recordPool: String(100_000n * FLIP),
    records: [{
      kind: RECORD_KIND_BUY,
      player: '0xabc',
      value: '100',
      barToBeat: '120',
      clockDay: 10,
    }],
  });

  test('quotes the head-chain target and exact ticket cost', () => {
    const quote = recordBountyTransactionQuote({
      state,
      kind: RECORD_KIND_BUY,
      liveMarkWei: 100n,
      ticketPriceWei: 10n,
      today: 20,
    });
    assert.equal(quote.targetWei, 120n);
    assert.equal(quote.costWei, 1_200n);
    assert.equal(quote.currency, 'ETH');
    assert.equal(quote.payoutWei, 10_000n * FLIP);
  });

  test('a newer chain mark replaces a stale API target without inventing its payout', () => {
    const quote = recordBountyTransactionQuote({
      state,
      kind: RECORD_KIND_BUY,
      liveMarkWei: 125n,
      ticketPriceWei: 10n,
      today: 20,
    });
    assert.equal(quote.targetWei, 150n);
    assert.equal(quote.costWei, 1_500n);
    assert.equal(quote.payoutWei, null, 'the stale indexed clock cannot price the new mark');
  });

  test('ticket activation carries an explicit whole-ticket count into the guarded buy path', () => {
    const quote = recordBountyTransactionQuote({
      state,
      kind: RECORD_KIND_BUY,
      liveMarkWei: 100n,
      ticketPriceWei: 10n,
      today: 20,
    });
    assert.deepEqual(recordBountyActivationDetail(quote), {
      source: 'records-bounty',
      variant: 'bounty',
      submit: true,
      questType: 1,
      target: '1200',
      ticketQuantity: '120',
      purchaseKind: 'ticket',
      preferClaimable: true,
      useAfking: true,
    });
  });

  test('splits the Degenerette bounty floor across spins without ever dropping below it', () => {
    const quote = recordBountyTransactionQuote({
      state,
      kind: RECORD_KIND_SPIN,
      liveMarkWei: 1_000n * BIGGEST_SPIN_PRICE_STEP_WEI,
      today: 20,
    });
    assert.equal(quote.targetWei, 1_200n * BIGGEST_SPIN_PRICE_STEP_WEI);
    assert.equal(quote.spinCount, 1);
    assert.equal(quote.amountPerSpinWei, 1_200n * BIGGEST_SPIN_PRICE_STEP_WEI);

    const fiveSpins = recordBountySpinSelection(quote, {
      spinCount: 5,
      amountPerSpinWei: 1n,
    });
    assert.equal(fiveSpins.minimumPerSpinWei, 240n * BIGGEST_SPIN_PRICE_STEP_WEI);
    assert.equal(fiveSpins.amountPerSpinWei, 240n * BIGGEST_SPIN_PRICE_STEP_WEI,
      'a low draft clamps to the live floor');
    assert.equal(fiveSpins.costWei, 1_200n * BIGGEST_SPIN_PRICE_STEP_WEI);
    assert.deepEqual(recordBountyActivationDetail(fiveSpins), {
      source: 'records-bounty',
      variant: 'bounty',
      submit: true,
      questType: 7,
      target: String(1_200n * BIGGEST_SPIN_PRICE_STEP_WEI),
      amountPerSpin: String(240n * BIGGEST_SPIN_PRICE_STEP_WEI),
      spinCount: 5,
      preferClaimable: true,
    });
  });

  test('rounds price per spin upward to .001 ETH and submits its true total', () => {
    const quote = recordBountyTransactionQuote({
      state,
      kind: RECORD_KIND_SPIN,
      liveMarkWei: 1_000n * BIGGEST_SPIN_PRICE_STEP_WEI,
      today: 20,
    });
    const selected = recordBountySpinSelection(quote, {
      spinCount: 5,
      amountPerSpinWei: (300n * BIGGEST_SPIN_PRICE_STEP_WEI) + 1n,
    });
    assert.equal(selected.amountPerSpinWei, 301n * BIGGEST_SPIN_PRICE_STEP_WEI);
    assert.equal(selected.costWei, 1_505n * BIGGEST_SPIN_PRICE_STEP_WEI);
    assert.equal(
      recordBountyActivationDetail(selected).target,
      String(1_505n * BIGGEST_SPIN_PRICE_STEP_WEI),
    );
    assert.equal(recordBountyActivationDetail({
      ...selected,
      amountPerSpinWei: selected.minimumPerSpinWei - 1n,
    }), null, 'the activation route rejects a below-floor total defensively');
    assert.equal(recordBountySpinSelection(quote, {
      spinCount: BIGGEST_SPIN_MAX_SPINS + 1,
    }), null);
  });

  test('rounds a divided bounty floor up to the next .001 ETH notch', () => {
    const quote = recordBountyTransactionQuote({
      state,
      kind: RECORD_KIND_SPIN,
      liveMarkWei: 1_000n * BIGGEST_SPIN_PRICE_STEP_WEI,
      today: 20,
    });
    const selected = recordBountySpinSelection({
      ...quote,
      targetWei: 1_201n * BIGGEST_SPIN_PRICE_STEP_WEI,
    }, {
      spinCount: 5,
      amountPerSpinWei: 0n,
    });
    assert.equal(selected.minimumPerSpinWei, 241n * BIGGEST_SPIN_PRICE_STEP_WEI);
    assert.equal(selected.costWei, 1_205n * BIGGEST_SPIN_PRICE_STEP_WEI);
  });

  test('parses the popup ETH field at the deployment scale without Number rounding', () => {
    assert.equal(
      parseRecordBountyEthInput('1.25'),
      (125n * 10n ** 16n) / BigInt(ETH_DIVISOR),
    );
    assert.equal(parseRecordBountyEthInput('.000000000000000001'), 1n / BigInt(ETH_DIVISOR));
    assert.equal(parseRecordBountyEthInput('.'), null);
    assert.equal(parseRecordBountyEthInput('1.0000000000000000001'), null);
  });

});

describe('record units are never interchangeable', () => {
  test('the flip record reads as whole FLIP', () => {
    const { amount, suffix } = formatRecordValue(RECORD_KIND_FLIP, 500_000n * FLIP);
    assert.equal(amount, '500,000');
    assert.equal(suffix, 'FLIP');
  });

  test('spin and lootbox read as ETH', () => {
    assert.equal(formatRecordValue(RECORD_KIND_SPIN, 0n).suffix, 'ETH');
    assert.equal(formatRecordValue(RECORD_KIND_LUCKBOX, 0n).suffix, 'ETH');
  });

  test('the buy record is a PLAIN whole-ticket count, not a wei amount', () => {
    // armRecord is handed `entryQuantityScaled / (4 * QTY_SCALE)` —
    // DegenerusGameFoilPackModule.sol:199-202 — so no divisor applies here.
    const { amount, suffix } = formatRecordValue(RECORD_KIND_BUY, 1240n);
    assert.equal(amount, '1,240');
    assert.equal(suffix, 'TICKETS');
  });

  test('compact poker bounties keep roughly two significant figures', () => {
    assert.equal(formatCompactBountyWei(987n * FLIP), '990');
    assert.equal(formatCompactBountyWei(1_234n * FLIP), '1.2K');
    assert.equal(formatCompactBountyWei(12_345n * FLIP), '12K');
    assert.equal(formatCompactBountyWei(987_654n * FLIP), '990K');
    assert.equal(formatCompactBountyWei(999_999n * FLIP), '1M');
  });

  test('compact leaders truncate long records without overstating the exact mark', () => {
    assert.deepEqual(formatCompactRecordValue(RECORD_KIND_BUY, 3_968n), {
      amount: '3.9K',
      suffix: 'TIX',
    });
    assert.deepEqual(formatCompactRecordValue(RECORD_KIND_FLIP, 8_497_000n * FLIP), {
      amount: '8.4M',
      suffix: 'FLIP',
    });
    assert.equal(formatRecordValue(RECORD_KIND_BUY, 3_968n).amount, '3,968',
      'the expanded card keeps the exact record');
    assert.deepEqual(formatCompactRecordValue(RECORD_KIND_BUY, 100n), {
      amount: '100',
      suffix: 'TIX',
    });
    assert.deepEqual(formatCompactRecordValue(RECORD_KIND_FLIP, 200_000n * FLIP), {
      amount: '200K',
      suffix: 'FLIP',
    }, 'open entry floors use the same compact treatment as held records');
  });

  test('the Biggest widget puts Pack Ripped third and FLIP last', () => {
    const records = [0, 1, 2, 3].map((kind) => ({ kind }));
    assert.deepEqual(orderBiggestRecords(records).map((record) => record.kind), [1, 2, 3, 0]);
    assert.deepEqual(records.map((record) => record.kind), [0, 1, 2, 3],
      'display sorting does not mutate the authoritative record snapshot');
  });

  test('every kind has presentation facts and a stated entry floor', () => {
    assert.equal(RECORD_KINDS.length, 4);
    for (const meta of RECORD_KINDS) {
      assert.equal(recordKindMeta(meta.kind), meta);
      assert.ok(meta.label && meta.floorText, `kind ${meta.kind} needs a label and floor copy`);
    }
    assert.deepEqual(RECORD_KINDS.map((meta) => meta.label), [
      'BIGGEST FLIP',
      'BIGGEST DEGENERETTE',
      'BIGGEST LUCKBOX',
      'BIGGEST PACK RIPPED',
    ]);
    assert.deepEqual(RECORD_KINDS.map((meta) => meta.short), [
      'FLIP',
      'DEGENERETTE',
      'LUCKBOX',
      'PACK RIPPED',
    ]);
    assert.deepEqual(RECORD_KINDS.map((meta) => meta.floorText), [
      '200,000 FLIP',
      '1 ETH',
      '5 ETH',
      '100 TICKETS',
    ]);
    assert.equal(recordKindMeta(9), null);
  });
});

describe('normalizeRecords', () => {
  test('always yields four ordered slots, even from an empty payload', () => {
    const state = normalizeRecords(null);
    assert.equal(state.records.length, 4);
    assert.deepEqual(state.records.map((r) => r.kind), [0, 1, 2, 3]);
    assert.equal(state.recordPoolWei, 0n);
    assert.ok(state.records.every((r) => r.held === false && r.player === null));
  });

  test('marks a record held and keeps the server bar', () => {
    const state = normalizeRecords({
      recordPool: '48000',
      records: [{
        kind: 0,
        player: '0xAbCdEf0123456789012345678901234567890123',
        value: '100',
        barToBeat: '120',
        claimCount: 2,
        totalPaidFlip: '7',
      }],
    });
    const flip = state.records[0];
    assert.equal(state.recordPoolWei, 48_000n);
    assert.equal(flip.held, true);
    assert.equal(flip.player, '0xabcdef0123456789012345678901234567890123');
    assert.equal(flip.barToBeat, 120n);
    assert.equal(flip.claimCount, 2);
    // Kinds absent from the payload still hold their slot.
    assert.equal(state.records[2].held, false);
  });

  test('recomputes the bar when an older deploy omits it', () => {
    const state = normalizeRecords({ records: [{ kind: 1, player: '0xa', value: '7' }] });
    assert.equal(state.records[1].barToBeat, 9n);
  });

  test('a zero value is never treated as held, even with a player attached', () => {
    const state = normalizeRecords({ records: [{ kind: 3, player: '0xdead', value: '0' }] });
    assert.equal(state.records[3].held, false);
    assert.equal(state.records[3].player, null);
  });

  test('an authoritative live pool overrides the older API snapshot', () => {
    const state = normalizeRecords({ recordPool: '48000' }, 36_000n);
    assert.equal(state.recordPoolWei, 36_000n);
  });

  test('authoritative packed clocks fill null API rows and override stale indexed clocks', () => {
    const state = normalizeRecords({
      records: [
        { kind: 0, player: '0xa', value: '1', clockDay: null },
        { kind: 1, player: '0xb', value: '1', clockDay: 2 },
      ],
    }, null, [8, 5, 3, 6]);
    assert.deepEqual(state.records.map((record) => record.clockDay), [8, 5, 3, 6]);
  });

  test('a newly claimed chain mark replaces the stale indexed amount', () => {
    const state = normalizeRecords({
      records: [{
        kind: RECORD_KIND_SPIN,
        player: '0xoldholder',
        value: '100',
        barToBeat: '120',
        clockDay: 10,
      }],
    }, null, [null, 14, null, null], [0n, 125n, 0n, 0n]);
    const spin = state.records[RECORD_KIND_SPIN];
    assert.equal(spin.value, 125n, 'the mined mark is visible before the indexer catches up');
    assert.equal(spin.barToBeat, 150n, 'the next target follows the authoritative mark');
    assert.equal(spin.clockDay, 14);
    assert.equal(spin.player, null,
      'the previous indexed holder is not mislabeled as owner of the new mark');
  });
});

describe('live bounty pool', () => {
  test('decodes all four uint24 clocks from Coinflip storage slot 4', () => {
    const packed = 9n
      | (8n << 32n)
      | (5n << 56n)
      | (3n << 80n)
      | (6n << 104n);
    assert.deepEqual(decodeRecordClockSlot(`0x${packed.toString(16)}`), [8, 5, 3, 6]);
  });

  test('fetches record history from the API but the displayed pool from chain', async () => {
    let requested = null;
    __setRecordsReadersForTest({
      json: async (path) => {
        requested = path;
        return { recordPool: '48000', records: [] };
      },
      pool: async () => 36_000n,
    });
    try {
      const state = await fetchRecords();
      assert.equal(requested, '/records');
      assert.equal(state.recordPoolWei, 36_000n);
    } finally {
      __resetRecordsReadersForTest();
    }
  });

  test('fetches the exact per-record clocks alongside the live pool', async () => {
    __setRecordsReadersForTest({
      json: async () => ({
        recordPool: '48000',
        records: [{ kind: 0, player: '0xa', value: '5', clockDay: null }],
      }),
      pool: async () => 36_000n,
      clocks: async () => [8, 5, 3, 6],
    });
    try {
      const state = await fetchRecords();
      assert.equal(state.recordPoolWei, 36_000n);
      assert.deepEqual(state.records.map((record) => record.clockDay), [8, 5, 3, 6]);
    } finally {
      __resetRecordsReadersForTest();
    }
  });

  test('fetches all four live marks so a claim amount updates in its mined block', async () => {
    __setRecordsReadersForTest({
      json: async () => ({
        recordPool: '48000',
        records: [{ kind: 1, player: '0xold', value: '100', clockDay: 8 }],
      }),
      pool: async () => 36_000n,
      clocks: async () => [1, 9, 1, 1],
      marks: async () => [5n, 125n, 7n, 8n],
    });
    try {
      const state = await fetchRecords();
      assert.deepEqual(state.records.map((record) => record.value), [5n, 125n, 7n, 8n]);
      assert.equal(state.records[1].player, null);
    } finally {
      __resetRecordsReadersForTest();
    }
  });

  test('keeps chain marks and pool usable while record history indexing is unavailable', async () => {
    __setRecordsReadersForTest({
      json: async () => { throw new Error('indexer restarting'); },
      pool: async () => 36_000n,
      clocks: async () => [1, 2, 3, 4],
      marks: async () => [5n, 6n, 7n, 8n],
    });
    try {
      const state = await fetchRecords();
      assert.equal(state.recordPoolWei, 36_000n);
      assert.deepEqual(state.records.map((record) => record.value), [5n, 6n, 7n, 8n]);
    } finally {
      __resetRecordsReadersForTest();
    }
  });

  test('falls back to the API pool when the chain read is unavailable', async () => {
    __setRecordsReadersForTest({
      json: async () => ({ recordPool: '48000', records: [] }),
      pool: async () => null,
    });
    try {
      assert.equal((await fetchRecords()).recordPoolWei, 48_000n);
    } finally {
      __resetRecordsReadersForTest();
    }
  });
});

describe('accrued claim share', () => {
  // Coinflip.sol:166-168 — 500 bps floor, +50 bps/day, 7500 bps ceiling.
  test('starts at the 5% floor on the day a record is stamped', () => {
    assert.equal(accruedShareBps({ held: true, clockDay: 40, today: 40 }), 500);
  });

  test('accrues half a percent per day', () => {
    assert.equal(accruedShareBps({ held: true, clockDay: 40, today: 50 }), 1000);
    assert.equal(accruedShareBps({ held: true, clockDay: 1, today: 101 }), 5500);
  });

  test('caps at 75%, reached 140 days out', () => {
    assert.equal(accruedShareBps({ held: true, clockDay: 1, today: 141 }), 7500);
    assert.equal(accruedShareBps({ held: true, clockDay: 1, today: 100_000 }), 7500);
  });

  test('never goes below the floor when the clock reads ahead of today', () => {
    // A lagging day cursor must not produce a negative accrual.
    assert.equal(accruedShareBps({ held: true, clockDay: 90, today: 40 }), 500);
  });

  test('an unhit record accrues from its constructor clock on deploy day 1', () => {
    assert.equal(accruedShareBps({ held: false, clockDay: null, today: 1 }), 500);
    assert.equal(accruedShareBps({ held: false, clockDay: null, today: 3 }), 600);
    assert.equal(accruedShareBps({ held: false, clockDay: null, today: 400 }), 7500);
    assert.equal(accruedShareBps({ held: false, clockDay: 0, today: 3 }), 600);
  });

  test('falls back to the guaranteed 5% floor when a held clock was not indexed', () => {
    assert.equal(accruedShareBps({ held: true, clockDay: null, today: 40 }), 500);
    assert.equal(accruedShareBps({ held: true, clockDay: null, today: null }), 500,
      'the guaranteed floor does not wait for the app day to finish loading');
    assert.equal(accruedShareBps({ held: true, clockDay: 40, today: null }), null);
    assert.equal(accruedPayoutWei(10n ** 24n, null), null);
  });

  test('prices the share against the pool', () => {
    const FLIP = 10n ** 18n;
    assert.equal(accruedPayoutWei(48_000n * FLIP, 2_500), 12_000n * FLIP);
    assert.equal(accruedPayoutWei(48_000n * FLIP, 0), 0n);
  });

  test('quotes a bounty only when the candidate clears the live record bar', () => {
    const state = normalizeRecords({
      recordPool: String(100_000n * FLIP),
      records: [{
        kind: RECORD_KIND_BUY,
        player: '0xabc',
        value: '100',
        barToBeat: '120',
        clockDay: 10,
      }],
    });
    assert.equal(candidateRecordPayoutWei({
      state,
      kind: RECORD_KIND_BUY,
      candidate: 119n,
      today: 20,
    }), 0n);
    assert.equal(candidateRecordPayoutWei({
      state,
      kind: RECORD_KIND_BUY,
      candidate: 120n,
      today: 20,
    }), 10_000n * FLIP);
  });

  test('quotes the guaranteed floor when a held record clock is unknown', () => {
    const state = normalizeRecords({
      recordPool: String(100_000n * FLIP),
      records: [{
        kind: RECORD_KIND_BUY,
        player: '0xabc',
        value: '100',
        barToBeat: '120',
      }],
    });
    assert.equal(candidateRecordPayoutWei({
      state,
      kind: RECORD_KIND_BUY,
      candidate: 120n,
      today: 20,
    }), 5_000n * FLIP);
  });

  test('normalizeRecords keeps a null clock null rather than day zero', () => {
    // Number(null) is 0, and a 0 clock would max the share instead of hiding it.
    const state = normalizeRecords({ records: [{ kind: 0, player: '0xa', value: '5' }] });
    assert.equal(state.records[0].clockDay, null);
    const stamped = normalizeRecords({
      records: [{ kind: 0, player: '0xa', value: '5', clockDay: 12 }],
    });
    assert.equal(stamped.records[0].clockDay, 12);
  });
});

describe('holder identity', () => {
  test('falls back to a shortened address', () => {
    assert.equal(shortAddress('0xabcdef0123456789012345678901234567890123'), '0xabcd…0123');
    assert.equal(shortAddress(null), '—');
  });

  test('an unlinked holder still gets a stable portrait', () => {
    assert.equal(addressMonogram('0xAbCdEf00'), 'AB');
    assert.equal(addressHue('0xabcdef'), 0xabcdef % 360);
    assert.equal(addressHue('0xabcdef'), addressHue('0xABCDEF'));
    assert.equal(addressHue(''), 0);
  });

  test('only https avatars are accepted into an img src', () => {
    assert.match(PROFILES, /\/\^https:\\\/\\\/\//);
    assert.match(DATA, /export \{ fetchProfiles \} from '\.\/profiles\.js'/);
  });

  test('interpolated holder names are escaped', () => {
    assert.match(COMPONENT, /function escapeHtml/);
    assert.match(COMPONENT, /escapeHtml\(profile\?\.name \|\| shortAddress\(record\.player\)\)/);
    assert.match(COMPONENT, /escapeHtml\(profile\.avatar\)/);
  });
});

describe('rail wiring', () => {
  test('presents the board with the plural Biggest Bounties wordmark and explicit data labels', () => {
    assert.match(COMPONENT, /records-rail__wordmark[^>]*id="records-rail-title"[^>]*aria-label="The Biggest Bounties"/);
    assert.match(COMPONENT, /src="\/app\/assets\/biggest-bounty-wordmark-v39-clean-pillowed-painted-wood\.png"/);
    assert.doesNotMatch(COMPONENT, /records-rail__title-(?:name|descriptor)/,
      'the generated wordmark replaces the old duplicate text treatment');
    assert.match(CSS, /records-rail__wordmark\s*\{[^}]*width:\s*min\(100%, 18rem\)/s,
      'the Texas wordmark uses the available desktop identity column');
    assert.match(CSS, /records-rail__wordmark img\s*\{[^}]*width:\s*100%[^}]*max-height:\s*5\.75rem/s,
      'the larger artwork remains bounded inside the collapsed rail');
    assert.doesNotMatch(COMPONENT, /4 ALL-TIME RECORDS/,
      'the wordmark stands alone without a redundant record-count subtitle');
    for (const label of [
      'CURRENT RECORD', 'HELD BY', 'TARGET TO CLAIM', 'PAYOUT NOW',
      'CURRENT BOUNTY', 'MIN TO HIT',
    ]) {
      assert.ok(COMPONENT.includes(label), `missing readable label: ${label}`);
    }
    assert.doesNotMatch(COMPONENT, />THE RECORDS</);
  });

  test('collapses to the live pool plus four portrait-and-amount leaders', () => {
    assert.match(COMPONENT, /<details class="records-rail__disclosure">/);
    assert.match(COMPONENT, /<summary class="records-rail__summary"/);
    assert.match(COMPONENT, /data-bind="records-leaders"/);
    assert.match(COMPONENT, /leaders\.appendChild\(this\.#renderLeader\(record\)\)/);
    assert.match(COMPONENT, /this\.#portrait\(record\.player, profile\)/);
    assert.match(COMPONENT, /record\.meta\.short/);
    assert.match(
      COMPONENT,
      /formatCompactRecordValue\(\s*record\.kind,\s*record\.held \? record\.value : record\.meta\.floorValue/s,
    );
    assert.match(COMPONENT, /compactValue\.amount/);
    assert.match(COMPONENT, /compactValue\.suffix/,
      'compact leaders use short units while expanded cards keep exact units');
    assert.match(COMPONENT, /record\.held \? record\.value : record\.meta\.floorValue/,
      'an open compact record formats its real floor without restoring a MIN prefix');
    assert.match(COMPONENT, /records-rail__leader-amount/,
      'the compact amount and unit have separate sizing slots');
    assert.doesNotMatch(COMPONENT, /<i>MIN<\/i>/,
      'the collapsed Biggest Bounties row leaves exact entry floors to expanded details');
    assert.match(COMPONENT, /records-rail__bounty-sight/);
    assert.match(COMPONENT, /document\.createElement\('button'\)/,
      'each compact record bubble is a real keyboard-accessible action');
    assert.match(COMPONENT, /this\.#openBountyDialog\(record\.kind\)/);
    assert.match(COMPONENT, /FLIP_LOGO = '\/whitepaper\/flame-logo-split\.svg'/);
    assert.match(COMPONENT, /records-rail__pot-label">BOUNTY POOL/);
    assert.match(COMPONENT, /records-rail__pot-logo/,
      'the main bounty pool total uses the FLIP mark instead of a FLIP word');
    assert.match(COMPONENT, /records-rail__pot-logo[\s\S]*data-bind="records-pool"/,
      'the plain FLIP mark leads the bounty amount');
    assert.doesNotMatch(COMPONENT, /records-rail__pot-mark/,
      'the main pool logo has no crosshair treatment');
    assert.doesNotMatch(COMPONENT, /records-rail__bounty-logo/,
      'the small crosshair payouts stay numeric and uncluttered');
    assert.match(CSS, /records-rail__pot-logo\s*\{[^}]*width:\s*1\.45rem/s);
    assert.match(COMPONENT, /records-rail__leader-label[\s\S]*?<small>BIGGEST<\/small>[\s\S]*?record\.meta\.short/);
    assert.match(CSS, /records-rail__leader-label > small\s*\{[^}]*clamp\(0\.64rem, 0\.82vw, 0\.72rem\)/s,
      'BIGGEST is the dominant, readable line in every compact record bubble');
    assert.match(CSS, /records-rail__leader-value\s*\{[^}]*clamp\(0\.78rem, 1\.1vw, 0\.9rem\)/s);
    assert.match(CSS, /records-rail__leader-value :is\(em, i\)\s*\{[^}]*"Inter"/s,
      'TIX and other compact units retain the label font instead of inheriting numeric mono');
    assert.match(CSS, /records-rail__leader-amount\s*\{[^}]*text-overflow:\s*ellipsis/s,
      'a pathological value truncates before it can push its unit out of the bubble');
    assert.match(CSS, /records-rail__bounty-sight > b\s*\{[^}]*0\.6rem/s,
      'both the record and its compact bounty amount are deliberately enlarged');
    assert.doesNotMatch(COMPONENT, /records-rail__bounty-sight-copy/,
      'BIGGEST belongs with the record name, not inside its payout bubble');
    assert.match(COMPONENT, /records-rail__crosshair/);
    assert.match(COMPONENT, /formatCompactBountyWei\(payoutWei\)/);
    assert.match(CSS, /\.records-rail__crosshair::before/);
    assert.match(CSS, /\.records-rail__target\s*\{[^}]*position:\s*relative/s);
    assert.match(COMPONENT, /records-rail__expanded/);
    assert.match(COMPONENT, /records-bounty-dialog/);
    assert.match(COMPONENT, /THE BIGGEST BOUNTY/);
    assert.match(COMPONENT, /BOUNTY ON THE LINE/);
    assert.match(COMPONENT, /records-bounty-dialog__headline/,
      'the live bounty is the popup headline rather than a small side card');
    assert.match(COMPONENT, /records-bounty-confirm-action/);
    assert.match(COMPONENT, /records-bounty-confirm-amount/,
      'the exact transaction amount lives in the confirm action');
    assert.match(COMPONENT, /data-bind="records-bounty-spins"/,
      'Degenerette bounties expose a bounded spin-count control');
    assert.match(COMPONENT, /data-bind="records-bounty-spin-price"/,
      'Degenerette bounties expose a separate ETH price-per-spin field');
    assert.match(COMPONENT, /recordBountySpinSelection/,
      'spin edits are normalized against the live total bounty floor');
    assert.match(COMPONENT, /PRICE BELOW BOUNTY FLOOR/);
    assert.match(CSS, /records-bounty-dialog__spin-controls\.is-invalid/,
      'a below-floor draft is visibly rejected as well as transaction-blocked');
    assert.doesNotMatch(COMPONENT, /records-bounty-dialog__confirm"[\s\S]{0,160}<img/,
      'the transaction CTA does not mislabel an ETH spend with the FLIP bounty mark');
    assert.doesNotMatch(COMPONENT, /records-bounty-(?:target|cost|available)"/,
      'the popup does not repeat the amount or expose the player balance');
    assert.doesNotMatch(COMPONENT, /AVAILABLE TO SPEND|NEED .* AVAILABLE/,
      'balance copy stays out of both the popup and its insufficient-funds notice');
    assert.doesNotMatch(COMPONENT, /recordBountyAffordability|_readWalletBalance|WALLET READY|quote\.funds/,
      'the shortcut does not guess wallet affordability before opening the real transaction path');
    assert.match(COMPONENT, /action: `BUY \$\{tickets\}`[\s\S]*?amount: fullCost/,
      'ticket confirmation keeps its distinct ticket count and ETH cost together in the CTA');
    assert.match(COMPONENT, /readLiveRecordMark/,
      'the confirmation target is refreshed directly from chain');
    assert.match(COMPONENT, /TARGET OR PRICE MOVED · REVIEW THE UPDATED TX/,
      'a moved target must be reviewed rather than silently submitted');
    assert.doesNotMatch(COMPONENT, /\+2,000 FLIP<\/b> every unbroken day/,
      'the inaccurate fixed daily-growth claim is gone');
    assert.doesNotMatch(COMPONENT, /<details class="records-rail__disclosure" open/,
      'full details should start collapsed');
    assert.match(CSS, /records-rail__disclosure\[open\].*records-rail__chevron/s);
  });

  test('is mounted under the play grid and above the deity desk', () => {
    assert.ok(INDEX.includes('<app-records-rail></app-records-rail>'));
    const rail = INDEX.indexOf('<app-records-rail>');
    const playGrid = INDEX.indexOf('<app-degenerette-panel>');
    const deity = INDEX.indexOf('<app-deity-desk>');
    assert.ok(playGrid < rail, 'rail must sit below the Degenerette row');
    assert.ok(rail < deity, 'rail must sit above the deity desk');
  });

  test('ships its stylesheet and module', () => {
    assert.ok(INDEX.includes('/app/styles/records-rail.css'));
    assert.ok(INDEX.includes('/app/components/app-records-rail.js'));
  });

  test('every class the component emits is styled', () => {
    const emitted = new Set(
      [...COMPONENT.matchAll(/records-rail__[a-z-]+/g)].map((match) => match[0]),
    );
    assert.ok(emitted.size > 8, 'expected the component to emit its BEM classes');
    for (const className of emitted) {
      assert.ok(CSS.includes(`.${className}`), `${className} has no style rule`);
    }
  });

  test('the beat track fills to the mark and notches at the bar', () => {
    // Track spans the claiming candidate (120% of the mark), so the brass fill
    // stops at 100/1.2 and the gap to the ice notch IS the fifth.
    assert.match(COMPONENT, /MARK_FILL_PERCENT = 100 \/ 1\.2/);
    assert.ok(CSS.includes('.records-rail__notch'));
    assert.ok(CSS.includes('.records-rail__fill'));
  });

  test('stays responsive and scoped like the other rails', () => {
    for (const width of ['930px', '620px', '430px']) {
      assert.ok(CSS.includes(`max-width: ${width}`), `missing ${width} breakpoint`);
    }
    assert.ok(CSS.includes('body.layout-basic app-records-rail[hidden]'));
    assert.ok(CSS.includes('display: none !important'));
  });

  test('refreshes the live pool after mined app transactions and on a short poll', () => {
    assert.match(COMPONENT, /POLL_MS = 15_000/);
    assert.match(COMPONENT, /addEventListener\(TX_CONFIRMED_EVENT/);
    assert.match(COMPONENT, /removeEventListener\?\.\(TX_CONFIRMED_EVENT/);
  });

  test('honors ON, VIEW, and OFF without turning view-only records into transactions', () => {
    assert.match(COMPONENT, /readBiggestBountiesModePreference/);
    assert.match(COMPONENT, /name !== 'biggestBountiesMode'/);
    assert.match(COMPONENT, /mode === 'off'[\s\S]*?this\.hidden = true/,
      'OFF removes the complete widget');
    assert.match(COMPONENT, /const interactive = readBiggestBountiesModePreference\(\) === 'on'/);
    assert.match(COMPONENT, /item\.setAttribute\('aria-disabled', 'true'\)/,
      'VIEW keeps the useful record tooltip but announces the shortcut as disabled');
    assert.match(COMPONENT,
      /if \(readBiggestBountiesModePreference\(\) !== 'on'\) return;[\s\S]*?#openBountyDialog/,
      'both the click path and dialog path reject view-only activation');
    assert.match(CSS, /\.records-rail__leader\.is-view-only/);
  });
});
