import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

globalThis.HTMLElement ??= class HTMLElement {};
globalThis.customElements ??= {
  get() { return null; },
  define() {},
};

const {
  allInMachineControlActive,
} = await import('../app-all-in-machine-control.js');

const component = readFileSync(new URL('../app-all-in-machine-control.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const drawingCss = readFileSync(new URL('../../styles/daily-drawing.css', import.meta.url), 'utf8');
const purchaseCss = readFileSync(new URL('../../styles/purchase-desk.css', import.meta.url), 'utf8');
const buttonAsset = new URL('../../assets/jackpot/all-in-button-v1.webp', import.meta.url);

describe('cabinet-mounted ALL IN control', () => {
  test('the earned gate swaps one permanent socket footprint to the active button', () => {
    assert.equal(allInMachineControlActive({ eligible: false, preferred: true }), false,
      'low-score players keep the empty socket');
    assert.equal(allInMachineControlActive({ eligible: true, preferred: true }), true,
      'earned and enabled players receive the red control');
    assert.equal(allInMachineControlActive({ eligible: true, preferred: false }), false,
      'the existing player preference still parks the button');
    assert.match(component, /subscribe\('ui\.allInEligible'/);
    assert.match(component, /data-bind="all-in-machine-socket"/);
    assert.match(component, /data-bind="all-in-machine-button"/);
    assert.match(component, /all-in-button-v1\.webp/);
    assert.match(component,
      /await import\('\.\/app-all-in-dialog\.js'\)[\s\S]*readyController\.click\?\.\(\)/,
      'the chooser is loaded before the cabinet face delegates to the transaction owner');
  });

  test('the fitting mirrors the Chainlink package and never collapses', () => {
    assert.match(html,
      /<div class="jackpot-hero__machine">[\s\S]*?<app-all-in-machine-control>[\s\S]*?<h2 class="jackpot-hero__draw-title"/,
      'the control lives inside the fixed drawing machine');
    assert.match(html, /src="\/app\/components\/app-all-in-machine-control\.js"/);
    assert.match(drawingCss,
      /--jp-action-width:\s*min\(var\(--jp-board-size\), 18rem\)[^}]*--jp-chainlink-size:\s*clamp\(2\.3rem, 7\.6cqi, 2\.9rem\)[^}]*--jp-chainlink-gap:\s*clamp\(1\.15rem, 4\.2cqi, 1\.8rem\)/s);
    assert.match(drawingCss,
      /\.jackpot-hero__machine > app-all-in-machine-control\s*\{[^}]*position:\s*absolute[^}]*left:\s*calc\(50% - \(var\(--jp-action-width\) \/ 2\) - var\(--jp-chainlink-gap\) - var\(--jp-chainlink-size\)\)[^}]*bottom:\s*var\(--jp-chainlink-size\)[^}]*width:\s*var\(--jp-chainlink-size\)[^}]*aspect-ratio:\s*1/s,
      'ALL IN uses the same package size and mirrored horizontal/vertical offsets');
    assert.match(drawingCss,
      /\.jackpot-chainlink--right\s*\{[^}]*left:\s*calc\(100% \+ var\(--jp-chainlink-gap\)\)/s,
      'Chainlink leaves the center action by the same shared gap');
    assert.match(drawingCss,
      /\.jackpot-all-in-socket\s*\{[^}]*border:\s*1px solid rgba\(235, 229, 201, 0\.2\)[^}]*background:\s*rgba\(255, 255, 255, 0\.012\)/s,
      'the locked state leaves the cabinet visible through only a faint circle');
    assert.match(drawingCss,
      /\.jackpot-all-in-socket__port\s*\{[^}]*width:\s*34%[^}]*background:\s*linear-gradient\(145deg, #202323, #050606 68%\)/s,
      'the faint circle carries a compact black motherboard power header');
    assert.equal(
      (component.match(/class="jackpot-all-in-socket__pin"/g) || []).length,
      4,
      'the header exposes a real 2×2 four-pin layout',
    );
    assert.match(component,
      /jackpot-all-in-socket__label" aria-hidden="true">AI<\/span>/,
      'the no-button fitting carries its AI board designator');
    assert.match(drawingCss,
      /\.jackpot-all-in-socket__label\s*\{[^}]*top:\s*calc\(100% \+ clamp\([^}]*color:\s*rgba\(207, 184, 116, 0\.38\)[^}]*ui-monospace/s,
      'AI is faint board silkscreen positioned below the power connector');
    assert.match(drawingCss,
      /\.jackpot-all-in-socket__pins\s*\{[^}]*grid-template-columns:\s*repeat\(2,[^}]*grid-template-rows:\s*repeat\(2,/s,
      'the four contacts stay arranged like an ATX12V motherboard socket');
    const hoverRule = drawingCss.match(
      /\.jackpot-all-in-button:hover:not\(:disabled\),[\s\S]*?\.jackpot-all-in-button:focus-visible:not\(:disabled\)\s*\{([^}]*)\}/,
    )?.[1] || '';
    assert.match(hoverRule, /drop-shadow\(0 0 9px rgba\(239, 38, 38, 0\.58\)\)/,
      'hover gives the cap a stationary red glow');
    assert.doesNotMatch(hoverRule, /transform:/,
      'hover never lifts or scales the physical button');
    assert.match(purchaseCss,
      /\.app-decimator-panel \.dec-all-in\s*\{[^}]*display:\s*none !important/s,
      'the former purchase-desk face no longer renders in its old location');
  });

  test('the generated production asset exists and is nontrivial', () => {
    assert.ok(statSync(buttonAsset).size > 8_000);
  });
});
