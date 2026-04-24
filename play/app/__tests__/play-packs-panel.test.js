// test file for Phase 52 Wave 0 -- Plan 52-01
//
// Covers: PACKS-01, PACKS-02, PACKS-03, PACKS-04, PACKS-05
//
// Asserts the contract the <packs-panel> Custom Element, the
// play/app/pack-animator.js helper, and the play/app/pack-audio.js helper
// must satisfy after Phase 52 Waves 1 and 2 ship. Currently FAILS until
// Wave 1 lands the markup + GSAP animator + Web Audio wrapper.
//
// Test style: contract-grep (readFileSync + regex). Mirrors
// play/app/__tests__/play-profile-panel.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'packs-panel.js');
const ANIMATOR = join(PLAY_ROOT, 'app', 'pack-animator.js');
const AUDIO = join(PLAY_ROOT, 'app', 'pack-audio.js');

// ---------------------------------------------------------------------------
// Existence + registration + class shell
// ---------------------------------------------------------------------------

test('packs-panel.js exists', () => {
  assert.ok(existsSync(PANEL), 'expected play/components/packs-panel.js to exist (Plan 52-02 delivers)');
});

test('packs-panel.js registers <packs-panel>', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]packs-panel['"]/);
});

test('packs-panel.js defines a class extending HTMLElement', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /class\s+\w+\s+extends\s+HTMLElement/);
});

test('packs-panel.js has connectedCallback and disconnectedCallback', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /connectedCallback\s*\(/);
  assert.match(src, /disconnectedCallback\s*\(/);
});

test('packs-panel.js subscribes to replay.day, replay.player, replay.level', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
});

test('packs-panel.js imports subscribe from reused beta store', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/\.\.\/beta\/app\/store\.js['"]/);
});

test('packs-panel.js renders skeleton-shimmer in template', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /skeleton-shimmer/);
});

// ---------------------------------------------------------------------------
// PACKS-01..05 behavioral assertions
// ---------------------------------------------------------------------------

test('PACKS-01: renders pack per card with purchase source class/tag', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /source\s*===\s*['"]purchase['"]|pack-source-purchase/);
});

test('PACKS-02: jackpot-win packs have gold-tint or pack-source-jackpot-win class', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /jackpot-win|gold-tint/);
});

test('PACKS-03: click handler on pack element', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /addEventListener\(\s*['"]click['"]/);
});

test('PACKS-03: pack-sealed class is rendered for pending/partial state', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /pack-sealed/);
});

test('PACKS-04: lootbox-source packs auto-trigger animation (lootbox branch present)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /source\s*===\s*['"]lootbox['"]|pack-source-lootbox|animatedCards/);
});

test('PACKS-05: imports pack-animator module', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/app\/pack-animator\.js['"]/);
});

test('PACKS-05: imports pack-audio module', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/app\/pack-audio\.js['"]/);
});

// ---------------------------------------------------------------------------
// Shared fetch + stale-guard + keep-old-data-dim
// ---------------------------------------------------------------------------

test('packs-panel.js imports fetchTicketsByTrait from tickets-fetch.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/app\/tickets-fetch\.js['"]/);
  assert.match(src, /\bfetchTicketsByTrait\b/);
});

test('packs-panel.js uses #packsFetchId stale-guard counter', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#packsFetchId/);
});

test('packs-panel.js toggles is-stale class for keep-old-data-dim', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});

// ---------------------------------------------------------------------------
// Mute toggle + localStorage (D-10)
// ---------------------------------------------------------------------------

test('packs-panel.js renders speaker-icon mute toggle', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']mute-toggle["']/);
});

test('packs-panel.js wires mute toggle via isMuted or localStorage', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /localStorage|isMuted|setMuted/);
});

// ---------------------------------------------------------------------------
// play/app/pack-animator.js assertions
// ---------------------------------------------------------------------------

test('play/app/pack-animator.js exists', () => {
  assert.ok(existsSync(ANIMATOR), 'expected play/app/pack-animator.js to exist (Plan 52-02 delivers)');
});

test('pack-animator.js exports animatePackOpen', () => {
  const src = readFileSync(ANIMATOR, 'utf8');
  assert.match(src, /export\s+function\s+animatePackOpen/);
});

test('pack-animator.js imports gsap', () => {
  const src = readFileSync(ANIMATOR, 'utf8');
  assert.match(src, /from\s+['"]gsap['"]/);
});

test('pack-animator.js honors prefers-reduced-motion', () => {
  const src = readFileSync(ANIMATOR, 'utf8');
  assert.match(src, /prefers-reduced-motion/);
});

test('pack-animator.js is wallet-free (no ethers, no beta/app/utils.js)', () => {
  const src = readFileSync(ANIMATOR, 'utf8');
  assert.doesNotMatch(src, /from\s+['"]ethers['"]/);
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});

// ---------------------------------------------------------------------------
// play/app/pack-audio.js assertions (D-10)
// ---------------------------------------------------------------------------

test('play/app/pack-audio.js exists', () => {
  assert.ok(existsSync(AUDIO), 'expected play/app/pack-audio.js to exist (Plan 52-02 delivers)');
});

test('pack-audio.js exports playPackOpen, isMuted, setMuted', () => {
  const src = readFileSync(AUDIO, 'utf8');
  assert.match(src, /export\s+(async\s+)?function\s+playPackOpen/);
  assert.match(src, /export\s+function\s+isMuted/);
  assert.match(src, /export\s+function\s+setMuted/);
});

test('pack-audio.js references /play/assets/audio/pack-open.mp3', () => {
  const src = readFileSync(AUDIO, 'utf8');
  assert.match(src, /pack-open\.mp3/);
});

test('pack-audio.js uses AudioContext + decodeAudioData (D-10)', () => {
  const src = readFileSync(AUDIO, 'utf8');
  assert.match(src, /AudioContext/);
  assert.match(src, /decodeAudioData/);
});

test('pack-audio.js persists mute via localStorage', () => {
  const src = readFileSync(AUDIO, 'utf8');
  assert.match(src, /localStorage/);
});

test('pack-audio.js fail-silent on error (console.warn somewhere)', () => {
  const src = readFileSync(AUDIO, 'utf8');
  assert.match(src, /console\.warn/);
});

test('pack-audio.js is wallet-free', () => {
  const src = readFileSync(AUDIO, 'utf8');
  assert.doesNotMatch(src, /from\s+['"]ethers['"]/);
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});
