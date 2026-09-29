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
  formatGnrusLifetimeFunding,
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
    assert.equal(formatGnrusLifetimeFunding(102_829_352_125_159n), '102.829');
    assert.equal(formatGnrusLifetimeFunding(null), '—');
  });

  test('keeps balances and redemption inline, with donation totals in the charity action', () => {
    assert.match(COMPONENT, /class="sdgnrs-rail__logo"/);
    assert.match(COMPONENT, /data-bind="sdr-dgnrs-wrap" hidden/);
    assert.match(COMPONENT, /data-bind="sdr-plus" hidden/);
    assert.match(COMPONENT, /GNRUS DONATIONS/);
    assert.match(COMPONENT, /data-bind="sdr-gnrus"/);
    assert.match(COMPONENT, /readGnrusLifetimeFunding/);
    assert.match(COMPONENT, /data-bind="sdr-vote"/);
    assert.match(COMPONENT, /SDGNRS_CHARITY_VOTE_DIALOG_REQUEST_EVENT/);
    assert.match(COMPONENT, /data-bind="sdr-burn"/);
    assert.ok(COMPONENT.indexOf('data-bind="sdr-gnrus"')
      > COMPONENT.indexOf('id="panel-token-details"'),
    'the details popup still explains the lifetime charity total');
    assert.match(COMPONENT, /data-bind="sdr-vote"[\s\S]*?data-bind="sdr-gnrus-total"[\s\S]*?ETH DONATED[\s\S]*?<\/button>/,
      'the live charity total is visible directly inside the Vote action');
    assert.match(COMPONENT, /data-bind="sdr-info"/);
    assert.ok(COMPONENT.indexOf('data-bind="sdr-eth"')
      < COMPONENT.indexOf('id="panel-token-details"'), 'approximate burn value stays beside the burn action');
    assert.match(COMPONENT,
      /sdgnrs-rail__vote-label"><span>CHARITY<\/span><span>VOTE<\/span>/,
      'the Vote action uses the requested two-line label');
    assert.match(CSS, /\.sdgnrs-rail\s*\{[^}]*min-height:\s*3\.15rem/s);
    assert.match(CSS,
      /grid-template-columns:\s*2\.8rem minmax\(0, 1\.2fr\) 5\.3rem minmax\(0, 1fr\) minmax\(0, 1fr\) 5\.3rem/,
      'each desktop action gets a fixed slot beside its related readout');
    assert.match(COMPONENT,
      /class="sdgnrs-rail__actions">[\s\S]*?data-bind="sdr-vote"[\s\S]*?data-bind="sdr-burn"/,
      'the stable action wrapper survives independent asset caching');
    assert.match(CSS, /\.sdgnrs-rail__actions\s*\{\s*display:\s*contents;/,
      'the wrapper cannot stack both controls in one grid cell');
    assert.match(CSS,
      /\.sdgnrs-rail__burn\s*\{\s*grid-column:\s*3;\s*grid-row:\s*1;/,
      'Burn occupies the first row immediately left of Expected Burn Value');
    assert.match(CSS,
      /\.sdgnrs-rail__vote\s*\{\s*grid-column:\s*6;\s*grid-row:\s*1;/,
      'Charity Vote owns its independent first-row right-hand column');
    assert.match(CSS,
      /\.sdgnrs-rail__vote\s*\{[^}]*grid-template-columns:\s*0\.78rem minmax\(0, 1fr\);[^}]*padding:\s*0\.28rem 0\.34rem;[^}]*font-size:\s*0\.58rem;[^}]*letter-spacing:\s*0\.075em;/s,
      'the two-line CHARITY label fits without clipping inside the fixed-width action');
    assert.match(CSS, /\.sdgnrs-rail__vote,[\s\S]*?\.sdgnrs-rail__burn\s*\{[^}]*width:\s*5\.3rem/s,
      'Vote and Burn have matching desktop widths');
    assert.match(CSS, /@media \(max-width: 620px\)/);
    assert.match(CSS,
      /\.sdgnrs-rail__metric--gnrus\s*\{[^}]*grid-column:\s*2 \/ 5;[^}]*grid-row:\s*2;/s,
      'the donation amount remains directly beside the Vote button on narrow screens');
    assert.doesNotMatch(COMPONENT, />\s*\*\s*</, 'the expected-value line has no asterisk');
  });

  test('mounts with WWXRP below tickets and loads from the bottom row', () => {
    const tickets = INDEX.indexOf('<app-tickets-inventory>');
    const tools = INDEX.indexOf('class="bottom-tools"');
    const wwxrp = INDEX.indexOf('<app-wwxrp-burn');
    const rail = INDEX.indexOf('<app-sdgnrs-burn-rail>');
    assert.ok(tickets >= 0 && tickets < tools && tools < wwxrp && wwxrp < rail);
    assert.ok(INDEX.includes("['.bottom-tools', '/app/components/app-sdgnrs-burn-rail.js']"),
      'the currency row triggers the token panel load');
  });
});
