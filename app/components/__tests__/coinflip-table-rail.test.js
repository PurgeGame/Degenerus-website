import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const CHIPSET_CSS = readFileSync(
  new URL('../../styles/coinflip-chipset.css', import.meta.url),
  'utf8',
);

test('coinflip uses a responsive whole-table rail and clears its instruments', () => {
  assert.match(
    CHIPSET_CSS,
    /\.app-daily-flip\s*\{[^}]*--df-table-rail-size:\s*0\.42rem;[^}]*--df-table-content-inset:/s,
  );
  assert.match(
    CHIPSET_CSS,
    /\.app-daily-flip::before\s*\{[^}]*radial-gradient\(circle at 0\.34rem 0\.34rem[^}]*content:\s*'';[^}]*pointer-events:\s*none;/s,
  );
  assert.match(
    CHIPSET_CSS,
    /\.app-daily-flip::after\s*\{[^}]*inset:\s*var\(--df-table-rail-size\);[^}]*border:\s*2px solid/s,
  );
  assert.match(
    CHIPSET_CSS,
    /\.df-modifier-meter-slot\s*\{[^}]*left:\s*var\(--df-table-content-inset\);/s,
  );
  assert.match(
    CHIPSET_CSS,
    /\.df-coinflip-record-rail\s*\{[^}]*right:\s*var\(--df-table-content-inset\);/s,
  );
  assert.match(
    CHIPSET_CSS,
    /\.df-auto-rebuy-cta\s*\{[^}]*right:\s*var\(--df-table-content-inset\);/s,
  );
  assert.match(
    CHIPSET_CSS,
    /\.df-auto-rebuy-cta__label\s*\{[^}]*transform:\s*translateX\(-0\.25rem\);/s,
  );
  assert.match(
    CHIPSET_CSS,
    /\.df-title-bar__heading\s*\{[^}]*transform:\s*translateY\(0\.12rem\);/s,
  );
  assert.match(
    CHIPSET_CSS,
    /\.df-reveal-cue\s*\{[^}]*right:\s*clamp\(3rem,\s*16%,\s*4rem\);[^}]*left:\s*auto;[^}]*justify-items:\s*end;[^}]*margin-inline:\s*0;/s,
  );
  assert.match(
    CHIPSET_CSS,
    /\.df-reveal-cue__arrow\s*\{[^}]*justify-self:\s*start;[^}]*transform:\s*rotate\(45deg\);/s,
  );
});

test('BAF remains in the lower-left green field inside the rail', () => {
  assert.match(
    CHIPSET_CSS,
    /\.df-baf-score\s*\{[^}]*top:\s*var\(--df-score-cap-top\);[^}]*right:\s*auto;[^}]*left:\s*var\(--df-table-content-inset\);[^}]*width:\s*5\.1rem;/s,
  );
  assert.doesNotMatch(
    CHIPSET_CSS,
    /\.df-table-watermark\s*\{[^}]*left:\s*(?:38|39)%;/s,
  );
});
