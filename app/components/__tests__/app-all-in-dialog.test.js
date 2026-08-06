import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.HTMLElement ??= class HTMLElement {};
globalThis.customElements ??= {
  registry: new Map(),
  define(name, ctor) { this.registry.set(name, ctor); },
  get(name) { return this.registry.get(name); },
};

const DIALOG_SRC = readFileSync(new URL('../app-all-in-dialog.js', import.meta.url), 'utf8');
const INDEX_SRC = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');

describe('standalone ALL IN chooser', () => {
  test('dice selects only from the supplied eligible formats', async () => {
    const { randomAllInTarget, randomAllInSelection } = await import('../app-all-in-dialog.js');
    const formats = ['coinflip', 'degenerette', 'tickets'];
    assert.equal(randomAllInTarget(formats, () => 0), 'coinflip');
    assert.equal(randomAllInTarget(formats, () => 0.5), 'degenerette');
    assert.equal(randomAllInTarget(formats, () => 0.9999), 'tickets');
    assert.equal(randomAllInTarget([], () => 0.5), null);

    const rolls = [0.5, 0.999];
    const blind = randomAllInSelection({
      destinations: formats,
      currency: 'FLIP',
      maxSpins: 4,
      quote: ({ target, spins }) => ({ valid: target !== 'degenerette' || spins <= 4 }),
      random: () => rolls.shift(),
    });
    assert.deepEqual(blind, { target: 'degenerette', spins: 4 },
      'the destination is selected first, then a valid spin count only for Degenerette');
  });

  test('currency comes first and deliberately offers only ETH and FLIP', () => {
    assert.match(DIALOG_SRC, /1 · CURRENCY/);
    assert.match(DIALOG_SRC, /data-currency="ETH"/);
    assert.match(DIALOG_SRC, /data-currency="FLIP"/);
    assert.doesNotMatch(DIALOG_SRC, /WWXRP/i);
    assert.match(DIALOG_SRC, /crypto_06_ethereum_green\.svg/);
    assert.match(DIALOG_SRC, /flame-logo-split\.svg/);
  });

  test('random is a peer format that keeps its destination and spin count blind', () => {
    for (const target of ['tickets', 'lootbox', 'degenerette', 'coinflip', 'random']) {
      assert.match(DIALOG_SRC, new RegExp(`data-target="${target}"`));
    }
    assert.match(DIALOG_SRC, /🎲 RANDOM/);
    assert.doesNotMatch(DIALOG_SRC, /data-bind="allin-dice"/);
    assert.match(DIALOG_SRC, /type="range" name="allin-spins"/);
    assert.match(DIALOG_SRC, /data-bind="allin-spins-value"/);
    assert.doesNotMatch(DIALOG_SRC, /allin-spins-(?:down|up)/,
      'Degenerette spins use one scrollable range instead of minus/plus selectors');
    assert.match(DIALOG_SRC, /quote\?\.buttonLabel/);
    assert.match(DIALOG_SRC, /quote\.fingerprint/);
    assert.match(DIALOG_SRC, /ALL IN BLIND: \$\{quote\.spendLabel\}/);
    assert.match(DIALOG_SRC, /target !== 'degenerette'[\s\S]*?spinsByTarget/s,
      'the hidden Degenerette route randomizes among valid spin counts');
    assert.match(DIALOG_SRC, /this\.#target !== 'random' && !destinations\.includes\(this\.#target\)/,
      'rendering preserves the RANDOM chooser instead of resetting it to the first concrete format');
    assert.doesNotMatch(DIALOG_SRC, /Your existing balance mode and form amounts stay unchanged/);
    assert.doesNotMatch(DIALOG_SRC, /Ready for one exact transaction/);
    assert.doesNotMatch(DIALOG_SRC, /data-bind="allin-quote"/);
  });

  test('the app mounts a scroll-locked red sheet with a large final button', () => {
    assert.match(INDEX_SRC, /<app-all-in-dialog><\/app-all-in-dialog>/);
    assert.match(INDEX_SRC, /src="\/app\/components\/app-all-in-dialog\.js"/);
    assert.match(DIALOG_SRC, /import \{ lock, unlock \} from '\.\.\/app\/scroll-lock\.js'/);
    assert.match(DIALOG_SRC, /app-all-in:open/);
    assert.match(APP_CSS, /\.allin-confirm\s*\{[^}]*min-height:\s*3\.25rem[^}]*#ef4444[^}]*font-size:/s);
    assert.match(APP_CSS, /\.allin-currencies\s*\{[^}]*repeat\(2, minmax\(0, 7\.5rem\)\)[^}]*justify-content:\s*center/s,
      'ETH and FLIP stay tall enough to tap but no longer stretch across the dialog');
    assert.match(APP_CSS, /\.allin-currency img\s*\{[^}]*width:\s*2\.55rem;[^}]*height:\s*2\.55rem/s,
      'both currency marks use the same larger image box');
    assert.match(APP_CSS, /\.allin-currency\[data-currency="ETH"\] img\s*\{[^}]*scale\(1\.304\)/s,
      'the padded ETH SVG is optically normalized to the FLIP circle');
    assert.match(APP_CSS, /\.allin-dialog__card\s*\{[^}]*width:\s*min\(94vw, 28rem\)[^}]*gap:\s*0\.48rem/s);
    assert.match(DIALOG_SRC, /class="allin-too-risky" data-bind="allin-close">TOO RISKY/);
    assert.doesNotMatch(DIALOG_SRC, /qst-action-dialog__close/,
      'the TOO RISKY action replaces the redundant top-right close button');
    assert.match(APP_CSS, /\.allin-too-risky\s*\{[^}]*min-height:\s*3\.05rem[^}]*#ec4899/s);
    assert.match(APP_CSS, /\.allin-spins\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\)[^}]*margin-top:\s*-0\.2rem/s);
    assert.match(APP_CSS, /\.allin-spins__range\s*\{[^}]*appearance:\s*none[^}]*cursor:\s*ew-resize/s);
  });
});
