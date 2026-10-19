// Browser regression for the ready Pending results: shared preparation, no consumption, and offline opening.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome node db/test-pending-reveal-precache.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(root + '/')) throw Error('path');
    const data = await readFile(file);
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' })[extname(file)] ?? 'application/octet-stream');
    res.end(data);
  } catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/app/degenerette-demo.html');
  await page.evaluate(async () => {
    const { publishPendingActions } = await import('/app/app/pending-actions.js');
    const { prepareReveal, queueReveal, LOOTBOX_REVEAL_QUEUED_EVENT } = await import('/app/components/reveal-queue.js');
    window.queuedEvents = 0;
    document.addEventListener(LOOTBOX_REVEAL_QUEUED_EVENT, () => queuedEvents++);
    window.pendingSequence = { kind: 'lootbox', lootboxRelease: { address: '0xabc', key: 'ready:1' },
      legs: [{ legType: 'opened', lootboxIndex: 1, amount: '1000000000000000',
        futureLevel: 12, wholeTickets: 10, flip: '0' }] };
    publishPendingActions('precache-browser', [{ id: 'box:1', dismissScope: '0xabc', kind: 'lootbox', state: 'ready',
      prepare: async () => { await prepareReveal(pendingSequence); window.sequencePrepared = true; },
      run: () => queueReveal(pendingSequence) }]);
  });
  await page.waitForFunction(() => window.sequencePrepared);
  assert.equal(await page.locator('[data-bind="rvl-backdrop"]').isVisible(), false, 'preparation does not open the result');
  assert.equal(await page.evaluate(() => queuedEvents), 0, 'preparation does not consume or queue a receipt');
  const sequenceCache = await page.evaluate(async () => {
    const { prepareRevealSequence } = await import('/app/components/reveal-overlay.js');
    const first = prepareRevealSequence(pendingSequence);
    const same = prepareRevealSequence({ ...pendingSequence });
    const changed = prepareRevealSequence({ ...pendingSequence, legs: [{ ...pendingSequence.legs[0], wholeTickets: 20 }] });
    return { same: first === same, different: first !== changed };
  });
  assert.deepEqual(sequenceCache, { same: true, different: true });
  await page.evaluate(async () => {
    const { getPendingActions } = await import('/app/app/pending-actions.js');
    await getPendingActions().find(row => row.id === 'box:1').run();
  });
  await page.locator('[data-bind="rvl-backdrop"]').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => queuedEvents), 1);
  await page.locator('[data-bind="rvl-close"]').click();

  await page.evaluate(async () => {
    const { __setBafResolutionFetcherForTest } = await import('/app/app/baf-resolution.js');
    const { prepareBafView } = await import('/app/components/app-baf-resolution-overlay.js');
    const { publishPendingActions } = await import('/app/app/pending-actions.js');
    window.bafReads = 0;
    window.bafAttempts = 0;
    window.releaseBattles = [];
    publishPendingActions('slow-battles', [1, 2].map(id => ({ id, state: 'ready',
      prepare: () => new Promise(resolve => releaseBattles.push(resolve)) })));
    window.bafPlayer = '0x1111111111111111111111111111111111111111';
    window.bafOptions = { level: 40, player: bafPlayer, consolation: 0 };
    __setBafResolutionFetcherForTest(async path => {
      bafReads++;
      if (path.includes('/resolution')) {
        if (++bafAttempts === 1) throw Error('temporary metadata failure');
        return { status: 'closed', day: 200, rngWord: '1',
        comparisons: Array.from({ length: 24 }, (_, index) => ({ id: String(index), round: index + 1,
          players: [{ player: bafPlayer, score: '3000000000000000000', prizes: [{ kind: 'tickets', amount: '12', level: 41 }] },
            { player: '0x2222222222222222222222222222222222222222', score: '1000000000000000000', prizes: [] }] })) };
      }
      if (path.includes('jackpot-history')) return { wins: [{ awardType: 'tickets_baf', sourceLevel: 40, level: 41, amount: '48' }] };
      if (path.startsWith('/leaderboards/coinflip')) return { entries: [], totalWeight: '1000', totalParticipants: 12,
        player: { day: 200, player: bafPlayer, score: '20', rank: 1 }, winner: bafPlayer };
      if (path.startsWith('/leaderboards/baf')) return { entries: [
        { level: 40, player: bafPlayer, score: '3000000000000000000', rank: 1 },
        { level: 40, player: '0x2222222222222222222222222222222222222222', score: '1000000000000000000', rank: 2 },
      ] };
      return { roundStatus: 'closed', score: '3000000000000000000', rank: 1 };
    });
    publishPendingActions('baf-precache-browser', [{ id: 'baf:40', dismissScope: bafPlayer, kind: 'baf', state: 'ready',
      preparePriority: 'high',
      prepare: async () => {
        const snapshot = await prepareBafView(bafOptions);
        window.bafPrepared = snapshot.preparationComplete;
        return snapshot.preparationComplete;
      }, run() {} }]);
  });
  await page.waitForFunction(() => window.bafPrepared === true);
  assert.equal(await page.locator('.baf-res-modal, .baf-res__comparison').count(), 0, 'precomputed BAF results stay detached');
  const reads = await page.evaluate(() => bafReads);
  assert.equal(reads, 9, 'one incomplete attempt retries automatically while both replay slots are occupied');
  assert.equal(await page.evaluate(() => releaseBattles.length), 2);
  const opened = await page.evaluate(async () => {
    const { __setBafResolutionFetcherForTest } = await import('/app/app/baf-resolution.js');
    __setBafResolutionFetcherForTest(() => { bafReads++; throw Error('network disconnected after preparation'); });
    const { openBafResolution } = await import('/app/components/app-baf-resolution-overlay.js');
    const create = document.createElement;
    const html = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    let created = 0, parsed = 0;
    document.createElement = function (...args) { created++; return create.apply(this, args); };
    Object.defineProperty(Element.prototype, 'innerHTML', { ...html,
      set(value) { parsed++; return html.set.call(this, value); } });
    try {
      const result = openBafResolution(bafOptions);
      const synchronous = Boolean(document.querySelector('[data-bind="baf-flip"]'));
      return { opened: await result, synchronous, created, parsed };
    } finally {
      document.createElement = create;
      Object.defineProperty(Element.prototype, 'innerHTML', html);
    }
  });
  assert.deepEqual(opened, { opened: true, synchronous: true, created: 1, parsed: 0 },
    'opening mounts the already built view immediately without loading UI or recomputing rows/wheel');
  assert.equal(await page.evaluate(() => bafReads), reads, 'opening makes no result requests');
  assert.equal(await page.locator('.baf-res__comparison').count(), 0, 'outcomes remain covered until the flip');
  assert.equal(await page.locator('[data-bind="baf-draw-player-percent"]').innerText(), '2.00%');
  assert.equal(await page.locator('[data-bind="baf-leaders"] .baf-res__player').count(), 2);
  await page.locator('[data-bind="baf-flip"]').click();
  await page.waitForFunction(() => document.querySelector('[data-bind="baf-shell"]')?.dataset.stage === 'complete');
  assert.equal(await page.locator('.baf-res__comparison').count(), 24);
  assert.match(await page.locator('[data-bind="baf-payout"]').innerText(), /12 TICKETS/);
  assert.equal(await page.locator('[data-bind="baf-draw-state"]').innerText(), 'YOU WON THE DRAW');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { openBafResolution } = await import('/app/components/app-baf-resolution-overlay.js');
    await openBafResolution(bafOptions);
  });
  assert.equal(await page.locator('.baf-res__comparison').count(), 0, 'reopening uses a pristine, unrevealed view');
  assert.equal(await page.locator('[data-bind="baf-gate-result"]').innerText(), 'CLICK TO FLIP');
  assert.equal(await page.evaluate(() => bafReads), reads);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { clearPendingActions } = await import('/app/app/pending-actions.js');
    clearPendingActions('slow-battles');
    releaseBattles.forEach(release => release());
  });
  await page.evaluate(async () => {
    const { decimatorBattleFixture } = await import('/app/craps/fixtures/decimator-battle.js');
    const { prepareDecimatorReplay } = await import('/app/craps/decimator-replay.js');
    const { openDecimatorDraw } = await import('/app/components/app-decimator-draw-overlay.js');
    const { snapshot, names } = decimatorBattleFixture();
    snapshot.preparedReplay = await prepareDecimatorReplay(snapshot);
    snapshot.profiles = names;
    const OriginalWorker = window.Worker;
    window.revealWorkerStarts = 0;
    window.Worker = class extends OriginalWorker { constructor(...args) { super(...args); revealWorkerStarts++; } };
    await openDecimatorDraw({ level: snapshot.level, player: snapshot.you?.address,
      loadSnapshot: async () => snapshot, loadProfiles: async () => { throw Error('unexpected profile read'); } });
  });
  await page.waitForFunction(() => document.querySelector('.decimator-craps-host p')?.hidden === true);
  assert.equal(await page.evaluate(() => revealWorkerStarts), 0, 'Decimator opens the prepared replay without recomputing the field');
  assert.deepEqual(errors, []);
  console.log('PASS: Pending prepares without opening or consuming; cached sequences reuse calculations; BAF opens offline with zero new reads and 24 prepared comparisons.');
} finally { await browser.close(); server.close(); }
