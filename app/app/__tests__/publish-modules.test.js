import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { moduleSpecifiers, localImportUrl } from '../../../db/module-imports.mjs';
import { checkAppModules } from '../../../db/check-app-modules.mjs';
import { minifyPublishApp } from '../../../db/minify-publish-app.mjs';

test('publication parsing handles compact imports, re-exports, multiline and escaped paths', () => {
  const source = String.raw`
    import{foo}from './compact.js?v=1';
    export*from './star.js';
    export {
      value
    } from '../multiline.js';
    import './side-effect.js';
    const load=()=>import('./lazy.js#v2');
    import './esca\u0070ed.js';
    // import './comment.js';
    const text="import './string.js'";
    const unknown=()=>import('./'+name+'.js');
    console.log(import.meta.url);
  `;
  assert.deepEqual(moduleSpecifiers(source), [
    './compact.js?v=1', './star.js', '../multiline.js', './side-effect.js', './lazy.js#v2', './escaped.js',
  ]);
  assert.equal(localImportUrl('../lazy.js?v=2#fragment', '/app/components/panel.js?rev=1'), '/app/lazy.js?v=2');
  assert.equal(localImportUrl('//external.example/module.js', '/app/main.js'), null);
  assert.equal(localImportUrl('ethers', '/app/main.js'), null);
});

test('the disk gate checks query-pinned and dynamic imports against actual files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'purge-module-check-'));
  try {
    await mkdir(join(root, 'app'));
    await writeFile(join(root, 'app/main.js'), `import{value}from './dep.mjs?v=1'; const load=()=>import('./missing.js');`);
    await writeFile(join(root, 'app/dep.mjs'), 'export const value=1;');
    let result = await checkAppModules(root);
    assert.equal(result.checked, 2);
    assert.deepEqual(result.failures, ['app/main.js imports missing module ./missing.js']);
    await writeFile(join(root, 'app/missing.js'), 'export default 2;');
    result = await checkAppModules(root);
    assert.equal(result.failures.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the publish minifier preserves module behavior, names, classic globals and debug sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'purge-module-minify-'));
  try {
    await mkdir(join(root, 'app/vendor'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    const source = `/*! Keep this license. */
      import { value } from './dep.js?rev=2';
      export function calculate(number) { return number * value; }
      export class Player { #balance = 5n; balance() { return this.#balance; } }
      export const load = () => import('./dep.js?rev=2');
      export const asset = new URL('./badge.svg', import.meta.url).pathname;
    `;
    await writeFile(join(root, 'app/main.js'), source);
    await writeFile(join(root, 'app/dep.js'), 'export const value=7;');
    await writeFile(join(root, 'app/classic.js'), 'function initNav() { return 42; }');
    await writeFile(join(root, 'app/vendor/untouched.js'), '/* vendor stays exact */');
    const result = await minifyPublishApp(root);
    assert.equal(result.files, 3);
    const compiled = await readFile(join(root, 'app/main.js'), 'utf8');
    assert.ok(compiled.includes('Keep this license.'));
    assert.ok(compiled.includes('sourceMappingURL=main.js.map'));
    assert.equal(JSON.parse(await readFile(join(root, 'app/main.js.map'), 'utf8')).sourcesContent[0], source);
    const mod = await import(pathToFileURL(join(root, 'app/main.js')).href);
    assert.deepEqual(Object.keys(mod).sort(), ['Player', 'asset', 'calculate', 'load']);
    assert.equal(mod.calculate(6), 42);
    assert.equal(mod.calculate.name, 'calculate');
    assert.equal(mod.Player.name, 'Player');
    assert.equal(new mod.Player().balance(), 5n);
    assert.equal((await mod.load()).value, 7);
    assert.equal(mod.asset, join(root, 'app/badge.svg'));
    const context = {};
    runInNewContext(await readFile(join(root, 'app/classic.js'), 'utf8'), context);
    assert.equal(context.initNav(), 42);
    assert.equal(await readFile(join(root, 'app/vendor/untouched.js'), 'utf8'), '/* vendor stays exact */');
    assert.equal((await checkAppModules(root)).failures.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the minifier refuses to rewrite the source worktree', async () => {
  await assert.rejects(minifyPublishApp(resolve(import.meta.dirname, '../../..')), /Refusing to minify the authored app/);
});

test('the live smoke follows compact imports and rejects HTTP-200 HTML fallbacks', async () => {
  const deployment = JSON.parse(await readFile(new URL('../../../db/deployment.json', import.meta.url), 'utf8'));
  const digest = '0123456789abcdef';
  const resultPath = `/jackpots/results/7-${digest}.json`;
  let missing = false;
  const requested = new Set();
  const server = createServer((req, res) => {
    const path = req.url;
    requested.add(path);
    const url = new URL(path, 'http://127.0.0.1');
    if (['/app', '/app/', '/app/index.html'].includes(url.pathname)) {
      res.writeHead(301, { location: '/beta/' + url.search });
      res.end();
      return;
    }
    const routes = {
      '/beta/': ['text/html', '<script type="importmap">{"imports":{"ethers":"/app/vendor.js"}}</script><script type="module" src="/app/app/main.js"></script>'],
      '/app/app/main.js': ['text/javascript', 'import"../main.js";'],
      '/app/app/chain-config.js': ['text/javascript', 'export*from"./chain-config.sepolia.js";'],
      '/app/app/chain-config.sepolia.js': ['text/javascript', `export const GAME="${deployment.contracts.GAME}";`],
      '/app/main.js': ['text/javascript', 'import{value}from"./dep.js?rev=1";export*from"./star.js";import"ethers";const load=()=>import("./lazy.js");'],
      '/app/dep.js?rev=1': ['text/javascript', 'export const value=1;'],
      '/app/star.js': ['text/javascript', 'export const star=1;'],
      '/app/vendor.js': ['text/javascript', 'export const vendor=1;'],
      '/app/lazy.js': missing ? ['text/html', '<html>Site fallback</html>'] : ['text/javascript', 'export default 1;'],
      '/shared/nav.css': ['text/css', 'body{}'],
      '/shared/nav.js': ['text/javascript', 'function initNav(){}'],
      '/js/ref.js': ['text/javascript', ''],
      '/app/assets/badge-bundle-v1.json': ['application/json', '{}'],
      '/jackpots/latest.json': ['application/json', JSON.stringify({ schemaVersion: 1, day: 7, digest, resultPath, compressedBytes: 10 })],
      [resultPath]: ['application/json', '{}'],
    };
    const [type, body] = routes[path] || ['text/html', '<html>Fallback</html>'];
    res.writeHead(200, { 'content-type': type, 'content-security-policy': "default-src 'self'", 'x-jackpot-edge': 'HIT' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const args = [resolve(import.meta.dirname, '../../../db/post-publish-smoke.mjs'), '--origin', `http://127.0.0.1:${server.address().port}`];
  try {
    const result = await promisify(execFile)(process.execPath, args, { timeout: 10_000 });
    assert.match(result.stdout, /ALL OK/);
    for (const path of ['/app/dep.js?rev=1', '/app/star.js', '/app/vendor.js', '/app/lazy.js']) {
      assert.ok(requested.has(path), `the gate must actually fetch ${path}`);
    }
    missing = true;
    await assert.rejects(promisify(execFile)(process.execPath, args, { timeout: 10_000 }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /\/app\/lazy\.js.*SPA fallback/);
      return true;
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
