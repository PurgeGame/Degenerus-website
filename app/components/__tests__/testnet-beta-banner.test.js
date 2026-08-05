import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
  BASE_SEPOLIA_FAUCET_URL,
  isBaseSepolia,
  isTutorialApp,
  syncTestnetBetaBanner,
} from '../testnet-beta-banner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolvePath(__dirname, '../../index.html'), 'utf8');
const css = readFileSync(resolvePath(__dirname, '../../styles/status-indicators.css'), 'utf8');

describe('Base Sepolia presentation helpers', () => {
  test('identifies only the Base Sepolia profile', () => {
    assert.equal(isBaseSepolia({ id: 84_532 }), true);
    assert.equal(isBaseSepolia({ id: 1 }), false);
  });

  test('restores the page-wide beta strip while retaining the faucet helper', () => {
    assert.equal(BASE_SEPOLIA_FAUCET_URL, 'https://www.alchemy.com/faucets/base-sepolia');
    assert.match(html, /id="testnet-beta-banner"/);
    assert.match(html, /TESTNET BETA · NOT REAL MONEY/);
    assert.match(html, /href="https:\/\/www\.alchemy\.com\/faucets\/base-sepolia"/);
    assert.match(html, /GET FREE PLAY MONEY/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.match(html, /src="\/app\/components\/testnet-beta-banner\.js"/);
    assert.match(html, /href="\/app\/styles\/status-indicators\.css"/);
    assert.match(css, /\.testnet-beta-banner\s*\{/);
    assert.match(css, /\.testnet-beta-banner__faucet\s*\{/);
  });

  test('shows only on Base Sepolia outside the tutorial app frame', () => {
    assert.equal(isTutorialApp('?tutorial=1'), true);
    assert.equal(isTutorialApp('?tutorial=0'), false);
    const banner = { hidden: true };
    const documentRef = { getElementById: () => banner };
    assert.equal(syncTestnetBetaBanner({
      documentRef,
      locationRef: { search: '' },
      chain: { id: 84_532 },
    }), true);
    assert.equal(banner.hidden, false);
    assert.equal(syncTestnetBetaBanner({
      documentRef,
      locationRef: { search: '?tutorial=1' },
      chain: { id: 84_532 },
    }), false);
    assert.equal(banner.hidden, true);
  });
});
