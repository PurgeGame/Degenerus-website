import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolvePath(__dirname, relative), 'utf8');

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

describe('startup console routing', () => {
  test('app session discovery is opt-in on interaction, not four anonymous startup requests', () => {
    const nav = read('../../../shared/nav.js');
    const app = read('../../index.html');
    const discord = read('../discord-link.js');
    const mount = between(discord, 'function _mount()', 'export function initDiscordLink');
    const click = between(discord, 'async function _onClick()', 'function _mount()');

    assert.match(nav, /config\.sessionChecks\s*!==\s*false/,
      'shared nav exposes an app-only escape hatch for legacy session probes');
    assert.match(app, /initNav\(\{\s*currentPage:\s*'app',\s*sessionChecks:\s*false\s*\}\)/,
      'the backend-free app wallet shell opts out of legacy session startup checks');
    assert.doesNotMatch(mount, /^\s*_refresh\(\)\.then\(_render\)/m,
      'Discord state is not fetched directly merely because the button mounted');
    assert.match(click, /await\s+_refresh\s*\(/,
      'the first trusted interaction still discovers and preserves an existing session');
  });

  test('pure startup chain probes use the public reader before any connected wallet', () => {
    const decimator = read('../jackpot-resolutions.js');
    const mineFlip = read('../mine-flip.js');
    const wwxrp = read('../wwxrp-draw.js');
    const launch = read('../launch-claims.js');
    const decimatorReader = between(decimator, 'function _readerProvider()', 'function _decimatorContract');
    const mineProbe = between(mineFlip, 'export async function probeMineFlip', 'export async function mineFlip');
    const drawDays = between(wwxrp, 'export async function readPlayerWwxrpDrawDays', 'export async function readWwxrpDrawOutcome');
    const drawOutcome = between(wwxrp, 'export async function readWwxrpDrawOutcome', 'export async function claimWwxrpDraw');

    assert.ok(decimatorReader.indexOf('sharedReadProvider()') < decimatorReader.indexOf('getProvider()'));
    assert.match(mineProbe, /sharedReadProvider\(\)\s*\|\|\s*walletProvider/);
    assert.match(mineProbe, /_mineFlipGasBudget\(contract,\s*signer,\s*readProvider\)/,
      'passive affordability fee/balance reads stay off the injected wallet provider');
    assert.doesNotMatch(mineProbe, /_mineFlipGasBudget\(contract,\s*signer,\s*walletProvider\)/);
    assert.doesNotMatch(drawDays, /getProvider\s*\(/);
    assert.doesNotMatch(drawOutcome, /getProvider\s*\(/);
    assert.match(launch, /function _readerProvider\(\)[\s\S]*sharedReadProvider\(\)[\s\S]*getProvider\(\)/);
  });

  test('NoWork is a decoded non-actionable Decimator probe state', () => {
    const decimator = read('../jackpot-resolutions.js');
    assert.match(decimator, /'error NoWork\(\)'/);
    assert.match(decimator, /name === 'NoWork'[^\n]*return \{ state: 'pending'/);
  });

  test('app declares an existing branded favicon instead of implicit /favicon.ico', () => {
    const app = read('../../index.html');
    assert.match(app, /<link rel="icon" type="image\/svg\+xml" href="\/whitepaper\/flame-logo\.svg">/);
    assert.equal(
      existsSync(resolvePath(__dirname, '../../../whitepaper/flame-logo.svg')),
      true,
      'the declared favicon target ships with the site',
    );
  });
});
