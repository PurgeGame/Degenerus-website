import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metamaskDappLink, chooseMobileWalletRoute } from '../wallet-route-sheet.js';

test('MetaMask dapp link opens the current page and drops the debug flag', () => {
  assert.equal(
    metamaskDappLink({ host: 'degener.us', pathname: '/beta/', search: '?ref=abc' }, ''),
    'https://metamask.app.link/dapp/degener.us/beta/?ref=abc',
  );
  assert.equal(
    metamaskDappLink({ host: 'degener.us', pathname: '/beta/', search: '?wcdebug=1' }, ''),
    'https://metamask.app.link/dapp/degener.us/beta/',
  );
  assert.equal(
    metamaskDappLink({ host: 'degener.us', pathname: '/beta/', search: '?wcdebug=1&ref=abc' }, ''),
    'https://metamask.app.link/dapp/degener.us/beta/?ref=abc',
  );
});

test('Android opens MetaMask by package so Chrome cannot divert to the Play Store', () => {
  assert.equal(
    metamaskDappLink(
      { host: 'degener.us', pathname: '/beta/', search: '?ref=abc&wcdebug=1' },
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36',
    ),
    'intent://dapp/degener.us/beta/?ref=abc#Intent;scheme=metamask;package=io.metamask;end',
  );
  assert.equal(
    metamaskDappLink(
      { host: 'degener.us', pathname: '/beta/', search: '' },
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    ),
    'https://metamask.app.link/dapp/degener.us/beta/',
  );
});

test('without a page to draw on, each mode falls through to its WalletConnect route', async () => {
  const saved = globalThis.document;
  globalThis.document = undefined;
  try {
    assert.equal(await chooseMobileWalletRoute('connect'), 'walletconnect');
    assert.equal(await chooseMobileWalletRoute('silent'), 'reconnect');
  } finally {
    globalThis.document = saved;
  }
});
