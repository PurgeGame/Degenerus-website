import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { __resetSimAvatarCache, simAvatarUrl } from '../sim-avatar.js';

// These two strings are the OUTPUT OF THE SERVER RENDERER
// (database/src/api/utils/sim-player-profiles.ts, renderSimPlayerAvatarSvg),
// captured from the real testnet roster. The browser port must reproduce them
// exactly: the same bot wore this face while the API was serving it, and a
// silent drift would repaint every leaderboard. A full sweep of all 945
// profiles matched byte for byte when the port was written.
const STANDARD = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\" role=\"img\"><title>Lowkey Couch — afkPassive</title><defs><radialGradient id=\"bg\" cx=\"35%\" cy=\"25%\" r=\"90%\"><stop stop-color=\"#929bc3\" stop-opacity=\".55\"/><stop offset=\".55\" stop-color=\"#171a2d\"/><stop offset=\"1\" stop-color=\"#6873ad\" stop-opacity=\".42\"/></radialGradient><linearGradient id=\"badge\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop stop-color=\"#929bc3\"/><stop offset=\"1\" stop-color=\"#6873ad\"/></linearGradient></defs><rect width=\"128\" height=\"128\" rx=\"34\" fill=\"#171a2d\"/><rect x=\"4\" y=\"4\" width=\"120\" height=\"120\" rx=\"31\" fill=\"url(#bg)\"/><g opacity=\".3\"><rect x=\"25\" y=\"41\" width=\"13\" height=\"13\" rx=\"4\" fill=\"#929bc3\"/><rect x=\"89\" y=\"41\" width=\"13\" height=\"13\" rx=\"4\" fill=\"#929bc3\"/><rect x=\"41\" y=\"57\" width=\"13\" height=\"13\" rx=\"4\" fill=\"#929bc3\"/><rect x=\"73\" y=\"57\" width=\"13\" height=\"13\" rx=\"4\" fill=\"#929bc3\"/><rect x=\"25\" y=\"89\" width=\"13\" height=\"13\" rx=\"4\" fill=\"#6873ad\"/><rect x=\"89\" y=\"89\" width=\"13\" height=\"13\" rx=\"4\" fill=\"#6873ad\"/></g><circle cx=\"64\" cy=\"64\" r=\"43\" fill=\"none\" stroke=\"#929bc3\" stroke-width=\"3\" stroke-dasharray=\"46 14\" opacity=\".9\"/><circle cx=\"64\" cy=\"64\" r=\"30\" fill=\"#171a2d\" stroke=\"url(#badge)\" stroke-width=\"4\"/><text x=\"64\" y=\"73\" text-anchor=\"middle\" fill=\"#ffffff\" font-family=\"ui-rounded,system-ui,sans-serif\" font-size=\"27\" font-weight=\"850\" letter-spacing=\"1\">LC</text><circle cx=\"105\" cy=\"105\" r=\"11\" fill=\"#171a2d\"/><circle cx=\"105\" cy=\"105\" r=\"7\" fill=\"#929bc3\"/></svg>";

const VAULT = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\" role=\"img\"><title>Degenerus Vault — vault</title><defs><radialGradient id=\"door\" cx=\"38%\" cy=\"30%\" r=\"75%\"><stop stop-color=\"#f6c453\"/><stop offset=\".45\" stop-color=\"#8c6239\"/><stop offset=\"1\" stop-color=\"#17120a\"/></radialGradient></defs><rect width=\"128\" height=\"128\" rx=\"34\" fill=\"#17120a\"/><rect x=\"8\" y=\"8\" width=\"112\" height=\"112\" rx=\"28\" fill=\"none\" stroke=\"#f6c453\" stroke-width=\"5\"/><circle cx=\"64\" cy=\"64\" r=\"43\" fill=\"url(#door)\" stroke=\"#f6c453\" stroke-width=\"4\"/><circle cx=\"64\" cy=\"64\" r=\"31\" fill=\"#17120a\" stroke=\"#f6c453\" stroke-width=\"3\"/><path d=\"M64 33v62M33 64h62M42 42l44 44M86 42 42 86\" stroke=\"#8c6239\" stroke-width=\"5\" stroke-linecap=\"round\"/><circle cx=\"64\" cy=\"64\" r=\"13\" fill=\"#f6c453\" stroke=\"#17120a\" stroke-width=\"5\"/><circle cx=\"64\" cy=\"64\" r=\"4\" fill=\"#17120a\"/><circle cx=\"23\" cy=\"23\" r=\"4\" fill=\"#f6c453\"/><circle cx=\"105\" cy=\"23\" r=\"4\" fill=\"#f6c453\"/><circle cx=\"23\" cy=\"105\" r=\"4\" fill=\"#f6c453\"/><circle cx=\"105\" cy=\"105\" r=\"4\" fill=\"#f6c453\"/></svg>";

const DATA_PREFIX = 'data:image/svg+xml;charset=utf-8,';

afterEach(__resetSimAvatarCache);

function decode(url) {
  assert.ok(url.startsWith(DATA_PREFIX), 'expected an SVG data URI');
  return decodeURIComponent(url.slice(DATA_PREFIX.length));
}

test('the browser port reproduces the server pattern avatar byte for byte', () => {
  const url = simAvatarUrl('0x020120e584ac7886a33484b767afd92e4a82f626', {
    type: 'afkPassive',
    seed: '020120e584ac7886a33484b767afd92e4a82f626',
    colors: ['#171a2d', '#929bc3', '#6873ad'],
  }, 'Lowkey Couch');
  assert.equal(decode(url), STANDARD);
});

test('the bespoke Vault face is reproduced too', () => {
  const url = simAvatarUrl('0x4eb9d87e134b858c9456b6f2e433d7c0ecf3b910', {
    type: 'vault',
    seed: '4eb9d87e134b858c9456b6f2e433d7c0ecf3b910',
    colors: ['#17120a', '#f6c453', '#8c6239'],
  }, 'Degenerus Vault');
  assert.equal(decode(url), VAULT);
});

test('a site-hosted mark replaces the generated pattern', () => {
  assert.equal(
    simAvatarUrl('0x0000000000000000000000000000000000000000', { type: 'sdgnrs', mark: '/specials/special_eth.svg' }, 'sDGNRS'),
    '/specials/special_eth.svg',
  );
});

test('an untrusted mark, seed or palette yields no avatar rather than a broken image', () => {
  const bad = [
    { type: 'x', mark: 'https://evil.example.com/x.svg' },
    { type: 'x', mark: '/../etc/passwd' },
    { type: 'x', seed: 'nothex', colors: ['#171a2d', '#929bc3', '#6873ad'] },
    { type: 'x', seed: '020120e584ac7886a33484b767afd92e4a82f626', colors: ['red', 'green', 'blue'] },
    { type: 'x', seed: '020120e584ac7886a33484b767afd92e4a82f626', colors: ['#171a2d'] },
    {},
  ];
  bad.forEach((sim, index) => {
    assert.equal(simAvatarUrl(`k${index}`, sim, 'Whoever'), null);
  });
});

test('a rendered face is minted once per wallet', () => {
  const sim = { type: 'degen', seed: '020120e584ac7886a33484b767afd92e4a82f626', colors: ['#171a2d', '#929bc3', '#6873ad'] };
  const first = simAvatarUrl('0x1111111111111111111111111111111111111111', sim, 'Name One');
  // A second call with a DIFFERENT name returns the cached face: the key is
  // the wallet, matching how the roster addresses an identity.
  const second = simAvatarUrl('0x1111111111111111111111111111111111111111', sim, 'Name Two');
  assert.equal(first, second);
});

test('the name is escaped into the title and initials', () => {
  const svg = decode(simAvatarUrl('0x2222222222222222222222222222222222222222', {
    type: 'degen',
    seed: '020120e584ac7886a33484b767afd92e4a82f626',
    colors: ['#171a2d', '#929bc3', '#6873ad'],
  }, '<script>&\'"'));
  assert.ok(!svg.includes('<script>'), 'a hostile name cannot open a tag inside the SVG');
  assert.match(svg, /&lt;script&gt;/);
});
