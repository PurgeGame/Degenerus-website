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

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';
import { get } from './store.js';
import { CONTRACTS } from './chain-config.js';

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
  const affiliateCode = args.affiliateCode ?? ethers.ZeroHash;
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
