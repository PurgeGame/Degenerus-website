import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement ||= class {};
globalThis.customElements ||= { get() {}, define() {} };
const {
  sacrificeDrawStatus, sacrificeHowTo, compactSacrificeBoon, sacrificeOddsLine, sacrificeAwardLines, formatBoonEth,
} = await import('../app-sacrifice-panel.js');
const { CONTRACTS, ETH_DIVISOR } = await import('../../app/chain-config.js');
const { SACRIFICE_DEITIES } = await import('../../app/sacrifices.js');
// Raw chain wei for a display-ETH amount.
const eth = (value) => BigInt(Math.round(value * 1e6)) * 10n ** 12n / BigInt(ETH_DIVISOR);

test('there is no sacrifice write: the panel explains the hero-bet entry instead', () => {
  const [vault, sdgnrs] = SACRIFICE_DEITIES;
  assert.match(sacrificeHowTo(vault), /Bet ETH on Degenerette with the XRP hero symbol/);
  assert.match(sacrificeHowTo(sdgnrs), /ETH hero symbol to enter the God of ETH/);
  assert.match(sacrificeHowTo(vault), /FLIP, WWXRP and gifted bets do not count/);
});

test('draw status only closes for a missing read, an ended game or a drawn pool', () => {
  const state = { ended: false, pools: [{ key: 'vault', awardedMask: 0 }] };
  assert.equal(sacrificeDrawStatus({ state, deityKey: 'vault' }), '');
  assert.ok(sacrificeDrawStatus({ state: null, deityKey: 'vault' }));
  assert.ok(sacrificeDrawStatus({ state: { ...state, ended: true }, deityKey: 'vault' }));
  assert.ok(sacrificeDrawStatus({ state: { ...state, pools: [{ key: 'vault', awardedMask: 7 }] }, deityKey: 'vault' }));
  assert.ok(sacrificeDrawStatus({ state, deityKey: 'sdgnrs' }));
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


test('the odds line reports the wallet\'s OWN standing and what one more hero bet buys', () => {
  const pool = { entryCount: 4, totalWageredWei: eth(0.4), totalWeight: 32_000n, awardedMask: 0 };
  // Two prior bets, each frozen at its own score — the standing is their SUM, not a
  // re-quote of the whole position at today's multiplier.
  const standing = { count: 2, weight: 16_000n, amountWei: eth(0.15) };

  const held = sacrificeOddsLine({ pool, standing });
  assert.match(held, /4 entries · 0\.4 ETH bet/);
  assert.match(held, /you: 2 bets, 0\.15 ETH/);
  // 16,000 of 32,000 per slot, three independent slots WITH REPLACEMENT:
  // 1 - 0.5^3 = 87.5%, NOT 50% and not 150%.
  assert.match(held, /88% for at least one of 3/);

  // A pool that has already drawn says so instead of quoting.
  assert.match(sacrificeOddsLine({ pool: { ...pool, awardedMask: 7 }, standing }), /drawn$/);

  // The proposed entry adds to the numerator AND the denominator exactly once.
  const quoted = sacrificeOddsLine({ pool, standing, quote: { units: 10n, weight: 16_000n, multiplier: 1.6 } });
  assert.match(quoted, /this bet: 1\.60× weight/);
  // (16,000 + 16,000) / (32,000 + 16,000) = 2/3 per slot → 1 - (1/3)^3 = 96%.
  assert.match(quoted, /→ 96%/);

  // A missing history ROUTE is not an empty history, and must not read as one.
  assert.match(sacrificeOddsLine({
    pool, standing: { count: 0, weight: 0n, amountWei: 0n }, historyAvailable: false,
  }), /your standing is unavailable/);
  assert.equal(sacrificeOddsLine({ pool: null }), '');
  assert.equal(formatBoonEth(eth(1.25)), '1.25');
  assert.equal(formatBoonEth(null), '—');
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
