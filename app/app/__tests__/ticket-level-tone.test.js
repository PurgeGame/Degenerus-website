import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { __resetForTest, update } from '../store.js';
import {
  applyTicketLevelTone,
  currentPurchaseTicketLevel,
  ticketLevelTone,
} from '../ticket-level-tone.js';

const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');

beforeEach(() => __resetForTest());

describe('ticket level RPG tones', () => {
  test('uses the requested purchase-level-relative ladder', () => {
    assert.equal(ticketLevelTone(28, 28), 'white');
    assert.equal(ticketLevelTone(21, 28), 'white', 'older ticket levels stay neutral');
    assert.equal(ticketLevelTone(29, 28), 'green');
    assert.equal(ticketLevelTone(30, 28), 'yellow');
    assert.equal(ticketLevelTone(31, 28), 'yellow');
    assert.equal(ticketLevelTone(32, 28), 'orange');
    assert.equal(ticketLevelTone(33, 28), 'red', 'red starts one level earlier');
    assert.equal(ticketLevelTone(34, 28), 'red');
    assert.equal(ticketLevelTone(80, 28), 'red');
  });

  test('does not coerce a missing level into level zero', () => {
    assert.equal(ticketLevelTone(null, 28), null);
    assert.equal(ticketLevelTone('', 28), null);
    assert.equal(ticketLevelTone(29, null), 'white', 'unknown purchase level stays neutral');
  });

  test('uses roll1.purchaseLevel first and the active-level rule as fallback', () => {
    update('app.gameState', { level: 41, jackpotPhaseFlag: false });
    assert.equal(currentPurchaseTicketLevel(), 42);
    update('app.lastDay', { roll1: { purchaseLevel: 40 } });
    assert.equal(currentPurchaseTicketLevel(), 40);
  });

  test('marks an existing level node without disturbing its component classes', () => {
    const classes = new Set(['rvl-pack-level']);
    const attrs = {};
    const element = {
      classList: { add: (name) => classes.add(name) },
      setAttribute: (name, value) => { attrs[name] = String(value); },
    };
    assert.equal(applyTicketLevelTone(element, 32, 28), 'orange');
    assert.deepEqual([...classes], ['rvl-pack-level', 'ticket-level-tone']);
    assert.equal(attrs['data-ticket-level-tone'], 'orange');
  });

  test('ships all five readable inline and pack-badge palettes', () => {
    for (const tone of ['white', 'green', 'yellow', 'orange', 'red']) {
      assert.match(APP_CSS, new RegExp(`data-ticket-level-tone="${tone}"`));
      assert.match(APP_CSS, new RegExp(`data-pack-level-tone="${tone}"`));
    }
    assert.match(APP_CSS, /\.rvl-pack-level\.ticket-level-tone/);
    assert.match(APP_CSS, /var\(--rvl-pack-face-top\)/,
      'pack faces consume the complementary palette instead of copying the level badge');
    assert.match(
      APP_CSS,
      /\.rvl-pack-level\.ticket-level-tone:not\(\[data-ticket-level-tone="unknown"\]\)\s*\{[^}]*background:\s*linear-gradient\(180deg, #111827, #030712\)/s,
      'pack level plates use neutral dark backing behind the bright level color',
    );
    assert.doesNotMatch(APP_CSS, /--ticket-level-pack-(?:ink|top|bottom)/,
      'pack labels never paint a level hue behind that same level color');
  });
});
