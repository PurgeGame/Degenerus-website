import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.HTMLElement ||= class HTMLElement {};
globalThis.customElements ||= {
  _items: new Map(),
  define(name, ctor) { this._items.set(name, ctor); },
  get(name) { return this._items.get(name); },
};

const { deitySymbolPresentation } = await import('../../app/deity-symbol.js');
const { isDiscordSnowflake, resolvePlayerTarget } = await import('../../app/player-target.js');
const { deityBoonActionLabel, deityDeskModel } = await import('../app-deity-desk.js');

const DESK_SRC = readFileSync(new URL('../app-deity-desk.js', import.meta.url), 'utf8');
const PASS_SRC = readFileSync(new URL('../app-pass-section.js', import.meta.url), 'utf8');
const INDEX_HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');

describe('<app-deity-desk>', () => {
  test('uses the holder gold symbol and player-facing God title', () => {
    assert.deepEqual(deitySymbolPresentation(7), {
      id: 7,
      name: 'Bitcoin',
      title: 'God of Bitcoin',
      path: '/badges-circular/crypto_07_bitcoin_gold.svg',
    });
    assert.equal(deitySymbolPresentation(0).title, 'God of WWXRP');
  });

  test('shows three daily boons and owner-only smite state for a holder', () => {
    const owner = '0xab00000000000000000000000000000000000000';
    const catalog = { ownersBySymbol: new Map([[7, owner]]) };
    const model = deityDeskModel({
      catalog,
      owner,
      connected: owner.toUpperCase(),
      boonState: { usedMask: 0b010 },
      mode: 'self',
    });
    assert.equal(model.visible, true);
    assert.equal(model.symbol.title, 'God of Bitcoin');
    assert.equal(model.remaining, 2);
    assert.equal(model.canSmite, true);
    assert.equal(deityDeskModel({ catalog, owner, connected: owner, boonState: {}, mode: 'combined' }).visible,
      false, 'combined accounts do not expose an ambiguous write target');
  });

  test('operator mode retains boons but correctly locks the owner-only smite', () => {
    const owner = '0xab00000000000000000000000000000000000000';
    const connected = '0xcd00000000000000000000000000000000000000';
    const catalog = { ownersBySymbol: new Map([[11, owner]]) };
    const model = deityDeskModel({ catalog, owner, connected, boonState: {}, mode: 'operator' });
    assert.equal(model.visible, true);
    assert.equal(model.canSmite, false);
  });

  test('accepts a wallet directly or resolves a Discord ID through the player database', async () => {
    const wallet = '0xcd34000000000000000000000000000000000000';
    let fetched = null;
    assert.equal(await resolvePlayerTarget(wallet, {
      fetcher: async () => { throw new Error('direct wallets never fetch'); },
    }), '0xCd34000000000000000000000000000000000000');
    assert.equal(isDiscordSnowflake('123456789012345678'), true);
    assert.equal(await resolvePlayerTarget('123456789012345678', {
      baseUrl: 'https://session.example',
      fetcher: async (url, init) => {
        fetched = { url, init };
        return { ok: true, json: async () => ({ address: wallet }) };
      },
    }), '0xCd34000000000000000000000000000000000000');
    assert.equal(fetched.url,
      'https://session.example/api/player/by-discord/123456789012345678');
    assert.equal(fetched.init.credentials, 'include');
  });

  test('mounts the compact four-action desk above Tickets and removes the old controls', () => {
    assert.ok(INDEX_HTML.indexOf('<app-deity-desk>') < INDEX_HTML.indexOf('<app-tickets-inventory>'));
    assert.match(DESK_SRC, /placeholder="0x address or Discord ID"/);
    assert.match(DESK_SRC, /\[0, 1, 2\]\.map/);
    assert.match(DESK_SRC, /data-bind="deity-desk-smite"/);
    assert.match(DESK_SRC, />SMITE</);
    assert.match(DESK_SRC, /<strong>-2 SCORE<\/strong>/);
    assert.match(DESK_SRC, /deity-desk__smite-cost">COST:<img src="\/whitepaper\/flame-logo-split\.svg" alt="FLIP">200/);
    assert.ok(
      DESK_SRC.indexOf('data-bind="deity-desk-smite"')
        < DESK_SRC.indexOf('data-bind="deity-desk-boon-${slot}"'),
      'smite is the top-left action before the three boon cards',
    );
    assert.doesNotMatch(DESK_SRC, />CURSE<|Curse confirmed|deity-curse/);
    assert.equal(deityBoonActionLabel({ name: 'Tickets' }, 0), 'Tickets BOON');
    assert.equal(deityBoonActionLabel({ name: 'Mystery boon' }, 1), 'Mystery boon');
    assert.match(DESK_SRC, /issueDeityBoon\(\{ recipient: target, slot: action \}\)/);
    assert.match(DESK_SRC, /smiteWithDeity\(\{ deityId: model\.symbolId, target \}\)/);
    assert.doesNotMatch(DESK_SRC, /deity-desk-status|DAY \$\{this\.#boonState\.day\}/,
      'the identity side contains no day or RNG status copy');
    assert.doesNotMatch(PASS_SRC, /data-bind="pass-deity-(?:boons|curse)"/);
    assert.match(APP_CSS, /\.deity-desk__actions\s*\{[^}]*repeat\(4,/s);
    assert.match(DESK_SRC, /data-boon-product/,
      'daily boon buttons carry their affected product for color coding');
    assert.match(APP_CSS, /\.deity-desk__actions button\s*\{[^}]*min-height:\s*3\.05rem/s,
      'daily boon buttons have a larger action target');
    assert.match(APP_CSS, /\.deity-desk__actions button span\s*\{[^}]*0\.64rem/s,
      'daily boon labels are larger');
    assert.match(APP_CSS, /\.deity-desk__actions button\[data-boon-product="decimator"\]/,
      'boon buttons use product-specific color treatments');
    assert.match(DESK_SRC, /class="deity-desk__crest"/,
      'the owned symbol sits in a premium pass seal');
    assert.match(APP_CSS, /\.deity-desk__crest\s*\{[^}]*radial-gradient/s,
      'the pass seal has a layered gold treatment');
    assert.match(APP_CSS, /\.deity-desk__crest::after\s*\{[^}]*border:\s*1px dashed/s,
      'the pass seal has an etched outer ring');
    assert.match(APP_CSS, /\.deity-desk__actions button::after\s*\{[^}]*rgb\(var\(--boon-rgb\)\)/s,
      'each action carries a small product-colored power light');
    assert.match(APP_CSS, /\.deity-desk__smite-cost\s*\{[^}]*position:\s*absolute[^}]*right:\s*0\.54rem[^}]*bottom:\s*0\.2rem[^}]*font:\s*950 0\.5rem/s,
      'Smite leaves its name on the first line and moves a larger FLIP cost to the bottom-right');
    assert.match(APP_CSS, /\.deity-desk__smite-cost img\s*\{[^}]*width:\s*0\.8rem[^}]*height:\s*0\.8rem/s,
      'the proper FLIP cost mark is large enough to read');
  });
});
