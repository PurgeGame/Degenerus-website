// /app/app/scroll-lock.js — Phase 63 D-03 Task 1 (MOB-02)
// iOS-correct body scroll-lock helper. Reference-counted so nested modals don't
// unlock prematurely. Saves body styles before mutation and restores on full unlock.
// Source: css-tricks.com canonical "position: fixed" pattern (verified Dec 2025) +
//         MDN overscroll-behavior. RESEARCH §Pattern 3 (lines 444-495).
// Verified pattern: SSR-safety mirrors wallet.js — typeof globalThis !== 'undefined' && globalThis.window.

let _refCount = 0;
let _savedScrollY = 0;
let _savedBodyTop = '';
let _savedBodyPosition = '';
let _savedBodyOverflow = '';
let _savedBodyWidth = '';

/**
 * Freeze background scroll while a modal is open.
 * Reference-counted: nested lock() calls stack; only the outermost unlock()
 * restores body styles + scroll position.
 *
 * SSR-safe: every window/document access is guarded so node:test importers
 * without a real DOM do not crash at module-load time or first invocation.
 */
export function lock() {
  _refCount += 1;
  if (_refCount > 1) return;   // already locked — outer modal still owns the freeze
  if (typeof globalThis === 'undefined' || !globalThis.window) return;
  if (typeof globalThis.document === 'undefined' || !globalThis.document.body) return;

  _savedScrollY = globalThis.window.scrollY || 0;
  const body = globalThis.document.body;
  // Stub-DOM safety: body.style may be missing under node:test fake DOMs.
  // Treat missing-style as "no styles to save/apply" — no-op without crashing.
  if (!body.style) return;
  _savedBodyTop = body.style.top || '';
  _savedBodyPosition = body.style.position || '';
  _savedBodyOverflow = body.style.overflow || '';
  _savedBodyWidth = body.style.width || '';

  body.style.top = `-${_savedScrollY}px`;
  body.style.position = 'fixed';
  body.style.overflow = 'hidden';
  body.style.width = '100%';
  // overscroll-behavior: contain on inner scrollables stops scroll-chaining
  // when the modal's scrollable region scrolls past its bounds. Set on the
  // modal's inner content via CSS, NOT here (helper is body-only).
}

/**
 * Restore background scroll after a modal closes. Pairs with lock().
 * No-op if called without a matching lock() (defensive: stray unlock from
 * disconnectedCallback after errors should not throw).
 */
export function unlock() {
  if (_refCount === 0) return;
  _refCount -= 1;
  if (_refCount > 0) return;   // outer modal still open — keep frozen
  if (typeof globalThis === 'undefined' || !globalThis.window) return;
  if (typeof globalThis.document === 'undefined' || !globalThis.document.body) return;

  const body = globalThis.document.body;
  if (!body.style) return;
  body.style.top = _savedBodyTop;
  body.style.position = _savedBodyPosition;
  body.style.overflow = _savedBodyOverflow;
  body.style.width = _savedBodyWidth;
  if (typeof globalThis.window.scrollTo === 'function') {
    globalThis.window.scrollTo(0, _savedScrollY);
  }
}

/**
 * Test-only: reset module-scope state so node:test cases can re-enter cleanly.
 * NOT for production consumers — all six module-scope vars revert to initial state.
 */
export function _resetForTest() {
  _refCount = 0;
  _savedScrollY = 0;
  _savedBodyTop = '';
  _savedBodyPosition = '';
  _savedBodyOverflow = '';
  _savedBodyWidth = '';
}
