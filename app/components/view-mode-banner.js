// /app/components/view-mode-banner.js — Phase 58 Plan 04 view-mode UX layer (DD-02).
//
// Two responsibilities, both module-init (no Custom Element wrapper — operates
// on the existing #view-mode-banner placeholder shipped in Phase 56 + every
// [data-write] button in the document):
//
//   1. Banner visibility + copy — toggles the `hidden` attribute on the
//      #view-mode-banner element and sets its .view-mode-banner__text content
//      based on ui.mode, one of three variants (account-switcher extension,
//      2026-07-16):
//        'view'     → "Viewing read-only" (unchanged copy)
//        'operator' → "Acting for 0xab…cd, approved operator"
//        'combined' → "Combined view across N accounts. Read-only."
//      Wires the CTA button: in 'view'/'operator' it reads "Back to my account"
//      and clears viewing.address; in 'combined' it reads "Exit combined view"
//      and clears viewing.combined. Both land on 'self' via store.js's
//      deriveMode subscriber (mode is a function of viewing.address/.combined).
//
//   2. [data-write] disable manager — every Phase 60+ tx-bearing button MUST
//      tag itself with `data-write`. This module subscribes to ui.mode AND
//      ui.chainOk AND connected.address; whenever any of those change, it
//      walks every [data-write] element in the document and sets:
//        disabled = !canSign
//        title    = canSign ? '' : 'Connect to your own wallet to act'
//      A MutationObserver covers Phase 60+ panels that mount [data-write]
//      buttons after this module's init. Operator mode is writable
//      (deriveCanSign() includes it — see store.js), so this manager leaves
//      [data-write] buttons ENABLED in 'operator' the same as 'self'.
//
// RESEARCH §Pattern 4 layer 1 — UX layer, NOT the safety property. The
// architectural cut is requireSelf() in /app/app/contracts.js (plan 58-01),
// which throws BEFORE provider.getSigner() on every write. A devtools-enabled
// button still throws at the chokepoint before the wallet popup. This module
// is the UX layer that makes the impossibility visible to honest users.
//
// NOTE: #view-mode-banner was removed from app/index.html's markup (user call:
// "we don't need the read only thing" — basic-mode layout). setupBanner()
// null-guards the lookup and no-ops when the element is absent, so this
// module stays code-complete (and immediately useful again if the banner
// element is ever remounted, e.g., for THE PIT) without requiring an
// index.html change here.

import { subscribe, update, get, deriveCanSign } from '../app/store.js';

const DISABLED_TOOLTIP = 'Connect to your own wallet to act';
const BANNER_ID = 'view-mode-banner';
const BANNER_TEXT_SELECTOR = '.view-mode-banner__text';
const BANNER_CTA_SELECTOR = '.view-mode-banner__cta';

/** Abbreviate a 0x address as "0xab…cd" (first 4 chars incl. 0x, last 2). */
function _abbrev(addr) {
  if (typeof addr !== 'string' || addr.length < 8) return addr || '';
  return `${addr.slice(0, 4)}…${addr.slice(-2)}`;
}

/**
 * _bannerCopy — the three-variant text + CTA label for the current mode.
 * 'self' is never rendered (the banner is hidden), but returns a harmless
 * default so callers never touch undefined.
 */
function _bannerCopy(mode) {
  if (mode === 'operator') {
    const viewing = get('viewing.address');
    return {
      text: `Acting for ${_abbrev(viewing)}, approved operator`,
      cta: 'Back to my account',
    };
  }
  if (mode === 'combined') {
    const approvals = Array.isArray(get('approvals.list')) ? get('approvals.list') : [];
    const n = approvals.length + 1; // + the connected wallet itself
    return {
      text: `Combined view across ${n} accounts. Read-only.`,
      cta: 'Exit combined view',
    };
  }
  return { text: 'Viewing read-only', cta: 'Back to my account' };
}

// ---------------------------------------------------------------------------
// Banner visibility manager.
//
// Idempotency: subscribers + click listener are installed at most once per
// process lifetime. Repeated calls are no-ops. Tests reset via
// __resetForTest() below (which also tears down the data-write manager).
// ---------------------------------------------------------------------------

let _bannerSetupDone = false;
const _bannerUnsubs = [];

export function setupBanner() {
  if (_bannerSetupDone) return;
  if (typeof document === 'undefined') return;
  const banner = document.getElementById(BANNER_ID);
  if (!banner) return;
  _bannerSetupDone = true;

  // Visibility + copy — hidden only in 'self'; visible for 'view' / 'operator' /
  // 'combined', each with its own text + CTA label (_bannerCopy). We look up the
  // banner inside the callback so a Phase 60+ re-render that swaps the
  // #view-mode-banner element does not leave us writing to a detached node
  // (WR-07). Re-renders on ui.mode (the visibility + variant switch) AND on
  // viewing.address / approvals.list so the abbreviated operator address / the
  // combined account count stay live without a mode flip (e.g., an approver
  // revoking access mid-session, or a late approvals.list arrival changing N).
  const renderBanner = () => {
    const b = (typeof document !== 'undefined') ? document.getElementById(BANNER_ID) : null;
    if (!b) return;
    const mode = get('ui.mode');
    b.hidden = (mode === 'self');
    const { text, cta } = _bannerCopy(mode);
    const textEl = b.querySelector(BANNER_TEXT_SELECTOR);
    if (textEl) textEl.textContent = text;
    const ctaEl = b.querySelector(BANNER_CTA_SELECTOR);
    if (ctaEl) ctaEl.textContent = cta;
  };
  _bannerUnsubs.push(subscribe('ui.mode', renderBanner));
  _bannerUnsubs.push(subscribe('viewing.address', renderBanner));
  _bannerUnsubs.push(subscribe('approvals.list', renderBanner));

  // Wire the CTA. Its action depends on the mode AT CLICK TIME: 'combined'
  // clears viewing.combined (the switcher's mutually-exclusive counterpart to
  // viewing.address); 'view'/'operator' clear viewing.address (unchanged).
  // Either write lands on 'self' via store.js's deriveMode subscriber on the
  // next microtask; router.js's URL mirror drops ?as= via its own
  // subscribe('viewing.address') subscriber.
  const cta = banner.querySelector(BANNER_CTA_SELECTOR);
  if (cta) {
    cta.addEventListener('click', () => {
      if (get('ui.mode') === 'combined') {
        update('viewing.combined', false);
      } else {
        update('viewing.address', null);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// [data-write] disable manager.
// ---------------------------------------------------------------------------

/**
 * refreshDataWriteButtons — walk every [data-write] in the document and
 * toggle disabled + title based on the current canSign value.
 *
 * canSign === true  → enabled unless the owning component set
 *                     data-write-locked for a domain-state reason
 * canSign === false → disabled, title='Connect to your own wallet to act'
 */
export function refreshDataWriteButtons() {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  const canSign = deriveCanSign();
  const buttons = document.querySelectorAll('[data-write]');
  if (!buttons || typeof buttons.forEach !== 'function') return;
  buttons.forEach((btn) => {
    const domainLocked = typeof btn.getAttribute === 'function'
      && btn.getAttribute('data-write-locked') != null;
    if (canSign && !domainLocked) {
      btn.disabled = false;
      // Clear tooltip — set to empty string AND removeAttribute for max compatibility.
      btn.title = '';
      if (typeof btn.removeAttribute === 'function') {
        btn.removeAttribute('title');
      }
      if (typeof btn.setAttribute === 'function') {
        btn.setAttribute('aria-disabled', 'false');
      }
    } else {
      btn.disabled = true;
      const lockedTitle = domainLocked && typeof btn.getAttribute === 'function'
        ? btn.getAttribute('data-write-lock-title')
        : null;
      btn.title = canSign && lockedTitle ? lockedTitle : DISABLED_TOOLTIP;
      if (typeof btn.setAttribute === 'function') {
        btn.setAttribute('aria-disabled', 'true');
      }
    }
  });
}

// Idempotency: subscribers + MutationObserver are installed at most once per
// process lifetime. Repeated calls are no-ops. Tests reset via
// __resetForTest() below.
let _dataWriteSetupDone = false;
const _dataWriteUnsubs = [];
let _dataWriteObserver = null;

export function setupDataWriteManager() {
  if (_dataWriteSetupDone) return;
  _dataWriteSetupDone = true;

  // Initial pass — Phase 58 ships zero [data-write] buttons; Phase 60+ panels
  // will mount them. Safe to run regardless.
  refreshDataWriteButtons();

  // Re-evaluate whenever any input to canSign changes. subscribe() fires
  // immediately with current value, so each call kicks off an initial refresh
  // (idempotent — the same end-state is computed each time).
  _dataWriteUnsubs.push(subscribe('ui.mode', refreshDataWriteButtons));
  _dataWriteUnsubs.push(subscribe('ui.chainOk', refreshDataWriteButtons));
  _dataWriteUnsubs.push(subscribe('connected.address', refreshDataWriteButtons));

  // MutationObserver: when Phase 60+ panels mount [data-write] buttons after
  // this module's init, refresh them too.
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
    _dataWriteObserver = new MutationObserver((mutations) => {
      // WR-11: refresh on BOTH addition and removal. Removed [data-write]
      // buttons can't be clicked, but the manager's internal model would
      // otherwise drift from the DOM (callers calling document.querySelectorAll
      // see fewer buttons than the manager expected). A refresh on removal is
      // cheap (re-walks the live tree) and keeps state consistent.
      let needsRefresh = false;
      const isWriteNode = (node) => {
        if (!node || node.nodeType !== 1) return false;
        return (typeof node.matches === 'function' && node.matches('[data-write]'))
          || (typeof node.querySelector === 'function' && Boolean(node.querySelector('[data-write]')));
      };
      for (const m of mutations) {
        const added = (m && m.addedNodes) || [];
        for (const node of added) {
          if (isWriteNode(node)) { needsRefresh = true; break; }
        }
        if (needsRefresh) break;
        const removed = (m && m.removedNodes) || [];
        for (const node of removed) {
          if (isWriteNode(node)) { needsRefresh = true; break; }
        }
        if (needsRefresh) break;
      }
      if (needsRefresh) refreshDataWriteButtons();
    });
    try {
      _dataWriteObserver.observe(document.body, { childList: true, subtree: true });
    } catch { /* swallow — non-DOM env */ }
  }
}

// ---------------------------------------------------------------------------
// Test-only reset — tears down both managers so a fresh setup* call
// re-installs subscribers against the post-__resetForTest store registry.
// NOT for production consumers.
// ---------------------------------------------------------------------------

export function __resetForTest() {
  for (const u of _bannerUnsubs) {
    try { u(); } catch { /* swallow */ }
  }
  _bannerUnsubs.length = 0;
  _bannerSetupDone = false;

  for (const u of _dataWriteUnsubs) {
    try { u(); } catch { /* swallow */ }
  }
  _dataWriteUnsubs.length = 0;
  if (_dataWriteObserver && typeof _dataWriteObserver.disconnect === 'function') {
    try { _dataWriteObserver.disconnect(); } catch { /* swallow */ }
  }
  _dataWriteObserver = null;
  _dataWriteSetupDone = false;
}

// ---------------------------------------------------------------------------
// Module-init wrapper — defer until DOM ready.
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') {
  const init = () => {
    setupBanner();
    setupDataWriteManager();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
