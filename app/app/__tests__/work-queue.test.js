// /app/app/__tests__/work-queue.test.js
//
// Run: cd website && node --test app/app/__tests__/work-queue.test.js
//
// Covers the ordering and filtering rules that decide which transaction the
// MINE FLIP button fires, plus the NoWork-revert classifier the crank probe
// depends on. Network and chain are both injected/absent — no RPC, no indexer.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

globalThis.HTMLElement = globalThis.HTMLElement ?? class {};

const { buildWorkQueue, nextAction, fetchPending, _testing } = await import('../work-queue.js');
const { isNoWorkRevert, _testing: mfTesting } = await import('../mine-flip.js');

const PLAYER = '0x1111111111111111111111111111111111111111';

/** /pending shape with everything zero + available. */
function pendingWith(overrides = {}) {
  const base = {
    eth: { amount: '0', available: true, reason: null },
    flip: { amount: '0', available: true, reason: null },
    tickets: { amount: '0', available: true, reason: null },
    decimator: { amount: '0', available: true, reason: null },
    terminal: { amount: '0', available: true, reason: null },
    vault: { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
    farFutureCoin: { amount: '0', available: true, reason: null },
    affiliate: { amount: '0', available: false, reason: 'commission-aggregation-pending' },
  };
  for (const [k, v] of Object.entries(overrides)) base[k] = { ...base[k], ...v };
  return base;
}

describe('buildWorkQueue — membership', () => {
  test('empty pending + no crank work yields an empty queue', () => {
    const q = buildWorkQueue({ player: PLAYER, pending: pendingWith(), probe: { hasWork: false } });
    assert.deepEqual(q, []);
  });

  test('a zero balance never becomes a row', () => {
    const q = buildWorkQueue({ player: PLAYER, pending: pendingWith({ eth: { amount: '0' } }), probe: null });
    assert.equal(q.length, 0);
  });

  test('a non-zero balance becomes a row carrying the raw indexer amount', () => {
    const q = buildWorkQueue({ player: PLAYER, pending: pendingWith({ eth: { amount: '9163444667067' } }), probe: null });
    assert.equal(q.length, 1);
    assert.equal(q[0].id, 'eth');
    assert.equal(q[0].amount, '9163444667067');
  });

  test('available:false is dropped even when it carries an amount — an indexer gap is not a balance', () => {
    // vault/affiliate are hardcoded honest gaps in the API; rendering them as
    // claimable would promise a tx that cannot be built.
    const q = buildWorkQueue({
      player: PLAYER,
      pending: pendingWith({ vault: { amount: '5000', available: false } }),
      probe: null,
    });
    assert.equal(q.find((i) => i.id === 'vault'), undefined);
  });

  test('a missing /pending payload still yields the crank row', () => {
    const q = buildWorkQueue({ player: PLAYER, pending: null, probe: { hasWork: true } });
    assert.deepEqual(q.map((i) => i.id), ['mineFlip']);
  });

  test('malformed amount strings read as zero rather than throwing', () => {
    const q = buildWorkQueue({ player: PLAYER, pending: pendingWith({ eth: { amount: 'not-a-number' } }), probe: null });
    assert.equal(q.length, 0);
  });
});

describe('buildWorkQueue — ordering', () => {
  test('mineFlip outranks every claim: the bounty is the only raced item', () => {
    const q = buildWorkQueue({
      player: PLAYER,
      pending: pendingWith({ eth: { amount: '100' }, flip: { amount: '200' } }),
      probe: { hasWork: true },
    });
    assert.equal(q[0].id, 'mineFlip');
  });

  test('claims follow the documented order', () => {
    const q = buildWorkQueue({
      player: PLAYER,
      pending: pendingWith({
        tickets: { amount: '99' }, terminal: { amount: '5' },
        decimator: { amount: '7' }, flip: { amount: '3' }, eth: { amount: '1' },
      }),
      probe: { hasWork: false },
    });
    assert.deepEqual(q.map((i) => i.id), ['eth', 'flip', 'decimator', 'terminal', 'tickets']);
  });
});

describe('nextAction — the one-click target', () => {
  test('picks the crank when it has work', () => {
    const q = buildWorkQueue({ player: PLAYER, pending: pendingWith({ eth: { amount: '100' } }), probe: { hasWork: true } });
    assert.equal(nextAction(q).id, 'mineFlip');
  });

  test('skips manual-only rows — redeem SPENDS FLIP and must stay deliberate', () => {
    const q = buildWorkQueue({ player: PLAYER, pending: pendingWith({ tickets: { amount: '99' } }), probe: { hasWork: false } });
    assert.equal(q.length, 1, 'the redeem row is still listed');
    assert.equal(q[0].autoRun, false);
    assert.equal(nextAction(q), null, 'but it is never the one-click target');
  });

  test('decimator and terminal are manual — the rollup carries no level list', () => {
    const q = buildWorkQueue({
      player: PLAYER,
      pending: pendingWith({ decimator: { amount: '7' }, terminal: { amount: '5' } }),
      probe: { hasWork: false },
    });
    assert.equal(nextAction(q), null);
  });

  test('returns null on an empty queue', () => {
    assert.equal(nextAction([]), null);
    assert.equal(nextAction(undefined), null);
  });
});

describe('fetchPending — degrades instead of throwing', () => {
  test('a non-ok response yields null', async () => {
    const r = await fetchPending(PLAYER, { fetchImpl: async () => ({ ok: false }) });
    assert.equal(r, null);
  });

  test('a rejected fetch yields null', async () => {
    const r = await fetchPending(PLAYER, { fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(r, null);
  });

  test('a body without .pending yields null', async () => {
    const r = await fetchPending(PLAYER, { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
    assert.equal(r, null);
  });

  test('unwraps .pending on success', async () => {
    const p = pendingWith({ eth: { amount: '42' } });
    const r = await fetchPending(PLAYER, { fetchImpl: async () => ({ ok: true, json: async () => ({ pending: p }) }) });
    assert.equal(r.eth.amount, '42');
  });

  test('no address short-circuits without a fetch', async () => {
    let called = false;
    const r = await fetchPending(null, { fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; } });
    assert.equal(r, null);
    assert.equal(called, false);
  });
});

describe('isNoWorkRevert — the empty-queue signal', () => {
  test('matches raw revert data carrying the NoWork selector', () => {
    assert.equal(isNoWorkRevert({ data: mfTesting.NO_WORK_SELECTOR }), true);
  });

  test('matches the ethers-decoded custom error name', () => {
    assert.equal(isNoWorkRevert({ revert: { name: 'NoWork' } }), true);
  });

  test('does not match an unrelated revert', () => {
    assert.equal(isNoWorkRevert({ revert: { name: 'NotApproved' } }), false);
    assert.equal(isNoWorkRevert({ message: 'insufficient funds' }), false);
  });

  test('null/undefined are not "no work"', () => {
    assert.equal(isNoWorkRevert(null), false);
    assert.equal(isNoWorkRevert(undefined), false);
  });
});

describe('source gates', () => {
  const mfSrc = readFileSync(resolvePath(__dirname, '../mine-flip.js'), 'utf8');
  const wqSrc = readFileSync(resolvePath(__dirname, '../work-queue.js'), 'utf8');

  test('the NoWork selector is the real keccak256("NoWork()") prefix', () => {
    // Guards against a hand-typed selector: computed once, asserted forever.
    assert.equal(mfTesting.NO_WORK_SELECTOR, '0x5c78c46f');
  });

  test('mineFlip is the only entrypoint — no mintFlip fallback off the stale ABI', () => {
    // Live eth_call proof is in the mine-flip.js header: mintFlip() has no
    // selector on the deployed GAME. Re-adding it would be cargo cult.
    assert.equal(mfTesting.CRANK_NAME, 'mineFlip');
    assert.equal(/mintFlip/.test(mfSrc.replace(/^\s*\/\/.*$/gm, '')), false,
      'mintFlip may appear in comments as history, never in code');
  });

  test('every sendTx call uses the mandatory closure form', () => {
    // Phase 58 gate: sendTx(contract.method(args), ...) captures a stale signer.
    const bad = /sendTx\(\s*[A-Za-z_$][\w$]*\.[\w$]+\(/.test(mfSrc);
    assert.equal(bad, false, 'sendTx must be called as sendTx((s) => ..., label)');
    assert.match(mfSrc, /sendTx\(\(s\) =>/);
  });

  test('work-queue derives no work predicate of its own — the crank revert is the source', () => {
    // A local "is advance due?" would be a second copy of consensus logic.
    assert.equal(/advanceDue|jackpotPhaseFlag|rngLock/.test(wqSrc), false);
  });
});
