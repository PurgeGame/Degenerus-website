// /app/app/wallet.js — Phase 58 Plan 01 wallet stack (WLT-01..03).
//
// EIP-6963 discovery via ethers v6 BrowserProvider.discover({timeout, filter}) —
// replaces the raw eip6963:announceProvider listener + setTimeout(500) race-wait
// pattern from /beta/app/wallet.js with deterministic ethers-managed dedup + filter.
//
// rdns persistence ONLY — rdns is the schema-stable wallet identifier per EIP-6963
// (T-58-04 + T-58-08). The address-based and uuid-based persistence keys used by
// /beta/ are intentionally NOT persisted here (uuid is per-session ephemeral; an
// address as the lookup key cannot survive an account switch within the same wallet).
//
// autoReconnect uses eth_accounts (silent, no popup) — eth_requestAccounts is
// reserved for explicit user "Connect" clicks via connectWithPicker.
//
// accountsChanged + chainChanged + disconnect listeners call polling.abortAllInflight()
// before mutating store, so stale fetches cannot land on the post-change wallet.
// chainChanged does NOT trigger a page refresh — preserves ?as= URL state and view-mode
// for users who cold-loaded with a deep link (T-58-06).
//
// Account-switcher extension (2026-07-16): every disconnect reset block (accountsChanged
// empty-list branch, the 'disconnect' EIP-1193 event, the explicit disconnect() export,
// and the nav.js wallet-disconnected bridge) ALSO clears approvals.list to []. This is
// the single owner of that clear — polling.js only WRITES approvals.list from the
// /approvers fetch; it never clears it, since polling.js's stop()/pauseAllTimers is
// timer-only and has no store-reset responsibility elsewhere either.
//
// Bidirectional bridge with /shared/nav.js: listens for `wallet-connected` /
// `wallet-disconnected` CustomEvents (defensive idempotency, no re-emit loop —
// T-58-07) and dispatches them on /app/-driven connect/disconnect flows.
//
// Three structural changes vs /beta/app/wallet.js (the analog):
//   1. discovery: raw eip6963:announceProvider listener → BrowserProvider.discover
//   2. persistence: rdns OR uuid → rdns ONLY (uuid is per-session ephemeral)
//   3. auto-reconnect: setTimeout(500) race → discover({filter: byRdns}, deterministic)
// And one preserved pattern: nav.js bridge events (verbatim from /beta/ L193-208).

import { BrowserProvider } from 'ethers';
import { CHAIN, WALLETCONNECT_PROJECT_ID } from './chain-config.js';
import { update, get } from './store.js';
import {
  setProvider,
  getProvider,
  clearProvider,
  setChainSwitchHandler,
  setWalletSessionRecoveryHandler,
  switchToSepolia,
  switchToSepoliaResult,
} from './contracts.js';
import { abortAllInflight } from './polling.js';

// ---------------------------------------------------------------------------
// Picker resolver — module-scope Promise resolver for wallet-picker.js click
// (RESEARCH §Pattern 1, lines 187-218).
// ---------------------------------------------------------------------------

let _pickerResolve = null;

// ---------------------------------------------------------------------------
// Raw EIP-1193 handles.
//
// ethers v6 stores the injected wallet object in a PRIVATE field (#request) and
// AbstractProvider's `.provider` getter returns `this`. So
// `browserProvider.provider` IS the BrowserProvider, not the wallet:
// `.request(...)` does not exist on it, and `.on('accountsChanged')` reaches
// ethers' own event system, whose async `on()` rejects with "unknown
// ProviderEvent". That silently broke both halves of every explicit connect —
// the account request threw, and the lifecycle listeners were never attached.
//
// The announced provider objects are therefore captured here as they arrive and
// looked up by the EIP-6963 identifiers ethers does hand back on `providerInfo`.
// ---------------------------------------------------------------------------

const _announced = new Map();   // uuid and rdns → the announced EIP-1193 object
let _eip1193 = null;            // raw provider backing the live connection

function _captureAnnounce(event) {
  const detail = event && event.detail;
  if (!detail || !detail.provider || !detail.info) return;
  if (detail.info.uuid) _announced.set(detail.info.uuid, detail.provider);
  if (detail.info.rdns) _announced.set(detail.info.rdns, detail.provider);
}

// Announcements are re-emitted on every `eip6963:requestProvider`, including the
// ones ethers' own discover() dispatches, so listening from module load is
// enough to have the object by the time discover resolves.
(function _watchAnnounces() {
  const win = (typeof globalThis !== 'undefined') ? globalThis.window : null;
  if (!win || typeof win.addEventListener !== 'function') return;
  win.addEventListener('eip6963:announceProvider', _captureAnnounce);
  try { win.dispatchEvent(new Event('eip6963:requestProvider')); } catch (_e) { /* headless */ }
}());

/**
 * The EIP-1193 object behind a BrowserProvider, best effort:
 * the explicit handle, then the EIP-6963 capture by uuid/rdns, then a `.provider`
 * that is genuinely a DISTINCT object (test doubles and the WalletConnect
 * provider, never real ethers, whose getter self-references), then window.ethereum.
 */
function _rawFor(browserProvider, explicit = null) {
  if (explicit && typeof explicit.request === 'function') return explicit;
  const info = browserProvider && browserProvider.providerInfo;
  if (info) {
    const byUuid = info.uuid && _announced.get(info.uuid);
    if (byUuid) return byUuid;
    const byRdns = info.rdns && _announced.get(info.rdns);
    if (byRdns) return byRdns;
  }
  const inner = browserProvider && browserProvider.provider;
  if (inner && inner !== browserProvider && typeof inner.request === 'function') return inner;
  const win = (typeof globalThis !== 'undefined') ? globalThis.window : null;
  return (win && win.ethereum) || null;
}

/** Ask the wallet directly when we hold it, else through ethers' public send(). */
async function _rpc(browserProvider, eth, method) {
  try {
    if (eth && typeof eth.request === 'function') return await eth.request({ method });
    return await browserProvider.send(method, []);
  } catch (_e) {
    return [];
  }
}

/** The raw EIP-1193 provider for the live connection (null when disconnected). */
export function getEip1193() {
  return _eip1193;
}

// WalletConnect publishes a signing request asynchronously, after the tap
// that started it has lost browser "user activation". Mobile popup blockers
// can therefore discard the SDK's new-tab redirect. Once the request is on
// the relay, navigate this tab to the wallet's exact request deep link instead.
const WC_DEEPLINK_CHOICE_KEY = 'WALLETCONNECT_DEEPLINK_CHOICE';
const WC_REQUEST_SENT_EVENT = 'session_request_sent';
const WC_HANDOFF_FALLBACK_TIMEOUT_MS = 10 * 60 * 1000;
const WC_APPROVAL_METHODS = new Set([
  'eth_sendTransaction',
  'eth_sign',
  'eth_signTransaction',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'personal_sign',
  'wallet_addEthereumChain',
  'wallet_sendCalls',
  'wallet_switchEthereumChain',
  'wallet_watchAsset',
]);
const _wcAutomaticHandoffClients = new WeakSet();
let _wcPendingApprovalHandoff = null;
let _wcApprovalHandoffTimer = null;
let _wcApprovalPageWasHidden = false;

function _isMobileWalletHandoffContext() {
  const win = (typeof globalThis !== 'undefined') ? globalThis.window : null;
  try {
    if (win?.matchMedia?.('(pointer:coarse)')?.matches) return true;
  } catch (_e) { /* user-agent fallback below */ }
  const nav = (typeof globalThis !== 'undefined') ? globalThis.navigator : null;
  if (nav?.userAgentData?.mobile === true) return true;
  if (nav?.platform === 'MacIntel' && Number(nav?.maxTouchPoints) > 1) return true;
  return /Android|webOS|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i
    .test(String(nav?.userAgent || ''));
}

function _safeWalletDeepLink(value) {
  const href = typeof value === 'string' ? value.trim() : '';
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (!match) return '';
  const protocol = match[1].toLowerCase();
  if (['javascript', 'data', 'vbscript', 'file', 'blob'].includes(protocol)) return '';
  return href;
}

function _walletConnectDeepLinkChoice(provider) {
  let stored = null;
  try {
    const raw = globalThis.localStorage?.getItem?.(WC_DEEPLINK_CHOICE_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch (_e) { /* use the connected wallet's session metadata below */ }

  const peerMetadata = provider?.session?.peer?.metadata;
  const redirect = peerMetadata?.redirect;
  const href = _safeWalletDeepLink(stored?.href)
    || _safeWalletDeepLink(redirect?.native)
    || _safeWalletDeepLink(redirect?.universal);
  if (!href) return null;

  const rawName = String(stored?.name || peerMetadata?.name || 'Wallet').trim();
  const walletName = rawName && rawName.length <= 24 ? rawName : 'Wallet';
  return { href, walletName };
}

function _formatWalletConnectRequestDeepLink(baseHref, requestId, sessionTopic) {
  const base = String(baseHref).endsWith('/')
    ? String(baseHref).slice(0, -1)
    : String(baseHref);
  return `${base}/wc?requestId=${encodeURIComponent(String(requestId))}`
    + `&sessionTopic=${encodeURIComponent(String(sessionTopic))}`;
}

function _openWalletDeepLinkInPlace(href) {
  const win = (typeof globalThis !== 'undefined') ? globalThis.window : null;
  if (!win || !_safeWalletDeepLink(href)) return false;

  // Top-level navigation is not a popup and remains available after the
  // original click's transient activation has expired.
  try {
    if (typeof win.location?.assign === 'function') {
      win.location.assign(href);
      return true;
    }
  } catch (_e) { /* `_self` fallback below */ }

  try {
    if (typeof win.open === 'function') {
      return win.open(href, '_self', 'noreferrer noopener') !== null;
    }
  } catch (_e) { /* unsupported host/browser */ }
  return false;
}

function _walletApprovalHandoffHost() {
  const doc = (typeof globalThis !== 'undefined') ? globalThis.document : null;
  try { return doc?.getElementById?.('wallet-approval-handoff') || null; }
  catch (_e) { return null; }
}

function _clearWalletApprovalHandoff(requestKey = null) {
  if (requestKey && _wcPendingApprovalHandoff?.requestKey !== requestKey) return;
  _wcPendingApprovalHandoff = null;
  _wcApprovalPageWasHidden = false;
  if (_wcApprovalHandoffTimer != null) {
    try { clearTimeout(_wcApprovalHandoffTimer); } catch (_e) { /* headless */ }
    _wcApprovalHandoffTimer = null;
  }
  const host = _walletApprovalHandoffHost();
  if (host) host.hidden = true;
}

// External-app navigation is ultimately controlled by the phone OS. Keep the
// exact already-published request behind a real button so a fresh user gesture
// can recover when an automatic universal-link handoff is ignored.
function _showWalletApprovalHandoff({ href, walletName, requestKey }) {
  const host = _walletApprovalHandoffHost();
  const label = host?.querySelector?.('[data-bind="wallet-approval-label"]');
  const action = host?.querySelector?.('[data-bind="wallet-approval-open"]');
  const dismiss = host?.querySelector?.('[data-bind="wallet-approval-dismiss"]');
  if (!host || !label || !action || !dismiss || !_safeWalletDeepLink(href)) return false;

  _clearWalletApprovalHandoff();
  _wcPendingApprovalHandoff = { href, requestKey };
  label.textContent = `Approval waiting in ${walletName}`;
  action.textContent = `OPEN ${String(walletName).toUpperCase()}`;
  action.setAttribute?.('aria-label', `Open ${walletName} to review the pending approval`);
  action.onclick = (event) => {
    try { event?.preventDefault?.(); } catch (_e) { /* defensive */ }
    if (_wcPendingApprovalHandoff?.requestKey !== requestKey) return;
    _openWalletDeepLinkInPlace(href);
  };
  dismiss.onclick = (event) => {
    try { event?.preventDefault?.(); } catch (_e) { /* defensive */ }
    _clearWalletApprovalHandoff(requestKey);
  };
  host.hidden = false;

  _wcApprovalHandoffTimer = setTimeout(
    () => _clearWalletApprovalHandoff(requestKey),
    WC_HANDOFF_FALLBACK_TIMEOUT_MS,
  );
  _wcApprovalHandoffTimer?.unref?.();
  return true;
}

function _installWalletApprovalHandoffLifecycle() {
  const doc = (typeof globalThis !== 'undefined') ? globalThis.document : null;
  if (!doc || typeof doc.addEventListener !== 'function') return;
  try {
    doc.addEventListener('visibilitychange', () => {
      if (!_wcPendingApprovalHandoff) {
        _wcApprovalPageWasHidden = false;
        return;
      }
      if (doc.visibilityState === 'hidden') {
        _wcApprovalPageWasHidden = true;
        return;
      }
      if (doc.visibilityState === 'visible' && _wcApprovalPageWasHidden) {
        _clearWalletApprovalHandoff();
      }
    });
  } catch (_e) { /* headless */ }
}

_installWalletApprovalHandoffLifecycle();

function _installWalletConnectAutomaticHandoff(provider) {
  if (provider?.isWalletConnect !== true) return;
  const client = provider?.signer?.client;
  if (!client || typeof client.on !== 'function' || _wcAutomaticHandoffClients.has(client)) return;

  const onRequestSent = (event) => {
    if (!_isMobileWalletHandoffContext()) return;
    const topic = String(event?.topic || '');
    const currentTopic = String(provider?.session?.topic || '');
    const method = String(event?.request?.method || '');
    if (!topic || topic !== currentTopic || event?.id == null || !WC_APPROVAL_METHODS.has(method)) return;
    const choice = _walletConnectDeepLinkChoice(provider);
    if (!choice) return;
    const href = _formatWalletConnectRequestDeepLink(choice.href, event.id, topic);
    _showWalletApprovalHandoff({
      href,
      walletName: choice.walletName,
      requestKey: `${topic}:${String(event.id)}`,
    });
    _openWalletDeepLinkInPlace(href);
  };

  try {
    client.on(WC_REQUEST_SENT_EVENT, onRequestSent);
    _wcAutomaticHandoffClients.add(client);
  } catch (_e) { /* older/nonstandard providers keep their existing behavior */ }
}

function _walletConnectSessionHasChain(provider, chainId) {
  const namespaces = provider?.session?.namespaces;
  if (!namespaces || typeof namespaces !== 'object') return false;
  const target = `eip155:${Number(chainId)}`;
  return Object.entries(namespaces).some(([key, namespace]) => {
    if (key === target) return true;
    if (Array.isArray(namespace?.chains) && namespace.chains.includes(target)) return true;
    return Array.isArray(namespace?.accounts)
      && namespace.accounts.some((account) => String(account).startsWith(`${target}:`));
  });
}

function _walletConnectSessionHasMethod(provider, method) {
  const namespaces = provider?.session?.namespaces;
  if (!namespaces || typeof namespaces !== 'object') return false;
  return Object.entries(namespaces).some(([key, namespace]) => {
    const eip155 = key === 'eip155'
      || key.startsWith('eip155:')
      || namespace?.chains?.some?.((chain) => String(chain).startsWith('eip155:'))
      || namespace?.accounts?.some?.((account) => String(account).startsWith('eip155:'));
    return eip155 && Array.isArray(namespace?.methods) && namespace.methods.includes(method);
  });
}

function _walletChainFailureReason(error) {
  if (!error) return 'none';
  if (_isStaleWalletConnectError(error)) return 'stale-topic';
  const queue = [error];
  const seen = new Set();
  while (queue.length > 0 && seen.size < 12) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const code = value.code;
    if ((typeof code === 'number' && Number.isFinite(code))
      || (typeof code === 'string' && /^-?\d+$/.test(code.trim()))) {
      return `code:${String(code).trim()}`;
    }
    queue.push(value.data, value.error, value.cause, value.originalError, value.info);
  }
  const message = _walletErrorText(error);
  if (/not approved|does not support|unsupported/i.test(message)) return 'unsupported';
  if (/reject|denied|declined/i.test(message)) return 'rejected';
  if (/expir|timed? out/i.test(message)) return 'expired';
  if (/offline|network|relay|socket|connect/i.test(message)) return 'transport';
  return 'unknown';
}

// Caught wallet errors normally never reach window.onerror. Emit only a small,
// address-free capability snapshot when chain recovery fails so a real-phone
// retry can identify the exact WalletConnect branch without exposing account
// or session identifiers.
function _reportWalletChainFailure(stage, raw, error = null) {
  try {
    const queue = globalThis.__telemetryQ;
    if (!queue || typeof queue.push !== 'function') return;
    const namespaces = raw?.session?.namespaces;
    const namespaceCount = namespaces && typeof namespaces === 'object'
      ? Object.keys(namespaces).length
      : 0;
    queue.push({
      kind: 'error',
      t: Date.now(),
      data: {
        m: `wallet-chain:${stage}`,
        wc: raw?.isWalletConnect === true,
        active: _normalizeChainId(raw?.chainId),
        namespaces: namespaceCount,
        target: _walletConnectSessionHasChain(raw, CHAIN.id),
        switch: _walletConnectSessionHasMethod(raw, 'wallet_switchEthereumChain'),
        add: _walletConnectSessionHasMethod(raw, 'wallet_addEthereumChain'),
        send: _walletConnectSessionHasMethod(raw, 'eth_sendTransaction'),
        reason: _walletChainFailureReason(error),
      },
    });
  } catch (_e) { /* diagnostics must never affect wallet recovery */ }
}

async function _repairWalletConnectNamespace(raw) {
  try {
    await raw.disconnect();
  } catch (error) {
    if (_isStaleWalletConnectError(error)) {
      return _replaceStaleWalletConnectSession(raw);
    }
    _reportWalletChainFailure('repair-disconnect-failed', raw, error);
    return false;
  }
  // The WC disconnect event normally clears this state first; keep the
  // explicit reset for providers that do not emit it until a later tick.
  disconnect();
  try {
    // The caller is already the authoritative, awaited switch flow. Suppress
    // connectWalletConnect's normal fire-and-forget convenience switch so a
    // replacement session receives exactly one awaited request below.
    const connected = await connectWalletConnect({
      requestConfiguredChain: false,
      connectOptions: _walletConnectRepairOptions(),
    });
    if (!connected) {
      _reportWalletChainFailure('repair-empty-session', getEip1193() || raw);
      return false;
    }
    return ensureConfiguredWalletChain({ allowWalletConnectRepair: false });
  } catch (error) {
    _reportWalletChainFailure('repair-connect-failed', getEip1193() || raw, error);
    return false;
  }
}

/**
 * Switch the connected wallet to this deployment's chain.
 *
 * WalletConnect namespaces are fixed when a session is approved. If a player
 * enables Base Sepolia in MetaMask after pairing, the old session still cannot
 * switch to it. A user-initiated retry therefore retires that stale session
 * and opens a fresh pairing; ordinary injected wallets and WC sessions that
 * already authorize the chain use the normal switch/add flow.
 */
export async function ensureConfiguredWalletChain({ allowWalletConnectRepair = true } = {}) {
  const raw = getEip1193();
  if (!raw) return false;

  const walletConnectMissingChain = raw.isWalletConnect === true
    && raw.session
    && !_walletConnectSessionHasChain(raw, CHAIN.id);
  const walletConnectCanSwitch = walletConnectMissingChain
    && _walletConnectSessionHasMethod(raw, 'wallet_switchEthereumChain');

  // A WalletConnect session may omit the target from its fixed namespace but
  // still explicitly authorize wallet_switchEthereumChain. The SDK forwards
  // that request through the current approved chain and selects the target
  // after the wallet accepts it. Destroying such a session before the request
  // is why mobile writes repeatedly fell through to "Wrong network".
  if (walletConnectMissingChain && !walletConnectCanSwitch) {
    if (!allowWalletConnectRepair) {
      _reportWalletChainFailure('replacement-missing-capability', raw);
      return false;
    }
    return _repairWalletConnectNamespace(raw);
  }

  // The EIP-1193 provider is the live source of truth. ethers' BrowserProvider
  // can retain the network it first detected, so a wallet that already switched
  // successfully must be allowed to repair that stale wrapper without showing
  // another switch prompt.
  const currentChainId = await _readEip1193ChainId(raw, { authoritative: true });
  if (currentChainId === CHAIN.id) {
    _refreshConnectedBrowserProvider(raw);
    await _syncConnectedChain(raw, null, { authoritative: true });
    return true;
  }

  const switchResult = await switchToSepoliaResult(raw);
  if (!switchResult.ok) {
    if (
      allowWalletConnectRepair
      && raw.isWalletConnect === true
      && _isStaleWalletConnectError(switchResult.error)
    ) {
      return _replaceStaleWalletConnectSession(raw);
    }
    if (allowWalletConnectRepair && walletConnectMissingChain) {
      return _repairWalletConnectNamespace(raw);
    }
    _reportWalletChainFailure('switch-failed', raw, switchResult.error);
    return false;
  }
  // Several mobile wallets resolve the approval request before eth_chainId
  // and chainChanged catch up in the returning browser tab.
  const activeChainId = await _waitForConfiguredChain(raw);
  const chainOk = activeChainId === CHAIN.id;
  if (chainOk) _refreshConnectedBrowserProvider(raw);
  if (!chainOk && allowWalletConnectRepair && walletConnectMissingChain) {
    return _repairWalletConnectNamespace(raw);
  }
  if (!chainOk) _reportWalletChainFailure('switch-not-observed', raw);
  return chainOk;
}

// sendTx and signed static preflights arrive here only from an explicit player
// action. That preserves silent reconnect while making the same tap request
// Base Sepolia, wait for mobile propagation, and continue the original write.
setChainSwitchHandler(ensureConfiguredWalletChain);
setWalletSessionRecoveryHandler(_recoverWalletConnectWrite);

/**
 * Whether this browser currently exposes an installed EIP-1193/EIP-6963
 * wallet. This never requests accounts and never opens a wallet prompt.
 */
export function hasInstalledWallet() {
  const win = (typeof globalThis !== 'undefined') ? globalThis.window : null;
  if (win?.ethereum) return true;
  if (_announced.size > 0) return true;
  // EIP-6963 providers answer this synchronously. Re-requesting also catches
  // an extension that injected after this module's first discovery event.
  try { win?.dispatchEvent?.(new Event('eip6963:requestProvider')); } catch (_e) { /* headless */ }
  return _announced.size > 0;
}

// ---------------------------------------------------------------------------
// Phase 63 D-01 — singleton EthereumProvider cached for page lifetime.
// Issue #2930 mitigation: dual EthereumProvider instances on mobile redirect
// to the wrong app. Init runs at most once per page; subsequent
// connectWalletConnect / autoReconnect WC-branch calls reuse the cached
// instance (RESEARCH F-2: loadPersistedSession runs inside init and populates
// _wcProvider.session / .accounts / .chainId on every init call).
// ---------------------------------------------------------------------------

let _wcProvider = null;

// WalletConnect can leave a locally persisted session after the wallet has
// already deleted the peer topic. Requests against that zombie session fail
// forever with "No matching key. session topic doesn't exist"; disconnect()
// fails for the same reason and therefore never reaches the SDK's cleanup.
// Keep our sessions in a versioned namespace, and rotate that namespace when
// this exact condition is observed so the next init cannot restore the corpse.
const WC_STORAGE_PREFIX_BASE = 'degenerus-wc-20260903';
const WC_STORAGE_GENERATION_KEY = 'degenerusWalletConnectStorageGeneration';
// MetaMask Mobile installs its WalletConnect request listener before restoring
// persisted sessions. Its restore loop can take about four seconds at the
// supported session limit, so one delayed retry lets that cold-start race
// settle before replacing a session that may still be perfectly valid.
const WC_INVALID_ID_RETRY_DELAY_MS = 5_000;
let _wcInvalidIdRetryDelayMs = WC_INVALID_ID_RETRY_DELAY_MS;
let _volatileWcStorageGeneration = 0;

function _wcStorageGeneration() {
  try {
    const raw = globalThis.localStorage?.getItem?.(WC_STORAGE_GENERATION_KEY);
    const parsed = Number.parseInt(String(raw ?? ''), 10);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  } catch (_e) { /* private mode: use the page-local generation */ }
  return _volatileWcStorageGeneration;
}

function _advanceWcStorageGeneration() {
  const next = _wcStorageGeneration() + 1;
  _volatileWcStorageGeneration = next;
  try { globalThis.localStorage?.setItem?.(WC_STORAGE_GENERATION_KEY, String(next)); } catch (_e) { /* private mode */ }
  return next;
}

function _walletErrorText(error) {
  const text = [];
  const queue = [error];
  const seen = new Set();
  while (queue.length > 0 && seen.size < 16) {
    const value = queue.shift();
    if (typeof value === 'string') {
      text.push(value);
      continue;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (typeof value.message === 'string') text.push(value.message);
    queue.push(value.data, value.error, value.cause, value.originalError, value.info);
  }
  return text.join(' ');
}

function _walletErrorHasCode(error, expected) {
  const queue = [error];
  const seen = new Set();
  while (queue.length > 0 && seen.size < 16) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const code = value.code;
    if ((typeof code === 'number' && Number.isFinite(code) && code === expected)
      || (typeof code === 'string'
        && /^-?\d+$/.test(code.trim())
        && Number(code.trim()) === expected)) return true;
    queue.push(value.data, value.error, value.cause, value.originalError, value.info);
  }
  return false;
}

function _isWalletPeerInvalidIdError(error) {
  // MetaMask Mobile responds with JSON-RPC code 1 / "Invalid Id" when a
  // request arrives before its session topic has been restored. Requiring both
  // fields avoids mistaking an on-chain "invalid id" revert for this peer error.
  return _walletErrorHasCode(error, 1) && /\binvalid id\b/i.test(_walletErrorText(error));
}

function _isStaleWalletConnectError(error) {
  return _isWalletPeerInvalidIdError(error)
    || /no matching key[.:\s]+session topic doesn['’]?t exist|session topic doesn['’]?t exist/i
      .test(_walletErrorText(error));
}

async function _recoverWalletConnectWrite(error, { attempt = 0 } = {}) {
  const staleProvider = _eip1193;
  if (staleProvider?.isWalletConnect !== true || !_isStaleWalletConnectError(error)) return false;

  if (_isWalletPeerInvalidIdError(error) && attempt === 0) {
    const topic = String(staleProvider.session?.topic || '');
    if (!topic) return false;
    _reportWalletChainFailure('peer-session-restoring', staleProvider, error);
    await new Promise((resolve) => setTimeout(resolve, _wcInvalidIdRetryDelayMs));
    return staleProvider === _eip1193
      && topic === String(_eip1193?.session?.topic || '');
  }

  _reportWalletChainFailure('peer-session-repair', staleProvider, error);
  return _replaceStaleWalletConnectSession(staleProvider);
}

async function _replaceStaleWalletConnectSession(staleProvider) {
  if (staleProvider !== _eip1193) return false;
  _advanceWcStorageGeneration();
  _wcProvider = null;
  // Do not call staleProvider.disconnect() again: the missing peer topic makes
  // that method reject before WalletConnect cleans its own persisted state.
  disconnect();
  try {
    const connected = await connectWalletConnect({
      requestConfiguredChain: false,
      connectOptions: _walletConnectRepairOptions(),
    });
    if (!connected) {
      _reportWalletChainFailure('stale-repair-empty-session', getEip1193() || staleProvider);
      return false;
    }
    return ensureConfiguredWalletChain({ allowWalletConnectRepair: false });
  } catch (error) {
    _reportWalletChainFailure('stale-repair-connect-failed', getEip1193() || staleProvider, error);
    return false;
  }
}

// Test-seam: factory injection for EthereumProvider.init. Production code uses
// the imported EthereumProvider directly; tests inject a mock factory so they
// don't attempt to fetch the esm.sh bundle (too brittle for node:test).
let _wcEthereumProviderFactory = null;

// Test-seam: BrowserProvider constructor injection for the WC path. ethers'
// real BrowserProvider construction asserts EIP-1193 shape on the passed object
// AND its `.provider` getter returns `this` — so node:test cases mocking the WC
// EthereumProvider need to inject a stub BrowserProvider class to avoid
// ethers' "unknown ProviderEvent" assertion when attachListeners runs against
// the wrapped provider's internal subscription system. In production this is
// always the imported BrowserProvider from ethers.
let _wcBrowserProviderCtor = null;

// A WalletConnect session can pair on the wallet's current chain and switch to
// the beta chain a moment later. ethers pins the first network detected by a
// BrowserProvider unless it is constructed with "any"; keeping the pre-switch
// wrapper then makes every signer/static-call fail with NETWORK_ERROR even
// though MetaMask and the UI both show Base Sepolia. Build WC wrappers in
// any-network mode and replace the active wrapper whenever WC reports the
// configured chain so no pre-switch network cache reaches a write.
function _newWcBrowserProvider(wc) {
  const BPCtor = _wcBrowserProviderCtor || BrowserProvider;
  return new BPCtor(wc, 'any');
}

function _refreshWcBrowserProvider(wc) {
  const browserProvider = _newWcBrowserProvider(wc);
  setProvider(browserProvider);
  return browserProvider;
}

function _normalizeChainId(value) {
  let candidate = value;
  if (!['string', 'number', 'bigint'].includes(typeof candidate)) return null;
  if (typeof candidate === 'string') {
    candidate = candidate.trim();
    if (!candidate) return null;
    const caip = /^eip155:(.+)$/i.exec(candidate);
    if (caip) candidate = caip[1];
  }
  try {
    const parsed = Number(BigInt(candidate));
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  } catch (_e) {
    return null;
  }
}

function _isConfiguredChainId(value) {
  return _normalizeChainId(value) === CHAIN.id;
}

async function _readEip1193ChainId(raw, { authoritative = false } = {}) {
  // WalletConnect exposes a cheap public chain hint, which is useful during a
  // silent reconnect. Its EthereumProvider chainId can diverge from the
  // UniversalProvider's active chain after restoring a multi-chain session,
  // though. User-initiated writes therefore request eth_chainId first.
  if (!authoritative && raw?.isWalletConnect === true) {
    const walletConnectChainId = _normalizeChainId(raw.chainId);
    if (walletConnectChainId != null) return walletConnectChainId;
  }
  try {
    const value = await raw?.request?.({ method: 'eth_chainId' });
    const parsed = _normalizeChainId(value);
    if (parsed != null) return parsed;
  } catch (_e) { /* fall back to the provider's public chainId below */ }
  return _normalizeChainId(raw?.chainId);
}

async function _syncConnectedChain(raw, browserProvider = null, { authoritative = false } = {}) {
  let chainId = await _readEip1193ChainId(raw, { authoritative });
  if (chainId == null && browserProvider) {
    const network = await browserProvider.getNetwork().catch(() => null);
    chainId = _normalizeChainId(network?.chainId);
  }
  update('connected.chainId', chainId);
  update('ui.chainOk', chainId == null ? null : chainId === CHAIN.id);
  return chainId;
}

function _refreshConnectedBrowserProvider(raw) {
  if (raw?.isWalletConnect === true) return _refreshWcBrowserProvider(raw);
  const browserProvider = new BrowserProvider(raw, 'any');
  setProvider(browserProvider);
  return browserProvider;
}

const CHAIN_SETTLE_DELAYS_MS = [0, 100, 250, 500, 1_000];

async function _waitForConfiguredChain(raw, browserProvider = null) {
  let chainId = null;
  for (const delayMs of CHAIN_SETTLE_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    chainId = await _syncConnectedChain(raw, browserProvider, { authoritative: true });
    if (chainId === CHAIN.id) return chainId;
  }
  return chainId;
}

async function _recheckConnectedChainOnResume() {
  const raw = _eip1193;
  if (!raw || !get('connected.address')) return null;
  const wasCorrect = get('ui.chainOk') === true;
  const chainId = await _syncConnectedChain(raw, getProvider());
  // Mobile browsers can suspend the page while the wallet changes networks
  // and drop chainChanged. If this resume read repairs a mismatch, also replace
  // the ethers wrapper that may still remember the pre-switch network.
  if (!wasCorrect && chainId === CHAIN.id && raw === _eip1193) {
    _refreshConnectedBrowserProvider(raw);
  }
  return chainId;
}

function _installChainResumeChecks() {
  const win = (typeof globalThis !== 'undefined') ? globalThis.window : null;
  const doc = (typeof globalThis !== 'undefined') ? globalThis.document : null;
  const recheck = () => {
    if (doc?.visibilityState && doc.visibilityState !== 'visible') return null;
    return _recheckConnectedChainOnResume().catch(() => null);
  };
  try { win?.addEventListener?.('focus', recheck); } catch (_e) { /* headless */ }
  try { win?.addEventListener?.('pageshow', recheck); } catch (_e) { /* headless */ }
  try { doc?.addEventListener?.('visibilitychange', recheck); } catch (_e) { /* headless */ }
}

_installChainResumeChecks();

export function onUserPickedWallet(info) {
  if (_pickerResolve) {
    _pickerResolve(info);
    _pickerResolve = null;
  }
}

// ---------------------------------------------------------------------------
// Phase 63 D-01 — WalletConnect v2 helpers (init opts + singleton ensure).
// ---------------------------------------------------------------------------

function _wcInitOpts() {
  // RESEARCH §Pattern 1 verified bundle behavior:
  //   - optionalChains (NOT chains) so wallets that don't pre-support Base
  //     Sepolia can still pair. Requiring a custom testnet namespace makes
  //     default MetaMask Mobile reject the connection before we can ask it to
  //     add/switch networks. connectWalletConnect() requests the switch after
  //     pairing and leaves the connection intact if the user must retry it.
  //   - showQrModal:true triggers AppKit lazy-load of the bundled WC modal.
  //   - enableMobileFullScreen MUST be nested under qrModalOptions (top-level
  //     is silently ignored — verified in bundle: this.rpc.qrModalOptions?.enableMobileFullScreen===!0).
  //   - metadata.redirect.universal MUST be the runtime origin (mandatory v1.9.5+).
  //   - --wcm-z-index 2000 exceeds existing wallet-picker z-index 1000 so WC's
  //     bundled modal renders above our picker (RESEARCH Anti-Pattern line 505).
  const win = (typeof globalThis !== 'undefined' && globalThis.window) ? globalThis.window : null;
  const origin = (win && win.location && win.location.origin) ? win.location.origin : '';
  return {
    projectId: WALLETCONNECT_PROJECT_ID,
    customStoragePrefix: `${WC_STORAGE_PREFIX_BASE}-${_wcStorageGeneration()}`,
    optionalChains: [CHAIN.id, 1],
    // WalletConnect routes non-wallet JSON-RPC methods (eth_call,
    // eth_estimateGas, block/receipt reads) through its HTTP provider. Pin the
    // active beta chain to the same public RPC used by the rest of the app so
    // a purchase preflight never depends on the WalletConnect gateway.
    rpcMap: { [CHAIN.id]: CHAIN.rpcUrl },
    showQrModal: true,
    qrModalOptions: {
      enableMobileFullScreen: true,
      themeMode: 'dark',
      themeVariables: {
        '--wcm-z-index': '2000',
        '--wcm-accent-color': 'var(--accent, #4caf50)',
        '--wcm-background-color': 'var(--bg-secondary, #1a1a1a)',
        '--wcm-font-family': 'inherit',
      },
    },
    metadata: {
      name: 'Degenerus',
      description: 'Degenerus Protocol — on-chain gambling game',
      url: origin,
      icons: [`${origin}/badges-circular/flame_red.svg`],
      redirect: {
        native: 'degenerus://',
        universal: `${origin}/app/`,
      },
    },
  };
}

// The first pairing stays permissive because MetaMask Mobile rejects an
// unknown custom chain when it is required. Recovery must not repeat the same
// `[Base Sepolia, Ethereum]` optional proposal, though: a wallet that selected
// only Ethereum would simply give us the same unusable namespace again. A
// fresh, Base-only optional proposal preserves MetaMask compatibility while
// removing mainnet as the fallback it can approve instead.
function _walletConnectRepairOptions() {
  return {
    optionalChains: [CHAIN.id],
    rpcMap: { [CHAIN.id]: CHAIN.rpcUrl },
  };
}

// The WalletConnect SDK is the single heaviest dependency graph on the page
// (hundreds of esm.sh module requests via its transitive imports), and only
// two paths ever need it: an explicit WalletConnect connect click, and a
// silent reconnect when the PERSISTED rdns is walletconnect:v2. Everyone
// else — disconnected visitors and injected-wallet users — must not pay for
// it at cold load (2026-08-13 cold-trace audit: 414 esm.sh requests). The
// bare specifier resolves through the page importmap exactly like the old
// static import did.
let _wcSdkPromise = null;
function _loadEthereumProvider() {
  if (!_wcSdkPromise) {
    _wcSdkPromise = import('@walletconnect/ethereum-provider')
      .then((m) => m.EthereumProvider);
    // A failed CDN fetch must not poison the singleton forever — the next
    // click retries instead of rejecting instantly on a cached failure.
    _wcSdkPromise.catch(() => { _wcSdkPromise = null; });
  }
  return _wcSdkPromise;
}

async function _ensureWcProvider() {
  // Issue #2930 mitigation: never re-init on the same page.
  if (_wcProvider) return _wcProvider;
  const factory = _wcEthereumProviderFactory || await _loadEthereumProvider();
  _wcProvider = await factory.init(_wcInitOpts());
  // VERIFIED (RESEARCH F-2): loadPersistedSession runs inside init();
  // _wcProvider.session is truthy iff a prior session was persisted.
  return _wcProvider;
}

// ---------------------------------------------------------------------------
// connectWalletConnect — sibling to connectLegacy / connectWithPicker.
// Phase 63 D-01: WC v2 provider as a connect option. Wraps the WC EIP-1193
// provider in a BrowserProvider so the existing setProvider / clearProvider
// chokepoint (Phase 58) is reused verbatim (CF-04, no new chokepoint).
// ---------------------------------------------------------------------------

export async function connectWalletConnect({
  requestConfiguredChain = true,
  connectOptions = null,
} = {}) {
  const wc = await _ensureWcProvider();
  if (!wc.session || !wc.accounts || wc.accounts.length === 0) {
    // No persisted session — open the QR modal / deep-link to mobile wallet.
    // wc.connect() is the popup-equivalent and is intentionally invoked here
    // (NEVER from autoReconnect — that path is silent).
    await wc.connect(connectOptions || undefined);
  }
  if (!wc.accounts || wc.accounts.length === 0) return null;

  const browserProvider = _newWcBrowserProvider(wc);
  // WR-05: attach EIP-1193 listeners BEFORE returning so chainChanged /
  // accountsChanged events fired during WC session establishment are not lost.
  attachListeners(browserProvider, wc);

  setProvider(browserProvider);
  const addr = String(wc.accounts[0]).toLowerCase();
  update('connected.address', addr);
  update('connected.rdns', 'walletconnect:v2');
  localStorage.setItem('lastWalletRdns', 'walletconnect:v2');
  const activeChainId = await _syncConnectedChain(wc, browserProvider);
  const chainOk = activeChainId === CHAIN.id;

  emitConnected(addr);
  if (!chainOk && requestConfiguredChain) {
    // Pairing must finish before MetaMask Mobile will accept a custom-chain
    // request. Start the switch immediately, but do not await it: a rejected,
    // unsupported, or deep-link-blocked switch must not undo the successful
    // wallet connection. The now-connected Wrong Network controls provide a
    // fresh user gesture for retrying; chainChanged also updates this flag.
    void switchToSepolia(wc).then(async (switched) => {
      if (!switched) return;
      // Do not publish a signable state merely because the switch request
      // resolved. Verify WC's active CAIP chain, then discard the wrapper that
      // may already have cached the wallet's pre-switch Ethereum network.
      const switchedChainId = await _waitForConfiguredChain(wc);
      if (switchedChainId !== CHAIN.id) return;
      _refreshConnectedBrowserProvider(wc);
    }).catch(() => {});
  }
  return browserProvider;
}

// ---------------------------------------------------------------------------
// connectWithPicker — explicit user-initiated connect (popup OK on user click).
// Discovers EIP-6963 wallets, presents picker for 2+ wallets, persists rdns.
// ---------------------------------------------------------------------------

export async function connectWithPicker() {
  // Phase 63 D-01 step 4 — device-aware bypass.
  // Mobile-web with no injected wallet → skip picker, call WalletConnect directly.
  // Heuristic: (pointer:coarse) AND no window.ethereum AND zero EIP-6963 announces.
  // The picker is for desktop / extension users + MM in-dApp browser path.
  // (This bypass lives in wallet.js connectWithPicker ONLY — wallet-picker.js
  // does NOT contain pointer:coarse / isMobileWebNoInjected per WARNING 2 fix.)
  const win = (typeof globalThis !== 'undefined' && globalThis.window) ? globalThis.window : null;
  const isMobileWebNoInjected = !!(
    win
    && typeof win.matchMedia === 'function'
    && win.matchMedia('(pointer:coarse)').matches
    && typeof win.ethereum === 'undefined'
  );

  // Capture the EIP-6963 discovered list via the filter callback so we can
  // route to WC bypass when the list is empty AND the device is mobile-web.
  let _discoveredFound = null;

  const browserProvider = await BrowserProvider.discover({
    timeout: 1000,
    filter: (found) => {
      _discoveredFound = found;
      if (!found || found.length === 0) return null;
      if (found.length === 1) return found[0];
      return new Promise((resolve) => {
        // BL-05: track resolution state via a single boolean so neither
        // picker.show()'s Promise nor a stray onUserPickedWallet() call can
        // double-resolve into a stale outer Promise. Both code paths still
        // function (whichever fires first wins; subsequent calls are no-ops).
        let resolved = false;
        const finish = (info) => {
          if (resolved) return;
          resolved = true;
          _pickerResolve = null;
          resolve(info);
        };
        _pickerResolve = finish;
        const picker = typeof document !== 'undefined' ? document.querySelector('wallet-picker') : null;
        if (picker && typeof picker.show === 'function') {
          // wallet-picker.js (Plan 58-03) returns a Promise from show(). We
          // wrap synchronous and async failures so the outer Promise can
          // never leak: any error → resolve(null), letting connectWithPicker
          // fall through to legacy/null instead of hanging forever.
          let ret;
          try {
            ret = picker.show(found);
          } catch {
            finish(null);
            return;
          }
          if (ret && typeof ret.then === 'function') {
            ret.then(finish, () => finish(null));
          }
          // The click handler in wallet-picker also calls onUserPickedWallet()
          // → finish(info) via _pickerResolve. The `resolved` guard makes the
          // duplicate call a no-op.
        } else {
          // Graceful degradation: no picker mounted → first wallet.
          finish(found[0]);
        }
      });
    },
  }).catch(() => null);

  // Phase 63 D-01 step 4 — device-aware bypass dispatch.
  // If we're on mobile-web with no injected wallet AND zero EIP-6963 announces,
  // route directly to WalletConnect (WC's bundled modal owns the per-wallet
  // deep-link dispatch table on mobile). This is the SINGLE-SCOPE owner of the
  // bypass — wallet-picker.js does NOT replicate this check.
  if (
    isMobileWebNoInjected
    && (!_discoveredFound || _discoveredFound.length === 0)
    && !browserProvider
  ) {
    return connectWalletConnect();
  }

  if (!browserProvider) return connectLegacy();

  // WR-05: attach listeners BEFORE eth_requestAccounts so chainChanged /
  // accountsChanged events fired during wallet startup are not lost.
  const raw = _rawFor(browserProvider);
  attachListeners(browserProvider, raw);

  // Explicit connect — request accounts (popup OK on user click).
  const accounts = await _rpc(browserProvider, raw, 'eth_requestAccounts');
  if (!accounts || accounts.length === 0) return null;

  const rdns = browserProvider.providerInfo?.rdns;
  if (rdns) localStorage.setItem('lastWalletRdns', rdns);

  setProvider(browserProvider);
  const addr = accounts[0].toLowerCase();
  update('connected.address', addr);
  update('connected.rdns', rdns || null);
  await _syncConnectedChain(raw, browserProvider);

  emitConnected(addr);
  return browserProvider;
}

// ---------------------------------------------------------------------------
// connectLegacy — window.ethereum fallback for wallets without EIP-6963.
// Persists sentinel rdns 'legacy:window.ethereum' so autoReconnect routes back.
//
// WR-10 contract: this function calls eth_requestAccounts which WILL surface
// the wallet's permission prompt if the site is not already authorized. It
// is intended to be invoked from explicit user-initiated paths only:
//   - connectWithPicker fallback (when EIP-6963 discovery returns null)
//   - direct user click that opted into "legacy connect" UI
// Do NOT call from autoReconnect / silent boot flows — autoReconnect uses
// eth_accounts (silent) for the legacy path.
// ---------------------------------------------------------------------------

export async function connectLegacy() {
  const eth = (typeof globalThis !== 'undefined' && globalThis.window) ? globalThis.window.ethereum : null;
  if (!eth) {
    // No wallet at all — UI shows install CTA via wallet-picker zero-state in plan 58-03.
    return null;
  }
  const browserProvider = new BrowserProvider(eth, 'any');
  // WR-05: attach EIP-1193 listeners BEFORE eth_requestAccounts so
  // chainChanged/accountsChanged events fired during the wallet's startup /
  // permission-grant flow (e.g., MetaMask Snap chain init) are not lost.
  attachListeners(browserProvider, eth);
  const accounts = await eth.request({ method: 'eth_requestAccounts' }).catch(() => []);
  if (!accounts || accounts.length === 0) return null;

  // Legacy wallets have no rdns; persist sentinel so autoReconnect knows to use eth fallback.
  localStorage.setItem('lastWalletRdns', 'legacy:window.ethereum');

  setProvider(browserProvider);
  const addr = accounts[0].toLowerCase();
  update('connected.address', addr);
  update('connected.rdns', 'legacy:window.ethereum');
  await _syncConnectedChain(eth, browserProvider);

  emitConnected(addr);
  return browserProvider;
}

// ---------------------------------------------------------------------------
// autoReconnect — silent reconnect via persisted rdns.
// MUST call eth_accounts (silent), NEVER eth_requestAccounts (would popup).
// ---------------------------------------------------------------------------

export async function autoReconnect() {
  const rdns = localStorage.getItem('lastWalletRdns');
  if (!rdns) return false;

  // Legacy fallback path (window.ethereum without EIP-6963)
  if (rdns === 'legacy:window.ethereum') {
    const eth = (typeof globalThis !== 'undefined' && globalThis.window) ? globalThis.window.ethereum : null;
    if (!eth) return false;
    const browserProvider = new BrowserProvider(eth, 'any');
    // WR-05: attach listeners BEFORE eth_accounts so wallet-startup events
    // are not lost.
    attachListeners(browserProvider, eth);
    const accounts = await eth.request({ method: 'eth_accounts' }).catch(() => []);
    if (!accounts || accounts.length === 0) return false;
    setProvider(browserProvider);
    update('connected.address', accounts[0].toLowerCase());
    update('connected.rdns', 'legacy:window.ethereum');
    await _syncConnectedChain(eth, browserProvider);
    return true;
  }

  // Phase 63 D-01 — WalletConnect silent reconnect path.
  // EthereumProvider.init() runs loadPersistedSession internally (RESEARCH F-2);
  // wc.session is truthy iff a prior session was persisted. SILENT semantics —
  // NEVER call wc.connect() here (popup-equivalent; reserved for explicit user
  // click via connectWalletConnect).
  if (rdns === 'walletconnect:v2') {
    try {
      const wc = await _ensureWcProvider();
      if (!wc.session || !wc.accounts || wc.accounts.length === 0) return false;
      const browserProvider = _newWcBrowserProvider(wc);
      // WR-05: attach listeners BEFORE consuming wc state so chainChanged
      // events fired during silent resume are not lost.
      attachListeners(browserProvider, wc);
      setProvider(browserProvider);
      update('connected.address', String(wc.accounts[0]).toLowerCase());
      update('connected.rdns', 'walletconnect:v2');
      await _syncConnectedChain(wc, browserProvider);
      return true;
    } catch (_) {
      return false;
    }
  }

  // EIP-6963 path — discover with byRdns filter (deterministic, no race).
  const browserProvider = await BrowserProvider.discover({
    timeout: 1000,
    filter: (found) => (found && found.find((p) => p.rdns === rdns)) || null,
  }).catch(() => null);
  if (!browserProvider) return false;

  // WR-05: attach listeners BEFORE eth_accounts so wallet-startup events
  // are not lost.
  const raw = _rawFor(browserProvider);
  attachListeners(browserProvider, raw);

  // SILENT — eth_accounts (NOT eth_requestAccounts → no popup).
  const accounts = await _rpc(browserProvider, raw, 'eth_accounts');
  if (!accounts || accounts.length === 0) return false;

  setProvider(browserProvider);
  update('connected.address', accounts[0].toLowerCase());
  update('connected.rdns', browserProvider.providerInfo?.rdns || null);
  await _syncConnectedChain(raw, browserProvider);

  return true;
}

// ---------------------------------------------------------------------------
// attachListeners — wire EIP-1193 lifecycle events on the discovered provider.
// CRITICAL: chainChanged does NOT trigger a page refresh — preserves ?as= URL
// state for view-mode users (T-58-06).
// ---------------------------------------------------------------------------

function attachListeners(browserProvider, rawProvider = null) {
  const eth = _rawFor(browserProvider, rawProvider);
  if (!eth || typeof eth.on !== 'function' || eth === browserProvider) return;
  _eip1193 = eth;
  _installWalletConnectAutomaticHandoff(eth);

  eth.on('accountsChanged', async (accounts) => {
    abortAllInflight();
    if (!accounts || accounts.length === 0) {
      // Clear viewing.address FIRST so deriveMode (microtask) sees a consistent
      // (viewing=null, connected=null) state and produces 'self' on its own.
      // Writing connected.address first would let deriveMode (scheduled by the
      // connected-clear) flip ui.mode back to 'view' in a microtask, undoing
      // the explicit ui.mode='self' write below (BL-01).
      update('viewing.address', null);
      update('connected.address', null);
      update('connected.rdns', null);
      update('connected.chainId', null);
      update('ui.mode', 'self');
      update('approvals.list', []);
      localStorage.removeItem('lastWalletRdns');
      clearProvider();
      document.dispatchEvent(new CustomEvent('wallet-disconnected'));
    } else {
      const addr = accounts[0].toLowerCase();
      update('connected.address', addr);
      // WR-02: a new account may be on a different chain (some wallets allow
      // per-account chain settings, e.g., MetaMask Snap, Coinbase Wallet).
      // Re-derive ui.chainOk so the banner / button-enable state stay in sync
      // even before any user-driven write triggers ensureWriteChain().
      await _syncConnectedChain(eth, browserProvider);
      // DO NOT touch ui.mode here — view-mode is derived from viewing.address vs
      // connected.address (handled in plan 58-02 store.js deriveMode subscriber).
      document.dispatchEvent(new CustomEvent('wallet-connected', {
        detail: { address: addr },
      }));
    }
  });

  eth.on('chainChanged', (hexId) => {
    abortAllInflight();
    // Normalize every chain-id representation seen in the wild: EIP-1193 hex,
    // decimal strings/numbers, and WalletConnect CAIP-2 identifiers. Treating
    // only the numeric form as valid leaves a restored Base Sepolia session
    // falsely stuck on the Wrong Network banner after a page reload.
    const chainOk = _isConfiguredChainId(hexId);
    if (chainOk) {
      // The existing BrowserProvider may have detected the wallet's old chain
      // before this event. A fresh wrapper is the only reliable
      // way to clear ethers' pinned network promise before a purchase preflight.
      _refreshConnectedBrowserProvider(eth);
    }
    update('connected.chainId', _normalizeChainId(hexId));
    update('ui.chainOk', chainOk);
    // CRITICAL: NO page refresh on chainChanged — preserves ?as= URL state for
    // view-mode users (T-58-06). The store update is sufficient to drive UI re-render.
  });

  eth.on('disconnect', () => {
    // BL-01: clear viewing.address FIRST so deriveMode produces 'self' from a
    // consistent post-write state (see accountsChanged([]) above).
    update('viewing.address', null);
    update('connected.address', null);
    update('connected.rdns', null);
    update('connected.chainId', null);
    update('ui.mode', 'self');
    update('approvals.list', []);
    localStorage.removeItem('lastWalletRdns');
    clearProvider();
    document.dispatchEvent(new CustomEvent('wallet-disconnected'));
  });
}

// ---------------------------------------------------------------------------
// disconnect — explicit user-driven disconnect (e.g., nav.js disconnect button).
// ---------------------------------------------------------------------------

export function disconnect() {
  // BL-01: clear viewing.address FIRST so deriveMode produces 'self' from a
  // consistent post-write state (see accountsChanged([]) above).
  update('viewing.address', null);
  update('connected.address', null);
  update('connected.rdns', null);
  update('connected.chainId', null);
  update('ui.mode', 'self');
  update('approvals.list', []);
  localStorage.removeItem('lastWalletRdns');
  clearProvider();
  _eip1193 = null;
  _clearWalletApprovalHandoff();
  document.dispatchEvent(new CustomEvent('wallet-disconnected'));
}

// ---------------------------------------------------------------------------
// nav.js bridge — bidirectional event sync without re-emit loops (T-58-07).
// nav.js does NOT listen for `wallet-connected` (verified RESEARCH A4); it
// dispatches the event when its own connect chain completes. We listen so the
// /app/ store stays in sync with nav.js-driven flows. We do NOT re-emit.
// ---------------------------------------------------------------------------

/**
 * Attach a provider for an address that arrived from OUTSIDE this module (the
 * nav.js bridge). Silent: eth_accounts only, never eth_requestAccounts.
 *
 * Without this the bridge left the store half-connected — an address, but no
 * provider and no resolved `ui.chainOk`. Every [data-write] button (Flip, Buy,
 * Claim) therefore sat disabled while the wallet looked connected, and any
 * forced click hit the write gate's "Wallet not connected" because
 * contracts.js had no provider.
 */
async function _attachSilentlyFor(addr) {
  try {
    if (getProvider()) {
      // Provider already live (our own connect flow) — only the chain flag can
      // be stale here.
      await _syncConnectedChain(_eip1193, getProvider());
      return;
    }
    const browserProvider = await BrowserProvider.discover({ timeout: 1000, anyProvider: true })
      .catch(() => null);
    if (!browserProvider) return;
    const raw = _rawFor(browserProvider);
    const accounts = await _rpc(browserProvider, raw, 'eth_accounts');
    const match = (accounts || []).some((a) => String(a).toLowerCase() === addr);
    if (!match) return;   // a different wallet is attached; do not hijack it
    attachListeners(browserProvider, raw);
    setProvider(browserProvider);
    await _syncConnectedChain(raw, browserProvider);
  } catch (_e) {
    /* best effort — the UI stays read-only rather than breaking */
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('wallet-connected', (e) => {
    const addr = e?.detail?.address ? String(e.detail.address).toLowerCase() : null;
    if (addr && get('connected.address') !== addr) {
      update('connected.address', addr);
      // Do NOT re-emit — defensive idempotency check via address comparison.
    }
    // Runs even when the address was already known: a bridge event with no
    // provider behind it is exactly the half-connected state above.
    if (addr) _attachSilentlyFor(addr);
  });

  document.addEventListener('wallet-disconnected', () => {
    if (get('connected.address')) {
      // BL-01: clear viewing.address FIRST so deriveMode produces 'self' from a
      // consistent post-write state (see accountsChanged([]) in attachListeners).
      update('viewing.address', null);
      update('connected.address', null);
      update('connected.rdns', null);
      update('connected.chainId', null);
      update('ui.mode', 'self');
      update('approvals.list', []);
      localStorage.removeItem('lastWalletRdns');
      clearProvider();
    }
  });
}

function emitConnected(address) {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('wallet-connected', {
      detail: { address },
    }));
  }
}

// ---------------------------------------------------------------------------
// Test-only export surface (NOT for downstream consumers).
// ---------------------------------------------------------------------------

export { attachListeners as _testAttachListeners };

// Phase 63 D-01 test seams — WC provider singleton + factory injection.
export const _testEnsureWcProvider = _ensureWcProvider;
export const _testWcInitOpts = _wcInitOpts;
export function _testInjectWcFactory(fn) { _wcEthereumProviderFactory = fn; }
export function _testInjectWcBrowserProviderCtor(ctor) { _wcBrowserProviderCtor = ctor; }
export function _testResetWcSingleton() {
  _wcProvider = null;
  _wcEthereumProviderFactory = null;
  _wcBrowserProviderCtor = null;
  _wcInvalidIdRetryDelayMs = WC_INVALID_ID_RETRY_DELAY_MS;
}
export function _testGetWcSingleton() { return _wcProvider; }
export const _testIsStaleWalletConnectError = _isStaleWalletConnectError;
export const _testRecoverWalletConnectWrite = _recoverWalletConnectWrite;
export function _testSetWcInvalidIdRetryDelay(ms) {
  _wcInvalidIdRetryDelayMs = Math.max(0, Number(ms) || 0);
}
