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

test('a MetaMask Connect failure falls through to WalletConnect without a page', async () => {
  const saved = globalThis.document;
  globalThis.document = undefined;
  try {
    assert.equal(await chooseMobileWalletRoute('metamask-failed'), 'walletconnect');
  } finally {
    globalThis.document = saved;
  }
});

// Phone review 2026-10-18 (Pixel 9, Android Chrome): MetaMask Connect and
// MetaMask over WalletConnect both dropped the request with no prompt, the
// page reset with no word, while MetaMask's in-app browser loaded the site.
test('phones lead with MetaMask\'s in-app browser; connecting from Chrome is the secondary link', async () => {
  const { readFileSync } = await import('node:fs');
  const sheet = readFileSync(new URL('../wallet-route-sheet.js', import.meta.url), 'utf8');
  for (const mode of ['connect', 'silent']) {
    const block = sheet.match(new RegExp(`\\n  ${mode}: \\{[\\s\\S]*?\\n  \\},`))?.[0] || '';
    assert.match(block, /primaryRoute: 'metamask',/, `${mode}: in-app browser is the primary action`);
    assert.match(block, /linkRoute: 'metamask-connect',/, `${mode}: MetaMask Connect stays reachable`);
  }
});

test('a failed MetaMask connect offers the in-app browser first instead of a silent reset', async () => {
  const { readFileSync } = await import('node:fs');
  const sheet = readFileSync(new URL('../wallet-route-sheet.js', import.meta.url), 'utf8');
  const wallet = readFileSync(new URL('../wallet.js', import.meta.url), 'utf8');
  assert.match(sheet, /'metamask-failed': \{[\s\S]*?primaryRoute: 'metamask',[\s\S]*?secondaryRoute: 'walletconnect',[\s\S]*?linkRoute: 'metamask-connect'/);
  assert.match(sheet, /If Android asks which app to open, pick MetaMask\./);
  assert.match(wallet, /while \(route === 'metamask-connect'\) \{[\s\S]*?connectMetaMaskConnect\(\)\.catch\(\(\) => null\)[\s\S]*?chooseMobileWalletRoute\('metamask-failed'\)/);
});

test('a wallet without the test network gets told so, and an answered request clears its bar', async () => {
  const { readFileSync } = await import('node:fs');
  const wallet = readFileSync(new URL('../wallet.js', import.meta.url), 'utf8');
  assert.match(wallet, /_reportWalletChainFailure\('switch-failed', raw, switchResult\.error\);\s*if \(_walletLacksChain\(switchResult\.error\)\) _showWalletNetworkHelp\(raw\);/);
  assert.match(wallet, /is off in \$\{walletName\}/);
  assert.match(wallet, /_clearHandoffOnAnswer\(provider, 'request'[\s\S]*?_clearHandoffOnAnswer\(client, 'request'/);
});

// Players with no wallet at all get a passkey wallet (Coinbase Smart Wallet):
// no app, no extension, Ethereum Sepolia supported. Normal wallets stay first.
test('a player with no wallet can create a passkey wallet on phones and computers', async () => {
  const { readFileSync } = await import('node:fs');
  const sheet = readFileSync(new URL('../wallet-route-sheet.js', import.meta.url), 'utf8');
  const wallet = readFileSync(new URL('../wallet.js', import.meta.url), 'utf8');
  const headers = readFileSync(new URL('../../../_headers', import.meta.url), 'utf8');
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.match(sheet, /class="wallet-route-sheet__create" data-route="smart-wallet"/);
  assert.match(sheet, /'no-wallet': \{[\s\S]*?primaryRoute: 'smart-wallet',[\s\S]*?secondaryRoute: 'walletconnect'/);
  assert.match(wallet, /if \(route === 'smart-wallet'\) return connectWithoutWallet\(\);[\s\S]*?chooseMobileWalletRoute\('no-wallet'\)/);
  assert.match(wallet, /export async function connectWithoutWallet\(\) \{\s*if \(Number\(CHAIN\.id\) === 1\) return connectSmartWallet\(\);/,
    'testnets use the device wallet; Coinbase refused to sign on Sepolia');
  assert.match(wallet, /preference: \{ options: 'smartWalletOnly' \}/);
  assert.match(wallet, /appChainIds: \[CHAIN\.id\]/);
  assert.match(wallet, /if \(rdns === SMART_WALLET_RDNS\) \{[\s\S]*?method: 'eth_accounts'/, 'reconnect never opens the popup');
  assert.equal(pkg.dependencies['@coinbase/wallet-sdk'], '4.4.0');
  for (const line of headers.split('\n').filter((l) => l.includes('connect-src'))) {
    assert.match(line, /https:\/\/keys\.coinbase\.com https:\/\/rpc\.wallet\.coinbase\.com/);
  }
  const saved = globalThis.document;
  globalThis.document = undefined;
  try {
    assert.equal(await chooseMobileWalletRoute('no-wallet'), null, 'headless no-wallet sheet connects nothing');
  } finally {
    globalThis.document = saved;
  }
});
