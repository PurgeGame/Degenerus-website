// Dense jackpot reveals: normal motion, batched geometry, and cancellable flights.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome
//   node db/test-jackpot-win-performance.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const root = resolve(import.meta.dirname, '..');
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
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const errors = [];
try {
  for (const [width, cpu] of [[1000, 1], [390, 4]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'no-preference' });
    page.on('pageerror', error => errors.push(error.message));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.goto(`http://127.0.0.1:${server.address().port}/app/degenerette-demo.html`);
    await page.evaluate(async () => {
      await Promise.all(['/app/styles/replay.css', '/app/styles/daily-drawing.css'].map(href => new Promise(resolve => {
        const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = href;
        css.onload = resolve; document.head.appendChild(css);
      })));
      document.documentElement.setAttribute('data-degenerus-tutorial', '');
      await import('/app/components/replay-panel.js');
      const { tutorialJackpotFixture } = await import('/learn/tutorial/tutorial-state.js');
      const { setMuted } = await import('/app/app/jackpot-sfx.js'); setMuted(true);
      window.flights = await import('/app/components/win-flights.js');
      window.fixture = tutorialJackpotFixture();
      fixture.playerTraits = fixture.mainTraits;
      fixture.roll1Wins = fixture.mainTraits.flatMap(traitId => Array.from({ length: 20 }, (_, i) => ({
        winner: fixture.player, traitId, amount: String(1000000000 * (i + 1)), ticketIndex: i,
        awardType: 'eth', level: fixture.level, sourceLevel: fixture.level,
      })));
      window.panel = document.createElement('replay-panel');
      panel.style.cssText = 'display:block;max-width:96vw;margin:auto';
      document.querySelector('main').replaceChildren(panel);
      panel.setTutorialFixture(fixture);
    });
    // Let the component's initial data/badge warm finish before timing input.
    await page.waitForTimeout(1500);
    await page.evaluate(async () => {
      panel.setTutorialFixture(fixture);
      await panel.restoreTutorialProgress({ mainSpinComplete: true });
      window.completed = 0;
      panel.addEventListener('replay:scratch-complete', () => completed++);
    });
    await page.locator('.replay-tq .replay-bubble-trigger').first().waitFor();
    await page.waitForFunction(() => panel.querySelectorAll('.replay-win-flight').length === 80);
    assert.equal(await page.evaluate(() => [...panel.querySelectorAll('.replay-win-flight')]
      .every(node => getComputedStyle(node).opacity === '0' && node.getAttribute('aria-hidden') === 'true')), true,
      'all prizes are prepared without exposing their outcomes');
    await page.evaluate(() => { window.preparedReceipts = [...panel.querySelectorAll('.replay-win-description')]; });
    // Real pointer-origin events, issued faster than the bubble animation.
    await page.evaluate(() => {
      const bubbles = [...panel.querySelectorAll('.replay-bubble-trigger')];
      const bounds = bubbles.map(node => node.getBoundingClientRect());
      bubbles.forEach((node, i) => node.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1,
        clientX: bounds[i].left + bounds[i].width / 2, clientY: bounds[i].top + bounds[i].height / 2 })));
    });
    await page.waitForFunction(() => panel.querySelectorAll('.replay-tq.q-result-revealed').length === 4);
    assert.equal(await page.evaluate(() => preparedReceipts.every(node => node.isConnected)), true);
    assert.equal(await page.locator('.replay-tq.q-result-revealed').count(), 4);
    assert.equal(await page.locator('.replay-win-description').count(), 4);
    assert.equal(await page.evaluate(() => completed), 1);

    const batch = await page.evaluate(async () => {
      const quads = [...panel.querySelectorAll('.replay-tq')];
      quads.forEach(flights.clearWinFlights);
      const center = panel.querySelector('[data-bind="center"]');
      const raf = window.requestAnimationFrame, rect = Element.prototype.getBoundingClientRect;
      quads.forEach(quad => flights.prepareWinFlights(quad, center));
      await new Promise(resolve => raf.call(window, resolve));
      let scheduled = 0, reads = 0;
      window.requestAnimationFrame = callback => { scheduled++; return raf.call(window, callback); };
      Element.prototype.getBoundingClientRect = function (...args) { reads++; return rect.apply(this, args); };
      quads.forEach(quad => flights.launchWinFlights(quad, center));
      const queued = { scheduled, reads, mounted: panel.querySelectorAll('.replay-win-flight').length };
      Element.prototype.getBoundingClientRect = rect;
      window.requestAnimationFrame = raf;
      await new Promise(resolve => raf.call(window, resolve));
      const labels = [...panel.querySelectorAll('.replay-win-flight')];
      return { ...queued, labels: labels.length, contained: labels.every(node => {
        const left = Number.parseFloat(node.style.left), top = Number.parseFloat(node.style.top);
        return left >= 3 && top >= 3 && left + node.offsetWidth <= node.parentElement.clientWidth - 3
          && top + node.offsetHeight <= node.parentElement.clientHeight - 3;
      }) };
    });
    assert.deepEqual(batch, { scheduled: 0, reads: 0, mounted: 80, labels: 80, contained: true },
      'all four quadrants reuse prepared geometry with zero reveal-time reads');

    // Manual inspection cancels automatic effects but keeps the real badge prize.
    await page.locator('.replay-badge-wrap').first().evaluate(node => node.click());
    assert.equal(await page.locator('.replay-tq').first().locator('.replay-win-flight').count(), 0);
    assert.equal(await page.locator('.replay-badge-wrap.is-reward-pop').count(), 1);
    await page.evaluate(async () => {
      const quads = [...panel.querySelectorAll('.replay-tq')], center = panel.querySelector('[data-bind="center"]');
      quads.forEach(quad => flights.launchWinFlights(quad, center));
      quads.forEach(flights.clearWinFlights);
      await new Promise(requestAnimationFrame);
    });
    assert.equal(await page.locator('.replay-win-flight, [data-flying]').count(), 0, 'cancel before the frame leaves no late labels');
    await page.evaluate(async () => {
      const center = panel.querySelector('[data-bind="center"]');
      panel.querySelectorAll('.replay-tq').forEach(quad => flights.launchWinFlights(quad, center));
      window.dispatchEvent(new Event('resize'));
      await new Promise(requestAnimationFrame);
    });
    assert.equal(await page.locator('.replay-win-flight, [data-flying]').count(), 0, 'resize cancels queued geometry');
    await page.evaluate(async () => {
      const center = panel.querySelector('[data-bind="center"]');
      panel.querySelectorAll('.replay-tq').forEach(quad => flights.launchWinFlights(quad, center));
      panel.setTutorialFixture({ ...fixture, day: fixture.day + 1 });
      await new Promise(requestAnimationFrame);
    });
    assert.equal(await page.locator('.replay-win-flight, [data-flying]').count(), 0, 'changing draws cancels the old flight batch');
    // A played spin, rather than only a restored board, stages the same prizes.
    await page.evaluate(() => { panel.setTutorialFixture(fixture); });
    await page.locator('[data-bind="reveal-btn"]').click();
    await page.waitForFunction(() => panel.querySelector('[data-bind="center"]').classList.contains('spinning')
      && panel.querySelectorAll('.replay-win-flight').length === 80);
    assert.equal(await page.locator('.q-result-revealed').count(), 0);
    assert.equal(await page.evaluate(() => [...panel.querySelectorAll('.replay-win-description')]
      .every(node => node.closest('[inert][aria-hidden="true"]'))), true);
    await page.setViewportSize({ width: width - 20, height: 1000 });
    await page.waitForFunction(() => panel.querySelectorAll('.replay-win-flight').length === 80);
    await page.locator('[data-bind="center"]').click();
    await page.waitForFunction(() => panel.querySelectorAll('.q-result-revealed').length === 4);
    assert.equal(await page.locator('.replay-win-description').count(), 4);
    console.log(`PASS: ${width}px, ${cpu}x CPU, 80 prizes, prepared during spin, zero launch geometry, inspection and cancellation.`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); server.close(); }
