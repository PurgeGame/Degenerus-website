// /app/app/__tests__/router.test.js — Phase 58 Plan 02 unit (DD-03).
//
// Run: cd website && node --test app/app/__tests__/router.test.js
//
// Covers:
//   - Cold-load: ?as= parsed, lowercased, validated against ADDR_RE
//   - Cold-load: missing/empty/invalid ?as= treated as absent (mode stays 'self')
//   - popstate: re-reads ?as= and updates viewing.address (or null)
//   - Subscribe-driven URL mirror: history.replaceState used (NEVER pushState)
//   - Subscribe-driven URL mirror: ?as= dropped when viewing equals connected
//   - Subscribe-driven URL mirror: no-op skip when URL already correct
//   - getViewedAddress re-export precedence

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// window stub (router.js touches window.location, window.history, window.addEventListener).
// Must land BEFORE the dynamic import of router.js so its module-init reads the stub.
// ---------------------------------------------------------------------------

let _location = { search: '', href: 'http://localhost/' };
let _replaceCalls = [];
let _pushCalls = [];
let _winListeners = new Map();

globalThis.window = {
  get location() { return _location; },
  set location(v) { _location = v; },
  history: {
    replaceState: (state, title, url) => {
      _replaceCalls.push({ state, title, url: String(url) });
      // Reflect into window.location.href + window.location.search
      try {
        const u = new URL(String(url), 'http://localhost/');
        _location.href = u.toString();
        _location.search = u.search;
      } catch {
        _location.href = String(url);
      }
    },
    pushState: (state, title, url) => {
      _pushCalls.push({ state, title, url: String(url) });
    },
  },
  addEventListener: (type, fn) => {
    if (!_winListeners.has(type)) _winListeners.set(type, []);
    _winListeners.get(type).push(fn);
  },
  removeEventListener: () => {},
};

// router.js does `new URL(window.location.href)` — Node has URL global. URLSearchParams too.
// Both available since Node 10+; we're on Node 22.

// ---------------------------------------------------------------------------
// Live store import (router.js uses real store via update/subscribe/get).
// ---------------------------------------------------------------------------

import * as storeMod from '../store.js';
import * as routerMod from '../router.js';

const { initRouter, getViewedAddress, __resetForTest: __resetRouter } = routerMod;

function setLocation(search) {
  _location = {
    search,
    href: 'http://localhost/' + (search ? search : ''),
  };
}

beforeEach(() => {
  storeMod.__resetForTest();
  __resetRouter();
  _replaceCalls = [];
  _pushCalls = [];
  _winListeners = new Map();
  setLocation('');
});

// ===========================================================================
// Cold-load ?as= handling
// ===========================================================================

describe('initRouter cold-load ?as=', () => {
  test("with no ?as= param does NOT update viewing.address", () => {
    setLocation('');
    initRouter();
    assert.equal(storeMod.get('viewing.address'), null);
    assert.equal(storeMod.get('ui.mode'), 'self');
  });

  test("with ?as=0xABCD...40chars sets viewing.address to lowercased value", () => {
    setLocation('?as=0xABCDef0000000000000000000000000000000001');
    initRouter();
    assert.equal(storeMod.get('viewing.address'), '0xabcdef0000000000000000000000000000000001');
    // mode auto-derives to 'view' (no connected.address)
    assert.equal(storeMod.get('ui.mode'), 'view');
  });

  test("with ?as=invalid-string treats as absent (viewing.address stays null, ui.mode stays 'self')", () => {
    setLocation('?as=not-an-address');
    initRouter();
    assert.equal(storeMod.get('viewing.address'), null);
    assert.equal(storeMod.get('ui.mode'), 'self');
  });

  test('with ?as=0xZZZ... (invalid hex) treats as absent', () => {
    setLocation('?as=0xZZZZ000000000000000000000000000000000000');
    initRouter();
    assert.equal(storeMod.get('viewing.address'), null);
  });

  test('with ?as= (empty) treats as absent', () => {
    setLocation('?as=');
    initRouter();
    assert.equal(storeMod.get('viewing.address'), null);
  });

  test('with ?as=0x...39chars (too short) treats as absent', () => {
    setLocation('?as=0xabcdef00000000000000000000000000000001');   // 39 hex
    initRouter();
    assert.equal(storeMod.get('viewing.address'), null);
  });

  test('with ?as=0x...41chars (too long) treats as absent', () => {
    setLocation('?as=0xabcdef00000000000000000000000000000000123');   // 41 hex
    initRouter();
    assert.equal(storeMod.get('viewing.address'), null);
  });
});

// ===========================================================================
// popstate handling
// ===========================================================================

describe('initRouter popstate', () => {
  test('popstate event re-reads ?as= and updates viewing.address', () => {
    setLocation('');
    initRouter();
    // Simulate user navigating via back/forward to /?as=0x...
    setLocation('?as=0xCCCC000000000000000000000000000000000003');
    const popHandlers = _winListeners.get('popstate') || [];
    assert.ok(popHandlers.length >= 1, 'popstate listener installed');
    popHandlers[0]({ type: 'popstate' });
    assert.equal(storeMod.get('viewing.address'), '0xcccc000000000000000000000000000000000003');
  });

  test('popstate with no ?as= sets viewing.address to null', () => {
    setLocation('?as=0xAAAA000000000000000000000000000000000001');
    initRouter();
    assert.equal(storeMod.get('viewing.address'), '0xaaaa000000000000000000000000000000000001');
    setLocation('');
    const popHandlers = _winListeners.get('popstate') || [];
    popHandlers[0]({ type: 'popstate' });
    assert.equal(storeMod.get('viewing.address'), null);
  });

  test('popstate with invalid ?as= sets viewing.address to null', () => {
    setLocation('?as=0xAAAA000000000000000000000000000000000001');
    initRouter();
    setLocation('?as=garbage');
    const popHandlers = _winListeners.get('popstate') || [];
    popHandlers[0]({ type: 'popstate' });
    assert.equal(storeMod.get('viewing.address'), null);
  });
});

// ===========================================================================
// Subscribe-driven URL mirror (store → URL)
// ===========================================================================

describe('subscribe-driven URL mirror', () => {
  test("update('viewing.address', '0xnew...') causes history.replaceState with ?as=0xnew...", () => {
    initRouter();
    _replaceCalls = [];
    storeMod.update('viewing.address', '0xdddd000000000000000000000000000000000004');
    assert.ok(_replaceCalls.length >= 1, 'replaceState called');
    const last = _replaceCalls[_replaceCalls.length - 1];
    assert.match(last.url, /[?&]as=0xdddd000000000000000000000000000000000004/);
  });

  test("update('viewing.address', null) causes history.replaceState removing ?as=", () => {
    setLocation('?as=0xeeee000000000000000000000000000000000005');
    initRouter();
    _replaceCalls = [];
    storeMod.update('viewing.address', null);
    assert.ok(_replaceCalls.length >= 1, 'replaceState called');
    const last = _replaceCalls[_replaceCalls.length - 1];
    assert.doesNotMatch(last.url, /[?&]as=/);
  });

  test('setting viewing.address EQUAL to connected.address removes ?as= (no view-mode for self-equal)', () => {
    storeMod.update('connected.address', '0xffff000000000000000000000000000000000006');
    initRouter();
    _replaceCalls = [];
    storeMod.update('viewing.address', '0xffff000000000000000000000000000000000006');
    // mode derives to 'self' (eq) → ?as= dropped
    assert.equal(storeMod.get('ui.mode'), 'self');
    if (_replaceCalls.length > 0) {
      const last = _replaceCalls[_replaceCalls.length - 1];
      assert.doesNotMatch(last.url, /[?&]as=/);
    }
    // No-op skip is also acceptable: if URL was already / (no ?as=), replaceState may be skipped.
  });

  test('replaceState used (NOT pushState) — assert history.pushState was NEVER called', () => {
    initRouter();
    storeMod.update('viewing.address', '0xaaaa000000000000000000000000000000000007');
    storeMod.update('viewing.address', '0xbbbb000000000000000000000000000000000008');
    storeMod.update('viewing.address', null);
    assert.equal(_pushCalls.length, 0, 'history.pushState NEVER called by router');
  });

  test('no-op skip — if URL already correct, do not call replaceState redundantly', () => {
    setLocation('?as=0xaaaa000000000000000000000000000000000009');
    initRouter();
    // initRouter may have synced URL via replaceState during cold-load; reset.
    _replaceCalls = [];
    // Updating viewing.address to the SAME value should NOT call replaceState.
    storeMod.update('viewing.address', '0xaaaa000000000000000000000000000000000009');
    assert.equal(_replaceCalls.length, 0, 'no redundant replaceState for same URL');
  });
});

// ===========================================================================
// getViewedAddress (re-exported helper)
// ===========================================================================

describe('getViewedAddress (router.js re-export)', () => {
  test('returns viewing.address when set', () => {
    storeMod.update('connected.address', '0xaaaa000000000000000000000000000000000001');
    storeMod.update('viewing.address', '0xbbbb000000000000000000000000000000000002');
    assert.equal(getViewedAddress(), '0xbbbb000000000000000000000000000000000002');
  });

  test('returns connected.address when viewing.address null', () => {
    storeMod.update('connected.address', '0xaaaa000000000000000000000000000000000001');
    assert.equal(getViewedAddress(), '0xaaaa000000000000000000000000000000000001');
  });

  test('returns null when both null', () => {
    assert.equal(getViewedAddress(), null);
  });
});
