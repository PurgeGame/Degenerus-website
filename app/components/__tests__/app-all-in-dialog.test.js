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
  test('every spend format maps to the quest it can finish', async () => {
    const { allInQuestProduct } = await import('../app-all-in-dialog.js');
    assert.equal(allInQuestProduct({ target: 'tickets', currency: 'ETH' }), 'purchase');
    assert.equal(allInQuestProduct({ target: 'tickets', currency: 'FLIP' }), 'redeem-flip');
    assert.equal(allInQuestProduct({ target: 'lootbox', currency: 'ETH' }), 'lootbox');
    assert.equal(allInQuestProduct({ target: 'coinflip', currency: 'FLIP' }), 'coinflip');
    assert.equal(allInQuestProduct({ target: 'decimator', currency: 'FLIP' }), 'decimator');
    assert.equal(allInQuestProduct({ target: 'degenerette', currency: 'ETH' }), 'degenerette-eth');
    assert.equal(allInQuestProduct({ target: 'degenerette', currency: 'FLIP' }), 'degenerette-flip');
    assert.equal(allInQuestProduct({ target: 'unknown', currency: 'ETH' }), null);
    assert.match(DIALOG_SRC, /data-bind="allin-quest-bonus"/);
    assert.match(DIALOG_SRC, /questCompletionBonusModel\([\s\S]*?quote\.spendWei/s);
    assert.match(APP_CSS, /\.allin-quest-bonus[^}]*#86efac/);
  });

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
    for (const target of ['tickets', 'lootbox', 'degenerette', 'coinflip', 'decimator', 'random']) {
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

  test('format slots stay fixed while closed FLIP tickets remain visibly unavailable', async () => {
    const { allInTargetState } = await import('../app-all-in-dialog.js');
    assert.deepEqual(allInTargetState({
      target: 'tickets', currency: 'FLIP', destinations: ['coinflip', 'degenerette'],
    }), {
      available: false,
      visible: true,
      unavailableLabel: 'REDEMPTION CLOSED',
    });
    assert.deepEqual(allInTargetState({
      target: 'tickets', currency: 'FLIP', destinations: ['coinflip', 'degenerette', 'tickets'],
    }), {
      available: true,
      visible: true,
      unavailableLabel: '',
    });
    assert.deepEqual(allInTargetState({
      target: 'lootbox', currency: 'FLIP', destinations: ['coinflip', 'degenerette'],
    }), {
      available: false,
      visible: false,
      unavailableLabel: '',
    });
    assert.deepEqual(allInTargetState({
      target: 'decimator', currency: 'FLIP', destinations: ['coinflip', 'degenerette'],
    }), {
      available: false,
      visible: false,
      unavailableLabel: '',
    });
    assert.deepEqual(allInTargetState({
      target: 'decimator', currency: 'FLIP', destinations: ['coinflip', 'degenerette', 'decimator'],
    }), {
      available: true,
      visible: true,
      unavailableLabel: '',
    });
    assert.match(APP_CSS,
      /\.allin-targets\s*\{[^}]*grid-template-areas:\s*"tickets primary" "degenerette random"/s,
      'the four visible format positions never repack between currencies');
    assert.match(APP_CSS,
      /button:is\(\[data-target="lootbox"\], \[data-target="coinflip"\]\)\s*\{[^}]*grid-area:\s*primary/s,
      'ETH Luckbox and FLIP Coinflip occupy the same fixed slot');
    assert.match(APP_CSS,
      /\.allin-targets\.has-decimator\s*\{[^}]*grid-template-areas:\s*"tickets primary" "degenerette random" "decimator decimator"/s,
      'an open Decimator adds its own full-width burn route without displacing the fixed four slots');
    assert.match(DIALOG_SRC,
      /destinations\.includes\('decimator'\)/,
      'the Decimator row appears only when the purchase controller reports its burn window open');
    assert.match(APP_CSS, /\.allin-targets button\.is-unavailable\s*\{[^}]*grayscale\(1\)[^}]*not-allowed/s,
      'closed FLIP tickets remain visible with an unmistakably disabled treatment');
  });

  test('the app mounts a scroll-locked red sheet with a large final button', () => {
    assert.match(INDEX_SRC, /<app-all-in-dialog><\/app-all-in-dialog>/);
    // Cold-load diet (2026-08-13): loads via the IDLE_MODULES registration,
    // not an eager script tag (dialog; unreachable before idle fires).
    assert.match(INDEX_SRC, /'\/app\/components\/app-all-in-dialog\.js'/);
    assert.match(DIALOG_SRC, /import \{ lock, unlock \} from '\.\.\/app\/scroll-lock\.js'/);
    assert.match(DIALOG_SRC, /app-all-in:open/);
    assert.match(DIALOG_SRC, /void this\.#refreshCurrencies\(\['ETH', 'FLIP'\]\)/,
      'opening the chooser warms both real quotes without requiring the privacy spoiler to be lifted');
    assert.match(DIALOG_SRC, /detail\.refreshCurrency\(currency\)/,
      'currency refreshes use the hidden balance source and re-render the quote');
    assert.match(DIALOG_SRC, /void this\.#refreshCurrency\(next\)/,
      'switching back to ETH refreshes it just as switching to FLIP does');
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
