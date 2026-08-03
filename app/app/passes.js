// /app/app/passes.js — Phase 62 Plan 62-02 (BUY-02 + BUY-03 write path).
//
// Whale + Deity pass purchase helpers. Two named exports wrap Phase 56
// requireStaticCall + decodeRevertReason and Phase 58 sendTx closure-form
// chokepoint. Mirrors Phase 60 lootbox.js + Phase 61 claims.js shape.
//
// On-chain surfaces (verified against degenerus-audit/contracts/):
//   - BUY-02: DegenerusGame.sol — purchaseWhalePass(address buyer, uint256 quantity) payable
//     (renamed from purchaseWhaleBundle in the Base Sepolia redeploy #7 surface)
//   - BUY-03: DegenerusGame.sol:644 — purchaseDeityPass(address buyer, uint8 symbolId) payable
//
// CONTEXT D-05 LOCKED + RESEARCH R8 + Pitfall 3:
//   Whale-pass + deity-pass have NO custom-error reverts on these paths — all
//   failure paths route through `revert E()` (storage:210). The deity-pass
//   `symbol-taken` site is contracts/modules/DegenerusGameWhaleModule.sol:546
//   (`if (deityBySymbol[symbolId] != address(0)) revert E();`). Plan 62-02
//   ships a panel-level decode override (deityPassErrorOverride) INSTEAD of
//   editing the shared reason-map — `'E'` retains its generic copy for
//   non-deity contexts.
//
// Plan 62-02 registers ONE NEW reason-map code: `RngLocked`. Phase 56 only had
// it as a comment per RESEARCH R11; deity-pass purchase can throw it during VRF
// cycles via storage:213.
//
// Inline ABI fragments — DO NOT cross-import /beta/app/constants.js (Pitfall 4
// pattern from Phase 61: /beta has WRONG signatures elsewhere; defense-in-depth
// is to keep ABI strings co-located with the helpers).
//
// MANDATORY closure form for every sendTx call (Phase 58 verified by grep gate):
//   CORRECT:   sendTx( (s) => new Contract(addr, ABI, s).method(args), 'Action' )
//   FORBIDDEN: passing a pre-resolved tx promise — captures stale signer.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { CHAIN, CONTRACTS } from './chain-config.js';
import { get, getActingAddress } from './store.js';
// Same first-touch referral the ticket/lootbox path sends (ZeroHash when none).
import { readAffiliateCode } from './lootbox.js';

// ---------------------------------------------------------------------------
// Inline ABI fragments — canonical signatures verified against
// degenerus-audit/contracts/DegenerusGame.sol:599 + :644 — VERIFIED.
// ---------------------------------------------------------------------------

const PASSES_ABI = [
  // BUY-02: DegenerusGame.sol:997 — purchaseWhalePass(buyer, quantity, affiliateCode).
  // The affiliateCode parameter is NOT optional padding: it is part of the
  // selector. Calling the old two-arg signature hits a selector the deployed
  // GAME does not carry (verified on-chain: 0xe81ebd5f absent, 0x78f70988
  // present), so the call reverts with EMPTY returndata and every failure
  // decoded as the reason-map's UNKNOWN catch-all — "unexpected error" on every
  // whale-pass buy, whatever the wallet's balance or the game's state.
  'function purchaseWhalePass(address buyer, uint256 quantity, bytes32 affiliateCode) external payable',
  // BUY-03: DegenerusGame.sol:644 — purchaseDeityPass(buyer, symbolId) payable
  'function purchaseDeityPass(address buyer, uint8 symbolId) external payable',
  // AFKing seat holders configure the Game-resident subscription here. Keeping
  // the read views beside the write also lets the pass panel show authoritative
  // active/funding state without waiting for an indexer cycle.
  'function subscribe(address player, bool drainGameCreditFirst, bool useTickets, uint8 dailyQuantity, address fundingSource) external payable',
  'function depositAfkingFunding(address player) external payable',
  'function withdrawAfkingFunding(uint256 amount) external',
  'function afkingFundingOf(address player) external view returns (uint256)',
  'function subInfo(address player) external view returns (bool active, uint8 dailyQuantity, uint24 afkingStartDay, uint24 afkCoveredThroughDay)',
  'function afkingSnapshot(address[] players) external view returns (uint256 mintPriceWei, bool rngLocked_, uint256[] claimables, uint256[] afkingFundings)',
  // Deity holders receive three deterministic, VRF-backed boon slots per day.
  // The standalone viewer is not part of the deployed address manifest, so the
  // browser reads this raw tuple and mirrors the viewer's pure weighting below.
  'function deityBoonData(address deity) external view returns (uint256 dailySeed, uint24 day, uint8 usedMask, bool decimatorOpen, bool deityPassAvailable)',
  'function issueDeityBoon(address deity, address recipient, uint8 slot) external',
  // Deity-pass owner action: burn 200 FLIP and add a +2 curse stack.
  'function smite(uint256 deityId, address smitee) external',
  // Current named errors are included so ethers exposes error.revert.name to
  // the reason map. Without these fragments a valid custom-error response can
  // collapse into the old generic deity "E" treatment.
  'error RngLocked()',
  'error GameOver()',
  'error InvalidSymbol()',
  'error SymbolTaken()',
  'error AlreadyOwnsDeityPass()',
  'error NotApproved()',
  'error NoCoin()',
  'error SeatForfeited()',
  'error MustPurchaseToBeginAfking()',
  'error NotSubscribed()',
  'error AlreadySwept()',
  'error Insolvent()',
  'error TransferFailed()',
  'error ZeroAddress()',
  'error SelfBoon()',
  'error InvalidSlot()',
  'error Unauthorized()',
  'error RngNotReady()',
  'error RecipientAlreadyBoonedToday()',
  'error RecipientBoonCapReached()',
  'error SlotAlreadyUsed()',
  'error SmiteeAfkingImmune()',
  'error SmiteCeilingReached()',
  'error Insufficient()',
  // Receipt-log events for confirmation parsing (CF-05). Sourced from
  // contracts/modules/DegenerusGameWhaleModule.sol:62 (WhalePassClaimed) and
  // contracts/storage/DegenerusGameStorage.sol:516 (DeityPassPurchased).
  'event WhalePassClaimed(address indexed player, address indexed caller, uint256 halfPasses, uint24 startLevel)',
  'event DeityPassPurchased(address indexed buyer, uint8 symbolId, uint256 price, uint24 level)',
  'event DeityBoonIssued(address indexed deity, address indexed recipient, uint24 indexed day, uint8 slot, uint8 boonType)',
  'event Smited(uint256 indexed deityId, address indexed smitee)',
  'event AfkingFunded(address indexed player, uint256 amount)',
  'event AfkingWithdrew(address indexed player, uint256 amount)',
];

// The GAME no longer exposes the old deityPassTotalIssuedCount() view. The
// soulbound pass NFT remains the canonical 32-slot catalog: tokenId is the
// symbol id, so ownerOf() tells us both which symbols are unavailable and how
// many passes feed the triangular price curve.
const DEITY_PASS_READ_ABI = [
  'function name() external view returns (string)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'error InvalidToken()',
];
// Seats AUTO-MINT with any pass acquisition (GAME `_grantSeatCoin` → token `mintSeatFor`), so
// there is no claim step: `claimSeat` / `SeatClaimed` / `NotEligible` were REMOVED from the token
// and their call sites deleted here. `balanceOf` is the whole client-side surface now — a holder
// either has a seat or does not.
const AFKING_SEAT_READ_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'error InvalidTrait()',
  'error SupplyCapped()',
];
const INVALID_TOKEN_SELECTOR = ethers.id('InvalidToken()').slice(0, 10).toLowerCase();
// Canonical CREATE2 Multicall3 deployment (present on Base Sepolia and
// Ethereum). One aggregate avoids a 32-request burst that Base's public RPC
// rate-limits after the first few ownerOf calls.
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns (tuple(bool success,bytes returnData)[] returnData)',
];

// ---------------------------------------------------------------------------
// Test seam — production path uses default `new ethers.Contract(...)`.
// Tests inject a fake via __setContractFactoryForTest; reset via
// __resetContractFactoryForTest. Mirrors Phase 60 / Phase 61 pattern.
// ---------------------------------------------------------------------------

let _contractFactory = null;
let _deityReadContractFactory = null;
let _afkingReadContractFactory = null;
let _deityBoonReadContractFactory = null;
let _publicReadProvider = null;
let _deityContractVerified = false;

/** Test-only: replace the `new Contract(...)` construction with a fake. */
export function __setContractFactoryForTest(fn) {
  _contractFactory = fn;
}

/** Test-only: replace the deity NFT read contract with a fake. */
export function __setDeityReadContractFactoryForTest(fn) {
  _deityReadContractFactory = typeof fn === 'function' ? fn : null;
}

/** Test-only: restore the real deity NFT catalog reader. */
export function __resetDeityReadContractFactoryForTest() {
  _deityReadContractFactory = null;
}

/** Test-only: inject { game, token } for AFKing subscription reads. */
export function __setAfkingReadContractFactoryForTest(fn) {
  _afkingReadContractFactory = typeof fn === 'function' ? fn : null;
}

export function __resetAfkingReadContractFactoryForTest() {
  _afkingReadContractFactory = null;
}

/** Test-only: replace the GAME deity-boon read contract with a fake. */
export function __setDeityBoonReadContractFactoryForTest(fn) {
  _deityBoonReadContractFactory = typeof fn === 'function' ? fn : null;
}

export function __resetDeityBoonReadContractFactoryForTest() {
  _deityBoonReadContractFactory = null;
}

/** Test-only: clear the injected factory; subsequent calls use the real path. */
export function __resetContractFactoryForTest() {
  _contractFactory = null;
}

function _buildContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, PASSES_ABI, signerOrProvider);
}

function _deityReadContract() {
  if (_deityReadContractFactory) return _deityReadContractFactory();
  if (!CONTRACTS.DEITY_PASS || !CHAIN.rpcUrl) return null;
  if (!_publicReadProvider) {
    _publicReadProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      { name: CHAIN.name, chainId: CHAIN.id },
      { staticNetwork: true },
    );
  }
  return new ethers.Contract(CONTRACTS.DEITY_PASS, DEITY_PASS_READ_ABI, _publicReadProvider);
}

function _ensurePublicReadProvider() {
  if (!_publicReadProvider && CHAIN.rpcUrl) {
    _publicReadProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      { name: CHAIN.name, chainId: CHAIN.id },
      { staticNetwork: true },
    );
  }
  return _publicReadProvider;
}

function _afkingReadContracts() {
  if (_afkingReadContractFactory) return _afkingReadContractFactory();
  const provider = _ensurePublicReadProvider();
  if (!provider || !CONTRACTS.GAME || !CONTRACTS.AFKING_SUB_TOKEN) return null;
  return {
    game: new ethers.Contract(CONTRACTS.GAME, PASSES_ABI, provider),
    token: new ethers.Contract(CONTRACTS.AFKING_SUB_TOKEN, AFKING_SEAT_READ_ABI, provider),
  };
}

function _deityBoonReadContract() {
  if (_deityBoonReadContractFactory) return _deityBoonReadContractFactory();
  // Component tests already inject the GAME half of the AFKing reader. Reuse
  // that seam so a fake-DOM test never falls through to the public RPC.
  if (_afkingReadContractFactory) return _afkingReadContracts()?.game || null;
  const provider = _ensurePublicReadProvider();
  if (!provider || !CONTRACTS.GAME) return null;
  return new ethers.Contract(CONTRACTS.GAME, PASSES_ABI, provider);
}

function _deityMulticallContract() {
  if (!_publicReadProvider) return null;
  return new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, _publicReadProvider);
}

function _isUnmintedDeityToken(error) {
  const pending = [error];
  const seen = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string') {
      const text = value.toLowerCase();
      if (text.includes(INVALID_TOKEN_SELECTOR) || text.includes('invalidtoken')) return true;
      continue;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    for (const key of ['data', 'message', 'shortMessage', 'reason', 'error', 'info', 'cause']) {
      try { pending.push(value[key]); } catch (_) { /* defensive */ }
    }
  }
  return false;
}

async function _retryDeityRpc(read, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        // Most Base public-RPC 429s happen in the app's first burst of reads.
        // Back off into the quiet part of startup instead of leaving the
        // picker locked until its next 30-second panel poll.
        const delayMs = 400 * (2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * Read the authoritative deity-pass symbol catalog from the soulbound NFT.
 * Returns null rather than treating an RPC failure as 32 available symbols.
 *
 * @returns {Promise<null|{issuedCount:number,takenSymbols:Set<number>,ownersBySymbol:Map<number,string>}>}
 */
export async function readDeityPassCatalog() {
  const contract = _deityReadContract();
  if (!contract) return null;

  // One successful metadata call distinguishes a real empty catalog from a
  // dead RPC / stale address before ownerOf reverts are classified as empty.
  if (_deityReadContractFactory || !_deityContractVerified) {
    try {
      const contractName = _deityReadContractFactory
        ? await contract.name()
        : await _retryDeityRpc(() => contract.name());
      if (String(contractName || '').trim() !== 'Degenerus Deity Pass') return null;
      if (!_deityReadContractFactory) _deityContractVerified = true;
    } catch (_) {
      return null;
    }
  }

  const takenSymbols = new Set();
  const ownersBySymbol = new Map();

  // Production uses one Multicall3 request. Test fakes intentionally retain
  // the direct ownerOf surface so catalog semantics stay easy to unit-test.
  if (!_deityReadContractFactory) {
    try {
      const multicall = _deityMulticallContract();
      if (!multicall) return null;
      const calls = Array.from({ length: 32 }, (_, symbolId) => ({
        target: CONTRACTS.DEITY_PASS,
        allowFailure: true,
        callData: contract.interface.encodeFunctionData('ownerOf', [symbolId]),
      }));
      const rows = await _retryDeityRpc(() => multicall.aggregate3.staticCall(calls));
      if (!rows || rows.length !== 32) return null;
      for (let symbolId = 0; symbolId < rows.length; symbolId += 1) {
        const row = rows[symbolId];
        if (row.success) {
          const decoded = contract.interface.decodeFunctionResult('ownerOf', row.returnData);
          const owner = String(decoded?.[0] || '').trim();
          if (!owner) return null;
          takenSymbols.add(symbolId);
          ownersBySymbol.set(symbolId, owner);
        } else if (String(row.returnData || '').toLowerCase() !== INVALID_TOKEN_SELECTOR) {
          return null;
        }
      }
    } catch (_) {
      return null;
    }
  } else {
    const reads = await Promise.allSettled(
      Array.from({ length: 32 }, (_, symbolId) => contract.ownerOf(symbolId)),
    );

    for (let symbolId = 0; symbolId < reads.length; symbolId += 1) {
      const result = reads[symbolId];
      if (result.status === 'fulfilled') {
        const owner = String(result.value || '').trim();
        if (!owner) return null;
        takenSymbols.add(symbolId);
        ownersBySymbol.set(symbolId, owner);
      } else if (!_isUnmintedDeityToken(result.reason)) {
        // A timeout/rate-limit must not make a claimed symbol look purchasable.
        return null;
      }
    }
  }

  return {
    issuedCount: takenSymbols.size,
    takenSymbols,
    ownersBySymbol,
  };
}

// Exact ordered weight table from DeityBoonViewer._boonFromRoll(). Conditional
// entries are omitted (including their weight) when that product is unavailable.
// Keeping the order here is load-bearing: the slot hash selects a point on this
// cumulative line, so sorting the rows would change every displayed boon.
const DEITY_BOON_WEIGHTS = Object.freeze([
  [1, 200], [2, 40], [3, 8],
  [5, 200], [6, 30], [22, 8],
  [7, 400], [8, 80], [9, 16],
  [13, 40, 'decimator'], [14, 8, 'decimator'], [15, 2, 'decimator'],
  [16, 28], [23, 10], [24, 2],
  [25, 28, 'deity'], [26, 10, 'deity'], [27, 2, 'deity'],
  [17, 100], [18, 30], [19, 8],
  [4, 200], [28, 8],
  [29, 30], [30, 8], [31, 2],
]);

function _normalizedHexAddress(value) {
  const raw = String(value || '').trim();
  if (!ethers.isAddress(raw)) return null;
  // Lowercasing first accepts wallets supplied with either checksum casing or
  // all-lowercase DB casing while still returning a canonical checksum value.
  return ethers.getAddress(raw.toLowerCase());
}

/**
 * Mirror DeityBoonViewer.deityBoonSlots() without depending on an undeployed
 * viewer address. `abi.encode`, not packed encoding, is part of the RNG domain.
 */
export function deriveDeityBoonSlots({
  dailySeed,
  deity,
  day,
  decimatorOpen,
  deityPassAvailable,
} = {}) {
  const address = _normalizedHexAddress(deity);
  if (!address) throw new Error('Invalid deity address.');
  const seed = BigInt(dailySeed ?? 0n);
  const dayNumber = Number(day);
  if (!Number.isInteger(dayNumber) || dayNumber < 0 || dayNumber > 0xffffff) {
    throw new Error('Invalid deity boon day.');
  }
  if (seed === 0n) return [0, 0, 0];

  const activeRows = DEITY_BOON_WEIGHTS.filter((row) => (
    (row[2] !== 'decimator' || Boolean(decimatorOpen))
    && (row[2] !== 'deity' || Boolean(deityPassAvailable))
  ));
  const totalWeight = activeRows.reduce((sum, row) => sum + row[1], 0);
  const coder = ethers.AbiCoder.defaultAbiCoder();

  return Array.from({ length: 3 }, (_unused, slot) => {
    const encoded = coder.encode(
      ['uint256', 'address', 'uint24', 'uint8'],
      [seed, address, dayNumber, slot],
    );
    const roll = Number(BigInt(ethers.keccak256(encoded)) % BigInt(totalWeight));
    let cursor = 0;
    for (const [boonType, weight] of activeRows) {
      cursor += weight;
      if (roll < cursor) return boonType;
    }
    // Matches the viewer's fail-safe tail. The cumulative table should always
    // return before this point, but a deterministic fallback is safer than 0.
    return 19;
  });
}

/** Read a deity holder's three boon slots and today's used-slot mask. */
export async function readDeityBoonSlots(player) {
  const deity = _normalizedHexAddress(player);
  if (!deity) return null;
  const contract = _deityBoonReadContract();
  if (!contract) return null;
  try {
    const raw = await contract.deityBoonData(deity);
    const dailySeed = BigInt(raw?.dailySeed ?? raw?.[0] ?? 0);
    const day = Number(raw?.day ?? raw?.[1] ?? 0);
    const usedMask = Number(raw?.usedMask ?? raw?.[2] ?? 0);
    const decimatorOpen = Boolean(raw?.decimatorOpen ?? raw?.[3]);
    const deityPassAvailable = Boolean(raw?.deityPassAvailable ?? raw?.[4]);
    return {
      day,
      usedMask,
      ready: dailySeed !== 0n,
      slots: deriveDeityBoonSlots({
        dailySeed,
        deity,
        day,
        decimatorOpen,
        deityPassAvailable,
      }),
    };
  } catch (_error) {
    return null;
  }
}

/** Issue one of the acting deity holder's daily boon slots to another wallet. */
export async function issueDeityBoon({ recipient, slot } = {}) {
  const deity = _normalizedHexAddress(getActingAddress());
  if (!deity) throw new Error('Wallet not connected.');
  const target = _normalizedHexAddress(recipient);
  if (!target || target === ethers.ZeroAddress) throw new Error('Enter a valid recipient address.');
  if (target.toLowerCase() === deity.toLowerCase()) throw new Error('Choose someone other than yourself.');
  const slotNumber = Number(slot);
  if (!Number.isInteger(slotNumber) || slotNumber < 0 || slotNumber > 2) {
    throw new Error('Boon slot must be 1-3.');
  }
  const args = [deity, target, slotNumber];

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const contract = _buildContract(signer);
    const sim = await requireStaticCall(contract, 'issueDeityBoon', args, signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call issueDeityBoon');
  }

  const receipt = await sendTx(
    (s) => _buildContract(s).issueDeityBoon(...args),
    'Give deity boon',
  );
  return { receipt };
}

/** Burn 200 FLIP to add one +2 curse stack to a target as a deity holder. */
export async function smiteWithDeity({ deityId, target } = {}) {
  const deity = _normalizedHexAddress(getActingAddress());
  if (!deity) throw new Error('Wallet not connected.');
  const sid = Number(deityId);
  if (!Number.isInteger(sid) || sid < 0 || sid > 31) {
    throw new Error('Deity pass symbol must be 0-31.');
  }
  const smitee = _normalizedHexAddress(target);
  if (!smitee || smitee === ethers.ZeroAddress) {
    throw new Error('Enter a valid target wallet address.');
  }
  const args = [sid, smitee];

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const contract = _buildContract(signer);
    const sim = await requireStaticCall(contract, 'smite', args, signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call smite');
  }

  const receipt = await sendTx(
    (s) => _buildContract(s).smite(...args),
    'Curse player',
  );
  return { receipt };
}

/**
 * Authoritative AFKing seat + subscription snapshot for one player.
 * A null result means the RPC/config is unavailable; it never means "no seat".
 *
 * @param {string} player
 * @returns {Promise<null|{hasToken:boolean,tokenBalance:bigint,active:boolean,dailyQuantity:number,startDay:number,coveredThroughDay:number,mintPriceWei:bigint,rngLocked:boolean,claimableWei:bigint,fundingWei:bigint}>}
 */
export async function readAfkingSubscription(player) {
  const address = String(player || '').trim();
  if (!address) return null;
  const contracts = _afkingReadContracts();
  if (!contracts?.game || !contracts?.token) return null;
  try {
    // The seat ERC-721 now arrives WITH the pass (GAME `_grantSeatCoin` → token `mintSeatFor`),
    // so there is no entitlement to probe and no claim to simulate — balanceOf alone says whether
    // the player holds a seat.
    const call = (target, method, ...args) => Promise.resolve().then(() => {
      if (typeof target?.[method] !== 'function') throw new Error(`${method} unavailable`);
      return target[method](...args);
    });
    // Keep these three calls sequential. The Base public endpoint intermittently
    // rate-limits the panel's wider mount burst; losing afkingSnapshot made the
    // editor appear with no daily price even though the seat probe succeeded.
    const settle = async (promise) => {
      try { return { status: 'fulfilled', value: await promise }; }
      catch (reason) { return { status: 'rejected', reason }; }
    };
    const balanceRes = await settle(call(contracts.token, 'balanceOf', address));
    const infoRes = await settle(call(contracts.game, 'subInfo', address));
    const snapshotRes = await settle(call(contracts.game, 'afkingSnapshot', [address]));
    const value = (result, fallback) => result.status === 'fulfilled' ? result.value : fallback;
    const balanceKnown = balanceRes.status === 'fulfilled';
    const tokenBalance = BigInt(value(balanceRes, 0n) ?? 0n);
    if (!balanceKnown) return null;

    const info = value(infoRes, null);
    const snapshot = value(snapshotRes, null);
    const claimables = snapshot?.claimables ?? snapshot?.[2] ?? [];
    const fundings = snapshot?.afkingFundings ?? snapshot?.[3] ?? [];
    return {
      hasToken: tokenBalance > 0n,
      tokenBalance,
      active: Boolean(info?.active ?? info?.[0]),
      dailyQuantity: Number(info?.dailyQuantity ?? info?.[1] ?? 0),
      startDay: Number(info?.afkingStartDay ?? info?.[2] ?? 0),
      coveredThroughDay: Number(info?.afkCoveredThroughDay ?? info?.[3] ?? 0),
      mintPriceWei: BigInt(snapshot?.mintPriceWei ?? snapshot?.[0] ?? 0),
      rngLocked: Boolean(snapshot?.rngLocked_ ?? snapshot?.[1]),
      claimableWei: BigInt(claimables?.[0] ?? 0),
      fundingWei: BigInt(fundings?.[0] ?? 0),
    };
  } catch (_error) {
    return null;
  }
}

// `claimAfkingSeat` was REMOVED — the token dropped `claimSeat` when seats became auto-minted with
// the pass. Restyling a seat is still supported on-chain via `setSeatTraits(tokenId, symbol, bg,
// trim)`, but that needs the holder's tokenId and the token exposes no
// `tokenOfOwnerByIndex`/`tokensOfOwner`/`seatOf(address)` — so a seat-art editor needs a tokenId
// source first (index the new `SeatMinted(owner, tokenId, …)` event, or add a `seatOf` view).

/** Configure, replace, or cancel the acting player's AFKing subscription. */
export async function updateAfkingSubscription({
  dailyQuantity,
  useTickets = true,
  drainGameCreditFirst = true,
  msgValueWei = 0n,
} = {}) {
  const player = getActingAddress();
  if (!player) throw new Error('Wallet not connected.');
  const qty = Number(dailyQuantity);
  if (!Number.isInteger(qty) || qty < 0 || qty > 255) {
    throw new Error('Daily quantity must be 0-255.');
  }
  const value = BigInt(msgValueWei ?? 0n);
  if (value < 0n) throw new Error('Funding amount cannot be negative.');
  const fundingSource = ethers.ZeroAddress;
  const args = [player, Boolean(drainGameCreditFirst), Boolean(useTickets), qty, fundingSource, { value }];

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const contract = _buildContract(signer);
    const sim = await requireStaticCall(contract, 'subscribe', args, signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call subscribe');
  }

  const receipt = await sendTx(
    (s) => _buildContract(s).subscribe(...args),
    qty === 0 ? 'Cancel AFKing subscription' : 'Save AFKing subscription',
  );
  return { receipt };
}

/** Add prepaid ETH without changing an active AFKing subscription's settings. */
export async function fundAfkingSubscription({ msgValueWei } = {}) {
  const player = _normalizedHexAddress(getActingAddress());
  if (!player) throw new Error('Wallet not connected.');
  const value = BigInt(msgValueWei ?? 0n);
  if (value <= 0n) throw new Error('Enter an AFKing funding amount.');
  const args = [player, { value }];

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const contract = _buildContract(signer);
    const sim = await requireStaticCall(contract, 'depositAfkingFunding', args, signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call depositAfkingFunding');
  }

  const receipt = await sendTx(
    (s) => _buildContract(s).depositAfkingFunding(...args),
    'Fund AFKing subscription',
  );
  return { receipt };
}

/**
 * Withdraw the connected wallet's complete prepaid AFKing balance.
 *
 * Unlike subscription writes, the contract has no player argument: it always
 * debits and pays msg.sender. Refuse operator mode so a panel showing another
 * player's funding can never make the operator withdraw their own balance by
 * mistake. The balance is re-read at click time because an active subscription
 * may consume funding between poll cycles.
 */
export async function withdrawAfkingSubscriptionFunding() {
  const connected = _normalizedHexAddress(get('connected.address'));
  const acting = _normalizedHexAddress(getActingAddress());
  if (!connected) throw new Error('Wallet not connected.');
  if (get('ui.mode') !== 'self' || !acting || acting !== connected) {
    throw new Error('Switch to your own wallet view to withdraw AFKing funding.');
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (!signer) throw new Error('Wallet not connected.');
  const contract = _buildContract(signer);
  const amountWei = BigInt(await contract.afkingFundingOf(connected));
  if (amountWei <= 0n) throw new Error('There is no AFKing funding to withdraw.');

  const args = [amountWei];
  const sim = await requireStaticCall(contract, 'withdrawAfkingFunding', args, signer);
  if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call withdrawAfkingFunding');

  let receipt;
  try {
    receipt = await sendTx(
      (s) => _buildContract(s).withdrawAfkingFunding(...args),
      'Withdraw AFKing funding',
    );
  } catch (error) {
    // Keep wallet/provider errors intact, but preserve friendly contract copy
    // if the bucket changes after preflight and the real send reverts.
    if (decodeRevertReason(error).code === 'UNKNOWN') throw error;
    throw _structuredRevertError(error, 'send withdrawAfkingFunding');
  }
  return { receipt, amountWei };
}

// ---------------------------------------------------------------------------
// Structured-revert-error helper — verbatim port of Phase 61 claims.js:111-119.
// ---------------------------------------------------------------------------

function _structuredRevertError(error, context) {
  const decoded = decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || `Failed: ${context}`);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

// ---------------------------------------------------------------------------
// purchaseWhaleBundle — BUY-02 — on-chain purchaseWhalePass(buyer, quantity)
// payable. The JS export keeps the purchaseWhaleBundle name (panel call sites
// unchanged); only the contract method name moved.
// ---------------------------------------------------------------------------

/**
 * @param {{quantity: number | bigint, msgValueWei: bigint | string | number}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function purchaseWhaleBundle({ quantity, msgValueWei } = {}) {
  const buyer = getActingAddress();
  if (!buyer) throw new Error('Wallet not connected.');
  let qty;
  try {
    qty = BigInt(quantity);
  } catch (_e) {
    throw new Error('Quantity must be 1-100.');
  }
  if (qty < 1n || qty > 100n) throw new Error('Quantity must be 1-100.');
  const value = BigInt(msgValueWei ?? 0n);

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  // Static-call gate (Phase 56 D-05) — runs only if a signer is available.
  // Trailing overrides ride through staticCall so the sim carries msg.value.
  const affiliateCode = readAffiliateCode(CHAIN.id, buyer);

  if (signer) {
    const c = _buildContract(signer);
    const sim = await requireStaticCall(
      c, 'purchaseWhalePass', [buyer, qty, affiliateCode, { value }], signer,
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call purchaseWhalePass');
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx(
    (s) => _buildContract(s).purchaseWhalePass(buyer, qty, affiliateCode, { value }),
    'Buy whale pass',
  );
  return { receipt };
}

// ---------------------------------------------------------------------------
// purchaseDeityPass — BUY-03 — purchaseDeityPass(buyer, symbolId) payable.
// ---------------------------------------------------------------------------

/**
 * @param {{symbolId: number, msgValueWei: bigint | string | number}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function purchaseDeityPass({ symbolId, msgValueWei } = {}) {
  const buyer = getActingAddress();
  if (!buyer) throw new Error('Wallet not connected.');
  const sid = Number(symbolId);
  if (!Number.isInteger(sid) || sid < 0 || sid > 31) {
    throw new Error('Symbol must be 0-31.');
  }
  const value = BigInt(msgValueWei ?? 0n);

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  if (signer) {
    const c = _buildContract(signer);
    const sim = await requireStaticCall(c, 'purchaseDeityPass', [buyer, sid, { value }], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call purchaseDeityPass');
  }

  const receipt = await sendTx((s) => _buildContract(s).purchaseDeityPass(buyer, sid, { value }), 'Buy deity pass');
  return { receipt };
}

// ---------------------------------------------------------------------------
// deityPassErrorOverride — CONTEXT D-05 LOCKED panel-level 'E' decode override.
//
// WhaleModule.sol:546 throws `revert E()` when `deityBySymbol[symbolId] != 0`,
// so 'E' on the deity-pass path most-likely means "symbol taken." Other 'E'
// triggers (liveness, msg.value mismatch, symbolId out-of-range, buyer-already-
// owns) share the same copy in v4.6 — Pitfall 4 acknowledges this in Deferred
// Ideas (pre-render dim of taken symbols).
//
// The shared reason-map's 'E' registration retains the generic copy for
// non-deity contexts; this override is invoked ONLY in the deity-pass click
// handler at the panel level.
// ---------------------------------------------------------------------------

/**
 * @param {{code: string, userMessage: string, recoveryAction: string} | null | undefined} decoded
 * @returns {{code: string, userMessage: string, recoveryAction: string} | null | undefined}
 */
export function deityPassErrorOverride(decoded) {
  if (decoded?.code === 'E') {
    return {
      code: 'DeityPass-Taken',
      userMessage: "That symbol's taken — try another.",
      recoveryAction: 'Pick a different symbol.',
    };
  }
  return decoded;
}

// ---------------------------------------------------------------------------
// Reason-map registrations — Plan 62-02's 1 NEW code.
//
// Verified at degenerus-audit/contracts/storage/DegenerusGameStorage.sol:213
// (`error RngLocked();`). Phase 56 had it as a comment only per RESEARCH R11;
// deity-pass purchase can throw it during VRF cycles via the rngLockedFlag
// guard at WhaleModule.sol:543.
//
// DOES NOT register `Taken` or `InvalidToken` — Pitfall 3 confirms these are
// dead aliases for Phase 62 BUY paths. The deity-pass override lives at the
// panel/helper level via `deityPassErrorOverride`.
// ---------------------------------------------------------------------------

register('RngLocked', {
  code: 'RngLocked',
  userMessage: 'RNG is locked during settlement. Try again in a few minutes.',
  recoveryAction: 'Wait and retry.',
});

// ---------------------------------------------------------------------------
// The pass paths throw NAMED custom errors, not the `revert E()` this file's
// header assumed — DegenerusGameWhaleModule.sol reverts SymbolTaken,
// InvalidSymbol, AlreadyOwnsDeityPass, InvalidLevelForPass, PassNotExpired,
// MinQuantityRequired, InvalidQuantity, DeityPassConflict and GameOver. None of
// them were registered, so every one of them rendered as the UNKNOWN catch-all.
// deityPassErrorOverride above still maps a legacy 'E' and is left in place;
// SymbolTaken now carries the same copy through the real path.
// ---------------------------------------------------------------------------

register('SymbolTaken', {
  code: 'SymbolTaken',
  userMessage: "That symbol's taken — try another.",
  recoveryAction: 'Pick a different symbol.',
});

register('InvalidSymbol', {
  code: 'InvalidSymbol',
  userMessage: 'That is not a valid symbol.',
  recoveryAction: 'Pick a symbol from the grid.',
});

register('AlreadyOwnsDeityPass', {
  code: 'AlreadyOwnsDeityPass',
  userMessage: 'This wallet already holds a deity pass — there is only one per wallet.',
  recoveryAction: 'Nothing to do.',
});

register('DeityPassConflict', {
  code: 'DeityPassConflict',
  userMessage: 'That deity pass is spoken for.',
  recoveryAction: 'Pick a different symbol.',
});

register('InvalidLevelForPass', {
  code: 'InvalidLevelForPass',
  userMessage: 'The lazy pass is not on sale at this level.',
  recoveryAction: 'It sells at levels 0-2 and at every x9 and x0 level.',
});

register('PassNotExpired', {
  code: 'PassNotExpired',
  userMessage: 'Your current pass is still running.',
  recoveryAction: 'Buy again once it expires.',
});

register('MinQuantityRequired', {
  code: 'MinQuantityRequired',
  userMessage: 'Century levels need at least 2 whale passes in one buy.',
  recoveryAction: 'Raise the quantity to 2 or more.',
});

register('InvalidQuantity', {
  code: 'InvalidQuantity',
  userMessage: 'Quantity must be between 1 and 100.',
  recoveryAction: 'Adjust the quantity and retry.',
});

register('GameOver', {
  code: 'GameOver',
  userMessage: 'The game is over — passes are no longer for sale.',
  recoveryAction: 'Claim anything you are still owed.',
});

register('NoCoin', {
  code: 'NoCoin',
  userMessage: 'An AFKing subscription token is required.',
  recoveryAction: 'Hold a subscription seat token, then retry.',
});

register('NotEligible', {
  code: 'NotEligible',
  userMessage: 'This wallet does not have an AFKing seat claim available.',
  recoveryAction: 'Refresh the pass panel or use the wallet that earned the pass benefit.',
});

register('InvalidTrait', {
  code: 'InvalidTrait',
  userMessage: 'Choose a valid AFKing seat badge.',
  recoveryAction: 'Pick one of the badges in the selector.',
});

register('SupplyCapped', {
  code: 'SupplyCapped',
  userMessage: 'All AFKing subscription seats have been claimed.',
  recoveryAction: 'A seat must be transferred or granted before another can be claimed.',
});

register('SeatForfeited', {
  code: 'SeatForfeited',
  userMessage: 'This AFKing seat was forfeited after its funding ran out.',
  recoveryAction: 'Resolve the forfeited seat before starting another subscription.',
});

register('MustPurchaseToBeginAfking', {
  code: 'MustPurchaseToBeginAfking',
  userMessage: 'Add at least one day of funding to start this subscription.',
  recoveryAction: 'Add enough ETH for the selected daily quantity.',
});

register('NotSubscribed', {
  code: 'NotSubscribed',
  userMessage: 'There is no active AFKing subscription to cancel.',
  recoveryAction: 'Refresh the pass section.',
});

register('AlreadySwept', {
  code: 'AlreadySwept',
  userMessage: 'The final AFKing funding withdrawal window has closed.',
  recoveryAction: 'The game has already completed its final sweep.',
});

register('Insolvent', {
  code: 'Insolvent',
  userMessage: 'That AFKing funding amount is no longer available.',
  recoveryAction: 'Refresh the pass section and retry with the current balance.',
});

register('TransferFailed', {
  code: 'TransferFailed',
  userMessage: 'The AFKing funding transfer back to this wallet failed.',
  recoveryAction: 'Retry from a wallet that can receive ETH.',
});

register('SelfBoon', {
  code: 'SelfBoon',
  userMessage: 'Deity boons have to go to another player.',
  recoveryAction: 'Enter a different wallet address.',
});

register('InvalidSlot', {
  code: 'InvalidSlot',
  userMessage: 'That deity boon slot is not valid.',
  recoveryAction: 'Refresh the pass section.',
});

register('Unauthorized', {
  code: 'Unauthorized',
  userMessage: 'This account cannot use that deity pass.',
  recoveryAction: 'Switch to the wallet that owns the deity pass.',
});

register('RecipientAlreadyBoonedToday', {
  code: 'RecipientAlreadyBoonedToday',
  userMessage: 'That wallet already received a deity boon today.',
  recoveryAction: 'Choose another player.',
});

register('RecipientBoonCapReached', {
  code: 'RecipientBoonCapReached',
  userMessage: 'That wallet has reached your lifetime boon limit.',
  recoveryAction: 'Choose another player.',
});

register('SlotAlreadyUsed', {
  code: 'SlotAlreadyUsed',
  userMessage: 'That boon has already been given away.',
  recoveryAction: 'Choose one of today\'s remaining boons.',
});

register('SmiteeAfkingImmune', {
  code: 'SmiteeAfkingImmune',
  userMessage: 'Active AFKing subscribers cannot be cursed.',
  recoveryAction: 'Choose a player without an active AFKing subscription.',
});

register('SmiteCeilingReached', {
  code: 'SmiteCeilingReached',
  userMessage: 'That player is already at the deity curse limit.',
  recoveryAction: 'Choose another player.',
});

// ---------------------------------------------------------------------------
// purchaseLazyPass — 10-level lazy pass (user ask). Verified:
// DegenerusGame.sol:851 → WhaleModule.sol:403 purchaseLazyPass(buyer) payable.
// Purchasable at levels 0-2, x9 (not x99), x0 (century x00 only during its
// purchase phase), or with a lazy-pass boon; exact msg.value required
// (Σ priceForLevel(startLevel..+9), discounted by boons — the static-call
// gate catches any client-side price mismatch before a tx submits).
// ---------------------------------------------------------------------------

const LAZY_PASS_ABI = [
  // DegenerusGame.sol:1029 — same affiliateCode-in-the-selector story as the
  // whale pass above (0xa86176fa absent on-chain, 0x469387be present).
  'function purchaseLazyPass(address buyer, bytes32 affiliateCode) external payable',
];

function _buildLazyContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, LAZY_PASS_ABI, signerOrProvider);
}

/**
 * @param {{msgValueWei: bigint | string | number}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function purchaseLazyPass({ msgValueWei } = {}) {
  const buyer = getActingAddress();
  if (!buyer) throw new Error('Wallet not connected.');
  const value = BigInt(msgValueWei ?? 0n);

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  const affiliateCode = readAffiliateCode(CHAIN.id, buyer);

  if (signer) {
    const c = _buildLazyContract(signer);
    const sim = await requireStaticCall(
      c, 'purchaseLazyPass', [buyer, affiliateCode, { value }], signer,
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call purchaseLazyPass');
  }

  const receipt = await sendTx(
    (s) => _buildLazyContract(s).purchaseLazyPass(buyer, affiliateCode, { value }),
    'Buy lazy pass',
  );
  return { receipt };
}
