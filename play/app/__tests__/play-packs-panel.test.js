// test file for Phase 52 Wave 5 -- Plan 52-05 (packs-v2 RED harness)
//
// Covers: PACKS-01, PACKS-02, PACKS-03, PACKS-04, PACKS-05 via the v2
// day-keyed mental model from PACKS-V2-SPEC.md.
//
// Asserts the contract the v2 <packs-panel> Custom Element will satisfy
// after Plan 52-07 ships. Currently FAILS against the v1 implementation
// on v2-specific assertions; all pack-animator.js + pack-audio.js
// assertions continue to pass.
//
// Test style: contract-grep (readFileSync + regex). Mirrors
// play/app/__tests__/play-tickets-panel.test.js.

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
// Existence + registration + class shell (carry-over from v1)
// ---------------------------------------------------------------------------

test('packs-panel.js exists', () => {
  assert.ok(existsSync(PANEL), 'expected play/components/packs-panel.js to exist');
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

test('packs-panel.js imports subscribe from reused beta store', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/\.\.\/beta\/app\/store\.js['"]/);
});

test('packs-panel.js renders skeleton-shimmer in template', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /skeleton-shimmer/);
});

// ---------------------------------------------------------------------------
// v2 subscribe shape: replay.day + replay.player ONLY (no replay.level)
// ---------------------------------------------------------------------------

test('v2: packs-panel.js subscribes to replay.day', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
});

test('v2: packs-panel.js subscribes to replay.player', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
});

test('v2: packs-panel.js does NOT subscribe to replay.level', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /subscribe\(\s*['"]replay\.level['"]/,
    'v2 packs-panel is day-keyed; replay.level subscription must be dropped per PACKS-V2-SPEC.md line 176');
});

// ---------------------------------------------------------------------------
// v2 fetch shape: fetchDayPacks from day-packs-fetch.js (NOT fetchTicketsByTrait)
// ---------------------------------------------------------------------------

test('v2: packs-panel.js imports fetchDayPacks from day-packs-fetch.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/app\/day-packs-fetch\.js['"]/,
    'v2 imports day-keyed helper; fetchTicketsByTrait is v1');
  assert.match(src, /\bfetchDayPacks\b/);
});

test('v2: packs-panel.js does NOT import fetchTicketsByTrait', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /\bfetchTicketsByTrait\b/,
    'v2 uses fetchDayPacks instead; level-keyed fetcher is v1 only');
});

test('v2: packs-panel.js uses #dayPacksFetchId stale-guard counter', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#dayPacksFetchId/);
});

test('v2: packs-panel.js toggles is-stale class for keep-old-data-dim', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});

// ---------------------------------------------------------------------------
// v2 render shape: two sections (lootbox-grid + ticket-pack-grid)
// ---------------------------------------------------------------------------

test('v2: packs-panel.js renders lootbox-grid data-bind marker', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']lootbox-grid["']/,
    'v2 renders a dedicated lootbox section per PACKS-V2-SPEC.md lines 184-188');
});

test('v2: packs-panel.js renders ticket-pack-grid data-bind marker', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']ticket-pack-grid["']/,
    'v2 renders a dedicated ticket-reveal section per PACKS-V2-SPEC.md lines 189-194');
});

test('v2: packs-panel.js renders packs-section CSS class', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\bpacks-section\b/,
    'v2 groups each of the two render sections with class="packs-section" per PACKS-V2-SPEC.md line 183');
});

test('v2: packs-panel.js references lootboxPacks from response', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\blootboxPacks\b/,
    'v2 iterates over response.lootboxPacks per PACKS-V2-SPEC.md line 47');
});

test('v2: packs-panel.js references ticketRevealPacks from response', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\bticketRevealPacks\b/,
    'v2 iterates over response.ticketRevealPacks per PACKS-V2-SPEC.md line 60');
});

test('v2: packs-panel.js references ticket-pack class for sealed tiles', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\bticket-pack\b/,
    'v2 sealed ticket-reveal tiles carry the ticket-pack class per PACKS-V2-SPEC.md line 206');
});

test('v2: packs-panel.js attaches click handler for GSAP reveal', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /addEventListener\(\s*['"]click['"]/,
    'v2 ticket-pack tiles are clickable; lootbox tiles auto-reveal per PACKS-V2-SPEC.md line 199');
});

test('v2: packs-panel.js imports animatePackOpen from pack-animator.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/app\/pack-animator\.js['"]/);
  assert.match(src, /\banimatePackOpen\b/);
});

test('v2: packs-panel.js imports pack-audio helpers', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/app\/pack-audio\.js['"]/);
});

test('v2: packs-panel.js renders empty-day copy', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /No packs revealed on day/,
    'v2 empty-state copy per PACKS-V2-SPEC.md line 200');
});

test('v2: packs-panel.js uses traitToBadge or /badges-circular/ for trait SVG rendering', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\btraitToBadge\b|\/badges-circular\//,
    'v2 reuses the existing badge-inventory traitToBadge() helper per PACKS-V2-SPEC.md line 83');
});

// ---------------------------------------------------------------------------
// Mute toggle + localStorage (D-10; carry-over from v1)
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
// SHELL-01 inverse assertion (explicit panel-level guard)
// ---------------------------------------------------------------------------

test('packs-panel.js is wallet-free (no ethers, no beta/app/utils.js)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"]ethers['"]/);
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/wallet\.js['"]/);
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/contracts\.js['"]/);
});

// ---------------------------------------------------------------------------
// play/app/pack-animator.js assertions (CARRY-OVER from v1; unchanged)
// ---------------------------------------------------------------------------

test('play/app/pack-animator.js exists', () => {
  assert.ok(existsSync(ANIMATOR), 'expected play/app/pack-animator.js to exist');
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
// play/app/pack-audio.js assertions (CARRY-OVER from v1; unchanged)
// ---------------------------------------------------------------------------

test('play/app/pack-audio.js exists', () => {
  assert.ok(existsSync(AUDIO), 'expected play/app/pack-audio.js to exist');
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
