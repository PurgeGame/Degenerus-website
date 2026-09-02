// Current-level referral bonuses are one logical Pending action: claim first
// when needed, otherwise open the already-paid fullscreen reward receipt.

import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement = globalThis.HTMLElement || class HTMLElement {};
globalThis.customElements = globalThis.customElements || {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};
// A real (tiny) dispatcher: launch-claims listens for the overlay's abort event
// to un-tombstone an unseen referral bonus, and a no-op stub would hide that.
globalThis.document = globalThis.document || {
  _listeners: new Map(),
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  },
  removeEventListener(type, fn) { this._listeners.get(type)?.delete(fn); },
  dispatchEvent(event) {
    for (const fn of [...(this._listeners.get(event?.type) || [])]) {
      try { fn(event); } catch (_e) { /* listeners are independent */ }
    }
    return true;
  },
};
globalThis.localStorage = {
  _values: new Map(),
  getItem(key) { return this._values.get(String(key)) ?? null; },
  setItem(key, value) { this._values.set(String(key), String(value)); },
  removeItem(key) { this._values.delete(String(key)); },
  clear() { this._values.clear(); },
};

const launch = await import('../launch-claims.js');
const wwxrpDraw = await import('../wwxrp-draw.js');
const revealOverlay = await import('../../components/reveal-overlay.js');
const { ethers } = await import('../contracts.js');
const { CHAIN, CONTRACTS } = await import('../chain-config.js');
const {
  _setSharedReadProviderForTests,
  _resetSharedReadProviderForTests,
} = await import('../read-provider.js');

// refreshLaunchClaims also fans out to readPlayerWwxrpDrawDays; default both
// API-first reads to an always-failing fetch so a collateral refresh (e.g.
// startLaunchClaims below) never reaches the real indexer API.
function stubApiFetchersToFail() {
  launch.__setLaunchClaimsFetcherForTest(async () => {
    throw new Error('launch-claims API not stubbed in this test');
  });
  wwxrpDraw.__setWwxrpDrawFetcherForTest(async () => {
    throw new Error('wwxrp-draw API not stubbed in this test');
  });
}

const PLAYER = '0xab12000000000000000000000000000000000000';
const CALLER = '0xcd34000000000000000000000000000000000000';
const LEVEL = 90;
const UNIT = 10n ** 18n;
const EVENT_ABI = [
  'event AffiliateDgnrsClaimed(address indexed affiliate, uint24 indexed level, address indexed caller, uint256 score, uint256 amount)',
];
const eventInterface = new ethers.Interface(EVENT_ABI);

function claimLog({ player = PLAYER, level = LEVEL, amount = 89_400n * UNIT } = {}) {
  const event = eventInterface.getEvent('AffiliateDgnrsClaimed');
  const encoded = eventInterface.encodeEventLog(event, [player, level, CALLER, 450n, amount]);
  return {
    address: CONTRACTS.GAME,
    blockNumber: 123,
    index: 7,
    transactionHash: '0xabc',
    topics: encoded.topics,
    data: encoded.data,
  };
}

describe('launch referral bonus action', () => {
  beforeEach(() => {
    localStorage.clear();
    launch.__resetLaunchClaimsForTest();
    revealOverlay.__resetForTest();
    stubApiFetchersToFail();
  });

  afterEach(() => {
    launch.__resetLaunchClaimsForTest();
    wwxrpDraw.__resetWwxrpDrawForTest();
  });

  test('already-claimed state opens its reward without submitting a transaction', async () => {
    let claims = 0;
    let refreshes = 0;
    const sequences = [];
    const action = launch.buildReferralBonusPendingAction({
      address: PLAYER,
      bonus: { level: LEVEL, amountWei: 89_400n * UNIT, claimed: true },
      claimBonus: async () => { claims += 1; },
      reveal: (sequence) => { sequences.push(sequence); return true; },
      refresh: async () => { refreshes += 1; },
      getAddress: () => PLAYER,
    });

    assert.equal(action.label, 'L90 REFERRAL BONUS');
    assert.equal(action.kindLabel, 'REFERRAL BONUS');
    assert.equal(action.write, false, 'an already-paid reward is a presentation, not a write');
    assert.equal(action.shortLabel, 'View Referral Bonus');

    assert.equal(await action.run(), true);
    assert.equal(claims, 0);
    assert.equal(refreshes, 1);
    assert.equal(sequences.length, 1);
    assert.equal(sequences[0].kind, 'referral-bonus');
    assert.equal(sequences[0].amountWei, 89_400n * UNIT);
  });

  test('closing the overlay un-tombstones a referral bonus the player never saw', async () => {
    const sequences = [];
    const action = launch.buildReferralBonusPendingAction({
      address: PLAYER,
      bonus: { level: LEVEL, amountWei: 89_400n * UNIT, claimed: true },
      claimBonus: async () => {},
      reveal: (sequence) => { sequences.push(sequence); return true; },
      refresh: async () => {},
      getAddress: () => PLAYER,
    });
    assert.equal(await action.run(), true);
    const [sequence] = sequences;
    assert.deepEqual(sequence.revealRelease, { address: PLAYER, level: LEVEL },
      'the sequence carries the identity the overlay hands back');
    assert.equal(launch.__referralBonusRevealedForTest(PLAYER, LEVEL), true,
      'queuing marks it revealed so a poll cannot double-present it');

    launch.startLaunchClaims({ getAddress: () => PLAYER, getLevel: () => LEVEL });
    document.dispatchEvent(new CustomEvent(revealOverlay.RESULT_REVEAL_ABORT_EVENT, {
      detail: {
        released: [{
          kind: 'referral-bonus',
          presentationId: sequence.presentationId,
          release: sequence.revealRelease,
        }],
      },
    }));
    assert.equal(launch.__referralBonusRevealedForTest(PLAYER, LEVEL), false,
      'a bonus the player never watched is offered again instead of being lost');
  });

  test('unclaimed state submits one player claim and reveals the receipt amount', async () => {
    const sequences = [];
    const claimedPlayers = [];
    const action = launch.buildReferralBonusPendingAction({
      address: PLAYER,
      bonus: { level: LEVEL, amountWei: 80_000n * UNIT, claimed: false },
      readBonus: async () => ({
        level: LEVEL, amountWei: 80_000n * UNIT, claimed: false,
      }),
      claimBonus: async ({ player }) => {
        claimedPlayers.push(player);
        return { receipt: { logs: [claimLog({ amount: 89_400n * UNIT })] } };
      },
      reveal: (sequence) => { sequences.push(sequence); return true; },
      refresh: async () => {},
      getAddress: () => PLAYER,
    });

    assert.equal(action.write, true);
    assert.equal(await action.run(), true);
    assert.deepEqual(claimedPlayers, [PLAYER]);
    assert.equal(sequences.length, 1);
    assert.equal(sequences[0].amountWei, 89_400n * UNIT,
      'the confirmed event overrides the pre-transaction estimate');
  });

  test('a keeper race becomes the same reward instead of a failed action', async () => {
    const sequences = [];
    const error = new Error('claim failed');
    error.cause = { revert: { name: 'AlreadyClaimed' } };
    const action = launch.buildReferralBonusPendingAction({
      address: PLAYER,
      bonus: { level: LEVEL, amountWei: 12_345n * UNIT, claimed: false },
      readBonus: async () => ({
        level: LEVEL, amountWei: 12_345n * UNIT, claimed: false,
      }),
      claimBonus: async () => { throw error; },
      reveal: (sequence) => { sequences.push(sequence); return true; },
      refresh: async () => {},
      getAddress: () => PLAYER,
    });

    assert.equal(await action.run(), true);
    assert.equal(sequences[0].amountWei, 12_345n * UNIT);
  });

  test('chain simulation distinguishes a settled bonus when requested', async () => {
    launch.__setLaunchClaimsContractFactoryForTest((address) => {
      if (String(address).toLowerCase() === String(CONTRACTS.AFFILIATE).toLowerCase()) {
        return {
          affiliateScore: async () => 4n,
          totalAffiliateScore: async () => 10n,
        };
      }
      if (String(address).toLowerCase() === String(CONTRACTS.GAME_LENS).toLowerCase()) {
        return { levelDgnrsInfo: async () => ({ allocation: 1_000n * UNIT }) };
      }
      const claimed = new Error('execution reverted');
      claimed.revert = { name: 'AlreadyClaimed' };
      return {
        claimAffiliateDgnrs: {
          staticCall: async () => { throw claimed; },
        },
      };
    });

    assert.equal(await launch.readAffiliateLevelBonus({ player: PLAYER, level: LEVEL }), null,
      'ordinary eligibility reads still omit a settled write');
    const state = await launch.readAffiliateLevelBonus({
      player: PLAYER,
      level: LEVEL,
      includeClaimed: true,
    });
    assert.equal(state.claimed, true);
    assert.equal(state.amountWei, 400n * UNIT);
  });

  test('receipt decoder selects this player and level from unrelated logs', () => {
    const decoded = launch.decodeAffiliateDgnrsClaim([
      claimLog({ level: LEVEL - 1, amount: 1n }),
      claimLog({ amount: 777n * UNIT }),
    ], { player: PLAYER, level: LEVEL });
    assert.equal(decoded.level, LEVEL);
    assert.equal(decoded.amountWei, 777n * UNIT);
    assert.equal(decoded.caller, CALLER);
  });
});

describe('referral bonus reveal presentation', () => {
  beforeEach(() => revealOverlay.__resetForTest());

  test('normalizes as a named DGNRS reward with a win exit', () => {
    const input = launch.referralBonusRevealSequence({
      player: PLAYER,
      level: LEVEL,
      amountWei: 89_400n * UNIT,
    });
    const sequence = revealOverlay.normalizeSequence(input);
    assert.equal(sequence.title, 'REFERRAL BONUS');
    assert.equal(sequence.cards.length, 1);
    assert.equal(sequence.cards[0].label, 'LEVEL 90 REFERRAL BONUS');
    assert.equal(sequence.cards[0].value, '89,400 DGNRS');
    assert.equal(revealOverlay.revealTerminalActionLabel(sequence), 'TAKE THE WIN');
  });

  test('deduplicates the transaction and settled-read paths by player and level', () => {
    const sequence = launch.referralBonusRevealSequence({
      player: PLAYER,
      level: LEVEL,
      amountWei: 89_400n * UNIT,
    });
    assert.equal(revealOverlay.queueReveal(sequence), true);
    assert.equal(revealOverlay.queueReveal({ ...sequence }), false);
    assert.equal(revealOverlay.__takeQueuedForTest().length, 1);
  });
});

describe('foil-level API-first discovery', () => {
  beforeEach(() => {
    localStorage.clear();
    launch.__resetLaunchClaimsForTest();
    stubApiFetchersToFail();
  });

  afterEach(() => {
    launch.__resetLaunchClaimsForTest();
    _resetSharedReadProviderForTests();
  });

  test('reads foil levels from the API before touching the chain log scan', async () => {
    const fetchCalls = [];
    launch.__setLaunchClaimsFetcherForTest(async (path) => {
      fetchCalls.push(path);
      return {
        toBlock: 4321,
        events: [
          { name: 'FoilPackBought', args: { buyer: PLAYER, level: '5', multBps: '15000', weiIn: '1' }, blockNumber: 10, logIndex: 0, transactionHash: '0xf1' },
          { name: 'FoilPackBought', args: { buyer: PLAYER, level: '3', multBps: '15000', weiIn: '1' }, blockNumber: 11, logIndex: 0, transactionHash: '0xf2' },
        ],
      };
    });
    _setSharedReadProviderForTests({
      getBlockNumber: async () => { throw new Error('must not scan chain when the API answers'); },
      getLogs: async () => { throw new Error('must not scan chain when the API answers'); },
    });

    const result = await launch.__readPlayerFoilLevelsForTest(PLAYER);
    assert.deepEqual(fetchCalls, [`/player/${PLAYER.toLowerCase()}/facts?names=FoilPackBought`]);
    assert.deepEqual(result.levels, [3, 5]);
    assert.equal(result.complete, true);
  });

  test('falls back to the chain scan on an API failure and memoizes it', async () => {
    const base = Number(CHAIN.deployBlock);
    let head = base + 5;
    const ranges = [];
    let fetchCalls = 0;
    launch.__setLaunchClaimsFetcherForTest(async () => {
      fetchCalls += 1;
      const error = new Error('API 404');
      error.status = 404;
      throw error;
    });
    _setSharedReadProviderForTests({
      getBlockNumber: async () => head,
      getLogs: async ({ fromBlock, toBlock }) => {
        ranges.push([Number(fromBlock), Number(toBlock)]);
        return [];
      },
    });

    await launch.__readPlayerFoilLevelsForTest(PLAYER);
    assert.equal(fetchCalls, 1, 'the first read attempts the API once');
    assert.equal(ranges.length, 1, 'an API failure falls back to the chain scan');

    head += 5;
    await launch.__readPlayerFoilLevelsForTest(PLAYER);
    assert.equal(fetchCalls, 1, 'a memoized API failure is not retried within the 5-minute window');
    assert.equal(ranges.length, 2, 'the chain fallback keeps serving reads while the API is memoized');
  });

  test('a gameState-triggered read never falls back to the chain scan', async () => {
    launch.__setLaunchClaimsFetcherForTest(async () => {
      throw new Error('API down');
    });
    _setSharedReadProviderForTests({
      getBlockNumber: async () => { throw new Error('must not scan chain when fallback is disallowed'); },
      getLogs: async () => { throw new Error('must not scan chain when fallback is disallowed'); },
    });

    const result = await launch.__readPlayerFoilLevelsForTest(PLAYER, { allowChainFallback: false });
    assert.deepEqual(result.levels, []);
    assert.equal(result.complete, false);
  });
});
