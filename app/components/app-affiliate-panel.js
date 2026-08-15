// /app/components/app-affiliate-panel.js
//
// Read-only referral network: who referred the selected account, its direct
// referral list, and direct/level-2/level-3 totals inside the disclosure.
// Mounted below transaction history and intentionally free of payout,
// commission, claim, or referral-code controls.

import { CHAIN } from '../app/chain-config.js';
import { get, subscribe, getViewedAddress } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { fetchProfiles } from '../app/profiles.js';
import { registerComponentPoll } from '../app/component-poll.js';

const POLL_INTERVAL_MS = 30_000;        // Phase 56 D-04 / Phase 61 D-04 LOCKED.
const VISIBILITY_RESUME_GATE_MS = 1000; // ≥1s since last fetch → re-poll on foreground.
const ERROR_RETRY_MS = 4_000;           // Recover quickly from a mount-wave 429/503.
const PROFILE_BATCH_SIZE = 8;           // Session API privacy/rate-limit contract.

async function _fetchProfilesInBatches(addresses, signal) {
  const unique = [...new Set(
    (addresses || [])
      .map((address) => String(address || '').toLowerCase())
      .filter((address) => /^0x[0-9a-f]{40}$/.test(address)),
  )];
  const profiles = new Map();
  for (let index = 0; index < unique.length; index += PROFILE_BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = await fetchProfiles(unique.slice(index, index + PROFILE_BATCH_SIZE));
    if (signal?.aborted) break;
    for (const [address, profile] of batch) profiles.set(address, profile);
  }
  return profiles;
}

function _shortAddress(value) {
  const address = String(value || '');
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

class AppAffiliatePanel extends HTMLElement {
  // --- Phase 60/61/62 idempotency-guard pattern ---
  #unsubs = [];
  #initialized = false;
  // --- Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED) ---
  #pollHandle = null;
  #pollController = null;
  #lastFetchAt = 0;
  #visibilityListener = null;
  #disclosureListener = null;
  #refereesData = null;     // { referredBy, referees: [...], total, counts }
  #profiles = new Map();
  #profileLookups = new Set();
  #retryTimer = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wireDisclosure();
    this.#wireVisibilityRePoll();
    this.#wireStoreSubscriptions();
    // Referral data is intentionally lazy: the closed summary performs no
    // account-scoped lookup. Opening the disclosure starts its refresh cycle.
  }

  disconnectedCallback() {
    this.#stopPolling();
    if (this.#visibilityListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('visibilitychange', this.#visibilityListener); }
      catch (_) { /* defensive */ }
    }
    this.#visibilityListener = null;
    const details = this.querySelector('[data-bind="aff-details"]');
    if (details && this.#disclosureListener) {
      try { details.removeEventListener('toggle', this.#disclosureListener); }
      catch (_) { /* defensive */ }
    }
    this.#disclosureListener = null;
    if (this.#retryTimer != null) {
      try { clearTimeout(this.#retryTimer); } catch (_) { /* defensive */ }
      this.#retryTimer = null;
    }
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
  }

  // ---------------------------------------------------------------------
  // Render shell — STATIC innerHTML; T-58-18 hardening (no server data).
  // ---------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <details class="app-affiliate-panel aff-disclosure section-disclosure" data-bind="aff-details">
        <summary class="aff-summary section-disclosure__bar">
          <strong class="section-disclosure__title">REFERRALS</strong>
          <span class="section-disclosure__chevron" aria-hidden="true"></span>
        </summary>
        <div class="aff-content">
          <div class="aff-network-stats" aria-label="Referral network counts">
            <div class="aff-network-stat">
              <span>DIRECT</span>
              <strong data-bind="aff-count-direct">…</strong>
            </div>
            <div class="aff-network-stat">
              <span>LEVEL 2</span>
              <strong data-bind="aff-count-level2">…</strong>
            </div>
            <div class="aff-network-stat">
              <span>LEVEL 3</span>
              <strong data-bind="aff-count-level3">…</strong>
            </div>
          </div>
          <div class="aff-network-section">
            <span class="aff-network-label">REFERRED BY</span>
            <div class="aff-referred-by" data-bind="aff-referred-by"></div>
          </div>
          <section class="aff-referees-section">
            <header class="aff-referees-header">
              <h3 class="aff-referees-heading">DIRECT REFERRALS</h3>
            </header>
            <div class="aff-referees-table" data-bind="aff-referees" role="list"></div>
            <div class="aff-referees-empty" data-bind="aff-referees-empty" hidden>No direct referrals yet.</div>
          </section>
        </div>
      </details>
    `;
  }

  // ---------------------------------------------------------------------
  // Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED).
  // ---------------------------------------------------------------------

  #startPolling() {
    if (typeof this.#pollHandle === 'function') {
      try { this.#pollHandle(); } catch (_) { /* defensive */ }
    }
    this.#pollHandle = registerComponentPoll(() => this.#runMountFetch(), POLL_INTERVAL_MS);
  }

  #stopPolling() {
    if (typeof this.#pollHandle === 'function') {
      try { this.#pollHandle(); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#pollController) {
      try { this.#pollController.abort(); } catch (_) { /* defensive */ }
      this.#pollController = null;
    }
    if (this.#retryTimer != null) {
      try { clearTimeout(this.#retryTimer); } catch (_) { /* defensive */ }
      this.#retryTimer = null;
    }
  }

  #wireDisclosure() {
    const details = this.querySelector('[data-bind="aff-details"]');
    if (!details) return;
    this.#disclosureListener = () => {
      if (details.open) {
        this.#startPolling();
        this.#runMountFetch();
      } else {
        this.#stopPolling();
      }
    };
    details.addEventListener('toggle', this.#disclosureListener);
  }

  async #runMountFetch() {
    // Referral counts and identities are intentionally fetched only while the
    // disclosure is open. The closed title bar is a zero-query surface.
    const details = this.querySelector('[data-bind="aff-details"]');
    if (!details?.open) return;
    // Visibility guard — pause polling while tab hidden.
    if (typeof document !== 'undefined'
      && document.visibilityState
      && document.visibilityState !== 'visible') {
      return;
    }
    if (this.#pollController) {
      try { this.#pollController.abort(); } catch (_) { /* defensive */ }
    }
    this.#pollController = new AbortController();
    const signal = this.#pollController.signal;
    this.#lastFetchAt = Date.now();

    // Referral identity is per-account and cannot be summed in combined mode.
    if (get('ui.mode') === 'combined') {
      this.#refereesData = null;
      this.#renderReferralCounts(null);
      this.#renderReferredBy(null, 'Pick a single account to see who referred it.');
      this.#renderRefereesEmpty('Per-account stat. Pick a single account.');
      return;
    }

    const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || get('viewing.address')
      || get('connected.address')
      || null;

    if (!addr) {
      this.#refereesData = null;
      this.#renderReferralCounts(null);
      this.#renderReferredBy(null, 'Connect a wallet to see who referred you.');
      this.#renderRefereesEmpty('Connect a wallet to see referrals.');
      return;
    }

    try {
      const data = await fetchJSON(`/player/${addr}/referees`, { signal });
      if (signal.aborted) return;
      if (this.#retryTimer != null) {
        try { clearTimeout(this.#retryTimer); } catch (_) { /* defensive */ }
        this.#retryTimer = null;
      }
      this.#refereesData = data || null;
      this.#renderReferralCounts(data?.counts, data?.total);
      this.#renderReferredBy(data?.referredBy ?? null);
      const referees = Array.isArray(data?.referees) ? data.referees : [];
      this.#renderReferees(referees);

      // Discord identity is optional decoration. Render address fallbacks
      // immediately, then upgrade linked wallets when the public profile read
      // returns; a profile-service outage never blanks the referral network.
      const identities = [data?.referredBy, ...referees.map((row) => row?.address)]
        .map((value) => String(value || '').toLowerCase())
        .filter((value) => /^0x[0-9a-f]{40}$/.test(value));
      const pendingProfiles = [...new Set(identities)]
        .filter((identity) => !this.#profileLookups.has(identity));
      if (pendingProfiles.length === 0) return;
      const profiles = await _fetchProfilesInBatches(pendingProfiles, signal);
      if (signal.aborted || !details.open) return;
      for (const identity of pendingProfiles) this.#profileLookups.add(identity);
      for (const [identity, profile] of profiles) this.#profiles.set(identity, profile);
      this.#renderReferredBy(data?.referredBy ?? null);
      this.#renderReferees(referees);
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      const message = Number(error?.status) === 503
        ? 'Referral index is catching up. Retrying automatically.'
        : 'Referral service unavailable. Retrying automatically.';
      this.#renderReferredBy(null, message);
      this.#renderRefereesEmpty(message);
      if (this.#retryTimer == null && typeof setTimeout === 'function') {
        this.#retryTimer = setTimeout(() => {
          this.#retryTimer = null;
          this.#runMountFetch();
        }, ERROR_RETRY_MS);
        if (this.#retryTimer && typeof this.#retryTimer.unref === 'function') {
          try { this.#retryTimer.unref(); } catch (_) { /* defensive */ }
        }
      }
    }
  }

  // Visibility-aware refresh — on foreground return AFTER ≥1s elapsed since
  // last fetch, fire an immediate cycle. Mirrors Phase 56 D-04 + Phase 61 D-04
  // (1s gate per Plan 62-04 D-A — light data, frequent foreground re-polls fine).
  #wireVisibilityRePoll() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#visibilityListener = () => {
      if (document.visibilityState !== 'visible') return;
      const elapsed = Date.now() - this.#lastFetchAt;
      if (elapsed >= VISIBILITY_RESUME_GATE_MS) {
        this.#runMountFetch();
      }
    };
    document.addEventListener('visibilitychange', this.#visibilityListener);
  }

  // Store subscriptions — on wallet switch (connected.address) OR view-target
  // switch (viewing.address), fire an immediate cycle restart.
  #wireStoreSubscriptions() {
    const u1 = subscribe('connected.address', () => this.#runMountFetch());
    const u2 = subscribe('viewing.address', () => this.#runMountFetch());
    const u3 = subscribe('ui.mode', () => this.#runMountFetch());
    this.#unsubs.push(u1, u2, u3);
  }

  // ---------------------------------------------------------------------
  // Referral network — server-derived strings via textContent (T-58-18).
  // The endpoint returns both sides of the relationship: `referredBy` is the
  // single incoming edge and `referees` are the outgoing/direct edges. The
  // interior stat cards show the size of the first three generations.
  // ---------------------------------------------------------------------

  #renderReferralCounts(counts, directFallback = null) {
    const normalized = counts && typeof counts === 'object'
      ? counts
      : { direct: directFallback, level2: null, level3: null };
    const bindings = [
      ['aff-count-direct', normalized.direct],
      ['aff-count-level2', normalized.level2],
      ['aff-count-level3', normalized.level3],
    ];

    for (const [binding, raw] of bindings) {
      const target = this.querySelector(`[data-bind="${binding}"]`);
      if (!target) continue;
      const value = Number(raw);
      target.textContent = raw != null && raw !== ''
        && Number.isSafeInteger(value) && value >= 0
        ? value.toLocaleString('en-US')
        : '—';
    }

  }

  #identityLink(address, context) {
    const normalized = String(address || '');
    const profile = this.#profiles.get(normalized.toLowerCase()) || null;
    const link = document.createElement('a');
    link.className = 'aff-referral-person';
    link.title = normalized;
    link.setAttribute('aria-label', `View ${context} ${profile?.name || normalized} on the block explorer`);
    link.setAttribute('href', `${String(CHAIN.etherscanBase || '').replace(/\/$/, '')}/address/${encodeURIComponent(normalized)}`);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');

    if (profile?.avatar) {
      const avatar = document.createElement('img');
      avatar.className = 'aff-referral-avatar';
      avatar.src = profile.avatar;
      avatar.alt = '';
      avatar.loading = 'lazy';
      link.appendChild(avatar);
    } else {
      const avatar = document.createElement('span');
      avatar.className = 'aff-referral-avatar is-fallback';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = profile?.name
        ? profile.name.slice(0, 1).toUpperCase()
        : '0x';
      link.appendChild(avatar);
    }

    const copy = document.createElement('span');
    copy.className = 'aff-referral-copy';
    const primary = document.createElement('strong');
    primary.className = 'aff-referral-name';
    primary.textContent = profile?.name || _shortAddress(normalized);
    copy.appendChild(primary);
    if (profile?.name) {
      const secondary = document.createElement('small');
      secondary.className = 'aff-referral-address';
      secondary.textContent = _shortAddress(normalized);
      copy.appendChild(secondary);
    }
    link.appendChild(copy);
    return link;
  }

  #renderReferredBy(address, emptyMessage = 'No referrer recorded.') {
    const target = this.querySelector('[data-bind="aff-referred-by"]');
    if (!target) return;
    // textContent also resets any prior empty-state text in the lightweight
    // test DOM before an address link is appended on a later poll.
    target.textContent = '';
    if (typeof target.replaceChildren === 'function') {
      target.replaceChildren();
    } else {
      target.children = [];
      target._innerHTML = '';
    }

    const normalized = String(address || '');
    if (!normalized) {
      target.classList?.add?.('is-empty');
      target.textContent = String(emptyMessage);
      return;
    }

    target.classList?.remove?.('is-empty');
    target.appendChild(this.#identityLink(normalized, 'referrer'));
  }

  #renderReferees(rows) {
    const table = this.querySelector('[data-bind="aff-referees"]');
    const empty = this.querySelector('[data-bind="aff-referees-empty"]');
    if (!table || !empty) return;

    if (typeof table.replaceChildren === 'function') {
      table.replaceChildren();
    } else {
      table.children = [];
      table._innerHTML = '';
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      empty.hidden = false;
      empty.textContent = 'No direct referrals yet.';
      return;
    }
    empty.hidden = true;

    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'aff-referees-row';
      row.setAttribute('role', 'listitem');

      const referralAddress = String(r?.address || '');
      row.appendChild(this.#identityLink(referralAddress, 'referral'));

      table.appendChild(row);
    }
  }

  #renderRefereesEmpty(msg) {
    const table = this.querySelector('[data-bind="aff-referees"]');
    const empty = this.querySelector('[data-bind="aff-referees-empty"]');
    if (table) {
      if (typeof table.replaceChildren === 'function') {
        table.replaceChildren();
      } else {
        table.children = [];
        table._innerHTML = '';
      }
    }
    if (empty) {
      empty.hidden = false;
      empty.textContent = String(msg || 'No direct referrals yet.');
    }
  }
}

// Idempotency-guarded registration (Phase 58/59/60/61/62 pattern). Required
// for node:test re-import safety AND production hot-module-replacement.
if (typeof customElements !== 'undefined'
  && typeof customElements.get === 'function'
  && typeof customElements.define === 'function') {
  if (!customElements.get('app-affiliate-panel')) {
    customElements.define('app-affiliate-panel', AppAffiliatePanel);
  }
}
