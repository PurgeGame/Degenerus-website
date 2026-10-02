import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers, setProvider, clearProvider } from '../contracts.js';
import { update, __resetForTest } from '../store.js';
import { CHAIN, CONTRACTS } from '../chain-config.js';
import {
  readDeityCustomization, readDeityRingColor, saveDeityCustomization, canCustomizeDeity,
  DEITY_CUSTOMIZATION_DEPLOYMENTS, DEITY_CUSTOMIZATION_ABI, __setDeityCustomizationFactoryForTest,
} from '../deity-customization.js';
import {
  DEITY_GEOMETRY_BOUNDS, normalizeDeityColors, deityDefaultColors, effectiveDeityColors,
  clampDeityGeometry, validateDeityGeometry, deityPositionLimit,
} from '../deity-art.js';

const OWNER = '0xab12000000000000000000000000000000000000';
const OTHER = '0xcd34000000000000000000000000000000000000';
const RENDERER = DEITY_CUSTOMIZATION_DEPLOYMENTS[84532].renderer;
const DEFAULTS = ['#3f1a82', '#d9d9d9', '#111111'];
let nft, renderer, calls, signerReads, preflightError;
const uri = `data:application/json,${encodeURIComponent(JSON.stringify({ image: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}` }))}`;

beforeEach(() => {
  __resetForTest();
  update('connected.address', OWNER); update('ui.mode', 'self');
  calls = []; signerReads = 0; preflightError = null;
  setProvider({ getNetwork: async () => ({ chainId: 84532n }), getSigner: async () => { signerReads++; return { getAddress: async () => OWNER }; } });
  nft = { renderer: async () => RENDERER, ownerOf: async () => OWNER, renderColors: async () => DEFAULTS, tokenURI: async () => uri };
  renderer = {
    pass: async () => CONTRACTS.DEITY_PASS,
    tokenCustomization: async () => [['#ff00ff', '', '', '#223344', ''], [2000n, 200n, -100n], 41n],
    effectiveTokenStyle: async () => [['#ff00ff', '#ffffff', '#111111', '#223344', '#3f1a82'], [2000n, 200n, -100n], 41n],
    geometryBounds: async () => Object.values(DEITY_GEOMETRY_BOUNDS).map(BigInt),
  };
  for (const method of ['setTokenColors', 'clearTokenColors', 'setTokenGeometry', 'clearTokenGeometry', 'clearTokenCustomization']) {
    renderer[method] = Object.assign(async (...args) => {
      calls.push({ method, args }); return { hash: '0x123', wait: async () => ({ status: 1, hash: '0x123' }) };
    }, { staticCall: async (...args) => { calls.push({ method: `${method}.staticCall`, args }); if (preflightError) throw preflightError; } });
  }
  __setDeityCustomizationFactoryForTest(address => address.toLowerCase() === CONTRACTS.DEITY_PASS.toLowerCase() ? nft : renderer);
});
afterEach(() => { __setDeityCustomizationFactoryForTest(null); clearProvider(); __resetForTest(); });
const save = extra => saveDeityCustomization({ symbolId: 8, owner: OWNER, renderer: RENDERER, ...extra });

test('customization targets the same Deity Pass deployment as purchases', () => {
  const deployment = DEITY_CUSTOMIZATION_DEPLOYMENTS[CHAIN.id];
  assert.ok(deployment, 'register the customization renderer when enabling a new chain');
  assert.equal(deployment.pass.toLowerCase(), CONTRACTS.DEITY_PASS.toLowerCase(),
    'update the verified customization deployment when redeploying the Deity Pass');
});

test('ABI encodes the deployed tuple setters and geometry reset', () => {
  const iface = new ethers.Interface(DEITY_CUSTOMIZATION_ABI);
  assert.equal(iface.getFunction('setTokenColors').format('sighash'), 'setTokenColors(uint256,(string,string,string,string,string))');
  assert.equal(iface.getFunction('setTokenGeometry').format('sighash'), 'setTokenGeometry(uint256,(uint16,int16,int16))');
});

test('reads raw inheritance separately from effective colors and detects geometry override', async () => {
  const state = await readDeityCustomization(8);
  assert.equal(state.colors.rimColor, '#ff00ff');
  assert.equal(state.colors.symbolColor, '');
  assert.equal(state.effectiveColors.symbolColor, '#111111');
  assert.equal(state.defaults.backgroundColor, '#d9d9d9');
  assert.equal(state.geometryOverride, true);
  assert.deepEqual(state.geometry, { radius: 2000, centerX: 200, centerY: -100 });
});

test('gameplay reads the effective NFT rim, including inherited colors, without fetching NFT artwork', async () => {
  nft.tokenURI = async () => { throw Error('Do not fetch artwork'); };
  renderer.tokenCustomization = async () => { throw Error('Do not use raw overrides'); };
  assert.equal(await readDeityRingColor(8), '#ff00ff');
  for (const mask of [0, 2, 4, 8, 16, 32, 62]) {
    renderer.effectiveTokenStyle = async () => ({ colors: { rimColor: '#3f1a82' }, overrideMask: mask });
    assert.equal(await readDeityRingColor(8), '#3f1a82', `mask ${mask} inherits the NFT's visible purple rim`);
  }
});

test('ring overrides reject invalid colors and ignore unrecognized renderers', async () => {
  renderer.effectiveTokenStyle = async () => ({ colors: { rimColor: 'url(unsafe)' }, overrideMask: 1 });
  await assert.rejects(readDeityRingColor(8), /Invalid Deity ring/);
  nft.renderer = async () => OTHER;
  assert.equal(await readDeityRingColor(8), null);
  nft.renderer = async () => RENDERER;
  renderer.pass = async () => OTHER;
  assert.equal(await readDeityRingColor(8), null);
});

test('rejects a changed renderer or mismatched immutable pass', async () => {
  nft.renderer = async () => OTHER;
  await assert.rejects(readDeityCustomization(8), /not active/);
  nft.renderer = async () => RENDERER; renderer.pass = async () => OTHER;
  await assert.rejects(readDeityCustomization(8), /does not match/);
});

test('does not treat an RPC failure as default artwork', async () => {
  renderer.tokenCustomization = async () => { throw Error('RPC unavailable'); };
  await assert.rejects(readDeityCustomization(8), /RPC unavailable/);
});

test('a single color edit preserves the other raw overrides, including inheritance', async () => {
  const state = await readDeityCustomization(8);
  await save({ kind: 'colors', colors: { ...state.colors, rimColor: '#ABCDEF' } });
  assert.deepEqual(calls.map(call => call.method), ['setTokenColors.staticCall', 'setTokenColors']);
  assert.deepEqual(calls[1].args, [8, { rimColor: '#abcdef', badgeBackgroundColor: '', symbolColor: '', backgroundColor: '#223344', outlineColor: '' }]);
});

test('geometry is sent atomically with both coordinates and without touching colors', async () => {
  await save({ kind: 'geometry', geometry: { radius: 1200, centerX: 3690, centerY: -3690 } });
  assert.deepEqual(calls.map(call => call.method), ['setTokenGeometry.staticCall', 'setTokenGeometry']);
  assert.deepEqual(calls[1].args, [8, { radius: 1200, centerX: 3690, centerY: -3690 }]);
});

for (const [kind, expected] of [['colors', 'clearTokenColors'], ['geometry', 'clearTokenGeometry'], ['all-defaults', 'clearTokenCustomization']]) {
  test(`${kind} defaults use the matching clear operation`, async () => {
    await save({ kind, colors: {}, geometry: null });
    assert.equal(calls[1].method, expected); assert.deepEqual(calls[1].args, [8]);
  });
}

for (const mode of ['view', 'combined', 'operator']) {
  test(`${mode} sessions cannot start a holder customization write`, async () => {
    update('ui.mode', mode);
    assert.equal(canCustomizeDeity(OWNER), false);
    await assert.rejects(save({ kind: 'colors', colors: { rimColor: '#ff0000' } }), /wallet that owns/);
    assert.equal(signerReads, 0); assert.equal(calls.length, 0);
  });
}

test('rechecks chain ownership and active renderer immediately before preflight', async () => {
  nft.ownerOf = async () => OTHER;
  await assert.rejects(save({ kind: 'all-defaults' }), /no longer owns/);
  assert.equal(calls.length, 0);
  nft.ownerOf = async () => OWNER; nft.renderer = async () => OTHER;
  await assert.rejects(save({ kind: 'all-defaults' }), /artwork contract changed/);
  assert.equal(calls.length, 0);
});

test('preflight rejection does not send a transaction', async () => {
  preflightError = Error('Rejected artwork');
  await assert.rejects(save({ kind: 'all-defaults' }));
  assert.deepEqual(calls.map(c => c.method), ['clearTokenCustomization.staticCall']);
});

test('rejects malformed colors, crypto ink, invalid IDs and clipped geometry before wallet work', async () => {
  await assert.rejects(save({ kind: 'colors', colors: { rimColor: '#abc' } }), /six-digit/);
  await assert.rejects(save({ symbolId: 6, kind: 'colors', colors: { symbolColor: '#ffffff' } }), /original colors/);
  await assert.rejects(save({ symbolId: 32, kind: 'all-defaults' }), /Choose a Deity/);
  await assert.rejects(save({ kind: 'geometry', geometry: { radius: 4600, centerX: 291, centerY: 0 } }), /inside/);
  assert.equal(signerReads, 0);
});

test('size slider clamps both axes on enlargement and permits all minimum-size corners', () => {
  const enlarged = clampDeityGeometry({ radius: 4890, centerX: 3690, centerY: -3690 });
  assert.deepEqual(enlarged, { radius: 4890, centerX: 0, centerY: 0 });
  assert.equal(deityPositionLimit(1200), 3690);
  for (const radius of [1200, 2500, 4600, 4890]) {
    const edge = deityPositionLimit(radius);
    for (const x of [-edge, 0, edge]) for (const y of [-edge, 0, edge]) assert.doesNotThrow(() => validateDeityGeometry({ radius, centerX: x, centerY: y }));
    assert.throws(() => validateDeityGeometry({ radius, centerX: edge + 1, centerY: 0 }));
  }
});

test('five independent defaults preserve crypto and collection-gold Dice 6 behavior', () => {
  const defaults = deityDefaultColors(29, ['#AB8D3F', '#123456', '#AB8D3F']);
  assert.equal(defaults.badgeBackgroundColor, '#111111');
  const changed = effectiveDeityColors(normalizeDeityColors({ rimColor: '#00ffff' }, 29), defaults);
  assert.equal(changed.badgeBackgroundColor, '#111111');
  assert.equal(changed.outlineColor, '#AB8D3F');
  assert.equal(deityDefaultColors(0, DEFAULTS).symbolColor, '');
  assert.equal(deityDefaultColors(0, DEFAULTS).rimColor, '#ed0e11');
});
