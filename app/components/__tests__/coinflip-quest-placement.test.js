import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CHIPSET_CSS = readFileSync(new URL('../../styles/coinflip-chipset.css', import.meta.url), 'utf8');
const DAILY_FLIP_SOURCE = readFileSync(new URL('../app-daily-flip.js', import.meta.url), 'utf8');

test('Coinflip quest docks at Today’s upper-left corner and points down-right', () => {
  assert.match(
    CHIPSET_CSS,
    /\.df-table-quest,\s*body\.layout-basic \.jackpot-hero \.df-table-quest\s*\{[^}]*top:\s*calc\(50% \+ 0\.45rem\);[^}]*left:\s*calc\(50% - min\(6\.8rem, calc\(50% - 3rem\)\) - 0\.3rem\);/s,
  );
  assert.match(
    DAILY_FLIP_SOURCE,
    /class="df-table-quest"\s+data-quest-pointer="bottom-right"\s+product="coinflip"/s,
  );
});
