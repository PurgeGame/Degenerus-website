import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const COMPONENT = readFileSync(new URL('../app-referral-input.js', import.meta.url), 'utf8');
const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
const NAV = readFileSync(new URL('../../../shared/nav.js', import.meta.url), 'utf8');

test('referral input is unbranded while the far-left Degenerus lockup keeps its flame', () => {
  assert.doesNotMatch(COMPONENT, /app-referral-input__logo|<img/,
    'the referral-code pill contains only its input');
  assert.match(NAV, /currentPage === 'app'[\s\S]{0,180}\/whitepaper\/flame-logo\.svg/,
    'the app nav uses the same unmistakable round protocol logo as onboarding');
  assert.match(NAV, /<span class="nav-wordmark">DEGENERUS<\/span>/,
    'the app logo and explicit wordmark render as one reliable lockup');
  assert.match(APP_CSS,
    /\.nav-left > a\[href="\/"\]\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center/s,
    'the flame and DEGENERUS wordmark form the far-left lockup');
  assert.match(APP_CSS,
    /\.nav-left > a\[href="\/"\] \.nav-logo\s*\{[^}]*width:\s*1\.3rem[^}]*height:\s*1\.3rem/s,
    'the flame is approximately the wordmark cap height, not a large nav badge');
});

test('every app-nav oval uses one shared height', () => {
  assert.match(APP_CSS, /--app-nav-pill-height:\s*2rem/);
  assert.match(APP_CSS,
    /\.unav-day,\s*body\.layout-basic \.app-referral-input,\s*body\.layout-basic \.nav-jackpot-countdown,\s*body\.layout-basic \.nav-auth \.nav-btn\s*\{[^}]*height:\s*var\(--app-nav-pill-height\)[^}]*min-height:\s*var\(--app-nav-pill-height\)/s,
    'day, countdown, referral, Discord, and wallet pills share exact geometry');
});

test('an indexed contract assignment hides the field independently of saved browser code', () => {
  assert.match(COMPONENT,
    /function dashboardHasReferralAssignment[\s\S]*hasOwnProperty\.call\(affiliate, 'referrer'\)[\s\S]*0x0000000000000000000000000000000000000000/s,
    'a ReferralUpdated row distinguishes an assigned contract slot from a new wallet');
});

test('visibility combines the direct real-referrer read with the indexed assignment row', () => {
  assert.match(COMPONENT, /Promise\.allSettled\(\[[\s\S]*readPlayerReferrer\(player\)[\s\S]*fetchJSON\(`\/player\//s);
  assert.match(COMPONENT, /Boolean\(realReferrer\)\s*\|\|\s*indexedAssignment/);
  assert.match(COMPONENT,
    /root\.hidden\s*=\s*true;[\s\S]*confirmedUnassigned[\s\S]*else if \(confirmedUnassigned\)[\s\S]*_root\.hidden\s*=\s*false/s,
    'the field starts hidden and appears only after both assignment reads confirm an open slot');
  assert.match(COMPONENT, /VISIBILITY_POLL_MS\s*=\s*15_000/,
    'a post-purchase assignment is picked up even when its purchase surface has no custom event');
});
