import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GOLD_SIX_MONKEY_BADGE, previewSpinTrait } from '../gold-six.js';
import { traitToBadge } from '../jackpot-data.js';
import { dgnBadgePath, dgnSymbolPath, issuedTicketBadgePath } from '../dgn-traits.js';
import { __setBadgeBundleForTest } from '../badge-sprite.js';

afterEach(() => __setBadgeBundleForTest(null));

test('only opted-in jackpot gold six uses the monkey; generic art stays ordinary', () => {
  for (let trait = 0; trait < 256; trait++) {
    assert.notEqual(traitToBadge(trait).path, GOLD_SIX_MONKEY_BADGE);
    assert.notEqual(traitToBadge(trait, { mainJackpot: false }).path, GOLD_SIX_MONKEY_BADGE);
    assert.equal(traitToBadge(trait, { mainJackpot: true }).path === GOLD_SIX_MONKEY_BADGE, trait === 253);
    assert.equal(issuedTicketBadgePath(trait >> 6, trait & 7, (trait >> 3) & 7) === GOLD_SIX_MONKEY_BADGE, trait === 253);
  }
  assert.equal(dgnBadgePath(3, 5, 7), '/app/assets/craps/dice_05_6_gold-standard.svg');
  assert.equal(dgnSymbolPath(3, 5, 7), '/symbols/dice_05_6_gold.svg?v=normal-gold-six-1');
});

test('every unlocked preview excludes gold six and preserves locked axes', () => {
  for (let q = 0; q < 4; q++) for (let sym = 0; sym < 8; sym++) for (let col = 0; col < 8; col++) {
    for (const [symbolLocked, colorLocked] of [[false, false], [true, false], [false, true]]) {
      const result = previewSpinTrait(q, sym, col, { symbolLocked, colorLocked });
      assert.notEqual(q * 64 + result.col * 8 + result.sym, 253);
      if (symbolLocked) assert.equal(result.sym, sym);
      if (colorLocked) assert.equal(result.col, col);
      if (q !== 3 || sym !== 5 || col !== 7) assert.deepEqual(result, { sym, col });
    }
    assert.deepEqual(previewSpinTrait(q, sym, col, { symbolLocked: true, colorLocked: true }), { sym, col },
      'the actual locked outcome must never be altered');
  }
});

test('warm and cold badge paths both use normal gold-six art', async () => {
  const bundle = JSON.parse(readFileSync(new URL('../../assets/badge-bundle-v3.json', import.meta.url), 'utf8'));
  __setBadgeBundleForTest(bundle);
  const warmed = await (await fetch(dgnBadgePath(3, 5, 7))).text();
  assert.match(warmed, /r="27\.5" fill="#111"/);
  assert.match(warmed, /r="19\.8" fill="#fff"/);
  assert.equal((warmed.match(/r="10" fill="#fff"/g) || []).length, 6);
  assert.doesNotMatch(warmed, /monkey/i);
  for (const directory of ['badges', 'badges-circular', 'badges-q0', 'badges-q1', 'badges-q2', 'badges-q3', 'symbols']) {
    const svg = readFileSync(new URL(`../../../${directory}/dice_05_6_gold.svg`, import.meta.url), 'utf8');
    assert.equal((svg.match(/r="10" fill="#fff"/g) || []).length, 6, `${directory} has ordinary white pips`);
    assert.doesNotMatch(svg, /r="27\.5" fill="#fff"|r="19\.8" fill="#111"/);
  }
});

test('the selected monkey keeps standard badge bounds and has no black inner ring', () => {
  const svg = readFileSync(new URL('../../assets/jackpot/gold-six-monkey-v1.svg', import.meta.url), 'utf8');
  assert.match(svg, /viewBox="-51 -51 102 102"/);
  assert.match(svg, /<circle r="35\.2" fill="#ab8d3f"/);
  assert.match(svg, /clipPath[^>]*><circle r="27\.5"/);
  assert.doesNotMatch(svg, /<circle[^>]*r="27\.5"[^>]*fill=/);
});
