// Local replay/queue fixtures; no wallet or chain writes.
// PLAYWRIGHT_MODULE=db/playtester/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/google-chrome node db/test-craps-next-battle.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const root = resolve(process.env.SITE_ROOT || resolve(import.meta.dirname, '..'));
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
      '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' })[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/app/craps-table-demo.html?closed`);
    await page.waitForFunction(() => customElements.get('app-craps-table'));
    await page.evaluate(async () => {
      const { update } = await import('/app/app/store.js');
      const { publishPendingActions } = await import('/app/app/pending-actions.js');
      const { crapsResolutionPendingActions } = await import('/app/components/app-craps-entry.js');
      const { CHAIN, CONTRACTS } = await import('/app/app/chain-config.js');
      const table = document.querySelector('app-craps-table');
      window.setAccount = value => update('connected.address', value);
      setAccount('alice');
      window.opens = [];
      window.queue = [];
      window.publish = () => publishPendingActions('craps-resolutions', queue);
      window.openBattle = id => table.open({
        tableIndex: id, viewerBetId: '1', tableResolved: true, showResolution: true, autoRoll: false,
        bankrollFlip: 3000, goalFlip: 9000, playedFlip: 600, bets: { passLine: 1 },
        resolutionHands: [{ bankrollFlip: 3100, dice: [3, 4], shooter: 0 }],
      });
      window.addBattle = (id, state = 'ready', mode = '') => {
        const replay = { chainId: CHAIN.id, contract: CONTRACTS.CRAPS, battleKey: id,
          viewerBetId: '1', buyInWei: String(3000n * 10n ** 18n), slot: queue.length };
        const identity = `${CHAIN.id}:${CONTRACTS.CRAPS.toLowerCase()}:${id}:1`;
        queue.push(...crapsResolutionPendingActions({ address: 'alice', replays: [replay],
          states: new Map([[identity, { ready: state === 'ready', status: state === 'ready' ? 'ready' : 'pending' }]]),
          run: async (_replay, _address, { signal } = {}) => {
            opens.push(id);
            if (mode === 'fail') throw Error('fixture load failure');
            if (mode === 'slow') await new Promise(resolve => { window.releaseBattle = resolve; });
            if (signal?.aborted) return false;
            openBattle(id);
            window.queue = queue.filter(row => row.battleKey !== id);
            publish();
            return true;
          },
        }));
        publish();
      };
      openBattle('current');
    });
    const next = page.locator('[data-bind=craps-race-next]');
    const exit = page.locator('[data-bind=craps-race-exit]');
    const finish = async () => {
      await page.locator('[data-bind=craps-resolution-skip]').click();
      await exit.waitFor({ state: 'visible' });
    };
    await finish();
    assert.equal(await next.isVisible(), false, 'no next button with an empty queue');
    await page.evaluate(() => { addBattle('current'); addBattle('waiting', 'waiting'); });
    assert.equal(await next.isVisible(), false, 'exclude the current seat and unfinished battles');
    await page.evaluate(() => { addBattle('next'); addBattle('last'); });
    await next.waitFor({ state: 'visible' });
    const bounds = await next.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 900);
    await page.screenshot({ path: `/tmp/craps-next-battle-${width}.png` });
    // In production the publisher retires the current row as soon as it opens.
    await page.evaluate(() => { window.queue = queue.filter(row => row.battleKey !== 'current'); publish(); });
    await next.click();
    await page.waitForFunction(() => opens.join(',') === 'next');
    assert.equal(await next.isVisible(), false, 'next replay starts without another results screen');
    await finish();
    await next.click();
    await page.waitForFunction(() => opens.join(',') === 'next,last');
    await finish();
    assert.equal(await next.isVisible(), false, 'last ready battle leaves only Exit');
    await page.evaluate(() => { queue = []; addBattle('waiting'); });
    await next.waitFor({ state: 'visible' });
    await next.click();
    await finish();
    assert.equal(await next.isVisible(), false, 'queue updates appear without polling');
    await page.evaluate(() => addBattle('failed', 'ready', 'fail'));
    await next.click();
    await page.locator('[data-bind=craps-next-error]').waitFor({ state: 'visible' });
    assert.equal(await exit.isVisible(), true, 'load failure keeps the finished result available');
    assert.equal(await next.isEnabled(), true);
    await page.evaluate(() => { window.queue = []; addBattle('slow', 'ready', 'slow'); });
    // Two synchronous clicks must still launch only one continuation.
    await next.evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => typeof releaseBattle === 'function');
    assert.equal(await next.isEnabled(), false);
    assert.equal(await page.evaluate(() => opens.filter(id => id === 'slow').length), 1);
    await exit.click();
    await page.evaluate(() => releaseBattle());
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-bind=craps-dialog]').isVisible(), false, 'Exit cancels an in-flight next battle');
    await page.evaluate(() => { openBattle('account-check'); window.releaseBattle = null; });
    await finish();
    await next.click();
    await page.waitForFunction(() => typeof releaseBattle === 'function');
    await page.evaluate(() => { setAccount('bob'); releaseBattle(); });
    await page.waitForTimeout(100);
    assert.equal(await exit.isVisible(), true, 'account change cannot replace the completed result');
    assert.equal(await next.isVisible(), false, 'previous account queue is hidden');
    await exit.click();
    assert.equal(await page.evaluate(() => document.body.style.position), '', 'continuing replays preserves balanced scroll locks');
    for (const stop of ['bust', 'goal']) {
      await page.evaluate(stop => {
        setAccount('alice');
        window.queue = [];
        addBattle('after-' + stop);
        document.querySelector('app-craps-table').open({
          tableIndex: 'personal', viewerBetId: '1', tableResolved: true, showResolution: true, autoRoll: false,
          bankrollFlip: 3000, goalFlip: 9000, playedFlip: 600, bets: { passLine: 1 },
          viewerResult: { stop, exitRoll: 1, handsPlayed: 1 },
          resolutionHands: [0, 1, 2].map(index => ({
            bankrollFlip: stop === 'goal' ? 9500 : 0, dice: [3, 4], shooter: index,
            terminal: '', viewerTerminal: stop, viewerClosed: index > 0,
          })),
        });
      }, stop);
      await page.locator('[data-bind=craps-resolution-roll]').click();
      await page.locator('[data-bind=craps-race-observe]').waitFor({ state: 'visible' });
      await next.click();
      await page.waitForFunction(stop => opens.includes('after-' + stop), stop);
      await finish();
      assert.equal(await next.isVisible(), false, 'personal result can continue without observing remaining rolls');
      await exit.click();
    }
    assert.deepEqual(errors, []);
    console.log(`PASS next battle queue, errors, cancellation and layout at ${width}px`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
