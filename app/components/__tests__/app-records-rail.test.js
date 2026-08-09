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
  fetchRecords,
  formatRecordValue,
  normalizeRecords,
  recordClaimTarget,
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
} = await import('../app-records-rail.js');

const INDEX = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../styles/records-rail.css', import.meta.url), 'utf8');
const COMPONENT = readFileSync(new URL('../app-records-rail.js', import.meta.url), 'utf8');
const DATA = readFileSync(new URL('../../app/records.js', import.meta.url), 'utf8');

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
      'BIGGEST DEGEN',
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
});

describe('live bounty pool', () => {
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

  test('is unknown, not invented, when the clock was never indexed', () => {
    assert.equal(accruedShareBps({ held: true, clockDay: null, today: 40 }), null);
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

  test('does not invent a qualifying payout when a held record clock is unknown', () => {
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
    }), null);
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
    assert.match(DATA, /\/\^https:\\\/\\\/\//);
  });

  test('interpolated holder names are escaped', () => {
    assert.match(COMPONENT, /function escapeHtml/);
    assert.match(COMPONENT, /escapeHtml\(profile\?\.name \|\| shortAddress\(record\.player\)\)/);
    assert.match(COMPONENT, /escapeHtml\(profile\.avatar\)/);
  });
});

describe('rail wiring', () => {
  test('presents the board as The Biggest Bounty with explicit data labels', () => {
    assert.match(COMPONENT, /records-rail__title-name">THE BIGGEST/);
    assert.match(COMPONENT, /records-rail__title-descriptor">BOUNTY/);
    assert.match(COMPONENT, /4 ALL-TIME RECORDS/);
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
    assert.match(COMPONENT, /value\.amount/);
    assert.match(COMPONENT, /record\.meta\.unit === 'flip' \? '' : value\.suffix/,
      'the FLIP record does not repeat its already-labeled currency');
    assert.match(COMPONENT, /records-rail__bounty-sight/);
    assert.match(COMPONENT, /records-rail__leader-label[\s\S]*?<small>BIGGEST<\/small>[\s\S]*?record\.meta\.short/);
    assert.match(CSS, /records-rail__leader-label > small\s*\{[^}]*clamp\(0\.56rem, 0\.75vw, 0\.64rem\)/s,
      'BIGGEST is the dominant, readable line in every compact record bubble');
    assert.doesNotMatch(COMPONENT, /records-rail__bounty-sight-copy/,
      'BIGGEST belongs with the record name, not inside its payout bubble');
    assert.match(COMPONENT, /records-rail__crosshair/);
    assert.match(COMPONENT, /formatCompactBountyWei\(payoutWei\)/);
    assert.match(CSS, /\.records-rail__crosshair::before/);
    assert.match(CSS, /\.records-rail__target\s*\{[^}]*position:\s*relative/s);
    assert.match(COMPONENT, /records-rail__expanded/);
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
});
