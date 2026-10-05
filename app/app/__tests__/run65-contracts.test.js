// Audit 12daf8060 (run 65) read/write surfaces: the Decimator's exact survivor sampling, jackpot-
// generated entries, 200 places and 2,000-FLIP minimum; sDGNRS redemption batches; the craps
// jackpot's variable fee and hidden subsidy roll. Every case picks its schema explicitly, so the
// file reads the same under run 64's deployment profile (frozen 54fe7634) and run 65's.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class {};
globalThis.customElements ??= {
  _items: new Map(),
  define(name, ctor) { this._items.set(name, ctor); },
  get(name) { return this._items.get(name); },
};

const {
  useSchema, loadSchema, hasWholeTokens, hasDecimatorSurvivorSampling, hasRedemptionBatches,
  hasVariableJackpotPrice, CURRENT_SCHEMA_HASH, BEFORE_DECIMATOR_JACKPOT_SCHEMA_HASH,
  BEFORE_WHOLE_TOKENS_SCHEMA_HASH,
} = await import('../../chain/schema.js');
const sampling = await import('../../chain/decimator-sampling.js');
const decimatorMod = await import('../decimator.js');
const drawData = await import('../decimator-draw-data.js');
const resolutions = await import('../jackpot-resolutions.js');
const sdgnrsMod = await import('../sdgnrs.js');
const crapsMod = await import('../craps.js');
const chainCraps = await import('../../chain/craps.js');
const history = await import('../history-activity.js');
const storeMod = await import('../store.js');
const contractsMod = await import('../contracts.js');
const { CONTRACTS } = await import('../chain-config.js');
const { readChainRoute } = await import('../../chain/router.js');
const { decimatorPayout } = await import('../../chain/games.js');
const { rpcFixture, PLAYER, OTHER_PLAYER } = await import('./helpers/chain-rpc.js');
const { decimatorResolutionView } = await import('../../components/app-jackpot-resolutions.js');
const { decimatorReceiptVerdict } = await import('../../components/app-decimator-draw-overlay.js');

const { ethers } = contractsMod;
const WEI = 10n ** 18n;
const SIM_CONTRACTS = new URL('../../../../degenerus-sim/contracts/', import.meta.url);
const flatSol = (path) => readFileSync(new URL(path, SIM_CONTRACTS), 'utf8').replace(/\s+/g, ' ');
const withSchema = async (hash, fn) => {
  const previous = useSchema(hash);
  try { return await fn(); } finally { useSchema(previous); }
};
const run65 = fn => withSchema(CURRENT_SCHEMA_HASH, fn);
const run64 = fn => withSchema(BEFORE_DECIMATOR_JACKPOT_SCHEMA_HASH, fn);

describe('schema profiles', () => {
  test('run 64 is frozen; the generated set is audit 12daf8060', async () => {
    await run65(async () => {
      assert.equal(hasWholeTokens(), true);
      assert.equal(hasDecimatorSurvivorSampling(), true);
      assert.equal(hasRedemptionBatches(), true);
      assert.equal(hasVariableJackpotPrice(), true);
      const current = await import('../../chain/generated/index.js');
      assert.equal(current.CONTRACT_REVISION, '12daf806061f61a3d39f3e2e0e1323b12bc6baa8');
    });
    await run64(async () => {
      assert.equal(hasWholeTokens(), true, 'run 64 already had whole-token FLIP');
      assert.equal(hasDecimatorSurvivorSampling(), false);
      assert.equal(hasRedemptionBatches(), false);
      assert.equal(hasVariableJackpotPrice(), false);
      const frozen = await import('../../chain/schemas/54fe7634/index.js');
      assert.equal(frozen.CONTRACT_REVISION, 'ca2bb497ff0ddf84a83f147e451c9576f7a3d26e');
    });
    await withSchema(BEFORE_WHOLE_TOKENS_SCHEMA_HASH, () => assert.equal(hasDecimatorSurvivorSampling(), false));
  });

  test('the round, redemption and jackpot layouts differ exactly as the storage delta says', async () => {
    const member = (types, label) => Object.fromEntries(types[label].members.map(m => [m.label, [Number(m.slot), m.offset, m.type]]));
    await run65(async () => {
      const game = await loadSchema('GAME');
      const round = member(game.types, 'inplace:struct DegenerusGameStorage.DecBattleRound');
      assert.deepEqual([round.poolWei, round.count, round.totalCreditedStack, round.openedDay, round.phase, round.paid],
        [[0, 0, 'inplace:uint96'], [0, 12, 'inplace:uint40'], [0, 17, 'inplace:uint64'], [0, 25, 'inplace:uint24'], [0, 28, 'inplace:uint8'], [0, 31, 'inplace:uint8']]);
      assert.deepEqual([game.fields.decJackpotPlans.slot, game.fields.decGeneratedOwners.slot], ['83', '84']);
      const sdgnrs = await loadSchema('SDGNRS');
      assert.match(sdgnrs.fields.pendingRedemptions.type, /mapping\(uint32 => struct sDGNRS\.PendingRedemption\)/);
      const craps = await loadSchema('CRAPS');
      const jackpot = member(craps.types, 'inplace:struct CrapsBattleStorage.JackpotRound');
      assert.deepEqual([jackpot.entryPrice, jackpot.subsidyMultiplierBps], [[5, 22, 'inplace:uint32'], [5, 26, 'inplace:uint32']]);
    });
    await run64(async () => {
      const round = member((await loadSchema('GAME')).types, 'inplace:struct DegenerusGameStorage.DecBattleRound');
      assert.deepEqual([round.poolWei, round.count, round.totalCreditedStack], [[0, 0, 'inplace:uint128'], [0, 16, 'inplace:uint64'], undefined]);
      assert.match((await loadSchema('SDGNRS')).fields.pendingRedemptions.type, /uint24 => struct/);
    });
  });
});

describe('Decimator survivor sampling (audit 12daf8060)', () => {
  test('replays the audit\'s independent keccak vectors and DecimatorSamplingLib', () => {
    const lib = flatSol('libraries/DecimatorSamplingLib.sol');
    assert.ok(lib.includes('bytes32 internal constant SAMPLE_TAG = keccak256("decimator.battle.sample.v1");'));
    assert.ok(lib.includes('uint256 count = (entries + 1) / 2; return uint16(count > 1000 ? 1000 : count);'));
    assert.ok(lib.includes('uint256 pos = lo + uint256(keccak256(abi.encode(SAMPLE_TAG, word, lvl, stratum))) % (hi - lo); return uint64((pos + rotate) % entries + 1);'));
    // test/fuzz/DecimatorSampling.t.sol test_BoundariesAndIndependentPythonKeccakVectors (word 777, level 5).
    const totals = [1n, 2n, 3n, 1999n, 2000n, 2001n, 2500n, 2199023255550n];
    const first = [1n, 2n, 1n, 745n, 994n, 137n, 494n, 477487092165n];
    const middle = [1n, 2n, 2n, 1744n, 1993n, 1136n, 1743n, 1574978174598n];
    const last = [1n, 2n, 2n, 744n, 992n, 133n, 490n, 475176567688n];
    totals.forEach((total, i) => {
      const count = sampling.decimatorSurvivorCount(total);
      assert.equal(sampling.decimatorSurvivorAt(777n, 5, total, 0n), first[i], `first of ${total}`);
      assert.equal(sampling.decimatorSurvivorAt(777n, 5, total, count / 2n), middle[i], `middle of ${total}`);
      assert.equal(sampling.decimatorSurvivorAt(777n, 5, total, count - 1n), last[i], `last of ${total}`);
      assert.equal(sampling.decimatorSurvives(777n, 5, total, first[i]), true);
    });
    assert.equal(sampling.decimatorSurvivorCount(4_000n), 1_000n, 'never more than 1,000 survivors');
    assert.throws(() => sampling.decimatorSurvivorAt(777n, 5, 2001n, 1_000n), /Stratum/);
  });

  test('membership is one hash and matches the full survivor set exactly', () => {
    for (const total of [1n, 2n, 7n, 41n, 400n, 2_345n]) {
      const count = sampling.decimatorSurvivorCount(total);
      const set = new Set(Array.from({ length: Number(count) }, (_, i) => sampling.decimatorSurvivorAt(31n, 25, total, BigInt(i))));
      assert.equal(set.size, Number(count), 'strata give distinct survivors');
      for (let id = 0n; id <= total + 1n; id += 1n) {
        assert.equal(sampling.decimatorSurvives(31n, 25, total, id), set.has(id), `entry ${id} of ${total}`);
      }
    }
  });

  test('round word 0 repacks: uint96 pool | uint40 count | uint64 credited total', async () => {
    const word = 7n * WEI | (12n << 96n) | (34_500n << 136n) | (60n << 200n) | (1n << 224n) | (20n << 232n) | (9n << 240n) | (3n << 248n);
    await run65(() => {
      const source = flatSol('modules/DegenerusGameDecimatorModule.sol');
      assert.ok(flatSol('DegenerusGameLens.sol').includes('r.poolWei = uint96(word); r.count = uint40(word >> 96); r.totalCreditedStack = uint64(word >> 136); r.openedDay = uint24(word >> 200); r.phase = uint8(word >> 224); r.capacity = uint8(word >> 232); r.winners = uint8(word >> 240); r.paid = uint8(word >> 248);'));
      assert.ok(source.includes('function _quota(uint256 entries) private pure returns (uint8) { uint256 places = (entries + 9) / 10; if (places < 20) places = 20; if (places > entries / 2) places = entries / 2; return uint8(places > 200 ? 200 : places); }'),
        'up to 200 places');
      assert.deepEqual(decimatorMod.decimatorRoundDecode(word), {
        poolWei: 7n * WEI, entrants: 12, totalStackWei: 34_500n * WEI, openedDay: 60, phase: 1, capacity: 20, winners: 9, paid: 3,
      });
    });
    await run64(() => {
      const legacy = (5n * WEI) | (12n << 128n) | (60n << 192n) | (2n << 216n);
      assert.deepEqual(decimatorMod.decimatorRoundDecode(legacy), {
        poolWei: 5n * WEI, entrants: 12, openedDay: 60, phase: 2, capacity: 0, winners: 0, paid: 0,
      });
    });
  });

  test('the burn minimum is 2,000 FLIP (1,000 on run 64)', async () => {
    assert.ok(flatSol('FLIP.sol').includes('uint256 private constant DECIMATOR_MIN = 2000;'));
    await run65(async () => {
      assert.equal(decimatorMod.decimatorMinFlipWei(), 2_000n * WEI);
      assert.equal(decimatorMod.decimatorMinFlipText(), '2,000');
      await assert.rejects(decimatorMod.burnForDecimator({ amount: 1_500n * WEI, player: PLAYER, chips: 0 }), /Minimum Decimator entry is 2,000 FLIP/);
    });
    await run64(() => assert.equal(decimatorMod.decimatorMinFlipWei(), 1_000n * WEI));
  });
});

describe('Decimator chain rows (audit 12daf8060)', () => {
  const LEVEL = 25;
  const ID = 3n;
  const N = 12;
  const survivorWord = (total, id, wanted) => Array.from({ length: 512 }, (_, i) => BigInt(i + 1))
    .find(word => sampling.decimatorSurvives(word, LEVEL, total, id) === wanted);

  async function sealed({ phase, word, mode = 0, generated = 0, winners = 0, paid = 0, pool = 0n, champion = 0n, burn = true } = {}) {
    const f = await rpcFixture();
    if (burn) {
      await f.field('GAME', 'decBattlePlayers', (BigInt(LEVEL) << 64n) | ID, PLAYER);
      await f.field('GAME', 'decBattleEntries', BigInt(PLAYER) | (2_400n << 190n), (BigInt(LEVEL) << 64n) | ID);
      await f.event('GAME', 'DecBurnRecorded', { player: PLAYER, lvl: LEVEL, entryId: ID, baseAmount: 2_000n, credited: 2_400n, stack: 2_400n, chips: 0 }, { block: 9000 });
    }
    for (const [label, value] of [['count', N], ['phase', phase], ['winners', winners], ['paid', paid], ['poolWei', pool], ['champion', champion]]) {
      await f.field('GAME', 'decBattleRounds', value, LEVEL, label);
    }
    await f.field('GAME', 'decJackpotPlans', mode, LEVEL, 'mode');
    await f.field('GAME', 'decJackpotPlans', generated, LEVEL, 'generatedEntries');
    if (phase) await f.event('GAME', 'DecimatorResolved', { lvl: LEVEL, rngWord: word, poolWei: pool, entrants: N }, { block: 9100 });
    return f;
  }
  const read = (f, who = PLAYER) => readChainRoute(`/player/${who}/decimator?level=${LEVEL}`, { client: f.client });

  test('no coin: survival waits for the field size, then replays from the sealed word', () => run65(async () => {
    const pending = await read(await sealed({ phase: 1, word: 1n, mode: 1 }));
    assert.equal(pending.coin, null);
    assert.equal(pending.survived, null, 'an x5 round waits for its jackpot day to fix T');
    assert.equal(pending.fieldEntries, null);
    const total = BigInt(N + 4);
    const out = await read(await sealed({ phase: 1, word: survivorWord(total, ID, false), mode: 2, generated: 4 }));
    assert.equal(out.survived, false);
    assert.equal(out.fieldEntries, 16);
    const inWord = survivorWord(total, ID, true);
    const f = await sealed({ phase: 1, word: inWord, mode: 2, generated: 4 });
    await f.event('GAME', 'DecimatorRun', { lvl: LEVEL, entryId: ID, normalizedPeak: 9_000n * WEI });
    const survived = await read(f);
    assert.equal(survived.survived, true);
    assert.equal(survived.peak, String(9_000n * WEI));
    assert.equal(survived.roundStatus, 'settling');
    const original = await read(await sealed({ phase: 1, word: survivorWord(BigInt(N), ID, true), mode: 0 }));
    assert.equal(original.survived, true, 'an original-only round (x00, x95, zero pot) has T = N');
  }));

  test('a jackpot-generated place pays a wallet that never burned', () => run65(async () => {
    const f = await sealed({ phase: 3, word: 5n, mode: 2, generated: 4, winners: 3, paid: 3, pool: 10n ** 18n, champion: 14n, burn: false });
    await f.event('GAME', 'DecimatorClaimed', { player: OTHER_PLAYER, lvl: LEVEL, entryId: 14n, amountWei: 7n, halfPasses: 1n }, { block: 9300 });
    const row = await read(f, OTHER_PLAYER);
    assert.equal(row.entryId, null);
    assert.equal(row.winner, true);
    assert.equal(row.claimed, true);
    assert.equal(row.champion, true, 'a generated id can be the champion');
    assert.deepEqual([row.ethAmount, row.halfPasses], ['7', '1']);
    const rounds = await readChainRoute(`/game/decimator/player/${OTHER_PLAYER}`, { client: f.client });
    assert.deepEqual(rounds.rounds.map(r => [r.level, r.isWinner]), [[LEVEL, true]], 'DecimatorClaimed lists the level');
    resolutions.__setResolutionFactoriesForTest({ entry: () => ({ ...row, phase: 3 }) });
    try {
      assert.deepEqual(await resolutions.readDecimatorClaimState({ player: OTHER_PLAYER, level: LEVEL }), { state: 'claimed', errorName: null });
    } finally { resolutions.__resetResolutionFactoriesForTest(); }
  }));

  test('an unpaid generated place is found through decGeneratedOwners and priced', () => run65(async () => {
    const pool = 100n * WEI;
    const f = await sealed({ phase: 2, word: 5n, mode: 2, generated: 4, winners: 3, paid: 1, pool, burn: false });
    await f.field('GAME', 'decBattleHeap', (5n << 64n) | 4n, 1);
    await f.field('GAME', 'decBattleHeap', (9n << 64n) | 14n, 2);
    await f.field('GAME', 'decGeneratedOwners', BigInt(OTHER_PLAYER), 2n);
    const row = await read(f, OTHER_PLAYER);
    const pay = decimatorPayout(pool, 3, 2);
    assert.equal(row.winner, true);
    assert.equal(row.claimed, false);
    assert.deepEqual([row.ethAmount, row.halfPasses], [String(pay.ethWei), String(pay.halfPasses)]);
    const stranger = await read(f, PLAYER);
    assert.equal(stranger.winner, false);
  }));

  test('resolution copy follows survivors, never a coin', () => {
    const locked = decimatorResolutionView({ currentLevel: 24, level: 25,
      outcome: { roundStatus: 'open', entryId: '7', stack: String(2_400n * WEI), survived: null } });
    assert.match(locked.message, /enters the survivor draw when Level 25 starts/);
    const out = decimatorResolutionView({ currentLevel: 25, level: 25, outcome: { roundStatus: 'settling', entryId: '7', coin: null, survived: false } });
    assert.deepEqual([out.status, out.tone], ['NOT DRAWN', 'lost']);
    assert.doesNotMatch(out.message, /coin|tails|heads/i);
    const alive = decimatorResolutionView({ currentLevel: 25, level: 25, outcome: { roundStatus: 'settling', entryId: '7', coin: null, survived: true } });
    assert.deepEqual([alive.status, alive.tone], ['SURVIVED', 'waiting']);
    const waiting = decimatorResolutionView({ currentLevel: 25, level: 25, outcome: { roundStatus: 'settling', entryId: '7', coin: null, survived: null } });
    assert.match(waiting.message, /jackpot day fixes the field size/);
    const missed = decimatorResolutionView({ currentLevel: 26, level: 25, outcome: { roundStatus: 'closed', entryId: '7', coin: null, survived: true, winner: false, winners: 200 } });
    assert.equal(missed.status, 'NOT PLACED');
    assert.equal(missed.message, 'Your stack × peak finished outside the top 200.');
  });
});

describe('Decimator receipt (audit 12daf8060)', () => {
  const game = new ethers.Interface([
    'event DecBurnRecorded(address indexed player,uint24 indexed lvl,uint64 indexed entryId,uint256 baseAmount,uint256 credited,uint256 stack,uint32 chips)',
    'event DecimatorResolved(uint24 indexed lvl,uint256 rngWord,uint256 poolWei,uint64 entrants)',
    'event DecimatorRun(uint24 indexed lvl,uint64 indexed entryId,uint256 normalizedPeak)',
    'event DecimatorRanked(uint24 indexed lvl,uint64 champion,uint8 winners)',
    'event DecimatorClaimed(address indexed player,uint24 indexed lvl,uint64 indexed entryId,uint256 amountWei,uint256 halfPasses)',
    'event DecimatorJackpotPlan(uint24 indexed lvl,uint256 word,uint96 originalPool,uint64 originalStack,uint40 originalCount,uint128 availableBudget,uint96 funding,uint128 soloAmount,uint32 traits,uint40 generatedEntries,uint64 weights)',
    'event DecimatorGenerated(uint24 indexed lvl,uint64 indexed id,address indexed recipient,uint8 quadrant,uint32 chips,uint256 normalizedPeak,uint256 score)',
  ]);
  const A = '0x00000000000000000000000000000000000000a1';
  const B = '0x00000000000000000000000000000000000000b2';
  const C = '0x00000000000000000000000000000000000000c3';
  const D = '0x00000000000000000000000000000000000000d4';
  const level = 15;
  const total = 5n; // three burns plus two generated entries
  const set = word => new Set(Array.from({ length: 3 }, (_, i) => sampling.decimatorSurvivorAt(word, level, total, BigInt(i))));
  const WORD = Array.from({ length: 512 }, (_, i) => BigInt(i + 1)).find(word => {
    const s = set(word); return s.has(1n) && !s.has(3n) && s.has(4n);
  });
  const log = (event, args, blockNumber, index = 0) => ({ ...game.encodeEventLog(game.getEvent(event), args), blockNumber, index });
  const logs = () => [
    log('DecBurnRecorded', [A, level, 1, 2_000n, 2_000n, 3_000n, 0], 10),
    log('DecBurnRecorded', [B, level, 2, 2_000n, 2_000n, 2_000n, 0], 11),
    log('DecBurnRecorded', [C, level, 3, 2_000n, 2_000n, 4_000n, 0], 12),
    log('DecimatorResolved', [level, WORD, 1_000n, 3], 14),
    log('DecimatorJackpotPlan', [level, WORD, 1_000n, 9_000n, 3, 900n, 500n, 400n, 0, 2, 1n], 15),
    // Generated id 4 plays the mean stack, 3,000: score = 9,000 x peak / 3.
    log('DecimatorGenerated', [level, 4, D, 1, 0, 30_000n * WEI, 9_000n * 30_000n * WEI / 3n], 15, 1),
    log('DecimatorRun', [level, 1, 6_000n * WEI], 16),
    log('DecimatorRanked', [level, 4, 2], 17),
    log('DecimatorClaimed', [D, level, 4, 700n, 1n], 18),
    log('DecimatorClaimed', [A, level, 1, 300n, 0n], 18, 1),
  ];

  test('generated places carry their recipient, peak and score; survivors replace the coin', () => run65(() => {
    const snapshot = drawData.buildDecimatorDrawSnapshot({ level, player: A, gameLogs: logs(), flipLogs: [], ethDisplayScale: 1n });
    assert.equal(snapshot.fieldEntries, 5);
    assert.equal(snapshot.generatedEntries, 2);
    assert.deepEqual(snapshot.winners.map(row => [row.rank, row.address, row.generated, row.peakMultiple, row.score, row.champion]), [
      [1, D, true, '10.00', String(30_000n * WEI), true],
      [2, A, false, '2.00', String(6_000n * WEI), false],
    ]);
    assert.equal(snapshot.winners[0].stack, String(3_000n * WEI), 'the mean original stack');
    assert.equal(snapshot.you.coin, null);
    assert.equal(snapshot.you.survived, true);
    assert.equal(decimatorReceiptVerdict(snapshot).title, '#2 OF 2');
    assert.match(decimatorReceiptVerdict(snapshot).detail, /^Your run peaked at 2\.00× its bankroll\. Paid/);

    const lost = drawData.buildDecimatorDrawSnapshot({ level, player: C, gameLogs: logs(), flipLogs: [] });
    assert.equal(lost.you.survived, false);
    assert.deepEqual([decimatorReceiptVerdict(lost).title, decimatorReceiptVerdict(lost).tone], ['NOT DRAWN', 'lost']);

    const recipient = drawData.buildDecimatorDrawSnapshot({ level, player: D, gameLogs: logs(), flipLogs: [] });
    assert.equal(recipient.you.entryId, null, 'D never burned');
    assert.deepEqual(recipient.you.generatedWins, [{ entryId: '4', rank: 1, ethWei: '700', halfPasses: '1' }]);
    const verdict = decimatorReceiptVerdict(recipient);
    assert.deepEqual([verdict.tone, verdict.title], ['won', 'CHAMPION']);
    assert.match(verdict.detail, /jackpot-day entry drawn for your tickets placed/);
  }));

  test('the loader asks for the plan, field bound and generated runs after the seal', () => run65(async () => {
    const calls = [];
    const all = logs();
    drawData.__setDecimatorDrawProviderForTest({
      async getBlockNumber() { return 20; },
      async getLogs(filter) {
        calls.push(filter);
        return all.filter(l => Number(l.blockNumber) >= filter.fromBlock && Number(l.blockNumber) <= filter.toBlock
          && filter.topics.every((topic, i) => topic == null || (Array.isArray(topic) ? topic : [topic]).includes(l.topics[i])));
      },
    });
    try {
      const snapshot = await drawData.loadDecimatorDrawSnapshot({ level, player: D, fromBlock: 10 });
      assert.equal(snapshot.winners.length, 2);
      const settle = calls.find(call => Array.isArray(call.topics[0]));
      for (const name of ['DecimatorFieldBound', 'DecimatorJackpotPlan', 'DecimatorGenerated']) {
        assert.ok(settle.topics[0].includes(ethers.id(`${name}(${name === 'DecimatorFieldBound' ? 'uint24,uint40,uint8' : name === 'DecimatorJackpotPlan'
          ? 'uint24,uint256,uint96,uint64,uint40,uint128,uint96,uint128,uint32,uint40,uint64' : 'uint24,uint64,address,uint8,uint32,uint256,uint256'})`)), name);
      }
    } finally { drawData.__resetDecimatorDrawProviderForTest(); }
  }));
});

describe('sDGNRS redemption batches (audit 01f11477c)', () => {
  const CONNECTED = '0xab12000000000000000000000000000000000000';
  function batchContract({ tokens = 0n, batch = [0n, 0n, 0n, 0n, 0, 0], open = 9, parked = false, receipt = { status: 1, logs: [] } } = {}) {
    const calls = [];
    const send = name => Object.assign(async (...args) => { calls.push([name, ...args]); return { hash: '0xc1a1', wait: async () => receipt }; },
      { staticCall: async (...args) => { calls.push([`${name}-static`, ...args]); if (name === 'claimParkedRedemption' && !parked) throw new Error('NoClaim'); } });
    return {
      pendingRedemptions: async (...args) => { calls.push(['pending', ...args]); return [tokens, tokens ? 7 : 0]; },
      redemptionBatches: async (...args) => { calls.push(['batch', ...args]); return batch; },
      redemptionBatchState: async () => [open, 0, 0, 0n],
      claimRedemption: send('claimRedemption'),
      claimParkedRedemption: send('claimParkedRedemption'),
      connect() { return this; },
      _calls: calls,
    };
  }
  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    contractsMod.setProvider({ getNetwork: async () => ({ chainId: 84532n }), getSigner: async () => ({ getAddress: async () => CONNECTED }) });
  });
  afterEach(() => {
    sdgnrsMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('a claim is priced off its batch; open, settling, parked and game-over routes', () => run65(async () => {
    let gameOver = false;
    sdgnrsMod.__setGameFactoryForTest(() => ({ gameOver: async () => gameOver }));
    // Open batch 9: unpriced and waiting for the next RNG request.
    sdgnrsMod.__setContractFactoryForTest(() => batchContract({ tokens: 4n * WEI, open: 9 }));
    let state = await sdgnrsMod.readSdgnrsRedemptionState({ player: CONNECTED, periodIndex: 9, fresh: true });
    assert.deepEqual([state.batchId, state.open, state.ready, state.settling, state.ethValueOwed], [9, true, false, false, null]);
    await assert.rejects(sdgnrsMod.claimSdgnrsRedemption({ player: CONNECTED, periodIndex: 9 }), /next RNG request to price it/);
    // Closed and resolved batch 8 (10 tokens, 2 ETH base, 50 whole FLIP escrow, roll 98): the miner settles it.
    const resolved = [10n * WEI, 100n * WEI, 2n * WEI, 50n, 98, 0];
    sdgnrsMod.__setContractFactoryForTest(() => batchContract({ tokens: 4n * WEI, batch: resolved, open: 9 }));
    state = await sdgnrsMod.readSdgnrsRedemptionState({ player: CONNECTED, periodIndex: 8, fresh: true });
    assert.deepEqual([state.open, state.settling, state.ready, state.roll], [false, true, false, 98]);
    assert.equal(state.ethValueOwed, 8n * WEI / 10n, 'pro-rata share of the close price');
    assert.equal(state.flipEscrow, 20n * WEI, 'whole-FLIP escrow share, in token wei');
    assert.equal(state.activityScore, 6, 'stored as score + 1');
    // Parked: the owner settles it with claimParkedRedemption(player, uint32 batchId).
    const parked = batchContract({ tokens: 4n * WEI, batch: resolved, parked: true });
    sdgnrsMod.__setContractFactoryForTest(() => parked);
    await sdgnrsMod.claimSdgnrsRedemption({ player: CONNECTED, periodIndex: 8 });
    assert.deepEqual(parked._calls.filter(c => c[0] === 'claimParkedRedemption'), [['claimParkedRedemption', CONNECTED, 8]]);
    // After game over even the open batch is claimable (it unwinds at the game-over price).
    gameOver = true;
    const over = batchContract({ tokens: 4n * WEI, open: 9 });
    sdgnrsMod.__setContractFactoryForTest(() => over);
    await sdgnrsMod.claimSdgnrsRedemption({ player: CONNECTED, periodIndex: 9 });
    assert.deepEqual(over._calls.filter(c => c[0] === 'claimRedemption'), [['claimRedemption', CONNECTED, 9]]);
    assert.equal(sdgnrsMod.isSdgnrsRedemptionKey(0xFFFFFFFF), true, 'uint32 batch ids');
    await run64(() => assert.equal(sdgnrsMod.isSdgnrsRedemptionKey(0x1000000), false, 'uint24 days before'));
  }));

  test('the new event shapes decode: batch ids, no per-burn ETH or FLIP escrow', () => run65(async () => {
    const source = flatSol('sDGNRS.sol');
    for (const signature of [
      'event RedemptionSubmitted(address indexed player, uint256 sdgnrsAmount, uint32 indexed batchId);',
      'event RedemptionClaimed( address indexed player, uint32 indexed batchId, uint16 roll, uint256 ethPayout, uint256 lootboxEth, uint256 flipPaid );',
      'function claimParkedRedemption(address player, uint32 batchId) external {',
      'function claimRedemption(address player, uint32 batchId) external {',
    ]) assert.ok(source.includes(signature), signature);
    const iface = new ethers.Interface([
      'event RedemptionSubmitted(address indexed player, uint256 sdgnrsAmount, uint32 indexed batchId)',
      'event RedemptionClaimed(address indexed player, uint32 indexed batchId, uint16 roll, uint256 ethPayout, uint256 lootboxEth, uint256 flipPaid)',
    ]);
    const submitted = iface.encodeEventLog(iface.getEvent('RedemptionSubmitted'), [CONNECTED, 3n * WEI, 12]);
    const claimed = iface.encodeEventLog(iface.getEvent('RedemptionClaimed'), [CONNECTED, 12, 98, 5n, 6n, 40n]);
    const { submissions, claims } = sdgnrsMod.parseSdgnrsRedemptionReceipt({ hash: '0xab', logs: [
      { address: CONTRACTS.SDGNRS, ...submitted }, { address: CONTRACTS.SDGNRS, ...claimed },
    ] }, CONNECTED);
    assert.deepEqual([submissions[0].periodIndex, submissions[0].batchId, submissions[0].sdgnrsAmount, submissions[0].ethValueOwed], [12, 12, 3n * WEI, null]);
    assert.deepEqual([claims[0].batchId, claims[0].roll, claims[0].flipPaid], [12, 98, 40n * WEI]);
    sdgnrsMod.__setSdgnrsFetcherForTest(async () => ({ events: [
      { name: 'RedemptionSubmitted', args: { player: CONNECTED, sdgnrsAmount: String(3n * WEI), batchId: 12 }, blockNumber: 5, logIndex: 0 },
    ] }));
    sdgnrsMod.__setGameFactoryForTest(() => ({ gameOver: async () => false }));
    sdgnrsMod.__setContractFactoryForTest(() => batchContract({ tokens: 3n * WEI, open: 12 }));
    const found = await sdgnrsMod.discoverSdgnrsRedemptions({ player: CONNECTED });
    assert.deepEqual(found.periods.map(p => [p.batchId, p.sdgnrsAmount, p.open]), [[12, 3n * WEI, true]]);
    const [row] = history.historyEventActivities([{ name: 'RedemptionSubmitted', args: { player: CONNECTED, sdgnrsAmount: String(WEI), batchId: 12 } }], CONNECTED);
    assert.equal(row.detail, 'Redemption batch 12');
  }));
});

describe('craps jackpot fee and subsidy (audit bcdba75a9)', () => {
  test('the fee mirrors CrapsPriceLib.jackpotPrice off the jackpot period\'s schedule roll', () => run65(() => {
    assert.ok(flatSol('libraries/CrapsPriceLib.sol').includes('function jackpotPrice(uint256 roll) internal pure returns (uint256) { uint256 bucket = roll & 3; return bucket == 0 ? 6_000 : bucket == 3 ? 10_000 : JACKPOT_FEE; }'));
    assert.ok(flatSol('CrapsBattle.sol').includes('if (period == _BONUS_PERIODS_PER_DAY - 1) return (0, 0, 0, CrapsPriceLib.jackpotPrice(roll) / _BATTLE_STAKE_UNIT, 0);'));
    assert.deepEqual([0n, 1n, 2n, 3n, 4n, 7n].map(crapsMod.crapsJackpotEntryPriceFlip), [6_000n, 8_000n, 8_000n, 10_000n, 6_000n, 10_000n]);
    const word = '102858562227254754036121703853225298402533986033002165985066946425924666406226';
    const jackpot = crapsMod.crapsBonusDayTerms(word).windows[5];
    assert.equal(jackpot.event, true);
    assert.equal(jackpot.battleStakeFlip, 10_000n, 'this word draws the 10,000 fee');
    assert.equal(jackpot.buyInFlip, 10_000n);
    const fees = new Set(Array.from({ length: 64 }, (_, i) => crapsMod.crapsBonusDayTerms(BigInt(i + 1)).windows[5].battleStakeFlip));
    assert.deepEqual([...fees].sort((a, b) => Number(a - b)), [6_000n, 8_000n, 10_000n]);
    assert.deepEqual(crapsMod.crapsFutureDayFaceRanges().normal, { low: 10_000n, high: 50_000n,
      wager: { low: 3_000n, high: 22_500n }, battle: { low: 7_000n, high: 27_500n } });
    assert.equal(crapsMod.crapsFutureDayFaceRanges().high.high, 5_000_000n);
  }));

  test('run 64 keeps the fixed 8,000 fee', () => run64(() => {
    assert.equal(crapsMod.crapsJackpotEntryPriceFlip(0n), 8_000n);
    assert.equal(crapsMod.crapsBonusDayTerms('102858562227254754036121703853225298402533986033002165985066946425924666406226').windows[5].battleStakeFlip, 8_000n);
  }));

  test('the Main Event funding applies the hidden subsidy roll before the pool roll', () => run65(() => {
    const battle = flatSol('JackpotBattle.sol');
    assert.ok(battle.includes('uint256 subsidyBps = _subsidyMultiplier(_hash3(word, _activeJackpotSlot, JACKPOT_SUBSIDY_TAG)); uint256 mainAdded = r.added - r.added / _HIGH_RESERVE_DIVISOR; mainAdded = mainAdded * subsidyBps / 10_000;'));
    assert.ok(battle.includes('return roll < 60 ? 2_500 : roll < 90 ? 10_000 : roll < 99 ? 50_000 : 100_000;'));
    assert.ok(flatSol('storage/CrapsBattleStorage.sol').includes('uint256 internal constant JACKPOT_SUBSIDY_TAG = uint256(keccak256("CrapsJackpotSubsidy"));'));
    const slot = 41n * 8n + 6n;
    const coder = ethers.AbiCoder.defaultAbiCoder();
    for (const word of [1n, 2n, 46n, 34n, 777n]) {
      const roll = BigInt(ethers.keccak256(coder.encode(['uint256', 'uint256', 'uint256'], [word, slot, BigInt(ethers.id('CrapsJackpotSubsidy'))]))) % 100n;
      const bps = roll < 60n ? 2_500n : roll < 90n ? 10_000n : roll < 99n ? 50_000n : 100_000n;
      assert.equal(crapsMod.crapsJackpotSubsidyBps(word, slot), bps);
      const pool = BigInt(ethers.keccak256(coder.encode(['uint256', 'uint256'], [word, 0x436f696e447261774d756c7469706c696572n]))) % 1000n;
      const multiplier = pool < 900n ? 5_000n : pool < 990n ? 30_000n : pool < 999n ? 200_000n : 1_000_000n;
      assert.equal(crapsMod.crapsMainEventAddedWei(20_000n * WEI, word, slot), ((19_000n * bps / 10_000n) * multiplier / 10_000n) * WEI);
    }
    assert.equal(crapsMod.crapsMainEventAddedWei(20_000n * WEI, 2n), null, 'no slot, no subsidy key');
    // The same lobby fixture as craps.test.js: word 2's 3x pool roll now also rides a 0.25x subsidy.
    const iface = new ethers.Interface(crapsMod.CRAPS_LOBBY_EVENT_ABI);
    const key = ethers.toBeHex(slot, 32);
    const event = (name, values) => iface.encodeEventLog(iface.getEvent(name), values);
    const logs = [
      event('CrapsBonusOpened', [key, slot, 0n, 0n, 0n, 0n, 6_000n]),
      event('JackpotBattleLocked', [slot, 42, 20_000n, 24]),
      event('JackpotBattleStarted', [slot, 3, 80, 80, 2]),
      event('CrapsBattleFinalized', [key, 1, 1, 0, 0, 0, 70_000n]),
      event('CrapsBattlePaid', [77, key, '0x1234567890123456789012345678901234567890', 70_000n]),
    ];
    const result = crapsMod.crapsLobbySnapshotFromLogs(41, logs).results[5];
    assert.equal(result.mainEventAddedWei, crapsMod.crapsMainEventAddedWei(20_000n * WEI, 2n, slot));
    assert.equal(result.mainEventAddedWei, 14_250n * WEI);
  }));

  test('a jackpot high seat rides extra capital at its round\'s own fee', async () => {
    const { jackpotHighExtra } = await import('../../chain/craps-engine.js');
    const extra = (high, round) => jackpotHighExtra(BigInt(high), BigInt(round.multiplierBps), chainCraps.crapsJackpotEntryPrice(round));
    await run65(() => {
      assert.equal(extra(1, { entryPrice: 10_000n, multiplierBps: 30_000n }), 0n);
      assert.equal(extra(10, { entryPrice: 10_000n, multiplierBps: 30_000n }), 135_000n);
      assert.equal(extra(10, { entryPrice: 6_000n, multiplierBps: 5_000n }), 13_500n);
    });
    assert.throws(() => jackpotHighExtra(10n, 5_000n), /entryPrice/, 'the engine refuses the old constant-fee form');
    await run64(() => assert.equal(chainCraps.crapsJackpotEntryPrice({ multiplierBps: 5_000n }), 8_000n, 'run 64 rounds store no fee: 8,000'));
    await withSchema(BEFORE_WHOLE_TOKENS_SCHEMA_HASH, () => assert.equal(
      chainCraps.crapsJackpotEntryPrice({}), 8_000n * WEI, 'an 18-decimal deployment\'s fee was 8,000 ether'));
    assert.ok(flatSol('CrapsBattle.sol').includes('w.highExtra = (w.highMult - 1) * r.entryPrice * r.multiplierBps / 20_000;'));
  });
});
