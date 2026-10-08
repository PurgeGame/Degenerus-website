import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyInfoPagePause } from '../../../db/apply-info-page-pause.mjs';

test('publication pause replaces nested guides, preserves app/assets, and is repeatable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'info-pause-test-'));
  try {
    for (const directory of ['shared', 'app', 'learn/tutorial', 'whitepaper']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    await writeFile(join(root, 'shared/nav.js'), "const pages = [\n  { key: 'app', href: '/beta/' },\n  { key: 'whitepaper', href: '/whitepaper/' },\n  { key: 'theory', href: '/theory/' },\n];\n");
    await writeFile(join(root, '_headers'), '/app/*\n  Content-Security-Policy: preserved\n');
    await writeFile(join(root, 'app/index.html'), 'live app');
    await writeFile(join(root, 'whitepaper/flame-logo.svg'), '<svg>preserved art</svg>');
    await writeFile(join(root, 'learn/tutorial/index.html'), 'old economic claims');
    await applyInfoPagePause(root);
    assert.match(await readFile(join(root, 'learn/tutorial/index.html'), 'utf8'), /data-info-pages-paused/);
    assert.doesNotMatch(await readFile(join(root, 'learn/tutorial/index.html'), 'utf8'), /old economic claims/);
    assert.equal(await readFile(join(root, 'app/index.html'), 'utf8'), 'live app');
    assert.equal(await readFile(join(root, 'whitepaper/flame-logo.svg'), 'utf8'), '<svg>preserved art</svg>');
    assert.doesNotMatch(await readFile(join(root, 'shared/nav.js'), 'utf8'), /whitepaper|theory/);
    assert.match(await readFile(join(root, 'GAME_THEORY_ANALYSIS.md'), 'utf8'), /temporarily offline/);
    const headers = await readFile(join(root, '_headers'), 'utf8');
    assert.match(headers, /Content-Security-Policy: preserved/);
    assert.match(headers, /\/learn\/\*\n  ! Cache-Control\n  Cache-Control: no-store\n  X-Robots-Tag: noindex/);
    await applyInfoPagePause(root);
    assert.equal(await readFile(join(root, '_headers'), 'utf8'), headers);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the pause refuses to overwrite editable source pages', async () => {
  await assert.rejects(applyInfoPagePause(fileURLToPath(new URL('../../../', import.meta.url))),
    /Refusing to replace editable information pages/);
});
