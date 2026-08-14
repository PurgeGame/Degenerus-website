// /app/app/badge-sprite.js — one request for all 512 trait badges.
//
// A cold load was measured issuing hundreds of separate /badges-circular/ and
// /symbols/ *.svg requests as panels rendered ticket traits. The files are
// tiny (~4KB) and share structure, so both sets travel as ONE versioned JSON
// bundle (db/build-badge-bundle.mjs) that compresses to a fraction of its raw
// size.
//
// The design constraint is that every consumer sets `img.src` (several draw
// the badge onto a canvas), so badges must stay plain URLs — not inline
// <use> refs. The store therefore hands out same-origin blob: URLs minted
// from the bundle, and the two path builders (constants.js badgePath /
// dgn-traits.js dgnBadgePath) resolve through it transparently:
//
//   - before the bundle lands (or if it fails), callers get the real
//     /badges-circular/ file path — correct, individually cached, just an
//     extra request. First-paint badges deliberately take this lane so the
//     bundle never competes with the critical UI.
//   - after it lands, every new badge render is answered locally.
//
// main.js warms the store on idle after boot. Object URLs are minted lazily
// per badge and kept for the page's lifetime (256 × ~4KB worst case), so
// repeated renders reuse one URL and the browser's decoded-image cache.

const BUNDLE_URL = '/app/assets/badge-bundle-v1.json';
const PATH_RE = /^\/(badges-circular|symbols)\/([^/]+)\.svg$/;

let _svgs = null;         // stem -> raw SVG text, null until the bundle lands
let _urls = new Map();    // file path -> minted blob URL
let _warmPromise = null;

/** Fetch the bundle once, in the background. Safe to call repeatedly. */
export function warmBadgeStore() {
  if (_warmPromise) return _warmPromise;
  if (typeof fetch !== 'function' || typeof Blob === 'undefined'
      || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve();
  }
  _warmPromise = fetch(BUNDLE_URL)
    .then((response) => (response.ok ? response.json() : null))
    .then((json) => {
      if (json && typeof json === 'object') _svgs = json;
      // A transient failure (non-OK, SPA-fallback HTML) must not pin the
      // store dead for the page's lifetime — clear so a later call retries.
      else _warmPromise = null;
    })
    .catch(() => { _warmPromise = null; /* the per-file lane keeps working */ });
  return _warmPromise;
}

/**
 * Map a /badges-circular/ or /symbols/ file path to its local blob URL when
 * the bundle is ready; otherwise return the path unchanged. Sync by design —
 * the path builders call this inline.
 */
export function resolveBadgeUrl(path) {
  if (!_svgs) return path;
  const minted = _urls.get(path);
  if (minted) return minted;
  const match = PATH_RE.exec(path);
  const svg = match ? _svgs[`${match[1]}/${match[2]}`] : undefined;
  if (typeof svg !== 'string') return path;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  _urls.set(path, url);
  return url;
}

/** Test seams. */
export function __setBadgeBundleForTest(bundle) {
  _svgs = bundle && typeof bundle === 'object' ? bundle : null;
  for (const url of _urls.values()) {
    try { URL.revokeObjectURL(url); } catch { /* non-browser test env */ }
  }
  _urls = new Map();
  _warmPromise = null;
}
