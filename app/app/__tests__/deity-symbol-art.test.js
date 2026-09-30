import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTRACTS } from '../chain-config.js';
import { dgnBadgePath } from '../dgn-traits.js';
import { DEITY_CUSTOMIZATION_DEPLOYMENTS, __setDeityCustomizationFactoryForTest } from '../deity-customization.js';
import { recolorDeitySymbolRing, readDeitySymbolAppearance, invalidateDeitySymbolAppearance } from '../deity-symbol-art.js';

const originalFetch = globalThis.fetch;
let color, mask, reads, assetReads, fail;
const path = '/badges-circular/cards_01_king_silver.svg';
beforeEach(() => {
  invalidateDeitySymbolAppearance();
  color = '#fa12ab'; mask = 1; reads = 0; assetReads = 0; fail = false;
  __setDeityCustomizationFactoryForTest(address => address.toLowerCase() === CONTRACTS.DEITY_PASS.toLowerCase()
    ? { renderer: async () => DEITY_CUSTOMIZATION_DEPLOYMENTS[84532].renderer }
    : { pass: async () => CONTRACTS.DEITY_PASS, effectiveTokenStyle: async () => {
      reads++;
      if (fail) throw Error('RPC unavailable');
      return { colors: { rimColor: mask & 1 ? color : '#3f1a82' }, overrideMask: mask };
    } });
  globalThis.fetch = async url => {
    assetReads++;
    return { ok: true, text: async () => readFileSync(new URL(`../../..${url}`, import.meta.url), 'utf8') };
  };
});
afterEach(() => {
  invalidateDeitySymbolAppearance();
  __setDeityCustomizationFactoryForTest(null);
  globalThis.fetch = originalFetch;
});

test('all 32 standard symbols preserve every byte except the outer circle fill', () => {
  for (let symbol = 0; symbol < 32; symbol++) {
    const path = dgnBadgePath(symbol >> 3, symbol & 7, symbol === 0 ? 3 : symbol === 6 ? 2 : 6);
    const standard = readFileSync(new URL(`../../..${path}`, import.meta.url), 'utf8');
    const result = recolorDeitySymbolRing(standard, '#abcdef');
    assert.notEqual(result, standard);
    assert.equal(result.replace('fill="#abcdef"', `fill="${symbol === 0 ? '#ed0e11' : symbol === 6 ? '#30d100' : '#5e5e5e'}"`), standard);
  }
});

test('concurrent reads share the effective ring color and standard badge', async () => {
  const [first, second] = await Promise.all([readDeitySymbolAppearance(22, path), readDeitySymbolAppearance(22, path)]);
  assert.deepEqual(first, second);
  assert.equal(first.ringColor, color);
  assert.equal(reads, 1); assert.equal(assetReads, 1);
  assert.match(decodeURIComponent(first.src), /r="35\.2" fill="#fa12ab"/);
});

test('untouched and reset rims match inherited NFT artwork', async () => {
  mask = 32;
  assert.equal((await readDeitySymbolAppearance(22, path)).ringColor, '#3f1a82');
  mask = 1;
  invalidateDeitySymbolAppearance(22);
  assert.equal((await readDeitySymbolAppearance(22, path)).ringColor, color);
  mask = 0;
  invalidateDeitySymbolAppearance(22);
  assert.equal((await readDeitySymbolAppearance(22, path)).ringColor, '#3f1a82');
});

test('the desk and gameplay preserve their own base artwork when sharing a symbol', async () => {
  const goldPath = path.replace('_silver', '_gold');
  const [silver, gold] = await Promise.all([readDeitySymbolAppearance(22, path), readDeitySymbolAppearance(22, goldPath)]);
  assert.notEqual(silver.src, gold.src);
  for (const [appearance, asset] of [[silver, path], [gold, goldPath]]) {
    assert.equal(decodeURIComponent(appearance.src.split(',')[1]), recolorDeitySymbolRing(readFileSync(new URL(`../../..${asset}`, import.meta.url), 'utf8'), color));
  }
  color = '#abcdef';
  invalidateDeitySymbolAppearance(22);
  for (const asset of [path, goldPath]) assert.equal((await readDeitySymbolAppearance(22, asset)).ringColor, color);
});

test('failed reads fall back to the normal badge and retry without retaining a failed cache entry', async () => {
  fail = true;
  assert.equal(await readDeitySymbolAppearance(22, path), null);
  fail = false;
  assert.equal((await readDeitySymbolAppearance(22, path)).ringColor, color);
  assert.equal(reads, 2);
});
