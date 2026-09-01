// /app/app/coin-faces.js — reliable two-sided artwork for every flipping coin.
//
// Browser 3D back-face culling is not reliable enough for a protocol result:
// Chromium can occasionally expose the reverse of the front texture, which
// looks exactly like a second, upside-down WWXRP face.  Keep the familiar CSS
// toss on one physical surface and switch its already-loaded artwork whenever
// that surface crosses edge-on.  With only one visible plane, a duplicate face
// is impossible even if the browser's compositor has a bad frame.

const FRONT = 'red';
const BACK = 'eth';
const EDGE_EPSILON = 0.0001;

// Sample well beyond the viewport so a coin scrolled back in already wears
// the correct face before it is genuinely visible, even on a fast fling.
const VIEWPORT_MARGIN = '300px';

const _trackedRotors = new Set();
const _entriesByViewportTarget = typeof WeakMap === 'function' ? new WeakMap() : null;
let _frameHandle = null;
let _viewportObserver = null;

function _observeViewport(entry) {
  const rotor = entry?.rotor;
  if (!rotor || entry.viewportTarget) return;
  // Never observe the rotating plane itself. At an edge-on pose its projected
  // box can collapse to zero height; pausing the frame clock on that report
  // would strand the coin at the edge forever. By the first animation frame,
  // callers have mounted the rotor in a stable button/icon wrapper.
  const target = rotor.parentElement || rotor;
  entry.viewportTarget = target;
  _entriesByViewportTarget?.set(target, entry);
  if (_viewportObserver === null && typeof IntersectionObserver === 'function') {
    _viewportObserver = new IntersectionObserver((records) => {
      for (const record of records) {
        const tracked = _entriesByViewportTarget?.get(record.target);
        if (!tracked) continue;
        const wasOnScreen = tracked.onScreen;
        tracked.onScreen = record.isIntersecting;
        // Correct the face in this same task rather than waiting for the
        // next tick, so a coin re-entering the margin zone never paints a
        // stale side first.
        if (record.isIntersecting && wasOnScreen === false) _updateRotor(tracked.rotor);
      }
      _ensureFrameLoop();
    }, { rootMargin: VIEWPORT_MARGIN });
  }
  if (_viewportObserver) {
    try { _viewportObserver.observe(target); } catch (_e) { /* detached shims */ }
  }
}

function _unobserveViewport(entry) {
  const target = entry?.viewportTarget;
  if (_viewportObserver && target) {
    try { _viewportObserver.unobserve(target); } catch (_e) { /* already gone */ }
  }
}

function _frameApi() {
  const scope = typeof window !== 'undefined' ? window : globalThis;
  const request = scope?.requestAnimationFrame;
  const cancel = scope?.cancelAnimationFrame;
  return {
    request: typeof request === 'function' ? request.bind(scope) : null,
    cancel: typeof cancel === 'function' ? cancel.bind(scope) : null,
  };
}

function _frameTimestamp(timestamp) {
  const sampled = Number(timestamp);
  if (Number.isFinite(sampled)) return sampled;
  const scope = typeof window !== 'undefined' ? window : globalThis;
  try {
    const now = scope?.performance?.now;
    if (typeof now === 'function') {
      const fallback = Number(now.call(scope.performance));
      if (Number.isFinite(fallback)) return fallback;
    }
  } catch (_e) { /* fall through to the wall clock */ }
  return Date.now();
}

/**
 * Hold transform animations on the main-thread frame clock.
 *
 * The visible artwork is selected in requestAnimationFrame. If the transform
 * keeps running independently on Chromium's compositor, a busy main thread
 * can leave the red texture mounted while the plane has already crossed to
 * its back — the intermittent upside-down WWXRP frame. Pausing the CSS clock
 * and seeking it immediately before the artwork read makes motion and face a
 * single atomic visual update. A blocked frame now freezes intact.
 */
function _lockRotorAnimationClock(rotor) {
  if (!rotor || typeof rotor.getAnimations !== 'function' || !rotor.style) return false;
  try {
    rotor.style.animationPlayState = 'paused';
    return true;
  } catch (_e) {
    return false;
  }
}

function _advanceRotorAnimations(entry, timestamp) {
  if (!entry?.frameLocked) return;
  let animations = [];
  try { animations = entry.rotor.getAnimations(); } catch (_e) { return; }
  const frameTime = _frameTimestamp(timestamp);
  for (const animation of animations) {
    if (!animation) continue;
    // Element#getAnimations() is element-scoped by default, but retain the
    // target guard for DOM shims and browsers that include descendant effects.
    const target = animation.effect?.target;
    if (target && target !== entry.rotor) continue;
    let clock = entry.animationClocks.get(animation);
    if (!clock) {
      const sampledTime = Number(animation.currentTime);
      const playbackRate = Number(animation.playbackRate);
      clock = {
        animationTime: Number.isFinite(sampledTime) ? sampledTime : 0,
        frameTime,
        playbackRate: Number.isFinite(playbackRate) ? playbackRate : 1,
      };
      entry.animationClocks.set(animation, clock);
      try { animation.pause(); } catch (_e) { /* CSS play-state already holds it */ }
    }
    const elapsed = Math.max(0, frameTime - clock.frameTime);
    try {
      animation.currentTime = clock.animationTime + (elapsed * clock.playbackRate);
    } catch (_e) { /* an inactive/non-time timeline keeps its CSS pause pose */ }
  }
}

/**
 * Return which side of a transformed plane faces the viewer.
 *
 * CSS usually serializes rotateX animations as matrix3d(). Some Chromium
 * compositor paths flatten an exact/intermediate pose to matrix(), though.
 * m33 in 3D, or the 2D determinant after flattening, retains the transformed
 * surface orientation; translation, rotateZ, and positive scale do not change
 * its sign. Holding the previous side at the exact edge prevents sub-pixel
 * sign noise from flashing either image.
 */
export function coinSideFromTransform(transform, previous = FRONT) {
  const prior = previous === BACK ? BACK : FRONT;
  const text = String(transform || '').trim();
  if (!text || text === 'none') return FRONT;

  const match = text.match(/^matrix3d\((.*)\)$/i);
  if (match) {
    const values = match[1].split(',').map((value) => Number(value.trim()));
    const normalZ = values.length === 16 ? values[10] : Number.NaN;
    if (Number.isFinite(normalZ)) {
      if (normalZ < -EDGE_EPSILON) return BACK;
      if (normalZ > EDGE_EPSILON) return FRONT;
      return prior;
    }
  }

  const flatMatch = text.match(/^matrix\((.*)\)$/i);
  if (flatMatch) {
    const values = flatMatch[1].split(',').map((value) => Number(value.trim()));
    if (values.length === 6 && values.every(Number.isFinite)) {
      // A rotateZ around the flattened rotateX can move sign between a/b/c/d;
      // the determinant preserves the front/back orientation of the plane.
      const orientation = values[0] * values[3] - values[1] * values[2];
      if (orientation < -EDGE_EPSILON) return BACK;
      if (orientation > EDGE_EPSILON) return FRONT;
      return prior;
    }
  }

  // Useful for lightweight DOM/test shims that return the authored transform
  // rather than a computed matrix.
  const rotate = text.match(/rotateX\(\s*(-?[\d.]+)deg\s*\)/i);
  if (rotate) {
    const degrees = Number(rotate[1]);
    if (Number.isFinite(degrees)) {
      const normalZ = Math.cos((degrees * Math.PI) / 180);
      if (normalZ < -EDGE_EPSILON) return BACK;
      if (normalZ > EDGE_EPSILON) return FRONT;
    }
  }
  return prior;
}

function _setVisibleSide(rotor, side) {
  if (!rotor) return FRONT;
  const visible = side === BACK ? BACK : FRONT;
  if (rotor.dataset?.visibleCoinFace === visible) return visible;
  const front = rotor.querySelector?.('[data-coin-face="red"]');
  const back = rotor.querySelector?.('[data-coin-face="eth"]');
  if (front) front.hidden = visible !== FRONT;
  if (back) back.hidden = visible !== BACK;
  if (rotor.dataset) rotor.dataset.visibleCoinFace = visible;
  return visible;
}

// The per-frame getComputedStyle read below is DELIBERATE and load-bearing.
// It is the only source that cannot diverge from the pose the compositor
// actually renders. A 2026-08-31 optimization derived the face from the
// animation clock (getComputedTiming().progress against the df-spin-idle
// keyframe shape) to avoid the forced style update; it reintroduced the
// upside-down-WWXRP artifact this module exists to prevent and was reverted.
// Do not swap the matrix read for any nominal-timeline computation.
function _updateRotor(rotor) {
  if (!rotor) return;
  let transform = 'none';
  try {
    const readStyle = typeof getComputedStyle === 'function'
      ? getComputedStyle
      : (typeof window !== 'undefined' ? window.getComputedStyle : null);
    if (typeof readStyle === 'function') transform = readStyle(rotor).transform;
  } catch (_e) { /* retain the safe front face */ }
  const prior = rotor.dataset?.visibleCoinFace || FRONT;
  _setVisibleSide(rotor, coinSideFromTransform(transform, prior));
}

function _dropEntry(entry) {
  _trackedRotors.delete(entry);
  _unobserveViewport(entry);
}

function _tick(timestamp) {
  _frameHandle = null;
  let sampling = false;
  for (const entry of [..._trackedRotors]) {
    const { rotor } = entry;
    if (!rotor) {
      _dropEntry(entry);
      continue;
    }
    if (rotor.isConnected === true) entry.wasConnected = true;
    if (rotor.isConnected === false && entry.wasConnected) {
      _dropEntry(entry);
      continue;
    }
    _observeViewport(entry);
    // A coin outside the (margin-padded) viewport paints nothing; skip its
    // sample entirely and let the observer wake this loop when it returns.
    if (entry.onScreen === false) continue;
    sampling = true;
    _advanceRotorAnimations(entry, timestamp);
    _updateRotor(rotor);
  }
  const { request } = _frameApi();
  if (sampling && request) _frameHandle = request(_tick);
}

function _ensureFrameLoop() {
  if (_frameHandle != null) return;
  const { request } = _frameApi();
  if (!request || _trackedRotors.size === 0) return;
  for (const entry of _trackedRotors) {
    if (entry.onScreen !== false) {
      _frameHandle = request(_tick);
      return;
    }
  }
}

function _trackRotor(rotor) {
  const { request } = _frameApi();
  if (!request || typeof getComputedStyle !== 'function') return;
  const entry = {
    animationClocks: new WeakMap(),
    frameLocked: _lockRotorAnimationClock(rotor),
    rotor,
    wasConnected: rotor?.isConnected === true,
    onScreen: true,
    viewportTarget: null,
  };
  _trackedRotors.add(entry);
  _ensureFrameLoop();
}

function _face(side, src, alt) {
  const face = document.createElement('span');
  face.className = `df-coin3d__face df-coin3d__face--${side}`;
  face.setAttribute('data-coin-face', side);
  face.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img');
  image.src = src;
  image.alt = alt || '';
  image.decoding = 'async';
  face.appendChild(image);
  return { face, image };
}

/**
 * Populate a moving rotor with one flat surface and two preloaded artworks.
 * Exactly one face group is displayable at any moment.  The back artwork is
 * pre-inverted in CSS so the parent plane's reverse projection restores it to
 * an upright ETH face.
 */
export function appendCoinFaces(rotor, {
  frontSrc = '/shared/coinflip-face-red.svg',
  backSrc = '/shared/coinflip-face-eth.svg',
  frontAlt = '',
  backAlt = '',
  initialSide = FRONT,
} = {}) {
  if (!rotor || typeof document === 'undefined') return null;
  const surface = document.createElement('span');
  surface.className = 'df-coin3d__surface';
  const front = _face(FRONT, frontSrc, frontAlt);
  const back = _face(BACK, backSrc, backAlt);
  surface.appendChild(front.face);
  surface.appendChild(back.face);
  rotor.appendChild(surface);
  _setVisibleSide(rotor, initialSide);
  _trackRotor(rotor);
  return {
    surface,
    frontFace: front.face,
    backFace: back.face,
    frontImage: front.image,
    backImage: back.image,
  };
}

/** Stop the shared frame loop in tests or hot-reload teardown. */
export function __resetCoinFaceTrackingForTest() {
  for (const entry of [..._trackedRotors]) _dropEntry(entry);
  _trackedRotors.clear();
  const { cancel } = _frameApi();
  if (_frameHandle != null && cancel) cancel(_frameHandle);
  _frameHandle = null;
  if (_viewportObserver) {
    try { _viewportObserver.disconnect(); } catch (_e) { /* shims */ }
    _viewportObserver = null;
  }
}
