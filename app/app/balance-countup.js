// Shared balance-increase presentation for the paired ETH and FLIP ledgers.
//
// The state is scoped to both the value element and the viewed wallet. A first
// load, account switch, or decrease snaps directly to the new value; only a
// genuine same-wallet increase counts up. Hidden claimable balances keep a
// fixed mask in the DOM and remember only an internal baseline, so the effect
// cannot disclose either the amount or whether it changed before reveal.

const DEFAULT_DURATION_MS = 860;
const EFFECT_TAIL_MS = 260;
const SCALE = 1_000_000n;
const _states = new WeakMap();

function _scopeKey(scope) {
  return scope == null ? '' : String(scope).toLowerCase();
}

function _asBalance(value) {
  if (value == null) return null;
  try { return BigInt(value); } catch (_e) { return null; }
}

function _format(format, value, fallback) {
  try { return String(format(value)); } catch (_e) { return fallback; }
}

function _setText(element, text) {
  if (element) element.textContent = String(text);
}

function _clearTimer(handle) {
  if (handle == null || typeof clearTimeout !== 'function') return;
  try { clearTimeout(handle); } catch (_e) { /* defensive */ }
}

function _clearFrame(handle) {
  if (handle == null || typeof cancelAnimationFrame !== 'function') return;
  try { cancelAnimationFrame(handle); } catch (_e) { /* defensive */ }
}

function _clearEffect(state) {
  _clearTimer(state.effectTimer);
  state.effectTimer = null;
  const container = state.container;
  container?.classList?.remove('balance-rise');
  container?.removeAttribute?.('data-balance-delta');
}

function _stopAnimation(state, { clearEffect = true } = {}) {
  _clearFrame(state.frame);
  state.frame = null;
  state.animating = false;
  state.animationTarget = null;
  if (clearEffect) _clearEffect(state);
}

function _canAnimate() {
  if (typeof requestAnimationFrame !== 'function') return false;
  try {
    return typeof matchMedia !== 'function'
      || !matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_e) {
    return false;
  }
}

function _easeOutCubic(progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  return 1 - ((1 - p) ** 3);
}

function _interpolate(from, to, progress) {
  const scaled = BigInt(Math.round(_easeOutCubic(progress) * Number(SCALE)));
  return from + (((to - from) * scaled) / SCALE);
}

function _startEffect(state, deltaText, duration) {
  const container = state.container;
  if (!container) return;
  _clearEffect(state);
  container.setAttribute?.('data-balance-delta', deltaText);
  // Force a completed prior animation to restart when two awards land close
  // together. Reading offsetWidth is harmless on the small ledger tile.
  try { void container.offsetWidth; } catch (_e) { /* fake DOM / detached */ }
  container.classList?.add('balance-rise');
  if (typeof setTimeout === 'function') {
    state.effectTimer = setTimeout(() => _clearEffect(state), duration + EFFECT_TAIL_MS);
    state.effectTimer?.unref?.();
  }
}

/**
 * Paint a balance value, counting upward only for a same-scope increase.
 *
 * `value` is the smallest-unit bigint. `visible: false` guarantees that only
 * `hiddenText` reaches the DOM, while retaining a private baseline so a payout
 * can count up once the surrounding reveal is complete.
 */
export function updateBalanceDisplay(element, {
  container = element?.parentElement || null,
  scope = null,
  value = null,
  visible = true,
  format = (raw) => String(raw),
  formatDelta = (delta) => `+${format(delta)}`,
  hiddenText = '••••',
  emptyText = '—',
  duration = DEFAULT_DURATION_MS,
} = {}) {
  if (!element) return;

  const next = _asBalance(value);
  const nextScope = _scopeKey(scope);
  const isVisible = Boolean(visible);
  let state = _states.get(element);

  if (!state || state.scope !== nextScope) {
    if (state) _stopAnimation(state);
    state = {
      scope: nextScope,
      raw: next,
      displayedRaw: isVisible ? next : null,
      hiddenBaseline: isVisible ? null : next,
      visible: isVisible,
      container,
      frame: null,
      effectTimer: null,
      animating: false,
      animationTarget: null,
    };
    _states.set(element, state);
    _setText(
      element,
      !isVisible ? hiddenText : next == null ? emptyText : _format(format, next, emptyText),
    );
    return;
  }

  if (state.container !== container) {
    _clearEffect(state);
    state.container = container;
  }

  if (!isVisible) {
    _stopAnimation(state);
    if (state.visible || state.hiddenBaseline == null) {
      state.hiddenBaseline = state.raw ?? next;
    }
    state.raw = next;
    state.displayedRaw = null;
    state.visible = false;
    _setText(element, hiddenText);
    return;
  }

  if (next == null) {
    _stopAnimation(state);
    state.raw = null;
    state.displayedRaw = null;
    state.hiddenBaseline = null;
    state.visible = true;
    _setText(element, emptyText);
    return;
  }

  // A component may re-render several times during one payout reveal. Do not
  // reset an in-flight count-up when it is asked to paint the same target.
  if (state.animating && state.animationTarget === next) {
    state.raw = next;
    state.visible = true;
    return;
  }

  const from = state.visible
    ? (state.displayedRaw ?? state.raw)
    : state.hiddenBaseline;
  state.raw = next;
  state.visible = true;
  state.hiddenBaseline = null;

  const finalText = _format(format, next, emptyText);
  const fromText = from == null ? null : _format(format, from, emptyText);
  const durationMs = Math.max(180, Number(duration) || DEFAULT_DURATION_MS);
  if (from == null || next <= from || fromText === finalText || !_canAnimate()) {
    _stopAnimation(state);
    state.displayedRaw = next;
    _setText(element, finalText);
    return;
  }

  _stopAnimation(state);
  state.animating = true;
  state.animationTarget = next;
  state.displayedRaw = from;
  _setText(element, fromText);
  const delta = next - from;
  _startEffect(state, _format(formatDelta, delta, `+${delta}`), durationMs);

  let startedAt = null;
  const frame = (timestamp) => {
    if (!state.animating || state.animationTarget !== next) return;
    if (startedAt == null) startedAt = Number(timestamp) || 0;
    const elapsed = Math.max(0, (Number(timestamp) || 0) - startedAt);
    const progress = Math.min(1, elapsed / durationMs);
    const current = progress >= 1 ? next : _interpolate(from, next, progress);
    state.displayedRaw = current;
    _setText(element, progress >= 1 ? finalText : _format(format, current, finalText));
    if (progress >= 1) {
      state.frame = null;
      state.animating = false;
      state.animationTarget = null;
      state.displayedRaw = next;
      return;
    }
    state.frame = requestAnimationFrame(frame);
  };
  state.frame = requestAnimationFrame(frame);
}

/** Cancel pending frames/effects when a component is detached. */
export function resetBalanceDisplay(element) {
  const state = element ? _states.get(element) : null;
  if (!state) return;
  _stopAnimation(state);
  _states.delete(element);
}

