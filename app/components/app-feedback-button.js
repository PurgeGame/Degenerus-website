// Compact top-row bug/suggestion inbox. The webhook stays server-side; this
// browser component only talks to the indexed API's POST /feedback endpoint.

import { submitFeedback } from '../app/feedback.js';
import { compactUiError } from '../app/ui-error.js';

const BUTTON_ID = 'unav-feedback';
const DIALOG_ID = 'app-feedback-dialog';

function _button() {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = BUTTON_ID;
  button.className = 'nav-btn nav-btn-feedback';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', DIALOG_ID);
  button.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-7a4 4 0 0 1-1-2.6V7a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4z"/>
      <path d="M12 7v4"/><path d="M12 15h.01"/>
    </svg>
    <span class="btn-label">BUGS / IDEAS</span>`;
  return button;
}

function _dialog() {
  const overlay = document.createElement('div');
  overlay.id = DIALOG_ID;
  overlay.className = 'feedback-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="feedback-dialog" role="dialog" aria-modal="true"
             aria-labelledby="feedback-dialog-title">
      <header class="feedback-dialog__head">
        <span>
          <small>PLAYER FEEDBACK</small>
          <strong id="feedback-dialog-title">BUGS &amp; IDEAS</strong>
        </span>
        <button type="button" class="feedback-dialog__close" data-feedback-close
                aria-label="Close feedback form">×</button>
      </header>
      <form class="feedback-form" data-feedback-form>
        <div class="feedback-kind" role="group" aria-label="Feedback type">
          <button type="button" class="is-active" data-feedback-kind="bug"
                  aria-pressed="true">BUG</button>
          <button type="button" data-feedback-kind="suggestion"
                  aria-pressed="false">SUGGESTION</button>
        </div>
        <label>
          <span>SHORT TITLE</span>
          <input name="title" maxlength="120" autocomplete="off" required
                 placeholder="What happened?">
        </label>
        <label>
          <span>DETAILS</span>
          <textarea name="message" maxlength="4000" required
                    placeholder="What did you do, what did you expect, and what happened?"></textarea>
        </label>
        <label>
          <span>CONTACT <em>OPTIONAL</em></span>
          <input name="contact" maxlength="200" autocomplete="off"
                 placeholder="Discord handle or email">
        </label>
        <label class="feedback-honeypot" aria-hidden="true">
          <span>Website</span><input name="website" tabindex="-1" autocomplete="off">
        </label>
        <p class="feedback-form__context">Page, wallet, level, day, and browser context are attached automatically.</p>
        <p class="feedback-form__status" data-feedback-status hidden aria-live="polite"></p>
        <button type="submit" class="feedback-form__submit" data-feedback-submit>SEND REPORT</button>
      </form>
    </section>`;
  return overlay;
}

export function mountFeedbackButton(root = document) {
  if (!root?.querySelector || root.getElementById?.(BUTTON_ID)) return null;
  const auth = root.querySelector('.nav-auth');
  if (!auth) return null;

  const button = _button();
  const overlay = _dialog();
  const form = overlay.querySelector('[data-feedback-form]');
  const status = overlay.querySelector('[data-feedback-status]');
  const submit = overlay.querySelector('[data-feedback-submit]');
  let kind = 'bug';

  const close = () => {
    overlay.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.focus?.();
  };
  const open = () => {
    overlay.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    status.hidden = true;
    status.textContent = '';
    overlay.querySelector('input[name="title"]')?.focus?.();
  };

  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', open);
  overlay.querySelectorAll('[data-feedback-close]').forEach((node) => node.addEventListener('click', close));
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  overlay.querySelectorAll('[data-feedback-kind]').forEach((choice) => {
    choice.addEventListener('click', () => {
      kind = choice.dataset.feedbackKind === 'suggestion' ? 'suggestion' : 'bug';
      overlay.querySelectorAll('[data-feedback-kind]').forEach((node) => {
        const active = node === choice;
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      submit.textContent = kind === 'bug' ? 'SEND REPORT' : 'SEND IDEA';
    });
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    submit.textContent = 'SENDING…';
    status.hidden = true;
    status.classList.remove('is-error', 'is-success');
    try {
      const values = new FormData(form);
      const result = await submitFeedback({
        kind,
        title: values.get('title'),
        message: values.get('message'),
        contact: values.get('contact'),
        website: values.get('website'),
      });
      status.textContent = result?.id ? `SENT · REPORT #${result.id}` : 'SENT · THANK YOU';
      status.classList.add('is-success');
      status.hidden = false;
      form.reset();
    } catch (error) {
      status.textContent = compactUiError(error, 'Could not send that right now.');
      status.classList.add('is-error');
      status.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = kind === 'bug' ? 'SEND REPORT' : 'SEND IDEA';
    }
  });

  const discord = auth.querySelector('#unav-discord');
  auth.insertBefore(button, discord || auth.firstChild);
  (root.body || document.body)?.appendChild(overlay);
  return { button, overlay };
}

function mountWhenReady() {
  if (mountFeedbackButton()) return;
  if (typeof MutationObserver !== 'function') return;
  const observer = new MutationObserver(() => {
    if (mountFeedbackButton()) observer.disconnect();
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
