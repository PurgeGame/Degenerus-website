// Immediate, delegated button feedback. Transaction handlers can spend a beat
// on simulation/RPC before changing their own label; this tiny visual latch
// makes the original pointer or keyboard activation unmistakable meanwhile.

let _cleanup = null;
const _timers = new WeakMap();

function _buttonFrom(target) {
  let node = target;
  while (node) {
    if (String(node.tagName || '').toUpperCase() === 'BUTTON') return node;
    node = node.parentElement || null;
  }
  return null;
}

function _press(button, duration = 260) {
  if (!button || button.disabled || button.getAttribute?.('aria-disabled') === 'true') return;
  const prior = _timers.get(button);
  if (prior != null) clearTimeout(prior);
  button.classList?.add('is-tactile-pressed');
  const timer = setTimeout(() => {
    _timers.delete(button);
    button.classList?.remove('is-tactile-pressed');
  }, duration);
  if (timer && typeof timer.unref === 'function') {
    try { timer.unref(); } catch (_e) { /* browser timer */ }
  }
  _timers.set(button, timer);
}

export function initButtonFeedback(root = globalThis.document) {
  if (_cleanup || !root?.addEventListener) return _cleanup || (() => {});
  const pointerDown = (event) => _press(_buttonFrom(event?.target), 420);
  const click = (event) => _press(_buttonFrom(event?.target), 260);
  const keyDown = (event) => {
    if (event?.key === 'Enter' || event?.key === ' ') _press(_buttonFrom(event?.target), 420);
  };
  const keyUp = (event) => {
    if (event?.key === 'Enter' || event?.key === ' ') _press(_buttonFrom(event?.target), 260);
  };
  root.addEventListener('pointerdown', pointerDown, true);
  root.addEventListener('click', click, true);
  root.addEventListener('keydown', keyDown, true);
  root.addEventListener('keyup', keyUp, true);
  _cleanup = () => {
    root.removeEventListener?.('pointerdown', pointerDown, true);
    root.removeEventListener?.('click', click, true);
    root.removeEventListener?.('keydown', keyDown, true);
    root.removeEventListener?.('keyup', keyUp, true);
    _cleanup = null;
  };
  return _cleanup;
}

export function __resetButtonFeedbackForTest() {
  if (_cleanup) _cleanup();
}

