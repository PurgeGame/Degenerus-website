// Audit 95d88f68b: a main-daily ticket leg written straight into the live L+1 buffer logs
// JackpotTicketBatchWin (winners as packed owner registry indices) and one
// JackpotTicketBatchTraits per whole ticket round, instead of JackpotTicketWin + queued entries.
// Neither has a player topic, so player-scoped reads filter them by the player's OWNER ID.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchLanes, batchWinRow, ticketBatchWins, jackpotWin } from '../../chain/jackpots.js';
import { decodeTicketBatchReveal, packedLane } from '../../chain/traits.js';
import { eventPage } from '../../chain/facts.js';
import { contractInterface, wordHex, ChainClient } from '../../chain/client.js';
import { clearEventMemoryForTests } from '../../chain/event-store.js';

const GAME = '0x2222222222222222222222222222222222222222';
const HASH = wordHex(777);
const PLAYER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x3333333333333333333333333333333333333333';

/** Pack uint32 lanes into a uint256[4] the way the contract does (eight per word, low lane first). */
const pack = (lanes) => {
  const words = [0n, 0n, 0n, 0n];
  lanes.forEach((value, j) => { words[j >> 3] |= BigInt(value) << BigInt(32 * (j & 7)); });
  return words;
};
/** A whole ticket's four quadrant traits as one lane (low quadrant first, quadrant in bits 6-7). */
const ticket = (q0, q1, q2, q3) => BigInt(q0) | (BigInt(64 + q1) << 8n) | (BigInt(128 + q2) << 16n) | (BigInt(192 + q3) << 24n);

test('packed lanes read eight uint32 values per word, low lane first', () => {
  const words = pack(Array.from({ length: 20 }, (_, j) => 1000 + j));
  assert.equal(packedLane(words, 0), 1000n);
  assert.equal(packedLane(words, 7), 1007n);
  assert.equal(packedLane(words, 8), 1008n);
  assert.equal(packedLane(words, 19), 1019n);
});

test('a batch reveal returns only the asking owner\'s whole tickets', () => {
  const args = { count: 4n, owners: pack([5, 9, 5, 2]), traits: pack([ticket(1, 2, 3, 4), ticket(9, 9, 9, 9), ticket(5, 6, 7, 8), ticket(0, 0, 0, 0)]) };
  assert.deepEqual(decodeTicketBatchReveal(args, 5), [1, 66, 131, 196, 5, 70, 135, 200]);
  assert.deepEqual(decodeTicketBatchReveal(args, 2), [0, 64, 128, 192]);
  assert.deepEqual(decodeTicketBatchReveal(args, 7), []);
});

test('lanes past count are ignored and a quadrant mismatch is refused', () => {
  const stray = { count: 1n, owners: pack([3, 3]), traits: pack([ticket(1, 1, 1, 1), ticket(2, 2, 2, 2)]) };
  assert.deepEqual(decodeTicketBatchReveal(stray, 3), [1, 65, 129, 193]);
  const bad = { count: 1n, owners: pack([3]), traits: pack([1n | (1n << 8n) | (130n << 16n) | (195n << 24n)]) };
  assert.throws(() => decodeTicketBatchReveal(bad, 3), /quadrant mismatch/);
});

test('a batch lane becomes a JackpotTicketWin-shaped row', () => {
  const row = { name: 'JackpotTicketBatchWin', blockNumber: 10, logIndex: 4, transactionHash: '0xaa', args: {
    sourceLvl: 7n, targetLvl: 8n, trait: 77n, firstWinner: 32n, count: 3n, entriesEach: 8n,
    owners: pack([4, 11, 4]), sourceIndices: pack([12, 0xffffffff, 40]) } };
  const lanes = batchLanes(row);
  assert.deepEqual(lanes.map(l => [l.j, l.ownerIndex, l.sourceIndex]), [[0, 4, 12n], [1, 11, 0xffffffffn], [2, 4, 40n]]);
  const wins = lanes.map(lane => jackpotWin(batchWinRow(row, lane, lane.ownerIndex === 4 ? PLAYER.toUpperCase().replace('0X', '0x') : OTHER)));
  assert.deepEqual(wins.map(w => [w.winner, w.batchLane, w.awardType, w.level, w.traitId, w.amount, w.sourceLevel, w.ticketIndex]),
    [[PLAYER, 32, 'tickets', 8, 77, '8', 7, 12], [OTHER, 33, 'tickets', 8, 77, '8', 7, null], [PLAYER, 34, 'tickets', 8, 77, '8', 7, 40]]);
  assert.throws(() => batchLanes({ ...row, args: { ...row.args, count: 0n } }), /Invalid ticket batch/);
});

/** A snapshot over a real ChainClient whose provider serves `logs` and counts registry reads. */
async function batchSnapshot(batches) {
  clearEventMemoryForTests();
  const iface = await contractInterface('GAME'); const logs = []; const reads = { owners: 0, logs: 0 };
  batches.forEach(([args, block, index]) => logs.push({ ...iface.encodeEventLog('JackpotTicketBatchWin', args), address: GAME,
    blockNumber: block, transactionIndex: index, transactionHash: wordHex(index + 1), blockHash: HASH, logIndex: index }));
  const client = new ChainClient({ validateDeployment: false, chain: { id: 999, deployBlock: 1 }, contracts: { GAME }, provider: { send: async (method, params) => {
    if (method !== 'eth_getLogs') throw new Error(`Unexpected RPC ${method}`);
    reads.logs += 1; const f = params[0];
    return logs.filter(log => log.blockNumber >= Number(f.fromBlock) && log.blockNumber <= Number(f.toBlock)
      && f.topics.every((value, i) => value == null || [].concat(value).some(v => v.toLowerCase() === log.topics[i]?.toLowerCase())));
  } } });
  const registry = { [PLAYER]: 3n, [OTHER]: 12n }; // ticketOwnerId is 1-based: PLAYER is index 2
  const s = { client, block: { number: 50, hash: HASH }, field: async (_c, name, key) => {
    if (name === 'ticketOwnerId') return registry[key] ?? 0n;
    if (name === 'ticketOwners') { reads.owners += 1; return Number(key) === 2 ? PLAYER : OTHER; }
    throw new Error(`unexpected field ${name}`);
  } };
  return { s, reads };
}
const batchArgs = (owners, firstWinner = 0) => [7, 8, 77, firstWinner, owners.length, 8, pack(owners), pack(owners.map((_, j) => 100 + j))];

test('a player-scoped read filters batch lanes by owner ID and resolves no other winner', async () => {
  const { s, reads } = await batchSnapshot([[batchArgs([2, 11, 2, 5]), 20, 0], [batchArgs([11, 11]), 21, 1]]);
  const mine = await ticketBatchWins(s, { fromBlock: 1, toBlock: 50 }, PLAYER);
  assert.deepEqual(mine.map(row => [row.args.winner, row.batchLane, Number(row.args.entryIndex)]), [[PLAYER, 0, 100], [PLAYER, 2, 102]]);
  assert.equal(reads.owners, 0, 'filtering by ID needs no ticketOwners reads');
  const all = await ticketBatchWins(s, { fromBlock: 1, toBlock: 50 });
  assert.equal(all.length, 6); assert.equal(reads.owners, 6, 'an unscoped read names every lane');
});

test('a wallet with no owner ID has no batch wins and reads no logs', async () => {
  const { s, reads } = await batchSnapshot([[batchArgs([2, 11]), 20, 0]]);
  assert.deepEqual(await ticketBatchWins(s, { fromBlock: 1, toBlock: 50 }, '0x4444444444444444444444444444444444444444'), []);
  assert.equal(reads.logs, 0);
});

test('a history page never splits one log\'s rows across two pages', async () => {
  const { s } = await batchSnapshot([]);
  // Three rows from one batch log (block 30, log 5) and one older row; a page of two must keep all three.
  const at = (block, logIndex, lane) => ({ name: 'JackpotTicketWin', blockNumber: block, logIndex, transactionIndex: 0, batchLane: lane, args: {} });
  const extra = async ({ fromBlock, toBlock }) => [at(30, 5, 0), at(30, 5, 1), at(30, 5, 2), at(29, 1, 0)]
    .filter(row => row.blockNumber >= fromBlock && row.blockNumber <= toBlock);
  const first = await eventPage(s, [], new URL('https://x/?limit=2'), { extra });
  assert.deepEqual(first.rows.map(row => [row.blockNumber, row.batchLane]), [[30, 0], [30, 1], [30, 2]]);
  const second = await eventPage(s, [], new URL(`https://x/?limit=2&before=${first.nextCursor}`), { extra });
  assert.deepEqual(second.rows.map(row => [row.blockNumber, row.batchLane]), [[29, 0]]);
});
