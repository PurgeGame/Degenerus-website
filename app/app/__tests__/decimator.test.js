// /app/app/__tests__/decimator.test.js — Phase 62 Plan 62-01 (BUY-01)
// Run: cd website && node --test app/app/__tests__/decimator.test.js
//
// decimator.js is a thin re-export module — it re-exports purchaseEth and
// purchaseCoin from Phase 60's lootbox.js. This file verifies the re-export
// shape and asserts NO new sendTx call sites + NO new reason-map register()
// calls (Phase 60 already registered GameOverPossible / AfKingLockActive /
// NotApproved on lootbox.js eager import; re-export inherits them for free).
//
// CONTEXT D-01..D-08 LOCKED + RESEARCH Example 1 (BUY-01 = purchase() call,
// SAME on-chain surface as Phase 60 LBX-01).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as decimatorMod from '../decimator.js';
import * as lootboxMod from '../lootbox.js';

const DECIMATOR_SRC = readFileSync(
  new URL('../decimator.js', import.meta.url),
  'utf8',
);

describe('Plan 62-01: decimator.js re-export module', () => {
  test('Module re-exports purchaseEth from lootbox.js (same function reference)', () => {
    assert.equal(
      typeof decimatorMod.purchaseEth,
      'function',
      'purchaseEth is exported as a function',
    );
    assert.ok(
      Object.is(decimatorMod.purchaseEth, lootboxMod.purchaseEth),
      'decimator.purchaseEth IS the same function reference as lootbox.purchaseEth',
    );
    // Source-level grep: re-export from './lootbox.js' is required by CONTEXT
    // D-01 + RESEARCH Example 1 — re-export model preserves Phase 60's
    // closure-form sendTx + requireStaticCall + reason-map registrations.
    assert.match(
      DECIMATOR_SRC,
      /export\s*\{[^}]*purchaseEth[^}]*\}\s*from\s*['"]\.\/lootbox\.js['"]/,
      're-export statement from ./lootbox.js present',
    );
  });

  test('Module re-exports purchaseCoin from lootbox.js (same function reference)', () => {
    assert.equal(
      typeof decimatorMod.purchaseCoin,
      'function',
      'purchaseCoin is exported as a function',
    );
    assert.ok(
      Object.is(decimatorMod.purchaseCoin, lootboxMod.purchaseCoin),
      'decimator.purchaseCoin IS the same function reference as lootbox.purchaseCoin',
    );
    assert.match(
      DECIMATOR_SRC,
      /export\s*\{[^}]*purchaseCoin[^}]*\}\s*from\s*['"]\.\/lootbox\.js['"]/,
      're-export statement (purchaseCoin) from ./lootbox.js present',
    );
  });

  test('decimator.js source contains NO new register() calls (CF-02)', () => {
    // Phase 60 already registered GameOverPossible / AfKingLockActive /
    // NotApproved on lootbox.js eager import; re-export inherits them.
    // Plan 62-01 adds NO new reason-map registrations.
    // Strip line + block comments before scanning so reference mentions in
    // documentation don't trigger a false positive.
    const code = DECIMATOR_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/^\s*\/\/.*$/gm, '');       // line comments
    const matches = code.match(/\bregister\s*\(/g) || [];
    assert.equal(
      matches.length,
      0,
      'decimator.js MUST NOT contain register() calls (in code) — re-export inherits Phase 60 reason-map',
    );
  });

  test('decimator.js source contains NO sendTx call sites (CF-01 closure-form gate)', () => {
    // Re-export model — decimator.js has zero direct write surfaces. Every
    // write tx flows through Phase 60's lootbox.js sendTx closure-form chokepoint.
    // Strip comments first (same rationale as register() check).
    const code = DECIMATOR_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const matches = code.match(/\bsendTx\s*\(/g) || [];
    assert.equal(
      matches.length,
      0,
      'decimator.js MUST NOT contain sendTx calls (in code) — re-export only',
    );
  });
});
