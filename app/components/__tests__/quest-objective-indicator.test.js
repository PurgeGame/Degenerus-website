import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as storeMod from '../../app/store.js';
import {
  questCompletionBonusModel,
  questObjectiveIndicatorModel,
  questProductsForType,
} from '../../app/quest-objectives.js';

const STATUS_CSS = readFileSync(new URL('../../styles/status-indicators.css', import.meta.url), 'utf8');
const QUEST_ICON = readFileSync(new URL('../../assets/quest-objective.svg', import.meta.url), 'utf8');
const QUEST_BOTTOM_LEFT_ICON = readFileSync(
  new URL('../../assets/quest-objective-tail-bottom-left.svg', import.meta.url),
  'utf8',
);

class FakeHTMLElement {
  constructor() {
    this._attrs = new Map();
    this.hidden = false;
    this.textContent = '';
    this.title = '';
    this.parentElement = null;
    this.classList = { add() {}, remove() {} };
    this._listeners = new Map();
  }
  getAttribute(name) { return this._attrs.get(name) ?? null; }
  setAttribute(name, value) { this._attrs.set(name, String(value)); }
  removeAttribute(name) { this._attrs.delete(name); }
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this._listeners.get(type)?.delete(listener); }
  dispatchEvent(event) {
    for (const listener of this._listeners.get(event?.type) || []) listener.call(this, event);
    return true;
  }
}

globalThis.HTMLElement = FakeHTMLElement;
globalThis.customElements = {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};

const { QuestObjectiveIndicator } = await import('../quest-objective-indicator.js');

describe('<quest-objective-indicator>', () => {
  beforeEach(() => storeMod.__resetForTest());

  test('maps every quest family to the action that advances it', () => {
    assert.deepEqual(questProductsForType(1), ['purchase', 'lootbox']);
    assert.deepEqual(questProductsForType(2), ['coinflip']);
    assert.deepEqual(questProductsForType(3), ['affiliate']);
    assert.deepEqual(questProductsForType(4), ['foil']);
    assert.deepEqual(questProductsForType(5), ['decimator']);
    assert.deepEqual(questProductsForType(7), ['degenerette-eth']);
    assert.deepEqual(questProductsForType(8), ['degenerette-flip']);
    assert.deepEqual(questProductsForType(9), ['redeem-flip']);
  });

  test('appears only beside a product with an unfinished quest', () => {
    const el = new QuestObjectiveIndicator();
    el.setAttribute('product', 'coinflip');
    el.connectedCallback();
    assert.equal(el.hidden, true);

    storeMod.update('ui.questObjectives', {
      address: '0xabc',
      day: 94,
      quests: [
        { questType: 2, role: 'BONUS', label: 'Coinflip', completed: false },
        { questType: 6, role: 'LEVEL', label: 'Luckbox', completed: false },
      ],
    });
    assert.equal(el.hidden, false);
    assert.equal(el.textContent, '');
    assert.equal(el.getAttribute('data-quest-product'), 'coinflip');
    assert.equal(el.getAttribute('data-quest-count'), '1');
    assert.match(el.title, /unfinished quest.*bonus.*coinflip/i);

    storeMod.update('ui.questObjectives', {
      quests: [{ questType: 2, role: 'BONUS', label: 'Coinflip', completed: true }],
    });
    assert.equal(el.hidden, true);
    el.disconnectedCallback();
  });

  test('counts two open quests that share one purchase control', () => {
    const model = questObjectiveIndicatorModel({ quests: [
      { questType: 1, role: 'DAILY', label: 'Buy a Ticket or Luckbox', completed: false },
      { questType: 6, role: 'LEVEL', label: 'Buy Luckbox', completed: false },
    ] }, 'lootbox');
    assert.equal(model.count, 2);
    assert.match(model.title, /2 unfinished quests/i);
    assert.match(model.title, /daily: buy a ticket or luckbox/i);
    assert.match(model.title, /level: buy luckbox/i);
  });

  test('previews only rewards this exact action will complete', () => {
    const unit = 10n ** 18n;
    const payload = { quests: [
      {
        questType: 2, role: 'DAILY', label: 'Coinflip', completed: false,
        progress: String(1_500n * unit), target: String(2_000n * unit),
        flipReward: 100,
      },
      {
        questType: 2, role: 'LEVEL', label: 'Coinflip', completed: false,
        progress: String(1_900n * unit), target: String(2_000n * unit),
        eligible: true, flipReward: 800, streakReward: 5,
      },
    ] };
    assert.equal(questCompletionBonusModel(payload, 'coinflip', 99n * unit), null);
    const bonus = questCompletionBonusModel(payload, 'coinflip', 500n * unit);
    assert.equal(bonus.count, 2);
    assert.equal(bonus.flipReward, 900);
    assert.equal(bonus.streakReward, 6);
    assert.equal(bonus.message, '2 QUEST COMPLETION BONUSES · +900 FLIP · +6 STREAK');
  });

  test('a locked bonus is omitted unless one Luckbox also completes its primary', () => {
    const unit = 10n ** 18n;
    const payload = { quests: [
      {
        questType: 1, role: 'DAILY', progress: String(900n * unit),
        target: String(1_000n * unit), completed: false, gated: false,
      },
      {
        questType: 6, role: 'BONUS', progress: 0, target: String(100n * unit),
        completed: false, gated: true,
      },
      {
        questType: 2, role: 'BONUS', progress: 0, target: String(100n * unit),
        completed: false, gated: true,
      },
    ] };
    const lootbox = questCompletionBonusModel(payload, 'lootbox', 100n * unit);
    assert.equal(lootbox.count, 2, 'one Luckbox can complete primary and bonus atomically');
    assert.equal(lootbox.flipReward, 200);
    assert.equal(lootbox.streakReward, 2);
    assert.equal(questCompletionBonusModel(payload, 'coinflip', 100n * unit), null,
      'an unrelated locked bonus cannot promise a payout');
  });

  test('does not promise an ineligible level reward', () => {
    const unit = 10n ** 18n;
    assert.equal(questCompletionBonusModel({ quests: [{
      questType: 8, role: 'LEVEL', progress: 0, target: String(100n * unit),
      completed: false, eligible: false,
    }] }, 'degenerette-flip', 100n * unit), null);
  });

  test('clicking the marker opens the same matching quest flow as its quest card', () => {
    const previousDocument = globalThis.document;
    let opened = null;
    globalThis.document = {
      dispatchEvent(event) { opened = event; return true; },
    };
    const el = new QuestObjectiveIndicator();
    el.setAttribute('product', 'lootbox');
    el.connectedCallback();
    storeMod.update('ui.questObjectives', {
      quests: [
        { questType: 1, role: 'DAILY', label: 'Buy a Ticket or Luckbox', completed: false },
        { questType: 6, role: 'LEVEL', label: 'Buy Luckbox', completed: false },
      ],
    });
    let prevented = false;
    let stopped = false;
    el.dispatchEvent({
      type: 'click',
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
    });
    assert.equal(opened?.type, 'quest:open');
    assert.deepEqual(opened?.detail?.quests, [
      { questType: 1, role: 'DAILY' },
      { questType: 6, role: 'LEVEL' },
    ]);
    assert.equal(opened?.detail?.trigger, el);
    assert.equal(prevented, true, 'nested buy/currency controls do not also fire');
    assert.equal(stopped, true, 'the click belongs to the quest shortcut');
    assert.equal(el.getAttribute('role'), 'button');
    assert.match(el.getAttribute('aria-label'), /click to complete/i);
    el.disconnectedCallback();
    globalThis.document = previousDocument;
  });

  test('the referral marker describes its copy action', () => {
    const el = new QuestObjectiveIndicator();
    el.setAttribute('product', 'affiliate');
    el.connectedCallback();
    storeMod.update('ui.questObjectives', {
      quests: [
        { questType: 3, role: 'DAILY', label: 'Referral', completed: false },
      ],
    });
    assert.match(el.title, /copy your referral link/i);
    assert.match(el.getAttribute('aria-label'), /copy your referral link/i);
    el.disconnectedCallback();
  });

  test('uses a distinct quest-waypoint symbol, not boon or bounty language', () => {
    assert.match(STATUS_CSS, /url\('\/app\/assets\/quest-objective\.svg'\)/);
    assert.match(STATUS_CSS,
      /quest-objective-indicator\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    assert.match(QUEST_ICON, /Unfinished quest/);
    assert.doesNotMatch(QUEST_ICON, /crosshair|target|bount/i);
    assert.doesNotMatch(QUEST_ICON, /<rect\b/i, 'the quest marker is not another square box');
    assert.match(QUEST_ICON, /waypoint\/speech-bubble/i);
    assert.match(QUEST_ICON, /stem-to-dot air/i,
      'the enlarged bubble retains compact punctuation with a clearer gap');
    assert.match(QUEST_BOTTOM_LEFT_ICON, /tail leaves the[\s\S]*lower-left edge/i);
    assert.match(STATUS_CSS,
      /\[data-quest-pointer="bottom-left"\][\s\S]*?quest-objective-tail-bottom-left\.svg/s,
      'hosts can select artwork whose pointer aims back at their control');
    assert.match(STATUS_CSS,
      /body\.layout-basic quest-objective-indicator\s*\{[^}]*position:\s*absolute;[^}]*flex:\s*none;/s,
      'quest markers never participate in the host box dimensions');
    assert.match(STATUS_CSS,
      /body\.layout-basic quest-objective-indicator\s*\{[^}]*scale:\s*1\.1;/s,
      'the larger quest marker is a visual scale and cannot expand its host');
    assert.match(STATUS_CSS,
      /\.dec-input-accessories > boon-product-indicator[\s\S]*?\.dec-input-accessories > quest-objective-indicator/,
      'a simultaneous boon and quest use a separate paired badge lane');
  });
});
