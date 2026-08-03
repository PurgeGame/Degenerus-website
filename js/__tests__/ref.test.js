// /js/__tests__/ref.test.js — ENS-aware referral capture (/js/ref.js).
//
// Run: cd website && node --test js/__tests__/ref.test.js
//
// Strategy: ref.js is a classic IIFE script with no imports/exports, so each
// test imports it as an ESM side-effect module with a unique query string for
// a fresh run, against stubbed document/location/storage/fetch globals. The
// script's __DGN_REF_TEST__ hook exposes internals (keccak, namehash, the
// async ENS op) for direct assertion.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const PADDED = (addr) => '0x' + '0'.repeat(24) + addr;
const ADDR = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const RESOLVER = 'cafebabecafebabecafebabecafebabecafebabe';
const WORD = (hex40) => '0x' + '0'.repeat(24) + hex40;
const ZERO_WORD = '0x' + '0'.repeat(64);

let runId = 0;

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

async function loadRef({ search = '', fetchImpl = null } = {}) {
  globalThis.__DGN_REF_TEST__ = {};
  globalThis.window = globalThis;
  globalThis.document = { cookie: '' };
  globalThis.localStorage = makeStorage();
  globalThis.sessionStorage = makeStorage();
  globalThis.location = { search, protocol: 'https:' };
  globalThis.fetchCalls = [];
  globalThis.fetch = fetchImpl || (() => Promise.reject(new Error('no fetch stub')));
  await import(`../ref.js?run=${runId++}`);
  return globalThis.__DGN_REF_TEST__;
}

// fetch stub answering registry-resolver then resolver-addr eth_calls
function ensFetch({ resolverWord = WORD(RESOLVER), addrWord = WORD(ADDR) } = {}) {
  return (url, opts) => {
    const body = JSON.parse(opts.body);
    globalThis.fetchCalls.push({ url, data: body.params[0].data, to: body.params[0].to });
    const sel = body.params[0].data.slice(0, 10);
    const result = sel === '0x0178b8bf' ? resolverWord : addrWord;
    return Promise.resolve({ json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }) });
  };
}

describe('keccak + namehash vectors', () => {
  test('keccak256 known vectors', async () => {
    const t = await loadRef();
    assert.equal(t.keccak256hex(''),
      'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    assert.equal(t.keccak256hex('abc'),
      '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  });

  test('namehash known vectors', async () => {
    const t = await loadRef();
    assert.equal(t.namehash(''), '0'.repeat(64));
    assert.equal(t.namehash('eth'),
      '93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae');
    assert.equal(t.namehash('foo.eth'),
      'de9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f');
  });
});

describe('ensName validation', () => {
  test('accepts lowercase, subdomains, uppercase-folds; rejects non-eth and unicode', async () => {
    const t = await loadRef();
    assert.equal(t.ensName('degenbob.eth'), 'degenbob.eth');
    assert.equal(t.ensName('FOO.ETH'), 'foo.eth');
    assert.equal(t.ensName('a.p3dcoin.eth'), 'a.p3dcoin.eth');
    assert.equal(t.ensName('DEGEN'), null);
    assert.equal(t.ensName('foo.com'), null);
    assert.equal(t.ensName('föö.eth'), null);
    assert.equal(t.ensName('0x' + ADDR), null);
    assert.equal(t.ensName(''), null);
    assert.equal(t.ensName(null), null);
  });
});

describe('capture behavior', () => {
  test('hex address path stores synchronously, no network', async () => {
    await loadRef({ search: `?ref=0x${ADDR}` });
    assert.equal(globalThis.localStorage.getItem('affiliate-ref'), PADDED(ADDR));
    assert.match(globalThis.document.cookie, new RegExp(PADDED(ADDR)));
    assert.equal(globalThis.fetchCalls.length, 0);
  });

  test('ENS name resolves and stores the padded address', async () => {
    const t = await loadRef({ search: '?ref=degenbob.eth', fetchImpl: ensFetch() });
    await t.op();
    assert.equal(globalThis.localStorage.getItem('affiliate-ref'), PADDED(ADDR));
    assert.match(globalThis.document.cookie, new RegExp(PADDED(ADDR)));
    assert.equal(globalThis.sessionStorage.getItem('dgn_ref_pending'), null);
    // called registry then resolver
    assert.equal(globalThis.fetchCalls.length, 2);
    assert.equal(globalThis.fetchCalls[1].to, '0x' + RESOLVER);
  });

  test('definitive negative (no resolver) stores nothing, no pending', async () => {
    const t = await loadRef({
      search: '?ref=nosuchname.eth',
      fetchImpl: ensFetch({ resolverWord: ZERO_WORD }),
    });
    await t.op();
    assert.equal(globalThis.localStorage.getItem('affiliate-ref'), null);
    assert.equal(globalThis.document.cookie, '');
    assert.equal(globalThis.sessionStorage.getItem('dgn_ref_pending'), null);
  });

  test('definitive negative (zero addr record) stores nothing', async () => {
    const t = await loadRef({
      search: '?ref=noaddr.eth',
      fetchImpl: ensFetch({ addrWord: ZERO_WORD }),
    });
    await t.op();
    assert.equal(globalThis.localStorage.getItem('affiliate-ref'), null);
    assert.equal(globalThis.sessionStorage.getItem('dgn_ref_pending'), null);
  });

  test('transient failure stashes pending; next load retries and stores', async () => {
    const t = await loadRef({
      search: '?ref=degenbob.eth',
      fetchImpl: () => Promise.reject(new Error('network down')),
    });
    await t.op();
    assert.equal(globalThis.localStorage.getItem('affiliate-ref'), null);
    assert.equal(globalThis.sessionStorage.getItem('dgn_ref_pending'), 'degenbob.eth');

    // simulate next page load in the same tab: no ?ref, network back up
    const pending = globalThis.sessionStorage;
    globalThis.__DGN_REF_TEST__ = {};
    globalThis.document = { cookie: '' };
    globalThis.localStorage = makeStorage();
    globalThis.sessionStorage = pending;
    globalThis.location = { search: '', protocol: 'https:' };
    globalThis.fetchCalls = [];
    globalThis.fetch = ensFetch();
    await import(`../ref.js?run=retry${runId++}`);
    await globalThis.__DGN_REF_TEST__.op();
    assert.equal(globalThis.localStorage.getItem('affiliate-ref'), PADDED(ADDR));
    assert.equal(globalThis.sessionStorage.getItem('dgn_ref_pending'), null);
  });

  test('first touch wins: existing ref blocks ENS resolution entirely', async () => {
    const existing = PADDED('1'.repeat(40));
    globalThis.__DGN_REF_TEST__ = {};
    globalThis.window = globalThis;
    globalThis.document = { cookie: '' };
    globalThis.localStorage = makeStorage();
    globalThis.localStorage.setItem('affiliate-ref', existing);
    globalThis.sessionStorage = makeStorage();
    globalThis.location = { search: '?ref=degenbob.eth', protocol: 'https:' };
    globalThis.fetchCalls = [];
    globalThis.fetch = ensFetch();
    await import(`../ref.js?run=first${runId++}`);
    assert.equal(globalThis.__DGN_REF_TEST__.op(), null); // never even started
    assert.equal(globalThis.fetchCalls.length, 0);
    assert.equal(globalThis.localStorage.getItem('affiliate-ref'), existing);
  });

  test('slow resolve cannot clobber a ref stored during the wait', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const slowFetch = (url, opts) => gate.then(() => ensFetch()(url, opts));
    const t = await loadRef({ search: '?ref=degenbob.eth', fetchImpl: slowFetch });
    // while ENS resolve is in flight, another tab/visit stores a ref
    const other = PADDED('2'.repeat(40));
    globalThis.localStorage.setItem('affiliate-ref', other);
    release();
    await t.op();
    assert.equal(globalThis.localStorage.getItem('affiliate-ref'), other);
  });

  test('vanity strings still rejected, nothing stored, no network', async () => {
    await loadRef({ search: '?ref=DEGEN' });
    assert.equal(globalThis.localStorage.getItem('affiliate-ref'), null);
    assert.equal(globalThis.fetchCalls.length, 0);
  });

  test('rpc endpoint fallback: first endpoint dead, second answers', async () => {
    let call = 0;
    const flaky = (url, opts) => {
      call++;
      if (call <= 1) return Promise.reject(new Error('endpoint down'));
      return ensFetch()(url, opts);
    };
    const t = await loadRef({ search: '?ref=degenbob.eth', fetchImpl: flaky });
    await t.op();
    assert.equal(globalThis.localStorage.getItem('affiliate-ref'), PADDED(ADDR));
  });
});
