import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDgnWinnings } from '../dgn-winnings.js';

function harness({ reducedMotion = false } = {}) {
  const frames = new Map();
  let id = 0;
  const doc = {
    defaultView: {
      requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
      cancelAnimationFrame(key) { frames.delete(key); },
      matchMedia() { return { matches: reducedMotion }; },
    },
    createElement() {
      let text = '';
      return {
        children: [], textWrites: 0, className: '', classList: { add() {}, remove() {} },
        attributes: {}, eventListeners: {},
        setAttribute(key, value) { this.attributes[key] = String(value); },
        getAttribute(key) { return this.attributes[key] ?? null; },
        addEventListener(type, fn) { this.eventListeners[type] = fn; },
        appendChild(node) { this.children.push(node); },
        get textContent() { return text + this.children.map(node => node.textContent).join(''); },
        set textContent(value) { this.textWrites++; text = String(value); this.children = []; },
      };
    },
  };
  const winnings = createDgnWinnings(doc);
  const value = winnings.element.children.find(node => node.className === 'dgn-winnings__amount').children[0];
  const frame = time => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach(callback => callback(time));
  };
  return { doc, winnings, value, frames, frame };
}

test('new winnings count from the painted amount and supersede an unfinished count', () => {
  const { winnings, value, frame, frames } = harness();
  winnings.update('1,000 FLIP');
  frame(0); frame(210);
  const partial = value.textContent;
  assert.equal(partial, '875 FLIP');
  winnings.update('2,000 FLIP');
  assert.equal(frames.size, 1, 'the old count is cancelled');
  frame(220);
  assert.equal(value.textContent, partial, 'the second win never resets the display to zero');
  frame(640);
  assert.equal(value.textContent, '2,000 FLIP');
  assert.equal(frames.size, 0);
  winnings.dispose();
});

test('final ETH receipt keeps the cash and Luckbox amounts in the same readout', () => {
  const { doc, winnings, value, frame } = harness();
  winnings.update('0.015 ETH', { secondaryText: '0.005 ETH LUCKBOX', duration: 0 });
  const receipt = doc.createElement('div');
  for (const text of ['0.03 ETH WON', '+', '0.01 ETH LUCKBOX']) {
    const node = doc.createElement('span'); node.textContent = text; receipt.appendChild(node);
  }
  winnings.finish(receipt);
  frame(0);
  assert.equal(receipt.children[0].textContent, '0.015 ETH WON');
  assert.equal(receipt.children[2].textContent, '0.005 ETH LUCKBOX');
  frame(600);
  assert.equal(receipt.children[0].textContent, '0.03 ETH WON');
  assert.equal(receipt.children[2].textContent, '0.01 ETH LUCKBOX');
  winnings.update('99 ETH');
  assert.equal(value.textContent, '0.015 ETH', 'late progress cannot overwrite the settled receipt');
  winnings.dispose();
});

test('reduced motion paints exact values without animation frames', () => {
  const { winnings, value, frames } = harness({ reducedMotion: true });
  winnings.update('12,345.6789 FLIP');
  assert.equal(value.textContent, '12,345.6789 FLIP');
  assert.equal(frames.size, 0);
  winnings.dispose();
});

test('closing stops the counter and ignores later payout updates', () => {
  const { winnings, value, frame, frames } = harness();
  winnings.update('9,000 FLIP'); frame(0); frame(100);
  const before = value.textContent;
  winnings.dispose();
  assert.equal(frames.size, 0);
  winnings.update('10,000 FLIP'); frame(1000);
  assert.equal(value.textContent, before);
});

test('quadrant progress with unchanged winnings preserves the readout and live announcement', () => {
  const { winnings, frames } = harness();
  winnings.update('0 FLIP', { detail: '0 / 25 CARDS', duration: 0 });
  const writes = node => node.textWrites + node.children.reduce((sum, child) => sum + writes(child), 0);
  const before = writes(winnings.element);
  for (let i = 0; i < 3; i++) winnings.update('0 FLIP', { detail: '0 / 25 CARDS' });
  assert.equal(writes(winnings.element), before, 'partial quadrants neither rewrite nor re-announce unchanged winnings');
  assert.equal(frames.size, 0);
  winnings.dispose();
});

test('the shared reward spot gates opening, opens once, and ignores clicks after disposal', () => {
  const { doc, winnings } = harness();
  const slot = winnings.element.children[0];
  const button = slot.children.find(node => node.className === 'dgn-winnings__lootbox');
  let opens = 0;
  const reward = { artSrc: '/case.webp', amountText: '0.01 ETH', onOpen: () => { opens++; } };
  assert.equal(button.hidden, true);
  winnings.showCoin(doc.createElement('span'), 'CURRENCY FLIP');
  assert.equal(winnings.coinSlot.hidden, false);
  winnings.showLootbox({ ...reward, onOpen: null });
  assert.equal(winnings.coinSlot.hidden, true);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, true);
  button.eventListeners.click({});
  assert.equal(opens, 0);
  winnings.showLootbox({ ...reward, complete: true });
  assert.equal(button.disabled, false);
  button.eventListeners.click({}); button.eventListeners.click({});
  assert.equal(opens, 1);
  winnings.showLootbox(reward);
  winnings.dispose();
  button.eventListeners.click({});
  assert.equal(opens, 1);
});
