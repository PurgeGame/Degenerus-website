// Exercise the published browser libraries without connecting a wallet or broadcasting.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome node db/test-wallet-vendor-browser.mjs
// TEST_SITE_ROOT=/path/to/publication checks a release; TEST_ORIGIN=https://degener.us checks live.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const root = resolve(process.env.TEST_SITE_ROOT || resolve(import.meta.dirname, '..'));
const server = process.env.TEST_ORIGIN ? null : createServer(async (req, res) => {
  try {
    let path = new URL(req.url, 'http://localhost').pathname;
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + '/')) throw new Error('path');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript',
      '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
      '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('not found'); }
});
if (server) await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = process.env.TEST_ORIGIN || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const width of [1000, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(origin + '/beta/', { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => Boolean(customElements.get('replay-panel')), undefined, { timeout: 30_000 });
    const result = await page.evaluate(async () => {
      const [slim, full, wc, mm, cb] = await Promise.all([
        import('ethers'), import('/app/vendor/ethers.mjs'),
        import('/app/vendor/walletconnect.mjs'), import('/app/vendor/metamask-connect.mjs'),
        import('/app/vendor/coinbase-wallet.mjs'),
      ]);
      // A fresh, unfunded key exists only in this test's memory.
      const wallet = full.Wallet.createRandom();
      const message = 'Degenerus dependency security regression';
      const signature = await wallet.signMessage(message);
      const domain = { name: 'Degenerus test', version: '1', chainId: 11155111 };
      const types = { Claim: [{ name: 'amount', type: 'uint256' }] };
      const value = { amount: 42n };
      const typed = await wallet.signTypedData(domain, types, value);
      const tx = full.Transaction.from(await wallet.signTransaction({
        chainId: 11155111, nonce: 0, to: full.ZeroAddress, value: 0n,
        gasLimit: 21000n, type: 2, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n,
      }));
      return {
        slim: slim.version, full: full.version,
        message: full.verifyMessage(message, signature) === wallet.address,
        typed: full.verifyTypedData(domain, types, value, typed) === wallet.address,
        transaction: tx.from === wallet.address && tx.chainId === 11155111n && tx.value === 0n,
        codec: slim.AbiCoder.defaultAbiCoder().encode(['uint256'], [42n])
          === full.AbiCoder.defaultAbiCoder().encode(['uint256'], [42n]),
        walletconnect: typeof (wc.EthereumProvider || wc.default)?.init,
        metamask: typeof mm.createEVMClient,
        coinbase: typeof cb.createCoinbaseWalletSDK,
      };
    });
    assert.deepEqual(result, { slim: '6.17.0', full: '6.17.0', message: true, typed: true,
      transaction: true, codec: true, walletconnect: 'function', metamask: 'function', coinbase: 'function' });
    assert.deepEqual(errors, [], `browser errors at ${width}px`);
    console.log(`PASS ${width}px: app boot, wallet imports, message/typed-data/transaction signatures, ABI parity`);
    await page.close();
  }
} finally {
  await browser.close();
  if (server) await new Promise(done => server.close(done));
}
