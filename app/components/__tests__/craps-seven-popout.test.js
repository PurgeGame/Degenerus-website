import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class HTMLElement {};
globalThis.customElements ??= {
  registry: new Map(),
  define(name, constructor) { this.registry.set(name, constructor); },
  get(name) { return this.registry.get(name); },
};

const componentUrl = new URL('../app-craps-table.js', import.meta.url);
const cssUrl = new URL('../../styles/craps-table.css', import.meta.url);
const componentSource = fs.readFileSync(componentUrl, 'utf8');
const cssSource = fs.readFileSync(cssUrl, 'utf8');

test('seven popout semantics use pre-roll table state, never post-roll point state', async () => {
  const { crapsSevenRollOutcome } = await import(componentUrl);
  assert.equal(crapsSevenRollOutcome({ total: 7, label: 'COME-OUT 7' }, { comeOut: true }), 'win');
  assert.equal(crapsSevenRollOutcome({ total: 7, label: 'SEVEN OUT' }, { comeOut: false }), 'crap-out');
  assert.equal(crapsSevenRollOutcome({ total: 7, label: 'SEVEN-OUT' }, { comeOut: true }), 'crap-out');
  assert.equal(crapsSevenRollOutcome({ total: 6, label: 'POINT 6 MADE' }, { comeOut: false }), '');
  assert.match(componentSource, /const comeOut = table\?\.dataset\?\.board === 'come-out'/);
  assert.match(componentSource, /delete readout\.dataset\.sevenOutcome;[\s\S]*?readout\.hidden = true/s,
    'a later non-seven cannot retain the previous seven color');
});

test('the between-dice seven is green for a come-out win and red for crap-out', () => {
  assert.match(cssSource, /\[data-seven-outcome="win"\][\s\S]*?--craps-dice-lock-color:\s*#6ef08c/s);
  assert.match(cssSource, /\[data-seven-outcome="crap-out"\][\s\S]*?--craps-dice-lock-color:\s*#ff626b/s);
  assert.match(cssSource, /\.craps-dice-bay__lock-number[\s\S]*?color:\s*var\(--craps-dice-lock-color\)/s);
});

test('the expanding number uses one clean stroke instead of four separating shadows', () => {
  assert.match(cssSource,
    /\.craps-dice-bay__lock-number > span\s*\{[^}]*-webkit-text-stroke:\s*0\.055em[^}]*paint-order:\s*stroke fill/s);
  assert.doesNotMatch(cssSource,
    /\.craps-dice-bay__lock-number\s*\{[^}]*-2px -2px 0/s,
    'the wrapper no longer scales a four-corner faux outline');
  assert.match(cssSource,
    /@keyframes craps-dice-number-pop\s*\{[\s\S]*?scale\(0\.78\)[\s\S]*?scale\(1\.06\)[\s\S]*?34%, 78%[^}]*scale\(1\)/s,
    'the pop retains a small snap without the old 0.5x to 1.24x outline distortion');
});
