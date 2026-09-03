import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as full from 'ethers';
import * as vendor from '../../vendor/ethers-app.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAYER = '0x000000000000000000000000000000000000dEaD';
const expectedExports = [
  'AbiCoder', 'BrowserProvider', 'Contract', 'Interface', 'JsonRpcProvider',
  'LogDescription', 'ZeroAddress', 'ZeroHash', 'decodeBytes32String',
  'encodeBytes32String', 'ethers', 'formatEther', 'getAddress', 'id',
  'isAddress', 'keccak256', 'parseEther', 'solidityPackedKeccak256',
  'toBeHex', 'version', 'zeroPadValue',
].sort();

describe('tree-shaken browser ethers build', () => {
  test('exports exactly the application surface and keeps the namespace facade', () => {
    assert.deepEqual(Object.keys(vendor).sort(), expectedExports);
    for (const name of expectedExports.filter((name) => name !== 'ethers')) {
      assert.strictEqual(vendor.ethers[name], vendor[name], `ethers.${name}`);
    }
    assert.equal(vendor.version, '6.16.0');
  });

  test('matches upstream encoding, hashing and unit conversion', () => {
    const values = [PLAYER, 42n];
    const types = ['address', 'uint256'];
    assert.equal(
      vendor.AbiCoder.defaultAbiCoder().encode(types, values),
      full.AbiCoder.defaultAbiCoder().encode(types, values),
    );
    assert.equal(vendor.keccak256('0x1234'), full.keccak256('0x1234'));
    assert.equal(
      vendor.solidityPackedKeccak256(types, values),
      full.solidityPackedKeccak256(types, values),
    );
    assert.equal(vendor.parseEther('1.25'), full.parseEther('1.25'));
    assert.equal(vendor.formatEther(1_250_000_000_000_000_000n), '1.25');
    assert.equal(
      vendor.decodeBytes32String(vendor.encodeBytes32String('SHARK')),
      'SHARK',
    );
    assert.equal(vendor.getAddress(PLAYER.toLowerCase()), full.getAddress(PLAYER.toLowerCase()));
  });

  test('retains contract, event and provider APIs used at runtime', () => {
    const iface = new vendor.Interface(['event Prize(address indexed player,uint256 amount)']);
    const encoded = iface.encodeEventLog(iface.getEvent('Prize'), [PLAYER, 42n]);
    const parsed = iface.parseLog(encoded);
    assert.ok(parsed instanceof vendor.LogDescription);
    assert.equal(parsed.args.player, vendor.getAddress(PLAYER));
    assert.equal(parsed.args.amount, 42n);
    assert.equal(typeof vendor.BrowserProvider.discover, 'function');
    assert.equal(typeof vendor.JsonRpcProvider, 'function');
    assert.equal(typeof vendor.Contract, 'function');
  });

  test('is materially smaller than the full vendored library', () => {
    const slim = statSync(resolvePath(__dirname, '../../vendor/ethers-app.mjs')).size;
    const complete = statSync(resolvePath(__dirname, '../../vendor/ethers.mjs')).size;
    assert.ok(slim < complete * 0.8, `${slim} should be at least 20% below ${complete}`);
  });
});
