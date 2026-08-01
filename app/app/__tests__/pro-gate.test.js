// /app/app/__tests__/pro-gate.test.js — Phase 64 hidden pro-mode eligibility.
//
// Run: cd website && node --test app/app/__tests__/pro-gate.test.js
//
// Covers:
//   - deriveProEligible pure predicate (strict > 8000 bps, malformed payloads)
//   - initProGate store wiring: null address → false; high score → true;
//     fetch failure → false (fail closed)
//   - stale-response race: slow fetch for wallet A resolving after a switch
//     to wallet B must NOT overwrite B's result
//   - keyed to connected.address (viewing.address changes are ignored)

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as storeMod from '../store.js';
import {
  PRO_SCORE_THRESHOLD_BPS,
  deriveProEligible,
  initProGate,
  __setFetchJSONForTest,
} from '../pro-gate.js';

const ADDR_A = '0xaaaa000000000000000000000000000000000000';
const ADDR_B = '0xbbbb000000000000000000000000000000000000';

function payloadWithScore(totalBps) {
  return { scoreBreakdown: { totalBps } };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 20));
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe('deriveProEligible (pure)', () => {
  test('threshold constant is 8000 bps (80 points)', () => {
    assert.equal(PRO_SCORE_THRESHOLD_BPS, 8000);
  });

  test('above threshold → true', () => {
    assert.equal(deriveProEligible(payloadWithScore(8500)), true);
  });

  test('exactly 8000 → false (strict >)', () => {
    assert.equal(deriveProEligible(payloadWithScore(8000)), false);
  });

  test('below threshold → false', () => {
    assert.equal(deriveProEligible(payloadWithScore(60)), false);
  });

  test('missing scoreBreakdown → false', () => {
    assert.equal(deriveProEligible({}), false);
    assert.equal(deriveProEligible(null), false);
    assert.equal(deriveProEligible(undefined), false);
  });

  test('non-numeric totalBps → false', () => {
    assert.equal(deriveProEligible(payloadWithScore('not-a-number')), false);
    assert.equal(deriveProEligible(payloadWithScore(NaN)), false);
    assert.equal(deriveProEligible(payloadWithScore(Infinity)), false);
  });

  test('numeric-string totalBps coerces (indexer may serialize as string)', () => {
    assert.equal(deriveProEligible(payloadWithScore('8500')), true);
    assert.equal(deriveProEligible(payloadWithScore('7999')), false);
  });
});

describe('initProGate store wiring', () => {
  let unsub = null;

  beforeEach(() => {
    storeMod.__resetForTest();
    __setFetchJSONForTest(null); // reset seam to default before each case
    if (unsub) { try { unsub(); } catch (_) { /* defensive */ } unsub = null; }
  });

  test('no connected wallet → ui.proEligible false (initial fire)', async () => {
    __setFetchJSONForTest(async () => { throw new Error('should not fetch'); });
    unsub = initProGate();
    await flush();
    assert.equal(storeMod.get('ui.proEligible'), false);
  });

  test('connected wallet above threshold → true', async () => {
    __setFetchJSONForTest(async (url) => {
      assert.match(url, new RegExp(`/player/${ADDR_A}$`), 'fetches /player/{connected}');
      return payloadWithScore(12000);
    });
    unsub = initProGate();
    storeMod.update('connected.address', ADDR_A);
    await flush();
    assert.equal(storeMod.get('ui.proEligible'), true);
  });

  test('connected wallet below threshold → false', async () => {
    __setFetchJSONForTest(async () => payloadWithScore(500));
    unsub = initProGate();
    storeMod.update('connected.address', ADDR_A);
    await flush();
    assert.equal(storeMod.get('ui.proEligible'), false);
  });

  test('fetch failure → false (fail closed)', async () => {
    __setFetchJSONForTest(async () => { throw new Error('network blip'); });
    unsub = initProGate();
    storeMod.update('connected.address', ADDR_A);
    await flush();
    assert.equal(storeMod.get('ui.proEligible'), false);
  });

  test('disconnect after eligible → flips back to false', async () => {
    __setFetchJSONForTest(async () => payloadWithScore(12000));
    unsub = initProGate();
    storeMod.update('connected.address', ADDR_A);
    await flush();
    assert.equal(storeMod.get('ui.proEligible'), true);
    storeMod.update('connected.address', null);
    await flush();
    assert.equal(storeMod.get('ui.proEligible'), false);
  });

  test('stale-response race: slow fetch for A must not overwrite B result', async () => {
    // Wallet A (eligible) resolves SLOWLY; wallet B (not eligible) resolves fast.
    let resolveA;
    const slowA = new Promise((r) => { resolveA = r; });
    __setFetchJSONForTest(async (url) => {
      if (url.includes(ADDR_A)) return slowA;
      return payloadWithScore(100); // B: not eligible
    });
    unsub = initProGate();
    storeMod.update('connected.address', ADDR_A);
    await Promise.resolve(); // A's fetch is now in flight
    storeMod.update('connected.address', ADDR_B);
    await flush();
    assert.equal(storeMod.get('ui.proEligible'), false, 'B result landed');
    // A's slow response arrives AFTER the switch — must be discarded.
    resolveA(payloadWithScore(30000));
    await flush();
    assert.equal(storeMod.get('ui.proEligible'), false, 'stale A response discarded');
  });

  test('viewing.address changes do NOT drive eligibility (connected-only)', async () => {
    let fetchCount = 0;
    __setFetchJSONForTest(async () => { fetchCount += 1; return payloadWithScore(100); });
    unsub = initProGate();
    await flush();
    const baseline = fetchCount;
    storeMod.update('viewing.address', ADDR_B);
    await flush();
    assert.equal(fetchCount, baseline, 'no fetch on viewing.address change');
    assert.equal(storeMod.get('ui.proEligible'), false);
  });
});
