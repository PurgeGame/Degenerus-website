// /app/app/lootbox.js — Phase 60 Plan 60-02 (LBX-01 + LBX-04 write path).
//
// First production consumer of Phase 56 (static-call + reason-map + scaling) and
// Phase 58 (sendTx chokepoint + requireSelf guard) primitives end-to-end on a write
// surface. Generalizes /beta/mint.js:1110-1119 receipt-log-parsing pattern into
// reusable parsers for LootBoxIdx (purchase event) + TraitsGenerated (open event).
//
// Plan 60-02 ships the helpers; Plan 60-03 wires RNG polling lifecycle + Open click
// → reveal animation. Plan 60-04 adds chainId-scoped localStorage idempotency +
// boot CTA + URL-param affiliate read.
//
// CONTEXT D-01 + D-02 + D-04 wave shape; CONTEXT D-03 receipt-log-first reveal pattern.
//
// MANDATORY closure form for every sendTx call (Phase 58 verified by grep gate):
//   CORRECT:   sendTx( (s) => new Contract(addr, ABI, s).method(args), 'Action' )
//   FORBIDDEN: passing a pre-resolved tx promise — captures stale signer.

import { sendTx, getProvider, ethers, requireSelf } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';
import { get } from './store.js';
import { CONTRACTS, CHAIN } from './chain-config.js';

// Phase 63 Plan 63-02 (D-02 LOCKED) — pre-warm cache TTL.
// CONTEXT specifics line 268 — 30s matches Phase 56 polling baseline.
// Caller (app-packs-panel.js) compares Date.now() vs returned `expiresAt`
// and falls back to the legacy await sendTx path on stale cache (R11).
const PREWARM_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// GAME_ABI fragment — minimal human-readable ABI for Phase 60 surface.
// Drawn from /beta/mint.js:39-65 patterns + verified contract signatures:
//   - purchase / purchaseCoin     contracts/DegenerusGame.sol:501,546
//   - openLootBox / openBurnieLootBox  contracts/DegenerusGame.sol:665+
//   - lootboxRngWord (view)        /beta/mint.js:60 ABI string (storage:1370 mapping)
//   - LootBoxBuy / LootBoxIdx / BurnieLootBuy
//                                  contracts/modules/DegenerusGameMintModule.sol:128-144
//   - TraitsGenerated              contracts/storage/DegenerusGameStorage.sol:484
// ---------------------------------------------------------------------------

export const GAME_ABI = [
  // Writes
  'function purchase(address buyer, uint256 ticketQuantity, uint256 lootBoxAmount, bytes32 affiliateCode, uint8 payKind) payable',
  'function purchaseCoin(address buyer, uint256 ticketQuantity, uint256 lootBoxBurnieAmount)',
  'function openLootBox(address player, uint48 lootboxIndex)',
  'function openBurnieLootBox(address player, uint48 lootboxIndex)',
  // Views
  'function lootboxRngWord(uint48 lootboxIndex) view returns (uint256 word)',
  // Events
  'event LootBoxBuy(address indexed buyer, uint32 indexed day, uint256 amount, bool presale, uint24 level)',
  'event LootBoxIdx(address indexed buyer, uint32 indexed index, uint32 indexed day)',
  'event BurnieLootBuy(address indexed buyer, uint32 indexed index, uint256 burnieAmount)',
  'event TraitsGenerated(address indexed player, uint24 indexed level, uint32 queueIdx, uint32 startIndex, uint32 count, uint256 entropy)',
];

// ---------------------------------------------------------------------------
// Constants — verified from contracts/modules/DegenerusGameMintModule.sol:99-101
// and contracts/interfaces/IDegenerusGame.sol:6.
// ---------------------------------------------------------------------------

/** MintPaymentKind.DirectEth — Phase 60 ALWAYS passes 0 for ETH purchases. */
export const MINT_PAYMENT_KIND_DIRECT_ETH = 0;
/** Lower bound on lootBoxAmount in ETH purchases (LOOTBOX_MIN = 0.01 ether). */
export const LOOTBOX_MIN_WEI = ethers.parseEther('0.01');
/** Lower bound on lootBoxBurnieAmount (BURNIE_LOOTBOX_MIN = 1000 ether). */
export const BURNIE_LOOTBOX_MIN_WEI = ethers.parseEther('1000');

// ---------------------------------------------------------------------------
// Test seam — production path uses default `new ethers.Contract(...)`.
// Tests inject a fake via __setContractFactoryForTest; reset via __resetContractFactoryForTest.
// ---------------------------------------------------------------------------

let _contractFactory = null;

/** Test-only: replace the `new Contract(...)` construction with a fake. */
export function __setContractFactoryForTest(fn) {
  _contractFactory = fn;
}

/** Test-only: clear the injected factory; subsequent calls use the real path. */
export function __resetContractFactoryForTest() {
  _contractFactory = null;
}

function _buildContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, GAME_ABI, signerOrProvider);
}

function _readBuyer() {
  const buyer = get('connected.address');
  if (!buyer) throw new Error('Wallet not connected.');
  return buyer;
}

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
// purchaseEth — purchase() with payKind=DirectEth (ETH-paid combo: tickets+lootboxes).
// CONTEXT D-01 step 1 + D-04 wave 2.
//
// Contract NatSpec (DegenerusGame.sol:497): ticketQuantity has 2 decimals, scaled by 100.
// Plan 60-02 multiplies the user-facing integer by 100 before passing.
// ---------------------------------------------------------------------------

/**
 * @param {{ticketQuantity: number, lootboxQuantity: number, affiliateCode?: string, lootBoxAmountWei?: bigint}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt, contract: import('ethers').Contract}>}
 */
export async function purchaseEth(args) {
  const buyer = _readBuyer();
  const ticketQuantity = Number(args.ticketQuantity ?? 0);
  const lootboxQuantity = Number(args.lootboxQuantity ?? 0);
  // Plan 60-04: auto-read affiliate code from chainId-scoped localStorage when caller
  // omits explicit value. Widget call site is `purchaseEth({ticketQuantity, lootboxQuantity})`
  // — affiliate plumbing is invisible per CONTEXT D-05 (no UI element in Phase 60).
  const affiliateCode = args.affiliateCode ?? readAffiliateCode(CHAIN.id, buyer);
  // Default lootBoxAmountWei = LOOTBOX_MIN_WEI × N. Plan 60-04 may upgrade by reading
  // mintPrice() from chain to honor higher tiers; Plan 60-02 uses the contract minimum.
  const lootBoxAmountWei = args.lootBoxAmountWei
    ?? (LOOTBOX_MIN_WEI * BigInt(Math.max(0, lootboxQuantity)));

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  // Static-call gate (Phase 56 D-05) — runs only if a signer is available.
  if (signer) {
    const contract = _buildContract(signer);
    const sim = await requireStaticCall(
      contract,
      'purchase',
      [buyer, BigInt(ticketQuantity) * 100n, lootBoxAmountWei, affiliateCode, MINT_PAYMENT_KIND_DIRECT_ETH],
      signer
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call purchase');
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx(
    (s) => {
      const c = _buildContract(s);
      return c.purchase(
        buyer,
        BigInt(ticketQuantity) * 100n,
        lootBoxAmountWei,
        affiliateCode,
        MINT_PAYMENT_KIND_DIRECT_ETH,
        { value: lootBoxAmountWei }
      );
    },
    'Buy lootbox (ETH)'
  );

  // Build a contract bound to the provider (signer-free) for log parsing.
  const contract = _buildContract(provider);
  return { receipt, contract };
}

// ---------------------------------------------------------------------------
// purchaseCoin — purchaseCoin() (BURNIE-paid combo). NO affiliateCode arg.
// CONTEXT D-01 step 1: protocol's contracts trust each other; NO ERC20 approval flow.
// Verified at contracts/DegenerusGame.sol:546.
// ---------------------------------------------------------------------------

/**
 * @param {{ticketQuantity: number, lootboxQuantity: number, lootBoxBurnieAmountWei?: bigint}} args
 * @returns {Promise<{receipt, contract}>}
 */
export async function purchaseCoin(args) {
  const buyer = _readBuyer();
  const ticketQuantity = Number(args.ticketQuantity ?? 0);
  const lootboxQuantity = Number(args.lootboxQuantity ?? 0);
  const lootBoxBurnieAmountWei = args.lootBoxBurnieAmountWei
    ?? (BURNIE_LOOTBOX_MIN_WEI * BigInt(Math.max(0, lootboxQuantity)));

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  if (signer) {
    const contract = _buildContract(signer);
    const sim = await requireStaticCall(
      contract,
      'purchaseCoin',
      [buyer, BigInt(ticketQuantity) * 100n, lootBoxBurnieAmountWei],
      signer
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call purchaseCoin');
  }

  // No msg.value — BURNIE is not native.
  const receipt = await sendTx(
    (s) => {
      const c = _buildContract(s);
      return c.purchaseCoin(
        buyer,
        BigInt(ticketQuantity) * 100n,
        lootBoxBurnieAmountWei
      );
    },
    'Buy lootbox (BURNIE)'
  );

  const contract = _buildContract(provider);
  return { receipt, contract };
}

// ---------------------------------------------------------------------------
// openLootBox — routes to openLootBox() vs openBurnieLootBox() by payKind.
// CONTEXT D-02 step 5. Verified at contracts/DegenerusGame.sol:665.
// ---------------------------------------------------------------------------

/**
 * @param {{lootboxIndex: bigint | number, payKind: 'ETH' | 'BURNIE'}} args
 * @returns {Promise<{receipt, contract}>}
 */
export async function openLootBox(args) {
  const player = _readBuyer();
  const lootboxIndex = BigInt(args.lootboxIndex);
  const methodName = args.payKind === 'BURNIE' ? 'openBurnieLootBox' : 'openLootBox';

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  if (signer) {
    const contract = _buildContract(signer);
    const sim = await requireStaticCall(
      contract,
      methodName,
      [player, lootboxIndex],
      signer
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, `static-call ${methodName}`);
  }

  const receipt = await sendTx(
    (s) => {
      const c = _buildContract(s);
      return c[methodName](player, lootboxIndex);
    },
    `Open lootbox (${args.payKind})`
  );

  const contract = _buildContract(provider);
  return { receipt, contract };
}

// ---------------------------------------------------------------------------
// parseLootboxIdxFromReceipt — extracts {lootboxIndex, day, payKind} per emitted
// LootBoxIdx (ETH) or BurnieLootBuy (BURNIE) event. Generalized from
// /beta/mint.js:1110-1119. CONTEXT D-03 + LBX-04 receipt-log-first source of truth.
//
// Event signatures verified at contracts/modules/DegenerusGameMintModule.sol:135,140:
//   event LootBoxIdx(address indexed buyer, uint32 indexed index, uint32 indexed day)
//   event BurnieLootBuy(address indexed buyer, uint32 indexed index, uint256 burnieAmount)
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {import('ethers').Contract} contract
 * @returns {Array<{lootboxIndex: bigint, day: bigint | null, payKind: 'ETH' | 'BURNIE'}>}
 */
export function parseLootboxIdxFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (let i = 0; i < receipt.logs.length; i++) {
    try {
      const parsed = contract.interface.parseLog(receipt.logs[i]);
      if (!parsed) continue;
      if (parsed.name === 'LootBoxIdx') {
        out.push({
          lootboxIndex: BigInt(parsed.args.index ?? parsed.args[1]),
          day: BigInt(parsed.args.day ?? parsed.args[2]),
          payKind: 'ETH',
        });
      } else if (parsed.name === 'BurnieLootBuy') {
        out.push({
          lootboxIndex: BigInt(parsed.args.index ?? parsed.args[1]),
          day: null,
          payKind: 'BURNIE',
        });
      }
    } catch (_e) {
      // skip non-matching logs (foreign contracts, unknown events)
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// parseTraitsGeneratedFromReceipt — extracts trait reveal data from openLootBox
// receipts. CONTEXT LBX-04: source of truth for "what did the player get."
// Event signature verified at contracts/storage/DegenerusGameStorage.sol:484:
//   event TraitsGenerated(address indexed player, uint24 indexed level,
//                         uint32 queueIdx, uint32 startIndex, uint32 count, uint256 entropy)
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {import('ethers').Contract} contract
 * @returns {Array<{player: string, level: bigint, queueIdx: bigint, startIndex: bigint, count: bigint, entropy: bigint}>}
 */
export function parseTraitsGeneratedFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (let i = 0; i < receipt.logs.length; i++) {
    try {
      const parsed = contract.interface.parseLog(receipt.logs[i]);
      if (parsed && parsed.name === 'TraitsGenerated') {
        out.push({
          player: String(parsed.args.player ?? parsed.args[0]),
          level: BigInt(parsed.args.level ?? parsed.args[1]),
          queueIdx: BigInt(parsed.args.queueIdx ?? parsed.args[2]),
          startIndex: BigInt(parsed.args.startIndex ?? parsed.args[3]),
          count: BigInt(parsed.args.count ?? parsed.args[4]),
          entropy: BigInt(parsed.args.entropy ?? parsed.args[5]),
        });
      }
    } catch (_e) {
      // skip
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// pollRngForLootbox — view call to lootboxRngWord(uint48); returns 0n if not ready.
// Plan 60-03 widget polling lifecycle wraps in interval + AbortController-per-cycle.
// Backed by storage at contracts/storage/DegenerusGameStorage.sol:1370 mapping.
// ---------------------------------------------------------------------------

/**
 * @param {bigint | number} lootboxIndex
 * @returns {Promise<bigint>} 0n if RNG not yet fulfilled OR no provider configured.
 */
export async function pollRngForLootbox(lootboxIndex) {
  const provider = getProvider();
  if (!provider) return 0n;
  const contract = _buildContract(provider);
  const word = await contract.lootboxRngWord(BigInt(lootboxIndex));
  return BigInt(word);
}

// ---------------------------------------------------------------------------
// Plan 60-04 — affiliate-code helpers (LBX-03 + CONTEXT D-05).
// chainId-scoped localStorage; URL ?ref= on first visit; ZeroHash fallback.
//
// Pattern mirrors /beta/mint.js:170-189 getAffiliateCode() but with the format
// flip locked-in by CONTEXT D-05 step 1: the URL param is already bytes32hex
// (regex /^0x[a-fA-F0-9]{64}$/) — no encodeBytes32String conversion. Persist
// as-is; pass directly to the contract's purchase() affiliateCode arg.
//
// purchaseCoin signature (verified at contracts/DegenerusGame.sol:546) does
// NOT accept affiliateCode — BURNIE purchases bypass affiliation per protocol.
// These helpers are read by purchaseEth ONLY.
// ---------------------------------------------------------------------------

/**
 * Read persisted affiliate code from chainId-scoped localStorage.
 * @param {number} chainId
 * @param {string} address  Will be lowercased for key consistency.
 * @returns {string} bytes32 hex (validated) or ethers.ZeroHash.
 */
export function readAffiliateCode(chainId, address) {
  if (!address) return ethers.ZeroHash;
  try {
    const key = `affiliate-code:${chainId}:${String(address).toLowerCase()}`;
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(key) : null;
    if (raw && /^0x[a-fA-F0-9]{64}$/.test(raw)) return raw;
  } catch (_e) { /* private mode / quota — defensive (Pitfall F) */ }
  return ethers.ZeroHash;
}

/**
 * Read URL ?ref=<bytes32hex> param and persist to chainId-scoped localStorage.
 * Idempotent — only writes if URL has a valid bytes32hex param. CONTEXT D-05
 * step 1: invalid format silently ignored.
 * @param {number} chainId
 * @param {string} address
 * @returns {boolean} true if persisted, false otherwise.
 */
export function persistAffiliateCodeFromUrl(chainId, address) {
  if (!address) return false;
  try {
    if (typeof location === 'undefined' || !location.href) return false;
    const url = new URL(location.href);
    const ref = url.searchParams.get('ref');
    if (!ref) return false;
    if (!/^0x[a-fA-F0-9]{64}$/.test(ref)) return false;
    const key = `affiliate-code:${chainId}:${String(address).toLowerCase()}`;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, ref);
      return true;
    }
  } catch (_e) { /* quota / disabled — defensive (Pitfall F) */ }
  return false;
}

// ---------------------------------------------------------------------------
// Phase 63 Plan 63-02 (D-02 LOCKED) — iOS Safari user-gesture pre-warm.
//
// Pre-warm lootbox purchase tx params BEFORE the click. Click handler in
// app-packs-panel.js invokes `buildTx()` SYNCHRONOUSLY — no await between
// gesture and `signer.sendTransaction`. This preserves the user-gesture
// activation window so the WC SDK's universal-link to MetaMask Mobile fires
// without surfacing Safari's "Open MetaMask?" confirm prompt (Pitfall 12
// canonical mitigation per Reown Mobile Linking docs + WC #1165).
//
// SCOPE LOCKED to lootbox panel only (CONTEXT D-02). The 10 sibling panels
// continue using the existing `await sendTx(...)` path — accept the standard
// "Open MetaMask?" Safari prompt as documented cost-of-business. MM in-dApp
// browser sidesteps the issue entirely and is the supported mobile path.
//
// THIS IS THE ONE PRODUCTION SITE WHERE THE PHASE 58 CLOSURE-FORM `sendTx`
// CHOKEPOINT IS BYPASSED AT THE CLICK MOMENT. `requireSelf()` is invoked HERE
// at pre-warm time before deriving signer — devtools-bypass defense preserved.
// `requireStaticCall` is also lifted out of the click moment to pre-warm.
//
// ETH path → `contract.purchase.populateTransaction(...)` (method-attached
//   v6 form per RESEARCH F-4; the v5 form `contract.populateTransaction[purchase](...)`
//   is FORBIDDEN — only the v6 documented method-attached form is used).
// BURNIE path → `contract.purchaseCoin.populateTransaction(...)` (the BURNIE
//   sibling — separate function, no payKind argument, no msg.value override
//   per contracts/DegenerusGame.sol:546). The plan acknowledged that
//   MINT_PAYMENT_KIND_DIRECT_BURNIE does not exist; the correct shape for
//   BURNIE is the dedicated purchaseCoin() entrypoint.
// ---------------------------------------------------------------------------

/**
 * Pre-warm lootbox purchase tx params for synchronous click-time send.
 *
 * @param {{ticketQuantity:number, lootboxQuantity:number, payKind:'ETH'|'BURNIE',
 *          affiliateCode?:string, lootBoxAmountWei?:bigint,
 *          lootBoxBurnieAmountWei?:bigint}} args
 * @returns {Promise<{buildTx:()=>Promise<import('ethers').TransactionResponse>,
 *                    abort:()=>void, expiresAt:number}>}
 */
export async function prewarmLootboxBuy(args) {
  // 1. Devtools-bypass defense — runs BEFORE any provider/signer derivation.
  //    Pre-warm bypasses the sendTx chokepoint at click moment but still
  //    honors requireSelf semantics here (T-58-02 + T-63-02-02 mitigation).
  requireSelf();

  const provider = getProvider();
  if (!provider) throw new Error('Wallet not connected.');
  const signer = await provider.getSigner();
  const buyer = (await signer.getAddress()).toLowerCase();

  const contract = _buildContract(signer);
  const ticketsScaled = BigInt(Math.max(0, Number(args.ticketQuantity ?? 0))) * 100n;

  let unsignedTx;
  let staticCallMethod;
  let staticCallArgs;

  if (args.payKind === 'BURNIE') {
    // BURNIE path — purchaseCoin() takes (buyer, ticketQuantity*100, burnieAmount).
    // No affiliateCode arg, no msg.value (BURNIE is not native).
    const lootBoxBurnieAmountWei = args.lootBoxBurnieAmountWei
      ?? (BURNIE_LOOTBOX_MIN_WEI * BigInt(Math.max(0, Number(args.lootboxQuantity ?? 0))));
    unsignedTx = await contract.purchaseCoin.populateTransaction(
      buyer, ticketsScaled, lootBoxBurnieAmountWei
    );
    staticCallMethod = 'purchaseCoin';
    staticCallArgs = [buyer, ticketsScaled, lootBoxBurnieAmountWei];
  } else {
    // ETH path — purchase() with payKind=DirectEth (0). msg.value = lootBoxAmount.
    const lootBoxAmountWei = args.lootBoxAmountWei
      ?? (LOOTBOX_MIN_WEI * BigInt(Math.max(0, Number(args.lootboxQuantity ?? 0))));
    const affiliateCode = args.affiliateCode ?? readAffiliateCode(CHAIN.id, buyer);
    unsignedTx = await contract.purchase.populateTransaction(
      buyer, ticketsScaled, lootBoxAmountWei, affiliateCode, MINT_PAYMENT_KIND_DIRECT_ETH,
      { value: lootBoxAmountWei }
    );
    staticCallMethod = 'purchase';
    staticCallArgs = [buyer, ticketsScaled, lootBoxAmountWei, affiliateCode, MINT_PAYMENT_KIND_DIRECT_ETH];
  }

  // 2. Static-call pre-flight (Phase 56 D-05) — lifted out of the click moment.
  //    On revert: throw structured error; caller disables Buy button with the
  //    decoded reason inline (T-63-02-03 mitigation). Click handler is gated
  //    on a non-null #prewarmedTx, so this guarantees the click only fires
  //    when the static-call gate has already passed.
  const sim = await requireStaticCall(contract, staticCallMethod, staticCallArgs, signer);
  if (!sim.ok) throw _structuredRevertError(sim.error, `pre-warm ${staticCallMethod}`);

  // 3. Pre-estimate gas (best-effort). signer.sendTransaction re-estimates
  //    internally if we omit gasLimit, but pre-fetching shaves the round-trip
  //    out of the click moment. Graceful fallback on rejection.
  const estimatedGas = await signer.estimateGas(unsignedTx).catch(() => null);
  if (estimatedGas) unsignedTx.gasLimit = estimatedGas;

  let aborted = false;
  return {
    buildTx: () => {
      if (aborted) throw new Error('Pre-warm stale — recompute.');
      // SYNCHRONOUS — no `await` here. signer.sendTransaction internally
      // populates remaining fields (chainId, nonce, fees) — verified ethers
      // v6 docs. The Promise<TransactionResponse> is returned immediately;
      // the click handler chains .then(tx => tx.wait()) without awaiting.
      return signer.sendTransaction(unsignedTx);
    },
    abort: () => { aborted = true; },
    expiresAt: Date.now() + PREWARM_TTL_MS,
  };
}
