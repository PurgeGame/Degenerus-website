// FLIP and WWXRP have ZERO decimals, and several storage words are reusable day banks. These tests
// pin the chain boundary the site keeps:
//   - inside the site every FLIP/WWXRP amount is token wei (10^18 per token);
//   - the chain's raw values are scaled up on read (decode, call, storage) and down on every
//     transaction argument;
//   - the coinflip stake lanes + virtual seed, the craps day banks, the custom battle terms, the
//     Degenerette hero ring and the shared claim word are read exactly as the contracts store them.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { loadSchema } from '../../chain/schema.js';
import * as units from '../token-units.js';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';
import { eventFacts } from '../../chain/facts.js';
import { coinflipStakeLane, coinflipSeedFromWindow, coinflipDay, heroWagerKey, dailyHeroWagerWord } from '../../chain/games.js';
import { crapsBetStorageKey, crapsBetFromStorage, decodeCustomBattleTerms } from '../../chain/craps.js';
import { bingoClaimed, affiliateDgnrsClaimed } from '../../chain/positions.js';
import { questAmount } from '../../chain/state.js';
import { recordBarToBeat } from '../../chain/boards.js';
import { ticketRedemptionOpenFromSlot0 } from '../claims.js';
import { reverseFlipCostWei } from '../coinflip.js';
import { recordClaimTargetForMark, RECORD_KIND_FLIP } from '../records.js';
import { degeneretteSpinPayout, degeneretteTotalPayoutFromChain } from '../degenerette.js';
import * as coinflipMod from '../coinflip.js';
import * as decimatorMod from '../decimator.js';
import * as wwxrpMod from '../wwxrp.js';
import * as degeneretteMod from '../degenerette.js';
import * as claimsMod from '../claims.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';
import { replayCrapsSeat, decodeCrapsReplayTape } from '../../craps/replay-engine.js';
import { validateCrapsReplayManifest, validateCrapsReplayPlayer } from '../../craps/replay-contract.js';
import { SIM_CRAPS_REPLAY_MANIFEST, SIM_CRAPS_REPLAY_SHARDS } from '../../craps/fixtures/sim-battle-v1.js';
import { ACTIVE_CHAIN_ID } from './helpers/active-chain.js';

const WEI = 10n ** 18n;

describe('the chain boundary unit', () => {
  test('FLIP and WWXRP are whole tokens on chain', () => {
    assert.equal(units.chainTokenUnit(), 1n);
    assert.equal(units.chainTokenDecimals(), 0);
    assert.equal(units.flipFromChain(100n), 100n * WEI, 'deposit 100 FLIP reads as 100e18 token wei');
    assert.equal(units.flipToChain(100n * WEI), 100n, 'and is sent as 100');
    assert.equal(units.flipToChain(100n * WEI + 1n), 100n, 'a fraction floors, never overdrawing');
    assert.equal(units.flipToChainCeil(100n * WEI + 1n), 101n, 'a charge rounds up');
    assert.equal(units.isWholeTokenAmount(100n * WEI), true);
    assert.equal(units.isWholeTokenAmount(WEI / 2n), false);
  });

  test('every rescaled event arg and call output exists in the current ABI', async () => {
    const abi = {};
    for (const key of [...Object.keys(units.WHOLE_TOKEN_EVENT_FIELDS), ...Object.keys(units.WHOLE_TOKEN_CALL_FIELDS)]) {
      const contract = key.split('.')[0];
      abi[contract] ??= (await loadSchema(contract)).abi;
    }
    for (const [key, spec] of Object.entries(units.WHOLE_TOKEN_EVENT_FIELDS)) {
      const [contract, name] = key.split('.');
      const fragment = abi[contract].find(f => f.type === 'event' && f.name === name);
      assert.ok(fragment, `${key} is an event at ${contract}`);
      for (const field of Object.keys(spec)) assert.ok(fragment.inputs.some(i => i.name === field), `${key}.${field}`);
    }
    for (const [key, spec] of Object.entries(units.WHOLE_TOKEN_CALL_FIELDS)) {
      const [contract, name] = key.split('.');
      const fragments = abi[contract].filter(f => f.type === 'function' && f.name === name);
      assert.ok(fragments.length, `${key} is a function at ${contract}`);
      for (const field of Object.keys(spec)) {
        assert.ok(fragments.some(f => f.outputs.some((o, i) => o.name === field || String(i) === field)), `${key} -> ${field}`);
      }
    }
  });

  test('decoded FLIP events and calls become token wei; ETH and per-row rules stay exact', async () => {
    const f = await rpcFixture();
    await f.event('COINFLIP', 'CoinflipStakeUpdated', { player: PLAYER, day: 7, amount: 500n, newTotal: 1_500n });
    await f.event('COINFLIP', 'BigRecordUpdated', { kind: 0, player: PLAYER, value: 9n, paid: 4n, sdgnrsPaid: 3n });
    await f.event('COINFLIP', 'BigRecordUpdated', { kind: 1, player: PLAYER, value: 9n, paid: 4n, sdgnrsPaid: 3n });
    const stake = (await eventFacts(f.s, ['CoinflipStakeUpdated'], { contract: 'COINFLIP' }))[0];
    assert.equal(stake.args.newTotal, String(1_500n * WEI));
    assert.equal(stake.args.amount, String(500n * WEI));
    assert.equal(stake.args.day, '7', 'non-amount fields are untouched');
    const [flip, spin] = await eventFacts(f.s, ['BigRecordUpdated'], { contract: 'COINFLIP' });
    assert.equal(flip.args.value, String(9n * WEI), 'the FLIP record mark is a FLIP amount');
    assert.equal(spin.args.value, '9', 'the spin record mark is ETH wei');
    assert.equal(spin.args.paid, String(4n * WEI), 'every bounty is FLIP');
    assert.equal(spin.args.sdgnrsPaid, String(3n * 10n ** 6n), 'sDGNRS is 12-decimal: scaled to 18-decimal token wei');
    f.answer('COIN', 'balanceOf', () => [250n]);
    f.answer('DGNRS', 'balanceOf', () => [250n]);
    f.answer('COINFLIP', 'coinflipAutoRebuyInfo', () => [true, 1_000n, 7n, 3]);
    assert.equal(await f.s.call('COIN', 'balanceOf', [PLAYER]), 250n * WEI);
    assert.equal(await f.s.call('DGNRS', 'balanceOf', [PLAYER]), 250n * 10n ** 6n, 'DGNRS is 12-decimal');
    const info = await f.s.call('COINFLIP', 'coinflipAutoRebuyInfo', [PLAYER]);
    assert.deepEqual([info.enabled, info.stop, info.carry, info.startDay], [true, 1_000n * WEI, 7n * WEI, 3n]);
    assert.deepEqual([info[1], info[2]], [1_000n * WEI, 7n * WEI], 'positional reads agree');
  });

  test('quest amounts scale only for the FLIP quest types', () => {
    assert.equal(questAmount(2, 2_000n), String(2_000n * WEI), 'FLIP stake quest');
    assert.equal(questAmount(5, 1_000n), String(1_000n * WEI), 'Decimator quest');
    assert.equal(questAmount(1, 10n ** 16n), String(10n ** 16n), 'ETH mint quest is wei');
    assert.equal(questAmount(4, 3n), '3', 'foil quest is a count');
  });
});

describe('coinflip stake lanes and the virtual seed', () => {
  test('eight whole-FLIP 32-bit lanes per word, key day >> 3', () => {
    const word = (777n << (5n * 32n)) | (0xffffffffn << (7n * 32n)) | 12n;
    assert.equal(coinflipStakeLane(word, 13), 777n, 'day 13 is lane 5 of key 1');
    assert.equal(coinflipStakeLane(word, 15), 0xffffffffn, 'the per-day cap is 4,294,967,295 FLIP');
    assert.equal(coinflipStakeLane(word, 8), 12n);
    assert.equal(coinflipStakeLane(word, 9), 0n);
  });

  test('the one deploy-time window seeds days firstDay..firstDay+dayCount-1 only', () => {
    const window = { firstDay: 1, dayCount: 20, amountPerDay: 200_000n };
    assert.equal(coinflipSeedFromWindow(window, 1), 200_000n);
    assert.equal(coinflipSeedFromWindow(window, 20), 200_000n);
    assert.equal(coinflipSeedFromWindow(window, 21), 0n);
    assert.equal(coinflipSeedFromWindow(window, 319), 0n, 'no x00 re-seed');
    assert.equal(coinflipSeedFromWindow(undefined, 5), 0n);
  });

  test('a player day reads the live lane, and VAULT/sDGNRS add their seed', async () => {
    const f = await rpcFixture();
    // Stake lanes are keyed by wallet ID; VAULT is protocol account 1.
    await f.wallet(37, PLAYER);
    await f.wallet(1, f.contracts.VAULT);
    await f.field('COINFLIP', 'coinflipStakeRing', (777n << (6n * 32n)) | (2n << 224n), 37, 1);
    assert.equal((await coinflipDay(f.s, 13, PLAYER)).playerStake, String(777n * WEI));
    const vault = f.contracts.VAULT.toLowerCase();
    await f.event('COINFLIP', 'SeedWindowArmed', { firstDay: 1, dayCount: 20, amountPerDay: 200_000n }, { block: 2 });
    await f.field('COINFLIP', 'coinflipStakeRing', (50n << (6n * 32n)) | (2n << 224n), 1, 1);
    assert.equal((await coinflipDay(f.s, 13, vault)).playerStake, String(200_050n * WEI), 'lane plus virtual seed');
    assert.equal((await coinflipDay(f.s, 25, vault)).playerStake, null, 'outside the window and never staked');
    assert.equal((await coinflipDay(f.s, 13, PLAYER)).playerStake, String(777n * WEI), 'players never get a seed');
  });
});

describe('craps day banks and custom terms', () => {
  const day = 42n; const slot = day * 8n + 4n; const id = (slot << 64n) | 9n;
  const CUSTOM = 1n << 40n;

  test('a scheduled bet lives in a 64-day bank, three 72-bit seats a word, and authenticates its day', () => {
    // Slot keeps its low nine bits (day mod 64); seats 7..9 share the word at index 1 + (9 - 1) / 3.
    assert.equal(crapsBetStorageKey(id), ((slot & 511n) << 64n) | 3n);
    assert.equal(crapsBetStorageKey(id + (64n << 67n)), crapsBetStorageKey(id), 'day 106 reuses day 42\'s bank');
    const bet = 0x123456789abcdef012n; // 72 bits
    // Seat 9 is the third seat of its word; the word carries its exact day in bits 216..239.
    const stored = (bet << 144n) | (day << 216n);
    assert.equal(crapsBetFromStorage(id, stored), bet);
    assert.equal(crapsBetFromStorage(id, (bet << 144n) | ((day + 64n) << 216n)), 0n, 'a later day\'s slip is not this bet');
    assert.equal(crapsBetFromStorage(id & ~((1n << 64n) - 1n), stored), 0n, 'seat 0 is no bet');
    const custom = ((CUSTOM + 3n) << 64n) | 1n;
    assert.equal(crapsBetStorageKey(custom), ((CUSTOM + 3n) << 64n) | 1n, 'custom battles keep their full slot');
    assert.equal(crapsBetFromStorage(custom, bet), bet, 'and carry no day tag');
  });

  test('custom battle terms: close 61..100, multi bit 101, high multiple 102..109', () => {
    const base = 600n | (5n << 28n) | (5n << 33n) | (3n << 43n);
    const t = decodeCustomBattleTerms(base | (1_900_000_000n << 61n) | (1n << 101n) | (255n << 102n));
    assert.deepEqual(t, { played: 600n, bankMult: 5n, goalMult: 5n, stakeUnits: 3n, closeTime: 1_900_000_000, multiEntry: true, highMultiple: 255 });
  });

  test('a replayed seat\'s won rides its ladder tail FLOORED to whole FLIP (engine pin -v4)', () => {
    const manifest = validateCrapsReplayManifest(SIM_CRAPS_REPLAY_MANIFEST);
    const tape = decodeCrapsReplayTape(manifest);
    const raw = SIM_CRAPS_REPLAY_SHARDS.flatMap(s => s.players)
      .find(p => { const v = validateCrapsReplayPlayer(p); return BigInt(v.ladderWei[v.handsPlayed]) % WEI !== 0n; });
    assert.ok(raw, 'the fixture carries a seat that ended on sub-FLIP dust');
    assert.doesNotThrow(() => replayCrapsSeat(manifest, raw, tape));
    const tail = BigInt(validateCrapsReplayPlayer(raw).ladderWei[raw.handsPlayed]);
    const unfloored = { ...raw, wonWei: (tail * BigInt(raw.entryMultiple)).toString() };
    assert.throws(() => replayCrapsSeat(manifest, unfloored, tape), /won amount/, 'the v3 unfloored figure is refused');
  });
});

describe('recycled Game words', () => {
  test('hero wagers keep two day-parity words; older days read zero', () => {
    const meta = (latest, valid) => BigInt(latest) | (BigInt(valid) << 24n);
    // day 10 (parity 0) valid for quadrants 0 and 2; day 11 (parity 1) valid for quadrant 1.
    const m = meta(11, 0b101 | (0b010 << 3));
    assert.equal(heroWagerKey(10, 0, m), 0);
    assert.equal(heroWagerKey(10, 1, m), 10, 'an unimported quadrant reads its spill key');
    assert.equal(heroWagerKey(11, 1, m), 1);
    assert.equal(heroWagerKey(9, 0, m), null, 'older than the two-day window');
    assert.equal(heroWagerKey(11, 3, m), null, 'only three quadrants are eligible');
    assert.equal(heroWagerKey(12, 0, m), 12, 'a day ahead of the ring spills to its full key');
    assert.equal(heroWagerKey(1, 0, meta(0, 0)), null, 'days 0/1 never spill (they are the buffer keys)');
  });

  test('hero words are read through the ring on the current layout', async () => {
    const f = await rpcFixture();
    await f.field('GAME', 'lootboxRngPacked', 11n | (0b001n << 24n));
    await f.field('GAME', 'dailyHeroWagers', 77n, 0, 0);
    assert.equal(await dailyHeroWagerWord(f.s, 10, 0), 77n, 'parity buffer 0');
    await f.field('GAME', 'lootboxRngPacked', 11n);
    assert.equal(await dailyHeroWagerWord(f.s, 10, 0), 0n, 'an unset quadrant has no spill on the bounded layout');
  });

  test('bingo and affiliate-DGNRS stamps share playerClaimWord', async () => {
    const f = await rpcFixture();
    // Even buffer (bits 0..24) holds level 6 + 1; odd buffer (bits 25..49) holds level 7 + 1.
    await f.field('GAME', 'playerClaimWord', (7n) | (8n << 25n) | (3n << 50n), PLAYER);
    assert.equal(await bingoClaimed(f.s, 7, PLAYER), true);
    assert.equal(await bingoClaimed(f.s, 6, PLAYER), true);
    assert.equal(await bingoClaimed(f.s, 9, PLAYER), false, 'a later level on the same parity is unclaimed');
    assert.equal(await affiliateDgnrsClaimed(f.s, 3, PLAYER), true);
    assert.equal(await affiliateDgnrsClaimed(f.s, 4, PLAYER), false);
  });

  test('the FLIP redemption window is rngFlagsAndNudges bit 9', () => {
    const at = bit => 1n << (240n + BigInt(bit));
    assert.equal(ticketRedemptionOpenFromSlot0(at(9)), true);
    assert.equal(ticketRedemptionOpenFromSlot0(at(0) | (0xffn << 240n)), false, 'nudge count bits 0..7 are not the window');
  });
});

describe('FLIP arithmetic the contracts round in whole tokens', () => {
  test('nudge prices floor each +50% step: 100, 150, 225, 337, 505, 757, 1,135', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(n => reverseFlipCostWei(n) / WEI), [100n, 150n, 225n, 337n, 505n, 757n, 1135n]);
    assert.equal(reverseFlipCostWei(3) % WEI, 0n);
  });

  test('the FLIP record bar is mark + ceil(mark / 5) in whole tokens', () => {
    assert.equal(recordClaimTargetForMark(RECORD_KIND_FLIP, 7n * WEI), 9n * WEI);
    assert.equal(recordBarToBeat(0, 7n * WEI), 9n * WEI);
    assert.equal(recordBarToBeat(1, 7n), 9n, 'ETH marks keep their wei steps');
  });

  test('a FLIP Degenerette spin floors to a whole token; ETH stays exact', () => {
    const ethPayout = degeneretteSpinPayout({ currency: 0, amountPerSpin: 1_234_567n, score: 5 });
    assert.ok(ethPayout > 0n);
    const flip = degeneretteSpinPayout({ currency: 1, amountPerSpin: 333n * WEI, score: 5, activityScore: 7 });
    assert.equal(flip % WEI, 0n, 'whole FLIP per spin');
    const packedFlip = (1n << 42n) | (100n << 60n) | 5n; // FLIP currency bit, 100 stake units, wallet 5
    assert.equal(degeneretteTotalPayoutFromChain(1_200n, packedFlip), 1_200n * WEI);
    assert.equal(degeneretteTotalPayoutFromChain(1_200n, 1n), 1_200n, 'an ETH bet pays wei');
  });
});

// ---------------------------------------------------------------------------
// Transaction arguments: token wei in, the deployment's raw units out.
// ---------------------------------------------------------------------------
const CONNECTED = '0xab12000000000000000000000000000000000000';
function fakeContract(methods) {
  const calls = {};
  const c = { connect() { return this; }, interface: { parseLog: () => null }, _calls: calls };
  for (const name of methods) {
    calls[name] = []; calls[`${name}Static`] = [];
    c[name] = Object.assign(async (...args) => {
      calls[name].push(args);
      return { hash: '0xtx', wait: async () => ({ status: 1, hash: '0xtx', logs: [] }) };
    }, { staticCall: async (...args) => { calls[`${name}Static`].push(args); } });
  }
  return c;
}

describe('FLIP/WWXRP transaction arguments are whole tokens', () => {
  beforeEach(() => {
    storeMod.__resetForTest?.();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider({ getNetwork: async () => ({ chainId: BigInt(ACTIVE_CHAIN_ID) }), getSigner: async () => ({ getAddress: async () => CONNECTED }) });
  });
  afterEach(() => {
    coinflipMod.__resetContractFactoryForTest();
    decimatorMod.__resetContractFactoryForTest();
    wwxrpMod.__resetContractFactoryForTest();
    degeneretteMod.__resetContractFactoryForTest();
    claimsMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('coinflip deposit sends 250 for 250 FLIP and refuses a fraction', async () => {
    const c = fakeContract(['depositCoinflip']);
    coinflipMod.__setContractFactoryForTest(() => c);
    await coinflipMod.depositCoinflip({ amount: 250n * WEI, player: CONNECTED });
    assert.deepEqual(c._calls.depositCoinflip, [[0, 250n]], 'account 0 = the connected wallet');
    await assert.rejects(coinflipMod.depositCoinflip({ amount: 250n * WEI + WEI / 2n, player: CONNECTED }), /whole FLIP/);
  });

  test('auto-rebuy take-profit is sent in whole FLIP', async () => {
    const c = fakeContract(['setCoinflipAutoRebuy', 'setCoinflipAutoRebuyTakeProfit']);
    coinflipMod.__setContractFactoryForTest(() => c);
    await coinflipMod.setCoinflipAutoRebuyTakeProfit({ player: CONNECTED, takeProfit: 5_000n * WEI });
    assert.deepEqual(c._calls.setCoinflipAutoRebuyTakeProfit, [[0, 5_000n]]);
  });

  test('a Decimator burn sends whole FLIP', async () => {
    const c = fakeContract(['decimatorBurn']);
    decimatorMod.__setContractFactoryForTest(() => c);
    // 2,500 clears the 2,000-FLIP minimum.
    await decimatorMod.burnForDecimator({ amount: 2_500n * WEI, player: CONNECTED, chips: 0 });
    assert.deepEqual(c._calls.decimatorBurn, [[0, 2_500n, 0]]);
    await assert.rejects(decimatorMod.burnForDecimator({ amount: 2_500n * WEI + 1n, player: CONNECTED, chips: 0 }), /whole FLIP/);
  });

  test('a WWXRP draw entry sends whole WWXRP', async () => {
    const c = fakeContract(['enter']);
    wwxrpMod.__setContractFactoryForTest(() => c);
    await wwxrpMod.burnWwxrp({ amount: 25n * WEI });
    assert.deepEqual(c._calls.enter, [[0, 25n]]);
  });

  test('a FLIP Degenerette bet sends whole FLIP per spin; ETH keeps wei', async () => {
    const c = fakeContract(['placeDegeneretteBet']);
    c.claimableWinningsOf = async () => 0n;
    degeneretteMod.__setContractFactoryForTest(() => c);
    await degeneretteMod.placeBet({ currency: 1, amountPerTicketWei: 250n * WEI, ticketCount: 2, symbol: 3, player: CONNECTED });
    assert.equal(c._calls.placeDegeneretteBet[0][2], 250n);
  });

  test('a nudge sends the quoted cost back in whole FLIP (reverseFlip compares it exactly)', async () => {
    const c = fakeContract(['reverseFlip']);
    coinflipMod.__setReverseFlipQuoteReaderForTest(async () => ({ queued: 3n, costWei: 337n * WEI, locked: false }));
    coinflipMod.__setReverseFlipContractFactoryForTest(() => c);
    try {
      await coinflipMod.reverseFlip();
      assert.deepEqual(c._calls.reverseFlipStatic, [[337n]], 'the static call carries 337, not 337e18');
      assert.deepEqual(c._calls.reverseFlip, [[337n]]);
    } finally {
      coinflipMod.__resetReverseFlipQuoteReaderForTest();
      coinflipMod.__resetReverseFlipContractFactoryForTest();
    }
  });

  test('a coinflip claim sends whole FLIP', async () => {
    const c = fakeContract(['claimCoinflips']);
    claimsMod.__setContractFactoryForTest(() => c);
    await claimsMod.claimFlip({ player: CONNECTED, amount: 42n * WEI });
    assert.deepEqual(c._calls.claimCoinflips, [[0, 42n]]);
  });
});
