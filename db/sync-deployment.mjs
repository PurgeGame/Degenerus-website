#!/usr/bin/env node
/**
 * sync-deployment.mjs — one-shot re-sync of every website/indexer file that
 * hardcodes a deployed contract address or deploy block, from the canonical
 * testnet manifest produced by a redeploy.
 *
 * SOURCE OF TRUTH: degenerus-sim/.testnet/sepolia-manifest.json
 *   { chainId, contracts: { NAME: { address, blockNumber, ... } }, ... }
 *
 * TARGETS (addresses + deploy blocks):
 *   website/app/app/chain-config.sepolia.js   CONTRACTS{}          (addresses)
 *   website/beta/app/constants.js             CONTRACTS{}          (addresses)
 *   website/db/deployment.json                JSON mirror          (addresses + deployBlock + chainId)
 *   ../database/src/config/contracts.ts       SEPOLIA_CONTRACTS{}  (addresses + per-contract deployBlock)
 *
 * Only keys ALREADY present in a file are touched — the script never adds or
 * removes contracts. Addresses are lowercased. It does NOT touch ABIs (run the
 * indexer's `scripts/sync-abis.mjs` + `npm run abi:diff` for those), ETH_DIVISOR,
 * .env, or the CHAIN/chainId object (chainId is report-only — a same-network
 * redeploy keeps it; a network change is the separate .mainnet.js cutover).
 *
 * USAGE:
 *   node db/sync-deployment.mjs                 # dry-run: report every change, write nothing
 *   node db/sync-deployment.mjs --write         # apply
 *   node db/sync-deployment.mjs --manifest <p>  # override manifest path
 *   node db/sync-deployment.mjs --no-indexer    # skip ../database (website-only)
 *
 * Exit code: 0 = clean (or applied), 1 = manifest/target missing or malformed.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = resolve(__dirname, '..');            // .../website
const REPO_ROOT = resolve(WEBSITE_ROOT, '..');            // .../PurgeGame

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const NO_INDEXER = argv.includes('--no-indexer');
const manifestFlagIdx = argv.indexOf('--manifest');
const MANIFEST_PATH = manifestFlagIdx !== -1 && argv[manifestFlagIdx + 1]
  ? resolve(process.cwd(), argv[manifestFlagIdx + 1])
  : resolve(REPO_ROOT, 'degenerus-sim/.testnet/sepolia-manifest.json');

function die(msg) { console.error(`\x1b[31mERROR:\x1b[0m ${msg}`); process.exit(1); }

if (!existsSync(MANIFEST_PATH)) {
  die(`manifest not found: ${MANIFEST_PATH}\n  Pass --manifest <path> or run the redeploy first.`);
}
let manifest;
try { manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); }
catch (e) { die(`manifest is not valid JSON: ${e.message}`); }
if (!manifest.contracts || typeof manifest.contracts !== 'object') {
  die('manifest has no `contracts` object');
}

// key -> { address, blockNumber } (lowercased address)
const M = {};
for (const [name, entry] of Object.entries(manifest.contracts)) {
  const address = String(entry.address || entry).toLowerCase();
  const blockNumber = Number(entry.blockNumber ?? entry.block ?? NaN);
  M[name] = { address, blockNumber };
}
const manifestChainId = Number(manifest.chainId);
// deployment.json uses the GAME contract's block as the single "deployBlock".
const gameBlock = M.GAME?.blockNumber;

let totalChanges = 0;
let hadError = false;

function rpath(abs) { return relative(REPO_ROOT, abs); }

// ── per-file processors ──────────────────────────────────────────────────
// Each returns { path, present, changes: [{key, field, old, new}], newContent }.

// Scope a `KEY: '0x...'` replacement to a single named object block so we never
// touch HARDHAT/MAINNET blocks or unrelated hex elsewhere in the file.
function sliceBlock(content, startMarker) {
  const start = content.indexOf(startMarker);
  if (start === -1) return null;
  const end = content.indexOf('\n};', start);
  if (end === -1) return null;
  return { start, end: end + 3, block: content.slice(start, end + 3) };
}

// JS files: CONTRACTS = { KEY: '0x...' , ... }  → replace addresses only.
function processJsAddresses(absPath, startMarker) {
  if (!existsSync(absPath)) return { path: absPath, present: false, changes: [] };
  const content = readFileSync(absPath, 'utf8');
  const sl = sliceBlock(content, startMarker);
  if (!sl) { hadError = true; console.error(`  ! ${rpath(absPath)}: block "${startMarker}" not found`); return { path: absPath, present: true, changes: [] }; }
  let block = sl.block;
  const changes = [];
  const matched = [];
  for (const [key, { address }] of Object.entries(M)) {
    const re = new RegExp(`(\\b${key}:\\s*')(0x[0-9a-fA-F]{40})(')`);
    const m = block.match(re);
    if (!m) continue;                         // key absent from this file → skip
    matched.push(key);
    const old = m[2].toLowerCase();
    if (old !== address) {
      changes.push({ key, field: 'address', old, new: address });
      block = block.replace(re, `$1${address}$3`);
    }
  }
  const newContent = content.slice(0, sl.start) + block + content.slice(sl.end);
  return { path: absPath, present: true, changes, matched, newContent };
}

// TS: SEPOLIA_CONTRACTS = { KEY: { address: '0x...', deployBlock: N n }, ... }
function processTsContracts(absPath) {
  if (!existsSync(absPath)) return { path: absPath, present: false, changes: [] };
  const content = readFileSync(absPath, 'utf8');
  const sl = sliceBlock(content, 'export const SEPOLIA_CONTRACTS');
  if (!sl) { hadError = true; console.error(`  ! ${rpath(absPath)}: SEPOLIA_CONTRACTS block not found`); return { path: absPath, present: true, changes: [] }; }
  let block = sl.block;
  const changes = [];
  const matched = [];
  for (const [key, { address, blockNumber }] of Object.entries(M)) {
    const re = new RegExp(`(\\b${key}:\\s*\\{\\s*address:\\s*')(0x[0-9a-fA-F]{40})(',\\s*deployBlock:\\s*)(\\d+)(n\\s*\\})`);
    const m = block.match(re);
    if (!m) continue;
    matched.push(key);
    const oldAddr = m[2].toLowerCase();
    const oldBlk = Number(m[4]);
    const newBlk = Number.isFinite(blockNumber) ? blockNumber : oldBlk;
    if (oldAddr !== address) changes.push({ key, field: 'address', old: oldAddr, new: address });
    if (oldBlk !== newBlk) changes.push({ key, field: 'deployBlock', old: oldBlk, new: newBlk });
    if (oldAddr !== address || oldBlk !== newBlk) {
      block = block.replace(re, `$1${address}$3${newBlk}$5`);
    }
  }
  const newContent = content.slice(0, sl.start) + block + content.slice(sl.end);
  return { path: absPath, present: true, changes, matched, newContent };
}

// JSON mirror: chainId + deployBlock + contracts{} (existing keys only).
function processDeploymentJson(absPath) {
  if (!existsSync(absPath)) return { path: absPath, present: false, changes: [] };
  const content = readFileSync(absPath, 'utf8');
  let json;
  try { json = JSON.parse(content); } catch (e) { hadError = true; console.error(`  ! ${rpath(absPath)}: invalid JSON (${e.message})`); return { path: absPath, present: true, changes: [] }; }
  const changes = [];
  if (Number.isFinite(manifestChainId) && json.chainId !== manifestChainId) {
    changes.push({ key: '(root)', field: 'chainId', old: json.chainId, new: manifestChainId });
    json.chainId = manifestChainId;
  }
  if (Number.isFinite(gameBlock) && json.deployBlock !== gameBlock) {
    changes.push({ key: '(root)', field: 'deployBlock', old: json.deployBlock, new: gameBlock });
    json.deployBlock = gameBlock;
  }
  const matched = [];
  if (json.contracts && typeof json.contracts === 'object') {
    for (const key of Object.keys(json.contracts)) {
      const want = M[key]?.address;
      if (!want) continue;
      matched.push(key);
      const old = String(json.contracts[key]).toLowerCase();
      if (old !== want) {
        changes.push({ key, field: 'address', old, new: want });
        json.contracts[key] = want;
      }
    }
  }
  const newContent = JSON.stringify(json, null, 2) + '\n';
  return { path: absPath, present: true, changes, matched, newContent };
}

// ── run all targets ─────────────────────────────────────────────────────
const targets = [
  processJsAddresses(resolve(WEBSITE_ROOT, 'app/app/chain-config.sepolia.js'), 'export const CONTRACTS'),
  processJsAddresses(resolve(WEBSITE_ROOT, 'beta/app/constants.js'), 'export const CONTRACTS'),
  processDeploymentJson(resolve(WEBSITE_ROOT, 'db/deployment.json')),
];
if (!NO_INDEXER) {
  targets.push(processTsContracts(resolve(REPO_ROOT, 'database/src/config/contracts.ts')));
}

console.log(`\nManifest: ${rpath(MANIFEST_PATH)}`);
console.log(`GAME: ${M.GAME?.address}  block ${gameBlock}  chainId ${manifestChainId}`);
console.log(`Mode: ${WRITE ? '\x1b[33mWRITE\x1b[0m' : 'dry-run (use --write to apply)'}\n`);

for (const t of targets) {
  const label = rpath(t.path);
  if (!t.present) { console.log(`  \x1b[90m—\x1b[0m ${label} (absent, skipped)`); continue; }
  if (!t.changes.length) { console.log(`  \x1b[32m✓\x1b[0m ${label} — up to date`); continue; }
  console.log(`  \x1b[33m~\x1b[0m ${label} — ${t.changes.length} change(s):`);
  for (const c of t.changes) console.log(`      ${c.key}.${c.field}: ${c.old} → ${c.new}`);
  totalChanges += t.changes.length;
  if (WRITE && t.newContent) { writeFileSync(t.path, t.newContent); }
}

// Orphan check: manifest contracts referenced in NO target file. Expected for
// pure-backend contracts (mocks, ICONS, etc.) — but a brand-new module here
// means the mechanical sync can't wire it; flag it loudly so it isn't missed.
const referenced = new Set();
for (const t of targets) for (const k of (t.matched || [])) referenced.add(k);
const orphans = Object.keys(M).filter((k) => !referenced.has(k));
if (orphans.length) {
  console.log(`\n\x1b[33m⚠ In manifest but not referenced in any synced file:\x1b[0m ${orphans.join(', ')}`);
  console.log('  (fine for backend-only contracts; a NEW player-facing module must be wired by hand.)');
}

// Report-only manifest fields worth an eyeball on a real redeploy.
console.log('\nReport-only (not auto-written — verify manually):');
console.log(`  deployer:        ${manifest.deployer}`);
console.log(`  vrfCoordinator:  ${manifest.vrfCoordinator ?? '(n/a)'}   vrfMode: ${manifest.vrfMode ?? '(n/a)'}`);
console.log(`  deployDayBoundary: ${manifest.deployDayBoundary ?? '(n/a)'}`);
console.log(`  → also: re-vendor ABIs (database/scripts/sync-abis.mjs), run abi:diff,`);
console.log(`    point database/.env DATABASE_URL at the new run DB, recreate + migrate + re-index.`);

console.log(`\n${totalChanges === 0 ? '\x1b[32mNo changes needed.\x1b[0m' : (WRITE ? `\x1b[33mApplied ${totalChanges} change(s).\x1b[0m` : `\x1b[33m${totalChanges} change(s) pending — re-run with --write.\x1b[0m`)}`);
if (hadError) { console.error('\n\x1b[31mOne or more target blocks were not found — resolve before writing.\x1b[0m'); process.exit(1); }
process.exit(0);
