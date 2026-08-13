// One compact top-bar home for browser/player preferences. The existing sound
// and feedback controls are moved intact so their proven audio and submission
// behavior stays authoritative.

import { mountSoundToggle } from './app-sound-toggle.js';
import { mountFeedbackButton } from './app-feedback-button.js';
import {
  readDegeneretteSpeed,
  writeDegeneretteSpeed,
} from '../app/degenerette-preferences.js';
import {
  readAfkingLowFundWarningPreference,
  readAllInButtonPreference,
  readBiggestBountiesModePreference,
  readRevealAutoOpenPreference,
  writeAfkingLowFundWarningPreference,
  writeAllInButtonPreference,
  writeBiggestBountiesModePreference,
  writeRevealAutoOpenPreference,
} from '../app/ui-preferences.js';
import { subscribe } from '../app/store.js';

const BUTTON_ID = 'unav-settings';
const PANEL_ID = 'unav-settings-panel';

function _gearIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.53-1H3v-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.53 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/>
    </svg>`;
}

function _setOpen(wrapper, button, panel, open) {
  const next = Boolean(open);
  wrapper.classList.toggle('is-open', next);
  button.setAttribute('aria-expanded', next ? 'true' : 'false');
  panel.hidden = !next;
}

export function mountSettingsMenu(root = document) {
  if (!root?.querySelector) return null;
  const existing = root.getElementById?.(BUTTON_ID) || root.querySelector(`#${BUTTON_ID}`);
  if (existing) return existing.closest?.('.nav-settings') || existing;
  const auth = root.querySelector('.nav-auth');
  if (!auth) return null;
  const doc = root.nodeType === 9 ? root : root.ownerDocument || document;

  // Let the original components initialize their own state/listeners first,
  // then relocate the live buttons into this menu.
  mountSoundToggle(root);
  mountFeedbackButton(root);
  const sound = root.getElementById?.('unav-sound') || root.querySelector('#unav-sound');
  const feedback = root.getElementById?.('unav-feedback') || root.querySelector('#unav-feedback');

  const wrapper = doc.createElement('div');
  wrapper.className = 'nav-settings';
  const button = doc.createElement('button');
  button.type = 'button';
  button.id = BUTTON_ID;
  button.className = 'nav-btn nav-settings__trigger';
  button.setAttribute('aria-label', 'Open player settings');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', PANEL_ID);
  button.setAttribute('aria-expanded', 'false');
  button.title = 'Player settings';
  button.innerHTML = _gearIcon();

  const panel = doc.createElement('section');
  panel.id = PANEL_ID;
  panel.className = 'nav-settings__panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'unav-settings-title');
  panel.hidden = true;
  panel.innerHTML = `
    <header class="nav-settings__head">
      <span>
        <small>PLAYER</small>
        <strong id="unav-settings-title">SETTINGS</strong>
      </span>
      <button type="button" class="nav-settings__close" data-settings-close
              aria-label="Close player settings">×</button>
    </header>
    <div class="nav-settings__body">
      <div class="nav-settings__actions" data-bind="settings-actions"></div>
      <label class="nav-settings__row nav-settings__row--toggle">
        <span class="nav-settings__copy">
          <strong>AUTO REVEALS</strong>
          <small>Open ready results automatically</small>
        </span>
        <input type="checkbox" data-bind="settings-auto-reveals">
        <i class="nav-settings__switch" aria-hidden="true"></i>
      </label>
      <div class="nav-settings__row nav-settings__row--three-way">
        <span class="nav-settings__copy">
          <strong>BIGGEST BOUNTIES</strong>
          <small data-bind="settings-bounties-description">Show records and purchase shortcuts</small>
        </span>
        <span class="nav-settings__three-way" role="group"
              aria-label="Biggest Bounties visibility and interaction">
          <button type="button" data-bounties-mode="on" aria-pressed="false">ON</button>
          <button type="button" data-bounties-mode="view" aria-pressed="false">VIEW</button>
          <button type="button" data-bounties-mode="off" aria-pressed="false">OFF</button>
        </span>
      </div>
      <label class="nav-settings__row nav-settings__row--speed">
        <span class="nav-settings__copy">
          <strong>DEFAULT SPEED</strong>
          <small>Reveal animation pace</small>
        </span>
        <span class="nav-settings__speed-control">
          <input type="range" min="0.5" max="3" step="0.5"
                 data-bind="settings-reveal-speed" aria-label="Default reveal speed">
          <output data-bind="settings-reveal-speed-value">1×</output>
        </span>
      </label>
      <label class="nav-settings__row nav-settings__row--toggle">
        <span class="nav-settings__copy">
          <strong>AFKING FUNDING ALERT</strong>
          <small>Warn when fewer than 7 funded days remain</small>
        </span>
        <input type="checkbox" data-bind="settings-afking-funding-warning">
        <i class="nav-settings__switch" aria-hidden="true"></i>
      </label>
      <label class="nav-settings__row nav-settings__row--toggle"
             data-bind="settings-all-in-row" hidden>
        <span class="nav-settings__copy">
          <strong>ALL IN BUTTON</strong>
          <small>Show the eligible purchase shortcut</small>
        </span>
        <input type="checkbox" data-bind="settings-all-in-button">
        <i class="nav-settings__switch" aria-hidden="true"></i>
      </label>
    </div>`;

  wrapper.append(button, panel);
  const discord = auth.querySelector('#unav-discord');
  const wallet = auth.querySelector('#unav-wallet-app') || auth.querySelector('#unav-wallet');
  auth.insertBefore(wrapper, discord || wallet || auth.firstChild);

  const actions = panel.querySelector('[data-bind="settings-actions"]');
  if (sound) actions?.appendChild(sound);
  if (feedback) actions?.appendChild(feedback);

  const auto = panel.querySelector('[data-bind="settings-auto-reveals"]');
  if (auto) {
    auto.checked = readRevealAutoOpenPreference();
    auto.addEventListener('change', () => writeRevealAutoOpenPreference(auto.checked));
  }

  const bountyDescription = panel.querySelector('[data-bind="settings-bounties-description"]');
  const bountyModes = [...panel.querySelectorAll('[data-bounties-mode]')];
  const paintBountyMode = (mode = readBiggestBountiesModePreference()) => {
    const selected = mode === 'view' || mode === 'off' ? mode : 'on';
    for (const choice of bountyModes) {
      choice.setAttribute('aria-pressed', String(choice.dataset.bountiesMode === selected));
    }
    if (bountyDescription) {
      bountyDescription.textContent = selected === 'on'
        ? 'Show records and purchase shortcuts'
        : selected === 'view'
          ? 'Show records without purchase shortcuts'
          : 'Hide the Biggest Bounties widget';
    }
  };
  paintBountyMode();
  for (const choice of bountyModes) {
    choice.addEventListener('click', () => {
      const selected = writeBiggestBountiesModePreference(choice.dataset.bountiesMode);
      paintBountyMode(selected);
    });
  }

  const speed = panel.querySelector('[data-bind="settings-reveal-speed"]');
  const speedValue = panel.querySelector('[data-bind="settings-reveal-speed-value"]');
  const paintSpeed = ({ persist = false } = {}) => {
    const value = Math.max(0.5, Math.min(3, Number(speed?.value) || 1));
    if (speedValue) speedValue.textContent = `${value}×`;
    if (persist) writeDegeneretteSpeed(value);
  };
  if (speed) {
    speed.value = String(readDegeneretteSpeed());
    paintSpeed();
    speed.addEventListener('input', () => paintSpeed());
    speed.addEventListener('change', () => paintSpeed({ persist: true }));
  }

  const afkingFundingWarning = panel.querySelector(
    '[data-bind="settings-afking-funding-warning"]',
  );
  if (afkingFundingWarning) {
    afkingFundingWarning.checked = readAfkingLowFundWarningPreference();
    afkingFundingWarning.addEventListener('change', () => {
      writeAfkingLowFundWarningPreference(afkingFundingWarning.checked);
    });
  }

  const allInRow = panel.querySelector('[data-bind="settings-all-in-row"]');
  const allIn = panel.querySelector('[data-bind="settings-all-in-button"]');
  if (allIn) {
    allIn.checked = readAllInButtonPreference();
    allIn.addEventListener('change', () => writeAllInButtonPreference(allIn.checked));
  }
  const unsubscribeEligibility = subscribe('ui.allInEligible', (eligible) => {
    if (!allInRow) return;
    allInRow.hidden = eligible !== true;
  });

  button.addEventListener('click', () => {
    _setOpen(wrapper, button, panel, panel.hidden);
    if (!panel.hidden) panel.querySelector('input, button')?.focus?.();
  });
  panel.querySelector('[data-settings-close]')?.addEventListener('click', () => {
    _setOpen(wrapper, button, panel, false);
    button.focus?.();
  });
  const onPointerDown = (event) => {
    if (!panel.hidden && !wrapper.contains(event.target)) _setOpen(wrapper, button, panel, false);
  };
  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    if (event.target?.closest?.('.feedback-overlay')) return;
    _setOpen(wrapper, button, panel, false);
    button.focus?.();
  };
  doc.addEventListener('pointerdown', onPointerDown);
  doc.addEventListener('keydown', onKeyDown);

  // Page-lifetime mount, with an explicit teardown seam for focused tests.
  wrapper.destroySettingsMenu = () => {
    unsubscribeEligibility();
    doc.removeEventListener('pointerdown', onPointerDown);
    doc.removeEventListener('keydown', onKeyDown);
  };
  return wrapper;
}

function mountWhenReady() {
  if (mountSettingsMenu()) return;
  if (typeof MutationObserver !== 'function') return;
  const observer = new MutationObserver(() => {
    if (mountSettingsMenu()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountWhenReady, { once: true });
  } else {
    mountWhenReady();
  }
}
