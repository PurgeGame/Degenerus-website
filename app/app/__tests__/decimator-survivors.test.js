// Decimator read surfaces that no other file pins: the survivor sampling vectors (mirrored from the
// contract's DecimatorSamplingLib and its independent Python keccak vectors), the round word repack,
// the burn minimum, the survivor-based resolution copy, and the receipt for a round whose jackpot
// day generated extra entries. The Decimator's events name wallets by uint32 ID, so fixtures are
// encoded with the current generated ABI.
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class {};
globalThis.customElements ??= {
  _items: new Map(),
  define(name, ctor) { this._items.set(name, ctor); },
  get(name) { return this._items.get(name); },
};

const sampling = await import('../../chain/decimator-sampling.js');
const decimatorMod = await import('../decimator.js');
const drawData = await import('../decimator-draw-data.js');
const { abi: gameAbi } = await import('../../chain/generated/game.js');
const { decimatorResolutionView } = await import('../../components/app-jackpot-resolutions.js');
const { decimatorReceiptVerdict } = await import('../../components/app-decimator-draw-overlay.js');
const { ethers } = await import('../contracts.js');
const { _setWalletIdForTests, _resetWalletIdsForTests } = await import('../wallet-id.js');

const WEI = 10n ** 18n;
const SIM_CONTRACTS = new URL('../../../../degenerus-sim/contracts/', import.meta.url);
const flatSol = (path) => readFileSync(new URL(path, SIM_CONTRACTS), 'utf8').replace(/\s+/g, ' ');

describe('Decimator survivor sampling', () => {
  test('replays the audit\'s independent keccak vectors and DecimatorSamplingLib', () => {
    const lib = flatSol('libraries/DecimatorSamplingLib.sol');
    assert.ok(lib.includes('bytes32 internal constant SAMPLE_TAG = keccak256("decimator.battle.sample.v1");'));
    assert.ok(lib.includes('uint256 count = (entries + 1) / 2; return uint16(count > 1000 ? 1000 : count);'));
    assert.ok(lib.includes('uint256 pos = lo + uint256(EntropyLib.hash3(RngTags.DECIMATOR_SAMPLE, word, stratum)) % (hi - lo); return uint64((pos + rotate) % entries + 1);'));
    // test/fuzz/DecimatorSampling.t.sol test_BoundariesAndIndependentPythonKeccakVectors (word 777, level 5).
    const totals = [1n, 2n, 3n, 1999n, 2000n, 2001n, 2500n, 2199023255550n];
    const first = [1n, 2n, 3n, 1363n, 1690n, 741n, 690n, 1696706740795n];
    const middle = [1n, 2n, 2n, 364n, 691n, 1742n, 1941n, 595945608994n];
    const last = [1n, 2n, 2n, 1361n, 1688n, 738n, 687n, 1693949254452n];
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

  test('round word 0 repacks: uint96 pool | uint40 count | uint64 credited total', () => {
    const word = 7n * WEI | (12n << 96n) | (34_500n << 136n) | (60n << 200n) | (1n << 224n) | (20n << 232n) | (9n << 240n) | (3n << 248n);
    const source = flatSol('modules/DegenerusGameDecimatorModule.sol');
    assert.ok(flatSol('DegenerusGameLens.sol').includes('r.poolWei = uint96(word); r.count = uint40(word >> 96); r.totalCreditedStack = uint64(word >> 136); r.openedDay = uint24(word >> 200); r.phase = uint8(word >> 224); r.capacity = uint8(word >> 232); r.winners = uint8(word >> 240); r.paid = uint8(word >> 248);'));
    assert.ok(source.includes('function _quota(uint256 entries) private pure returns (uint8) { uint256 places = (entries + 9) / 10; if (places < 20) places = 20; if (places > entries / 2) places = entries / 2; return uint8(places > 200 ? 200 : places); }'),
      'up to 200 places');
    assert.deepEqual(decimatorMod.decimatorRoundDecode(word), {
      poolWei: 7n * WEI, entrants: 12, totalStackWei: 34_500n * WEI, openedDay: 60, phase: 1, capacity: 20, winners: 9, paid: 3,
    });
  });

  test('the burn minimum is 2,000 FLIP', async () => {
    assert.ok(flatSol('FLIP.sol').includes('uint256 private constant DECIMATOR_MIN = 2000;'));
    assert.equal(decimatorMod.decimatorMinFlipWei(), 2_000n * WEI);
    assert.equal(decimatorMod.decimatorMinFlipText(), '2,000');
    const player = '0x00000000000000000000000000000000000000a1';
    _setWalletIdForTests(player, 41);
    try {
      await assert.rejects(decimatorMod.burnForDecimator({ amount: 1_500n * WEI, player, chips: 0 }), /Minimum Decimator entry is 2,000 FLIP/);
    } finally { _resetWalletIdsForTests(); }
  });

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

describe('Decimator receipt for a round with jackpot-generated entries', () => {
  const game = new ethers.Interface(gameAbi);
  const ID = { A: 11, B: 12, C: 13, D: 14 };
  const A = '0x00000000000000000000000000000000000000a1';
  const B = '0x00000000000000000000000000000000000000b2';
  const C = '0x00000000000000000000000000000000000000c3';
  const D = '0x00000000000000000000000000000000000000d4';
  const wallets = new Map([[ID.A, A], [ID.B, B], [ID.C, C], [ID.D, D]]);
  const level = 15;
  const total = 5n; // three burns plus two generated entries
  const set = word => new Set(Array.from({ length: 3 }, (_, i) => sampling.decimatorSurvivorAt(word, level, total, BigInt(i))));
  const WORD = Array.from({ length: 512 }, (_, i) => BigInt(i + 1)).find(word => {
    const s = set(word); return s.has(1n) && !s.has(3n) && s.has(4n);
  });
  const log = (event, args, blockNumber, index = 0) => ({ ...game.encodeEventLog(game.getEvent(event), args), blockNumber, index });
  const logs = () => [
    log('DecBurnRecorded', [ID.A, level, 1, 2_000n, 2_000n, 3_000n, 0], 10),
    log('DecBurnRecorded', [ID.B, level, 2, 2_000n, 2_000n, 2_000n, 0], 11),
    log('DecBurnRecorded', [ID.C, level, 3, 2_000n, 2_000n, 4_000n, 0], 12),
    log('DecimatorResolved', [level, WORD, 1_000n, 3], 14),
    log('DecimatorJackpotPlan', [level, WORD, 1_000n, 9_000n, 3, 900n, 500n, 400n, 0, 2, 1n], 15),
    // Generated id 4 plays the mean stack, 3,000: score = 9,000 x peak / 3.
    log('DecimatorGenerated', [level, 4, ID.D, 1, 0, 30_000n * WEI, 9_000n * 30_000n * WEI / 3n], 15, 1),
    log('DecimatorRun', [level, 1, 6_000n * WEI], 16),
    log('DecimatorRanked', [level, 4, 2], 17),
    log('DecimatorClaimed', [ID.D, level, 4, 700n, 1n], 18),
    log('DecimatorClaimed', [ID.A, level, 1, 300n, 0n], 18, 1),
  ];

  test('generated places carry their recipient, peak and score; survivors replace the coin', () => {
    const snapshot = drawData.buildDecimatorDrawSnapshot({ level, player: A, wallets, gameLogs: logs(), flipLogs: [], ethDisplayScale: 1n });
    assert.equal(snapshot.fieldEntries, 5);
    assert.equal(snapshot.generatedEntries, 2);
    assert.deepEqual(snapshot.winners.map(row => [row.rank, row.address, row.generated, row.peakMultiple, row.score, row.champion]), [
      [1, D, true, '10.00', String(30_000n * WEI), true],
      [2, A, false, '2.00', String(6_000n * WEI), false],
    ]);
    assert.equal(snapshot.winners[0].stack, String(3_000n * WEI), 'the mean original stack');
    assert.equal(snapshot.you.coin, undefined, 'there is no coin: survival is the sampled field');
    assert.equal(snapshot.you.survived, true);
    assert.equal(decimatorReceiptVerdict(snapshot).title, '#2 OF 2');
    assert.match(decimatorReceiptVerdict(snapshot).detail, /^Your run peaked at 2\.00× its bankroll\. Paid/);

    const lost = drawData.buildDecimatorDrawSnapshot({ level, player: C, wallets, gameLogs: logs(), flipLogs: [] });
    assert.equal(lost.you.survived, false);
    assert.deepEqual([decimatorReceiptVerdict(lost).title, decimatorReceiptVerdict(lost).tone], ['NOT DRAWN', 'lost']);

    const recipient = drawData.buildDecimatorDrawSnapshot({ level, player: D, wallets, gameLogs: logs(), flipLogs: [] });
    assert.equal(recipient.you.entryId, null, 'D never burned');
    assert.deepEqual(recipient.you.generatedWins, [{ entryId: '4', rank: 1, ethWei: '700', halfPasses: '1' }]);
    const verdict = decimatorReceiptVerdict(recipient);
    assert.deepEqual([verdict.tone, verdict.title], ['won', 'CHAMPION']);
    assert.match(verdict.detail, /jackpot-day entry drawn for your tickets placed/);
  });

  test('the loader asks for the plan, field bound and generated runs after the seal', async () => {
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
    drawData.__setDecimatorWalletResolverForTest(async () => wallets);
    try {
      const snapshot = await drawData.loadDecimatorDrawSnapshot({ level, player: D, fromBlock: 10 });
      assert.equal(snapshot.winners.length, 2);
      const settle = calls.find(call => Array.isArray(call.topics[0]));
      for (const name of ['DecimatorFieldBound', 'DecimatorJackpotPlan', 'DecimatorGenerated']) {
        assert.ok(settle.topics[0].includes(game.getEvent(name).topicHash), name);
      }
    } finally { drawData.__resetDecimatorDrawProviderForTest(); }
  });
});
