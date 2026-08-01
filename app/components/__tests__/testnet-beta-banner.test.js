import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
  BASE_SEPOLIA_FAUCET_URL,
  isBaseSepolia,
  renderTestnetBetaBanner,
} from '../testnet-beta-banner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolvePath(__dirname, '../../index.html'), 'utf8');
const css = readFileSync(resolvePath(__dirname, '../../styles/status-indicators.css'), 'utf8');

function fakeBanner() {
  return {
    hidden: true,
    attrs: new Set(['hidden']),
    removeAttribute(name) { this.attrs.delete(name); },
    setAttribute(name) { this.attrs.add(name); },
  };
}

describe('testnet beta banner', () => {
  test('is shown only by the Base Sepolia profile', () => {
    assert.equal(isBaseSepolia({ id: 84_532 }), true);
    assert.equal(isBaseSepolia({ id: 1 }), false);

    const banner = fakeBanner();
    const root = { getElementById: () => banner };
    assert.equal(renderTestnetBetaBanner(root, { id: 84_532 }), true);
    assert.equal(banner.hidden, false);
    assert.equal(banner.attrs.has('hidden'), false);

    assert.equal(renderTestnetBetaBanner(root, { id: 1 }), false);
    assert.equal(banner.hidden, true);
    assert.equal(banner.attrs.has('hidden'), true);
  });

  test('sits above the jackpot headline and links to Alchemy securely', () => {
    const bannerIndex = html.indexOf('id="testnet-beta-banner"');
    const jackpotIndex = html.indexOf('<gold-rush-headline>');
    assert.ok(bannerIndex >= 0 && bannerIndex < jackpotIndex);
    assert.match(html, /TESTNET BETA · NOT REAL MONEY/);
    assert.ok(html.includes(`href="${BASE_SEPOLIA_FAUCET_URL}"`));
    assert.match(html, /target="_blank" rel="noopener noreferrer">GET FREE MONEY<\/a>/);
    assert.match(html, /src="\/app\/components\/testnet-beta-banner\.js"/);
    assert.match(html, /href="\/app\/styles\/status-indicators\.css"/);
  });

  test('uses a compact red bar and hidden always wins on mainnet', () => {
    assert.match(css, /\.testnet-beta-banner\s*\{[^}]*min-height:\s*2rem;[^}]*background:[^;}]*#861b28/s);
    assert.match(css, /\.testnet-beta-banner\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  });
});
