import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetButtonFeedbackForTest,
  initButtonFeedback,
} from '../button-feedback.js';

function fakeRoot() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
}

function fakeButton({ disabled = false, ariaDisabled = null } = {}) {
  const classes = new Set();
  return {
    tagName: 'BUTTON', disabled, parentElement: null,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    getAttribute(name) { return name === 'aria-disabled' ? ariaDisabled : null; },
  };
}

beforeEach(() => __resetButtonFeedbackForTest());

describe('delegated button feedback', () => {
  test('pointer, nested-icon clicks, and keyboard activation paint immediately', () => {
    const root = fakeRoot();
    const button = fakeButton();
    const icon = { tagName: 'SPAN', parentElement: button };
    initButtonFeedback(root);

    root.listeners.get('pointerdown')({ target: icon });
    assert.equal(button.classList.contains('is-tactile-pressed'), true);
    button.classList.remove('is-tactile-pressed');

    root.listeners.get('keydown')({ target: button, key: 'Enter' });
    assert.equal(button.classList.contains('is-tactile-pressed'), true);
  });

  test('disabled controls never pretend that an action started', () => {
    const root = fakeRoot();
    const disabled = fakeButton({ disabled: true });
    const ariaDisabled = fakeButton({ ariaDisabled: 'true' });
    initButtonFeedback(root);
    root.listeners.get('click')({ target: disabled });
    root.listeners.get('click')({ target: ariaDisabled });
    assert.equal(disabled.classList.contains('is-tactile-pressed'), false);
    assert.equal(ariaDisabled.classList.contains('is-tactile-pressed'), false);
  });
});
