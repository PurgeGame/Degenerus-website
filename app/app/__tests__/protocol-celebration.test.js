import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { protocolCelebrationSpec } from '../../protocol-celebration.js';

const SRC = readFileSync(new URL('../../protocol-celebration.js', import.meta.url), 'utf8');
const APP_HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const VIEWER_HTML = readFileSync(new URL('../../viewer.html', import.meta.url), 'utf8');

describe('protocol-native celebrations', () => {
  test('win contexts receive distinct flame, seal, and light treatments', () => {
    const win = protocolCelebrationSpec('win');
    const jackpot = protocolCelebrationSpec('jackpot', true);
    const gold = protocolCelebrationSpec('gold', true);
    const coinflip = protocolCelebrationSpec('coinflip');
    assert.equal(win.tone, 'win');
    assert.ok(jackpot.rings > win.rings);
    assert.equal(gold.logo, '/whitepaper/flame-center.svg');
    assert.equal(coinflip.logo, '/whitepaper/flame-logo-split.svg');
    assert.ok(jackpot.duration > win.duration);
  });

  test('uses symmetric protocol effects and carries no falling-party dependency', () => {
    assert.match(SRC, /addRing[\s\S]*addSeal[\s\S]*addLightSweep[\s\S]*addFlame/);
    assert.doesNotMatch(SRC, /canvas-confetti|particleCount/);
    assert.doesNotMatch(APP_HTML, /canvas-confetti/);
    assert.doesNotMatch(VIEWER_HTML, /canvas-confetti/);
  });
});
