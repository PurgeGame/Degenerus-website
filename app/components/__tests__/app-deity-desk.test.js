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
const { boonTypePresentation } = await import('../../app/boons.js');
const {
  fetchPlayerSuggestions,
  filterPlayerSuggestions,
  isDiscordSnowflake,
  resolvePlayerTarget,
} = await import('../../app/player-target.js');
const { deityBoonActionLabel, deityDeskModel } = await import('../app-deity-desk.js');

const DESK_SRC = readFileSync(new URL('../app-deity-desk.js', import.meta.url), 'utf8');
const PASS_SRC = readFileSync(new URL('../app-pass-section.js', import.meta.url), 'utf8');
const INDEX_HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');

describe('<app-deity-desk>', () => {
  test('active holders retain the Deity Pass wordmark beside their chosen symbol', () => {
    assert.match(DESK_SRC,
      /class="deity-pass-lockup deity-desk__wordmark"[\s\S]*?data-bind="deity-desk-symbol"[\s\S]*?deity-pass-lockup-v3\.png/);
    assert.match(APP_CSS, /\.deity-desk__wordmark\s*\{[^}]*width:\s*min\(11\.2rem, 100%\)/s);
  });

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

  test('uses the shared colored arrow with native badges where they exist', () => {
    assert.equal(boonTypePresentation(7).icon, null);
    assert.equal(boonTypePresentation(4).icon,
      '/app/assets/boons/boon-quest-micro.svg',
      'the shield choice carries the shield mark rather than an arrow');
    assert.equal(boonTypePresentation(24).icon,
      '/badges-circular/crypto_06_ethereum_green.svg',
      'a pass cost reduction carries the green ETH badge');
    assert.equal(boonTypePresentation(32).icon,
      '/badges-circular/crypto_06_ethereum_green.svg');
    assert.equal(boonTypePresentation(36).icon,
      '/whitepaper/flame-logo-split.svg');
    assert.equal(boonTypePresentation(40).icon,
      '/shared/coinflip-face-red.svg');
    assert.match(DESK_SRC, /icon\.src = presentation\.icon/,
      'the desk consumes the canonical boon presentation instead of a local icon table');
    assert.match(DESK_SRC, /mark\.hidden = !presentation/,
      'the colored arrow remains visible when its contextual product needs no duplicate logo');
    assert.match(DESK_SRC, /class="deity-desk__boon-mark"/,
      'each slot has the same amount-colored arrow used by active boosts');
    assert.match(APP_CSS,
      /\.deity-desk__boon-mark::before\s*\{[^}]*var\(--boon-amount[^}]*clip-path:\s*polygon\(/s,
      'the arrow itself carries the green, blue, or purple amount tier');
    assert.match(APP_CSS,
      /\.deity-desk__boon-icon\s*\{[^}]*width:\s*1\.1rem;[^}]*height:\s*1\.1rem;[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
      'native badges sit directly on the arrow without a generic icon box');
    assert.match(APP_CSS,
      /button\[data-boon-direction="down"\] \.deity-desk__boon-mark::before\s*\{[^}]*rotate\(180deg\)/s,
      'pass discounts turn only the arrow down while native logos remain upright');
    assert.match(APP_CSS,
      /button\[data-boon-direction="down"\]\s*\{[^}]*--boon-amount:\s*#ef4444/s,
      'pass cost reductions use the dedicated red down-arrow language');
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

  test('suggests linked Discord players by name without exposing their snowflake', async () => {
    const burnie = '0xcd34000000000000000000000000000000000000';
    const rows = [
      {
        eth_address: burnie,
        discord_name: 'Burnie Degenerus',
        discord_avatar: 'https://cdn.discordapp.com/burnie.png',
        discord_id: '123456789012345678',
      },
      {
        eth_address: '0xab12000000000000000000000000000000000000',
        discord_name: 'WAR',
        discord_avatar: 'javascript:alert(1)',
      },
    ];
    assert.deepEqual(filterPlayerSuggestions(rows, '@burn'), [{
      address: '0xCd34000000000000000000000000000000000000',
      name: 'Burnie Degenerus',
      avatar: 'https://cdn.discordapp.com/burnie.png',
    }]);

    let request = null;
    const suggestions = await fetchPlayerSuggestions('war', {
      baseUrl: 'https://session.example',
      fetcher: async (url, init) => {
        request = { url, init };
        return { ok: true, json: async () => ({ leaderboard: rows }) };
      },
    });
    assert.equal(request.url, 'https://session.example/api/leaderboard?limit=50');
    assert.equal(request.init.credentials, 'omit');
    assert.deepEqual(suggestions, [{
      address: '0xAB12000000000000000000000000000000000000',
      name: 'WAR',
      avatar: null,
    }]);
    assert.equal(Object.hasOwn(suggestions[0], 'discord_id'), false);
  });

  test('mounts the compact four-action desk above Tickets and removes the old controls', () => {
    assert.ok(INDEX_HTML.indexOf('<app-deity-desk>') < INDEX_HTML.indexOf('<app-tickets-inventory>'));
    assert.match(DESK_SRC, />TARGET PLAYER<\/label>/);
    assert.match(DESK_SRC,
      /class="deity-desk__target-head"[\s\S]*?TARGET PLAYER[\s\S]*?data-bind="deity-desk-feedback"[\s\S]*?class="deity-desk__target-control"/,
      'transaction feedback shares the fixed header immediately above the wallet field');
    assert.match(APP_CSS,
      /\.deity-desk__target-head\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\)[^}]*min-height:/s,
      'the target header reserves one row so feedback cannot grow the desk');
    assert.match(APP_CSS,
      /\.deity-desk__feedback\s*\{[^}]*overflow:\s*hidden[^}]*text-align:\s*right[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
      'long status or error copy stays in the compact right-hand lane');
    assert.match(DESK_SRC, /placeholder="Wallet, Discord ID, or @name"/);
    assert.match(DESK_SRC, /role="combobox"[^>]*aria-autocomplete="list"/);
    assert.match(DESK_SRC, /fetchPlayerSuggestions\(query/);
    assert.match(DESK_SRC, /input\.dataset\.targetAddress = address/,
      'choosing a Discord name preserves its verified linked wallet beneath the display name');
    assert.match(DESK_SRC, /resolvePlayerTarget\(input\?\.dataset\?\.targetAddress \|\| input\?\.value\)/);
    assert.match(DESK_SRC, /\[0, 1, 2\]\.map/);
    assert.match(DESK_SRC, /data-bind="deity-desk-smite"/);
    assert.match(DESK_SRC, />SMITE</);
    assert.match(DESK_SRC, /<strong>-2 DEGEN RATING<\/strong>/);
    assert.match(DESK_SRC, /deity-desk__smite-cost">COST:<img src="\/whitepaper\/flame-logo-split\.svg" alt="FLIP">200/);
    assert.ok(
      DESK_SRC.indexOf('data-bind="deity-desk-smite"')
        < DESK_SRC.indexOf('data-bind="deity-desk-boon-${slot}"'),
      'smite is the top-left action before the three boon cards',
    );
    assert.doesNotMatch(DESK_SRC, />CURSE<|Curse confirmed|deity-curse/);
    assert.equal(deityBoonActionLabel({ name: 'Tickets' }, 0), 'Tickets BOON');
    assert.equal(deityBoonActionLabel({ product: 'degenerette-eth', name: 'ETH Degenerette' }, 0),
      'DEGENERETTE BOON');
    assert.equal(deityBoonActionLabel({ product: 'degenerette-flip', name: 'FLIP Degenerette' }, 1),
      'DEGENERETTE BOON');
    assert.equal(deityBoonActionLabel({ product: 'degenerette-wwxrp', name: 'WWXRP Degenerette' }, 2),
      'DEGENERETTE BOON');
    assert.equal(deityBoonActionLabel({ name: 'Mystery boon' }, 1), 'Mystery boon');
    assert.match(DESK_SRC, /issueDeityBoon\(\{ recipient: target, slot: action \}\)/);
    assert.match(DESK_SRC, /smiteWithDeity\(\{ deityId: model\.symbolId, target \}\)/);
    assert.doesNotMatch(DESK_SRC, /deity-desk-status|DAY \$\{this\.#boonState\.day\}/,
      'the identity side contains no day or RNG status copy');
    assert.doesNotMatch(PASS_SRC, /data-bind="pass-deity-(?:boons|curse)"/);
    assert.match(APP_CSS, /\.deity-desk__actions\s*\{[^}]*repeat\(4,/s);
    assert.match(APP_CSS,
      /boon-product-indicator::before,[\s\S]*?\.boon-badge__mark::before,[\s\S]*?\.rvl-card--boon \.rvl-card-icon::before,[\s\S]*?\.deity-desk__boon-mark::before\s*\{[^}]*drop-shadow\([^)]*--boon-amount-rgb[^}]*drop-shadow\([^)]*--boon-amount-rgb/s,
      'every shared boon arrow gets a restrained colored core and outer halo');
    assert.match(DESK_SRC, /data-boon-product/,
      'daily boon buttons carry their affected product for color coding');
    assert.match(DESK_SRC, /deity-desk__boon-icon/,
      'each daily boon choice carries its product-specific icon');
    assert.match(DESK_SRC,
      /deity-desk__boon-mark deity-desk__smite-mark[\s\S]*?deity-desk__boon-icon deity-desk__smite-icon[\s\S]*?smite-crash-bolt-down\.svg/,
      'Smite uses a dedicated lightning-bolt-shaped crash arrow without a character');
    assert.match(APP_CSS,
      /\.deity-desk__actions\s*\{[^}]*--deity-action-arrow-size:\s*2\.42rem/s,
      'the roomy action row defines one larger arrow size');
    assert.match(APP_CSS,
      /\.deity-desk__boon-mark\s*\{[^}]*width:\s*var\(--deity-action-arrow-size\)[^}]*height:\s*var\(--deity-action-arrow-size\)/s,
      'up arrows consume the shared size');
    assert.match(DESK_SRC,
      /deity-desk__smite"[^>]*data-boon-direction="down"[^>]*data-boon-strength="low"/,
      'Smite enters the same direction and tier pipeline as every other arrow');
    assert.match(APP_CSS,
      /\.deity-desk__smite-mark\s*\{[^}]*width:\s*2\.86rem;[^}]*height:\s*2\.86rem/s,
      'the crash-arrow character gets enough room to remain legible at button scale');
    assert.match(APP_CSS,
      /\.deity-desk__smite-mark::before\s*\{[^}]*display:\s*none/s,
      'the generic boon arrow does not sit behind the dedicated Smite artwork');
    assert.match(APP_CSS,
      /button\.deity-desk__smite \.deity-desk__smite-icon\s*\{[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*translate:\s*none/s,
      'the lightning crash arrow fills the complete Smite mark');
    assert.match(DESK_SRC, /data-boon-strength/,
      'each daily boon choice carries its relative amount tier');
    assert.match(APP_CSS, /\.deity-desk__actions button\s*\{[^}]*min-height:\s*3\.05rem/s,
      'daily boon buttons have a larger action target');
    assert.match(APP_CSS,
      /\.deity-desk__smite strong\s*\{[^}]*font-size:\s*clamp\(0\.68rem, 0\.9vw, 0\.76rem\);[^}]*text-wrap:\s*balance;[^}]*white-space:\s*normal/s,
      'the larger -2 DEGEN RATING result wraps rather than clipping in a narrow card');
    // The product name labels; the effect is the payload. The name was sized
    // down so it stops truncating ("LUCKBOX BO…") and the effect leads.
    const boonName = APP_CSS.match(/\.deity-desk__actions button span\s*\{[^}]*font:\s*\d+ ([\d.]+)rem/s);
    const boonEffect = APP_CSS.match(/\.deity-desk__actions button strong\s*\{[^}]*font:\s*\d+ ([\d.]+)rem/s);
    assert.ok(boonName && boonEffect, 'both boon type sizes are declared');
    assert.ok(Number(boonEffect[1]) > Number(boonName[1]),
      'the boon effect outweighs its product label');
    const boonNameRule = APP_CSS.match(/\.deity-desk__actions button span\s*\{[^}]*\}/s)?.[0] || '';
    assert.doesNotMatch(boonNameRule, /text-overflow:\s*ellipsis|white-space:\s*nowrap/,
      'Deity boon titles wrap cleanly instead of ever becoming an ellipsis');
    assert.match(APP_CSS, /\.deity-desk__actions button\[data-boon-product="decimator"\]/,
      'boon buttons use product-specific color treatments');
    assert.match(DESK_SRC, /deity-pass-lockup__symbol" data-bind="deity-desk-symbol"/,
      'the owned symbol occupies the branded pass socket');
    assert.match(APP_CSS,
      /\.deity-pass-lockup__symbol\s*\{[^}]*left:\s*4\.86%[^}]*top:\s*15\.31%[^}]*width:\s*16%[^}]*height:\s*70%/s,
      'every Deity surface shares the measured transparent symbol opening');
    assert.match(APP_CSS, /\.deity-desk__suggestions\s*\{[^}]*position:\s*absolute[^}]*max-height:/s,
      'Discord matches open as a bounded dropdown beneath the target field');
    assert.doesNotMatch(APP_CSS, /\.deity-desk__actions button::after\s*\{[^}]*attr\(data-boon-pips\)/s,
      'tier color replaces the redundant amount-strength pips');
    assert.match(APP_CSS, /\.deity-desk__smite-cost\s*\{[^}]*position:\s*absolute[^}]*right:\s*0\.54rem[^}]*bottom:\s*0\.2rem[^}]*font:\s*950 0\.5rem/s,
      'Smite leaves its name on the first line and moves a larger FLIP cost to the bottom-right');
    assert.match(APP_CSS, /\.deity-desk__smite-cost img\s*\{[^}]*width:\s*0\.8rem[^}]*height:\s*0\.8rem/s,
      'the proper FLIP cost mark is large enough to read');
  });
});
