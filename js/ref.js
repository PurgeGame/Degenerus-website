// ref.js — site-wide affiliate referral capture (first touch).
//
// Any page loaded with ?ref=<code> stores the code so the app can use it as
// the visitor's default affiliate code at purchase time. Accepted formats:
//   0x + 40 hex — a plain ETH address. Every address is its own default code
//                 (DegenerusAffiliate._resolveCodeOwner resolves any bytes32
//                 value <= uint160.max to that address); left-padded to bytes32.
//   0x + 64 hex — an already-encoded bytes32 code (padded address or a
//                 registered vanity code, e.g. from buildAffiliateUrl).
//   name.eth    — an ENS name (subdomains fine). Resolved on-chain at capture
//                 time to its address record and stored as the padded address,
//                 identical to the 40-hex path from that point on.
// Typed vanity strings (?ref=DEGEN) are deliberately NOT accepted: purchasing
// with an unregistered code permanently locks the buyer's referrer slot to
// no-referrer, so only exact on-chain-safe formats are captured. ENS names are
// NEVER interpreted as vanity codes (a squatter could register the string
// on-chain first-come-first-served without owning the name); registered vanity
// codes are reachable only as explicit 64-hex links.
//
// ENS safety rules (an unresolved or half-failed capture must never cost an
// affiliate attribution, and must never store garbage):
//   - resolve BEFORE store; only a confirmed nonzero address record is stored
//   - an existing first-touch ref is never overwritten (re-checked after the
//     async resolve completes, so a slow resolve can't clobber a newer visit)
//   - definitive negatives (no resolver set / zero address) store nothing
//   - transient failures (all RPCs unreachable) stash the name in
//     sessionStorage and retry once on the next page load in this tab
//   - hex refs never touch the network; ENS resolution is async and the page
//     never blocks or breaks on it (older browsers without BigInt simply skip)
//   - only ASCII lowercase [a-z0-9_-] labels are supported; exotic unicode
//     names must share their plain address link instead
//
// Storage (first touch wins — attribution is lifetime, not last-click):
//   cookie       dgn_ref=<bytes32hex>; 2 years; path=/
//   localStorage 'affiliate-ref' (mirror; survives cookie clears and vice versa)
// Consumed by app/app/lootbox.js readAffiliateCode() as the fallback when the
// connected wallet has no chain-scoped code persisted.
(function () {
  var B32 = /^0x[0-9a-f]{64}$/;
  var ENS_RE = /^([a-z0-9_-]+\.)+eth$/;
  var PENDING_KEY = 'dgn_ref_pending';
  var REGISTRY = '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e';
  var SEL_RESOLVER = '0x0178b8bf'; // resolver(bytes32)
  var SEL_ADDR = '0x3b3b57de';     // addr(bytes32)
  var RPCS = [
    'https://ethereum-rpc.publicnode.com',
    'https://eth.drpc.org',
    'https://cloudflare-eth.com'
  ];

  function normalize(raw) {
    if (!raw) return null;
    raw = raw.trim().toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(raw)) return '0x' + '0'.repeat(24) + raw.slice(2);
    if (B32.test(raw)) return raw;
    return null;
  }

  function ensName(raw) {
    if (!raw) return null;
    raw = raw.trim();
    if (raw.length > 255 || /[^\x21-\x7e]/.test(raw)) return null;
    raw = raw.toLowerCase();
    return ENS_RE.test(raw) ? raw : null;
  }

  function stored() {
    try {
      var ls = localStorage.getItem('affiliate-ref');
      if (ls && B32.test(ls)) return ls;
    } catch (e) { /* private mode / disabled */ }
    var m = document.cookie.match(/(?:^|;\s*)dgn_ref=([^;]*)/);
    var ck = m ? decodeURIComponent(m[1]) : null;
    return ck && B32.test(ck) ? ck : null;
  }

  function commit(ref) {
    if (stored()) return; // first touch wins, re-checked after async resolves
    document.cookie = 'dgn_ref=' + ref + '; max-age=63072000; path=/; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
    try { localStorage.setItem('affiliate-ref', ref); } catch (e) { /* mirror only */ }
    try {
      document.dispatchEvent(new CustomEvent('degenerus:referral-changed', {
        detail: { code: ref }
      }));
    } catch (e) { /* input may not be mounted yet */ }
  }

  function getPending() {
    try { return ensName(sessionStorage.getItem(PENDING_KEY)); } catch (e) { return null; }
  }
  function setPending(name) {
    try { sessionStorage.setItem(PENDING_KEY, name); } catch (e) { /* best effort */ }
  }
  function clearPending() {
    try { sessionStorage.removeItem(PENDING_KEY); } catch (e) { /* best effort */ }
  }

  // ---- keccak-256 (BigInt lanes; hashes a few short strings once, perf moot) ----
  var M64 = (1n << 64n) - 1n;
  var RC = [
    '0x1', '0x8082', '0x800000000000808a', '0x8000000080008000',
    '0x808b', '0x80000001', '0x8000000080008081', '0x8000000000008009',
    '0x8a', '0x88', '0x80008009', '0x8000000a',
    '0x8000808b', '0x800000000000008b', '0x8000000000008089', '0x8000000000008003',
    '0x8000000000008002', '0x8000000000000080', '0x800a', '0x800000008000000a',
    '0x8000000080008081', '0x8000000000008080', '0x80000001', '0x8000000080008008'
  ].map(BigInt);
  var RHO = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

  function rotl(x, n) {
    var bn = BigInt(n);
    return ((x << bn) | (x >> (64n - bn))) & M64;
  }

  function keccakF(s) {
    for (var r = 0; r < 24; r++) {
      var C = [], D = [], B = new Array(25);
      for (var x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
      for (x = 0; x < 5; x++) {
        D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
        for (var y = 0; y < 25; y += 5) s[x + y] ^= D[x];
      }
      for (x = 0; x < 5; x++) for (var yy = 0; yy < 5; yy++)
        B[yy + 5 * ((2 * x + 3 * yy) % 5)] = rotl(s[x + 5 * yy], RHO[x + 5 * yy]);
      for (x = 0; x < 5; x++) for (yy = 0; yy < 5; yy++)
        s[x + 5 * yy] = B[x + 5 * yy] ^ ((~B[(x + 1) % 5 + 5 * yy] & M64) & B[(x + 2) % 5 + 5 * yy]);
      s[0] ^= RC[r];
    }
  }

  function keccak256(bytes) {
    var RATE = 136;
    var s = new Array(25).fill(0n);
    var padded = new Uint8Array((Math.floor(bytes.length / RATE) + 1) * RATE);
    padded.set(bytes);
    padded[bytes.length] ^= 0x01;
    padded[padded.length - 1] ^= 0x80;
    for (var off = 0; off < padded.length; off += RATE) {
      for (var i = 0; i < 17; i++) {
        var lane = 0n;
        for (var b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
        s[i] ^= lane;
      }
      keccakF(s);
    }
    var out = new Uint8Array(32);
    for (i = 0; i < 4; i++) {
      var l = s[i];
      for (b = 0; b < 8; b++) { out[i * 8 + b] = Number(l & 0xffn); l >>= 8n; }
    }
    return out;
  }

  function toHex(u8) {
    var h = '';
    for (var i = 0; i < u8.length; i++) h += (u8[i] | 0x100).toString(16).slice(1);
    return h;
  }

  function namehash(name) {
    var node = new Uint8Array(32);
    if (name) {
      var labels = name.split('.');
      for (var i = labels.length - 1; i >= 0; i--) {
        var lh = keccak256(new TextEncoder().encode(labels[i]));
        var cat = new Uint8Array(64);
        cat.set(node); cat.set(lh, 32);
        node = keccak256(cat);
      }
    }
    return toHex(node);
  }

  // ---- on-chain resolution ----
  // Resolves to '0x' + padded-address on success, null on a definitive
  // negative (no resolver / zero addr), rejects when every RPC is unreachable.
  function ethCall(to, data) {
    var i = 0;
    function attempt() {
      if (i >= RPCS.length) return Promise.reject(new Error('rpc unreachable'));
      var ep = RPCS[i++];
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, 4000);
      return fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: to, data: data }, 'latest'] }),
        signal: ctl.signal
      }).then(function (r) { return r.json(); }).then(function (j) {
        clearTimeout(timer);
        if (j && typeof j.result === 'string') return j.result;
        throw new Error('bad response');
      }).catch(function () {
        clearTimeout(timer);
        return attempt();
      });
    }
    return attempt();
  }

  function addrWord(res) {
    var m = /^0x0{24}([0-9a-f]{40})$/.exec((res || '').toLowerCase());
    return m && !/^0+$/.test(m[1]) ? m[1] : null;
  }

  function resolveEns(name) {
    var node = namehash(name);
    return ethCall(REGISTRY, SEL_RESOLVER + node).then(function (res) {
      var resolver = addrWord(res);
      if (!resolver) return null;
      return ethCall('0x' + resolver, SEL_ADDR + node).then(function (res2) {
        var addr = addrWord(res2);
        return addr ? '0x' + '0'.repeat(24) + addr : null;
      });
    });
  }

  function handleEns(name) {
    return resolveEns(name).then(function (padded) {
      try {
        if (padded) commit(padded);
        clearPending(); // resolved either way: success stored, negative drops
      } catch (e) { /* never break the page */ }
    }).catch(function () {
      try { setPending(name); } catch (e) { /* best effort retry stash */ }
    });
  }

  var pendingOp = null;

  function main() {
    var raw = new URLSearchParams(location.search).get('ref');
    if (stored()) { clearPending(); return; }
    var ref = normalize(raw);
    if (ref) { commit(ref); clearPending(); return; }
    var name = ensName(raw) || getPending();
    if (name && typeof BigInt !== 'undefined' && typeof fetch !== 'undefined') {
      pendingOp = handleEns(name);
    }
  }

  try { main(); } catch (e) { /* never break the page */ }

  // Shared util for same-page widgets (affiliates link builder) + test hook.
  try {
    if (typeof window !== 'undefined') window.dgnRef = { resolveEns: resolveEns, ensName: ensName };
    if (typeof globalThis !== 'undefined' && globalThis.__DGN_REF_TEST__) {
      Object.assign(globalThis.__DGN_REF_TEST__, {
        keccak256hex: function (str) { return toHex(keccak256(new TextEncoder().encode(str))); },
        namehash: namehash,
        normalize: normalize,
        ensName: ensName,
        resolveEns: resolveEns,
        op: function () { return pendingOp; }
      });
    }
  } catch (e) { /* hooks are best-effort */ }
})();
