import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const LINK_SOURCE = readFileSync(new URL('../discord-link.js', import.meta.url), 'utf8');
const GUIDE = readFileSync(new URL('../../discord-connect.html', import.meta.url), 'utf8');

describe('Discord wallet-link handoff', () => {
  test('opens a real instruction page while the wallet signature is pending', () => {
    assert.match(LINK_SOURCE, /new URL\('\.\.\/discord-connect\.html', import\.meta\.url\)/);
    assert.match(LINK_SOURCE, /window\.open\(DISCORD_GUIDE_URL, '_blank'\)/);
    assert.doesNotMatch(LINK_SOURCE, /window\.open\(['"]about:blank/,
      'players should never be stranded on an unexplained white tab');
  });

  test('explains the two approvals without implying an onchain transaction', () => {
    assert.match(GUIDE, /SIGN THE WALLET MESSAGE/);
    assert.match(GUIDE, /CONNECT YOUR DISCORD/);
    assert.match(GUIDE, /no transaction and no gas/i);
    assert.match(GUIDE, /return to the Degenerus tab if the prompt is hidden/i);
    assert.match(GUIDE, /WAITING FOR WALLET SIGNATURE/);
  });
});
