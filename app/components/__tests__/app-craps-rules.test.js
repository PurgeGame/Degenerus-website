import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

globalThis.HTMLElement ??= class HTMLElement {};
globalThis.customElements ??= {
  registry: new Map(),
  define(name, ctor) { this.registry.set(name, ctor); },
  get(name) { return this.registry.get(name); },
};

const componentUrl = new URL('../app-craps-rules.js', import.meta.url);
const appIndexUrl = new URL('../../index.html', import.meta.url);
const learnIndexUrl = new URL('../../../learn/index.html', import.meta.url);
const learnPageUrl = new URL('../../../learn/craps/index.html', import.meta.url);

const componentSource = readFileSync(componentUrl, 'utf8');
const appIndexSource = readFileSync(appIndexUrl, 'utf8');
const learnIndexSource = readFileSync(learnIndexUrl, 'utf8');
const learnPageSource = readFileSync(learnPageUrl, 'utf8');
const component = await import(componentUrl);

test('the Craps launcher mounts a dialog-only rules host', () => {
  assert.equal(customElements.get('app-craps-rules'), component.AppCrapsRules);
  assert.match(appIndexSource,
    /<app-craps-entry><\/app-craps-entry>\s*<app-craps-rules hidden><\/app-craps-rules>/,
    'the rules dialog remains separate from gameplay state');
  assert.match(appIndexSource, /['"]\/app\/components\/app-craps-rules\.js['"]/,
    'the idle module loader upgrades the static host');
  assert.match(componentSource, /:host\s*\{[\s\S]*?grid-area:\s*craps;[\s\S]*?width:\s*0;[\s\S]*?height:\s*0;[\s\S]*?pointer-events:\s*none;/,
    'the dialog host has no visible or clickable launcher chrome');
  assert.doesNotMatch(componentSource, /craps-rules__trigger|How Craps Autobattle works/,
    'the retired floating info button is absent');
});

test('the rules popup uses native dialog behavior with a safe fallback', () => {
  assert.match(componentSource,
    /<dialog[^>]*id="craps-rules-dialog"[^>]*aria-labelledby="craps-rules-title"[^>]*aria-describedby="craps-rules-summary"/);
  assert.match(componentSource, /typeof dialog\.showModal === 'function'[\s\S]*?dialog\.showModal\(\)/,
    'supporting browsers enter the modal top layer');
  assert.match(componentSource, /dialog\.setAttribute\('open', ''\)/,
    'older test and browser environments retain a usable fallback');
  assert.match(componentSource, /event\.key === 'Escape'[\s\S]*?this\.close\(\)/,
    'Escape also closes the fallback dialog');
  assert.match(componentSource, /this\.#returnFocus\?\.focus\?\./,
    'focus returns to whichever rules control opened the popup');
  assert.match(componentSource,
    /addEventListener\('craps-rules:open',[\s\S]*?this\.open\(event\?\.detail\?\.trigger\)/,
    'the existing popup accepts open requests from the inline felt spot');
  assert.match(componentSource, /querySelector\('\.craps-rules__body'\)\.scrollTop = 0/,
    'each open starts at the beginning of the explanation');
  assert.match(componentSource, /@media \(prefers-reduced-motion: reduce\)/,
    'the popup removes decorative motion when requested');
  assert.match(componentSource, /href="\/learn\/craps\/"/,
    'the compact popup routes to the full rules');
});

test('the popup leads with the run loop and states the Run It Up qualification', () => {
  assert.doesNotMatch(componentSource, /Pass · 1:1|Place · 7:6|Hard 4 \/ 8|Don&apos;t Pass · 3:4/,
    'bet payout odds belong on the full learn page, not in the quick popup');
  assert.match(componentSource, /Every 3 shooters, all bets are doubled/i,
    'the mandatory wager escalation stays in the quick explanation');
  assert.match(componentSource, /run your stack up to 5× your starting bankroll/i,
    'the goal is stated relative to the starting bankroll');
  assert.match(componentSource, /RUN IT UP\.<\/strong>/);
  assert.match(componentSource, /Win the main Battle/);
  assert.match(componentSource, /25× your starting bankroll/);
  assert.match(componentSource, /120×/);
  assert.match(componentSource, /biggest shares awarded in the daily Event/);
  assert.doesNotMatch(componentSource, /class="craps-rules__riu"/,
    'Run It Up shares the plain section layout');
});

test('the full Craps primer is indexed and covers the current run rules', () => {
  assert.match(learnIndexSource,
    /href="\/learn\/craps\/"[\s\S]*?Craps Autobattle[\s\S]*?ten-chip board/,
    'Craps is discoverable from the mechanics index');
  assert.match(learnPageSource, /<title>Craps Autobattle · Degenerus Mechanics<\/title>/);
  assert.match(learnPageSource, /zero through seven|0[^<]*through[^<]*7/i,
    'the page explains the chosen-chip continuum');
  assert.match(learnPageSource, /ten-chip|10-chip/i);
  assert.match(learnPageSource, /same dice|shared dice/i);
  assert.match(learnPageSource, /every three shooters/i);
  assert.match(learnPageSource, /survival flip/i);
  assert.match(learnPageSource, /5x|5×/i);
  assert.match(learnPageSource, /high point/i);
  assert.match(learnPageSource, /Goal[^<]*(?:paid|credit)|Goal[\s\S]{0,220}(?:paid|credit)/i);
  assert.match(learnPageSource, /Bust[^<]*(?:zero|nothing)|Bust[\s\S]{0,220}(?:zero|nothing)/i);
  assert.match(learnPageSource, /High Roller/);
  assert.match(learnPageSource, /Run It Up/);
  assert.match(learnPageSource, /can lose|loss|lose/i,
    'the primer states the player risk directly');
  assert.match(learnPageSource, /href="\/app\/"[^>]*>Play Craps<\/a>/);
});
