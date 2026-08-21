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
  burnRailBalances,
  formatBurnRailEth,
  formatBurnRailSignificant,
} = await import('../app-sdgnrs-burn-rail.js');

const INDEX = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../styles/sdgnrs-burn-rail.css', import.meta.url), 'utf8');
const COMPONENT = readFileSync(new URL('../app-sdgnrs-burn-rail.js', import.meta.url), 'utf8');
const TOKEN = 10n ** 18n;

describe('<app-sdgnrs-burn-rail>', () => {
  test('combines sDGNRS and DGNRS for one expected backing preview', () => {
    assert.deepEqual(burnRailBalances({
      sdgnrsBalance: String(8420n * TOKEN),
      dgnrsBalance: String(126n * TOKEN),
    }), {
      sdgnrs: 8420n * TOKEN,
      dgnrs: 126n * TOKEN,
      total: 8546n * TOKEN,
      known: true,
    });
    assert.deepEqual(burnRailBalances(null), {
      sdgnrs: 0n,
      dgnrs: 0n,
      total: 0n,
      known: false,
    });
  });

  test('uses at most two significant figures for the compact ETH line', () => {
    assert.equal(formatBurnRailSignificant('0.1374'), '0.14');
    assert.equal(formatBurnRailSignificant('8420'), '8400');
    assert.equal(formatBurnRailEth(137_400_000_000n), '0.14');
  });

  test('keeps the logo, conditional DGNRS, ETH + FLIP, Vote, and Burn in one short rail', () => {
    assert.match(COMPONENT, /class="sdgnrs-rail__logo"/);
    assert.match(COMPONENT, /data-bind="sdr-dgnrs-wrap" hidden/);
    assert.match(COMPONENT, /data-bind="sdr-plus" hidden/);
    assert.match(COMPONENT, /data-bind="sdr-vote"/);
    assert.match(COMPONENT, /SDGNRS_CHARITY_VOTE_DIALOG_REQUEST_EVENT/);
    assert.match(COMPONENT, /data-bind="sdr-burn"/);
    assert.match(CSS, /\.sdgnrs-rail\s*\{[^}]*min-height:\s*3\.15rem/s);
    assert.match(CSS, /@media \(max-width: 620px\)/);
    assert.doesNotMatch(COMPONENT, />\s*\*\s*</, 'the expected-value line has no asterisk');
  });

  test('mounts directly below AFKING PASSES and loads in the idle tier', () => {
    const passes = INDEX.indexOf('id="afking-passes"');
    const rail = INDEX.indexOf('<app-sdgnrs-burn-rail>');
    const history = INDEX.indexOf('<app-transaction-history>');
    assert.ok(passes >= 0 && passes < rail && rail < history);
    assert.match(INDEX, /'\/app\/components\/app-sdgnrs-burn-rail\.js'/);
  });
});
