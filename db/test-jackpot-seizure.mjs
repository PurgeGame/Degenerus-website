// Jackpot payouts follow the current account owner in the real cabinet.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome node db/test-jackpot-seizure.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const root = process.env.TEST_SITE_ROOT || resolve(import.meta.dirname, '..');
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + '/')) throw Error('path');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html',
      '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' })[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const errors = [];
try {
  for (const width of [1000, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'no-preference' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/app/degenerette-demo.html`);
    await page.evaluate(async () => {
      for (const href of ['/app/styles/replay.css', '/app/styles/daily-drawing.css']) {
        const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = href; document.head.appendChild(css);
      }
      document.documentElement.setAttribute('data-degenerus-tutorial', '');
      await import('/app/components/replay-panel.js');
      const { tutorialJackpotFixture } = await import('/learn/tutorial/tutorial-state.js');
      const { setMuted } = await import('/app/app/jackpot-sfx.js'); setMuted(true);
      const { decorateWalletRows } = await import('/app/chain/wallet-events.js');
      const { walletAddressOf, walletPayeeOf } = await import('/app/chain/wallets.js');
      const { jackpotWin, batchWinRow } = await import('/app/chain/jackpots.js');
      window.fixture = tutorialJackpotFixture();
      window.borrower = fixture.player;
      window.lender = '0x9999999999999999999999999999999999999999';
      const client = { chain: { id: 9937 }, address: () => '0x0000000000000000000000000000000000000037' };
      const before = { client, field: async () => BigInt(borrower) };
      await walletAddressOf(before, 37); // reproduce the cached original key before foreclosure
      const seized = { client, field: async (_contract, _name, id) => Number(id) === 1
        ? BigInt(lender) : BigInt(borrower) | (1n << 160n) };
      const rows = await decorateWalletRows(seized, 'GAME', [
        { name: 'JackpotEthWin', args: { walletId: 37, amount: '1000000000000', level: fixture.level, traitId: fixture.mainTraits[0] } },
      ]);
      const batch = batchWinRow({ args: { firstWinner: 0, targetLvl: fixture.level + 1,
        sourceLvl: fixture.level, trait: fixture.mainTraits[1], entriesEach: 8 } },
      { j: 0, sourceIndex: 1n }, await walletPayeeOf(seized, 37));
      fixture.roll1Wins = [...rows, batch].map(jackpotWin);
      fixture.roll2Wins = [];
      fixture.playerTraits = [];
      window.panel = document.createElement('replay-panel');
      panel.style.cssText = 'display:block;max-width:96vw;margin:auto';
      document.querySelector('main').replaceChildren(panel);
      panel.setTutorialFixture(fixture);
    });
    await page.waitForTimeout(1000);
    await page.evaluate(async () => {
      panel.setTutorialFixture(fixture);
      await panel.restoreTutorialProgress({ mainSpinComplete: true });
    });
    assert.equal(await page.locator('.replay-tq.q-player-win').count(), 0, `${width}: former borrower has no winning quadrant`);
    assert.equal(await page.locator('.replay-win-flight').count(), 0, `${width}: seized prizes must not be prepared for the borrower`);
    assert.equal(await page.evaluate(() => fixture.roll1Wins.every(row => row.winner === lender)), true);
    await page.evaluate(async () => {
      panel.setTutorialFixture({ ...fixture, player: lender });
      await panel.restoreTutorialProgress({ mainSpinComplete: true });
    });
    await page.waitForFunction(() => document.querySelectorAll('.replay-win-flight').length === 2);
    assert.equal(await page.locator('.replay-tq.q-player-win').count(), 2, `${width}: lender receives the ETH and ticket awards`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: cached original key cannot show seized ETH/ticket wins for the borrower; the lender sees both on desktop and mobile.');
} finally { await browser.close(); server.close(); }
