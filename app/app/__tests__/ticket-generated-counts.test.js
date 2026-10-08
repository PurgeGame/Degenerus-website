import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticketCounts } from '../../chain/tickets.js';
import { ChainClient, contractInterface, wordHex } from '../../chain/client.js';
import { clearEventMemoryForTests } from '../../chain/event-store.js';
import { useSchema, CURRENT_SCHEMA_HASH, BEFORE_WALLET_IDS_SCHEMA_HASH } from '../../chain/schema.js';

const PLAYER = '0x1111111111111111111111111111111111111111';
const GAME = '0x2222222222222222222222222222222222222222';
const HASH = wordHex(777);
const pack = lanes => lanes.reduce((out, lane, j) => { out[j >> 3] |= BigInt(lane) << BigInt(32 * (j & 7)); return out; }, [0n,0n,0n,0n]);
const traits = 1n | (66n << 8n) | (131n << 16n) | (196n << 24n);
for (const [schema, ownerKey, ownerLane] of [[CURRENT_SCHEMA_HASH, 42, 42], [BEFORE_WALLET_IDS_SCHEMA_HASH, PLAYER, 41]]) {
  test(`holdings include direct jackpot tickets alongside seated and queued entries (${schema})`, async () => {
    useSchema(schema); clearEventMemoryForTests();
    const iface = await contractInterface('GAME');
    const batch = iface.encodeEventLog('JackpotTicketBatchTraits', [17, 3, pack([ownerLane, 99, ownerLane]), pack([traits, traits, traits])]);
    const seat = { topics: [wordHex((17n << 160n) | BigInt(ownerKey)), wordHex(0), wordHex(0), wordHex(0)], data: wordHex(traits | (15n << 128n)) };
    const logs = [batch, seat].map((log, index) => ({ ...log, address: GAME, blockNumber: 20,
      blockHash: HASH, transactionHash: wordHex(index + 1), transactionIndex: index, logIndex: index }));
    const client = new ChainClient({ validateDeployment: false, chain: { id: 998, deployBlock: 1 }, contracts: { GAME },
      provider: { send: async (method, [filter]) => {
        assert.equal(method, 'eth_getLogs');
        return logs.filter(log => log.blockNumber >= Number(filter.fromBlock) && log.blockNumber <= Number(filter.toBlock)
          && filter.topics.every((topic, i) => topic == null || [].concat(topic).includes(log.topics[i])));
      } } });
    const s = { client, block: { number: 50, hash: HASH },
      field: async (_c, field, key) => {
        if (field === 'ticketGenerationStartBlock') return Number(key) === 17 ? 10n : 0n;
        if (field === 'ticketOwnerId') return 42n;
        throw Error(`unexpected field ${field}`);
      },
      call: async (_c, method, args) => {
        if (method === 'walletIdOf') return 42n;
        if (method === 'entriesOwedView') return args[0] === 17 ? 2n : 8n;
        throw Error(`unexpected call ${method}`);
      },
    };
    assert.deepEqual(await ticketCounts(s, PLAYER, [17,18]), [
      { level: 17, entryCount: 14, generatedEntries: 12, pendingEntries: 2 },
      { level: 18, entryCount: 8, generatedEntries: 0, pendingEntries: 8 },
    ]);
  });
}
