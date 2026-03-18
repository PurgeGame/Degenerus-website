// components/affiliate-panel.js -- Affiliate panel Custom Element
// Code creation, referral input, earnings display.
// All contract interaction delegated to affiliate.js (no ethers import here).

import { subscribe, get } from '../app/store.js';
import {
  createCode,
  referPlayer,
  fetchAffiliateState,
  captureReferralFromUrl,
  getStoredReferralCode,
} from '../app/affiliate.js';
import { formatEth, truncateAddress } from '../app/utils.js';

class AffiliatePanel extends HTMLElement {
  #unsubs = [];
  #errorTimeout = null;

  connectedCallback() {
    this.innerHTML = `
      <div class="panel affiliate-panel">
        <h3>Affiliate</h3>
        <div class="affiliate-earnings">
          <span class="label">Total Earned</span>
          <span class="affiliate-earned-amount">0 ETH</span>
        </div>
        <div class="affiliate-code-section">
          <div class="affiliate-create" hidden>
            <h4>Create Referral Code</h4>
            <div class="affiliate-form-row">
              <input type="text" class="affiliate-code-input" placeholder="YOUR_CODE" maxlength="31" pattern="[A-Za-z0-9]{3,31}">
            </div>
            <div class="affiliate-form-row">
              <label>Kickback %</label>
              <input type="number" class="affiliate-kickback" min="0" max="25" value="10">
            </div>
            <button class="btn-primary affiliate-create-btn" disabled>Create Code</button>
            <span class="affiliate-error" hidden></span>
          </div>
          <div class="affiliate-existing" hidden>
            <h4>Your Code</h4>
            <div class="affiliate-code-display">
              <code class="affiliate-my-code">--</code>
              <button class="btn-action affiliate-copy-btn">Copy Link</button>
            </div>
          </div>
        </div>
        <div class="affiliate-referral-section">
          <div class="affiliate-refer" hidden>
            <h4>Enter Referral Code</h4>
            <div class="affiliate-form-row">
              <input type="text" class="affiliate-ref-input" placeholder="FRIEND_CODE" maxlength="31">
              <button class="btn-action affiliate-refer-btn" disabled>Apply</button>
            </div>
            <span class="affiliate-refer-error" hidden></span>
          </div>
          <div class="affiliate-referred" hidden>
            <span class="label">Referred by</span>
            <span class="affiliate-referrer-addr">--</span>
          </div>
        </div>
      </div>
    `;

    // -- Event Listeners --

    // Create code button
    this.querySelector('.affiliate-create-btn').addEventListener('click', () => this.#handleCreate());

    // Copy link button
    this.querySelector('.affiliate-copy-btn').addEventListener('click', () => this.#handleCopy());

    // Refer button
    this.querySelector('.affiliate-refer-btn').addEventListener('click', () => this.#handleRefer());

    // Code input validation
    const codeInput = this.querySelector('.affiliate-code-input');
    codeInput.addEventListener('input', () => this.#validateCreateForm());

    // Kickback input validation
    const kickbackInput = this.querySelector('.affiliate-kickback');
    kickbackInput.addEventListener('input', () => this.#validateCreateForm());

    // Ref input validation
    const refInput = this.querySelector('.affiliate-ref-input');
    refInput.addEventListener('input', () => {
      const btn = this.querySelector('.affiliate-refer-btn');
      if (btn) btn.disabled = !refInput.value.trim() || get('ui.connectionState') !== 'connected';
    });

    // -- Store Subscriptions --

    // On wallet connect: fetch affiliate state, capture URL referral
    this.#unsubs.push(
      subscribe('player.address', (address) => {
        if (address) {
          fetchAffiliateState(address);
          const urlCode = captureReferralFromUrl();
          if (!urlCode) {
            // Check for previously stored referral code
            const stored = getStoredReferralCode();
            if (stored) {
              const refInput = this.querySelector('.affiliate-ref-input');
              if (refInput && !get('affiliate.referredBy')) {
                refInput.value = stored;
              }
            }
          } else {
            const refInput = this.querySelector('.affiliate-ref-input');
            if (refInput) refInput.value = urlCode;
          }
        }
        this.#validateCreateForm();
        this.#updateReferButtonState();
      })
    );

    // Update display when affiliate state changes
    this.#unsubs.push(
      subscribe('affiliate', (aff) => {
        if (!aff) return;
        this.#render(aff);
      })
    );

    // Disable buttons when not connected
    this.#unsubs.push(
      subscribe('ui.connectionState', () => {
        this.#validateCreateForm();
        this.#updateReferButtonState();
      })
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
    if (this.#errorTimeout) clearTimeout(this.#errorTimeout);
  }

  // -- Render --

  #render(aff) {
    const connected = get('ui.connectionState') === 'connected';

    // Earnings
    const earnedEl = this.querySelector('.affiliate-earned-amount');
    if (earnedEl) {
      earnedEl.textContent = (aff.totalEarned && aff.totalEarned !== '0')
        ? formatEth(aff.totalEarned) + ' ETH'
        : '0 ETH';
    }

    // Code section: create vs existing
    const createSection = this.querySelector('.affiliate-create');
    const existingSection = this.querySelector('.affiliate-existing');

    if (aff.code) {
      if (createSection) createSection.hidden = true;
      if (existingSection) {
        existingSection.hidden = false;
        const codeEl = this.querySelector('.affiliate-my-code');
        if (codeEl) codeEl.textContent = aff.code;
      }
    } else if (connected) {
      if (createSection) createSection.hidden = false;
      if (existingSection) existingSection.hidden = true;
    } else {
      if (createSection) createSection.hidden = true;
      if (existingSection) existingSection.hidden = true;
    }

    // Referral section: refer vs referred
    const referSection = this.querySelector('.affiliate-refer');
    const referredSection = this.querySelector('.affiliate-referred');

    if (aff.referredBy) {
      if (referSection) referSection.hidden = true;
      if (referredSection) {
        referredSection.hidden = false;
        const addrEl = this.querySelector('.affiliate-referrer-addr');
        if (addrEl) addrEl.textContent = truncateAddress(aff.referredBy);
      }
    } else if (connected) {
      if (referSection) referSection.hidden = false;
      if (referredSection) referredSection.hidden = true;
    } else {
      if (referSection) referSection.hidden = true;
      if (referredSection) referredSection.hidden = true;
    }
  }

  // -- Validation --

  #validateCreateForm() {
    const codeInput = this.querySelector('.affiliate-code-input');
    const kickbackInput = this.querySelector('.affiliate-kickback');
    const btn = this.querySelector('.affiliate-create-btn');
    if (!codeInput || !kickbackInput || !btn) return;

    const codeValid = /^[A-Za-z0-9]{3,31}$/.test(codeInput.value);
    const kickback = parseInt(kickbackInput.value, 10);
    const kickbackValid = !isNaN(kickback) && kickback >= 0 && kickback <= 25;
    const connected = get('ui.connectionState') === 'connected';

    btn.disabled = !codeValid || !kickbackValid || !connected;
  }

  #updateReferButtonState() {
    const refInput = this.querySelector('.affiliate-ref-input');
    const btn = this.querySelector('.affiliate-refer-btn');
    if (!refInput || !btn) return;
    btn.disabled = !refInput.value.trim() || get('ui.connectionState') !== 'connected';
  }

  // -- Handlers --

  async #handleCreate() {
    const codeInput = this.querySelector('.affiliate-code-input');
    const kickbackInput = this.querySelector('.affiliate-kickback');
    const btn = this.querySelector('.affiliate-create-btn');
    if (!codeInput || !kickbackInput) return;

    btn.disabled = true;
    this.#hideError('.affiliate-error');

    try {
      await createCode(codeInput.value, parseInt(kickbackInput.value, 10));
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError('.affiliate-error', err.message || 'Failed to create code');
      }
    } finally {
      this.#validateCreateForm();
    }
  }

  async #handleRefer() {
    const refInput = this.querySelector('.affiliate-ref-input');
    const btn = this.querySelector('.affiliate-refer-btn');
    if (!refInput || !refInput.value.trim()) return;

    btn.disabled = true;
    this.#hideError('.affiliate-refer-error');

    try {
      await referPlayer(refInput.value);
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError('.affiliate-refer-error', err.message || 'Failed to apply referral');
      }
    } finally {
      this.#updateReferButtonState();
    }
  }

  #handleCopy() {
    const code = get('affiliate.code');
    if (!code) return;

    const url = `${window.location.origin}/beta/?ref=${code}`;
    navigator.clipboard.writeText(url).then(() => {
      const btn = this.querySelector('.affiliate-copy-btn');
      if (btn) {
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original; }, 2000);
      }
    }).catch(() => {
      // Clipboard write failed; ignore
    });
  }

  #showError(selector, msg) {
    const el = this.querySelector(selector);
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    if (this.#errorTimeout) clearTimeout(this.#errorTimeout);
    this.#errorTimeout = setTimeout(() => {
      el.hidden = true;
      el.textContent = '';
    }, 5000);
  }

  #hideError(selector) {
    const el = this.querySelector(selector);
    if (el) {
      el.hidden = true;
      el.textContent = '';
    }
    if (this.#errorTimeout) {
      clearTimeout(this.#errorTimeout);
      this.#errorTimeout = null;
    }
  }
}

customElements.define('affiliate-panel', AffiliatePanel);
