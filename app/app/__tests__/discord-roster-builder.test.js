import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The simulated roster is 945 invented identities. A note in a runbook is not
// a control — whoever runs the export next, human or agent, may never read it.
// These gates pin the two halves that actually stop a testnet roster reaching
// a mainnet leaderboard.
const BUILDER = readFileSync(new URL('../../../db/build-discord-roster.mjs', import.meta.url), 'utf8');
const PROFILES = readFileSync(new URL('../profiles.js', import.meta.url), 'utf8');

test('--sim is refused unless the ACTIVE chain profile is a known testnet', () => {
  assert.match(BUILDER, /const TESTNET_CHAIN_IDS = new Set\(\[([^\]]*)\]\)/);
  const ids = BUILDER.match(/const TESTNET_CHAIN_IDS = new Set\(\[([^\]]*)\]\)/)[1]
    .split(',').map((value) => Number(value.trim())).filter(Number.isFinite);
  assert.ok(ids.length > 0);
  assert.ok(!ids.includes(1), 'Ethereum mainnet must never be a chain a simulated roster can be built for');
  assert.match(BUILDER, /if \(simPath && !TESTNET_CHAIN_IDS\.has\(activeChainId\)\)/);
  assert.match(BUILDER, /process\.exit\(2\)/);
  // An unreadable profile must not read as permission.
  assert.match(BUILDER, /let activeChainId = null;/);
});

test('the roster records the chain it was built for', () => {
  assert.match(BUILDER, /chainId: activeChainId,/);
});

test('the client drops the simulated lane when the roster is for another chain', () => {
  assert.match(PROFILES, /const simulationTrusted = Number\(body\?\.chainId\) === Number\(CHAIN\.id\);/);
  assert.match(PROFILES, /if \(entry\?\.sim && !simulationTrusted\)/);
});
