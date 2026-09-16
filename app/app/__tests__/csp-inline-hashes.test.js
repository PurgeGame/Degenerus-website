import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HEADER_LINE_LIMIT, applyCspInlineHashes, collectScopeHashes, inlineHandlerBlockers, inlineScripts,
  normalizeNewlines, rewriteHeaders, scanHtml, scriptHash,
} from '../../../db/csp-inline-hashes.mjs';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const HEADERS = `# comment
/*
  X-Content-Type-Options: nosniff

/app/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'report-sample' https://esm.sh; style-src 'self' 'unsafe-inline'; base-uri 'self'

/beta/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'report-sample' https://esm.sh; style-src 'self' 'unsafe-inline'; base-uri 'self'

/index.html
  Cache-Control: no-store
`;

test('the hash is the CSP form of sha256 over the exact script text, newline-normalized like the parser', () => {
  // Published vector: sha256 of the empty string.
  assert.equal(scriptHash(''), "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
  assert.equal(scriptHash('a\r\nb\rc'), scriptHash('a\nb\nc'));
  assert.equal(normalizeNewlines('x\r\n\r\ny\r'), 'x\n\ny\n');
  assert.notEqual(scriptHash(' alert(1)'), scriptHash('alert(1)'), 'leading whitespace is part of the hashed text');
});

test('the scanner finds inline scripts only, skips comments and src scripts, keeps raw bodies', () => {
  const html = `<!DOCTYPE html><html><head>
<!-- <script>commented()</script> -->
<script>first()</script>
<script src="/app/app/main.js" type="module"></script>
<script type="importmap">{ "imports": { "a": "/a.js" } }</script>
<script type="module">
  // a body with <!-- and </div> inside stays one script
  import '/app/x.js';
</SCRIPT >
<script>last()</script></head></html>`;
  const scripts = inlineScripts(html);
  assert.deepEqual(scripts.map((script) => script.body), [
    'first()',
    '{ "imports": { "a": "/a.js" } }',
    "\n  // a body with <!-- and </div> inside stays one script\n  import '/app/x.js';\n",
    'last()',
  ]);
  assert.deepEqual(scripts.map((script) => script.line), [3, 5, 6, 10]);
  assert.equal(scanHtml(html).scripts.length, 5, 'the src script is scanned but not inline');
});

test('markup a hash cannot admit is reported with its line', () => {
  const html = `<html><body>
<link rel="stylesheet" href="/a.css" media="print" data-deferred-css>
<link rel="stylesheet" href="/b.css" media="print" onload="this.media='all'">
<button onclick="go()">go</button>
<a href="javascript:void(0)">x</a>
<p>Turn on= the lights; data-onload=1 is text</p>
<div data-onclick="not a handler" data-on="x"></div>
<script>var s = '<img onerror="inside a script body">';</script>
</body></html>`;
  assert.deepEqual(inlineHandlerBlockers(html), [
    { line: 3, reason: 'inline event handler onload= on <link>' },
    { line: 4, reason: 'inline event handler onclick= on <button>' },
    { line: 5, reason: 'javascript: URL on <a>' },
  ]);
});

test('the rewrite swaps the script-src placeholder for sorted hashes and leaves every other directive alone', () => {
  const app = ["'sha256-zzz='", "'sha256-aaa='"];
  const beta = ["'sha256-aaa='"];
  const { text, lengths } = rewriteHeaders(HEADERS, { '/app/*': app, '/beta/*': beta });
  const lines = text.split('\n');
  assert.equal(lines[5], "  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-aaa=' 'sha256-zzz=' 'report-sample' https://esm.sh; style-src 'self' 'unsafe-inline'; base-uri 'self'");
  assert.equal(lines[8], "  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-aaa=' 'report-sample' https://esm.sh; style-src 'self' 'unsafe-inline'; base-uri 'self'");
  assert.equal(lines[0], '# comment');
  assert.equal(lines[2], '  X-Content-Type-Options: nosniff');
  assert.equal(lines[11], '  Cache-Control: no-store');
  assert.equal(lengths['/app/*'], lines[5].length);
  // A rerun replaces the previous hash list rather than stacking a second one.
  const again = rewriteHeaders(text, { '/app/*': ["'sha256-new='"], '/beta/*': ["'sha256-new='"] }).text.split('\n');
  assert.equal(again[5], "  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-new=' 'report-sample' https://esm.sh; style-src 'self' 'unsafe-inline'; base-uri 'self'");
  assert.equal(again[8], again[5]);
});

test('the rewrite refuses a missing scope, a missing placeholder, and a line past the Pages limit', () => {
  assert.throws(() => rewriteHeaders(HEADERS, { '/app/*': [], '/beta/*': [], '/other/*': [] }), /no Content-Security-Policy line under \/other\/\*/);
  const noPlaceholder = HEADERS.replace("script-src 'self' 'unsafe-inline' 'report-sample' https://esm.sh; style-src 'self' 'unsafe-inline'; base-uri 'self'\n\n/beta", "script-src 'self' https://esm.sh; style-src 'self' 'unsafe-inline'; base-uri 'self'\n\n/beta");
  assert.throws(() => rewriteHeaders(noPlaceholder, { '/app/*': [], '/beta/*': [] }), /\/app\/\*: script-src has no 'unsafe-inline' token/);
  const many = Array.from({ length: 40 }, (_, i) => `'sha256-${String(i).padStart(43, 'x')}='`);
  assert.throws(() => rewriteHeaders(HEADERS, { '/app/*': many, '/beta/*': [] }), new RegExp(`caps a _headers line at ${HEADER_LINE_LIMIT}`));
});

test('an isolated overlay gets per-scope hashes for every published document, and the authored tree is refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'purge-csp-hashes-'));
  try {
    await mkdir(join(root, 'app/components/__tests__'), { recursive: true });
    await mkdir(join(root, 'beta'));
    await writeFile(join(root, 'app/index.html'), '<script>one()</script><script type="importmap">{}</script>');
    await writeFile(join(root, 'beta/index.html'), '<script>one()</script><script type="importmap">{}</script>');
    await writeFile(join(root, 'app/viewer.html'), '<script>two()</script><script src="/x.js"></script>');
    await writeFile(join(root, 'app/components/__tests__/fixture.html'), '<script>fixture()</script>');
    await writeFile(join(root, '_headers'), HEADERS);
    const result = await applyCspInlineHashes(root);
    assert.equal(result.written, true);
    assert.deepEqual(result.scopes['/app/*'].documents, [
      { file: 'app/index.html', inlineScripts: 2 }, { file: 'app/viewer.html', inlineScripts: 1 },
    ]);
    assert.deepEqual(result.scopes['/app/*'].hashes, [scriptHash('one()'), scriptHash('{}'), scriptHash('two()')].sort());
    assert.deepEqual(result.scopes['/beta/*'].hashes, [scriptHash('one()'), scriptHash('{}')].sort());
    const written = await readFile(join(root, '_headers'), 'utf8');
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(written), 'script-src no longer carries the placeholder');
    assert.match(written, /style-src 'self' 'unsafe-inline'/, 'style-src is untouched');
    assert.ok(written.includes(scriptHash('two()')) && !written.includes(scriptHash('fixture()')), 'test fixtures are not part of the policy');
    await writeFile(join(root, 'app/index.html'), '<body onload="boot()"><script>one()</script>');
    await assert.rejects(applyCspInlineHashes(root), /app\/index\.html:1 inline event handler onload= on <body>/);
  } finally { await rm(root, { recursive: true, force: true }); }
  await assert.rejects(applyCspInlineHashes(websiteRoot), /Refusing to rewrite the authored _headers/);
});

test('the authored app publishes under a hash-only script-src', async () => {
  const { scopes, blockers } = await collectScopeHashes(websiteRoot);
  assert.deepEqual(blockers, [], 'no inline event handler or javascript: URL under app/');
  const index = await readFile(join(websiteRoot, 'app/index.html'), 'utf8');
  assert.ok(inlineScripts(index).length >= 5, 'index.html keeps its first-paint, telemetry, import map, nav and loader scripts inline');
  assert.match(index, /<script>document\.addEventListener\('load',function\(e\)\{var t=e\.target;if\(t&&t\.tagName==='LINK'&&t\.hasAttribute\('data-deferred-css'\)&&t\.media==='print'\)t\.media='all';\},true\);<\/script>/,
    'deferred stylesheets flip through one hashed head listener');
  assert.equal((index.match(/ media="print" data-deferred-css>/g) ?? []).length, 6, 'the six deferred sheets are marked for the listener');
  assert.ok(index.indexOf("hasAttribute('data-deferred-css')") < index.indexOf('data-deferred-css>'), 'the listener is registered before the first deferred sheet can load');
  assert.match(index, /s: String\(e\.sample \|\| ''\)\.slice\(0, 40\)/, 'a refused inline script is beaconed with its report-sample');
  for (const hash of scopes['/beta/*'].hashes) assert.ok(scopes['/app/*'].hashes.includes(hash), 'the beta entry is the app entry');
  const headers = await readFile(join(websiteRoot, '_headers'), 'utf8');
  const { lengths } = rewriteHeaders(headers, Object.fromEntries(Object.entries(scopes).map(([scope, entry]) => [scope, entry.hashes])));
  for (const [scope, length] of Object.entries(lengths)) assert.ok(length <= HEADER_LINE_LIMIT, `${scope} stays under the Pages line limit (${length})`);
  assert.match(headers, /\/app\/\*\n  Content-Security-Policy: [^\n]*script-src 'self' 'unsafe-inline' 'report-sample' /, 'the authored placeholder the publish replaces');
});
