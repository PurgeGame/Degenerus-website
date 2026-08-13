// /app/app/combine.js — account-switcher / combined-view merge util (CORE layer, 2026-07-16).
//
// mergePlayerPayloads(payloads) — folds N indexer /player/:address payloads (the
// connected wallet + every operator-approver, fetched by polling.js in 'combined'
// mode) into ONE aggregate the money panels render from `app.playerCombined`.
//
// This module ships the pure merge util ONLY. polling.js owns the fetch cycle and
// the update('app.playerCombined', merged) write (its scope, not this file's).
//
// Payload shape verified against database/src/api/routes/player.ts `GET /player/:address`
// (the response builder at the bottom of the handler):
//   - claimableEth / flipBalance / dgnrsBalance          → top-level string WEI
//   - coinflip.depositedAmount / coinflip.claimablePreview → string WEI (nested)
//   - decimator.claimablePerLevel[]                       → [{level, ethAmount:strWei, lootboxAmount:strWei|null, claimed:bool}]
//   - decimator.futurePoolTotal                          → GLOBAL string WEI (NOT per-account)
//   - tickets[]                                           → [{level, entryCount:num}]
//   - terminal.burns[]                                    → [{level, effectiveAmount, weightedAmount, timeMultBps}] | terminal===null
//   - quests / questStreak / scoreBreakdown / affiliate / degenerette → per-account IDENTITY (not summable)
//
// Numbers cross the wire as decimal STRINGS (wei) or JS numbers; wei sums fold with
// BigInt and serialize back to a decimal string (preserving the type the panels read).
//
// NOTE (adaptation vs. spec field names — the indexer is the source of truth):
//   - spec `coinflipClaimable`  → real `coinflip.claimablePreview`
//   - spec `terminalDecimatorBurns[]` → real `terminal.burns[]`
//   - spec `afkingFundingWei`   → NOT present in this payload; skipped (no field to sum)
//   - spec `approvers` / `deity` / `bundleType` → not present as top-level fields; nothing to omit
//   The /approvers data lives at a SEPARATE endpoint (GET /player/:address/approvers →
//   { operator, approvers:[{owner, blockNumber}] }); it is never part of /player/:address.

// ---------------------------------------------------------------------------
// Coercion helpers.
// ---------------------------------------------------------------------------

/** Safe BigInt coercion — tolerates numbers, decimal strings, null, ''; never throws. */
function _toBig(v) {
  if (v == null) return 0n;
  try {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    const s = String(v).trim();
    if (s === '') return 0n;
    return BigInt(s);
  } catch (_e) {
    return 0n;
  }
}

/** Sum a list of wei-denominated values (string | number | bigint) → decimal string. */
function _sumWeiStr(values) {
  let acc = 0n;
  for (const v of values) acc += _toBig(v);
  return acc.toString();
}

/** Lowercase an address defensively; null-safe. */
function _lc(addr) {
  return addr == null ? null : String(addr).toLowerCase();
}

/** Read a dotted path off an object; undefined on any miss. */
function _get(obj, path) {
  let cur = obj;
  for (const p of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// mergePlayerPayloads — the aggregate builder.
// ---------------------------------------------------------------------------

/**
 * @param {Array<object|null|undefined>} payloads
 *   Raw /player/:address payloads (connected + approvers). null/undefined entries
 *   (failed fetches in the allSettled cycle) are ignored. Each payload's own
 *   `player` field is the owner address used for `owner:` tags + `perAddress` keys.
 * @returns {{
 *   addresses: string[],
 *   perAddress: Record<string, object>,
 *   claimableEth: string, flipBalance: string, dgnrsBalance: string,
 *   coinflip: {depositedAmount: string, claimablePreview: string} | null,
 *   decimator: {claimablePerLevel: Array<{level:any, ethAmount:string, lootboxAmount:string|null, claimed:boolean}>, futurePoolTotal: string},
 *   terminal: {burns: Array<object & {owner:string}>} | null,
 *   tickets: Array<object & {owner:string}>,
 * }}
 */
export function mergePlayerPayloads(payloads) {
  const list = Array.isArray(payloads) ? payloads.filter((p) => p && typeof p === 'object') : [];

  const addresses = [];
  const perAddress = {};
  for (const p of list) {
    const addr = _lc(p.player);
    if (addr && !perAddress[addr]) {
      addresses.push(addr);
      perAddress[addr] = p;
    }
  }

  // --- SUM: top-level wei balances -----------------------------------------
  const claimableEth = _sumWeiStr(list.map((p) => p.claimableEth));
  const flipBalance = _sumWeiStr(list.map((p) => p.flipBalance));
  const dgnrsBalance = _sumWeiStr(list.map((p) => p.dgnrsBalance));

  // --- SUM: coinflip nested wei (omit autoRebuy* / biggestFlip* / bounty — identity) ---
  const anyCoinflip = list.some((p) => p.coinflip != null);
  const coinflip = anyCoinflip
    ? {
        depositedAmount: _sumWeiStr(list.map((p) => _get(p, 'coinflip.depositedAmount'))),
        claimablePreview: _sumWeiStr(list.map((p) => _get(p, 'coinflip.claimablePreview'))),
      }
    : null;

  // --- SUM: decimator per-level (ethAmount + lootboxAmount wei); futurePoolTotal is GLOBAL (first) ---
  // v77 B3: the API dropped the hardcoded-zero lootboxCount and exposes the real
  // lootboxAmount (wei string, null on AutoRebuyProcessed-sourced rows).
  const levelMap = new Map(); // level → {level, ethAmount:BigInt, lootboxAmount:BigInt, claimedAll:boolean}
  let futurePoolTotal = '0';
  let futurePoolSeen = false;
  for (const p of list) {
    const dec = p.decimator;
    if (!dec) continue;
    if (!futurePoolSeen && dec.futurePoolTotal != null) {
      // GLOBAL value — identical across accounts; take the first non-null.
      futurePoolTotal = String(dec.futurePoolTotal);
      futurePoolSeen = true;
    }
    const perLevel = Array.isArray(dec.claimablePerLevel) ? dec.claimablePerLevel : [];
    for (const row of perLevel) {
      const key = String(row.level);
      const cur = levelMap.get(key) || { level: row.level, ethAmount: 0n, lootboxAmount: 0n, claimedAll: true };
      cur.ethAmount += _toBig(row.ethAmount);
      cur.lootboxAmount += _toBig(row.lootboxAmount);
      // claimed row hides claimable amount; the aggregate row is "claimed" only
      // if EVERY contributing account has claimed it (so a single unclaimed
      // account keeps the summed amount visible in the combined panel).
      cur.claimedAll = cur.claimedAll && Boolean(row.claimed);
      levelMap.set(key, cur);
    }
  }
  const claimablePerLevel = Array.from(levelMap.values())
    .sort((a, b) => Number(a.level) - Number(b.level))
    .map((r) => ({
      level: r.level,
      ethAmount: r.ethAmount.toString(),
      lootboxAmount: r.lootboxAmount.toString(),
      claimed: r.claimedAll,
    }));
  const decimator = { claimablePerLevel, futurePoolTotal };

  // --- CONCAT: tickets[] (owner-tagged) ------------------------------------
  const tickets = [];
  for (const p of list) {
    const owner = _lc(p.player);
    const rows = Array.isArray(p.tickets) ? p.tickets : [];
    for (const t of rows) tickets.push({ ...t, owner });
  }

  // --- CONCAT: terminal.burns[] (owner-tagged); null when none across all ---
  const burns = [];
  for (const p of list) {
    const owner = _lc(p.player);
    const rows = Array.isArray(_get(p, 'terminal.burns')) ? p.terminal.burns : [];
    for (const b of rows) burns.push({ ...b, owner });
  }
  const terminal = burns.length > 0 ? { burns } : null;

  // IDENTITY fields (quests, questStreak, scoreBreakdown, affiliate, degenerette,
  // currentStreak, spendSummary, coinflip.autoRebuy*/biggestFlip*) are intentionally
  // OMITTED — they are per-account and not meaningfully summable. Panels render a
  // "pick a single account" note in combined mode; perAddress[addr] retains the raw
  // per-account payload for any drill-in.
  return {
    addresses,
    perAddress,
    claimableEth,
    flipBalance,
    dgnrsBalance,
    coinflip,
    decimator,
    terminal,
    tickets,
  };
}
