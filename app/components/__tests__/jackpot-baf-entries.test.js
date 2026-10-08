import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bafEntryGroups, createBafEntriesReceipt } from '../jackpot-baf-entries.js';

const PLAYER = '0x1234567890123456789012345678901234567890';
class Element {
  hidden = true; children = []; textContent = ''; listeners = {};
  appendChild(child) { this.children.push(child); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
}
const text = el => el.textContent + el.children.map(text).join(' ');
const entry = (sourceLevel, traitId, spots = [0]) => ({ level: 10, sourceLevel, traitId, spots });
const payload = (day, entries) => ({ day, player: PLAYER, supported: true, level: 10, entries });

test('BAF receipt groups repeated spots by source level and trait and excludes far future', () => {
  assert.deepEqual(bafEntryGroups([entry(10, 0, [0, 2]), entry(10, 0), entry(11, 0), entry(12, 0), entry(99, 64)]), [
    { level: 10, sourceLevel: 10, traitId: 0, count: 3 },
    { level: 10, sourceLevel: 11, traitId: 0, count: 1 },
  ]);
});

test('BAF receipt stays hidden until requested and never paints a previous day after reset', async () => {
  const previous = globalThis.document; globalThis.document = { createElement: () => new Element() };
  try {
    const host = new Element(); let done; let reads = 0;
    const receipt = createBafEntriesReceipt(host, () => { reads++; return new Promise(resolve => { done = resolve; }); });
    assert.equal(reads, 0); assert.equal(host.hidden, true);
    const stale = receipt.reveal(119, PLAYER); receipt.reset(); done(payload(119, [entry(10, 7)])); await stale;
    assert.equal(host.hidden, true); assert.equal(host.children.length, 0);
    const current = receipt.reveal(120, PLAYER); done(payload(120, [entry(10, 7, [0, 1]), entry(11, 78)])); await current;
    assert.equal(host.hidden, false);
    assert.match(text(host), /Level 10 · 2 entries/); assert.match(text(host), /Level 11 · 1 entry/);
    assert.match(text(host), /did not win/);
    await receipt.reveal(120, PLAYER); assert.equal(reads, 2, 'repeated completion events do not refetch');
  } finally { globalThis.document = previous; }
});

test('BAF read failure offers retry instead of inventing a zero-entry result', async () => {
  const previous = globalThis.document; globalThis.document = { createElement: () => new Element() };
  try {
    const host = new Element(); let failed = true;
    const receipt = createBafEntriesReceipt(host, async () => { if (failed) throw Error('offline'); return payload(119, []); });
    await receipt.reveal(119, PLAYER); assert.match(text(host), /unavailable/);
    failed = false; host.children[0].listeners.click(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(text(host), /None of your entries/);
  } finally { globalThis.document = previous; }
});
