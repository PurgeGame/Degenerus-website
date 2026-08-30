// Player-facing LINK donation rail. LINK.transferAndCall(ADMIN, amount, 0x)
// invokes DegenerusAdmin.onTokenTransfer, funds the Chainlink subscription,
// and credits the donor with the same amount of mid-day RNG credit.

import { CONTRACTS } from './chain-config.js';
import { ethers, getProvider, sendTx } from './contracts.js';
import { getActingAddress } from './store.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';
import { permissionlessReadProvider } from './read-provider.js';

const LINK_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transferAndCall(address to, uint256 amount, bytes data) returns (bool)',
];

const GAME_CREDIT_ABI = [
  'function middayRngCredits(address account) view returns (uint256)',
  'function mintPrice() view returns (uint256)',
];

const ADMIN_REWARD_ABI = [
  'function coordinator() view returns (address)',
  'function subscriptionId() view returns (uint256)',
  'function linkAmountToEth(uint256 amount) view returns (uint256)',
];

const COORDINATOR_ABI = [
  'function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] consumers)',
];

const TOKEN_WEI = 10n ** 18n;
const LINK_REWARD_LOW_END = 200n * TOKEN_WEI;
const LINK_REWARD_ZERO = 1_000n * TOKEN_WEI;
const PRICE_COIN_UNIT = 1_000n * TOKEN_WEI;

let _contractFactory = null;

function _contract(address, abi, runner) {
  if (_contractFactory) return _contractFactory(address, abi, runner);
  return new ethers.Contract(address, abi, runner);
}

function _structured(error, fallback) {
  const decoded = decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || fallback);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

function _nonnegativeBigInt(value) {
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch (_error) {
    return null;
  }
}

/** Marginal reward multiplier at one subscription balance, scaled by 1e18. */
export function linkDonationMultiplierWei(subscriptionBalanceWei) {
  const balance = _nonnegativeBigInt(subscriptionBalanceWei);
  if (balance == null) return null;
  if (balance >= LINK_REWARD_ZERO) return 0n;
  if (balance <= LINK_REWARD_LOW_END) {
    return (3n * TOKEN_WEI) - ((balance * 2n * TOKEN_WEI) / LINK_REWARD_LOW_END);
  }
  const decline = ((balance - LINK_REWARD_LOW_END) * TOKEN_WEI)
    / (LINK_REWARD_ZERO - LINK_REWARD_LOW_END);
  return decline >= TOKEN_WEI ? 0n : TOKEN_WEI - decline;
}

export function formatLinkDonationMultiplier(multiplierWei) {
  const multiplier = _nonnegativeBigInt(multiplierWei);
  if (multiplier == null) return '—';
  const hundredths = ((multiplier * 100n) + (TOKEN_WEI / 2n)) / TOKEN_WEI;
  const whole = hundredths / 100n;
  const fraction = String(hundredths % 100n).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}×`;
}

function _rewardTrapezoid(lo, hi) {
  if (hi <= lo) return 0n;
  return ((linkDonationMultiplierWei(lo) + linkDonationMultiplierWei(hi)) * (hi - lo)) / 2n;
}

/** Amount-weighted multiplier, matching DegenerusAdmin._linkRewardIntegral. */
export function linkDonationAverageMultiplierWei(subscriptionBalanceWei, amountWei) {
  const balance = _nonnegativeBigInt(subscriptionBalanceWei);
  const amount = _nonnegativeBigInt(amountWei);
  if (balance == null || amount == null) return null;
  if (amount === 0n) return linkDonationMultiplierWei(balance);
  if (balance >= LINK_REWARD_ZERO) return 0n;
  const end = balance + amount > LINK_REWARD_ZERO
    ? LINK_REWARD_ZERO
    : balance + amount;
  let area = 0n;
  if (balance < LINK_REWARD_LOW_END) {
    area += _rewardTrapezoid(balance, end < LINK_REWARD_LOW_END ? end : LINK_REWARD_LOW_END);
  }
  if (end > LINK_REWARD_LOW_END) {
    area += _rewardTrapezoid(
      balance > LINK_REWARD_LOW_END ? balance : LINK_REWARD_LOW_END,
      end,
    );
  }
  return area / amount;
}

/** Snapshot quote for the FLIP credited by a LINK donation. */
export function linkDonationFlipQuote({
  amountWei,
  subscriptionBalanceWei,
  ethPerLinkWei,
  mintPriceWei,
} = {}) {
  const amount = _nonnegativeBigInt(amountWei);
  const subscriptionBalance = _nonnegativeBigInt(subscriptionBalanceWei);
  const ethPerLink = _nonnegativeBigInt(ethPerLinkWei);
  const mintPrice = _nonnegativeBigInt(mintPriceWei);
  if (amount == null || subscriptionBalance == null || ethPerLink == null || mintPrice == null) return null;
  const rewardEnabled = ethPerLink > 0n && mintPrice > 0n;
  const currentMultiplierWei = rewardEnabled
    ? linkDonationMultiplierWei(subscriptionBalance)
    : 0n;
  const averageMultiplierWei = rewardEnabled
    ? linkDonationAverageMultiplierWei(subscriptionBalance, amount)
    : 0n;
  const ethEquivalentWei = (amount * ethPerLink) / TOKEN_WEI;
  const baseFlipWei = mintPrice === 0n ? 0n : (ethEquivalentWei * PRICE_COIN_UNIT) / mintPrice;
  const flipWei = (baseFlipWei * averageMultiplierWei) / TOKEN_WEI;
  return Object.freeze({
    amountWei: amount,
    currentMultiplierWei,
    averageMultiplierWei,
    ethEquivalentWei,
    flipWei,
  });
}

async function _readLinkRewardState(provider, game) {
  if (!CONTRACTS.ADMIN) return null;
  const admin = _contract(CONTRACTS.ADMIN, ADMIN_REWARD_ABI, provider);
  const [coordinatorRead, subscriptionRead, ethPerLinkRead, mintPriceRead] = await Promise.allSettled([
    admin.coordinator(),
    admin.subscriptionId(),
    admin.linkAmountToEth(TOKEN_WEI),
    game.mintPrice(),
  ]);
  const coordinator = coordinatorRead.status === 'fulfilled' ? String(coordinatorRead.value ?? '') : '';
  const subscriptionId = subscriptionRead.status === 'fulfilled'
    ? _nonnegativeBigInt(subscriptionRead.value)
    : null;
  let subscriptionBalanceWei = null;
  if (/^0x[0-9a-f]{40}$/i.test(coordinator)
    && !/^0x0{40}$/i.test(coordinator)
    && subscriptionId != null
    && subscriptionId > 0n) {
    try {
      const subscription = await _contract(coordinator, COORDINATOR_ABI, provider)
        .getSubscription(subscriptionId);
      subscriptionBalanceWei = _nonnegativeBigInt(subscription?.balance ?? subscription?.[0]);
    } catch (_error) { /* the wallet balance and RNG credit remain usable without a quote */ }
  }
  return Object.freeze({
    subscriptionBalanceWei,
    ethPerLinkWei: ethPerLinkRead.status === 'fulfilled'
      ? _nonnegativeBigInt(ethPerLinkRead.value)
      : null,
    mintPriceWei: mintPriceRead.status === 'fulfilled'
      ? _nonnegativeBigInt(mintPriceRead.value)
      : null,
  });
}

/** Wallet LINK and unspent mid-day RNG credit, both denominated in juels. */
export async function readLinkDonationState({ player } = {}) {
  const account = player ?? getActingAddress();
  const wallet = getProvider();
  const provider = _contractFactory && !wallet
    ? null
    : permissionlessReadProvider(wallet);
  if (!account || !provider || !CONTRACTS.LINK_TOKEN || !CONTRACTS.GAME) return null;
  try {
    const link = _contract(CONTRACTS.LINK_TOKEN, LINK_ABI, provider);
    const game = _contract(CONTRACTS.GAME, GAME_CREDIT_ABI, provider);
    const [[balance, credit], reward] = await Promise.all([
      Promise.all([link.balanceOf(account), game.middayRngCredits(account)]),
      _readLinkRewardState(provider, game).catch(() => null),
    ]);
    return {
      balanceWei: BigInt(balance ?? 0),
      creditWei: BigInt(credit ?? 0),
      subscriptionBalanceWei: reward?.subscriptionBalanceWei ?? null,
      ethPerLinkWei: reward?.ethPerLinkWei ?? null,
      mintPriceWei: reward?.mintPriceWei ?? null,
    };
  } catch (_e) {
    return null;
  }
}

/** Donate LINK through its ERC-677 callback rail. */
export async function donateLink({ amount } = {}) {
  let amountWei;
  try { amountWei = BigInt(amount); }
  catch (_e) { throw new Error('Enter a LINK amount to donate.'); }
  if (amountWei <= 0n) throw new Error('Enter a LINK amount to donate.');
  if (!CONTRACTS.LINK_TOKEN || !CONTRACTS.ADMIN) {
    throw new Error('LINK donations are not configured on this network.');
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const link = _contract(CONTRACTS.LINK_TOKEN, LINK_ABI, signer);
    const sim = await requireStaticCall(
      link,
      'transferAndCall',
      [CONTRACTS.ADMIN, amountWei, '0x'],
      signer,
    );
    if (!sim.ok) throw _structured(sim.error, 'LINK donation could not be simulated.');
  }

  const receipt = await sendTx(
    (s) => _contract(CONTRACTS.LINK_TOKEN, LINK_ABI, s)
      .transferAndCall(CONTRACTS.ADMIN, amountWei, '0x'),
    'Fund Chainlink RNG',
  );
  return { receipt, amountWei };
}

export function __setLinkDonationContractFactoryForTest(factory) {
  _contractFactory = typeof factory === 'function' ? factory : null;
}

export function __resetLinkDonationForTest() {
  _contractFactory = null;
}
