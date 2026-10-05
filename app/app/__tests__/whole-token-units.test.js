// Audit eb04b2e80 (run 64): FLIP and WWXRP have ZERO decimals, and several storage words became
// reusable day banks. These tests pin the chain boundary the site keeps:
//   - inside the site every FLIP/WWXRP amount is token wei (10^18 per token);
//   - a whole-token deployment's raw values are scaled up on read (decode, call, storage) and
//     down on every transaction argument; an 18-decimal deployment passes through unchanged;
//   - the coinflip stake lanes + virtual seed, the craps day banks, the custom battle terms, the
//     Degenerette hero ring and the shared claim word are read exactly as the contracts store them.
// Every test pins its schema explicitly: the suite runs under whichever deployment profile is active.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useSchema, hasWholeTokens, loadSchema, CURRENT_SCHEMA_HASH, BEFORE_WHOLE_TOKENS_SCHEMA_HASH, BEFORE_DECIMATOR_JACKPOT_SCHEMA_HASH } from '../../chain/schema.js';
import * as units from '../token-units.js';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';
import { eventFacts } from '../../chain/facts.js';
import { coinflipStakeLane, coinflipSeedFromWindows, coinflipDay, heroWagerKey, dailyHeroWagerWord } from '../../chain/games.js';
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

const WEI = 10n ** 18n;
const withSchema = async (hash, fn) => {
  const previous = useSchema(hash);
  try { return await fn(); } finally { useSchema(previous); }
};
const current = fn => withSchema(CURRENT_SCHEMA_HASH, fn);
const run63 = fn => withSchema(BEFORE_WHOLE_TOKENS_SCHEMA_HASH, fn);

describe('the chain boundary unit', () => {
  test('whole tokens from audit eb04b2e80 on; the frozen run-63 schema keeps 18 decimals', async () => {
    await current(() => {
      assert.equal(hasWholeTokens(), true);
      assert.equal(units.chainTokenUnit(), 1n);
      assert.equal(units.chainTokenDecimals(), 0);
      assert.equal(units.flipFromChain(100n), 100n * WEI, 'deposit 100 FLIP reads as 100e18 token wei');
      assert.equal(units.flipToChain(100n * WEI), 100n, 'and is sent as 100');
      assert.equal(units.flipToChain(100n * WEI + 1n), 100n, 'a fraction floors, never overdrawing');
      assert.equal(units.flipToChainCeil(100n * WEI + 1n), 101n, 'a charge rounds up');
      assert.equal(units.isWholeTokenAmount(100n * WEI), true);
      assert.equal(units.isWholeTokenAmount(WEI / 2n), false);
    });
    await run63(() => {
      assert.equal(hasWholeTokens(), false);
      assert.equal(units.chainTokenUnit(), WEI);
      assert.equal(units.flipFromChain(123n), 123n);
      assert.equal(units.flipToChain(123n), 123n);
      assert.equal(units.isWholeTokenAmount(1n), true);
    });
  });

  // Both whole-token deployments share the tables: run 64 (frozen 54fe7634, audit ca2bb497f) and the
  // current audit. Audit 01f11477c dropped RedemptionSubmitted.flipEscrowed, so an entry must match
  // at least one of the two ABIs.
  test('every rescaled event arg and call output exists in a whole-token ABI', async () => {
    const abis = [];
    for (const hash of [CURRENT_SCHEMA_HASH, BEFORE_DECIMATOR_JACKPOT_SCHEMA_HASH]) {
      await withSchema(hash, async () => {
        const byContract = {};
        for (const key of [...Object.keys(units.WHOLE_TOKEN_EVENT_FIELDS), ...Object.keys(units.WHOLE_TOKEN_CALL_FIELDS)]) {
          const contract = key.split('.')[0];
          byContract[contract] ??= (await loadSchema(contract)).abi;
        }
        abis.push(byContract);
      });
    }
    for (const [key, spec] of Object.entries(units.WHOLE_TOKEN_EVENT_FIELDS)) {
      const [contract, name] = key.split('.');
      const fragments = abis.map(abi => abi[contract].find(f => f.type === 'event' && f.name === name)).filter(Boolean);
      assert.ok(fragments.length, `${key} is an event at ${contract}`);
      for (const field of Object.keys(spec)) assert.ok(fragments.some(f => f.inputs.some(i => i.name === field)), `${key}.${field}`);
    }
    for (const [key, spec] of Object.entries(units.WHOLE_TOKEN_CALL_FIELDS)) {
      const [contract, name] = key.split('.');
      const fragments = abis.flatMap(abi => abi[contract].filter(f => f.type === 'function' && f.name === name));
      assert.ok(fragments.length, `${key} is a function at ${contract}`);
      for (const field of Object.keys(spec)) {
        assert.ok(fragments.some(f => f.outputs.some((o, i) => o.name === field || String(i) === field)), `${key} -> ${field}`);
      }
    }
    await current(async () => {
      for (const key of ['GAME.DecimatorReferenceUpdated', 'GAME.DecimatorJackpotPlan', 'SDGNRS.RedemptionBatchClosed', 'CRAPS.JackpotSubsidyRolled']) {
        const [contract, name] = key.split('.');
        assert.ok((await loadSchema(contract)).abi.some(f => f.type === 'event' && f.name === name), `${key} is current`);
      }
    });
  });

  test('decoded FLIP events and calls become token wei; ETH, DGNRS and per-row rules stay exact', () => current(async () => {
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
    assert.equal(spin.args.sdgnrsPaid, '3', 'sDGNRS stays 18-decimal');
    f.answer('COIN', 'balanceOf', () => [250n]);
    f.answer('DGNRS', 'balanceOf', () => [250n]);
    f.answer('COINFLIP', 'coinflipAutoRebuyInfo', () => [true, 1_000n, 7n, 3]);
    assert.equal(await f.s.call('COIN', 'balanceOf', [PLAYER]), 250n * WEI);
    assert.equal(await f.s.call('DGNRS', 'balanceOf', [PLAYER]), 250n);
    const info = await f.s.call('COINFLIP', 'coinflipAutoRebuyInfo', [PLAYER]);
    assert.deepEqual([info.enabled, info.stop, info.carry, info.startDay], [true, 1_000n * WEI, 7n * WEI, 3n]);
    assert.deepEqual([info[1], info[2]], [1_000n * WEI, 7n * WEI], 'positional reads agree');
  }));

  test('the same raw events read unchanged on the 18-decimal run-63 schema', () => run63(async () => {
    const f = await rpcFixture();
    await f.event('COINFLIP', 'CoinflipStakeUpdated', { player: PLAYER, day: 7, amount: 500n, newTotal: 1_500n });
    const stake = (await eventFacts(f.s, ['CoinflipStakeUpdated'], { contract: 'COINFLIP' }))[0];
    assert.equal(stake.args.newTotal, '1500');
  }));

  test('quest amounts scale only for the FLIP quest types', () => current(() => {
    assert.equal(questAmount(2, 2_000n), String(2_000n * WEI), 'FLIP stake quest');
    assert.equal(questAmount(5, 1_000n), String(1_000n * WEI), 'Decimator quest');
    assert.equal(questAmount(1, 10n ** 16n), String(10n ** 16n), 'ETH mint quest is wei');
    assert.equal(questAmount(4, 3n), '3', 'foil quest is a count');
  }));
});

describe('coinflip stake lanes and the virtual seed', () => {
  test('eight whole-FLIP 32-bit lanes per word, key day >> 3', () => {
    const word = (777n << (5n * 32n)) | (0xffffffffn << (7n * 32n)) | 12n;
    assert.equal(coinflipStakeLane(word, 13), 777n, 'day 13 is lane 5 of key 1');
    assert.equal(coinflipStakeLane(word, 15), 0xffffffffn, 'the per-day cap is 4,294,967,295 FLIP');
    assert.equal(coinflipStakeLane(word, 8), 12n);
    assert.equal(coinflipStakeLane(word, 9), 0n);
  });

  test('a seed day belongs to the latest window armed at or before it', () => {
    const windows = [{ firstDay: 1, dayCount: 20, amountPerDay: 200_000n }, { firstDay: 300, dayCount: 20, amountPerDay: 200_000n }];
    assert.equal(coinflipSeedFromWindows(windows, 1), 200_000n);
    assert.equal(coinflipSeedFromWindows(windows, 20), 200_000n);
    assert.equal(coinflipSeedFromWindows(windows, 21), 0n);
    assert.equal(coinflipSeedFromWindows(windows, 319), 200_000n);
    assert.equal(coinflipSeedFromWindows(windows, 320), 0n);
    assert.equal(coinflipSeedFromWindows([], 5), 0n);
  });

  test('a player day reads the live lane, and VAULT/sDGNRS add their seed', () => current(async () => {
    const f = await rpcFixture();
    await f.field('COINFLIP', 'coinflipStakePacked', 777n << (5n * 32n), 1, PLAYER);
    assert.equal((await coinflipDay(f.s, 13, PLAYER)).playerStake, String(777n * WEI));
    const vault = f.contracts.VAULT.toLowerCase();
    await f.event('COINFLIP', 'SeedWindowArmed', { century: 0, firstDay: 1, dayCount: 20, amountPerDay: 200_000n }, { block: 2 });
    await f.field('COINFLIP', 'coinflipStakePacked', 50n << (5n * 32n), 1, vault);
    assert.equal((await coinflipDay(f.s, 13, vault)).playerStake, String(200_050n * WEI), 'lane plus virtual seed');
    assert.equal((await coinflipDay(f.s, 25, vault)).playerStake, null, 'outside the window and never staked');
    assert.equal((await coinflipDay(f.s, 13, PLAYER)).playerStake, String(777n * WEI), 'players never get a seed');
  }));
});

describe('craps day banks and custom terms', () => {
  const day = 42n; const slot = day * 8n + 4n; const id = (slot << 64n) | 9n;
  const tag = d => ((d & 0xffffn) << 190n) | ((d >> 16n) << 209n);

  test('a scheduled bet lives at id mod 2^73 and authenticates its exact day', () => current(() => {
    assert.equal(crapsBetStorageKey(id), id & ((1n << 73n) - 1n));
    assert.equal(crapsBetStorageKey(id + (64n << 67n)), crapsBetStorageKey(id), 'day 106 reuses day 42\'s bank');
    const word = BigInt(PLAYER) | (0o3n << 160n) | (1n << 217n) | (5n << 224n);
    assert.equal(crapsBetFromStorage(id, word | tag(day)), word, 'the tag is stripped before decoding');
    assert.equal(crapsBetFromStorage(id, word | tag(day + 64n)), 0n, 'a later day\'s slip is not this bet');
    const bigDay = 70_000n; const bigId = ((bigDay * 8n + 1n) << 64n) | 1n;
    assert.equal(crapsBetFromStorage(bigId, word | tag(bigDay)), word, 'days past 2^16 use the high byte');
    const custom = ((1n << 40n) + 3n) << 64n | 1n;
    assert.equal(crapsBetStorageKey(custom), custom, 'custom battles keep their full id');
    assert.equal(crapsBetFromStorage(custom, word), word);
  }));

  test('the 18-decimal run-63 layout keeps the full id and no tag', () => run63(() => {
    assert.equal(crapsBetStorageKey(id), id);
    assert.equal(crapsBetFromStorage(id, 123n), 123n);
  }));

  test('custom battle terms: close 61..100, multi bit 101, high multiple 102..109 (run 63: 73/113/114)', async () => {
    const base = 600n | (5n << 28n) | (5n << 33n) | (3n << 43n);
    await current(() => {
      const t = decodeCustomBattleTerms(base | (1_900_000_000n << 61n) | (1n << 101n) | (255n << 102n));
      assert.deepEqual(t, { played: 600n, bankMult: 5n, goalMult: 5n, stakeUnits: 3n, closeTime: 1_900_000_000, multiEntry: true, highMultiple: 255 });
    });
    await run63(() => {
      const t = decodeCustomBattleTerms(base | (1_900_000_000n << 73n) | (1n << 113n) | (256n << 114n));
      assert.deepEqual([t.closeTime, t.multiEntry, t.highMultiple], [1_900_000_000, true, 256]);
    });
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

  test('hero words are read through the ring on the current layout', () => current(async () => {
    const f = await rpcFixture();
    await f.field('GAME', 'lootboxRngPacked', 11n | (0b001n << 24n));
    await f.field('GAME', 'dailyHeroWagers', 77n, 0, 0);
    await f.field('GAME', 'dailyHeroWagers', 99n, 10, 0);
    assert.equal(await dailyHeroWagerWord(f.s, 10, 0), 77n, 'parity buffer 0');
    await f.field('GAME', 'lootboxRngPacked', 11n);
    assert.equal(await dailyHeroWagerWord(f.s, 10, 0), 99n, 'not yet imported: the spill word');
  }));

  test('bingo and affiliate-DGNRS stamps share playerClaimWord', () => current(async () => {
    const f = await rpcFixture();
    // Even buffer (bits 0..24) holds level 6 + 1; odd buffer (bits 25..49) holds level 7 + 1.
    await f.field('GAME', 'playerClaimWord', (7n) | (8n << 25n) | (3n << 50n), PLAYER);
    assert.equal(await bingoClaimed(f.s, 7, PLAYER), true);
    assert.equal(await bingoClaimed(f.s, 6, PLAYER), true);
    assert.equal(await bingoClaimed(f.s, 9, PLAYER), false, 'a later level on the same parity is unclaimed');
    assert.equal(await affiliateDgnrsClaimed(f.s, 3, PLAYER), true);
    assert.equal(await affiliateDgnrsClaimed(f.s, 4, PLAYER), false);
  }));

  test('the FLIP redemption window is rngFlagsAndNudges bit 9 (bit 0 on run 63)', async () => {
    const at = bit => 1n << (240n + BigInt(bit));
    await current(() => {
      assert.equal(ticketRedemptionOpenFromSlot0(at(9)), true);
      assert.equal(ticketRedemptionOpenFromSlot0(at(0) | (0xffn << 240n)), false, 'nudge count bits 0..7 are not the window');
    });
    await run63(() => {
      assert.equal(ticketRedemptionOpenFromSlot0(at(0)), true);
      assert.equal(ticketRedemptionOpenFromSlot0(at(9)), false);
    });
  });
});

describe('FLIP arithmetic the contracts round in whole tokens', () => {
  test('nudge prices floor each +50% step: 100, 150, 225, 337, 505, 757, 1,135', () => current(() => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(n => reverseFlipCostWei(n) / WEI), [100n, 150n, 225n, 337n, 505n, 757n, 1135n]);
    assert.equal(reverseFlipCostWei(3) % WEI, 0n);
  }));

  test('the FLIP record bar is mark + ceil(mark / 5) in whole tokens', async () => {
    await current(() => {
      assert.equal(recordClaimTargetForMark(RECORD_KIND_FLIP, 7n * WEI), 9n * WEI);
      assert.equal(recordBarToBeat(0, 7n * WEI), 9n * WEI);
      assert.equal(recordBarToBeat(1, 7n), 9n, 'ETH marks keep their wei steps');
    });
    await run63(() => assert.equal(recordClaimTargetForMark(RECORD_KIND_FLIP, 7n * WEI), 7n * WEI + (7n * WEI + 4n) / 5n));
  });

  test('a FLIP Degenerette spin floors to a whole token; ETH stays exact', () => current(() => {
    const ethPayout = degeneretteSpinPayout({ currency: 0, amountPerSpin: 1_234_567n, score: 5 });
    assert.ok(ethPayout > 0n);
    const flip = degeneretteSpinPayout({ currency: 1, amountPerSpin: 333n * WEI, score: 5, activityScore: 7 });
    assert.equal(flip % WEI, 0n, 'whole FLIP per spin');
    const packedFlip = (1n << 170n) | (100n << 188n) | 1n;
    assert.equal(degeneretteTotalPayoutFromChain(1_200n, packedFlip), 1_200n * WEI);
    assert.equal(degeneretteTotalPayoutFromChain(1_200n, 1n), 1_200n, 'an ETH bet pays wei');
  }));
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
  let previous;
  beforeEach(() => {
    previous = useSchema(CURRENT_SCHEMA_HASH);
    storeMod.__resetForTest?.();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider({ getNetwork: async () => ({ chainId: 84532n }), getSigner: async () => ({ getAddress: async () => CONNECTED }) });
  });
  afterEach(() => {
    coinflipMod.__resetContractFactoryForTest();
    decimatorMod.__resetContractFactoryForTest();
    wwxrpMod.__resetContractFactoryForTest();
    degeneretteMod.__resetContractFactoryForTest();
    claimsMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    useSchema(previous);
  });

  test('coinflip deposit sends 250 for 250 FLIP and refuses a fraction', async () => {
    const c = fakeContract(['depositCoinflip', 'depositCoinflipWithCarry']);
    coinflipMod.__setContractFactoryForTest(() => c);
    await coinflipMod.depositCoinflip({ amount: 250n * WEI, player: CONNECTED });
    const sent = [...c._calls.depositCoinflipWithCarry, ...c._calls.depositCoinflip];
    assert.deepEqual(sent, [[CONNECTED, 250n]]);
    await assert.rejects(coinflipMod.depositCoinflip({ amount: 250n * WEI + WEI / 2n, player: CONNECTED }), /whole FLIP/);
  });

  test('auto-rebuy take-profit is sent in whole FLIP', async () => {
    const c = fakeContract(['setCoinflipAutoRebuy', 'setCoinflipAutoRebuyTakeProfit']);
    coinflipMod.__setContractFactoryForTest(() => c);
    await coinflipMod.setCoinflipAutoRebuyTakeProfit({ player: CONNECTED, takeProfit: 5_000n * WEI });
    assert.deepEqual(c._calls.setCoinflipAutoRebuyTakeProfit, [[CONNECTED, 5_000n]]);
  });

  test('a Decimator burn sends whole FLIP', async () => {
    const c = fakeContract(['decimatorBurn']);
    decimatorMod.__setContractFactoryForTest(() => c);
    // 2,500 clears the 2,000-FLIP minimum of audit 12daf8060 (1,000 on run 64).
    await decimatorMod.burnForDecimator({ amount: 2_500n * WEI, player: CONNECTED, chips: 0 });
    assert.deepEqual(c._calls.decimatorBurn, [[CONNECTED, 2_500n, 0]]);
    await assert.rejects(decimatorMod.burnForDecimator({ amount: 2_500n * WEI + 1n, player: CONNECTED, chips: 0 }), /whole FLIP/);
  });

  test('a WWXRP draw entry sends whole WWXRP', async () => {
    const c = fakeContract(['enter']);
    wwxrpMod.__setContractFactoryForTest(() => c);
    await wwxrpMod.burnWwxrp({ amount: 25n * WEI });
    assert.deepEqual(c._calls.enter, [[25n]]);
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
    coinflipMod.__setReverseFlipQuoteReaderForTest(async () => ({ queued: 3n, costWei: 337n * WEI, locked: false, viaView: true }));
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
    assert.deepEqual(c._calls.claimCoinflips, [[CONNECTED, 42n]]);
  });
});
