import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const HEADERS = readFileSync(new URL('../../../_headers', import.meta.url), 'utf8');
const FUNDS_DIALOG = readFileSync(
  new URL('../../components/app-player-funds-dialog.js', import.meta.url),
  'utf8',
);
const CRAPS_ENTRY = readFileSync(
  new URL('../../components/app-craps-entry.js', import.meta.url),
  'utf8',
);
const CRAPS_TABLE = readFileSync(
  new URL('../../components/app-craps-table.js', import.meta.url),
  'utf8',
);

test('the LINK donation ABI dependency revalidates before a new importer can reuse it', () => {
  assert.match(
    HEADERS,
    /\/app\/app\/link-donation\.js\s*\n\s*! Cache-Control\s*\n\s*Cache-Control:\s*no-cache, must-revalidate/,
    'a new funds-dialog module cannot pair with a still-fresh older link-donation export surface',
  );
  assert.match(
    FUNDS_DIALOG,
    /from '\.\.\/app\/link-donation\.js\?rev=link-reward-v1'/,
    'localhost lazy imports cannot pair the new dialog API with a cached pre-quote dependency',
  );
});

test('the Craps entry pins the table module generation that supplies its public exports', () => {
  assert.match(
    CRAPS_ENTRY,
    /from '\.\/app-craps-table\.js\?rev=resolution-race-v3'/,
    'the entry cannot reuse the pre-race table generation after the resolver redesign lands',
  );
});

test('the Craps bonus reveal has a complete private lifecycle before the table is imported', () => {
  assert.match(CRAPS_TABLE, /#prepareBonusReveal\(onDone\)\s*\{/);
  assert.match(CRAPS_TABLE, /#beginBonusReveal\(\)\s*\{/);
  assert.match(CRAPS_TABLE, /#startBonusReveal\(onDone\)\s*\{/);
  assert.match(CRAPS_TABLE, /#settleBonusReveal\(\{ landed = false \} = \{\}\)\s*\{/);
  assert.match(CRAPS_TABLE, /this\.#prepareBonusReveal\(beginRolls\)/);
  assert.match(CRAPS_TABLE, /this\.#startBonusReveal\(onDone\)/);
  assert.match(CRAPS_TABLE, /this\.#settleBonusReveal\(\{ landed: true \}\)/);
});
