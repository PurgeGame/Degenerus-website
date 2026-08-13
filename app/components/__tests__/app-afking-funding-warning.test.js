import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.HTMLElement ??= class {};

const {
  AFKING_LOW_FUND_THRESHOLD_DAYS,
  afkingFundingWarningModel,
  isBlockingModal,
} = await import('../app-afking-funding-warning.js');

const source = readFileSync(new URL('../app-afking-funding-warning.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/afking-funding-warning.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

const ADDRESS = '0x00000000000000000000000000000000000000a1';
const BASE = Object.freeze({
  address: ADDRESS,
  known: true,
  active: true,
  fundedDays: 6n,
  dailyQuantity: 2,
  settingsKnown: true,
  useTickets: false,
});

describe('AFKing low-funding warning', () => {
  test('warns for an active self-owned subscription strictly below seven days', () => {
    assert.equal(AFKING_LOW_FUND_THRESHOLD_DAYS, 7n);
    for (const fundedDays of [0n, 1n, 6n]) {
      assert.equal(afkingFundingWarningModel({
        snapshot: { ...BASE, fundedDays },
        connectedAddress: ADDRESS.toUpperCase(),
        mode: 'self',
      }).visible, true, `${fundedDays} funded days should warn`);
    }
    assert.equal(afkingFundingWarningModel({
      snapshot: { ...BASE, fundedDays: 7n },
      connectedAddress: ADDRESS,
      mode: 'self',
    }).visible, false, 'exactly seven days is not below the threshold');
  });

  test('uses concise quantity-aware order copy', () => {
    const luckboxes = afkingFundingWarningModel({
      snapshot: BASE,
      connectedAddress: ADDRESS,
    });
    assert.equal(luckboxes.daysLabel, '6 DAYS FUNDED');
    assert.equal(luckboxes.orderLabel, '2 LUCKBOX / DAY');

    const ticket = afkingFundingWarningModel({
      snapshot: { ...BASE, fundedDays: 1n, dailyQuantity: 1, useTickets: true },
      connectedAddress: ADDRESS,
    });
    assert.equal(ticket.daysLabel, '1 DAY FUNDED');
    assert.equal(ticket.orderLabel, '1 TICKET / DAY');
  });

  test('never warns for unknown, inactive, foreign, disabled, or non-self state', () => {
    const cases = [
      { snapshot: { ...BASE, known: false } },
      { snapshot: { ...BASE, active: false } },
      { snapshot: { ...BASE, address: '0x00000000000000000000000000000000000000b2' } },
      { enabled: false },
      { mode: 'view' },
      { mode: 'operator' },
      { mode: 'combined' },
      { connectedAddress: null },
    ];
    for (const overrides of cases) {
      assert.equal(afkingFundingWarningModel({
        snapshot: BASE,
        connectedAddress: ADDRESS,
        mode: 'self',
        enabled: true,
        ...overrides,
      }).visible, false);
    }
  });

  test('closed dialogs nested inside hidden hosts do not postpone the warning forever', () => {
    const node = ({ parentElement = null, hidden = false, ariaHidden = null, inert = false } = {}) => ({
      parentElement,
      hidden,
      inert,
      hasAttribute: (name) => name === 'hidden' && hidden,
      getAttribute: (name) => (name === 'aria-hidden' ? ariaHidden : null),
    });
    const hiddenHost = node({ hidden: true });
    const dormantDialog = node({ parentElement: hiddenHost });
    const activeHost = node();
    const activeDialog = node({ parentElement: activeHost });
    const warning = { contains: () => false };

    assert.equal(isBlockingModal(dormantDialog, warning), false,
      'a dialog inside a hidden host is not actually open');
    assert.equal(isBlockingModal(activeDialog, warning), true,
      'a genuinely visible modal still delays the warning');
    assert.equal(isBlockingModal(activeDialog, { contains: () => true }), false,
      'the warning never blocks itself');
  });

  test('is mounted, accessible, preference-aware, and routes to the real top-up input', () => {
    assert.match(html, /href="\/app\/styles\/afking-funding-warning\.css"/);
    assert.match(html, /<app-afking-funding-warning hidden>/);
    // Cold-load diet (2026-08-13): loads via the IDLE_MODULES registration,
    // not an eager script tag (hidden banner; self-initializes from store).
    assert.match(html, /'\/app\/components\/app-afking-funding-warning\.js'/);
    assert.match(source, /role', 'dialog'/);
    assert.match(source, /aria-modal', 'true'/);
    assert.match(source, /subscribe\('app\.afkingSubscription'/);
    assert.match(source, /readAfkingLowFundWarningPreference\(\)/);
    assert.match(source, /detail\?\.name !== 'afkingLowFundWarning'/);
    assert.match(source, /\.some\(\(dialog\) => isBlockingModal\(dialog, this\)\)/);
    assert.match(source, /lock\(\)[\s\S]*unlock\(\)/);
    assert.match(source, /querySelector\?\.\('#afking-passes'\)[\s\S]*disclosure\.open = true/);
    assert.match(source, /\[name="pass-afking-topup"\]/);
    assert.match(css, /app-afking-funding-warning\[hidden\]\s*\{[^}]*display:\s*none !important/s);
    assert.match(css, /grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/);
    assert.match(css, /@media \(max-width: 520px\)[\s\S]*?grid-template-columns:\s*1fr/s);
  });
});
