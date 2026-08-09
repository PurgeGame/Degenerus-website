// Deferred whale-pass claims are sourced from GAME and published into Pending.

import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as claims from '../claims.js';
import * as contracts from '../contracts.js';
import * as pending from '../pending-actions.js';
import * as store from '../store.js';
import * as watcher from '../whale-pass-claims.js';
import { CHAIN } from '../chain-config.js';

globalThis.localStorage = globalThis.localStorage || {
  _values: new Map(),
  getItem(key) { return this._values.get(String(key)) ?? null; },
  setItem(key, value) { this._values.set(String(key), String(value)); },
  removeItem(key) { this._values.delete(String(key)); },
  clear() { this._values.clear(); },
};

const PLAYER = '0xab12000000000000000000000000000000000000';
const OTHER = '0xdef0000000000000000000000000000000000000';

describe('whale-pass live wiring', () => {
  const claimsSource = readFileSync(new URL('../claims.js', import.meta.url), 'utf8');
  const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

  test('ships the deployed GAME read/write signatures', () => {
    assert.match(claimsSource, /function claimWhalePass\(address player\) external/);
    assert.match(claimsSource, /function whalePassClaimAmount\(address player\) view returns \(uint256\)/);
  });

  test('boots and refreshes the watcher from the live app orchestrator', () => {
    assert.match(mainSource, /startWhalePassClaims\(/);
    assert.match(mainSource, /refreshWhalePassClaims\(/);
  });
});

function provider(address = PLAYER) {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => address }),
  };
}

function tx() {
  return { hash: '0xwhale', wait: async () => ({ status: 1, hash: '0xwhale', logs: [] }) };
}

describe('whale-pass claim contract helpers', () => {
  let calls;

  beforeEach(() => {
    store.__resetForTest();
    store.update('connected.address', PLAYER);
    store.update('viewing.address', null);
    store.update('ui.mode', 'self');
    contracts.setProvider(provider());
    calls = { read: [], claim: [] };
    const fake = {
      whalePassClaimAmount: async (...args) => {
        calls.read.push(args);
        return 3n;
      },
      claimWhalePass: Object.assign(
        async (...args) => {
          calls.claim.push(args);
          return tx();
        },
        { staticCall: async () => undefined },
      ),
      connect() { return this; },
    };
    claims.__setContractFactoryForTest(() => fake);
  });

  afterEach(() => {
    claims.__resetContractFactoryForTest();
    contracts.clearProvider();
  });

  test('reads whalePassClaimAmount from chain for the acting player', async () => {
    assert.equal(await claims.readWhalePassClaimAmount(), 3n);
    assert.deepEqual(calls.read, [[PLAYER]]);
  });

  test('claims an explicit player through the guarded transaction path', async () => {
    const result = await claims.claimWhalePass({ player: OTHER });
    assert.deepEqual(calls.claim, [[OTHER]]);
    assert.equal(result.player, OTHER);
    assert.equal(result.receipt.status, 1);
  });

  test('a failed chain read is unknown rather than a fake zero', async () => {
    claims.__setContractFactoryForTest(() => ({
      whalePassClaimAmount: async () => { throw new Error('rpc unavailable'); },
    }));
    assert.equal(await claims.readWhalePassClaimAmount(), null);
  });
});

describe('whale-pass Pending publisher', () => {
  let address;
  let amount;
  let claimedFor;
  let readFails;

  beforeEach(() => {
    store.__resetForTest();
    localStorage.clear();
    pending.__resetPendingActionsForTest();
    watcher.__resetWhalePassClaimsForTest();
    address = PLAYER;
    amount = 2n;
    claimedFor = null;
    readFails = false;
    watcher.__setWhalePassClaimsForTest({
      read: async ({ player }) => {
        assert.equal(player, String(address).toLowerCase());
        return readFails ? null : amount;
      },
      claim: async ({ player }) => {
        claimedFor = player;
        amount = 0n;
        return { receipt: { status: 1 } };
      },
    });
  });

  afterEach(() => {
    watcher.__resetWhalePassClaimsForTest();
    pending.__resetPendingActionsForTest();
  });

  async function startAndRefresh() {
    watcher.startWhalePassClaims({ getAddress: () => address });
    await watcher.refreshWhalePassClaims();
    await Promise.resolve();
  }

  test('publishes a first-class claim only for a non-zero on-chain balance', async () => {
    await startAndRefresh();
    const [row] = pending.getPendingActions();
    assert.ok(row, 'claim is present in Pending');
    assert.equal(row.kind, 'whale-pass-claim');
    assert.equal(row.state, 'ready');
    assert.equal(row.write, true);
    assert.equal(row.autoOpen, false, 'a transaction is never auto-opened');
    assert.equal(row.whalePassHalfCount, 2n);
    assert.match(row.label, /2 whale-pass halves/i);
    assert.match(row.detail, /next 100 levels/i);

    await row.run();
    assert.equal(claimedFor, PLAYER.toLowerCase());
    assert.deepEqual(pending.getPendingActions(), [], 'confirmed claim leaves Pending');
  });

  test('zero balance and read-only/no-address state publish nothing', async () => {
    amount = 0n;
    await startAndRefresh();
    assert.deepEqual(pending.getPendingActions(), []);

    amount = 4n;
    address = null;
    await watcher.refreshWhalePassClaims();
    assert.deepEqual(pending.getPendingActions(), []);
  });

  test('a transient RPC failure preserves an already-known valid claim', async () => {
    await startAndRefresh();
    assert.equal(pending.getPendingActions().length, 1);
    readFails = true;
    await watcher.refreshWhalePassClaims();
    assert.equal(pending.getPendingActions().length, 1);
  });

  test('a new jackpot-awarded balance delta stays hidden until the board is complete', async () => {
    await startAndRefresh();
    assert.equal(pending.getPendingActions()[0]?.whalePassHalfCount, 2n);

    store.update('app.daySync', { day: 55, rngRequested: true, jackpotReady: true });
    store.update('app.gameState', { level: 31, dailyRng: { day: 55, finalWord: '1' } });
    amount = 5n;
    await watcher.refreshWhalePassClaims();
    assert.equal(pending.getPendingActions()[0]?.whalePassHalfCount, 2n,
      'the pre-existing claim remains while the covered three-half increase is withheld');

    localStorage.setItem(`jackpot_complete_day_${CHAIN.id}_55`, '1');
    await watcher.refreshWhalePassClaims();
    assert.equal(pending.getPendingActions()[0]?.whalePassHalfCount, 5n,
      'the full authoritative balance appears after the final scratch');
  });

  test('switching the acting player retires the captured action immediately', async () => {
    await startAndRefresh();
    const oldRun = pending.getPendingActions()[0].run;
    address = OTHER;
    await oldRun();
    assert.equal(claimedFor, null, 'stale account action never writes');
  });
});
