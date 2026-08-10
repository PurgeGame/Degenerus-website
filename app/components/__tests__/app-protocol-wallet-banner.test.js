import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../../app/main.js', import.meta.url), 'utf8');
const banner = readFileSync(new URL('../app-protocol-wallet-banner.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/protocol-wallet-banner.css', import.meta.url), 'utf8');

describe('disconnected protocol-wallet view', () => {
  test('the sDGNRS context banner sits between Prize Pool and Daily Jackpot', () => {
    const poolAt = html.indexOf('<app-pool-progress>');
    const bannerAt = html.indexOf('<app-protocol-wallet-banner');
    const jackpotAt = html.indexOf('class="jackpot-hero"');
    assert.ok(poolAt >= 0 && bannerAt > poolAt && jackpotAt > bannerAt);
    assert.match(html, /src="\/app\/components\/app-protocol-wallet-banner\.js"/);
    assert.match(html, /href="\/app\/styles\/protocol-wallet-banner\.css"/);
  });

  test('every disconnected session gets the protocol account after silent reconnect', () => {
    const reconnectAt = main.indexOf('await autoReconnect()');
    const seedAt = main.indexOf('seedDisconnectedProtocolWalletIfNeeded();', reconnectAt);
    assert.ok(reconnectAt >= 0 && seedAt > reconnectAt,
      'silent wallet reconnect gets first chance before the fallback view');
    assert.match(main,
      /function seedDisconnectedProtocolWalletIfNeeded\(\)\s*\{\s*if \(!DEFAULT_PLAYER \|\| get\('viewing\.address'\) \|\| get\('connected\.address'\)\) return false;/s);
    assert.doesNotMatch(main, /hasInstalledWallet/,
      'an installed-but-disconnected wallet no longer suppresses the useful fallback');
    assert.match(main, /update\('viewing\.address', DEFAULT_PLAYER\)/);
  });

  test('the banner is explicit, live, and connects through the real wallet flow', () => {
    assert.match(banner, /VIEWING THE sDGNRS PROTOCOL WALLET/);
    assert.match(banner, /Live read-only protocol activity/);
    assert.match(banner, /CONNECT YOUR WALLET/);
    assert.match(banner, /await connectWithPicker\(\)/);
    assert.match(banner, /subscribe\('connected\.address'/);
    assert.match(banner, /subscribe\('viewing\.address'/);
    assert.match(css, /app-protocol-wallet-banner\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/s);
    assert.match(css, /app-protocol-wallet-banner\[hidden\]\s*\{\s*display:\s*none !important/s);
  });
});
