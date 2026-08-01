// /app/app/__tests__/share-win.test.js — SHARE MY WIN pure helpers.
// Run: cd website && node --test app/app/__tests__/share-win.test.js
//
// Covers buildShareRefUrl (registered-code bytes32 form > bare-address form,
// malformed → plain origin), extractWinLines (jackpot prizes / lootbox spin
// payouts / packs & NO HIT excluded), and canShareWin's view-mode gate.
// resolveRegisteredCode lives in affiliate.js and is tested in
// affiliate.test.js. Canvas painting + Web Share are browser-only and stay
// untested here (renderShareCard null-guards document/getContext, verified
// below).

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
  buildShareRefUrl, extractWinLines, canShareWin, renderShareCard, displayShareUrl,
} from '../share-win.js';
import { update, __resetForTest } from '../store.js';
import { ETH_DIVISOR } from '../chain-config.js';

const ADDR = '0x7Fc329000000000000000000000000000000oops'; // invalid (non-hex tail)
const GOOD = '0x7fC3290000000000000000000000000000000E7a';

describe('buildShareRefUrl', () => {
  test('valid address → lowercased bare-address ref URL', () => {
    assert.equal(
      buildShareRefUrl(GOOD),
      'https://degener.us/?ref=0x7fc3290000000000000000000000000000000e7a',
    );
  });

  test('malformed / missing address → plain origin (no ref)', () => {
    assert.equal(buildShareRefUrl(ADDR), 'https://degener.us/');
    assert.equal(buildShareRefUrl(null), 'https://degener.us/');
    assert.equal(buildShareRefUrl('0x1234'), 'https://degener.us/');
  });

  test('registered code wins over the bare address', () => {
    const code = ethers.encodeBytes32String('SHARK');
    assert.equal(buildShareRefUrl(GOOD, code), `https://degener.us/?ref=${code.toLowerCase()}`);
    // Junk code → falls back to the address form.
    assert.equal(
      buildShareRefUrl(GOOD, 'SHARK'),
      'https://degener.us/?ref=0x7fc3290000000000000000000000000000000e7a',
    );
  });
});

describe('displayShareUrl', () => {
  test('strips scheme + middle-truncates the ref address', () => {
    assert.equal(
      displayShareUrl('https://degener.us/?ref=0x7fc3290000000000000000000000000000000e7a'),
      'degener.us/?ref=0x7fc329…00e7a',
    );
  });

  test('plain origin → bare host', () => {
    assert.equal(displayShareUrl('https://degener.us/'), 'degener.us');
  });

  test('bytes32 vanity ref decodes to "· code NAME"', () => {
    const code = ethers.encodeBytes32String('SHARK');
    assert.equal(
      displayShareUrl(`https://degener.us/?ref=${code.toLowerCase()}`),
      'degener.us · code SHARK',
    );
  });

  test('non-vanity bytes32 ref middle-truncates', () => {
    const hex = '0x' + 'ab'.repeat(32);
    const out = displayShareUrl(`https://degener.us/?ref=${hex}`);
    assert.equal(out, `degener.us/?ref=${hex.slice(0, 8)}…${hex.slice(-5)}`);
  });
});

describe('extractWinLines', () => {
  test('jackpot cards → one line per prize, labels preserved for tickets', () => {
    const lines = extractWinLines({
      kind: 'jackpot',
      cards: [
        { type: 'eth', value: '0.4269' },
        { type: 'flip', value: '1,200' },
        { type: 'tickets', value: '2', label: 'LEVEL 3 TICKETS' },
      ],
    });
    assert.deepEqual(lines, [
      { amount: '0.4269', unit: 'ETH' },
      { amount: '1,200', unit: 'FLIP' },
      { amount: '2', unit: 'LEVEL 3 TICKETS' },
    ]);
  });

  test('lootbox: only paid spins count; per-currency sums; eth uses ethShare', () => {
    // Raw on-chain ETH is /ETH_DIVISOR-scaled (testnet /1M); displayEth
    // multiplies back. This raw renders as exactly "1.0000".
    const oneEthRaw = 10n ** 18n / ETH_DIVISOR;
    const lines = extractWinLines({
      kind: 'lootbox',
      cards: [
        { type: 'tickets', value: '11' },                       // purchase, not a win
        { type: 'flip', value: '500' },                          // box contents, not a win
        { type: 'spins', spin: { spinType: 'eth', payout: oneEthRaw * 2n, ethShare: oneEthRaw } },
        { type: 'spins', spin: { spinType: 'flip', payout: 5n * 10n ** 18n } },
        { type: 'spins', spin: { spinType: 'flip', payout: 3n * 10n ** 18n } },
        { type: 'spins', spin: { spinType: 'wwxrp', payout: 0n } }, // miss
      ],
    });
    assert.equal(lines.length, 2);
    assert.equal(lines[0].unit, 'ETH');
    assert.equal(lines[0].amount, '1.0000');
    assert.equal(lines[1].unit, 'FLIP');
    assert.equal(lines[1].amount, '8.0000');
  });

  // A Degenerette bet total is a win the player played for — its own line.
  test('degenerette: the bet total, in the bet currency', () => {
    const oneEthRaw = 10n ** 18n / ETH_DIVISOR;
    const eth = extractWinLines({
      kind: 'degenerette',
      cards: [{ type: 'eth', value: '' }],
      spinBoard: { total: oneEthRaw * 2n, currency: 0, unit: 'ETH' },
    });
    assert.equal(eth.length, 1);
    assert.equal(eth[0].unit, 'ETH');
    assert.equal(eth[0].amount, '2.0000');

    const flip = extractWinLines({
      kind: 'degenerette',
      cards: [{ type: 'flip', value: '' }],
      spinBoard: { total: 4n * 10n ** 18n, currency: 1, unit: 'FLIP' },
    });
    assert.equal(flip[0].unit, 'FLIP');
    assert.equal(flip[0].amount, '4.0000');
  });

  test('degenerette: a losing or busted bet is not shareable', () => {
    assert.deepEqual(extractWinLines({
      kind: 'degenerette', cards: [{ type: 'nowin', value: '' }],
      spinBoard: { total: 0n, currency: 1, unit: 'FLIP' },
    }), []);
    // No board at all (should not happen) → nothing to claim.
    assert.deepEqual(extractWinLines({ kind: 'degenerette', cards: [] }), []);
  });

  test('packs, NO HIT, and junk → no lines', () => {
    assert.deepEqual(extractWinLines({ kind: 'pack', cards: [{ type: 'tickets', value: '5' }] }), []);
    assert.deepEqual(extractWinLines({ kind: 'jackpot', cards: [{ type: 'nowin', value: '' }] }), []);
    assert.deepEqual(extractWinLines(null), []);
    assert.deepEqual(extractWinLines({ kind: 'lootbox' }), []);
  });
});

describe('canShareWin', () => {
  beforeEach(() => __resetForTest());

  const winSeq = { kind: 'jackpot', cards: [{ type: 'eth', value: '0.1' }] };

  test('self mode + winnings → true; no winnings → false', () => {
    assert.equal(canShareWin(winSeq), true);
    assert.equal(canShareWin({ kind: 'pack', cards: [{ type: 'tickets', value: '1' }] }), false);
  });

  test('view mode → false (not your win, not your link)', () => {
    update('ui.mode', 'view');
    assert.equal(canShareWin(winSeq), false);
  });
});

describe('renderShareCard (no-canvas guard)', () => {
  test('returns null when canvas 2D is unavailable (node)', () => {
    // node has no document at all
    assert.equal(
      renderShareCard({ title: 'YOU WON', lines: [{ amount: '1', unit: 'ETH' }], refUrl: 'https://degener.us/', qr: null }),
      null,
    );
  });
});
