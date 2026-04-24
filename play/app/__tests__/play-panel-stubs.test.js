// test file for Phase 50 Wave 0 -- Plan 50-01
//
// Covers: ROUTE-02, DAY-01, and every panel stub contract
//
// For each of the 7 panel Custom Element files plus player-selector and
// day-scrubber, assert file exists, customElements.define call is present,
// class extends HTMLElement, connectedCallback + disconnectedCallback are
// present (no-leak), skeleton-shimmer is in the template, and day/player
// subscriptions use the reused beta store. Currently FAILS -- Plan 50-03
// creates the component files and turns these green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// play/app/__tests__/ -> up 1 to play/app -> up 1 to play
const PLAY_ROOT = join(__dirname, '../..');
const COMPONENTS = join(PLAY_ROOT, 'components');

// Panel list: day-scoped vs level-scoped subscription semantics.
// Phase 50 baseline had every panel subscribe to replay.day for day-awareness.
// Phase 54 Wave 1 evolves baf-panel to be level-scoped (replay.level) because
// BAF is triggered by level multiples of 10, not by daily cadence. Wave 0's
// play-baf-panel.test.js explicitly asserts the replay.level + replay.player
// subscription, superseding the Phase 50 blanket assertion for baf-panel.
const PANEL_STUBS = [
  { file: 'profile-panel.js', tag: 'profile-panel', scope: 'day' },
  { file: 'packs-panel.js', tag: 'packs-panel', scope: 'day' },
  { file: 'tickets-panel.js', tag: 'tickets-panel', scope: 'day' },
  { file: 'purchase-panel.js', tag: 'purchase-panel', scope: 'day' },
  { file: 'coinflip-panel.js', tag: 'coinflip-panel', scope: 'day' },
  { file: 'baf-panel.js', tag: 'baf-panel', scope: 'level' },
  { file: 'decimator-panel.js', tag: 'decimator-panel', scope: 'day' },
  { file: 'jackpot-panel-wrapper.js', tag: 'jackpot-panel-wrapper', scope: 'day' },
];

for (const { file, tag, scope } of PANEL_STUBS) {
  const PATH = join(COMPONENTS, file);

  test(`${file} exists`, () => {
    assert.ok(existsSync(PATH), `expected play/components/${file} to exist (Plan 50-03)`);
  });

  test(`${file} registers <${tag}> custom element`, () => {
    const src = readFileSync(PATH, 'utf8');
    assert.match(src, new RegExp(`customElements\\.define\\(\\s*['"]${tag}['"]`));
  });

  test(`${file} defines a class extending HTMLElement`, () => {
    const src = readFileSync(PATH, 'utf8');
    assert.match(src, /class\s+\w+\s+extends\s+HTMLElement/);
  });

  test(`${file} has connectedCallback`, () => {
    const src = readFileSync(PATH, 'utf8');
    assert.match(src, /connectedCallback\s*\(/);
  });

  test(`${file} has disconnectedCallback (no-leak)`, () => {
    const src = readFileSync(PATH, 'utf8');
    assert.match(src, /disconnectedCallback\s*\(/);
  });

  test(`${file} renders skeleton-shimmer in template`, () => {
    const src = readFileSync(PATH, 'utf8');
    assert.match(src, /skeleton-shimmer/);
  });

  if (scope === 'day') {
    test(`${file} subscribes to replay.day (day-awareness proof)`, () => {
      const src = readFileSync(PATH, 'utf8');
      assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
    });
  } else if (scope === 'level') {
    test(`${file} subscribes to replay.level (level-awareness proof; Phase 54 semantic)`, () => {
      const src = readFileSync(PATH, 'utf8');
      assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
    });
  }

  test(`${file} subscribes to replay.player (player-awareness proof)`, () => {
    const src = readFileSync(PATH, 'utf8');
    assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
  });

  test(`${file} imports subscribe from reused beta store`, () => {
    const src = readFileSync(PATH, 'utf8');
    assert.match(
      src,
      /from\s*['"]\.\.\/\.\.\/beta\/app\/store\.js['"]/,
      `${file} must import from ../../beta/app/store.js`,
    );
  });
}

// player-selector specific tests (ROUTE-02)
const PLAYER_SELECTOR = join(COMPONENTS, 'player-selector.js');

test('player-selector.js exists', () => {
  assert.ok(existsSync(PLAYER_SELECTOR), 'expected play/components/player-selector.js to exist');
});

test('player-selector exports initPlayerSelector', () => {
  const src = readFileSync(PLAYER_SELECTOR, 'utf8');
  assert.match(src, /export\s+(async\s+)?function\s+initPlayerSelector/);
});

test('player-selector fetches /replay/players', () => {
  const src = readFileSync(PLAYER_SELECTOR, 'utf8');
  assert.match(src, /\/replay\/players/);
});

test('player-selector reads archetype JSON (shared or beta/viewer location)', () => {
  const src = readFileSync(PLAYER_SELECTOR, 'utf8');
  // Plan 02 chooses: either the moved /shared/ path or the legacy /beta/viewer/ path.
  assert.match(
    src,
    /\/shared\/player-archetypes\.json|\/beta\/viewer\/player-archetypes\.json/,
  );
});

// day-scrubber specific tests (DAY-01)
const DAY_SCRUBBER = join(COMPONENTS, 'day-scrubber.js');

test('day-scrubber.js exists', () => {
  assert.ok(existsSync(DAY_SCRUBBER), 'expected play/components/day-scrubber.js to exist');
});

test('day-scrubber registers <day-scrubber>', () => {
  const src = readFileSync(DAY_SCRUBBER, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]day-scrubber['"]/);
});

test('day-scrubber imports createScrubber from beta/viewer/scrubber.js', () => {
  const src = readFileSync(DAY_SCRUBBER, 'utf8');
  assert.match(
    src,
    /import\s*\{\s*createScrubber\s*\}\s*from\s*['"]\.\.\/\.\.\/beta\/viewer\/scrubber\.js['"]/,
  );
});
