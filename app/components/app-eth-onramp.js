// Conditional native-ETH funding helper. A connected signer with less than
// 0.02 display ETH gets one compact action in the wallet-context slot above
// the play surface. Production opens an external third-party on-ramp; Base
// Sepolia deliberately offers only free test ETH.

import { CHAIN, ETH_DIVISOR } from '../app/chain-config.js';
import { getProvider, TX_CONFIRMED_EVENT } from '../app/contracts.js';
import { displayEthCompact } from '../app/scaling.js';
import { get, subscribe } from '../app/store.js';
import {
  BASE_SEPOLIA_FAUCET_URL,
  isBaseSepolia,
  isTutorialApp,
} from './testnet-beta-banner.js';

export const METAMASK_ETH_BUY_URL = 'https://metamask.io/how-to-buy/ethereum/';
export const LOW_FUNDS_DISPLAY_WEI = 20_000_000_000_000_000n;
const POLL_MS = 30_000;

export function lowFundsThresholdWei(divisor = ETH_DIVISOR) {
  const scale = BigInt(divisor || 1n);
  return (LOW_FUNDS_DISPLAY_WEI + scale - 1n) / scale;
}

export function shouldShowEthFunding({
  connected,
  chainOk,
  balanceWei,
  thresholdWei = lowFundsThresholdWei(),
} = {}) {
  if (!connected || chainOk !== true || balanceWei == null) return false;
  try { return BigInt(balanceWei) < BigInt(thresholdWei); }
  catch (_error) { return false; }
}

export function ethFundingDestination(chain = CHAIN) {
  if (isBaseSepolia(chain)) {
    return {
      mode: 'testnet',
      href: BASE_SEPOLIA_FAUCET_URL,
      title: 'LOW ON TEST ETH',
      note: 'BASE SEPOLIA · FREE TEST FUNDS · NOT REAL MONEY',
      action: 'GET FREE TEST ETH',
      actionLabel: 'Get free Base Sepolia ETH from the Alchemy faucet',
    };
  }
  if (Number(chain?.id) !== 1) return null;
  return {
    mode: 'onramp',
    href: METAMASK_ETH_BUY_URL,
    title: 'LOW ON ETH',
    note: 'METAMASK ON-RAMP · CARD/BANK · FEES & KYC MAY APPLY',
    action: 'BUY ETH',
    actionLabel: 'Buy ETH through the external MetaMask on-ramp',
  };
}

export class AppEthOnramp extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #timer = null;
  #balanceWei = null;
  #balanceAddress = null;
  #seq = 0;
  #txListener = null;
  #focusListener = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.hidden = true;
    this.innerHTML = `
      <span class="eth-onramp__mark" aria-hidden="true">
        <img src="/shared/eth-blue.svg" alt="">
      </span>
      <span class="eth-onramp__copy">
        <strong data-bind="eth-onramp-title">LOW ON ETH</strong>
        <small>
          <b data-bind="eth-onramp-balance">—</b> ETH IN WALLET
          <span data-bind="eth-onramp-note"></span>
        </small>
      </span>
      <a class="eth-onramp__action" data-bind="eth-onramp-action"
         href="${METAMASK_ETH_BUY_URL}" target="_blank"
         rel="noopener noreferrer" referrerpolicy="no-referrer">BUY ETH</a>`;

    this.#unsubs = [
      subscribe('connected.address', () => void this.#refresh()),
      subscribe('ui.chainOk', () => void this.#refresh()),
    ];
    this.#txListener = () => void this.#refresh();
    if (typeof document !== 'undefined') {
      document.addEventListener?.(TX_CONFIRMED_EVENT, this.#txListener);
    }
    this.#focusListener = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        void this.#refresh();
      }
    };
    if (typeof window !== 'undefined') window.addEventListener?.('focus', this.#focusListener);
    if (typeof document !== 'undefined') {
      document.addEventListener?.('visibilitychange', this.#focusListener);
    }
    this.#timer = setInterval(() => void this.#refresh(), POLL_MS);
    try { this.#timer?.unref?.(); } catch (_error) { /* browser timer */ }
    void this.#refresh();
  }

  disconnectedCallback() {
    for (const unsubscribe of this.#unsubs.splice(0)) {
      try { unsubscribe?.(); } catch (_error) { /* defensive */ }
    }
    if (this.#txListener && typeof document !== 'undefined') {
      document.removeEventListener?.(TX_CONFIRMED_EVENT, this.#txListener);
    }
    this.#txListener = null;
    if (this.#focusListener && typeof window !== 'undefined') {
      window.removeEventListener?.('focus', this.#focusListener);
    }
    if (this.#focusListener && typeof document !== 'undefined') {
      document.removeEventListener?.('visibilitychange', this.#focusListener);
    }
    this.#focusListener = null;
    if (this.#timer != null) clearInterval(this.#timer);
    this.#timer = null;
    this.#seq += 1;
    this.#initialized = false;
  }

  async #refresh() {
    const seq = ++this.#seq;
    const connected = get('connected.address');
    const address = connected ? String(connected).toLowerCase() : null;
    if (!address || get('ui.chainOk') !== true) {
      this.#balanceWei = null;
      this.#balanceAddress = address;
      this.#render();
      return;
    }

    const provider = getProvider();
    if (typeof provider?.getBalance !== 'function') {
      this.#balanceWei = null;
      this.#balanceAddress = address;
      this.#render();
      return;
    }

    let balance = null;
    try { balance = BigInt(await provider.getBalance(address)); }
    catch (_error) { balance = null; }
    if (seq !== this.#seq) return;
    if (String(get('connected.address') || '').toLowerCase() !== address) return;
    this.#balanceWei = balance;
    this.#balanceAddress = address;
    this.#render();
  }

  #render() {
    const connected = get('connected.address');
    const address = connected ? String(connected).toLowerCase() : null;
    const tutorial = isTutorialApp(
      typeof window !== 'undefined' ? window.location?.search || '' : '',
    );
    const destination = ethFundingDestination(CHAIN);
    const visible = Boolean(destination) && !tutorial
      && this.#balanceAddress === address
      && shouldShowEthFunding({
        connected: address,
        chainOk: get('ui.chainOk'),
        balanceWei: this.#balanceWei,
      });
    this.hidden = !visible;
    if (!visible) {
      this.setAttribute?.('hidden', '');
      return;
    }
    this.removeAttribute?.('hidden');

    this.dataset.mode = destination.mode;
    const title = this.querySelector('[data-bind="eth-onramp-title"]');
    const balance = this.querySelector('[data-bind="eth-onramp-balance"]');
    const note = this.querySelector('[data-bind="eth-onramp-note"]');
    const action = this.querySelector('[data-bind="eth-onramp-action"]');
    if (title) title.textContent = destination.title;
    if (balance) balance.textContent = displayEthCompact(this.#balanceWei, 4);
    if (note) note.textContent = destination.note;
    if (action) {
      action.href = destination.href;
      action.textContent = destination.action;
      action.setAttribute('aria-label', destination.actionLabel);
      action.title = destination.actionLabel;
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-eth-onramp')) {
  customElements.define('app-eth-onramp', AppEthOnramp);
}
