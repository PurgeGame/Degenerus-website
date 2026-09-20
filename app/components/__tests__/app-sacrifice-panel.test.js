import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement ||= class {};
globalThis.customElements ||= { get() {}, define() {} };
const {
  sacrificeLockReason, compactSacrificeBoon, sacrificeOddsLine, sacrificeAwardLines,
} = await import('../app-sacrifice-panel.js');
const { CONTRACTS } = await import('../../app/chain-config.js');
const UNIT = 10n ** 18n;
const ready = {
  state: { menuReady: true, ended: false, balanceWei: 1_000n * UNIT, multiplierUnits: 1600,
    pools: [{ key: 'vault', awardedMask: 0 }] },
  deityKey: 'vault', amount: 100n * UNIT, connected: '0x123', mode: 'self', canSign: true,
};

test('live write availability requires a known menu, wallet balance and a self wallet', () => {
  assert.equal(sacrificeLockReason(ready), '');
  for (const changes of [
    { state: null }, { connected: null }, { mode: 'operator' }, { mode: 'view' }, { mode: 'combined' },
    { canSign: false }, { busy: true }, { amount: null }, { amount: 99n * UNIT },
    { amount: 1_001n * UNIT }, { amount: 25_001n * UNIT },
    { state: { ...ready.state, ended: true } },
    { state: { ...ready.state, menuReady: false } },
    { state: { ...ready.state, balanceWei: null } },
    { state: { ...ready.state, multiplierUnits: null } },
    { state: { ...ready.state, pools: [{ key: 'vault', awardedMask: 7 }] } },
  ]) assert.ok(sacrificeLockReason({ ...ready, ...changes }));
});

test('compact boons preserve effective discounts, currency and non-percentage rewards', () => {
  assert.deepEqual(compactSacrificeBoon(3), { name: 'Coinflip', effect: '+25%' });
  assert.deepEqual(compactSacrificeBoon(24), { name: 'Whale', effect: '−35%' });
  assert.deepEqual(compactSacrificeBoon(40), { name: 'Degenerette', effect: '+12% WWXRP' });
  assert.deepEqual(compactSacrificeBoon(18), { name: 'Degen rating', effect: '+12.5' });
  assert.deepEqual(compactSacrificeBoon(4), { name: 'Quest', effect: 'Shield' });
  assert.deepEqual(compactSacrificeBoon(28), { name: 'Whale', effect: 'Pass' });
  assert.deepEqual(compactSacrificeBoon(43), { name: 'Craps', effect: '+15%' });
});


test('the odds line reports the wallet\'s OWN standing and what one more sacrifice buys', () => {
  const pool = { entryCount: 4, totalDonatedWei: 4_000n * UNIT, totalWeight: 32_000n, awardedMask: 0 };
  // Two prior entries, each frozen at its own score — the standing is their SUM, not a
  // re-quote of the whole position at today's multiplier.
  const standing = { count: 2, units: 15, weight: 16_000n, amountWei: 1_500n * UNIT };

  const held = sacrificeOddsLine({ pool, standing });
  assert.match(held, /4 entries/);
  assert.match(held, /you: 2 entries, 1,500 FLIP/);
  // 16,000 of 32,000 per slot, three independent slots WITH REPLACEMENT:
  // 1 - 0.5^3 = 87.5%, NOT 50% and not 150%.
  assert.match(held, /88% for at least one of 3/);

  // A pool that has already drawn cannot be entered, and says so instead of quoting.
  assert.match(sacrificeOddsLine({ pool: { ...pool, awardedMask: 7 }, standing }), /drawn$/);

  // The proposed entry adds to the numerator AND the denominator exactly once.
  const quoted = sacrificeOddsLine({
    pool, standing,
    quote: { units: 10, weight: 16_000n, multiplier: 1.6, remainderWei: 0n },
  });
  assert.match(quoted, /this sacrifice: 10 × 1\.60×/);
  // (16,000 + 16,000) / (32,000 + 16,000) = 2/3 per slot → 1 - (1/3)^3 = 96%.
  assert.match(quoted, /→ 96%/);

  // A stray amount above a whole 100 FLIP funds the stake but buys no weight.
  assert.match(sacrificeOddsLine({
    pool, standing: { count: 0, units: 0, weight: 0n, amountWei: 0n },
    quote: { units: 1, weight: 800n, multiplier: 1, remainderWei: 50n * UNIT },
  }), /50 FLIP over a whole 100 earns no extra weight/);

  // A missing history ROUTE is not an empty history, and must not read as one.
  assert.match(sacrificeOddsLine({
    pool, standing: { count: 0, units: 0, weight: 0n, amountWei: 0n }, historyAvailable: false,
  }), /your standing is unavailable/);
  assert.equal(sacrificeOddsLine({ pool: null }), '');
});

test('past blessings name the AWARD day, which is one after the entry day', () => {
  const lines = sacrificeAwardLines([
    { issuer: CONTRACTS.VAULT, day: 40, slot: 0, boonType: 3 },
    { issuer: CONTRACTS.SDGNRS, day: 44, slot: 2, boonType: 43 },
  ]);
  // Both ProtocolBoonDraw events carry the PARTICIPATION day; the draw resolves on
  // the next day's advance, so a receipt dated `day` was won on `day + 1`.
  assert.deepEqual(lines, [
    'day 45 · ETH · Craps +15%',
    'day 41 · WWXRP · Coinflip +25%',
  ]);
  assert.deepEqual(sacrificeAwardLines(null), []);
  assert.equal(sacrificeAwardLines([{ day: 1, boonType: 1 }, { day: 2, boonType: 1 }], { limit: 1 }).length, 1);
});
